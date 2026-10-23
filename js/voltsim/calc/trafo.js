/* VoltSim · trafo ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.trafo, Node'da require() ile kullanılır; testleri tools/tests/voltsim-trafo.test.cjs.
 * İçerik: OG trafo koruma hücresi manevra durum makinesi ve kilitlemeler, yüksüz kademe değiştirici ve AG gerilimi,
 * kompanzasyon, günlük kayıp enerjisi ve maliyeti, ONAF fan kontrolü, kuru tip sıcaklık yaklaşımı, röle/sigorta/ACB
 * ön kontrolleri, paralel çalışma koşulları. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.trafo = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d) => { v = Number(v); return isFinite(v) ? v : d; };

  /* ------------------------------------------------------------ manevra durum makinesi
   * Elemanlar: lv (AG ACB), cb (OG kesici; sigortalı hücrede yük ayırıcı), ds (ayırıcı; yalnız kesicili hücre),
   * es (topraklama ayırıcısı), door (kablo bölmesi kapağı). kind: 'cb' | 'fuse'. */
  const OPS = {
    lvOpen: 'AG ana şalteri (ACB) aç', lvClose: 'AG ana şalterini (ACB) kapat',
    cbOpen: 'Kesiciyi aç', cbClose: 'Kesiciyi kapat',
    dsOpen: 'Ayırıcıyı aç', dsClose: 'Ayırıcıyı kapat',
    esClose: 'Topraklama ayırıcısını kapat', esOpen: 'Topraklama ayırıcısını aç',
    doorOpen: 'Kablo bölmesi kapağını aç', doorClose: 'Kablo bölmesi kapağını kapat'
  };
  const OPS_FUSE = { cbOpen: 'Yük ayırıcıyı aç', cbClose: 'Yük ayırıcıyı kapat' };
  function initialSw() { return { lv: true, cb: true, ds: true, es: false, door: false }; }
  function opLabel(op, kind) { return (kind === 'fuse' && OPS_FUSE[op]) || OPS[op] || op; }
  /** Trafo tarafı (kablo) gerilim altında mı? OG'den besleme veya AG'den geri besleme. */
  function energized(sw, kind) {
    const mv = !!(sw.cb && (kind === 'fuse' || sw.ds) && !sw.es);
    return { mv: mv, lv: mv && !!sw.lv };
  }
  /** İşlem yapılabilir mi? { ok, reason } — kilitleme kuralları (genel; üretici kilitleme şeması esastır). */
  function can(sw, op, kind) {
    const isFuse = kind === 'fuse';
    const no = r => ({ ok: false, reason: r });
    switch (op) {
      case 'lvOpen': return sw.lv ? { ok: true } : no('AG şalteri zaten açık.');
      case 'lvClose': if (sw.lv) return no('AG şalteri zaten kapalı.'); if (sw.es) return no('Trafo topraklıyken AG şalteri kapatılamaz (geri besleme ve topraklı devreye kapama riski).'); return { ok: true };
      case 'cbOpen': return sw.cb ? { ok: true } : no((isFuse ? 'Yük ayırıcı' : 'Kesici') + ' zaten açık.');
      case 'cbClose': if (sw.cb) return no((isFuse ? 'Yük ayırıcı' : 'Kesici') + ' zaten kapalı.'); if (sw.es) return no('Topraklama ayırıcısı kapalıyken kapama yapılamaz (kilitleme).'); if (sw.door) return no('Kablo bölmesi kapağı açıkken kapama yapılamaz (kilitleme).'); return { ok: true };
      case 'dsOpen': if (isFuse) return no('Sigortalı yük ayırıcı hücresinde ayrı ayırıcı yoktur.'); if (!sw.ds) return no('Ayırıcı zaten açık.'); if (sw.cb) return no('Ayırıcı yük altında açılamaz: önce kesiciyi açın (kilitleme).'); return { ok: true };
      case 'dsClose': if (isFuse) return no('Sigortalı yük ayırıcı hücresinde ayrı ayırıcı yoktur.'); if (sw.ds) return no('Ayırıcı zaten kapalı.'); if (sw.cb) return no('Ayırıcı kesici kapalıyken kapatılamaz (kilitleme).'); if (sw.es) return no('Topraklama kapalıyken ayırıcı kapatılamaz (kilitleme).'); if (sw.door) return no('Kapak açıkken ayırıcı kapatılamaz.'); return { ok: true };
      case 'esClose': if (sw.es) return no('Topraklama ayırıcısı zaten kapalı.'); if (sw.cb) return no('Topraklama ayırıcısı, ' + (isFuse ? 'yük ayırıcı' : 'kesici') + ' açılmadan kapatılamaz (gerilim altındaki devre topraklanamaz).'); if (!isFuse && sw.ds) return no('Topraklama ayırıcısı, ayırıcı açılmadan kapatılamaz (kilitleme).'); if (sw.lv) return no('AG şalteri kapalı: AG tarafından geri besleme olabilir. Önce AG şalterini açın.'); return { ok: true };
      case 'esOpen': if (!sw.es) return no('Topraklama ayırıcısı zaten açık.'); if (sw.door) return no('Kapak açıkken topraklama açılamaz (kilitleme).'); return { ok: true };
      case 'doorOpen': if (sw.door) return no('Kapak zaten açık.'); if (!sw.es) return no('Kablo bölmesi kapağı yalnız topraklama ayırıcısı kapalıyken açılabilir (kilitleme).'); return { ok: true };
      case 'doorClose': return sw.door ? { ok: true } : no('Kapak zaten kapalı.');
      default: return no('Bilinmeyen işlem.');
    }
  }
  /** İşlemi uygular; izin yoksa durum değişmez. warn: kurala uygun ama iyi uygulamaya aykırı. */
  function apply(sw, op, kind) {
    const c = can(sw, op, kind);
    if (!c.ok) return { ok: false, reason: c.reason, sw: Object.assign({}, sw) };
    const n = Object.assign({}, sw);
    let warn = null;
    if (op === 'cbOpen' && sw.lv) warn = 'İyi uygulama: OG tarafını açmadan önce AG yükünü (ACB) açın.';
    if (op === 'cbClose' && sw.lv) warn = 'İyi uygulama: trafoyu boşta enerjileyin, AG şalterini sonra kapatın.';
    const key = { lvOpen: ['lv', false], lvClose: ['lv', true], cbOpen: ['cb', false], cbClose: ['cb', true], dsOpen: ['ds', false], dsClose: ['ds', true], esClose: ['es', true], esOpen: ['es', false], doorOpen: ['door', true], doorClose: ['door', false] }[op];
    n[key[0]] = key[1];
    return { ok: true, sw: n, warn: warn };
  }
  /** Güvenli çalışma durumu: AG açık, OG açık/ayrılmış, topraklı. */
  function isSafe(sw, kind) { return !sw.lv && !sw.cb && (kind === 'fuse' || !sw.ds) && !!sw.es; }
  /** Duruma göre yapılabilecek işlemler (kilitlemesiz olanlar). */
  function available(sw, kind) { return Object.keys(OPS).filter(op => can(sw, op, kind).ok); }
  /** Güvenli enerjisiz bırakma sırası (öneri) ve yeniden enerjileme (ters sıra). */
  function isolationSequence(kind) {
    return kind === 'fuse' ? ['lvOpen', 'cbOpen', 'esClose', 'doorOpen'] : ['lvOpen', 'cbOpen', 'dsOpen', 'esClose', 'doorOpen'];
  }
  function reenergizeSequence(kind) {
    return kind === 'fuse' ? ['doorClose', 'esOpen', 'cbClose', 'lvClose'] : ['doorClose', 'esOpen', 'dsClose', 'cbClose', 'lvClose'];
  }

  /* ------------------------------------------------------------ kademe ve gerilim */
  const TAPS = [5, 2.5, 0, -2.5, -5]; // OG sargısı sarım değişimi (%), kademe 1…5
  /** Yüksüz kademe: OG sarımı +t% → AG boşta gerilimi U2n·(U1/U1n)/(1 + t). Yükte (1 − ε). */
  function lvVoltage(o) {
    const U0 = num(o.U2n, 400) * num(o.uNetPct, 100) / 100 / (1 + num(o.tapPct, 0) / 100);
    return { U0: U0, Uload: U0 * (1 - num(o.regPct, 0) / 100) };
  }

  /** Kompanzasyon: Q1 = P·tanφ − Qc. Kapasitif bölgeye geçiş uyarı içindir. */
  function pfCorrection(P_kW, cos, Qc_kvar) {
    const Q0 = P_kW * Math.tan(Math.acos(clamp(cos, 0.05, 1)));
    const Q1 = Q0 - Math.max(0, num(Qc_kvar, 0));
    const S1 = Math.hypot(P_kW, Q1);
    return { Q0: Q0, Q1: Q1, cos1: S1 > 0 ? P_kW / S1 : 1, capacitive: Q1 < -1e-9 };
  }
  /** Gerekli kondansatör gücü: hedef cosφ için Qc = P·(tanφ1 − tanφ2). */
  function capNeeded(P_kW, cos, target) { return Math.max(0, P_kW * (Math.tan(Math.acos(clamp(cos, 0.05, 1))) - Math.tan(Math.acos(clamp(target, 0.05, 1))))); }

  /* ------------------------------------------------------------ günlük profil ve kayıplar */
  const PROFILES = {
    sabit: { name: 'Sabit yük (7/24)', m: () => 1 },
    iki: { name: 'İki vardiya fabrika', m: h => (h < 6 ? 0.35 : h < 8 ? 0.7 : h < 12 ? 1 : h < 13 ? 0.75 : h < 17 ? 1 : h < 22 ? 0.85 : 0.45) },
    uc: { name: 'Üç vardiya fabrika', m: h => (h >= 7 && h < 19 ? 1 : 0.85) },
    ofis: { name: 'Ofis / ticari bina', m: h => (h >= 8 && h < 19 ? 1 : h >= 7 && h < 21 ? 0.55 : 0.25) }
  };
  function profileMult(key, hour) { const p = PROFILES[key] || PROFILES.sabit; return p.m(((hour % 24) + 24) % 24); }
  /** 24 saatlik kayıp enerjisi: Σ (P0 + Pk·K_h²)·1 sa. Yıllık = 365 gün; maliyet = enerji × birim fiyat. */
  function dailyLosses(o) {
    const Sr = num(o.Sr_kVA, 630), cos = clamp(num(o.cos, 1), 0.05, 1);
    const hours = []; let E = 0, Ecu = 0, Eload = 0;
    for (let h = 0; h < 24; h++) {
      const P = num(o.Ppeak_kW, 0) * profileMult(o.profile, h + 0.5);
      const K = P / cos / Sr;
      const loss = (o.energized === false ? 0 : num(o.P0, 0)) + num(o.Pk, 0) * K * K;
      hours.push({ h: h, K: K, P: P, loss: loss }); E += loss / 1000; Ecu += num(o.Pk, 0) * K * K / 1000; Eload += P;
    }
    return { hours: hours, Eday: E, Ecu: Ecu, E0: E - Ecu, Eload: Eload, Eyear: E * 365, costYear: E * 365 * num(o.price, 0), lossPct: Eload > 0 ? E / Eload * 100 : 0 };
  }

  /* ------------------------------------------------------------ soğutma */
  /** ONAF: fanlar çalışınca soğutma kapasitesi ff katına çıkar (ONAN/ONAF 100/125 % için ff = 1,25).
   * Yaklaşım: yağ ve sargı artışları K/ff yüklenmesine göre IEC 60076-7 ONAN bağıntısıyla hesaplanır. */
  function onafTemps(K, amb, th, ff) { return E.trafo.steadyTemps(K / Math.max(1, num(ff, 1)), amb, th); }
  /** Histerezisli fan kontrolü (örnek ayar): θ ≥ açma → çalış, θ ≤ kapama → dur. */
  function fanControl(on, theta, onT, offT) { return on ? theta > offT : theta >= onT; }
  /** Kuru tip (döküm reçine) sargı sıcak noktası, IEC 60076-12 yalıtım sınıfı sınırları: F 155 °C, H 180 °C.
   * Yaklaşım: θh = θa + ΔθH,r·K^1,6 · (fan varsa ff^−1,6); ΔθH,r = sınıf ortalama artışı × 1,1 (sıcak nokta katsayısı). */
  const DRY = { F: { rise: 100, limit: 155 }, H: { rise: 125, limit: 180 } };
  function dryTemps(K, amb, cls, ff) {
    const c = DRY[cls] || DRY.F;
    const dH = c.rise * 1.1 * Math.pow(Math.max(0, K) / Math.max(1, num(ff, 1)), 1.6);
    return { hotSpot: amb + dH, dTh: dH, topOil: amb, limit: c.limit };
  }

  /* ------------------------------------------------------------ koruma ön kontrolleri */
  /** Aşırı akım rölesi (50/51/50N/51N) için ön kontrol. Iref: AG 3F kısa devrenin OG'ye yansıyan akımı. */
  function relayCheck(o) {
    const I1n = num(o.I1n, 0), IkLVrefl = num(o.IkLV, 0) * num(o.U2, 400) / num(o.U1, 34500);
    const ipMin = 1.1 * I1n, ipMax = 1.6 * I1n, ihsMin = 1.3 * IkLVrefl;
    return {
      IkLVrefl: IkLVrefl, ipMin: ipMin, ipMax: ipMax, ihsMin: ihsMin,
      ipOk: o.Ip >= ipMin && o.Ip <= ipMax,
      ihsOk: o.Ihs >= ihsMin,
      ieOk: o.Ie > 0 && o.Ie < I1n
    };
  }
  const MV_FUSES = [6.3, 10, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200];
  /** OG HRC sigortası tipik seçim: en küçük standart değer ≥ 2·I1n (üretici seçim tablosu esastır). */
  function fuseSuggest(I1n) { return MV_FUSES.find(f => f >= 2 * I1n) || null; }
  /** AG ACB: Ir·In ≥ yük akımı, Ir·In ≤ 1,1·I2n (trafo koruması), Icu ≥ Ik. */
  function acbCheck(o) {
    const Ir = num(o.In, 0) * num(o.Ir, 1);
    return { Ir: Ir, loadOk: Ir >= num(o.I2, 0), trafoOk: Ir <= 1.1 * num(o.I2n, 0), icuOk: num(o.Icu_kA, 0) * 1000 >= num(o.Ik, 0) };
  }
  /** Paralel çalışma koşulları (IEC 60076-8 rehberi): aynı bağlantı grubu, oran farkı ≤ %0,5, uk farkı ≤ %10, güç oranı ≤ 3.
   * Yük paylaşımı Sa/Sb = (Sra/uka)/(Srb/ukb). */
  function parallelCheck(a, b, S_kVA) {
    const ya = a.Sr / a.uk, yb = b.Sr / b.uk;
    const Sa = S_kVA * ya / (ya + yb), Sb = S_kVA - Sa;
    const ukDiff = Math.abs(a.uk - b.uk) / Math.min(a.uk, b.uk) * 100;
    const pr = Math.max(a.Sr, b.Sr) / Math.min(a.Sr, b.Sr);
    return { vgOk: a.vg === b.vg, ratioOk: Math.abs(num(b.ratioDiff, 0)) <= 0.5, ukOk: ukDiff <= 10, powerOk: pr <= 3, ukDiff: ukDiff, Sa: Sa, Sb: Sb, Ka: Sa / a.Sr, Kb: Sb / b.Sr };
  }

  return { OPS: OPS, initialSw: initialSw, opLabel: opLabel, energized: energized, can: can, apply: apply, isSafe: isSafe, available: available, isolationSequence: isolationSequence, reenergizeSequence: reenergizeSequence,
    TAPS: TAPS, lvVoltage: lvVoltage, pfCorrection: pfCorrection, capNeeded: capNeeded, PROFILES: PROFILES, profileMult: profileMult, dailyLosses: dailyLosses,
    onafTemps: onafTemps, fanControl: fanControl, DRY: DRY, dryTemps: dryTemps, relayCheck: relayCheck, MV_FUSES: MV_FUSES, fuseSuggest: fuseSuggest, acbCheck: acbCheck, parallelCheck: parallelCheck };
});
