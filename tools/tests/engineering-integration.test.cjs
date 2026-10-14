'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const project = path.resolve(__dirname, '../..');
const library = path.join(project, 'araclar');
const source = path.join(project, 'tools/engineering');
const catalog = require('../engineering/src/catalog.cjs');
const information = ['yontem', 'gizlilik', 'acik-kaynak'];
const pages = ['index.html', ...information.map(slug => slug + '/index.html'), ...catalog.map(tool => tool.slug + '/index.html')];
const origin = 'https://voltguard.com.tr';
const read = file => fs.readFileSync(path.join(library, file), 'utf8');
const liveMarkup = html => html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, '<script$1></script>');
const references = html => [...liveMarkup(html).matchAll(/\b(?:href|src)\s*=\s*(["'])([^"']*)\1/gi)].map(match => match[2]);
function calculationScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => {
      const type = match[1].match(/type\s*=\s*["']([^"']+)/)?.[1];
      return !/\bsrc\s*=/.test(match[1]) && (!type || /^(?:text|application)\/(?:javascript|ecmascript)$/.test(type));
    }).map(match => match[2]);
}
function nativeStorageKeys(html) {
  return new Set([
    ...[...html.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]),
    ...[...html.matchAll(/(?:var|let|const)\s+(?:LS|LS_KEY|KEY|DEPO_ANAHTAR|DIREK_ANAHTAR|KAYIT_ANAHTAR|STORAGE_KEY|STORE_KEY)\s*=\s*['"]([^'"]+)['"]/g)].map(match => match[1]),
  ]);
}
function storageNamespace(slug, key) {
  if (key.startsWith('voltguard:')) return key;
  // These historical key suffixes identify already saved projects. Company
  // signatures elsewhere in the source must never be changed by this mapping.
  const legacyKey = key.replace(/Sonay Enerji/gi, 'VoltGuard').replace(/SONAY ENERJİ/g, 'VOLTGUARD').replace(/SonayEnerji/g, 'VoltGuard');
  return `voltguard:${slug}:${legacyKey}`;
}
function integratedCalculation(script, slug, keys) {
  for (const key of keys) {
    const namespaced = storageNamespace(slug, key);
    script = script.split(JSON.stringify(key)).join(JSON.stringify(namespaced)).split("'" + key + "'").join("'" + namespaced + "'");
  }
  // Only presentation roots, relative paths and the native CBS heading change
  // during hosting. The remaining calculation and native report code must match.
  return script.replaceAll('../../', '../')
    .replace('<div class="sec-head"><h1>${sec.title}</h1>', '<div class="sec-head"><h2 class="vg-original-title">${sec.title}</h2>')
    .replace(/document\.body\.className\s*=\s*('tab-ciz'|'tab-'\s*\+\s*k)/g, "document.body.className = 'vg-engineering vg-engineering--tool ' + $1")
    .replaceAll("document.querySelectorAll('nav button')", "document.querySelectorAll('#vg-tool-workspace nav button')")
    .replaceAll('getComputedStyle(document.documentElement)', "getComputedStyle(document.getElementById('vg-tool-workspace') || document.documentElement)")
    .replace(/document\.body\.(appendChild|removeChild|insertBefore|insertAdjacentHTML)\(/g, "(document.getElementById('vg-tool-workspace') || document.body).$1(");
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
function hostedFile(url) {
  if (url.pathname === '/hesaplama-araclari/') return path.join(project, 'teklif-araclari.html');
  if (/^\/hesaplama\/[a-z0-9-]+\/$/.test(url.pathname)) return path.join(project, url.pathname.slice(1, -1) + '.html');
  const file = path.resolve(project, '.' + decodeURIComponent(url.pathname));
  assert.ok(file === project || file.startsWith(project + path.sep), url.href);
  assert.ok(fs.existsSync(file), 'Missing local target ' + url.pathname);
  return fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
}
function zipEntries() {
  const zip = fs.readFileSync(path.join(library, 'downloads/voltguard-cevrimdisi.zip'));
  const entries = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(zip.readUInt16LE(offset + 8), 0, 'Archive uses portable stored entries');
    const size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), name);
    assert.ok(!entries.has(name), 'Duplicate archive entry ' + name);
    const start = offset + 30 + nameLength + extraLength;
    entries.set(name, zip.subarray(start, start + size));
    offset = start + size;
  }
  assert.equal(zip.readUInt32LE(offset), 0x02014b50, 'ZIP has a central directory');
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, 'ZIP has an end directory record');
  assert.equal(zip.readUInt16LE(zip.length - 12), entries.size);
  return entries;
}

test('51 calculators publish once at flat routes with distinct canonical metadata', () => {
  assert.equal(catalog.length, 51);
  assert.equal(pages.length, 55);
  assert.ok(!fs.existsSync(path.join(library, 'araclar')));
  const titles = new Set(), descriptions = new Set();
  for (const file of pages) {
    const html = read(file), route = '/araclar/' + file.replace(/index\.html$/, '');
    assert.ok(html.includes('rel="canonical" href="' + origin + route + '"'), file);
    assert.ok(html.includes('property="og:url" content="' + origin + route + '"'), file);
    const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const description = html.match(/name="description" content="([^"]+)"/)?.[1];
    assert.ok(title && description, file + ' metadata');
    assert.ok(!titles.has(title), file + ' unique title');
    assert.ok(!descriptions.has(description), file + ' unique description');
    titles.add(title); descriptions.add(description);
    assert.equal((liveMarkup(html).match(/<h1\b/g) || []).length, 1, file + ' heading');
    for (const match of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      const graph = JSON.parse(match[1]);
      assert.ok(graph['@graph'].length, file + ' structured metadata');
    }
  }
});

