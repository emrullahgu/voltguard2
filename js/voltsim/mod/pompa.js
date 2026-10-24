/* VoltSim · 3D Endüstriyel Pompa ve VFD Simülasyonu
 * Hesap: VoltSimEngine.ext.pompa (pompa H–Q ve verim eğrisi, sistem eğrisi, çalışma noktası, afinite yasaları, kısma ile VFD
 * güç karşılaştırması, yıllık enerji ve basit geri ödeme). Sahne: emme havuzu, pompa–motor grubu, kısma vanası, frekans
 * konvertörü ve yükseltilmiş depo; akış parçacıkları debiyle, çark hızla döner. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const P = E.ext.pompa;

  function defaults() {
    return { H0: 40, Qr: 200, Hr: 30, etaMax: 0.8, Qbep: 190, Hst: 8, Qd: 200, Hd: 30, etaM: 0.94, etaVfd: 0.97,
      mode: 'vfd', flowPct: 70, tariff: 3.2, vfdCost: 180000, profile: [[100, 1500], [80, 2500], [60, 2500], [40, 1000]] };
  }
  function compute(s) { return P.compute(s); }
  const chk = (res, id) => res.checks.find(c => c.id === id);
  const lvOf = c => (!c ? undefined : c.status === 'fail' ? 'bad' : c.status === 'warn' ? 'warn' : c.status === 'ok' ? 'ok' : undefined);
  const parseProfile = t => {
    const rows = String(t).split(/[;\n]+/).map(x => x.trim()).filter(Boolean).map(x => { const m = x.match(/^(\d+(?:[.,]\d+)?)\s*[:=x×]\s*(\d+(?:[.,]\d+)?)$/); if (!m) throw new Error('Biçim: “debi%:saat”, ör. 80:2500'); return [Number(m[1].replace(',', '.')), Number(m[2].replace(',', '.'))]; });
    if (!rows.length) throw new Error('En az bir satır gerekli.');
    if (rows.some(r => r[0] < 10 || r[0] > 120)) throw new Error('Debi %10–%120 arasında olmalı.');
    if (rows.reduce((a, r) => a + r[1], 0) > 8760) throw new Error('Toplam süre 8760 saati aşamaz.');
    return rows;
  };

  function controls(s, app) {
    const r = app.validResult;
    return [
      { title: 'İşletme', items: [
        { type: 'seg', key: 'mode', label: 'Debi kontrolü', options: [['throttle', 'Vana ile kısma'], ['vfd', 'Frekans konvertörü (VFD)']] },
        { type: 'range', key: 'flowPct', label: 'Hedef debi (tasarıma göre)', min: 10, max: 110, step: 1, unit: '%' },
        r ? { type: 'note', html: s.mode === 'vfd' ? 'Hız <b>' + fmt(r.values.cmp.s * 100, 1) + ' %</b> (' + fmt(r.values.cmp.s * 50, 1) + ' Hz) · P = <b>' + fmt(r.values.cmp.Pvfd, 1, 'kW') + '</b> (kısma ile ' + fmt(r.values.cmp.Pthrottle, 1, 'kW') + ')' : 'Vana kaybı <b>' + fmt(r.values.cmp.Hvalve, 1, 'm') + '</b> · P = <b>' + fmt(r.values.cmp.Pthrottle, 1, 'kW') + '</b> (VFD ile ' + fmt(r.values.cmp.Pvfd, 1, 'kW') + ')' } : null
      ] },
      { title: 'Pompa (katalog eğrisi)', items: [
        { type: 'range', key: 'H0', label: 'Kapalı vana basması H0', min: 10, max: 120, step: 1, unit: 'm' },
        { type: 'range', key: 'Qr', label: 'Anma debisi Qr', min: 20, max: 1000, step: 5, unit: 'm³/h' },
        { type: 'range', key: 'Hr', label: 'Anma basması Hr', min: 5, max: 110, step: 0.5, unit: 'm', digits: 1 },
        { type: 'range', key: 'Qbep', label: 'En iyi verim debisi (BEP)', min: 20, max: 1000, step: 5, unit: 'm³/h' },
        { type: 'range', key: 'etaMax', label: 'En iyi pompa verimi', min: 0.4, max: 0.9, step: 0.01, digits: 2 }
      ] },
      { title: 'Sistem', items: [
        { type: 'range', key: 'Hst', label: 'Statik basma yüksekliği (depo kotu)', min: 0, max: 60, step: 0.5, unit: 'm', digits: 1, rebuild: true },
        { type: 'range', key: 'Qd', label: 'Tasarım debisi', min: 20, max: 1000, step: 5, unit: 'm³/h' },
        { type: 'range', key: 'Hd', label: 'Tasarım debisinde sistem basması', min: 1, max: 110, step: 0.5, unit: 'm', digits: 1 },
        { type: 'range', key: 'etaM', label: 'Motor verimi (IE3 tipik ≈ 0,94)', min: 0.8, max: 0.98, step: 0.005, digits: 3 },
        { type: 'range', key: 'etaVfd', label: 'Sürücü verimi', min: 0.9, max: 0.99, step: 0.005, digits: 3 }
      ] },
      { title: 'Yıllık enerji ve maliyet', items: [
        { type: 'text', key: 'profile', label: 'Çalışma profili (debi%:saat; …)', format: v => v.map(x => fmt(x[0], 0) + ':' + fmt(x[1], 0)).join('; '), parse: parseProfile, help: 'Ör. 100:1500; 80:2500; 60:2500; 40:1000 (yılda 7500 saat).' },
        { type: 'number', key: 'tariff', label: 'Elektrik birim fiyatı', min: 0, max: 100, step: 0.1, unit: 'TL/kWh', digits: 2, help: 'Kendi tarifenizi girin (vergiler dahil ortalama).' },
        { type: 'number', key: 'vfdCost', label: 'VFD yatırımı (cihaz + montaj)', min: 0, max: 1e8, step: 1000, unit: 'TL' }
      ] }
    ];
  }

  function readouts(res, s) {
    const v = res.values, c = v.cmp;
    return [
      { label: 'Tam hız çalışma noktası', value: fmt(v.full.Q, 0, 'm³/h') + ' · ' + fmt(v.full.H, 1, 'm'), level: lvOf(chk(res, 'cap')), sub: 'tasarım ' + fmt(s.Qd, 0) + ' m³/h' },
      { label: 'Hedef debi', value: fmt(v.Qt, 0, 'm³/h'), sub: fmt(v.frac * 100, 0) + ' % · sistem basması ' + fmt(c.Hsys, 1, 'm') },
      { label: 'VFD hızı', value: fmt(c.s * 100, 1) + ' % · ' + fmt(c.s * 50, 1, 'Hz'), sub: 'afinite: P ∝ n³ → ' + fmt(Math.pow(c.s, 3) * 100, 0) + ' % (statik basmasız)', level: lvOf(chk(res, 'target')) },
      { label: 'Güç · kısma', value: fmt(c.Pthrottle, 1, 'kW'), sub: 'vana kaybı ' + fmt(c.Hvalve, 1) + ' m · η ' + fmt(c.etaThrottle * 100, 0) + ' %', level: s.mode === 'throttle' ? 'warn' : undefined },
      { label: 'Güç · VFD', value: fmt(c.Pvfd, 1, 'kW'), sub: 'η pompa ' + fmt(c.etaVfd * 100, 0) + ' % · fark ' + fmt(c.Pthrottle - c.Pvfd, 1, 'kW'), level: lvOf(chk(res, 'bep')) },
      { label: 'Yıllık enerji · kısma / VFD', value: fmt(v.year.Ethrottle / 1e3, 1) + ' / ' + fmt(v.year.Evfd / 1e3, 1) + ' MWh', sub: fmt(v.year.hours, 0) + ' sa/yıl' },
      { label: 'Yıllık tasarruf', value: fmt(v.year.saving / 1e3, 1, 'MWh') + ' · ' + fmt(v.savingTL, 0, 'TL'), level: v.year.saving > 0 ? 'ok' : undefined, sub: 'tarife ' + fmt(s.tariff, 2) + ' TL/kWh' },
      { label: 'Basit geri ödeme', value: isFinite(v.payback) ? fmt(v.payback, 1) + ' yıl' : '—', level: lvOf(chk(res, 'pay')), sub: 'yatırım ' + fmt(s.vfdCost, 0) + ' TL' }
    ];
  }
  function charts(res, s) {
    const v = res.values, p = v.p, sy = v.sy, Qmax = Math.max(s.Qd, s.Qr) * 1.35, N = 60, c = v.cmp;
    const rng = f => { const out = []; for (let i = 0; i <= N; i++) { const Q = Qmax * i / N, y = f(Q); if (y !== null && y >= 0) out.push([Q, y]); } return out; };
    const kThr = c.Qt > 0 ? (c.Hp - sy.Hst) / (c.Qt * c.Qt) : sy.kf;
    const ch = [{ id: 'hq', title: 'H–Q: pompa ve sistem eğrileri, çalışma noktaları', height: 200,
      series: [{ name: 'Pompa (tam hız)', color: 'grey', width: 1.6, data: rng(Q => P.headAt(p, Q, 1)) },
        { name: 'Pompa (VFD ' + fmt(c.s * 100, 0) + ' %)', color: 'cyan', data: rng(Q => P.headAt(p, Q, c.s)) },
        { name: 'Sistem', color: 'amber', data: rng(Q => P.hsys(sy, Q)) },
        { name: 'Kısılmış sistem', color: 'red', dash: [4, 3], width: 1.5, data: rng(Q => sy.Hst + kThr * Q * Q) }],
      markers: [{ x: c.Qt, y: s.mode === 'vfd' ? c.Hsys : c.Hp, label: (s.mode === 'vfd' ? 'VFD ' : 'Kısma ') + fmt(c.Qt, 0) + ' m³/h', color: '#fcd34d' }, { x: v.full.Q, y: v.full.H, label: 'tam hız', color: '#94a3b8' }],
      x: { min: 0, max: Qmax, label: 'Q (m³/h)' }, y: { min: 0, max: p.H0 * 1.1, label: 'H (m)' },
      alt: 'Tam hızda ' + fmt(v.full.Q, 0) + ' m³/h; hedef ' + fmt(c.Qt, 0) + ' m³/h için VFD hızı %' + fmt(c.s * 100, 1) + ', vana kaybı ' + fmt(c.Hvalve, 1) + ' m.' }];
    const pp = [], pv = [], pa = [];
    const P100 = P.compare(p, sy, s.Qd, { etaM: s.etaM, etaVfd: s.etaVfd });
    for (let f = 20; f <= 110; f += 2) { const r = P.compare(p, sy, s.Qd * f / 100, { etaM: s.etaM, etaVfd: s.etaVfd }); if (!r.feasible) continue; pp.push([f, r.Pthrottle]); pv.push([f, r.Pvfd]); pa.push([f, P100.Pvfd * Math.pow(f / 100, 3)]); }
    ch.push({ id: 'pq', title: 'Elektrik gücü – debi: kısma, VFD ve ideal afinite (n³)', height: 170,
      series: [{ name: 'Kısma', color: 'red', data: pp }, { name: 'VFD', color: 'cyan', data: pv }, { name: 'Afinite P ∝ n³ (Hst = 0)', color: 'grey', dash: [4, 3], width: 1.3, data: pa }],
      markers: [{ x: v.frac * 100, label: fmt(v.frac * 100, 0) + ' %', color: '#fcd34d' }], x: { min: 20, max: 110, label: 'debi %' }, y: { min: 0, label: 'kW' },
      alt: 'Statik basma yüksekliği ' + fmt(s.Hst, 1) + ' m olduğundan VFD eğrisi ideal n³ eğrisinin üzerindedir.' });
    ch.push({ id: 'yil', title: 'Yıllık enerji · profil adımları (MWh)', height: 150,
      series: [{ name: 'Kısma', type: 'bar', color: 'red', width: 0.36, offset: -0.5, data: v.year.rows.map((r, i) => [i + 1, r.Pthrottle * r.hours / 1e3]) },
        { name: 'VFD', type: 'bar', color: 'cyan', width: 0.36, offset: 0.5, data: v.year.rows.map((r, i) => [i + 1, r.Pvfd * r.hours / 1e3]) }],
      x: { min: 0.4, max: v.year.rows.length + 0.6, ticks: v.year.rows.map((r, i) => i + 1), fmt: t => (v.year.rows[t - 1] ? fmt(v.year.rows[t - 1].frac * 100, 0) + ' %' : ''), label: 'debi' }, y: { min: 0, label: 'MWh' },
      alt: 'Yıllık kısma ' + fmt(v.year.Ethrottle / 1e3, 1) + ' MWh, VFD ' + fmt(v.year.Evfd / 1e3, 1) + ' MWh.' });
    return ch;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  function rebuildOn(s) { return String(Math.round(s.Hst)); }
  let HIT = null;
  const hitMat = k => HIT || (HIT = new k.T.MeshBasicMaterial({ visible: false }));
  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    HIT = null; const sc = {}; app.scene3 = sc;
    k.ground(80, k.mat(0x737b85, { roughness: 0.9 }), 0);
    const tankH = Math.max(1.5, Math.min(14, s.Hst * 0.5 + 1.5));
    // emme havuzu
    const pit = k.group(null, -3.5, 0, 0);
    k.box(2.4, 0.05, 2.4, k.mat(0x1e40af, { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }), 0, 0.02, 0, pit);
    [[0, 1.2], [0, -1.2]].forEach(p => k.box(2.6, 0.3, 0.12, M.concreteDark, 0, 0.15, p[1], pit)); [[1.2], [-1.2]].forEach(p => k.box(0.12, 0.3, 2.4, M.concreteDark, p[0], 0.15, 0, pit));
    k.label('Emme havuzu', pit, [0, 0.6, 0], 'vs-label--sm');
    // pompa grubu
    const pg = k.group(null, 0, 0, 0);
    k.box(2.2, 0.15, 0.8, M.darkSteel, 0, 0.075, 0, pg);
    const mot = k.group(pg, 0.55, 0.5, 0);
    k.cyl(0.26, 0.26, 0.8, M.plasticBlue, 0, 0, 0, mot, 24).rotation.z = Math.PI / 2;
    for (let j = 0; j < 10; j++) { const f = k.box(0.75, 0.014, 0.03, M.plasticBlue, 0, 0.26 * Math.sin(j / 10 * Math.PI * 2), 0.26 * Math.cos(j / 10 * Math.PI * 2), mot); f.rotation.x = -j / 10 * Math.PI * 2; }
    k.box(0.22, 0.14, 0.22, M.plasticDark, 0.05, 0.32, 0, mot);
    const vol = k.group(pg, -0.45, 0.5, 0);
    k.cyl(0.36, 0.36, 0.22, M.plasticRed, 0, 0, 0, vol, 28).rotation.z = Math.PI / 2;
    const imp = k.group(vol, -0.12, 0, 0); sc.imp = imp;
    for (let j = 0; j < 6; j++) { const b = k.box(0.02, 0.28, 0.06, M.brass, 0, 0, 0, imp); b.rotation.x = j / 6 * Math.PI * 2; b.position.set(0, 0.14 * Math.cos(j / 6 * Math.PI * 2), 0.14 * Math.sin(j / 6 * Math.PI * 2)); }
    k.box(1.6, 1.0, 0.9, hitMat(k), 0, 0.5, 0, pg).castShadow = false;
    k.pickable(pg, 'Santrifüj pompa + motor', () => { const r = app.validResult; return r ? ['H0 ' + s.H0 + ' m · anma ' + s.Qr + ' m³/h @ ' + fmt(s.Hr, 1) + ' m · ηmax ' + fmt(s.etaMax * 100, 0) + ' %', 'Çalışma: ' + fmt(r.values.Qt, 0) + ' m³/h · η ' + fmt((s.mode === 'vfd' ? r.values.cmp.etaVfd : r.values.cmp.etaThrottle) * 100, 0) + ' %', 'Afinite: Q ∝ n, H ∝ n², P ∝ n³'] : []; });
    k.label('Pompa + motor', pg, [0, 1.2, 0], 'vs-label--sm');
    // borular ve vana
    const suc = k.tube([[-3.2, 0.1, 0], [-2.2, 0.5, 0], [-0.6, 0.5, 0]], 0.09, M.galv, null);
    const dis = k.tube([[-0.45, 0.86, 0], [-0.45, 1.6, 0], [1.6, 1.6, 0], [3.6, 1.6, 0], [4.2, 1.6, 0], [4.2, tankH + 0.3, 0], [4.6, tankH + 0.6, 0]], 0.08, M.galv, null);
    const vg = k.group(null, 2.2, 1.6, 0);
    k.cyl(0.13, 0.13, 0.3, M.plasticRed, 0, 0, 0, vg, 18).rotation.z = Math.PI / 2;
    k.box(0.04, 0.4, 0.04, M.steel, 0, 0.22, 0, vg);
    const hw = k.group(vg, 0, 0.44, 0); sc.hw = hw;
    const ring = new T.Mesh(new T.TorusGeometry(0.16, 0.015, 8, 24), M.plasticRed); ring.rotation.x = Math.PI / 2; hw.add(ring);
    k.box(0.5, 0.7, 0.4, hitMat(k), 0, 0.2, 0, vg).castShadow = false;
    k.pickable(vg, 'Kısma vanası', () => { const r = app.validResult; return r ? ['Kısma modunda fazla basma burada harcanır: ' + fmt(r.values.cmp.Hvalve, 1) + ' m', s.mode === 'throttle' ? 'Etkin: debiyi vana ayarlıyor.' : 'VFD modunda vana tam açık.'] : []; },
      () => [{ label: 'Vana ile kısma moduna al', variant: s.mode === 'throttle' ? '' : 'primary', onClick: a => { a.state.mode = 'throttle'; } }, { label: 'Debi −10 %', onClick: a => { a.state.flowPct = Math.max(10, a.state.flowPct - 10); } }, { label: 'Debi +10 %', onClick: a => { a.state.flowPct = Math.min(110, a.state.flowPct + 10); } }]);
    sc.vLbl = k.label('Vana', vg, [0, 0.8, 0], 'vs-label--sm');
    // depo
    const tk = k.group(null, 5.2, 0, 0);
    for (let j = 0; j < 4; j++) k.box(0.12, tankH, 0.12, M.galv, (j % 2 ? 0.8 : -0.8), tankH / 2, (j < 2 ? 0.8 : -0.8), tk);
    k.cyl(1.1, 1.1, 1.6, M.wallPanel, 0, tankH + 0.8, 0, tk, 28);
    k.box(2.4, tankH + 1.8, 2.4, hitMat(k), 0, (tankH + 1.8) / 2, 0, tk).castShadow = false;
    k.pickable(tk, () => 'Depo · statik basma ' + fmt(s.Hst, 1) + ' m', () => ['Statik basma yüksekliği hızdan bağımsızdır: pompa en az bu basmayı yenmelidir.', 'Bu hızın altında debi yok: %' + fmt(Math.sqrt(s.Hst / s.H0) * 100, 0)], () => [{ label: 'Depo kotu +2 m', onClick: a => { a.state.Hst = Math.min(60, a.state.Hst + 2); a.state.Hd = Math.max(a.state.Hd, a.state.Hst + 1); } }, { label: 'Depo kotu −2 m', onClick: a => { a.state.Hst = Math.max(0, a.state.Hst - 2); } }]);
    k.label('Depo', tk, [0, tankH + 2, 0], 'vs-label--sm');
    // VFD
    const vf = k.group(null, 0.6, 0, -1.6);
    k.rbox(0.6, 1.8, 0.4, 0.01, M.panelDark, 0, 0.9, 0, vf);
    const scr = k.screen(0.2, 0.12, 192, (g, w, h) => { const r = app.validResult; g.fillStyle = '#0b2a1a'; g.fillRect(0, 0, w, h); g.fillStyle = '#4ade80'; g.font = 'bold 34px monospace'; g.fillText(r ? (s.mode === 'vfd' ? fmt(r.values.cmp.s * 50, 1) : '50,0') + ' Hz' : '—', 10, 46); g.font = '20px monospace'; g.fillText(r ? fmt(s.mode === 'vfd' ? r.values.cmp.Pvfd : r.values.cmp.Pthrottle, 1) + ' kW' : '', 10, 92); }, vf, { emissive: 0.8 });
    scr.position.set(0, 1.35, 0.205); sc.scr = scr;
    k.box(0.7, 1.9, 0.5, hitMat(k), 0, 0.95, 0, vf).castShadow = false;
    k.pickable(vf, 'Frekans konvertörü (VFD)', () => { const r = app.validResult; return r ? ['Hız ' + fmt(r.values.cmp.s * 100, 1) + ' % · ' + fmt(r.values.cmp.s * 50, 1) + ' Hz', 'VFD gücü ' + fmt(r.values.cmp.Pvfd, 1) + ' kW · kısma ' + fmt(r.values.cmp.Pthrottle, 1) + ' kW', 'Sürücü harmonikleri için Enerji Kalitesi simülasyonuna bakın.'] : []; },
      () => [{ label: 'VFD moduna al', variant: s.mode === 'vfd' ? '' : 'primary', onClick: a => { a.state.mode = 'vfd'; } }, { label: 'Hız −5 % (debi)', onClick: a => { a.state.mode = 'vfd'; a.state.flowPct = Math.max(10, a.state.flowPct - 5); } }, { label: 'Hız +5 % (debi)', onClick: a => { a.state.mode = 'vfd'; a.state.flowPct = Math.min(110, a.state.flowPct + 5); } }]);
    k.label('VFD', vf, [0, 2.1, 0], 'vs-label--sm');
    k.tube([[0.6, 1.8, -1.6], [0.6, 2.2, -1.2], [0.55, 1.0, -0.4], [0.55, 0.8, -0.1]], 0.03, M.cableBlack, null);
    sc.f1 = k.flow(suc.userData.curve, 14, 0x60a5fa, 0.05); sc.f2 = k.flow(dis.userData.curve, 30, 0x60a5fa, 0.05);
    app.def.scene.bounds = [-5, 7];
    v.setView({ target: [0.9, Math.min(6, tankH * 0.5 + 0.8), 0], r: 11.5 + tankH * 0.7, theta: 0.3, phi: 1.2, limits: { rMin: 1.5, rMax: 40 } });
    v.setShadowBox(10, 40); v.sun.position.set(4, 12, 7);
  }
  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const c = res.values.cmp, sp = Math.min(1.5, 0.15 + res.values.frac * 0.9);
    sc.f1.speed = sc.f2.speed = c.feasible ? sp : 0;
    sc.vLbl.set(s.mode === 'throttle' ? 'Vana · kayıp ' + fmt(c.Hvalve, 1) + ' m' : 'Vana tam açık'); sc.vLbl.level(s.mode === 'throttle' && c.Hvalve > 1 ? 'warn' : 'ok');
    sc.scr.redraw([s.mode, fmt(c.s, 3), fmt(c.Pvfd, 1), fmt(c.Pthrottle, 1)].join('|'));
    sc.valveTarget = s.mode === 'throttle' ? (1 - c.Hvalve / Math.max(1, c.Hp)) : 1;
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return false;
    let moving = false;
    const tgt = (sc.valveTarget === undefined ? 1 : sc.valveTarget) * 6;
    const cur = sc.hw.rotation.y, e = tgt - cur;
    if (Math.abs(e) > 1e-3) { sc.hw.rotation.y = k.reducedMotion || dt <= 0 ? tgt : cur + e * Math.min(1, dt * 3); moving = true; }
    if (app.running && !app.paused && !k.reducedMotion && dt > 0) { const sp = s.mode === 'vfd' ? res.values.cmp.s : 1; sc.imp.rotation.x += dt * 30 * sp; moving = true; }
    return moving;
  }
  function view2d(g, W, H, res, s) {
    const v = res.values, c = v.cmp, col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', text: '#e6eef8', dim: '#7f94b0', water: '#60a5fa' };
    const fitT = VS.fitText, R = W - 70, y = 140;
    g.lineWidth = 3; g.strokeStyle = col.water; g.beginPath(); g.moveTo(40, y + 40); g.lineTo(130, y); g.lineTo(R - 120, y); g.lineTo(R - 120, 70); g.lineTo(R - 60, 70); g.stroke();
    g.lineWidth = 2; g.strokeStyle = col.line; g.beginPath(); g.arc(150, y, 18, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(150, y - 18); g.lineTo(168, y); g.lineTo(150, y + 18); g.stroke();
    const vx = (150 + R - 120) / 2;
    g.fillStyle = s.mode === 'throttle' ? col.warn : col.ok; g.beginPath(); g.moveTo(vx - 12, y - 10); g.lineTo(vx + 12, y + 10); g.lineTo(vx + 12, y - 10); g.lineTo(vx - 12, y + 10); g.closePath(); g.fill();
    g.strokeStyle = col.line; g.strokeRect(R - 70, 40, 60, 40); g.strokeRect(120, y + 50, 60, 36);
    g.fillStyle = col.text; g.font = '12px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('VFD', 150, y + 72); g.fillText('Depo', R - 40, 34); g.fillText('Vana', vx, y + 30); g.textAlign = 'left';
    g.fillStyle = col.dim;
    const lines = ['Mod: ' + (s.mode === 'vfd' ? 'VFD · hız %' + fmt(c.s * 100, 1) + ' (' + fmt(c.s * 50, 1) + ' Hz)' : 'Vana ile kısma · kayıp ' + fmt(c.Hvalve, 1) + ' m'),
      'Debi ' + fmt(v.Qt, 0) + ' m³/h (%' + fmt(v.frac * 100, 0) + ') · sistem basması ' + fmt(c.Hsys, 1) + ' m · statik ' + fmt(s.Hst, 1) + ' m',
      'Güç: kısma ' + fmt(c.Pthrottle, 1) + ' kW · VFD ' + fmt(c.Pvfd, 1) + ' kW',
      'Yıllık tasarruf ' + fmt(v.year.saving / 1e3, 1) + ' MWh · ' + fmt(v.savingTL, 0) + ' TL · geri ödeme ' + (isFinite(v.payback) ? fmt(v.payback, 1) + ' yıl' : '—')];
    lines.forEach((t, i) => g.fillText(fitT(g, t, R - 40), 24, y + 120 + i * 20));
    g.fillText(fitT(g, 'Değerler VoltSim hesap motorundandır; üretici pompa eğrisi esastır.', R - 40), 24, H - 14);
  }

  const tasks = [
    { id: 'vfd', title: 'Kısmadan VFD’ye', goal: 'Pompa %70 debide vana ile kısılıyor. Aynı debiyi frekans konvertörüyle sağlayın ve gücü en az %30 azaltın.', hint: 'Vanaya ya da VFD panosuna tıklayın: “VFD moduna al”. Güç farkını “Güç · VFD” okumasında görün.',
      state: { mode: 'throttle', flowPct: 70 }, check: (r, s) => s.mode === 'vfd' && s.flowPct === 70 && r.values.cmp.Pvfd <= 0.7 * r.values.cmp.Pthrottle },
    { id: 'kucuk', title: 'Küçük pompa', goal: 'Seçilen pompa tasarım debisini (200 m³/h, 30 m) tam hızda bile karşılamıyor. Pompa katalog değerlerini uygun bir pompaya çevirin.', hint: 'Kapalı vana basmasını (H0) ve anma noktasını büyütün; çalışma noktası sistem eğrisinin tasarım noktasının sağında kalmalı.',
      state: { H0: 32, Qr: 160, Hr: 26, Qbep: 150 }, check: r => chk(r, 'cap').status === 'ok' },
    { id: 'bep', title: 'BEP yakınında çalışma', goal: 'VFD modunda pompa verimi en iyi verimin %95’inin altında. Hedef debiyi ya da BEP konumunu değiştirerek verimi %95’in üstüne çıkarın.', hint: 'Statik basma yüksekse hız düştükçe çalışma noktası BEP’ten sola kayar. Debiyi artırın ya da daha küçük BEP debili pompa seçin.',
      state: { mode: 'vfd', flowPct: 40, Hst: 18, Hd: 30 }, check: r => chk(r, 'bep').status === 'ok' },
    { id: 'odeme', title: 'Geri ödeme 2 yılın altında', goal: 'Gerçek çalışma profilini girin: tesis yılda 6000 saat çalışıyor, bunun 4000 saati %60 debide. Geri ödeme 2 yılın altına insin mi?', hint: 'Profil alanına ör. 100:2000; 60:4000 yazın. Tarifeyi kendi faturanızdan girin.',
      state: { profile: [[100, 1500]] }, check: r => r.values.year.hours >= 6000 && r.values.payback < 2 }
  ];
  const sc = o => Object.assign(defaults(), o);
  VS.register({
    id: 'pompa', title: '3D Endüstriyel Pompa ve VFD Simülasyonu',
    defaults: defaults, initLive: () => ({}), autoRun: true, startText: 'Pompa çalışıyor: çark hızı ve akış debiyle orantılı.',
    scenarios: [
      { id: 'transfer', name: 'Depo besleme · statik 8 m', desc: '200 m³/h, 30 m tasarım; %70 debide VFD ile kısma karşılaştırması.', state: defaults() },
      { id: 'sirkulasyon', name: 'Kapalı devre sirkülasyon · statik 0', desc: 'Statik basma yok: güç afinite yasasına (n³) çok yakın düşer.', state: sc({ Hst: 0, Hd: 28, flowPct: 60 }) },
      { id: 'yuksek', name: 'Yüksek statik basma · 22 m', desc: 'Statik basma büyük: hız %74’ün altına inince debi biter; VFD tasarrufu sınırlı.', state: sc({ Hst: 22, Hd: 30, flowPct: 60 }) },
      { id: 'sogutma', name: 'Soğutma kulesi pompası · 500 m³/h', desc: 'Büyük debili pompa, yaz–kış profili ve yüksek çalışma saati.', state: sc({ H0: 32, Qr: 520, Hr: 24, Qbep: 500, Qd: 500, Hd: 24, Hst: 4, flowPct: 75, vfdCost: 420000, profile: [[100, 2500], [75, 3000], [55, 2500]] }) }
    ],
    tasks: tasks, controls: controls, compute: compute, readouts: readouts, charts: charts, tick: () => false,
    reportInputs: s => [{ group: 'Yıllık enerji ve maliyet', label: 'Profil', value: s.profile.map(r => fmt(r[0], 0) + ' %: ' + fmt(r[1], 0) + ' sa').join(' · ') }],
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-5, 7] },
    view2d: view2d
  });
})();
