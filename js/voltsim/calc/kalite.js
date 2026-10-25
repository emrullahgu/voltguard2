/* VoltSim · Enerji kalitesi laboratuvarı hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.kalite (önce calc/komp.js yüklenir), Node'da require() ile; testleri tools/tests/voltsim-kalite.test.cjs.
 * Harmonik ağ modeli kompanzasyon modülüyle aynıdır (E.komp: Zs = Rs + j·h·Xs, Rs = Xs/8; kondansatör kolu Rc = 0,003·h·Xc,
 * j(h·XL − Xc/h)); ayarlı kol boyutlandırması ext.komp.detunedFilter ile yapılır. Burada ek olarak: OG şebeke empedansı,
 * sıfır bileşen (3., 9. … harmonikler üçgen bağlı bankaya girmez, Dyn trafonun yıldız tarafında nötrden döner), dalga şekli,
 * gerilim çökmesi (gerilim bölücü modeli, EN 50160 sınıflandırması), motor yol alma çökmesi ve gerilim dengesizliği (VUF). */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const E = node ? require('../engine.js') : root.VoltSimEngine;
  const KC = node ? require('./komp.js') : (E.ext && E.ext.komp);
  const api = factory(E, KC);
  if (node) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.kalite = api; }
})(typeof self !== 'undefined' ? self : this, function (E, KC) {
  'use strict';
  const C = E.C, SQRT3 = Math.sqrt(3);

  /** EN 50160 / IEC 61000-2-2 (AG) tekil harmonik gerilim değerleri (% U1) ve THDv %8 (10 dk ortalamaların %95'i, bir hafta). */
  const LIMITS = { 3: 5, 5: 6, 7: 5, 9: 1.5, 11: 3.5, 13: 3, 15: 0.5, 17: 2, 19: 1.5, 21: 0.5, 23: 1.5, 25: 1.5 };
  const THD_LIMIT = 8;
  /** Örnek yük harmonik akım spektrumları (% I1) ve faz işaretleri (dalga şekli için; THD'yi etkilemez). */
  const SPECTRA = {
    vfd6: { label: '6 darbeli sürücü (şoksuz)', h: { 3: 0, 5: 60, 7: 38, 11: 9, 13: 6 } },
    vfd6c: { label: '6 darbeli sürücü (DC şoklu)', h: { 3: 0, 5: 33, 7: 11, 11: 7.5, 13: 5 } },
    vfd12: { label: '12 darbeli sürücü', h: { 3: 0, 5: 3, 7: 2, 11: 8, 13: 5 } },
    smps: { label: 'Tek fazlı SMPS / LED / bilgisayar', h: { 3: 80, 5: 60, 7: 40, 11: 15, 13: 10 } },
    mix: { label: 'Karma tesis', h: { 3: 8, 5: 18, 7: 8, 11: 4, 13: 3 } },
    none: { label: 'Doğrusal yük', h: { 3: 0, 5: 0, 7: 0, 11: 0, 13: 0 } }
  };
  // 6 darbeli doğrultucu akımının Fourier serisi: sin ωt − sin5ωt/5 − sin7ωt/7 + sin11ωt/11 + sin13ωt/13 …; tek fazlı (tepe akımlı) yükte 3. ters işaretli
  const SIGN = { 3: -1, 5: -1, 7: -1, 9: 1, 11: 1, 13: 1, 15: -1, 17: -1, 19: -1 };

  /** Ağ: bara (AG) empedansları, kondansatör/ayarlı kol ve kısa devre gücü. */
  function network(o) {
    const U = o.U_LL, Sr = o.Sr_kVA * 1e3;
    const XT = (o.uk / 100) * U * U / Sr;
    const XQ = o.SkQ_MVA > 0 ? 1.1 * U * U / (o.SkQ_MVA * 1e6) : 0; // OG şebeke, AG'ye indirgenmiş (c = 1,1)
    const Xs = XT + XQ, Rs = Xs / 8;
    const Ssc = U * U / Math.hypot(Rs, Xs) / 1e3;                 // kVA (AG bara kısa devre gücü, c = 1)
    const Q = Math.max(0, o.Qc_kvar || 0), p = Math.max(0, o.p || 0);
    let Xc = Infinity, XL = 0, filt = null;
    if (Q > 0) {
      if (p > 0) { filt = KC.detunedFilter({ U_LL: U, Q_kvar: Q, p: p }); Xc = filt.Xc; XL = filt.XL; }
      else Xc = U * U / (Q * 1e3);
    }
    return { U: U, V1: U / SQRT3, XT: XT, XQ: XQ, Xs: Xs, Rs: Rs, Ssc: Ssc, Q: Q, p: p, Xc: Xc, XL: XL, filt: filt,
      hr: Q > 0 ? Math.sqrt(Ssc / Q) : null,                       // basit paralel rezonans: h_r = √(Ssc/Qc)
      hPar: Q > 0 ? Math.sqrt(Xc / (Xs + XL)) : null,               // kaynak ∥ kol paralel rezonansı
      hSer: Q > 0 && p > 0 ? 1 / Math.sqrt(p) : null };              // kol seri ayar mertebesi
  }
  /** Pozitif/negatif bileşen harmonikleri için bara empedansı ve akım bölüşümü (motorun kompanzasyon modeliyle aynı). */
  function zAt(net, h) {
    const Zs = C.of(net.Rs, h * net.Xs);
    if (!isFinite(net.Xc)) return { Zbus: Zs, Zs: Zs, Zc: null, ks: C.of(1, 0), kc: C.of(0, 0) };
    const Zc = C.of(net.Xc * 0.003 * h, h * net.XL - net.Xc / h);
    const sum = C.add(Zs, Zc);
    return { Zbus: C.div(C.mul(Zs, Zc), sum), Zs: Zs, Zc: Zc, ks: C.div(Zc, sum), kc: C.div(Zs, sum) };
  }
  /** Sıfır bileşen (3·k) harmonikleri: üçgen bağlı banka yol vermez; Dyn trafoda Z0 ≈ ZT (OG şebekesi görünmez). */
  function z0At(net, h) { return C.of(net.XT / 8, h * net.XT); }
  const triplen = h => h % 3 === 0;

  /** Harmonik dağılımı. spec: { h: % I1 }, I1: yük temel akımı (A), phi1: yük temel akım açısı (rad). */
  function harmonics(net, I1, spec, phi1) {
    let sV = 0, sIl = 0, sIs = 0, sIc = 0, sIn = 0;
    const rows = Object.keys(spec || {}).map(Number).filter(h => h > 1).sort((a, b) => a - b).map(h => {
      const Ih = I1 * Math.max(0, Number(spec[h]) || 0) / 100;
      const sign = SIGN[h] || 1;
      const Iph = C.polar(Ih, -h * (phi1 || 0) + (sign < 0 ? Math.PI : 0)); // yükün çektiği akım fazörü
      let Z, Is, Ic;
      if (triplen(h)) { Z = z0At(net, h); Is = Iph; Ic = C.of(0, 0); }
      else { const z = zAt(net, h); Z = z.Zbus; Is = C.mul(Iph, z.ks); Ic = C.mul(Iph, z.kc); }
      const V = C.scale(C.mul(Z, Iph), -1); // bara gerilimi: yükün çektiği harmonik akım şebeke empedansında düşüm yaratır
      const Vh = C.abs(V), IsH = C.abs(Is), IcH = C.abs(Ic);
      sV += Vh * Vh; sIl += Ih * Ih; sIs += IsH * IsH; sIc += IcH * IcH; if (triplen(h)) sIn += Ih * Ih;
      return { h: h, Ih: Ih, Iph: Iph, V: V, Vh: Vh, VhPct: Vh / net.V1 * 100, Isupply: IsH, Icap: IcH, Z: C.abs(Z), amp: Ih > 0 ? IsH / Ih : 1, limit: LIMITS[h] || null, zero: triplen(h) };
    });
    return { rows: rows, THDv: Math.sqrt(sV) / net.V1 * 100, THDiLoad: I1 > 0 ? Math.sqrt(sIl) / I1 * 100 : 0, sumIs2: sIs, sumIc2: sIc,
      Ineutral: 3 * Math.sqrt(sIn), Irms: Math.sqrt(I1 * I1 + sIl), Vrms: Math.sqrt(net.V1 * net.V1 + sV) };
  }

  /** Dalga şekli: n örnek, 'cycles' periyot. Gerilim faz–nötr (V), akım hat akımı (A). */
  function waveform(net, I1, phi1, harm, n, cycles) {
    n = n || 400; cycles = cycles || 2;
    const v = [], i = [];
    let vPk = 0, iPk = 0;
    for (let k = 0; k <= n; k++) {
      const wt = 2 * Math.PI * cycles * k / n;
      let vv = SQRT3 > 0 ? Math.SQRT2 * net.V1 * Math.sin(wt) : 0, ii = Math.SQRT2 * I1 * Math.sin(wt - (phi1 || 0));
      harm.rows.forEach(r => {
        vv += Math.SQRT2 * r.Vh * Math.sin(r.h * wt + Math.atan2(r.V.im, r.V.re));
        ii += Math.SQRT2 * r.Ih * Math.sin(r.h * wt + Math.atan2(r.Iph.im, r.Iph.re));
      });
      v.push([k / n * cycles * 20, vv]); i.push([k / n * cycles * 20, ii]);
      vPk = Math.max(vPk, Math.abs(vv)); iPk = Math.max(iPk, Math.abs(ii));
    }
    return { v: v, i: i, vPk: vPk, iPk: iPk, vCF: vPk / harm.Vrms, iCF: harm.Irms > 0 ? iPk / harm.Irms : Math.SQRT2 };
  }

  /** Frekans tepkisi: bara empedansı |Z(h)| (kondansatörlü ve kondansatörsüz) ve kol empedansı |Zc(h)|. */
  function freqResponse(net, hMax, step) {
    const out = []; hMax = hMax || 25; step = step || 0.05;
    for (let h = 1; h <= hMax + 1e-9; h += step) {
      const z = zAt(net, h);
      out.push({ h: h, bus: C.abs(z.Zbus), src: C.abs(z.Zs), branch: z.Zc ? C.abs(z.Zc) : null });
    }
    return out;
  }
  /** Aynı etkin güçte farklı ayar oranlarının (p) kol empedansı |h·XL − Xc/h| (Ω). */
  function branchCurve(U, Q_kvar, p, hMax, step) {
    const f = p > 0 ? KC.detunedFilter({ U_LL: U, Q_kvar: Q_kvar, p: p }) : { Xc: U * U / (Q_kvar * 1e3), XL: 0 };
    const out = []; for (let h = 1; h <= (hMax || 25) + 1e-9; h += step || 0.05) out.push([h, Math.abs(h * f.XL - f.Xc / h) + f.Xc * 0.003 * h]);
    return out;
  }

  /* ---------------------------------------------------------------- gerilim çökmesi / yükselmesi */
  /** Radyal OG şebekede komşu fiderde üç faz arıza: ortak bağlantı noktasında kalan gerilim (gerilim bölücü, Bollen):
   *  V = |ZF| / |ZS + ZF|. ZS: OG bara kaynak empedansı (Sk, X/R), ZF: baradan arızaya hat empedansı. */
  function sagDivider(o) {
    const U = o.U_kV * 1e3, Zs = U * U / (o.Sk_MVA * 1e6), xr = o.xr || 10;
    const ZS = C.polar(Zs, Math.atan(xr));
    const ZF = C.of(o.r_ohm_km * o.L_km, o.x_ohm_km * o.L_km);
    const ratio = C.abs(ZF) / C.abs(C.add(ZS, ZF));
    return { u: ratio * 100, ZS: Zs, ZF: C.abs(ZF), Ik_kA: o.U_kV / (SQRT3 * C.abs(C.add(ZS, ZF))) };
  }
  /** Motor yol alma çökmesi (AG bara): ΔU ≈ S_yolalma / (Sk + S_yolalma) (empedans açıları benzer kabulü). */
  function motorStartDip(o) {
    const In = o.P_kW * 1e3 / (SQRT3 * o.U_LL * o.eff * o.cos);
    const Ist = In * o.kStart;
    const Sst = SQRT3 * o.U_LL * Ist / 1e3;
    const d = Sst / (o.Sk_kVA + Sst) * 100;
    return { In: In, Ist: Ist, Sst_kVA: Sst, dU: d, u: 100 - d };
  }
  /** EN 50160 çökme sınıflandırma tablosu hücresi (AG): kalan gerilim satırı × süre sütunu; olay tipi. */
  const DIP_ROWS = [[90, 80], [80, 70], [70, 40], [40, 5], [5, 0]];
  const DIP_COLS = [[10, 200], [200, 500], [500, 1000], [1000, 5000], [5000, 60000]];
  function classify(uPct, tMs) {
    if (uPct > 110) return { type: 'swell', label: 'Gerilim yükselmesi (> %110 Uref)' };
    if (uPct >= 90) return { type: 'normal', label: 'Olay yok (%90–%110 Uref)' };
    if (uPct < 5) return { type: 'interruption', label: tMs <= 180000 ? 'Kısa kesinti (< %5, ≤ 3 dk)' : 'Uzun kesinti (> 3 dk)', row: 4, col: colOf(tMs) };
    const row = DIP_ROWS.findIndex(r => uPct < r[0] && uPct >= r[1]);
    return { type: 'dip', label: 'Gerilim çökmesi', row: row, col: colOf(tMs) };
  }
  function colOf(t) { const i = DIP_COLS.findIndex(c => t >= c[0] && t <= c[1]); return i < 0 ? (t < 10 ? -1 : 5) : i; }
  /** SEMI F47 (yarı iletken ekipmanı) dayanım zarfının içinde mi? 50 % · 200 ms, 70 % · 500 ms, 80 % · 1 s. */
  function insideF47(uPct, tMs) { return uPct >= 90 || (tMs <= 1000 && uPct >= 80) || (tMs <= 500 && uPct >= 70) || (tMs <= 200 && uPct >= 50); }
  /** Basit kontaktör bırakma modeli (kullanıcı girdisi eşik ve gecikme): kalan gerilim eşiğin altında ve süre gecikmeden uzunsa bırakır. */
  function contactorDrops(uPct, tMs, thrPct, delayMs) { return uPct < thrPct && tMs > delayMs; }

  /* ---------------------------------------------------------------- gerilim dengesizliği */
  /** Faz arası gerilim genliklerinden negatif/pozitif bileşen oranı (IEC 61000-4-30 / EN 50160 bağıntısı):
   *  β = (Uab⁴ + Ubc⁴ + Uca⁴)/(Uab² + Ubc² + Uca²)², VUF = √((1 − √(3 − 6β))/(1 + √(3 − 6β))). */
  function vuf(a, b, c) {
    const s2 = a * a + b * b + c * c, beta = (Math.pow(a, 4) + Math.pow(b, 4) + Math.pow(c, 4)) / (s2 * s2);
    const r = Math.sqrt(Math.max(0, 3 - 6 * beta));
    return Math.sqrt(Math.max(0, (1 - r) / (1 + r))) * 100;
  }
  /** NEMA tanımı: ortalamadan en büyük sapma / ortalama (%). */
  function lvur(a, b, c) { const m = (a + b + c) / 3; return Math.max(Math.abs(a - m), Math.abs(b - m), Math.abs(c - m)) / m * 100; }
  /** Asenkron motorda negatif bileşen akımı: Z2 ≈ Z_kilitli rotor ≈ 1/(Ist/In) pu → I2/In ≈ VUF·(Ist/In). */
  function motorI2(vufPct, kStart) { return vufPct * kStart; }
  /** Faz arası gerilimleri simetrik bileşenlerden üretir (test ve senaryolar için): U1, U2 (V, faz arası), açı (rad). */
  function lineVoltagesFrom(U1, U2, ang) {
    const a = C.polar(1, 2 * Math.PI / 3), a2 = C.polar(1, -2 * Math.PI / 3);
    const P = C.of(U1, 0), N = C.polar(U2, ang || 0);
    const ab = C.add(P, N), bc = C.add(C.mul(a2, P), C.mul(a, N)), ca = C.add(C.mul(a, P), C.mul(a2, N));
    return [C.abs(ab), C.abs(bc), C.abs(ca)];
  }

  /* ---------------------------------------------------------------- tam laboratuvar hesabı */
  function compute(input) {
    const v = new E.Validator();
    const U = v.num(input.U_LL, 'Gerilim', { min: 200, max: 1000, unit: 'V' });
    const o = {
      U_LL: U, Sr_kVA: v.num(input.Sr_kVA, 'Trafo gücü', { min: 25, max: 5000, unit: 'kVA' }),
      uk: v.num(input.uk, 'Trafo uk', { min: 2, max: 12, unit: '%' }),
      SkQ_MVA: v.num(input.SkQ_MVA, 'OG kısa devre gücü', { min: 0, max: 5000, unit: 'MVA' }),
      Qc_kvar: input.capOn ? v.num(input.Qc_kvar, 'Kondansatör gücü', { min: 0, max: 5000, unit: 'kVAr' }) : 0,
      p: v.num(input.p, 'Ayar oranı p', { min: 0, max: 14, unit: '%' }) / 100
    };
    const P = v.num(input.P_kW, 'Doğrusal olmayan yük gücü', { min: 0, max: 5000, unit: 'kW' });
    const cos = v.num(input.cos, 'Yük cosφ', { min: 0.5, max: 1 });
    const spec = {}; Object.keys(input.harm || {}).forEach(h => { spec[h] = v.num(input.harm[h], h + '. harmonik', { min: 0, max: 120, unit: '%' }); });
    if (v.errors.length) return { ok: false, errors: v.errors, warnings: [], checks: [], values: {} };
    const net = network(o);
    const I1 = P > 0 ? P * 1e3 / (SQRT3 * U * cos) : 0, phi1 = Math.acos(cos);
    const hm = harmonics(net, I1, spec, phi1);
    const wf = waveform(net, I1, phi1, hm, 360, 2);
    const Ic1 = net.Q > 0 ? net.Q * 1e3 / (SQRT3 * U) * (net.p > 0 ? 1 : 1) : 0;
    const capOver = Ic1 > 0 ? Math.sqrt(Ic1 * Ic1 + hm.sumIc2) / Ic1 : 1;
    const Qnet = P * Math.tan(phi1) - net.Q;
    const I1s = Math.hypot(P, Qnet) * 1e3 / (SQRT3 * U);
    const THDiSupply = I1s > 0 ? Math.sqrt(hm.sumIs2) / I1s * 100 : 0;
    // çökme ve dengesizlik
    const sag = sagDivider({ U_kV: v.num(input.mvU_kV, 'OG gerilimi', { min: 1, max: 40, unit: 'kV' }), Sk_MVA: v.num(input.mvSk_MVA, 'OG bara kısa devre gücü', { min: 10, max: 5000, unit: 'MVA' }), xr: 10,
      r_ohm_km: v.num(input.line_r, 'Hat direnci', { min: 0.01, max: 2, unit: 'Ω/km' }), x_ohm_km: v.num(input.line_x, 'Hat reaktansı', { min: 0.05, max: 1, unit: 'Ω/km' }), L_km: v.num(input.faultKm, 'Arıza uzaklığı', { min: 0, max: 60, unit: 'km' }) });
    const tSag = v.num(input.sagMs, 'Arıza temizleme süresi', { min: 10, max: 60000, unit: 'ms' });
    const kStart = v.num(input.kStart, 'Yol alma akımı', { min: 1, max: 9, unit: '×In' });
    const motor = motorStartDip({ U_LL: U, P_kW: v.num(input.motorKW, 'Motor gücü', { min: 0.5, max: 3000, unit: 'kW' }), eff: 0.94, cos: 0.86, kStart: kStart, Sk_kVA: net.Ssc });
    const ev = input.event === 'motor' ? { u: motor.u, t: v.num(input.motorMs, 'Yol alma süresi', { min: 50, max: 30000, unit: 'ms' }), src: 'motor' }
      : input.event === 'swell' ? { u: v.num(input.swellPct, 'Yükselme', { min: 100, max: 180, unit: '%' }), t: tSag, src: 'swell' }
        : input.event === 'interruption' ? { u: 0, t: tSag, src: 'kesinti' } : { u: sag.u, t: tSag, src: 'og' };
    const cls = classify(ev.u, ev.t);
    const thr = v.num(input.dropPct, 'Kontaktör bırakma eşiği', { min: 30, max: 90, unit: '%' }), dly = v.num(input.dropMs, 'Kontaktör bırakma gecikmesi', { min: 0, max: 500, unit: 'ms' });
    const drops = contactorDrops(ev.u, ev.t, thr, dly);
    const Uab = v.num(input.Uab, 'Uab', { min: 300, max: 500, unit: 'V' }), Ubc = v.num(input.Ubc, 'Ubc', { min: 300, max: 500, unit: 'V' }), Uca = v.num(input.Uca, 'Uca', { min: 300, max: 500, unit: 'V' });
    if (v.errors.length) return { ok: false, errors: v.errors, warnings: [], checks: [], values: {} };
    const VUF = vuf(Uab, Ubc, Uca), LVUR = lvur(Uab, Ubc, Uca), I2 = motorI2(VUF, kStart);
    const checks = [];
    const f = (x, d) => E.round(x, d === undefined ? 1 : d).toString().replace('.', ',');
    const ck = (id, label, status, detail, ref) => checks.push({ id: id, label: label, status: status, detail: detail, ref: ref || null });
    ck('thdv', 'THDv (AG bara, hesaplanan)', hm.THDv <= 5 ? 'ok' : hm.THDv <= THD_LIMIT ? 'warn' : 'fail', '%' + f(hm.THDv, 2) + ' · EN 50160 / IEC 61000-2-2: THD ≤ %8 (10 dakikalık ortalamaların %95’i, bir hafta). Anlık hesap istatistiksel ölçümün yerine geçmez.', 'EN 50160 · IEC 61000-2-2');
    const over = hm.rows.filter(r => r.limit && r.VhPct > r.limit);
    ck('vh', 'Tekil harmonik gerilimler', over.length ? 'fail' : 'ok', over.length ? over.map(r => r.h + '.: %' + f(r.VhPct, 2) + ' > %' + f(r.limit)).join(', ') : 'Tüm tekil harmonikler EN 50160 değerlerinin altında.', 'EN 50160 Tablo 1');
    if (net.Q > 0) {
      const near = [5, 7, 11, 13].find(h => Math.abs(net.hPar - h) < 0.6);
      ck('res', 'Paralel rezonans', net.p > 0 ? (net.hPar < 4.6 ? 'ok' : 'warn') : near ? 'fail' : (hm.rows.some(r => !r.zero && r.amp > 1.2) ? 'warn' : 'info'),
        'h_r = √(Ssc/Qc) = √(' + f(net.Ssc, 0) + '/' + f(net.Q, 0) + ') ≈ ' + f(net.hr, 2) + (net.p > 0 ? ' · ayarlı kol: kaynak ∥ kol rezonansı h ≈ ' + f(net.hPar, 2) + ', kol seri ayarı h = ' + f(net.hSer, 2) + ' (' + f(50 * net.hSer, 0) + ' Hz)' : near ? ' · ' + near + '. harmoniğe çok yakın: rezonans ile harmonik büyür' : ''));
      ck('cap', 'Kondansatör akım yüklenmesi', capOver <= 1.3 ? 'ok' : 'fail', f(capOver, 2) + '·In (IEC 60831-1: sürekli ≤ 1,3·In)', 'IEC 60831-1');
    }
    if (hm.Ineutral > 0) ck('n', 'Nötr akımı (sıfır bileşen harmonikleri)', hm.Ineutral > I1 * 0.5 ? 'warn' : 'info', 'IN ≈ 3·I3 = ' + f(hm.Ineutral, 0) + ' A (faz akımı rms ' + f(hm.Irms, 0) + ' A). Dengeli tek fazlı doğrusal olmayan yüklerde 3. harmonik nötrde toplanır; nötr kesiti faz kesitinden küçük seçilmemelidir.', 'TS HD 60364-5-52 (523.6)');
    ck('ev', 'Gerilim olayı: ' + cls.label, cls.type === 'normal' ? 'ok' : cls.type === 'swell' || cls.type === 'interruption' ? 'warn' : ev.u >= 70 ? 'info' : 'warn',
      'Kalan gerilim %' + f(ev.u, 0) + ' · süre ' + f(ev.t, 0) + ' ms' + (cls.type === 'dip' ? ' · EN 50160 sınıflandırma tablosu satır ' + (cls.row + 1) + ', sütun ' + (cls.col + 1) : '') + '. EN 50160 çökme sayısı için sınır vermez; tablo istatistik raporlama içindir.', 'EN 50160 · IEC 61000-4-30');
    ck('f47', 'SEMI F47 dayanım zarfı (örnek ekipman eğrisi)', insideF47(ev.u, ev.t) ? 'ok' : 'warn', insideF47(ev.u, ev.t) ? 'Olay %50·200 ms / %70·500 ms / %80·1 s zarfının içinde.' : 'Olay zarfın dışında: hassas ekipman durabilir. Ekipmanın gerçek dayanımı üreticiden alınmalıdır.', 'SEMI F47');
    ck('drop', 'Kontaktör bırakma (model)', drops ? 'warn' : 'ok', drops ? 'Kalan gerilim %' + f(ev.u, 0) + ' < eşik %' + f(thr, 0) + ' ve süre ' + f(ev.t, 0) + ' ms > ' + f(dly, 0) + ' ms: motor kontaktörleri bırakır, üretim durur.' : 'Kontaktörler tutar (eşik %' + f(thr, 0) + ', gecikme ' + f(dly, 0) + ' ms — kullanıcı girdisi).');
    ck('vuf', 'Gerilim dengesizliği (u2)', VUF <= 2 ? 'ok' : VUF <= 3 ? 'warn' : 'fail', 'VUF = U2/U1 = %' + f(VUF, 2) + ' (NEMA LVUR %' + f(LVUR, 2) + ') · EN 50160: 10 dakikalık ortalamaların %95’i ≤ %2 (bazı bölgelerde %3). Motor negatif bileşen akımı ≈ VUF·Ist/In = %' + f(I2, 1) + '·In.', 'EN 50160');
    return {
      ok: true, errors: [], warnings: [], checks: checks,
      values: { net: net, I1: I1, phi1: phi1, hm: hm, wf: wf, capOver: capOver, Qnet: Qnet, THDiSupply: THDiSupply, sag: sag, motor: motor, ev: ev, cls: cls, drops: drops, VUF: VUF, LVUR: LVUR, I2: I2, P: P },
      assumptions: [
        'Harmonik ağ modeli kompanzasyon simülasyonuyla aynıdır: Zs = Rs + j·h·Xs (Rs = Xs/8), kondansatör kolu Rc = 0,003·h·Xc, ayarlı kolda XL = p·Xc; yük harmonik akım kaynağıdır.',
        'OG şebeke empedansı AG’ye indirgenir (c = 1,1); 3., 9. … (sıfır bileşen) harmonikler üçgen bağlı kondansatöre girmez, Dyn trafonun AG yıldız noktasından döner (Z0 ≈ ZT).',
        'Harmonik faz açıları örnek yük tipinden (6 darbeli doğrultucu / tek fazlı tepe akımlı yük) alınır; dalga şekli ve tepe faktörü bu açılara bağlıdır, THD bağlı değildir.',
        'Arka plan (şebekeden gelen) harmonik gerilim, kablo kapasitansları, diğer tesisler ve frekansa bağlı direnç artışı dahil değildir.',
        'Gerilim çökmesi: komşu OG fiderinde üç faz arıza, gerilim bölücü modeli (X/R = 10); Dyn trafo üç fazlı çökmeyi AG’ye aynı oranda taşır. Faz–toprak arızalarında çökme tipi değişir (modellenmez).',
        'Motor yol alma çökmesi ΔU ≈ S_yolalma/(Sk + S_yolalma); yol alma cosφ ve trafo/kablo açıları benzer kabul edilir.',
        'Kontaktör bırakma eşiği ve gecikmesi kullanıcı girdisidir; gerçek değer bobin, besleme ve üreticiye göre değişir.',
        'Sınır değerler EN 50160 / IEC 61000-2-2 (AG) istatistiksel şebeke karakteristikleridir; anlık simülasyon sonucu ile doğrudan uygunluk kararı verilemez. Uygunluk IEC 61000-4-30 Sınıf A ölçümüyle değerlendirilir.'
      ],
      formulas: ['h_r = √(Ssc/Qc)', 'h_r,paralel = √(Xc/(Xs + XL)), f_ayar = 50/√p', 'Vh = |Z(h)|·Ih', 'THDv = √(Σ Vh²)/V1', 'IN ≈ 3·√(Σ I3k²)', 'V_çökme = |ZF|/|ZS + ZF|', 'VUF = √((1 − √(3 − 6β))/(1 + √(3 − 6β)))', 'I2/In ≈ VUF·Ist/In']
    };
  }

  return { compute: compute, network: network, zAt: zAt, z0At: z0At, harmonics: harmonics, waveform: waveform, freqResponse: freqResponse, branchCurve: branchCurve,
    sagDivider: sagDivider, motorStartDip: motorStartDip, classify: classify, insideF47: insideF47, contactorDrops: contactorDrops, vuf: vuf, lvur: lvur, motorI2: motorI2, lineVoltagesFrom: lineVoltagesFrom,
    LIMITS: LIMITS, THD_LIMIT: THD_LIMIT, SPECTRA: SPECTRA, DIP_ROWS: DIP_ROWS, DIP_COLS: DIP_COLS };
});