test('Every integrated local asset and navigation link resolves within the main site', () => {
  for (const file of pages) {
    const route = '/araclar/' + file.replace(/index\.html$/, '');
    for (const ref of references(read(file))) {
      if (!ref || /^(?:data:|blob:|mailto:|tel:|javascript:)/i.test(ref)) continue;
      const url = new URL(ref, origin + route);
      if (url.origin !== origin) continue;
      assert.ok(fs.statSync(hostedFile(url)).size > 0, file + ': ' + ref);
    }
  }
  for (const tool of catalog) {
    const html = read(tool.slug + '/index.html');
    assert.match(html, /data-vg-vendor-base="\.\.\/vendor\/"/);
    assert.match(html, /href="\.\.\/#araclar"/);
    assert.match(html, /href="\/hesaplama-araclari\/"/);
    assert.match(html, /href="\/"/);
    assert.doesNotMatch(html, /\.\.\/\.\.\/(?:assets|shared|vendor|yontem|acik-kaynak)/);
  }
});

test('Public output contains no company application, build scripts, external fonts or duplicate worker', () => {
  const files = walk(library).map(file => path.relative(library, file).split(path.sep).join('/'));
  assert.ok(!fs.existsSync(path.join(library, 'sw.js')));
  for (const file of files) {
    assert.doesNotMatch(file, /(?:^|\/)(?:company|sirket|Teklif-Voltguard-main|research|tests|scripts|\.git)(?:\/|$)/i);
    assert.doesNotMatch(file, /\.(?:cjs|py|php|sql|sh|env|tar|gz)$/i);
    assert.doesNotMatch(path.basename(file), /^README(?:\.|$)/i);
  }
  for (const file of pages) {
    const html = read(file);
    assert.doesNotMatch(html, /Şirket Portalı|sunucu\.tail|\/sirket\//i);
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    assert.doesNotMatch(html, /chatgpt\.site/);
  }
  for (const tool of catalog) assert.match(read(tool.slug + '/index.html'), /serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(read('assets/site.js'), /serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(read('assets/site.js'), /location\.protocol!=='file:'/);
});

test('Integration preserves calculation scripts, export state and third-party license bytes', () => {
  const storage = JSON.parse(fs.readFileSync(path.join(source, 'storage-map.json'), 'utf8'));
  for (const tool of catalog) {
    const html = read(tool.slug + '/index.html');
    const native = fs.readFileSync(path.join(source, 'src/tools', tool.file), 'utf8');
    const keys = nativeStorageKeys(native), publishedScripts = calculationScripts(html);
    assert.ok(html.includes('data-vg-tool="' + tool.slug + '"'));
    assert.match(html, /shared\/export\.js/);
    for (const script of publishedScripts) assert.doesNotThrow(() => new vm.Script(script), tool.slug + ' script syntax');
    for (const script of calculationScripts(native)) {
      assert.ok(publishedScripts.includes(integratedCalculation(script, tool.slug, keys)), tool.slug + ': native calculation and report script preserved');
    }
    for (const key of keys) assert.ok(storage[tool.slug].includes(storageNamespace(tool.slug, key)), tool.slug + ': original saved-project namespace preserved');
    const encodedKeys = html.match(/data-vg-storage-keys="([^"]*)"/)?.[1];
    assert.ok(encodedKeys !== undefined, tool.slug + ' export storage allowlist');
    assert.deepEqual(JSON.parse(encodedKeys.replace(/&quot;/g, '"').replace(/&amp;/g, '&')), storage[tool.slug], tool.slug + ' export and calculation storage agree');
    if (tool.original) {
      assert.match(html, /data-vg-original-author="Baki SONAY"/);
      assert.match(html, /data-vg-original-source="Sonay Enerji"/);
      assert.match(html, /Paylaştığı özgün hesap araçları ve açık kaynak katkıları için teşekkür ederiz\./);
      const application = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
        .flatMap(match => JSON.parse(match[1])['@graph']).find(entry => entry['@type'] === 'WebApplication');
      assert.equal(application.creator.name, 'Baki SONAY');
      assert.equal(application.publisher.name, 'VoltGuard');
    } else {
      assert.doesNotMatch(html, /data-vg-original-author|Özgün hesap araçları: Baki SONAY/);
    }
  }
  const notices = JSON.parse(read('shared/third-party-notices.json'));
  assert.equal(notices.length, 7);
  for (const notice of notices) {
    const bytes = fs.readFileSync(path.join(library, 'vendor', notice.file));
    assert.match(notice.sourceFileSha256, /^[a-f0-9]{64}$/);
    assert.match(notice.distributedFileSha256, /^[a-f0-9]{64}$/);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), notice.distributedFileSha256, notice.file + ' distributed license hash');
    assert.doesNotMatch(bytes.toString('utf8'), /\r\n/, notice.file + ' canonical LF license bytes');
    assert.deepEqual(bytes, fs.readFileSync(path.join(source, 'src/vendor', notice.file)), notice.file + ' complete source license preserved');
    assert.equal(crypto.createHash('sha256').update(notice.notice).digest('hex'), notice.noticeSha256, notice.file + ' complete attribution notice hash');
  }
  for (const keys of Object.values(storage)) for (const key of keys) assert.ok(key.startsWith('voltguard:'));
  assert.ok(storage['direk-tepe-kuvveti'].includes('voltguard:direk-tepe-kuvveti:sonayEnerji_agDirekTepeKuvveti_v1'));
  assert.ok(storage['topraklama-simulatoru'].includes('voltguard:topraklama-simulatoru:sonay-topraklama-sim-v1'));
  assert.ok(storage['cbs-veri-girisi'].includes('voltguard:cbs-veri-girisi:sonay_3sahis_v1'));
});

