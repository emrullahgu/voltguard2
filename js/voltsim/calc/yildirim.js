/* VoltSim · Yıldırımdan korunma (dış YKS) hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.yildirim (önce calc/topraklama.js yüklenir), Node'da require() ile; testleri
 * tools/tests/voltsim-yildirim.test.cjs.
 * Değerler IEC 62305-1/-3 (TS EN 62305-1/-3, 2010 baskısı) tablolarından:
 *   Tablo 2 (62305-3): yuvarlanan küre yarıçapı r 20/30/45/60 m, göz (ağ) boyutu 5/10/15/20 m (LPL I–IV);
 *   Tablo 4 (62305-3): iniş iletkenleri arası tipik mesafe 10/10/15/20 m;
 *   Tablo 10 (62305-3): ki 0,08 / 0,06 / 0,04 / 0,04; Tablo 11: km hava 1, beton/tuğla 0,5;
 *   Tablo 12 (62305-3, basitleştirilmiş): kc 1 (tek iniş), 0,66 (iki), 0,44 (üç ve üzeri);
 *   62305-1: en küçük tepe akımı 3/5/10/16 kA, en büyük 200/150/100/100 kA; r = 10·I^0,65 (elektrogeometrik model).
 * Koruma açısı yöntemi standarttaki Şekil 1 eğrisiyle verilir; burada eğri, aynı yükseklikteki çubuk için yuvarlanan kürenin
 * koruduğu kesit alanına eşit alanlı koni ile YAKLAŞIK olarak üretilir. Risk değerlendirmesi (IEC 62305-2) modellenmez;
 * yalnız yıllık tehlikeli olay sayısı ND bilgi olarak hesaplanır. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const E = node ? require('../engine.js') : root.VoltSimEngine;
  const TG = node ? require('./topraklama.js') : (E.ext && E.ext.topraklama);
  const api = factory(E, TG);
  if (node) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.yildirim = api; }
})(typeof self !== 'undefined' ? self : this, function (E, TG) {
  'use strict';
  const LPL = {
    I: { r: 20, mesh: 5, down: 10, ki: 0.08, Imin: 3, Imax: 200, pMin: 0.99, pMax: 0.99 },
    II: { r: 30, mesh: 10, down: 10, ki: 0.06, Imin: 5, Imax: 150, pMin: 0.97, pMax: 0.98 },
    III: { r: 45, mesh: 15, down: 15, ki: 0.04, Imin: 10, Imax: 100, pMin: 0.91, pMax: 0.97 },
    IV: { r: 60, mesh: 20, down: 20, ki: 0.04, Imin: 16, Imax: 100, pMin: 0.84, pMax: 0.97 }
  };
  const KM = { air: 1, solid: 0.5 };
  const CD = { 0.25: 'Daha yüksek nesnelerle çevrili', 0.5: 'Aynı ya da daha alçak nesnelerle çevrili', 1: 'Yalıtılmış (çevrede nesne yok)', 2: 'Tepede / yükseltide yalıtılmış' };

  /** Elektrogeometrik model: r = 10·I^0,65 (m, I kA). */
  function rFromI(I_kA) { return 10 * Math.pow(I_kA, 0.65); }
  /** İki hava sonlandırma elemanı arasında kürenin sarkma (penetrasyon) derinliği: p = r − √(r² − (d/2)²). */
  function penetration(r, d) { return d / 2 >= r ? r : r - Math.sqrt(r * r - d * d / 4); }
  /** Yüksekliği h olan iki çubuk arasında kürenin referans düzlemine değmediği en büyük aralık: d = 2·√(h·(2r − h)). */
  function maxSpacing(r, h) { return h >= r ? 2 * r : 2 * Math.sqrt(h * (2 * r - h)); }
  /** Tek çubuk için yuvarlanan kürenin referans düzlemindeki koruma yarıçapı: √(h·(2r − h)) (h ≤ r). */
  function sphereRadiusAtBase(r, h) { return h >= r ? r : Math.sqrt(h * (2 * r - h)); }
  /** Koruma açısı (°): eşit alan yaklaşımı. Kürenin koruduğu kesit alanı A = r·x0 − x0·(r − h)/2 − (r²/2)·asin(x0/r),
   *  x0 = √(h(2r − h)); aynı alanlı koni: tanα = 2A/h². h ≤ 2 m için standart gibi sabit kabul edilir; h > r için yöntem uygulanmaz (null). */
  function protectionAngle(h, r) {
    if (!(h > 0) || h > r) return null;
    h = Math.max(h, 2);
    const x0 = Math.sqrt(h * (2 * r - h));
    const A = r * x0 - x0 * (r - h) / 2 - r * r / 2 * Math.asin(Math.min(1, x0 / r));
    return Math.atan(2 * A / (h * h)) * 180 / Math.PI;
  }
  /** IEC 62305-3 Tablo 12 (basitleştirilmiş) kc. */
  function kc(n) { return n <= 1 ? 1 : n === 2 ? 0.66 : 0.44; }
  /** Ayırma mesafesi s = ki·(kc/km)·l (m). */
  function separation(o) { return o.ki * kc(o.n) / o.km * o.l; }
  /** Gerekli iniş iletkeni sayısı: çevre / tipik aralık, en az iki. */
  function downConductors(L, W, spacing) { return Math.max(2, Math.ceil(2 * (L + W) / spacing)); }
  /** Eşdeğer toplama alanı (IEC 62305-2 A.2, dikdörtgen yapı): AD = L·W + 2·(3H)·(L + W) + π·(3H)². */
  function collectionArea(L, W, H) { return L * W + 6 * H * (L + W) + Math.PI * 9 * H * H; }
  /** Yıllık doğrudan yıldırım olayı ND = NG·AD·CD·10⁻⁶. */
  function dangerousEvents(NG, AD, Cd) { return NG * AD * Cd * 1e-6; }

  /** Çatı hava sonlandırma elemanları: çubuklar (düşey doğru parçası), çatı kenarı iletkeni ve ağ (göz) iletkenleri. */
  function terminations(o) {
    const L = o.L, W = o.W, H = o.H, segs = [];
    const grid = (len, d) => { const n = Math.max(1, Math.ceil(len / d)); return Array.from({ length: n + 1 }, (_, i) => -len / 2 + i * len / n); };
    const rods = [];
    if (o.rods && o.rodH > 0 && o.rodD > 0) {
      const xs = grid(L, o.rodD), zs = grid(W, o.rodD);
      xs.forEach(x => zs.forEach(z => rods.push([x, z])));
      rods.forEach(p => segs.push({ a: [p[0], H, p[1]], b: [p[0], H + o.rodH, p[1]], kind: 'rod' }));
    }
    if (o.perimeter) {
      const y = H + (o.condH || 0);
      [[[-L / 2, -W / 2], [L / 2, -W / 2]], [[L / 2, -W / 2], [L / 2, W / 2]], [[L / 2, W / 2], [-L / 2, W / 2]], [[-L / 2, W / 2], [-L / 2, -W / 2]]]
        .forEach(e => segs.push({ a: [e[0][0], y, e[0][1]], b: [e[1][0], y, e[1][1]], kind: 'edge' }));
    }
    let meshN = 0;
    if (o.mesh && o.meshM > 0) {
      const y = H + (o.condH || 0);
      grid(W, o.meshM).forEach(z => { segs.push({ a: [-L / 2, y, z], b: [L / 2, y, z], kind: 'mesh' }); meshN++; });
      grid(L, o.meshM).forEach(x => { segs.push({ a: [x, y, -W / 2], b: [x, y, W / 2], kind: 'mesh' }); meshN++; });
    }
    return { segs: segs, rods: rods, meshN: meshN };
  }
  function distSeg(p, s) {
    const ax = s.a[0], ay = s.a[1], az = s.a[2], dx = s.b[0] - ax, dy = s.b[1] - ay, dz = s.b[2] - az;
    const L2 = dx * dx + dy * dy + dz * dz;
    let t = L2 > 0 ? ((p[0] - ax) * dx + (p[1] - ay) * dy + (p[2] - az) * dz) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = ax + t * dx - p[0], y = ay + t * dy - p[1], z = az + t * dz - p[2];
    return Math.sqrt(x * x + y * y + z * z);
  }
  /** Yuvarlanan küre ile düz çatı yüzeyinin maruziyet haritası. Her çatı noktası q için küre q'ya değerek (iç noktalarda
   *  yukarıdan; kenar noktalarında dışa doğru eğik yaklaşımlarla) yerleştirilir; kürenin içinde hiçbir hava sonlandırma elemanı
   *  kalmıyorsa q yıldırıma açıktır. nx × nz ızgara; dönüş: { exposed (Uint8Array), pct }. */
  function roofExposure(o, r, nx, nz) {
    const t = terminations(o), L = o.L, W = o.W, H = o.H;
    nx = nx || 48; nz = nz || Math.max(8, Math.round(48 * W / L));
    const out = new Uint8Array(nx * nz);
    let n = 0;
    const blocked = c => { for (let k = 0; k < t.segs.length; k++) if (distSeg(c, t.segs[k]) <= r + 1e-6) return true; return false; }; // elemana değmek = darbeyi eleman alır
    const tilts = [0, 0.5, 1.0, 1.45];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = -L / 2 + (i + 0.5) * L / nx, z = -W / 2 + (j + 0.5) * W / nz;
      const dirs = [];
      const edgeX = i === 0 ? -1 : i === nx - 1 ? 1 : 0, edgeZ = j === 0 ? -1 : j === nz - 1 ? 1 : 0;
      dirs.push([0, 0]);
      if (edgeX || edgeZ) { const m = Math.hypot(edgeX, edgeZ); tilts.slice(1).forEach(th => dirs.push([Math.sin(th) * edgeX / m, Math.sin(th) * edgeZ / m, Math.cos(th)])); }
      let exp = false;
      for (let d = 0; d < dirs.length && !exp; d++) {
        const dd = dirs[d], cy = dd.length === 3 ? dd[2] : 1;
        // kenar noktalarında küre kenar çizgisine değer (q kenara taşınır)
        const qx = dd.length === 3 && edgeX ? edgeX * L / 2 : x, qz = dd.length === 3 && edgeZ ? edgeZ * W / 2 : z;
        const c = [qx + r * dd[0], H + r * cy, qz + r * dd[1]];
        if (!blocked(c)) exp = true;
      }
      out[i * nz + j] = exp ? 1 : 0; if (exp) n++;
    }
    return { exposed: out, nx: nx, nz: nz, pct: n / (nx * nz) * 100, rods: t.rods.length, meshN: t.meshN };
  }
  /** Koruma açısı yöntemiyle çatı maruziyeti: çatı noktası, en az bir çubuğun konisi içindeyse korunur (referans düzlem = çatı). */
  function angleExposure(o, r, nx, nz) {
    const t = terminations(Object.assign({}, o, { perimeter: false, mesh: false })), L = o.L, W = o.W;
    nx = nx || 48; nz = nz || Math.max(8, Math.round(48 * W / L));
    const a = protectionAngle(o.rodH, r), R = a === null ? 0 : o.rodH * Math.tan(a * Math.PI / 180);
    const out = new Uint8Array(nx * nz); let n = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = -L / 2 + (i + 0.5) * L / nx, z = -W / 2 + (j + 0.5) * W / nz;
      const ok = t.rods.some(p => Math.hypot(p[0] - x, p[1] - z) <= R);
      out[i * nz + j] = ok ? 0 : 1; if (!ok) n++;
    }
    return { exposed: out, nx: nx, nz: nz, pct: n / (nx * nz) * 100, alpha: a, R: R, rods: t.rods.length };
  }
  /** Kürenin yapı ekseni boyunca (x) yuvarlanırken merkez yüksekliği: zemin, çatı kenarları ve hava sonlandırma elemanlarına değer. */
  function sphereProfile(o, r, n) {
    const t = terminations(o), L = o.L, W = o.W, H = o.H;
    const pts = [];
    // yapı köşe kenarları (çatı çevresi) örnekleri
    for (let k = 0; k <= 40; k++) { const x = -L / 2 + k * L / 40; pts.push([x, H, -W / 2], [x, H, W / 2]); }
    for (let k = 0; k <= 20; k++) { const z = -W / 2 + k * W / 20; pts.push([-L / 2, H, z], [L / 2, H, z]); }
    t.segs.forEach(s => { pts.push(s.a, s.b); for (let k = 1; k < 8; k++) pts.push([s.a[0] + (s.b[0] - s.a[0]) * k / 8, s.a[1] + (s.b[1] - s.a[1]) * k / 8, s.a[2] + (s.b[2] - s.a[2]) * k / 8]); });
    const out = [];
    n = n || 120;
    for (let k = 0; k <= n; k++) {
      const x = -L / 2 - r + k * (L + 2 * r) / n;
      let cy = r;
      for (let q = 0; q < pts.length; q++) { const p = pts[q], d2 = (p[0] - x) * (p[0] - x) + p[2] * p[2]; if (d2 < r * r) cy = Math.max(cy, p[1] + Math.sqrt(r * r - d2)); }
      out.push([x, cy]);
    }
    return out;
  }

  function compute(input) {
    const v = new E.Validator();
    const lpl = v.oneOf(input.lpl, 'Koruma seviyesi (LPL)', ['I', 'II', 'III', 'IV']);
    const P = LPL[lpl];
    const o = {
      L: v.num(input.L, 'Bina boyu', { min: 5, max: 200, unit: 'm' }), W: v.num(input.W, 'Bina eni', { min: 5, max: 120, unit: 'm' }), H: v.num(input.H, 'Bina yüksekliği', { min: 3, max: 120, unit: 'm' }),
      rods: !!input.rods, rodH: v.num(input.rodH, 'Çubuk yüksekliği', { min: 0.3, max: 15, unit: 'm' }), rodD: v.num(input.rodD, 'Çubuk aralığı', { min: 2, max: 60, unit: 'm' }),
      perimeter: !!input.perimeter, mesh: !!input.mesh, meshM: v.num(input.meshM, 'Göz boyutu', { min: 2, max: 40, unit: 'm' }), condH: 0
    };
    const nDown = Math.round(v.num(input.nDown, 'İniş iletkeni sayısı', { min: 1, max: 200 }));
    const lSep = v.num(input.lSep, 'Ayırma mesafesi hesap boyu l', { min: 0.5, max: 200, unit: 'm' });
    const dEq = v.num(input.dEq, 'Çatı ekipmanına mesafe', { min: 0, max: 20, unit: 'm' });
    const km = input.medium === 'solid' ? KM.solid : KM.air;
    const NG = v.num(input.NG, 'Yer yıldırım yoğunluğu NG', { min: 0.1, max: 30, unit: '1/(km²·yıl)' });
    const Cd = v.num(input.Cd, 'Konum faktörü CD', { min: 0.25, max: 2 });
    const rho = v.num(input.rho, 'Toprak özdirenci', { min: 10, max: 10000, unit: 'Ω·m' });
    if (o.rods && (Math.ceil(o.L / o.rodD) + 1) * (Math.ceil(o.W / o.rodD) + 1) > 2500) v.errors.push('Çubuk ızgarası 2500 çubuğu aşıyor; aralığı büyütün (gerçek tasarımda ağ yöntemi tercih edilir).');
    if (v.errors.length) return { ok: false, errors: v.errors, warnings: [], checks: [], values: {} };
    const r = P.r;
    const method = input.method === 'angle' ? 'angle' : input.method === 'mesh' ? 'mesh' : 'sphere';
    const exp = method === 'angle' ? angleExposure(o, r) : roofExposure(o, r);
    const t = terminations(o);
    const alpha = protectionAngle(o.rodH, r);
    const nReq = downConductors(o.L, o.W, P.down);
    const s = separation({ ki: P.ki, n: nDown, km: km, l: lSep });
    const AD = collectionArea(o.L, o.W, o.H), ND = dangerousEvents(NG, AD, Cd);
    const pen = penetration(r, o.rodD * Math.SQRT2); // ızgara köşegeni (en kötü aralık)
    const ringD = TG.ringD(o.L + 2, o.W + 2), Rring = TG.ring(rho, ringD, 0.01, 0.5);
    const meshLen = o.mesh ? (Math.ceil(o.W / o.meshM) + 1) * o.L + (Math.ceil(o.L / o.meshM) + 1) * o.W : 0;
    const checks = [];
    const f = (x, d) => E.round(x, d === undefined ? 1 : d).toString().replace('.', ',');
    const ck = (id, label, status, detail, ref) => checks.push({ id: id, label: label, status: status, detail: detail, ref: ref || null });
    if (method === 'mesh') {
      ck('mesh', 'Ağ (göz) yöntemi: göz boyutu', !o.mesh ? 'fail' : o.meshM <= P.mesh ? 'ok' : 'fail', o.mesh ? 'Seçilen ' + f(o.meshM) + ' × ' + f(o.meshM) + ' m · LPL ' + lpl + ' için en çok ' + P.mesh + ' × ' + P.mesh + ' m. Çatı kenarına iletken konmalı, çatı eğimi ≤ 1/10 düz çatı kabulü.' : 'Ağ iletkenleri devre dışı.', 'IEC 62305-3 Tablo 2');
      if (o.mesh && !o.perimeter) ck('edge', 'Çatı kenarı iletkeni', 'fail', 'Ağ yönteminde çatı kenarları (saçak, parapet) hava sonlandırma iletkeniyle donatılmalıdır.', 'IEC 62305-3 5.2.2');
    } else if (method === 'angle') {
      ck('angle', 'Koruma açısı yöntemi', alpha === null ? 'fail' : exp.pct < 0.5 ? 'ok' : 'fail', alpha === null ? 'Çubuk yüksekliği ' + f(o.rodH) + ' m > r = ' + r + ' m: koruma açısı yöntemi uygulanmaz.' : 'α(' + f(o.rodH) + ' m) ≈ ' + f(alpha, 0) + '° → çatıda koruma yarıçapı ' + f(exp.R, 2) + ' m; açıkta kalan çatı %' + f(exp.pct, 1) + '. Açı Şekil 1 eğrisine yaklaşımdır; proje için standart eğrisi kullanılmalıdır.', 'IEC 62305-3 Şekil 1 (yaklaşık)');
    } else {
      ck('sphere', 'Yuvarlanan küre (r = ' + r + ' m): çatı', exp.pct < 0.5 ? 'ok' : 'fail', 'Açıkta kalan çatı %' + f(exp.pct, 1) + ' · ' + exp.rods + ' çubuk (h ' + f(o.rodH) + ' m, aralık ' + f(o.rodD) + ' m) · köşegende sarkma p ≈ ' + f(pen, 2) + ' m' + (o.perimeter ? ' · kenar iletkeni var' : ''), 'IEC 62305-3 Tablo 2, Ek A');
    }
    if (o.rods && method !== 'mesh') ck('pen', 'Çubuk yüksekliği ≥ sarkma', o.rodH > pen ? 'ok' : 'warn', 'Izgara köşegeni ' + f(o.rodD * Math.SQRT2) + ' m için p = r − √(r² − (d/2)²) = ' + f(pen, 2) + ' m; çubuk ' + f(o.rodH) + ' m. Aynı çubuk yüksekliğiyle izin verilen en büyük aralık ≈ ' + f(maxSpacing(r, o.rodH), 1) + ' m.', 'IEC 62305-3 Ek A');
    ck('down', 'İniş iletkenleri', nDown >= nReq ? 'ok' : 'fail', nDown + ' adet · çevre ' + f(2 * (o.L + o.W), 0) + ' m / tipik aralık ' + P.down + ' m → en az ' + nReq + ' (en az iki, köşelere yakın, eşit aralıklı).', 'IEC 62305-3 Tablo 4');
    ck('sep', 'Ayırma mesafesi (çatı ekipmanı)', dEq >= s ? 'ok' : 'fail', 's = ki·(kc/km)·l = ' + f(P.ki, 2) + '·(' + f(kc(nDown), 2) + '/' + f(km) + ')·' + f(lSep) + ' = ' + f(s, 2) + ' m · ekipman mesafesi ' + f(dEq, 2) + ' m' + (dEq < s ? ' → yetersiz: ekipman yaklaştırılmamalı ya da eşpotansiyel bağlanmalı (yıldırım akımı taşıyabilen)' : ''), 'IEC 62305-3 6.3, Tablo 10–12');
    if (o.H > r) ck('side', 'Yan darbeler (cephe)', o.H > 60 ? 'warn' : 'info', 'Bina yüksekliği ' + f(o.H, 0) + ' m > r = ' + r + ' m: küre cephenin r üzerindeki kısmına değer. 60 m’den yüksek yapılarda üst %20’lik cephe bölümü için yan koruma istenir.', 'IEC 62305-3 5.2.3');
    ck('earth', 'Topraklama (B tipi halka, yaklaşık)', Rring <= 10 ? 'ok' : 'info', 'ρ = ' + f(rho, 0) + ' Ω·m, bina çevresinde 1 m mesafede halka (D ≈ ' + f(ringD, 1) + ' m) → R ≈ ' + f(Rring, 1) + ' Ω. Standart, düşük frekansta mümkünse 10 Ω altını önerir; halka elektrot boyutu ayrıca Şekil 3’e göre kontrol edilir.', 'IEC 62305-3 5.4');
    ck('risk', 'Risk değerlendirmesi', 'info', 'Yıllık doğrudan darbe sayısı ND ≈ ' + f(ND, 3) + ' (AD ≈ ' + f(AD, 0) + ' m², NG ' + f(NG, 1) + ', CD ' + f(Cd, 2) + '). Gerekli LPL, IEC 62305-2 risk analizi (R1–R4, kayıp tipleri, SPD’ler) ile belirlenir; bu simülasyonda modellenmez.', 'IEC 62305-2');
    return {
      ok: true, errors: [], warnings: [], checks: checks,
      values: { lpl: lpl, P: P, r: r, method: method, exp: exp, rods: t.rods, segs: t.segs, alpha: alpha, alphaR: alpha === null ? 0 : o.rodH * Math.tan(alpha * Math.PI / 180), nReq: nReq, nDown: nDown, s: s, kc: kc(nDown), km: km, AD: AD, ND: ND, pen: pen, maxD: maxSpacing(r, o.rodH), Rring: Rring, ringD: ringD, meshLen: meshLen, rI: rFromI(P.Imin) },
      assumptions: [
        'Düz çatılı dikdörtgen yapı; çatı eğimi ve çatı üstü yapılar (baca, klima) dışında hava sonlandırma elemanları çubuk, kenar iletkeni ve ağ iletkenleridir.',
        'Yuvarlanan küre maruziyeti: her çatı noktasına küre yukarıdan (kenarlarda dışa eğik yaklaşımlarla da) değdirilir; kürenin içinde hava sonlandırma elemanı kalmıyorsa nokta açıktır. Ağ yöntemi standarttaki göz boyutu kuralıyla değerlendirilir.',
        'Koruma açısı, Şekil 1 eğrisine eşit alan yaklaşımıyla üretilir (h ≤ 2 m sabit, h > r uygulanmaz). Eğrinin kendisi standarttan okunmalıdır.',
        'Ayırma mesafesinde kc için Tablo 12’nin basitleştirilmiş değerleri kullanılır; ayrıntılı kc (Ek C) ve farklı ortamlar için standart esas alınmalıdır.',
        'Topraklama direnci yalnız bina çevresindeki halka elektrot için yaklaşık formülle (topraklama simülasyonundaki halka bağıntısı) verilir.',
        'İç yıldırım koruması (eşpotansiyel kuşaklama, SPD seçimi, IEC 62305-4) ve risk analizi (IEC 62305-2) modellenmez.',
        'Değerler IEC 62305 serisinin 2010 baskısına göredir; güncel baskı (Ed.3) ve TS EN karşılıkları proje öncesinde doğrulanmalıdır.'
      ],
      formulas: ['r = 10·I^0,65 (I kA)', 'p = r − √(r² − (d/2)²)', 'd_maks = 2·√(h·(2r − h))', 'tanα = 2A/h² (eşit alan yaklaşımı)', 's = ki·(kc/km)·l', 'n_iniş ≥ max(2, çevre / aralık)', 'AD = L·W + 2·3H·(L + W) + π·(3H)²', 'ND = NG·AD·CD·10⁻⁶']
    };
  }

  return { compute: compute, LPL: LPL, KM: KM, CD: CD, rFromI: rFromI, penetration: penetration, maxSpacing: maxSpacing, sphereRadiusAtBase: sphereRadiusAtBase, protectionAngle: protectionAngle, kc: kc, separation: separation,
    downConductors: downConductors, collectionArea: collectionArea, dangerousEvents: dangerousEvents, terminations: terminations, roofExposure: roofExposure, angleExposure: angleExposure, sphereProfile: sphereProfile };
});
