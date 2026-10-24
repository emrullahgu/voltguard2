/*!
 * VoltGuard – vg-quote.js  (ortak teklif / iletişim gönderimi; window.VGQuote)
 * Teklif sihirbazı (js/factory.js), ana sayfa iletişim formu (js/main.js) ve VoltSim (js/voltsim/core.js) kullanır.
 * Tek uç nokta /contact.php'dir; ayrı bir teklif sistemi yoktur.
 *
 *   VGQuote.send(fields)   → Promise<{reference, message, duplicate, preview}>; hata: Error{kind, status, message}
 *                            kind: 'timeout' | 'network' | 'unsupported' | 'conflict' | 'rejected'
 *                            Başarı yalnızca sunucu JSON ile success:true VE geçerli talep numarası döndürürse kabul edilir:
 *                            PHP çalışmayan önizleme/statik barındırmada (404/405/HTML yanıtı) başarı gösterilmez.
 *   VGQuote.requestId()    → yeni talep kimliği. Aynı talep yeniden denenirken AYNI kimlik gönderilir; sunucu ikinci
 *                            kaydı açmaz ve ilk talep numarasını döndürür (api/lib/enquiry.php).
 *   VGQuote.stage(sim)     → simülasyon özetini YALNIZCA bu cihazda (localStorage) taşır; sunucuya göndermez. Teklif
 *                            sihirbazı özeti kullanıcıya gösterir, kullanıcı onay kutusunu işaretlemeden göndermez.
 *   VGQuote.staged() / unstage() / lines(sim)
 *   VGQuote.contact()      → telefon ve WhatsApp bağlantıları; sayfadaki ortak alt bilgiden (tools/shell/footer.html)
 *                            okunur, numara bu dosyada tutulmaz.
 */
