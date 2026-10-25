'use strict';

// Renk teması denetimi (açık + koyu): sitemap.xml'deki her sayfa ve site haritasında olmayan kilit sayfalar
// (hesap/*, 404, arama, çalışan girişi…) iki temada, 1366 ve 390 px genişlikte açılır ve şunlar raporlanır:
//   - WCAG kontrastı < 4.5:1 olan metin (büyük/kalın metinde < 3:1); arka plan ata zinciri boyunca
//     (yarı saydam katmanlar birleştirilerek, gradyanlarda en kötü durak) hesaplanır. Görsel/canvas üstündeki
//     metin ayrı işaretlenir (otomatik ölçülemez).
//   - görünmez metin (kontrast < 1.25: yazı ile zemin neredeyse aynı renk)
//   - okunamaz görsel: saydam PNG/SVG/WebP içindeki koyu çizim koyu zemin üstünde (ya da açık çizim açık zeminde)
//   - form alanları: değer/placeholder rengi alan zeminine göre
//   - yatay taşma, konsol / sayfa hataları
// Tema localStorage 'vg-theme' + prefers-color-scheme ile zorlanır (tools/shell/head.html başlatıcısı okur).
//   node tools/tests/theme-audit.cjs                       (önizleme: VG_BASE ya da http://127.0.0.1:4173)
//   node tools/tests/theme-audit.cjs --theme=dark --vp=mobile bilgi hesaplama
//   node tools/tests/theme-audit.cjs --jobs=6 --out=tema-koyu
// Çıktı: .qa/audit/tema.md ve .qa/audit/tema.json (--out ile ad değişir). Bulgu varsa çıkış kodu 1.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const outDir = path.join(root, '.qa/audit');
fs.mkdirSync(outDir, { recursive: true });
const BASE = process.env.VG_BASE || 'http://127.0.0.1:4173';
const argv = process.argv.slice(2);
const opt = (name, def) => { const a = argv.find(x => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : def; };
const only = argv.filter(a => !a.startsWith('--'));
const THEMES = opt('theme', 'both') === 'both' ? ['light', 'dark'] : [opt('theme')];
const VPS = [{ w: 1366, h: 900, tag: '1366' }, { w: 390, h: 844, tag: '390' }].filter(v => opt('vp', 'both') === 'both' || (opt('vp') === 'mobile' ? v.w < 600 : v.w >= 600));
const JOBS = Math.max(1, Number(opt('jobs', 4)) || 4);
const OUT = opt('out', 'tema');

// Gerekçeli istisnalar: [sayfa önekleri (boş = hepsi), seçici eşleşmesi (RegExp), açıklama]
const EXCEPTIONS = [
  [[], /\[disabled\]|:disabled|aria-disabled/, 'Devre dışı denetimler WCAG 1.4.3 kapsamı dışındadır.'],
];

function packagePath(name) {
  try { return require.resolve(name); } catch (_) {}
  for (const dir of [process.env.VG_NODE_MODULES, path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean)) {
    if (fs.existsSync(path.join(dir, name))) return path.join(dir, name);
  }
  throw new Error(name + ' bulunamadı; VG_NODE_MODULES ayarlayın.');
}
function chromePath() {
  return [process.env.VG_CHROME, process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(f => fs.existsSync(f));
}

// ---------------------------------------------------------------- sayfa listesi
function pageList() {
  const xml = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const urls = [...xml.matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>/g)].map(m => m[1]).filter(u => !/\.(pdf|zip|png|jpe?g|webp|xml|txt)$/i.test(u));
  const extra = ['/404.html', '/arama.html', '/voltgame.html', '/calisan/giris.html', '/calisan/etkinlestir.html'];
  for (const f of fs.readdirSync(path.join(root, 'hesap'))) if (f.endsWith('.html')) extra.push('/hesap/' + f);
  for (const d of fs.readdirSync(path.join(root, 'voltsim'), { withFileTypes: true })) if (d.isDirectory() && fs.existsSync(path.join(root, 'voltsim', d.name, 'index.html'))) extra.push('/voltsim/' + d.name + '/');
  extra.push('/araclar/', '/araclar/ag-gerilim-dusumu/', '/araclar/kabul-tutanagi/', '/araclar/topraklama-simulatoru/');
  const all = [...new Set([...urls, ...extra])];
  return all.filter(u => !only.length || only.some(o => u.startsWith('/' + o) || u.startsWith(o)));
}

// ---------------------------------------------------------------- sayfa içi ölçüm
function measure() {
  /* eslint-disable no-var */
  const parse = s => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const blend = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const sel = el => {
    const parts = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement, i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) { parts.unshift(s + '#' + e.id); break; }
      const cls = (typeof e.className === 'string' ? e.className : (e.getAttribute('class') || '')).trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
    }
    return parts.join(' > ');
  };
  const pageBg = (() => { const c = parse(getComputedStyle(document.documentElement).backgroundColor); const b = parse(getComputedStyle(document.body).backgroundColor); let base = [255, 255, 255, 1]; if (c && c[3]) base = blend(c, base); if (b && b[3]) base = blend(b, base); return base; })();
  const media = [...document.querySelectorAll('img, video, canvas, picture, iframe')].map(m => ({ el: m, r: m.getBoundingClientRect() })).filter(o => o.r.width * o.r.height > 1500);
  const gradColors = s => (s.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean);

  // Arka plan: ata zinciri (alttan üste birleştirerek). Döner {bg:[r,g,b,1] | bgs:[...], over:'image'|null}
  function background(el, rect) {
    const layers = [];
    let over = null, grad = null;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      // metnin arkasında olmayan ata (ör. 2 px'lik çizgi içine konumlanmış etiket) zemin sayılmaz
      // (ata kırpıyorsa metin kaydırma alanı dışında, yani şu an görünmüyor: ölçülmez)
      if (e !== el) {
        const r = e.getBoundingClientRect();
        if (r.width && r.height && (cx < r.left - 1 || cx > r.right + 1 || cy < r.top - 1 || cy > r.bottom + 1)) {
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return { hidden: true };
          continue;
        }
      }
      const bi = cs.backgroundImage;
      if (bi && bi !== 'none') {
        // form denetimlerinde url() yalnız ok/ikon çizimidir: zemin rengi geçerli
        if (/url\(/.test(bi) && !e.matches('select, input, textarea, button')) { over = 'görsel zemin'; break; }
        const gc = gradColors(bi).filter(c => c[3] > .35);
        if (gc.length) { grad = gc; layers.push(parse(cs.backgroundColor)); break; }
      }
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= .9) break; }
      // aynı ata içinde metnin altında kalan görsel/canvas/video
      if (!over) for (const m of media) {
        if (!e.contains(m.el) || m.el.contains(el) || el.contains(m.el)) continue;
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        if (cx >= m.r.left && cx <= m.r.right && cy >= m.r.top && cy <= m.r.bottom) { over = m.el.tagName.toLowerCase() + ' üstünde'; break; }
      }
      if (over) break;
    }
    if (over) return { over };
    const compose = base => { let c = base; for (let i = layers.length - 1; i >= 0; i--) if (layers[i] && layers[i][3] > 0) c = blend(layers[i], c); return c; };
    if (grad) return { bgs: grad.map(g => compose(blend(g, pageBg))) };
    const last = layers[layers.length - 1];
    return { bgs: [compose(last && last[3] >= .99 ? last : pageBg)] };
  }
  function effOpacity(el) { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); o *= Number(cs.opacity); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; } return o; }
  const isSrOnly = (el, r) => r.width <= 2 || r.height <= 2 || /rect\(0/.test(getComputedStyle(el).clip);

  const issues = [];
  const seen = new Set();
  function check(el, fgStr, kind, textSample) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || isSrOnly(el, r)) return;
    if (r.bottom < -5000) return;
    const op = effOpacity(el);
    if (op < .15) return;
    const fg = parse(fgStr);
    if (!fg || fg[3] < .05) return;
    // gradyan dolgulu metin (background-clip: text) otomatik ölçülemez
    for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) { const s = getComputedStyle(e); if (/text/.test(s.webkitBackgroundClip || s.backgroundClip || '') || s.webkitTextFillColor === 'rgba(0, 0, 0, 0)') return; }
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    // kapalı <details> içeriği görünmez
    const det = el.closest('details:not([open])');
    if (det && !el.closest('summary')) return;
    const b = background(el, r);
    if (b.hidden) return;
    const key = kind + sel(el);
    if (b.over) { if (!seen.has(key + 'o')) { seen.add(key + 'o'); issues.push({ type: 'görsel üstünde', sel: sel(el), text: textSample, note: b.over }); } return; }
    let worst = 99, wbg = null;
    for (const bg of b.bgs) { const f = fg[3] < 1 ? blend(fg, bg) : fg; const q = ratio(f, bg); if (q < worst) { worst = q; wbg = bg; } }
    if (op < 1) worst = 1 + (worst - 1) * op; // yarı saydam metin
    if (worst < need && !seen.has(key)) {
      seen.add(key);
      const disabled = el.matches(':disabled, [aria-disabled="true"]') || !!el.closest('[disabled], [aria-disabled="true"]');
      issues.push({ type: worst < 1.25 ? 'görünmez metin' : 'kontrast', kind, sel: sel(el) + (disabled ? ' [disabled]' : ''), text: textSample, fg: hex(fg), bg: hex(wbg), ratio: Math.round(worst * 100) / 100, need, large });
    }
  }
  // metin düğümü taşıyan öğeler
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeValue.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
  const els = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|TITLE)$/.test(p.tagName)) continue;
    els.add(p);
  }
  for (const el of els) {
    if (el.closest('svg')) {
      // SVG metni: dolgu rengi; zemin, svg içinde metni kaplayan dikdörtgen varsa o
      const svg = el.closest('svg'); const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      let bgc = null;
      for (const rect of svg.querySelectorAll('rect, path, circle, polygon')) {
        if (rect.contains(el) || rect.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) continue;
        const rr = rect.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (rr.width * rr.height < r.width * r.height || cx < rr.left || cx > rr.right || cy < rr.top || cy > rr.bottom) continue;
        const f = parse(getComputedStyle(rect).fill);
        if (f && f[3] > .5) bgc = f;
      }
      const fill = cs.fill && cs.fill !== 'none' ? cs.fill : cs.color;
      if (bgc) {
        const fg = parse(fill); if (!fg) continue;
        const b = background(svg, svg.getBoundingClientRect()); const base = b.bgs ? b.bgs[0] : pageBg;
        const bg = bgc[3] < 1 ? blend(bgc, base) : bgc; const f = fg[3] < 1 ? blend(fg, bg) : fg;
        const q = ratio(f, bg), size = parseFloat(cs.fontSize), need = size >= 24 ? 3 : 4.5;
        if (q < need && effOpacity(el) > .15) issues.push({ type: q < 1.25 ? 'görünmez metin' : 'kontrast', kind: 'svg', sel: sel(el), text: el.textContent.trim().slice(0, 50), fg: hex(f), bg: hex(bg), ratio: Math.round(q * 100) / 100, need });
      } else check(el, fill, 'svg', el.textContent.trim().slice(0, 50));
      continue;
    }
    try { check(el, getComputedStyle(el).color, 'metin', [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim().slice(0, 50)); } catch (e) { /* DOM'dan ayrılmış öğe */ }
  }
  // form alanları: değer + placeholder
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select')) {
    check(el, getComputedStyle(el).color, 'alan', (el.value || el.getAttribute('aria-label') || el.name || '').slice(0, 40) || '(alan)');
    if (el.placeholder) check(el, getComputedStyle(el, '::placeholder').color, 'placeholder', el.placeholder.slice(0, 40));
  }
  for (const el of document.querySelectorAll('input[type=submit], input[type=button], input[type=reset]')) check(el, getComputedStyle(el).color, 'düğme', el.value.slice(0, 40));

  const over = document.documentElement.scrollWidth - innerWidth;
  const wide = over > 1 ? [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map(sel) : [];

  // görseller: saydam + çizim zemine karışıyor mu
  const imgs = [...document.querySelectorAll('img')].filter(i => { const r = i.getBoundingClientRect(); return r.width >= 24 && r.height >= 16 && i.complete && i.naturalWidth && effOpacity(i) > .15 && /\.(png|svg|webp|gif)(\?|#|$)|^data:image\/(png|svg|webp|gif)/i.test(i.currentSrc || i.src); });
  const imgJobs = imgs.map(i => ({ el: i, src: i.currentSrc || i.src, r: i.getBoundingClientRect() }));
  return { issues, overflow: over, wide, imgJobs: imgJobs.length, theme: document.documentElement.getAttribute('data-theme'), pageBg: hex(pageBg) };
}

// görsel analizi ayrı (asenkron: decode + canvas)
async function measureImages() {
  const parse = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  const blend = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  function bgOf(el) {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') { const g = (cs.backgroundImage.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(c => c && c[3] > .35); if (g.length) { layers.push(g[0]); break; } if (/url\(/.test(cs.backgroundImage)) return null; }
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= .99) break; }
    }
    let c = [255, 255, 255, 1];
    const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor); if (rootBg && rootBg[3]) c = blend(rootBg, c);
    for (let i = layers.length - 1; i >= 0; i--) c = blend(layers[i], c);
    return c;
  }
  const out = [];
  const imgs = [...document.querySelectorAll('img')].filter(i => { const r = i.getBoundingClientRect(); let o = 1; for (let e = i; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); o *= Number(cs.opacity); if (cs.display === 'none' || cs.visibility === 'hidden') o = 0; } return o > .15 && r.width >= 24 && r.height >= 16 && i.complete && i.naturalWidth && /\.(png|svg|webp|gif)(\?|#|$)|^data:image\/(png|svg|webp|gif)/i.test(i.currentSrc || i.src); });
  const seen = new Set();
  for (const img of imgs.slice(0, 160)) {
    const src = img.currentSrc || img.src;
    try {
      const cs = getComputedStyle(img);
      const own = parse(cs.backgroundColor);
      const bg = own && own[3] >= .99 ? own : bgOf(img.parentElement);
      if (!bg) continue;
      const cv = document.createElement('canvas'); const W = 64, H = Math.max(8, Math.round(64 * img.naturalHeight / img.naturalWidth)) || 64;
      cv.width = W; cv.height = Math.min(H, 256);
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
      let trans = 0, n = 0, inkL = 0, inkN = 0;
      for (let i = 0; i < d.length; i += 4) { n++; if (d[i + 3] < 24) { trans++; continue; } if (d[i + 3] > 160) { inkL += lum([d[i], d[i + 1], d[i + 2]]); inkN++; } }
      if (trans / n < .08 || !inkN) continue;
      const ink = inkL / inkN, bgL = lum(bg);
      const q = ratio(ink, bgL);
      if (q < 2 && !seen.has(src)) { seen.add(src); out.push({ type: 'okunamaz görsel', src: src.replace(location.origin, ''), alt: img.alt.slice(0, 40), ratio: Math.round(q * 100) / 100, transparent: Math.round(trans / n * 100) + '%' }); }
    } catch (e) { /* çapraz köken: atla */ }
  }
  return out;
}

// Takılan sayfa (sonsuz yükleme, ağır betik) tüm denetimi durdurmasın; zaman aşımında sekme kapatılır
async function auditPage(ctx, url) {
  const t0 = Date.now(), holder = {};
  let timer;
  const r = await Promise.race([auditPageInner(ctx, url, holder), new Promise(res => { timer = setTimeout(() => res({ url, errors: ['zaman aşımı (120 sn)'], info: null, imgs: [] }), 120000); })]);
  clearTimeout(timer);
  if (holder.page) await holder.page.close().catch(() => {});
  if (Date.now() - t0 > 30000) process.stderr.write('\n yavaş: ' + url + ' ' + Math.round((Date.now() - t0) / 1000) + ' sn\n');
  return r;
}
async function auditPageInner(ctx, url, holder) {
  const page = holder.page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/app.netlify.com|challenges.cloudflare.com|Failed to load resource: net::ERR_(NAME|INTERNET|CONNECTION)/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  let info = null, imgs = [];
  // Oturum gerektiren sayfalar giriş sayfasına yönlenebilir: bağlam yok olursa yeni sayfada bir kez daha dene
  for (let attempt = 0; attempt < 2 && !info; attempt++) {
    try {
      if (!attempt) await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
      if (attempt) await page.waitForTimeout(800);
      // ekrana girince açılan öğeler (reveal) için sayfayı baştan sona kaydır
      await page.evaluate(async () => {
        const step = Math.max(400, innerHeight * .8);
        for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 40; y += step, i++) { scrollTo(0, y); await new Promise(r => setTimeout(r, 50)); }
        scrollTo(0, 0);
        document.documentElement.classList.add('qa-no-anim');
        const st = document.createElement('style'); st.textContent = '*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}html *{content-visibility:visible!important}'; document.head.appendChild(st);
      });
      await page.waitForTimeout(450);
      info = await page.evaluate(measure);
      imgs = await page.evaluate(measureImages);
    } catch (e) {
      if (attempt || !/Execution context was destroyed|navigation|not of type 'Element'/i.test(e.message)) { errors.push('yükleme: ' + e.message.slice(0, 160)); break; }
    }
  }
  return { url, errors, info, imgs };
}

