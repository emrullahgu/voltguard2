'use strict';
// The maintained Expo source is private. Only its reviewed web export is packaged.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ASSET_BASE = '/calisan/uygulama/assets/saha/';
const allowed = new Set(['.js', '.mjs', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg', '.ico',
  '.woff2', '.woff', '.ttf', '.otf', '.wasm', '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.pdf']);

function packageExport(root, dist) {
  root = fs.realpathSync(root);
  const application = path.join(root, 'calisan', 'uygulama');
  const target = path.join(application, 'assets', 'saha');
  const entry = path.join(application, 'saha-entry.html');
  const manifestFile = path.join(application, 'employee-modules-manifest.json');
  function within(base, candidate) {
    const relative = path.relative(base, candidate);
    return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
  }
  function noLinks(directory) {
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Saha output cannot contain directory links.');
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('Saha output cannot contain file links.');
      if (item.isDirectory()) noLinks(path.join(directory, item.name));
    }
  }
  for (const directory of [path.join(root, 'calisan'), application, path.dirname(target)]) {
    if (!fs.existsSync(directory)) fs.mkdirSync(directory);
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory() || !within(root, fs.realpathSync(directory))) throw new Error('Saha publication escaped the workspace.');
  }
  if (fs.existsSync(entry) && (fs.lstatSync(entry).isSymbolicLink() || !fs.lstatSync(entry).isFile())) throw new Error('Saha HTML entry must be a regular file.');
  noLinks(dist);
  const sourceRoot = fs.realpathSync(dist);
  let html = fs.readFileSync(path.join(sourceRoot, 'index.html'), 'utf8');
  if (!/<html\b/i.test(html) || !/<\/head>/i.test(html) || !/<\/body>/i.test(html)) throw new Error('Saha web export needs a complete HTML entry.');
  const staged = fs.mkdtempSync(path.join(path.dirname(target), '.saha-stage-'));
  const outputs = new Set();
  let bytes = 0;
  function write(relative, content) {
    if (!/^[A-Za-z0-9_., @()+\/-]+$/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error('Unsupported Saha asset filename: ' + relative);
    const output = path.join(staged, relative);
    if (!within(staged, output)) throw new Error('Saha asset escaped its stage.');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, content); outputs.add(relative); bytes += content.length;
  }
  function copy(directory, prefix = '') {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + item.name;
      if (item.name.startsWith('.') || /^(metadata|package(?:-lock)?)\.json$/i.test(item.name)) continue;
      if (item.isDirectory()) { copy(path.join(directory, item.name), relative + '/'); continue; }
      if (/\.(?:map|html)$/i.test(item.name)) continue;
      if (!allowed.has(path.extname(item.name).toLowerCase())) throw new Error('Unexpected Saha export asset: ' + relative);
      const content = fs.readFileSync(path.join(directory, item.name));
      if (/\.(?:js|mjs|css)$/i.test(item.name)) {
        const text = content.toString('utf8');
        if (/sourceMappingURL=|https?:\/\/[^\s"'<>]+\.supabase\.co|https?:\/\/[^\s"'<>]+\/(?:rest|auth|storage|functions)\/v1(?:[\/\s"'?]|$)|SUPABASE_SERVICE_ROLE|sb_secret_|BEGIN PRIVATE KEY|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/i.test(text)) throw new Error('Saha web export contains credentials, an old cloud endpoint or source maps: ' + relative);
      }
      write(relative, content);
    }
  }
  function removeStage(directory) {
    if (!within(path.dirname(target), directory) || fs.lstatSync(directory).isSymbolicLink() || !within(path.dirname(target), fs.realpathSync(directory))) throw new Error('Invalid Saha output removal.');
    noLinks(directory); fs.rmSync(directory, { recursive: true });
  }
  function moveDirectory(from, to) {
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(from, to); return; }
      catch (error) {
        if (attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * (attempt + 1));
      }
    }
  }
  try {
    copy(sourceRoot);
    // Expo's small boot scripts remain executable under script-src 'self'.
    html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attributes, code) => {
      if (/\bsrc\s*=/i.test(attributes) || !code.trim() || /\btype\s*=\s*["'](?:application\/json|application\/ld\+json)["']/i.test(attributes)) return whole;
      const relative = 'bootstrap-' + crypto.createHash('sha256').update(code).digest('hex').slice(0, 16) + '.js';
      write(relative, Buffer.from(code));
      return '<script' + attributes + ' src="' + ASSET_BASE + relative + '"></script>';
    });
    html = html.replace(/<base\b[^>]*>/gi, '').replace(/<meta\b[^>]*name=["']robots["'][^>]*>/gi, '');
    // A few Expo versions leave favicon references rooted at / despite baseUrl.
    html = html.replace(/\b(src|href)=(['"])([^'"]+)\2/gi, (whole, attribute, quote, url) => {
      if (url.startsWith('#') || /^(?:data|blob):/i.test(url)) return whole;
      if (/^(?:https?:)?\/\//i.test(url)) throw new Error('Saha entry cannot load an external asset.');
      let local = url;
      if (local.startsWith(ASSET_BASE)) local = local.slice(ASSET_BASE.length);
      else local = local.replace(/^\.?\//, '');
      local = local.split(/[?#]/)[0];
      if (!outputs.has(local)) throw new Error('Saha entry references a missing asset: ' + url);
      return attribute + '=' + quote + ASSET_BASE + local + quote;
    });
    html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + ASSET_BASE + '"><meta name="robots" content="noindex,nofollow,noarchive">');
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]);
    const styles = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0]).filter(tag => /\brel=["']stylesheet["']/i.test(tag)).map(tag => /\bhref=["']([^"']+)["']/i.exec(tag)?.[1]).filter(Boolean);
    if (!scripts.length || scripts.some(url => !url.startsWith(ASSET_BASE) || !/\.m?js$/.test(url)) || styles.some(url => !url.startsWith(ASSET_BASE) || !/\.css$/.test(url))) throw new Error('Employee module runtime assets are invalid.');
    const previous = path.join(path.dirname(target), '.saha-previous-' + crypto.randomBytes(8).toString('hex'));
    if (fs.existsSync(target)) { noLinks(target); moveDirectory(target, previous); }
    try { moveDirectory(staged, target); }
    catch (error) { if (fs.existsSync(previous) && !fs.existsSync(target)) moveDirectory(previous, target); throw error; }
    fs.writeFileSync(entry, html);
    fs.writeFileSync(manifestFile, JSON.stringify({ version: 1, scripts, styles }) + '\n');
    if (fs.existsSync(previous)) removeStage(previous);
    return { files: outputs.size, bytes, entry, target, manifestFile };
  } finally {
    if (fs.existsSync(staged)) removeStage(staged);
  }
}

function build(root = path.resolve(__dirname, '..')) {
  const schema = spawnSync(process.execPath, [path.join(root, 'tools/build-saha-schema.cjs')], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (schema.status !== 0) throw new Error('Private Saha source schema preparation failed.');
  const source = path.join(root, 'tools', 'saha-app');
  const cli = path.join(source, 'node_modules', 'expo', 'bin', 'cli');
  if (!fs.existsSync(cli)) throw new Error('Install the locked Saha web dependencies before building.');
  const result = spawnSync(process.execPath, [cli, 'export', '--platform', 'web', '--output-dir', 'dist'], {
    cwd: source, stdio: 'inherit', windowsHide: true, env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' }
  });
  if (result.status !== 0) throw new Error('Saha web export failed.');
  const output = packageExport(root, path.join(source, 'dist'));
  console.log(`Employee Saha application packaged (${output.files} protected assets).`);
  return output;
}
module.exports = { ASSET_BASE, packageExport, build };
if (require.main === module) build();
