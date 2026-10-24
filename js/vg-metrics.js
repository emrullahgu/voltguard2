/*!
 * VoltGuard – vg-metrics.js
 * Birinci taraf, çerezsiz ve anonim ölçüm. Sunucu yalnızca günlük toplamları tutar (api/metrics.php).
 *
 * Gizlilik:
 *   - Çerez, localStorage/sessionStorage kimliği, parmak izi yoktur; her sayfa görüntülemesi bağımsızdır.
 *   - Tarayıcıda "Do Not Track" veya "Global Privacy Control" açıksa hiçbir istek gönderilmez.
 *   - Tam referrer adresi gönderilmez; yalnızca kategori (arama / sosyal / doğrudan / diğer / site içi) ve arama motoru adı.
 *   - Cihaz yalnızca sınıf olarak (mobil / tablet / masaüstü) gönderilir.
 *
 * Genel API:
 *   window.vgTrack(name, props)  izin verilen olaylar: sim_start, sim_complete, tool_use, tool_quote, quote_submit,
 *                                whatsapp_click, tel_click, newsletter_subscribe. props: { sim, tool, svc, via }.
 *   window.vgTrack.enabled       ölçüm açık mı (DNT/GPC, otomasyon veya statik barındırmada false)
 * Otomatik: sayfa görüntüleme, tel:/WhatsApp bağlantı tıklamaları, hesap aracı kullanımı ve "teklif iste" tıklaması.
 */
