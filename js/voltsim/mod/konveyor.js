/* VoltSim · 3D Konveyör Hattı ve SCADA Simülasyonu
 * Hesap: VoltSimEngine.ext.konveyor (js/voltsim/calc/konveyor.js): veri olarak tanımlı merdiven programı ve PLC taraması
 * (motor yol verici FB’si engine.motor.plcScan — motor-otomasyon modülünün mühür/acil kilidi/termik mantığı), ürün akışı,
 * fotoseller, motor akımları ve termik, IEC 62682 alarm durumları ve trend. Sahne ve HMI, benzetim durumunu gösterir. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt, esc = VS.esc;
  const X = E.ext.konveyor;
  const NAMES = ['C1 besleme', 'C2 ara bant', 'C3 çıkış'];

  function defaults() { return { v: 0.5, feed: 20, tSeq: 2, runout2: 14, runout3: 10, tJam: 3, cls: '10', speed: 1, hmi: 'mimic', jamAt: 0, strain2: false }; }
  const cfgOf = s => X.config({ v: s.v, feed: s.feed, tSeq: s.tSeq, runout: [0, s.runout2, s.runout3], tJam: s.tJam, cls: s.cls });
  function initLive(s) {
    const cfg = cfgOf(s);
    return { sim: X.initSim(cfg), es: [false, false, false], pulse: {}, strainOn: [0, 0, 0], flags: {}, jams: 0, tJamRef: s.tJam, jamsAt: 0, countAt: 0, jamDone: false };
  }
  const B = L => L.sim.plc.b;
  const lineState = L => { const b = B(L); return b.M_ESL || !b.M_CHAIN ? 'estop' : b.M_JAMANY ? 'jam' : b.M_OLANY ? 'ol' : b.Q_K1 && b.Q_K2 && b.Q_K3 ? 'run' : b.Q_K1 || b.Q_K2 || b.Q_K3 ? 'trans' : 'stop'; };
  const LS = { estop: ['ACİL DURDURMA', 'bad'], jam: ['SIKIŞMA', 'bad'], ol: ['TERMİK AÇTI', 'bad'], run: ['Üretimde', 'ok'], trans: ['Sıralı kalkış / duruş', 'warn'], stop: ['Duruyor', 'info'] };

  /* ---------------------------------------------------------------- operatör işlemleri */
  function press(app, what) {
    const L = app.live, b = B(L);
    if (what === 'start') { L.pulse.start = true; if (b.M_RUN) VS.toast('Hat zaten çalışıyor.'); }
    else if (what === 'stop') { L.pulse.stop = true; if (b.Q_K1 && b.Q_K2 && b.Q_K3) L.flags.stopReq = true; }
    else if (what === 'reset') L.pulse.reset = true;
    else if (what === 'ack') { const had = L.sim.alarms.some(a => /^J/.test(a.id) && a.active); L.sim = Object.assign({}, L.sim, { alarms: X.ackAll(L.sim.alarms) }); if (had) L.flags.jamAcked = true; }
    app.running = true; app.paused = false; if (app.syncToolbar) app.syncToolbar();
    app.invalidate();
  }
  function estop(app, i, on) { const L = app.live; L.es[i] = on; if (on && lineState(L) !== 'stop') L.flags.estopSeen = true; app.running = true; app.paused = false; app.invalidate(); app.renderControls(); }
  function jam(app, i) { const L = app.live, cfg = cfgOf(app.state); L.sim = Object.assign({}, L.sim, { plant: X.injectJam(L.sim.plant, cfg, i) }); VS.toast(NAMES[i] + ': koli sıkıştırıldı (fotosel önünde).', 'bad'); app.running = true; app.invalidate(); }
  function clearJam(app) { const L = app.live, cfg = cfgOf(app.state); L.sim = Object.assign({}, L.sim, { plant: X.clearJam(L.sim.plant, cfg) }); VS.toast('Sıkışan koliler alındı. Reset ve Start ile devam edin.'); app.invalidate(); }
  function olReset(app) { const L = app.live; L.sim = Object.assign({}, L.sim, { plant: Object.assign({}, L.sim.plant, { ol: [true, true, true], olAcc: [0, 0, 0] }) }); VS.toast('Termik röleler elle resetlendi (95-96 kapalı). PLC’de Reset gerekir.'); app.invalidate(); }

  /* ---------------------------------------------------------------- hesap (statik analiz) */
  function compute(s) {
    const v = new E.Validator();
    v.num(s.v, 'Bant hızı', { min: 0.1, max: 2, unit: 'm/s' }); v.num(s.feed, 'Besleme', { min: 0, max: 120, unit: 'adet/dk' });
    v.num(s.tSeq, 'Kalkış gecikmesi', { min: 0.2, max: 30, unit: 's' }); v.num(s.runout2, 'C2 boşaltma', { min: 0, max: 120, unit: 's' }); v.num(s.runout3, 'C3 boşaltma', { min: 0, max: 120, unit: 's' }); v.num(s.tJam, 'Sıkışma süresi', { min: 0.1, max: 60, unit: 's' });
    if (v.errors.length) return { ok: false, errors: v.errors, checks: [], values: {} };
    const cfg = cfgOf(s), a = X.analysis(cfg);
    const checks = [
      { id: 'feed', label: 'Besleme ≤ hat kapasitesi', status: a.feedOK ? 'ok' : 'warn', detail: 'Besleme ' + fmt(s.feed, 0) + ' adet/dk, kapasite ≈ ' + fmt(a.cap, 0) + ' adet/dk (koli 0,4 m + en az 0,15 m aralık, ' + fmt(s.v, 2) + ' m/s).' },
      { id: 'jam', label: 'Sıkışma süresi > fotosel kapanma süresi', status: a.jamOK ? 'ok' : 'fail', detail: 'Bir koli fotoseli ' + fmt(a.peBlock, 2) + ' s kapatır; sıkışma zamanlayıcısı ' + fmt(s.tJam, 1) + ' s' + (a.jamOK ? '.' : ': normal akışta yalancı sıkışma alarmı oluşur (en az ' + fmt(a.peBlock + 0.2, 1) + ' s önerilir).') },
      { id: 'runout', label: 'Boşaltma süreleri (sıralı duruş)', status: a.runoutOK[1] && a.runoutOK[2] ? 'ok' : 'warn', detail: 'Bandı tamamen boşaltmak için C2 ≥ ' + fmt(a.need[1], 1) + ' s, C3 ≥ ' + fmt(a.need[2], 1) + ' s gerekir; ayar ' + fmt(s.runout2, 1) + ' / ' + fmt(s.runout3, 1) + ' s.' },
      { id: 'estop', label: 'Acil durdurma', status: 'info', detail: 'Zincir açılınca tüm kontaktörler aynı taramada düşer (durdurma kategorisi 0), kilit ancak zincir sağlam + Reset ile çözülür ve hat kendiliğinden kalkmaz. Gerçek tesiste acil durdurma PLC programına değil, PL/SIL değeri belirlenmiş emniyet rölesine/güvenlik PLC’sine bağlanır.', ref: 'IEC 60204-1 · ISO 13850 · ISO 13849-1' },
      { id: 'alarm', label: 'Alarm yönetimi', status: 'info', detail: 'Alarmlar etkin–onaysız, etkin–onaylı ve normale dönmüş–onaysız durumlarıyla izlenir; korna onaysız alarm varken çalar.', ref: 'IEC 62682' }
    ];
    return { ok: true, errors: [], checks: checks,
      values: { v: s.v, cap: a.cap, peBlock: a.peBlock, need: a.need, startTime: a.startTime, In: a.In, motors: cfg.motors.map(m => ({ Pn: m.Pn, In: m.In })), L: cfg.L, end: cfg.end },
      assumptions: [
        'Hat: C1 4 m (2,2 kW), C2 6 m (3 kW), C3 4 m (2,2 kW), bantlar arası 0,12 m aktarma; koli boyu 0,4 m. Motor anma akımları engine.motor.nominal ile (400 V, cosφ 0,8).',
        'PLC: ' + X.PROGRAM.length + ' basamaklı merdiven programı her taramada (50 ms benzetim adımı) yukarıdan aşağı değerlendirilir. Motor yol verici FB’si engine.motor.plcScan’dir (motor-otomasyon modülündeki mühür, acil kilidi ve termik izni).',
        'Bant hız rampası 0,5 s (DOL); yol almada akım ≈ 6·In’den anma akımına iner. Yük akımı bant üzerindeki koli sayısı, kayan (sıkışmış) koli ve mekanik zorlanmayla temsili olarak artar.',
        'Termik röle: I > 1,2·In iken açma süresi seçilen sınıfın 7,2·Ir üst sınırından I² ile ölçeklenir (en çok 30 s, temsili).',
        'Fotosel bant sonundan 0,15 m geridedir; sıkışma zamanlayıcısı yalnız bant çalışırken sayar. Koli durmuş banda aktarılamaz, bant sonunda bekler.',
        'Acil durdurma bu modelde PLC girişi olarak gösterilmiştir; gerçek güvenlik fonksiyonu ayrı emniyet devresiyle gerçekleştirilir. Simülasyon devreye alma ve risk değerlendirmesinin yerine geçmez.'
      ],
      formulas: ['Kapasite = 60·v / (koli + aralık) [adet/dk]', 't_PE = koli / v', 't_boşaltma ≥ (L + koli) / v', 'In = P / (√3·U·η·cosφ)', 'TON: Q = IN ∧ (t ≥ PT) · TOF: Q = IN ∨ (t_düşüş < PT)', 't_açma ≈ t_sınıf·(7,2/(I/In))²']
    };
  }

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const L = app.live, r = app.validResult && app.validResult.values;
    return [
      { title: 'Operatör paneli', items: [
        { type: 'buttons', items: [{ label: 'START', variant: 'primary', onClick: a => press(a, 'start') }, { label: 'STOP', variant: 'warn', onClick: a => press(a, 'stop') }, { label: 'RESET', onClick: a => press(a, 'reset') }, { label: 'Alarm onayı', onClick: a => press(a, 'ack') }] },
        { type: 'buttons', items: [0, 1, 2].map(i => ({ label: (L.es[i] ? 'Acil ' + (i + 1) + ' · bırak' : 'Acil ' + (i + 1) + ' · BAS'), variant: L.es[i] ? 'primary' : 'danger', onClick: a => estop(a, i, !a.live.es[i]) })) },
        { type: 'note', text: 'Start hattı sırayla kaldırır (C3 → C2 → C1); Stop sırayla durdurur (C1 hemen, C2 ve C3 boşaltma süresinden sonra). Acil durdurmadan sonra mantarı bırakın, Reset ve Start.' }
      ] },
      { title: 'Hat parametreleri', items: [
        { type: 'range', key: 'v', label: 'Bant hızı', min: 0.2, max: 1.2, step: 0.05, unit: 'm/s', digits: 2 },
        { type: 'range', key: 'feed', label: 'Besleme (koli)', min: 0, max: 60, step: 1, unit: 'adet/dk' },
        { type: 'range', key: 'tSeq', label: 'Sıralı kalkış gecikmesi (T1, T2)', min: 0.5, max: 10, step: 0.5, unit: 's', digits: 1 },
        { type: 'range', key: 'runout2', label: 'C2 boşaltma süresi (T4 TOF)', min: 0, max: 40, step: 0.5, unit: 's', digits: 1 },
        { type: 'range', key: 'runout3', label: 'C3 boşaltma süresi (T3 TOF)', min: 0, max: 40, step: 0.5, unit: 's', digits: 1 },
        { type: 'range', key: 'tJam', label: 'Sıkışma süresi (T5–T7 TON)', min: 0.3, max: 10, step: 0.1, unit: 's', digits: 1 },
        { type: 'select', key: 'cls', label: 'Termik röle sınıfı', options: [['10A', 'Sınıf 10A'], ['10', 'Sınıf 10'], ['20', 'Sınıf 20'], ['30', 'Sınıf 30']] },
        r ? { type: 'note', html: 'Kapasite ≈ <b>' + fmt(r.cap, 0) + ' adet/dk</b> · fotosel kapanma ' + fmt(r.peBlock, 2) + ' s<br>Gereken boşaltma: C2 ≥ <b>' + fmt(r.need[1], 1) + ' s</b>, C3 ≥ <b>' + fmt(r.need[2], 1) + ' s</b> · tam kalkış ' + fmt(r.startTime, 1) + ' s' } : null,
        { type: 'select', key: 'speed', label: 'Benzetim hızı', options: [[0.5, '×0,5'], [1, '×1'], [2, '×2'], [4, '×4']], report: false }
      ] },
      { title: 'Arıza enjeksiyonu', items: [
        { type: 'buttons', items: [0, 1, 2].map(i => ({ label: 'C' + (i + 1) + ' sıkıştır', variant: 'danger', onClick: a => jam(a, i) })).concat([{ label: 'Sıkışmayı gider', variant: 'primary', onClick: clearJam }]) },
        { type: 'toggle', key: 'strain2', label: 'M2 mekanik zorlanma (rulman/bant gerginliği)' },
        { type: 'buttons', items: [{ label: 'Termik röleleri resetle', onClick: olReset }] }
      ] },
      { title: 'SCADA ekranı (2D)', items: [
        { type: 'seg', key: 'hmi', label: '2D görünüm', options: [['mimic', 'Mimik + alarmlar'], ['ladder', 'Merdiven programı']] },
        { type: 'note', text: '“2D şema” düğmesiyle SCADA ekranını açın: mimik diyagram, alarm listesi ve trend ya da canlı vurgulanan merdiven basamakları (salt okunur).' }
      ] }
    ];
  }

  /* ---------------------------------------------------------------- okumalar, grafikler */
  function rate(L) { const h = L.sim.hist; if (h.length < 8) return 0; const a = h[Math.max(0, h.length - 240)], b = h[h.length - 1]; return b.t > a.t ? (b.n - a.n) / (b.t - a.t) * 60 : 0; }
  function readouts(res, s, L) {
    const b = B(L), pl = L.sim.plant, ls = LS[lineState(L)], pe = X.peState(cfgOf(s), pl.items), v = res.values;
    const unack = L.sim.alarms.filter(a => !a.acked).length;
    const mot = i => ({ label: 'M' + (i + 1) + ' · ' + NAMES[i], value: !pl.ol[i] ? 'TERMİK' : [b.Q_K1, b.Q_K2, b.Q_K3][i] ? fmt(pl.I[i], 1, 'A') : 'duruyor', level: !pl.ol[i] ? 'bad' : pl.I[i] > 1.2 * v.In[i] ? 'warn' : [b.Q_K1, b.Q_K2, b.Q_K3][i] ? 'ok' : undefined, sub: 'In ' + fmt(v.In[i], 1, 'A') + ' · hız %' + fmt(pl.spd[i] * 100, 0) + ' · PE' + (i + 1) + ' ' + (pe[i] ? 'kapalı' : 'açık') });
    return [
      { label: 'Hat durumu', value: ls[0], level: ls[1], sub: 'Zaman ' + fmt(pl.t, 0, 's') + ' · kule lambası ' + (b.Q_RED ? 'kırmızı' : b.Q_GREEN ? 'yeşil' : b.M_RUN ? 'sarı' : 'sönük'), wide: true },
      mot(0), mot(1), mot(2),
      { label: 'Üretim sayacı (C1 CTU)', value: String(L.sim.plc.C_OUT) + ' koli', sub: fmt(rate(L), 1) + ' adet/dk · hatta ' + pl.items.length + ' koli' },
      { label: 'Alarmlar', value: L.sim.alarms.length ? L.sim.alarms.length + ' (' + unack + ' onaysız)' : 'Yok', level: unack ? 'bad' : L.sim.alarms.length ? 'warn' : 'ok', sub: L.sim.alarms.map(a => a.text + (a.active ? '' : ' (normale döndü)') + (a.acked ? ' ✓' : '')).join(' · ') || 'korna sessiz', wide: true }
    ];
  }
  function charts(res, s, L) {
    const h = L.sim.hist.slice(-480), t0 = h.length ? h[0].t : 0;
    const xs = { label: 's' };
    return [{ id: 'trend', title: 'Motor akımları trendi (A)', height: 160,
      series: [0, 1, 2].map(i => ({ name: 'M' + (i + 1), color: ['amber', 'cyan', 'violet'][i], data: h.map(p => [p.t, p.I[i]]) })),
      hLines: [{ y: 1.2 * res.values.In[1], label: '1,2·In (M2)', color: '#ef4444' }], x: Object.assign({ min: t0 }, xs), y: { min: 0, label: 'A' },
      alt: 'Son değerler: ' + [0, 1, 2].map(i => 'M' + (i + 1) + ' ' + fmt(L.sim.plant.I[i], 1) + ' A').join(', ') + '.' },
    { id: 'count', title: 'Üretim sayacı (koli)', height: 130, series: [{ name: 'Sayaç', color: 'green', area: true, data: h.map(p => [p.t, p.n]) }], x: Object.assign({ min: t0 }, xs), y: { min: 0, label: 'adet' },
      alt: 'Toplam ' + L.sim.plc.C_OUT + ' koli, ' + fmt(rate(L), 1) + ' adet/dk.' }];
  }

  /* ---------------------------------------------------------------- zaman */
  function tick(app, dt) {
    const L = app.live, s = app.state, cfg = cfgOf(s);
    if (!(dt > 0)) return false;                                   // ilk kare (dt = 0): buton darbeleri korunur
    const strain = [0, s.strain2 ? 1.1 : 0, 0];
    const before = { st: lineState(L), alarms: L.sim.alarms.length, n: L.sim.plc.C_OUT };
    const ui = { start: !!L.pulse.start, stop: !!L.pulse.stop, reset: !!L.pulse.reset, es: L.es.slice(), strain: strain };
    L.pulse = {};
    if (s.jamAt > 0 && !L.jamDone && L.sim.plant.t >= s.jamAt && B(L).Q_K2) { L.jamDone = true; L.sim = Object.assign({}, L.sim, { plant: X.injectJam(L.sim.plant, cfg, 1) }); }
    const prevJam = B(L).M_JAMANY;
    L.sim = X.step(L.sim, ui, Math.min(0.25, dt * (s.speed || 1)), cfg);
    const b = B(L), st = lineState(L);
    if (b.M_JAMANY && !prevJam) { L.jams++; L.flags.jamSeen = true; }
    if (L.tJamRef !== s.tJam) { L.tJamRef = s.tJam; L.jamsAt = L.jams; L.countAt = L.sim.plc.C_OUT; }
    if (L.flags.estopSeen && st === 'run' && !L.es.some(Boolean)) L.flags.estopRecovered = true;
    if (L.flags.jamSeen && L.flags.jamAcked && st === 'run') L.flags.jamRecovered = true;
    if (L.flags.stopReq && st === 'stop') {
      const onC23 = L.sim.plant.items.filter(it => X.segOf(cfg, it.x - X.ITEM / 2) >= 1).length;
      L.flags.stopReq = false; L.flags.lastStopClean = onC23 === 0; if (onC23 === 0) L.flags.cleanStop = true;
      VS.toast(onC23 ? 'Hat durdu ama C2/C3 üzerinde ' + onC23 + ' koli kaldı: boşaltma süresi kısa.' : 'Hat sırayla durdu; C2 ve C3 boşaldı.', onC23 ? 'bad' : 'ok');
    }
    if (st !== 'stop' && st !== 'trans' && st !== 'run') L.flags.stopReq = false;
    return st !== before.st || L.sim.alarms.length !== before.alarms || L.sim.plc.C_OUT !== before.n || (L.sim.hist.length && L.sim.histT === 0);
  }

  /* ---------------------------------------------------------------- 3D sahne */
  const X0 = -7.1, BH = 0.8;
  const wx = x => X0 + x;
  function rebuildOn() { return 'konv1'; }
  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer, cfg = cfgOf(s);
    const sc = { drums: [], beams: [], motors: [], lamps: {}, es: [] }; app.scene3 = sc;
    k.ground(60, M.concrete, 0);
    const deco = k.staticGroup(null, 0, 0, 0);
    k.box(18, 0.02, 0.12, M.plasticYellow, 0, 0.011, 1.3, deco); k.box(18, 0.02, 0.12, M.plasticYellow, 0, 0.011, -1.3, deco);
    cfg.seg.forEach((sg, i) => {
      const len = sg.b - sg.a, cx = wx((sg.a + sg.b) / 2);
      const g = k.group(null, cx, 0, 0);
      k.box(len, 0.12, 0.08, M.galv, 0, BH - 0.04, 0.36, g); k.box(len, 0.12, 0.08, M.galv, 0, BH - 0.04, -0.36, g);
      const belt = k.box(len - 0.1, 0.03, 0.62, M.rubber, 0, BH, 0, g); void belt;
      k.box(len, 0.1, 0.02, M.galv, 0, BH + 0.1, 0.33, g); k.box(len, 0.1, 0.02, M.galv, 0, BH + 0.1, -0.33, g);
      for (let x = -len / 2 + 0.3; x <= len / 2 - 0.2; x += 1.2) [-0.33, 0.33].forEach(z => k.box(0.06, BH - 0.1, 0.06, M.galv, x, (BH - 0.1) / 2, z, g));
      [-len / 2, len / 2].forEach(x => { const d = k.group(g, x, BH - 0.02, 0); const c = k.cyl(0.07, 0.07, 0.64, M.steel, 0, 0, 0, d, 16); c.rotation.x = Math.PI / 2; k.box(0.02, 0.13, 0.02, M.darkSteel, 0, 0, 0.3, d); sc.drums.push({ g: d, i: i }); });
      // motor + redüktör (boşaltma ucunda)
      const mg = k.group(g, len / 2 - 0.15, BH - 0.1, 0.62);
      const mb = k.cyl(0.13, 0.13, 0.36, k.mat(0x1e5aa8, { metalness: 0.4, roughness: 0.45 }), 0, 0, 0.12, mg, 18); mb.rotation.x = Math.PI / 2;
      k.box(0.22, 0.24, 0.16, M.darkSteel, 0, 0, -0.12, mg);
      sc.motors.push({ led: k.sphere(0.03, M.ledOff, 0, 0.17, 0.12, mg) });
      k.pickable(mg, 'M' + (i + 1) + ' motor + redüktör (' + cfg.motors[i].Pn + ' kW)', a => { const L = a.live, pl = L.sim.plant; return ['In ≈ ' + fmt(cfg.motors[i].In, 1, 'A') + ' · şu an ' + fmt(pl.I[i], 1, 'A'), 'Kontaktör K' + (i + 1) + ': ' + ([B(L).Q_K1, B(L).Q_K2, B(L).Q_K3][i] ? 'çekili' : 'açık') + ' · termik ' + (pl.ol[i] ? 'normal' : 'AÇMIŞ'), 'FB Motor' + (i + 1) + ' = engine.motor.plcScan (DOL)']; },
        a => [i === 1 ? { label: a.state.strain2 ? 'Zorlanmayı kaldır' : 'Mekanik zorlanma oluştur', variant: a.state.strain2 ? 'primary' : 'danger', onClick: x => { x.state.strain2 = !x.state.strain2; x.renderControls(true); x.invalidate(); } } : null, { label: 'Termik reset', onClick: olReset }].filter(Boolean));
      // fotosel (bant sonundan 0,15 m geride)
      const px = wx(sg.b - 0.15);
      [-0.45, 0.45].forEach(z => { k.cyl(0.025, 0.025, BH + 0.25, M.steel, px, (BH + 0.25) / 2, z, null, 8); k.box(0.07, 0.07, 0.05, z < 0 ? M.plasticYellow : M.plasticDark, px, BH + 0.2, z * 0.92); });
      const beam = k.box(0.012, 0.012, 0.86, k.mat(0xef4444, { emissive: 0xef4444, emissiveIntensity: 0 }), px, BH + 0.2, 0); beam.castShadow = false;
      sc.beams.push(beam);
      k.pickable(beam, 'PE' + (i + 1) + ' fotosel (reflektörlü)', a => { const pe = X.peState(cfgOf(a.state), a.live.sim.plant.items); return ['Işın: ' + (pe[i] ? 'KESİK (koli var)' : 'açık'), 'Sıkışma: ışın ' + fmt(a.state.tJam, 1) + ' s’den uzun kesik ve bant çalışıyorsa (T' + (5 + i) + ' TON)', i === 2 ? 'Çıkış sayacı (CTU) bu fotoselin yükselen kenarını sayar.' : '']; });
      const body = k.group(null, cx, 0, 0);
      const hit = k.box(len, 0.25, 0.7, k.mat(0x000000, { transparent: true, opacity: 0, depthWrite: false }), 0, BH + 0.1, 0, body); hit.castShadow = false;
      k.pickable(body, NAMES[i] + ' (' + len + ' m)', a => ['Bant hızı ' + fmt(a.state.v, 2, 'm/s') + ' · hız %' + fmt(a.live.sim.plant.spd[i] * 100, 0), 'Üzerinde ' + a.live.sim.plant.items.filter(it => X.segOf(cfg, it.x - X.ITEM / 2) === i).length + ' koli'],
        () => [{ label: 'Koli sıkıştır', variant: 'danger', onClick: x => jam(x, i) }, { label: 'Sıkışmayı gider', variant: 'primary', onClick: clearJam }]);
      k.label(NAMES[i], body, [0, BH + 0.75, 0], 'vs-label--sm');
    });
    // besleme ve çıkış masaları
    k.box(1.0, 0.05, 0.8, M.galv, wx(-0.6), BH - 0.05, 0); k.box(1.0, 0.05, 0.8, M.galv, wx(cfg.end + 0.6), BH - 0.05, 0);
    // koliler
    const cardboard = k.mat(0xc8955a, { roughness: 0.85 });
    sc.items = new T.InstancedMesh(new T.BoxGeometry(X.ITEM - 0.02, 0.3, 0.36), cardboard, 60); sc.items.castShadow = true; sc.items.count = 0; v.root.add(sc.items);
    sc.tmp = new T.Object3D(); sc.stuckMat = k.mat(0xb91c1c);
    // acil durdurma istasyonları
    [1.5, 7, 12.5].forEach((x, i) => {
      const g = k.group(null, wx(x), 0, -0.9);
      k.cyl(0.03, 0.03, 1.0, M.galv, 0, 0.5, 0, g, 8);
      k.rbox(0.16, 0.16, 0.1, 0.02, M.plasticYellow, 0, 1.05, 0, g);
      const btn = k.cyl(0.05, 0.05, 0.05, M.plasticRed, 0, 1.05, 0.07, g, 16); btn.rotation.x = Math.PI / 2;
      sc.es.push(btn);
      k.pickable(g, 'Acil durdurma ' + (i + 1) + ' (mantar, kilitlemeli)', a => ['Durum: ' + (a.live.es[i] ? 'BASILI (kilitli)' : 'serbest'), 'NC kontak; zincir PLC girişi I0.' + (2 + i)], a => [{ label: a.live.es[i] ? 'Mantarı bırak (çevir)' : 'Bas', variant: a.live.es[i] ? 'primary' : 'danger', onClick: x => estop(x, i, !x.live.es[i]) }]);
    });
    // pano + HMI + kule lambası
    const cab = k.group(null, wx(-2.4), 0, -1.6);
    k.rbox(1.2, 2.0, 0.5, 0.03, M.panelRAL7035, 0, 1.0, 0, cab);
    const scr = k.screen(0.7, 0.42, 512, (gx, w, h) => drawHmi(gx, w, h, app), cab, { emissive: 0.9 });
    scr.position.set(0, 1.35, 0.26); sc.hmi = scr;
    [['Q_GREEN', 0x22c55e, 0], ['AMBER', 0xf59e0b, 1], ['Q_RED', 0xef4444, 2]].forEach(l => { const m = k.cyl(0.07, 0.07, 0.13, k.mat(l[1], { emissive: l[1], emissiveIntensity: 0 }), 0.45, 2.1 + l[2] * 0.14, 0, cab, 16); sc.lamps[l[0]] = m; });
    k.cyl(0.02, 0.02, 0.1, M.steel, 0.45, 2.03, 0, cab, 8);
    k.pickable(cab, 'PLC panosu ve SCADA operatör paneli', a => { const L = a.live; return ['Durum: ' + LS[lineState(L)][0], 'Sayaç ' + L.sim.plc.C_OUT + ' · alarm ' + L.sim.alarms.length, X.PROGRAM.length + ' basamaklı LD programı · tarama 10 ms (temsili)']; },
      () => [{ label: 'START', variant: 'primary', onClick: x => press(x, 'start') }, { label: 'STOP', variant: 'warn', onClick: x => press(x, 'stop') }, { label: 'RESET', onClick: x => press(x, 'reset') }, { label: 'Alarm onayı', onClick: x => press(x, 'ack') }]);
    k.label('PLC + HMI', cab, [0, 2.75, 0], 'vs-label--sm');
    app.def.scene.bounds = [-9.8, 8.6];
    v.setView({ target: [1, 0.7, 0], r: 17, theta: 0.38, phi: 1.06, limits: { rMin: 2, rMax: 30 } });
    v.setShadowBox(10, 40);
    sc.sig = '';
    apply3d(k, app, 0);
  }
  function drawHmi(gx, w, h, app) {
    const L = app.live; gx.fillStyle = '#0b1220'; gx.fillRect(0, 0, w, h); if (!L) return;
    const b = B(L), st = LS[lineState(L)];
    gx.font = 'bold 26px Arial'; gx.fillStyle = st[1] === 'bad' ? '#f87171' : st[1] === 'ok' ? '#4ade80' : '#fbbf24'; gx.fillText(st[0], 16, 36);
    [b.Q_K1, b.Q_K2, b.Q_K3].forEach((on, i) => { gx.fillStyle = on ? '#22c55e' : '#334155'; gx.fillRect(16 + i * 160, 60, 140, 34); gx.fillStyle = '#0b1220'; gx.font = 'bold 20px Arial'; gx.fillText('C' + (i + 1) + ' ' + fmt(L.sim.plant.I[i], 1) + ' A', 26 + i * 160, 84); });
    gx.fillStyle = '#e2e8f0'; gx.font = '22px Arial'; gx.fillText('Sayaç ' + L.sim.plc.C_OUT + '   Alarm ' + L.sim.alarms.length, 16, 132);
    const al = L.sim.alarms.slice(-3); gx.font = '18px Arial';
    al.forEach((a, i) => { gx.fillStyle = a.acked ? '#fbbf24' : '#f87171'; gx.fillText((a.acked ? '✓ ' : '! ') + a.text, 16, 168 + i * 24); });
  }
  function apply3d(k, app, dt) {
    const sc = app.scene3, L = app.live; if (!sc || !L) return false;
    const pl = L.sim.plant, b = B(L), cfg = cfgOf(app.state), M = k.mats;
    let moving = false;
    // koliler
    const n = Math.min(60, pl.items.length);
    for (let i = 0; i < n; i++) { const it = pl.items[i]; sc.tmp.position.set(wx(it.x - X.ITEM / 2), BH + 0.17, 0); sc.tmp.updateMatrix(); sc.items.setMatrixAt(i, sc.tmp.matrix); }
    const sigI = n + '|' + (n ? pl.items[0].x.toFixed(3) + pl.items[n - 1].x.toFixed(3) : '');
    if (sigI !== sc.sigI) { sc.sigI = sigI; sc.items.count = n; sc.items.instanceMatrix.needsUpdate = true; moving = true; }
    // tamburlar
    if (dt > 0 && !k.reducedMotion) sc.drums.forEach(d => { const sp = pl.spd[d.i]; if (sp > 0.01) { d.g.rotation.z -= dt * cfg.v * sp / 0.07; moving = true; } });
    const pe = X.peState(cfg, pl.items), K = [b.Q_K1, b.Q_K2, b.Q_K3];
    const sig = [pe.join(), K.join(), pl.ol.join(), L.es.join(), b.Q_GREEN, b.Q_RED, b.M_RUN, L.sim.alarms.length, L.sim.plc.C_OUT, L.sim.alarms.filter(a => a.acked).length].join('|');
    if (sig !== sc.sig) {
      sc.sig = sig; moving = true;
      sc.beams.forEach((bm, i) => { bm.material.emissiveIntensity = pe[i] ? 2 : 0.25; });
      sc.motors.forEach((m, i) => { m.led.material = !pl.ol[i] ? M.ledRed : K[i] ? M.ledGreen : M.ledOff; });
      sc.es.forEach((btn, i) => { btn.position.z = L.es[i] ? 0.04 : 0.07; });
      sc.lamps.Q_GREEN.material.emissiveIntensity = b.Q_GREEN ? 2.4 : 0; sc.lamps.Q_RED.material.emissiveIntensity = b.Q_RED ? 2.4 : 0;
      sc.lamps.AMBER.material.emissiveIntensity = !b.Q_GREEN && !b.Q_RED && (K[0] || K[1] || K[2]) ? 2.4 : 0;
      sc.hmi.redraw(sig);
    }
    return moving;
  }
  function update(k, res, s, live, app) { if (app.scene3) app.scene3.sig = ''; apply3d(k, app, 0); }
  function animate(k, dt, res, s, L, app) { return apply3d(k, app, app.running && !app.paused ? dt : 0); }

  /* ---------------------------------------------------------------- 2D: SCADA mimik ve merdiven */
  function view2dHeight(W, res, s) {
    const top = W < 640 ? 118 : 56;
    if (s.hmi !== 'ladder') return top + 520;
    return top + 40 + X.PROGRAM.reduce((a, r) => a + rungH(r), 0) + 30;
  }
  const rungH = r => 30 + 28 * Math.max.apply(null, r.g.map(g => g.length));
  function view2d(g, W, H, res, s, L) {
    const top = W < 640 ? 118 : 56, x0 = 12, x1 = W < 640 ? W - 12 : W - 70;
    g.textBaseline = 'middle';
    const T = (t, x, y, c, px, b, al, max) => { g.font = (b ? 'bold ' : '') + (px || 12) + 'px Inter, sans-serif'; g.fillStyle = c || '#e6eef8'; g.textAlign = al || 'left'; g.fillText(max ? VS.fitText(g, t, max) : t, x, y); };
    if (s.hmi === 'ladder') return ladder(g, x0, x1, top, L, s, T);
    const b = B(L), pl = L.sim.plant, cfg = cfgOf(s), st = LS[lineState(L)], pe = X.peState(cfg, pl.items), K = [b.Q_K1, b.Q_K2, b.Q_K3];
    T('SCADA · Konveyör hattı', x0, top, '#e6eef8', 14, true);
    T(st[0], x1, top, st[1] === 'bad' ? '#f87171' : st[1] === 'ok' ? '#4ade80' : '#fbbf24', 13, true, 'right');
    // mimik
    const scale = (x1 - x0 - 40) / (cfg.end + 1.2), mx = x => x0 + 20 + (x + 0.6) * scale, y = top + 70;
    cfg.seg.forEach((sg, i) => {
      g.fillStyle = K[i] ? '#14532d' : '#1e293b'; g.fillRect(mx(sg.a), y - 12, (sg.b - sg.a) * scale, 24);
      g.strokeStyle = !pl.ol[i] ? '#ef4444' : K[i] ? '#22c55e' : '#64748b'; g.lineWidth = 2; g.strokeRect(mx(sg.a), y - 12, (sg.b - sg.a) * scale, 24);
      const cx = mx(sg.b) - 10; g.fillStyle = !pl.ol[i] ? '#ef4444' : K[i] ? '#22c55e' : '#475569'; g.beginPath(); g.arc(cx, y + 30, 10, 0, Math.PI * 2); g.fill();
      T('M' + (i + 1), cx - 14, y + 30, '#e6eef8', 11, true, 'right');
      T(fmt(pl.I[i], 1, 'A'), mx(sg.a) + 4, y + 30, '#cbd5e1', 11, false, 'left', (sg.b - sg.a) * scale - 50);
      const px = mx(sg.b - 0.15); g.strokeStyle = pe[i] ? '#ef4444' : '#334155'; g.lineWidth = 3; g.beginPath(); g.moveTo(px, y - 22); g.lineTo(px, y + 14); g.stroke();
      T('PE' + (i + 1), px, y - 30, pe[i] ? '#f87171' : '#8ea3bf', 11, false, 'center');
      T(NAMES[i], mx((sg.a + sg.b) / 2), y + 56, '#8ea3bf', 11, false, 'center', (sg.b - sg.a) * scale);
    });
    pl.items.forEach(it => { g.fillStyle = it.stuck ? '#dc2626' : '#c8955a'; g.fillRect(mx(it.x - X.ITEM), y - 8, Math.max(3, X.ITEM * scale - 1), 16); });
    // kule lambası ve sayaç
    const ly = y + 92;
    [['Yeşil', b.Q_GREEN, '#22c55e'], ['Sarı', !b.Q_GREEN && !b.Q_RED && (K[0] || K[1] || K[2]), '#f59e0b'], ['Kırmızı', b.Q_RED, '#ef4444']].forEach((l, i) => { g.fillStyle = l[1] ? l[2] : '#1f2937'; g.beginPath(); g.arc(x0 + 14 + i * 28, ly, 9, 0, Math.PI * 2); g.fill(); });
    T('Sayaç ' + L.sim.plc.C_OUT + ' koli · ' + fmt(rate(L), 1) + ' adet/dk · acil zinciri ' + (b.M_CHAIN ? 'sağlam' : 'AÇIK'), x0 + 100, ly, '#e6eef8', 12, false, 'left', x1 - x0 - 100);
    // alarm listesi
    const ay = ly + 34;
    T('Alarm listesi (IEC 62682)', x0, ay, '#e6eef8', 13, true);
    g.fillStyle = '#10223d'; g.fillRect(x0, ay + 12, x1 - x0, 130);
    const al = L.sim.alarms.slice(-5);
    if (!al.length) T('Etkin alarm yok', x0 + 10, ay + 32, '#8ea3bf', 12);
    al.forEach((a, i) => {
      const yy = ay + 30 + i * 24, c = a.active && !a.acked ? '#f87171' : a.active ? '#fbbf24' : '#93c5fd';
      T(fmt(a.t, 1) + ' s', x0 + 10, yy, '#8ea3bf', 11);
      T(a.text, x0 + 70, yy, c, 12, true, 'left', x1 - x0 - 250);
      T(a.active ? (a.acked ? 'etkin · onaylı' : 'etkin · ONAYSIZ') : 'normale döndü · onaysız', x1 - 10, yy, c, 11, false, 'right');
    });
    // trend (son 60 s)
    const ty = ay + 160, th = 120, hist = L.sim.hist.slice(-240);
    T('Trend: motor akımları (son 60 s)', x0, ty, '#e6eef8', 13, true);
    g.fillStyle = '#10223d'; g.fillRect(x0, ty + 12, x1 - x0, th);
    if (hist.length > 1) {
      const t0 = hist[0].t, t1 = hist[hist.length - 1].t, imax = Math.max(10, ...hist.map(p => Math.max.apply(null, p.I)));
      ['#f59e0b', '#22b8cf', '#8b5cf6'].forEach((c, i) => {
        g.strokeStyle = c; g.lineWidth = 2; g.beginPath();
        hist.forEach((p, j) => { const xx = x0 + (p.t - t0) / Math.max(1, t1 - t0) * (x1 - x0), yy = ty + 12 + th - p.I[i] / imax * (th - 10); if (j) g.lineTo(xx, yy); else g.moveTo(xx, yy); });
        g.stroke(); T('M' + (i + 1), x0 + 8 + i * 40, ty + 26, c, 11, true);
      });
      T(fmt(imax, 0, 'A'), x1 - 6, ty + 22, '#8ea3bf', 11, false, 'right');
    }
  }
  function ladder(g, x0, x1, top, L, s, T) {
    const plc = L.sim.plc, b = plc.b, on = '#22e07a', off = '#55657d';
    T('Merdiven programı (salt okunur, canlı) · yeşil: iletken / enerjili', x0, top, '#e6eef8', 13, true, 'left', x1 - x0);
    let y = top + 30;
    const coilW = Math.min(150, (x1 - x0) * 0.3), xc = x1 - coilW;
    g.strokeStyle = on; g.lineWidth = 3; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0, y + X.PROGRAM.reduce((a, r) => a + rungH(r), 0) - 20); g.stroke();
    X.PROGRAM.forEach(r => {
      const f = plc.flow[r.id] || { g: r.g.map(gr => gr.map(() => false)), power: false, out: false };
      T(r.id + ' · ' + r.note, x0 + 8, y + 2, '#8ea3bf', 11, false, 'left', x1 - x0 - 16);
      const yl = y + 22, units = r.g.reduce((a, gr) => a + Math.max.apply(null, gr.map(p => p.length)), 0), uw = (xc - x0 - 16) / Math.max(1, units);
      let x = x0, pw = true;
      r.g.forEach((gr, gi) => {
        const n = Math.max.apply(null, gr.map(p => p.length)), gx1 = x + n * uw;
        let outPw = false;
        gr.forEach((path, pi) => {
          const yy = yl + pi * 28; let p = pw, xx = x;
          if (pi) { seg(g, x, yl, x, yy, pw, on, off); }
          path.forEach((el, ei) => {
            const closed = el.t === 'NO' ? !!b[el.b] : !b[el.b], cx = x + (ei + 0.5) * (n / path.length) * uw;
            seg(g, xx, yy, cx - 8, yy, p, on, off);
            g.strokeStyle = closed ? on : off; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 5, yy - 9); g.lineTo(cx - 5, yy + 9); g.moveTo(cx + 5, yy - 9); g.lineTo(cx + 5, yy + 9); if (el.t === 'NC') { g.moveTo(cx - 8, yy + 8); g.lineTo(cx + 8, yy - 8); } g.stroke();
            T(el.l, cx, yy - 15, closed ? '#a7f3d0' : '#8ea3bf', 11, false, 'center', Math.max(30, (n / path.length) * uw - 4));
            p = p && closed; xx = cx + 8;
          });
          seg(g, xx, yy, gx1, yy, p, on, off);
          if (pi) seg(g, gx1, yy, gx1, yl, p, on, off);
          outPw = outPw || p;
        });
        pw = pw && outPw; x = gx1; void gi;
      });
      seg(g, x, yl, xc + 4, yl, pw, on, off);
      const o = r.out, act = f.out;
      g.strokeStyle = act ? on : off; g.lineWidth = 2;
      if (o.k === 'ton' || o.k === 'tof' || o.k === 'fb' || o.k === 'ctu') { g.strokeRect(xc + 6, yl - 11, coilW - 12, 22); T(o.l + (o.k === 'ctu' ? ' = ' + plc.C_OUT : o.pt ? ' ' + fmt((plc.acc[o.b] || 0), 1) + ' s' : ''), xc + coilW / 2, yl, act ? on : '#cbd5e1', 11, true, 'center', coilW - 16); }
      else { g.beginPath(); g.arc(xc + 18, yl, 10, 0, Math.PI * 2); g.stroke(); T({ set: 'S', reset: 'R', resetJam: 'R' }[o.k] || '', xc + 18, yl, act ? on : '#8ea3bf', 11, true, 'center'); T(o.l, xc + 34, yl, act ? on : '#cbd5e1', 11, false, 'left', coilW - 36); }
      y += rungH(r);
    });
  }
  function seg(g, xa, ya, xb, yb, p, on, off) { g.strokeStyle = p ? on : off; g.lineWidth = p ? 3 : 1.5; g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke(); }

  /* ---------------------------------------------------------------- kayıt */
  const S = o => Object.assign(defaults(), o);
  VS.register({
    id: 'konveyor', title: '3D Konveyör Hattı ve SCADA Simülasyonu',
    defaults: defaults, initLive: initLive, autoRun: true,
    startText: 'START: hat sırayla kalkıyor (C3 → C2 → C1).',
    start: app => { if (app._startedOnce) app.live = initLive(app.state); app.live.pulse.start = true; app._startedOnce = true; app.invalidate(); },
    scenarios: [
      { id: 'normal', name: 'Normal üretim · sıralı kalkış', desc: 'START verilir: C3, 2 s sonra C2, 2 s sonra C1 kalkar; dakikada 20 koli.', state: defaults(), start: true },
      { id: 'jam', name: 'C2’de sıkışma (20. saniye)', desc: 'Koli C2 sonunda takılır: PE2 3 s kapalı kalınca C2 ve C1 durur, C3 boşaltır; alarmı onaylayın, sıkışmayı giderip Reset + Start.', state: S({ jamAt: 20 }), start: true },
      { id: 'yuk', name: 'M2 mekanik zorlanma · termik', desc: 'Rulman/bant gerginliği M2 akımını 1,2·In üstüne çıkarır; termik açar, kilitleme C1’i durdurur.', state: S({ strain2: true }), start: true },
      { id: 'hizli', name: 'Yüksek hız ve yoğun besleme', desc: '0,9 m/s ve 45 koli/dk: kapasiteye yakın çalışma, trendde akım artışı.', state: S({ v: 0.9, feed: 45 }), start: true },
      { id: 'kisa', name: 'Kısa boşaltma süresi', desc: 'C2/C3 boşaltma 3 s: STOP sonrası bantlarda ürün kalır (sonraki kalkışta yük ve sıkışma riski).', state: S({ runout2: 3, runout3: 3 }), start: true },
      { id: 'yalanci', name: 'Yanlış sıkışma ayarı (0,5 s)', desc: 'Sıkışma süresi bir kolinin fotoseli kapatma süresinden kısa: normal akışta yalancı sıkışma alarmı.', state: S({ tJam: 0.5 }), start: true }
    ],
    tasks: [
      { id: 'start', title: 'Hattı sırayla başlat', goal: 'START ile hattı kaldırın: üç bant da çalışsın ve en az 10 koli çıkış fotoselinden geçsin.', hint: 'Operatör panelinde START (ya da 3D’de PLC panosuna tıklayın). C3 → C2 → C1 sırasını merdiven görünümünde T1/T2 zamanlayıcılarında izleyin.',
        state: defaults(), check: (r, s, L) => L.sim.plc.b.Q_K1 && L.sim.plc.b.Q_K2 && L.sim.plc.b.Q_K3 && L.sim.plc.C_OUT >= 10 },
      { id: 'estop', title: 'Acil durdurmadan güvenle dön', goal: 'Çalışan hatta bir acil durdurmaya basın, sonra doğru sırayla hattı yeniden üretime alın.', hint: 'Mantarı bırakın → RESET (kilit çözülür ama hat kalkmaz) → START. Reset’in hattı kendiliğinden başlatmadığına dikkat edin.',
        state: defaults(), start: true, check: (r, s, L) => !!L.flags.estopRecovered },
      { id: 'jam', title: 'Sıkışma alarmını yönet', goal: 'C2’de 20. saniyede koli sıkışacak. Alarmı onaylayın, sıkışmayı giderin ve hattı yeniden üretime alın.', hint: 'Alarm onayı → Sıkışmayı gider (3D’de C2’ye tıklayabilirsiniz) → RESET → START.',
        state: S({ jamAt: 20 }), start: true, check: (r, s, L) => !!L.flags.jamRecovered },
      { id: 'runout', title: 'Durunca bantlar boş kalsın', goal: 'Boşaltma süreleri çok kısa. Süreleri düzeltin ve STOP ile hattı, C2 ve C3 üzerinde koli kalmadan durdurun.', hint: 'Gereken süre ≈ (bant boyu + koli) / hız: Hat parametrelerindeki notta yazar. Üretim sürerken T3/T4 TOF sürelerini ayarlayıp STOP verin.',
        state: S({ runout2: 3, runout3: 3 }), start: true, check: (r, s, L) => s.runout2 >= r.values.need[1] && s.runout3 >= r.values.need[2] && !!L.flags.cleanStop },
      { id: 'jamtime', title: 'Yalancı sıkışma alarmını gider', goal: 'Sıkışma süresi yanlış ayarlı ve normal akışta alarm veriyor. Ayarı düzeltip 20 koli boyunca hiç sıkışma alarmı olmadan üretin.', hint: 'Fotosel bir koliyle koli boyu / hız kadar kapalı kalır (0,8 s). Sıkışma süresini bunun belirgin üstüne alın; RESET ve START ile devam edin.',
        state: S({ tJam: 0.5 }), start: true, check: (r, s, L) => s.tJam > r.values.peBlock + 0.2 && L.sim.plc.C_OUT - L.countAt >= 20 && L.jams === L.jamsAt }
    ],
    controls: controls, compute: compute, readouts: readouts, charts: charts, tick: tick,
    badge: (res, s, L) => { const st = LS[lineState(L)]; return { level: st[1], text: st[0] + ' · ' + L.sim.plc.C_OUT + ' koli' }; },
    reportInputs: (s, app) => [{ group: 'Benzetim', label: 'Son hat durumu', value: LS[lineState(app.live)][0] }, { group: 'Benzetim', label: 'Üretilen koli', value: String(app.live.sim.plc.C_OUT) }, { group: 'Benzetim', label: 'Alarmlar', value: app.live.sim.alarms.map(a => a.text).join(', ') || 'yok' }],
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-9.8, 8.6] },
    view2d: view2d, view2dHeight: view2dHeight
  });
})();
