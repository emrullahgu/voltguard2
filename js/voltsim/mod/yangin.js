/* VoltSim · 3D Yangın Algılama Sistemi Simülasyonu (eğitim senaryosu)
 * Hesap: VoltSimEngine.yangin (smokeStep: tavan altı 2B duman difüzyonu, panelState: TS EN 54-2 panel durumları,
 * compute: dedektör başına alan ve tahliye süresi). Sahne yalnız motorun sonucunu gösterir: duman katmanı,
 * dedektör LED'leri, panel ekranı, siren/flaşörler ve tahliye eden kişiler.
 * Bu bir yangın projesi değildir; dedektör yerleşimi onaylı tasarım değildir (TSE CEN/TS 54-14, BYKHY). */
(function () {
  'use strict';
  const VS = window.VoltSim, E = VS.E, fmt = VS.fmt;
  const Y = E.yangin, YC = E.ext.yangin; // YC: ek saf hesaplar (eşik/gecikme, kapsama, yol bulma, olay çizelgesi)

  /* ---------------------------------------------------------------- yerleşim planı (40 × 24 hücrelik tavan ızgarası) */
  const GW = 40, GH = 24;
  // bölgeler (hücre aralıkları, uçlar dahil); w: kişi dağılımı ağırlığı
  const ZONES = [
    { id: 'depo', name: 'Depo A', x0: 0, x1: 19, y0: 0, y1: 14, w: 0.25, color: '#a16207' },
    { id: 'uretim', name: 'Üretim', x0: 21, x1: 39, y0: 0, y1: 23, w: 0.5, color: '#3b82f6' },
    { id: 'ofis', name: 'Ofis', x0: 0, x1: 11, y0: 16, y1: 23, w: 0.2, color: '#10b981' },
    { id: 'elektrik', name: 'Elektrik odası', x0: 13, x1: 19, y0: 16, y1: 23, w: 0.05, color: '#8b5cf6' }
  ];
  const ZONE = {}; ZONES.forEach(z => { ZONE[z.id] = z; });
  // bölme duvarları: duman modeli için engel hücreleri. Depo–üretim arasında 4 hücrelik açık geçiş (y 5–8);
  // ofis ve elektrik odası kapıları kapalı (yangın kapısı) kabul edilir.
  const WALLS = (function () {
    const w = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) if (y < 5 || y > 8) w[y * GW + 20] = 1;
    for (let x = 0; x < 20; x++) w[15 * GW + x] = 1;
    for (let y = 16; y < GH; y++) w[y * GW + 12] = 1;
    return w;
  })();
  // çıkışlar (hücre koordinatı, cephe, kapı genişliği m)
  const EXITS = [
    { id: 'E1', name: 'Depo çıkışı', gx: 4.5, gy: 0, side: 'back', w: 1.2, h: 2.2 },
    { id: 'E2', name: 'Ana giriş', gx: 30.5, gy: 0, side: 'back', w: 2.0, h: 2.6 },
    { id: 'E3', name: 'Ofis çıkışı', gx: 5.5, gy: 24, side: 'front', w: 1.0, h: 2.1 },
    { id: 'E4', name: 'Yan çıkış', gx: 40, gy: 12.5, side: 'right', w: 1.2, h: 2.2 }
  ];
  const EXIT_BY = {}; EXITS.forEach(e => { EXIT_BY[e.id] = e; });
  // yangın başlangıç hücreleri (duvar olmayan, raf/makine arası)
  const FIRE = { depo: { x: 6, y: 5, what: 'Palet yığını (raf koridoru)' }, uretim: { x: 28, y: 7, what: 'Makine yağ/talaş yangını' }, ofis: { x: 4, y: 19, what: 'Ofis kâğıt/mobilya yangını' }, elektrik: { x: 16, y: 21, what: 'Pano içi kablo yangını' } };
  const GROWTH = { yavas: 1e-5, orta: 3e-5, hizli: 1e-4 }; // kaynak debisi ≈ a·t² (üst sınır 0,25/s), temsili
  const GROWTH_LABEL = { yavas: 'Yavaş', orta: 'Orta', hizli: 'Hızlı' };
  // eşikler ve gecikmeler calc/yangin.js'te (eğitim ölçeği): ısı dedektörü daha yüksek eşik ve τ gecikmesiyle temsil edilir
  const TAU_HEAT = YC.TAU.isi; // s
  // kişiler için duvarlar: duman modelindeki duvarlar, kapılar (ofis → depo, elektrik odası → üretim) açık
  const PWALL = (function () { const w = WALLS.slice(); w[15 * GW + 8] = 0; w[20 * GW + 20] = 0; return w; })();
  const EXIT_CELL = { E1: 0 * GW + 4, E2: 0 * GW + 30, E3: 23 * GW + 5, E4: 12 * GW + 39 };
  const SMOKE_BLOCK = 0.2;  // çıkış hücresinde bu yoğunluğun üstü: çıkış dumanla kapalı sayılır (temsili)
  const SMOKE_COST = 8;     // yol bulmada duman cezası (yoğunluk × katsayı)
  const T_RESP = 30;   // s, motorun tahliye bağıntısındaki tepki/hazırlık varsayımı
  const T_MAX = 1200;  // s, benzetim üst sınırı
  const EVAC_N = 300;  // s, tahliye görevi hedefi
  const TYPE_NAME = { optik: 'optik duman', isi: 'ısı', beam: 'ışın tipi' };
  const MODE_TEXT = { normal: 'Normal (sessiz)', prealarm: 'Ön alarm', fire: 'YANGIN ALARMI', fault: 'Arıza uyarısı' };
  const MODE_LV = { normal: 0, fault: 0.5, prealarm: 1, fire: 2 };

  function geo(s) { const cs = Math.sqrt(s.area / 960); return { cs: cs, W: GW * cs, D: GH * cs, H: s.height }; }
  function zoneAt(x, y) { return ZONES.find(z => x >= z.x0 && x <= z.x1 + 0.999 && y >= z.y0 && y <= z.y1 + 0.999) || null; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function typeFor(detType, zone) {
    if (detType !== 'karma') return detType;
    return zone === 'depo' ? 'beam' : zone === 'uretim' ? 'isi' : 'optik';
  }
  const thr = (type, s) => YC.detectorResponse(type, s.sens).threshold;

  /** Dedektör yerleşimi (eğitim gösterimi): sayı bölge alanına göre paylaştırılır (bölge başına en az 2). */
  function detLayout(s) {
    const n = Math.max(8, Math.round(s.nDet));
    const areas = ZONES.map(z => (z.x1 - z.x0 + 1) * (z.y1 - z.y0 + 1)), tot = areas.reduce((a, b) => a + b, 0);
    const rest = n - 2 * ZONES.length;
    const raw = areas.map(a => rest * a / tot), cnt = raw.map(r => 2 + Math.floor(r));
    let left = n - cnt.reduce((a, b) => a + b, 0);
    raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(p => { if (left > 0) { cnt[p[1]]++; left--; } });
    const out = [];
    ZONES.forEach((z, zi) => {
      const type = typeFor(s.detType, z.id);
      if (type === 'beam') { // depo: iki ışın hattı (sol duvar → bölme duvarı reflektörü)
        [4, 10].forEach(row => { const cells = []; for (let x = 1; x <= 18; x++) cells.push(row * GW + x); out.push({ zone: z.id, type: 'beam', gx: 1, gy: row, gx2: 18, cells: cells }); });
        return;
      }
      const c = cnt[zi], w = z.x1 - z.x0 + 1, h = z.y1 - z.y0 + 1;
      const nx = Math.max(1, Math.round(Math.sqrt(c * w / h))), ny = Math.ceil(c / nx);
      for (let i = 0; i < c; i++) {
        const r = Math.floor(i / nx), k = i % nx, rowN = r === ny - 1 ? c - nx * (ny - 1) : nx;
        const gx = z.x0 + Math.floor((k + 0.5) * w / rowN), gy = z.y0 + Math.floor((r + 0.5) * h / ny);
        out.push({ zone: z.id, type: type, gx: gx, gy: gy, cells: [gy * GW + gx] });
      }
    });
    out.forEach((d, i) => { d.id = 'D-' + String(i + 1).padStart(2, '0'); d.auto = true; });
    const rm = s.removed || [];
    const list = out.filter(d => rm.indexOf(d.id) < 0);
    // kullanıcının tavana yerleştirdiği noktasal dedektörler (karma tipte depoya eklenen nokta: optik)
    (s.added || []).forEach((a, i) => {
      const z = zoneAt(a[0], a[1]); if (!z || WALLS[a[1] * GW + a[0]]) return;
      const t = typeFor(s.detType, z.id);
      list.push({ id: 'P-' + String(i + 1).padStart(2, '0'), zone: z.id, type: t === 'beam' ? 'optik' : t, gx: a[0], gy: a[1], cells: [a[1] * GW + a[0]], auto: false });
    });
    return list;
  }
  const detSig = s => Math.round(s.nDet) + '|' + s.detType + '|' + (s.removed || []).join(',') + '|' + (s.added || []).map(a => a.join(':')).join(',');
  const AUTO_DEPO = () => detLayout(Object.assign({}, base, { removed: [], added: [] })).filter(d => d.zone === 'depo').map(d => d.id);

  /** Bölge kapsama oranları (eğitim örneği yarıçaplarıyla; TSE CEN/TS 54-14 uygunluğu değildir). */
  function coverage(s) {
    const cs = geo(s).cs, out = {}, warn = [];
    const dets = detLayout(s).filter(d => d.zone);
    ZONES.forEach(z => {
      const cells = [];
      for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) if (!WALLS[y * GW + x]) cells.push([x + 0.5, y + 0.5]);
      const ds = dets.filter(d => d.zone === z.id).map(d => {
        const cr = YC.coverageRadius(d.type, s.height); if (!cr.ok && warn.indexOf(d.type) < 0) warn.push(d.type);
        return d.type === 'beam' ? { beam: true, x0: d.gx, x1: d.gx2, y: d.gy + 0.5, r: cr.r / cs } : { x: d.gx + 0.5, y: d.gy + 0.5, r: cr.r / cs };
      });
      out[z.id] = YC.coverageFraction(cells, ds);
    });
    return { zones: out, heightWarn: warn };
  }

  /* ---------------------------------------------------------------- adresli döngüler (loop)
   * Dedektörler, ihbar butonları ve siren/flaşörler adreslenerek 1–4 döngüye dağıtılır. Sıra: panelden başlayıp
   * üretim → elektrik odası → ofis → depo, bölge içinde yılan (serpantin) düzeni. Arıza etkisi calc: loopLoss. */
  const PANEL_G = [33.6, 0.4];
  // siren/flaşör ve ihbar butonu konumları (hücre biriminde; sahnedeki duvar montaj noktalarıyla aynı)
  const SND_G = [[25, 0.3], [9, 0.3], [4, 15.3], [12.3, 19], [20.3, 17], [0.3, 8], [37, 0.3], [20.7, 12], [16, 0.3], [20.3, 3], [0.3, 20], [14, 15.7], [20.3, 22.5]];
  const mcpG = e => (e.side === 'back' ? [e.gx + 1.3, 0.3] : e.side === 'front' ? [e.gx + 1.2, 23.7] : [39.7, e.gy - 1.3]);
  const ZORDER = ['uretim', 'elektrik', 'ofis', 'depo'];
  const LOOP_COL = ['#22d3ee', '#a78bfa', '#a3e635', '#f472b6'];
  const KIND_NAME = { det: 'dedektör', mcp: 'ihbar butonu', snd: 'siren/flaşör' };
  const loopSig = s => detSig(s) + '|' + [s.nLoops, s.isoMode, s.classA, s.loopFault, s.faultLoop, Math.round(s.sounders)].join('|');
  let LM = { sig: null, m: null };
  /** Döngü modeli (saf; durumdan türetilir, son sonuç önbellekte). */
  function loopModel(s) {
    const sig = loopSig(s); if (LM.sig === sig) return LM.m;
    const devs = [];
    const zoneOf = q => (zoneAt(Math.min(GW - 1, Math.floor(q[0])), Math.min(GH - 1, Math.floor(q[1]))) || ZONE.uretim).id;
    detLayout(s).forEach(d => devs.push({ kind: 'det', ref: d.id, zone: d.zone, x: d.type === 'beam' ? d.gx + 1 : d.gx + 0.5, y: d.gy + 0.5, name: d.id + ' · ' + TYPE_NAME[d.type] }));
    EXITS.forEach(e => { const q = mcpG(e); devs.push({ kind: 'mcp', ref: e.id, zone: zoneOf(q), x: q[0], y: q[1], name: 'İhbar butonu ' + e.id }); });
    SND_G.slice(0, Math.round(s.sounders)).forEach((q, i) => devs.push({ kind: 'snd', ref: i, zone: zoneOf(q), x: q[0], y: q[1], name: 'Siren/flaşör ' + (i + 1) }));
    // kablo güzergâhı: panelden başlayarak bölge sırasıyla (üretim → elektrik → ofis → depo) en yakın komşu
    const rest = devs.splice(0, devs.length); let cur = PANEL_G;
    ZORDER.forEach(zid => {
      const pool = rest.filter(d => d.zone === zid);
      while (pool.length) {
        let bi = 0, bd = Infinity;
        pool.forEach((d, i) => { const dd = Math.hypot(d.x - cur[0], d.y - cur[1]); if (dd < bd) { bd = dd; bi = i; } });
        const d = pool.splice(bi, 1)[0]; devs.push(d); cur = [d.x, d.y];
      }
    });
    const nL = Math.max(1, Math.min(4, Math.round(s.nLoops || 1)));
    YC.assignLoops(devs.length, nL).forEach((a, i) => { devs[i].loop = a.loop; devs[i].seq = a.seq; devs[i].addr = YC.address(a.loop, a.seq); });
    const fl = Math.max(1, Math.min(nL, Math.round(s.faultLoop || 1)));
    const lostDet = new Set(), lostMcp = new Set(), lostSnd = new Set(), byRef = {};
    const loops = [];
    for (let l = 1; l <= nL; l++) {
      const list = devs.filter(d => d.loop === l), n = list.length;
      const o = { classA: s.classA !== false, iso: YC.isolatorNodes(n, s.isoMode) };
      const fault = s.loopFault && l === fl ? { kind: s.loopFault, seg: Math.floor(n / 2) } : null;
      const r = YC.loopLoss(n, fault, o);
      const lost = r.lost.map(k => list[k - 1]);
      lost.forEach(d => { (d.kind === 'det' ? lostDet : d.kind === 'mcp' ? lostMcp : lostSnd).add(d.ref); });
      list.forEach((d, k) => { d.iso = o.iso.indexOf(k + 1) >= 0; });
      loops.push({ l: l, devs: list, n: n, iso: o.iso, fault: fault, lost: lost, dead: r.dead, worstShort: YC.worstLoss(n, 'short', o), worstOpen: YC.worstLoss(n, 'open', o) });
    }
    devs.forEach(d => { byRef[d.kind + ':' + d.ref] = d; });
    LM = { sig: sig, m: { devs: devs, loops: loops, lostDet: lostDet, lostMcp: lostMcp, lostSnd: lostSnd, byRef: byRef, nL: nL, fl: fl } };
    return LM.m;
  }
  const addrOf = (s, kind, ref) => { const d = loopModel(s).byRef[kind + ':' + ref]; return d ? d.addr : '—'; };

  /** Kişiler (görsel temsil, en çok 60 figür): bölgeye göre yerleşim. Güzergâh, ızgara üzerinde çıkışlara uzaklık
   * alanından (calc: distanceField) adım adım seçilir; çıkış dumanla kapanınca alan yeniden kurulur ve kişiler yön değiştirir. */
  function makePeople(s) {
    const n = Math.max(0, Math.min(60, Math.round(s.occupants)));
    const r = rng(1907), out = [];
    for (let i = 0; i < n; i++) {
      const q = r(); let acc = 0; const z = ZONES.find(zz => (acc += zz.w) >= q) || ZONES[1];
      let x, y;
      if (z.id === 'depo') { x = 2.4 + r() * 15.2; y = [0.9, 5, 9, 12.6 + r() * 2][Math.floor(r() * 4)]; }
      else if (z.id === 'uretim') { x = 21.8 + r() * 16.8; y = 0.9 + r() * 22; }
      else if (z.id === 'ofis') { x = 0.9 + r() * 10.2; y = 16.8 + r() * 6.2; }
      else { x = 13.8 + r() * 5.4; y = 16.9 + r() * 3.6; }
      out.push({ x: x, y: y, zone: z.id, out: false, trapped: false, tgt: -1, ph: r() * 6.28, dir: 0 });
    }
    return out;
  }

  /* ---------------------------------------------------------------- canlı durum */
  function initLive(s) {
    const L = { burning: false, t: 0, rate: 0, grid: new Float32Array(GW * GH), dets: [], detSig: '', people: makePeople(s), peopleSig: s.occupants + '|' + s.area,
      track: [], trackZone: '', tFirst: null, firstId: '', tPre: null, tAlarm: null, tOut: null, mcp: false, silenced: false, alarmBy: '',
      sawFault: false, field: null, fieldT: 0, blocked: {}, tl: [], tEvac: null,
      panel: { mode: 'normal', zones: [], fired: 0, faults: 0 }, hist: [], histT: 0, evac: 0, events: [] };
    syncDets(L, s);
    return L;
  }
  function syncDets(L, s) {
    // yerleşim değişince okuma ve alarm durumu dedektör kimliğiyle korunur
    const old = {}; (L.dets || []).forEach(d => { old[d.id] = d; });
    L.dets = detLayout(s).map(d => { const o = old[d.id]; return Object.assign(d, { reading: o ? o.reading : 0, alarm: o ? o.alarm : false, tAlarm: o ? o.tAlarm : null }); });
    L.detSig = detSig(s); L.trackZone = '';
  }
  /** Girdi değişince (dedektör sayısı/tipi, kişi sayısı) canlı listeleri eşitler. */
  function ensureLive(app) {
    const s = app.state, L = app.live;
    if (L.detSig !== detSig(s)) syncDets(L, s);
    const ps = s.occupants + '|' + s.area;
    if (L.peopleSig !== ps) { L.people = makePeople(s); L.peopleSig = ps; L.evac = 0; }
    if (L.trackZone !== s.fireZone) {
      const f = FIRE[s.fireZone];
      L.track = L.dets.map((d, i) => [i, d.type === 'beam' ? Math.abs(d.gy - f.y) + 0.5 : Math.hypot(d.gx - f.x, d.gy - f.y)]).sort((a, b) => a[1] - b[1]).slice(0, 4).map(p => p[0]);
      L.trackZone = s.fireZone; L.hist = [];
    }
  }
  /** Arıza gösterimi: "faultDet" açıkken yangına en yakın dedektör, ayrıca 3D'de seçilip arızalandırılan dedektörler
   * (state.faults) "hat kopukluğu" arızasında kabul edilir; arızalı dedektör algılama yapamaz. */
  function faultIdx(s, L) {
    if (!s.faultDet) return -1;
    const f = FIRE[s.fireZone]; let best = -1, bd = 1e9;
    L.dets.forEach((d, i) => { if (d.zone !== s.fireZone) return; const dd = Math.hypot(d.gx - f.x, d.gy - f.y); if (dd < bd) { bd = dd; best = i; } });
    return best;
  }
  function isFault(s, L, i) { return i === faultIdx(s, L) || (s.faults || []).indexOf(L.dets[i].id) >= 0 || loopModel(s).lostDet.has(L.dets[i].id); }
  function detStates(s, L) {
    const out = L.dets.map((d, i) => ({ state: isFault(s, L, i) ? 'fault' : d.alarm ? 'alarm' : 'normal', disabled: s.disableZone === d.zone, zone: d.zone }));
    // döngü arızası (açık/kısa devre) cihaz kaybı olmasa da panelde arıza olarak bildirilir (döngü arayüzü)
    if (s.loopFault) out.push({ state: 'fault', disabled: false, zone: '-' });
    return out;
  }
  function evalPanel(app) {
    const s = app.state, L = app.live;
    const ps = Y.panelState(detStates(s, L), { coincidence: !!s.coincidence, mcp: L.mcp });
    if (ps.mode === 'prealarm' && L.tPre === null) { L.tPre = L.t; log(L, 'Panel ön alarmda: tek dedektör algıladı; alarm doğrulaması için ikinci dedektör bekleniyor.', 'prealarm'); }
    if (ps.mode === 'fire' && L.tAlarm === null) {
      L.tAlarm = L.t;
      // alarm nedeni: ihbar butonu her koşulda doğrudan yangın alarmı verir; çift onayda en az iki dedektör gerekir
      L.alarmBy = ps.fired >= (s.coincidence ? 2 : 1) ? (s.coincidence ? 'coincidence' : 'single') : 'mcp';
      log(L, 'YANGIN ALARMI · ' + (ps.zones.map(z => ZONE[z].name).join(', ') || 'yangın ihbar butonu') + ' (' + ALARM_BY[L.alarmBy] + '). Sirenler ve flaşörler devrede.', 'alarm');
      if (app.invalidate) app.invalidate(); // tahliye süresi ölçülen algılama süresiyle yeniden hesaplanır
    }
    if (ps.faults && !L.panel.faults) {
      L.sawFault = true;
      const lm = loopModel(s);
      log(L, 'Arıza uyarısı (' + ps.faults + ')' + (s.loopFault ? ': döngü L' + lm.fl + ' ' + (s.loopFault === 'short' ? 'kısa devre' : 'açık devre') : ': dedektör hattında kopukluk') + '. Arızalı/kayıp dedektör yangını algılayamaz.', 'fault');
      panelEvent(L, 'ARIZA', s.loopFault ? 'L' + lm.fl : '—', s.loopFault ? (s.loopFault === 'short' ? 'KISA DEVRE' : 'AÇIK DEVRE') : 'HAT KOPUK');
    }
    if (!ps.faults && L.panel.faults) log(L, 'Arıza giderildi; panel arıza uyarısından çıktı.', 'clear');
    L.panel = ps;
    return ps;
  }
  const ALARM_BY = { coincidence: 'çift dedektör onayı', single: 'tek dedektör', mcp: 'ihbar butonu' };
  /** Adresli panel olay listesi (ekranda en yeni üstte). */
  function panelEvent(L, type, addr, zone) { (L.plog || (L.plog = [])).push({ t: L.t, type: type, addr: addr, zone: zone }); if (L.plog.length > 30) L.plog.shift(); }
  function log(L, msg, kind) {
    L.events.push('t = ' + fmt(L.t, 0) + ' s · ' + msg); if (L.events.length > 40) L.events.shift();
    L.tl.push({ t: L.t, kind: kind || 'info', text: msg }); if (L.tl.length > 150) L.tl.shift();
  }

  /* ---------------------------------------------------------------- zaman adımı */
  function start(app) {
    const s = app.state, L = app.live;
    ensureLive(app);
    L.grid = new Float32Array(GW * GH); L.t = 0; L.rate = 0; L.burning = true;
    L.dets.forEach(d => { d.reading = 0; d.alarm = false; d.tAlarm = null; });
    L.people = makePeople(s); L.evac = 0; L.tOut = null; L.field = null; L.fieldT = 0; L.blocked = {}; L.tEvac = null;
    L.plog = [];
    L.tFirst = L.tPre = L.tAlarm = null; L.firstId = ''; L.mcp = false; L.silenced = false; L.alarmBy = ''; L.hist = []; L.histT = 0; L.events = []; L.tl = [];
    L.panel = { mode: 'normal', zones: [], fired: 0, faults: 0 };
    log(L, 'Yangın başladı: ' + ZONE[s.fireZone].name + ' · ' + FIRE[s.fireZone].what + '.', 'fire');
    evalPanel(app);
    if (s.blockExit) log(L, EXIT_BY[s.blockExit].name + ' (' + s.blockExit + ') kapalı kabul edildi (engel/duman); kişiler diğer çıkışlara yönlenir.', 'exit');
    app._startedOnce = true;
    app.invalidate();
  }
  function tick(app, dt) {
    const s = app.state, L = app.live;
    ensureLive(app);
    if (!L.burning) return false;
    const f = FIRE[s.fireZone], speed = 1.2 / geo(s).cs; // hücre/s
    let left = dt * s.speed;
    while (left > 1e-6) {
      const h = Math.min(0.5, left); left -= h;
      // duman: motorun difüzyon adımı (duvarlar engel)
      L.rate = Math.min(0.25, GROWTH[s.growth] * L.t * L.t);
      L.grid = Y.smokeStep(L.grid, GW, GH, [{ x: f.x, y: f.y, rate: L.rate }], h, WALLS);
      L.t += h;
      // dedektörler: optik = yerel yoğunluk, ısı = τ gecikmeli yerel değer, ışın = hat ortalaması
      L.dets.forEach((d, i) => {
        let c = 0; d.cells.forEach(j => { c += L.grid[j]; }); c /= d.cells.length;
        const resp = YC.detectorResponse(d.type, s.sens);
        d.reading = YC.lag(d.reading, c, h, resp.tau);
        if (!isFault(s, L, i) && !d.alarm && d.reading >= resp.threshold) {
          d.alarm = true; d.tAlarm = L.t;
          if (L.tFirst === null) { L.tFirst = L.t; L.firstId = d.id; }
          const ad = addrOf(s, 'det', d.id);
          log(L, ad + ' ' + d.id + ' (' + ZONE[d.zone].name + ', ' + TYPE_NAME[d.type] + ') algıladı' + (s.disableZone === d.zone ? ' — bölge devre dışı, panel değerlendirmez.' : '.'), 'detect');
          if (s.disableZone !== d.zone) panelEvent(L, 'ALARM', ad, ZONE[d.zone].name.toUpperCase());
        }
      });
      evalPanel(app);
      // tahliye: alarm + 30 s tepki süresinden sonra 1,2 m/s ile çıkışa
      if (L.tAlarm !== null && L.t >= L.tAlarm + T_RESP) {
        if (L.tEvac === undefined || L.tEvac === null) { L.tEvac = L.t; log(L, 'Tahliye başladı (alarm + ' + T_RESP + ' s tepki süresi).', 'evac'); }
        L.fieldT -= h;
        if (!L.field || L.fieldT <= 0) { updateField(s, L); L.fieldT = 1; }
        L.people.forEach(p => { if (!p.out) walk(p, speed * h, L); });
        if (L.tOut === null && L.people.length && L.evac === L.people.length) { L.tOut = L.t; log(L, 'Görsel tahliye tamamlandı: ' + fmt(L.t, 0) + ' s (temsili figürler).', 'done'); }
      }
      L.histT += h;
      if (L.histT >= 2) { L.histT = 0; L.hist.push({ t: L.t, r: L.track.map(i => L.dets[i] ? L.dets[i].reading : 0), lv: MODE_LV[L.panel.mode], ev: evacPeople(s, L) }); if (L.hist.length > 700) L.hist.shift(); }
      if (L.t >= T_MAX) { L.burning = false; log(L, 'Benzetim ' + T_MAX / 60 + ' dakikada sonlandı.'); app.running = false; app.syncToolbar(); break; }
    }
    return true;
  }
  /** Çıkışlara uzaklık alanı: kapalı (elle ya da dumanla) çıkışlar kaynak sayılmaz, dumanlı hücreler cezalıdır. */
  function exitBlocked(s, L, e) { return s.blockExit === e.id || L.grid[EXIT_CELL[e.id]] > SMOKE_BLOCK; }
  function updateField(s, L) {
    const open = [];
    EXITS.forEach(e => {
      const b = exitBlocked(s, L, e);
      if (b && !L.blocked[e.id] && s.blockExit !== e.id) log(L, e.name + ' (' + e.id + ') dumanla kapandı; kişiler diğer çıkışlara yönlendiriliyor.', 'exit');
      L.blocked[e.id] = b; if (!b) open.push(EXIT_CELL[e.id]);
    });
    L.field = YC.distanceField(GW, GH, PWALL, open, j => SMOKE_COST * L.grid[j]);
  }
  /** Bir kişiyi uzaklık alanında hücre merkezinden hücre merkezine yürütür; çıkış hücresine varınca dışarıda sayılır. */
  function walk(p, step, L) {
    let guard = 0;
    while (step > 1e-6 && !p.out && guard++ < 20) {
      const ci = Math.min(GH - 1, Math.max(0, Math.floor(p.y))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(p.x)));
      if (p.tgt < 0 || !(L.field[p.tgt] < L.field[ci]) || p.tgt === ci) p.tgt = YC.nextCell(L.field, GW, GH, PWALL, ci);
      if (p.tgt < 0) { p.trapped = true; return; }
      p.trapped = false;
      const tx = p.tgt % GW + 0.5, ty = Math.floor(p.tgt / GW) + 0.5, dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      if (d > 1e-6) p.dir = Math.atan2(dx, dy);
      if (d <= step) {
        p.x = tx; p.y = ty; step -= d;
        if (L.field[p.tgt] === 0) { p.out = true; L.evac++; return; }
        p.tgt = YC.nextCell(L.field, GW, GH, PWALL, p.tgt);
      } else { p.x += dx / d * step; p.y += dy / d * step; step = 0; }
    }
  }
  const evacPeople = (s, L) => L.people.length ? Math.round(L.evac / L.people.length * s.occupants) : 0;

  /* ---------------------------------------------------------------- kontroller */
  /* ---------------------------------------------------------------- kullanıcı eylemleri (sol panel ve 3D bilgi kartı) */
  function pressMcp(app, exitId) {
    const L = app.live, e = EXIT_BY[exitId] || EXITS[1];
    if (L.mcp) { VS.toast('İhbar butonu zaten basılı; panel sıfırlanınca anahtarla kurulur.'); return; }
    const ad = addrOf(app.state, 'mcp', e.id);
    if (loopModel(app.state).lostMcp.has(e.id)) { log(L, 'İhbar butonuna basıldı (' + e.name + ', ' + ad + ') ama buton döngü arızası nedeniyle panelle haberleşemiyor.', 'fault'); VS.toast('Bu ihbar butonu döngü arızasından etkilenmiş; panel algılamıyor.'); return; }
    L.mcp = true; log(L, 'Yangın ihbar butonuna basıldı (' + e.name + ', ' + ad + ').', 'mcp'); panelEvent(L, 'İHBAR', ad, e.name.toUpperCase()); evalPanel(app);
  }
  function silence(app) {
    const L = app.live;
    if (L.panel.mode !== 'fire') { VS.toast('Susturulacak alarm yok.'); return; }
    L.silenced = true; log(L, 'Sirenler susturuldu (flaşörler sıfırlamaya kadar devam eder).', 'silence');
  }
  function resetPanel(app) {
    const L = app.live; L.dets.forEach(d => { d.alarm = false; }); L.mcp = false; L.silenced = false;
    log(L, 'Panel sıfırlandı; ihbar butonu kuruldu. Duman sürerse dedektörler yeniden algılar.', 'reset'); evalPanel(app);
  }
  function clearFaults(app) {
    const s = app.state; if (!s.faultDet && !(s.faults || []).length && !s.loopFault) { VS.toast('Arızalı cihaz yok.'); return; }
    if (s.loopFault) log(app.live, 'Döngü arızası giderildi (kablo onarıldı).', 'clear');
    s.faultDet = false; s.faults = []; s.loopFault = ''; evalPanel(app);
  }
  function setLoopFault(app, kind, loop) {
    const s = app.state; s.loopFault = kind; if (loop) s.faultLoop = loop;
    const m = loopModel(s), lp = m.loops[m.fl - 1];
    log(app.live, 'Döngü L' + lp.l + ' ortasında ' + (kind === 'short' ? 'kısa devre' : 'açık devre (kablo kopması)') + ' oluşturuldu: ' + lp.lost.length + ' cihaz panelle haberleşemiyor.', 'fault');
    evalPanel(app);
  }
  function addDet(app, gx, gy) {
    const s = app.state;
    if (detLayout(s).some(d => d.type !== 'beam' && d.gx === gx && d.gy === gy)) { VS.toast('Bu noktada zaten dedektör var.'); return; }
    if (!zoneAt(gx, gy) || WALLS[gy * GW + gx]) { VS.toast('Buraya dedektör yerleştirilemez (duvar).'); return; }
    s.added = (s.added || []).concat([[gx, gy]]);
    log(app.live, 'Dedektör eklendi: ' + zoneAt(gx, gy).name + ' (' + gx + ', ' + gy + ').', 'info');
  }
  function removeDet(app, id) {
    const s = app.state;
    if (/^P-/.test(id)) { const i = Number(id.slice(2)) - 1; s.added = (s.added || []).filter((a, j) => j !== i); }
    else s.removed = (s.removed || []).concat([id]);
    s.faults = (s.faults || []).filter(x => x !== id);
    log(app.live, 'Dedektör kaldırıldı: ' + id + '.', 'info');
  }
  function toggleFault(app, i) {
    const s = app.state, L = app.live, d = L.dets[i]; if (!d) return;
    if (isFault(s, L, i)) { if (i === faultIdx(s, L)) s.faultDet = false; s.faults = (s.faults || []).filter(x => x !== d.id); }
    else s.faults = (s.faults || []).concat([d.id]);
    evalPanel(app);
  }
  function toggleZone(app, zid) {
    const s = app.state, on = s.disableZone === zid;
    s.disableZone = on ? '' : zid;
    log(app.live, ZONE[zid].name + (on ? ' bölgesi yeniden devreye alındı.' : ' bölgesi devre dışı bırakıldı (panel bu bölgeyi değerlendirmez; sarı “devre dışı” göstergesi).'), on ? 'enable' : 'disable');
  }
  /** 3D bilgi kartı eylemleri: dedektör. */
  function detActions(app, i) {
    const L = app.live, s = app.state, d = L.dets[i]; if (!d) return [];
    const f = isFault(s, L, i), dis = s.disableZone === d.zone;
    const acts = [
      { label: f ? 'Arızayı gider' : 'Arıza oluştur (hat kopukluğu)', variant: f ? 'primary' : 'warn', onClick: a => toggleFault(a, i) },
      { label: dis ? ZONE[d.zone].name + ' bölgesini devreye al' : 'Bölgeyi devre dışı bırak', onClick: a => toggleZone(a, d.zone) }
    ];
    if (d.type !== 'beam') acts.push({ label: 'Kaldır', variant: 'danger', onClick: a => removeDet(a, d.id) });
    return acts;
  }
  /** Yerleştirme noktaları (yalnız yerleştirme modunda görünür). */
  function slotInfo(app, gx, gy) { const z = zoneAt(gx, gy); return ['Tavan noktası (' + gx + ', ' + gy + ') · ' + (z ? z.name : '—'), 'Eklenecek tip: ' + TYPE_NAME[typeFor(app.state.detType, z ? z.id : '') === 'beam' ? 'optik' : typeFor(app.state.detType, z ? z.id : '')] + ' dedektörü', 'Yerleşim eğitim amaçlıdır; onaylı tasarım değildir (TSE CEN/TS 54-14).']; }

  /** Sol panel düğmeleri için: eylemden sonra kontrolleri ve hesabı tazele (3D kart düğmelerinde çekirdek bunu yapar). */
  const act = fn => a => { fn(a); a.renderControls(); a.invalidate(); };
  function controls(s, app) {
    const restart = a => { a.running = true; a.paused = false; a.simTime = 0; start(a); a.syncToolbar(); };
    return [
      { title: 'Bina ve kullanım', items: [
        { type: 'range', key: 'occupants', label: 'Kişi sayısı', min: 5, max: 400, step: 5, help: '3D sahnede en çok 60 figür gösterilir; bir figür birden çok kişiyi temsil edebilir.' },
        { type: 'range', key: 'area', label: 'Bina alanı', min: 400, max: 6000, step: 50, unit: 'm²', help: 'Plan oranı korunarak ölçeklenir (40 × 24 hücrelik tavan ızgarası).' },
        { type: 'range', key: 'height', label: 'Tavan yüksekliği', min: 3, max: 14, step: 0.5, unit: 'm', digits: 1 },
        { type: 'range', key: 'exitW', label: 'Toplam çıkış genişliği', min: 1.6, max: 12, step: 0.2, unit: 'm', digits: 1 },
        { type: 'range', key: 'dist', label: 'En uzak kaçış mesafesi', min: 5, max: 80, step: 1, unit: 'm', help: 'Binadaki en uzak noktadan en yakın çıkışa yürüme mesafesi.' }
      ] },
      { title: 'Algılama ve uyarı', items: [
        { type: 'seg', key: 'detType', label: 'Dedektör tipi', options: [['optik', 'Optik duman'], ['isi', 'Isı'], ['karma', 'Karma']], help: 'Karma: depoda ışın tipi, üretimde ısı, ofis ve elektrik odasında optik duman dedektörü.' },
        { type: 'range', key: 'nDet', label: 'Otomatik yerleşim · dedektör sayısı', min: 8, max: 400, step: 1, help: 'Bölge alanına göre paylaştırılır; ayrıca tavana istediğiniz kadar dedektör ekleyebilirsiniz. Yerleşim onaylı tasarım değildir (TSE CEN/TS 54-14).' },
        { type: 'seg', key: 'sens', label: 'Duyarlılık', options: [['yuksek', 'Yüksek'], ['normal', 'Normal'], ['dusuk', 'Düşük']] },
        { type: 'toggle', key: 'coincidence', label: 'Çift dedektör onayı (iki dedektör → yangın)' },
        { type: 'range', key: 'sounders', label: 'Siren / flaşör sayısı', min: 2, max: 13, step: 1 },
        { type: 'note', text: 'Eşikler eğitim ölçeğindedir: optik ' + fmt(thr('optik', s), 3) + ', ışın ' + fmt(thr('beam', s), 3) + ', ısı ' + fmt(thr('isi', s), 2) + ' (τ = ' + TAU_HEAT + ' s gecikmeli). Isı dedektörünün daha geç yanıt vermesi temsilidir.' }
      ] },
      { title: 'Yangın senaryosu', items: [
        { type: 'chips', key: 'fireZone', label: 'Yangın bölgesi', options: ZONES.map(z => ({ value: z.id, label: z.name, dot: true, color: z.color })) },
        { type: 'seg', key: 'growth', label: 'Yangın büyüme hızı', options: Object.keys(GROWTH_LABEL).map(k => [k, GROWTH_LABEL[k]]) },
        { type: 'range', key: 'speed', label: 'Zaman hızlandırma', min: 1, max: 30, step: 1, fmt: v => '×' + v, report: false },
        { type: 'select', key: 'blockExit', label: 'Kapalı çıkış (engel / duman)', options: [['', 'Yok — tüm çıkışlar açık']].concat(EXITS.map(e => [e.id, e.id + ' · ' + e.name])), help: 'Ayrıca çıkış hücresindeki duman yoğunluğu ' + fmt(SMOKE_BLOCK, 2) + '’yi aşınca çıkış kendiliğinden kapanır; kişiler yol bulma ile diğer çıkışlara yönlenir.' },
        { type: 'buttons', items: [
          { label: 'Yangını başlat', variant: 'danger', onClick: restart },
          { label: 'İhbar butonuna bas', variant: 'warn', onClick: act(a => pressMcp(a, 'E2')) }
        ] }
      ] },
      { title: 'Dedektör yerleşimi ve kapsama', items: [
        { type: 'toggle', key: 'placeMode', label: 'Yerleştirme modu', help: 'Açıkken 3D’de tavan ızgarasındaki herhangi bir hücreye tıklayıp “Dedektör ekle” deyin (dolu hücrede “Kaldır”), ya da 2D planda hücreye tıklayın. Sayı sınırı yoktur; hesap gerçek dedektör sayısını kullanır.' },
        { type: 'toggle', key: 'showCov', label: 'Kapsama alanlarını göster (eğitim örneği)' },
        { type: 'buttons', items: [
          { label: 'Eklenenleri temizle', onClick: act(a => { a.state.added = []; log(a.live, 'Elle eklenen dedektörler kaldırıldı.'); }) },
          { label: 'Otomatik yerleşime dön', onClick: act(a => { a.state.added = []; a.state.removed = []; log(a.live, 'Dedektör yerleşimi otomatik dağılıma döndü.'); }) }
        ] },
        { type: 'note', text: 'Kapsama daireleri örnek yarıçaplarla çizilir (optik ' + fmt(YC.COVER.optik.r, 1) + ' m, ısı ' + fmt(YC.COVER.isi.r, 1) + ' m, ışın hattı ±' + fmt(YC.COVER.beam.r, 1) + ' m). Bu gösterim TSE CEN/TS 54-14 uygunluğu değildir; gerçek kapsama tavan yüksekliği, biçimi, kirişler ve hava akımına göre standarttan belirlenir.' }
      ] },
      { title: 'Adresli döngüler (loop)', items: [
        { type: 'select', key: 'nLoops', label: 'Döngü sayısı', options: [[1, '1 döngü'], [2, '2 döngü'], [3, '3 döngü'], [4, '4 döngü']] },
        { type: 'seg', key: 'isoMode', label: 'Kısa devre izolatörü', options: [['yok', 'Yok'], ['10', 'Her 10 cihazda'], ['her', 'Her cihazda']] },
        { type: 'toggle', key: 'classA', label: 'Sınıf A kablolama (döngü, iki uçtan besleme)' },
        { type: 'toggle', key: 'showLoops', label: 'Döngü kablolarını göster' },
        { type: 'select', key: 'loopFault', label: 'Döngü arızası (döngünün ortasında)', options: [['', 'Yok'], ['open', 'Açık devre (kablo kopması)'], ['short', 'Kısa devre']] },
        { type: 'select', key: 'faultLoop', label: 'Arızalı döngü', options: [1, 2, 3, 4].slice(0, Math.max(1, Math.round(s.nLoops || 1))).map(n => [n, 'L' + n]) },
        { type: 'note', text: 'Her cihazın adresi “L1-012” biçimindedir (döngü-sıra). Sınıf A döngüde tek kablo kopması cihaz kaybettirmez; kısa devrede yalnız iki izolatör arasındaki cihazlar kaybolur. EN 54-2 / EN 54-13’e göre tek bir iletim yolu arızası 32’den fazla dedektör/ihbar butonunu etkilememelidir (bilgi). ' + YC.LOOP_LIMIT_INFO }
      ] },
      { title: 'Panel · TS EN 54-2 durumları', items: [
        { type: 'toggle', key: 'faultDet', label: 'Dedektör arızası (yangına en yakın dedektör)' },
        { type: 'select', key: 'disableZone', label: 'Devre dışı bölge', options: [['', 'Yok']].concat(ZONES.map(z => [z.id, z.name])) },
        { type: 'buttons', items: [
          { label: 'Sirenleri sustur', onClick: act(silence) },
          { label: 'Paneli sıfırla', onClick: act(resetPanel) },
          { label: 'Arızaları gider', onClick: act(clearFaults) }
        ] },
        { type: 'note', text: 'Alarm doğrulama / çift dedektör onayı: açıkken tek dedektörün algılaması panelde yalnız “ön alarm” verir; aynı ya da başka bölgede ikinci dedektör algılayınca “yangın alarmı”na geçilir. İstenmeyen alarmları azaltır, algılamayı geciktirir. İhbar butonu her durumda doğrudan yangın alarmı verir. Arızalı dedektör algılayamaz; devre dışı bölgedeki dedektörler panelce değerlendirilmez.' },
        { type: 'note', level: 'warn', text: 'Eğitim senaryosudur; yangın projesi değildir. Dedektör yerleşimi onaylı tasarım değildir: kapsama ve yerleşim TSE CEN/TS 54-14’e, sistem gerekliliği Binaların Yangından Korunması Hakkında Yönetmelik’e göre yetkili mühendis tarafından belirlenir.' }
      ] }
    ];
  }

  /* ---------------------------------------------------------------- okumalar ve grafikler */
  function readouts(res, s, L) {
    const v = res.values, p = L.panel;
    const nDis = L.dets.filter(d => d.zone === s.disableZone).length;
    const out = [
      { label: 'Panel durumu', value: MODE_TEXT[p.mode] + (p.mode === 'fire' && L.silenced ? ' · susturuldu' : ''), level: p.mode === 'fire' ? 'bad' : p.mode === 'normal' ? (L.burning && L.t > 0 ? 'warn' : 'ok') : 'warn', wide: true,
        sub: (p.zones.length ? 'Alarm bölgesi: ' + p.zones.map(z => ZONE[z].name).join(', ') + ' · ' : '') + 'arıza ' + p.faults + ' · devre dışı ' + nDis + (L.mcp ? ' · ihbar butonu' : '') },
      { label: 'Yangın süresi', value: fmt(L.t, 0, 's'), sub: (L.burning ? 'sürüyor' : 'durdu') + ' · ×' + s.speed + ' · ' + GROWTH_LABEL[s.growth].toLowerCase() + ' büyüme' },
      { label: 'İlk algılama', value: L.tFirst === null ? '—' : fmt(L.tFirst, 0, 's'), sub: L.firstId || 'henüz yok' },
      { label: 'Yangın alarmı', value: L.tAlarm === null ? '—' : fmt(L.tAlarm, 0, 's'), level: L.tAlarm === null && L.tFirst !== null ? 'warn' : undefined, sub: s.coincidence ? 'çift dedektör onayı' + (L.tPre !== null ? ' · ön alarm ' + fmt(L.tPre, 0) + ' s' : '') : 'tek dedektör yeterli' },
      { label: 'Tahliye süresi (hesap)', value: VS.fmtDuration(v.evac / 60), level: L.tAlarm === null ? undefined : v.evac > 300 ? 'warn' : 'ok', sub: L.tAlarm === null ? 'algılama henüz yok (0 s alındı)' : 'algılama ' + fmt(L.tAlarm, 0) + ' s + tepki 30 s + ' + fmt(Math.max(v.walk, v.flow), 0) + ' s' },
      { label: 'Yürüme süresi', value: fmt(v.walk, 0, 's'), sub: s.dist + ' m · 1,2 m/s' },
      { label: 'Kapı akış süresi', value: fmt(v.flow, 0, 's'), sub: s.occupants + ' kişi · ' + fmt(s.exitW, 1) + ' m çıkış' },
      { label: 'Dedektör başına alan', value: fmt(v.perDet, 1, 'm²'), sub: L.dets.length + ' dedektör · onaylı yerleşim değil' },
      { label: 'Alarmdaki dedektör', value: L.dets.filter(d => d.alarm).length + ' / ' + L.dets.length, level: p.fired ? 'bad' : undefined, sub: 'panelin değerlendirdiği ' + p.fired },
      { label: 'Tahliye edilen (görsel)', value: evacPeople(s, L) + ' / ' + s.occupants, sub: L.tOut !== null ? 'figürler ' + fmt(L.tOut, 0) + ' s’de dışarıda' : L.tAlarm !== null ? 'tahliye ' + fmt(L.tAlarm + T_RESP, 0) + ' s’de başlar' : 'alarm bekleniyor' }
    ];
    const cv = v.cov || { zones: {}, heightWarn: [] };
    out.push({ label: 'Kapsama (eğitim örneği)', value: ZONES.map(z => z.name.split(' ')[0] + ' %' + fmt((cv.zones[z.id] || 0) * 100, 0)).join(' · '), wide: true,
      level: ZONES.some(z => (cv.zones[z.id] || 0) < 0.6) ? 'warn' : undefined,
      sub: 'Örnek yarıçaplarla hücre oranı; TSE CEN/TS 54-14 uygunluğu değildir' + (cv.heightWarn.length ? ' · ' + cv.heightWarn.map(t => TYPE_NAME[t]).join(', ') + ' için örnek yükseklik sınırı aşıldı' : '') });
    const lm = loopModel(s), worst = Math.max.apply(null, lm.loops.map(l => l.worstShort));
    out.push({ label: 'Adresli döngüler', value: lm.loops.map(l => 'L' + l.l + ' ' + l.n).join(' · ') + ' cihaz', wide: true, level: s.loopFault ? 'warn' : worst > 32 ? 'warn' : 'ok',
      sub: (s.loopFault ? 'Arıza: L' + lm.fl + ' ' + (s.loopFault === 'short' ? 'kısa devre' : 'açık devre') + ' · ' + lm.loops[lm.fl - 1].lost.length + ' cihaz kayıp · ' : '') + 'en kötü tek kısa devrede kayıp ' + worst + ' (bilgi: ≤ 32) · ' + (s.classA !== false ? 'sınıf A' : 'sınıf B (radyal)') });
    const blocked = EXITS.filter(e => L.blocked[e.id] || s.blockExit === e.id);
    const trapped = L.people.filter(p => p.trapped && !p.out).length;
    out.push({ label: 'Çıkışlar', value: blocked.length ? blocked.map(e => e.id).join(', ') + ' kapalı' : 'Tümü açık', level: blocked.length ? 'warn' : 'ok',
      sub: (L.alarmBy ? 'Alarm nedeni: ' + ALARM_BY[L.alarmBy] + ' · ' : '') + (trapped ? trapped + ' figür yol bulamıyor' : 'yol bulma: duman cezalı en kısa yol') });
    const tl = YC.timeline(L.tl).rows;
    if (tl.length) out.push({ label: 'Olay zaman çizelgesi (son 5)', value: tl.slice(-5).map(r => YC.clock(r.t) + ' ' + r.label).join(' → '), wide: true, sub: tl[tl.length - 1].text });
    return out;
  }
  function charts(res, s, L) {
    const v = res.values, H = L.hist;
    const cols = ['red', 'amber', 'cyan', 'violet'];
    const series = L.track.filter(i => L.dets[i]).map((di, j) => { const d = L.dets[di]; return { name: d.id + ' · ' + ZONE[d.zone].name + ' · ' + TYPE_NAME[d.type], color: cols[j], data: H.length ? H.map(h => [h.t, h.r[j]]) : [[0, 0]] }; });
    const types = Array.from(new Set(L.track.filter(i => L.dets[i]).map(i => L.dets[i].type)));
    const tA = L.tAlarm;
    const marks = tA === null ? [] : [{ x: tA, label: 'Alarm', color: '#ef4444' }];
    const last = L.track.map((di, j) => (L.dets[di] ? L.dets[di].id + ' ' + fmt(H.length ? H[H.length - 1].r[j] : 0, 3) : '')).join(', ');
    const ev = [[1, L.tFirst], [2, L.tPre], [3, tA], [4, tA === null ? null : tA + T_RESP], [5, tA === null ? null : v.evac]];
    return [{
      id: 'det', title: 'Yangına en yakın dedektörlerin okuması ve eşikler', height: 170,
      series: series, hLines: types.map(t => ({ y: thr(t, s), label: TYPE_NAME[t] + ' eşiği', color: t === 'isi' ? '#f59e0b' : '#ef4444' })), markers: marks,
      x: { label: 's', min: 0 }, y: { label: 'c', fmt: y => fmt(y, 2) },
      alt: 'Tavan altı duman yoğunluğu (eğitim ölçeği 0–1). Son değerler: ' + last + '. Isı dedektörü değeri ' + TAU_HEAT + ' s gecikmelidir.'
    }, {
      id: 'timeline', title: 'Alarm ve tahliye zaman çizelgesi', type: 'bar',
      series: [{ name: 'Olay zamanı (s)', type: 'bar', color: 'amber', data: ev.map(e => [e[0], e[1] === null ? 0 : e[1]]) }],
      x: { min: 0.4, max: 5.6, ticks: [1, 2, 3, 4, 5], fmt: x => ['', 'Algılama', 'Ön alarm', 'Alarm', 'Tahl. başlar', 'Tahl. biter'][x] || '' }, y: { label: 's' },
      alt: ['İlk algılama', 'Ön alarm', 'Yangın alarmı', 'Tahliye başlangıcı', 'Hesaplanan tahliye sonu'].map((n, i) => n + ' ' + (ev[i][1] === null ? '—' : fmt(ev[i][1], 0) + ' s')).join(', ') + '.'
    }, {
      id: 'evac', title: 'Tahliye edilen kişi (görsel) ve hesaplanan tahliye sonu',
      series: [{ name: 'Dışarıdaki kişi', color: 'green', area: true, data: H.length ? H.map(h => [h.t, h.ev]) : [[0, 0]] }],
      hLines: [{ y: s.occupants, label: s.occupants + ' kişi', color: '#94a3b8' }],
      markers: tA === null ? [] : [{ x: tA, label: 'Alarm', color: '#ef4444' }, { x: v.evac, label: 'Hesap: ' + fmt(v.evac, 0) + ' s', color: '#fcd34d' }],
      x: { label: 's', min: 0 }, y: { label: 'kişi' },
      alt: 'Figürlerin çıkışa ulaşması temsili gösterimdir; tahliye süresi motorun bağıntısından ' + fmt(v.evac, 0) + ' s hesaplanmıştır.'
    }];
  }

  /* ---------------------------------------------------------------- 3D sahne */
  const FY = 0.15; // döşeme üst kotu
  function rebuildOn(s) { return [s.area, s.height, s.sounders, s.nLoops, detSig(s)].join('|'); }

  /** Çekirdek kit ilkelleri ebeveyn verilmezse nesneyi sahneye eklemez; burada varsayılan ebeveyn kök gruptur. */
  function rootKit(k) {
    const r = k.viewer.root;
    return Object.assign({}, k, {
      box: (w, h, d, m, x, y, z, p, o) => k.box(w, h, d, m, x, y, z, p || r, o),
      rbox: (w, h, d, rr, m, x, y, z, p) => k.rbox(w, h, d, rr, m, x, y, z, p || r),
      cyl: (a, b, h, m, x, y, z, p, seg) => k.cyl(a, b, h, m, x, y, z, p || r, seg),
      sphere: (rr, m, x, y, z, p) => k.sphere(rr, m, x, y, z, p || r),
      screen: (pw, ph, px, draw, p, o) => k.screen(pw, ph, px, draw, p || r, o)
    });
  }

  function build(k0, s, app) {
    const k = rootKit(k0);
    const T = k.T, M = k.mats, v = k.viewer;
    const G = geo(s), cs = G.cs, W = G.W, D = G.D, H = G.H;
    const X = gx => gx * cs - W / 2, Z = gy => gy * cs - D / 2;
    const sc = { G: G, dets: [], beams: [], clock: 0, panelT: 0, zl: {} };
    app.scene3 = sc;
    const R = rng(42);
    // saha ve döşeme
    k.ground(Math.max(W, D) * 5, M.asphalt, 0);
    k.box(W + 1.2, FY, D + 1.2, M.concrete, 0, FY / 2, 0);
    const epoxy = new T.MeshStandardMaterial({ color: 0x5c7468, roughness: 0.32, metalness: 0.05 });
    k.box(19 * cs, 0.012, 24 * cs, epoxy, X(30.5), FY + 0.006, 0);
    k.box(12 * cs, 0.012, 8 * cs, new T.MeshStandardMaterial({ color: 0x8b7b66, roughness: 0.7 }), X(6), FY + 0.006, Z(20));
    k.box(7 * cs, 0.012, 8 * cs, new T.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.4 }), X(16.5), FY + 0.006, Z(20));
    // depo koridor çizgileri (sarı)
    [2, 4, 6, 8, 10, 12].forEach(gy => k.box(16 * cs, 0.004, 0.1, M.plasticYellow, X(10), FY + 0.004, Z(gy) + (gy % 4 === 2 ? -0.15 : 0.15), null, { noShadow: true }));

    // dış duvarlar: arka ve sol tam yükseklik, ön ve sağ kesit (alçak) — içerisi görünsün
    const Hw = H + 1.1, t = 0.2;
    const shells = [];
    function wall(axis, fixed, a0, a1, h, opens, mat) {
      let cur = a0; const list = (opens || []).slice().sort((p, q) => p.c - q.c);
      const seg = (p0, p1, y0, hh) => { if (p1 - p0 < 1e-3 || hh <= 0) return; const L = p1 - p0, c = (p0 + p1) / 2; const m = axis === 'x' ? k.box(L, hh, t, mat, c, y0 + hh / 2, fixed) : k.box(t, hh, L, mat, fixed, y0 + hh / 2, c); shells.push(m); };
      list.forEach(o => { seg(cur, o.c - o.w / 2, FY, h); if (o.h < h) seg(o.c - o.w / 2, o.c + o.w / 2, FY + o.h, h - o.h); cur = o.c + o.w / 2; });
      seg(cur, a1, FY, h);
    }
    const opening = e => ({ c: e.side === 'right' ? Z(e.gy) : X(e.gx), w: e.w, h: e.h });
    wall('x', -D / 2 - t / 2, -W / 2 - t, W / 2 + t, Hw, EXITS.filter(e => e.side === 'back').map(opening), M.wallPanel);
    wall('z', -W / 2 - t / 2, -D / 2, D / 2, Hw, [], M.wallPanel);
    const low = 1.2;
    wall('x', D / 2 + t / 2, -W / 2 - t, W / 2 + t, low, EXITS.filter(e => e.side === 'front').map(opening).map(o => Object.assign(o, { h: 99 })), M.wallPanel);
    wall('z', W / 2 + t / 2, -D / 2, D / 2, low, EXITS.filter(e => e.side === 'right').map(opening).map(o => Object.assign(o, { h: 99 })), M.wallPanel);
    // kesit başlığı (kesilmiş duvar üstü) ve beton subasman
    k.box(W + 2 * t, 0.03, t + 0.02, M.concreteDark, 0, FY + low + 0.015, D / 2 + t / 2);
    k.box(t + 0.02, 0.03, D, M.concreteDark, W / 2 + t / 2, FY + low + 0.015, 0);
    k.box(W + 2 * t + 0.02, 0.45, 0.03, M.concreteDark, 0, FY + 0.225, -D / 2 - t - 0.01);
    k.box(0.03, 0.45, D, M.concreteDark, -W / 2 - t - 0.01, FY + 0.225, 0);
    shells.forEach(m => k.shell(m));

    // çelik taşıyıcı: kolonlar, kafes kirişler (InstancedMesh), aşıklar
    const nF = Math.max(3, Math.round(W / 7.5) + 1), xs = [];
    for (let i = 0; i < nF; i++) xs.push(-W / 2 + 0.2 + i * (W - 0.4) / (nF - 1));
    const TD = Math.min(1.2, 0.9 + H * 0.02);
    xs.forEach(x => { [-D / 2 + 0.2, D / 2 - 0.2].forEach(z => k.box(0.28, H + TD, 0.3, M.darkSteel, x, FY + (H + TD) / 2, z)); });
    const webGeo = new T.BoxGeometry(1, 1, 1), nPan = Math.max(6, Math.round(D / 1.6));
    const web = new T.InstancedMesh(webGeo, M.galv, xs.length * (nPan * 2 + 2) + xs.length * 2);
    web.castShadow = true; web.receiveShadow = true;
    const dm = new T.Object3D(); let wi = 0;
    const put = (x, y, z, sx, sy, sz, rx) => { dm.position.set(x, y, z); dm.rotation.set(rx || 0, 0, 0); dm.scale.set(sx, sy, sz); dm.updateMatrix(); web.setMatrixAt(wi++, dm.matrix); };
    xs.forEach(x => {
      put(x, FY + H, 0, 0.14, 0.14, D, 0); put(x, FY + H + TD, 0, 0.14, 0.14, D, 0); // alt ve üst başlık
      const p = D / nPan;
      for (let j = 0; j <= nPan; j++) { const z = -D / 2 + j * p; put(x, FY + H + TD / 2, z, 0.07, TD, 0.07, 0); }
      for (let j = 0; j < nPan; j++) { const z = -D / 2 + (j + 0.5) * p, len = Math.hypot(p, TD); put(x, FY + H + TD / 2, z, 0.06, len, 0.06, (j % 2 ? 1 : -1) * Math.atan2(p, TD)); }
    });
    web.count = wi; web.instanceMatrix.needsUpdate = true; v.root.add(web);
    for (let z = -D / 2 + 0.3; z <= D / 2; z += 2.2) k.box(W, 0.14, 0.08, M.galv, 0, FY + H + TD + 0.07, z);
    // çatı kaplaması: yalnız arka şerit (kesit görünüm); şeffaf/patlatma ile açılır
    const roof = k.group(null, 0, 0, 0);
    const rd = D * 0.36;
    k.box(W + 0.5, 0.1, rd, M.roofSheet, 0, FY + H + TD + 0.19, -D / 2 + rd / 2, roof);
    const ribG = new T.BoxGeometry(0.05, 0.05, rd), nr = Math.floor(W / 0.5), ribs = new T.InstancedMesh(ribG, M.roofSheet, nr);
    for (let i = 0; i < nr; i++) { dm.position.set(-W / 2 + 0.25 + i * 0.5, FY + H + TD + 0.265, -D / 2 + rd / 2); dm.rotation.set(0, 0, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); ribs.setMatrixAt(i, dm.matrix); }
    ribs.castShadow = true; roof.add(ribs);
    k.shell(roof); k.explodable(roof, [0, Math.max(4, H * 0.6), -1]);
    k.pickable(roof.children[0], 'Çatı (kesit)', () => ['Sandviç panel çatı; kesit görünüm için yalnız arka şerit gösterilir.', 'Duman tavan altında birikir: noktasal dedektörler tavan seviyesindedir.', 'Tavan yüksekliği ' + fmt(H, 1, 'm') + (H > 12 ? ' — noktasal duman dedektörü etkinliği düşebilir.' : '')]);

    // bölme duvarları (duman modelindeki engel hücreleriyle aynı)
    const part = [];
    const pz = (y0, y1, gx) => part.push(k.box(0.16, H, (y1 - y0) * cs, M.wallPanel, X(gx + 0.5), FY + H / 2, Z((y0 + y1) / 2)));
    pz(0, 5, 20); pz(9, 24, 20); pz(16, 24, 12);
    part.push(k.box(20 * cs, H, 0.16, M.wallPanel, X(10), FY + H / 2, Z(15.5)));
    part.forEach(m => k.shell(m));
    const doorMat = new T.MeshStandardMaterial({ color: 0x9b2c2c, metalness: 0.4, roughness: 0.45 });
    [-1, 1].forEach(sd => {
      k.box(0.05, 2.1, 1.0, doorMat, X(20.5) + sd * 0.1, FY + 1.05, Z(20.5));
      k.box(1.0, 2.1, 0.05, M.plasticGrey, X(8.5), FY + 1.05, Z(15.5) + sd * 0.1);
    });
    // depo–üretim açık geçişi: sarılmış kepenk ve tehlike bandı
    const drum = k.cyl(0.22, 0.22, 4 * cs, M.galv, X(20.5), FY + H - 0.3, Z(7)); drum.rotation.x = Math.PI / 2;
    [5, 9].forEach(gy => k.box(0.2, 1.4, 0.05, M.plasticYellow, X(20.5), FY + 0.7, Z(gy) + (gy === 5 ? 0.04 : -0.04)));

    buildRacks(k, s, G, X, Z, R);
    buildProduction(k, G, X, Z);
    buildOffice(k, G, X, Z);
    buildElectric(k, G, X, Z);
    buildPanel(k, s, G, X, Z, app, sc);
    buildExits(k, G, X, Z, sc);
    buildSounders(k, s, G, X, Z, sc, app);
    buildDetectors(k, s, G, X, Z, sc, app);
    buildPlacement(k, s, G, X, Z, sc);
    buildCoverage(k, s, G, X, Z, sc);
    buildLoops(k, s, G, X, Z, sc);
    buildSmoke(k, G, sc);
    buildFire(k, G, sc, app);
    buildPeople(k, sc);

    // bölge etiketleri
    ZONES.forEach(z => { sc.zl[z.id] = k.label(z.name, null, [X((z.x0 + z.x1 + 1) / 2), FY + H + TD + 0.4, Z((z.y0 + z.y1 + 1) / 2)]); });

    app.def.scene.bounds = [-W / 2 - 0.6, W / 2 + 0.6];
    const span = Math.max(W, D);
    v.setView({ target: [W * 0.02, FY + H * 0.28, D * 0.04], r: span * 1.02 + H * 1.1 + 4, theta: 0.5, phi: 0.72, limits: { rMin: 2.5, rMax: span * 3 + 20 } });
    v.setShadowBox(span * 0.72 + 4, span * 4 + 80);
    v.sun.position.set(W * 0.35, span * 0.9 + 20, D * 0.75);
  }

  /* depo: çift sıra palet rafları (dikme, kiriş, palet yükleri InstancedMesh) */
  function buildRacks(k, s, G, X, Z, R) {
    const T = k.T, M = k.mats, cs = G.cs;
    const rows = [2, 6, 10], L = 16 * cs, d = 2 * cs * 0.86;
    const rackH = Math.max(2.2, Math.min(G.H - 1.4, 7.5)), lev = Math.max(2, Math.floor(rackH / 1.5)), lh = rackH / lev;
    const bays = Math.max(3, Math.round(L / 2.7)), bw = L / bays;
    const upMat = new T.MeshStandardMaterial({ color: 0x1f4e9a, metalness: 0.5, roughness: 0.45 });
    const bmMat = new T.MeshStandardMaterial({ color: 0xe0661b, metalness: 0.4, roughness: 0.5 });
    const wood = new T.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.9 });
    const cargo = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const box1 = new T.BoxGeometry(1, 1, 1);
    const nUp = rows.length * (bays + 1) * 3, nBm = rows.length * bays * (lev - 1) * 2 * 2, nPal = rows.length * bays * lev * 4;
    const up = new T.InstancedMesh(box1, upMat, nUp), bm = new T.InstancedMesh(box1, bmMat, nBm), pal = new T.InstancedMesh(box1, wood, nPal), car = new T.InstancedMesh(box1, cargo, nPal);
    const dm = new T.Object3D(), col = new T.Color();
    let iu = 0, ib = 0, ip = 0;
    const set = (im, i, x, y, z, sx, sy, sz) => { dm.position.set(x, y, z); dm.scale.set(sx, sy, sz); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); };
    const shades = [0xc8a36b, 0xb88f55, 0xd9c29a, 0x9fb7c9, 0xe8e2d4, 0xa86b3c];
    rows.forEach(gy => {
      const zc = Z(gy + 1), x0 = X(2);
      for (let b = 0; b <= bays; b++) [-d / 2, 0, d / 2].forEach(dz => set(up, iu++, x0 + b * bw, FY + rackH / 2, zc + dz, 0.09, rackH, 0.09));
      for (let b = 0; b < bays; b++) {
        for (let l = 1; l < lev; l++) [-d / 2, d / 2].forEach(dz => { set(bm, ib++, x0 + (b + 0.5) * bw, FY + l * lh, zc + dz, bw - 0.1, 0.12, 0.06); set(bm, ib++, x0 + (b + 0.5) * bw, FY + l * lh, zc + dz * 0.02, bw - 0.1, 0.1, 0.05); });
        for (let l = 0; l < lev; l++) for (let q = 0; q < 2; q++) for (let hh = 0; hh < 2; hh++) {
          if (R() < 0.14) continue;
          const px = x0 + (b + 0.27 + q * 0.46) * bw, pz = zc + (hh ? 1 : -1) * d / 4, py = FY + l * lh + 0.07;
          const pw = Math.min(1.1, bw * 0.4), pd = Math.min(1.0, d * 0.42), ch = Math.min(1.15, lh - 0.32) * (0.75 + R() * 0.25);
          set(pal, ip, px, py + 0.07, pz, pw, 0.14, pd);
          set(car, ip, px, py + 0.14 + ch / 2, pz, pw * 0.96, ch, pd * 0.96);
          car.setColorAt(ip, col.setHex(shades[Math.floor(R() * shades.length)])); ip++;
        }
      }
    });
    [up, bm, pal, car].forEach(im => { im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.needsUpdate = true; k.viewer.root.add(im); });
    up.count = iu; bm.count = ib; pal.count = ip; car.count = ip; if (car.instanceColor) car.instanceColor.needsUpdate = true;
    k.pickable(up, 'Palet rafları (Depo A)', () => ['Yüksek raf: ' + fmt(rackH, 1, 'm') + ', ' + lev + ' kat, ' + rows.length + ' çift sıra', 'Raf arası duman tavan altında yayılır; raflar duman modelinde engel sayılmaz (sadeleştirme).', 'Yüksek raflı depolarda ışın tipi veya aspirasyonlu algılama ve sprinkler ayrıca değerlendirilir.']);
  }

  /* üretim: tezgâhlar ve konveyör */
  function buildProduction(k, G, X, Z) {
    const M = k.mats, cs = G.cs;
    [[25, 4, 'CNC tezgâhı 1'], [31, 4, 'CNC tezgâhı 2'], [36.5, 4, 'Pres'], [25, 13.5, 'Kaynak hücresi'], [34.5, 15.8, 'Boya kabini']].forEach((m, i) => {
      const g = k.group(null, X(m[0]), FY, Z(m[1]));
      const w = Math.min(3.2, 3 * cs), d = Math.min(2.2, 2 * cs), h = i === 4 ? 2.6 : 2.0;
      k.rbox(w, h, d, 0.05, M.panelRAL7035, 0, h / 2, 0, g);
      k.box(w * 0.5, h * 0.4, 0.03, M.plasticDark, -w * 0.12, h * 0.6, d / 2 + 0.01, g);
      k.box(w * 0.92, 0.08, d * 0.92, M.plasticYellow, 0, h + 0.04, 0, g);
      k.box(0.3, 0.45, 0.16, M.panelDark, w / 2 + 0.2, 1.3, 0, g);
      k.pickable(g, m[2], () => ['Üretim alanı ekipmanı (bağlam için).', 'Toz, yağ buharı veya kaynak dumanı optik dedektörde istenmeyen alarma yol açabilir; bu tür alanlarda ısı veya çok sensörlü dedektör değerlendirilir.']);
    });
    // konveyör
    const L = 14 * cs, x0 = X(23.5), z = Z(19.5);
    k.box(L, 0.08, 0.9, M.rubber, x0 + L / 2, FY + 0.85, z);
    k.box(L, 0.12, 0.05, M.galv, x0 + L / 2, FY + 0.82, z - 0.47); k.box(L, 0.12, 0.05, M.galv, x0 + L / 2, FY + 0.82, z + 0.47);
    for (let x = 0.3; x < L; x += 2) [-0.4, 0.4].forEach(dz => k.box(0.06, 0.8, 0.06, M.galv, x0 + x, FY + 0.4, z + dz));
  }
  /* ofis: masa grupları */
  function buildOffice(k, G, X, Z) {
    const M = k.mats;
    [2.5, 5.8, 9.1].forEach(gx => [18.2, 21.3].forEach(gy => {
      const g = k.group(null, X(gx), FY, Z(gy));
      k.box(1.5, 0.04, 0.75, M.plasticWhite, 0, 0.74, 0, g);
      [-0.7, 0.7].forEach(dx => k.box(0.05, 0.72, 0.68, M.plasticGrey, dx, 0.36, 0, g));
      k.box(0.55, 0.34, 0.03, M.plasticDark, 0, 0.97, -0.25, g);
      k.cyl(0.24, 0.24, 0.08, M.plasticDark, 0, 0.48, 0.55, g, 14);
      k.box(0.45, 0.5, 0.06, M.plasticDark, 0, 0.78, 0.78, g);
    }));
  }
  /* elektrik odası: dağıtım panoları ve kablo tavası */
  function buildElectric(k, G, X, Z) {
    const M = k.mats;
    const n = 5, x0 = X(13.4);
    for (let i = 0; i < n; i++) {
      const g = k.group(null, x0 + 0.42 + i * 0.84, FY, Z(23.6) - 0.35);
      k.box(0.8, 2.1, 0.6, M.panelRAL7035, 0, 1.05, 0, g);
      k.box(0.02, 0.15, 0.03, M.plasticDark, 0.33, 1.1, 0.31, g);
      k.box(0.12, 0.08, 0.01, M.plasticWhite, 0, 1.85, 0.305, g);
      if (i === 0) k.pickable(g, 'Elektrik dağıtım panoları', () => ['Elektrik odası ayrı yangın bölmesi gibi kapalı kapı ile ayrılmıştır (duman modelinde kapı kapalı).', 'Pano içi aşırı ısınma ve ark: erken algılama için optik veya aspirasyonlu algılama tercih edilir.']);
    }
    k.box(n * 0.84, 0.06, 0.4, M.galv, x0 + n * 0.42, FY + 2.6, Z(23.6) - 0.35);
  }

  /* yangın algılama ve uyarı kontrol paneli (ana giriş yanında, arka duvar iç yüzü) */
  function buildPanel(k, s, G, X, Z, app, sc) {
    const M = k.mats;
    const g = k.group(null, X(33.6), FY + 1.55, Z(0) + 0.1);
    k.rbox(0.6, 0.48, 0.14, 0.02, M.plasticRed, 0, 0, 0.07, g);
    const cover = k.group(g, 0, 0, 0);
    k.box(0.52, 0.4, 0.01, M.plasticDark, 0, 0, 0.145, cover);
    const scr = k.screen(0.34, 0.17, 512, (gx, w, h) => drawPanel(gx, w, h, app), cover, { emissive: 0.9 });
    scr.position.set(-0.05, 0.07, 0.152);
    sc.panelScr = scr;
    sc.panelLeds = [0, 1, 2, 3].map(i => k.sphere(0.011, M.ledOff, 0.18, 0.13 - i * 0.05, 0.152, cover));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) k.box(0.03, 0.022, 0.012, M.plasticGrey, -0.16 + c * 0.04, -0.09 - r * 0.032, 0.152, cover);
    k.explodable(cover, [0, 0, 0.35]);
    k.pickable(g, 'Yangın algılama ve uyarı kontrol paneli', () => {
      const L = app.live, p = L.panel;
      return ['Durum: ' + MODE_TEXT[p.mode] + (L.silenced ? ' (sirenler susturuldu)' : ''), 'Alarmdaki dedektör (değerlendirilen): ' + p.fired + ' · arıza: ' + p.faults, 'Çift dedektör onayı: ' + (app.state.coincidence ? 'açık — tek dedektör ön alarm verir' : 'kapalı'), 'Adresli panel: ' + loopModel(app.state).nL + ' döngü, ' + loopModel(app.state).devs.length + ' adres' + (app.state.loopFault ? ' · DÖNGÜ ARIZASI' : '') + '.', 'TS EN 54-2 yangın alarm, arıza uyarısı ve devre dışı durumlarının eğitim temsili.'];
    }, a => {
      const L = a.live, acts = [];
      if (L.panel.mode === 'fire' && !L.silenced) acts.push({ label: 'Sirenleri sustur', variant: 'warn', onClick: silence });
      acts.push({ label: 'Paneli sıfırla', onClick: resetPanel });
      if (!a.state.loopFault) { acts.push({ label: 'L' + (a.state.faultLoop || 1) + ' kısa devre', variant: 'warn', onClick: x => setLoopFault(x, 'short') }); acts.push({ label: 'L' + (a.state.faultLoop || 1) + ' kablo kopması', variant: 'warn', onClick: x => setLoopFault(x, 'open') }); }
      if (L.panel.faults) acts.push({ label: 'Arızaları gider', variant: 'primary', onClick: clearFaults });
      if (a.state.disableZone) acts.push({ label: ZONE[a.state.disableZone].name + ' bölgesini devreye al', onClick: x => toggleZone(x, x.state.disableZone) });
      return acts;
    });
    k.label('Kontrol paneli', g, [0, 0.4, 0.1], 'vs-label--sm');
  }
  function drawPanel(g, w, h, app) {
    const L = app && app.live; const p = L ? L.panel : { mode: 'normal', zones: [], fired: 0, faults: 0 };
    const fire = p.mode === 'fire', blink = fire && Math.floor((L.t || 0) * 2 + (app.scene3 ? app.scene3.clock * 2 : 0)) % 2 === 0;
    g.fillStyle = fire ? (blink ? '#3b0909' : '#1c0606') : '#06141f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7dd3fc'; g.font = 'bold 26px monospace'; g.fillText('YANGIN ALGILAMA PANELİ', 16, 34);
    const col = { normal: '#4ade80', prealarm: '#fbbf24', fire: '#f87171', fault: '#fbbf24' }[p.mode];
    g.fillStyle = col; g.font = 'bold 46px monospace'; g.fillText(MODE_TEXT[p.mode].toUpperCase().slice(0, 18), 16, 96);
    const nDis = L ? L.dets.filter(d => d.zone === app.state.disableZone).length : 0;
    g.font = 'bold 20px monospace'; g.fillStyle = '#94a3b8';
    g.fillText('ARIZA ' + p.faults + '  D.DIŞI ' + nDis + '  t=' + fmt(L ? L.t : 0, 0) + 's' + (L && L.silenced ? '  SUSTURULDU' : ''), 16, 128);
    // adresli olay listesi: en yeni üstte (tip · adres · bölge)
    const ev = ((L && L.plog) || []).slice(-3).reverse();
    g.font = 'bold 21px monospace';
    if (!ev.length) { g.fillStyle = '#4ade80'; g.fillText('OLAY YOK · SİSTEM NORMAL', 16, 168); }
    ev.forEach((e, i) => { g.fillStyle = e.type === 'ARIZA' ? '#fbbf24' : e.type === 'ALARM' || e.type === 'İHBAR' ? '#f87171' : '#e2e8f0'; g.fillText((e.type + ' ' + e.addr + ' ' + (e.zone || '')).slice(0, 36), 16, 164 + i * 32); });
  }

  /* çıkış işaretleri ve yangın ihbar butonları */
  function buildExits(k, G, X, Z, sc) {
    const M = k.mats;
    const sign = (parent, x, y, z, ry) => {
      const m = k.screen(0.44, 0.17, 256, (g, w, h) => {
        g.fillStyle = '#0f8a3c'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 6; g.lineCap = 'round';
        // koşan figür piktogramı
        g.beginPath(); g.arc(40, 22, 9, 0, 7); g.fill();
        g.beginPath(); g.moveTo(36, 34); g.lineTo(30, 58); g.lineTo(16, 78); g.moveTo(30, 58); g.lineTo(46, 74); g.lineTo(44, 92); g.moveTo(34, 40); g.lineTo(52, 50); g.moveTo(34, 40); g.lineTo(18, 46); g.stroke();
        g.font = 'bold 40px Arial'; g.textBaseline = 'middle'; g.fillText('ACİL ÇIKIŞ', 72, h / 2 + 2);
      }, parent, { emissive: 1.1 });
      m.position.set(x, y, z); m.rotation.y = ry; return m;
    };
    const mcp = (x, y, z, ry, e) => {
      const g = k.group(null, x, y, z); g.rotation.y = ry;
      k.box(0.1, 0.1, 0.05, M.plasticRed, 0, 0, 0.025, g);
      k.box(0.06, 0.06, 0.006, M.plasticWhite, 0, 0, 0.052, g);
      k.pickable(g, 'Yangın ihbar butonu · ' + e.name, x => ['Elle ihbar (kır-bas tipi). Basılınca panel çift dedektör onayı beklemeden yangın alarmına geçer.', 'Durum: ' + (x.live.mcp ? 'BASILI — panel sıfırlanınca anahtarla kurulur' : 'normal')], a => [a.live.mcp ? { label: 'Paneli sıfırla ve butonu kur', onClick: resetPanel } : { label: 'İhbar butonuna bas', variant: 'danger', onClick: x => pressMcp(x, e.id) }]);
    };
    EXITS.forEach(e => {
      if (e.side === 'back') {
        sign(null, X(e.gx), FY + e.h + 0.3, Z(0) + 0.02, 0);
        mcp(X(e.gx) + e.w / 2 + 0.5, FY + 1.4, Z(0) + 0.0, 0, e);
        // kapı kanadı (açık) ve eşik
        k.box(e.w, 0.04, 0.4, M.concreteDark, X(e.gx), FY + 0.02, Z(0) - 0.1);
      } else if (e.side === 'front') {
        const px = X(e.gx) + e.w / 2 + 0.35, pz = Z(24) - 0.25;
        k.box(0.08, 2.6, 0.08, M.darkSteel, px, FY + 1.3, pz);
        sign(null, px - 0.25, FY + 2.45, pz - 0.05, Math.PI);
        mcp(px, FY + 1.4, pz - 0.04, Math.PI, e);
      } else {
        const px = X(GW) - 0.25, pz = Z(e.gy) - e.w / 2 - 0.35;
        k.box(0.08, 2.6, 0.08, M.darkSteel, px, FY + 1.3, pz);
        sign(null, px - 0.05, FY + 2.45, pz + 0.25, -Math.PI / 2);
        mcp(px - 0.04, FY + 1.4, pz, -Math.PI / 2, e);
      }
    });
    void sc;
  }

  /* siren / flaşörler: duvara montaj aday noktaları (öncelik sırası) */
  function sounderSpots(G, X, Z) {
    const H = Math.min(2.7, G.H - 0.3);
    return [
      [X(25), Z(0) + 0.02, 0], [X(9), Z(0) + 0.02, 0], [X(4), Z(15.5) + 0.1, 0], [X(12.5) + 0.1, Z(19), Math.PI / 2],
      [X(20.5) + 0.1, Z(17), Math.PI / 2], [X(0) + 0.02, Z(8), Math.PI / 2], [X(37), Z(0) + 0.02, 0], [X(20.5) - 0.1, Z(12), -Math.PI / 2],
      [X(16), Z(0) + 0.02, 0], [X(20.5) + 0.1, Z(3), Math.PI / 2], [X(0) + 0.02, Z(20), Math.PI / 2], [X(14), Z(15.5) - 0.1, Math.PI], [X(20.5) + 0.1, Z(22.5), Math.PI / 2]
    ].map(p => ({ x: p[0], z: p[1], ry: p[2], y: FY + H }));
  }
  function buildSounders(k, s, G, X, Z, sc, app) {
    const T = k.T, M = k.mats;
    sc.beacon = new T.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.3, transparent: true, opacity: 0.92 });
    sounderSpots(G, X, Z).slice(0, Math.round(s.sounders)).forEach((p, i) => {
      const g = k.group(null, p.x, p.y, p.z); g.rotation.y = p.ry;
      const base = k.cyl(0.075, 0.08, 0.07, M.plasticRed, 0, 0, 0.04, g, 18); base.rotation.x = Math.PI / 2;
      const lens = k.cyl(0.05, 0.055, 0.06, sc.beacon, 0, 0, 0.1, g, 16); lens.rotation.x = Math.PI / 2;
      (sc.lens || (sc.lens = []))[i] = lens;
      k.pickable(g, 'Siren / flaşör ' + (i + 1) + ' · ' + addrOf(s, 'snd', i), () => {
        const lost = loopModel(app.state).lostSnd.has(i);
        return ['Adresli sesli/ışıklı uyarı cihazı (TS EN 54-3 / TS EN 54-23 ürün standartları), adres ' + addrOf(app.state, 'snd', i) + '.',
          'Durum: ' + (lost ? 'DÖNGÜ ARIZASI — panelle haberleşemiyor, çalmaz' : app.live.panel.mode === 'fire' ? (app.live.silenced ? 'siren susturuldu, flaşör yanıyor' : 'çalıyor') : 'sessiz'), 'Ses düzeyi ve görünürlük kapsaması projede ayrıca doğrulanır.'];
      });
    });
  }

  /* dedektörler: noktasal (optik/ısı) InstancedMesh ile çizilir; seçim için her dedektörde görünmez vekil kutu
   * (malzeme görünmez, ışın testi çalışır) bulunur. Işın tipi dedektörler ayrı nesnelerdir. Sayı sınırı yoktur. */
  function buildDetectors(k, s, G, X, Z, sc, app) {
    const T = k.T, M = k.mats;
    const yC = FY + G.H;
    const ledG = new T.SphereGeometry(0.009, 8, 6);
    const list = detLayout(s), pts = [];
    sc.dets = [];
    list.forEach((d, i) => {
      if (d.type === 'beam') {
        const y = yC - 0.45, z = Z(d.gy + 0.5);
        const tx = k.group(null, X(0) + 0.08, y, z), rx = k.group(null, X(20.5) - 0.16, y, z);
        k.box(0.12, 0.16, 0.12, M.plasticWhite, 0, 0, 0, tx); k.box(0.04, 0.2, 0.2, M.plasticDark, 0, 0, 0, rx);
        const led = new T.Mesh(ledG, M.ledOff); led.position.set(0.065, 0.05, 0); tx.add(led);
        const len = X(20.5) - 0.16 - (X(0) + 0.08);
        const bm = new T.MeshBasicMaterial({ color: 0xff5555, transparent: true, opacity: 0.18, depthWrite: false });
        const line = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, len, 6), bm); line.rotation.z = Math.PI / 2; line.position.set(X(0) + 0.08 + len / 2, y, z); k.viewer.root.add(line);
        sc.dets[i] = { led: led, beam: bm };
        k.pickable(tx, () => d.id + ' · ' + addrOf(app.state, 'det', d.id) + ' · ışın tipi (' + ZONE[d.zone].name + ')', () => detInfo(app, i), a => detActions(a, i));
        return;
      }
      pts.push(i);
    });
    // InstancedMesh: gövde, alt hazne/uç, askı ve LED (LED renkleri her karede instanceColor ile)
    const n = Math.max(1, pts.length), dm = new T.Object3D();
    const im = (geo, mat, cnt) => { const m = new T.InstancedMesh(geo, mat, Math.max(1, cnt)); m.castShadow = true; m.receiveShadow = false; k.viewer.root.add(m); return m; };
    const nOpt = pts.filter(i => list[i].type === 'optik').length, nHeat = pts.length - nOpt;
    const optB = im(new T.CylinderGeometry(0.055, 0.06, 0.045, 20), M.plasticWhite, nOpt), optC = im(new T.CylinderGeometry(0.042, 0.046, 0.024, 20), M.plasticWhite, nOpt);
    const heatB = im(new T.CylinderGeometry(0.05, 0.055, 0.035, 18), M.plasticWhite, nHeat), heatT = im(new T.CylinderGeometry(0.012, 0.02, 0.03, 10), M.plasticDark, nHeat);
    const rods = im(new T.CylinderGeometry(0.008, 0.008, 0.25, 6), M.galv, n);
    const leds = new T.InstancedMesh(ledG, new T.MeshBasicMaterial({ color: 0xffffff }), n); leds.castShadow = false; k.viewer.root.add(leds);
    leds.instanceColor = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const put = (m, j, x, y, z) => { dm.position.set(x, y, z); dm.updateMatrix(); m.setMatrixAt(j, dm.matrix); };
    const proxyGeo = new T.BoxGeometry(0.2, 0.16, 0.2), proxyMat = new T.MeshBasicMaterial({ visible: false });
    let io = 0, ih = 0;
    pts.forEach((i, j) => {
      const d = list[i], x = X(d.gx + 0.5), z = Z(d.gy + 0.5);
      put(rods, j, x, yC + 0.12, z);
      if (d.type === 'optik') { put(optB, io, x, yC - 0.02, z); put(optC, io, x, yC - 0.055, z); io++; }
      else { put(heatB, ih, x, yC - 0.018, z); put(heatT, ih, x, yC - 0.05, z); ih++; }
      put(leds, j, x + 0.045, yC - 0.04, z);
      const px = new T.Mesh(proxyGeo, proxyMat); px.position.set(x, yC - 0.03, z); px.castShadow = false; px.userData.noClip = true; k.viewer.root.add(px);
      sc.dets[i] = { inst: j };
      k.pickable(px, () => d.id + ' · ' + addrOf(app.state, 'det', d.id) + ' · ' + TYPE_NAME[d.type] + ' (' + ZONE[d.zone].name + ')' + (d.auto ? '' : ' · elle eklendi'), () => detInfo(app, i), a => detActions(a, i));
    });
    [optB, optC, heatB, heatT, rods, leds].forEach(m => { m.instanceMatrix.needsUpdate = true; });
    optB.count = optC.count = io; heatB.count = heatT.count = ih; rods.count = leds.count = pts.length;
    sc.detLeds = leds;
    sc.ledCol = { green: new T.Color(0x22e07a).convertSRGBToLinear(), red: new T.Color(0xff3030).convertSRGBToLinear(), amber: new T.Color(0xf59e0b).convertSRGBToLinear(), off: new T.Color(0x2a323b) };
  }
  /** Yerleştirme: yerleştirme modunda tavanda ızgaralı saydam düzlem. Tıklanan hücre ışın testiyle bulunur
   * (imleç konumu kaydedilir); boş hücrede “Dedektör ekle”, dolu hücrede “Kaldır”. Sayı sınırı yoktur. */
  const PTR = { x: 0, y: 0, ok: false };
  function buildPlacement(k, s, G, X, Z, sc) {
    const T = k.T, yC = FY + G.H - 0.005, v = k.viewer;
    const cv = document.createElement('canvas'); cv.width = GW * 16; cv.height = GH * 16;
    const g = cv.getContext('2d'); g.strokeStyle = 'rgba(56,189,248,.75)'; g.lineWidth = 1.5;
    for (let x = 0; x <= GW; x++) { g.beginPath(); g.moveTo(x * 16, 0); g.lineTo(x * 16, GH * 16); g.stroke(); }
    for (let y = 0; y <= GH; y++) { g.beginPath(); g.moveTo(0, y * 16); g.lineTo(GW * 16, y * 16); g.stroke(); }
    g.fillStyle = 'rgba(203,213,225,.55)';
    for (let i = 0; i < WALLS.length; i++) if (WALLS[i]) g.fillRect((i % GW) * 16, Math.floor(i / GW) * 16, 16, 16);
    const tex = new T.CanvasTexture(cv);
    const plane = new T.Mesh(new T.PlaneGeometry(G.W, G.D), new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide }));
    plane.rotation.x = -Math.PI / 2; plane.position.y = yC; plane.renderOrder = 7; plane.visible = !!s.placeMode; plane.castShadow = false; plane.receiveShadow = false;
    v.root.add(plane); sc.place = plane;
    if (!v.canvas.dataset.vsPtr) {
      v.canvas.dataset.vsPtr = '1';
      v.canvas.addEventListener('pointerdown', e => { const r = v.canvas.getBoundingClientRect(); PTR.x = (e.clientX - r.left) / r.width * 2 - 1; PTR.y = -(e.clientY - r.top) / r.height * 2 + 1; PTR.ok = true; });
    }
    const rc = new T.Raycaster();
    const cell = () => {
      if (!PTR.ok) return null;
      rc.setFromCamera(new T.Vector2(PTR.x, PTR.y), v.camera);
      const h = rc.intersectObject(plane, false)[0]; if (!h) return null;
      const gx = Math.floor((h.point.x + G.W / 2) / G.cs), gy = Math.floor((h.point.z + G.D / 2) / G.cs);
      return gx >= 0 && gy >= 0 && gx < GW && gy < GH ? [gx, gy] : null;
    };
    const at = (app, c) => c && app.live.dets.find(d => d.type !== 'beam' && d.gx === c[0] && d.gy === c[1]);
    k.pickable(plane, a => { const c = cell(); return c ? 'Tavan hücresi (' + c[0] + ', ' + c[1] + ')' : 'Tavan ızgarası'; },
      a => { const c = cell(); if (!c) return ['Yerleştirme modu: tavan ızgarasında bir hücreye tıklayın.']; const d = at(a, c); return d ? ['Bu hücrede ' + d.id + ' (' + addrOf(a.state, 'det', d.id) + ') var.'].concat(detInfo(a, a.live.dets.indexOf(d))) : slotInfo(a, c[0], c[1]); },
      a => { const c = cell(); if (!c) return [{ label: 'Yerleştirme modunu kapat', onClick: x => { x.state.placeMode = false; } }]; const d = at(a, c);
        return d ? [{ label: 'Kaldır (' + d.id + ')', variant: 'danger', onClick: x => removeDet(x, d.id) }] : WALLS[c[1] * GW + c[0]] ? [{ label: 'Duvar hücresi', onClick: () => VS.toast('Duvara dedektör yerleştirilemez.') }] : [{ label: 'Dedektör ekle', variant: 'primary', onClick: x => addDet(x, c[0], c[1]) }]; });
  }
  /** Adresli döngü kabloları: panelden cihazlara ve panele dönüş (sınıf A ring). Renk döngüye göre; arızadan
   * enerjisiz kalan bölümler kırmızı. Kablolar tavan seviyesinde şematik gösterilir. */
  function buildLoops(k, s, G, X, Z, sc) {
    const T = k.T, y = FY + G.H + 0.02, lm = loopModel(s);
    sc.loops = [];
    lm.loops.forEach((lp, li) => {
      const P = [PANEL_G].concat(lp.devs.map(d => [d.x, d.y])).concat([[PANEL_G[0] + 0.4, PANEL_G[1]]]);
      const pos = new Float32Array(Math.max(1, P.length - 1) * 6), col = new Float32Array(Math.max(1, P.length - 1) * 6);
      for (let q = 0; q < P.length - 1; q++) {
        pos.set([X(P[q][0]), y + li * 0.03, Z(P[q][1]), X(P[q + 1][0]), y + li * 0.03, Z(P[q + 1][1])], q * 6);
      }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
      const mat = new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false });
      const ln = new T.LineSegments(geo, mat); ln.renderOrder = 6; ln.userData.noClip = true; k.viewer.root.add(ln);
      sc.loops.push({ ln: ln, col: col, n: P.length - 1, base: new T.Color(LOOP_COL[li]).convertSRGBToLinear() });
    });
    sc.loopRed = new T.Color(0xff2a2a).convertSRGBToLinear();
    sc.loopSig = '';
  }
  function paintLoops(sc, s) {
    const sig = loopSig(s) + '|' + s.showLoops; if (sc.loopSig === sig) return; sc.loopSig = sig;
    const lm = loopModel(s);
    sc.loops.forEach((o, li) => {
      const lp = lm.loops[li]; o.ln.visible = s.showLoops !== false;
      const dead = new Set(lp ? lp.dead : []);
      for (let q = 0; q < o.n; q++) { const c = dead.has(q) ? sc.loopRed : o.base; o.col.set([c.r, c.g, c.b, c.r, c.g, c.b], q * 6); }
      o.ln.geometry.attributes.color.needsUpdate = true;
    });
  }
  /** Kapsama gösterimi (eğitim örneği yarıçapları): nokta dedektörde disk + halka (tipe göre InstancedMesh), ışın tipinde şerit. */
  function buildCoverage(k, s, G, X, Z, sc) {
    const T = k.T, y = FY + G.H - 0.09;
    const g = k.group(null, 0, 0, 0); g.visible = !!s.showCov; sc.cov = g;
    const col = { optik: 0x38bdf8, isi: 0xf59e0b, beam: 0xf87171 };
    const list = detLayout(s), dm = new T.Object3D();
    Object.keys(col).forEach(t => {
      const ds = list.filter(d => d.type === t);
      if (!ds.length) return;
      const fill = new T.MeshBasicMaterial({ color: col[t], transparent: true, opacity: 0.1, depthWrite: false, side: T.DoubleSide });
      if (t === 'beam') {
        ds.forEach(d => { const len = (d.gx2 - d.gx + 1) * G.cs, w = 2 * YC.COVER.beam.r; const m = new T.Mesh(new T.PlaneGeometry(len, w), fill); m.rotation.x = -Math.PI / 2; m.position.set(X((d.gx + d.gx2 + 1) / 2), y, Z(d.gy + 0.5)); m.renderOrder = 5; g.add(m); });
        return;
      }
      const r = YC.COVER[t].r;
      const disc = new T.InstancedMesh(new T.CircleGeometry(r, 40), fill, ds.length);
      const ring = new T.InstancedMesh(new T.RingGeometry(r - 0.06, r, 48), new T.MeshBasicMaterial({ color: col[t], transparent: true, opacity: 0.6, depthWrite: false, side: T.DoubleSide }), ds.length);
      ds.forEach((d, j) => { dm.position.set(X(d.gx + 0.5), y, Z(d.gy + 0.5)); dm.rotation.set(-Math.PI / 2, 0, 0); dm.updateMatrix(); disc.setMatrixAt(j, dm.matrix); dm.position.y = y - 0.01; dm.updateMatrix(); ring.setMatrixAt(j, dm.matrix); });
      [disc, ring].forEach(m => { m.renderOrder = 5; g.add(m); });
    });
    g.traverse(o => { o.castShadow = false; });
  }
  function detInfo(app, i) {
    const L = app.live, s = app.state, d = L.dets[i]; if (!d) return [];
    const st = detStates(s, L)[i];
    const ld = loopModel(s).byRef['det:' + d.id];
    return ['Adres ' + (ld ? ld.addr + (ld.iso ? ' · izolatörlü taban' : '') : '—') + (loopModel(s).lostDet.has(d.id) ? ' · DÖNGÜ ARIZASI: panelle haberleşemiyor' : ''), 'Okuma: ' + fmt(d.reading, 3) + ' · eşik ' + fmt(thr(d.type, s), 3) + (d.type === 'isi' ? ' (τ = ' + TAU_HEAT + ' s gecikmeli)' : d.type === 'beam' ? ' (hat ortalaması)' : ''),
      'Durum: ' + (st.state === 'fault' ? 'ARIZA (hat kopukluğu)' : d.alarm ? 'ALARM · ' + fmt(d.tAlarm, 0) + ' s' : 'normal') + (st.disabled ? ' · bölge devre dışı' : ''),
      'Eğitim gösterimi: eşikler ve yerleşim onaylı tasarım değildir (TSE CEN/TS 54-14).'];
  }

  /* duman: tavan altında yoğunluğa göre kalınlaşan üç saydam katman (DataTexture) */
  function buildSmoke(k, G, sc) {
    const T = k.T;
    const dz = Math.min(1.1, G.H * 0.13);
    sc.smoke = [[0.006, 0.6], [0.06, 0.52], [0.18, 0.46]].map((p, i) => {
      const data = new Uint8Array(GW * GH * 4);
      const tex = new T.DataTexture(data, GW, GH, T.RGBAFormat); tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter; tex.needsUpdate = true;
      const mat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: T.DoubleSide });
      const m = new T.Mesh(new T.PlaneGeometry(G.W, G.D), mat); m.rotation.x = -Math.PI / 2; m.position.y = FY + G.H - 0.12 - i * dz; m.renderOrder = 4 + i;
      k.viewer.root.add(m);
      return { data: data, tex: tex, c0: p[0], amax: p[1] };
    });
    sc.smokeSum = -1;
  }
  function paintSmoke(sc, grid) {
    let sum = 0; for (let i = 0; i < grid.length; i += 7) sum += grid[i];
    if (Math.abs(sum - sc.smokeSum) < 1e-5) return; sc.smokeSum = sum;
    sc.smoke.forEach(l => {
      const d = l.data;
      for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
        const c = grid[gy * GW + gx], o = ((GH - 1 - gy) * GW + gx) * 4;
        const a = Math.min(1, Math.max(0, (c - l.c0) / 0.1)) * l.amax, sh = 100 - Math.min(1, c) * 65;
        d[o] = sh; d[o + 1] = sh; d[o + 2] = sh + 6; d[o + 3] = a * 255;
      }
      l.tex.needsUpdate = true;
    });
  }

  /* yangın: alev konileri, titreşen nokta ışık, yükselen duman sütunu */
  function buildFire(k, G, sc, app) {
    const T = k.T;
    const g = k.group(null, 0, FY, 0);
    const outer = new T.MeshStandardMaterial({ color: 0xff6a00, emissive: 0xff4d00, emissiveIntensity: 2.4, transparent: true, opacity: 0.85, depthWrite: false });
    const inner = new T.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffc94d, emissiveIntensity: 2.8, transparent: true, opacity: 0.9, depthWrite: false });
    sc.flames = [];
    [[0, 0, 0.42, 1.3, outer], [0.22, 0.12, 0.26, 0.9, outer], [-0.2, -0.1, 0.28, 1.0, outer], [0, 0, 0.22, 0.8, inner]].forEach(f => {
      const m = new T.Mesh(new T.ConeGeometry(f[2], f[3], 12, 1, true), f[4]); m.position.set(f[0], f[3] / 2, f[1]); g.add(m); sc.flames.push({ m: m, h: f[3] });
    });
    k.cyl(0.6, 0.7, 0.08, new T.MeshStandardMaterial({ color: 0x1b1714, roughness: 1 }), 0, 0.04, 0, g, 16);
    sc.fireLight = new T.PointLight(0xff7a2e, 0, Math.max(10, G.cs * 14), 2); sc.fireLight.position.set(0, 1.0, 0); g.add(sc.fireLight);
    const pm = new T.MeshStandardMaterial({ color: 0x70757d, roughness: 1, transparent: true, opacity: 0.24, depthWrite: false });
    sc.plume = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8), pm, 16); sc.plume.castShadow = false; g.add(sc.plume);
    sc.fire = g;
    k.pickable(g, 'Yangın kaynağı', () => { const L = app.live; return [FIRE[app.state.fireZone].what + ' · ' + ZONE[app.state.fireZone].name, 'Kaynak debisi (model): ' + fmt(L.rate, 4) + ' /s · büyüme ' + GROWTH_LABEL[app.state.growth].toLowerCase(), 'Duman modeli eğitim amaçlı 2B difüzyondur; CFD yangın dinamiği değildir.']; });
    sc.fireLabel = k.label('Yangın', g, [0, 2.2, 0]);
    sc.fireLabel.level('bad');
  }

  /* kişiler: gövde + baş (InstancedMesh, en çok 60) */
  function buildPeople(k, sc) {
    const T = k.T;
    const bg = new T.CylinderGeometry(0.2, 0.14, 1.45, 10); bg.translate(0, 0.725, 0);
    const hg = new T.SphereGeometry(0.12, 12, 10); hg.translate(0, 1.6, 0);
    sc.body = new T.InstancedMesh(bg, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), 60);
    sc.head = new T.InstancedMesh(hg, new T.MeshStandardMaterial({ color: 0xd9a77e, roughness: 0.6 }), 60);
    const col = new T.Color(), shirts = [0xf2c200, 0xf97316, 0x2563eb, 0x0f766e, 0xe5e7eb, 0x1e293b];
    for (let i = 0; i < 60; i++) sc.body.setColorAt(i, col.setHex(shirts[i % shirts.length]));
    [sc.body, sc.head].forEach(m => { m.castShadow = true; m.count = 0; k.viewer.root.add(m); });
    k.pickable(sc.body, 'Bina kullanıcıları', () => { const a = VS.app, L = a.live; return [a.state.occupants + ' kişi · sahnede ' + L.people.length + ' figür', 'Alarmdan ' + T_RESP + ' s sonra 1,2 m/s ile en yakın çıkışa yürür (motor varsayımı).', 'Kapı kuyruğu figürlerde canlandırılmaz; kapı akış süresi hesapta yer alır.']; });
  }

  /* sahne güncelleme: hesap/girdi değişince */
  function update(k, res, s, L, app) {
    const sc = app.scene3; if (!sc) return;
    ensureLive(app); evalPanel(app);
    const G = sc.G, f = FIRE[s.fireZone];
    sc.fire.position.set(f.x * G.cs + G.cs / 2 - G.W / 2, FY, f.y * G.cs + G.cs / 2 - G.D / 2);
    ZONES.forEach(z => {
      const l = sc.zl[z.id]; if (!l) return;
      const al = L.panel.zones.indexOf(z.id) >= 0, dis = s.disableZone === z.id;
      const pre = L.dets.some(d => d.zone === z.id && d.alarm);
      l.set(z.name + (dis ? ' · devre dışı' : al ? ' · YANGIN' : pre ? ' · algılama' : ''));
      l.level(al ? 'bad' : dis || pre ? 'warn' : '');
    });
    if (sc.panelScr) sc.panelScr.redraw();
    if (sc.cov) sc.cov.visible = !!s.showCov;
    if (sc.place) sc.place.visible = !!s.placeMode;
    if (sc.loops) paintLoops(sc, s);
    const lost = loopModel(s).lostSnd; (sc.lens || []).forEach((m, i) => { m.material = lost.has(i) ? k.mats.ledOff : sc.beacon; });
  }
  function animate(k, dt, res, s, L, app) {
    const sc = app.scene3; if (!sc || !L.dets) return;
    const M = k.mats, G = sc.G, T = k.T;
    sc.clock += dt;
    const rm = k.reducedMotion;
    paintSmoke(sc, L.grid);
    // alev ve ışık (yangın büyüklüğü kaynak debisine bağlı)
    const sz = L.burning || L.t > 0 ? 0.35 + 1.6 * Math.sqrt(L.rate / 0.25) : 0;
    sc.fire.visible = sz > 0;
    sc.flames.forEach((fl, i) => { const fk = rm ? 1 : 0.85 + 0.25 * Math.sin(sc.clock * (9 + i * 3) + i); fl.m.scale.set(sz, sz * fk, sz); fl.m.position.y = fl.h * sz * fk / 2; });
    sc.fireLight.intensity = sz ? (rm ? 60 : 50 + 25 * Math.sin(sc.clock * 13) * Math.sin(sc.clock * 7.3)) * sz : 0;
    const dm = sc._dm || (sc._dm = new T.Object3D());
    for (let i = 0; i < 16; i++) {
      const ph = rm ? i / 16 : (i / 16 + sc.clock * 0.12) % 1, r = 0.18 + ph * 0.9 * Math.max(0.5, sz);
      dm.position.set(Math.sin(i * 2.3) * ph * 0.6, 0.6 + ph * (G.H - 0.8), Math.cos(i * 1.7) * ph * 0.6); dm.scale.setScalar(sz ? r : 0.0001); dm.updateMatrix(); sc.plume.setMatrixAt(i, dm.matrix);
    }
    sc.plume.instanceMatrix.needsUpdate = true;
    // dedektör LED'leri: normal → 4 s'de bir yeşil yanıp söner, alarm → kırmızı, arıza → sarı, devre dışı → sönük
    const st = detStates(s, L), blink = (sc.clock % 4) < 0.18;
    const LC = sc.ledCol, flash = (sc.clock * 3 | 0) % 2 || rm;
    st.forEach((x, i) => {
      const d = sc.dets[i]; if (!d) return;
      const al = L.dets[i] && L.dets[i].alarm;
      const c = x.state === 'fault' ? 'amber' : x.disabled ? 'off' : al ? (flash ? 'red' : 'off') : blink ? 'green' : 'off';
      if (d.inst !== undefined) sc.detLeds.setColorAt(d.inst, LC[c]);
      else d.led.material = { amber: M.ledAmber, off: M.ledOff, red: M.ledRed, green: M.ledGreen }[c];
      if (d.beam) { d.beam.opacity = al && !x.disabled ? 0.55 : 0.16; d.beam.color.setHex(al ? 0xff2222 : 0xff8888); }
    });
    if (sc.detLeds && sc.detLeds.instanceColor) sc.detLeds.instanceColor.needsUpdate = true;
    // siren / flaşör
    const fire = L.panel.mode === 'fire';
    sc.beacon.emissiveIntensity = fire ? (rm ? 2.2 : ((sc.clock * 1.5) % 1 < 0.25 ? 4 : 0.2)) : 0;
    // panel LED'leri: YANGIN, ARIZA, DEVRE DIŞI, ENERJİ
    if (sc.panelLeds) {
      sc.panelLeds[0].material = fire ? (rm || (sc.clock * 2 | 0) % 2 ? M.ledRed : M.ledOff) : M.ledOff;
      sc.panelLeds[1].material = L.panel.faults ? M.ledAmber : M.ledOff;
      sc.panelLeds[2].material = s.disableZone ? M.ledAmber : M.ledOff;
      sc.panelLeds[3].material = M.ledGreen;
    }
    sc.panelT += dt; if (sc.panelT > 0.5 && sc.panelScr) { sc.panelT = 0; sc.panelScr.redraw(); }
    // kişiler
    const n = L.people.length; let j = 0;
    const moving = L.tAlarm !== null && L.t >= L.tAlarm + T_RESP;
    for (let i = 0; i < n; i++) {
      const p = L.people[i]; if (p.out) continue;
      const bob = moving && !rm ? Math.abs(Math.sin(sc.clock * 8 + p.ph)) * 0.04 : 0;
      dm.position.set(p.x * G.cs - G.W / 2, FY + bob, p.y * G.cs - G.D / 2); dm.rotation.set(0, p.dir, 0); dm.scale.setScalar(1); dm.updateMatrix();
      sc.body.setMatrixAt(j, dm.matrix); sc.head.setMatrixAt(j, dm.matrix); j++;
    }
    dm.rotation.set(0, 0, 0);
    sc.body.count = sc.head.count = j; sc.body.instanceMatrix.needsUpdate = sc.head.instanceMatrix.needsUpdate = true;
    if (sc.body.instanceColor) sc.body.instanceColor.needsUpdate = true;
    sc.fireLabel.set(L.burning ? 'Yangın · ' + fmt(L.t, 0) + ' s' : L.t > 0 ? 'Yangın (durdu)' : 'Yangın başlangıç noktası');
  }

  /* ---------------------------------------------------------------- 2D plan şeması */
  // son çizimin ölçeği: 2D planda tıklamayla dedektör ekleme/kaldırma (yalnız yerleştirme modunda)
  const V2 = { ox: 0, oy: 0, c: 1 };
  function bindPlanClicks(cv) {
    if (!cv || cv.dataset.vsPlace) return;
    cv.dataset.vsPlace = '1';
    cv.addEventListener('click', e => {
      const app = VS.app; if (!app || !app.state.placeMode) return;
      const rc = cv.getBoundingClientRect(), x = (e.clientX - rc.left - V2.ox) / V2.c, y = (e.clientY - rc.top - V2.oy) / V2.c;
      if (x < 0 || y < 0 || x >= GW || y >= GH) return;
      const hit = app.live.dets.find(d => d.type !== 'beam' && Math.hypot(d.gx + 0.5 - x, d.gy + 0.5 - y) < 0.9);
      if (hit) removeDet(app, hit.id); else addDet(app, Math.floor(x), Math.floor(y));
      app.renderControls(); app.invalidate();
    });
  }
  /** 2D yerleşim: plan ölçeği yalnız genişlikten belirlenir; başlık, döngü özeti, olay listesi ve açıklama plan altına
   * yığılır. Yükseklik view2dHeight ile çekirdeğe bildirilir (dar ekranda dikey kaydırma, yazılar üst üste binmez). */
  const LH = 15;
  function layout2d(W, s) {
    const narrow = W < 560, m = 14, mr = narrow ? 14 : 64;
    const headTop = narrow ? 128 : 58, headN = narrow ? 4 : 2;
    const c = Math.max(4, (W - m - mr) / GW);
    const ox = m + (W - m - mr - c * GW) / 2, oy = headTop + headN * 16 + 18;
    const chars = Math.max(30, Math.floor((W - 2 * m) / 6.3));
    const yLoops = oy + GH * c + 34, nL = Math.max(1, Math.min(4, Math.round(s.nLoops || 1)));
    const yEv = yLoops + nL * LH + 14, nEv = 5;
    const yLeg = yEv + 16 + nEv * LH + 8, legN = narrow ? 3 : 2;
    return { narrow: narrow, m: m, c: c, ox: ox, oy: oy, headTop: headTop, headN: headN, chars: chars, yLoops: yLoops, yEv: yEv, nEv: nEv, yLeg: yLeg, legN: legN, H: yLeg + legN * LH + 12 };
  }
  function view2dHeight(W, res, s) { return layout2d(W, s).H; }
  const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  /** Metni karakter sınırına göre satırlara böler (en çok max satır). */
  function wrapLines(t, n, max) {
    const out = []; let cur = '';
    t.split(' ').forEach(w => { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
    if (cur) out.push(cur);
    if (out.length > max) { out.length = max; out[max - 1] = clip(out[max - 1] + ' …', n); }
    return out;
  }
  function view2d(g, W, H, res, s, L) {
    const Ly = layout2d(W, s), m = Ly.m, c = Ly.c, ox = Ly.ox, oy = Ly.oy;
    const col = { text: '#e6eef8', dim: '#7f94b0', ok: '#10b981', warn: '#f59e0b', bad: '#ef4444' };
    const lm = loopModel(s);
    // başlık: panel durumu ve zamanlar (sarılarak, ayrılan satır sayısıyla sınırlı)
    const p = L.panel;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = 'bold 15px Inter, sans-serif'; g.fillStyle = p.mode === 'fire' ? col.bad : p.mode === 'normal' ? col.ok : col.warn;
    g.fillText(clip('Panel: ' + MODE_TEXT[p.mode] + (L.silenced ? ' (susturuldu)' : ''), Ly.chars - 4), m, Ly.headTop);
    g.font = '12px Inter, sans-serif'; g.fillStyle = s.placeMode ? '#38bdf8' : col.dim;
    const info = 't = ' + fmt(L.t, 0) + ' s · ilk algılama ' + (L.tFirst === null ? '—' : fmt(L.tFirst, 0) + ' s') + ' · alarm ' + (L.tAlarm === null ? '—' : fmt(L.tAlarm, 0) + ' s') + ' · hesaplanan tahliye ' + fmt(res.values.evac, 0) + ' s'
      + (s.placeMode ? ' · Yerleştirme modu: boş hücreye tıklayın → dedektör eklenir; dedektöre tıklamak kaldırır.' : '');
    wrapLines(info, Ly.chars, Ly.headN - 1).forEach((t, i) => g.fillText(t, m, Ly.headTop + 16 + i * 16));
    // bölgeler
    ZONES.forEach(z => {
      g.fillStyle = z.color + '22'; g.fillRect(ox + z.x0 * c, oy + z.y0 * c, (z.x1 - z.x0 + 1) * c, (z.y1 - z.y0 + 1) * c);
      g.fillStyle = s.disableZone === z.id ? col.warn : col.dim; g.font = 'bold ' + (c < 9 ? 9 : 11) + 'px Inter, sans-serif'; g.textAlign = 'center';
      g.fillText(z.name + (s.disableZone === z.id ? ' (devre dışı)' : ''), ox + (z.x0 + z.x1 + 1) / 2 * c, oy + (z.y1 + 1) * c - 5);
    });
    // raflar
    g.fillStyle = '#33415588'; [2, 6, 10].forEach(gy => g.fillRect(ox + 2 * c, oy + gy * c, 16 * c, 2 * c));
    // duman ısı haritası
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const v = L.grid[y * GW + x]; if (v < 0.004) continue;
      g.fillStyle = 'rgba(203,213,225,' + Math.min(0.85, 0.1 + v * 2.2).toFixed(3) + ')'; g.fillRect(ox + x * c, oy + y * c, c + 0.5, c + 0.5);
    }
    if (s.placeMode) { g.strokeStyle = 'rgba(56,189,248,.22)'; g.lineWidth = 1; g.beginPath(); for (let x = 0; x <= GW; x++) { g.moveTo(ox + x * c, oy); g.lineTo(ox + x * c, oy + GH * c); } for (let y = 0; y <= GH; y++) { g.moveTo(ox, oy + y * c); g.lineTo(ox + GW * c, oy + y * c); } g.stroke(); }
    // duvarlar
    g.fillStyle = '#cbd5e1';
    for (let i = 0; i < WALLS.length; i++) { const x = i % GW, y = Math.floor(i / GW); if (WALLS[i] && !(y === 15 && x < 20)) g.fillRect(ox + x * c + c * 0.3, oy + y * c, c * 0.4, c); }
    g.fillRect(ox, oy + 15 * c + c * 0.3, 20 * c, c * 0.4);
    g.fillStyle = '#9b2c2c'; g.fillRect(ox + 20 * c + c * 0.2, oy + 20 * c + 2, c * 0.6, c - 4); g.fillRect(ox + 8 * c + 2, oy + 15 * c + c * 0.2, c - 4, c * 0.6);
    g.strokeStyle = '#e2e8f0'; g.lineWidth = 2; g.strokeRect(ox, oy, GW * c, GH * c);
    // çıkışlar (dar ekranda yalnız kod)
    g.font = '10px Inter, sans-serif';
    EXITS.forEach(e => {
      const w = Math.max(c, e.w * c), shut = s.blockExit === e.id || L.blocked[e.id];
      g.fillStyle = shut ? col.bad : col.ok;
      if (e.side === 'right') { g.fillRect(ox + GW * c - 3, oy + e.gy * c - w / 2, 6, w); g.textAlign = 'right'; g.fillText(e.id, ox + GW * c - 6, oy + e.gy * c - w / 2 - 3); }
      else { const y = e.side === 'back' ? oy - 3 : oy + GH * c - 3; g.fillRect(ox + e.gx * c - w / 2, y, w, 6); g.textAlign = 'center'; g.fillText(Ly.narrow ? e.id : e.id + ' ' + e.name, ox + e.gx * c, e.side === 'back' ? oy - 7 : oy + GH * c + 15); }
    });
    // adresli döngü kabloları (sınıf A ring), arızadan enerjisiz bölümler kesikli kırmızı
    if (s.showLoops !== false) lm.loops.forEach((lp, li) => {
      const P = [PANEL_G].concat(lp.devs.map(d => [d.x, d.y])).concat([[PANEL_G[0] + 0.4, PANEL_G[1]]]), dead = new Set(lp.dead);
      g.lineWidth = 1.2;
      for (let q = 0; q < P.length - 1; q++) {
        g.strokeStyle = dead.has(q) ? col.bad : LOOP_COL[li] + 'aa'; g.setLineDash(dead.has(q) ? [4, 3] : []);
        g.beginPath(); g.moveTo(ox + P[q][0] * c, oy + P[q][1] * c); g.lineTo(ox + P[q + 1][0] * c, oy + P[q + 1][1] * c); g.stroke();
      }
      g.setLineDash([]);
    });
    // panel
    g.fillStyle = p.mode === 'fire' ? col.bad : '#b91c1c'; g.fillRect(ox + 33.2 * c, oy + 0.2 * c, c * 0.9, c * 0.6);
    g.fillStyle = col.text; g.textAlign = 'left'; g.font = '10px Inter, sans-serif'; g.fillText('Panel', ox + 34.3 * c, oy + 0.9 * c + 3);
    // ihbar butonları ve siren/flaşörler (döngü cihazları)
    lm.devs.forEach(d => {
      if (d.kind === 'det') return;
      const lost = d.kind === 'mcp' ? lm.lostMcp.has(d.ref) : lm.lostSnd.has(d.ref), x = ox + d.x * c, y = oy + d.y * c, r = Math.max(2.5, c * 0.28);
      g.fillStyle = lost ? '#64748b' : d.kind === 'mcp' ? '#ef4444' : '#fb923c';
      if (d.kind === 'mcp') g.fillRect(x - r, y - r, 2 * r, 2 * r);
      else { g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y + r); g.lineTo(x - r, y + r); g.closePath(); g.fill(); }
    });
    // yangın
    const f = FIRE[s.fireZone];
    if (L.burning || L.t > 0) { const fr = Math.max(4, c * (0.3 + 0.7 * Math.sqrt(L.rate / 0.25))); g.fillStyle = '#f97316'; g.beginPath(); g.arc(ox + (f.x + 0.5) * c, oy + (f.y + 0.5) * c, fr, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fde68a'; g.beginPath(); g.arc(ox + (f.x + 0.5) * c, oy + (f.y + 0.5) * c, fr * 0.45, 0, Math.PI * 2); g.fill(); }
    else { g.strokeStyle = '#f97316'; g.setLineDash([3, 3]); g.beginPath(); g.arc(ox + (f.x + 0.5) * c, oy + (f.y + 0.5) * c, c * 0.6, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    // kapsama (eğitim örneği)
    const cs = geo(s).cs;
    if (s.showCov) L.dets.forEach(d => {
      const r = YC.COVER[d.type].r / cs * c;
      g.fillStyle = d.type === 'isi' ? 'rgba(245,158,11,.08)' : d.type === 'beam' ? 'rgba(248,113,113,.08)' : 'rgba(56,189,248,.08)';
      g.strokeStyle = d.type === 'isi' ? 'rgba(245,158,11,.5)' : d.type === 'beam' ? 'rgba(248,113,113,.5)' : 'rgba(56,189,248,.5)'; g.lineWidth = 1;
      if (d.type === 'beam') { g.fillRect(ox + d.gx * c, oy + (d.gy + 0.5) * c - r, (d.gx2 - d.gx + 1) * c, 2 * r); return; }
      g.beginPath(); g.arc(ox + (d.gx + 0.5) * c, oy + (d.gy + 0.5) * c, r, 0, Math.PI * 2); g.fill(); g.stroke();
    });
    V2.ox = ox; V2.oy = oy; V2.c = c;
    bindPlanClicks(g.canvas);
    // dedektörler
    const st = detStates(s, L);
    L.dets.forEach((d, i) => {
      const x = st[i];
      const cc = x.state === 'fault' ? col.warn : x.disabled ? '#64748b' : d.alarm ? col.bad : col.ok;
      if (d.type === 'beam') { g.strokeStyle = cc; g.setLineDash([5, 4]); g.lineWidth = d.alarm ? 2.5 : 1.5; g.beginPath(); g.moveTo(ox + 0.6 * c, oy + (d.gy + 0.5) * c); g.lineTo(ox + 19.6 * c, oy + (d.gy + 0.5) * c); g.stroke(); g.setLineDash([]); return; }
      const cx = ox + (d.gx + 0.5) * c, cy = oy + (d.gy + 0.5) * c, r = Math.max(2.5, c * 0.32);
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
      if (d.alarm || x.state === 'fault') { g.fillStyle = cc; g.fill(); } else { g.strokeStyle = cc; g.lineWidth = 1.6; g.stroke(); }
      if (d.type === 'isi') { g.strokeStyle = cc; g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.stroke(); }
    });
    // kişiler
    g.fillStyle = '#fcd34d';
    L.people.forEach(pp => { if (pp.out) return; g.beginPath(); g.arc(ox + pp.x * c, oy + pp.y * c, Math.max(1.8, c * 0.16), 0, Math.PI * 2); g.fill(); });
    // döngü özeti (plan altında, her döngü bir satır)
    g.textAlign = 'left'; g.font = '11px Inter, sans-serif';
    lm.loops.forEach((lp, li) => {
      const y = Ly.yLoops + li * LH, isF = lp.fault;
      g.fillStyle = LOOP_COL[li]; g.fillRect(m, y - 8, 14, 3);
      g.fillStyle = isF ? col.warn : col.dim;
      g.fillText(clip('L' + lp.l + ' · ' + lp.n + ' adres · ' + (s.classA !== false ? 'sınıf A' : 'sınıf B') + ' · izolatör ' + lp.iso.length + ' · en kötü kısa devre kaybı ' + lp.worstShort
        + (isF ? ' · ARIZA: ' + (isF.kind === 'short' ? 'kısa devre' : 'açık devre') + ', ' + lp.lost.length + ' cihaz kayıp' : ''), Ly.chars - 4), m + 20, y);
    });
    // olay listesi (adresli zaman çizelgesi)
    g.font = 'bold 11px Inter, sans-serif'; g.fillStyle = col.text; g.fillText('Olaylar', m, Ly.yEv);
    g.font = '11px Inter, sans-serif'; g.fillStyle = col.dim;
    const tl = YC.timeline(L.tl).rows.slice(-Ly.nEv);
    if (!tl.length) g.fillText('Henüz olay yok — “Yangını başlat” ile senaryoyu çalıştırın.', m, Ly.yEv + LH);
    tl.forEach((r, i) => g.fillText(clip(YC.clock(r.t) + ' · ' + r.label + ' · ' + r.text, Ly.chars), m, Ly.yEv + LH + i * LH));
    // açıklama (sarılarak)
    // simgeler yazı tipine bırakılmaz, çizilir
    const items = [[col.ok, 'ring', 'dedektör'], [col.bad, 'dot', 'alarm'], [col.warn, 'dot', 'arıza / kayıp'], ['#64748b', 'ring', 'devre dışı'], ['#ef4444', 'sq', 'ihbar butonu'], ['#fb923c', 'tri', 'siren/flaşör'], ['#22d3ee', 'line', 'döngü kablosu'], [col.bad, 'dash', 'enerjisiz kablo'], ['#cbd5e1', 'sq', 'duman'], ['#fcd34d', 'dot', 'kişi']];
    let x = m, line = 0;
    items.forEach(it => {
      const w = 16 + g.measureText(it[2]).width;
      if (x + w > W - m && x > m) { x = m; line++; }
      if (line >= Ly.legN) return;
      const y = Ly.yLeg + line * LH, cy = y - 4;
      g.fillStyle = it[0]; g.strokeStyle = it[0]; g.lineWidth = 1.6;
      if (it[1] === 'ring' || it[1] === 'dot') { g.beginPath(); g.arc(x + 5, cy, 4, 0, Math.PI * 2); if (it[1] === 'dot') g.fill(); else g.stroke(); }
      else if (it[1] === 'sq') g.fillRect(x + 1, cy - 4, 8, 8);
      else if (it[1] === 'tri') { g.beginPath(); g.moveTo(x + 5, cy - 5); g.lineTo(x + 10, cy + 4); g.lineTo(x, cy + 4); g.closePath(); g.fill(); }
      else { g.setLineDash(it[1] === 'dash' ? [3, 2] : []); g.beginPath(); g.moveTo(x, cy); g.lineTo(x + 11, cy); g.stroke(); g.setLineDash([]); }
      g.fillStyle = it[0]; g.fillText(it[2], x + 15, y); x += w + 12;
    });
  }

  /* ---------------------------------------------------------------- kayıt */
  const base = { area: 960, height: 8, nDet: 24, sounders: 8, occupants: 60, exitW: 5.4, dist: 35, fireZone: 'depo', detType: 'optik', sens: 'normal', coincidence: false, growth: 'orta', speed: 10, faultDet: false, disableZone: '',
    added: [], removed: [], faults: [], blockExit: '', placeMode: false, showCov: false,
    nLoops: 2, isoMode: '10', classA: true, loopFault: '', faultLoop: 1, showLoops: true };
  const sce = o => Object.assign({}, base, o);
  VS.register({
    id: 'yangin', title: '3D Yangın Algılama Sistemi Simülasyonu',
    defaults: () => Object.assign({}, base),
    initLive: initLive,
    autoRun: true,
    startText: 'Yangın başladı: duman tavan altında yayılıyor, dedektörler izleniyor.',
    start: start,
    scenarios: [
      { id: 'depo', name: 'Depo A · palet yangını (optik dedektör)', desc: 'Raf koridorunda palet yangını; tek dedektör algılayınca panel yangın alarmına geçer.', state: sce({}), start: true },
      { id: 'elektrik', name: 'Elektrik odası · çift dedektör onayı', desc: 'Kapalı elektrik odasında hızlı büyüyen pano yangını; ilk dedektör ön alarm, ikinci dedektör yangın alarmı verir.', state: sce({ fireZone: 'elektrik', coincidence: true, growth: 'hizli' }), start: true },
      { id: 'ofis-isi', name: 'Ofis · ısı dedektörü ile geç algılama', desc: 'Aynı yangında ısı dedektörünün gecikmeli yanıtı; algılama ve tahliye süresi uzar.', state: sce({ fireZone: 'ofis', detType: 'isi', speed: 15 }), start: true },
      { id: 'ariza', name: 'Arıza + devre dışı bölge (TS EN 54-2)', desc: 'Depo A devre dışı ve yangına en yakın dedektör arızalı: panel arıza uyarısı verir ama yangını algılamaz. İhbar butonunu deneyin.', state: sce({ faultDet: true, disableZone: 'depo', speed: 20 }), start: true },
      { id: 'karma', name: 'Üretim · karma algılama, hızlı yangın', desc: 'Depoda ışın tipi, üretimde ısı, ofis ve elektrik odasında optik dedektör; üretimde hızlı büyüyen yangın.', state: sce({ fireZone: 'uretim', detType: 'karma', growth: 'hizli', occupants: 120 }), start: true },
      { id: 'loop', name: 'Döngü kısa devresi · izolatörsüz', desc: 'L2 (ofis + depo) ortasında kısa devre, izolatör yok: döngüdeki tüm adresli cihazlar kaybolur ve Depo A yangını algılanmaz. İzolatör ekleyip farkı görün.', state: sce({ isoMode: 'yok', loopFault: 'short', faultLoop: 2, speed: 20 }), start: true },
      { id: 'cikis', name: 'Üretim · ana giriş kapalı, yeniden yönlendirme', desc: 'Ana giriş (E2) kapalı; kişiler yol bulmayla yan çıkışa ve depo çıkışına yönlenir. Kapsama alanları açık.', state: sce({ fireZone: 'uretim', blockExit: 'E2', showCov: true }), start: true }
    ],
    tasks: [
      { id: 'detect60', title: 'Depo A yangınını 60 s içinde algıla', goal: 'Depo A’daki dedektörler sökülmüş. Tavana dedektör yerleştirip yangını başlatın; ilk algılama yangının ilk 60 saniyesinde olsun.',
        hint: '“Yerleştirme modu”nu açın, raf koridorundaki yangın noktasına (sol arka) yakın mavi noktalara tıklayıp “Dedektör ekle” deyin, sonra “Yangını başlat”.',
        state: sce({ removed: AUTO_DEPO(), placeMode: true, showCov: true }),
        check: (r, s, L) => s.fireZone === 'depo' && L.tFirst !== null && L.tFirst <= 60 && L.dets.some(d => d.id === L.firstId && d.zone === 'depo') },
      { id: 'coincidence', title: 'Alarm doğrulamayı göster: ön alarm → yangın alarmı', goal: 'Elektrik odası yangınında panel önce ön alarma geçsin, yangın alarmı ancak ikinci dedektörün onayıyla (ihbar butonu olmadan) gelsin.',
        hint: 'Çift dedektör onayını açın ve yangını başlatın; ihbar butonuna basmayın.',
        state: sce({ fireZone: 'elektrik', growth: 'hizli' }),
        check: (r, s, L) => !!s.coincidence && L.tPre !== null && L.tAlarm !== null && L.tAlarm > L.tPre && L.alarmBy === 'coincidence' },
      { id: 'evac', title: 'Ana giriş kapalıyken ' + EVAC_N + ' s içinde tahliye', goal: 'Üretimde yangın, ana giriş (E2) kapalı, 60 kişi. Yangın başlangıcından itibaren tüm figürler ' + EVAC_N + ' s içinde dışarı çıksın.',
        hint: 'Erken algılama tahliyeyi öne çeker: duyarlılığı yükseltin, dedektör ekleyin ya da yangını gören kişi gibi ihbar butonuna basın. Kapalı çıkışı açmak geçerli değildir.',
        state: sce({ fireZone: 'uretim', blockExit: 'E2' }),
        check: (r, s, L) => s.blockExit === 'E2' && s.occupants >= 60 && L.tOut !== null && L.tOut <= EVAC_N },
      { id: 'fault', title: 'Arıza durumunu oluştur ve gider', goal: 'Bir dedektörde hat kopukluğu arızası oluşturun, panelin “arıza uyarısı”na geçtiğini görün, sonra arızayı giderip paneli normale döndürün.',
        hint: '3D’de bir dedektöre tıklayın → “Arıza oluştur”; ardından aynı kartta “Arızayı gider” ya da paneldeki “Arızaları gider”.',
        state: sce({}),
        check: (r, s, L) => L.sawFault && !s.faultDet && !(s.faults || []).length && L.panel.faults === 0 && L.panel.mode === 'normal' },
      { id: 'isolator', title: 'Kısa devreyi izolatörlerle sınırla', goal: 'L1 döngüsünün ortasında kısa devre var ve izolatör olmadığı için döngüdeki tüm cihazlar kayıp. Arıza sürerken kaybolan cihaz sayısını 10 veya altına indirin.',
        hint: '“Adresli döngüler” bölümünde kısa devre izolatörünü “Her 10 cihazda” ya da “Her cihazda” yapın. Arızayı gidermek bu görevde geçerli değildir.',
        state: sce({ isoMode: 'yok', loopFault: 'short', faultLoop: 1 }),
        check: (r, s) => s.loopFault === 'short' && s.isoMode !== 'yok' && loopModel(s).loops[loopModel(s).fl - 1].lost.length <= 10 },
      { id: 'classa', title: 'Kablo kopmasında cihaz kaybetme', goal: 'Radyal (sınıf B) kablolanmış L2 döngüsünde kablo koptu; kopukluğun ötesindeki cihazlar kayıp. Arıza sürerken hiçbir cihaz kaybolmasın.',
        hint: 'Döngüyü sınıf A (iki uçtan beslenen ring) olarak kablolayın: “Sınıf A kablolama” anahtarını açın.',
        state: sce({ classA: false, loopFault: 'open', faultLoop: 2 }),
        check: (r, s) => s.loopFault === 'open' && s.classA !== false && loopModel(s).loops[loopModel(s).fl - 1].lost.length === 0 },
      { id: 'coverage', title: 'Depo A’yı ısı dedektörleriyle kapsa', goal: 'Tavan 6 m, dedektör tipi ısı. Depo A’daki dedektörler sökülmüş; örnek kapsama yarıçapıyla Depo A’nın en az %95’ini kapsayın (eğitim gösterimi).',
        hint: 'Yerleştirme modu ve “Kapsama alanlarını göster” açık. Isı dedektörünün örnek yarıçapı ' + fmt(YC.COVER.isi.r, 1) + ' m; noktaları yaklaşık 6–7 m arayla dağıtın.',
        state: sce({ detType: 'isi', height: 6, removed: AUTO_DEPO(), placeMode: true, showCov: true }),
        check: (r, s) => s.detType === 'isi' && s.height <= 7.5 && r.values.cov && r.values.cov.zones.depo >= 0.95 }
    ],
    reportInputs: (s, app) => {
      const out = [{ group: 'Dedektör yerleşimi', label: 'Elle eklenen / kaldırılan', value: (s.added || []).length + ' eklendi · ' + (s.removed || []).length + ' kaldırıldı' }];
      YC.timeline(app.live.tl || []).rows.forEach(r => out.push({ group: 'Olay zaman çizelgesi', label: YC.clock(r.t) + ' · ' + r.label, value: r.text }));
      return out;
    },
    controls: controls,
    compute: (s, app) => {
      const r = Y.compute(Object.assign({}, s, { tAlarm: app && app.live ? app.live.tAlarm : null, nDet: Math.max(1, detLayout(s).length) }));
      if (r.ok) {
        r.values.cov = coverage(s);
        const lm = loopModel(s), worst = Math.max.apply(null, lm.loops.map(l => l.worstShort)), maxN = Math.max.apply(null, lm.loops.map(l => l.n));
        r.values.loops = { n: lm.loops.map(l => l.n), worstShort: worst, lost: s.loopFault ? lm.loops[lm.fl - 1].lost.length : 0 };
        r.checks.push({ id: 'loop32', label: 'Döngü arızasının etkisi (bilgi)', status: worst > 32 ? 'warn' : 'ok', detail: 'En kötü tek kısa devrede kaybolan cihaz: ' + worst + '. EN 54-2 / EN 54-13: tek bir iletim yolu arızası 32’den fazla dedektör/ihbar butonunu etkilememelidir; izolatörlerle sağlanır. ' + (s.classA !== false ? 'Sınıf A: tek kopukluk cihaz kaybettirmez.' : 'Sınıf B (radyal): kopukluğun ötesi kaybolur.'), ref: 'TS EN 54-2 · EN 54-13' });
        r.checks.push({ id: 'loopcap', label: 'Döngü adres kapasitesi (bilgi)', status: 'info', detail: 'Döngü başına en çok ' + maxN + ' adresli cihaz (' + lm.nL + ' döngü). ' + YC.LOOP_LIMIT_INFO, ref: 'Üretici verisi' });
      }
      return r;
    },
    readouts: readouts,
    charts: charts,
    tick: tick,
    badge: (res, s, L) => L.panel.mode === 'fire' ? { level: 'bad', text: 'YANGIN ALARMI · ' + (L.panel.zones.map(z => ZONE[z].name).join(', ') || 'ihbar butonu') }
      : L.panel.mode === 'prealarm' ? { level: 'warn', text: 'Ön alarm · onay bekleniyor' }
      : L.panel.mode === 'fault' ? { level: 'warn', text: 'Arıza uyarısı' }
      : L.burning && L.t > 0 ? { level: 'warn', text: 'Yangın var · henüz algılanmadı' } : null,
    scene: { build: build, update: update, animate: animate, rebuildOn: rebuildOn, bounds: [-21, 21], background: 0x0b1a30 },
    view2d: view2d,
    view2dHeight: view2dHeight
  });
})();
