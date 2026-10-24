/* VoltSim · yangin ek hesapları (saf fonksiyonlar; DOM ve 3D'den bağımsız).
 * Tarayıcıda VoltSimEngine.ext.yangin, Node'da require() ile kullanılır; testleri tools/tests/voltsim-yangin.test.cjs.
 *
 * ÖNEMLİ: Buradaki eşikler, gecikmeler ve kapsama yarıçapları EĞİTİM amaçlı örnek değerlerdir. Dedektör seçimi,
 * kapsama alanı ve yerleşim TSE CEN/TS 54-14'e göre (tavan yüksekliği, biçimi, kirişler, hava akımı dikkate alınarak)
 * yetkili mühendis tarafından belirlenir; bu fonksiyonların sonucu standarda uygunluk anlamına gelmez. */
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('../engine.js') : root.VoltSimEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { E.ext = E.ext || {}; E.ext.yangin = api; }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  void E;

  /* ---------------------------------------------------------------- dedektör yanıtı (eğitim ölçeği) */
  // eşik: tavan altı duman yoğunluğu (0–1, modelin boyutsuz ölçeği); ısı dedektörü daha yüksek eşik + birinci derece gecikme
  const THRESHOLD = { optik: 0.06, isi: 0.2, beam: 0.035 };
  const SENS = { yuksek: 0.6, normal: 1, dusuk: 1.5 };
  const TAU = { optik: 0, isi: 40, beam: 0 }; // s
  /** Dedektör tipi ve duyarlılık sınıfına göre alarm eşiği ve gecikme sabiti. */
  function detectorResponse(type, sens) {
    if (!THRESHOLD[type]) throw new Error('Bilinmeyen dedektör tipi: ' + type);
    const k = SENS[sens] || 1;
    return { threshold: THRESHOLD[type] * k, tau: TAU[type] };
  }
  /** Okuma güncellemesi: τ = 0 ise anlık değer, değilse birinci derece gecikme r + (c − r)(1 − e^(−dt/τ)). */
  function lag(reading, c, dt, tau) {
    if (!tau) return c;
    return reading + (c - reading) * (1 - Math.exp(-dt / tau));
  }

  /* ---------------------------------------------------------------- kapsama (eğitim örneği, standart uygunluğu DEĞİL) */
  // Yaygın kılavuzlarda örnek olarak kullanılan yatay kapsama yarıçapları (m) ve örnek tavan yüksekliği sınırları (m).
  // Bu değerler gösterim içindir; TSE CEN/TS 54-14 tablo ve koşullarının yerine geçmez.
  const COVER = { optik: { r: 7.5, hMax: 10.5 }, isi: { r: 5.3, hMax: 7.5 }, beam: { r: 7.5, hMax: 25 } };
  /** Örnek kapsama yarıçapı. Işın tipinde r, hattın iki yanındaki şerit yarı genişliğidir. ok=false: örnek yükseklik sınırı aşıldı. */
  function coverageRadius(type, height) {
    const c = COVER[type]; if (!c) throw new Error('Bilinmeyen dedektör tipi: ' + type);
    return { r: c.r, ok: !(height > c.hMax), hMax: c.hMax };
  }
  /**
   * Bir hücre kümesinin dedektörlerce örtülen oranı (0–1). cells: [[x, y]...] hücre merkezleri (hücre birimi),
   * dets: [{ x, y, r } | { x0, x1, y, r, beam: true }] (hücre birimi; r yarıçap/yarı genişlik).
   */
  function coverageFraction(cells, dets) {
    if (!cells.length) return 0;
    let n = 0;
    cells.forEach(c => {
      if (dets.some(d => d.beam ? (c[0] >= d.x0 - 0.5 && c[0] <= d.x1 + 0.5 && Math.abs(c[1] - d.y) <= d.r) : Math.hypot(c[0] - d.x, c[1] - d.y) <= d.r)) n++;
    });
    return n / cells.length;
  }

  /* ---------------------------------------------------------------- tahliye yol bulma (ızgara üzerinde Dijkstra) */
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  /**
   * Çıkışlara uzaklık alanı. blocked[i] = 1 yürünemez hücre (duvar); exits: hücre indeksleri (çok kaynaklı);
   * cost(i) ≥ 0 hücreye girişte ek maliyet (ör. duman cezası). Çapraz geçişte köşe kesilmez.
   * Ulaşılamayan hücre: Infinity.
   */
  function distanceField(w, h, blocked, exits, cost) {
    const N = w * h, dist = new Float64Array(N).fill(Infinity);
    const heap = [], push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m; } } return top; };
    exits.forEach(i => { if (i >= 0 && i < N && !blocked[i]) { dist[i] = 0; push(0, i); } });
    while (heap.length) {
      const cur = pop(), d = cur[0], i = cur[1];
      if (d > dist[i]) continue;
      const x = i % w, y = (i - x) / w;
      for (const nb of NB) {
        const xx = x + nb[0], yy = y + nb[1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx; if (blocked[j]) continue;
        if (nb[0] && nb[1] && (blocked[y * w + xx] || blocked[yy * w + x])) continue; // köşe kesme yok
        const nd = d + nb[2] * (1 + (cost ? cost(j) : 0));
        if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
      }
    }
    return dist;
  }
  /** Uzaklık alanında bir sonraki hücre (en küçük uzaklıklı komşu); yol yoksa -1, zaten çıkıştaysa kendisi. */
  function nextCell(dist, w, h, blocked, i) {
    if (!isFinite(dist[i])) return -1;
    if (dist[i] === 0) return i;
    const x = i % w, y = (i - x) / w;
    let best = -1, bd = dist[i];
    for (const nb of NB) {
      const xx = x + nb[0], yy = y + nb[1];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx; if (blocked[j]) continue;
      if (nb[0] && nb[1] && (blocked[y * w + xx] || blocked[yy * w + x])) continue;
      if (dist[j] < bd) { bd = dist[j]; best = j; }
    }
    return best;
  }

  /* ---------------------------------------------------------------- olay zaman çizelgesi */
  const KIND = { fire: 'Yangın', detect: 'Algılama', prealarm: 'Ön alarm', alarm: 'Yangın alarmı', mcp: 'İhbar butonu', fault: 'Arıza', clear: 'Arıza giderildi',
    disable: 'Devre dışı', enable: 'Devreye alma', silence: 'Susturma', reset: 'Sıfırlama', evac: 'Tahliye', exit: 'Çıkış kapandı', done: 'Tahliye tamam', info: 'Bilgi' };
  /**
   * Olay listesini zamana göre sıralar (eşit zamanda ekleme sırası korunur) ve özet anahtar zamanları çıkarır.
   * events: [{ t, kind, text }]. Dönüş: { rows: [{ t, kind, label, text }], first: { kind → ilk t } }.
   */
  function timeline(events) {
    const rows = events.map((e, i) => ({ t: e.t, kind: e.kind, label: KIND[e.kind] || e.kind, text: e.text, i: i }))
      .sort((a, b) => a.t - b.t || a.i - b.i).map(r => ({ t: r.t, kind: r.kind, label: r.label, text: r.text }));
    const first = {};
    rows.forEach(r => { if (first[r.kind] === undefined) first[r.kind] = r.t; });
    return { rows: rows, first: first };
  }
  /** Saniyeyi dd:ss biçimine çevirir (çizelge ve CSV için). */
  function clock(t) { t = Math.max(0, Math.round(t)); const m = Math.floor(t / 60), s = t % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }


  /* ---------------------------------------------------------------- adresli döngü (loop) modeli (eğitim)
   * Döngü düğümleri: 0 = panel çıkışı, 1..n = adresli cihazlar, n+1 = panel dönüşü. Kablo bölümü s (0..n) düğüm s ile s+1
   * arasıdır. Sınıf A (döngü/ring) iki uçtan beslenir; sınıf B (radyal) yalnız çıkıştan. İzolatörler düğümlerde (cihaz içi
   * veya modül) bulunur; panelin iki ucu her zaman izolatör gibi davranır. Bu model EN 54-2 / EN 54-13 / EN 54-17
   * kavramlarının sadeleştirilmiş eğitim temsilidir; gerçek davranış panel ve cihaz üreticisine bağlıdır. */
  const LOOP_LIMIT_INFO = 'Döngü başına adres sayısı panel/protokol üreticisine bağlıdır (tipik 99–250); ayrıca döngü akımı ve kablo gerilim düşümü hesabı gerekir.';
  /** İzolatör düğümleri: 'yok' → [], 'her' → her cihaz, k (sayı) → her k. cihaz. */
  function isolatorNodes(n, mode) {
    const out = [];
    if (mode === 'yok' || !n) return out;
    const k = mode === 'her' ? 1 : Math.max(1, Math.round(Number(mode)) || 10);
    for (let i = k; i <= n; i += k) out.push(i);
    return out;
  }
  /**
   * Tek arızanın etkisi. fault: { kind: 'open' | 'short', seg } (0 ≤ seg ≤ n); o: { classA, iso: [düğümler] }.
   * Kısa devre: arızaya en yakın iki izolatör (ya da panel ucu) açar; aradaki cihazlar kaybolur (izolatörlü cihaz
   * diğer taraftan beslendiği için kalır). Sınıf B'de ayrıca kısa devrenin ötesi beslenemez.
   * Açık devre: sınıf A'da cihaz kaybı yok (diğer uçtan beslenir), sınıf B'de kopukluğun ötesi kaybolur.
   * Dönüş: { lost: [cihaz düğümleri], dead: [enerjisiz kablo bölümleri] }.
   */
  function loopLoss(n, fault, o) {
    if (!fault || !fault.kind || !n) return { lost: [], dead: [] };
    const seg = Math.max(0, Math.min(n, Math.round(fault.seg)));
    const classA = !o || o.classA !== false, iso = (o && o.iso) || [];
    const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
    if (fault.kind === 'open') {
      if (classA) return { lost: [], dead: [seg] };
      return { lost: range(seg + 1, n), dead: range(seg, n) };
    }
    if (fault.kind !== 'short') throw new Error('Bilinmeyen döngü arızası: ' + fault.kind);
    let a = 0, b = n + 1;
    iso.forEach(x => { if (x <= seg && x > a) a = x; if (x >= seg + 1 && x < b) b = x; });
    if (!classA) b = n + 1; // radyal hatta kısa devrenin ötesi beslenemez
    return { lost: range(a + 1, b - 1), dead: range(a, b - 1) };
  }
  /** En kötü durum: her kablo bölümünde tek arıza denenir, kaybolan en çok cihaz sayısı döner. */
  function worstLoss(n, kind, o) {
    let w = 0;
    for (let s = 0; s <= n; s++) w = Math.max(w, loopLoss(n, { kind: kind, seg: s }, o).lost.length);
    return w;
  }
  /** Cihazları sırayla döngülere böler (ardışık, olabildiğince eşit). Dönüş: [{ loop (1..), seq (1..) }]. */
  function assignLoops(count, nLoops) {
    nLoops = Math.max(1, Math.round(nLoops)); const out = [];
    const base = Math.floor(count / nLoops), extra = count % nLoops;
    let i = 0;
    for (let l = 1; l <= nLoops; l++) { const sz = base + (l <= extra ? 1 : 0); for (let q = 1; q <= sz; q++) out[i++] = { loop: l, seq: q }; }
    return out;
  }
  /** Adres etiketi: L1-007. */
  function address(loop, seq) { return 'L' + loop + '-' + String(seq).padStart(3, '0'); }

  return { LOOP_LIMIT_INFO: LOOP_LIMIT_INFO, isolatorNodes: isolatorNodes, loopLoss: loopLoss, worstLoss: worstLoss, assignLoops: assignLoops, address: address, THRESHOLD: THRESHOLD, SENS: SENS, TAU: TAU, COVER: COVER, KIND: KIND, detectorResponse: detectorResponse, lag: lag, coverageRadius: coverageRadius, coverageFraction: coverageFraction, distanceField: distanceField, nextCell: nextCell, timeline: timeline, clock: clock };
});
