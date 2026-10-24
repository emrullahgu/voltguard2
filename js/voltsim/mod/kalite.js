/* VoltSim · 3D Enerji Kalitesi Laboratuvarı
 * Hesap: VoltSimEngine.ext.kalite (kompanzasyon modülüyle aynı harmonik ağ modeli + OG şebeke ve sıfır bileşen; dalga şekli,
 * spektrum, THDv/THDi, h_r = √(Ssc/Qc), ayarlı reaktör frekans tepkisi; gerilim çökmesi/yükselmesi ve EN 50160 sınıflandırması,
 * motor yol alma çökmesi; VUF gerilim dengesizliği). Kompanzasyon panosunun kademe/röle davranışı için /voltsim/kompanzasyon/
 * kullanılır; bu modül bir ölçüm ve analiz laboratuvarıdır. Sahne: trafo, AG pano, kondansatör bankası, sürücü, ofis yükü,
 * motor ve enerji analizörü; büyük ekran seçilen analizi canlı gösterir. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const Q = E.ext.kalite;
  const ORDERS = [3, 5, 7, 11, 13];
  const PVALS = [[0, 'Yok (reaktörsüz)'], [5.67, '%5,67 · 210 Hz'], [7, '%7 · 189 Hz'], [14, '%14 · 134 Hz']];
  const VIEWS = [['wave', 'Dalga şekli'], ['spec', 'Spektrum'], ['z', 'Empedans'], ['event', 'Olay (rms)'], ['phasor', 'Dengesizlik']];

  function defaults() {
    return {
      U_LL: 400, Sr_kVA: 1000, uk: 6, SkQ_MVA: 500,
      P_kW: 400, cos: 0.85, spectrum: 'vfd6c', harm: Object.assign({}, Q.SPECTRA.vfd6c.h),
      capOn: true, Qc_kvar: 300, p: 7,
      study: 'harmonik', view: 'wave',
      event: 'og', mvU_kV: 34.5, mvSk_MVA: 500, line_r: 0.2, line_x: 0.4, faultKm: 5, sagMs: 120, swellPct: 115,
      motorKW: 75, kStart: 6, motorMs: 2000, dropPct: 65, dropMs: 15,
      Uab: 400, Ubc: 396, Uca: 404
    };
  }
  const studyView = { harmonik: 'wave', olay: 'event', denge: 'phasor' };

  /* ---------------------------------------------------------------- hesap */
  /** İnceleme türüne göre ilgili ön kontroller gösterilir (rozet ve rapor seçili incelemeyi yansıtır). */
  const STUDY_CHECKS = { harmonik: ['thdv', 'vh', 'res', 'cap', 'n'], olay: ['ev', 'f47', 'drop'], denge: ['vuf'] };
  function compute(s) {
    const r = Q.compute(s);
    if (r.ok) { const keep = STUDY_CHECKS[s.study] || STUDY_CHECKS.harmonik; r.checks = r.checks.filter(c => keep.indexOf(c.id) >= 0); }
    return r;
  }
  const chk = (res, id) => res.checks.find(c => c.id === id);
  const lvOf = c => (!c ? undefined : c.status === 'fail' ? 'bad' : c.status === 'warn' ? 'warn' : c.status === 'ok' ? 'ok' : undefined);

  /* ---------------------------------------------------------------- kontroller */
  function setSpectrum(a, k) { a.state.spectrum = k; a.state.harm = Object.assign({}, Q.SPECTRA[k].h); }
  function controls(s, app) {
    const r = app.validResult, g = [];
    g.push({ title: 'Çalışma', items: [
      { type: 'seg', key: 'study', label: 'İnceleme', options: [['harmonik', 'Harmonik'], ['olay', 'Çökme / yükselme'], ['denge', 'Dengesizlik']], onChange: (v, a) => { a.state.view = studyView[v]; a.live.phase = 'idle'; a.renderControls(); a.invalidate(); } },
      { type: 'select', key: 'view', label: 'Analizör ekranı (3D)', options: VIEWS }
    ] });
    g.push({ title: 'Şebeke ve trafo', items: [
      { type: 'select', key: 'Sr_kVA', label: 'Trafo anma gücü', options: [400, 630, 800, 1000, 1250, 1600, 2000, 2500].map(v => [v, v + ' kVA']) },
      { type: 'range', key: 'uk', label: 'Trafo uk', min: 4, max: 8, step: 0.5, unit: '%', digits: 1 },
      { type: 'number', key: 'SkQ_MVA', label: 'OG şebeke kısa devre gücü', min: 0, max: 5000, step: 10, unit: 'MVA', help: '0 = sonsuz güçlü şebeke. OG empedansı Xs’e eklenir; rezonans mertebesini düşürür.' },
      r ? { type: 'note', html: 'AG bara Ssc ≈ <b>' + fmt(r.values.net.Ssc / 1e3, 1, 'MVA') + '</b> · Xs ≈ ' + fmt(r.values.net.Xs * 1e3, 2, 'mΩ') + ' (trafo ' + fmt(r.values.net.XT * 1e3, 2) + ' + OG ' + fmt(r.values.net.XQ * 1e3, 2) + ')' } : null
    ] });
    if (s.study === 'harmonik') {
      g.push({ title: 'Doğrusal olmayan yük', items: [
        { type: 'range', key: 'P_kW', label: 'Yük gücü P', min: 0, max: 1500, step: 10, unit: 'kW' },
        { type: 'range', key: 'cos', label: 'Temel bileşen cosφ', min: 0.6, max: 1, step: 0.01, digits: 2 },
        { type: 'select', key: 'spectrum', label: 'Yük tipi (örnek spektrum)', options: Object.keys(Q.SPECTRA).map(k => [k, Q.SPECTRA[k].label]), onChange: (v, a) => { setSpectrum(a, v); a.renderControls(); a.invalidate(); } }
      ].concat(ORDERS.map(h => ({ type: 'number', key: 'harm.' + h, label: h + '. harmonik akım (' + h * 50 + ' Hz)', min: 0, max: 120, step: 0.5, unit: '% I1', digits: 1 })),
      [{ type: 'note', text: 'Spektrum değerleri örnektir; gerçek tesis için IEC 61000-4-30 Sınıf A analizörle ölçüm gerekir. 3. harmonik sıfır bileşendir (tek fazlı yükler).' }]) });
      g.push({ title: 'Kondansatör bankası', items: [
        { type: 'toggle', key: 'capOn', label: 'Kondansatör bankası devrede' },
        { type: 'range', key: 'Qc_kvar', label: 'Etkin güç Qc (bara)', min: 25, max: 1200, step: 25, unit: 'kVAr' },
        { type: 'select', key: 'p', label: 'Ayarlı reaktör oranı p', options: PVALS, rebuild: true, help: 'f_ayar = 50/√p. p = %14 genellikle 3. harmoniği olan şebekelerde tercih edilir.' },
        r && r.values.net.filt ? { type: 'note', html: 'L = <b>' + fmt(r.values.net.filt.L_mH, 3) + ' mH</b>/faz · C = ' + fmt(r.values.net.filt.C_uF, 0) + ' µF (yıldız) · Uc ≈ ' + fmt(r.values.net.filt.Uc, 0) + ' V → kondansatör anma ' + r.values.net.filt.UcN + ' V (kompanzasyon modülünün ayarlı filtre hesabı)' } : null
      ] });
    } else if (s.study === 'olay') {
      g.push({ title: 'Gerilim olayı', items: [
        { type: 'seg', key: 'event', label: 'Olay', options: [['og', 'OG fider arızası'], ['motor', 'Motor yol alma'], ['swell', 'Yükselme'], ['interruption', 'Kesinti']], onChange: (v, a) => { a.live.phase = 'idle'; } },
        s.event === 'og' ? { type: 'range', key: 'faultKm', label: 'Komşu fiderde arıza uzaklığı', min: 0, max: 30, step: 0.5, unit: 'km', digits: 1, help: 'Arıza baraya yaklaştıkça kalan gerilim azalır (gerilim bölücü).' } : null,
        s.event === 'og' ? { type: 'number', key: 'mvSk_MVA', label: 'OG bara kısa devre gücü', min: 10, max: 5000, step: 10, unit: 'MVA' } : null,
        s.event === 'og' ? { type: 'select', key: 'mvU_kV', label: 'OG gerilimi', options: [[34.5, '34,5 kV'], [31.5, '31,5 kV'], [15.8, '15,8 kV'], [10.5, '10,5 kV']] } : null,
        s.event === 'og' ? { type: 'number', key: 'line_x', label: 'Hat reaktansı', min: 0.05, max: 1, step: 0.01, unit: 'Ω/km', digits: 2 } : null,
        s.event === 'og' ? { type: 'number', key: 'line_r', label: 'Hat direnci', min: 0.01, max: 2, step: 0.01, unit: 'Ω/km', digits: 2 } : null,
        s.event !== 'motor' ? { type: 'range', key: 'sagMs', label: s.event === 'swell' ? 'Yükselme süresi' : 'Olay süresi (koruma temizleme)', min: 20, max: 3000, step: 10, unit: 'ms' } : null,
        s.event === 'swell' ? { type: 'range', key: 'swellPct', label: 'Gerilim (yükselme)', min: 100, max: 150, step: 1, unit: '%' } : null,
        s.event === 'motor' ? { type: 'range', key: 'motorKW', label: 'Motor gücü (doğrudan yol verme)', min: 5, max: 800, step: 5, unit: 'kW' } : null,
        s.event === 'motor' ? { type: 'range', key: 'kStart', label: 'Yol alma akımı', min: 2, max: 8, step: 0.5, unit: '×In', digits: 1 } : null,
        s.event === 'motor' ? { type: 'range', key: 'motorMs', label: 'Yol alma süresi', min: 200, max: 15000, step: 100, unit: 'ms' } : null
      ] });
      g.push({ title: 'Ekipman dayanımı (model)', items: [
        { type: 'range', key: 'dropPct', label: 'Kontaktör bırakma eşiği', min: 40, max: 85, step: 1, unit: '%', help: 'Kullanıcı girdisi; bobin ve üreticiye göre değişir.' },
        { type: 'range', key: 'dropMs', label: 'Kontaktör bırakma gecikmesi', min: 0, max: 200, step: 5, unit: 'ms' },
        { type: 'note', text: 'Hassas ekipman için örnek dayanım zarfı SEMI F47 (%50·200 ms, %70·500 ms, %80·1 s) gösterilir.' },
        { type: 'buttons', items: [{ label: 'Olayı oynat', variant: 'primary', onClick: a => { a.running = true; a.paused = false; start(a); a.syncToolbar(); a.wake(); } }] }
      ] });
    } else {
      g.push({ title: 'Faz arası gerilimler (ölçüm)', items: [
        { type: 'range', key: 'Uab', label: 'Uab', min: 360, max: 440, step: 1, unit: 'V' },
        { type: 'range', key: 'Ubc', label: 'Ubc', min: 360, max: 440, step: 1, unit: 'V' },
        { type: 'range', key: 'Uca', label: 'Uca', min: 360, max: 440, step: 1, unit: 'V' },
        { type: 'range', key: 'kStart', label: 'Motor yol alma akımı (Z2 için)', min: 2, max: 8, step: 0.5, unit: '×In', digits: 1 },
        { type: 'buttons', items: [
          { label: 'Dengeli', onClick: a => { a.state.Uab = a.state.Ubc = a.state.Uca = 400; } },
          { label: 'Tek fazlı kaynak makinesi', variant: 'warn', onClick: a => { a.state.Uab = 401; a.state.Ubc = 386; a.state.Uca = 404; } }
        ] }
      ] });
    }
    return g;
  }

  /* ---------------------------------------------------------------- zaman davranışı */
  const evTimeline = v => { const dur = v.ev.t / 1000; return { pre: 0.1, dur: dur, post: 0.4, total: 0.1 + dur + 0.4, slow: Math.max(1, Math.min(12, 1.6 / Math.max(dur, 0.01))) }; };
  function start(app) {
    const L = app.live; L.t = 0; L.phase = app.state.study === 'olay' ? 'event' : 'run'; L.dropped = false;
  }
  function tick(app, dt) {
    const L = app.live, r = app.validResult; if (!r) return false;
    L.ph = (L.ph || 0) + dt;
    if (L.phase !== 'event') return false;
    const tl = evTimeline(r.values);
    L.t += dt / tl.slow;
    if (!L.dropped && r.values.drops && L.t > tl.pre + app.state.dropMs / 1000) { L.dropped = true; VS.toast('Kontaktörler bıraktı: motor durdu (kalan gerilim %' + fmt(r.values.ev.u, 0) + ').', 'bad'); }
    if (L.t >= tl.total) { L.t = tl.total; L.phase = 'done'; app.invalidate(); }
    return true;
  }
  /** Olay sırasında anlık rms gerilim (%): önce 100, olay süresince kalan gerilim, sonra 100 (motor yol almada üstel toparlanma). */
  function uAt(v, t) {
    const tl = evTimeline(v);
    if (t < tl.pre || t > tl.pre + tl.dur + (v.ev.src === 'motor' ? 0.3 : 0)) return 100;
    if (v.ev.src === 'motor') { const x = (t - tl.pre) / tl.dur; return 100 - (100 - v.ev.u) * Math.max(0, 1 - Math.pow(Math.min(1, x), 3)); }
    return v.ev.u;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live) {
    const v = res.values, n = v.net, hm = v.hm, out = [];
    if (s.study === 'harmonik') {
      out.push(
        { label: 'THDv · AG bara', value: '%' + fmt(hm.THDv, 2), level: lvOf(chk(res, 'thdv')), sub: 'EN 50160 sınırı %8 (istatistiksel)' },
        { label: 'THDi · yük', value: '%' + fmt(hm.THDiLoad, 1), sub: 'I1 = ' + fmt(v.I1, 0, 'A') + ' · Irms ' + fmt(hm.Irms, 0, 'A') },
        { label: 'THDi · şebeke (trafo)', value: '%' + fmt(v.THDiSupply, 1), sub: v.THDiSupply > hm.THDiLoad ? 'kondansatör harmonikleri büyütüyor' : 'banka harmoniklerin bir kısmını çekiyor', level: v.THDiSupply > hm.THDiLoad * 1.05 ? 'warn' : undefined },
        n.Q > 0 ? { label: 'Rezonans mertebesi', value: 'h ≈ ' + fmt(n.hr, 2) + ' · ' + fmt(n.hr * 50, 0, 'Hz'), sub: 'h_r = √(Ssc/Qc)' + (n.p > 0 ? ' · ayarlı: paralel h ≈ ' + fmt(n.hPar, 2) + ', seri ayar ' + fmt(n.hSer * 50, 0) + ' Hz' : ' · reaktörsüz banka'), level: lvOf(chk(res, 'res')) }
          : { label: 'Rezonans', value: '—', sub: 'banka devre dışı' },
        { label: 'Kondansatör akımı', value: n.Q > 0 ? fmt(v.capOver, 2) + '·In' : '—', level: lvOf(chk(res, 'cap')), sub: 'IEC 60831-1: ≤ 1,3·In' },
        { label: 'Tepe faktörü (akım / gerilim)', value: fmt(v.wf.iCF, 2) + ' / ' + fmt(v.wf.vCF, 2), sub: 'sinüste √2 ≈ 1,41' },
        { label: 'Nötr akımı', value: fmt(hm.Ineutral, 0, 'A'), sub: 'IN ≈ 3·I3 (dengeli tek fazlı yükler)', level: hm.Ineutral > v.I1 * 0.5 ? 'warn' : undefined },
        { label: 'En büyük tekil Vh', value: hm.rows.length ? (r => r.h + '. · %' + fmt(r.VhPct, 2))(hm.rows.reduce((a, b) => (b.VhPct > a.VhPct ? b : a))) : '—', level: lvOf(chk(res, 'vh')), sub: 'EN 50160 tekil değerleriyle karşılaştırılır' }
      );
    } else if (s.study === 'olay') {
      const tl = evTimeline(v);
      out.push(
        { label: 'Kalan gerilim', value: '%' + fmt(v.ev.u, 0), sub: v.ev.src === 'og' ? 'OG arıza ' + fmt(s.faultKm, 1) + ' km · Ik ≈ ' + fmt(v.sag.Ik_kA, 1, 'kA') : v.ev.src === 'motor' ? 'ΔU ≈ ' + fmt(v.motor.dU, 1) + ' % · Ist ' + fmt(v.motor.Ist, 0, 'A') : v.ev.src, level: v.ev.u < 70 || v.ev.u > 110 ? 'warn' : undefined },
        { label: 'Süre', value: fmt(v.ev.t, 0, 'ms'), sub: 'ağır çekim ×' + fmt(tl.slow, 0) },
        { label: 'Sınıf (EN 50160)', value: v.cls.label, sub: v.cls.type === 'dip' ? 'satır ' + (v.cls.row + 1) + ' · sütun ' + (v.cls.col + 1) : '', level: v.cls.type === 'normal' ? 'ok' : 'warn' },
        { label: 'SEMI F47 zarfı', value: Q.insideF47(v.ev.u, v.ev.t) ? 'İçinde' : 'Dışında', level: Q.insideF47(v.ev.u, v.ev.t) ? 'ok' : 'warn', sub: 'örnek hassas ekipman eğrisi' },
        { label: 'Kontaktör (model)', value: v.drops ? 'Bırakır' : 'Tutar', level: v.drops ? 'bad' : 'ok', sub: 'eşik %' + fmt(s.dropPct, 0) + ' · ' + fmt(s.dropMs, 0) + ' ms' },
        { label: 'Olay simülasyonu', value: live.phase === 'event' ? 't = ' + fmt(live.t * 1000, 0, 'ms') + ' · %' + fmt(uAt(v, live.t), 0) : live.phase === 'done' ? 'Bitti' + (live.dropped ? ' · motor durdu' : '') : 'Başlatılmadı', level: live.dropped ? 'bad' : undefined, sub: '“Olayı oynat” ya da Simülasyonu başlat' }
      );
    } else {
      out.push(
        { label: 'VUF (U2/U1)', value: '%' + fmt(v.VUF, 2), level: lvOf(chk(res, 'vuf')), sub: 'EN 50160: %2 (95 %, 10 dk)' },
        { label: 'NEMA LVUR', value: '%' + fmt(v.LVUR, 2), sub: 'ortalamadan en büyük sapma' },
        { label: 'Motor negatif bileşen akımı', value: '%' + fmt(v.I2, 1) + ' In', sub: '≈ VUF × Ist/In (' + fmt(s.kStart, 1) + ')', level: v.I2 > 15 ? 'warn' : undefined },
        { label: 'Faz arası gerilimler', value: fmt(s.Uab, 0) + ' / ' + fmt(s.Ubc, 0) + ' / ' + fmt(s.Uca, 0) + ' V', sub: 'ortalama ' + fmt((s.Uab + s.Ubc + s.Uca) / 3, 1, 'V') }
      );
    }
    return out;
  }

  function charts(res, s, live) {
    const v = res.values, n = v.net, hm = v.hm, ch = [];
    if (s.study === 'harmonik') {
      const V1p = Math.SQRT2 * n.V1, I1p = Math.SQRT2 * Math.max(v.I1, 1e-9);
      ch.push({ id: 'wave', title: 'Dalga şekli · faz–nötr gerilim ve hat akımı (pu, temel tepe değerine göre)', height: 170,
        series: [{ name: 'Gerilim v(t)', color: 'amber', data: v.wf.v.map(p => [p[0], p[1] / V1p]) }, { name: 'Akım i(t)', color: 'cyan', data: v.wf.i.map(p => [p[0], v.I1 > 0 ? p[1] / I1p : 0]) }],
        hLines: [{ y: 0, color: '#475569' }], x: { min: 0, max: 40, ticks: [0, 10, 20, 30, 40], label: 'ms' }, y: { label: 'pu', min: -2, max: 2 },
        alt: 'İki periyot. Akım tepe faktörü ' + fmt(v.wf.iCF, 2) + ', gerilim tepe faktörü ' + fmt(v.wf.vCF, 2) + '.' });
      const idx = hm.rows.map((r, i) => i + 1), xs = { min: 0.4, max: hm.rows.length + 0.6, ticks: idx, fmt: x => (hm.rows[x - 1] ? String(hm.rows[x - 1].h) : ''), label: 'h' };
      ch.push({ id: 'ispec', title: 'Harmonik akım spektrumu · yük ve şebeke (% I1)', height: 150,
        series: [{ name: 'Yük Ih', type: 'bar', color: 'grey', width: 0.36, offset: -0.5, data: hm.rows.map((r, i) => [i + 1, v.I1 > 0 ? r.Ih / v.I1 * 100 : 0]) },
          { name: 'Şebeke Ih', type: 'bar', color: 'violet', width: 0.36, offset: 0.5, data: hm.rows.map((r, i) => [i + 1, v.I1 > 0 ? r.Isupply / v.I1 * 100 : 0]) }],
        x: xs, y: { label: '%', min: 0 }, alt: hm.rows.map(r => r.h + '.: yük %' + fmt(v.I1 > 0 ? r.Ih / v.I1 * 100 : 0, 1) + ', şebeke %' + fmt(v.I1 > 0 ? r.Isupply / v.I1 * 100 : 0, 1)).join('; ') });
      ch.push({ id: 'vspec', title: 'Bara harmonik gerilimleri Vh (% U1) ve EN 50160 değerleri', height: 150,
        series: [{ name: 'Vh (hesap)', type: 'bar', color: 'amber', width: 0.5, data: hm.rows.map((r, i) => [i + 1, r.VhPct]) },
          { name: 'EN 50160 / IEC 61000-2-2', color: 'red', dash: [4, 3], width: 1.5, data: hm.rows.map((r, i) => [i + 1, r.limit || 0]) }],
        x: xs, y: { label: '%', min: 0 }, alt: hm.rows.map(r => r.h + '.: %' + fmt(r.VhPct, 2) + ' (değer %' + fmt(r.limit || 0, 1) + ')').join('; ') + '. THDv %' + fmt(hm.THDv, 2) + '.' });
      const fr = Q.freqResponse(n, 25, 0.05);
      ch.push({ id: 'z', title: 'Frekans tepkisi · bara empedansı |Z(h)| (log)', height: 180,
        series: [{ name: 'Yalnız şebeke', color: 'grey', dash: [5, 4], width: 1.5, data: fr.map(p => [p.h, p.src * 1e3]) },
          n.Q > 0 ? { name: 'Şebeke ∥ kondansatör kolu', color: 'cyan', data: fr.map(p => [p.h, Math.min(1000, p.bus * 1e3)]) } : null,
          n.Q > 0 ? { name: 'Kol empedansı |Zc|', color: 'violet', width: 1.2, data: fr.map(p => [p.h, Math.min(1000, Math.max(0.1, p.branch * 1e3))]) } : null].filter(Boolean),
        markers: n.Q > 0 ? [{ x: n.hPar, label: 'paralel h ≈ ' + fmt(n.hPar, 2), color: '#fcd34d' }].concat(n.hSer ? [{ x: n.hSer, label: 'seri ayar ' + fmt(n.hSer * 50, 0) + ' Hz', color: '#a78bfa' }] : []) : [],
        x: { min: 1, max: 25, ticks: [1, 3, 5, 7, 11, 13, 17, 19, 23, 25], label: 'h' }, y: { log: true, min: 0.1, max: 1000, label: 'mΩ' },
        alt: 'Paralel rezonans h ≈ ' + (n.Q > 0 ? fmt(n.hPar, 2) : '—') + '; Xs = ' + fmt(n.Xs * 1e3, 2) + ' mΩ.' });
      const Qr = Math.max(25, s.Qc_kvar);
      ch.push({ id: 'reac', title: 'Ayarlı reaktör oranları · kol empedansı (aynı ' + fmt(Qr, 0) + ' kVAr)', height: 160,
        series: [[0, 'p = 0 (reaktörsüz)', 'grey'], [0.0567, 'p = %5,67', 'amber'], [0.07, 'p = %7', 'cyan'], [0.14, 'p = %14', 'violet']].map(c => ({ name: c[1], color: c[2], width: c[0] * 100 === s.p ? 2.6 : 1.3, data: Q.branchCurve(s.U_LL, Qr, c[0], 25, 0.05).map(p => [p[0], Math.min(10000, Math.max(1, p[1] * 1e3))]) })),
        x: { min: 1, max: 25, ticks: [1, 3, 5, 7, 11, 13, 17, 19, 23, 25], label: 'h' }, y: { log: true, min: 1, max: 10000, label: 'mΩ' },
        alt: 'Seri ayar mertebeleri: %5,67 → 4,2 (210 Hz), %7 → 3,78 (189 Hz), %14 → 2,67 (134 Hz). Ayar noktasının üstünde kol endüktif davranır.' });
    } else if (s.study === 'olay') {
      const tl = evTimeline(v), pts = [];
      for (let t = 0; t <= tl.total + 1e-9; t += tl.total / 300) pts.push([t * 1000, uAt(v, t)]);
      const shown = live.phase === 'event' ? pts.filter(p => p[0] <= live.t * 1000) : pts;
      ch.push({ id: 'rms', title: 'Rms gerilim olayı (yarım periyot rms, % Uref)', height: 180,
        series: [{ name: 'Urms', color: 'amber', area: false, width: 2, data: shown.length > 1 ? shown : pts.slice(0, 2) }],
        hLines: [{ y: 110, label: '%110 yükselme eşiği', color: '#f59e0b' }, { y: 90, label: '%90 çökme eşiği', color: '#f59e0b' }, { y: s.dropPct, label: 'kontaktör %' + fmt(s.dropPct, 0), color: '#ef4444' }],
        x: { min: 0, max: tl.total * 1000, label: 'ms' }, y: { min: 0, max: Math.max(130, v.ev.u + 10), label: '%' },
        alt: 'Kalan gerilim %' + fmt(v.ev.u, 0) + ', süre ' + fmt(v.ev.t, 0) + ' ms. ' + v.cls.label + '.' });
      const f47 = [[10, 50], [200, 50], [200, 70], [500, 70], [500, 80], [1000, 80], [1000, 90], [100000, 90]];
      ch.push({ id: 'f47', title: 'Dayanım eğrileri · olay noktası (log zaman)', height: 180,
        series: [{ name: 'SEMI F47 (örnek)', color: 'green', width: 2, data: f47 },
          { name: 'Kontaktör modeli', color: 'red', dash: [4, 3], width: 1.5, data: [[Math.max(1, s.dropMs), 100], [Math.max(1, s.dropMs), s.dropPct], [100000, s.dropPct]] },
          { name: 'EN 50160 çökme eşiği %90', color: 'grey', dash: [2, 3], width: 1, data: [[10, 90], [100000, 90]] }],
        markers: [{ x: Math.max(10, v.ev.t), y: Math.min(140, v.ev.u), label: 'olay %' + fmt(v.ev.u, 0) + ' · ' + fmt(v.ev.t, 0) + ' ms', color: '#ef4444' }],
        x: { log: true, min: 10, max: 100000, label: 'ms' }, y: { min: 0, max: 140, label: '%' },
        alt: 'Olay ' + (Q.insideF47(v.ev.u, v.ev.t) ? 'SEMI F47 zarfının içinde' : 'zarfın dışında') + '; kontaktör ' + (v.drops ? 'bırakır' : 'tutar') + '.' });
    } else {
      ch.push({ id: 'll', title: 'Faz arası gerilimler (V)', height: 150,
        series: [{ name: 'U (V)', type: 'bar', color: 'amber', width: 0.5, data: [[1, s.Uab], [2, s.Ubc], [3, s.Uca]] }],
        hLines: [{ y: (s.Uab + s.Ubc + s.Uca) / 3, label: 'ortalama', color: '#94a3b8' }],
        x: { min: 0.4, max: 3.6, ticks: [1, 2, 3], fmt: x => ['', 'Uab', 'Ubc', 'Uca'][x] || '' }, y: { min: 360, max: 420, label: 'V' },
        alt: 'Uab ' + s.Uab + ' V, Ubc ' + s.Ubc + ' V, Uca ' + s.Uca + ' V; VUF %' + fmt(v.VUF, 2) + '.' });
      const curve = []; for (let u = 0; u <= 5.0001; u += 0.1) curve.push([u, Q.motorI2(u, s.kStart)]);
      ch.push({ id: 'i2', title: 'Gerilim dengesizliği → motor negatif bileşen akımı', height: 150,
        series: [{ name: 'I2/In (%)', color: 'violet', data: curve }],
        markers: [{ x: v.VUF, y: v.I2, label: 'VUF %' + fmt(v.VUF, 2), color: '#fcd34d' }, { x: 2, label: 'EN 50160 %2', color: '#ef4444' }],
        x: { min: 0, max: 5, label: 'VUF %' }, y: { min: 0, label: '% In' }, alt: 'I2 ≈ VUF × Ist/In; VUF %' + fmt(v.VUF, 2) + ' → %' + fmt(v.I2, 1) + ' In.' });
    }
    return ch;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  function rebuildOn(s) { return String(s.p > 0); }
  let HIT = null;
  const hitMat = k => HIT || (HIT = new k.T.MeshBasicMaterial({ visible: false }));
  function cabinet(k, x, z, w, h, mat) {
    const M = k.mats, g = k.group(null, x, 0, z);
    k.box(w, 0.1, 0.5, M.plasticDark, 0, 0.05, 0, g);
    k.shell(k.rbox(w, h, 0.55, 0.01, mat || M.panelRAL7035, 0, 0.1 + h / 2, 0, g));
    return g;
  }
  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    HIT = null;
    const sc = { flows: [] }; app.scene3 = sc;
    k.ground(60, k.mat(0x4a525b, { roughness: 0.5, metalness: 0.1 }), 0);
    const grid = new T.GridHelper(60, 120, 0x3d4650, 0x3d4650); grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.2; grid.userData.noClip = true; v.root.add(grid);
    const wall = k.box(20, 3.6, 0.1, k.mat(0x8b96a3, { roughness: 0.9 }), 1, 1.8, -1.2); wall.userData.noClip = true;

    // ---- OG direk ve hat (arıza olayı)
    const pole = k.group(null, -6.2, 0, -0.4);
    k.cyl(0.09, 0.13, 6, M.concrete, 0, 3, 0, pole, 12);
    k.box(1.6, 0.08, 0.1, M.galv, 0, 5.6, 0, pole);
    for (let j = 0; j < 3; j++) k.cyl(0.04, 0.05, 0.18, M.porcelain, -0.6 + j * 0.6, 5.74, 0, pole, 10);
    k.box(0.4, 6, 0.4, hitMat(k), 0, 3, 0, pole).castShadow = false;
    k.pickable(pole, 'OG hat · komşu fider', () => { const r = app.validResult; return r ? ['Komşu fiderde üç faz arıza ortak baradaki gerilimi düşürür: V = |ZF|/|ZS + ZF| (gerilim bölücü).', 'Arıza ' + fmt(s.faultKm, 1) + ' km · kalan gerilim %' + fmt(r.values.sag.u, 0) + ' · arıza akımı ≈ ' + fmt(r.values.sag.Ik_kA, 1, 'kA'), 'Süre koruma temizleme süresidir: ' + fmt(s.sagMs, 0) + ' ms.'] : []; },
      () => [{ label: 'Yakın arıza (1 km) · oynat', variant: 'danger', onClick: a => { Object.assign(a.state, { study: 'olay', view: 'event', event: 'og', faultKm: 1 }); a.running = true; a.paused = false; start(a); a.syncToolbar(); } },
        { label: 'Uzak arıza (15 km) · oynat', variant: 'warn', onClick: a => { Object.assign(a.state, { study: 'olay', view: 'event', event: 'og', faultKm: 15 }); a.running = true; a.paused = false; start(a); a.syncToolbar(); } }]);
    k.label('OG hat', pole, [0, 6.2, 0], 'vs-label--sm');
    // ---- trafo
    const tr = k.group(null, -4.4, 0, -0.3), trs = k.staticGroup(tr);
    k.rbox(1.3, 1.0, 0.7, 0.03, M.trafoPaint, 0, 0.6, 0, tr);
    for (let j = 0; j < 16; j++) { k.box(0.012, 0.8, 0.2, M.trafoPaint, -0.55 + j * 0.073, 0.55, 0.45, trs); k.box(0.012, 0.8, 0.2, M.trafoPaint, -0.55 + j * 0.073, 0.55, -0.45, trs); }
    for (let j = 0; j < 3; j++) k.cyl(0.03, 0.035, 0.25, M.porcelainGrey, -0.35 + j * 0.35, 1.22, -0.18, tr, 12);
    for (let j = 0; j < 4; j++) k.cyl(0.03, 0.035, 0.12, M.porcelainGrey, -0.39 + j * 0.26, 1.16, 0.18, tr, 12);
    k.pickable(tr, () => 'Trafo ' + s.Sr_kVA + ' kVA · uk %' + fmt(s.uk, 1), () => { const r = app.validResult; return r ? ['XT = uk·U²/Sr = ' + fmt(r.values.net.XT * 1e3, 2) + ' mΩ · AG bara Ssc ≈ ' + fmt(r.values.net.Ssc / 1e3, 1, 'MVA'), 'Dyn bağlantı: 3. harmonik akımlar AG yıldız noktasından döner, OG’de üçgende dolaşır.', 'Şebeke harmonik akımı THDi %' + fmt(r.values.THDiSupply, 1)] : []; },
      () => [{ label: 'Trafo bir kademe büyük', onClick: a => { const o = [400, 630, 800, 1000, 1250, 1600, 2000, 2500]; a.state.Sr_kVA = o[Math.min(o.length - 1, o.indexOf(a.state.Sr_kVA) + 1)] || 1000; } },
        { label: 'Trafo bir kademe küçük', onClick: a => { const o = [400, 630, 800, 1000, 1250, 1600, 2000, 2500]; a.state.Sr_kVA = o[Math.max(0, o.indexOf(a.state.Sr_kVA) - 1)] || 1000; } }]);
    sc.trLbl = k.label('Trafo', tr, [0, 1.6, 0]);
    k.tube([[-6.2, 5.5, -0.4], [-5.2, 3.2, -0.4], [-4.4, 1.5, -0.48]], 0.02, M.cableBlack, null);
    // ---- AG pano (2 bölüm) ve analizör bağlantısı
    const pn = cabinet(k, -2.6, -0.6, 1.4, 2.0);
    for (let j = 0; j < 3; j++) k.box(1.25, 0.03, 0.01, M.copper, -2.6, 1.9 - j * 0.05, -0.7, null);
    const acb = k.rbox(0.5, 0.36, 0.25, 0.01, M.plasticDark, -2.85, 1.25, -0.28, null); void acb;
    k.box(0.3, 0.12, 0.01, M.plasticGrey, -2.85, 1.25, -0.15, null);
    sc.flows.push(k.flow(k.tube([[-4.2, 1.3, -0.48], [-3.8, 2.4, -0.6], [-2.85, 2.4, -0.6], [-2.85, 2.12, -0.6]], 0.04, M.cableBlack, null).userData.curve, 20, 0xfcd34d, 0.018));
    k.label('AG pano', pn, [0, 2.3, 0], 'vs-label--sm');
    // akım pensleri (renkli halkalar) ve analizör arabası
    const clampCols = [0x6b3f22, 0x1b1b1b, 0x8a9099, 0x2563eb];
    clampCols.forEach((c, j) => { const t = new T.Mesh(new T.TorusGeometry(0.05, 0.016, 8, 18), k.mat(c)); t.position.set(-3.8 + j * 0.05, 2.2 - j * 0.02, -0.6); t.rotation.y = Math.PI / 2; v.root.add(t); });
    const an = k.group(null, -1.4, 0, 0.6);
    k.box(0.5, 0.04, 0.4, M.galv, 0, 0.75, 0, an); k.box(0.5, 0.04, 0.4, M.galv, 0, 0.25, 0, an);
    for (let j = 0; j < 4; j++) k.cyl(0.015, 0.015, 0.75, M.galv, (j % 2 ? 0.22 : -0.22), 0.4, (j < 2 ? 0.17 : -0.17), an, 8);
    k.rbox(0.36, 0.24, 0.12, 0.02, k.mat(0xf59e0b, { roughness: 0.5 }), 0, 0.9, 0, an);
    const anScr = k.screen(0.26, 0.15, 256, (g, w, h) => drawScreen(g, w, h, app, true), an, { emissive: 0.85 });
    anScr.position.set(0, 0.92, 0.062); anScr.rotation.x = -0.15; sc.anScr = anScr;
    k.box(0.5, 0.9, 0.45, hitMat(k), 0, 0.5, 0, an).castShadow = false;
    k.tube([[-1.4, 0.95, 0.55], [-2.0, 1.2, 0.2], [-3.4, 2.0, -0.4], [-3.75, 2.18, -0.58]], 0.01, M.plasticRed, null);
    k.pickable(an, 'Enerji analizörü (IEC 61000-4-30 Sınıf A örneği)', () => { const r = app.validResult; return r ? ['Pens ampermetreler giriş kablosunda; gerilim uçları ana barada.', 'THDv %' + fmt(r.values.hm.THDv, 2) + ' · THDi (şebeke) %' + fmt(r.values.THDiSupply, 1) + ' · VUF %' + fmt(r.values.VUF, 2), 'Uygunluk değerlendirmesi bir haftalık 10 dakikalık ortalamalarla yapılır (EN 50160).'] : []; },
      () => VIEWS.map(w => ({ label: 'Ekran: ' + w[1], variant: app.state.view === w[0] ? '' : 'primary', onClick: a => { a.state.view = w[0]; if (w[0] === 'event') a.state.study = 'olay'; else if (w[0] === 'phasor') a.state.study = 'denge'; else if (a.state.study !== 'harmonik') a.state.study = 'harmonik'; } })));
    k.label('Enerji analizörü', an, [0, 1.2, 0], 'vs-label--sm');
    // ---- büyük ekran
    const mon = k.group(null, 0.6, 0, -1.1);
    k.box(1.9, 1.12, 0.06, M.plasticDark, 0, 2.0, 0, mon);
    const big = k.screen(1.8, 1.02, 900, (g, w, h) => drawScreen(g, w, h, app, false), mon, { emissive: 0.9 });
    big.position.set(0, 2.0, 0.035); sc.big = big;
    k.pickable(mon, 'Analiz ekranı', () => ['Seçili görünüm: ' + (VIEWS.find(w => w[0] === s.view) || VIEWS[0])[1], 'Ekran hesap motorunun sonucunu çizer; simülasyon çalışırken dalga şekli kayar.'], () => VIEWS.map(w => ({ label: w[1], onClick: a => { a.state.view = w[0]; } })));
    // ---- kondansatör bankası (ayarlı reaktörler)
    const cb = cabinet(k, 2.4, -0.6, 0.8, 2.0, k.mat(0xd7d9d6, { metalness: 0.25, roughness: 0.48 }));
    const cans = k.group(cb, 0, 0, 0.1); sc.cans = cans;
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) k.cyl(0.04, 0.04, 0.24, M.alu, -0.27 + c * 0.18, 1.35 + r * 0.38, 0, cans, 16);
    if (s.p > 0) for (let c = 0; c < 2; c++) { const rg = k.group(cb, -0.17 + c * 0.34, 0.55, 0.1); k.box(0.26, 0.04, 0.09, M.darkSteel, 0, 0.12, 0, rg); k.box(0.26, 0.04, 0.09, M.darkSteel, 0, -0.12, 0, rg); for (let j = 0; j < 3; j++) k.cyl(0.035, 0.035, 0.2, k.mat(0x9a5a2e, { metalness: 0.55, roughness: 0.42 }), -0.08 + j * 0.08, 0, 0, rg, 14); }
    k.box(0.8, 2.0, 0.6, hitMat(k), 0, 1.1, 0, cb).castShadow = false;
    sc.capLed = k.box(0.04, 0.02, 0.01, M.ledGreen, 0.3, 1.95, 0.29, cb);
    k.pickable(cb, () => 'Kondansatör bankası · ' + fmt(s.Qc_kvar, 0, 'kVAr') + (s.p > 0 ? ' · p %' + fmt(s.p, s.p % 1 ? 2 : 0) : ' · reaktörsüz'), () => { const r = app.validResult; if (!r) return []; const n = r.values.net; return n.Q > 0 ? ['h_r = √(Ssc/Qc) ≈ ' + fmt(n.hr, 2) + (n.p > 0 ? ' · paralel h ≈ ' + fmt(n.hPar, 2) + ' · seri ayar ' + fmt(n.hSer * 50, 0) + ' Hz' : ''), 'Kondansatör akımı ' + fmt(r.values.capOver, 2) + '·In (IEC 60831-1 ≤ 1,3·In)', '3. harmonik (sıfır bileşen) üçgen bankaya girmez.', 'Kademe/röle davranışı için Kompanzasyon simülasyonuna bakın.'] : ['Banka devre dışı.']; },
      () => [{ label: s.capOn ? 'Bankayı devreden çıkar' : 'Bankayı devreye al', variant: s.capOn ? 'warn' : 'primary', onClick: a => { a.state.capOn = !a.state.capOn; a.state.study = 'harmonik'; } },
        { label: 'Reaktör oranı: ' + (s.p === 0 ? '%7' : s.p === 7 ? '%14' : s.p === 14 ? '%5,67' : 'yok'), onClick: a => { a.state.p = a.state.p === 0 ? 7 : a.state.p === 7 ? 14 : a.state.p === 14 ? 5.67 : 0; } },
        { label: 'Qc +50 kVAr', onClick: a => { a.state.Qc_kvar = Math.min(1200, a.state.Qc_kvar + 50); } }, { label: 'Qc −50 kVAr', onClick: a => { a.state.Qc_kvar = Math.max(25, a.state.Qc_kvar - 50); } }]);
    sc.capLbl = k.label('Kondansatör', cb, [0, 2.35, 0], 'vs-label--sm');
    // ---- VFD pano
    const vf = cabinet(k, 3.5, -0.6, 0.7, 2.0, M.panelDark);
    for (let r = 0; r < 8; r++) k.box(0.4, 0.008, 0.006, M.darkSteel, 3.5, 1.7 + r * 0.025, -0.32, null);
    const kp = k.screen(0.14, 0.08, 128, (g, w, h) => { g.fillStyle = '#0b2a1a'; g.fillRect(0, 0, w, h); g.fillStyle = '#4ade80'; g.font = 'bold 22px monospace'; g.fillText('RUN', 8, 30); g.font = '15px monospace'; g.fillText(s.spectrum === 'vfd12' ? '12P' : '6P', 8, 54); }, vf, { emissive: 0.8 });
    kp.position.set(0, 1.3, 0.28);
    k.box(0.7, 2.0, 0.6, hitMat(k), 0, 1.1, 0, vf).castShadow = false;
    k.pickable(vf, 'Doğrusal olmayan yük · sürücü panosu', () => { const r = app.validResult; return r ? [Q.SPECTRA[s.spectrum] ? Q.SPECTRA[s.spectrum].label : 'Özel spektrum', 'P = ' + fmt(s.P_kW, 0, 'kW') + ' · THDi (yük) %' + fmt(r.values.hm.THDiLoad, 1), 'Harmonik akım kaynağı: Vh = |Z(h)|·Ih'] : []; },
      () => [{ label: 'Şoksuz 6 darbeli', variant: 'warn', onClick: a => { setSpectrum(a, 'vfd6'); a.state.study = 'harmonik'; } }, { label: 'DC şok ekle', onClick: a => { setSpectrum(a, 'vfd6c'); a.state.study = 'harmonik'; } },
        { label: '12 darbeli', onClick: a => { setSpectrum(a, 'vfd12'); a.state.study = 'harmonik'; } }, { label: 'Yük +100 kW', onClick: a => { a.state.P_kW = Math.min(1500, a.state.P_kW + 100); } }]);
    k.label('Sürücü (VFD)', vf, [0, 2.35, 0], 'vs-label--sm');
    sc.flows.push(k.flow(k.tube([[3.5, 2.12, -0.6], [3.5, 2.6, -0.8], [-2.4, 2.6, -0.8], [-2.4, 2.12, -0.7]], 0.03, M.cableBlack, null).userData.curve, 18, 0xa78bfa, 0.016));
    k.tube([[2.4, 2.12, -0.6], [2.4, 2.5, -0.85], [-2.2, 2.5, -0.85], [-2.2, 2.12, -0.72]], 0.025, M.cableBlack, null);
    // ---- ofis yükü (tek fazlı SMPS)
    const of = k.group(null, 4.9, 0, 0.2);
    k.box(1.2, 0.04, 0.6, k.mat(0xc8b08a, { roughness: 0.7 }), 0, 0.74, 0, of);
    for (let j = 0; j < 4; j++) k.box(0.04, 0.72, 0.04, M.darkSteel, (j % 2 ? 0.55 : -0.55), 0.36, (j < 2 ? 0.26 : -0.26), of);
    for (let j = 0; j < 2; j++) { k.box(0.45, 0.28, 0.03, M.plasticDark, -0.28 + j * 0.56, 1.05, -0.1, of); k.box(0.42, 0.25, 0.005, k.mat(0x1e3a5f, { emissive: 0x1e3a5f, emissiveIntensity: 0.6 }), -0.28 + j * 0.56, 1.05, -0.083, of); k.box(0.18, 0.4, 0.4, M.plasticDark, -0.28 + j * 0.56, 0.2, 0, of); }
    k.box(1.3, 1.3, 0.7, hitMat(k), 0, 0.65, 0, of).castShadow = false;
    k.pickable(of, 'Ofis yükü · tek fazlı SMPS / LED', () => ['Tek fazlı anahtarlamalı güç kaynakları baskın 3. harmonik akım çeker.', 'Dengeli dağıtılsa da 3. harmonikler nötrde toplanır: IN ≈ 3·I3.'], () => [{ label: 'Spektrumu SMPS yap', variant: 'primary', onClick: a => { setSpectrum(a, 'smps'); a.state.study = 'harmonik'; a.state.P_kW = Math.min(a.state.P_kW, 150); } }, { label: 'Karma tesis', onClick: a => { setSpectrum(a, 'mix'); } }]);
    k.label('Ofis (SMPS)', of, [0, 1.5, 0], 'vs-label--sm');
    // ---- motor ve kontaktör (çökme)
    const mo = k.group(null, 1.0, 0, 1.3);
    k.box(0.6, 0.05, 0.35, M.darkSteel, 0, 0.025, 0, mo);
    const rotor = k.group(mo, 0, 0.25, 0); sc.rotor = rotor;
    k.cyl(0.2, 0.2, 0.5, M.plasticBlue, 0, 0, 0, rotor, 24).rotation.z = Math.PI / 2;
    for (let j = 0; j < 4; j++) { const b = k.box(0.03, 0.34, 0.05, M.plasticGrey, 0.3, 0, 0, rotor); b.rotation.x = j * Math.PI / 4; }
    const cbx = k.group(null, 1.8, 1.2, -1.1);
    k.rbox(0.3, 0.4, 0.15, 0.01, M.panelRAL7035, 0, 0, 0, cbx); sc.kLed = k.box(0.04, 0.02, 0.01, M.ledGreen, 0, 0.12, 0.08, cbx);
    k.box(0.8, 0.6, 0.6, hitMat(k), 0, 0.3, 0, mo).castShadow = false;
    k.pickable(mo, () => 'Motor ' + fmt(s.motorKW, 0, 'kW') + ' · kontaktörlü', () => { const r = app.validResult; return r ? ['Doğrudan yol verme: Ist = ' + fmt(s.kStart, 1) + '·In ≈ ' + fmt(r.values.motor.Ist, 0, 'A') + ' → ΔU ≈ %' + fmt(r.values.motor.dU, 1), 'Kontaktör modeli: kalan gerilim < %' + fmt(s.dropPct, 0) + ' ve süre > ' + fmt(s.dropMs, 0) + ' ms → bırakır.', 'Gerilim dengesizliği VUF %' + fmt(r.values.VUF, 2) + ' → negatif bileşen akımı ≈ %' + fmt(r.values.I2, 1) + ' In'] : []; },
      () => [{ label: 'Motoru çalıştır (yol alma çökmesi)', variant: 'primary', onClick: a => { Object.assign(a.state, { study: 'olay', view: 'event', event: 'motor' }); a.running = true; a.paused = false; start(a); a.syncToolbar(); } },
        { label: 'Dengesizlik analizi', onClick: a => { Object.assign(a.state, { study: 'denge', view: 'phasor' }); } }]);
    sc.moLbl = k.label('Motor', mo, [0, 0.7, 0], 'vs-label--sm');
    // aydınlatma armatürleri (çökmede kararır)
    sc.lamps = [];
    const lampMat = k.mat(0xfff7d6, { emissive: 0xfff3c4, emissiveIntensity: 1.2 }); sc.lampMat = lampMat;
    for (let j = 0; j < 5; j++) { const l = k.box(0.9, 0.04, 0.15, lampMat, -3 + j * 2, 3.3, 0.4, null); l.castShadow = false; sc.lamps.push(l); }
    app.def.scene.bounds = [-7, 6];
    v.setView({ target: [-0.2, 1.3, -0.1], r: 8.6, theta: 0.1, phi: 1.22, limits: { rMin: 1, rMax: 30 } });
    v.setShadowBox(9, 40);
    v.sun.position.set(2, 9, 7);
  }

  /** Analizör ve büyük ekran çizimi: seçili görünüm; simülasyon çalışırken dalga şekli kayar. */
  function drawScreen(g, w, h, app, small) {
    const r = app.validResult, s = app.state; g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    if (!r) return;
    const v = r.values, L = app.live, pad = small ? 8 : 26, fs = small ? 13 : 30;
    g.fillStyle = '#7dd3fc'; g.font = 'bold ' + fs + 'px monospace'; g.textBaseline = 'top';
    const title = { wave: 'DALGA', spec: 'SPEKTRUM', z: 'EMPEDANS |Z(h)|', event: 'OLAY · RMS', phasor: 'DENGESİZLİK' }[s.view] || '';
    g.fillText(title, pad, pad * 0.6);
    g.textAlign = 'right'; g.fillStyle = '#fcd34d';
    const tag = s.view === 'event' ? '%' + fmt(L.phase === 'event' ? uAt(v, L.t) : v.ev.u, 0) : s.view === 'phasor' ? 'VUF %' + fmt(v.VUF, 2) : 'THDv %' + fmt(v.hm.THDv, 1);
    g.fillText(tag, w - pad, pad * 0.6); g.textAlign = 'left';
    const x0 = pad, y0 = pad * 0.6 + fs + 8, W = w - 2 * pad, H = h - y0 - pad * 0.6;
    g.strokeStyle = '#1e3a5f'; g.lineWidth = 1; g.strokeRect(x0, y0, W, H);
    g.lineWidth = small ? 1.6 : 3;
    if (s.view === 'wave') {
      const off = (L.phase === 'run' || app.running) && !app.paused ? (L.ph || 0) * 0.5 : 0, V1p = Math.SQRT2 * v.net.V1, I1p = Math.SQRT2 * Math.max(v.I1, 1e-9);
      const tr = (arr, sc, col) => { g.strokeStyle = col; g.beginPath(); for (let k = 0; k <= 160; k++) { const f = (k / 160 + off) % 1, idx = Math.floor(f * (arr.length - 1) / 2); const p = arr[idx]; const x = x0 + k / 160 * W, y = y0 + H / 2 - p[1] / sc * H * 0.24; if (k) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); };
      g.strokeStyle = '#1e3a5f'; g.beginPath(); g.moveTo(x0, y0 + H / 2); g.lineTo(x0 + W, y0 + H / 2); g.stroke();
      tr(v.wf.v, V1p, '#f59e0b'); if (v.I1 > 0) tr(v.wf.i, I1p, '#22d3ee');
    } else if (s.view === 'spec') {
      const rows = v.hm.rows, bw = W / (rows.length * 2 + 1), mx = Math.max(8, ...rows.map(x => Math.max(x.VhPct, x.limit || 0))) * 1.1;
      rows.forEach((x, i) => {
        const bx = x0 + bw * (1 + 2 * i), bh = x.VhPct / mx * (H - 4);
        g.fillStyle = x.limit && x.VhPct > x.limit ? '#ef4444' : '#f59e0b'; g.fillRect(bx, y0 + H - bh, bw, bh);
        if (x.limit) { g.strokeStyle = '#ef4444'; g.beginPath(); const ly = y0 + H - x.limit / mx * (H - 4); g.moveTo(bx - 2, ly); g.lineTo(bx + bw + 2, ly); g.stroke(); }
        g.fillStyle = '#cbd5e1'; g.font = (small ? 10 : 22) + 'px monospace'; g.fillText(String(x.h), bx, y0 + H - (small ? 12 : 26));
      });
    } else if (s.view === 'z') {
      const fr = Q.freqResponse(v.net, 25, 0.1), lg = z => Math.log10(Math.max(z * 1e3, 0.1)), lo = -1, hi = 3;
      [['src', '#64748b'], ['bus', '#22d3ee']].forEach(([key, col]) => { g.strokeStyle = col; g.beginPath(); fr.forEach((p, i) => { const x = x0 + (p.h - 1) / 24 * W, y = y0 + H - (lg(p[key]) - lo) / (hi - lo) * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); });
      if (v.net.Q > 0) { g.strokeStyle = '#fcd34d'; const x = x0 + (v.net.hPar - 1) / 24 * W; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + H); g.stroke(); }
    } else if (s.view === 'event') {
      const tl = evTimeline(v), tEnd = L.phase === 'event' ? L.t : tl.total, ymax = Math.max(130, v.ev.u + 10);
      g.strokeStyle = '#475569'; [90, 110].forEach(u => { const y = y0 + H - u / ymax * H; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + W, y); g.stroke(); });
      g.strokeStyle = '#f59e0b'; g.beginPath();
      for (let k = 0; k <= 200; k++) { const t = k / 200 * tl.total; if (t > tEnd) break; const x = x0 + t / tl.total * W, y = y0 + H - uAt(v, t) / ymax * H; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    } else {
      const cx = x0 + W * 0.3, cy = y0 + H / 2, R = Math.min(W * 0.25, H * 0.45);
      const U = [s.Uab, s.Ubc, s.Uca], ang = [30, -90, 150];
      ['#c2410c', '#e2e8f0', '#94a3b8'].forEach((col, i) => { g.strokeStyle = col; const a = ang[i] * Math.PI / 180, l = U[i] / 420 * R; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * l, cy - Math.sin(a) * l); g.stroke(); });
      g.fillStyle = '#e2e8f0'; g.font = (small ? 11 : 24) + 'px monospace';
      ['Uab ' + fmt(s.Uab, 0), 'Ubc ' + fmt(s.Ubc, 0), 'Uca ' + fmt(s.Uca, 0)].forEach((t, i) => g.fillText(t, x0 + W * 0.62, y0 + 6 + i * (small ? 14 : 34)));
    }
  }

  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values;
    sc.cans.visible = s.capOn;
    sc.capLed.material = s.capOn ? k.mats.ledGreen : k.mats.ledOff;
    sc.capLbl.set(s.capOn ? 'Kondansatör ' + fmt(s.Qc_kvar, 0) + ' kVAr' + (s.p > 0 ? ' · p %' + fmt(s.p, s.p % 1 ? 2 : 0) : ' · reaktörsüz') : 'Kondansatör devre dışı');
    sc.capLbl.level(lvOf(chk(res, 'res')) || '');
    sc.trLbl.set('Trafo · THDv %' + fmt(v.hm.THDv, 1)); sc.trLbl.level(v.hm.THDv > 8 ? 'bad' : v.hm.THDv > 5 ? 'warn' : 'ok');
    sc.flows.forEach((f, i) => { f.speed = i === 0 ? 0.4 : Math.min(1.4, v.THDiSupply / 40); });
    sc.big.redraw(); sc.anScr.redraw();
    sc.moLbl.set('Motor ' + fmt(s.motorKW, 0) + ' kW' + (live.dropped ? ' · DURDU' : ''));
    sc.moLbl.level(live.dropped ? 'bad' : '');
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return false;
    let moving = false;
    const v = res.values;
    const u = live.phase === 'event' ? uAt(v, live.t) : 100;
    const li = Math.max(0.05, Math.pow(u / 100, 2)) * 1.2;
    if (Math.abs(sc.lampMat.emissiveIntensity - li) > 1e-3) { sc.lampMat.emissiveIntensity = li; moving = true; }
    const want = live.dropped ? 0 : 1;
    sc.spin = (sc.spin === undefined ? 1 : sc.spin) + (want - (sc.spin === undefined ? 1 : sc.spin)) * Math.min(1, dt * 1.5);
    if (Math.abs(sc.spin - want) < 0.01) sc.spin = want;
    if (sc.spin > 0 && dt > 0 && !k.reducedMotion && app.running && !app.paused) { sc.rotor.rotation.x += dt * 20 * sc.spin; moving = true; }
    sc.kLed.material = live.dropped ? k.mats.ledRed : k.mats.ledGreen;
    // ekranlar: çalışırken ≈ 15 fps imzalı yeniden çizim
    sc.st = (sc.st || 0) + dt;
    if (sc.st > 0.066) {
      sc.st = 0;
      const sig = [s.view, s.study, fmt(v.hm.THDv, 2), fmt(v.VUF, 2), live.phase, Math.round((live.ph || 0) * 15) * (app.running && !app.paused && s.view === 'wave' ? 1 : 0), Math.round(live.t * 300)].join('|');
      const before = sc.sig; sc.big.redraw(sig); sc.anScr.redraw(sig); sc.sig = sig;
      if (before !== sig) moving = true;
    }
    return moving;
  }

  /* ---------------------------------------------------------------- 2D şema */
  function view2d(g, W, H, res, s, live, app) {
    const v = res.values, col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', cu: '#c77b4a' };
    const fitT = VS.fitText, R = W - 70;
    g.lineWidth = 2; g.font = '12px Inter, sans-serif'; g.textBaseline = 'alphabetic';
    const tx = 54, top = 64;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(tx, top - 14); g.lineTo(tx, top); g.stroke();
    g.beginPath(); g.arc(tx, top + 12, 12, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(tx, top + 30, 12, 0, Math.PI * 2); g.stroke();
    g.fillStyle = col.dim; g.fillText(fitT(g, 'OG ' + fmt(s.SkQ_MVA, 0) + ' MVA · Trafo ' + s.Sr_kVA + ' kVA, uk %' + fmt(s.uk, 1) + ' · Ssc ' + fmt(v.net.Ssc / 1e3, 1) + ' MVA', R - tx - 30), tx + 22, top + 26);
    const by = top + 84;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(tx, top + 42); g.lineTo(tx, by); g.stroke();
    g.beginPath(); g.arc(tx, top + 62, 7, 0, Math.PI * 2); g.stroke(); g.fillStyle = col.warn; g.fillText('PQ analizör', tx + 12, top + 66);
    g.lineWidth = 5; g.strokeStyle = col.cu; g.beginPath(); g.moveTo(tx - 20, by); g.lineTo(R, by); g.stroke(); g.lineWidth = 2;
    g.fillStyle = col.dim; g.fillText(fitT(g, 'AG bara ' + s.U_LL + ' V · THDv %' + fmt(v.hm.THDv, 2) + ' · VUF %' + fmt(v.VUF, 2), R - tx - 20), tx + 100, by - 10);
    const branches = [['VFD / yük', 'P ' + fmt(s.P_kW, 0) + ' kW · THDi %' + fmt(v.hm.THDiLoad, 0)], ['Kondansatör', s.capOn ? fmt(s.Qc_kvar, 0) + ' kVAr' + (s.p > 0 ? ' · p %' + fmt(s.p, s.p % 1 ? 2 : 0) : '') : 'devre dışı'], ['Motor', fmt(s.motorKW, 0) + ' kW' + (live.dropped ? ' · durdu' : '')], ['Ofis', 'tek fazlı']];
    const sp = Math.min(160, (R - tx - 40) / branches.length);
    branches.forEach((b, i) => {
      const x = tx + 60 + i * sp;
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by); g.lineTo(x, by + 40); g.stroke();
      if (i === 1) { if (s.p > 0) { g.beginPath(); for (let j = 0; j < 3; j++) g.arc(x, by + 46 + j * 7, 3.5, -Math.PI / 2, Math.PI / 2); g.stroke(); } const y = by + (s.p > 0 ? 68 : 44); g.strokeStyle = s.capOn ? col.ok : col.dim; g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x - 9, y + 6); g.lineTo(x + 9, y + 6); g.stroke(); }
      else if (i === 2) { g.strokeStyle = live.dropped ? col.bad : col.line; g.beginPath(); g.arc(x, by + 54, 12, 0, Math.PI * 2); g.stroke(); g.fillStyle = col.text; g.textAlign = 'center'; g.fillText('M', x, by + 58); g.textAlign = 'left'; }
      else { g.strokeRect(x - 13, by + 40, 26, 26); g.beginPath(); g.moveTo(x - 13, by + 66); g.lineTo(x + 13, by + 40); g.stroke(); }
      g.fillStyle = col.text; g.font = 'bold 11px Inter, sans-serif'; g.fillText(fitT(g, b[0], sp - 14), x - 13, by + 96);
      g.fillStyle = col.dim; g.font = '11px Inter, sans-serif'; g.fillText(fitT(g, b[1], sp - 14), x - 13, by + 112);
    });
    // küçük ekran: seçili görünüm
    const ih = Math.max(120, Math.min(260, H - by - 190)), iw = Math.min(R - 40, ih * 1.9);
    const cv = document.createElement('canvas'); cv.width = Math.round(iw * 2); cv.height = Math.round(ih * 2);
    const cg = cv.getContext('2d'); cg.setTransform(2, 0, 0, 2, 0, 0); drawScreen(cg, iw, ih, app, true);
    g.drawImage(cv, 24, by + 132, iw, ih);
    g.fillStyle = col.dim; g.font = '11px Inter, sans-serif';
    g.fillText(fitT(g, 'Tek hat şeması ve analizör ekranı · değerler VoltSim hesap motorundandır.', R - 24), 24, H - 16);
  }
  function view2dHeight(W) { return 520; }

  /* ---------------------------------------------------------------- görevler */
  const tasks = [
    { id: 'rez', title: '5. harmonikte rezonans', goal: 'Reaktörsüz 300 kVAr banka, 630 kVA trafoyla 5. harmoniğe yakın rezonans yapıyor; THDv %8’i aşıyor. Bankayı koruyarak THDv’yi %5’in altına, kondansatör akımını 1,3·In’in altına indirin.', hint: 'Kondansatör bankasına tıklayın ve ayarlı reaktör ekleyin (p = %7): kol 189 Hz’e ayarlanır, paralel rezonans 4. harmoniğin altına iner.',
      state: { Sr_kVA: 630, p: 0, Qc_kvar: 300, spectrum: 'vfd6c', harm: Object.assign({}, Q.SPECTRA.vfd6c.h), P_kW: 300 },
      check: (r, s) => s.capOn && r.values.hm.THDv < 5 && r.values.capOver <= 1.3 },
    { id: 'notr', title: 'Ofiste nötr akımı', goal: 'SMPS ağırlıklı ofis yükünde nötr akımı faz akımını geçiyor. Nötr akımını faz akımı rms değerinin altına indirin (yük gücünü değiştirmeden).', hint: '3. harmonik sıfır bileşendir: kondansatör ya da reaktör onu azaltmaz. Yük spektrumunu karma tesis/doğrusal yüke çevirin (kaynağında azaltma: aktif PFC’li cihazlar).',
      state: { study: 'harmonik', spectrum: 'smps', harm: Object.assign({}, Q.SPECTRA.smps.h), P_kW: 120, capOn: false },
      check: (r, s) => s.P_kW === 120 && r.values.hm.Ineutral < r.values.hm.Irms },
    { id: 'cokme', title: 'Kontaktörler düşmesin', goal: 'Komşu OG fiderindeki 2 km uzaklıktaki arıza 150 ms sürüyor ve motor kontaktörleri bırakıyor. Koruma süresini değiştirmeden kontaktörlerin tutmasını sağlayın.', hint: 'Kontaktör bırakma gecikmesini (ör. gecikmeli bırakma rölesi/DC bobin) artırın ya da eşiği düşürün; gerçek tesiste UPS/kondansatörlü bobin tutucu da kullanılır.',
      state: { study: 'olay', view: 'event', event: 'og', faultKm: 2, sagMs: 150, dropPct: 70, dropMs: 15 },
      check: (r, s) => s.sagMs === 150 && s.event === 'og' && s.faultKm === 2 && !r.values.drops },
    { id: 'motor', title: 'Yol alma çökmesi %5’in altında', goal: '1000 kVA trafodan 200 kW motora doğrudan yol veriliyor (7·In); çökme %5’i aşıyor. Motor gücünü değiştirmeden çökmeyi %5’in altına indirin.', hint: 'Yol alma akımını düşürün: yıldız-üçgen (≈ 2·In), yumuşak yol verici (≈ 3·In) ya da sürücü; “Yol alma akımı” kaydırıcısını kullanın.',
      state: { study: 'olay', view: 'event', event: 'motor', Sr_kVA: 1000, motorKW: 200, kStart: 7 },
      check: (r, s) => s.motorKW === 200 && s.event === 'motor' && r.values.motor.dU < 5 },
    { id: 'denge', title: 'Gerilim dengesizliği %2’nin altında', goal: 'Tek fazlı kaynak makineleri bir fazı yüklüyor; VUF %2’yi aşıyor. Faz yüklerini dengeleyerek VUF’u %1’in altına indirin.', hint: 'Ubc düşük: tek fazlı yükleri fazlara eşit dağıtın (kaydırıcılarla gerilimleri birbirine yaklaştırın).',
      state: { study: 'denge', view: 'phasor', Uab: 404, Ubc: 382, Uca: 405 },
      check: r => r.values.VUF < 1 }
  ];

  /* ---------------------------------------------------------------- senaryolar */
  const sc = o => Object.assign(defaults(), o);
  VS.register({
    id: 'kalite', title: '3D Enerji Kalitesi Laboratuvarı',
    defaults: defaults,
    initLive: () => ({ phase: 'idle', t: 0, ph: 0, dropped: false }),
    autoRun: false,
    startText: 'Analizör kayıtta: dalga şekli kayar; çökme incelemesinde olay ağır çekimde oynatılır.',
    start: start,
    scenarios: [
      { id: 'ayarli', name: 'Fabrika · %7 ayarlı banka ve sürücüler', desc: '1000 kVA trafo, 400 kW 6 darbeli (DC şoklu) sürücü yükü, 300 kVAr %7 ayarlı banka: rezonans 5. harmoniğin altında.', state: defaults() },
      { id: 'rezonans', name: 'Reaktörsüz banka · 5. harmonikte rezonans', desc: '630 kVA trafo, 300 kVAr reaktörsüz banka: h_r = √(Ssc/Qc) ≈ 5,8 — 5. harmonik büyür, THDv ve kondansatör akımı sınırı aşılır.', state: sc({ Sr_kVA: 630, p: 0, spectrum: 'vfd6c', harm: Object.assign({}, Q.SPECTRA.vfd6c.h), P_kW: 300 }) },
      { id: 'ofis', name: 'Ofis binası · SMPS ve nötr akımı', desc: 'Tek fazlı bilgisayar ve LED yükleri: 3. harmonik nötrde toplanır; kondansatör bankası 3. harmoniği etkilemez.', state: sc({ spectrum: 'smps', harm: Object.assign({}, Q.SPECTRA.smps.h), P_kW: 150, capOn: false }) },
      { id: 'og', name: 'OG fider arızası · gerilim çökmesi', desc: 'Komşu fiderde 3 km uzakta üç faz arıza, 120 ms’de temizleniyor: kalan gerilim ve kontaktör davranışı.', state: sc({ study: 'olay', view: 'event', event: 'og', faultKm: 3, sagMs: 120 }) },
      { id: 'motor', name: 'Büyük motor yol alma', desc: '160 kW motor doğrudan yol alıyor (7·In, 3 s): trafo barasında uzun süreli çökme.', state: sc({ study: 'olay', view: 'event', event: 'motor', motorKW: 160, kStart: 7, motorMs: 3000, Sr_kVA: 630 }) },
      { id: 'denge', name: 'Dengesiz tek fazlı yükler', desc: 'Kaynak makineleri L2–L3 arasında: VUF ≈ %2,3, motorda negatif bileşen akımı.', state: sc({ study: 'denge', view: 'phasor', Uab: 404, Ubc: 384, Uca: 404 }) },
      { id: 'p14', name: 'p = %14 · 3. harmoniği olan karma tesis', desc: 'Karma yük; %14 ayar 134 Hz’de: 3. harmonik bölgesinde de endüktif kalır.', state: sc({ p: 14, spectrum: 'mix', harm: Object.assign({}, Q.SPECTRA.mix.h), P_kW: 500 }) }
    ],
    tasks: tasks,
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => (live.phase === 'event' ? { level: 'warn', text: 'Olay · %' + fmt(uAt(res.values, live.t), 0) } : live.dropped ? { level: 'bad', text: 'Kontaktörler bıraktı' } : null),
    reportInputs: s => [{ group: 'Harmonik spektrum', label: 'Yük akımı (% I1)', value: ORDERS.map(h => h + '.: ' + fmt(s.harm[h] || 0, 1)).join(' · ') }],
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-7, 6] },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
