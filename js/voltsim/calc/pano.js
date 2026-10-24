/* VoltSim · pano ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.pano, Node'da require() ile kullanılır; testleri tools/tests/voltsim-pano.test.cjs.
 *
 * Zaman–akım bantları yalnızca standartların tanımladığı sınır noktalarından kurulur; noktalar arası log–log doğrusal
 * bağlanır. Bunlar üretici eğrisi DEĞİLDİR; gerçek seçicilik üretici tabloları/eğrileriyle doğrulanır. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.pano = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const MAG = { B: [3, 5], C: [5, 10], D: [10, 20] };
  const T_MAX = 7200, T_INST = 0.01;

  /**
   * Bir koruma cihazının standart zaman–akım bandı.
   * MCB (TS EN 60898-1, Tablo 7): 1,13·In'de konvansiyonel sürede açmaz; 1,45·In'de konvansiyonel sürede (In ≤ 63 A: 1 sa,
   *   üstü 2 sa) açar; 2,55·In'de 1 s < t < 60 s (In ≤ 32 A) / 120 s (In > 32 A); ani açma alt sınırında ≥ 0,1 s,
   *   üst sınırında < 0,1 s.
   * MCCB/ACB (TS EN 60947-2): 1,05·Ir'de 2 sa açmaz, 1,30·Ir'de 2 sa içinde açar; ani açma Ii ± %20.
   * Dönüş: { min: [[I, t]...], max: [[I, t]...] } — min: bu sürenin altında açmaz, max: bu süre içinde açar.
   */
  function band(dev) {
    if (dev.kind === 'FUSE') {
      // gG (IEC 60269-1/-2): 1,25·In konvansiyonel erimeme, 1,6·In konvansiyonel erime; kapılar Imin/Imax(10 s, 5 s, 0,1 s)
      const g = E.FUSE_GATES[dev.In]; if (!g) return null;
      const tc = E.fuseConvTime(dev.In);
      return {
        min: [[1.25 * dev.In, T_MAX], [1.25 * dev.In, tc], [g[0], 10], [g[2], 0.1], [g[2], T_INST]],
        max: [[E.fuseI2(dev.In), T_MAX], [E.fuseI2(dev.In), tc], [g[1], 5], [g[3], 0.1], [g[3], T_INST]]
      };
    }
    if (dev.kind === 'MCB') {
      const In = dev.In, m = MAG[dev.curve] || MAG.C;
      const tConv = In <= 63 ? 3600 : 7200, t255 = In <= 32 ? 60 : 120;
      return {
        min: [[1.13 * In, T_MAX], [1.13 * In, tConv], [2.55 * In, 1], [m[0] * In, 0.1], [m[0] * In, T_INST]],
        max: [[1.45 * In, T_MAX], [1.45 * In, tConv], [2.55 * In, t255], [m[1] * In, 0.1], [m[1] * In, T_INST]]
      };
    }
    const Ir = dev.Ir || dev.In, Ii = dev.Ii || 10 * Ir;
    return {
      // 1,05·Ir ile 0,8·Ii arasında süre uzun gecikme ayarına (tr) bağlıdır; çizgi yalnız sınır noktalarını birleştirir
      min: [[1.05 * Ir, T_MAX], [1.05 * Ir, 7200], [0.8 * Ii, 0.05], [0.8 * Ii, T_INST]],
      max: [[1.3 * Ir, T_MAX], [1.3 * Ir, 7200], [1.2 * Ii, 0.1], [1.2 * Ii, T_INST]]
    };
  }

  /** En büyük ani açma eşiği (kesin anlık açma için gereken akım) ve en küçük ani açma eşiği. */
  function instLimits(dev) {
    if (dev.kind === 'FUSE') { const g = E.FUSE_GATES[dev.In] || [0, 0, dev.In * 5, dev.In * 10]; return { lo: g[2], hi: g[3] }; }
    if (dev.kind === 'MCB') { const m = MAG[dev.curve] || MAG.C; return { lo: m[0] * dev.In, hi: m[1] * dev.In }; }
    const Ii = dev.Ii || 10 * (dev.Ir || dev.In); return { lo: 0.8 * Ii, hi: 1.2 * Ii };
  }

  /**
   * Akım seçiciliği (ani açma eşikleriyle) — en basit ölçüt: çıkış cihazının bulunduğu noktadaki arıza akımı,
   * üst cihazın ani açma alt sınırından küçükse yalnız çıkış cihazı açar.
   * limit: üst cihazın ani açma alt eşiği (bu akıma kadar akım seçiciliği beklenir).
   * Zaman seçiciliği (kısa gecikmeli, Icw) ve enerji seçiciliği bu modelde yoktur.
   */
  function selectivity(up, down, Ik) {
    const u = instLimits(up), d = instLimits(down);
    const limit = u.lo;
    let status, text;
    if (d.hi >= u.lo) { status = 'fail'; text = 'Çıkış cihazının ani açma bandı üst cihazınkiyle çakışıyor; ani bölgede seçicilik yok.'; }
    else if (Ik <= limit) { status = 'ok'; text = 'Bu noktadaki arıza akımı (' + Math.round(Ik) + ' A) üst cihazın ani açma alt eşiğinin (' + Math.round(limit) + ' A) altında: akım seçiciliği sağlanır.'; }
    else { status = 'warn'; text = 'Seçicilik sınırı ≈ ' + Math.round(limit) + ' A; daha büyük arızalarda (bu noktada ' + Math.round(Ik) + ' A) iki cihaz birlikte açabilir. Kısmi seçicilik — üretici seçicilik tablosuyla doğrulayın.'; }
    return { status: status, limit: limit, text: text, overlapThermal: thermalOverlap(up, down) };
  }
  /** Termik bölgede çakışma: çıkışın en geç açma bandı, üst cihazın en erken açma bandının sağında kalıyorsa sorun. */
  function thermalOverlap(up, down) {
    const bu = band(up), bd = band(down);
    if (!bu || !bd) return false;
    return bd.max[1][0] >= bu.min[1][0];
  }

  /** log–log doğrusal ara değer: band çizgisinde verilen akım için süre. */
  function timeAt(line, I) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      if (I >= a[0] && I <= b[0] && b[0] > a[0]) {
        const k = (Math.log10(I) - Math.log10(a[0])) / (Math.log10(b[0]) - Math.log10(a[0]));
        return Math.pow(10, Math.log10(a[1]) + k * (Math.log10(b[1]) - Math.log10(a[1])));
      }
    }
    return I < line[0][0] ? Infinity : T_INST;
  }

  return { band: band, instLimits: instLimits, selectivity: selectivity, thermalOverlap: thermalOverlap, timeAt: timeAt, T_MAX: T_MAX, T_INST: T_INST };
});
