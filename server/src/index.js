"use strict";
// 从 server/.env 读取配置（无论从哪个目录启动都能定位到）
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
/**
 * PanGrab Pro 后端 API
 * 功能：账号注册/登录、会员状态、云同步(Pro)、兑换码激活、管理员发码。
 * 启动：node src/index.js（配置写在 server/.env），或用环境变量覆盖
 */
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const QRCode = require("qrcode");
const db = require("./db");
const alipay = require("./alipay");
const lemon = require("./lemonsqueezy");
// 离线 IP 地理定位（可选依赖；未安装时地区显示为空，不影响其它功能）
let geoip = null;
try { geoip = require("geoip-lite"); } catch (e) { console.warn("geoip-lite 未安装，登录地区将为空。可执行 npm install 安装。"); }

const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ADMIN_KEY = process.env.ADMIN_KEY || "dev-admin-change-me";
// 服务器对外可访问地址（支付宝回调/跳转用），如 https://api.你的域名 或 http://你的IP:8787
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ("http://localhost:" + PORT);
// 客服邮箱：海外用户走 Payoneer 人工收款 + 兑换码时的联系入口。配置了它，购买页/扩展就会显示「联系客服」并开启 International 标签的 Payoneer 方案。
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "";
// 可选：固定的 Payoneer 收款/付款请求链接（Payoneer「Request a Payment」生成的链接）。填了则购买页会额外显示「用 Payoneer 付款」按钮。
const PAYONEER_URL = process.env.PAYONEER_URL || "";

// 会员套餐（金额单位：元）。可自行修改价格/天数。
const PLANS = {
  month: { days: 30, amount: "9.90", subject: "PanGrab Pro 月卡" },
  quarter: { days: 90, amount: "25.00", subject: "PanGrab Pro 季卡" },
  year: { days: 365, amount: "68.00", subject: "PanGrab Pro 年卡" }
};

const app = express();
// 部署在反向代理(Caddy/Nginx/Lucky)后面时，据此从 X-Forwarded-For 取真实客户端 IP
app.set("trust proxy", true);
// 保留原始请求体，供 Lemon Squeezy webhook 做 HMAC 验签
app.use(express.json({ limit: "5mb", verify: function (req, _res, buf) { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false })); // 支付宝异步通知是 form 表单
// 允许扩展(chrome-extension://) 与网页调用
app.use(cors({ origin: true }));

/* ----------------------------- 工具 ----------------------------- */
function now() { return Date.now(); }
function isPro(user) { return user && user.pro_until && user.pro_until > now(); }

function signToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "未登录" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(payload.uid);
    if (!user) return res.status(401).json({ error: "用户不存在" });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: "登录已过期，请重新登录" });
  }
}

function requirePro(req, res, next) {
  if (!isPro(req.user)) return res.status(403).json({ error: "该功能需要 Pro 会员", code: "NEED_PRO" });
  next();
}

function publicUser(u) {
  return { id: u.id, email: u.email, pro_until: u.pro_until || 0, is_pro: isPro(u) };
}

/* --------------------- 客户端 IP / 地区（登录来源记录）--------------------- */
// 取真实客户端 IP（trust proxy 已开启，req.ip 会解析 X-Forwarded-For）
function clientIp(req) {
  let ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "";
  return ip.replace(/^::ffff:/, ""); // 去掉 IPv4-mapped IPv6 前缀
}
// 由 IP 反查地区："国家代码 · 城市"，内网/无法解析时给出兜底
function regionFromIp(ip) {
  if (!ip) return "";
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc00:|fe80:)/.test(ip)) return "本地/内网";
  if (geoip) {
    try {
      const g = geoip.lookup(ip);
      if (g) return (g.country || "?") + (g.city ? " · " + g.city : "");
    } catch (e) { /* ignore */ }
  }
  return "";
}
// 记录一次登录来源
function recordLogin(userId, req) {
  const ip = clientIp(req);
  const region = regionFromIp(ip);
  db.prepare("UPDATE users SET last_login_at=?, last_ip=?, last_region=?, login_count=COALESCE(login_count,0)+1 WHERE id=?")
    .run(now(), ip, region, userId);
}

