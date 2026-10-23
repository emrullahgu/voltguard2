/* VoltSim · 3D Elektrik Pano Simülasyonu
 * Hesap: VoltSimEngine.pano (fazör toplamı, Iz koordinasyonu, gerilim düşümü, IEC 60909 yaklaşık kısa devre).
 * Sahne: hesap sonucunu gösterir (akım ısı rengi, açma durumu, enerji akışı, analizör ekranı). */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const P = E.pano;

  /* ---------------------------------------------------------------- devre önayarları */
  const C = (o) => Object.assign({ on: true, tripped: false, tripReason: '', kind: 'MCB', curve: 'C', In: 16, S: 2.5, L: 25, method: 'B1', rcd: 0, cos: 0.95, eff: 0.9, motor: false, cap: false, running: false, start: 'DOL', IstIn: 7 }, o);
  const PRESETS = {
    ADP: () => [
      C({ name: 'Aydınlatma', phase: 'L1', P_kW: 3.2, cos: 0.95, curve: 'B', In: 16, S: 2.5, L: 30 }),
      C({ name: 'Priz grubu', phase: 'L2', P_kW: 2.6, cos: 0.9, In: 16, S: 2.5, L: 25, rcd: 30 }),
      C({ name: 'Ofis klima', phase: 'L3', P_kW: 2.8, cos: 0.92, In: 20, S: 4, L: 25 }),
      C({ name: 'Kaynak prizi 3~', phase: '3F', P_kW: 9, cos: 0.9, In: 32, S: 6, L: 20, rcd: 30 }),
      C({ name: 'Kompresör 3~', phase: '3F', P_kW: 15, cos: 0.86, eff: 0.92, motor: true, running: true, kind: 'MCCB', In: 40, S: 10, L: 35, method: 'C', IstIn: 7 }),
      C({ name: 'Konveyör 3~', phase: '3F', P_kW: 5.5, cos: 0.82, eff: 0.89, motor: true, running: true, curve: 'D', In: 16, S: 4, L: 40, method: 'C', start: 'DOL', IstIn: 6.5 })
    ],
    MCC: () => [
      C({ name: 'Pompa 1', phase: '3F', P_kW: 11, cos: 0.85, eff: 0.91, motor: true, running: true, curve: 'D', In: 25, S: 6, L: 45, method: 'C', start: 'YD' }),
      C({ name: 'Pompa 2', phase: '3F', P_kW: 11, cos: 0.85, eff: 0.91, motor: true, running: false, curve: 'D', In: 25, S: 6, L: 50, method: 'C', start: 'YD' }),
      C({ name: 'Fan', phase: '3F', P_kW: 7.5, cos: 0.84, eff: 0.9, motor: true, running: true, curve: 'D', In: 20, S: 4, L: 30, method: 'C', start: 'VFD' }),
      C({ name: 'Karıştırıcı', phase: '3F', P_kW: 4, cos: 0.82, eff: 0.88, motor: true, running: true, curve: 'D', In: 13, S: 2.5, L: 25, method: 'C' }),
      C({ name: 'Kumanda 230 V', phase: 'L1', P_kW: 0.4, cos: 0.9, curve: 'C', In: 6, S: 1.5, L: 5 })
    ],
    KOMP: () => [
      C({ name: 'Tesis yükü 3~', phase: '3F', P_kW: 120, cos: 0.78, kind: 'MCCB', In: 250, S: 95, L: 15, method: 'E' }),
      C({ name: 'Kademe 1 · 10 kVAr', phase: '3F', P_kW: 10, cap: true, curve: 'C', In: 25, S: 6, L: 3, method: 'C', on: true }),
      C({ name: 'Kademe 2 · 20 kVAr', phase: '3F', P_kW: 20, cap: true, kind: 'MCCB', In: 50, S: 16, L: 3, method: 'C', on: true }),
      C({ name: 'Kademe 3 · 20 kVAr', phase: '3F', P_kW: 20, cap: true, kind: 'MCCB', In: 50, S: 16, L: 3, method: 'C', on: false }),
      C({ name: 'Kademe 4 · 40 kVAr', phase: '3F', P_kW: 40, cap: true, kind: 'MCCB', In: 100, S: 35, L: 3, method: 'C', on: true })
    ],
    OTOM: () => [
      C({ name: 'PLC + 24 V DC güç kaynağı', phase: 'L1', P_kW: 0.5, cos: 0.95, In: 6, S: 1.5, L: 2 }),
      C({ name: 'Saha sensörleri / valfler', phase: 'L2', P_kW: 0.8, cos: 0.9, In: 10, S: 1.5, L: 30 }),
      C({ name: 'Pano fanı + aydınlatma', phase: 'L3', P_kW: 0.2, cos: 0.9, curve: 'B', In: 6, S: 1.5, L: 3 }),
      C({ name: 'Sürücü 3~ (VFD)', phase: '3F', P_kW: 5.5, cos: 0.95, eff: 0.92, motor: true, running: true, curve: 'C', In: 16, S: 4, L: 25, method: 'C', start: 'VFD' })
    ],
    TRANSFER: () => [
      C({ name: 'Kritik aydınlatma', phase: 'L1', P_kW: 2.2, cos: 0.95, curve: 'B', In: 16, S: 2.5, L: 40 }),
      C({ name: 'Bilgi işlem UPS girişi', phase: '3F', P_kW: 18, cos: 0.95, In: 40, S: 10, L: 25, method: 'C' }),
      C({ name: 'Yangın pompası 3~', phase: '3F', P_kW: 15, cos: 0.86, eff: 0.92, motor: true, running: false, kind: 'MCCB', In: 40, S: 10, L: 30, method: 'C', start: 'YD' }),
      C({ name: 'Priz grubu', phase: 'L2', P_kW: 2, cos: 0.9, In: 16, S: 2.5, L: 30, rcd: 30 }),
      C({ name: 'Asansör 3~', phase: '3F', P_kW: 7.5, cos: 0.85, eff: 0.9, motor: true, running: true, curve: 'D', In: 25, S: 6, L: 35, method: 'C', start: 'VFD' })
    ]
  };
  const ADD = {
    light: () => C({ name: 'Aydınlatma', phase: 'L1', P_kW: 1.5, cos: 0.95, curve: 'B', In: 10, S: 1.5, L: 25 }),
    socket: () => C({ name: 'Priz', phase: 'L2', P_kW: 2, cos: 0.9, In: 16, S: 2.5, L: 25, rcd: 30 }),
    load3: () => C({ name: '3F yük', phase: '3F', P_kW: 10, cos: 0.9, In: 25, S: 6, L: 25, method: 'C' }),
    motor: () => C({ name: 'Motor 3~', phase: '3F', P_kW: 7.5, cos: 0.84, eff: 0.9, motor: true, running: false, curve: 'D', In: 20, S: 4, L: 30, method: 'C', IstIn: 7 }),
    cap: () => C({ name: 'Kondansatör kademesi', phase: '3F', P_kW: 20, cap: true, kind: 'MCCB', In: 50, S: 16, L: 3, method: 'C' })
  };
  const TYPE_LABEL = { ADP: 'Ana dağıtım panosu (ADP)', MCC: 'Motor kontrol panosu (MCC)', KOMP: 'Kompanzasyon panosu', OTOM: 'Otomasyon panosu', TRANSFER: 'Transfer (ATS) panosu' };
  const MAIN_FOR = { ADP: 160, MCC: 125, KOMP: 400, OTOM: 63, TRANSFER: 160 };

  function defaults(type) {
    type = type || 'ADP';
    return {
      panelType: type, U_LL: 400, mainKind: type === 'KOMP' ? 'ACB' : 'MCCB', mainIn: MAIN_FOR[type], mainIcu_kA: 36, busbarIn: type === 'KOMP' ? 630 : 250,
      source: 'grid', SkQ_MVA: 500, trafo_kVA: 630, trafo_uk: 4, trafo_Pk: 4600, gen_kVA: 200, gen_xd: 14,
      feedL: 25, feedS: type === 'KOMP' ? 185 : 70, feedN: 1,
      doorOpen: true, sel: 0, leak_mA: 0, circuits: PRESETS[type]()
    };
  }

  /* ---------------------------------------------------------------- yardımcılar */
  const IN_LIST = [2, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630];
  const MAIN_LIST = [40, 63, 100, 125, 160, 200, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500];
  function deviceKind(c) { return c.cap ? 'cap' : c.motor ? 'starter' : (c.kind === 'MCCB' || c.phase === '3F' && c.In > 63) ? 'mccb' : c.phase === '3F' ? 'mcb3' : 'mcb1'; }
  function cOf(app) { return app.state.circuits[app.state.sel] || app.state.circuits[0]; }
  function circuitAt(app) { return 'circuits.' + app.state.sel + '.'; }

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const c = s.circuits[s.sel];
    const sel = 'circuits.' + s.sel + '.';
    const r = app.validResult && app.validResult.values;
    const cr = r && r.circuits[s.sel];
    const groups = [];
    groups.push({ title: 'Pano', items: [
      { type: 'select', key: 'panelType', label: 'Pano tipi', options: Object.keys(TYPE_LABEL).map(k => [k, TYPE_LABEL[k]]), rebuild: true,
        onChange: (v, a) => { const d = defaults(v); a.state = Object.assign(d, { doorOpen: a.state.doorOpen }); a.live = a.def.initLive(a.state); a.renderControls(); a.invalidate(); } },
      { type: 'select', key: 'U_LL', label: 'Besleme gerilimi (faz arası)', options: [[400, '400 V (3F + N)'], [380, '380 V'], [415, '415 V'], [690, '690 V (endüstriyel)']] },
      { type: 'seg', key: 'mainKind', label: 'Ana şalter', options: [['MCCB', 'MCCB (TMŞ)'], ['ACB', 'ACB (hava devre kesici)']] },
      { type: 'select', key: 'mainIn', label: 'Ana şalter anma akımı In', options: MAIN_LIST.map(v => [v, v + ' A']) },
      { type: 'select', key: 'mainIcu_kA', label: 'Ana şalter kesme kapasitesi Icu', options: [10, 16, 25, 36, 50, 65, 85, 100].map(v => [v, v + ' kA']) },
      { type: 'select', key: 'busbarIn', label: 'Bara anma akımı', options: P.BUSBARS.map(v => [v, v + ' A']) },
      { type: 'toggle', key: 'doorOpen', label: 'Pano kapakları açık' }
    ] });
    groups.push({ title: 'Besleme', items: [
      { type: 'seg', key: 'source', label: s.panelType === 'TRANSFER' ? 'Aktif kaynak (ATS)' : 'Kaynak', options: [['grid', 'Şebeke / trafo'], ['gen', 'Jeneratör']], help: s.panelType === 'TRANSFER' ? 'Şebeke ve jeneratör kesicileri mekanik ve elektriksel kilitlidir; aynı anda kapanamaz.' : null },
      s.source === 'gen' ? { type: 'select', key: 'gen_kVA', label: 'Jeneratör gücü', options: [60, 100, 150, 200, 275, 350, 500, 750, 1000].map(v => [v, v + ' kVA']) } : { type: 'select', key: 'trafo_kVA', label: 'Besleyen trafo', options: [[250, '250 kVA'], [400, '400 kVA'], [630, '630 kVA'], [1000, '1000 kVA'], [1600, '1600 kVA'], [2500, '2500 kVA']] },
      s.source === 'gen' ? { type: 'range', key: 'gen_xd', label: "Jeneratör X''d", min: 8, max: 25, step: 0.5, unit: '%', digits: 1 } : { type: 'range', key: 'trafo_uk', label: 'Trafo uk', min: 4, max: 8, step: 0.5, unit: '%', digits: 1 },
      s.source === 'gen' ? null : { type: 'number', key: 'trafo_Pk', label: 'Trafo yük kaybı Pk', min: 0, max: 30000, step: 50, unit: 'W' },
      s.source === 'gen' ? null : { type: 'range', key: 'SkQ_MVA', label: 'OG şebeke kısa devre gücü', min: 50, max: 1000, step: 10, unit: 'MVA' },
      { type: 'range', key: 'feedL', label: 'Besleme kablosu uzunluğu', min: 1, max: 200, step: 1, unit: 'm' },
      { type: 'select', key: 'feedS', label: 'Besleme kablo kesiti (faz)', options: [16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300].map(v => [v, v + ' mm² Cu']) },
      { type: 'select', key: 'feedN', label: 'Paralel kablo sayısı', options: [1, 2, 3, 4, 6].map(v => [v, v + ' adet']) }
    ] });
    // yük grupları listesi
    groups.push({ title: 'Yük grupları', items: [
      { type: 'custom', render: (box, a) => {
        const list = VS.el('div', { class: 'vs-cl' });
        s.circuits.forEach((cc, i) => {
          const rr = r && r.circuits[i];
          const lv = cc.tripped ? 'bad' : rr && (rr.loadPct > 100 || !rr.coord) ? 'warn' : 'ok';
          const row = VS.el('div', { class: 'vs-cl__row' + (i === s.sel ? ' is-sel' : ''), 'data-level': lv });
          const pick = VS.el('button', { type: 'button', class: 'vs-cl__name', 'aria-pressed': i === s.sel ? 'true' : 'false', title: 'Düzenle' }, [
            VS.el('i', { 'aria-hidden': 'true' }), VS.el('span', { text: cc.name }), VS.el('small', { text: (cc.cap ? fmt(cc.P_kW, 0, 'kVAr') : fmt(cc.P_kW, 1, 'kW')) + ' · ' + cc.phase + (cc.tripped ? ' · AÇTI' : '') })
          ]);
          pick.onclick = () => { a.state.sel = i; a.renderControls(); a.invalidate(); };
          const sw = VS.el('button', { type: 'button', class: 'vs-cl__sw', 'aria-pressed': cc.on ? 'true' : 'false', 'aria-label': cc.name + (cc.on ? ' devresini kapat' : ' devresini aç'), text: cc.on ? 'Açık' : 'Kapalı' });
          sw.onclick = () => { cc.on = !cc.on; if (cc.on) { cc.tripped = false; cc.tripReason = ''; } if (cc.motor && cc.on && !cc.running) { /* kontaktör ayrı */ } a.renderControls(); a.invalidate(); };
          row.appendChild(pick); row.appendChild(sw);
          if (cc.motor) {
            const run = VS.el('button', { type: 'button', class: 'vs-cl__run', 'aria-pressed': cc.running ? 'true' : 'false', 'aria-label': cc.name + (cc.running ? ' motorunu durdur' : ' motorunu çalıştır'), text: cc.running ? '■' : '▶' });
            run.onclick = () => { cc.running = !cc.running; if (cc.running) { a.live.inrush[i] = 0; } a.renderControls(); a.invalidate(); };
            row.appendChild(run);
          }
          list.appendChild(row);
        });
        box.appendChild(list);
        const add = VS.el('div', { class: 'vs-btns' });
        [['light', '+ Aydınlatma'], ['socket', '+ Priz'], ['load3', '+ 3F yük'], ['motor', '+ Motor'], ['cap', '+ Kondansatör']].forEach(b => {
          add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: b[1], onclick: () => {
            if (a.state.circuits.length >= 12) { VS.toast('En çok 12 devre eklenebilir.'); return; }
            a.state.circuits.push(ADD[b[0]]()); a.state.sel = a.state.circuits.length - 1; a.live.inrush.push(-1); a.renderControls(); a.invalidate();
          } }));
        });
        box.appendChild(add);
      } }
    ] });
    if (c) {
      const isM = c.motor, isC = c.cap;
      groups.push({ title: 'Seçili devre · ' + c.name, items: [
        { type: 'text', key: sel + 'name', label: 'Devre adı', parse: v => { v = v.trim(); if (!v) throw new Error('Ad boş olamaz.'); return v.slice(0, 40); }, rebuild: true },
        isC ? null : { type: 'select', key: sel + 'phase', label: 'Faz', options: [['L1', 'L1 (1F)'], ['L2', 'L2 (1F)'], ['L3', 'L3 (1F)'], ['3F', 'Üç faz']], rebuild: true },
        { type: 'range', key: sel + 'P_kW', label: isC ? 'Kademe gücü' : isM ? 'Motor mil gücü' : 'Aktif güç', min: 0, max: isC ? 200 : c.phase === '3F' ? 250 : 12, step: c.phase === '3F' || isC ? 0.5 : 0.1, unit: isC ? 'kVAr' : 'kW', digits: 1 },
        isC ? null : { type: 'range', key: sel + 'cos', label: 'cosφ', min: 0.5, max: 1, step: 0.01, digits: 2 },
        isM ? { type: 'range', key: sel + 'eff', label: 'Motor verimi η', min: 0.7, max: 0.97, step: 0.01, digits: 2 } : null,
        isM ? { type: 'select', key: sel + 'start', label: 'Yol verme', options: [['DOL', 'Doğrudan (DOL)'], ['YD', 'Yıldız–üçgen'], ['SOFT', 'Yumuşak yol verici'], ['VFD', 'Frekans konvertörü']] } : null,
        isM ? { type: 'range', key: sel + 'IstIn', label: 'Kalkış akımı Ist/In', min: 4, max: 9, step: 0.5, digits: 1 } : null,
        { type: 'seg', key: sel + 'kind', label: 'Koruma cihazı', options: [['MCB', 'MCB (otomatik sigorta)'], ['MCCB', 'MCCB (TMŞ)']], rebuild: true },
        c.kind === 'MCB' ? { type: 'seg', key: sel + 'curve', label: 'Açma eğrisi', options: [['B', 'B'], ['C', 'C'], ['D', 'D']] } : null,
        { type: 'select', key: sel + 'In', label: 'Koruma anma akımı In', options: IN_LIST.filter(v => c.kind === 'MCB' ? v <= 63 : v >= 16).map(v => [v, v + ' A']) },
        { type: 'select', key: sel + 'S', label: 'Kablo kesiti (Cu)', options: E.CABLE_SIZES.map(v => [v, fmt(v, v % 1 ? 1 : 0) + ' mm²']) },
        { type: 'select', key: sel + 'method', label: 'Döşeme yöntemi', options: Object.keys(E.INSTALL_METHODS).map(k => [k, E.INSTALL_METHODS[k]]) },
        { type: 'range', key: sel + 'L', label: 'Kablo uzunluğu', min: 1, max: 250, step: 1, unit: 'm' },
        isC ? null : { type: 'select', key: sel + 'rcd', label: 'Kaçak akım koruması', options: [[0, 'Yok'], [30, '30 mA (hayat koruma)'], [300, '300 mA (yangın koruma)']] },
        cr ? { type: 'note', html: 'Ib <b>' + fmt(cr.Ib, 1, 'A') + '</b> · In <b>' + c.In + ' A</b> · Iz <b>' + fmt(cr.Iz, 1, 'A') + '</b> · ΔU <b>%' + fmt(cr.vd, 2) + '</b> · Ik1,min <b>' + fmt(cr.Ik1, 0, 'A') + '</b>' } : null,
        { type: 'buttons', items: [{ label: 'Devreyi sil', variant: 'danger', onClick: a => { if (a.state.circuits.length <= 1) return; a.state.circuits.splice(a.state.sel, 1); a.live.inrush.splice(a.state.sel, 1); a.state.sel = Math.max(0, a.state.sel - 1); a.renderControls(); a.invalidate(); } }] }
      ] });
    }
    groups.push({ title: 'Arıza senaryoları', items: [
      { type: 'note', text: 'Senaryolar güvenli simülasyon ortamındadır. Açma yalnızca standart sınırlarının kesin açma öngördüğü durumlarda gösterilir; süre üretici eğrisine bağlı olduğundan termik açma temsili gecikmeyle canlandırılır.' },
      { type: 'buttons', items: [
        { label: 'Aşırı yük (seçili ×1,6)', variant: 'warn', onClick: a => { const cc = cOf(a); cc.P_kW = Math.round(cc.P_kW * 1.6 * 10) / 10; cc.on = true; if (cc.motor) cc.running = true; a.renderControls(); a.invalidate(); a.running = true; a.paused = false; a.syncToolbar(); } },
        { label: 'Hat sonunda faz–PE kısa devresi', variant: 'danger', onClick: a => fault(a) },
        { label: 'Açan cihazları kur', onClick: a => { a.state.circuits.forEach(cc => { cc.tripped = false; cc.tripReason = ''; }); a.live.mainTripped = false; a.live.mainTimer = 0; a.live.timers = {}; a.live.events.push('Cihazlar kuruldu.'); a.renderControls(); a.invalidate(); } }
      ] },
      { type: 'range', key: 'leak_mA', label: 'Seçili devrede kaçak akım (yalıtım hatası)', min: 0, max: 100, step: 1, unit: 'mA', help: 'Sinüzoidal AC kaçak akım. RCD’li devrede IΔn’e ulaşınca açar; RCD yoksa dokunma riski uyarısı verilir.' }
    ] });
    return groups;
  }

  /* kısa devre senaryosu: seçili devrenin sonunda faz–PE arızası */
  function fault(app) {
    const res = app.validResult; if (!res) return;
    const i = app.state.sel, c = app.state.circuits[i], cr = res.values.circuits[i];
    const ass = E.breakerAssessment({ kind: c.kind, curve: c.curve, In: c.In, Ir: c.In, Ii: c.Ii }, cr.Ik1);
    app.live.spark = { i: i, t: 0 };
    app.running = true; app.paused = false;
    if (ass.state === 'magnetic') { trip(app, i, 'Kısa devre: manyetik açma (Ik1 ≈ ' + fmt(cr.Ik1, 0, 'A') + ')'); }
    else if (ass.state === 'thermal' || ass.state === 'magnetic-band') { app.live.timers['sc' + i] = { left: 3, reason: 'Kısa devre: ' + (ass.state === 'thermal' ? 'manyetik bölgeye ulaşılamadı, termik gecikmeli açma (temsili)' : 'manyetik bant içinde, açma süresi belirsiz') }; app.live.events.push(c.name + ': arıza akımı ' + fmt(cr.Ik1, 0, 'A') + ' — ani açma için ' + fmt(cr.Ia, 0, 'A') + ' gerekir. 0,4 s kesme koşulu sağlanmıyor!'); }
    app.live.events.push(c.name + ': hat sonunda faz–PE kısa devresi uygulandı.');
    app.syncToolbar(); app.renderControls(); app.invalidate();
  }
  function trip(app, i, reason) {
    const c = app.state.circuits[i]; if (!c || c.tripped) return;
    c.tripped = true; c.tripReason = reason; if (c.motor) c.running = false;
    app.live.events.push(c.name + ': ' + reason);
    if (VS.app === app) app.renderControls();
    app.invalidate();
  }

  /* ---------------------------------------------------------------- zaman adımı (açma davranışı, kalkış akımı) */
  function tick(app, dt) {
    const res = app.validResult; if (!res) return false;
    const L = app.live, s = app.state;
    let changed = false;
    // motor kalkış zarfı (temsili; yalnız gösterim)
    s.circuits.forEach((c, i) => { if (c.motor && c.running && L.inrush[i] >= 0 && L.inrush[i] < 3) { L.inrush[i] += dt; changed = true; } });
    // termik açma: standart kesin açma öngörüyorsa temsili gecikme sonra aç
    res.values.circuits.forEach((cr, i) => {
      const c = s.circuits[i]; if (!c || c.tripped || !cr.active) { delete L.timers['th' + i]; return; }
      const st = cr.assessment.state;
      if (st === 'magnetic') { trip(app, i, 'Manyetik (anlık) açma'); changed = true; return; }
      if (st === 'thermal') {
        const t = L.timers['th' + i] || (L.timers['th' + i] = { left: 6, reason: 'Aşırı yük: termik açma (süre temsili; üretici eğrisine bağlı)' });
        t.left -= dt; changed = true;
        if (t.left <= 0) { delete L.timers['th' + i]; trip(app, i, t.reason); }
      } else delete L.timers['th' + i];
    });
    Object.keys(L.timers).filter(k => k.slice(0, 2) === 'sc').forEach(k => {
      const t = L.timers[k]; t.left -= dt; changed = true;
      if (t.left <= 0) { delete L.timers[k]; trip(app, Number(k.slice(2)), t.reason); }
    });
    // kaçak akım
    const c = s.circuits[s.sel];
    if (c && c.on && !c.tripped && s.leak_mA > 0 && c.rcd) {
      const ra = E.rcdAssessment(c.rcd, s.leak_mA);
      if (ra.trips) { trip(app, s.sel, 'Kaçak akım rölesi açtı (' + s.leak_mA + ' mA ≥ IΔn ' + c.rcd + ' mA)'); changed = true; }
    }
    // ana şalter (TS EN 60947-2: ≥ 1,3·Ir kesin açma bölgesi)
    if (!L.mainTripped && res.values.Imax >= 1.3 * s.mainIn) {
      L.mainTimer += dt; changed = true;
      if (L.mainTimer > 8) { L.mainTripped = true; s.circuits.forEach(cc => { cc.tripped = true; cc.tripReason = 'Ana şalter açtı'; if (cc.motor) cc.running = false; }); L.events.push('Ana şalter aşırı yükte açtı (temsili süre).'); app.renderControls(); app.invalidate(); }
    } else if (!L.mainTripped) L.mainTimer = 0;
    // anlık eğilim
    L.histT += dt;
    if (L.histT > 0.25) { L.histT = 0; L.hist.push([app.simTime, res.values.Imax * inrushFactor(app)]); if (L.hist.length > 240) L.hist.shift(); changed = true; }
    if (L.spark) { L.spark.t += dt; if (L.spark.t > 1.2) L.spark = null; }
    return changed;
  }
  function inrushFactor(app) {
    // en yüklü faza kalkış akımı fazlasını ekleyen temsili çarpan (yalnız eğilim grafiği ve etiket için)
    const res = app.validResult, s = app.state; if (!res || res.values.Imax <= 0) return 1;
    let extra = 0;
    s.circuits.forEach((c, i) => {
      const t = app.live.inrush[i]; if (!c.motor || !c.running || t < 0 || t >= 1.5) return;
      const cr = res.values.circuits[i];
      extra += P.motorStartCurrent(cr.Ib, c.start, c.IstIn, t, 1.5) - cr.Ib;
    });
    return (res.values.Imax + extra) / res.values.Imax;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live, app) {
    const v = res.values, c = s.circuits[s.sel], cr = v.circuits[s.sel];
    const lvl = p => p > 100 ? 'bad' : p > 80 ? 'warn' : 'ok';
    const out = [
      { label: 'Aktif güç P', value: VS.fmtPower(v.P) },
      { label: 'Reaktif güç Q', value: fmt(v.Q / 1e3, 1, 'kVAr') },
      { label: 'Görünür güç S', value: fmt(v.S / 1e3, 1, 'kVA') },
      { label: 'Güç faktörü', value: fmt(v.pf, 3) + (v.Q < 0 ? ' kap.' : ' end.'), level: v.pf < 0.9 ? 'warn' : 'ok' },
      { label: 'L1 / L2 / L3', value: fmt(v.phases.L1, 0) + ' / ' + fmt(v.phases.L2, 0) + ' / ' + fmt(v.phases.L3, 0) + ' A', wide: true },
      { label: 'Nötr akımı', value: fmt(v.phases.N, 1, 'A') },
      { label: 'Faz dengesizliği', value: '%' + fmt(v.unbalance, 1), level: v.unbalance > 20 ? 'bad' : v.unbalance > 10 ? 'warn' : 'ok' },
      { label: 'Ana şalter yüklenmesi', value: '%' + fmt(v.loading, 0), level: lvl(v.loading), sub: live.mainTripped ? 'AÇTI' : fmt(v.Imax, 0) + ' / ' + s.mainIn + ' A' },
      { label: 'Ik3 (bara, yakl.)', value: fmt(v.Ik3 / 1e3, 2, 'kA'), level: v.Ik3 > s.mainIcu_kA * 1e3 ? 'bad' : 'ok', sub: 'ip ' + fmt(v.ip / 1e3, 1) + ' kA · ' + (v.source === 'gen' ? 'jeneratör' : 'şebeke') }
    ];
    if (c && cr) {
      out.push({ label: c.name + ' · akım', value: fmt(cr.I, 1, 'A'), sub: cr.active ? 'Yüklenme %' + fmt(cr.loadPct, 0) + ' · ' + (c.tripped ? 'AÇTI' : 'çalışıyor') : (c.tripped ? 'AÇTI: ' + c.tripReason : 'devre dışı'), level: c.tripped ? 'bad' : lvl(cr.loadPct), wide: true });
      if (c.motor) out.push({ label: 'Kalkış akımı (tepe)', value: fmt(cr.startI, 0, 'A'), sub: { DOL: 'doğrudan', YD: 'yıldız–üçgen', SOFT: 'yumuşak yol verici', VFD: 'frekans konvertörü' }[c.start] });
      if (s.leak_mA > 0) out.push({ label: 'Kaçak akım', value: fmt(s.leak_mA, 0, 'mA'), level: c.rcd ? (s.leak_mA >= c.rcd ? 'bad' : 'warn') : 'bad', sub: c.rcd ? E.rcdAssessment(c.rcd, s.leak_mA).text : 'Bu devrede RCD yok: dokunma gerilimi riski!' });
    }
    const timers = Object.keys(live.timers);
    if (timers.length) out.push({ label: 'Açma bekleniyor', value: timers.length + ' cihaz', level: 'warn', sub: live.timers[timers[0]].reason, wide: true });
    if (live.events.length) out.push({ label: 'Son olay', value: live.events[live.events.length - 1], wide: true });
    return out;
  }
  function charts(res, s, live) {
    const v = res.values;
    const ch = [{
      id: 'phase', title: 'Faz akımları ve ana şalter', type: 'bar',
      series: [{ name: 'Faz/nötr akımı (A)', type: 'bar', color: 'amber', data: [[1, v.phases.L1], [2, v.phases.L2], [3, v.phases.L3], [4, v.phases.N]] }],
      hLines: [{ y: s.mainIn, label: 'Ana şalter ' + s.mainIn + ' A', color: '#ef4444' }],
      x: { min: 0.4, max: 4.6, ticks: [1, 2, 3, 4], fmt: x => ['', 'L1', 'L2', 'L3', 'N'][x] || '' }, y: { label: 'A' },
      alt: 'L1 ' + fmt(v.phases.L1, 1) + ' A, L2 ' + fmt(v.phases.L2, 1) + ' A, L3 ' + fmt(v.phases.L3, 1) + ' A, nötr ' + fmt(v.phases.N, 1) + ' A.'
    }, {
      id: 'load', title: 'Devre yüklenmesi (I/In) ve kablo (Ib/Iz)', height: 160,
      series: [
        { name: 'I / In %', type: 'bar', color: 'cyan', width: 0.36, offset: -0.5, data: v.circuits.map((cr, i) => [i + 1, cr.loadPct]) },
        { name: 'Ib / Iz %', type: 'bar', color: 'violet', width: 0.36, offset: 0.5, data: v.circuits.map((cr, i) => [i + 1, cr.Iz > 0 ? cr.Ib / cr.Iz * 100 : 0]) }
      ],
      hLines: [{ y: 100, label: '%100', color: '#ef4444' }],
      x: { min: 0.4, max: v.circuits.length + 0.6, ticks: v.circuits.map((c, i) => i + 1), fmt: x => String(x) }, y: { label: '%' },
      alt: v.circuits.map((cr, i) => (s.circuits[i] ? s.circuits[i].name : i + 1) + ': %' + fmt(cr.loadPct, 0)).join(', ')
    }];
    if (live.hist.length > 2) ch.push({ id: 'trend', title: 'Anlık eğilim · en yüklü faz akımı (kalkış dahil)', series: [{ name: 'Imax (A)', color: 'amber', area: true, data: live.hist.slice() }], hLines: [{ y: s.mainIn, label: 'In ' + s.mainIn + ' A', color: '#ef4444' }], x: { label: 's' }, y: { label: 'A' }, alt: 'Simülasyon süresince en yüklü faz akımı.' });
    return ch;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  const S = { w: 0.8, h: 2.0, d: 0.6, plinth: 0.1 };
  function layout(s) {
    // bölümler: giriş + (gerekirse) ATS ikinci giriş + çıkış bölümleri + DIN bölümü
    const big = [], din = [];
    s.circuits.forEach((c, i) => { const k = deviceKind(c); (k === 'mcb1' || k === 'mcb3' ? din : big).push(i); });
    const sections = [{ type: 'inc' }];
    if (s.panelType === 'TRANSFER') sections.push({ type: 'inc2' });
    for (let i = 0; i < big.length; i += 4) sections.push({ type: 'feed', items: big.slice(i, i + 4) });
    if (din.length || s.panelType === 'OTOM') sections.push({ type: 'din', items: din });
    return sections;
  }
  function rebuildOn(s) { return s.panelType + '|' + s.mainKind + '|' + s.circuits.map(c => deviceKind(c) + c.phase + (c.rcd ? 'r' : '') + c.name).join(','); }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    const secs = layout(s);
    const W = secs.length * S.w;
    const x0 = -W / 2;
    const scene = {};
    app.scene3 = scene;
    scene.devices = []; scene.doors = []; scene.flows = []; scene.motors = [];
    // zemin: epoksi kaplı elektrik odası
    const floor = k.ground(30, new T.MeshStandardMaterial({ color: 0x3a434d, roughness: 0.82, metalness: 0 }), 0);
    floor.receiveShadow = true;
    const grid = new T.GridHelper(30, 60, 0x3d4650, 0x3d4650); grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.25; grid.userData.noClip = true; v.root.add(grid);
    // kablo kanalı (zemin altı) ve duvar
    k.box(W + 0.4, 0.02, 0.5, M.darkSteel, 0, 0.006, 0.55);
    // pano üstünde merdiven tipi kablo tavası (besleme kablosu buradan gelir)
    const trayY = S.plinth + S.h + 0.55;
    [-0.16, 0.16].forEach(z => k.box(W + 1.6, 0.06, 0.012, M.galv, 0.3, trayY, z - 0.05));
    for (let x = -W / 2 - 0.45; x < W / 2 + 1.05; x += 0.3) k.box(0.025, 0.012, 0.32, M.galv, x, trayY - 0.025, -0.05);
    [-W / 2 - 0.3, W / 2 + 0.9].forEach(x => k.box(0.03, 0.75, 0.03, M.galv, x, trayY + 0.4, -0.2));
    const wall = k.box(W + 6, 3.4, 0.1, new T.MeshStandardMaterial({ color: 0x8e99a6, roughness: 0.9 }), 0, 1.7, -0.75); wall.userData.noClip = true;

    // gövde
    const body = k.group(null, 0, 0, 0);
    k.box(W, S.plinth, S.d - 0.02, M.plasticDark, 0, S.plinth / 2, 0, body);
    const top = k.box(W + 0.02, 0.03, S.d + 0.02, M.panelRAL7035, 0, S.plinth + S.h + 0.015, 0, body); k.shell(top);
    const back = k.box(W, S.h, 0.02, M.panelRAL7035, 0, S.plinth + S.h / 2, -S.d / 2 + 0.01, body); void back;
    const sideL = k.box(0.02, S.h, S.d, M.panelRAL7035, x0 + 0.01, S.plinth + S.h / 2, 0, body); k.shell(sideL);
    const sideR = k.box(0.02, S.h, S.d, M.panelRAL7035, -x0 - 0.01, S.plinth + S.h / 2, 0, body); k.shell(sideR);
    for (let i = 1; i < secs.length; i++) k.box(0.025, S.h, 0.03, M.darkSteel, x0 + i * S.w, S.plinth + S.h / 2, S.d / 2 - 0.02, body);

    // baralar: L1, L2, L3, N, PE (yatay, üst bölmede, arkada)
    const busY = S.plinth + S.h - 0.18, busZ = -0.16;
    const busMat = {}; scene.busMat = busMat;
    ['L1', 'L2', 'L3', 'N', 'PE'].forEach((p, j) => {
      const m = M.copper.clone(); m.emissive = new T.Color(0x000000); busMat[p] = m;
      const y = busY - j * 0.065, z = busZ + (j >= 3 ? -0.06 : 0);
      const bar = k.box(W - 0.06, 0.04, 0.01, m, 0, y, z);
      k.pickable(bar, p + ' barası', () => { const r = app.validResult && app.validResult.values; return r ? ['Anma: ' + s.busbarIn + ' A', p === 'PE' ? 'Koruma iletkeni barası' : p === 'N' ? 'Nötr akımı: ' + fmt(r.phases.N, 1, 'A') : 'Faz akımı: ' + fmt(r.phases[p], 1, 'A'), 'TS EN IEC 61439-1: bara sıcaklık artışı tasarım doğrulamasıyla gösterilir.'] : []; });
      // renk işaret bantları
      for (let x = x0 + 0.25; x < -x0 - 0.1; x += 0.4) k.box(0.03, 0.046, 0.016, M[p], x, y, z);
      // mesnet izolatörleri
      if (j === 0) for (let x = x0 + 0.12; x < -x0; x += 0.8) k.box(0.04, 0.36, 0.05, M.plasticRed, x, busY - 0.13, busZ - 0.03);
      if (p !== 'PE') { const curve = new T.LineCurve3(new T.Vector3(x0 + 0.05, y, z + 0.012), new T.Vector3(-x0 - 0.05, y, z + 0.012)); scene.flows.push({ p: p, f: k.flow(curve, 18, p === 'N' ? 0x60a5fa : 0xfcd34d, 0.009) }); }
    });
    k.label('Baralar L1·L2·L3·N·PE', null, [x0 + 0.5, busY + 0.06, busZ]);

    // bölümler
    secs.forEach((sec, si) => {
      const cx = x0 + S.w * (si + 0.5);
      const g = k.group(body, cx, 0, 0);
      // montaj plakası
      k.box(S.w - 0.08, S.h - 0.5, 0.01, M.galv, 0, S.plinth + (S.h - 0.5) / 2 + 0.05, -S.d / 2 + 0.04, g);
      // kapak (sol menteşe)
      const pivot = k.group(g, -S.w / 2 + 0.01, 0, S.d / 2);
      const door = k.box(S.w - 0.02, S.h - 0.02, 0.022, M.panelRAL7035, S.w / 2 - 0.01, S.plinth + S.h / 2, 0.011, pivot);
      k.shell(door);
      k.box(0.02, 0.16, 0.03, M.plasticDark, S.w - 0.07, S.plinth + S.h / 2, 0.035, pivot); // kol
      // havalandırma ızgarası
      for (let r = 0; r < 6; r++) k.box(0.26, 0.008, 0.004, M.darkSteel, S.w / 2, S.plinth + 0.18 + r * 0.025, 0.024, pivot);
      scene.doors.push(pivot);
      // bölüm içerikleri
      if (sec.type === 'inc' || sec.type === 'inc2') buildIncomer(k, g, sec.type === 'inc2', s, app, scene, pivot);
      else if (sec.type === 'feed') sec.items.forEach((ci, r) => buildFeeder(k, g, ci, r, s, app, scene));
      else buildDin(k, g, sec.items, s, app, scene);
      // pano etiket plakası
      const plate = k.screen(0.22, 0.05, 256, (gx, w, h) => { gx.fillStyle = '#f4f4f0'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#111'; gx.font = 'bold 26px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText(sec.type === 'inc' ? (s.panelType === 'TRANSFER' ? '+A1 ŞEBEKE' : '+A1 GİRİŞ') : sec.type === 'inc2' ? '+A2 JENERATÖR' : sec.type === 'din' ? '+A' + (si + 1) + ' TALİ' : '+A' + (si + 1) + ' ÇIKIŞ', w / 2, h / 2); }, pivot);
      plate.position.set(S.w / 2, S.plinth + S.h - 0.12, 0.024);
    });
    // pano üstü isim plakası
    const name = k.screen(Math.min(1.2, W * 0.6), 0.09, 512, (gx, w, h) => { gx.fillStyle = '#0a1628'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#fcd34d'; gx.font = 'bold 40px Arial'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText(TYPE_LABEL[s.panelType].toUpperCase(), w / 2, h / 2); });
    name.position.set(0, S.plinth + S.h + 0.09, S.d / 2 - 0.05);
    // motorlar zeminde (pano yanında)
    let mi = 0;
    s.circuits.forEach((c, i) => {
      if (!c.motor) return;
      const mx = -x0 + 0.7 + (mi % 2) * 0.9, mz = 0.2 + Math.floor(mi / 2) * 0.9; mi++;
      scene.motors.push(buildMotor(k, mx, mz, i, c, app));
    });
    // kapasite hesapları için kesit sınırları
    app.def.scene.bounds = [x0 - 0.1, -x0 + 0.1];
    const span = Math.max(W, 2.4);
    v.setView({ target: [mi ? 0.3 : 0, 1.05, 0], r: span * 0.9 + 1.7, theta: 0.07, phi: 1.28, limits: { rMin: 0.8, rMax: 14 } });
    // pano içi aydınlatma (kapak açıkken iç ekipman okunur olsun)
    const inner = new T.PointLight(0xfff4e0, 3.2, 6, 2); inner.position.set(0, S.plinth + S.h - 0.1, 0.9); v.root.add(inner);
    v.setShadowBox(Math.max(4, span), 30);
    v.sun.position.set(4, 7, 6);
  }

  function devLabel(k, obj, text) { return k.label(text, obj, [0, 0.07, 0.05], 'vs-label--sm'); }

  function buildIncomer(k, g, second, s, app, scene, door) {
    const M = k.mats, T = k.T;
    const acb = s.mainKind === 'ACB';
    const y = S.plinth + 1.05;
    const dev = k.group(g, 0, y, -0.12);
    const isGen = second, active = s.panelType === 'TRANSFER' ? (isGen ? s.source === 'gen' : s.source === 'grid') : true;
    if (acb) {
      k.rbox(0.42, 0.42, 0.34, 0.02, M.plasticDark, 0, 0, 0, dev);
      k.box(0.36, 0.3, 0.02, M.plasticGrey, 0, 0, 0.18, dev);
      const on = k.box(0.05, 0.035, 0.02, M.plasticGreen, -0.1, 0.08, 0.195, dev); void on;
      k.box(0.05, 0.035, 0.02, M.plasticRed, -0.1, 0.02, 0.195, dev);
      k.box(0.12, 0.04, 0.01, M.plasticWhite, 0.07, 0.08, 0.195, dev);
    } else {
      k.rbox(0.21, 0.32, 0.12, 0.01, M.plasticDark, 0, 0, 0, dev);
      k.box(0.13, 0.2, 0.02, M.plasticGrey, 0, 0, 0.065, dev);
    }
    const handle = k.box(acb ? 0.03 : 0.05, acb ? 0.06 : 0.09, 0.05, M.plasticBlue, acb ? 0.12 : 0, acb ? -0.06 : 0, acb ? 0.2 : 0.09, dev);
    const lamp = k.sphere(0.012, M.ledGreen, acb ? 0.15 : 0.07, 0.12, acb ? 0.195 : 0.075, dev);
    k.pickable(dev, (acb ? 'ACB' : 'MCCB (TMŞ)') + ' ana şalter' + (s.panelType === 'TRANSFER' ? (isGen ? ' · jeneratör' : ' · şebeke') : ''), () => {
      const r = app.validResult && app.validResult.values;
      return r ? ['In = ' + s.mainIn + ' A · Icu = ' + s.mainIcu_kA + ' kA', 'En yüklü faz: ' + fmt(r.Imax, 1, 'A') + ' (%' + fmt(r.loading, 0) + ')', 'Ik3 ≈ ' + fmt(r.Ik3 / 1e3, 2, 'kA') + ' (IEC 60909 yaklaşık)', 'Uzun gecikmeli koruma: ≥ 1,30·Ir kesin açma bölgesi (TS EN 60947-2)'] : [];
    });
    k.explodable(dev, [0, 0, 0.45]);
    devLabel(k, dev, (acb ? 'ACB ' : 'MCCB ') + s.mainIn + ' A' + (s.panelType === 'TRANSFER' ? (isGen ? ' · JEN' : ' · ŞEB') : ''));
    scene.main = scene.main || [];
    scene.main.push({ handle: handle, lamp: lamp, isGen: isGen, active: active, acb: acb });
    // akım trafoları (3 faz, ana şalter üstü)
    if (!second) {
      ['L1', 'L2', 'L3'].forEach((p, j) => {
        const ct = new T.Mesh(new T.TorusGeometry(0.035, 0.014, 10, 24), M.plasticDark); ct.position.set(-0.12 + j * 0.12, S.plinth + 1.42, -0.12); ct.rotation.x = Math.PI / 2; ct.castShadow = true; g.add(ct);
        k.box(0.012, 0.3, 0.008, M.copper, -0.12 + j * 0.12, S.plinth + 1.42, -0.12, g);
        if (j === 1) k.pickable(ct, 'Akım trafoları (ölçü)', () => ['Ölçü sınıfı CT; enerji analizörünü besler.', 'Oran örneği: ' + Math.max(100, s.mainIn) + '/5 A']);
      });
      // vertikal bağlantı baraları ana şalter → baralar
      for (let j = 0; j < 3; j++) k.box(0.02, 0.45, 0.008, M.copper, -0.12 + j * 0.12, S.plinth + 1.55, -0.14, g);
      // enerji analizörü kapakta
      const scr = k.screen(0.096, 0.096, 256, (gx, w, h) => drawAnalyzer(gx, w, h, app), door, { emissive: 0.9 });
      scr.position.set(S.w / 2, S.plinth + 1.45, 0.024);
      k.box(0.11, 0.11, 0.008, M.plasticDark, S.w / 2, S.plinth + 1.45, 0.02, door);
      scene.analyzer = scr;
      k.pickable(scr, 'Enerji analizörü', () => { const r = app.validResult && app.validResult.values; return r ? ['U = ' + s.U_LL + ' V', 'P = ' + VS.fmtPower(r.P) + ' · Q = ' + fmt(r.Q / 1e3, 1, 'kVAr'), 'cosφ = ' + fmt(r.pf, 3)] : []; });
      // faz sinyal lambaları
      scene.lamps = ['L1', 'L2', 'L3'].map((p, j) => k.sphere(0.014, M.ledGreen, S.w / 2 - 0.06 + j * 0.06, S.plinth + 1.28, 0.03, door));
      // besleme kablosu üstten
      k.tube([[0.9, S.plinth + S.h + 0.57, -0.05], [0.1, S.plinth + S.h + 0.5, -0.1], [0, S.plinth + S.h + 0.1, -0.15], [0, S.plinth + 1.3, -0.14]], 0.022, M.cableBlack, g);
    } else {
      k.tube([[0, -0.2, -0.15], [0, S.plinth + 0.2, -0.15], [0, S.plinth + 0.8, -0.12]], 0.025, M.cableBlack, g);
      // mekanik kilit çubuğu (iki giriş arası)
      k.box(0.6, 0.015, 0.015, M.steel, -S.w / 2, S.plinth + 0.82, 0.02, g);
      k.label('Mekanik kilit', null, [g.position.x - S.w / 2, S.plinth + 0.86, 0.1], 'vs-label--sm');
    }
  }

  function buildFeeder(k, g, ci, row, s, app, scene) {
    const M = k.mats, c = s.circuits[ci];
    const y = S.plinth + 1.62 - row * 0.38;
    const dev = k.group(g, 0, y, -0.2);
    const kind = deviceKind(c);
    let handle, lamp;
    if (kind === 'cap') {
      // kondansatör kademesi: kontaktör + 3 kondansatör kabı
      k.rbox(0.07, 0.12, 0.1, 0.008, M.plasticGrey, -0.2, 0, 0.05, dev);
      handle = k.box(0.02, 0.03, 0.02, M.plasticDark, -0.2, 0.02, 0.105, dev);
      for (let j = 0; j < 3; j++) { k.cyl(0.035, 0.035, 0.2, M.alu, 0.0 + j * 0.085, -0.02, 0.06, dev, 18); k.cyl(0.012, 0.012, 0.02, M.plasticDark, j * 0.085, 0.09, 0.06, dev, 10); }
      lamp = k.sphere(0.01, M.ledGreen, -0.2, 0.05, 0.105, dev);
    } else if (kind === 'starter') {
      // motor yol verici: TMŞ/MCB + kontaktör + termik röle (ya da sürücü)
      k.rbox(0.08, 0.12, 0.09, 0.008, M.plasticDark, -0.22, 0, 0.045, dev);
      handle = k.box(0.025, 0.04, 0.03, M.plasticBlue, -0.22, 0, 0.1, dev);
      if (c.start === 'VFD') {
        k.rbox(0.18, 0.28, 0.16, 0.012, M.plasticDark, 0.05, -0.04, 0.08, dev);
        const kp = k.screen(0.06, 0.035, 128, (gx, w, h) => { gx.fillStyle = '#0b2a1a'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#4ade80'; gx.font = 'bold 34px monospace'; gx.fillText(c.running && !c.tripped ? '50.0Hz' : ' 0.0Hz', 6, 48); }, dev, { emissive: 0.8 });
        kp.position.set(0.05, 0.03, 0.161);
        dev.userData.vfdScreen = kp;
      } else {
        const nk = c.start === 'YD' ? 3 : 1;
        for (let j = 0; j < nk; j++) k.rbox(0.055, 0.085, 0.09, 0.006, M.plasticGrey, -0.1 + j * 0.065, 0.01, 0.045, dev);
        k.rbox(0.055, 0.05, 0.08, 0.006, M.plasticDark, -0.1, -0.075, 0.04, dev); // termik röle
      }
      lamp = k.sphere(0.01, M.ledGreen, 0.2, 0.08, 0.06, dev);
    } else {
      // MCCB çıkış
      k.rbox(0.105, 0.17, 0.09, 0.008, M.plasticDark, 0, 0, 0.045, dev);
      k.box(0.07, 0.1, 0.01, M.plasticGrey, 0, 0, 0.092, dev);
      handle = k.box(0.03, 0.05, 0.03, M.plasticBlue, 0, 0, 0.1, dev);
      lamp = k.sphere(0.01, M.ledGreen, 0.045, 0.07, 0.095, dev);
    }
    // bağlantı: baradan cihaza, cihazdan aşağı kablo
    const bx = g.position.x;
    k.box(0.01, 0.25, 0.006, M.copper, -0.03, 0.2, -0.02, dev);
    const cab = k.tube([[bx + 0.0, y - 0.12, -0.17], [bx + 0.18, y - 0.25, -0.12], [bx + 0.3, S.plinth + 0.25, -0.1], [bx + 0.3, -0.25, 0.0]], 0.012 + Math.min(c.S, 50) * 0.0004, M.cableBlack, k.viewer.root);
    const fl = k.flow(cab.userData.curve, 10, 0xfcd34d, 0.008);
    k.explodable(dev, [0, 0, 0.35]);
    const label = devLabel(k, dev, c.name);
    k.pickable(dev, c.name, () => info(app, ci));
    scene.devices[ci] = { kind: kind, dev: dev, handle: handle, lamp: lamp, label: label, flow: fl, cable: cab };
  }

  function buildDin(k, g, items, s, app, scene) {
    const M = k.mats;
    const rails = [S.plinth + 1.5, S.plinth + 1.2, S.plinth + 0.9];
    rails.forEach(y => k.box(S.w - 0.14, 0.035, 0.008, M.galv, 0, y, -S.d / 2 + 0.05, g));
    // kablo kanalları
    rails.forEach(y => k.box(S.w - 0.12, 0.05, 0.05, M.plasticGrey, 0, y + 0.13, -S.d / 2 + 0.07, g));
    // klemens dizisi
    for (let j = 0; j < 22; j++) k.box(0.0055, 0.045, 0.04, j % 5 === 4 ? M.plasticYellow : j % 5 === 3 ? M.plasticBlue : M.plasticGrey, -0.3 + j * 0.0062 * 4.5, S.plinth + 0.4, -S.d / 2 + 0.07, g);
    let rail = 0, x = -S.w / 2 + 0.1;
    const place = (wMod) => { const w = wMod * 0.018; if (x + w > S.w / 2 - 0.08) { rail++; x = -S.w / 2 + 0.1; } const px = x + w / 2; x += w + 0.004; return { x: px, y: rails[Math.min(rail, 2)] }; };
    if (s.panelType === 'OTOM') {
      // PLC rafı ve güç kaynağı (eğitim gösterimi)
      const psu = place(4); k.rbox(0.07, 0.09, 0.11, 0.005, M.plasticGrey, psu.x, psu.y, -S.d / 2 + 0.1, g);
      const cpu = place(5); const cp = k.rbox(0.09, 0.1, 0.1, 0.006, M.plasticDark, cpu.x, cpu.y, -S.d / 2 + 0.1, g);
      k.pickable(cp, 'PLC CPU', () => ['IEC 61131-3 programlanabilir denetleyici (eğitim gösterimi)', 'Emniyet fonksiyonları için ISO 13849-1 / IEC 62061’e göre doğrulanmış emniyet rölesi gerekir.']);
      scene.plcLeds = [];
      for (let j = 0; j < 3; j++) { const io = place(2); const m = k.rbox(0.035, 0.1, 0.1, 0.004, M.plasticDark, io.x, io.y, -S.d / 2 + 0.1, g); for (let q = 0; q < 6; q++) scene.plcLeds.push(k.sphere(0.003, M.ledOff, io.x - 0.006, io.y + 0.035 - q * 0.012, -S.d / 2 + 0.152, g)); void m; }
      k.label('PLC · G/Ç', cp, [0, 0.07, 0.05], 'vs-label--sm');
    }
    items.forEach(ci => {
      const c = s.circuits[ci];
      const poles = c.phase === '3F' ? 3 : 1;
      if (c.rcd) { const r = place(c.phase === '3F' ? 4 : 2); const rm = k.rbox(0.018 * (c.phase === '3F' ? 4 : 2) - 0.002, 0.09, 0.07, 0.004, M.plasticWhite, r.x, r.y, -S.d / 2 + 0.085, g); k.box(0.012, 0.012, 0.01, M.plasticYellow, r.x + 0.01, r.y - 0.02, -S.d / 2 + 0.122, g); k.pickable(rm, 'Kaçak akım rölesi ' + c.rcd + ' mA', () => [c.name + ' devresini korur', E.rcdAssessment(c.rcd, app.state.sel === ci ? app.state.leak_mA : 0).text]); k.explodable(rm, [0, 0, 0.3]); }
      const p = place(poles);
      const dev = k.group(g, p.x, p.y, -S.d / 2 + 0.085);
      k.rbox(0.018 * poles - 0.002, 0.09, 0.07, 0.004, M.plasticWhite, 0, 0, 0, dev);
      k.box(0.018 * poles - 0.004, 0.02, 0.012, M.plasticGrey, 0, -0.028, 0.036, dev);
      const handle = k.box(0.012 * poles, 0.022, 0.016, M.plasticDark, 0, 0.012, 0.04, dev);
      const lamp = k.box(0.008, 0.006, 0.004, M.ledGreen, 0, -0.028, 0.043, dev);
      const lead = M[c.phase === '3F' ? 'L1' : c.phase];
      k.tube([[p.x + g.position.x, p.y - 0.05, -S.d / 2 + 0.09], [p.x + g.position.x, p.y - 0.15, -S.d / 2 + 0.11], [g.position.x + 0.25, S.plinth + 0.45, -S.d / 2 + 0.1], [g.position.x + 0.28, -0.25, -0.05]], 0.004 + c.S * 0.0006, lead, k.viewer.root);
      k.explodable(dev, [0, 0, 0.3]);
      k.pickable(dev, c.name, () => info(app, ci));
      scene.devices[ci] = { kind: 'mcb', dev: dev, handle: handle, lamp: lamp, label: devLabel(k, dev, c.name) };
    });
  }

  function buildMotor(k, x, z, ci, c, app) {
    const M = k.mats, T = k.T;
    const g = k.group(null, x, 0, z);
    const size = 0.14 + Math.min(c.P_kW, 30) * 0.006;
    k.box(size * 2.2, 0.04, size * 1.6, M.darkSteel, 0, 0.02, 0, g);
    const body = k.cyl(size, size, size * 2.2, M.plasticBlue, 0, size + 0.05, 0, g, 28); body.rotation.z = Math.PI / 2;
    for (let j = 0; j < 10; j++) { const fin = k.box(size * 2, 0.008, size * 2.15, M.plasticBlue, 0, size + 0.05, 0, g); fin.rotation.x = j / 10 * Math.PI; fin.scale.set(1, 1, 1); }
    k.box(size * 0.7, size * 0.4, size * 0.7, M.plasticBlue, 0, size * 2 + 0.05, 0, g); // klemens kutusu
    const shaft = k.cyl(0.018, 0.018, 0.22, M.steel, size * 1.2, size + 0.05, 0, g, 12); shaft.rotation.z = Math.PI / 2;
    const fan = k.group(g, size * 1.25 + 0.04, size + 0.05, 0);
    for (let j = 0; j < 3; j++) { const b = k.box(0.01, size * 1.3, 0.04, M.plasticYellow, 0, 0, 0, fan); b.rotation.x = j * Math.PI * 2 / 3; }
    k.pickable(body, c.name + ' (motor)', () => info(app, ci));
    const label = k.label(c.name, body, [0, size + 0.08, 0], 'vs-label--sm');
    return { ci: ci, fan: fan, label: label, body: body };
  }

  function info(app, ci) {
    const r = app.validResult && app.validResult.values, c = app.state.circuits[ci];
    if (!r || !c) return [];
    const cr = r.circuits[ci];
    return [
      (c.cap ? fmt(c.P_kW, 1, 'kVAr') + ' kondansatör kademesi' : (c.motor ? 'Motor ' : '') + fmt(c.P_kW, 1, 'kW') + ' · cosφ ' + fmt(c.cos, 2)) + ' · ' + c.phase,
      'Akım: ' + fmt(cr.I, 1, 'A') + (c.tripped ? ' · AÇTI (' + c.tripReason + ')' : !cr.active ? ' · devre dışı' : ''),
      (c.kind === 'MCB' ? 'MCB ' + c.curve : 'MCCB') + c.In + ' A · ' + fmt(c.S, c.S % 1 ? 1 : 0) + ' mm² · ' + c.L + ' m',
      'Iz = ' + fmt(cr.Iz, 1, 'A') + ' · ΔU = %' + fmt(cr.vd, 2) + ' · Ik1,min ≈ ' + fmt(cr.Ik1, 0, 'A'),
      cr.assessment.text
    ];
  }

  function drawAnalyzer(g, w, h, app) {
    const r = app.validResult && app.validResult.values, s = app.state;
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 20px monospace'; g.fillText('ENERJİ ANALİZÖRÜ', 14, 28);
    if (!r) return;
    g.fillStyle = '#e2e8f0'; g.font = 'bold 26px monospace';
    const live = app.live && app.live.mainTripped;
    const rows = live ? [['U', s.U_LL + ' V'], ['I', '0 A'], ['P', '0 kW'], ['PF', '—']] : [['U', s.U_LL + ' V'], ['Imax', fmt(r.Imax, 0) + ' A'], ['P', fmt(r.P / 1e3, 1) + ' kW'], ['Q', fmt(r.Q / 1e3, 1) + ' kvar'], ['PF', fmt(r.pf, 3)]];
    rows.forEach((row, i) => { g.fillStyle = '#94a3b8'; g.fillText(row[0], 14, 70 + i * 38); g.fillStyle = '#fcd34d'; g.textAlign = 'right'; g.fillText(row[1], w - 14, 70 + i * 38); g.textAlign = 'left'; });
  }

  /* sahne güncelleme: hesap değişince */
  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values, T = k.T, M = k.mats;
    // bara ısı rengi (yüklenme oranına göre)
    ['L1', 'L2', 'L3', 'N'].forEach(p => {
      const load = (live.mainTripped ? 0 : v.phases[p]) / s.busbarIn;
      const m = sc.busMat[p]; k.heat(load, m.emissive); m.emissiveIntensity = Math.max(0, load - 0.35) * 1.4;
    });
    sc.flows.forEach(f => { f.f.speed = live.mainTripped ? 0 : Math.min(1.2, (v.phases[f.p] || 0) / Math.max(s.mainIn, 1) * 1.5); });
    // ana şalter(ler)
    (sc.main || []).forEach(m => {
      const on = !live.mainTripped && (s.panelType !== 'TRANSFER' || (m.isGen ? s.source === 'gen' : s.source === 'grid'));
      m.handle.position.y = m.acb ? -0.06 : (on ? 0.03 : -0.03); m.handle.rotation.x = on ? 0 : 0.35;
      m.lamp.material = on ? M.ledGreen : live.mainTripped ? M.ledRed : M.ledOff;
    });
    (sc.lamps || []).forEach(l => { l.material = live.mainTripped ? M.ledOff : M.ledGreen; });
    s.circuits.forEach((c, i) => {
      const d = sc.devices[i]; const cr = v.circuits[i]; if (!d || !cr) return;
      const on = c.on && !c.tripped;
      if (d.handle) { d.handle.position.y = d.kind === 'mcb' ? (on ? 0.012 : -0.004) : on ? 0.0 : -0.025; d.handle.rotation.x = on ? 0 : 0.5; }
      if (d.lamp) d.lamp.material = c.tripped ? M.ledRed : cr.active ? M.ledGreen : c.on ? M.ledAmber : M.ledOff;
      if (d.label) { d.label.set(c.name + (cr.active ? ' · ' + fmt(cr.I, 0) + ' A' : c.tripped ? ' · AÇTI' : ' · kapalı')); d.label.level(c.tripped ? 'bad' : cr.loadPct > 100 ? 'warn' : cr.active ? 'ok' : ''); }
      if (d.flow) d.flow.speed = cr.active ? Math.min(1.4, 0.15 + cr.loadPct / 100) : 0;
      if (d.dev && d.dev.userData.vfdScreen) d.dev.userData.vfdScreen.redraw();
    });
    sc.motors.forEach(m => { const c = s.circuits[m.ci]; const cr = v.circuits[m.ci]; if (!c || !cr) return; m.label.set(c.name + (cr.active ? ' · çalışıyor' : c.tripped ? ' · AÇTI' : ' · duruyor')); m.label.level(c.tripped ? 'bad' : cr.active ? 'ok' : ''); });
    if (sc.analyzer) sc.analyzer.redraw();
    void T;
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    // kapak açılıp kapanma
    const target = s.doorOpen ? -1.62 : 0;
    sc.doors.forEach((d, i) => { const tt = target * (1 - i * 0.02); d.rotation.y += (tt - d.rotation.y) * Math.min(1, dt * 4); });
    sc.motors.forEach(m => {
      const c = s.circuits[m.ci], cr = res.values.circuits[m.ci];
      m.speed = m.speed || 0;
      const want = cr && cr.active ? (c.start === 'VFD' ? 1 : 1) * 25 : 0;
      m.speed += (want - m.speed) * Math.min(1, dt * (c.start === 'DOL' ? 1.6 : 0.7));
      if (!k.reducedMotion) m.fan.rotation.x += m.speed * dt;
    });
    // kısa devre kıvılcımı
    if (live.spark && sc.devices[live.spark.i]) {
      const d = sc.devices[live.spark.i];
      if (!sc.flash) { sc.flash = new k.T.PointLight(0x9fd8ff, 0, 1.5); k.viewer.root.add(sc.flash); }
      d.dev.getWorldPosition(sc.flash.position);
      sc.flash.intensity = live.spark.t < 0.6 && !k.reducedMotion ? 6 * Math.abs(Math.sin(live.spark.t * 40)) : 0;
    } else if (sc.flash) sc.flash.intensity = 0;
    if (sc.plcLeds) sc.plcLeds.forEach((l, i) => { l.material = (Math.floor(app.simTime * 2 + i * 1.7) % 3 === 0) ? k.mats.ledGreen : k.mats.ledOff; });
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması */
  function view2d(g, W, H, res, s, live) {
    const v = res.values;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0' };
    g.lineWidth = 2; g.strokeStyle = col.line; g.fillStyle = col.text; g.font = '12px Inter, sans-serif'; g.textAlign = 'center';
    const cx = W / 2, top = 30;
    // kaynak
    if (v.source === 'gen') { g.beginPath(); g.arc(cx, top + 18, 16, 0, Math.PI * 2); g.stroke(); g.fillText('G', cx, top + 22); g.fillStyle = col.dim; g.fillText('Jeneratör ' + s.gen_kVA + ' kVA', cx + 90, top + 22); }
    else { g.beginPath(); g.arc(cx, top + 10, 12, 0, Math.PI * 2); g.arc(cx, top + 28, 12, 0, Math.PI * 2); g.stroke(); g.fillStyle = col.dim; g.fillText('Trafo ' + s.trafo_kVA + ' kVA · uk %' + s.trafo_uk, cx + 100, top + 24); }
    g.fillStyle = col.text;
    // ana şalter
    const yb = top + 50; g.beginPath(); g.moveTo(cx, yb); g.lineTo(cx, yb + 20); g.stroke();
    const mainOn = !live.mainTripped;
    g.strokeStyle = mainOn ? col.ok : col.bad; g.beginPath(); g.moveTo(cx, yb + 20); g.lineTo(cx + (mainOn ? 0 : 12), yb + 44); g.stroke();
    g.textAlign = 'left'; g.fillText(s.mainKind + ' ' + s.mainIn + ' A', cx + 18, yb + 36); g.textAlign = 'center';
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx, yb + 44); g.lineTo(cx, yb + 60); g.stroke();
    // bara
    const n = s.circuits.length, by = yb + 62, x0 = 40, x1 = W - 40;
    g.lineWidth = 5; g.strokeStyle = '#c77b4a'; g.beginPath(); g.moveTo(x0, by); g.lineTo(x1, by); g.stroke(); g.lineWidth = 2;
    g.fillStyle = col.dim; g.textAlign = 'left'; g.fillText('Bara ' + s.busbarIn + ' A · Ik3 ≈ ' + fmt(v.Ik3 / 1e3, 1) + ' kA · L1/L2/L3 ' + fmt(v.phases.L1, 0) + '/' + fmt(v.phases.L2, 0) + '/' + fmt(v.phases.L3, 0) + ' A', x0, by - 10); g.textAlign = 'center';
    s.circuits.forEach((c, i) => {
      const x = x0 + (i + 0.5) * (x1 - x0) / n, cr = v.circuits[i];
      const lv = c.tripped ? col.bad : !cr.coord ? col.warn : cr.active ? col.ok : col.dim;
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by); g.lineTo(x, by + 22); g.stroke();
      g.strokeStyle = lv; g.beginPath(); g.moveTo(x, by + 22); g.lineTo(x + (c.on && !c.tripped ? 0 : 10), by + 46); g.stroke();
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by + 46); g.lineTo(x, by + 110); g.stroke();
      if (c.motor) { g.beginPath(); g.arc(x, by + 124, 13, 0, Math.PI * 2); g.stroke(); g.fillStyle = col.text; g.fillText('M', x, by + 128); }
      else if (c.cap) { g.beginPath(); g.moveTo(x - 10, by + 112); g.lineTo(x + 10, by + 112); g.moveTo(x - 10, by + 118); g.lineTo(x + 10, by + 118); g.stroke(); }
      else { g.strokeRect(x - 9, by + 112, 18, 18); }
      g.fillStyle = lv; g.font = 'bold 11px Inter, sans-serif'; g.textAlign = 'left'; g.fillText((c.kind === 'MCB' ? c.curve : '') + c.In + ' A', x + 14, by + 38); g.textAlign = 'center';
      g.fillStyle = col.text; g.font = '11px Inter, sans-serif';
      wrap(g, c.name, x, by + 156, (x1 - x0) / n - 6);
      g.fillStyle = col.dim; g.fillText(fmt(cr.I, 1) + ' A · %' + fmt(cr.vd, 1), x, by + 188);
      g.fillText(c.S + ' mm² · ' + c.L + ' m', x, by + 202);
    });
  }
  function wrap(g, text, x, y, w) {
    const words = text.split(' '); let line = '', yy = y;
    words.forEach(wd => { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width > w && line) { g.fillText(line, x, yy); line = wd; yy += 13; } else line = t; });
    g.fillText(line, x, yy);
  }

  VS.register({
    id: 'pano', title: '3D Elektrik Pano Simülasyonu',
    defaults: () => defaults('ADP'),
    initLive: s => ({ inrush: s.circuits.map(() => -1), timers: {}, mainTripped: false, mainTimer: 0, events: [], hist: [], histT: 0, spark: null }),
    autoRun: true,
    startText: 'Simülasyon çalışıyor: motorlar yol alıyor, koruma cihazları izleniyor.',
    start: app => { app.live.inrush = app.state.circuits.map(c => (c.motor && c.running ? 0 : -1)); app.live.hist = []; app._startedOnce = true; },
    scenarios: [
      { id: 'adp', name: 'Fabrika ADP · dengeli işletme', desc: 'Varsayılan ana dağıtım panosu: aydınlatma, priz, kaynak prizi, kompresör ve konveyör.', state: defaults('ADP') },
      { id: 'mcc', name: 'MCC · pompa istasyonu (Y-Δ ve VFD)', desc: 'İki pompa (yıldız–üçgen), fan (VFD) ve karıştırıcı; Pompa 2’yi ▶ ile devreye alın.', state: defaults('MCC') },
      { id: 'komp', name: 'Kompanzasyon panosu · kademe devreye alma', desc: 'Düşük cosφ’li tesis yükü; kademeleri açıp kapatarak güç faktörünü izleyin.', state: defaults('KOMP') },
      { id: 'transfer-gen', name: 'Transfer panosu · jeneratörde kısa devre akımı', desc: 'Jeneratör beslemesinde Ik düşer; uzun devrelerde otomatik kesme koşulunun nasıl bozulduğunu görün.', state: Object.assign(defaults('TRANSFER'), { source: 'gen', gen_kVA: 150 }) },
      { id: 'wrong', name: 'Hatalı seçim · 2,5 mm² kabloya C32', desc: 'Priz devresinde kablo–sigorta koordinasyonu bozuk; ön kontrol uyarısını inceleyin.', state: (() => { const d = defaults('ADP'); d.circuits[1].In = 32; d.sel = 1; return d; })() },
      { id: 'unbal', name: 'Dengesiz yük · tek fazda yığılma', desc: 'Tüm tek fazlı yükler L1’de; nötr akımı ve dengesizlik artar.', state: (() => { const d = defaults('ADP'); d.circuits.forEach(c => { if (c.phase !== '3F') c.phase = 'L1'; }); return d; })() }
    ],
    controls: controls,
    compute: s => P.compute(s),
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => live.mainTripped ? { level: 'bad', text: 'Ana şalter açtı' } : s.circuits.some(c => c.tripped) ? { level: 'bad', text: s.circuits.filter(c => c.tripped).length + ' cihaz açtı' } : null,
    reportInputs: s => s.circuits.map((c, i) => ({ group: 'Yük grupları', label: (i + 1) + '. ' + c.name, value: (c.cap ? fmt(c.P_kW, 1, 'kVAr') : fmt(c.P_kW, 1, 'kW') + ' cosφ ' + fmt(c.cos, 2)) + ' · ' + c.phase + ' · ' + (c.kind === 'MCB' ? 'MCB ' + c.curve : 'MCCB ') + c.In + ' A · ' + c.S + ' mm² ' + c.method + ' · ' + c.L + ' m' + (c.rcd ? ' · RCD ' + c.rcd + ' mA' : '') + (c.on ? '' : ' · kapalı') + (c.motor ? (c.running ? ' · çalışıyor' : ' · duruyor') : '') })),
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-2, 2] },
    view2d: view2d
  });
  void circuitAt;
})();
