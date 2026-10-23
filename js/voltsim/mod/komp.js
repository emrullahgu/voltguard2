/* VoltSim · 3D Kompanzasyon ve Harmonik Simülasyonu
 * Hesap: VoltSimEngine.komp (Qc = P·(tanφ1 − tanφ2), trafo + kondansatör kolu empedans modeliyle harmonik akım/gerilim
 * dağılımı, paralel rezonans, EPDK reaktif oran kontrolü) + VoltSimEngine.ext.komp (sınırsız kademe seçimi, röle kararı,
 * kademe sağlığı, ayarlı filtre boyutlandırma, gerilim yükselmesi, aktif harmonik filtre, 24 saatlik enerji oranları).
 * Sahne: hesap sonucunu gösterir (kademe ekipmanı, röle ekranı, akış); ekipmana tıklayarak kademeler işletilir. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt, Cx = E.C;
  const K = E.komp, KC = E.ext.komp;
  const MAX_STEPS = 48;

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
  const EN50160 = { 5: 6, 7: 5, 11: 3.5, 13: 3, 17: 2, 19: 1.5 }; // tekil harmonik gerilim sınırları (% U1), grafik referansı
  const PROT = { nhgG: 'NH00 bıçaklı sigorta · gG', nhaM: 'NH00 bıçaklı sigorta · aM', mccb: 'Kompakt şalter (MCCB)' };
  const FUSES = [16, 20, 25, 32, 35, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400];
  const CT = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1250, 1500, 2000, 2500, 3000, 4000];

  function defaults() {
    return {
      U_LL: 400, P_kW: 320, cos1: 0.72, cos2: 0.99, Qcap_kvar: 0, installed_kVA: 1000,
      Sr_kVA: 1000, uk: 6,
      mode: 'auto', program: 'optimal', ctRatio: 1500, ctPos: 'giris', delay_s: 20, discharge_s: 60, accel: 10,
      switching: 'contactor', prot: 'nhgG', detune: 7, ahf_A: 0, doorOpen: true,
      steps: [10, 20, 40, 60, 60, 80], stepLoss: [0, 0, 0, 0, 0, 0], stepFuse: [false, false, false, false, false, false], manualOn: [false, false, false, false, false, false], sel: 2,
      shuntSteps: [],
      dayProfile: 'v2', dayClock: false,
      harmonics: Object.assign({}, SPECTRA.vfd6c.h)
    };
  }

  /* ---------------------------------------------------------------- yardımcılar */
  const at = (a, i, d) => (a && a[i] !== undefined ? a[i] : d);
  const manualArr = s => s.steps.map((_, i) => !!at(s.manualOn, i, false));
  /** Kademe dizileri (kayıp, sigorta, manuel) adım sayısıyla eşitlenir — yalnız kullanıcı eylemlerinde çağrılır. */
  function syncArrays(s) {
    s.stepLoss = s.steps.map((_, i) => at(s.stepLoss, i, 0));
    s.stepFuse = s.steps.map((_, i) => !!at(s.stepFuse, i, false));
    s.manualOn = manualArr(s);
    s.sel = Math.max(0, Math.min(s.sel || 0, s.steps.length - 1));
  }
  const stepI = (q, U) => E.currentFromS(q * 1e3, U);
  const sum = a => a.reduce((x, y) => x + y, 0);
  const fuseFor = (q, U, kind) => { const I = stepI(q, U) * (kind === 'nhaM' ? 1.4 : 1.6); return FUSES.find(f => f >= I) || FUSES[FUSES.length - 1]; };
  const isFast = s => s.switching === 'thyristor';

  /* ---------------------------------------------------------------- hesap */
  function newCtrl(on) { return { on: on.slice(), discharge: on.map(() => 0), pending: null, t: 0, msg: 'Hedef kombinasyon devrede' }; }
  /** Motor girdisi + röle kararı. Otomatik modda röle hedefi ext.komp.controller ile (kademe sayısı sınırsız) bulunur;
   *  zamanlı röle (live.ctrl) kademeleri tek tek bu hedefe götürür ve her ara durum motorla hesaplanır. */
  function compute(s, app) {
    const live = app && app.live;
    const eff = KC.effectiveSteps(s.steps, s.stepLoss, s.stepFuse);
    const shunt = (s.shuntSteps || []).slice();
    const prof = KC.PROFILES[s.dayProfile] || KC.PROFILES.v2;
    const hour = s.dayClock && live ? Math.floor(live.hour || 0) % 24 : null;
    const P = hour === null ? s.P_kW : s.P_kW * prof.f[hour];
    const Ql = P * Math.tan(Math.acos(Math.min(1, Math.max(0.3, s.cos1))));
    const Qneed = K.requiredQc(P, Math.min(1, Math.max(0.3, s.cos1)), Math.min(1, Math.max(0.8, s.cos2)));
    const I1 = P > 0 ? P * 1e3 / (Math.sqrt(3) * s.U_LL * s.cos1) : 0;
    const ahf = s.ahf_A > 0 ? KC.ahfReduce(s.harmonics, I1, s.ahf_A) : null;
    const ctl = KC.controller({ steps: eff, shunt: shunt, Ql: Ql, Qneed: Qneed, Qcap: s.Qcap_kvar, ctPos: s.ctPos, program: s.program });
    let actual = ctl.capOn;
    if (s.mode === 'manual') actual = manualArr(s);
    else if (live) {
      if (!live.ctrl || live.ctrl.on.length !== s.steps.length) live.ctrl = newCtrl(ctl.capOn);
      actual = live.ctrl.on.slice();
    }
    const inp = { U_LL: s.U_LL, P_kW: P, cos1: s.cos1, cos2: s.cos2, Qcap_kvar: s.Qcap_kvar, Sr_kVA: s.Sr_kVA, uk: s.uk, detune: s.detune,
      steps: eff, manual: actual, shunt_kvar: ctl.shuntQ, harmonics: ahf ? ahf.harmonics : s.harmonics, installed_kVA: s.installed_kVA };
    const r = K.compute(inp);
    r.target = ctl.capOn; r.targetQ = ctl.capQ;
    const Sk = KC.trafoSk(s.Sr_kVA, s.uk);
    const qmin = Math.min.apply(null, eff.filter(q => q > 0).concat([Infinity]));
    const day = KC.simulateDay(Object.assign({}, inp, { P_kW: s.P_kW, manual: null, shunt_kvar: 0, harmonics: {} }), prof.f, { shunt: shunt, ctPos: s.ctPos, program: s.program });
    r.x = { eff: eff, shuntOn: ctl.shuntOn, shuntQ: ctl.shuntQ, ahf: ahf, P: P, hour: hour, Sk: Sk, dU: KC.voltageRise(r.values.QcNom, Sk),
      qmin: isFinite(qmin) ? qmin : 0, ck: isFinite(qmin) ? KC.cOverK(qmin, s.U_LL, s.ctRatio, 5) : 0, day: day,
      filter: s.detune > 0 ? KC.detunedFilter({ U_LL: s.U_LL, Q_kvar: s.steps[Math.min(s.sel, s.steps.length - 1)] || 0, p: s.detune / 100 }) : null };
    if (r.ok) {
      r.checks.push({ id: 'dU', label: 'Kondansatör gerilim yükselmesi', status: r.x.dU <= 3 ? 'ok' : 'warn', detail: 'ΔU ≈ Qc/Sk = ' + fmt(r.values.QcNom, 0) + ' kVAr / ' + fmt(Sk / 1e3, 1) + ' MVA = %' + fmt(r.x.dU, 2) + ' (hafif yükte aşırı gerilime dikkat).', ref: null });
      r.checks.push({ id: 'day', label: 'Günlük reaktif enerji oranları (' + prof.label + ')', status: day.indOk && day.capOk ? 'ok' : 'fail', detail: 'Endüktif %' + fmt(day.indPct, 1) + ' (sınır %' + day.limit.ind + ') · kapasitif %' + fmt(day.capPct, 1) + ' (sınır %' + day.limit.cap + '). Röle saatlik ideal çalışır; fatura dönemi toplamı esastır.', ref: 'EPDK Kurul Kararı 5999-3, Madde 13' });
      if (s.ctPos === 'load') r.checks.push({ id: 'ct', label: 'Akım trafosu konumu', status: 'fail', detail: 'Akım trafosu yük çıkışında: röle kondansatör akımını görmez, tüm kademeleri devreye alır (aşırı kompanzasyon). AT tesis girişine, kondansatör bağlantısından önce takılmalıdır.', ref: null });
      if (s.switching === 'thyristor' && !(s.detune > 0)) r.checks.push({ id: 'thy', label: 'Tristörlü anahtarlama', status: 'warn', detail: 'Tristör modülleri pratikte ayarlı reaktörle birlikte kullanılır (di/dt ve harmonik akım sınırlaması).', ref: null });
      if (ahf) r.checks.push({ id: 'ahf', label: 'Aktif harmonik filtre', status: ahf.k >= 1 ? 'ok' : 'info', detail: 'Anma ' + fmt(s.ahf_A, 0) + ' A · yük harmonik akımı ' + fmt(ahf.Ih, 0) + ' A → %' + fmt(ahf.k * 100, 0) + ' bastırma (ideal akım kaynağı modeli; dinamik ve kayıplar dahil değil).', ref: null });
      const bad = s.steps.map((q, i) => (at(s.stepFuse, i, false) ? 'K' + (i + 1) + ' sigorta' : at(s.stepLoss, i, 0) >= 10 ? 'K' + (i + 1) + ' %' + fmt(at(s.stepLoss, i, 0), 0) + ' kayıp' : null)).filter(Boolean);
      if (bad.length) r.checks.push({ id: 'health', label: 'Kademe sağlığı', status: 'warn', detail: bad.join(', ') + ' · Kurulu ' + fmt(sum(s.steps), 1) + ' kVAr → kullanılabilir ' + fmt(sum(eff), 1) + ' kVAr. Röle gerçek kademe gücünü (ölçerek) kullanır.', ref: null });
    }
    return r;
  }
  const chk = (res, id) => res.checks.find(c => c.id === id);
  const lvOf = c => (!c ? undefined : c.status === 'fail' ? 'bad' : c.status === 'warn' ? 'warn' : c.status === 'ok' ? 'ok' : undefined);

  /* ---------------------------------------------------------------- 3D eylemleri */
  function stepActions(app, i) {
    const s = app.state; if (i >= s.steps.length) return [];
    const acts = [];
    const on = app.validResult && app.validResult.values.steps[i];
    if (s.mode === 'manual') acts.push({ label: on ? 'Kademeyi devreden çıkar' : 'Kademeyi devreye al', variant: on ? '' : 'primary', onClick: a => { syncArrays(a.state); a.state.manualOn[i] = !on; } });
    else acts.push({ label: 'Manuel moda al', onClick: a => { syncArrays(a.state); a.state.manualOn = a.live.ctrl ? a.live.ctrl.on.slice() : manualArr(a.state); a.state.mode = 'manual'; } });
    acts.push(at(s.stepFuse, i, false)
      ? { label: 'Sigortayı değiştir', variant: 'primary', onClick: a => { syncArrays(a.state); a.state.stepFuse[i] = false; a.live.events.push('K' + (i + 1) + ': sigorta değiştirildi.'); } }
      : { label: s.prot === 'mccb' ? 'Şalter açtı (arıza)' : 'Sigorta attı (arıza)', variant: 'danger', onClick: a => { syncArrays(a.state); a.state.stepFuse[i] = true; a.live.events.push('K' + (i + 1) + ': koruma açtı, kademe kullanılamaz.'); } });
    acts.push(at(s.stepLoss, i, 0) > 0
      ? { label: 'Kondansatörleri yenile', variant: 'primary', onClick: a => { syncArrays(a.state); a.state.stepLoss[i] = 0; } }
      : { label: 'Yaşlanma: kapasite −%20', variant: 'warn', onClick: a => { syncArrays(a.state); a.state.stepLoss[i] = 20; } });
    acts.push({ label: 'Parametreler', onClick: a => { a.state.sel = i; } });
    return acts;
  }

  /* ---------------------------------------------------------------- kontroller */
  const numList = (min, max) => v => {
    const a = String(v).split(/[;\s]+|,(?=\s)|,(?=\d+[.,]?\d*\s*(?:,|$))/).map(x => x.trim()).filter(Boolean).map(x => Number(x.replace(',', '.')));
    if (a.some(x => !isFinite(x) || x < min || x > max)) throw new Error('Her değer ' + min + '–' + max + ' kVAr aralığında olmalı.');
    return a;
  };
  function controls(s, app) {
    const r = app.validResult, c = app.live.ctrl;
    const n = s.steps.length, sel = Math.min(s.sel, n - 1);
    const groups = [];
    groups.push({ title: 'Tesis yükü', items: [
      { type: 'range', key: 'P_kW', label: s.dayClock ? 'Tepe aktif güç Pmaks (profil çarpanı uygulanır)' : 'Aktif güç P', min: 10, max: 3000, step: 5, unit: 'kW' },
      { type: 'range', key: 'cos1', label: 'Mevcut cosφ1 (kompanzasyonsuz)', min: 0.5, max: 0.99, step: 0.01, digits: 2 },
      { type: 'range', key: 'Qcap_kvar', label: 'Tesisteki kapasitif yük (kablo, UPS, LED sürücü)', min: 0, max: 300, step: 1, unit: 'kVAr' },
      { type: 'select', key: 'U_LL', label: 'Bara gerilimi (faz arası)', options: [[400, '400 V'], [380, '380 V'], [415, '415 V'], [690, '690 V']] },
      { type: 'number', key: 'installed_kVA', label: 'Kurulu güç (EPDK oran sınırı için)', min: 1, max: 100000, step: 1, unit: 'kVA', help: 'Kurulu güç < 50 kVA: endüktif %33 / kapasitif %20; ≥ 50 kVA: %20 / %15 (EPDK 5999-3, Md. 13).' }
    ] });
    groups.push({ title: 'Besleme trafosu', items: [
      { type: 'select', key: 'Sr_kVA', label: 'Trafo anma gücü Sr', options: [250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500].map(v => [v, v + ' kVA']) },
      { type: 'range', key: 'uk', label: 'Kısa devre gerilimi uk', min: 4, max: 8, step: 0.5, unit: '%', digits: 1, help: 'Xs = uk·U²/Sr: paralel rezonans mertebesini ve gerilim yükselmesini (ΔU ≈ Qc/Sk) belirler.' }
    ] });
    groups.push({ title: 'Reaktif güç rölesi (RGR)', items: [
      { type: 'seg', key: 'mode', label: 'Çalışma', options: [['auto', 'Otomatik'], ['manual', 'Manuel']], onChange: (v, a) => {
        if (v === 'auto') a.live.ctrl = newCtrl(manualArr(a.state)); else if (a.live.ctrl) { syncArrays(a.state); a.state.manualOn = a.live.ctrl.on.slice(); }
        a.renderControls(); a.invalidate();
      } },
      { type: 'range', key: 'cos2', label: 'Hedef cosφ', min: 0.9, max: 1, step: 0.005, digits: 3 },
      { type: 'seg', key: 'program', label: 'Kademe programı', options: [['optimal', 'En iyi kombinasyon'], ['linear', 'Sıralı (lineer)']], help: 'Kademe sayısı sınırsız: en iyi kombinasyon dinamik programlamayla, sıralı program liste sırasıyla seçer.' },
      { type: 'select', key: 'ctRatio', label: 'Akım trafosu oranı (…/5 A)', options: CT.map(v => [v, v + '/5 A']) },
      { type: 'seg', key: 'ctPos', label: 'Akım trafosu konumu', options: [['giris', 'Tesis girişi (doğru)'], ['load', 'Yük çıkışı (hatalı)']] },
      r ? { type: 'note', html: 'C/k ≈ <b>' + fmt(r.x.ck, 3) + ' A</b> (en küçük kademe ' + fmt(r.x.qmin, 1) + ' kVAr) · tepki eşiği ≈ 0,65·C/k → ±' + fmt(0.65 * r.x.qmin, 1) + ' kVAr ölü bant' } : null,
      { type: 'seg', key: 'switching', label: 'Anahtarlama', options: [['contactor', 'Kontaktör'], ['thyristor', 'Tristör (statik)']], help: 'Tristörlü kademe sıfır gerilim geçişinde, gecikmesiz ve deşarj beklemeden anahtarlanır (hızlı değişen yükler: kaynak, vinç, pres).' },
      s.mode === 'auto' && !isFast(s) ? { type: 'range', key: 'delay_s', label: 'Anahtarlama gecikmesi', min: 5, max: 120, step: 5, unit: 's' } : null,
      s.mode === 'auto' && !isFast(s) ? { type: 'range', key: 'discharge_s', label: 'Deşarj (yeniden kapama) kilidi', min: 10, max: 180, step: 5, unit: 's', help: 'Deşarj dirençleri kondansatörü IEC 60831-1’e göre 3 dk içinde ≤ 75 V’a indirir; röle kilidi bu süreyi uygular.' } : null,
      s.mode === 'auto' && !isFast(s) ? { type: 'select', key: 'accel', label: 'Simülasyon zaman ölçeği', options: [[1, 'Gerçek zaman (×1)'], [5, '×5'], [10, '×10'], [30, '×30']] } : null
    ] });
    groups.push({ title: 'Kademe ekipmanı', items: [
      { type: 'seg', key: 'prot', label: 'Kademe koruması', options: [['nhgG', 'NH gG'], ['nhaM', 'NH aM'], ['mccb', 'MCCB']] },
      { type: 'select', key: 'detune', label: 'Ayarlı (detuned) reaktör oranı p (tüm kademeler)', options: DETUNE, help: 'p > 0: her kademe seri reaktörle 5. harmoniğin altına ayarlanır (f_r = 50/√p). Bir panoda tek p kullanılır.' },
      r && r.x.filter ? { type: 'note', html: 'K' + (sel + 1) + ' ayarlı kademe: L = <b>' + fmt(r.x.filter.L_mH, 3) + ' mH</b>/faz · C = <b>' + fmt(r.x.filter.C_uF, 0) + ' µF</b> (yıldız) · Uc = <b>' + fmt(r.x.filter.Uc, 0) + ' V</b> → kondansatör anma ' + r.x.filter.UcN + ' V (' + fmt(r.x.filter.QcapN_kvar, 1) + ' kVAr etiket) · I1 = ' + fmt(r.x.filter.I1, 1) + ' A · f_r = ' + fmt(r.x.filter.fr, 0) + ' Hz' } : null,
      { type: 'range', key: 'ahf_A', label: 'Aktif harmonik filtre (AHF) anma akımı', min: 0, max: 600, step: 10, unit: 'A', help: '0 = yok. İdeal akım kaynağı: anma akımına kadar yük harmoniklerini oransal bastırır.' },
      { type: 'toggle', key: 'doorOpen', label: 'Pano kapakları açık' }
    ] });
    groups.push({ title: 'Kondansatör kademeleri (' + n + ')', items: [
      { type: 'custom', render: (box, a) => {
        const list = VS.el('div', { class: 'vs-cl', style: n > 10 ? 'max-height:320px;overflow:auto' : null });
        const act = r && r.values.steps;
        s.steps.forEach((q, i) => {
          const on = act ? !!act[i] : false, fu = at(s.stepFuse, i, false), lo = at(s.stepLoss, i, 0);
          const pend = s.mode === 'auto' && c && c.pending && c.pending.i === i;
          const row = VS.el('div', { class: 'vs-cl__row' + (i === sel ? ' is-sel' : ''), 'data-level': fu ? 'bad' : pend || lo > 0 ? 'warn' : on ? 'ok' : '' });
          const pick = VS.el('button', { type: 'button', class: 'vs-cl__name', 'aria-pressed': i === sel ? 'true' : 'false', title: 'Düzenle' }, [
            VS.el('i', { 'aria-hidden': 'true', style: on || fu ? null : 'background:#475569' }),
            VS.el('span', { text: 'K' + (i + 1) + ' · ' + fmt(q, q % 1 ? 1 : 0, 'kVAr') }),
            VS.el('small', { text: (fu ? 'koruma açık · ' : '') + (lo > 0 ? '%' + fmt(lo, 0) + ' kayıp · ' : '') + (on ? 'devrede' : 'devre dışı') + (pend ? ' · röle bekliyor' : '') })
          ]);
          pick.onclick = () => { a.state.sel = i; a.renderControls(); a.invalidate(); };
          const sw = VS.el('button', { type: 'button', class: 'vs-cl__sw', 'aria-pressed': on ? 'true' : 'false', disabled: s.mode === 'auto' ? true : undefined,
            'aria-label': 'Kademe ' + (i + 1) + (on ? ' devreden çıkar' : ' devreye al'), text: s.mode === 'auto' ? (on ? 'OTO ●' : 'OTO') : (on ? 'Açık' : 'Kapalı') });
          sw.onclick = () => { syncArrays(a.state); a.state.manualOn[i] = !a.state.manualOn[i]; a.renderControls(); a.invalidate(); };
          row.appendChild(pick); row.appendChild(sw);
          list.appendChild(row);
        });
        box.appendChild(list);
        const add = VS.el('div', { class: 'vs-btns' });
        const push = (vals) => { if (a.state.steps.length + vals.length > MAX_STEPS) { VS.toast('En çok ' + MAX_STEPS + ' kademe.'); return; } a.state.steps = a.state.steps.concat(vals); syncArrays(a.state); a.state.sel = a.state.steps.length - 1; a.renderControls(); a.invalidate(); };
        add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: '+ Kademe', onclick: () => push([25]) }));
        add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: '+ 4 kademe', onclick: () => push([25, 25, 50, 50]) }));
        add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: '1:2:4:4… dizisi', onclick: () => {
          const tot = sum(a.state.steps), m = Math.max(4, a.state.steps.length);
          const w = [1, 2, 4].concat(Array(m - 3).fill(4)), sw = sum(w);
          a.state.steps = w.map(k => Math.max(2.5, Math.round(tot * k / sw / 2.5) * 2.5)); a.state.stepLoss = []; a.state.stepFuse = []; a.state.manualOn = []; syncArrays(a.state); a.renderControls(); a.invalidate();
        } }));
        box.appendChild(add);
      } },
      { type: 'text', key: 'steps', label: 'Kademe listesi (kVAr, virgül veya boşlukla)', format: v => v.map(x => fmt(x, x % 1 ? 1 : 0)).join('; '), parse: v => { const a = numList(0.5, 2000)(v); if (!a.length) throw new Error('En az bir kademe gerekli.'); if (a.length > MAX_STEPS) throw new Error('En çok ' + MAX_STEPS + ' kademe.'); return a; }, rebuild: true, help: 'Örnek: 10; 20; 40; 60; 60; 80. Kayıp, sigorta ve manuel durumları sıra numarasıyla korunur.' },
      { type: 'range', key: 'steps.' + sel, label: 'K' + (sel + 1) + ' kademe gücü (anma)', min: 0.5, max: 400, step: 0.5, unit: 'kVAr', digits: 1, report: false },
      { type: 'range', key: 'stepLoss.' + sel, label: 'K' + (sel + 1) + ' kapasitans kaybı (yaşlanma)', min: 0, max: 100, step: 1, unit: '%', report: false, help: 'Q ∝ C: kayıp oranında kademe gücü azalır; %10 üzeri değişim önerilir.' },
      { type: 'buttons', items: [
        { label: at(s.stepFuse, sel, false) ? 'K' + (sel + 1) + ' sigortayı değiştir' : 'K' + (sel + 1) + ' sigorta attı', variant: at(s.stepFuse, sel, false) ? 'primary' : 'warn', onClick: a => { syncArrays(a.state); a.state.stepFuse[sel] = !a.state.stepFuse[sel]; a.renderControls(); a.invalidate(); } },
        { label: 'Seçili kademeyi sil', variant: 'danger', onClick: a => {
          if (a.state.steps.length <= 1) return;
          syncArrays(a.state);
          ['steps', 'stepLoss', 'stepFuse', 'manualOn'].forEach(k => a.state[k].splice(sel, 1));
          a.state.sel = Math.max(0, sel - 1); a.renderControls(); a.invalidate();
        } }] },
      r ? { type: 'note', html: 'Gerekli <b>' + fmt(r.values.Qneed, 1, 'kVAr') + '</b> · kurulu <b>' + fmt(sum(s.steps), 1, 'kVAr') + '</b> · kullanılabilir <b>' + fmt(sum(r.x.eff), 1, 'kVAr') + '</b> · röle hedefi <b>' + fmt(r.targetQ, 1, 'kVAr') + '</b> · koruma ' + PROT[s.prot] + ' ' + fuseFor(s.steps[sel], s.U_LL, s.prot) + ' A (K' + (sel + 1) + ', tipik)' } : null
    ] });
    groups.push({ title: 'Şönt reaktör kademeleri', items: [
      { type: 'text', key: 'shuntSteps', label: 'Şönt reaktör kademeleri (kVAr; boş = yok)', format: v => (v || []).map(x => fmt(x, x % 1 ? 1 : 0)).join('; '), parse: v => (String(v).trim() ? numList(0.5, 1000)(v).slice(0, 12) : []), rebuild: true,
        help: 'Tesis kendi başına kapasitifken (Ql < kapasitif yük) röle reaktör kademelerini devreye alır (hafif yük, uzun kablo, UPS/LED).' },
      r && (s.shuntSteps || []).length ? { type: 'note', html: 'Devrede: <b>' + fmt(r.x.shuntQ, 1, 'kVAr') + '</b> (' + r.x.shuntOn.map((o, i) => 'R' + (i + 1) + (o ? ' ●' : ' ○')).join(' ') + ')' } : null
    ] });
    groups.push({ title: 'Günlük yük profili (24 sa)', items: [
      { type: 'select', key: 'dayProfile', label: 'Profil', options: Object.keys(KC.PROFILES).map(k => [k, KC.PROFILES[k].label]) },
      { type: 'toggle', key: 'dayClock', label: 'Gün simülasyonu (1 saat = 3 s, röle çalışıyor)', rebuild: true },
      r ? { type: 'note', html: 'Günlük oranlar: endüktif <b>%' + fmt(r.x.day.indPct, 1) + '</b> (sınır %' + r.x.day.limit.ind + ') · kapasitif <b>%' + fmt(r.x.day.capPct, 1) + '</b> (sınır %' + r.x.day.limit.cap + ')' } : null
    ] });
    groups.push({ title: 'Harmonik spektrum', collapsed: true, summary: 'Yük harmonik akımları (% I1)', items: [
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
    if (s.mode === 'manual') { app.live.events.push('Manuel mod: kademeleri listeden veya 3D’de kademeye tıklayarak anahtarlayın.'); return; }
    app.live.ctrl = newCtrl(s.steps.map(() => false));
    app.live.ctrl.msg = 'Röle ölçüyor…';
    app.live.events.push('Röle sıfırlandı: tüm kademeler devre dışı, hedef kombinasyona ' + (isFast(s) ? 'tristörlerle anında' : 'kademe kademe') + ' gidiliyor.');
    if (VS.app === app) app.renderControls();
    app.invalidate();
  }
  function tick(app, dt) {
    const s = app.state, L = app.live, res = app.validResult;
    if (!res || !res.x) return false;
    let changed = false;
    if (s.dayClock) {
      const h0 = Math.floor(L.hour); L.hour = (L.hour + dt / 3) % 24;
      if (Math.floor(L.hour) !== h0) { app.invalidate(); changed = true; }
    }
    L.histT += dt;
    if (L.histT > 0.25) { L.histT = 0; L.hist.push([s.dayClock ? L.hour : (L.ctrl ? L.ctrl.t : app.simTime), res.values.Qnet]); if (L.hist.length > 240) L.hist.shift(); changed = true; }
    const c = L.ctrl;
    if (s.mode !== 'auto' || !c || !res.target || c.on.length !== s.steps.length) return changed;
    const sdt = dt * (s.accel || 1);
    c.t += sdt;
    c.discharge = c.discharge.map(x => Math.max(0, x - sdt));
    const tgt = res.target, eff = res.x.eff;
    const tQ = sum(eff.filter((q, i) => tgt[i])), aQ = sum(eff.filter((q, i) => c.on[i]));
    const differs = c.on.some((o, i) => o !== tgt[i]);
    const say = m => { if (c.msg !== m) { c.msg = m; changed = true; } };
    if (!differs) { if (c.pending) { c.pending = null; if (VS.app === app) app.renderControls(); } say('Hedef kombinasyon devrede'); return changed; }
    // ölü bant: fark 0,65·C/k eşdeğerinin altındaysa ve kapasitif değilse anahtarlama yapılmaz
    if (Math.abs(tQ - aQ) < 0.65 * res.x.qmin && res.values.Qnet >= 0) { c.pending = null; say('Tolerans bandında (±0,65·C/k), anahtarlama yok'); return changed; }
    if (isFast(s)) {
      c.on = tgt.slice(); c.pending = null; L.events.push('t = ' + fmt(c.t, 0) + ' s · tristörlü kademeler hedefe anında ayarlandı');
      app.invalidate(); if (VS.app === app) app.renderControls(); return true;
    }
    const bySize = (a, b) => eff[b] - eff[a];
    const offs = c.on.map((o, i) => i).filter(i => c.on[i] && !tgt[i]).sort(bySize);
    const ons = c.on.map((o, i) => i).filter(i => !c.on[i] && tgt[i]).sort(bySize);
    const act = offs.length ? { i: offs[0], on: false } : { i: ons[0], on: true };
    if (!c.pending || c.pending.i !== act.i || c.pending.on !== act.on) { c.pending = { i: act.i, on: act.on, left: s.delay_s }; if (VS.app === app) app.renderControls(); }
    const p = c.pending;
    p.left = Math.max(0, p.left - sdt);
    const dis = p.on ? c.discharge[p.i] : 0;
    if (p.left <= 0 && dis <= 0) {
      c.on[p.i] = p.on;
      if (!p.on) c.discharge[p.i] = s.discharge_s;
      L.events.push('t = ' + fmt(c.t, 0) + ' s · Kademe ' + (p.i + 1) + ' (' + fmt(eff[p.i], eff[p.i] % 1 ? 1 : 0) + ' kVAr)' + (p.on ? ' devreye alındı' : ' devreden çıkarıldı'));
      if (L.events.length > 50) L.events.shift();
      c.pending = null;
      app.invalidate();
      if (VS.app === app) app.renderControls();
    } else say('Kademe ' + (p.i + 1) + (p.on ? ' devreye: ' : ' devreden çıkıyor: ') + (p.left > 0 ? fmt(p.left, 0) + ' s bekleme' : '') + (dis > 0 ? (p.left > 0 ? ' · ' : '') + 'deşarj kilidi ' + fmt(dis, 0) + ' s' : ''));
    return true;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live) {
    const v = res.values, x = res.x;
    const onN = v.steps.filter(Boolean).length;
    const regC = chk(res, 'reg'), thdC = chk(res, 'thdv'), capC = chk(res, 'capI'), resC = chk(res, 'res') || chk(res, 'tune'), cosC = chk(res, 'cos');
    const out = [];
    if (x.hour !== null) out.push({ label: 'Gün simülasyonu', wide: true, value: String(x.hour).padStart(2, '0') + ':00 · P = ' + fmt(x.P, 0, 'kW'), sub: KC.PROFILES[s.dayProfile].label + ' · yük çarpanı ' + fmt(x.P / s.P_kW, 2) });
    out.push(
      { label: 'Endüktif reaktif güç Ql', value: fmt(v.Ql, 1, 'kVAr'), sub: 'P = ' + fmt(x.P, 0, 'kW') + ' · cosφ1 ' + fmt(s.cos1, 2) },
      { label: 'Gerekli Qc', value: fmt(v.Qneed, 1, 'kVAr'), sub: 'cosφ ' + fmt(s.cos1, 2) + ' → ' + fmt(s.cos2, 3) },
      { label: 'Devredeki Qc', value: fmt(v.QcNom, 1, 'kVAr'), sub: onN + '/' + s.steps.length + ' kademe · kullanılabilir ' + fmt(sum(x.eff), 1) + ' kVAr' },
      { label: 'Net reaktif güç', value: fmt(v.Qnet, 1, 'kVAr'), sub: v.state + (x.shuntQ > 0 ? ' · şönt ' + fmt(x.shuntQ, 1) + ' kVAr' : ''), level: v.Qnet < 0 ? 'warn' : undefined },
      { label: 'Yeni cosφ', value: fmt(v.cosNew, 3) + (v.Qnet < 0 ? ' kap.' : ' end.'), level: lvOf(cosC) },
      { label: 'Reaktif / aktif (anlık)', value: '%' + fmt(Math.abs(v.reRatio), 1) + (v.reRatio < 0 ? ' kap.' : ' end.'), sub: 'EPDK sınırı %' + (v.reRatio < 0 ? v.reLimit.cap : v.reLimit.ind), level: lvOf(regC) },
      { label: 'Günlük oran · endüktif', value: '%' + fmt(x.day.indPct, 1), sub: 'sınır %' + x.day.limit.ind + ' · ' + fmt(x.day.kWh, 0) + ' kWh/gün', level: x.day.indOk ? 'ok' : 'bad' },
      { label: 'Günlük oran · kapasitif', value: '%' + fmt(x.day.capPct, 1), sub: 'sınır %' + x.day.limit.cap + ' · ' + fmt(x.day.kvarhCap, 0) + ' kVArh', level: x.day.capOk ? 'ok' : 'bad' },
      { label: 'THDi · yük', value: '%' + fmt(v.THDiLoad, 1), sub: x.ahf ? 'AHF sonrası (%' + fmt(x.ahf.k * 100, 0) + ' bastırma)' : 'I1 = ' + fmt(v.I1, 0, 'A') },
      { label: 'THDi · şebeke (trafo)', value: '%' + fmt(v.THDiSupply, 1), level: v.THDiSupply > v.THDiLoad * 1.05 ? 'warn' : undefined, sub: v.THDiSupply > v.THDiLoad ? 'kondansatör harmonikleri büyütüyor' : 'kondansatör kolu harmonik çekiyor' },
      { label: 'THDv · AG bara', value: '%' + fmt(v.THDv, 2), level: lvOf(thdC), sub: 'EN 50160 istatistiksel sınır %8' },
      v.QcNom > 0 ? { label: 'Paralel rezonans', value: 'h ≈ ' + fmt(v.hPar, 2) + ' · ' + fmt(v.hPar * 50, 0, 'Hz'), level: lvOf(resC), sub: s.detune > 0 ? 'kol ayarı ' + fmt(v.hRes * 50, 0) + ' Hz (p %' + fmt(s.detune, s.detune % 1 ? 2 : 0) + ')' : 'reaktörsüz grup' }
        : { label: 'Paralel rezonans', value: '—', sub: 'devrede kondansatör yok' },
      { label: 'Kondansatör akımı', value: v.QcNom > 0 ? fmt(v.capOver, 2) + ' × In' : '—', level: lvOf(capC), sub: 'IEC 60831-1: sürekli ≤ 1,3·In' },
      { label: 'Gerilim yükselmesi', value: '%' + fmt(x.dU, 2), sub: 'ΔU ≈ Qc/Sk · Sk ' + fmt(x.Sk / 1e3, 1) + ' MVA', level: x.dU > 3 ? 'warn' : undefined },
      { label: 'Akım azalması', value: v.I1 > 0 ? '%' + fmt((1 - v.Inew / v.I1) * 100, 1) : '—', sub: fmt(v.I1, 0) + ' A → ' + fmt(v.Inew, 0) + ' A', level: v.Inew < v.I1 ? 'ok' : undefined }
    );
    const c = live.ctrl;
    out.push({ label: 'Reaktif güç rölesi · ' + (s.program === 'optimal' ? 'en iyi kombinasyon' : 'sıralı') + (isFast(s) ? ' · tristör' : ''), wide: true, value: s.mode === 'manual' ? 'Manuel mod' : c ? c.msg : '—',
      level: s.mode === 'auto' && c && c.pending ? 'warn' : s.ctPos === 'load' ? 'bad' : undefined,
      sub: live.events.length ? live.events[live.events.length - 1] : 'C/k ' + fmt(x.ck, 3) + ' A · AT ' + s.ctRatio + '/5 A' });
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
    const p = s.detune / 100, zs = [], zc = [];
    let zmax = 0;
    for (let h = 1; h <= 25.0001; h += 0.1) { const z = busZ(v, p, h); zs.push([h, z.Zs * 1e3]); zc.push([h, z.Z * 1e3]); zmax = Math.max(zmax, z.Z * 1e3); }
    const ymax = Math.min(zmax, Math.max(25 * v.Xs * 1e3 * 2.2, 1)) * 1.08;
    ch.push({ id: 'zbus', title: 'Bara empedansı |Z(h)| · paralel rezonans', height: 170,
      series: [
        { name: 'Yalnız trafo |Zs|', color: 'grey', dash: [5, 4], width: 1.5, data: zs },
        { name: 'Trafo ∥ kondansatör kolu', color: 'cyan', area: true, data: zc.map(d => [d[0], Math.min(d[1], ymax)]) }
      ],
      markers: v.QcNom > 0 ? [{ x: v.hPar, label: 'h ≈ ' + fmt(v.hPar, 1) + ' (' + fmt(v.hPar * 50, 0) + ' Hz)', color: '#fcd34d' }] : [],
      x: { min: 1, max: 25, ticks: [1, 3, 5, 7, 11, 13, 17, 19, 23, 25], label: 'h' }, y: { label: 'mΩ', min: 0, max: ymax },
      alt: 'Trafo reaktansı Xs = ' + fmt(v.Xs * 1e3, 2) + ' mΩ. ' + (v.QcNom > 0 ? 'Paralel rezonans h ≈ ' + fmt(v.hPar, 2) + '; tepe empedans ' + fmt(zmax, 1) + ' mΩ' + (zmax > ymax ? ' (grafikte kırpıldı)' : '') + '.' : 'Devrede kondansatör yok.') });
    const day = res.x.day;
    ch.push({ id: 'day', title: 'Günlük profil · P ve şebekeden çekilen Q (röle ideal)', height: 160,
      series: [
        { name: 'P (kW)', type: 'bar', color: 'grey', width: 0.7, data: day.hours.map(h => [h.h, h.P]) },
        { name: 'Q net (kVAr)', color: 'amber', width: 2, data: day.hours.map(h => [h.h, h.Q]) }
      ],
      hLines: [{ y: 0, color: '#94a3b8' }],
      markers: res.x.hour !== null ? [{ x: res.x.hour, label: String(res.x.hour).padStart(2, '0') + ':00', color: '#fcd34d' }] : [],
      x: { min: -0.6, max: 23.6, ticks: [0, 4, 8, 12, 16, 20], fmt: x => String(x).padStart(2, '0'), label: 'saat' }, y: { label: 'kW / kVAr' },
      alt: 'Günlük ' + fmt(day.kWh, 0) + ' kWh; endüktif ' + fmt(day.kvarhInd, 0) + ' kVArh (%' + fmt(day.indPct, 1) + ', sınır %' + day.limit.ind + '); kapasitif ' + fmt(day.kvarhCap, 0) + ' kVArh (%' + fmt(day.capPct, 1) + ', sınır %' + day.limit.cap + ').' });
    const Qb = v.Ql - s.Qcap_kvar;
    ch.push({ id: 'pq', title: 'Güç üçgeni · kompanzasyon öncesi / sonrası', height: 150,
      series: [
        { name: 'Önce', type: 'bar', color: 'grey', width: 0.36, offset: -0.5, data: [[1, res.x.P], [2, Qb], [3, Math.hypot(res.x.P, Qb)]] },
        { name: 'Sonra', type: 'bar', color: 'green', width: 0.36, offset: 0.5, data: [[1, res.x.P], [2, v.Qnet], [3, v.S]] }
      ],
      x: { min: 0.4, max: 3.6, ticks: [1, 2, 3], fmt: x => ['', 'P (kW)', 'Q (kVAr)', 'S (kVA)'][x] || '' }, y: { label: 'kW / kVAr / kVA' },
      alt: 'Önce Q ' + fmt(Qb, 1) + ' kVAr, S ' + fmt(Math.hypot(res.x.P, Qb), 1) + ' kVA; sonra Q ' + fmt(v.Qnet, 1) + ' kVAr, S ' + fmt(v.S, 1) + ' kVA.' });
    if (live.hist.length > 2) ch.push({ id: 'trend', title: 'Röle davranışı · şebekeden çekilen Q', series: [{ name: 'Q net (kVAr)', color: 'amber', area: true, data: live.hist.slice() }],
      hLines: [{ y: 0, label: 'Q = 0', color: '#94a3b8' }], x: { label: s.dayClock ? 'saat' : 's' }, y: { label: 'kVAr' }, alt: 'Kademeler devreye girdikçe şebekeden çekilen reaktif güç basamaklı olarak değişir.' });
    return ch;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  const S = { w: 0.8, h: 2.0, d: 0.6, plinth: 0.1 };
  const Y = { bus: 2.0, fuse: 1.85, cont: 1.64, can: 1.2, reac: 0.48 };
  function rebuildOn(s) { return [s.steps.join(','), s.detune > 0, (s.shuntSteps || []).join(','), s.Sr_kVA, s.prot, s.switching, s.ahf_A > 0, s.ctPos].join('|'); }
  const cansOf = q => Math.max(1, Math.min(4, Math.ceil(q / 25)));
  /** Yerleşim: ayarlı panoda bölüm başına 2 kademe (reaktörler altta), reaktörsüz panoda 4 kademe (2 × 2). */
  function layout(s) {
    const det = s.detune > 0, per = det ? 2 : 4, n = s.steps.length, nCap = Math.ceil(n / per), nSh = Math.ceil((s.shuntSteps || []).length / 3);
    return { det: det, per: per, nCap: nCap, nSh: nSh, nSec: 1 + nCap + nSh };
  }

  function inst(k, geo, mat, list, parent) {
    const T = k.T, im = new T.InstancedMesh(geo, mat, Math.max(1, list.length)), d = new T.Object3D();
    list.forEach((it, i) => { d.position.fromArray(it.p); d.rotation.set(...(it.r || [0, 0, 0])); d.scale.fromArray(it.s || [1, 1, 1]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.count = list.length; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true;
    parent.add(im); return im;
  }
  /** Üç bacaklı demir nüveli reaktör (yerel koordinat, sargılar instanced listeye eklenir). */
  function reactor(k, parent, x, y, z, sc, coilList) {
    const M = k.mats, g = k.group(parent, x, y, z); g.scale.setScalar(sc);
    k.box(0.3, 0.04, 0.1, M.darkSteel, 0, 0.105, 0, g); k.box(0.3, 0.04, 0.1, M.darkSteel, 0, -0.105, 0, g);
    k.box(0.32, 0.012, 0.13, M.galv, 0, -0.135, 0, g);
    for (let j = 0; j < 3; j++) { const lx = -0.095 + j * 0.095; k.box(0.05, 0.17, 0.05, M.darkSteel, lx, 0, 0, g); coilList.push({ p: [x + lx * sc, y, z], s: [sc, sc, sc] }); k.box(0.016, 0.03, 0.01, M.copper, lx, 0.14, 0.03, g); }
    k.box(0.2, 0.028, 0.03, M.plasticDark, 0, 0.14, 0.045, g);
    const hit = k.box(0.34, 0.32, 0.14, new k.T.MeshBasicMaterial({ visible: false }), 0, 0, 0, g); hit.castShadow = false;
    return g;
  }
  /** Kademe anahtarı: kontaktör (ön yükleme dirençli blok) veya tristör modülü (soğutuculu). */
  function switchDev(k, parent, x, y, z, fast) {
    const M = k.mats, g = k.group(parent, x, y, z);
    if (fast) {
      k.rbox(0.11, 0.14, 0.09, 0.006, M.plasticDark, 0, 0, 0, g);
      for (let j = 0; j < 7; j++) k.box(0.004, 0.12, 0.05, M.alu, -0.045 + j * 0.015, 0, -0.07, g);
      k.box(0.07, 0.03, 0.004, M.plasticGrey, 0, 0.035, 0.047, g);
    } else {
      k.rbox(0.1, 0.13, 0.11, 0.008, M.plasticGrey, 0, 0, 0, g);
      k.box(0.09, 0.035, 0.03, M.plasticDark, 0, 0.075, 0.02, g);
      for (let j = 0; j < 3; j++) k.box(0.006, 0.02, 0.006, M.copper, -0.03 + j * 0.03, 0.075, 0.04, g);
      k.box(0.07, 0.05, 0.004, M.plasticWhite, 0, -0.015, 0.057, g);
    }
    const ind = k.box(0.022, 0.014, 0.008, M.ledOff, 0, 0.02, fast ? 0.05 : 0.058, g);
    const hit = k.box(0.18, 0.32, 0.14, new k.T.MeshBasicMaterial({ visible: false }), 0, -0.03, 0, g); hit.castShadow = false;
    return { g: g, ind: ind };
  }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    const lay = layout(s), n = s.steps.length, det = lay.det, fast = isFast(s);
    const W = lay.nSec * S.w, x0 = -W / 2;
    const sc = { steps: [], doors: [], fans: [], ledsDoor: [], secLbl: [], shunt: [] };
    app.scene3 = sc;
    k.ground(60, k.mat(0x4a525b, { roughness: 0.45, metalness: 0.1 }), 0);
    const grid = new T.GridHelper(60, 120, 0x3d4650, 0x3d4650); grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.22; grid.userData.noClip = true; v.root.add(grid);
    const wall = k.box(W + 14, 3.4, 0.1, k.mat(0x8b96a3, { roughness: 0.9 }), 0, 1.7, -0.62); wall.userData.noClip = true;

    // ---- gövde
    const body = k.group(null, 0, 0, 0);
    k.box(W, S.plinth, S.d - 0.02, M.plasticDark, 0, S.plinth / 2, 0, body);
    k.shell(k.box(W + 0.02, 0.03, S.d + 0.02, M.panelRAL7035, 0, S.plinth + S.h + 0.015, 0, body));
    k.box(W, S.h, 0.02, M.panelRAL7035, 0, S.plinth + S.h / 2, -S.d / 2 + 0.01, body);
    k.shell(k.box(0.02, S.h, S.d, M.panelRAL7035, x0 + 0.01, S.plinth + S.h / 2, 0, body));
    k.shell(k.box(0.02, S.h, S.d, M.panelRAL7035, -x0 - 0.01, S.plinth + S.h / 2, 0, body));
    for (let i = 1; i < lay.nSec; i++) { k.box(0.025, S.h, 0.03, M.darkSteel, x0 + i * S.w, S.plinth + S.h / 2, S.d / 2 - 0.02, body); k.box(0.006, S.h - 0.1, S.d - 0.1, M.galv, x0 + i * S.w, S.plinth + S.h / 2, -0.02, body); }
    for (let j = 0; j < 3; j++) k.box(W - 0.06, 0.03, 0.008, M.copper, 0, Y.bus - j * 0.05, -0.24, body);
    for (let x = x0 + 0.1; x < -x0; x += 0.8) k.box(0.035, 0.17, 0.04, M.plasticRed, x, Y.bus - 0.05, -0.265, body);
    // katmanlar (patlatılmış görünüm: anahtarlama → kondansatör → reaktör)
    const gSw = k.group(body), gCap = k.group(body), gReac = k.group(body);
    k.explodable(gSw, [0, 0, 0.6]); k.explodable(gCap, [0, 0, 0.38]); k.explodable(gReac, [0, 0, 0.18]);
    const hitMat = new T.MeshBasicMaterial({ visible: false });
    const fuseList = [], canList = [], capTop = [], coilList = [];
    const canGeo = new T.CylinderGeometry(0.042, 0.042, 0.25, 22), capGeo = new T.CylinderGeometry(0.03, 0.034, 0.026, 14);
    const fuseGeo = new T.BoxGeometry(0.03, 0.064, 0.032), coilGeo = new T.CylinderGeometry(0.044, 0.044, 0.17, 22, 1, true), coilEndGeo = new T.CylinderGeometry(0.044, 0.044, 0.004, 22);
    const coilMat = k.mat(0x9a5a2e, { roughness: 0.42, metalness: 0.55 });

    // ---- bölüm kapakları ve çatı fanları
    for (let si = 0; si < lay.nSec; si++) {
      const cx = x0 + S.w * (si + 0.5);
      const g = k.group(body, cx, 0, 0);
      k.box(S.w - 0.08, S.h - 0.3, 0.01, M.galv, 0, S.plinth + (S.h - 0.3) / 2 + 0.05, -S.d / 2 + 0.035, g);
      const pivot = k.group(g, -S.w / 2 + 0.01, 0, S.d / 2);
      if (si === 0) {
        k.shell(k.box(S.w - 0.02, 0.62, 0.02, M.panelRAL7035, 0, 1.79, S.d / 2 + 0.01, g));
        k.shell(k.box(S.w - 0.02, 1.36, 0.022, M.panelRAL7035, S.w / 2 - 0.01, S.plinth + 0.69, 0.011, pivot));
        k.box(0.02, 0.14, 0.03, M.plasticDark, S.w - 0.07, 0.9, 0.035, pivot);
      } else {
        k.shell(k.box(S.w - 0.02, S.h - 0.02, 0.022, M.panelRAL7035, S.w / 2 - 0.01, S.plinth + S.h / 2, 0.011, pivot));
        k.box(0.02, 0.16, 0.03, M.plasticDark, S.w - 0.07, S.plinth + S.h / 2, 0.035, pivot);
        const fan = k.group(g, 0, S.plinth + S.h + 0.03, -0.02);
        k.box(0.34, 0.1, 0.02, M.panelRAL7035, 0, 0.05, 0.16, fan); k.box(0.34, 0.1, 0.02, M.panelRAL7035, 0, 0.05, -0.16, fan);
        k.box(0.02, 0.1, 0.34, M.panelRAL7035, 0.16, 0.05, 0, fan); k.box(0.02, 0.1, 0.34, M.panelRAL7035, -0.16, 0.05, 0, fan);
        for (let r = 0; r < 9; r++) k.box(0.3, 0.006, 0.012, M.darkSteel, 0, 0.1, -0.13 + r * 0.032, fan);
        const imp = k.group(fan, 0, 0.05, 0);
        for (let b = 0; b < 5; b++) { const bl = k.box(0.12, 0.006, 0.04, M.plasticDark, 0.06, 0, 0, null); const arm = new T.Group(); arm.rotation.y = b / 5 * Math.PI * 2; bl.rotation.x = 0.35; arm.add(bl); imp.add(arm); }
        k.pickable(fan, 'Çatı fanı ve termostat', () => ['Termostat (tipik 30–35 °C) fanı çalıştırır; kapı altındaki filtreli ızgaradan hava alınır.', 'Kondansatör ömrü sıcaklığa çok duyarlıdır (IEC 60831-1 sıcaklık sınıfı −25/D: ortam ≤ 45 °C tepe, ≤ 35 °C 24 sa ort.).', det ? 'Ayarlı reaktör kayıpları kondansatörün birkaç katıdır; cebri havalandırma gerekir.' : '']);
        sc.fans.push({ imp: imp, sec: si });
      }
      for (let r = 0; r < 7; r++) k.box(0.3, 0.008, 0.004, M.darkSteel, S.w / 2, S.plinth + 0.12 + r * 0.025, 0.024, pivot);
      sc.doors.push(pivot);
      const isSh = si > lay.nCap;
      const tag = k.screen(0.2, 0.045, 256, (gx, w, h) => { gx.fillStyle = '#f4f4f0'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#111'; gx.font = 'bold 26px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText(si === 0 ? '+K0 GİRİŞ' : isSh ? '+R' + (si - lay.nCap) + ' REAKTÖR' : '+K' + si + ' KADEME', w / 2, h / 2); }, pivot);
      tag.position.set(S.w / 2, si === 0 ? 1.32 : S.plinth + S.h - 0.12, 0.024);
    }
    const nm = k.screen(Math.min(1.3, W * 0.5), 0.09, 512, (gx, w, h) => { gx.fillStyle = '#0a1628'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#fcd34d'; gx.font = 'bold 38px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText(det ? 'HARMONİK FİLTRELİ KOMPANZASYON' : 'KOMPANZASYON PANOSU', w / 2, h / 2); });
    nm.position.set(0, S.plinth + S.h + 0.075, S.d / 2 - 0.02);

    // ---- giriş bölümü
    const xi = x0 + S.w / 2;
    const ld = k.group(gSw, xi, 1.7, -0.14);
    k.rbox(0.34, 0.26, 0.16, 0.012, M.plasticDark, 0, 0, 0, ld);
    for (let j = 0; j < 3; j++) fuseList.push({ p: [xi - 0.1 + j * 0.1, 1.7, -0.05] });
    k.pickable(ld, 'Sigortalı yük ayırıcı (giriş)', () => { const tot = sum(s.steps); return ['Toplam kurulu ' + fmt(tot, 1, 'kVAr') + ' · anma akımı ≈ ' + fmt(stepI(tot, s.U_LL), 0, 'A'), 'Kondansatör devreleri harmonik ve tolerans payıyla ≥ 1,3·In akım taşıyacak şekilde boyutlandırılır.']; });
    for (let j = 0; j < 4; j++) k.rbox(0.017, 0.085, 0.07, 0.004, M.plasticWhite, xi - 0.15 + j * 0.019, 1.3, -0.22, gSw);
    k.box(S.w - 0.16, 0.035, 0.008, M.galv, xi, 1.3, -0.26, body);
    k.tube([[xi + 0.12, 2.5, -0.16], [xi + 0.12, 2.13, -0.16], [xi + 0.1, 1.86, -0.15]], 0.028, M.cableBlack, body);
    // ön levha: röle, kademe lambaları, döner kol
    const relayG = k.group(body, xi - 0.12, 1.86, S.d / 2 + 0.02);
    k.box(0.15, 0.15, 0.012, M.plasticDark, 0, 0, 0, relayG);
    const scr = k.screen(0.128, 0.104, 256, (gx, w, h) => drawRelay(gx, w, h, app), relayG, { emissive: 0.9 });
    scr.position.set(0, 0.012, 0.0065);
    for (let j = 0; j < 4; j++) k.box(0.018, 0.01, 0.004, M.plasticGrey, -0.045 + j * 0.03, -0.062, 0.008, relayG);
    sc.relay = scr;
    k.pickable(relayG, 'Reaktif güç rölesi (RGR)', () => { const r = app.validResult, c = app.live.ctrl; return r ? ['cosφ = ' + fmt(r.values.cosNew, 3) + ' (' + r.values.state + ') · hedef ' + fmt(s.cos2, 3), 'Program: ' + (s.program === 'optimal' ? 'en iyi kombinasyon' : 'sıralı') + ' · ' + (isFast(s) ? 'tristör' : 'gecikme ' + s.delay_s + ' s · deşarj kilidi ' + s.discharge_s + ' s'), 'C/k ≈ ' + fmt(r.x.ck, 3) + ' A · AT ' + s.ctRatio + '/5 A (' + (s.ctPos === 'giris' ? 'tesis girişi' : 'yük çıkışı — hatalı') + ')', s.mode === 'auto' && c ? c.msg : 'Manuel mod'] : []; },
      a => [
        { label: a.state.mode === 'auto' ? 'Manuel moda al' : 'Otomatiğe al', onClick: x => { if (x.state.mode === 'auto') { syncArrays(x.state); x.state.manualOn = x.live.ctrl ? x.live.ctrl.on.slice() : manualArr(x.state); x.state.mode = 'manual'; } else { x.live.ctrl = newCtrl(manualArr(x.state)); x.state.mode = 'auto'; } } },
        { label: 'Hedef cosφ −0,01', onClick: x => { x.state.cos2 = Math.max(0.9, Math.round((x.state.cos2 - 0.01) * 1000) / 1000); } },
        { label: 'Hedef cosφ +0,01', onClick: x => { x.state.cos2 = Math.min(1, Math.round((x.state.cos2 + 0.01) * 1000) / 1000); } },
        { label: a.state.program === 'optimal' ? 'Program: sıralı' : 'Program: en iyi', onClick: x => { x.state.program = x.state.program === 'optimal' ? 'linear' : 'optimal'; } }
      ]);
    k.label('Reaktif güç rölesi', relayG, [0, 0.11, 0.02], 'vs-label--sm');
    const cols = n > 12 ? 12 : 6, lsp = 0.36 / cols;
    for (let i = 0; i < n; i++) sc.ledsDoor.push(k.sphere(lsp > 0.04 ? 0.009 : 0.006, M.ledOff, xi + 0.02 + (i % cols) * lsp, 1.92 - Math.floor(i / cols) * 0.03, S.d / 2 + 0.025, body));
    const rot = k.group(body, xi + 0.2, 1.62, S.d / 2 + 0.02);
    k.box(0.09, 0.09, 0.008, M.plasticYellow, 0, 0, 0, rot);
    k.box(0.022, 0.08, 0.03, M.plasticRed, 0, 0, 0.018, rot);

    // ---- kondansatör kademeleri
    s.steps.forEach((q, i) => {
      const si = 1 + Math.floor(i / lay.per), j = i % lay.per, col = j % 2, row = Math.floor(j / 2);
      const cx = x0 + S.w * (si + 0.5) + (col ? 0.19 : -0.19), dy = row * -0.92;
      k.box(0.012, Y.bus - (Y.fuse + dy) - 0.03, 0.006, M.copper, cx - 0.04 - row * 0.02, (Y.bus + Y.fuse + dy) / 2, -0.23, body);
      // koruma: NH altlık + 3 bıçaklı sigorta veya MCCB
      let blow;
      if (s.prot === 'mccb') {
        const mc = k.rbox(0.105, 0.13, 0.08, 0.006, M.plasticDark, cx, Y.fuse + dy, -0.19, gSw); void mc;
        k.box(0.03, 0.04, 0.03, M.plasticBlue, cx, Y.fuse + dy, -0.14, gSw);
        blow = k.box(0.03, 0.012, 0.006, M.ledRed, cx + 0.03, Y.fuse + dy + 0.045, -0.148, gSw);
      } else {
        k.box(0.16, 0.12, 0.03, M.plasticDark, cx, Y.fuse + dy, -0.2, gSw);
        for (let m = 0; m < 3; m++) fuseList.push({ p: [cx - 0.05 + m * 0.05, Y.fuse + dy, -0.17] });
        blow = k.box(0.018, 0.012, 0.006, M.ledRed, cx - 0.05, Y.fuse + dy + 0.035, -0.152, gSw);
      }
      const sw = switchDev(k, gSw, cx, Y.cont + dy, -0.17, fast);
      k.pickable(sw.g, () => 'K' + (i + 1) + ' · ' + (fast ? 'tristör modülü' : 'kondansatör kontaktörü'), () => stepInfo(app, i, 'cont'), a => stepActions(a, i));
      if (!col) sc.secLbl[si] = sc.secLbl[si] || [];
      const nc = cansOf(q), sz = 0.8 + Math.min(q / nc, 50) / 50 * 0.25;
      const cans = [];
      for (let m = 0; m < nc; m++) {
        const x = cx + (m - (nc - 1) / 2) * 0.088;
        cans.push(canList.length);
        canList.push({ p: [x, Y.can + dy, -0.12], s: [1, sz, 1] });
        capTop.push({ p: [x, Y.can + dy + 0.125 * sz + 0.013, -0.12] });
      }
      const ch = k.box(0.36, 0.3, 0.12, hitMat, cx, Y.can + dy, -0.12, gCap, { noShadow: true }); ch.castShadow = false;
      k.pickable(ch, () => 'K' + (i + 1) + ' · kondansatörler', () => stepInfo(app, i, 'cap'), a => stepActions(a, i));
      k.tube([[cx + 0.03, Y.cont + dy - 0.07, -0.15], [cx + 0.05, Y.cont + dy - 0.2, -0.15], [cx + 0.03, Y.can + dy + 0.18, -0.13]], 0.007, M.cableBlack, gCap);
      if (det) {
        const rg = reactor(k, gReac, cx, Y.reac, -0.1, 0.8 + Math.min(q, 100) / 100 * 0.4, coilList);
        k.pickable(rg, () => 'K' + (i + 1) + ' · ayarlı reaktör', () => stepInfo(app, i, 'reac'), a => stepActions(a, i));
        k.tube([[cx - 0.05, Y.cont - 0.07, -0.15], [cx - 0.16, Y.cont - 0.3, -0.16], [cx - 0.16, Y.reac + 0.3, -0.16], [cx - 0.08, Y.reac + 0.16, -0.08]], 0.007, M.cableBlack, gReac);
        k.tube([[cx + 0.08, Y.reac + 0.16, -0.08], [cx + 0.16, Y.reac + 0.4, -0.16], [cx + 0.15, Y.can - 0.1, -0.16], [cx + 0.1, Y.can - 0.14, -0.13]], 0.007, M.cableBlack, gReac);
        if (i === 0) k.label('Ayarlı reaktör · p %' + fmt(s.detune, s.detune % 1 ? 2 : 0), rg, [0, 0.2, 0.05], 'vs-label--sm');
      }
      sc.steps.push({ ind: sw.ind, cans: cans, blow: blow, sec: si });
    });
    for (let si = 1; si <= lay.nCap; si++) sc.secLbl[si] = k.label('K', null, [x0 + S.w * (si + 0.5), Y.cont + 0.17, -0.1], 'vs-label--sm');
    // ---- şönt reaktör kademeleri (ayrı bölümler, bölüm başına 3)
    (s.shuntSteps || []).forEach((q, i) => {
      const si = 1 + lay.nCap + Math.floor(i / 3), cx = x0 + S.w * (si + 0.5), y = 1.55 - (i % 3) * 0.6;
      const sw = switchDev(k, gSw, cx - 0.22, y + 0.05, -0.17, false);
      const rg = reactor(k, gReac, cx + 0.08, y, -0.1, 0.9 + Math.min(q, 100) / 100 * 0.5, coilList);
      k.tube([[cx - 0.22, y - 0.03, -0.15], [cx - 0.1, y - 0.05, -0.12], [cx - 0.05, y + 0.1, -0.1]], 0.007, M.cableBlack, gReac);
      k.pickable(rg, () => 'R' + (i + 1) + ' · şönt reaktör ' + fmt(q, 1, 'kVAr'), () => { const r = app.validResult; return ['Endüktif kademe: tesis kapasitifken röle devreye alır.', r ? (r.x.shuntOn[i] ? 'Devrede' : 'Devre dışı') + ' · toplam şönt ' + fmt(r.x.shuntQ, 1, 'kVAr') : '', 'Akım ≈ ' + fmt(stepI(q, s.U_LL), 1, 'A')]; });
      sc.shunt.push({ ind: sw.ind });
      if (i === 0) k.label('Şönt reaktörler', rg, [0, 0.22, 0.05], 'vs-label--sm');
    });
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
    k.rbox(tw, th, td, 0.03, M.trafoPaint, 0, 0.1 + th / 2, 0, tr);
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
    for (let j = 0; j < 4; j++) { const bx = -tw * 0.3 + j * tw * 0.2; k.cyl(0.032, 0.036, 0.12, M.porcelainGrey, bx, topY + 0.06, td * 0.28, tr, 12); k.box(0.05, 0.08, 0.012, M.copper, bx, topY + 0.16, td * 0.28, tr); }
    const tp = k.screen(0.22, 0.13, 256, (gx, w, h) => { gx.fillStyle = '#d9dde1'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#111'; gx.font = 'bold 22px Arial'; gx.fillText('TRAFO ' + s.Sr_kVA + ' kVA', 10, 30); gx.font = '18px Arial'; gx.fillText('Dyn11 · 34,5/0,4 kV', 10, 62); gx.fillText('uk = %' + fmt(s.uk, 1), 10, 92); gx.fillText('ONAN', 10, 120); }, tr);
    tp.position.set(tw * 0.25, 0.1 + th * 0.65, td / 2 + 0.002);
    k.pickable(tr, 'Besleme trafosu', () => { const r = app.validResult; return r ? ['Sr = ' + s.Sr_kVA + ' kVA · uk = %' + fmt(s.uk, 1) + ' · Sk ≈ ' + fmt(r.x.Sk / 1e3, 1) + ' MVA', 'Xs = uk·U²/Sr = ' + fmt(r.values.Xs * 1e3, 2) + ' mΩ (50 Hz), Rs = Xs/8', 'Şebeke harmonik akımı: THDi %' + fmt(r.values.THDiSupply, 1), 'Yüklenme ≈ %' + fmt(r.values.S / s.Sr_kVA * 100, 0)] : []; });
    sc.trafoLbl = k.label('Trafo', tr, [0, topY + 0.42, 0]);

    // ---- aktif harmonik filtre (isteğe bağlı) ve VFD
    let xNext = -x0 + 0.45;
    if (s.ahf_A > 0) {
      const af = k.group(null, xNext + 0.3, 0, 0);
      k.box(0.6, 0.1, 0.48, M.plasticDark, 0, 0.05, 0, af);
      k.shell(k.rbox(0.6, 2.0, 0.5, 0.01, k.mat(0x2f3b4a, { metalness: 0.3, roughness: 0.5 }), 0, 1.1, 0, af));
      for (let r = 0; r < 9; r++) k.box(0.4, 0.008, 0.006, M.darkSteel, 0, 1.75 + r * 0.025, 0.254, af);
      const as = k.screen(0.16, 0.1, 128, (gx, w, h) => { gx.fillStyle = '#04121f'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#22d3ee'; gx.font = 'bold 22px monospace'; gx.fillText('AHF', 8, 28); gx.fillStyle = '#e2e8f0'; gx.font = '18px monospace'; gx.fillText(s.ahf_A + ' A', 8, 58); }, af, { emissive: 0.8 });
      as.position.set(0, 1.35, 0.262);
      k.pickable(af, 'Aktif harmonik filtre', () => { const r = app.validResult; return r && r.x.ahf ? ['Anma ' + s.ahf_A + ' A · yük harmonik akımı ' + fmt(r.x.ahf.Ih, 0) + ' A → %' + fmt(r.x.ahf.k * 100, 0) + ' bastırma', 'Model: anma akımına kadar ideal, oransal akım kaynağı. Tepki süresi, anahtarlama frekansı kayıpları ve rezonans etkileşimi modellenmez.'] : []; },
        () => [{ label: 'AHF’yi devre dışı bırak', variant: 'warn', onClick: a => { a.state.ahf_A = 0; } }, { label: 'Anma +50 A', onClick: a => { a.state.ahf_A = Math.min(600, a.state.ahf_A + 50); } }]);
      k.label('Aktif harmonik filtre', af, [0, 2.2, 0], 'vs-label--sm');
      xNext += 0.8;
    }
    const xV = xNext + 0.3;
    const vf = k.group(null, xV, 0, 0);
    k.box(0.6, 0.1, 0.48, M.plasticDark, 0, 0.05, 0, vf);
    k.shell(k.rbox(0.6, 2.0, 0.5, 0.01, M.panelDark, 0, 1.1, 0, vf));
    for (let r = 0; r < 9; r++) { k.box(0.4, 0.008, 0.006, M.darkSteel, 0, 0.3 + r * 0.025, 0.254, vf); k.box(0.4, 0.008, 0.006, M.darkSteel, 0, 1.75 + r * 0.025, 0.254, vf); }
    k.box(0.16, 0.2, 0.01, M.plasticDark, 0, 1.3, 0.255, vf);
    const kp = k.screen(0.12, 0.07, 128, (gx, w, h) => { gx.fillStyle = '#0b2a1a'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#4ade80'; gx.font = 'bold 26px monospace'; gx.fillText('50.0 Hz', 8, 32); gx.font = '16px monospace'; gx.fillText('RUN  6P', 8, 58); }, vf, { emissive: 0.8 });
    kp.position.set(0, 1.34, 0.262);
    k.pickable(vf, 'Doğrusal olmayan yük · VFD panosu', () => { const r = app.validResult; return r ? ['6 darbeli diyot doğrultuculu frekans konvertörleri (örnek)', 'Yük akımı THDi %' + fmt(r.values.THDiLoad, 1) + ' · 5. harmonik %' + fmt(s.harmonics[5] || 0, 1), 'Harmonik akım kaynağı olarak modellenir; bara gerilimi Vh = Ih·|Z(h)|.'] : []; },
      () => [{ label: 'DC şok ekle (spektrum)', onClick: a => { a.state.harmonics = Object.assign({}, SPECTRA.vfd6c.h); } }, { label: 'Şoksuz sürücü', variant: 'warn', onClick: a => { a.state.harmonics = Object.assign({}, SPECTRA.vfd6.h); } }]);
    k.label('VFD · doğrusal olmayan yük', vf, [0, 2.2, 0]);

    // ---- kablo tavası, kablolar, akım trafosu
    const trayY = 2.62, trayZ = -0.25, tx0 = xT, tx1 = xV;
    k.box(tx1 - tx0 + 0.3, 0.008, 0.3, M.galv, (tx0 + tx1) / 2, trayY, trayZ);
    k.box(tx1 - tx0 + 0.3, 0.06, 0.008, M.galv, (tx0 + tx1) / 2, trayY + 0.03, trayZ + 0.15); k.box(tx1 - tx0 + 0.3, 0.06, 0.008, M.galv, (tx0 + tx1) / 2, trayY + 0.03, trayZ - 0.15);
    for (let x = tx0; x <= tx1 + 0.01; x += 1.2) k.box(0.04, 0.04, 0.36, M.galv, x, trayY - 0.03, trayZ - 0.03);
    const supplyPts = [[xT - tw * 0.1, topY + 0.2, zT + td * 0.28], [xT - tw * 0.1, trayY + 0.05, trayZ + 0.05], [xi + 0.12, trayY + 0.05, trayZ + 0.05], [xi + 0.12, 2.15, -0.16]];
    const sup = k.tube(supplyPts, 0.03, M.cableBlack, v.root);
    const vfdPts = [[xV, 2.1, -0.05], [xV, trayY + 0.05, trayZ - 0.05], [xT + tw * 0.1, trayY + 0.05, trayZ - 0.05], [xT + tw * 0.1, topY + 0.2, zT + td * 0.28]];
    k.tube(vfdPts, 0.026, M.cableBlack, v.root);
    const ct = new T.Mesh(new T.TorusGeometry(0.06, 0.02, 10, 24), M.plasticDark);
    if (s.ctPos === 'giris') ct.position.set(xT - tw * 0.1, trayY - 0.35, trayZ + 0.05 + (zT + td * 0.28 - trayZ - 0.05) * 0.15);
    else { ct.position.set(xV, 2.35, -0.05 + (trayZ - 0.05 + 0.05) * 0.5); }
    ct.rotation.x = Math.PI / 2; ct.castShadow = true; v.root.add(ct);
    k.pickable(ct, () => 'Akım trafosu ' + s.ctRatio + '/5 A · ' + (s.ctPos === 'giris' ? 'tesis girişi' : 'yük çıkışı (hatalı)'), () => ['Röle akımı L1 fazından ölçer; gerilim ölçümü L2–L3 (faz açısı röle ayarında tanımlı).', s.ctPos === 'giris' ? 'Doğru konum: yük + kondansatör toplam akımı görülür.' : 'Hatalı konum: kondansatör akımı görülmez → röle tüm kademeleri devreye alır.', 'C/k = Qmin/(√3·U)/(AT oranı) — röle tepki eşiğini belirler.'],
      () => [{ label: s.ctPos === 'giris' ? 'Yük çıkışına taşı (hatalı montaj)' : 'Tesis girişine taşı', variant: s.ctPos === 'giris' ? 'warn' : 'primary', onClick: a => { a.state.ctPos = a.state.ctPos === 'giris' ? 'load' : 'giris'; } }]);
    k.label('AT ' + s.ctRatio + '/5', ct, [0, 0.12, 0], 'vs-label--sm');
    sc.flowSup = k.flow(sup.userData.curve, 26, 0xfcd34d, 0.016);
    sc.flowHarm = k.flow(new T.CatmullRomCurve3(vfdPts.map(p => new T.Vector3(p[0], p[1] + 0.035, p[2])), false, 'catmullrom', 0.2), 22, 0xa78bfa, 0.014);

    app.def.scene.bounds = [xT - tw / 2 - 0.2, xV + 0.5];
    const span = (xV + 0.35) - (xT - tw / 2);
    v.setView({ target: [(xV + 0.35 + xT - tw / 2) / 2, 1.0, 0], r: span * 0.88 + 1.9, theta: 0.32, phi: 1.22, limits: { rMin: 0.8, rMax: Math.max(22, span * 2.5) } });
    v.setShadowBox(Math.max(5, span * 0.75), 40);
    v.sun.position.set(3, 8, 7);
  }

  function stepInfo(app, i, part) {
    const s = app.state, r = app.validResult;
    const q = s.steps[i]; if (q === undefined || !r) return [];
    const on = !!r.values.steps[i], qe = r.x.eff[i], Ic = stepI(q, s.U_LL);
    const health = at(s.stepFuse, i, false) ? ' · KORUMA AÇIK' : at(s.stepLoss, i, 0) > 0 ? ' · %' + fmt(at(s.stepLoss, i, 0), 0) + ' kapasite kaybı → ' + fmt(qe, 1, 'kVAr') : '';
    const base = ['K' + (i + 1) + ': ' + fmt(q, 1, 'kVAr') + ' · ' + (on ? 'devrede' : 'devre dışı') + ' · Ic ≈ ' + fmt(Ic, 1, 'A') + health];
    if (part === 'cont') return base.concat([isFast(s) ? 'Tristör modülü: sıfır gerilim geçişinde anahtarlama, gecikme ve deşarj beklemesi yok; kayıp ≈ 1 W/A, soğutucu gerekir.' : 'Kondansatör tipi kontaktör (AC-6b): ön yükleme dirençli erken kapanan kontaklar ani akımı sınırlar.', PROT[s.prot] + ' · tipik ' + fuseFor(q, s.U_LL, s.prot) + ' A (' + (s.prot === 'nhaM' ? '≈ 1,4·Ic' : '≈ 1,6·Ic') + ')', s.mode === 'auto' && app.live.ctrl && app.live.ctrl.pending && app.live.ctrl.pending.i === i ? 'Röle: ' + app.live.ctrl.msg : '']);
    if (part === 'cap') return base.concat([cansOf(q) + ' adet üç fazlı kuru tip kondansatör (temsili) · deşarj dirençleri uçlarda', 'Akım yüklenmesi (harmonik dahil): ' + fmt(r.values.capOver, 2) + '×In · sınır 1,3×In (IEC 60831-1)', s.detune > 0 ? 'Ayarlı grupta kondansatör gerilimi U/(1 − p) ≈ ' + fmt(s.U_LL / (1 - s.detune / 100), 0, 'V') + '; anma gerilimi buna göre seçilir.' : 'Reaktörsüz grup: paralel rezonans h ≈ ' + fmt(r.values.hPar, 2)]);
    const f = KC.detunedFilter({ U_LL: s.U_LL, Q_kvar: q, p: s.detune / 100 });
    return base.concat(f ? ['L = ' + fmt(f.L_mH, 3) + ' mH/faz · XL = ' + fmt(f.XL * 1e3, 1) + ' mΩ · reaktör gücü ≈ ' + fmt(f.Qreactor_kvar, 2) + ' kVAr', 'C = ' + fmt(f.C_uF, 0) + ' µF (yıldız) · Uc = ' + fmt(f.Uc, 0) + ' V → anma ' + f.UcN + ' V', 'Ayar frekansı ' + fmt(f.fr, 0) + ' Hz (h = ' + fmt(f.hr, 2) + ') · kademe paralel rezonansı h ≈ ' + fmt(r.values.hPar, 2)] : []);
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
    const n = s.steps.length, perRow = Math.min(n, 16), bw = (w - 20) / perRow - 2, rows = Math.ceil(n / perRow), bh = Math.min(30, 44 / rows - 2);
    s.steps.forEach((q, i) => {
      const x = 10 + (i % perRow) * (bw + 2), y = 116 + Math.floor(i / perRow) * (bh + 2), on = r.steps[i], pend = c && c.pending && c.pending.i === i && s.mode === 'auto';
      g.fillStyle = at(s.stepFuse, i, false) ? '#7f1d1d' : on ? '#22c55e' : pend && Math.floor(performance.now() / 300) % 2 ? '#f59e0b' : '#1e293b'; g.fillRect(x, y, bw, bh);
      if (bw >= 12 && rows === 1) { g.fillStyle = '#cbd5e1'; g.font = '11px monospace'; g.fillText(String(i + 1), x + bw / 2 - (i >= 9 ? 6 : 3), 166); }
    });
    if (s.mode === 'auto' && c && c.pending) { g.fillStyle = '#f59e0b'; g.font = 'bold 14px monospace'; g.fillText((c.pending.on ? '↑ K' : '↓ K') + (c.pending.i + 1) + ' ' + fmt(Math.max(c.pending.left, c.pending.on ? c.discharge[c.pending.i] : 0), 0) + ' s', 12, h - 12); }
  }

  /* sahne güncelleme */
  const COL = {};
  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc || !res.x) return;
    const v = res.values, M = k.mats, T = k.T;
    if (!COL.on) { COL.on = new T.Color(1, 1, 1); COL.off = new T.Color(0.32, 0.34, 0.37); COL.hot = new T.Color(1, 0.55, 0.25); COL.aged = new T.Color(0.62, 0.48, 0.3); COL.dead = new T.Color(0.25, 0.12, 0.1); }
    const c = live.ctrl;
    s.steps.forEach((q, i) => {
      const st = sc.steps[i]; if (!st) return;
      const on = !!v.steps[i], pend = s.mode === 'auto' && c && c.pending && c.pending.i === i, fu = at(s.stepFuse, i, false), lo = at(s.stepLoss, i, 0);
      st.ind.material = fu ? M.ledRed : on ? M.ledGreen : pend ? M.ledAmber : M.ledOff;
      st.blow.visible = fu;
      const col = fu ? COL.dead : lo > 0 ? COL.aged : on ? (v.capOver > 1.3 ? COL.hot : COL.on) : COL.off;
      st.cans.forEach(ci => sc.canIM.setColorAt(ci, col));
      if (sc.ledsDoor[i]) sc.ledsDoor[i].material = fu ? M.ledRed : on ? M.ledGreen : pend ? M.ledAmber : M.ledOff;
    });
    if (sc.canIM.instanceColor) sc.canIM.instanceColor.needsUpdate = true;
    (sc.shunt || []).forEach((r, i) => { r.ind.material = res.x.shuntOn[i] ? M.ledGreen : M.ledOff; });
    // bölüm etiketleri: kısa biçim (● devrede, ○ dışarıda, ◐ bekliyor, ✕ koruma açık)
    sc.secLbl.forEach((l, si) => {
      if (!l || !l.set) return;
      const per = layout(s).per, ids = []; for (let j = 0; j < per; j++) { const i = (si - 1) * per + j; if (i < s.steps.length) ids.push(i); }
      const mark = i => (at(s.stepFuse, i, false) ? '✕' : v.steps[i] ? '●' : s.mode === 'auto' && c && c.pending && c.pending.i === i ? '◐' : '○');
      l.set(ids.map(i => 'K' + (i + 1) + mark(i)).join(' '));
      l.level(ids.some(i => at(s.stepFuse, i, false)) ? 'bad' : ids.some(i => mark(i) === '◐') ? 'warn' : ids.some(i => v.steps[i]) ? 'ok' : '');
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
    sc.doors.forEach((d, i) => { const tt = target * (1 - (i % 4) * 0.015); d.rotation.y += (tt - d.rotation.y) * Math.min(1, dt * 4); });
    const per = layout(s).per;
    sc.fans.forEach(f => {
      let on = false; for (let j = 0; j < per; j++) if (res.values.steps[(f.sec - 1) * per + j]) on = true;
      if (f.sec > layout(s).nCap && res.x) on = res.x.shuntQ > 0;
      f.spd = (f.spd || 0) + ((on ? 14 : 0) - (f.spd || 0)) * Math.min(1, dt * 1.5);
      if (!k.reducedMotion) f.imp.rotation.y += f.spd * dt;
    });
    sc.rt = (sc.rt || 0) + dt;
    if (sc.rt > 0.3) { sc.rt = 0; sc.relay.redraw(); }
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması (çok kademede satırlara sarılır) */
  function view2d(g, W, H, res, s, live) {
    const v = res.values, x = res.x;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', cu: '#c77b4a', vio: '#a78bfa' };
    g.lineWidth = 2; g.font = '12px Inter, sans-serif'; g.textAlign = 'center';
    const R = W - 76; // sağdaki görünüm araç çubuğuna taşmasın
    const tx = Math.max(60, W * 0.1), oy = 52, by = 112 + oy;
    g.strokeStyle = col.line; g.beginPath(); g.arc(tx, 36 + oy, 13, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(tx, 56 + oy, 13, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(tx, 22 + oy); g.lineTo(tx, 8 + oy); g.moveTo(tx, 69 + oy); g.lineTo(tx, by); g.stroke();
    g.fillStyle = col.dim; g.textAlign = 'left'; g.fillText('Trafo ' + s.Sr_kVA + ' kVA · uk %' + fmt(s.uk, 1) + ' · Xs ' + fmt(v.Xs * 1e3, 2) + ' mΩ', tx + 22, 44 + oy);
    g.strokeStyle = s.ctPos === 'giris' ? col.line : col.bad; g.beginPath(); g.arc(tx, 88 + oy, 7, 0, Math.PI * 2); g.stroke();
    g.fillStyle = s.ctPos === 'giris' ? col.dim : col.bad; g.fillText('AT ' + s.ctRatio + '/5 → RGR' + (s.ctPos === 'giris' ? '' : ' (yük çıkışında — hatalı)'), tx + 12, 86 + oy);
    g.lineWidth = 5; g.strokeStyle = col.cu; g.beginPath(); g.moveTo(tx - 30, by); g.lineTo(R, by); g.stroke(); g.lineWidth = 2;
    g.fillStyle = col.dim; g.fillText('AG bara ' + s.U_LL + ' V · THDv %' + fmt(v.THDv, 2) + ' · cosφ ' + fmt(v.cosNew, 3) + ' ' + (v.Qnet < 0 ? 'kap.' : 'end.'), tx + 60, by - 10);
    // yük + AHF
    const lx = tx + 40;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(lx, by); g.lineTo(lx, by + 50); g.stroke();
    g.strokeRect(lx - 16, by + 50, 32, 32); g.beginPath(); g.moveTo(lx - 16, by + 82); g.lineTo(lx + 16, by + 50); g.stroke();
    g.fillStyle = col.text; g.textAlign = 'center'; g.fillText('VFD / yük', lx, by + 98);
    g.fillStyle = col.dim; g.fillText(fmt(x.P, 0) + ' kW', lx, by + 112); g.fillText('THDi %' + fmt(v.THDiLoad, 1), lx, by + 126);
    let xa = lx + 70;
    if (s.ahf_A > 0) { g.strokeStyle = col.line; g.beginPath(); g.moveTo(xa, by); g.lineTo(xa, by + 50); g.stroke(); g.strokeRect(xa - 16, by + 50, 32, 24); g.fillStyle = col.vio; g.fillText('AHF', xa, by + 67); g.fillStyle = col.dim; g.fillText(s.ahf_A + ' A', xa, by + 90); xa += 56; }
    // kademeler: sığmazsa alt satırlara (her satır kendi alt barasıyla)
    const n = s.steps.length, nsh = (s.shuntSteps || []).length, tot = n + nsh;
    const L2 = grid2d(W, s), perRow = L2.perRow, rows = L2.rows, rowH = ROW2D, sp = Math.min(70, (R - xa) / Math.min(tot, perRow));
    const c = live.ctrl;
    for (let rI = 0; rI < rows; rI++) {
      const ry = by + rI * rowH, first = rI * perRow, cnt = Math.min(perRow, tot - first);
      if (rI > 0) { g.strokeStyle = col.cu; g.lineWidth = 3; g.beginPath(); g.moveTo(xa - 4, by); g.lineTo(xa - 4, ry); g.lineTo(xa + (cnt - 0.5) * sp, ry); g.stroke(); g.lineWidth = 2; }
      for (let k = 0; k < cnt; k++) {
        const idx = first + k, xx = xa + (k + 0.5) * sp, isSh = idx >= n, i = isSh ? idx - n : idx;
        const on = isSh ? res.x.shuntOn[i] : !!v.steps[i], fu = !isSh && at(s.stepFuse, i, false);
        const pend = !isSh && s.mode === 'auto' && c && c.pending && c.pending.i === i;
        const lv = fu ? col.bad : on ? (!isSh && v.capOver > 1.3 ? col.bad : col.ok) : pend ? col.warn : col.dim;
        g.strokeStyle = col.line; g.beginPath(); g.moveTo(xx, ry); g.lineTo(xx, ry + 10); g.stroke();
        g.strokeStyle = fu ? col.bad : col.line; g.strokeRect(xx - 3.5, ry + 10, 7, 13);
        if (fu) { g.beginPath(); g.moveTo(xx - 5, ry + 9); g.lineTo(xx + 5, ry + 24); g.stroke(); }
        g.strokeStyle = col.line; g.beginPath(); g.moveTo(xx, ry + 23); g.lineTo(xx, ry + 31); g.stroke();
        g.strokeStyle = lv; g.beginPath(); g.moveTo(xx, ry + 31); g.lineTo(xx + (on ? 0 : 8), ry + 47); g.stroke();
        if (isFast(s) && !isSh) { g.fillStyle = lv; g.beginPath(); g.moveTo(xx - 5, ry + 35); g.lineTo(xx + 5, ry + 35); g.lineTo(xx, ry + 42); g.fill(); }
        g.strokeStyle = col.line; g.beginPath(); g.moveTo(xx, ry + 47); g.lineTo(xx, ry + 54); g.stroke();
        let y = ry + 54;
        if (isSh || s.detune > 0) { g.beginPath(); for (let j = 0; j < 3; j++) g.arc(xx, y + 4 + j * 7, 3.5, -Math.PI / 2, Math.PI / 2); g.stroke(); y += 23; }
        if (!isSh) { g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + 3); g.moveTo(xx - 8, y + 3); g.lineTo(xx + 8, y + 3); g.moveTo(xx - 8, y + 8); g.lineTo(xx + 8, y + 8); g.stroke(); y += 8; }
        g.fillStyle = lv; g.font = 'bold 10px Inter, sans-serif'; g.fillText((isSh ? 'R' : 'K') + (i + 1), xx, y + 13);
        if (sp >= 30) { g.fillStyle = col.dim; g.font = '9px Inter, sans-serif'; const q = isSh ? s.shuntSteps[i] : res.x.eff[i]; g.fillText(fmt(q, q % 1 ? 1 : 0), xx, y + 24); }
      }
    }
    // özet (kademe satırlarının altında)
    const yy = Math.max(by + rows * rowH + 18, by + 146); g.textAlign = 'left'; g.font = '12px Inter, sans-serif'; // VFD/yük etiketlerinin altında
    const lines = [
      ['Ql ' + fmt(v.Ql, 1) + ' · gerekli ' + fmt(v.Qneed, 1) + ' · devrede ' + fmt(v.QcNom, 1) + (x.shuntQ ? ' · şönt ' + fmt(x.shuntQ, 1) : '') + ' kVAr · Q net ' + fmt(v.Qnet, 1) + ' (' + v.state + ')', v.Qnet < 0 ? col.warn : col.text],
      [v.QcNom > 0 ? 'Paralel rezonans h ≈ ' + fmt(v.hPar, 2) + (s.detune > 0 ? ' · kol ayarı ' + fmt(v.hRes * 50, 0) + ' Hz' : ' · reaktörsüz') + ' · Ic ' + fmt(v.capOver, 2) + '×In · ΔU %' + fmt(x.dU, 2) : 'Devrede kondansatör yok', v.capOver > 1.3 ? col.bad : col.text],
      ['Günlük: endüktif %' + fmt(x.day.indPct, 1) + ' / ' + x.day.limit.ind + ' · kapasitif %' + fmt(x.day.capPct, 1) + ' / ' + x.day.limit.cap + ' · ' + (s.mode === 'auto' ? 'Röle: ' + (c ? c.msg : '—') : 'Manuel mod'), x.day.indOk && x.day.capOk ? col.dim : col.bad]
    ];
    lines.forEach((l, i) => { g.fillStyle = l[1]; fitText(g, l[0], 24, yy + i * 18, R - 24); });
    g.fillStyle = col.dim; g.font = '10px Inter, sans-serif'; fitText(g, 'Tek hat şeması · ' + n + ' kondansatör' + (nsh ? ' + ' + nsh + ' şönt reaktör' : '') + ' kademesi. Değerler VoltSim hesap motorundandır.', 24, H - 14, R - 24);
  }
  /** 2D yerleşim: kademe sütunları sığmazsa satırlara sarılır; çekirdek view2dHeight ile kaydırılabilir yükseklik verir. */
  const ROW2D = 118;
  function grid2d(W, s) {
    const R = W - 76, xa = Math.max(60, W * 0.1) + 110 + (s.ahf_A > 0 ? 56 : 0), tot = s.steps.length + (s.shuntSteps || []).length;
    const perRow = Math.max(1, Math.floor((R - xa) / 34));
    return { perRow: perRow, rows: Math.ceil(tot / perRow) };
  }
  function view2dHeight(W, res, s) { return 164 + grid2d(W, s).rows * ROW2D + 18 + 3 * 18 + 40; }
  function fitText(g, t, x, y, maxW) { if (g.measureText(t).width <= maxW) { g.fillText(t, x, y); return; } while (t.length > 8 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); g.fillText(t + '…', x, y); }

  /* ---------------------------------------------------------------- görevler */
  const tasks = [
    { id: 'cos95', title: 'Elle cosφ ≥ 0,95', goal: 'Manuel modda kademeleri seçerek cosφ ≥ 0,95 yapın; tesis kapasitife geçmesin.', hint: 'Gerekli Qc ≈ P·(tanφ1 − tan(acos 0,95)). 3D’de kademeye tıklayıp “Kademeyi devreye al” deyin ya da listedeki anahtarları kullanın.',
      state: { mode: 'manual', manualOn: [false, false, false, false, false, false], cos2: 0.95 },
      check: (r, s) => s.mode === 'manual' && r.values.cosNew >= 0.95 && r.values.Qnet >= 0 },
    { id: 'res7', title: '7. harmonik rezonansını giderin', goal: 'Reaktörsüz panoda paralel rezonans 7. harmoniğe yakın. Hiçbir harmonik büyümesin ve rezonans 5. harmoniğin altına insin.', hint: 'Ayarlı reaktör oranı p = %7 (189 Hz) seçin; rezonans h ≈ √(Xc/(Xs + XL)) düşer.',
      state: { Sr_kVA: 630, detune: 0 },
      check: r => r.values.QcNom > 0 && r.values.hPar < 4.5 && r.values.spectrum.every(x => x.amp <= 1.0) },
    { id: 'thdv', title: 'THDv < %5', goal: 'Şoksuz sürücülerin olduğu tesiste AG bara THDv’yi %5’in altına indirin; kondansatör akımı 1,3·In’i aşmasın.', hint: 'Yalnız ayarlı reaktör yetmez: harmonik akımı kaynağında azaltın. Aktif harmonik filtrenin anma akımını yük harmonik akımının (AHF kartında Ih) ~%75’i kadar seçin; p = %7 rezonansı önler. DC şok da yardımcı olur (VFD’ye tıklayın).',
      state: { Sr_kVA: 630, detune: 0, harmonics: Object.assign({}, SPECTRA.vfd6.h) },
      check: r => r.values.THDv < 5 && r.values.capOver <= 1.3 },
    { id: 'epdk', title: 'Gece dahil EPDK oranları', goal: 'Tek vardiyalı tesiste gece kablo/UPS kapasitif yükü günlük kapasitif oranı aşıyor. Günlük endüktif ve kapasitif oranları sınır içine alın.', hint: 'Şönt reaktör kademeleri ekleyin (örn. 20; 20; 20 kVAr) — röle tesis kapasitifken reaktörleri devreye alır.',
      state: { dayProfile: 'v1', P_kW: 150, Qcap_kvar: 60, installed_kVA: 400, Sr_kVA: 400, shuntSteps: [] },
      check: r => r.x.day.indOk && r.x.day.capOk },
    { id: 'repair', title: 'Arızalı kademeyi bulun', goal: 'cosφ hedefin altında kaldı: bir kademenin sigortası atmış, birinde kapasite kaybı var. Hedef cosφ’ye yeniden ulaşın.', hint: 'Kırmızı LED’li kademeye 3D’de tıklayıp “Sigortayı değiştir” deyin; kahverengi kaplı kademede “Kondansatörleri yenile”.',
      state: { stepFuse: [false, false, false, false, false, true], stepLoss: [0, 0, 30, 0, 0, 0] },
      check: (r, s) => r.values.cosNew >= s.cos2 - 0.005 && r.values.Qnet >= 0 && !(s.stepFuse || []).some(Boolean) },
    { id: 'ct', title: 'Akım trafosu montaj hatası', goal: 'Röle tüm kademeleri devreye alıp tesisi kapasitife götürüyor. Hatayı bulup düzeltin.', hint: 'Akım trafosuna (VFD kablosundaki halka) tıklayın: kondansatör akımını görebilmesi için tesis girişinde olmalı.',
      state: { ctPos: 'load', P_kW: 160 },
      check: (r, s) => s.ctPos === 'giris' && r.values.Qnet >= 0 }
  ];

  /* ---------------------------------------------------------------- senaryolar */
  const sc = (o) => Object.assign(defaults(), o);
  const nSteps = (vals) => ({ steps: vals, stepLoss: vals.map(() => 0), stepFuse: vals.map(() => false), manualOn: vals.map(() => false), sel: 0 });
  VS.register({
    id: 'komp', title: '3D Kompanzasyon ve Harmonik Simülasyonu',
    defaults: defaults,
    initLive: () => ({ ctrl: null, events: [], hist: [], histT: 0, hour: 12 }),
    autoRun: true,
    startText: 'Röle sıfırlandı: kademeler gecikme ve deşarj kilidine uyarak devreye alınıyor.',
    start: start,
    scenarios: [
      { id: 'fabrika', name: 'Fabrika · %7 ayarlı filtreli kompanzasyon', desc: '320 kW sürücü ağırlıklı tesis, 1000 kVA trafo, 6 kademe %7 detuned. Röle kademe kademe hedefe gider.', state: defaults(), start: true },
      { id: 'rezonans', name: 'Reaktörsüz grup · 7. harmonikte rezonans', desc: 'Aynı tesis 630 kVA trafodan, reaktörsüz kondansatörle: paralel rezonans 7. harmoniğe yaklaşır; THDv ve kondansatör akımı yükselir.', state: sc({ Sr_kVA: 630, detune: 0 }) },
      { id: 'buyuk', name: 'Büyük tesis · 24 kademe, tristörlü', desc: '1,4 MW tesis, 2000 kVA trafo, 24 kademe ayarlı pano; tristörlü kademeler hızlı değişen yükte anında anahtarlanır.', state: sc(Object.assign({ P_kW: 1400, Sr_kVA: 2000, installed_kVA: 2000, ctRatio: 3000, switching: 'thyristor', detune: 7 }, nSteps([12.5, 25, 25, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]))) },
      { id: 'gece', name: 'Gece hafif yük · şönt reaktör kademeleri', desc: 'Tek vardiya; gece kablo ve UPS kapasitif yükü baskın. Şönt reaktör kademeleri günlük kapasitif oranı sınırda tutar.', state: sc({ dayProfile: 'v1', P_kW: 150, Qcap_kvar: 60, installed_kVA: 400, Sr_kVA: 400, shuntSteps: [20, 20, 20], dayClock: true }) },
      { id: 'asiri', name: 'Hafif yük · aşırı kompanzasyon (manuel)', desc: 'Yük 60 kW’a düştü ama kademeler manuel açık kaldı: kapasitif çalışma ve EPDK kapasitif oran ihlali.', state: sc({ P_kW: 60, cos1: 0.85, mode: 'manual', manualOn: [true, true, true, false, false, false], harmonics: Object.assign({}, SPECTRA.mix.h) }) },
      { id: 'kucuk', name: 'Küçük işletme · kurulu güç < 50 kVA', desc: 'Kurulu güç 40 kVA: EPDK sınırları %33 endüktif / %20 kapasitif; küçük kademeli reaktörsüz pano, MCCB korumalı.', state: sc(Object.assign({ P_kW: 28, cos1: 0.78, cos2: 0.97, detune: 0, prot: 'mccb', Sr_kVA: 400, installed_kVA: 40, ctRatio: 100, harmonics: Object.assign({}, SPECTRA.mix.h) }, nSteps([2.5, 5, 5, 10]))) },
      { id: 'ahf', name: 'Aktif harmonik filtre + %14 ayarlı grup', desc: 'Şoksuz sürücüler; 150 A AHF harmonikleri bastırır, %14 ayar 3. harmonik riskine karşı tercih edilir.', state: sc({ detune: 14, ahf_A: 150, harmonics: Object.assign({}, SPECTRA.vfd6.h) }) }
    ],
    tasks: tasks,
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    reportInputs: s => s.steps.map((q, i) => ({ group: 'Kademeler', label: 'Kademe ' + (i + 1), value: fmt(q, 1, 'kVAr') + (at(s.stepLoss, i, 0) ? ' · %' + fmt(at(s.stepLoss, i, 0), 0) + ' kayıp' : '') + (at(s.stepFuse, i, false) ? ' · koruma açık' : '') + (s.mode === 'manual' ? (manualArr(s)[i] ? ' · açık' : ' · kapalı') : ' · otomatik') }))
      .concat((s.shuntSteps || []).map((q, i) => ({ group: 'Şönt reaktörler', label: 'R' + (i + 1), value: fmt(q, 1, 'kVAr') }))),
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-3, 3] },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