(function (w, d) {
  'use strict';
  if (w.vgTrack) return;

  var ENDPOINT = '/api/metrics.php?action=collect';
  var EVENTS = { sim_start: 1, sim_complete: 1, tool_use: 1, tool_quote: 1, quote_submit: 1, whatsapp_click: 1, tel_click: 1, newsletter_subscribe: 1 };
  var PROPS = ['sim', 'tool', 'svc', 'via'];
  var nav = w.navigator || {};

  function optedOut() {
    return nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || w.doNotTrack === '1' || nav.msDoNotTrack === '1' || nav.globalPrivacyControl === true;
  }
  var reason = optedOut() ? 'dnt' : !/^https?:$/.test(w.location.protocol) ? 'protocol'
    : nav.webdriver ? 'automation' : /\.netlify\.app$/i.test(w.location.hostname) ? 'static-host'
    : /^\/calisan(\/|$)/i.test(w.location.pathname) ? 'excluded' : '';
  var enabled = !reason;

  /* ---------- sınıflandırma (yalnızca tarayıcıda; ham değerler gönderilmez) ---------- */
  function normPath(p) {
    p = String(p || '/').toLowerCase().split(/[?#]/)[0] || '/';
    if (p === '/teklif-araclari.html') return '/hesaplama-araclari/';
    p = p.replace(/\/index\.html$/, '/');
    var m = p.match(/^\/hesaplama\/([a-z0-9-]+)\.html$/);
    if (m) p = '/hesaplama/' + m[1] + '/';
    return p.slice(0, 160);
  }
  var SEARCH = [[/(^|\.)google\./, 'google'], [/(^|\.)bing\.com$/, 'bing'], [/(^|\.)yandex\./, 'yandex'], [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
    [/(^|\.)yahoo\./, 'yahoo'], [/(^|\.)ecosia\.org$/, 'ecosia'], [/(^|\.)baidu\.com$/, 'baidu'],
    [/(^|\.)(search\.brave\.com|startpage\.com|qwant\.com|yaani\.com\.tr)$/, 'diger']];
  var SOCIAL = /(^|\.)(facebook\.com|fb\.me|instagram\.com|linkedin\.com|lnkd\.in|t\.co|twitter\.com|x\.com|youtube\.com|youtu\.be|whatsapp\.com|wa\.me|t\.me|telegram\.org|tiktok\.com|pinterest\.[a-z.]+|reddit\.com|threads\.net|eksisozluk\.com)$/;
  function referrer() {
    var ref = d.referrer, host = '';
    if (!ref) return { r: 'dogrudan' };
    if (/^android-app:\/\/com\.google\.android\.googlequicksearchbox/i.test(ref)) return { r: 'arama', se: 'google' };
    try { host = new URL(ref).hostname.toLowerCase(); } catch (e) { return { r: 'diger' }; }
    if (host === w.location.hostname.toLowerCase() || host.replace(/^www\./, '') === w.location.hostname.toLowerCase().replace(/^www\./, '')) return { r: 'ic' };
    for (var i = 0; i < SEARCH.length; i++) if (SEARCH[i][0].test(host)) return { r: 'arama', se: SEARCH[i][1] };
    if (SOCIAL.test(host)) return { r: 'sosyal' };
    return { r: 'diger' };
  }
  function device() {
    var ua = nav.userAgent || '';
    if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
    if (nav.userAgentData && nav.userAgentData.mobile) return 'mobil';
    if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'mobil';
    // iPadOS masaüstü kimliğiyle gelir: dokunmatik + Mac → tablet
    if (/Macintosh/i.test(ua) && nav.maxTouchPoints > 1) return 'tablet';
    return 'masaustu';
  }
  function toolSlug(path) {
    var m = path.match(/^\/hesaplama\/([a-z0-9-]+)\/$/);
    if (m) return m[1];
    m = path.match(/^\/araclar\/([a-z0-9-]+)(?:\/|\.html)?/);
    return m && m[1] !== 'index' ? 'arac-' + m[1] : '';
  }

  /* ---------- gönderim ---------- */
  var queue = [], timer = 0, seen = {};
  function post(events) {
    if (!events.length) return;
    var body = JSON.stringify({ v: 1, ev: events });
    try {
      if (nav.sendBeacon && nav.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    } catch (e) { /* sendBeacon reddetti: fetch ile dene */ }
    try {
      w.fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } })
        .catch(function () { /* ölçüm kritik değil */ });
    } catch (e) { /* eski tarayıcı */ }
  }
  function flush() {
    clearTimeout(timer); timer = 0;
    while (queue.length) post(queue.splice(0, 20));
  }
  function enqueue(ev, now) {
    if (!enabled) return false;
    queue.push(ev);
    if (now || queue.length >= 20) flush();
    else if (!timer) timer = setTimeout(flush, 1500);
    return true;
  }

  function track(name, props) {
    if (!EVENTS[name]) return false;
    var ev = { e: name, p: normPath(w.location.pathname) };
    props = props || {};
    PROPS.forEach(function (k) {
      if (typeof props[k] === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(props[k])) ev[k] = props[k];
    });
    // Aynı sayfa görüntülemesinde aynı simülasyon/araç olayı bir kez sayılır (oran hesapları şişmesin).
    if (/^(sim_start|sim_complete|tool_use|tool_quote)$/.test(name)) {
      var key = name + ':' + (ev.sim || ev.tool || '');
      if (seen[key]) return false;
      seen[key] = 1;
    }
    return enqueue(ev, /^(quote_submit|whatsapp_click|tel_click|newsletter_subscribe|tool_quote)$/.test(name));
  }
  track.enabled = enabled;
  track.reason = reason;
  w.vgTrack = track;
  if (!enabled) return;

  function pageview() {
    seen = {};
    var ref = referrer();
    var ev = { e: 'pageview', p: normPath(w.location.pathname), r: ref.r, d: device() };
    if (ref.se) ev.se = ref.se;
    enqueue(ev, true);
  }
  // Önceden işlenen (prerender) sayfa yalnızca gerçekten açıldığında sayılır.
  if (d.prerendering) d.addEventListener('prerenderingchange', pageview, { once: true });
  else pageview();
  w.addEventListener('pageshow', function (e) { if (e.persisted) pageview(); });
  w.addEventListener('pagehide', flush);
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') flush(); });

  /* ---------- otomatik olaylar ---------- */
  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/^tel:/i.test(href)) { track('tel_click'); return; }
    if (/^whatsapp:|(^|\/\/)(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(href)) { track('whatsapp_click'); return; }
    var tool = toolSlug(normPath(w.location.pathname));
    // Hesap aracındaki "Bu sonuçla teklif iste": iletişim formuna hizmet seçimiyle geçiş
    if (tool && /[?&]hizmet=[a-z0-9-]+/.test(href) && /#iletisim$/.test(href)) track('tool_quote', { tool: tool });
  }, true);

  var toolOnPage = toolSlug(normPath(w.location.pathname));
  if (toolOnPage) {
    var used = function (e) {
      if (!e.isTrusted || !e.target || !e.target.closest || !e.target.closest('main, .mini-calc, .tool-card, form')) return;
      track('tool_use', { tool: toolOnPage });
      d.removeEventListener('input', used, true);
      d.removeEventListener('change', used, true);
    };
    d.addEventListener('input', used, true);
    d.addEventListener('change', used, true);
  }
}(window, document));
