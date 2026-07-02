/**
 * background.js — MV3 service worker
 * 职责：
 * - 维护每个标签页的链接数量并显示在角标(badge)
 * - 提供右键菜单「收藏选中的网盘链接」
 * - 统一处理保存逻辑（写入 chrome.storage.local）
 */
importScripts("detector.js", "pro-config.js", "pro-state.js");

var D = self.NetdiskDetector;
var PRO = self.PanGrabPro;
var STORE_KEY = "savedLinks";

/* ----------------------------- 角标管理 ----------------------------- */

function setBadge(tabId, count, reachedMax) {
  if (typeof tabId !== "number") return;
  var text = "";
  if (count > 0) text = count > 999 ? "999+" : String(count);
  chrome.action.setBadgeText({ tabId: tabId, text: text });
  // 到达上限时变橙色，提醒用户先收藏
  chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: reachedMax ? "#ff8a00" : "#3d7fff" });
}

/* --------------------------- 存储读写工具 --------------------------- */

function getSaved() {
  return new Promise(function (resolve) {
    chrome.storage.local.get([STORE_KEY], function (res) {
      resolve(res[STORE_KEY] || []);
    });
  });
}

function setSaved(list) {
  return new Promise(function (resolve) {
    var obj = {};
    obj[STORE_KEY] = list;
    chrome.storage.local.set(obj, function () { resolve(); });
  });
}

/**
 * 保存一批链接，自动按 key 去重。
 * 免费版收藏上限 FREE_MAX_LINKS，超出不再写入并返回 limitReached。
 * 返回 { added, skipped, total, limitReached, max, is_pro }
 */
async function saveLinks(links) {
  var saved = await getSaved();
  var index = {};
  saved.forEach(function (l) { index[l.key] = true; });

  var isPro = await PRO.isProNow();
  var MAX = PRO.LIMITS.FREE_MAX_LINKS;

  var added = 0, skipped = 0, limitReached = false;
  links.forEach(function (l) {
    if (!l || !l.key) return;
    if (index[l.key]) { skipped++; return; }
    // 免费版：达到上限后不再写入
    if (!isPro && saved.length >= MAX) { limitReached = true; return; }
    index[l.key] = true;
    saved.push({
      key: l.key,
      providerId: l.providerId,
      providerName: l.providerName,
      providerColor: l.providerColor,
      url: l.url,
      code: l.code || "",
      title: l.title || l.sourceTitle || "",
      sourceUrl: l.sourceUrl || "",
      sourceTitle: l.sourceTitle || "",
      category: l.category || "未分类",
      tags: l.tags || [],
      note: l.note || "",
      suspect: !!l.suspect,
      savedAt: Date.now()
    });
    added++;
  });

  await setSaved(saved);
  return { added: added, skipped: skipped, total: saved.length, limitReached: limitReached, max: MAX, is_pro: isPro };
}

/* ------------------------------ 消息处理 ----------------------------- */

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg) return;

  if (msg.type === "PAGE_LINKS_FOUND") {
    var tabId = sender.tab && sender.tab.id;
    setBadge(tabId, msg.count || 0, !!msg.reachedMax);
    return;
  }

  if (msg.type === "SAVE_LINKS") {
    saveLinks(msg.links || []).then(function (result) {
      sendResponse(result);
    });
    return true; // 异步响应
  }

  if (msg.type === "GET_SAVED") {
    getSaved().then(function (list) { sendResponse({ links: list }); });
    return true;
  }

  if (msg.type === "SET_SAVED") {
    setSaved(msg.links || []).then(function () { sendResponse({ ok: true }); });
    return true;
  }

  if (msg.type === "CHECK_LINK") {
    checkLink(msg.url).then(function (r) { sendResponse(r); });
    return true; // 异步响应
  }

  if (msg.type === "AUTO_SYNC_NOW") {
    autoSyncIfEnabled().then(function () { sendResponse({ ok: true }); });
    return true;
  }
});

/* --------------------------- 链接失效检测 --------------------------- */

// 各网盘"失效/被删除/过期"页面常见提示词
var DEAD_KEYWORDS = /(来晚了)|(分享|文件|链接|页面|资源|内容)\s*.{0,8}(已?取消|失效|不存在|已?删除|被删除|已过期|过期了)|分享已(取消|过期|失效|关闭)|该(分享|链接|文件)\s*.{0,6}(不存在|已失效|已过期|已取消)|访问的页面不存在|页面不存在|expired|has been (deleted|cancell?ed|removed)|does\s?n['’]?t exist|not\s?found/i;

async function checkLink(url) {
  if (!url) return { state: "unknown", reason: chrome.i18n.getMessage("reason_empty") };
  if (!/^https?:\/\//i.test(url)) return { state: "unknown", reason: chrome.i18n.getMessage("reason_not_http") };
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 12000);
  try {
    var resp = await fetch(url, { method: "GET", redirect: "follow", credentials: "omit", signal: ctrl.signal });
    clearTimeout(timer);
    var status = resp.status;
    if (status === 404 || status === 410) return { state: "dead", reason: "HTTP " + status };
    var text = "";
    try { text = (await resp.text()).slice(0, 30000); } catch (e) { /* ignore */ }
    if (DEAD_KEYWORDS.test(text)) return { state: "dead", reason: chrome.i18n.getMessage("reason_dead_page") };
    if (status >= 200 && status < 400) return { state: "alive", reason: "HTTP " + status };
    return { state: "unknown", reason: "HTTP " + status };
  } catch (e) {
    clearTimeout(timer);
    return { state: "unknown", reason: (e && e.name === "AbortError") ? chrome.i18n.getMessage("reason_timeout") : chrome.i18n.getMessage("reason_failed") };
  }
}

/* ----------------------------- 右键菜单 ----------------------------- */

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: "save-netdisk-link",
    title: chrome.i18n.getMessage("bg_menu_save"),
    contexts: ["link", "selection"]
  });
  ensureAlarms();
  PRO.refreshFromServer();
});

