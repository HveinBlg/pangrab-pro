"use strict";
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT UNIQUE NOT NULL,
  pass_hash  TEXT NOT NULL,
  pro_until  INTEGER DEFAULT 0,         -- 会员到期时间(毫秒时间戳)，0=非会员
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_data (
  user_id    INTEGER PRIMARY KEY,
  payload    TEXT NOT NULL,             -- JSON 字符串：{ links:[], categories:[] }
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS redeem_codes (
  code       TEXT PRIMARY KEY,
  days       INTEGER NOT NULL,          -- 兑换后增加的会员天数
  used_by    INTEGER,                   -- 使用者 user_id，NULL=未使用
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  out_trade_no TEXT PRIMARY KEY,        -- 商户订单号
  user_id      INTEGER NOT NULL,
  plan         TEXT,
  days         INTEGER NOT NULL,
  amount       TEXT NOT NULL,           -- 金额，字符串如 "9.90"
  status       TEXT DEFAULT 'pending',  -- pending | paid
  trade_no     TEXT,                    -- 第三方交易号
  provider     TEXT DEFAULT 'alipay',   -- 支付渠道：alipay | lemonsqueezy ...
  currency     TEXT DEFAULT 'CNY',      -- 币种：CNY | USD ...
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER
);
`);

/* ---- 迁移：为旧库的 orders 表补充 provider / currency 列 ---- */
(function migrate() {
  try {
    const cols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
    if (!cols.includes("provider"))
      db.exec("ALTER TABLE orders ADD COLUMN provider TEXT DEFAULT 'alipay'");
    if (!cols.includes("currency"))
      db.exec("ALTER TABLE orders ADD COLUMN currency TEXT DEFAULT 'CNY'");
  } catch (e) {
    console.error("orders 表迁移失败:", e.message);
  }
})();

/* ---- 迁移：为 users 表补充登录来源(IP/地区/登录次数)相关列 ---- */
(function migrateUsers() {
  try {
    const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    const add = [
      ["last_login_at", "INTEGER"],
      ["last_ip", "TEXT"],
      ["last_region", "TEXT"],
      ["login_count", "INTEGER DEFAULT 0"],
      ["reg_ip", "TEXT"],
      ["reg_region", "TEXT"]
    ];
    add.forEach(([name, type]) => {
      if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    });
  } catch (e) {
    console.error("users 表迁移失败:", e.message);
  }
})();

module.exports = db;
