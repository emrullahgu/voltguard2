// ============================================================================
// render/flow.js — PX.flow : akan enerji çizgileri (iletkenler boyunca), kondansatör şarj halkaları (§24.2, §24.5)
//                  ve Volti'nin YOL ÖNİZLEMESİ (kural sürümü 4: merdiven eğik düzlemi ve iskele boyunca)   sahip: Render
// Tek ShaderMaterial (ekran uzayında sabit piksel kalınlıklı şerit; köşe başına mod/renk/genişlik öznitelikleri):
//   mod 0 ÖLÜ = düz soluk · 1 CANLI = kaynaktan yüke AKAN kesikli ışık · 2 TOPRAKLI = sarı-yeşil şerit (durağan)
//   mod 3 YOL = Volti'nin kalan yolu (kesikli, ileri akan; yürünen kısım uCut ile silinir) · 5 şarj halkası dilimi
//   mod 6 gizli. Durum yalnız renkle verilmez: desen (akış/düz/şerit/kesik) ayrı.
// İletkenler: aynı düğüm grubundaki (kablolar birleştirir) cihaz küplerinin üst çapaları arasında en küçük kapsayan
//   ağaç; her kenar diorama üstünden kemerle geçer; derinlik testi açık.
// Akış yönü: canlı kaynaklardan başlayan grup BFS'i (kapalı cihazlar ve trafolar köprü) + grup içi ağaçta giriş
//   çapasından dışa. Yalnız sync'te (komut anı) hesaplanır; kare başına iş: uTime (+ yürürken uCut).
//   PX.flow.init()  .build(L, s)  .sync(s, E)  .update(dt)  .setResolution(w, h)
//   PX.flow.path(px, py, pz, cum, n) | path(null)   yol önizlemesi (Volti'nin yoğun yol noktaları; dünya, ayak +ofset)
//   PX.flow.pathCut(s)                             yürünen yay uzunluğu (bu kadarı çizilmez)
//   PX.flow.info() -> {segments, live, earthed, path, caps}   (test)
// ============================================================================
const VS = [
  'uniform vec2 uRes;',
  'attribute vec3 aOther; attribute float aSide; attribute float aDist; attribute float aMode; attribute vec3 aCol; attribute float aWidth;',
  'varying float vDist; varying float vMode; varying vec3 vCol; varying float vSide;',
  'void main(){',
  '  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);',
  '  vec2 h = uRes * 0.5; vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * h; float L = length(d);',
  '  vec2 dir = L > 0.001 ? d / L : vec2(1.0, 0.0);',
  '  float w = aMode > 5.5 ? 0.0 : aWidth;',
  '  c0.xy += vec2(-dir.y, dir.x) * aSide * w * 0.5 / h * c0.w;',
  '  c0.z -= 0.0004 * c0.w;',
  '  gl_Position = c0; vDist = aDist; vMode = aMode; vCol = aCol; vSide = aSide;',
  '}'].join('\n');
const FS = [
  'uniform float uTime; uniform float uCut;',
  'varying float vDist; varying float vMode; varying vec3 vCol; varying float vSide;',
  'void main(){',
  '  vec3 c = vCol; float a = 1.0;',
  '  if (vMode < 0.5) { c = c * 0.38 + 0.04; a = 0.7; }',
  '  else if (vMode < 1.5) { float ph = fract(vDist * 2.0 - uTime * 1.5); float on = smoothstep(0.0, 0.07, ph) * (1.0 - smoothstep(0.45, 0.52, ph)); c = mix(c * 0.5, min(c * 1.3 + 0.2, vec3(1.0)), on); }',
  '  else if (vMode < 2.5) { float ph = fract(vDist * 3.0); c = ph < 0.5 ? vec3(0.93, 0.84, 0.16) : vec3(0.18, 0.66, 0.30); }',
  '  else if (vMode < 3.5) { if (vDist < uCut) discard; float ph = fract(vDist * 3.2 - uTime * 2.2); if (ph > 0.58) discard; float e = 1.0 - abs(vSide); c = min(c * (0.75 + 0.6 * e) + 0.15 * e, vec3(1.0)); a = 0.92 * smoothstep(uCut, uCut + 0.35, vDist); }',
  '  else if (vMode > 5.5) { discard; }',
  '  float edge = 1.0 - smoothstep(0.7, 1.0, abs(vSide));',
  '  gl_FragColor = vec4(c, a * (0.4 + 0.6 * edge));',
  '}'].join('\n');
