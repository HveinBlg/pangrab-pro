/**
 * pro-state.js — 会员门控公共层（service worker / popup / options 通用，无 DOM 依赖）
 *
 * 职责：
 * - 定义免费版各项限额（LIMITS）
 * - 缓存会员状态到 chrome.storage.local 的 pro_state（{is_pro, pro_until, at}），
 *   避免每次门控都请求后端
 * - 提供 isProNow() 同步判断（基于缓存的 pro_until 是否过期）
 * - refreshFromServer() 拉取 /api/me 刷新缓存（token 在 pro_token）
 *
 * 注意：门控只是产品层面的"功能区分"，并非安全边界——真正的付费能力（云同步）
 *       由后端校验；本地限额可被技术用户绕过，属可接受范围。
 */
(function (root) {
  "use strict";

  var LIMITS = {
    FREE_MAX_LINKS: 100,       // 免费版最多收藏条数
    FREE_MAX_CATEGORIES: 3,    // 免费版最多自定义分类数
    FREE_CHECK_PER_DAY: 3      // 免费版每天"检测失效"批次数
  };

  function base() {
    return (root.PanGrabProConfig && root.PanGrabProConfig.apiBase) || "";
  }

  function getToken() {
    return new Promise(function (r) {
      chrome.storage.local.get(["pro_token"], function (x) { r((x && x.pro_token) || ""); });
    });
  }

  function getState() {
    return new Promise(function (r) {
      chrome.storage.local.get(["pro_state"], function (x) { r((x && x.pro_state) || null); });
    });
  }

  // 用 user 对象（含 is_pro / pro_until）写入缓存
  function setState(user) {
    return new Promise(function (r) {
      var until = (user && user.pro_until) || 0;
      var s = {
        is_pro: !!(user && (user.is_pro || (until && until > Date.now()))),
        pro_until: until,
        email: (user && user.email) || "",
        at: Date.now()
      };
      chrome.storage.local.set({ pro_state: s }, function () { r(s); });
    });
  }

  function clearState() {
    return new Promise(function (r) { chrome.storage.local.remove(["pro_state"], function () { r(); }); });
  }

  // 基于缓存判断当前是否会员（pro_until 未过期）
  function isProNow() {
    return getState().then(function (s) {
      return !!(s && s.pro_until && s.pro_until > Date.now());
    });
  }

  // 从后端刷新会员状态到缓存；无 token 则清空
  async function refreshFromServer() {
    var token = await getToken();
    if (!token) { await clearState(); return null; }
    try {
      var res = await fetch(base() + "/api/me", { headers: { "Authorization": "Bearer " + token } });
      if (!res.ok) return null;
      var d = await res.json();
      if (d && d.user) return await setState(d.user);
    } catch (e) { /* 离线时沿用旧缓存 */ }
    return null;
  }

  /* ---------------- 每日用量计数（检测失效限制用） ---------------- */
  function todayKey() {
    var d = new Date(), p = function (n) { return n < 10 ? "0" + n : n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function getUsage(name) {
    return new Promise(function (r) {
      chrome.storage.local.get(["usage_" + name], function (x) {
        var u = x && x["usage_" + name];
        if (!u || u.date !== todayKey()) u = { date: todayKey(), count: 0 };
        r(u);
      });
    });
  }
  function bumpUsage(name) {
    return new Promise(function (r) {
      getUsage(name).then(function (u) {
        u.count++;
        var obj = {}; obj["usage_" + name] = u;
        chrome.storage.local.set(obj, function () { r(u); });
      });
    });
  }

  root.PanGrabPro = {
    LIMITS: LIMITS,
    base: base,
    getToken: getToken,
    getState: getState,
    setState: setState,
    clearState: clearState,
    isProNow: isProNow,
    refreshFromServer: refreshFromServer,
    getUsage: getUsage,
    bumpUsage: bumpUsage,
    todayKey: todayKey
  };
})(typeof self !== "undefined" ? self : this);
