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
  amount       TEXT NOT NULL,           -- 金额(元)，字符串如 "9.90"
  status       TEXT DEFAULT 'pending',  -- pending | paid
  trade_no     TEXT,                    -- 支付宝交易号
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER
);
`);

module.exports = db;
