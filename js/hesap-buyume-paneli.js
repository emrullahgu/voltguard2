/* hesap/buyume-paneli.html — yalnızca tools/metrics-admin.php ile yetkilendirilmiş yöneticiler için büyüme paneli.
 * Veri: GET /api/metrics.php?action=dashboard (oturum + X-VG-CSRF). Grafikler satır içi SVG'dir; harici kütüphane yoktur.
 * Veri olmayan yerde sayı uydurulmaz: "Veri henüz mevcut değil" gösterilir. */
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
  var SIM_NAMES = { pano: 'Elektrik Pano', ges: 'GES', trafo: 'Trafo', sarj: 'Şarj İstasyonu', res: 'RES', komp: 'Kompanzasyon',
    topraklama: 'Topraklama', motor: 'Motor & PLC', ups: 'UPS & Jeneratör', yangin: 'Yangın Algılama' };
  var REF_NAMES = { arama: 'Arama motoru (organik)', sosyal: 'Sosyal medya', dogrudan: 'Doğrudan / yer imi', diger: 'Diğer siteler' };
  var DEV_NAMES = { mobil: 'Mobil', tablet: 'Tablet', masaustu: 'Masaüstü' };
  var SE_NAMES = { google: 'Google', bing: 'Bing', yandex: 'Yandex', duckduckgo: 'DuckDuckGo', yahoo: 'Yahoo', ecosia: 'Ecosia', baidu: 'Baidu', diger: 'Diğer' };
  var days = 30, csrf = '', loading = false, myId = '';

  function nf(n) { return Number(n || 0).toLocaleString('tr-TR'); }
  function pct(part, whole, digits) {
    if (!whole) return '—';
    return '%' + (part / whole * 100).toLocaleString('tr-TR', { maximumFractionDigits: digits === undefined ? 1 : digits });
  }
  function label(slug) { return String(slug).replace(/^arac-/, 'Uygulama: ').replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }
  function sumMap(m) { return Object.keys(m || {}).reduce(function (s, k) { return s + (+m[k] || 0); }, 0); }
  function sorted(m) { return Object.keys(m || {}).map(function (k) { return [k, +m[k] || 0]; }).sort(function (a, b) { return b[1] - a[1]; }); }

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
      out.push('<g><title>' + esc(d.d) + ': ' + nf(d.pv) + ' görüntüleme, ' + nf(d.en) + ' ziyaret</title>' +
        '<rect x="' + (x + 1) + '" y="' + T + '" width="' + w + '" height="' + ih + '" fill="transparent"/>' +
        (h > 0 ? '<rect x="' + (x + 1) + '" y="' + (T + ih - h) + '" width="' + w + '" height="' + h + '" rx="' + Math.min(3, w / 2) + '" fill="#93b4f5"/>' : '') + '</g>');
      if (i % labelEvery === 0) out.push('<text x="' + (x + bw / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(d.d.slice(5).split('-').reverse().join('.')) + '</text>');
    });
    out.push('<polyline fill="none" stroke="#0a1628" style="stroke:var(--th-heading,#0a1628)" stroke-width="2" stroke-linejoin="round" points="' + series.map(function (d, i) {
      return (L + i * bw + bw / 2).toFixed(1) + ',' + y(d.en).toFixed(1);
    }).join(' ') + '"/>');
    out.push('</svg>');
    out.push('<ul class="gp-legend"><li><i style="background:#93b4f5"></i>Sayfa görüntüleme</li><li><i style="background:var(--th-heading,#0a1628)"></i>Ziyaret (dışarıdan giriş)</li></ul>');
    out.push('<details><summary>Tablo olarak göster</summary>' + table(['Gün', 'Görüntüleme', 'Ziyaret', 'Teklif formu'], series.slice().reverse().map(function (d) {
      return [esc(d.d), nf(d.pv), nf(d.en), nf(d.q)];
    }), 'Günlük değerler') + '</details>');
    return out.join('');
  }

  function isoWeek(dateStr) {
    var d = new Date(dateStr + 'T12:00:00Z');
    var day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    var first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    var week = 1 + Math.round(((d - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
    return d.getUTCFullYear() + '-H' + String(week).padStart(2, '0');
  }
  function periods(series) {
    if (!series.some(function (d) { return d.pv; })) return NO_DATA;
    var weeks = {}, months = {};
    series.forEach(function (d) {
      var w = isoWeek(d.d), m = d.d.slice(0, 7);
      weeks[w] = weeks[w] || { en: 0, pv: 0 }; weeks[w].en += d.en; weeks[w].pv += d.pv;
      months[m] = months[m] || { en: 0, pv: 0 }; months[m].en += d.en; months[m].pv += d.pv;
    });
    var MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    return '<h3>Haftalık</h3>' + table(['Hafta', 'Ziyaret', 'Görüntüleme'], Object.keys(weeks).reverse().slice(0, 12).map(function (k) {
      return [esc(k), nf(weeks[k].en), nf(weeks[k].pv)];
    }), 'Haftalık ziyaret') + '<h3>Aylık</h3>' + table(['Ay', 'Ziyaret', 'Görüntüleme'], Object.keys(months).reverse().map(function (k) {
      return [esc(MONTHS[+k.slice(5) - 1] + ' ' + k.slice(0, 4)), nf(months[k].en), nf(months[k].pv)];
    }), 'Aylık ziyaret') + '<p class="gp-note">Seçili aralıktaki kısmi hafta/aylar da gösterilir; aylık karşılaştırma için "Son 12 ay"ı seçin.</p>';
  }

  function kpis(data) {
    var k = data.kpi, t = data.totals;
    var tiles = [
      ['Bugün ziyaret', nf(k.today.entries), nf(k.today.pv) + ' görüntüleme'],
      ['Son 7 gün ziyaret', nf(k.last7.entries), nf(k.last7.pv) + ' görüntüleme'],
      ['Son 30 gün ziyaret', nf(k.last30.entries), nf(k.last30.pv) + ' görüntüleme'],
      ['Organik arama payı', pct(t.organic, t.entries), 'seçili aralıktaki ziyaretlerin'],
      ['Teklif formu gönderimi', nf(t.quotes), nf(t.quotesFromTools) + ' tanesi hesap aracından'],
      ['WhatsApp / telefon', nf(t.whatsapp) + ' / ' + nf(t.tel), 'tıklama'],
      ['Bülten aboneliği', t.newsletter ? nf(t.newsletter) : '—', t.newsletter ? 'seçili aralık' : 'Veri henüz mevcut değil'],
      ['VoltSim tamamlama', pct(t.simComplete, t.simStart, 0), nf(t.simStart) + ' başlatma']
    ];
    return tiles.map(function (x) { return '<div class="gp-kpi"><span>' + esc(x[0]) + '</span><strong>' + esc(x[1]) + '</strong><small>' + esc(x[2]) + '</small></div>'; }).join('');
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

  function conversions(data) {
    var t = data.totals, series = data.series;
    var toolQuotes = series.reduce(function (s, d) { return s + d.tq; }, 0);
    if (!t.quotes && !t.whatsapp && !t.tel && !toolQuotes && !t.newsletter) return NO_DATA;
    var html = table(['Gösterge', 'Sayı', 'Oran'], [
      ['Teklif formu gönderimi (başarılı)', nf(t.quotes), pct(t.quotes, t.entries, 2) + ' / ziyaret'],
      ['— hesap aracından gelen', nf(t.quotesFromTools), pct(t.quotesFromTools, t.quotes, 0)],
      ['"Bu sonuçla teklif iste" tıklaması', nf(toolQuotes), pct(toolQuotes, t.toolUse, 1) + ' / araç kullanımı'],
      ['WhatsApp tıklaması', nf(t.whatsapp), pct(t.whatsapp, t.entries, 2) + ' / ziyaret'],
      ['Telefon tıklaması', nf(t.tel), pct(t.tel, t.entries, 2) + ' / ziyaret'],
      ['Bülten aboneliği', t.newsletter ? nf(t.newsletter) : 'Veri henüz mevcut değil', '—']
    ], 'Dönüşümler');
    if (data.quotes.length) {
      html += '<h3>Hizmete göre teklif</h3>' + table(['Hizmet', 'Teklif'], data.quotes.map(function (q) { return [esc(label(q[0])), nf(q[1])]; }), 'Hizmete göre teklif');
    }
    return html;
  }

  function sims(data) {
    if (!data.sims.length) return NO_DATA;
    return table(['Simülasyon', 'Başlatma', 'Tamamlama', 'Oran'], data.sims.map(function (s) {
      return [esc(SIM_NAMES[s.sim] || s.sim), nf(s.start), nf(s.complete), pct(s.complete, s.start, 0)];
    }), 'VoltSim kullanımı') + '<p class="gp-note">Başlatma: "Simülasyonu başlat" veya bir görev başlatma. Tamamlama: bir görevin tamamlanması veya PDF rapor alınması. Aynı sayfa görüntülemesinde her biri bir kez sayılır.</p>';
  }

  function tools(data) {
    if (!data.tools.length) return NO_DATA;
    var quotes = {};
    (data.toolQuotes || []).forEach(function (q) { quotes[q[0]] = q[1]; });
    return table(['Araç', 'Kullanım', 'Teklif tıklaması'], data.tools.map(function (r) {
      return [esc(label(r[0])), nf(r[1]), nf(quotes[r[0]] || 0)];
    }), 'Araç kullanımı') + '<p class="gp-note">Kullanım: sayfada ilk veri girişi (sayfa görüntülemesi başına bir kez).</p>';
  }

  function render(data) {
    $('gp-kpis').innerHTML = kpis(data);
    $('gp-daily').innerHTML = dailyChart(data.series);
    $('gp-periods').innerHTML = periods(data.series);
    $('gp-sources').innerHTML = sources(data);
    $('gp-devices').innerHTML = hbars(sorted(data.dev), DEV_NAMES, sumMap(data.dev));
    $('gp-conversions').innerHTML = conversions(data);
    $('gp-pages').innerHTML = data.pages.length ? table(['Sayfa', 'Görüntüleme', 'Pay'], data.pages.map(function (p) {
      return ['<code>' + esc(p[0]) + '</code>', nf(p[1]), pct(p[1], data.totals.pv)];
    }), 'En çok görüntülenen sayfalar') + (data.sections.length ? '<details><summary>Bölümlere göre</summary>' + table(['Bölüm', 'Görüntüleme'], data.sections.map(function (s) {
      return [esc(label(s[0])), nf(s[1])];
    }), 'Bölümlere göre görüntüleme') + '</details>' : '') : NO_DATA;
    $('gp-sims').innerHTML = sims(data);
    $('gp-tools').innerHTML = tools(data);
    $('gp-volthaber').innerHTML = data.volthaber.length ? '<p class="gp-note" style="margin-top:0">Toplam ' + nf(data.totals.volthaber) + ' görüntüleme.</p>' +
      table(['Haber', 'Görüntüleme'], data.volthaber.map(function (v) { return ['<code>' + esc(v[0]) + '</code>', nf(v[1])]; }), 'VoltHaber') : NO_DATA;
    renderBaseline(data);
    $('gp-quality').textContent = 'Veri kalitesi: seçili aralıkta ' + nf(data.bots) + ' otomasyon (bot) isteği ve hız sınırına takılan ' + nf(data.limited) +
      ' olay toplamlara katılmadı. İlk veri günü: ' + (data.firstDate || 'henüz yok') + '. Do Not Track / Global Privacy Control açık tarayıcılar ölçülmez; gerçek trafik bu panelde gösterilenden biraz yüksektir.';
  }

  function renderBaseline(data) {
    var box = $('gp-baseline'), b = data.plan && data.plan.baseline, c = data.plan && data.plan.current;
    if (!b) {
      box.innerHTML = '<p class="gp-empty"><strong>Taban henüz oluşmadı.</strong> ' + (data.firstDate ? 'Ölçüm ' + esc(data.firstDate) + ' tarihinde başladı; ' + nf(data.daysWithData) + ' / 30 gün veri var.' : 'Henüz ölçüm verisi yok.') + ' Hedef eşikleri 30 gün dolunca tabandan hesaplanır.</p>';
      return;
    }
    var rows = [
      ['Ziyaret (30 gün)', b.entries, c ? c.entries : null, 1.10, 1.20],
      ['Organik arama ziyareti (30 gün)', b.organic, c ? c.organic : null, 1.10, 1.20],
      ['Teklif formu gönderimi (30 gün)', b.quotes, c ? c.quotes : null, null, 1.20]
    ];
    var rate = function (s) { return s && s.toolUse ? s.quotesFromTools / s.toolUse : null; };
    box.innerHTML = '<p class="gp-note" style="margin-top:0">Taban dönemi: ' + esc(b.from) + ' başlangıçlı ilk 30 gün.</p>' +
      table(['Gösterge', 'Taban', '60. gün hedefi', '90. gün hedefi', 'Son 30 gün'], rows.map(function (r) {
        return [esc(r[0]), nf(r[1]), r[3] ? '<span class="gp-target">≥ ' + nf(Math.ceil(r[1] * r[3])) + '</span>' : '—',
          '<span class="gp-target">≥ ' + nf(Math.ceil(r[1] * r[4])) + '</span>', r[2] === null ? '60. günden sonra' : nf(r[2])];
      }).concat([['VoltSim tamamlama oranı', pct(b.simComplete, b.simStart, 0), b.simStart ? '+5 puan' : '—', b.simStart ? '+5 puan' : '—', c ? pct(c.simComplete, c.simStart, 0) : '60. günden sonra'],
        ['Araçtan teklif oranı', rate(b) === null ? '—' : pct(b.quotesFromTools, b.toolUse, 1), rate(b) === null ? '—' : '+%15 (göreli)', '—', c && rate(c) !== null ? pct(c.quotesFromTools, c.toolUse, 1) : '—']]), 'Taban ve hedefler');
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
    me.then(function () { return api('/api/metrics.php?action=dashboard&days=' + days, { 'X-VG-CSRF': csrf }); }).then(function (data) {
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
      $('gp-status').textContent = data.range.from + ' – ' + data.range.to + ' güncellendi';
    }, function () {
      loading = false;
      $('gp-status').textContent = 'Bağlantı hatası. Tekrar deneyin.';
    });
  }

  document.querySelector('.gp-bar').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-days]');
    if (!btn || loading) return;
    days = +btn.getAttribute('data-days');
    document.querySelectorAll('.gp-bar button[data-days]').forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
    load();
  });

  UI.initPage({ page: 'buyume', protected: true, collections: [], onReady: function () { load(); } });
}());
