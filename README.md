# PanGrab Pro（会员版）

在 PanGrab 基础上增加**服务器侧、不可破解**的会员功能。免费版仍为纯本地工具，Pro 卖的是云端能力。

## 为什么这样设计
客户端做"限次数/会员校验"易被破解（代码在用户本地）。会员要拦得住，必须把**数据与能力放服务器**：
- ✅ 多端**云同步**收藏（数据在服务器，不开会员拿不到）
- 🔜 失效**自动监控 + 提醒**（服务器定时巡检）
- 变现用**兑换码**：避开微信/支付宝需营业执照的麻烦；你生成卡密在闲鱼/发卡/爱发电卖，用户在扩展内输码激活。

## 目录结构
```
pangrab-pro/
├── server/      Node + Express + SQLite 后端
│   └── src/{index.js, db.js}
└── extension/   Pro 版扩展（待建：登录 + 云同步 + 会员状态）
```

## 后端 API
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/register | 注册 {email,password} → token |
| POST | /api/login | 登录 → token |
| GET  | /api/me | 当前用户与会员状态 |
| GET  | /api/sync | 拉取云端收藏（**Pro**）|
| PUT  | /api/sync | 上传云端收藏（**Pro**）{payload}|
| POST | /api/redeem | 兑换码激活会员 {code} |
| POST | /api/admin/codes | 管理员发码（头 x-admin-key）{count,days} |
| GET  | /api/health | 健康检查 |

会员判定：`pro_until > 现在`。云同步接口对非会员返回 403 `NEED_PRO`。

## 本地运行
```bash
cd server
npm install
JWT_SECRET=随机串 ADMIN_KEY=你的密钥 node src/index.js
# 默认 :8787
```

## 部署
- 任意装了 Node 的服务器/VPS 均可（也可跑在你现有的服务器上）。
- 建议用 Nginx/Caddy 反代 + HTTPS；或放在 Cloudflare 后面。
- 数据库 `data.db`（SQLite）记得**定期备份**。

## 卖会员（兑换码流程）
1. 管理员发码：
   ```bash
   curl -X POST https://你的域名/api/admin/codes \
     -H 'x-admin-key: 你的ADMIN_KEY' -H 'Content-Type: application/json' \
     -d '{"count":10,"days":30}'
   ```
2. 把生成的 `PG-XXXX` 卡密在闲鱼/发卡平台/爱发电出售。
3. 用户在扩展内「登录 → 输入兑换码」即可激活会员、开启云同步。

## 路线（下一步）
- [ ] extension：登录/注册 UI、会员状态、云同步（上传/下载/合并）、兑换码输入。
- [ ] 失效自动监控 + 提醒（服务器定时任务）。
- [ ] 同步冲突合并策略（按 updated_at + 按 key 合并）。

## 安全提醒
- `JWT_SECRET` / `ADMIN_KEY` 用强随机值，勿提交到仓库。
- 仅 HTTPS 对外，避免明文传密码。
- 这是 MVP，上线前建议加：限流、邮箱验证、找回密码。
