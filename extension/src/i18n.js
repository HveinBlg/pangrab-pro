/**
 * i18n.js — 轻量国际化运行时（popup / options 通用）
 *
 * 用法：
 *  1) HTML 里给元素加属性，页面加载时自动填充：
 *     - data-i18n="key"        → 设置 textContent
 *     - data-i18n-html="key"   → 设置 innerHTML（用于含 <br/> 等的文案）
 *     - data-i18n-ph="key"     → 设置 placeholder
 *     - data-i18n-title="key"  → 设置 title 属性
 *     - data-i18n-label="key"  → 设置 aria-label 属性
 *     - <html data-i18n-doctitle="key"> → 设置 document.title
 *  2) JS 里用 t("key", sub1, sub2...) 取词（等价 chrome.i18n.getMessage）。
 *
 * 语言由浏览器 UI 语言决定（zh-CN → 中文，其它 → 英文，见 _locales）。
 */
(function (root) {
  "use strict";

  function t(key, subs) {
    if (!key) return "";
    var args = Array.prototype.slice.call(arguments, 1);
    // 支持 t(key, [a,b]) 或 t(key, a, b)
    var subsArr = (args.length === 1 && Object.prototype.toString.call(args[0]) === "[object Array]")
      ? args[0]
      : args;
    try {
      var msg = chrome.i18n.getMessage(key, subsArr.map(String));
      return msg || key;
    } catch (e) {
      return key;
    }
  }

  function applyTo(rootEl) {
    var scope = rootEl || document;

    function each(sel, fn) {
      Array.prototype.forEach.call(scope.querySelectorAll(sel), fn);
    }

    each("[data-i18n]", function (el) {
      var m = t(el.getAttribute("data-i18n"));
      if (m) el.textContent = m;
    });
    each("[data-i18n-html]", function (el) {
      var m = t(el.getAttribute("data-i18n-html"));
      if (m) el.innerHTML = m;
    });
    each("[data-i18n-ph]", function (el) {
      var m = t(el.getAttribute("data-i18n-ph"));
      if (m) el.setAttribute("placeholder", m);
    });
    each("[data-i18n-title]", function (el) {
      var m = t(el.getAttribute("data-i18n-title"));
      if (m) el.setAttribute("title", m);
    });
    each("[data-i18n-label]", function (el) {
      var m = t(el.getAttribute("data-i18n-label"));
      if (m) el.setAttribute("aria-label", m);
    });

    // 文档标题
    var docKey = document.documentElement.getAttribute("data-i18n-doctitle");
    if (docKey && !rootEl) {
      var dm = t(docKey);
      if (dm) document.title = dm;
    }
  }

  function ready() {
    // 反映真实界面语言到 <html lang>
    try {
      var lang = (chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || "";
      if (lang) document.documentElement.setAttribute("lang", lang);
    } catch (e) { /* ignore */ }
    applyTo(document);
  }

  root.i18n = { t: t, apply: applyTo };
  root.t = t;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})(typeof self !== "undefined" ? self : this);