/**
 * 标记订单已支付并给用户增加会员天数（幂等：已 paid 的订单不重复加）。
 * 各支付渠道的回调都复用此逻辑。返回是否实际入账。
 */
function creditOrder(outTradeNo, tradeNo) {
  const order = db.prepare("SELECT * FROM orders WHERE out_trade_no=?").get(outTradeNo);
  if (!order || order.status === "paid") return false;
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(order.user_id);
  if (!user) return false;
  const base = isPro(user) ? user.pro_until : now();
  const newUntil = base + order.days * 24 * 3600 * 1000;
  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status='paid', trade_no=?, paid_at=? WHERE out_trade_no=?")
      .run(tradeNo || "", now(), order.out_trade_no);
    db.prepare("UPDATE users SET pro_until=? WHERE id=?").run(newUntil, user.id);
  });
  tx();
  return true;
}

// 默认支付渠道：优先支付宝，其次国际
function defaultProvider() {
  if (alipay.enabled()) return "alipay";
  if (lemon.enabled()) return "lemonsqueezy";
  return "";
}

// 支付完成后用户浏览器看到的提示页（支付宝/国际通用）
function payDonePage() {
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>支付完成 / Payment complete</title><style>body{font-family:system-ui,-apple-system,sans-serif;' +
    'text-align:center;padding:60px 20px;color:#1f2733}h2{color:#15a05b}p{color:#7a869a;line-height:1.7}</style>' +
    '<h2>✓ 支付完成 / Payment complete</h2>' +
    '<p>请回到 PanGrab 扩展的「账号 / 云同步」面板，重新打开即可看到会员状态已更新。<br/>' +
    'Please reopen the Account panel in the PanGrab extension to see your membership.</p>' +
    '<p>本页面可以关闭 / You can close this page.</p>';
}

/* ----------------------------- 账号 ----------------------------- */
app.post("/api/register", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 6)
    return res.status(400).json({ error: "邮箱必填，密码至少 6 位" });
  const exists = db.prepare("SELECT id FROM users WHERE email=?").get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: "该邮箱已注册" });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare("INSERT INTO users(email, pass_hash, created_at) VALUES(?,?,?)")
    .run(email.toLowerCase(), hash, now());
  const ip = clientIp(req), region = regionFromIp(ip);
  db.prepare("UPDATE users SET reg_ip=?, reg_region=?, last_login_at=?, last_ip=?, last_region=?, login_count=1 WHERE id=?")
    .run(ip, region, now(), ip, region, info.lastInsertRowid);
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email=?").get((email || "").toLowerCase());
  if (!user || !bcrypt.compareSync(password || "", user.pass_hash))
    return res.status(401).json({ error: "邮箱或密码错误" });
  recordLogin(user.id, req);
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* --------------------------- 云同步(Pro) --------------------------- */
app.get("/api/sync", auth, requirePro, (req, res) => {
  const row = db.prepare("SELECT payload, updated_at FROM sync_data WHERE user_id=?").get(req.user.id);
  if (!row) return res.json({ payload: null, updated_at: 0 });
  res.json({ payload: JSON.parse(row.payload), updated_at: row.updated_at });
});

app.put("/api/sync", auth, requirePro, (req, res) => {
  const { payload } = req.body || {};
  if (typeof payload !== "object" || payload === null)
    return res.status(400).json({ error: "payload 必须是对象" });
  const str = JSON.stringify(payload);
  const ts = now();
  db.prepare(`INSERT INTO sync_data(user_id, payload, updated_at) VALUES(?,?,?)
              ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`)
    .run(req.user.id, str, ts);
  res.json({ ok: true, updated_at: ts });
});

