/*!
 * VoltGuard – vg-metrics.js
 * Birinci taraf, çerezsiz ve anonim ölçüm. Sunucu yalnızca günlük toplamları tutar (api/metrics.php).
 * Olay sözlüğü ve tetikleme kuralları: api/METRICS.md.
 *
 * Gizlilik:
 *   - Çerez, kalıcı kimlik, parmak izi yoktur; her sayfa görüntülemesi bağımsızdır.
 *   - Tarayıcıda "Do Not Track" veya "Global Privacy Control" açıksa hiçbir istek gönderilmez.
 *   - Tam referrer adresi gönderilmez; yalnızca kategori (arama / sosyal / doğrudan / diğer / site içi) ve arama motoru adı.
 *   - Cihaz yalnızca sınıf olarak (mobil / tablet / masaüstü) gönderilir.
 *   - Olay alanları yalnızca izin listesindeki kısaltmalardır: ad, telefon, e-posta, mesaj, dosya içeriği ve hesap girdileri
 *     hiçbir olaya girmez. Form hatalarında yalnızca alanın kimliği (ör. "telefon") gider, değeri asla.
 *
 * Genel API:
 *   window.vgTrack(name, props)       olay gönderir (izin verilmeyen ad/alan sessizce düşer)
 *   window.vgTrack.form(el, id, opt)  teklif formu izleyici: quote_start / quote_step / quote_validation_error /
 *                                     quote_abandon / quote_submit_fail; .fields(tas) contact.php'ye eklenecek vg_ctx_* bağlamı
 *   window.vgTrack.quoteFields(tas)   aynı bağlam (form izleyicisi olmayan gönderimler için)
 *   window.vgTrack.enabled / .test    ölçüm açık mı / bu oturum test verisi mi
 * Test verisi: ?vg_test=1 (bu sekmede açık kalır, ?vg_test=0 kapatır) ya da yerel adres. Test olayları sunucuda ayrı
 * kovaya yazılır ve canlı raporda görünmez. Otomasyon (navigator.webdriver) yalnızca test modunda ölçülür.
 * quote_submit_success İSTEMCİDEN GÖNDERİLMEZ: talebi backend kabul ettiğinde contact.php sayar.
 */
