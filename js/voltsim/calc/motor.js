/* VoltSim · motor ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.motor, Node'da require() ile kullanılır; testleri tools/tests/voltsim-motor.test.cjs.
 * Buradaki bağıntılar eğitim amaçlı yaklaşık modellerdir; her fonksiyon varsayımını açıklamasında belirtir. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.motor = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const SQRT3 = Math.sqrt(3);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /** Termik röle için TEMSİLİ açma gecikmesi (s). r = I/Ir.
   * r ≥ 7,2: IEC 60947-4-1 sınıf aralığının üst sınırı; 1,2 ≤ r < 7,2: üst sınırdan I²t ölçekli, gösterim için en çok cap (30 s).
   * r < 1,2: açma beklenmez (Infinity). Gerçek süre üretici eğrisine bağlıdır. */
  function olDelay(cls, r, cap) {
    const tc = (E.motor.TRIP_CLASS[cls] || E.motor.TRIP_CLASS['10']);
    if (!(r >= 1.2)) return Infinity;
    if (r >= 7.2) return tc[1];
    return Math.min(cap === undefined ? 30 : cap, tc[1] * Math.pow(7.2 / r, 2));
  }

  /** TEMSİLİ serbest duruş adımı: J·dω/dt = −(T_yük + T_sürtünme). Devir (d/dk) döner; sıfırın altına inmez. */
  function coastStep(rpm, dt, J, Tload, Tfric) {
    if (!(rpm > 0) || !(J > 0)) return 0;
    const w = rpm * 2 * Math.PI / 60 - (Math.max(0, Tload) + Math.max(0, Tfric || 0)) / J * dt;
    return Math.max(0, w * 60 / (2 * Math.PI));
  }

  /** Tek faz kalma (faz kaybı). Çalışan motor aynı yükü taşımaya devam ederse kalan iki hat iletkeninden
   * yaklaşık √3 katı akım geçer (yıldız/üçgen bağlı, yaklaşık; sargı içi dağılım ihmal). Duran motor dönen alan
   * oluşmadığı için kalkamaz; kilitli rotorda hat akımı ≈ (√3/2)·Ist. */
  function singlePhasing(o) {
    if (o.running) return { I: o.I * SQRT3, factor: SQRT3, canStart: true, note: 'Çalışırken faz kaybı: kalan iki fazda akım ≈ √3·I.' };
    return { I: o.Ist * SQRT3 / 2, factor: SQRT3 / 2, canStart: false, note: 'Duran motor tek fazda kalkamaz: kilitli rotor, I ≈ (√3/2)·Ist.' };
  }

  /** Kilitli (sıkışmış) rotor: kayma 1, akım kalkış akımında kalır; mil gücü sıfır, kayıplar ısıya dönüşür. */
  function lockedRotor(Ist) { return { I: Ist, rpm: 0, note: 'Kilitli rotor: I = Ist, devir 0.' }; }

  /** Gerilim sapması (u = U/Un). Moment ∝ U² (Tk, Tst); kalkış akımı ∝ U; sabit mil gücünde çalışma akımı ≈ ∝ 1/u
   * (aktif bileşen yaklaşımı). Girdi katsayıları motor.compute'a ölçeklenmiş olarak verilir. */
  function voltageEffect(u, m) {
    const k2 = u * u;
    return { torqueFactor: k2, startCurrentFactor: u, runCurrentFactor: 1 / u,
      TkTn: Math.max(1.6, m.TkTn * k2), TstTn: Math.max(0.5, m.TstTn * k2), IstIn: Math.max(3, m.IstIn * u), clamped: m.TkTn * k2 < 1.6 };
  }

  /** Frekans konvertöründe hız ayar noktası (sp = n/nn, afinite yasaları). Karesel yükte T ∝ sp², P ∝ sp³;
   * sabit momentli yükte T sabit, P ∝ sp. Akım: mıknatıslanma (0,35·In) ile moment bileşeninin vektörel toplamı (yaklaşık). */
  function vfdOperating(sp, quad, Irun, In) {
    sp = clamp(sp, 0, 1.2);
    const tf = quad ? sp * sp : 1, pf = quad ? sp * sp * sp : sp;
    const I0 = 0.35 * In, Iq0 = Math.sqrt(Math.max(Irun * Irun - I0 * I0, 0));
    return { speedFactor: sp, torqueFactor: tf, powerFactor: pf, I: Math.sqrt(I0 * I0 + Math.pow(Iq0 * tf, 2)), f: 50 * sp };
  }

  /** Pompa/fan debi kontrolü enerji karşılaştırması.
   * Kısma (vana/damper): P/P100 ≈ a + b·q (varsayılan 0,45 + 0,55·q; tipik santrifüj pompa eğrisi yaklaşımı).
   * VFD: P/P100 = q³ (afinite, statik basma yüksekliği yok), sürücü verimi ηvfd.
   * o: { P100 (kW mil gücü %100 debide), q (0–1), etaMotor, etaVfd, hours (h/yıl), price (TL/kWh), a, b } */
  function energyCompare(o) {
    const a = o.a === undefined ? 0.45 : o.a, b = o.b === undefined ? 0.55 : o.b;
    const q = clamp(o.q, 0, 1.2), em = o.etaMotor || 0.92, ev = o.etaVfd || 0.97;
    const Pth = o.P100 * (a + b * q) / em;
    const Pvfd = o.P100 * q * q * q / (em * ev);
    const Eth = Pth * o.hours, Evfd = Pvfd * o.hours;
    return { Pthrottle: Pth, Pvfd: Pvfd, Ethrottle: Eth, Evfd: Evfd, saving: Eth - Evfd, savingPct: Eth > 0 ? (Eth - Evfd) / Eth * 100 : 0,
      cost: (Eth - Evfd) * (o.price || 0), costThrottle: Eth * (o.price || 0), costVfd: Evfd * (o.price || 0) };
  }
  /** Debiye göre şebekeden çekilen güç eğrileri (grafik için): [[q%, P_kısma], …], [[q%, P_vfd], …]. */
  function energyCurves(o, n) {
    n = n || 20; const th = [], vf = [];
    for (let i = 0; i <= n; i++) { const q = 0.3 + 0.7 * i / n; const r = energyCompare(Object.assign({}, o, { q: q })); th.push([q * 100, r.Pthrottle]); vf.push([q * 100, r.Pvfd]); }
    return { throttle: th, vfd: vf };
  }

  /** Kullanıcı PLC programının Y-Δ çıkış İSTEĞİ (eğitim). interlock=false iken program K2’nin bırakmasını beklemez:
   * K2 bobini düşse de kontakları mekanik bırakma süresi (dropout) boyunca kapalı kalırken K3 kapanmak ister. */
  function ydRequest(timer, tYD, interlock, dead, dropout) {
    dead = dead === undefined ? 0.05 : dead; dropout = dropout === undefined ? 0.06 : dropout;
    if (interlock) return { K2: timer < tYD, K3: timer >= tYD + dead };
    return { K2: timer < tYD + dropout, K3: timer >= tYD };
  }
  /** Çıkış denetimi: K2 ve K3 aynı anda kapalıysa (faz–faz kısa devre) hata fırlatır; engine plcScan ile aynı kural. */
  function guardOutputs(o) {
    if (o.K2 && o.K3) throw new Error('Kilitleme hatası: K2 ve K3 aynı anda kapalı');
    return true;
  }

  return { olDelay: olDelay, coastStep: coastStep, singlePhasing: singlePhasing, lockedRotor: lockedRotor, voltageEffect: voltageEffect,
    vfdOperating: vfdOperating, energyCompare: energyCompare, energyCurves: energyCurves, ydRequest: ydRequest, guardOutputs: guardOutputs };
});