/* --------------------------- 兑换码激活 --------------------------- */
app.post("/api/redeem", auth, (req, res) => {
  const code = (req.body && req.body.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "请输入兑换码" });
  const row = db.prepare("SELECT * FROM redeem_codes WHERE code=?").get(code);
  if (!row) return res.status(404).json({ error: "兑换码无效" });
  if (row.used_by) return res.status(409).json({ error: "兑换码已被使用" });

  const base = isPro(req.user) ? req.user.pro_until : now();
  const newUntil = base + row.days * 24 * 3600 * 1000;
  const tx = db.transaction(() => {
    db.prepare("UPDATE redeem_codes SET used_by=?, used_at=? WHERE code=?").run(req.user.id, now(), code);
    db.prepare("UPDATE users SET pro_until=? WHERE id=?").run(newUntil, req.user.id);
  });
  tx();
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  res.json({ ok: true, user: publicUser(user), added_days: row.days });
});

/* --------------------------- 管理员发码 --------------------------- */
app.post("/api/admin/codes", (req, res) => {
  if ((req.headers["x-admin-key"] || "") !== ADMIN_KEY)
    return res.status(401).json({ error: "管理员密钥错误" });
  const count = Math.min(parseInt(req.body && req.body.count) || 1, 1000);
  const days = parseInt(req.body && req.body.days) || 30;
  const codes = [];
  const insert = db.prepare("INSERT INTO redeem_codes(code, days, created_at) VALUES(?,?,?)");
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const code = "PG-" + crypto.randomBytes(6).toString("hex").toUpperCase();
      insert.run(code, days, now());
      codes.push(code);
    }
  });
  tx();
  res.json({ ok: true, days, codes });
});

/* --------------------------- 查库存 / 列码 --------------------------- */
app.get("/api/admin/codes", (req, res) => {
  if ((req.headers["x-admin-key"] || "") !== ADMIN_KEY)
    return res.status(401).json({ error: "管理员密钥错误" });
  const status = (req.query.status || "all").toLowerCase(); // unused | used | all
  const where = status === "unused" ? "WHERE used_by IS NULL"
    : status === "used" ? "WHERE used_by IS NOT NULL" : "";
  const rows = db.prepare(
    "SELECT code, days, used_by, used_at, created_at FROM redeem_codes " + where + " ORDER BY created_at DESC"
  ).all();
  const s = db.prepare(
    "SELECT COUNT(*) total, SUM(CASE WHEN used_by IS NULL THEN 1 ELSE 0 END) unused FROM redeem_codes"
  ).get();
  res.json({
    stats: { total: s.total, unused: s.unused || 0, used: s.total - (s.unused || 0) },
    count: rows.length,
    codes: rows
  });
});

/* --------------------------- 业务统计 --------------------------- */
app.get("/api/admin/stats", (req, res) => {
  if ((req.headers["x-admin-key"] || "") !== ADMIN_KEY)
    return res.status(401).json({ error: "管理员密钥错误" });
  const users = db.prepare("SELECT COUNT(*) c FROM users").get().c;
  const pro = db.prepare("SELECT COUNT(*) c FROM users WHERE pro_until > ?").get(now()).c;
  const codes = db.prepare(
    "SELECT COUNT(*) total, SUM(CASE WHEN used_by IS NULL THEN 1 ELSE 0 END) unused FROM redeem_codes"
  ).get();
  res.json({
    users: users,
    pro_users: pro,
    codes_total: codes.total,
    codes_unused: codes.unused || 0,
    codes_used: codes.total - (codes.unused || 0)
  });
});

