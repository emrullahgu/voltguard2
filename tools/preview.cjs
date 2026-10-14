'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.VG_PREVIEW_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Geçerli bir önizleme bağlantı noktası seçin.');
const origin = `http://127.0.0.1:${port}`;
const workspaceHash = crypto.createHash('sha256').update(fs.realpathSync(root).toLowerCase()).digest('hex').slice(0, 20);
const dataDirectory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'VoltGuard', 'preview-data', workspaceHash);
const internalToken = crypto.randomBytes(32).toString('hex');
const phpRoutes = new Set(['/api/auth.php', '/api/community.php', '/api/staff.php', '/api/company.php',
  '/api/company-asset.php', '/api/company-connectors.php', '/calisan/', '/calisan/index.php',
  '/calisan/uygulama', '/calisan/uygulama/']);
const csp = fs.readFileSync(path.join(root, '.htaccess'), 'utf8').match(/Header always set Content-Security-Policy "([^"]+)"/)[1];
const maxProxyBody = 10 * 1024 * 1024;
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.license': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.pdf': 'application/pdf',
  '.zip': 'application/zip', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8'
};
let phpChild = null;
let phpPort = null;
let phpReady = false;
let shuttingDown = false;

function withoutHopHeaders(headers) {
  const nominated = String(headers.connection || '').toLowerCase().split(',').map(value => value.trim());
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !hopHeaders.has(key.toLowerCase()) && !nominated.includes(key.toLowerCase())));
}

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const selected = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return selected;
}

function phpRuntime() {
  const bundled = path.join(root, '.qa', 'php', 'runtime', process.platform === 'win32' ? 'php.exe' : 'php');
  const executable = process.env.VG_PHP || (fs.existsSync(bundled) ? bundled : 'php');
  const probe = spawnSync(executable, ['-n', '-r', 'echo json_encode(["modules"=>get_loaded_extensions(),"extensionDir"=>ini_get("extension_dir")]);'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (probe.error || probe.status !== 0) return null;
  let configuration;
  try { configuration = JSON.parse(probe.stdout); } catch (_) { return null; }
  const modules = new Set(configuration.modules.map(value => value.toLowerCase()));
  const required = ['mbstring', 'fileinfo', 'openssl', 'pdo_sqlite'];
  const adjacent = path.join(path.dirname(executable), 'ext');
  const extensionDirectory = fs.existsSync(adjacent) ? adjacent : configuration.extensionDir;
  const flags = ['-n', '-d', `extension_dir=${extensionDirectory}`];
  for (const extension of required) if (!modules.has(extension)) flags.push('-d', `extension=${extension}`);
  const verify = spawnSync(executable, [...flags, '-r', 'echo json_encode(get_loaded_extensions());'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  if (verify.error || verify.status !== 0) return null;
  try {
    const loaded = new Set(JSON.parse(verify.stdout).map(value => value.toLowerCase()));
    if (!required.every(extension => loaded.has(extension))) return null;
  } catch (_) { return null; }
  return { executable, flags };
}

async function startPhp() {
  const runtime = phpRuntime();
  if (!runtime) return;
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const actualData = fs.realpathSync(dataDirectory);
  const relative = path.relative(fs.realpathSync(root), actualData);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    console.warn('Özel önizleme verisi site klasörü dışında olmalı; PHP erişimi kapalı.');
    return;
  }
  phpPort = await unusedPort();
  phpChild = spawn(runtime.executable, [...runtime.flags,
    '-d', 'display_errors=0', '-d', 'log_errors=1', '-d', 'upload_max_filesize=8M', '-d', 'post_max_size=10M',
    '-S', `127.0.0.1:${phpPort}`, '-t', root, path.join(root, 'tools/preview-router.php')], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, VG_DATA_DIR: dataDirectory, VG_STAFF_SITE_URL: origin, VG_SITE_URL: origin, VG_PREVIEW_INTERNAL_TOKEN: internalToken, VG_MAIL_OUTBOX: '1' }
  });
  // Request paths may contain sensitive query parameters. Never echo PHP access logs into the chat.
  phpChild.stderr.on('data', () => {});
  phpChild.on('error', () => { phpReady = false; });
  phpChild.on('exit', () => { phpReady = false; if (!shuttingDown) console.warn('PHP önizleme hizmeti durdu; korunan erişim kapalı.'); });
  for (let attempt = 0; attempt < 100 && phpChild.exitCode === null; attempt++) {
    const connected = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port: phpPort });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.setTimeout(100, () => { socket.destroy(); resolve(false); });
    });
    if (connected) { phpReady = true; return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (phpChild) phpChild.kill();
}