(async () => {
  const pages = pageList();
  const { chromium } = require(packagePath('playwright'));
  const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  const t0 = Date.now();
  try {
    for (const theme of THEMES) for (const vp of VPS) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, locale: 'tr-TR', serviceWorkers: 'block', deviceScaleFactor: 1, hasTouch: vp.w < 600, colorScheme: theme });
      await ctx.addInitScript(t => { try { localStorage.setItem('vg-theme', t); } catch (e) { /* no-op */ } }, theme);
      let i = 0;
      const worker = async () => { while (i < pages.length) { const url = pages[i++]; const r = await auditPage(ctx, url); r.theme = theme; r.vp = vp.tag; results.push(r); process.stdout.write('.'); } };
      await Promise.all(Array.from({ length: JOBS }, worker));
      await ctx.close();
    }
  } finally { await browser.close(); }

  // değerlendirme
  const isException = (url, s) => EXCEPTIONS.find(([pre, re]) => (!pre.length || pre.some(p => url.startsWith(p))) && re.test(s));
  const findings = [], excepted = [], overImage = [];
  for (const r of results) {
    const P = r.url + ' [' + r.theme + ' ' + r.vp + ']';
    r.errors.forEach(e => findings.push({ r, cat: 'hata', msg: 'konsol/sayfa hatası: ' + e }));
    if (!r.info) continue;
    if (r.info.theme !== r.theme) findings.push({ r, cat: 'tema', msg: 'tema uygulanmadı (data-theme=' + r.info.theme + ')' });
    if (r.info.overflow > 1) findings.push({ r, cat: 'taşma', msg: 'yatay taşma ' + r.info.overflow + ' px: ' + r.info.wide.join(', ') });
    for (const x of r.info.issues) {
      if (x.type === 'görsel üstünde') { overImage.push(r.url + ' — ' + x.sel + ' “' + x.text + '” (' + x.note + ')'); continue; }
      const msg = x.type + ' ' + x.ratio + ':1 (gerekli ' + x.need + ') ' + x.fg + ' / ' + x.bg + ' — ' + x.sel + ' “' + x.text + '”';
      const ex = isException(r.url, x.sel);
      if (ex) excepted.push(P + ' — ' + msg + ' — ' + ex[2]); else findings.push({ r, cat: x.type === 'görünmez metin' ? 'görünmez' : 'kontrast', msg });
    }
    for (const g of r.imgs) findings.push({ r, cat: 'görsel', msg: 'okunamaz görsel ' + g.src + ' (çizim/zemin ' + g.ratio + ':1, saydam ' + g.transparent + ')' });
  }
  const count = {};
  for (const f of findings) { const k = f.r.theme + ' ' + f.r.vp; count[k] = count[k] || {}; count[k][f.cat] = (count[k][f.cat] || 0) + 1; }
  const combos = [];
  for (const t of THEMES) for (const v of VPS) combos.push(t + ' ' + v.tag);
  const cats = ['kontrast', 'görünmez', 'görsel', 'taşma', 'hata', 'tema'];
  const md = ['# Tema denetimi (açık / koyu)', '', new Date().toISOString().slice(0, 16).replace('T', ' ') + ' · ' + pages.length + ' sayfa × ' + THEMES.length + ' tema × ' + VPS.length + ' genişlik · ' + Math.round((Date.now() - t0) / 1000) + ' sn · ' + BASE, '',
    '| tema · genişlik | ' + cats.join(' | ') + ' | toplam |', '|---|' + cats.map(() => '---:').join('|') + '|---:|',
    ...combos.map(k => '| ' + k + ' | ' + cats.map(c => (count[k] || {})[c] || 0).join(' | ') + ' | ' + cats.reduce((s, c) => s + ((count[k] || {})[c] || 0), 0) + ' |'), ''];
  const byPage = {};
  for (const f of findings) { const P = f.r.url + ' [' + f.r.theme + ' ' + f.r.vp + ']'; (byPage[P] = byPage[P] || []).push('- [' + f.cat + '] ' + f.msg); }
  md.push('## Bulgular (' + findings.length + ')', '');
  for (const P of Object.keys(byPage).sort()) md.push('### ' + P, ...byPage[P], '');
  md.push('## Gerekçeli istisnalar (' + excepted.length + ')', '', ...EXCEPTIONS.map(e => '- ' + (e[0].join(', ') || 'tüm sayfalar') + ' · `' + e[1].source + '` — ' + e[2]), '', ...excepted.slice(0, 300).map(x => '- ' + x), '');
  md.push('## Görsel/canvas üstündeki metin — otomatik ölçülmez, elle bakıldı (' + new Set(overImage).size + ')', '', ...[...new Set(overImage)].slice(0, 400).map(x => '- ' + x), '');
  fs.writeFileSync(path.join(outDir, OUT + '.md'), md.join('\n'));
  fs.writeFileSync(path.join(outDir, OUT + '.json'), JSON.stringify({ base: BASE, pages, count, findings: findings.map(f => ({ url: f.r.url, theme: f.r.theme, vp: f.r.vp, cat: f.cat, msg: f.msg })), excepted, overImage }, null, 1));
  console.log('\n' + combos.map(k => k + ': ' + cats.reduce((s, c) => s + ((count[k] || {})[c] || 0), 0)).join(' · ') + ' → .qa/audit/' + OUT + '.md');
  process.exitCode = findings.length ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; });
