/* VoltSim · Fabrika Senaryosu — trafo, ana dağıtım panosu (ADP) ve kompanzasyon tek ortak senaryoda.
 * Hesap: VoltSimEngine.ext.fabrika (E.pano, E.komp ve E.trafo motorlarını aynı girdiyle sırayla besler).
 * Sahne ve 2D tek hat şeması yalnız hesap sonucunu gösterir. Akış noktaları hesaplanan akımın büyüklüğünü temsil eder;
 * elektron hareketi ya da ölçülmüş güç kalitesi değildir. Eğitim ve ön değerlendirme modelidir, canlı dijital ikiz değildir. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt, esc = VS.esc;
  const F = E.ext.fabrika, TR = E.trafo;
  const clamp = E.clamp;
  const ID = 'fabrika', KEY = 'voltsim:fabrika:';
  const LOG_MAX = 300;
  const SR_LIST = Object.keys(TR.PRESETS).map(Number);
  const U1_LIST = [34.5, 31.5, 15.8, 10.5, 6.3];
  const ICU = [36, 42, 50, 65, 80, 100];
  const FEED_S = [95, 120, 150, 185, 240, 300, 400, 500, 630];
  const DETUNE = [[0, 'Yok (reaktörsüz)'], [5.67, '%5,67 · 210 Hz'], [7, '%7 · 189 Hz'], [14, '%14 · 134 Hz']];
  const tech = s => s.ui && s.ui.mode === 'technical';
  const clone = o => JSON.parse(JSON.stringify(o));
  const facilityName = s => (s.facility.name || '').trim() || 'Adsız tesis';

  /* ---------------------------------------------------------------- cihazda saklanan yan veriler */
  function sget(k, d) { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }
  function sset(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); return true; } catch (_) { return false; } }
  function sdel(k) { try { localStorage.removeItem(KEY + k); } catch (_) { } }
  /** app.fab: olay geçmişi, A/B senaryoları, cihaz kayıtları ve seçim (durumdan ayrı; JSON dışa aktarımda "extras"). */
  function fab(app) {
    if (!app.fab) {
      const ab = sget('ab', null);
      app.fab = { log: cleanLog(sget('log', [])), ab: cleanAB(ab), saves: cleanSaves(sget('saves', [])), sel: null, causes: [], sum: null, hits: [], doors: { adp: false, komp: false, trafo: false } };
    }
    return app.fab;
  }
  function cleanLog(a) { return (Array.isArray(a) ? a : []).filter(x => x && typeof x.text === 'string' && isFinite(x.t)).slice(-LOG_MAX).map(x => ({ t: Number(x.t), kind: String(x.kind || ''), text: String(x.text).slice(0, 400), delta: String(x.delta || '').slice(0, 300), notes: Array.isArray(x.notes) ? x.notes.map(String).slice(0, 6) : [] })); }
  function cleanSlot(x) {
    if (!x || typeof x !== 'object' || !x.state || typeof x.state !== 'object') return null;
    let st;
    try { st = VS.sanitize(F.scenarioOf(F.defaults()), F.migrate(x.state, x.schema || 1).state); } catch (_) { return null; }
    return { state: st, at: Number(x.at) || Date.now(), name: String(x.name || '').slice(0, 80), engine: String(x.engine || ''), schema: F.SCHEMA };
  }
  function cleanAB(o) { o = o && typeof o === 'object' ? o : {}; return { A: cleanSlot(o.A), B: cleanSlot(o.B) }; }
  function cleanSaves(a) { return (Array.isArray(a) ? a : []).map(x => { const c = cleanSlot(x); if (c) c.id = String(x.id || Date.now() + Math.random()); return c; }).filter(Boolean); }
  let persistT = 0;
  function persist(app) {
    clearTimeout(persistT);
    persistT = setTimeout(() => { const f = fab(app); if (f.noSave) return; sset('log', f.log); sset('ab', f.ab); }, 400);
  }

  /* ---------------------------------------------------------------- olay geçmişi */
  /** Kullanıcı eylemleri kuyruğa alınır: hesap kare başına bir kez çalıştığından aynı karedeki birden çok eylem kaybolmaz. */
  function cause(app, c) { const f = fab(app); f.causes.push(Object.assign({ t: Date.now() }, c)); f.noSave = false; }
  /** Bekleyen (bir sonraki karede çalışacak) hesabı hemen çalıştırır: elle yazılan olaylar doğru sırada kalır. */
  function flush(app) { if (app._pending) { cancelAnimationFrame(app._computeRaf); app._pending = false; app.recompute(); } }
  function pushLog(app, e) {
    const f = fab(app);
    f.log.push(Object.assign({ t: Date.now(), kind: '', text: '', delta: '', notes: [] }, e));
    if (f.log.length > LOG_MAX) f.log.splice(0, f.log.length - LOG_MAX);
    persist(app);
  }
  /** Kontrol anahtarı → okunur etiket ve değer (olay metni için). */
  function describe(app, c) {
    const s = app.state, k = c.key;
    let m = /^loads\.(\d+)\.(\w+)$/.exec(k);
    if (m) {
      const l = s.loads[Number(m[1])]; if (!l) return null;
      if (m[2] === 'on') return { text: l.name + (c.to ? ' devreye alındı' : ' devreden çıkarıldı'), kind: 'load' };
      const lab = { P_kW: 'güç', cos: 'cosφ', eff: 'verim', L: 'kablo boyu', S: 'kesit', par: 'paralel kablo', In: 'MCCB In', name: 'ad', type: 'tip', vis: 'görünüm', harm: 'harmonik profili', critical: 'kritik yük' }[m[2]] || m[2];
      return { text: l.name + ' · ' + lab + ': ' + val(c.from) + ' → ' + val(c.to), kind: 'param', merge: k };
    }
    m = /^comp\.manual\.(\d+)$/.exec(k);
    if (m) return { text: 'Kademe ' + (Number(m[1]) + 1) + ' (' + fmt(s.comp.steps[m[1]], 0, 'kVAr') + ') elle ' + (c.to ? 'devreye alındı' : 'devreden çıkarıldı'), kind: 'comp' };
    if (k === 'comp.mode') return { text: 'Kompanzasyon: ' + F.COMP_MODES[c.to], kind: 'comp' };
    if (/^ui\./.test(k)) return null;
    const lab = LABELS[k] || k;
    return { text: lab + ': ' + val(c.from) + ' → ' + val(c.to), kind: 'param', merge: k };
  }
  function val(v) { return typeof v === 'number' ? fmt(v, Math.abs(v) < 10 && v % 1 ? 2 : v % 1 ? 1 : 0) : typeof v === 'boolean' ? (v ? 'evet' : 'hayır') : Array.isArray(v) ? v.join(', ') : String(v); }
  const LABELS = {
    'trafo.Sr_kVA': 'Trafo anma gücü (kVA)', 'trafo.P0': 'Trafo P0 (W)', 'trafo.Pk': 'Trafo Pk (W)', 'trafo.uk': 'Trafo uk (%)', 'trafo.ambient': 'Ortam sıcaklığı (°C)', 'trafo.U2_V': 'AG gerilimi (V)',
    'supply.U1_kV': 'OG gerilimi (kV)', 'supply.SkQ_MVA': 'OG kısa devre gücü (MVA)', 'board.mainIn': 'ACB In (A)', 'board.mainIrF': 'ACB Ir ayarı (×In)', 'board.mainIcu_kA': 'ACB Icu (kA)', 'board.busbarIn': 'Bara (A)',
    'board.feedL': 'Trafo–ADP kablo boyu (m)', 'board.feedS': 'Trafo–ADP kesit (mm²)', 'board.feedN': 'Trafo–ADP paralel kablo', 'comp.target': 'Hedef cosφ', 'comp.detune': 'Ayar oranı p (%)', 'comp.steps': 'Kademeler (kVAr)',
    'comp.L': 'Banka kablo boyu (m)', 'comp.S': 'Banka kesit (mm²)', 'comp.par': 'Banka paralel kablo', 'comp.In': 'Banka MCCB In (A)', 'facility.name': 'Tesis adı', 'facility.note': 'Not', 'facility.shift': 'Vardiya profili', 'facility.price': 'Kayıp fiyatı (TL/kWh)'
  };
  /** Her hesaptan sonra: kullanıcı eylemi (cause) varsa olay geçmişine önce→sonra farkıyla yazılır; yeni uygunsuzluklar eklenir. */
  function afterCompute(app, res) {
    const f = fab(app);
    // aynı ayarın ardışık değişiklikleri (kaydırıcı) tek nedene indirgenir: ilk "önce", son "sonra"
    const cs = [];
    f.causes.splice(0).forEach(c => { const p = cs[cs.length - 1]; if (p && c.key && p.key === c.key) { p.to = c.to; p.t = c.t; } else cs.push(c); });
    if (!res.ok) { if (cs.length) pushLog(app, { kind: 'error', text: 'Girdi hatası: ' + res.errors.slice(0, 2).join('; ') }); return; }
    const sum = F.summary(res), prev = f.sum; f.sum = sum;
    if (!prev || !cs.length) return;
    const label = id => (res.checks.find(x => x.id === id) || {}).label || id;
    const ds = cs.map(c => ({ c: c, d: c.key ? describe(app, c) : { text: c.text, kind: c.kind } })).filter(x => x.d);
    if (!ds.length) return;
    if (ds.length > 1) {
      // aynı hesapta birden çok değişiklik: her biri yazılır, toplam etki sonuncunun altında
      ds.forEach((x, i) => pushLog(app, { kind: x.d.kind, text: x.d.text, delta: i === ds.length - 1 ? F.deltaText(prev, sum) + ' (son ' + ds.length + ' değişikliğin toplam etkisi)' : '', notes: i === ds.length - 1 ? failNotes(prev, sum, label) : [] }));
      f.mergeBase = null; return;
    }
    const c = ds[0].c, d = ds[0].d;
    const last = f.log[f.log.length - 1];
    // kaydırıcı sürükleme gibi ardışık aynı ayar değişiklikleri tek olayda birleşir
    if (d.merge && last && last.merge === d.merge && c.t - last.t < 2500 && f.mergeBase) {
      const from = last.from;
      last.text = (describe(app, Object.assign({}, c, { from: from })) || d).text; last.t = c.t;
      last.delta = F.deltaText(f.mergeBase, sum); last.notes = failNotes(f.mergeBase, sum, label);
      persist(app); return;
    }
    f.mergeBase = prev;
    pushLog(app, { kind: d.kind, text: d.text, delta: F.deltaText(prev, sum), notes: failNotes(prev, sum, label), merge: d.merge || '', from: c.from });
  }
  function failNotes(a, b, label) {
    const out = [];
    b.fails.filter(x => a.fails.indexOf(x) < 0).forEach(x => out.push('Yeni uygunsuzluk: ' + label(x)));
    a.fails.filter(x => b.fails.indexOf(x) < 0).forEach(x => out.push('Giderildi: ' + label(x)));
    return out;
  }

  /* ---------------------------------------------------------------- ekipman: bilgi ve eylemler (3D, 2D ve listede ortak) */
  function loadIdx(s, id) { return s.loads.findIndex(l => l.id === id); }
  function toggleLoad(app, id) {
    const i = loadIdx(app.state, id); if (i < 0) return;
    app.set('loads.' + i + '.on', !app.state.loads[i].on);
  }
  function equipList(app) {
    const s = app.state;
    return [{ key: 'og', title: 'OG besleme ve trafo koruma hücresi' }, { key: 'trafo', title: 'Güç trafosu' }, { key: 'adp', title: 'Ana dağıtım panosu (ADP)' }, { key: 'komp', title: 'Kompanzasyon panosu' }]
      .concat(s.loads.map(l => ({ key: 'load:' + l.id, title: l.name })));
  }
  function equip(app, key) {
    const s = app.state, r = app.validResult, v = r && r.values;
    if (!v) return { title: '—', lines: ['Geçerli hesap sonucu yok.'], actions: [] };
    const st = id => (r.checks.find(c => c.id === id) || {}).status;
    const flag = area => { const l = r.checks.filter(c => c.area === area && (c.status === 'fail' || c.status === 'warn')); return l.length ? l.map(c => (c.status === 'fail' ? '✕ ' : '! ') + c.label + ': ' + c.detail) : ['✓ Bu ekipmanın ön kontrolleri uygun.']; };
    const t = v.trafo;
    if (key === 'og') return { title: 'OG besleme · trafo koruma hücresi', lines: ['OG ' + fmt(s.supply.U1_kV, 1, 'kV') + ' · SkQ ' + fmt(s.supply.SkQ_MVA, 0, 'MVA') + ' (girdi)', 'OG akımı I1 = ' + fmt(t.I1, 1, 'A') + ' (anma ' + fmt(t.I1n, 1, 'A') + ')', 'OG koruma, röle ayarı ve manevra kilitlemeleri bu senaryoda yoktur: Trafo modülünde inceleyin.'], actions: [] };
    if (key === 'trafo') return { title: 'Güç trafosu · ' + fmt(s.trafo.Sr_kVA, 0, 'kVA') + ' yağlı, ONAN',
      lines: ['Yüklenme K = %' + fmt(t.k * 100, 1) + ' (S = ' + fmt(t.S, 1, 'kVA') + ')', 'AG akımı ' + fmt(t.I2, 0, 'A') + ' / anma ' + fmt(t.I2n, 0, 'A'), 'Kayıp ' + fmt(t.losses / 1e3, 2, 'kW') + ' (P0 ' + fmt(t.P0 / 1e3, 2) + ' + Pcu ' + fmt(t.Pcu / 1e3, 2) + ') · verim %' + fmt(t.eff, 2),
        'Kararlı üst yağ ' + fmt(t.temps.topOil, 1, '°C') + ' · sıcak nokta ' + fmt(t.temps.hotSpot, 1, '°C') + ' (ortam ' + fmt(s.trafo.ambient, 0, '°C') + ')', 'AG uç gerilimi ≈ ' + fmt(v.bus.U, 1, 'V') + ' (ε %' + fmt(v.bus.eps, 2) + ')', 'uk %' + fmt(s.trafo.uk, 1) + ' · Ik3 AG ≈ ' + fmt(t.Ik / 1e3, 1, 'kA')].concat(flag('trafo')),
      actions: [{ label: fab(app).doors.trafo ? 'Bölme kapısını kapat' : 'Bölme kapısını aç', onClick: a => door(a, 'trafo') }] };
    if (key === 'adp') return { title: 'Ana dağıtım panosu · ACB ' + s.board.mainIn + ' A',
      lines: ['Bara: P ' + fmt(v.bus.P, 1, 'kW') + ' · Q ' + fmt(v.bus.Q, 1, 'kVAr') + ' · cosφ ' + fmt(v.bus.pf, 3), 'En yüklü faz ' + fmt(v.bus.I, 0, 'A') + ' / Ir ' + fmt(v.bus.mainIr, 0, 'A') + ' (%' + fmt(v.bus.loading, 0) + ')', 'Ik3 ≈ ' + fmt(v.bus.Ik3 / 1e3, 2, 'kA') + ' · ip ≈ ' + fmt(v.bus.ip / 1e3, 1, 'kA') + ' · Icu ' + s.board.mainIcu_kA + ' kA', s.loads.length + ' yük çıkışı (MCCB) + 1 kompanzasyon çıkışı'].concat(flag('adp')),
      actions: [{ label: fab(app).doors.adp ? 'Pano kapaklarını kapat' : 'Pano kapaklarını aç', onClick: a => door(a, 'adp') }] };
    if (key === 'komp') {
      const c = v.comp;
      return { title: 'Kompanzasyon panosu · ' + fmt(c.Qtot, 0, 'kVAr') + (s.comp.detune > 0 ? ' · ayarlı p %' + fmt(s.comp.detune, 2) : ' · reaktörsüz'),
        lines: ['Mod: ' + F.COMP_MODES[s.comp.mode] + ' · hedef cosφ ' + fmt(s.comp.target, 3), 'Devrede ' + fmt(c.Qon, 0, 'kVAr') + ' (' + c.on.filter(Boolean).length + ' / ' + c.on.length + ' kademe) · gerekli ' + fmt(c.Qneed, 0, 'kVAr'), 'cosφ ' + fmt(v.load.cos, 3) + ' → ' + fmt(v.bus.pf, 3) + ' (' + (v.bus.Q < 0 ? 'kapasitif' : 'endüktif') + ')',
          'THDv ≈ %' + fmt(c.THDv, 2) + ' · rezonans h ≈ ' + fmt(c.hPar, 2) + ' · kondansatör akımı ' + fmt(c.capOver, 2) + '×In', 'Bara gerilim yükselmesi ≈ %' + fmt(c.rise, 2) + ' (Qc/Sk)'].concat(flag('komp')),
        actions: [{ label: fab(app).doors.komp ? 'Kapağı kapat' : 'Kapağı aç', onClick: a => door(a, 'komp') }, s.comp.mode !== 'auto' ? { label: 'Otomatiğe al', variant: 'primary', onClick: a => a.set('comp.mode', 'auto') } : null].filter(Boolean) };
    }
    if (/^load:/.test(key)) {
      const id = key.slice(5), i = loadIdx(s, id), l = s.loads[i], x = v.loads[i];
      if (!l || !x) return { title: '—', lines: [], actions: [] };
      const ty = F.LOAD_TYPES[l.type];
      return { title: l.name + ' · ' + (l.on ? 'devrede' : 'devre dışı'),
        lines: [ty.label + (l.critical ? ' · kritik yük' : ''), (ty.motor ? 'Mil gücü ' + fmt(l.P_kW, 1, 'kW') + ' · elektriksel ' : 'Güç ') + fmt(x.PelRated, 1, 'kW') + ' · cosφ ' + fmt(l.cos, 2),
          'Çekilen akım ' + fmt(x.I, 1, 'A') + ' (tasarım Ib ' + fmt(x.Ib, 1, 'A') + ')', 'MCCB ' + l.In + ' A · kablo ' + (l.par > 1 ? l.par + '×' : '') + '3×' + l.S + ' mm² Cu, ' + l.L + ' m · Iz ' + fmt(x.Iz, 0, 'A'),
          'ΔU %' + fmt(x.vd, 2) + ' · hat sonu Ik1 ≈ ' + fmt(x.Ik1, 0, 'A') + ' (gerekli ' + fmt(x.Ia, 0, 'A') + ')', 'Harmonik profili: ' + (F.HARM[l.harm] || F.HARM[ty.harm]).label].concat(flag('load:' + id)),
        actions: [{ label: l.on ? 'Devreden çıkar' : 'Devreye al', variant: l.on ? 'warn' : 'primary', onClick: a => toggleLoad(a, id) }] };
    }
    return { title: '—', lines: [], actions: [] };
  }
  function door(app, which) { const f = fab(app); f.doors[which] = !f.doors[which]; app.wake(); app.renderAnalysis(); }
  function select(app, key) {
    const f = fab(app); f.sel = key;
    const v = app.viewer;
    if (v) { const p = v.pickables.find(x => x.key === key); if (p && v.selected !== p) { v.viaKeyboard = false; v.select(p); return; } }
    app.renderAnalysis(); if (app.mode === '2d') app.draw2d();
  }

  /* ---------------------------------------------------------------- kontroller */
  function presetTrafo(a, sr) { const p = TR.PRESETS[sr]; if (!p) return; a.state.trafo.P0 = p.P0; a.state.trafo.Pk = p.Pk; a.state.trafo.uk = p.uk; }
  function parseSteps(t) {
    const a = String(t).split(/[;,\s]+/).filter(Boolean).map(x => Number(x.replace(',', '.')));
    if (!a.length || a.some(x => !isFinite(x) || x <= 0 || x > 2000)) throw new Error('Kademeleri virgülle ayırın; her biri 0–2000 kVAr (ör. 25, 50, 100).');
    return a;
  }
  function addLoad(app, type) {
    const s = app.state, ty = F.LOAD_TYPES[type];
    let n = 1; while (s.loads.some(l => l.id === type + n)) n++;
    const l = F.newLoad({ id: type + n, name: ty.label.split(' ·')[0].split(' (')[0] + ' ' + n, type: type, vis: ty.vis, P_kW: type === 'lighting' ? 20 : 30, cos: ty.cos, eff: ty.eff, L: 40 });
    Object.assign(l, F.autoSize(l, s.trafo.U2_V));
    delete l.Ib;
    cause(app, { kind: 'load', text: 'Yük grubu eklendi: ' + l.name + ' (' + fmt(l.P_kW, 0, 'kW') + ', MCCB ' + l.In + ' A, ' + (l.par > 1 ? l.par + '×' : '') + l.S + ' mm²)' });
    s.loads.push(l); app.renderControls(true); app.invalidate();
  }
  function removeLoad(app, i) {
    const l = app.state.loads[i]; if (!l) return;
    cause(app, { kind: 'load', text: 'Yük grubu kaldırıldı: ' + l.name });
    app.state.loads.splice(i, 1); if (fab(app).sel === 'load:' + l.id) fab(app).sel = null;
    app.renderControls(true); app.invalidate();
  }
  function controls(s, app) {
    const T = tech(s), groups = [];
    groups.push({ title: 'Kullanım biçimi', items: [
      { type: 'seg', key: 'ui.mode', label: 'Görünüm', options: [['guided', 'Rehberli'], ['technical', 'Teknik']] },
      { type: 'note', text: T ? 'Teknik kullanım: tüm girdiler, ara sonuçlar (hesap zinciri, çıkış tablosu, harmonik spektrum) ve model sınırları açıktır.' : 'Rehberli kullanım: yükleri açıp kapatın, kompanzasyonu değiştirin; trafo, pano ve kompanzasyon sonuçları aynı hesaptan birlikte güncellenir. Analiz panelindeki görevlerle başlayabilirsiniz.' }
    ] });
    groups.push({ title: 'Tesis', collapsed: !T, summary: facilityName(s), items: [
      { type: 'text', key: 'facility.name', label: 'Tesis adı (yalnız bu cihazda)', placeholder: 'Örn. A Fabrikası', parse: v => String(v).slice(0, 80) },
      { type: 'select', key: 'facility.shift', label: 'Günlük yük profili', options: Object.keys(F.SHIFTS).map(k => [k, F.SHIFTS[k]]), help: 'Günlük reaktif enerji oranı ve yıllık trafo kayıp enerjisi bu profille hesaplanır.' },
      T ? { type: 'number', key: 'facility.price', label: 'Kayıp enerjisi birim fiyatı', min: 0, max: 100, step: 0.1, unit: 'TL/kWh', digits: 2, help: 'Örnek değer; güncel tarifenizi girin.' } : null,
      T ? { type: 'text', key: 'facility.note', label: 'Not (yalnız bu cihazda)', multiline: true, parse: v => String(v).slice(0, 500) } : null
    ] });
    groups.push({ title: 'Yük grupları (' + s.loads.length + ')', items: [
      { type: 'custom', render: (box, a) => renderLoadRows(box, a) },
      T ? { type: 'note', text: 'Ayrıntılar için aşağıdaki yük kartlarını açın. Motorlarda güç mil gücüdür (elektriksel güç P/η).' } : null
    ] });
    if (T) {
      s.loads.forEach((l, i) => {
        const p = 'loads.' + i + '.', ty = F.LOAD_TYPES[l.type];
        groups.push({ title: l.name, collapsed: true, summary: ty.label + ' · ' + fmt(l.P_kW, 0, 'kW'), items: [
          { type: 'text', key: p + 'name', label: 'Ad', parse: v => { v = String(v).trim().slice(0, 60); if (!v) throw new Error('Ad boş olamaz.'); return v; } },
          { type: 'select', key: p + 'type', label: 'Yük tipi', options: Object.keys(F.LOAD_TYPES).map(k => [k, F.LOAD_TYPES[k].label]), onChange: (v, a) => { const t = F.LOAD_TYPES[v], L = a.state.loads[i]; L.cos = t.cos; L.eff = t.eff; L.harm = ''; L.vis = t.vis; a.renderControls(true); a.invalidate(); } },
          { type: 'select', key: p + 'vis', label: '3D görünüm (hesabı etkilemez)', options: Object.keys(F.VISUALS).map(k => [k, F.VISUALS[k]]) },
          { type: 'number', key: p + 'P_kW', label: ty.motor ? 'Mil gücü' : 'Güç', min: 0.1, max: 2000, step: 0.5, unit: 'kW' },
          { type: 'range', key: p + 'cos', label: 'cosφ', min: 0.5, max: 1, step: 0.01, digits: 2 },
          ty.motor ? { type: 'range', key: p + 'eff', label: 'Verim η', min: 0.7, max: 0.98, step: 0.01, digits: 2 } : null,
          { type: 'select', key: p + 'harm', label: 'Harmonik profili', options: [['', 'Tipe göre (' + F.HARM[ty.harm].label + ')']].concat(Object.keys(F.HARM).map(k => [k, F.HARM[k].label])) },
          { type: 'select', key: p + 'In', label: 'Çıkış MCCB In', options: F.MCCB_IN.map(v => [v, v + ' A']) },
          { type: 'select', key: p + 'S', label: 'Kablo kesiti (Cu, yöntem E)', options: F.CABLES.map(v => [v, v + ' mm²']) },
          { type: 'number', key: p + 'par', label: 'Paralel kablo sayısı', min: 1, max: 12, step: 1 },
          { type: 'number', key: p + 'L', label: 'Kablo boyu', min: 1, max: 1000, step: 1, unit: 'm' },
          { type: 'toggle', key: p + 'critical', label: 'Kritik yük (görevlerde kapatılamaz)' },
          { type: 'buttons', items: [
            { label: 'Çıkışı boyutlandır (öneri)', onClick: a => { const L = a.state.loads[i], z = F.autoSize(L, a.state.trafo.U2_V); cause(a, { kind: 'param', text: L.name + ': çıkış önerisi uygulandı (MCCB ' + z.In + ' A, ' + (z.par > 1 ? z.par + '×' : '') + z.S + ' mm²)' }); L.In = z.In; L.S = z.S; L.par = z.par; a.renderControls(true); a.invalidate(); } },
            { label: 'Kaldır', variant: 'danger', onClick: a => removeLoad(a, i) }
          ] }
        ] });
      });
      groups.push({ title: 'Yük grubu ekle', collapsed: true, summary: 'Tip seçin', items: [
        { type: 'buttons', items: Object.keys(F.LOAD_TYPES).map(k => ({ label: '+ ' + F.LOAD_TYPES[k].label.split(' ·')[0].split(' (')[0], onClick: a => addLoad(a, k) })) },
        { type: 'note', text: 'Yeni çıkış için MCCB ve kablo önerisi Ib ≤ In ≤ Iz ve gerilim düşümüne göre otomatik seçilir; kontrol edin.' }
      ] });
    }
    const manual = s.comp.mode === 'manual';
    groups.push({ title: 'Kompanzasyon', items: [
      { type: 'seg', key: 'comp.mode', label: 'Çalışma', options: Object.keys(F.COMP_MODES).map(k => [k, { auto: 'Otomatik', manual: 'Elle', off: 'Kapalı' }[k]]) },
      { type: 'range', key: 'comp.target', label: 'Hedef cosφ (röle)', min: 0.9, max: 1, step: 0.005, digits: 3, help: 'Otomatik modda röle hedefi aşmayan en büyük kademe toplamını seçer.' },
      { type: 'select', key: 'comp.detune', label: 'Ayarlı reaktör (p)', options: DETUNE, help: 'Sürücülü yüklerde reaktörsüz banka şebekeyle rezonansa girebilir; ayarlı reaktör rezonansı 5. harmoniğin altına çeker.' },
      manual ? { type: 'custom', render: (box, a) => renderSteps(box, a) } : null,
      T ? { type: 'text', key: 'comp.steps', label: 'Kademeler (kVAr, virgülle)', format: v => v.join(', '), parse: parseSteps, rebuild: true } : null,
      T ? { type: 'select', key: 'comp.In', label: 'Banka çıkışı MCCB In', options: F.MCCB_IN.map(v => [v, v + ' A']) } : null,
      T ? { type: 'select', key: 'comp.S', label: 'Banka kablo kesiti', options: F.CABLES.map(v => [v, v + ' mm²']) } : null,
      T ? { type: 'number', key: 'comp.par', label: 'Banka paralel kablo', min: 1, max: 12, step: 1 } : null,
      T ? { type: 'number', key: 'comp.L', label: 'Banka kablo boyu', min: 1, max: 200, step: 1, unit: 'm' } : null
    ] });
    groups.push({ title: 'Trafo', items: [
      { type: 'select', key: 'trafo.Sr_kVA', label: 'Anma gücü', options: (SR_LIST.indexOf(s.trafo.Sr_kVA) < 0 ? [s.trafo.Sr_kVA] : []).concat(SR_LIST).map(v => [v, v + ' kVA' + (TR.PRESETS[v] ? '' : ' (özel)')]), onChange: (v, a) => { presetTrafo(a, v); a.renderControls(true); }, help: 'Seçince P0, Pk ve uk örnek katalog değerleriyle doldurulur (36 kV yağlı).' },
      T ? { type: 'number', key: 'trafo.Sr_kVA', label: 'Anma gücü (özel değer)', min: 25, max: 5000, step: 5, unit: 'kVA' } : null,
      T ? { type: 'number', key: 'trafo.P0', label: 'Boşta kayıp P0', min: 0, max: 20000, step: 10, unit: 'W' } : null,
      T ? { type: 'number', key: 'trafo.Pk', label: 'Yük kaybı Pk', min: 0, max: 60000, step: 50, unit: 'W' } : null,
      T ? { type: 'number', key: 'trafo.uk', label: 'Kısa devre gerilimi uk', min: 2, max: 12, step: 0.1, unit: '%' } : null,
      { type: 'range', key: 'trafo.ambient', label: 'Trafo odası sıcaklığı', min: -10, max: 45, step: 1, unit: '°C' }
    ] });
    if (T) {
      groups.push({ title: 'OG besleme', collapsed: false, items: [
        { type: 'select', key: 'supply.U1_kV', label: 'OG gerilimi', options: U1_LIST.map(v => [v, fmt(v, 1, 'kV')]) },
        { type: 'number', key: 'supply.SkQ_MVA', label: 'OG şebeke kısa devre gücü SkQ', min: 0, max: 5000, step: 10, unit: 'MVA', help: 'Dağıtım şirketinden alınır; 0 girilirse yalnız trafo empedansı.' }
      ] });
      groups.push({ title: 'Ana dağıtım panosu', collapsed: false, items: [
        { type: 'select', key: 'board.mainIn', label: 'ACB anma akımı', options: F.ACB_IN.map(v => [v, v + ' A']) },
        { type: 'range', key: 'board.mainIrF', label: 'ACB Ir ayarı', min: 0.4, max: 1, step: 0.05, fmt: v => fmt(v, 2) + '×In = ' + fmt(v * s.board.mainIn, 0) + ' A' },
        { type: 'select', key: 'board.mainIcu_kA', label: 'ACB kesme kapasitesi Icu', options: ICU.map(v => [v, v + ' kA']) },
        { type: 'select', key: 'board.busbarIn', label: 'Bara anma akımı', options: E.pano.BUSBARS.map(v => [v, v + ' A']) },
        { type: 'number', key: 'board.feedL', label: 'Trafo–ADP kablo boyu', min: 1, max: 200, step: 1, unit: 'm' },
        { type: 'select', key: 'board.feedS', label: 'Trafo–ADP faz kesiti', options: FEED_S.map(v => [v, v + ' mm²']) },
        { type: 'number', key: 'board.feedN', label: 'Faz başına paralel kablo', min: 1, max: 12, step: 1 }
      ] });
    }
    groups.push({ title: 'Ekipman', collapsed: !T, summary: 'Listeden seçin', items: [
      { type: 'buttons', items: equipList(app).map(e => ({ label: e.title, pressed: fab(app).sel === e.key, onClick: a => select(a, e.key) })) },
      { type: 'buttons', items: [
        { label: fab(app).doors.adp ? 'Pano kapaklarını kapat' : 'Pano kapaklarını aç', onClick: a => { door(a, 'adp'); door(a, 'komp'); a.renderControls(true); } },
        { label: 'Kesit görünümü', onClick: a => { const b = a.root.querySelector('.vs-vt[data-vs-act="section"]'); if (b && !b.disabled) b.click(); } }
      ] },
      { type: 'note', text: 'Seçili ekipmanın ayrıntıları Analiz panelinde ve 3D sahnedeki kartta görünür. Kesit düzlemi önden arkaya ilerler: trafo, sargılar ve panoların içi görünür.' }
    ] });
    groups.push({ title: 'Proje ve veriler', collapsed: true, summary: 'Kaydet · JSON · paylaş · temizle', items: [{ type: 'custom', render: (box, a) => renderProject(box, a) }] });
    // rapor ve CSV girdileri reportInputs ile eksiksiz verilir (kullanım biçiminden bağımsız)
    groups.forEach(g => g.items.forEach(it => { if (it) it.report = false; }));
    return groups;
  }
  function renderLoadRows(box, app) {
    const s = app.state, r = app.validResult;
    const ul = VS.el('ul', { class: 'vs-fab-loads' });
    s.loads.forEach((l, i) => {
      const x = r && r.values.loads ? r.values.loads[i] : null, id = 'fabl-' + l.id;
      const cb = VS.el('input', { type: 'checkbox', id: id, 'data-key': 'loads.' + i + '.on', checked: l.on ? true : undefined });
      cb.addEventListener('change', () => app.set('loads.' + i + '.on', cb.checked));
      const sel = VS.el('button', { type: 'button', class: 'vs-fab-loads__sel', 'aria-label': l.name + ' ayrıntısı', title: 'Ayrıntı', text: 'i' });
      sel.addEventListener('click', () => select(app, 'load:' + l.id));
      ul.appendChild(VS.el('li', { 'data-on': l.on ? '1' : '0', 'data-status': x ? x.status : '' }, [
        VS.el('label', { class: 'vs-toggle', for: id }, [VS.el('span', {}, [VS.el('b', { text: l.name }), VS.el('small', { text: F.LOAD_TYPES[l.type].label.split(' ·')[0] + ' · ' + fmt(F.elec(l), 0, 'kW') + (l.critical ? ' · kritik' : '') })]), cb, VS.el('span', { class: 'vs-sw', 'aria-hidden': 'true' })]),
        sel
      ]));
    });
    box.appendChild(ul);
  }
  function renderSteps(box, app) {
    const s = app.state;
    const wrap = VS.el('div', { class: 'vs-chips', role: 'group', 'aria-label': 'Elle kademe seçimi' });
    s.comp.steps.forEach((q, i) => {
      const on = !!s.comp.manual[i];
      const b = VS.el('button', { type: 'button', class: 'vs-chip', 'aria-pressed': on ? 'true' : 'false', 'data-key': 'comp.manual.' + i, text: (i + 1) + ': ' + fmt(q, 0) + ' kVAr' });
      b.addEventListener('click', () => { while (s.comp.manual.length < s.comp.steps.length) s.comp.manual.push(false); app.set('comp.manual.' + i, !on, { rebuild: true }); });
      wrap.appendChild(b);
    });
    box.appendChild(VS.el('span', { class: 'vs-field__label', text: 'Elle kademeler' }));
    box.appendChild(wrap);
  }

  /* ---------------------------------------------------------------- proje: cihazda kayıt, JSON, paylaşım, temizleme */
  function snapshot(app, name) { return { id: String(Date.now()), name: name, at: Date.now(), schema: F.SCHEMA, engine: E.version, state: F.scenarioOf(app.state) }; }
  function openSlot(app, slot, text) {
    const st = VS.sanitize(F.defaults(), Object.assign(clone(slot.state), { ui: clone(app.state.ui) }));
    cause(app, { kind: 'project', text: text });
    app.applyState(st);
  }
  function renderProject(box, app) {
    const f = fab(app), el = VS.el;
    // cihazda adlı kayıtlar
    const name = el('input', { class: 'vs-input', id: 'fab-save-name', type: 'text', maxlength: '80', value: facilityName(app.state) + ' · ' + new Date().toLocaleDateString('tr-TR') });
    const save = el('button', { type: 'button', class: 'vs-btn vs-btn--primary', text: 'Bu cihazda kaydet' });
    save.onclick = () => {
      flush(app);
      const snap = snapshot(app, name.value.trim() || facilityName(app.state));
      f.saves.unshift(snap);
      if (!sset('saves', f.saves)) { f.saves.shift(); VS.toast('Tarayıcı depolama alanı dolu ya da kapalı; kaydedilemedi. JSON dışa aktarmayı kullanın.', 'bad'); return; }
      pushLog(app, { kind: 'project', text: 'Cihazda kaydedildi: ' + snap.name });
      VS.toast('Bu cihazda kaydedildi: ' + snap.name, 'ok'); app.renderControls(true); app.renderAnalysis();
    };
    box.appendChild(el('div', { class: 'vs-field' }, [el('label', { for: 'fab-save-name', text: 'Kayıt adı' }), name]));
    box.appendChild(el('div', { class: 'vs-btns' }, [save]));
    if (f.saves.length) {
      const ul = el('ul', { class: 'vs-fab-saves' });
      f.saves.forEach(sv => {
        const ld = el('button', { type: 'button', class: 'vs-btn', text: 'Aç' }), del = el('button', { type: 'button', class: 'vs-btn vs-btn--danger', text: 'Sil', 'aria-label': sv.name + ' kaydını sil' });
        ld.onclick = () => { openSlot(app, sv, 'Cihaz kaydı açıldı: ' + sv.name); VS.toast('Kayıt açıldı: ' + sv.name, 'ok'); };
        del.onclick = () => { f.saves = f.saves.filter(x => x !== sv); sset('saves', f.saves); app.renderControls(true); };
        ul.appendChild(el('li', {}, [el('span', {}, [el('b', { text: sv.name }), el('small', { text: new Date(sv.at).toLocaleString('tr-TR') + ' · şema ' + sv.schema })]), ld, del]));
      });
      box.appendChild(ul);
    }
    box.appendChild(el('p', { class: 'vs-note', text: 'Kayıtlar yalnız bu tarayıcıda (localStorage) tutulur; VoltGuard’a gönderilmez.' }));
    // JSON
    const exp = el('button', { type: 'button', class: 'vs-btn', text: 'JSON dışa aktar' }), imp = el('button', { type: 'button', class: 'vs-btn', text: 'JSON içe aktar' });
    exp.onclick = () => app.action('save'); imp.onclick = () => app.action('load');
    box.appendChild(el('div', { class: 'vs-btns' }, [exp, imp]));
    box.appendChild(el('p', { class: 'vs-note', text: 'Dosya biçimi voltsim-project, şema ' + F.SCHEMA + '; olay geçmişi ve A/B senaryoları dahildir. Trafo, kompanzasyon ve pano modüllerinin proje dosyaları da içe aktarılabilir (ortak alanlar aktarılır, gerisi bildirilir).' }));
    // paylaşım
    const keep = el('input', { type: 'checkbox', id: 'fab-share-name' });
    const share = el('button', { type: 'button', class: 'vs-btn', text: 'Paylaşım bağlantısı oluştur' });
    const out = el('input', { class: 'vs-input', type: 'text', readonly: true, hidden: true, 'aria-label': 'Paylaşım bağlantısı' });
    share.onclick = () => {
      const url = shareUrl(app, keep.checked);
      out.hidden = false; out.value = url; out.select();
      const done = () => VS.toast('Bağlantı kopyalandı. ' + (keep.checked ? 'Tesis adı bağlantıda.' : 'Tesis adı ve not bağlantıya eklenmedi.'), 'ok');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => VS.toast('Bağlantıyı kutudan kopyalayın.'));
      else VS.toast('Bağlantıyı kutudan kopyalayın.');
    };
    box.appendChild(el('label', { class: 'vs-check', for: 'fab-share-name' }, [keep, el('span', { text: 'Tesis adını da ekle (varsayılan: eklenmez)' })]));
    box.appendChild(el('div', { class: 'vs-btns' }, [share]));
    box.appendChild(out);
    box.appendChild(el('p', { class: 'vs-note', text: 'Bağlantı yalnız teknik girdileri içerir; olay geçmişi, notlar ve cihaz kayıtları eklenmez. Bağlantıya sahip herkes bu girdileri görebilir.' }));
    // temizleme (iki adımlı onay)
    const clr = el('button', { type: 'button', class: 'vs-btn vs-btn--danger', text: 'Bu cihazdaki Fabrika Senaryosu verilerini temizle' });
    clr.onclick = () => {
      if (clr.dataset.armed !== '1') { clr.dataset.armed = '1'; clr.textContent = 'Emin misiniz? Tekrar basın (geri alınamaz)'; setTimeout(() => { clr.dataset.armed = ''; clr.textContent = 'Bu cihazdaki Fabrika Senaryosu verilerini temizle'; }, 5000); return; }
      clearAll(app);
    };
    box.appendChild(el('div', { class: 'vs-btns' }, [clr]));
    box.appendChild(el('p', { class: 'vs-note', text: 'Silinenler: otomatik kayıt, cihaz kayıtları, A/B senaryoları, olay geçmişi ve görev ilerlemesi.' }));
  }
  function clearAll(app) {
    ['v1', 'tasks', 'log', 'ab', 'saves'].forEach(sdel);
    const f = fab(app);
    f.log = []; f.ab = { A: null, B: null }; f.saves = []; f.sel = null; f.sum = null; f.causes = []; f.noSave = true;
    app.doneTasks = {}; app.activeTask = null;
    const box = app.root.querySelector('[data-vs-tasks]'); if (box) box.dataset.sig = '';
    app.applyState(F.defaults());
    clearTimeout(app._save); sdel('v1');
    VS.toast('Bu cihazdaki Fabrika Senaryosu verileri temizlendi; varsayılan senaryo açıldı.', 'ok');
  }
  /** UTF-8 güvenli base64url */
  const b64 = t => btoa(unescape(encodeURIComponent(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = t => decodeURIComponent(escape(atob(t.replace(/-/g, '+').replace(/_/g, '/'))));
  function shareUrl(app, keepName) {
    return location.origin + location.pathname + '#paylas=' + b64(JSON.stringify({ f: 'voltsim-fabrika-paylas', schema: F.SCHEMA, s: F.anonymize(app.state, keepName) }));
  }
  function openShared(app) {
    const m = /^#paylas=([A-Za-z0-9_-]+)$/.exec(location.hash || '');
    if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { }
    try {
      const o = JSON.parse(unb64(m[1]));
      if (!o || o.f !== 'voltsim-fabrika-paylas' || !o.s) throw new Error('biçim');
      const mg = F.migrate(o.s, o.schema || 1);
      const st = VS.sanitize(F.defaults(), Object.assign(mg.state, { ui: clone(app.state.ui) }));
      const r = F.evaluate(st); if (!r.ok) throw new Error(r.errors[0]);
      // önceki çalışma kaybolmasın: otomatik cihaz kaydı (yalnız gerçekten farklıysa)
      const f = fab(app), prev = F.scenarioOf(app.state);
      let kept = false;
      if (app._restored && JSON.stringify(prev) !== JSON.stringify(F.scenarioOf(st))) {
        f.saves.unshift(snapshot(app, 'Paylaşım öncesi çalışma · ' + new Date().toLocaleString('tr-TR')));
        kept = sset('saves', f.saves); if (!kept) f.saves.shift();
      }
      cause(app, { kind: 'project', text: 'Paylaşılan senaryo açıldı' + (st.facility.name ? ': ' + st.facility.name : '') });
      app.applyState(st);
      VS.toast('Paylaşılan senaryo açıldı.' + (kept ? ' Önceki çalışmanız “Proje ve veriler” altında cihaz kaydı olarak saklandı.' : '') + (mg.notes.length ? ' ' + mg.notes.join(' ') : ''), 'ok');
    } catch (e) { VS.toast('Paylaşım bağlantısı okunamadı (' + e.message + ').', 'bad'); }
  }

  /* ---------------------------------------------------------------- analiz: okumalar, ek bölümler, grafikler */
  function readouts(r, s) {
    const v = r.values, t = v.trafo, c = v.comp, T = tech(s);
    const lv = st => (st === 'fail' ? 'bad' : st === 'warn' ? 'warn' : 'ok');
    const st = id => (r.checks.find(x => x.id === id) || {}).status;
    const on = s.loads.filter(l => l.on).length;
    const out = [
      { label: 'Devredeki yük', value: fmt(v.load.P, 1, 'kW'), sub: on + ' / ' + s.loads.length + ' yük grubu' },
      { label: 'cosφ (yük → bara)', value: fmt(v.load.cos, 3) + ' → ' + fmt(v.bus.pf, 3), sub: v.bus.Q < 0 ? 'kapasitif' : 'endüktif', level: lv(st('komp.cos')) },
      { label: 'Kompanzasyon', value: fmt(c.Qon, 0, 'kVAr'), sub: c.on.filter(Boolean).length + ' / ' + c.on.length + ' kademe · ' + { auto: 'otomatik', manual: 'elle', off: 'kapalı' }[s.comp.mode] },
      { label: 'Trafo yüklenmesi', value: '%' + fmt(t.k * 100, 1), sub: fmt(t.S, 0, 'kVA') + ' / ' + fmt(s.trafo.Sr_kVA, 0, 'kVA'), level: lv(st('trafo.load')) },
      { label: 'Bara akımı (en yüklü faz)', value: fmt(v.bus.I, 0, 'A'), sub: 'ACB Ir ' + fmt(v.bus.mainIr, 0, 'A'), level: lv(st('adp.main')) },
      { label: 'Trafo kaybı', value: fmt(t.losses / 1e3, 2, 'kW'), sub: v.day ? 'yıllık ≈ ' + VS.fmtEnergy(v.day.lossYear) + ' · ' + fmt(v.day.costYear, 0, 'TL') : '' },
      { label: 'Sıcak nokta (kararlı)', value: fmt(t.temps.hotSpot, 1, '°C'), sub: 'üst yağ ' + fmt(t.temps.topOil, 1, '°C'), level: lv(st('trafo.hs')) },
      { label: 'THDv (hesaplanan)', value: '%' + fmt(c.THDv, 2), sub: s.comp.detune > 0 ? 'ayarlı p %' + fmt(s.comp.detune, 2) : 'reaktörsüz', level: lv(st('komp.thdv') === 'ok' && st('komp.res') === 'fail' ? 'fail' : st('komp.thdv')) }
    ];
    if (T) out.push(
      { label: 'AG uç gerilimi', value: fmt(v.bus.U, 1, 'V'), sub: 'ε %' + fmt(v.bus.eps, 2), level: lv(st('trafo.u')) },
      { label: 'ADP barası Ik3', value: fmt(v.bus.Ik3 / 1e3, 2, 'kA'), sub: 'ip ' + fmt(v.bus.ip / 1e3, 1, 'kA') + ' · Icu ' + s.board.mainIcu_kA + ' kA', level: lv(st('adp.icu')) },
      { label: 'OG akımı I1', value: fmt(t.I1, 1, 'A'), sub: 'anma ' + fmt(t.I1n, 1, 'A') + ' @ ' + fmt(s.supply.U1_kV, 1, 'kV') },
      { label: 'Günlük reaktif oran', value: v.day ? 'End. %' + fmt(v.day.indPct, 1) + ' · Kap. %' + fmt(v.day.capPct, 1) : '—', sub: v.day ? 'sınır %' + v.day.limit.ind + ' / %' + v.day.limit.cap : '', level: lv(st('komp.day')) },
      { label: 'Paralel rezonans', value: 'h ≈ ' + fmt(c.hPar, 2), sub: s.comp.detune > 0 ? 'ayar f_r ≈ ' + fmt(50 * c.hRes, 0, 'Hz') : '√(Xc/Xs)', level: lv(st('komp.res') || st('komp.tune')) },
      { label: 'Kondansatör akımı', value: fmt(c.capOver, 2) + '×In', sub: 'sınır 1,3×In', level: lv(st('komp.capI')) },
      { label: 'Verim / K_opt', value: '%' + fmt(t.eff, 2), sub: 'K_opt %' + fmt(t.kOpt * 100, 0) },
      { label: 'Gerilim yükselmesi', value: '%' + fmt(c.rise, 2), sub: 'Qc/Sk, Sk ≈ ' + fmt(c.Sk / 1e3, 1, 'MVA') }
    );
    return out;
  }
  function charts(r, s) {
    const v = r.values, n = s.loads.length, out = [];
    const short = i => (n <= 5 && s.loads[i - 1] ? s.loads[i - 1].name.slice(0, 9) : String(i));
    out.push({ id: 'loads', title: 'Yük grupları: aktif ve reaktif güç (devredeki)', alt: 'Her yük grubunun devredeki aktif (kW) ve reaktif (kVAr) gücü.', height: 160,
      x: { min: 0.4, max: n + 0.6, ticks: v.loads.map((_, i) => i + 1), fmt: short, label: 'yük' }, y: { min: 0, label: 'kW · kVAr' },
      series: [{ name: 'P (kW)', color: 'amber', type: 'bar', width: 0.36, offset: -0.5, data: v.loads.map((x, i) => [i + 1, x.Pel]) }, { name: 'Q (kVAr)', color: 'cyan', type: 'bar', width: 0.36, offset: 0.5, data: v.loads.map((x, i) => [i + 1, x.Q]) }] });
    if (v.day) out.push({ id: 'day', title: 'Günlük profil: trafo yüklenmesi ve devredeki kompanzasyon', alt: F.SHIFTS[s.facility.shift] + ' profiliyle saatlik trafo yüklenmesi (%) ve devredeki kondansatör gücü (kVAr/10).', height: 160,
      x: { min: 0, max: 23, label: 'saat', fmt: h => String(h).padStart(2, '0') }, y: { min: 0, label: '%' },
      hLines: [{ y: 80, label: '%80', color: '#f59e0b' }, { y: 100, label: '%100', color: '#ef4444' }],
      series: [{ name: 'Trafo K (%)', color: 'amber', area: true, data: v.day.hours.map(x => [x.h, x.K * 100]) }, { name: 'Qc devrede (kVAr/10)', color: 'cyan', dash: [4, 3], data: v.day.hours.map(x => [x.h, x.Qc / 10]) }] });
    if (tech(s) && v.comp.spectrum.length) out.push({ id: 'harm', title: 'Harmonik akımlar: yük tarafı ve trafo tarafı', alt: 'Harmonik mertebesine göre yüklerin ürettiği ve trafodan akan harmonik akım (A).', height: 150,
      x: { min: 3, max: 21, ticks: F.ORDERS, label: 'h' }, y: { min: 0, label: 'A' },
      series: [{ name: 'Yük (A)', color: 'violet', type: 'bar', width: 0.3, offset: -0.5, data: v.comp.spectrum.map(x => [x.h, x.Iload]) }, { name: 'Trafo tarafı (A)', color: 'red', type: 'bar', width: 0.3, offset: 0.5, data: v.comp.spectrum.map(x => [x.h, x.Isupply]) }] });
    return out;
  }
  const tm = t => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function renderExtra(app, top, bottom) {
    const f = fab(app), s = app.state, r = app.validResult;
    if (!r) return;
    const v = r.values, T = tech(s);
    // üst: seçili ekipman + ortak hesap zinciri
    let h = '';
    if (f.sel) {
      const e = equip(app, f.sel);
      h += '<section class="vs-fab-card vs-fab-sel" aria-label="Seçili ekipman"><h3 class="vs-sub">Seçili ekipman</h3><strong>' + esc(e.title) + '</strong><ul>' + e.lines.map(x => '<li' + (/^✕/.test(x) ? ' data-s="fail"' : /^!/.test(x) ? ' data-s="warn"' : '') + '>' + esc(x) + '</li>').join('') + '</ul>' +
        '<div class="vs-btns">' + e.actions.map((a, i) => '<button type="button" class="vs-btn' + (a.variant ? ' vs-btn--' + a.variant : '') + '" data-fab-act="' + i + '">' + esc(a.label) + '</button>').join('') + '<button type="button" class="vs-btn" data-fab-act="x">Seçimi kaldır</button></div></section>';
    }
    h += '<section class="vs-fab-card" aria-labelledby="fab-chain-h"><h3 class="vs-sub" id="fab-chain-h">Ortak hesap zinciri</h3>' +
      '<p class="vs-small">' + (T ? 'Her aşama bir öncekinin sonucunu girdi olarak alır (E.pano · E.komp · E.trafo). Q işareti: + endüktif, − kapasitif.' : 'Bir yükü açıp kapattığınızda zincirin tüm halkaları aynı hesapla güncellenir: pano, kompanzasyon ve trafo aynı sayıları görür.') + '</p>' +
      '<table class="vs-fab-t"><thead><tr><th>Aşama</th><th>P (kW)</th><th>Q (kVAr)</th><th>Durum</th></tr></thead><tbody>' +
      v.chain.map(c => '<tr><td>' + esc(c.stage) + '</td><td>' + fmt(c.P, 1) + '</td><td>' + (c.Q === null ? '—' : fmt(c.Q, 1)) + '</td><td>' + esc(c.note.replace(/(\d)\.(\d)/g, '$1,$2')) + '</td></tr>').join('') + '</tbody></table></section>';
    if (T) {
      h += '<section class="vs-fab-card" aria-labelledby="fab-feed-h"><h3 class="vs-sub" id="fab-feed-h">Çıkışlar (ara sonuçlar)</h3><div class="vs-fab-scroll"><table class="vs-fab-t"><thead><tr><th>Yük</th><th>I (A)</th><th>Ib</th><th>In</th><th>Iz</th><th>ΔU %</th><th>Ik1 (A)</th><th></th></tr></thead><tbody>' +
        v.loads.map(x => '<tr data-s="' + x.status + '"' + (x.on ? '' : ' data-off="1"') + '><td>' + esc(x.name) + '</td><td>' + fmt(x.I, 0) + '</td><td>' + fmt(x.Ib, 0) + '</td><td>' + x.In + '</td><td>' + fmt(x.Iz, 0) + '</td><td>' + fmt(x.vd, 2) + '</td><td>' + fmt(x.Ik1, 0) + '</td><td aria-label="' + { ok: 'uygun', warn: 'uyarı', fail: 'uygun değil' }[x.status] + '">' + { ok: '✓', warn: '!', fail: '✕' }[x.status] + '</td></tr>').join('') +
        '</tbody></table></div></section>';
    }
    if (top._html !== h) { top._html = h; top.innerHTML = h; }
    if (!top._wired) {
      top._wired = true;
      top.addEventListener('click', e => {
        const b = e.target.closest('[data-fab-act]'); if (!b) return;
        const k = b.dataset.fabAct, key = fab(app).sel;
        if (k === 'x') { if (app.viewer) app.viewer.select(null); fab(app).sel = null; app.renderAnalysis(); if (app.mode === '2d') app.draw2d(); return; }
        const a = equip(app, key).actions[Number(k)]; if (!a) return;
        a.onClick(app); app.renderControls(); app.invalidate();
      });
    }
    // alt: A/B karşılaştırma, olay geçmişi, model sınırları
    let b = '<section class="vs-fab-card" aria-labelledby="fab-ab-h"><h3 class="vs-sub" id="fab-ab-h">A/B senaryo karşılaştırması</h3>' +
      '<p class="vs-small">İki senaryo bu sayfanın hesap motoruyla (sürüm ' + esc(E.version) + ') aynı birim ve varsayımlarla yeniden hesaplanır; saklanan sonuç kullanılmaz.</p>' +
      '<div class="vs-btns"><button type="button" class="vs-btn" data-ab="setA">Mevcut → A</button><button type="button" class="vs-btn" data-ab="setB">Mevcut → B</button>' +
      (f.ab.A ? '<button type="button" class="vs-btn" data-ab="openA">A’yı aç</button>' : '') + (f.ab.B ? '<button type="button" class="vs-btn" data-ab="openB">B’yi aç</button>' : '') +
      (f.ab.A || f.ab.B ? '<button type="button" class="vs-btn vs-btn--danger" data-ab="clear">Temizle</button>' : '') + '</div>';
    const A = f.ab.A, B = f.ab.B;
    if (A) {
      const sb = B ? B.state : F.scenarioOf(s), ck = JSON.stringify([A.state, sb]);
      if (f.cmpKey !== ck) { f.cmpKey = ck; f.cmp = F.compare(A.state, sb); } // aynı girdiyle yeniden hesaplanmaz
      const cmp = f.cmp;
      const nameB = B ? 'B' : 'Mevcut';
      b += '<p class="vs-small">A: ' + esc(A.name || tm(A.at)) + (B ? ' · B: ' + esc(B.name || tm(B.at)) : ' · B yok: A, mevcut durumla karşılaştırılıyor.') + (A.engine && A.engine !== E.version ? ' · A farklı motor sürümünde saklanmış; şimdiki motorla hesaplandı.' : '') + '</p>';
      if (!cmp.ok) b += '<p class="vs-note vs-note--warn">' + esc(cmp.errors.join(' ')) + '</p>';
      else {
        b += '<div class="vs-fab-scroll"><table class="vs-fab-t vs-fab-ab"><thead><tr><th>Büyüklük</th><th>A</th><th>' + nameB + '</th><th>Fark (' + nameB + '−A)</th></tr></thead><tbody>' +
          cmp.rows.map(x => '<tr><td>' + esc(x.label) + (x.unit ? ' <small>' + esc(x.unit) + '</small>' : '') + '</td><td' + (x.better === 'A' ? ' data-best="1"' : '') + '>' + fmt(x.a, x.d) + '</td><td' + (x.better === 'B' ? ' data-best="1"' : '') + '>' + fmt(x.b, x.d) + '</td><td>' + (Math.abs(x.delta) < Math.pow(10, -x.d) / 2 ? '—' : (x.delta > 0 ? '+' : '−') + fmt(Math.abs(x.delta), x.d)) + '</td></tr>').join('') +
          '</tbody></table></div><p class="vs-small">Girdi farkları: ' + (cmp.diff.length ? esc(cmp.diff.map(humanPath).join(' · ')) : 'yok') + '. Yeşil hücre, o büyüklükte daha elverişli olan senaryodur (yön her satırda tanımlıdır).</p>';
      }
    } else b += '<p class="vs-small">Önce mevcut durumu A olarak saklayın, sonra yük veya ekipmanı değiştirip B olarak saklayın.</p>';
    b += '</section>';
    b += '<section class="vs-fab-card" aria-labelledby="fab-log-h"><h3 class="vs-sub" id="fab-log-h">Olay geçmişi <small>(' + f.log.length + ')</small></h3>' +
      (f.log.length ? '<ol class="vs-fab-log" reversed>' + f.log.slice().reverse().slice(0, 60).map(e => '<li data-kind="' + esc(e.kind) + '"><time>' + tm(e.t) + '</time><span>' + esc(e.text) + (e.delta ? '<em>' + esc(e.delta) + '</em>' : '') + (e.notes && e.notes.length ? e.notes.map(n => '<i data-s="' + (/^Giderildi/.test(n) ? 'ok' : 'fail') + '">' + esc(n) + '</i>').join('') : '') + '</span></li>').join('') + '</ol>' +
        (f.log.length > 60 ? '<p class="vs-small">Son 60 olay gösteriliyor; tamamı JSON dışa aktarımda.</p>' : '') + '<div class="vs-btns"><button type="button" class="vs-btn" data-ab="clearLog">Geçmişi temizle</button></div>'
        : '<p class="vs-small">Henüz olay yok. Bir yükü açıp kapatın ya da bir ayarı değiştirin; değişiklik ve etkisi (yüklenme, cosφ, kademe) burada listelenir.</p>') + '</section>';
    if (T) b += '<section class="vs-fab-card"><h3 class="vs-sub">Model sınırları</h3><ul class="vs-fab-lim">' + r.limits.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></section>';
    if (bottom._html !== b) { bottom._html = b; bottom.innerHTML = b; }
    if (!bottom._wired) {
      bottom._wired = true;
      bottom.addEventListener('click', e => {
        const btn = e.target.closest('[data-ab]'); if (!btn) return;
        const k = btn.dataset.ab, F2 = fab(app);
        flush(app);
        if (k === 'setA' || k === 'setB') { const sl = k.slice(3); F2.ab[sl] = snapshot(app, facilityName(app.state) + ' · ' + tm(Date.now())); persist(app); pushLog(app, { kind: 'ab', text: 'Mevcut durum ' + sl + ' olarak saklandı' }); app.checkTasks(); }
        else if (k === 'openA' || k === 'openB') { const sl = k.slice(4); openSlot(app, F2.ab[sl], sl + ' senaryosu açıldı'); }
        else if (k === 'clear') { F2.ab = { A: null, B: null }; persist(app); }
        else if (k === 'clearLog') { F2.log = []; persist(app); }
        app.renderAnalysis();
      });
    }
  }
  function humanPath(p) {
    if (/^[+−]/.test(p) || !/\./.test(p)) return p;
    return LABELS[p] || p.replace(/^comp\./, 'kompanzasyon.').replace(/^board\./, 'pano.');
  }

  /* ---------------------------------------------------------------- 3D sahne */
  const SW = 0.8, PD = 0.6, PH = 2.0, PL = 0.1, RD = 5.2, RH = 3.6, HH = 7;
  function dims(s) {
    const n = s.loads.length, nk = s.comp.steps.length;
    const fs = Math.max(1, Math.ceil(n / 4)), ks = Math.max(1, Math.ceil(nk / 4));
    const sT = clamp(Math.cbrt((Number(s.trafo.Sr_kVA) || 630) / 630), 0.75, 1.6);
    const tL = 1.3 * sT, tW = 0.78 * sT, tH = 1.1 * sT, fd = 0.24 * sT;
    const bay = Math.max(3.6, tL + 2.4);
    const xl = bay + 0.9;                         // pano dizisinin başlangıcı
    const Ladp = SW * (1 + fs), Lk = SW * ks;
    const xr1 = xl + Ladp + 0.3 + Lk + 1.0;       // elektrik odası sonu = hol başlangıcı
    const cols = Math.max(2, Math.ceil(Math.sqrt(n * 1.3))), rows = Math.max(1, Math.ceil(n / cols));
    const cX = 6.5, cZ = 6.8, LH = cols * cX + 3, DH = Math.max(RD + 6, rows * cZ + 5);
    return { n: n, nk: nk, fs: fs, ks: ks, sT: sT, tL: tL, tW: tW, tH: tH, fd: fd, bay: bay, xl: xl, Ladp: Ladp, Lk: Lk, xk: xl + Ladp + 0.3, xr1: xr1, cols: cols, rows: rows, cX: cX, cZ: cZ, LH: LH, DH: DH, zp: -RD / 2 + 0.1 + PD / 2 };
  }
  function rebuildOn(s) { const d = dims(s); return [d.sT.toFixed(3), s.loads.map(l => l.id + ':' + (l.vis || l.type) + ':' + l.In).join(','), s.comp.steps.map(q => Math.round(q)).join(','), s.comp.detune > 0 ? 1 : 0, s.board.mainIn].join('|'); }
  function slotOf(d, i) { const c = i % d.cols, r = Math.floor(i / d.cols); return { x: d.xr1 + 1.5 + (c + 0.5) * d.cX, z: -d.DH / 2 + 3 + (r + 0.5) * d.cZ }; }
  function mccbSize(In) { return In <= 250 ? [0.105, 0.17, 0.1] : In <= 630 ? [0.14, 0.26, 0.11] : [0.21, 0.28, 0.12]; }
  function cylX(k, r, len, mat, x, y, z, parent) { const m = k.cyl(r, r, len, mat, x, y, z, parent); m.rotation.z = Math.PI / 2; return m; }
  function cylZ(k, r, len, mat, x, y, z, parent) { const m = k.cyl(r, r, len, mat, x, y, z, parent); m.rotation.x = Math.PI / 2; return m; }

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer, d = dims(s), f = fab(app);
    const sc = { flows: [], loads: {}, mccb: [], steps: [], doors: [], fans: [], labels: {}, sig: {} };
    app.scene3 = sc;
    const mat = (hex, o) => k.mat(hex, o);
    const steelBlue = mat(0x8794a3, { metalness: 0.5, roughness: 0.45 }), yellow = mat(0xf2c200, { roughness: 0.6 }), floorMat = mat(0x9ea3a6, { roughness: 0.85 });
    const xMax = d.xr1 + d.LH;

    /* --- zemin, oda ve hol yapısı (statik) */
    k.ground(Math.max(160, xMax * 4), mat(0x3d4f33, { roughness: 1 }), 0);
    const st = k.staticGroup(null, 0, 0, 0);
    k.box(xMax + 4, 0.04, d.DH + 6, M.asphalt, xMax / 2, 0.02, 0, st);
    k.box(d.xr1, 0.12, RD, M.concrete, d.xr1 / 2, 0.06, 0, st);                      // elektrik odası döşemesi
    k.box(d.LH, 0.12, d.DH, floorMat, d.xr1 + d.LH / 2, 0.06, 0, st);                  // hol döşemesi
    for (let c = 0; c <= d.cols; c++) k.box(0.08, 0.005, d.DH - 2, yellow, d.xr1 + 1.5 + c * d.cX, 0.123, 0, st); // yürüme yolu çizgileri
    k.box(d.LH - 1, 0.005, 0.08, yellow, d.xr1 + d.LH / 2, 0.123, -d.DH / 2 + 2.4, st);
    // oda duvarları: arka, sol, trafo bölme duvarı, hol duvarı; ön ve tavan açık (kesilmiş görünüm)
    k.box(d.xr1, RH, 0.2, M.wallPanel, d.xr1 / 2, RH / 2, -RD / 2 - 0.1, st);
    k.box(0.2, RH, RD, M.wallPanel, -0.1, RH / 2, 0, st);
    k.box(0.15, RH, RD - 1.6, M.concreteDark, d.bay, RH / 2, -0.8, st);
    k.box(0.2, RH, RD, M.wallPanel, d.xr1, RH / 2, 0, st); // oda–hol duvarı; üstü kesilmiş görünüm (hol oda üzerinden görünür)
    // hol: arka duvar, sol duvarın oda arkasındaki parçası, kolonlar ve çatı kirişleri (ön ve sağ cephe kesilmiş görünüm)
    k.box(d.LH, HH, 0.18, M.wallPanel, d.xr1 + d.LH / 2, HH / 2, -d.DH / 2, st);
    if (d.DH / 2 - RD / 2 > 0.1) k.box(0.18, HH, d.DH / 2 - RD / 2, M.wallPanel, d.xr1, HH / 2, (-d.DH / 2 - RD / 2) / 2, st);
    // arka cephe çelik kolonları (çatı, kirişler ve ön cephe kesilmiş görünümde gösterilmez; yalnız arka saçak kirişi)
    for (let x = d.xr1 + 6; x < xMax - 0.5; x += 6) k.box(0.3, HH, 0.3, steelBlue, x, HH / 2, -d.DH / 2 + 0.25, st);
    k.box(0.3, HH, 0.3, steelBlue, xMax - 0.15, HH / 2, -d.DH / 2 + 0.25, st);
    k.box(d.LH, 0.3, 0.22, steelBlue, d.xr1 + d.LH / 2, HH + 0.15, -d.DH / 2 + 0.25, st);
    const signRoom = k.screen(1.6, 0.28, 512, (g, w, h) => { g.fillStyle = '#0a1628'; g.fillRect(0, 0, w, h); g.fillStyle = '#fcd34d'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ELEKTRİK ODASI', w / 2, h / 2 + 2); }, null);
    signRoom.position.set(d.xl + 1.2, RH - 0.35, -RD / 2 + 0.005);

    /* --- trafo bölmesi: OG hücre, trafo, tel kafes kapı */
    const xT = d.bay / 2 + 0.2, zT = -0.35;
    const rmu = k.group(null, 0.75, 0.12, -RD / 2 + 0.5);
    k.box(1.2, 1.5, 0.75, M.panelRAL7035, 0, 0.75, 0, rmu);
    k.box(1.1, 0.5, 0.02, M.panelDark, 0, 1.05, 0.38, rmu);
    [-0.35, 0, 0.35].forEach(x => { k.box(0.16, 0.05, 0.03, M.plasticDark, x, 1.05, 0.4, rmu); k.sphere(0.012, M.ledGreen, x, 1.22, 0.39, rmu); });
    k.pickable(rmu, () => equip(app, 'og').title, () => equip(app, 'og').lines, null); v.pickables[v.pickables.length - 1].key = 'og';
    sc.labels.og = k.label('OG hücre', rmu, [0, 1.75, 0], 'vs-label--sm');
    const tr = k.group(null, xT, 0.12, zT); sc.tr = tr;
    const yT0 = 0.22, top = yT0 + d.tH;
    [-1, 1].forEach(j => k.box(d.tL * 0.95, 0.06, 0.08, M.darkSteel, 0, 0.03, j * d.tW * 0.32, tr));
    [-1, 1].forEach(i => [-1, 1].forEach(j => cylZ(k, 0.07, 0.05, M.darkSteel, i * d.tL * 0.36, 0.1, j * d.tW * 0.32, tr)));
    const tank = k.box(d.tL, d.tH, d.tW, M.trafoPaint, 0, yT0 + d.tH / 2, 0, tr); k.shell(tank);
    k.shell(k.box(d.tL + 0.06, 0.05, d.tW + 0.06, M.trafoPaint, 0, top + 0.025, 0, tr));
    const fins = [], tmp = { p: new T.Vector3(), s: new T.Vector3(), m: new T.Matrix4(), q: new T.Quaternion() };
    for (let x = -d.tL / 2 + 0.06; x <= d.tL / 2 - 0.06 + 1e-6; x += 0.055) { fins.push([x, -1]); fins.push([x, 1]); }
    const finIM = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), M.trafoPaint, fins.length);
    fins.forEach((fn, i) => { tmp.p.set(fn[0], yT0 + d.tH * 0.47, fn[1] * (d.tW / 2 + d.fd / 2)); tmp.s.set(0.012, d.tH * 0.84, d.fd); tmp.m.compose(tmp.p, tmp.q, tmp.s); finIM.setMatrixAt(i, tmp.m); });
    finIM.castShadow = finIM.receiveShadow = true; finIM.frustumCulled = false; tr.add(finIM); k.shell(finIM);
    // iç: nüve ve sargılar (kesit/şeffaf görünümde); sargı rengi kararlı sıcak nokta tahminini gösterir
    sc.wMat = mat(0xc77b4a, { metalness: 0.9, roughness: 0.35 });
    const core = k.group(tr, 0, 0, 0);
    k.box(d.tL * 0.82, 0.12, 0.16, M.darkSteel, 0, yT0 + 0.1, 0, core);
    k.box(d.tL * 0.82, 0.12, 0.16, M.darkSteel, 0, yT0 + d.tH * 0.86, 0, core);
    [-1, 0, 1].forEach(i => { k.cyl(d.tW * 0.21, d.tW * 0.21, d.tH * 0.66, sc.wMat, i * d.tL * 0.29, yT0 + d.tH * 0.48, 0, core); k.cyl(d.tW * 0.1, d.tW * 0.1, d.tH * 0.78, M.darkSteel, i * d.tL * 0.29, yT0 + d.tH * 0.48, 0, core); });
    const bush = k.group(tr, 0, 0, 0), mvTop = [], lvTop = [];
    [-1, 0, 1].forEach(i => { const bx = i * d.tL * 0.28, bz = -d.tW * 0.24; k.cyl(0.035, 0.035, 0.44, M.porcelainGrey, bx, top + 0.27, bz, bush); for (let j = 0; j < 5; j++) k.cyl(0.075, 0.075, 0.016, M.porcelainGrey, bx, top + 0.1 + j * 0.075, bz, bush); mvTop.push([xT + bx, 0.12 + top + 0.5, zT + bz]); });
    [-1.5, -0.5, 0.5, 1.5].forEach(i => { const bx = i * d.tL * 0.18, bz = d.tW * 0.27; k.cyl(0.032, 0.032, 0.18, M.porcelainGrey, bx, top + 0.11, bz, bush); k.box(0.06, 0.12, 0.014, M.copper, bx, top + 0.26, bz, bush); lvTop.push([xT + bx, 0.12 + top + 0.3, zT + bz]); });
    const cons = k.group(tr, d.tL / 2 - 0.12, top + 0.42 * d.sT, 0);
    cylZ(k, 0.12 * d.sT, d.tW * 0.9, M.trafoPaint, 0, 0, 0, cons);
    [-1, 1].forEach(j => k.box(0.04, 0.42 * d.sT, 0.04, M.darkSteel, 0, -0.21 * d.sT, j * d.tW * 0.3, cons));
    const plate = k.screen(0.3, 0.2, 384, (g, w, h) => { g.fillStyle = '#d9dde2'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = 'bold 30px Arial'; g.fillText('GÜÇ TRAFOSU', 14, 40); g.font = '24px Arial'; [Math.round(s.trafo.Sr_kVA) + ' kVA · ' + fmt(s.supply.U1_kV, 1) + '/0,4 kV', 'uk %' + fmt(s.trafo.uk, 1) + ' · Dyn11 · ONAN', 'P0 ' + s.trafo.P0 + ' W · Pk ' + s.trafo.Pk + ' W'].forEach((t, i) => g.fillText(t, 14, 90 + i * 34)); }, tr);
    plate.position.set(-d.tL / 2 + 0.25, yT0 + d.tH * 0.55, d.tW / 2 + 0.004);
    k.pickable(tr, () => equip(app, 'trafo').title, () => equip(app, 'trafo').lines, () => equip(app, 'trafo').actions); v.pickables[v.pickables.length - 1].key = 'trafo';
    sc.labels.trafo = k.label('Trafo', tr, [0, top + 1.0, 0]);
    // OG kabloları: hücreden trafoya (kanal içinden)
    const mvCab = mat(0x8c1c1c, { roughness: 0.6 });
    mvTop.forEach((b, j) => {
      const t1 = k.tube([[0.75 + (j - 1) * 0.12, 0.3, -RD / 2 + 0.8], [0.9 + (j - 1) * 0.12, 0.16, -RD / 2 + 1.3], [b[0], 0.16, b[2] - 0.4], [b[0], Math.max(b[1] + 0.2, 1.6), b[2] - 0.3], [b[0], b[1] + 0.1, b[2] - 0.05], [b[0], b[1], b[2]]], 0.022, mvCab, null, 60);
      if (j === 1) sc.flows.push({ f: k.flow(t1.userData.curve, 14, 0xfcd34d, 0.018), kind: 'mv' });
    });
    // tel kafes bölme kapısı (menteşeli)
    const fz = 1.4, fence = k.group(null, 0, 0, 0);
    const meshMat = mat(0x8a939c, { metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.35 });
    k.box(0.06, 2.2, 0.06, M.galv, 0.05, 1.22, fz, fence); k.box(0.06, 2.2, 0.06, M.galv, d.bay - 0.05, 1.22, fz, fence);
    k.box(d.bay - 1.3, 2.1, 0.02, meshMat, 0.1 + (d.bay - 1.3) / 2, 1.17, fz, fence);
    const piv = k.group(null, d.bay - 1.2, 0.12, fz);
    k.box(1.1, 2.05, 0.02, meshMat, 0.55, 1.05, 0, piv); k.box(1.1, 0.04, 0.04, M.galv, 0.55, 2.06, 0, piv); k.box(1.1, 0.04, 0.04, M.galv, 0.55, 0.04, 0, piv);
    const warn = k.screen(0.3, 0.26, 128, drawWarn, piv); warn.position.set(0.55, 1.5, 0.02);
    k.shell(piv); sc.doors.push({ g: piv, which: 'trafo', open: -1.6 });
    // AG: trafo → ADP giriş (bölme duvarının üstünden kablo merdiveni)
    const xInc = d.xl + SW / 2;
    k.box(d.xl + 0.2 - xT, 0.06, 0.5, M.galv, (xT + d.xl + 0.2) / 2, RH - 0.45, -1.3, st);
    lvTop.forEach((b, j) => {
      const off = (j - 1.5) * 0.09;
      const t = k.tube([[b[0], b[1], b[2]], [b[0], RH - 0.7, b[2] - 0.15], [b[0] + 0.1, RH - 0.4, -1.3 + off], [d.bay + 0.4, RH - 0.4, -1.3 + off], [xInc - 0.1 + off, RH - 0.4, -1.3 + off], [xInc + off, PL + PH + 0.25, d.zp + 0.05], [xInc + off, PL + PH - 0.05, d.zp]], 0.03, M.cableBlack, null, 90);
      if (j === 0) sc.flows.push({ f: k.flow(t.userData.curve, 22, 0xfcd34d, 0.022), kind: 'lv' });
    });

    /* --- ADP dizisi (giriş + çıkış bölmeleri) ve kompanzasyon panosu */
    const adp = k.group(null, d.xl, 0, d.zp); sc.adp = adp;
    const panelBody = (g, x0, n, tint) => {
      k.box(SW * n, PL, PD, M.plasticDark, x0 + SW * n / 2, PL / 2, 0, g);
      k.box(SW * n, PH, 0.02, M.panelRAL7035, x0 + SW * n / 2, PL + PH / 2, -PD / 2 + 0.01, g);
      k.box(SW * n, 0.03, PD, M.panelRAL7035, x0 + SW * n / 2, PL + PH, 0, g);
      for (let i = 0; i <= n; i++) k.box(0.02, PH, PD, M.panelRAL7035, x0 + i * SW, PL + PH / 2, 0, g);
      k.box(SW * n - 0.04, PH - 0.1, 0.01, M.galv, x0 + SW * n / 2, PL + PH / 2, -PD / 2 + 0.03, g);
      if (tint) k.box(SW * n, 0.06, 0.005, tint, x0 + SW * n / 2, PL + PH - 0.05, PD / 2 + 0.002, g);
    };
    panelBody(adp, 0, 1 + d.fs, null);
    // bara: yatay (L1 L2 L3 N) ve çıkış bölmelerinde dikey dağıtım baraları
    ['L1', 'L2', 'L3', 'N'].forEach((p, j) => k.box(SW * (1 + d.fs) - 0.1, 0.05, 0.01, M.copper, SW * (1 + d.fs) / 2, PL + PH - 0.22 - j * 0.07, -PD / 2 + 0.1, adp));
    for (let i = 0; i < d.fs; i++) [0, 1, 2].forEach(j => k.box(0.03, PH - 0.5, 0.01, M.copper, SW * (1 + i) + 0.12 + j * 0.05, PL + (PH - 0.5) / 2 + 0.05, -PD / 2 + 0.13, adp));
    // giriş: ACB
    const acb = k.group(adp, SW / 2, PL + 1.0, -0.05);
    k.rbox(0.42, 0.42, 0.34, 0.02, M.plasticDark, 0, 0, 0, acb);
    k.box(0.34, 0.28, 0.02, M.plasticGrey, 0, 0, 0.18, acb);
    sc.acbLed = k.sphere(0.012, M.ledGreen, 0.14, 0.15, 0.19, acb);
    k.box(0.05, 0.08, 0.04, M.plasticBlue, -0.1, -0.03, 0.2, acb);
    // çıkış MCCB'leri: bölme başına 4, In'e göre çerçeve boyu; kol konumu açık/kapalı durumunu gösterir
    s.loads.forEach((l, i) => {
      const sec = Math.floor(i / 4), row = i % 4, sz = mccbSize(l.In);
      const g = k.group(adp, SW * (1 + sec) + SW / 2 + 0.08, PL + PH - 0.62 - row * 0.4, -0.02);
      k.rbox(sz[0], sz[1], sz[2], 0.008, M.plasticDark, 0, 0, 0, g);
      k.box(sz[0] * 0.7, sz[1] * 0.35, 0.01, M.plasticGrey, 0, -sz[1] * 0.2, sz[2] / 2 + 0.002, g);
      const h = k.box(0.025, 0.05, 0.03, M.plasticBlue, 0, 0.02, sz[2] / 2 + 0.02, g);
      const led = k.sphere(0.008, M.ledOff, sz[0] * 0.32, sz[1] * 0.38, sz[2] / 2 + 0.004, g);
      k.cyl(0.012, 0.012, 0.2, M.cableBlack, 0, sz[1] / 2 + 0.1, -0.02, g);
      sc.mccb.push({ id: l.id, h: h, led: led, y0: 0.02, sz: sz, x: d.xl + SW * (1 + sec) + SW / 2 + 0.08 });
      k.pickable(g, () => 'MCCB ' + l.In + ' A · ' + (app.state.loads.find(x => x.id === l.id) || l).name, () => equip(app, 'load:' + l.id).lines, () => equip(app, 'load:' + l.id).actions);
      v.pickables[v.pickables.length - 1].key = 'load:' + l.id;
    });
    // kapaklar (menteşeli; ön kapak giriş bölmesinde hesaplanan değer ekranı)
    for (let i = 0; i < 1 + d.fs; i++) {
      const piv2 = k.group(adp, i * SW + 0.01, PL, PD / 2 + 0.01);
      k.box(SW - 0.03, PH - 0.02, 0.02, M.panelRAL7035, SW / 2 - 0.01, PH / 2, 0, piv2);
      k.box(0.02, 0.12, 0.03, M.plasticDark, SW - 0.08, PH / 2, 0.02, piv2);
      if (i === 0) { const scr = k.screen(0.16, 0.13, 256, (g, w, h) => drawMeter(g, w, h, app), piv2, { emissive: 0.85 }); scr.position.set(SW / 2, PH * 0.78, 0.012); sc.meter = scr; }
      else { const lab = k.screen(0.36, 0.07, 256, (g, w, h) => { g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.font = 'bold 26px Arial'; g.textBaseline = 'middle'; g.fillText('ÇIKIŞ ' + (4 * (i - 1) + 1) + '–' + Math.min(d.n, 4 * i), 10, h / 2); }, piv2); lab.position.set(SW / 2, PH * 0.88, 0.012); }
      k.shell(piv2); sc.doors.push({ g: piv2, which: 'adp', open: -1.75 });
    }
    k.pickable(adp, () => equip(app, 'adp').title, () => equip(app, 'adp').lines, () => equip(app, 'adp').actions); v.pickables[v.pickables.length - 1].key = 'adp';
    sc.labels.adp = k.label('ADP', adp, [SW * (1 + d.fs) / 2, PL + PH + 0.45, 0]);

    const kp = k.group(null, d.xk, 0, d.zp); sc.kp = kp;
    panelBody(kp, 0, d.ks, null);
    const capMat = M.alu, reMat = mat(0x3b3f46, { metalness: 0.5, roughness: 0.5 });
    s.comp.steps.forEach((q, j) => {
      const sec = Math.floor(j / 4), row = j % 4, x0 = sec * SW + 0.08, y = PL + 0.2 + row * 0.44;
      k.box(SW - 0.06, 0.02, PD - 0.12, M.galv, sec * SW + SW / 2, y, 0, kp);
      const cans = clamp(Math.round(q / 25), 1, 4);
      for (let c = 0; c < cans; c++) k.cyl(0.058, 0.058, 0.23, capMat, x0 + 0.42 + c * 0.075, y + 0.13, -0.05, kp);
      if (s.comp.detune > 0) { k.box(0.22, 0.2, 0.18, reMat, x0 + 0.13, y + 0.12, -0.05, kp); [-0.05, 0.05].forEach(o => cylZ(k, 0.05, 0.16, M.copper, x0 + 0.13 + o, y + 0.12, -0.05, kp)); }
      k.box(0.08, 0.12, 0.1, M.plasticGrey, x0 + 0.3, y + 0.33, 0.1, kp);
      // kontaktör ön göstergesi: kapalı (kademe devrede) yeşil, açık gri
      const ct = k.box(0.05, 0.03, 0.006, M.plasticDark, x0 + 0.3, y + 0.36, 0.153, kp);
      const led = k.sphere(0.009, M.ledOff, x0 + 0.3, y + 0.41, 0.152, kp);
      sc.steps.push({ ct: ct, led: led, y: y + 0.33 });
    });
    for (let i = 0; i < d.ks; i++) {
      const piv3 = k.group(kp, i * SW + 0.01, PL, PD / 2 + 0.01);
      k.box(SW - 0.03, PH - 0.02, 0.02, M.panelRAL7035, SW / 2 - 0.01, PH / 2, 0, piv3);
      k.box(0.5, 0.22, 0.005, mat(0x30363d, { roughness: 0.7 }), SW / 2, 0.25, 0.012, piv3); // havalandırma ızgarası
      if (i === 0) { const rel = k.screen(0.14, 0.14, 256, (g, w, h) => drawRelay(g, w, h, app), piv3, { emissive: 0.85 }); rel.position.set(SW / 2, PH * 0.78, 0.012); sc.relay = rel; }
      k.shell(piv3); sc.doors.push({ g: piv3, which: 'komp', open: -1.75 });
    }
    k.pickable(kp, () => equip(app, 'komp').title, () => equip(app, 'komp').lines, () => equip(app, 'komp').actions); v.pickables[v.pickables.length - 1].key = 'komp';
    sc.labels.komp = k.label('Kompanzasyon', kp, [SW * d.ks / 2, PL + PH + 0.45, 0]);
    // ADP ↔ kompanzasyon bağlantısı (üstten)
    const kc = k.tube([[SW * 0.5 + d.xl, PL + PH + 0.02, d.zp - 0.1], [d.xl + SW * 0.6, PL + PH + 0.3, d.zp - 0.1], [d.xk + 0.3, PL + PH + 0.3, d.zp - 0.1], [d.xk + 0.35, PL + PH + 0.02, d.zp - 0.1]], 0.03, M.cableBlack, null, 30);
    sc.flows.push({ f: k.flow(kc.userData.curve, 12, 0x22d3ee, 0.022), kind: 'komp' });

    /* --- kablo tavaları ve yük kabloları */
    const yR = RH - 0.4, yH = 4.6, zt = d.zp;
    k.box(d.xr1 - d.xl + 0.4, 0.06, 0.6, M.galv, (d.xl + d.xr1) / 2, yR, zt, st);
    k.box(d.LH - 1.5, 0.06, 0.6, M.galv, d.xr1 + d.LH / 2 - 0.2, yH, zt, st);
    for (let c = 0; c < d.cols; c++) k.box(0.45, 0.06, d.DH - 4, M.galv, d.xr1 + 1.5 + c * d.cX + 0.6, yH, -0.5, st);
    s.loads.forEach((l, i) => {
      const m = sc.mccb[i], p = slotOf(d, i), off = (i - d.n / 2) * 0.045, bx = d.xr1 + 1.5 + (i % d.cols) * d.cX + 0.6 + off * 0.5;
      const hTop = machineTop(l);
      const pts = [[m.x, PL + PH - 0.5 - (i % 4) * 0.4, d.zp - 0.12], [m.x, PL + PH + 0.25, d.zp - 0.12], [m.x + 0.05, yR + 0.05, zt + off], [d.xr1 - 0.3, yR + 0.05, zt + off], [d.xr1 + 0.6, yH + 0.05, zt + off], [bx, yH + 0.05, zt + off], [bx, yH + 0.05, p.z - 0.6], [bx + 0.3, yH - 0.2, p.z - 0.4], [p.x - 0.4, Math.max(hTop + 0.6, 2.6), p.z - 0.4], [p.x - 0.4, hTop + 0.1, p.z - 0.4]];
      const t = k.tube(pts, 0.022, M.cableBlack, null, 120);
      sc.flows.push({ f: k.flow(t.userData.curve, 20, 0xfcd34d, 0.02), kind: 'load', id: l.id });
    });

    /* --- yükler (makineler) */
    s.loads.forEach((l, i) => {
      const p = slotOf(d, i), g = k.group(null, p.x, 0.12, p.z);
      const parts = buildMachine(k, g, l, sc, mat);
      sc.loads[l.id] = parts;
      k.pickable(g, () => equip(app, 'load:' + l.id).title, () => equip(app, 'load:' + l.id).lines, () => equip(app, 'load:' + l.id).actions); v.pickables[v.pickables.length - 1].key = 'load:' + l.id;
      parts.label = k.label(l.name, g, [0, parts.h + 0.6, 0], 'vs-label--sm');
    });
    // hol aydınlatma armatürleri (aydınlatma yükü devredeyse yanar)
    const lit = s.loads.find(l => l.type === 'lighting');
    const fx = [];
    for (let x = d.xr1 + 3; x < xMax - 1; x += 4.5) for (let z = -d.DH / 2 + 2.5; z < d.DH / 2 - 1; z += 4.5) fx.push([x, z]);
    for (let z = -d.DH / 2 + 2.5; z < d.DH / 2 - 1; z += 4.5) k.box(d.LH - 1, 0.05, 0.05, M.galv, d.xr1 + d.LH / 2, HH - 0.8, z, st); // armatür taşıyıcı rayları
    sc.lampMat = mat(0xeef2f5, { emissive: 0xfff3d6, emissiveIntensity: 0, roughness: 0.4 });
    const lampGeo = new T.CylinderGeometry(0.28, 0.34, 0.16, 16);
    const lamps = new T.InstancedMesh(lampGeo, sc.lampMat, fx.length);
    fx.forEach((q, i) => { tmp.p.set(q[0], HH - 0.9, q[1]); tmp.s.set(1, 1, 1); tmp.m.compose(tmp.p, tmp.q, tmp.s); lamps.setMatrixAt(i, tmp.m); });
    lamps.castShadow = false; lamps.frustumCulled = false; k.viewer.root.add(lamps);
    if (lit) { k.pickable(lamps, () => equip(app, 'load:' + lit.id).title, () => equip(app, 'load:' + lit.id).lines, () => equip(app, 'load:' + lit.id).actions); v.pickables[v.pickables.length - 1].key = 'load:' + lit.id; }
    sc.lightId = lit ? lit.id : null;

    /* --- görünüm, kesit düzlemi (önden arkaya), gölge */
    v.clipPlane.normal.set(0, 0, -1);
    app.def.scene.bounds = [-RD / 2 - 0.3, RD / 2 + 0.6];
    // varsayılan kamera: önden ve sağdan; elektrik odası (trafo, ADP, kompanzasyon) ve hol birlikte görünür
    const cx = xMax * 0.47, vkey = xMax.toFixed(1) + '|' + d.DH.toFixed(1);
    if (v.__fabKey !== vkey) {
      v.__fabKey = vkey;
      v.setView({ target: [d.xr1 + 0.6, 0, 0.5], r: Math.max(16, xMax * 0.6), theta: 0.38, phi: 0.98, limits: { rMin: 1.2, rMax: Math.max(60, xMax * 2.2), phiMax: 1.5 } });
    }
    v.setShadowBox(Math.max(14, xMax * 0.6), 90);
    v.sun.position.set(cx + 10, 22, 14); v.sun.target.position.set(cx, 0, 0); v.sun.target.updateMatrixWorld();
    // kapak açıları anında yerine (yeniden kurulumda animasyonsuz)
    sc.doors.forEach(dr => { dr.g.rotation.y = f.doors[dr.which] ? dr.open : 0; });
    ensureLegend(app);
  }
  function machineTop(l) { return { press: 3.2, compressor: 1.8, extruder: 2.0, pump: 1.4, cnc: 2.5, furnace: 2.4, lighting: 1.6, chiller: 2.1, generic: 1.6 }[l.vis || F.LOAD_TYPES[l.type].vis] || 1.6; }
  /** Makineler: gerçek ölçeğe yakın, tipik yerleşim (temsilî). Dönüş: durum gösterimi için parçalar. */
  function buildMachine(k, g, l, sc, mat) {
    const M = k.mats, vis = l.vis || F.LOAD_TYPES[l.type].vis, out = { h: machineTop(l), fans: [], glow: null };
    const body = k.staticGroup(g, 0, 0, 0);
    const paint = { press: 0x2f6db5, compressor: 0x1f7a5c, extruder: 0x6b7280, pump: 0x2563eb, cnc: 0xe5e7eb, furnace: 0x4b5563, lighting: 0xd7d9d6, chiller: 0xe2e8f0, generic: 0x64748b }[vis] || 0x64748b;
    const P = mat(paint, { metalness: 0.35, roughness: 0.45 });
    const motor = (x, y, z, r, len, parent) => { cylX(k, r, len, M.darkSteel, x, y, z, parent || body); cylX(k, r * 1.05, len * 0.25, M.steel, x - len * 0.55, y, z, parent || body); k.box(r * 0.8, r * 0.5, r * 0.8, M.darkSteel, x, y + r * 1.1, z, parent || body); };
    if (vis === 'press') {
      k.box(2.0, 0.3, 1.4, M.darkSteel, 0, 0.15, 0, body);
      [-0.75, 0.75].forEach(x => k.box(0.28, 2.6, 0.5, P, x, 1.6, 0, body));
      k.box(1.9, 0.5, 0.9, P, 0, 3.0, 0, body);
      k.box(1.2, 0.35, 0.7, M.steel, 0, 1.95, 0, body);
      k.box(1.5, 0.2, 0.9, M.darkSteel, 0, 0.95, 0, body);
      k.box(0.9, 0.6, 0.6, P, 1.55, 0.3, -0.3, body); motor(1.55, 0.78, -0.3, 0.16, 0.45);
    } else if (vis === 'compressor') {
      k.rbox(2.0, 1.7, 1.1, 0.04, P, 0, 0.85, 0, body);
      k.box(0.8, 0.9, 0.01, M.darkSteel, -0.45, 0.75, 0.556, body);
      k.cyl(0.42, 0.42, 1.6, M.galv, 1.7, 0.95, -0.1, body);
      k.sphere(0.42, M.galv, 1.7, 1.75, -0.1, body); k.sphere(0.42, M.galv, 1.7, 0.15, -0.1, body);
    } else if (vis === 'extruder') {
      k.box(5.0, 0.8, 0.9, M.darkSteel, 0, 0.4, 0, body);
      cylX(k, 0.18, 3.8, M.steel, 0.4, 1.25, 0, body);
      for (let x = -1.0; x <= 2.0; x += 0.5) cylX(k, 0.24, 0.3, mat(0x9a3412, { roughness: 0.5 }), x, 1.25, 0, body);
      k.cyl(0.45, 0.12, 0.6, M.steel, -1.3, 1.85, 0, body);
      k.box(0.8, 0.8, 0.8, P, -2.0, 1.2, 0, body); motor(-2.85, 1.2, 0, 0.3, 0.9);
      k.box(0.8, 2.0, 0.6, M.panelRAL7035, -2.2, 1.0, -1.3, body);
    } else if (vis === 'pump') {
      k.box(2.6, 0.2, 1.2, M.darkSteel, 0, 0.1, 0, body);
      [-0.6, 0.6].forEach(x => { motor(x - 0.25, 0.45, 0.2, 0.2, 0.6); k.cyl(0.24, 0.24, 0.2, P, x + 0.35, 0.45, 0.2, body); k.cyl(0.08, 0.08, 0.7, P, x + 0.35, 0.85, 0.2, body); });
      cylX(k, 0.12, 2.6, P, 0, 1.25, 0.2, body);
      k.box(0.6, 1.8, 0.5, M.panelRAL7035, 0, 0.9, -0.85, body);
    } else if (vis === 'cnc') {
      k.rbox(2.6, 2.3, 2.0, 0.06, P, 0, 1.15, 0, body);
      k.box(2.62, 0.25, 2.02, M.plasticBlue, 0, 2.2, 0, body);
      k.box(1.1, 0.7, 0.02, M.glass, -0.25, 1.35, 1.01, body);
      k.box(0.45, 0.6, 0.25, M.plasticDark, 1.05, 1.5, 1.05, body);
      k.box(0.6, 0.6, 1.4, M.darkSteel, -1.6, 0.3, 0, body);
    } else if (vis === 'furnace') {
      k.box(2.4, 2.2, 2.0, P, 0, 1.1, 0, body);
      k.box(1.5, 1.2, 0.08, M.darkSteel, 0, 1.0, 1.04, body);
      k.cyl(0.18, 0.18, 0.8, M.steel, 0.7, 2.6, -0.5, body);
      k.box(0.8, 1.8, 0.5, M.panelRAL7035, 1.8, 0.9, 0, body);
      out.glowMat = mat(0x1a0a05, { emissive: 0xff5a1f, emissiveIntensity: 0, roughness: 0.6 });
      out.glow = k.box(1.3, 0.12, 0.02, out.glowMat, 0, 0.42, 1.09, g); // kapı altı aralığı: fırın devredeyken (ısıtıcılar enerjili) parlar
    } else if (vis === 'lighting') {
      k.box(0.08, 1.4, 0.08, M.galv, 0, 0.7, -0.1, body);
      k.box(0.6, 0.9, 0.25, M.panelRAL7035, 0, 1.15, 0, body);
    } else if (vis === 'chiller') {
      k.box(3.2, 0.2, 1.3, M.darkSteel, 0, 0.1, 0, body);
      k.box(3.0, 1.5, 1.2, P, 0, 0.95, 0, body);
      k.box(2.9, 0.3, 1.1, M.galv, 0, 1.85, 0, body);
      [-1, 0, 1].forEach(i => { const fan = k.group(g, i * 0.95, 2.05, 0); k.cyl(0.36, 0.36, 0.06, M.darkSteel, 0, 0, 0, fan); [0, 1, 2].forEach(b => { const bl = k.box(0.62, 0.012, 0.1, M.steel, 0, 0.04, 0, fan); bl.rotation.y = b * Math.PI / 3; }); out.fans.push(fan); });
    } else {
      k.box(2.0, 1.5, 1.2, P, 0, 0.75, 0, body); motor(1.3, 0.4, 0, 0.18, 0.5);
    }
    // durum lambası (devrede: yeşil, devre dışı: sönük)
    k.box(0.04, 0.5, 0.04, M.galv, -0.5, out.h + 0.25, 0.3, body);
    out.beacon = k.sphere(0.06, M.ledOff, -0.5, out.h + 0.55, 0.3, g);
    return out;
  }
  function drawWarn(g, w, h) { g.fillStyle = '#f2c200'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.beginPath(); g.moveTo(w / 2, 10); g.lineTo(w - 12, h * 0.62); g.lineTo(12, h * 0.62); g.closePath(); g.fill(); g.fillStyle = '#f2c200'; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.fillText('⚡', w / 2, h * 0.52); g.fillStyle = '#111'; g.font = 'bold 16px Arial'; g.fillText('YÜKSEK GERİLİM', w / 2, h * 0.86); }
  function drawMeter(g, w, h, app) {
    const r = app.validResult; g.fillStyle = '#0b1724'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7dd3fc'; g.font = 'bold 18px Arial'; g.fillText('HESAP (ölçüm değil)', 10, 24);
    if (!r) return; const v = r.values;
    g.fillStyle = '#e6eef8'; g.font = 'bold 28px Arial';
    g.fillText('P ' + fmt(v.bus.P, 0) + ' kW', 10, 70); g.fillText('I ' + fmt(v.bus.I, 0) + ' A', 10, 112);
    g.fillStyle = v.bus.Q < 0 ? '#fca5a5' : '#86efac'; g.fillText('cosφ ' + fmt(v.bus.pf, 3), 10, 154);
    g.fillStyle = '#94a3b8'; g.font = '18px Arial'; g.fillText('U ≈ ' + fmt(v.bus.U, 0) + ' V', 10, 190);
  }
  function drawRelay(g, w, h, app) {
    const r = app.validResult; g.fillStyle = '#0b1724'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7dd3fc'; g.font = 'bold 18px Arial'; g.fillText('REAKTİF RÖLE', 10, 24);
    if (!r) return; const v = r.values, on = v.comp.on;
    g.fillStyle = '#e6eef8'; g.font = 'bold 34px Arial'; g.fillText(fmt(v.bus.pf, 3) + (v.bus.Q < 0 ? ' C' : ' i'), 10, 80);
    g.font = '18px Arial'; g.fillStyle = '#94a3b8'; g.fillText({ auto: 'OTOMATİK', manual: 'ELLE', off: 'KAPALI' }[app.state.comp.mode] + ' · ' + fmt(v.comp.Qon, 0) + ' kVAr', 10, 112);
    const n = on.length, bw = Math.min(26, (w - 20) / Math.max(1, n) - 4);
    on.forEach((x, i) => { g.fillStyle = x ? '#10b981' : '#334155'; g.fillRect(10 + i * (bw + 4), 140, bw, 26); });
  }
  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values, M = k.mats, lv = st => (st === 'fail' ? 'bad' : st === 'warn' ? 'warn' : 'ok');
    const st = id => (res.checks.find(c => c.id === id) || {}).status;
    const area = a => res.checks.filter(c => c.area === a).reduce((m, c) => (c.status === 'fail' ? 'fail' : m === 'fail' ? m : c.status === 'warn' ? 'warn' : m), 'ok');
    sc.labels.trafo.set('Trafo ' + fmt(s.trafo.Sr_kVA, 0) + ' kVA · %' + fmt(v.trafo.k * 100, 0)); sc.labels.trafo.level(lv(area('trafo')));
    sc.labels.adp.set('ADP · ' + fmt(v.bus.I, 0, 'A')); sc.labels.adp.level(lv(area('adp')));
    sc.labels.komp.set('Komp. ' + fmt(v.comp.Qon, 0) + '/' + fmt(v.comp.Qtot, 0) + ' kVAr'); sc.labels.komp.level(lv(area('komp')));
    s.loads.forEach((l, i) => {
      const p = sc.loads[l.id], x = v.loads[i]; if (!p || !x) return;
      p.label.set(l.name + ' · ' + (l.on ? fmt(x.Pel, 0, 'kW') : 'kapalı')); p.label.level(l.on ? lv(x.status) : '');
      p.beacon.material = l.on ? M.ledGreen : M.ledOff;
      if (p.glowMat) p.glowMat.emissiveIntensity = l.on ? 2.2 : 0;
      p.on = l.on;
    });
    sc.mccb.forEach(m => { const l = s.loads.find(x => x.id === m.id); if (!l) return; m.h.position.y = l.on ? m.y0 + 0.02 : m.y0 - 0.025; m.led.material = l.on ? M.ledGreen : M.ledOff; });
    sc.steps.forEach((x, j) => { const on = !!v.comp.on[j]; x.led.material = on ? M.ledGreen : M.ledOff; x.ct.material = on ? M.plasticGreen : M.plasticDark; });
    if (sc.lampMat) { const l = sc.lightId && s.loads.find(x => x.id === sc.lightId); sc.lampMat.emissiveIntensity = l && l.on ? 1.6 : 0; }
    // sargı rengi: kararlı sıcak nokta (60 °C mavi → 120 °C kırmızı); yalnız kesit/şeffaf görünümde görünür
    k.heat((v.trafo.temps.hotSpot - 60) / 60, sc.wMat.emissive || (sc.wMat.emissive = new k.T.Color())); sc.wMat.emissiveIntensity = 0.35;
    // akışlar: hız hesaplanan akımın anma değerine oranı (görsel ölçek); akım yoksa görünmez
    sc.flows.forEach(fl => {
      let r = 0;
      if (fl.kind === 'load') { const i = s.loads.findIndex(l => l.id === fl.id), x = v.loads[i]; r = x && x.on && x.In > 0 ? x.I / x.In : 0; }
      else if (fl.kind === 'lv' || fl.kind === 'mv') r = v.trafo.k;
      else if (fl.kind === 'komp') r = v.comp.Qtot > 0 ? v.comp.Qon / v.comp.Qtot : 0;
      fl.f.speed = r > 0.001 ? 0.05 + 0.35 * Math.min(1.5, r) : 0;
    });
    if (sc.meter) sc.meter.redraw(Math.round(v.bus.P) + '|' + Math.round(v.bus.I) + '|' + v.bus.pf.toFixed(3));
    if (sc.relay) sc.relay.redraw(v.comp.on.join('') + '|' + v.bus.pf.toFixed(3) + s.comp.mode);
    k.invalidate(true);
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return false;
    const f = fab(app); let moved = false;
    sc.doors.forEach(dr => {
      const target = f.doors[dr.which] ? dr.open : 0, cur = dr.g.rotation.y;
      if (Math.abs(target - cur) > 0.002) { dr.g.rotation.y = k.reducedMotion ? target : cur + (target - cur) * Math.min(1, dt * 6 + 0.02); moved = true; }
    });
    // soğutma grubu fanları yalnız yük devredeyken döner (çalışma durumunu gösterir)
    if (!k.reducedMotion && app.running && !app.paused) Object.keys(sc.loads).forEach(id => { const p = sc.loads[id]; if (p.on && p.fans.length) { p.fans.forEach(fn => { fn.rotation.y += dt * 9; }); moved = true; } });
    return moved;
  }
  function ensureLegend(app) {
    const stage = app.root.querySelector('[data-vs-stage]');
    if (!stage || stage.querySelector('.vs-fab-legend')) return;
    // katlanabilir açıklama: tercih bu cihazda hatırlanır; dar ekranda kapalı başlar
    let pref = null; try { pref = localStorage.getItem(KEY + 'legend'); } catch (_) { }
    const open = pref === null ? !(window.matchMedia && matchMedia('(max-width: 600px)').matches) : pref === '1';
    const box = VS.el('details', { class: 'vs-fab-legend', open: open ? true : undefined }, [
      VS.el('summary', { text: 'Animasyonlar ne gösterir?' }),
      VS.el('span', { html: '<i style="background:#fcd34d"></i>Sarı noktalar: yük akımının hesaplanan büyüklüğü (hız ∝ I/In).' }),
      VS.el('span', { html: '<i style="background:#22d3ee"></i>Camgöbeği: devredeki kondansatör kademelerinin payı.' }),
      VS.el('span', { text: 'Yeşil lamba: yük devrede · fan dönüşü: çalışıyor · fırın aralığı: ısıtıcı enerjili · sargı rengi (kesitte): kararlı sıcak nokta.' }),
      VS.el('em', { text: 'Elektron hareketi ya da ölçülmüş güç kalitesi değildir; değerler girdilerden hesaplanır.' })
    ]);
    box.addEventListener('toggle', () => { try { localStorage.setItem(KEY + 'legend', box.open ? '1' : '0'); } catch (_) { } });
    stage.appendChild(box);
  }

  /* ---------------------------------------------------------------- 2D: açıklamalı tek hat şeması */
  const OY = 34;
  const C2 = { on: '#fcd34d', off: '#475569', txt: '#dbe6f3', dim: '#8ea3bf', ok: '#10b981', warn: '#f59e0b', fail: '#ef4444', cyan: '#22d3ee', sel: '#fde68a' };
  function layout2d(W, s) {
    const n = s.loads.length + 1, sp = 120, perRow = Math.max(2, Math.floor((W - 40) / sp));
    const rows = Math.ceil(n / perRow);
    return { perRow: perRow, rows: rows, sp: Math.min(170, (W - 40) / Math.min(n, perRow)), total: 250 + OY + rows * 205 };
  }
  function view2dHeight(W, res, s) { return layout2d(W, s).total; }
  function view2d(g, W, H, res, s, live, app) {
    const v = res.values, f = fab(app), L = layout2d(W, s), hits = f.hits = [];
    const fit = VS.fitText;
    const area = a => res.checks.filter(c => c.area === a).reduce((m, c) => (c.status === 'fail' ? 'fail' : m === 'fail' ? m : c.status === 'warn' ? 'warn' : m), 'ok');
    const dot = (x, y, st) => { g.fillStyle = C2[st] || C2.ok; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); };
    const text = (t, x, y, col, font, w, align) => { g.fillStyle = col || C2.txt; g.font = font || '12px Inter, system-ui, sans-serif'; g.textAlign = align || 'left'; g.fillText(w ? fit(g, t, w) : t, x, y); };
    const selBox = (x, y, w, h, key) => { hits.push({ x: x, y: y + OY, w: w, h: h, key: key }); if (f.sel === key) { g.save(); g.strokeStyle = C2.sel; g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeRect(x, y, w, h); g.restore(); } };
    g.save(); g.translate(0, OY); // üstteki durum rozeti şemanın üstüne binmesin
    g.textBaseline = 'middle'; g.lineCap = 'round';
    const x0 = 46, tw = Math.max(120, W - x0 - 40);
    // OG kaynak
    g.strokeStyle = C2.on; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x0 - 14, 26); g.lineTo(x0 + 14, 26); g.moveTo(x0 - 10, 20); g.lineTo(x0 + 10, 20); g.moveTo(x0, 26); g.lineTo(x0, 60); g.stroke();
    text('OG şebeke ' + fmt(s.supply.U1_kV, 1, 'kV') + ' · SkQ ' + fmt(s.supply.SkQ_MVA, 0, 'MVA') + ' · I1 ' + fmt(v.trafo.I1, 1, 'A'), x0 + 26, 32, C2.dim, null, tw);
    selBox(x0 - 20, 12, Math.min(tw + 40, W - 30), 52, 'og');
    // trafo (iki daire)
    const tst = area('trafo');
    g.strokeStyle = C2.on; g.beginPath(); g.arc(x0, 76, 15, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x0, 98, 15, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x0, 113); g.lineTo(x0, 140); g.stroke();
    text('Trafo ' + fmt(s.trafo.Sr_kVA, 0, 'kVA') + ' · uk %' + fmt(s.trafo.uk, 1) + ' · Dyn11', x0 + 26, 78, C2.txt, 'bold 12px Inter, system-ui, sans-serif', tw);
    text('K %' + fmt(v.trafo.k * 100, 1) + ' · kayıp ' + fmt(v.trafo.losses / 1e3, 2, 'kW') + ' · θh ' + fmt(v.trafo.temps.hotSpot, 0, '°C') + ' · U ≈ ' + fmt(v.bus.U, 0, 'V'), x0 + 26, 96, C2.dim, null, tw - 14);
    dot(W - 22, 78, tst);
    selBox(x0 - 20, 58, Math.min(tw + 40, W - 30), 60, 'trafo');
    // ACB
    g.strokeStyle = C2.on; g.strokeRect(x0 - 8, 140, 16, 16); g.beginPath(); g.moveTo(x0 - 8, 140); g.lineTo(x0 + 8, 156); g.moveTo(x0 + 8, 140); g.lineTo(x0 - 8, 156); g.moveTo(x0, 156); g.lineTo(x0, 190); g.stroke();
    text('ACB ' + s.board.mainIn + ' A · Ir ' + fmt(v.bus.mainIr, 0, 'A') + ' · Icu ' + s.board.mainIcu_kA + ' kA', x0 + 26, 148, C2.txt, null, tw);
    // bara satırları
    const perRow = L.perRow, sp = L.sp, items = [{ key: 'komp' }].concat(s.loads.map((l, i) => ({ key: 'load:' + l.id, l: l, x: v.loads[i] })));
    for (let r = 0; r < L.rows; r++) {
      const yb = 200 + r * 205, list = items.slice(r * perRow, (r + 1) * perRow);
      const xa = 20, xb = Math.min(W - 16, 20 + list.length * sp + 10);
      g.strokeStyle = C2.on; g.lineWidth = 5; g.beginPath(); g.moveTo(xa, yb); g.lineTo(xb, yb); g.stroke(); g.lineWidth = 2;
      if (r === 0) {
        g.beginPath(); g.moveTo(x0, 190); g.lineTo(x0, yb); g.stroke();
        text('ADP bara ' + fmt(v.U, 0, 'V') + ' · ' + fmt(v.bus.I, 0, 'A') + ' · Ik3 ' + fmt(v.bus.Ik3 / 1e3, 1, 'kA') + ' · cosφ ' + fmt(v.bus.pf, 3), x0 + 26, 180, C2.txt, 'bold 12px Inter, system-ui, sans-serif', tw);
        dot(W - 22, 180, area('adp'));
        selBox(10, 134, W - 20, 74, 'adp');
      } else {
        g.save(); g.setLineDash([5, 4]); g.strokeStyle = C2.on; g.beginPath(); g.moveTo(14, yb - 205); g.lineTo(14, yb); g.lineTo(xa, yb); g.stroke(); g.restore();
        text('bara devamı', 22, yb - 12, C2.dim, '11px Inter, system-ui, sans-serif');
      }
      list.forEach((it, j) => {
        const cx = 20 + sp * (j + 0.5), on = it.l ? it.l.on : v.comp.Qon > 0;
        g.strokeStyle = on ? (it.l ? C2.on : C2.cyan) : C2.off;
        if (!on) g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(cx, yb); g.lineTo(cx, yb + 22); g.stroke();
        g.strokeRect(cx - 6, yb + 22, 12, 18); // MCCB
        if (!on) { g.beginPath(); g.moveTo(cx - 6, yb + 40); g.lineTo(cx + 6, yb + 22); g.stroke(); }
        g.beginPath(); g.moveTo(cx, yb + 40); g.lineTo(cx, yb + 78); g.stroke();
        g.setLineDash([]);
        const w = sp - 12;
        if (!it.l) {
          // kondansatör (± reaktör)
          if (s.comp.detune > 0) { g.beginPath(); for (let q = 0; q < 3; q++) g.arc(cx, yb + 58 + q * 6, 3, -Math.PI / 2, Math.PI / 2); g.stroke(); }
          g.beginPath(); g.moveTo(cx - 12, yb + 80); g.lineTo(cx + 12, yb + 80); g.moveTo(cx - 12, yb + 88); g.lineTo(cx + 12, yb + 88); g.stroke();
          text('Kompanzasyon', cx, yb + 108, C2.txt, 'bold 11px Inter, system-ui, sans-serif', w, 'center');
          text(fmt(v.comp.Qon, 0) + ' / ' + fmt(v.comp.Qtot, 0) + ' kVAr', cx, yb + 124, C2.dim, '11px Inter, system-ui, sans-serif', w, 'center');
          text(v.comp.on.filter(Boolean).length + '/' + v.comp.on.length + ' kademe · ' + (s.comp.detune > 0 ? 'p %' + fmt(s.comp.detune, 1) : 'reaktörsüz'), cx, yb + 140, C2.dim, '11px Inter, system-ui, sans-serif', w, 'center');
          text('THDv %' + fmt(v.comp.THDv, 1), cx, yb + 156, C2.dim, '11px Inter, system-ui, sans-serif', w, 'center');
          dot(cx, yb + 174, area('komp'));
        } else {
          const l = it.l, x = it.x, motor = F.LOAD_TYPES[l.type].motor;
          g.strokeStyle = on ? C2.on : C2.off; g.beginPath(); g.arc(cx, yb + 92, 13, 0, Math.PI * 2); g.stroke();
          text({ motor: 'M', vfd: 'M~', compressor: 'M', hvac: 'M', cnc: 'CNC', resistive: 'R', lighting: '☀' }[l.type] || '·', cx, yb + 93, on ? C2.txt : C2.dim, 'bold 11px Inter, system-ui, sans-serif', 24, 'center');
          text(l.name, cx, yb + 120, on ? C2.txt : C2.dim, 'bold 11px Inter, system-ui, sans-serif', w, 'center');
          text((on ? fmt(x.Pel, 0, 'kW') + ' · ' + fmt(x.I, 0, 'A') : 'kapalı · ' + fmt(x.PelRated, 0, 'kW')), cx, yb + 136, C2.dim, '11px Inter, system-ui, sans-serif', w, 'center');
          text('MCCB ' + l.In + ' A · ' + (l.par > 1 ? l.par + '×' : '') + l.S + ' mm²', cx, yb + 152, C2.dim, '11px Inter, system-ui, sans-serif', w, 'center');
          text('ΔU %' + fmt(x.vd, 1) + (motor ? ' · motor' : ''), cx, yb + 168, C2.dim, '11px Inter, system-ui, sans-serif', w, 'center');
          dot(cx, yb + 184, x.status);
        }
        selBox(cx - sp / 2 + 3, yb + 4, sp - 6, 188, it.key);
      });
    }
    g.restore();
    text('Şemaya dokunun: ekipman ayrıntısı Analiz panelinde. Kesikli çizgi: devre dışı.', 20, H - 14, C2.dim, '11px Inter, system-ui, sans-serif', W - 40);
  }

  /* ---------------------------------------------------------------- bağlama: olaylar, 2D tıklama, paylaşım */
  function mount(app) {
    fab(app);
    const set0 = app.set.bind(app);
    app.set = function (key, value, opts) { cause(app, { kind: 'param', key: key, from: clone(app.get(key) === undefined ? null : app.get(key)), to: value }); return set0(key, value, opts); };
    const save0 = app.saveState.bind(app);
    app.saveState = function () { if (!fab(app).noSave) save0(); };
    // kullanım biçimi (rehberli/teknik) bir tercihtir: senaryo, sıfırlama, içe aktarma ve görevlerde korunur
    const start0 = app.startTask.bind(app);
    app.startTask = function (tk) {
      fab(app).taskStart = Date.now(); cause(app, { kind: 'task', text: 'Görev başlatıldı: ' + tk.title });
      const keepUi = tk.state && !(tk.state.ui && tk.state.ui.mode === 'technical');
      return start0(keepUi ? Object.assign({}, tk, { state: Object.assign(clone(tk.state), { ui: clone(app.state.ui) }) }) : tk);
    };
    const apply0 = app.applyState.bind(app);
    app.applyState = function (st) { if (st && app.state && app.state.ui) st.ui = clone(app.state.ui); return apply0(st); };
    const root = app.root;
    root.addEventListener('change', e => {
      if (e.target.matches('[data-vs-scenario]')) { const o = e.target.selectedOptions[0]; if (o && o.value) cause(app, { kind: 'scenario', text: 'Örnek senaryo yüklendi: ' + o.textContent }); }
      if (e.target.matches('[data-vs-file]') && e.target.files[0]) cause(app, { kind: 'project', text: 'JSON içe aktarıldı: ' + e.target.files[0].name });
    }, true);
    root.addEventListener('click', e => { if (e.target.closest('[data-vs-act="reset"]')) cause(app, { kind: 'project', text: 'Varsayılan senaryoya dönüldü' }); }, true);
    const cv = root.querySelector('[data-vs-2d]');
    if (cv) cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const h = (fab(app).hits || []).filter(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h).pop();
      select(app, h ? h.key : null);
    });
    if (!fab(app).log.length) pushLog(app, { kind: 'project', text: 'Senaryo açıldı: ' + facilityName(app.state) });
    openShared(app);
    ensureLegend(app);
    app.renderAnalysis();
  }
  function onSelect(p, app) { fab(app).sel = p && p.key ? p.key : null; app.renderAnalysis(); }

  /* ---------------------------------------------------------------- senaryolar ve görevler */
  const V = fn => { const s = F.defaults(); fn(s); return s; };
  const byId = (s, id) => s.loads.find(l => l.id === id);
  const status = (r, id) => (r.checks.find(c => c.id === id) || {}).status;
  const NIGHT = ['isik', 'chiller', 'pompa'];
  const night = s => { s.loads.forEach(l => { l.on = NIGHT.indexOf(l.id) >= 0; }); s.comp.mode = 'manual'; s.comp.manual = s.comp.steps.map(() => true); };
  const harmGrow = s => { s.comp.detune = 0; s.loads.push(F.newLoad({ id: 'ekst2', name: 'Ekstrüzyon hattı 2', type: 'vfd', vis: 'extruder', P_kW: 160, cos: 0.95, eff: 0.93, L: 75, S: 95, par: 2, In: 320 })); };
  VS.register({
    id: ID, title: 'Fabrika Senaryosu: Trafo, Pano ve Kompanzasyon', schema: F.SCHEMA,
    defaults: F.defaults,
    initLive: () => ({}),
    autoRun: true,
    startText: 'Akış animasyonu çalışıyor: noktaların hızı hesaplanan akımın anma değerine oranını gösterir.',
    compute: s => { const r = F.evaluate(s); if (r.limits) r.assumptions = r.assumptions.concat(r.limits.map(x => 'Model sınırı: ' + x)); return r; },
    controls: controls, readouts: readouts, charts: charts,
    tick: () => false,
    tasks: [
      { id: 'firin', title: 'Fırını devreye alırken trafoyu %80’in altında tutun', goal: 'Isıl işlem fırınını (150 kW) devreye alın. Trafo yüklenmesi K ≤ %80 kalmalı; kritik yükler (pres, kompresör, ekstrüzyon, aydınlatma, pompalar) kapatılamaz.', hint: 'Fırını açınca K ≈ %83 olur. Kritik olmayan soğutma grubu ya da CNC’yi kapatın, hedef cosφ’yi yükseltin veya trafo gücünü büyütün; etkisini olay geçmişinde görün.',
        check: (r, s) => { const fr = byId(s, 'firin'); return !!fr && fr.on && r.values.trafo.k <= 0.8 && s.loads.filter(l => l.critical).every(l => l.on); } },
      { id: 'reaktif', title: 'Reaktif enerji oranını sınıra getirin', goal: 'Kompanzasyon kapalı: günlük endüktif reaktif enerji aktif enerjinin %46’sı (EPDK sınırı %20). Yükleri değiştirmeden oranı sınıra getirin; bara cosφ ≥ 0,95 olsun.', hint: 'Kompanzasyon → Otomatik. Hedef cosφ’nin oranı nasıl değiştirdiğini Analiz’deki “Günlük reaktif oran” okumasında izleyin.',
        state: V(s => { s.comp.mode = 'off'; }), check: (r, s) => s.comp.mode !== 'off' && r.values.day.indOk && r.values.day.capOk && r.values.bus.pf >= 0.95 },
      { id: 'rezonans', title: 'Rezonansı giderin', goal: 'İkinci ekstrüzyon hattı eklendi ve banka reaktörsüz: 5. ve 7. harmonikler büyüyor, hesaplanan THDv ≈ %12. Kompanzasyonu kapatmadan rezonansı giderin; THDv %8’in altına insin ve cosφ ≥ 0,95 kalsın.', hint: 'Ayarlı reaktör (p = %7) seçin; Teknik görünümdeki harmonik grafiğinde trafo tarafı akımların düştüğünü görün.',
        state: V(harmGrow), check: (r, s) => r.values.comp.Qon > 0 && status(r, 'komp.res') !== 'fail' && status(r, 'komp.capI') !== 'fail' && r.values.comp.THDv < 8 && r.values.bus.pf >= 0.95 && !!byId(s, 'ekst2') && byId(s, 'ekst2').on },
      { id: 'gece', title: 'Gece vardiyasında aşırı kompanzasyonu düzeltin', goal: 'Gece yalnız aydınlatma, soğutma grubu ve pompalar çalışıyor ama tüm kademeler elle devrede: tesis kapasitif. Aynı yüklerle bara cosφ ≥ 0,95 endüktif olsun.', hint: 'Elle kademeleri kapatın ya da Otomatik’e alın. Kapasitif çalışma bara gerilimini yükseltir (Teknik: AG uç gerilimi).',
        state: V(night), check: (r, s) => s.loads.every(l => l.on === (NIGHT.indexOf(l.id) >= 0)) && r.values.bus.Q >= 0 && r.values.bus.pf >= 0.95 },
      { id: 'ab', title: 'A/B: büyük trafo mu, kompanzasyon ayarı mı?', goal: 'Fırın devrede. Mevcut durumu A olarak saklayın; trafo gücünü değiştirip B olarak saklayın ve karşılaştırma tablosunda yüklenme, kayıp ve yıllık maliyeti inceleyin.', hint: 'Analiz → A/B senaryo karşılaştırması: “Mevcut → A”, trafo gücünü değiştirin, “Mevcut → B”.',
        state: V(s => { byId(s, 'firin').on = true; }), check: (r, s, live, app) => { const f = app && app.fab, t0 = f && f.taskStart || 0; return !!(f && f.ab.A && f.ab.B && f.ab.A.at >= t0 && f.ab.B.at >= t0 && f.ab.A.state.trafo.Sr_kVA !== f.ab.B.state.trafo.Sr_kVA); } },
      { id: 'kablo', title: 'CNC atölyesi çıkışını düzeltin (Teknik)', goal: 'CNC atölyesi 140 m uzağa taşındı ve 50 mm² kabloyla besleniyor: koordinasyon ve gerilim düşümü sağlanmıyor. Gücü azaltmadan çıkışı düzeltin.', hint: 'Teknik görünüm → CNC atölyesi kartı: kesiti/paralel kabloyu artırın ya da “Çıkışı boyutlandır (öneri)”.',
        state: V(s => { s.ui.mode = 'technical'; const c = byId(s, 'cnc'); c.L = 140; c.S = 50; }), check: (r, s) => { const c = byId(s, 'cnc'); return !!c && c.on && c.P_kW >= 120 && ['coord', 'vd', 'ad'].every(k => status(r, 'load:cnc.' + k) === 'ok'); } }
    ],
    scenarios: [
      { id: 'base', name: 'Örnek tesis · iki vardiya, normal işletme', desc: '1000 kVA trafo, 8 yük grubu (fırın kapalı), otomatik ayarlı kompanzasyon: tüm ön kontroller uygun.', state: F.defaults() },
      { id: 'full', name: 'Tam üretim · fırın devrede', desc: 'Fırın da devrede: trafo yüklenmesi ≈ %83 (uyarı). Hangi yükün katkısı ne kadar? Grafikte ve olay geçmişinde izleyin.', state: V(s => { byId(s, 'firin').on = true; }) },
      { id: 'night', name: 'Gece vardiyası · kademeler elle sabit', desc: 'Yalnız aydınlatma, soğutma ve pompalar; kademeler elle devrede kalmış: tesis kapasitif.', state: V(night) },
      { id: 'harm', name: 'Sürücü yoğun genişleme · reaktörsüz banka', desc: 'İkinci ekstrüzyon hattı (VFD) eklendi, banka reaktörsüz: paralel rezonans harmonikleri büyütür.', state: V(harmGrow) },
      { id: 'nocomp', name: 'Kompanzasyon devre dışı', desc: 'Banka kapalı: cosφ 0,91, günlük endüktif oran sınırın çok üstünde; trafo daha fazla kVA taşır.', state: V(s => { s.comp.mode = 'off'; }) },
      { id: 'grow', name: 'Kapasite artışı · 1600 kVA trafo', desc: 'Tüm yükler ve ikinci ekstrüzyon hattı devrede; 1600 kVA trafo, 2500 A ACB, 3200 A bara.', state: V(s => { harmGrow(s); s.comp.detune = 7; s.loads.forEach(l => { l.on = true; }); Object.assign(s.trafo, { Sr_kVA: 1600, P0: TR.PRESETS[1600].P0, Pk: TR.PRESETS[1600].Pk, uk: TR.PRESETS[1600].uk }); Object.assign(s.board, { mainIn: 2500, mainIrF: 0.95, busbarIn: 3200, mainIcu_kA: 65, feedN: 6 }); s.comp.steps = [25, 25, 50, 50, 100, 100, 100, 100]; s.comp.manual = s.comp.steps.map(() => false); s.comp.par = 4; s.comp.In = 1250; }) }
    ],
    reportInputs: s => {
      const rows = [], add = (g, l, v) => rows.push({ group: g, label: l, value: String(v) });
      add('Tesis', 'Tesis adı', facilityName(s)); add('Tesis', 'Günlük profil', F.SHIFTS[s.facility.shift]); add('Tesis', 'Kayıp fiyatı', fmt(s.facility.price, 2, 'TL/kWh'));
      add('OG besleme', 'Gerilim · SkQ', fmt(s.supply.U1_kV, 1, 'kV') + ' · ' + fmt(s.supply.SkQ_MVA, 0, 'MVA'));
      add('Trafo', 'Sr · uk', fmt(s.trafo.Sr_kVA, 0, 'kVA') + ' · %' + fmt(s.trafo.uk, 1)); add('Trafo', 'P0 · Pk', s.trafo.P0 + ' W · ' + s.trafo.Pk + ' W'); add('Trafo', 'Ortam', fmt(s.trafo.ambient, 0, '°C'));
      add('ADP', 'ACB', s.board.mainIn + ' A · Ir ' + fmt(s.board.mainIrF, 2) + '×In · Icu ' + s.board.mainIcu_kA + ' kA'); add('ADP', 'Bara', s.board.busbarIn + ' A'); add('ADP', 'Trafo–ADP kablo', s.board.feedN + '×' + s.board.feedS + ' mm²/faz, ' + s.board.feedL + ' m');
      s.loads.forEach(l => add('Yük grupları', l.name, (l.on ? 'Devrede' : 'Devre dışı') + ' · ' + F.LOAD_TYPES[l.type].label + ' · ' + fmt(l.P_kW, 1, 'kW') + ' · cosφ ' + fmt(l.cos, 2) + (F.LOAD_TYPES[l.type].motor ? ' · η ' + fmt(l.eff, 2) : '') + ' · MCCB ' + l.In + ' A · ' + (l.par > 1 ? l.par + '×' : '') + l.S + ' mm², ' + l.L + ' m'));
      add('Kompanzasyon', 'Mod · hedef', F.COMP_MODES[s.comp.mode] + ' · cosφ ' + fmt(s.comp.target, 3)); add('Kompanzasyon', 'Kademeler', s.comp.steps.join(', ') + ' kVAr · p %' + fmt(s.comp.detune, 2));
      add('Kompanzasyon', 'Banka çıkışı', 'MCCB ' + s.comp.In + ' A · ' + s.comp.par + '×' + s.comp.S + ' mm², ' + s.comp.L + ' m');
      add('Kapsam', 'Model', 'Eğitim ve ön değerlendirme modeli; gerçek zamanlı tesis bağlantısı yok (canlı dijital ikiz değildir).');
      return rows;
    },
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-3, 3] },
    view2d: view2d, view2dHeight: view2dHeight,
    afterCompute: afterCompute, renderExtra: renderExtra, onSelect: onSelect, mount: mount,
    migrate: (st, from) => F.migrate(st, from),
    importForeign: (obj, app) => { const c = F.importForeign(obj, app.state); if (c) c.state.ui = clone(app.state.ui); return c; },
    projectExtras: app => ({ log: fab(app).log, ab: fab(app).ab }),
    loadExtras: (x, app) => {
      const f = fab(app), n = x && Array.isArray(x.log) ? x.log.length : 0;
      f.log = cleanLog(x && x.log); f.ab = cleanAB(x && x.ab); f.sum = F.summary(app.validResult);
      pushLog(app, { kind: 'project', text: 'Proje dosyası içe aktarıldı' + (n ? ' (' + n + ' olay dosyadan)' : '') });
    }
  });
})();
