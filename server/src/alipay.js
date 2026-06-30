"use strict";
/**
 * alipay.js — 支付宝封装（当面付扫码 + 电脑网站支付 + 查单/验签）
 * 当前购买流程使用「当面付」(alipay.trade.precreate) 生成二维码，个体工商户即可使用。
 * 需要环境变量：ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY(应用私钥,PKCS8), ALIPAY_PUBLIC_KEY(支付宝公钥)
 * 未配置时 enabled() 返回 false，相关接口会提示"支付未配置"。
 */
let sdk = null;
let inited = false;

// 清洗密钥：去掉 PEM 头尾和所有空白，只留 base64 主体，交给 SDK 按 keyType 重新包装
function cleanKey(key) {
  return String(key || "")
    .replace(/-----BEGIN[^-]+-----/g, "")
    .replace(/-----END[^-]+-----/g, "")
    .replace(/\s+/g, "");
}

function init() {
  if (inited) return sdk;
  inited = true;
  const appId = process.env.ALIPAY_APP_ID;
  const privateKey = cleanKey(process.env.ALIPAY_PRIVATE_KEY);
  const alipayPublicKey = cleanKey(process.env.ALIPAY_PUBLIC_KEY);
  if (!appId || !privateKey || !alipayPublicKey) { sdk = null; return null; }
  const mod = require("alipay-sdk");
  const AlipaySdk = mod.default || mod.AlipaySdk || mod;
  sdk = new AlipaySdk({
    appId: appId,
    privateKey: privateKey,
    alipayPublicKey: alipayPublicKey,
    gateway: process.env.ALIPAY_GATEWAY || "https://openapi.alipay.com/gateway.do",
    signType: "RSA2",
    keyType: "PKCS8"
  });
  return sdk;
}

module.exports = {
  enabled: function () { return !!init(); },
  // 生成电脑网站支付跳转 URL（需签约"电脑网站支付"，个体户/个人多数不可用）
  pagePayUrl: function (opts) {
    const s = init();
    if (!s) throw new Error("支付未配置");
    return s.pageExec("alipay.trade.page.pay", {
      method: "GET",
      notify_url: opts.notifyUrl,
      return_url: opts.returnUrl,
      bizContent: {
        out_trade_no: opts.outTradeNo,
        total_amount: opts.amount,
        subject: opts.subject,
        product_code: "FAST_INSTANT_TRADE_PAY"
      }
    });
  },
  // 当面付-预下单：返回二维码内容(URL)，前端渲染成二维码供用户扫码支付
  precreateQr: async function (opts) {
    const s = init();
    if (!s) throw new Error("支付未配置");
    const r = await s.exec("alipay.trade.precreate", {
      notify_url: opts.notifyUrl,
      bizContent: {
        out_trade_no: opts.outTradeNo,
        total_amount: opts.amount,
        subject: opts.subject
      }
    });
    const code = r && (r.code || r.Code);
    if (code && String(code) !== "10000")
      throw new Error((r.subMsg || r.sub_msg || r.msg || "预下单失败") + "(" + code + ")");
    const qr = r && (r.qrCode || r.qr_code);
    if (!qr) throw new Error("未返回二维码");
    return qr;
  },
  // 主动查单：返回交易状态字符串（WAIT_BUYER_PAY/TRADE_SUCCESS/TRADE_FINISHED/TRADE_CLOSED）
  queryTrade: async function (outTradeNo) {
    const s = init();
    if (!s) return null;
    try {
      const r = await s.exec("alipay.trade.query", {
        bizContent: { out_trade_no: outTradeNo }
      });
      return {
        tradeStatus: r && (r.tradeStatus || r.trade_status) || "",
        tradeNo: r && (r.tradeNo || r.trade_no) || ""
      };
    } catch (e) {
      return null;
    }
  },
  // 校验异步通知签名
  verifyNotify: function (params) {
    const s = init();
    if (!s) return false;
    try { return s.checkNotifySign(params); } catch (e) { return false; }
  }
};
