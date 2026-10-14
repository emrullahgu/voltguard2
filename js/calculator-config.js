window.VoltGuardCalculatorConfig = {
  version: '2026-10-12',
  // Fiyat varsayımı tutulmaz: GES yatırım maliyeti, elektrik birim bedeli, proje ve güç artırımı birim bedelleri
  // kullanıcının kendi teklif/fatura değerleriyle girilir (sahibi onaylı kaynaklı bir değer verene kadar).
  pricing: {
    panelWatt: 550,
    inverterAcRatio: 0.8,
    performanceRatio: 0.95,
    areaPerKwpRoof: 5.5,
    areaPerKwpLand: 8
  },
  technical: {
    copperResistivity: 0.0175,
    voltageDropLimitLightingPct: 3,
    voltageDropLimitPowerPct: 5,
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
    // Iz (A): bakır, PVC, 30 °C, kanal/boru içi (Yöntem B1); bilgi/kablo-kesiti-akim-tasima-tablosu.html ve bağımsız hesap sayfalarıyla aynı değerler.
    ampacityB1ThreeLoaded: [15.5, 21, 28, 36, 50, 68, 89, 110, 134, 171, 207, 239, 262, 296, 346],
    ampacityB1TwoLoaded: [17.5, 24, 32, 41, 57, 76, 101, 125, 151, 192, 232, 269, 300, 341, 400],
    transformerKva: [50, 100, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500],
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
window.VoltGuardCalculatorConfig.calcIsletmeUcreti = function (o) {
  'use strict';
  var t = window.VoltGuardCalculatorConfig.emoIsletme;
  var r2 = function (x) { return Math.round(x * 100) / 100; };
  var tl = function (x) { return x.toLocaleString('tr-TR', { maximumFractionDigits: 2 }); };
  var tl2 = function (x) { return x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var kva = Number(o.kva);
  var optionalNumber = function (value, fallback) { return value === undefined || value === null ? fallback : Number(value); };
  var fYa = optionalNumber(o.feederYa, 0);
  var fSk = optionalNumber(o.feederSk, 0);
  var enhM = optionalNumber(o.enhM, 0);
  var bk = optionalNumber(o.bk, 1);
  if (['bina','direk'].indexOf(o.type) === -1) { return { ok: false, error: 'Geçerli bir trafo tipi seçin.' }; }
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
