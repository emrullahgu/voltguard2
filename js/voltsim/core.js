/* VoltSim çekirdeği — modül kaydı, 3 panelli çalışma alanı, 3D görüntüleyici, 2D şema modu, grafikler,
 * rapor (PDF/JSON/CSV), proje kaydet/yükle. Hesaplar js/voltsim/engine.js içindedir; buradaki hiçbir değer
 * animasyondan türetilmez: sahne, hesap sonucunu görselleştirir. */
(function () {
  'use strict';
  const E = window.VoltSimEngine;
  const modules = {};
  const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  /* ------------------------------------------------------------------ biçimlendirme */
  const nf = {};
  function fmt(v, d, unit) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    d = d === undefined ? 1 : d;
    const key = d;
    if (!nf[key]) nf[key] = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
    return nf[key].format(v) + (unit ? ' ' + unit : '');
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
    const h = Math.floor(min / 60), m = Math.round(min % 60);
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
  function drawChart(canvas, spec) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth || 300, H = canvas.clientHeight || 160;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const pad = { l: 44, r: 10, t: 10, b: 30 };
    const series = (spec.series || []).filter(s => s.data && s.data.length);
    let xs = [], ys = [];
    series.forEach(s => s.data.forEach(p => { xs.push(p[0]); ys.push(p[1]); }));
    (spec.hLines || []).forEach(h => ys.push(h.y));
    let xmin = spec.x && spec.x.min !== undefined ? spec.x.min : Math.min.apply(null, xs.concat([0]));
    let xmax = spec.x && spec.x.max !== undefined ? spec.x.max : Math.max.apply(null, xs.concat([1]));
    let ymin = spec.y && spec.y.min !== undefined ? spec.y.min : Math.min(0, Math.min.apply(null, ys.concat([0])));
    let ymax = spec.y && spec.y.max !== undefined ? spec.y.max : Math.max.apply(null, ys.concat([1])) * 1.08;
    if (ymax <= ymin) ymax = ymin + 1; if (xmax <= xmin) xmax = xmin + 1;
    const X = x => pad.l + (x - xmin) / (xmax - xmin) * (W - pad.l - pad.r);
    const Y = y => H - pad.b - (y - ymin) / (ymax - ymin) * (H - pad.t - pad.b);
    g.font = '10px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(148,163,184,.16)'; g.fillStyle = '#8ea3bf'; g.lineWidth = 1;
    const yt = spec.y && spec.y.ticks ? spec.y.ticks : niceTicks(ymin, ymax, 4), xt = spec.x && spec.x.ticks ? spec.x.ticks : niceTicks(xmin, xmax, Math.max(3, Math.floor(W / 70)));
    g.textAlign = 'right';
    yt.forEach(v => { const y = Y(v); g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.fillText((spec.y && spec.y.fmt ? spec.y.fmt(v) : fmt(v, Math.abs(v) < 10 && v % 1 ? 1 : 0)), pad.l - 6, y); });
    g.textAlign = 'center'; g.textBaseline = 'top';
    xt.forEach(v => { const x = X(v); if (x < pad.l - 1 || x > W - pad.r + 1) return; g.fillText(spec.x && spec.x.fmt ? spec.x.fmt(v) : fmt(v, v % 1 ? 1 : 0), x, H - pad.b + 6); });
    if (spec.x && spec.x.label) { g.textAlign = 'right'; g.fillStyle = '#6f84a1'; g.fillText(spec.x.label, W - pad.r, H - 12); }
    if (spec.y && spec.y.label) { g.save(); g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = '#6f84a1'; g.fillText(spec.y.label, pad.l + 4, pad.t); g.restore(); }
    (spec.hLines || []).forEach(h => {
      g.save(); g.setLineDash([4, 4]); g.strokeStyle = h.color || PALETTE.red; g.beginPath(); g.moveTo(pad.l, Y(h.y)); g.lineTo(W - pad.r, Y(h.y)); g.stroke(); g.restore();
      if (h.label) { g.fillStyle = h.color || PALETTE.red; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(h.label, W - pad.r - 2, Y(h.y) - 2); }
    });
    series.forEach((s, si) => {
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
      void si;
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
  function Viewer(stage, canvas, opts) {
    const T = window.THREE;
    this.T = T; this.stage = stage; this.canvas = canvas; this.opts = opts || {};
    const quality = coarse || (navigator.hardwareConcurrency || 4) <= 4 ? 'low' : 'high';
    this.quality = quality;
    const r = new T.WebGLRenderer({ canvas: canvas, antialias: quality === 'high', alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
    r.outputEncoding = T.sRGBEncoding; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = opts.exposure || 0.92;
    r.physicallyCorrectLights = true;
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
    r.localClippingEnabled = true;
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
    this.visible = true; this.running = true;
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }).observe(stage);
    window.addEventListener('resize', () => this.resize());
    if ('ResizeObserver' in window) new ResizeObserver(() => this.resize()).observe(stage);
  }
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
  };
  Viewer.prototype.resize = function () {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  };
  Viewer.prototype._bindControls = function () {
    const c = this.canvas, self = this;
    const pts = new Map();
    let last = null, moved = 0, pinch = 0, panMode = false;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = { x: e.clientX, y: e.clientY }; moved = 0; panMode = e.button === 2 || e.shiftKey || pts.size === 2;
      if (pts.size === 2) { const a = Array.from(pts.values()); pinch = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
      c.classList.add('is-drag'); self.autoSpinPaused = true; self._hideHint();
    });
    let hoverT = 0;
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) {
        if (e.pointerType === 'mouse' && performance.now() - hoverT > 90) { hoverT = performance.now(); c.style.cursor = self._hit(e) ? 'pointer' : ''; }
        return;
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const a = Array.from(pts.values()); const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (pinch) self.zoom(pinch / d); pinch = d;
        const mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
        if (last && last.pair) self.pan(mx - last.x, my - last.y);
        last = { x: mx, y: my, pair: true }; moved += 10; return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y; moved += Math.abs(dx) + Math.abs(dy);
      if (panMode) self.pan(dx, dy);
      else { self.damp.theta = -dx * 0.0062; self.damp.phi = -dy * 0.0062; self.sph.theta += self.damp.theta; self.sph.phi += self.damp.phi; }
      last = { x: e.clientX, y: e.clientY };
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId); c.classList.remove('is-drag');
      if (moved < 6 && e.type === 'pointerup' && pts.size === 0) self._pick(e);
      if (pts.size === 0) { pinch = 0; last = null; }
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => { e.preventDefault(); self.zoom(Math.exp(e.deltaY * 0.0012)); self._hideHint(); }, { passive: false });
    c.tabIndex = 0;
    c.addEventListener('keydown', e => {
      const k = e.key; let used = true;
      if (k === 'ArrowLeft') self.sph.theta -= 0.12; else if (k === 'ArrowRight') self.sph.theta += 0.12;
      else if (k === 'ArrowUp') self.sph.phi -= 0.08; else if (k === 'ArrowDown') self.sph.phi += 0.08;
      else if (k === '+' || k === '=') self.zoom(0.88); else if (k === '-') self.zoom(1.14);
      else if (k === '0') self.resetView(); else used = false;
      if (used) e.preventDefault();
    });
  };
  Viewer.prototype._hideHint = function () { const h = this.stage.querySelector('.vs-hint'); if (h) h.classList.add('is-hidden'); };
  Viewer.prototype.zoom = function (k) { this.sph.r = E.clamp(this.sph.r * k, this.limits.rMin, this.limits.rMax); };
  Viewer.prototype.pan = function (dx, dy) {
    const T = this.T, s = this.sph.r * 0.0016;
    const right = new T.Vector3().setFromMatrixColumn(this.camera.matrix, 0), up = new T.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  };
  /** İmleç altındaki seçilebilir ekipman (yoksa null). */
  Viewer.prototype._hit = function (e) {
    if (!this.pickables.length) return null;
    const T = this.T, rect = this.canvas.getBoundingClientRect();
    const m = new T.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    const rc = this._rc || (this._rc = new T.Raycaster()); rc.setFromCamera(m, this.camera);
    const objs = this.pickables.filter(p => p.obj.visible).map(p => p.obj);
    const hit = rc.intersectObjects(objs, true).find(h => !this.clipOn || this.clipPlane.distanceToPoint(h.point) >= 0);
    if (!hit) return null;
    let o = hit.object; let p = null;
    while (o && !p) { p = this.pickables.find(x => x.obj === o); o = o.parent; }
    return p;
  };
  Viewer.prototype._pick = function (e) { this.select(this._hit(e)); };
  Viewer.prototype.select = function (p) {
    if (this.selected && this.selected.box) { this.root.remove(this.selected.box); }
    this.selected = p;
    if (p) {
      const T = this.T;
      const box = new T.BoxHelper(p.obj, 0xfcd34d); box.material.depthTest = false; box.renderOrder = 10; box.material.transparent = true; box.material.opacity = 0.9;
      p.box = box; this.root.add(box);
    }
    if (this.onSelect) this.onSelect(p);
  };
  Viewer.prototype.addLabel = function (text, obj, offset, cls) {
    const T = this.T;
    const node = el('span', { class: 'vs-label' + (cls ? ' ' + cls : '') }); node.textContent = text;
    this.labelLayer.appendChild(node);
    const l = { el: node, obj: obj, off: new T.Vector3().fromArray(offset || [0, 0, 0]), set: t => { if (node.textContent !== t) node.textContent = t; }, level: lv => { node.dataset.level = lv || ''; } };
    this.labels.push(l); return l;
  };
  Viewer.prototype.clear = function () {
    this.labels.forEach(l => l.el.remove()); this.labels = []; this.pickables = []; this.shells = []; this.explodables = []; this.animated = [];
    this.select(null);
    while (this.root.children.length) this.root.remove(this.root.children[0]);
  };
  Viewer.prototype.applyClip = function () {
    const planes = this.clipOn ? [this.clipPlane] : [];
    this.root.traverse(o => {
      if (!o.material || o.userData.noClip) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.clippingPlanes = planes; m.clipShadows = true; m.needsUpdate = true; });
    });
  };
  Viewer.prototype.applyTransparent = function () {
    this.shells.forEach(m => {
      if (!m.userData.origMat) m.userData.origMat = m.material;
      if (this.transparent) {
        if (!m.userData.ghostMat) { const g = m.userData.origMat.clone(); g.transparent = true; g.opacity = 0.14; g.depthWrite = false; m.userData.ghostMat = g; }
        m.material = m.userData.ghostMat; m.castShadow = false;
      } else { m.material = m.userData.origMat; m.castShadow = true; }
    });
    this.applyClip();
  };
  Viewer.prototype.frame = function (dt) {
    const T = this.T;
    if (this.autoSpin && !reduceMotion) this.sph.theta += dt * 0.12;
    else if (Math.abs(this.damp.theta) > 1e-4 || Math.abs(this.damp.phi) > 1e-4) {
      // eylemsizlik: bırakınca yavaşça durur
      if (!this.canvas.classList.contains('is-drag')) { this.sph.theta += this.damp.theta; this.sph.phi += this.damp.phi; this.damp.theta *= 0.86; this.damp.phi *= 0.86; }
    }
    this.sph.phi = E.clamp(this.sph.phi, this.limits.phiMin, this.limits.phiMax);
    const s = this.sph;
    // dar (dikey) ekranda sahne sığsın diye mesafe en-boy oranına göre büyütülür
    const fit = this.camera.aspect < 1.3 ? Math.pow(1.3 / this.camera.aspect, 0.75) : 1;
    const R = s.r * fit;
    this.camera.position.set(this.target.x + R * Math.sin(s.phi) * Math.sin(s.theta), this.target.y + R * Math.cos(s.phi), this.target.z + R * Math.sin(s.phi) * Math.cos(s.theta));
    this.camera.lookAt(this.target);
    this.explodables.forEach(x => { x.obj.position.copy(x.base).addScaledVector(x.dir, this.explode); });
    if (this.selected && this.selected.box) this.selected.box.update();
    this.renderer.render(this.scene, this.camera);
    // etiketler
    const w = this.stage.clientWidth, h = this.stage.clientHeight, v = new T.Vector3();
    this.labels.forEach(l => {
      if (!this.showLabels || (l.obj && !l.obj.visible)) { l.el.style.display = 'none'; return; }
      if (l.obj) { l.obj.updateWorldMatrix(true, false); v.copy(l.off).applyMatrix4(l.obj.matrixWorld); } else v.copy(l.off);
      if (this.clipOn && this.clipPlane.distanceToPoint(v) < -0.02) { l.el.style.display = 'none'; return; }
      v.project(this.camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { l.el.style.display = 'none'; return; }
      l.el.style.display = '';
      l.el.style.transform = 'translate(' + ((v.x + 1) / 2 * w).toFixed(1) + 'px,' + ((1 - v.y) / 2 * h).toFixed(1) + 'px) translate(-50%,-100%)';
    });
  };
  Viewer.prototype.snapshot = function (w) {
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
    const matCache = {};
    function std(key, o) {
      if (matCache[key]) return matCache[key];
      const m = o.physical ? new T.MeshPhysicalMaterial(o.p) : new T.MeshStandardMaterial(o.p);
      m.envMapIntensity = o.env === undefined ? 1 : o.env; linearize(m); matCache[key] = m; return m;
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
    function boxGeo(w, h, d) { const k = 'b' + w + ',' + h + ',' + d; return geoCache[k] || (geoCache[k] = new T.BoxGeometry(w, h, d)); }
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
      cyl: (rt, rb, h, mat, x, y, z, parent, seg) => mesh(new T.CylinderGeometry(rt, rb, h, seg || 24), mat, x, y, z, parent),
      sphere: (r, mat, x, y, z, parent) => mesh(new T.SphereGeometry(r, 20, 14), mat, x, y, z, parent),
      /** Yuvarlatılmış kenarlı kutu (ExtrudeGeometry + bevel): pano gövdeleri, cihazlar. */
      rbox: (w, h, d, r, mat, x, y, z, parent) => {
        const k = 'rb' + [w, h, d, r].join(',');
        let g = geoCache[k];
        if (!g) {
          const s = new T.Shape(), rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3);
          s.moveTo(-w / 2 + rr, -h / 2); s.lineTo(w / 2 - rr, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + rr); s.lineTo(w / 2, h / 2 - rr); s.quadraticCurveTo(w / 2, h / 2, w / 2 - rr, h / 2);
          s.lineTo(-w / 2 + rr, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - rr); s.lineTo(-w / 2, -h / 2 + rr); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + rr, -h / 2);
          const b = Math.min(rr * 0.5, d * 0.2);
          g = new T.ExtrudeGeometry(s, { depth: Math.max(d - 2 * b, 1e-3), bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.9, bevelSegments: 3, curveSegments: 6 });
          g.translate(0, 0, -(d - 2 * b) / 2); geoCache[k] = g;
        }
        return mesh(g, mat, x, y, z, parent);
      },
      group: (parent, x, y, z) => { const g = new T.Group(); g.position.set(x || 0, y || 0, z || 0); (parent || viewer.root).add(g); return g; },
      tube: (points, radius, mat, parent, seg) => {
        const curve = new T.CatmullRomCurve3(points.map(p => Array.isArray(p) ? new T.Vector3(p[0], p[1], p[2]) : p), false, 'catmullrom', 0.2);
        const m = mesh(new T.TubeGeometry(curve, seg || Math.max(16, points.length * 10), radius, 10, false), mat, 0, 0, 0, parent);
        m.userData.curve = curve; return m;
      },
      /** Canvas dokulu düzlem: etiket plakası, ekran. draw(g, w, h) her redraw() çağrısında çalışır. */
      screen: (pw, ph, px, draw, parent, opt) => {
        const cv = document.createElement('canvas'); cv.width = px; cv.height = Math.round(px * ph / pw);
        const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
        const mat = new T.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0, emissive: (opt && opt.emissive) ? 0xffffff : 0x000000, emissiveMap: (opt && opt.emissive) ? tex : null, emissiveIntensity: (opt && opt.emissive) || 0 });
        const m = mesh(new T.PlaneGeometry(pw, ph), mat, 0, 0, 0, parent, { noShadow: true });
        m.castShadow = false;
        m.redraw = function () { const g = cv.getContext('2d'); draw(g, cv.width, cv.height); tex.needsUpdate = true; };
        m.redraw(); return m;
      },
      ground: (size, mat, y) => {
        const g = mesh(new T.PlaneGeometry(size, size), mat || mats.concrete, 0, y || 0, 0, viewer.root);
        g.rotation.x = -Math.PI / 2; g.castShadow = false; g.userData.noClip = true; return g;
      },
      /** Bir eğri boyunca hareket eden enerji akış parçacıkları (InstancedMesh). */
      flow: (curve, count, color, size, parent) => {
        const geo = new T.SphereGeometry(size || 0.02, 8, 6);
        const mat = new T.MeshBasicMaterial({ color: color || 0xfcd34d, transparent: true, opacity: 0.95 });
        const im = new T.InstancedMesh(geo, mat, count); im.castShadow = false; im.userData.noClip = false;
        (parent || viewer.root).add(im);
        const dummy = new T.Object3D(); let phase = 0;
        const f = { mesh: im, speed: 0, dir: 1, visible: true,
          update(dt) {
            im.visible = f.visible && f.speed > 0.0001;
            if (!im.visible) return;
            phase = (phase + dt * f.speed * f.dir + 1000) % 1;
            for (let i = 0; i < count; i++) { const t = (i / count + phase) % 1; dummy.position.copy(curve.getPointAt(t)); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); }
            im.instanceMatrix.needsUpdate = true;
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
      mat: (hex, o) => { const m = new T.MeshStandardMaterial(Object.assign({ color: hex, roughness: 0.6, metalness: 0 }, o || {})); linearize(m); return m; },
      linearize: linearize,
      viewer: viewer,
      reducedMotion: reduceMotion,
      quality: viewer.quality
    };
    return kit;
  }

  /* ------------------------------------------------------------------ uygulama */
  function App(def, rootEl) {
    this.def = def; this.root = rootEl;
    this.state = clone(def.defaults());
    this.live = def.initLive ? def.initLive(this.state) : {};
    this.running = !!def.autoRun; this.paused = false; this.simTime = 0;
    this.result = null; this.validResult = null;
    this.mode = '3d';
    this.storageKey = 'voltsim:' + def.id + ':v1';
  }
  App.prototype.set = function (key, value, opts) {
    setPath(this.state, key, value);
    if (opts && opts.rebuild) this.renderControls();
    this.invalidate();
  };
  App.prototype.get = function (key) { return getPath(this.state, key); };
  App.prototype.invalidate = function () {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; this.recompute(); });
  };
  App.prototype.recompute = function () {
    let res;
    try { res = this.def.compute(this.state, this); } catch (err) { res = { ok: false, errors: ['Hesap hatası: ' + err.message], checks: [], values: {} }; console.error(err); }
    this.result = res;
    if (res.ok) this.validResult = res;
    this.renderAnalysis();
    if (this.viewer && this.def.scene.rebuildOn && this.def.scene.rebuildOn(this.state) !== this._sceneSig) this.rebuildScene();
    if (this.kit && this.validResult && this.def.scene && this.def.scene.update) this.def.scene.update(this.kit, this.validResult, this.state, this.live, this);
    if (this.mode === '2d') this.draw2d();
    this.updateBadge();
    this.checkTasks();
    clearTimeout(this._save); this._save = setTimeout(() => storageSet(this.storageKey, JSON.stringify({ savedAt: Date.now(), state: this.state })), 600);
  };
  App.prototype.updateBadge = function () {
    const b = this.root.querySelector('[data-vs-badge]'); if (!b) return;
    const r = this.result; let lv = 'ok', txt = 'Ön kontroller uygun';
    if (!r || !r.ok) { lv = 'bad'; txt = 'Girdi hatası'; }
    else {
      const f = r.checks.filter(c => c.status === 'fail').length, w = r.checks.filter(c => c.status === 'warn').length;
      if (f) { lv = 'bad'; txt = f + ' uygunsuzluk'; } else if (w) { lv = 'warn'; txt = w + ' uyarı'; }
    }
    if (this.def.badge && r && r.ok) { const custom = this.def.badge(r, this.state, this.live, this); if (custom) { lv = custom.level; txt = custom.text; } }
    b.dataset.level = lv; b.textContent = txt;
  };

  /* --- kontroller (sol panel) */
  App.prototype.renderControls = function () {
    const host = this.root.querySelector('[data-vs-controls]');
    const active = document.activeElement && host.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    host.innerHTML = '';
    const groups = typeof this.def.controls === 'function' ? this.def.controls(this.state, this) : this.def.controls;
    groups.forEach(gr => {
      if (!gr) return;
      const fs = el('fieldset', { class: 'vs-group' + (gr.collapsed ? ' is-collapsible' : '') });
      const lg = el('legend', { class: 'vs-group__title', text: gr.title });
      fs.appendChild(lg);
      const body = gr.collapsed !== undefined ? el('details', { open: !gr.collapsed ? true : undefined }, [el('summary', { text: gr.summary || 'Ayrıntılar' })]) : fs;
      if (body !== fs) fs.appendChild(body);
      gr.items.forEach(it => { if (it) body.appendChild(this.control(it)); });
      host.appendChild(fs);
    });
    if (active) { const n = host.querySelector('[data-key="' + active + '"]'); if (n) n.focus(); }
  };
  App.prototype.control = function (it) {
    const id = nextId('vsc'), self = this;
    const val = it.key ? this.get(it.key) : undefined;
    const help = it.help ? el('p', { class: 'vs-help', id: id + '-h', text: it.help }) : null;
    if (it.type === 'range' || it.type === 'number') {
      const out = el('output', { for: id, text: (it.fmt ? it.fmt(val) : fmt(val, it.digits === undefined ? (it.step < 1 ? (it.step < 0.1 ? 2 : 1) : 0) : it.digits, it.unit)) });
      const lab = el('label', { for: id }, [el('span', { text: it.label }), out]);
      const attrs = { id: id, type: it.type, min: it.min, max: it.max, step: it.step || 1, value: val, 'data-key': it.key, 'aria-describedby': help ? id + '-h' : undefined, class: it.type === 'range' ? 'vs-range' : 'vs-input', inputmode: it.type === 'number' ? 'decimal' : undefined };
      const input = el('input', attrs);
      const paint = () => { if (it.type === 'range') input.style.setProperty('--p', ((input.value - it.min) / (it.max - it.min) * 100) + '%'); };
      paint();
      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (it.type === 'number' && (input.value === '' || !isFinite(v))) { input.setAttribute('aria-invalid', 'true'); return; }
        input.removeAttribute('aria-invalid');
        out.textContent = it.fmt ? it.fmt(v) : fmt(v, it.digits === undefined ? (it.step < 1 ? (it.step < 0.1 ? 2 : 1) : 0) : it.digits, it.unit);
        paint(); self.set(it.key, v, { rebuild: it.rebuild });
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
      (it.options || []).forEach(o => {
        const v = Array.isArray(o) ? o[0] : o.value, l = Array.isArray(o) ? o[1] : o.label;
        const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(v) === String(val) ? 'true' : 'false', 'data-key': it.key, text: l });
        b.addEventListener('click', () => { self.set(it.key, typeof val === 'number' ? Number(v) : v, { rebuild: true }); if (it.onChange) it.onChange(v, self); });
        wrap.appendChild(b);
      });
      return el('div', { class: 'vs-field' }, [el('span', { class: 'vs-field__label', text: it.label }), wrap, help]);
    }
    if (it.type === 'chips') {
      const wrap = el('div', { class: 'vs-chips', role: 'group', 'aria-label': it.label });
      (it.options || []).forEach(o => {
        const b = el('button', { type: 'button', class: 'vs-chip', 'aria-pressed': String(o.value) === String(val) ? 'true' : 'false', 'data-key': it.key, style: o.color ? '--c:' + o.color : undefined }, [o.dot ? el('i', { 'aria-hidden': 'true' }) : null, o.label]);
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
      const ro = this.def.readouts(vr, s, this.live, this);
      parts.push('<div class="vs-readouts">' + ro.map(x => '<div class="vs-ro' + (x.wide ? ' vs-ro--wide' : '') + '"' + (x.level ? ' data-level="' + x.level + '"' : '') + (x.hint ? ' title="' + esc(x.hint) + '"' : '') + '><span>' + esc(x.label) + '</span><b>' + esc(x.value) + '</b>' + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '</div>').join('') + '</div>');
    }
    host.querySelector('[data-vs-ro]').innerHTML = parts.join('');
    // grafikler: kanvaslar yeniden kullanılır
    const ch = host.querySelector('[data-vs-charts]');
    const charts = vr && this.def.charts ? this.def.charts(vr, s, this.live, this) : [];
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
    ck.innerHTML = list.slice().sort((a, b) => order[a.status] - order[b.status]).map(c => '<li data-status="' + c.status + '"><b aria-hidden="true">' + icon[c.status] + '</b><div><strong>' + esc(c.label) + '</strong><span>' + esc(c.detail) + '</span>' + (c.ref ? '<em>' + esc(c.ref) + '</em>' : '') + '</div><span class="sr-only">' + { ok: 'uygun', warn: 'uyarı', fail: 'uygun değil', info: 'bilgi' }[c.status] + '</span></li>').join('');
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
      let ok = false;
      try { ok = !!tk.check(this.validResult, this.state, this.live, this); } catch (_) { ok = false; }
      if (ok) { done[tk.id] = Date.now(); changed = true; this.activeTask = null; toast('Görev tamamlandı: ' + tk.title, 'ok'); }
    });
    if (changed) { storageSet(this.taskKey(), JSON.stringify(done)); }
    this.renderTasks();
  };
  App.prototype.startTask = function (tk) {
    if (tk.state) {
      this.state = Object.assign(clone(this.def.defaults()), clone(tk.state));
      this.live = this.def.initLive ? this.def.initLive(this.state) : {}; this.simTime = 0;
      this.rebuildScene(); this.renderControls();
    }
    if (tk.start) { this.running = true; this.paused = false; if (this.def.start) this.def.start(this); this.syncToolbar(); }
    this.activeTask = tk.id;
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
    this.def.view2d(g, W, H, this.validResult, this.state, this.live, this);
  };

  /* --- 3D */
  App.prototype.init3d = function () {
    const stage = this.root.querySelector('[data-vs-stage]');
    const canvas = stage.querySelector('canvas.vs-canvas');
    if (!window.THREE || !this.def.scene) return false;
    try {
      const test = document.createElement('canvas');
      if (!(test.getContext('webgl2') || test.getContext('webgl'))) return false;
      this.viewer = new Viewer(stage, canvas, { background: this.def.scene.background });
    } catch (e) { console.warn('WebGL başlatılamadı', e); return false; }
    this.kit = makeKit(this.viewer);
    this._sceneSig = this.def.scene.rebuildOn ? this.def.scene.rebuildOn(this.state) : null;
    this.def.scene.build(this.kit, this.state, this);
    linearizeTree(this.viewer.scene);
    this.viewer.applyClip();
    const info = stage.querySelector('[data-vs-info]');
    const showInfo = p => {
      if (!p) { info.hidden = true; return; }
      const lines = typeof p.info === 'function' ? p.info(this) : p.info || [];
      const acts = (typeof p.actions === 'function' ? p.actions(this) : p.actions || []).filter(Boolean);
      info.innerHTML = '<button type="button" class="vs-info__x" aria-label="Kapat">×</button><strong>' + esc(typeof p.title === 'function' ? p.title(this) : p.title) + '</strong>' + (lines.length ? '<ul>' + lines.map(l => '<li>' + esc(l) + '</li>').join('') + '</ul>' : '');
      if (acts.length) {
        const row = el('div', { class: 'vs-info__acts' });
        acts.forEach(a => row.appendChild(el('button', { type: 'button', class: 'vs-btn' + (a.variant ? ' vs-btn--' + a.variant : ''), text: a.label, onclick: () => {
          a.onClick(this); this.renderControls(); this.invalidate();
          requestAnimationFrame(() => requestAnimationFrame(() => { if (this.viewer.selected === p) showInfo(p); }));
        } })));
        info.appendChild(row);
      }
      info.hidden = false;
      info.querySelector('.vs-info__x').onclick = () => this.viewer.select(null);
    };
    this.viewer.onSelect = showInfo;
    return true;
  };
  App.prototype.loop = function () {
    let last = performance.now(), acc = 0;
    const step = now => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const active = !document.hidden;
      if (active && this.running && !this.paused && this.def.tick) {
        this.simTime += dt;
        const changed = this.def.tick(this, dt);
        acc += dt;
        if (changed && acc > 0.2) { acc = 0; this.renderAnalysis(); this.updateBadge(); this.checkTasks(); if (this.mode === '2d') this.draw2d(); }
      }
      if (this.viewer && active && this.viewer.visible && this.mode === '3d') {
        const animDt = this.paused ? 0 : dt;
        if (this.def.scene.animate && this.validResult) this.def.scene.animate(this.kit, animDt, this.validResult, this.state, this.live, this);
        this.viewer.animated.forEach(a => a.update(animDt));
        this.viewer.frame(dt);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  App.prototype.setMode = function (mode) {
    this.mode = mode;
    const stage = this.root.querySelector('[data-vs-stage]');
    stage.dataset.mode = mode;
    const b = this.root.querySelector('[data-vs-act="mode"]'); if (b) { b.setAttribute('aria-pressed', mode === '2d' ? 'true' : 'false'); b.querySelector('span').textContent = mode === '2d' ? '3D görünüm' : '2D şema'; }
    if (mode === '2d') this.draw2d(); else if (this.viewer) this.viewer.resize();
  };

  /* --- proje kaydet / yükle */
  App.prototype.project = function () {
    return { format: 'voltsim-project', version: 1, module: this.def.id, title: this.def.title, savedAt: new Date().toISOString(), engine: E.version, state: this.state };
  };
  App.prototype.loadProject = function (obj) {
    if (!obj || obj.format !== 'voltsim-project') throw new Error('Bu dosya bir VoltSim projesi değil.');
    if (obj.module !== this.def.id) throw new Error('Bu proje “' + (obj.title || obj.module) + '” simülasyonuna ait. İlgili simülasyon sayfasından yükleyin.');
    if (!obj.state || typeof obj.state !== 'object') throw new Error('Proje dosyasında girdi bulunamadı.');
    const merged = Object.assign(clone(this.def.defaults()), obj.state);
    const test = this.def.compute(merged, this);
    this.state = merged;
    if (this.def.initLive) this.live = this.def.initLive(this.state);
    this.rebuildScene();
    this.renderControls(); this.recompute();
    return test;
  };
  App.prototype.rebuildScene = function () {
    if (!this.viewer) return;
    this._sceneSig = this.def.scene.rebuildOn ? this.def.scene.rebuildOn(this.state) : null;
    // sahne güncel durumun sonucuyla kurulsun (senaryo/proje yüklemede eski sonuç kullanılmasın)
    try { const r = this.def.compute(this.state, this); this.result = r; if (r.ok) this.validResult = r; } catch (_) { /* hata recompute'ta gösterilir */ }
    this.viewer.clear();
    this.def.scene.build(this.kit, this.state, this);
    linearizeTree(this.viewer.scene);
    this.viewer.applyTransparent();
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
    const cell = v => { const s = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6).replace('.', ',') : String(v === undefined ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n');
  };
  function flatInputs(app) {
    const out = [];
    const groups = typeof app.def.controls === 'function' ? app.def.controls(app.state, app) : app.def.controls;
    groups.forEach(g => g && g.items.forEach(it => {
      if (!it || !it.key || it.report === false) return;
      let v = app.get(it.key);
      if (it.type === 'select' || it.type === 'seg' || it.type === 'chips') { const o = (it.options || []).find(o => String(Array.isArray(o) ? o[0] : o.value) === String(v)); v = o ? (Array.isArray(o) ? o[1] : o.label) : v; }
      else if (it.type === 'toggle') v = v ? 'Evet' : 'Hayır';
      else if (it.fmt) v = it.fmt(v);
      else if (typeof v === 'number') v = fmt(v, it.digits === undefined ? (it.step < 1 ? 2 : 0) : it.digits, it.unit);
      else if (it.format) v = it.format(v);
      out.push({ group: g.title, label: it.label, value: String(v) });
    }));
    if (app.def.reportInputs) app.def.reportInputs(app.state, app).forEach(x => out.push(x));
    return out;
  }

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
    blocks.push('<header class="rp-head"><img src="/public/voltguard-logo.webp" alt="" width="54" height="54"><div><strong>VoltGuard · VoltSim Teknik Raporu</strong><span>' + esc(d.title) + '</span></div><div class="rp-meta">' + esc(now.toLocaleDateString('tr-TR')) + ' ' + esc(now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })) + '<br>Motor sürümü ' + esc(E.version) + '</div></header>');
    blocks.push('<p class="rp-disc"><b>Önemli:</b> VoltSim mühendislik eğitimi ve ön değerlendirme amacıyla hazırlanmıştır. Nihai proje, ekipman seçimi, uygulama ve mevzuat uygunluğu yetkili mühendis tarafından değerlendirilmelidir. Bu rapor resmî proje onayı veya mevzuata uygunluk belgesi değildir.</p>');
    if (snap) blocks.push('<figure class="rp-fig"><img src="' + snap + '" alt=""><figcaption>Simülasyon görünümü</figcaption></figure>');
    const inputs = flatInputs(this);
    blocks.push('<h2>1. Girilen değerler</h2>');
    let grp = null, rows = '';
    inputs.forEach(x => { if (x.group !== grp) { grp = x.group; rows += '<tr class="rp-g"><td colspan="2">' + esc(grp || '') + '</td></tr>'; } rows += '<tr><td>' + esc(x.label) + '</td><td>' + esc(x.value) + '</td></tr>'; });
    // uzun tabloları sayfalanabilir parçalara böl
    chunkRows(rows, 22).forEach(part => blocks.push('<table class="rp-t">' + part + '</table>'));
    blocks.push('<h2>2. Hesaplanan sonuçlar</h2>');
    const ro = d.readouts(r, this.state, this.live, this);
    chunkRows(ro.map(x => '<tr><td>' + esc(x.label) + '</td><td>' + esc(x.value) + (x.sub ? ' <small>' + esc(x.sub) + '</small>' : '') + '</td></tr>').join(''), 22).forEach(p => blocks.push('<table class="rp-t">' + p + '</table>'));
    charts.forEach(c => blocks.push('<figure class="rp-chart"><img src="' + c.img + '" alt=""><figcaption>' + esc(c.title) + '</figcaption></figure>'));
    blocks.push('<h2>3. Uygunluk ön kontrolü</h2><p class="rp-small">Ön kontroller simülasyon modelinin sınırları içindedir; tasarım doğrulaması ve resmî onay yerine geçmez.</p>');
    const st = { ok: 'Uygun', warn: 'Uyarı', fail: 'Uygun değil', info: 'Bilgi' };
    chunkRows(r.checks.map(c => '<tr data-s="' + c.status + '"><td>' + esc(st[c.status]) + '</td><td><b>' + esc(c.label) + '</b><br>' + esc(c.detail) + (c.ref ? '<br><i>' + esc(c.ref) + '</i>' : '') + '</td></tr>').join(''), 9).forEach(p => blocks.push('<table class="rp-t rp-checks">' + p + '</table>'));
    blocks.push('<h2>4. Kullanılan bağıntılar</h2><ul class="rp-l">' + (r.formulas || []).map(f => '<li><code>' + esc(f) + '</code></li>').join('') + '</ul>');
    blocks.push('<h2>5. Varsayımlar ve sınırlamalar</h2><ul class="rp-l">' + (r.assumptions || []).map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>');
    blocks.push('<h2>6. Mevzuat ve standart kaynakları</h2><p class="rp-small">Bağlayıcı düzenlemeler (kanun/yönetmelik) ile gönüllü standartlar ayrı belirtilmiştir. Son kontrol tarihi: ' + esc(window.VoltSimRegsChecked || '') + '. Güncel konsolide metin resmî kaynaktan doğrulanmalıdır.</p>');
    chunkRows(regs.map(x => '<tr><td>' + esc(x.binding ? 'Bağlayıcı' : 'Standart / rehber') + '</td><td><b>' + esc(x.name) + '</b>' + (x.rg ? ' · RG ' + esc(x.rg) : '') + (x.version ? ' · ' + esc(x.version) : '') + (x.url ? '<br><span class="rp-url">' + esc(x.url) + '</span>' : '') + (x.needsCheck ? '<br><i>Güncel mevzuat doğrulaması gereklidir.</i>' : '') + '</td></tr>').join(''), 8).forEach(p => blocks.push('<table class="rp-t rp-checks">' + p + '</table>'));
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
    const PAGE_W = 794, PAGE_H = 1123, PAD = 46;
    const pages = [];
    let page = null, used = 0;
    const newPage = () => { page = el('div', { class: 'rp-page' }); host.appendChild(page); pages.push(page); used = PAD * 2; };
    newPage();
    for (const b of blocks) {
      const node = el('div', { class: 'rp-block', html: b }); // bloktaki tüm öğeler (başlık + liste) birlikte taşınır
      page.appendChild(node);
      await waitImages(node);
      const h = node.getBoundingClientRect().height + 10;
      if (used + h > PAGE_H - 20 && page.children.length > 1) { page.removeChild(node); newPage(); page.appendChild(node); }
      used += h;
    }
    const jsPDF = window.jspdf.jsPDF;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    doc.setProperties({ title: 'VoltSim · ' + this.def.title, subject: 'VoltSim teknik raporu', author: 'VoltGuard', creator: 'VoltSim' });
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      p.appendChild(el('div', { class: 'rp-num', text: 'Sayfa ' + (i + 1) + ' / ' + pages.length }));
      const cv = await window.html2canvas(p, { scale: 2, backgroundColor: '#ffffff', logging: false, width: PAGE_W, height: PAGE_H, windowWidth: PAGE_W });
      if (i) doc.addPage();
      doc.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    }
    host.remove();
    download(fileStem(this.def.id) + '-rapor.pdf', 'application/pdf', doc.output('blob'));
  };
  function waitImages(node) { return Promise.all(Array.from(node.querySelectorAll('img')).map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; }))); }

  /* --- araç çubuğu eylemleri */
  App.prototype.action = async function (act, btn) {
    try {
      if (act === 'start') {
        this.running = true; this.paused = false; this.simTime = 0;
        if (this.def.start) this.def.start(this); toast(this.def.startText || 'Simülasyon başlatıldı.');
      } else if (act === 'pause') {
        if (!this.running) { this.running = true; this.paused = false; if (this.def.start && !this._startedOnce) this.def.start(this); }
        else this.paused = !this.paused;
      } else if (act === 'reset') {
        this.state = clone(this.def.defaults()); this.live = this.def.initLive ? this.def.initLive(this.state) : {};
        this.running = !!this.def.autoRun; this.paused = false; this.simTime = 0;
        storageDel(this.storageKey);
        this._sceneSig = undefined; this.rebuildScene(); this.renderControls(); this.recompute(); if (this.viewer) this.viewer.resetView();
        toast('Varsayılan değerlere dönüldü.');
      } else if (act === 'camera') { if (this.viewer) this.viewer.resetView(); }
      else if (act === 'full') {
        const work = this.root.querySelector('.vs-work');
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (work.requestFullscreen && !/iPhone|iPad/.test(navigator.userAgent)) await work.requestFullscreen();
        else { work.classList.toggle('is-expanded'); document.body.classList.toggle('vs-expanded'); }
        setTimeout(() => { if (this.viewer) this.viewer.resize(); this.renderAnalysis(); }, 120);
      } else if (act === 'mode') this.setMode(this.mode === '3d' ? '2d' : '3d');
      else if (act === 'report') { btn && (btn.disabled = true); toast('Rapor hazırlanıyor…'); await this.pdf(); toast('PDF rapor indirildi.', 'ok'); }
      else if (act === 'csv') { download(fileStem(this.def.id) + '.csv', 'text/csv;charset=utf-8', this.csv()); toast('CSV indirildi.', 'ok'); }
      else if (act === 'save') { download(fileStem(this.def.id) + '.voltsim.json', 'application/json', JSON.stringify(this.project(), null, 2)); toast('Proje dosyası indirildi.', 'ok'); }
      else if (act === 'load') { this.root.querySelector('[data-vs-file]').click(); }
      else if (act === 'spin') { if (this.viewer) { this.viewer.autoSpin = !this.viewer.autoSpin; btn.setAttribute('aria-pressed', String(this.viewer.autoSpin)); } }
      else if (act === 'labels') { if (this.viewer) { this.viewer.showLabels = !this.viewer.showLabels; btn.setAttribute('aria-pressed', String(this.viewer.showLabels)); } }
      else if (act === 'ghost') { if (this.viewer) { this.viewer.transparent = !this.viewer.transparent; this.viewer.applyTransparent(); btn.setAttribute('aria-pressed', String(this.viewer.transparent)); } }
      else if (act === 'section') {
        if (!this.viewer) return;
        this.viewer.clipOn = !this.viewer.clipOn; btn.setAttribute('aria-pressed', String(this.viewer.clipOn));
        const sl = this.root.querySelector('[data-vs-clip]'); sl.hidden = !this.viewer.clipOn;
        this.setClip(Number(sl.querySelector('input').value)); this.viewer.applyClip();
      } else if (act === 'explode') {
        if (!this.viewer) return;
        const on = this.viewer.explode === 0; btn.setAttribute('aria-pressed', String(on));
        const from = this.viewer.explode, to = on ? 1 : 0, t0 = performance.now();
        const anim = now => { const k = Math.min(1, (now - t0) / (reduceMotion ? 1 : 500)); this.viewer.explode = from + (to - from) * (1 - Math.pow(1 - k, 3)); if (k < 1) requestAnimationFrame(anim); };
        requestAnimationFrame(anim);
      }
      this.syncToolbar();
    } catch (e) { console.error(e); toast(e.message || 'İşlem tamamlanamadı.', 'bad'); }
    finally { if (btn) btn.disabled = false; }
  };
  App.prototype.setClip = function (pct) {
    if (!this.viewer) return;
    const b = this.def.scene.bounds || [-2, 2];
    this.viewer.clipPlane.constant = b[0] + (b[1] - b[0]) * pct / 100;
  };
  App.prototype.syncToolbar = function () {
    const p = this.root.querySelector('[data-vs-act="pause"]');
    if (p) { const on = this.running && !this.paused; p.setAttribute('aria-pressed', String(on)); p.querySelector('span').textContent = !this.running ? 'Devam et' : this.paused ? 'Devam et' : 'Durdur'; }
    const st = this.root.querySelector('[data-vs-act="start"]');
    if (st) st.querySelector('span').textContent = this.running && this.simTime > 0 ? 'Yeniden başlat' : 'Simülasyonu başlat';
  };

  /* --- kurulum */
  App.prototype.mount = function () {
    const self = this, root = this.root, d = this.def;
    // senaryolar
    const sc = root.querySelector('[data-vs-scenario]');
    if (sc) {
      (d.scenarios || []).forEach(s => sc.appendChild(el('option', { value: s.id, text: s.name })));
      sc.addEventListener('change', () => {
        const s = (d.scenarios || []).find(x => x.id === sc.value); if (!s) return;
        self.state = Object.assign(clone(d.defaults()), clone(s.state || {}));
        if (s.apply) s.apply(self.state);
        self.live = d.initLive ? d.initLive(self.state) : {}; self.simTime = 0;
        self.rebuildScene(); self.renderControls(); self.recompute();
        if (s.start) { self.running = true; self.paused = false; if (d.start) d.start(self); }
        toast('Senaryo yüklendi: ' + s.name);
        const desc = root.querySelector('[data-vs-scenario-desc]'); if (desc) desc.textContent = s.desc || '';
        sc.value = '';
      });
    }
    root.querySelectorAll('[data-vs-act]').forEach(b => b.addEventListener('click', () => self.action(b.dataset.vsAct, b)));
    const clip = root.querySelector('[data-vs-clip] input');
    if (clip) clip.addEventListener('input', () => self.setClip(Number(clip.value)));
    const file = root.querySelector('[data-vs-file]');
    file.addEventListener('change', () => {
      const f = file.files[0]; if (!f) return;
      if (f.size > 2 * 1024 * 1024) { toast('Dosya çok büyük (en çok 2 MB).', 'bad'); return; }
      const rd = new FileReader();
      rd.onload = () => { try { self.loadProject(JSON.parse(rd.result)); toast('Proje yüklendi.', 'ok'); } catch (e) { toast(e.message || 'Proje okunamadı.', 'bad'); } file.value = ''; };
      rd.readAsText(f);
    });
    // mobil sekmeler
    root.querySelectorAll('[data-vs-pane]').forEach(b => b.addEventListener('click', () => {
      root.querySelectorAll('[data-vs-pane]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
      root.querySelector('.vs-work').dataset.pane = b.dataset.vsPane;
      setTimeout(() => { if (self.viewer) self.viewer.resize(); self.renderAnalysis(); if (self.mode === '2d') self.draw2d(); }, 30);
    }));
    // kayıtlı oturum
    const saved = storageGet(this.storageKey);
    if (saved) {
      try { const o = JSON.parse(saved); if (o && o.state) { this.state = Object.assign(clone(d.defaults()), o.state); this._restored = true; } } catch (_) { }
    }
    const ok3d = this.init3d();
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
    this.renderControls(); this.recompute();
    if (this._restored) toast('Son çalışmanız geri yüklendi. Sıfırla ile varsayılana dönebilirsiniz.');
    if (this.running && d.start) d.start(this);
    this.syncToolbar();
    window.addEventListener('resize', () => { clearTimeout(self._rs); self._rs = setTimeout(() => { self.renderAnalysis(); if (self.mode === '2d') self.draw2d(); }, 150); });
    this.loop();
    root.dataset.ready = 'true';
  };

  /* ------------------------------------------------------------------ dışa açık API */
  window.VoltSim = {
    E: E, toast: toast, fmt: fmt, fmtPower: fmtPower, fmtEnergy: fmtEnergy, fmtDuration: fmtDuration, esc: esc, el: el, PALETTE: PALETTE, drawChart: drawChart,
    reduceMotion: reduceMotion,
    register: function (def) { modules[def.id] = def; },
    modules: modules,
    get app() { return window.__vsApp; }
  };
  function boot() {
    const root = document.querySelector('[data-vs-module]');
    if (!root) return;
    const def = modules[root.dataset.vsModule];
    if (!def) { root.querySelector('[data-vs-analysis]').textContent = 'Simülasyon modülü yüklenemedi.'; return; }
    const app = new App(def, root); window.__vsApp = app;
    app.mount();
  }
  // defer betikleri DOMContentLoaded'dan önce sırayla çalışır; modül dosyaları kaydolduktan sonra başlatılır.
  if (document.readyState === 'complete') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
