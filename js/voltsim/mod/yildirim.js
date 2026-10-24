/* VoltSim · 3D Yıldırımdan Korunma Simülasyonu
 * Hesap: VoltSimEngine.ext.yildirim (IEC 62305-3 Tablo 2/4/10–12 değerleri; yuvarlanan küre ile çatı maruziyet haritası,
 * koruma açısı (Şekil 1'e eşit alan yaklaşımı), ağ (göz) yöntemi, iniş iletkeni sayısı, ayırma mesafesi s = ki·(kc/km)·l,
 * halka topraklama direnci (topraklama modülünün bağıntısı), bilgi amaçlı ND). Risk analizi (IEC 62305-2) modellenmez.
 * Sahne: düz çatılı bina, hava sonlandırma çubukları / kenar ve ağ iletkenleri, iniş iletkenleri, halka topraklama; yarı saydam
 * küre çatı üzerinde yuvarlanır, çatıda açık kalan bölgeler kırmızı gösterilir. */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const Y = E.ext.yildirim;
  const LPLS = ['I', 'II', 'III', 'IV'];

  function defaults() {
    return { lpl: 'III', L: 40, W: 20, H: 12, method: 'sphere', rods: true, rodH: 2, rodD: 10, perimeter: true, mesh: false, meshM: 15,
      nDown: 8, lSep: 14, dEq: 1, medium: 'air', NG: 2, Cd: 0.5, rho: 100, showCones: true };
  }

  /* ---------------------------------------------------------------- hesap */
  function compute(s) {
    const r = Y.compute(s);
    if (r.ok) r.values.profile = Y.sphereProfile(s, r.values.r, 120);
    return r;
  }
  const chk = (res, id) => res.checks.find(c => c.id === id);
  const lvOf = c => (!c ? undefined : c.status === 'fail' ? 'bad' : c.status === 'warn' ? 'warn' : c.status === 'ok' ? 'ok' : undefined);
  const mainCheck = res => chk(res, res.values.method === 'mesh' ? 'mesh' : res.values.method === 'angle' ? 'angle' : 'sphere');

  /* ---------------------------------------------------------------- kontroller */
  function controls(s, app) {
    const r = app.validResult, P = Y.LPL[s.lpl] || Y.LPL.III, g = [];
    g.push({ title: 'Koruma seviyesi ve yöntem', items: [
      { type: 'seg', key: 'lpl', label: 'Yıldırımdan korunma seviyesi (LPL)', options: LPLS.map(k => [k, 'LPL ' + k]) },
      { type: 'note', html: 'LPL ' + s.lpl + ': küre r = <b>' + P.r + ' m</b> · göz ' + P.mesh + ' × ' + P.mesh + ' m · iniş aralığı ' + P.down + ' m · ki ' + fmt(P.ki, 2) + ' · en küçük tepe akımı ' + P.Imin + ' kA (IEC 62305-1/-3). Gerekli LPL risk analiziyle (IEC 62305-2) seçilir.' },
      { type: 'seg', key: 'method', label: 'Hava sonlandırma tasarım yöntemi', options: [['sphere', 'Yuvarlanan küre'], ['angle', 'Koruma açısı'], ['mesh', 'Ağ (göz)']], onChange: (v, a) => { if (v === 'mesh') { a.state.mesh = true; a.state.perimeter = true; } a.renderControls(); } }
    ] });
    g.push({ title: 'Yapı', items: [
      { type: 'range', key: 'L', label: 'Bina boyu L', min: 10, max: 120, step: 1, unit: 'm', rebuild: true },
      { type: 'range', key: 'W', label: 'Bina eni W', min: 8, max: 80, step: 1, unit: 'm', rebuild: true },
      { type: 'range', key: 'H', label: 'Bina yüksekliği H', min: 4, max: 90, step: 1, unit: 'm', rebuild: true }
    ] });
    g.push({ title: 'Hava sonlandırma', items: [
      { type: 'toggle', key: 'rods', label: 'Çubuk (paratoner) ızgarası', rebuild: true },
      s.rods ? { type: 'range', key: 'rodH', label: 'Çubuk yüksekliği (çatıdan)', min: 0.5, max: 10, step: 0.1, unit: 'm', digits: 1, rebuild: true } : null,
      s.rods ? { type: 'range', key: 'rodD', label: 'Çubuk aralığı (ızgara)', min: 3, max: 40, step: 0.5, unit: 'm', digits: 1, rebuild: true } : null,
      { type: 'toggle', key: 'perimeter', label: 'Çatı kenarı iletkeni', rebuild: true },
      { type: 'toggle', key: 'mesh', label: 'Çatı ağ (göz) iletkenleri', rebuild: true },
      s.mesh ? { type: 'range', key: 'meshM', label: 'Göz boyutu', min: 3, max: 30, step: 1, unit: 'm', rebuild: true } : null,
      { type: 'toggle', key: 'showCones', label: 'Koruma konilerini göster (açı yöntemi)', rebuild: true },
      r ? { type: 'note', html: 'Köşegende sarkma p ≈ <b>' + fmt(r.values.pen, 2) + ' m</b> · ' + fmt(s.rodH, 1) + ' m çubukla en büyük aralık ≈ ' + fmt(r.values.maxD, 1) + ' m' + (r.values.alpha !== null ? ' · α ≈ ' + fmt(r.values.alpha, 0) + '° (Şekil 1’e yaklaşık)' : ' · açı yöntemi uygulanmaz (h > r)') } : null
    ] });
    g.push({ title: 'İniş iletkenleri ve ayırma mesafesi', items: [
      { type: 'range', key: 'nDown', label: 'İniş iletkeni sayısı', min: 1, max: 40, step: 1, rebuild: true },
      { type: 'range', key: 'lSep', label: 'l: noktadan en yakın eşpotansiyel bağlantıya iletken boyu', min: 1, max: 100, step: 0.5, unit: 'm', digits: 1 },
      { type: 'range', key: 'dEq', label: 'Çatı ekipmanının hava sonlandırmaya uzaklığı', min: 0, max: 5, step: 0.05, unit: 'm', digits: 2, rebuild: true },
      { type: 'seg', key: 'medium', label: 'Aradaki ortam (km)', options: [['air', 'Hava (1)'], ['solid', 'Beton/tuğla (0,5)']] },
      r ? { type: 'note', html: 's = ' + fmt(r.values.P.ki, 2) + '·(' + fmt(r.values.kc, 2) + '/' + fmt(r.values.km, 1) + ')·' + fmt(s.lSep, 1) + ' = <b>' + fmt(r.values.s, 2) + ' m</b> · gerekli iniş ≥ ' + r.values.nReq } : null
    ] });
    g.push({ title: 'Topraklama ve çevre (bilgi)', collapsed: true, summary: 'NG, CD, toprak özdirenci', items: [
      { type: 'range', key: 'rho', label: 'Toprak özdirenci ρ', min: 10, max: 3000, step: 10, unit: 'Ω·m' },
      { type: 'number', key: 'NG', label: 'Yer yıldırım yoğunluğu NG', min: 0.1, max: 30, step: 0.1, unit: '1/(km²·yıl)', digits: 1, help: 'Bölgesel yıldırım haritasından alınır; burada kullanıcı girdisidir.' },
      { type: 'select', key: 'Cd', label: 'Konum faktörü CD (IEC 62305-2 Tablo A.1)', options: Object.keys(Y.CD).map(k => [Number(k), fmt(Number(k), 2) + ' · ' + Y.CD[k]]) }
    ] });
    return g;
  }

  /* ---------------------------------------------------------------- zaman davranışı: küre yuvarlanır, yıldırım düşer */
  function start(app) { const L = app.live; L.t = 0; L.flash = 0; L.struck = null; L.phase = 'roll'; }
  function tick(app, dt) {
    const L = app.live, r = app.validResult; if (!r || L.phase === 'idle') return false;
    L.t += dt;
    if (L.phase === 'roll' && L.t > 6) { L.phase = 'strike'; L.flash = 0; L.struck = strikePoint(app.state, r.values); VS.toast(L.struck.exposed ? 'Yıldırım korunmasız çatıya düştü!' : 'Yıldırım hava sonlandırma elemanına düştü ve iniş iletkenlerinden toprağa aktı.', L.struck.exposed ? 'bad' : 'ok'); }
    if (L.phase === 'strike') { L.flash += dt; if (L.flash > 2.5) { L.phase = 'done'; app.invalidate(); } }
    return true;
  }
  /** Darbe noktası: açık çatı varsa (en büyük açıklık merkezine yakın) oraya, yoksa en yüksek çubuk ucuna / kenar iletkenine. */
  function strikePoint(s, v) {
    const e = v.exp;
    if (v.method !== 'mesh' && e.pct > 0) {
      let best = -1, bi = 0, bj = 0;
      for (let i = 0; i < e.nx; i++) for (let j = 0; j < e.nz; j++) if (e.exposed[i * e.nz + j]) { const d = -Math.abs(i - e.nx / 2) - Math.abs(j - e.nz / 2); if (best === -1 || d > best) { best = d; bi = i; bj = j; } }
      return { x: -s.L / 2 + (bi + 0.5) * s.L / e.nx, y: s.H, z: -s.W / 2 + (bj + 0.5) * s.W / e.nz, exposed: true };
    }
    if (s.rods && v.rods.length) { const p = v.rods[Math.floor(v.rods.length / 2)]; return { x: p[0], y: s.H + s.rodH, z: p[1], exposed: false }; }
    return { x: s.L / 2, y: s.H, z: -s.W / 2, exposed: v.method === 'mesh' ? !s.mesh : !s.perimeter };
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, live) {
    const v = res.values, mc = mainCheck(res);
    return [
      { label: 'Küre yarıçapı r', value: fmt(v.r, 0, 'm'), sub: 'LPL ' + v.lpl + ' · I_min ' + v.P.Imin + ' kA → 10·I^0,65 ≈ ' + fmt(v.rI, 1) + ' m' },
      { label: v.method === 'mesh' ? 'Göz boyutu' : 'Açıkta kalan çatı', value: v.method === 'mesh' ? (s.mesh ? fmt(s.meshM, 0) + ' × ' + fmt(s.meshM, 0) + ' m' : 'ağ yok') : '%' + fmt(v.exp.pct, 1), level: lvOf(mc), sub: v.method === 'mesh' ? 'en çok ' + v.P.mesh + ' × ' + v.P.mesh + ' m' : v.method === 'angle' ? 'koruma açısı yöntemi' : 'yuvarlanan küre haritası' },
      { label: 'Koruma açısı', value: v.alpha === null ? 'uygulanmaz' : fmt(v.alpha, 0) + '°', sub: v.alpha === null ? 'h > r' : 'h = ' + fmt(s.rodH, 1) + ' m · çatıda R = ' + fmt(v.alphaR, 2) + ' m (yaklaşık)' },
      { label: 'Sarkma (ızgara köşegeni)', value: fmt(v.pen, 2, 'm'), sub: 'çubuk ' + fmt(s.rodH, 1) + ' m · d_maks ' + fmt(v.maxD, 1) + ' m', level: lvOf(chk(res, 'pen')) },
      { label: 'Hava sonlandırma', value: (s.rods ? v.rods.length + ' çubuk' : 'çubuk yok') + (s.mesh ? ' · ağ' : '') + (s.perimeter ? ' · kenar' : ''), sub: s.mesh ? 'ağ iletkeni ≈ ' + fmt(v.meshLen, 0, 'm') : '' },
      { label: 'İniş iletkenleri', value: v.nDown + ' / gerekli ' + v.nReq, level: lvOf(chk(res, 'down')), sub: 'tipik aralık ' + v.P.down + ' m · çevre ' + fmt(2 * (s.L + s.W), 0, 'm') },
      { label: 'Ayırma mesafesi s', value: fmt(v.s, 2, 'm'), level: lvOf(chk(res, 'sep')), sub: 'ekipman ' + fmt(s.dEq, 2) + ' m · kc ' + fmt(v.kc, 2) + ' · km ' + fmt(v.km, 1) },
      { label: 'Halka topraklama (yakl.)', value: fmt(v.Rring, 1, 'Ω'), level: v.Rring <= 10 ? 'ok' : undefined, sub: 'ρ ' + fmt(s.rho, 0) + ' Ω·m · öneri < 10 Ω' },
      { label: 'Yıllık doğrudan darbe ND', value: fmt(v.ND, 3), sub: 'AD ≈ ' + fmt(v.AD, 0) + ' m² · bilgi (risk analizi değil)' },
      { label: 'Simülasyon', wide: true, value: live.phase === 'roll' ? 'Küre yuvarlanıyor…' : live.phase === 'strike' || live.phase === 'done' ? (live.struck && live.struck.exposed ? 'Darbe korunmasız çatıya düştü' : 'Darbe hava sonlandırmaya düştü') : 'Başlatılmadı', level: live.struck ? (live.struck.exposed ? 'bad' : 'ok') : undefined, sub: 'Simülasyonu başlat: küre çatı üzerinde yuvarlanır, ardından yıldırım düşer.' }
    ];
  }
  function charts(res, s) {
    const v = res.values, ch = [];
    const prof = v.profile, top = Math.max(s.H + (s.rods ? s.rodH : 0), ...prof.map(p => p[1] - v.r));
    ch.push({ id: 'prof', title: 'Boyuna kesit · küre alt yüzeyi ve bina (m)', height: 170,
      series: [{ name: 'Bina + çubuklar', color: 'grey', width: 2, data: outline(s, v) }, { name: 'Küre alt noktası (y_merkez − r)', color: 'cyan', width: 2, data: prof.map(p => [p[0], p[1] - v.r]) }],
      x: { min: -s.L / 2 - v.r, max: s.L / 2 + v.r, label: 'x (m)' }, y: { min: 0, max: Math.max(top * 1.25, s.H + 3), label: 'm' },
      alt: 'Küre r = ' + v.r + ' m bina ekseni boyunca yuvarlanırken en alt noktası; bina çatısı ' + s.H + ' m.' });
    const ang = LPLS.map((k, i) => { const r = Y.LPL[k].r, d = []; for (let h = 2; h <= r + 1e-9; h += 1) d.push([h, Y.protectionAngle(h, r)]); return { name: 'LPL ' + k, color: ['red', 'amber', 'cyan', 'green'][i], width: k === s.lpl ? 2.6 : 1.3, data: d }; });
    ch.push({ id: 'aci', title: 'Koruma açısı α(h) · Şekil 1’e eşit alan yaklaşımı', height: 170, series: ang,
      markers: v.alpha !== null ? [{ x: s.rodH < 2 ? 2 : s.rodH, y: v.alpha, label: fmt(v.alpha, 0) + '°', color: '#fcd34d' }] : [],
      x: { min: 0, max: 60, label: 'h (m)' }, y: { min: 0, max: 80, label: '°' },
      alt: 'LPL I 2 m’de ≈ 71°, h = r’de ≈ 23°. Proje için standarttaki eğri kullanılmalıdır.' });
    const sl = []; for (let l = 0; l <= 60; l += 1) sl.push([l, Y.separation({ ki: v.P.ki, n: v.nDown, km: v.km, l: l })]);
    ch.push({ id: 'sep', title: 'Ayırma mesafesi s(l) = ki·(kc/km)·l', height: 150, series: [{ name: 's (m)', color: 'violet', data: sl }],
      hLines: [{ y: s.dEq, label: 'ekipman ' + fmt(s.dEq, 2) + ' m', color: '#10b981' }], markers: [{ x: s.lSep, y: v.s, label: 's = ' + fmt(v.s, 2) + ' m', color: '#fcd34d' }],
      x: { min: 0, max: 60, label: 'l (m)' }, y: { min: 0, label: 'm' }, alt: 'l = ' + s.lSep + ' m için s = ' + fmt(v.s, 2) + ' m.' });
    return ch;
  }
  function outline(s, v) {
    const pts = [[-s.L / 2 - v.r, 0], [-s.L / 2, 0], [-s.L / 2, s.H]];
    const xs = v.rods.map(p => p[0]).filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b);
    xs.forEach(x => { pts.push([x, s.H], [x, s.H + s.rodH], [x, s.H]); });
    pts.push([s.L / 2, s.H], [s.L / 2, 0], [s.L / 2 + v.r, 0]);
    return pts;
  }

  /* ---------------------------------------------------------------- 3D sahne */
  function rebuildOn(s) { return [s.L, s.W, s.H, s.rods, s.rodH, s.rodD, s.perimeter, s.mesh, s.meshM, s.nDown, s.lpl, s.method, s.showCones, s.dEq].join('|'); }
  let HIT = null;
  const hitMat = k => HIT || (HIT = new k.T.MeshBasicMaterial({ visible: false }));
  function inst(k, geo, mat, list, parent) {
    const T = k.T, im = new T.InstancedMesh(geo, mat, Math.max(1, list.length)), d = new T.Object3D();
    list.forEach((it, i) => { d.position.fromArray(it.p); d.rotation.set(...(it.r || [0, 0, 0])); d.scale.fromArray(it.s || [1, 1, 1]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.count = list.length; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; parent.add(im); return im;
  }
  /** İniş iletkeni konumları: çevre boyunca eşit aralıklı (köşelerden başlayarak). */
  function downPos(s) {
    const P = 2 * (s.L + s.W), n = Math.max(1, s.nDown), out = [];
    for (let i = 0; i < n; i++) {
      let d = (i + 0.5) * P / n;
      if (d < s.L) out.push([-s.L / 2 + d, -s.W / 2]); else if ((d -= s.L) < s.W) out.push([s.L / 2, -s.W / 2 + d]); else if ((d -= s.W) < s.L) out.push([s.L / 2 - d, s.W / 2]); else { d -= s.L; out.push([-s.L / 2, s.W / 2 - d]); }
    }
    return out;
  }
  function build(k, s, app) {
    const T = k.T, M = k.mats, v = k.viewer;
    HIT = null;
    const sc = {}; app.scene3 = sc;
    const r = (Y.LPL[s.lpl] || Y.LPL.III).r;
    const span = Math.max(s.L, s.W) + 2 * r;
    k.ground(Math.max(200, span * 3), M.grass, 0);
    // bina
    const b = k.group(null, 0, 0, 0);
    const walls = k.box(s.L, s.H, s.W, k.mat(0xc9c3b8, { roughness: 0.85 }), 0, s.H / 2, 0, b);
    k.shell(walls);
    const winMat = k.mat(0x2d4a6b, { roughness: 0.2, metalness: 0.4 }), wins = [];
    for (let fl = 1; fl * 3.2 < s.H - 1; fl++) for (let x = -s.L / 2 + 2; x < s.L / 2 - 1.5; x += 4) { wins.push({ p: [x, fl * 3.2 - 1, s.W / 2 + 0.02] }); wins.push({ p: [x, fl * 3.2 - 1, -s.W / 2 - 0.02] }); }
    if (wins.length) inst(k, new T.BoxGeometry(2, 1.4, 0.05), winMat, wins.slice(0, 4000), v.root);
    k.box(s.L + 0.3, 0.4, s.W + 0.3, M.concreteDark, 0, s.H + 0.2, 0, b).scale.set(1, 1, 1);
    // çatı maruziyet haritası (canvas doku)
    const map = k.screen(s.L, s.W, 512, (g, w, h) => drawRoof(g, w, h, app), null);
    map.rotation.x = -Math.PI / 2; map.position.set(0, s.H + 0.42, 0); sc.map = map;
    k.pickable(map, 'Çatı · maruziyet haritası', () => { const rr = app.validResult; return rr ? ['Kırmızı: kürenin değebildiği (korunmasız) çatı; yeşil: korunan.', rr.values.method === 'mesh' ? 'Ağ yönteminde değerlendirme göz boyutu kuralıyladır.' : 'Açıkta kalan çatı %' + fmt(rr.values.exp.pct, 1), 'Çatı ' + s.L + ' × ' + s.W + ' m, yükseklik ' + s.H + ' m'] : []; },
      () => [{ label: 'Çubuk aralığı −2 m', onClick: a => { a.state.rods = true; a.state.rodD = Math.max(3, a.state.rodD - 2); } }, { label: 'Çubuk +0,5 m', onClick: a => { a.state.rods = true; a.state.rodH = Math.min(10, a.state.rodH + 0.5); } }, { label: 'Kenar iletkeni ' + (s.perimeter ? 'kaldır' : 'ekle'), onClick: a => { a.state.perimeter = !a.state.perimeter; } }]);
    // hava sonlandırma: çubuklar
    const y0 = s.H + 0.4;
    const rods = Y.terminations(Object.assign({}, s, { perimeter: false, mesh: false })).rods;
    if (s.rods && rods.length) {
      const g = k.group(null, 0, 0, 0);
      inst(k, new T.CylinderGeometry(0.06, 0.06, s.rodH, 8), M.galv, rods.map(p => ({ p: [p[0], y0 + s.rodH / 2, p[1]] })), g);
      inst(k, new T.SphereGeometry(0.14, 10, 8), M.alu, rods.map(p => ({ p: [p[0], y0 + s.rodH, p[1]] })), g);
      k.label('Çubuklar ' + fmt(s.rodH, 1) + ' m · ' + rods.length + ' adet', null, [rods[0][0], y0 + s.rodH + 0.6, rods[0][1]], 'vs-label--sm');
      inst(k, new T.CylinderGeometry(0.25, 0.3, 0.12, 12), M.concrete, rods.map(p => ({ p: [p[0], y0 + 0.06, p[1]] })), g);
      k.box(Math.max(1, s.L), s.rodH + 0.3, Math.max(1, s.W), hitMat(k), 0, y0 + s.rodH / 2, 0, g).castShadow = false;
      k.pickable(g, () => 'Hava sonlandırma çubukları (' + rods.length + ')', () => { const rr = app.validResult; return rr ? ['Yükseklik ' + fmt(s.rodH, 1) + ' m · ızgara aralığı ' + fmt(s.rodD, 1) + ' m', 'Köşegende sarkma p ≈ ' + fmt(rr.values.pen, 2) + ' m (p = r − √(r² − (d/2)²))', rr.values.alpha === null ? 'Açı yöntemi uygulanmaz.' : 'Koruma açısı ≈ ' + fmt(rr.values.alpha, 0) + '° (yaklaşık)'] : []; },
        () => [{ label: 'Çubuk +0,5 m', onClick: a => { a.state.rodH = Math.min(10, a.state.rodH + 0.5); } }, { label: 'Çubuk −0,5 m', onClick: a => { a.state.rodH = Math.max(0.5, a.state.rodH - 0.5); } }, { label: 'Aralık −2 m', onClick: a => { a.state.rodD = Math.max(3, a.state.rodD - 2); } }, { label: 'Aralık +2 m', onClick: a => { a.state.rodD = Math.min(40, a.state.rodD + 2); } }]);
      const alpha = Y.protectionAngle(s.rodH, r);
      if (s.method === 'angle' && s.showCones && alpha !== null) {
        const R = s.rodH * Math.tan(alpha * Math.PI / 180), cm = new T.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.16, depthWrite: false });
        inst(k, new T.ConeGeometry(R, s.rodH, 28, 1, true), cm, rods.slice(0, 400).map(p => ({ p: [p[0], y0 + s.rodH / 2, p[1]] })), g).castShadow = false;
      }
    }
    // kenar ve ağ iletkenleri
    const cond = [];
    if (s.perimeter) { cond.push({ p: [0, y0, -s.W / 2], s: [s.L, 1, 1] }, { p: [0, y0, s.W / 2], s: [s.L, 1, 1] }, { p: [-s.L / 2, y0, 0], s: [1, 1, s.W] }, { p: [s.L / 2, y0, 0], s: [1, 1, s.W] }); }
    if (s.mesh) {
      const n1 = Math.max(1, Math.ceil(s.W / s.meshM)), n2 = Math.max(1, Math.ceil(s.L / s.meshM));
      for (let i = 0; i <= n1; i++) cond.push({ p: [0, y0 + 0.01, -s.W / 2 + i * s.W / n1], s: [s.L, 1, 1] });
      for (let i = 0; i <= n2; i++) cond.push({ p: [-s.L / 2 + i * s.L / n2, y0 + 0.01, 0], s: [1, 1, s.W] });
    }
    if (cond.length) { const cg = k.group(null, 0, 0, 0); inst(k, new T.BoxGeometry(1, 0.05, 1).scale(1, 1, 1), M.copper, cond.map(c => ({ p: c.p, s: [c.s[0] === 1 ? 0.06 : c.s[0], 1, c.s[2] === 1 ? 0.06 : c.s[2]] })), cg);
      k.pickable(cg, 'Çatı iletkenleri', () => [(s.perimeter ? 'Kenar iletkeni var. ' : '') + (s.mesh ? 'Ağ gözü ' + s.meshM + ' × ' + s.meshM + ' m (LPL ' + s.lpl + ' için en çok ' + Y.LPL[s.lpl].mesh + ' m).' : 'Ağ yok.'), 'Ağ iletkenleri çatı yüzeyinde ya da kısa tutucularla döşenir.'],
        () => [{ label: 'Göz −1 m', onClick: a => { a.state.mesh = true; a.state.meshM = Math.max(3, a.state.meshM - 1); } }, { label: 'Göz +1 m', onClick: a => { a.state.mesh = true; a.state.meshM = Math.min(30, a.state.meshM + 1); } }]); }
    // iniş iletkenleri ve halka
    const dp = downPos(s), dg = k.group(null, 0, 0, 0);
    inst(k, new T.BoxGeometry(0.06, s.H + 0.4, 0.06), M.copper, dp.map(p => ({ p: [p[0] + Math.sign(p[0]) * 0.05, (s.H + 0.4) / 2, p[1] + Math.sign(p[1]) * 0.05] })), dg);
    sc.downs = dp;
    const ring = [{ p: [0, 0.03, -s.W / 2 - 1], s: [s.L + 2, 1, 1] }, { p: [0, 0.03, s.W / 2 + 1], s: [s.L + 2, 1, 1] }, { p: [-s.L / 2 - 1, 0.03, 0], s: [1, 1, s.W + 2] }, { p: [s.L / 2 + 1, 0.03, 0], s: [1, 1, s.W + 2] }];
    inst(k, new T.BoxGeometry(1, 0.05, 1), M.copper, ring.map(c => ({ p: c.p, s: [c.s[0] === 1 ? 0.08 : c.s[0], 1, c.s[2] === 1 ? 0.08 : c.s[2]] })), dg);
    k.box(s.L + 3, s.H, s.W + 3, hitMat(k), 0, s.H / 2, 0, dg).castShadow = false;
    k.pickable(dg, () => 'İniş iletkenleri (' + s.nDown + ') ve halka topraklama', () => { const rr = app.validResult; return rr ? ['Gerekli en az ' + rr.values.nReq + ' (çevre / ' + rr.values.P.down + ' m, en az iki)', 'Halka elektrot D ≈ ' + fmt(rr.values.ringD, 1) + ' m · R ≈ ' + fmt(rr.values.Rring, 1) + ' Ω (ρ ' + s.rho + ' Ω·m)', 'İniş sayısı arttıkça akım paylaşılır: kc ' + fmt(rr.values.kc, 2) + ' → ayırma mesafesi küçülür.'] : []; },
      () => [{ label: 'İniş +2', onClick: a => { a.state.nDown = Math.min(40, a.state.nDown + 2); } }, { label: 'İniş −2', onClick: a => { a.state.nDown = Math.max(1, a.state.nDown - 2); } }]);
    // çatı ekipmanı (klima)
    const p0 = rods.length ? rods.reduce((a, p) => (Math.abs(p[0]) + Math.abs(p[1]) < Math.abs(a[0]) + Math.abs(a[1]) ? p : a), rods[0]) : [0, 0];
    const eq = k.group(null, p0[0] + s.dEq + 0.6, y0, p0[1]);
    k.box(1.2, 1.0, 0.9, M.wallPanel, 0, 0.5, 0, eq); k.cyl(0.32, 0.32, 0.05, M.darkSteel, 0, 1.02, 0, eq, 20);
    k.pickable(eq, 'Çatı ekipmanı (klima / iklimlendirme)', () => { const rr = app.validResult; return rr ? ['Hava sonlandırmaya uzaklık ' + fmt(s.dEq, 2) + ' m · gerekli s = ' + fmt(rr.values.s, 2) + ' m', s.dEq >= rr.values.s ? 'Ayırma mesafesi sağlanıyor.' : 'Yetersiz: kıvılcım atlaması riski. Uzaklaştırın ya da yıldırım akımına uygun bağlantıyla eşpotansiyel yapın.'] : []; },
      () => [{ label: 'Uzaklaştır +0,25 m', onClick: a => { a.state.dEq = Math.min(5, Math.round((a.state.dEq + 0.25) * 100) / 100); } }, { label: 'Yaklaştır −0,25 m', onClick: a => { a.state.dEq = Math.max(0, Math.round((a.state.dEq - 0.25) * 100) / 100); } }]);
    sc.eqLbl = k.label('Klima', eq, [0, 1.6, 0], 'vs-label--sm');
    // yuvarlanan küre
    const sm = new T.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.13, depthWrite: false, roughness: 0.3 });
    const sphere = new T.Mesh(new T.SphereGeometry(r, 40, 24), sm); sphere.castShadow = false; v.root.add(sphere); sc.sphere = sphere;
    const wire = new T.Mesh(new T.SphereGeometry(r, 20, 12), new T.MeshBasicMaterial({ color: 0x7dd3fc, wireframe: true, transparent: true, opacity: 0.12 })); sphere.add(wire);
    k.pickable(sphere, () => 'Yuvarlanan küre r = ' + r + ' m (LPL ' + s.lpl + ')', () => ['Küre yapının etrafında ve üzerinde her yönde yuvarlanır; değdiği noktalar doğrudan darbeye açıktır.', 'r = 10·I^0,65: daha küçük tepe akımlı darbeler daha küçük küreyle temsil edilir.'], () => [{ label: 'Küreyi yuvarla', variant: 'primary', onClick: a => { a.running = true; a.paused = false; start(a); a.syncToolbar(); } }]);
    sc.sLbl = k.label('Küre r = ' + r + ' m', sphere, [0, r * 0.3, 0], 'vs-label--sm');
    // yıldırım kanalı
    const bolt = k.group(null, 0, 0, 0); bolt.visible = false; sc.bolt = bolt;
    const bm = new T.MeshBasicMaterial({ color: 0xe0f2fe });
    let prev = [0, 1, 0]; for (let i = 0; i < 12; i++) { const n = [(Math.sin(i * 7.1) * 0.08), 1 - (i + 1) / 12, Math.cos(i * 5.3) * 0.08]; const a = new T.Vector3().fromArray(prev), c = new T.Vector3().fromArray(n); const len = a.distanceTo(c); const m = new T.Mesh(new T.CylinderGeometry(0.004, 0.004, len, 6), bm); m.position.copy(a).add(c).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), c.clone().sub(a).normalize()); bolt.add(m); prev = n; }
    const pl = new T.PointLight(0xbfdbfe, 0, span, 2); bolt.add(pl); sc.boltLight = pl;
    sc.r = r;
    app.def.scene.bounds = [-span / 2, span / 2];
    v.setView({ target: [0, s.H * 0.6, 0], r: Math.max(s.L, s.W) * 1.25 + s.H + r * 0.6, theta: 0.6, phi: 1.12, limits: { rMin: 5, rMax: span * 4, phiMax: 1.5 } });
    v.setShadowBox(span * 0.7, span * 4);
    v.sun.position.set(span * 0.4, span * 0.9, span * 0.5);
    placeSphere(sc, s, app.validResult, 0.5);
  }
  function placeSphere(sc, s, res, f) {
    if (!res || !res.ok) return;
    const p = res.values.profile, i = Math.max(0, Math.min(p.length - 1, Math.round(f * (p.length - 1))));
    sc.sphere.position.set(p[i][0], p[i][1], 0);
  }
  function drawRoof(g, w, h, app) {
    const r = app.validResult, s = app.state;
    g.fillStyle = '#6b7280'; g.fillRect(0, 0, w, h);
    if (!r || !r.ok) return;
    const v = r.values, e = v.exp;
    if (v.method === 'mesh') { g.fillStyle = s.mesh && s.meshM <= v.P.mesh && s.perimeter ? 'rgba(16,185,129,.55)' : 'rgba(239,68,68,.55)'; g.fillRect(0, 0, w, h); }
    else for (let i = 0; i < e.nx; i++) for (let j = 0; j < e.nz; j++) { g.fillStyle = e.exposed[i * e.nz + j] ? 'rgba(239,68,68,.75)' : 'rgba(16,185,129,.45)'; g.fillRect(Math.floor(i * w / e.nx), Math.floor(j * h / e.nz), Math.ceil(w / e.nx) + 1, Math.ceil(h / e.nz) + 1); }
  }

  function update(k, res, s, live, app) {
    const sc = app.scene3; if (!sc) return;
    if (live.phase !== 'roll') placeSphere(sc, s, res, 0.5);
    sc.map.redraw(JSON.stringify([res.values.method, res.values.exp.pct, s.meshM, s.mesh, s.perimeter, s.lpl]));
    const sepOk = s.dEq >= res.values.s;
    sc.eqLbl.set('Klima · ' + fmt(s.dEq, 2) + ' m / s ' + fmt(res.values.s, 2) + ' m'); sc.eqLbl.level(sepOk ? 'ok' : 'bad');
    sc.sLbl.set('Küre r = ' + res.values.r + ' m · açık çatı %' + fmt(res.values.exp.pct, 1));
    sc.sLbl.level(res.values.method === 'mesh' ? '' : res.values.exp.pct < 0.5 ? 'ok' : 'bad');
  }
  function animate(k, dt, res, s, live, app) {
    const sc = app.scene3; if (!sc) return false;
    let moving = false;
    if (live.phase === 'roll') { const f = Math.min(1, live.t / 6); placeSphere(sc, s, res, k.reducedMotion ? 0.5 : f); moving = true; }
    const showBolt = live.phase === 'strike' && live.struck;
    if (showBolt) {
      const p = live.struck, hgt = 60;
      sc.bolt.visible = Math.floor(live.flash * 14) % 3 !== 2 || k.reducedMotion;
      sc.bolt.position.set(p.x, p.y, p.z); sc.bolt.scale.set(hgt, hgt, hgt);
      sc.boltLight.intensity = sc.bolt.visible ? 40 : 0; moving = true;
    } else if (sc.bolt.visible) { sc.bolt.visible = false; sc.boltLight.intensity = 0; moving = true; }
    return moving;
  }

  /* ---------------------------------------------------------------- 2D: kesit ve plan */
  function view2d(g, W, H, res, s, live) {
    const v = res.values, col = { line: '#9fb2cb', ok: '#10b981', bad: '#ef4444', text: '#e6eef8', dim: '#7f94b0', cu: '#c77b4a', sky: '#38bdf8' };
    const fitT = VS.fitText, R = W - 70;
    // kesit (x–y)
    const top = 56, secH = Math.min(260, H * 0.42), x0 = -s.L / 2 - v.r, x1 = s.L / 2 + v.r;
    const ymax = Math.max(s.H + (s.rods ? s.rodH : 0) + 2, ...v.profile.map(p => p[1] - v.r)) * 1.2;
    const sc = Math.min((R - 40) / (x1 - x0), secH / ymax);
    const X = x => 24 + (x - x0) * sc, Yy = y => top + secH - y * sc;
    g.strokeStyle = '#4b5563'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(x0), Yy(0)); g.lineTo(X(x1), Yy(0)); g.stroke();
    g.fillStyle = '#334155'; g.fillRect(X(-s.L / 2), Yy(s.H), s.L * sc, s.H * sc);
    g.strokeStyle = col.cu; g.lineWidth = 2;
    v.rods.map(p => p[0]).filter((x, i, a) => a.indexOf(x) === i).forEach(x => { g.beginPath(); g.moveTo(X(x), Yy(s.H)); g.lineTo(X(x), Yy(s.H + s.rodH)); g.stroke(); });
    g.strokeStyle = col.sky; g.lineWidth = 2; g.beginPath(); v.profile.forEach((p, i) => { const y = Yy(Math.max(0, p[1] - v.r)); if (i) g.lineTo(X(p[0]), y); else g.moveTo(X(p[0]), y); }); g.stroke();
    // bir küre çizimi (orta konumda)
    const mid = v.profile[Math.floor(v.profile.length / 2)];
    g.strokeStyle = 'rgba(56,189,248,.45)'; g.setLineDash([5, 4]); g.beginPath(); g.arc(X(mid[0]), Yy(mid[1]), v.r * sc, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = col.dim; g.font = '12px Inter, sans-serif'; g.textBaseline = 'alphabetic';
    g.fillText(fitT(g, 'Boyuna kesit · küre r = ' + v.r + ' m (LPL ' + v.lpl + ') · mavi: kürenin en alt noktası', R - 24), 24, top - 10);
    // plan: maruziyet haritası
    const py = top + secH + 46, ph = Math.min(H - py - 70, 220), pw = Math.min(R - 40, ph * s.L / s.W), phh = pw * s.W / s.L;
    g.fillText(fitT(g, 'Çatı planı · ' + (v.method === 'mesh' ? 'ağ yöntemi (göz ' + s.meshM + ' m, en çok ' + v.P.mesh + ' m)' : 'kırmızı: açık %' + fmt(v.exp.pct, 1)), R - 24), 24, py - 8);
    const e = v.exp;
    if (v.method === 'mesh') { g.fillStyle = s.mesh && s.meshM <= v.P.mesh && s.perimeter ? 'rgba(16,185,129,.55)' : 'rgba(239,68,68,.55)'; g.fillRect(24, py, pw, phh); }
    else for (let i = 0; i < e.nx; i++) for (let j = 0; j < e.nz; j++) { g.fillStyle = e.exposed[i * e.nz + j] ? 'rgba(239,68,68,.8)' : 'rgba(16,185,129,.5)'; g.fillRect(24 + i * pw / e.nx, py + j * phh / e.nz, pw / e.nx + 0.6, phh / e.nz + 0.6); }
    g.fillStyle = '#e5e7eb'; v.rods.forEach(p => { g.beginPath(); g.arc(24 + (p[0] + s.L / 2) / s.L * pw, py + (p[1] + s.W / 2) / s.W * phh, 2.5, 0, Math.PI * 2); g.fill(); });
    g.fillStyle = col.cu; downPos(s).forEach(p => g.fillRect(24 + (p[0] + s.L / 2) / s.L * pw - 3, py + (p[1] + s.W / 2) / s.W * phh - 3, 6, 6));
    g.fillStyle = col.dim; g.font = '11px Inter, sans-serif';
    g.fillText(fitT(g, 'Beyaz nokta: çubuk · turuncu kare: iniş iletkeni (' + s.nDown + ', gerekli ' + v.nReq + ') · s = ' + fmt(v.s, 2) + ' m', R - 24), 24, py + phh + 18);
    g.fillText(fitT(g, 'Değerler VoltSim hesap motorundandır; risk analizi (IEC 62305-2) modellenmez.', R - 24), 24, H - 14);
  }
  function view2dHeight(W) { return 640; }

  /* ---------------------------------------------------------------- görevler */
  const tasks = [
    { id: 'kure', title: 'Çatıyı küreye karşı koruyun', goal: 'LPL II (r = 30 m) fabrika çatısında 1 m’lik çubuklar 20 m arayla dizilmiş: kürenin değdiği korunmasız alanlar var. Yuvarlanan küre yöntemiyle açık çatıyı %0’a indirin.', hint: 'p = r − √(r² − (d/2)²): aralığı küçültün ya da çubuğu yükseltin; çatı kenarı iletkeni kenarlardaki eğik yaklaşımları keser.',
      state: { lpl: 'II', method: 'sphere', rods: true, rodH: 1, rodD: 20, perimeter: false, mesh: false },
      check: r => r.values.method === 'sphere' && r.values.exp.pct < 0.5 },
    { id: 'goz', title: 'Ağ gözünü küçültün', goal: 'LPL II binada 20 m gözlü ağ kullanılmış ve kenar iletkeni yok. Ağ yöntemi koşullarını sağlayın.', hint: 'LPL II için göz en çok 10 × 10 m (Tablo 2); çatı kenarları da iletkenle donatılmalıdır.',
      state: { lpl: 'II', method: 'mesh', mesh: true, meshM: 20, perimeter: false, rods: false },
      check: r => { const c = r.checks.find(x => x.id === 'mesh'); return r.values.method === 'mesh' && c && c.status === 'ok' && !r.checks.some(x => x.id === 'edge'); } },
    { id: 'inis', title: 'İniş iletkeni sayısı', goal: '60 × 30 m depoda yalnız 2 iniş iletkeni var (LPL III). Gerekli sayıyı sağlayın.', hint: 'Çevre / tipik aralık: 180 m / 15 m = 12. 3D’de iniş iletkenlerine tıklayıp “İniş +2” kullanabilirsiniz.',
      state: { lpl: 'III', L: 60, W: 30, nDown: 2 },
      check: r => r.checks.find(x => x.id === 'down').status === 'ok' },
    { id: 'ayirma', title: 'Klima ünitesi ve ayırma mesafesi', goal: 'LPL I çatıda klima, hava sonlandırmaya 0,3 m uzakta; s = ki·(kc/km)·l sağlanmıyor. Ekipmanı taşımadan önce iniş sayısıyla, gerekirse uzaklıkla s koşulunu sağlayın.', hint: 'İniş iletkeni sayısı 3 ve üzeri olunca kc 0,66’dan 0,44’e düşer; l kısaldıkça s azalır. Sonra klimayı s kadar uzaklaştırın.',
      state: { lpl: 'I', nDown: 2, lSep: 20, dEq: 0.3, rodD: 6, rodH: 2 },
      check: r => r.checks.find(x => x.id === 'sep').status === 'ok' },
    { id: 'aci', title: 'Koruma açısı yöntemi', goal: 'LPL IV depoda 1,5 m çubuklar 16 m arayla: koruma konileri çatıyı örtmüyor. Açı yöntemiyle çatının tamamını konilerin içine alın.', hint: 'Koni yarıçapı R = h·tanα(h). Aralığı R√2’nin altına indirin ya da çubuğu yükseltin (α yükseklikle azalır!).',
      state: { lpl: 'IV', method: 'angle', rods: true, rodH: 1.5, rodD: 16, L: 48, W: 24 },
      check: r => r.values.method === 'angle' && r.values.exp.pct < 0.5 }
  ];

  const sc = o => Object.assign(defaults(), o);
  VS.register({
    id: 'yildirim', title: '3D Yıldırımdan Korunma Simülasyonu',
    defaults: defaults,
    initLive: () => ({ phase: 'idle', t: 0, flash: 0, struck: null }),
    autoRun: false,
    startText: 'Küre çatı üzerinde yuvarlanıyor; ardından yıldırım düşecek.',
    start: start,
    scenarios: [
      { id: 'fabrika', name: 'Fabrika · LPL III, çubuk ızgarası', desc: '40 × 20 × 12 m bina; 2 m çubuklar 10 m arayla, kenar iletkeni, 8 iniş iletkeni.', state: defaults() },
      { id: 'hastane', name: 'Hastane · LPL I, ağ yöntemi', desc: 'LPL I için 5 × 5 m göz ve çatı kenarı iletkeni; 10 m iniş aralığı.', state: sc({ lpl: 'I', method: 'mesh', mesh: true, meshM: 5, perimeter: true, rods: false, L: 50, W: 30, H: 18, nDown: 16, lSep: 20 }) },
      { id: 'depo', name: 'Lojistik depo · LPL IV, koruma açısı', desc: '80 × 40 m geniş çatı; koruma açısı yöntemiyle çubuk konileri.', state: sc({ lpl: 'IV', method: 'angle', L: 80, W: 40, H: 10, rodH: 3, rodD: 9, nDown: 12, showCones: true }) },
      { id: 'yuksek', name: 'Yüksek bina · 70 m, yan darbeler', desc: 'H = 70 m > r: küre cepheye değer; 60 m üstü yapılarda üst %20 yan koruma istenir.', state: sc({ lpl: 'II', L: 30, W: 30, H: 70, rodH: 2, rodD: 8, nDown: 12, lSep: 40, dEq: 1.5 }) },
      { id: 'kotu', name: 'Seyrek kısa çubuklar · korunmasız çatı', desc: 'LPL II, 1 m çubuklar 20 m arayla, kenar iletkeni yok: küre çatıya değer.', state: sc({ lpl: 'II', rodH: 1, rodD: 20, perimeter: false }) }
    ],
    tasks: tasks,
    controls: controls,
    compute: compute,
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, live) => (live.phase === 'strike' || live.phase === 'done' ? (live.struck && live.struck.exposed ? { level: 'bad', text: 'Korunmasız çatıya darbe' } : { level: 'ok', text: 'Darbe hava sonlandırmada' }) : null),
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-60, 60] },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
