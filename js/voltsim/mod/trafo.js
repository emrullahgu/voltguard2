/* VoltSim · 3D Trafo ve Trafo Merkezi Simülasyonu
 * Hesap: VoltSimEngine.trafo (I = S/(√3·U), P0 + Pk·K², verim, IEC 60076-1 gerilim değişimi, yaklaşık Ik,
 * IEC 60076-7 kararlı hal ve birinci derece ısıl yaklaşım, bağıl yaşlanma).
 * Sahne: prefabrik beton köşk (OG hücreler, yağlı ONAN trafo, AG ana pano); hesap sonucunu gösterir. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const TR = E.trafo;
  const clamp = E.clamp;
  const MIN_PER_S = 10; // hızlandırılmış zaman: 1 s = 10 dk
  const SR_LIST = Object.keys(TR.PRESETS).map(Number);
  const U1_LIST = [['34.5', '34,5 kV'], ['31.5', '31,5 kV'], ['15.8', '15,8 kV'], ['10.5', '10,5 kV'], ['6.3', '6,3 kV']];
  // Günlük yük çevrimi (iki vardiyalı fabrika, tepe yüke göre çarpan). Saat aralığı → çarpan.
  const CYCLE = [[0, 0.35], [6, 0.7], [8, 1.0], [12, 0.75], [13, 1.0], [17, 0.85], [22, 0.45]];
  function cycleMult(min) { const h = ((min / 60) % 24 + 24) % 24; let m = CYCLE[0][1]; CYCLE.forEach(c => { if (h >= c[0]) m = c[1]; }); return m; }

  function defaults() {
    return {
      SrSel: '630', Sr_kVA: 630, U1sel: '34.5', U1_kV: 34.5, U2_V: 400,
      P0: 540, Pk: 4600, uk: 4,
      P_kW: 450, cos: 0.95, cycle: false, ambient: 25, SkQ_MVA: 500,
      protection: 'kesici', alarmOil: 90, tripOil: 100, cutaway: true,
      thermalOn: false, th: Object.assign({}, TR.THERMAL_ONAN)
    };
  }

  /* ---------------------------------------------------------------- hesap girdisi */
  function engineInput(s, app) {
    const L = app && app.live;
    let P = Number(s.P_kW);
    if (L && L.tripped) P = 0; // OG kesici açık: trafo enerjisiz
    else if (s.cycle) P = P * cycleMult(L ? L.clock : 0);
    return { Sr_kVA: s.Sr_kVA, U1_kV: s.U1_kV, U2_V: s.U2_V, P0: s.P0, Pk: s.Pk, uk: s.uk, P_kW: P, cos: s.cos, ambient: s.ambient, SkQ_MVA: s.SkQ_MVA, thermal: s.thermalOn ? s.th : undefined, energized: !(L && L.tripped) };
  }
  function compute(s, app) {
    const r = TR.compute(engineInput(s, app));
    if (!(Number(s.alarmOil) < Number(s.tripOil))) { r.errors = r.errors.concat(['Termometre alarm ayarı, açma ayarından küçük olmalı.']); r.ok = false; }
    if (r.ok) {
      const to = r.values.temps.topOil;
      r.checks.push({ id: 'thermo', label: 'Yağ termometresi (örnek röle ayarı)', status: to >= s.tripOil ? 'fail' : to >= s.alarmOil ? 'warn' : 'ok', detail: 'Kararlı üst yağ ' + E.round(to, 1) + ' °C · alarm ' + s.alarmOil + ' °C / açma ' + s.tripOil + ' °C. Ayarlar örnektir; üretici ve işletme talimatı esastır.', ref: null });
      if (app && app.live && app.live.tripped) r.checks.push({ id: 'trip', label: 'OG kesici açık', status: 'fail', detail: 'Termometre açma kontağı trafoyu devre dışı bıraktı; yük beslenmiyor, trafo soğuyor.', ref: null });
    }
    return r;
  }

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const preset = TR.PRESETS[s.SrSel];
    const r = app.validResult && app.validResult.values;
    const Pmax = Math.round(s.Sr_kVA * 1.5 / 10) * 10;
    return [
      { title: 'Trafo', items: [
        { type: 'select', key: 'SrSel', label: 'Anma gücü Sr', rebuild: true, options: SR_LIST.map(v => [String(v), v + ' kVA']).concat([['custom', 'Özel değer…']]),
          onChange: (v, a) => { const p = TR.PRESETS[v]; if (p) { Object.assign(a.state, { Sr_kVA: Number(v), P0: p.P0, Pk: p.Pk, uk: p.uk }); a.state.P_kW = Math.min(a.state.P_kW, Math.round(Number(v) * 1.5)); } a.renderControls(); a.invalidate(); } },
        s.SrSel === 'custom' ? { type: 'number', key: 'Sr_kVA', label: 'Özel anma gücü', min: 25, max: 40000, step: 5, unit: 'kVA' } : null,
        { type: 'select', key: 'U1sel', label: 'OG anma gerilimi U1', rebuild: true, options: U1_LIST.concat([['custom', 'Özel değer…']]),
          onChange: (v, a) => { if (v !== 'custom') a.state.U1_kV = Number(v); a.renderControls(); a.invalidate(); } },
        s.U1sel === 'custom' ? { type: 'number', key: 'U1_kV', label: 'Özel OG gerilimi', min: 1, max: 154, step: 0.1, unit: 'kV', digits: 1 } : null,
        { type: 'seg', key: 'U2_V', label: 'AG anma gerilimi U2', options: [[400, '400 V'], [690, '690 V']] },
        { type: 'number', key: 'P0', label: 'Boşta kayıp P0', min: 0, max: 100000, step: 10, unit: 'W', help: preset ? 'Önayar: ' + preset.P0 + ' W (örnek katalog değeri)' : 'Katalog veya etiket değeri' },
        { type: 'number', key: 'Pk', label: 'Yük (bakır) kaybı Pk', min: 0, max: 500000, step: 50, unit: 'W', help: preset ? 'Önayar: ' + preset.Pk + ' W (örnek katalog değeri)' : null },
        { type: 'number', key: 'uk', label: 'Kısa devre gerilimi uk', min: 2, max: 20, step: 0.1, unit: '%', digits: 1, help: preset ? 'Önayar: %' + preset.uk + ' (örnek katalog değeri)' : null },
        { type: 'note', text: 'Önayarlar 36 kV sınıfı yağlı dağıtım trafoları için örnek katalog değerleridir; projede trafo etiketi veya üretici kataloğu esas alınır. 34,5/0,4 kV yalnızca örnektir; bölgenizdeki OG işletme gerilimini dağıtım şirketinden doğrulayın.' }
      ] },
      { title: 'Yük', items: [
        { type: 'range', key: 'P_kW', label: s.cycle ? 'Tepe yük (aktif güç)' : 'Yük aktif gücü P', min: 0, max: Math.max(50, Pmax), step: s.Sr_kVA > 800 ? 10 : 5, unit: 'kW' },
        { type: 'range', key: 'cos', label: 'Yük cosφ', min: 0.6, max: 1, step: 0.01, digits: 2 },
        { type: 'range', key: 'ambient', label: 'Ortam sıcaklığı (köşk içi)', min: -10, max: 45, step: 1, unit: '°C' },
        { type: 'toggle', key: 'cycle', label: 'Günlük yük çevrimi (iki vardiya)', rebuild: true },
        s.cycle ? { type: 'note', text: 'Yük, simülasyon saatine göre tepe değerin %35–100’ü arasında değişir (gece %35, 08–12 ve 13–17 %100). Sıcaklık bu değişimi yağ zaman sabitiyle gecikmeli izler.' } : null,
        r ? { type: 'note', html: 'S <b>' + fmt(r.S / 1e3, 1, 'kVA') + '</b> · K <b>%' + fmt(r.k * 100, 0) + '</b> · I2 <b>' + fmt(r.I2, 0, 'A') + '</b> / ' + fmt(r.I2n, 0, 'A') } : null
      ] },
      { title: 'OG şebeke ve koruma', items: [
        { type: 'range', key: 'SkQ_MVA', label: 'OG şebeke kısa devre gücü SkQ', min: 20, max: 1500, step: 10, unit: 'MVA', help: 'Dağıtım şirketinden alınan bağlantı noktası değeri; kısa devre sonucu yaklaşıktır.' },
        { type: 'seg', key: 'protection', label: 'Trafo koruma hücresi', options: [['kesici', 'Kesici + röle'], ['sigorta', 'Sigortalı yük ayırıcı']] },
        { type: 'range', key: 'alarmOil', label: 'Yağ termometresi · alarm', min: 60, max: 110, step: 1, unit: '°C', help: 'Örnek röle ayarı.' },
        { type: 'range', key: 'tripOil', label: 'Yağ termometresi · açma', min: 70, max: 120, step: 1, unit: '°C', help: 'Örnek röle ayarı. Açmada OG kesici/yük ayırıcı açar.' },
        { type: 'buttons', items: [
          { label: 'Kesiciyi yeniden kapat', onClick: a => {
            const L = a.live; if (!L.tripped) { VS.toast('Kesici zaten kapalı.'); return; }
            if (L.temps.topOil >= a.state.alarmOil) { VS.toast('Önce üst yağ sıcaklığı alarm değerinin altına inmeli (' + fmt(L.temps.topOil, 0) + ' °C).', 'bad'); return; }
            L.tripped = false; L.events.push(clock(L.clock) + ' kesici kapatıldı'); a.invalidate();
          } },
          { label: 'Soğuk başlangıç', onClick: a => { a.live = initLive(a.state); a.running = true; a.paused = false; a.syncToolbar(); a.invalidate(); } }
        ] }
      ] },
      { title: 'Görünüm', items: [
        { type: 'toggle', key: 'cutaway', label: 'Kesit görünümü (ön duvar ve çatı gizli)', help: 'Kapatınca köşk kapalı görünür; içini “Şeffaf kapak” aracıyla görebilirsiniz.' },
        { type: 'note', html: 'Köşk içi yerleşim ve ölçüler için <a class="vs-jump" href="/araclar/beton-kosk-yerlesim/">Beton köşk yerleşim aracı</a>.' }
      ] },
      { title: 'Isıl parametreler', collapsed: true, summary: 'IEC 60076-7 varsayılanları / üretici verisi', items: [
        { type: 'note', text: 'Üretici ısıl verisi girilmezse IEC 60076-7 dağıtım trafosu (ONAN) varsayılanları kullanılır; sıcaklık ve yaşlanma sonuçları bu durumda göstergedir.' },
        { type: 'toggle', key: 'thermalOn', label: 'Üretici ısıl verisini kullan', rebuild: true },
        s.thermalOn ? { type: 'number', key: 'th.dThetaOr', label: 'Anma üst yağ sıcaklık artışı Δθor', min: 20, max: 80, step: 1, unit: 'K' } : null,
        s.thermalOn ? { type: 'number', key: 'th.Hgr', label: 'Sıcak nokta – üst yağ farkı H·gr', min: 5, max: 50, step: 0.5, unit: 'K', digits: 1 } : null,
        s.thermalOn ? { type: 'number', key: 'th.R', label: 'Kayıp oranı R = Pk/P0', min: 1, max: 20, step: 0.1, digits: 1 } : null,
        s.thermalOn ? { type: 'number', key: 'th.x', label: 'Yağ üssü x', min: 0.5, max: 1.2, step: 0.05, digits: 2 } : null,
        s.thermalOn ? { type: 'number', key: 'th.y', label: 'Sargı üssü y', min: 1, max: 2.5, step: 0.05, digits: 2 } : null,
        s.thermalOn ? { type: 'number', key: 'th.tauO', label: 'Yağ zaman sabiti τo', min: 30, max: 400, step: 5, unit: 'dk' } : null,
        s.thermalOn ? { type: 'number', key: 'th.tauW', label: 'Sargı zaman sabiti τw', min: 1, max: 20, step: 0.5, unit: 'dk', digits: 1 } : null,
        s.thermalOn ? { type: 'buttons', items: [{ label: 'IEC 60076-7 varsayılanlarına dön', onClick: a => { a.state.th = Object.assign({}, TR.THERMAL_ONAN); a.renderControls(); a.invalidate(); } }] } : null
      ] }
    ];
  }

  /* ---------------------------------------------------------------- zaman adımı: ısıl yaklaşım, termometre, yük çevrimi */
  function clock(min) { const d = Math.floor(min / 1440) + 1, m = ((min % 1440) + 1440) % 1440; return 'Gün ' + d + ' · ' + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0'); }
  function initLive(s) {
    const a = Number(s.ambient) || 20;
    return { temps: { topOil: a, dTh: 0, hotSpot: a }, clock: 6 * 60, hist: [], histT: 0, ageH: 0, tripped: false, alarm: false, events: [], bucket: -1 };
  }
  function tick(app, dt) {
    const res = app.validResult; if (!res) return false;
    const s = app.state, L = app.live, v = res.values;
    const dtMin = dt * MIN_PER_S;
    L.clock += dtMin;
    // enerjisiz trafo ortam sıcaklığına soğur; aksi hâlde motorun kararlı hal hedefine birinci derece yaklaşım
    const target = v.temps; // enerjisizken motor θ = θa döndürür
    L.temps = TR.stepTemps(L.temps, target, dtMin, v.thermal);
    L.ageH += TR.agingRate(L.temps.hotSpot) * dtMin / 60;
    const wasAlarm = L.alarm;
    L.alarm = !L.tripped && L.temps.topOil >= s.alarmOil;
    if (L.alarm && !wasAlarm) L.events.push(clock(L.clock) + ' termometre alarmı (' + fmt(L.temps.topOil, 0) + ' °C)');
    if (!L.tripped && L.temps.topOil >= s.tripOil) {
      L.tripped = true; L.alarm = false;
      L.events.push(clock(L.clock) + ' termometre açma kontağı: ' + (s.protection === 'kesici' ? 'OG kesici' : 'sigortalı yük ayırıcı') + ' açtı');
      VS.toast('Yağ sıcaklığı ' + s.tripOil + ' °C açma ayarına ulaştı: trafo devre dışı (örnek röle ayarı).', 'bad');
      app.invalidate();
    }
    if (s.cycle) { const b = Math.floor(L.clock / 15); if (b !== L.bucket) { L.bucket = b; app.invalidate(); } }
    L.histT += dtMin;
    if (L.histT >= 10 || !L.hist.length) { L.histT = 0; L.hist.push([L.clock / 60, L.temps.topOil, L.temps.hotSpot]); if (L.hist.length > 433) L.hist.shift(); }
    return true;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live) {
    const v = res.values;
    const st = id => (res.checks.find(c => c.id === id) || {}).status;
    const lv = id => ({ ok: 'ok', warn: 'warn', fail: 'bad' }[st(id)]);
    const thSrc = s.thermalOn ? 'üretici verisi' : 'IEC 60076-7 varsayılanı';
    const prot = live.tripped ? 'AÇTI' : live.alarm ? 'ALARM' : 'Normal';
    const out = [
      { label: 'Görünür güç S', value: fmt(v.S / 1e3, 1, 'kVA'), sub: 'P ' + fmt(v.P / 1e3, 1) + ' kW · Q ' + fmt(v.Q / 1e3, 1) + ' kVAr' },
      { label: 'Yüklenme K', value: '%' + fmt(v.k * 100, 1), level: live.tripped ? 'bad' : lv('load'), sub: 'K_opt (en yüksek verim) %' + fmt(v.kOpt * 100, 0) },
      { label: 'OG akımı I1', value: fmt(v.I1, 1, 'A'), sub: 'anma I1n ' + fmt(v.I1n, 1, 'A') + ' · ' + fmt(s.U1_kV, 1) + ' kV' },
      { label: 'AG akımı I2', value: fmt(v.I2, 0, 'A'), sub: 'anma I2n ' + fmt(v.I2n, 0, 'A') + ' · ' + s.U2_V + ' V' },
      { label: 'Boşta kayıp P0', value: fmt(v.P0, 0, 'W'), sub: 'enerjili olduğu sürece sabit' },
      { label: 'Yük kaybı Pk·K²', value: fmt(v.Pcu, 0, 'W'), sub: 'Pk ' + fmt(s.Pk, 0) + ' W @ K = 1' },
      { label: 'Toplam kayıp', value: fmt(v.losses / 1e3, 2, 'kW') },
      { label: 'Verim η', value: v.P > 0 ? '%' + fmt(v.eff, 2) : '—', sub: v.P > 0 ? 'cosφ ' + fmt(s.cos, 2) : 'yük yok' },
      { label: 'Gerilim değişimi', value: '%' + fmt(v.reg, 2), sub: 'AG yükte ≈ ' + fmt(v.U2load, 0, 'V') + ' (boşta ' + s.U2_V + ' V)' },
      { label: 'Ik3 yalnız trafo', value: fmt(v.IkT / 1e3, 1, 'kA'), sub: 'In/uk, sonsuz şebeke · yaklaşık' },
      { label: 'Ik3 şebeke dahil', value: fmt(v.Ik / 1e3, 1, 'kA'), sub: 'ip ' + fmt(v.ip / 1e3, 1) + ' kA · yaklaşık, tam IEC 60909 değil' },
      { label: 'Kararlı üst yağ / sıcak nokta', value: fmt(v.temps.topOil, 0) + ' / ' + fmt(v.temps.hotSpot, 0) + ' °C', level: lv('hs'), sub: thSrc },
      { label: 'Anlık üst yağ / sıcak nokta', value: fmt(live.temps.topOil, 0) + ' / ' + fmt(live.temps.hotSpot, 0) + ' °C', level: live.tripped ? 'bad' : live.alarm ? 'warn' : undefined, sub: clock(live.clock) + ' · 1 s = ' + MIN_PER_S + ' dk' },
      { label: 'Bağıl yaşlanma V', value: fmt(v.aging, 2) + '×', level: v.aging > 2 ? 'bad' : v.aging > 1 ? 'warn' : 'ok', sub: 'anlık ' + fmt(TR.agingRate(live.temps.hotSpot), 2) + '× · birikmiş ' + fmt(live.ageH, 1) + ' eşdeğer sa' },
      { label: 'Yağ termometresi (örnek ayar)', value: prot, level: live.tripped ? 'bad' : live.alarm ? 'warn' : 'ok', sub: 'alarm ' + s.alarmOil + ' °C · açma ' + s.tripOil + ' °C', wide: true }
    ];
    if (s.cycle && !live.tripped) out.push({ label: 'Günlük yük çevrimi', value: '×' + fmt(cycleMult(live.clock), 2) + ' tepe yük', sub: clock(live.clock), wide: true });
    if (live.events.length) out.push({ label: 'Son olay', value: live.events[live.events.length - 1], wide: true });
    return out;
  }
  // verim–yük eğrisi: motor her K için çağrılır (girdi değişmedikçe önbellekten)
  let curveCache = { key: '', pts: [] };
  function curve(s) {
    const base = engineInput(s, null); base.P_kW = 0;
    const key = JSON.stringify([base.Sr_kVA, base.U1_kV, base.U2_V, base.P0, base.Pk, base.uk, base.cos, base.ambient, base.SkQ_MVA]);
    if (curveCache.key === key) return curveCache.pts;
    const pts = [];
    for (let K = 0.05; K <= 1.301; K += 0.025) {
      const r = TR.compute(Object.assign({}, base, { P_kW: K * base.Sr_kVA * base.cos }));
      if (r.ok) pts.push({ K: K, eff: r.values.eff, P0: r.values.P0, Pcu: r.values.Pcu, tot: r.values.losses });
    }
    curveCache = { key: key, pts: pts };
    return pts;
  }
  function charts(res, s, live) {
    const v = res.values, c = curve(s);
    const effMin = c.filter(p => p.K >= 0.1).reduce((a, p) => Math.min(a, p.eff), 100);
    const out = [{
      id: 'eff', title: 'Verim – yüklenme eğrisi (cosφ sabit)', height: 160,
      series: [{ name: 'η (%)', color: 'green', data: c.filter(p => p.K >= 0.1).map(p => [p.K * 100, p.eff]) }],
      markers: [{ x: v.kOpt * 100, label: 'K_opt %' + fmt(v.kOpt * 100, 0), color: '#22b8cf' }].concat(v.P > 0 ? [{ x: v.k * 100, y: v.eff, label: 'işletme', color: '#fcd34d' }] : []),
      x: { min: 10, max: 130, label: 'K %' }, y: { min: Math.floor(effMin * 2) / 2 - 0.2, max: 100, label: '%', fmt: y => fmt(y, 1) },
      alt: 'Verim en yüksek K_opt = %' + fmt(v.kOpt * 100, 0) + ' yüklenmede. İşletme noktası K = %' + fmt(v.k * 100, 0) + ', η = %' + fmt(v.eff, 2) + '.'
    }, {
      id: 'loss', title: 'Kayıplar: P0 sabit, Pk·K² karesel', height: 150,
      series: [
        { name: 'P0 (kW)', color: 'cyan', data: c.map(p => [p.K * 100, p.P0 / 1e3]) },
        { name: 'Pk·K² (kW)', color: 'amber', data: c.map(p => [p.K * 100, p.Pcu / 1e3]) },
        { name: 'Toplam (kW)', color: 'red', dash: [4, 3], data: c.map(p => [p.K * 100, p.tot / 1e3]) }
      ],
      markers: [{ x: v.k * 100, y: v.losses / 1e3, label: fmt(v.losses / 1e3, 2) + ' kW', color: '#fcd34d' }],
      x: { min: 0, max: 130, label: 'K %' }, y: { label: 'kW' },
      alt: 'Boşta kayıp ' + fmt(v.P0, 0) + ' W sabit; yük kaybı K² ile artar. K_opt\'ta iki kayıp eşittir. Şu an toplam ' + fmt(v.losses, 0) + ' W.'
    }];
    const h = live.hist.length > 1 ? live.hist : [[live.clock / 60, live.temps.topOil, live.temps.hotSpot]];
    out.push({
      id: 'temp', title: 'Sıcaklık geçmişi (hızlandırılmış zaman)', height: 160,
      series: [{ name: 'Üst yağ (°C)', color: 'amber', data: h.map(p => [p[0], p[1]]) }, { name: 'Sıcak nokta (°C)', color: 'red', data: h.map(p => [p[0], p[2]]) }],
      hLines: [{ y: s.alarmOil, label: 'Alarm ' + s.alarmOil, color: '#f59e0b' }, { y: s.tripOil, label: 'Açma ' + s.tripOil, color: '#ef4444' }],
      x: { label: 'saat', fmt: x => String(Math.round(((x % 24) + 24) % 24)).padStart(2, '0') }, y: { label: '°C', min: Math.min(0, Math.floor(Number(s.ambient) / 10) * 10) },
      alt: clock(live.clock) + ' itibarıyla üst yağ ' + fmt(live.temps.topOil, 1) + ' °C, sıcak nokta ' + fmt(live.temps.hotSpot, 1) + ' °C; kararlı hedef ' + fmt(v.temps.topOil, 1) + ' / ' + fmt(v.temps.hotSpot, 1) + ' °C.'
    });
    return out;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  let A = null;
  const trash = [];
  function canvasTex(T, w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t; }
  function std(k, hex, o) { return k.mat ? k.mat(hex, o) : new k.T.MeshStandardMaterial(Object.assign({ color: hex }, o || {})); }
  function assets(k) {
    if (A && A.kit === k) return A;
    const T = k.T; A = { kit: k };
    A.unit = new T.BoxGeometry(1, 1, 1);
    A.cyl = new T.CylinderGeometry(1, 1, 1, 20);
    A.shed = new T.CylinderGeometry(1, 1, 1, 20);
    A.louvre = canvasTex(T, 64, 128, (g, w, h) => { g.fillStyle = '#6b737c'; g.fillRect(0, 0, w, h); for (let y = 6; y < h - 6; y += 9) { g.fillStyle = '#2a3037'; g.fillRect(4, y, w - 8, 5); g.fillStyle = '#9aa2aa'; g.fillRect(4, y + 5, w - 8, 1); } });
    A.concTex = canvasTex(T, 128, 128, (g, w, h) => { g.fillStyle = '#c9c4ba'; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { const c = 170 + Math.floor(Math.random() * 50); g.fillStyle = 'rgb(' + c + ',' + (c - 4) + ',' + (c - 12) + ')'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } });
    A.concTex.wrapS = A.concTex.wrapT = T.RepeatWrapping; A.concTex.repeat.set(3, 2);
    return A;
  }
  function inst(im, i, x, y, z, sx, sy, sz, tmp) { tmp.p.set(x, y, z); tmp.s.set(sx, sy, sz); tmp.m.compose(tmp.p, tmp.q, tmp.s); im.setMatrixAt(i, tmp.m); }
  function cylM(k, geo, mat, r, h, x, y, z, parent) { const m = new k.T.Mesh(geo, mat); m.scale.set(r, h, r); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

  function dims(s) {
    const Sr = clamp(Number(s.Sr_kVA) || 630, 25, 40000);
    const sT = clamp(Math.cbrt(Sr / 630), 0.75, 1.6);
    const L = 1.3 * sT, Wd = 0.78 * sT, Ht = 1.1 * sT, fd = 0.24 * sT;
    const mvW = 2.7, trW = Math.max(2.5, L + 1.3), lvW = 2.0, pt = 0.1, t = 0.14;
    const Lk = mvW + trW + lvW + 2 * pt, Dk = Math.max(2.5, Wd + 2 * fd + 1.2);
    return { Sr: Sr, sT: sT, L: L, Wd: Wd, Ht: Ht, fd: fd, mvW: mvW, trW: trW, lvW: lvW, pt: pt, t: t, Lk: Lk, Dk: Dk, FY: 0.35, Hi: 2.5 };
  }
  function rebuildOn(s) { const d = dims(s); return d.sT.toFixed(3) + '|' + s.protection; }

  const CELLS = [
    { id: 'in', name: 'Giriş hücresi (hat)', short: 'GİRİŞ', kind: 'line' },
    { id: 'out', name: 'Çıkış hücresi (hat)', short: 'ÇIKIŞ', kind: 'line' },
    { id: 'meas', name: 'Ölçü hücresi', short: 'ÖLÇÜ', kind: 'meas' },
    { id: 'tp', name: 'Trafo koruma hücresi', short: 'TRAFO', kind: 'tp' }
  ];

  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    trash.forEach(x => x.dispose()); trash.length = 0;
    const a = assets(k), d = dims(s);
    const sc = { flows: [], cool: [], cells: [] };
    app.scene3 = sc;
    const tmp = { p: new T.Vector3(), s: new T.Vector3(), m: new T.Matrix4(), q: new T.Quaternion() };
    const x0 = -d.Lk / 2, FY = d.FY, Hi = d.Hi, zb = -d.Dk / 2, zf = d.Dk / 2;
    const xMV = x0 + d.mvW / 2, xTr = x0 + d.mvW + d.pt + d.trW / 2, xLV = x0 + d.mvW + d.trW + 2 * d.pt + d.lvW / 2;
    const xP1 = x0 + d.mvW + d.pt / 2, xP2 = x0 + d.mvW + d.pt + d.trW + d.pt / 2;

    /* --- zemin: çakıl alan + çim */
    const grass = k.ground(120, std(k, 0x34482a, { roughness: 1 }), 0); void grass;
    const gr = k.box(d.Lk + 6, 0.03, d.Dk + 5, M.gravel, 0, 0.015, 0.4, v.root, { noShadow: true }); gr.userData.noClip = true;

    /* --- beton köşk */
    const conc = std(k, 0xffffff, { map: a.concTex, roughness: 0.93 });
    const kiosk = k.group(null, 0, 0, 0);
    const Hw = FY + Hi;
    k.box(d.Lk + 2 * d.t, FY, d.Dk + 2 * d.t, conc, 0, FY / 2, 0, kiosk); // taban/döşeme
    k.box(d.Lk, 0.02, d.Dk, std(k, 0x8d939a, { roughness: 0.6 }), 0, FY + 0.01, 0, kiosk); // epoksi döşeme
    k.box(d.Lk + 2 * d.t, Hw, d.t, conc, 0, Hw / 2, zb - d.t / 2, kiosk);
    k.box(d.t, Hw, d.Dk, conc, x0 - d.t / 2, Hw / 2, 0, kiosk);
    k.box(d.t, Hw, d.Dk, conc, -x0 + d.t / 2, Hw / 2, 0, kiosk);
    // bölme duvarları (OG | trafo | AG)
    k.box(d.pt, Hi, d.Dk, conc, xP1, FY + Hi / 2, 0, kiosk);
    k.box(d.pt, Hi - 0.5, d.Dk, conc, xP2, FY + (Hi - 0.5) / 2, 0, kiosk);
    // ön duvar (kapılı) ve çatı: kabuk + kesit görünümünde gizlenir
    const front = k.group(kiosk, 0, 0, 0); sc.front = front;
    k.box(d.Lk + 2 * d.t, Hw, d.t, conc, 0, Hw / 2, zf + d.t / 2, front);
    const louvMat = std(k, 0xffffff, { map: a.louvre, roughness: 0.5, metalness: 0.5 });
    const doorMat = std(k, 0x5d6670, { roughness: 0.5, metalness: 0.5 });
    const doors = [[xMV, 1.0, doorMat], [xTr - d.trW * 0.22, d.trW * 0.42, louvMat], [xTr + d.trW * 0.22, d.trW * 0.42, louvMat], [xLV, 0.95, doorMat]];
    doors.forEach(dr => {
      k.box(dr[1], 2.15, 0.04, dr[2], dr[0], FY + 1.1, zf + d.t + 0.02, front);
      const sg = k.screen(0.34, 0.3, 128, drawWarn, front); sg.position.set(dr[0], FY + 1.75, zf + d.t + 0.045);
    });
    const plate = k.screen(1.2, 0.2, 512, (g, w, h) => { g.fillStyle = '#0a1628'; g.fillRect(0, 0, w, h); g.fillStyle = '#fcd34d'; g.font = 'bold 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TRAFO MERKEZİ', w / 2, h / 2 + 2); }, front);
    plate.position.set(xTr, FY + 2.38, zf + d.t + 0.01);
    k.shell(front);
    const roof = k.group(kiosk, 0, 0, 0); sc.roof = roof;
    k.box(d.Lk + 2 * d.t + 0.24, 0.16, d.Dk + 2 * d.t + 0.24, std(k, 0x9d988f, { roughness: 0.9 }), 0, Hw + 0.08, 0, roof);
    k.shell(roof); k.explodable(roof, [0, 1.6, 0]);
    // havalandırma panjurları: arka duvar üst (çıkış), trafo kapıları (giriş), AG odası yan duvar
    const lv1 = k.box(d.trW * 0.6, 0.5, 0.03, louvMat, xTr, FY + Hi - 0.42, zb + 0.02, kiosk);
    const lv2 = k.box(0.03, 0.45, 0.7, louvMat, -x0 - 0.02, FY + Hi - 0.45, 0, kiosk);
    k.pickable(lv1, 'Havalandırma panjurları', () => { const r = app.validResult && app.validResult.values; return ['Doğal havalandırma: soğuk hava kapı panjurlarından alttan girer, ısınan hava arka duvarın üstünden çıkar.', r ? 'Atılması gereken ısı ≈ trafo kayıpları ' + fmt(r.losses / 1e3, 2, 'kW') : '', 'Köşk sınıfı ve havalandırma yeterliliği IEC 62271-202 tip testiyle doğrulanır.'].filter(Boolean); });
    void lv2;

    /* --- OG hücreler (genel modüler hücre, IEC 62271-200 fikri) */
    const cw = 0.5, ch = 1.9, cd = 0.95, cz = zb + 0.06 + cd / 2;
    const cx0 = x0 + 0.35 + cw / 2;
    CELLS.forEach((c, i) => {
      const x = cx0 + i * cw;
      const g = k.group(null, x, FY, cz);
      k.box(cw - 0.01, ch, cd, M.panelRAL7035, 0, ch / 2, 0, g);
      k.box(cw - 0.01, 0.05, cd + 0.01, M.darkSteel, 0, ch - 0.38, 0, g);
      const scr = k.screen(cw - 0.06, 1.18, 256, (gx, w, h) => drawCell(gx, w, h, c, app), g);
      scr.position.set(0, 0.95, cd / 2 + 0.006);
      if (c.kind === 'tp') {
        k.box(cw - 0.02, 0.38, 0.45, M.panelRAL7035, 0, ch + 0.19, cd / 2 - 0.24, g);
        const relay = k.screen(0.2, 0.14, 160, (gx, w, h) => drawRelay(gx, w, h, app), g, { emissive: 0.9 });
        relay.position.set(0, ch + 0.2, cd / 2 + 0.006); sc.relay = relay;
      }
      const leds = [0, 1, 2].map(j => k.sphere(0.009, M.ledOff, -0.06 + j * 0.06, 1.62, cd / 2 + 0.012, g));
      k.explodable(g, [0, 0, 0.5]);
      k.pickable(g, c.name, () => cellInfo(app, c));
      sc.cells.push({ c: c, scr: scr, leds: leds });
    });
    sc.lMV = k.label('OG hücreler', null, [cx0 + 1.5 * cw, FY + ch + 0.55, cz]);

    /* --- yağlı ONAN dağıtım trafosu */
    const tr = k.group(null, xTr, FY, -0.05); sc.tr = tr;
    const yT0 = 0.2, top = yT0 + d.Ht;
    // raylar, tekerlekler, taban şasesi
    [-1, 1].forEach(j => { k.box(d.trW - 0.4, 0.04, 0.07, M.darkSteel, 0, 0.02, j * d.Wd * 0.32, tr); });
    [-1, 1].forEach(i => [-1, 1].forEach(j => { const w = cylM(k, a.cyl, M.darkSteel, 0.07, 0.05, i * d.L * 0.36, 0.11, j * d.Wd * 0.32, tr); w.rotation.x = Math.PI / 2; }));
    k.box(d.L * 0.9, 0.06, d.Wd * 0.85, M.darkSteel, 0, 0.17, 0, tr);
    const tank = k.box(d.L, d.Ht, d.Wd, M.trafoPaint, 0, yT0 + d.Ht / 2, 0, tr); k.shell(tank);
    const cover = k.box(d.L + 0.06, 0.05, d.Wd + 0.06, M.trafoPaint, 0, top + 0.025, 0, tr); k.shell(cover);
    // oluklu radyatör kanatları (InstancedMesh), ön yüzde etiket bölgesi boş
    const finH = d.Ht * 0.84, fins = [];
    for (let x = -d.L / 2 + 0.06; x <= d.L / 2 - 0.06 + 1e-6; x += 0.05) {
      fins.push([x, -1]);
      if (x > -d.L / 2 + 0.42) fins.push([x, 1]);
    }
    const finIM = new T.InstancedMesh(a.unit, M.trafoPaint, fins.length);
    fins.forEach((f, i) => inst(finIM, i, f[0], yT0 + d.Ht * 0.47, f[1] * (d.Wd / 2 + d.fd / 2), 0.012, finH, d.fd, tmp));
    finIM.castShadow = true; finIM.receiveShadow = true; finIM.frustumCulled = false; tr.add(finIM); k.shell(finIM);
    k.pickable(finIM, 'Oluklu radyatör kanatları (ONAN)', () => { const r = app.validResult && app.validResult.values; return r ? ['Yağ doğal dolaşım, hava doğal (ONAN) soğutma.', 'Atılan ısı = toplam kayıp ≈ ' + fmt(r.losses / 1e3, 2, 'kW'), 'Kararlı üst yağ ' + fmt(r.temps.topOil, 1) + ' °C (Δθo ' + fmt(r.temps.dTo, 1) + ' K)'] : []; });
    // sargılar ve çekirdek (şeffaf kapakta görünür)
    const wMat = M.copper.clone(); wMat.emissive = new T.Color(0, 0, 0); sc.wMat = wMat;
    const core = k.group(tr, 0, 0, 0);
    k.box(d.L * 0.82, 0.12, 0.16, M.darkSteel, 0, yT0 + 0.1, 0, core);
    k.box(d.L * 0.82, 0.12, 0.16, M.darkSteel, 0, yT0 + d.Ht * 0.86, 0, core);
    [-1, 0, 1].forEach(i => { cylM(k, a.cyl, wMat, d.Wd * 0.21, d.Ht * 0.66, i * d.L * 0.29, yT0 + d.Ht * 0.48, 0, core); cylM(k, a.cyl, M.darkSteel, d.Wd * 0.1, d.Ht * 0.78, i * d.L * 0.29, yT0 + d.Ht * 0.48, 0, core); });
    k.pickable(core, 'Sargılar ve nüve', () => { const L = app.live; return ['Üç fazlı nüve; iç AG, dış OG sargısı (temsilî).', 'Anlık sıcak nokta ' + fmt(L.temps.hotSpot, 1) + ' °C · üst yağ ' + fmt(L.temps.topOil, 1) + ' °C', 'Renk: sıcak nokta sıcaklığı (şeffaf kapakta görünür).'] ; });
    k.pickable(tank, 'Güç trafosu · yağlı, ONAN', () => trafoInfo(app));
    // kapak üstü: OG ve AG buşingleri, kademe değiştirici, termometre
    const lid = k.group(tr, 0, 0, 0); k.explodable(lid, [0, 0.7, 0]);
    const mvB = k.group(lid, 0, 0, 0), lvB = k.group(lid, 0, 0, 0);
    const bushTop = [];
    [-1, 0, 1].forEach(i => {
      const bx = i * d.L * 0.28, bz = -d.Wd * 0.24;
      cylM(k, a.cyl, M.porcelainGrey, 0.035, 0.44, bx, top + 0.27, bz, mvB);
      for (let j = 0; j < 5; j++) cylM(k, a.shed, M.porcelainGrey, 0.075, 0.016, bx, top + 0.1 + j * 0.075, bz, mvB);
      cylM(k, a.cyl, M.brass, 0.022, 0.06, bx, top + 0.52, bz, mvB);
      bushTop.push([xTr + bx, FY + top + 0.55, -0.05 + bz]);
    });
    const lvTop = [];
    [-1.5, -0.5, 0.5, 1.5].forEach((i, j) => {
      const bx = i * d.L * 0.18, bz = d.Wd * 0.27;
      cylM(k, a.cyl, M.porcelainGrey, 0.032, 0.18, bx, top + 0.11, bz, lvB);
      for (let q = 0; q < 2; q++) cylM(k, a.shed, M.porcelainGrey, 0.06, 0.014, bx, top + 0.08 + q * 0.06, bz, lvB);
      k.box(0.06, 0.12, 0.014, M.copper, bx, top + 0.26, bz, lvB);
      lvTop.push([xTr + bx, FY + top + 0.3, -0.05 + bz, j]);
    });
    k.pickable(mvB, 'OG buşingleri', () => { const r = app.validResult && app.validResult.values; return r ? ['U1 = ' + fmt(s.U1_kV, 1) + ' kV · I1 = ' + fmt(r.I1, 1, 'A') + ' (anma ' + fmt(r.I1n, 1, 'A') + ')', 'Porselen buşing, kablo pabucu bağlantılı (temsilî).'] : []; });
    k.pickable(lvB, 'AG buşingleri (L1 L2 L3 N)', () => { const r = app.validResult && app.validResult.values; return r ? ['U2 = ' + s.U2_V + ' V (boşta) · yükte ≈ ' + fmt(r.U2load, 0, 'V'), 'I2 = ' + fmt(r.I2, 0, 'A') + ' (anma ' + fmt(r.I2n, 0, 'A') + ')', 'Bağlantı grubu örneği Dyn11: AG yıldız noktası nötr buşingine çıkar.'] : []; });
    const tap = cylM(k, a.cyl, M.darkSteel, 0.06, 0.08, -d.L * 0.42, top + 0.09, 0.02, lid);
    k.box(0.14, 0.025, 0.03, M.plasticDark, -d.L * 0.42, top + 0.145, 0.02, lid);
    k.pickable(tap, 'Kademe değiştirici (yüksüz)', () => ['Trafo enerjisizken çevrilir; tipik ±2 × %2,5 kademe.', 'AG geriliminin yük altında düşmesini (%' + fmt(app.validResult ? app.validResult.values.reg : 0, 2) + ') dengelemek için kullanılır.']);
    // termometre (kadranı anlık üst yağ sıcaklığını gösterir)
    const thg = k.group(lid, -d.L / 2 + 0.2, top + 0.2, d.Wd / 2 - 0.02);
    k.box(0.04, 0.2, 0.04, M.darkSteel, 0, -0.1, -0.04, thg);
    cylM(k, a.cyl, M.darkSteel, 0.1, 0.05, 0, 0.06, 0, thg).rotation.x = Math.PI / 2;
    const dial = k.screen(0.17, 0.17, 256, (g, w, h) => drawDial(g, w, h, app), thg); dial.position.set(0, 0.06, 0.027);
    sc.dial = dial;
    k.pickable(thg, 'Yağ termometresi (alarm/açma kontaklı)', () => { const L = app.live; return ['Anlık üst yağ ' + fmt(L.temps.topOil, 1) + ' °C', 'Alarm ' + s.alarmOil + ' °C · açma ' + s.tripOil + ' °C (örnek röle ayarı)', 'Durum: ' + (L.tripped ? 'AÇTI' : L.alarm ? 'ALARM' : 'normal')]; });
    // etiket plakası
    const rp = k.screen(0.27, 0.19, 384, (g, w, h) => drawPlate(g, w, h, app), tr); rp.position.set(-d.L / 2 + 0.22, yT0 + d.Ht * 0.56, d.Wd / 2 + 0.004);
    sc.plate = rp;
    // genleşme tankı, Buchholz rölesi, nem alıcı
    const cons = k.group(tr, d.L / 2 - 0.08, top + 0.5 * d.sT + 0.05, 0); k.explodable(cons, [0, 1.0, 0]);
    const rc = 0.13 * d.sT, lc = d.Wd * 0.95;
    const cyl = cylM(k, a.cyl, M.trafoPaint, rc, lc, 0, 0, 0, cons); cyl.rotation.x = Math.PI / 2;
    [-1, 1].forEach(j => k.box(0.04, 0.5 * d.sT, 0.04, M.darkSteel, 0, -0.25 * d.sT, j * lc * 0.35, cons));
    const gauge = cylM(k, a.cyl, M.plasticWhite, rc * 0.5, 0.01, 0, 0, lc / 2 + 0.006, cons); gauge.rotation.x = Math.PI / 2;
    const pipe = cylM(k, a.cyl, M.darkSteel, 0.022, 0.5 * d.sT, -0.12, -0.25 * d.sT, -lc * 0.1, cons); pipe.rotation.z = 0.5;
    const buch = k.box(0.12, 0.1, 0.11, M.panelDark, -0.12, -0.24 * d.sT, -lc * 0.1, cons);
    k.box(0.05, 0.05, 0.01, M.glass, -0.12, -0.24 * d.sT, -lc * 0.1 + 0.058, cons);
    const br = cylM(k, a.cyl, M.glass, 0.05, 0.22, 0.08, -0.38 * d.sT, -lc / 2 + 0.05, cons);
    cylM(k, a.cyl, std(k, 0xf08a24, { roughness: 0.8 }), 0.04, 0.16, 0.08, -0.38 * d.sT, -lc / 2 + 0.05, cons);
    k.pickable(cyl, 'Genleşme tankı (konservatör)', () => ['Yağın sıcaklıkla genleşmesini karşılar; seviye göstergeli.', 'Anlık üst yağ ' + fmt(app.live.temps.topOil, 1) + ' °C']);
    k.pickable(buch, 'Buchholz rölesi', () => ['Tank ile genleşme tankı arasındaki boruda; iç arızada biriken gazda alarm, ani yağ akışında açma verir.', 'Bu simülasyonda iç arıza senaryosu yoktur; termik koruma termometre ile gösterilir.']);
    k.pickable(br, 'Nem alıcı (silikajel)', () => ['Genleşme tankına giren havanın nemini tutar; renk değişimi bakım ihtiyacını gösterir.']);
    void pipe;
    sc.lTr = k.label('Trafo', tr, [0, top + 0.95, 0]);

    /* --- OG kablolar: trafo koruma hücresi → arka duvar konsolu → OG buşingleri */
    const mvCab = std(k, 0x8c1c1c, { roughness: 0.6 });
    const xCellR = cx0 + 3 * cw + cw / 2;
    bushTop.forEach((b, j) => {
      const zc = zb + 0.22 + j * 0.09;
      const t1 = k.tube([[xCellR - 0.15, FY + 0.15, cz], [xCellR + 0.1, FY + 0.18, zc + 0.2], [xP1 + 0.3, FY + 0.22, zc], [b[0], FY + 0.25, zc], [b[0], FY + top + 0.7, zc], [b[0], b[1] + 0.12, b[2] - 0.05], [b[0], b[1], b[2]]], 0.022, mvCab, v.root, 90);
      trash.push(t1.geometry);
      if (j === 1) { sc.flows.push({ f: k.flow(t1.userData.curve, 18, 0xfcd34d, 0.018), kind: 'mv' }); k.pickable(t1, 'OG kablo (tek damarlı, XLPE)', () => { const r = app.validResult && app.validResult.values; return r ? ['I1 = ' + fmt(r.I1, 1, 'A') + ' · ' + fmt(s.U1_kV, 1) + ' kV', 'Kablo kesiti ve ekran topraklaması projede seçilir (temsilî).'] : []; }); }
    });
    // OG giriş/çıkış kabloları (döşeme altından hücrelere)
    [0, 1].forEach(i => { const t = k.tube([[cx0 + i * cw, FY + 0.12, cz], [cx0 + i * cw, FY - 0.05, cz + 0.2], [cx0 + i * cw - 0.3, -0.3, zb - 0.6]], 0.025, mvCab, v.root, 30); trash.push(t.geometry); });

    /* --- AG ana dağıtım panosu ve AG bağlantısı */
    const pw = Math.min(1.5, d.lvW - 0.3), pz = zb + 0.06 + 0.3;
    const lvp = k.group(null, xLV, FY, pz); k.explodable(lvp, [0, 0, 0.5]);
    k.box(pw, 0.1, 0.6, M.plasticDark, 0, 0.05, 0, lvp);
    k.box(pw, 2.0, 0.02, M.panelRAL7035, 0, 1.1, -0.29, lvp);
    [-1, 1].forEach(j => k.box(0.02, 2.0, 0.6, M.panelRAL7035, j * (pw / 2 - 0.01), 1.1, 0, lvp));
    k.box(pw, 0.03, 0.6, M.panelRAL7035, 0, 2.1, 0, lvp);
    k.box(pw - 0.04, 1.85, 0.01, M.galv, 0, 1.08, -0.26, lvp);
    // ACB ana şalter, ölçü cihazı, çıkış TMŞ'leri, baralar
    k.rbox(0.42, 0.42, 0.34, 0.02, M.plasticDark, 0, 1.45, -0.08, lvp);
    k.box(0.34, 0.28, 0.02, M.plasticGrey, 0, 1.45, 0.1, lvp);
    sc.acbLed = k.sphere(0.012, M.ledGreen, 0.14, 1.6, 0.11, lvp);
    const ana = k.screen(0.14, 0.14, 192, (g, w, h) => drawAnalyzer(g, w, h, app), lvp, { emissive: 0.9 }); ana.position.set(-pw / 2 + 0.16, 1.85, 0.0); sc.analyzer = ana;
    for (let i = 0; i < 4; i++) { k.rbox(0.11, 0.17, 0.1, 0.008, M.plasticDark, -pw / 2 + 0.2 + i * (pw - 0.4) / 3, 0.8, -0.18, lvp); k.box(0.03, 0.05, 0.03, M.plasticBlue, -pw / 2 + 0.2 + i * (pw - 0.4) / 3, 0.8, -0.12, lvp); }
    ['L1', 'L2', 'L3', 'N'].forEach((p, j) => k.box(pw - 0.1, 0.04, 0.01, M.copper, 0, 1.15 - j * 0.06, -0.24, lvp));
    k.pickable(lvp, 'AG ana dağıtım panosu', () => { const r = app.validResult && app.validResult.values; return r ? ['ACB ana şalter · I2 = ' + fmt(r.I2, 0, 'A') + ' (trafo anma ' + fmt(r.I2n, 0, 'A') + ')', 'AG bara gerilimi yükte ≈ ' + fmt(r.U2load, 0, 'V') + ' (ΔU %' + fmt(r.reg, 2) + ')', 'AG barada Ik3 ≈ ' + fmt(r.Ik / 1e3, 1, 'kA') + ' (yaklaşık) → ACB Icu bundan büyük seçilmeli.', 'Ayrıntı: 3D Pano simülasyonu.'] : []; });
    sc.lLV = k.label('AG ana pano', lvp, [0, 2.35, 0]);
    const lvCab = M.cableBlack;
    lvTop.forEach(b => {
      const off = (b[3] - 1.5) * 0.08;
      const t = k.tube([[b[0], b[1], b[2]], [b[0], FY + Hi - 0.25, b[2] - 0.2], [xP2 - 0.2, FY + Hi - 0.2, zb + 0.5 + off], [xP2 + 0.3, FY + Hi - 0.2, zb + 0.5 + off], [xLV + off * 3, FY + 2.12, pz + off]], 0.028, lvCab, v.root, 80);
      trash.push(t.geometry);
      if (b[3] === 0) sc.flows.push({ f: k.flow(t.userData.curve, 20, 0xfcd34d, 0.02), kind: 'lv' });
    });

    /* --- topraklama: köşk çevresinde halka, köşelerde muayene kutusu, iç ana topraklama barası */
    const ring = k.group(null, 0, 0, 0);
    const rx = d.Lk / 2 + 1.0, rz = d.Dk / 2 + 1.0;
    [[2 * rx, 0, rz], [2 * rx, 0, -rz]].forEach(p => k.box(p[0], 0.012, 0.04, M.copper, 0, 0.035, p[2], ring));
    [rx, -rx].forEach(x => k.box(0.04, 0.012, 2 * rz, M.copper, x, 0.035, 0.0, ring));
    [[rx, rz], [rx, -rz], [-rx, rz], [-rx, -rz]].forEach(p => { k.box(0.3, 0.05, 0.3, M.concreteDark, p[0], 0.03, p[1], ring); cylM(k, a.cyl, M.copper, 0.012, 0.08, p[0], 0.08, p[1], ring); });
    const eb = k.box(0.6, 0.05, 0.012, M.copper, xP2 - 0.45, FY + 0.45, zb + 0.012, v.root);
    const pe = M.PE;
    [[xTr + d.L * 0.3, FY + 0.25, -0.05 + d.Wd / 2], [xLV - 0.3, FY + 0.2, pz], [cx0 + 3 * cw, FY + 0.1, zb + 0.1]].forEach(tg => {
      const t = k.tube([[xP2 - 0.45, FY + 0.45, zb + 0.03], [(xP2 - 0.45 + tg[0]) / 2, FY + 0.08, zb + 0.15], [tg[0], tg[1], tg[2]]], 0.009, pe, v.root, 30); trash.push(t.geometry);
    });
    k.pickable(eb, 'Ana topraklama barası', () => ['Koruma topraklaması: köşk donatısı, trafo tankı, OG hücre gövdeleri, AG pano PE barası.', 'Dış topraklama halkası ve köşe muayene kutuları (temsilî). İşletme (nötr) ve koruma topraklamasının birleştirilmesi topraklama direnci ve dokunma gerilimi hesabına bağlıdır (Elektrik Tesislerinde Topraklamalar Yönetmeliği).', 'Hesap için: 3D Topraklama simülasyonu.']);
    k.pickable(ring, 'Topraklama halkası', () => ['Köşk temelini çevreleyen yatay topraklayıcı (temsilî).']);
    k.label('Topraklama barası', eb, [0, 0.12, 0.05], 'vs-label--sm');

    /* --- soğutma havası akışı (doğal taşınım, hız toplam kayıpla orantılı; yalnız görsel) */
    [-1, 1].forEach(j => {
      const xo = xTr + j * d.L * 0.25;
      const inC = new T.CatmullRomCurve3([[xo, FY + 0.3, zf + 0.2], [xo, FY + 0.25, d.Wd / 2 + d.fd + 0.1], [xo, FY + 0.9, d.Wd / 2 + d.fd + 0.08]].map(p => new T.Vector3(p[0], p[1], p[2])));
      const outC = new T.CatmullRomCurve3([[xo, FY + 0.95, d.Wd / 2 + d.fd + 0.08], [xo, FY + top + 0.4, d.Wd * 0.2], [xo * 0.5 + xTr * 0.5, FY + Hi - 0.35, zb + 0.3], [xo * 0.5 + xTr * 0.5, FY + Hi - 0.42, zb - 0.4]].map(p => new T.Vector3(p[0], p[1], p[2])));
      sc.cool.push(k.flow(inC, 10, 0x7dd3fc, 0.022), k.flow(outC, 16, 0xfb923c, 0.024));
    });

    // kesit sınırları, kamera, ışık
    app.def.scene.bounds = [x0 - 0.3, -x0 + 0.3];
    const vkey = d.sT.toFixed(2);
    if (v.__trViewKey !== vkey) {
      v.__trViewKey = vkey;
      v.setView({ target: [0, 1.25, 0], r: d.Lk * 0.95 + 3.2, theta: 0.32, phi: 1.12, limits: { rMin: 1.2, rMax: 30, phiMax: 1.5 } });
    }
    v.setShadowBox(Math.max(6, d.Lk * 0.85), 50);
    v.sun.position.set(5, 11, 8); v.sun.target.position.set(0, 1, 0); v.sun.target.updateMatrixWorld();
    sc.state = '';
  }

  function cellInfo(app, c) {
    const r = app.validResult && app.validResult.values, s = app.state, L = app.live;
    if (!r) return [];
    const base = ['Metal muhafazalı modüler OG hücre (genel temsil, IEC 62271-200 fikri) · ' + fmt(s.U1_kV, 1) + ' kV'];
    if (c.kind === 'line') return base.concat(['Yük ayırıcı + topraklama ayırıcısı; ring (halka) beslemede giriş/çıkış.', 'Gerilim varlık göstergeleri kapakta.']);
    if (c.kind === 'meas') return base.concat(['Akım ve gerilim trafoları ile OG ölçü (sayaç) — temsilî.', 'Ölçü düzeni dağıtım şirketi ve EPDK ölçüm mevzuatına göre belirlenir.']);
    return base.concat([s.protection === 'kesici' ? 'Vakum kesici + koruma rölesi (aşırı akım/toprak arıza, termik kontak girişi).' : 'Sigortalı yük ayırıcı: OG HRC sigortaları kısa devreyi keser; termik kontak bobinle açtırır.',
      'I1 = ' + fmt(r.I1, 1, 'A') + ' · I1n = ' + fmt(r.I1n, 1, 'A'), 'Durum: ' + (L.tripped ? 'AÇIK (termometre açması)' : 'kapalı')]);
  }
  function trafoInfo(app) {
    const r = app.validResult && app.validResult.values, s = app.state; if (!r) return [];
    return ['Sr = ' + fmt(s.Sr_kVA, 0) + ' kVA · ' + fmt(s.U1_kV, 1) + ' / ' + fmt(s.U2_V / 1000, 2) + ' kV · Dyn11 (örnek) · ONAN',
      'uk %' + fmt(s.uk, 1) + ' (uR %' + fmt(r.ur, 2) + ', uX %' + fmt(r.ux, 2) + ') · P0 ' + fmt(s.P0, 0) + ' W · Pk ' + fmt(s.Pk, 0) + ' W',
      'K = %' + fmt(r.k * 100, 1) + ' · kayıp ' + fmt(r.losses / 1e3, 2, 'kW') + ' · η %' + fmt(r.eff, 2),
      'Isıl model: ' + (s.thermalOn ? 'üretici verisi' : 'IEC 60076-7 ONAN varsayılanları') + '.'];
  }

  /* kanvas çizimleri */
  function drawWarn(g, w, h) {
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2c200'; g.strokeStyle = '#111'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w - 16, h * 0.66); g.lineTo(16, h * 0.66); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(w / 2 + 6, 24); g.lineTo(w / 2 - 8, 50); g.lineTo(w / 2 + 2, 50); g.lineTo(w / 2 - 6, 68); g.lineTo(w / 2 + 10, 42); g.lineTo(w / 2, 42); g.closePath(); g.fill();
    g.font = 'bold 12px Arial'; g.textAlign = 'center'; g.fillText('DİKKAT! YÜKSEK', w / 2, h * 0.8); g.fillText('GERİLİM', w / 2, h * 0.93);
  }
  function drawCell(g, w, h, c, app) {
    const s = app.state, L = app.live || {};
    g.fillStyle = '#d7d9d6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0a1628'; g.fillRect(10, 10, w - 20, 44); g.fillStyle = '#fcd34d'; g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.fillText(c.short, w / 2, 42);
    g.strokeStyle = '#1b2430'; g.lineWidth = 6; g.lineCap = 'round';
    const cx = w / 2, y0 = 120;
    g.beginPath(); g.moveTo(20, y0); g.lineTo(w - 20, y0); g.stroke(); // bara
    const open = c.kind === 'tp' && L.tripped;
    g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx, y0 + 60); g.stroke();
    if (c.kind === 'tp' && s.protection === 'kesici') {
      g.strokeRect(cx - 24, y0 + 60, 48, 48);
      g.beginPath(); g.moveTo(cx, y0 + 60); g.lineTo(open ? cx + 22 : cx, y0 + 108); g.stroke();
    } else {
      g.beginPath(); g.moveTo(cx, y0 + 60); g.lineTo(open ? cx + 30 : cx, y0 + 110); g.stroke();
      g.beginPath(); g.arc(cx, y0 + 60, 6, 0, Math.PI * 2); g.fillStyle = '#1b2430'; g.fill();
    }
    if (c.kind === 'tp' && s.protection === 'sigorta') { g.strokeRect(cx - 12, y0 + 130, 24, 50); g.beginPath(); g.moveTo(cx, y0 + 130); g.lineTo(cx, y0 + 180); g.stroke(); }
    if (c.kind === 'meas') { g.beginPath(); g.arc(cx - 14, y0 + 150, 18, 0, Math.PI * 2); g.arc(cx + 14, y0 + 150, 18, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx, y0 + 112); g.lineTo(cx, y0 + 260); g.stroke();
    // topraklama ayırıcısı
    g.beginPath(); g.moveTo(cx, y0 + 220); g.lineTo(cx + 40, y0 + 220); g.lineTo(cx + 40, y0 + 236); g.moveTo(cx + 26, y0 + 240); g.lineTo(cx + 54, y0 + 240); g.moveTo(cx + 32, y0 + 248); g.lineTo(cx + 48, y0 + 248); g.stroke();
    g.fillStyle = '#1b2430'; g.beginPath(); g.moveTo(cx - 12, y0 + 262); g.lineTo(cx + 12, y0 + 262); g.lineTo(cx, y0 + 280); g.fill(); // kablo başlığı
    // konum göstergesi ve kumanda delikleri
    g.fillStyle = open ? '#15803d' : '#b91c1c'; g.fillRect(cx - 40, y0 + 310, 80, 30);
    g.fillStyle = '#fff'; g.font = 'bold 22px Arial'; g.fillText(open ? 'O' : 'I', cx, y0 + 333);
    g.fillStyle = '#2d333b'; [[cx - 30, y0 + 380], [cx + 30, y0 + 380]].forEach(p => { g.beginPath(); g.arc(p[0], p[1], 14, 0, Math.PI * 2); g.fill(); });
    g.fillStyle = '#3a4250'; g.font = '15px Arial'; g.fillText(c.kind === 'tp' ? (s.protection === 'kesici' ? 'KESİCİ' : 'SİGORTALI Y.A.') : c.kind === 'meas' ? 'AT / GT' : 'YÜK AYIRICI', cx, y0 + 430);
    g.fillText(fmt(s.U1_kV, 1) + ' kV', cx, y0 + 452);
  }
  function drawRelay(g, w, h, app) {
    const r = app.validResult && app.validResult.values, L = app.live || {};
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 15px monospace'; g.fillText('KORUMA RÖLESİ', 8, 20);
    if (!r) return;
    g.fillStyle = '#e2e8f0'; g.font = 'bold 18px monospace'; g.fillText('I1 ' + fmt(r.I1, 1) + ' A', 8, 50);
    g.fillStyle = L.tripped ? '#ef4444' : L.alarm ? '#f59e0b' : '#4ade80'; g.font = 'bold 18px monospace';
    g.fillText(L.tripped ? 'AÇMA: TERMİK' : L.alarm ? 'ALARM: YAĞ' : 'NORMAL', 8, 82);
  }
  function drawAnalyzer(g, w, h, app) {
    const r = app.validResult && app.validResult.values;
    g.fillStyle = '#04121f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#22d3ee'; g.font = 'bold 18px monospace'; g.fillText('AG ANALİZÖR', 10, 24);
    if (!r) return;
    const rows = [['U', fmt(r.U2load, 0) + ' V'], ['I', fmt(r.I2, 0) + ' A'], ['P', fmt(r.P / 1e3, 0) + ' kW'], ['K', '%' + fmt(r.k * 100, 0)]];
    g.font = 'bold 22px monospace';
    rows.forEach((x, i) => { g.fillStyle = '#94a3b8'; g.textAlign = 'left'; g.fillText(x[0], 10, 60 + i * 34); g.fillStyle = '#fcd34d'; g.textAlign = 'right'; g.fillText(x[1], w - 10, 60 + i * 34); });
    g.textAlign = 'left';
  }
  function drawDial(g, w, h, app) {
    const s = app.state, L = app.live || { temps: { topOil: 20 } };
    const cx = w / 2, cy = h / 2, R = w * 0.46;
    g.fillStyle = '#1b2430'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4f4f0'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    const a0 = Math.PI * 0.75, span = Math.PI * 1.5, ang = t => a0 + clamp(t / 140, 0, 1) * span;
    // alarm–açma ve açma üstü bölgeleri
    g.lineWidth = 12;
    g.strokeStyle = '#f59e0b'; g.beginPath(); g.arc(cx, cy, R - 14, ang(s.alarmOil), ang(s.tripOil)); g.stroke();
    g.strokeStyle = '#ef4444'; g.beginPath(); g.arc(cx, cy, R - 14, ang(s.tripOil), ang(140)); g.stroke();
    g.strokeStyle = '#111'; g.lineWidth = 3; g.fillStyle = '#111'; g.font = 'bold 18px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let t = 0; t <= 140; t += 20) { const a = ang(t); g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); g.lineTo(cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24)); g.stroke(); g.fillText(String(t), cx + Math.cos(a) * (R - 44), cy + Math.sin(a) * (R - 44)); }
    g.font = 'bold 16px Arial'; g.fillText('°C YAĞ', cx, cy + R * 0.5);
    const a = ang(L.temps.topOil);
    g.strokeStyle = '#b91c1c'; g.lineWidth = 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22)); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cy, 10, 0, Math.PI * 2); g.fill();
  }
  function drawPlate(g, w, h, app) {
    const s = app.state;
    g.fillStyle = '#c9ced3'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#333'; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#111'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.fillText('GÜÇ TRAFOSU · ÖRNEK ETİKET', w / 2, 34);
    g.textAlign = 'left'; g.font = '19px Arial';
    const rows = [['Sr', fmt(s.Sr_kVA, 0) + ' kVA'], ['U1 / U2', fmt(s.U1_kV, 1) + ' kV / ' + s.U2_V + ' V'], ['Bağlantı', 'Dyn11'], ['uk', '%' + fmt(s.uk, 1)], ['P0 / Pk', fmt(s.P0, 0) + ' W / ' + fmt(s.Pk, 0) + ' W'], ['Soğutma', 'ONAN · IEC 60076']];
    rows.forEach((r, i) => { g.fillText(r[0], 20, 66 + i * 30); g.fillText(r[1], 140, 66 + i * 30); });
  }

  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const v = res.values;
    sc.front.visible = !s.cutaway; sc.roof.visible = !s.cutaway;
    const sp = k.reducedMotion ? 0 : 1;
    sc.flows.forEach(f => { f.f.speed = sp * clamp(v.k, 0, 1.5) * (f.kind === 'mv' ? 0.25 : 0.4); });
    const heat = clamp(v.losses / Math.max(1, v.P0 + Number(s.Pk)), 0, 2);
    sc.cool.forEach(f => { f.speed = sp * (live.tripped ? 0 : 0.08 + 0.35 * heat); });
    sc.lMV.set('OG hücreler · ' + fmt(s.U1_kV, 1) + ' kV · I1 ' + fmt(v.I1, 1) + ' A');
    sc.lLV.set('AG pano · ' + fmt(v.I2, 0) + ' A · ' + fmt(v.U2load, 0) + ' V');
    sc.lLV.level(live.tripped ? 'bad' : v.k > 1 ? 'warn' : 'ok');
    sc.analyzer.redraw(); sc.plate.redraw();
    sc.acbLed.material = live.tripped ? k.mats.ledOff : k.mats.ledGreen;
    sc.state = '';
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    const st = (live.tripped ? 't' : live.alarm ? 'a' : 'n') + s.protection;
    if (st !== sc.state) {
      sc.state = st;
      sc.cells.forEach(c => { c.scr.redraw(); c.leds.forEach(l => { l.material = live.tripped && c.c.kind === 'tp' ? k.mats.ledOff : k.mats.ledRed; }); });
      if (sc.relay) sc.relay.redraw();
    }
    const now = performance.now();
    if (now - (sc.last || 0) < 200) return;
    sc.last = now;
    const T = k.T, to = live.temps.topOil, hs = live.temps.hotSpot;
    sc.dial.redraw();
    // sargı ısı rengi: sıcak nokta 40 °C → mavi, 140 °C → kırmızı
    const h = clamp((hs - 40) / 100, 0, 1);
    k.heat(h, sc.wMat.emissive); sc.wMat.emissive.convertSRGBToLinear(); sc.wMat.emissiveIntensity = 0.25 + h * 1.4;
    const v = res.values;
    sc.lTr.set('Trafo ' + fmt(s.Sr_kVA, 0) + ' kVA · K %' + fmt(v.k * 100, 0) + ' · θyağ ' + fmt(to, 0) + ' °C · θh ' + fmt(hs, 0) + ' °C' + (live.tripped ? ' · AÇTI' : live.alarm ? ' · ALARM' : ''));
    sc.lTr.level(live.tripped ? 'bad' : live.alarm || v.k > 1 ? 'warn' : 'ok');
    void T;
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması */
  function view2d(g, W, H, res, s, live) {
    const v = res.values;
    const col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', cu: '#c77b4a', amb: '#fcd34d' };
    const sm = W < 560, f = sm ? 10 : 12;
    g.lineWidth = 2; g.lineCap = 'round'; g.textBaseline = 'alphabetic';
    const cx = sm ? W * 0.3 : W * 0.32;
    const tx = cx + (sm ? 26 : 40);
    let y = 64;
    const txt = (t, x, yy, c, b, al) => { g.fillStyle = c || col.text; g.font = (b ? 'bold ' : '') + f + 'px Inter, sans-serif'; g.textAlign = al || 'left'; g.fillText(t, x, yy); };
    txt('Trafo merkezi tek hat şeması', 16, 62, col.text, true);
    y = 92;
    // OG şebeke
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx - 40, y); g.lineTo(cx + 40, y); g.moveTo(cx - 30, y - 8); g.lineTo(cx + 30, y - 8); g.stroke();
    txt('OG şebeke · SkQ ' + fmt(s.SkQ_MVA, 0) + ' MVA', tx + 10, y - 2, col.dim);
    // ring giriş/çıkış ve bara
    const yb = y + 34;
    g.beginPath(); g.moveTo(cx, y); g.lineTo(cx, yb); g.stroke();
    g.strokeStyle = col.cu; g.lineWidth = 5; g.beginPath(); g.moveTo(cx - 70, yb); g.lineTo(cx + 70, yb); g.stroke(); g.lineWidth = 2;
    txt('OG bara ' + fmt(s.U1_kV, 1) + ' kV', tx + 34, yb + 4, col.dim);
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx - 55, yb); g.lineTo(cx - 55, yb + 24); g.moveTo(cx - 55, yb + 24); g.lineTo(cx - 45, yb + 40); g.stroke();
    txt('çıkış', cx - 55, yb + 56, col.dim, false, 'center');
    // koruma
    const open = live.tripped;
    const yp = yb + 30;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx, yb); g.lineTo(cx, yp); g.stroke();
    g.strokeStyle = open ? col.bad : col.ok;
    if (s.protection === 'kesici') { g.strokeRect(cx - 10, yp, 20, 20); g.beginPath(); g.moveTo(cx, yp); g.lineTo(cx + (open ? 14 : 0), yp + 20); g.stroke(); }
    else { g.beginPath(); g.moveTo(cx, yp); g.lineTo(cx + (open ? 14 : 0), yp + 18); g.stroke(); g.strokeRect(cx - 5, yp + 22, 10, 16); }
    txt((s.protection === 'kesici' ? 'Kesici' : 'Sigortalı yük ayırıcı') + (open ? ' · AÇIK' : ''), tx, yp + 14, open ? col.bad : col.text);
    txt('I1 ' + fmt(v.I1, 1) + ' A / I1n ' + fmt(v.I1n, 1) + ' A', tx, yp + 30, col.dim);
    // trafo
    const yt = yp + 70;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx, yp + 40); g.lineTo(cx, yt - 18); g.stroke();
    g.beginPath(); g.arc(cx, yt - 4, 16, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(cx, yt + 18, 16, 0, Math.PI * 2); g.stroke();
    const kl = v.k > 1 ? col.bad : v.k > 0.8 ? col.warn : col.ok;
    txt(fmt(s.Sr_kVA, 0) + ' kVA · ' + fmt(s.U1_kV, 1) + '/' + fmt(s.U2_V / 1000, 2) + ' kV · Dyn11', tx, yt - 2, col.text, true);
    txt('uk %' + fmt(s.uk, 1) + ' · K %' + fmt(v.k * 100, 0) + ' · η %' + fmt(v.eff, 2), tx, yt + 14, kl);
    txt('P0 ' + fmt(v.P0, 0) + ' W + Pk·K² ' + fmt(v.Pcu, 0) + ' W', tx, yt + 30, col.dim);
    // AG
    const ya = yt + 60;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx, yt + 34); g.lineTo(cx, ya); g.stroke();
    g.strokeStyle = open ? col.dim : col.ok; g.strokeRect(cx - 9, ya, 18, 18);
    txt('ACB · I2 ' + fmt(v.I2, 0) + ' / ' + fmt(v.I2n, 0) + ' A', tx, ya + 14, col.text);
    const yB = ya + 40;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx, ya + 18); g.lineTo(cx, yB); g.stroke();
    g.strokeStyle = col.cu; g.lineWidth = 5; g.beginPath(); g.moveTo(cx - 80, yB); g.lineTo(cx + 80, yB); g.stroke(); g.lineWidth = 2;
    txt('AG ≈ ' + fmt(v.U2load, 0) + ' V · Ik ≈ ' + fmt(v.Ik / 1e3, 1) + ' kA', tx + 44, yB + 4, col.dim);
    g.strokeStyle = col.line;
    [-50, 0, 50].forEach(dx => { g.beginPath(); g.moveTo(cx + dx, yB); g.lineTo(cx + dx, yB + 34); g.stroke(); g.beginPath(); g.moveTo(cx + dx - 6, yB + 26); g.lineTo(cx + dx, yB + 36); g.lineTo(cx + dx + 6, yB + 26); g.stroke(); });
    txt('Yük P ' + fmt(v.P / 1e3, 0) + ' kW · Q ' + fmt(v.Q / 1e3, 0) + ' kVAr · cosφ ' + fmt(s.cos, 2), cx - 80, yB + 54, col.text);
    // sıcaklık çubukları
    const bx = sm ? 16 : W - 190, by = sm ? yB + 80 : 100, bh = sm ? Math.max(90, H - by - 40) : Math.min(260, H - 160), bw = 34;
    const Y = t => by + bh - clamp(t / 140, 0, 1) * bh;
    [['Üst yağ', live.temps.topOil, v.temps.topOil], ['Sıcak nokta', live.temps.hotSpot, v.temps.hotSpot]].forEach((r, i) => {
      const x = bx + i * (bw + 60);
      g.strokeStyle = '#2c4466'; g.strokeRect(x, by, bw, bh);
      const c = r[1] >= s.tripOil && i === 0 ? col.bad : r[1] >= s.alarmOil && i === 0 ? col.warn : i === 1 && r[1] > 120 ? col.bad : i === 1 && r[1] > 98 ? col.warn : col.ok;
      g.fillStyle = c; g.fillRect(x + 2, Y(r[1]), bw - 4, by + bh - Y(r[1]));
      g.strokeStyle = col.text; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x - 4, Y(r[2])); g.lineTo(x + bw + 4, Y(r[2])); g.stroke(); g.setLineDash([]);
      txt(r[0], x + bw / 2, by + bh + 16, col.dim, false, 'center');
      txt(fmt(r[1], 0) + ' °C', x + bw / 2, by - 8, col.text, true, 'center');
    });
    g.strokeStyle = col.warn; g.beginPath(); g.moveTo(bx - 6, Y(s.alarmOil)); g.lineTo(bx + bw + 6, Y(s.alarmOil)); g.stroke();
    g.strokeStyle = col.bad; g.beginPath(); g.moveTo(bx - 6, Y(s.tripOil)); g.lineTo(bx + bw + 6, Y(s.tripOil)); g.stroke();
    txt('kesikli: kararlı hedef · ' + clock(live.clock), bx, by + bh + 32, col.dim);
    txt('Isıl sonuçlar ' + (s.thermalOn ? 'üretici verisiyle' : 'IEC 60076-7 varsayılanlarıyla') + ' hesaplanır.', 16, H - 10, col.dim);
  }

  /* ---------------------------------------------------------------- senaryolar */
  const scen = o => Object.assign(defaults(), o);
  const pre = (sr, o) => { const p = TR.PRESETS[sr]; return scen(Object.assign({ SrSel: String(sr), Sr_kVA: sr, P0: p.P0, Pk: p.Pk, uk: p.uk }, o)); };
  VS.register({
    id: 'trafo', title: '3D Trafo ve Trafo Merkezi Simülasyonu',
    defaults: defaults,
    initLive: initLive,
    autoRun: true,
    startText: 'Isıl simülasyon soğuk başlangıçtan çalışıyor: 1 s = 10 dakika.',
    start: app => { app.live = initLive(app.state); app._startedOnce = true; app.invalidate(); },
    scenarios: [
      { id: 'normal', name: 'Fabrika trafosu · 630 kVA normal işletme', desc: '34,5/0,4 kV (örnek), 450 kW, cosφ 0,95: K ≈ %75. Sıcaklıkların kararlı hale yaklaşmasını izleyin.', state: pre(630, { P_kW: 450 }), start: true },
      { id: 'over', name: 'Yaz günü aşırı yük · termometre açması', desc: '630 kVA, 650 kW cosφ 0,9 (K ≈ %115), köşk içi 40 °C: üst yağ alarm ve açma ayarlarına (örnek) ulaşır.', state: pre(630, { P_kW: 650, cos: 0.9, ambient: 40 }), start: true },
      { id: 'low', name: 'Düşük yük · boşta kayıp baskın', desc: '1600 kVA trafo yalnız 200 kW besliyor: verim eğrisinde K_opt’un çok altındasınız.', state: pre(1600, { P_kW: 200 }) },
      { id: 'cycle', name: 'Günlük yük çevrimi · 1000 kVA', desc: 'İki vardiyalı fabrika, tepe 900 kW: gece–gündüz yük değişimini ve sıcaklığın gecikmeli izlemesini görün.', state: pre(1000, { P_kW: 900, cycle: true, cos: 0.93 }), start: true },
      { id: 'cos', name: 'Düşük cosφ · aynı kW, daha çok kVA', desc: '400 kVA, 300 kW, cosφ 0,75: kompanzasyonsuz tesiste trafo yüklenmesi %100’e dayanır.', state: pre(400, { P_kW: 300, cos: 0.75 }) },
      { id: 'sc', name: 'Büyük trafo · AG kısa devre akımı', desc: '2500 kVA, uk %6, 10,5 kV (örnek) ve SkQ 250 MVA: AG barada yaklaşık Ik ve ACB kesme kapasitesi ihtiyacı.', state: pre(2500, { P_kW: 1800, U1sel: '10.5', U1_kV: 10.5, SkQ_MVA: 250 }) }
    ],
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => live.tripped ? { level: 'bad', text: 'Termometre açması · trafo devre dışı' } : live.alarm ? { level: 'warn', text: 'Yağ sıcaklığı alarmı' } : null,
    reportInputs: (s, app) => [{ group: 'Simülasyon', label: 'Simülasyon saati', value: clock(app.live.clock) + ' (1 s = ' + MIN_PER_S + ' dk)' }, { group: 'Simülasyon', label: 'Isıl model', value: s.thermalOn ? 'Üretici verisi' : 'IEC 60076-7 ONAN varsayılanları' }],
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-4, 4] },
    view2d: view2d
  });
})();
