'use strict';

// Builds the complete supplied PARALAKS R1 game from curated, reproducible sources.
// The site uses a same-origin worker; the download remains a self-contained HTML.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const source = path.join(__dirname, 'voltgame');
const output = path.join(project, 'public', 'voltgame');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

const palette = `:root{--bg0:#0a1628;--bg1:#111f34;--bg2:#17283e;--panel:#101d30;--line:#293c55;--line2:#3b526f;--ink:#f1f5f9;--muted:#a9b8cc;--dim:#899db7;--cyan:#38bdd8;--cyan2:#21a7c2;--gold:#f59e0b}
.screen{background:radial-gradient(130% 90% at 50% 0,#182b45 0,#0a1628 65%)}
.big:not(.alt),.sm.pri{border-color:var(--gold);background:var(--gold);color:#0a1628;font-weight:700}
.big.alt{border-color:var(--line2);background:#17283e}
.logo h1{background:none;color:var(--ink);letter-spacing:.025em}
.logo .brand{display:inline-flex;align-items:center;gap:9px;color:#a9b8cc;letter-spacing:.15em}
.logo .brand img{width:38px;height:38px;object-fit:contain;border-radius:8px;background:#fff}
button:focus-visible,[tabindex]:focus-visible{outline-color:var(--gold)}
@media(max-width:359px){#hud-controls{display:grid;grid-template-columns:repeat(4,minmax(44px,1fr));gap:6px}#hud-controls .btn{width:100%;max-width:none}}
`;
const hostFonts = `body{font-family:Inter,"Inter Fallback",system-ui,sans-serif}
.logo h1,.logo h2,.big,.lv-head h1,.sh-head h2{font-family:Outfit,"Outfit Fallback",system-ui,sans-serif}
.dl,.s-txt,.s-sub,.s-flag,.cur,.chart svg text{font-family:Inter,system-ui,sans-serif}
`;
const parentBridge = `;(function(){
  if(window.parent===window)return;
  function send(message){window.parent.postMessage(message,location.origin)}
  function hash(){if(/^#PX2-/.test(location.hash))send({type:'voltgame:hash',hash:location.hash})}
  function ready(){send({type:'voltgame:ready'});hash()}
  window.addEventListener('hashchange',hash);
  if(window.PX&&PX.bus)PX.bus.on('ready',ready);
  if(window.Game&&Game.ready)ready();
})();`;

