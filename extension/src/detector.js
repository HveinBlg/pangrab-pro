/**
 * detector.js
 * 网盘链接识别核心库。
 * 同时被 content script、popup、options 复用。
 * 通过挂载到全局 (window/self) 的 NetdiskDetector 暴露 API。
 */
(function (root) {
  "use strict";

  /**
   * 各大网盘的识别规则。
   * - id: 唯一标识
   * - name: 中文名
   * - color: 标识色（用于 UI）
   * - hosts: 命中的域名关键字（用于快速判断）
   * - urlPattern: 用于在纯文本中提取分享链接的正则（带 g 标志）。
   *   协议头 https:// 是可选的，以兼容论坛/推特里常见的「裸链接」写法。
   */
  var PROVIDERS = [
    {
      id: "baidu",
      name: "百度网盘",
      color: "#06a7ff",
      hosts: ["pan.baidu.com", "yun.baidu.com", "eyun.baidu.com"],
      urlPattern: /(?:https?:\/\/)?(?:pan|yun|eyun)\.baidu\.com\/(?:s\/[\w-]+|share\/[^\s"'<>）)，,；;]+)/gi
    },
    {
      id: "aliyun",
      name: "阿里云盘",
      color: "#3d7fff",
      hosts: ["aliyundrive.com", "alipan.com"],
      urlPattern: /(?:https?:\/\/)?(?:www\.)?(?:aliyundrive|alipan)\.com\/s\/[\w-]+/gi
    },
    {
      id: "quark",
      name: "夸克网盘",
      color: "#5b6cff",
      hosts: ["pan.quark.cn"],
      urlPattern: /(?:https?:\/\/)?pan\.quark\.cn\/s\/[\w-]+/gi
    },
    {
      id: "xunlei",
      name: "迅雷云盘",
      color: "#3897ff",
      hosts: ["pan.xunlei.com"],
      urlPattern: /(?:https?:\/\/)?pan\.xunlei\.com\/s\/[\w-]+/gi
    },
    {
      id: "115",
      name: "115网盘",
      color: "#ff8a00",
      hosts: ["115.com", "anxia.com", "115cdn.com"],
      urlPattern: /(?:https?:\/\/)?(?:www\.)?(?:115|anxia|115cdn)\.com\/s\/[\w-]+/gi
    },
    {
      id: "tianyi",
      name: "天翼云盘",
      color: "#ff4d4f",
      hosts: ["cloud.189.cn"],
      urlPattern: /(?:https?:\/\/)?cloud\.189\.cn\/(?:t\/[\w-]+|web\/share\?[^\s"'<>）)，,；;]+)/gi
    },
    {
      id: "123pan",
      name: "123云盘",
      color: "#00c2a8",
      hosts: ["123pan.com", "123684.com", "123865.com", "123pan.cn"],
      urlPattern: /(?:https?:\/\/)?(?:www\.)?(?:123pan\.com|123684\.com|123865\.com|123pan\.cn)\/s\/[\w-]+/gi
    },
    {
      id: "uc",
      name: "UC网盘",
      color: "#ffb000",
      hosts: ["drive.uc.cn"],
      urlPattern: /(?:https?:\/\/)?drive\.uc\.cn\/s\/[\w-]+/gi
    },
    {
      id: "ctfile",
      name: "城通网盘",
      color: "#7d5fff",
      hosts: ["ctfile.com", "545c.com", "474b.com", "u062.com"],
      urlPattern: /(?:https?:\/\/)?(?:[\w-]+\.)?(?:ctfile|545c|474b|u062)\.com\/(?:f|file|fs)\/[\w-]+/gi
    },
    {
      id: "weiyun",
      name: "腾讯微云",
      color: "#21c4ff",
      hosts: ["share.weiyun.com"],
      urlPattern: /(?:https?:\/\/)?share\.weiyun\.com\/[\w-]+/gi
    },
    {
      id: "lanzou",
      name: "蓝奏云",
      color: "#1aad19",
      hosts: ["lanzou", "lanzn.com", "lanzoui.com", "lanzoux.com", "lanzoup.com"],
      urlPattern: /(?:https?:\/\/)?(?:[\w-]+\.)?(?:lanzou[a-z]?|lanzn)\.com\/[\w-]+/gi
    },
    {
      id: "mcloud",
      name: "移动云盘",
      color: "#00a0e9",
      hosts: ["yun.139.com", "caiyun.139.com"],
      urlPattern: /(?:https?:\/\/)?(?:yun|caiyun)\.139\.com\/(?:shareweb\/)?#?\/?w\/i\/[\w-]+/gi
    },
    {
      id: "mega",
      name: "MEGA",
      color: "#d9272e",
      hosts: ["mega.nz", "mega.io"],
      urlPattern: /(?:https?:\/\/)?mega\.(?:nz|io)\/(?:file|folder|#)[^\s"'<>）)，,；;]+/gi
    },
    {
      id: "gdrive",
      name: "Google Drive",
      color: "#1a73e8",
      hosts: ["drive.google.com", "docs.google.com"],
      urlPattern: /(?:https?:\/\/)?(?:drive\.google\.com\/(?:file\/d\/|drive\/folders\/|drive\/u\/\d+\/folders\/|open\?id=|uc\?id=|uc\?export=download&id=)[\w-]+|docs\.google\.com\/(?:document|spreadsheets|presentation|forms)\/d\/[\w-]+)/gi
    },
    {
      id: "dropbox",
      name: "Dropbox",
      color: "#0061ff",
      hosts: ["dropbox.com", "db.tt"],
      urlPattern: /(?:https?:\/\/)?(?:www\.)?dropbox\.com\/(?:s\/|sh\/|scl\/fi\/|scl\/fo\/)[^\s"'<>）)，,；;]+/gi
    },
    {
      id: "onedrive",
      name: "OneDrive",
      color: "#0364b8",
      hosts: ["1drv.ms", "onedrive.live.com"],
      urlPattern: /(?:https?:\/\/)?(?:1drv\.ms\/[^\s"'<>）)，,；;]+|onedrive\.live\.com\/[^\s"'<>）)，,；;]+)/gi
    },
    {
      id: "terabox",
      name: "TeraBox",
      color: "#066bf5",
      hosts: ["terabox.com", "terabox.app", "teraboxapp.com", "1024tera.com", "4funbox.com", "momerybox.com", "nephobox.com"],
      urlPattern: /(?:https?:\/\/)?(?:www\.)?(?:terabox\.com|terabox\.app|teraboxapp\.com|1024tera\.com|4funbox\.com|momerybox\.com|nephobox\.com)\/s\/[\w-]+/gi
    },
    {
      id: "mediafire",
      name: "MediaFire",
      color: "#1299f3",
      hosts: ["mediafire.com"],
      urlPattern: /(?:https?:\/\/)?(?:www\.)?mediafire\.com\/(?:file\/|folder\/|view\/|\?)[\w./?=&-]+/gi
    },
    {
      id: "box",
      name: "Box",
      color: "#0061d5",
      hosts: ["app.box.com", "box.com"],
      urlPattern: /(?:https?:\/\/)?(?:app\.)?box\.com\/(?:s|v|shared)\/[\w-]+/gi
    },
    {
      id: "pcloud",
      name: "pCloud",
      color: "#19a5e8",
      hosts: ["pcloud.link"],
      urlPattern: /(?:https?:\/\/)?(?:[\w-]+\.)?pcloud\.link\/[^\s"'<>）)，,；;]+/gi
    },
    {
      id: "wetransfer",
      name: "WeTransfer",
      color: "#4060ff",
      hosts: ["we.tl", "wetransfer.com"],
      urlPattern: /(?:https?:\/\/)?(?:we\.tl\/[\w-]+|(?:www\.)?wetransfer\.com\/downloads\/[\w/]+)/gi
    },
    {
      id: "yandex",
      name: "Yandex Disk",
      color: "#fc3f1d",
      hosts: ["disk.yandex", "yadi.sk"],
      urlPattern: /(?:https?:\/\/)?(?:disk\.yandex\.[a-z.]+\/[di]\/[\w-]+|yadi\.sk\/[di]\/[\w-]+)/gi
    },
    {
      id: "protondrive",
      name: "Proton Drive",
      color: "#6d4aff",
      hosts: ["drive.proton.me"],
      urlPattern: /(?:https?:\/\/)?drive\.proton\.me\/urls\/[^\s"'<>）)，,；;]+/gi
    },
    {
      id: "icloud",
      name: "iCloud",
      color: "#3693f3",
      hosts: ["icloud.com"],
      urlPattern: /(?:https?:\/\/)?(?:www\.)?icloud\.com\/(?:iclouddrive|share)\/[\w#-]+/gi
    },
    {
      id: "gofile",
      name: "Gofile",
      color: "#ff6b35",
      hosts: ["gofile.io"],
      urlPattern: /(?:https?:\/\/)?gofile\.io\/d\/[\w-]+/gi
    },
    {
      id: "fourshared",
      name: "4shared",
      color: "#2196f3",
      hosts: ["4shared.com"],
      urlPattern: /(?:https?:\/\/)?(?:www\.)?4shared\.com\/[\w]+\/[^\s"'<>）)，,；;]+/gi
    },
    {
      id: "onefichier",
      name: "1fichier",
      color: "#d32f2f",
      hosts: ["1fichier.com"],
      urlPattern: /(?:https?:\/\/)?(?:www\.)?1fichier\.com\/\?[\w-]+/gi
    },
    {
      id: "magnet",
      name: "磁力链接",
      color: "#8e44ad",
      hosts: ["magnet:"],
      // 磁链：magnet:?xt=urn:btih:<40位十六进制或32位base32>&dn=名称&tr=tracker...
      urlPattern: /magnet:\?xt=urn:btih:[0-9a-zA-Z]{20,50}[^\s"'<>）)，,；;]*/gi
    }
  ];

  // 全局提取码识别：匹配「提取码 / 密码 / 访问码 / pwd」后面的 4~8 位字母数字
  // 例： 提取码: a1b2   密码：abcd   (访问码 1234)   ?pwd=xyz9
  var CODE_LABEL_PATTERN = /(?:提取码|提取密码|访问码|访问密码|密码|分享密码|校验码|口令|pwd|code|password|提取碼|密碼)\s*[:：=\s]\s*([a-zA-Z0-9]{3,8})/i;
  // URL 内嵌提取码： ?pwd=xxxx 或 &pwd=xxxx 或 #xxxx（部分网盘）
  var URL_CODE_PATTERN = /[?&#](?:pwd|password|code)=([a-zA-Z0-9]{3,8})/i;

  /**
   * 根据 URL 判断属于哪个网盘，返回 provider 对象或 null。
   */
  function matchProvider(url) {
    if (!url) return null;
    var lower = url.toLowerCase();
    for (var i = 0; i < PROVIDERS.length; i++) {
      var p = PROVIDERS[i];
      for (var j = 0; j < p.hosts.length; j++) {
        if (lower.indexOf(p.hosts[j]) !== -1) {
          return p;
        }
      }
    }
    return null;
  }

  /**
   * 判断一个 URL 是否是「真正的分享链接」（而不是网盘官网的导航/页脚等普通页面）。
   * 用对应网盘的 urlPattern 做严格匹配。
   */
  function isShareLink(url) {
    if (!url) return false;
    var p = matchProvider(url);
    if (!p) return false;
    var re = new RegExp(p.urlPattern.source, "i"); // 去掉 g，避免 lastIndex 影响
    return re.test(url);
  }

  /**
   * 从一段文本中提取所有网盘链接，并带上它们在文本中的位置（按出现顺序排序）。
   * 返回 [{ provider, url, index }]，用于把「提取码」搜索范围限定在相邻链接之间。
   */
  function extractLinksWithIndex(text) {
    var found = [];
    if (!text) return found;
    for (var i = 0; i < PROVIDERS.length; i++) {
      var p = PROVIDERS[i];
      var re = new RegExp(p.urlPattern.source, p.urlPattern.flags);
      var m;
      while ((m = re.exec(text)) !== null) {
        found.push({ provider: p, url: m[0], index: m.index });
        if (m.index === re.lastIndex) re.lastIndex++; // 防御零长匹配死循环
      }
    }
    found.sort(function (a, b) { return a.index - b.index; });
    return found;
  }

  /**
   * 从一个分享链接里取出「分享 ID」（/s/xxx、/t/xxx 等）。
   */
  function shareId(url) {
    if (!url) return "";
    if (/^magnet:/i.test(url)) return magnetHash(url);
    var m = url.match(/\/(?:s|t|f|fs|file|share|folder)\/([\w-]+)/i);
    if (m) return m[1];
    var m2 = url.replace(/[#?].*$/, "").match(/\/([\w-]{4,})\/?$/);
    return m2 ? m2[1] : "";
  }

  // 磁链：取 btih 哈希（作为唯一标识，同一资源不同 tracker/名称视为同一条）
  function magnetHash(url) {
    var m = /xt=urn:btih:([0-9a-zA-Z]+)/i.exec(url || "");
    return m ? m[1].toLowerCase() : "";
  }
  // 磁链：取显示名 dn（做资源标题）
  function magnetName(url) {
    var m = /[?&]dn=([^&]+)/i.exec(url || "");
    if (!m) return "";
    try { return decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (e) { return m[1]; }
  }

  // 各网盘分享 ID 的最短合理长度。短于此值多半是被页面（如 X/推特）截断的残缺链接。
  // 仅对「ID 通常很长」的网盘设置，避免误伤 ID 本就短的网盘（如夸克约 12 位）。
  var MIN_ID_LEN = { baidu: 18 };

  /**
   * 判断链接是否「疑似被截断」（ID 明显短于该网盘的正常长度）。
   */
  function isLikelyTruncated(url) {
    var p = matchProvider(url);
    if (!p) return false;
    var min = MIN_ID_LEN[p.id];
    if (!min) return false;
    var id = shareId(url);
    return !!id && id.length < min;
  }

  // 用于从标题里剥离的噪音词（网盘名、标签词等）
  var TITLE_NOISE = /(夸克网盘|百度网盘|阿里云盘|迅雷云盘|天翼云盘|城通网盘|腾讯微云|蓝奏云|网盘|夸克|阿里|百度|迅雷|天翼|链接|下载地址|下载链接|提取码|提取密码|访问码|访问密码|分享密码|密码|口令|分享|资源|链接如下|永久有效|点击下载|complete|search|home)\s*[：:]?/gi;
  var CODE_LABEL_GLOBAL = /(?:提取码|提取密码|访问码|访问密码|密码|分享密码|校验码|口令|pwd|code|password|提取碼|密碼)\s*[:：=\s]\s*[a-zA-Z0-9]{3,8}/gi;

  /**
   * 清洗出标题文本：去掉链接、提取码片段、网盘名/标签等噪音。可能返回空串。
   */
  function cleanTitle(context, url) {
    var text = (context || "");
    var bare = url ? url.replace(/^https?:\/\//i, "") : "";
    if (url) text = text.split(url).join(" ");
    if (bare) text = text.split(bare).join(" ");

    // X/推特：去掉"{统计数} {账号显示名} @handle · 时间"这段头部，只保留其后的正文标题
    //（同时也顺带去掉从上一条目串入的内容）
    text = text.replace(/^[\s\S]*?@[A-Za-z0-9_]{2,}\s*(?:·\s*(?:\d{1,2}\s*[smhd]\b|\d{1,2}:\d{2}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:,?\s*\d{2,4})?))?/, " ");
    // 残留的 @账号、· 时间、Show more / 显示更多 等推特 UI 文案
    text = text.replace(/@[A-Za-z0-9_]{2,}/g, " ");
    text = text.replace(/·\s*\d{1,2}\s*[smhd]\b/gi, " ");
    text = text.replace(/·\s*[A-Za-z]{3,9}\.?\s+\d{1,2}(?:,?\s*\d{2,4})?/g, " ");
    text = text.replace(/\b(?:Show more|Show this thread|Translate post|显示更多|显示此串|翻译(?:推文)?|查看翻译)\b/gi, " ");

    text = text.replace(CODE_LABEL_GLOBAL, " ");
    text = text.replace(/https?:\/\/\S+/gi, " ");
    text = text.replace(/(?:[\w-]+\.)+[a-z]{2,}\/[\w\-#?=&/.]+/gi, " "); // 残留裸链接(带路径)
    text = text.replace(/(?:[\w-]+\.)+(?:com|cn|net|org|io|nz|cc|top|xyz|me)\b[^\s]*/gi, " "); // 裸域名
    text = text.replace(/https?:?\/*/gi, " ");   // 残留协议头 https:// http:/ http 等
    text = text.replace(/\bwww\b/gi, " ");
    text = text.replace(TITLE_NOISE, " ");
    text = text.replace(/[【】\[\]|｜<>]+/g, " ");
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > 60) text = text.slice(0, 60).trim();
    // 去掉首尾的分隔符/标点
    text = text.replace(/^[\s_\-|·,，、:：.]+|[\s_\-|·,，、:：]+$/g, "").trim();
    return text;
  }

  function isMeaningfulTitle(t) {
    var s = (t || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
    if (s.length < 2) return false;
    if (/^(https?|www|com|cn|net)$/i.test(s)) return false; // 纯协议/域名残片不算有效标题
    return true;
  }

  /**
   * 根据链接周围文字猜一个有意义的标题（资源名）。
   * 找不到合适的就回退到「网盘名 + 分享ID」。
   */
  function guessTitle(context, url, provider) {
    // 磁链优先用链接里的 dn（显示名）做标题
    if (provider && provider.id === "magnet") {
      var dn = magnetName(url);
      if (isMeaningfulTitle(dn)) return dn;
    }
    var t = cleanTitle(context, url);
    if (isMeaningfulTitle(t)) return t;
    var id = shareId(url);
    return provider ? (provider.name + (id ? " " + id : "")) : id;
  }

  /**
   * 从一段文本中提取所有网盘链接。
   * 返回 [{ provider, url }]
   */
  function extractLinksFromText(text) {
    var found = [];
    if (!text) return found;
    for (var i = 0; i < PROVIDERS.length; i++) {
      var p = PROVIDERS[i];
      var re = new RegExp(p.urlPattern.source, p.urlPattern.flags);
      var m;
      while ((m = re.exec(text)) !== null) {
        found.push({ provider: p, url: m[0] });
      }
    }
    return found;
  }

  /**
   * 尝试为某个链接找到对应的提取码。
   * 1. 先看 URL 内部是否带 pwd 参数
   * 2. 再看链接附近文本（context）里的 提取码 标签
   */
  function findCode(url, context) {
    var um = URL_CODE_PATTERN.exec(url || "");
    if (um) return um[1];
    if (context) {
      var cm = CODE_LABEL_PATTERN.exec(context);
      if (cm) return cm[1];
    }
    return "";
  }

  /**
   * 规范化链接：去除末尾标点/空白，并为缺少协议头的「裸链接」补上 https://，
   * 保证链接可点击、可保存。
   */
  function normalizeUrl(url) {
    if (!url) return url;
    // 磁链：不补协议头、不裁剪（tracker 参数里可能含各种字符），仅去首尾空白
    if (/^magnet:/i.test(url)) return url.trim();
    var u = url.trim().replace(/[）)，,。；;、"'<>]+$/, "");
    if (u && !/^https?:\/\//i.test(u)) {
      u = "https://" + u;
    }
    return u;
  }

  /**
   * 生成稳定去重 key：网盘 + 链接（去掉协议差异）。
   * 磁链按 btih 哈希去重（同一资源不同 tracker/名称算同一条）。
   */
  function dedupeKey(provider, url) {
    if (provider && provider.id === "magnet") return "magnet::" + magnetHash(url);
    var u = (url || "").replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return (provider ? provider.id : "unknown") + "::" + u.toLowerCase();
  }

  var api = {
    PROVIDERS: PROVIDERS,
    matchProvider: matchProvider,
    isShareLink: isShareLink,
    extractLinksFromText: extractLinksFromText,
    extractLinksWithIndex: extractLinksWithIndex,
    shareId: shareId,
    isLikelyTruncated: isLikelyTruncated,
    guessTitle: guessTitle,
    cleanTitle: cleanTitle,
    isMeaningfulTitle: isMeaningfulTitle,
    findCode: findCode,
    normalizeUrl: normalizeUrl,
    dedupeKey: dedupeKey,
    getProviderById: function (id) {
      for (var i = 0; i < PROVIDERS.length; i++) {
        if (PROVIDERS[i].id === id) return PROVIDERS[i];
      }
      return null;
    }
  };

  root.NetdiskDetector = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof self !== "undefined" ? self : this);
