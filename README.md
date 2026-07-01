# PanGrab Pro（网盘抓手 · 会员版）

一款 Chrome 扩展（Manifest V3）：**自动识别网页里的网盘分享链接**，一键收藏、分类管理、导出备份，并提供**多端云同步**等会员能力。界面支持**中 / 英 / 繁**三语自动切换。

免费版是纯本地工具；Pro 卖的是**服务器侧、不可破解**的云端能力。客户端做"限次数/会员校验"易被破解（代码在用户本地），所以会员能力（云同步等）由后端校验，数据放服务器，不开会员拿不到。

---

## ✨ 功能一览

### 链接识别与收藏
- **自动识别 27 家网盘**分享链接：百度、阿里、夸克、迅雷、115、天翼、123、UC、城通、微云、蓝奏、移动云，以及 MEGA、Google Drive、Dropbox、OneDrive、TeraBox、MediaFire、Box、pCloud、WeTransfer、Yandex、Proton Drive、iCloud、Gofile、4shared、1fichier
- **自动抓取提取码**（标签式 `提取码:xxxx` 与 URL 内嵌 `?pwd=xxxx`）
- **累积式扫描**：支持推特/微博等虚拟滚动页面，滑出屏幕的链接不丢失
- 页面角标显示当前页链接数；右键菜单「收藏此网盘链接」
- 智能标题识别、截断链接检测与前缀去重

### 收藏管理页
- 搜索、按网盘/分类筛选、多种排序
- **分类、标签、备注、标题**编辑；批量归类/删除
- **导出** JSON / CSV / TXT
- **失效检测**：联网批量检查链接是否已失效，可一键清理死链
- 清理格式无效/残缺链接

### 会员（Pro）能力
- **多端云同步**：收藏与分类跨设备合并，可手动上传/下载，或每 30 分钟自动同步
- **导入备份**（换设备迁移、恢复）
- 解锁免费版限制（见下）

### 免费版限制
| 项目 | 免费版上限 |
|------|-----------|
| 收藏条数 | 100 条 |
| 自定义分类 | 3 个 |
| 每日失效检测 | 3 次 |

### 国际化（i18n）
- 界面按浏览器语言自动切换：**简体中文 / 繁体中文 / English**
- 扩展用 Chrome 官方 `_locales` 机制；购买页用内置字典

### 变现
- **兑换码**：管理员生成卡密，在闲鱼/发卡平台/爱发电出售，用户在扩展内输码激活
- **在线购买**：按地区自动选择支付渠道
  - 中国大陆 → **支付宝当面付**（人民币扫码）
  - 台湾/香港/海外 → **Lemon Squeezy**（信用卡/PayPal，本地货币结算，需在后端配置）

---

## 📁 目录结构
```
pangrab-pro/
├── extension/                 Chrome MV3 扩展
│   ├── manifest.json
│   ├── _locales/              i18n 语言包（en / zh_CN / zh_TW）
│   ├── icons/
│   └── src/
│       ├── i18n.js            i18n 运行时（HTML data-i18n 自动填充 + t() 取词）
│       ├── detector.js        网盘识别核心库（27 家规则 + 提取码/标题）
│       ├── content.js         内容脚本（页面扫描累积）
│       ├── background.js       Service Worker（角标/右键/存储/失效检测）
│       ├── pro-config.js       后端地址配置
│       ├── pro-state.js        会员门控（限额/缓存/用量）
│       ├── api.js              后端 API 封装
│       ├── popup/              弹窗（检测结果 + 一键收藏）
│       └── options/            收藏管理页 + 账号/云同步面板(pro.js)
└── server/                    Node + Express + SQLite 后端
    └── src/{index.js, db.js, alipay.js, lemonsqueezy.js, buy.html}
```

---

## 🔌 后端 API
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/register | 注册 {email,password} → token |
| POST | /api/login | 登录 → token |
| GET  | /api/me | 当前用户与会员状态 |
| GET  | /api/sync | 拉取云端收藏（**Pro**）|
| PUT  | /api/sync | 上传云端收藏（**Pro**）{payload}|
| POST | /api/redeem | 兑换码激活会员 {code} |
| POST | /api/admin/codes | 管理员发码（头 x-admin-key）{count,days} |
| GET  | /api/pay/providers | 可用支付渠道与套餐 |
| POST | /api/order/create | 创建订单 {plan,provider} → 二维码/跳转链接 |
| GET  | /api/order/status | 查询订单状态（前端轮询）|
| POST | /api/alipay/notify | 支付宝异步通知回调 |
| POST | /api/lemonsqueezy/webhook | Lemon Squeezy 支付回调 |
| GET  | /buy | 购买页（中英繁自适应）|
| GET  | /api/health | 健康检查 |

会员判定：`pro_until > 现在`。云同步接口对非会员返回 403 `NEED_PRO`。

---

## 🚀 本地运行（后端）
```bash
cd server
npm install
cp .env.example .env      # 填 JWT_SECRET / ADMIN_KEY，以及可选的支付配置
node src/index.js          # 默认 :8787
```

## 🧩 加载扩展（开发）
1. 打开 `chrome://extensions`，开启右上角「开发者模式」
2. 点「加载已解压的扩展程序」，选择本仓库的 `extension/` 目录
3. 如需连接自己的后端，改 `extension/src/pro-config.js` 的 `apiBase`

> 部署到服务器、配置支付宝 / Lemon Squeezy 的详细步骤见 [DEPLOY.md](./DEPLOY.md) 与 `server/.env.example`。

---

## 💳 卖会员（兑换码流程）
```bash
curl -X POST https://你的域名/api/admin/codes \
  -H 'x-admin-key: 你的ADMIN_KEY' -H 'Content-Type: application/json' \
  -d '{"count":10,"days":30}'
```
生成的 `PG-XXXX` 卡密可在闲鱼/发卡平台/爱发电出售；用户在扩展内「登录 → 输入兑换码」即可激活会员、开启云同步。

---

## 🔒 安全提醒
- `JWT_SECRET` / `ADMIN_KEY` 用强随机值，勿提交到仓库（`.env` 已在 `.gitignore`）
- 仅 HTTPS 对外，避免明文传密码
- 支付密钥（支付宝私钥、Lemon Squeezy API Key/Webhook Secret）同样不要入库
- 这是 MVP，上线前建议加：限流、邮箱验证、找回密码
- SQLite 数据 `server/data.db` 请**定期备份**

---

## 🗺️ 路线（下一步）
- [ ] 失效链接自动监控 + 提醒（服务器定时巡检）
- [ ] 自动续费订阅（Lemon Squeezy subscription 事件）
- [ ] 更多语言包（日 / 韩等）
