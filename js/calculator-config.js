/* VoltGuard hesaplama araçları: ortak yapılandırma, mühendislik formülleri ve form yardımcıları.
 * Tarayıcıda window.VoltGuardCalculatorConfig, Node'da require() ile yüklenir (tools/tests/hesaplama-formulas.test.cjs).
 * Tüm bağımsız hesap sayfaları (hesaplama/*.html) ve Hesaplama Merkezi (teklif-araclari.html) formülleri ve
 * sınır değerlerini YALNIZCA buradan alır; js/voltsim/engine.js ile aynı kabuller kullanılır (IEC 60909 c = 1,05,
 * κCu = 56 m/(Ω·mm²) 20 °C, X' = 0,08 Ω/km, TS HD 60364-5-52 Iz tabloları). */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.VoltGuardCalculatorConfig = api; }
}(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' && typeof module === 'undefined' ? globalThis : null), function () {
  'use strict';

  var SQRT3 = Math.sqrt(3);

  var config = {
    version: '2026-10-24',
    // Fiyat varsayımı tutulmaz: GES yatırım maliyeti, elektrik birim bedeli, proje ve güç artırımı birim bedelleri
    // kullanıcının kendi teklif/fatura değerleriyle girilir (sahibi onaylı kaynaklı bir değer verene kadar).
    pricing: {
      panelWatt: 550,
      inverterAcRatio: 0.8,
      // Bölge değerleri (kWh/kWp) tipik özgül verimdir; bu katsayı ek kirlenme, kullanılabilirlik ve ilk yıl
      // degradasyonu için %5 düşüm payıdır (tam sistem PR değeri değildir).
      performanceRatio: 0.95,
      areaPerKwpRoof: 5.5,
      areaPerKwpLand: 8
    },
    technical: {
      copperResistivity: 1 / 56,
      // Elektrik İç Tesisleri Yönetmeliği Madde 57: yapı bağlantı kutusu – tüketici (bağlayıcı sınırlar).
      voltageDropLimitLightingPct: 1.5,
      voltageDropLimitPowerPct: 3,
      inverterAcDropLimitPct: 1.5,
      inverterDcDropLimitPct: 1,
      threePhaseMinVoltage: 300,
      cableCosPhi: 0.9,
      cableCurrentMargin: 1.25,
      inverterEfficiency: 0.99,
      factoryGrowthFactor: 1.2,
      fireDetectorAreaM2: 60,
      lightingUtilizationFactor: 0.6,
      upsMarginRatio: 0.2,
      contactorMotorCosPhi: 0.86,
      mpcbMinRatio: 0.8,
      mpcbMaxRatio: 1.25,
      sections: [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240],
      // Iz (A): bakır, PVC, 30 °C, kanal/boru içi (Yöntem B1); bilgi/kablo-kesiti-akim-tasima-tablosu.html ile aynı.
      ampacityB1ThreeLoaded: [15.5, 21, 28, 36, 50, 68, 89, 110, 134, 171, 207, 239, 262, 296, 346],
      ampacityB1TwoLoaded: [17.5, 24, 32, 41, 57, 76, 101, 125, 151, 192, 232, 269, 300, 341, 400],
      transformerKva: [50, 100, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150],
      generatorKva: [65, 90, 110, 150, 165, 200, 220, 275, 330, 385, 440, 500, 550, 605, 660, 715, 825, 900, 1000, 1100, 1250, 1400, 1600, 1800, 2000],
      upsKva: [1, 3, 6, 10, 15, 20, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300, 400, 500, 600, 800],
      breakerAmps: [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000],
      contactorAmps: [9, 12, 18, 25, 32, 40, 50, 65, 80, 95, 115, 150, 185, 225, 265, 330, 400, 500, 630]
    },
    // EMO 2026 Ücret Tanımları, Kısım III (YG tesisleri): aylık EN AZ ücretler, TL, KDV hariç.
    // Kaynak: https://eski.emo.org.tr/ekler/e5f7502862384d0_ek.pdf (EMO YK 04.03.2026 tarih ve 49/60 sayılı karar,
    // 05.03.2026'dan itibaren yürürlükte). Bölgesel katsayılar: Bölüm VI (https://eski.emo.org.tr/ekler/f06347be776ee71_ek.pdf).
    // EMO her yıl yeni tablo yayımladığında bu bloğu ve hesaplama/isletme-sorumlulugu-ucret-hesaplama.html içindeki tablo/örnekleri birlikte güncelleyin.
    emoIsletme: {
      year: 2026,
      effective: '05.03.2026',
      decision: '04.03.2026 tarih ve 49/60 sayılı EMO Yönetim Kurulu kararı',
      checked: '12.10.2026',
      sourceUrl: 'https://eski.emo.org.tr/ekler/e5f7502862384d0_ek.pdf',
      pageUrl: '/hesaplama/isletme-sorumlulugu-ucret-hesaplama/',
      // Direk tipi: [üst kVA sınırı, aylık işletme sorumluluğu]; aylık bakım tüm kademelerde tek bedel.
      direk: { bands: [[50, 3887], [160, 4921], [400, 6770]], bakim: 3887 },
      // Bina tipi: 400 kVA'ya kadar ve 2 hücre temel bedel; 401 kVA-5 MVA ve 5 MVA üzeri artan her kVA; artan her fider.
      bina: {
        baseKva: 400, stepKva: 5000,
        isletme: { base: 8802, perKva1: 5.34, perKva2: 4.10, feederYa: 1269, feederSk: 1351 },
        bakim: { base: 6770, perKva1: 5.34, perKva2: 4.10, feederYa: 517, feederSk: 342 }
      },
      enh: { baseM: 500, base: 2960, perM: 2.14 },
      comboDiscount: 0.10,
      denetimBedeli: 1150,
      regionFactors: [1, 0.85, 0.75, 0.6]
    },
    notes: {
      source: 'Ön değerlendirme varsayımları',
      disclaimer: 'Bu katsayılar bağlayıcı fiyat teklifi değildir. Lisanslı EMO/TEDAŞ verileri, keşif ve güncel tedarik maliyetleriyle doğrulanmalıdır.'
    }
  };

  /* EMO en az ücret tablosuyla aylık YG işletme sorumluluğu (isteğe bağlı bakım) hesabı.
     o = { type: 'bina' | 'direk', kva, feederYa, feederSk, enhM, bakim: true/false, bk }
     Dönüş: { ok, error, items: [{ label, amount }], subtotal, discount, total, bk, direkLike } (tutarlar TL, KDV hariç). */
  config.calcIsletmeUcreti = function (o) {
    var t = config.emoIsletme;
    var r2 = function (x) { return Math.round(x * 100) / 100; };
    var tl = function (x) { return x.toLocaleString('tr-TR', { maximumFractionDigits: 2 }); };
    var tl2 = function (x) { return x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var kva = Number(o.kva);
    var optionalNumber = function (value, fallback) { return value === undefined || value === null ? fallback : Number(value); };
    var fYa = optionalNumber(o.feederYa, 0);
    var fSk = optionalNumber(o.feederSk, 0);
    var enhM = optionalNumber(o.enhM, 0);
    var bk = optionalNumber(o.bk, 1);
    if (['bina', 'direk'].indexOf(o.type) === -1) { return { ok: false, error: 'Geçerli bir trafo tipi seçin.' }; }
    if (!Number.isFinite(kva) || kva <= 0 || kva > 1e9) { return { ok: false, error: "Kurulu güç için 0'dan büyük, en çok 1.000.000.000 kVA değeri girin." }; }
    if (!Number.isInteger(fYa) || !Number.isInteger(fSk) || fYa < 0 || fSk < 0 || fYa > 1e6 || fSk > 1e6) { return { ok: false, error: 'Ek fider sayıları 0–1.000.000 arasında tam sayı olmalıdır.' }; }
    if (!Number.isFinite(enhM) || enhM < 0 || enhM > 1e9) { return { ok: false, error: 'ENH uzunluğu 0–1.000.000.000 m arasında olmalıdır.' }; }
    if (t.regionFactors.indexOf(bk) === -1) { return { ok: false, error: 'Geçerli bir bölgesel azaltma katsayısı seçin.' }; }
    if (o.type === 'direk' && kva > t.direk.bands[t.direk.bands.length - 1][0]) {
      return { ok: false, error: "Direk tipi trafolar EMO tablosunda 400 kVA'ya kadar tanımlıdır; daha büyük güçler için bina tipi trafo merkezini seçin." };
    }
    var items = [];
    var direkLike = o.type === 'direk' || kva < t.bina.baseKva;
    if (direkLike) {
      var lower = 0, fee = 0, upper = 0;
      for (var i = 0; i < t.direk.bands.length; i++) {
        if (kva <= t.direk.bands[i][0]) { upper = t.direk.bands[i][0]; fee = t.direk.bands[i][1]; break; }
        lower = t.direk.bands[i][0] + 1;
      }
      items.push({ label: 'İşletme sorumluluğu (' + (o.type === 'direk' ? 'direk tipi' : '400 kVA altı bina tipi, direk tipi gibi') + ', ' + tl(lower) + '-' + tl(upper) + ' kVA)', amount: fee });
      if (o.bakim) { items.push({ label: 'Aylık bakım (direk tipi)', amount: t.direk.bakim }); }
    } else {
      var b = t.bina;
      var ex1 = Math.max(0, Math.min(kva, b.stepKva) - b.baseKva);
      var ex2 = Math.max(0, kva - b.stepKva);
      items.push({ label: "İşletme sorumluluğu temel bedeli (400 kVA'ya kadar, 2 hücre)", amount: b.isletme.base });
      if (ex1) { items.push({ label: 'Artan ' + tl(ex1) + ' kVA × ' + tl2(b.isletme.perKva1) + ' TL (401 kVA-5 MVA)', amount: r2(ex1 * b.isletme.perKva1) }); }
      if (ex2) { items.push({ label: 'Artan ' + tl(ex2) + ' kVA × ' + tl2(b.isletme.perKva2) + ' TL (5 MVA üzeri)', amount: r2(ex2 * b.isletme.perKva2) }); }
      if (fYa) { items.push({ label: fYa + ' ek yük ayırıcılı fider × ' + tl(b.isletme.feederYa) + ' TL', amount: fYa * b.isletme.feederYa }); }
      if (fSk) { items.push({ label: fSk + ' ek sekonder korumalı fider × ' + tl(b.isletme.feederSk) + ' TL', amount: fSk * b.isletme.feederSk }); }
      if (o.bakim) {
        var bak = b.bakim.base + ex1 * b.bakim.perKva1 + ex2 * b.bakim.perKva2 + fYa * b.bakim.feederYa + fSk * b.bakim.feederSk;
        items.push({ label: 'Aylık bakım (aynı kVA ve fider kademeleriyle)', amount: r2(bak) });
      }
    }
    if (enhM > 0) {
      items.push({ label: 'YG ENH işletme sorumluluğu (' + tl(enhM) + ' m)', amount: r2(t.enh.base + Math.max(0, enhM - t.enh.baseM) * t.enh.perM) });
    }
    var subtotal = r2(items.reduce(function (sum, it) { return sum + it.amount; }, 0));
    var discount = o.bakim ? r2(subtotal * t.comboDiscount) : 0;
    var total = r2((subtotal - discount) * bk);
    return { ok: true, items: items, subtotal: subtotal, discount: discount, total: total, bk: bk, direkLike: direkLike };
  };

  /* =====================================================================================
   * Mühendislik formülleri (saf fonksiyonlar; DOM'a bağımlı değildir)
   * ===================================================================================== */

  /* Mevzuat ve standart atıfları: js/voltsim/regulations.js kayıtlarıyla aynı madde numaraları. */
  var REFS = {
    eity57: 'Elektrik İç Tesisleri Yönetmeliği Madde 57',
    hd52: 'TS HD 60364-5-52 (akım taşıma kapasitesi, Ek G gerilim düşümü tavsiyesi)',
    hd43: 'TS HD 60364-4-43 (aşırı akım koruması: Ib ≤ In ≤ Iz, I2 ≤ 1,45·Iz)',
    iec60909: 'IEC 60909-0 (kısa devre akımları, c = 1,05 / 0,95)',
    iec60898: 'TS EN 60898-1 (B/C/D eğrili MCB, In ≤ 125 A)',
    iec60947_2: 'TS EN 60947-2 (MCCB/ACB)',
    iec60269: 'IEC 60269-1/-2 (gG sigorta, I2 = 1,6·In)',
    iec60947_4: 'TS EN 60947-4-1 (kontaktör AC-3, motor koruma)',
    iec60034: 'IEC 60034-1 (döner makineler)',
    reaktif: 'EPDK Kurul Kararı 5999-3, Madde 13 (reaktif enerji sınırları)',
    topraklama: 'Elektrik Tesislerinde Topraklamalar Yönetmeliği; TS HD 60364-4-41 411.5.3 (TT: RA·IΔn ≤ 50 V)',
    bs7430: 'BS 7430 / IEEE 142 (çubuk topraklayıcı ve paralel elektrot verimi)',
    iec62548: 'IEC 62548-1 (FV dizileri: tasarım akımı 1,25·Isc,STC)',
    en50618: 'EN 50618 (H1Z2Z2-K güneş kablosu akım taşıma kapasitesi)',
    lisanssiz: 'Lisanssız Elektrik Üretim Yönetmeliği Madde 5 (1)-(h), Madde 26 (17)',
    iso8528: 'ISO 8528-1/-5 (jeneratör grupları, anma cosφ 0,8)',
    iec62040: 'IEC 62040-3 (UPS); IEEE 485 (akü boyutlandırma, yaşlanma payı 1,25)',
    en12464: 'TS EN 12464-1 (iç mekân aydınlatma seviyeleri)',
    iec60076: 'IEC 60076-1 (güç transformatörleri)'
  };

  /* Türkçe sayı girişi: "1.000" ve "1.234,5" binlik ayraçlı, "3,5" ondalık virgüllü, "3.5" ondalık noktalı okunur.
     "1.500" binlik ayraçlı kabul edilir (= 1500); bin altı ondalık için virgül kullanın. Hatalı biçim NaN döner. */
  function parseTr(raw) {
    raw = String(raw == null ? '' : raw).trim();
    if (raw === '' || /\s/.test(raw)) { return NaN; }
    if (raw.indexOf(',') !== -1) {
      if (!/^[+-]?(?:\d*|[1-9]\d{0,2}(?:\.\d{3})+),\d+$/.test(raw)) { return NaN; }
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else if (/^[+-]?[1-9]\d{0,2}(\.\d{3})+$/.test(raw)) { raw = raw.replace(/\./g, ''); }
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) { return NaN; }
    var value = Number(raw);
    return Number.isFinite(value) ? value : NaN;
  }

  function firstAtLeast(list, value) { for (var i = 0; i < list.length; i++) { if (list[i] >= value - 1e-9) { return list[i]; } } return null; }
  function interp(table, x) {
    if (x <= table[0][0]) { return table[0][1]; }
    for (var i = 1; i < table.length; i++) {
      if (x <= table[i][0]) {
        var a = table[i - 1], b = table[i];
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
    }
    return table[table.length - 1][1];
  }

  /* --------------------------------------------------------------- iletken direnci ve gerilim düşümü */
  var KAPPA20 = { Cu: 56, Al: 35 };            // m/(Ω·mm²), 20 °C (IEC 60228 ile uyumlu)
  var ALPHA = { Cu: 0.00393, Al: 0.00403 };     // 1/K
  var X_CABLE = 0.08e-3;                        // Ω/m, AG kablo reaktansı (tipik, js/voltsim/engine.js ile aynı)
  /** ρ(θ) = (1/κ20)·(1 + α·(θ − 20)) — Ω·mm²/m */
  function resistivity(material, tempC) {
    var m = material === 'Al' ? 'Al' : 'Cu';
    var t = tempC === undefined ? 20 : tempC;
    return (1 / KAPPA20[m]) * (1 + ALPHA[m] * (t - 20));
  }
  /** Gerilim düşümü: ΔU = k·I·L·(R'·cosφ + X'·sinφ); k = √3 (üç faz, U hat gerilimi) veya 2 (tek faz, U faz-nötr).
      o = { I, L (m, tek yön), S (mm²), U (V), phases: 3|1, cosphi, material: 'Cu'|'Al', tempC (iletken sıcaklığı), parallel } */
  function voltageDrop(o) {
    var n = o.parallel || 1;
    var cos = o.cosphi === undefined ? 1 : o.cosphi;
    var sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    var R = resistivity(o.material, o.tempC === undefined ? 70 : o.tempC) / o.S / n; // Ω/m
    var X = (o.dc ? 0 : X_CABLE) / n;
    var k = o.phases === 3 ? SQRT3 : 2;
    var volts = k * o.I * o.L * (R * cos + X * sin);
    return { volts: volts, pct: volts / o.U * 100, Rpm: R, Xpm: X };
  }
  var VDROP_LIMITS = {
    'ity-light': { pct: 1.5, short: 'aydınlatma/priz %1,5', name: 'EİTY Madde 57 aydınlatma/priz sınırı (%1,5; yapı bağlantı kutusu – tüketici)', binding: true },
    'ity-motor': { pct: 3, short: 'motor %3', name: 'EİTY Madde 57 motor devresi sınırı (%3; yapı bağlantı kutusu – tüketici)', binding: true },
    'ity-trafo-light': { pct: 6.5, short: 'kendi trafolu aydınlatma/priz %6,5', name: 'kendi trafolu tesis aydınlatma/priz sınırı (%6,5; trafo çıkışı – tüketici, EİTY Madde 57)', binding: true },
    'ity-trafo-motor': { pct: 8, short: 'kendi trafolu motor %8', name: 'kendi trafolu tesis motor sınırı (%8; trafo çıkışı – tüketici, EİTY Madde 57)', binding: true },
    'hd-light': { pct: 3, short: 'HD 60364 aydınlatma %3', name: 'TS HD 60364-5-52 Ek G aydınlatma tavsiyesi (%3, bağlayıcı değil)', binding: false },
    'hd-other': { pct: 5, short: 'HD 60364 diğer %5', name: 'TS HD 60364-5-52 Ek G diğer kullanımlar tavsiyesi (%5, bağlayıcı değil)', binding: false }
  };

  /* --------------------------------------------------------------- akım taşıma kapasitesi (TS HD 60364-5-52) */
  var SECTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240];
  // Bakır, PVC yalıtım (70 °C), ortam 30 °C. [2 yüklü iletken, 3 yüklü iletken] — Tablo B.52.2/B.52.4/B.52.10
  var IZ = {
    B1: { 1.5: [17.5, 15.5], 2.5: [24, 21], 4: [32, 28], 6: [41, 36], 10: [57, 50], 16: [76, 68], 25: [101, 89], 35: [125, 110], 50: [151, 134], 70: [192, 171], 95: [232, 207], 120: [269, 239], 150: [300, 262], 185: [341, 296], 240: [400, 346] },
    C: { 1.5: [19.5, 17.5], 2.5: [27, 24], 4: [36, 32], 6: [46, 41], 10: [63, 57], 16: [85, 76], 25: [112, 96], 35: [138, 119], 50: [168, 144], 70: [213, 184], 95: [258, 223], 120: [299, 259], 150: [344, 299], 185: [392, 341], 240: [461, 403] },
    E: { 1.5: [22, 18.5], 2.5: [30, 25], 4: [40, 34], 6: [51, 43], 10: [70, 60], 16: [94, 80], 25: [119, 101], 35: [148, 126], 50: [180, 153], 70: [232, 196], 95: [282, 238], 120: [328, 276], 150: [379, 319], 185: [434, 364], 240: [514, 430] }
  };
  var METHOD_NAMES = { B1: 'Yöntem B1 (boru/kanal içinde)', C: 'Yöntem C (duvara kroşeli)', E: 'Yöntem E (havada delikli tava)' };
  // Ortam sıcaklığı düzeltmesi, PVC, havada (Tablo B.52.14)
  var TEMP_FACTOR_PVC = [[10, 1.22], [15, 1.17], [20, 1.12], [25, 1.06], [30, 1.00], [35, 0.94], [40, 0.87], [45, 0.79], [50, 0.71], [55, 0.61], [60, 0.50]];
  // Gruplama düzeltmesi, demet halinde/yüzeyde/kapalı kanalda (Tablo B.52.17, madde 1)
  var GROUP_FACTOR = { 1: 1.00, 2: 0.80, 3: 0.70, 4: 0.65, 5: 0.60, 6: 0.57, 7: 0.54, 8: 0.52, 9: 0.50, 12: 0.45, 16: 0.41, 20: 0.38 };
  function tempFactor(t) { return interp(TEMP_FACTOR_PVC, t); }
  function groupFactor(n) {
    var keys = Object.keys(GROUP_FACTOR).map(Number);
    var k = keys[0];
    for (var i = 0; i < keys.length; i++) { if (keys[i] <= n) { k = keys[i]; } }
    return GROUP_FACTOR[k];
  }
  /** Düzeltilmiş Iz = Iz(tablo)·kθ·kg */
  function cableIz(S, method, loaded, ambient, groups) {
    var row = (IZ[method] || IZ.B1)[S];
    if (!row) { return NaN; }
    var base = row[loaded >= 3 ? 1 : 0];
    return base * tempFactor(ambient === undefined ? 30 : ambient) * groupFactor(groups || 1);
  }

  /* --------------------------------------------------------------- koruma cihazları */
  var MCB_SIZES = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125];
  var MCCB_SIZES = [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600];
  var GG_SIZES = [6, 10, 16, 20, 25, 32, 35, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 355, 400, 500, 630];
  var MCB_CURVES = { B: [3, 5], C: [5, 10], D: [10, 20] };
  /** Ib için en küçük standart anma akımı. kind: 'MCB' (≤ 125 A), 'MCCB', 'gG'. */
  function pickProtection(Ib, kind) {
    var list = kind === 'gG' ? GG_SIZES : kind === 'MCCB' ? MCCB_SIZES : MCB_SIZES;
    return firstAtLeast(list, Ib);
  }
  /** Aşırı yük koşulları (TS HD 60364-4-43, 433.1): Ib ≤ In ≤ Iz ve I2 ≤ 1,45·Iz.
      MCB/MCCB: I2 ≤ 1,45·In (MCCB 1,30·Ir) olduğundan In ≤ Iz yeterlidir; gG: I2 = 1,6·In → In ≤ 0,906·Iz. */
  function overloadOk(Ib, In, Iz, kind) {
    var I2 = kind === 'gG' ? 1.6 * In : kind === 'MCCB' ? 1.3 * In : 1.45 * In;
    return { ok: Ib <= In && In <= Iz && I2 <= 1.45 * Iz + 1e-9, I2: I2, ibIn: Ib <= In, inIz: In <= Iz, i2: I2 <= 1.45 * Iz + 1e-9 };
  }
  /** Koruma türü seçimi: In ≤ 125 A ise MCB, üstü MCCB (TS EN 60898-1 kapsamı 125 A'e kadardır). */
  function breakerKind(Ib, preferred) {
    if (preferred === 'gG') { return 'gG'; }
    if (preferred === 'MCCB') { return 'MCCB'; }
    return Ib <= 125 ? 'MCB' : 'MCCB';
  }

  /** Kablo kesiti seçimi: koruma anma akımı, düzeltilmiş Iz ve gerilim düşümü birlikte kontrol edilir.
      o = { Ib, phases, U, cosphi, L, material, method, ambient, groups, protection: 'auto'|'gG'|'MCCB', dropLimit, prevDrop }
      Bakır PVC tabloları kullanılır (alüminyum için Iz tablosu bu araçta yoktur). */
  function selectCable(o) {
    var kind = breakerKind(o.Ib, o.protection);
    var In = pickProtection(o.Ib, kind);
    if (!In) { return { ok: false, reason: 'protection', kind: kind }; }
    var loaded = o.phases === 3 ? 3 : 2;
    var kt = tempFactor(o.ambient === undefined ? 30 : o.ambient), kg = groupFactor(o.groups || 1);
    var prev = o.prevDrop || 0;
    var firstIzOk = null;
    for (var i = 0; i < SECTIONS.length; i++) {
      var S = SECTIONS[i];
      var iz = cableIz(S, o.method, loaded, o.ambient, o.groups);
      if (!Number.isFinite(iz)) { continue; }
      var ov = overloadOk(o.Ib, In, iz, kind);
      if (!ov.ok) { continue; }
      if (firstIzOk === null) { firstIzOk = S; }
      var drop = o.L > 0 ? voltageDrop({ I: o.Ib, L: o.L, S: S, U: o.U, phases: o.phases, cosphi: o.cosphi, material: 'Cu', tempC: 70 }).pct : 0;
      if (o.L > 0 && o.dropLimit && drop + prev > o.dropLimit) { continue; }
      return { ok: true, S: S, Iz: iz, In: In, kind: kind, I2: ov.I2, drop: drop, totalDrop: drop + prev, kt: kt, kg: kg, governedBy: S === firstIzOk ? 'akım' : 'gerilim düşümü' };
    }
    return { ok: false, reason: firstIzOk === null ? 'ampacity' : 'drop', In: In, kind: kind, kt: kt, kg: kg };
  }

  /* --------------------------------------------------------------- akım hesapları */
  /** Yük akımı. phases 3: P/(√3·U·cosφ·η) (U hat gerilimi); phases 1: P/(U·cosφ·η) (U faz-nötr). P kW. */
  function loadCurrent(P_kW, U, phases, cosphi, eff) {
    var e = eff || 1;
    return P_kW * 1000 / ((phases === 3 ? SQRT3 : 1) * U * cosphi * e);
  }
  /** Trafo anma akımı I = S/(√3·U) (üç fazlı) veya S/U (tek fazlı); cosφ'den bağımsızdır. */
  function transformerCurrent(S_kVA, U, phases) { return S_kVA * 1000 / ((phases === 1 ? 1 : SQRT3) * U); }

  /* --------------------------------------------------------------- IEC 60909 AG kısa devre */
  var ICU_STEPS = [6, 10, 15, 25, 36, 50, 65, 70, 85, 100, 150];
  /** o = { S_kVA, uk, U (hat, V), Pk_W (isteğe bağlı), SkQ_MVA (0/boş = sonsuz şebeke), cable: { L, S, material, parallel } }
      Ik3max: c = 1,05, iletken 20 °C; Ik1min: c = 0,95, iletken arıza sonu ≈ 1,24·R20 (js/voltsim/engine.js ile aynı),
      Dyn trafoda Z0T ≈ ZT, faz ve PE iletkeni aynı kesitte. */
  function shortCircuit(o) {
    var U = o.U || 400, cmax = 1.05, cmin = 0.95;
    var Sr = o.S_kVA * 1000;
    var ZQ = o.SkQ_MVA > 0 ? cmax * U * U / (o.SkQ_MVA * 1e6) : 0;
    var XQ = 0.995 * ZQ, RQ = 0.1 * XQ;
    var ZT = (o.uk / 100) * U * U / Sr;
    var RT = (o.Pk_W || 0) * U * U / (Sr * Sr);
    var XT = Math.sqrt(Math.max(ZT * ZT - RT * RT, 0));
    var c = o.cable || {}, n = c.parallel || 1;
    var Rc = c.L > 0 ? c.L * resistivity(c.material, 20) / c.S / n : 0;
    var Xc = c.L > 0 ? X_CABLE * c.L / n : 0;
    var R = RQ + RT + Rc, X = XQ + XT + Xc, Z = Math.hypot(R, X);
    var Ik3 = cmax * U / (SQRT3 * Z);
    var kappa = 1.02 + 0.98 * Math.exp(-3 * R / Math.max(X, 1e-12));
    var ip = kappa * Math.SQRT2 * Ik3;
    var kT = 1.24;
    var Rs = (2 * (RQ + RT) + RT) / 3, Xs = (2 * (XQ + XT) + XT) / 3;
    var Rl = Rs + 2 * Rc * kT, Xl = Xs + 2 * Xc;
    var Ik1min = cmin * (U / SQRT3) / Math.hypot(Rl, Xl);
    var In = Sr / (SQRT3 * U);
    var icu = firstAtLeast(ICU_STEPS, Ik3 / 1000);
    return { In: In, Ik3: Ik3, ip: ip, kappa: kappa, Ik1min: Ik1min, Z: Z, R: R, X: X, ZT: ZT, ZQ: ZQ, icu: icu, cmax: cmax, cmin: cmin };
  }

  /* --------------------------------------------------------------- jeneratör (ISO 8528, anma cosφ 0,8) */
  var START_METHODS = {
    DOL: { k: 6, label: 'Doğrudan yol verme (Ik ≈ 6·In)' },
    YD: { k: 2, label: 'Yıldız-üçgen (Ik ≈ 2·In)' },
    SS: { k: 3, label: 'Yumuşak yolverici (Ik ≈ 3·In)' },
    VFD: { k: 1.2, label: 'Frekans konvertörü (Ik ≈ 1,2·In)' }
  };
  /** o = { P_kW, cosphi, simult (0–1), margin (0–1), motor_kW, start, U, xd (pu, varsayılan 0,20), dU (izin verilen geçici düşüm, varsayılan 0,15) }
      Sürekli: S1 = max(P·ks/cosφ, P·ks/0,8)·(1+pay) — jeneratör kW sınırı = kVA·0,8.
      Motor kalkışı: Sst = √3·U·k·In; gerilim bölücü yaklaşımıyla Sgen ≥ Sst·x'd·(1−ΔU)/ΔU. Gerekli = max(S1, S2). */
  function generatorSize(o) {
    var U = o.U || 400, xd = o.xd || 0.2, dU = o.dU || 0.15;
    var Prun = o.P_kW * o.simult;
    var Skva = Prun / o.cosphi, Skw = Prun / 0.8;
    var S1 = Math.max(Skva, Skw) * (1 + (o.margin || 0));
    var m = START_METHODS[o.start] || START_METHODS.DOL;
    var Inm = o.motor_kW > 0 ? loadCurrent(o.motor_kW, U, 3, 0.85, 0.9) : 0;
    var Sst = SQRT3 * U * m.k * Inm / 1000;
    var S2 = Sst * xd * (1 - dU) / dU;
    var required = Math.max(S1, S2);
    var list = config.technical.generatorKva;
    return { S1: S1, Skva: Skva, Skw: Skw, kwGoverns: Skw > Skva, Inm: Inm, Sst: Sst, S2: S2, required: required, startGoverns: S2 > S1, pick: firstAtLeast(list, required), xd: xd, dU: dU };
  }

  /* --------------------------------------------------------------- UPS ve akü (IEEE 485 yaklaşımı) */
  // Tipik VRLA: 1,75 V/hücre deşarj sonuna kadar kullanılabilir kapasitenin C10 kapasitesine oranı (deşarj süresi, dk).
  var VRLA_CAPACITY_FRACTION = [[5, 0.30], [10, 0.42], [15, 0.50], [20, 0.55], [30, 0.62], [45, 0.68], [60, 0.72], [90, 0.78], [120, 0.82], [180, 0.87], [300, 0.93], [600, 1.0]];
  /** o = { P_kW, pf, margin, minutes, Udc, invEff, aging (varsayılan 1,25), endCellV (varsayılan 1,75) } */
  function upsSize(o) {
    var kvaReq = o.P_kW / o.pf * (1 + (o.margin || 0));
    var aging = o.aging || 1.25, endV = o.endCellV || 1.75;
    var blocks = Math.round(o.Udc / 12), cells = blocks * 6;
    var Pdc = o.P_kW * 1000 / o.invEff;
    var wPerBlock = Pdc * aging / blocks;
    var Iend = Pdc * aging / (cells * endV);
    var frac = interp(VRLA_CAPACITY_FRACTION, o.minutes);
    var ahC10 = Iend * (o.minutes / 60) / frac;
    var energyKWh = Pdc * aging * (o.minutes / 60) / 1000;
    return { kvaReq: kvaReq, pick: firstAtLeast(config.technical.upsKva, kvaReq), blocks: blocks, cells: cells, Pdc: Pdc, wPerBlock: wPerBlock, Iend: Iend, frac: frac, ahC10: ahC10, energyKWh: energyKWh, aging: aging, endV: endV };
  }

  /* --------------------------------------------------------------- topraklama */
  // Aynı hatta dizilmiş, aralığı ≥ çubuk boyu olan düşey çubuklar için yaklaşık paralel çalışma verimi (BS 7430 / IEEE 142 eğilimi).
  var ROD_EFFICIENCY = [[1, 1], [2, 0.9], [3, 0.85], [4, 0.8], [5, 0.76], [6, 0.73], [8, 0.68], [10, 0.63], [12, 0.6], [15, 0.56], [20, 0.52], [30, 0.45]];
  /** Tek çubuk: R = ρ/(2πL)·(ln(8L/d) − 1) (Dwight). ρ mevsim katsayısıyla çarpılır. */
  function rodResistance(rho, L, d_m) { return rho / (2 * Math.PI * L) * (Math.log(8 * L / d_m) - 1); }
  function rodEfficiency(n) { return interp(ROD_EFFICIENCY, n); }
  /** Hedef dirence ulaşan en az çubuk sayısı (en çok 30). R_n = R1/(n·η(n)). */
  function rodsFor(R1, target) {
    for (var n = 1; n <= 30; n++) {
      var Rn = R1 / (n * rodEfficiency(n));
      if (Rn <= target) { return { n: n, R: Rn, eta: rodEfficiency(n) }; }
    }
    return { n: null, R: R1 / (30 * rodEfficiency(30)), eta: rodEfficiency(30) };
  }

  /* --------------------------------------------------------------- kompanzasyon (EPDK 5999-3) */
  var REACTIVE_LIMITS = { ge50: { ind: 20, cap: 15, label: '50 kVA ve üzeri' }, lt50: { ind: 33, cap: 20, label: '15 kW üzeri, 50 kVA altı' } };
  /** Qc = P·(tanφ1 − tanφ2); endüktif oran = tanφ·100 (aylık kVArh/kWh).
      Geçersiz girdi (P < 0, cosφ ∉ (0, 1]) NaN döndürür; hedef ≤ mevcut ise Qc ≤ 0 ve contradictory = true (kondansatör gerekmez). */
  function compensation(P_kW, cos1, cos2) {
    if (!(P_kW >= 0) || !(cos1 > 0 && cos1 <= 1) || !(cos2 > 0 && cos2 <= 1)) { return { Qc: NaN, ratio1: NaN, ratio2: NaN, contradictory: false }; }
    var t1 = Math.tan(Math.acos(cos1)), t2 = Math.tan(Math.acos(cos2));
    return { Qc: P_kW * (t1 - t2), ratio1: t1 * 100, ratio2: t2 * 100, contradictory: cos2 <= cos1 };
  }
  /** Endüktif oran sınırına karşılık gelen en düşük cosφ: cosφ = 1/√(1 + (oran/100)²) */
  function cosForRatio(ratioPct) { return 1 / Math.sqrt(1 + Math.pow(ratioPct / 100, 2)); }

  /* --------------------------------------------------------------- GES (FV) kablo */
  // H1Z2Z2-K tek kablo, havada, 60 °C ortam, 120 °C iletken (EN 50618 Tablo A.3).
  var SOLAR_IZ = { 1.5: 30, 2.5: 41, 4: 55, 6: 70, 10: 98, 16: 132, 25: 176, 35: 218, 50: 276, 70: 347, 95: 416, 120: 488, 150: 566, 185: 644, 240: 775 };
  /** DC hat: Ib = 1,25·Isc·Np (IEC 62548), Iz(EN 50618) ≥ Ib ve düşüm ≤ sınır (gidiş-dönüş, ρ 70 °C). */
  function selectDcCable(Ib, L, U, dropLimit) {
    for (var i = 0; i < SECTIONS.length; i++) {
      var S = SECTIONS[i];
      if (SOLAR_IZ[S] < Ib) { continue; }
      var d = voltageDrop({ I: Ib / 1.25, L: L, S: S, U: U, phases: 1, cosphi: 1, material: 'Cu', tempC: 70, dc: true }).pct;
      if (d <= dropLimit) { return { S: S, Iz: SOLAR_IZ[S], drop: d }; }
    }
    return null;
  }

  config.calc = {
    REFS: REFS, SQRT3: SQRT3, KAPPA20: KAPPA20, X_CABLE: X_CABLE, SECTIONS: SECTIONS, IZ: IZ, METHOD_NAMES: METHOD_NAMES,
    VDROP_LIMITS: VDROP_LIMITS, MCB_SIZES: MCB_SIZES, MCCB_SIZES: MCCB_SIZES, GG_SIZES: GG_SIZES, MCB_CURVES: MCB_CURVES,
    ICU_STEPS: ICU_STEPS, START_METHODS: START_METHODS, REACTIVE_LIMITS: REACTIVE_LIMITS, SOLAR_IZ: SOLAR_IZ,
    parseTr: parseTr, firstAtLeast: firstAtLeast, interp: interp, resistivity: resistivity, voltageDrop: voltageDrop,
    tempFactor: tempFactor, groupFactor: groupFactor, cableIz: cableIz, pickProtection: pickProtection, overloadOk: overloadOk,
    breakerKind: breakerKind, selectCable: selectCable, loadCurrent: loadCurrent, transformerCurrent: transformerCurrent,
    shortCircuit: shortCircuit, generatorSize: generatorSize, upsSize: upsSize, rodResistance: rodResistance,
    rodEfficiency: rodEfficiency, rodsFor: rodsFor, compensation: compensation, cosForRatio: cosForRatio, selectDcCable: selectDcCable
  };

  /* =====================================================================================
   * Form yardımcıları (yalnız tarayıcıda; hesaplama/*.html sayfaları ortak kullanır)
   * ===================================================================================== */
  var STYLE_ID = 'vg-calc-shared-style';
  var CSS = '.calc-hint{display:block;margin-top:.3rem;font-size:.78rem;line-height:1.45;color:var(--clr-text-muted,#5b6b7c)}'
    + '.mini-calc__field input[aria-invalid="true"],.mini-calc__field select[aria-invalid="true"]{border-color:#dc2626;outline-color:rgba(220,38,38,.25)}'
    + '.calc-breakdown{list-style:none;margin:.35rem 0 0;padding:.65rem 0 0;border-top:1px solid rgba(255,255,255,.18);display:grid;gap:.4rem;font-size:.82rem;line-height:1.4;color:rgba(255,255,255,.86)}'
    + '.calc-breakdown:empty{display:none}'
    + '.calc-breakdown li{display:flex;justify-content:space-between;gap:.75rem}'
    + '.calc-breakdown li span:last-child{font-weight:600;color:#fff;text-align:right}'
    + '.calc-breakdown li.is-over span:last-child{color:#fca5a5}.calc-breakdown li.is-ok span:last-child{color:#86efac}'
    + '.calc-live{display:flex;flex-direction:column;gap:.5rem}'
    + '.calc-assumptions{margin:.9rem 0 0;padding:.75rem .9rem;border-left:3px solid var(--clr-accent,#f59e0b);background:var(--clr-bg-gray,#f5f7fa);font-size:.84rem;line-height:1.55;color:var(--clr-text,#1e293b);grid-column:1/-1}'
    + '.calc-assumptions strong{display:block;margin-bottom:.2rem}'
    + '.calc-assumptions:empty{display:none}'
    + '.calc-status{margin:0 0 .35rem;padding:.3rem .6rem;border-radius:6px;font-size:.78rem;line-height:1.4;background:rgba(255,255,255,.1);color:#fff;border-left:3px solid #93c5fd}'
    + '.calc-status[data-code="hesaplandi"]{border-left-color:#86efac}.calc-status[data-code="varsayimsal"]{border-left-color:#93c5fd}'
    + '.calc-status[data-code="inceleme"]{border-left-color:#fcd34d}.calc-status[data-code="veri-eksik"]{border-left-color:#fca5a5}'
    + '@media (max-width:420px){.calc-breakdown li{flex-wrap:wrap}.calc-breakdown li span:last-child{margin-left:auto}}'
    + '@media print{.mini-calc__result{background:#fff!important;color:#0a1628!important;border:1px solid #0a1628}.mini-calc__result *,.calc-breakdown li span{color:#0a1628!important}}';

  function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) { return; }
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function fmt(n, d, minD) {
    return Number(n).toLocaleString('tr-TR', { maximumFractionDigits: d === undefined ? 2 : d, minimumFractionDigits: minD || 0 });
  }
  function pct(n, d) { return '%' + fmt(n, d === undefined ? 2 : d); }
  function labelText(id) {
    var l = document.querySelector('label[for="' + id + '"]');
    return l ? l.textContent.replace(/\s+/g, ' ').trim() : id;
  }
  /** Okuyucu: alanları doğrular, ilk hatayı saklar ve hatalı alanı aria-invalid ile işaretler. */
  function reader() {
    var r = { error: '' };
    r.num = function (id, o) {
      o = o || {};
      var el = document.getElementById(id);
      var raw = String(el.value).trim();
      el.removeAttribute('aria-invalid');
      if (raw === '' && o.optional) { return o.fallback === undefined ? null : o.fallback; }
      var v = parseTr(raw);
      var msg = '';
      if (raw === '') { msg = 'bir değer girin'; }
      else if (Number.isNaN(v)) { msg = 'geçerli bir sayı girin (ondalık için virgül, binlik için nokta kullanın)'; }
      else if (o.integer && !Number.isInteger(v)) { msg = 'tam sayı girin'; }
      else if (o.positive && !(v > 0)) { msg = "0'dan büyük olmalı"; }
      else if ((o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max)) {
        msg = (o.min !== undefined && o.max !== undefined) ? fmt(o.min, 4) + '–' + fmt(o.max, 4) + ' aralığında olmalı'
          : o.min !== undefined ? 'en az ' + fmt(o.min, 4) + ' olmalı' : 'en çok ' + fmt(o.max, 4) + ' olmalı';
      }
      if (msg) {
        el.setAttribute('aria-invalid', 'true');
        if (!r.error) { r.error = labelText(id) + ': ' + msg + '.'; }
        return NaN;
      }
      return v;
    };
    r.sel = function (id) { return document.getElementById(id).value; };
    r.selNum = function (id) { return Number(document.getElementById(id).value); };
    return r;
  }
  function setList(ul, rows) {
    if (!ul) { return; }
    ul.textContent = '';
    (rows || []).forEach(function (row) {
      var li = document.createElement('li');
      if (row[2]) { li.className = row[2]; }
      var a = document.createElement('span'); a.textContent = row[0];
      var b = document.createElement('span'); b.textContent = row[1];
      li.appendChild(a); li.appendChild(b);
      ul.appendChild(li);
    });
  }
  /** Sonuç durumu: js/voltsim/identity.js STATUS ile aynı dört ayrı durum (calc-identity testi eşitliği denetler).
      Hiçbiri "mevzuata uygundur" veya "uygulama için onaylıdır" anlamına gelmez. */
  var STATUS = {
    'veri-eksik': { label: 'Veri eksik', desc: 'Gerekli bir girdi boş, geçersiz ya da diğer girdilerle çelişkili. Sonuç üretilmedi; işaretli alanları düzeltin.' },
    'inceleme': { label: 'Mühendis incelemesi gerekli', desc: 'En az bir ön kontrol sağlanmadı ya da sonuç modelin geçerlilik sınırına yakın. Yetkili mühendis değerlendirmesi olmadan uygulamaya esas alınmamalıdır.' },
    'varsayimsal': { label: 'Varsayımsal', desc: 'Sonuç örnek, tipik veya senaryo değerlerine dayanıyor. Katalog ve saha verisi girildiğinde değişebilir.' },
    'hesaplandi': { label: 'Hesaplandı', desc: 'Girilen değerlerle, belirtilen yöntem ve varsayımlar içinde hesaplandı. Ön hesaptır; mevzuata uygunluk veya uygulama onayı değildir.' }
  };
  /** out.status verilmezse: sınırı aşan satır (is-over) varsa "inceleme", yoksa "hesaplandı". out.statusReasons: gerekçeler. */
  function statusOf(out) {
    if (out.status && STATUS[out.status]) { return out.status; }
    return (out.rows || []).some(function (r) { return r[2] === 'is-over'; }) ? 'inceleme' : 'hesaplandi';
  }
  function renderStatus(p, out) {
    var res = document.getElementById(p + '-result');
    if (!res || !res.parentNode) { return; }
    var box = document.getElementById(p + '-status');
    if (!box) {
      box = document.createElement('p');
      box.id = p + '-status'; box.className = 'calc-status';
      res.parentNode.insertBefore(box, res);
    }
    var code = statusOf(out), st = STATUS[code];
    box.setAttribute('data-code', code);
    box.textContent = '';
    var b = document.createElement('strong'); b.textContent = st.label; box.appendChild(b);
    var reasons = (out.statusReasons || []).filter(Boolean);
    box.appendChild(document.createTextNode(' · ' + (reasons.length ? reasons.join(' ') : st.desc)));
    box.title = st.desc;
  }
  /** Sonucu yazar. p: önek (ör. 'vd') → #p-result, #p-detail, #p-breakdown, #p-assumptions */
  function show(p, out) {
    renderStatus(p, out);
    document.getElementById(p + '-result').textContent = out.value;
    document.getElementById(p + '-detail').textContent = out.note || '';
    setList(document.getElementById(p + '-breakdown'), out.rows);
    var as = document.getElementById(p + '-assumptions');
    if (as) {
      as.textContent = '';
      if (out.assumptions && out.assumptions.length) {
        var h = document.createElement('strong'); h.textContent = 'Formül, kabuller ve dayanak';
        as.appendChild(h);
        as.appendChild(document.createTextNode(out.assumptions.join(' ')));
      }
    }
  }
  function fail(p, msg) { show(p, { value: '-', note: msg, rows: [], assumptions: [], status: 'veri-eksik' }); }
  function bind(ids, fn) {
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      el.addEventListener('input', fn);
      el.addEventListener('change', fn);
    });
    ensureStyles();
    fn();
  }
  config.ui = { ensureStyles: ensureStyles, fmt: fmt, pct: pct, reader: reader, show: show, fail: fail, bind: bind, setList: setList, STATUS: STATUS, statusOf: statusOf };

  return config;
}));