const SEG_N = 14;                         // kemer başına parça
const CAP_ARC = 3, ARC_N = 6;             // şarj halkası: 3 dilim × 6 parça
const COL = { line: [1.0, 0.72, 0.28], path: [0.46, 0.93, 1.0], charge: [0.40, 0.92, 1.0] };
const PATH_N = 320;                       // yol önizlemesi parça sınırı (yoğun yol daha uzunsa seyreltilir)
const F = { L: null, mat: null, mesh: null, geo: null, cap: 0, used: 0, A: null, segs: [], pathBase: 0, pathN: 0, capBase: 0,
  digits: [], digitTex: null, digitMat: null, s: null, E: null, ext: null, time: 0, res: [1, 1], info: null };

function init() {
  F.mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: true, toneMapped: false, side: THREE.DoubleSide,
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uCut: { value: 0 } },
  });
  F.mat.userData.shared = true;
  // rakam atlası 0..3 (şarj sayısı)
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    g.fillStyle = 'rgba(8,20,32,0.82)'; g.beginPath(); g.arc(i * 64 + 32, 32, 28, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#66e8ff'; g.lineWidth = 4; g.stroke();
    g.fillStyle = '#e8fbff'; g.font = 'bold 38px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i), i * 64 + 32, 34);
  }
  F.digitTex = new THREE.CanvasTexture(c); F.digitTex.encoding = THREE.sRGBEncoding; F.digitTex.userData = { shared: true };
  F.digitMat = new THREE.MeshBasicMaterial({ map: F.digitTex, transparent: true, depthWrite: false, toneMapped: false });
  F.digitMat.userData.shared = true;
  setResolution(PX.scene.w || 1, PX.scene.h || 1);
}
function setResolution(w, h) { F.res[0] = w; F.res[1] = h; if (F.mat) F.mat.uniforms.uRes.value.set(w, h); }
function disposeLevel() {
  if (F.mesh) { if (F.mesh.parent) F.mesh.parent.remove(F.mesh); F.geo.dispose(); F.mesh = null; F.geo = null; }
  for (const d of F.digits) { if (d.mesh.parent) d.mesh.parent.remove(d.mesh); d.mesh.geometry.dispose(); }
  F.digits.length = 0; F.segs.length = 0;
}
// ---------------------------------------------------------------- yapı
function xyz(G, c) { return [c % G.W, Math.floor(c / G.W) % G.H, Math.floor(c / (G.W * G.H))]; }
function build(L, s) {
  disposeLevel();
  F.L = L; F.s = null; F.E = null; F.pathN = 0;
  const G = L.G, T = PX.SIM.T;
  // düğüm grupları: kablolar (hep kapalı, aynı galvanik bileşen) birleştirir
  const par = new Int16Array(L.nN); for (let i = 0; i < L.nN; i++) par[i] = i;
  const f = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (const e of L.edges) if (e.t === T.kablo) { const A = f(e.a), B = f(e.b); if (A !== B) par[A] = B; }
  const grp = new Int16Array(L.nN); for (let i = 0; i < L.nN; i++) grp[i] = f(i);
  // çapalar: hücreli her eleman; üye olduğu gruplar
  const anchor = new Map();                         // elIdx -> [x,y,z]
  const members = new Map();                        // grup -> [elIdx]
  const addM = (g, ei) => { let a = members.get(g); if (!a) { a = []; members.set(g, a); } if (a.indexOf(ei) < 0) a.push(ei); };
  L.els.forEach((el, ei) => {
    if (el.cell < 0) return;
    const [x, y, z] = xyz(G, el.cell); anchor.set(ei, [x, y + 0.62, z]);
    if (el.ei !== undefined) { const ed = L.edges[el.ei]; addM(grp[ed.a], ei); addM(grp[ed.b], ei); }
    else if (el.dugum !== undefined) addM(grp[L.nodeIdx[el.dugum]], ei);
  });
  const segs = [];
  // grup içi en küçük kapsayan ağaç (Prim)
  for (const [g, m] of members) {
    if (m.length < 2) continue;
    const inT = new Uint8Array(m.length); inT[0] = 1; let k = 1;
    while (k < m.length) {
      let bi = -1, bj = -1, bd = 1e9;
      for (let i = 0; i < m.length; i++) if (inT[i]) for (let j = 0; j < m.length; j++) if (!inT[j]) {
        const a = anchor.get(m[i]), b = anchor.get(m[j]); const d = Math.hypot(a[0] - b[0], (a[1] - b[1]) * 1.5, a[2] - b[2]);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
      inT[bj] = 1; k++;
      segs.push({ g, a: m[bi], b: m[bj], node: -1, bridge: -1 });
    }
  }
  // hücresiz, kablo olmayan kenarlar (ör. hücresiz trafo): iki grubun en yakın çapaları arasında köprü
  L.edges.forEach((e, i) => {
    if (e.t === T.kablo) return; const el = L.els[e.el]; if (el.cell >= 0) return;
    const ma = members.get(grp[e.a]), mb = members.get(grp[e.b]); if (!ma || !mb || grp[e.a] === grp[e.b]) return;
    let bd = 1e9, ba = -1, bb = -1;
    for (const p of ma) for (const q of mb) { const a = anchor.get(p), b = anchor.get(q); const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); if (d < bd) { bd = d; ba = p; bb = q; } }
    segs.push({ g: grp[e.a], a: ba, b: bb, node: -1, bridge: i });
  });
  for (const sg of segs) { const ns = []; for (let i = 0; i < L.nN; i++) if (grp[i] === sg.g) { sg.node = i; break; } void ns; }
  F.grp = grp; F.members = members; F.anchor = anchor; F.segs = segs;
  // köşe bütçesi
  const quads = segs.length * SEG_N + PATH_N + L.caps.length * CAP_ARC * ARC_N;
  F.cap = Math.max(1, quads);
  const nv = F.cap * 4;
  const A = F.A = {
    pos: new Float32Array(nv * 3), oth: new Float32Array(nv * 3), side: new Float32Array(nv), dist: new Float32Array(nv), fdist: new Float32Array(nv),
    mode: new Float32Array(nv), col: new Float32Array(nv * 3), width: new Float32Array(nv),
  };
  const idx = new Uint32Array(F.cap * 6);
  for (let q = 0; q < F.cap; q++) { const o = q * 4, i = q * 6; idx[i] = o; idx[i + 1] = o + 1; idx[i + 2] = o + 2; idx[i + 3] = o + 2; idx[i + 4] = o + 1; idx[i + 5] = o + 3; }
  for (let i = 0; i < nv; i++) A.mode[i] = 6;
  let q = 0;
  // iletken kemerleri: kübik Bezier (çapadan dikey yükselir, H yüksekliğinde geçer, dikey iner). H, yol üstündeki
  // her sütunun üstünü ≥ 0,22 aşacak kadar yükseltilir => hat hiçbir görünümde katı küpün İÇİNDEN geçmez (yarım
  // görünen kopuk çizgi yok); kalan örtülme gerçek örtülmedir (derinlik testi açık, "görünmeyen yoktur").
  const colTop = new Float32Array(G.W * G.D).fill(-1e9);
  for (let c = 0; c < G.N; c++) if (G.kind[c]) { const x = c % G.W, y = Math.floor(c / G.W) % G.H, z = Math.floor(c / (G.W * G.H)); const t = y + 0.5; if (t > colTop[z * G.W + x]) colTop[z * G.W + x] = t; }
  const P = new Float32Array((SEG_N + 1) * 3);
  for (const sg of segs) {
    const a = anchor.get(sg.a), b = anchor.get(sg.b);
    const dist = Math.hypot(b[0] - a[0], b[2] - a[2]);
    let H = Math.max(a[1], b[1]) + 0.18 + 0.1 * dist;
    const ax = Math.round(a[0]), az = Math.round(a[2]), bx = Math.round(b[0]), bz = Math.round(b[2]);
    for (let it = 0; it < 8; it++) {
      let need = 0;
      for (let k = 1; k < 40; k++) {
        const t = k / 40, u = 1 - t, wb = 3 * u * t * t + t * t * t, wh = 3 * u * u * t + 3 * u * t * t;
        const x = a[0] + (b[0] - a[0]) * wb, z = a[2] + (b[2] - a[2]) * wb, y = a[1] * u * u * u + H * wh + b[1] * t * t * t;
        const cx = Math.round(x), cz = Math.round(z);
        if ((cx === ax && cz === az) || (cx === bx && cz === bz) || cx < 0 || cz < 0 || cx >= G.W || cz >= G.D) continue;
        const d = colTop[cz * G.W + cx] + 0.22 - y; if (d > need) need = d;
      }
      if (need <= 1e-3) break;
      H += need / 0.75 + 0.02;                     // wh ≤ 0,75: tepe noktasında yükselme ≥ need
    }
    sg.H = H;
    for (let k = 0; k <= SEG_N; k++) {
      const t = k / SEG_N, u = 1 - t, wb = 3 * u * t * t + t * t * t, wh = 3 * u * u * t + 3 * u * t * t;
      P[k * 3] = a[0] + (b[0] - a[0]) * wb; P[k * 3 + 1] = a[1] * u * u * u + H * wh + b[1] * t * t * t; P[k * 3 + 2] = a[2] + (b[2] - a[2]) * wb;
    }
    sg.q0 = q; let acc = 0;
    for (let k = 0; k < SEG_N; k++) {
      const l = Math.hypot(P[k * 3 + 3] - P[k * 3], P[k * 3 + 4] - P[k * 3 + 1], P[k * 3 + 5] - P[k * 3 + 2]);
      quad(q, P[k * 3], P[k * 3 + 1], P[k * 3 + 2], P[k * 3 + 3], P[k * 3 + 4], P[k * 3 + 5], acc, acc + l, 4.0, COL.line, 0); q++; acc += l;
    }
    sg.len = acc; sg.q1 = q;
  }
  // yol önizlemesi yuvaları (gizli başlar)
  F.pathBase = q; q += PATH_N;
  // şarj halkaları
  F.capBase = q;
  L.caps.forEach((cp, ci) => {
    const [x, y, z] = xyz(G, cp.cell); const Y = y + 0.53, R = 0.40;
    for (let s = 0; s < CAP_ARC; s++) {
      const a0 = -Math.PI / 2 + s * (Math.PI * 2 / CAP_ARC) + 0.16, a1 = a0 + Math.PI * 2 / CAP_ARC - 0.32;
      for (let k = 0; k < ARC_N; k++) {
        const t0 = a0 + (a1 - a0) * k / ARC_N, t1 = a0 + (a1 - a0) * (k + 1) / ARC_N;
        quad(q, x + R * Math.cos(t0), Y, z + R * Math.sin(t0), x + R * Math.cos(t1), Y, z + R * Math.sin(t1), 0, 0, 5.0, COL.charge, 0); q++;
      }
    }
    // rakam (billboard)
    const pg = new THREE.PlaneGeometry(0.34, 0.34);
    const m = new THREE.Mesh(pg, F.digitMat); m.position.set(x, y + 1.02, z); m.renderOrder = 9; m.userData.noShadow = true; m.name = 'charge-' + ci;
    PX.scene.root.add(m); F.digits.push({ mesh: m, ci, val: -1 });
  });
  F.used = q;
  const geo = new THREE.BufferGeometry();
  const at = (k, arr, n) => { const b = new THREE.BufferAttribute(arr, n); b.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, b); return b; };
  at('position', A.pos, 3); at('aOther', A.oth, 3); at('aSide', A.side, 1); at('aDist', A.dist, 1); at('aMode', A.mode, 1); at('aCol', A.col, 3); at('aWidth', A.width, 1);
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(G.W / 2, G.H / 2, G.D / 2), Math.hypot(G.W, G.H + 3, G.D));
  F.geo = geo;
  const mesh = new THREE.Mesh(geo, F.mat); mesh.frustumCulled = false; mesh.renderOrder = 4; mesh.name = 'flow'; mesh.userData.noShadow = true;
  mesh.matrixAutoUpdate = false;
  F.mesh = mesh; PX.scene.root.add(mesh);
  void s;
}
// parça q: (x0..)->(x1..), dörtlü köşe; uç köşelerinde yön ters döndüğü için yan işareti çevrilir
function quad(q, x0, y0, z0, x1, y1, z1, d0, d1, w, c, mode) {
  const A = F.A; const o = q * 4;
  for (let k = 0; k < 4; k++) {
    const end = k >= 2, i = o + k;
    A.pos[i * 3] = end ? x1 : x0; A.pos[i * 3 + 1] = end ? y1 : y0; A.pos[i * 3 + 2] = end ? z1 : z0;
    A.oth[i * 3] = end ? x0 : x1; A.oth[i * 3 + 1] = end ? y0 : y1; A.oth[i * 3 + 2] = end ? z0 : z1;
    A.side[i] = ((k & 1) ? -1 : 1) * (end ? -1 : 1);
    A.dist[i] = A.fdist[i] = end ? d1 : d0; A.mode[i] = mode; A.width[i] = w;
    A.col[i * 3] = c[0]; A.col[i * 3 + 1] = c[1]; A.col[i * 3 + 2] = c[2];
  }
}
function setQuadMode(q, mode) { const o = q * 4; for (let k = 0; k < 4; k++) F.A.mode[o + k] = mode; }
const ATTRS = ['position', 'aOther', 'aSide', 'aDist', 'aMode', 'aCol', 'aWidth'];
function dirty() {
  const g = F.geo; if (!g) return;
  for (let i = 0; i < ATTRS.length; i++) g.attributes[ATTRS[i]].needsUpdate = true;
}
// ---------------------------------------------------------------- durum
function sync(s, E) {
  const L = F.L; if (!L || !F.geo || !s) return;
  F.s = s; F.E = E = E || PX.SIM.stateE(L, s);
  syncLines(s, E);
  syncCaps(s);
  dirty();
}
function syncLines(s, E) {
  const L = F.L, T = PX.SIM.T, A = F.A;
  // grup BFS: canlı kaynak gruplarından; köprüler: hücreli kapalı anahtarlar, trafolar
  const nG = L.nN; const dist = new Int16Array(nG).fill(-1), entry = new Int16Array(nG).fill(-1);
  const q = [];
  for (const src of L.sources) { const g = F.grp[src.node]; if (E.live[src.node] && dist[g] < 0) { dist[g] = 0; entry[g] = src.el; q.push(g); } }
  const closed = e => {
    switch (e.t) { case T.kesici: case T.ayirici: case T.yuk_ayirici: case T.sigorta: case T.kontaktor: return ((s.b >> e.bit) & 1) === 1; default: return true; }
  };
  for (let i = 0; i < q.length; i++) {
    const g = q[i];
    L.edges.forEach(e => {
      if (e.t === T.kablo || !closed(e)) return;
      const ga = F.grp[e.a], gb = F.grp[e.b]; const o = ga === g ? gb : gb === g ? ga : -1;
      if (o < 0 || dist[o] >= 0 || !E.live[e.a] || !E.live[e.b]) return;
      dist[o] = dist[g] + 1; entry[o] = L.els[e.el].cell >= 0 ? e.el : -1; q.push(o);
    });
  }
  // grup içi yön: giriş çapasından ağaç BFS
  const parentOf = new Map();
  for (const [g, m] of F.members) {
    let root = entry[g]; if (root < 0 || m.indexOf(root) < 0) root = m[0];
    const seen = new Set([root]); const qq = [root];
    for (let i = 0; i < qq.length; i++) { const x = qq[i]; for (const sg of F.segs) { if (sg.g !== g || sg.bridge >= 0) continue; const y = sg.a === x ? sg.b : sg.b === x ? sg.a : -1; if (y < 0 || seen.has(y)) continue; seen.add(y); parentOf.set(g + ':' + y, x); qq.push(y); } }
  }
  for (const sg of F.segs) {
    const n = sg.node; let mode;
    if (sg.bridge >= 0) { const e = L.edges[sg.bridge]; mode = E.live[e.a] && E.live[e.b] && closed(e) ? 1 : (E.earthG[E.gal[e.a]] && E.earthG[E.gal[e.b]] ? 2 : 0); }
    else mode = E.live[n] ? 1 : (E.earthG[E.gal[n]] ? 2 : 0);
    const fwd = sg.bridge >= 0 ? (dist[F.grp[L.edges[sg.bridge].a]] <= dist[F.grp[L.edges[sg.bridge].b]]) : parentOf.get(sg.g + ':' + sg.b) === sg.a;
    for (let qq = sg.q0; qq < sg.q1; qq++) {
      setQuadMode(qq, mode);
      const o = qq * 4; for (let k = 0; k < 4; k++) A.dist[o + k] = fwd ? A.fdist[o + k] : sg.len - A.fdist[o + k];
    }
  }
}
function syncCaps(s) {
  const L = F.L; let q = F.capBase;
  L.caps.forEach((cp, ci) => {
    const ch = Math.floor(s.ch / Math.pow(4, ci)) % 4;
    for (let a = 0; a < CAP_ARC; a++) for (let k = 0; k < ARC_N; k++) setQuadMode(q++, a < ch ? 5 : 0);
    const d = F.digits[ci]; if (d && d.val !== ch) {
      d.val = ch; const uv = d.mesh.geometry.attributes.uv; const u0 = ch / 4, u1 = (ch + 1) / 4;
      uv.setXY(0, u0, 1); uv.setXY(1, u1, 1); uv.setXY(2, u0, 0); uv.setXY(3, u1, 0); uv.needsUpdate = true;
    }
  });
}
// ---------------------------------------------------------------- yol önizlemesi (Volti'nin yoğun yolu)
// px,py,pz: yol noktaları (dünya; py = ayak yüksekliği + ofset), cum: yay uzunluğu (uCut ile aynı ölçek). n > PATH_N+1
// ise eşit aralıklı seyreltilir. Yalnız yol kurulurken (komut anı) çağrılır.
function path(px, py, pz, cum, n) {
  if (!F.geo || !F.A) return;
  const base = F.pathBase; let q = 0;
  if (px && n > 1) {
    const step = Math.max(1, Math.ceil((n - 1) / PATH_N));
    let i0 = 0;
    for (let i = step; q < PATH_N; i += step) {
      const j = Math.min(i, n - 1);
      quad(base + q, px[i0], py[i0], pz[i0], px[j], py[j], pz[j], cum[i0], cum[j], 4.5, COL.path, 3); q++; i0 = j;
      if (j >= n - 1) break;
    }
  }
  for (let i = q; i < F.pathN; i++) setQuadMode(base + i, 6);
  F.pathN = q; F.mat.uniforms.uCut.value = 0;
  dirty();
}
function pathCut(s) { if (F.mat) F.mat.uniforms.uCut.value = s; }
function update(dt) {
  if (!F.mat) return;
  F.time += dt; if (F.time > 1000) F.time -= 1000;
  F.mat.uniforms.uTime.value = F.time;
  if (F.digits.length && PX.camera && PX.camera.cam) { const qq = PX.camera.cam.quaternion; for (let i = 0; i < F.digits.length; i++) F.digits[i].mesh.quaternion.copy(qq); }
}
function info() {
  const A = F.A; if (!A || !F.L) return null;
  let live = 0, earthed = 0;
  for (const sg of F.segs) { const m = A.mode[sg.q0 * 4]; if (m === 1) live++; else if (m === 2) earthed++; }
  return { segments: F.segs.length, live, earthed, path: F.pathN, cut: F.mat.uniforms.uCut.value, caps: F.digits.map(d => d.val) };
}
PX.flow = { init, build, sync, update, path, pathCut, setResolution, info, sharedTextures: () => (F.digitTex ? [F.digitTex] : []),
  preview() { /* kural sürümü 4: izdüşüm önizlemesi yok (eski çağıranlar için etkisiz) */ } };
