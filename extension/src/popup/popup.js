/**
 * popup.js — 弹窗逻辑
 * 向当前标签页的 content script 请求「累积检测」到的链接，渲染列表，支持一键收藏。
 */
(function () {
  "use strict";

  var D = self.NetdiskDetector || {};

  var listEl = document.getElementById("list");
  var summaryEl = document.getElementById("summary");
  var bannerEl = document.getElementById("banner");
  var saveBtn = document.getElementById("saveSelected");
  var selectAllEl = document.getElementById("selectAll");
  var toastEl = document.getElementById("toast");

  var currentLinks = [];   // 当前页累积检测到的链接
  var savedKeys = {};      // 已收藏的 key 集合
  var selected = {};       // 用户勾选的 key 集合（跨刷新保留）
  var activeTabId = null;
  var maxInfo = { reachedMax: false, max: 1000 };

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }

  function getActiveTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        resolve(tabs && tabs[0]);
      });
    });
  }

  function sendToTab(tabId, msg) {
    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(tabId, msg, function (resp) {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(resp);
      });
    });
  }

  function sendToBg(msg) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(msg, function (resp) {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(resp);
      });
    });
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function updateBanner() {
    if (maxInfo.reachedMax) {
      bannerEl.hidden = false;
      bannerEl.textContent = t("popup_banner_max", maxInfo.max);
    } else {
      bannerEl.hidden = true;
    }
  }

  function render() {
    listEl.innerHTML = "";

    if (currentLinks.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = t("popup_empty");
      listEl.appendChild(empty);
      updateFooter();
      return;
    }

    currentLinks.forEach(function (link, i) {
      var isSaved = !!savedKeys[link.key];
      var isChecked = !isSaved && !!selected[link.key];
      var card = document.createElement("div");
      card.className = "card" + (isSaved ? " saved" : "");

      var codeHtml = link.code
        ? '<span class="code-chip">' + t("chip_code", escapeHtml(link.code)) + "</span>"
        : '<span class="code-chip none">' + t("chip_no_code") + "</span>";

      var suspectHtml = (link.suspect || (D.isLikelyTruncated && D.isLikelyTruncated(link.url)))
        ? '<span class="suspect-chip" title="' + escapeHtml(t("chip_suspect_title")) + '">' + t("chip_suspect") + "</span>"
        : "";

      card.innerHTML =
        '<input type="checkbox" data-i="' + i + '"' + (isSaved ? " disabled" : (isChecked ? " checked" : "")) + " />" +
        '<div class="card-body">' +
          '<div class="card-top">' +
            '<span class="badge" style="background:' + link.providerColor + '">' + escapeHtml(link.providerName) + "</span>" +
            codeHtml +
            suspectHtml +
            (isSaved ? '<span class="saved-tag">' + t("chip_saved") + "</span>" : "") +
          "</div>" +
          '<div class="url"><a href="' + escapeHtml(link.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(link.url) + "</a></div>" +
        "</div>";
      listEl.appendChild(card);
    });

    Array.prototype.forEach.call(listEl.querySelectorAll('input[type="checkbox"]'), function (cb) {
      cb.addEventListener("change", function () {
        var link = currentLinks[parseInt(cb.getAttribute("data-i"), 10)];
        if (link) {
          if (cb.checked) selected[link.key] = true;
          else delete selected[link.key];
        }
        updateFooter();
      });
    });
    updateFooter();
    renderPromo();
    renderRecommend();
    renderFollow();
  }

  /* --------------------------- 资源推荐位（拉新） --------------------------- */
  var recCurrent = null;
  function renderRecommend() {
    var el = document.getElementById("recommend");
    if (!el) return;
    var P = promoConfig || self.PanGrabPromos;
    var r = P && P.recommend;
    if (!r || !r.enabled || !r.items || !r.items.length || currentLinks.length === 0) { el.hidden = true; return; }
    var valid = r.items.filter(function (i) { return i && i.url; });
    if (!valid.length) { el.hidden = true; return; }

    var pool;
    if (r.matchProvider === false) {
      // 不按网盘匹配：所有推荐一起随机轮播
      pool = valid;
    } else {
      // 方案1：按当前页出现最多的网盘，优先推对应网盘的资源（转化更高）
      var counts = {}, topP = null, max = 0;
      currentLinks.forEach(function (l) {
        counts[l.providerId] = (counts[l.providerId] || 0) + 1;
        if (counts[l.providerId] > max) { max = counts[l.providerId]; topP = l.providerId; }
      });
      var matched = valid.filter(function (i) { return i.provider && i.provider === topP; });
      var general = valid.filter(function (i) { return !i.provider; }); // 未标 provider 的通用推荐
      pool = matched.length ? matched : (general.length ? general : valid);
    }

    var pick = r.rotate ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
    recCurrent = pick;
    document.getElementById("recLabel").textContent = r.label || t("rec_label_default");
    var a = document.getElementById("recLink");
    a.textContent = pick.title || t("rec_view");
    a.href = withUtm(pick.url, "recommend");
    document.getElementById("recRefresh").style.display = pool.length > 1 ? "" : "none";
    el.hidden = false;
  }

  /* ----------------------------- 推广位 ----------------------------- */
  var promoDismissed = false;
  var promoConfig = self.PanGrabPromos || null;
  var currentPromoProvider = null;

  // 拉取远程配置（可选）：成功则覆盖本地配置，缓存 6 小时
  function loadPromoConfig() {
    var base = self.PanGrabPromos;
    if (!base || !base.remoteConfigUrl) { promoConfig = base; return; }
    chrome.storage.local.get(["promoCache"], function (res) {
      var cache = res && res.promoCache;
      // 先用缓存快速渲染（若有），避免等待
      if (cache && cache.url === base.remoteConfigUrl && cache.data) {
        promoConfig = mergePromo(base, cache.data);
        renderPromo(); renderRecommend(); renderFollow();
      }
      // 每次都后台拉最新（带缓存击穿），改了配置即时生效
      var bust = base.remoteConfigUrl + (base.remoteConfigUrl.indexOf("?") === -1 ? "?" : "&") + "_t=" + Date.now();
      fetch(bust, { credentials: "omit", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          promoConfig = mergePromo(base, data);
          chrome.storage.local.set({ promoCache: { url: base.remoteConfigUrl, at: Date.now(), data: data } });
          renderPromo(); renderRecommend(); renderFollow();
        })
        .catch(function () { if (!promoConfig) promoConfig = base; });
    });
  }
  function ensureHttp(url) {
    if (!url) return url;
    return /^https?:\/\//i.test(url) ? url : "https://" + url;
  }
  function mergePromo(base, remote) {
    if (!remote || typeof remote !== "object") return base;
    var merged = {
      enabled: remote.enabled != null ? remote.enabled : base.enabled,
      utm: remote.utm || base.utm,
      items: {},
      recommend: remote.recommend || base.recommend,
      follow: remote.follow || base.follow
    };
    Object.keys(base.items).forEach(function (k) { merged.items[k] = base.items[k]; });
    if (remote.items) Object.keys(remote.items).forEach(function (k) { merged.items[k] = remote.items[k]; });
    return merged;
  }
  function withUtm(url, providerId) {
    url = ensureHttp(url);
    if (!url) return url;
    var p = promoConfig && promoConfig.utm;
    var tag = (p ? p : "") + (p ? "&" : "") + "pg_pid=" + encodeURIComponent(providerId || "");
    return url + (url.indexOf("?") === -1 ? "?" : "&") + tag;
  }

  function renderPromo() {
    var el = document.getElementById("promo");
    if (!el) return;
    var P = promoConfig;
    if (promoDismissed || !P || !P.enabled || currentLinks.length === 0) { el.hidden = true; return; }
    var counts = {}, top = null, max = 0;
    currentLinks.forEach(function (l) {
      counts[l.providerId] = (counts[l.providerId] || 0) + 1;
      if (counts[l.providerId] > max) { max = counts[l.providerId]; top = l.providerId; }
    });
    var item = (P.items && (P.items[top] || P.items._default)) || null;
    if (!item || !item.url) { el.hidden = true; return; }
    currentPromoProvider = (P.items[top] && P.items[top].url) ? top : "_default";
    var a = document.getElementById("promoLink");
    a.textContent = item.text || t("promo_default_text");
    a.href = withUtm(item.url, currentPromoProvider);
    el.hidden = false;
  }

  function getCheckedLinks() {
    return currentLinks.filter(function (l) { return !savedKeys[l.key] && selected[l.key]; });
  }

  function updateFooter() {
    var n = getCheckedLinks().length;
    saveBtn.textContent = t("popup_save_selected", n);
    saveBtn.disabled = n === 0;
    // 同步全选框状态
    var selectable = currentLinks.filter(function (l) { return !savedKeys[l.key]; });
    selectAllEl.checked = selectable.length > 0 && n === selectable.length;
  }

  function applyResp(resp) {
    currentLinks = (resp && resp.links) || [];
    if (resp) maxInfo = { reachedMax: !!resp.reachedMax, max: resp.max || 1000 };
    var savedCount = currentLinks.filter(function (l) { return savedKeys[l.key]; }).length;
    summaryEl.textContent = currentLinks.length > 0
      ? (savedCount ? t("popup_summary_found_saved", currentLinks.length, savedCount) : t("popup_summary_found", currentLinks.length))
      : t("popup_summary_none");
    updateBanner();
    render();
  }

  async function init() {
    var tab = await getActiveTab();
    activeTabId = tab && tab.id;
    var savedResp = await sendToBg({ type: "GET_SAVED" });
    if (savedResp && savedResp.links) {
      savedResp.links.forEach(function (l) { savedKeys[l.key] = true; });
    }

    if (!activeTabId || /^(chrome|edge|about|chrome-extension):/i.test((tab && tab.url) || "")) {
      applyResp({ links: [] });
      summaryEl.textContent = t("popup_summary_unsupported");
      return;
    }

    var resp = await sendToTab(activeTabId, { type: "GET_PAGE_LINKS" });
    if (!resp) {
      // content script 可能未注入（页面尚未刷新），尝试动态注入后重试
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          files: ["src/detector.js", "src/content.js"]
        });
        resp = await sendToTab(activeTabId, { type: "GET_PAGE_LINKS" });
      } catch (e) { /* ignore */ }
    }
    applyResp(resp);
  }

  saveBtn.addEventListener("click", async function () {
    var toSave = getCheckedLinks();
    if (toSave.length === 0) return;
    var result = await sendToBg({ type: "SAVE_LINKS", links: toSave });
    if (!result) return;
    // 重新同步已收藏集合（免费上限可能导致部分未保存）
    var savedResp = await sendToBg({ type: "GET_SAVED" });
    savedKeys = {};
    if (savedResp && savedResp.links) savedResp.links.forEach(function (l) { savedKeys[l.key] = true; });
    Object.keys(selected).forEach(function (k) { if (savedKeys[k]) delete selected[k]; });
    render();
    if (result.limitReached && result.added === 0) {
      toast(t("popup_toast_limit_only", result.max));
    } else if (result.limitReached) {
      toast(t("popup_toast_limit_partial", result.added, result.max));
    } else {
      toast(result.skipped ? t("popup_toast_saved_skipped", result.added, result.skipped) : t("popup_toast_saved", result.added));
    }
  });

  selectAllEl.addEventListener("change", function () {
    var checked = selectAllEl.checked;
    currentLinks.forEach(function (l) {
      if (savedKeys[l.key]) return;
      if (checked) selected[l.key] = true;
      else delete selected[l.key];
    });
    render();
  });

  document.getElementById("rescan").addEventListener("click", function () {
    summaryEl.textContent = t("popup_summary_rescanning");
    init();
  });

  document.getElementById("resetScan").addEventListener("click", async function () {
    if (!activeTabId) return;
    await sendToTab(activeTabId, { type: "RESET_PAGE_LINKS" });
    selected = {};
    toast(t("popup_toast_reset"));
    init();
  });

  document.getElementById("openManager").addEventListener("click", function () {
    chrome.runtime.openOptionsPage();
  });

  // 「更多资源·关注频道」导流位（按钮，点击打开频道；支持远程配置）
  var followBtnEl = document.getElementById("followBtn");
  if (followBtnEl) {
    followBtnEl.addEventListener("click", function () {
      var f = ((promoConfig || self.PanGrabPromos) || {}).follow || {};
      var url = (f.tg && f.tg.url) || (f.mp && f.mp.url) || "";
      if (url) window.open(ensureHttp(url), "_blank", "noreferrer");
      else chrome.runtime.openOptionsPage(); // 只有公众号二维码时，去管理页看
    });
  }
  function renderFollow() {
    if (!followBtnEl) return;
    var f = ((promoConfig || self.PanGrabPromos) || {}).follow;
    var show = !!(f && f.enabled && ((f.tg && f.tg.url) || (f.mp && (f.mp.url || f.mp.qr))));
    followBtnEl.hidden = !show;
  }

  document.getElementById("promoClose").addEventListener("click", function () {
    promoDismissed = true;
    var el = document.getElementById("promo");
    if (el) el.hidden = true;
  });

  // 推广位点击统计（本地记录，方便你看哪个网盘转化好）
  document.getElementById("promoLink").addEventListener("click", function () {
    var pid = currentPromoProvider || "_default";
    chrome.storage.local.get(["promoClicks"], function (res) {
      var c = (res && res.promoClicks) || {};
      c[pid] = (c[pid] || 0) + 1;
      c._total = (c._total || 0) + 1;
      chrome.storage.local.set({ promoClicks: c });
    });
  });

  // 资源推荐位：换一个 + 点击统计
  document.getElementById("recRefresh").addEventListener("click", function (e) {
    e.preventDefault();
    renderRecommend();
  });
  document.getElementById("recLink").addEventListener("click", function () {
    chrome.storage.local.get(["recClicks"], function (res) {
      var c = (res && res.recClicks) || {};
      var key = (recCurrent && (recCurrent.title || recCurrent.url)) || "_";
      c[key] = (c[key] || 0) + 1;
      c._total = (c._total || 0) + 1;
      chrome.storage.local.set({ recClicks: c });
    });
  });

  // 实时联动：content 在滚动/页面变化时会广播 PAGE_LINKS_FOUND，
  // 弹窗据此自动刷新列表（已勾选项通过 selected 保留，不会丢失）。
  var liveRefreshTimer = null;
  chrome.runtime.onMessage.addListener(function (msg, sender) {
    if (!msg || msg.type !== "PAGE_LINKS_FOUND") return;
    if (!sender.tab || sender.tab.id !== activeTabId) return;
    maxInfo = { reachedMax: !!msg.reachedMax, max: msg.max || 1000 };
    if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
    liveRefreshTimer = setTimeout(function () {
      sendToTab(activeTabId, { type: "GET_LINKS_CACHED" }).then(function (resp) {
        if (resp) applyResp(resp);
      });
    }, 300);
  });

  loadPromoConfig();
  init();
})();
