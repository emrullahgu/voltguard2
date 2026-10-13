'use strict';

// Published-game contracts: these compare the released artifact with its rules
// and exercise the emitted Worker independently of the DOM or browser bundle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const source = path.join(root, 'tools/voltgame/tools');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const runtime = () => read('public/voltgame/oyun.html');
const offline = () => read('public/voltgame/downloads/voltgame-cevrimdisi.html');
function buildInfo(html) {
  const match = html.match(/window\.PX\.BUILD\s*=\s*(\{[^\n]+\});/);
  assert.ok(match, 'Release metadata is present');
  return JSON.parse(match[1]);
}
function campaign() {
  const map = new Map();
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'src2/manifest.json'), 'utf8'));
  const reference = path.join(source, 'reference2');
  for (const pattern of manifest.levels.files) {
    const files = pattern.includes('*')
      ? fs.readdirSync(path.join(reference, path.dirname(pattern))).filter(file => file.endsWith('.js'))
        .sort().map(file => path.join(reference, path.dirname(pattern), file))
      : [path.join(reference, pattern)];
    for (const file of files) for (const level of require(file)) {
      map.delete(level.id); map.set(level.id, level);
    }
  }
  return [...map.values()].filter(level => manifest.levels.chapters.includes(level.bolum))
    .sort((a, b) => a.bolum - b.bolum);
}
function markupReferences(html) {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  return [...markup.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)].map(match => match[2]);
}

test('VoltGame publishes all campaign levels, daily puzzles and original systems', () => {
  const released = buildInfo(runtime());
  const portable = buildInfo(offline());
  const expected = campaign().map(level => level.id);
  assert.equal(expected.length, 27);
  assert.deepEqual(released.levels, expected);
  assert.deepEqual(portable.levels, expected);
  const daily = require(path.join(source, 'reference2/daily2.js'));
  assert.equal(daily.length, 37);
  assert.equal(released.daily, daily.length);
  assert.equal(portable.daily, daily.length);
  assert.equal(released.rules, require(path.join(source, 'reference2/sim2.js')).RULES_VERSION);
  assert.equal(released.dev, false);
  assert.deepEqual(released.replaced, []);
  for (const module of ['app/store.js', 'render/volti.js', 'input/gesture.js', 'input/keyboard.js',
    'game/controller.js', 'game/hint.js', 'ui/sld.js', 'ui/screens.js', 'audio/audio.js',
    'meta/world.js', 'meta/daily.js', 'meta/ghost.js']) {
    assert.ok(released.modules.includes(module), 'Full game module: ' + module);
  }
});

