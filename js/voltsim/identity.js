/* VoltGuard hesaplama kimlikleri (VoltSim modülleri, hesaplama/*.html sayfaları ve araclar/ güç araçları).
 * Her kayıt bir hesabın neyi, hangi yöntemle, hangi varsayımla ve hangi sınır içinde hesapladığını tanımlar.
 * Tarayıcıda window.VoltSimIdentity, Node'da require() ile yüklenir; /voltsim/hesap-kimlikleri/ sayfası ve modül sayfalarındaki
 * "Hesaplama kimliği" bölümü build sırasında bu veriden üretilir (tools/build-voltsim.cjs).
 *
 * reviewedWith: kimliğin en son gözden geçirildiği motor sürümü. Motor sürümü değişip kimlik gözden geçirilmezse
 * tools/tests/calc-identity.test.cjs başarısız olur (sessizce "güncel" görünmez).
 * requiredData: sonucu belirleyen katalog/saha verileri. Değer modülün örnek (varsayılan) değerinde kalırsa sonuç
 * "Varsayımsal" sınıflanır; key, VoltSim durum anahtarıdır (nokta ile iç içe: 'acb.Icu').
 * Sonuç durumları ayrıdır ve öncelik sırasıyla belirlenir: Veri eksik > Mühendis incelemesi gerekli > Varsayımsal > Hesaplandı.
 * Hiçbir durum "mevzuata uygundur" veya "uygulama için onaylıdır" anlamına gelmez. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoltSimIdentity = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATUS = {
    'veri-eksik': { label: 'Veri eksik', level: 'bad', desc: 'Gerekli bir girdi boş, geçersiz ya da diğer girdilerle çelişkili. Sonuç üretilmedi; işaretli alanları düzeltin.' },
    'inceleme': { label: 'Mühendis incelemesi gerekli', level: 'warn', desc: 'En az bir ön kontrol sağlanmadı ya da sonuç modelin geçerlilik sınırına yakın. Yetkili mühendis değerlendirmesi olmadan uygulamaya esas alınmamalıdır.' },
    'varsayimsal': { label: 'Varsayımsal', level: 'info', desc: 'Sonuç örnek, tipik veya senaryo değerlerine dayanıyor. Katalog ve saha verisi girildiğinde değişebilir.' },
    'hesaplandi': { label: 'Hesaplandı', level: 'ok', desc: 'Girilen değerlerle, belirtilen yöntem ve varsayımlar içinde hesaplandı. Ön hesaptır; mevzuata uygunluk veya uygulama onayı değildir.' }
  };
  const ORDER = ['veri-eksik', 'inceleme', 'varsayimsal', 'hesaplandi'];

  /** o = { errors: [], checks: [{status, label, detail}], assumed: [metin] } → { code, label, level, desc, reasons } */
  function classify(o) {
    o = o || {};
    const errors = (o.errors || []).filter(Boolean);
    const checks = o.checks || [];
    const review = checks.filter(c => c.status === 'fail' || c.status === 'warn');
    const assumed = (o.assumed || []).filter(Boolean);
    let code, reasons;
    if (errors.length) { code = 'veri-eksik'; reasons = errors.slice(); }
    else if (review.length) { code = 'inceleme'; reasons = review.map(c => c.label + (c.status === 'fail' ? ' (sağlanmıyor)' : ' (uyarı)')); }
    else if (assumed.length) { code = 'varsayimsal'; reasons = assumed.slice(); }
    else { code = 'hesaplandi'; reasons = []; }
    // bir üst durum seçildiğinde alttaki bilgiler kaybolmasın: varsayımlar her durumda ayrıca listelenir
    return Object.assign({ code: code, reasons: reasons, assumed: assumed }, STATUS[code]);
  }

  function getPath(obj, key) { return String(key).split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj); }
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  /** Örnek değerinde bırakılmış katalog/saha verileri için "Varsayımsal" gerekçeleri. */
  function assumedInputs(entry, state, defaults) {
    if (!entry || !entry.requiredData) return [];
    return entry.requiredData.filter(d => d.key && same(getPath(state, d.key), getPath(defaults, d.key)))
      .map(d => d.label + ': ' + (d.note || 'örnek değer kullanılıyor; ' + (d.kind === 'saha' ? 'saha ölçümü' : d.kind === 'kullanıcı' ? 'tesise ait değer' : 'katalog/etiket değeri') + ' girin.'));
  }

  const V = 'voltsim', H = 'hesaplama', A = 'araclar';
  const T = f => 'tools/tests/' + f;
  const REF = T('calc-reference.test.cjs'), EDGE = T('calc-edge.test.cjs');

  /* --------------------------------------------------------------- kayıtlar */
  const entries = [
    /* ===================== VoltSim ===================== */
    { id: 'voltsim-pano', family: V, module: 'pano', page: '/voltsim/pano/', name: 'AG pano: faz akımları, kablo ve koruma', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Bir AG panosundaki devrelerin faz akımlarını, kablo akım taşıma ve gerilim düşümünü, aşırı yük koşullarını ve yaklaşık kısa devre/otomatik kesme kontrolünü verir.',
      inputs: [['U_LL', 'V', 'Hat gerilimi (faz-faz)'], ['P_kW', 'kW', 'Devre gücü: motorlarda mil (çıkış) gücü, kondansatörde kVAr, şönt reaktörde kVAr'], ['cos', '—', 'Güç faktörü (temel bileşen)'], ['L', 'm', 'Kablo boyu (tek yön)'], ['S', 'mm²', 'Kablo kesiti'], ['In / Ir / Ii', 'A', 'Koruma ayarları'], ['SkQ_MVA, Sr_kVA, uk', 'MVA, kVA, %', 'Kaynak (OG şebeke + trafo)']],
      outputs: [['L1/L2/L3/N', 'A', 'Faz ve nötr akımı (fazör toplamı)'], ['P, Q, S', 'kW, kVAr, kVA', 'Pano toplam güçleri'], ['ΔU', '%', 'Gerilim düşümü (3F: hat, 1F: faz-nötr gerilimine göre)'], ['Ik3, Ik1min', 'kA', 'Yaklaşık kısa devre akımları']],
      method: ['3F: I = P/(√3·U_LL·cosφ); 1F: I = P/(U_LL/√3·cosφ)', 'Motor: P_el = P_mil/η', 'Faz akımı = Σ fazör (dengesiz 1F yükler doğru toplanır)', 'ΔU_3F = √3·I·(R·cosφ + X·sinφ); ΔU_1F = 2·I·(R·cosφ + X·sinφ)', 'Ib ≤ In ≤ Iz, I2 ≤ 1,45·Iz', 'Ik3 = c·U/(√3·|Z|), c = 1,05'],
      assumptions: ['Sinüzoidal akım; harmonik akımlar faz/nötr akımına eklenmez.', 'Iz: bakır PVC, 30 °C ortam, düzeltme katsayısı uygulanmaz (TS HD 60364-5-52 tabloları).', 'Kablo reaktansı X′ = 0,08 Ω/km (tipik).', 'Kısa devre IEC 60909 yaklaşımı; motor katkısı yok.', 'Kondansatör kayıpları ≈ 3 W/kVAr (ayarlı kademede 6 W/kVAr); şönt reaktör kaybı ≈ %1 (tipik).'],
      validity: ['AG (U_LL ≤ 1000 V) dağıtım panoları.', 'Harmonik ağırlıklı yüklerde nötr akımı olduğundan düşük görünebilir.', 'Açma süreleri için üretici eğrisi esastır; burada yalnız standart kapı değerleri kullanılır.'],
      requiredData: [{ key: 'SkQ_MVA', label: 'OG şebeke kısa devre gücü', kind: 'saha', note: 'örnek değer; dağıtım şirketinden alınan değeri girin.' }],
      sources: ['TS HD 60364-4-41, -4-43, -5-52', 'IEC 60909-0', 'TS EN 60898-1, TS EN 60947-2, IEC 60269-1/-2'],
      impl: ['js/voltsim/engine.js · pano.compute', 'js/voltsim/calc/pano.js'], tests: [T('voltsim-engine.test.cjs'), T('voltsim-pano.test.cjs'), REF, EDGE] },

    { id: 'voltsim-ges', family: V, module: 'ges', page: '/voltsim/ges/', name: 'Çatı GES: üretim, string ve sıcaklık', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Çatı GES’in anlık/günlük/yıllık üretim senaryosunu, string gerilimlerinin sıcaklık kontrollerini, inverter kırpmasını ve öz tüketimini verir.',
      inputs: [['nMod × Pmod', 'adet × Wp', 'DC kurulu güç (kWp)'], ['Pac', 'kW (AC)', 'İnverter AC anma gücü'], ['Voc, Vmp, Isc', 'V, V, A', 'Modül STC değerleri (katalog)'], ['βVoc, βVmp, γPmax', '%/°C', 'Sıcaklık katsayıları (katalog, negatif)'], ['Tmin, Tmax', '°C', 'Sahanın en düşük/en yüksek ortam sıcaklığı'], ['dcLoss', '%', 'İnverter hariç sistem kayıpları (değiştirilebilir varsayım)'], ['invEff', '%', 'İnverter verimi'], ['pvgisMonthly', 'kWh/kWp·ay', 'İsteğe bağlı ölçüm tabanlı aylık özgül üretim']],
      outputs: [['kWp', 'kWp', 'DC kurulu güç'], ['dcac', '—', 'DC/AC oranı'], ['annual', 'kWh/yıl (AC)', 'Yıllık AC üretim senaryosu'], ['specYield', 'kWh/kWp', 'Özgül üretim'], ['vocCold', 'V', 'Tmin’de string Voc'], ['vmpHot', 'V', 'Sıcak hücrede string Vmp']],
      method: ['G_POA = DNI·cosθ + DHI·(1 + cosβ)/2 + GHI·ρ·(1 − cosβ)/2', 'Tc = Ta + (NOCT − 20)/800·G', 'P_DC = n·P_STC·G/1000·[1 + γ·(Tc − 25)]·(1 − kayıp)', 'P_AC = min(P_DC·η_inv, P_AC,nom)', 'Voc,soğuk = Ns·Voc·[1 + βVoc·(Tmin − 25)]', 'Vmp,sıcak = Ns·Vmp·[1 + βVmp·(Tmax + (NOCT − 20)·1000/800 − 25)]'],
      assumptions: ['Işınım: Meinel açık gök × Kasten–Czeplak bulut senaryosu (ölçüm verisi değildir). PVGIS aylık değerleri girilirse yıllık üretim onlardan alınır.', 'Sistem kaybı varsayılanı %14’tür ve değiştirilebilir. Bu değer PVGIS’in genel varsayılanıdır (PVGIS’te inverter kaybı dahildir); burada inverter verimi ayrıca uygulandığından aynı %14 değeri kaybı yaklaşık 1–2 puan fazla sayar. Tesise özgü kayıp dökümü (kablo, uyumsuzluk, kirlilik, LID/LeTID, kullanılabilirlik) ile değiştirilmelidir.', 'Voc kontrolünde hücre sıcaklığı = en düşük ortam sıcaklığı (şafak, ışınımsız) kabul edilir.', 'Gölge doğrusal kayıp; bypass diyot ve uyumsuzluk etkileri dahil değil.'],
      validity: ['Türkiye enlemleri (35–43°), sabit eğimli sistemler.', 'Sonuç üretim tahmini değil senaryodur; yatırım kararı için sahaya özgü PVGIS/ölçüm verisi ve kayıp dökümü gerekir.', 'Lisanssız üretim sınırları güncel mevzuattan ayrıca doğrulanmalıdır.'],
      requiredData: [
        { key: 'pvgisMonthly', label: 'Işınım verisi', kind: 'saha', note: 'ölçüm tabanlı aylık veri girilmedi; açık gök × bulut senaryosu kullanılıyor.' },
        { key: 'dcLoss', label: 'Sistem kayıpları (%14)', kind: 'kullanıcı', note: 'PVGIS genel varsayılanı; tesise özgü kayıp dökümüyle değiştirin.' },
        { key: 'Tmin', label: 'En düşük ortam sıcaklığı', kind: 'saha', note: 'örnek değer; sahanın meteoroloji kaydını girin.' },
        { key: 'Tmax', label: 'En yüksek ortam sıcaklığı', kind: 'saha', note: 'örnek değer; sahanın meteoroloji kaydını girin.' }],
      sources: ['IEC 62548-1 (FV dizileri)', 'PVGIS (JRC) yöntem notları — %14 varsayılan sistem kaybı', 'Duffie & Beckman, Solar Engineering of Thermal Processes (güneş geometrisi, Liu–Jordan)', 'Lisanssız Elektrik Üretim Yönetmeliği'],
      impl: ['js/voltsim/engine.js · ges.compute', 'js/voltsim/calc/ges.js'], tests: [T('voltsim-engine.test.cjs'), T('voltsim-ges.test.cjs'), REF, EDGE] },

    { id: 'voltsim-trafo', family: V, module: 'trafo', page: '/voltsim/trafo/', name: 'Trafo: yüklenme, kayıp, verim, sıcaklık, yaklaşık kısa devre', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Dağıtım trafosunun yük altındaki akımlarını, yüklenme oranını, kayıplarını, verimini, gerilim değişimini, sıcak nokta sıcaklığını ve AG baradaki yaklaşık simetrik kısa devre akımını verir.',
      inputs: [['Sr_kVA', 'kVA', 'Anma gücü'], ['U1_kV, U2_V', 'kV, V', 'Hat gerilimleri'], ['P0, Pk', 'W', 'Boşta ve yük kaybı (katalog/etiket)'], ['uk', '%', 'Kısa devre gerilimi'], ['P_kW, cos', 'kW, —', 'Yükün aktif gücü ve güç faktörü'], ['SkQ_MVA', 'MVA', 'OG şebeke kısa devre gücü (0 = sonsuz)']],
      outputs: [['I1n, I2n', 'A', 'Anma akımları = Sr/(√3·U)'], ['k', '—', 'Yüklenme = S/Sr (S = P/cosφ)'], ['losses', 'W', 'P0 + Pk·k²'], ['eff', '%', 'Verim'], ['IkT', 'A', 'Yalnız trafo: In/uk (c = 1)'], ['Ik', 'A', 'Trafo + OG şebeke, c = 1,05']],
      method: ['I = S/(√3·U_LL)', 'K = S/Sr = P/(cosφ·Sr)', 'P_kayıp = P0 + Pk·K²', 'η = P/(P + P_kayıp)', 'Ik ≈ In/uk (sonsuz şebeke)', 'Ik3 = 1,05·U/(√3·|ZQ + ZT|)', 'IEC 60076-7 kararlı hal ısıl model, V = 2^((θh − 98)/6)'],
      assumptions: ['Dengeli üç faz, sinüzoidal yük; harmonik kayıp artışı (K faktörü) dahil değil.', 'P0/Pk/uk önayarları örnek katalog değerleridir; etiket değeri girilmelidir.', 'Kısa devre yaklaşık: kablo, motor katkısı ve KT düzeltmesi yok; IEC 60909’a tam uygun hesap değildir.', 'Isıl model ONAN dağıtım trafosu varsayılanları; üretici ısıl verisi yoksa göstergedir.'],
      validity: ['Yağlı/kuru dağıtım trafoları, 25 kVA–40 MVA.', 'Kısa devre sonucu koruma cihazı Icu seçimine doğrudan esas alınmamalı; tam IEC 60909 hesabı gerekir.'],
      requiredData: [{ key: 'P0', label: 'Boşta kayıp P0', kind: 'katalog' }, { key: 'Pk', label: 'Yük kaybı Pk', kind: 'katalog' }, { key: 'uk', label: 'Kısa devre gerilimi uk', kind: 'katalog' }, { key: 'SkQ_MVA', label: 'OG şebeke kısa devre gücü', kind: 'saha', note: 'örnek değer; dağıtım şirketinden alınan değeri girin.' }],
      sources: ['IEC 60076-1 (anma değerleri, gerilim değişimi)', 'IEC 60076-7 (yükleme kılavuzu)', 'IEC 60909-0'],
      impl: ['js/voltsim/engine.js · trafo.compute', 'js/voltsim/calc/trafo.js'], tests: [T('voltsim-engine.test.cjs'), T('voltsim-trafo.test.cjs'), REF, EDGE] },

    { id: 'voltsim-sarj', family: V, module: 'sarj', page: '/voltsim/sarj-istasyonu/', name: 'EV şarj: güç sınırı, süre ve enerji', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'AC/DC şarj noktalarında gücü sınırlayan unsuru (istasyon, araç OBC/DC kabulü, tesis gücü), şarj süresini, bataryaya giren ve şebekeden çekilen enerjiyi verir.',
      inputs: [['capacity', 'kWh', 'Kullanılabilir batarya kapasitesi'], ['soc0, soc1', '%', 'Başlangıç/hedef SOC'], ['profil', '—', 'AC 1F/3F akım veya DC istasyon gücü (kW, DC çıkış)'], ['obcPhases, obcI', '—, A', 'Araç dahili şarj cihazı sınırı'], ['dcMax', 'kW', 'Araç maks. DC kabul gücü'], ['effAC, effDC', '%', 'Şebeke → batarya verimi'], ['siteKW', 'kW', 'Tesisin şarja ayırabildiği güç']],
      outputs: [['ideal', 'kWh', 'Bataryaya giren ideal enerji = C·ΔSOC (kayıpsız)'], ['Ebatt', 'kWh', 'Simülasyonda bataryaya giren enerji'], ['Egrid', 'kWh', 'Şebekeden çekilen enerji (kayıplar dahil)'], ['minutes', 'dk', 'Şarj süresi']],
      method: ['E_ideal = C·(SOC_hedef − SOC_baş)', 'P_AC = n_faz·230 V·I (n_faz = min(istasyon, OBC), I = min(istasyon, OBC))', 'P_DC = min(istasyon, araç·eğri(SOC))', 'E_şebeke = ∫P_şebeke·dt, E_batarya = η·E_şebeke', 'Yük paylaşımı: eşit (su doldurma)'],
      assumptions: ['230 V faz-nötr gerilimi; 3 faz 32 A = 3·230·32 ≈ 22,1 kW (= √3·400·32).', 'DC eğrisi tipiktir (SOC %50’ye kadar tam, %80’de yarı, %100’de ≈ %15 güç); araç modeline göre değişir.', 'Kayıplar verim çarpanıyla ayrıca eklenir; ideal enerji kayıpsızdır.', 'Batarya ön ısıtma/soğutma tüketimi, sıcaklık ve yaşlanma etkisi dahil değil.'],
      validity: ['Mod 3 AC ve Mod 4 DC şarj; istasyon DC gerilim/akım sınırları ayrıca modellenmez.', 'Süre senaryodur; gerçek süre araç BMS eğrisine bağlıdır.'],
      requiredData: [],
      sources: ['IEC 61851-1, -23', 'TS HD 60364-7-722', 'Şarj Hizmeti Yönetmeliği (EPDK)'],
      impl: ['js/voltsim/engine.js · sarj.compute', 'js/voltsim/calc/sarj.js'], tests: [T('voltsim-engine.test.cjs'), T('voltsim-sarj.test.cjs'), REF, EDGE] },

    { id: 'voltsim-komp', family: V, module: 'komp', page: '/voltsim/kompanzasyon/', name: 'Kompanzasyon, şönt reaktör ve harmonik rezonans', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Hedef güç faktörü için gereken kondansatör gücünü, kademe seçimini, şönt reaktörün etkisini, reaktif/aktif enerji oranını ve kondansatörlü baranın harmonik rezonans davranışını ayrı ayrı verir.',
      inputs: [['P_kW', 'kW', 'Aktif güç'], ['cos1, cos2', '—', 'Mevcut ve hedef cosφ (temel bileşen)'], ['steps', 'kVAr', 'Kademe güçleri (bara geriliminde etkin)'], ['shunt_kvar', 'kVAr', 'Şönt reaktör (endüktif, kapasitif kaymayı dengeler)'], ['detune p', '%', 'Ayarlı (detuned) kademe seri reaktör oranı'], ['harmonics', '% I1', 'Yük harmonik akım spektrumu'], ['Sr_kVA, uk', 'kVA, %', 'Kaynak trafo']],
      outputs: [['Qneed', 'kVAr', 'P·(tanφ1 − tanφ2)'], ['Qnet', 'kVAr', 'Kompanzasyon sonrası net reaktif güç'], ['cosNew', '—', 'Yeni güç faktörü'], ['hPar / hRes', '—', 'Paralel rezonans / ayar mertebesi'], ['THDv', '%', 'AG bara gerilim THD (hesaplanan)']],
      method: ['Qc = P·(tanφ1 − tanφ2)', 'Q_net = Q_L − Q_C − Q_kapasitif yük + Q_şönt', 'h_r = √(Xc/Xs) (reaktörsüz), f_r = 50/√p (ayarlı)', 'Z_bara(h) = Zs(h)·Zc(h)/(Zs(h) + Zc(h))', 'THD = √(Σ X_h²)/X_1', 'Endüktif oran = Q/P·100 (sabit yükte aylık kVArh/kWh)'],
      assumptions: ['Kondansatör (kapasitif kVAr üretir), şönt reaktör (endüktif kVAr tüketir, harmonik süzmez) ve ayarlı kademe/harmonik filtre (seri reaktörlü kol; rezonansı 5. harmoniğin altına çeker) ayrı modellenir; aktif filtre ayrı bir cihazdır.', 'Kaynak: trafo reaktansı, R = X/8, OG şebeke sonsuz; arka plan gerilim harmoniği yok.', 'Harmonik spektrum önayarı örnektir; gerçek değerlendirme TS EN 61000-4-30 sınıf A ölçüm gerektirir.'],
      validity: ['AG kompanzasyon panosu, tek bara.', 'Hedef cosφ mevcut değerden düşükse kondansatör gerekmez (uyarı verilir).', 'EPDK oran sınırları anlık güçten hesaplanır; fatura aylık enerjiye göredir.'],
      requiredData: [{ key: 'harmonics', label: 'Harmonik spektrum', kind: 'saha', note: 'örnek VFD spektrumu kullanılıyor; tesis ölçümü girin.' }, { key: 'uk', label: 'Trafo uk', kind: 'katalog' }],
      sources: ['EPDK Kurul Kararı (reaktif enerji sınırları, Madde 13)', 'IEC 60831-1 (AG şönt kondansatörler)', 'TS EN 50160', 'IEC 61000-2-2'],
      impl: ['js/voltsim/engine.js · komp.compute', 'js/voltsim/calc/komp.js'], tests: [T('voltsim-engine.test.cjs'), T('voltsim-komp.test.cjs'), REF, EDGE] },

    { id: 'voltsim-topraklama', family: V, module: 'topraklama', page: '/voltsim/topraklama/', name: 'Topraklama direnci ve dokunma/adım gerilimi', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Çubuk, şerit ve ağ topraklayıcının yayılma direncini, TT/IT koruma koşulunu ve OG arıza akımında GPR ile IEEE 80 dokunma/adım gerilimi ön kontrolünü verir.',
      inputs: [['rho', 'Ω·m', 'Toprak özdirenci (Wenner ölçümü)'], ['L, d, n, s', 'm, m, adet, m', 'Çubuk boyu, çapı, sayısı, aralığı'], ['IdN_mA', 'mA', 'RCD anma kaçak akımı'], ['UL', 'V', 'Sınır dokunma gerilimi'], ['IF, tf', 'A, s', 'OG topraklama arıza akımı ve süresi'], ['rhoS, hs', 'Ω·m, m', 'Yüzey tabakası']],
      outputs: [['R', 'Ω', 'Yayılma direnci'], ['GPR', 'V', 'IF·R'], ['Etouch/Estep', 'V', 'İzin verilen dokunma/adım (IEEE 80, 50 kg)'], ['Em/Es', 'V', 'Ağ için hesaplanan dokunma/adım']],
      method: ['R_çubuk = ρ/(2πL)·[ln(8L/d) − 1] (Dwight)', 'n çubuk: R1·(1 + λ·a)/n (BS 7430)', 'R_ağ = ρ·[1/L_T + 1/√(20A)·(1 + 1/(1 + h√(20/A)))] (Sverak)', 'TT: R_A·IΔn ≤ U_L', 'E_dokunma = (1000 + 1,5·Cs·ρs)·0,116/√t'],
      assumptions: ['Homojen toprak; mevsimsel değişim seçilen katsayı dışında modellenmez.', 'Ağ hesabında iletken çapı 0,01 m, kare ağ, kenar çubuksuz kabul edilir.', 'TN sisteminde elektrot direnci tek başına kabul ölçütü değildir (çevrim empedansı esastır).'],
      validity: ['Elektrot tasarımı ön boyutlandırması; kabul ölçülen direnç ve sistem tipine göre yapılır.', 'Türk Topraklamalar Yönetmeliği’ndeki izin verilen dokunma gerilimi eğrisiyle ayrıca karşılaştırılmalıdır.'],
      requiredData: [{ key: 'rho', label: 'Toprak özdirenci', kind: 'saha', note: 'örnek değer; Wenner yöntemiyle ölçülen değeri girin.' }, { key: 'IF', label: 'OG topraklama arıza akımı', kind: 'saha', note: 'örnek değer; dağıtım şirketinden alınan değeri girin.' }],
      sources: ['Elektrik Tesislerinde Topraklamalar Yönetmeliği', 'TS HD 60364-4-41', 'IEEE 80', 'BS 7430'],
      impl: ['js/voltsim/engine.js · topraklama.compute', 'js/voltsim/calc/topraklama.js'], tests: [T('voltsim-engine.test.cjs'), T('voltsim-topraklama.test.cjs'), REF, EDGE] },

    { id: 'voltsim-res', family: V, module: 'res', page: '/voltsim/res/', name: 'RES: türbin gücü, yıllık üretim, iz kaybı', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Rüzgâr türbini güç eğrisinden anlık gücü, Weibull dağılımıyla yıllık enerji senaryosunu, iz (wake) kaybını ve iç şebeke kablo/trafo kayıplarını verir.',
      inputs: [['v10, href, α', 'm/s, m, —', 'Referans hız, ölçüm yüksekliği, kayma üssü'], ['T, alt', '°C, m', 'Hava yoğunluğu için sıcaklık ve rakım'], ['türbin', 'kW, m', 'Anma gücü, rotor çapı, Cp eğrisi (katalog)']],
      outputs: [['P', 'kW', 'Anlık elektrik gücü'], ['AEP', 'MWh/yıl', 'Yıllık enerji senaryosu'], ['wake', '%', 'İz kaybı']],
      method: ['P = ½·ρ·A·Cp·v³·η (Betz: Cp ≤ 16/27)', 'v_hub = v_ref·(h/h_ref)^α', 'ρ = p/(287,05·T)', 'AEP = 8760·Σ P(v)·f(v)·Δv (Weibull)', 'Jensen/Katić iz modeli'],
      assumptions: ['Weibull dağılımı ve yön dağılımı varsayımsaldır; ölçüm direği/LiDAR verisi değildir.', 'İç şebeke kablosunda κAl = 35 m/(Ω·mm²) (20 °C); işletme sıcaklığında kayıplar ≈ %20 daha yüksek olabilir.', 'Trafo merkezi dizinin ilk türbin ucunda kabul edilir.'],
      validity: ['Ön fizibilite senaryosu; enerji verimi raporu (IEC 61400-12-1 ölçümüne dayalı) yerine geçmez.'],
      requiredData: [{ key: 'v10', label: 'Rüzgâr hızı', kind: 'saha', note: 'örnek değer; saha ölçümünü girin.' }, { key: 'alpha', label: 'Kayma üssü α', kind: 'saha' }],
      sources: ['IEC 61400-1, IEC 61400-12-1', 'Betz limiti', 'Jensen (1983) / Katić (1986) iz modeli'],
      impl: ['js/voltsim/engine.js · res.compute', 'js/voltsim/calc/res.js'], tests: [T('voltsim-res.test.cjs'), EDGE] },

    { id: 'voltsim-ups', family: V, module: 'ups', page: '/voltsim/ups-jenerator/', name: 'UPS, akü süresi ve jeneratör yüklenmesi', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Kritik yükte UPS yüklenmesini, akü yedekleme süresini, jeneratörün kVA ve kW yüklenmesini, yakıt süresini ve ATS geçiş zinciri zamanlamasını verir.',
      inputs: [['Pcrit, pfCrit', 'kW, —', 'Kritik yük'], ['upsKVA, upsPF', 'kVA, —', 'UPS anma gücü (kW = kVA·PF)'], ['nBlocks·Vblock, Ah, DoD', 'V, Ah, %', 'Akü grubu (katalog)'], ['genKVA', 'kVA (cosφ 0,8)', 'Jeneratör anma gücü'], ['fuel', 'l/kWh', 'Özgül yakıt tüketimi']],
      outputs: [['upsLoad', '%', 'max(S/S_UPS, P/P_UPS)'], ['runtime', 'dk', 'Akü yedekleme süresi'], ['genPct', '%', 'max(kVA/kVA_n, kW/(0,8·kVA_n))']],
      method: ['t = V·Ah·DoD·k_θ·k_yaş / (P/η_inv)', 'Jeneratör kW sınırı = 0,8·kVA (ISO 8528-1)', 'Yakıt süresi = depo / (özgül tüketim·P)'],
      assumptions: ['Sabit güç deşarjı, doğrusal kapasite; Peukert etkisi yok.', 'Doğrultucu güç faktörü 0,95 kabul edilir; akü şarj gücü dahil değildir.', 'Adım yük kabul sınırları (G1/G2/G3) temsilîdir; üretici verisi esastır.'],
      validity: ['Akü süresi göstergedir; üretici sabit güç tablosu (W/hücre) ile doğrulanmalıdır.'],
      requiredData: [{ key: 'Ah', label: 'Akü kapasitesi', kind: 'katalog' }, { key: 'fuel', label: 'Özgül yakıt tüketimi', kind: 'katalog' }],
      sources: ['IEC 62040-3', 'ISO 8528-1/-5', 'IEEE 485'],
      impl: ['js/voltsim/engine.js · ups.compute', 'js/voltsim/calc/ups.js'], tests: [T('voltsim-ups.test.cjs'), REF, EDGE] },

    { id: 'voltsim-kalite', family: V, module: 'kalite', page: '/voltsim/enerji-kalitesi/', name: 'Enerji kalitesi: harmonik, çökme, dengesizlik', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'AG baradaki gerilim harmoniklerini (kondansatör/ayarlı filtre koluyla), OG arızası ve motor kalkışı kaynaklı gerilim çökmesini ve faz gerilimi dengesizliğini verir.',
      inputs: [['Sr_kVA, uk, SkQ_MVA', 'kVA, %, MVA', 'Kaynak'], ['harm', '% I1', 'Yük harmonik spektrumu'], ['Uab, Ubc, Uca', 'V', 'Hat gerilimleri (dengesizlik)'], ['kStart', '×In', 'Motor kalkış akımı']],
      outputs: [['THDv', '%', 'Gerilim THD'], ['VUF', '%', 'Negatif/pozitif bileşen oranı (IEC)'], ['LVUR', '%', 'NEMA hat gerilimi dengesizliği'], ['u', '%', 'Çökme derinliği']],
      method: ['Z_bara(h) = Zs(h) ∥ Z_kol(h)', 'THD = √(Σ U_h²)/U_1', 'VUF = √((1 − √(3 − 6β))/(1 + √(3 − 6β)))·100', 'LVUR = max sapma/ortalama·100', 'Gerilim bölücü: u = Zf/(Zs + Zf)'],
      assumptions: ['X/R = 8, arka plan gerilim harmoniği yok, doğrusal süperpozisyon.', 'Üçlü harmoniklerde Z0 = ZT; nötr iletkeni modellenmez.', 'THDi anlık temel bileşene göredir (TDD/IEEE 519 değildir).', 'Motor kalkış düşümünde η = 0,94, cosφ = 0,86 sabit.'],
      validity: ['TS EN 50160 karşılaştırması istatistiksel sınıra göredir; uygunluk kararı TS EN 61000-4-30 sınıf A ölçümle verilir.'],
      requiredData: [{ key: 'harm', label: 'Harmonik spektrum', kind: 'saha', note: 'örnek spektrum; tesis ölçümü girin.' }, { key: 'SkQ_MVA', label: 'OG şebeke kısa devre gücü', kind: 'saha' }],
      sources: ['TS EN 50160', 'IEC 61000-2-2, IEC 61000-4-30', 'IEC 60831-1', 'SEMI F47', 'NEMA MG 1'],
      impl: ['js/voltsim/calc/kalite.js'], tests: [T('voltsim-kalite.test.cjs'), EDGE] },

    { id: 'voltsim-selektivite', family: V, module: 'selektivite', page: '/voltsim/selektivite/', name: 'Koruma seçiciliği ve kesme süresi', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'ACB/MCCB/MCB/gG cihazlarının akım–zaman bantlarını, kısa devre akımlarında hangi cihazın açtığını, akım seçiciliğini ve TN otomatik kesme süresini değerlendirir.',
      inputs: [['devices', 'A, s', 'Cihaz tipi ve ayarları (Ir, tr, Isd, tsd, Ii)'], ['L, S', 'm, mm²', 'Kablo'], ['Sr_kVA, uk, Pk_W, SkQ_MVA', '—', 'Kaynak']],
      outputs: [['Ik3, Ik1min', 'kA', 'Her bara/devre sonu'], ['ilk açan', '—', 'Bant karşılaştırması'], ['tReq', 's', 'Gerekli kesme süresi']],
      method: ['IEC 60909: c = 1,05 / 0,95', 'Bant ayrımıyla akım seçiciliği', 'TS HD 60364-4-41: son devre ≤ 63 A priz / ≤ 32 A sabit yük 0,4 s, diğerleri 5 s (TN, 230 V)'],
      assumptions: ['Ik1,min için iletken direnci 1,24·R20 alınır (IEC 60909’un arıza sonu sıcaklığına göre iyimser olabilir).', 'Zaman (Icw) ve enerji seçiciliği modellenmez; üretici seçicilik tablosu esastır.', 'TT sistemi (0,2 s) kapsanmaz.'],
      validity: ['AG radyal dağıtım; üretici eğrisi olmadan kesin açma süresi verilmez.'],
      requiredData: [{ key: 'SkQ_MVA', label: 'OG şebeke kısa devre gücü', kind: 'saha' }],
      sources: ['IEC 60909-0', 'IEC 60898-1, IEC 60947-2 Ek A, IEC 60269-2', 'TS HD 60364-4-41'],
      impl: ['js/voltsim/calc/selektivite.js'], tests: [T('voltsim-selektivite.test.cjs'), REF, EDGE] },

    { id: 'voltsim-yildirim', family: V, module: 'yildirim', page: '/voltsim/yildirim/', name: 'Dış yıldırımdan korunma (LPS)', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Yuvarlanan küre ve koruma açısı yöntemleriyle çatı maruziyetini, iniş iletkeni sayısını, ayırma mesafesini ve yıllık tehlikeli olay sayısını verir.',
      inputs: [['lpl', '—', 'Koruma seviyesi (I–IV)'], ['L, W, H', 'm', 'Yapı boyutları'], ['rodH, rodD', 'm', 'Çubuk yüksekliği/aralığı'], ['NG', '1/km²·yıl', 'Yıldırım yoğunluğu']],
      outputs: [['açık alan', '%', 'Korumasız çatı payı'], ['s', 'm', 'Ayırma mesafesi'], ['ND', '1/yıl', 'Tehlikeli olay sayısı']],
      method: ['Küre yarıçapı r (IEC 62305-3 Tablo 2)', 's = ki·(kc/km)·l', 'AD = L·W + 2·3H·(L + W) + π·(3H)²', 'ND = NG·AD·Cd·10⁻⁶'],
      assumptions: ['Düz çatı, basitleştirilmiş kc.', 'Gerekli LPL, IEC 62305-2 risk analiziyle belirlenir; burada kullanıcı seçer.'],
      validity: ['Ön tasarım; iç koruma ve SPD seçimi (IEC 62305-4) kapsam dışıdır.'],
      requiredData: [{ key: 'NG', label: 'Yıldırım yoğunluğu NG', kind: 'saha', note: 'örnek değer; bölgesel yıldırım haritasından alın.' }],
      sources: ['IEC 62305-1/-2/-3'],
      impl: ['js/voltsim/calc/yildirim.js'], tests: [T('voltsim-yildirim.test.cjs'), EDGE] },

    { id: 'voltsim-depolama', family: V, module: 'depolama', page: '/voltsim/depolama-hibrit/', name: 'Batarya depolama ve hibrit sistem enerji dengesi', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'GES/RES/dizel ve bataryalı tesisin saatlik enerji dengesini, öz tüketimi, tepe tıraşlamayı, kesintide beslemeyi ve basit ekonomiyi verir.',
      inputs: [['batKWh, batKW', 'kWh, kW', 'Batarya enerji ve güç anması'], ['dod, rte', '%', 'Deşarj derinliği, çevrim (gidiş-dönüş) verimi'], ['pvKWp, pvAC', 'kWp, kW', 'GES DC/AC gücü'], ['load', 'kW (saatlik)', 'Yük profili']],
      outputs: [['self', '%', 'Öz tüketim'], ['peakImp', 'kW', 'Şebeke tepe çekişi'], ['uns', 'kWh', 'Beslenemeyen enerji']],
      method: ['E_çıkış = E_giriş·RTE (√RTE şarjda, √RTE deşarjda; bir kez)', 'SOC ∈ [1 − DoD, 1]', 'P_bat ≤ min(PCS, C-oranı·E)', 'Dizel: F = 0,08145·P_n + 0,246·P (l/h)'],
      assumptions: ['1 saatlik adım; 15 dk talep tepeleri daha yüksek olabilir.', 'GES üretimi motorun temsilî gününden (varsayılan %14 sistem kaybı — PVGIS genel varsayılanı, tesise özgü değil).', 'Kapasite kaybı ve yardımcı tüketim (HVAC) günlük hesaba katılmaz.'],
      validity: ['Senaryo analizi; yatırım kararı için ölçülmüş 15 dk yük profili ve sahaya özgü üretim gerekir.'],
      requiredData: [{ key: 'loadCustom', label: 'Yük profili', kind: 'saha', note: 'örnek profil; sayaç/ölçüm verisi girin.' }],
      sources: ['IEC 62619', 'IEC 62933-5-2', 'Lisanssız Elektrik Üretim Yönetmeliği'],
      impl: ['js/voltsim/calc/depolama.js'], tests: [T('voltsim-depolama.test.cjs'), EDGE] },

    { id: 'voltsim-motor', family: V, module: 'motor', page: '/voltsim/motor-otomasyon/', name: 'Asenkron motor yol alma ve koruma', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Asenkron motorun anma akımını, yol verme yöntemine göre kalkış akımı/süresini, termik röle ayarını ve gerilim sapmasının moment/akım etkisini verir.',
      inputs: [['Pn', 'kW (mil, çıkış)', 'Etiket gücü — mekanik çıkış'], ['Un', 'V (hat)', 'Anma gerilimi'], ['eff, cos', '—', 'Etiket verimi ve güç faktörü'], ['IstIn, TkTn, TstTn', '—', 'Katalog oranları'], ['uPct', '% Un', 'Şebeke gerilimi'], ['J, loadPct', 'kg·m², %', 'Atalet ve yük momenti']],
      outputs: [['In', 'A', 'Pn/(√3·Un·η·cosφ)'], ['P_el', 'kW', 'Şebekeden çekilen = Pn/η'], ['tStart', 's', 'Yol alma süresi'], ['Imax', 'A', 'Tepe akım']],
      method: ['In = Pn/(√3·Un·η·cosφ) (Pn mil gücü)', 'Tn = 9550·Pn/nn', 'T(s) = 2Tk/(s/sk + sk/s) (Kloss)', 'J·dω/dt = Tm − TL', 'Gerilim etkisi: T ∝ u², Ist ∝ u (kırpılmaz; Tk·u² < 1 → devrilme)'],
      assumptions: ['Basitleştirilmiş eşdeğer devre; sürtünme yok.', 'Termik röle süresi sınıf sınırlarından temsilîdir.', 'Kısma/VFD enerji karşılaştırmasında tipik santrifüj eğri (0,45 + 0,55·q).'],
      validity: ['Eğitim ve ön değerlendirme; gerçek yol alma için yük momenti eğrisi ve üretici motor verisi gerekir.'],
      requiredData: [{ key: 'IstIn', label: 'Kalkış akımı oranı', kind: 'katalog' }, { key: 'TkTn', label: 'Devrilme momenti oranı', kind: 'katalog' }, { key: 'J', label: 'Toplam atalet', kind: 'kullanıcı' }],
      sources: ['IEC 60034-1', 'TS EN IEC 60947-4-1', 'ISO 13849-1 (güvenlik fonksiyonu bilgisi)'],
      impl: ['js/voltsim/engine.js · motor.compute', 'js/voltsim/calc/motor.js'], tests: [T('voltsim-motor.test.cjs'), REF, EDGE] },

    { id: 'voltsim-pompa', family: V, module: 'pompa', page: '/voltsim/pompa-vfd/', name: 'Pompa: kısma ve VFD enerji karşılaştırması', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Pompa ve sistem eğrisinden çalışma noktasını, kısma ile VFD hız kontrolünün elektrik gücünü ve yıllık enerji tasarrufunu verir.',
      inputs: [['H0, Qr, Hr, Qbep, ηmax', 'm, m³/h, m, m³/h, —', 'Pompa eğrisi (katalog)'], ['Hst, Qd, Hd', 'm, m³/h, m', 'Sistem eğrisi'], ['etaM, etaVfd', '—', 'Motor ve sürücü verimi'], ['profile', '%, sa', 'Yıllık debi profili']],
      outputs: [['P_kısma, P_VFD', 'kW (elektrik)', 'Şebekeden çekilen güç'], ['saving', 'kWh/yıl', 'Yıllık tasarruf (sağlanabilen satırlar)']],
      method: ['P_hid = ρ·g·Q·H', 'P_el = P_hid/(η_pompa·η_motor·η_VFD)', 'Afinite: Q ∝ n, H ∝ n², P ∝ n³'],
      assumptions: ['Motor/VFD verimi sabit; pompa verimi BEP etrafında parabolik.', 'Tam hızda sağlanamayan profil satırları enerjiye katılmaz ve uyarı verilir.'],
      validity: ['Santrifüj pompa, tek pompa; paralel pompa ve kavitasyon (NPSH) kapsam dışı.'],
      requiredData: [{ key: 'Hst', label: 'Statik basma yüksekliği', kind: 'saha' }, { key: 'profile', label: 'Yıllık debi profili', kind: 'saha', note: 'örnek profil; işletme kaydı girin.' }],
      sources: ['Afinite yasaları', 'IEC 60034-30-1 (motor verim sınıfları, bilgi)'],
      impl: ['js/voltsim/calc/pompa.js'], tests: [T('voltsim-pompa.test.cjs'), EDGE] },

    { id: 'voltsim-konveyor', family: V, module: 'konveyor', page: '/voltsim/konveyor-scada/', name: 'Konveyör PLC/SCADA mantığı', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Sıralı kalkış/duruş, kilitleme, sıkışma algılama ve alarm yaşam döngüsünü (PLC tarama benzetimi) gösterir; mühendislik boyutlandırması yapmaz.',
      inputs: [['zamanlayıcılar', 's', 'TON/TOF ayarları'], ['bant hızı', 'm/s', 'Ürün akışı']], outputs: [['durum', '—', 'Hat ve alarm durumları'], ['I', 'A', 'Yükle doğrusal temsilî motor akımı']],
      method: ['PLC tarama döngüsü (IEC 61131-3 mantığı)', 'Alarm durumları IEC 62682'],
      assumptions: ['Motor verisi (η 0,84/0,86, cosφ 0,8) temsilîdir; akım yükle doğrusal kabul edilir.', 'Acil durdurma eğitim amaçlıdır; emniyet fonksiyonu ISO 13849-1 ile doğrulanmalıdır.'],
      validity: ['Eğitim benzetimi; sayısal sonuçlar tasarım değeri değildir.'], requiredData: [],
      sources: ['IEC 61131-3', 'IEC 62682', 'IEC 60204-1', 'ISO 13850'],
      impl: ['js/voltsim/calc/konveyor.js'], tests: [T('voltsim-konveyor.test.cjs')] },

    { id: 'voltsim-ariza', family: V, module: 'ariza', page: '/voltsim/ariza-tespit/', name: 'Arıza tespit laboratuvarı', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Senaryo arızalarında ölçü aleti okumalarını (gerilim, süreklilik, yalıtım, döngü empedansı) düğüm analiziyle üretir ve güvenli çalışma kurallarını puanlar.',
      inputs: [['senaryo', '—', 'Arıza tipi, tohum'], ['ölçüm', '—', 'Alet ve uçlar']], outputs: [['okuma', 'V, Ω, MΩ', 'Ölçü aleti değeri'], ['puan', '—', 'Teşhis ve güvenlik kuralları']],
      method: ['Karmaşık düğüm gerilimi çözümü (Norton kaynakları)', 'RCD 0,7·IΔn eşiği (temsilî)', 'Yalıtım ≥ 1 MΩ (HD 60364-6)'],
      assumptions: ['Senaryo parametreleri eğitim amaçlıdır; kaçak direnci 1 GΩ varsayılır.'], validity: ['Eğitim aracıdır; saha ölçümü yerine geçmez.'], requiredData: [],
      sources: ['EN 50110-1', 'HD 60364-6', 'IEC 61557'],
      impl: ['js/voltsim/calc/ariza.js'], tests: [T('voltsim-ariza.test.cjs')] },

    { id: 'voltsim-yangin', family: V, module: 'yangin', page: '/voltsim/yangin-algilama/', name: 'Yangın algılama ve tahliye (eğitim)', engine: 'voltsim', reviewedWith: '2026.10.24',
      purpose: 'Dedektör yanıtını, kapsama oranını, adresli döngü arızalarını ve kaba tahliye süresini gösterir; yangın projesi değildir.',
      inputs: [['dedektör', '—', 'Tip, konum, eşik'], ['tavan', 'm', 'Yükseklik'], ['kişi', 'adet', 'Tahliye']], outputs: [['t_algılama', 's', 'İlk alarm'], ['kapsama', '%', 'Alan oranı'], ['t_tahliye', 's', 'Kaba tahliye süresi']],
      method: ['Birinci derece gecikme (τ)', 'Kapsama yarıçapı', 'Dijkstra en kısa yol', 't = t_alg + t_tepki + max(L/v, N/(W·Fs))'],
      assumptions: ['Duman yayılımı 2B difüzyon modelidir (CFD değil).', 'Kapsama yarıçapları BS 5839-1 tipindeki değerlerdir; TSE CEN/TS 54-14 yerleşim kuralları ayrıca uygulanmalıdır.'],
      validity: ['Eğitim gösterimi; dedektör yerleşimi onaylı tasarım değildir.'], requiredData: [],
      sources: ['TS EN 54-2, -7, -13', 'TSE CEN/TS 54-14', 'Binaların Yangından Korunması Hakkında Yönetmelik'],
      impl: ['js/voltsim/engine.js · yangin.compute', 'js/voltsim/calc/yangin.js'], tests: [T('voltsim-yangin.test.cjs')] },

    /* ===================== hesaplama/*.html (js/calculator-config.js) ===================== */
    { id: 'hesap-kw-kva-amper', family: H, page: '/hesaplama/kw-kva-amper-donusturucu/', name: 'kW / kVA / kVAr / A dönüştürücü', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Aktif, görünür ve reaktif güç ile hat akımı arasında dönüşüm yapar.',
      inputs: [['değer', 'kW | kVA | A', 'Bilinen büyüklük'], ['U', 'V', '400 V üç faz (hat) veya 230 V tek faz (faz-nötr)'], ['cosφ', '—', 'Güç faktörü']],
      outputs: [['P', 'kW', 'Aktif güç'], ['S', 'kVA', 'Görünür güç'], ['Q', 'kVAr', 'Reaktif güç'], ['I', 'A', 'Hat akımı']],
      method: ['S = P/cosφ, Q = S·sinφ', '3F: I = S·1000/(√3·U_LL); 1F: I = S·1000/U_fn'],
      assumptions: ['Dengeli, sinüzoidal yük; harmonikli yükte gerçek güç faktörü (PF) cosφ’den düşüktür.'], validity: ['Tek frekans (50 Hz) temel bileşen.'], requiredData: [],
      sources: ['IEC 60050-131 (güç tanımları)'], impl: ['hesaplama/kw-kva-amper-donusturucu.html'], tests: [REF, EDGE] },

    { id: 'hesap-trafo-akimi', family: H, page: '/hesaplama/trafo-akimi-hesaplama/', name: 'Trafo anma akımı', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Trafonun primer ve sekonder sargısındaki anma akımını verir.',
      inputs: [['Sr', 'kVA', 'Anma gücü'], ['U', 'V', 'Sekonder hat gerilimi (400 V 3F / 230 V 1F)'], ['U1', 'V', 'Primer hat gerilimi']],
      outputs: [['I2', 'A', 'Sekonder anma akımı'], ['I1', 'A', 'Primer anma akımı']],
      method: ['I = Sr·1000/(√3·U_LL) (üç faz); I = Sr·1000/U (tek faz)'],
      assumptions: ['Anma akımı görünür güçten hesaplanır, cosφ’den bağımsızdır; aşırı yük, ortam sıcaklığı ve harmonik derating dahil değildir.'], validity: ['Dengeli üç faz.'], requiredData: [],
      sources: ['IEC 60076-1'], impl: ['js/calculator-config.js · transformerCurrent'], tests: [REF, EDGE] },

    { id: 'hesap-kisa-devre', family: H, page: '/hesaplama/kisa-devre-akimi-hesaplama/', name: 'AG kısa devre akımı (IEC 60909 yaklaşımı)', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Trafo AG çıkışında ve kablo sonunda en büyük üç faz ve en küçük tek faz kısa devre akımını verir.',
      inputs: [['S, uk, Pk', 'kVA, %, W', 'Trafo'], ['SkQ', 'MVA', 'OG şebeke (boş = sonsuz)'], ['L, S, malzeme, paralel', 'm, mm²', 'Kablo']],
      outputs: [['Ik3', 'kA', 'c = 1,05'], ['ip', 'kA', 'Darbe akımı'], ['Ik1min', 'kA', 'c = 0,95, 1,24·R20'], ['Icu', 'kA', 'Önerilen kesme kapasitesi basamağı']],
      method: ['ZT = uk·U²/Sr, RT = Pk·U²/Sr²', 'Ik3 = c·U/(√3·|Z|)', 'κ = 1,02 + 0,98·e^(−3R/X)', 'Ik1 = c·U0/|(2Z1 + Z0)/3 + 2·Zkablo|'],
      assumptions: ['c_max = 1,05 (±%6 tolerans); ±%10 tolerans için IEC 60909 c_max = 1,10 öngörür.', 'Motor katkısı ve KT düzeltmesi yok; Dyn trafoda Z0T ≈ ZT.', 'SkQ ve Pk girilmezse sonuç "Varsayımsal" olarak işaretlenir.'],
      validity: ['AG radyal şebeke; koruma cihazı seçimi için üretici verisiyle tam IEC 60909 hesabı gerekir.'], requiredData: [],
      sources: ['IEC 60909-0'], impl: ['js/calculator-config.js · shortCircuit'], tests: [T('hesaplama-formulas.test.cjs'), REF, EDGE] },

    { id: 'hesap-gerilim-dusumu', family: H, page: '/hesaplama/gerilim-dusumu-hesaplama/', name: 'Gerilim düşümü', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Kablo boyunca yüzde gerilim düşümünü ve EİTY Madde 57 sınırıyla karşılaştırmasını verir.',
      inputs: [['I', 'A', 'Yük akımı'], ['L', 'm (tek yön)', 'Kablo boyu'], ['S', 'mm²', 'Kesit'], ['U', 'V', '3F: hat gerilimi; 1F: faz-nötr'], ['cosφ', '—', 'Güç faktörü'], ['θ', '°C', 'İletken sıcaklığı']],
      outputs: [['ΔU', 'V, %', 'Gerilim düşümü']],
      method: ['ΔU = k·I·L·(R′·cosφ + X′·sinφ); k = √3 (3F) veya 2 (1F)', 'R′ = (1/κ20)·(1 + α·(θ − 20))/S'],
      assumptions: ['X′ = 0,08 Ω/km (tipik AG kablo).', 'EİTY sınırları yapı bağlantı kutusundan tüketiciye kadardır.'], validity: ['AG kablolar; harmonik akımlar dahil değil.'], requiredData: [],
      sources: ['Elektrik İç Tesisleri Yönetmeliği Madde 57', 'TS HD 60364-5-52 Ek G'], impl: ['js/calculator-config.js · voltageDrop'], tests: [T('hesaplama-formulas.test.cjs'), REF, EDGE] },

    { id: 'hesap-kablo-kesiti', family: H, page: '/hesaplama/kablo-kesiti-hesaplama/', name: 'Kablo kesiti seçimi', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Koruma anma akımı, düzeltilmiş akım taşıma kapasitesi ve gerilim düşümüne göre en küçük uygun bakır kesiti seçer.',
      inputs: [['P veya I', 'kW, A', 'Yük'], ['U', 'V', 'Hat/faz gerilimi'], ['yöntem, ortam, grup', '—, °C, adet', 'Döşeme koşulları']], outputs: [['S', 'mm²', 'Kesit'], ['In', 'A', 'Koruma'], ['Iz', 'A', 'Düzeltilmiş kapasite']],
      method: ['Ib ≤ In ≤ Iz, I2 ≤ 1,45·Iz', 'Iz = Iz,tablo·kθ·kg'],
      assumptions: ['Bakır PVC (70 °C) tabloları; alüminyum ve XLPE için bu araçta tablo yoktur.'], validity: ['AG, ≤ 240 mm².'], requiredData: [],
      sources: ['TS HD 60364-5-52', 'TS HD 60364-4-43'], impl: ['js/calculator-config.js · selectCable'], tests: [T('hesaplama-formulas.test.cjs'), EDGE] },

    { id: 'hesap-kompanzasyon', family: H, page: '/hesaplama/kompanzasyon-hesaplama/', name: 'Kompanzasyon (kondansatör gücü)', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Hedef güç faktörü için gereken kondansatör gücünü ve EPDK endüktif oran sınırı karşılaştırmasını verir.',
      inputs: [['P', 'kW', 'Aktif güç'], ['cosφ1, cosφ2', '—', 'Mevcut ve hedef']], outputs: [['Qc', 'kVAr', 'Gerekli kondansatör'], ['oran', '%', 'kVArh/kWh']],
      method: ['Qc = P·(tanφ1 − tanφ2)', 'oran = tanφ·100'],
      assumptions: ['Sabit, sinüzoidal yük; harmonikli tesiste ayarlı (detuned) kompanzasyon gerekir — şönt reaktör ve harmonik filtre ayrı cihazlardır.', 'Hedef ≤ mevcut ise kondansatör gerekmez (negatif kVAr önerilmez).'],
      validity: ['Aylık enerji oranı, sabit yükte anlık orana eşit kabul edilir.'], requiredData: [],
      sources: ['EPDK Kurul Kararı (reaktif enerji, Madde 13)', 'IEC 60831-1'], impl: ['js/calculator-config.js · compensation'], tests: [REF, EDGE] },

    { id: 'hesap-motor-akimi', family: H, page: '/hesaplama/motor-akimi-hesaplama/', name: 'Motor anma akımı', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Motor mil (çıkış) gücünden şebekeden çekilen akımı ve elektriksel giriş gücünü verir.',
      inputs: [['P', 'kW (mil)', 'Etiket gücü — mekanik çıkış'], ['cosφ, η', '—, %', 'Etiket değerleri'], ['U', 'V', '400 V 3F / 230 V 1F']], outputs: [['I', 'A', 'Anma akımı'], ['P_el', 'kW', 'Elektriksel giriş = P/η']],
      method: ['I = P·1000/(√3·U·cosφ·η)', 'P_el = P_mil/η'],
      assumptions: ['Anma yükünde; kısmi yükte cosφ ve η düşer. Etiketteki In bu hesaptan önce gelir.'], validity: ['AG asenkron motor.'], requiredData: [],
      sources: ['IEC 60034-1'], impl: ['js/calculator-config.js · loadCurrent'], tests: [REF, EDGE] },

    { id: 'hesap-ges-uretim', family: H, page: '/hesaplama/ges-uretim-hesaplama/', name: 'GES kurulu güç ve yıllık üretim ön hesabı', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Tüketim, alan ve sözleşme gücüne göre GES kurulu gücünü ve bölgesel tipik özgül verimle yıllık üretimi tahmin eder.',
      inputs: [['tüketim', 'kWh/ay', 'Aylık tüketim'], ['alan', 'm²', 'Kullanılabilir alan'], ['bölge', 'kWh/kWp·yıl', 'Tipik özgül verim (1300–1650)']], outputs: [['P', 'kWp', 'Kurulu güç'], ['E', 'kWh/yıl', 'Yıllık üretim']],
      method: ['P = min(tüketim·gündüz oranı/özgül verim; alan/m²·kWp⁻¹; sözleşme gücü)', 'E = P·özgül verim·0,95'],
      assumptions: ['Bölge değerleri tipik özgül verimdir (sahaya özgü değil); 0,95 ek kirlenme/kullanılabilirlik/ilk yıl degradasyon payıdır, tam PR değildir.'], validity: ['Ön fizibilite; sonuç her zaman "Varsayımsal" işaretlenir.'], requiredData: [],
      sources: ['Lisanssız Elektrik Üretim Yönetmeliği'], impl: ['hesaplama/ges-uretim-hesaplama.html'], tests: [EDGE] },

    { id: 'hesap-jenerator', family: H, page: '/hesaplama/jenerator-gucu-hesaplama/', name: 'Jeneratör gücü', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Sürekli yük ve en büyük motorun kalkışına göre jeneratör kVA değerini verir.',
      inputs: [['P, cosφ, eşzamanlılık', 'kW, —, —', 'Yük'], ['motor', 'kW', 'En büyük motor'], ['yol verme', '—', 'DOL/YD/SS/VFD']], outputs: [['S', 'kVA', 'Gerekli ve standart güç']],
      method: ['S1 = max(P·ks/cosφ, P·ks/0,8)·(1 + pay)', 'S2 = Sst·x″d·(1 − ΔU)/ΔU', 'S = max(S1, S2)'],
      assumptions: ['Jeneratör kVA’da cosφ 0,8 anmalıdır (kW sınırı = 0,8·kVA).', 'Kalkış akımı katsayıları ve x″d = 0,20 tipiktir.'], validity: ['Tek jeneratör, ada çalışma.'], requiredData: [],
      sources: ['ISO 8528-1/-5'], impl: ['js/calculator-config.js · generatorSize'], tests: [T('hesaplama-formulas.test.cjs'), EDGE] },

    { id: 'hesap-ups', family: H, page: '/hesaplama/ups-gucu-hesaplama/', name: 'UPS gücü ve akü', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'UPS kVA değerini ve istenen sürede blok başına gereken sabit gücü verir.',
      inputs: [['P', 'kW', 'Kritik yük'], ['pf', '—', 'UPS çıkış güç faktörü'], ['t', 'dk', 'Yedekleme süresi'], ['Udc', 'V', 'Akü gerilimi']], outputs: [['S', 'kVA', 'UPS'], ['W/blok', 'W', 'Sabit güç'], ['Ah', 'Ah (C10)', 'Yaklaşık kapasite']],
      method: ['S = P/pf·(1 + pay)', 'P_dc = P/η_inv', 'W/blok = P_dc·1,25/n_blok'],
      assumptions: ['Tipik VRLA kapasite oranı tablosu, 1,75 V/hücre, yaşlanma 1,25.'], validity: ['Ön seçim; üretici sabit güç tablosu esastır.'], requiredData: [],
      sources: ['IEC 62040-3', 'IEEE 485'], impl: ['js/calculator-config.js · upsSize'], tests: [T('hesaplama-formulas.test.cjs'), EDGE] },

    { id: 'hesap-topraklama', family: H, page: '/hesaplama/topraklama-hesaplama/', name: 'Çubuk topraklayıcı sayısı', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Hedef topraklama direnci için gereken düşey çubuk sayısını verir.',
      inputs: [['ρ', 'Ω·m', 'Toprak özdirenci'], ['L, d', 'm', 'Çubuk'], ['mevsim', '—', 'Katsayı'], ['R_hedef', 'Ω', 'Hedef']], outputs: [['n', 'adet', 'Çubuk sayısı'], ['R', 'Ω', 'Yaklaşık direnç']],
      method: ['R1 = ρ/(2πL)·(ln(8L/d) − 1)', 'Rn = R1/(n·η(n))'],
      assumptions: ['Homojen toprak; paralel çalışma verimi tipik (BS 7430 / IEEE 142 eğilimi); aralık ≥ çubuk boyu.'], validity: ['≤ 30 çubuk; kabul ölçülen dirençle yapılır.'], requiredData: [],
      sources: ['Elektrik Tesislerinde Topraklamalar Yönetmeliği', 'BS 7430', 'IEEE 142'], impl: ['js/calculator-config.js · rodResistance, rodsFor'], tests: [T('hesaplama-formulas.test.cjs'), EDGE] },

    { id: 'hesap-inverter-kablo', family: H, page: '/hesaplama/inverter-dc-ac-kablo-secimi/', name: 'İnverter DC/AC kablo seçimi', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'FV dizisi DC kablosu ve inverter AC kablosu için kesit önerir.',
      inputs: [['Isc, Np', 'A, adet', 'Dizi'], ['L, U', 'm, V', 'Hat'], ['P_AC', 'kW', 'İnverter']], outputs: [['S_DC, S_AC', 'mm²', 'Kesitler']],
      method: ['Ib,DC = 1,25·Isc·Np (IEC 62548)', 'Iz (EN 50618) ≥ Ib', 'ΔU_DC = 2·I·L·R′'],
      assumptions: ['DC düşüm 70 °C iletken direnciyle; H1Z2Z2-K tek kablo havada 60 °C.'], validity: ['Sınırlar %1 DC / %1,5 AC tavsiyedir.'], requiredData: [],
      sources: ['IEC 62548-1', 'EN 50618', 'TS HD 60364-5-52'], impl: ['js/calculator-config.js · selectDcCable, selectCable'], tests: [EDGE] },

    { id: 'hesap-isletme-ucreti', family: H, page: '/hesaplama/isletme-sorumlulugu-ucret-hesaplama/', name: 'YG işletme sorumluluğu ücreti', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'EMO en az ücret tablosuyla aylık YG işletme sorumluluğu ve bakım bedelini hesaplar.',
      inputs: [['tip, kVA, fider, ENH', '—', 'Tesis'], ['bk', '—', 'Bölgesel katsayı']], outputs: [['toplam', 'TL/ay (KDV hariç)', 'En az ücret']],
      method: ['EMO 2026 Ücret Tanımları Kısım III kademeleri'],
      assumptions: ['Tablo 05.03.2026 yürürlüklü EMO kararıdır (kayıtta kontrol tarihi 12.10.2026); her yıl yenilenir.'], validity: ['En az ücrettir; teklif değildir.'], requiredData: [],
      sources: ['EMO YK 04.03.2026 tarih ve 49/60 sayılı karar'], impl: ['js/calculator-config.js · calcIsletmeUcreti'], tests: [T('hesaplama-formulas.test.cjs')] },

    { id: 'hesap-sigorta-tms', family: H, page: '/hesaplama/sigorta-tms-secimi/', name: 'Sigorta / TMS seçimi', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Yük akımına göre MCB/MCCB/gG anma akımını ve aşırı yük koşulunu verir.',
      inputs: [['P', 'kW', 'Yük'], ['U, cosφ', 'V, —', 'Gerilim (3F hat / 1F faz-nötr)'], ['Iz', 'A', 'Kablo kapasitesi']], outputs: [['In', 'A', 'Koruma anma akımı'], ['I2', 'A', 'Konvansiyonel açma akımı']],
      method: ['Ib ≤ In ≤ Iz; I2 ≤ 1,45·Iz (gG: I2 = 1,6·In)', 'Manyetik açma: B 3–5·In, C 5–10·In, D 10–20·In'],
      assumptions: ['Dengeli, sinüzoidal yük; kısa devre kesme kapasitesi ve seçicilik ayrıca kontrol edilir.'], validity: ['AG son devreler.'], requiredData: [],
      sources: ['TS HD 60364-4-43', 'TS EN 60898-1', 'IEC 60269-1'], impl: ['js/calculator-config.js · pickProtection, overloadOk'], tests: [T('hesaplama-formulas.test.cjs'), EDGE] },

    { id: 'hesap-motor-koruma', family: H, page: '/hesaplama/motor-koruma-kontaktor-secimi/', name: 'Motor koruma ve kontaktör seçimi', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Motor anma akımından AC-3 kontaktör ve motor koruma şalteri ayar aralığını önerir.',
      inputs: [['P', 'kW (mil)', 'Etiket gücü'], ['U', 'V', 'Hat/faz gerilimi'], ['yol verme', '—', 'DOL/YD/SS']], outputs: [['In', 'A', 'Motor akımı'], ['kontaktör', 'A (AC-3)', 'Standart basamak']],
      method: ['In = P/(√3·U·cosφ·η)', 'YD: kontaktörler In/√3 taşır'],
      assumptions: ['cosφ 0,86 ve tipik verim kabulü; etiket akımı esastır.'], validity: ['AG asenkron motor, AC-3 kullanım.'], requiredData: [],
      sources: ['TS EN 60947-4-1', 'IEC 60034-1'], impl: ['hesaplama/motor-koruma-kontaktor-secimi.html'], tests: [EDGE] },

    { id: 'hesap-aydinlatma', family: H, page: '/hesaplama/aydinlatma-lux-hesaplama/', name: 'Aydınlatma (lümen yöntemi)', engine: 'calculator-config', reviewedWith: '2026-10-24',
      purpose: 'Hedef ortalama aydınlık düzeyi için armatür sayısını ve toplam gücü tahmin eder.',
      inputs: [['A', 'm²', 'Alan'], ['E', 'lux', 'Hedef'], ['Φ, P', 'lm, W', 'Armatür']], outputs: [['n', 'adet', 'Armatür'], ['P', 'W', 'Toplam güç']],
      method: ['n = E·A/(Φ·UF·MF)'],
      assumptions: ['Kullanım faktörü tipik değerdir; düzgünlük, UGR ve Ra hesaplanmaz.'], validity: ['Sonuç "Varsayımsal"; fotometrik hesapla doğrulanmalıdır.'], requiredData: [],
      sources: ['TS EN 12464-1'], impl: ['hesaplama/aydinlatma-lux-hesaplama.html'], tests: [EDGE] },

    { id: 'hesap-harmonik-filtre', family: H, page: '/hesaplama/harmonik-filtre-ihtiyaci/', name: 'Harmonik filtre ihtiyacı ön değerlendirmesi', engine: 'vg-assess', reviewedWith: '2026-10-24',
      purpose: 'Doğrusal olmayan yük payı, trafo kısa devre gücü ve kondansatör rezonansına göre kaba harmonik risk sınıfı verir.',
      inputs: [['sT, uk, Sk', 'kVA, %, MVA', 'Kaynak'], ['VFD/UPS/LED payları', 'kW', 'Doğrusal olmayan yük'], ['Qc, reaktör', 'kVAr, p', 'Kompanzasyon']], outputs: [['Gh/Sn', '%', 'Harmonik yük oranı'], ['THDi, THDv', '%', 'Kaba tahmin'], ['hr', '—', 'Paralel rezonans mertebesi']],
      method: ['hr = √(Ssc/Qc) (reaktörsüz); p = %7 → 189 Hz, p = %14 → 134 Hz', 'U_h ≈ h·I_h·X_k'],
      assumptions: ['Yük türüne göre tipik THD katsayıları ve cosφ ≈ 0,9; tahmin kabadır, ölçüm yerine geçmez.', 'Ayarlı (detuned) kompanzasyon, pasif ayarlı filtre ve aktif filtre ayrı çözümlerdir; şönt reaktör harmonik süzmez.'],
      validity: ['Risk sınıfı; filtre boyutlandırması TS EN 61000-4-30 sınıf A ölçüm gerektirir.'], requiredData: [],
      sources: ['IEC 61000-3-12', 'TS EN 50160', 'IEC 60831-1'], impl: ['js/vg-assess.js · harmonicNeed'], tests: [T('assess-tools.test.cjs'), EDGE] },

    /* ===================== araclar/ (tools/engineering/src) ===================== */
    { id: 'arac-ag-kisa-devre', family: A, page: '/araclar/ag-kisa-devre/', name: 'AG kısa devre simülatörü', engine: 'araclar', reviewedWith: '2026-10-24',
      purpose: 'Trafodan başlayan AG kablo zinciri boyunca düğüm kısa devre akımlarını ve koruma cihazı ön kontrolünü verir.',
      inputs: [['trafo', 'kVA, %, W', 'Sr, uk, Pcu'], ['segment', 'm, mm²', 'Kablo/hat']], outputs: [['I″k3, ip, I″k1', 'kA', 'Düğüm akımları']],
      method: ['Vektörel: Zk = √((ΣR)² + (ΣX)²)', 'Skaler: Zk = Σ|Zi| (akımı küçük verir; Icu kontrolü her iki modda vektörel akımla)', 'c_max seçilebilir: 1,05 (±%6 tolerans) veya 1,10 (±%10 tolerans); c_min = 0,95'],
      assumptions: ['OG şebeke sonsuz; KT ve motor katkısı yok.', 'Ik1,min için iletken direnci 1,24·R20 (iyimser olabilir).'], validity: ['Ön kontrol; "Ön kontrol sağlanıyor" uygunluk onayı değildir.'], requiredData: [],
      sources: ['IEC 60909-0 (Tablo 1: gerilim katsayısı c)'], impl: ['tools/engineering/src/tools/AG_Kısa_Devre_Simülatörü.html'], tests: [T('araclar-fixes.test.cjs'), EDGE] },

    { id: 'arac-ges-tasarim', family: A, page: '/araclar/ges-tasarim/', name: 'GES tasarım simülatörü', engine: 'araclar', reviewedWith: '2026-10-24',
      purpose: 'String gerilim/akım kontrolleri, DC/AC kablo ve yıllık üretim simülasyonu.',
      inputs: [['modül', 'V, A, %/°C', 'Katalog değerleri'], ['Tmin, Tmax', '°C', 'Saha sıcaklıkları'], ['cosφ', '—', 'AC hat']], outputs: [['Max Voc, Min Vmpp', 'V', 'String'], ['%e, ΔP', '%, W', 'AC hat']],
      method: ['Max Voc = N·Voc·(1 + |k|·max(0, Tnom − Tmin)/100)', 'Min Vmpp: hücre ≈ Tmax + 30 K', 'AC: Q = P·tanφ (girilmemişse), ΔP = 3I²R'],
      assumptions: ['DC kablo iletkenliği 70 °C iletken sıcaklığına düzeltilir: κθ = κ20/(1 + α·50) (Cu 56 → 46,8; Al 35 → 29,1).', 'Diğer kayıplar %12 (değiştirilebilir) ve inverter %98,5 sabit.'], validity: ['Ön tasarım; üretici string hesaplayıcısıyla doğrulanmalıdır.'], requiredData: [],
      sources: ['IEC 62548-1', 'TEDAŞ k/m tabloları', 'IEC 60228 (iletken direnci)'], impl: ['tools/engineering/src/tools/GES_Tasarım_Similatörü.html'], tests: [T('araclar-fixes.test.cjs'), EDGE] },

    { id: 'arac-ag-gerilim-dusumu', family: A, page: '/araclar/ag-gerilim-dusumu/', name: 'AG gerilim düşümü ve güç kaybı', engine: 'araclar', reviewedWith: '2026-10-24',
      purpose: 'AG dağıtım hattında kümülatif yüklerle yüzde gerilim düşümünü ve güç kaybını verir.',
      inputs: [['P, Q, L', 'kW, kVAr, m', 'Segment'], ['U, cosφ, θ', 'V, —, °C', 'Genel']], outputs: [['%e', '%', 'Düşüm'], ['%P', '%', 'Kayıp']],
      method: ['%e = (k·P + m·Q)·L/10⁷, k,m ∝ 1/U²', 'R = R20·(1 + 0,004·Δθ)'],
      assumptions: ['TEDAŞ k/m tabloları; akım taşıma düzeltmesi (ortam/gruplama) uygulanmaz.', 'Sınır seçilmezse %3 (EİTY Md. 57 motor) kullanılır.'], validity: ['AG radyal hat.'], requiredData: [],
      sources: ['Elektrik İç Tesisleri Yönetmeliği Madde 57', 'TEDAŞ'], impl: ['tools/engineering/src/tools/AG_Gerilim_Düşümü_ve_Güç_Kaybı_Hesabı.html'], tests: [EDGE] },

    { id: 'arac-og-kisa-devre', family: A, page: '/araclar/og-kisa-devre/', name: 'OG kısa devre simülatörü', engine: 'araclar', reviewedWith: '2026-10-24',
      purpose: 'OG şebeke, indirici trafo, OG hatları ve dağıtım trafosu üzerinden OG ve 0,4 kV barada üç faz, iki faz, faz-toprak ve iki faz-toprak kısa devre akımlarını verir.',
      inputs: [['S″kQ', 'MVA', 'Şebeke kısa devre gücü'], ['Nn, uk, Pk', 'MVA/kVA, %, kW', 'Trafolar (Pk boş = R ihmal)'], ['hat', 'km, Ω/km', 'OG hatları'], ['Rn', 'Ω', 'Nötr direnci']], outputs: [['I″k3, I″k2', 'kA', 'Simetrik akımlar'], ['I″k1, I″kE2E', 'kA', 'Toprak arızaları']],
      method: ['pu sistemi (100 MVA baz)', 'rT = (Pk/Sn)·(Sb/Sn), xT = √(zT² − rT²)', 'I″k1 = 3c/|2Z1 + Z0|', 'I″kE2E = 3c/|Z1 + 2Z0| (karmaşık toplam)', 'c = 1,10/1,05 (cmax) veya 1,00/0,95 (cmin)'],
      assumptions: ['Z2 = Z1; Dyn dağıtım trafosunda Z0 ≈ Z1 (R0 ≈ R1).', 'Pk girilmezse trafo R ≈ 0 kabul edilir (akım biraz büyük).', 'KT düzeltmesi ve motor katkısı yok.'],
      validity: ['Radyal OG dağıtım; koruma ayarı için tam IEC 60909 / kısa devre yazılımıyla doğrulanmalıdır.'], requiredData: [],
      sources: ['IEC 60909-0', 'TEDAŞ kısa devre hesap şablonu'], impl: ['tools/engineering/src/tools/OG_Kisa_Devre_Simulatoru.html'], tests: [T('araclar-fixes.test.cjs')] },

    { id: 'arac-adim-gerilimi', family: A, page: '/araclar/adim-gerilimi/', name: 'Adım gerilimi simülatörü', engine: 'araclar', reviewedWith: '2026-10-24',
      purpose: 'Yarıküre topraklayıcı çevresindeki potansiyel dağılımından adım gerilimini ve IEEE 80 izin verilen adım gerilimini gösterir.',
      inputs: [['V0', 'V', 'Topraklayıcı potansiyeli'], ['ρ', 'Ω·m', 'Zemin özdirenci'], ['ρs, hs', 'Ω·m, m', 'Yüzey tabakası (isteğe bağlı)'], ['ts', 's', 'Arıza süresi']], outputs: [['ΔV', 'V', 'Adım gerilimi'], ['E_adım', 'V', 'İzin verilen']],
      method: ['V(r) = V0·r0/r (r0 = 1 m)', 'Cs = 1 − 0,09·(1 − ρ/ρs)/(2hs + 0,09)', 'E_adım = (1000 + 6·Cs·ρs)·k/√ts (k = 0,116 / 0,157)'],
      assumptions: ['Homojen zemin, yarıküre elektrot (eğitim modeli).', 'Tabaka yoksa Cs = 1 ve ρs = ρ.'], validity: ['Eğitim/ön değerlendirme; tesis için ağ topraklama hesabı ve ölçüm gerekir.'], requiredData: [],
      sources: ['IEEE 80-2013', 'Elektrik Tesislerinde Topraklamalar Yönetmeliği'], impl: ['tools/engineering/src/tools/Adım_Gerilimi.html'], tests: [T('araclar-fixes.test.cjs')] },

    { id: 'arac-sabit-kondansator', family: A, page: '/araclar/sabit-kondansator-hesabi/', name: 'Trafo sabit kondansatörü', engine: 'araclar', reviewedWith: '2026-10-24',
      purpose: 'Dağıtım trafosunun boşta ve yük altındaki reaktif tüketimini karşılayacak sabit kondansatör gücünü verir.',
      inputs: [['Sn, I0, Pcu, uk', 'kVA, %, W, %', 'Trafo etiket/test verisi'], ['kWh, kVArh, gün, saat', '—', 'Fatura (k için)'], ['F', '—', 'Yük eğrisi biçim katsayısı k_rms/k_ort']], outputs: [['QL1', 'kVAr', 'Boşta'], ['QL2′', 'kVAr', 'Yükte = k²·QL2'], ['Qc', 'kVAr', 'Toplam']],
      method: ['QL1 = √((I0·Sn)² − P0²)', 'QL2 = √((uk·Sn)² − Pcu²)', 'k_etkin = F·S_ort/Sn; QL2′ = k_etkin²·QL2'],
      assumptions: ['Değişken yükte E[k²] ≥ E[k]²; F girilmezse 1,0 (sabit yük, alt sınır).', 'Faturadaki endüktif kVArh mevcut kompanzasyon sonrası net değerdir.'], validity: ['Ön hesap; kademe seçimi sayaç verisiyle kontrol edilmelidir.'], requiredData: [],
      sources: ['EPDK reaktif enerji düzenlemesi', 'IEC 60076-1'], impl: ['tools/engineering/src/tools/Sabit_Kondansatör_Hesabı.html'], tests: [T('araclar-fixes.test.cjs')] },

    { id: 'arac-lab-guc', family: A, page: '/araclar/guc-ucgeni/', name: 'Güç üçgeni, kompanzasyon, THD, EV şarj, batarya (Lab araçları)', engine: 'araclar', reviewedWith: '2026-10-24',
      purpose: 'Temel güç bağıntıları: güç üçgeni, kompanzasyon kondansatörü, harmonik THD, motor hız-tork, batarya enerjisi ve ideal AC şarj süresi.',
      inputs: [['P, cosφ, U', 'kW, —, V', 'Güç üçgeni'], ['C, ΔSoC, P, η', 'kWh, %, kW, —', 'EV şarj']], outputs: [['S, Q, I', 'kVA, kVAr, A', '—'], ['E, t', 'kWh, h', 'Şarj']],
      method: ['S = P/cosφ, Q = P·tanφ', 'Qc = P·(tanφ1 − tanφ2)', 'THD = √Σ Xh²/X1', 'E = C·ΔSoC; t = E/(P·η)'],
      assumptions: ['EV şarjında sabit güç; DC eğrisi (taper) yok. 60 kWh %20→%80: 36 kWh depolanan, η 0,9 ile 40 kWh şebekeden.'], validity: ['Eğitim/ön hesap.'], requiredData: [],
      sources: ['IEC 60050-131', 'IEC 61000-4-7 (THD tanımı)'], impl: ['tools/engineering/src/shared/engineering-core.js'], tests: ['tools/engineering/tests/calculations.test.cjs', EDGE] }
  ];

  return { STATUS: STATUS, ORDER: ORDER, classify: classify, assumedInputs: assumedInputs, getPath: getPath, entries: entries,
    byId: id => entries.find(e => e.id === id) || null,
    byModule: mod => entries.find(e => e.family === V && e.module === mod) || null };
});