function fail(res, code, message, json = false) {
  if (res.headersSent) return res.destroy();
  res.writeHead(code, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' });
  const requestPath = new URL(res.req.url, origin).pathname;
  const api = /^\/api\/company(?:-asset|-connectors)?\.php$/.test(requestPath) || /^\/calisan\/uygulama\//.test(requestPath)
    ? 'vg-company/1' : requestPath === '/api/staff.php' ? 'vg-staff/1' : 'vg-auth/1';
  res.end(json ? JSON.stringify({ api, ok: false, error: code === 413 ? 'too_large' : code === 405 ? 'method_not_allowed' : 'unavailable', message }) : message);
}

function blockedPath(pathname) {
  return pathname.includes('\\') || pathname.includes('\0') || /(^|\/)\./.test(pathname)
    || /^\/(tools|voltguardekleyelim|vesikalar|VoltGame|api|_vgdata|vg-data|vgdata)(\/|$)/i.test(pathname)
    || /^\/(?:api|calisan)\.new(?:\/|$)/i.test(pathname)
    || /^\/calisan\/shared-(?:header|footer)\.html$/i.test(pathname)
    || /^\/calisan\/uygulama(?:\/|$)/i.test(pathname)
    || /\.php(?:\/|$)/i.test(pathname)
    || /\.(?:cjs|py|md|sql|sh|ya?ml|toml|env|log|bak|key)$/i.test(pathname);
}

function proxyPhp(req, res, pathname, requestPath = req.url) {
  if (!phpReady) return fail(res, 503, 'PHP hizmeti şu anda kullanılamıyor. Korunan erişim kapalı.', pathname.startsWith('/api/'));
  if (!['GET', 'POST', 'HEAD'].includes(req.method)) return fail(res, 405, 'İstek yöntemi desteklenmiyor.', pathname.startsWith('/api/'));
  const length = Number(req.headers['content-length'] || 0);
  if (!Number.isFinite(length) || length > maxProxyBody) return fail(res, 413, 'Gönderilen veri çok büyük.', pathname.startsWith('/api/'));
  const headers = withoutHopHeaders(req.headers);
  // Trust neither browser-supplied forwarding metadata nor a supplied internal token.
  for (const header of Object.keys(headers)) if (header.startsWith('x-forwarded-') || ['forwarded', 'x-vg-preview-internal', 'cf-connecting-ip'].includes(header)) delete headers[header];
  headers.host = req.headers.host;
  headers['x-vg-preview-internal'] = internalToken;
  const upstream = http.request({ host: '127.0.0.1', port: phpPort, method: req.method, path: requestPath, headers, timeout: 30000 }, response => {
    res.writeHead(response.statusCode, withoutHopHeaders(response.headers));
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy());
  upstream.on('error', () => fail(res, 503, 'PHP hizmeti şu anda kullanılamıyor. Lütfen yeniden deneyin.', pathname.startsWith('/api/')));
  let bytes = 0;
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > maxProxyBody) { req.unpipe(upstream); upstream.destroy(); fail(res, 413, 'Gönderilen veri çok büyük.', pathname.startsWith('/api/')); }
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  let url, pathname;
  try { url = new URL(req.url, origin); pathname = decodeURIComponent(url.pathname); }
  catch (_) { return fail(res, 400, 'Geçersiz adres.'); }
  if (!new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(String(req.headers.host || '').toLowerCase())) return fail(res, 403, 'Bu kaynak kabul edilmedi.');
  if (pathname.includes('\\') || pathname.includes('\0') || /(^|\/)\./.test(pathname)) return fail(res, 404, 'Sayfa bulunamadı.');
  function redirect(destination) { res.writeHead(301, { Location: destination + url.search }); res.end(); }
  if (pathname === '/calisan') return redirect('/calisan/');
  if (phpRoutes.has(pathname)) return proxyPhp(req, res, pathname);
  if (/^\/calisan\/uygulama\/(?:assets|fonts|licenses)\/.+/.test(pathname) || pathname === '/calisan/uygulama/fatura_logo.png') {
    const file = pathname.slice('/calisan/uygulama/'.length);
    const query = new URLSearchParams(url.search);
    query.delete('file');
    query.set('file', file);
    return proxyPhp(req, res, '/api/company-asset.php', '/api/company-asset.php?' + query.toString());
  }
  if (/^\/voltgame\/?$/i.test(pathname)) return redirect('/voltgame.html');
  if (blockedPath(pathname)) return fail(res, 404, 'Sayfa bulunamadı.');
  if (!['GET', 'HEAD'].includes(req.method)) return fail(res, 405, 'Bu sayfa istek yöntemini desteklemiyor.');
  if (pathname === '/index.html') return redirect('/');
  if (pathname === '/teklif-araclari.html') return redirect('/hesaplama-araclari/');
  if (/^\/hesaplama\/[a-z0-9-]+\.html$/.test(pathname)) return redirect(pathname.slice(0, -5) + '/');
  if (/^\/(?:araclar(?:\/[a-z0-9-]+)?|hizmetler)\/index\.html$/.test(pathname)) return redirect(pathname.slice(0, -10));
  if (/^\/hesaplama-araclari\/?$/.test(pathname)) pathname = '/teklif-araclari.html';
  else if (/^\/hesaplama\/[a-z0-9-]+\/?$/.test(pathname)) pathname = pathname.replace(/\/$/, '') + '.html';
  let file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) && file !== root) return fail(res, 404, 'Sayfa bulunamadı.');
  try {
    if (fs.statSync(file).isDirectory()) {
      if (!fs.existsSync(path.join(file, 'index.html'))) return fail(res, 404, 'Sayfa bulunamadı.');
      if (!pathname.endsWith('/')) return redirect(pathname + '/');
      file = path.join(file, 'index.html');
    }
    const actual = fs.realpathSync(file);
    if (!actual.startsWith(fs.realpathSync(root) + path.sep)) return fail(res, 404, 'Sayfa bulunamadı.');
    const actualPath = '/' + path.relative(fs.realpathSync(root), actual).split(path.sep).join('/');
    if (blockedPath(actualPath) || !types[path.extname(actual).toLowerCase()]) return fail(res, 404, 'Sayfa bulunamadı.');
    const stat = fs.statSync(actual);
    if (!stat.isFile()) return fail(res, 404, 'Sayfa bulunamadı.');
    const headers = { 'Content-Type': types[path.extname(actual).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' };
    // Native video seeking asks for individual byte ranges. Stream only that
    // range instead of repeatedly sending the complete corporate video.
    if (req.method === 'GET' && req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      let start, end;
      if (range && (range[1] || range[2])) {
        if (!range[1]) {
          const suffix = Number(range[2]);
          if (Number.isSafeInteger(suffix) && suffix > 0) { start = Math.max(0, stat.size - suffix); end = stat.size - 1; }
        } else {
          start = Number(range[1]); end = range[2] ? Number(range[2]) : stat.size - 1;
          if (Number.isSafeInteger(end)) end = Math.min(end, stat.size - 1);
        }
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) {
        res.writeHead(416, { ...headers, 'Content-Length': 0, 'Content-Range': `bytes */${stat.size}` }); return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
      return fs.createReadStream(actual, { start, end }).on('error', () => res.destroy()).pipe(res);
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(actual).on('error', () => res.destroy()).pipe(res);
  } catch (_) { fail(res, 404, 'Sayfa bulunamadı.'); }
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  phpReady = false;
  if (phpChild) phpChild.kill();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('message', message => { if (message === 'vg-preview-shutdown') shutdown(); });
process.on('exit', () => { if (phpChild) phpChild.kill(); });
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Önizleme bağlantı noktası kullanımda.' : 'Önizleme başlatılamadı.'); shutdown(); });
startPhp().then(() => server.listen(port, '127.0.0.1', () => {
  console.log(`VoltGuard önizleme: ${origin}/araclar/`);
  console.log(phpReady ? 'Üyelik, topluluk ve korunan çalışan API’leri etkin.' : 'Statik önizleme etkin; PHP olmadığı için üyelik ve korunan erişim kapalı.');
})).catch(() => server.listen(port, '127.0.0.1', () => console.log(`VoltGuard statik önizleme: ${origin}/araclar/ — PHP erişimi kapalı.`)));
