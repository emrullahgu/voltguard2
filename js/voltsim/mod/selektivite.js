/* VoltSim · 3D Kısa Devre ve Selektivite Simülasyonu
 * Hesap: VoltSimEngine.ext.selektivite (IEC 60909 yaklaşımıyla bara kısa devre akımları — motorun sourceImpedance /
 * cableImpedance / shortCircuit3 / shortCircuit1Min fonksiyonları; MCB · gG · LSI zaman–akım bantları; üst–alt cihaz
 * zaman–akım seçiciliği; seçili arızada açma sırası). Sahne: trafo → ana dağıtım panosu (ACB + çıkışlar) → tali panolar →
 * son devreler. Baraya tıklayıp arızayı oraya koyabilir, cihaz ayarlarını 3D kartından değiştirebilirsiniz. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const S = E.ext.selektivite;

  const IN_OPTS = {
    MCB: [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125],
    FUSE: E.FUSE_SIZES.slice(),
    MCCB: [63, 100, 125, 160, 250, 400, 630],
    ACB: [630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000]
  };
  const ICU = [6, 10, 15, 25, 36, 50, 65, 85, 100, 120];
  const SECT = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
  const ISD = [[0, 'Kapalı'], [1.5, '1,5 × Ir'], [2, '2 × Ir'], [3, '3 × Ir'], [4, '4 × Ir'], [5, '5 × Ir'], [6, '6 × Ir'], [8, '8 × Ir'], [10, '10 × Ir']];
  const II = [[0, 'Kapalı'], [2, '2 × In'], [3, '3 × In'], [4, '4 × In'], [6, '6 × In'], [8, '8 × In'], [10, '10 × In'], [12, '12 × In'], [15, '15 × In']];
  const TSD = [[0.05, '0,05 s'], [0.1, '0,1 s'], [0.2, '0,2 s'], [0.3, '0,3 s'], [0.4, '0,4 s']];
  const TR = [1, 2, 4, 5, 8, 10, 12, 16, 20, 24].map(v => [v, fmt(v, 0, 's') + ' (6·Ir’de)']);
  const COLORS = ['#f59e0b', '#22b8cf', '#a78bfa', '#10b981', '#ef4444', '#3b82f6'];
  const SHORT = { ACB: 'ACB', MCCB: 'MCCB', MCB: 'MCB', FUSE: 'gG' };

  /** Tüm alanları dolu cihaz şablonu (kayıt/yükleme tip uyumu için her cihaz aynı alanlara sahiptir). */
  function dev(o) {
    return Object.assign({ name: 'Cihaz', kind: 'MCB', parent: 0, In: 16, curve: 'C', ir: 1, tr: 10, isd: 0, tsd: 0.1, ii: 10, Icu: 10, L: 20, S: 2.5, n: 1, mat: 'Cu', load: 'priz' }, o);
  }
  function defaults() {
    return {
      U_LL: 400, Sr_kVA: 1000, uk: 6, Pk_W: 10500, SkQ_MVA: 500,
      devices: [
        dev({ name: 'Q0 ACB', kind: 'ACB', parent: -1, In: 1600, ir: 1, tr: 12, isd: 4, tsd: 0.3, ii: 0, Icu: 65, L: 12, S: 240, n: 4, load: 'bara' }),
        dev({ name: 'Q1 MCCB', kind: 'MCCB', parent: 0, In: 400, ir: 0.8, tr: 8, isd: 6, tsd: 0.1, ii: 10, Icu: 50, L: 40, S: 150, n: 1, load: 'pano' }),
        dev({ name: 'Q2 NH gG', kind: 'FUSE', parent: 0, In: 160, Icu: 120, L: 60, S: 70, n: 1, load: 'pano' }),
        dev({ name: 'Q3 MCCB motor', kind: 'MCCB', parent: 0, In: 250, ir: 0.9, tr: 5, isd: 0, tsd: 0.1, ii: 12, Icu: 50, L: 30, S: 95, n: 1, load: 'motor' }),
        dev({ name: 'F11 C16', kind: 'MCB', parent: 1, In: 16, curve: 'C', Icu: 25, L: 30, S: 2.5, load: 'priz' }),
        dev({ name: 'F12 B10', kind: 'MCB', parent: 1, In: 10, curve: 'B', Icu: 25, L: 25, S: 1.5, load: 'aydinlatma' }),
        dev({ name: 'F13 gG 63', kind: 'FUSE', parent: 1, In: 63, Icu: 100, L: 40, S: 16, load: 'makine' }),
        dev({ name: 'F21 D20', kind: 'MCB', parent: 2, In: 20, curve: 'D', Icu: 15, L: 20, S: 4, load: 'motor' }),
        dev({ name: 'F22 gG 63', kind: 'FUSE', parent: 2, In: 63, Icu: 100, L: 35, S: 16, load: 'makine' })
      ],
      sel: 4, fault: 4, faultType: '3F', tcc: 'path', slow: 1
    };
  }

  /* ---------------------------------------------------------------- yardımcılar */
  const fA = I => (I >= 1e3 ? fmt(I / 1e3, I >= 1e4 ? 1 : 2, 'kA') : fmt(I, 0, 'A'));
  const fT = t => (t === null || t === undefined ? '—' : t < 0.1 ? fmt(t * 1e3, 0, 'ms') : t < 10 ? fmt(t, 2, 's') : fmt(t, 0, 's'));
  const levelOf = (s, i) => S.levelOf(s.devices, i);
  const kidsOf = (s, i) => s.devices.map((d, k) => (d.parent === i ? k : -1)).filter(k => k >= 0);
  function settingText(d) {
    if (d.kind === 'MCB') return d.curve + d.In + ' · ' + fmt(S.MCB_BANDS[d.curve][0], 0) + '–' + fmt(S.MCB_BANDS[d.curve][1], 0) + '·In ani';
    if (d.kind === 'FUSE') return 'gG ' + d.In + ' A · NH';
    const st = S.settings(d);
    return SHORT[d.kind] + ' ' + d.In + ' A · Ir ' + fmt(st.Ir, 0) + ' A · tr ' + fmt(d.tr, 0) + ' s' + (st.Isd ? ' · Isd ' + fA(st.Isd) + ' / ' + fmt(d.tsd, 2) + ' s' : ' · S kapalı') + (st.Ii ? ' · Ii ' + fA(st.Ii) : ' · I kapalı');
  }
  /** Bir cihazın türü değişince anma akımı ve ayarları türe uygun başlangıç değerine alınır. */
  function retype(d, kind) {
    d.kind = kind;
    const opts = IN_OPTS[kind];
    if (opts.indexOf(d.In) < 0) d.In = opts.reduce((a, b) => (Math.abs(b - d.In) < Math.abs(a - d.In) ? b : a), opts[0]);
    if (kind === 'ACB') { d.ir = 1; d.tr = 12; d.isd = 4; d.tsd = 0.3; d.ii = 0; d.Icu = Math.max(d.Icu, 50); }
    if (kind === 'MCCB') { d.ir = 1; d.tr = 8; d.isd = 6; d.tsd = 0.1; d.ii = 10; d.Icu = Math.max(d.Icu, 36); }
    if (kind === 'MCB') { d.curve = d.curve || 'C'; d.Icu = Math.min(Math.max(d.Icu, 6), 25); }
    if (kind === 'FUSE') d.Icu = 100;
  }
  function addDevice(a, parent) {
    const s = a.state, lv = parent < 0 ? 0 : levelOf(s, parent) + 1;
    if (lv > 2) { VS.toast('Bu modelde en çok üç kademe (ana · tali · son devre) vardır.'); return; }
    const n = kidsOf(s, parent).length + 1;
    const pName = s.devices[parent].name.split(' ')[0];
    const d = lv === 1 ? dev({ name: 'Q' + (s.devices.filter(x => x.parent === 0).length + 1) + ' MCCB', kind: 'MCCB', parent: parent, In: 160, ir: 1, tr: 8, isd: 6, tsd: 0.1, ii: 10, Icu: 36, L: 40, S: 70, load: 'pano' })
      : dev({ name: 'F' + pName.replace(/\D/g, '') + n + ' C16', kind: 'MCB', parent: parent, In: 16, curve: 'C', Icu: 10, L: 25, S: 2.5, load: 'priz' });
    // ebeveynin son alt cihazından hemen sonra eklenir (indeks sırası korunur: ebeveyn < çocuk)
    let at = parent + 1; for (let k = parent + 1; k < s.devices.length; k++) if (S.pathOf(s.devices, k).indexOf(parent) >= 0) at = k + 1;
    s.devices.splice(at, 0, d);
    s.devices.forEach((x, k) => { if (k !== at && x.parent >= at) x.parent++; });
    if (s.fault >= at) s.fault++;
    s.sel = at;
  }
  function removeDevice(a, i) {
    const s = a.state; if (i <= 0) { VS.toast('Ana kesici (kök) silinemez.'); return; }
    const gone = new Set(s.devices.map((d, k) => k).filter(k => S.pathOf(s.devices, k).indexOf(i) >= 0));
    const map = []; let n = 0; s.devices.forEach((d, k) => { map[k] = gone.has(k) ? -1 : n++; });
    s.devices = s.devices.filter((d, k) => !gone.has(k)).map(d => Object.assign(d, { parent: d.parent < 0 ? -1 : map[d.parent] }));
    s.sel = Math.max(0, map[i - 1] || 0);
    s.fault = map[s.fault] >= 0 ? map[s.fault] : 0;
  }

  /* ---------------------------------------------------------------- hesap */
  function compute(s) {
    const r = S.compute(s);
    if (!r.ok) return r;
    const v = r.values, sel = Math.min(s.sel, s.devices.length - 1);
    v.sel = sel;
    v.pair = sel > 0 ? v.pairs.find(p => p.down === sel) : null;
    return r;
  }
  const chk = (res, id) => res.checks.find(c => c.id === id);
  const lvOf = c => (!c ? undefined : c.status === 'fail' ? 'bad' : c.status === 'warn' ? 'warn' : c.status === 'ok' ? 'ok' : undefined);

  /* ---------------------------------------------------------------- 3D eylemleri */
  function devActions(app, i) {
    const s = app.state, d = s.devices[i]; if (!d) return [];
    const acts = [{ label: 'Eğride göster', variant: s.sel === i ? '' : 'primary', onClick: a => { a.state.sel = i; } },
      { label: 'Arızayı bu çıkışa koy', variant: 'danger', onClick: a => { a.state.fault = i; resetFault(a); } }];
    if (d.kind === 'ACB' || d.kind === 'MCCB') {
      acts.push({ label: 'tsd bir kademe ↑', onClick: a => { const x = a.state.devices[i]; const o = TSD.map(t => t[0]); x.tsd = o[Math.min(o.length - 1, o.indexOf(x.tsd) + 1)] || 0.2; if (!x.isd) x.isd = 6; } });
      acts.push({ label: d.ii ? 'Ani (I) korumayı kapat' : 'Ani (I) korumayı aç', variant: 'warn', onClick: a => { const x = a.state.devices[i]; if (x.ii) { if (!x.isd) x.isd = 6; x.ii = 0; } else x.ii = 10; } });
      acts.push({ label: 'Ir −0,05', onClick: a => { const x = a.state.devices[i]; x.ir = Math.max(0.4, Math.round((x.ir - 0.05) * 100) / 100); } });
      acts.push({ label: 'Ir +0,05', onClick: a => { const x = a.state.devices[i]; x.ir = Math.min(1, Math.round((x.ir + 0.05) * 100) / 100); } });
    } else {
      const o = IN_OPTS[d.kind], k = o.indexOf(d.In);
      acts.push({ label: 'In bir kademe ↓', onClick: a => { const x = a.state.devices[i]; x.In = o[Math.max(0, k - 1)]; } });
      acts.push({ label: 'In bir kademe ↑', onClick: a => { const x = a.state.devices[i]; x.In = o[Math.min(o.length - 1, k + 1)]; } });
      if (d.kind === 'MCB') acts.push({ label: 'Eğri: ' + { B: 'C', C: 'D', D: 'B' }[d.curve], onClick: a => { const x = a.state.devices[i]; x.curve = { B: 'C', C: 'D', D: 'B' }[x.curve]; } });
    }
    return acts;
  }
  function devInfo(app, i) {
    const r = app.validResult, s = app.state, d = s.devices[i]; if (!r || !d) return [];
    const v = r.values, n = v.nodes[i]; if (!n) return [];
    const b = S.band(d, v.Ifault), onPath = v.resp.path.indexOf(i) >= 0;
    const out = [S.KINDS[d.kind], settingText(d), 'Bağlı olduğu barada Ik3 ≈ ' + fA(n.IkLine) + ' · Icu ' + fmt(d.Icu, 0, 'kA') + (d.Icu * 1e3 >= n.IkLine ? ' ✓' : ' ✕ yetersiz'),
      'Çıkış barası: Ik3 ≈ ' + fA(n.Ik3) + ' · Ik1,min ≈ ' + fA(n.Ik1) + ' · kablo ' + fmt(d.L, 0, 'm') + ' ' + (d.n > 1 ? d.n + '×' : '') + fmt(d.S, d.S % 1 ? 1 : 0, 'mm²')];
    if (onPath) out.push('Seçili arızada (' + fA(v.Ifault) + '): ' + (b.tmax === null ? (b.tmin === null ? 'açmaz' : 'açabilir (≥ ' + fT(b.tmin) + ')') : fT(b.tmin) + ' – ' + fT(b.tmax) + ' arasında açar') + (v.resp.first === i ? ' · İLK AÇAN' : ''));
    const p = v.pairs.find(x => x.down === i);
    if (p) out.push('Üst cihaza göre: ' + (p.status === 'total' ? 'tam zaman–akım seçiciliği' : 'Is ≈ ' + fA(p.Is) + (p.region === 'inst' ? ' (ani bölge — üretici tablosu)' : '')));
    return out;
  }
  function busInfo(app, i) {
    const r = app.validResult; if (!r) return [];
    const v = r.values, n = v.nodes[i], d = app.state.devices[i]; if (!n) return [];
    return [(i === 0 ? 'Ana dağıtım barası' : d.parent === 0 ? 'Tali pano barası' : 'Son devre ucu') + ' · ' + d.name + ' çıkışı',
      'Ik3,maks ≈ ' + fA(n.Ik3) + ' · ip ≈ ' + fA(n.ip) + ' (κ = ' + fmt(n.kappa, 2) + ')', 'Ik3,min ≈ ' + fA(n.Ik3min) + ' · Ik1,min ≈ ' + fA(n.Ik1),
      'Zk ≈ ' + fmt(Math.hypot(n.R, n.X) * 1e3, 2, 'mΩ') + ' (R ' + fmt(n.R * 1e3, 2) + ' · X ' + fmt(n.X * 1e3, 2) + ' mΩ)', app.state.fault === i ? 'Seçili arıza bu noktada.' : ''];
  }
  const busActions = i => [
    { label: 'Üç faz arızayı buraya koy', variant: 'danger', onClick: a => { a.state.fault = i; a.state.faultType = '3F'; resetFault(a); } },
    { label: 'Faz–toprak arızası (en küçük)', variant: 'warn', onClick: a => { a.state.fault = i; a.state.faultType = '1F'; resetFault(a); } }
  ];
  function resetFault(a) { a.live.phase = 'idle'; a.live.t = 0; a.live.el = 0; a.live.opened = []; a.live.maybe = []; }

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const r = app.validResult, sel = Math.min(s.sel, s.devices.length - 1), d = s.devices[sel], key = k => 'devices.' + sel + '.' + k;
    const g = [];
    g.push({ title: 'Besleme (trafo ve OG şebeke)', items: [
      { type: 'select', key: 'Sr_kVA', label: 'Trafo anma gücü Sr', options: [250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500].map(v => [v, v + ' kVA']), onChange: (v, a) => { a.state.Pk_W = { 250: 3250, 400: 4600, 630: 6500, 800: 8400, 1000: 10500, 1250: 13500, 1600: 17000, 2000: 21000, 2500: 26500 }[v] || a.state.Pk_W; a.renderControls(); } },
      { type: 'range', key: 'uk', label: 'Kısa devre gerilimi uk', min: 4, max: 8, step: 0.5, unit: '%', digits: 1 },
      { type: 'number', key: 'Pk_W', label: 'Trafo yük kaybı Pk', min: 0, max: 60000, step: 100, unit: 'W', help: 'RT = Pk·U²/Sr² (κ ve faz–toprak akımı için).' },
      { type: 'number', key: 'SkQ_MVA', label: 'OG şebeke kısa devre gücü S"kQ', min: 0, max: 5000, step: 10, unit: 'MVA', help: 'Dağıtım şirketinden alınan değer; 0 = sonsuz güçlü şebeke (güvenli tarafta en büyük Ik).' },
      { type: 'select', key: 'U_LL', label: 'AG gerilimi', options: [[400, '400 V'], [415, '415 V'], [690, '690 V']] },
      r ? { type: 'note', html: 'Trafo AG uçlarında Ik3 ≈ <b>' + fA(r.values.Ik3T) + '</b> · ip ≈ ' + fA(r.values.ipT) } : null
    ] });
    g.push({ title: 'Koruma ağacı (' + s.devices.length + ' cihaz)', items: [
      { type: 'custom', render: (box, a) => {
        const list = VS.el('div', { class: 'vs-cl', style: s.devices.length > 12 ? 'max-height:360px;overflow:auto' : null });
        s.devices.forEach((x, i) => {
          const lv = levelOf(s, i), p = r && r.values.pairs.find(q => q.down === i);
          const icu = r && r.values.nodes[i] ? x.Icu * 1e3 >= r.values.nodes[i].IkLine : true;
          const lvl = !icu ? 'bad' : p && p.status !== 'total' ? (p.region === 'inst' ? 'warn' : 'bad') : 'ok';
          const row = VS.el('div', { class: 'vs-cl__row' + (i === sel ? ' is-sel' : ''), 'data-level': lvl, style: lv ? 'padding-left:' + lv * 14 + 'px' : null });
          const b = VS.el('button', { type: 'button', class: 'vs-cl__name', 'aria-pressed': i === sel ? 'true' : 'false', title: 'Düzenle ve eğride göster' }, [
            VS.el('i', { 'aria-hidden': 'true' }), VS.el('span', { text: x.name }),
            VS.el('small', { text: settingText(x) + (p ? ' · ' + (p.status === 'total' ? 'seçici' : 'Is ' + fA(p.Is)) : '') })]);
          b.onclick = () => { a.state.sel = i; a.renderControls(); a.invalidate(); };
          const f = VS.el('button', { type: 'button', class: 'vs-cl__sw', 'aria-pressed': s.fault === i ? 'true' : 'false', 'aria-label': x.name + ' çıkışında arıza', title: 'Arızayı bu çıkışa koy', text: s.fault === i ? '⚡ arıza' : '⚡' });
          f.onclick = () => { a.state.fault = i; resetFault(a); a.renderControls(); a.invalidate(); };
          row.appendChild(b); row.appendChild(f); list.appendChild(row);
        });
        box.appendChild(list);
        const bt = VS.el('div', { class: 'vs-btns' });
        bt.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: '+ Ana pano çıkışı', onclick: () => { addDevice(a, 0); a.renderControls(); a.invalidate(); } }));
        if (lvSel(s, sel) === 1) bt.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: '+ Son devre (' + d.name.split(' ')[0] + ' altına)', onclick: () => { addDevice(a, sel); a.renderControls(); a.invalidate(); } }));
        if (sel > 0) bt.appendChild(VS.el('button', { type: 'button', class: 'vs-btn vs-btn--danger', text: 'Seçili cihazı sil', onclick: () => { removeDevice(a, sel); a.renderControls(); a.invalidate(); } }));
        box.appendChild(bt);
      } }
    ] });
    const dItems = [
      { type: 'text', key: key('name'), label: 'Ad (pano etiketi)', parse: v => { v = String(v).trim().slice(0, 28); if (!v) throw new Error('Ad boş olamaz.'); return v; }, report: false },
      { type: 'select', key: key('kind'), label: 'Cihaz tipi', options: Object.keys(S.KINDS).map(k => [k, S.KINDS[k]]), report: false, onChange: (v, a) => { retype(a.state.devices[sel], v); a.renderControls(); a.invalidate(); } },
      { type: 'select', key: key('In'), label: d.kind === 'FUSE' ? 'Sigorta anma akımı (gG)' : 'Anma akımı In (çerçeve)', options: IN_OPTS[d.kind].map(v => [v, v + ' A']), report: false }
    ];
    if (d.kind === 'MCB') dItems.push({ type: 'seg', key: key('curve'), label: 'Açma eğrisi (IEC 60898-1)', options: [['B', 'B (3–5·In)'], ['C', 'C (5–10·In)'], ['D', 'D (10–20·In)']], report: false });
    if (d.kind === 'ACB' || d.kind === 'MCCB') dItems.push(
      { type: 'range', key: key('ir'), label: 'L · Ir ayarı', min: 0.4, max: 1, step: 0.05, digits: 2, fmt: v => fmt(v, 2) + ' × In = ' + fmt(v * d.In, 0) + ' A', report: false },
      { type: 'select', key: key('tr'), label: 'L · tr gecikmesi', options: TR, report: false },
      { type: 'select', key: key('isd'), label: 'S · Isd (kısa gecikmeli)', options: ISD, report: false },
      { type: 'select', key: key('tsd'), label: 'S · tsd', options: TSD, report: false, help: 'Üst ve alt cihaz arasında en az bir tsd kademesi (≈ 0,1 s) fark bırakılır.' },
      { type: 'select', key: key('ii'), label: 'I · Ii (ani)', options: II, report: false, help: d.kind === 'ACB' ? 'ACB’de ani açma çoğunlukla kapatılır; kısa gecikmeli koruma seçiciliği sağlar (bara ve kablo kısa süreli dayanımı kontrol edilmeli).' : 'Ani açma alt cihazla seçiciliği sınırlar: zaman–akım sınırı ≈ 0,8·Ii.' }
    );
    dItems.push(
      { type: 'select', key: key('Icu'), label: d.kind === 'MCB' ? 'Kesme kapasitesi Icn' : 'Kesme kapasitesi Icu', options: ICU.map(v => [v, v + ' kA']), report: false },
      { type: 'range', key: key('L'), label: sel === 0 ? 'Trafo → ana pano bağlantı boyu' : 'Çıkış kablosu boyu', min: 0, max: 300, step: 1, unit: 'm', report: false },
      { type: 'select', key: key('S'), label: 'Kablo kesiti (Cu, faz = PE)', options: SECT.map(v => [v, fmt(v, v % 1 ? 1 : 0) + ' mm²']), report: false },
      { type: 'number', key: key('n'), label: 'Paralel kablo sayısı', min: 1, max: 12, step: 1, report: false }
    );
    if (sel > 0) dItems.push({ type: 'select', key: key('parent'), label: 'Besleyen (üst) cihaz', options: s.devices.map((x, k) => [k, x.name]).filter(o => o[0] < sel && levelOf(s, o[0]) < 2), report: false, rebuild: true });
    if (r && r.values.pair) { const p = r.values.pair; dItems.push({ type: 'note', html: 'Üst cihaz <b>' + VS.esc(s.devices[p.up].name) + '</b> ile: ' + (p.status === 'total' ? '<b>tam zaman–akım seçiciliği</b> (Ik3 ' + fA(p.IkMax) + '’ya kadar)' : 'sınır <b>Is ≈ ' + fA(p.Is) + '</b> · ' + (p.region === 'inst' ? 'ani bölge: üretici seçicilik tablosu gerekir' : p.region === 'overload' ? 'aşırı yük bölgesinde çakışma' : 'zaman gecikmeli bölgede çakışma')) }); }
    g.push({ title: 'Seçili cihaz: ' + d.name, items: dItems });
    g.push({ title: 'Arıza', items: [
      { type: 'select', key: 'fault', label: 'Arıza yeri (çıkış barası)', options: s.devices.map((x, k) => [k, x.name + ' çıkışı' + (k === 0 ? ' (ana bara)' : '')]), onChange: (v, a) => resetFault(a) },
      { type: 'seg', key: 'faultType', label: 'Arıza tipi', options: [['3F', 'Üç faz (Ik3 maks)'], ['1F', 'Faz–toprak (Ik1 min)']], onChange: (v, a) => resetFault(a) },
      { type: 'seg', key: 'tcc', label: 'Eğri grafiği', options: [['path', 'Arıza yolu'], ['pair', 'Seçili + üst cihaz']] },
      { type: 'buttons', items: [{ label: 'Arızayı başlat (ağır çekim)', variant: 'primary', onClick: a => { a.running = true; a.paused = false; start(a); a.syncToolbar(); a.wake(); } }] },
      r ? { type: 'note', html: 'Arıza akımı <b>' + fA(r.values.Ifault) + '</b> · ' + (r.values.resp.first === null ? 'yoldaki cihazlar açmayı garanti etmiyor' : 'ilk açan <b>' + VS.esc(s.devices[r.values.resp.first].name) + '</b> ≤ ' + fT(r.values.resp.tClear)) } : null
    ] });
    return g;
  }
  const lvSel = (s, i) => levelOf(s, i);

  /* ---------------------------------------------------------------- arıza zaman davranışı (ağır çekim, log zaman) */
  function start(app) {
    const L = app.live; resetFault(app); L.phase = 'fault';
  }
  function tick(app, dt) {
    const L = app.live, r = app.validResult; if (!r || L.phase !== 'fault') return false;
    L.el += dt;
    // log zaman: 0 → 1 ms, her gerçek saniye ≈ bir onluk (×10) ilerler; 6 s’de 1000 s
    L.t = 0.001 * Math.pow(10, L.el * (app.state.slow || 1));
    const resp = r.values.resp, devs = app.state.devices;
    if (resp.first !== null && L.t >= resp.tClear) {
      L.t = resp.tClear; L.phase = 'cleared'; L.opened = [resp.first];
      L.maybe = resp.alsoTrip.concat(resp.downMay);
      VS.toast(devs[resp.first].name + ' açtı: arıza ' + fT(resp.tClear) + ' içinde temizlendi' + (L.maybe.length ? ' · ' + L.maybe.map(k => devs[k].name).join(', ') + ' de açabilir' : '') + '.', resp.selective ? 'ok' : 'bad');
      app.invalidate();
    } else if (resp.first === null && L.t > 1000) { L.phase = 'stuck'; VS.toast('Arıza 1000 s içinde temizlenmedi: koruma bu akımı görmüyor.', 'bad'); app.invalidate(); }
    return true;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live) {
    const v = res.values, d = s.devices[v.sel], n = v.nodes[v.fault], resp = v.resp;
    const nm = k => s.devices[k].name;
    const out = [
      { label: 'Trafo AG uçlarında Ik3', value: fA(v.Ik3T), sub: 'ip ≈ ' + fA(v.ipT) + ' · ' + s.Sr_kVA + ' kVA, uk %' + fmt(s.uk, 1) },
      { label: 'Arıza noktası · Ik3 maks', value: fA(n.Ik3), sub: nm(v.fault) + ' çıkışı · ip ≈ ' + fA(n.ip) },
      { label: 'Arıza noktası · Ik1 min', value: fA(n.Ik1), sub: 'faz–PE çevrimi, cmin = 0,95' },
      { label: 'Seçili arıza akımı', value: fA(v.Ifault), sub: s.faultType === '1F' ? 'faz–toprak (en küçük)' : 'üç faz (en büyük)' },
      { label: 'İlk açan (en kötü durum)', value: resp.first === null ? 'yok' : nm(resp.first), sub: resp.first === null ? 'açma garanti değil' : '≤ ' + fT(resp.tClear) + (resp.first !== resp.ideal ? ' · en yakın cihaz değil' : ''), level: resp.first === null ? 'bad' : resp.selective ? 'ok' : 'warn' },
      { label: 'Seçici çiftler', value: v.selOk + ' / ' + v.nPairs, sub: 'zaman–akım bantları kesişmeyen üst–alt çift', level: v.selOk === v.nPairs ? 'ok' : 'warn' }
    ];
    if (v.pair) out.push({ label: d.name + ' ↔ ' + nm(v.pair.up), value: v.pair.status === 'total' ? 'Tam (zaman–akım)' : 'Is ≈ ' + fA(v.pair.Is), sub: v.pair.status === 'total' ? 'Ik3 ' + fA(v.pair.IkMax) + '’ya kadar' : v.pair.region === 'inst' ? 'ani bölge · üretici tablosu' : v.pair.region === 'overload' ? 'aşırı yük bölgesi' : 'zaman gecikmeli bölge', level: v.pair.status === 'total' ? 'ok' : v.pair.region === 'inst' ? 'warn' : 'bad' });
    const icuBad = s.devices.filter((x, i) => x.Icu * 1e3 < v.nodes[i].IkLine).length;
    out.push({ label: 'Kesme kapasitesi', value: icuBad ? icuBad + ' cihaz yetersiz' : 'Tümü yeterli', level: icuBad ? 'bad' : 'ok', sub: 'Icu ≥ bağlı olduğu baradaki Ik3' });
    const st = live.phase === 'fault' ? 'Arıza sürüyor · t = ' + fT(live.t) : live.phase === 'cleared' ? 'Temizlendi · t = ' + fT(live.t) + ' (' + nm(live.opened[0]) + ')' : live.phase === 'stuck' ? 'Temizlenmedi' : 'Başlatılmadı';
    out.push({ label: 'Arıza simülasyonu (ağır çekim)', wide: true, value: st, level: live.phase === 'fault' ? 'warn' : live.phase === 'stuck' ? 'bad' : live.phase === 'cleared' ? (live.maybe.length ? 'warn' : 'ok') : undefined, sub: live.maybe && live.maybe.length ? live.maybe.map(nm).join(', ') + ' da açabilir (seçicilik kaybı riski)' : 'Zaman ekseni logaritmik: her saniye ≈ ×10' });
    return out;
  }
  function charts(res, s) {
    const v = res.values, devs = s.devices, sel = v.sel;
    const ids = s.tcc === 'pair' && v.pair ? [sel, v.pair.up] : S.pathOf(devs, s.tcc === 'pair' ? sel : v.fault);
    const lo = Math.min.apply(null, ids.map(k => S.pickup(devs[k]))) * 0.8;
    const hiI = Math.max(v.Ik3T, v.Ifault) * 1.6;
    const xmin = Math.pow(10, Math.floor(Math.log10(lo))), xmax = Math.pow(10, Math.ceil(Math.log10(hiI)));
    const Is = S.grid(xmin, xmax, 220);
    const series = [];
    ids.forEach((k, j) => {
      const c = S.curve(devs[k], Is), col = COLORS[j % COLORS.length];
      series.push({ name: devs[k].name + ' (en geç)', color: col, width: 2, data: c.map(p => [p[0], p[2]]) });
      series.push({ name: devs[k].name + ' (en erken)', color: col, width: 1.2, dash: [4, 3], data: c.map(p => [p[0], p[1]]) });
    });
    const nf = v.nodes[s.tcc === 'pair' ? sel : v.fault];
    const markers = [{ x: v.Ifault, label: 'Arıza ' + fA(v.Ifault), color: '#ef4444' }];
    if (s.tcc === 'pair' && v.pair && v.pair.status !== 'total') markers.push({ x: v.pair.Is, label: 'Is ' + fA(v.pair.Is), color: '#fcd34d' });
    else markers.push({ x: nf.Ik1, label: 'Ik1,min ' + fA(nf.Ik1), color: '#94a3b8' });
    const ch = [{ id: 'tcc', title: 'Zaman–akım eğrileri (log–log) · ' + (s.tcc === 'pair' && v.pair ? 'seçili cihaz ve üst cihaz' : 'arıza yolundaki cihazlar'), height: 290,
      series: series, markers: markers, hLines: [{ y: 0.4, label: '0,4 s', color: '#64748b' }, { y: 5, label: '5 s', color: '#64748b' }],
      x: { log: true, min: xmin, max: xmax, label: 'I (A)' }, y: { log: true, min: 0.001, max: 10000, label: 't (s)' },
      alt: ids.map(k => devs[k].name + ': ' + settingText(devs[k])).join('; ') + '. Kesikli çizgi en erken, düz çizgi en geç açma süresi (temsilî bant). Arıza akımı ' + fA(v.Ifault) + '.' }];
    ch.push({ id: 'ik', title: 'Bara kısa devre akımları ve kesme kapasiteleri (kA)', height: 170,
      series: [
        { name: 'Ik3 (bağlı olduğu bara)', type: 'bar', color: 'amber', width: 0.36, offset: -0.5, data: devs.map((x, i) => [i + 1, v.nodes[i].IkLine / 1e3]) },
        { name: 'Icu / Icn', type: 'bar', color: 'cyan', width: 0.36, offset: 0.5, data: devs.map((x, i) => [i + 1, x.Icu]) }
      ],
      x: { min: 0.4, max: devs.length + 0.6, ticks: devs.map((x, i) => i + 1), fmt: t => (devs[t - 1] ? devs[t - 1].name.split(' ')[0] : ''), label: 'cihaz' }, y: { label: 'kA', min: 0 },
      alt: devs.map((x, i) => x.name + ': Ik3 ' + fmt(v.nodes[i].IkLine / 1e3, 1) + ' kA, Icu ' + x.Icu + ' kA').join('; ') });
    if (v.pairs.length) ch.push({ id: 'sel', title: 'Seçicilik sınırı Is / Ik3 (alt cihaz barası, %)', height: 150,
      series: [{ name: 'Is/Ik3 %', type: 'bar', color: 'green', width: 0.55, data: v.pairs.map((p, j) => [j + 1, Math.min(100, p.Is / p.IkMax * 100)]) }],
      hLines: [{ y: 100, label: 'tam', color: '#10b981' }],
      x: { min: 0.4, max: v.pairs.length + 0.6, ticks: v.pairs.map((p, j) => j + 1), fmt: t => (v.pairs[t - 1] ? devs[v.pairs[t - 1].down].name.split(' ')[0] : ''), label: 'alt cihaz' }, y: { label: '%', min: 0, max: 110 },
      alt: v.pairs.map(p => devs[p.up].name + ' → ' + devs[p.down].name + ': ' + (p.status === 'total' ? 'tam' : 'Is ' + fA(p.Is))).join('; ') });
    return ch;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  const P = { w: 0.8, h: 2.0, d: 0.6, plinth: 0.1 };
  function rebuildOn(s) { return s.devices.map(d => d.kind + ':' + d.parent + ':' + (d.load || '')).join('|'); }
  function layout(s) {
    const feeders = kidsOf(s, 0);
    const subs = feeders.filter(i => kidsOf(s, i).length > 0);
    const nSec = 1 + feeders.length, W = nSec * P.w, x0 = -W / 2;
    return { feeders: feeders, subs: subs, nSec: nSec, W: W, x0: x0 };
  }
  let HIT = null;
  const hitMat = k => HIT || (HIT = new k.T.MeshBasicMaterial({ visible: false }));
  /** Kesici gövdesi: ACB (çekmeceli), MCCB (kompakt), NH sigortalı yük ayırıcı, MCB (DIN modülü). Kol (lever) döner. */
  function breaker(k, parent, kind, x, y, z, sc) {
    const M = k.mats, g = k.group(parent, x, y, z); g.scale.setScalar(sc || 1);
    let lever = null, led;
    if (kind === 'ACB') {
      k.rbox(0.62, 0.42, 0.34, 0.015, M.plasticDark, 0, 0, 0, g);
      k.box(0.5, 0.26, 0.01, M.plasticGrey, 0, 0.02, 0.172, g);
      k.box(0.12, 0.08, 0.01, k.mat(0x0b2a1a, { emissive: 0x0b2a1a }), -0.14, 0.08, 0.18, g);
      k.cyl(0.03, 0.03, 0.02, M.plasticYellow, 0.14, 0.08, 0.18, g, 16).rotation.x = Math.PI / 2;
      lever = k.group(g, 0.14, -0.08, 0.18); k.box(0.03, 0.12, 0.03, M.plasticRed, 0, 0.05, 0.015, lever);
      led = k.box(0.03, 0.018, 0.01, M.ledGreen, -0.14, -0.06, 0.18, g);
    } else if (kind === 'MCCB') {
      k.rbox(0.2, 0.28, 0.12, 0.01, M.plasticDark, 0, 0, 0, g);
      k.box(0.14, 0.1, 0.01, M.plasticGrey, 0, -0.06, 0.062, g);
      k.box(0.07, 0.05, 0.006, k.mat(0x0b2a1a, { emissive: 0x0b2a1a }), 0, -0.06, 0.068, g);
      lever = k.group(g, 0, 0.06, 0.065); k.box(0.04, 0.07, 0.035, M.plasticGrey, 0, 0.025, 0.012, lever);
      led = k.box(0.02, 0.012, 0.008, M.ledGreen, 0.06, 0.1, 0.064, g);
    } else if (kind === 'FUSE') {
      k.rbox(0.2, 0.3, 0.14, 0.008, M.plasticGrey, 0, 0, 0, g);
      for (let j = 0; j < 3; j++) { k.box(0.045, 0.11, 0.035, M.plasticWhite, -0.06 + j * 0.06, 0, 0.08, g); k.box(0.012, 0.03, 0.03, M.copper, -0.06 + j * 0.06, 0.07, 0.07, g); }
      lever = k.group(g, 0, 0.14, 0.075); k.box(0.18, 0.025, 0.05, M.plasticDark, 0, 0, 0.02, lever);
      led = k.box(0.02, 0.012, 0.008, M.ledGreen, 0.07, -0.13, 0.072, g);
    } else {
      k.rbox(0.054, 0.09, 0.07, 0.004, M.plasticWhite, 0, 0, 0, g);
      k.box(0.05, 0.02, 0.004, M.plasticGrey, 0, -0.025, 0.036, g);
      lever = k.group(g, 0, 0.005, 0.036); k.box(0.016, 0.03, 0.016, M.plasticBlue, 0, 0.012, 0.008, lever);
      led = k.box(0.012, 0.006, 0.004, M.ledGreen, 0, 0.034, 0.036, g);
    }
    return { g: g, lever: lever, led: led, kind: kind };
  }
  /** Yük sembolü: motor, aydınlatma, priz, makine. */
  function loadObj(k, parent, kind, x, y, z) {
    const M = k.mats, g = k.group(parent, x, y, z);
    if (kind === 'motor') {
      k.cyl(0.13, 0.13, 0.32, M.plasticBlue, 0, 0.16, 0, g, 22).rotation.z = Math.PI / 2;
      for (let j = 0; j < 8; j++) { const fin = k.box(0.3, 0.012, 0.02, M.plasticBlue, 0, 0.16 + 0.13 * Math.sin(j / 8 * Math.PI * 2), 0.13 * Math.cos(j / 8 * Math.PI * 2), g); fin.rotation.x = -j / 8 * Math.PI * 2; }
      k.box(0.32, 0.03, 0.2, M.darkSteel, 0, 0.015, 0, g); k.box(0.08, 0.06, 0.08, M.plasticDark, 0, 0.3, 0, g);
    } else if (kind === 'aydinlatma') {
      k.box(0.6, 0.04, 0.12, M.plasticWhite, 0, 0.5, 0, g); k.box(0.56, 0.01, 0.1, k.mat(0xfff7d6, { emissive: 0xfff3c4, emissiveIntensity: 0.6 }), 0, 0.477, 0, g);
      k.box(0.006, 0.5, 0.006, M.cableBlack, 0, 0.25, 0, g);
    } else if (kind === 'priz') {
      k.box(0.05, 0.25, 0.05, M.plasticGrey, 0, 0.125, -0.02, g); k.rbox(0.12, 0.12, 0.05, 0.01, M.plasticWhite, 0, 0.3, 0, g); k.cyl(0.035, 0.035, 0.01, M.plasticGrey, 0, 0.3, 0.03, g, 16).rotation.x = Math.PI / 2;
    } else {
      k.rbox(0.36, 0.42, 0.3, 0.02, k.mat(0x4b5563, { metalness: 0.4, roughness: 0.5 }), 0, 0.21, 0, g); k.box(0.12, 0.08, 0.01, M.plasticDark, 0.08, 0.3, 0.155, g);
    }
    return g;
  }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer, lay = layout(s);
    HIT = null;
    const sc = { devs: [], buses: [], cables: [], labels: [] };
    app.scene3 = sc;
    k.ground(60, k.mat(0x4a525b, { roughness: 0.5, metalness: 0.1 }), 0);
    const grid = new T.GridHelper(60, 120, 0x3d4650, 0x3d4650); grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.2; grid.userData.noClip = true; v.root.add(grid);
    const nSub = lay.subs.length, wallW = lay.W + 3.2 + Math.max(1, nSub) * 1.6 + 4;
    const wall = k.box(wallW + 6, 3.4, 0.1, k.mat(0x8b96a3, { roughness: 0.9 }), wallW / 2 - lay.W / 2 - 3, 1.7, -0.72); wall.userData.noClip = true;
    sc.fx = { hot: k.mat(0xef4444, { emissive: 0xef4444, emissiveIntensity: 1.6 }), cable: M.cableBlack };

    // ---- trafo
    const tw = 1.4, th = 1.05, td = 0.7, xT = lay.x0 - 1.4 - tw / 2;
    const tr = k.group(null, xT, 0, 0);
    const trs = k.staticGroup(tr);
    k.box(tw * 0.9, 0.1, 0.1, M.darkSteel, 0, 0.05, td * 0.32, trs); k.box(tw * 0.9, 0.1, 0.1, M.darkSteel, 0, 0.05, -td * 0.32, trs);
    k.rbox(tw, th, td, 0.03, M.trafoPaint, 0, 0.1 + th / 2, 0, tr);
    for (let j = 0; j < 18; j++) { k.box(0.012, th * 0.78, 0.22, M.trafoPaint, -tw / 2 + 0.1 + j * 0.07, 0.16 + th * 0.45, td / 2 + 0.11, trs); k.box(0.012, th * 0.78, 0.22, M.trafoPaint, -tw / 2 + 0.1 + j * 0.07, 0.16 + th * 0.45, -td / 2 - 0.11, trs); }
    for (let j = 0; j < 4; j++) { k.cyl(0.032, 0.036, 0.12, M.porcelainGrey, -tw * 0.3 + j * tw * 0.2, 0.2 + th, td * 0.25, tr, 12); k.box(0.05, 0.08, 0.012, M.copper, -tw * 0.3 + j * tw * 0.2, 0.3 + th, td * 0.25, tr); }
    for (let j = 0; j < 3; j++) k.cyl(0.03, 0.035, 0.24, M.porcelainGrey, -tw * 0.25 + j * tw * 0.25, 0.26 + th, -td * 0.25, tr, 12);
    k.pickable(tr, () => 'Dağıtım trafosu ' + s.Sr_kVA + ' kVA', () => { const r = app.validResult; return r ? ['Sr = ' + s.Sr_kVA + ' kVA · uk = %' + fmt(s.uk, 1) + ' · Pk = ' + fmt(s.Pk_W / 1e3, 1, 'kW'), 'ZT = ' + fmt(r.values.src.ZT * 1e3, 2) + ' mΩ (RT ' + fmt(r.values.src.RT * 1e3, 2) + ' · XT ' + fmt(r.values.src.XT * 1e3, 2) + ')', 'OG şebeke S"kQ = ' + (s.SkQ_MVA > 0 ? fmt(s.SkQ_MVA, 0, 'MVA') + ' → ZQ ' + fmt(r.values.src.ZQ * 1e3, 3) + ' mΩ' : 'sonsuz'), 'AG uçlarında Ik3 ≈ ' + fA(r.values.Ik3T)] : []; },
      () => [{ label: 'uk %4', onClick: a => { a.state.uk = 4; } }, { label: 'uk %6', onClick: a => { a.state.uk = 6; } }, { label: 'Trafo bir kademe büyük', onClick: a => { const o = [250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500]; a.state.Sr_kVA = o[Math.min(o.length - 1, o.indexOf(a.state.Sr_kVA) + 1)] || 1000; } }]);
    sc.trLbl = k.label('Trafo', tr, [0, th + 0.6, 0]);

    // ---- ana dağıtım panosu
    const body = k.group(null, 0, 0, 0);
    const deco = k.staticGroup(body);
    k.box(lay.W, P.plinth, P.d - 0.02, M.plasticDark, 0, P.plinth / 2, 0, deco);
    k.box(lay.W, P.h, 0.02, M.panelRAL7035, 0, P.plinth + P.h / 2, -P.d / 2 + 0.01, deco);
    k.shell(k.box(lay.W + 0.02, 0.03, P.d + 0.02, M.panelRAL7035, 0, P.plinth + P.h + 0.015, 0, body));
    k.shell(k.box(0.02, P.h, P.d, M.panelRAL7035, lay.x0 + 0.01, P.plinth + P.h / 2, 0, body));
    k.shell(k.box(0.02, P.h, P.d, M.panelRAL7035, -lay.x0 - 0.01, P.plinth + P.h / 2, 0, body));
    for (let i = 1; i < lay.nSec; i++) k.box(0.02, P.h, 0.03, M.darkSteel, lay.x0 + i * P.w, P.plinth + P.h / 2, P.d / 2 - 0.02, deco);
    // ana bara (seçilebilir: arıza yeri 0)
    const busY = 1.9, mb = k.group(body, 0, busY, -0.18);
    for (let j = 0; j < 4; j++) k.box(lay.W - 0.08, 0.04, 0.01, j === 3 ? M.N : M.copper, 0, -j * 0.06, 0, mb);
    k.box(lay.W - 0.04, 0.24, 0.06, hitMat(k), 0, -0.09, 0, mb).castShadow = false;
    k.pickable(mb, () => 'Ana bara · ' + s.devices[0].name + ' çıkışı', () => busInfo(app, 0), () => busActions(0));
    sc.buses[0] = { obj: mb, pos: new T.Vector3(0, busY - 0.09, -0.12) };
    const nm = k.screen(Math.min(1.4, lay.W * 0.6), 0.09, 512, (gx, w, h) => { gx.fillStyle = '#0a1628'; gx.fillRect(0, 0, w, h); gx.fillStyle = '#fcd34d'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.font = 'bold ' + Math.floor(h * 0.62) + 'px Arial'; gx.fillText('ANA DAĞITIM PANOSU · ' + s.U_LL + ' V', w / 2, h / 2 + 1); });
    nm.position.set(0, P.plinth + P.h + 0.075, P.d / 2 - 0.02);

    // kök cihaz (ACB) ilk bölümde
    const placeDev = (i, parentObj, x, y, z, scale, lift) => {
      const d = s.devices[i], b = breaker(k, parentObj, d.kind, x, y, z, scale);
      k.pickable(b.g, () => s.devices[i].name, () => devInfo(app, i), a => devActions(a, i));
      const lb = k.label(d.name, b.g, [0, (d.kind === 'MCB' ? 0.1 : 0.3) + (lift || 0), 0.05], 'vs-label--sm');
      sc.devs[i] = Object.assign(b, { lbl: lb, open: 0 });
      return b;
    };
    const x0c = lay.x0 + P.w / 2;
    placeDev(0, body, x0c, 1.1, 0.1, 1);
    k.tube([[xT + tw * 0.1, 0.3 + th, td * 0.25], [xT + tw * 0.1, 2.6, td * 0.25 - 0.2], [x0c, 2.6, -0.1], [x0c, 2.15, -0.1]], 0.04, M.cableBlack, null);
    // çıkış bölümleri
    lay.feeders.forEach((i, j) => {
      const cx = lay.x0 + P.w * (j + 1.5);
      placeDev(i, body, cx, 1.25, 0.06, 1, (j % 2) * 0.16);
      k.box(0.012, busY - 1.45, 0.006, M.copper, cx - 0.05, (busY + 1.45) / 2, -0.17, body);
    });
    // kablo tavası
    const trayY = 2.7, trayZ = -0.45, subX0 = -lay.x0 + 1.6;
    const trayX1 = subX0 + Math.max(1, nSub) * 1.6;
    k.box(trayX1 - lay.x0 + 0.4, 0.008, 0.3, M.galv, (trayX1 + lay.x0) / 2, trayY, trayZ);
    k.box(trayX1 - lay.x0 + 0.4, 0.06, 0.008, M.galv, (trayX1 + lay.x0) / 2, trayY + 0.03, trayZ + 0.15);
    // tali panolar ve son devreler
    const route = (i, from, to, r) => {
      const t = k.tube([from, [from[0], trayY + 0.05, trayZ + 0.06 - (i % 4) * 0.03], [to[0], trayY + 0.05, trayZ + 0.06 - (i % 4) * 0.03], to], r || 0.02, M.cableBlack, null);
      sc.cables[i] = t; return t;
    };
    let subIdx = 0, directIdx = 0;
    lay.feeders.forEach((i, j) => {
      const cx = lay.x0 + P.w * (j + 1.5), kids = kidsOf(s, i);
      if (kids.length) {
        const bx = subX0 + subIdx * 1.6, bw = Math.max(0.6, Math.min(1.4, 0.16 + kids.length * 0.1)); subIdx++;
        const sb = k.group(null, bx, 1.35, -0.55);
        k.shell(k.rbox(bw, 0.8, 0.18, 0.02, M.panelRAL7035, 0, 0, 0, sb));
        k.box(bw - 0.08, 0.7, 0.01, M.galv, 0, 0, 0.09, sb);
        k.box(bw - 0.12, 0.035, 0.012, M.alu, 0, -0.05, 0.1, sb);
        const sbus = k.group(sb, 0, 0.27, 0.1);
        for (let q = 0; q < 3; q++) k.box(bw - 0.14, 0.014, 0.006, M.copper, 0, -q * 0.022, 0, sbus);
        k.box(bw - 0.1, 0.09, 0.03, hitMat(k), 0, -0.022, 0, sbus).castShadow = false;
        k.pickable(sbus, () => 'Tali pano barası · ' + s.devices[i].name + ' çıkışı', () => busInfo(app, i), () => busActions(i));
        sc.buses[i] = { obj: sbus, pos: new T.Vector3(bx, 1.6, -0.43) };
        sc.labels.push(k.label('Tali pano · ' + s.devices[i].name.split(' ')[0], sb, [0, 0.52, 0.1], 'vs-label--sm'));
        route(i, [cx, 2.12, -0.1], [bx, 1.76, -0.55], 0.024);
        kids.forEach((c, q) => {
          const px = -bw / 2 + 0.1 + (q + 0.5) * ((bw - 0.2) / kids.length);
          const d = s.devices[c];
          placeDev(c, sb, px, -0.05, 0.13, d.kind === 'MCB' ? 1 : 0.5, (q % 2) * (d.kind === 'MCB' ? 0.07 : 0.3));
          // son devre yükü
          const lx = bx + px, lz = 0.25 + (q % 2) * 0.35, ld = loadObj(k, null, d.load || 'priz', lx, 0, lz);
          const term = k.group(null, lx, 0.55, lz - 0.05);
          k.box(0.12, 0.08, 0.06, M.plasticGrey, 0, 0, 0, term);
          k.box(0.2, 0.2, 0.2, hitMat(k), 0, 0, 0, term).castShadow = false;
          k.pickable(term, () => 'Son devre ucu · ' + s.devices[c].name, () => busInfo(app, c), () => busActions(c));
          sc.buses[c] = { obj: term, pos: new T.Vector3(lx, 0.6, lz - 0.05) };
          void ld;
          sc.cables[c] = k.tube([[bx + px, 1.0, -0.47], [bx + px, 0.9, -0.3], [lx, 0.62, lz - 0.08]], 0.012, M.cableBlack, null);
        });
      } else {
        // doğrudan beslenen yük (ör. motor) panonun önünde
        const lx = cx, lz = 1.3 + (directIdx++ % 2) * 0.5, d = s.devices[i];
        loadObj(k, null, d.load || 'motor', lx, 0, lz);
        const term = k.group(null, lx, 0.5, lz - 0.2);
        k.box(0.12, 0.08, 0.06, M.plasticGrey, 0, 0, 0, term);
        k.box(0.24, 0.24, 0.24, hitMat(k), 0, 0, 0, term).castShadow = false;
        k.pickable(term, () => 'Yük ucu · ' + s.devices[i].name, () => busInfo(app, i), () => busActions(i));
        sc.buses[i] = { obj: term, pos: new T.Vector3(lx, 0.55, lz - 0.2) };
        sc.cables[i] = k.tube([[cx, P.plinth + 0.2, 0.2], [cx, 0.08, 0.5], [lx, 0.08, lz - 0.45], [lx, 0.45, lz - 0.2]], 0.022, M.cableBlack, null);
      }
    });
    // arıza kıvılcımı
    const spark = k.group(null, 0, 0, 0);
    const sm = new T.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.95, depthWrite: false });
    const core = new T.Mesh(new T.SphereGeometry(0.07, 12, 9), sm); spark.add(core);
    const glow = new T.Mesh(new T.SphereGeometry(0.22, 14, 10), new T.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.35, depthWrite: false })); spark.add(glow);
    spark.visible = false; sc.spark = spark; sc.faultLbl = k.label('Arıza', spark, [0, 0.3, 0]);
    const pl = new T.PointLight(0xffa64d, 0, 3, 2); spark.add(pl); sc.sparkLight = pl;
    const span = (trayX1 + 0.6) - (xT - tw / 2);
    app.def.scene.bounds = [xT - tw / 2 - 0.2, trayX1 + 0.6];
    v.setView({ target: [(trayX1 + xT - tw / 2) / 2, 1.1, 0.2], r: span * 0.72 + 2.2, theta: 0.28, phi: 1.2, limits: { rMin: 0.8, rMax: Math.max(24, span * 2.5) } });
    v.setShadowBox(Math.max(6, span * 0.7), 40);
    v.sun.position.set(3, 9, 7);
  }

  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values, M = k.mats, path = v.resp.path;
    s.devices.forEach((d, i) => {
      const o = sc.devs[i]; if (!o) return;
      const opened = live.opened && live.opened.indexOf(i) >= 0, maybe = live.maybe && live.maybe.indexOf(i) >= 0;
      o.led.material = opened ? M.ledRed : maybe ? M.ledAmber : M.ledGreen;
      o.target = opened ? 1 : 0;
      const p = v.pairs.find(x => x.down === i), icu = d.Icu * 1e3 >= v.nodes[i].IkLine;
      o.lbl.set(d.name + (opened ? ' · AÇTI' : maybe ? ' · açabilir' : ''));
      o.lbl.level(opened ? 'bad' : maybe ? 'warn' : !icu ? 'bad' : p && p.status !== 'total' ? 'warn' : i === s.sel ? 'ok' : '');
      const c = sc.cables[i];
      if (c) c.material = live.phase === 'fault' && path.indexOf(i) >= 0 ? sc.fx.hot : sc.fx.cable;
    });
    const b = sc.buses[v.fault];
    if (b) { sc.spark.position.copy(b.pos); sc.faultLbl.set((s.faultType === '1F' ? 'Faz–toprak ' : 'Arıza ') + fA(v.Ifault)); sc.faultLbl.level(live.phase === 'fault' ? 'bad' : 'warn'); }
    sc.spark.visible = live.phase === 'fault' || live.phase === 'idle';
    sc.trLbl.set('Trafo ' + s.Sr_kVA + ' kVA · Ik3 ' + fA(v.Ik3T));
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return false;
    let moving = false;
    sc.devs.forEach(o => {
      if (!o || !o.lever) return;
      const tgt = (o.target || 0), e = tgt - o.open;
      if (Math.abs(e) > 1e-3) { o.open += k.reducedMotion || dt <= 0 ? e : e * Math.min(1, dt * 8); if (Math.abs(tgt - o.open) <= 1e-3) o.open = tgt; o.lever.rotation.x = o.open * 1.1; moving = true; }
    });
    if (live.phase === 'fault' && !k.reducedMotion && dt > 0) {
      sc.ph = (sc.ph || 0) + dt * 18;
      const f = 0.75 + 0.25 * Math.sin(sc.ph) * Math.sin(sc.ph * 2.3);
      sc.spark.scale.setScalar(f); sc.sparkLight.intensity = 1.5 + 2 * f; moving = true;
    } else if (sc.sparkLight.intensity !== 0 && live.phase !== 'fault') { sc.sparkLight.intensity = 0; sc.spark.scale.setScalar(0.7); moving = true; }
    return moving;
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması */
  const ROW = 210;
  function blocks(W, s) {
    const R = W - 70, feeders = kidsOf(s, 0), colW = 64;
    const rows = []; let cur = [], used = 0;
    feeders.forEach(i => {
      const w = Math.max(1, kidsOf(s, i).length) * colW + 16;
      if (cur.length && used + w > R - 40) { rows.push(cur); cur = []; used = 0; }
      cur.push({ i: i, w: w, x: 40 + used }); used += w;
    });
    if (cur.length) rows.push(cur);
    return { rows: rows, colW: colW, R: R };
  }
  function view2dHeight(W, res, s) { return 158 + Math.max(1, blocks(W, s).rows.length) * ROW + 70; }
  function view2d(g, W, H, res, s, live) {
    const v = res.values, col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', cu: '#c77b4a', hot: '#f87171' };
    const L = blocks(W, s), path = v.resp.path, fitT = VS.fitText;
    g.lineWidth = 2; g.font = '12px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const tx = 52, top = 58;
    g.strokeStyle = col.line; g.beginPath(); g.arc(tx, top + 6, 11, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(tx, top + 23, 11, 0, Math.PI * 2); g.stroke();
    g.fillStyle = col.dim; g.fillText(fitT(g, 'Trafo ' + s.Sr_kVA + ' kVA · uk %' + fmt(s.uk, 1) + ' · Ik3 ' + fA(v.Ik3T), L.R - tx - 24), tx + 20, top + 18);
    const devColor = i => (live.opened && live.opened.indexOf(i) >= 0 ? col.bad : live.maybe && live.maybe.indexOf(i) >= 0 ? col.warn : (() => { const p = v.pairs.find(x => x.down === i); return p && p.status !== 'total' ? (p.region === 'inst' ? col.warn : col.bad) : col.ok; })());
    const symbol = (i, x, y) => {
      const d = s.devices[i], c = devColor(i), open = live.opened && live.opened.indexOf(i) >= 0;
      g.strokeStyle = c; g.fillStyle = c;
      if (d.kind === 'FUSE') { g.strokeRect(x - 5, y, 10, 20); g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 20); g.stroke(); }
      else { g.beginPath(); g.moveTo(x, y); g.lineTo(x + (open ? 10 : 0), y + 20); g.stroke(); g.beginPath(); g.moveTo(x - 4, y - 4); g.lineTo(x + 4, y + 4); g.moveTo(x + 4, y - 4); g.lineTo(x - 4, y + 4); g.stroke(); }
      g.font = 'bold 11px Inter, sans-serif'; g.textAlign = 'left'; g.fillText(fitT(g, d.name, 92), x + 8, y + 12);
      g.font = '11px Inter, sans-serif'; g.fillStyle = col.dim;
      g.fillText(fitT(g, d.kind === 'MCB' ? d.curve + d.In : d.kind === 'FUSE' ? 'gG ' + d.In : SHORT[d.kind] + ' ' + d.In, 92), x + 8, y + 25);
    };
    const pathLine = i => (live.phase === 'fault' && path.indexOf(i) >= 0 ? col.hot : col.line);
    // kök
    g.strokeStyle = pathLine(0); g.beginPath(); g.moveTo(tx, top + 34); g.lineTo(tx, top + 46); g.stroke();
    symbol(0, tx, top + 46);
    const mbY = top + 96;
    g.strokeStyle = pathLine(0); g.beginPath(); g.moveTo(tx, top + 66); g.lineTo(tx, mbY); g.stroke();
    g.lineWidth = 5; g.strokeStyle = col.cu; g.beginPath(); g.moveTo(tx - 20, mbY); g.lineTo(L.R, mbY); g.stroke(); g.lineWidth = 2;
    g.fillStyle = col.dim; g.font = '11px Inter, sans-serif'; g.fillText(fitT(g, 'Ana bara · Ik3 ' + fA(v.nodes[0].Ik3) + ' · Ik1 ' + fA(v.nodes[0].Ik1), L.R - tx - 120), tx + 120, mbY - 8);
    const marks = [];
    if (v.fault === 0) marks.push([L.R - 20, mbY]);
    L.rows.forEach((row, ri) => {
      const y0 = mbY + ri * ROW;
      if (ri > 0) { g.lineWidth = 3; g.strokeStyle = col.cu; g.beginPath(); g.moveTo(tx - 20, mbY); g.lineTo(tx - 20, y0); g.lineTo(L.R, y0); g.stroke(); g.lineWidth = 2; }
      row.forEach(b => {
        const i = b.i, fx = b.x + 20, kids = kidsOf(s, i);
        g.strokeStyle = pathLine(i); g.beginPath(); g.moveTo(fx, y0); g.lineTo(fx, y0 + 16); g.stroke();
        symbol(i, fx, y0 + 16);
        g.strokeStyle = pathLine(i); g.beginPath(); g.moveTo(fx, y0 + 36); g.lineTo(fx, y0 + 84); g.stroke();
        g.fillStyle = col.dim; g.font = '11px Inter, sans-serif'; g.fillText(fitT(g, fmt(s.devices[i].L, 0) + ' m · ' + fmt(s.devices[i].S, s.devices[i].S % 1 ? 1 : 0) + ' mm²', b.w - 30), fx + 6, y0 + 62);
        if (kids.length) {
          const sy = y0 + 84;
          g.lineWidth = 4; g.strokeStyle = col.cu; g.beginPath(); g.moveTo(fx - 6, sy); g.lineTo(b.x + b.w - 10, sy); g.stroke(); g.lineWidth = 2;
          g.fillStyle = col.dim; g.fillText(fitT(g, 'Ik3 ' + fA(v.nodes[i].Ik3), b.w - 20), fx + 4, sy - 6);
          if (v.fault === i) marks.push([b.x + b.w - 16, sy]);
          kids.forEach((c, q) => {
            const cx = fx + q * L.colW;
            g.strokeStyle = pathLine(c); g.beginPath(); g.moveTo(cx, sy); g.lineTo(cx, sy + 14); g.stroke();
            symbol(c, cx, sy + 14);
            g.strokeStyle = pathLine(c); g.beginPath(); g.moveTo(cx, sy + 34); g.lineTo(cx, sy + 70); g.stroke();
            g.fillStyle = col.dim; g.font = '11px Inter, sans-serif'; g.fillText(fitT(g, fA(v.nodes[c].Ik3), L.colW - 10), cx + 4, sy + 62);
            g.strokeStyle = col.line; g.strokeRect(cx - 6, sy + 70, 12, 12);
            if (v.fault === c) marks.push([cx, sy + 76]);
          });
        } else {
          g.strokeStyle = col.line; g.beginPath(); g.arc(fx, y0 + 96, 12, 0, Math.PI * 2); g.stroke(); g.fillStyle = col.text; g.textAlign = 'center'; g.fillText('M', fx, y0 + 100); g.textAlign = 'left';
          if (v.fault === i) marks.push([fx, y0 + 84]);
        }
      });
    });
    marks.forEach(m => { g.fillStyle = live.phase === 'fault' ? col.bad : col.warn; g.beginPath(); g.moveTo(m[0], m[1] - 10); g.lineTo(m[0] + 6, m[1]); g.lineTo(m[0] + 1, m[1]); g.lineTo(m[0] + 4, m[1] + 10); g.lineTo(m[0] - 6, m[1] - 1); g.lineTo(m[0] - 1, m[1] - 1); g.closePath(); g.fill(); });
    g.fillStyle = col.dim; g.font = '11px Inter, sans-serif';
    const yb = H - 40;
    g.fillStyle = v.resp.selective ? col.ok : col.warn;
    g.fillText(fitT(g, 'Arıza ' + s.devices[v.fault].name + ' çıkışı · ' + fA(v.Ifault) + ' · ilk açan: ' + (v.resp.first === null ? 'yok' : s.devices[v.resp.first].name + ' ≤ ' + fT(v.resp.tClear)) + (live.phase === 'fault' ? ' · t = ' + fT(live.t) : ''), L.R - 24), 24, yb);
    g.fillStyle = col.dim; g.fillText(fitT(g, 'Tek hat şeması · değerler VoltSim hesap motorundandır. Yeşil: seçici, sarı: ani bölgede üretici tablosu gerekir, kırmızı: çakışma/açtı.', L.R - 24), 24, H - 16);
  }

  /* ---------------------------------------------------------------- görevler */
  const D = defaults().devices;
  const withDevs = (fn) => { const d = JSON.parse(JSON.stringify(D)); fn(d); return d; };
  const pairOf = (r, down) => r.values.pairs.find(p => p.down === down);
  const tasks = [
    { id: 'tam', title: 'Q1 → F11 tam seçicilik', goal: 'Q1 MCCB’nin kısa gecikmeli/ani ayarları F11 (C16) ile seçiciliği ≈ 1,7 kA’da sınırlıyor. Zaman–akım bantları F11 barasındaki Ik3’e kadar kesişmesin; Q0 ile Q1 arasındaki seçicilik de korunsun.', hint: 'Q1’i seçin: tsd’yi 0,2 s’ye çıkarın ve ani (I) korumayı kapatın (3D’de Q1’e tıklayın). Q0’ın tsd’si 0,3 s olduğundan bir kademe fark kalır.',
      check: r => { const a = pairOf(r, 4), b = pairOf(r, 1); return a && b && a.status === 'total' && b.status === 'total'; } },
    { id: 'icu', title: 'Kesme kapasitesi', goal: 'Tali pano trafoya çok yakın kuruldu (Q1 kablosu 3 m). Bazı MCB’lerin 6 kA kesme kapasitesi yetmiyor. Tüm cihazların kesme kapasitesi bağlı oldukları baradaki Ik3’ü karşılasın.', hint: 'Analizde “kesme kapasitesi” kontrollerine bakın; F11/F12’yi seçip kesme kapasitesini baradaki Ik3’ün üzerine (ör. 25 kA) çıkarın. Üst cihazla kaskad (back-up) koruma ancak üretici tablosuyla kabul edilebilir.',
      state: { devices: withDevs(d => { d[1].L = 3; d[4].Icu = 6; d[5].Icu = 6; }) },
      check: r => !r.checks.some(c => /^icu/.test(c.id) && c.status === 'fail') },
    { id: 'hatsonu', title: 'Uzun aydınlatma hattı', goal: 'F12 aydınlatma devresi C16 ile 80 m, 1,5 mm² kabloya çıkıyor: hat sonu faz–toprak arızasında 0,4 s içinde açma sağlanmıyor. Otomatik kesme koşulunu sağlayın.', hint: 'Ik1,min ≥ 10·In (C eğrisi) gerekir. B eğrisi (5·In) seçin ya da kesiti büyütün; 3D’de F12’ye tıklayıp “Eğri” düğmesini kullanabilirsiniz.',
      state: { devices: withDevs(d => { d[5].curve = 'C'; d[5].In = 16; d[5].name = 'F12 C16'; d[5].L = 80; d[5].S = 1.5; }), fault: 5, faultType: '1F' },
      check: r => { const c = r.checks.find(x => x.id === 'sens5'); return c && c.status === 'ok'; } },
    { id: 'ir', title: 'Yanlış Ir ayarı', goal: 'Q2 NH sigorta yerine MCCB kondu ama Ir %40’ta (64 A) bırakıldı: F22 (gG 63) ile aşırı yük bölgesinde seçicilik yok. Ayarı düzeltin; Q2 kendi 160 A yükünü de taşıyabilsin (Ir ≥ 160 A).', hint: 'Q2’yi seçin, L · Ir ayarını yükseltin. Alt sigortanın 1,6·In ≈ 100 A’de erimesi beklenir; üst cihaz bu bölgede açmamalı.',
      state: { devices: withDevs(d => { Object.assign(d[2], { name: 'Q2 MCCB', kind: 'MCCB', In: 160, ir: 0.4, tr: 8, isd: 6, tsd: 0.1, ii: 10, Icu: 36 }); }) },
      check: (r, s) => { const p = pairOf(r, 8); return p && p.region !== 'overload' && s.devices[2].ir * s.devices[2].In >= 160; } },
    { id: 'ariza', title: 'Arızayı tali panoya taşıyın', goal: 'Arızayı Q2’nin beslediği tali pano barasına koyun ve hangi cihazın açtığını “Arızayı başlat” ile izleyin. İlk açan arızaya en yakın cihaz (Q2) olmalı.', hint: '3D’de sağdaki ikinci tali panonun bakır barasına tıklayıp “Üç faz arızayı buraya koy” deyin; sonra Simülasyonu başlat.',
      check: (r, s, live) => s.fault === 2 && r.values.resp.first === 2 && live.phase === 'cleared' }
  ];

  /* ---------------------------------------------------------------- senaryolar */
  const sc = o => Object.assign(defaults(), o);
  VS.register({
    id: 'selektivite', title: '3D Kısa Devre ve Selektivite Simülasyonu',
    defaults: defaults,
    initLive: () => ({ phase: 'idle', t: 0, el: 0, opened: [], maybe: [] }),
    autoRun: false,
    startText: 'Arıza başladı: zaman ekseni ağır çekimde (her saniye ≈ ×10) ilerliyor.',
    start: start,
    scenarios: [
      { id: 'fabrika', name: 'Fabrika · ACB → MCCB/NH → son devreler', desc: '1000 kVA trafo, ACB (LSI, tsd 0,3 s), MCCB ve NH sigortalı çıkışlar, tali panolarda MCB ve gG. Q1 → F11 ani bölgede sınırlı seçicilik.', state: defaults() },
      { id: 'buyuk', name: 'Büyük tesis · 2000 kVA, uk %6, kısa bağlantı', desc: 'Ana barada ≈ 45 kA: kesme kapasitesi ve ACB ani açma kapatılması (kısa süreli dayanım) önem kazanır.', state: sc({ Sr_kVA: 2000, Pk_W: 21000, devices: withDevs(d => { Object.assign(d[0], { In: 3200, Icu: 85, L: 8, n: 8 }); d[1].L = 12; d[2].L = 15; }) }) },
      { id: 'sigorta', name: 'Sigorta zinciri · NH gG 250 → 100 / 32 / 25', desc: 'Klasik sigortalı dağıtım: gG 1,6:1 kuralı ve kapı değerleriyle zaman–akım seçiciliği.', state: sc({ Sr_kVA: 630, Pk_W: 6500, uk: 4, devices: [
        dev({ name: 'Q0 ACB', kind: 'ACB', parent: -1, In: 1000, ir: 1, tr: 12, isd: 4, tsd: 0.3, ii: 0, Icu: 50, L: 10, S: 240, n: 3, load: 'bara' }),
        dev({ name: 'Q1 NH gG 250', kind: 'FUSE', parent: 0, In: 250, Icu: 120, L: 50, S: 120, load: 'pano' }),
        dev({ name: 'F11 gG 100', kind: 'FUSE', parent: 1, In: 100, Icu: 120, L: 30, S: 35, load: 'makine' }),
        dev({ name: 'F12 gG 32', kind: 'FUSE', parent: 1, In: 32, Icu: 120, L: 25, S: 6, load: 'motor' }),
        dev({ name: 'F13 gG 25', kind: 'FUSE', parent: 1, In: 25, Icu: 120, L: 20, S: 4, load: 'priz' })], sel: 2, fault: 2 }) },
      { id: 'zayif', name: 'Zayıf şebeke · uzak tali pano', desc: '400 kVA trafo, 180 m uzaklıkta tali pano: Ik1,min küçülür, son devrelerde otomatik kesme ve MCCB ani ayarı kritik hale gelir.', state: sc({ Sr_kVA: 400, Pk_W: 4600, uk: 4, SkQ_MVA: 250, devices: withDevs(d => { Object.assign(d[0], { In: 630, Icu: 36 }); d[1].L = 180; d[1].S = 70; d[1].In = 250; d[2].L = 120; }), fault: 5, faultType: '1F' }) },
      { id: 'zaman', name: 'Zaman kademelendirme · üç LSI kesici', desc: 'ACB 0,4 s → MCCB 0,2 s → MCCB 0,1 s: ani açma kapalıyken tam zaman–akım seçiciliği; bara kısa süreli dayanımı (Icw) kontrol edilmeli.', state: sc({ devices: [
        dev({ name: 'Q0 ACB', kind: 'ACB', parent: -1, In: 1600, ir: 1, tr: 16, isd: 4, tsd: 0.4, ii: 0, Icu: 65, L: 12, S: 240, n: 4, load: 'bara' }),
        dev({ name: 'Q1 MCCB 630', kind: 'MCCB', parent: 0, In: 630, ir: 0.9, tr: 10, isd: 5, tsd: 0.2, ii: 0, Icu: 50, L: 50, S: 185, n: 2, load: 'pano' }),
        dev({ name: 'F11 MCCB 160', kind: 'MCCB', parent: 1, In: 160, ir: 0.9, tr: 5, isd: 6, tsd: 0.1, ii: 0, Icu: 36, L: 40, S: 50, load: 'makine' }),
        dev({ name: 'F12 MCCB 100', kind: 'MCCB', parent: 1, In: 100, ir: 0.8, tr: 5, isd: 6, tsd: 0.05, ii: 10, Icu: 36, L: 30, S: 25, load: 'motor' })], sel: 2, fault: 2 }) }
    ],
    tasks: tasks,
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => (live.phase === 'fault' ? { level: 'bad', text: 'Arıza · t = ' + fT(live.t) } : live.phase === 'cleared' ? { level: live.maybe.length ? 'warn' : 'ok', text: s.devices[live.opened[0]].name + ' açtı · ' + fT(live.t) } : null),
    reportInputs: s => s.devices.map((d, i) => ({ group: 'Koruma cihazları', label: d.name + (d.parent >= 0 ? ' (← ' + s.devices[d.parent].name + ')' : ' (kök)'), value: settingText(d) + ' · Icu ' + d.Icu + ' kA · ' + fmt(d.L, 0) + ' m ' + (d.n > 1 ? d.n + '×' : '') + fmt(d.S, d.S % 1 ? 1 : 0) + ' mm²' })),
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-4, 6] },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
