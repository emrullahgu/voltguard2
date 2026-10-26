/* hesap/buyume-paneli.html — yalnızca tools/metrics-admin.php ile yetkilendirilmiş yöneticiler için büyüme paneli.
 * Veri: GET /api/metrics.php?action=dashboard&days=…&mode=live|test (oturum + X-VG-CSRF). Grafikler satır içi SVG/HTML'dir.
 * Veri olmayan yerde sayı uydurulmaz: "Veri henüz mevcut değil" gösterilir. Test verisi canlı veriyle hiçbir yerde birleşmez.
 * Olay sözlüğü ve hipotez ölçütleri: api/METRICS.md. */
(function () {
  'use strict';
  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) {
    var gateEl = document.querySelector('[data-vg-gate]');
    if (gateEl) { gateEl.hidden = false; gateEl.innerHTML = '<div class="vg-section vg-acct-state vg-acct-state--error" role="alert"><h2>Sayfa tam yüklenemedi</h2><p>Hesap betikleri indirilemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.</p></div>'; }
    return;
  }
  var UI = window.VG.AccountUI;
  var esc = UI.esc;
  var $ = function (id) { return document.getElementById(id); };
  var NO_DATA = '<p class="gp-empty"><strong>Veri henüz mevcut değil.</strong> Seçilen aralıkta bu gösterge için kayıt yok.</p>';
  var LOW_N = 30; // bu sayının altındaki paydalarla hesaplanan oranlar "düşük örneklem" olarak işaretlenir
  var SIM_NAMES = { pano: 'Elektrik Pano', ges: 'GES', trafo: 'Trafo', sarj: 'Şarj İstasyonu', res: 'RES', komp: 'Kompanzasyon',
    topraklama: 'Topraklama', motor: 'Motor & PLC', ups: 'UPS & Jeneratör', yangin: 'Yangın Algılama', selektivite: 'Selektivite',
    kalite: 'Enerji Kalitesi', yildirim: 'Yıldırım Koruma', pompa: 'Pompa & VFD', depolama: 'Depolama & Hibrit',
    ariza: 'Arıza Tespit Laboratuvarı', konveyor: 'Konveyör & SCADA', fabrika: 'Fabrika' };
  var REF_NAMES = { arama: 'Arama motoru (organik)', sosyal: 'Sosyal medya', dogrudan: 'Doğrudan / yer imi', diger: 'Diğer siteler' };
  var DEV_NAMES = { mobil: 'Mobil', tablet: 'Tablet', masaustu: 'Masaüstü', '(bilinmiyor)': 'Bilinmiyor (DNT/GPC ya da eski istemci)' };
  var SE_NAMES = { google: 'Google', bing: 'Bing', yandex: 'Yandex', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', ecosia: 'Ecosia', baidu: 'Baidu', diger: 'Diğer' };
  var FORM_NAMES = { iletisim: 'İletişim formu', teklif: 'Fabrika teklif sihirbazı' };
  var FIELD_NAMES = { ad: 'Ad soyad', telefon: 'Telefon', eposta: 'E-posta', konu: 'Hizmet alanı', hizmet: 'İlgilenilen hizmet', mesaj: 'Mesaj',
    guvenlik: 'Güvenlik doğrulaması', sektor: 'Sektör', trafo: 'Trafo', hizmetler: 'Hizmetler', aciliyet: 'Aciliyet', il: 'İl', not: 'Not',
    diger: 'Diğer alan', baslangic: 'Alan seçilmeden' };
  var REJECT_NAMES = { invalid_name: 'Geçersiz ad', invalid_phone: 'Geçersiz telefon', invalid_email: 'Geçersiz e-posta',
    contact_required: 'Telefon / e-posta yok', invalid_subject: 'Hizmet alanı seçilmemiş', invalid_message: 'Mesaj uzunluğu / içeriği',
    invalid_form: 'Form bilgisi eksik', captcha_required: 'Güvenlik doğrulaması yok', captcha_invalid: 'Güvenlik doğrulaması geçersiz',
    captcha_unavailable: 'Doğrulama servisine erişilemedi', rate_limited: 'Hız sınırı', mail_unavailable: 'E-posta gönderimi kullanılamadı',
    rejected: 'Spam tuzağı (honeypot)' };
  var FAIL_NAMES = { ag: 'Bağlantı kurulamadı', 'zaman-asimi': 'Zaman aşımı (talep ulaşmış olabilir)', 'gecersiz-yanit': 'Okunamayan sunucu yanıtı' };
  var SIM_ERR = { webgl: 'WebGL açılamadı (2D şemaya geçildi)', sahne: '3D sahne kurulamadı', hesap: 'Hesap motoru hatası',
    calisma: 'Çalışma sırasında hata', rapor: 'PDF rapor üretilemedi', dosya: 'Proje dosyası okunamadı' };
  var SUBJECT_NAMES = { elektrik: 'Elektrik', elektronik: 'Elektronik / gömülü', otomasyon: 'Otomasyon', mekanik: 'Mekanik', diger: 'Diğer / genel' };
  var CH_NAMES = { tel: 'Telefon bağlantısı', whatsapp: 'WhatsApp bağlantısı', eposta: 'E-posta bağlantısı' };
  var days = 30, mode = 'live', csrf = '', loading = false, myId = '';

  function nf(n) { return Number(n || 0).toLocaleString('tr-TR'); }
  function pct(part, whole, digits) {
    if (!whole) return '—';
    return '%' + (part / whole * 100).toLocaleString('tr-TR', { maximumFractionDigits: digits === undefined ? 1 : digits });
  }
  /* Payda küçükse oran yanında uyarı: düşük örneklemle kesin sonuç çıkarılmaz. */
  function rate(part, whole, digits) {
    var r = pct(part, whole, digits);
    return whole && whole < LOW_N ? r + ' <span class="gp-pill gp-pill--wait" title="Payda ' + LOW_N + '’dan küçük">düşük örneklem</span>' : r;
  }
  function label(slug) { return String(slug).replace(/^arac-/, 'Uygulama: ').replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }
  function itemName(id) {
    if (/^sim-/.test(id)) { var s = id.slice(4); return 'VoltSim · ' + (SIM_NAMES[s] || label(s)); }
    return label(id);
  }
  function fieldName(k) {
    var m = /^adim-(\d)$/.exec(k);
    return m ? m[1] + '. adımda ayrıldı' : (FIELD_NAMES[k] || k);
  }
  function sumMap(m) { return Object.keys(m || {}).reduce(function (s, k) { return s + (+m[k] || 0); }, 0); }
  function sorted(m) { return Object.keys(m || {}).map(function (k) { return [k, +m[k] || 0]; }).sort(function (a, b) { return b[1] - a[1]; }); }
  function fmtDate(s) { return s ? esc(String(s).split('-').reverse().join('.')) : '—'; }

  /* ---------- bileşenler ---------- */
  function hbars(rows, names, total) {
    if (!rows.length || !total) return NO_DATA;
    var max = rows[0][1] || 1;
    return '<ul class="gp-hbars">' + rows.map(function (r) {
      return '<li><span>' + esc(names && names[r[0]] ? names[r[0]] : r[0]) + '</span><b>' + nf(r[1]) + ' · ' + pct(r[1], total) + '</b>' +
        '<span class="gp-track" aria-hidden="true"><span class="gp-fill" style="width:' + Math.max(2, Math.round(r[1] / max * 100)) + '%"></span></span></li>';
    }).join('') + '</ul>';
  }
  function table(head, rows, caption) {
    return '<div class="gp-table-wrap"><table><caption class="vg-sr-only">' + esc(caption) + '</caption><thead><tr>' + head.map(function (h, i) {
      return '<th scope="col"' + (i ? ' class="n"' : '') + '>' + esc(h) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
      return '<tr>' + r.map(function (c, i) { return i ? '<td class="n">' + c + '</td>' : '<td>' + c + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  }
  function mapTable(map, names, head, caption) {
    var rows = sorted(map);
    if (!rows.length) return '<p class="gp-note">Kayıt yok.</p>';
    return table(head, rows.map(function (r) { return [esc(names ? (typeof names === 'function' ? names(r[0]) : (names[r[0]] || r[0])) : r[0]), nf(r[1])]; }), caption);
  }

  // Günlük grafik: sütun = sayfa görüntüleme, çizgi = ziyaret (aynı birim, tek eksen). Her sütunun <title>'ı ipucudur.
  function dailyChart(series) {
    var total = series.reduce(function (s, d) { return s + d.pv; }, 0);
    if (!total) return NO_DATA;
    var W = 760, H = 240, L = 44, R = 10, T = 12, B = 30, iw = W - L - R, ih = H - T - B;
    var max = Math.max.apply(null, series.map(function (d) { return d.pv; })) || 1;
    var step = Math.pow(10, Math.floor(Math.log10(max)));
    var top = Math.max(2, Math.ceil(max / step) * step);
    if (top % 2) top += step === 1 ? 1 : step;           // orta çizgi tam sayı olsun
    var bw = iw / series.length;
    var y = function (v) { return T + ih - v / top * ih; };
    var out = ['<svg class="gp-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="gp-daily-desc"><desc id="gp-daily-desc">Günlük sayfa görüntüleme (sütun) ve ziyaret (çizgi); toplam ' + nf(total) + ' görüntüleme.</desc>'];
    [0, .5, 1].forEach(function (f) {
      var v = Math.round(top * f);
      out.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#e5e9f0" style="stroke:var(--th-border,#e5e9f0)" stroke-width="1"/>');
      out.push('<text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + nf(v) + '</text>');
    });
    var labelEvery = Math.ceil(series.length / 8);
    series.forEach(function (d, i) {
      var x = L + i * bw, h = d.pv / top * ih, w = Math.max(1, bw - 2);
      out.push('<g><title>' + esc(d.d) + ': ' + nf(d.pv) + ' görüntüleme, ' + nf(d.en) + ' ziyaret' + (d.none ? ' (veri yok)' : '') + '</title>' +
        '<rect x="' + (x + 1) + '" y="' + T + '" width="' + w + '" height="' + ih + '" fill="transparent"/>' +
        (h > 0 ? '<rect x="' + (x + 1) + '" y="' + (T + ih - h) + '" width="' + w + '" height="' + h + '" rx="' + Math.min(3, w / 2) + '" fill="#93b4f5"/>' : '') + '</g>');
      if (i % labelEvery === 0) out.push('<text x="' + (x + bw / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(d.d.slice(5).split('-').reverse().join('.')) + '</text>');
    });
    out.push('<polyline fill="none" stroke="#0a1628" style="stroke:var(--th-heading,#0a1628)" stroke-width="2" stroke-linejoin="round" points="' + series.map(function (d, i) {
      return (L + i * bw + bw / 2).toFixed(1) + ',' + y(d.en).toFixed(1);
    }).join(' ') + '"/>');
    out.push('</svg>');
    out.push('<ul class="gp-legend"><li><i style="background:#93b4f5"></i>Sayfa görüntüleme</li><li><i style="background:var(--th-heading,#0a1628)"></i>Ziyaret (dışarıdan giriş)</li></ul>');
    out.push('<details><summary>Tablo olarak göster</summary>' + table(['Gün', 'Görüntüleme', 'Ziyaret', 'Kullanım', 'Sonuç', 'Teklif başl.', 'Kabul'], series.slice().reverse().map(function (d) {
      return [esc(d.d) + (d.none ? ' <small>(veri yok)</small>' : ''), nf(d.pv), nf(d.en), nf(d.use), nf(d.res), nf(d.qs), nf(d.ok)];
    }), 'Günlük değerler') + '</details>');
    return out.join('');
  }

  /* ---------- bölümler ---------- */
  function coverage(data) {
    var c = data.coverage, legacy = sumMap(c.legacy);
    var rows = [
      ['Ölçüm dönemi', fmtDate(data.range.from) + ' – ' + fmtDate(data.range.to)],
      ['Veri kümesi', mode === 'test' ? 'Test (canlı rapordan ayrı)' : 'Canlı (voltguard.com.tr)'],
      ['Veri olan gün', nf(c.daysWithData) + ' / ' + nf(c.daysInRange)],
      ['İlk veri günü', fmtDate(c.firstDate)],
      ['Huni olaylarının başladığı gün', c.schemaSince ? fmtDate(c.schemaSince) : 'Henüz yok'],
      ['Toplamlara katılmayan bot isteği', nf(c.bots)],
      ['Hız sınırına takılan olay', nf(c.limited)],
      ['Eski sürüm olayı (yalnızca sayıldı)', nf(legacy)]
    ];
    var html = '<dl class="gp-cov">' + rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd></div>'; }).join('') + '</dl>';
    var notes = [];
    if (c.missingDays) notes.push(nf(c.missingDays) + ' günde hiç kayıt yok (son eksik günler: ' + c.missingSample.map(fmtDate).join(', ') + '). Bu günler sıfır trafik değil, ölçüm kaydının olmadığı günlerdir.');
    if (c.schemaSince && data.range.from < c.schemaSince) notes.push('Araç sonucu, teklif başlangıcı, form hataları ve sunucu kabulü ' + fmtDate(c.schemaSince) + ' tarihinden itibaren ölçülüyor; önceki günler bu göstergelerde boştur.');
    notes.push('Do Not Track / Global Privacy Control açık tarayıcılar ve otomasyon ölçülmez (miktarı bilinemez). Kabul edilen talepler sunucuda sayıldığı için bu tarayıcılardan gelenler de sayılır, ancak kaynak sayfa ve cihaz "bilinmiyor" görünür.');
    notes.push('Saklama: canlı günlük toplamlar 400 gün, test verisi 30 gün; kişi bazlı kayıt yoktur.');
    return html + notes.map(function (n) { return '<p class="gp-note">' + n + '</p>'; }).join('');
  }

  function kpis(data) {
    var t = data.totals;
    var tiles = [
      ['Ziyaret', nf(t.entries), nf(t.pv) + ' sayfa görüntüleme'],
      ['Araç / simülasyon kullanımı', nf(t.toolUse + t.simRun), nf(t.toolUse) + ' araç · ' + nf(t.simRun) + ' simülasyon'],
      ['Sonuç inceleme', nf(t.toolResult + t.simResult), nf(t.reports) + ' rapor indirme'],
      ['Teklif başlangıcı', nf(t.quoteStart), nf(t.ctaClicks) + ' teklif çağrısı tıklaması'],
      ['Kabul edilen talep (backend)', nf(t.quoteAccepted), nf(t.quoteRejected) + ' sunucu reddi'],
      ['İletişim tıklaması (niyet)', nf(t.contactClicks), 'görüşme / satış değildir']
    ];
    return tiles.map(function (x) { return '<div class="gp-kpi"><span>' + esc(x[0]) + '</span><strong>' + esc(x[1]) + '</strong><small>' + esc(x[2]) + '</small></div>'; }).join('');
  }

  var FUNNEL = {
    content: ['İçeriğe erişim', 'Sayfa görüntüleme'],
    use: ['Araç / simülasyon kullanımı', 'Hesap aracında ilk gerçek girdi + simülasyon çalıştırma'],
    result: ['Sonuç inceleme', 'Girdi değiştirildikten sonra geçerli sonuç (araç / simülasyon)'],
    quote_start: ['Teklif başlangıcı', 'Teklif / iletişim formunda ilk gerçek giriş'],
    accepted: ['Backend tarafından kabul edilen talep', 'contact.php talebi kabul etti ve teslim etti (sunucu sayımı)']
  };
  function funnel(data) {
    if (!data.funnel[0].n) return NO_DATA;
    var max = data.funnel[0].n || 1;
    return '<ol class="gp-funnel">' + data.funnel.map(function (s, i) {
      var prev = i ? data.funnel[i - 1].n : 0;
      return '<li><span><strong>' + esc(FUNNEL[s.id][0]) + '</strong></span><b>' + nf(s.n) + (i ? ' · önceki adıma göre ' + rate(s.n, prev) : '') + '</b>' +
        '<span class="gp-track" aria-hidden="true"><span class="gp-fill" style="width:' + (s.n ? Math.max(1.5, s.n / max * 100) : 0) + '%"></span></span>' +
        '<small>' + esc(FUNNEL[s.id][1]) + '</small></li>';
    }).join('') + '</ol><p class="gp-note">Adımlar ayrı ayrı sayılan toplamlardır; çerezsiz ölçümde aynı kişinin adımları birbirine bağlanmaz. Oranlar kaba geçiş göstergesidir, kişi bazlı dönüşüm oranı değildir. Formu doğrudan açan ziyaretçi araç adımını atlayabilir.</p>';
  }

  function accepted(data) {
    var f = data.forms, total = f.iletisim.accepted + f.teklif.accepted;
    var rows = ['iletisim', 'teklif'].map(function (k) {
      var x = f[k];
      return [esc(FORM_NAMES[k]), nf(x.start), '<strong>' + nf(x.accepted) + '</strong>', nf(x.rejected), nf(x.fail), rate(x.accepted, x.start)];
    });
    var html = '<p class="gp-note" style="margin-top:0">Toplam <strong>' + nf(total) + '</strong> talep backend tarafından kabul edildi. Bu sayı yalnızca <code>contact.php</code> talebi doğrulayıp teslim ettiğinde artar; aynı talebin yeniden gönderimi sayılmaz. Nitelikli müşteri ya da satış anlamına gelmez.</p>';
    html += table(['Form', 'Başlangıç', 'Kabul', 'Sunucu reddi', 'Ağ / yanıt hatası', 'Kabul / başlangıç'], rows, 'Forma göre kabul edilen talepler');
    if (!total) return html;
    var subjects = {}, draft = { sonuc: 0, yok: 0 }, devices = {};
    ['iletisim', 'teklif'].forEach(function (k) {
      Object.keys(f[k].subjects).forEach(function (s) { subjects[s] = (subjects[s] || 0) + f[k].subjects[s]; });
      Object.keys(f[k].draft).forEach(function (s) { draft[s] = (draft[s] || 0) + f[k].draft[s].accepted; });
      Object.keys(f[k].devices).forEach(function (s) { devices[s] = (devices[s] || 0) + f[k].devices[s].accepted; });
    });
    return html + '<div class="gp-cols"><div><h3>Hizmet alanı</h3>' + mapTable(subjects, SUBJECT_NAMES, ['Alan', 'Kabul'], 'Hizmet alanına göre') + '</div>' +
      '<div><h3>Araç / VoltSim özeti eklenmiş mi</h3>' + mapTable(draft, { sonuc: 'Sonuç özeti eklendi', yok: 'Özet yok' }, ['Durum', 'Kabul'], 'Özet eklenme durumu') + '</div>' +
      '<div><h3>Cihaz</h3>' + mapTable(devices, DEV_NAMES, ['Cihaz', 'Kabul'], 'Cihaza göre kabul') + '</div></div>';
  }

  function entryPages(data) {
    if (!data.entryPages.length) return NO_DATA;
    return table(['Sayfa', 'Teklif çağrısı tıklaması', 'Teklif başlangıcı (kaynak)', 'Kabul edilen talep (kaynak)'], data.entryPages.map(function (p) {
      return ['<code>' + esc(p.page) + '</code>', nf(p.cta), nf(p.starts), nf(p.accepted)];
    }), 'Teklif akışına geçiş sağlayan sayfalar') + '<p class="gp-note">Teklif çağrısı: ana sayfa iletişim formuna (<code>/#iletisim</code>) ya da fabrika teklif sihirbazına götüren bağlantı tıklaması (sayfa görüntülemesi başına bir kez). Kaynak: formu açmadan önce gezilen site içi sayfa; siteye doğrudan form sayfasından girildiyse form sayfasının kendisi. "(bilinmiyor)": DNT/GPC açık tarayıcıdan gelen kabul.</p>';
  }

  function formsSection(data) {
    var f = data.forms;
    if (!f.iletisim.start && !f.teklif.start && !f.iletisim.rejected && !f.teklif.rejected) return NO_DATA;
    return ['iletisim', 'teklif'].map(function (k) {
      var x = f[k];
      if (!x.start && !x.rejected && !x.fail) return '<h3>' + esc(FORM_NAMES[k]) + '</h3><p class="gp-note">Kayıt yok.</p>';
      var parts = ['<h3>' + esc(FORM_NAMES[k]) + '</h3><div class="gp-cols">'];
      if (k === 'teklif') {
        var steps = [['1. adım (başlangıç)', x.start]].concat(Object.keys(x.steps).map(function (s) { return [s + '. adıma geçiş', x.steps[s]]; }));
        parts.push('<div><h3>Ulaşılan adım</h3>' + table(['Adım', 'Sayı', 'Başlangıca göre'], steps.map(function (s) { return [esc(s[0]), nf(s[1]), rate(s[1], x.start, 0)]; }), 'Sihirbaz adımları') + '</div>');
      }
      parts.push('<div><h3>İstemci doğrulama hatası (alan)</h3>' + mapTable(x.errors, fieldName, ['Alan', 'Hata'], 'Alan hataları') + '</div>');
      parts.push('<div><h3>Terk (son alan / adım)</h3>' + mapTable(x.abandon, fieldName, ['Ayrılma noktası', 'Terk'], 'Terk edilen noktalar') + '</div>');
      parts.push('<div><h3>Sunucu reddi (kod)</h3>' + mapTable(x.rejects, REJECT_NAMES, ['Neden', 'Ret'], 'Sunucu redleri') + '</div>');
      if (x.fail) parts.push('<div><h3>Sunucuya ulaşmayan gönderim</h3>' + mapTable(x.fails, FAIL_NAMES, ['Neden', 'Sayı'], 'Ağ hataları') + '</div>');
      var devs = Object.keys(Object.assign({}, x.devices, x.errorsByDevice, x.abandonByDevice));
      if (devs.length) {
        parts.push('<div><h3>Cihaza göre</h3>' + table(['Cihaz', 'Başlangıç', 'Kabul', 'Kabul oranı', 'Alan hatası', 'Terk'], devs.map(function (dv) {
          var s = x.devices[dv] || { start: 0, accepted: 0 };
          return [esc(DEV_NAMES[dv] || dv), nf(s.start), nf(s.accepted), rate(s.accepted, s.start), nf(x.errorsByDevice[dv] || 0), nf(x.abandonByDevice[dv] || 0)];
        }), 'Cihaza göre form') + '</div>');
      }
      parts.push('</div>');
      return parts.join('');
    }).join('') + '<p class="gp-note">Alan hatası: gönderim / ileri denemesinde işaretlenen alan (sayfa görüntülemesi başına alan başına bir kez); alanın değeri hiçbir zaman kaydedilmez. Terk: formda giriş yapılıp talep kabul edilmeden sayfadan ayrılma (tarayıcı kapanırken gönderilemeyebilir; alt sınırdır).</p>';
  }

  function items(data) {
    if (!data.items.length) return NO_DATA;
    return table(['Araç / simülasyon', 'Açılış', 'Kullanım', 'Sonuç', 'Rapor', 'Kaydetme', 'Hata'], data.items.map(function (r) {
      return [esc(itemName(r.id)), r.type === 'voltsim' ? nf(r.open) : '—', nf(r.use), nf(r.result), nf(r.reports), nf(r.saves), r.type === 'voltsim' ? nf(r.errors) : '—'];
    }), 'Araç ve simülasyon kullanımı') + '<p class="gp-note">Açılış: VoltSim modülü kuruldu. Kullanım: hesap aracında ilk girdi / simülasyonu veya bir görevi başlatma. Sonuç: girdi değiştirildikten sonra geçerli sonuç ya da geçerli sonuçla çalıştırma. Rapor: PDF/CSV/yazdır gerçekten üretildiğinde. Hepsi sayfa görüntülemesi başına bir kez sayılır.</p>';
  }

  function simErrors(data) {
    if (!data.simErrors.length) return NO_DATA;
    var opens = {};
    data.items.forEach(function (r) { if (r.type === 'voltsim') opens[r.id.slice(4)] = r.open; });
    return table(['Simülasyon', 'Hata türü', 'Sayı', 'Açılışa göre'], data.simErrors.map(function (e) {
      return [esc(SIM_NAMES[e.sim] || label(e.sim)), esc(SIM_ERR[e.kind] || e.kind), nf(e.n), opens[e.sim] ? rate(e.n, opens[e.sim]) : '—'];
    }), 'Simülasyon hataları') + '<p class="gp-note">Hata mesajı ya da girdi kaydedilmez; yalnızca modül ve hata türü. Girdi doğrulama uyarıları (ör. "akım çok yüksek") hata sayılmaz.</p>';
  }

  function contacts(data) {
    var total = sumMap(data.contacts);
    return hbars(sorted(data.contacts).filter(function (r) { return r[1]; }), CH_NAMES, total) +
      '<p class="gp-note"><strong>Bu sayılar yalnızca bağlantıya tıklama niyetidir.</strong> Gerçekleşmiş görüşme, nitelikli müşteri ya da satış olarak sayılmaz ve hiçbir başarı ölçütüne katılmaz.</p>';
  }

  function outcomes(data) {
    var cmd = '<code>php tools/metrics-admin.php outcome set 2026-10 --source is-takip --by "Satış sorumlusu" --qualified 3 --won 1</code>';
    if (!data.outcomes) {
      return '<p class="gp-empty"><strong>Doğrulanmış veri yok.</strong> Nitelikli teklif ve kazanılan iş sayıları sitenin ölçümünden çıkarılamaz; bu panel bunları tahmin etmez. İş takip sisteminden aktarılan ya da yetkili kişinin doğruladığı aylık toplamlar sunucu terminalinden girilir: ' + cmd + '</p>';
    }
    var monthOk = {};
    data.series.forEach(function (d) { monthOk[d.d.slice(0, 7)] = (monthOk[d.d.slice(0, 7)] || 0) + d.ok; });
    return table(['Ay', 'Nitelikli teklif', 'Kazanılan iş', 'Kaynak', 'Doğrulayan', 'Kabul edilen talep (seçili aralıkta)'], Object.keys(data.outcomes).reverse().map(function (m) {
      var o = data.outcomes[m];
      return [esc(m), o.qualified === null ? 'girilmedi' : nf(o.qualified), o.won === null ? 'girilmedi' : nf(o.won),
        esc(o.source === 'is-takip' ? 'İş takip sistemi' : 'Yetkili doğrulaması'), esc(o.verifiedBy), m in monthOk ? nf(monthOk[m]) : '—'];
    }), 'Doğrulanmış iş sonuçları') + '<p class="gp-note">Bu satırlar ölçümden değil, kayıt girilen kaynaktan gelir ve web talepleriyle kişi bazında eşleştirilmez; aynı aydaki kabul edilen talep sayısıyla oran kurulurken farklı kaynaklar olduğu unutulmamalıdır. Güncelleme: ' + cmd + '</p>';
  }

  /* ---------- deneyler: önceden tanımlı ölçütler (api/METRICS.md ile aynı) ---------- */
  var EXP = {
    H1: { title: 'VoltSim sonucundan teklif taslağına aktarım',
      change: 'VoltSim sonuç panelinden, ziyaretçi onayıyla sonuç özetinin teklif sihirbazına taslak olarak aktarılması.',
      primary: ['Özet eklenmiş kabul edilen talep / simülasyon sonucu', 'draftAccepted', 'simResult'],
      secondary: 'Özet eklenmiş teklif başlangıcı / simülasyon sonucu.',
      guard: 'Teklif sihirbazında sunucu reddi oranı artmamalı; doğrulanmış kayıt varsa nitelikli teklif oranı düşmemeli.', mde: 0.5 },
    H2: { title: 'Hizmet sayfasında daha anlaşılır teklif çağrısı',
      change: 'Hizmet sayfalarında teklif çağrısının metni, konumu ve hizmet ön seçimiyle forma bağlanması.',
      primary: ['Teklif çağrısı tıklaması / hizmet sayfası görüntüleme', 'serviceCta', 'servicePv'],
      secondary: 'Hizmet sayfası kaynaklı kabul edilen talep / hizmet sayfası görüntüleme.',
      guard: 'Telefon / WhatsApp tıklaması başarı sayılmaz. Kaynak karışımı (organik pay) dönemler arasında 10 puandan fazla değiştiyse sonuç yorumlanmaz.', mde: 0.3 },
    H3: { title: 'Mobil formdaki gereksiz alanların azaltılması',
      change: 'Mobilde zorunlu olmayan alanların kaldırılması / isteğe bağlı yapılması.',
      primary: ['Mobil kabul edilen talep / mobil teklif başlangıcı', 'mobileAccepted', 'mobileStart'],
      secondary: 'Mobil alan hatası ve terk sayısı / mobil başlangıç (form bölümü).',
      guard: 'Masaüstü tamamlama oranı düşmemeli; sunucu reddi artmamalı; doğrulanmış kayıt varsa nitelikli teklif oranı düşmemeli.', mde: 0.3 }
  };
  var MIN_DAYS = 28;
  function normCdf(z) { // Abramowitz-Stegun 7.1.26
    var t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    var erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
  }
  /* İki oran karşılaştırması için grup başına gereken payda (α=0,05 çift yönlü, güç %80). */
  function needN(p1, mde) {
    var p2 = Math.min(0.999, p1 * (1 + mde));
    if (!(p1 > 0) || p2 <= p1) return null;
    var pb = (p1 + p2) / 2, za = 1.959964, zb = 0.841621;
    return Math.ceil(Math.pow(za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2)), 2) / Math.pow(p2 - p1, 2));
  }
  function experiment(row) {
    var def = EXP[row.id], k = def.primary;
    var base = row.before || row.current, x1 = base[k[1]], n1 = base[k[2]];
    var p1 = n1 ? x1 / n1 : 0, need = needN(p1, def.mde);
    var status, pill = 'gp-pill--wait', verdict = '';
    if (!row.change || !row.after) {
      status = 'Taban ölçülüyor';
      verdict = 'Değişiklik henüz kaydedilmedi. Değişiklik yayına alınırken <code>php tools/metrics-admin.php change add &lt;YYYY-AA-GG&gt; ' + row.id + ': kısa açıklama</code> ile tarih işaretlenir; panel öncesindeki ve sonrasındaki ' + MIN_DAYS + ' günü karşılaştırır.';
    } else {
      var a = row.after, x2 = a[k[1]], n2 = a[k[2]], p2 = n2 ? x2 / n2 : 0;
      verdict = 'Önce (' + MIN_DAYS + ' gün): ' + nf(x1) + ' / ' + nf(n1) + ' = ' + pct(x1, n1, 2) + ' · Sonra (' + nf(row.daysAfter) + ' gün): ' + nf(x2) + ' / ' + nf(n2) + ' = ' + pct(x2, n2, 2) + '.';
      if (row.daysAfter < MIN_DAYS) status = 'Ölçüm sürüyor (' + nf(row.daysAfter) + ' / ' + MIN_DAYS + ' gün)';
      else if (need === null || n1 < need || n2 < need) { status = 'Yetersiz örneklem — karar verilmez'; }
      else {
        var p = (x1 + x2) / (n1 + n2), se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
        var z = se ? (p2 - p1) / se : 0, pv = 2 * (1 - normCdf(Math.abs(z)));
        if (pv < 0.05 && p2 > p1) { status = 'Ölçütü karşıladı (p=' + pv.toFixed(3) + ')'; pill = 'gp-pill--ok'; }
        else if (pv < 0.05) { status = 'Anlamlı düşüş (p=' + pv.toFixed(3) + ')'; pill = 'gp-pill--bad'; }
        else { status = 'Anlamlı fark yok (p=' + pv.toFixed(3) + ')'; pill = ''; }
        verdict += ' Önce/sonra karşılaştırmasıdır, nedensellik kanıtı değildir: mevsimsellik, kampanya ve trafik karışımı ayrıca kontrol edilmelidir.';
      }
    }
    return '<div class="gp-exp"><h3>' + esc(row.id + ' · ' + def.title) + ' <span class="gp-pill ' + pill + '">' + esc(status) + '</span></h3><dl>' +
      '<dt>Değişiklik</dt><dd>' + esc(def.change) + (row.change ? ' Kayıt: ' + fmtDate(row.change.date) + ' — ' + esc(row.change.label) : '') + '</dd>' +
      '<dt>Birincil ölçüt</dt><dd>' + esc(k[0]) + '. Başarı: oranın tabana göre en az %' + Math.round(def.mde * 100) + ' göreli artışı, iki oran z-testi ile α=0,05 (çift yönlü), güç %80; her dönem en az ' + MIN_DAYS + ' gün.</dd>' +
      '<dt>Seçili aralıktaki değer</dt><dd>' + nf(row.current[k[1]]) + ' / ' + nf(row.current[k[2]]) + ' = ' + rate(row.current[k[1]], row.current[k[2]], 2) + '</dd>' +
      '<dt>Gereken örneklem</dt><dd>' + (need === null ? 'Taban oranı sıfır ya da ölçülmedi; örneklem hesaplanamaz.' : 'Her dönemde en az ' + nf(need) + ' (payda: ' + esc(k[0].split(' / ')[1]) + ').') + '</dd>' +
      '<dt>İkincil ölçüt</dt><dd>' + esc(def.secondary) + '</dd>' +
      '<dt>Koruma ölçütü</dt><dd>' + esc(def.guard) + '</dd>' +
      '<dt>Durum</dt><dd>' + verdict + '</dd></dl></div>';
  }
  function experiments(data) {
    var html = (data.experiments || []).map(experiment).join('');
    html += '<p class="gp-note">Ölçütler değişiklikten önce tanımlanmıştır ve sonuç görüldükten sonra değiştirilmez. Yetersiz örneklemde "karar verilmez"; ölçütü karşılayan bir sonuç da trafik ya da satış artışı garantisi değildir. Aynı dönemde iki değişiklik yayına alınırsa etkileri ayrıştırılamaz.</p>';
    if (data.changes && data.changes.length) {
      html += '<h3>Değişiklik kaydı</h3>' + table(['Tarih', 'Değişiklik'], data.changes.slice().reverse().map(function (c) { return [fmtDate(c.date), esc(c.label)]; }), 'Değişiklik kaydı');
    }
    return html;
  }

  function sources(data) {
    var total = sumMap(data.ref);
    var html = hbars(sorted(data.ref), REF_NAMES, total);
    if (total) {
      html += '<p class="gp-note">Organik arama payı: <strong>' + pct(data.ref.arama || 0, total) + '</strong> (' + nf(data.ref.arama || 0) + ' / ' + nf(total) + ' ziyaret). Site içi gezinme ziyaret sayılmaz.</p>';
      var se = sorted(data.se);
      if (se.length) html += '<h3>Arama motorları</h3>' + hbars(se, SE_NAMES, sumMap(data.se));
    }
    return html;
  }

  function render(data) {
    var banner = $('gp-mode-banner');
    banner.hidden = mode !== 'test';
    banner.innerHTML = mode === 'test' ? '<strong>Test verisi gösteriliyor.</strong> Bu sayılar yerel önizleme, hazırlık sunucusu, <code>?vg_test=1</code> ile açılan oturumlar ve otomatik testlerden gelir; canlı rapora katılmaz ve gerçek ziyaretçi davranışı olarak yorumlanmamalıdır.' : '';
    $('gp-coverage').innerHTML = coverage(data);
    $('gp-kpis').innerHTML = kpis(data);
    $('gp-funnel').innerHTML = funnel(data);
    $('gp-accepted').innerHTML = accepted(data);
    $('gp-entry').innerHTML = entryPages(data);
    $('gp-forms').innerHTML = formsSection(data);
    $('gp-items').innerHTML = items(data);
    $('gp-simerr').innerHTML = simErrors(data);
    $('gp-contacts').innerHTML = contacts(data);
    $('gp-outcomes').innerHTML = outcomes(data);
    $('gp-experiments').innerHTML = experiments(data);
    $('gp-daily').innerHTML = dailyChart(data.series);
    $('gp-sources').innerHTML = sources(data);
    $('gp-devices').innerHTML = hbars(sorted(data.dev), DEV_NAMES, sumMap(data.dev));
    $('gp-pages').innerHTML = data.pages.length ? table(['Sayfa', 'Görüntüleme', 'Pay'], data.pages.map(function (p) {
      return ['<code>' + esc(p[0]) + '</code>', nf(p[1]), pct(p[1], data.totals.pv)];
    }), 'En çok görüntülenen sayfalar') + (data.sections.length ? '<details><summary>Bölümlere göre</summary>' + table(['Bölüm', 'Görüntüleme'], data.sections.map(function (s) {
      return [esc(label(s[0])), nf(s[1])];
    }), 'Bölümlere göre görüntüleme') + '</details>' : '') : NO_DATA;
    $('gp-volthaber').innerHTML = data.volthaber.length ? '<p class="gp-note" style="margin-top:0">Toplam ' + nf(data.totals.volthaber) + ' görüntüleme.</p>' +
      table(['Haber', 'Görüntüleme'], data.volthaber.map(function (v) { return ['<code>' + esc(v[0]) + '</code>', nf(v[1])]; }), 'VoltHaber') : NO_DATA;
    $('gp-quality').textContent = 'Kişi bazında iz, IP adresi veya tarayıcı kimliği tutulmaz; analitik olaylarda ad, telefon, e-posta, mesaj, dosya ve hesap girdileri yoktur. Ziyaret, siteye dışarıdan giriş yapılan sayfa görüntülemesidir; tekil ziyaretçi ölçülmez.';
  }

  function api(url, headers) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: Object.assign({ Accept: 'application/json' }, headers || {}) })
      .then(function (res) { return res.json().catch(function () { return { ok: false, error: 'unreachable' }; }).then(function (j) { j.__status = res.status; return j; }); });
  }

  function load() {
    if (loading) return;
    loading = true;
    $('gp-status').textContent = 'Yükleniyor…';
    var me = csrf ? Promise.resolve() : api('/api/auth.php?action=me').then(function (j) { csrf = j.csrf || ''; myId = j.user && j.user.id ? String(j.user.id) : ''; });
    me.then(function () { return api('/api/metrics.php?action=dashboard&days=' + days + '&mode=' + mode, { 'X-VG-CSRF': csrf }); }).then(function (data) {
      loading = false;
      if (data.__status === 403 && data.error === 'csrf') { csrf = ''; }
      if (!data.ok) {
        $('gp-body').hidden = true;
        var box = $('gp-forbidden');
        box.hidden = false;
        box.innerHTML = data.error === 'forbidden'
          ? '<div class="vg-section vg-acct-state" role="alert"><h2>Bu panel için yetkiniz yok</h2><p>Büyüme paneli yalnızca site sahibinin sunucuda <code>php tools/metrics-admin.php grant &lt;üye-kimliği&gt;</code> komutuyla yetkilendirdiği hesaplara açıktır.' + (myId ? ' Üye kimliğiniz: <code>' + esc(myId) + '</code>' : '') + '</p></div>'
          : '<div class="vg-section vg-acct-state vg-acct-state--error" role="alert"><h2>Ölçüm verisi alınamadı</h2><p>' + esc(data.message || 'Ölçüm servisine ulaşılamıyor. Bu panel yalnızca PHP API çalışan sunucuda (voltguard.com.tr) kullanılabilir.') + '</p></div>';
        $('gp-status').textContent = '';
        return;
      }
      $('gp-forbidden').hidden = true;
      $('gp-body').hidden = false;
      render(data);
      $('gp-status').textContent = (mode === 'test' ? 'TEST · ' : '') + fmtDate(data.range.from) + ' – ' + fmtDate(data.range.to) + ' güncellendi';
    }, function () {
      loading = false;
      $('gp-status').textContent = 'Bağlantı hatası. Tekrar deneyin.';
    });
  }

  document.querySelector('.gp-bar').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-days], button[data-mode]');
    if (!btn || loading) return;
    var attr = btn.hasAttribute('data-days') ? 'data-days' : 'data-mode';
    if (attr === 'data-days') days = +btn.getAttribute(attr); else mode = btn.getAttribute(attr);
    document.querySelectorAll('.gp-bar button[' + attr + ']').forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
    load();
  });

  UI.initPage({ page: 'buyume', protected: true, collections: [], onReady: function () { load(); } });
}());
