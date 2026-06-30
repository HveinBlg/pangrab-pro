/**
 * options.js — 收藏管理页面逻辑
 * 列表展示、搜索、按网盘/分类筛选、排序、编辑、复制、删除、批量操作、导入导出。
 * 下拉框使用自定义组件（.dd），原生 select 展开列表无法美化。
 */
(function () {
  "use strict";

  var D = self.NetdiskDetector;
  var all = [];               // 全部收藏
  var customCategories = [];  // 用户创建的分类（即使暂无链接也保留）
  var selectedKeys = {};      // 批量操作勾选的 key 集合
  var currentRows = [];       // 当前筛选/排序后展示的链接
  var editingKey = null;      // 当前编辑的链接 key
  var filterState = { provider: "", category: "", sort: "savedAt_desc" };
  var batchCategoryValue = "";

  var els = {
    grid: document.getElementById("grid"),
    stats: document.getElementById("stats"),
    empty: document.getElementById("emptyState"),
    search: document.getElementById("search"),
    toast: document.getElementById("toast"),
    batchSelectAll: document.getElementById("batchSelectAll"),
    batchCount: document.getElementById("batchCount"),
    batchActions: document.getElementById("batchActions"),
    batchApply: document.getElementById("batchApply"),
    batchDelete: document.getElementById("batchDelete"),
    batchClear: document.getElementById("batchClear"),
    modal: document.getElementById("editModal"),
    editTitle: document.getElementById("editTitle"),
    editCategory: document.getElementById("editCategory"),
    editTags: document.getElementById("editTags"),
    editCode: document.getElementById("editCode"),
    editNote: document.getElementById("editNote"),
    categoryList: document.getElementById("categoryList")
  };

  var ddProvider = document.getElementById("filterProvider");
  var ddCategory = document.getElementById("filterCategory");
  var ddSort = document.getElementById("sortBy");
  var ddBatch = document.getElementById("batchCategory");

  /* ----------------------------- 工具 ----------------------------- */

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    setTimeout(function () { els.toast.classList.remove("show"); }, 1800);
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
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

  function fmtDate(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    var p = function (n) { return n < 10 ? "0" + n : n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ---------------- 自定义对话框（替代原生 prompt / confirm） ---------------- */

  var dialogEl = document.getElementById("dialog");
  var dlgTitle = document.getElementById("dialogTitle");
  var dlgMessage = document.getElementById("dialogMessage");
  var dlgInput = document.getElementById("dialogInput");
  var dlgOk = document.getElementById("dialogOk");
  var dlgCancel = document.getElementById("dialogCancel");
  var dlgResolve = null;
  var dlgMode = "confirm";

  function closeDialog(result) {
    dialogEl.hidden = true;
    var r = dlgResolve;
    dlgResolve = null;
    if (r) r(result);
  }
  function showPrompt(title, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      dlgResolve = resolve; dlgMode = "prompt";
      dlgTitle.textContent = title;
      dlgMessage.hidden = true;
      dlgInput.hidden = false;
      dlgInput.placeholder = opts.placeholder || "";
      dlgInput.value = opts.value || "";
      dlgOk.textContent = "确定"; dlgOk.className = "primary";
      dialogEl.hidden = false;
      setTimeout(function () { dlgInput.focus(); dlgInput.select(); }, 30);
    });
  }
  function showConfirm(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      dlgResolve = resolve; dlgMode = "confirm";
      dlgTitle.textContent = opts.title || "请确认";
      dlgMessage.textContent = message; dlgMessage.hidden = false;
      dlgInput.hidden = true;
      dlgOk.textContent = opts.okText || "确定";
      dlgOk.className = opts.danger ? "primary danger-btn" : "primary";
      dialogEl.hidden = false;
      setTimeout(function () { dlgOk.focus(); }, 30);
    });
  }
  dlgOk.addEventListener("click", function () {
    if (dlgMode === "prompt") closeDialog(dlgInput.value.trim());
    else closeDialog(true);
  });
  dlgCancel.addEventListener("click", function () { closeDialog(dlgMode === "prompt" ? null : false); });
  dialogEl.addEventListener("click", function (e) { if (e.target === dialogEl) closeDialog(dlgMode === "prompt" ? null : false); });
  dlgInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); closeDialog(dlgInput.value.trim()); } });

  /* ---------------- 自定义下拉组件 ---------------- */

  function ddOptionsHtml(options, value) {
    return options.map(function (o) {
      return '<div class="dd-opt' + (o.value === value ? " sel" : "") + '" data-value="' + escapeHtml(o.value) + '">' + escapeHtml(o.label) + "</div>";
    }).join("");
  }
  function ddInner(value, options, placeholder) {
    var cur = null;
    for (var i = 0; i < options.length; i++) { if (options[i].value === value) { cur = options[i]; break; } }
    var label = cur ? cur.label : (placeholder || "");
    return '<span class="dd-label">' + escapeHtml(label) + '</span><span class="dd-caret"></span>' +
      '<div class="dd-menu" hidden>' + ddOptionsHtml(options, value) + "</div>";
  }
  function renderDD(container, value, options, placeholder) {
    container.setAttribute("data-value", value);
    if (!container.getAttribute("tabindex")) container.setAttribute("tabindex", "0");
    container.innerHTML = ddInner(value, options, placeholder);
  }
  function cardCatDD(current, key) {
    var options = [{ value: "未分类", label: "未分类" }]
      .concat(allCategories().map(function (c) { return { value: c, label: c }; }))
      .concat([{ value: "__new__", label: "＋ 新建分类…" }]);
    return '<div class="dd dd-cat" data-role="cat" data-key="' + escapeHtml(key) + '" data-value="' + escapeHtml(current) + '" tabindex="0">' +
      ddInner(current, options, "未分类") + "</div>";
  }

  function providerOptions() {
    var providers = {};
    all.forEach(function (l) { providers[l.providerId] = l.providerName; });
    var opts = [{ value: "", label: "全部网盘" }];
    Object.keys(providers).forEach(function (id) { opts.push({ value: id, label: providers[id] }); });
    return opts;
  }
  function categoryFilterOptions() {
    var opts = [{ value: "", label: "全部分类" }];
    allCategories().forEach(function (c) { opts.push({ value: c, label: c }); });
    if (all.some(function (l) { return !l.category || l.category === "未分类"; })) opts.push({ value: "未分类", label: "未分类" });
    return opts;
  }
  var SORT_OPTIONS = [
    { value: "savedAt_desc", label: "最近收藏" },
    { value: "savedAt_asc", label: "最早收藏" },
    { value: "provider", label: "按网盘" },
    { value: "category", label: "按分类" }
  ];
  function batchOptions() {
    return [{ value: "", label: "归类到…" }, { value: "未分类", label: "未分类" }]
      .concat(allCategories().map(function (c) { return { value: c, label: c }; }))
      .concat([{ value: "__new__", label: "＋ 新建分类…" }]);
  }

  // 全局委托：点击下拉框 / 选项 / 外部
  document.addEventListener("click", function (e) {
    var opt = e.target.closest ? e.target.closest(".dd-opt") : null;
    var dd = e.target.closest ? e.target.closest(".dd") : null;
    Array.prototype.forEach.call(document.querySelectorAll(".dd-menu"), function (m) {
      if (!dd || !dd.contains(m)) m.hidden = true;
    });
    if (opt && dd) { e.stopPropagation(); selectDD(dd, opt.getAttribute("data-value")); return; }
    if (dd) { var menu = dd.querySelector(".dd-menu"); if (menu) menu.hidden = !menu.hidden; }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      Array.prototype.forEach.call(document.querySelectorAll(".dd-menu"), function (m) { m.hidden = true; });
    }
  });

  function selectDD(dd, val) {
    var role = dd.getAttribute("data-role");
    var menu = dd.querySelector(".dd-menu"); if (menu) menu.hidden = true;

    if (role === "filterProvider") { filterState.provider = val; refreshFilters(); render(); return; }
    if (role === "filterCategory") { filterState.category = val; refreshFilters(); render(); return; }
    if (role === "sortBy") { filterState.sort = val; refreshFilters(); render(); return; }

    if (role === "batch") {
      if (val === "__new__") {
        showPrompt("新建分类", { placeholder: "如：电影 / 短剧 / 学习" }).then(function (name) {
          name = (name || "").trim();
          if (!name) return;
          addCategory(name); batchCategoryValue = name;
          saveCategories().then(function () { updateBatchBar(); });
        });
        return;
      }
      batchCategoryValue = val; updateBatchBar(); return;
    }

    if (role === "cat") {
      var key = dd.getAttribute("data-key");
      var l = findByKey(key);
      if (!l) return;
      if (val === "__new__") {
        showPrompt("输入新分类名称", { placeholder: "如：电影 / 短剧 / 学习" }).then(function (name) {
          name = (name || "").trim();
          if (!name) { render(); return; }
          addCategory(name); l.category = name;
          saveCategories().then(function () { persist().then(function () { refreshFilters(); render(); toast("已归类到「" + name + "」"); }); });
        });
        return;
      }
      l.category = val;
      persist().then(function () { refreshFilters(); render(); toast(val === "未分类" ? "已移出分类" : "已归类到「" + val + "」"); });
    }
  }

  /* ----------------------------- 数据 ----------------------------- */

  async function load() {
    var resp = await sendToBg({ type: "GET_SAVED" });
    all = (resp && resp.links) || [];
    customCategories = await loadCategories();
    refreshFilters();
    render();
  }
  async function persist() { await sendToBg({ type: "SET_SAVED", links: all }); }

  function loadCategories() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(["categories"], function (res) { resolve((res && res.categories) || []); });
    });
  }
  function saveCategories() {
    return new Promise(function (resolve) {
      chrome.storage.local.set({ categories: customCategories }, function () { resolve(); });
    });
  }
  function allCategories() {
    var set = {};
    customCategories.forEach(function (c) { if (c && c !== "未分类") set[c] = true; });
    all.forEach(function (l) { if (l.category && l.category !== "未分类") set[l.category] = true; });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, "zh"); });
  }
  function addCategory(name) {
    name = (name || "").trim();
    if (!name || name === "未分类") return false;
    if (customCategories.indexOf(name) === -1) customCategories.push(name);
    return true;
  }

  function refreshFilters() {
    renderDD(ddProvider, filterState.provider, providerOptions(), "全部网盘");
    renderDD(ddCategory, filterState.category, categoryFilterOptions(), "全部分类");
    renderDD(ddSort, filterState.sort, SORT_OPTIONS, "排序");
    els.categoryList.innerHTML = "";
    allCategories().forEach(function (c) {
      var d = document.createElement("option"); d.value = c; els.categoryList.appendChild(d);
    });
  }

  /* ------------------------------ 统计 / 列表 ------------------------------ */

  function renderStats() {
    var byProvider = {};
    all.forEach(function (l) {
      if (!byProvider[l.providerId]) byProvider[l.providerId] = { name: l.providerName, color: l.providerColor, n: 0 };
      byProvider[l.providerId].n++;
    });
    var html = '<div class="stat-chip"><b>' + all.length + "</b> 条收藏</div>";
    Object.keys(byProvider).forEach(function (id) {
      var p = byProvider[id];
      html += '<div class="stat-chip"><span class="stat-dot" style="background:' + p.color + '"></span>' + escapeHtml(p.name) + " <b>" + p.n + "</b></div>";
    });
    els.stats.innerHTML = html;
  }

  function getFiltered() {
    var q = els.search.value.trim().toLowerCase();
    var fp = filterState.provider, fc = filterState.category;
    var rows = all.filter(function (l) {
      if (fp && l.providerId !== fp) return false;
      if (fc && (l.category || "未分类") !== fc) return false;
      if (q) {
        var hay = [l.url, l.title, l.note, l.code, l.providerName, (l.tags || []).join(",")].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var sort = filterState.sort;
    rows.sort(function (a, b) {
      if (sort === "savedAt_asc") return (a.savedAt || 0) - (b.savedAt || 0);
      if (sort === "provider") return a.providerName.localeCompare(b.providerName);
      if (sort === "category") return (a.category || "").localeCompare(b.category || "");
      return (b.savedAt || 0) - (a.savedAt || 0);
    });
    return rows;
  }

  function render() {
    renderStats();
    var rows = getFiltered();
    currentRows = rows;

    if (all.length === 0) {
      els.grid.innerHTML = "";
      els.empty.hidden = false;
      updateBatchBar();
      return;
    }
    els.empty.hidden = true;

    els.grid.innerHTML = rows.map(function (l) {
      var tags = (l.tags || []).map(function (t) { return '<span class="tag">' + escapeHtml(t) + "</span>"; }).join("");
      // 已存旧数据若标题含推特噪音(@账号 / · 时间 等)，显示时再清理一次
      var dispTitle = l.title || "";
      if (/@[A-Za-z0-9_]{2,}|·\s*\d|短剧每日更新|Show more/.test(dispTitle)) {
        var cleaned = D.cleanTitle(dispTitle, l.url);
        if (D.isMeaningfulTitle(cleaned)) dispTitle = cleaned;
      }
      var titleHtml = dispTitle
        ? '<div class="item-title">' + escapeHtml(dispTitle) + "</div>"
        : '<div class="item-title placeholder">（未命名资源）</div>';
      var codeHtml = l.code ? '<span class="code-chip">提取码 ' + escapeHtml(l.code) + "</span>" : "";
      var isSus = l.suspect || D.isLikelyTruncated(l.url);
      var suspectHtml = isSus
        ? '<span class="suspect-chip" title="该链接可能被页面截断、不完整。建议打开真实分享页后再收藏">⚠️ 可能不完整</span>'
        : "";
      var liveHtml = l.liveness === "dead" ? '<span class="live-chip dead" title="' + escapeHtml(l.liveReason || "") + '">✗ 已失效</span>'
        : l.liveness === "alive" ? '<span class="live-chip alive">✓ 有效</span>'
        : l.liveness === "unknown" ? '<span class="live-chip unknown" title="' + escapeHtml(l.liveReason || "") + '">? 未确定</span>'
        : "";

      return '<div class="item' + (isSus ? " suspect" : "") + (l.liveness === "dead" ? " dead" : "") + '" data-key="' + escapeHtml(l.key) + '">' +
        '<div class="item-head">' +
          '<input type="checkbox" class="item-check"' + (selectedKeys[l.key] ? " checked" : "") + " />" +
          '<span class="badge" style="background:' + l.providerColor + '">' + escapeHtml(l.providerName) + "</span>" +
          cardCatDD(l.category || "未分类", l.key) +
          codeHtml +
          suspectHtml +
          liveHtml +
        "</div>" +
        titleHtml +
        '<div class="item-url"><a href="' + escapeHtml(l.url) + '" target="_blank" rel="noreferrer">' + escapeHtml(l.url) + "</a></div>" +
        (tags ? '<div class="tags">' + tags + "</div>" : "") +
        (l.note ? '<div class="note">' + escapeHtml(l.note) + "</div>" : "") +
        '<div class="item-meta">收藏于 ' + fmtDate(l.savedAt) + "</div>" +
        '<div class="item-actions">' +
          '<button class="mini-btn act-copy">复制链接+提取码</button>' +
          '<button class="mini-btn act-edit">编辑</button>' +
          '<button class="mini-btn del act-del">删除</button>' +
        "</div>" +
      "</div>";
    }).join("");

    bindCardEvents();
    updateBatchBar();
  }

  /* --------------------------- 批量操作 --------------------------- */

  function selectedList() { return all.filter(function (l) { return selectedKeys[l.key]; }); }

  function updateBatchBar() {
    Object.keys(selectedKeys).forEach(function (k) { if (!findByKey(k)) delete selectedKeys[k]; });
    var n = selectedList().length;
    els.batchCount.textContent = n > 0 ? "已选 " + n + " 条" : "未选择";
    els.batchActions.hidden = n === 0;
    els.batchSelectAll.checked = currentRows.length > 0 && currentRows.every(function (l) { return selectedKeys[l.key]; });
    renderDD(ddBatch, batchCategoryValue, batchOptions(), "归类到…");
  }

  function bindBatchEvents() {
    els.batchSelectAll.addEventListener("change", function () {
      if (els.batchSelectAll.checked) currentRows.forEach(function (l) { selectedKeys[l.key] = true; });
      else currentRows.forEach(function (l) { delete selectedKeys[l.key]; });
      render();
    });
    els.batchClear.addEventListener("click", function () { selectedKeys = {}; render(); });

    els.batchApply.addEventListener("click", function () {
      var sel = selectedList();
      if (sel.length === 0) { toast("请先勾选链接"); return; }
      if (!batchCategoryValue) { toast("请先选择要归类到的分类"); return; }
      var category = batchCategoryValue;
      sel.forEach(function (l) { l.category = category; });
      saveCategories().then(function () {
        persist().then(function () {
          refreshFilters(); render();
          toast("已把 " + sel.length + " 条归类到「" + category + "」");
        });
      });
    });

    els.batchDelete.addEventListener("click", function () {
      var sel = selectedList();
      if (sel.length === 0) { toast("请先勾选链接"); return; }
      showConfirm("确定删除选中的 " + sel.length + " 条收藏吗？", { danger: true, okText: "删除" }).then(function (ok) {
        if (!ok) return;
        all = all.filter(function (l) { return !selectedKeys[l.key]; });
        selectedKeys = {};
        persist().then(function () { refreshFilters(); render(); toast("已删除"); });
      });
    });
  }

  function findByKey(key) {
    for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i];
    return null;
  }

  function bindCardEvents() {
    Array.prototype.forEach.call(els.grid.querySelectorAll(".item"), function (card) {
      var key = card.getAttribute("data-key");
      card.querySelector(".act-copy").addEventListener("click", function () {
        var l = findByKey(key);
        if (!l) return;
        var text = l.url + (l.code ? "  提取码: " + l.code : "");
        navigator.clipboard.writeText(text).then(function () { toast("已复制到剪贴板"); });
      });
      card.querySelector(".act-edit").addEventListener("click", function () { openEdit(key); });
      card.querySelector(".act-del").addEventListener("click", function () {
        showConfirm("确定删除这条收藏吗？", { danger: true, okText: "删除" }).then(function (ok) {
          if (!ok) return;
          all = all.filter(function (x) { return x.key !== key; });
          persist().then(function () { refreshFilters(); render(); toast("已删除"); });
        });
      });
      var chk = card.querySelector(".item-check");
      if (chk) {
        chk.addEventListener("change", function () {
          if (chk.checked) selectedKeys[key] = true; else delete selectedKeys[key];
          updateBatchBar();
        });
      }
    });
  }

  /* ------------------------------ 编辑 ------------------------------ */

  function openEdit(key) {
    var l = findByKey(key);
    if (!l) return;
    editingKey = key;
    els.editTitle.value = l.title || "";
    els.editCategory.value = l.category && l.category !== "未分类" ? l.category : "";
    els.editTags.value = (l.tags || []).join(", ");
    els.editCode.value = l.code || "";
    els.editNote.value = l.note || "";
    els.modal.hidden = false;
  }
  function closeEdit() { els.modal.hidden = true; editingKey = null; }

  document.getElementById("editCancel").addEventListener("click", closeEdit);
  document.getElementById("editClose").addEventListener("click", closeEdit);
  els.modal.addEventListener("click", function (e) { if (e.target === els.modal) closeEdit(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !els.modal.hidden) closeEdit(); });

  document.getElementById("editSave").addEventListener("click", function () {
    var l = findByKey(editingKey);
    if (!l) { closeEdit(); return; }
    l.title = els.editTitle.value.trim();
    l.category = els.editCategory.value.trim() || "未分类";
    l.tags = els.editTags.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    l.code = els.editCode.value.trim();
    l.note = els.editNote.value.trim();
    addCategory(l.category);
    saveCategories().then(function () {
      persist().then(function () { closeEdit(); refreshFilters(); render(); toast("已保存"); });
    });
  });

  document.getElementById("newCategory").addEventListener("click", function () {
    showPrompt("新建分类", { placeholder: "如：电影 / 短剧 / 学习" }).then(function (name) {
      name = (name || "").trim();
      if (!name) return;
      if (name === "未分类") { toast("「未分类」是默认分类，无需创建"); return; }
      if (customCategories.indexOf(name) !== -1) { toast("分类「" + name + "」已存在"); return; }
      addCategory(name);
      saveCategories().then(function () { refreshFilters(); render(); toast("已新建分类「" + name + "」，可在卡片上选用"); });
    });
  });

  /* --------------------------- 导入 / 导出 --------------------------- */

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.getElementById("exportJson").addEventListener("click", function () {
    if (all.length === 0) { toast("没有可导出的数据"); return; }
    download("netdisk-links-" + Date.now() + ".json", JSON.stringify(all, null, 2), "application/json");
    toast("已导出 JSON");
  });

  document.getElementById("exportCsv").addEventListener("click", function () {
    if (all.length === 0) { toast("没有可导出的数据"); return; }
    var header = ["网盘", "标题", "链接", "提取码", "分类", "标签", "备注", "来源页", "收藏时间"];
    var esc = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    var lines = [header.map(esc).join(",")];
    all.forEach(function (l) {
      lines.push([
        l.providerName, l.title, l.url, l.code, l.category || "未分类",
        (l.tags || []).join(" "), l.note, l.sourceUrl, fmtDate(l.savedAt)
      ].map(esc).join(","));
    });
    download("netdisk-links-" + Date.now() + ".csv", "\ufeff" + lines.join("\r\n"), "text/csv");
    toast("已导出 CSV");
  });

  document.getElementById("importBtn").addEventListener("click", function () { document.getElementById("importFile").click(); });

  document.getElementById("importFile").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error("格式不正确");
        var index = {};
        all.forEach(function (l) { index[l.key] = true; });
        var added = 0;
        data.forEach(function (l) {
          if (!l || !l.url) return;
          if (!l.key) {
            var p = D.matchProvider(l.url) || { id: l.providerId || "unknown" };
            l.key = D.dedupeKey(p, l.url);
          }
          if (index[l.key]) return;
          index[l.key] = true;
          l.savedAt = l.savedAt || Date.now();
          l.category = l.category || "未分类";
          l.tags = l.tags || [];
          all.push(l); added++;
        });
        persist().then(function () { refreshFilters(); render(); toast("导入完成，新增 " + added + " 条"); });
      } catch (err) {
        toast("导入失败：" + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("clearAll").addEventListener("click", function () {
    if (all.length === 0) { toast("没有数据"); return; }
    showConfirm("确定清空全部 " + all.length + " 条收藏吗？此操作不可恢复。", { danger: true, okText: "清空" }).then(function (ok) {
      if (!ok) return;
      all = [];
      persist().then(function () { refreshFilters(); render(); toast("已清空"); });
    });
  });

  // 检测失效：逐个联网访问链接，标记 有效 / 失效 / 无法确定
  var checkingLive = false;
  document.getElementById("checkLive").addEventListener("click", function () {
    if (checkingLive) return;
    if (all.length === 0) { toast("没有数据"); return; }
    var targets = currentRows.length ? currentRows.slice() : all.slice();
    showConfirm(
      "将逐个联网访问当前 " + targets.length + " 条链接检测是否失效。\n" +
      "注意：天翼/百度/夸克等网盘失效页面是动态加载的，可能无法识别会归为「无法确定」；检测较慢，请耐心等待。是否继续？",
      { okText: "开始检测" }
    ).then(function (ok) {
      if (!ok) return;
      runLivenessCheck(targets);
    });
  });

  async function runLivenessCheck(links) {
    checkingLive = true;
    var btn = document.getElementById("checkLive");
    btn.disabled = true;
    var done = 0, dead = 0, alive = 0, unknown = 0;
    var idx = 0;
    var CONCURRENCY = 4;

    async function worker() {
      while (idx < links.length) {
        var l = links[idx++];
        var r = await sendToBg({ type: "CHECK_LINK", url: l.url });
        l.liveness = (r && r.state) || "unknown";
        l.liveReason = (r && r.reason) || "";
        l.checkedAt = Date.now();
        done++;
        if (l.liveness === "dead") dead++;
        else if (l.liveness === "alive") alive++;
        else unknown++;
        btn.textContent = "检测中 " + done + "/" + links.length;
      }
    }

    var workers = [];
    for (var i = 0; i < CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);

    checkingLive = false;
    btn.disabled = false;
    btn.textContent = "检测失效";
    await persist();
    render();
    toast("检测完成：有效 " + alive + " ｜ 失效 " + dead + " ｜ 无法确定 " + unknown);

    if (dead > 0) {
      var go = await showConfirm("发现 " + dead + " 条已失效链接，是否删除它们？", { danger: true, okText: "删除失效" });
      if (go) {
        all = all.filter(function (x) { return x.liveness !== "dead"; });
        await persist();
        refreshFilters();
        render();
        toast("已删除 " + dead + " 条失效链接");
      }
    }
  }

  document.getElementById("cleanInvalid").addEventListener("click", function () {
    if (all.length === 0) { toast("没有数据"); return; }
    var before = all.length;
    var kept = all.filter(function (l) { return D.isShareLink(l.url) && !D.isLikelyTruncated(l.url); });
    var removed = before - kept.length;
    if (removed === 0) { toast("没有发现格式无效/残缺的链接"); return; }
    showConfirm("检测到 " + removed + " 条格式无效或被截断的残缺链接，确定清理吗？\n（注：已失效/被删除的分享无法自动识别，需联网逐个检查）", { danger: true, okText: "清理" }).then(function (ok) {
      if (!ok) return;
      all = kept;
      persist().then(function () { refreshFilters(); render(); toast("已清理 " + removed + " 条"); });
    });
  });

  /* ----------------------------- 事件绑定 ---------------------------- */

  els.search.addEventListener("input", render);
  bindBatchEvents();

  // 「更多资源·关注频道」入口
  (function setupFollow() {
    var P = self.PanGrabPromos;
    var f = P && P.follow;
    var btn = document.getElementById("followBtn");
    if (!btn || !f || !f.enabled) return;
    var hasTg = !!(f.tg && f.tg.url);
    var hasMp = !!(f.mp && (f.mp.url || f.mp.qr));
    if (!hasTg && !hasMp) return;
    btn.hidden = false;
    var modal = document.getElementById("followModal");
    var body = document.getElementById("followBody");
    btn.addEventListener("click", function () {
      var fix = function (u) { return !u ? u : (/^https?:\/\//i.test(u) ? u : "https://" + u); };
      var html = "";
      if (hasTg) html += '<a class="follow-link" href="' + escapeHtml(fix(f.tg.url)) + '" target="_blank" rel="noreferrer">' + escapeHtml(f.tg.text || "Telegram 频道") + " ▸</a>";
      if (hasMp) {
        if (f.mp.url) html += '<a class="follow-link" href="' + escapeHtml(fix(f.mp.url)) + '" target="_blank" rel="noreferrer">' + escapeHtml(f.mp.text || "微信公众号") + " ▸</a>";
        else html += '<div class="follow-name">' + escapeHtml(f.mp.text || "微信公众号") + "</div>";
        if (f.mp.qr) html += '<img class="follow-qr" src="' + escapeHtml(f.mp.qr) + '" alt="公众号二维码" />';
      }
      body.innerHTML = html;
      modal.hidden = false;
    });
    document.getElementById("followClose").addEventListener("click", function () { modal.hidden = true; });
    modal.addEventListener("click", function (e) { if (e.target === modal) modal.hidden = true; });
  })();

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (changes.categories) customCategories = changes.categories.newValue || [];
    if (changes.savedLinks) all = changes.savedLinks.newValue || [];
    if (changes.savedLinks || changes.categories) { refreshFilters(); render(); }
  });

  load();
})();
