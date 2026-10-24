/* VoltSim · Kısa devre ve selektivite hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.selektivite, Node'da require() ile kullanılır; testleri tools/tests/voltsim-selektivite.test.cjs.
 * Kısa devre akımları motorun IEC 60909 yaklaşımıyla (E.sourceImpedance, E.cableImpedance, E.shortCircuit3, E.shortCircuit1Min)
 * hesaplanır; burada tekrar yazılmaz. Koruma cihazlarının zaman–akım bantları standart sınırlarından türetilmiş TEMSİLİ bantlardır:
 *   MCB  — IEC 60898-1: 1,13·In (1 sa açmaz), 1,45·In (1 sa içinde açar), 2,55·In (1–60 s; In > 32 A: 1–120 s),
 *          ani açma B 3–5·In, C 5–10·In, D 10–20·In (alt sınırda 0,1 s içinde açmaz, üst sınırda 0,1 s içinde açar).
 *   gG   — IEC 60269-2 kapı değerleri (motor E.FUSE_GATES), Inf = 1,25·In, If = 1,6·In (konvansiyonel süre).
 *   MCCB/ACB — elektronik LSI ayarları: L (Ir, tr @ 6·Ir, I²t = sabit), S (Isd, tsd sabit gecikme), I (Ii).
 *          IEC 60947-2: 1,05·Ir açmaz / 1,30·Ir açar (konvansiyonel), ani açma ±%20. Süre toleransları temsilîdir.
 * Gerçek cihaz eğrisi ve enerji (I²t) seçiciliği üretici verisiyle doğrulanmalıdır. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.selektivite = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const MCB_BANDS = { B: [3, 5], C: [5, 10], D: [10, 20] };
  const KINDS = { ACB: 'Hava devre kesici (ACB) · LSI', MCCB: 'Kompakt şalter (MCCB) · elektronik LSI', MCB: 'Minyatür devre kesici (MCB)', FUSE: 'NH bıçaklı sigorta · gG' };
  const T_INST_MIN = 0.005;   // ani bölgede en kısa açma (temsilî, mekanik + ark)
  const T_TOP = 1e4, T_BOT = 1e-3; // grafikte üst/alt sınır (s)

  /** t = A/(r² − a) eğrisinin iki noktadan uydurulması (aşırı yük bölgesi, I²t benzeri ters zaman). */
  function fitInverse(r1, t1, r2, t2) {
    const a = (t1 * r1 * r1 - t2 * r2 * r2) / (t1 - t2);
    return { a: a, A: t1 * (r1 * r1 - a) };
  }
  const MCB_FIT = {
    min: fitInverse(1.13, 3600, 2.55, 1),
    max60: fitInverse(1.45, 3600, 2.55, 60),
    max120: fitInverse(1.45, 3600, 2.55, 120)
  };
  const inv = (f, r) => (r * r > f.a ? f.A / (r * r - f.a) : null);

  /** Log-log doğrusal ara değer: pts [[I, t], …] (I artan). Aralık dışında null. */
  function logInterp(pts, I) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (I >= a[0] && I <= b[0]) {
        const k = (Math.log(I) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
        return Math.exp(Math.log(a[1]) + k * (Math.log(b[1]) - Math.log(a[1])));
      }
    }
    return null;
  }

  /** Cihaz ayarlarından türetilen eşikler (A). */
  function settings(d) {
    if (d.kind === 'MCB') { const m = MCB_BANDS[d.curve] || MCB_BANDS.C; return { In: d.In, Ilo: m[0] * d.In, Ihi: m[1] * d.In }; }
    if (d.kind === 'FUSE') {
      const g = E.FUSE_GATES[d.In];
      return { In: d.In, gates: g, Inf: 1.25 * d.In, If: E.fuseI2(d.In), Tconv: E.fuseConvTime(d.In) };
    }
    const Ir = (d.ir || 1) * d.In;
    return { In: d.In, Ir: Ir, tr: d.tr || 10, Isd: d.isd > 0 ? d.isd * Ir : 0, tsd: d.tsd || 0.1, Ii: d.ii > 0 ? d.ii * d.In : 0 };
  }

  /** Zaman–akım bandı: I akımında { tmin, tmax } (s). tmin: bu süreden önce açmaz (null → hiç açmaz);
   *  tmax: en geç bu sürede açar (null → açma garanti edilmez). */
  function band(d, I) {
    const s = settings(d);
    if (d.kind === 'MCB') {
      const r = I / d.In, fmax = d.In > 32 ? MCB_FIT.max120 : MCB_FIT.max60;
      const lo = s.Ilo / d.In, hi = s.Ihi / d.In;
      let tmin = null, tmax = null;
      if (r > 1.13) tmin = r > lo ? T_INST_MIN : Math.max(0.1, inv(MCB_FIT.min, r));
      if (r >= 1.45) tmax = r >= hi ? 0.1 : inv(fmax, r);
      return { tmin: tmin, tmax: tmax };
    }
    if (d.kind === 'FUSE') {
      const g = s.gates; if (!g) return { tmin: null, tmax: null };
      const minPts = [[s.Inf, s.Tconv], [g[0], 10], [g[2], 0.1]], maxPts = [[s.If, s.Tconv], [g[1], 5], [g[3], 0.1]];
      const tmin = I <= s.Inf ? null : I > g[2] ? 0.1 * Math.pow(g[2] / I, 2) : logInterp(minPts, I);
      const tmax = I < s.If ? null : I > g[3] ? 0.1 * Math.pow(g[3] / I, 2) : logInterp(maxPts, I);
      return { tmin: tmin, tmax: tmax };
    }
    // MCCB / ACB elektronik LSI
    const tL = s.tr * 36 / Math.pow(I / s.Ir, 2);
    let tmin = null, tmax = null;
    const lo = (a, b) => (a === null ? b : b === null ? a : Math.min(a, b));
    // L eğrisi S eşiğinde kesilir (S bölgesinde süreyi kısa gecikme belirler; üretici eğrileri de böyle çizilir)
    if (I > 1.05 * s.Ir && !(s.Isd && I >= 0.9 * s.Isd)) tmin = 0.8 * tL;
    if (I >= 1.3 * s.Ir && !(s.Isd && I >= 1.1 * s.Isd)) tmax = 1.2 * tL;
    if (s.Isd) {
      if (I >= 0.9 * s.Isd) tmin = lo(tmin, Math.max(0.01, s.tsd - 0.03));
      if (I >= 1.1 * s.Isd) tmax = lo(tmax, s.tsd + 0.05);
    }
    if (s.Ii) {
      if (I >= 0.8 * s.Ii) tmin = lo(tmin, 0.01);
      if (I >= 1.2 * s.Ii) tmax = lo(tmax, 0.05);
    }
    return { tmin: tmin, tmax: tmax };
  }

  /** Log aralıklı akım ızgarası (grafik ve tarama için). */
  function grid(lo, hi, n) {
    const out = [], a = Math.log10(lo), b = Math.log10(hi);
    for (let i = 0; i <= n; i++) out.push(Math.pow(10, a + (b - a) * i / n));
    return out;
  }
  /** Cihazın grafikte görünür en küçük akımı (açma eşiğinin biraz altı). */
  function pickup(d) {
    const s = settings(d);
    return d.kind === 'MCB' ? 1.13 * d.In : d.kind === 'FUSE' ? s.Inf : 1.05 * s.Ir;
  }

  /** Eğri verisi: ortak akım ızgarasında min ve max zamanlar (null = açma yok; grafikte çizilmez). */
  function curve(d, Is) {
    const cl = t => (t === null ? null : Math.max(T_BOT, Math.min(T_TOP, t)));
    return Is.map(I => { const b = band(d, I); return [I, cl(b.tmin), cl(b.tmax)]; });
  }

  /** Üst (upstream) ve alt (downstream) cihaz arasında zaman–akım seçiciliği, Ik_max'a kadar (alt cihazın bağlı olduğu baradaki
   *  en büyük arıza akımı). Bantlar kesişmiyorsa (üst cihazın en erken açma süresi alt cihazın en geç açma süresinden büyük ya da
   *  üst cihaz hiç açmıyor) seçici kabul edilir. Dönüş: { status: 'total'|'partial'|'none', Is, region, ... } */
  function selectivity(up, down, IkMax) {
    const lo = Math.min(pickup(down), pickup(up)) * 0.98;
    const hi = Math.max(IkMax, lo * 1.01);
    const Is = grid(lo, hi, 600);
    let fail = null;
    for (let i = 0; i < Is.length; i++) {
      const I = Is[i], u = band(up, I), dn = band(down, I);
      if (u.tmin === null) continue;
      if (dn.tmax !== null && dn.tmax < u.tmin) continue;
      fail = { I: I, up: u, down: dn }; break;
    }
    const res = { IkMax: IkMax, ratio: up.In / down.In };
    if (!fail) return Object.assign(res, { status: 'total', Is: IkMax, region: null });
    // bölge: aşırı yük (alt cihaz garanti açmıyor ya da ters zaman bölgesi), zaman gecikmeli, ani/enerji bölgesi (< 0,1 s)
    const dmax = fail.down.tmax, umin = fail.up.tmin;
    let region = 'short';
    if (dmax === null || fail.I < 2.6 * down.In && down.kind !== 'FUSE' || dmax > 5) region = 'overload';
    else if (umin <= 0.1 || dmax <= 0.1) region = 'inst';
    const st = fail.I <= pickup(down) * 1.5 ? 'none' : 'partial';
    return Object.assign(res, { status: st, Is: fail.I, region: region, tUpMin: umin, tDownMax: dmax });
  }

  /** Ağaç: devices[i].parent (−1 = kök). Her cihaz bağlı olduğu baradan (ebeveynin çıkışı) kendi kablosuyla kendi barasını besler.
   *  Kökün kablosu trafo ile ana pano arasındaki bağlantıdır. */
  function pathOf(devices, i) { const p = []; let k = i, guard = 0; while (k >= 0 && k < devices.length && guard++ < 64) { p.push(k); k = devices[k].parent; } return p; }
  function levelOf(devices, i) { return pathOf(devices, i).length - 1; }

  /** Ağdaki her baranın kısa devre akımları (IEC 60909 yaklaşımı, motor fonksiyonlarıyla). */
  function network(o) {
    const src = E.sourceImpedance({ U_LL: o.U_LL, SkQ_MVA: o.SkQ_MVA, Sr_kVA: o.Sr_kVA, uk_pct: o.uk, Pk_W: o.Pk_W });
    const sc0 = E.shortCircuit3(o.U_LL, src.R, src.X);
    const devs = o.devices;
    const zc = devs.map(d => E.cableImpedance(Math.max(0, d.L || 0), Math.max(0.5, d.S || 1), Math.max(1, d.n || 1), d.mat));
    const ser = devs.map((d, i) => pathOf(devs, i).reduce((a, k) => ({ R: a.R + zc[k].R, X: a.X + zc[k].X }), { R: 0, X: 0 }));
    const nodes = devs.map((d, i) => {
      const s = ser[i];
      const sc = E.shortCircuit3(o.U_LL, src.R + s.R, src.X + s.X);
      const p = d.parent;
      const atLine = p >= 0 ? null : sc0; // cihazın bağlı olduğu bara (ebeveyn çıkışı); kökte trafo AG uçları
      const Ik1 = E.shortCircuit1Min(o.U_LL, src, s);
      const IkMin3 = E.shortCircuit3(o.U_LL, src.R + s.R * 1.24, src.X + s.X, 0.95).Ik; // cmin, iletken sıcaklığı yaklaşık
      return { i: i, R: src.R + s.R, X: src.X + s.X, Ik3: sc.Ik, ip: sc.ip, kappa: sc.kappa, Ik1: Ik1, Ik3min: IkMin3, line: atLine };
    });
    nodes.forEach((n, i) => { const p = devs[i].parent; n.IkLine = p >= 0 ? nodes[p].Ik3 : sc0.Ik; n.ipLine = p >= 0 ? nodes[p].ip : sc0.ip; });
    return { src: src, Ik3T: sc0.Ik, ipT: sc0.ip, nodes: nodes };
  }

  /** Belirli bir barada arıza: yol üzerindeki cihazların bantları, ilk açan (garanti açma süresi en küçük) ve seçicilik kaybı riski. */
  function faultResponse(devices, at, I) {
    const path = pathOf(devices, at);
    const rows = path.map(k => ({ i: k, band: band(devices[k], I) }));
    const guaranteed = rows.filter(r => r.band.tmax !== null).sort((a, b) => a.band.tmax - b.band.tmax);
    const first = guaranteed.length ? guaranteed[0] : null;
    const tc = first ? first.band.tmax : null;
    // ilk açan cihazın yukarısında, en erken açma süresi temizleme süresinden kısa olanlar da açabilir
    const alsoTrip = first ? rows.filter(r => r.i !== first.i && path.indexOf(r.i) > path.indexOf(first.i) && r.band.tmin !== null && r.band.tmin <= tc).map(r => r.i) : [];
    // ilk açanın aşağısında olup aynı sürede açabilecek cihazlar (ör. akım sınırlayıcı MCB): yarış durumu
    const downMay = first ? rows.filter(r => path.indexOf(r.i) < path.indexOf(first.i) && r.band.tmin !== null && r.band.tmin <= tc).map(r => r.i) : [];
    const ideal = path[0];
    return { path: path, rows: rows, first: first ? first.i : null, tClear: tc, alsoTrip: alsoTrip, downMay: downMay, ideal: ideal, selective: first !== null && first.i === ideal && alsoTrip.length === 0 };
  }

  /** TS HD 60364-4-41 411.3.2: ≤ 32 A son devre 0,4 s (TN, 230 V), diğerleri 5 s. */
  function tRequired(d, isFinal) { return isFinal && d.In <= 32 ? 0.4 : 5; }

  /** Tam hesap: girdi doğrulama, ağ kısa devre akımları, cihaz kontrolleri, ebeveyn–çocuk seçicilik çiftleri ve seçili arıza. */
  function compute(input) {
    const v = new E.Validator();
    const U = v.num(input.U_LL, 'Gerilim', { min: 200, max: 1000, unit: 'V' });
    const o = {
      U_LL: U,
      Sr_kVA: v.num(input.Sr_kVA, 'Trafo gücü', { min: 25, max: 5000, unit: 'kVA' }),
      uk: v.num(input.uk, 'Trafo uk', { min: 2, max: 12, unit: '%' }),
      Pk_W: v.num(input.Pk_W, 'Trafo yük kaybı', { min: 0, max: 60000, unit: 'W' }),
      SkQ_MVA: v.num(input.SkQ_MVA, 'OG şebeke kısa devre gücü', { min: 0, max: 5000, unit: 'MVA' })
    };
    const raw = Array.isArray(input.devices) ? input.devices : [];
    if (!raw.length) v.errors.push('En az bir koruma cihazı gerekli.');
    const devices = raw.map((d, i) => {
      const nm = (d.name || ('Cihaz ' + (i + 1)));
      const kind = v.oneOf(d.kind, nm + ' tipi', ['ACB', 'MCCB', 'MCB', 'FUSE']);
      const out = Object.assign({}, d, { kind: kind, name: nm });
      out.parent = Number.isInteger(d.parent) && d.parent >= -1 && d.parent < i ? d.parent : (i === 0 ? -1 : 0);
      if (i === 0) out.parent = -1;
      out.In = v.num(d.In, nm + ' anma akımı', { min: 0.5, max: 6300, unit: 'A' });
      if (kind === 'FUSE' && !E.FUSE_GATES[out.In]) v.errors.push(nm + ': gG kapı değeri tabloda olan bir anma akımı seçin (16–630 A).');
      if (kind === 'MCB') { out.curve = v.oneOf(d.curve, nm + ' eğrisi', ['B', 'C', 'D']); if (out.In > 125) v.errors.push(nm + ': MCB anma akımı en çok 125 A.'); }
      if (kind === 'ACB' || kind === 'MCCB') {
        out.ir = v.num(d.ir, nm + ' Ir', { min: 0.4, max: 1, unit: '×In' });
        out.tr = v.num(d.tr, nm + ' tr', { min: 0.5, max: 30, unit: 's' });
        out.isd = v.num(d.isd, nm + ' Isd', { min: 0, max: 12, unit: '×Ir' });
        out.tsd = v.num(d.tsd, nm + ' tsd', { min: 0.02, max: 0.5, unit: 's' });
        out.ii = v.num(d.ii, nm + ' Ii', { min: 0, max: 15, unit: '×In' });
        if (out.isd > 0 && out.isd < 1.5) v.errors.push(nm + ': Isd en az 1,5·Ir olmalı (ya da 0 = kapalı).');
        if (out.ii > 0 && out.ii < 1.5) v.errors.push(nm + ': Ii en az 1,5·In olmalı (ya da 0 = kapalı).');
        if (out.isd === 0 && out.ii === 0) v.errors.push(nm + ': S ve I korumasının ikisi birden kapatılamaz.');
      }
      out.Icu = v.num(d.Icu, nm + ' kesme kapasitesi', { min: 1, max: 200, unit: 'kA' });
      out.L = v.num(d.L, nm + ' kablo boyu', { min: 0, max: 2000, unit: 'm' });
      out.S = v.num(d.S, nm + ' kablo kesiti', { min: 1, max: 630, unit: 'mm²' });
      out.n = v.num(d.n || 1, nm + ' paralel kablo', { min: 1, max: 12 });
      out.mat = d.mat === 'Al' ? 'Al' : 'Cu';
      return out;
    });
    if (v.errors.length) return { ok: false, errors: v.errors, warnings: [], checks: [], values: {} };
    o.devices = devices;
    const net = network(o);
    const kids = devices.map((_, i) => devices.map((d, k) => (d.parent === i ? k : -1)).filter(k => k >= 0));
    const checks = [];
    const ck = (id, label, status, detail, ref) => checks.push({ id: id, label: label, status: status, detail: detail, ref: ref || null });
    const f = (x, d) => E.round(x, d === undefined ? 1 : d).toString().replace('.', ',');
    const pairs = [];
    devices.forEach((d, i) => {
      const n = net.nodes[i], isFinal = kids[i].length === 0 && d.parent >= 0;
      const tReq = tRequired(d, isFinal);
      // kesme kapasitesi
      ck('icu' + i, d.name + ': kesme kapasitesi', d.Icu * 1e3 >= n.IkLine ? 'ok' : 'fail', 'Icu ' + f(d.Icu) + ' kA · bağlı olduğu barada Ik3 ≈ ' + f(n.IkLine / 1e3, 2) + ' kA', d.kind === 'MCB' ? 'IEC 60898-1 (Icn)' : d.kind === 'FUSE' ? 'IEC 60269-1' : 'IEC 60947-2 (Icu)');
      // hat sonu en küçük arıza akımında açma
      const b = band(d, n.Ik1);
      const okT = b.tmax !== null && b.tmax <= tReq;
      ck('sens' + i, d.name + ': hat sonu arızada açma (Ik1,min)', okT ? 'ok' : 'fail', 'Ik1,min ≈ ' + f(n.Ik1, 0) + ' A → en geç açma ' + (b.tmax === null ? 'garanti değil' : f(b.tmax, b.tmax < 1 ? 3 : 1) + ' s') + ' · gerekli ≤ ' + f(tReq) + ' s' + (isFinal ? ' (son devre)' : ' (dağıtım devresi)'), 'TS HD 60364-4-41');
      if (d.parent >= 0) {
        const up = devices[d.parent];
        const s = selectivity(up, d, n.IkLine);
        pairs.push(Object.assign({ up: d.parent, down: i }, s));
        const txt = s.status === 'total' ? 'Zaman–akım bantları ' + f(s.IkMax / 1e3, 2) + ' kA’ya (alt cihaz barasındaki Ik3) kadar kesişmiyor.'
          : 'Zaman–akım seçicilik sınırı Is ≈ ' + f(s.Is / 1e3, s.Is < 1e3 ? 3 : 2) + ' kA (' + (s.region === 'overload' ? 'aşırı yük bölgesi: Ir/In ayarları uyumsuz' : s.region === 'inst' ? 'ani bölge: enerji (I²t) seçiciliği için üretici tablosu gerekir' : 'zaman gecikmeli bölge: tsd/Isd ayarlarını kademelendirin') + '); barada Ik3 ≈ ' + f(s.IkMax / 1e3, 2) + ' kA.';
        ck('sel' + i, up.name + ' → ' + d.name + ': seçicilik', s.status === 'total' ? 'ok' : s.region === 'inst' ? 'warn' : 'fail', txt, 'IEC 60947-2 Ek A (seçicilik tanımı)');
        if (up.kind === 'FUSE' && d.kind === 'FUSE') ck('ratio' + i, up.name + ' / ' + d.name + ': gG anma oranı', s.ratio >= 1.6 ? 'info' : 'warn', 'Oran ' + f(s.ratio, 2) + ':1. gG sigortalarda üreticiler 1,6:1 ve üzeri oranda seçicilik beyan eder; kesin sonuç ön ark / toplam I²t değerleriyle doğrulanır.', 'IEC 60269-1/-2');
      }
    });
    // seçili arıza
    const at = Math.max(0, Math.min(devices.length - 1, Number(input.fault) || 0));
    const fn = net.nodes[at];
    const Ifault = input.faultType === '1F' ? fn.Ik1 : fn.Ik3;
    const resp = faultResponse(devices, at, Ifault);
    const nameOf = k => devices[k].name;
    ck('fault', 'Seçili arıza: ' + nameOf(at) + ' çıkışı (' + (input.faultType === '1F' ? 'faz–toprak, en küçük' : 'üç faz, en büyük') + ')',
      resp.first === null ? 'fail' : resp.selective ? 'ok' : 'warn',
      'I ≈ ' + f(Ifault / 1e3, 2) + ' kA · ' + (resp.first === null ? 'yoldaki hiçbir cihaz bu akımda açmayı garanti etmiyor.' : 'ilk açan ' + nameOf(resp.first) + ' (≤ ' + f(resp.tClear, resp.tClear < 1 ? 3 : 1) + ' s)' + (resp.first !== resp.ideal ? ' — arızaya en yakın cihaz değil (en kötü durum)' + (resp.downMay.length ? '; ' + resp.downMay.map(nameOf).join(', ') + ' aynı sürede açabilir (yarış: üretici seçicilik tablosu gerekir)' : '') : '') + (resp.alsoTrip.length ? '; ' + resp.alsoTrip.map(nameOf).join(', ') + ' da açabilir (seçicilik kaybı)' : '')));
    const selOk = pairs.filter(p => p.status === 'total').length;
    return {
      ok: true, errors: [], warnings: [], checks: checks,
      values: { U_LL: U, Ik3T: net.Ik3T, ipT: net.ipT, src: net.src, nodes: net.nodes, pairs: pairs, selOk: selOk, nPairs: pairs.length, fault: at, Ifault: Ifault, resp: resp, devices: devices, kids: kids },
      assumptions: [
        'Kısa devre: IEC 60909 yaklaşımı (motor fonksiyonları), c = 1,05 (en büyük) / 0,95 (en küçük); motor katkısı, ark direnci ve paralel besleme ihmal; trafo AG uçlarında başlayan radyal ağ.',
        'Ik1,min: faz–PE çevrimi, Dyn trafoda Z0 ≈ ZT, PE kesiti faz kesitine eşit, iletken arıza sonu direnç artışı ≈ 1,24.',
        'MCB bantları IEC 60898-1 sınır değerlerinden (1,13/1,45/2,55·In ve ani açma bandı) türetilmiş temsilî eğrilerdir; ani bölgede en geç açma standarttaki 0,1 s alınır (akım sınırlayıcı MCB pratikte çok daha hızlıdır).',
        'gG bantları IEC 60269-2 kapı değerleri arasında log-log ara değerlemedir; 0,1 s altı I²t = sabit kabulüyle uzatılır (yalnız gösterim).',
        'LSI bantları: L için ±%20 süre toleransı ve 1,05/1,30·Ir eşikleri; S için Isd ±%10, tsd −0,03/+0,05 s; I için Ii ±%20 (IEC 60947-2), ani açma süresi 10–50 ms. Bunlar temsilîdir; üretici eğrisi esastır.',
        'Seçicilik yalnız zaman–akım bantlarının kesişmemesiyle değerlendirilir. Ani bölgede (≈ 0,1 s altı) akım sınırlama ve enerji (I²t) seçiciliği üretici seçicilik tablolarıyla doğrulanmalıdır; bu simülasyon tablo yerine geçmez.',
        'Koruma ayarları eğitim amaçlıdır; doğrudan sahada uygulanacak ayar değildir.'
      ],
      formulas: ['Ik3 = c·Un / (√3·|Zk|), Zk = ZQ + ZT + ΣZkablo', 'Ik1,min = cmin·U0 / |(2Z1 + Z0)/3 + 2·ΣZkablo·kT|', 'L: t = tr·(6·Ir/I)²', 'S: t = tsd (I ≥ Isd), I: t ≈ 0 (I ≥ Ii)', 'MCB aşırı yük: t = A/((I/In)² − a) (standart kapılardan uydurulmuş)', 'Seçicilik: t_min,üst(I) > t_maks,alt(I), I ≤ Ik3(alt cihaz barası)']
    };
  }

  return { compute: compute, band: band, curve: curve, grid: grid, pickup: pickup, settings: settings, selectivity: selectivity, network: network, faultResponse: faultResponse, pathOf: pathOf, levelOf: levelOf, tRequired: tRequired, MCB_BANDS: MCB_BANDS, KINDS: KINDS, MCB_FIT: MCB_FIT, T_TOP: T_TOP };
});
