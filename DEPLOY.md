# PanGrab Pro 后端部署指引

后端是一个 Node + SQLite 服务（默认监听 8787）。下面给两种方式，**方式 A 最适合你**（你已有服务器 + Lucky 反代）。

---

## 准备：把代码放到服务器
```bash
# 在你的服务器(VPS/GCP VM)上
git clone https://github.com/T7777520/pangrab-pro.git
cd pangrab-pro/server
# 装 Node 18+（若没装）：用 nvm 或系统包管理器
npm install
```

设置密钥（别用默认值）：
```bash
cp .env.example .env
# 编辑 .env，填强随机值：
# JWT_SECRET=用 openssl rand -hex 32 生成
# ADMIN_KEY=你的发码密钥
```
> 本服务会自动读取环境变量；若用 .env，可配合 PM2 的 env 或 `export $(cat .env|xargs)`。

---

## 方式 A：PM2 常驻 + Lucky 反代（推荐，你现成环境）

### 1. 用 PM2 让它常驻、开机自启、崩溃自重启
```bash
npm install -g pm2
cd pangrab-pro/server
JWT_SECRET=xxx ADMIN_KEY=yyy pm2 start src/index.js --name pgpro
pm2 save
pm2 startup      # 按提示执行它给出的命令
```
确认在跑：`curl http://127.0.0.1:8787/api/health` 应返回 `{"ok":true,...}`

### 2. 在 Lucky 加一条反代规则（加 HTTPS）
Lucky → Web服务 → 添加规则：
- 域名：用一个**子域名**，例如 `api.ktsla.eu.cc`
- 反向代理目标：`http://127.0.0.1:8787`
- 监听 443（Lucky 已在 443，HTTPS 由它/Cloudflare 处理）

### 3. Cloudflare 加该子域名解析
- 给 `api.ktsla.eu.cc` 加一条 A 记录指向你服务器 IP（可用 Lucky 的 DDNS）
- 代理建议**灰云(DNS only)** 或橙云(Full)，与你 Cloudreve 一致

### 4. 验证
浏览器/终端访问：`https://api.ktsla.eu.cc/api/health` → `{"ok":true}`

---

## 方式 B：Caddy 自动 HTTPS（全新机器最省心）
Caddy 自动申请 Let's Encrypt 证书。装好 Caddy 后，`Caddyfile`：
```
api.你的域名 {
    reverse_proxy localhost:8787
}
```
后端仍用 PM2 跑在 8787，Caddy 负责对外 443 + 自动证书。

---

## 方式 C：Docker
```bash
cd pangrab-pro
docker build -t pgpro -f server/Dockerfile .
docker run -d --name pgpro -p 8787:8787 \
  -e JWT_SECRET=xxx -e ADMIN_KEY=yyy \
  -v $PWD/pgpro-data:/app/data \
  -e DB_PATH=/app/data/data.db pgpro
```
再用 Lucky/Caddy/Nginx 反代到 8787 + HTTPS。

---

## 部署后：把扩展指向你的后端
改 `extension/src/pro-config.js`：
```js
self.PanGrabProConfig = { apiBase: "https://api.ktsla.eu.cc" };
```
重新加载扩展即可。

## 发兑换码（卖会员用）
```bash
curl -X POST https://api.ktsla.eu.cc/api/admin/codes \
  -H 'x-admin-key: 你的ADMIN_KEY' -H 'Content-Type: application/json' \
  -d '{"count":10,"days":30}'
```

## 防火墙
- GCP 放行 **443** 入站（你之前遇到的就是这个）
- 不要直接对外暴露 8787（让它只在 127.0.0.1，由反代转发）

## 数据备份（重要）
SQLite 数据在 `server/data.db`，定期备份：
```bash
cp data.db backup-$(date +%F).db    # 或加 cron 定时
```

## 安全建议
- `JWT_SECRET` / `ADMIN_KEY` 用强随机值，别提交到仓库（已在 .gitignore 忽略 .env）
- 仅 HTTPS 对外
- 后续可加：限流、邮箱验证、找回密码
