/**
 * promos.js — 推广位配置（变现用）
 *
 * 用法：把各网盘的 url 换成你从「拉新/推广平台」拿到的专属推广链接（带你的 PID）。
 * - url 为空 "" 时该推广位不显示（默认不打扰用户）。
 * - 弹窗按当前页出现最多的网盘显示对应推广，没有则用 _default。
 * - enabled = false 可一键全局关闭。
 *
 * 远程配置（可选）：把 remoteConfigUrl 设为你托管的一个 JSON 地址
 *   （内容形如 { "enabled": true, "items": { "quark": {"text":"...","url":"..."} } }），
 *   插件会自动拉取并覆盖下面的默认值——以后换活动/换链接无需重新发布扩展。
 *
 * 合规：推广位明确标注「推广」，仅引导正规会员/客户端，不要关联盗版资源。
 */
(function (root) {
  "use strict";
  root.PanGrabPromos = {
    enabled: true,
    remoteConfigUrl: "https://raw.githubusercontent.com/T7777520/pangrab-config/main/promos.json",
    utm: "utm_source=pangrab",      // 自动附加到推广链接，便于平台后台归因
    // 「资源推荐位」：放你自己的网盘分享链接(拉新链接)，用户点击打开你的分享=帮你拉新
    recommend: {
      enabled: true,
      label: "🎬 资源推荐",
      rotate: true,                 // true=每次打开随机展示一条
      items: [
        // 把下面换成你自己的网盘分享链接（开通了拉新的那种）
        // 可选 provider 字段(quark/baidu/xunlei/aliyun/uc/115/tianyi/mcloud)：页面是该网盘时优先推它
        // { title: "夸克 · 最新影视合集", url: "https://pan.quark.cn/s/你的分享", provider: "quark" },
        // { title: "迅雷 · 热门短剧", url: "https://pan.xunlei.com/s/你的分享", provider: "xunlei" }
      ]
    },
    // 「更多资源 · 关注频道」导流位（填了才显示）
    follow: {
      enabled: true,
      tg: { text: "Telegram 频道", url: "" },                 // 例如 https://t.me/your_channel
      mp: { text: "微信公众号：你的公众号名", url: "", qr: "" } // qr: 公众号二维码图片地址(可选)
    },
    items: {
      quark:   { text: "夸克网盘 · 开会员极速下载", url: "" },
      baidu:   { text: "百度网盘 · 开会员不限速", url: "" },
      xunlei:  { text: "迅雷云盘 · 会员加速下载", url: "" },
      aliyun:  { text: "阿里云盘 · 领会员福利", url: "" },
      uc:      { text: "UC网盘 · 会员加速", url: "" },
      "115":   { text: "115网盘 · 会员特惠", url: "" },
      tianyi:  { text: "天翼云盘 · 会员特惠", url: "" },
      mcloud:  { text: "移动云盘 · 会员特惠", url: "" },
      _default: { text: "网盘会员 · 限时优惠", url: "" }
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.PanGrabPromos;
})(typeof self !== "undefined" ? self : this);
