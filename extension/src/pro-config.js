/**
 * pro-config.js — Pro 后端地址配置
 * 部署后端后，把 apiBase 改成你的服务器地址（建议用 https）。
 * 本地联调用 http://localhost:8787
 */
(function (root) {
  root.PanGrabProConfig = {
    apiBase: "https://api.kpl.us.kg"
  };
})(typeof self !== "undefined" ? self : this);
