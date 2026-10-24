'use strict';

// Builds the curated public calculators without depending on the imported workspace.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const source = path.join(__dirname, 'engineering');
const intermediate = path.join(source, 'dist');
const output = path.join(project, 'araclar');
const staging = path.join(source, '.publish-stage');
const origin = 'https://voltguard.com.tr';
const catalog = require('./engineering/src/catalog.cjs');
const { scopeCss } = require('./engineering/scope-css.cjs');
const documentSlugs = ['yontem', 'gizlilik', 'acik-kaynak'];

function hostAssets() {
  const revision = file => require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(project, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 12); // sync-versions.py ile aynı: CRLF/LF farkı yok sayılır
  return ['css/fonts.css', 'css/fa-subset.css', 'css/vg-shell.css']
    .map(file => `<link rel="stylesheet" href="/${file}?v=${revision(file)}">`).join('') +
    `<script src="/js/vg-shell.js?v=${revision('js/vg-shell.js')}" defer></script>` +
    `<script src="/js/vg-metrics.js?v=${revision('js/vg-metrics.js')}" defer data-vg-online-only></script>` +
    `<script src="/js/voltguard-auth.js?v=${revision('js/voltguard-auth.js')}" defer data-vg-online-only></script>` +
    '<meta name="color-scheme" content="light only">';
}

