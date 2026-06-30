"use strict";
/**
 * PanGrab Pro 后端 API
 * 功能：账号注册/登录、会员状态、云同步(Pro)、兑换码激活、管理员发码。
 * 启动：JWT_SECRET=xxx ADMIN_KEY=yyy node src/index.js
 */
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("./db");
const alipay = require("./alipay");

const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ADMIN_KEY = process.env.ADMIN_KEY || "dev-admin-change-me";
// 服务器对外可访问地址（支付宝回调/跳转用），如 https://api.你的域名 或 http://你的IP:8787
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ("http://localhost:" + PORT);

// 会员套餐（金额单位：元）。可自行修改价格/天数。
const PLANS = {
  month: { days: 30, amount: "9.90", subject: "PanGrab Pro 月卡" },
  quarter: { days: 90, amount: "25.00", subject: "PanGrab Pro 季卡" },
  year: { days: 365, amount: "68.00", subject: "PanGrab Pro 年卡" }
};

const app = express();
app.use(express.json({ limit: "5mb" }));
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
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email=?").get((email || "").toLowerCase());
  if (!user || !bcrypt.compareSync(password || "", user.pass_hash))
    return res.status(401).json({ error: "邮箱或密码错误" });
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

/* --------------------------- 支付宝下单/支付 --------------------------- */
// 创建订单并返回支付宝支付跳转地址
app.post("/api/order/create", auth, async (req, res) => {
  if (!alipay.enabled())
    return res.status(503).json({ error: "支付未配置，请使用兑换码或联系客服" });
  const plan = (req.body && req.body.plan || "").trim();
  const p = PLANS[plan];
  if (!p) return res.status(400).json({ error: "套餐无效" });
  const outTradeNo = "PG" + Date.now() + crypto.randomBytes(3).toString("hex");
  db.prepare(`INSERT INTO orders(out_trade_no, user_id, plan, days, amount, status, created_at)
              VALUES(?,?,?,?,?,'pending',?)`)
    .run(outTradeNo, req.user.id, plan, p.days, p.amount, now());
  try {
    const payUrl = alipay.pagePayUrl({
      outTradeNo: outTradeNo,
      amount: p.amount,
      subject: p.subject,
      notifyUrl: PUBLIC_BASE_URL + "/api/alipay/notify",
      returnUrl: PUBLIC_BASE_URL + "/api/alipay/return"
    });
    res.json({ ok: true, out_trade_no: outTradeNo, payUrl: payUrl });
  } catch (e) {
    res.status(500).json({ error: "下单失败：" + (e.message || e) });
  }
});

// 查询订单状态（前端轮询用）
app.get("/api/order/status", auth, (req, res) => {
  const ono = (req.query.out_trade_no || "").trim();
  const row = db.prepare("SELECT out_trade_no, status, plan, amount, paid_at FROM orders WHERE out_trade_no=? AND user_id=?")
    .get(ono, req.user.id);
  if (!row) return res.status(404).json({ error: "订单不存在" });
  res.json({ ok: true, order: row });
});

// 支付宝异步通知（服务器对服务器）—— 必须返回纯文本 success
app.post("/api/alipay/notify", (req, res) => {
  const params = req.body || {};
  if (!alipay.verifyNotify(params)) { res.send("fail"); return; }
  const status = params.trade_status;
  if (status === "TRADE_SUCCESS" || status === "TRADE_FINISHED") {
    const order = db.prepare("SELECT * FROM orders WHERE out_trade_no=?").get(params.out_trade_no);
    if (order && order.status !== "paid") {
      const user = db.prepare("SELECT * FROM users WHERE id=?").get(order.user_id);
      if (user) {
        const base = isPro(user) ? user.pro_until : now();
        const newUntil = base + order.days * 24 * 3600 * 1000;
        const tx = db.transaction(() => {
          db.prepare("UPDATE orders SET status='paid', trade_no=?, paid_at=? WHERE out_trade_no=?")
            .run(params.trade_no || "", now(), order.out_trade_no);
          db.prepare("UPDATE users SET pro_until=? WHERE id=?").run(newUntil, user.id);
        });
        tx();
      }
    }
  }
  res.send("success");
});

// 支付完成同步跳转页（用户浏览器看到的页面）
app.get("/api/alipay/return", (_req, res) => {
  res.type("html").send(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>支付完成</title><style>body{font-family:system-ui,-apple-system,sans-serif;text-align:center;' +
    'padding:60px 20px;color:#1f2733}h2{color:#15a05b}p{color:#7a869a}</style>' +
    '<h2>✓ 支付完成</h2><p>请回到 PanGrab 扩展的「账号 / 云同步」面板，重新打开即可看到会员状态已更新。</p>' +
    '<p>本页面可以关闭。</p>'
  );
});

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
