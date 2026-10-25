/* VoltSim · 3D Elektrik Pano Simülasyonu
 * Hesap: VoltSimEngine.pano (fazör toplamı, Iz koordinasyonu, gerilim düşümü, IEC 60909 yaklaşık kısa devre).
 * Sahne: hesap sonucunu gösterir (akım ısı rengi, açma durumu, enerji akışı, analizör ekranı). */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const P = E.pano;

  /* ---------------------------------------------------------------- devre önayarları */
  const C = (o) => Object.assign({ on: true, tripped: false, tripReason: '', kind: 'MCB', curve: 'C', In: 16, S: 2.5, L: 25, method: 'B1', rcd: 0, cos: 0.95, eff: 0.9, motor: false, cap: false, shunt: false, socket: false, detune: 0, running: false, start: 'DOL', IstIn: 7 }, o);
  const PRESETS = {
    ADP: () => [
      C({ name: 'Aydınlatma', phase: 'L1', P_kW: 3.2, cos: 0.95, curve: 'B', In: 16, S: 2.5, L: 30 }),
      C({ name: 'Priz grubu', phase: 'L2', P_kW: 2.6, cos: 0.9, In: 16, S: 2.5, L: 25, rcd: 30, socket: true }),
      C({ name: 'Ofis klima', phase: 'L3', P_kW: 2.8, cos: 0.92, In: 20, S: 4, L: 25 }),
      C({ name: 'Kaynak prizi 3~', phase: '3F', P_kW: 9, cos: 0.9, In: 32, S: 6, L: 20, rcd: 30, socket: true }),
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
      C({ name: 'Tesis yükü 3~', phase: '3F', P_kW: 120, cos: 0.78, kind: 'MCCB', In: 250, S: 120, L: 15, method: 'E' }),
      C({ name: 'Kademe 1 · 10 kVAr', phase: '3F', P_kW: 10, cap: true, kind: 'FUSE', In: 25, S: 6, L: 3, method: 'C', on: false, detune: 7 }),
      C({ name: 'Kademe 2 · 20 kVAr', phase: '3F', P_kW: 20, cap: true, kind: 'FUSE', In: 50, S: 16, L: 3, method: 'C', on: false, detune: 7 }),
      C({ name: 'Kademe 3 · 20 kVAr', phase: '3F', P_kW: 20, cap: true, kind: 'FUSE', In: 50, S: 16, L: 3, method: 'C', on: false, detune: 7 }),
      C({ name: 'Kademe 4 · 40 kVAr', phase: '3F', P_kW: 40, cap: true, kind: 'FUSE', In: 100, S: 35, L: 3, method: 'C', on: false, detune: 7 }),
      C({ name: 'Kademe 5 · 40 kVAr', phase: '3F', P_kW: 40, cap: true, kind: 'FUSE', In: 100, S: 35, L: 3, method: 'C', on: false, detune: 7 }),
      C({ name: 'Şönt reaktör 5 kVAr', phase: '3F', P_kW: 5, shunt: true, kind: 'MCB', curve: 'C', In: 10, S: 2.5, L: 3, method: 'C', on: false })
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
      C({ name: 'Priz grubu', phase: 'L2', P_kW: 2, cos: 0.9, In: 16, S: 2.5, L: 30, rcd: 30, socket: true }),
      C({ name: 'Asansör 3~', phase: '3F', P_kW: 7.5, cos: 0.85, eff: 0.9, motor: true, running: true, curve: 'D', In: 25, S: 6, L: 35, method: 'C', start: 'VFD' })
    ]
  };
  const ADD = {
    light: () => C({ name: 'Aydınlatma', phase: 'L1', P_kW: 1.5, cos: 0.95, curve: 'B', In: 10, S: 1.5, L: 25 }),
    socket: () => C({ name: 'Priz', phase: 'L2', P_kW: 2, cos: 0.9, In: 16, S: 2.5, L: 25, rcd: 30, socket: true }),
    load3: () => C({ name: '3F yük', phase: '3F', P_kW: 10, cos: 0.9, In: 25, S: 6, L: 25, method: 'C' }),
    motor: () => C({ name: 'Motor 3~', phase: '3F', P_kW: 7.5, cos: 0.84, eff: 0.9, motor: true, running: false, curve: 'D', In: 20, S: 4, L: 30, method: 'C', IstIn: 7 }),
    cap: () => C({ name: 'Kondansatör kademesi', phase: '3F', P_kW: 20, cap: true, kind: 'FUSE', In: 50, S: 16, L: 3, method: 'C' }),
    capf: () => C({ name: 'Filtreli kademe (%7)', phase: '3F', P_kW: 25, cap: true, detune: 7, kind: 'FUSE', In: 63, S: 16, L: 3, method: 'C' }),
    shunt: () => C({ name: 'Şönt reaktör', phase: '3F', P_kW: 10, shunt: true, kind: 'MCB', curve: 'C', In: 20, S: 4, L: 3, method: 'C' }),
    nh: () => C({ name: 'NH sigortalı çıkış', phase: '3F', P_kW: 45, cos: 0.9, kind: 'FUSE', In: 100, S: 35, L: 40, method: 'E' })
  };
  const ADD_BTNS = [['light', '+ Aydınlatma'], ['socket', '+ Priz'], ['load3', '+ 3F yük'], ['motor', '+ Motor'], ['nh', '+ NH sigortalı çıkış'], ['cap', '+ Kondansatör kademesi'], ['capf', '+ Filtreli kademe'], ['shunt', '+ Şönt reaktör']];
  const KIND_LABEL = { MCB: 'MCB', MCCB: 'MCCB', FUSE: 'NH gG' };
  const TYPE_LABEL = { ADP: 'Ana dağıtım panosu (ADP)', MCC: 'Motor kontrol panosu (MCC)', KOMP: 'Kompanzasyon panosu', OTOM: 'Otomasyon panosu', TRANSFER: 'Transfer (ATS) panosu' };
  const MAIN_FOR = { ADP: 160, MCC: 125, KOMP: 400, OTOM: 63, TRANSFER: 160 };

  function defaults(type) {
    type = type || 'ADP';
    return {
      panelType: type, U_LL: 400, mainKind: type === 'KOMP' ? 'ACB' : 'MCCB', mainIn: MAIN_FOR[type], mainIcu_kA: 36, busbarIn: type === 'KOMP' ? 630 : 250,
      source: 'grid', SkQ_MVA: 500, trafo_kVA: 630, trafo_uk: 4, trafo_Pk: 4600, gen_kVA: 200, gen_xd: 14, gen_sust: 3,
      feedL: 25, feedS: type === 'KOMP' ? 185 : 70, feedN: 1,
      mainIrF: 1, mainIiF: 10,
      rgrAuto: type === 'KOMP', rgrTarget: 0.96, rgrDelay: 10, rgrDischarge: 60,
      doorOpen: true, sel: 0, leak_mA: 0, circuits: PRESETS[type]()
    };
  }

  /* ---------------------------------------------------------------- yardımcılar */
  const IN_LIST = [2, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630];
  const MAIN_LIST = [40, 63, 100, 125, 160, 200, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500];
  function deviceKind(c) { return c.cap ? 'cap' : c.shunt ? 'shunt' : c.motor ? 'starter' : c.kind === 'FUSE' ? 'fuse' : (c.kind === 'MCCB' || c.phase === '3F' && c.In > 63) ? 'mccb' : c.phase === '3F' ? 'mcb3' : 'mcb1'; }
  const isQ = c => c.cap || c.shunt;
  /** Ana şalterin seçicilik/bant hesabı için cihaz tanımı. */
  function mainDev(s, v) { return { kind: 'MCCB', In: s.mainIn, Ir: v ? v.mainIr : s.mainIn * (s.mainIrF || 1), Ii: v ? v.mainIi : s.mainIn * (s.mainIrF || 1) * (s.mainIiF || 10) }; }
  function circDev(c) { return { kind: c.kind, curve: c.curve, In: c.In, Ir: c.In, Ii: c.Ii || 10 * c.In }; }
  function qLabel(c) { return c.shunt ? fmt(c.P_kW, 1, 'kVAr') + ' şönt reaktör' : fmt(c.P_kW, 1, 'kVAr') + (c.detune ? ' filtreli kademe (p %' + fmt(c.detune, c.detune % 1 ? 2 : 0) + ')' : ' kondansatör kademesi'); }
  function cOf(app) { return app.state.circuits[app.state.sel] || app.state.circuits[0]; }

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
      { type: 'range', key: 'mainIrF', label: 'Uzun gecikmeli koruma Ir', min: 0.4, max: 1, step: 0.05, fmt: v => fmt(v, 2) + '×In = ' + fmt(v * s.mainIn, 0) + ' A', help: 'Elektronik/termik ayar. Ana şalter yüklenmesi ve aşırı yük açması bu değere göre değerlendirilir.' },
      { type: 'select', key: 'mainIiF', label: 'Ani açma Ii', options: [2, 3, 4, 5, 6, 8, 10, 12].map(v => [v, v + '×Ir (' + Math.round(v * s.mainIn * (s.mainIrF || 1)) + ' A)']) },
      { type: 'select', key: 'mainIcu_kA', label: 'Ana şalter kesme kapasitesi Icu', options: [10, 16, 25, 36, 50, 65, 85, 100].map(v => [v, v + ' kA']) },
      { type: 'select', key: 'busbarIn', label: 'Bara anma akımı', options: P.BUSBARS.map(v => [v, v + ' A']) },
      { type: 'toggle', key: 'doorOpen', label: 'Pano kapakları açık' }
    ] });
    groups.push({ title: 'Besleme', items: [
      { type: 'seg', key: 'source', label: s.panelType === 'TRANSFER' ? 'Aktif kaynak (ATS)' : 'Kaynak', options: [['grid', 'Şebeke / trafo'], ['gen', 'Jeneratör']], help: s.panelType === 'TRANSFER' ? 'Şebeke ve jeneratör kesicileri mekanik ve elektriksel kilitlidir; aynı anda kapanamaz.' : null },
      s.source === 'gen' ? { type: 'select', key: 'gen_kVA', label: 'Jeneratör gücü', options: [60, 100, 150, 200, 275, 350, 500, 750, 1000].map(v => [v, v + ' kVA']) } : { type: 'select', key: 'trafo_kVA', label: 'Besleyen trafo', options: [[250, '250 kVA'], [400, '400 kVA'], [630, '630 kVA'], [1000, '1000 kVA'], [1600, '1600 kVA'], [2500, '2500 kVA']] },
      s.source === 'gen' ? { type: 'range', key: 'gen_xd', label: "Jeneratör X''d", min: 8, max: 25, step: 0.5, unit: '%', digits: 1 } : { type: 'range', key: 'trafo_uk', label: 'Trafo uk', min: 4, max: 8, step: 0.5, unit: '%', digits: 1 },
      s.source === 'gen' ? { type: 'range', key: 'gen_sust', label: 'Kalıcı kısa devre akımı', min: 1, max: 5, step: 0.5, unit: '×In', digits: 1, help: 'Uyarma sistemine bağlıdır (AREP/PMG’de tipik ~3·In). Üretici verisini girin; otomatik kesme kontrolü bununla yapılır.' } : null,
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
            VS.el('i', { 'aria-hidden': 'true' }), VS.el('span', { text: (i + 1) + '. ' + cc.name }), VS.el('small', { text: (isQ(cc) ? fmt(cc.P_kW, 1, 'kVAr') + (cc.shunt ? ' end.' : ' kap.') : fmt(cc.P_kW, 1, 'kW')) + ' · ' + cc.phase + ' · ' + (cc.kind === 'MCB' ? cc.curve : KIND_LABEL[cc.kind] + ' ') + cc.In + ' A' + (cc.tripped ? ' · AÇTI' : '') })
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
        ADD_BTNS.forEach(b => {
          add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: b[1], onclick: () => {
            const nc = ADD[b[0]]();
            const same = a.state.circuits.filter(x => x.name.indexOf(nc.name) === 0).length;
            if (same) nc.name += ' ' + (same + 1);
            a.state.circuits.push(nc); a.state.sel = a.state.circuits.length - 1; a.live.inrush.push(-1); a.renderControls(); a.invalidate();
          } }));
        });
        box.appendChild(add);
        box.appendChild(VS.el('p', { class: 'vs-note', text: s.circuits.length + ' devre · pano bölümleri ve tek hat şeması devre sayısına göre büyür.' }));
      } }
    ] });
    if (c) {
      const isM = c.motor, isC = isQ(c);
      groups.push({ title: 'Seçili devre · ' + c.name, items: [
        { type: 'text', key: sel + 'name', label: 'Devre adı', parse: v => { v = v.trim(); if (!v) throw new Error('Ad boş olamaz.'); return v.slice(0, 40); }, rebuild: true },
        isC ? null : { type: 'select', key: sel + 'phase', label: 'Faz', options: [['L1', 'L1 (1F)'], ['L2', 'L2 (1F)'], ['L3', 'L3 (1F)'], ['3F', 'Üç faz']], rebuild: true },
        { type: 'range', key: sel + 'P_kW', label: c.shunt ? 'Reaktör gücü' : isC ? 'Kademe gücü (şebeke tarafı)' : isM ? 'Motor mil gücü' : 'Aktif güç', min: 0, max: isC ? 400 : c.phase === '3F' ? 500 : 12, step: c.phase === '3F' || isC ? 0.5 : 0.1, unit: isC ? 'kVAr' : 'kW', digits: 1 },
        c.cap ? { type: 'select', key: sel + 'detune', label: 'Harmonik filtre (ayar oranı p)', options: [[0, 'Yok (reaktörsüz)'], [5.67, '%5,67 · 210 Hz'], [7, '%7 · 189 Hz'], [14, '%14 · 134 Hz']], rebuild: true, help: 'Ayarlı (detuned) reaktör: kondansatör–şebeke rezonansını 5. harmoniğin altına çeker. Harmonik analiz için Kompanzasyon simülasyonunu kullanın.' } : null,
        isC ? null : { type: 'range', key: sel + 'cos', label: 'cosφ', min: 0.5, max: 1, step: 0.01, digits: 2 },
        isM ? { type: 'range', key: sel + 'eff', label: 'Motor verimi η', min: 0.7, max: 0.97, step: 0.01, digits: 2 } : null,
        isM ? { type: 'select', key: sel + 'start', label: 'Yol verme', options: [['DOL', 'Doğrudan (DOL)'], ['YD', 'Yıldız–üçgen'], ['SOFT', 'Yumuşak yol verici'], ['VFD', 'Frekans konvertörü']] } : null,
        isM ? { type: 'range', key: sel + 'IstIn', label: 'Kalkış akımı Ist/In', min: 4, max: 9, step: 0.5, digits: 1 } : null,
        { type: 'seg', key: sel + 'kind', label: 'Koruma cihazı', options: [['MCB', 'MCB'], ['MCCB', 'MCCB (TMŞ)'], ['FUSE', 'NH bıçaklı sigorta (gG)']], rebuild: true,
          onChange: (v, a) => { const cc = a.state.circuits[a.state.sel]; const list = v === 'FUSE' ? E.FUSE_SIZES : IN_LIST.filter(x => v === 'MCB' ? x <= 63 : x >= 16); if (list.indexOf(cc.In) < 0) cc.In = list.find(x => x >= cc.In) || list[list.length - 1]; a.renderControls(); a.invalidate(); } },
        c.kind === 'MCB' ? { type: 'seg', key: sel + 'curve', label: 'Açma eğrisi', options: [['B', 'B'], ['C', 'C'], ['D', 'D']] } : null,
        { type: 'select', key: sel + 'In', label: c.kind === 'FUSE' ? 'Sigorta bağlantısı In (gG)' : 'Koruma anma akımı In', options: (c.kind === 'FUSE' ? E.FUSE_SIZES : IN_LIST.filter(v => c.kind === 'MCB' ? v <= 63 : v >= 16)).map(v => [v, v + ' A' + (c.kind === 'FUSE' ? (v <= 160 ? ' · NH00' : v <= 250 ? ' · NH1' : v <= 400 ? ' · NH2' : ' · NH3') : '')]) },
        { type: 'select', key: sel + 'S', label: 'Kablo kesiti (Cu)', options: E.CABLE_SIZES.map(v => [v, fmt(v, v % 1 ? 1 : 0) + ' mm²']) },
        { type: 'select', key: sel + 'method', label: 'Döşeme yöntemi', options: Object.keys(E.INSTALL_METHODS).map(k => [k, E.INSTALL_METHODS[k]]) },
        { type: 'range', key: sel + 'L', label: 'Kablo uzunluğu', min: 1, max: 250, step: 1, unit: 'm' },
        isC ? null : { type: 'toggle', key: sel + 'socket', label: 'Priz son devresi (≤ 63 A → 0,4 s kesme)', help: 'TS HD 60364-4-41: ≤ 63 A prizli son devreler ve ≤ 32 A sabit bağlı son devreler TN sistemde 0,4 s içinde kesilmelidir.' },
        isC ? null : { type: 'select', key: sel + 'rcd', label: 'Kaçak akım koruması', options: [[0, 'Yok'], [30, '30 mA (hayat koruma)'], [300, '300 mA (yangın koruma)']] },
        cr ? { type: 'note', html: 'Ib <b>' + fmt(cr.Ib, 1, 'A') + '</b> · In <b>' + c.In + ' A</b> · Iz <b>' + fmt(cr.Iz, 1, 'A') + '</b> · ΔU <b>%' + fmt(cr.vd, 2) + '</b> · Ik1,min <b>' + fmt(cr.Ik1, 0, 'A') + '</b>' } : null,
        { type: 'buttons', items: [
          { label: 'Kopyala', onClick: a => { const cc = JSON.parse(JSON.stringify(a.state.circuits[a.state.sel])); cc.name += ' (kopya)'; cc.tripped = false; a.state.circuits.splice(a.state.sel + 1, 0, cc); a.live.inrush.splice(a.state.sel + 1, 0, -1); a.state.sel++; a.renderControls(); a.invalidate(); } },
          { label: 'Devreyi sil', variant: 'danger', onClick: a => { if (a.state.circuits.length <= 1) return; a.state.circuits.splice(a.state.sel, 1); a.live.inrush.splice(a.state.sel, 1); a.state.sel = Math.max(0, a.state.sel - 1); a.renderControls(); a.invalidate(); } }] }
      ] });
    }
    if (s.circuits.some(x => x.cap)) groups.push({ title: 'Reaktif güç rölesi (RGR)', items: [
      { type: 'toggle', key: 'rgrAuto', label: 'Otomatik kademe kontrolü' },
      { type: 'range', key: 'rgrTarget', label: 'Hedef cosφ (endüktif)', min: 0.9, max: 1, step: 0.01, digits: 2 },
      { type: 'range', key: 'rgrDelay', label: 'Anahtarlama gecikmesi', min: 2, max: 60, step: 1, unit: 's' },
      { type: 'range', key: 'rgrDischarge', label: 'Deşarj kilidi (aynı kademe)', min: 10, max: 180, step: 5, unit: 's', help: 'Kondansatör yeniden devreye alınmadan önce deşarj olmalıdır (IEC 60831-1: 3 dk içinde ≤ 75 V; kontaktörlü ön dirençli kademelerde tipik 30–60 s).' },
      { type: 'note', text: 'Simülasyon süresi RGR için 5× hızlıdır. Röle her adımda en uygun tek kademeyi açar/kapatır; aşırı kompanzasyonda (kapasitif) kademe çıkarır. Otomatik moddayken kademeleri elle de açıp kapatabilirsiniz.' }
    ] });
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
    if (s.rgrAuto && rgrStep(app, dt)) changed = true;
    // ana şalter (TS EN 60947-2: ≥ 1,3·Ir kesin açma bölgesi)
    if (!L.mainTripped && res.values.Imax >= 1.3 * res.values.mainIr) {
      L.mainTimer += dt; changed = true;
      if (L.mainTimer > 8) { L.mainTripped = true; s.circuits.forEach(cc => { if (cc.motor) cc.running = false; }); L.events.push('Ana şalter aşırı yükte açtı: bara enerjisiz, çıkış cihazları kapalı konumda kaldı; motor kontaktörleri gerilim kesilince düştü.'); app.renderControls(); app.invalidate(); }
    } else if (!L.mainTripped) L.mainTimer = 0;
    // anlık eğilim
    L.histT += dt;
    if (L.histT > 0.25) { L.histT = 0; L.hist.push([app.simTime, res.values.Imax * inrushFactor(app)]); if (L.hist.length > 240) L.hist.shift(); changed = true; }
    if (L.spark) { L.spark.t += dt; if (L.spark.t > 1.2) L.spark = null; }
    return changed;
  }
  /** Reaktif güç rölesi: gecikme dolunca hedefe en uygun tek kademeyi anahtarlar; deşarj kilidindeki kademeye dokunmaz. */
  function rgrStep(app, dt) {
    const L = app.live, s = app.state, v = app.validResult.values;
    const R = L.rgr || (L.rgr = { t: 0, lock: {}, msg: '' });
    const sdt = dt * 5;
    Object.keys(R.lock).forEach(k => { R.lock[k] -= sdt; if (R.lock[k] <= 0) delete R.lock[k]; });
    R.t += sdt;
    if (R.t < s.rgrDelay) return false;
    R.t = 0;
    const Qt = v.P * Math.tan(Math.acos(s.rgrTarget));
    const excess = v.Q - Qt; // > 0: daha fazla kondansatör gerekir
    const steps = s.circuits.map((c, i) => ({ c: c, i: i })).filter(x => x.c.cap && !x.c.tripped);
    const off = steps.filter(x => !x.c.on && !R.lock[x.i]), on = steps.filter(x => x.c.on);
    const minQ = Math.min.apply(null, steps.map(x => x.c.P_kW * 1e3).concat([Infinity]));
    let act = null;
    if (excess > 0.65 * minQ && off.length) {
      const fit = off.filter(x => x.c.P_kW * 1e3 <= excess * 1.05).sort((a, b) => b.c.P_kW - a.c.P_kW)[0] || off.sort((a, b) => a.c.P_kW - b.c.P_kW)[0];
      if (fit.c.P_kW * 1e3 <= excess + 0.35 * fit.c.P_kW * 1e3) { fit.c.on = true; act = fit.c.name + ' devreye alındı'; }
    } else if ((v.Q < 0 || excess < -0.65 * minQ) && on.length) {
      const need = -excess;
      const fit = on.filter(x => x.c.P_kW * 1e3 <= need * 1.05).sort((a, b) => b.c.P_kW - a.c.P_kW)[0] || on.sort((a, b) => a.c.P_kW - b.c.P_kW)[0];
      fit.c.on = false; R.lock[fit.i] = s.rgrDischarge; act = fit.c.name + ' devreden çıkarıldı (deşarj ' + s.rgrDischarge + ' s)';
    }
    if (act) { R.msg = 'RGR: ' + act; L.events.push(R.msg); app.renderControls(); app.invalidate(); return true; }
    R.msg = 'RGR: cosφ ' + fmt(v.pf, 3) + ' · hedef ' + fmt(s.rgrTarget, 2) + (Object.keys(R.lock).length ? ' · ' + Object.keys(R.lock).length + ' kademe deşarjda' : '');
    return true;
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
      { label: 'Ana şalter yüklenmesi', value: '%' + fmt(v.loading, 0), level: lvl(v.loading), sub: live.mainTripped ? 'AÇTI' : fmt(v.Imax, 0) + ' A / Ir ' + fmt(v.mainIr, 0) + ' A' },
      { label: 'Ik3 (bara, yakl.)', value: fmt(v.Ik3 / 1e3, 2, 'kA'), level: v.Ik3 > s.mainIcu_kA * 1e3 ? 'bad' : 'ok', sub: 'ip ' + fmt(v.ip / 1e3, 1) + ' kA · ' + (v.source === 'gen' ? 'jeneratör' : 'şebeke') }
    ];
    if (c && cr) {
      out.push({ label: c.name + ' · akım', value: fmt(cr.I, 1, 'A'), sub: cr.active ? 'Yüklenme %' + fmt(cr.loadPct, 0) + ' · ' + (c.tripped ? 'AÇTI' : 'çalışıyor') : (c.tripped ? 'AÇTI: ' + c.tripReason : live.mainTripped && c.on ? 'enerjisiz (ana şalter açık)' : 'devre dışı'), level: c.tripped ? 'bad' : lvl(cr.loadPct), wide: true });
      if (c.motor) out.push({ label: 'Kalkış akımı (tepe)', value: fmt(cr.startI, 0, 'A'), sub: { DOL: 'doğrudan', YD: 'yıldız–üçgen', SOFT: 'yumuşak yol verici', VFD: 'frekans konvertörü' }[c.start] });
      if (s.leak_mA > 0) out.push({ label: 'Kaçak akım', value: fmt(s.leak_mA, 0, 'mA'), level: c.rcd ? (s.leak_mA >= c.rcd ? 'bad' : 'warn') : 'bad', sub: c.rcd ? E.rcdAssessment(c.rcd, s.leak_mA).text : 'Bu devrede RCD yok: dokunma gerilimi riski!' });
    }
    if (s.circuits.some(x => x.cap)) out.push({ label: 'Reaktif güç rölesi', value: s.rgrAuto ? 'Otomatik' : 'Elle', sub: live.rgr && live.rgr.msg || 'Kademeler: ' + s.circuits.filter(x => x.cap && x.on && !x.tripped).length + ' / ' + s.circuits.filter(x => x.cap).length + ' devrede', wide: true });
    const sel = res.checks.filter(x => /^sel\d/.test(x.id));
    if (sel.length) { const no = sel.filter(x => x.sel === 'fail').length, part = sel.filter(x => x.sel === 'warn').length; out.push({ label: 'Seçicilik (ana ↔ çıkışlar)', value: (sel.length - no - part) + ' tam · ' + part + ' kısmi · ' + no + ' yok', level: no ? 'warn' : part ? 'info' : 'ok', sub: 'Akım seçiciliği sınırı ≈ ' + fmt(0.8 * v.mainIi, 0, 'A') + ' (ana şalter ani açma alt eşiği). Tam seçicilik için kısa gecikmeli ACB veya üretici seçicilik tablosu.' }); }
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
      hLines: [{ y: v.mainIr, label: 'Ana şalter Ir ' + fmt(v.mainIr, 0) + ' A', color: '#ef4444' }],
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
    const c = s.circuits[s.sel], cr = v.circuits[s.sel], X = E.ext && E.ext.pano;
    if (c && cr && X) {
      const lg = x => Math.log10(Math.max(x, 1e-6));
      const toLine = (pts, Imax) => pts.map(pq => [lg(Math.min(pq[0], Imax)), lg(Math.min(Math.max(pq[1], 0.01), 1e4))]);
      const bm = X.band(mainDev(s, v)), bc = X.band(circDev(c));
      const xmin = Math.floor(lg(Math.max(1, c.In * 0.8)) * 2) / 2, xmax = Math.ceil(lg(Math.max(v.Ik3 * 1.4, v.mainIi * 1.5)) * 2) / 2;
      const I = Math.pow(10, xmax);
      const series = [];
      if (bc) { series.push({ name: c.name + ' · açar (en geç)', color: 'cyan', data: toLine(bc.max, I) }); series.push({ name: c.name + ' · açmaz (en erken)', color: 'cyan', dash: [4, 4], data: toLine(bc.min, I) }); }
      if (bm) { series.push({ name: 'Ana şalter · açar', color: 'amber', data: toLine(bm.max, I) }); series.push({ name: 'Ana şalter · açmaz', color: 'amber', dash: [4, 4], data: toLine(bm.min, I) }); }
      const xt = []; for (let e = Math.ceil(xmin); e <= xmax; e++) [1, 2, 5].forEach(m => { const x = Math.log10(m) + e; if (x >= xmin && x <= xmax) xt.push(x); });
      const fI = x => { const val = Math.pow(10, x); return val >= 1000 ? fmt(val / 1000, val >= 10000 ? 0 : 1) + 'k' : fmt(val, 0); };
      ch.push({ id: 'tcc', title: 'Zaman–akım bantları (standart sınır noktaları)', height: 210, series: series,
        x: { min: xmin, max: xmax, ticks: xt, fmt: fI, label: 'A (log)' }, y: { min: -2, max: 4, ticks: [-2, -1, 0, 1, 2, 3, 4], fmt: y => { const val = Math.pow(10, y); return val < 1 ? fmt(val, y < -1 ? 2 : 1) : fmt(val, 0); }, label: 's (log)' },
        markers: [{ x: lg(cr.Ib), label: 'Ib', color: '#94a3b8' }, { x: lg(cr.Ik1), label: 'Ik1,min', color: '#f472b6' }, { x: lg(v.Ik3), label: 'Ik3 bara', color: '#ef4444' }],
        alt: 'Seçili devre ve ana şalter için TS EN 60898-1 / 60947-2 / IEC 60269 sınır noktalarından çizilen açma bantları. Üretici eğrisi değildir. ' + (res.checks.find(x => x.id === 'sel' + s.sel) || {}).detail });
    }
    if (live.hist.length > 2) ch.push({ id: 'trend', title: 'Anlık eğilim · en yüklü faz akımı (kalkış dahil)', series: [{ name: 'Imax (A)', color: 'amber', area: true, data: live.hist.slice() }], hLines: [{ y: v.mainIr, label: 'Ir ' + fmt(v.mainIr, 0) + ' A', color: '#ef4444' }], x: { label: 's' }, y: { label: 'A' }, alt: 'Simülasyon süresince en yüklü faz akımı.' });
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
    // DIN bölümü: 3 ray × ~28 modül; kapasite dolunca yeni bölüm açılır
    const CAP = 78;
    let cur = [], used = s.panelType === 'OTOM' ? 15 : 0;
    din.forEach(i => { const c = s.circuits[i]; const m = (c.phase === '3F' ? 3 : 1) + (c.rcd ? (c.phase === '3F' ? 4 : 2) : 0) + 0.5; if (used + m > CAP && cur.length) { sections.push({ type: 'din', items: cur }); cur = []; used = 0; } cur.push(i); used += m; });
    if (cur.length || (s.panelType === 'OTOM' && !din.length)) sections.push({ type: 'din', items: cur });
    return sections;
  }
  function rebuildOn(s) { return s.panelType + '|' + s.mainKind + '|' + s.circuits.some(c => c.cap) + '|' + s.circuits.map(c => deviceKind(c) + c.phase + (c.rcd ? 'r' : '') + (c.detune ? 'd' : '') + c.start + c.name).join(','); }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    const secs = layout(s);
    const W = secs.length * S.w;
    const x0 = -W / 2;
    const scene = {};
    app.scene3 = scene;
    // kıvılcım ışığı baştan (yoğunluk 0) eklenir: ilk arızada ışık sayısı değişip tüm gölgelendiriciler yeniden derlenmez
    scene.flash = new k.T.PointLight(0x9fd8ff, 0, 1.5); k.viewer.root.add(scene.flash);
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
    // süsleme parçaları statik grupta: kurulum sonunda malzemeye göre tek mesh'te birleşir (draw call azalır)
    const deco = k.staticGroup(body);
    k.box(W, S.plinth, S.d - 0.02, M.plasticDark, 0, S.plinth / 2, 0, deco);
    const top = k.box(W + 0.02, 0.03, S.d + 0.02, M.panelRAL7035, 0, S.plinth + S.h + 0.015, 0, body); k.shell(top);
    k.box(W, S.h, 0.02, M.panelRAL7035, 0, S.plinth + S.h / 2, -S.d / 2 + 0.01, deco);
    const sideL = k.box(0.02, S.h, S.d, M.panelRAL7035, x0 + 0.01, S.plinth + S.h / 2, 0, body); k.shell(sideL);
    const sideR = k.box(0.02, S.h, S.d, M.panelRAL7035, -x0 - 0.01, S.plinth + S.h / 2, 0, body); k.shell(sideR);
    for (let i = 1; i < secs.length; i++) k.box(0.025, S.h, 0.03, M.darkSteel, x0 + i * S.w, S.plinth + S.h / 2, S.d / 2 - 0.02, deco);

    // baralar: L1, L2, L3, N, PE (yatay, üst bölmede, arkada)
    const busY = S.plinth + S.h - 0.18, busZ = -0.16;
    const busMat = {}; scene.busMat = busMat;
    const busDeco = k.staticGroup(null);
    ['L1', 'L2', 'L3', 'N', 'PE'].forEach((p, j) => {
      const m = M.copper.clone(); m.emissive = new T.Color(0x000000); busMat[p] = m;
      const y = busY - j * 0.065, z = busZ + (j >= 3 ? -0.06 : 0);
      const bar = k.box(W - 0.06, 0.04, 0.01, m, 0, y, z);
      k.pickable(bar, p + ' barası', () => { const r = app.validResult && app.validResult.values; return r ? ['Anma: ' + s.busbarIn + ' A', p === 'PE' ? 'Koruma iletkeni barası' : p === 'N' ? 'Nötr akımı: ' + fmt(r.phases.N, 1, 'A') : 'Faz akımı: ' + fmt(r.phases[p], 1, 'A'), 'TS EN IEC 61439-1: bara sıcaklık artışı tasarım doğrulamasıyla gösterilir.'] : []; });
      // renk işaret bantları
      for (let x = x0 + 0.25; x < -x0 - 0.1; x += 0.4) k.box(0.03, 0.046, 0.016, M[p], x, y, z, busDeco);
      // mesnet izolatörleri
      if (j === 0) for (let x = x0 + 0.12; x < -x0; x += 0.8) k.box(0.04, 0.36, 0.05, M.plasticRed, x, busY - 0.13, busZ - 0.03, busDeco);
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
      const louv = k.staticGroup(pivot);
      for (let r = 0; r < 6; r++) k.box(0.26, 0.008, 0.004, M.darkSteel, S.w / 2, S.plinth + 0.18 + r * 0.025, 0.024, louv);
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
    const name = k.screen(Math.min(1.2, W * 0.6), 0.09, 512, (gx, w, h) => { gx.fillStyle = '#0a1628'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#fcd34d'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; const t = TYPE_LABEL[s.panelType].toLocaleUpperCase('tr-TR'); let fs = Math.floor(h * 0.7); gx.font = 'bold ' + fs + 'px Arial'; while (fs > 10 && gx.measureText(t).width > w * 0.92) { fs--; gx.font = 'bold ' + fs + 'px Arial'; } gx.fillText(t, w / 2, h / 2 + 1); });   // levha metni genişliğe ve yüksekliğe sığdırılır
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
      if (s.circuits.some(c => c.cap)) {
        const rg = k.screen(0.096, 0.096, 256, (gx, w, h) => drawRgr(gx, w, h, app), door, { emissive: 0.9 });
        rg.position.set(S.w / 2, S.plinth + 1.29, 0.024);
        k.box(0.11, 0.11, 0.008, M.plasticDark, S.w / 2, S.plinth + 1.29, 0.02, door);
        scene.rgr = rg;
        k.pickable(rg, 'Reaktif güç rölesi (RGR)', () => { const r = app.validResult && app.validResult.values; return r ? ['cosφ ' + fmt(r.pf, 3) + ' · hedef ' + fmt(s.rgrTarget, 2), 'Q = ' + fmt(r.Q / 1e3, 1, 'kVAr'), (app.live.rgr && app.live.rgr.msg) || ''] : []; },
          a => [{ label: a.state.rgrAuto ? 'Elle moda al' : 'Otomatiğe al', onClick: x => { x.state.rgrAuto = !x.state.rgrAuto; x.running = true; x.paused = false; } }]);
      }
      k.pickable(scr, 'Enerji analizörü', () => { const r = app.validResult && app.validResult.values; return r ? ['U = ' + s.U_LL + ' V', 'P = ' + VS.fmtPower(r.P) + ' · Q = ' + fmt(r.Q / 1e3, 1, 'kVAr'), 'cosφ = ' + fmt(r.pf, 3)] : []; });
      // faz sinyal lambaları
      scene.lamps = ['L1', 'L2', 'L3'].map((p, j) => k.sphere(0.014, M.ledGreen, S.w / 2 - 0.06 + j * 0.06, S.plinth + 1.62, 0.03, door));
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
    if (kind === 'cap' || kind === 'shunt') {
      // kademe: NH sigorta tabanı (ya da MCCB) + kondansatör kontaktörü (ön dirençli) + kondansatör kapları / reaktör
      if (c.kind === 'FUSE') nhBase(k, dev, -0.27, 0.02, 0.6); else k.rbox(0.07, 0.12, 0.09, 0.008, M.plasticDark, -0.27, 0, 0.045, dev);
      k.rbox(0.06, 0.1, 0.1, 0.008, M.plasticGrey, -0.17, 0, 0.05, dev);
      for (let j = 0; j < 3; j++) k.cyl(0.004, 0.004, 0.05, M.plasticYellow, -0.19 + j * 0.02, 0.07, 0.07, dev, 6); // ön şarj dirençleri
      handle = k.box(0.02, 0.025, 0.02, M.plasticDark, -0.17, 0.02, 0.105, dev);
      if (kind === 'cap') {
        const n = Math.max(1, Math.min(4, Math.round(c.P_kW / 12.5)));
        for (let j = 0; j < n; j++) { k.cyl(0.03, 0.03, 0.18, M.alu, -0.06 + j * 0.068, -0.02, 0.06, dev, 18); k.cyl(0.011, 0.011, 0.02, M.plasticDark, -0.06 + j * 0.068, 0.08, 0.06, dev, 10); }
        if (c.detune) reactor(k, dev, 0.22, -0.02, 0.07, 0.75);
      } else reactor(k, dev, 0.05, -0.02, 0.07, 1.1);
      lamp = k.sphere(0.01, M.ledGreen, -0.17, 0.06, 0.105, dev);
    } else if (kind === 'fuse') {
      // NH bıçaklı sigorta tabanı (3 faz) + faz ayırıcı bölmeler
      nhBase(k, dev, 0, 0, 1);
      lamp = k.sphere(0.01, M.ledGreen, 0.09, 0.09, 0.07, dev);
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
    k.pickable(dev, c.name, () => info(app, ci), a => devActions(a, ci));
    scene.devices[ci] = { kind: kind, dev: dev, handle: handle, lamp: lamp, label: label, flow: fl, cable: cab };
  }

  /** NH sigorta tabanı: yalıtkan taban, üç gG sigorta bağlantısı (seramik gövde + bıçak kontaklar), faz ayırıcılar. */
  function nhBase(k, parent, x, y, sc) {
    const M = k.mats;
    k.box(0.17 * sc, 0.2 * sc, 0.02, M.plasticDark, x, y, 0.01, parent);
    for (let j = 0; j < 3; j++) {
      const fx = x + (j - 1) * 0.055 * sc;
      k.box(0.034 * sc, 0.075 * sc, 0.035, M.porcelainGrey, fx, y, 0.04, parent);
      k.box(0.024 * sc, 0.02 * sc, 0.006, M.galv, fx, y + 0.055 * sc, 0.04, parent);
      k.box(0.024 * sc, 0.02 * sc, 0.006, M.galv, fx, y - 0.055 * sc, 0.04, parent);
      if (j < 2) k.box(0.004, 0.19 * sc, 0.05, M.plasticRed, fx + 0.0275 * sc, y, 0.035, parent);
    }
  }
  /** Üç fazlı hava aralıklı demir çekirdekli reaktör (ayarlı filtre veya şönt). */
  function reactor(k, parent, x, y, z, sc) {
    const M = k.mats;
    k.box(0.16 * sc, 0.025 * sc, 0.07 * sc, M.darkSteel, x, y + 0.075 * sc, z, parent);
    k.box(0.16 * sc, 0.025 * sc, 0.07 * sc, M.darkSteel, x, y - 0.075 * sc, z, parent);
    for (let j = 0; j < 3; j++) { k.box(0.02 * sc, 0.13 * sc, 0.04 * sc, M.darkSteel, x + (j - 1) * 0.055 * sc, y, z, parent); k.cyl(0.024 * sc, 0.024 * sc, 0.11 * sc, M.copper, x + (j - 1) * 0.055 * sc, y, z, parent, 16); }
  }

  function buildDin(k, g, items, s, app, scene) {
    const M = k.mats;
    const rails = [S.plinth + 1.5, S.plinth + 1.2, S.plinth + 0.9];
    const dz = k.staticGroup(g);   // raylar, kanallar ve klemensler: tek parça süsleme
    rails.forEach(y => k.box(S.w - 0.14, 0.035, 0.008, M.galv, 0, y, -S.d / 2 + 0.05, dz));
    // kablo kanalları
    rails.forEach(y => k.box(S.w - 0.12, 0.05, 0.05, M.plasticGrey, 0, y + 0.13, -S.d / 2 + 0.07, dz));
    // klemens dizisi
    for (let j = 0; j < 22; j++) k.box(0.0055, 0.045, 0.04, j % 5 === 4 ? M.plasticYellow : j % 5 === 3 ? M.plasticBlue : M.plasticGrey, -0.3 + j * 0.0062 * 4.5, S.plinth + 0.4, -S.d / 2 + 0.07, dz);
    let rail = 0, x = -S.w / 2 + 0.1;
    const place = (wMod) => { const w = wMod * 0.018; if (x + w > S.w / 2 - 0.08) { rail++; x = -S.w / 2 + 0.1; } const px = x + w / 2; x += w + 0.004; return { x: px, y: rails[Math.min(rail, 2)] }; };
    if (s.panelType === 'OTOM' && !scene.plcLeds) {
      // PLC rafı ve güç kaynağı (eğitim gösterimi)
      const psu = place(4); k.rbox(0.07, 0.09, 0.11, 0.005, M.plasticGrey, psu.x, psu.y, -S.d / 2 + 0.1, g);
      const cpu = place(5); const cp = k.rbox(0.09, 0.1, 0.1, 0.006, M.plasticDark, cpu.x, cpu.y, -S.d / 2 + 0.1, g);
      k.pickable(cp, 'PLC CPU', () => ['IEC 61131-3 programlanabilir denetleyici', 'Emniyet fonksiyonları için ISO 13849-1 / IEC 62061’e göre doğrulanmış emniyet rölesi gerekir.']);
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
      k.pickable(dev, c.name, () => info(app, ci), a => devActions(a, ci));
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
    k.pickable(body, c.name + ' (motor)', () => info(app, ci), a => devActions(a, ci));
    const label = k.label(c.name, body, [0, size + 0.08, 0], 'vs-label--sm');
    return { ci: ci, fan: fan, label: label, body: body };
  }

  /** 3D bilgi kartındaki eylemler: devreyi aç/kapat, açan cihazı kur, motoru çalıştır/durdur. */
  function devActions(app, ci) {
    const c = app.state.circuits[ci]; if (!c) return [];
    const acts = [];
    if (c.tripped) acts.push({ label: 'Cihazı kur (reset)', variant: 'warn', onClick: a => { c.tripped = false; c.tripReason = ''; a.live.events.push(c.name + ': cihaz elle kuruldu.'); } });
    else acts.push({ label: c.on ? 'Kapat (OFF)' : 'Aç (ON)', onClick: a => { c.on = !c.on; a.live.events.push(c.name + (c.on ? ' devreye alındı.' : ' devreden çıkarıldı.')); } });
    if (c.motor && c.on && !c.tripped) acts.push({ label: c.running ? 'Motoru durdur' : 'Motoru çalıştır', variant: c.running ? '' : 'primary', onClick: a => { c.running = !c.running; if (c.running) a.live.inrush[ci] = 0; } });
    acts.push({ label: 'Parametreleri düzenle', onClick: a => { a.state.sel = ci; } });
    return acts;
  }

  function info(app, ci) {
    const r = app.validResult && app.validResult.values, c = app.state.circuits[ci];
    if (!r || !c) return [];
    const cr = r.circuits[ci];
    return [
      (isQ(c) ? qLabel(c) : (c.motor ? 'Motor ' : '') + fmt(c.P_kW, 1, 'kW') + ' · cosφ ' + fmt(c.cos, 2)) + ' · ' + c.phase,
      'Akım: ' + fmt(cr.I, 1, 'A') + (c.tripped ? ' · AÇTI (' + c.tripReason + ')' : !cr.active ? (app.live.mainTripped && c.on ? ' · enerjisiz (ana şalter açık)' : ' · devre dışı') : ''),
      (c.kind === 'MCB' ? 'MCB ' + c.curve : c.kind === 'FUSE' ? 'NH gG sigorta ' : 'MCCB ') + c.In + ' A · ' + fmt(c.S, c.S % 1 ? 1 : 0) + ' mm² · ' + c.L + ' m',
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

  function drawRgr(g, w, h, app) {
    const r = app.validResult && app.validResult.values, s = app.state;
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f59e0b'; g.font = 'bold 20px monospace'; g.fillText('RGR ' + (s.rgrAuto ? 'OTO' : 'EL'), 14, 28);
    if (!r) return;
    g.fillStyle = '#e2e8f0'; g.font = 'bold 40px monospace'; g.fillText(fmt(r.pf, 2) + (r.Q < 0 ? 'C' : 'i'), 14, 82);
    g.font = '18px monospace'; g.fillStyle = '#94a3b8'; g.fillText('hedef ' + fmt(s.rgrTarget, 2), 14, 110);
    const caps = s.circuits.filter(c => c.cap), n = caps.length, bw = Math.min(26, (w - 28) / Math.max(n, 1) - 4);
    caps.forEach((c, i) => { g.fillStyle = c.tripped ? '#ef4444' : c.on ? '#10b981' : '#334155'; g.fillRect(14 + i * (bw + 4), 140, bw, 26); });
    g.fillStyle = '#94a3b8'; g.font = '16px monospace'; g.fillText(caps.filter(c => c.on).length + '/' + n + ' kademe', 14, 200);
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
    sc.flows.forEach(f => { f.f.speed = live.mainTripped ? 0 : Math.min(1.2, (v.phases[f.p] || 0) / Math.max(v.mainIr, 1) * 1.5); });
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
      if (d.lamp) d.lamp.material = c.tripped ? M.ledRed : cr.active ? M.ledGreen : c.on && !v.noSupply ? M.ledAmber : M.ledOff;
      if (d.label) { d.label.set(c.name + (cr.active ? ' · ' + fmt(cr.I, 0) + ' A' : c.tripped ? ' · AÇTI' : v.noSupply && c.on ? ' · enerjisiz' : ' · kapalı')); d.label.level(c.tripped ? 'bad' : cr.loadPct > 100 ? 'warn' : cr.active ? 'ok' : ''); }
      if (d.flow) d.flow.speed = cr.active ? Math.min(1.4, 0.15 + cr.loadPct / 100) : 0;
      if (d.dev && d.dev.userData.vfdScreen) d.dev.userData.vfdScreen.redraw();
    });
    sc.motors.forEach(m => { const c = s.circuits[m.ci]; const cr = v.circuits[m.ci]; if (!c || !cr) return; m.label.set(c.name + (cr.active ? ' · çalışıyor' : c.tripped ? ' · AÇTI' : v.noSupply ? ' · enerjisiz' : ' · duruyor')); m.label.level(c.tripped ? 'bad' : cr.active ? 'ok' : ''); });
    if (sc.analyzer) sc.analyzer.redraw();
    if (sc.rgr) sc.rgr.redraw();
    void T;
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return false;
    let moving = false;
    // kapak açılıp kapanma
    const target = s.doorOpen ? -1.62 : 0;
    sc.doors.forEach((d, i) => { const tt = target * (1 - i * 0.02), e = tt - d.rotation.y; if (Math.abs(e) > 1e-4 && dt > 0) { d.rotation.y += e * Math.min(1, dt * 4); moving = true; } else d.rotation.y = tt; });
    sc.motors.forEach(m => {
      const c = s.circuits[m.ci], cr = res.values.circuits[m.ci];
      m.speed = m.speed || 0;
      const want = cr && cr.active ? (c.start === 'VFD' ? 1 : 1) * 25 : 0;
      m.speed += (want - m.speed) * Math.min(1, dt * (c.start === 'DOL' ? 1.6 : 0.7));
      if (Math.abs(want - m.speed) < 0.01) m.speed = want;
      if (!k.reducedMotion && m.speed > 0 && dt > 0) { m.fan.rotation.x += m.speed * dt; moving = true; }
    });
    // kısa devre kıvılcımı
    if (live.spark && sc.devices[live.spark.i]) {
      const d = sc.devices[live.spark.i];
      d.dev.getWorldPosition(sc.flash.position);
      const fi = live.spark.t < 0.6 && !k.reducedMotion ? 6 * Math.abs(Math.sin(live.spark.t * 40)) : 0;
      if (fi !== sc.flash.intensity) { sc.flash.intensity = fi; moving = true; }
    } else if (sc.flash.intensity) { sc.flash.intensity = 0; moving = true; }
    // PLC G/Ç LED'leri yalnız benzetim çalışırken yanıp söner
    if (sc.plcLeds && app.running && !app.paused) {
      const ph = Math.floor(app.simTime * 2);
      if (ph !== sc._plcPh) { sc._plcPh = ph; sc.plcLeds.forEach((l, i) => { l.material = (Math.floor(app.simTime * 2 + i * 1.7) % 3 === 0) ? k.mats.ledGreen : k.mats.ledOff; }); moving = true; }
    }
    return moving;
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması */
  const COL_W = 104, ROW_H = 236;
  // dar ekranda üstteki görünüm düğmeleri şemanın üstüne binmesin diye başlık aşağı kaydırılır
  const headH = W => (W < 600 ? 196 : 140);
  function layout2d(W, n) { const per = Math.max(1, Math.floor((W - 40) / COL_W)); return { per: per, rows: Math.ceil(n / per) }; }
  /** Gerekli tuval yüksekliği: devre sayısı arttıkça şema satırlara bölünür ve sahne dikey kaydırılır. */
  function view2dHeight(W, res, s) { const l = layout2d(W, s.circuits.length); return headH(W) + l.rows * ROW_H + 20; }
  function clip(g, text, w) {
    if (g.measureText(text).width <= w) return text;
    let t = text; while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1);
    return t + '…';
  }
  function view2d(g, W, H, res, s, live) {
    const v = res.values;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0' };
    g.lineWidth = 2; g.strokeStyle = col.line; g.fillStyle = col.text; g.font = '12px Inter, sans-serif'; g.textAlign = 'center';
    const narrow = W < 600, HEAD_H = headH(W), cx = narrow ? 40 : Math.min(W / 2, 220), top = HEAD_H - 116, R = narrow ? 150 : 30; // R: sağdaki düğmelerin payı
    // kaynak
    g.textAlign = 'left';
    if (v.source === 'gen') { g.beginPath(); g.arc(cx, top + 18, 16, 0, Math.PI * 2); g.stroke(); g.fillText('G', cx - 4, top + 22); g.fillStyle = col.dim; g.fillText(clip(g, 'Jeneratör ' + s.gen_kVA + ' kVA · X’’d %' + s.gen_xd, W - cx - R), cx + 24, top + 22); }
    else { g.beginPath(); g.arc(cx, top + 10, 11, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(cx, top + 27, 11, 0, Math.PI * 2); g.stroke(); g.fillStyle = col.dim; g.fillText(clip(g, 'Trafo ' + s.trafo_kVA + ' kVA · uk %' + s.trafo_uk, W - cx - R), cx + 20, top + 24); }
    // ana şalter
    const yb = top + 40; g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx, yb); g.lineTo(cx, yb + 14); g.stroke();
    const mainOn = !live.mainTripped;
    g.strokeStyle = mainOn ? col.ok : col.bad; g.beginPath(); g.moveTo(cx, yb + 14); g.lineTo(cx + (mainOn ? 0 : 12), yb + 36); g.stroke();
    g.fillStyle = col.text; g.fillText(clip(g, s.mainKind + ' ' + s.mainIn + ' A · Ir ' + fmt(v.mainIr, 0) + ' A', W - cx - R), cx + 16, yb + 30);
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx, yb + 36); g.lineTo(cx, HEAD_H - 14); g.stroke();
    const n = s.circuits.length, L2 = layout2d(W, n);
    const x0 = 20, rowW = Math.min(W - 40, L2.per * COL_W);
    g.fillStyle = col.dim; g.font = '11px Inter, sans-serif';
    g.fillText(clip(g, 'Bara ' + s.busbarIn + ' A · Ik3 ≈ ' + fmt(v.Ik3 / 1e3, 1) + ' kA · L1/L2/L3 ' + fmt(v.phases.L1, 0) + '/' + fmt(v.phases.L2, 0) + '/' + fmt(v.phases.L3, 0) + ' A', W - cx - 30), cx + 12, HEAD_H - 22);
    for (let r = 0; r < L2.rows; r++) {
      const by = HEAD_H - 10 + r * ROW_H;
      const cnt = Math.min(L2.per, n - r * L2.per), segW = cnt * COL_W;
      g.lineWidth = 5; g.strokeStyle = '#c77b4a'; g.beginPath(); g.moveTo(x0, by); g.lineTo(x0 + Math.max(segW, 60), by); g.stroke(); g.lineWidth = 2;
      if (r > 0) { g.setLineDash([4, 4]); g.strokeStyle = '#c77b4a'; g.beginPath(); g.moveTo(x0, by - ROW_H); g.lineTo(x0, by); g.stroke(); g.setLineDash([]); }
    }
    g.textAlign = 'center';
    s.circuits.forEach((c, i) => {
      const r = Math.floor(i / L2.per), k = i % L2.per;
      const x = x0 + k * COL_W + COL_W / 2, by = HEAD_H - 10 + r * ROW_H, cr = v.circuits[i];
      const lv = c.tripped ? col.bad : !cr.coord ? col.warn : cr.active ? col.ok : col.dim;
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by); g.lineTo(x, by + 18); g.stroke();
      if (c.kind === 'FUSE') { g.strokeStyle = lv; g.strokeRect(x - 5, by + 18, 10, 22); g.beginPath(); g.moveTo(x, by + 18); g.lineTo(x, by + 40); g.stroke(); }
      else { g.strokeStyle = lv; g.beginPath(); g.moveTo(x, by + 18); g.lineTo(x + (c.on && !c.tripped ? 0 : 10), by + 40); g.stroke(); }
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by + 40); g.lineTo(x, by + 96); g.stroke();
      if (c.motor) { g.beginPath(); g.arc(x, by + 110, 13, 0, Math.PI * 2); g.stroke(); g.fillStyle = col.text; g.fillText('M', x, by + 114); }
      else if (c.cap) { g.beginPath(); g.moveTo(x - 10, by + 98); g.lineTo(x + 10, by + 98); g.moveTo(x - 10, by + 104); g.lineTo(x + 10, by + 104); g.stroke(); if (c.detune) { g.beginPath(); for (let j = 0; j < 3; j++) g.arc(x, by + 78 + j * 6, 3, -Math.PI / 2, Math.PI / 2); g.stroke(); } }
      else if (c.shunt) { g.beginPath(); for (let j = 0; j < 4; j++) g.arc(x, by + 100 + j * 6, 3, -Math.PI / 2, Math.PI / 2); g.stroke(); }
      else g.strokeRect(x - 9, by + 98, 18, 18);
      g.fillStyle = lv; g.font = 'bold 11px Inter, sans-serif'; g.textAlign = 'left';
      g.fillText(clip(g, (c.kind === 'MCB' ? c.curve : c.kind === 'FUSE' ? 'gG' : '') + c.In + ' A', COL_W / 2 - 10), x + 9, by + 34); g.textAlign = 'center';
      g.fillStyle = col.text; g.font = '11px Inter, sans-serif';
      const name = (i + 1) + '. ' + c.name, w = COL_W - 10;
      const words = name.split(' '); let l1 = '', idx = 0;
      while (idx < words.length && g.measureText((l1 ? l1 + ' ' : '') + words[idx]).width <= w) { l1 += (l1 ? ' ' : '') + words[idx]; idx++; }
      if (!l1) { l1 = clip(g, name, w); idx = words.length; }
      g.fillText(l1, x, by + 142);
      if (idx < words.length) g.fillText(clip(g, words.slice(idx).join(' '), w), x, by + 156);
      g.fillStyle = col.dim; g.font = '10px Inter, sans-serif';
      g.fillText(clip(g, fmt(cr.I, 1) + ' A · ΔU %' + fmt(cr.vd, 1), w), x, by + 176);
      g.fillText(clip(g, fmt(c.S, c.S % 1 ? 1 : 0) + ' mm² · ' + c.L + ' m', w), x, by + 190);
      if (c.tripped) { g.fillStyle = col.bad; g.fillText('AÇTI', x, by + 206); } else if (live.mainTripped && c.on) { g.fillStyle = col.dim; g.fillText('enerjisiz', x, by + 206); }
    });
  }

  VS.register({
    id: 'pano', title: '3D Elektrik Pano Simülasyonu',
    defaults: () => defaults('ADP'),
    initLive: s => ({ inrush: s.circuits.map(() => -1), timers: {}, mainTripped: false, mainTimer: 0, events: [], hist: [], histT: 0, spark: null }),
    autoRun: true,
    startText: 'Simülasyon çalışıyor: motorlar yol alıyor, koruma cihazları izleniyor.',
    start: app => { app.live.inrush = app.state.circuits.map(c => (c.motor && c.running ? 0 : -1)); app.live.hist = []; app._startedOnce = true; },
    tasks: [
      { id: 'coord', title: 'Kablo–sigorta koordinasyonunu düzelt', goal: 'Priz devresinde 2,5 mm² kabloya C32 seçilmiş. Ib ≤ In ≤ Iz ve I2 ≤ 1,45·Iz koşulunu sağlayın.', hint: 'Seçili devrede koruma akımını kablonun Iz değerine indirin ya da kesiti büyütün.',
        state: (() => { const d = defaults('ADP'); d.circuits[1].In = 32; d.sel = 1; return d; })(),
        check: (r, s) => { const c = r.checks.find(x => x.id === 'coord1'); return c && c.status === 'ok' && s.circuits[1] && s.circuits[1].on && s.circuits[1].P_kW >= 2; } },
      { id: 'balance', title: 'Fazları dengele', goal: 'Tüm tek fazlı yükler L1’de toplanmış. Hiçbir devreyi kapatmadan faz dengesizliğini %10’un altına indirin.', hint: 'Seçili devre → Faz alanından yükleri L2 ve L3’e dağıtın.',
        state: (() => { const d = defaults('ADP'); d.circuits.forEach(c => { if (c.phase !== '3F') c.phase = 'L1'; }); return d; })(),
        check: (r, s) => r.values.unbalance < 10 && s.circuits.every(c => c.on && !c.tripped) },
      { id: 'rcd', title: 'Kaçak akım rölesini test et', goal: 'Priz grubunda yalıtım hatası oluşturun ve 30 mA kaçak akım rölesinin açtığını görün.', hint: 'Arıza senaryoları → kaçak akım kaydırıcısını 30 mA’e getirin (seçili devre: Priz grubu).',
        state: Object.assign(defaults('ADP'), { sel: 1 }), start: true,
        check: (r, s) => s.circuits[1] && s.circuits[1].tripped && /Kaçak/.test(s.circuits[1].tripReason) },
      { id: 'motor', title: 'Pompa 2’yi devreye al', goal: 'MCC panosunda duran Pompa 2’yi yıldız–üçgen yol vermeyle çalıştırın; 3D’de pompaya tıklayarak da yapabilirsiniz.', hint: 'Yük grupları listesinde ▶ düğmesi ya da 3D’de motora tıklayıp “Motoru çalıştır”.',
        state: defaults('MCC'), start: true,
        check: (r, s) => s.circuits[1] && s.circuits[1].running && r.values.circuits[1].active },
      { id: 'pf', title: 'Güç faktörünü 0,95’in üstüne çıkar', goal: 'Kompanzasyon panosunda kademeleri yöneterek cosφ ≥ 0,95 yapın; aşırı kompanzasyona (kapasitif) düşmeyin.', hint: 'Kademeleri tek tek açıp kapatın ve Analiz’deki güç faktörünü izleyin.',
        state: (() => { const d = defaults('KOMP'); d.rgrAuto = false; d.circuits.forEach(c => { if (c.cap) c.on = false; }); return d; })(),
        // yükleri kapatarak (P → 0) çözülemez: kompanzasyon dışı tüm devreler açık ve çalışır kalmalı
        check: (r, s) => r.values.pf >= 0.95 && r.values.Q >= 0 && s.circuits.every(c => c.cap || c.shunt || (c.on && !c.tripped)) && s.circuits[0].P_kW >= 96 },
      { id: 'gen', title: 'Jeneratörde otomatik kesmeyi sağla', goal: 'Transfer panosu jeneratörden besleniyor. Tüm devrelerde hat sonu arızada otomatik kesme koşulu (Ik1,min ≥ Ia) sağlansın.', hint: 'Uzun devrelerde kesiti büyütün, B eğrisi seçin ya da jeneratör gücünü/X’’d değerini değiştirin. Jeneratörde kısa devre akımı şebekeye göre çok düşüktür.',
        state: Object.assign(defaults('TRANSFER'), { source: 'gen', gen_kVA: 100 }),
        check: (r, s) => s.source === 'gen' && r.checks.filter(c => /^ad\d/.test(c.id)).every(c => c.status === 'ok') }
    ],
    scenarios: [
      { id: 'adp', name: 'Fabrika ADP · dengeli işletme', desc: 'Varsayılan ana dağıtım panosu: aydınlatma, priz, kaynak prizi, kompresör ve konveyör.', state: defaults('ADP') },
      { id: 'mcc', name: 'MCC · pompa istasyonu (Y-Δ ve VFD)', desc: 'İki pompa (yıldız–üçgen), fan (VFD) ve karıştırıcı; Pompa 2’yi ▶ ile devreye alın.', state: defaults('MCC') },
      { id: 'komp', name: 'Kompanzasyon panosu · RGR ile otomatik kademe', desc: 'Düşük cosφ’li tesis yükü, %7 filtreli 5 kademe ve şönt reaktör. Reaktif güç rölesi kademeleri gecikme ve deşarj kilidine uyarak tek tek devreye alır.', state: defaults('KOMP'), start: true },
      { id: 'big', name: 'Büyük ADP · 30 çıkış', desc: '30 devreli ana dağıtım panosu: pano bölümleri, DIN rayları ve tek hat şeması devre sayısına göre büyür.', state: (() => { const d = defaults('ADP'); const kinds = ['light', 'socket', 'load3', 'nh', 'motor']; for (let i = 0; i < 24; i++) { const c = ADD[kinds[i % 5]](); c.name += ' ' + (i + 1); c.phase = c.phase === '3F' ? '3F' : ['L1', 'L2', 'L3'][i % 3]; if (c.motor) c.running = true; d.circuits.push(c); } d.mainIn = 630; d.busbarIn = 800; d.trafo_kVA = 1000; d.trafo_uk = 6; d.feedS = 240; d.feedN = 2; return d; })() },
      { id: 'transfer-gen', name: 'Transfer panosu · jeneratörde kısa devre akımı', desc: 'Jeneratör beslemesinde Ik düşer; uzun devrelerde otomatik kesme koşulunun nasıl bozulduğunu görün.', state: Object.assign(defaults('TRANSFER'), { source: 'gen', gen_kVA: 150 }) },
      { id: 'wrong', name: 'Hatalı seçim · 2,5 mm² kabloya C32', desc: 'Priz devresinde kablo–sigorta koordinasyonu bozuk; ön kontrol uyarısını inceleyin.', state: (() => { const d = defaults('ADP'); d.circuits[1].In = 32; d.sel = 1; return d; })() },
      { id: 'unbal', name: 'Dengesiz yük · tek fazda yığılma', desc: 'Tüm tek fazlı yükler L1’de; nötr akımı ve dengesizlik artar.', state: (() => { const d = defaults('ADP'); d.circuits.forEach(c => { if (c.phase !== '3F') c.phase = 'L1'; }); return d; })() }
    ],
    controls: controls,
    compute: (s, app) => {
      // ana şalter açıksa bara enerjisiz: çıkışların kendi cihazları kapalı kalır ama hiçbir devre beslenmez (akım/güç 0)
      const noSupply = !!(app && app.live && app.live.mainTripped);
      const r = P.compute(noSupply ? Object.assign({}, s, { circuits: s.circuits.map(c => Object.assign({}, c, { on: false })) }) : s);
      if (r.values) r.values.noSupply = noSupply;
      const X = E.ext && E.ext.pano;
      if (r.ok && X) {
        const up = mainDev(s, r.values);
        s.circuits.forEach((c, i) => {
          const sv = X.selectivity(up, circDev(c), r.values.Ik3);
          r.checks.push({ id: 'sel' + i, label: c.name + ': ana şalter ile seçicilik', status: sv.status === 'fail' || sv.overlapThermal ? 'warn' : sv.status === 'warn' ? 'info' : sv.status, sel: sv.status, detail: sv.text + (sv.overlapThermal ? ' Termik bölgede bantlar çakışıyor.' : ''), ref: 'TS EN 60947-2 Ek A (yaklaşık)' });
        });
        r.assumptions = (r.assumptions || []).concat(['Seçicilik yalnız ani açma eşikleriyle (akım seçiciliği) değerlendirilir; zaman/enerji seçiciliği ve üretici seçicilik tabloları dahil değildir. Zaman–akım bantları standart sınır noktalarının log–log birleştirilmesidir, üretici eğrisi değildir.']);
      }
      return r;
    },
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => live.mainTripped ? { level: 'bad', text: 'Ana şalter açtı' } : s.circuits.some(c => c.tripped) ? { level: 'bad', text: s.circuits.filter(c => c.tripped).length + ' cihaz açtı' } : null,
    reportInputs: s => s.circuits.map((c, i) => ({ group: 'Yük grupları', label: (i + 1) + '. ' + c.name, value: (isQ(c) ? qLabel(c) : fmt(c.P_kW, 1, 'kW') + ' cosφ ' + fmt(c.cos, 2)) + ' · ' + c.phase + ' · ' + (c.kind === 'MCB' ? 'MCB ' + c.curve : c.kind === 'FUSE' ? 'NH gG ' : 'MCCB ') + c.In + ' A · ' + c.S + ' mm² ' + c.method + ' · ' + c.L + ' m' + (c.rcd ? ' · RCD ' + c.rcd + ' mA' : '') + (c.on ? '' : ' · kapalı') + (c.motor ? (c.running ? ' · çalışıyor' : ' · duruyor') : '') })),
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-2, 2] },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
