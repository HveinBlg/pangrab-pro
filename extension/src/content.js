/**
 * content.js
 * 注入到网页中，扫描 DOM 找出网盘链接并附带提取码，
 * 把结果上报给 background / popup。
 *
 * 采用「累积式」收集：页面滚动（尤其推特/微博等虚拟滚动页面会移除滑出屏幕的内容）时，
 * 已发现的链接会被记住、不丢失，直到用户主动「清空当前页检测」或刷新页面。
 */
(function () {
  "use strict";

  var D = self.NetdiskDetector;
  if (!D) return;

  // 单页累积上限，避免长时间滚动导致内存无限增长
  var MAX_LINKS = 1000;

  // 累积的链接： key -> linkObj（跨多次扫描累积，不在 scan 里清空）
  var seenLinks = {};
  var reachedMax = false;

  function linkCount() {
    return Object.keys(seenLinks).length;
  }

  // 标题是否为「兜底标题」（网盘名 或 网盘名+分享ID），用于判断是否需要升级
  function isFallbackTitle(title, provider) {
    if (!title) return true;
    if (!D.isMeaningfulTitle(title)) return true;
    return title === provider.name || title.indexOf(provider.name + " ") === 0;
  }

  /**
   * 当用户已经点进某个分享页时，取页面里的文件夹/文件名作为标题。
   * 1) 优先清洗 document.title（多数网盘分享页标题即资源名）
   * 2) 否则在 DOM 里找文件/文件夹名元素
   */
  function getSharePageTitle(url, provider) {
    var t = D.cleanTitle(document.title || "", url);
    if (D.isMeaningfulTitle(t) && t.length <= 60) return t;

    var sels = [
      '[class*="file-name"]', '[class*="fileName"]', '[class*="filename"]',
      '[class*="folder-name"]', '[class*="folderName"]',
      '[class*="share-title"]', '[class*="shareTitle"]',
      "h1", "h2", '[class*="title"]', '[class*="name"]'
    ];
    for (var i = 0; i < sels.length; i++) {
      var nodes;
      try { nodes = document.querySelectorAll(sels[i]); } catch (e) { continue; }
      for (var j = 0; j < nodes.length && j < 25; j++) {
        var txt = (nodes[j].textContent || "").trim();
        if (!txt || txt.length > 120) continue;
        var clean = D.cleanTitle(txt, url);
        if (D.isMeaningfulTitle(clean) && clean.length <= 60) return clean;
      }
    }
    return D.guessTitle(document.title || "", url, provider);
  }

  /**
   * 从一个 DOM 节点取得它附近的上下文文本（用于找提取码）。
   */
  function getContext(node) {
    var parts = [];
    var el = node;
    var hops = 0;
    while (el && hops < 3) {
      if (el.textContent) parts.push(el.textContent);
      el = el.parentElement;
      hops++;
    }
    if (node.nextSibling && node.nextSibling.textContent) {
      parts.push(node.nextSibling.textContent);
    }
    return parts.join("  ").slice(0, 500);
  }

  // 读取页面标准元信息(Open Graph / Twitter Card 等)——通用，不针对任何站点。
  // 用于给保存的链接附上封面图与简介。每次 scan 刷新一次。
  var pageMetaCache = { image: "", desc: "" };
  function metaContent(sel) {
    var el = document.querySelector(sel);
    return el ? (el.getAttribute("content") || "").trim() : "";
  }
  function pageMeta() {
    var image = metaContent('meta[property="og:image"]') || metaContent('meta[name="twitter:image"]') || metaContent('meta[itemprop="image"]');
    if (!image) image = largestImage(); // 保底：页面里最大的一张图
    var desc = metaContent('meta[property="og:description"]') || metaContent('meta[name="description"]') || metaContent('meta[name="twitter:description"]');
    if (image && !/^https?:\/\//i.test(image)) { try { image = new URL(image, location.href).href; } catch (e) { /* ignore */ } }
    if (desc && desc.length > 300) desc = desc.slice(0, 300);
    return { image: image || "", desc: desc || "" };
  }
  // 保底封面：取页面里渲染面积最大、且不太小的一张图（过滤图标/广告小图）
  function largestImage() {
    var imgs = document.images || [], best = "", bestArea = 0;
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      var w = im.naturalWidth || im.width || 0;
      var h = im.naturalHeight || im.height || 0;
      if (w < 200 || h < 200) continue;         // 跳过小图标
      if (w * h > bestArea) { bestArea = w * h; best = im.currentSrc || im.src || ""; }
    }
    return best;
  }
  // 就近文字：把磁链周围的上下文清洗成一段简介（去链接、去多余空白、限长）
  function cleanNearby(text) {
    var s = (text || "")
      .replace(/magnet:\?[^\s"'<>]+/gi, " ")     // 去磁链本身
      .replace(/https?:\/\/\S+/gi, " ")          // 去普通链接
      .replace(/\s+/g, " ")
      .trim();
    if (s.length > 80) s = s.slice(0, 80).trim(); // 精简，只留主要内容
    return s;
  }
  // 磁链简介：优先从文件名(dn)解析出「番号」，否则退回就近短文字
  function magnetDesc(url, ctx) {
    var dn = "";
    var m = /[?&]dn=([^&]+)/i.exec(url || "");
    if (m) { try { dn = decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (e) { dn = m[1]; } }
    var code = (dn.match(/[A-Za-z]{2,6}-\d{2,5}/) || dn.match(/[A-Za-z]{2,6}\d{2,5}/) || [])[0] || "";
    if (code) return "番号：" + code.toUpperCase();
    return cleanNearby(ctx);
  }

  function addLink(provider, rawUrl, codeContext, title, suspect) {
    var url = D.normalizeUrl(rawUrl);
    if (!url) return;
    var key = D.dedupeKey(provider, url);
    var code = D.findCode(url, codeContext);
    var sus = !!suspect || D.isLikelyTruncated(url); // 省略号截断 或 ID 明显偏短
    if (seenLinks[key]) {
      // 补全提取码 / 标题；若新来源更可信(非截断)则清除疑似标记
      if (!seenLinks[key].code && code) seenLinks[key].code = code;
      if (seenLinks[key].suspect && !sus) seenLinks[key].suspect = false;
      // 封面/简介：页面元信息可能异步加载，补全
      if (!seenLinks[key].cover && pageMetaCache.image) seenLinks[key].cover = pageMetaCache.image;
      if (provider.id === "magnet" && !seenLinks[key].desc) {
        var d2 = magnetDesc(url, codeContext);
        if (d2) seenLinks[key].desc = d2;
      }
      return;
    }
    // 达到上限后不再新增（已有的仍保留），并打标记提醒用户先保存
    if (linkCount() >= MAX_LINKS) {
      reachedMax = true;
      return;
    }
    seenLinks[key] = {
      key: key,
      providerId: provider.id,
      providerName: provider.name,
      providerColor: provider.color,
      url: url,
      code: code || "",
      title: title || D.guessTitle("", url, provider),
      suspect: sus,
      cover: pageMetaCache.image || "",
      desc: provider.id === "magnet" ? magnetDesc(url, codeContext) : "",
      sourceUrl: location.href,
      sourceTitle: document.title || "",
      foundAt: Date.now()
    };
  }

  /**
   * 扫描当前 DOM，把新发现的链接累积进 seenLinks。
   * 注意：不清空 seenLinks，保证滚动过程中已发现的链接不丢失。
   */
  function scan() {
    pageMetaCache = pageMeta(); // 每次扫描刷新页面封面/简介（页面可能异步加载）
    // 1) 锚点链接：从 href / title / aria-label 等多个来源找完整分享链接。
    //    推特等会把链接显示文字截断（如 .../s/1imuAdX_COuZ…），但完整链接常在这些属性里。
    var anchors = document.querySelectorAll("a[href]");
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var ctx = getContext(a) + "  " + (a.title || "") + "  " + (a.textContent || "");
      var cands = [
        a.href,
        a.getAttribute("title"),
        a.getAttribute("aria-label"),
        a.getAttribute("data-expanded-url"),
        a.getAttribute("data-full-url")
      ];
      for (var c = 0; c < cands.length; c++) {
        if (!cands[c]) continue;
        var found = D.extractLinksFromText(cands[c]);
        for (var f = 0; f < found.length; f++) {
          if (D.isShareLink(found[f].url)) {
            addLink(found[f].provider, found[f].url, ctx, D.guessTitle(ctx, found[f].url, found[f].provider));
          }
        }
      }
    }

    // 2) 文本中的裸链接（论坛/推特把链接当纯文本贴出来的情况，含无协议头）
    //    按文本顺序定位，把「提取码」「标题」的搜索范围限定在相邻两条链接之间，避免串味。
    var bodyText = document.body ? document.body.innerText : "";
    var ordered = D.extractLinksWithIndex(bodyText);
    var lastGoodTitle = "";   // 同一资源分享在多个网盘时，后续链接继承上方的资源名
    for (var k = 0; k < ordered.length; k++) {
      var item = ordered[k];
      var start = item.index;
      var end = item.index + item.url.length;
      var prevEnd = k > 0 ? ordered[k - 1].index + ordered[k - 1].url.length : 0;
      var nextStart = k < ordered.length - 1 ? ordered[k + 1].index : bodyText.length;

      // 检测是否被省略号截断（X/推特对超长链接的典型表现），截断的链接标记为「疑似不完整」
      var afterChar = bodyText.charAt(end);
      var suspect = (afterChar === "\u2026" || bodyText.substr(end, 3) === "...");

      var pre = bodyText.slice(prevEnd, start);                       // 链接前文字（资源名常在此）
      var post = bodyText.slice(end, Math.min(nextStart, end + 120)); // 链接后文字（提取码常在此）

      // 提取码：通常紧跟在链接之后，只在「本链接到下一条链接之间」找；
      // 首条链接额外允许看其之前的文字（个别"提取码 xxx 链接:"写法）。
      var codeCtx = post + (k === 0 ? "    " + pre : "");

      // 标题/资源名：取链接前的文字（剔除"夸克：""百度网盘：""链接"等标签，取上方资源名）。
      // 若本条前面只有标签、没有资源名（同一资源换盘的情况），则继承上一条的资源名。
      var rawTitle = D.cleanTitle(pre, item.url);
      var title;
      if (D.isMeaningfulTitle(rawTitle)) {
        title = rawTitle;
        lastGoodTitle = rawTitle;
      } else if (lastGoodTitle) {
        title = lastGoodTitle;
      } else {
        var sid = D.shareId(item.url);
        title = item.provider.name + (sid ? " " + sid : "");
      }
      addLink(item.provider, item.url, codeCtx, title, suspect);
    }

    // 3) 当前页地址本身（用户已点进某个分享页时，应能直接收藏，并取页面里的文件夹/文件名作标题）
    var selfLinks = D.extractLinksFromText(location.href);
    for (var s = 0; s < selfLinks.length; s++) {
      var self = selfLinks[s];
      var selfUrl = D.normalizeUrl(self.url);
      if (!selfUrl) continue;
      var selfKey = D.dedupeKey(self.provider, selfUrl);
      var selfTitle = getSharePageTitle(self.url, self.provider);
      if (seenLinks[selfKey]) {
        // 分享页内容可能异步加载，拿到更好的文件夹名时升级标题
        if (D.isMeaningfulTitle(selfTitle) && isFallbackTitle(seenLinks[selfKey].title, self.provider)) {
          seenLinks[selfKey].title = selfTitle;
        }
        continue;
      }
      var selfCtx = location.href + "  " + (document.title || "") + "  " + bodyText.slice(0, 200);
      addLink(self.provider, self.url, selfCtx, selfTitle);
    }

    dedupePrefixes();
    reportCount();
    return getList();
  }

  // 用于比较的规范化：去协议、去查询串/锚点、去尾斜杠、转小写
  function stripForCompare(url) {
    return (url || "").replace(/^https?:\/\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }

  /**
   * 前缀去重：若某条链接是另一条同网盘链接的真前缀（即被截断的残缺版），
   * 删除短的那条，并把它的提取码/标题补给完整版。
   */
  function dedupePrefixes() {
    var keys = Object.keys(seenLinks);
    for (var i = 0; i < keys.length; i++) {
      var a = seenLinks[keys[i]];
      if (!a) continue;
      if (a.providerId === "magnet") continue; // 磁链已按 btih 哈希去重，跳过前缀比对
      var ua = stripForCompare(a.url);
      for (var j = 0; j < keys.length; j++) {
        if (i === j) continue;
        var b = seenLinks[keys[j]];
        if (!b || a.providerId !== b.providerId) continue;
        var ub = stripForCompare(b.url);
        if (ua.length < ub.length && ub.indexOf(ua) === 0) {
          // a 是 b 的截断版：把 a 的提取码/标题补给 b，再删除 a
          if (!b.code && a.code) b.code = a.code;
          if (isFallbackTitle(b.title, { name: b.providerName }) && !isFallbackTitle(a.title, { name: a.providerName })) b.title = a.title;
          delete seenLinks[keys[i]];
          break;
        }
      }
    }
  }

  function getList() {
    var list = Object.keys(seenLinks).map(function (k) { return seenLinks[k]; });
    list.sort(function (a, b) {
      if (a.providerName !== b.providerName) return a.providerName.localeCompare(b.providerName);
      return a.foundAt - b.foundAt;
    });
    return list;
  }

  function reportCount() {
    try {
      chrome.runtime.sendMessage({
        type: "PAGE_LINKS_FOUND",
        count: linkCount(),
        reachedMax: reachedMax,
        max: MAX_LINKS
      });
    } catch (e) { /* 页面卸载时可能失败，忽略 */ }
  }

  function resetLinks() {
    seenLinks = {};
    reachedMax = false;
    reportCount();
  }

  // 首次扫描
  scan();

  // 页面动态变化时（SPA、异步加载、无限滚动）做去抖重扫，持续累积
  var rescanTimer = null;
  var observer = new MutationObserver(function () {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(scan, 600);
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // 与 popup 通信
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === "GET_PAGE_LINKS") {
      scan(); // 打开弹窗时先合并一次最新 DOM
      sendResponse({
        links: getList(),
        reachedMax: reachedMax,
        max: MAX_LINKS,
        pageTitle: document.title,
        pageUrl: location.href
      });
      return true;
    }
    if (msg.type === "GET_LINKS_CACHED") {
      // 只返回已累积的结果，不触发扫描/上报（供弹窗实时刷新用，避免消息循环）
      sendResponse({ links: getList(), reachedMax: reachedMax, max: MAX_LINKS });
      return true;
    }
    if (msg.type === "RESET_PAGE_LINKS") {
      resetLinks();
      sendResponse({ ok: true });
      return true;
    }
  });
})();
