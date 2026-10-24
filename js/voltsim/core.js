/* VoltSim çekirdeği — modül kaydı, 3 panelli çalışma alanı, 3D görüntüleyici, 2D şema modu, grafikler,
 * rapor (PDF/JSON/CSV), proje kaydet/yükle. Hesaplar js/voltsim/engine.js içindedir; buradaki hiçbir değer
 * animasyondan türetilmez: sahne, hesap sonucunu görselleştirir. */
(function () {
  'use strict';
  const E = window.VoltSimEngine;
  const modules = {};
  const motionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = !!(motionQuery && motionQuery.matches);
  const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  /* ------------------------------------------------------------------ biçimlendirme */
  const nf = {};
  function fmt(v, d, unit) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    d = d === undefined ? 1 : d;
    const key = d;
    if (!nf[key]) nf[key] = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
    const r = nf[key].format(v);
    // -0 / -0,0 gösterilmez; sayı ile birim arasında bölünmez dar boşluk (U+202F)
    return (/^-0(,0*)?$/.test(r) ? r.slice(1) : r) + (unit ? ' ' + unit : '');
  }
  /** Büyüklüğe göre birim önekli biçim (W→kW→MW). */
  function fmtPower(W, d) {
    const a = Math.abs(W);
    if (a >= 1e6) return fmt(W / 1e6, d === undefined ? 2 : d, 'MW');
    if (a >= 1e3) return fmt(W / 1e3, d === undefined ? 1 : d, 'kW');
    return fmt(W, 0, 'W');
  }
  function fmtEnergy(kWh) {
    if (Math.abs(kWh) >= 1e6) return fmt(kWh / 1e6, 2, 'GWh');
    if (Math.abs(kWh) >= 1e3) return fmt(kWh / 1e3, 1, 'MWh');
    return fmt(kWh, 1, 'kWh');
  }
  function fmtDuration(min) {
    if (!isFinite(min)) return '—';
    if (min < 1) return fmt(min * 60, 0, 's');
    const tot = Math.round(min), h = Math.floor(tot / 60), m = tot % 60; // önce dakikaya yuvarla: “1 sa 60 dk” olmaz
    return h ? h + ' sa ' + m + ' dk' : m + ' dk';
  }
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(k => {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(c => { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function getPath(o, path) { return String(path).split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o); }
  function setPath(o, path, v) {
    const ks = String(path).split('.'); let a = o;
    for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] === undefined) a[ks[i]] = {}; a = a[ks[i]]; }
    a[ks[ks.length - 1]] = v;
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  let uid = 0;
  const nextId = p => (p || 'vs') + '-' + (++uid);

  function storageGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* gizli pencere */ } }
  function storageDel(k) { try { localStorage.removeItem(k); } catch (_) { } }

  function toast(msg, level) {
    let box = document.getElementById('vsToast');
    if (!box) { box = el('div', { id: 'vsToast', class: 'vs-toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(box); }
    box.textContent = msg; box.dataset.level = level || 'info'; box.classList.add('is-on');
    clearTimeout(toast.t); toast.t = setTimeout(() => box.classList.remove('is-on'), 3800);
  }

  /* ------------------------------------------------------------------ grafik (canvas 2D) */
  const PALETTE = { amber: '#f59e0b', cyan: '#22b8cf', blue: '#3b82f6', green: '#10b981', red: '#ef4444', violet: '#8b5cf6', grey: '#94a3b8', brown: '#a16207' };
  function niceTicks(min, max, n) {
    if (!(max > min)) { max = min + 1; }
    const span = max - min, step0 = span / Math.max(n, 1), mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag, step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = []; for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }
  /** Tik etiketi basamak sayısı adım büyüklüğünden (0,25 → 2 basamak; 0,02 “0,0” olmaz). */
  function tickDigits(ticks) {
    const st = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
    if (!(st > 0) || st >= 1) return 0;
    for (let d = 1; d <= 4; d++) if (Math.abs(st * Math.pow(10, d) - Math.round(st * Math.pow(10, d))) < 1e-6) return d;
    return 4;
  }
  /** Metni verilen piksel genişliğine sığdırır (gerekirse … ile kısaltır); 2D şemalarda ortak. */
  function fitText(g, text, w) {
    text = String(text); if (g.measureText(text).width <= w) return text;
    while (text.length > 1 && g.measureText(text + '…').width > w) text = text.slice(0, -1);
    return text + '…';
  }
  /** Log eksen etiketi: 0,01 · 0,1 · 1 · 10 · 100 · 1 k · 10 k · 1 M */
  function fmtLog(v) {
    if (v >= 1e6) return fmt(v / 1e6, v >= 1e7 ? 0 : 0) + ' M';
    if (v >= 1e3) return fmt(v / 1e3, 0) + ' k';
    if (v >= 1) return fmt(v, 0);
    return fmt(v, Math.min(4, Math.max(1, Math.ceil(-Math.log10(v) - 1e-9))));
  }
  function drawChart(canvas, spec) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth || 300, H = canvas.clientHeight || 160;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const pad = { l: 44, r: 10, t: 10, b: 30 };
    // logaritmik eksen (spec.x.log / spec.y.log): çizim log10 uzayında yapılır; sıfır/negatif ve sonsuz noktalar atlanır
    const lgx = !!(spec.x && spec.x.log), lgy = !!(spec.y && spec.y.log);
    if (lgx || lgy) {
      const ok = p => isFinite(p[0]) && isFinite(p[1]) && (!lgx || p[0] > 0) && (!lgy || p[1] > 0);
      const tr = p => [lgx ? Math.log10(p[0]) : p[0], lgy ? Math.log10(p[1]) : p[1]];
      const ax = (a, lg) => {
        if (!a || !lg) return a;
        const o = Object.assign({}, a, { log: false });
        if (a.min !== undefined) o.min = Math.log10(a.min);
        if (a.max !== undefined) o.max = Math.log10(a.max);
        const lo = o.min !== undefined ? Math.floor(o.min + 1e-9) : -3, hi = o.max !== undefined ? Math.ceil(o.max - 1e-9) : 4;
        o.ticks = a.ticks ? a.ticks.filter(t => t > 0).map(t => Math.log10(t)) : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
        o.minor = []; for (let d = lo; d < hi; d++) for (let m = 2; m <= 9; m++) o.minor.push(d + Math.log10(m));
        o.fmt = v => (a.fmt ? a.fmt(Math.pow(10, v)) : fmtLog(Math.pow(10, v)));
        return o;
      };
      spec = Object.assign({}, spec, {
        x: ax(spec.x, lgx), y: ax(spec.y, lgy),
        series: (spec.series || []).map(s => Object.assign({}, s, { data: (s.data || []).filter(ok).map(tr) })),
        hLines: (spec.hLines || []).filter(h => !lgy || h.y > 0).map(h => Object.assign({}, h, { y: lgy ? Math.log10(h.y) : h.y })),
        markers: (spec.markers || []).filter(m => !lgx || m.x > 0).map(m => Object.assign({}, m, { x: lgx ? Math.log10(m.x) : m.x, y: m.y === undefined ? undefined : lgy ? (m.y > 0 ? Math.log10(m.y) : undefined) : m.y }))
      });
    }
    const series = (spec.series || []).filter(s => s.data && s.data.length);
    let xs = [], ys = [];
    series.forEach(s => s.data.forEach(p => { xs.push(p[0]); ys.push(p[1]); }));
    (spec.hLines || []).forEach(h => ys.push(h.y));
    // eksenler veri aralığından: küçük değerli seriler (0–0,2) grafiğin dibine ezilmez
    const mn = a => a.reduce((m, v) => (v < m ? v : m), Infinity), mx = a => a.reduce((m, v) => (v > m ? v : m), -Infinity);
    const xLo = xs.length ? mn(xs) : 0, xHi = xs.length ? mx(xs) : 1, yLo = ys.length ? mn(ys) : 0, yHi = ys.length ? mx(ys) : 1;
    let xmin = spec.x && spec.x.min !== undefined ? spec.x.min : Math.min(0, xLo);
    let xmax = spec.x && spec.x.max !== undefined ? spec.x.max : (xHi > xmin ? xHi : xmin + 1);
    let ymin = spec.y && spec.y.min !== undefined ? spec.y.min : Math.min(0, yLo);
    let ymax = spec.y && spec.y.max !== undefined ? spec.y.max : (yHi > ymin ? ymin + (yHi - ymin) * 1.08 : ymin + 1);
    if (ymax <= ymin) ymax = ymin + 1; if (xmax <= xmin) xmax = xmin + 1;
    const X = x => pad.l + (x - xmin) / (xmax - xmin) * (W - pad.l - pad.r);
    const Y = y => H - pad.b - (y - ymin) / (ymax - ymin) * (H - pad.t - pad.b);
    g.font = '10px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
    g.lineWidth = 1;
    // log eksende ara çizgiler (2…9 × 10^n)
    if ((spec.x && spec.x.minor) || (spec.y && spec.y.minor)) {
      g.strokeStyle = 'rgba(148,163,184,.07)'; g.beginPath();
      ((spec.x && spec.x.minor) || []).forEach(v => { if (v > xmin && v < xmax) { const x = X(v); g.moveTo(x, pad.t); g.lineTo(x, H - pad.b); } });
      ((spec.y && spec.y.minor) || []).forEach(v => { if (v > ymin && v < ymax) { const y = Y(v); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); } });
      g.stroke();
      if (spec.x && spec.x.minor) { g.strokeStyle = 'rgba(148,163,184,.16)'; g.beginPath(); (spec.x.ticks || []).forEach(v => { const x = X(v); if (x >= pad.l - 1 && x <= W - pad.r + 1) { g.moveTo(x, pad.t); g.lineTo(x, H - pad.b); } }); g.stroke(); }
    }
    g.strokeStyle = 'rgba(148,163,184,.16)'; g.fillStyle = '#8ea3bf';
    const yt = spec.y && spec.y.ticks ? spec.y.ticks : niceTicks(ymin, ymax, 4), xt = spec.x && spec.x.ticks ? spec.x.ticks : niceTicks(xmin, xmax, Math.max(3, Math.floor(W / 70)));
    g.textAlign = 'right';
    yt.forEach(v => { const y = Y(v); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.fillText((spec.y && spec.y.fmt ? spec.y.fmt(v) : fmt(v, tickDigits(yt))), pad.l - 6, y); });
    g.textAlign = 'center'; g.textBaseline = 'top';
    xt.forEach(v => { const x = X(v); if (x < pad.l - 1 || x > W - pad.r + 1) return; g.fillText(spec.x && spec.x.fmt ? spec.x.fmt(v) : fmt(v, tickDigits(xt)), x, H - pad.b + 6); });
    if (spec.x && spec.x.label) { g.textAlign = 'right'; g.fillStyle = '#6f84a1'; g.fillText(spec.x.label, W - pad.r, H - 12); }
    if (spec.y && spec.y.label) { g.save(); g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = '#6f84a1'; g.fillText(spec.y.label, pad.l + 4, pad.t); g.restore(); }
    (spec.hLines || []).forEach(h => {
      g.save(); g.setLineDash([4, 4]); g.strokeStyle = h.color || PALETTE.red; g.beginPath(); g.moveTo(pad.l, Y(h.y)); g.lineTo(W - pad.r, Y(h.y)); g.stroke(); g.restore();
      if (h.label) { g.fillStyle = h.color || PALETTE.red; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(h.label, W - pad.r - 2, Y(h.y) - 2); }
    });
    series.forEach(s => {
      const col = PALETTE[s.color] || s.color || PALETTE.amber;
      if (s.type === 'bar') {
        const n = s.data.length, bw = Math.max(2, (W - pad.l - pad.r) / Math.max(n, 1) * (s.width || 0.62));
        const off = (s.offset || 0) * bw;
        g.fillStyle = col;
        s.data.forEach(p => { const x = X(p[0]) - bw / 2 + off, y0 = Y(Math.max(ymin, 0)), y = Y(p[1]); g.fillRect(x, Math.min(y, y0), bw, Math.abs(y0 - y)); });
        return;
      }
      g.save(); if (s.dash) g.setLineDash(s.dash);
      g.strokeStyle = col; g.lineWidth = s.width || 2; g.lineJoin = 'round'; g.beginPath();
      s.data.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke(); g.restore();
      if (s.area) {
        g.globalAlpha = 0.14; g.fillStyle = col; g.beginPath();
        s.data.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.lineTo(X(s.data[s.data.length - 1][0]), Y(Math.max(ymin, 0))); g.lineTo(X(s.data[0][0]), Y(Math.max(ymin, 0))); g.closePath(); g.fill(); g.globalAlpha = 1;
      }
    });
    (spec.markers || []).forEach((m, mi) => {
      if (m.x === undefined || !isFinite(m.x)) return;
      const x = X(m.x); g.strokeStyle = m.color || '#fcd34d'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, H - pad.b); g.stroke();
      if (m.y !== undefined) { g.fillStyle = m.color || '#fcd34d'; g.beginPath(); g.arc(x, Y(m.y), 4, 0, Math.PI * 2); g.fill(); }
      // etiketler üst üste binmesin diye her işaret bir satır aşağı kaydırılır
      if (m.label) { g.fillStyle = m.color || '#fcd34d'; g.textAlign = x > W * 0.7 ? 'right' : 'left'; g.textBaseline = 'top'; g.fillText(m.label, x + (x > W * 0.7 ? -4 : 4), pad.t + 14 + mi * 12); }
    });
  }

  /* ------------------------------------------------------------------ 3D görüntüleyici */
  // A scene rebuild owns its complete kit. Dispose each resource once, including
  // textures and cloned transparent materials that are no longer in the tree.
  // keep: modül düzeyinde önbelleğe alınan (sahneler arası yeniden kullanılan) kaynaklar; bunlar dispose edilmez.
  function disposeTree(root, extra, keep) {
    const resources = new Set();
    const materials = new Set();
    const material = m => {
      if (!m || materials.has(m)) return;
      materials.add(m); resources.add(m);
      Object.keys(m).forEach(k => { if (m[k] && m[k].isTexture) resources.add(m[k]); });
    };
    root.traverse(o => {
      if (o.geometry) resources.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(material);
      if (o.userData) { material(o.userData.origMat); material(o.userData.ghostMat); }
      if (o.isInstancedMesh && o.dispose) o.dispose();
    });
    if (extra) extra.forEach(r => { if (r.isMaterial) material(r); else resources.add(r); });
    resources.forEach(r => { if (keep && keep.has(r)) return; if (r.dispose) r.dispose(); });
  }

  /** Statik grup birleştirme: grubun DOĞRUDAN alt mesh'lerinden aynı malzeme ve gölge ayarındakiler tek BufferGeometry'de
   * toplanır (draw call azaltır). İç içe gruplar (kapak menteşesi, fan, seçilebilir parça) ve kabuk (kesit) mesh'leri
   * olduğu gibi kalır; birleşik mesh grubun çocuğu olduğundan grup dönse/taşınsa da doğru konumda kalır. */
  function mergeStatic(T, group, owned, skip) {
    group.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(group.matrixWorld).invert();
    const buckets = new Map(), victims = [];
    group.children.forEach(o => {
      if (!o.isMesh || o.isInstancedMesh || o.children.length || o.userData.noMerge || o.userData.merged || Array.isArray(o.material) || !o.visible || (skip && skip.has(o))) return;
      const g = o.geometry; if (!g || !g.attributes.position) return;
      const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0);
      let b = buckets.get(key); if (!b) buckets.set(key, b = { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, list: [] });
      b.list.push(o);
    });
    const m = new T.Matrix4(), nm = new T.Matrix3(), v = new T.Vector3();
    buckets.forEach(b => {
      if (b.list.length < 2) return;
      let n = 0; const parts = b.list.map(o => { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; n += g.attributes.position.count; return { o: o, g: g, tmp: g !== o.geometry }; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let off = 0;
      parts.forEach(p => {
        m.multiplyMatrices(inv, p.o.matrixWorld); nm.getNormalMatrix(m);
        const P = p.g.attributes.position, N = p.g.attributes.normal, U = p.g.attributes.uv;
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(m); pos[(off + i) * 3] = v.x; pos[(off + i) * 3 + 1] = v.y; pos[(off + i) * 3 + 2] = v.z;
          if (N) { v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[(off + i) * 3] = v.x; nor[(off + i) * 3 + 1] = v.y; nor[(off + i) * 3 + 2] = v.z; }
          if (U) { uv[(off + i) * 2] = U.getX(i); uv[(off + i) * 2 + 1] = U.getY(i); }
        }
        off += P.count;
        if (p.tmp) p.g.dispose();
        victims.push(p.o);
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      const mesh = new T.Mesh(geo, b.mat); mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; mesh.userData.merged = true;
      group.add(mesh);
    });
    victims.forEach(o => { if (o.parent) o.parent.remove(o); if (!owned.has(o.geometry)) o.geometry.dispose(); });
    return victims.length;
  }
  function Viewer(stage, canvas, opts) {
    const T = window.THREE;
    this.T = T; this.stage = stage; this.canvas = canvas; this.opts = opts || {};
    opts = this.opts; this._cleanups = []; this._size = { w: 0, h: 0, pr: 0 };
    // ?vsq=low|high ile katman zorlanabilir (test ve destek için)
    const forced = (location.search.match(/[?&]vsq=(low|high)/) || [])[1];
    const quality = forced || (coarse || (navigator.hardwareConcurrency || 4) <= 4 ? 'low' : 'high');
    this.quality = quality;
    const r = new T.WebGLRenderer({ canvas: canvas, antialias: quality === 'high', alpha: false, powerPreference: 'high-performance' });
    r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = opts.exposure || 0.92;
    r.physicallyCorrectLights = true;
    // gölge haritası önbellekli: yalnız sahne/ışık değişince yeniden çizilir (invalidateShadows)
    r.shadowMap.enabled = true; r.shadowMap.type = quality === 'high' ? T.PCFSoftShadowMap : T.PCFShadowMap;
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;
    r.localClippingEnabled = true;
    this.dirty = true; this.wake = null; this.keep = new Set(); this._shadowT = 0;
    this._tmp = { v: new T.Vector3(), r: new T.Vector3(), u: new T.Vector3(), m: new T.Vector2() };
    this.renderer = r;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(opts.background || 0x0b1a30);
    this.camera = new T.PerspectiveCamera(40, 1, 0.05, 2000);
    this.target = new T.Vector3();
    this.sph = { r: 8, theta: 0.7, phi: 1.1 };
    this.limits = { rMin: 1, rMax: 60, phiMin: 0.15, phiMax: 1.52 };
    this.damp = { theta: 0, phi: 0 };
    this.autoSpin = false;
    this.labels = []; this.pickables = []; this.shells = []; this.explodables = []; this.animated = [];
    this.clipPlane = new T.Plane(new T.Vector3(-1, 0, 0), 1e6);
    this.clipOn = false; this.transparent = false; this.showLabels = true; this.explode = 0;
    this.root = new T.Group(); this.scene.add(this.root);
    this.envMap = this._environment();
    this.scene.environment = this.envMap;
    this._lights();
    this.labelLayer = stage.querySelector('.vs-labels');
    this._bindControls();
    this.resize();
    this.visible = true; this.contextLost = false;
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => { this.visible = es[0].isIntersecting; if (this.visible) this.invalidate(); }); io.observe(stage);
      this._cleanups.push(() => io.disconnect());
    }
    this._listen(window, 'resize', () => this.resize());
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => this.resize()); ro.observe(stage); this._cleanups.push(() => ro.disconnect());
    }
    this._listen(canvas, 'webglcontextlost', e => { e.preventDefault(); this.contextLost = true; if (this.onContextLost) this.onContextLost(); });
    this._listen(canvas, 'webglcontextrestored', () => { this.contextLost = false; this.resize(); this.invalidateShadows(); if (this.onContextRestored) this.onContextRestored(); });
  }
  /** Sonraki uygun karede yeniden çizim iste (boşta duran döngüyü uyandırır). */
  Viewer.prototype.invalidate = function () { this.dirty = true; if (this.wake) this.wake(); };
  /** Gölge haritasını da yeniden çizdir (sahne geometrisi, ışık veya patlatma/kesit değişince). */
  Viewer.prototype.invalidateShadows = function () { this.renderer.shadowMap.needsUpdate = true; this.invalidate(); };
  /** Kamera hareket ediyor mu (sürükleme, sönümleme, otomatik dönüş)? */
  Viewer.prototype.moving = function () {
    return this.dragging || (this.autoSpin && !reduceMotion) || Math.abs(this.damp.theta) > 1e-4 || Math.abs(this.damp.phi) > 1e-4;
  };
  /** Build sonrası: küçük parçalarda gölge düşürmeyi kapat (gölge geçişindeki nesne sayısını azaltır). */
  Viewer.prototype.pruneShadows = function () {
    const c = this.sun.shadow.camera, half = Math.max(1, (c.right - c.left) / 2), lim = 0.006 * half;
    const T = this.T, s = new T.Vector3();
    this.root.traverse(o => {
      if (!o.isMesh || !o.castShadow || o.isInstancedMesh || !o.geometry) return;
      const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      o.getWorldScale(s);
      if (g.boundingSphere.radius * Math.max(s.x, s.y, s.z) < lim) { o.castShadow = false; o.userData.vsNoCast = true; }
    });
    this.invalidateShadows();
  };
  Viewer.prototype._listen = function (target, type, fn, options) {
    target.addEventListener(type, fn, options); this._cleanups.push(() => target.removeEventListener(type, fn, options));
  };
  Viewer.prototype._environment = function () {
    const T = this.T;
    const env = new T.Scene();
    const geo = new T.SphereGeometry(50, 32, 16);
    const cols = []; const pos = geo.attributes.position;
    const top = new T.Color(0x9fb8d8), mid = new T.Color(0xdfe7f0), bot = new T.Color(0x2b3442);
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 50; const c = y > 0 ? mid.clone().lerp(top, y) : mid.clone().lerp(bot, Math.min(1, -y * 3)); cols.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    env.add(new T.Mesh(geo, new T.MeshBasicMaterial({ side: T.BackSide, vertexColors: true })));
    const panel = (x, y, z, w, h, i) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(i, i, i) })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
    panel(0, 40, 0, 40, 40, 3); panel(30, 15, 20, 20, 12, 2.2); panel(-30, 10, -20, 18, 10, 1.4);
    const pm = new T.PMREMGenerator(this.renderer);
    const rt = pm.fromScene(env, 0.02);
    pm.dispose();
    disposeTree(env); this._envTarget = rt;
    return rt.texture;
  };
  Viewer.prototype._lights = function () {
    const T = this.T;
    this.hemi = new T.HemisphereLight(0xdfeaff, 0x1b2230, 0.45); this.scene.add(this.hemi);
    const sun = new T.DirectionalLight(0xfff3e0, 2.6);
    sun.position.set(8, 14, 6); sun.castShadow = true;
    const s = this.quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(s, s); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    const c = sun.shadow.camera; c.near = 0.5; c.far = 80; c.left = -14; c.right = 14; c.top = 14; c.bottom = -14;
    this.scene.add(sun); this.scene.add(sun.target);
    this.sun = sun;
  };
  Viewer.prototype.setShadowBox = function (half, far) {
    const c = this.sun.shadow.camera; c.left = c.bottom = -half; c.right = c.top = half; c.far = far || half * 6; c.updateProjectionMatrix();
    this.invalidateShadows();
  };
  Viewer.prototype.setView = function (v) {
    this.home = { target: v.target.slice(), r: v.r, theta: v.theta, phi: v.phi };
    if (v.limits) Object.assign(this.limits, v.limits);
    this.resetView();
  };
  Viewer.prototype.resetView = function () {
    if (!this.home) return;
    this.target.set(this.home.target[0], this.home.target[1], this.home.target[2]);
    this.sph.r = this.home.r; this.sph.theta = this.home.theta; this.sph.phi = this.home.phi; this.damp.theta = this.damp.phi = 0;
    this.invalidate();
  };
  Viewer.prototype.resize = function () {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (!w || !h) return;
    // Bound the framebuffer on high-DPI phones and large/fullscreen displays.
    const pr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25, Math.sqrt((this.quality === 'high' ? 2400000 : 1200000) / (w * h)));
    if (this._size.w === w && this._size.h === h && this._size.pr === pr) return;
    this._size = { w: w, h: h, pr: pr };
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.invalidate();
  };
  Viewer.prototype._bindControls = function () {
    const c = this.canvas, self = this;
    const pts = new Map();
    let last = null, moved = 0, pinch = 0, panMode = false;
    this._listen(c, 'pointerdown', e => {
      c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = { x: e.clientX, y: e.clientY }; moved = 0; panMode = e.button === 2 || e.shiftKey || pts.size === 2;
      if (pts.size === 2) { const a = Array.from(pts.values()); pinch = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
      c.classList.add('is-drag'); self.dragging = true; self.autoSpinPaused = true; self._hideHint(); self.invalidate();
    });
    let hoverT = 0;
    this._listen(c, 'pointermove', e => {
      if (!pts.has(e.pointerId)) {
        if (e.pointerType === 'mouse' && performance.now() - hoverT > 120) { hoverT = performance.now(); c.style.cursor = self._hit(e) ? 'pointer' : ''; }
        return;
      }
      const pp = pts.get(e.pointerId); pp.x = e.clientX; pp.y = e.clientY;
      if (pts.size === 2) {
        const a = Array.from(pts.values()); const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (pinch) self.zoom(pinch / d); pinch = d;
        const mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
        if (last && last.pair) self.pan(mx - last.x, my - last.y);
        last = { x: mx, y: my, pair: true }; moved += 10; self.invalidate(); return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y; moved += Math.abs(dx) + Math.abs(dy);
      if (panMode) self.pan(dx, dy);
      else { self.damp.theta = -dx * 0.0062; self.damp.phi = -dy * 0.0062; self.sph.theta += self.damp.theta; self.sph.phi += self.damp.phi; }
      last.x = e.clientX; last.y = e.clientY; last.pair = false;
      self.invalidate();
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId); c.classList.remove('is-drag');
      if (moved < 6 && e.type === 'pointerup' && pts.size === 0) self._pick(e);
      if (pts.size === 0) { pinch = 0; last = null; self.dragging = false; }
      else { const p = pts.values().next().value; last = { x: p.x, y: p.y }; pinch = 0; }
      self.invalidate();
    };
    this._listen(c, 'pointerup', up); this._listen(c, 'pointercancel', up); this._listen(c, 'lostpointercapture', up);
    this._listen(c, 'contextmenu', e => e.preventDefault());
    // sayfa kaydırmayı engellememek için: tekerlek yalnız sahne odaktayken (tıklanmışken) ya da Ctrl ile yakınlaştırır
    this._listen(c, 'wheel', e => {
      if (document.activeElement !== c && !e.ctrlKey) { self._flashHint('Yakınlaştırmak için önce sahneye tıklayın (ya da Ctrl + tekerlek).'); return; }
      e.preventDefault(); self.zoom(Math.exp(e.deltaY * 0.0012)); self._hideHint(); self.invalidate();
    }, { passive: false });
    c.tabIndex = 0;
    this._listen(c, 'keydown', e => {
      const k = e.key; let used = true;
      if (k === 'ArrowLeft') self.sph.theta -= 0.12; else if (k === 'ArrowRight') self.sph.theta += 0.12;
      else if (k === 'ArrowUp') self.sph.phi -= 0.08; else if (k === 'ArrowDown') self.sph.phi += 0.08;
      else if (k === '+' || k === '=') self.zoom(0.88); else if (k === '-') self.zoom(1.14);
      else if (k === '0') self.resetView();
      else if (k === ']' || k === '[' || k === 'PageDown' || k === 'PageUp') self.cycle(k === ']' || k === 'PageDown' ? 1 : -1);
      else if (k === 'Enter' && self.selected) { self.viaKeyboard = true; if (self.onSelect) self.onSelect(self.selected, true, true); }
      else if (k === 'Escape' && self.selected) self.select(null);
      else used = false;
      if (used) { e.preventDefault(); self.invalidate(); }
    });
  };
  Viewer.prototype._hideHint = function () { const h = this.stage.querySelector('.vs-hint'); if (h) h.classList.add('is-hidden'); };
  Viewer.prototype._flashHint = function (t) {
    const h = this.stage.querySelector('.vs-hint'); if (!h) return;
    if (!h.dataset.base) h.dataset.base = h.textContent;
    h.textContent = t; h.classList.remove('is-hidden');
    clearTimeout(this._hintT); this._hintT = setTimeout(() => { h.textContent = h.dataset.base; h.classList.add('is-hidden'); }, 1800);
  };
  Viewer.prototype.zoom = function (k) { this.sph.r = E.clamp(this.sph.r * k, this.limits.rMin, this.limits.rMax); };
  Viewer.prototype.pan = function (dx, dy) {
    const s = this.sph.r * 0.0016, t = this._tmp;
    t.r.setFromMatrixColumn(this.camera.matrix, 0); t.u.setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(t.r, -dx * s).addScaledVector(t.u, dy * s);
  };
  /** Klavye: [ / ] (PageUp/PageDown) ile seçilebilir ekipmanlar arasında gezinme. */
  Viewer.prototype.cycle = function (dir) {
    const list = this.pickables.filter(p => p.obj.visible); if (!list.length) return;
    const i = list.indexOf(this.selected);
    this.viaKeyboard = true;
    this.select(list[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + list.length) % list.length]);
  };
  /** İmleç altındaki seçilebilir ekipman (yoksa null). */
  Viewer.prototype._hit = function (e) {
    if (!this.pickables.length) return null;
    const T = this.T, rect = this.canvas.getBoundingClientRect(), m = this._tmp.m;
    m.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    const rc = this._rc || (this._rc = new T.Raycaster()); rc.setFromCamera(m, this.camera);
    const objs = this._pickObjs || (this._pickObjs = []);
    objs.length = 0; this.pickables.forEach(p => { if (p.obj.visible) objs.push(p.obj); });
    const hit = rc.intersectObjects(objs, true).find(h => !this.clipOn || this.clipPlane.distanceToPoint(h.point) >= 0);
    if (!hit) return null;
    let o = hit.object; let p = null;
    while (o && !p) { p = this.pickables.find(x => x.obj === o); o = o.parent; }
    return p;
  };
  Viewer.prototype._pick = function (e) { this.viaKeyboard = false; this.select(this._hit(e)); };
  Viewer.prototype.select = function (p) {
    if (this.selected && this.selected.box) {
      const old = this.selected.box; this.root.remove(old); disposeTree(old); this.selected.box = null;
    }
    this.selected = p;
    if (p && !p.obj.isInstancedMesh) {
      // BoxHelper InstancedMesh örneklerini bilmez (yerel orijinde kutu çizer): vurgu yalnız tekil nesnelerde
      const T = this.T;
      const box = new T.BoxHelper(p.obj, 0xfcd34d); box.material.depthTest = false; box.renderOrder = 10; box.material.transparent = true; box.material.opacity = 0.9;
      p.box = box; this.root.add(box);
    }
    if (this.onSelect) this.onSelect(p, this.viaKeyboard);
    this.invalidate();
  };
  Viewer.prototype.addLabel = function (text, obj, offset, cls) {
    const T = this.T, self = this;
    const node = el('span', { class: 'vs-label' + (cls ? ' ' + cls : '') }); node.textContent = text;
    this.labelLayer.appendChild(node);
    const l = { el: node, obj: obj, off: new T.Vector3().fromArray(offset || [0, 0, 0]), tf: '', shown: true,
      set: t => { if (node.textContent !== t) { node.textContent = t; self.dirty = true; } },
      level: lv => { lv = lv || ''; if (node.dataset.level !== lv) node.dataset.level = lv; } };
    this.labels.push(l); return l;
  };
  Viewer.prototype.clear = function () {
    this.labels.forEach(l => l.el.remove()); this.labels = []; this.pickables = []; this.shells = []; this.explodables = []; this.animated = [];
    this.select(null);
    disposeTree(this.root, this._kitResources, this.keep); this._kitResources = null;
    while (this.root.children.length) this.root.remove(this.root.children[0]);
    this._applied = 0; this.invalidateShadows();
  };
  Viewer.prototype.dispose = function () {
    if (this.disposed) return; this.disposed = true;
    this._cleanups.splice(0).forEach(fn => fn()); this.keep.clear(); this.clear();
    if (this._envTarget) this._envTarget.dispose();
    this.scene.traverse(o => { if (o.shadow && o.shadow.map) o.shadow.map.dispose(); });
    this.renderer.dispose();
  };
  Viewer.prototype.applyClip = function () {
    const planes = this.clipOn ? [this.clipPlane] : [];
    this.root.traverse(o => {
      if (!o.material || o.userData.noClip) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (m.clippingPlanes && m.clippingPlanes.length === planes.length) { m.clippingPlanes = planes; return; }
        m.clippingPlanes = planes; m.clipShadows = true; m.needsUpdate = true;
      });
    });
    this.invalidateShadows();
  };
  Viewer.prototype.applyTransparent = function () {
    this.shells.forEach(m => {
      if (!m.userData.origMat) { m.userData.origMat = m.material; m.userData.origCast = m.castShadow; }
      if (this.transparent) {
        if (!m.userData.ghostMat) { const g = m.userData.origMat.clone(); g.transparent = true; g.opacity = 0.14; g.depthWrite = false; m.userData.ghostMat = g; }
        m.material = m.userData.ghostMat; m.castShadow = false;
      } else { m.material = m.userData.origMat; m.castShadow = m.userData.origCast; }
    });
    this.applyClip();
  };
  /** Kamera, patlatma ve etiketleri günceller ve sahneyi çizer. */
  Viewer.prototype.frame = function (dt) {
    if (this.disposed || this.contextLost) return;
    if (reduceMotion) this.damp.theta = this.damp.phi = 0;
    if (this.autoSpin && !reduceMotion) this.sph.theta += dt * 0.12;
    else if (Math.abs(this.damp.theta) > 1e-4 || Math.abs(this.damp.phi) > 1e-4) {
      // eylemsizlik: bırakınca yavaşça durur
      if (!this.dragging) {
        const frames = dt * 60, decay = Math.pow(0.86, frames), distance = (1 - decay) / (1 - 0.86);
        this.sph.theta += this.damp.theta * distance; this.sph.phi += this.damp.phi * distance; this.damp.theta *= decay; this.damp.phi *= decay;
        if (Math.abs(this.damp.theta) <= 1e-4 && Math.abs(this.damp.phi) <= 1e-4) this.damp.theta = this.damp.phi = 0;
      } else { this.damp.theta *= 0.5; this.damp.phi *= 0.5; }
    }
    this.sph.phi = E.clamp(this.sph.phi, this.limits.phiMin, this.limits.phiMax);
    const s = this.sph;
    // dar (dikey) ekranda sahne sığsın diye mesafe en-boy oranına göre büyütülür
    const fit = this.camera.aspect < 1.3 ? Math.pow(1.3 / this.camera.aspect, 0.75) : 1;
    const R = s.r * fit;
    this.camera.position.set(this.target.x + R * Math.sin(s.phi) * Math.sin(s.theta), this.target.y + R * Math.cos(s.phi), this.target.z + R * Math.sin(s.phi) * Math.cos(s.theta));
    this.camera.lookAt(this.target);
    if (this._applied !== this.explode) { this.explodables.forEach(x => { x.obj.position.copy(x.base).addScaledVector(x.dir, this.explode); }); this._applied = this.explode; this.renderer.shadowMap.needsUpdate = true; }
    if (this.selected && this.selected.box) this.selected.box.update();
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
    // etiketler: render sonrası matrixWorld günceldir; yalnız değişen stil yazılır
    const w = this._size.w, h = this._size.h, v = this._tmp.v;
    for (let i = 0; i < this.labels.length; i++) {
      const l = this.labels[i];
      let show = this.showLabels && !(l.obj && !l.obj.visible), tf = '';
      if (show) {
        if (l.obj) v.copy(l.off).applyMatrix4(l.obj.matrixWorld); else v.copy(l.off);
        if (this.clipOn && this.clipPlane.distanceToPoint(v) < -0.02) show = false;
        else {
          v.project(this.camera);
          if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) show = false;
          else tf = 'translate(' + Math.round((v.x + 1) / 2 * w) + 'px,' + Math.round((1 - v.y) / 2 * h) + 'px) translate(-50%,-100%)';
        }
      }
      if (show !== l.shown) { l.el.style.display = show ? '' : 'none'; l.shown = show; }
      if (show && tf !== l.tf) { l.el.style.transform = tf; l.tf = tf; }
    }
  };
  Viewer.prototype.snapshot = function (w) {
    if (this.contextLost) return null;
    this.frame(0);
    const src = this.canvas; const ratio = src.height / src.width; const out = document.createElement('canvas');
    out.width = w || 1200; out.height = Math.round(out.width * ratio);
    out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.9);
  };

  /* ------------------------------------------------------------------ 3D yardımcıları (modüllere ctx olarak verilir) */
  /** r128'de hex renkler doğrusal kabul edilir; tasarım renkleri sRGB olduğundan bir kez doğrusala çevrilir. */
  function linearize(m) {
    if (!m || m.userData.vsLinear) return;
    if (m.color) m.color.convertSRGBToLinear();
    if (m.emissive) m.emissive.convertSRGBToLinear();
    m.userData.vsLinear = true;
  }
  function linearizeTree(root) {
    root.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(linearize); });
  }
  function makeKit(viewer) {
    const T = viewer.T;
    const resources = viewer._kitResources = new Set();
    const matCache = {};
    function std(key, o) {
      if (matCache[key]) return matCache[key];
      // düşük katmanda fiziksel (clearcoat/transmission) malzemeler standart malzemeye düşürülür
      let p = o.p;
      if (o.physical && viewer.quality === 'low') { p = Object.assign({}, p); ['clearcoat', 'clearcoatRoughness', 'transmission'].forEach(k => delete p[k]); }
      const m = o.physical && viewer.quality !== 'low' ? new T.MeshPhysicalMaterial(p) : new T.MeshStandardMaterial(p);
      m.envMapIntensity = o.env === undefined ? 1 : o.env; linearize(m); matCache[key] = m; resources.add(m); return m;
    }
    const mats = {
      panelRAL7035: std('ral7035', { p: { color: 0xd7d9d6, metalness: 0.25, roughness: 0.48 } }),
      panelDark: std('pdark', { p: { color: 0x3a4250, metalness: 0.35, roughness: 0.5 } }),
      plate: std('plate', { p: { color: 0xc9ced3, metalness: 0.75, roughness: 0.35 } }),
      galv: std('galv', { p: { color: 0xb8bfc6, metalness: 0.85, roughness: 0.42 } }),
      steel: std('steel', { p: { color: 0x8c949e, metalness: 0.9, roughness: 0.3 } }),
      darkSteel: std('dsteel', { p: { color: 0x2d333b, metalness: 0.7, roughness: 0.45 } }),
      alu: std('alu', { p: { color: 0xd5dbe1, metalness: 0.95, roughness: 0.28 } }),
      copper: std('copper', { p: { color: 0xc77b4a, metalness: 1, roughness: 0.32 } }),
      brass: std('brass', { p: { color: 0xc9a227, metalness: 1, roughness: 0.35 } }),
      plasticWhite: std('pw', { p: { color: 0xf1f2f0, metalness: 0, roughness: 0.55 } }),
      plasticGrey: std('pg', { p: { color: 0x9aa3ad, metalness: 0, roughness: 0.6 } }),
      plasticDark: std('pd', { p: { color: 0x22272e, metalness: 0, roughness: 0.62 } }),
      plasticBlue: std('pb', { p: { color: 0x1e5aa8, metalness: 0, roughness: 0.5 } }),
      plasticGreen: std('pgr', { p: { color: 0x15803d, metalness: 0, roughness: 0.5 } }),
      plasticRed: std('pr', { p: { color: 0xb91c1c, metalness: 0, roughness: 0.5 } }),
      plasticYellow: std('py', { p: { color: 0xf2c200, metalness: 0, roughness: 0.5 } }),
      rubber: std('rubber', { p: { color: 0x15181c, metalness: 0, roughness: 0.85 } }),
      cableBlack: std('cblack', { p: { color: 0x1a1d21, metalness: 0, roughness: 0.6 } }),
      L1: std('l1', { p: { color: 0x6b3f22, metalness: 0, roughness: 0.55 } }),
      L2: std('l2', { p: { color: 0x1b1b1b, metalness: 0, roughness: 0.55 } }),
      L3: std('l3', { p: { color: 0x8a9099, metalness: 0, roughness: 0.55 } }),
      N: std('n', { p: { color: 0x2563eb, metalness: 0, roughness: 0.5 } }),
      PE: std('pe', { p: { color: 0x7fb800, metalness: 0, roughness: 0.5 } }),
      glass: std('glass', { physical: true, p: { color: 0xdfefff, metalness: 0, roughness: 0.05, transmission: 0.9, transparent: true, opacity: 0.35 }, env: 1.2 }),
      concrete: std('concrete', { p: { color: 0xb8b4ab, metalness: 0, roughness: 0.92 } }),
      concreteDark: std('concreteD', { p: { color: 0x8f8b84, metalness: 0, roughness: 0.95 } }),
      asphalt: std('asphalt', { p: { color: 0x3a3d42, metalness: 0, roughness: 0.95 } }),
      grass: std('grass', { p: { color: 0x5b7a3a, metalness: 0, roughness: 1 } }),
      soil: std('soil', { p: { color: 0x7a5a3a, metalness: 0, roughness: 1 } }),
      gravel: std('gravel', { p: { color: 0x9a948a, metalness: 0, roughness: 1 } }),
      roofSheet: std('roof', { p: { color: 0x9ba7b3, metalness: 0.6, roughness: 0.45 } }),
      wallPanel: std('wall', { p: { color: 0xe4e7ea, metalness: 0.2, roughness: 0.6 } }),
      pvCell: std('pv', { physical: true, p: { color: 0x0f1d3a, metalness: 0.3, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }, env: 1.3 }),
      porcelain: std('porc', { physical: true, p: { color: 0x7a3b1d, metalness: 0, roughness: 0.2, clearcoat: 0.8 } }),
      porcelainGrey: std('porcg', { physical: true, p: { color: 0x9aa1a8, metalness: 0, roughness: 0.25, clearcoat: 0.6 } }),
      trafoPaint: std('tpaint', { p: { color: 0x7d8790, metalness: 0.45, roughness: 0.5 } }),
      carPaint: std('car', { physical: true, p: { color: 0xe7ecf1, metalness: 0.6, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 }, env: 1.3 }),
      bladeWhite: std('blade', { p: { color: 0xf3f5f7, metalness: 0.05, roughness: 0.4 } }),
      ledGreen: std('lg', { p: { color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 2.2, roughness: 0.4 } }),
      ledRed: std('lr', { p: { color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2.2, roughness: 0.4 } }),
      ledAmber: std('la', { p: { color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 2.2, roughness: 0.4 } }),
      ledOff: std('lo', { p: { color: 0x333a42, emissive: 0x000000, roughness: 0.4 } }),
      ledBlue: std('lb', { p: { color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 2.2, roughness: 0.4 } })
    };
    const geoCache = {};
    const cached = (k, make) => { if (!geoCache[k]) { geoCache[k] = make(); resources.add(geoCache[k]); } return geoCache[k]; };
    function boxGeo(w, h, d) { return cached('b' + w + ',' + h + ',' + d, () => new T.BoxGeometry(w, h, d)); }
    const lowSeg = n => (viewer.quality === 'low' ? Math.max(8, Math.round(n * 0.6)) : n);
    function rboxGeo(w, h, d, r) {
      return cached('rb' + [w, h, d, r].join(','), () => {
        const s = new T.Shape(), rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3);
        s.moveTo(-w / 2 + rr, -h / 2); s.lineTo(w / 2 - rr, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rr); s.lineTo(w / 2, h / 2 - rr); s.quadraticCurveTo(w / 2, h / 2, w / 2 - rr, h / 2);
        s.lineTo(-w / 2 + rr, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rr); s.lineTo(-w / 2, -h / 2 + rr); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rr, -h / 2);
        const b = Math.min(rr * 0.5, d * 0.2);
        const g = new T.ExtrudeGeometry(s, { depth: Math.max(d - 2 * b, 1e-3), bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.9, bevelSegments: 3, curveSegments: 6 });
        g.translate(0, 0, -(d - 2 * b) / 2); return g;
      });
    }
    function mesh(geo, mat, x, y, z, parent, opt) {
      const m = new T.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      m.castShadow = !(opt && opt.noShadow); m.receiveShadow = true;
      (parent || viewer.root).add(m); // ebeveyn verilmezse sahne köküne; sonradan group.add() ile taşınabilir
      return m;
    }
    const kit = {
      T: T, mats: mats,
      /** Gölgeli, paylaşımlı geometrili kutu. */
      box: (w, h, d, mat, x, y, z, parent, opt) => mesh(boxGeo(w, h, d), mat, x, y, z, parent, opt),
      /** Silindir ve küre geometrileri de parametreye göre paylaşılır (geometriyi değiştirecekseniz önce clone()). */
      cyl: (rt, rb, h, mat, x, y, z, parent, seg) => { const n = lowSeg(seg || 24); return mesh(cached('c' + [rt, rb, h, n].join(','), () => new T.CylinderGeometry(rt, rb, h, n)), mat, x, y, z, parent); },
      sphere: (r, mat, x, y, z, parent) => mesh(cached('s' + r + (viewer.quality === 'low' ? 'l' : ''), () => (viewer.quality === 'low' ? new T.SphereGeometry(r, 12, 9) : new T.SphereGeometry(r, 20, 14))), mat, x, y, z, parent),
      /** Yuvarlatılmış kenarlı kutu (ExtrudeGeometry + bevel): pano gövdeleri, cihazlar. */
      rbox: (w, h, d, r, mat, x, y, z, parent) => mesh(rboxGeo(w, h, d, r), mat, x, y, z, parent),
      /** Yalnız geometri (sahneye mesh eklemez; InstancedMesh için). */
      rboxGeo: rboxGeo,
      group: (parent, x, y, z) => { const g = new T.Group(); g.position.set(x || 0, y || 0, z || 0); (parent || viewer.root).add(g); return g; },
      /** Statik süsleme grubu: build bitince alt mesh'leri malzeme başına tek geometride birleştirilir. İçine seçilebilir,
       * hareket eden, malzemesi değişen veya kabuk (şeffaflaşan) parça konmamalıdır. */
      staticGroup: (parent, x, y, z) => { const g = kit.group(parent, x, y, z); g.userData.vsStatic = true; return g; },
      /** Var olan grubu statik işaretler: kurulum sonunda doğrudan alt mesh'leri malzemeye göre birleştirilir.
       * Modülün sonradan malzemesini/konumunu değiştirdiği mesh'ler { noMerge } ile ya da ayrı grupta tutulmalıdır. */
      markStatic: g => { if (g) g.userData.vsStatic = true; return g; },
      tube: (points, radius, mat, parent, seg) => {
        const curve = new T.CatmullRomCurve3(points.map(p => Array.isArray(p) ? new T.Vector3(p[0], p[1], p[2]) : p), false, 'catmullrom', 0.2);
        const m = mesh(new T.TubeGeometry(curve, lowSeg(seg || Math.max(16, points.length * 10)), radius, viewer.quality === 'low' ? 6 : 10, false), mat, 0, 0, 0, parent);
        m.userData.curve = curve; return m;
      },
      /** Canvas dokulu düzlem: etiket plakası, ekran. draw(g, w, h) redraw() çağrısında çalışır;
       * redraw(sig) verilirse imza değişmedikçe yeniden çizilmez (gereksiz doku yüklemesi olmaz). */
      screen: (pw, ph, px, draw, parent, opt) => {
        // düşük katmanda küçük ekranlar yarı çözünürlükte (çizim kodu mantıksal px ile çalışmaya devam eder)
        const real = viewer.quality === 'low' && px > 192 && pw < 0.2 ? Math.round(px / 2) : px;
        const cv = document.createElement('canvas'); cv.width = real; cv.height = Math.round(real * ph / pw);
        const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
        const mat = new T.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0, emissive: (opt && opt.emissive) ? 0xffffff : 0x000000, emissiveMap: (opt && opt.emissive) ? tex : null, emissiveIntensity: (opt && opt.emissive) || 0 });
        const m = mesh(new T.PlaneGeometry(pw, ph), mat, 0, 0, 0, parent, { noShadow: true });
        m.castShadow = false;
        let last;
        m.redraw = function (sig) {
          if (sig !== undefined && sig === last) return;
          last = sig;
          const g = cv.getContext('2d'); g.setTransform(cv.width / px, 0, 0, cv.width / px, 0, 0);
          draw(g, px, Math.round(px * ph / pw)); tex.needsUpdate = true; viewer.dirty = true;
        };
        m.redraw(); return m;
      },
      ground: (size, mat, y) => {
        const g = mesh(new T.PlaneGeometry(size, size), mat || mats.concrete, 0, y || 0, 0, viewer.root);
        g.rotation.x = -Math.PI / 2; g.castShadow = false; g.userData.noClip = true; return g;
      },
      /** Bir eğri boyunca hareket eden enerji akış parçacıkları (InstancedMesh). Eğri bir kez örneklenir (LUT);
       * karede bellek ayırmaz. update() çizim gerekiyorsa true döner. */
      flow: (curve, count, color, size, parent) => {
        const geo = cached('fs' + (size || 0.02), () => new T.SphereGeometry(size || 0.02, 8, 6));
        const mat = new T.MeshBasicMaterial({ color: color || 0xfcd34d, transparent: true, opacity: 0.95 });
        const im = new T.InstancedMesh(geo, mat, count); im.castShadow = false; im.userData.noClip = false;
        (parent || viewer.root).add(im);
        const N = 128, lut = new Float32Array((N + 1) * 3), p = new T.Vector3();
        for (let i = 0; i <= N; i++) { curve.getPointAt(i / N, p); lut[i * 3] = p.x; lut[i * 3 + 1] = p.y; lut[i * 3 + 2] = p.z; }
        const id = new T.Matrix4(); for (let i = 0; i < count; i++) im.setMatrixAt(i, id);
        const arr = im.instanceMatrix.array;
        let phase = 0, drawn = false;
        const place = () => {
          for (let i = 0; i < count; i++) {
            const t = ((i / count + phase) % 1) * N, k = Math.floor(t), f = t - k, a = k * 3, b = Math.min(N, k + 1) * 3, o = i * 16 + 12;
            arr[o] = lut[a] + (lut[b] - lut[a]) * f; arr[o + 1] = lut[a + 1] + (lut[b + 1] - lut[a + 1]) * f; arr[o + 2] = lut[a + 2] + (lut[b + 2] - lut[a + 2]) * f;
          }
          im.instanceMatrix.needsUpdate = true;
        };
        const f = { mesh: im, speed: 0, dir: 1, visible: true,
          update(dt) {
            const vis = f.visible && f.speed > 0.0001;
            if (vis !== im.visible) { im.visible = vis; if (!vis) return true; }
            if (!vis) return false;
            if (reduceMotion) { if (drawn) return false; place(); drawn = true; return true; }
            phase = (phase + dt * f.speed * f.dir + 1000) % 1; place(); drawn = true;
            return dt > 0;
          } };
        viewer.animated.push(f); return f;
      },
      label: (text, obj, offset, cls) => viewer.addLabel(text, obj, offset, cls),
      /** Tıklanınca bilgi kartı açılan ekipman. actions(app) → [{ label, onClick(app), variant }] kartta düğme olarak çıkar
       * (ör. şalteri aç/kapat, butona bas); eylem sonrası kart güncel bilgiyle yenilenir. */
      pickable: (obj, title, info, actions) => { viewer.pickables.push({ obj: obj, title: title, info: info, actions: actions }); return obj; },
      shell: obj => { obj.traverse(o => { if (o.isMesh) viewer.shells.push(o); }); return obj; },
      explodable: (obj, dir) => { viewer.explodables.push({ obj: obj, base: obj.position.clone(), dir: new T.Vector3().fromArray(dir) }); return obj; },
      /** Isı rengi: 0 → mavi, 0.5 → yeşil/sarı, 1 → kırmızı. */
      heat: (t, target) => { t = E.clamp(t, 0, 1); const c = target || new T.Color(); return c.setHSL((1 - t) * 0.62, 0.85, 0.5); },
      /** Modülün kendi oluşturduğu malzeme: sRGB hex → doğrusal (sahne kurulumundan sonra eklenenler için). */
      mat: (hex, o) => { const m = new T.MeshStandardMaterial(Object.assign({ color: hex, roughness: 0.6, metalness: 0 }, o || {})); linearize(m); resources.add(m); return m; },
      /** Sahneler arası yeniden kullanılan (modül düzeyinde önbelleğe alınan) kaynak: yeniden kurulumda dispose edilmez. */
      keep: r => { if (r) viewer.keep.add(r); return r; },
      /** Bir sonraki karede yeniden çizim iste; shadows=true ise gölge haritası da yenilenir. */
      invalidate: shadows => { if (shadows) viewer.invalidateShadows(); else viewer.invalidate(); },
      linearize: linearize,
      viewer: viewer,
      get reducedMotion() { return reduceMotion; },
      quality: viewer.quality
    };
    return kit;
  }

  /* ------------------------------------------------------------------ uygulama */
  /** Kayıtlı ya da dosyadan yüklenen durumu varsayılan şablonla tip uyumlu birleştirir: eksik alanlar şablondan gelir,
   * tipi uymayan alanlar atılır, nesne dizilerinin her öğesi ilk şablon öğesiyle tamamlanır, prototip anahtarları yok sayılır. */
  const BAD_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };
  function sanitize(tpl, src) {
    if (src === undefined) return clone(tpl);
    if (tpl === null || tpl === undefined) return src === undefined ? tpl : clone(src);
    if (Array.isArray(tpl)) {
      if (!Array.isArray(src)) return clone(tpl);
      const t0 = tpl[0];
      if (t0 === undefined) return clone(src);
      if (t0 !== null && typeof t0 === 'object' && !Array.isArray(t0)) return src.filter(x => x && typeof x === 'object' && !Array.isArray(x)).map(x => sanitize(t0, x));
      return src.every(x => typeof x === typeof t0) ? clone(src) : clone(tpl);
    }
    if (typeof tpl === 'object') {
      if (!src || typeof src !== 'object' || Array.isArray(src)) return clone(tpl);
      const out = clone(tpl);
      Object.keys(src).forEach(k => { if (BAD_KEYS[k]) return; out[k] = k in tpl ? sanitize(tpl[k], src[k]) : clone(src[k]); });
      return out;
    }
    if (typeof tpl === 'number') return typeof src === 'number' && isFinite(src) ? src : tpl;
    return typeof src === typeof tpl ? src : tpl;
  }

  /* Ölçüm (js/vg-metrics.js; olay sözlüğü api/METRICS.md). Yalnızca modül kimliği ve sabit tür adları gider; girdiler,
     sonuç değerleri ve proje dosyası içeriği asla. Ölçüm hatası simülasyonu etkilemez. */
  function metric(name, props) {
    if (window.vgTrack) { try { window.vgTrack(name, props); } catch (_) { /* ölçüm kritik değil */ } }
  }
  const FAULT_KIND = { build: 'sahne', compute: 'hesap', report: 'rapor', load: 'dosya' };

  function App(def, rootEl) {
    this.def = def; this.root = rootEl;
    this.state = clone(def.defaults());
    this.live = def.initLive ? def.initLive(this.state) : {};
    this.running = !!def.autoRun; this.paused = false; this.simTime = 0;
    this.result = null; this.validResult = null;
    this.mode = '3d';
    this.schema = def.schema || 1; // durum biçimi değişince modülde artırılır; eski kayıtlar yok sayılır
    this.storageKey = 'voltsim:' + def.id + ':v1';
    this._open = {}; this._faults = {};
  }
  App.prototype.set = function (key, value, opts) {
    setPath(this.state, key, value);
    if (opts && opts.rebuild) this.renderControls(!opts.defer);
    this.invalidate();
  };
  App.prototype.get = function (key) { return getPath(this.state, key); };
  App.prototype.invalidate = function () {
    if (this._pending || this._disposed) return;
    this._pending = true;
    this._computeRaf = requestAnimationFrame(() => { this._pending = false; this.recompute(); });
  };
  /** Kaydırıcı sürüklenirken / sayı yazılırken sahne yeniden kurulumu ertelenir (hesap ve grafikler anında güncellenir). */
  App.prototype.holding = function () { return !!this._dragHold || performance.now() < (this._holdUntil || 0); };
  App.prototype.holdRebuild = function (ms) {
    this._holdUntil = performance.now() + ms; clearTimeout(this._holdT);
    this._holdT = setTimeout(() => { if (this._rebuildPending) this.invalidate(); }, ms + 30);
  };
  App.prototype.releaseHold = function () {
    if (!this._dragHold) return;
    this._dragHold = false;
    if (this._rebuildPending) this.invalidate();
    if (this._ctrlPending) setTimeout(() => { if (this._ctrlPending && !this.controlsBusy()) this.renderControls(); }, 0);
  };
  /** Bir kez hata bildirir; döngü ve uygulama çalışmayı sürdürür. */
  App.prototype.fault = function (where, err) {
    if (this._faults[where]) return; this._faults[where] = true;
    console.error('VoltSim ' + where + ':', err);
    metric('simulation_error', { sim: this.def.id, kind: FAULT_KIND[where] || 'calisma' });
    toast(where === 'build' ? '3D sahne kurulamadı; hesaplar, grafikler ve 2D şema çalışmaya devam ediyor.' : 'Sahnenin bir bölümü güncellenemedi (' + where + '); hesaplar etkilenmedi.', 'bad');
  };
  App.prototype.saveState = function () { storageSet(this.storageKey, JSON.stringify({ schema: this.schema, engine: E.version, savedAt: Date.now(), state: this.state })); };
  App.prototype.recompute = function () {
    if (this._disposed) return;
    let res;
    try { res = this.def.compute(this.state, this); } catch (err) {
      res = { ok: false, errors: ['Hesap hatası: ' + err.message], checks: [], values: {} }; console.error(err);
      metric('simulation_error', { sim: this.def.id, kind: 'hesap' });
    }
    this.result = res;
    if (res.ok) this.validResult = res;
    // simulation_result: kullanıcı açılıştaki durumu değiştirdikten sonra geçerli (hatasız) bir hesap sonucu (bir kez)
    if (res.ok && !this._resultSeen && this._state0 !== undefined && JSON.stringify(this.state) !== this._state0) {
      this._resultSeen = true; metric('simulation_result', { sim: this.def.id });
    }
    this.renderAnalysis();
    if (this.viewer) {
      let sig = null;
      try { sig = this.def.scene.rebuildOn ? this.def.scene.rebuildOn(this.state) : null; } catch (_) { sig = this._sceneSig; }
      if (this._forceRebuild || sig !== this._sceneSig) {
        if (!this._forceRebuild && this.holding()) this._rebuildPending = true;
        else this.rebuildScene(sig);
      }
      if (this.kit && this.validResult && this.def.scene.update && !this._sceneError) {
        try { this.def.scene.update(this.kit, this.validResult, this.state, this.live, this); } catch (e) { this.fault('update', e); }
      }
      this.viewer.invalidate();
    }
    if (this.mode === '2d') this.draw2d();
    this.updateBadge();
    this.checkTasks();
    clearTimeout(this._save); this._save = setTimeout(() => this.saveState(), 600);
  };
  App.prototype.say = function (text) {
    const r = this.root.querySelector('[data-vs-live]'); if (!r) return;
    r.textContent = ''; setTimeout(() => { r.textContent = text; }, 30);
  };
  App.prototype.updateBadge = function () {
    const b = this.root.querySelector('[data-vs-badge]'); if (!b) return;
    const r = this.result; let lv = 'ok', txt = 'Ön kontroller uygun';
    if (!r || !r.ok) { lv = 'bad'; txt = 'Girdi hatası'; }
    else {
      const f = r.checks.filter(c => c.status === 'fail').length, w = r.checks.filter(c => c.status === 'warn').length;
      if (f) { lv = 'bad'; txt = f + ' uygunsuzluk'; } else if (w) { lv = 'warn'; txt = w + ' uyarı'; }
    }
    if (this.def.badge && r && r.ok) { try { const custom = this.def.badge(r, this.state, this.live, this); if (custom) { lv = custom.level; txt = custom.text; } } catch (_) { } }
    // ekran okuyucuya yalnız seviye değişince duyurulur (rozet metni saniyede birkaç kez değişebilir)
    if (b.dataset.level !== lv && this._badgeInit) this.say('Durum: ' + txt);
    this._badgeInit = true;
    if (b.dataset.level !== lv) b.dataset.level = lv;
    if (b.textContent !== txt) b.textContent = txt;
  };

  /* --- kontroller (sol panel) */
  /** Kullanıcı bir kaydırıcıyı sürüklüyor ya da sayı/metin alanına yazıyorsa panel yeniden kurulmaz (ertelenir). */
  App.prototype.controlsBusy = function () {
    if (this._dragHold) return true;
    const host = this.root.querySelector('[data-vs-controls]'), a = document.activeElement;
    return !!(host && a && host.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(range|number|text)$/.test(a.type))));
  };
  App.prototype.renderControls = function (force) {
    if (!force && this.controlsBusy()) { this._ctrlPending = true; return; }
    this._ctrlPending = false;
    const host = this.root.querySelector('[data-vs-controls]');
    const act = document.activeElement && host.contains(document.activeElement) ? document.activeElement : null;
    const active = act ? act.dataset.key : null, activeVal = act ? act.getAttribute('data-v') : null;
    const scroll = host.scrollTop;
    host.innerHTML = '';
    const groups = typeof this.def.controls === 'function' ? this.def.controls(this.state, this) : this.def.controls;
    groups.forEach(gr => {
      if (!gr) return;
      const fs = el('fieldset', { class: 'vs-group' + (gr.collapsed !== undefined ? ' is-collapsible' : '') });
      const lg = el('legend', { class: 'vs-group__title', text: gr.title });
      fs.appendChild(lg);
      let body = fs;
      if (gr.collapsed !== undefined) {
        const key = String(gr.title).replace(/\s*\(\d+\)\s*$/, '');
        const open = this._open[key] !== undefined ? this._open[key] : !gr.collapsed;
        body = el('details', { open: open ? true : undefined }, [el('summary', { text: gr.summary || 'Ayrıntılar' })]);
        body.addEventListener('toggle', () => { this._open[key] = body.open; });
        fs.appendChild(body);
      }
      gr.items.forEach(it => { if (it) body.appendChild(this.control(it)); });
      host.appendChild(fs);
    });
    host.scrollTop = scroll;
    if (active) {
      const cands = Array.from(host.querySelectorAll('[data-key="' + active + '"]'));
      const n = cands.find(x => activeVal !== null && x.getAttribute('data-v') === activeVal) || cands.find(x => x.getAttribute('aria-checked') === 'true' || x.getAttribute('aria-pressed') === 'true') || cands[0];
      if (n) n.focus({ preventScroll: true });
    }
  };
  const digitsOf = it => (it.digits === undefined ? (it.step < 1 ? (it.step < 0.1 ? 2 : 1) : 0) : it.digits);
  App.prototype.control = function (it) {
    const id = nextId('vsc'), self = this;
    const val = it.key ? this.get(it.key) : undefined;
    const help = it.help ? el('p', { class: 'vs-help', id: id + '-h', text: it.help }) : null;
    if (it.type === 'range' || it.type === 'number') {
      const show = v => (it.fmt ? it.fmt(v) : fmt(v, digitsOf(it), it.unit));
      const out = el('output', { for: id, text: show(val) });
      const lab = el('label', { for: id }, [el('span', { text: it.label }), out]);
      // durum değeri aralık dışındaysa (ör. faz değişince güç sınırı) kaydırıcı değeri kırpmasın: aralık genişletilir
      let min = it.min, max = it.max;
      if (it.type === 'range' && typeof val === 'number' && isFinite(val)) { if (val < min) min = val; if (val > max) max = val; }
      const attrs = { id: id, type: it.type, min: min, max: max, step: it.step || 1, value: val, 'data-key': it.key, 'aria-describedby': help ? id + '-h' : undefined, class: it.type === 'range' ? 'vs-range' : 'vs-input', inputmode: it.type === 'number' ? 'decimal' : undefined };
      const input = el('input', attrs);
      const paint = () => { if (it.type === 'range') input.style.setProperty('--p', ((input.value - min) / ((max - min) || 1) * 100) + '%'); };
      paint();
      if (it.type === 'range') {
        input.addEventListener('pointerdown', () => { self._dragHold = true; });
        input.addEventListener('keydown', () => self.holdRebuild(450));
        input.addEventListener('change', () => self.releaseHold());
      }
      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (it.type === 'number' && (input.value === '' || !isFinite(v))) { input.setAttribute('aria-invalid', 'true'); return; }
        input.removeAttribute('aria-invalid');
        out.textContent = show(v);
        paint();
        if (it.type === 'number') self.holdRebuild(700);
        self.set(it.key, v, { rebuild: it.rebuild, defer: true });
      });
      return el('div', { class: 'vs-field' }, [lab, input, help]);
    }
    if (it.type === 'select') {
      const sel = el('select', { id: id, class: 'vs-select', 'data-key': it.key, 'aria-describedby': help ? id + '-h' : undefined });
      (it.options || []).forEach(o => { const v = Array.isArray(o) ? o[0] : o.value, l = Array.isArray(o) ? o[1] : o.label; sel.appendChild(el('option', { value: v, selected: String(v) === String(val) ? true : undefined, text: l })); });
      sel.addEventListener('change', () => { const raw = sel.value; const v = typeof val === 'number' ? Number(raw) : raw; self.set(it.key, v, { rebuild: it.rebuild }); if (it.onChange) it.onChange(v, self); });
      return el('div', { class: 'vs-field' }, [el('label', { for: id, text: it.label }), sel, help]);
    }
    if (it.type === 'toggle') {
      const cb = el('input', { type: 'checkbox', id: id, 'data-key': it.key, checked: val ? true : undefined });
      cb.addEventListener('change', () => { self.set(it.key, cb.checked, { rebuild: it.rebuild }); if (it.onChange) it.onChange(cb.checked, self); });
      return el('label', { class: 'vs-toggle', for: id }, [el('span', { text: it.label }), cb, el('span', { class: 'vs-sw', 'aria-hidden': 'true' })]);
    }
    if (it.type === 'seg') {
      const wrap = el('div', { class: 'vs-seg', role: 'radiogroup', 'aria-label': it.label });
      const btns = [];
      const pick = v => { self.set(it.key, typeof val === 'number' ? Number(v) : v, { rebuild: true }); if (it.onChange) it.onChange(v, self); };
      (it.options || []).forEach(o => {
        const v = Array.isArray(o) ? o[0] : o.value, l = Array.isArray(o) ? o[1] : o.label, on = String(v) === String(val);
        const b = el('button', { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', tabindex: on ? '0' : '-1', 'data-key': it.key, 'data-v': String(v), text: l });
        b.addEventListener('click', () => pick(v));
        b.addEventListener('keydown', e => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0; if (!d) return;
          e.preventDefault(); const i = btns.indexOf(b), n = btns[(i + d + btns.length) % btns.length]; n.click();
        });
        btns.push(b); wrap.appendChild(b);
      });
      if (!btns.some(b => b.getAttribute('tabindex') === '0') && btns[0]) btns[0].setAttribute('tabindex', '0');
      return el('div', { class: 'vs-field' }, [el('span', { class: 'vs-field__label', text: it.label }), wrap, help]);
    }
    if (it.type === 'chips') {
      const wrap = el('div', { class: 'vs-chips', role: 'group', 'aria-label': it.label });
      (it.options || []).forEach(o => {
        const b = el('button', { type: 'button', class: 'vs-chip', 'aria-pressed': String(o.value) === String(val) ? 'true' : 'false', 'data-key': it.key, 'data-v': String(o.value), style: o.color ? '--c:' + o.color : undefined }, [o.dot ? el('i', { 'aria-hidden': 'true' }) : null, o.label]);
        b.addEventListener('click', () => { self.set(it.key, o.value, { rebuild: true }); if (it.onChange) it.onChange(o.value, self); });
        wrap.appendChild(b);
      });
      return el('div', { class: 'vs-field' }, [it.label ? el('span', { class: 'vs-field__label', text: it.label }) : null, wrap]);
    }
    if (it.type === 'buttons') {
      return el('div', { class: 'vs-btns' }, it.items.map(b => el('button', { type: 'button', class: 'vs-btn' + (b.variant ? ' vs-btn--' + b.variant : ''), 'aria-pressed': b.pressed === undefined ? undefined : String(!!b.pressed), onclick: () => b.onClick(self), text: b.label })));
    }
    if (it.type === 'text') {
      const ta = el(it.multiline ? 'textarea' : 'input', { id: id, class: 'vs-input', 'data-key': it.key, placeholder: it.placeholder || '', rows: it.multiline ? 3 : undefined, 'aria-describedby': help ? id + '-h' : undefined });
      ta.value = it.format ? it.format(val) : (val === undefined || val === null ? '' : val);
      const err = el('p', { class: 'vs-help vs-help--err', hidden: true });
      ta.addEventListener('change', () => {
        try { const v = it.parse ? it.parse(ta.value) : ta.value; err.hidden = true; ta.removeAttribute('aria-invalid'); self.set(it.key, v, { rebuild: it.rebuild }); }
        catch (e) { err.hidden = false; err.textContent = e.message; ta.setAttribute('aria-invalid', 'true'); }
      });
      return el('div', { class: 'vs-field' }, [el('label', { for: id, text: it.label }), ta, err, help]);
    }
    if (it.type === 'note') return el('p', { class: 'vs-note' + (it.level ? ' vs-note--' + it.level : ''), html: it.html || esc(it.text) });
    if (it.type === 'custom') { const box = el('div', { class: 'vs-field' }); it.render(box, self); return box; }
    return el('span');
  };

  /* --- analiz (sağ panel) */
  App.prototype.renderAnalysis = function () {
    const host = this.root.querySelector('[data-vs-analysis]');
    const r = this.result, s = this.state;
    const parts = [];
    if (r && r.errors && r.errors.length) parts.push('<div class="vs-errors" role="alert"><strong>Girdi hatası</strong><ul>' + r.errors.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul><p>Sahne ve sonuçlar son geçerli değerleri gösteriyor.</p></div>');
    const vr = this.validResult;
    if (vr) {
      let ro = []; try { ro = this.def.readouts(vr, s, this.live, this) || []; } catch (e) { this.fault('readouts', e); }
      parts.push('<div class="vs-readouts">' + ro.map(x => '<div class="vs-ro' + (x.wide ? ' vs-ro--wide' : '') + '"' + (x.level ? ' data-level="' + x.level + '"' : '') + (x.hint ? ' title="' + esc(x.hint) + '"' : '') + '><span>' + esc(x.label) + '</span><b>' + esc(x.value) + '</b>' + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '</div>').join('') + '</div>');
    }
    // yalnız içerik değişince yazılır (seçim, ipucu ve ekran okuyucu konumu korunur)
    const roHtml = parts.join(''), roBox = host.querySelector('[data-vs-ro]');
    if (roBox._html !== roHtml) { roBox.innerHTML = roHtml; roBox._html = roHtml; }
    // grafikler: kanvaslar yeniden kullanılır
    const ch = host.querySelector('[data-vs-charts]');
    let charts = []; try { charts = vr && this.def.charts ? this.def.charts(vr, s, this.live, this) || [] : []; } catch (e) { this.fault('charts', e); }
    if (ch.dataset.sig !== charts.map(c => c.id).join(',')) {
      ch.innerHTML = ''; ch.dataset.sig = charts.map(c => c.id).join(',');
      charts.forEach(c => {
        const fig = el('figure', { class: 'vs-chart', 'data-chart': c.id });
        fig.appendChild(el('figcaption', { text: c.title }));
        fig.appendChild(el('canvas', { role: 'img', height: c.height || 150, style: 'height:' + (c.height || 150) + 'px' }));
        fig.appendChild(el('div', { class: 'vs-legend' }));
        fig.appendChild(el('details', { class: 'vs-chart__data' }, [el('summary', { text: 'Veri tablosu' }), el('div')]));
        ch.appendChild(fig);
      });
    }
    charts.forEach(c => {
      const fig = ch.querySelector('[data-chart="' + c.id + '"]'); if (!fig) return;
      const cv = fig.querySelector('canvas');
      cv.setAttribute('aria-label', c.title + '. ' + (c.alt || ''));
      drawChart(cv, c);
      fig.querySelector('.vs-legend').innerHTML = (c.series || []).filter(x => x.name).map(x => '<span><i style="background:' + (PALETTE[x.color] || x.color || PALETTE.amber) + '"></i>' + esc(x.name) + '</span>').join('');
      const det = fig.querySelector('details');
      if (det.open || !det.dataset.filled) {
        det.dataset.filled = '1';
        const first = (c.series || [])[0];
        if (first) {
          const step = Math.max(1, Math.ceil(first.data.length / 24));
          let html = '<table><thead><tr><th>' + esc(c.x && c.x.label || 'x') + '</th>' + c.series.map(x => '<th>' + esc(x.name || '') + '</th>').join('') + '</tr></thead><tbody>';
          for (let i = 0; i < first.data.length; i += step) html += '<tr><td>' + esc(c.x && c.x.fmt ? c.x.fmt(first.data[i][0]) : fmt(first.data[i][0], 1)) + '</td>' + c.series.map(x => '<td>' + (x.data[i] ? fmt(x.data[i][1], 2) : '') + '</td>').join('') + '</tr>';
          det.lastChild.innerHTML = html + '</tbody></table>';
        }
      }
    });
    // kontroller
    const ck = host.querySelector('[data-vs-checks]');
    const icon = { ok: '✓', warn: '!', fail: '✕', info: 'i' };
    const list = vr ? vr.checks : [];
    const order = { fail: 0, warn: 1, info: 3, ok: 2 };
    const ckHtml = list.slice().sort((a, b) => order[a.status] - order[b.status]).map(c => '<li data-status="' + c.status + '"><b aria-hidden="true">' + icon[c.status] + '</b><div><strong>' + esc(c.label) + '</strong><span>' + esc(c.detail) + '</span>' + (c.ref ? '<em>' + esc(c.ref) + '</em>' : '') + '</div><span class="sr-only">' + { ok: 'uygun', warn: 'uyarı', fail: 'uygun değil', info: 'bilgi' }[c.status] + '</span></li>').join('');
    if (ck._html !== ckHtml) { ck.innerHTML = ckHtml; ck._html = ckHtml; }
    const asm = host.querySelector('[data-vs-assumptions]');
    if (vr && asm.dataset.sig !== JSON.stringify(vr.assumptions)) {
      asm.dataset.sig = JSON.stringify(vr.assumptions);
      asm.innerHTML = '<h4>Varsayımlar</h4><ul>' + (vr.assumptions || []).map(a => '<li>' + esc(a) + '</li>').join('') + '</ul><h4>Kullanılan bağıntılar</h4><ul class="vs-formulas">' + (vr.formulas || []).map(a => '<li><code>' + esc(a) + '</code></li>').join('') + '</ul>';
    }
  };

  /* --- görevler (rehberli alıştırmalar) */
  App.prototype.taskKey = function () { return 'voltsim:' + this.def.id + ':tasks'; };
  App.prototype.loadTasks = function () { try { return JSON.parse(storageGet(this.taskKey()) || '{}') || {}; } catch (_) { return {}; } };
  App.prototype.checkTasks = function () {
    const tasks = this.def.tasks; if (!tasks || !tasks.length || !this.validResult) return;
    const done = this.doneTasks || (this.doneTasks = this.loadTasks());
    let changed = false;
    tasks.forEach(tk => {
      if (done[tk.id] || this.activeTask !== tk.id) return;
      // görev başlangıç durumunda (kullanıcı ya da benzetim henüz bir şey değiştirmeden) tamamlanmış sayılmaz
      if (this._taskState0 !== undefined) { if (JSON.stringify(this.state) === this._taskState0) return; this._taskState0 = undefined; }
      let ok = false;
      try { ok = !!tk.check(this.validResult, this.state, this.live, this); } catch (_) { ok = false; }
      if (ok) { done[tk.id] = Date.now(); changed = true; this.activeTask = null; toast('Görev tamamlandı: ' + tk.title, 'ok'); metric('task_complete', { sim: this.def.id }); }
    });
    if (changed) { storageSet(this.taskKey(), JSON.stringify(done)); }
    this.renderTasks();
  };
  App.prototype.startTask = function (tk) {
    // "Tekrarla": tamamlanmış görev yeniden değerlendirilebilsin
    if (this.doneTasks && this.doneTasks[tk.id]) { delete this.doneTasks[tk.id]; storageSet(this.taskKey(), JSON.stringify(this.doneTasks)); }
    if (tk.state) {
      this.state = Object.assign(clone(this.def.defaults()), clone(tk.state));
      this.live = this.def.initLive ? this.def.initLive(this.state) : {}; this.simTime = 0;
      this._forceRebuild = true; this.renderControls(true);
    }
    if (tk.start) { this.running = true; this.paused = false; if (this.def.start) this.def.start(this); this.syncToolbar(); }
    this.activeTask = tk.id;
    metric('simulation_run', { sim: this.def.id });
    this._taskState0 = JSON.stringify(this.state);
    this.recompute();
    toast('Görev: ' + tk.goal);
  };
  App.prototype.renderTasks = function () {
    const tasks = this.def.tasks; if (!tasks || !tasks.length) return;
    let box = this.root.querySelector('[data-vs-tasks]');
    if (!box) {
      const host = this.root.querySelector('[data-vs-analysis]');
      box = el('details', { class: 'vs-tasks', 'data-vs-tasks': '' });
      host.insertBefore(box, host.firstChild);
    }
    const done = this.doneTasks || (this.doneTasks = this.loadTasks());
    const n = tasks.filter(t => done[t.id]).length;
    const sig = n + '|' + this.activeTask;
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    const open = box.open || !!this.activeTask;
    box.innerHTML = '';
    box.appendChild(el('summary', {}, [el('span', { text: 'Görevler' }), el('b', { text: n + ' / ' + tasks.length })]));
    box.appendChild(el('p', { class: 'vs-small', text: 'Hedefi okuyun, “Başla” ile görevi açın ve parametrelerle ya da 3D sahnede ekipmana tıklayarak sonuca ulaşın. Kontrol hesap motorunun sonucuyla yapılır.' }));
    const ol = el('ol', { class: 'vs-tasklist' });
    tasks.forEach(tk => {
      const isDone = !!done[tk.id], isActive = this.activeTask === tk.id;
      const li = el('li', { 'data-state': isDone ? 'done' : isActive ? 'active' : '' });
      li.appendChild(el('strong', { text: tk.title }));
      li.appendChild(el('span', { text: tk.goal }));
      if (isActive && tk.hint) li.appendChild(el('em', { text: 'İpucu: ' + tk.hint }));
      const b = el('button', { type: 'button', class: 'vs-btn' + (isActive ? '' : ' vs-btn--primary'), text: isDone ? 'Tekrarla' : isActive ? 'Devam ediyor…' : 'Başla', disabled: isActive ? true : undefined });
      b.onclick = () => this.startTask(tk);
      li.appendChild(b);
      ol.appendChild(li);
    });
    box.appendChild(ol);
    if (n) box.appendChild(el('button', { type: 'button', class: 'vs-linkbtn', text: 'İlerlemeyi sıfırla', onclick: () => { this.doneTasks = {}; storageDel(this.taskKey()); box.dataset.sig = ''; this.renderTasks(); } }));
    box.open = open;
  };

  /* --- 2D şema modu */
  App.prototype.draw2d = function () {
    const cv = this.root.querySelector('[data-vs-2d]');
    if (!cv || !this.def.view2d || !this.validResult) return;
    // uzun şemalar için kaydırılabilir sarmalayıcı (rozet ve araç düğmeleri sabit kalır)
    let wrap = cv.parentElement;
    if (!wrap.classList.contains('vs-2dwrap')) { wrap = el('div', { class: 'vs-2dwrap' }); cv.parentElement.insertBefore(wrap, cv); wrap.appendChild(cv); }
    const W = wrap.clientWidth, Hs = wrap.clientHeight;
    if (!W || !Hs) return;
    const H = this.def.view2dHeight ? Math.max(Hs, Math.ceil(this.def.view2dHeight(W, this.validResult, this.state))) : Hs;
    cv.style.height = H + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b1a30'; g.fillRect(0, 0, W, H);
    try { this.def.view2d(g, W, H, this.validResult, this.state, this.live, this); } catch (e) { this.fault('2d', e); }
  };

  /* --- 3D */
  App.prototype.init3d = function () {
    const stage = this.root.querySelector('[data-vs-stage]');
    const canvas = stage.querySelector('canvas.vs-canvas');
    if (!window.THREE || !this.def.scene) return false;
    try {
      this.viewer = new Viewer(stage, canvas, { background: this.def.scene.background });
    } catch (e) { console.warn('WebGL başlatılamadı', e); metric('simulation_error', { sim: this.def.id, kind: 'webgl' }); return false; }
    this.viewer.wake = () => { if (this._wake) this._wake(); };
    this.kit = makeKit(this.viewer);
    try { this._sceneSig = this.def.scene.rebuildOn ? this.def.scene.rebuildOn(this.state) : null; } catch (_) { this._sceneSig = null; }
    try { this.def.scene.build(this.kit, this.state, this); this.finishScene(); }
    catch (e) { console.warn('3D sahne kurulamadı', e); metric('simulation_error', { sim: this.def.id, kind: 'sahne' }); this.viewer.dispose(); this.viewer = null; this.kit = null; return false; }
    const info = stage.querySelector('[data-vs-info]');
    info.tabIndex = -1;
    const close = () => { this.viewer.select(null); canvas.focus({ preventScroll: true }); };
    info.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    const showInfo = (p, viaKeyboard, focusCard) => {
      if (!p) { info.hidden = true; return; }
      let lines = [], acts = [], title = '';
      try { title = typeof p.title === 'function' ? p.title(this) : p.title; } catch (e) { this.fault('info', e); }
      try {
        lines = typeof p.info === 'function' ? p.info(this) || [] : p.info || [];
        acts = (typeof p.actions === 'function' ? p.actions(this) || [] : p.actions || []).filter(Boolean);
      } catch (e) { this.fault('info', e); }
      info.innerHTML = '<button type="button" class="vs-info__x" aria-label="Kapat">×</button><strong>' + esc(title) + '</strong>' + (lines.length ? '<ul>' + lines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '');
      if (acts.length) {
        const row = el('div', { class: 'vs-info__acts' });
        acts.forEach(a => row.appendChild(el('button', { type: 'button', class: 'vs-btn' + (a.variant ? ' vs-btn--' + a.variant : ''), text: a.label, onclick: () => {
          try { a.onClick(this); } catch (e) { this.fault('action', e); }
          this.renderControls(); this.invalidate();
          const back = info.contains(document.activeElement);
          requestAnimationFrame(() => requestAnimationFrame(() => { if (this.viewer && this.viewer.selected === p) { showInfo(p, false); if (back) { const b = info.querySelector('.vs-info__acts .vs-btn') || info; b.focus({ preventScroll: true }); } } }));
        } })));
        info.appendChild(row);
      }
      info.setAttribute('aria-label', 'Ekipman ayrıntısı: ' + title);
      info.hidden = false;
      info.querySelector('.vs-info__x').onclick = close;
      if (viaKeyboard) {
        this.say(title + (acts.length ? '. Ayrıntı ve işlemler için Enter.' : ''));
        if (focusCard) (info.querySelector('.vs-info__acts .vs-btn') || info).focus({ preventScroll: true });
      }
    };
    this.viewer.onSelect = showInfo;
    this.viewer.onContextLost = () => {
      const fb = this.root.querySelector('[data-vs-fallback]'); if (fb) { fb.hidden = false; fb.textContent = '3D görüntü bağlantısı kesildi. Hesaplar ve 2D şema kullanılabilir; bağlantı geri geldiğinde 3D görünüme geçebilirsiniz.'; }
      this.setMode('2d');
      this.root.querySelectorAll('[data-vs-3donly], [data-vs-act="mode"]').forEach(b => { b.disabled = true; });
    };
    this.viewer.onContextRestored = () => {
      const fb = this.root.querySelector('[data-vs-fallback]'); if (fb) fb.hidden = true;
      this.setMode(this.mode);
      this.root.querySelectorAll('[data-vs-3donly], [data-vs-act="mode"]').forEach(b => { b.disabled = false; });
      toast('3D görüntü bağlantısı geri geldi. Görünüm düğmesiyle 3D sahneye geçebilirsiniz.');
    };
    return true;
  };
  /** Build sonrası ortak adımlar: renk dönüşümü, statik grupların birleştirilmesi, küçük parçalarda gölgenin kapatılması. */
  App.prototype.finishScene = function () {
    const v = this.viewer, T = v.T;
    linearizeTree(v.scene);
    const owned = new Set(v._kitResources || []); v.keep.forEach(r => owned.add(r));
    const groups = []; v.root.traverse(o => { if (o.userData.vsStatic) groups.push(o); });
    const skip = new Set(v.shells); v.pickables.forEach(p => skip.add(p.obj)); v.explodables.forEach(x => skip.add(x.obj));
    groups.forEach(g => { try { mergeStatic(T, g, owned, skip); } catch (e) { console.warn('birleştirme atlandı', e); } });
    v.pruneShadows();
    v.applyTransparent();
    this._sceneError = false;
  };
  App.prototype.loop = function () {
    let last = 0, next = 0, acc = 0, lastRender = 0, idle = 0, shadowT = 0, wasAnim = false;
    this._visible = true; this._pageHidden = false; this._raf = 0;
    const awake = () => !this._disposed && !this._pageHidden && !document.hidden && this._visible;
    const schedule = () => { if (awake() && !this._raf) this._raf = requestAnimationFrame(step); };
    const sync = () => {
      if (!awake()) { cancelAnimationFrame(this._raf); this._raf = 0; last = next = 0; }
      else { if (this.viewer) this.viewer.dirty = true; schedule(); }
    };
    const FRAME = 1000 / 60, AMBIENT = 1000 / 30, AMBIENT_LOW = 1000 / 24;
    const step = now => {
      this._raf = 0; if (!awake()) { last = next = 0; return; }
      // High-refresh displays should not double the GPU load of an engineering
      // workspace. Keep elapsed time, and resume without a background time jump.
      if (next && now < next - 0.5) { schedule(); return; }
      next = now + FRAME - (next ? (now - next) % FRAME : 0);
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      const running = this.running && !this.paused && !!this.def.tick;
      if (running) {
        this.simTime += dt;
        let changed = false;
        try { changed = this.def.tick(this, dt); } catch (e) { this.fault('tick', e); }
        acc += dt;
        if (changed && acc > 0.2) { acc = 0; this.renderAnalysis(); this.updateBadge(); this.checkTasks(); if (this.mode === '2d') this.draw2d(); }
      }
      let keep = running;
      const v = this.viewer;
      if (v && !v.contextLost && v.visible && this.mode === '3d') {
        const animDt = this.paused ? 0 : dt;
        let anim = false, flows = false;
        if (this.def.scene.animate && this.validResult && this.kit && !this._sceneError) {
          // animate() çizim gerekiyorsa true döner; dönüş değeri olmayan eski modüller çalışırken her kare çizilir
          try { const r = this.def.scene.animate(this.kit, animDt, this.validResult, this.state, this.live, this); anim = r === undefined ? (this.running && !this.paused) : !!r; } catch (e) { this.fault('animate', e); }
        }
        // enerji akışları yalnız benzetim çalışırken hareket eder; duran/duraklatılmış sahne tamamen durağandır (kare çizilmez)
        const flowDt = this.running && !this.paused ? animDt : 0;
        for (let i = 0; i < v.animated.length; i++) { try { if (v.animated[i].update(flowDt)) flows = true; } catch (e) { this.fault('flow', e); } }
        // animasyon yeni durduysa son konumun gölgesi bir kez daha çizilir
        if (wasAnim && !anim) { v.renderer.shadowMap.needsUpdate = true; v.dirty = true; }
        wasAnim = anim;
        const cam = v.moving() || !!this._explodeRaf;
        const want = v.dirty || cam || anim || flows;
        // yalnız ortam animasyonu (akış, fan, dönen rotor) varken 30 fps yeterli (düşük katmanda 24 fps); kamera/etkileşimde tam hız
        const gap = !v.dirty && !cam ? (v.quality === 'low' ? AMBIENT_LOW : AMBIENT) : 0;
        if (want && now - lastRender >= gap - 1) {
          if (anim && now - shadowT > 200) { v.renderer.shadowMap.needsUpdate = true; shadowT = now; }
          try { v.frame(dt); } catch (e) { v.dirty = false; this.fault('render', e); }
          lastRender = now;
        }
        keep = keep || want;
      }
      // hiçbir şey değişmiyorsa birkaç kare sonra döngü durur; viewer.invalidate() / app.invalidate() yeniden uyandırır
      if (keep) { idle = 0; schedule(); } else if (++idle < 3) schedule(); else { last = next = 0; }
    };
    this._wake = schedule;
    this._loopSync = sync;
    document.addEventListener('visibilitychange', sync);
    const hide = e => { this._pageHidden = true; sync(); if (!e.persisted) this.dispose(); };
    const show = () => { this._pageHidden = false; sync(); };
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
    this._loopCleanup = () => { document.removeEventListener('visibilitychange', sync); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); };
    if ('IntersectionObserver' in window) {
      this._appObserver = new IntersectionObserver(es => { this._visible = es[0].isIntersecting; sync(); }); this._appObserver.observe(this.root);
    }
    schedule();
  };
  /** Simülasyon başlatıldı/devam ettirildiğinde döngüyü uyandır. */
  App.prototype.wake = function () { if (this.viewer) this.viewer.dirty = true; if (this._wake) this._wake(); };
  App.prototype.dispose = function () {
    if (this._disposed) return; this._disposed = true;
    cancelAnimationFrame(this._raf); cancelAnimationFrame(this._explodeRaf); cancelAnimationFrame(this._computeRaf);
    clearTimeout(this._save); clearTimeout(this._rs); clearTimeout(this._holdT);
    this.saveState();
    if (this._loopCleanup) this._loopCleanup();
    if (this._appObserver) this._appObserver.disconnect();
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._docCleanup) this._docCleanup();
    if (this.viewer) this.viewer.dispose();
  };
  App.prototype.setMode = function (mode) {
    this.mode = mode;
    const stage = this.root.querySelector('[data-vs-stage]');
    stage.dataset.mode = mode;
    const fallback = stage.querySelector('[data-vs-fallback]');
    stage.classList.toggle('has-fallback', !!(fallback && !fallback.hidden));
    const tab = this.root.querySelector('[data-vs-pane="stage"]'); if (tab) tab.textContent = mode === '2d' ? '2D Şema' : '3D Simülasyon';
    const b = this.root.querySelector('[data-vs-act="mode"]'); if (b) { b.setAttribute('aria-pressed', mode === '2d' ? 'true' : 'false'); b.querySelector('span').textContent = mode === '2d' ? '3D görünüm' : '2D şema'; }
    if (mode === '2d') this.draw2d(); else if (this.viewer) { this.viewer.resize(); this.viewer.invalidate(); }
  };

  /* --- proje kaydet / yükle */
  App.prototype.project = function () {
    return { format: 'voltsim-project', version: 1, schema: this.schema, module: this.def.id, title: this.def.title, savedAt: new Date().toISOString(), engine: E.version, state: this.state };
  };
  /** Sahneyi baştan kurmak ve analizleri yenilemek için ortak yol (senaryo, görev, sıfırlama, proje yükleme). */
  App.prototype.applyState = function (state) {
    this.state = state;
    this.live = this.def.initLive ? this.def.initLive(this.state) : {};
    this.simTime = 0; this.activeTask = null;
    this._forceRebuild = true;
    this.renderControls(true); this.recompute(); this.renderTasks();
  };
  App.prototype.loadProject = function (obj) {
    if (!obj || obj.format !== 'voltsim-project') throw new Error('Bu dosya bir VoltSim projesi değil.');
    if (obj.module !== this.def.id) throw new Error('Bu proje “' + (obj.title || obj.module) + '” simülasyonuna ait. İlgili simülasyon sayfasından yükleyin.');
    if (!obj.state || typeof obj.state !== 'object' || Array.isArray(obj.state)) throw new Error('Proje dosyasında girdi bulunamadı.');
    if (obj.schema && obj.schema > this.schema) throw new Error('Proje bu sayfadan daha yeni bir VoltSim sürümüyle kaydedilmiş.');
    const merged = sanitize(this.def.defaults(), obj.state);
    let test;
    try { test = this.def.compute(merged, this); } catch (e) { throw new Error('Proje bu sürümle hesaplanamadı: ' + e.message); }
    const prev = this.state;
    this.running = !!this.def.autoRun; this.paused = false;
    this.applyState(merged);
    if (this._sceneError) { this.applyState(prev); throw new Error('Proje 3D sahnede kurulamadı; önceki çalışmanız korundu.'); }
    if (this.running && this.def.start) { try { this.def.start(this); } catch (e) { this.fault('start', e); } }
    this.syncToolbar(); this.wake();
    return test;
  };
  App.prototype.rebuildScene = function (sig) {
    if (!this.viewer) return true;
    this._forceRebuild = false; this._rebuildPending = false;
    if (sig === undefined) { try { sig = this.def.scene.rebuildOn ? this.def.scene.rebuildOn(this.state) : null; } catch (_) { sig = null; } }
    this._sceneSig = sig;
    this.viewer.clear();
    this.kit = makeKit(this.viewer); this.scene3 = null;
    try {
      this.def.scene.build(this.kit, this.state, this);
      this.finishScene();
      const fb = this.root.querySelector('[data-vs-fallback]');
      if (fb && fb.dataset.build) { fb.hidden = true; delete fb.dataset.build; this.setMode(this.mode); }
      return true;
    } catch (e) {
      // başarısız kurulum: yarım sahne temizlenir, uygulama 2D şema ve hesaplarla devam eder
      this.viewer.clear(); this.kit = makeKit(this.viewer); this.scene3 = null; this._sceneError = true;
      this.fault('build', e);
      const fb = this.root.querySelector('[data-vs-fallback]');
      if (fb) { fb.hidden = false; fb.dataset.build = '1'; fb.textContent = '3D sahne bu girdilerle kurulamadı. Hesaplar ve 2D şema çalışıyor; girdileri değiştirin ya da Sıfırla ile varsayılana dönün.'; }
      return false;
    }
  };
  function download(name, mime, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const fileStem = id => 'voltsim-' + id + '-' + new Date().toISOString().slice(0, 10);

  /* --- CSV */
  App.prototype.csv = function () {
    const r = this.validResult; if (!r) throw new Error('Geçerli hesap sonucu yok.');
    const rows = [['Bölüm', 'Ad', 'Değer', 'Not']];
    flatInputs(this).forEach(x => rows.push(['Girdi', x.label, x.value, '']));
    this.def.readouts(r, this.state, this.live, this).forEach(x => rows.push(['Sonuç', x.label, x.value, x.sub || '']));
    r.checks.forEach(c => rows.push(['Kontrol', c.label, { ok: 'Uygun', warn: 'Uyarı', fail: 'Uygun değil', info: 'Bilgi' }[c.status], c.detail]));
    (this.def.charts ? this.def.charts(r, this.state, this.live, this) : []).forEach(c => {
      rows.push([]); rows.push(['Grafik', c.title, '', '']);
      rows.push([c.x && c.x.label || 'x'].concat(c.series.map(s => s.name || '')));
      const n = Math.max.apply(null, c.series.map(s => s.data.length));
      for (let i = 0; i < n; i++) rows.push([c.series[0].data[i] ? c.series[0].data[i][0] : ''].concat(c.series.map(s => s.data[i] ? s.data[i][1] : '')));
    });
    return '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
  };
  /** CSV hücresi: sayılarda ondalık virgül; metinde ; " satır sonu tırnaklanır; formül gibi başlayan metin (=, +, @, -harf)
   * elektronik tabloda çalıştırılmasın diye ' ile başlatılır. */
  function csvCell(v) {
    let s = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6).replace('.', ',') : String(v === undefined || v === null ? '' : v);
    if (typeof v !== 'number' && /^(?:[=+@\t\r]|-(?![\d,.]))/.test(s)) s = "'" + s;
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function flatInputs(app) {
    const out = [];
    const groups = typeof app.def.controls === 'function' ? app.def.controls(app.state, app) : app.def.controls;
    groups.forEach(g => g && g.items.forEach(it => {
      if (!it || !it.key || it.report === false) return;
      let v = app.get(it.key);
      if (it.type === 'select' || it.type === 'seg' || it.type === 'chips') { const o = (it.options || []).find(o => String(Array.isArray(o) ? o[0] : o.value) === String(v)); v = o ? (Array.isArray(o) ? o[1] : o.label) : v; }
      else if (it.type === 'toggle') v = v ? 'Evet' : 'Hayır';
      else if (it.fmt) v = it.fmt(v);
      else if (typeof v === 'number') v = fmt(v, digitsOf(it), it.unit);
      else if (it.format) v = it.format(v);
      out.push({ group: g.title, label: it.label, value: String(v) });
    }));
    if (app.def.reportInputs) app.def.reportInputs(app.state, app).forEach(x => out.push(x));
    return out;
  }

  /* --- Teklif taslağına aktarım (js/vg-quote.js; tek teklif sistemi /fabrika-cozumleri.html#teklif)
     Yalnızca kullanıcı bu pencerede gördüğü içeriği onaylarsa özet BU CİHAZDA saklanır; teklif sihirbazı içeriği
     yeniden gösterir ve form gönderilmedikçe hiçbir simülasyon değeri sunucuya gitmez. */
  const QUOTE_URL = '/fabrika-cozumleri.html?kaynak=voltsim#teklif';
  App.prototype.quotePayload = function () {
    const r = this.result;
    if (!r || !r.ok || !this.validResult) return null;
    let ro = []; try { ro = this.def.readouts(this.validResult, this.state, this.live, this) || []; } catch (_) { ro = []; }
    return {
      v: 1, kind: this.def.id, title: this.def.title, page: location.pathname, version: E.version,
      inputs: flatInputs(this).map(x => [x.label, x.value]),
      results: ro.map(x => [x.label, x.value + (x.sub ? ' (' + x.sub + ')' : '')]),
      assumptions: (this.validResult.assumptions || []).slice()
    };
  };
  App.prototype.openQuote = function (opener) {
    const Q = window.VGQuote;
    if (!Q || !Q.kinds[this.def.id]) { location.href = QUOTE_URL; return; }
    const payload = Q.normalize(this.quotePayload());
    let dlg = document.getElementById('vsQuoteDlg');
    if (!dlg) {
      dlg = el('dialog', { id: 'vsQuoteDlg', class: 'vs-qdlg', 'aria-labelledby': 'vsQuoteDlgH' });
      dlg.innerHTML = '<h2 id="vsQuoteDlgH">Teklif taslağına aktarılacak bilgiler</h2>'
        + '<p data-q-intro></p><pre class="vs-qdlg__pre" data-q-body tabindex="0"></pre>'
        + '<p class="vs-small">Simülasyon sonucu ön değerlendirmedir. Kesin fiyat, tasarruf ve uygulamanın tesisinize uygunluğu ancak keşif ve ölçümden sonra belirlenir.</p>'
        + '<div class="vs-qdlg__btns"><button type="button" class="vs-cbtn vs-cbtn--primary" data-q="add">Bilgileri taslağa ekle ve devam et</button>'
        + '<button type="button" class="vs-cbtn" data-q="skip">Bilgi eklemeden teklif formuna git</button>'
        + '<button type="button" class="vs-cbtn" data-q="close">Vazgeç</button></div>';
      document.body.appendChild(dlg);
      dlg.addEventListener('click', e => {
        const b = e.target.closest ? e.target.closest('[data-q]') : null;
        if (e.target === dlg) { dlg.close(); return; }
        if (!b) return;
        if (b.dataset.q === 'close') { dlg.close(); return; }
        if (b.dataset.q === 'add') {
          if (!Q.stage(dlg._payload)) { toast('Bilgiler bu tarayıcıda saklanamadı (depolama kapalı). Teklif formunu bilgi eklemeden açabilirsiniz.', 'bad'); return; }
        } else Q.unstage();
        location.href = QUOTE_URL;
      });
      dlg.addEventListener('close', () => { if (dlg._opener && dlg._opener.focus) dlg._opener.focus(); });
    }
    dlg._payload = payload; dlg._opener = opener || null;
    const add = dlg.querySelector('[data-q="add"]');
    add.hidden = !payload;
    dlg.querySelector('[data-q-intro]').textContent = payload
      ? 'Onaylarsanız aşağıdaki bilgiler yalnızca bu cihazda teklif taslağına eklenir. Teklif formunda yeniden görür, isterseniz çıkarırsınız; formu siz göndermedikçe hiçbir değer VoltGuard’a iletilmez.'
      : 'Girdilerde hata olduğu için şu anki sonuç aktarılamıyor. Hataları düzeltip yeniden deneyebilir ya da teklif formuna bilgi eklemeden geçebilirsiniz.';
    dlg.querySelector('[data-q-body]').textContent = payload ? Q.lines(payload).join('\n') : '';
    dlg.querySelector('[data-q-body]').hidden = !payload;
    if (typeof dlg.showModal === 'function') { dlg.showModal(); (payload ? add : dlg.querySelector('[data-q="skip"]')).focus(); }
    else location.href = QUOTE_URL;
  };

  /* --- PDF rapor (html2canvas + jsPDF; sitedeki /araclar/vendor kopyaları, ihtiyaç anında yüklenir) */
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector('script[data-src="' + src + '"]')) return res();
      const s = el('script', { src: src, 'data-src': src }); s.onload = () => res(); s.onerror = () => rej(new Error('Rapor kütüphanesi yüklenemedi: ' + src));
      document.head.appendChild(s);
    });
  }
  App.prototype.reportDOM = function () {
    const r = this.validResult, d = this.def, regs = (window.VoltSimRegs || []).filter(x => (x.applies || []).indexOf(d.id) >= 0);
    const now = new Date();
    const snap = this.viewer && this.mode === '3d' ? this.viewer.snapshot(1400) : (this.root.querySelector('[data-vs-2d]') ? (this.draw2d(), this.root.querySelector('[data-vs-2d]').toDataURL('image/png')) : null);
    const charts = Array.from(this.root.querySelectorAll('.vs-chart')).map(f => ({ title: f.querySelector('figcaption').textContent, img: f.querySelector('canvas').toDataURL('image/png') }));
    const blocks = [];
    // başlık, bölümün ilk parçasıyla aynı blokta tutulur (sayfa sonunda yetim başlık kalmaz)
    const section = (head, parts) => { (parts.length ? parts : ['']).forEach((p, i) => blocks.push((i ? '' : head) + p)); };
    blocks.push('<header class="rp-head"><img src="/public/voltguard-logo.webp" alt="" width="54" height="54"><div><strong>VoltGuard · VoltSim Teknik Raporu</strong><span>' + esc(d.title) + '</span></div><div class="rp-meta">' + esc(now.toLocaleDateString('tr-TR')) + ' ' + esc(now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })) + '<br>Motor sürümü ' + esc(E.version) + '</div></header>');
    blocks.push('<p class="rp-disc"><b>Önemli:</b> VoltSim mühendislik eğitimi ve ön değerlendirme amacıyla hazırlanmıştır. Nihai proje, ekipman seçimi, uygulama ve mevzuat uygunluğu yetkili mühendis tarafından değerlendirilmelidir. Bu rapor resmî proje onayı veya mevzuata uygunluk belgesi değildir.</p>');
    if (snap) blocks.push('<figure class="rp-fig"><img src="' + snap + '" alt=""><figcaption>Simülasyon görünümü</figcaption></figure>');
    const inputs = flatInputs(this);
    let grp = null, rows = '';
    inputs.forEach(x => { if (x.group !== grp) { grp = x.group; rows += '<tr class="rp-g"><td colspan="2">' + esc(grp || '') + '</td></tr>'; } rows += '<tr><td>' + esc(x.label) + '</td><td>' + esc(x.value) + '</td></tr>'; });
    section('<h2>1. Girilen değerler</h2>', chunkRows(rows, 22).map(part => '<table class="rp-t">' + part + '</table>'));
    const ro = d.readouts(r, this.state, this.live, this);
    section('<h2>2. Hesaplanan sonuçlar</h2>', chunkRows(ro.map(x => '<tr><td>' + esc(x.label) + '</td><td>' + esc(x.value) + (x.sub ? ' <small>' + esc(x.sub) + '</small>' : '') + '</td></tr>').join(''), 22).map(p => '<table class="rp-t">' + p + '</table>'));
    charts.forEach(c => blocks.push('<figure class="rp-chart"><img src="' + c.img + '" alt=""><figcaption>' + esc(c.title) + '</figcaption></figure>'));
    const st = { ok: 'Uygun', warn: 'Uyarı', fail: 'Uygun değil', info: 'Bilgi' };
    section('<h2>3. Uygunluk ön kontrolü</h2><p class="rp-small">Ön kontroller simülasyon modelinin sınırları içindedir; tasarım doğrulaması ve resmî onay yerine geçmez.</p>',
      chunkRows(r.checks.map(c => '<tr data-s="' + c.status + '"><td>' + esc(st[c.status]) + '</td><td><b>' + esc(c.label) + '</b><br>' + esc(c.detail) + (c.ref ? '<br><i>' + esc(c.ref) + '</i>' : '') + '</td></tr>').join(''), 9).map(p => '<table class="rp-t rp-checks">' + p + '</table>'));
    const list = (head, items, code) => { for (let i = 0; i < Math.max(1, items.length); i += 12) blocks.push((i ? '' : head) + '<ul class="rp-l">' + items.slice(i, i + 12).map(f => '<li>' + (code ? '<code>' + esc(f) + '</code>' : esc(f)) + '</li>').join('') + '</ul>'); };
    list('<h2>4. Kullanılan bağıntılar</h2>', r.formulas || [], true);
    list('<h2>5. Varsayımlar ve sınırlamalar</h2>', r.assumptions || [], false);
    section('<h2>6. Mevzuat ve standart kaynakları</h2><p class="rp-small">Bağlayıcı düzenlemeler (kanun/yönetmelik) ile gönüllü standartlar ayrı belirtilmiştir. Son kontrol tarihi: ' + esc(window.VoltSimRegsChecked || '') + '. Güncel konsolide metin resmî kaynaktan doğrulanmalıdır.</p>',
      chunkRows(regs.map(x => '<tr><td>' + esc(x.binding ? 'Bağlayıcı' : 'Standart / rehber') + '</td><td><b>' + esc(x.name) + '</b>' + (x.rg ? ' · RG ' + esc(x.rg) : '') + (x.version ? ' · ' + esc(x.version) : '') + (x.url ? '<br><span class="rp-url">' + esc(x.url) + '</span>' : '') + (x.needsCheck ? '<br><i>Güncel mevzuat doğrulaması gereklidir.</i>' : '') + '</td></tr>').join(''), 8).map(p => '<table class="rp-t rp-checks">' + p + '</table>'));
    blocks.push('<footer class="rp-foot">voltguard.com.tr · VoltSim · ' + esc(location.href.split('#')[0]) + '<br>Girdileriniz yalnızca tarayıcınızda işlenmiştir; bu rapor VoltGuard’a otomatik gönderilmez.</footer>');
    return blocks;
  };
  function chunkRows(html, n) {
    const rows = html.match(/<tr[\s\S]*?<\/tr>/g) || []; const out = [];
    for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n).join(''));
    return out.length ? out : [''];
  }
  App.prototype.pdf = async function () {
    await loadScript('/araclar/vendor/html2canvas.min.js');
    await loadScript('/araclar/vendor/jspdf.umd.min.js');
    const blocks = this.reportDOM();
    const host = el('div', { class: 'rp-host', 'aria-hidden': 'true' });
    document.body.appendChild(host);
    try {
      const PAGE_W = 794, PAGE_H = 1123, PAD = 46;
      const pages = [];
      let page = null, used = 0;
      const newPage = () => { page = el('div', { class: 'rp-page' }); host.appendChild(page); pages.push(page); used = PAD * 2; };
      newPage();
      for (const b of blocks) {
        const node = el('div', { class: 'rp-block', html: b }); // bloktaki tüm öğeler (başlık + tablo) birlikte taşınır
        page.appendChild(node);
        await waitImages(node);
        const h = node.getBoundingClientRect().height + 10;
        if (used + h > PAGE_H - 20 && page.children.length > 1) { page.removeChild(node); newPage(); page.appendChild(node); }
        used += h;
      }
      const jsPDF = window.jspdf.jsPDF;
      const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
      doc.setProperties({ title: 'VoltSim · ' + this.def.title, subject: 'VoltSim teknik raporu', author: 'VoltGuard', creator: 'VoltSim' });
      const scale = coarse ? 1.5 : 2; // mobil tarayıcıların tuval belleği sınırı
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        p.appendChild(el('div', { class: 'rp-num', text: 'Sayfa ' + (i + 1) + ' / ' + pages.length }));
        const cv = await window.html2canvas(p, { scale: scale, backgroundColor: '#ffffff', logging: false, width: PAGE_W, height: PAGE_H, windowWidth: PAGE_W });
        if (i) doc.addPage();
        doc.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
        cv.width = cv.height = 0;
      }
      download(fileStem(this.def.id) + '-rapor.pdf', 'application/pdf', doc.output('blob'));
    } finally { host.remove(); }
  };
  function waitImages(node) { return Promise.all(Array.from(node.querySelectorAll('img')).map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))); }

  /* --- araç çubuğu eylemleri */
  App.prototype.toggleExpanded = function (on) {
    const work = this.root.querySelector('.vs-work');
    work.classList.toggle('is-expanded', on); document.body.classList.toggle('vs-expanded', on);
    const b = this.root.querySelector('[data-vs-act="full"]'); if (b) b.setAttribute('aria-pressed', String(on));
    setTimeout(() => { if (this.viewer) this.viewer.resize(); this.renderAnalysis(); }, 120);
  };
  App.prototype.action = async function (act, btn) {
    try {
      if (act === 'start') {
        this.running = true; this.paused = false; this.simTime = 0;
        if (this.def.start) this.def.start(this); toast(this.def.startText || 'Simülasyon başlatıldı.');
        metric('simulation_run', { sim: this.def.id });
        // Geçerli sonuçla çalıştırılan benzetimin çıktısı ekranda: sonuç incelemesi sayılır (sayfa başına bir kez)
        if (this.validResult && !this._resultSeen) { this._resultSeen = true; metric('simulation_result', { sim: this.def.id }); }
      } else if (act === 'pause') {
        if (!this.running) { this.running = true; this.paused = false; if (this.def.start && !this._startedOnce) this.def.start(this); }
        else this.paused = !this.paused;
      } else if (act === 'reset') {
        storageDel(this.storageKey);
        this.running = !!this.def.autoRun; this.paused = false;
        this.applyState(clone(this.def.defaults()));
        if (this.running && this.def.start) this.def.start(this);
        if (this.viewer) this.viewer.resetView();
        toast('Varsayılan değerlere dönüldü.');
      } else if (act === 'camera') { if (this.viewer) this.viewer.resetView(); }
      else if (act === 'full') {
        const work = this.root.querySelector('.vs-work');
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen());
        else if (work.classList.contains('is-expanded')) this.toggleExpanded(false);
        else if (document.fullscreenEnabled && work.requestFullscreen) await work.requestFullscreen();
        else if (document.webkitFullscreenEnabled && work.webkitRequestFullscreen) work.webkitRequestFullscreen();
        else this.toggleExpanded(true);
        setTimeout(() => { if (this.viewer) this.viewer.resize(); this.renderAnalysis(); }, 120);
      } else if (act === 'mode') this.setMode(this.mode === '3d' ? '2d' : '3d');
      else if (act === 'report') {
        btn && (btn.disabled = true); toast('Rapor hazırlanıyor…');
        try { await this.pdf(); } catch (e) { metric('simulation_error', { sim: this.def.id, kind: 'rapor' }); throw e; }
        toast('PDF rapor indirildi.', 'ok'); metric('report_download', { sim: this.def.id, fmt: 'pdf' });
      }
      else if (act === 'csv') { download(fileStem(this.def.id) + '.csv', 'text/csv;charset=utf-8', this.csv()); toast('CSV indirildi.', 'ok'); metric('report_download', { sim: this.def.id, fmt: 'csv' }); }
      else if (act === 'quote') this.openQuote(btn);
      else if (act === 'save') { download(fileStem(this.def.id) + '.voltsim.json', 'application/json', JSON.stringify(this.project(), null, 2)); toast('Proje dosyası indirildi.', 'ok'); metric('scenario_save', { sim: this.def.id, kind: 'dosya' }); }
      else if (act === 'load') { this.root.querySelector('[data-vs-file]').click(); }
      else if (act === 'spin') { if (this.viewer) { this.viewer.autoSpin = !this.viewer.autoSpin; btn.setAttribute('aria-pressed', String(this.viewer.autoSpin)); this.viewer.invalidate(); } }
      else if (act === 'labels') { if (this.viewer) { this.viewer.showLabels = !this.viewer.showLabels; btn.setAttribute('aria-pressed', String(this.viewer.showLabels)); this.viewer.invalidate(); } }
      else if (act === 'ghost') { if (this.viewer) { this.viewer.transparent = !this.viewer.transparent; this.viewer.applyTransparent(); btn.setAttribute('aria-pressed', String(this.viewer.transparent)); } }
      else if (act === 'section') {
        if (!this.viewer) return;
        this.viewer.clipOn = !this.viewer.clipOn; btn.setAttribute('aria-pressed', String(this.viewer.clipOn));
        const sl = this.root.querySelector('[data-vs-clip]'); sl.hidden = !this.viewer.clipOn;
        this.setClip(Number(sl.querySelector('input').value)); this.viewer.applyClip();
      } else if (act === 'explode') {
        if (!this.viewer) return;
        cancelAnimationFrame(this._explodeRaf);
        const on = btn.getAttribute('aria-pressed') !== 'true'; btn.setAttribute('aria-pressed', String(on));
        const from = this.viewer.explode, to = on ? 1 : 0, t0 = performance.now();
        const anim = now => { if (this._disposed) return; const k = Math.min(1, (now - t0) / (reduceMotion ? 1 : 500)); this.viewer.explode = from + (to - from) * (1 - Math.pow(1 - k, 3)); this._explodeRaf = k < 1 ? requestAnimationFrame(anim) : 0; this.viewer.invalidateShadows(); };
        this._explodeRaf = requestAnimationFrame(anim);
      }
      this.syncToolbar(); this.wake();
    } catch (e) { console.error(e); toast(e.message || 'İşlem tamamlanamadı.', 'bad'); }
    finally { if (btn) btn.disabled = false; }
  };
  App.prototype.setClip = function (pct) {
    if (!this.viewer) return;
    const b = this.def.scene.bounds || [-2, 2];
    this.viewer.clipPlane.constant = b[0] + (b[1] - b[0]) * pct / 100;
    this.viewer.invalidateShadows();
  };
  App.prototype.syncToolbar = function () {
    const p = this.root.querySelector('[data-vs-act="pause"]');
    // aria-pressed = duraklatıldı mı; etiket yapılacak işi söyler
    if (p) { const stopped = !this.running || this.paused; p.setAttribute('aria-pressed', String(stopped)); p.querySelector('span').textContent = stopped ? 'Devam et' : 'Duraklat'; p.setAttribute('aria-label', stopped ? 'Simülasyona devam et' : 'Simülasyonu duraklat'); }
    const st = this.root.querySelector('[data-vs-act="start"]');
    if (st) st.querySelector('span').textContent = this.running && this.simTime > 0 ? 'Yeniden başlat' : 'Simülasyonu başlat';
  };

  /* --- kurulum */
  App.prototype.restoreSaved = function () {
    const saved = storageGet(this.storageKey);
    if (!saved) return false;
    try {
      const o = JSON.parse(saved);
      if (!o || !o.state || typeof o.state !== 'object') return false;
      if ((o.schema || 1) !== this.schema) { storageDel(this.storageKey); return false; }
      const st = sanitize(this.def.defaults(), o.state);
      this.def.compute(st, this); // hesap istisna atıyorsa kayıt bu sürümle uyumsuzdur
      this.state = st; return true;
    } catch (_) { storageDel(this.storageKey); return false; }
  };
  App.prototype.mount = function () {
    const self = this, root = this.root, d = this.def;
    // canlı bölgeler baştan var olmalı (ilk duyuru kaçmasın)
    if (!document.getElementById('vsToast')) document.body.appendChild(el('div', { id: 'vsToast', class: 'vs-toast', role: 'status', 'aria-live': 'polite' }));
    if (!root.querySelector('[data-vs-live]')) root.appendChild(el('div', { class: 'sr-only', 'data-vs-live': '', role: 'status', 'aria-live': 'polite' }));
    // senaryolar
    const sc = root.querySelector('[data-vs-scenario]');
    if (sc) {
      (d.scenarios || []).forEach(s => sc.appendChild(el('option', { value: s.id, text: s.name })));
      sc.addEventListener('change', () => {
        const s = (d.scenarios || []).find(x => x.id === sc.value); if (!s) return;
        const st = Object.assign(clone(d.defaults()), clone(s.state || {}));
        if (s.apply) s.apply(st);
        self.applyState(st);
        if (s.start) { self.running = true; self.paused = false; if (d.start) d.start(self); }
        self.syncToolbar(); self.wake();
        toast('Senaryo yüklendi: ' + s.name);
        const desc = root.querySelector('[data-vs-scenario-desc]'); if (desc) desc.textContent = s.desc || '';
        sc.value = '';
      });
    }
    root.querySelectorAll('[data-vs-act]').forEach(b => b.addEventListener('click', () => self.action(b.dataset.vsAct, b)));
    // sayfa altındaki teklif bağlantısı uygulama kökü dışında; JavaScript yoksa doğrudan teklif formuna gider
    document.querySelectorAll('[data-vs-quote-open]').forEach(a => a.addEventListener('click', e => {
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); self.action('quote', a);
    }));
    const clip = root.querySelector('[data-vs-clip] input');
    if (clip) clip.addEventListener('input', () => self.setClip(Number(clip.value)));
    const file = root.querySelector('[data-vs-file]');
    file.addEventListener('change', () => {
      const f = file.files[0]; if (!f) return;
      if (f.size > 2 * 1024 * 1024) { toast('Dosya çok büyük (en çok 2 MB).', 'bad'); return; }
      const rd = new FileReader();
      rd.onload = () => {
        try { const t = self.loadProject(JSON.parse(rd.result)); toast(t && t.ok === false ? 'Proje yüklendi; girdilerde hata var (Analiz panelinde).' : 'Proje yüklendi.', t && t.ok === false ? 'bad' : 'ok'); }
        catch (e) { toast(e.message || 'Proje okunamadı.', 'bad'); metric('simulation_error', { sim: self.def.id, kind: 'dosya' }); }
        file.value = '';
      };
      rd.readAsText(f);
    });
    // mobil sekmeler
    const tabs = Array.from(root.querySelectorAll('[data-vs-pane]'));
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => {
        tabs.forEach(x => { x.setAttribute('aria-selected', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
        root.querySelector('.vs-work').dataset.pane = b.dataset.vsPane;
        setTimeout(() => { if (self.viewer) self.viewer.resize(); self.renderAnalysis(); if (self.mode === '2d') self.draw2d(); }, 30);
      });
      // WAI-ARIA sekme deseni: ←/→, Home/End
      b.addEventListener('keydown', e => {
        const n = tabs.length, j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
        if (j < 0) return; e.preventDefault(); tabs[j].focus(); tabs[j].click();
      });
    });
    // panel kullanımı bitince ertelenen yeniden kurulumlar uygulanır
    const host = root.querySelector('[data-vs-controls]');
    const onUp = () => self.releaseHold();
    const onKey = e => { if (e.key === 'Escape' && root.querySelector('.vs-work.is-expanded')) self.toggleExpanded(false); };
    document.addEventListener('pointerup', onUp); document.addEventListener('pointercancel', onUp); document.addEventListener('keydown', onKey);
    host.addEventListener('focusout', () => setTimeout(() => { if (self._ctrlPending && !self.controlsBusy()) self.renderControls(); if (self._rebuildPending && !self.holding()) self.invalidate(); }, 0));
    this._docCleanup = () => { document.removeEventListener('pointerup', onUp); document.removeEventListener('pointercancel', onUp); document.removeEventListener('keydown', onKey); };
    // kayıtlı oturum (şema sürümü ve tip denetimiyle)
    this._restored = this.restoreSaved();
    let ok3d = this.init3d();
    if (!ok3d && this._restored && window.THREE) {
      // eski/uyumsuz kayıt sahneyi kuramadı: kayıt atılır, varsayılanla yeniden denenir
      storageDel(this.storageKey); this.state = clone(d.defaults()); this._restored = false;
      ok3d = this.init3d();
      toast('Kayıtlı çalışma bu sürümle açılamadı; varsayılan değerlere dönüldü.', 'bad');
    }
    if (!ok3d) {
      const fb = root.querySelector('[data-vs-fallback]'); if (fb) fb.hidden = false;
      const mb = root.querySelector('[data-vs-act="mode"]'); if (mb) mb.disabled = true;
      root.querySelectorAll('[data-vs-3donly]').forEach(b => { b.disabled = true; });
      this.setMode('2d');
    } else {
      const v = d.scene.view; if (v) this.viewer.setView(v);
      if (d.scene.shadowBox) this.viewer.setShadowBox(d.scene.shadowBox[0], d.scene.shadowBox[1]);
    }
    if (d.initLive) this.live = d.initLive(this.state);
    this.renderControls(true); this.recompute();
    if (this._restored) toast('Son çalışmanız geri yüklendi. Sıfırla ile varsayılana dönebilirsiniz.');
    if (this.running && d.start) { try { d.start(this); } catch (e) { this.fault('start', e); } }
    this.syncToolbar();
    this._onResize = () => { clearTimeout(self._rs); self._rs = setTimeout(() => { self.renderAnalysis(); if (self.mode === '2d') self.draw2d(); }, 150); };
    window.addEventListener('resize', this._onResize);
    this.loop();
    root.dataset.ready = 'true';
  };

  /* ------------------------------------------------------------------ dışa açık API */
  window.VoltSim = {
    E: E, toast: toast, fmt: fmt, fmtPower: fmtPower, fmtEnergy: fmtEnergy, fmtDuration: fmtDuration, esc: esc, el: el, PALETTE: PALETTE, drawChart: drawChart,
    fitText: fitText, sanitize: sanitize, csvCell: csvCell,
    get reduceMotion() { return reduceMotion; },
    register: function (def) { modules[def.id] = def; },
    modules: modules,
    get app() { return window.__vsApp; }
  };
  if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener('change', e => { reduceMotion = e.matches; if (window.__vsApp) window.__vsApp.wake(); });
  function boot() {
    const root = document.querySelector('[data-vs-module]');
    if (!root) return;
    const def = modules[root.dataset.vsModule];
    if (!def) {
      root.querySelector('[data-vs-analysis]').textContent = 'Simülasyon modülü yüklenemedi.';
      metric('simulation_error', { sim: String(root.dataset.vsModule || ''), kind: 'calisma' });
      return;
    }
    const app = new App(def, root); window.__vsApp = app;
    app.mount();
    // simulation_open: modül sayfası açıldı ve uygulama kuruldu (sayfa görüntülemesi başına bir kez)
    app._state0 = JSON.stringify(app.state);
    metric('simulation_open', { sim: def.id });
    // Favori yıldızı (js/vg-favorite.js): bu tarayıcıya, giriş yapılmışsa hesaba kaydeder.
    if (!document.querySelector('script[src^="/js/vg-favorite.js"]')) { const fav = document.createElement('script'); fav.src = '/js/vg-favorite.js'; fav.defer = true; document.head.appendChild(fav); }
  }
  // defer betikleri DOMContentLoaded'dan önce sırayla çalışır; modül dosyaları kaydolduktan sonra başlatılır.
  if (document.readyState === 'complete') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
