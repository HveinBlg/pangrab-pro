/**
 * background.js — MV3 service worker
 * 职责：
 * - 维护每个标签页的链接数量并显示在角标(badge)
 * - 提供右键菜单「收藏选中的网盘链接」
 * - 统一处理保存逻辑（写入 chrome.storage.local）
 */
importScripts("detector.js");

var D = self.NetdiskDetector;
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
 * 返回 { added, skipped }
 */
async function saveLinks(links) {
  var saved = await getSaved();
  var index = {};
  saved.forEach(function (l) { index[l.key] = true; });

  var added = 0, skipped = 0;
  links.forEach(function (l) {
    if (!l || !l.key) return;
    if (index[l.key]) { skipped++; return; }
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
  return { added: added, skipped: skipped, total: saved.length };
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
});

/* --------------------------- 链接失效检测 --------------------------- */

// 各网盘"失效/被删除/过期"页面常见提示词
var DEAD_KEYWORDS = /(来晚了)|(分享|文件|链接|页面|资源|内容)\s*.{0,8}(已?取消|失效|不存在|已?删除|被删除|已过期|过期了)|分享已(取消|过期|失效|关闭)|该(分享|链接|文件)\s*.{0,6}(不存在|已失效|已过期|已取消)|访问的页面不存在|页面不存在|expired|has been (deleted|cancell?ed|removed)|does\s?n['’]?t exist|not\s?found/i;

async function checkLink(url) {
  if (!url) return { state: "unknown", reason: "空链接" };
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 12000);
  try {
    var resp = await fetch(url, { method: "GET", redirect: "follow", credentials: "omit", signal: ctrl.signal });
    clearTimeout(timer);
    var status = resp.status;
    if (status === 404 || status === 410) return { state: "dead", reason: "HTTP " + status };
    var text = "";
    try { text = (await resp.text()).slice(0, 30000); } catch (e) { /* ignore */ }
    if (DEAD_KEYWORDS.test(text)) return { state: "dead", reason: "页面提示失效" };
    if (status >= 200 && status < 400) return { state: "alive", reason: "HTTP " + status };
    return { state: "unknown", reason: "HTTP " + status };
  } catch (e) {
    clearTimeout(timer);
    return { state: "unknown", reason: (e && e.name === "AbortError") ? "超时" : "请求失败" };
  }
}

/* ----------------------------- 右键菜单 ----------------------------- */

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: "save-netdisk-link",
    title: "收藏此网盘链接",
    contexts: ["link", "selection"]
  });
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
    notify("未识别到网盘链接", "选中的内容里没有可识别的网盘分享链接。");
    return;
  }

  var result = await saveLinks(links);
  notify(
    "已收藏 " + result.added + " 条链接",
    result.skipped > 0 ? "（" + result.skipped + " 条已存在，已跳过）" : "共 " + result.total + " 条收藏。"
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