function makeWorker(html) {
  const section = html.match(/\/\/#WORKER-BEGIN\s*window\.PX\.WORKER_SRC = ([\s\S]*?);\s*\/\/#WORKER-END/);
  if (!section) throw new Error('Complete embedded worker was not found.');
  const worker = JSON.parse(section[1]);
  const simRegion = html.match(/\/\/#SIM2-BEGIN\n([\s\S]*?)\/\/#SIM2-END/);
  if (!simRegion) throw new Error('Complete simulation source was not found.');
  const lines = simRegion[1].split('\n');
  const end = lines.lastIndexOf('})(window.PX);');
  if (end < 1 || !lines[0].includes('(function (PX)')) throw new Error('Simulation wrapper changed.');
  const sim = lines.slice(1, end).join('\n')
    .replace(/^PX\.SIM = /m, 'module.exports = ')
    .replace(/<\\\/(script)/gi, '</$1').replace(/<\\!--/g, '<!--');
  if (!/module\.exports\s*=/.test(sim)) throw new Error('Simulation export was not reconstructed.');
  const at = worker.indexOf('\n// ---- ');
  if (at < 0 || worker.includes('__defs["sim2.js"]')) throw new Error('Unexpected solver module layout.');
  const complete = worker.slice(0, at) + '\n__defs["sim2.js"] = function (module, exports, require) {\n' + sim + '\n};' + worker.slice(at);
  new vm.Script(complete, { filename: 'solver-worker.js' });
  return '/* VoltGame R1: generated complete same-origin solver. */\n' + complete.trimEnd() + '\n';
}

function addTheme(html, hosted) {
  const logo = hosted ? '/public/voltguard-logo.webp'
    : 'data:image/webp;base64,' + fs.readFileSync(path.join(project, 'public/voltguard-logo.webp')).toString('base64');
  const fonts = hosted ? '<link rel="stylesheet" href="/css/fonts.css?v=20261011">\n' : '';
  const head = fonts + '<style id="voltgame-brand-theme">\n' + palette + (hosted ? hostFonts : '') + '</style>\n';
  if (!html.includes('</head>') || !html.includes('<span class="brand">VOLTGUARD</span>')) throw new Error('Game shell structure changed.');
  return html.replace('<meta name="theme-color" content="#0a1020">', '<meta name="theme-color" content="#0a1628">')
    .replace('</head>', head + '</head>')
    .replace('<span class="brand">VOLTGUARD</span>', '<span class="brand"><img src="' + logo + '" width="38" height="38" alt="">VOLTGUARD</span>');
}

function writeChanged(file, text) {
  const bytes = Buffer.from(text);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) return;
  const temporary = file + '.tmp-' + process.pid;
  try { fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function build() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('VoltGame needs Node 24 or newer.');
  const dependencies = path.join(source, 'tools', 'node_modules', 'terser');
  if (!fs.existsSync(dependencies)) throw new Error('Install VoltGame build dependencies with npm ci --prefix tools/voltgame/tools --ignore-scripts first.');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-game-build-'));
  try {
    const intermediate = path.join(staging, 'game.html');
    const result = spawnSync(process.execPath, [path.join(source, 'tools/build.js'), '--out', intermediate], {
      cwd: source, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
    });
    if (result.status !== 0) throw new Error('VoltGame release verification failed.\n' + (result.stdout || '') + (result.stderr || ''));
    process.stdout.write(result.stdout || '');
    if (result.stderr) process.stderr.write(result.stderr);
    const complete = fs.readFileSync(intermediate, 'utf8');
    const metadata = complete.match(/window\.PX\.BUILD = (\{[^\n]+\});/);
    if (!metadata) throw new Error('Game build metadata was not found.');
    const info = JSON.parse(metadata[1]);
    if (info.rules !== 4 || info.levels.length !== 27 || info.daily !== 37 || info.dev) throw new Error('Unexpected incomplete game release.');
    const worker = makeWorker(complete), workerHash = sha256(worker);
    const config = { workerUrl: '/public/voltgame/solver-worker.js?v=' + workerHash.slice(0, 12), sharePath: '/voltgame.html' };
    let hosted = addTheme(complete, true);
    hosted = hosted.replace('<script>\n//#PX2-BUILD', '<script>\nwindow.PX=window.PX||{};window.PX.HOST=' + JSON.stringify(config) + ';\n//#PX2-BUILD')
      .replace('</body>\n</html>', '<script>\n' + parentBridge + '\n</script>\n</body>\n</html>');
    if (!hosted.includes('window.PX.HOST=') || !hosted.includes("type:'voltgame:ready'")) throw new Error('Hosted game bridge was not installed.');
    const offline = addTheme(complete, false);
    // Publish only after the release, worker and integration structure are valid.
    writeChanged(path.join(output, 'solver-worker.js'), worker);
    writeChanged(path.join(output, 'oyun.html'), hosted);
    writeChanged(path.join(output, 'downloads', 'voltgame-cevrimdisi.html'), offline);
    writeChanged(path.join(output, 'THIRD-PARTY-NOTICES.txt'), fs.readFileSync(path.join(source, 'tools/vendor/three.LICENSE'), 'utf8'));
    const manifest = { name: 'VoltGame — PARALAKS: Tek Hat', release: info.release, rules: info.rules, version: info.version,
      levels: info.levels, daily: info.daily, modules: info.modules, workerSHA256: workerHash,
      files: { runtime: { path: '/public/voltgame/oyun.html', bytes: Buffer.byteLength(hosted) },
        worker: { path: '/public/voltgame/solver-worker.js', bytes: Buffer.byteLength(worker) },
        offline: { path: '/public/voltgame/downloads/voltgame-cevrimdisi.html', bytes: Buffer.byteLength(offline) } } };
    writeChanged(path.join(output, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log('VoltGame: 27 campaign levels + 37 daily puzzles, complete hosted and single-file offline releases built.');
    return manifest;
  } finally {
    const target = path.resolve(staging);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('voltguard-game-build-')) throw new Error('Unsafe game build cleanup target.');
    fs.rmSync(target, { recursive: true, force: true });
  }
}

if (require.main === module) build();
module.exports = { build, makeWorker, addTheme };
