/* VoltSim · 3D Elektrikli Araç Şarj Merkezi Simülasyonu
 * Hesap: VoltSimEngine.sarj (seçili noktanın tek araç sonucu: SOC → enerji, OBC/DC kabul sınırı, CC–CV eğrisi, verim,
 * RCD ve mevzuat kontrolleri) + VoltSimEngine.ext.sarj (calc/sarj.js): şarj merkezi dakikalık simülasyonu — araç başına
 * farklı batarya/SOC/kabul gücü, önceliğe göre dinamik yük paylaşımı (OCPP yük yönetimi; AC'de IEC 61851-1 en küçük
 * pilot akımı 6 A), bina baz yükü, çatı GES'i, batarya tamponu, üç zamanlı tarife; nokta başına besleme devresi
 * (koruma, kablo Iz, gerilim düşümü, RCD tipi).
 * Sahne: motorun/calc'ın zaman serisini hızlandırılmış oynatır; animasyondan sonuç türetilmez. Nokta sayısında yapay
 * sınır yoktur; park yerleri satırlara sarılır. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const SJ = E.sarj, PROF = SJ.PROFILES, X = E.ext.sarj;
  const BAY = 3.2, ROWZ = 13, PER_ROW = 8;       // park yeri aralığı, sıra aralığı (m), bir sıradaki yer (yerleşim, sınır değil)
  const ISLAND_X = 1.75;
  const IN_LIST = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630];
  const CARS = {
    compact: { name: 'Kompakt (50 kWh, 11 kW OBC)', capacity: 50, obcPhases: 3, obcI: 16, dcMax: 100, inlet: 'ccs2' },
    sedan: { name: 'Sedan (77 kWh, 11 kW OBC)', capacity: 77, obcPhases: 3, obcI: 16, dcMax: 150, inlet: 'ccs2' },
    suv: { name: 'SUV (100 kWh, 22 kW OBC)', capacity: 100, obcPhases: 3, obcI: 32, dcMax: 200, inlet: 'ccs2' },
    van: { name: 'Hafif ticari (75 kWh, 1F 7,4 kW OBC)', capacity: 75, obcPhases: 1, obcI: 32, dcMax: 80, inlet: 'ccs2' },
    taxi: { name: 'Taksi (64 kWh, 11 kW OBC)', capacity: 64, obcPhases: 3, obcI: 16, dcMax: 100, inlet: 'ccs2' },
    chademo: { name: 'Eski model (40 kWh, CHAdeMO)', capacity: 40, obcPhases: 1, obcI: 32, dcMax: 46, inlet: 'chademo' }
  };
  const CONN = { type2s: 'Type 2 soket (kullanıcı kablosu)', type2c: 'Type 2 sabit kablolu', ccs2: 'CCS2 (DC)', chademo: 'CHAdeMO (DC)' };
  const RCD = { 'A': 'Tip A (tek başına)', 'A-RDCDD': 'Tip A + RDC-DD (6 mA DC algılama)', 'B': 'Tip B', 'none': 'Yok' };
  const PRIO = { 1: 'Düşük', 2: 'Normal', 3: 'Yüksek' };
  const MONTHS = [[15, 'Ocak'], [74, 'Mart'], [135, 'Mayıs'], [172, 'Haziran'], [227, 'Ağustos'], [288, 'Ekim'], [349, 'Aralık']];

  /* ---------------------------------------------------------------- noktalar */
  /** Besleme devresini nokta gücüne göre boyutlandırır: In ≥ Ib, kablo Iz ≥ In (seçili döşeme yöntemi). */
  function autoSize(p, effDC) {
    const c = X.circuit({ profile: p.profile, stationP: p.stationP, eff: effDC / 100, In: 1, S: 1.5, L: p.L, method: p.method, rcd: p.rcd });
    p.In = IN_LIST.find(v => v >= c.Ib - 1e-9) || IN_LIST[IN_LIST.length - 1];
    p.prot = p.In <= 63 ? 'MCB' : 'MCCB';
    const ph = PROF[p.profile].kind === 'AC' ? PROF[p.profile].phases : 3;
    // akım taşıma (Iz ≥ In) ve gerilim düşümü (ΔU ≤ %3) birlikte; pratikte en az 2,5 mm²
    p.S = E.CABLE_SIZES.find(S => S >= 2.5 && E.cableIz(S, p.method, ph === 1 ? 2 : 3) >= p.In && X.circuit({ profile: p.profile, stationP: p.stationP, eff: effDC / 100, In: p.In, S: S, L: p.L, method: p.method, rcd: p.rcd }).vd <= 3) || E.CABLE_SIZES[E.CABLE_SIZES.length - 1];
    return p;
  }
  function mkPoint(i, profile, car, soc0, soc1, o) {
    const dc = PROF[profile].kind === 'DC';
    const p = Object.assign({ name: 'Nokta ' + (i + 1), profile: profile, stationP: dc ? PROF[profile].P : 0, conn: dc ? 'ccs2' : 'type2c', prot: 'MCB', In: 16, S: 6, L: 20 + 6 * i, method: dc ? 'E' : 'C', rcd: dc ? 'A' : 'A-RDCDD', meter: true,
      car: Object.assign({ preset: car }, JSON.parse(JSON.stringify(CARS[car])), { soc0: soc0, soc1: soc1 }), plugged: true, enabled: true, priority: 2 }, o || {});
    delete p.car.name;
    return autoSize(p, 94);
  }
  function defaults() {
    return {
      points: [mkPoint(0, 'AC11', 'sedan', 20, 80), mkPoint(1, 'AC22', 'suv', 35, 90), mkPoint(2, 'AC11', 'van', 15, 80), mkPoint(3, 'DC60', 'compact', 10, 80)],
      sel: 0,
      connMode: 'limit', siteKW: 80, trafoKVA: 250, dlm: true,
      baseProfile: 'office', basePeak: 25, startHour: 8, deadline: 0,
      pvKWp: 0, pvDoy: 172, batKWh: 0, batKW: 0, batSoc0: 90,
      curve: 'typical', effAC: 90, effDC: 94,
      tariffMode: 'tou', priceSingle: 3.2, priceDay: 3.0, pricePeak: 4.6, priceNight: 1.9,
      publicService: false, salePrice: 0, speed: 'auto'
    };
  }
  const limitOf = s => (s.connMode === 'trafo' ? s.trafoKVA * 0.95 : s.siteKW);
  const kindOf = p => (PROF[p.profile] || PROF.AC11).kind;
  const compatible = p => kindOf(p) === 'AC' || p.conn === p.car.inlet;
  const clock = (h0, min) => { const m = Math.round(((h0 * 60 + min) % 1440 + 1440) % 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const dur = m => (m === null || m === undefined ? '—' : VS.fmtDuration(m));

  /* ---------------------------------------------------------------- hesap */
  function validatePoints(s) {
    const err = [];
    if (!s.points.length) err.push('En az bir şarj noktası gerekli.');
    s.points.forEach(p => {
      const c = p.car, n = p.name + ': ';
      if (!(c.capacity >= 10 && c.capacity <= 250)) err.push(n + 'batarya kapasitesi 10–250 kWh olmalı.');
      if (!(c.soc0 >= 0 && c.soc1 <= 100 && c.soc1 > c.soc0)) err.push(n + 'hedef SOC başlangıçtan büyük olmalı (0–100 %).');
      if (!(c.obcI >= 6 && c.obcI <= 63)) err.push(n + 'OBC akımı 6–63 A olmalı.');
      if (!(c.dcMax >= 10 && c.dcMax <= 400)) err.push(n + 'DC kabul gücü 10–400 kW olmalı.');
      if (kindOf(p) === 'DC' && !(p.stationP >= 10 && p.stationP <= 400)) err.push(n + 'DC istasyon gücü 10–400 kW olmalı.');
      if (p.prot === 'MCB' && p.In > 63) err.push(n + 'MCB en çok 63 A; daha büyük akımda MCCB seçin.');
      if (!(p.L > 0)) err.push(n + 'kablo uzunluğu pozitif olmalı.');
    });
    if (!(limitOf(s) > 0)) err.push('Bağlantı gücü pozitif olmalı.');
    return err;
  }
  function hubInput(s) {
    return {
      points: s.points.map(p => ({ profile: p.profile, stationP: p.stationP, capacity: p.car.capacity, soc0: p.car.soc0, soc1: p.car.soc1, obcPhases: p.car.obcPhases, obcI: p.car.obcI, dcMax: p.car.dcMax,
        eff: (kindOf(p) === 'AC' ? s.effAC : s.effDC) / 100, priority: p.priority, active: p.plugged && p.enabled, compatible: compatible(p) })),
      siteKW: limitOf(s), dlm: s.dlm, base: { profile: s.baseProfile, peakKW: s.basePeak }, pv: { kWp: s.pvKWp, doy: s.pvDoy },
      bat: s.batKWh > 0 ? { kWh: s.batKWh, kW: s.batKW, soc0: s.batSoc0 } : null, startHour: s.startHour, curve: s.curve,
      tariff: { mode: s.tariffMode, single: s.priceSingle, day: s.priceDay, peak: s.pricePeak, night: s.priceNight }
    };
  }
  function compute(s) {
    const errs = validatePoints(s);
    if (errs.length) return { ok: false, errors: errs, warnings: [], checks: [], values: {} };
    const sel = Math.max(0, Math.min(s.sel, s.points.length - 1)), p = s.points[sel], lim = limitOf(s);
    const r = SJ.compute({ profile: p.profile, stationP: p.stationP, capacity: p.car.capacity, soc0: p.car.soc0, soc1: p.car.soc1, obcPhases: p.car.obcPhases, obcI: p.car.obcI, dcMax: p.car.dcMax,
      effAC: s.effAC, effDC: s.effDC, curve: s.curve, nPoints: 1, siteKW: lim, publicService: s.publicService });
    if (!r.ok) { r.errors = r.errors.map(e => p.name + ': ' + e); return r; }
    const hub = X.simulateHub(hubInput(s));
    const circ = s.points.map(q => X.circuit({ profile: q.profile, stationP: q.stationP, eff: s.effDC / 100, In: q.In, S: q.S, L: q.L, method: q.method, rcd: q.rcd }));
    const v = r.values, hp = hub.points[sel];
    const sold = hub.chargeE, revenue = s.publicService ? sold * s.salePrice : 0;
    Object.assign(v, { sel: sel, limit: lim, hub: hub, circ: circ, selFinish: hp.finishMin, revenue: revenue, margin: revenue - hub.cost });
    const ck = r.checks;
    ck.push({ id: 'peak', label: 'Bağlantı gücü (tepe talep)', status: hub.overMin > 0 ? 'fail' : hub.peak > lim * 0.95 ? 'warn' : 'ok', detail: 'Tepe ' + fmt(hub.peak, 1) + ' kW (' + clock(s.startHour, hub.peakAt) + ') / sınır ' + fmt(lim, 1) + ' kW' + (hub.overMin ? ' · ' + hub.overMin + ' dk aşım' : '') + (s.dlm ? ' · OCPP yük yönetimi açık' : ' · yük yönetimi kapalı'), ref: s.connMode === 'trafo' ? 'Trafo ' + s.trafoKVA + ' kVA × 0,95' : 'Bağlantı anlaşması' });
    const paused = hub.points.filter(x => x.pausedMin > 0);
    if (paused.length) ck.push({ id: 'pause', label: 'Duraklatılan oturumlar (6 A alt sınırı)', status: 'info', detail: paused.length + ' nokta toplam ' + paused.reduce((a, x) => a + x.pausedMin, 0) + ' dk bekledi: AC oturumlar 6 A’in altına indirilemez, yetmeyen güçte sıradaki oturum duraklatılır.', ref: 'IEC 61851-1 (kontrol pilotu)' });
    s.points.forEach((q, i) => {
      const c = circ[i];
      if (!compatible(q)) ck.push({ id: 'conn' + i, label: q.name + ' · soket uyumu', status: 'fail', detail: CONN[q.conn] + ' tabancası aracın ' + (q.car.inlet === 'chademo' ? 'CHAdeMO' : 'CCS2') + ' soketine uymaz; oturum başlamaz.', ref: null });
      if (!c.izTable) ck.push({ id: 'iz' + i, label: q.name + ' · kablo akım taşıma', status: 'warn', detail: q.S + ' mm² için seçilen döşeme yönteminde tablo değeri yok (TS HD 60364-5-52); kesit ya da yöntem değiştirin.', ref: 'TS HD 60364-5-52' });
      else if (!c.coord) ck.push({ id: 'coord' + i, label: q.name + ' · koruma–kablo koordinasyonu', status: 'fail', detail: 'Ib ' + fmt(c.Ib, 1) + ' A ≤ In ' + q.In + ' A ≤ Iz ' + fmt(c.Iz, 0) + ' A sağlanmıyor (' + q.S + ' mm² ' + q.method + ').', ref: 'TS HD 60364-4-43' });
      if (c.vd > 3) ck.push({ id: 'vd' + i, label: q.name + ' · gerilim düşümü', status: c.vd > 5 ? 'fail' : 'warn', detail: '%' + fmt(c.vd, 2) + ' (' + q.L + ' m, ' + q.S + ' mm²) — tasarım hedefi ≤ %3', ref: 'TS HD 60364-5-52' });
      if (!c.rcdOk) ck.push({ id: 'rcd' + i, label: q.name + ' · kaçak akım koruması', status: 'fail', detail: c.kind === 'AC' ? RCD[q.rcd] + ' yetmez: Tip A + 6 mA DC algılama (RDC-DD, cihazda ya da ayrı) veya Tip B gerekir.' : 'DC cihazın AC beslemesi için RCD yok.', ref: 'TS HD 60364-7-722' });
      if (s.publicService && !q.meter) ck.push({ id: 'meter' + i, label: q.name + ' · enerji ölçümü', status: 'warn', detail: 'Ücretli hizmette satılan enerji nokta bazında ölçülmelidir (MID onaylı sayaç).', ref: null });
    });
    const bad = s.points.filter((q, i) => !circ[i].coord || !circ[i].rcdOk || circ[i].vd > 5).length;
    ck.push({ id: 'circ', label: 'Nokta besleme devreleri', status: bad ? 'fail' : 'ok', detail: bad ? bad + ' noktada koruma/kablo/RCD uygunsuz' : s.points.length + ' nokta: Ib ≤ In ≤ Iz, ΔU ve RCD uygun', ref: 'TS HD 60364-7-722' });
    if (s.salePrice > 0 && !s.publicService) ck.push({ id: 'billing', label: 'Ücretlendirme ve mevzuat kapsamı', status: 'fail', detail: 'Kullanıcılardan enerji bedeli alınıyor: bu, özel (ticari olmayan) kullanım değildir. Herkese açık ücretli şarj hizmeti senaryosunu seçin.', ref: 'Şarj Hizmeti Yönetmeliği' });
    if (s.deadline > 0) ck.push({ id: 'deadline', label: 'Hedef süre', status: hub.allDone && hub.lastFinish <= s.deadline ? 'ok' : 'warn', detail: 'Tüm araçlar ' + (hub.allDone ? dur(hub.lastFinish) : 'bitmiyor') + ' / hedef ' + dur(s.deadline), ref: null });
    if (s.pvKWp > 0 || s.batKWh > 0) ck.push({ id: 'der', label: 'GES / batarya katkısı', status: 'info', detail: 'GES ' + fmt(hub.pvE, 1) + ' kWh (açık gün)' + (s.batKWh > 0 ? ' · batarya deşarj ' + fmt(hub.batOut, 1) + ' kWh' : ''), ref: null });
    r.assumptions = r.assumptions.filter(a => a.indexOf('Eşzamanlı noktalar') < 0).concat([
      'Şarj merkezi: her nokta kendi aracı, bataryası ve SOC’siyle 1 dk adımla simüle edilir; paylaşım önceliğe göre (yüksek öncelik önce), kademe içinde eşit su doldurma.',
      'AC oturumlarda en küçük akım 6 A’dir (IEC 61851-1 kontrol pilotu); yetmeyen güçte oturum duraklatılır. DC’de alt sınır yok kabul edildi.',
      'Bina baz yükü temsili saatlik profil; GES motorun güneş konumu/açık gök modeliyle (20° eğim, güney, PR 0,80); şebekeye ihracat yok (fazla GES kırpılır).',
      'Batarya yalnız bağlantı sınırını aşan talebi karşılar ve GES fazlasıyla şarj olur (%92 verim, %10–95 SOC).',
      'Maliyet yalnız şebekeden çekilen şarj enerjisi içindir; tarife değerleri örnek — güncel tarifeyi girin.',
      'Besleme devresi: Cu, PVC 70 °C tablo değerleri, ΔU cosφ ≈ 1; DC cihaz girişi P/(η·√3·400·0,99).'
    ]);
    r.formulas = r.formulas.concat(['P_AC,min = n_faz·230·6 A', 'P_i = min(talep_i, pay_i) (öncelik kademeli)', 'ΔU% = √3·I·L/(κ·S)/U·100', 'Maliyet = Σ P_şebeke·Δt·fiyat(saat)']);
    return r;
  }

  /* ---------------------------------------------------------------- oynatma */
  const rate = (s, h) => (s.speed === 'auto' ? Math.max(0.5, (h.minutes || 1) / 40) : Number(s.speed) || 1);
  function at(h, t) { const i = Math.max(0, Math.min(h.t.length - 1, Math.floor(t))); return i; }
  function tick(app, dt) {
    const r = app.validResult; if (!r || !r.values.hub) return false;
    const h = r.values.hub, L = app.live, s = app.state;
    const sig = h.minutes + '|' + h.chargeE.toFixed(4) + '|' + h.t.length;
    if (sig !== L.sig) { L.sig = sig; L.t = 0; L.done = false; }
    if (L.done) return false;
    L.t += dt * rate(s, h);
    if (L.t >= h.minutes) { L.t = h.minutes; L.done = true; VS.toast(h.allDone ? 'Tüm oturumlar tamamlandı (' + clock(s.startHour, h.minutes) + ').' : 'Simülasyon sonu: bazı araçlar hedefe ulaşamadı.', h.allDone ? 'ok' : 'warn'); }
    return true;
  }

  /* ---------------------------------------------------------------- kontroller */
  function pointList(box, a) {
    const s = a.state, r = a.validResult && a.validResult.values.hub, list = VS.el('div', { class: 'vs-cl' });
    s.points.forEach((p, i) => {
      const hp = r && r.points[i], c = a.validResult && a.validResult.values.circ && a.validResult.values.circ[i];
      const bad = !compatible(p) || (c && (!c.coord || !c.rcdOk));
      const row = VS.el('div', { class: 'vs-cl__row' + (i === s.sel ? ' is-sel' : ''), 'data-level': bad ? 'bad' : hp && hp.pausedMin > 0 ? 'warn' : 'ok' });
      const name = VS.el('button', { type: 'button', class: 'vs-cl__name', 'aria-pressed': i === s.sel ? 'true' : 'false', title: 'Düzenle' }, [VS.el('i', { 'aria-hidden': 'true' }),
        VS.el('span', { text: p.name + ' · ' + (PROF[p.profile] || PROF.AC11).name.replace(/ \(.*\)/, '') }),
        VS.el('small', { text: p.car.capacity + ' kWh %' + p.car.soc0 + '→%' + p.car.soc1 + ' · ' + PRIO[p.priority] + ' öncelik · ' + (hp ? (hp.finishMin !== null ? dur(hp.finishMin) : p.plugged && p.enabled ? 'bitmiyor' : 'pasif') : '') })]);
      name.onclick = () => { s.sel = i; a.renderControls(); a.invalidate(); };
      const plug = VS.el('button', { type: 'button', class: 'vs-cl__sw', 'aria-pressed': p.plugged ? 'true' : 'false', 'aria-label': p.name + (p.plugged ? ' fişi çıkar' : ' fişi tak'), text: p.plugged ? 'Takılı' : 'Boşta' });
      plug.onclick = () => { p.plugged = !p.plugged; a.renderControls(); a.invalidate(); };
      const run = VS.el('button', { type: 'button', class: 'vs-cl__run', 'aria-pressed': p.enabled ? 'true' : 'false', 'aria-label': p.name + (p.enabled ? ' oturumu durdur' : ' oturumu başlat'), text: p.enabled ? '■' : '▶' });
      run.onclick = () => { p.enabled = !p.enabled; a.renderControls(); a.invalidate(); };
      row.appendChild(name); row.appendChild(plug); row.appendChild(run); list.appendChild(row);
    });
    box.appendChild(list);
    const add = VS.el('div', { class: 'vs-btns' });
    [['AC11', 'sedan', '+ AC 11 kW'], ['AC22', 'suv', '+ AC 22 kW'], ['DC60', 'compact', '+ DC 60 kW'], ['DC120', 'sedan', '+ DC 120 kW']].forEach(b => add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: b[2], onclick: () => {
      s.points.push(mkPoint(s.points.length, b[0], b[1], 20, 80)); s.sel = s.points.length - 1; a.renderControls(); a.invalidate();
    } })));
    add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn', text: 'Seçiliyi çoğalt', onclick: () => { const c = JSON.parse(JSON.stringify(s.points[s.sel])); c.name = 'Nokta ' + (s.points.length + 1); s.points.push(c); s.sel = s.points.length - 1; a.renderControls(); a.invalidate(); } }));
    add.appendChild(VS.el('button', { type: 'button', class: 'vs-btn vs-btn--danger', text: 'Seçiliyi sil', onclick: () => { if (s.points.length <= 1) return; s.points.splice(s.sel, 1); s.sel = Math.max(0, s.sel - 1); a.renderControls(); a.invalidate(); } }));
    box.appendChild(add);
  }
  function controls(s) {
    const i = Math.max(0, Math.min(s.sel, s.points.length - 1)), p = s.points[i], P = 'points.' + i + '.', C = P + 'car.';
    const dc = p && kindOf(p) === 'DC';
    const groups = [{ title: 'Şarj noktaları (' + s.points.length + ')', items: [{ type: 'custom', render: pointList }, { type: 'note', text: '3D’de park yerleri sıralara sarılır, 2D şema kaydırılır. Satıra tıklayın: seçili nokta aşağıda düzenlenir; “Takılı/Boşta” fiş, ▶/■ oturum.' }] }];
    if (p) {
      groups.push({ title: 'Seçili araç · ' + p.name, items: [
        { type: 'range', key: C + 'capacity', label: 'Batarya kapasitesi (kullanılabilir)', min: 10, max: 250, step: 1, unit: 'kWh' },
        { type: 'range', key: C + 'soc0', label: 'Başlangıç SOC', min: 0, max: 99, step: 1, fmt: v => '%' + v },
        { type: 'range', key: C + 'soc1', label: 'Hedef SOC', min: 1, max: 100, step: 1, fmt: v => '%' + v },
        { type: 'select', key: C + 'preset', label: 'Araç tipi (hazır değerler)', options: Object.keys(CARS).map(k => [k, CARS[k].name]), rebuild: true,
          onChange: (v, a) => { const c = CARS[v]; Object.assign(a.state.points[i].car, { capacity: c.capacity, obcPhases: c.obcPhases, obcI: c.obcI, dcMax: c.dcMax, inlet: c.inlet }); a.renderControls(); a.invalidate(); } },
        { type: 'seg', key: C + 'obcPhases', label: 'Araç dahili şarj cihazı (OBC)', options: [[1, '1 faz'], [3, '3 faz']] },
        { type: 'range', key: C + 'obcI', label: 'OBC faz akımı', min: 6, max: 63, step: 1, unit: 'A' },
        { type: 'range', key: C + 'dcMax', label: 'Aracın maks. DC kabul gücü', min: 10, max: 400, step: 5, unit: 'kW' },
        { type: 'seg', key: C + 'inlet', label: 'Araç DC soketi', options: [['ccs2', 'CCS2'], ['chademo', 'CHAdeMO']] },
        { type: 'seg', key: P + 'priority', label: 'Yük yönetiminde öncelik', options: [[1, 'Düşük'], [2, 'Normal'], [3, 'Yüksek']] }
      ] });
      groups.push({ title: 'Seçili şarj noktası · ' + p.name, items: [
        { type: 'text', key: P + 'name', label: 'Nokta adı', parse: v => { v = v.trim(); if (!v) throw new Error('Ad boş olamaz.'); return v.slice(0, 32); }, rebuild: true },
        { type: 'select', key: P + 'profile', label: 'Şarj cihazı', options: Object.keys(PROF).map(k => [k, PROF[k].name]), rebuild: true,
          onChange: (v, a) => { const q = a.state.points[i]; if (PROF[v].kind === 'DC') { q.stationP = PROF[v].P; if (q.conn.indexOf('type2') === 0) q.conn = 'ccs2'; q.method = 'E'; } else if (q.conn.indexOf('type2') !== 0) q.conn = 'type2c'; autoSize(q, a.state.effDC); a.renderControls(); a.invalidate(); } },
        dc ? { type: 'range', key: P + 'stationP', label: 'DC çıkış gücü (cihaz etiketi)', min: 10, max: 400, step: 10, unit: 'kW' } : null,
        { type: 'select', key: P + 'conn', label: 'Bağlantı / tabanca', options: (dc ? ['ccs2', 'chademo'] : ['type2s', 'type2c']).map(k => [k, CONN[k]]) },
        { type: 'select', key: P + 'prot', label: 'Koruma cihazı', options: [['MCB', 'MCB (C eğrisi, ≤ 63 A)'], ['MCCB', 'MCCB (TMŞ)']] },
        { type: 'select', key: P + 'In', label: 'Koruma anma akımı In', options: IN_LIST.map(v => [v, v + ' A']) },
        { type: 'select', key: P + 'rcd', label: 'Kaçak akım koruması', options: Object.keys(RCD).map(k => [k, RCD[k]]) },
        { type: 'select', key: P + 'S', label: 'Besleme kablosu kesiti (Cu)', options: E.CABLE_SIZES.map(v => [v, fmt(v, v % 1 ? 1 : 0) + ' mm²']) },
        { type: 'select', key: P + 'method', label: 'Döşeme yöntemi', options: Object.keys(E.INSTALL_METHODS).map(k => [k, E.INSTALL_METHODS[k]]) },
        { type: 'range', key: P + 'L', label: 'Kablo uzunluğu (panodan)', min: 1, max: 300, step: 1, unit: 'm' },
        { type: 'toggle', key: P + 'meter', label: 'Nokta başına MID onaylı sayaç' },
        { type: 'buttons', items: [{ label: 'Devreyi otomatik boyutlandır', onClick: a => { autoSize(a.state.points[i], a.state.effDC); a.renderControls(); a.invalidate(); } }] }
      ] });
    }
    groups.push({ title: 'Tesis bağlantısı ve yük yönetimi', items: [
      { type: 'seg', key: 'connMode', label: 'Bağlantı', options: [['limit', 'AG bağlantı gücü (kW)'], ['trafo', 'Özel trafo (kVA)']] },
      s.connMode === 'trafo' ? { type: 'select', key: 'trafoKVA', label: 'Trafo gücü', options: [100, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500].map(v => [v, v + ' kVA']) } : { type: 'number', key: 'siteKW', label: 'Bağlantı gücü sınırı', min: 1, max: 20000, step: 1, unit: 'kW' },
      { type: 'toggle', key: 'dlm', label: 'OCPP yük yönetim kontrolörü (dinamik paylaşım)' },
      { type: 'select', key: 'baseProfile', label: 'Bina baz yükü', options: Object.keys(X.BASE_PROFILES).map(k => [k, X.BASE_PROFILES[k].name]) },
      s.baseProfile !== 'none' ? { type: 'range', key: 'basePeak', label: 'Baz yük tepesi', min: 0, max: 2000, step: 5, unit: 'kW' } : null,
      { type: 'range', key: 'startHour', label: 'Oturum başlangıç saati', min: 0, max: 23.5, step: 0.5, fmt: v => clock(v, 0) },
      { type: 'range', key: 'deadline', label: 'Hedef bitiş süresi (0 = yok)', min: 0, max: 720, step: 15, fmt: v => (v ? dur(v) : 'yok') },
      { type: 'number', key: 'pvKWp', label: 'Çatı GES gücü', min: 0, max: 5000, step: 5, unit: 'kWp' },
      s.pvKWp > 0 ? { type: 'select', key: 'pvDoy', label: 'GES için ay (açık gün)', options: MONTHS } : null,
      { type: 'number', key: 'batKWh', label: 'Batarya tamponu kapasitesi', min: 0, max: 5000, step: 5, unit: 'kWh' },
      s.batKWh > 0 ? { type: 'number', key: 'batKW', label: 'Batarya gücü', min: 0, max: 5000, step: 5, unit: 'kW' } : null,
      s.batKWh > 0 ? { type: 'range', key: 'batSoc0', label: 'Batarya başlangıç SOC', min: 10, max: 100, step: 5, fmt: v => '%' + v } : null
    ] });
    groups.push({ title: 'Şarj eğrisi ve verim', items: [
      { type: 'seg', key: 'curve', label: 'Şarj eğrisi', options: [['typical', 'Tipik (CC–CV)'], ['constant', 'Sabit güç']] },
      s.curve === 'constant' ? { type: 'note', level: 'warn', text: 'Sabit güç varsayıldı: yüksek SOC’de araç kabul gücünün düşüşü hesaba katılmaz.' } : null,
      { type: 'range', key: 'effAC', label: 'AC şarj verimi', min: 60, max: 100, step: 1, fmt: v => '%' + v },
      { type: 'range', key: 'effDC', label: 'DC şarj verimi', min: 60, max: 100, step: 1, fmt: v => '%' + v }
    ] });
    groups.push({ title: 'Tarife, maliyet ve mevzuat', items: [
      { type: 'seg', key: 'tariffMode', label: 'Tarife', options: [['single', 'Tek zamanlı'], ['tou', 'Üç zamanlı']] },
      s.tariffMode === 'single' ? { type: 'number', key: 'priceSingle', label: 'Enerji bedeli', min: 0, max: 100, step: 0.01, unit: 'TL/kWh', digits: 2 } : null,
      s.tariffMode === 'tou' ? { type: 'number', key: 'priceDay', label: 'Gündüz (06–17)', min: 0, max: 100, step: 0.01, unit: 'TL/kWh', digits: 2 } : null,
      s.tariffMode === 'tou' ? { type: 'number', key: 'pricePeak', label: 'Puant (17–22)', min: 0, max: 100, step: 0.01, unit: 'TL/kWh', digits: 2 } : null,
      s.tariffMode === 'tou' ? { type: 'number', key: 'priceNight', label: 'Gece (22–06)', min: 0, max: 100, step: 0.01, unit: 'TL/kWh', digits: 2 } : null,
      { type: 'note', text: 'Fiyatlar örnektir; güncel EPDK tarifesi ve dağıtım bedelleriyle değiştirin.' },
      { type: 'toggle', key: 'publicService', label: 'Herkese açık ücretli şarj hizmeti', rebuild: true },
      { type: 'number', key: 'salePrice', label: 'Kullanıcıya satış fiyatı (0 = ücretsiz)', min: 0, max: 100, step: 0.1, unit: 'TL/kWh', digits: 2 },
      { type: 'note', text: s.publicService ? 'Ticari hizmet: lisans ve şarj ağı koşulları “Mevzuat kapsamı” kontrolünde.' : 'Özel kullanım (ticari olmayan): enerji bedeli alınmaz; ücret alınıyorsa ticari hizmet seçilmelidir.' }
    ] });
    groups.push({ title: 'Oynatma', items: [{ type: 'seg', key: 'speed', label: 'Hızlandırma', options: [['auto', 'Otomatik'], ['1', '1 dk/s'], ['5', '5 dk/s'], ['15', '15 dk/s']] }] });
    return groups;
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live) {
    const v = res.values, h = v.hub, i = at(h, live.t), p = s.points[v.sel], lim = res.checks.find(c => c.id === 'limit');
    const plugged = s.points.filter(q => q.plugged && q.enabled).length;
    const out = [
      { label: p.name + ' · ideal enerji', value: fmt(v.ideal, 1, 'kWh'), sub: p.car.capacity + ' kWh × (%' + p.car.soc1 + ' − %' + p.car.soc0 + ')' },
      { label: p.name + ' · süre (merkezde)', value: dur(v.selFinish), sub: 'Tek başına ' + dur(v.minutes) + (v.selFinish !== null && v.selFinish > v.minutes + 1 ? ' · paylaşım uzattı' : ''), level: v.selFinish === null && p.plugged && p.enabled ? 'warn' : undefined },
      { label: p.name + ' · başlangıç gücü', value: fmt(v.startGrid, 1, 'kW'), sub: 'Sınırlayan (tek başına): ' + (lim ? lim.detail : '—') },
      v.kind === 'AC' ? { label: p.name + ' · AC faz akımı', value: fmt(v.phaseCurrent, 1, 'A'), sub: v.ac.phases + ' faz × 230 V' } : { label: p.name + ' · bataryaya DC', value: fmt(v.sim[0] ? v.sim[0].Pbatt : 0, 1, 'kW'), sub: 'Cihaz ' + p.stationP + ' kW · araç ' + p.car.dcMax + ' kW' },
      { label: 'Tüm araçlar hedefte', value: h.allDone ? clock(s.startHour, h.lastFinish) : 'Hayır', level: h.allDone ? (s.deadline && h.lastFinish > s.deadline ? 'warn' : 'ok') : 'warn', sub: plugged + ' / ' + s.points.length + ' oturum · ' + (h.allDone ? dur(h.lastFinish) : 'bazıları bitmiyor') },
      { label: 'Tepe şebeke talebi', value: fmt(h.peak, 1, 'kW'), level: h.overMin ? 'bad' : 'ok', sub: 'Sınır ' + fmt(v.limit, 1) + ' kW · ' + clock(s.startHour, h.peakAt) },
      { label: 'Şarj enerjisi (şebeke)', value: fmt(h.chargeE, 1, 'kWh'), sub: (s.pvKWp > 0 ? 'GES ' + fmt(h.pvE, 1) + ' kWh · ' : '') + (s.batKWh > 0 ? 'batarya ' + fmt(h.batOut, 1) + ' kWh' : 'kayıp dahil') },
      { label: 'Enerji maliyeti (alış)', value: fmt(h.cost, 0, 'TL'), sub: s.tariffMode === 'tou' ? 'Üç zamanlı tarife · ' + fmt(h.chargeE > 0 ? h.cost / h.chargeE : 0, 2) + ' TL/kWh ort.' : 'Tek zamanlı', level: undefined },
      s.publicService ? { label: 'Satış geliri / brüt marj', value: fmt(v.revenue, 0, 'TL'), sub: 'Marj ' + fmt(v.margin, 0) + ' TL (enerji bedeli dışı giderler hariç)', level: v.margin < 0 ? 'warn' : 'ok' } : null,
      { label: 'Simülasyon saati', value: clock(s.startHour, live.t) + ' · ' + p.name + ' %' + fmt(h.soc[v.sel][i] || 0, 1), wide: true, level: live.done ? 'ok' : undefined,
        sub: 'Şebeke ' + fmt(h.grid[i], 1) + ' kW · şarj ' + fmt(h.chargers[i], 1) + ' kW · baz ' + fmt(h.base[i], 1) + ' kW' + (s.pvKWp > 0 ? ' · GES ' + fmt(h.pv[i], 1) + ' kW' : '') + ' · 1 s = ' + fmt(rate(s, h), 1) + ' dk' }
    ];
    return out.filter(Boolean);
  }
  function thin(arr, n) { const st = Math.max(1, Math.ceil(arr.length / n)); return arr.filter((x, i) => i % st === 0 || i === arr.length - 1); }
  const hue = i => 'hsl(' + ((i * 47 + 30) % 360) + ',75%,58%)';
  function charts(res, s, live) {
    const v = res.values, h = v.hub, T = h.t, xmax = Math.max(1, h.minutes);
    const x = { label: 'saat', min: 0, max: xmax, fmt: m => clock(s.startHour, m) };
    const S = arr => thin(T.map((t, i) => [t, arr[i]]), 400);
    const mk = { x: Math.min(live.t, xmax), color: '#fcd34d', label: clock(s.startHour, live.t) };
    const site = [{ name: 'Şebeke (kW)', color: 'amber', area: true, data: S(h.grid) }, { name: 'Şarj toplamı', color: 'cyan', data: S(h.chargers) }, { name: 'Bina baz yükü', color: 'grey', data: S(h.base) }];
    if (s.pvKWp > 0) site.push({ name: 'GES', color: 'green', data: S(h.pv) });
    if (s.batKWh > 0) site.push({ name: 'Batarya (+deşarj)', color: 'violet', data: S(h.bat) });
    return [{
      id: 'site', title: 'Tesis güç talebi – zaman (tüm araçlar)', height: 170, series: site,
      hLines: [{ y: v.limit, label: 'Bağlantı sınırı ' + fmt(v.limit, 0) + ' kW', color: '#ef4444' }], markers: [mk], x: x, y: { label: 'kW', min: 0 },
      alt: 'Tepe ' + fmt(h.peak, 1) + ' kW (' + clock(s.startHour, h.peakAt) + '), sınır ' + fmt(v.limit, 0) + ' kW' + (h.overMin ? ', ' + h.overMin + ' dk aşım' : '') + '.'
    }, {
      id: 'points', title: 'Nokta başına şarj gücü (dinamik yük paylaşımı)', height: 170,
      series: s.points.map((p, i) => ({ name: p.name, color: hue(i), data: S(h.P[i]) })), markers: [mk], x: x, y: { label: 'kW', min: 0 },
      alt: s.points.map((p, i) => p.name + ': ' + (h.points[i].finishMin !== null ? dur(h.points[i].finishMin) : 'bitmiyor')).join(', ')
    }, {
      id: 'soc', title: 'Araç SOC – zaman', height: 160,
      series: s.points.map((p, i) => ({ name: p.name, color: hue(i), data: S(h.soc[i]) })), markers: [mk], x: x, y: { label: '%', min: 0, max: 100 },
      alt: 'Her aracın SOC eğrisi; düz bölümler duraklatılan ya da bitmiş oturumlardır.'
    }];
  }

  /* ---------------------------------------------------------------- 3D: geometri, malzeme, araç */
  let G = null;
  function geos(T) {
    if (G) return G;
    G = {};
    // gövde yan profili (x: boy, burun +x; y: yükseklik), çamurluk kavisleri profile işlenmiştir
    const s = new T.Shape();
    s.moveTo(-2.1, 0.3);
    s.lineTo(-1.75, 0.3); s.absarc(-1.35, 0.3, 0.4, Math.PI, 0, true);
    s.lineTo(0.95, 0.3); s.absarc(1.35, 0.3, 0.4, Math.PI, 0, true);
    s.lineTo(2.06, 0.32); s.quadraticCurveTo(2.2, 0.4, 2.18, 0.62); s.lineTo(2.12, 0.8);
    s.quadraticCurveTo(2.02, 0.92, 1.7, 0.95); s.lineTo(0.92, 1.02); s.lineTo(-1.9, 1.05);
    s.quadraticCurveTo(-2.12, 1.03, -2.15, 0.86); s.lineTo(-2.16, 0.45); s.quadraticCurveTo(-2.16, 0.31, -2.1, 0.3);
    G.body = extrude(T, s, 1.8, 0.06);
    // cam kabin (daha dar)
    const g = new T.Shape();
    g.moveTo(0.95, 1.0); g.lineTo(0.05, 1.5); g.quadraticCurveTo(-0.1, 1.56, -0.32, 1.56); g.lineTo(-1.5, 1.555);
    g.quadraticCurveTo(-1.76, 1.54, -1.86, 1.4); g.lineTo(-2.0, 1.02); g.lineTo(0.95, 1.0);
    G.cabin = extrude(T, g, 1.52, 0.05);
    G.tire = new T.CylinderGeometry(0.34, 0.34, 0.22, 36); G.tire.rotateX(Math.PI / 2);
    G.rim = new T.CylinderGeometry(0.235, 0.235, 0.226, 28); G.rim.rotateX(Math.PI / 2);
    G.rimIn = new T.CylinderGeometry(0.205, 0.205, 0.23, 24); G.rimIn.rotateX(Math.PI / 2);
    G.spoke = new T.BoxGeometry(0.045, 0.19, 0.02);
    G.cap = new T.CylinderGeometry(0.045, 0.045, 0.24, 16); G.cap.rotateX(Math.PI / 2);
    G.module = new T.BoxGeometry(0.27, 0.09, 0.64);
    G.fin = new T.BoxGeometry(0.02, 0.9, 0.22);
    return G;
  }
  function extrude(T, shape, width, bevel) {
    const geo = new T.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 14 });
    geo.translate(0, 0, -(width - 2 * bevel) / 2);
    geo.computeVertexNormals();
    return geo;
  }
  const MAT = {};
  function mats(k) {
    const T = k.T;
    if (MAT.T === T) return MAT;
    MAT.T = T;
    const paint = c => { const m = new T.MeshPhysicalMaterial({ color: c, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }); m.envMapIntensity = 1.2; return m; };
    MAT.paints = [paint(0x1f5a8c), paint(0x9b1c1c), paint(0x3c4046), paint(0xd9dee4)];
    MAT.darkGlass = new T.MeshPhysicalMaterial({ color: 0x18222e, metalness: 0.1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }); MAT.darkGlass.envMapIntensity = 1.5;
    MAT.head = new T.MeshStandardMaterial({ color: 0xf1f5f9, emissive: 0xdbeafe, emissiveIntensity: 0.9, roughness: 0.2 });
    MAT.tail = new T.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0xb91c1c, emissiveIntensity: 0.7, roughness: 0.3 });
    MAT.evGreen = new T.MeshStandardMaterial({ color: 0x2f7d4f, roughness: 0.9 });
    MAT.line = new T.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.7 });
    MAT.grass = new T.MeshStandardMaterial({ color: 0x4a6332, roughness: 1 });
    MAT.hedge = new T.MeshStandardMaterial({ color: 0x35582c, roughness: 1 });
    MAT.barBg = new T.MeshBasicMaterial({ color: 0x0b1626, transparent: true, opacity: 0.85 });
    MAT.barFill = new T.MeshBasicMaterial({ color: 0x22c55e });
    MAT.cable = new T.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.55 });
    MAT.cableOrange = new T.MeshStandardMaterial({ color: 0xe0661a, roughness: 0.55 });
    return MAT;
  }
  function mesh(k, geo, mat, x, y, z, parent) {
    const m = new k.T.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  }

  /* ---------------------------------------------------------------- 3D: araç */
  // Araç yerel ekseni: +x burun, +z sağ yan. Grup -90° döndürülür: burun dünya +z (kamera), sol yan dünya +x (şarj adası).
  const INLET = [1.42, 0.86, -0.905];   // sol ön çamurlukta Type 2 / CCS2 soketi
  const WHEELS = [[1.35, 0.34, 0.79], [1.35, 0.34, -0.79], [-1.35, 0.34, 0.79], [-1.35, 0.34, -0.79]];
  function buildCar(k, x, z, paint, wheelList, sc, idx) {
    const T = k.T, M = k.mats, g = geos(T), X = mats(k);
    const car = k.group(null, x, 0, z); car.rotation.y = -Math.PI / 2;
    const body = mesh(k, g.body, paint, 0, 0, 0, car);
    const cabin = k.group(car, 0, 0, 0);
    mesh(k, g.cabin, X.darkGlass, 0, 0, 0, cabin);
    k.rbox(1.42, 0.045, 1.44, 0.03, paint, -0.86, 1.57, 0, cabin);                 // tavan
    k.box(1.3, 0.035, 0.035, M.alu, -0.86, 1.61, 0.64, cabin); k.box(1.3, 0.035, 0.035, M.alu, -0.86, 1.61, -0.64, cabin); // tavan rayları
    k.box(0.1, 0.5, 1.535, M.plasticDark, -0.62, 1.27, 0, cabin);                  // B direği
    k.box(0.12, 0.42, 1.53, paint, -1.82, 1.22, 0, cabin).rotation.z = -0.55;      // C direği
    k.shell(body); k.shell(cabin);
    k.explodable(cabin, [0, 0.9, 0]);
    // tampon, ışıklar, alt kaplama
    k.box(1.9, 0.09, 1.84, M.plasticDark, 0, 0.35, 0, car);                         // marşpiyel
    k.box(3.5, 0.08, 1.5, M.plasticDark, 0, 0.26, 0, car);                          // alt koruma
    k.box(0.05, 0.15, 1.0, M.plasticDark, 2.16, 0.5, 0, car);                       // ızgara/hava girişi
    [0.62, -0.62].forEach(z => { const h = k.box(0.05, 0.055, 0.42, X.head, 2.11, 0.76, z, car); h.rotation.y = z > 0 ? -0.35 : 0.35; });
    k.box(0.04, 0.06, 1.55, X.tail, -2.16, 0.92, 0, car);
    [1, -1].forEach(sd => {
      k.rbox(0.13, 0.1, 0.2, 0.025, paint, 0.72, 1.1, sd * 0.99, car);              // ayna
      [0.25, -0.95].forEach(hx => k.box(0.16, 0.025, 0.02, M.alu, hx, 0.98, sd * 0.905, car)); // kapı kolu
    });
    // şarj soketi ve açık kapağı
    const inl = k.group(car, INLET[0], INLET[1], INLET[2]);
    const sock = k.cyl(0.075, 0.075, 0.025, M.plasticDark, 0, 0, 0, inl, 20); sock.rotation.x = Math.PI / 2;
    const flap = k.rbox(0.17, 0.15, 0.012, 0.02, paint, 0.1, 0, -0.04, inl); flap.rotation.y = 1.1;
    k.pickable(inl, 'Araç şarj soketi (CCS2 / Type 2)', () => ['Üst bölüm: Type 2 AC (L1–L3, N, PE, CP, PP)', 'Alt iki pim: CCS2 DC artı/eksi', 'Sinyalleşme: IEC 61851-1 kontrol pilotu (PWM)']);
    // batarya modülleri (zemin altında; “Şeffaf kapak” ile görünür)
    let modules = null;
    {
      k.box(2.5, 0.14, 1.46, M.darkSteel, -0.05, 0.42, 0, car);
      modules = new T.InstancedMesh(g.module, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 }), 16);
      const d = new T.Object3D();
      for (let i = 0; i < 16; i++) { d.position.set(-1.15 + (i % 8) * 0.3, 0.5, i < 8 ? 0.35 : -0.35); d.updateMatrix(); modules.setMatrixAt(i, d.matrix); modules.setColorAt(i, new T.Color(0x334155)); }
      modules.castShadow = false; car.add(modules);
      k.pickable(modules, 'Çekiş bataryası', () => { const n = pstate(sc, idx); return n ? ['Kullanılabilir kapasite: ' + fmt(n.p.car.capacity, 0, 'kWh'), 'Anlık SOC: %' + fmt(n.soc, 1) + ' → hedef %' + n.p.car.soc1, '16 modül; dolu modüller yeşil (SOC oranında)', 'Ön ısıtma/soğutma tüketimi modelde yok'] : []; }, a => pointActions(a, idx));
    }
    car.updateMatrixWorld(true);
    WHEELS.forEach(w => wheelList.push({ m: car.matrixWorld.clone(), p: w }));
    const inletW = new T.Vector3().fromArray(INLET).applyMatrix4(car.matrixWorld);
    return { car: car, body: body, modules: modules, inlet: inletW };
  }
  function buildWheels(k, list) {
    const T = k.T, M = k.mats, g = geos(T), n = list.length;
    const tire = new T.InstancedMesh(g.tire, M.rubber, n), rim = new T.InstancedMesh(g.rim, M.alu, n), rimIn = new T.InstancedMesh(g.rimIn, M.darkSteel, n);
    const cap = new T.InstancedMesh(g.cap, M.alu, n), spokes = new T.InstancedMesh(g.spoke, M.alu, n * 10);
    const m = new T.Matrix4(), l = new T.Matrix4(), r = new T.Matrix4();
    list.forEach((w, i) => {
      l.makeTranslation(w.p[0], w.p[1], w.p[2]); m.multiplyMatrices(w.m, l);
      tire.setMatrixAt(i, m); rim.setMatrixAt(i, m); rimIn.setMatrixAt(i, m); cap.setMatrixAt(i, m);
      for (let j = 0; j < 10; j++) {
        const side = j < 5 ? 1 : -1;
        l.makeTranslation(w.p[0], w.p[1], w.p[2] + side * 0.106); r.makeRotationZ(j * Math.PI * 2 / 5 + 0.3); l.multiply(r);
        r.makeTranslation(0, 0.11, 0); l.multiply(r);
        m.multiplyMatrices(w.m, l); spokes.setMatrixAt(i * 10 + j, m);
      }
    });
    [tire, rim, rimIn, cap, spokes].forEach(im => { im.castShadow = true; im.receiveShadow = true; k.viewer.root.add(im); });
  }

  /* ---------------------------------------------------------------- 3D: şarj cihazları */
  function connector(k, parent, dc) {
    // tabanca: kabza + Type 2 başlık (+ CCS2'de alt DC pim bloğu); yerel -x yönü sokete bakar
    const M = k.mats, c = k.group(parent, 0, 0, 0);
    k.rbox(0.16, 0.07, 0.07, 0.02, M.plasticDark, 0.1, 0.03, 0, c);
    const head = k.cyl(0.036, 0.036, 0.08, M.plasticDark, -0.02, 0, 0, c, 20); head.rotation.z = Math.PI / 2;
    if (dc) k.rbox(0.08, 0.05, 0.07, 0.015, M.plasticDark, -0.02, -0.055, 0, c);
    k.box(0.01, 0.035, 0.05, dc ? M.plasticBlue : M.plasticGrey, 0.06, 0.07, 0, c);
    return c;
  }
  function buildAC(k, x, z, sc, i) {
    const M = k.mats, g = k.group(null, x, 0, z);
    k.box(0.32, 0.03, 0.24, M.galv, 0, 0.165, 0, g);
    k.rbox(0.16, 1.02, 0.12, 0.02, M.panelDark, 0, 0.69, 0, g);
    const unit = k.group(g, 0, 1.36, 0.01);
    k.rbox(0.32, 0.44, 0.15, 0.05, M.plasticWhite, 0, 0, 0, unit);
    k.rbox(0.25, 0.32, 0.02, 0.03, M.plasticDark, 0, 0.02, 0.07, unit);
    const led = k.box(0.18, 0.014, 0.01, M.ledBlue, 0, -0.16, 0.078, unit);
    const scr = k.screen(0.13, 0.08, 208, (gx, w, h) => drawAC(gx, w, h, sc, i), unit, { emissive: 0.9 });
    scr.position.set(0, 0.06, 0.082);
    k.rbox(0.07, 0.11, 0.08, 0.012, M.plasticDark, -0.2, -0.06, 0.0, unit);
    g.updateMatrixWorld(true);
    return { g: g, led: led, scr: scr, plugW: g.localToWorld(new k.T.Vector3(-0.07, 1.22, 0.06)), holsterW: g.localToWorld(new k.T.Vector3(-0.2, 1.3, 0.06)), top: 1.7 };
  }
  function buildDC(k, x, z, sc, i) {
    const M = k.mats, g = k.group(null, x, 0, z);
    k.box(0.9, 0.08, 0.68, M.concrete, 0, 0.19, 0, g);
    const low = k.rbox(0.72, 0.95, 0.52, 0.04, M.panelDark, 0, 0.7, 0, g);
    const up = k.rbox(0.72, 0.84, 0.52, 0.04, M.plasticWhite, 0, 1.58, 0, g);
    k.rbox(0.8, 0.06, 0.6, 0.02, M.panelDark, 0, 2.03, 0, g);
    k.shell(low); k.shell(up);
    k.box(0.4, 0.5, 0.012, M.plasticDark, 0, 1.6, 0.262, g);
    const scr = k.screen(0.34, 0.44, 256, (gx, w, h) => drawDC(gx, w, h, sc, i), g, { emissive: 0.9 });
    scr.position.set(0, 1.6, 0.27);
    const led = k.box(0.018, 0.62, 0.012, M.ledBlue, -0.3, 1.58, 0.265, g);
    const es = k.cyl(0.035, 0.035, 0.04, M.plasticRed, 0.27, 1.22, 0.275, g, 18); es.rotation.x = Math.PI / 2;
    k.box(0.1, 0.1, 0.01, M.plasticYellow, 0.27, 1.22, 0.262, g);
    for (let r = 0; r < 7; r++) k.box(0.012, 0.012, 0.36, M.darkSteel, 0.362, 0.45 + r * 0.05, 0, g);
    const door = k.rbox(0.64, 0.82, 0.02, 0.01, M.panelDark, 0, 0.7, 0.265, g); k.shell(door); k.explodable(door, [0, 0, 0.7]);
    for (let r = 0; r < 4; r++) { k.box(0.5, 0.13, 0.36, M.alu, 0, 0.36 + r * 0.17, 0, g); k.box(0.46, 0.08, 0.005, M.plasticDark, 0, 0.36 + r * 0.17, 0.182, g); }
    k.box(0.08, 0.6, 0.1, M.copper, -0.3, 0.7, -0.15, g);
    k.rbox(0.06, 0.12, 0.09, 0.012, M.plasticDark, -0.38, 1.22, 0.1, g);
    g.updateMatrixWorld(true);
    return { g: g, led: led, scr: scr, plugW: g.localToWorld(new k.T.Vector3(-0.37, 1.0, 0.05)), holsterW: g.localToWorld(new k.T.Vector3(-0.45, 1.2, 0.1)), top: 2.15 };
  }
  function plugCable(k, from, inlet, dc) {
    const T = k.T, Xm = mats(k);
    const end = inlet.clone().add(new T.Vector3(0.1, 0, 0));
    const pts = [from, new T.Vector3(from.x - 0.12, 0.35, from.z + 0.25), new T.Vector3((from.x + end.x) / 2 - 0.05, 0.13, (from.z + end.z) / 2),
      new T.Vector3(end.x + 0.25, 0.25, end.z - 0.2), new T.Vector3(end.x + 0.22, end.y - 0.04, end.z), new T.Vector3(end.x + 0.1, end.y, end.z)];
    const cab = k.tube(pts, dc ? 0.024 : 0.016, dc ? Xm.cable : Xm.cableOrange, k.viewer.root, 90);
    const con = connector(k, k.viewer.root, dc); con.position.copy(end);
    return { cab: cab, con: con, flow: k.flow(cab.userData.curve, dc ? 22 : 16, dc ? 0x38bdf8 : 0xfcd34d, dc ? 0.03 : 0.024) };
  }
  function idleCable(k, from, holster, dc) {
    const T = k.T, Xm = mats(k);
    const pts = [from, new T.Vector3(from.x - 0.15, 0.45, from.z + 0.1), new T.Vector3(holster.x - 0.22, 0.3, holster.z + 0.15), new T.Vector3(holster.x - 0.1, holster.y - 0.2, holster.z), holster];
    const cab = k.tube(pts, dc ? 0.024 : 0.016, dc ? Xm.cable : Xm.cableOrange, k.viewer.root, 60);
    const con = connector(k, k.viewer.root, dc); con.position.copy(holster); con.rotation.z = Math.PI / 2;
    return { cab: cab, con: con };
  }
  /** Fiş tak/çıkar sahneyi yeniden kurmaz: iki kablo konumu da kurulur, yalnız görünürlük değişir. */
  function showPlug(sc, i, on) {
    const c = sc.cables[i]; if (!c || c.on === on) return false;
    c.on = on; c.plug.cab.visible = c.plug.con.visible = on; c.plug.flow.visible = on;
    c.idle.cab.visible = c.idle.con.visible = !on;
    return true;
  }

  /* ---------------------------------------------------------------- 3D: sahne */
  function bayPos(i) { const r = Math.floor(i / PER_ROW), c = i % PER_ROW; return { x: -c * BAY, z: -r * ROWZ, r: r, c: c }; }
  function rebuildOn(s) { return JSON.stringify([s.points.map(p => [kindOf(p), p.car.preset]), s.connMode, s.baseProfile === 'none', s.pvKWp > 0, s.batKWh > 0, s.publicService]); }
  function pointActions(app, i) {
    const p = app.state.points[i]; if (!p) return [];
    return [
      { label: p.plugged ? 'Fişi çıkar' : 'Fişi tak', onClick: a => { a.state.points[i].plugged = !a.state.points[i].plugged; } },
      { label: p.enabled ? 'Oturumu durdur' : 'Oturumu başlat', variant: p.enabled ? '' : 'primary', onClick: a => { a.state.points[i].enabled = !a.state.points[i].enabled; } },
      { label: 'Öncelik: ' + PRIO[p.priority] + ' → ' + PRIO[p.priority % 3 + 1], onClick: a => { const q = a.state.points[i]; q.priority = q.priority % 3 + 1; } },
      { label: 'Düzenle', onClick: a => { a.state.sel = i; } }
    ];
  }
  function pointInfo(app, i) {
    const r = app.validResult, s = app.state, p = s.points[i]; if (!r || !p || !r.values.hub) return [];
    const h = r.values.hub, j = at(h, app.live.t), c = r.values.circ[i], hp = h.points[i];
    return [(PROF[p.profile] || PROF.AC11).name + ' · ' + CONN[p.conn] + (compatible(p) ? '' : ' · ARAÇLA UYUMSUZ'),
      'Araç: ' + p.car.capacity + ' kWh · %' + fmt(h.soc[i][j], 1) + ' → %' + p.car.soc1 + ' · öncelik ' + PRIO[p.priority],
      'Anlık ' + fmt(h.P[i][j], 1) + ' kW' + (h.paused[i][j] ? ' · DURAKLATILDI (6 A alt sınırı)' : '') + ' · bitiş ' + (hp.finishMin !== null ? clock(s.startHour, hp.finishMin) : '—'),
      'Devre: ' + p.prot + ' ' + p.In + ' A · ' + RCD[p.rcd] + ' · ' + p.S + ' mm² ' + p.L + ' m · ΔU %' + fmt(c.vd, 2),
      'Enerji ' + fmt(hp.Egrid, 1) + ' kWh · maliyet ' + fmt(hp.cost, 0) + ' TL' + (p.meter ? ' · MID sayaç' : '')];
  }
  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer, Xm = mats(k);
    // modül önbelleğindeki geometri ve malzemeler yeniden kurulumda dispose edilmez (her seferinde GPU'ya yeniden yüklenmez)
    [geos(T), Xm].forEach(o => Object.keys(o).forEach(n => { const x = o[n]; if (Array.isArray(x)) x.forEach(y => k.keep(y)); else if (x && (x.isBufferGeometry || x.isMaterial)) k.keep(x); }));
    if (validatePoints(s).length) { app.scene3 = null; k.ground(200, Xm.grass, -0.02); return; }
    const n = s.points.length, rows = Math.ceil(n / PER_ROW), cols = Math.min(n, PER_ROW);
    const sc = { app: app, cars: [], units: [], flows: [], cables: [], lastScr: -1, lastMods: [] };
    app.scene3 = sc;
    v.scene.fog = new T.Fog(0x9fb9d4, 40 + rows * 10, 130 + rows * 25);
    k.ground(400, Xm.grass, -0.02);
    const xL = -BAY * (cols - 1) - 3.4, xR = 14.5, zB = 3.6, zT = -(rows - 1) * ROWZ - 9.5;
    const asphalt = mesh(k, new T.PlaneGeometry(xR - xL, zB - zT), M.asphalt, (xL + xR) / 2, 0, (zB + zT) / 2, v.root);
    asphalt.rotation.x = -Math.PI / 2; asphalt.castShadow = false; asphalt.userData.noClip = true;
    const wheels = [];
    // park yeri süslemeleri (zemin boyası, ada, babalar, piktogram) statik grupta birleşir; piktogram dokusu tek ve paylaşımlı
    const pk = k.staticGroup(null);
    let icon0 = null;
    s.points.forEach((p, i) => {
      const b = bayPos(i), bx = b.x, bz = b.z, ix = bx + ISLAND_X, dc = kindOf(p) === 'DC';
      k.box(2.5, 0.006, 5.2, Xm.evGreen, bx, 0.004, bz, pk).castShadow = false;
      k.box(0.1, 0.008, 5.2, Xm.line, bx - 1.35, 0.005, bz, pk).castShadow = false;
      let pict;
      if (!icon0) pict = icon0 = k.screen(1.2, 1.2, 256, drawBayIcon, pk);
      else { pict = new T.Mesh(icon0.geometry, icon0.material); pict.receiveShadow = true; pk.add(pict); }
      pict.rotation.x = -Math.PI / 2; pict.position.set(bx, 0.009, bz + 1.7);
      k.rbox(1.0, 0.16, 5.0, 0.05, M.concrete, ix, 0.08, bz - 0.4, pk);
      [-2.7, 1.9].forEach(zz => { k.cyl(0.07, 0.07, 0.9, M.plasticYellow, ix, 0.6, bz + zz, pk, 16); k.cyl(0.072, 0.072, 0.12, M.plasticDark, ix, 0.75, bz + zz, pk, 16); });
      const car = buildCar(k, bx, bz, Xm.paints[i % Xm.paints.length], wheels, sc, i);
      k.pickable(car.body, () => s.points[i].name + ' · ' + (CARS[s.points[i].car.preset] || CARS.sedan).name, () => pointInfo(app, i), a => pointActions(a, i));
      const u = dc ? buildDC(k, ix, bz - 0.55, sc, i) : buildAC(k, ix, bz - 0.8, sc, i);
      k.pickable(u.g, () => s.points[i].name + ' · ' + (PROF[s.points[i].profile] || PROF.AC11).name, () => pointInfo(app, i), a => pointActions(a, i));
      const fl = plugCable(k, u.plugW, car.inlet, dc), idle = idleCable(k, u.plugW, u.holsterW, dc);
      sc.cables[i] = { plug: fl, idle: idle, on: null }; showPlug(sc, i, !!p.plugged);
      k.pickable(fl.cab, () => s.points[i].name + ' · ' + (dc ? 'DC kablo (mod 4)' : 'AC kablo (mod 3)'), () => pointInfo(app, i), a => pointActions(a, i));
      sc.units.push(u); sc.flows.push(fl.flow); sc.cars.push(car);
      const bar = k.group(null, bx, 2.05, bz);
      const bg = new T.Mesh(new T.BoxGeometry(0.06, 0.13, 1.7), Xm.barBg); bar.add(bg);
      const fill = new T.Mesh(new T.BoxGeometry(0.07, 0.1, 1.64), new T.MeshBasicMaterial({ color: 0x38bdf8 })); bar.add(fill);
      car.bar = { fill: fill };
      car.label = k.label(p.name, bar, [0, 0.12, 0], 'vs-label--sm');
    });
    buildWheels(k, wheels);
    // dağıtım panosu: ana sayaç + OCPP yük yönetim kontrolörü
    const px = 4.2, pz = -3.8;
    const pano = k.group(null, px, 0, pz);
    k.box(1.3, 0.2, 0.5, M.concrete, 0, 0.1, 0, pano);
    const cab = k.rbox(1.15, 1.7, 0.4, 0.03, M.panelRAL7035, 0, 1.05, 0, pano); k.shell(cab);
    k.rbox(1.25, 0.05, 0.5, 0.02, M.panelRAL7035, 0, 1.93, 0, pano);
    k.box(0.36, 0.3, 0.01, M.plasticDark, -0.25, 1.4, 0.205, pano);
    sc.meter = k.screen(0.3, 0.22, 256, (gx, w, h) => drawMeter(gx, w, h, sc), pano, { emissive: 0.9 }); sc.meter.position.set(-0.25, 1.4, 0.212);
    const ocpp = k.rbox(0.22, 0.16, 0.06, 0.01, M.plasticDark, 0.28, 1.42, 0.21, pano);
    sc.ocppLed = k.sphere(0.018, s.dlm ? M.ledGreen : M.ledOff, 0.36, 1.46, 0.245, pano);
    const nM = Math.min(n, 12);
    for (let j = 0; j < nM; j++) k.rbox(0.035, 0.09, 0.07, 0.006, M.plasticWhite, -0.48 + j * 0.08, 0.95, 0.05, pano);
    k.box(1.0, 0.03, 0.01, M.galv, 0, 0.95, 0.012, pano);
    k.pickable(pano, 'Şarj dağıtım panosu · ana sayaç · OCPP yük yönetimi', () => panoInfo(app), a => [{ label: a.state.dlm ? 'Yük yönetimini kapat' : 'Yük yönetimini aç', variant: a.state.dlm ? 'warn' : 'primary', onClick: x => { x.state.dlm = !x.state.dlm; } }]);
    k.pickable(ocpp, 'OCPP yük yönetim kontrolörü', () => panoInfo(app), a => [{ label: a.state.dlm ? 'Yük yönetimini kapat' : 'Yük yönetimini aç', onClick: x => { x.state.dlm = !x.state.dlm; } }]);
    sc.panoLabel = k.label('Pano', pano, [0, 2.2, 0]);
    // şebeke bağlantısı: özel trafo ya da AG bağlantı/sayaç kabini
    const tx = 7.4, tz = -7.6;
    const tr = k.group(null, tx, 0, tz);
    if (s.connMode === 'trafo') {
      k.box(3.0, 0.15, 2.0, M.concreteDark, 0, 0.075, 0, tr);
      k.box(1.7, 1.25, 0.95, M.trafoPaint, 0, 0.8, 0, tr); k.box(1.8, 0.06, 1.05, M.trafoPaint, 0, 1.45, 0, tr);
      const fins = new T.InstancedMesh(geos(T).fin, M.trafoPaint, 28), d = new T.Object3D();
      for (let j = 0; j < 28; j++) { d.position.set(-0.72 + (j % 14) * 0.11, 0.78, (j < 14 ? 1 : -1) * 0.58); d.updateMatrix(); fins.setMatrixAt(j, d.matrix); }
      fins.castShadow = true; tr.add(fins);
      for (let j = 0; j < 3; j++) k.cyl(0.05, 0.07, 0.38, M.porcelainGrey, -0.45 + j * 0.45, 1.67, -0.2, tr, 14);
      k.screen(0.36, 0.18, 192, drawDanger, tr).position.set(0.35, 0.95, 0.477);
    } else {
      k.box(1.2, 0.15, 0.7, M.concrete, 0, 0.075, 0, tr);
      k.rbox(1.0, 1.4, 0.45, 0.03, M.panelRAL7035, 0, 0.85, 0, tr);
      k.screen(0.36, 0.18, 192, drawDanger, tr).position.set(0, 1.1, 0.232);
    }
    k.pickable(tr, () => (s.connMode === 'trafo' ? 'Özel trafo ' + s.trafoKVA + ' kVA' : 'AG bağlantı ve sayaç kabini'), () => { const r = app.validResult; return r && r.values.hub ? ['Bağlantı sınırı: ' + fmt(r.values.limit, 1) + ' kW' + (s.connMode === 'trafo' ? ' (trafo × 0,95)' : ''), 'Tepe talep: ' + fmt(r.values.hub.peak, 1) + ' kW · ' + clock(s.startHour, r.values.hub.peakAt), 'Bağlantı gücü dağıtım şirketinin bağlantı görüşüyle belirlenir'] : []; });
    sc.trLabel = k.label('Bağlantı', tr, [0, 2.2, 0], 'vs-label--sm');
    // bina (baz yük) ve çatı GES'i
    if (s.baseProfile !== 'none') {
      const bld = k.group(null, 11.5, 0, -11);
      k.box(6, 4.2, 9, M.wallPanel, 0, 2.1, 0, bld); k.box(6.3, 0.2, 9.3, M.roofSheet, 0, 4.3, 0, bld);
      for (let j = 0; j < 4; j++) k.box(0.05, 1.4, 1.6, Xm.darkGlass, -3.02, 2.4, -3 + j * 2, bld);
      if (s.pvKWp > 0) { const pv = new T.InstancedMesh(new T.BoxGeometry(1.0, 0.04, 1.7), M.pvCell, 20), d = new T.Object3D(); for (let j = 0; j < 20; j++) { d.position.set(-2.2 + (j % 4) * 1.15, 4.6, -3.6 + Math.floor(j / 4) * 1.8); d.rotation.set(0, 0, 0.3); d.updateMatrix(); pv.setMatrixAt(j, d.matrix); } pv.castShadow = true; bld.add(pv); }
      k.pickable(bld, 'Bina (baz yük' + (s.pvKWp > 0 ? ' + çatı GES' : '') + ')', () => { const r = app.validResult; if (!r || !r.values.hub) return []; const h = r.values.hub, j = at(h, app.live.t); return [X.BASE_PROFILES[s.baseProfile].name + ' · tepe ' + s.basePeak + ' kW', 'Şu an baz yük ' + fmt(h.base[j], 1) + ' kW' + (s.pvKWp > 0 ? ' · GES ' + fmt(h.pv[j], 1) + ' kW' : ''), 'Şarj için kalan pay = bağlantı − baz + GES']; });
      sc.bldLabel = k.label('Bina', bld, [0, 5.2, 0], 'vs-label--sm');
    }
    if (s.batKWh > 0) {
      const bt = k.group(null, 6.2, 0, 2.4);
      k.box(2.6, 0.15, 1.4, M.concrete, 0, 0.075, 0, bt); k.rbox(2.4, 2.0, 1.2, 0.05, M.plasticWhite, 0, 1.15, 0, bt);
      for (let j = 0; j < 6; j++) k.box(0.3, 0.03, 0.01, M.darkSteel, -0.8 + j * 0.32, 1.7, 0.61, bt);
      sc.batLed = k.sphere(0.04, M.ledGreen, 0.9, 1.8, 0.62, bt);
      k.pickable(bt, 'Batarya tamponu (tepe tıraşlama)', () => { const r = app.validResult; if (!r || !r.values.hub) return []; const h = r.values.hub, j = at(h, app.live.t); return [s.batKWh + ' kWh · ' + s.batKW + ' kW', 'Anlık ' + (h.bat[j] > 0 ? 'deşarj ' + fmt(h.bat[j], 1) : h.bat[j] < 0 ? 'şarj ' + fmt(-h.bat[j], 1) : '0') + ' kW', 'Toplam deşarj ' + fmt(h.batOut, 1) + ' kWh']; });
    }
    // kablo güzergâhı: bağlantı → pano → adalar
    const route = [[tx - 0.6, 0.06, tz + 0.8], [px + 0.4, 0.06, pz - 0.6], [px, 0.06, pz + 0.3], [px - 0.8, 0.06, pz + 1.4], [ISLAND_X + 0.4, 0.06, -3.0], [ISLAND_X, 0.18, -2.9], [ISLAND_X - BAY * (cols - 1), 0.18, -2.9]];
    const trench = k.tube(route, 0.045, M.concreteDark, k.viewer.root, 160); trench.castShadow = false;
    sc.gridFlow = k.flow(trench.userData.curve, 46, 0xfcd34d, 0.05);
    // kamera
    app.def.scene.bounds = [xL - 0.5, xR];
    const cx = (xL + xR) / 2 - 2.5, cz = -(rows - 1) * ROWZ / 2 - 3, span = Math.max(xR - xL, rows * ROWZ + 6);
    const key = cols + '|' + rows;
    if (app._viewKey !== key) { app._viewKey = key; v.setView({ target: [cx, 0.7, cz - 1.5], r: Math.max(15, span * 1.02), theta: 0.6, phi: 1.0, limits: { rMin: 2, rMax: Math.max(60, span * 3), phiMin: 0.2, phiMax: 1.5 } }); }
    v.setShadowBox(Math.max(12, span * 0.75), 90);
    v.sun.position.set(cx + 10, 18, cz + 9); v.sun.target.position.set(cx, 0, cz - 1.5);
  }
  function panoInfo(app) {
    const r = app.validResult, s = app.state; if (!r || !r.values.hub) return [];
    const h = r.values.hub, j = at(h, app.live.t);
    return ['Ana sayaç: ' + fmt(h.chargeE, 1) + ' kWh şarj (oturum sonu) · anlık şebeke ' + fmt(h.grid[j], 1) + ' kW', 'OCPP yük yönetimi: ' + (s.dlm ? 'AÇIK — öncelik + 6 A alt sınırıyla paylaşım' : 'KAPALI — noktalar tam talep çeker'), 'Bağlantı sınırı ' + fmt(r.values.limit, 1) + ' kW · tepe ' + fmt(h.peak, 1) + ' kW', s.points.length + ' çıkış devresi (MCB/MCCB + RCD)'];
  }

  /* ---------------------------------------------------------------- ekranlar (canvas) */
  function drawBayIcon(g, w, h) {
    g.clearRect(0, 0, w, h); g.fillStyle = '#2f7d4f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f1f1ee'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f1f1ee'; g.beginPath(); g.moveTo(w * 0.56, h * 0.18); g.lineTo(w * 0.36, h * 0.54); g.lineTo(w * 0.5, h * 0.54); g.lineTo(w * 0.44, h * 0.82); g.lineTo(w * 0.66, h * 0.44); g.lineTo(w * 0.52, h * 0.44); g.closePath(); g.fill();
  }
  function drawDanger(g, w, h) {
    g.fillStyle = '#f2c200'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 5; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#111'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.fillText('DİKKAT', w / 2, 34); g.font = 'bold 16px Arial'; g.fillText('YÜKSEK GERİLİM', w / 2, 62); g.fillText('ÖLÜM TEHLİKESİ', w / 2, 84);
  }
  function pstate(sc, i) {
    const app = sc.app, r = app.validResult; if (!r || !r.values.hub) return null;
    const h = r.values.hub, j = at(h, app.live.t), p = app.state.points[i]; if (!p) return null;
    return { p: p, P: h.P[i][j], soc: h.soc[i][j], paused: !!h.paused[i][j], done: h.points[i].finishMin !== null && h.points[i].finishMin <= app.live.t + 1e-6, active: p.plugged && p.enabled && compatible(p) };
  }
  function drawDC(g, w, h, sc, i) {
    const n = pstate(sc, i);
    g.fillStyle = '#06111f'; g.fillRect(0, 0, w, h);
    g.fillStyle = n && n.active ? '#0ea5e9' : '#334155'; g.fillRect(0, 0, w, 38);
    g.fillStyle = '#04121f'; g.font = 'bold 18px Arial'; g.textAlign = 'left'; g.fillText('DC · ' + (n ? n.p.name : ''), 12, 26);
    g.textAlign = 'center';
    if (!n || !n.active) { g.fillStyle = '#94a3b8'; g.font = 'bold 26px Arial'; g.fillText(n && !compatible(n.p) ? 'UYUMSUZ' : 'HAZIR', w / 2, h / 2); return; }
    g.fillStyle = '#e2e8f0'; g.font = 'bold 54px Arial'; g.fillText(fmt(n.P, 1), w / 2, 102);
    g.fillStyle = '#7dd3fc'; g.font = 'bold 18px Arial'; g.fillText(n.paused ? 'BEKLİYOR' : 'kW (şebeke)', w / 2, 126);
    g.lineWidth = 12; g.strokeStyle = '#1e293b'; g.beginPath(); g.arc(w / 2, 196, 46, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = n.done ? '#22c55e' : '#38bdf8'; g.beginPath(); g.arc(w / 2, 196, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * n.soc / 100); g.stroke();
    g.fillStyle = '#e2e8f0'; g.font = 'bold 26px Arial'; g.fillText('%' + fmt(n.soc, 0), w / 2, 205);
    g.fillStyle = '#fcd34d'; g.font = 'bold 16px Arial'; g.fillText(n.done ? 'TAMAMLANDI' : 'Hedef %' + n.p.car.soc1, w / 2, 290);
  }
  function drawAC(g, w, h, sc, i) {
    const n = pstate(sc, i);
    g.fillStyle = '#06111f'; g.fillRect(0, 0, w, h); g.textAlign = 'center';
    if (!n || !n.active) { g.fillStyle = '#94a3b8'; g.font = 'bold 24px Arial'; g.fillText(n && !n.p.plugged ? 'HAZIR' : 'BEKLEMEDE', w / 2, h / 2 + 8); return; }
    g.fillStyle = '#fcd34d'; g.font = 'bold 40px Arial'; g.fillText(n.paused ? '6 A ↓' : fmt(n.P, 1) + ' kW', w / 2, 52);
    g.fillStyle = '#7dd3fc'; g.font = 'bold 22px Arial'; g.fillText((n.done ? 'BİTTİ · ' : '') + 'SOC %' + fmt(n.soc, 0), w / 2, 96);
    g.fillStyle = '#64748b'; g.font = '16px Arial'; g.fillText(n.p.name, w / 2, 122);
  }
  function drawMeter(g, w, h, sc) {
    const r = sc.app.validResult;
    g.fillStyle = '#c8d3b4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f2a14'; g.font = 'bold 15px monospace'; g.textAlign = 'left'; g.fillText('MID · 3F · kWh', 12, 22);
    if (!r || !r.values.hub) return;
    const hb = r.values.hub, j = at(hb, sc.app.live.t);
    let e = 0; for (let q = 0; q < j; q++) e += hb.grid[q] / 60;
    g.font = 'bold 40px monospace'; g.textAlign = 'right'; g.fillText(e.toFixed(1).padStart(7, '0'), w - 12, 86);
    g.font = 'bold 22px monospace'; g.fillText('P ' + fmt(hb.grid[j], 1) + ' kW', w - 12, 128);
    g.font = '14px monospace'; g.textAlign = 'left'; g.fillText('Sınır ' + fmt(r.values.limit, 0) + ' kW', 12, 176);
  }

  /* ---------------------------------------------------------------- sahne güncelleme */
  function update(k, res, s, live, app) { const sc = app.scene3; if (!sc) return; let ch = false; s.points.forEach((p, i) => { if (showPlug(sc, i, !!p.plugged)) ch = true; }); if (ch) k.invalidate(true); sc.lastScr = -1; sc.lastMods = []; sc.lastJ = -1; animate(k, 0, res, s, live, app); }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc || !res.values.hub) return;
    const h = res.values.hub, j = at(h, live.t), T = k.T, M = k.mats, col = sc._color || (sc._color = new T.Color());
    // sahne yalnız zaman serisinde yeni bir adıma geçilince güncellenir; enerji akışları kendi karelerini ister
    const jk = j + (live.done ? 'd' : '');
    if (jk === sc.lastJ) return false;
    sc.lastJ = jk;
    s.points.forEach((p, i) => {
      const car = sc.cars[i], u = sc.units[i]; if (!car || !u || !h.P[i]) return;
      const P = h.P[i][j] || 0, soc = h.soc[i][j] || 0, done = h.points[i].finishMin !== null && h.points[i].finishMin <= live.t + 1e-6, paused = !!h.paused[i][j];
      if (sc.flows[i]) sc.flows[i].speed = P > 0 ? 0.04 + 0.7 * Math.min(1, P / 150) : 0;
      const f = Math.max(0.001, soc / 100);
      car.bar.fill.scale.z = f; car.bar.fill.position.z = 0.82 * (1 - f);
      col.setHex(done ? 0x22c55e : paused ? 0xf59e0b : 0x38bdf8).convertSRGBToLinear(); car.bar.fill.material.color.copy(col);
      car.label.set(p.name + ' · ' + (!p.plugged ? 'boşta' : !p.enabled ? 'durduruldu' : !compatible(p) ? 'uyumsuz soket' : done ? 'tamam %' + fmt(soc, 0) : paused ? 'bekliyor (6 A)' : fmt(P, 1) + ' kW · %' + fmt(soc, 0)));
      car.label.level(i === s.sel ? 'warn' : done ? 'ok' : !compatible(p) ? 'bad' : '');
      u.led.material = done ? M.ledGreen : P > 0 ? M.ledBlue : M.ledAmber;
      const filled = Math.round(soc / 100 * 16 * 2) / 2;
      if (car.modules && filled !== sc.lastMods[i]) {
        sc.lastMods[i] = filled;
        for (let q = 0; q < 16; q++) { const fr = Math.max(0, Math.min(1, filled - q)); col.setHex(fr >= 1 ? 0x22c55e : fr > 0 ? 0xf59e0b : 0x334155).convertSRGBToLinear(); car.modules.setColorAt(q, col); }
        car.modules.instanceColor.needsUpdate = true;
      }
    });
    sc.gridFlow.speed = h.grid[j] > 0 ? 0.02 + 0.25 * Math.min(1, h.grid[j] / Math.max(1, res.values.limit)) : 0;
    sc.panoLabel.set('Pano · ' + fmt(h.grid[j], 1) + ' / ' + fmt(res.values.limit, 0) + ' kW' + (s.dlm ? ' · OCPP' : ''));
    sc.panoLabel.level(h.grid[j] > res.values.limit + 1e-6 ? 'bad' : '');
    sc.trLabel.set((s.connMode === 'trafo' ? 'Trafo ' + s.trafoKVA + ' kVA' : 'Bağlantı ' + fmt(s.siteKW, 0) + ' kW') + ' · ' + clock(s.startHour, live.t));
    if (sc.bldLabel) sc.bldLabel.set('Bina ' + fmt(h.base[j], 1) + ' kW' + (s.pvKWp > 0 ? ' · GES ' + fmt(h.pv[j], 1) + ' kW' : ''));
    if (sc.ocppLed) sc.ocppLed.material = s.dlm ? M.ledGreen : M.ledOff;
    const tag = Math.floor(live.t * 3 / Math.max(rate(s, h), 0.1)) + (live.done ? 1e6 : 0);
    if (tag !== sc.lastScr) { sc.lastScr = tag; sc.units.forEach(u => u.scr.redraw()); sc.meter.redraw(); }
    void dt;
    return true;
  }

  /* ---------------------------------------------------------------- 2D tek hat şeması (kaydırılabilir) */
  const HEAD = 150, COL_W = 132, ROW_H = 236;
  function grid2d(W, n) { const per = Math.max(1, Math.floor((W - 90) / COL_W)); return { per: per, rows: Math.ceil(n / per) }; }
  function view2dHeight(W, res, s) { return HEAD + grid2d(W, s.points.length).rows * ROW_H + 70; }
  function clip(g, text, w) { if (g.measureText(text).width <= w) return text; let t = text; while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }
  function view2d(g, W, H, res, s, live) {
    const v = res.values, h = v.hub; if (!h) return;
    const j = at(h, live.t), col = { line: '#9fb2cb', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', amber: '#fcd34d', cyan: '#38bdf8' };
    g.lineWidth = 2; g.textBaseline = 'alphabetic';
    const x0 = 34, x1 = W - 66, cx = 18;
    // şebeke / trafo → ana sayaç → OCPP → bara
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx - 14, 60); g.lineTo(cx + 14, 60); g.moveTo(cx, 60); g.lineTo(cx, 72); g.stroke();
    if (s.connMode === 'trafo') { g.beginPath(); g.arc(cx, 82, 10, 0, Math.PI * 2); g.arc(cx, 97, 10, 0, Math.PI * 2); g.stroke(); } else { g.strokeRect(cx - 10, 74, 20, 32); }
    g.strokeRect(cx - 16, 112, 32, 20); g.fillStyle = col.text; g.font = '10px Inter, sans-serif'; g.textAlign = 'center'; g.fillText('kWh', cx, 126);
    g.beginPath(); g.moveTo(cx, 107); g.lineTo(cx, 112); g.moveTo(cx, 132); g.lineTo(cx, HEAD - 10); g.stroke();
    g.textAlign = 'left'; g.font = '12px Inter, sans-serif'; const tw = x1 - cx - 30;
    g.fillStyle = col.text; g.fillText(clip(g, (s.connMode === 'trafo' ? 'Özel trafo ' + s.trafoKVA + ' kVA' : 'AG bağlantı ' + fmt(s.siteKW, 0) + ' kW') + ' · şu an ' + fmt(h.grid[j], 1) + ' kW · tepe ' + fmt(h.peak, 1) + ' kW', tw), cx + 28, 72);
    g.fillStyle = h.overMin ? col.bad : col.dim; g.fillText(clip(g, 'Sınır ' + fmt(v.limit, 1) + ' kW · ' + (s.dlm ? 'OCPP yük yönetimi açık (öncelik + 6 A)' : 'yük yönetimi KAPALI') + (h.overMin ? ' · ' + h.overMin + ' dk aşım' : ''), tw), cx + 28, 92);
    g.fillStyle = col.dim; g.fillText(clip(g, 'Baz yük ' + fmt(h.base[j], 1) + ' kW' + (s.pvKWp > 0 ? ' · GES ' + fmt(h.pv[j], 1) + ' kW' : '') + (s.batKWh > 0 ? ' · batarya ' + fmt(h.bat[j], 1) + ' kW' : '') + ' · ' + clock(s.startHour, live.t), tw), cx + 28, 124);
    const L = grid2d(W, s.points.length), cw = Math.min(COL_W, (x1 - x0) / L.per);
    for (let r = 0; r < L.rows; r++) {
      const by = HEAD + r * ROW_H, n0 = r * L.per, n1 = Math.min(s.points.length, n0 + L.per);
      const xa = x0 + 0.5 * cw, xb = x0 + (n1 - n0 - 0.5) * cw;
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(cx, by - (r ? ROW_H - 10 : 10)); g.lineTo(cx, by); g.stroke();
      g.lineWidth = 5; g.strokeStyle = '#c77b4a'; g.beginPath(); g.moveTo(Math.min(cx, xa), by); g.lineTo(Math.max(cx, xb), by); g.stroke(); g.lineWidth = 2;
      for (let i = n0; i < n1; i++) {
        const p = s.points[i], x = x0 + (i - n0 + 0.5) * cw, c = v.circ[i], P = h.P[i][j], soc = h.soc[i][j], hp = h.points[i];
        const okC = c.coord && c.rcdOk && c.vd <= 5 && compatible(p), lv = okC ? (P > 0 ? col.ok : col.dim) : col.bad;
        g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by); g.lineTo(x, by + 16); g.stroke();
        g.strokeStyle = lv; g.beginPath(); g.moveTo(x, by + 16); g.lineTo(x + (p.plugged && p.enabled ? 0 : 9), by + 32); g.stroke();
        g.strokeStyle = col.line; g.beginPath(); g.moveTo(x, by + 34); g.lineTo(x, by + 37); g.moveTo(x, by + 87); g.lineTo(x, by + 92); g.stroke();   // etiket bölgesinde hat kesilir
        g.font = '10px Inter, sans-serif'; g.textAlign = 'center'; g.fillStyle = c.coord ? col.dim : col.bad;
        g.fillText(clip(g, p.prot + ' ' + p.In + ' A', cw - 8), x, by + 46);
        g.fillStyle = c.rcdOk ? col.dim : col.bad; g.fillText(clip(g, p.rcd === 'A-RDCDD' ? 'A + RDC-DD' : 'RCD ' + p.rcd, cw - 8), x, by + 58);
        g.fillStyle = c.vd > 3 ? col.warn : col.dim; g.fillText(clip(g, p.S + ' mm² · ' + p.L + ' m · %' + fmt(c.vd, 1), cw - 8), x, by + 70);
        g.fillStyle = col.dim; g.fillText(clip(g, p.meter ? 'MID sayaç' : 'sayaçsız', cw - 8), x, by + 82);
        g.strokeStyle = P > 0 ? col.cyan : col.line; g.strokeRect(x - 22, by + 92, 44, 26);
        g.fillStyle = col.text; g.font = 'bold 11px Inter, sans-serif'; g.fillText(kindOf(p) === 'DC' ? 'DC ' + p.stationP : PROF[p.profile].name.split(' ')[1] + ' AC', x, by + 109);
        g.strokeStyle = P > 0 ? col.amber : col.line; g.setLineDash(P > 0 ? [5, 4] : []); g.lineDashOffset = -(live.t * 3 % 9);
        g.beginPath(); g.moveTo(x, by + 118); g.lineTo(x, by + 140); g.stroke(); g.setLineDash([]);
        g.strokeStyle = col.line; g.strokeRect(x - 26, by + 140, 52, 22);
        g.fillStyle = hp.finishMin !== null && hp.finishMin <= live.t ? col.ok : h.paused[i][j] ? col.warn : col.cyan; g.fillRect(x - 24, by + 142, 48 * soc / 100, 18);
        g.fillStyle = col.text; g.font = '11px Inter, sans-serif'; g.fillText('%' + fmt(soc, 0), x, by + 156);
        g.font = 'bold 11px Inter, sans-serif'; g.fillStyle = i === s.sel ? col.amber : col.text; g.fillText(clip(g, p.name, cw - 6), x, by + 180);
        g.font = '10px Inter, sans-serif'; g.fillStyle = h.paused[i][j] ? col.warn : col.dim;
        g.fillText(clip(g, !p.plugged ? 'boşta' : !p.enabled ? 'durduruldu' : !compatible(p) ? 'soket uyumsuz' : h.paused[i][j] ? 'bekliyor (6 A)' : fmt(P, 1) + ' kW · ' + PRIO[p.priority], cw - 6), x, by + 194);
        g.fillText(clip(g, p.car.capacity + ' kWh · ' + (hp.finishMin !== null ? 'bitiş ' + clock(s.startHour, hp.finishMin) : 'bitmiyor'), cw - 6), x, by + 208);
      }
    }
    const yy = HEAD + L.rows * ROW_H + 18;
    g.textAlign = 'left'; g.font = 'bold 12px Inter, sans-serif'; g.fillStyle = col.text;
    g.fillText(clip(g, 'Tüm araçlar: ' + (h.allDone ? clock(s.startHour, h.lastFinish) + ' (' + dur(h.lastFinish) + ')' : 'hedefe ulaşmayan var') + ' · şarj ' + fmt(h.chargeE, 1) + ' kWh · ' + fmt(h.cost, 0) + ' TL', x1 - x0), x0, yy);
    g.font = '12px Inter, sans-serif'; g.fillStyle = col.dim;
    g.fillText(clip(g, 'Koruma–kablo (Ib ≤ In ≤ Iz), ΔU, RCD (Tip A + RDC-DD / Tip B) her nokta için; kırmızı: uygunsuz.', x1 - x0), x0, yy + 20);
  }

  /* ---------------------------------------------------------------- senaryolar ve görevler */
  const st = o => Object.assign(defaults(), o);
  const four = (profile, cars, soc0s) => cars.map((c, i) => mkPoint(i, profile, c, soc0s[i], 80));
  VS.register({
    id: 'sarj', title: '3D Elektrikli Araç Şarj İstasyonu Simülasyonu',
    defaults: defaults,
    initLive: () => ({ t: 0, done: false, sig: '' }),
    autoRun: true,
    startText: 'Şarj merkezi çalışıyor: oturumlar hızlandırılmış oynatılıyor.',
    start: app => { app.live.t = 0; app.live.done = false; app._startedOnce = true; },
    scenarios: [
      { id: 'office', name: 'İşyeri otoparkı · 4 araç, 80 kW, ofis yükü', desc: 'Farklı bataryalar ve SOC’ler; OCPP yük yönetimi bina yüküne göre paylaştırır.', state: st({}), start: true },
      { id: 'single', name: 'Doğrulama · AC 11 kW, 60 kWh %20→%80', desc: 'Tek nokta: ideal enerji 36 kWh (60 × %60).', state: st({ points: [Object.assign(mkPoint(0, 'AC11', 'sedan', 20, 80), { car: Object.assign(mkPoint(0, 'AC11', 'sedan', 20, 80).car, { capacity: 60 }) })], baseProfile: 'none', siteKW: 50 }), start: true },
      { id: 'hpc', name: 'Otoyol · 4 × DC 120 kW, 400 kVA trafo', desc: 'Ticari hizmet; yüksek SOC’de araç kabul gücü düşer, trafo sınırı paylaşılır.', state: st({ points: [0, 1, 2, 3].map(i => mkPoint(i, 'DC120', ['sedan', 'suv', 'compact', 'taxi'][i], [10, 15, 25, 20][i], 80)), connMode: 'trafo', trafoKVA: 400, baseProfile: 'none', publicService: true, salePrice: 9.5 }), start: true },
      { id: 'fleet', name: 'Filo · 12 araç gece şarjı', desc: 'Lojistik filosu 22:00’de bağlanır; gece tarifesi ve 6 A alt sınırıyla duraklatma.', state: st({ points: Array.from({ length: 12 }, (x, i) => mkPoint(i, 'AC22', i % 3 ? 'van' : 'sedan', 15 + (i * 7) % 30, 90)), siteKW: 60, baseProfile: 'factory', basePeak: 30, startHour: 22 }), start: true },
      { id: 'pvbat', name: 'GES + batarya tamponu · zayıf bağlantı', desc: '40 kW bağlantıya rağmen çatı GES’i ve 100 kWh batarya DC hızlı şarjı destekler.', state: st({ points: [mkPoint(0, 'DC60', 'sedan', 15, 80), mkPoint(1, 'AC22', 'suv', 30, 80), mkPoint(2, 'AC11', 'compact', 20, 80)], siteKW: 40, pvKWp: 60, batKWh: 100, batKW: 50, startHour: 10, baseProfile: 'retail', basePeak: 15 }), start: true },
      { id: 'mixedconn', name: 'Soket uyumu · CHAdeMO araç CCS2 cihazda', desc: 'Uyumsuz tabanca: oturum başlamaz. Bağlantıyı CHAdeMO yapın.', state: st({ points: [mkPoint(0, 'DC60', 'chademo', 20, 80), mkPoint(1, 'AC11', 'compact', 30, 80)], baseProfile: 'none', siteKW: 100 }) }
    ],
    tasks: [
      { id: 'deadline', title: '4 aracı 4 saatte %80’e ulaştır', goal: '50 kW bağlantılı ofiste 4 araç sabah 08:00’de bağlanıyor ve 240 dk içinde %80’e ulaşamıyor. Bağlantı gücünü artırmadan tüm araçları 240 dk içinde %80’e getirin.', hint: 'Bina baz yükü sabah yüksek: oturum başlangıcını akşama kaydırın ya da batarya tamponu ekleyin.',
        state: st({ points: four('AC22', ['sedan', 'suv', 'compact', 'taxi'], [40, 45, 30, 40]), siteKW: 50, basePeak: 30, startHour: 8, deadline: 240 }), start: true,
        check: (r, s) => r.values.limit <= 50 && s.points.length >= 4 && s.points.every(p => p.plugged && p.enabled && p.car.soc1 >= 80) && r.values.hub.allDone && r.values.hub.lastFinish <= 240 },
      { id: 'fast', title: '77 kWh aracı 30 dk’da %10→%80 şarj et', goal: 'DC 60 kW cihazla 77 kWh sedan %10’dan %80’e yaklaşık 1 saatte şarj oluyor. Cihaz gücünü seçerek 30 dk’nın altına indirin.', hint: 'Seçili nokta → şarj cihazı: DC 120/180 kW. Aracın kabul gücü (150 kW) ve tipik eğri sınırlar.',
        state: st({ points: [mkPoint(0, 'DC60', 'sedan', 10, 80)], connMode: 'trafo', trafoKVA: 400, baseProfile: 'none' }),
        check: (r, s) => s.points[0].car.capacity >= 77 && s.points[0].car.soc0 <= 10 && s.points[0].car.soc1 >= 80 && r.values.hub.points[0].finishMin !== null && r.values.hub.points[0].finishMin < 30 },
      { id: 'peak', title: 'Bağlantı gücü aşımını önle', goal: 'Yük yönetimi kapalı: 4 × 22 kW oturum ve bina yükü 50 kW bağlantıyı aşıyor. Hiçbir aracı çıkarmadan tepe talebi sınırın altında tutun.', hint: '3D’de panoya (OCPP kontrolörü) tıklayın → “Yük yönetimini aç”.',
        state: st({ points: four('AC22', ['suv', 'suv', 'suv', 'suv'], [20, 30, 25, 15]), siteKW: 50, basePeak: 20, startHour: 9, dlm: false }), start: true,
        check: (r, s) => r.values.limit <= 50 && s.points.length >= 4 && s.points.every(p => p.plugged && p.enabled) && r.values.hub.overMin === 0 },
      { id: 'priority', title: 'Taksiyi öncelikle şarj et', goal: '24 kW’lık otoparkta taksi (Nokta 2) 100 dk içinde %80’e ulaşmalı. Diğer araçları çıkarmadan sağlayın.', hint: '3D’de taksiye ya da şarj noktasına tıklayın → öncelik “Yüksek”.',
        state: st({ points: [mkPoint(0, 'AC22', 'suv', 20, 80), Object.assign(mkPoint(1, 'AC22', 'taxi', 55, 80), { name: 'Nokta 2 (taksi)' }), mkPoint(2, 'AC22', 'sedan', 20, 80)], siteKW: 24, baseProfile: 'none' }), start: true,
        check: (r, s) => r.values.limit <= 24 && s.points.length >= 3 && s.points.every(p => p.plugged && p.enabled) && r.values.hub.points[1].finishMin !== null && r.values.hub.points[1].finishMin <= 100 },
      { id: 'tou', title: 'Filo şarj maliyetini düşür', goal: '4 araçlık filonun gündüz şarj maliyetini üç zamanlı tarifede 450 TL’nin altına indirin (aynı enerji, aynı araçlar).', hint: 'Oturum başlangıcını gece dilimine (22:00 sonrası) kaydırın.',
        state: st({ points: four('AC11', ['sedan', 'sedan', 'van', 'compact'], [10, 15, 10, 20]), siteKW: 60, baseProfile: 'none', startHour: 9 }),
        check: (r, s) => s.tariffMode === 'tou' && s.priceNight >= 1.9 && s.priceDay >= 3 && s.pricePeak >= 4.6 && s.points.length >= 4 && r.values.hub.allDone && r.values.hub.cost < 450 },
      { id: 'circuit', title: 'Nokta besleme devresini düzelt', goal: '22 kW noktada yalnız Tip A RCD ve B1 yönteminde 4 mm² kablo var. Koruma, kablo ve RCD kontrollerini uygun hale getirin.', hint: 'Seçili nokta: RCD “Tip A + RDC-DD” veya “Tip B”; kesiti 6 mm²’ye çıkarın ya da “Devreyi otomatik boyutlandır”.',
        state: st({ points: [Object.assign(mkPoint(0, 'AC22', 'suv', 20, 80), { rcd: 'A', S: 4, method: 'B1', In: 32, L: 35 })], baseProfile: 'none', siteKW: 50 }),
        check: (r, s) => { const c = r.values.circ[0]; return c.coord && c.rcdOk && c.vd <= 3 && s.points[0].profile === 'AC22'; } },
      { id: 'license', title: 'Ücretli hizmette doğru mevzuat kapsamı', goal: 'AVM otoparkında ziyaretçilerden 9 TL/kWh alınıyor ama senaryo “özel kullanım” seçili. Satışı sürdürerek mevzuat kapsamını düzeltin.', hint: 'Tarife, maliyet ve mevzuat → “Herkese açık ücretli şarj hizmeti”. Her noktada MID sayaç olsun.',
        state: st({ salePrice: 9, publicService: false }),
        check: (r, s) => s.publicService && s.salePrice > 0 && s.points.every(p => p.meter) },
    ],
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => (res.values.hub && res.values.hub.overMin ? { level: 'bad', text: 'Bağlantı gücü aşılıyor' } : live.done && res.values.hub && res.values.hub.allDone ? { level: 'ok', text: 'Tüm araçlar hedefte' } : null),
    reportInputs: s => s.points.map((p, i) => ({ group: 'Şarj noktaları', label: (i + 1) + '. ' + p.name, value: (PROF[p.profile] || PROF.AC11).name + (kindOf(p) === 'DC' ? ' ' + p.stationP + ' kW' : '') + ' · ' + CONN[p.conn] + ' · ' + p.prot + ' ' + p.In + ' A · ' + RCD[p.rcd] + ' · ' + p.S + ' mm² ' + p.method + ' ' + p.L + ' m' + (p.meter ? ' · MID' : '') + ' | araç ' + p.car.capacity + ' kWh %' + p.car.soc0 + '→%' + p.car.soc1 + ', OBC ' + p.car.obcPhases + 'F ' + p.car.obcI + ' A, DC ' + p.car.dcMax + ' kW, ' + p.car.inlet.toUpperCase() + ' · öncelik ' + PRIO[p.priority] + (p.plugged ? '' : ' · boşta') + (p.enabled ? '' : ' · durduruldu') })),
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-6, 6], background: 0x9fb9d4 },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
