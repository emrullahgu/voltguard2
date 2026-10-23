/* VoltSim · 3D Kompanzasyon ve Harmonik Simülasyonu
 * Hesap: VoltSimEngine.komp (Qc = P·(tanφ1 − tanφ2), kademe seçimi, trafo + kondansatör kolu empedans modeliyle
 * harmonik akım/gerilim dağılımı, paralel rezonans, EPDK reaktif oran kontrolü).
 * Sahne: hesap sonucunu gösterir (kademe kontaktörleri, kondansatörler, ayarlı reaktörler, röle ekranı, akış). */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt, Cx = E.C;
  const K = E.komp;

  /* ---------------------------------------------------------------- önayarlar */
  // Harmonik akımlar yük akımının temel bileşenine oranla (%). Değerler örnektir; gerçek tesis ölçülmelidir.
  const SPECTRA = {
    vfd6c: { label: '6 darbeli · DC şoklu', h: { 5: 33, 7: 11, 11: 7.5, 13: 5, 17: 3, 19: 2.5 } },
    vfd6: { label: '6 darbeli · şoksuz', h: { 5: 60, 7: 38, 11: 9, 13: 6, 17: 4, 19: 3 } },
    vfd12: { label: '12 darbeli', h: { 5: 3, 7: 2, 11: 8, 13: 5, 17: 1, 19: 1 } },
    mix: { label: 'Karma (%30 sürücü)', h: { 5: 10, 7: 3.3, 11: 2.3, 13: 1.5, 17: 0.9, 19: 0.8 } },
    none: { label: 'Harmoniksiz', h: { 5: 0, 7: 0, 11: 0, 13: 0, 17: 0, 19: 0 } }
  };
  const ORDERS = [5, 7, 11, 13, 17, 19];
  const DETUNE = [[0, 'Yok (reaktörsüz)'], [5.67, '%5,67 · 210 Hz'], [7, '%7 · 189 Hz'], [14, '%14 · 134 Hz']];
  // EN 50160 tekil harmonik gerilim sınırları (% U1) — yalnız grafik referansı
  const EN50160 = { 5: 6, 7: 5, 11: 3.5, 13: 3, 17: 2, 19: 1.5 };

  function defaults() {
    return {
      U_LL: 400, P_kW: 320, cos1: 0.72, cos2: 0.99, Qcap_kvar: 0, installed_kVA: 1000,
      Sr_kVA: 1000, uk: 6,
      detune: 7, mode: 'auto', delay_s: 20, discharge_s: 60, accel: 10, shunt_kvar: 0, doorOpen: true,
      steps: [10, 20, 40, 60, 60, 80], manualOn: [false, false, false, false, false, false], sel: 2,
      harmonics: Object.assign({}, SPECTRA.vfd6c.h)
    };
  }

  /* ---------------------------------------------------------------- hesap */
  function engineInput(s, manual) {
    return { U_LL: s.U_LL, P_kW: s.P_kW, cos1: s.cos1, cos2: s.cos2, Qcap_kvar: s.Qcap_kvar, Sr_kVA: s.Sr_kVA, uk: s.uk, detune: s.detune,
      steps: s.steps, manual: manual, shunt_kvar: s.shunt_kvar, harmonics: s.harmonics, installed_kVA: s.installed_kVA };
  }
  const manualArr = s => s.steps.map((_, i) => !!(s.manualOn || [])[i]);
  function newCtrl(on) { return { on: on.slice(), discharge: on.map(() => 0), pending: null, t: 0, msg: 'Hedef kombinasyon devrede' }; }
  /** Otomatik modda motorun seçtiği kombinasyon hedeftir; röle kademeleri tek tek, gecikmeyle ona yaklaştırır.
   *  Ara durumlar da motorla (manual = rölenin o anki kademeleri) hesaplanır. */
  function compute(s, app) {
    if (s.mode === 'manual') { const r = K.compute(engineInput(s, manualArr(s))); r.target = r.values.steps; return r; }
    const tgt = K.compute(engineInput(s, null));
    tgt.target = tgt.values.steps;
    const live = app && app.live;
    if (!live || !tgt.ok) return tgt;
    if (!live.ctrl || live.ctrl.on.length !== s.steps.length) { live.ctrl = newCtrl(tgt.target); return tgt; }
    if (live.ctrl.on.every((o, i) => o === tgt.target[i])) return tgt;
    const r = K.compute(engineInput(s, live.ctrl.on.slice()));
    r.target = tgt.target; r.targetQ = tgt.values.QcNom;
    return r;
  }
  const chk = (res, id) => res.checks.find(c => c.id === id);
  const lvOf = c => (!c ? undefined : c.status === 'fail' ? 'bad' : c.status === 'warn' ? 'warn' : c.status === 'ok' ? 'ok' : undefined);
  const stepI = (q, U) => E.currentFromS(q * 1e3, U);

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const r = app.validResult, c = app.live.ctrl;
    const groups = [];
    groups.push({ title: 'Tesis yükü', items: [
      { type: 'range', key: 'P_kW', label: 'Aktif güç P', min: 10, max: 3000, step: 5, unit: 'kW' },
      { type: 'range', key: 'cos1', label: 'Mevcut cosφ1 (kompanzasyonsuz)', min: 0.5, max: 0.99, step: 0.01, digits: 2 },
      { type: 'range', key: 'cos2', label: 'Hedef cosφ2', min: 0.9, max: 1, step: 0.005, digits: 3 },
      { type: 'range', key: 'Qcap_kvar', label: 'Tesisteki kapasitif yük (kablo, UPS, LED sürücü)', min: 0, max: 300, step: 1, unit: 'kVAr' },
      { type: 'select', key: 'U_LL', label: 'Bara gerilimi (faz arası)', options: [[400, '400 V'], [380, '380 V'], [415, '415 V'], [690, '690 V']] },
      { type: 'number', key: 'installed_kVA', label: 'Kurulu güç (EPDK oran sınırı için)', min: 1, max: 100000, step: 1, unit: 'kVA', help: 'Kurulu güç < 50 kVA: endüktif %33 / kapasitif %20; ≥ 50 kVA: %20 / %15 (EPDK 5999-3, Md. 13).' }
    ] });
    groups.push({ title: 'Besleme trafosu', items: [
      { type: 'select', key: 'Sr_kVA', label: 'Trafo anma gücü Sr', options: [250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500].map(v => [v, v + ' kVA']) },
      { type: 'range', key: 'uk', label: 'Kısa devre gerilimi uk', min: 4, max: 8, step: 0.5, unit: '%', digits: 1, help: 'Trafo reaktansı Xs = uk·U²/Sr; paralel rezonans mertebesini belirler.' }
    ] });
    groups.push({ title: 'Kompanzasyon panosu', items: [
      { type: 'select', key: 'detune', label: 'Ayarlı (detuned) reaktör oranı p', options: DETUNE, rebuild: true, help: 'p > 0: her kademe seri reaktörle 5. harmoniğin altına ayarlanır (f_r = 50/√p Hz).' },
      { type: 'seg', key: 'mode', label: 'Reaktif güç rölesi', options: [['auto', 'Otomatik'], ['manual', 'Manuel']], onChange: (v, a) => {
        if (v === 'auto') { a.live.ctrl = newCtrl(manualArr(a.state)); }
        else if (a.live.ctrl) a.state.manualOn = a.live.ctrl.on.slice();
        a.renderControls(); a.invalidate();
      } },
      s.mode === 'auto' ? { type: 'range', key: 'delay_s', label: 'Anahtarlama gecikmesi', min: 5, max: 120, step: 5, unit: 's' } : null,
      s.mode === 'auto' ? { type: 'range', key: 'discharge_s', label: 'Yeniden kapama (deşarj) kilidi', min: 10, max: 180, step: 5, unit: 's', help: 'Kondansatör, deşarj olmadan yeniden devreye alınmaz (IEC 60831-1: 3 dk içinde ≤ 75 V; röle kilidi bu süreyi uygular).' } : null,
      s.mode === 'auto' ? { type: 'select', key: 'accel', label: 'Simülasyon zaman ölçeği', options: [[1, 'Gerçek zaman (×1)'], [5, '×5'], [10, '×10'], [30, '×30']] } : null,
      { type: 'range', key: 'shunt_kvar', label: 'Şönt reaktör', min: 0, max: 100, step: 2.5, unit: 'kVAr', digits: 1, rebuild: true, help: 'Kapasitif yük fazlasını (uzun kablolar, hafif yük) dengeler.' },
      { type: 'toggle', key: 'doorOpen', label: 'Pano kapakları açık' }
    ] });
    groups.push({ title: 'Kademeler', items: [
      { type: 'custom', render: (box, a) => {
        const list = VS.el('div', { class: 'vs-cl' });
        const act = r && r.values.steps;
        s.steps.forEach((q, i) => {
          const on = act ? !!act[i] : false;
          const pend = s.mode === 'auto' && c && c.pending && c.pending.i === i;
          const tgt = r && r.target ? !!r.target[i] : on;
          const row = VS.el('div', { class: 'vs-cl__row' + (i === s.sel ? ' is-sel' : ''), 'data-level': pend || tgt !== on ? 'warn' : on ? 'ok' : '' });
          const pick = VS.el('button', { type: 'button', class: 'vs-cl__name', 'aria-pressed': i === s.sel ? 'true' : 'false', title: 'Düzenle' }, [
            VS.el('i', { 'aria-hidden': 'true', style: on ? null : 'background:#475569' }),
            VS.el('span', { text: 'K' + (i + 1) + ' · ' + fmt(q, q % 1 ? 1 : 0, 'kVAr') }),
            VS.el('small', { text: (on ? 'devrede' : 'devre dışı') + ' · Ic ' + fmt(stepI(q, s.U_LL), 1, 'A') + (pend ? ' · röle bekliyor' : '') })
          ]);
          pick.onclick = () => { a.state.sel = i; a.renderControls(); };
          const sw = VS.el('button', { type: 'button', class: 'vs-cl__sw', 'aria-pressed': on ? 'true' : 'false', disabled: s.mode === 'auto' ? true : undefined,
            'aria-label': 'Kademe ' + (i + 1) + (on ? ' devreden çıkar' : ' devreye al'), title: s.mode === 'auto' ? 'Otomatik modda röle anahtarlar' : null, text: s.mode === 'auto' ? (on ? 'OTO ●' : 'OTO') : (on ? 'Açık' : 'Kapalı') });
          sw.onclick = () => { const m = manualArr(a.state); m[i] = !m[i]; a.state.manualOn = m; a.renderControls(); a.invalidate(); };
          row.appendChild(pick); row.appendChild(sw);
          list.appendChild(row);
        });
        box.appendChild(list);
        const add = VS.el('div', { class: 'vs-btns' });
        add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: '+ Kademe', onclick: () => {
          if (a.state.steps.length >= 12) { VS.toast('En çok 12 kademe eklenebilir.'); return; }
          a.state.steps.push(25); a.state.manualOn = manualArr(a.state).concat([false]); a.state.sel = a.state.steps.length - 1; a.renderControls(); a.invalidate();
        } }));
        add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: '1:2:4:4… dizisi', title: 'Toplam gücü koruyarak ikili kademe dizisi oluştur', onclick: () => {
          const tot = a.state.steps.reduce((x, y) => x + y, 0), n = Math.max(4, Math.min(8, a.state.steps.length));
          const w = [1, 2, 4].concat(Array(n - 3).fill(4)), sw = w.reduce((x, y) => x + y, 0);
          a.state.steps = w.map(k => Math.max(2.5, Math.round(tot * k / sw / 2.5) * 2.5)); a.state.manualOn = a.state.steps.map(() => false); a.state.sel = 0; a.renderControls(); a.invalidate();
        } }));
        box.appendChild(add);
      } },
      s.steps.length ? { type: 'range', key: 'steps.' + Math.min(s.sel, s.steps.length - 1), label: 'K' + (Math.min(s.sel, s.steps.length - 1) + 1) + ' kademe gücü (anma)', min: 2.5, max: 200, step: 2.5, unit: 'kVAr', digits: 1, report: false } : null,
      { type: 'buttons', items: [{ label: 'Seçili kademeyi sil', variant: 'danger', onClick: a => {
        if (a.state.steps.length <= 1) return;
        const i = Math.min(a.state.sel, a.state.steps.length - 1), m = manualArr(a.state);
        a.state.steps.splice(i, 1); m.splice(i, 1); a.state.manualOn = m; a.state.sel = Math.max(0, i - 1); a.renderControls(); a.invalidate();
      } }] },
      r ? { type: 'note', html: 'Gerekli <b>' + fmt(r.values.Qneed, 1, 'kVAr') + '</b> · kurulu <b>' + fmt(s.steps.reduce((x, y) => x + y, 0), 1, 'kVAr') + '</b> · röle hedefi <b>' + fmt(r.targetQ !== undefined ? r.targetQ : r.values.QcNom, 1, 'kVAr') + '</b>' } : null
    ] });
    groups.push({ title: 'Harmonik spektrum', collapsed: false, summary: 'Yük harmonik akımları (% I1)', items: [
      { type: 'note', text: 'Varsayılan: örnek 6 darbeli sürücü spektrumu (DC şoklu). Değerler yük akımının temel bileşenine oranladır; gerçek tesis için ölçüm (TS EN 61000-4-30 sınıf A) gerekir.' },
      { type: 'buttons', items: Object.keys(SPECTRA).map(k => ({ label: SPECTRA[k].label, onClick: a => { a.state.harmonics = Object.assign({}, SPECTRA[k].h); a.renderControls(); a.invalidate(); } })) }
    ].concat(ORDERS.map(h => ({ type: 'number', key: 'harmonics.' + h, label: h + '. harmonik (' + h * 50 + ' Hz)', min: 0, max: 100, step: 0.5, unit: '%', digits: 1 }))) });
    return groups;
  }

  /* ---------------------------------------------------------------- röle zaman davranışı */
  function start(app) {
    if (!app._kompBooted) { app._kompBooted = true; return; } // sayfa açılışında oturmuş durumdan başla
    const s = app.state;
    app.live.hist = []; app.live.histT = 0;
    if (s.mode === 'manual') { app.live.events.push('Manuel mod: kademeleri listeden açıp kapatın.'); return; }
    app.live.ctrl = newCtrl(s.steps.map(() => false));
    app.live.ctrl.msg = 'Röle ölçüyor…';
    app.live.events.push('Röle sıfırlandı: tüm kademeler devre dışı, hedef kombinasyona kademe kademe gidiliyor.');
    if (VS.app === app) app.renderControls();
    app.invalidate();
  }
  function tick(app, dt) {
    const s = app.state, L = app.live, res = app.validResult;
    if (!res) return false;
    let changed = false;
    L.histT += dt;
    if (L.histT > 0.25) { L.histT = 0; L.hist.push([L.ctrl ? L.ctrl.t : app.simTime, res.values.Qnet]); if (L.hist.length > 240) L.hist.shift(); changed = true; }
    const c = L.ctrl;
    if (s.mode !== 'auto' || !c || !res.target || c.on.length !== s.steps.length) return changed;
    const sdt = dt * (s.accel || 1);
    c.t += sdt;
    c.discharge = c.discharge.map(x => Math.max(0, x - sdt));
    const tgt = res.target, bySize = (a, b) => s.steps[b] - s.steps[a];
    // önce fazla kademeler çıkarılır (aşırı kompanzasyona gitmemek için), sonra büyükten küçüğe eklenir
    const offs = c.on.map((o, i) => i).filter(i => c.on[i] && !tgt[i]).sort(bySize);
    const ons = c.on.map((o, i) => i).filter(i => !c.on[i] && tgt[i]).sort(bySize);
    const act = offs.length ? { i: offs[0], on: false } : ons.length ? { i: ons[0], on: true } : null;
    if (!act) {
      if (c.pending || c.msg !== 'Hedef kombinasyon devrede') { c.pending = null; c.msg = 'Hedef kombinasyon devrede'; changed = true; if (VS.app === app) app.renderControls(); }
      return changed;
    }
    if (!c.pending || c.pending.i !== act.i || c.pending.on !== act.on) { c.pending = { i: act.i, on: act.on, left: s.delay_s }; if (VS.app === app) app.renderControls(); }
    const p = c.pending;
    p.left = Math.max(0, p.left - sdt);
    const dis = p.on ? c.discharge[p.i] : 0;
    const name = 'Kademe ' + (p.i + 1) + ' (' + fmt(s.steps[p.i], s.steps[p.i] % 1 ? 1 : 0) + ' kVAr)';
    if (p.left <= 0 && dis <= 0) {
      c.on[p.i] = p.on;
      if (!p.on) c.discharge[p.i] = s.discharge_s;
      L.events.push('t = ' + fmt(c.t, 0) + ' s · ' + name + (p.on ? ' devreye alındı' : ' devreden çıkarıldı'));
      c.pending = null;
      app.invalidate();
      if (VS.app === app) app.renderControls();
    } else {
      c.msg = 'Kademe ' + (p.i + 1) + (p.on ? ' devreye: ' : ' devreden çıkıyor: ') + (p.left > 0 ? fmt(p.left, 0) + ' s bekleme' : '') + (dis > 0 ? (p.left > 0 ? ' · ' : '') + 'deşarj kilidi ' + fmt(dis, 0) + ' s' : '');
    }
    return true;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live) {
    const v = res.values;
    const onN = v.steps.filter(Boolean).length;
    const regC = chk(res, 'reg'), thdC = chk(res, 'thdv'), capC = chk(res, 'capI'), resC = chk(res, 'res') || chk(res, 'tune'), cosC = chk(res, 'cos');
    const out = [
      { label: 'Endüktif reaktif güç Ql', value: fmt(v.Ql, 1, 'kVAr'), sub: 'P = ' + fmt(s.P_kW, 0, 'kW') + ' · cosφ1 ' + fmt(s.cos1, 2) },
      { label: 'Gerekli Qc', value: fmt(v.Qneed, 1, 'kVAr'), sub: 'cosφ ' + fmt(s.cos1, 2) + ' → ' + fmt(s.cos2, 3) },
      { label: 'Devredeki Qc', value: fmt(v.QcNom, 1, 'kVAr'), sub: onN + '/' + s.steps.length + ' kademe · kurulu ' + fmt(s.steps.reduce((a, b) => a + b, 0), 1, 'kVAr') },
      { label: 'Net reaktif güç', value: fmt(v.Qnet, 1, 'kVAr'), sub: v.state, level: v.Qnet < 0 ? 'warn' : undefined },
      { label: 'Yeni cosφ', value: fmt(v.cosNew, 3) + (v.Qnet < 0 ? ' kap.' : ' end.'), level: lvOf(cosC) },
      { label: 'Reaktif / aktif oranı', value: '%' + fmt(Math.abs(v.reRatio), 1) + (v.reRatio < 0 ? ' kap.' : ' end.'), sub: 'EPDK sınırı %' + (v.reRatio < 0 ? v.reLimit.cap : v.reLimit.ind), level: lvOf(regC) },
      { label: 'THDi · yük', value: '%' + fmt(v.THDiLoad, 1), sub: 'I1 = ' + fmt(v.I1, 0, 'A') },
      { label: 'THDi · şebeke (trafo)', value: '%' + fmt(v.THDiSupply, 1), level: v.THDiSupply > v.THDiLoad * 1.05 ? 'warn' : undefined, sub: v.THDiSupply > v.THDiLoad ? 'kondansatör harmonikleri büyütüyor' : 'kondansatör kolu harmonik çekiyor' },
      { label: 'THDv · AG bara', value: '%' + fmt(v.THDv, 2), level: lvOf(thdC), sub: 'EN 50160 istatistiksel sınır %8' },
      v.QcNom > 0 ? { label: 'Paralel rezonans', value: 'h ≈ ' + fmt(v.hPar, 2) + ' · ' + fmt(v.hPar * 50, 0, 'Hz'), level: lvOf(resC), sub: s.detune > 0 ? 'kol ayarı ' + fmt(v.hRes * 50, 0) + ' Hz (p %' + fmt(s.detune, s.detune % 1 ? 2 : 0) + ')' : 'reaktörsüz grup' }
        : { label: 'Paralel rezonans', value: '—', sub: 'devrede kondansatör yok' },
      { label: 'Kondansatör akımı', value: v.QcNom > 0 ? fmt(v.capOver, 2) + ' × In' : '—', level: lvOf(capC), sub: 'IEC 60831-1: sürekli ≤ 1,3·In' },
      { label: 'Akım azalması', value: '%' + fmt((1 - v.Inew / v.I1) * 100, 1), sub: fmt(v.I1, 0) + ' A → ' + fmt(v.Inew, 0) + ' A', level: v.Inew < v.I1 ? 'ok' : undefined }
    ];
    if (s.shunt_kvar > 0) out.push({ label: 'Şönt reaktör', value: fmt(s.shunt_kvar, 1, 'kVAr'), sub: 'endüktif katkı' });
    const c = live.ctrl;
    out.push({ label: 'Reaktif güç rölesi', wide: true, value: s.mode === 'manual' ? 'Manuel mod' : c ? c.msg : '—',
      level: s.mode === 'auto' && c && c.pending ? 'warn' : undefined,
      sub: live.events.length ? live.events[live.events.length - 1] : (s.mode === 'auto' ? 'Gecikme ' + s.delay_s + ' s · deşarj kilidi ' + s.discharge_s + ' s · ölçek ×' + s.accel : 'Kademeleri listeden anahtarlayın') });
    return out;
  }

  /** Bara empedansı |Z(h)|: motorla aynı model (Zs = Rs + j·h·Xs, Rs = Xs/8; Zc = Rc(h) + j(h·p·Xc − Xc/h), Rc = 0,003·h·Xc). */
  function busZ(v, p, h) {
    const Zs = Cx.of(v.Xs / 8, h * v.Xs);
    if (!isFinite(v.Xc)) return { Z: Cx.abs(Zs), Zs: Cx.abs(Zs) };
    const Zc = Cx.of(v.Xc * 0.003 * h, h * p * v.Xc - v.Xc / h);
    return { Z: Cx.abs(Cx.div(Cx.mul(Zs, Zc), Cx.add(Zs, Zc))), Zs: Cx.abs(Zs) };
  }
  function charts(res, s, live) {
    const v = res.values, sp = v.spectrum, I1 = v.I1 || 1;
    const idx = sp.map((x, i) => i + 1), xs = { min: 0.4, max: sp.length + 0.6, ticks: idx, fmt: x => sp[x - 1] ? String(sp[x - 1].h) : '', label: 'h' };
    const ch = [];
    ch.push({ id: 'spec', title: 'Harmonik akım spektrumu · yük ve şebeke (% I1)', height: 160,
      series: [
        { name: 'Yük Ih', type: 'bar', color: 'grey', width: 0.36, offset: -0.5, data: sp.map((x, i) => [i + 1, x.Iload / I1 * 100]) },
        { name: 'Şebeke (trafo) Ih', type: 'bar', color: 'violet', width: 0.36, offset: 0.5, data: sp.map((x, i) => [i + 1, x.Isupply / I1 * 100]) }
      ], x: xs, y: { label: '%' },
      alt: sp.map(x => x.h + '. harmonik: yük %' + fmt(x.Iload / I1 * 100, 1) + ', şebeke %' + fmt(x.Isupply / I1 * 100, 1)).join('; ') + '. THDi yük %' + fmt(v.THDiLoad, 1) + ', şebeke %' + fmt(v.THDiSupply, 1) + '.' });
    ch.push({ id: 'vh', title: 'Bara harmonik gerilimleri Vh (% U1)', height: 140,
      series: [
        { name: 'Vh (hesap)', type: 'bar', color: 'amber', width: 0.5, data: sp.map((x, i) => [i + 1, x.VhPct]) },
        { name: 'EN 50160 tekil sınır', color: 'red', dash: [4, 3], width: 1.5, data: sp.map((x, i) => [i + 1, EN50160[x.h] || 0]) }
      ], x: xs, y: { label: '%', min: 0 },
      alt: sp.map(x => x.h + '.: %' + fmt(x.VhPct, 2)).join(', ') + '. THDv %' + fmt(v.THDv, 2) + '.' });
    // bara empedansı ve rezonans
    const p = s.detune / 100, zs = [], zc = [];
    let zmax = 0;
    for (let h = 1; h <= 25.0001; h += 0.1) { const z = busZ(v, p, h); zs.push([h, z.Zs * 1e3]); zc.push([h, z.Z * 1e3]); zmax = Math.max(zmax, z.Z * 1e3); }
    const cap = Math.max(25 * v.Xs * 1e3 * 2.2, 1);
    const ymax = Math.min(zmax, cap) * 1.08;
    ch.push({ id: 'zbus', title: 'Bara empedansı |Z(h)| · paralel rezonans', height: 170,
      series: [
        { name: 'Yalnız trafo |Zs|', color: 'grey', dash: [5, 4], width: 1.5, data: zs },
        { name: 'Trafo ∥ kondansatör kolu', color: 'cyan', area: true, data: zc.map(d => [d[0], Math.min(d[1], ymax)]) }
      ],
      markers: v.QcNom > 0 ? [{ x: v.hPar, label: 'h ≈ ' + fmt(v.hPar, 1) + ' (' + fmt(v.hPar * 50, 0) + ' Hz)', color: '#fcd34d' }] : [],
      x: { min: 1, max: 25, ticks: [1, 3, 5, 7, 11, 13, 17, 19, 23, 25], label: 'h' }, y: { label: 'mΩ', min: 0, max: ymax },
      alt: 'Trafo reaktansı Xs = ' + fmt(v.Xs * 1e3, 2) + ' mΩ. ' + (v.QcNom > 0 ? 'Paralel rezonans h ≈ ' + fmt(v.hPar, 2) + '; tepe empedans ' + fmt(zmax, 1) + ' mΩ' + (zmax > ymax ? ' (grafikte kırpıldı)' : '') + '.' : 'Devrede kondansatör yok.') });
    const Qb = v.Ql - s.Qcap_kvar;
    ch.push({ id: 'pq', title: 'Güç üçgeni · kompanzasyon öncesi / sonrası', height: 150,
      series: [
        { name: 'Önce', type: 'bar', color: 'grey', width: 0.36, offset: -0.5, data: [[1, s.P_kW], [2, Qb], [3, Math.hypot(s.P_kW, Qb)]] },
        { name: 'Sonra', type: 'bar', color: 'green', width: 0.36, offset: 0.5, data: [[1, s.P_kW], [2, v.Qnet], [3, v.S]] }
      ],
      x: { min: 0.4, max: 3.6, ticks: [1, 2, 3], fmt: x => ['', 'P (kW)', 'Q (kVAr)', 'S (kVA)'][x] || '' }, y: { label: 'kW / kVAr / kVA' },
      alt: 'Önce Q ' + fmt(Qb, 1) + ' kVAr, S ' + fmt(Math.hypot(s.P_kW, Qb), 1) + ' kVA; sonra Q ' + fmt(v.Qnet, 1) + ' kVAr, S ' + fmt(v.S, 1) + ' kVA.' });
    if (live.hist.length > 2) ch.push({ id: 'trend', title: 'Röle davranışı · şebekeden çekilen Q (simülasyon zamanı)', series: [{ name: 'Q net (kVAr)', color: 'amber', area: true, data: live.hist.slice() }],
      hLines: [{ y: 0, label: 'Q = 0', color: '#94a3b8' }], x: { label: 's' }, y: { label: 'kVAr' }, alt: 'Kademeler devreye girdikçe şebekeden çekilen reaktif güç basamaklı olarak azalır.' });
    return ch;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  const S = { w: 0.8, h: 2.0, d: 0.6, plinth: 0.1 };
  const Y = { bus: 2.0, fuse: 1.85, cont: 1.64, can: 1.2, reac: 0.48 };
  function rebuildOn(s) { return s.steps.join(',') + '|' + (s.detune > 0) + '|' + (s.shunt_kvar > 0) + '|' + s.Sr_kVA; }
  const cansOf = q => Math.max(1, Math.min(4, Math.ceil(q / 25)));

  /** Tekrarlanan parçalar için InstancedMesh: list = [{p:[x,y,z], s:[sx,sy,sz], r:[rx,ry,rz]}]. */
  function inst(k, geo, mat, list, parent) {
    const T = k.T, im = new T.InstancedMesh(geo, mat, Math.max(1, list.length)), d = new T.Object3D();
    list.forEach((it, i) => { d.position.fromArray(it.p); d.rotation.set(...(it.r || [0, 0, 0])); d.scale.fromArray(it.s || [1, 1, 1]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.count = list.length; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true;
    parent.add(im); return im;
  }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    const n = s.steps.length, nSec = Math.ceil(n / 2) + 1;
    const W = nSec * S.w, x0 = -W / 2;
    const sc = { steps: [], doors: [], fans: [], ledsDoor: [], secLbl: [] };
    app.scene3 = sc;
    const det = s.detune > 0;
    // zemin, duvar
    k.ground(40, k.mat(0x4a525b, { roughness: 0.45, metalness: 0.1 }), 0);
    const grid = new T.GridHelper(40, 80, 0x3d4650, 0x3d4650); grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.22; grid.userData.noClip = true; v.root.add(grid);
    const wall = k.box(W + 12, 3.4, 0.1, k.mat(0x8b96a3, { roughness: 0.9 }), 0, 1.7, -0.62); wall.userData.noClip = true;

    // ---- gövde
    const body = k.group(null, 0, 0, 0);
    k.box(W, S.plinth, S.d - 0.02, M.plasticDark, 0, S.plinth / 2, 0, body);
    k.shell(k.box(W + 0.02, 0.03, S.d + 0.02, M.panelRAL7035, 0, S.plinth + S.h + 0.015, 0, body));
    k.box(W, S.h, 0.02, M.panelRAL7035, 0, S.plinth + S.h / 2, -S.d / 2 + 0.01, body);
    k.shell(k.box(0.02, S.h, S.d, M.panelRAL7035, x0 + 0.01, S.plinth + S.h / 2, 0, body));
    k.shell(k.box(0.02, S.h, S.d, M.panelRAL7035, -x0 - 0.01, S.plinth + S.h / 2, 0, body));
    for (let i = 1; i < nSec; i++) { k.box(0.025, S.h, 0.03, M.darkSteel, x0 + i * S.w, S.plinth + S.h / 2, S.d / 2 - 0.02, body); k.box(0.006, S.h - 0.1, S.d - 0.1, M.galv, x0 + i * S.w, S.plinth + S.h / 2, -0.02, body); }
    // ana baralar (L1-L2-L3), arka üst
    const busMat = M.copper;
    for (let j = 0; j < 3; j++) k.box(W - 0.06, 0.03, 0.008, busMat, 0, Y.bus - j * 0.05, -0.24, body);
    for (let x = x0 + 0.1; x < -x0; x += 0.8) k.box(0.035, 0.17, 0.04, M.plasticRed, x, Y.bus - 0.05, -0.265, body);

    // katmanlar (patlatılmış görünüm: anahtarlama → kondansatör → reaktör)
    const gSw = k.group(body), gCap = k.group(body), gReac = k.group(body);
    k.explodable(gSw, [0, 0, 0.6]); k.explodable(gCap, [0, 0, 0.38]); k.explodable(gReac, [0, 0, 0.18]);
    const hitMat = new T.MeshBasicMaterial({ visible: false });
    const fuseList = [], canList = [], capTop = [], coilList = [];
    const canGeo = new T.CylinderGeometry(0.042, 0.042, 0.25, 22), capGeo = new T.CylinderGeometry(0.03, 0.034, 0.026, 14);
    const fuseGeo = new T.BoxGeometry(0.03, 0.064, 0.032), coilGeo = new T.CylinderGeometry(0.044, 0.044, 0.17, 22, 1, true), coilEndGeo = new T.CylinderGeometry(0.044, 0.044, 0.004, 22);
    const coilMat = k.mat(0x9a5a2e, { roughness: 0.42, metalness: 0.55 });

    // ---- bölüm kapakları
    for (let si = 0; si < nSec; si++) {
      const cx = x0 + S.w * (si + 0.5);
      const g = k.group(body, cx, 0, 0);
      k.box(S.w - 0.08, S.h - 0.3, 0.01, M.galv, 0, S.plinth + (S.h - 0.3) / 2 + 0.05, -S.d / 2 + 0.035, g);
      if (si === 0) {
        // giriş bölümü: sabit üst ön levha (röle, yük ayırıcı kolu) + alt kapak
        const plate = k.box(S.w - 0.02, 0.62, 0.02, M.panelRAL7035, 0, 1.79, S.d / 2 + 0.01, g); k.shell(plate);
        const pivot = k.group(g, -S.w / 2 + 0.01, 0, S.d / 2);
        k.shell(k.box(S.w - 0.02, 1.36, 0.022, M.panelRAL7035, S.w / 2 - 0.01, S.plinth + 0.68 + 0.01, 0.011, pivot));
        k.box(0.02, 0.14, 0.03, M.plasticDark, S.w - 0.07, 0.9, 0.035, pivot);
        for (let r = 0; r < 7; r++) k.box(0.3, 0.008, 0.004, M.darkSteel, S.w / 2, S.plinth + 0.12 + r * 0.025, 0.024, pivot);
        sc.doors.push(pivot);
      } else {
        const pivot = k.group(g, -S.w / 2 + 0.01, 0, S.d / 2);
        k.shell(k.box(S.w - 0.02, S.h - 0.02, 0.022, M.panelRAL7035, S.w / 2 - 0.01, S.plinth + S.h / 2, 0.011, pivot));
        k.box(0.02, 0.16, 0.03, M.plasticDark, S.w - 0.07, S.plinth + S.h / 2, 0.035, pivot);
        for (let r = 0; r < 7; r++) k.box(0.3, 0.008, 0.004, M.darkSteel, S.w / 2, S.plinth + 0.12 + r * 0.025, 0.024, pivot);
        // kademe sinyal lambaları kapakta
        sc.doors.push(pivot);
        // çatı fanı: davlumbaz + ızgara + pervane
        const fan = k.group(g, 0, S.plinth + S.h + 0.03, -0.02);
        k.box(0.34, 0.1, 0.02, M.panelRAL7035, 0, 0.05, 0.16, fan); k.box(0.34, 0.1, 0.02, M.panelRAL7035, 0, 0.05, -0.16, fan);
        k.box(0.02, 0.1, 0.34, M.panelRAL7035, 0.16, 0.05, 0, fan); k.box(0.02, 0.1, 0.34, M.panelRAL7035, -0.16, 0.05, 0, fan);
        for (let r = 0; r < 9; r++) k.box(0.3, 0.006, 0.012, M.darkSteel, 0, 0.1, -0.13 + r * 0.032, fan);
        const imp = k.group(fan, 0, 0.05, 0);
        for (let b = 0; b < 5; b++) { const bl = k.box(0.12, 0.006, 0.04, M.plasticDark, 0.06, 0, 0, null); const arm = new T.Group(); arm.rotation.y = b / 5 * Math.PI * 2; bl.rotation.x = 0.35; arm.add(bl); imp.add(arm); }
        k.cyl(0.025, 0.025, 0.03, M.plasticDark, 0, 0.05, 0, fan, 12);
        k.pickable(fan, 'Çatı fanı (termostatlı)', () => ['Kondansatör ömrü sıcaklığa çok duyarlıdır: ortam ≤ 40 °C (IEC 60831-1 sıcaklık sınıfı −25/D).', 'Ayarlı reaktör kayıpları kondansatör kayıplarının birkaç katıdır; cebri havalandırma gerekir.']);
        sc.fans.push({ imp: imp, sec: si });
      }
      const tag = k.screen(0.2, 0.045, 256, (gx, w, h) => { gx.fillStyle = '#f4f4f0'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#111'; gx.font = 'bold 26px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText(si === 0 ? '+K0 GİRİŞ' : '+K' + si + ' KADEME', w / 2, h / 2); }, sc.doors[si]);
      tag.position.set(S.w / 2, si === 0 ? 1.32 : S.plinth + S.h - 0.12, 0.024);
    }
    // isim plakası
    const nm = k.screen(Math.min(1.3, W * 0.5), 0.09, 512, (gx, w, h) => { gx.fillStyle = '#0a1628'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#fcd34d'; gx.font = 'bold 38px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText(det ? 'HARMONİK FİLTRELİ KOMPANZASYON' : 'KOMPANZASYON PANOSU', w / 2, h / 2); });
    nm.position.set(0, S.plinth + S.h + 0.075, S.d / 2 - 0.02);

    // ---- giriş bölümü içi
    const xi = x0 + S.w / 2;
    const ld = k.group(gSw, xi, 1.7, -0.14);
    k.rbox(0.34, 0.26, 0.16, 0.012, M.plasticDark, 0, 0, 0, ld);
    for (let j = 0; j < 3; j++) { fuseList.push({ p: [xi - 0.1 + j * 0.1, 1.7, -0.05] }); }
    k.pickable(ld, 'Sigortalı yük ayırıcı (giriş)', () => { const r = app.validResult && app.validResult.values; const tot = s.steps.reduce((a, b) => a + b, 0); return ['Pano toplam kurulu gücü ' + fmt(tot, 1, 'kVAr') + ' · anma akımı ≈ ' + fmt(stepI(tot, s.U_LL), 0, 'A'), 'Kondansatör devreleri harmonik ve tolerans payı nedeniyle ≥ 1,3·In akım taşıyacak şekilde boyutlandırılır.', r ? 'Devredeki Qc: ' + fmt(r.QcNom, 1, 'kVAr') : '']; });
    // kontrol sigortaları
    for (let j = 0; j < 4; j++) k.rbox(0.017, 0.085, 0.07, 0.004, M.plasticWhite, xi - 0.15 + j * 0.019, 1.3, -0.22, gSw);
    k.box(S.w - 0.16, 0.035, 0.008, M.galv, xi, 1.3, -0.26, body);
    // giriş kablosu (üstten)
    k.tube([[xi + 0.12, 2.5, -0.16], [xi + 0.12, 2.13, -0.16], [xi + 0.1, 1.86, -0.15]], 0.028, M.cableBlack, body);
    // ön levha: röle ekranı, kademe lambaları, döner kol
    const fr = sc.doors[0].parent; void fr;
    const relayG = k.group(body, xi - 0.12, 1.86, S.d / 2 + 0.02);
    k.box(0.15, 0.15, 0.012, M.plasticDark, 0, 0, 0, relayG);
    const scr = k.screen(0.128, 0.104, 256, (gx, w, h) => drawRelay(gx, w, h, app), relayG, { emissive: 0.9 });
    scr.position.set(0, 0.012, 0.0065);
    for (let j = 0; j < 4; j++) k.box(0.018, 0.01, 0.004, M.plasticGrey, -0.045 + j * 0.03, -0.062, 0.008, relayG);
    sc.relay = scr;
    k.pickable(relayG, 'Reaktif güç rölesi', () => { const r = app.validResult && app.validResult.values, c = app.live.ctrl; return r ? ['Ölçüm: tek akım trafosu (L1) + gerilim; cosφ = ' + fmt(r.cosNew, 3) + ' (' + r.state + ')', 'Mod: ' + (s.mode === 'auto' ? 'otomatik · gecikme ' + s.delay_s + ' s · deşarj kilidi ' + s.discharge_s + ' s' : 'manuel'), s.mode === 'auto' && c ? c.msg : '', 'Hedef cosφ ' + fmt(s.cos2, 3) + ' · aşırı kompanzasyon yapmayan en yakın kombinasyon (motor seçimi)'] : []; });
    k.label('Reaktif güç rölesi', relayG, [0, 0.11, 0.02], 'vs-label--sm');
    // kademe lambaları (ön levhada, 2 sıra × 6)
    for (let i = 0; i < n; i++) sc.ledsDoor.push(k.sphere(0.009, M.ledOff, xi + 0.04 + (i % 6) * 0.045, 1.9 - Math.floor(i / 6) * 0.045, S.d / 2 + 0.025, body));
    // döner kol (yük ayırıcı)
    const rot = k.group(body, xi + 0.2, 1.66, S.d / 2 + 0.02);
    k.box(0.09, 0.09, 0.008, M.plasticYellow, 0, 0, 0, rot);
    const knob = k.box(0.022, 0.08, 0.03, M.plasticRed, 0, 0, 0.018, rot); void knob;
    k.cyl(0.02, 0.02, 0.025, M.plasticRed, 0, 0, 0.012, rot, 14).rotation.x = Math.PI / 2;

    // ---- kademeler
    s.steps.forEach((q, i) => {
      const si = 1 + Math.floor(i / 2), col = i % 2;
      const cx = x0 + S.w * (si + 0.5) + (col ? 0.19 : -0.19);
      // bara bağlantısı
      k.box(0.012, Y.bus - Y.fuse - 0.03, 0.006, M.copper, cx - 0.04, (Y.bus + Y.fuse) / 2, -0.23, body);
      // NH00 sigorta altlığı + 3 buşon
      const fb = k.box(0.16, 0.12, 0.03, M.plasticDark, cx, Y.fuse, -0.2, gSw);
      void fb;
      for (let j = 0; j < 3; j++) fuseList.push({ p: [cx - 0.05 + j * 0.05, Y.fuse, -0.17] });
      // kondansatör kontaktörü (ön yükleme dirençli yardımcı blok)
      const cg = k.group(gSw, cx, Y.cont, -0.17);
      k.rbox(0.1, 0.13, 0.11, 0.008, M.plasticGrey, 0, 0, 0, cg);
      k.box(0.09, 0.035, 0.03, M.plasticDark, 0, 0.075, 0.02, cg); // ön yükleme direnç bloğu
      for (let j = 0; j < 3; j++) k.box(0.006, 0.02, 0.006, M.copper, -0.03 + j * 0.03, 0.075, 0.04, cg);
      k.box(0.07, 0.05, 0.004, M.plasticWhite, 0, -0.015, 0.057, cg);
      const ind = k.box(0.022, 0.014, 0.008, M.ledOff, 0, 0.02, 0.058, cg);
      const hit = k.box(0.18, 0.32, 0.14, hitMat, 0, -0.03, 0, cg, { noShadow: true }); hit.castShadow = false; hit.receiveShadow = false;
      k.pickable(cg, 'K' + (i + 1) + ' · kademe kontaktörü', () => stepInfo(app, i, 'cont'));
      if (!col) sc.secLbl[si] = k.label('K' + (i + 1), null, [x0 + S.w * (si + 0.5), Y.cont + 0.17, -0.1], 'vs-label--sm');
      // kondansatör kapları
      const nc = cansOf(q), sz = 0.8 + Math.min(q / nc, 50) / 50 * 0.25;
      const cans = [];
      for (let j = 0; j < nc; j++) {
        const x = cx + (j - (nc - 1) / 2) * 0.088;
        cans.push(canList.length);
        canList.push({ p: [x, Y.can, -0.12], s: [1, sz, 1] });
        capTop.push({ p: [x, Y.can + 0.125 * sz + 0.013, -0.12] });
      }
      const ch = k.box(0.36, 0.3, 0.12, hitMat, cx, Y.can, -0.12, gCap, { noShadow: true }); ch.castShadow = false;
      k.pickable(ch, 'K' + (i + 1) + ' · kondansatörler', () => stepInfo(app, i, 'cap'));
      // kablolar
      k.tube([[cx + 0.03, Y.cont - 0.07, -0.15], [cx + 0.05, Y.cont - 0.2, -0.15], [cx + 0.03, Y.can + 0.18, -0.13]], 0.007, M.cableBlack, gCap);
      let reac = null;
      if (det) {
        const rs = 0.8 + Math.min(q, 100) / 100 * 0.4;
        reac = k.group(gReac, cx, Y.reac, -0.1);
        reac.scale.setScalar(rs);
        k.box(0.3, 0.04, 0.1, M.darkSteel, 0, 0.105, 0, reac); k.box(0.3, 0.04, 0.1, M.darkSteel, 0, -0.105, 0, reac);
        k.box(0.32, 0.012, 0.13, M.galv, 0, -0.135, 0, reac); // montaj ayağı
        for (let j = 0; j < 3; j++) {
          const lx = -0.095 + j * 0.095;
          k.box(0.05, 0.17, 0.05, M.darkSteel, lx, 0, 0, reac);
          coilList.push({ p: [cx + lx * rs, Y.reac, -0.1], s: [rs, rs, rs] });
          k.box(0.016, 0.03, 0.01, M.copper, lx, 0.14, 0.03, reac);
        }
        k.box(0.2, 0.028, 0.03, M.plasticDark, 0, 0.14, 0.045, reac); // klemens / termik kontak
        const rh = k.box(0.34, 0.32, 0.14, hitMat, 0, 0, 0, reac, { noShadow: true }); rh.castShadow = false;
        k.pickable(reac, 'K' + (i + 1) + ' · ayarlı reaktör', () => stepInfo(app, i, 'reac'));
        k.tube([[cx - 0.05, Y.cont - 0.07, -0.15], [cx - 0.16, Y.cont - 0.3, -0.16], [cx - 0.16, Y.reac + 0.3, -0.16], [cx - 0.08, Y.reac + 0.16, -0.08]], 0.007, M.cableBlack, gReac);
        k.tube([[cx + 0.08, Y.reac + 0.16, -0.08], [cx + 0.16, Y.reac + 0.4, -0.16], [cx + 0.15, Y.can - 0.1, -0.16], [cx + 0.1, Y.can - 0.14, -0.13]], 0.007, M.cableBlack, gReac);
        if (i === 0) k.label('Ayarlı reaktör · p %' + fmt(s.detune, s.detune % 1 ? 2 : 0), reac, [0, 0.2, 0.05], 'vs-label--sm');
      }
      sc.steps.push({ ind: ind, cans: cans, reac: reac, sec: si });
    });
    // şönt reaktör (giriş bölümü altı)
    if (s.shunt_kvar > 0) {
      const sh = k.group(gReac, xi, 0.5, -0.1); sh.scale.setScalar(1.35);
      k.box(0.32, 0.045, 0.12, M.darkSteel, 0, 0.11, 0, sh); k.box(0.32, 0.045, 0.12, M.darkSteel, 0, -0.11, 0, sh);
      k.box(0.34, 0.012, 0.14, M.galv, 0, -0.14, 0, sh);
      for (let j = 0; j < 3; j++) { k.box(0.05, 0.17, 0.05, M.darkSteel, -0.1 + j * 0.1, 0, 0, sh); coilList.push({ p: [xi + (-0.1 + j * 0.1) * 1.35, 0.5, -0.1], s: [1.45, 1.35, 1.45] }); }
      k.pickable(sh, 'Şönt reaktör', () => ['Q = ' + fmt(s.shunt_kvar, 1, 'kVAr') + ' (endüktif)', 'Hafif yükte kablo kapasitansı ve kapasitif yüklerin oluşturduğu kapasitif reaktif enerjiyi dengeler.', 'EPDK kapasitif oran sınırı aşılmasını önlemek için kullanılır.']);
      k.label('Şönt reaktör ' + fmt(s.shunt_kvar, 1, 'kVAr'), sh, [0, 0.2, 0.06], 'vs-label--sm');
    }
    // tekrarlanan parçalar
    inst(k, fuseGeo, M.plasticWhite, fuseList, gSw);
    sc.canIM = inst(k, canGeo, M.alu, canList, gCap);
    sc.canIM.instanceColor = new T.InstancedBufferAttribute(new Float32Array(Math.max(1, canList.length) * 3).fill(1), 3);
    inst(k, capGeo, M.plasticDark, capTop, gCap);
    if (coilList.length) { inst(k, coilGeo, coilMat, coilList, gReac); inst(k, coilEndGeo, M.plasticDark, coilList.map(c => ({ p: [c.p[0], c.p[1] + 0.085 * c.s[1], c.p[2]], s: c.s })), gReac); }

    // ---- besleme trafosu (sol)
    const tsc = E.clamp(Math.cbrt(s.Sr_kVA / 1000), 0.72, 1.3);
    const tw = 1.5 * tsc, th = 1.1 * tsc, td = 0.72 * tsc;
    const xT = x0 - 0.9 - tw / 2, zT = 0.05;
    const tr = k.group(null, xT, 0, zT);
    k.box(tw * 0.9, 0.1, 0.1, M.darkSteel, 0, 0.05, td * 0.32, tr); k.box(tw * 0.9, 0.1, 0.1, M.darkSteel, 0, 0.05, -td * 0.32, tr);
    const tank = k.rbox(tw, th, td, 0.03, M.trafoPaint, 0, 0.1 + th / 2, 0, tr); void tank;
    k.box(tw + 0.06, 0.04, td + 0.06, M.trafoPaint, 0, 0.12 + th, 0, tr);
    const fins = [], nf = Math.floor((tw - 0.16) / 0.055);
    for (let j = 0; j < nf; j++) { const fx = -tw / 2 + 0.1 + j * 0.055; fins.push({ p: [fx, 0.16 + th * 0.45, td / 2 + 0.12] }); fins.push({ p: [fx, 0.16 + th * 0.45, -td / 2 - 0.12] }); }
    inst(k, new T.BoxGeometry(0.012, th * 0.78, 0.24), M.trafoPaint, fins, tr);
    const topY = 0.14 + th;
    for (let j = 0; j < 3; j++) {
      const bx = -tw * 0.25 + j * tw * 0.25;
      for (let d = 0; d < 4; d++) k.cyl(0.045, 0.045, 0.02, M.porcelainGrey, bx, topY + 0.04 + d * 0.05, -td * 0.25, tr, 14);
      k.cyl(0.025, 0.03, 0.22, M.porcelainGrey, bx, topY + 0.11, -td * 0.25, tr, 12);
      k.cyl(0.008, 0.008, 0.06, M.brass, bx, topY + 0.25, -td * 0.25, tr, 8);
    }
    for (let j = 0; j < 4; j++) {
      const bx = -tw * 0.3 + j * tw * 0.2;
      k.cyl(0.032, 0.036, 0.12, M.porcelainGrey, bx, topY + 0.06, td * 0.28, tr, 12);
      k.box(0.05, 0.08, 0.012, M.copper, bx, topY + 0.16, td * 0.28, tr);
    }
    k.cyl(0.035, 0.035, 0.08, M.steel, tw * 0.38, topY + 0.04, 0, tr, 12); // termometre cebi
    const tp = k.screen(0.22, 0.13, 256, (gx, w, h) => { gx.fillStyle = '#d9dde1'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#111'; gx.font = 'bold 22px Arial'; gx.fillText('TRAFO ' + s.Sr_kVA + ' kVA', 10, 30); gx.font = '18px Arial'; gx.fillText('Dyn11 · 34,5/0,4 kV', 10, 62); gx.fillText('uk = %' + fmt(s.uk, 1), 10, 92); gx.fillText('ONAN', 10, 120); }, tr);
    tp.position.set(tw * 0.25, 0.1 + th * 0.65, td / 2 + 0.002);
    k.pickable(tr, 'Besleme trafosu', () => { const r = app.validResult && app.validResult.values; return r ? ['Sr = ' + s.Sr_kVA + ' kVA · uk = %' + fmt(s.uk, 1), 'Xs = uk·U²/Sr = ' + fmt(r.Xs * 1e3, 2) + ' mΩ (50 Hz), Rs = Xs/8', 'Şebeke harmonik akımı: THDi %' + fmt(r.THDiSupply, 1), 'Yüklenme ≈ %' + fmt(r.S / s.Sr_kVA * 100, 0) + ' (S = ' + fmt(r.S, 0) + ' kVA)'] : []; });
    sc.trafoLbl = k.label('Trafo ' + s.Sr_kVA + ' kVA · uk %' + fmt(s.uk, 1), tr, [0, topY + 0.42, 0]);

    // ---- doğrusal olmayan yük: VFD panosu (sağ)
    const xV = -x0 + 0.75;
    const vf = k.group(null, xV, 0, 0);
    k.box(0.6, 0.1, 0.48, M.plasticDark, 0, 0.05, 0, vf);
    k.shell(k.rbox(0.6, 2.0, 0.5, 0.01, M.panelDark, 0, 1.1, 0, vf));
    for (let r = 0; r < 9; r++) { k.box(0.4, 0.008, 0.006, M.darkSteel, 0, 0.3 + r * 0.025, 0.254, vf); k.box(0.4, 0.008, 0.006, M.darkSteel, 0, 1.75 + r * 0.025, 0.254, vf); }
    k.box(0.16, 0.2, 0.01, M.plasticDark, 0, 1.3, 0.255, vf);
    const kp = k.screen(0.12, 0.07, 128, (gx, w, h) => { gx.fillStyle = '#0b2a1a'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#4ade80'; gx.font = 'bold 26px monospace'; gx.fillText('50.0 Hz', 8, 32); gx.font = '16px monospace'; gx.fillText('RUN  6P', 8, 58); }, vf, { emissive: 0.8 });
    kp.position.set(0, 1.34, 0.262);
    const warn = k.screen(0.1, 0.088, 128, (gx, w, h) => { gx.fillStyle = '#f2c200'; gx.beginPath(); gx.moveTo(w / 2, 6); gx.lineTo(w - 6, h - 6); gx.lineTo(6, h - 6); gx.closePath(); gx.fill(); gx.strokeStyle = '#111'; gx.lineWidth = 6; gx.stroke(); gx.fillStyle = '#111'; gx.font = 'bold 58px Arial'; gx.textAlign = 'center'; gx.fillText('⚡', w / 2, h - 18); }, vf);
    warn.position.set(0, 1.6, 0.256);
    k.pickable(vf, 'Doğrusal olmayan yük · VFD panosu', () => { const r = app.validResult && app.validResult.values; return r ? ['6 darbeli diyot doğrultuculu frekans konvertörleri (örnek)', 'Yük akımı THDi %' + fmt(r.THDiLoad, 1) + ' · 5. harmonik %' + fmt(s.harmonics[5] || 0, 1), 'Harmonik akım kaynağı olarak modellenir; bara empedansı Vh = Ih·|Z(h)|.'] : []; });
    k.label('VFD · doğrusal olmayan yük', vf, [0, 2.2, 0]);

    // ---- kablo tavası ve besleme kabloları
    const trayY = 2.62, trayZ = -0.25;
    const tx0 = xT, tx1 = xV;
    k.box(tx1 - tx0 + 0.3, 0.008, 0.3, M.galv, (tx0 + tx1) / 2, trayY, trayZ);
    k.box(tx1 - tx0 + 0.3, 0.06, 0.008, M.galv, (tx0 + tx1) / 2, trayY + 0.03, trayZ + 0.15); k.box(tx1 - tx0 + 0.3, 0.06, 0.008, M.galv, (tx0 + tx1) / 2, trayY + 0.03, trayZ - 0.15);
    for (let x = tx0; x <= tx1 + 0.01; x += 1.2) k.box(0.04, 0.04, 0.36, M.galv, x, trayY - 0.03, trayZ - 0.03);
    const supplyPts = [[xT - tw * 0.1, topY + 0.2, zT + td * 0.28], [xT - tw * 0.1, trayY + 0.05, trayZ + 0.05], [xi + 0.12, trayY + 0.05, trayZ + 0.05], [xi + 0.12, 2.15, -0.16]];
    const sup = k.tube(supplyPts, 0.03, M.cableBlack, v.root);
    const vfdPts = [[xV, 2.1, -0.05], [xV, trayY + 0.05, trayZ - 0.05], [xT + tw * 0.1, trayY + 0.05, trayZ - 0.05], [xT + tw * 0.1, topY + 0.2, zT + td * 0.28]];
    const vc = k.tube(vfdPts, 0.026, M.cableBlack, v.root);
    // akım trafosu (röle ölçümü, besleme kablosunda)
    const ct = new T.Mesh(new T.TorusGeometry(0.06, 0.02, 10, 24), M.plasticDark); ct.position.set(xT - tw * 0.1, trayY - 0.35, trayZ + 0.05 + (zT + td * 0.28 - trayZ - 0.05) * 0.15); ct.rotation.x = Math.PI / 2; ct.castShadow = true; v.root.add(ct);
    k.pickable(ct, 'Akım trafosu (röle ölçümü)', () => ['Röle akımını tesis girişinden ölçer: yük + kondansatör toplamı görülmelidir.', 'Yanlış yer/yön: röle kademeleri gereksiz devreye alır veya hiç almaz.']);
    sc.flowSup = k.flow(sup.userData.curve, 26, 0xfcd34d, 0.016);
    sc.flowHarm = k.flow(new T.CatmullRomCurve3(vfdPts.map(p => new T.Vector3(p[0], p[1] + 0.035, p[2])), false, 'catmullrom', 0.2), 22, 0xa78bfa, 0.014);
    void vc;

    // görünüm
    app.def.scene.bounds = [xT - tw / 2 - 0.2, xV + 0.5];
    const span = (xV + 0.35) - (xT - tw / 2);
    v.setView({ target: [(xV + 0.35 + xT - tw / 2) / 2, 1.0, 0], r: span * 0.88 + 1.9, theta: 0.32, phi: 1.22, limits: { rMin: 0.8, rMax: 22 } });
    v.setShadowBox(Math.max(5, span * 0.75), 40);
    v.sun.position.set(3, 8, 7);
  }

  function stepInfo(app, i, part) {
    const s = app.state, r = app.validResult && app.validResult.values;
    const q = s.steps[i]; if (q === undefined || !r) return [];
    const on = !!r.steps[i], Ic = stepI(q, s.U_LL);
    const base = ['K' + (i + 1) + ': ' + fmt(q, 1, 'kVAr') + ' · ' + (on ? 'devrede' : 'devre dışı') + ' · Ic ≈ ' + fmt(Ic, 1, 'A') + ' (anma)'];
    if (part === 'cont') return base.concat(['Kondansatör tipi kontaktör (AC-6b): ön yükleme dirençli erken kapanan kontaklar ani akımı sınırlar.', 'NH00 gG sigorta: tipik seçim ≈ 1,6–1,8·Ic.', s.mode === 'auto' && app.live.ctrl && app.live.ctrl.pending && app.live.ctrl.pending.i === i ? 'Röle: ' + app.live.ctrl.msg : '']);
    if (part === 'cap') return base.concat([cansOf(q) + ' adet üç fazlı kuru tip kondansatör (temsili)', 'Akım yüklenmesi (harmonik dahil): ' + fmt(r.capOver, 2) + '×In · sınır 1,3×In (IEC 60831-1)', s.detune > 0 ? 'Ayarlı grupta kondansatör uçlarında gerilim U/(1 − p) ≈ ' + fmt(s.U_LL / (1 - s.detune / 100), 0, 'V') + '; anma gerilimi buna göre seçilir.' : 'Reaktörsüz grup: paralel rezonans h ≈ ' + fmt(r.hPar, 2)]);
    return base.concat(['Seri reaktör p = %' + fmt(s.detune, 2) + ' → kol ayar frekansı ' + fmt(r.hRes * 50, 0, 'Hz'), 'Kol, ayar frekansının üstündeki harmoniklerde endüktiftir; trafo ile paralel rezonans h ≈ ' + fmt(r.hPar, 2) + '’ye iner.', 'Demir nüveli, hava aralıklı; termik kontak röleye bağlanır.']);
  }

  function drawRelay(g, w, h, app) {
    const r = app.validResult && app.validResult.values, s = app.state, c = app.live.ctrl;
    g.fillStyle = '#06141f'; g.fillRect(0, 0, w, h);
    if (!r) return;
    g.fillStyle = '#7dd3fc'; g.font = 'bold 15px monospace'; g.fillText(s.mode === 'auto' ? 'OTO' : 'MAN', 10, 20);
    g.textAlign = 'right'; g.fillStyle = r.Qnet < 0 ? '#fca5a5' : '#86efac'; g.fillText(r.Qnet < 0 ? 'KAP' : 'IND', w - 10, 20); g.textAlign = 'left';
    g.fillStyle = '#e2e8f0'; g.font = 'bold 50px monospace'; g.fillText(fmt(r.cosNew, 2), 14, 74);
    g.font = 'bold 15px monospace'; g.fillStyle = '#94a3b8'; g.fillText('cosφ', w - 62, 70);
    g.fillStyle = '#fcd34d'; g.font = 'bold 18px monospace'; g.fillText('Q ' + fmt(r.Qnet, 1) + ' kvar', 12, 104);
    const n = s.steps.length, bw = Math.min(18, (w - 20) / n - 3);
    s.steps.forEach((q, i) => {
      const x = 10 + i * (bw + 3), on = r.steps[i], pend = c && c.pending && c.pending.i === i && s.mode === 'auto';
      g.fillStyle = on ? '#22c55e' : pend && Math.floor(performance.now() / 300) % 2 ? '#f59e0b' : '#1e293b'; g.fillRect(x, 120, bw, 30);
      g.fillStyle = '#cbd5e1'; g.font = '11px monospace'; g.fillText(String(i + 1), x + bw / 2 - 3, 166);
    });
    if (s.mode === 'auto' && c && c.pending) { g.fillStyle = '#f59e0b'; g.font = 'bold 14px monospace'; g.fillText((c.pending.on ? '↑ K' : '↓ K') + (c.pending.i + 1) + ' ' + fmt(Math.max(c.pending.left, c.pending.on ? c.discharge[c.pending.i] : 0), 0) + ' s', 12, h - 12); }
  }

  /* sahne güncelleme: hesap değişince */
  const COL = { on: null, off: null, hot: null };
  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values, M = k.mats, T = k.T;
    if (!COL.on) { COL.on = new T.Color(1, 1, 1); COL.off = new T.Color(0.32, 0.34, 0.37); COL.hot = new T.Color(1, 0.55, 0.25); }
    const c = live.ctrl;
    s.steps.forEach((q, i) => {
      const st = sc.steps[i]; if (!st) return;
      const on = !!v.steps[i], pend = s.mode === 'auto' && c && c.pending && c.pending.i === i;
      st.ind.material = on ? M.ledGreen : pend ? M.ledAmber : M.ledOff;
      st.cans.forEach(ci => sc.canIM.setColorAt(ci, on ? (v.capOver > 1.3 ? COL.hot : COL.on) : COL.off));
      if (sc.ledsDoor[i]) sc.ledsDoor[i].material = on ? M.ledGreen : pend ? M.ledAmber : M.ledOff;
    });
    if (sc.canIM.instanceColor) sc.canIM.instanceColor.needsUpdate = true;
    // bölüm etiketleri: iki kademe tek etikette (● devrede, ○ devre dışı, ◐ röle bekliyor)
    sc.secLbl.forEach((l, si) => {
      if (!l) return;
      const ids = [2 * (si - 1), 2 * (si - 1) + 1].filter(i => i < s.steps.length);
      const pend = ids.some(i => s.mode === 'auto' && c && c.pending && c.pending.i === i), on = ids.some(i => v.steps[i]);
      l.set(ids.map(i => 'K' + (i + 1) + ' ' + fmt(s.steps[i], s.steps[i] % 1 ? 1 : 0) + (v.steps[i] ? ' ●' : s.mode === 'auto' && c && c.pending && c.pending.i === i ? ' ◐' : ' ○')).join('  ') + ' kVAr');
      l.level(pend ? 'warn' : on ? (v.capOver > 1.3 ? 'bad' : 'ok') : '');
    });
    sc.flowSup.speed = Math.min(1.2, 0.15 + v.Inew / Math.max(v.I1, 1) * 0.6);
    sc.flowHarm.speed = Math.min(1.4, v.THDiSupply / 40);
    sc.trafoLbl.set('Trafo ' + s.Sr_kVA + ' kVA · THDv %' + fmt(v.THDv, 1));
    sc.trafoLbl.level(v.THDv > 8 ? 'bad' : v.THDv > 5 ? 'warn' : 'ok');
    sc.relay.redraw();
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const target = s.doorOpen ? -1.62 : 0;
    sc.doors.forEach((d, i) => { const tt = target * (1 - i * 0.015); d.rotation.y += (tt - d.rotation.y) * Math.min(1, dt * 4); });
    const anyOn = res.values.steps.some(Boolean);
    sc.fans.forEach(f => {
      const on = anyOn && (res.values.steps[(f.sec - 1) * 2] || res.values.steps[(f.sec - 1) * 2 + 1]);
      f.spd = (f.spd || 0) + ((on ? 14 : 0) - (f.spd || 0)) * Math.min(1, dt * 1.5);
      if (!k.reducedMotion) f.imp.rotation.y += f.spd * dt;
    });
    sc.rt = (sc.rt || 0) + dt;
    if (sc.rt > 0.3) { sc.rt = 0; sc.relay.redraw(); }
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması */
  function view2d(g, W, H, res, s, live) {
    const v = res.values;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', cu: '#c77b4a', vio: '#a78bfa' };
    g.lineWidth = 2; g.font = '12px Inter, sans-serif'; g.textAlign = 'center';
    const tx = Math.max(70, W * 0.14), oy = 50, by = 120 + oy;
    // trafo
    g.strokeStyle = col.line; g.beginPath(); g.arc(tx, 36 + oy, 13, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(tx, 56 + oy, 13, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(tx, 22 + oy); g.lineTo(tx, 8 + oy); g.moveTo(tx, 69 + oy); g.lineTo(tx, by); g.stroke();
    g.fillStyle = col.dim; g.textAlign = 'left'; g.fillText('Trafo ' + s.Sr_kVA + ' kVA · uk %' + fmt(s.uk, 1), tx + 22, 40 + oy); g.fillText('Xs = ' + fmt(v.Xs * 1e3, 2) + ' mΩ', tx + 22, 56 + oy);
    // akım trafosu
    g.beginPath(); g.arc(tx, 92 + oy, 7, 0, Math.PI * 2); g.stroke(); g.fillText('AT → röle', tx + 12, 96 + oy);
    // bara
    const x1 = W - 80;
    g.lineWidth = 5; g.strokeStyle = col.cu; g.beginPath(); g.moveTo(tx - 30, by); g.lineTo(x1, by); g.stroke(); g.lineWidth = 2;
    g.fillStyle = col.dim; g.fillText('AG bara ' + s.U_LL + ' V · THDv %' + fmt(v.THDv, 2) + ' · cosφ ' + fmt(v.cosNew, 3) + ' ' + (v.Qnet < 0 ? 'kap.' : 'end.'), tx + 60, by - 10);
    // yük
    const lx = tx + 40;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(lx, by); g.lineTo(lx, by + 60); g.stroke();
    g.strokeRect(lx - 16, by + 60, 32, 32); g.beginPath(); g.moveTo(lx - 16, by + 92); g.lineTo(lx + 16, by + 60); g.stroke();
    g.fillStyle = col.text; g.textAlign = 'center'; g.fillText('VFD / yük', lx, by + 110);
    g.fillStyle = col.dim; g.fillText(fmt(s.P_kW, 0) + ' kW', lx, by + 125); g.fillText('THDi %' + fmt(v.THDiLoad, 1), lx, by + 140);
    g.fillStyle = col.vio; g.fillText('→ şebeke THDi %' + fmt(v.THDiSupply, 1), tx, by + 160);
    // kademeler
    const n = s.steps.length + (s.shunt_kvar > 0 ? 1 : 0), xa = lx + 60, step = Math.max(34, (x1 - xa) / Math.max(n, 1));
    const c = live.ctrl;
    s.steps.forEach((q, i) => {
      const x = xa + (i + 0.5) * step, on = !!v.steps[i], pend = s.mode === 'auto' && c && c.pending && c.pending.i === i;
      const lv = on ? (v.capOver > 1.3 ? col.bad : col.ok) : pend ? col.warn : col.dim;
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by); g.lineTo(x, by + 14); g.stroke();
      g.strokeRect(x - 4, by + 14, 8, 16); // sigorta
      g.beginPath(); g.moveTo(x, by + 30); g.lineTo(x, by + 42); g.stroke();
      g.strokeStyle = lv; g.beginPath(); g.moveTo(x, by + 42); g.lineTo(x + (on ? 0 : 9), by + 62); g.stroke(); // kontaktör
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by + 62); g.lineTo(x, by + 74); g.stroke();
      let y = by + 74;
      if (s.detune > 0) { g.beginPath(); for (let j = 0; j < 3; j++) g.arc(x, y + 5 + j * 9, 4.5, -Math.PI / 2, Math.PI / 2); g.stroke(); y += 30; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 6); g.stroke(); y += 6; }
      g.beginPath(); g.moveTo(x - 10, y); g.lineTo(x + 10, y); g.moveTo(x - 10, y + 6); g.lineTo(x + 10, y + 6); g.stroke();
      g.fillStyle = lv; g.font = 'bold 11px Inter, sans-serif'; g.fillText('K' + (i + 1), x, y + 22);
      g.fillStyle = col.dim; g.font = '10px Inter, sans-serif'; g.fillText(fmt(q, q % 1 ? 1 : 0), x, y + 35);
    });
    if (s.shunt_kvar > 0) {
      const x = xa + (n - 0.5) * step;
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by); g.lineTo(x, by + 40); g.stroke();
      g.beginPath(); for (let j = 0; j < 4; j++) g.arc(x, by + 46 + j * 10, 5, -Math.PI / 2, Math.PI / 2); g.stroke();
      g.fillStyle = col.text; g.font = 'bold 11px Inter, sans-serif'; g.fillText('Şönt', x, by + 105); g.fillStyle = col.dim; g.font = '10px Inter, sans-serif'; g.fillText(fmt(s.shunt_kvar, 1), x, by + 118);
    }
    // özet
    const yy = by + 205; g.textAlign = 'left'; g.font = '12px Inter, sans-serif';
    const lines = [
      ['Ql ' + fmt(v.Ql, 1) + ' kVAr · gerekli Qc ' + fmt(v.Qneed, 1) + ' kVAr · devrede ' + fmt(v.QcNom, 1) + ' kVAr', col.text],
      ['Q net ' + fmt(v.Qnet, 1) + ' kVAr (' + v.state + ') · reaktif/aktif %' + fmt(Math.abs(v.reRatio), 1) + ' (sınır %' + (v.reRatio < 0 ? v.reLimit.cap : v.reLimit.ind) + ')', v.Qnet < 0 ? col.warn : col.text],
      [v.QcNom > 0 ? 'Paralel rezonans h ≈ ' + fmt(v.hPar, 2) + ' (' + fmt(v.hPar * 50, 0) + ' Hz)' + (s.detune > 0 ? ' · kol ayarı ' + fmt(v.hRes * 50, 0) + ' Hz' : ' · reaktörsüz') : 'Devrede kondansatör yok', col.text],
      ['Kondansatör akımı ' + fmt(v.capOver, 2) + '×In · ' + (s.mode === 'auto' ? 'Röle: ' + (c ? c.msg : '—') : 'Manuel mod'), v.capOver > 1.3 ? col.bad : col.dim]
    ];
    lines.forEach((l, i) => { g.fillStyle = l[1]; g.fillText(l[0], 24, yy + i * 18); });
    g.fillStyle = col.dim; g.font = '10px Inter, sans-serif'; g.fillText('Tek hat şeması · sigorta, kontaktör' + (s.detune > 0 ? ', ayarlı reaktör' : '') + ' ve kondansatör kademeleri. Değerler VoltSim hesap motorundandır.', 24, H - 14);
  }

  /* ---------------------------------------------------------------- senaryolar */
  const sc = (o) => Object.assign(defaults(), o);
  VS.register({
    id: 'komp', title: '3D Kompanzasyon ve Harmonik Simülasyonu',
    defaults: defaults,
    initLive: () => ({ ctrl: null, events: [], hist: [], histT: 0 }),
    autoRun: true,
    startText: 'Röle sıfırlandı: kademeler gecikme ve deşarj kilidine uyarak tek tek devreye alınıyor.',
    start: start,
    scenarios: [
      { id: 'fabrika', name: 'Fabrika · %7 ayarlı filtreli kompanzasyon', desc: '320 kW sürücü ağırlıklı tesis, 1000 kVA trafo, 6 kademe %7 detuned. Röle kademe kademe hedefe gider.', state: defaults(), start: true },
      { id: 'rezonans', name: 'Reaktörsüz grup · 7. harmonikte rezonans', desc: 'Aynı tesis 630 kVA trafodan, reaktörsüz kondansatörle: paralel rezonans 7. harmoniğe yaklaşır; THDv ve kondansatör akımı yükselir.', state: sc({ Sr_kVA: 630, detune: 0 }) },
      { id: 'asiri', name: 'Gece hafif yük · aşırı kompanzasyon (manuel)', desc: 'Yük 60 kW’a düştü ama kademeler manuel olarak açık kaldı: kapasitif çalışma ve EPDK kapasitif oran ihlali.', state: sc({ P_kW: 60, cos1: 0.85, mode: 'manual', manualOn: [true, true, true, false, false, false], harmonics: Object.assign({}, SPECTRA.mix.h) }) },
      { id: 'sont', name: 'Kapasitif tesis · şönt reaktör', desc: 'Uzun kablolar ve UPS/LED yükleri kapasitif reaktif üretir; şönt reaktör kapasitif oranı sınır içine çeker.', state: sc({ P_kW: 90, cos1: 0.97, Qcap_kvar: 45, shunt_kvar: 30, steps: [5, 10, 20, 20], manualOn: [false, false, false, false], sel: 0, harmonics: Object.assign({}, SPECTRA.mix.h), installed_kVA: 400, Sr_kVA: 400 }) },
      { id: 'kucuk', name: 'Küçük işletme · kurulu güç < 50 kVA', desc: 'Kurulu güç 40 kVA: EPDK sınırları %33 endüktif / %20 kapasitif; küçük kademeli reaktörsüz pano.', state: sc({ P_kW: 28, cos1: 0.78, cos2: 0.97, steps: [2.5, 5, 5, 10], manualOn: [false, false, false, false], sel: 0, detune: 0, Sr_kVA: 400, installed_kVA: 40, harmonics: Object.assign({}, SPECTRA.mix.h) }) },
      { id: 'p14', name: '%14 ayarlı grup · 3. harmonik içeren tesis', desc: 'p = %14 ile ayar frekansı 134 Hz; 3. harmoniğe yakın rezonans riskine karşı tercih edilir.', state: sc({ detune: 14 }) }
    ],
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    reportInputs: s => s.steps.map((q, i) => ({ group: 'Kademeler', label: 'Kademe ' + (i + 1), value: fmt(q, 1, 'kVAr') + (s.mode === 'manual' ? (manualArr(s)[i] ? ' · açık' : ' · kapalı') : ' · otomatik') })),
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-3, 3] },
    view2d: view2d
  });
})();
