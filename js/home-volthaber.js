/* Public VoltHaber directory reader. No automatic requests, writes, or DOM insertion.
 * The committed snapshot is the offline/no-JS source; callers replace it only after a complete successful read.
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VGHomeVoltHaber = api;
}(typeof window !== 'undefined' ? window : null, function (host) {
  'use strict';
  var PAGE_SIZE = 12, MAX_PAGES = 250, MAX_TOTAL = 3000;
  var RESERVED = new Set(['kategori','etiket','sitemap','rss','ara','arama','yayin-ilkeleri','abonelik','index','api','sayfa',
    'constructor','prototype','__proto__','tostring','valueof','hasownproperty','isprototypeof','propertyisenumerable','tolocalestring',
    'giris','kayit','sifre-sifirla','etkinlestir','onay','unsubscribe','confirm','admin','panel','calisan','hesap']);
  function text(value, max, optional) {
    if (optional && (value === undefined || value === null || value === '')) return '';
    if (typeof value !== 'string') return null;
    var clean = value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
    return (!clean && !optional) || clean.length > max ? null : clean;
  }
  function normalizeEntry(item, origin) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.url !== 'string' || item.url.length > 300) return null;
    if (Object.prototype.hasOwnProperty.call(item, 'status') && item.status !== 'published') return null;
    if (item.draft === true || item.visibility === 'private') return null;
    var url, base;
    try { base = new URL(origin); url = new URL(item.url, origin); } catch (error) { return null; }
    if (!/^https?:$/.test(base.protocol) || base.origin !== origin || url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
    // Reject normalized tricks (backslashes, dot segments, encoded path parts, protocol-relative URLs).
    if (item.url !== url.pathname && item.url !== origin + url.pathname) return null;
    var match = /^\/volthaber\/([a-z0-9][a-z0-9-]{1,88}[a-z0-9])\/$/.exec(url.pathname);
    if (!match || RESERVED.has(match[1])) return null;
    var title = text(item.title, 160, false), summary = text(item.summary, 400, true);
    if (title === null || summary === null) return null;
    return {u:url.pathname, t:title, keywords:(title + ' ' + summary).trim(), c:'haberler', kind:'VoltHaber'};
  }
  function normalizeEntries(items, origin) {
    if (!Array.isArray(items)) return [];
    var seen = new Set(), entries = [];
    items.forEach(function (item) {
      var entry = normalizeEntry(item, origin);
      if (entry && !seen.has(entry.u)) { seen.add(entry.u); entries.push(entry); }
    });
    return entries;
  }
  function failure() { return {ok:false, complete:false, entries:[]}; }

  async function readEntries(options) {
    options = options || {};
    var origin = host && host.location ? host.location.origin : (options.origin || 'https://voltguard.com.tr');
    if (host && options.origin && options.origin !== origin) return failure();
    var fetcher = options.fetch || (host && host.fetch ? host.fetch.bind(host) : null);
    if (typeof fetcher !== 'function' || typeof AbortController !== 'function') return failure();
    var timeout = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) ? Math.max(10, Math.min(options.timeoutMs, 15000)) : 6000;
    var controller = new AbortController(), timer, external = options.signal, resolveCancelled;
    var cancelled = new Promise(function (resolve) { resolveCancelled = resolve; });
    var abort = function () { controller.abort(); resolveCancelled(failure()); };
    if (external && external.aborted) return failure();
    if (external && external.addEventListener) external.addEventListener('abort', abort, {once:true});
    timer = setTimeout(abort, timeout);
    async function load() {
      var expectedPages = null, expectedTotal = null, rawCount = 0, seen = new Set(), entries = [];
      for (var page = 1; page <= MAX_PAGES; page++) {
        var response = await fetcher('/api/volthaber.php?action=list&page=' + page, {
          method:'GET', credentials:'omit', mode:'same-origin', cache:'no-store', redirect:'error',
          headers:{Accept:'application/json'}, signal:controller.signal
        });
        if (!response || !response.ok || controller.signal.aborted) return failure();
        var data = await response.json();
        if (!data || data.ok !== true || data.service !== 'vg-volthaber/1' || !Array.isArray(data.items)
          || data.page !== page || !Number.isInteger(data.pages) || data.pages < 1 || data.pages > MAX_PAGES
          || !Number.isInteger(data.total) || data.total < 0 || data.total > MAX_TOTAL
          || data.pages !== Math.max(1, Math.ceil(data.total / PAGE_SIZE))) return failure();
        if (expectedPages === null) { expectedPages = data.pages; expectedTotal = data.total; }
        if (data.pages !== expectedPages || data.total !== expectedTotal) return failure();
        var expectedLength = Math.min(PAGE_SIZE, Math.max(0, expectedTotal - (page - 1) * PAGE_SIZE));
        if (data.items.length !== expectedLength) return failure();
        rawCount += data.items.length;
        for (var i = 0; i < data.items.length; i++) {
          var entry = normalizeEntry(data.items[i], origin);
          if (!entry) continue; // Unsafe/non-canonical items never enter the directory.
          if (seen.has(entry.u)) return failure(); // Concurrent page movement: keep the known snapshot instead of deleting unseen items.
          seen.add(entry.u); entries.push(entry);
        }
        if (page === expectedPages) {
          if (rawCount !== expectedTotal || controller.signal.aborted) return failure();
          return {ok:true, complete:true, entries:entries, total:entries.length, sourceTotal:expectedTotal, checkedAt:new Date().toISOString()};
        }
      }
      return failure();
    }
    try { return await Promise.race([load().catch(failure), cancelled]); }
    finally {
      clearTimeout(timer);
      if (external && external.removeEventListener) external.removeEventListener('abort', abort);
    }
  }
  return Object.freeze({readEntries:readEntries, normalizeEntry:normalizeEntry, normalizeEntries:normalizeEntries});
}));