test('Offline ZIP opens every local tool and information link as an explicit file', () => {
  const entries = zipEntries();
  assert.ok(entries.has('ONCE-OKUYUN.txt'));
  for (const file of pages) {
    assert.ok(entries.has(file), file + ' archive entry');
    const html = entries.get(file).toString('utf8');
    for (const ref of references(html)) {
      if (!ref || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(ref)) continue;
      assert.ok(!ref.startsWith('/'), file + ' file:// absolute link ' + ref);
      const url = new URL(ref, 'file:///archive/' + file);
      const target = decodeURIComponent(url.pathname).replace(/^\/archive\//, '');
      // The downloaded ZIP itself is already on disk; it is not recursively packed.
      if (target === 'downloads/voltguard-cevrimdisi.zip') continue;
      assert.ok(entries.has(target), file + ' offline link ' + ref);
      assert.ok(!target.endsWith('/'), file + ' directory link ' + ref);
    }
  }
  assert.doesNotMatch([...entries.keys()].join('\n'), /(?:^|\/)(?:company|sirket|scripts|tests)(?:\/|$)/m);
  assert.ok(!entries.has('sw.js'));
  for (const notice of JSON.parse(read('shared/third-party-notices.json'))) assert.ok(entries.has('vendor/' + notice.file));
});

test('Root sitemap contains all 55 integrated URLs and preserves existing calculators', () => {
  const xml = fs.readFileSync(path.join(project, 'sitemap.xml'), 'utf8');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const integrated = urls.filter(url => url.startsWith(origin + '/araclar/'));
  assert.equal(integrated.length, pages.length);
  assert.equal(new Set(urls).size, urls.length);
  for (const file of pages) assert.ok(urls.includes(origin + '/araclar/' + file.replace(/index\.html$/, '')));
  assert.ok(urls.includes(origin + '/'));
  assert.ok(urls.includes(origin + '/hesaplama/kablo-kesiti-hesaplama/'));
  for (const match of xml.matchAll(/<url>[\s\S]*?<\/url>/g)) {
    if (match[0].includes(origin + '/araclar/')) assert.match(match[0], /<lastmod>2026-10-13<\/lastmod>/);
  }
});

test('All engineering pages use the main site shell, fonts and offline brand assets', () => {
  const entries = zipEntries();
  for (const file of pages) {
    const html = liveMarkup(read(file));
    assert.equal((html.match(/id="vgHeader"/g) || []).length, 1, file + ' shared header');
    assert.equal((html.match(/id="vgFooter"/g) || []).length, 1, file + ' shared footer');
    assert.match(html, /class="logo-mark"/);
    assert.match(html, /vg-engineering/);
    assert.match(html, /\/css\/fonts\.css\?v=/);
    assert.match(html, /\/css\/vg-shell\.css\?v=/);
    assert.match(html, /assets\/host-theme\.css\?v=/);
    assert.match(html, /name="theme-color" content="#0a1628"/);
    assert.doesNotMatch(html, /<header class="site-header"|<footer class="site-footer"/);
    assert.doesNotMatch(entries.get(file).toString('utf8'), /data-vg-online-only/);
  }
  for (const file of ['css/fonts.css', 'css/fa-subset.css', 'css/vg-shell.css', 'js/vg-shell.js']) {
    assert.deepEqual(fs.readFileSync(path.join(project, file)), fs.readFileSync(path.join(library, 'assets/host', file)), file + ' shared source');
    assert.ok(entries.has('assets/host/' + file), file + ' offline asset');
  }
  const canal = read('kablo-kanal-plani/index.html');
  assert.match(canal, /className = 'vg-engineering vg-engineering--tool ' \+ 'tab-'/);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.theme_color, '#0a1628');
  assert.equal(manifest.background_color, '#f8fafc');
});
