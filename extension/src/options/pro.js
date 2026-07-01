/**
 * pro.js — Pro 账号 / 云同步 UI（注入到收藏管理页）
 * 依赖：api.js (ProAPI)、pro-config.js
 * 同步后直接写 chrome.storage.local 的 savedLinks / categories，
 * options.js 的 storage.onChanged 监听会自动刷新界面。
 */
(function () {
  "use strict";
  if (!self.ProAPI) return;

  var STORE_KEY = "savedLinks";
  var CAT_KEY = "categories";
  var state = { user: null };

  /* ---------- 样式 ---------- */
  var style = document.createElement("style");
  style.textContent = [
    "#proModal .modal-card{max-width:420px}",
    ".pro-field{display:flex;flex-direction:column;gap:5px;font-size:13px;color:#7a869a;margin-bottom:10px}",
    ".pro-field input{padding:8px 10px;border:1px solid #e6eaf2;border-radius:8px;font-size:14px}",
    ".pro-row{display:flex;gap:8px;flex-wrap:wrap}",
    ".pro-btn{padding:8px 14px;border-radius:8px;border:none;cursor:pointer;font-size:13px}",
    ".pro-btn.primary{background:#3d7fff;color:#fff}",
    ".pro-btn.ghost{background:#f3f5fa;border:1px solid #e6eaf2;color:#1f2733}",
    ".pro-status{font-size:13px;padding:10px;border-radius:8px;background:#f3f8ff;margin-bottom:12px;line-height:1.6}",
    ".pro-badge{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;color:#fff}",
    ".pro-badge.on{background:#15a05b}.pro-badge.off{background:#7a869a}",
    ".pro-msg{font-size:12px;margin-top:8px;min-height:16px}",
    ".pro-msg.err{color:#cf1322}.pro-msg.ok{color:#15a05b}",
    ".pro-hr{border:none;border-top:1px solid #eef0f4;margin:14px 0}",
    ".pro-tabs{display:flex;gap:8px;margin-bottom:12px}",
    ".pro-tab{padding:6px 12px;border-radius:8px;cursor:pointer;font-size:13px;background:#f3f5fa}",
    ".pro-tab.active{background:#3d7fff;color:#fff}",
    // 自动同步：滑动开关
    ".pro-autosync{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;font-size:13px;color:#1f2733;cursor:pointer;user-select:none}",
    "#proModal .pro-autosync{flex-direction:row}",
    ".pro-autosync .pro-autosync-text{line-height:1.4;flex:1}",
    ".pg-switch{position:relative;display:inline-block;flex:0 0 auto;width:42px;height:24px}",
    ".pg-switch input{position:absolute;opacity:0;width:0;height:0;margin:0}",
    ".pg-switch .slider{position:absolute;inset:0;background:#cfd6e4;border-radius:999px;transition:background .22s ease}",
    ".pg-switch .slider::before{content:'';position:absolute;left:3px;top:3px;width:18px;height:18px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(16,24,40,.25);transition:transform .22s ease}",
    ".pg-switch input:checked + .slider{background:#3d7fff}",
    ".pg-switch input:checked + .slider::before{transform:translateX(18px)}",
    ".pg-switch input:focus-visible + .slider{box-shadow:0 0 0 3px rgba(61,127,255,.35)}",
    ".pg-switch input:disabled + .slider{opacity:.5;cursor:not-allowed}"
  ].join("");
  document.head.appendChild(style);

  /* ---------- 注入按钮 ---------- */
  var headerActions = document.querySelector(".top .actions") || document.querySelector(".actions");
  var btn = document.createElement("button");
  btn.className = "ghost";
  btn.id = "proAccountBtn";
  btn.textContent = "☁️ 账号 / 云同步";
  if (headerActions) headerActions.insertBefore(btn, headerActions.firstChild);

  /* ---------- 弹窗 ---------- */
  var modal = document.createElement("div");
  modal.id = "proModal";
  modal.className = "modal";
  modal.hidden = true;
  modal.innerHTML =
    '<div class="modal-card">' +
      '<button type="button" class="modal-close" id="proClose" aria-label="关闭">✕</button>' +
      '<h3>账号 / 云同步</h3>' +
      '<div id="proBody"></div>' +
      '<div class="pro-msg" id="proMsg"></div>' +
    "</div>";
  document.body.appendChild(modal);

  var body = modal.querySelector("#proBody");
  var msgEl = modal.querySelector("#proMsg");

  function msg(text, ok) { msgEl.textContent = text || ""; msgEl.className = "pro-msg " + (ok ? "ok" : "err"); }
  function open() { modal.hidden = false; refresh(); }
  function close() { modal.hidden = true; }

  btn.addEventListener("click", open);
  modal.querySelector("#proClose").addEventListener("click", close);
  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });

  /* ---------- 渲染 ---------- */
  async function refresh() {
    msg("");
    var token = await ProAPI.getToken();
    if (!token) { if (self.PanGrabPro) self.PanGrabPro.clearState(); renderAuth(); return; }
    try {
      var r = await ProAPI.me();
      state.user = r.user;
      if (self.PanGrabPro) self.PanGrabPro.setState(r.user); // 缓存会员状态供门控使用
      renderAccount();
    } catch (e) {
      await ProAPI.clearToken();
      if (self.PanGrabPro) self.PanGrabPro.clearState();
      renderAuth();
    }
  }

  function renderAuth() {
    body.innerHTML =
      '<div class="pro-tabs"><div class="pro-tab active" data-t="login">登录</div><div class="pro-tab" data-t="reg">注册</div></div>' +
      '<div class="pro-field"><label>邮箱</label><input id="proEmail" type="email" autocomplete="off" placeholder="you@example.com"/></div>' +
      '<div class="pro-field"><label>密码（至少6位）</label><input id="proPass" type="password" autocomplete="off" placeholder="••••••"/></div>' +
      '<div class="pro-row"><button class="pro-btn primary" id="proSubmit">登录</button></div>';
    var mode = "login";
    Array.prototype.forEach.call(body.querySelectorAll(".pro-tab"), function (t) {
      t.addEventListener("click", function () {
        body.querySelectorAll(".pro-tab").forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        mode = t.getAttribute("data-t");
        body.querySelector("#proSubmit").textContent = mode === "login" ? "登录" : "注册";
        msg("");
      });
    });
    body.querySelector("#proSubmit").addEventListener("click", async function () {
      var email = body.querySelector("#proEmail").value.trim();
      var pass = body.querySelector("#proPass").value;
      if (!email || !pass) { msg("请填写邮箱和密码"); return; }
      try {
        var r = mode === "login" ? await ProAPI.login(email, pass) : await ProAPI.register(email, pass);
        await ProAPI.setToken(r.token);
        state.user = r.user;
        if (self.PanGrabPro) self.PanGrabPro.setState(r.user);
        msg(mode === "login" ? "登录成功" : "注册成功", true);
        renderAccount();
      } catch (e) { msg(e.message || "失败"); }
    });
  }

  function fmtDate(ts) {
    if (!ts) return "-";
    var d = new Date(ts), p = function (n) { return n < 10 ? "0" + n : n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function renderLastSync() {
    var el = document.getElementById("proLastSync");
    if (!el) return;
    chrome.storage.local.get(["last_sync"], function (x) {
      var s = x && x.last_sync;
      if (!s || !s.at) { el.textContent = "尚未自动同步"; return; }
      var d = new Date(s.at), p = function (n) { return n < 10 ? "0" + n : n; };
      var t = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
      el.textContent = "上次自动同步：" + t + (s.ok ? "" : "（失败，将稍后重试）");
    });
  }

  function renderAccount() {
    var u = state.user || {};
    var proHtml = u.is_pro
      ? '<span class="pro-badge on">Pro 会员</span> 到期：' + fmtDate(u.pro_until)
      : '<span class="pro-badge off">免费用户</span>';
    body.innerHTML =
      '<div class="pro-status">' + (u.email || "") + "<br/>" + proHtml + "</div>" +
      '<div class="pro-field"><label>兑换码（激活/续期会员）</label>' +
        '<div class="pro-row"><input id="proCode" placeholder="PG-XXXXXXXX" style="flex:1"/>' +
        '<button class="pro-btn primary" id="proRedeem">兑换</button></div></div>' +
      '<div class="pro-row" style="margin-top:8px"><button class="pro-btn primary" id="proBuy" style="flex:1">💳 购买会员 / Upgrade to Pro</button></div>' +
      '<hr class="pro-hr"/>' +
      '<div style="font-size:13px;color:#1f2733;margin-bottom:8px;font-weight:600">云同步（Pro）</div>' +
      '<div class="pro-row">' +
        '<button class="pro-btn primary" id="proUpload">⬆ 上传到云端</button>' +
        '<button class="pro-btn ghost" id="proDownload">⬇ 从云端下载并合并</button>' +
      "</div>" +
      '<label class="pro-autosync">' +
        '<span class="pro-autosync-text">自动同步（每 30 分钟与云端合并，多设备保持一致）</span>' +
        '<span class="pg-switch"><input type="checkbox" id="proAutoSync"/><span class="slider"></span></span>' +
      "</label>" +
      '<div id="proLastSync" class="pro-lastsync" style="font-size:12px;color:#7a869a;margin-top:6px"></div>' +
      '<hr class="pro-hr"/>' +
      '<div class="pro-row"><button class="pro-btn ghost" id="proLogout">退出登录</button></div>';

    body.querySelector("#proRedeem").addEventListener("click", async function () {
      var code = body.querySelector("#proCode").value.trim();
      if (!code) { msg("请输入兑换码"); return; }
      try {
        var r = await ProAPI.redeem(code);
        state.user = r.user;
        if (self.PanGrabPro) self.PanGrabPro.setState(r.user);
        msg("激活成功，增加 " + r.added_days + " 天会员", true);
        renderAccount();
      } catch (e) { msg(e.message || "兑换失败"); }
    });
    body.querySelector("#proUpload").addEventListener("click", uploadSync);
    body.querySelector("#proDownload").addEventListener("click", downloadSync);

    // 自动同步开关 + 上次同步时间
    var autoChk = body.querySelector("#proAutoSync");
    if (autoChk) {
      chrome.storage.local.get(["auto_sync"], function (x) { autoChk.checked = !!(x && x.auto_sync); });
      autoChk.addEventListener("change", function () {
        if (autoChk.checked && !(state.user && state.user.is_pro)) {
          autoChk.checked = false;
          msg("自动同步需要 Pro 会员"); return;
        }
        chrome.storage.local.set({ auto_sync: autoChk.checked }, function () {
          if (autoChk.checked) {
            msg("已开启自动同步，正在同步…", true);
            chrome.runtime.sendMessage({ type: "AUTO_SYNC_NOW" }, function () { renderLastSync(); });
          } else {
            msg("已关闭自动同步", true);
          }
        });
      });
    }
    renderLastSync();
    body.querySelector("#proBuy").addEventListener("click", async function () {
      var token = await ProAPI.getToken();
      if (!token) { msg("请先登录后再购买"); return; }
      var url = ProAPI.base() + "/buy?token=" + encodeURIComponent(token);
      window.open(url, "_blank");
      msg("已打开购买页，完成支付后回到本面板重新打开即可刷新会员状态", true);
    });
    body.querySelector("#proLogout").addEventListener("click", async function () {
      await ProAPI.clearToken();
      if (self.PanGrabPro) self.PanGrabPro.clearState();
      state.user = null; renderAuth(); msg("已退出", true);
    });
  }

  /* ---------- 同步 ---------- */
  function readLocal() {
    return new Promise(function (r) {
      chrome.storage.local.get([STORE_KEY, CAT_KEY], function (x) {
        r({ links: (x && x[STORE_KEY]) || [], categories: (x && x[CAT_KEY]) || [] });
      });
    });
  }
  function writeLocal(links, categories) {
    return new Promise(function (r) {
      var obj = {}; obj[STORE_KEY] = links; obj[CAT_KEY] = categories;
      chrome.storage.local.set(obj, r);
    });
  }

  async function uploadSync() {
    try {
      var local = await readLocal();
      await ProAPI.syncPut({ links: local.links, categories: local.categories });
      msg("已上传到云端（" + local.links.length + " 条）", true);
    } catch (e) {
      msg(e.code === "NEED_PRO" ? "云同步需要 Pro 会员，请先兑换" : (e.message || "上传失败"));
    }
  }

  async function downloadSync() {
    try {
      var r = await ProAPI.syncGet();
      if (!r.payload) { msg("云端还没有数据，请先在某一端上传", true); return; }
      var cloud = r.payload;
      var local = await readLocal();
      // 合并：链接按 key 去重，分类取并集
      var map = {};
      (local.links || []).forEach(function (l) { if (l && l.key) map[l.key] = l; });
      (cloud.links || []).forEach(function (l) { if (l && l.key && !map[l.key]) map[l.key] = l; });
      var mergedLinks = Object.keys(map).map(function (k) { return map[k]; });
      var catSet = {};
      (local.categories || []).concat(cloud.categories || []).forEach(function (c) { if (c) catSet[c] = true; });
      var mergedCats = Object.keys(catSet);
      await writeLocal(mergedLinks, mergedCats); // storage.onChanged 会自动刷新界面
      msg("已合并云端数据，现在共 " + mergedLinks.length + " 条", true);
    } catch (e) {
      msg(e.code === "NEED_PRO" ? "云同步需要 Pro 会员，请先兑换" : (e.message || "下载失败"));
    }
  }
})();
