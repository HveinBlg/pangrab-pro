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

  var PRO = self.PanGrabPro;
  // 会员判断（无公共层时默认放行，避免异常导致不可用）
  function isPro() { return PRO ? PRO.isProNow() : Promise.resolve(true); }
  // 打开「账号 / 云同步」面板（pro.js 注入的按钮）
  function openProPanel() { var b = document.getElementById("proAccountBtn"); if (b) b.click(); }
  // 提示需要 Pro，点「去开通」打开账号面板
  function requirePro(title, message) {
    showConfirm(message, { title: title || t("dlg_pro_feature"), okText: t("dlg_upgrade") }).then(function (ok) {
      if (ok) openProPanel();
    });
  }
  // 是否允许新建分类（免费版上限）。返回 Promise<bool>
  function ensureCanAddCategory() {
    return isPro().then(function (pro) {
      if (pro) return true;
      var max = PRO.LIMITS.FREE_MAX_CATEGORIES;
      if (allCategories().length >= max) {
        requirePro(t("dlg_cat_limit_title"), t("dlg_cat_limit_msg", max));
        return false;
      }
      return true;
    });
  }

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
      dlgOk.textContent = t("opt_ok"); dlgOk.className = "primary";
      dialogEl.hidden = false;
      setTimeout(function () { dlgInput.focus(); dlgInput.select(); }, 30);
    });
  }
  function showConfirm(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      dlgResolve = resolve; dlgMode = "confirm";
      dlgTitle.textContent = opts.title || t("dlg_confirm_title");
      dlgMessage.textContent = message; dlgMessage.hidden = false;
      dlgInput.hidden = true;
      dlgOk.textContent = opts.okText || t("opt_ok");
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
    var options = [{ value: "未分类", label: t("cat_uncategorized") }]
      .concat(allCategories().map(function (c) { return { value: c, label: c }; }))
      .concat([{ value: "__new__", label: t("cat_new") }]);
    return '<div class="dd dd-cat" data-role="cat" data-key="' + escapeHtml(key) + '" data-value="' + escapeHtml(current) + '" tabindex="0">' +
      ddInner(current, options, t("cat_uncategorized")) + "</div>";
  }

  function providerOptions() {
    var providers = {};
    all.forEach(function (l) { providers[l.providerId] = l.providerName; });
    var opts = [{ value: "", label: t("filter_all_providers") }];
    Object.keys(providers).forEach(function (id) { opts.push({ value: id, label: providers[id] }); });
    return opts;
  }
  function categoryFilterOptions() {
    var opts = [{ value: "", label: t("filter_all_categories") }];
    allCategories().forEach(function (c) { opts.push({ value: c, label: c }); });
    if (all.some(function (l) { return !l.category || l.category === "未分类"; })) opts.push({ value: "未分类", label: t("cat_uncategorized") });
    return opts;
  }
  var SORT_OPTIONS = [
    { value: "savedAt_desc", label: t("sort_recent") },
    { value: "savedAt_asc", label: t("sort_oldest") },
    { value: "provider", label: t("sort_provider") },
    { value: "category", label: t("sort_category") }
  ];
  function batchOptions() {
    return [{ value: "", label: t("cat_move_to") }, { value: "未分类", label: t("cat_uncategorized") }]
      .concat(allCategories().map(function (c) { return { value: c, label: c }; }))
      .concat([{ value: "__new__", label: t("cat_new") }]);
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
        ensureCanAddCategory().then(function (allow) {
          if (!allow) { updateBatchBar(); return; }
          showPrompt(t("dlg_new_category"), { placeholder: t("dlg_new_category_ph") }).then(function (name) {
            name = (name || "").trim();
            if (!name) return;
            addCategory(name); batchCategoryValue = name;
            saveCategories().then(function () { updateBatchBar(); });
          });
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
        ensureCanAddCategory().then(function (allow) {
          if (!allow) { render(); return; }
          showPrompt(t("dlg_enter_category"), { placeholder: t("dlg_new_category_ph") }).then(function (name) {
            name = (name || "").trim();
            if (!name) { render(); return; }
            addCategory(name); l.category = name;
            saveCategories().then(function () { persist().then(function () { refreshFilters(); render(); toast(t("toast_moved_to", name)); }); });
          });
        });
        return;
      }
      l.category = val;
      persist().then(function () { refreshFilters(); render(); toast(val === "未分类" ? t("toast_removed_category") : t("toast_moved_to", val)); });
    }
  }

  /* ----------------------------- 数据 ----------------------------- */

  async function load() {
    var resp = await sendToBg({ type: "GET_SAVED" });
    all = (resp && resp.links) || [];
    customCategories = await loadCategories();
    refreshFilters();
    render();
    // 刷新会员状态缓存，确保导出/分类/检测等门控反映真实会员身份
    if (self.PanGrabPro) self.PanGrabPro.refreshFromServer();
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
    renderDD(ddProvider, filterState.provider, providerOptions(), t("filter_all_providers"));
    renderDD(ddCategory, filterState.category, categoryFilterOptions(), t("filter_all_categories"));
    renderDD(ddSort, filterState.sort, SORT_OPTIONS, t("sort_placeholder"));
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
    var html = '<div class="stat-chip">' + t("stats_total", "<b>" + all.length + "</b>") + "</div>";
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
        : '<div class="item-title placeholder">' + t("item_untitled") + "</div>";
      var codeHtml = l.code ? '<span class="code-chip">' + t("chip_code", escapeHtml(l.code)) + "</span>" : "";
      var isSus = l.suspect || D.isLikelyTruncated(l.url);
      var suspectHtml = isSus
        ? '<span class="suspect-chip" title="' + escapeHtml(t("chip_suspect_title")) + '">' + t("chip_suspect") + "</span>"
        : "";
      var liveHtml = l.liveness === "dead" ? '<span class="live-chip dead" title="' + escapeHtml(l.liveReason || "") + '">' + t("live_dead") + "</span>"
        : l.liveness === "alive" ? '<span class="live-chip alive">' + t("live_alive") + "</span>"
        : l.liveness === "unknown" ? '<span class="live-chip unknown" title="' + escapeHtml(l.liveReason || "") + '">' + t("live_unknown") + "</span>"
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
        '<div class="item-meta">' + t("item_saved_at", fmtDate(l.savedAt)) + "</div>" +
        '<div class="item-actions">' +
          '<button class="mini-btn act-copy">' + t("item_copy") + "</button>" +
          '<button class="mini-btn act-edit">' + t("item_edit") + "</button>" +
          '<button class="mini-btn del act-del">' + t("item_delete") + "</button>" +
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
    els.batchCount.textContent = n > 0 ? t("opt_batch_selected", n) : t("opt_batch_none");
    els.batchActions.hidden = n === 0;
    els.batchSelectAll.checked = currentRows.length > 0 && currentRows.every(function (l) { return selectedKeys[l.key]; });
    renderDD(ddBatch, batchCategoryValue, batchOptions(), t("cat_move_to"));
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
      if (sel.length === 0) { toast(t("toast_select_first")); return; }
      if (!batchCategoryValue) { toast(t("toast_choose_category")); return; }
      var category = batchCategoryValue;
      sel.forEach(function (l) { l.category = category; });
      saveCategories().then(function () {
        persist().then(function () {
          refreshFilters(); render();
          toast(t("toast_moved_n", sel.length, category));
        });
      });
    });

    els.batchDelete.addEventListener("click", function () {
      var sel = selectedList();
      if (sel.length === 0) { toast(t("toast_select_first")); return; }
      showConfirm(t("confirm_delete_selected", sel.length), { danger: true, okText: t("btn_delete") }).then(function (ok) {
        if (!ok) return;
        all = all.filter(function (l) { return !selectedKeys[l.key]; });
        selectedKeys = {};
        persist().then(function () { refreshFilters(); render(); toast(t("toast_deleted")); });
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
        var text = l.url + (l.code ? "  " + t("txt_code").trim() + " " + l.code : "");
        navigator.clipboard.writeText(text).then(function () { toast(t("toast_copied")); });
      });
      card.querySelector(".act-edit").addEventListener("click", function () { openEdit(key); });
      card.querySelector(".act-del").addEventListener("click", function () {
        showConfirm(t("confirm_delete_one"), { danger: true, okText: t("btn_delete") }).then(function (ok) {
          if (!ok) return;
          all = all.filter(function (x) { return x.key !== key; });
          persist().then(function () { refreshFilters(); render(); toast(t("toast_deleted")); });
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
    var newCat = els.editCategory.value.trim() || "未分类";
    var isNewCat = newCat !== "未分类" && allCategories().indexOf(newCat) === -1;

    var proceed = function () {
      l.title = els.editTitle.value.trim();
      l.category = els.editCategory.value.trim() || "未分类";
      l.tags = els.editTags.value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
      l.code = els.editCode.value.trim();
      l.note = els.editNote.value.trim();
      addCategory(l.category);
      saveCategories().then(function () {
        persist().then(function () { closeEdit(); refreshFilters(); render(); toast(t("toast_saved")); });
      });
    };

    if (isNewCat) {
      ensureCanAddCategory().then(function (allow) { if (allow) proceed(); /* 不允许则停留在编辑框 */ });
    } else {
      proceed();
    }
  });

  document.getElementById("newCategory").addEventListener("click", function () {
    ensureCanAddCategory().then(function (allow) {
      if (!allow) return;
      showPrompt(t("dlg_new_category"), { placeholder: t("dlg_new_category_ph") }).then(function (name) {
        name = (name || "").trim();
        if (!name) return;
        if (name === "未分类") { toast(t("toast_uncategorized_default")); return; }
        if (customCategories.indexOf(name) !== -1) { toast(t("toast_category_exists", name)); return; }
        addCategory(name);
        saveCategories().then(function () { refreshFilters(); render(); toast(t("toast_category_created", name)); });
      });
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

  // 导出：Pro 导出全部；免费版仅导出当前筛选可见的
  function buildCsv(rows) {
    var header = [t("csv_provider"), t("csv_title"), t("csv_url"), t("csv_code"), t("csv_category"), t("csv_tags"), t("csv_note"), t("csv_source"), t("csv_saved_at")];
    var esc = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    var lines = [header.map(esc).join(",")];
    rows.forEach(function (l) {
      lines.push([
        l.providerName, l.title, l.url, l.code, l.category || "未分类",
        (l.tags || []).join(" "), l.note, l.sourceUrl, fmtDate(l.savedAt)
      ].map(esc).join(","));
    });
    return "\ufeff" + lines.join("\r\n");
  }
  function buildTxt(rows) {
    return rows.map(function (l) {
      return "【" + l.providerName + "】" + (l.title || t("txt_untitled")) + "\n" +
        l.url + (l.code ? t("txt_code") + l.code : "") +
        (l.category && l.category !== "未分类" ? "\n" + t("txt_category") + l.category : "");
    }).join("\n\n");
  }
  function doExport(format) {
    if (all.length === 0) { toast(t("toast_no_export")); return; }
    isPro().then(function (pro) {
      var rows = pro ? all.slice() : currentRows.slice();
      if (rows.length === 0) { toast(t("toast_no_export_filter")); return; }
      var ts = Date.now();
      if (format === "json") download("netdisk-links-" + ts + ".json", JSON.stringify(rows, null, 2), "application/json");
      else if (format === "csv") download("netdisk-links-" + ts + ".csv", buildCsv(rows), "text/csv");
      else download("netdisk-links-" + ts + ".txt", buildTxt(rows), "text/plain");
      if (!pro && rows.length < all.length) {
        toast(t("toast_export_free", rows.length, all.length));
      } else {
        toast(t("toast_exported", rows.length));
      }
    });
  }
  document.getElementById("exportJson").addEventListener("click", function () { doExport("json"); });
  document.getElementById("exportCsv").addEventListener("click", function () { doExport("csv"); });
  document.getElementById("exportTxt").addEventListener("click", function () { doExport("txt"); });

  // 导入：Pro 会员功能（备份恢复 / 换设备迁移）
  document.getElementById("importBtn").addEventListener("click", function () {
    isPro().then(function (pro) {
      if (!pro) { requirePro(t("import_pro_title"), t("import_pro_msg")); return; }
      document.getElementById("importFile").click();
    });
  });

  document.getElementById("importFile").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error(t("toast_invalid_format"));
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
        persist().then(function () { refreshFilters(); render(); toast(t("toast_import_done", added)); });
      } catch (err) {
        toast(t("toast_import_failed", err.message));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("clearAll").addEventListener("click", function () {
    if (all.length === 0) { toast(t("toast_no_data")); return; }
    showConfirm(t("confirm_clear_all", all.length), { danger: true, okText: t("btn_clear") }).then(function (ok) {
      if (!ok) return;
      all = [];
      persist().then(function () { refreshFilters(); render(); toast(t("toast_cleared")); });
    });
  });

  // 检测失效：逐个联网访问链接，标记 有效 / 失效 / 无法确定（免费版每天限 N 次）
  var checkingLive = false;
  document.getElementById("checkLive").addEventListener("click", async function () {
    if (checkingLive) return;
    if (all.length === 0) { toast(t("toast_no_data")); return; }

    var pro = await isPro();
    if (!pro) {
      var u = await PRO.getUsage("check");
      var limit = PRO.LIMITS.FREE_CHECK_PER_DAY;
      if (u.count >= limit) {
        requirePro(t("check_limit_title"), t("check_limit_msg", limit));
        return;
      }
    }

    var targets = currentRows.length ? currentRows.slice() : all.slice();
    var confirmMsg = t("check_confirm", targets.length) +
      (pro ? "" : t("check_confirm_free_left", (PRO.LIMITS.FREE_CHECK_PER_DAY - (await PRO.getUsage("check")).count)));
    showConfirm(confirmMsg, { okText: t("check_start") }).then(function (ok) {
      if (!ok) return;
      if (!pro && PRO) PRO.bumpUsage("check");
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
        btn.textContent = t("check_progress", done, links.length);
      }
    }

    var workers = [];
    for (var i = 0; i < CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);

    checkingLive = false;
    btn.disabled = false;
    btn.textContent = t("opt_check_live");
    await persist();
    render();
    toast(t("check_done", alive, dead, unknown));

    if (dead > 0) {
      var go = await showConfirm(t("check_delete_dead", dead), { danger: true, okText: t("check_delete_dead_btn") });
      if (go) {
        all = all.filter(function (x) { return x.liveness !== "dead"; });
        await persist();
        refreshFilters();
        render();
        toast(t("check_deleted_dead", dead));
      }
    }
  }

  document.getElementById("cleanInvalid").addEventListener("click", function () {
    if (all.length === 0) { toast(t("toast_no_data")); return; }
    var before = all.length;
    var kept = all.filter(function (l) { return D.isShareLink(l.url) && !D.isLikelyTruncated(l.url); });
    var removed = before - kept.length;
    if (removed === 0) { toast(t("toast_no_invalid")); return; }
    showConfirm(t("clean_confirm", removed), { danger: true, okText: t("btn_clean") }).then(function (ok) {
      if (!ok) return;
      all = kept;
      persist().then(function () { refreshFilters(); render(); toast(t("toast_cleaned_n", removed)); });
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
      if (hasTg) html += '<a class="follow-link" href="' + escapeHtml(fix(f.tg.url)) + '" target="_blank" rel="noreferrer">' + escapeHtml(f.tg.text || t("follow_tg")) + " ▸</a>";
      if (hasMp) {
        if (f.mp.url) html += '<a class="follow-link" href="' + escapeHtml(fix(f.mp.url)) + '" target="_blank" rel="noreferrer">' + escapeHtml(f.mp.text || t("follow_wechat")) + " ▸</a>";
        else html += '<div class="follow-name">' + escapeHtml(f.mp.text || t("follow_wechat")) + "</div>";
        if (f.mp.qr) html += '<img class="follow-qr" src="' + escapeHtml(f.mp.qr) + '" alt="' + escapeHtml(t("follow_qr_alt")) + '" />';
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
