/**
 * folders.js — 番号库（独立页面）
 * 把磁力链接按「番号」(存于 category) 分组成文件夹；点文件夹进去看该番号下的所有磁链。
 * 数据来源：chrome.storage.local 的 savedLinks。
 */
(function () {
  "use strict";

  var STORE_KEY = "savedLinks";
  var all = [];          // 全部磁链
  var groups = {};        // 番号 -> [links]
  var current = null;     // 当前打开的番号（null = 文件夹网格）

  var el = function (id) { return document.getElementById(id); };
  var foldersView = el("foldersView"), detailView = el("detailView");
  var foldersEl = el("folders"), foldersEmpty = el("foldersEmpty");
  var linksEl = el("links"), crumbEl = el("crumb"), searchEl = el("search"), toastEl = el("toast");

  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toast(t) { toastEl.textContent = t; toastEl.classList.add("show"); setTimeout(function () { toastEl.classList.remove("show"); }, 1600); }

  function load() {
    chrome.storage.local.get([STORE_KEY], function (res) {
      all = (res[STORE_KEY] || []).filter(function (l) { return l && l.providerId === "magnet"; });
      groups = {};
      all.forEach(function (l) {
        var code = l.category || "磁力链接";
        (groups[code] = groups[code] || []).push(l);
      });
      render();
    });
  }

  function render() {
    if (current && groups[current]) renderDetail(current);
    else { current = null; renderFolders(); }
  }

  function renderFolders() {
    foldersView.classList.remove("hide");
    detailView.classList.add("hide");
    crumbEl.textContent = "";
    var q = (searchEl.value || "").trim().toLowerCase();
    var codes = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b); })
      .filter(function (c) { return !q || c.toLowerCase().indexOf(q) !== -1; });

    if (codes.length === 0) { foldersEl.innerHTML = ""; foldersEmpty.classList.remove("hide"); return; }
    foldersEmpty.classList.add("hide");

    foldersEl.innerHTML = codes.map(function (code) {
      var list = groups[code];
      var cover = "";
      for (var i = 0; i < list.length; i++) { if (list[i].cover) { cover = list[i].cover; break; } }
      var thumb = cover
        ? '<img class="thumb" loading="lazy" referrerpolicy="no-referrer" src="' + esc(cover) + '" alt="" />'
        : '<div class="thumb ph">🎬</div>';
      return '<div class="folder" data-code="' + esc(code) + '">' + thumb +
        '<div class="meta"><div class="code">' + esc(code) + '</div>' +
        '<div class="cnt">' + t("folders_count", list.length) + "</div></div></div>";
    }).join("");

    Array.prototype.forEach.call(foldersEl.querySelectorAll(".folder"), function (node) {
      node.addEventListener("click", function () { current = node.getAttribute("data-code"); renderDetail(current); });
      var img = node.querySelector("img.thumb");
      if (img) img.addEventListener("error", function () {
        var ph = document.createElement("div"); ph.className = "thumb ph"; ph.textContent = "🎬";
        img.replaceWith(ph);
      });
    });
  }

  function renderDetail(code) {
    foldersView.classList.add("hide");
    detailView.classList.remove("hide");
    var list = groups[code] || [];
    crumbEl.innerHTML = esc(t("folders_title")) + " / <b>" + esc(code) + "</b> · " + esc(t("folders_count", list.length));
    linksEl.innerHTML = list.map(function (l, i) {
      var cover = l.cover
        ? '<img class="lc-cover" loading="lazy" referrerpolicy="no-referrer" src="' + esc(l.cover) + '" alt="" />'
        : "";
      return '<div class="link-card" data-i="' + i + '">' + cover +
        '<div class="lc-body">' +
          '<div class="lc-title">' + esc(l.title || code) + "</div>" +
          '<div class="lc-url"><a href="' + esc(l.url) + '">' + esc(l.url) + "</a></div>" +
          '<button class="btn lc-copy" data-i="' + i + '">' + esc(t("item_copy")) + "</button>" +
        "</div></div>";
    }).join("");

    Array.prototype.forEach.call(linksEl.querySelectorAll(".lc-copy"), function (btn) {
      btn.addEventListener("click", function () {
        var l = list[parseInt(btn.getAttribute("data-i"), 10)];
        if (!l) return;
        navigator.clipboard.writeText(l.url).then(function () { toast(t("toast_copied")); });
      });
    });
    Array.prototype.forEach.call(linksEl.querySelectorAll(".lc-cover"), function (img) {
      img.addEventListener("error", function () { img.style.display = "none"; });
    });
  }

  el("backBtn").addEventListener("click", function () { current = null; renderFolders(); });
  searchEl.addEventListener("input", function () { if (!current) renderFolders(); });

  // 数据变化时自动刷新（在别处收藏了新磁链）
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && changes[STORE_KEY]) load();
  });

  load();
})();
