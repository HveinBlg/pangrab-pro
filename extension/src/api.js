/**
 * api.js — PanGrab Pro 后端 API 客户端
 * Token 存在 chrome.storage.local 的 pro_token。
 */
(function (root) {
  "use strict";

  function base() {
    return (root.PanGrabProConfig && root.PanGrabProConfig.apiBase) || "http://localhost:8787";
  }
  function getToken() {
    return new Promise(function (r) {
      chrome.storage.local.get(["pro_token"], function (x) { r((x && x.pro_token) || ""); });
    });
  }
  function setToken(t) {
    return new Promise(function (r) { chrome.storage.local.set({ pro_token: t || "" }, r); });
  }
  function clearToken() { return setToken(""); }

  async function req(path, opts) {
    opts = opts || {};
    var headers = { "Content-Type": "application/json" };
    var token = await getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    var res, data;
    try {
      res = await fetch(base() + path, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) {
      throw new Error("无法连接服务器，请检查网络或后端地址");
    }
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) {
      var err = new Error(data.error || ("HTTP " + res.status));
      err.status = res.status; err.code = data.code;
      throw err;
    }
    return data;
  }

  root.ProAPI = {
    base: base,
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    register: function (email, password) { return req("/api/register", { method: "POST", body: { email: email, password: password } }); },
    login: function (email, password) { return req("/api/login", { method: "POST", body: { email: email, password: password } }); },
    me: function () { return req("/api/me"); },
    redeem: function (code) { return req("/api/redeem", { method: "POST", body: { code: code } }); },
    syncGet: function () { return req("/api/sync"); },
    syncPut: function (payload) { return req("/api/sync", { method: "PUT", body: { payload: payload } }); }
  };
})(typeof self !== "undefined" ? self : this);