(function (w, d) {
  'use strict';
  if (w.vgTrack) return;

  var ENDPOINT = '/api/metrics.php?action=collect';
  var EVENTS = { simulation_open: 1, simulation_run: 1, simulation_result: 1, simulation_error: 1, task_complete: 1,
    scenario_save: 1, report_download: 1, tool_use: 1, tool_result: 1, service_cta_click: 1, quote_start: 1, quote_step: 1,
    quote_validation_error: 1, quote_abandon: 1, quote_submit_fail: 1, contact_click: 1, newsletter_subscribe: 1 };
  /* Önbellekte kalmış eski çağrılar (sürüm 1) yeni adlara çevrilir; quote_submit bilerek yok sayılır. */
  var LEGACY = { sim_start: 'simulation_run', sim_complete: 'task_complete', tel_click: 'contact_click', whatsapp_click: 'contact_click' };
  var PROPS = ['sim', 'tool', 'kind', 'fmt', 'to', 'form', 'field', 'last', 'reason', 'ch', 'd', 'src', 'tas'];
  /* Sayfa görüntülemesi başına bir kez sayılanlar (tekrar tıklama / yeniden hesap oranları şişirmesin). */
  var ONCE = /^(simulation_|task_complete|tool_|scenario_save|report_download|service_cta_click|quote_start|quote_step|quote_validation_error|quote_abandon|contact_click)/;
  /* Sayfadan ayrılmadan önce kaybolmasın diye hemen gönderilenler. */
  var NOW = /^(quote_|service_cta_click|contact_click|newsletter_subscribe|report_download|scenario_save|simulation_error)/;
  var nav = w.navigator || {};

  function optedOut() {
    return nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || w.doNotTrack === '1' || nav.msDoNotTrack === '1' || nav.globalPrivacyControl === true;
  }
  function testMode() {
    var flag = '';
    try {
      var q = /[?&]vg_test=([01])\b/.exec(w.location.search || '');
      if (q) w.sessionStorage.setItem('vg_test', q[1]);
      flag = w.sessionStorage.getItem('vg_test') || '';
    } catch (e) { /* depolama kapalı: yalnızca adresteki bayrak geçerli */
      flag = /[?&]vg_test=1\b/.test(w.location.search || '') ? '1' : '';
    }
    if (flag === '1') return true;
    return /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost|.+\.test)$/i.test(w.location.hostname || '');
  }
  var isTest = testMode();
  var reason = optedOut() ? 'dnt' : !/^https?:$/.test(w.location.protocol) ? 'protocol'
    : nav.webdriver && !isTest ? 'automation' : /\.netlify\.app$/i.test(w.location.hostname) ? 'static-host'
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
  function sameSite(host) {
    var here = String(w.location.hostname || '').toLowerCase();
    return host === here || host.replace(/^www\./, '') === here.replace(/^www\./, '');
  }
  function referrer() {
    var ref = d.referrer, host = '';
    if (!ref) return { r: 'dogrudan' };
    if (/^android-app:\/\/com\.google\.android\.googlequicksearchbox/i.test(ref)) return { r: 'arama', se: 'google' };
    try { host = new URL(ref).hostname.toLowerCase(); } catch (e) { return { r: 'diger' }; }
    if (sameSite(host)) return { r: 'ic' };
    for (var i = 0; i < SEARCH.length; i++) if (SEARCH[i][0].test(host)) return { r: 'arama', se: SEARCH[i][1] };
    if (SOCIAL.test(host)) return { r: 'sosyal' };
    return { r: 'diger' };
  }
  /* Teklif akışının kaynağı: site içinden gelindiyse önceki sayfanın yolu, değilse bu sayfa. Yalnızca yol; sorgu yok. */
  function sourcePath() {
    try {
      var u = new URL(d.referrer);
      if (sameSite(u.hostname.toLowerCase()) && normPath(u.pathname) !== normPath(w.location.pathname)) return normPath(u.pathname);
    } catch (e) { /* referrer yok / geçersiz */ }
    return normPath(w.location.pathname);
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
  /* Cihaz sınıfı sayfa açılışında bir kez belirlenir; aynı sayfadaki tüm olaylar (terk dahil) aynı sınıfı taşır. */
  var DEVICE = device();
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
    var payload = { v: 2, ev: events };
    if (isTest) payload.t = 1;
    var body = JSON.stringify(payload);
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
    props = props || {};
    if (LEGACY[name]) {
      if (name === 'tel_click' || name === 'whatsapp_click') props = { ch: name === 'tel_click' ? 'tel' : 'whatsapp' };
      name = LEGACY[name];
    }
    if (!EVENTS[name]) return false;
    var ev = { e: name, p: normPath(w.location.pathname) };
    PROPS.forEach(function (k) {
      var v = props[k];
      if (k === 'src' && typeof v === 'string' && /^\/[a-z0-9\/._-]{0,159}$/.test(v)) ev[k] = v;
      else if (k !== 'src' && typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(v)) ev[k] = v;
    });
    if (typeof props.step === 'number' && props.step >= 1 && props.step <= 9) ev.step = Math.floor(props.step);
    if (ONCE.test(name)) {
      var key = [name, ev.sim, ev.tool, ev.kind, ev.fmt, ev.to, ev.form, ev.field, ev.step, ev.ch].join(':');
      if (seen[key]) return false;
      seen[key] = 1;
    }
    return enqueue(ev, NOW.test(name));
  }
  function quoteFields(tas) {
    if (!enabled) return {};
    var out = { vg_ctx_src: sourcePath(), vg_ctx_dev: DEVICE };
    if (tas === 'sonuc') out.vg_ctx_tas = 'sonuc';
    if (isTest) out.vg_ctx_t = '1';
    return out;
  }

  /*
   * Teklif formu izleyicisi. opt.fields: { 'alan-id-veya-adı': 'izinli-alan-kimliği' } (VG_METRICS_FIELDS).
   *  - quote_start: formdaki ilk GERÇEK kullanıcı girişi (input/change, isTrusted); odaklanma tek başına sayılmaz.
   *  - step(n): çok adımlı formda n. adıma geçildi (n ≥ 2; 1. adım = başlangıç).
   *  - errors([alan…]): gönderim / ileri denemesinde istemci doğrulamasına takılan alanlar (alan başına bir kez).
   *  - fail(neden): istek sunucuya ulaşmadı ya da yanıt okunamadı (ag | zaman-asimi | gecersiz-yanit). Sunucunun
   *    reddettiği talepler istemciden değil contact.php'den sayılır.
   *  - done(): backend kabul etti → terk sayılmaz (başarı sunucuda sayılır).
   *  - quote_abandon: başlamış ve kabul edilmemiş form sayfadan ayrılırken; son odaklanılan alan ya da son adım.
   */
  function form(el, id, opt) {
    opt = opt || {};
    var map = opt.fields || {};
    var api = { started: false, finished: false, last: '', stepNo: 1, tas: 'yok' };
    function slug(target) {
      if (!target) return '';
      return map[target.id] || map[target.name] || '';
    }
    api.start = function () {
      if (api.started) return;
      api.started = true;
      track('quote_start', { form: id, d: DEVICE, src: sourcePath(), tas: api.tas });
    };
    api.draft = function (has) { api.tas = has ? 'sonuc' : 'yok'; };
    api.step = function (n) {
      api.stepNo = n;
      api.start();
      if (n >= 2) track('quote_step', { form: id, step: n });
    };
    api.errors = function (list) {
      api.start();
      (list || []).forEach(function (f) { var s = map[f] || f; track('quote_validation_error', { form: id, field: s, d: DEVICE }); });
    };
    api.fail = function (why) { track('quote_submit_fail', { form: id, reason: why }); };
    api.done = function () { api.finished = true; };
    /* Kabul edilen talepten sonra aynı sayfada yeni bir talep: yeni başlangıç/hata/adım olarak sayılır. */
    api.reset = function () {
      api.started = false; api.finished = false; api.last = ''; api.stepNo = 1;
      Object.keys(seen).forEach(function (k) { if (/^quote_/.test(k) && k.indexOf(':' + id + ':') > -1) delete seen[k]; });
    };
    api.fields = function () { return quoteFields(api.tas); };
    if (!el || !el.addEventListener) return api;
    var onInput = function (e) { if (e.isTrusted) { api.last = slug(e.target) || api.last; api.start(); } };
    el.addEventListener('input', onInput, true);
    el.addEventListener('change', onInput, true);
    el.addEventListener('focusin', function (e) { var s = slug(e.target); if (s) api.last = s; }, true);
    w.addEventListener('pagehide', function () {
      if (!api.started || api.finished) return;
      api.finished = true;
      track('quote_abandon', { form: id, last: api.stepNo > 1 ? 'adim-' + api.stepNo : (api.last || 'baslangic'), d: DEVICE });
    });
    return api;
  }

  track.enabled = enabled;
  track.reason = reason;
  track.test = isTest;
  track.quoteFields = quoteFields;
  track.form = form;
  w.vgTrack = track;
  if (!enabled) return;

  function pageview() {
    seen = {};
    var ref = referrer();
    var ev = { e: 'pageview', p: normPath(w.location.pathname), r: ref.r, d: DEVICE };
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
  /* Teklif formuna götüren bağlantı: ana sayfa #iletisim (ör. /?hizmet=x#iletisim) ya da fabrika teklif sihirbazı. */
  function quoteTarget(a) {
    var forced = a.getAttribute('data-vg-cta');
    if (forced === 'iletisim' || forced === 'teklif') return forced;
    var u;
    try { u = new URL(a.getAttribute('href'), w.location.href); } catch (e) { return ''; }
    if (!sameSite(u.hostname.toLowerCase())) return '';
    var p = normPath(u.pathname);
    if ((u.hash === '#iletisim' && p === '/') || /^\/iletisim(?:\.html|\/)?$/.test(p)) return 'iletisim';
    if (/^#teklif(-sihirbazi)?$/.test(u.hash) && /^\/fabrika-cozumleri(\.html|\/)?$/.test(p)) return 'teklif';
    return '';
  }
  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    // İletişim NİYETİ: gerçekleşmiş görüşme, nitelikli müşteri ya da satış değildir.
    if (/^tel:/i.test(href)) { track('contact_click', { ch: 'tel' }); return; }
    if (/^mailto:/i.test(href)) { track('contact_click', { ch: 'eposta' }); return; }
    if (/^whatsapp:|(^|\/\/)(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(href)) { track('contact_click', { ch: 'whatsapp' }); return; }
    var to = quoteTarget(a);
    if (to) track('service_cta_click', { to: to });
  }, true);

  var toolOnPage = toolSlug(normPath(w.location.pathname));
  if (toolOnPage) {
    var watchResult = function () {
      // Hesap aracı sonucu: kullanıcı girdisinden SONRA sonuç kutusunun metni değişip dolu kaldığında (bir kez).
      var box = d.querySelector('.mini-calc__result-value, .tool-result__amount');
      if (!box || typeof MutationObserver !== 'function') return;
      var before = (box.textContent || '').trim();
      var mo = new MutationObserver(function () {
        var now = (box.textContent || '').trim();
        if (now && now !== before && !/^[-–—]?$/.test(now)) { track('tool_result', { tool: toolOnPage }); mo.disconnect(); }
      });
      mo.observe(box, { childList: true, characterData: true, subtree: true });
    };
    var used = function (e) {
      if (!e.isTrusted || !e.target || !e.target.closest || !e.target.closest('main, .mini-calc, .tool-card, form')) return;
      if (e.target.closest('#contactForm, .fx-wizard')) return;
      track('tool_use', { tool: toolOnPage });
      watchResult();
      d.removeEventListener('input', used, true);
      d.removeEventListener('change', used, true);
    };
    d.addEventListener('input', used, true);
    d.addEventListener('change', used, true);
  }
}(window, document));