(function () {
  'use strict';

  var ENDPOINT = '/contact.php';
  var TIMEOUT = 25000;                          // sunucu yanıt vermezse bekleme kesilir (talep yine ulaşmış olabilir)
  var KEY_STAGE = 'vg_quote_handoff_v1';
  var STAGE_TTL = 3 * 24 * 3600 * 1000;         // aktarılan özet 3 gün sonra kendiliğinden silinir
  var REF = /^VG-\d{6}-[A-HJ-NP-Z2-9]{5}$/;
  /* Sunucudaki sınırlarla aynı (api/lib/enquiry.php vg_enquiry_simulation) */
  var KINDS = { trafo: 'Trafo', pano: 'Elektrik pano', komp: 'Kompanzasyon', ges: 'GES' };
  var LIM = { title: 120, label: 100, value: 160, assumption: 300, inputs: 60, results: 40, assumptions: 20 };

  function line(v, max) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
  }

  /* ---- İletişim bilgileri: ortak alt bilgideki doğrulanmış bağlantılar ---- */
  function contact() {
    var root = document.getElementById('vgFooter') || document;
    var tel = root.querySelector('a[href^="tel:"]');
    var wa = root.querySelector('a[href^="https://wa.me/"]');
    return {
      tel: tel ? { href: tel.getAttribute('href'), text: tel.textContent.replace(/\s+/g, ' ').trim() } : null,
      wa: wa ? { href: wa.getAttribute('href') } : null
    };
  }
  /** Hata mesajlarına eklenecek kısa yönlendirme ("0545 … numarasını arayın ya da WhatsApp'tan yazın"). */
  function reachText() {
    var c = contact();
    if (c.tel && c.wa) return c.tel.text + ' numarasını arayabilir ya da WhatsApp’tan yazabilirsiniz.';
    if (c.tel) return c.tel.text + ' numarasını arayabilirsiniz.';
    return 'Sayfanın altındaki iletişim bilgilerinden bize ulaşabilirsiniz.';
  }

  /* ---- Talep kimliği ---- */
  function requestId() {
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    var out = 'q';
    for (var j = 0; j < 16; j++) out += ('0' + bytes[j].toString(16)).slice(-2);
    return out;
  }

  /* ---- Simülasyon özeti ---- */
  function normalize(sim) {
    if (!sim || typeof sim !== 'object' || !KINDS[sim.kind]) return null;
    var pairs = function (list, max) {
      return (Array.isArray(list) ? list : []).filter(function (r) { return Array.isArray(r) && line(r[0], 1); })
        .slice(0, max).map(function (r) { return [line(r[0], LIM.label), line(r[1], LIM.value) || '-']; });
    };
    var out = {
      v: 1,
      kind: sim.kind,
      title: line(sim.title, LIM.title) || KINDS[sim.kind],
      page: /^\/voltsim\/[a-z0-9-]{2,40}\/$/.test(sim.page || '') ? sim.page : '/voltsim/',
      version: /^[0-9A-Za-z._-]{1,32}$/.test(sim.version || '') ? sim.version : 'bilinmiyor',
      inputs: pairs(sim.inputs, LIM.inputs),
      results: pairs(sim.results, LIM.results),
      assumptions: (Array.isArray(sim.assumptions) ? sim.assumptions : []).map(function (a) { return line(a, LIM.assumption); })
        .filter(Boolean).slice(0, LIM.assumptions)
    };
    if (out.page === '/voltsim/' || (!out.inputs.length && !out.results.length)) return null;
    return out;
  }
  function stage(sim) {
    var n = normalize(sim);
    if (!n) return false;
    try { localStorage.setItem(KEY_STAGE, JSON.stringify({ at: Date.now(), sim: n })); return true; } catch (e) { return false; }
  }
  function staged() {
    var raw = null;
    try { raw = localStorage.getItem(KEY_STAGE); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var d = JSON.parse(raw);
      var age = Date.now() - (+d.at || 0);
      var n = age >= 0 && age < STAGE_TTL ? normalize(d.sim) : null;
      if (!n) unstage();
      return n;
    } catch (e) { unstage(); return null; }
  }
  function unstage() { try { localStorage.removeItem(KEY_STAGE); } catch (e) { /* yok say */ } }
  /** Kullanıcıya gösterilen ve sunucuya gidecek içeriğin satır satır metni (önizleme için). */
  function lines(sim) {
    var out = ['Simülasyon: ' + KINDS[sim.kind] + ' – ' + sim.title, 'Hesaplama sürümü: ' + sim.version];
    if (sim.inputs.length) { out.push('', 'Seçilen girdiler:'); sim.inputs.forEach(function (r) { out.push('• ' + r[0] + ': ' + r[1]); }); }
    if (sim.results.length) { out.push('', 'Sonuç özeti:'); sim.results.forEach(function (r) { out.push('• ' + r[0] + ': ' + r[1]); }); }
    if (sim.assumptions.length) { out.push('', 'Varsayımlar:'); sim.assumptions.forEach(function (a) { out.push('• ' + a); }); }
    return out;
  }

  /* ---- Gönderim ---- */
  function fail(kind, message, status, data) {
    var e = new Error(message);
    e.kind = kind; e.status = status || 0; e.data = data || null;
    return e;
  }
  function send(fields) {
    var body = new FormData();
    Object.keys(fields).forEach(function (k) { if (fields[k] != null) body.append(k, String(fields[k])); });
    var ac = typeof AbortController === 'function' ? new AbortController() : null;
    var timer, timedOut = false;
    var opts = { method: 'POST', body: body, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (ac) opts.signal = ac.signal;
    var request = Promise.resolve().then(function () { return fetch(ENDPOINT, opts); }).then(function (res) {
      var type = (res.headers && res.headers.get && res.headers.get('Content-Type')) || '';
      if (type && type.indexOf('json') < 0) {
        throw fail('unsupported', 'Bu sayfanın çalıştığı ortam form gönderimini desteklemiyor; talebiniz iletilmedi. Yazdıklarınız korundu. ' + reachText(), res.status);
      }
      return res.json().then(function (data) { return { res: res, data: data }; }, function () {
        throw fail('unsupported', 'Sunucudan geçerli bir yanıt alınamadı; talebiniz iletilmedi. Yazdıklarınız korundu. ' + reachText(), res.status);
      });
    }, function (err) {
      if (timedOut || (err && err.name === 'AbortError')) throw err;
      throw fail('network', 'Bağlantı kurulamadı; talebiniz iletilmedi. Yazdıklarınız korundu. İnternet bağlantınızı kontrol edip yeniden gönderin ya da ' + reachText());
    }).then(function (r) {
      var d = r.data && typeof r.data === 'object' ? r.data : {};
      if (r.res.ok && d.success === true && REF.test(String(d.reference || ''))) {
        return { reference: d.reference, message: String(d.message || ''), duplicate: !!d.duplicate, preview: !!d.preview };
      }
      if (r.res.ok && d.success === true) {
        throw fail('unsupported', 'Sunucu talep numarası vermedi; talebin alındığını doğrulayamıyoruz. Yazdıklarınız korundu. ' + reachText(), r.res.status);
      }
      if (r.res.status === 409 && d.code === 'already_received') throw fail('conflict', String(d.message || ''), 409, d);
      throw fail('rejected', String(d.message || 'Talebiniz iletilemedi. Yazdıklarınız korundu. ' + reachText()), r.res.status, d);
    });
    var deadline = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        timedOut = true;
        if (ac) ac.abort();
        reject(fail('timeout', 'Sunucudan yanıt alınamadı. Talebiniz ulaşmış olabilir; yeniden gönderdiğinizde aynı talep tekrar kaydedilmez. Yazdıklarınız korundu.'));
      }, TIMEOUT);
    });
    return Promise.race([request, deadline]).then(function (v) { clearTimeout(timer); return v; }, function (e) {
      clearTimeout(timer);
      throw e && e.kind ? e : fail('network', 'Bağlantı kurulamadı; talebiniz iletilmedi. Yazdıklarınız korundu. ' + reachText());
    });
  }

  window.VGQuote = {
    send: send, requestId: requestId, contact: contact, reachText: reachText,
    stage: stage, staged: staged, unstage: unstage, normalize: normalize, lines: lines, kinds: KINDS, refPattern: REF
  };
})();
