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

const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ADMIN_KEY = process.env.ADMIN_KEY || "dev-admin-change-me";

const app = express();
app.use(express.json({ limit: "5mb" }));
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

app.get("/api/health", (_req, res) => res.json({ ok: true, time: now() }));

app.listen(PORT, () => console.log(`PanGrab Pro server on :${PORT}`));