chrome.runtime.onStartup.addListener(function () {
  ensureAlarms();
  PRO.refreshFromServer();
});

chrome.contextMenus.onClicked.addListener(async function (info, tab) {
  if (info.menuItemId !== "save-netdisk-link") return;

  var candidates = [];
  if (info.linkUrl) candidates.push(info.linkUrl);
  if (info.selectionText) {
    var fromText = D.extractLinksFromText(info.selectionText);
    fromText.forEach(function (f) { candidates.push(f.url); });
  }

  var links = [];
  candidates.forEach(function (raw) {
    var url = D.normalizeUrl(raw);
    var provider = D.matchProvider(url);
    if (!provider || !D.isShareLink(url)) return;
    var code = D.findCode(url, info.selectionText || "");
    links.push({
      key: D.dedupeKey(provider, url),
      providerId: provider.id,
      providerName: provider.name,
      providerColor: provider.color,
      url: url,
      code: code,
      sourceUrl: tab ? tab.url : "",
      sourceTitle: tab ? tab.title : ""
    });
  });

  if (links.length === 0) {
    notify(chrome.i18n.getMessage("bg_no_link_title"), chrome.i18n.getMessage("bg_no_link_msg"));
    return;
  }

  var result = await saveLinks(links);
  if (result.limitReached && result.added === 0) {
    notify(chrome.i18n.getMessage("bg_limit_title"), chrome.i18n.getMessage("bg_limit_msg", [String(result.max)]));
    return;
  }
  notify(
    chrome.i18n.getMessage("bg_saved_title", [String(result.added)]),
    (result.limitReached ? chrome.i18n.getMessage("bg_saved_limit_msg", [String(result.max)]) :
      (result.skipped > 0 ? chrome.i18n.getMessage("bg_saved_skipped_msg", [String(result.skipped)]) : chrome.i18n.getMessage("bg_saved_total_msg", [String(result.total)])))
  );
});

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: title,
      message: message
    });
  } catch (e) { /* ignore */ }
}

/* --------------------- 会员状态刷新 & 云端自动同步（Pro，功能E） --------------------- */

function ensureAlarms() {
  try { chrome.alarms.create("pg-sync", { periodInMinutes: 30, delayInMinutes: 1 }); } catch (e) { /* ignore */ }
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm && alarm.name === "pg-sync") {
    PRO.refreshFromServer().then(autoSyncIfEnabled);
  }
});

function getFlag(key) {
  return new Promise(function (r) { chrome.storage.local.get([key], function (x) { r(x && x[key]); }); });
}
function setLastSync(ts, ok) {
  chrome.storage.local.set({ last_sync: { at: ts, ok: !!ok } });
}

// 自动同步：开启开关 + Pro + 已登录时，与云端做并集合并（拉取→合并→回传，不删除任何一端数据）
async function autoSyncIfEnabled() {
  try {
    var on = await getFlag("auto_sync");
    if (!on) return;
    var isPro = await PRO.isProNow();
    if (!isPro) return;
    var token = await PRO.getToken();
    if (!token) return;
    var base = PRO.base();
    var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + token };

    // 拉取云端
    var getRes = await fetch(base + "/api/sync", { headers: headers });
    if (!getRes.ok) { setLastSync(Date.now(), false); return; }
    var cloud = (await getRes.json()).payload || { links: [], categories: [] };

    var local = await readLocalForSync();

    // 并集合并：链接按 key 去重，分类取并集
    var map = {};
    (local.links || []).forEach(function (l) { if (l && l.key) map[l.key] = l; });
    (cloud.links || []).forEach(function (l) { if (l && l.key && !map[l.key]) map[l.key] = l; });
    var mergedLinks = Object.keys(map).map(function (k) { return map[k]; });
    var catSet = {};
    (local.categories || []).concat(cloud.categories || []).forEach(function (c) { if (c) catSet[c] = true; });
    var mergedCats = Object.keys(catSet);

    // 写回本地（仅当有变化时）
    if (mergedLinks.length !== (local.links || []).length || mergedCats.length !== (local.categories || []).length) {
      await writeLocalForSync(mergedLinks, mergedCats);
    }
    // 回传云端，保持两端一致
    await fetch(base + "/api/sync", {
      method: "PUT", headers: headers,
      body: JSON.stringify({ payload: { links: mergedLinks, categories: mergedCats } })
    });
    setLastSync(Date.now(), true);
  } catch (e) {
    setLastSync(Date.now(), false);
  }
}

function readLocalForSync() {
  return new Promise(function (r) {
    chrome.storage.local.get([STORE_KEY, "categories"], function (x) {
      r({ links: (x && x[STORE_KEY]) || [], categories: (x && x.categories) || [] });
    });
  });
}
function writeLocalForSync(links, categories) {
  return new Promise(function (r) {
    chrome.storage.local.set({ savedLinks: links, categories: categories }, function () { r(); });
  });
}
