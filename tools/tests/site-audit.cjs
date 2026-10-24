'use strict';

// Site geneli otomatik denetim: tüm herkese açık sayfaları önizleme sunucusu (tools/preview.cjs, yeniden yazma kurallarıyla)
// üzerinden masaüstü (1440) ve mobil (390) genişlikte açar; konsol/CSP hatası, eksik kaynak, kırık iç bağlantı, yatay taşma,
// başlık/açıklama uzunluğu ve tekrarı, canonical, H1/başlık sırası, alt metni ve küçük dokunma hedeflerini raporlar.
//   node tools/tests/site-audit.cjs                 (önizleme sunucusu 4173'te çalışıyor olmalı: npm run preview)
//   node tools/tests/site-audit.cjs bilgi hizmetler  yalnız yolu bu öneklerle başlayan sayfalar
// Çıktı: .qa/audit/otomatik.json ve .qa/audit/otomatik.md
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, '.qa/audit');
fs.mkdirSync(out, { recursive: true });
const BASE = process.env.VG_BASE || 'http://127.0.0.1:4173';
const NETLIFY_UI = /app.netlify.com/;
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));

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

// sayfa listesi: dosya sistemi → yayındaki adres
const SKIP = new Set(['.git', 'tools', 'VoltGame', 'voltguardekleyelim', 'vesikalar', '.qa', 'node_modules', '.netlify-publish', 'api', 'public', 'calisan', '.claude', 'Tanıtım Videosu']);
function walk(dir, acc) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !/^araclar\/(vendor|assets|shared|downloads)/.test(rel)) walk(rel, acc); }
    else if (e.name.endsWith('.html')) acc.push(rel);
  }
  return acc;
}
function urlOf(rel) {
  if (rel === 'index.html') return '/';
  if (rel === 'teklif-araclari.html') return '/hesaplama-araclari/';
  if (/^hesaplama\/[^/]+\.html$/.test(rel)) return '/' + rel.slice(0, -5) + '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -10);
  return '/' + rel;
}
const pages = walk('', []).filter(r => !/^(hesap\/|calisan\/)/.test(r) || /^hesap\/(giris|kayit|sifre-sifirla)\.html$/.test(r))
  .map(r => ({ file: r, url: urlOf(r) }))
  .filter(p => !only.length || only.some(o => p.file.startsWith(o) || p.url.startsWith('/' + o)));

