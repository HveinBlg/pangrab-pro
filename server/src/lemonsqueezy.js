"use strict";
/**
 * lemonsqueezy.js — Lemon Squeezy（国际支付 / Merchant of Record）封装
 *
 * 个人即可注册，全球多货币自动结算，各国税务由平台代缴。
 * 集成方式：用 API 创建托管收银台(checkout)，把自定义数据(订单号/用户/套餐)带过去；
 *           支付成功后 Lemon Squeezy 回调 webhook，我们用 HMAC-SHA256 验签后给账号加会员。
 *
 * 需要环境变量：
 *   LEMONSQUEEZY_API_KEY        — API 密钥（Settings → API）
 *   LEMONSQUEEZY_STORE_ID       — 店铺 ID
 *   LEMONSQUEEZY_WEBHOOK_SECRET — Webhook 签名密钥（创建 webhook 时自定义）
 *   LEMONSQUEEZY_VARIANT_MONTH / _QUARTER / _YEAR — 各套餐对应的商品变体 ID
 *
 * 未配置时 enabled() 返回 false，相关接口提示"未配置"。
 */
const crypto = require("crypto");

const API_BASE = "https://api.lemonsqueezy.com/v1";

function cfg() {
  return {
    apiKey: process.env.LEMONSQUEEZY_API_KEY || "",
    storeId: process.env.LEMONSQUEEZY_STORE_ID || "",
    webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "",
    variants: {
      month: process.env.LEMONSQUEEZY_VARIANT_MONTH || "",
      quarter: process.env.LEMONSQUEEZY_VARIANT_QUARTER || "",
      year: process.env.LEMONSQUEEZY_VARIANT_YEAR || ""
    }
  };
}

function enabled() {
  const c = cfg();
  return !!(c.apiKey && c.storeId);
}

// 某套餐是否已配置变体 ID
function variantFor(plan) {
  return cfg().variants[plan] || "";
}

/**
 * 创建托管收银台，返回支付页 URL。
 * opts: { plan, variantId, custom:{...}, redirectUrl }
 */
async function createCheckout(opts) {
  const c = cfg();
  if (!enabled()) throw new Error("国际支付未配置");
  const variantId = opts.variantId || variantFor(opts.plan);
  if (!variantId) throw new Error("该套餐未配置国际支付变体");

  const payload = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          custom: opts.custom || {}
        },
        product_options: opts.redirectUrl ? { redirect_url: opts.redirectUrl } : {}
      },
      relationships: {
        store: { data: { type: "stores", id: String(c.storeId) } },
        variant: { data: { type: "variants", id: String(variantId) } }
      }
    }
  };

  const res = await fetch(API_BASE + "/checkouts", {
    method: "POST",
    headers: {
      "Accept": "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      "Authorization": "Bearer " + c.apiKey
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.errors && data.errors[0] && data.errors[0].detail) || ("HTTP " + res.status);
    throw new Error("创建收银台失败：" + msg);
  }
  const url = data && data.data && data.data.attributes && data.data.attributes.url;
  if (!url) throw new Error("收银台返回缺少 URL");
  return url;
}

/**
 * 校验 webhook 签名。
 * rawBody: 原始请求体 Buffer；signature: X-Signature 头(hex)。
 */
function verifyWebhook(rawBody, signature) {
  const c = cfg();
  if (!c.webhookSecret || !rawBody || !signature) return false;
  try {
    const digest = crypto.createHmac("sha256", c.webhookSecret).update(rawBody).digest("hex");
    const a = Buffer.from(digest, "hex");
    const b = Buffer.from(String(signature), "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

module.exports = {
  enabled: enabled,
  variantFor: variantFor,
  createCheckout: createCheckout,
  verifyWebhook: verifyWebhook
};
