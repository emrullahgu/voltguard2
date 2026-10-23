/* VoltSim hesap motoru — DOM'a ve 3D'ye bağımlı değildir; tarayıcıda window.VoltSimEngine, Node'da require() ile yüklenir.
 * Her modülün compute(input) fonksiyonu { values, checks, warnings, errors, assumptions, formulas } döndürür.
 * checks[].status: 'ok' | 'warn' | 'fail' | 'info'. Kesin olmayan durumlar 'info'/'warn' ile ve açıklamasıyla verilir. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoltSimEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SQRT3 = Math.sqrt(3);
  const DEG = Math.PI / 180;
  const KAPPA_CU = 56;   // m/(Ω·mm²), 20 °C
  const KAPPA_AL = 35;
  const X_CABLE = 0.08e-3; // Ω/m, AG kablo reaktansı (tipik)

  /* ------------------------------------------------------------------ ortak yardımcılar */
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function round(v, d) { const k = Math.pow(10, d || 0); return Math.round(v * k) / k; }

  /** Girdi doğrulayıcı: sayıları sınırlarla kontrol eder, hataları biriktirir. */
  function Validator() { this.errors = []; this.warnings = []; }
  Validator.prototype.num = function (value, name, opt) {
    opt = opt || {};
    const v = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
    if (value === '' || value === null || value === undefined || !Number.isFinite(v)) {
      this.errors.push(name + ': geçerli bir sayı girin.');
      return opt.fallback !== undefined ? opt.fallback : 0;
    }
    if (opt.positive && v <= 0) { this.errors.push(name + ': sıfırdan büyük olmalı.'); return opt.fallback !== undefined ? opt.fallback : Math.abs(v) || 1; }
    if (opt.min !== undefined && v < opt.min) { this.errors.push(name + ': en az ' + opt.min + (opt.unit ? ' ' + opt.unit : '') + ' olmalı.'); return opt.min; }
    if (opt.max !== undefined && v > opt.max) { this.errors.push(name + ': en çok ' + opt.max + (opt.unit ? ' ' + opt.unit : '') + ' olmalı.'); return opt.max; }
    return v;
  };
  Validator.prototype.oneOf = function (value, name, list) {
    if (list.indexOf(value) < 0) { this.errors.push(name + ': geçersiz seçim.'); return list[0]; }
    return value;
  };

  function result(v, values, checks, extra) {
    return Object.assign({ values: values, checks: checks || [], errors: v.errors, warnings: v.warnings, ok: v.errors.length === 0 }, extra || {});
  }
  /** Kontrol metinlerinde ondalık ayırıcı Türkçe (virgül) yazılır. */
  const trDec = s => String(s || '').replace(/(\d)\.(\d)/g, '$1,$2');
  function check(id, label, status, detail, ref) { return { id: id, label: trDec(label), status: status, detail: trDec(detail), ref: ref || null }; }

  /* Karmaşık sayı yardımcıları (fazör hesapları) */
  const C = {
    of: (re, im) => ({ re: re, im: im || 0 }),
    polar: (m, a) => ({ re: m * Math.cos(a), im: m * Math.sin(a) }),
    add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
    sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
    mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
    div: (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; },
    abs: a => Math.hypot(a.re, a.im),
    scale: (a, k) => ({ re: a.re * k, im: a.im * k })
  };

  /* ------------------------------------------------------------------ temel elektrik bağıntıları */
  /** Dengeli, sinüzoidal 3 faz: I = P / (√3·U_LL·cosφ) */
  function threePhaseCurrent(P_W, U_LL, cosphi) { return P_W / (SQRT3 * U_LL * cosphi); }
  /** I = S / (√3·U_LL) */
  function currentFromS(S_VA, U_LL) { return S_VA / (SQRT3 * U_LL); }
  function singlePhaseCurrent(P_W, U_ph, cosphi) { return P_W / (U_ph * cosphi); }
  function powerTriangle(P, cosphi) {
    const phi = Math.acos(clamp(cosphi, 0.01, 1));
    const Q = P * Math.tan(phi);
    return { P: P, Q: Q, S: Math.hypot(P, Q), phi: phi };
  }

  /* ------------------------------------------------------------------ kablo akım taşıma (TS HD 60364-5-52)
   * Bakır, PVC yalıtım (70 °C), ortam 30 °C, gruplama/ortam düzeltmesi yok. [2 yüklü iletken, 3 yüklü iletken] */
  const IZ_TABLE = {
    A1: { 1.5: [14.5, 13.5], 2.5: [19.5, 18], 4: [26, 24], 6: [34, 31], 10: [46, 42], 16: [61, 56], 25: [80, 73], 35: [99, 89], 50: [119, 108], 70: [151, 136], 95: [182, 164], 120: [210, 188] },
    B1: { 1.5: [17.5, 15.5], 2.5: [24, 21], 4: [32, 28], 6: [41, 36], 10: [57, 50], 16: [76, 68], 25: [101, 89], 35: [125, 110], 50: [151, 134], 70: [192, 171], 95: [232, 207], 120: [269, 239] },
    C: { 1.5: [19.5, 17.5], 2.5: [27, 24], 4: [36, 32], 6: [46, 41], 10: [63, 57], 16: [85, 76], 25: [112, 96], 35: [138, 119], 50: [168, 144], 70: [213, 184], 95: [258, 223], 120: [299, 259] },
    E: { 1.5: [22, 18.5], 2.5: [30, 25], 4: [40, 34], 6: [51, 43], 10: [70, 60], 16: [94, 80], 25: [119, 101], 35: [148, 126], 50: [180, 153], 70: [232, 196], 95: [282, 238], 120: [328, 276], 150: [379, 319], 185: [434, 364], 240: [514, 430] }
  };
  const CABLE_SIZES = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240];
  const INSTALL_METHODS = { A1: 'A1 · yalıtımlı duvarda boru içinde', B1: 'B1 · duvar üstü/içi boru veya kanal', C: 'C · duvara kroşeli', E: 'E · havada delikli kablo tavası' };
  function cableIz(S, method, loadedConductors, parallel) {
    const row = (IZ_TABLE[method] || IZ_TABLE.B1)[S];
    if (!row) return NaN;
    return row[loadedConductors >= 3 ? 1 : 0] * (parallel || 1);
  }

  /* ------------------------------------------------------------------ koruma cihazları */
  const MCB_MAG = { B: [3, 5], C: [5, 10], D: [10, 20] };
  /** TS EN 60898-1 / TS EN 60947-2 sınırlarına göre açma değerlendirmesi. Üretici eğrisi olmadan süre uydurmaz. */
  function breakerAssessment(device, I) {
    const In = device.In;
    if (device.kind === 'FUSE') return fuseAssessment(In, I);
    const r = I / In;
    if (device.kind === 'MCB') {
      const m = MCB_MAG[device.curve] || MCB_MAG.C;
      if (r >= m[1]) return { state: 'magnetic', trips: true, text: 'Manyetik (anlık) açma bölgesi: ≥ ' + m[1] + '·In. Standart, 0,1 s içinde açmayı öngörür.' };
      if (r > m[0]) return { state: 'magnetic-band', trips: null, text: 'Manyetik açma bandı (> ' + m[0] + '·In, ≤ ' + m[1] + '·In): anlık açabilir; kesin davranış cihaza bağlı.' };
      if (r >= 1.45) return { state: 'thermal', trips: true, text: 'Termik açma: 1,45·In’de cihaz konvansiyonel sürede (In ≤ 63 A: 1 saat, In > 63 A: 2 saat) açmalıdır. Kesin süre üretici eğrisine bağlıdır.' };
      if (r > 1.13) return { state: 'thermal-band', trips: null, text: '1,13–1,45·In belirsiz bölge: açma garanti edilmez.' };
      return { state: 'normal', trips: false, text: 'Anma akımı sınırında; açma beklenmez.' };
    }
    // MCCB/ACB (TS EN 60947-2): ayarlı Ir ve Ii
    const Ir = device.Ir || In, Ii = device.Ii || 10 * Ir;
    if (I >= Ii) return { state: 'magnetic', trips: true, text: 'Ani açma ayarı (Ii = ' + round(Ii, 0) + ' A) aşıldı: anlık açma.' };
    if (I >= 1.3 * Ir) return { state: 'thermal', trips: true, text: 'Uzun gecikmeli koruma: 1,30·Ir üzerinde konvansiyonel sürede açmalıdır. Süre ayar ve eğriye bağlıdır.' };
    if (I > 1.05 * Ir) return { state: 'thermal-band', trips: null, text: '1,05–1,30·Ir belirsiz bölge: açma garanti edilmez.' };
    return { state: 'normal', trips: false, text: 'Ayar akımı sınırında; açma beklenmez.' };
  }
  /** gG sigorta bağlantı (NH) kapı değerleri, IEC 60269-2: In → [Imin(10 s), Imax(5 s), Imin(0,1 s), Imax(0,1 s)] (A).
   * Imax(t): bu akımda sigorta en geç t sürede erir; Imin(t): bu akımın altında t süreden önce erimez. */
  const FUSE_GATES = {
    16: [33, 65, 85, 150], 20: [42, 85, 110, 200], 25: [52, 110, 150, 260], 32: [75, 150, 200, 350], 40: [95, 190, 260, 450],
    50: [125, 250, 350, 610], 63: [160, 320, 450, 820], 80: [215, 425, 610, 1100], 100: [290, 580, 820, 1450], 125: [355, 715, 1100, 1910],
    160: [460, 950, 1450, 2590], 200: [610, 1250, 1910, 3420], 250: [750, 1650, 2590, 4500], 315: [1050, 2200, 3420, 6000],
    400: [1420, 2840, 4500, 8060], 500: [1780, 3800, 6000, 10600], 630: [2200, 5100, 8060, 14140]
  };
  const FUSE_SIZES = Object.keys(FUSE_GATES).map(Number);
  /** gG konvansiyonel süre (IEC 60269-1): In ≤ 63 A: 1 sa, ≤ 160 A: 2 sa, ≤ 400 A: 3 sa, üstü 4 sa. */
  function fuseConvTime(In) { return In <= 63 ? 3600 : In <= 160 ? 7200 : In <= 400 ? 10800 : 14400; }
  /** gG konvansiyonel erime akımı If (I2): In ≥ 16 A için 1,6·In. */
  function fuseI2(In) { return (In >= 16 ? 1.6 : 1.9) * In; }
  function fuseAssessment(In, I) {
    const g = FUSE_GATES[In];
    if (!g) return { state: 'unknown', trips: null, text: 'Bu anma akımı için gG kapı değeri tabloda yok.' };
    if (I >= g[3]) return { state: 'magnetic', trips: true, text: 'Imax(0,1 s) = ' + g[3] + ' A aşıldı: sigorta 0,1 s içinde erir (IEC 60269-2 gG kapısı).' };
    if (I >= g[1]) return { state: 'thermal', trips: true, text: 'Imax(5 s) = ' + g[1] + ' A aşıldı: sigorta en geç 5 s içinde erir.' };
    if (I >= fuseI2(In)) return { state: 'thermal', trips: true, text: 'Konvansiyonel erime akımı (1,6·In) aşıldı: ' + fuseConvTime(In) / 3600 + ' saat içinde erir; kesin süre üretici eğrisine bağlı.' };
    if (I > 1.25 * In) return { state: 'thermal-band', trips: null, text: '1,25–1,6·In belirsiz bölge: erime garanti edilmez.' };
    return { state: 'normal', trips: false, text: 'Anma akımı sınırında; erime beklenmez.' };
  }

  /** TS EN 61008/61009, sinüzoidal AC kaçak akım: IΔ ≥ IΔn açar; ½IΔn–IΔn açabilir; < ½IΔn açmaz.
   * Darbeli/düz DC kaçak akımlarda (Tip A/B) bantlar farklıdır; burada modellenmez. */
  function rcdAssessment(IdeltaN_mA, leak_mA) {
    if (!IdeltaN_mA) return { state: 'none', trips: false, text: 'Kaçak akım koruması yok.' };
    if (leak_mA >= IdeltaN_mA) return { state: 'trip', trips: true, text: 'Kaçak akım IΔn değerine ulaştı: cihaz açmalıdır (genel tip, IΔn’de ≤ 300 ms).' };
    if (leak_mA >= IdeltaN_mA / 2) return { state: 'band', trips: null, text: '½·IΔn–IΔn arası (sinüzoidal AC): cihaz açabilir de açmayabilir de.' };
    return { state: 'normal', trips: false, text: '½·IΔn altında: açma beklenmez.' };
  }

  /* ------------------------------------------------------------------ IEC 60909 yaklaşımıyla AG kısa devre */
  /** Kaynak (OG şebeke + trafo) empedansını AG tarafına indirgenmiş olarak verir (Ω). */
  function sourceImpedance(o) {
    const Un = o.U_LL, c = 1.05;
    const ZQ = o.SkQ_MVA > 0 ? c * Un * Un / (o.SkQ_MVA * 1e6) : 0;
    const XQ = 0.995 * ZQ, RQ = 0.1 * XQ;
    const Sr = o.Sr_kVA * 1e3;
    const ZT = (o.uk_pct / 100) * Un * Un / Sr;
    const RT = (o.Pk_W || 0) * Un * Un / (Sr * Sr);
    const XT = Math.sqrt(Math.max(ZT * ZT - RT * RT, 0));
    return { R: RQ + RT, X: XQ + XT, ZQ: ZQ, ZT: ZT, RT: RT, XT: XT, RQ: RQ, XQ: XQ };
  }
  function cableImpedance(L, S, n, material) {
    const kappa = material === 'Al' ? KAPPA_AL : KAPPA_CU;
    return { R: L / (kappa * S * (n || 1)), X: X_CABLE * L / (n || 1) };
  }
  /** Üç fazlı simetrik kısa devre: Ik3 = c·Un / (√3·|Zk|), ip = κ·√2·Ik3 */
  function shortCircuit3(U_LL, R, X, cmax) {
    const c = cmax || 1.05;
    const Z = Math.hypot(R, X);
    const Ik = c * U_LL / (SQRT3 * Z);
    const kappa = 1.02 + 0.98 * Math.exp(-3 * R / Math.max(X, 1e-9));
    return { Ik: Ik, ip: kappa * Math.SQRT2 * Ik, kappa: kappa, Z: Z };
  }
  /** Faz-PE çevrimi üzerinden yaklaşık en küçük tek faz arıza akımı (TN).
   * Kaynak çevrim empedansı (2·Z1 + Z0)/3; Dyn trafoda Z0 ≈ ZT (OG şebekesi sıfır bileşende görünmez).
   * series: kaynaktan arıza noktasına seri kablo empedansı (tek iletken); faz + PE aynı kesitte → 2·Z. */
  function shortCircuit1Min(U_LL, src, series) {
    const U0 = U_LL / SQRT3, cmin = 0.95, kT = 1.24; // kT: iletkenin arıza sonu sıcaklığında direnç artışı (yaklaşık)
    const Rs = (2 * (src.RQ + src.RT) + src.RT) / 3, Xs = (2 * (src.XQ + src.XT) + src.XT) / 3;
    const R = Rs + 2 * series.R * kT, X = Xs + 2 * series.X;
    return cmin * U0 / Math.hypot(R, X);
  }
  /** AG jeneratör kaynağı (IEC 60909: RG ≈ 0,15·X''d, UrG ≤ 1 kV). */
  function generatorImpedance(U_LL, S_kVA, xd_pct) {
    const X = xd_pct / 100 * U_LL * U_LL / (S_kVA * 1e3);
    return { R: 0.15 * X, X: X, RQ: 0, XQ: 0, RT: 0.15 * X, XT: X, ZT: Math.hypot(0.15 * X, X), ZQ: 0 };
  }

  /* ================================================================== PANO */
  const pano = (function () {
    const PANEL_TYPES = {
      ADP: 'Ana dağıtım panosu (ADP)', MCC: 'Motor kontrol panosu (MCC)', KOMP: 'Kompanzasyon panosu',
      OTOM: 'Otomasyon panosu', TRANSFER: 'Transfer (ATS) panosu'
    };
    const BUSBARS = [250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200];

    /** Bir devrenin akımını, fazörünü ve güçlerini hesaplar. Kapalı (on=false) veya duran motor katkı vermez.
     * Kondansatör kademesi (cap): P_kW alanı kVAr anlamındadır; akım gerilimden 90° ileridedir. */
    function circuitFlow(c, U_LL) {
      if (c.shunt) {
        // şönt reaktör: P_kW alanı kVAr; endüktif, kayıp ≈ %1 (tipik, demir + bakır)
        const on = c.on && !c.tripped, Qr = c.P_kW * 1e3;
        const Q = on ? Qr : 0, P = on ? 0.01 * Qr : 0, S = Math.hypot(P, Q);
        return { active: on, P: P, Q: Q, S: S, I: on ? S / (SQRT3 * U_LL) : 0, phi: Math.atan2(Q, P || 1e-9), Pel_kW: 0, Qc: Qr };
      }
      if (c.cap) {
        const on = c.on && !c.tripped;
        const Qc = c.P_kW * 1e3;
        // kondansatör + kontaktör kayıpları ~3 W/kVAr; ayarlı (filtreli) kademede reaktör kaybıyla ~6 W/kVAr (tipik)
        const Q = on ? -Qc : 0, P = on ? (c.detune > 0 ? 0.006 : 0.003) * Qc : 0;
        const S = Math.hypot(P, Q);
        return { active: on, P: P, Q: Q, S: S, I: on ? S / (SQRT3 * U_LL) : 0, phi: Math.atan2(Q, P || 1e-9), Pel_kW: 0, Qc: Qc };
      }
      const active = c.on && !c.tripped && (!c.motor || c.running);
      const Pel = c.motor ? c.P_kW / (c.eff || 1) : c.P_kW; // motorlarda P_kW mil gücüdür
      const pt = powerTriangle(active ? Pel * 1e3 : 0, c.cos);
      let I = 0;
      if (active) I = c.phase === '3F' ? threePhaseCurrent(pt.P, U_LL, c.cos) : singlePhaseCurrent(pt.P, U_LL / SQRT3, c.cos);
      return { active: active, P: pt.P, Q: pt.Q, S: pt.S, I: I, phi: pt.phi, Pel_kW: Pel };
    }

    /** Faz akımlarını fazör toplamı ile verir (dengesiz yükleri doğru toplar). Nötr akımı 1F yüklerin fazör toplamıdır. */
    function phaseCurrents(circuits, flows) {
      const ang = { L1: 0, L2: -120 * DEG, L3: 120 * DEG };
      const ph = { L1: C.of(0), L2: C.of(0), L3: C.of(0) };
      let N = C.of(0);
      circuits.forEach((c, i) => {
        const f = flows[i];
        if (!f.active || f.I <= 0) return;
        if (c.phase === '3F') ['L1', 'L2', 'L3'].forEach(p => { ph[p] = C.add(ph[p], C.polar(f.I, ang[p] - f.phi)); });
        else { const phasor = C.polar(f.I, ang[c.phase] - f.phi); ph[c.phase] = C.add(ph[c.phase], phasor); N = C.add(N, phasor); }
      });
      return { L1: C.abs(ph.L1), L2: C.abs(ph.L2), L3: C.abs(ph.L3), N: C.abs(N) };
    }

    function voltageDrop(c, I, U_LL) {
      const cab = cableImpedance(c.L, c.S, c.parallel || 1, c.material);
      const sin = Math.sin(Math.acos(clamp(c.cos, 0.01, 1)));
      if (c.phase === '3F') { const dU = SQRT3 * I * (cab.R * c.cos + cab.X * sin); return { dU: dU, pct: dU / U_LL * 100 }; }
      const dU = 2 * I * (cab.R * c.cos + cab.X * sin); return { dU: dU, pct: dU / (U_LL / SQRT3) * 100 };
    }

    function compute(input) {
      const v = new Validator();
      const U_LL = v.num(input.U_LL, 'Besleme gerilimi', { min: 200, max: 1000, unit: 'V' });
      const mainIn = v.num(input.mainIn, 'Ana şalter anma akımı', { min: 16, max: 6300, unit: 'A' });
      // ayarlanabilir uzun gecikmeli koruma Ir (A) ve ani açma Ii (×Ir); girilmezse Ir = In, Ii = 10·Ir
      const mainIr = input.mainIrF === undefined ? mainIn : mainIn * v.num(input.mainIrF, 'Ana şalter Ir ayarı', { min: 0.4, max: 1, unit: '×In' });
      const mainIi = mainIr * (input.mainIiF === undefined ? 10 : v.num(input.mainIiF, 'Ana şalter Ii ayarı', { min: 1.5, max: 15, unit: '×Ir' }));
      const busbar = v.num(input.busbarIn, 'Bara anma akımı', { min: 63, max: 6300, unit: 'A' });
      const Icu = v.num(input.mainIcu_kA, 'Ana şalter kesme kapasitesi', { min: 3, max: 150, unit: 'kA' });
      const useGen = input.source === 'gen';
      const genKVA = useGen ? v.num(input.gen_kVA, 'Jeneratör gücü', { min: 10, max: 5000, unit: 'kVA' }) : 0;
      // jeneratörün kalıcı kısa devre akımı (uyarma sistemine bağlı; AREP/PMG'de tipik ~3·In, kendinden uyartımlıda çok daha düşük)
      const genSust = useGen ? v.num(input.gen_sust === undefined ? 3 : input.gen_sust, 'Jeneratör kalıcı kısa devre akımı', { min: 0.5, max: 6, unit: '×In' }) : 0;
      const Igen = useGen ? currentFromS(genKVA * 1e3, v.num(input.U_LL, 'Gerilim', { min: 200, max: 1000 })) : 0;
      const src = useGen ? generatorImpedance(U_LL, genKVA, v.num(input.gen_xd, "Jeneratör X''d", { min: 5, max: 30, unit: '%' })) : sourceImpedance({
        U_LL: U_LL,
        SkQ_MVA: v.num(input.SkQ_MVA, 'OG şebeke kısa devre gücü', { min: 0, max: 5000, unit: 'MVA' }),
        Sr_kVA: v.num(input.trafo_kVA, 'Besleyen trafo gücü', { min: 25, max: 5000, unit: 'kVA' }),
        uk_pct: v.num(input.trafo_uk, 'Trafo uk', { min: 2, max: 12, unit: '%' }),
        Pk_W: v.num(input.trafo_Pk, 'Trafo yük kaybı', { min: 0, max: 50000, unit: 'W' })
      });
      const feed = cableImpedance(v.num(input.feedL, 'Besleme kablosu uzunluğu', { min: 0, max: 500, unit: 'm' }),
        v.num(input.feedS, 'Besleme kablo kesiti', { min: 1.5, max: 630, unit: 'mm²' }), v.num(input.feedN, 'Paralel kablo', { min: 1, max: 12 }), 'Cu');
      const busR = src.R + feed.R, busX = src.X + feed.X;
      const sc = shortCircuit3(U_LL, busR, busX);

      const circuits = (input.circuits || []).map((c, i) => {
        const n = 'Devre ' + (i + 1) + ' (' + (c.name || '') + ')';
        return Object.assign({}, c, {
          P_kW: v.num(c.P_kW, n + ' gücü', { min: 0, max: 2000, unit: 'kW' }),
          cos: v.num(c.cos, n + ' cosφ', { min: 0.1, max: 1 }),
          eff: c.motor ? v.num(c.eff, n + ' verim', { min: 0.3, max: 1 }) : 1,
          L: v.num(c.L, n + ' kablo boyu', { min: 0, max: 1000, unit: 'm' }),
          S: v.num(c.S, n + ' kesit', { min: 1.5, max: 120, unit: 'mm²' }),
          In: v.num(c.In, n + ' koruma In', { min: 2, max: 1600, unit: 'A' }),
          phase: v.oneOf(c.phase, n + ' faz', ['L1', 'L2', 'L3', '3F'])
        });
      });
      const flows = circuits.map(c => circuitFlow(c, U_LL));
      const phases = phaseCurrents(circuits, flows);
      let P = 0, Q = 0;
      flows.forEach(f => { P += f.P; Q += f.Q; });
      const S = Math.hypot(P, Q);
      const pf = S > 0 ? P / S : 1;
      const Imax = Math.max(phases.L1, phases.L2, phases.L3);
      const Iavg = (phases.L1 + phases.L2 + phases.L3) / 3;
      const unbalance = Iavg > 0.5 ? (Imax - Iavg) / Iavg * 100 : 0;
      const loading = Imax / mainIr * 100;

      const checks = [];
      // besleme kablosundaki düşüm (en yüklü faz akımıyla, 3F)
      const sinT = S > 0 ? Math.abs(Q) / S : 0;
      const feedVd = SQRT3 * Imax * (feed.R * pf + feed.X * sinT) / U_LL * 100;
      const perCircuit = circuits.map((c, i) => {
        const f = flows[i];
        // tasarım akımı (devre açıkken de kontrol edilir): devre çalışırsa çekeceği akım
        // kondansatörde koruma/kablo 1,43·Ic ile boyutlandırılır (harmonik ve tolerans payı)
        const Ib = c.cap || c.shunt ? (c.cap ? 1.43 : 1.1) * f.Qc / (SQRT3 * U_LL) : c.phase === '3F' ? threePhaseCurrent(f.Pel_kW * 1e3, U_LL, c.cos) : singlePhaseCurrent(f.Pel_kW * 1e3, U_LL / SQRT3, c.cos);
        const Iz = cableIz(c.S, c.method || 'B1', c.phase === '3F' ? 3 : 2, c.parallel || 1);
        const I2 = c.kind === 'FUSE' ? fuseI2(c.In) : (c.kind === 'MCB' ? 1.45 : 1.3) * c.In;
        const vd = voltageDrop(c, c.cap ? Ib / 1.43 : c.shunt ? Ib / 1.1 : Ib, U_LL);
        const vdLimit = c.motor ? 3 : 1.5;
        const cab = cableImpedance(c.L, c.S, c.parallel || 1, c.material);
        // jeneratörde 0,4 s kesme süresi boyunca alt-geçici akım sönümlenir: kalıcı akımla sınırla
        const Ik1sub = shortCircuit1Min(U_LL, src, { R: feed.R + cab.R, X: feed.X + cab.X });
        const Ik1 = useGen ? Math.min(Ik1sub, genSust * Igen) : Ik1sub;
        // gerekli kesme süresi (TS HD 60364-4-41, TN 230 V): son devre ≤ 32 A → 0,4 s; dağıtım ve > 32 A → 5 s
        const tReq = c.In <= 32 ? 0.4 : 5;
        const g = FUSE_GATES[c.In];
        const Ia = c.kind === 'FUSE' ? (g ? (tReq === 0.4 ? g[3] : g[1]) : Infinity) : c.kind === 'MCB' ? (MCB_MAG[c.curve] || MCB_MAG.C)[1] * c.In : (c.Ii || 10 * c.In);
        const startI = c.motor ? Ib * (c.start === 'YD' ? (c.IstIn || 6.5) / 3 : c.start === 'VFD' ? 1.0 : c.start === 'SOFT' ? 3 : (c.IstIn || 6.5)) : 0;
        const coord = Ib <= c.In && c.In <= Iz && I2 <= 1.45 * Iz;
        const ass = breakerAssessment({ kind: c.kind || 'MCB', curve: c.curve, In: c.In, Ir: c.In, Ii: c.Ii }, f.I);
        return { Ib: Ib, I: f.I, active: f.active, P: f.P, Q: f.Q, Iz: Iz, I2: I2, coord: coord, vd: vd.pct, vdLimit: vdLimit, Ik1: Ik1, Ia: Ia, tReq: tReq, disconnectOK: Ik1 >= Ia, startI: startI, assessment: ass, loadPct: c.In > 0 ? f.I / c.In * 100 : 0 };
      });

      perCircuit.forEach((r, i) => {
        const c = circuits[i], nm = c.name || ('Devre ' + (i + 1));
        if (!isFinite(r.Iz)) checks.push(check('iz' + i, nm + ': kesit tablosu', 'warn', 'Seçilen kesit için akım taşıma değeri tabloda yok.', 'TS HD 60364-5-52'));
        else checks.push(check('coord' + i, nm + ': Ib ≤ In ≤ Iz, I2 ≤ 1,45·Iz', r.coord ? 'ok' : 'fail',
          'Ib ' + round(r.Ib, 1) + ' A · In ' + c.In + ' A · Iz ' + round(r.Iz, 1) + ' A · I2 ' + round(r.I2, 1) + ' A', 'TS HD 60364-4-43 / 5-52'));
        checks.push(check('vd' + i, nm + ': gerilim düşümü', r.vd + feedVd <= r.vdLimit ? 'ok' : 'warn',
          'Devre %' + round(r.vd, 2) + ' + besleme %' + round(feedVd, 2) + ' = %' + round(r.vd + feedVd, 2) + ' (sınır %' + r.vdLimit + '; pano yapı bağlantı kutusu kabul edildi)', 'EİTY Madde 57'));
        checks.push(check('ad' + i, nm + ': hat sonu arızada otomatik kesme', r.disconnectOK ? 'ok' : 'fail',
          'Ik1,min ≈ ' + round(r.Ik1, 0) + ' A, ' + r.tReq + ' s içinde kesme için gereken Ia = ' + round(r.Ia, 0) + ' A' + (c.kind === 'FUSE' ? ' (gG kapısı ' + (r.tReq === 0.4 ? 'Imax 0,1 s, güvenli tarafta' : 'Imax 5 s') + ')' : ''), 'TS HD 60364-4-41'));
      });
      checks.push(check('main', 'Ana şalter yüklenmesi (Ir ayarına göre)', loading <= 80 ? 'ok' : loading <= 100 ? 'warn' : 'fail', 'En yüklü faz ' + round(Imax, 1) + ' A / Ir ' + round(mainIr, 0) + ' A (%' + round(loading, 0) + ')'));
      checks.push(check('bus', 'Bara ≥ ana şalter', busbar >= mainIn ? 'ok' : 'fail', 'Bara ' + busbar + ' A, ana şalter ' + mainIn + ' A', 'TS EN IEC 61439-1'));
      checks.push(check('icu', 'Kesme kapasitesi ≥ Ik3', Icu * 1e3 >= sc.Ik ? 'ok' : 'fail', 'Icu ' + Icu + ' kA, Ik3 ≈ ' + round(sc.Ik / 1e3, 2) + ' kA (yaklaşık)', 'IEC 60909-0 yaklaşımı'));
      if (useGen) checks.push(check('gen', 'Jeneratör yüklenmesi', S / 1e3 <= 0.8 * genKVA ? 'ok' : S / 1e3 <= genKVA ? 'warn' : 'fail', round(S / 1e3, 1) + ' kVA / ' + genKVA + ' kVA. Jeneratörde kısa devre akımı şebekeye göre çok düşüktür; otomatik kesme koşulunu ayrıca kontrol edin.', 'ISO 8528'));
      checks.push(check('unb', 'Faz dengesizliği', unbalance <= 10 ? 'ok' : unbalance <= 20 ? 'warn' : 'fail', '%' + round(unbalance, 1) + ' (en yüklü fazın ortalamadan sapması)'));
      if (phases.N > 0.5 * Imax && Imax > 1) checks.push(check('neu', 'Nötr akımı', 'warn', 'Nötr akımı ' + round(phases.N, 1) + ' A. Harmonikli yüklerde nötr ayrıca artabilir.'));

      return result(v, {
        U_LL: U_LL, P: P, Q: Q, S: S, pf: pf, phases: phases, Imax: Imax, unbalance: unbalance, loading: loading,
        Ik3: sc.Ik, ip: sc.ip, kappa: sc.kappa, Zk: sc.Z, circuits: perCircuit, mainIn: mainIn, mainIr: mainIr, mainIi: mainIi,
        balancedI: S > 0 ? currentFromS(S, U_LL) : 0, source: useGen ? 'gen' : 'grid', genKVA: genKVA, Isrc: src
      }, checks, {
        assumptions: [
          'Sinüzoidal, 50 Hz; faz akımları fazör toplamıyla hesaplanır (dengesiz yükler doğru toplanır). P = √3·U·I·cosφ yalnızca dengeli devrelerde kullanılır.',
          'Harmonikler dahil değildir; harmonikli yüklerde gerçek RMS ve nötr akımı daha yüksek olabilir.',
          'Iz: bakır PVC, 30 °C, gruplama düzeltmesi yok (TS HD 60364-5-52).',
          'Gerilim düşümü sınırı EİTY Madde 57: yapı bağlantı kutusundan tüketiciye aydınlatma/priz %1,5, motor %3 (pano yapı bağlantı kutusu kabul edilir). Kendi trafosu olan tesiste trafo ile bağlantı kutusu arası ayrıca %5.',
          'Kısa devre: IEC 60909 yöntemi basitleştirilmiş; c = 1,05; KT düzeltmesi, motor katkısı ve ark direnci ihmal. Sonuç yaklaşıktır.',
          'Jeneratör beslemesinde otomatik kesme kontrolü, alt-geçici akım ile jeneratörün kalıcı kısa devre akımının (girdi, ×In) küçüğüyle yapılır; değer üretici verisinden alınmalıdır.',
          'Gerilim düşümü κ = 56 m/Ω·mm² (20 °C) ve X = 0,08 mΩ/m ile; besleme kablosunda en yüklü faz akımı kullanılır.',
          'gG sigortalarda IEC 60269-2 kapı değerleri kullanılır; 0,4 s kesme için Imax(0,1 s) kapısı alınır (güvenli tarafta). Üretici eğrisi esastır.',
          'Bu kontroller pano tasarım doğrulaması (TS EN IEC 61439-1 Madde 10) yerine geçmez.'
        ],
        formulas: ['I = P / (√3·U_LL·cosφ) (dengeli 3F)', 'I = P / (U_0·cosφ) (1F)', 'Q = P·tanφ, S = √(P² + Q²)', 'ΔU = √3·I·L·(R·cosφ + X·sinφ)', 'Ik3 = c·Un / (√3·|Zk|)', 'ip = κ·√2·Ik3, κ = 1,02 + 0,98·e^(−3R/X)']
      });
    }

    function motorStartCurrent(Ib, method, IstIn, t, tStart) {
      // Temsili yol alma akım zarfı (görselleştirme): t = 0 anında başlangıç akımı, tStart sonunda Ib.
      const k = method === 'YD' ? IstIn / 3 : method === 'VFD' ? 1.0 : method === 'SOFT' ? 3 : IstIn;
      if (t >= tStart) return Ib;
      return Ib * (k - (k - 1) * Math.pow(t / tStart, 3));
    }

    return { compute: compute, circuitFlow: circuitFlow, phaseCurrents: phaseCurrents, voltageDrop: voltageDrop, motorStartCurrent: motorStartCurrent, PANEL_TYPES: PANEL_TYPES, BUSBARS: BUSBARS };
  })();

  /* ================================================================== GES */
  const ges = (function () {
    const CITIES = {
      'İstanbul': [41.01, 28.98], 'Ankara': [39.93, 32.86], 'İzmir': [38.42, 27.14], 'Bursa': [40.19, 29.06], 'Antalya': [36.90, 30.70],
      'Adana': [37.00, 35.32], 'Konya': [37.87, 32.48], 'Gaziantep': [37.07, 37.38], 'Kayseri': [38.73, 35.49], 'Mersin': [36.80, 34.63],
      'Diyarbakır': [37.91, 40.23], 'Samsun': [41.29, 36.33], 'Erzurum': [39.90, 41.27], 'Trabzon': [41.00, 39.72], 'Eskişehir': [39.78, 30.52],
      'Denizli': [37.78, 29.09], 'Manisa': [38.61, 27.43], 'Şanlıurfa': [37.16, 38.79], 'Van': [38.49, 43.38], 'Kocaeli': [40.77, 29.92],
      'Muğla': [37.22, 28.36], 'Aydın': [37.85, 27.85], 'Tekirdağ': [40.98, 27.51], 'Malatya': [38.35, 38.31]
    };
    const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const MONTH_MID = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344]; // Klein'in temsilî günleri
    const PROFILES = {
      tek: { name: 'Fabrika · tek vardiya (08–18, hafta içi)', w: h => (h >= 8 && h < 18 ? 1 : 0.15), weekdays: 5 / 7 },
      uc: { name: 'Fabrika · 3 vardiya (7/24)', w: () => 1, weekdays: 1 },
      ofis: { name: 'Ofis / ticari (08–19)', w: h => (h >= 8 && h < 19 ? 1 : 0.2), weekdays: 5 / 7 },
      konut: { name: 'Konut (akşam ağırlıklı)', w: h => (h >= 18 && h < 23 ? 1.6 : h >= 7 && h < 9 ? 1.1 : h >= 0 && h < 6 ? 0.35 : 0.7), weekdays: 1 }
    };

    /** Güneş konumu (Spencer deklinasyonu ve zaman denklemi). hour: yerel saat (UTC+tz). */
    function sunPosition(lat, lon, doy, hour, tz) {
      const g = 2 * Math.PI / 365 * (doy - 1 + (hour - 12) / 24);
      const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
      const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
      const tst = hour * 60 + eot + 4 * lon - 60 * (tz === undefined ? 3 : tz);
      const ha = (tst / 4 - 180) * DEG;
      const phi = lat * DEG;
      const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
      const zen = Math.acos(clamp(cosZ, -1, 1));
      // azimut: güneyden, batı pozitif
      const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
      return { elevation: 90 - zen / DEG, zenith: zen / DEG, azimuth: az / DEG, declination: decl / DEG, solarTime: tst / 60 };
    }

    /** Açık gök ışınımı: direkt normal (Meinel, Kasten–Young hava kütlesi), yaygın ≈ %10·DNI. */
    function clearSky(elevation) {
      if (elevation <= 0) return { DNI: 0, DHI: 0, GHI: 0 };
      const z = 90 - elevation;
      const AM = 1 / (Math.cos(z * DEG) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
      const DNI = 1353 * Math.pow(0.7, Math.pow(AM, 0.678));
      const DHI = 0.1 * DNI;
      return { DNI: DNI, DHI: DHI, GHI: DNI * Math.sin(elevation * DEG) + DHI, AM: AM };
    }

    function incidenceCos(sun, tilt, surfAz) {
      const z = sun.zenith * DEG, b = tilt * DEG;
      return Math.cos(z) * Math.cos(b) + Math.sin(z) * Math.sin(b) * Math.cos((sun.azimuth - surfAz) * DEG);
    }

    /** Sıra arası gölge (eğik sıralar, düz çatı): arka sıradaki gölgeli uzunluk oranı. */
    function rowShading(tilt, moduleLen, pitch, sun, surfAz) {
      if (sun.elevation <= 0) return 1;
      const b = tilt * DEG;
      const H = moduleLen * Math.sin(b), D = moduleLen * Math.cos(b);
      const cosD = Math.cos((sun.azimuth - surfAz) * DEG);
      if (cosD <= 0 || H <= 0) return 0;
      const tanA = Math.tan(sun.elevation * DEG) / cosD;
      const x = (H + D * tanA + pitch * Math.tan(b)) / (tanA + Math.tan(b));
      return clamp((x - pitch) / D, 0, 1);
    }

    /** Bulut etkisi (Kasten–Czeplak): G = Gcs·(1 − 0,75·N^3,4), N: bulutluluk 0–1. */
    function cloudFactor(N) { return 1 - 0.75 * Math.pow(clamp(N, 0, 1), 3.4); }

    function plane(sun, tilt, surfAz, albedo, cloud) {
      const cs = clearSky(sun.elevation);
      const k = cloudFactor(cloud);
      const DNI = cs.DNI * k, DHI = cs.DHI + cs.DNI * (1 - k) * 0.3 * Math.sin(Math.max(sun.elevation, 0) * DEG); // bulutta direkt kısmın bir bölümü yaygına dönüşür
      const GHI = DNI * Math.sin(Math.max(sun.elevation, 0) * DEG) + DHI;
      const ci = Math.max(0, incidenceCos(sun, tilt, surfAz));
      const b = tilt * DEG;
      return { beam: DNI * ci, diffuse: DHI * (1 + Math.cos(b)) / 2, ground: GHI * albedo * (1 - Math.cos(b)) / 2, GHI: GHI, DNI: DNI, cosInc: ci };
    }

    function moduleTemp(Ta, G, noct) { return Ta + (noct - 20) / 800 * G; }

    /** Anlık güç (DC/AC). shade: 0–1 direkt ışınım gölge oranı (sıra arası + engel). */
    function instant(p, sun, Ta, shade) {
      const pl = plane(sun, p.tilt, p.azimuth, p.albedo, p.cloud);
      const G = pl.beam * (1 - shade) + pl.diffuse + pl.ground;
      const Tc = moduleTemp(Ta, G, p.noct);
      const Pdc0 = p.nMod * p.Pmod * G / 1000 * (1 + p.gamma / 100 * (Tc - 25));
      const Pdc = Math.max(0, Pdc0 * (1 - p.dcLoss / 100));
      const Pinv = Pdc * p.invEff / 100;
      const Pac = Math.min(Pinv, p.Pac * 1000);
      return { G: G, Tc: Tc, Pdc: Pdc, Pac: Pac, clipped: Pinv - Pac, plane: pl };
    }

    function stringCheck(p, Tmin, Tmax) {
      const Ns = p.perString;
      const vocCold = Ns * p.Voc * (1 + p.betaVoc / 100 * (Tmin - 25));
      const TcHot = Tmax + (p.noct - 20) / 800 * 1000;
      const vmpHot = Ns * p.Vmp * (1 + p.betaVmp / 100 * (TcHot - 25));
      const vmpCold = Ns * p.Vmp * (1 + p.betaVmp / 100 * (Tmin - 25));
      const iscString = p.Isc * 1.25;
      return { vocCold: vocCold, vmpHot: vmpHot, vmpCold: vmpCold, TcHot: TcHot, iscDesign: iscString * p.stringsPerMppt };
    }

    function compute(input) {
      const v = new Validator();
      const p = {
        lat: v.num(input.lat, 'Enlem', { min: 35, max: 43, unit: '°' }),
        lon: v.num(input.lon, 'Boylam', { min: 25, max: 45, unit: '°' }),
        tilt: v.num(input.tilt, 'Panel eğimi', { min: 0, max: 90, unit: '°' }),
        azimuth: v.num(input.azimuth, 'Panel azimutu', { min: -180, max: 180, unit: '°' }),
        Pmod: v.num(input.Pmod, 'Panel gücü', { min: 50, max: 800, unit: 'Wp' }),
        nMod: Math.round(v.num(input.nMod, 'Panel adedi', { min: 1, max: 20000 })),
        perString: Math.round(v.num(input.perString, 'String başına panel', { min: 1, max: 40 })),
        stringsPerMppt: Math.round(v.num(input.stringsPerMppt || 1, 'MPPT başına string', { min: 1, max: 6 })),
        Voc: v.num(input.Voc, 'Voc', { positive: true, max: 100, unit: 'V' }),
        Vmp: v.num(input.Vmp, 'Vmp', { positive: true, max: 100, unit: 'V' }),
        Isc: v.num(input.Isc, 'Isc', { positive: true, max: 30, unit: 'A' }),
        betaVoc: v.num(input.betaVoc, 'βVoc', { min: -1, max: 0, unit: '%/°C' }),
        betaVmp: v.num(input.betaVmp, 'βVmp', { min: -1, max: 0, unit: '%/°C' }),
        gamma: v.num(input.gamma, 'γPmax', { min: -1, max: 0, unit: '%/°C' }),
        noct: v.num(input.noct, 'NOCT', { min: 35, max: 60, unit: '°C' }),
        Pac: v.num(input.Pac, 'İnverter AC gücü', { positive: true, max: 100000, unit: 'kW' }),
        nInv: 1,
        vdcMax: v.num(input.vdcMax, 'İnverter maks. DC gerilim', { min: 100, max: 1500, unit: 'V' }),
        mpptMin: v.num(input.mpptMin, 'MPPT alt sınır', { min: 50, max: 1500, unit: 'V' }),
        mpptMax: v.num(input.mpptMax, 'MPPT üst sınır', { min: 50, max: 1500, unit: 'V' }),
        iscMppt: v.num(input.iscMppt, 'MPPT maks. kısa devre akımı', { min: 1, max: 200, unit: 'A' }),
        invEff: v.num(input.invEff, 'İnverter verimi', { min: 80, max: 99.5, unit: '%' }),
        dcLoss: v.num(input.dcLoss, 'Sistem kayıpları', { min: 0, max: 30, unit: '%' }),
        albedo: v.num(input.albedo === undefined ? 0.2 : input.albedo, 'Albedo', { min: 0, max: 0.9 }),
        cloud: v.num(input.cloud, 'Bulutluluk', { min: 0, max: 1 }),
        moduleLen: v.num(input.moduleLen || 2.28, 'Modül boyu', { min: 0.5, max: 3, unit: 'm' }),
        pitch: v.num(input.pitch, 'Sıra aralığı', { min: 0, max: 20, unit: 'm' }),
        roofArea: v.num(input.roofArea, 'Çatı alanı', { min: 0, max: 1e6, unit: 'm²' })
      };
      if (p.mpptMin >= p.mpptMax) v.errors.push('MPPT alt sınırı üst sınırdan küçük olmalı.');
      if (p.Vmp >= p.Voc) v.errors.push('Vmp, Voc değerinden küçük olmalı.');
      const month = Math.round(v.num(input.month, 'Ay', { min: 1, max: 12 }));
      const hour = v.num(input.hour, 'Saat', { min: 0, max: 24 });
      const Ta = v.num(input.Ta, 'Ortam sıcaklığı', { min: -30, max: 50, unit: '°C' });
      const Tmin = v.num(input.Tmin, 'En düşük ortam sıcaklığı', { min: -40, max: 20, unit: '°C' });
      const Tmax = v.num(input.Tmax, 'En yüksek ortam sıcaklığı', { min: 15, max: 55, unit: '°C' });
      const price = v.num(input.price, 'Elektrik birim fiyatı', { min: 0, max: 100, unit: 'TL/kWh' });
      const exportPrice = v.num(input.exportPrice, 'Şebekeye verilen enerji bedeli', { min: 0, max: 100, unit: 'TL/kWh' });
      const capex = v.num(input.capex, 'Yatırım bedeli', { min: 0, max: 1e10, unit: 'TL' });
      const consumption = v.num(input.consumption, 'Yıllık tüketim', { min: 0, max: 1e9, unit: 'kWh' });
      const profile = PROFILES[input.profile] ? input.profile : 'tek';
      const pvgis = Array.isArray(input.pvgisMonthly) && input.pvgisMonthly.length === 12 && input.pvgisMonthly.every(x => Number.isFinite(+x) && +x >= 0) ? input.pvgisMonthly.map(Number) : null;

      const kWp = p.nMod * p.Pmod / 1000;
      const dcac = kWp / p.Pac;
      const nStrings = Math.floor(p.nMod / p.perString);
      const doy = MONTH_MID[month - 1];
      const sun = sunPosition(p.lat, p.lon, doy, hour, 3);
      const rowShade = p.pitch > 0 ? rowShading(p.tilt, p.moduleLen, p.pitch, sun, p.azimuth) : 0;
      // ilk sıra gölgelenmez: toplam gölge oranı = (n-1)/n · sıra gölgesi (n sıra varsayımı girdi ile)
      const rows = Math.max(1, Math.round(v.num(input.rows || 1, 'Sıra sayısı', { min: 1, max: 500 })));
      const shade = clamp(rowShade * (rows - 1) / rows + (input.obstacleShade || 0), 0, 1);
      const now = instant(p, sun, Ta, shade);

      // günlük profil (seçili ay) 10 dk adımlarla
      function dayProfile(m, TaDay) {
        const d = MONTH_MID[m - 1];
        const pts = [];
        let Edc = 0, Eac = 0, Eclip = 0;
        for (let t = 4; t <= 21; t += 1 / 6) {
          const s = sunPosition(p.lat, p.lon, d, t, 3);
          const sh = p.pitch > 0 ? clamp(rowShading(p.tilt, p.moduleLen, p.pitch, s, p.azimuth) * (rows - 1) / rows, 0, 1) : 0;
          // gün içi sıcaklık: min sabah, max 15:00 civarı (sinüs yaklaşımı ±6 °C)
          const ta = TaDay + 6 * Math.sin((t - 9) / 12 * Math.PI);
          const r = s.elevation > 0 ? instant(p, s, ta, sh) : { Pdc: 0, Pac: 0, clipped: 0, G: 0 };
          Edc += r.Pdc / 6; Eac += r.Pac / 6; Eclip += r.clipped / 6;
          pts.push({ t: t, Pac: r.Pac / 1000, G: r.G });
        }
        return { pts: pts, Edc: Edc / 1000, Eac: Eac / 1000, Eclip: Eclip / 1000 };
      }
      const today = dayProfile(month, Ta);
      // yıllık: her ayın temsilî günü × gün sayısı. Ortam sıcaklığı için girilen değer tüm yıl için kullanılmaz:
      // aylara göre Tmin–Tmax arasında sinüs varsayımı (yalnızca sıcaklık kaybı için).
      const monthly = [];
      for (let m = 1; m <= 12; m++) {
        let E;
        if (pvgis) E = pvgis[m - 1] * kWp;
        else {
          const taM = (Tmin + Tmax) / 2 + (Tmax - Tmin) / 2 * Math.sin((m - 4) / 12 * 2 * Math.PI) * 0.6;
          E = dayProfile(m, taM).Eac * MONTH_DAYS[m - 1];
        }
        monthly.push(E);
      }
      const annual = monthly.reduce((a, b) => a + b, 0);
      const specYield = annual / kWp;

      // öz tüketim: aylık temsilî günlerde saatlik eşleştirme
      const prof = PROFILES[profile];
      let wSum = 0; for (let h = 0; h < 24; h++) wSum += prof.w(h + 0.5);
      let self = 0;
      for (let m = 1; m <= 12; m++) {
        const day = pvgis ? null : dayProfile(m, (Tmin + Tmax) / 2);
        const loadDay = consumption / 365 / wSum; // kWh / ağırlık birimi
        let selfDay = 0, prodDay = 0;
        for (let h = 0; h < 24; h++) {
          let prodH;
          if (day) prodH = day.pts.filter(pt => pt.t >= h && pt.t < h + 1).reduce((a, pt) => a + pt.Pac / 6, 0);
          else { const s = sunPosition(p.lat, p.lon, MONTH_MID[m - 1], h + 0.5, 3); prodH = Math.max(0, Math.sin(Math.max(s.elevation, 0) * DEG)); }
          prodDay += prodH;
          const loadH = loadDay * prof.w(h + 0.5);
          // hafta sonu tüketimi düşük profillerde yalnızca iş günü oranı kadar eşleşir
          selfDay += prof.weekdays * Math.min(prodH, loadH) + (1 - prof.weekdays) * Math.min(prodH, loadH * 0.15);
        }
        const ratio = prodDay > 0 ? selfDay / prodDay : 0;
        self += monthly[m - 1] * clamp(ratio, 0, 1);
      }
      const exported = annual - self;
      const saving = self * price + exported * exportPrice;
      const payback = saving > 0 && capex > 0 ? capex / saving : null;

      const sc = stringCheck(p, Tmin, Tmax);
      const checks = [];
      checks.push(check('voc', 'String Voc (en düşük sıcaklıkta) ≤ inverter maks. DC', sc.vocCold <= p.vdcMax ? 'ok' : 'fail', round(sc.vocCold, 0) + ' V @ ' + Tmin + ' °C / sınır ' + p.vdcMax + ' V', 'IEC 62548-1'));
      checks.push(check('mpptLo', 'Sıcakta Vmp ≥ MPPT alt sınırı', sc.vmpHot >= p.mpptMin ? 'ok' : 'warn', round(sc.vmpHot, 0) + ' V (hücre ' + round(sc.TcHot, 0) + ' °C) / ' + p.mpptMin + ' V'));
      checks.push(check('mpptHi', 'Soğukta Vmp ≤ MPPT üst sınırı', sc.vmpCold <= p.mpptMax ? 'ok' : 'warn', round(sc.vmpCold, 0) + ' V / ' + p.mpptMax + ' V'));
      checks.push(check('isc', 'MPPT kısa devre akımı', sc.iscDesign <= p.iscMppt ? 'ok' : 'fail', round(sc.iscDesign, 1) + ' A (1,25·Isc·string) / ' + p.iscMppt + ' A'));
      checks.push(check('dcac', 'DC/AC oranı', dcac >= 0.9 && dcac <= 1.35 ? 'ok' : 'warn', round(dcac, 2) + ' (tipik tasarım aralığı 0,9–1,35; üretici sınırı esastır)'));
      if (nStrings * p.perString !== p.nMod) checks.push(check('str', 'String bölünmesi', 'warn', p.nMod + ' panel, ' + p.perString + '’li stringlere tam bölünmüyor (' + (p.nMod - nStrings * p.perString) + ' panel artıyor).'));
      if (p.roofArea > 0) {
        const area = p.nMod * p.moduleLen * 1.134 * (p.pitch > 0 ? p.pitch / (p.moduleLen * Math.cos(p.tilt * DEG) || 1) : 1);
        checks.push(check('area', 'Çatı alanı yeterliliği', area <= p.roofArea * 0.85 ? 'ok' : 'warn', 'Gerekli ≈ ' + round(area, 0) + ' m² / kullanılabilir (%85) ' + round(p.roofArea * 0.85, 0) + ' m²'));
      }
      if (consumption > 0) checks.push(check('cap2', 'Yıllık üretim / tüketim', annual <= 2 * consumption ? 'ok' : 'warn', 'Üretim ' + round(annual / Math.max(consumption, 1), 2) + '× tüketim. Güncel Lisanssız Üretim Yönetmeliği, tüketimle ilişkili tesislerde yıllık üretimi ilişkili tüketimin iki katıyla sınırlar; saatlik mahsuplaşma uygulanır. Güncel metni doğrulayın.', 'Lisanssız Üretim Yönetmeliği'));
      checks.push(check('data', 'Işınım verisi', pvgis ? 'ok' : 'info', pvgis ? 'Aylık değerler kullanıcı tarafından girilen PVGIS çıktısından.' : 'Açık gök modeli × bulutluluk senaryosu. Sahaya özgü üretim için PVGIS gibi ölçüm tabanlı veri girin.'));

      return result(v, {
        kWp: kWp, Pac: p.Pac, dcac: dcac, nStrings: nStrings, sun: sun, shade: shade, rowShade: rowShade,
        now: now, today: today, monthly: monthly, annual: annual, specYield: specYield,
        self: self, exported: exported, selfRatio: annual > 0 ? self / annual : 0, saving: saving, payback: payback,
        string: sc, vocModCold: p.Voc * (1 + p.betaVoc / 100 * (Tmin - 25))
      }, checks, {
        assumptions: [
          'Güneş konumu: Spencer deklinasyonu ve zaman denklemi, UTC+3.',
          pvgis ? 'Aylık üretim: kullanıcının girdiği PVGIS kWh/kWp değerleri (PVGIS kayıpları dahil kabul edilir).' : 'Işınım: Meinel açık gök modeli; bulut etkisi Kasten–Czeplak. Bu bir senaryodur, sahaya özgü kesin üretim değildir.',
          'Düzlem ışınımı: izotropik gök (Liu–Jordan), albedo ' + p.albedo + '.',
          'Hücre sıcaklığı NOCT modeli; güç sıcaklık katsayısı γPmax.',
          'Gölge: sıra arası geometrik gölge, doğrusal kayıp; uyumsuzluk (mismatch) ve bypass diyot etkileri dahil değildir.',
          'Öz tüketim: seçilen tüketim profiline göre saatlik eşleşme; gerçek yük verisi ile değişir.',
          'Ekonomik sonuç kullanıcının girdiği fiyat ve yatırım bedeline dayanır; vergi, finansman ve tarife değişimleri dahil değildir.'
        ],
        formulas: ['G_POA = DNI·cosθ + DHI·(1 + cosβ)/2 + GHI·ρ·(1 − cosβ)/2', 'Tc = Ta + (NOCT − 20)/800·G', 'P_DC = n·P_STC·G/1000·[1 + γ·(Tc − 25)]·(1 − kayıp)', 'P_AC = min(P_DC·η_inv, P_AC,nom)', 'Voc,soğuk = Ns·Voc·[1 + βVoc·(Tmin − 25)]']
      });
    }

    return { compute: compute, MONTH_MID: MONTH_MID, sunPosition: sunPosition, clearSky: clearSky, incidenceCos: incidenceCos, rowShading: rowShading, cloudFactor: cloudFactor, stringCheck: stringCheck, CITIES: CITIES, PROFILES: PROFILES };
  })();

  /* ================================================================== TRAFO */
  const trafo = (function () {
    // Örnek katalog değerleri (yağlı, 36 kV sınıfı). Gerçek değer etiket/katalogdan girilmelidir.
    const PRESETS = {
      250: { P0: 270, Pk: 2350, uk: 4 }, 400: { P0: 390, Pk: 3250, uk: 4 }, 630: { P0: 540, Pk: 4600, uk: 4 },
      1000: { P0: 690, Pk: 7600, uk: 6 }, 1600: { P0: 1080, Pk: 12000, uk: 6 }, 2500: { P0: 1500, Pk: 18500, uk: 6 }
    };
    const THERMAL_ONAN = { dThetaOr: 55, R: 5, x: 0.8, y: 1.6, Hgr: 23, tauO: 180, tauW: 4 };

    function regulation(k, cosphi, ur, ux) {
      const sin = Math.sin(Math.acos(clamp(cosphi, -1, 1)));
      const a = ur * cosphi + ux * sin, b = ux * cosphi - ur * sin;
      return k * a + Math.pow(k * b, 2) / 200; // %
    }
    function steadyTemps(k, ambient, th) {
      const dTo = th.dThetaOr * Math.pow((1 + th.R * k * k) / (1 + th.R), th.x);
      const dTh = th.Hgr * Math.pow(k, th.y);
      return { topOil: ambient + dTo, hotSpot: ambient + dTo + dTh, dTo: dTo, dTh: dTh };
    }
    function agingRate(hotSpot) { return Math.pow(2, (hotSpot - 98) / 6); }

    function compute(input) {
      const v = new Validator();
      const Sr = v.num(input.Sr_kVA, 'Trafo gücü', { min: 25, max: 40000, unit: 'kVA' }) * 1e3;
      const U1 = v.num(input.U1_kV, 'OG gerilimi', { min: 1, max: 154, unit: 'kV' }) * 1e3;
      const U2 = v.num(input.U2_V, 'AG gerilimi', { min: 100, max: 3300, unit: 'V' });
      const P0 = v.num(input.P0, 'Boşta kayıp P0', { min: 0, max: 1e5, unit: 'W' });
      const Pk = v.num(input.Pk, 'Yük kaybı Pk', { min: 0, max: 5e5, unit: 'W' });
      const uk = v.num(input.uk, 'Kısa devre gerilimi uk', { min: 2, max: 20, unit: '%' });
      const Pload = v.num(input.P_kW, 'Yük aktif gücü', { min: 0, max: 1e5, unit: 'kW' }) * 1e3;
      const cos = v.num(input.cos, 'Yük cosφ', { min: 0.1, max: 1 });
      const amb = v.num(input.ambient, 'Ortam sıcaklığı', { min: -25, max: 50, unit: '°C' });
      const SkQ = v.num(input.SkQ_MVA, 'OG şebeke kısa devre gücü', { min: 0, max: 10000, unit: 'MVA' });
      if (U2 >= U1) v.errors.push('AG gerilimi OG geriliminden küçük olmalı.');
      const urPct = Pk / Sr * 100;
      if (urPct >= uk) v.errors.push('Pk/Sr oranı (uR) uk değerinden küçük olmalı; katalog değerlerini kontrol edin.');

      const S = cos > 0 ? Pload / cos : 0;
      const Q = Math.sqrt(Math.max(S * S - Pload * Pload, 0));
      const k = S / Sr;
      const I1n = currentFromS(Sr, U1), I2n = currentFromS(Sr, U2);
      const I1 = currentFromS(S, U1), I2 = currentFromS(S, U2);
      // energized === false: OG kesici açık, trafo enerjisiz (boşta kaybı da yok)
      const on = input.energized !== false;
      const Pcu = on ? Pk * k * k : 0;
      const losses = on ? P0 + Pcu : 0;
      const eff = Pload > 0 ? Pload / (Pload + losses) * 100 : 0;
      const kOpt = Pk > 0 ? Math.sqrt(P0 / Pk) : 0;
      const ux = Math.sqrt(Math.max(uk * uk - urPct * urPct, 0));
      const reg = regulation(k, cos, urPct, ux);
      const IkT = I2n / (uk / 100); // yalnız trafo empedansı, sonsuz şebeke
      const src = sourceImpedance({ U_LL: U2, SkQ_MVA: SkQ, Sr_kVA: Sr / 1e3, uk_pct: uk, Pk_W: Pk });
      const sc = shortCircuit3(U2, src.R, src.X);

      const th = Object.assign({}, THERMAL_ONAN, input.thermal || {});
      const temps = on ? steadyTemps(k, amb, th) : { topOil: amb, hotSpot: amb, dTo: 0, dTh: 0 };
      const aging = agingRate(temps.hotSpot);

      const checks = [];
      checks.push(check('load', 'Trafo yüklenmesi', k <= 0.8 ? 'ok' : k <= 1 ? 'warn' : 'fail', '%' + round(k * 100, 1) + ' (S = ' + round(S / 1e3, 1) + ' kVA)'));
      checks.push(check('hs', 'Sıcak nokta (IEC 60076-7, normal çevrimsel yükleme sınırı 120 °C)', temps.hotSpot <= 98 ? 'ok' : temps.hotSpot <= 120 ? 'warn' : 'fail', round(temps.hotSpot, 1) + ' °C · bağıl yaşlanma ' + round(aging, 2) + '×', 'IEC 60076-7'));
      checks.push(check('to', 'Üst yağ sıcaklığı (sınır 105 °C)', temps.topOil <= 105 ? 'ok' : 'fail', round(temps.topOil, 1) + ' °C', 'IEC 60076-7'));
      checks.push(check('pf', 'Güç faktörü', cos >= 0.95 ? 'ok' : cos >= 0.9 ? 'warn' : 'fail', 'cosφ ' + round(cos, 2) + ' · Q = ' + round(Q / 1e3, 1) + ' kVAr. Düşük cosφ aynı kW için trafo kVA yükünü artırır.'));
      checks.push(check('sc', 'AG kısa devre (yaklaşık)', 'info', 'Yalnız trafo: ' + round(IkT / 1e3, 1) + ' kA · şebeke dahil (c = 1,05): ' + round(sc.Ik / 1e3, 1) + ' kA. IEC 60909’a tam uygun hesap değildir.'));
      checks.push(check('th', 'Isıl model parametreleri', 'info', input.thermal ? 'Kullanıcı tarafından girilen ısıl parametreler.' : 'IEC 60076-7 dağıtım trafosu (ONAN) varsayılanları; üretici ısıl verisi yoksa sonuç göstergedir.'));

      return result(v, {
        Sr: Sr, S: S, P: Pload, Q: Q, k: k, I1n: I1n, I2n: I2n, I1: I1, I2: I2, P0: P0, Pcu: Pcu, losses: losses, eff: eff, kOpt: kOpt,
        ur: urPct, ux: ux, reg: reg, U2load: U2 * (1 - reg / 100), IkT: IkT, Ik: sc.Ik, ip: sc.ip, temps: temps, aging: aging, thermal: th
      }, checks, {
        assumptions: [
          'Akımlar dengeli üç faz için I = S/(√3·U_LL).',
          'Kayıplar: P = P0 + Pk·K²; P0 ve Pk girilen katalog değerleridir (önayarlar örnektir).',
          'Gerilim değişimi IEC 60076-1 yaklaşık bağıntısı: ε = K·(uR·cosφ + uX·sinφ) + K²·(uX·cosφ − uR·sinφ)²/200.',
          'Kısa devre: trafo + OG şebeke empedansı (c = 1,05); kablo, motor katkısı ve KT düzeltmesi dahil değil — yaklaşık.',
          'Sıcaklık: IEC 60076-7 kararlı hal üstel modeli; ısıl veriler girilmezse ONAN dağıtım trafosu varsayılanları. Yaşlanma, termik iyileştirilmemiş kâğıt (98 °C referans).'
        ],
        formulas: ['I = S / (√3·U_LL)', 'K = S / Sr', 'P_kayıp = P0 + Pk·K²', 'η = P / (P + P0 + Pk·K²)', 'K_opt = √(P0/Pk)', 'Ik ≈ In / uk (sonsuz şebeke)', 'Δθo = Δθor·[(1 + R·K²)/(1 + R)]^x', 'V = 2^((θh − 98)/6)']
      });
    }
    /** Birinci derece ısıl yaklaşım (görselleştirme ve zaman simülasyonu için). */
    function stepTemps(state, target, dtMin, th) {
      const ao = 1 - Math.exp(-dtMin / th.tauO), aw = 1 - Math.exp(-dtMin / th.tauW);
      const topOil = state.topOil + (target.topOil - state.topOil) * ao;
      const dTh = state.dTh + (target.dTh - state.dTh) * aw;
      return { topOil: topOil, dTh: dTh, hotSpot: topOil + dTh };
    }
    return { compute: compute, PRESETS: PRESETS, THERMAL_ONAN: THERMAL_ONAN, steadyTemps: steadyTemps, agingRate: agingRate, stepTemps: stepTemps, regulation: regulation };
  })();

  /* ================================================================== ŞARJ */
  const sarj = (function () {
    const PROFILES = {
      'AC7': { kind: 'AC', phases: 1, I: 32, name: 'AC 7,4 kW (1 faz 32 A)' },
      'AC11': { kind: 'AC', phases: 3, I: 16, name: 'AC 11 kW (3 faz 16 A)' },
      'AC22': { kind: 'AC', phases: 3, I: 32, name: 'AC 22 kW (3 faz 32 A)' },
      'DC60': { kind: 'DC', P: 60, name: 'DC 60 kW' },
      'DC120': { kind: 'DC', P: 120, name: 'DC 120 kW' },
      'DC180': { kind: 'DC', P: 180, name: 'DC 180 kW' }
    };
    /** Tipik DC şarj eğrisi çarpanı (aracın maks. DC gücüne göre). Basitleştirilmiş CC–CV davranışı. */
    function dcCurveFactor(soc) {
      if (soc <= 0.5) return 1;
      if (soc <= 0.8) return 1 - (soc - 0.5) / 0.3 * 0.5;
      return 0.5 - (soc - 0.8) / 0.2 * 0.35;
    }
    /** AC: istasyon akımı/faz sayısı ile araç dahili şarj cihazının (OBC) kısıtı. 1 fazlı OBC 3 fazlı istasyonda tek faz kullanır. */
    function acPower(st, ev) {
      const phases = Math.min(st.phases, ev.obcPhases);
      const I = Math.min(st.I, ev.obcI);
      return { P: phases * 230 * I / 1000, phases: phases, I: I };
    }
    /** Su doldurma yöntemiyle eşit paylaşım: her nokta talebi kadar alır, artan güç diğerlerine dağıtılır. */
    function shareLoad(demands, available) {
      const alloc = demands.map(() => 0);
      let left = available, open = demands.map((d, i) => i).filter(i => demands[i] > 0);
      while (open.length && left > 1e-9) {
        const each = left / open.length;
        const next = [];
        open.forEach(i => { const need = demands[i] - alloc[i]; const give = Math.min(need, each); alloc[i] += give; left -= give; if (demands[i] - alloc[i] > 1e-9) next.push(i); });
        if (next.length === open.length) break;
        open = next;
      }
      return alloc;
    }

    function compute(input) {
      const v = new Validator();
      const prof = PROFILES[input.profile] || PROFILES.AC11;
      const cap = v.num(input.capacity, 'Batarya kapasitesi', { min: 10, max: 250, unit: 'kWh' });
      const soc0 = v.num(input.soc0, 'Başlangıç SOC', { min: 0, max: 100, unit: '%' }) / 100;
      const soc1 = v.num(input.soc1, 'Hedef SOC', { min: 1, max: 100, unit: '%' }) / 100;
      if (soc1 <= soc0) v.errors.push('Hedef SOC başlangıç SOC değerinden büyük olmalı.');
      const ev = {
        obcPhases: v.oneOf(Number(input.obcPhases), 'Araç OBC faz sayısı', [1, 3]),
        obcI: v.num(input.obcI, 'Araç OBC akımı', { min: 6, max: 63, unit: 'A' }),
        dcMax: v.num(input.dcMax, 'Araç maks. DC gücü', { min: 10, max: 400, unit: 'kW' })
      };
      const stationP = prof.kind === 'DC' ? v.num(input.stationP === undefined ? prof.P : input.stationP, 'İstasyon gücü', { min: 10, max: 400, unit: 'kW' }) : null;
      const effAC = v.num(input.effAC === undefined ? 90 : input.effAC, 'AC şarj verimi', { min: 60, max: 100, unit: '%' }) / 100;
      const effDC = v.num(input.effDC === undefined ? 94 : input.effDC, 'DC şarj verimi', { min: 60, max: 100, unit: '%' }) / 100;
      const nPoints = Math.round(v.num(input.nPoints, 'Eşzamanlı şarj eden araç', { min: 1, max: 50 }));
      const siteKW = v.num(input.siteKW, 'Tesisin kullanılabilir gücü', { min: 1, max: 20000, unit: 'kW' });
      const curve = input.curve === 'constant' ? 'constant' : 'typical';
      const eff = prof.kind === 'AC' ? effAC : effDC;

      // Bir noktanın şebeke tarafı talebi (kW): cihaz ve araç sınırının küçüğü
      function demandAt(soc) {
        if (prof.kind === 'AC') {
          const ac = acPower(prof, ev);
          return soc >= 0.97 && curve === 'typical' ? ac.P * 0.5 : ac.P;
        }
        const evLimit = ev.dcMax * (curve === 'typical' ? dcCurveFactor(soc) : 1);
        return Math.min(stationP, evLimit) / eff; // istasyon gücü DC çıkış gücüdür; şebeke tarafı kayıp kadar fazladır
      }
      // diğer noktalar da aynı profil ve SOC’de kabul edilir (eşzamanlı senaryo)
      const shareCap = siteKW / nPoints;
      const sim = [];
      let soc = soc0, t = 0, Egrid = 0, Ebatt = 0, guard = 0;
      const dt = 1 / 60; // saat (1 dk)
      while (soc < soc1 - 1e-9 && guard++ < 6000) {
        const dem = demandAt(soc);
        const alloc = shareLoad(Array(nPoints).fill(dem), siteKW)[0];
        const Pgrid = Math.min(dem, alloc);
        const Pbatt = Pgrid * eff;
        if (Pbatt <= 1e-6) break;
        let dE = Pbatt * dt, step = dt;
        if (soc + dE / cap > soc1) { dE = (soc1 - soc) * cap; step = dE / Pbatt; }
        sim.push({ t: t * 60, soc: soc * 100, Pgrid: Pgrid, Pbatt: Pbatt });
        soc += dE / cap; Ebatt += dE; Egrid += Pgrid * step; t += step;
      }
      sim.push({ t: t * 60, soc: soc * 100, Pgrid: 0, Pbatt: 0 });
      const ideal = cap * Math.max(soc1 - soc0, 0);
      const startDemand = demandAt(soc0);
      const alloc0 = Math.min(startDemand, shareLoad(Array(nPoints).fill(startDemand), siteKW)[0]);
      const ac = prof.kind === 'AC' ? acPower(prof, ev) : null;
      const totalDemand = startDemand * nPoints;
      const checks = [];
      const limiter = prof.kind === 'AC'
        ? (ac.phases < prof.phases || ac.I < prof.I ? 'Araç dahili şarj cihazı (OBC)' : 'Şarj cihazı')
        : (ev.dcMax < stationP ? 'Araç DC kabul gücü' : 'Şarj cihazı');
      checks.push(check('limit', 'Gücü sınırlayan', 'info', alloc0 + 1e-6 < startDemand ? 'Tesis kullanılabilir gücü (yük paylaşımı)' : limiter));
      checks.push(check('site', 'Tesis gücü yeterliliği', totalDemand <= siteKW ? 'ok' : 'warn', nPoints + ' nokta × ' + round(startDemand, 1) + ' kW = ' + round(totalDemand, 1) + ' kW / mevcut ' + siteKW + ' kW'));
      checks.push(check('rcd', 'Kaçak akım koruması', 'info', prof.kind === 'AC'
        ? 'Her bağlantı noktası için ayrı devre ve ≤ 30 mA RCD; ünitede 6 mA DC algılama (RDC-DD) yoksa Tip B RCD (TS HD 60364-7-722).'
        : 'DC şarj cihazının AC beslemesi için üretici ve TS HD 60364-7-722 gereklilikleri; DC çıkış izolasyon izleme cihaz içindedir (IEC 61851-23).', 'TS HD 60364-7-722'));
      checks.push(check('reg', 'Mevzuat kapsamı', 'info', input.publicService ? 'Herkese açık ücretli şarj hizmeti: şarj ağı işletmeci lisansı sahibi bir ağa bağlı olarak verilir.' : 'Ticari olmayan özel kullanım: Şarj Hizmeti Yönetmeliği Madde 5 kapsamında şarj ağına bağlanma yükümlülüğü yoktur; iç tesis ve dağıtım bağlantı kuralları geçerlidir.', 'Şarj Hizmeti Yönetmeliği'));
      if (curve === 'constant') checks.push(check('curve', 'Şarj eğrisi', 'info', 'Sabit güç varsayımı kullanıldı; gerçek süre daha uzun olabilir.'));
      return result(v, {
        ideal: ideal, Egrid: Egrid, Ebatt: Ebatt, minutes: t * 60, sim: sim, startGrid: alloc0, startDemand: startDemand,
        ac: ac, phaseCurrent: prof.kind === 'AC' ? ac.I * (alloc0 / Math.max(startDemand, 1e-9)) : null, kind: prof.kind,
        lossKWh: Egrid - Ebatt, perPoint: siteKW / nPoints, totalDemand: totalDemand, shareCap: shareCap
      }, checks, {
        assumptions: [
          'AC güç = faz sayısı × 230 V × akım; araç OBC faz sayısı ve akımıyla sınırlanır.',
          curve === 'typical' ? 'DC eğrisi tipiktir (SOC %50’ye kadar tam, %80’de yarı, %100’de ~%15 güç); araç modeline göre değişir.' : 'Sabit güç varsayımı.',
          'Şebeke enerjisi = bataryaya giren enerji / verim. Batarya ön ısıtma/soğutma tüketimi dahil değil.',
          'Eşzamanlı noktalar aynı profil ve SOC ile kabul edilir; yük paylaşımı eşit (su doldurma) algoritmasıyla.'
        ],
        formulas: ['E_ideal = C·(SOC_hedef − SOC_baş)', 'P_AC = n_faz·230·I', 'P = min(cihaz, araç, tesis payı)', 'E_şebeke = ∫P_şebeke·dt, E_batarya = η·E_şebeke']
      });
    }
    return { compute: compute, PROFILES: PROFILES, dcCurveFactor: dcCurveFactor, acPower: acPower, shareLoad: shareLoad };
  })();

  /* ================================================================== RES */
  const res = (function () {
    const BETZ = 16 / 27;
    function airDensity(T_C, altitude) {
      const p = 101325 * Math.pow(1 - 2.25577e-5 * altitude, 5.25588);
      return p / (287.05 * (T_C + 273.15));
    }
    function gamma(z) { // Lanczos
      const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
      if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
      z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
      const t = z + g + 0.5; return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
    }
    /** Elektrik gücü (kW). */
    function power(vHub, t) {
      if (vHub < t.cutIn || vHub >= t.cutOut) return { P: 0, region: vHub >= t.cutOut ? 'stop' : 'idle', Pwind: 0.5 * t.rho * t.A * Math.pow(vHub, 3) / 1000 };
      const Pwind = 0.5 * t.rho * t.A * Math.pow(vHub, 3); // W
      const Pmech = Pwind * t.cp;
      const Pel = Pmech * t.etaMech * t.etaGen / 1000;
      if (Pel >= t.Prated) return { P: t.Prated, region: 'rated', Pwind: Pwind / 1000, cpReq: t.Prated * 1000 / (Pwind * t.etaMech * t.etaGen) };
      return { P: Pel, region: 'partial', Pwind: Pwind / 1000, cpReq: t.cp };
    }
    function compute(input) {
      const v = new Validator();
      const D = v.num(input.D, 'Rotor çapı', { min: 5, max: 260, unit: 'm' });
      const hub = v.num(input.hub, 'Göbek yüksekliği', { min: 10, max: 200, unit: 'm' });
      if (hub < D / 2 + 5) v.errors.push('Göbek yüksekliği rotor yarıçapından en az 5 m büyük olmalı.');
      const t = {
        A: Math.PI * D * D / 4,
        Prated: v.num(input.Prated, 'Nominal güç', { min: 10, max: 20000, unit: 'kW' }),
        cp: v.num(input.cp, 'Güç katsayısı Cp', { min: 0.05, max: 0.593 }),
        etaMech: v.num(input.etaMech, 'Mekanik (dişli) verim', { min: 0.8, max: 1 }),
        etaGen: v.num(input.etaGen, 'Jeneratör/çevirici verimi', { min: 0.8, max: 1 }),
        cutIn: v.num(input.cutIn, 'Devreye girme hızı', { min: 1, max: 8, unit: 'm/s' }),
        cutOut: v.num(input.cutOut, 'Devreden çıkma hızı', { min: 15, max: 40, unit: 'm/s' }),
        rho: input.rhoMode === 'manual' ? v.num(input.rho, 'Hava yoğunluğu', { min: 0.8, max: 1.4, unit: 'kg/m³' }) : airDensity(v.num(input.T, 'Hava sıcaklığı', { min: -30, max: 50 }), v.num(input.alt, 'Rakım', { min: 0, max: 4000 }))
      };
      if (t.cp > BETZ) v.errors.push('Cp Betz sınırını (16/27) aşamaz.');
      const vRef = v.num(input.v10, 'Ölçüm yüksekliğinde rüzgâr hızı', { min: 0, max: 50, unit: 'm/s' });
      const hRef = v.num(input.href || 10, 'Ölçüm yüksekliği', { min: 2, max: 200, unit: 'm' });
      const alpha = v.num(input.alpha, 'Rüzgâr kesme üssü α', { min: 0.05, max: 0.5 });
      const vHub = vRef * Math.pow(hub / hRef, alpha);
      const n = Math.round(v.num(input.n, 'Türbin sayısı', { min: 1, max: 200 }));
      const tsr = v.num(input.tsr || 8, 'Uç hız oranı λ', { min: 3, max: 12 });
      const rpmMax = v.num(input.rpmMax, 'Maks. rotor devri', { min: 3, max: 60, unit: 'rpm' });
      const vMean = v.num(input.vMean, 'Yıllık ortalama göbek hızı', { min: 2, max: 15, unit: 'm/s' });
      const k = v.num(input.k || 2, 'Weibull k', { min: 1.2, max: 4 });
      const avail = v.num(input.avail === undefined ? 97 : input.avail, 'Kullanılabilirlik', { min: 50, max: 100, unit: '%' }) / 100;
      const wake = v.num(input.wake === undefined ? 0 : input.wake, 'Park/iz kaybı', { min: 0, max: 40, unit: '%' }) / 100;

      const pw = power(vHub, t);
      const R = D / 2;
      const rpm = pw.region === 'stop' || pw.region === 'idle' && vHub < t.cutIn * 0.6 ? 0 : Math.min(rpmMax, tsr * vHub / R * 60 / (2 * Math.PI));
      const tip = rpm * 2 * Math.PI / 60 * R;
      // nominal hız: Pel(v) = Prated çözümü
      const vRated = Math.cbrt(t.Prated * 1000 / (0.5 * t.rho * t.A * t.cp * t.etaMech * t.etaGen));
      const curve = [];
      for (let s = 0; s <= 30; s += 0.5) curve.push({ v: s, P: power(s, t).P });
      // Weibull AEP
      const c = vMean / gamma(1 + 1 / k);
      let aep = 0;
      for (let s = 0.25; s < 40; s += 0.5) { const f = k / c * Math.pow(s / c, k - 1) * Math.exp(-Math.pow(s / c, k)); aep += power(s, t).P * f * 0.5; }
      aep *= 8760 * avail * (1 - wake) * n; // kWh
      const cf = aep / (t.Prated * n * 8760);
      const checks = [];
      checks.push(check('betz', 'Cp ≤ Betz sınırı (%59,3)', t.cp <= BETZ ? 'ok' : 'fail', 'Cp = ' + round(t.cp, 3) + ' · toplam elektrik verimi Cp·η = ' + round(t.cp * t.etaMech * t.etaGen * 100, 1) + ' %'));
      checks.push(check('region', 'Çalışma bölgesi', pw.region === 'stop' ? 'warn' : 'info', { idle: 'Devreye girme hızının altında: üretim yok.', partial: 'Kısmi yük: güç v³ ile artar (maks. Cp takibi).', rated: 'Nominal güç: kanat açısı (pitch) ile güç sınırlanıyor; gereken Cp = ' + round(pw.cpReq || 0, 3) + '.', stop: 'Devreden çıkma hızı aşıldı: kanatlar rüzgâra paralel (feather), rotor frenli.' }[pw.region]));
      checks.push(check('tip', 'Kanat uç hızı', tip <= 90 ? 'ok' : 'warn', round(tip, 1) + ' m/s (tipik üst değer ~80–90 m/s, gürültü ve erozyon)'));
      checks.push(check('ced', 'ÇED kapsamı (türbin sayısına göre)', 'info', n + ' türbin: ' + (n >= 15 ? 'ÇED Yönetmeliği Ek-1 (madde 41), ÇED raporu.' : 'ÇED Yönetmeliği Ek-2 (madde 57), seçme-eleme.') + ' Eşik 26.06.2025 değişikliğiyle türbin sayısına bağlanmıştır; güncel metinden doğrulayın.', 'ÇED Yönetmeliği'));
      checks.push(check('aep', 'Yıllık üretim verisi', 'info', 'Weibull (k = ' + k + ') varsayımsal dağılım. Gerçek tahmin için en az 1 yıllık saha ölçümü ve uzun dönem düzeltme gerekir.'));
      return result(v, {
        vHub: vHub, rho: t.rho, A: t.A, P: pw.P, Pwind: pw.Pwind, region: pw.region, cpReq: pw.cpReq, rpm: rpm, tip: tip, vRated: vRated,
        farmP: pw.P * n, curve: curve, aep: aep, cf: cf, weibullC: c, Prated: t.Prated, n: n
      }, checks, {
        assumptions: [
          'P = ½·ρ·A·Cp·v³; mekanik ve elektriksel verimler ayrıca uygulanır; nominal güçte sınırlanır.',
          'Cp sabit kabul edilir (maks. güç takibi); gerçek türbinde Cp hız ve uç hız oranına bağlıdır. Üretici güç eğrisi esastır.',
          'Göbek hızı üstel rüzgâr profili ile; atmosferik kararlılık ve arazi etkileri dahil değil.',
          'Hava yoğunluğu: standart atmosfer basıncı ve ideal gaz (kuru hava).',
          'Yıllık üretim varsayımsal Weibull dağılımıyla; saatlik/ölçüm verisi yoksa yalnızca senaryodur.'
        ],
        formulas: ['P = ½·ρ·A·Cp·v³·η_mek·η_jen', 'Betz: Cp,max = 16/27 ≈ 0,593', 'v_hub = v_ref·(h/h_ref)^α', 'ρ = p/(287,05·T)', 'n = λ·v/(2π·R)·60', 'AEP = 8760·Σ P(v)·f(v)·Δv']
      });
    }
    return { compute: compute, power: power, airDensity: airDensity, gamma: gamma, BETZ: BETZ };
  })();

  /* ================================================================== KOMPANZASYON / HARMONİK */
  const komp = (function () {
    /** Gerekli kondansatör gücü: Qc = P·(tanφ1 − tanφ2) */
    function requiredQc(P, cos1, cos2) { return P * (Math.tan(Math.acos(cos1)) - Math.tan(Math.acos(cos2))); }
    /** Otomatik regülatör: hedefe en yakın, aşırı kompanzasyon yapmayan kademe kombinasyonu (ikili arama). */
    function chooseSteps(steps, Qneed) {
      let best = { mask: 0, Q: 0 };
      const n = Math.min(steps.length, 12);
      for (let m = 0; m < (1 << n); m++) {
        let q = 0; for (let i = 0; i < n; i++) if (m & (1 << i)) q += steps[i];
        if (q <= Qneed * 1.02 + 1e-9 && q > best.Q) best = { mask: m, Q: q };
      }
      return steps.map((s, i) => !!(best.mask & (1 << i)));
    }
    function compute(input) {
      const v = new Validator();
      const U = v.num(input.U_LL, 'Gerilim', { min: 200, max: 1000, unit: 'V' });
      const P = v.num(input.P_kW, 'Aktif güç', { min: 0, max: 50000, unit: 'kW' });
      const cos1 = v.num(input.cos1, 'Mevcut cosφ', { min: 0.3, max: 1 });
      const cos2 = v.num(input.cos2, 'Hedef cosφ', { min: 0.8, max: 1 });
      const Qcap = v.num(input.Qcap_kvar || 0, 'Kapasitif yük', { min: 0, max: 20000, unit: 'kVAr' });
      const Sr = v.num(input.Sr_kVA, 'Trafo gücü', { min: 25, max: 40000, unit: 'kVA' });
      const uk = v.num(input.uk, 'Trafo uk', { min: 2, max: 20, unit: '%' });
      const p = v.num(input.detune, 'Ayar (detuning) oranı p', { min: 0, max: 14, unit: '%' }) / 100;
      const steps = (input.steps || []).map((q, i) => v.num(q, 'Kademe ' + (i + 1), { min: 0, max: 2000, unit: 'kVAr' }));
      const manual = Array.isArray(input.manual) ? input.manual : null;
      const shunt = v.num(input.shunt_kvar || 0, 'Şönt reaktör', { min: 0, max: 5000, unit: 'kVAr' });
      const harm = input.harmonics || {}; // { 5: %, 7: %, ... } yük akımı temel bileşenine oranla
      const Ql = P * Math.tan(Math.acos(cos1));
      const Qneed = requiredQc(P, cos1, cos2);
      const on = manual || chooseSteps(steps, Math.max(Qneed - Qcap + shunt, 0)); // kapasitif yük kondansatör ihtiyacını azaltır, şönt reaktör artırır
      const QcNom = steps.reduce((a, q, i) => a + (on[i] ? q : 0), 0); // kademe etiket gücü (anma gerilim ve frekansta)
      // ayarlı (detuned) grupta kondansatör uçlarında gerilim U/(1−p) olur; bara tarafına verilen Q ≈ Qc_nom/(1−p) (kondansatör anma geriliminin buna göre seçildiği varsayılır)
      const QcEff = QcNom;
      const Qnet = Ql - QcEff - Qcap + shunt;
      const S = Math.hypot(P, Qnet);
      const cosNew = S > 0 ? P / S : 1;
      const state = Qnet >= 0 ? 'endüktif' : 'kapasitif';

      // Harmonik model: AG bara, kaynak = trafo + (sonsuz) şebeke; kondansatör kolu ± seri reaktör; yük harmonik akım kaynağı
      const Xs = (uk / 100) * U * U / (Sr * 1e3); // Ω (50 Hz)
      const Rs = Xs / 8;
      const Xc = QcEff > 0 ? U * U / (QcEff * 1e3) : Infinity;
      const XL = p * Xc;
      const I1 = P > 0 ? P * 1e3 / (Math.sqrt(3) * U * cos1) : 0;
      const V1 = U / Math.sqrt(3);
      let sumV = 0, sumIs = 0, sumIl = 0, sumIc = 0;
      const spectrum = [];
      const hRes = isFinite(Xc) ? (p > 0 ? 1 / Math.sqrt(p) : Math.sqrt(Xc / Xs)) : null; // seri (kol) veya paralel rezonans mertebesi
      const hPar = isFinite(Xc) ? Math.sqrt(Xc / (Xs + XL)) : null; // kaynak ile kondansatör kolunun paralel rezonansı
      Object.keys(harm).map(Number).sort((a, b) => a - b).forEach(h => {
        const Ih = I1 * v.num(harm[h], h + '. harmonik', { min: 0, max: 100, unit: '%' }) / 100;
        const Zs = C.of(Rs, h * Xs);
        const Zc = isFinite(Xc) ? C.of(Xc * 0.003 * h, h * XL - Xc / h) : null;
        const Zbus = Zc ? C.div(C.mul(Zs, Zc), C.add(Zs, Zc)) : Zs;
        const Vh = Ih * C.abs(Zbus);
        const IsH = Zc ? Ih * C.abs(C.div(Zc, C.add(Zs, Zc))) : Ih;
        const IcH = Zc ? Ih * C.abs(C.div(Zs, C.add(Zs, Zc))) : 0;
        sumV += Vh * Vh; sumIs += IsH * IsH; sumIl += Ih * Ih; sumIc += IcH * IcH;
        spectrum.push({ h: h, Iload: Ih, Isupply: IsH, Icap: IcH, Vh: Vh, VhPct: Vh / V1 * 100, amp: Ih > 0 ? IsH / Ih : 1 });
      });
      const THDv = Math.sqrt(sumV) / V1 * 100;
      const THDiLoad = I1 > 0 ? Math.sqrt(sumIl) / I1 * 100 : 0;
      const I1s = Math.hypot(P * 1e3 / (Math.sqrt(3) * U), Qnet * 1e3 / (Math.sqrt(3) * U));
      const THDiSupply = I1s > 0 ? Math.sqrt(sumIs) / I1s * 100 : 0;
      const Ic1 = QcEff > 0 ? QcEff * 1e3 / (Math.sqrt(3) * U) : 0;
      const capOver = Ic1 > 0 ? Math.sqrt(Ic1 * Ic1 + sumIc) / Ic1 : 1;
      const checks = [];
      checks.push(check('cos', 'Hedef cosφ', cosNew >= cos2 - 0.005 && Qnet >= 0 ? 'ok' : Qnet < 0 ? 'warn' : 'warn', 'cosφ = ' + round(cosNew, 3) + ' (' + state + '), Q_net = ' + round(Qnet, 1) + ' kVAr'));
      const amp = spectrum.filter(s => s.amp > 1.2);
      if (p === 0 && QcEff > 0) checks.push(check('res', 'Paralel rezonans riski', amp.length ? 'fail' : (hPar && [5, 7, 11, 13].some(h => Math.abs(hPar - h) < 1) ? 'warn' : 'info'), 'Rezonans mertebesi h ≈ √(Xc/Xs) = ' + round(hPar, 2) + (amp.length ? '; büyüyen harmonikler: ' + amp.map(s => s.h + '.').join(', ') : '') + '. Harmonikli tesiste ayarlı (detuned) kompanzasyon değerlendirilmelidir.'));
      if (p > 0) checks.push(check('tune', 'Ayar frekansı', hRes < 4.8 ? 'ok' : 'warn', 'f_r = ' + round(50 * hRes, 0) + ' Hz (h = ' + round(hRes, 2) + '); 5. harmoniğin altında olmalıdır.'));
      checks.push(check('thdv', 'THDv (AG bara, hesaplanan)', THDv <= 5 ? 'ok' : THDv <= 8 ? 'warn' : 'fail', '%' + round(THDv, 2) + ' · TS EN 50160, bir haftalık 10 dakikalık ortalamaların %95’i için THD ≤ %8 öngörür (istatistiksel sınır; anlık değer değildir).', 'TS EN 50160'));
      checks.push(check('thdi', 'THDi', 'info', 'Yük akımı %' + round(THDiLoad, 1) + ' · Şebeke (trafo) akımı %' + round(THDiSupply, 1)));
      if (QcEff > 0) checks.push(check('capI', 'Kondansatör akım yüklenmesi', capOver <= 1.3 ? 'ok' : 'fail', round(capOver, 2) + '×I_n (IEC 60831-1: sürekli ≤ 1,3·In)', 'IEC 60831-1'));
      // EPDK Kurul Kararı 5999-3 Md. 13: kurulu güç < 50 kVA → %33 / %20; ≥ 50 kVA → %20 / %15; ≤ 15 kW kullanıcılar muaf
      const kur = v.num(input.installed_kVA === undefined ? Sr : input.installed_kVA, 'Kurulu güç', { min: 1, max: 1e6, unit: 'kVA' });
      const lim = kur < 50 ? { ind: 33, cap: 20 } : { ind: 20, cap: 15 };
      const ratio = P > 0 ? Qnet / P * 100 : 0;
      const reStatus = ratio >= 0 ? (ratio <= lim.ind ? 'ok' : 'fail') : (-ratio <= lim.cap ? 'ok' : 'fail');
      checks.push(check('reg', 'Reaktif / aktif enerji oranı', reStatus, (ratio >= 0 ? 'Endüktif %' + round(ratio, 1) + ' (sınır %' + lim.ind + ')' : 'Kapasitif %' + round(-ratio, 1) + ' (sınır %' + lim.cap + ')') + ' · kurulu güç ' + kur + ' kVA. Sabit yük varsayımıyla anlık oran aylık enerji oranına eşit kabul edilir.', 'EPDK Kurul Kararı 5999-3, Madde 13'));
      return result(v, {
        Ql: Ql, Qneed: Qneed, reRatio: ratio, reLimit: lim, steps: on, QcNom: QcNom, QcEff: QcEff, Qnet: Qnet, S: S, cosNew: cosNew, state: state,
        THDv: THDv, THDiLoad: THDiLoad, THDiSupply: THDiSupply, spectrum: spectrum, hRes: hRes, hPar: hPar, Xs: Xs, Xc: Xc, capOver: capOver,
        I1: I1, Inew: S * 1e3 / (Math.sqrt(3) * U)
      }, checks, {
        assumptions: [
          'Qc = P·(tanφ1 − tanφ2): sinüzoidal, temel bileşen ve sabit yük varsayımı.',
          'Harmonik model: AG bara; kaynak trafo kısa devre reaktansı (R = X/8), OG şebeke sonsuz güçte; yük harmonik akım kaynağı; kondansatör kolunda isteğe bağlı seri reaktör.',
          'Harmonik spektrum kullanıcı girdisidir (önayar örnektir). Gerçek değerlendirme için tesis ölçümü (TS EN 61000-4-30 sınıf A analizör) gerekir.',
          'Diğer kompanzasyon grupları, kablo kapasitansları ve şebekedeki arka plan harmonikleri dahil değildir.'
        ],
        formulas: ['Qc = P·(tanφ1 − tanφ2)', 'h_r = √(Xc/Xs) (paralel rezonans)', 'f_r = 50/√p (ayarlı grup)', 'Z_bara(h) = Zs(h)·Zc(h)/(Zs(h) + Zc(h))', 'THD = √(Σ X_h²)/X_1']
      });
    }
    return { compute: compute, requiredQc: requiredQc, chooseSteps: chooseSteps };
  })();

  /* ================================================================== TOPRAKLAMA */
  const topraklama = (function () {
    /** Düşey çubuk (Dwight): R = ρ/(2πL)·[ln(4L/a) − 1] */
    function rod(rho, L, d) { return rho / (2 * Math.PI * L) * (Math.log(8 * L / d) - 1); }
    /** Yatay iletken/şerit (Dwight): toplam boy Lt, derinlik h, eşdeğer yarıçap a */
    function strip(rho, Lt, h, a) {
      const L = Lt / 2, s = 2 * h;
      return rho / (4 * Math.PI * L) * (Math.log(4 * L / a) + Math.log(4 * L / s) - 2 + s / (2 * L) - s * s / (16 * L * L));
    }
    /** Ağ (IEEE 80, Sverak): Rg = ρ·[1/LT + 1/√(20A)·(1 + 1/(1 + h·√(20/A)))] */
    function mesh(rho, LT, A, h) { return rho * (1 / LT + 1 / Math.sqrt(20 * A) * (1 + 1 / (1 + h * Math.sqrt(20 / A)))); }
    const LAMBDA = { 1: 0, 2: 1, 3: 1.67, 4: 2.15, 5: 2.54, 6: 2.87, 7: 3.15, 8: 3.39, 9: 3.61, 10: 3.81 }; // BS 7430, sıra halinde çubuklar
    function rodsInLine(rho, L, d, n, s) {
      const R1 = rod(rho, L, d);
      if (n <= 1) return R1;
      const a = rho / (2 * Math.PI * R1 * s);
      return R1 * (1 + (LAMBDA[Math.min(n, 10)] || 3.81) * a) / n;
    }
    function compute(input) {
      const v = new Validator();
      const rho = v.num(input.rho, 'Toprak özdirenci', { min: 1, max: 20000, unit: 'Ω·m' });
      const type = v.oneOf(input.electrode, 'Elektrot tipi', ['rod', 'strip', 'mesh']);
      const L = v.num(input.L, 'Çubuk boyu', { min: 0.5, max: 30, unit: 'm' });
      const d = v.num(input.d, 'Çubuk çapı', { min: 0.008, max: 0.1, unit: 'm' });
      const n = Math.round(v.num(input.n, 'Çubuk sayısı', { min: 1, max: 10 }));
      const s = v.num(input.s, 'Çubuk aralığı', { min: 0.5, max: 50, unit: 'm' });
      const Lt = v.num(input.Lstrip, 'Şerit boyu', { min: 1, max: 2000, unit: 'm' });
      const h = v.num(input.h, 'Gömme derinliği', { min: 0.3, max: 3, unit: 'm' });
      const w = v.num(input.w, 'Şerit genişliği', { min: 0.01, max: 0.1, unit: 'm' });
      const meshA = v.num(input.meshA, 'Ağ alanı', { min: 4, max: 1e5, unit: 'm²' });
      const meshD = v.num(input.meshD, 'Ağ göz aralığı', { min: 1, max: 20, unit: 'm' });
      const system = v.oneOf(input.system, 'Sistem tipi', ['TT', 'TN', 'IT']);
      const IdN = v.num(input.IdN_mA, 'RCD IΔn', { min: 10, max: 3000, unit: 'mA' }) / 1000;
      const UL = v.num(input.UL, 'Sınır dokunma gerilimi UL', { min: 12, max: 50, unit: 'V' });
      const IF = v.num(input.IF, 'Topraklama arıza akımı (OG)', { min: 0, max: 100000, unit: 'A' });
      const tf = v.num(input.tf, 'Arıza süresi', { min: 0.05, max: 5, unit: 's' });
      const rhoS = v.num(input.rhoS, 'Yüzey tabakası özdirenci', { min: 1, max: 20000, unit: 'Ω·m' });
      const hs = v.num(input.hs, 'Yüzey tabakası kalınlığı', { min: 0, max: 0.5, unit: 'm' });

      let R, LT = 0, side = Math.sqrt(meshA), nMesh = 0;
      if (type === 'rod') R = rodsInLine(rho, L, d, n, s);
      else if (type === 'strip') R = strip(rho, Lt, h, w / 4);
      else {
        nMesh = Math.max(2, Math.round(side / meshD) + 1);
        LT = 2 * nMesh * side;
        R = mesh(rho, LT, meshA, h);
      }
      const GPR = IF * R;
      // IEEE 80 izin verilen dokunma/adım (50 kg)
      const Cs = hs > 0 ? 1 - 0.09 * (1 - rho / rhoS) / (2 * hs + 0.09) : 1;
      const rs = hs > 0 ? rhoS : rho;
      const Etouch = (1000 + 1.5 * Cs * rs) * 0.116 / Math.sqrt(tf);
      const Estep = (1000 + 6 * Cs * rs) * 0.116 / Math.sqrt(tf);
      // ağ için hesaplanan dokunma (Em) ve adım (Es) — IEEE 80 Sverak; diğer tiplerde yalnız GPR
      let Em = null, Es = null;
      if (type === 'mesh') {
        const D = meshD, dc = 0.01, nn = nMesh;
        const Kh = Math.sqrt(1 + h / 1);
        const Km = 1 / (2 * Math.PI) * (Math.log(D * D / (16 * h * dc) + Math.pow(D + 2 * h, 2) / (8 * D * dc) - h / (4 * dc)) + 1 / Math.pow(2 * nn, 2 / nn) / Kh * Math.log(8 / (Math.PI * (2 * nn - 1))));
        const Ki = 0.644 + 0.148 * nn;
        const Ks = 1 / Math.PI * (1 / (2 * h) + 1 / (D + h) + 1 / D * (1 - Math.pow(0.5, nn - 2)));
        Em = rho * IF * Km * Ki / LT;
        Es = rho * IF * Ks * Ki / (0.75 * LT);
      }
      const checks = [];
      if (system === 'TT') checks.push(check('tt', 'TT: RA·IΔn ≤ UL', R * IdN <= UL ? 'ok' : 'fail', 'RA·IΔn = ' + round(R * IdN, 1) + ' V (UL = ' + UL + ' V) → bu RCD için RA ≤ ' + round(UL / IdN, 0) + ' Ω', 'EİTY Madde 39 · TS HD 60364-4-41'));
      if (system === 'TN') checks.push(check('tn', 'TN: koruma iletkeni ve otomatik kesme', 'info', 'TN sisteminde kesme koşulu çevrim empedansına bağlıdır (Zs·Ia ≤ U0). Elektrot direnci tek başına kabul ölçütü değildir; Pano modülündeki hat sonu kontrolüne bakın.', 'TS HD 60364-4-41 411.4'));
      if (system === 'IT') checks.push(check('it', 'IT: ilk arıza', R * IdN <= UL ? 'ok' : 'warn', 'İlk arızada RA·Id ≤ UL koşulu (Id: ilk arıza akımı; burada IΔn alanı Id olarak kullanıldı) → ' + round(R * IdN, 1) + ' V. Yalıtım izleme cihazı gerekir.', 'TS HD 60364-4-41 411.6'));
      if (IF > 0) {
        checks.push(check('gpr', 'Topraklama potansiyel yükselmesi (GPR)', 'info', 'GPR = IF·R = ' + round(GPR, 0) + ' V'));
        if (Em !== null) {
          checks.push(check('touch', 'Ağ dokunma gerilimi Em ≤ E_dokunma (IEEE 80)', Em <= Etouch ? 'ok' : 'fail', round(Em, 0) + ' V / ' + round(Etouch, 0) + ' V', 'IEEE 80'));
          checks.push(check('step', 'Adım gerilimi Es ≤ E_adım (IEEE 80)', Es <= Estep ? 'ok' : 'fail', round(Es, 0) + ' V / ' + round(Estep, 0) + ' V', 'IEEE 80'));
        } else checks.push(check('touch', 'Dokunma/adım gerilimi', GPR <= Etouch ? 'ok' : 'warn', 'Çubuk/şerit elektrotta ayrıntılı potansiyel dağılımı hesaplanmaz. GPR ≤ izin verilen dokunma gerilimi ise güvenli tarafta kalınır; aksi halde ağ topraklama ve ölçüm gerekir.'));
        checks.push(check('ty', 'Topraklamalar Yönetmeliği', 'info', 'YG tesislerinde izin verilen dokunma gerilimi, arıza süresine bağlı olarak yönetmelikteki eğriyle (Madde 5-d, Şekil-6) ayrıca karşılaştırılmalıdır.', 'Elektrik Tesislerinde Topraklamalar Yönetmeliği'));
      }
      return result(v, { R: R, GPR: GPR, Etouch: Etouch, Estep: Estep, Em: Em, Es: Es, Cs: Cs, LT: LT, nMesh: nMesh, RAmax: UL / IdN }, checks, {
        assumptions: [
          'Homojen toprak; mevsimsel özdirenç değişimi dahil değil.',
          'Çubuk ve şerit: Dwight bağıntıları; çoklu çubuk: BS 7430 sıra katsayıları (≤ 10 çubuk).',
          'Ağ: IEEE 80 Sverak bağıntısı ve basitleştirilmiş Km, Ks, Ki katsayıları (kare ağ, kenar çubuksuz).',
          'İzin verilen dokunma/adım gerilimi IEEE 80 (50 kg) formülüyle; Türk mevzuatındaki değerlerle ayrıca karşılaştırılmalıdır.',
          'Kabul, ölçülen topraklama direnci ve tesisin sistem tipi/koruma düzeniyle değerlendirilir; tek bir sabit ohm sınırı yoktur.'
        ],
        formulas: ['R_çubuk = ρ/(2πL)·[ln(8L/d) − 1]', 'R_ağ = ρ·[1/L_T + 1/√(20A)·(1 + 1/(1 + h√(20/A)))]', 'TT: R_A·IΔn ≤ U_L', 'E_dokunma = (1000 + 1,5·Cs·ρs)·0,116/√t', 'E_adım = (1000 + 6·Cs·ρs)·0,116/√t']
      });
    }
    return { compute: compute, rod: rod, strip: strip, mesh: mesh, rodsInLine: rodsInLine };
  })();

  /* ================================================================== MOTOR / MCC / PLC */
  const motor = (function () {
    function nominal(m) {
      const In = m.Pn * 1000 / (SQRT3 * m.Un * m.eff * m.cos);
      const Tn = 9550 * m.Pn / m.nn;
      const ns = 120 * m.f / m.poles;
      const sn = (ns - m.nn) / ns;
      return { In: In, Tn: Tn, ns: ns, sn: sn };
    }
    /** Moment–kayma: s ≤ sk bölgesinde Kloss bağıntısı T(s) = 2·Tk / (s/sk + sk/s) (sk, Tk/Tn ve sn'den);
     * s > sk bölgesinde devrilme momentinden katalog kalkış momentine (Tst/Tn, s = 1) doğrusal geçiş.
     * Salt Kloss, akım yığılmalı (çift kafes) rotorlarda kalkış momentini olduğundan düşük verir (~0,8·Tn). */
    function kloss(m, nom) {
      const kk = m.TkTn, ks = m.TstTn || 2.2;
      const sk = nom.sn * (kk + Math.sqrt(kk * kk - 1));
      return s => {
        if (s <= sk) return 2 * kk * nom.Tn / (s / sk + sk / Math.max(s, 1e-4));
        return nom.Tn * (kk + (ks - kk) * (s - sk) / (1 - sk));
      };
    }
    /** Basitleştirilmiş akım–kayma: rotor akımı s/√(s²+a²) biçiminde; s=1’de Ist, s=sn’de ≈ In. */
    function currentModel(m, nom) {
      const Ist = m.IstIn * nom.In, I0 = 0.35 * nom.In;
      const Irst = Math.sqrt(Math.max(Ist * Ist - I0 * I0, 1)), Irn = Math.sqrt(Math.max(nom.In * nom.In - I0 * I0, 1));
      // Irst = K/√(1+a²), Irn = K·sn/√(sn²+a²) → a çözümü
      const r = Irn / Irst, sn = nom.sn;
      const a2 = Math.max((sn * sn - r * r * sn * sn) / (r * r - sn * sn), 1e-6);
      const K = Irst * Math.sqrt(1 + a2);
      return s => Math.sqrt(I0 * I0 + Math.pow(K * s / Math.sqrt(s * s + a2), 2));
    }
    function loadTorque(type, Tl, speedPu) { return type === 'quad' ? Tl * (0.1 + 0.9 * speedPu * speedPu) : Tl; }
    /** Yol alma benzetimi (Euler). method: DOL | YD | SOFT | VFD */
    function startup(m, method, opt) {
      const nom = nominal(m), T = kloss(m, nom), Ifn = currentModel(m, nom);
      const ws = 2 * Math.PI * nom.ns / 60;
      const J = opt.J, Tl = opt.loadPct / 100 * nom.Tn;
      const pts = [];
      let w = 0, t = 0, Imax = 0, done = null, stalled = false;
      const tYD = opt.tYD || 5;
      for (let i = 0; i < 6000 && t < 40; i++) {
        const s = clamp(1 - w / ws, 1e-4, 1);
        let Tm = T(s), I = Ifn(s);
        if (method === 'YD' && t < tYD) { Tm /= 3; I /= 3; }
        else if (method === 'SOFT') { const lim = opt.softLimit || 3; const k = Math.min(1, lim * nom.In / I); Tm *= k * k; I *= k; }
        else if (method === 'VFD') { // sabit akım sınırlı ivmelenme (V/f), rampa süresi
          const ramp = opt.ramp || 5; const fpu = Math.min(1, t / ramp); const wsyn = ws * fpu;
          const sv = clamp((wsyn - w) / ws, 0, 1);
          Tm = Math.min(1.5 * nom.Tn, nom.Tn * sv / nom.sn); // V/f: doğrusal kayma–moment bölgesi, %150 akım sınırı
          I = nom.In * Math.max(0.35, Math.min(1.5, Tm / nom.Tn));
        }
        const TL = loadTorque(opt.loadType, Tl, w / ws);
        const acc = (Tm - TL) / J;
        if (acc <= 0 && w < ws * (1 - 3 * nom.sn) && t > 0.5) { stalled = true; }
        w = clamp(w + acc * 0.01, 0, ws);
        t += 0.01; Imax = Math.max(Imax, I);
        if (i % 5 === 0) pts.push({ t: t, rpm: w * 60 / (2 * Math.PI), I: I, T: Tm });
        if (!done && w >= ws * (1 - 1.5 * nom.sn)) done = t;
        if (done && t > done + 1) break;
        if (stalled && t > 10) break;
      }
      return { pts: pts, tStart: done, Imax: Imax, stalled: stalled && !done, nom: nom };
    }
    /** IEC 60947-4-1 aşırı yük rölesi sınıfları: 7,2·Ir’de açma süresi aralığı (s). */
    const TRIP_CLASS = { '10A': [2, 10], '10': [4, 10], '20': [6, 20], '30': [9, 30] };
    function overloadAssessment(cls, Ir, I) {
      const r = I / Ir;
      if (r <= 1.05) return { trips: false, text: '≤ 1,05·Ir: 2 saat içinde açmamalıdır.' };
      if (r < 1.2) return { trips: null, text: '1,05–1,2·Ir: belirsiz bölge.' };
      if (r < 7.2) return { trips: true, text: '≥ 1,2·Ir: 2 saat içinde açmalıdır (süre akım arttıkça kısalır; cihaz eğrisine bağlı).' };
      const c = TRIP_CLASS[cls] || TRIP_CLASS['10']; return { trips: true, text: '7,2·Ir: sınıf ' + cls + ' için ' + c[0] + '–' + c[1] + ' s içinde açar.' };
    }
    /** PLC tarama döngüsü (yıldız–üçgen + acil durdurma). Saf fonksiyon: yeni durumu döndürür. */
    function plcScan(st, inp, dt, tYD) {
      const s = Object.assign({}, st);
      // girişler: start (NO, an), stop (NC: true = basılı değil), estop (NC: true = sağlam), ol (termik NC: true = normal), reset
      if (!inp.estop) { s.estopLatched = true; }
      if (s.estopLatched && inp.estop && inp.reset) s.estopLatched = false;
      const permissive = inp.stop && inp.estop && !s.estopLatched && inp.ol;
      // mühürleme (self-hold)
      s.run = permissive && (inp.start || s.run);
      if (!s.run) { s.timer = 0; s.K1 = s.K2 = s.K3 = false; s.fault = !inp.ol ? 'Termik açtı' : s.estopLatched ? 'Acil durdurma' : ''; return s; }
      s.fault = '';
      if (inp.method === 'YD') {
        s.timer += dt;
        const star = s.timer < tYD;
        // K2 (yıldız) ve K3 (üçgen) karşılıklı kilitli; geçişte 50 ms ölü zaman
        s.K1 = true;
        s.K2 = star;
        s.K3 = !star && s.timer >= tYD + 0.05 && !s.K2;
      } else { s.K1 = true; s.K2 = false; s.K3 = false; }
      if (s.K2 && s.K3) throw new Error('Kilitleme hatası: K2 ve K3 aynı anda kapalı');
      return s;
    }
    function compute(input) {
      const v = new Validator();
      const m = {
        Pn: v.num(input.Pn, 'Motor gücü', { min: 0.18, max: 1000, unit: 'kW' }),
        Un: v.num(input.Un, 'Gerilim', { min: 200, max: 1000, unit: 'V' }),
        eff: v.num(input.eff, 'Verim', { min: 0.5, max: 0.99 }),
        cos: v.num(input.cos, 'cosφ', { min: 0.5, max: 0.95 }),
        nn: v.num(input.nn, 'Anma devri', { min: 300, max: 3600, unit: 'd/dk' }),
        poles: v.oneOf(Number(input.poles), 'Kutup sayısı', [2, 4, 6, 8]),
        f: 50,
        IstIn: v.num(input.IstIn, 'Kalkış akımı Ist/In', { min: 3, max: 10 }),
        TkTn: v.num(input.TkTn, 'Devrilme momenti Tk/Tn', { min: 1.6, max: 4 }),
        TstTn: v.num(input.TstTn === undefined ? 2.2 : input.TstTn, 'Kalkış momenti Tst/Tn', { min: 0.5, max: 4 })
      };
      const ns = 120 * 50 / m.poles;
      if (m.nn >= ns) v.errors.push('Anma devri senkron devirden (' + ns + ' d/dk) küçük olmalı.');
      const method = v.oneOf(input.method, 'Yol verme', ['DOL', 'YD', 'SOFT', 'VFD']);
      const loadPct = v.num(input.loadPct, 'Yük momenti', { min: 0, max: 150, unit: '%' });
      const J = v.num(input.J, 'Toplam atalet', { min: 0.001, max: 500, unit: 'kg·m²' });
      const olCls = input.olClass || '10';
      const Ir = v.num(input.Ir, 'Termik ayarı', { min: 0.1, max: 2000, unit: 'A' });
      if (!v.errors.length) {
        const sim = startup(m, method, { J: J, loadPct: loadPct, loadType: input.loadType === 'quad' ? 'quad' : 'const', tYD: input.tYD, ramp: input.ramp, softLimit: input.softLimit });
        const nom = sim.nom;
        const Irun = nom.In * Math.max(0.35, loadPct / 100);
        const checks = [];
        checks.push(check('ir', 'Termik ayarı ≈ In', Ir >= nom.In * 0.95 && Ir <= nom.In * 1.1 ? 'ok' : 'warn', 'In = ' + round(nom.In, 1) + ' A, ayar ' + Ir + ' A' + (method === 'YD' ? ' (Y-Δ’da röle faz akımında ise In/√3 = ' + round(nom.In / SQRT3, 1) + ' A)' : '')));
        checks.push(check('start', 'Yol alma', sim.stalled || !sim.tStart ? 'fail' : sim.tStart > 10 ? 'warn' : 'ok', sim.tStart ? 'Yol alma ≈ ' + round(sim.tStart, 1) + ' s, tepe akım ≈ ' + round(sim.Imax, 0) + ' A' : 'Motor yük momentini yenemedi (devrilme/yetersiz moment).'));
        checks.push(check('ol', 'Aşırı yük rölesi (çalışma)', overloadAssessment(olCls, Ir, Irun).trips ? 'warn' : 'ok', overloadAssessment(olCls, Ir, Irun).text, 'TS EN IEC 60947-4-1'));
        if (method === 'YD') {
          const tY = input.tYD || 5, before = sim.pts.filter(p => p.t < tY);
          const nY = before.length ? before[before.length - 1].rpm : 0;
          if (nY < 0.6 * nom.ns) checks.push(check('ystar', 'Yıldızda yol alma', 'warn', 'Yıldız süresi sonunda devir ' + round(nY, 0) + ' d/dk (senkronun %' + round(nY / nom.ns * 100, 0) + '’i). Yıldızda moment 1/3’e düştüğünden yük yenilemedi; üçgene geçişte akım doğrudan yol vermeye yaklaşır.'));
        }
        if (sim.tStart && TRIP_CLASS[olCls] && sim.tStart > TRIP_CLASS[olCls][0] && sim.Imax / Ir > 5) checks.push(check('cls', 'Termik sınıfı ve yol alma süresi', 'warn', 'Yol alma ' + round(sim.tStart, 1) + ' s; sınıf ' + olCls + ' rölesi uzun kalkışta açabilir. Daha yüksek sınıf veya farklı yol verme değerlendirilmelidir.'));
        checks.push(check('safety', 'Güvenlik fonksiyonu', 'info', 'Bu PLC mantığı eğitim amaçlıdır; acil durdurma için ISO 13849-1 / IEC 62061’e göre doğrulanmış emniyet rölesi veya emniyet PLC’si gerekir.', 'ISO 13849-1'));
        return result(v, { nom: nom, sim: sim, Irun: Irun, method: method }, checks, {
          assumptions: [
            'Moment–kayma: devrilme noktasına kadar Kloss bağıntısı, ötesinde katalog kalkış momentine (Tst/Tn) doğrusal geçiş. Akım–kayma basitleştirilmiş eşdeğer devre yaklaşımı.',
            'Y-Δ’da akım ve moment 1/3; yumuşak yol vericide akım sınırı ile moment (I/Ist)² oranında; sürücüde V/f rampa ve %150 akım sınırı.',
            'Mekanik sürtünme dahil değil; yük momenti sabit veya karesel (pompa/fan).',
            'Termik röle açma süresi üretici eğrisine bağlıdır; yalnız IEC 60947-4-1 sınıf sınırları gösterilir.'
          ],
          formulas: ['In = Pn / (√3·Un·η·cosφ)', 'Tn = 9550·Pn/nn', 'ns = 120·f/p', 'T(s) = 2Tk/(s/sk + sk/s)', 'J·dω/dt = Tm − TL']
        });
      }
      return result(v, {}, []);
    }
    return { compute: compute, nominal: nominal, kloss: kloss, loadTorque: loadTorque, startup: startup, plcScan: plcScan, overloadAssessment: overloadAssessment, TRIP_CLASS: TRIP_CLASS };
  })();

  /* ================================================================== UPS / JENERATÖR / ATS */
  const ups = (function () {
    /** Akü yedekleme süresi (sabit güç): t = (V·Ah·DoD·k_sıcaklık·k_yaşlanma) / (P_yük / η_inv) */
    function runtime(o) {
      const E = o.Vbat * o.Ah * o.dod * o.kTemp * o.kAge; // Wh
      const Pdc = o.P / o.etaInv;
      return Pdc > 0 ? E / Pdc * 60 : Infinity; // dk
    }
    /** ATS durum makinesi — açık geçişli (break-before-make), şebeke ve jeneratör kesicileri hiçbir zaman birlikte kapalı olamaz. */
    function atsStep(st, inp, dt, cfg) {
      const s = Object.assign({}, st);
      s.t += dt;
      const mainsOK = inp.mains;
      switch (s.state) {
        case 'MAINS':
          s.QM = mainsOK; s.QG = false;
          if (!mainsOK) { s.state = 'CONFIRM_FAIL'; s.timer = 0; s.QM = false; }
          break;
        case 'CONFIRM_FAIL':
          s.timer += dt; s.QM = false; s.QG = false;
          if (mainsOK) { s.state = 'MAINS'; }
          else if (s.timer >= cfg.tConfirm) { s.state = 'GEN_START'; s.timer = 0; s.genRunning = true; }
          break;
        case 'GEN_START':
          s.timer += dt;
          if (mainsOK) { s.state = 'COOLDOWN'; s.timer = 0; s.QM = true; break; }
          if (s.timer >= cfg.tGenReady) { s.state = 'TRANSFER_GEN'; s.timer = 0; }
          break;
        case 'TRANSFER_GEN':
          s.timer += dt; s.QM = false;
          if (s.timer >= cfg.tDead) { s.QG = true; s.state = 'ON_GEN'; s.timer = 0; }
          break;
        case 'ON_GEN':
          if (mainsOK) { s.timer += dt; if (s.timer >= cfg.tReturn) { s.state = 'RETRANSFER'; s.timer = 0; s.QG = false; } } else s.timer = 0;
          break;
        case 'RETRANSFER':
          s.timer += dt; s.QG = false;
          if (!mainsOK) { s.state = 'TRANSFER_GEN'; s.timer = 0; }
          else if (s.timer >= cfg.tDead) { s.QM = true; s.state = 'COOLDOWN'; s.timer = 0; }
          break;
        case 'COOLDOWN':
          s.timer += dt;
          if (!mainsOK) { s.state = 'CONFIRM_FAIL'; s.timer = 0; s.QM = false; }
          else if (s.timer >= cfg.tCool) { s.genRunning = false; s.state = 'MAINS'; }
          break;
      }
      if (s.QM && s.QG) throw new Error('Kilitleme ihlali: şebeke ve jeneratör kesicisi aynı anda kapalı');
      return s;
    }
    function compute(input) {
      const v = new Validator();
      const Pcrit = v.num(input.Pcrit, 'Kritik yük', { min: 0.1, max: 5000, unit: 'kW' });
      const pfCrit = v.num(input.pfCrit, 'Kritik yük cosφ', { min: 0.5, max: 1 });
      const Pother = v.num(input.Pother, 'Jeneratöre bağlı diğer yük', { min: 0, max: 20000, unit: 'kW' });
      const pfOther = v.num(input.pfOther, 'Diğer yük cosφ', { min: 0.5, max: 1 });
      const upsKVA = v.num(input.upsKVA, 'UPS gücü', { min: 0.5, max: 5000, unit: 'kVA' });
      const upsPF = v.num(input.upsPF, 'UPS çıkış güç faktörü', { min: 0.6, max: 1 });
      const etaInv = v.num(input.etaInv, 'İnverter verimi', { min: 70, max: 99, unit: '%' }) / 100;
      const nBlocks = Math.round(v.num(input.nBlocks, 'Akü blok sayısı', { min: 1, max: 400 }));
      const Vblock = v.num(input.Vblock, 'Blok gerilimi', { min: 2, max: 48, unit: 'V' });
      const Ah = v.num(input.Ah, 'Akü kapasitesi', { min: 1, max: 5000, unit: 'Ah' });
      const strings = Math.round(v.num(input.strings || 1, 'Paralel akü grubu', { min: 1, max: 10 }));
      const dod = v.num(input.dod, 'Kullanılabilir kapasite oranı', { min: 30, max: 100, unit: '%' }) / 100;
      const kTemp = v.num(input.kTemp, 'Sıcaklık katsayısı', { min: 0.5, max: 1.1 });
      const kAge = v.num(input.kAge, 'Yaşlanma katsayısı', { min: 0.5, max: 1 });
      const genKVA = v.num(input.genKVA, 'Jeneratör gücü', { min: 5, max: 5000, unit: 'kVA' });
      const tGap = v.num(input.tGap, 'Jeneratör devreye girme süresi', { min: 1, max: 600, unit: 's' });
      const fuel = v.num(input.fuel, 'Özgül yakıt tüketimi', { min: 0.1, max: 0.5, unit: 'l/kWh' });
      const tank = v.num(input.tank, 'Yakıt deposu', { min: 10, max: 100000, unit: 'l' });
      const Scrit = Pcrit / pfCrit;
      const upsLoad = Math.max(Scrit / upsKVA, Pcrit / (upsKVA * upsPF)) * 100;
      const Vbat = nBlocks * Vblock;
      const rt = runtime({ Vbat: Vbat, Ah: Ah * strings, dod: dod, kTemp: kTemp, kAge: kAge, P: Pcrit * 1000, etaInv: etaInv });
      const upsInput = Pcrit / etaInv; // kW, akü şarjı hariç
      const genLoadKW = upsInput + Pother;
      const genLoadKVA = upsInput / 0.95 + Pother / pfOther;
      const genPct = genLoadKVA / genKVA * 100;
      const hours = fuel > 0 ? tank / (fuel * genLoadKW) : Infinity;
      const checks = [];
      checks.push(check('ups', 'UPS yüklenmesi', upsLoad <= 80 ? 'ok' : upsLoad <= 100 ? 'warn' : 'fail', '%' + round(upsLoad, 0) + ' (kVA ve kW sınırının büyüğü)', 'IEC 62040-3'));
      checks.push(check('bridge', 'Akü süresi ≥ jeneratör devreye girme', rt * 60 >= tGap * 3 ? 'ok' : rt * 60 >= tGap ? 'warn' : 'fail', 'Yedekleme ≈ ' + round(rt, 1) + ' dk; devreye girme ' + tGap + ' s'));
      checks.push(check('gen', 'Jeneratör yüklenmesi', genPct <= 80 ? 'ok' : genPct <= 100 ? 'warn' : 'fail', '%' + round(genPct, 0) + ' (' + round(genLoadKVA, 0) + ' kVA / ' + genKVA + ' kVA). Akü şarj gücü ve UPS doğrultucu harmonikleri için üretici boyutlandırma önerisi esastır.', 'ISO 8528'));
      checks.push(check('ats', 'ATS kilitleme', 'ok', 'Açık geçiş (break-before-make): şebeke ve jeneratör kesicileri elektriksel ve mekanik kilitli; senkron paralel çalışma bu modelde yoktur.', 'TS EN 60947-6-1'));
      return result(v, { Scrit: Scrit, upsLoad: upsLoad, Vbat: Vbat, runtime: rt, genLoadKW: genLoadKW, genLoadKVA: genLoadKVA, genPct: genPct, fuelHours: hours, Ebat: Vbat * Ah * strings / 1000 }, checks, {
        assumptions: [
          'Akü süresi sabit güç ve doğrusal kapasite yaklaşımıyla; Peukert etkisi, deşarj sonu gerilimi ve yüksek akımda kapasite düşüşü katsayılarla temsil edilir. Üretici deşarj tablosu esastır.',
          'UPS çift dönüşümlü (online) kabul edilir; şebeke kesintisinde yük kesintisiz aküden beslenir.',
          'Jeneratör yükü: UPS girişi (akü şarjı hariç) + diğer yükler; motor kalkışı ve adım yük kabulü dahil değil.',
          'ATS: açık geçişli; tüm süreler kullanıcı ayarıdır.'
        ],
        formulas: ['t = V·Ah·DoD·k_T·k_yaş / (P/η)', 'S = P / cosφ', 'Yakıt süresi = Depo / (q·P_jen)']
      });
    }
    return { compute: compute, runtime: runtime, atsStep: atsStep };
  })();

  /* ================================================================== YANGIN ALGILAMA (eğitim senaryosu) */
  const yangin = (function () {
    /** Duman yayılımı: ızgara üzerinde difüzyon + kaynak; tavan altı yoğunluk 0–1. Saf fonksiyon. */
    function smokeStep(grid, w, h, src, dt, walls) {
      const out = new Float32Array(grid.length);
      const D = 0.18, decay = 0.002;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (walls && walls[i]) continue;
        let sum = 0, nb = 0;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
          const xx = x + d[0], yy = y + d[1];
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) return;
          const j = yy * w + xx; if (walls && walls[j]) return;
          sum += grid[j]; nb++;
        });
        out[i] = grid[i] + D * dt * (sum - nb * grid[i]) - decay * dt * grid[i];
      }
      if (src) src.forEach(s => { const i = s.y * w + s.x; out[i] = Math.min(1, out[i] + s.rate * dt); });
      for (let i = 0; i < out.length; i++) out[i] = clamp(out[i], 0, 1);
      return out;
    }
    /** EN 54-2 kontrol paneli durumları: sessiz/normal, yangın alarm, arıza uyarısı, devre dışı, test. */
    function panelState(detectors, opts) {
      const fired = detectors.filter(d => d.state === 'alarm' && !d.disabled);
      const faults = detectors.filter(d => d.state === 'fault');
      const zones = Array.from(new Set(fired.map(d => d.zone)));
      let mode = 'normal';
      if (faults.length) mode = 'fault';
      if (opts.coincidence ? (fired.length >= 2 || opts.mcp) : (fired.length >= 1 || opts.mcp)) mode = 'fire';
      else if (opts.coincidence && fired.length === 1) mode = 'prealarm';
      return { mode: mode, zones: zones, fired: fired.length, faults: faults.length };
    }
    function compute(input) {
      const v = new Validator();
      const area = v.num(input.area, 'Alan', { min: 10, max: 100000, unit: 'm²' });
      const height = v.num(input.height, 'Tavan yüksekliği', { min: 2, max: 40, unit: 'm' });
      const nDet = Math.round(v.num(input.nDet, 'Dedektör sayısı', { min: 1, max: 2000 }));
      const sounders = Math.round(v.num(input.sounders, 'Siren sayısı', { min: 0, max: 500 }));
      const tAlarm = input.tAlarm === null || input.tAlarm === undefined ? null : v.num(input.tAlarm, 'Algılama süresi', { min: 0, max: 3600, unit: 's' });
      const occupants = Math.round(v.num(input.occupants, 'Kişi sayısı', { min: 0, max: 10000 }));
      const exitW = v.num(input.exitW, 'Toplam çıkış genişliği', { min: 0.8, max: 100, unit: 'm' });
      const dist = v.num(input.dist, 'En uzak kaçış mesafesi', { min: 1, max: 200, unit: 'm' });
      const perDet = area / nDet;
      const walk = dist / 1.2; // s, 1,2 m/s yürüme
      const flow = occupants / (exitW * 1.3); // s, 1,3 kişi/(m·s) özgül akış
      const evac = (tAlarm || 0) + 30 + Math.max(walk, flow); // 30 s tepki/hazırlık varsayımı
      const checks = [];
      checks.push(check('cov', 'Dedektör başına alan', 'info', round(perDet, 1) + ' m²/dedektör. Kapsama alanı dedektör tipi, tavan yüksekliği ve biçimine göre TSE CEN/TS 54-14’ten belirlenir; bu değer onaylı yerleşim değildir. İş Ekipmanları Yönetmeliği Ek-III de periyodik kontrolde bu standarda atıf yapar.', 'TSE CEN/TS 54-14'));
      if (height > 12) checks.push(check('h', 'Tavan yüksekliği', 'warn', height + ' m: noktasal duman dedektörleri yüksek tavanda etkinliğini yitirebilir; ışın tipi veya aspirasyonlu algılama değerlendirilmelidir.'));
      checks.push(check('panel', 'Kontrol paneli', 'info', 'Panel durumları TS EN 54-2’deki yangın alarm, arıza uyarısı, devre dışı ve test koşullarını temsil eder.', 'TS EN 54-2'));
      checks.push(check('reg', 'Yönetmelik', 'info', 'Algılama ve uyarı sistemi gerekliliği yapının kullanım sınıfına göre Binaların Yangından Korunması Hakkında Yönetmelik ile belirlenir. Güncel mevzuat doğrulaması gereklidir.', 'BYKHY'));
      return result(v, { perDet: perDet, walk: walk, flow: flow, evac: evac }, checks, {
        assumptions: ['Duman yayılımı eğitim amaçlı 2B difüzyon modelidir; yangın dinamiği (CFD) değildir.', 'Tahliye: 30 s tepki süresi, 1,2 m/s yürüme hızı, 1,3 kişi/(m·s) kapı akışı varsayımı.', 'Dedektör yerleşimi otomatik onaylı tasarım değildir.'],
        formulas: ['t_tahliye ≈ t_algılama + t_tepki + max(L/v, N/(W·Fs))']
      });
    }
    return { compute: compute, smokeStep: smokeStep, panelState: panelState };
  })();

  return {
    version: '2026.10.23',
    SQRT3: SQRT3, C: C, clamp: clamp, round: round, Validator: Validator,
    threePhaseCurrent: threePhaseCurrent, currentFromS: currentFromS, singlePhaseCurrent: singlePhaseCurrent, powerTriangle: powerTriangle,
    FUSE_GATES: FUSE_GATES, FUSE_SIZES: FUSE_SIZES, fuseAssessment: fuseAssessment, fuseI2: fuseI2, fuseConvTime: fuseConvTime,
    cableIz: cableIz, CABLE_SIZES: CABLE_SIZES, INSTALL_METHODS: INSTALL_METHODS, breakerAssessment: breakerAssessment, rcdAssessment: rcdAssessment,
    sourceImpedance: sourceImpedance, generatorImpedance: generatorImpedance, cableImpedance: cableImpedance, shortCircuit3: shortCircuit3, shortCircuit1Min: shortCircuit1Min,
    pano: pano, ges: ges, trafo: trafo, sarj: sarj, res: res, komp: komp, topraklama: topraklama, motor: motor, ups: ups, yangin: yangin
  };
});