test('Integrated runtime and wrapper assets resolve locally without source-project URLs', () => {
  for (const [name, html] of [['voltgame.html', read('voltgame.html')], ['public/voltgame/oyun.html', runtime()]]) {
    for (const reference of markupReferences(html)) {
      if (!reference || /^(?:data:|blob:|mailto:|tel:|#)/i.test(reference)) continue;
      const url = new URL(reference, 'https://voltguard.com.tr/' + name);
      if (url.origin !== 'https://voltguard.com.tr') continue;
      assert.doesNotMatch(url.pathname, /^\/(?:VoltGame|tools\/voltgame)\//i);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/hesaplama-araclari/') pathname = '/teklif-araclari.html';
      if (/^\/hesaplama\/[a-z0-9-]+\/$/.test(pathname)) pathname = pathname.slice(0, -1) + '.html';
      const target = path.resolve(root, '.' + pathname);
      assert.ok(target === root || target.startsWith(root + path.sep));
      assert.ok(fs.existsSync(target), 'Local target exists: ' + reference);
    }
  }
  const wrapper = read('voltgame.html');
  assert.match(wrapper, /<iframe\b[^>]*id="voltgameFrame"/);
  assert.match(wrapper, /id="gameFullscreen"/);
  assert.match(wrapper, /\/public\/voltgame\/oyun\.html/);
  assert.match(wrapper, /\/public\/voltgame\/downloads\/voltgame-cevrimdisi\.html/);
  assert.match(wrapper, /<!--vg:header-->/);
  assert.match(wrapper, /<!--vg:footer-->/);
  assert.doesNotMatch(wrapper, /LEGACY_BEST_KEY|vg-best|id="gameCanvas"/);
  assert.match(runtime(), /solver-worker\.js/);
});

test('Published same-origin solver runs without DOM, Blob URLs or remote imports', async () => {
  const text = read('public/voltgame/solver-worker.js');
  assert.doesNotMatch(text, /importScripts\s*\(/);
  const messages = [];
  const pending = new Map();
  const sandbox = { console, performance, setTimeout, clearTimeout,
    postMessage(message) {
      messages.push(message);
      const resolve = pending.get(message.req);
      if (resolve) { pending.delete(message.req); resolve(message); }
    } };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(text, sandbox, { filename: 'solver-worker.js', timeout: 5000 });
  assert.equal(typeof sandbox.onmessage, 'function');
  sandbox.onmessage({ data: { t: 'ping', req: 100 } });
  assert.equal(messages[0].t, 'pong');
  const request = message => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(message.req); reject(new Error('Worker response timed out')); }, 30000);
    pending.set(message.req, result => { clearTimeout(timer); resolve(result); });
    sandbox.onmessage({ data: message });
  });
  const level = campaign().find(item => item.id === 'P1');
  const ready = await request({ t: 'load', req: 101, id: level.id, gen: 1, def: level.def });
  assert.equal(ready.t, 'ready', JSON.stringify(ready));
  assert.equal(ready.states, level.kanit.states);
  assert.ok(ready.goals > 0);
  const simulator = require(path.join(source, 'reference2/sim2.js'));
  const compiled = simulator.compile(level.def);
  const key = simulator.key(compiled, simulator.initState(compiled));
  const hint = await request({ t: 'hint', req: 102, id: level.id, key, metric: 'hamle', tier: 1 });
  assert.equal(hint.t, 'hint');
  assert.equal(hint.dead, false);
  assert.equal(hint.miss, false);
  assert.ok(hint.plan.length > 0);
  const replay = simulator.replay(compiled, Array.from(hint.plan).join(' '));
  assert.equal(replay.ok && replay.won, true, 'Real emitted Worker plan solves the level');
});

test('Offline download keeps the complete game and licensed renderer self-contained', () => {
  const html = offline();
  for (const ref of markupReferences(html)) assert.match(ref, /^(?:data:|#|$)/, 'Portable reference: ' + ref);
  assert.doesNotMatch(html, /<script\b[^>]*src\s*=/i);
  assert.match(html, /THREE/);
  assert.match(html, /Copyright[^\n]*three\.js|three\.js authors/i);
  assert.match(html, /paralaks2\.kayit/);
  assert.match(html, /game-canvas/);
  assert.match(html, /win-panel/);
  assert.match(html, /sld-svg/);
});

test('Game build and deployment preserve source exclusions and self-only Worker policy', () => {
  assert.match(read('package.json'), /build-voltgame\.cjs/);
  assert.match(read('.cpanel.yml'), /cp -R public\s/);
  assert.match(read('.gitignore'), /\/VoltGame\//);
  assert.match(read('.htaccess'), /VoltGame/i);
  assert.match(read('netlify.toml'), /from\s*=\s*"\/VoltGame\/\*"/i);
  assert.match(read('tools/preview.cjs'), /voltgame/i);
  const csp = read('.htaccess').match(/Header always set Content-Security-Policy\s+"([^"]+)"/)[1];
  assert.match(csp, /worker-src 'self';/);
  assert.doesNotMatch(csp, /worker-src[^;]*blob:/);
  const netlifyCsp = read('netlify.toml').match(/Content-Security-Policy\s*=\s*"([^"]+)"/)[1];
  assert.equal(netlifyCsp, csp, 'Both hosts enforce the same complete policy');
  const shell = read('tools/shell.py');
  assert.match(shell, /SKIP_DIRS[^\n]*[\s\S]*?['"]VoltGame['"]/);
});
