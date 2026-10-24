/* VoltGuard ön değerlendirme araçları — saf hesap fonksiyonları (DOM yok).
 *   trafoCapacity  : hesaplama/trafo-kapasite-artirimi.html
 *   harmonicNeed   : hesaplama/harmonik-filtre-ihtiyaci.html
 *   factoryRisk    : hesaplama/fabrika-elektrik-risk-testi.html (+ RISK_QUESTIONS)
 * Tarayıcıda window.VGAssess, Node'da module.exports (tools/tests/assess-tools.test.cjs).
 * Sonuçlar ön değerlendirmedir; proje, ölçüm ve dağıtım şirketi onayı yerine geçmez. */
(function (root) {
  'use strict';

  /* Dağıtım trafosu anma güçleri (kVA) — TS EN 60076 / IEC 60076 tercihli değerlerinden Türkiye'de yaygın olanlar. */
  var STD_KVA = [50, 100, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150];

  function finite(v) { return typeof v === 'number' && isFinite(v); }
  function err(field, message) { return { ok: false, field: field, error: message }; }
  function nextStd(kva) { for (var i = 0; i < STD_KVA.length; i++) if (STD_KVA[i] >= kva - 1e-9) return STD_KVA[i]; return null; }
  function tanPhi(cos) { return Math.sqrt(1 - cos * cos) / cos; }
  function round(v, d) { var f = Math.pow(10, d || 0); return Math.round(v * f) / f; }

  /* ------------------------------------------------------------------ (a) trafo kapasite artırımı */
  /**
   * @param {object} p sn (kVA), pPeak (kW, ölçülen/tahmini en yüksek aktif güç), cosNow, growthPct (%/yıl), years,
   *   newKw (eklenecek yük, kW), newCos, simult (eşzamanlılık 0–1), targetPct (hedef en yüksek yüklenme %), voltage (AG, V)
   * Yöntem: aktif ve reaktif güç ayrı toplanır (S = √(P² + Q²)); mevcut yük yıllık büyüme ile (1+g)^n büyütülür.
   */
  function trafoCapacity(p) {
    var sn = p.sn, P = p.pPeak, cos = p.cosNow, g = p.growthPct, n = p.years, Pn = p.newKw, cosN = p.newCos, ks = p.simult, tgt = p.targetPct;
    var U = finite(p.voltage) ? p.voltage : 400;
    if (!finite(sn) || sn < 25 || sn > 40000) return err('sn', 'Mevcut trafo gücü için 25–40.000 kVA arası bir değer girin.');
    if (!finite(P) || P <= 0 || P > 100000) return err('pPeak', 'En yüksek yük için 0\'dan büyük bir kW değeri girin.');
    if (!finite(cos) || cos < 0.5 || cos > 1) return err('cosNow', 'cosφ 0,50 ile 1,00 arasında olmalı.');
    if (!finite(g) || g < 0 || g > 30) return err('growthPct', 'Yıllık büyüme %0–30 arasında olmalı.');
    if (!finite(n) || n < 0 || n > 20 || Math.floor(n) !== n) return err('years', 'Plan süresi 0–20 yıl arasında tam sayı olmalı.');
    if (!finite(Pn) || Pn < 0 || Pn > 100000) return err('newKw', 'Yeni yük için 0 veya pozitif bir kW değeri girin.');
    if (!finite(cosN) || cosN < 0.5 || cosN > 1) return err('newCos', 'Yeni yüklerin cosφ değeri 0,50 ile 1,00 arasında olmalı.');
    if (!finite(ks) || ks < 0.1 || ks > 1) return err('simult', 'Eşzamanlılık katsayısı 0,1 ile 1,0 arasında olmalı.');
    if (!finite(tgt) || tgt < 50 || tgt > 100) return err('targetPct', 'Hedef yüklenme %50–100 arasında olmalı.');

    var sNow = P / cos;
    var growth = Math.pow(1 + g / 100, n);
    var pExist = P * growth, qExist = pExist * tanPhi(cos);
    var pNew = Pn * ks, qNew = pNew * tanPhi(cosN);
    var pTot = pExist + pNew, qTot = qExist + qNew;
    var sFut = Math.sqrt(pTot * pTot + qTot * qTot);
    var cosFut = pTot / sFut;
    var limit = sn * tgt / 100;
    var sReq = sFut / (tgt / 100);
    var k = Math.sqrt(3) * U / 1000; // kVA → A
    var res = {
      ok: true, sNow: sNow, loadNow: sNow / sn * 100, pFuture: pTot, qFuture: qTot, sFuture: sFut, cosFuture: cosFut,
      loadFuture: sFut / sn * 100, sRequired: sReq, iRated: sn / k, iNow: sNow / k, iFuture: sFut / k, growthFactor: growth,
      sufficient: sFut <= limit + 1e-9, overloadNow: sNow > sn, options: []
    };
    // Kompanzasyonla erteleme: cosφ 0,98'e çıkarılırsa aynı aktif güç için gereken kVA
    res.sAt098 = pTot / 0.98;
    res.compDefers = !res.sufficient && cosFut < 0.98 && res.sAt098 <= limit + 1e-9;
    if (res.sufficient) {
      res.status = 'yeterli';
      res.options.push({ id: 'mevcut', title: 'Mevcut trafo yeterli', detail: 'Plan sonunda yüklenme %' + round(res.loadFuture, 1) + ' ile hedef %' + tgt + ' sınırının altında kalıyor. Yük büyümesini yıllık ölçümle izleyin.' });
      return res;
    }
    res.status = res.loadFuture > 100 ? 'asiri' : 'sinirda';
    var r1 = nextStd(sReq);
    res.replacement = r1;
    if (r1) {
      res.options.push({ id: 'degisim', title: 'Trafo değişimi: ' + r1 + ' kVA', detail: 'Gereken en az ' + Math.ceil(sReq) + ' kVA için bir üst standart güç ' + r1 + ' kVA; yeni trafoda yüklenme yaklaşık %' + round(sFut / r1 * 100, 0) + '. OG hücre, AG ana şalter, kablo ve kısa devre dayanımı yeni güce göre kontrol edilmelidir.' });
    } else {
      res.options.push({ id: 'cok-buyuk', title: 'Tek trafo yetersiz (> 3150 kVA)', detail: 'Gereken güç ' + Math.ceil(sReq) + ' kVA; birden fazla trafo veya OG dağıtım/yük bölme çalışması gerekir.' });
    }
    var extra = sReq - sn;
    var r2 = nextStd(extra);
    res.second = r2;
    if (r2) {
      var ratio = Math.max(sn, r2) / Math.min(sn, r2);
      res.parallelOk = ratio <= 3;
      res.options.push({ id: 'ikinci', title: 'İkinci trafo: ' + r2 + ' kVA', detail: res.parallelOk
        ? 'Mevcut trafoya ek ' + r2 + ' kVA. Paralel çalışma için bağlantı grubu ve dönüştürme oranı aynı, uk değerleri yakın (±%10) olmalı; güç oranı 1:3 içinde (' + round(ratio, 2) + '). Alternatif: yükleri iki ayrı AG barasına bölmek.'
        : 'Güç oranı ' + round(ratio, 2) + ' (1:3 üzerinde) olduğundan paralel çalışma önerilmez; yükleri ayrı AG baralarına bölün veya daha büyük tek trafo seçin.' });
    }
    if (res.compDefers) {
      res.options.push({ id: 'kompanzasyon', title: 'Önce kompanzasyon', detail: 'Ortalama cosφ ' + round(cosFut, 2) + ' yerine 0,98 olursa gereken güç ' + Math.ceil(res.sAt098) + ' kVA\'ya iner ve hedef yüklenmenin altında kalır; kapasite artırımı ertelenebilir.' });
    }
    return res;
  }

  /* ------------------------------------------------------------------ (b) harmonik filtre ihtiyacı */
  /* Tipik akım THD değerleri (ön değerlendirme kabulü; gerçek değer ölçümle belirlenir). hEff: baskın harmonik mertebesi. */
  var NL_TYPES = {
    vfd: { thd: 0.40, h: 5, name: 'Sürücü (VFD, 6 darbeli, şok bobinli)' },
    ups: { thd: 0.30, h: 5, name: 'UPS / redresör' },
    led: { thd: 0.80, h: 3, name: 'LED sürücü, SMPS, bilgisayar (tek fazlı)' },
    other: { thd: 0.40, h: 5, name: 'Kaynak, indüksiyon, diğer' }
  };
  var RISK = ['Düşük', 'Orta', 'Yüksek', 'Çok yüksek'];

  /**
   * @param {object} p sT (kVA), ukPct (%), skGridMva (OG şebeke kısa devre gücü, MVA; 0/boş = sonsuz şebeke), pLoad (kW),
   *   vfd, ups, led, other (doğrusal olmayan yükler, kW), qc (devredeki kondansatör, kVAr), reactor ('none'|'p7'|'p14'), voltage (V)
   */
  function harmonicNeed(p) {
    var sT = p.sT, uk = p.ukPct, sk = p.skGridMva, P = p.pLoad, qc = p.qc, reactor = p.reactor || 'none';
    var U = finite(p.voltage) ? p.voltage : 400;
    if (!finite(sT) || sT < 25 || sT > 40000) return err('sT', 'Trafo gücü için 25–40.000 kVA arası bir değer girin.');
    if (!finite(uk) || uk < 2 || uk > 15) return err('ukPct', 'uk %2–15 arasında olmalı (etiket değeri).');
    if (sk !== null && sk !== undefined && (!finite(sk) || sk < 0 || sk > 10000)) return err('skGridMva', 'Şebeke kısa devre gücü 0–10.000 MVA arasında olmalı.');
    if (!finite(P) || P <= 0 || P > 100000) return err('pLoad', 'Toplam yük için 0\'dan büyük bir kW değeri girin.');
    if (!finite(qc) || qc < 0 || qc > 50000) return err('qc', 'Kondansatör gücü için 0 veya pozitif bir kVAr değeri girin.');
    if (['none', 'p7', 'p14'].indexOf(reactor) < 0) return err('reactor', 'Reaktör seçimi geçersiz.');
    var nl = 0, ihKva = 0, uSum = 0, parts = [];
    for (var key in NL_TYPES) {
      var v = p[key];
      if (v === undefined || v === null) v = 0;
      if (!finite(v) || v < 0) return err(key, NL_TYPES[key].name + ' için 0 veya pozitif bir kW değeri girin.');
      nl += v;
      parts.push({ id: key, kw: v });
    }
    if (nl > P + 1e-9) return err('vfd', 'Doğrusal olmayan yüklerin toplamı toplam yükten büyük olamaz.');

    var sTrafoSc = sT / (uk / 100);                       // kVA
    var ssc = sk ? 1 / (1 / sTrafoSc + 1 / (sk * 1000)) : sTrafoSc;
    parts.forEach(function (x) {
      var t = NL_TYPES[x.id];
      var ih = x.kw / 0.9 * t.thd;                        // harmonik akımın kVA eşdeğeri (cosφ ≈ 0,9 kabulü)
      ihKva += ih;
      uSum += ih * t.h;                                   // U_h ≈ h · I_h · X_k (X_k = S_baz / S_k)
    });
    var gh = nl / 0.9;                                    // harmonik üreten yüklerin görünür gücü
    var ghRatio = gh / sT;
    var thdi = ihKva / (P / 0.9) * 100;
    var thdu = uSum / ssc * 100;
    var ledShare = nl > 0 ? (p.led || 0) / nl : 0;
    var res = { ok: true, ssc: ssc, sscMva: ssc / 1000, gh: gh, ghRatio: ghRatio, nlShare: nl / P, thdiEst: thdi, thduEst: thdu, ledShare: ledShare };

    var ghLevel = ghRatio <= 0.15 ? 0 : ghRatio <= 0.25 ? 1 : ghRatio <= 0.5 ? 2 : 3;
    var thduLevel = thdu < 3 ? 0 : thdu < 5 ? 1 : thdu < 8 ? 2 : 3;
    var resLevel = 0;
    res.hr = qc > 0 ? Math.sqrt(ssc / qc) : null;
    if (qc > 0 && reactor === 'none') {
      var orders = [5, 7, 11, 13];
      if (ledShare >= 0.3) orders.unshift(3);
      var dist = Math.min.apply(null, orders.map(function (h) { return Math.abs(res.hr - h); }));
      res.nearestOrder = orders.reduce(function (a, h) { return Math.abs(res.hr - h) < Math.abs(res.hr - a) ? h : a; }, orders[0]);
      resLevel = dist <= 0.5 ? 3 : dist <= 1 ? 2 : (res.hr >= 2.5 && res.hr <= 14) ? 1 : 0;
      if (nl === 0) resLevel = Math.min(resLevel, 1);  // harmonik kaynağı yoksa rezonans uyarılmaz
    }
    res.levels = { gh: ghLevel, thdu: thduLevel, resonance: resLevel };
    res.level = Math.max(ghLevel, thduLevel, resLevel);
    res.risk = RISK[res.level];
    res.ghClass = ['Standart kondansatör (Gh/Sn ≤ %15)', 'Güçlendirilmiş kondansatör (Gh/Sn %15–25)', 'Reaktörlü kompanzasyon (Gh/Sn %25–50)', 'Harmonik filtre (Gh/Sn > %50)'][ghLevel];
    var pSel = ledShare >= 0.3 ? 0.14 : 0.07;
    res.reactorP = pSel;
    res.tuneHz = 50 / Math.sqrt(pSel);
    res.capVoltageMin = U / (1 - pSel);
    res.capVoltageRated = res.capVoltageMin <= 440 ? 440 : res.capVoltageMin <= 480 ? 480 : 525;
    var rec = [];
    if (reactor !== 'none') {
      rec.push('Reaktörlü kompanzasyon zaten var (p = %' + (reactor === 'p7' ? 7 : 14) + '): paralel rezonans ayar frekansının altına çekilmiş durumda. Reaktör sıcaklığı, kondansatör akımı ve kapasite kaybı yıllık kontrol edilmelidir.');
    }
    if (res.level === 0) {
      rec.push('Standart kompanzasyon yeterli görünüyor. Yeni sürücü/UPS yatırımı öncesi değerlendirmeyi tekrarlayın.');
    } else {
      rec.push('Önce ölçüm: EN 61000-4-30 Sınıf A analizörle en az 1 hafta THDv, THDi, harmonik spektrum ve kompanzasyon kademe davranışı kaydedilmeli (EN 50160: AG\'de THDv ≤ %8).');
      if (reactor === 'none' && (res.level >= 2 || ghLevel >= 1)) {
        rec.push('Reaktörlü (detuned) kompanzasyon: p = %' + Math.round(pSel * 100) + ' (ayar ≈ ' + Math.round(res.tuneHz) + ' Hz)' + (pSel === 0.14 ? '; 3. harmonik baskın olabileceği için %14 seçildi.' : '.') +
          ' Kondansatör gerilimi U/(1−p) ≈ ' + Math.round(res.capVoltageMin) + ' V olur; ' + res.capVoltageRated + ' V anma gerilimli kondansatör seçilmeli.');
      }
      if (res.level === 3 || ghLevel === 3) rec.push('Aktif harmonik filtre: harmonik yük oranı veya tahmini THDv yüksek; ölçümle filtre akımı (A) boyutlandırılmalı ve kaynak taraflı çözümler (sürücüde DC şok, 12/18 darbeli veya aktif önyüz) birlikte değerlendirilmeli.');
    }
    res.recommendations = rec;
    res.service = res.level >= 2 ? 'harmonik-filtreli-kompanzasyon' : 'enerji-kalitesi-olcumu';
    return res;
  }

  /* ------------------------------------------------------------------ (c) fabrika elektrik risk testi */
  /* Her soru: ağırlık (1–3), seçenek puanı 0 (iyi) – 3 (kötü), critical: tek başına profili en az "Yüksek" yapar. */
  var RISK_QUESTIONS = [
    { id: 'periyodik', weight: 3, q: 'Elektrik iç tesisatının son periyodik kontrolü ne zaman yapıldı?',
      basis: 'İş Ekipmanları Yönetmeliği EK-III Tablo-3: en fazla 1 yıl.',
      options: [['12 ay içinde, rapor uygun', 0], ['12–24 ay önce', 2], ['24 aydan önce veya hiç', 3, true], ['Bilmiyorum', 2]],
      action: 'Yetkili kişiye elektrik iç tesisatı periyodik kontrolü yaptırın ve uygunsuzlukları kapatın.',
      links: [['/hizmetler/elektrik-periyodik-kontrol.html', 'Elektrik periyodik kontrol'], ['/hesaplama/periyodik-kontrol-planlayici/', 'Periyodik kontrol planlayıcı']], service: 'elektrik-periyodik-kontrol' },
    { id: 'topraklama', weight: 3, q: 'Topraklama tesisatı son ne zaman ölçüldü?',
      basis: 'EK-III Tablo-3: en fazla 1 yıl; kriter dokunma gerilimi (TT: RA × IΔn ≤ 50 V).',
      options: [['12 ay içinde, rapor uygun', 0], ['12 ay içinde ama uygunsuz bulgu var', 3, true], ['12 aydan önce', 2], ['Hiç / bilmiyorum', 3, true]],
      action: 'Topraklama ve potansiyel dengeleme ölçümünü yenileyin; uygunsuz noktaları ölçümle doğrulayarak düzeltin.',
      links: [['/hizmetler/topraklama-olcumu.html', 'Topraklama ölçümü'], ['/bilgi/topraklama-degeri-kac-olmali.html', 'Topraklama değeri kaç olmalı?']], service: 'topraklama-olcumu' },
    { id: 'rcd', weight: 3, q: 'Priz ve seyyar cihaz devrelerinde 30 mA kaçak akım rölesi var mı, test ediliyor mu?',
      basis: 'TS HD 60364-4-41: 32 A\'ya kadar priz devrelerinde 30 mA RCD ek koruma.',
      options: [['Var ve test butonu düzenli deneniyor', 0], ['Var ama test edilmiyor', 1], ['Bazı devrelerde yok', 3, true], ['Bilmiyorum', 2]],
      action: 'Eksik devrelere uygun tipte (A/F/B) 30 mA RCD ekleyin; tüm RCD\'leri test butonu ve ölçüm cihazıyla deneyin.',
      links: [['/bilgi/kacak-akim-rolesi-secimi.html', 'Kaçak akım rölesi seçimi'], ['/hizmetler/elektrik-pano-imalati.html', 'Pano revizyonu']], service: 'elektrik-pano-imalati' },
    { id: 'trafo', weight: 3, q: 'Trafo (OG abone iseniz) bakım ve testleri ne zaman yapıldı?',
      basis: 'EK-III Tablo-3: transformatör kontrolü en fazla 1 yıl.',
      options: [['Trafom yok (AG abone)', 0], ['12 ay içinde bakım ve test yapıldı', 0], ['12 aydan önce', 2], ['Hiç / bilmiyorum', 3, true]],
      action: 'Trafo bakımı (yağ/izolasyon testleri, OG hücre, koruma rölesi denemesi) planlayın.',
      links: [['/hizmetler/trafo-bakimi.html', 'Trafo bakımı'], ['/bilgi/trafo-periyodik-bakim.html', 'Trafo periyodik bakım rehberi']], service: 'trafo-bakimi' },
    { id: 'sorumlu', weight: 2, q: 'OG tesisiniz için işletme sorumlusu atanmış mı?',
      basis: 'Elektrik tesislerinde işletme sorumluluğu mevzuatı (OG aboneler).',
      options: [['AG aboneyim, gerekmiyor', 0], ['Atanmış, sözleşme güncel', 0], ['Belirsiz veya sözleşme sona erdi', 3, true]],
      action: 'Yetkili bir mühendisle işletme sorumluluğu sözleşmesi yapın ve dağıtım şirketine bildirin.',
      links: [['/hizmetler/trafo-isletme-sorumlulugu.html', 'Trafo işletme sorumluluğu'], ['/hesaplama/isletme-sorumlulugu-ucret-hesaplama/', 'İşletme sorumluluğu ücreti']], service: 'trafo-isletme-sorumlulugu' },
    { id: 'termal', weight: 2, q: 'Panolarda termal kamera incelemesi yapılıyor mu?',
      basis: 'Gevşek bağlantı ve aşırı yük, arızadan önce sıcaklık artışı olarak görülür.',
      options: [['Son 12 ayda yapıldı, bulgular giderildi', 0], ['Yapıldı ama bulgular hâlâ açık', 3], ['12 aydan önce yapıldı', 1], ['Hiç yapılmadı', 2]],
      action: 'Yük altındayken pano termal incelemesi yaptırın; sıcak noktaları sıkma, ekipman değişimi veya yük dengelemesiyle giderin.',
      links: [['/sor/kablo-neden-isiniyor.html', 'Kablo neden ısınır?'], ['/hizmetler/elektrik-periyodik-kontrol.html', 'Periyodik kontrol ve termal inceleme']], service: 'elektrik-periyodik-kontrol' },
    { id: 'pano', weight: 2, q: 'Panoların yaşı ve tek hat şeması/dokümantasyonu ne durumda?',
      basis: 'Güncel şema; koruma koordinasyonu, bakım ve güvenli çalışma (kilitleme-etiketleme) için gerekir.',
      options: [['Panolar görece yeni, şemalar güncel', 0], ['Şemalar güncel değil', 2], ['Eski panolar, revizyon görmemiş', 2], ['Eski panolar ve şema yok', 3]],
      action: 'Tek hat şemalarını sahaya göre güncelleyin; eski panolarda koruma seçimi ve kısa devre dayanımını kontrol edip revizyon planlayın.',
      links: [['/hizmetler/elektrik-pano-imalati.html', 'Pano imalatı ve revizyonu'], ['/hesaplama/sigorta-tms-secimi/', 'Sigorta / TMŞ seçimi']], service: 'elektrik-pano-imalati' },
    { id: 'kapasite', weight: 2, q: 'Trafo veya ana besleme en yüksek yükte ne kadar yükleniyor?',
      basis: 'Sürekli yüksek yüklenme izolasyon ömrünü kısaltır ve yeni yük için pay bırakmaz.',
      options: [['Kapasitenin %80\'inin altında', 0], ['%80–100 arası', 2], ['Yeni makine eklenecek, kapasite belirsiz', 2], ['Bilmiyorum', 1]],
      action: 'En yüksek yükü ölçün ve kapasite artırımı ön değerlendirmesi yapın.',
      links: [['/hesaplama/trafo-kapasite-artirimi/', 'Trafo kapasite artırımı ön değerlendirmesi'], ['/hizmetler/trafo-merkezi-kurulumu.html', 'Trafo merkezi kurulumu']], service: 'trafo-merkezi-kurulumu' },
    { id: 'kompanzasyon', weight: 2, q: 'Son 12 ayda kompanzasyon / reaktif enerji durumu?',
      basis: 'Reaktif sınır aşılırsa ölçülen reaktif enerjinin tamamı faturalanır.',
      options: [['Ceza ve alarm yok', 0], ['Ara sıra alarm veya kademe arızası', 1], ['Reaktif ceza ödendi', 2], ['Kondansatör şişmesi, sigorta atması veya ısınma', 3]],
      action: 'Kompanzasyon panosunu kontrol edin (kademe, kontaktör, kondansatör kapasitesi); harmonik varsa reaktörlü çözümü değerlendirin.',
      links: [['/hesaplama/reaktif-ceza-hesaplama/', 'Reaktif ceza hesaplama'], ['/hesaplama/harmonik-filtre-ihtiyaci/', 'Harmonik filtre ihtiyacı']], service: 'harmonik-filtreli-kompanzasyon' },
    { id: 'harmonik', weight: 2, q: 'Sürücü (VFD), UPS, LED gibi harmonik üreten yükler ve ölçüm durumu?',
      basis: 'EN 50160: AG\'de THDv ≤ %8; rezonans kondansatör ve trafoyu zorlar.',
      options: [['Az veya ölçüm yapıldı, uygun', 0], ['Önemli oranda var, ölçüm yapılmadı', 2], ['Var ve açıklanamayan arıza/ısınma görülüyor', 3]],
      action: 'Enerji kalitesi ölçümü (en az 1 hafta) yaptırın; sonuçlara göre reaktörlü kompanzasyon veya aktif filtre seçin.',
      links: [['/hizmetler/enerji-kalitesi-olcumu.html', 'Enerji kalitesi ölçümü'], ['/bilgi/harmonik-nedir-sorunlari.html', 'Harmonik nedir?']], service: 'enerji-kalitesi-olcumu' },
    { id: 'yedek', weight: 2, q: 'Jeneratör / UPS yedek güç sistemleri nasıl test ediliyor?',
      basis: 'EK-III Tablo-3: jeneratör ve akümülatör kontrolü en fazla 1 yıl.',
      options: [['Yedek güç gerekmiyor', 0], ['Yük altında düzenli test ediliyor', 0], ['Yalnızca boşta çalıştırılıyor', 1], ['Test edilmiyor / akü yaşı bilinmiyor', 2]],
      action: 'Yedek gücü gerçek yük altında (transfer dahil) test edin; akü kapasite testi yapın.',
      links: [['/hesaplama/jenerator-gucu-hesaplama/', 'Jeneratör gücü'], ['/hesaplama/ups-gucu-hesaplama/', 'UPS gücü ve akü süresi']], service: 'elektrik-taahhut' },
    { id: 'kesinti', weight: 2, q: 'Son 12 ayda elektrik kaynaklı plansız duruş oldu mu?',
      basis: 'Tekrarlayan duruşlar çoğunlukla koruma, enerji kalitesi veya kapasite sorununa işaret eder.',
      options: [['Olmadı', 0], ['1–2 kez', 1], ['3 kez veya daha fazla', 3]],
      action: 'Duruş kayıtlarını (zaman, açan koruma, yük) toplayın; enerji kalitesi ölçümüyle kök neden analizi yapın.',
      links: [['/fabrika-cozumleri.html', 'Fabrikalar için çözümler (duruş maliyeti)'], ['/hizmetler/enerji-kalitesi-olcumu.html', 'Enerji kalitesi ölçümü']], service: 'enerji-kalitesi-olcumu' }
  ];
  var PRIORITY = ['', 'Planlı (3–12 ay)', 'Öncelikli (1–3 ay)', 'Acil (0–30 gün)'];

  /** @param {object} answers { soruId: seçenekIndeksi } — yanıtlanmayan sorular hesaba katılmaz. */
  function factoryRisk(answers) {
    answers = answers || {};
    var got = 0, max = 0, answered = 0, critical = [], actions = [];
    RISK_QUESTIONS.forEach(function (q) {
      var idx = answers[q.id];
      if (idx === undefined || idx === null || idx === '') return;
      idx = Number(idx);
      var opt = q.options[idx];
      if (!opt) return;
      answered++;
      got += opt[1] * q.weight;
      max += 3 * q.weight;
      if (opt[2]) critical.push(q.id);
      if (opt[1] > 0) {
        actions.push({ id: q.id, question: q.q, answer: opt[0], score: opt[1], weight: q.weight, rank: opt[1] * q.weight + (opt[2] ? 10 : 0),
          priority: PRIORITY[Math.min(3, opt[1] + (opt[2] ? 1 : 0))], action: q.action, links: q.links, service: q.service, basis: q.basis });
      }
    });
    actions.sort(function (a, b) { return b.rank - a.rank || b.weight - a.weight; });
    var score = max ? got / max * 100 : 0;
    var level = score < 20 ? 0 : score < 40 ? 1 : score < 65 ? 2 : 3;
    if (critical.length && level < 2) level = 2;
    return {
      ok: answered > 0, answered: answered, total: RISK_QUESTIONS.length, complete: answered === RISK_QUESTIONS.length,
      score: score, level: level, profile: ['Düşük', 'Orta', 'Yüksek', 'Kritik'][level], critical: critical, actions: actions,
      service: actions.length ? actions[0].service : 'elektrik-periyodik-kontrol'
    };
  }

  var api = { STD_KVA: STD_KVA, nextStd: nextStd, trafoCapacity: trafoCapacity, harmonicNeed: harmonicNeed, NL_TYPES: NL_TYPES,
    RISK_QUESTIONS: RISK_QUESTIONS, factoryRisk: factoryRisk };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VGAssess = api;
}(typeof window !== 'undefined' ? window : this));