function integrateHostShell(html, route, isTool) {
  const scripts = [];
  // Printed HTML templates and executable strings are never treated as live styles.
  let markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,
    script => `<!--VG_INTEGRATION_SCRIPT_${scripts.push(script) - 1}-->`);
  if (isTool) markup = markup.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_, start, css, end) => start + scopeCss(css) + end);
  const type = isTool ? 'tool' : route === '/araclar/' ? 'catalog' : 'info';
  markup = markup.replace(/<body([^>]*)>/i, (_, attrs) => {
    if (/\bclass=/.test(attrs)) attrs = attrs.replace(/\bclass=(["'])(.*?)\1/i,
      (_, quote, classes) => `class=${quote}${classes} vg-engineering vg-engineering--${type}${quote}`);
    else attrs += ` class="vg-engineering vg-engineering--${type}"`;
    return `<body${attrs}>`;
  });
  let header = fs.readFileSync(path.join(__dirname, 'shell/header.html'), 'utf8').trim()
    .replace('<header ', '<header data-vg-no-print ');
  const footer = fs.readFileSync(path.join(__dirname, 'shell/footer.html'), 'utf8').trim()
    .replace('<footer ', '<footer data-vg-no-print ');
  if (isTool) {
    const body = markup.match(/(<body\b[^>]*>)([\s\S]*)(<\/body>)/i);
    if (!body) throw new Error('Tool has no complete body: ' + route);
    const content = body[2], topEnd = content.indexOf('</details></div>') + '</details></div>'.length;
    const originStart = content.lastIndexOf('<div id="vg-origin">');
    if (topEnd < '</details></div>'.length || originStart < topEnd) throw new Error('Tool shell structure changed: ' + route);
    const top = content.slice(0, topEnd).replace(/<a\b[^>]*class="vg-brand"[^>]*>[\s\S]*?<\/a>/, '');
    const native = content.slice(topEnd, originStart);
    const mainId = /\bid=["']main["']/.test(native) ? 'vg-engineering-main' : 'main';
    header = header.replace('href="#main"', `href="#${mainId}"`);
    const mainRole = /<main\b/i.test(native) ? '' : ' role="main"';
    markup = markup.replace(body[0], body[1] + header +
      `<div id="${mainId}" tabindex="-1"${mainRole}>${top}<div id="vg-tool-workspace">${native}</div>` +
      content.slice(originStart) + '</div>' + footer + body[3]);
  } else {
    markup = markup.replace(/<a class="skip"[^>]*>[\s\S]*?<\/a>/, '')
      .replace(/<header class="site-header"[^>]*>[\s\S]*?<\/header>/, header)
      .replace(/<footer class="site-footer"[^>]*>[\s\S]*?<\/footer>/, footer);
  }
  const prefix = route === '/araclar/' ? '' : '../';
  markup = markup.replace(/<\/head>/i, hostAssets() +
    `<link rel="stylesheet" href="${prefix}assets/host-theme.css?v=${revisionForTheme()}"></head>`);
  // Native tab switching must not bind to the shared site's dropdown button.
  return markup.replace(/<!--VG_INTEGRATION_SCRIPT_(\d+)-->/g, (_, index) => {
    let script = scripts[Number(index)];
    if (isTool) script = script
      .replace(/document\.body\.className\s*=\s*('tab-ciz'|'tab-'\s*\+\s*k)/g,
        "document.body.className = 'vg-engineering vg-engineering--tool ' + $1")
      .replaceAll("document.querySelectorAll('nav button')", "document.querySelectorAll('#vg-tool-workspace nav button')")
      .replaceAll('getComputedStyle(document.documentElement)', "getComputedStyle(document.getElementById('vg-tool-workspace') || document.documentElement)")
      .replace(/document\.body\.(appendChild|removeChild|insertBefore|insertAdjacentHTML)\(/g,
        "(document.getElementById('vg-tool-workspace') || document.body).$1(");
    return script;
  });
}

function revisionForTheme() {
  return require('node:crypto').createHash('sha256')
    .update(fs.readFileSync(path.join(source, 'src/assets/host-theme.css'), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
}

function removeGenerated(directory, expected) {
  const resolved = path.resolve(directory);
  if (resolved !== path.resolve(expected) || !resolved.startsWith(project + path.sep)) {
    throw new Error('Generated directory is outside the intended workspace.');
  }
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Refusing to replace a non-directory or linked output.');
    }
    if (!fs.realpathSync(resolved).startsWith(fs.realpathSync(project) + path.sep)) {
      throw new Error('Generated directory resolves outside the workspace.');
    }
    fs.rmSync(resolved, { recursive: true });
  }
}

function run(script, extraEnv = {}) {
  const result = spawnSync(process.execPath, [script], {
    cwd: source, stdio: 'inherit', env: { ...process.env, VG_SITE_ORIGIN: origin, ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Engineering build step failed: ' + path.basename(script));
}

function stripExternalFonts(html) {
  return html.replace(/@import\s+(?:url\(\s*)?["']?https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^;]+;/gi, '');
}

function transformMetadata(html, route) {
  const canonical = origin + route;
  html = html.replace(/(<link\b[^>]*rel="canonical"[^>]*href=")[^"]+("[^>]*>)/gi, '$1' + canonical + '$2');
  html = html.replace(/(<meta\b[^>]*property="og:url"[^>]*content=")[^"]+("[^>]*>)/gi, '$1' + canonical + '$2');
  html = html.replaceAll(origin + '/assets/', origin + '/araclar/assets/');
  return html.replace(/(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, opening, json, closing) => {
    const graph = JSON.parse(json);
    function remap(value) {
      if (!value || typeof value !== 'object') return;
      if (value['@type'] === 'WebSite') value.url = origin + '/araclar/';
      if (value['@type'] === 'WebPage') value.url = canonical;
      if (Array.isArray(value)) value.forEach(remap);
      else for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'string' && documentSlugs.some(slug => entry === origin + '/' + slug + '/')) {
          value[key] = origin + '/araclar' + entry.slice(origin.length);
        } else remap(entry);
      }
    }
    remap(graph);
    return opening + JSON.stringify(graph).replace(/</g, '\\u003c') + closing;
  });
}

function publicHTML(html, route, isTool = false) {
  html = stripExternalFonts(html);
  html = html.replace(/(<meta\b[^>]*name="theme-color"[^>]*content=")[^"]+("[^>]*>)/gi, '$1#0a1628$2');
  // The standalone build puts tools two directories below its library. The integrated
  // library has one directory level; sibling-tool links retain their existing paths.
  if (isTool) html = html.replaceAll('../../', '../');
  else html = html.replace(/(href=["'])araclar\//g, '$1').replaceAll('../araclar/', '../');
  html = html.replace(/<a\b[^>]*class="header-action"[^>]*>[\s\S]*?<\/a>/g,
    '<a class="header-action" href="/">VoltGuard ana sayfa ↗</a>');
  html = html.replace(/<a\b[^>]*href="(?:\.\.\/)*sirket\/"[^>]*>[\s\S]*?<\/a>/g, (anchor) =>
    anchor.includes('vg-back') ? '<a class="vg-back" href="/hesaplama-araclari/">Pratik hesaplar →</a><a class="vg-back" href="/">VoltGuard ana sayfa ↗</a>' : '');
  html = html.replace(/(<nav class="header-nav"[^>]*>)/g,
    '$1<a href="/hesaplama-araclari/">Pratik hesaplar</a>');
  html = html.replace(/<h2>Şirket Portalı<\/h2><p>[\s\S]*?<\/p>/g, '');
  html = html.replace(/(<a class="back" href="\.\.\/">)[^<]+(<\/a>)/g, '$1← Araç kütüphanesine dön$2');
  html = html.replace(/serviceWorker\.register\(['"](?:\.\.\/)*sw\.js['"]\)/g, "serviceWorker.register('/sw.js')");
  html = transformMetadata(html, route);
  html = integrateHostShell(html, route, isTool);
  if (/Şirket Portalı|sunucu\.tail|\/sirket\//i.test(html)) {
    throw new Error('Company portal content found in public output: ' + route);
  }
  return html;
}

function copyPublicDirectory(name) {
  fs.cpSync(path.join(intermediate, name), path.join(staging, name), {
    recursive: true,
    // Preparation scripts and build notes are source artifacts, never public assets.
    filter: file => !/\.(?:cjs|py)$/i.test(file) && !/(?:^|[\\/])README(?:\.[^\\/]*)?$/i.test(file),
  });
}

function updateSitemap() {
  const sitemapFile = path.join(project, 'sitemap.xml');
  const initialRelease = '2026-10-13';
  const existing = fs.readFileSync(sitemapFile, 'utf8');
  let xml = existing;
  if (!/<\/urlset>/.test(xml)) throw new Error('Root sitemap has no closing urlset.');
  xml = xml.replace(/\r?\n[ \t]*<url>[\s\S]*?<\/url>/g, entry =>
    /<loc>https:\/\/voltguard\.com\.tr\/araclar(?:\/|<)/.test(entry) ? '' : entry);
  const routes = ['/araclar/', ...documentSlugs.map(slug => '/araclar/' + slug + '/'),
    ...catalog.map(tool => '/araclar/' + tool.slug + '/')];
  const entries = routes.map(route => '  <url>\n    <loc>' + origin + route + '</loc>\n    <lastmod>' + initialRelease + '</lastmod>\n  </url>').join('\n');
  xml = xml.replace(/\s*<\/urlset>/, '\n' + entries + '\n</urlset>');
  if (xml !== existing) fs.writeFileSync(sitemapFile, xml);
}

function build() {
  removeGenerated(intermediate, path.join(source, 'dist'));
  run(path.join(source, 'scripts/build.cjs'));
  removeGenerated(staging, path.join(source, '.publish-stage'));
  fs.mkdirSync(staging, { recursive: true });
  for (const directory of ['assets', 'shared', 'vendor']) copyPublicDirectory(directory);
  // The archive uses the same site fonts and shell even without a web server.
  const host = path.join(staging, 'assets/host');
  fs.mkdirSync(path.join(host, 'css'), { recursive: true });
  fs.mkdirSync(path.join(host, 'js'), { recursive: true });
  fs.mkdirSync(path.join(host, 'public'), { recursive: true });
  fs.copyFileSync(path.join(project, 'public/voltguard-logo.webp'), path.join(host, 'public/voltguard-logo.webp'));
  for (const file of ['fonts.css', 'fa-subset.css', 'vg-shell.css'])
    fs.copyFileSync(path.join(project, 'css', file), path.join(host, 'css', file));
  fs.copyFileSync(path.join(project, 'js/vg-shell.js'), path.join(host, 'js/vg-shell.js'));
  fs.cpSync(path.join(project, 'fonts'), path.join(host, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'index.html'), publicHTML(fs.readFileSync(path.join(intermediate, 'index.html'), 'utf8'), '/araclar/'));
  for (const tool of catalog) {
    const directory = path.join(staging, tool.slug);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'index.html'), publicHTML(
      fs.readFileSync(path.join(intermediate, 'araclar', tool.slug, 'index.html'), 'utf8'), '/araclar/' + tool.slug + '/', true));
  }
  for (const slug of documentSlugs) {
    fs.mkdirSync(path.join(staging, slug));
    fs.writeFileSync(path.join(staging, slug, 'index.html'), publicHTML(
      fs.readFileSync(path.join(intermediate, slug, 'index.html'), 'utf8'), '/araclar/' + slug + '/'));
  }
  fs.copyFileSync(path.join(intermediate, 'acik-kaynak/depo-incelemesi.json'), path.join(staging, 'acik-kaynak/depo-incelemesi.json'));
  fs.copyFileSync(path.join(intermediate, 'tool-catalog.json'), path.join(staging, 'tool-catalog.json'));
  fs.copyFileSync(path.join(intermediate, 'manifest.webmanifest'), path.join(staging, 'manifest.webmanifest'));
  const appManifest = JSON.parse(fs.readFileSync(path.join(staging, 'manifest.webmanifest'), 'utf8'));
  appManifest.theme_color = '#0a1628'; appManifest.background_color = '#f8fafc';
  appManifest.name = 'VoltGuard Mühendislik Uygulamaları';
  fs.writeFileSync(path.join(staging, 'manifest.webmanifest'), JSON.stringify(appManifest));
  const siteScript = path.join(staging, 'assets/site.js');
  fs.writeFileSync(siteScript, fs.readFileSync(siteScript, 'utf8')
    .replace("a.href='araclar/'+r.slug+'/';", "a.href=r.slug+'/';if(location.protocol==='file:')a.href+='index.html';")
    .replace("if('serviceWorker'in navigator)", "if('serviceWorker'in navigator&&location.protocol!=='file:')")
    .replace("serviceWorker.register('sw.js')", "serviceWorker.register('/sw.js')"));
  run(path.join(source, 'scripts/make-download.cjs'), { VG_DOWNLOAD_DIR: staging, VG_INTEGRATED_ARCHIVE: '1' });
  // Publish only after all pages and the archive are ready. Explicit paths above protect
  // project sources and existing site pages while removing obsolete generated routes.
  removeGenerated(output, path.join(project, 'araclar'));
  fs.renameSync(staging, output);
  updateSitemap();
  console.log('Integrated ' + catalog.length + ' engineering tools at /araclar/.');
}

if (require.main === module) build();
module.exports = { build, publicHTML, stripExternalFonts, transformMetadata, updateSitemap };
