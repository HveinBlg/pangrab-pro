"use strict";
/**
 * alipay.js — 支付宝（电脑网站支付）封装
 * 需要环境变量：ALIPAY_APP_ID, ALIPAY_PRIVATE_KEY(应用私钥,PKCS8), ALIPAY_PUBLIC_KEY(支付宝公钥)
 * 未配置时 enabled() 返回 false，相关接口会提示"支付未配置"。
 */
let sdk = null;
let inited = false;

function init() {
  if (inited) return sdk;
  inited = true;
  const appId = process.env.ALIPAY_APP_ID;
  const privateKey = process.env.ALIPAY_PRIVATE_KEY;
  const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;
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
  // 生成电脑网站支付跳转 URL
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
  // 校验异步通知签名
  verifyNotify: function (params) {
    const s = init();
    if (!s) return false;
    try { return s.checkNotifySign(params); } catch (e) { return false; }
  }
};
