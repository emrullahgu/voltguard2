/* VoltSim · 3D Motor, MCC ve PLC Otomasyon Simülasyonu
 * Hesap: VoltSimEngine.motor (anma değerleri, Kloss moment eğrisi, yol alma benzetimi, IEC 60947-4-1 termik sınıfları,
 * PLC tarama döngüsü). Sahne ve merdiven şeması yalnız motorun ürettiği sonuçları ve durum makinesini gösterir:
 * kontaktörler plcScan çıktısından, devir/akım/moment startup() eğrilerinin zaman içinde oynatılmasından gelir. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const MO = E.motor;
  const CX = E.ext.motor; // js/voltsim/calc/motor.js: arıza, enerji, temsili süreler (test edilmiş saf fonksiyonlar)

  /* ---------------------------------------------------------------- girdiler */
  function defaults() {
    return {
      Pn: 15, Un: 400, eff: 0.92, cos: 0.86, nn: 1460, poles: 4, IstIn: 7, TkTn: 2.8, TstTn: 2.2,
      method: 'YD', loadKind: 'pump', loadType: 'quad', loadPct: 90, J: 0.6,
      Ir: 27.5, olClass: '10', tYD: 4, ramp: 5, softLimit: 4, doorOpen: true,
      uPct: 100, vfdSpeed: 100, flowPct: 70, hours: 6000, price: 3.5, plcInterlock: true
    };
  }
  const METHOD_LABEL = { DOL: 'Doğrudan (DOL)', YD: 'Yıldız–üçgen (Y-Δ)', SOFT: 'Yumuşak yol verici', VFD: 'Frekans konvertörü (VFD)' };
  const LOAD_LABEL = { pump: 'Santrifüj pompa', fan: 'Radyal fan', conveyor: 'Bantlı konveyör' };
  const LOAD_TYPE = { pump: 'quad', fan: 'quad', conveyor: 'const' };
  /* tipik IE3 4 kutuplu motor anma değerleri (eğitim için önayar; etiket değerleri esastır) */
  const RATINGS = { 4: [4, 0.87, 0.82, 1440, 7.2], 7.5: [7.5, 0.9, 0.84, 1455, 7.4], 11: [11, 0.91, 0.85, 1460, 7.5], 15: [15, 0.92, 0.86, 1460, 7.0], 22: [22, 0.93, 0.86, 1470, 7.2], 30: [30, 0.935, 0.86, 1475, 7.2], 45: [45, 0.94, 0.86, 1480, 7.0], 55: [55, 0.945, 0.87, 1482, 7.2], 75: [75, 0.95, 0.87, 1485, 7.0] };

  /** Motorun doğal moment–devir eğrisi: motorun kendi moment–kayma fonksiyonu (MO.kloss) örneklenerek. */
  function naturalCurve(s) {
    const m = { Pn: s.Pn, Un: s.Un, eff: s.eff, cos: s.cos, nn: s.nn, poles: Number(s.poles), f: 50, IstIn: s.IstIn, TkTn: s.TkTn, TstTn: s.TstTn };
    const nom = MO.nominal(m), T = MO.kloss(m, nom), pts = [];
    for (let i = 0; i <= 80; i++) { const sl = Math.max(1 - i / 80, nom.sn * 0.02); pts.push([nom.ns * (1 - sl), T(sl)]); }
    return pts;
  }
  /** Şebeke gerilimi Un’dan farklıysa moment ∝ U², kalkış akımı ∝ U (CX.voltageEffect) ile motor girdileri ölçeklenir;
   * yol alma benzetimi yine engine motor.compute/startup ile yapılır. Pompa/fan için kısma–VFD enerji karşılaştırması eklenir. */
  function effInput(s) {
    const u = (s.uPct || 100) / 100;
    if (Math.abs(u - 1) < 1e-6) return s;
    const ve = CX.voltageEffect(u, { TkTn: s.TkTn, TstTn: s.TstTn === undefined ? 2.2 : s.TstTn, IstIn: s.IstIn });
    return Object.assign({}, s, { TkTn: ve.TkTn, TstTn: ve.TstTn, IstIn: ve.IstIn });
  }
  function compute(s) {
    const si = effInput(s);
    const r = MO.compute(si);
    if (!r.ok) return r;
    const u = (s.uPct || 100) / 100;
    r.values.natural = naturalCurve(si);
    r.values.u = u;
    r.values.IrunU = r.values.Irun * CX.voltageEffect(u, si).runCurrentFactor;
    if (Math.abs(u - 1) > 1e-6) r.checks.push({ id: 'u', label: 'Şebeke gerilimi', status: Math.abs(u - 1) > 0.1 ? 'fail' : Math.abs(u - 1) > 0.05 ? 'warn' : 'ok', detail: '%' + Math.round(u * 100) + ' Un: moment ×' + fmt(u * u, 2) + ' (∝ U²), kalkış akımı ×' + fmt(u, 2) + ', aynı yükte çalışma akımı ≈ ×' + fmt(1 / u, 2) + '. TS EN 60034-1 A bölgesi ±%5.', ref: 'TS EN 60034-1' });
    if (s.loadType === 'quad') {
      const P100 = s.Pn * s.loadPct / 100;
      const eo = { P100: P100, etaMotor: s.eff, etaVfd: 0.97, hours: s.hours, price: s.price };
      r.values.energy = Object.assign(CX.energyCompare(Object.assign({ q: s.flowPct / 100 }, eo)), { curves: CX.energyCurves(eo, 14), P100: P100 });
      r.assumptions = (r.assumptions || []).concat(['Enerji karşılaştırması: kısmada P/P100 ≈ 0,45 + 0,55·q (tipik santrifüj eğri yaklaşımı), VFD’de P/P100 = q³ (afinite yasaları, statik basma yüksekliği yok), sürücü verimi %97. Gerçek değer pompa/sistem eğrisinden bulunur.']);
    }
    r.assumptions = (r.assumptions || []).concat(['Arıza enjeksiyonu (faz kaybı √3·I, kilitli rotor I = Ist, gerilim etkisi) ve serbest duruş eğitim amaçlı yaklaşık modellerdir; termik açma gecikmesi temsilidir.']);
    return r;
  }
  /** Yük momenti: motorun yol alma benzetiminde kullandığı bağıntı (MO.loadTorque). */
  function loadTorque(s, nom, rpm) { return MO.loadTorque(s.loadType === 'quad' ? 'quad' : 'const', s.loadPct / 100 * nom.Tn, rpm / nom.ns); }

  /* ---------------------------------------------------------------- canlı durum ve PLC */
  function initLive() {
    return {
      plc: { run: false, timer: 0, K1: false, K2: false, K3: false, estopLatched: false, fault: '' },
      inp: { start: false, stop: true, estop: true, ol: true, reset: false },
      pb: { start: 0, stop: 0, reset: 0 }, estopPressed: false,
      olTripped: false, olHot: false, olTimer: 0, olText: '',
      tRun: -1, rpm: 0, I: 0, T: 0, hist: [], histT: 0, events: [],
      inj: { phase: false, locked: false }, tripCause: '', violation: null, violations: 0,
      seq: { latched: false, reset: false, restart: false }, recovered: false, steady: 0
    };
  }
  const log = (L, t) => { L.events.push(t); if (L.events.length > 30) L.events.shift(); };
  function press(app, what) {
    const L = app.live;
    if (what === 'start') { L.pb.start = 0.3; log(L, 'Başlat butonuna basıldı.'); }
    else if (what === 'stop') { L.pb.stop = 0.3; log(L, 'Durdur butonuna basıldı.'); }
    else if (what === 'estop') { L.estopPressed = true; log(L, 'ACİL DURDUR mantarına basıldı — mekanik olarak kilitlendi.'); }
    else if (what === 'reset') {
      if (L.estopPressed) log(L, 'Acil durdurma mantarı çevrilerek bırakıldı.');
      if (L.olTripped) { L.olTripped = false; L.olTimer = 0; L.olText = ''; log(L, 'Termik röle elle kuruldu (reset).'); }
      L.estopPressed = false; L.pb.reset = 0.3;
    }
    if (what === 'start' && L.seq.reset && !L.plc.estopLatched && !L.estopPressed) L.seq.restart = true;
    // butonlar duraklatılmış simülasyonda da etkili olsun
    if (!app.running || app.paused) { app.running = true; app.paused = false; app.syncToolbar(); }
    app.invalidate();
  }
  /** startup() noktaları arasında doğrusal ara değer; eğri bitince son (kararlı) nokta korunur. */
  function sample(pts, t) {
    if (!pts.length) return { rpm: 0, I: 0, T: 0 };
    if (t <= pts[0].t) return pts[0];
    const last = pts[pts.length - 1]; if (t >= last.t) return last;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi], k = (t - a.t) / (b.t - a.t);
    return { t: t, rpm: a.rpm + (b.rpm - a.rpm) * k, I: a.I + (b.I - a.I) * k, T: a.T + (b.T - a.T) * k };
  }
  /** Arıza enjeksiyonu (canlı durum; CX.singlePhasing / CX.lockedRotor). */
  function inject(app, what) {
    const L = app.live;
    if (what === 'phase') { L.inj.phase = true; log(L, 'Arıza: L3 fazı koptu (tek faz kalma).'); }
    else if (what === 'locked') { L.inj.locked = true; log(L, 'Arıza: yük sıkıştı, rotor kilitlendi.'); }
    else { L.inj.phase = false; L.inj.locked = false; log(L, 'Arızalar giderildi (faz bağlandı, yük serbest).'); }
    if (!app.running || app.paused) { app.running = true; app.paused = false; app.syncToolbar(); }
    app.invalidate();
  }

  function tick(app, dt) {
    const res = app.validResult; if (!res) return false;
    // core döngüsünün ilk karesinde dt negatif gelebilir (rAF zaman damgası mount’tan önce); buton darbeleri bozulmasın
    if (!(dt > 0)) return false;
    const L = app.live, s = app.state, v = res.values;
    const inp = { start: L.pb.start > 0, stop: !(L.pb.stop > 0), estop: !L.estopPressed, ol: !L.olTripped, reset: L.pb.reset > 0, method: s.method };
    L.pb.start = Math.max(0, L.pb.start - dt); L.pb.stop = Math.max(0, L.pb.stop - dt); L.pb.reset = Math.max(0, L.pb.reset - dt);
    L.inp = inp;
    const prev = L.plc;
    try { L.plc = MO.plcScan(prev, inp, dt, s.tYD); }
    catch (e) { L.plc = Object.assign({}, prev, { run: false, K1: false, K2: false, K3: false, fault: e.message }); log(L, e.message); }
    const p = L.plc;
    if (p.K1 && !prev.K1) L.runId = (L.runId || 0) + 1;
    // acil durdurma kurtarma sırası: kilit → Reset → Başlat
    if (p.estopLatched) { L.seq.latched = true; L.seq.reset = false; L.seq.restart = false; }
    if (L.seq.latched && !p.estopLatched && prev.estopLatched) L.seq.reset = true;
    if (L.seq.reset && L.seq.restart && p.K1 && !prev.K1) { L.recovered = true; log(L, 'Acil durdurma sonrası doğru sırayla (mantar bırak → Reset → Başlat) yeniden yol verildi.'); L.seq = { latched: false, reset: false, restart: false }; }
    // kullanıcı PLC programı (eğitim): kilitleme kapalıysa çıkış isteği denetlenir, çakışma engellenir
    if (s.method === 'YD' && p.run) {
      // tarama adımı geçiş penceresini (≈60 ms) atlayabilir: önceki ve şimdiki zamanlayıcı arasındaki geçiş anı denetlenir
      const tChk = prev.run && prev.timer < s.tYD + 0.06 && p.timer >= s.tYD ? Math.max(prev.timer, s.tYD) : p.timer;
      try { CX.guardOutputs(CX.ydRequest(tChk, s.tYD, s.plcInterlock !== false)); }
      catch (e) {
        if (!L.violation || L.violation.run !== L.runId) { L.violation = { run: L.runId, t: tChk, msg: e.message }; L.violations++; log(L, 'ENGELLENDİ: ' + e.message + ' (t = ' + fmt(tChk, 2) + ' s). Kilitlemesiz program faz–faz kısa devreye yol açardı; çıkışlar uygulanmadı.'); }
      }
    }
    // olay günlüğü (durum geçişleri)
    if (p.K1 && !prev.K1) log(L, 'K1 (ana) kontaktörü çekti' + (s.method === 'YD' ? ', K2 yıldız kapalı.' : s.method === 'VFD' ? ', sürücü rampası başladı.' : s.method === 'SOFT' ? ', yumuşak yol verici akım sınırında.' : '.'));
    if (p.K3 && !prev.K3) log(L, 'Zaman rölesi doldu: K2 bıraktı, 50 ms ölü zamandan sonra K3 (üçgen) çekti.');
    if (!p.K1 && prev.K1) log(L, 'Kontaktörler bıraktı' + (p.fault ? ' (' + p.fault + ').' : '.'));
    if (p.estopLatched && !prev.estopLatched) log(L, 'PLC acil durdurma kilidini kurdu; Reset gerekir.');
    if (!p.estopLatched && prev.estopLatched) log(L, 'Acil durdurma kilidi Reset ile çözüldü.');
    // motor: K1 çektiği andan itibaren yol alma eğrisi oynatılır
    if (p.K1 && L.tRun < 0) { L.tRun = 0; L.hist = []; L.histT = 0; }
    if (!p.K1 && L.tRun >= 0) L.tRun = -1;
    const started = !!(v.sim.tStart && L.tRun > v.sim.tStart);
    if (L.tRun >= 0) {
      L.tRun += dt;
      const q = sample(v.sim.pts, L.tRun); L.rpm = q.rpm; L.I = q.I; L.T = q.T;
      // kalıcı çalışmada gerilim etkisi (aynı yükte I ≈ ∝ 1/u) ve VFD hız ayar noktası (afinite yasaları, temsili)
      if (started) L.I = q.I * v.IrunU / v.Irun;
      if (s.method === 'VFD' && started) {
        const o = CX.vfdOperating(s.vfdSpeed / 100, s.loadType === 'quad', L.I, v.nom.In);
        L.rpm = q.rpm * o.speedFactor; L.I = o.I; L.T = q.T * o.torqueFactor;
      }
      // arıza enjeksiyonu
      const Ist = s.IstIn * (v.u || 1) * v.nom.In * (s.method === 'YD' && L.plc.K2 ? 1 / 3 : 1);
      if (L.inj.locked) {
        const lr = CX.lockedRotor(s.method === 'VFD' ? 1.5 * v.nom.In : s.method === 'SOFT' ? Math.min(Ist, s.softLimit * v.nom.In) : Ist);
        L.rpm = lr.rpm; L.I = lr.I; L.T = v.natural.length ? v.natural[0][1] : 0;
      } else if (L.inj.phase) {
        const run = (L.prevRpm || 0) > 0.5 * v.nom.ns && !L.phaseStall;
        const sp = CX.singlePhasing({ running: run, I: L.I, Ist: Ist });
        if (!run) { L.phaseStall = true; L.rpm = CX.coastStep(L.prevRpm || 0, dt, s.J, loadTorque(s, v.nom, L.prevRpm || 0), 0.02 * v.nom.Tn); L.T = 0; }
        L.I = sp.I;
      } else L.phaseStall = false;
      L.prevRpm = L.rpm;
    } else {
      // serbest duruş (temsili; CX.coastStep): J·dω/dt = −(TL + %2·Tn sürtünme)
      L.I = 0; L.T = 0; L.phaseStall = false;
      if (L.rpm > 0) L.rpm = CX.coastStep(L.rpm, dt, s.J, loadTorque(s, v.nom, L.rpm), 0.02 * v.nom.Tn);
      L.prevRpm = L.rpm;
    }
    L.steady = L.tRun >= 0 && started && !L.inj.locked && !L.inj.phase ? L.steady + dt : 0;
    // termik aşırı yük rölesi (sınıf sınırları engine’den; süre temsili)
    if (L.tRun >= 0 && !L.olTripped) {
      const a = MO.overloadAssessment(s.olClass, s.Ir, L.I);
      L.olHot = a.trips === true;
      if (a.trips === true) {
        L.olTimer += dt;
        const lim = CX.olDelay(s.olClass, L.I / s.Ir);
        if (L.olTimer >= lim) { L.olTripped = true; L.olText = a.text; L.tripCause = L.inj.phase ? 'phase' : L.inj.locked ? 'locked' : 'overload'; log(L, 'Termik röle açtı (I = ' + fmt(L.I, 0) + ' A = ' + fmt(L.I / s.Ir, 1) + '·Ir). ' + a.text); }
      } else L.olTimer = Math.max(0, L.olTimer - dt * 0.5);
    } else if (!L.olTripped) { L.olHot = false; L.olTimer = Math.max(0, L.olTimer - dt * 0.5); }
    // geçmiş (grafik ve 2D için)
    if (L.tRun >= 0 || L.rpm > 0) {
      L.histT += dt;
      if (L.histT >= 0.1) { L.histT = 0; L.hist.push([L.tRun >= 0 ? L.tRun : (L.hist.length ? L.hist[L.hist.length - 1][0] + 0.1 : 0), L.rpm, L.I]); if (L.hist.length > 600) L.hist.shift(); }
      return true;
    }
    return p.K1 !== prev.K1 || p.estopLatched !== prev.estopLatched || inp.start || inp.reset || !inp.stop;
  }

  function motorPhase(s, L, v) {
    const p = L.plc;
    if (L.olTripped) return { t: 'Termik açtı', lv: 'bad' };
    if (p.estopLatched) return { t: 'Acil durdurma', lv: 'bad' };
    if (!p.K1) return L.rpm > 1 ? { t: 'Serbest duruş', lv: 'warn' } : { t: 'Duruyor', lv: '' };
    if (v.sim.stalled && L.tRun > 2) return { t: 'Yol alamıyor (moment yetersiz)', lv: 'bad' };
    if (s.method === 'YD') return p.K2 ? { t: 'Yıldızda yol alıyor', lv: 'warn' } : p.K3 ? { t: (v.sim.tStart && L.tRun < v.sim.tStart ? 'Üçgende hızlanıyor' : 'Üçgende çalışıyor'), lv: 'ok' } : { t: 'Y→Δ ölü zaman', lv: 'warn' };
    if (v.sim.tStart && L.tRun < v.sim.tStart) return { t: s.method === 'VFD' ? 'Rampa ile hızlanıyor' : s.method === 'SOFT' ? 'Akım sınırında yol alıyor' : 'Yol alıyor', lv: 'warn' };
    return { t: 'Çalışıyor', lv: 'ok' };
  }

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const v = app.validResult && app.validResult.values;
    const L = app.live;
    return [
      { title: 'Kumanda (buton istasyonu)', items: [
        { type: 'buttons', items: [
          { label: '▶ Başlat', variant: 'primary', onClick: a => press(a, 'start') },
          { label: '■ Durdur', onClick: a => press(a, 'stop') },
          { label: 'ACİL DURDUR', variant: 'danger', onClick: a => { press(a, 'estop'); a.renderControls(); } },
          { label: 'Reset', variant: 'warn', onClick: a => { press(a, 'reset'); a.renderControls(); } }
        ] },
        { type: 'note', html: L && L.estopPressed ? '<b>Acil durdurma basılı ve kilitli.</b> Reset mantarı bırakır ve PLC kilidini çözer; motor kendiliğinden yeniden kalkmaz.' : '3D sahnedeki buton istasyonuna tıklayarak da kumanda edebilirsiniz.' },
        { type: 'note', level: 'warn', text: 'PLC mantığı eğitim amaçlıdır. Acil durdurma ve diğer emniyet fonksiyonları ISO 13849-1 / IEC 62061’e göre doğrulanmış emniyet rölesi veya emniyet PLC’si ile gerçekleştirilmelidir; bu simülasyon onların yerine geçmez.' }
      ] },
      { title: 'Yol verme ve yük', items: [
        { type: 'seg', key: 'method', label: 'Yol verme yöntemi', options: Object.keys(METHOD_LABEL).map(k => [k, METHOD_LABEL[k]]) },
        { type: 'range', key: 'loadPct', label: 'Yük momenti (Tn’ye oran)', min: 0, max: 150, step: 5, unit: '%', help: 'Anma devrindeki yük momenti. Karesel yükte (pompa/fan) kalkışta moment düşüktür.' },
        { type: 'seg', key: 'loadKind', label: 'Tahrik edilen yük', options: Object.keys(LOAD_LABEL).map(k => [k, LOAD_LABEL[k] + (LOAD_TYPE[k] === 'quad' ? ' (karesel)' : ' (sabit moment)')]),
          onChange: (val, a) => { a.state.loadType = LOAD_TYPE[val]; a.invalidate(); } },
        { type: 'range', key: 'J', label: 'Toplam atalet J (motor + yük)', min: 0.05, max: 10, step: 0.05, unit: 'kg·m²', digits: 2 },
        s.method === 'YD' ? { type: 'range', key: 'tYD', label: 'Y→Δ zaman rölesi', min: 1, max: 15, step: 0.5, unit: 's', digits: 1, help: 'K2 bıraktıktan sonra K3, 50 ms ölü zamanla çeker (PLC içindeki karşılıklı kilitleme).' } : null,
        s.method === 'SOFT' ? { type: 'range', key: 'softLimit', label: 'Akım sınırı', min: 2, max: 5, step: 0.5, unit: '× In', digits: 1 } : null,
        s.method === 'VFD' ? { type: 'range', key: 'ramp', label: 'Hızlanma rampası', min: 1, max: 30, step: 1, unit: 's' } : null,
        s.method === 'VFD' ? { type: 'range', key: 'vfdSpeed', label: 'Sürücü hız ayar noktası', min: 30, max: 100, step: 5, unit: '%', help: 'Çalışırken değiştirilebilir. Devir, moment ve akım afinite yasalarıyla ölçeklenir (karesel yükte P ∝ n³; temsili).' } : null
      ] },
      { title: 'Arıza enjeksiyonu', items: [
        { type: 'buttons', items: [
          { label: L && L.inj.phase ? 'Faz kaybı (aktif)' : 'Faz kaybı (L3 kopuk)', variant: 'warn', pressed: !!(L && L.inj.phase), onClick: a => { inject(a, 'phase'); a.renderControls(); } },
          { label: L && L.inj.locked ? 'Kilitli rotor (aktif)' : 'Rotoru kilitle', variant: 'warn', pressed: !!(L && L.inj.locked), onClick: a => { inject(a, 'locked'); a.renderControls(); } },
          { label: 'Arızaları gider', onClick: a => { inject(a, 'clear'); a.renderControls(); } }
        ] },
        { type: 'range', key: 'uPct', label: 'Şebeke gerilimi (Un’a oran)', min: 85, max: 110, step: 1, unit: '%', help: 'Moment ∝ U², kalkış akımı ∝ U; aynı yükte çalışma akımı ≈ ∝ 1/U. %90’da moment %81’e düşer.' },
        { type: 'note', text: 'Faz kaybında çalışan motorun kalan iki hattında akım ≈ √3·I olur ve termik röle açar; duran motor tek fazda kalkamaz. Kilitli rotorda akım kalkış akımında kalır. Modeller eğitim amaçlı yaklaşık değerlerdir.' }
      ] },
      s.loadType === 'quad' ? { title: 'Enerji verimliliği · debi kontrolü', items: [
        { type: 'range', key: 'flowPct', label: 'İstenen debi (anma debisine oran)', min: 30, max: 100, step: 5, unit: '%' },
        { type: 'range', key: 'hours', label: 'Yıllık çalışma süresi', min: 500, max: 8760, step: 100, unit: 'h' },
        { type: 'number', key: 'price', label: 'Elektrik birim fiyatı', min: 0, max: 50, step: 0.1, unit: 'TL/kWh', digits: 2 },
        { type: 'note', text: 'Sabit hızda vana/damper kısma ile frekans konvertörlü hız kontrolü karşılaştırılır (afinite yasaları). Seçili yol verme yöntemi VFD ise sürücü, değilse kısma uygulanır.' }
      ] } : null,
      { title: 'PLC programı', items: [
        { type: 'toggle', key: 'plcInterlock', label: 'K2/K3 karşılıklı kilitleme (programda)', help: 'Kapatırsanız program K3’ü, K2’nin kontakları açılmadan (≈60 ms mekanik bırakma) kapatmak ister. Simülatör çıkışları uygulamadan denetler ve ihlali engeller; gerçek tesiste bu faz–faz kısa devre olurdu. Yardımcı NC kontaklarla donanımsal kilit ayrıca şarttır.' },
        L && L.violations ? { type: 'note', level: 'warn', html: '<b>' + L.violations + ' kilitleme ihlali engellendi.</b> ' + VS.esc(L.violation ? L.violation.msg + ' (t = ' + fmt(L.violation.t, 2) + ' s)' : '') } : null
      ] },
      { title: 'Motor etiket değerleri', items: [
        { type: 'select', key: 'Pn', label: 'Anma gücü Pn (önayar: IE3, 4 kutup)', options: Object.keys(RATINGS).map(Number).sort((a, b) => a - b).map(p => [p, fmt(p, p % 1 ? 1 : 0) + ' kW']), rebuild: true,
          onChange: (val, a) => {
            const r = RATINGS[val]; if (!r) return;
            Object.assign(a.state, { eff: r[1], cos: r[2], nn: r[3], IstIn: r[4], poles: 4 });
            const nom = MO.nominal({ Pn: val, Un: a.state.Un, eff: r[1], cos: r[2], nn: r[3], poles: 4, f: 50 });
            a.state.Ir = Math.round(nom.In * 10) / 10; a.state.J = Math.round(Math.max(0.05, 0.04 * val) * 100) / 100;
            a.renderControls(); a.invalidate();
          } },
        { type: 'select', key: 'Un', label: 'Anma gerilimi Un', options: [[230, '230 V (Δ)'], [400, '400 V'], [690, '690 V']] },
        { type: 'range', key: 'eff', label: 'Verim η', min: 0.7, max: 0.97, step: 0.005, digits: 3 },
        { type: 'range', key: 'cos', label: 'cosφ', min: 0.6, max: 0.95, step: 0.01, digits: 2 },
        { type: 'select', key: 'poles', label: 'Kutup sayısı', options: [[2, '2 kutup (3000 d/dk)'], [4, '4 kutup (1500 d/dk)'], [6, '6 kutup (1000 d/dk)'], [8, '8 kutup (750 d/dk)']],
          onChange: (val, a) => { const ns = 6000 / val; a.state.nn = Math.round(ns * (1 - 0.027)); a.renderControls(); a.invalidate(); } },
        { type: 'number', key: 'nn', label: 'Anma devri nn', min: 300, max: 3590, step: 5, unit: 'd/dk' },
        { type: 'range', key: 'IstIn', label: 'Kalkış akımı Ist/In', min: 4, max: 9, step: 0.1, digits: 1 },
        { type: 'range', key: 'TkTn', label: 'Devrilme momenti Tk/Tn', min: 1.8, max: 3.5, step: 0.1, digits: 1 },
        { type: 'range', key: 'TstTn', label: 'Kalkış momenti Tst/Tn', min: 0.8, max: 3.2, step: 0.1, digits: 1, help: 'Katalog değeri; IE3 4 kutuplu motorlarda tipik 2–2,6.' }
      ] },
      { title: 'Motor koruma', items: [
        { type: 'number', key: 'Ir', label: 'Termik röle ayarı Ir', min: 0.1, max: 2000, step: 0.1, unit: 'A', digits: 1, help: v ? 'Hesaplanan In = ' + fmt(v.nom.In, 1, 'A') + (s.method === 'YD' ? ' · röle faz devresindeyse In/√3 = ' + fmt(v.nom.In / Math.sqrt(3), 1, 'A') : '') : null },
        { type: 'select', key: 'olClass', label: 'Açma sınıfı (IEC 60947-4-1)', options: Object.keys(MO.TRIP_CLASS).map(k => [k, 'Sınıf ' + k + ' · 7,2·Ir’de ' + MO.TRIP_CLASS[k][0] + '–' + MO.TRIP_CLASS[k][1] + ' s']) },
        { type: 'note', text: 'Termik açma süresi üretici eğrisine bağlıdır. Simülasyon yalnız sınıf aralığını kullanır; görsel gecikme temsilidir (I²t ölçekli, en çok 30 s’ye kısaltılmış).' }
      ] },
      { title: 'Görünüm', items: [{ type: 'toggle', key: 'doorOpen', label: 'MCC kapakları açık' }] }
    ];
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, L) {
    const v = res.values, nom = v.nom, ph = motorPhase(s, L, v), p = L.plc;
    const dot = b => (b ? '●' : '○');
    const out = [
      { label: 'Motor durumu', value: ph.t, level: ph.lv, wide: true, sub: METHOD_LABEL[s.method] + ' · ' + LOAD_LABEL[s.loadKind] },
      { label: 'Devir n', value: fmt(L.rpm, 0, 'd/dk'), sub: 'ns = ' + fmt(nom.ns, 0) + ' · nn = ' + fmt(s.nn, 0) + ' d/dk' },
      { label: 'Hat akımı I', value: fmt(L.I, 1, 'A'), level: L.I > 1.2 * s.Ir && L.tRun > (v.sim.tStart || 99) ? 'bad' : L.I > s.Ir * 1.05 ? 'warn' : L.I > 0 ? 'ok' : '', sub: 'I / Ir = ' + fmt(L.I / s.Ir, 2) },
      { label: 'Motor momenti', value: fmt(L.T, 0, 'N·m'), sub: 'Tn = ' + fmt(nom.Tn, 1, 'N·m') },
      { label: 'Anma akımı In', value: fmt(nom.In, 1, 'A'), sub: 'Kayma sn = %' + fmt(nom.sn * 100, 2) },
      { label: 'Yol alma süresi', value: v.sim.tStart ? fmt(v.sim.tStart, 1, 's') : 'yol alamıyor', level: !v.sim.tStart ? 'bad' : v.sim.tStart > 10 ? 'warn' : 'ok', sub: 'Tepe akım ≈ ' + fmt(v.sim.Imax, 0, 'A') + ' (' + fmt(v.sim.Imax / nom.In, 1) + '·In)' },
      { label: 'Çalışma akımı (hesap)', value: fmt(v.Irun, 1, 'A'), sub: 'Yük %' + s.loadPct + ' · ' + MO.overloadAssessment(s.olClass, s.Ir, v.Irun).text },
      { label: 'PLC çıkışları', value: 'K1 ' + dot(p.K1) + '  K2 ' + dot(p.K2) + '  K3 ' + dot(p.K3), level: p.fault ? 'bad' : p.K1 ? 'ok' : '', sub: p.fault ? 'Arıza: ' + p.fault : p.run ? 'Mühürleme (self-hold) aktif' + (s.method === 'YD' ? ' · T1 = ' + fmt(Math.min(p.timer, s.tYD), 1) + ' / ' + s.tYD + ' s' : '') : 'Bekliyor' },
      { label: 'Termik röle', value: L.olTripped ? 'AÇTI' : L.olHot ? 'Aşırı akım bölgesinde' : 'Normal', level: L.olTripped ? 'bad' : L.olHot ? 'warn' : 'ok', sub: L.olTripped ? L.olText + ' Reset ile kurulur.' : 'Ir = ' + fmt(s.Ir, 1, 'A') + ' · sınıf ' + s.olClass + ' (' + MO.TRIP_CLASS[s.olClass][0] + '–' + MO.TRIP_CLASS[s.olClass][1] + ' s, 7,2·Ir)' },
      { label: 'Acil durdurma', value: L.estopPressed ? 'BASILI' : p.estopLatched ? 'Kilitli — Reset' : 'Hazır', level: L.estopPressed || p.estopLatched ? 'bad' : 'ok' }
    ];
    if (L.inj.phase || L.inj.locked) out.push({ label: 'Enjekte arıza', value: L.inj.locked ? 'Kilitli rotor' : 'Faz kaybı (tek faz)', level: 'bad', wide: true, sub: L.inj.locked ? 'I = Ist sabit; termik röle sınıf aralığında açmalı.' : 'Kalan iki fazda akım ≈ √3·I (çalışırken) ya da kilitli rotor (dururken).' });
    if (Math.abs(v.u - 1) > 1e-6) out.push({ label: 'Şebeke gerilimi', value: '%' + Math.round(v.u * 100) + ' Un', level: Math.abs(v.u - 1) > 0.1 ? 'bad' : Math.abs(v.u - 1) > 0.05 ? 'warn' : 'ok', sub: 'Moment ×' + fmt(v.u * v.u, 2) + ' · çalışma akımı ≈ ' + fmt(v.IrunU, 1, 'A') });
    if (s.method === 'VFD') out.push({ label: 'Sürücü çıkışı', value: fmt(50 * s.vfdSpeed / 100, 1, 'Hz'), sub: 'Hız ayar noktası %' + s.vfdSpeed + ' (afinite, temsili)' });
    if (v.energy) {
      const e = v.energy, vfd = s.method === 'VFD';
      out.push({ label: 'Güç @ %' + s.flowPct + ' debi', value: fmt(vfd ? e.Pvfd : e.Pthrottle, 1, 'kW'), sub: 'Kısma ' + fmt(e.Pthrottle, 1) + ' kW · VFD ' + fmt(e.Pvfd, 1) + ' kW', level: vfd ? 'ok' : 'warn' });
      out.push({ label: 'VFD ile yıllık tasarruf', value: '%' + fmt(e.savingPct, 0), level: vfd ? 'ok' : '', sub: VS.fmtEnergy(e.saving) + ' · ≈ ' + fmt(e.cost, 0) + ' TL/yıl' + (vfd ? ' (uygulanıyor)' : ' (VFD seçilirse)') });
    }
    if (L.violations) out.push({ label: 'PLC kilitleme ihlali', value: L.violations + ' kez engellendi', level: 'bad', wide: true, sub: L.violation ? L.violation.msg : '' });
    if (L.events.length) out.push({ label: 'Son olay', value: L.events[L.events.length - 1], wide: true });
    return out;
  }
  function charts(res, s, L) {
    const v = res.values, pts = v.sim.pts, nom = v.nom;
    const tEnd = pts.length ? pts[pts.length - 1].t : 1;
    const mk = L.tRun >= 0 && L.tRun < tEnd ? [{ x: L.tRun, label: 't = ' + fmt(L.tRun, 1) + ' s', color: '#fcd34d' }] : [];
    if (s.method === 'YD') mk.push({ x: s.tYD, label: 'Y→Δ', color: '#8b5cf6' });
    const nMax = nom.ns * 1.02;
    const loadPts = []; for (let i = 0; i <= 40; i++) { const n = nom.ns * i / 40; loadPts.push([n, loadTorque(s, nom, n)]); }
    const tsSeries = [
      { name: 'Motor (doğal eğri)', color: 'cyan', data: v.natural },
      { name: 'Yük momenti', color: 'amber', dash: [5, 4], data: loadPts }
    ];
    if (s.method !== 'DOL') tsSeries.push({ name: 'Yol alma izi (' + s.method + ')', color: 'green', width: 1.5, data: pts.map(p => [p.rpm, p.T]) });
    const tsMk = L.rpm > 0 ? [{ x: L.rpm, y: L.T || undefined, label: fmt(L.rpm, 0) + ' d/dk', color: '#fcd34d' }] : [];
    return [
      { id: 'speed', title: 'Devir – zaman (yol alma)', series: [{ name: 'Devir (d/dk)', color: 'green', area: true, data: pts.map(p => [p.t, p.rpm]) }],
        hLines: [{ y: nom.ns, label: 'ns ' + fmt(nom.ns, 0), color: '#94a3b8' }], markers: mk, x: { label: 's', min: 0 }, y: { label: 'd/dk', min: 0, max: nom.ns * 1.18 },
        alt: METHOD_LABEL[s.method] + ' ile yol alma: ' + (v.sim.tStart ? fmt(v.sim.tStart, 1) + ' s’de anma devrine yaklaşır.' : 'motor yük momentini yenemiyor, anma devrine ulaşamıyor.') },
      { id: 'current', title: 'Akım – zaman', series: [{ name: 'Hat akımı (A)', color: 'amber', area: true, data: pts.map(p => [p.t, p.I]) }],
        hLines: [{ y: s.Ir, label: 'Ir ' + fmt(s.Ir, 1) + ' A', color: '#ef4444' }], markers: mk, x: { label: 's', min: 0 }, y: { label: 'A', min: 0 },
        alt: 'Tepe akım yaklaşık ' + fmt(v.sim.Imax, 0) + ' A (' + fmt(v.sim.Imax / nom.In, 1) + '·In); termik ayarı ' + fmt(s.Ir, 1) + ' A.' },
      { id: 'torque', title: 'Moment – devir (motor ve yük)', height: 170, series: tsSeries, markers: tsMk, x: { label: 'd/dk', min: 0, max: nMax }, y: { label: 'N·m', min: 0 },
        alt: 'Motor moment eğrisi ile ' + (s.loadType === 'quad' ? 'karesel' : 'sabit') + ' yük momenti. Kalkış momenti ≈ ' + fmt(v.natural.length ? v.natural[0][1] : 0, 0) + ' N·m, yük momenti anma devrinde ' + fmt(s.loadPct / 100 * nom.Tn, 0) + ' N·m.' }
    ].concat(v.energy ? [{ id: 'energy', title: 'Debi kontrolü · şebekeden çekilen güç', series: [
        { name: 'Vana/damper kısma', color: 'red', data: v.energy.curves.throttle },
        { name: 'Frekans konvertörü', color: 'green', data: v.energy.curves.vfd }],
      markers: [{ x: s.flowPct, label: '%' + s.flowPct + ' debi', color: '#fcd34d' }], x: { label: 'debi %', min: 30, max: 100 }, y: { label: 'kW', min: 0 },
      alt: '%' + s.flowPct + ' debide kısma ile ' + fmt(v.energy.Pthrottle, 1) + ' kW, VFD ile ' + fmt(v.energy.Pvfd, 1) + ' kW; yıllık tasarruf %' + fmt(v.energy.savingPct, 0) + ' (' + fmt(v.energy.cost, 0) + ' TL).' }] : []);
  }

  /* ---------------------------------------------------------------- 3D sahne */
  function rebuildOn(s) { return s.method + '|' + s.loadKind + '|' + s.Pn; }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    const R = k.group(null, 0, 0, 0);
    const sc = { R: R, rot: [], contactors: {}, flows: [] };
    app.scene3 = sc;
    // zemin: epoksi kaplı pompa/MCC odası, arka duvar
    const floor = k.ground(30, k.mat(0x56606b, { roughness: 0.45, metalness: 0.1 }), 0); floor.receiveShadow = true;
    const grid = new T.GridHelper(30, 30, 0x3d4650, 0x3d4650); grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.2; grid.userData.noClip = true; R.add(grid);
    const wall = k.box(9, 3.2, 0.12, k.mat(0x8e99a6, { roughness: 0.9 }), 0, 1.6, -1.0, R); wall.userData.noClip = true;
    // kablo tavası (duvar dibinde, MCC’den motora)
    buildMCC(k, R, s, app, sc);
    buildMotorSet(k, R, s, app, sc);
    buildStation(k, R, s, app, sc);
    // güç kablosu: MCC tabanı → tava → motor klemens kutusu
    const mk = sc.motorTB;
    const cab = k.tube([[-1.75, 0.15, -0.55], [-1.6, 0.05, -0.3], [-0.6, 0.05, 0.05], [mk.x - 0.4, 0.05, 0.15], [mk.x - 0.05, 0.08, mk.z - 0.25], [mk.x, mk.y - 0.08, mk.z - 0.25], [mk.x, mk.y, mk.z - 0.1]], 0.018, M.cableBlack, R, 80);
    sc.flows.push(k.flow(cab.userData.curve, 22, 0xfcd34d, 0.012, R));
    // kumanda kablosu: buton istasyonu → MCC
    k.tube([[sc.stationPos[0], 0.9, sc.stationPos[2] - 0.03], [sc.stationPos[0], 0.04, sc.stationPos[2] - 0.05], [-0.9, 0.04, -0.2], [-1.2, 0.15, -0.55]], 0.008, M.plasticGrey, R, 40);
    app.def.scene.bounds = [-2.6, 3.15]; // %55 kesit motor gövdesinin ortasından geçer
    v.setView({ target: [-0.2, 0.8, 0], r: 5.3, theta: 0.3, phi: 1.2, limits: { rMin: 1, rMax: 14 } });
    v.setShadowBox(5, 30);
    v.sun.position.set(3, 7, 6);
  }

  /* --- MCC: iki bölmeli motor kontrol panosu (yol verici + PLC/sürücü) */
  function buildMCC(k, R, s, app, sc) {
    const M = k.mats, T = k.T;
    const W = 0.8, H = 2.0, D = 0.5, PL = 0.1, x0 = -2.5, z0 = -0.68;
    const body = k.group(R, 0, 0, z0);
    k.box(W * 2, PL, D - 0.02, M.plasticDark, x0 + W, PL / 2, 0, body);
    k.shell(k.box(W * 2 + 0.02, 0.03, D + 0.02, M.panelRAL7035, x0 + W, PL + H + 0.015, 0, body));
    k.box(W * 2, H, 0.02, M.panelRAL7035, x0 + W, PL + H / 2, -D / 2 + 0.01, body);
    k.shell(k.box(0.02, H, D, M.panelRAL7035, x0 + 0.01, PL + H / 2, 0, body));
    k.shell(k.box(0.02, H, D, M.panelRAL7035, x0 + 2 * W - 0.01, PL + H / 2, 0, body));
    k.box(0.025, H, 0.03, M.darkSteel, x0 + W, PL + H / 2, D / 2 - 0.02, body);
    sc.doors = [];
    const backZ = -D / 2 + 0.03;
    for (let i = 0; i < 2; i++) {
      const cx = x0 + W * (i + 0.5);
      k.box(W - 0.08, H - 0.3, 0.01, M.galv, cx, PL + (H - 0.3) / 2 + 0.1, backZ, body);
      const pivot = k.group(body, x0 + W * i + 0.01, 0, D / 2);
      k.shell(k.box(W - 0.02, H - 0.02, 0.022, M.panelRAL7035, W / 2 - 0.01, PL + H / 2, 0.011, pivot));
      k.box(0.02, 0.16, 0.03, M.plasticDark, W - 0.07, PL + H / 2, 0.035, pivot);
      for (let r = 0; r < 6; r++) k.box(0.26, 0.008, 0.004, M.darkSteel, W / 2, PL + 0.18 + r * 0.025, 0.024, pivot);
      const plate = k.screen(0.24, 0.05, 256, (g, w, h) => { g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = 'bold 24px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(i ? '+A2 PLC / ' + (s.method === 'VFD' ? 'SÜRÜCÜ' : s.method === 'SOFT' ? 'SOFT START' : 'KUMANDA') : '+A1 M1 YOL VERİCİ', w / 2, h / 2); }, pivot);
      plate.position.set(W / 2, PL + H - 0.12, 0.024);
      sc.doors.push(pivot);
      if (!i) {
        // kapak üstü sinyal lambaları: çalışıyor / arıza / acil
        sc.pilot = [M.ledOff, M.ledOff, M.ledOff].map((m, j) => { k.cyl(0.018, 0.018, 0.012, M.darkSteel, W / 2 - 0.08 + j * 0.08, PL + 1.45, 0.028, pivot, 16).rotation.x = Math.PI / 2; const l = k.sphere(0.014, m, W / 2 - 0.08 + j * 0.08, PL + 1.45, 0.036, pivot); return l; });
        ['ÇALIŞ', 'ARIZA', 'ACİL'].forEach((t, j) => { const p = k.screen(0.07, 0.018, 96, (g, w, h) => { g.fillStyle = '#e8e8e2'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = 'bold 16px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, w / 2, h / 2); }, pivot); p.position.set(W / 2 - 0.08 + j * 0.08, PL + 1.405, 0.024); });
      } else {
        // kapak üstü ölçü ekranı (akım/devir)
        k.box(0.13, 0.1, 0.01, M.plasticDark, W / 2, PL + 1.45, 0.025, pivot);
        sc.meter = k.screen(0.11, 0.08, 256, (g, w, h) => drawMeter(g, w, h, app), pivot, { emissive: 0.9 });
        sc.meter.position.set(W / 2, PL + 1.45, 0.031);
      }
    }
    // --- bölme 1: motor koruma şalteri, kontaktörler, termik röle
    const g1 = k.group(body, x0 + W / 2, 0, backZ + 0.005);
    [1.62, 1.28, 0.95].forEach(y => k.box(W - 0.16, 0.035, 0.008, M.galv, 0, PL + y, 0.01, g1));
    [1.45, 1.12, 0.78].forEach(y => k.box(W - 0.12, 0.05, 0.05, M.plasticGrey, 0, PL + y + 0.03, 0.03, g1));
    // motor koruma şalteri (MPCB / MCCB)
    const mp = k.group(g1, -0.22, PL + 1.62, 0.05);
    k.rbox(0.09, 0.13, 0.09, 0.006, M.plasticDark, 0, 0, 0, mp);
    k.box(0.05, 0.05, 0.01, M.plasticGrey, 0, 0.01, 0.046, mp);
    const knob = k.box(0.012, 0.045, 0.02, M.plasticYellow, 0, 0.01, 0.056, mp); knob.rotation.z = 0;
    k.pickable(mp, 'Q1 · Motor koruma şalteri', () => { const r = app.validResult && app.validResult.values; return r ? ['Termik + manyetik koruma, kesme kapasitesi kısa devre seviyesine göre seçilir.', 'In = ' + fmt(r.nom.In, 1, 'A') + ' · kalkış tepe ≈ ' + fmt(r.sim.Imax, 0, 'A'), 'Manyetik ayar kalkış akımında açmayacak, hat sonu kısa devresinde açacak şekilde seçilmelidir.'] : []; });
    k.explodable(mp, [0, 0, 0.3]);
    // kontaktörler: yöntemine göre K1 (ana), K2 (yıldız), K3 (üçgen)
    const names = s.method === 'YD' ? ['K1', 'K2', 'K3'] : ['K1'];
    const ctTitle = { K1: 'K1 · Ana (şebeke) kontaktörü', K2: 'K2 · Yıldız kontaktörü', K3: 'K3 · Üçgen kontaktörü' };
    names.forEach((n, j) => {
      const g = k.group(g1, -0.1 + j * 0.085, PL + 1.28, 0.05);
      k.rbox(0.065, 0.1, 0.09, 0.006, M.plasticGrey, 0, 0, 0, g);
      k.box(0.05, 0.03, 0.012, M.plasticDark, 0, 0.03, 0.046, g); // üst klemens
      k.box(0.05, 0.03, 0.012, M.plasticDark, 0, -0.035, 0.046, g); // alt klemens
      const arm = k.box(0.026, 0.022, 0.016, M.plasticWhite, 0, 0, 0.05, g); // armatür göstergesi (çekince içeri girer)
      const flag = k.box(0.008, 0.008, 0.004, M.ledOff, 0.02, 0, 0.049, g);
      for (let q = 0; q < 3; q++) k.cyl(0.004, 0.004, 0.006, M.brass, -0.015 + q * 0.015, 0.03, 0.054, g, 8).rotation.x = Math.PI / 2;
      sc.contactors[n] = { arm: arm, flag: flag };
      if (!j) sc.starterLabel = k.label('K1', g, [names.length > 1 ? 0.085 : 0, 0.085, 0.05], 'vs-label--sm');
      k.pickable(g, ctTitle[n], () => {
        const p = app.live.plc;
        return [p[n] ? 'Bobin enerjili — kontaklar KAPALI' : 'Bobin enerjisiz — kontaklar AÇIK', n === 'K2' ? 'K3 ile hem PLC’de hem yardımcı kontakla (NC) karşılıklı kilitli.' : n === 'K3' ? 'K2 bıraktıktan sonra 50 ms ölü zamanla çeker (ark söndürme).' : 'Mühürleme kontağı (13-14) Başlat butonuna paralel.', 'AC-3 kullanım kategorisi; Y-Δ’da K1 ve K3 ≈ In/√3, K2 ≈ In/3 akım taşır.'];
      });
      k.explodable(g, [0, 0, 0.25]);
    });
    // termik aşırı yük rölesi (K1 altında)
    const ol = k.group(g1, -0.1, PL + 1.165, 0.045);
    k.rbox(0.065, 0.06, 0.08, 0.005, M.plasticDark, 0, 0, 0, ol);
    k.box(0.03, 0.012, 0.01, M.plasticGrey, -0.008, 0.012, 0.042, ol);
    k.cyl(0.006, 0.006, 0.01, M.plasticBlue, 0.02, 0.012, 0.044, ol, 12).rotation.x = Math.PI / 2;
    sc.olFlag = k.box(0.012, 0.01, 0.006, M.plasticGreen, 0.018, -0.014, 0.042, ol);
    k.pickable(ol, 'F2 · Termik aşırı yük rölesi', () => { const L = app.live, st = app.state; return ['Ir = ' + fmt(st.Ir, 1, 'A') + ' · sınıf ' + st.olClass, 'IEC 60947-4-1: 7,2·Ir’de ' + MO.TRIP_CLASS[st.olClass][0] + '–' + MO.TRIP_CLASS[st.olClass][1] + ' s içinde açar.', L.olTripped ? 'DURUM: AÇTI — 95-96 NC kontağı PLC girişini kesti.' : 'DURUM: normal (95-96 kapalı).']; },
      a => {
        const st = a.state, In = a.validResult && a.validResult.values.nom.In;
        return [a.live.olTripped ? { label: 'Röleyi kur (Reset)', variant: 'warn', onClick: x => press(x, 'reset') } : null,
          In ? { label: 'Ir = In (' + fmt(In, 1) + ' A)', onClick: x => { x.state.Ir = Math.round(In * 10) / 10; } } : null,
          { label: 'Ir −%10', onClick: x => { x.state.Ir = Math.round(st.Ir * 0.9 * 10) / 10; } }, { label: 'Ir +%10', onClick: x => { x.state.Ir = Math.round(st.Ir * 1.1 * 10) / 10; } }];
      });
    k.explodable(ol, [0, 0, 0.25]);
    // klemens dizisi (InstancedMesh)
    const nT = 24, tg = new T.BoxGeometry(0.0055, 0.045, 0.04), tm = new T.InstancedMesh(tg, M.plasticGrey, nT), dm = new T.Object3D();
    for (let j = 0; j < nT; j++) { dm.position.set(-0.3 + j * 0.0075 * 3.2, PL + 0.95, 0.03); dm.updateMatrix(); tm.setMatrixAt(j, dm.matrix); }
    tm.castShadow = true; g1.add(tm);
    // iç bağlantı kabloları (siyah güç, mavi kumanda)
    k.tube([[-0.22, PL + 1.55, 0.06], [-0.15, PL + 1.45, 0.06], [-0.1, PL + 1.34, 0.06]], 0.005, M.cableBlack, g1);
    k.tube([[-0.1, PL + 1.13, 0.05], [0.05, PL + 1.0, 0.05], [0.2, PL + 0.97, 0.04]], 0.005, M.cableBlack, g1);

    // --- bölme 2: PLC + 24 V DC güç kaynağı, altta sürücü veya yumuşak yol verici
    const g2 = k.group(body, x0 + W * 1.5, 0, backZ + 0.005);
    k.box(W - 0.16, 0.035, 0.008, M.galv, 0, PL + 1.62, 0.01, g2);
    k.box(W - 0.12, 0.05, 0.05, M.plasticGrey, 0, PL + 1.79, 0.03, g2);
    k.rbox(0.07, 0.11, 0.1, 0.005, M.plasticGrey, -0.25, PL + 1.62, 0.055, g2); // 24 V PSU
    const cpu = k.group(g2, -0.12, PL + 1.62, 0.055);
    k.rbox(0.1, 0.11, 0.1, 0.006, M.plasticDark, 0, 0, 0, cpu);
    k.box(0.06, 0.02, 0.004, M.plasticGrey, 0, 0.03, 0.051, cpu);
    sc.cpuRun = k.box(0.008, 0.006, 0.004, M.ledGreen, -0.03, -0.03, 0.051, cpu);
    k.pickable(cpu, 'PLC CPU (IEC 61131-3)', () => { const p = app.live.plc; return ['Tarama döngüsü: girişleri oku → merdiven mantığı → çıkışları yaz.', 'RUN: ' + (p.run ? 'mühürlü' : 'beklemede') + ' · Y-Δ zamanlayıcı T1 = ' + fmt(p.timer, 2) + ' s', 'K2/K3 kilitlemesi programda: ' + (app.state.plcInterlock !== false ? 'AÇIK' : 'KAPALI — ihlaller denetlenip engelleniyor'), 'Eğitim amaçlı mantık. Emniyet fonksiyonu değildir (ISO 13849-1 / IEC 62061).']; },
      a => [{ label: a.state.plcInterlock !== false ? 'Kilitlemeyi programdan kaldır' : 'Kilitlemeyi geri ekle', variant: a.state.plcInterlock !== false ? 'warn' : 'primary', onClick: x => { x.state.plcInterlock = x.state.plcInterlock === false; log(x.live, 'PLC programı: K2/K3 kilitlemesi ' + (x.state.plcInterlock ? 'eklendi.' : 'kaldırıldı.')); } },
        a.state.method === 'YD' ? { label: 'T1 −1 s', onClick: x => { x.state.tYD = Math.max(1, x.state.tYD - 1); } } : null,
        a.state.method === 'YD' ? { label: 'T1 +1 s', onClick: x => { x.state.tYD = Math.min(15, x.state.tYD + 1); } } : null]);
    k.label('PLC · G/Ç', cpu, [0.06, 0.085, 0.05], 'vs-label--sm');
    k.explodable(cpu, [0, 0, 0.25]);
    // G/Ç modülleri ve LED’ler (InstancedMesh, MeshBasic + instanceColor: ışık bağımsız parlak görünüm)
    const ledGeo = new T.BoxGeometry(0.006, 0.005, 0.003);
    const leds = new T.InstancedMesh(ledGeo, new T.MeshBasicMaterial({ color: 0xffffff }), 16); leds.castShadow = false;
    for (let mI = 0; mI < 2; mI++) {
      const io = k.group(g2, 0.0 + mI * 0.06, PL + 1.62, 0.055);
      k.rbox(0.05, 0.11, 0.1, 0.004, M.plasticDark, 0, 0, 0, io);
      k.box(0.04, 0.06, 0.004, M.plasticGrey, 0, -0.01, 0.051, io);
      k.pickable(io, mI ? 'DO modülü (Q0.0–Q0.7)' : 'DI modülü (I0.0–I0.7)', () => mI ? ['Q0.0 K1 · Q0.1 K2 · Q0.2 K3', 'Q0.3 çalışıyor lambası · Q0.4 arıza lambası'] : ['I0.0 Başlat (NO) · I0.1 Durdur (NC)', 'I0.2 Acil durdurma (NC) · I0.3 Termik 95-96 (NC) · I0.4 Reset']);
      k.explodable(io, [0, 0, 0.25]);
    }
    const dm2 = new T.Object3D();
    for (let i = 0; i < 16; i++) { const mI = i >> 3, q = i & 7; dm2.position.set(0.0 + mI * 0.06 - 0.012 + (q >> 2) * 0.024, PL + 1.62 + 0.04 - (q & 3) * 0.011, 0.055 + 0.052); dm2.updateMatrix(); leds.setMatrixAt(i, dm2.matrix); }
    leds.instanceColor = new T.InstancedBufferAttribute(new Float32Array(16 * 3), 3);
    g2.add(leds); sc.leds = leds;
    // sürücü / yumuşak yol verici
    if (s.method === 'VFD') {
      const d = k.group(g2, 0, PL + 0.95, 0.12);
      k.rbox(0.24, 0.46, 0.2, 0.012, M.plasticDark, 0, 0, 0, d);
      for (let f = 0; f < 9; f++) k.box(0.004, 0.4, 0.05, M.alu, -0.1 + f * 0.025, 0, -0.12, d); // soğutucu kanatlar
      k.box(0.2, 0.06, 0.01, M.darkSteel, 0, -0.18, 0.1, d);
      sc.vfd = k.screen(0.1, 0.06, 256, (g, w, h) => drawVFD(g, w, h, app), d, { emissive: 0.9 });
      sc.vfd.position.set(0, 0.12, 0.101);
      for (let b = 0; b < 4; b++) k.box(0.018, 0.012, 0.008, M.plasticGrey, -0.04 + b * 0.027, 0.06, 0.102, d);
      k.pickable(d, 'U1 · Frekans konvertörü (VFD)', () => { const r = app.validResult && app.validResult.values, st = app.state; return r ? ['V/f kontrol, rampa ' + st.ramp + ' s, akım sınırı %150 In', 'Yol alma ≈ ' + fmt(r.sim.tStart, 1, 's') + ' · tepe akım ≈ ' + fmt(r.sim.Imax, 0, 'A'), 'Hız ayar noktası %' + st.vfdSpeed + ' (' + fmt(st.vfdSpeed / 2, 1) + ' Hz)', 'K1 burada şebeke kontaktörüdür; durdurma sürücü üzerinden yapılmalıdır. STO emniyet fonksiyonu ayrıca doğrulanmalıdır.'] : []; },
        a => [{ label: 'Hız −10 %', onClick: x => { x.state.vfdSpeed = Math.max(30, x.state.vfdSpeed - 10); } }, { label: 'Hız +10 %', onClick: x => { x.state.vfdSpeed = Math.min(100, x.state.vfdSpeed + 10); } }]);
      k.label('U1 · VFD', d, [0, 0.29, 0.1], 'vs-label--sm');
      k.explodable(d, [0, 0, 0.3]);
    } else if (s.method === 'SOFT') {
      const d = k.group(g2, 0, PL + 1.0, 0.09);
      k.rbox(0.14, 0.24, 0.15, 0.01, M.plasticGrey, 0, 0, 0, d);
      k.box(0.12, 0.05, 0.01, M.plasticDark, 0, 0.06, 0.076, d);
      for (let f = 0; f < 6; f++) k.box(0.004, 0.2, 0.04, M.alu, -0.05 + f * 0.02, 0, -0.09, d);
      sc.softLed = k.box(0.01, 0.008, 0.004, M.ledOff, -0.04, 0.06, 0.082, d);
      k.pickable(d, 'U1 · Yumuşak yol verici (soft starter)', () => { const st = app.state, r = app.validResult && app.validResult.values; return r ? ['Tristörlü gerilim kontrolü, akım sınırı ' + fmt(st.softLimit, 1) + '·In', 'Moment (I/Ist)² oranında düşer; ağır yükte yol alma uzar.', 'Yol alma ≈ ' + (r.sim.tStart ? fmt(r.sim.tStart, 1, 's') : 'yol alamıyor')] : []; });
      k.label('U1 · Soft starter', d, [0, 0.16, 0.08], 'vs-label--sm');
      k.explodable(d, [0, 0, 0.3]);
    } else {
      for (let j = 0; j < 12; j++) k.box(0.0055, 0.045, 0.04, j % 4 === 3 ? M.plasticBlue : M.plasticGrey, -0.1 + j * 0.018, PL + 0.95, 0.03, g2);
    }
    sc.mcc = { x0: x0, W: W };
  }

  /* --- motor + yük, ortak şasi üzerinde */
  function buildMotorSet(k, R, s, app, sc) {
    const M = k.mats, T = k.T;
    const ks = E.clamp(Math.pow(s.Pn / 15, 1 / 3), 0.6, 1.8);
    const paint = k.mat(0x2f5f8f, { metalness: 0.35, roughness: 0.42 });
    const castPaint = k.mat(0x37506a, { metalness: 0.3, roughness: 0.55 });
    const plinthH = 0.15, skidH = 0.1, sh = 0.16 * ks;           // mil yüksekliği (gövde boyu 160 için 160 mm)
    const cy = plinthH + skidH + sh, rB = 0.135 * ks, Lb = 0.42 * ks;
    const mx = 0.55, mz = 0.25;                                   // motor gövde merkezi
    const loadLen = s.loadKind === 'fan' ? 0.9 : s.loadKind === 'conveyor' ? 1.3 : 0.75;
    const skidL = Lb + 0.45 * ks + loadLen;
    const skidX0 = mx - Lb / 2 - 0.18 * ks;
    // beton kaide ve çelik şasi (U profil)
    k.box(skidL + 0.2, plinthH, 0.75 * ks + 0.2, M.concrete, skidX0 + skidL / 2, plinthH / 2, mz, R);
    [-1, 1].forEach(sd => k.box(skidL, skidH, 0.06, M.darkSteel, skidX0 + skidL / 2, plinthH + skidH / 2, mz + sd * 0.25 * ks, R));
    k.box(skidL, 0.012, 0.5 * ks, M.darkSteel, skidX0 + skidL / 2, plinthH + skidH - 0.006, mz, R);
    const mg = k.group(R, mx, cy, mz);
    // gövde, kanatçıklar (InstancedMesh), ayaklar
    const body = k.cyl(rB, rB, Lb, paint, 0, 0, 0, mg, 36); body.rotation.z = Math.PI / 2;
    const nF = 26, finGeo = new T.BoxGeometry(Lb * 0.94, 0.028 * ks, 0.007 * ks), fins = new T.InstancedMesh(finGeo, paint, nF), d = new T.Object3D();
    let fi = 0;
    for (let j = 0; j < 32 && fi < nF; j++) {
      const a = j / 32 * Math.PI * 2; if (Math.abs(Math.sin(a) + 1) < 0.35) continue; // alt (ayak) bölgesi boş
      d.position.set(0, Math.sin(a) * (rB + 0.012 * ks), Math.cos(a) * (rB + 0.012 * ks)); d.rotation.set(a, 0, 0); d.updateMatrix(); fins.setMatrixAt(fi++, d.matrix);
    }
    fins.count = fi; fins.castShadow = true; fins.receiveShadow = true; mg.add(fins);
    [-1, 1].forEach(sd => { k.box(Lb * 0.75, sh - rB * 0.6, 0.045 * ks, paint, 0, -sh / 2 - rB * 0.3, sd * 0.11 * ks, mg); k.box(0.1 * ks, 0.016, 0.1 * ks, paint, sd * Lb * 0.3, -sh + 0.008, sd * 0.13 * ks, mg); });
    // yatak kapakları (flanşlar)
    [-1, 1].forEach(sd => { const e = k.cyl(rB * 1.02, rB * 1.02, 0.03 * ks, castPaint, sd * (Lb / 2 + 0.012 * ks), 0, 0, mg, 36); e.rotation.z = Math.PI / 2; });
    // klemens kutusu
    const tb = k.group(mg, 0.03 * ks, rB + 0.04 * ks, 0);
    k.rbox(0.16 * ks, 0.08 * ks, 0.15 * ks, 0.01, paint, 0, 0, 0, tb);
    k.box(0.15 * ks, 0.012, 0.14 * ks, castPaint, 0, 0.045 * ks, 0, tb);
    const gland = k.cyl(0.018 * ks, 0.018 * ks, 0.04 * ks, M.plasticDark, 0, -0.005, -0.09 * ks, tb, 12); gland.rotation.x = Math.PI / 2;
    k.explodable(tb, [0, 0.3, 0]);
    sc.motorTB = { x: mx + 0.03 * ks, y: cy + rB + 0.04 * ks, z: mz - 0.1 * ks };
    // etiket plakası (anma değerleri)
    const np = k.screen(0.12 * ks, 0.07 * ks, 256, (g, w, h) => {
      g.fillStyle = '#d9dcd8'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = 'bold 20px Arial';
      g.fillText('3~ MOT  IE3  IP55', 10, 26); g.font = '17px Arial';
      g.fillText(fmt(s.Pn, 1) + ' kW  ' + s.Un + ' V  50 Hz', 10, 56); g.fillText('n ' + s.nn + ' d/dk  cosφ ' + fmt(s.cos, 2), 10, 82); g.fillText('η ' + fmt(s.eff * 100, 1) + '%  Ist/In ' + fmt(s.IstIn, 1), 10, 108); g.fillText(s.method === 'YD' ? 'Δ 400 V / Y 690 V' : 'Δ/Y', 10, 134);
    }, mg);
    np.position.set(-0.04, 0.02, rB + 0.03 * ks + 0.001);
    // fan kapağı (NDE) — kabuk ve patlatılabilir; içinde soğutma fanı döner
    const cowl = k.group(mg, -Lb / 2 - 0.08 * ks, 0, 0);
    const cw = k.cyl(rB * 1.08, rB * 1.08, 0.12 * ks, paint, 0, 0, 0, cowl, 36); cw.rotation.z = Math.PI / 2; k.shell(cw);
    for (let r = 1; r <= 4; r++) { const ring = new T.Mesh(new T.TorusGeometry(rB * 1.08 * r / 4.4, 0.004 * ks, 6, 32), M.darkSteel); ring.position.x = -0.062 * ks; ring.rotation.y = Math.PI / 2; ring.castShadow = true; cowl.add(ring); }
    k.explodable(cowl, [-0.35, 0, 0]);
    const cfan = k.group(mg, -Lb / 2 - 0.07 * ks, 0, 0);
    for (let b = 0; b < 8; b++) { const bl = k.box(0.04 * ks, rB * 0.9, 0.006, M.plasticDark, 0, 0, 0, cfan); bl.geometry = bl.geometry.clone(); bl.geometry.translate(0, rB * 0.45, 0); bl.rotation.x = b / 8 * Math.PI * 2; }
    sc.rot.push(cfan);
    k.pickable(body, 'M1 · Asenkron motor', () => motorInfo(app), faultActions);
    sc.motorLabel = k.label('M1', mg, [0, rB + 0.2 * ks, 0]);
    // mil ve kaplin (dönen grup)
    const shaftG = k.group(R, mx + Lb / 2 + 0.03 * ks, cy, mz);
    const shaft = k.cyl(0.021 * ks, 0.021 * ks, 0.12 * ks, M.steel, 0.06 * ks, 0, 0, shaftG, 16); shaft.rotation.z = Math.PI / 2;
    const hub1 = k.cyl(0.05 * ks, 0.05 * ks, 0.05 * ks, M.steel, 0.12 * ks, 0, 0, shaftG, 20); hub1.rotation.z = Math.PI / 2;
    const spider = k.cyl(0.046 * ks, 0.046 * ks, 0.02 * ks, M.plasticYellow, 0.157 * ks, 0, 0, shaftG, 12); spider.rotation.z = Math.PI / 2;
    const hub2 = k.cyl(0.05 * ks, 0.05 * ks, 0.05 * ks, M.steel, 0.195 * ks, 0, 0, shaftG, 20); hub2.rotation.z = Math.PI / 2;
    k.box(0.012 * ks, 0.012 * ks, 0.05 * ks, M.darkSteel, 0.12 * ks, 0.05 * ks, 0, shaftG); // kama/işaret: dönüş görünsün
    sc.rot.push(shaftG);
    k.pickable(hub1, 'Esnek kaplin', () => ['Motor ve yük milini bağlar; elastik eleman darbe ve hizasızlığı sönümler.', 'Toplam atalet J = ' + fmt(app.state.J, 2, 'kg·m²') + ' (motor + kaplin + yük)']);
    // kaplin koruyucu (yarım silindir, kabuk)
    const guard = new T.Mesh(new T.CylinderGeometry(0.075 * ks, 0.075 * ks, 0.22 * ks, 24, 1, true, 0, Math.PI), new T.MeshStandardMaterial({ color: 0xf2a900, roughness: 0.5, metalness: 0.2, side: T.DoubleSide }));
    guard.rotation.z = Math.PI / 2; guard.rotation.y = Math.PI / 2; guard.position.set(mx + Lb / 2 + 0.16 * ks, cy, mz); guard.castShadow = true; R.add(guard); k.shell(guard);
    // yük
    const lx = mx + Lb / 2 + 0.26 * ks;
    if (s.loadKind === 'pump') buildPump(k, R, lx, cy, mz, ks, castPaint, app, sc, plinthH + skidH);
    else if (s.loadKind === 'fan') buildFan(k, R, lx, cy, mz, ks, castPaint, app, sc, plinthH + skidH);
    else buildConveyor(k, R, lx, cy, mz, ks, castPaint, app, sc, plinthH + skidH);
    sc.cy = cy; sc.ks = ks;
  }
  function buildPump(k, R, x, cy, z, ks, paint, app, sc, baseY) {
    const M = k.mats, T = k.T;
    // yatak gövdesi
    const br = k.cyl(0.055 * ks, 0.07 * ks, 0.2 * ks, paint, x + 0.1 * ks, cy, z, R, 20); br.rotation.z = Math.PI / 2;
    k.box(0.16 * ks, cy - baseY - 0.05 * ks, 0.12 * ks, paint, x + 0.1 * ks, baseY + (cy - baseY - 0.05 * ks) / 2, z, R);
    // salyangoz gövde (volüt): kabuk; içindeki çark döner
    const vol = k.group(R, x + 0.3 * ks, cy, z);
    const cas = k.cyl(0.2 * ks, 0.2 * ks, 0.13 * ks, paint, 0, 0, 0, vol, 36); cas.rotation.z = Math.PI / 2; k.shell(cas);
    const tongue = k.box(0.13 * ks, 0.12 * ks, 0.14 * ks, paint, 0, 0.13 * ks, 0.1 * ks, vol); k.shell(tongue);
    k.box(0.12 * ks, cy - baseY - 0.2 * ks, 0.2 * ks, paint, 0, -(cy - baseY) / 2 - 0.1 * ks, 0, vol); // ayak
    // basma ağzı (yukarı) ve emme ağzı (eksenel)
    const dis = k.cyl(0.05 * ks, 0.05 * ks, 0.3 * ks, paint, 0, 0.32 * ks, 0.12 * ks, vol, 18); void dis;
    k.cyl(0.085 * ks, 0.085 * ks, 0.022, M.galv, 0, 0.47 * ks, 0.12 * ks, vol, 20);
    const suc = k.cyl(0.065 * ks, 0.065 * ks, 0.16 * ks, paint, 0.14 * ks, 0, 0, vol, 18); suc.rotation.z = Math.PI / 2;
    const fl = k.cyl(0.1 * ks, 0.1 * ks, 0.022, M.galv, 0.22 * ks, 0, 0, vol, 20); fl.rotation.z = Math.PI / 2;
    // borular (galvaniz)
    k.tube([[x + 0.3 * ks, cy + 0.48 * ks, z + 0.12 * ks], [x + 0.3 * ks, cy + 0.9, z + 0.12 * ks], [x + 0.3 * ks, 1.6, z - 0.6], [x + 0.3 * ks, 2.2, -0.95]], 0.05 * ks, M.galv, R, 40);
    k.tube([[x + 0.52 * ks, cy, z], [x + 0.9, cy, z], [x + 1.15, cy - 0.05, z - 0.2], [x + 1.25, cy - 0.05, -0.95]], 0.065 * ks, M.galv, R, 40);
    // çark (kabuk saydamken görünür)
    const imp = k.group(vol, -0.02 * ks, 0, 0);
    const disk = k.cyl(0.15 * ks, 0.15 * ks, 0.012, M.brass, 0, 0, 0, imp, 28); disk.rotation.z = Math.PI / 2;
    for (let b = 0; b < 6; b++) { const bl = k.box(0.04 * ks, 0.13 * ks, 0.01, M.brass, 0.02 * ks, 0, 0, imp); bl.geometry = bl.geometry.clone(); bl.geometry.translate(0, 0.07 * ks, 0); bl.rotation.x = b / 6 * Math.PI * 2 + 0.3; }
    sc.rot.push(imp);
    k.explodable(vol, [0.35, 0, 0]);
    k.pickable(cas, 'Santrifüj pompa', () => loadInfo(app));
    sc.loadLabel = k.label('Pompa', vol, [0, 0.62 * ks, 0.12 * ks], 'vs-label--sm');
    sc.xMax = x + 1.3;
  }
  function buildFan(k, R, x, cy, z, ks, paint, app, sc, baseY) {
    const M = k.mats, T = k.T;
    const br = k.cyl(0.05 * ks, 0.06 * ks, 0.22 * ks, paint, x + 0.11 * ks, cy, z, R, 20); br.rotation.z = Math.PI / 2;
    k.box(0.18 * ks, cy - baseY - 0.04 * ks, 0.12 * ks, paint, x + 0.11 * ks, baseY + (cy - baseY - 0.04 * ks) / 2, z, R);
    const rH = 0.42 * ks, fx = x + 0.42 * ks, fy = baseY + rH + 0.04;
    const hous = k.group(R, fx, fy, z);
    const hm = k.mat(0x9aa4ad, { metalness: 0.6, roughness: 0.4 });
    const cas = k.cyl(rH, rH, 0.3 * ks, hm, 0, 0, 0, hous, 40); cas.rotation.z = Math.PI / 2; k.shell(cas);
    const out = k.box(0.3 * ks, rH * 0.9, rH, hm, 0, rH * 0.55, -rH * 0.5, hous); k.shell(out); // çıkış ağzı (teğetsel)
    const cone = k.cyl(0.16 * ks, 0.26 * ks, 0.14 * ks, hm, 0.21 * ks, 0, 0, hous, 28); cone.rotation.z = Math.PI / 2;
    k.box(0.26 * ks, fy - rH - baseY + 0.02, 0.5 * ks, M.darkSteel, 0, -rH - (fy - rH - baseY) / 2 + 0.01, 0, hous);
    // kanal
    k.box(0.3 * ks, 1.2, rH, M.galv, fx, fy + rH + 0.5, z - rH * 0.5, R);
    const imp = k.group(hous, 0, 0, 0);
    for (let b = 0; b < 12; b++) { const bl = k.box(0.24 * ks, rH * 0.42, 0.008, M.steel, 0, 0, 0, imp); bl.geometry = bl.geometry.clone(); bl.geometry.translate(0, rH * 0.52, 0); bl.rotation.x = b / 12 * Math.PI * 2; bl.rotation.y = 0; }
    const hubD = k.cyl(rH * 0.32, rH * 0.32, 0.03, M.steel, -0.1 * ks, 0, 0, imp, 24); hubD.rotation.z = Math.PI / 2;
    sc.rot.push(imp);
    k.explodable(hous, [0.4, 0, 0.3]);
    k.pickable(cas, 'Radyal fan', () => loadInfo(app));
    sc.loadLabel = k.label('Fan', hous, [0, rH + 0.1, 0], 'vs-label--sm');
    sc.xMax = fx + 0.5;
  }
  function buildConveyor(k, R, x, cy, z, ks, paint, app, sc, baseY) {
    const M = k.mats, T = k.T;
    // redüktör (dişli kutusu)
    const gb = k.group(R, x + 0.15 * ks, cy, z);
    k.rbox(0.24 * ks, 0.3 * ks, 0.26 * ks, 0.02, paint, 0, 0.03 * ks, 0, gb);
    k.box(0.2 * ks, cy - baseY - 0.1 * ks, 0.2 * ks, paint, 0, -(cy - baseY) / 2 - 0.05 * ks + 0.02, 0, gb);
    k.pickable(gb, 'Redüktör', () => ['Sabit momentli yük: konveyör, kırıcı, karıştırıcı.', 'Kalkışta tam yük momenti gerekir; kalkış momenti (Y-Δ’da 1/3’ü) yükü yenemezse motor yol alamaz.']);
    k.explodable(gb, [0, 0.3, 0]);
    // tambur ve bant, avara makaraları (InstancedMesh)
    const L = 2.2, by = 0.75, bz = z;
    const drum = k.group(R, x + 0.15 * ks, by, bz + 0.45);
    const dr = k.cyl(0.11, 0.11, 0.7, M.rubber, 0, 0, 0, drum, 24); dr.rotation.x = Math.PI / 2;
    k.box(0.02, 0.02, 0.72, M.plasticYellow, 0, 0.1, 0, drum);
    sc.rot.push(drum); drum.userData.axisZ = true;
    k.tube([[x + 0.15 * ks, cy + 0.03 * ks, z], [x + 0.15 * ks, (cy + by) / 2, z + 0.25], [x + 0.15 * ks, by, z + 0.45]], 0.02, M.darkSteel, R, 16);
    const belt = k.box(L, 0.012, 0.66, M.rubber, x + 0.15 * ks + L / 2, by + 0.11, bz + 0.45, R); void belt;
    const nR = 9, rg = new T.CylinderGeometry(0.05, 0.05, 0.66, 14), rolls = new T.InstancedMesh(rg, M.galv, nR), dd = new T.Object3D();
    for (let i = 0; i < nR; i++) { dd.position.set(x + 0.15 * ks + 0.25 + i * (L - 0.25) / nR, by + 0.05, bz + 0.45); dd.rotation.set(Math.PI / 2, 0, 0); dd.updateMatrix(); rolls.setMatrixAt(i, dd.matrix); }
    rolls.castShadow = true; R.add(rolls);
    [-1, 1].forEach(sd => { k.box(L, 0.08, 0.03, M.darkSteel, x + 0.15 * ks + L / 2, by + 0.04, bz + 0.45 + sd * 0.36, R); for (let i = 0; i < 4; i++) k.box(0.05, by, 0.05, M.darkSteel, x + 0.3 + i * L / 3.2, by / 2, bz + 0.45 + sd * 0.36, R); });
    // bant üstünde koliler
    for (let i = 0; i < 4; i++) k.box(0.3, 0.22, 0.35, k.mats.plasticGrey, x + 0.6 + i * 0.5, by + 0.23, bz + 0.45, R);
    k.pickable(dr, 'Bantlı konveyör', () => loadInfo(app));
    sc.loadLabel = k.label('Konveyör', drum, [1.3, 0.5, 0], 'vs-label--sm');
    sc.xMax = x + L + 0.3;
  }
  /* --- buton istasyonu (Başlat, Durdur, Acil durdurma, Reset) — butonlar tıklanabilir */
  function buildStation(k, R, s, app, sc) {
    const M = k.mats;
    const px = -0.35, pz = 0.75;
    sc.stationPos = [px, 0, pz];
    k.cyl(0.025, 0.025, 1.05, M.galv, px, 0.525, pz - 0.05, R, 12);
    k.box(0.25, 0.012, 0.25, M.darkSteel, px, 0.006, pz - 0.05, R);
    const box = k.group(R, px, 1.18, pz);
    k.rbox(0.16, 0.42, 0.11, 0.012, k.mat(0x6b7280, { roughness: 0.5, metalness: 0.2 }), 0, 0, 0, box);
    const lbl = (t, y, c) => { const p = k.screen(0.12, 0.022, 160, (g, w, h) => { g.fillStyle = c || '#e8e8e2'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, w / 2, h / 2); }, box); p.position.set(0, y, 0.0561); };
    const btn = (y, mat, what, title, info) => {
      const g = k.group(box, 0, y, 0.056);
      k.cyl(0.026, 0.026, 0.012, M.darkSteel, 0, 0, 0.004, g, 20).rotation.x = Math.PI / 2;
      const cap = k.cyl(0.02, 0.02, 0.014, mat, 0, 0, 0.014, g, 20); cap.rotation.x = Math.PI / 2;
      k.pickable(g, title, () => info, () => [{ label: 'Bas', variant: what === 'start' ? 'primary' : what === 'reset' ? 'warn' : '', onClick: a => press(a, what) }]);
      return g;
    };
    sc.btnStart = btn(0.15, M.plasticGreen, 'start', 'S1 · Başlat (I0.0, NO)', ['Kalıcı olmayan (NO) buton; PLC K1’i çeker ve mühürleme kontağıyla tutar.']);
    lbl('BAŞLAT', 0.115);
    sc.btnStop = btn(0.05, M.plasticRed, 'stop', 'S2 · Durdur (I0.1, NC)', ['NC kablolama: kablo kopması da durdurur (kırık tel emniyeti).']);
    lbl('DURDUR', 0.015);
    // acil durdurma mantarı: sarı zemin üstünde kırmızı mantar
    const es = k.group(box, 0, -0.07, 0.056);
    k.cyl(0.05, 0.05, 0.006, M.plasticYellow, 0, 0, 0.003, es, 28).rotation.x = Math.PI / 2;
    k.cyl(0.018, 0.018, 0.03, M.plasticRed, 0, 0, 0.018, es, 16).rotation.x = Math.PI / 2;
    const mush = k.group(es, 0, 0, 0);
    const mc = k.cyl(0.036, 0.04, 0.02, M.plasticRed, 0, 0, 0.042, mush, 28); mc.rotation.x = Math.PI / 2;
    sc.mushroom = mush;
    k.pickable(es, 'S0 · ACİL DURDUR (I0.2, NC, kilitlemeli)', () => [app.live.estopPressed ? 'Mantar basılı ve mekanik olarak kilitli.' : 'Basıldığında mekanik olarak kilitlenir.', 'PLC tüm kontaktörleri bırakır; yeniden yol almak için mantar bırakılıp Reset, ardından Başlat gerekir.', 'Gerçek tesiste: kategori 0/1 durdurma, doğrulanmış emniyet rölesi (ISO 13849-1).'],
      a => [a.live.estopPressed ? { label: 'Mantarı çevir + Reset', variant: 'warn', onClick: x => press(x, 'reset') } : { label: 'ACİL DURDUR', variant: 'danger', onClick: x => press(x, 'estop') }]);
    sc.btnReset = btn(-0.16, M.plasticBlue, 'reset', 'S3 · Reset (I0.4)', ['Acil durdurma mantarını bırakır, PLC kilidini çözer ve termik röleyi kurar.', 'Reset motoru kendiliğinden çalıştırmaz.']);
    lbl('RESET', -0.195);
    k.label('Buton istasyonu', box, [0, 0.27, 0], 'vs-label--sm');
  }

  function faultActions(a) {
    const L = a.live;
    return [{ label: 'Faz kaybı', variant: 'warn', onClick: x => inject(x, 'phase') }, { label: 'Rotoru kilitle', variant: 'warn', onClick: x => inject(x, 'locked') },
      L.inj.phase || L.inj.locked ? { label: 'Arızaları gider', onClick: x => inject(x, 'clear') } : null,
      L.plc.K1 ? { label: 'Durdur', onClick: x => press(x, 'stop') } : { label: 'Başlat', variant: 'primary', onClick: x => press(x, 'start') }];
  }
  function motorInfo(app) {
    const r = app.validResult && app.validResult.values, s = app.state, L = app.live; if (!r) return [];
    return [fmt(s.Pn, 1) + ' kW · ' + s.Un + ' V · ' + s.poles + ' kutup · η ' + fmt(s.eff, 3) + ' · cosφ ' + fmt(s.cos, 2),
      'In = ' + fmt(r.nom.In, 1, 'A') + ' · Tn = ' + fmt(r.nom.Tn, 1, 'N·m') + ' · ns = ' + fmt(r.nom.ns, 0, 'd/dk'),
      'Anlık: ' + fmt(L.rpm, 0, 'd/dk') + ' · ' + fmt(L.I, 1, 'A') + ' · ' + fmt(L.T, 0, 'N·m'),
      'Yol alma: ' + (r.sim.tStart ? fmt(r.sim.tStart, 1, 's') : 'moment yetersiz, yol alamıyor')];
  }
  function loadInfo(app) {
    const r = app.validResult && app.validResult.values, s = app.state, L = app.live; if (!r) return [];
    return [LOAD_LABEL[s.loadKind] + ' · ' + (s.loadType === 'quad' ? 'karesel moment (T ~ n²)' : 'sabit moment'),
      'Anma devrinde yük momenti: ' + fmt(s.loadPct / 100 * r.nom.Tn, 0, 'N·m') + ' (%' + s.loadPct + ' Tn)',
      'Anlık yük momenti: ' + fmt(loadTorque(s, r.nom, L.rpm), 0, 'N·m')];
  }

  function drawMeter(g, w, h, app) {
    const L = app.live || {};
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 18px monospace'; g.fillText('M1  ÖLÇÜ', 12, 24);
    g.font = 'bold 30px monospace';
    [['I', fmt(L.I || 0, 1) + ' A'], ['n', fmt(L.rpm || 0, 0) + ' d/dk']].forEach((r, i) => { g.fillStyle = '#94a3b8'; g.textAlign = 'left'; g.fillText(r[0], 12, 80 + i * 56); g.fillStyle = '#fcd34d'; g.textAlign = 'right'; g.fillText(r[1], w - 12, 80 + i * 56); });
    g.textAlign = 'left';
  }
  function drawVFD(g, w, h, app) {
    const L = app.live || {}, r = app.validResult && app.validResult.values;
    g.fillStyle = '#0b2a1a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#4ade80'; g.font = 'bold 40px monospace';
    const f = r && L.rpm ? 50 * L.rpm / r.nom.ns : 0; // senkron devir oranından yaklaşık çıkış frekansı
    g.fillText(fmt(f, 1) + ' Hz', 12, 52);
    g.font = 'bold 28px monospace'; g.fillText(fmt(L.I || 0, 1) + ' A', 12, 100);
    g.fillText(L.plc && L.plc.K1 ? 'RUN' : 'RDY', w - 80, 100);
  }

  /* sahne güncelleme */
  function update(k, res, s, L, app) {
    const sc = app.scene3; if (!sc) return;
    const M = k.mats, p = L.plc;
    Object.keys(sc.contactors).forEach(n => {
      const c = sc.contactors[n], on = !!p[n];
      c.arm.position.z = on ? 0.044 : 0.05; c.flag.material = on ? M.ledGreen : M.ledOff;
    });
    sc.olFlag.material = L.olTripped ? M.plasticRed : M.plasticGreen;
    // yol verici grubu tek etikette: kontaktör durumları + termik
    sc.starterLabel.set(Object.keys(sc.contactors).map(n => n + (p[n] ? ' ●' : ' ○')).join('  ') + (L.olTripped ? ' · F2 AÇTI' : ''));
    sc.starterLabel.level(L.olTripped ? 'bad' : p.K1 ? 'ok' : '');
    sc.pilot[0].material = p.K1 ? M.ledGreen : M.ledOff;
    sc.pilot[1].material = L.olTripped || (p.fault && p.fault !== 'Acil durdurma') ? M.ledRed : M.ledOff;
    sc.pilot[2].material = L.estopPressed || p.estopLatched ? M.ledAmber : M.ledOff;
    if (sc.softLed) sc.softLed.material = p.K1 ? (res.values.sim.tStart && L.tRun > res.values.sim.tStart ? M.ledGreen : M.ledAmber) : M.ledOff;
    sc.mushroom.position.z = L.estopPressed ? -0.012 : 0;
    // G/Ç LED’leri: I0.0–I0.4 girişler, Q0.0–Q0.4 çıkışlar
    const inp = L.inp, on = [inp.start, inp.stop, inp.estop, inp.ol, inp.reset, false, false, false, p.K1, p.K2, p.K3, p.K1, L.olTripped || p.estopLatched, false, false, false];
    const cOn = new k.T.Color(0x22e07a).convertSRGBToLinear(), cOff = new k.T.Color(0x1f2a33);
    on.forEach((b, i) => sc.leds.setColorAt(i, b ? cOn : cOff)); sc.leds.instanceColor.needsUpdate = true;
    const ph = motorPhase(s, L, res.values);
    sc.motorLabel.set('M1 · ' + fmt(L.rpm, 0) + ' d/dk · ' + fmt(L.I, 0) + ' A'); sc.motorLabel.level(ph.lv);
    sc.flows.forEach(f => { f.speed = p.K1 ? E.clamp(0.2 + L.I / Math.max(res.values.nom.In, 1) * 0.35, 0.2, 1.6) : 0; });
    if (sc.meter) sc.meter.redraw();
    if (sc.vfd) sc.vfd.redraw();
  }
  function animate(k, dt, res, s, L, app) {
    const sc = app.scene3; if (!sc) return;
    const target = s.doorOpen ? -1.75 : 0;
    sc.doors.forEach((d, i) => { const tt = target * (1 - i * 0.03); d.rotation.y += (tt - d.rotation.y) * Math.min(1, dt * 4); });
    // dönen parçalar: görsel hız gerçek devirle orantılı fakat yavaşlatılmış (örnekleme kırpışmasını önlemek için)
    const w = k.reducedMotion ? 0 : L.rpm / 1500 * 9;
    sc.rot.forEach(o => { if (o.userData.axisZ) o.rotation.z -= w * dt * 0.6; else o.rotation.x += w * dt; });
    // tick yalnız analiz yenilenince update çağrıldığından canlı göstergeler burada da tazelenir
    sc._t = (sc._t || 0) + dt;
    if (sc._t > 0.1) { sc._t = 0; update(k, res, s, L, app); }
  }

  /* ---------------------------------------------------------------- 2D: canlı merdiven (ladder) diyagramı */
  function view2d(g, W, H, res, s, L) {
    const col = { rail: '#9fb2cb', off: '#55657d', on: '#22e07a', text: '#e6eef8', dim: '#7f94b0', bad: '#ef4444', amber: '#f59e0b' };
    const p = L.plc, inp = L.inp, yd = s.method === 'YD';
    const small = W < 560;
    // üstte durum rozeti, sağda görünüm araç sütunu bulunduğundan çizim alanı içeriden başlar
    const x0 = 18, x1 = W - 70;
    g.font = 'bold 13px Inter, sans-serif'; g.fillStyle = col.text; g.textAlign = 'left';
    g.fillText('PLC merdiven diyagramı · ' + METHOD_LABEL[s.method], x0, 62);
    g.font = '11px Inter, sans-serif'; g.fillStyle = col.dim;
    g.fillText(small ? 'Yeşil: enerjili / iletken. Eğitim amaçlıdır.' : 'Yeşil: enerjili / iletken. Eğitim amaçlı mantık — emniyet fonksiyonu değildir (ISO 13849-1 / IEC 62061).', x0, 80);
    const top = 122;
    const rungs = [
      { id: 'R1', note: 'Başlat / durdur mühürleme', branch: [{ t: 'NO', l: 'I0.0 Başlat', c: inp.start }, { t: 'NO', l: 'Q0.0 K1 (mühür)', c: p.run && p.K1 }],
        el: [{ t: 'NO', l: 'I0.1 Durdur (NC)', c: inp.stop }, { t: 'NC', l: 'M0 Acil kilit', c: !p.estopLatched }, { t: 'NO', l: 'I0.3 Termik 95-96', c: inp.ol }], coil: { l: 'Q0.0 K1', on: p.K1 } },
      { id: 'R2', note: 'Acil durdurma kilidi (set)', el: [{ t: 'NC', l: 'I0.2 Acil (NC)', c: !inp.estop }], coil: { l: 'M0', k: 'S', on: p.estopLatched } },
      { id: 'R3', note: 'Kilit çözme (reset)', el: [{ t: 'NO', l: 'I0.4 Reset', c: inp.reset }, { t: 'NO', l: 'I0.2 Acil sağlam', c: inp.estop }], coil: { l: 'M0', k: 'R', on: inp.reset && inp.estop } }
    ];
    if (yd) {
      const tDone = p.timer >= s.tYD, tDead = p.timer >= s.tYD + 0.05, il = s.plcInterlock !== false;
      rungs.push(
        { id: 'R4', note: 'Y→Δ zaman rölesi', el: [{ t: 'NO', l: 'Q0.0 K1', c: p.K1 }], timer: { l: 'TON T1', pt: s.tYD, et: p.run ? Math.min(p.timer, s.tYD) : 0, on: p.K1 } },
        { id: 'R5', note: il ? 'Yıldız (K3 ile kilitli)' : 'Yıldız — KİLİT KALDIRILDI', el: [{ t: 'NO', l: 'Q0.0 K1', c: p.K1 }, { t: 'NC', l: 'T1.Q', c: !tDone }, il ? { t: 'NC', l: 'Q0.2 K3 kilit', c: !p.K3 } : { t: 'NC', l: 'K3 kilit yok', c: true, bypass: true }], coil: { l: 'Q0.1 K2', on: p.K2 } },
        { id: 'R6', note: il ? 'Üçgen (50 ms ölü zaman, K2 ile kilitli)' : 'Üçgen — ölü zaman ve kilit yok', el: [{ t: 'NO', l: 'Q0.0 K1', c: p.K1 }, { t: 'NO', l: il ? 'T1.Q + 50 ms' : 'T1.Q', c: il ? tDead : tDone }, il ? { t: 'NC', l: 'Q0.1 K2 kilit', c: !p.K2 } : { t: 'NC', l: 'K2 kilit yok', c: true, bypass: true }], coil: { l: 'Q0.2 K3', on: p.K3 } });
    }
    const avail = H - top - (yd ? 56 : 120);
    const step = Math.min(78, avail / rungs.length);
    // sol ve sağ raylar
    const yEnd = top + step * rungs.length - step * 0.35;
    g.lineWidth = 3; g.strokeStyle = col.on; g.beginPath(); g.moveTo(x0, top - 6); g.lineTo(x0, yEnd); g.stroke();
    g.strokeStyle = col.rail; g.beginPath(); g.moveTo(x1, top - 6); g.lineTo(x1, yEnd); g.stroke();
    rungs.forEach((r, ri) => {
      const y = top + ri * step + 14;
      g.font = '10px Inter, sans-serif'; g.fillStyle = col.dim; g.textAlign = 'left';
      g.fillText(r.id + ' · ' + r.note, x0 + 6, y + (r.branch ? step * 0.42 + 24 : 22));
      const items = (r.branch ? [{ branch: r.branch }] : []).concat(r.el);
      const coilX = x1 - (small ? 46 : 70);
      const n = items.length, span = (coilX - 30 - (x0 + 20)) / n;
      let pw = true, x = x0;
      items.forEach((it, i) => {
        const cx = x0 + 20 + span * (i + 0.5);
        if (it.branch) {
          // paralel dal: Başlat || K1 mühür
          const a = it.branch[0], b = it.branch[1], yb = y + step * 0.42, xl = x0 + 10, xr = cx + span * 0.45;
          seg(g, x, y, cx - 14, y, pw, col); seg(g, xl, y, xl, yb, pw, col); seg(g, xl, yb, cx - 14, yb, pw, col);
          contact(g, cx, y, a, pw, col, small); contact(g, cx, yb, b, pw, col, small);
          const out = pw && (a.c || b.c);
          seg(g, cx + 14, y, xr, y, pw && a.c, col); seg(g, cx + 14, yb, xr, yb, pw && b.c, col); seg(g, xr, yb, xr, y, pw && b.c, col);
          pw = out; x = xr; return;
        }
        seg(g, x, y, cx - 14, y, pw, col);
        contact(g, cx, y, it, pw, col, small);
        pw = pw && it.c; x = cx + 14;
      });
      if (r.timer) {
        seg(g, x, y, coilX - 26, y, pw, col);
        const tm = r.timer; g.strokeStyle = tm.on ? col.on : col.off; g.lineWidth = 2; g.strokeRect(coilX - 26, y - 16, 70, 32);
        g.fillStyle = col.text; g.font = 'bold 10px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(tm.l, coilX + 9, y - 4);
        g.font = '10px Inter, sans-serif'; g.fillStyle = tm.on ? col.on : col.dim; g.fillText(fmt(tm.et, 1) + ' / ' + fmt(tm.pt, 1) + ' s', coilX + 9, y + 10);
      } else {
        seg(g, x, y, coilX - 14, y, pw, col);
        const c = r.coil, on = c.on;
        g.lineWidth = 2; g.strokeStyle = on ? col.on : col.off; g.fillStyle = on ? '#14532d' : 'transparent';
        g.beginPath(); g.arc(coilX, y, 13, 0, Math.PI * 2); if (on) g.fill(); g.stroke();
        g.fillStyle = on ? col.on : col.dim; g.font = 'bold 11px Inter, sans-serif'; g.textAlign = 'center'; g.fillText(c.k || '', coilX, y + 4);
        g.font = '10px Inter, sans-serif'; g.fillText(c.l, coilX, y + 26);
        seg(g, coilX + 13, y, x1, y, false, col);
      }
    });
    // alt durum satırı
    const ys = H - (yd ? 26 : 96);
    g.textAlign = 'left'; g.font = '11px Inter, sans-serif';
    const ph = motorPhase(s, L, res.values);
    g.fillStyle = ph.lv === 'bad' ? col.bad : ph.lv === 'warn' ? col.amber : ph.lv === 'ok' ? col.on : col.text;
    g.fillText('Motor: ' + ph.t + ' · ' + fmt(L.rpm, 0) + ' d/dk · ' + fmt(L.I, 1) + ' A · ' + fmt(L.T, 0) + ' N·m', x0, ys);
    g.fillStyle = col.dim; g.fillText((p.fault ? 'PLC arıza: ' + p.fault + ' · ' : '') + 'Termik: ' + (L.olTripped ? 'AÇTI' : 'normal') + ' · Acil: ' + (L.estopPressed ? 'basılı' : p.estopLatched ? 'kilitli' : 'hazır'), x0, ys + 16);
    if (L.violations) {
      g.fillStyle = col.bad; g.font = 'bold 11px Inter, sans-serif';
      g.fillText('⚠ ' + L.violations + ' kilitleme ihlali ENGELLENDİ: ' + (L.violation ? L.violation.msg : '') + (W > 900 ? ' (K2 bırakmadan K3 istendi)' : ''), x0, ys - 18);
      g.font = '11px Inter, sans-serif';
    }
    if (!yd) {
      g.fillStyle = col.dim;
      g.fillText(s.method === 'DOL' ? 'Doğrudan yol vermede yalnız K1 kullanılır; Y-Δ basamakları (zaman rölesi, K2/K3 kilitleme) devre dışı.' : 'K1 şebeke kontaktörüdür; yol verme ' + (s.method === 'VFD' ? 'sürücü rampası' : 'yumuşak yol verici akım sınırı') + ' ile yapılır.', x0, ys + 34);
    }
  }
  function seg(g, xa, ya, xb, yb, on, col) { g.lineWidth = on ? 3 : 2; g.strokeStyle = on ? col.on : col.off; g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke(); }
  function contact(g, x, y, it, pw, col, small) {
    const cond = it.c, live = pw && cond;
    g.lineWidth = 2; g.strokeStyle = cond ? col.on : col.off;
    g.beginPath(); g.moveTo(x - 6, y - 11); g.lineTo(x - 6, y + 11); g.moveTo(x + 6, y - 11); g.lineTo(x + 6, y + 11); g.stroke();
    if (it.bypass) { g.save(); g.strokeStyle = col.bad; g.setLineDash([3, 3]); g.strokeRect(x - 12, y - 12, 24, 24); g.restore(); }
    else if (it.t === 'NC') { g.beginPath(); g.moveTo(x - 9, y + 10); g.lineTo(x + 9, y - 10); g.stroke(); }
    seg(g, x - 14, y, x - 6, y, pw, col); seg(g, x + 6, y, x + 14, y, live, col);
    g.fillStyle = it.bypass ? col.bad : cond ? '#a7f3d0' : col.dim; g.font = (small ? '9px' : '10px') + ' Inter, sans-serif'; g.textAlign = 'center';
    g.fillText(it.l, x, y - 15);
  }

  VS.register({
    id: 'motor', title: '3D Motor, MCC ve PLC Otomasyon Simülasyonu',
    defaults: defaults,
    initLive: initLive,
    autoRun: true,
    startText: 'Başlat butonuna basıldı: PLC K1’i çekiyor.',
    start: app => { app._startedOnce = true; if (app.root.dataset.ready === 'true') press(app, 'start'); },
    tasks: [
      { id: 'yd-delta', title: 'Pompayı yıldız–üçgen ile üçgene geçir', goal: 'Başlat’a basın; PLC yıldızda yol versin, zaman rölesi sonunda kilitli geçişle K3 (üçgen) çeksin ve motor anma devrinde çalışsın.', hint: 'Kumanda → Başlat ya da 3D’de yeşil butona tıklayıp “Bas”. Y→Δ süresi dolunca K2 bırakır, 50 ms sonra K3 çeker.',
        state: defaults(),
        check: (r, s, L) => s.method === 'YD' && L.plc.K3 && !L.plc.K2 && L.steady > 1 },
      { id: 'estop', title: 'Acil durdurmadan doğru sırayla kurtul', goal: 'Çalışan motoru ACİL DURDUR ile durdurun, sonra doğru sırayla yeniden çalıştırın: mantarı bırak + Reset, ardından Başlat.', hint: 'Mantar basılıyken Başlat etkisizdir. Reset mantarı bırakır ve PLC kilidini çözer; motor kendiliğinden kalkmaz, Başlat gerekir.',
        state: defaults(), start: true,
        check: (r, s, L) => !!L.recovered },
      { id: 'heavy', title: 'Ağır konveyörü düşük akımla yol al', goal: '%110 sabit momentli konveyör Y-Δ ile yıldızda kilitli kalıyor ve üçgende ≈7·In çekiyor. Yükü azaltmadan, tepe akım ≤ 3·In ile yol almasını sağlayın.', hint: 'Yıldızdaki moment Tst/3’tür. Akımı sınırlarken tam moment verebilen yöntemi (frekans konvertörü) deneyin; Moment–devir grafiğini izleyin.',
        state: Object.assign(defaults(), { method: 'YD', loadKind: 'conveyor', loadType: 'const', loadPct: 110, J: 0.8 }),
        check: (r, s) => s.loadType === 'const' && s.loadPct >= 110 && !!r.values.sim.tStart && !r.values.sim.stalled && r.values.sim.Imax <= 3 * r.values.nom.In },
      { id: 'ir', title: 'Termik ayarını düzelt (gereksiz açma)', goal: 'Termik röle Ir = 22 A’e ayarlanmış; %100 yüklü pompa çalışırken gereksiz açıyor. Ir’yi doğru ayarlayıp motoru en az 8 s açmadan çalıştırın.', hint: 'Ir ≈ In (motor etiket akımı) olmalı. Açtıysa Reset ve Başlat. 3D’de termik röleye tıklayıp “Ir = In” de kullanılabilir.',
        state: Object.assign(defaults(), { loadPct: 100, Ir: 22 }), start: true,
        check: (r, s, L) => { const c = r.checks.find(x => x.id === 'ir'); return !!c && c.status === 'ok' && !L.olTripped && L.steady >= 8; } },
      { id: 'energy', title: 'VFD ile %70 debide enerji tasarrufu', goal: 'Pompa %70 debide vana kısma ile çalışıyor. Frekans konvertörüne geçerek yıllık enerjiyi en az %40 azaltın ve pompayı çalıştırın.', hint: 'Yol verme yöntemini VFD yapın, sürücü hız ayar noktasını debiyle aynı (%70) yapın ve Başlat’a basın. Enerji grafiğinde iki eğrinin farkına bakın (P ∝ n³).',
        state: Object.assign(defaults(), { method: 'DOL', flowPct: 70 }),
        check: (r, s, L) => s.method === 'VFD' && s.flowPct <= 70 && s.vfdSpeed <= s.flowPct + 5 && !!r.values.energy && r.values.energy.savingPct >= 40 && L.plc.K1 && L.steady > 1 },
      { id: 'phase', title: 'Faz kaybını termik röleye yakalat', goal: 'Çalışan pompada bir faz kopsun; kalan fazlardaki ≈√3·I akımla termik rölenin açtığını görün.', hint: 'Arıza enjeksiyonu → Faz kaybı (ya da 3D’de motora tıklayın). Açma süresi temsilidir ve sınıf aralığına göre ölçeklenir.',
        state: Object.assign(defaults(), { loadPct: 100 }), start: true,
        check: (r, s, L) => L.olTripped && L.tripCause === 'phase' },
      { id: 'interlock', title: 'Kilitlemenin önemini gör', goal: 'PLC programından K2/K3 kilitlemesini kaldırıp Y-Δ yol verin ve ihlalin engellendiğini görün; sonra kilitlemeyi geri ekleyip motoru üçgende çalıştırın.', hint: 'PLC programı → kilitleme anahtarını kapatın, Başlat. İhlal olay günlüğünde ve 2D şemada görünür. Durdur, kilidi açın, yeniden Başlat.',
        state: defaults(),
        check: (r, s, L) => L.violations > 0 && s.plcInterlock !== false && L.plc.K3 && L.steady > 1 }
    ],
    scenarios: [
      { id: 'yd-pump', name: 'Pompa · yıldız–üçgen yol verme', desc: '15 kW pompa, Y-Δ 4 s. Yıldızda moment 1/3’e düşer; zaman rölesi sonunda kilitli geçişle üçgene geçilir.', state: defaults(), start: true },
      { id: 'dol-fan', name: 'Fan · doğrudan yol verme (DOL)', desc: '7,5 kW fan doğrudan yol alır; kalkış akımı ≈ 7·In, kısa sürede anma devrine ulaşır.', state: Object.assign(defaults(), { Pn: 7.5, eff: 0.9, cos: 0.84, nn: 1455, IstIn: 7.4, Ir: 14.3, J: 0.4, method: 'DOL', loadKind: 'fan', loadType: 'quad', loadPct: 85 }), start: true },
      { id: 'vfd-conv', name: 'Konveyör · frekans konvertörü', desc: 'Sabit momentli konveyör, 5 s rampa: akım %150 In ile sınırlı, tam yükte yumuşak kalkış.', state: Object.assign(defaults(), { Pn: 11, eff: 0.91, cos: 0.85, nn: 1460, IstIn: 7.5, Ir: 20.5, J: 0.5, method: 'VFD', loadKind: 'conveyor', loadType: 'const', loadPct: 100, ramp: 5 }), start: true },
      { id: 'soft-pump', name: 'Pompa · yumuşak yol verici', desc: '30 kW pompa, akım sınırı 4·In: kalkış akımı düşer, yol alma uzar.', state: Object.assign(defaults(), { Pn: 30, eff: 0.935, cos: 0.86, nn: 1475, IstIn: 7.2, Ir: 54, J: 1.4, method: 'SOFT', softLimit: 4, loadPct: 75 }), start: true },
      { id: 'stall', name: 'Hatalı seçim · ağır konveyöre Y-Δ', desc: 'Sabit momentli %110 yükte yıldızdaki moment (Tst/3 ≈ 0,73·Tn) yetmez: motor yıldız süresince kilitli rotorda bekler, üçgene geçişte doğrudan yol verme gibi yüksek akımla kalkar. Y-Δ’nin amacı boşa çıkar.', state: Object.assign(defaults(), { method: 'YD', loadKind: 'conveyor', loadType: 'const', loadPct: 110, J: 0.8 }), start: true }
    ],
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, L) => L.estopPressed || L.plc.estopLatched ? { level: 'bad', text: 'ACİL DURDURMA' } : L.olTripped ? { level: 'bad', text: 'Termik açtı' } : L.plc.K1 ? (ph => ({ level: ph.lv || 'ok', text: ph.t + ' · ' + fmt(L.rpm, 0) + ' d/dk' }))(motorPhase(s, L, res.values)) : null,
    reportInputs: (s, app) => [{ group: 'Simülasyon', label: 'Son motor durumu', value: motorPhase(s, app.live, app.validResult.values).t }],
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-2.8, 3] },
    view2d: view2d
  });
})();