/* --------------------------- 用户列表（含登录来源） --------------------------- */
app.get("/api/admin/users", (req, res) => {
  if ((req.headers["x-admin-key"] || "") !== ADMIN_KEY)
    return res.status(401).json({ error: "管理员密钥错误" });
  const filter = (req.query.filter || "all").toLowerCase(); // all | pro
  const q = (req.query.q || "").trim().toLowerCase();
  const nowTs = now();
  const cols = "id,email,pro_until,created_at,last_login_at,last_ip,last_region,login_count,reg_ip,reg_region";
  const rows = filter === "pro"
    ? db.prepare("SELECT " + cols + " FROM users WHERE pro_until > ? ORDER BY COALESCE(last_login_at,created_at) DESC").all(nowTs)
    : db.prepare("SELECT " + cols + " FROM users ORDER BY COALESCE(last_login_at,created_at) DESC").all();
  const list = rows
    .filter((u) => !q || (u.email || "").toLowerCase().indexOf(q) !== -1 || (u.last_ip || "").indexOf(q) !== -1)
    .map((u) => ({
      id: u.id,
      email: u.email,
      is_pro: (u.pro_until || 0) > nowTs,
      pro_until: u.pro_until || 0,
      created_at: u.created_at || 0,
      last_login_at: u.last_login_at || 0,
      last_ip: u.last_ip || "",
      last_region: u.last_region || "",
      login_count: u.login_count || 0,
      reg_ip: u.reg_ip || "",
      reg_region: u.reg_region || ""
    }));
  res.json({ count: list.length, users: list });
});

/* --------------------------- 支付：渠道 & 下单 --------------------------- */
// 查询可用支付渠道与套餐（购买页用）
app.get("/api/pay/providers", (_req, res) => {
  res.json({
    providers: {
      alipay: alipay.enabled(),
      lemonsqueezy: lemon.enabled(),
      // Payoneer 人工收款方案：只要配置了客服邮箱即视为可用（无需自动 checkout，走联系客服 + 兑换码）
      payoneer: !!SUPPORT_EMAIL
    },
    // 客服联系方式（购买页/扩展显示；海外 Payoneer 购买与售后支持用）
    support: { email: SUPPORT_EMAIL, payoneerUrl: PAYONEER_URL },
    // 支付宝按人民币定价；Lemon Squeezy 价格在其后台按变体设置，按用户所在地货币结算
    plans: {
      month: { days: PLANS.month.days, amount: PLANS.month.amount },
      quarter: { days: PLANS.quarter.days, amount: PLANS.quarter.amount },
      year: { days: PLANS.year.days, amount: PLANS.year.amount }
    }
  });
});

// 创建订单并返回支付跳转地址。body: { plan, provider? }
app.post("/api/order/create", auth, async (req, res) => {
  const plan = (req.body && req.body.plan || "").trim();
  const p = PLANS[plan];
  if (!p) return res.status(400).json({ error: "套餐无效" });

  const provider = (req.body && req.body.provider || "").trim() || defaultProvider();
  if (!provider) return res.status(503).json({ error: "支付未配置，请使用兑换码或联系客服" });

  const outTradeNo = "PG" + Date.now() + crypto.randomBytes(3).toString("hex");

  try {
    if (provider === "alipay") {
      if (!alipay.enabled()) return res.status(503).json({ error: "支付宝未配置" });
      db.prepare(`INSERT INTO orders(out_trade_no, user_id, plan, days, amount, status, provider, currency, created_at)
                  VALUES(?,?,?,?,?,'pending','alipay','CNY',?)`)
        .run(outTradeNo, req.user.id, plan, p.days, p.amount, now());
      // 当面付：生成二维码内容，前端渲染成二维码供扫码支付
      const qrContent = await alipay.precreateQr({
        outTradeNo: outTradeNo,
        amount: p.amount,
        subject: p.subject,
        notifyUrl: PUBLIC_BASE_URL + "/api/alipay/notify"
      });
      const qrDataUrl = await QRCode.toDataURL(qrContent, { margin: 1, width: 280 });
      return res.json({
        ok: true, out_trade_no: outTradeNo, provider: provider,
        mode: "qr", qrDataUrl: qrDataUrl, amount: p.amount, subject: p.subject
      });
    }

    if (provider === "lemonsqueezy") {
      if (!lemon.enabled()) return res.status(503).json({ error: "国际支付未配置" });
      if (!lemon.variantFor(plan)) return res.status(503).json({ error: "该套餐未配置国际支付" });
      db.prepare(`INSERT INTO orders(out_trade_no, user_id, plan, days, amount, status, provider, currency, created_at)
                  VALUES(?,?,?,?,?,'pending','lemonsqueezy','USD',?)`)
        .run(outTradeNo, req.user.id, plan, p.days, "", now());
      const payUrl = await lemon.createCheckout({
        plan: plan,
        custom: { out_trade_no: outTradeNo, user_id: String(req.user.id), plan: plan },
        redirectUrl: PUBLIC_BASE_URL + "/api/pay/return"
      });
      return res.json({ ok: true, out_trade_no: outTradeNo, provider: provider, payUrl: payUrl });
    }

    return res.status(400).json({ error: "不支持的支付渠道" });
  } catch (e) {
    return res.status(500).json({ error: "下单失败：" + (e.message || e) });
  }
});

