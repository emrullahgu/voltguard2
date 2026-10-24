/* VoltSim · konveyor ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.konveyor, Node'da require() ile kullanılır; testleri tools/tests/voltsim-konveyor.test.cjs.
 * İçerik: üç bantlı konveyör hattı için merdiven (LD) programı (veri olarak tanımlı; aynı tanım hem çalıştırılır hem
 * canlı çizilir), PLC tarama döngüsü (TON/TOF/SET/RESET/CTU), motor yol verici FB’si olarak engine.motor.plcScan
 * (motor-otomasyon modülünün mühürleme + acil durdurma kilidi + termik izin mantığı), ürün akışı ve fotosel benzetimi,
 * motor akımları ve termik röle, SCADA alarm durumları (IEC 62682: etkin/onaysız, onaylı, normale dönmüş) ve trend kaydı. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.konveyor = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const N = 3;                 // konveyör sayısı (C1 besleme → C3 çıkış)
  const ITEM = 0.4;            // koli boyu (m)
  const GAP = 0.12;            // bantlar arası aktarma boşluğu (m)
  const SCAN = 0.01;           // PLC tarama süresi (s, temsili)

  /* ---------------------------------------------------------------- yapılandırma ve motor verileri */
  function config(o) {
    o = o || {};
    const L = o.L || [4, 6, 4], kW = o.kW || [2.2, 3, 2.2];
    const motors = kW.map(P => { const m = { Pn: P, Un: 400, eff: P <= 2.2 ? 0.84 : 0.86, cos: 0.8, nn: 1430, f: 50, poles: 4 }; return Object.assign(m, E.motor.nominal(m)); });
    let x = 0; const seg = L.map(l => { const s = { a: x, b: x + l }; x += l + GAP; return s; });
    return { L: L, v: o.v || 0.5, seg: seg, end: seg[N - 1].b, motors: motors, feed: o.feed === undefined ? 20 : o.feed, tSeq: o.tSeq === undefined ? 2 : o.tSeq,
      runout: o.runout || [0, 14, 10], tJam: o.tJam === undefined ? 3 : o.tJam, cls: o.cls || '10', feedOn: o.feedOn !== false, accel: o.accel || 2 };
  }
  /** Analitik değerler: kapasite (adet/dk), fotoselin bir ürünle kapalı kalma süresi, gereken boşaltma süreleri. */
  function analysis(cfg) {
    const pitchMin = ITEM + 0.15;                               // en sık ürün aralığı (m)
    const cap = 60 * cfg.v / pitchMin;
    const peBlock = ITEM / cfg.v;
    const need = cfg.L.map(l => (l + ITEM) / cfg.v);             // bandı tamamen boşaltma süresi
    return { cap: cap, peBlock: peBlock, need: need, startTime: 2 * cfg.tSeq, feedOK: cfg.feed <= cap, jamOK: cfg.tJam > peBlock + 0.2,
      runoutOK: [true, cfg.runout[1] >= need[1], cfg.runout[2] >= need[2]], In: cfg.motors.map(m => m.In) };
  }

  /* ---------------------------------------------------------------- merdiven programı (veri) */
  // Eleman: { t: 'NO' | 'NC', b: bit, l: etiket }; yol: eleman dizisi (seri); grup: yollar (paralel); rung: grupların serisi + çıkış.
  const NO = (b, l) => ({ t: 'NO', b: b, l: l }), NC = (b, l) => ({ t: 'NC', b: b, l: l });
  const P1 = el => [[el]];
  const PROGRAM = [
    { id: 'R1', note: 'Acil durdurma zinciri (NC kontaklar seri)', g: [P1(NO('I_ES1', 'I0.2 Acil 1')), P1(NO('I_ES2', 'I0.3 Acil 2')), P1(NO('I_ES3', 'I0.4 Acil 3'))], out: { k: 'coil', b: 'M_CHAIN', l: 'M0 Zincir sağlam' } },
    { id: 'R2', note: 'Acil kilidi (set)', g: [P1(NC('M_CHAIN', 'M0'))], out: { k: 'set', b: 'M_ESL', l: 'M1 Acil kilidi' } },
    { id: 'R3', note: 'Kilit çözme: reset + zincir sağlam', g: [P1(NO('I_RESET', 'I0.5 Reset')), P1(NO('M_CHAIN', 'M0'))], out: { k: 'reset', b: 'M_ESL', l: 'M1' } },
    { id: 'R4', note: 'Sıkışma toplamı', g: [[[NO('M_JAM1', 'M11')], [NO('M_JAM2', 'M12')], [NO('M_JAM3', 'M13')]]], out: { k: 'coil', b: 'M_JAMANY', l: 'M10 Sıkışma var' } },
    { id: 'R5', note: 'Termik toplamı (95-96 NC)', g: [[[NC('I_OL1', 'I1.0')], [NC('I_OL2', 'I1.1')], [NC('I_OL3', 'I1.2')]]], out: { k: 'coil', b: 'M_OLANY', l: 'M20 Termik açtı' } },
    { id: 'R6', note: 'Hat çalışma (start/stop mühürleme)', g: [[[NO('I_START', 'I0.0 Start')], [NO('M_RUN', 'M2 mühür')]], P1(NO('I_STOP', 'I0.1 Stop (NC)')), P1(NC('M_ESL', 'M1')), P1(NC('M_JAMANY', 'M10')), P1(NC('M_OLANY', 'M20'))], out: { k: 'coil', b: 'M_RUN', l: 'M2 Hat çalışsın' } },
    { id: 'R7', note: 'C2 yol verme gecikmesi (C3 çalışınca)', g: [P1(NO('Q_K3', 'Q0.2 K3'))], out: { k: 'ton', b: 'T_S2', l: 'T1 TON', pt: 'tSeq' } },
    { id: 'R8', note: 'C1 yol verme gecikmesi (C2 çalışınca)', g: [P1(NO('Q_K2', 'Q0.1 K2'))], out: { k: 'ton', b: 'T_S1', l: 'T2 TON', pt: 'tSeq' } },
    { id: 'R9', note: 'C3 boşaltma (C2 durduktan sonra)', g: [P1(NO('Q_K2', 'Q0.1 K2'))], out: { k: 'tof', b: 'T_R3', l: 'T3 TOF', pt: 'runout3', rst: 'M_ESL' } },
    { id: 'R10', note: 'C2 boşaltma (C1 durduktan sonra)', g: [P1(NO('Q_K1', 'Q0.0 K1'))], out: { k: 'tof', b: 'T_R2', l: 'T4 TOF', pt: 'runout2', rst: 'M_ESL' } },
    { id: 'R11', note: 'M3 çıkış bandı (önce kalkar, en son durur)', g: [[[NO('M_RUN', 'M2')], [NO('T_R3', 'T3.Q')]], P1(NC('M_JAM3', 'M13'))], out: { k: 'fb', b: 'Q_K3', l: 'FB Motor3 → K3', m: 2 } },
    { id: 'R12', note: 'M2 ara bant (C3 çalışmıyorsa durur)', g: [[[NO('M_RUN', 'M2'), NO('T_S2', 'T1.Q')], [NO('T_R2', 'T4.Q')]], P1(NO('Q_K3', 'K3 kilit')), P1(NC('M_JAM2', 'M12'))], out: { k: 'fb', b: 'Q_K2', l: 'FB Motor2 → K2', m: 1 } },
    { id: 'R13', note: 'M1 besleme bandı (C2 çalışmıyorsa durur)', g: [P1(NO('M_RUN', 'M2')), P1(NO('T_S1', 'T2.Q')), P1(NO('Q_K2', 'K2 kilit')), P1(NC('M_JAM1', 'M11'))], out: { k: 'fb', b: 'Q_K1', l: 'FB Motor1 → K1', m: 0 } },
    { id: 'R14', note: 'Fotosel 1 sıkışma zamanlayıcısı', g: [P1(NO('I_PE1', 'I0.6 PE1')), P1(NO('Q_K1', 'K1'))], out: { k: 'ton', b: 'T_J1', l: 'T5 TON', pt: 'tJam' } },
    { id: 'R15', note: 'Fotosel 2 sıkışma zamanlayıcısı', g: [P1(NO('I_PE2', 'I0.7 PE2')), P1(NO('Q_K2', 'K2'))], out: { k: 'ton', b: 'T_J2', l: 'T6 TON', pt: 'tJam' } },
    { id: 'R16', note: 'Fotosel 3 sıkışma zamanlayıcısı', g: [P1(NO('I_PE3', 'I1.3 PE3')), P1(NO('Q_K3', 'K3'))], out: { k: 'ton', b: 'T_J3', l: 'T7 TON', pt: 'tJam' } },
    { id: 'R17', note: 'Sıkışma 1 kilidi', g: [P1(NO('T_J1', 'T5.Q'))], out: { k: 'set', b: 'M_JAM1', l: 'M11' } },
    { id: 'R18', note: 'Sıkışma 2 kilidi', g: [P1(NO('T_J2', 'T6.Q'))], out: { k: 'set', b: 'M_JAM2', l: 'M12' } },
    { id: 'R19', note: 'Sıkışma 3 kilidi', g: [P1(NO('T_J3', 'T7.Q'))], out: { k: 'set', b: 'M_JAM3', l: 'M13' } },
    { id: 'R20', note: 'Sıkışma kilitlerini sıfırla (sıkışma giderilmezse yeniden oluşur)', g: [P1(NO('I_RESET', 'I0.5 Reset')), P1(NC('M_RUN', 'M2'))], out: { k: 'resetJam', b: 'M_JAM', l: 'M11–M13 R' } },
    { id: 'R21', note: 'Çıkış sayacı (PE3 yükselen kenar)', g: [P1(NO('I_PE3', 'I1.3 PE3'))], out: { k: 'ctu', b: 'C_OUT', l: 'C1 CTU' } },
    { id: 'R22', note: 'Kule lambası: yeşil (hat tam çalışıyor)', g: [P1(NO('Q_K1', 'K1')), P1(NO('Q_K2', 'K2')), P1(NO('Q_K3', 'K3'))], out: { k: 'coil', b: 'Q_GREEN', l: 'Q0.4 Yeşil' } },
    { id: 'R23', note: 'Kule lambası: kırmızı (arıza)', g: [[[NO('M_ESL', 'M1')], [NO('M_JAMANY', 'M10')], [NO('M_OLANY', 'M20')]]], out: { k: 'coil', b: 'Q_RED', l: 'Q0.5 Kırmızı' } }
  ];

  /* ---------------------------------------------------------------- PLC tarama */
  function initPLC() {
    const b = {}; ['M_CHAIN', 'M_ESL', 'M_RUN', 'M_JAMANY', 'M_OLANY', 'M_JAM1', 'M_JAM2', 'M_JAM3', 'Q_K1', 'Q_K2', 'Q_K3', 'Q_GREEN', 'Q_RED', 'T_S1', 'T_S2', 'T_R2', 'T_R3', 'T_J1', 'T_J2', 'T_J3'].forEach(k => { b[k] = false; });
    return { b: b, acc: {}, edge: {}, C_OUT: 0, fb: [0, 1, 2].map(() => ({ run: false, timer: 0, K1: false, K2: false, K3: false, estopLatched: false, fault: '' })), flow: {} };
  }
  /** Bir tarama: girişler (I_*) → program → çıkışlar. Dönen yeni durum; flow[rungId] = { groups: [[yol iletiyor mu]], power } (canlı çizim için). */
  function scan(plc0, inp, dt, cfg) {
    const plc = { b: Object.assign({}, plc0.b, inp), acc: Object.assign({}, plc0.acc), edge: Object.assign({}, plc0.edge), C_OUT: plc0.C_OUT, fb: plc0.fb.map(x => Object.assign({}, x)), flow: {} };
    const b = plc.b, pt = { tSeq: cfg.tSeq, runout2: cfg.runout[1], runout3: cfg.runout[2], tJam: cfg.tJam };
    const ev = el => (el.t === 'NO' ? !!b[el.b] : !b[el.b]);
    PROGRAM.forEach(r => {
      const gf = r.g.map(grp => grp.map(path => path.every(ev)));
      const power = gf.every(paths => paths.some(Boolean));
      plc.flow[r.id] = { g: gf, power: power };
      const o = r.out;
      if (o.k === 'coil') b[o.b] = power;
      else if (o.k === 'set') { if (power) b[o.b] = true; }
      else if (o.k === 'reset') { if (power) b[o.b] = false; }
      else if (o.k === 'resetJam') { if (power) { b.M_JAM1 = b.M_JAM2 = b.M_JAM3 = false; } }
      else if (o.k === 'ton') { plc.acc[o.b] = power ? (plc.acc[o.b] || 0) + dt : 0; b[o.b] = power && plc.acc[o.b] >= pt[o.pt] - 1e-9; }
      else if (o.k === 'tof') { if (o.rst && b[o.rst]) { plc.acc[o.b] = pt[o.pt]; b[o.b] = false; } else if (power) { plc.acc[o.b] = 0; b[o.b] = true; } else { plc.acc[o.b] = (plc.acc[o.b] || 0) + dt; b[o.b] = b[o.b] && plc.acc[o.b] < pt[o.pt] - 1e-9; } }
      else if (o.k === 'ctu') { if (power && !plc.edge[o.b]) plc.C_OUT++; plc.edge[o.b] = power; }
      else if (o.k === 'fb') {
        // motor yol verici FB: engine.motor.plcScan (DOL) — istek, acil zinciri/kilidi ve termik izniyle
        const st = E.motor.plcScan(plc.fb[o.m], { start: power, stop: power, estop: !!b.M_CHAIN, ol: !!b['I_OL' + (o.m + 1)], reset: !!b.I_RESET, method: 'DOL' }, dt, 0);
        plc.fb[o.m] = st; b[o.b] = !!st.K1;
      }
      plc.flow[r.id].out = !!b[o.b] || (o.k === 'ctu' && power) || (o.k === 'resetJam' && power);
    });
    return plc;
  }

  /* ---------------------------------------------------------------- tesis benzetimi (ürünler, fotoseller, motorlar) */
  function initPlant(cfg) {
    return { t: 0, items: [], nextId: 1, feedT: 0, spd: [0, 0, 0], I: [0, 0, 0], olAcc: [0, 0, 0], ol: [true, true, true], strain: [0, 0, 0], startT: [-9, -9, -9], prevK: [false, false, false], out: 0 };
  }
  const segOf = (cfg, x) => { for (let i = 0; i < N; i++) if (x >= cfg.seg[i].a - 1e-9 && x <= cfg.seg[i].b + GAP - 1e-9) return i; return x < 0 ? 0 : N - 1; };
  /** Fotosel i: bant sonundan 0,15 m geride; koli gövdesi ışını kesiyorsa kapalı. */
  function peState(cfg, items) { return cfg.seg.map(s => { const p = s.b - 0.15; return items.some(it => it.x - ITEM < p && it.x > p); }); }
  /** dt adımı: K çıkışları → bant hızı (rampa), ürün hareketi (kuyruk ve aktarma kuralı), besleme, akım ve termik. */
  function stepPlant(pl0, K, dt, cfg, inj) {
    const pl = { t: pl0.t + dt, items: pl0.items.map(x => Object.assign({}, x)), nextId: pl0.nextId, feedT: pl0.feedT, spd: pl0.spd.slice(), I: pl0.I.slice(), olAcc: pl0.olAcc.slice(), ol: pl0.ol.slice(), strain: (inj && inj.strain) || pl0.strain.slice(), startT: pl0.startT.slice(), prevK: K.slice(), out: pl0.out };
    for (let i = 0; i < N; i++) {
      if (K[i] && !pl0.prevK[i]) pl.startT[i] = pl.t;
      pl.spd[i] = K[i] ? Math.min(1, pl.spd[i] + dt * cfg.accel) : Math.max(0, pl.spd[i] - dt * cfg.accel * 1.5);
    }
    // ürünler önden arkaya: hız bulunduğu bandın hızı; durmuş banda geçemez; öndekine değemez
    pl.items.sort((a, b) => b.x - a.x);
    let ahead = Infinity;
    pl.items.forEach(it => {
      const i = segOf(cfg, it.x - ITEM / 2), s = cfg.seg[i], x0 = it.x, free = cfg.v * pl.spd[i] * dt;
      let nx = it.stuck ? it.x : it.x + free;
      if (i < N - 1 && nx > s.b && pl.spd[i + 1] < 0.05) nx = Math.max(it.x, Math.min(nx, s.b));     // aktarma: sonraki bant duruyorsa bant sonunda bekler
      nx = Math.min(nx, ahead - ITEM - 0.03);
      it.x = Math.max(it.x, nx);
      it.seg = i;
      it.blocked = pl.spd[i] > 0.5 && (it.x - x0) < 0.5 * free;                          // bant kayıyor: ürün ilerlemiyor
      ahead = it.x;
    });
    // hattın sonundan çıkanlar
    const before = pl.items.length;
    pl.items = pl.items.filter(it => it.x - ITEM < cfg.end + 0.05);
    pl.out += before - pl.items.length;
    // besleme: C1 çalışırken sabit aralıkla koli; giriş doluysa bekler
    if (cfg.feedOn && cfg.feed > 0 && pl.spd[0] > 0.9) {
      pl.feedT += dt;
      const minX = pl.items.reduce((m, it) => Math.min(m, it.x - ITEM), Infinity);
      if (pl.feedT >= 60 / cfg.feed && minX > 0.05) { pl.feedT = 0; pl.items.push({ id: pl.nextId++, x: ITEM, stuck: false }); }
    }
    // motor akımı: boşta 0,4·In; yük bant üzerindeki koli sayısı ve sıkışma/zorlanmayla artar; yol almada ≈ 6·In’den azalır
    for (let i = 0; i < N; i++) {
      const m = cfg.motors[i], on = pl.items.filter(it => segOf(cfg, it.x - ITEM / 2) === i);
      const slip = on.filter(it => it.blocked).length;
      const load = Math.min(1.9, 0.35 + 0.07 * on.length + 0.35 * slip + pl.strain[i]);
      const run = 0.4 * m.In + (m.In - 0.4 * m.In) * load;
      pl.I[i] = K[i] ? (pl.spd[i] < 1 ? Math.max(run, 6 * m.In * (1 - pl.spd[i]) + run * pl.spd[i]) : run) : 0;
      // termik röle: I > 1,2·In iken sınıf eğrisinin üst sınırından ölçeklenen süre (engine TRIP_CLASS)
      const r = pl.I[i] / m.In;
      if (K[i] && pl.spd[i] >= 1 && r > 1.2) { pl.olAcc[i] += dt; const tTrip = Math.min(30, E.motor.TRIP_CLASS[cfg.cls][1] * Math.pow(7.2 / r, 2)); if (pl.olAcc[i] >= tTrip) pl.ol[i] = false; }
      else pl.olAcc[i] = Math.max(0, pl.olAcc[i] - dt * 0.2);
    }
    return pl;
  }
  /** Sıkışma oluştur: bant i’de fotosel önünde hareket etmeyen koli (varsa en öndeki koli takılır). */
  function injectJam(pl0, cfg, i) {
    const pl = Object.assign({}, pl0, { items: pl0.items.map(x => Object.assign({}, x)) });
    const p = cfg.seg[i].b - 0.15 + ITEM / 2;
    const ex = pl.items.find(it => segOf(cfg, it.x - ITEM / 2) === i && Math.abs(it.x - p) < 1.2);
    if (ex) { ex.stuck = true; ex.x = Math.max(ex.x, p); }
    else { pl.items.push({ id: pl.nextId, x: p, stuck: true }); pl.nextId++; }
    return pl;
  }
  /** Sıkışmayı gider: takılı koliler (i verilirse yalnız o banttakiler) hattan alınır. */
  function clearJam(pl0, cfg, i) { return Object.assign({}, pl0, { items: pl0.items.filter(it => !it.stuck || (i !== undefined && segOf(cfg, it.x - ITEM / 2) !== i)) }); }

  /* ---------------------------------------------------------------- SCADA alarmları (IEC 62682 durumları) */
  const ALARMS = [
    { id: 'ES', text: 'Acil durdurma basılı / kilitli', pr: 1, cond: (b) => !b.M_CHAIN || b.M_ESL },
    { id: 'J1', text: 'C1 sıkışma (PE1)', pr: 2, cond: b => b.M_JAM1 }, { id: 'J2', text: 'C2 sıkışma (PE2)', pr: 2, cond: b => b.M_JAM2 }, { id: 'J3', text: 'C3 sıkışma (PE3)', pr: 2, cond: b => b.M_JAM3 },
    { id: 'O1', text: 'M1 termik açtı', pr: 2, cond: b => !b.I_OL1 }, { id: 'O2', text: 'M2 termik açtı', pr: 2, cond: b => !b.I_OL2 }, { id: 'O3', text: 'M3 termik açtı', pr: 2, cond: b => !b.I_OL3 }
  ];
  /** Alarm listesi güncellemesi: koşul gelince “etkin–onaysız”, onaylanınca “etkin–onaylı”, koşul gidince onaylıysa listeden düşer, onaysızsa “normale dönmüş–onaysız” kalır. */
  function updateAlarms(list0, b, t) {
    const list = list0.map(a => Object.assign({}, a));
    ALARMS.forEach(def => {
      const on = !!def.cond(b), cur = list.find(a => a.id === def.id && a.state !== 'gone');
      if (on && !cur) list.push({ id: def.id, text: def.text, pr: def.pr, t: t, active: true, acked: false, state: 'active' });
      else if (cur) { cur.active = on; }
    });
    return list.filter(a => a.active || !a.acked);
  }
  function ackAll(list) { return list.map(a => Object.assign({}, a, { acked: true })).filter(a => a.active); }

  /* ---------------------------------------------------------------- birleşik adım */
  function initSim(cfg) { return { plc: initPLC(), plant: initPlant(cfg), alarms: [], hist: [], histT: 0, ev: [], flags: {} }; }
  /** Benzetimi dt kadar ilerletir (iç adım = PLC tarama süresinin katı). ui: { start, stop, reset, es:[3], strain:[3] } (butonlar anlık). */
  function step(sim0, ui, dt, cfg) {
    let sim = sim0, t = 0;
    const h = 0.05;
    while (t < dt - 1e-9) {
      const d = Math.min(h, dt - t); t += d;
      const pe = peState(cfg, sim.plant.items);
      const inp = { I_START: !!ui.start, I_STOP: !ui.stop, I_RESET: !!ui.reset, I_ES1: !ui.es[0], I_ES2: !ui.es[1], I_ES3: !ui.es[2], I_PE1: pe[0], I_PE2: pe[1], I_PE3: pe[2], I_OL1: sim.plant.ol[0], I_OL2: sim.plant.ol[1], I_OL3: sim.plant.ol[2] };
      const plc = scan(sim.plc, inp, d, cfg);
      const K = [plc.b.Q_K1, plc.b.Q_K2, plc.b.Q_K3];
      const plant = stepPlant(sim.plant, K, d, cfg, { strain: ui.strain });
      const alarms = updateAlarms(sim.alarms, plc.b, plant.t);
      sim = { plc: plc, plant: plant, alarms: alarms, hist: sim.hist, histT: sim.histT + d, ev: sim.ev, flags: sim.flags };
      if (sim.histT >= 0.25) { sim.histT = 0; sim.hist = sim.hist.concat([{ t: plant.t, I: plant.I.slice(), n: plc.C_OUT }]).slice(-480); }
      ui = Object.assign({}, ui, { start: false, reset: false }); // butonlar yalnız ilk taramada basılı (darbe)
    }
    return sim;
  }

  return { N: N, ITEM: ITEM, GAP: GAP, SCAN: SCAN, config: config, analysis: analysis, PROGRAM: PROGRAM, initPLC: initPLC, scan: scan, initPlant: initPlant, segOf: segOf,
    peState: peState, stepPlant: stepPlant, injectJam: injectJam, clearJam: clearJam, ALARMS: ALARMS, updateAlarms: updateAlarms, ackAll: ackAll, initSim: initSim, step: step };
});