(async () => {
  const { chromium } = require(packagePath('playwright'));
  const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const report = [];
  const linkStatus = new Map();
  async function checkLink(href) {
    if (linkStatus.has(href)) return linkStatus.get(href);
    let st = 0;
    try { const r = await fetch(BASE + href, { method: 'GET', redirect: 'follow' }); st = r.status; } catch (_) { st = -1; }
    linkStatus.set(href, st); return st;
  }
  try {
    for (const vp of [{ w: 1440, h: 900, tag: 'masaüstü' }, { w: 390, h: 844, tag: 'mobil' }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, locale: 'tr-TR', serviceWorkers: 'block', deviceScaleFactor: 1, hasTouch: vp.w < 600 });
      await ctx.addInitScript(() => { window.__qa = { csp: [] }; addEventListener('securitypolicyviolation', e => window.__qa.csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
      const page = await ctx.newPage();
      page.setDefaultTimeout(45000);
      for (const pg of pages) {
        const errors = [], missing = [];
        // Netlify önizlemesinin eklediği araç çubuğu (app.netlify.com) sitenin CSP'sine takılır; canlıda yoktur
        const onConsole = m => { if (m.type() === 'error' && !NETLIFY_UI.test(m.text())) errors.push(m.text().slice(0, 240)); };
        const onError = e => errors.push(String(e).slice(0, 240));
        const onResp = r => { const u = r.url(); if (r.status() >= 400 && u.startsWith(BASE)) missing.push(r.status() + ' ' + u.slice(BASE.length)); };
        page.on('console', onConsole); page.on('pageerror', onError); page.on('response', onResp);
        const t0 = Date.now();
        let ok = true;
        try { await page.goto(BASE + pg.url, { waitUntil: 'load' }); await page.waitForTimeout(400); } catch (e) { ok = false; errors.push('yükleme: ' + e.message.slice(0, 160)); }
        const ms = Date.now() - t0;
        const info = ok ? await page.evaluate(vw => {
          const q = s => Array.from(document.querySelectorAll(s));
          const meta = n => (document.querySelector('meta[name="' + n + '"]') || {}).content || '';
          const hs = q('h1,h2,h3,h4,h5,h6').filter(h => h.offsetParent !== null || getComputedStyle(h).position === 'fixed').map(h => Number(h.tagName[1]));
          let skips = 0; for (let i = 1; i < hs.length; i++) if (hs[i] > hs[i - 1] + 1) skips++;
          const imgsNoAlt = q('img').filter(i => !i.hasAttribute('alt')).map(i => i.getAttribute('src')).slice(0, 5);
          // a.href <base href> dahil çözülmüş adresi verir
          const links = Array.from(new Set(q('a[href]').filter(a => !/^(mailto:|tel:|javascript:|#|data:|whatsapp:)/i.test(a.getAttribute('href') || '')).map(a => { try { return new URL(a.href); } catch (_) { return null; } }).filter(u => u && u.origin === location.origin).map(u => u.pathname + (u.hash || ''))));
          const anchors = q('a[href^="#"]').map(a => a.getAttribute('href')).filter(h => h.length > 1 && !document.getElementById(decodeURIComponent(h.slice(1)))).slice(0, 5);
          const ids = {}; q('[id]').forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; });
          const dupIds = Object.keys(ids).filter(k => ids[k] > 1).slice(0, 5);
          let small = 0;
          if (vw < 600) q('a,button,input,select,textarea,[role=button]').forEach(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); // metin içi bağlantılar WCAG 2.5.8 kapsamında muaftır
            const inline = el.tagName === 'A' && el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length + 2 && cs.display === 'inline';
            if (r.width && r.height && cs.visibility !== 'hidden' && (r.width < 24 || r.height < 24) && !inline && !el.closest('.vs-label')) small++; });
          const over = document.documentElement.scrollWidth - innerWidth;
          const wide = over > 1 ? q('body *').filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map(e => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '')) : [];
          const ld = q('script[type="application/ld+json"]').map(s => { try { JSON.parse(s.textContent); return 'ok'; } catch (e) { return 'GEÇERSİZ JSON-LD'; } });
          return {
            title: document.title, desc: meta('description'), robots: meta('robots'),
            canonical: (document.querySelector('link[rel=canonical]') || {}).href || '',
            h1: q('h1').length, headingSkips: skips, imgsNoAlt: imgsNoAlt, links: links, badAnchors: anchors, dupIds: dupIds,
            smallTargets: small, overflow: over, wide: wide, ldErrors: ld.filter(x => x !== 'ok').length, lang: document.documentElement.lang,
            ogImage: !!document.querySelector('meta[property="og:image"]'), csp: window.__qa.csp
          };
        }, vp.w) : null;
        page.off('console', onConsole); page.off('pageerror', onError); page.off('response', onResp);
        const rec = { page: pg.url, file: pg.file, vp: vp.tag, ms, errors, missing, info };
        if (info && vp.tag === 'masaüstü') {
          rec.brokenLinks = [];
          for (const l of info.links) { const p = l.split('#')[0]; if (!p) continue; const st = await checkLink(p); if (st >= 400 || st < 0) rec.brokenLinks.push(st + ' ' + l); }
        }
        report.push(rec);
        process.stdout.write('.');
      }
      await ctx.close();
    }
  } finally { await browser.close(); }

  // değerlendirme
  const issues = [];
  const add = (sev, pg, msg) => issues.push({ sev, pg, msg });
  const titles = {}, descs = {};
  report.forEach(r => {
    const i = r.info, P = r.page + ' [' + r.vp + ']';
    r.errors.forEach(e => add('P0', P, 'konsol/sayfa hatası: ' + e));
    r.missing.forEach(m => add('P0', P, 'eksik kaynak: ' + m));
    if (!i) return;
    i.csp.forEach(c => add('P0', P, 'CSP ihlali: ' + c));
    if (r.vp === 'mobil' && i.overflow > 1) add('P1', P, 'yatay taşma ' + i.overflow + ' px: ' + i.wide.join(', '));
    if (r.vp === 'mobil' && i.smallTargets > 3) add('P2', P, i.smallTargets + ' küçük dokunma hedefi (<24 px)');
    if (r.vp !== 'masaüstü') return;
    (r.brokenLinks || []).forEach(l => add('P0', P, 'kırık iç bağlantı: ' + l));
    i.badAnchors.forEach(a => add('P1', P, 'hedefi olmayan çapa: ' + a));
    i.dupIds.forEach(d => add('P1', P, 'tekrarlanan id: ' + d));
    if (i.ldErrors) add('P0', P, 'geçersiz JSON-LD');
    const noindex = /noindex/.test(i.robots);
    if (!noindex) {
      if (!i.title || i.title.length < 25 || i.title.length > 70) add('P2', P, 'başlık uzunluğu ' + (i.title || '').length + ': “' + i.title + '”');
      if (!i.desc) add('P1', P, 'meta description yok'); else if (i.desc.length < 50 || i.desc.length > 170) add('P2', P, 'açıklama uzunluğu ' + i.desc.length);
      if (!i.canonical) add('P1', P, 'canonical yok');
      if (!i.ogImage) add('P3', P, 'og:image yok');
      (titles[i.title] = titles[i.title] || []).push(r.page);
      if (i.desc) (descs[i.desc] = descs[i.desc] || []).push(r.page);
    }
    if (i.h1 !== 1) add('P1', P, 'H1 sayısı ' + i.h1);
    if (i.headingSkips) add('P3', P, i.headingSkips + ' başlık seviyesi atlaması');
    if (i.imgsNoAlt.length) add('P1', P, 'alt metni olmayan görsel: ' + i.imgsNoAlt.join(', '));
    if (i.lang !== 'tr') add('P1', P, 'html lang = ' + i.lang);
    if (r.ms > 6000) add('P2', P, 'yükleme ' + r.ms + ' ms');
  });
  Object.keys(titles).filter(t => titles[t].length > 1).forEach(t => add('P1', titles[t].join(', '), 'aynı başlık: “' + t + '”'));
  Object.keys(descs).filter(t => descs[t].length > 1).forEach(t => add('P2', descs[t].join(', '), 'aynı açıklama'));
  fs.writeFileSync(path.join(out, 'otomatik.json'), JSON.stringify({ base: BASE, pages: pages.length, report, issues }, null, 1));
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  issues.sort((a, b) => order[a.sev] - order[b.sev] || a.pg.localeCompare(b.pg));
  const cnt = s => issues.filter(x => x.sev === s).length;
  const md = ['# Otomatik site denetimi', '', pages.length + ' sayfa × 2 görünüm · P0 ' + cnt('P0') + ' · P1 ' + cnt('P1') + ' · P2 ' + cnt('P2') + ' · P3 ' + cnt('P3'), '']
    .concat(issues.map(x => '- [' + x.sev + '] ' + x.pg + ' — ' + x.msg));
  fs.writeFileSync(path.join(out, 'otomatik.md'), md.join('\n'));
  console.log('\n' + pages.length + ' sayfa denetlendi · P0 ' + cnt('P0') + ' · P1 ' + cnt('P1') + ' · P2 ' + cnt('P2') + ' · P3 ' + cnt('P3') + ' → .qa/audit/otomatik.md');
})().catch(e => { console.error(e); process.exitCode = 1; });