// 查询订单状态（前端轮询用）。对支付宝待支付订单主动查单，防止 notify 未到达
app.get("/api/order/status", auth, async (req, res) => {
  const ono = (req.query.out_trade_no || "").trim();
  const row = db.prepare("SELECT * FROM orders WHERE out_trade_no=? AND user_id=?").get(ono, req.user.id);
  if (!row) return res.status(404).json({ error: "订单不存在" });

  // 兜底：支付宝订单仍 pending 时主动向支付宝查一次
  if (row.status !== "paid" && row.provider === "alipay" && alipay.enabled()) {
    const q = await alipay.queryTrade(ono);
    if (q && (q.tradeStatus === "TRADE_SUCCESS" || q.tradeStatus === "TRADE_FINISHED")) {
      creditOrder(ono, q.tradeNo || "");
      row.status = "paid";
    }
  }
  res.json({
    ok: true,
    order: {
      out_trade_no: row.out_trade_no, status: row.status, plan: row.plan,
      amount: row.amount, provider: row.provider, currency: row.currency, paid_at: row.paid_at
    }
  });
});

/* --------------------------- 支付宝回调 --------------------------- */
// 支付宝异步通知（服务器对服务器）—— 必须返回纯文本 success
app.post("/api/alipay/notify", (req, res) => {
  const params = req.body || {};
  if (!alipay.verifyNotify(params)) { res.send("fail"); return; }
  const status = params.trade_status;
  if (status === "TRADE_SUCCESS" || status === "TRADE_FINISHED") {
    creditOrder(params.out_trade_no, params.trade_no || "");
  }
  res.send("success");
});

// 支付完成同步跳转页（支付宝 return_url）
app.get("/api/alipay/return", (_req, res) => { res.type("html").send(payDonePage()); });

/* --------------------------- Lemon Squeezy 回调 --------------------------- */
// webhook：验签后给账号加会员（order_created = 已支付）
app.post("/api/lemonsqueezy/webhook", (req, res) => {
  const sig = req.headers["x-signature"] || "";
  if (!lemon.verifyWebhook(req.rawBody, sig)) return res.status(401).send("bad signature");
  const eventName = req.headers["x-event-name"] || "";
  const body = req.body || {};
  if (eventName === "order_created") {
    const custom = (body.meta && body.meta.custom_data) || {};
    const outTradeNo = custom.out_trade_no;
    const tradeNo = (body.data && body.data.id) ? String(body.data.id) : "";
    if (outTradeNo) creditOrder(outTradeNo, tradeNo);
  }
  res.send("ok");
});

// 国际支付完成跳转页（Lemon Squeezy redirect_url）
app.get("/api/pay/return", (_req, res) => { res.type("html").send(payDonePage()); });

// 购买页
app.get("/buy", (_req, res) => {
  res.sendFile(require("path").join(__dirname, "buy.html"));
});

app.get("/api/health", (_req, res) => res.json({ ok: true, time: now() }));

// 管理后台网页（静态页，调用需输入 ADMIN_KEY）
app.get("/admin", (_req, res) => {
  res.sendFile(require("path").join(__dirname, "admin.html"));
});

app.listen(PORT, () => console.log(`PanGrab Pro server on :${PORT}`));
