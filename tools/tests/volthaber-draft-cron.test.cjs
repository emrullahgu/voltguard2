'use strict';
// Real CLI and local feed fixtures only; no production data, provider requests or mail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const localPhp = path.join(root, '.qa/php/runtime/php.exe');
const php = process.env.VG_PHP || (fs.existsSync(localPhp) ? localPhp : 'php');
const entry = path.join(root, 'api/lib/volthaber-cron.php');
const prefix = 'voltguard-draft-cron-';
const now = Math.floor(Date.now() / 1000);
const bodyMarker = 'FEED_BODY_AND_IMAGE_MUST_NOT_BE_STORED';
const load = `define('VG_API',1); foreach(['bootstrap','store','security','validate','volthaber','volthaber-registry','volthaber-fetch'] as $f) require getenv('VG_TEST_ROOT').'/api/lib/'.$f.'.php'; $_SERVER['DOCUMENT_ROOT']=getenv('VG_TEST_ROOT');`;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const id = n => 'a' + n.toString(16).padStart(16, '0');
function invoke(f, args, code = false) {
  const result = spawnSync(php, ['-n', ...(code ? ['-r', args] : [entry, ...args])], {env:f.env, encoding:'utf8', windowsHide:true, timeout:30000, maxBuffer:2 * 1024 * 1024});
  assert.ifError(result.error); return result;
}
function write(f, name, value) { fs.writeFileSync(path.join(f.store, name), JSON.stringify(value)); }
function read(f, name) { return JSON.parse(fs.readFileSync(path.join(f.store, name), 'utf8')); }
function article(n, extra = {}) {
  return {id:id(n), slug:'synthetic-article-' + n, title:'Synthetic retained article ' + n, status:'draft', origin:'editor',
    createdAt:now - 86400, updatedAt:now - 86400, source:null, futureField:{keep:'unchanged'}, ...extra};
}
function feed(f, count = 1) {
  const items = Array.from({length:count}, (_, i) => `<item><title>Synthetic electricity announcement number ${i + 1}</title><link>https://www.epias.com.tr/synthetic-new-${i + 1}/</link><pubDate>${new Date().toUTCString()}</pubDate><description>${bodyMarker}</description><image>https://www.epias.com.tr/${bodyMarker}.png</image></item>`).join('');
  fs.writeFileSync(path.join(f.feeds, 'epias.xml'), `<rss version="2.0"><channel>${items}</channel></rss>`);
}
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix)), data = path.join(home, 'data'), feeds = path.join(home, 'feeds');
  fs.mkdirSync(data); fs.mkdirSync(feeds);
  const f = {home, data, feeds, store:path.join(data, 'volthaber'), env:{...process.env, VG_TEST_ROOT:root, VG_DATA_DIR:data,
    VG_STORE:'json', VG_MAIL_OUTBOX:'1', VG_VOLTHABER_TEST_FEEDS:feeds}};
  const seeded = invoke(f, load + 'echo vg_json_encode(["state"=>vh_seed_state(),"sources"=>vh_registry(),"eligible"=>array_values(array_map(function($s){return $s["id"];},array_filter(vh_registry(),function($s){return !empty($s["enabled"]) && !in_array($s["permission"],["izin-gerekli","reddedildi"],true) && vh_terms_fresh($s);})))]);', true);
  assert.equal(seeded.status, 0, seeded.stderr);
  const initial = JSON.parse(seeded.stdout); f.state = initial.state; f.registry = initial.sources; f.eligible = initial.eligible;
  fs.mkdirSync(f.store, {recursive:true});
  const sources = initial.sources.map(s => ({...s, enabled:s.id === 'epias', termsCheckedAt:new Date().toISOString().slice(0, 10)}));
  write(f, 'articles.json', f.state); write(f, 'sources.json', {version:1, sources, runtime:{}});
  // Invalid synthetic subscriber content would fail if this cron unexpectedly opened it.
  fs.writeFileSync(path.join(f.store, 'subscribers.json'), 'SYNTHETIC_SUBSCRIBERS_MUST_NOT_BE_READ');
  feed(f); return f;
}
function clean(f) {
  assert.equal(path.dirname(f.home), path.resolve(os.tmpdir())); assert(path.basename(f.home).startsWith(prefix));
  fs.rmSync(f.home, {recursive:true, force:true});
}
function run(f, args = ['--draft-only']) {
  const result = invoke(f, args); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
  assert(!fs.existsSync(path.join(f.data, 'outbox')), 'Source fetching must not send mail.'); return result;
}
function resetRuntime(f) { const state = read(f, 'sources.json'); state.runtime = {}; write(f, 'sources.json', state); }
function snapshot(directory) {
  const state = {};
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name), info = fs.lstatSync(file);
    state[name] = info.isDirectory() ? snapshot(file) : {digest:digest(fs.readFileSync(file)), mtime:info.mtimeMs, mode:info.mode};
  }
  return state;
}

test('first draft-only run uses registry defaults and preserves seed states when no articles or sources are stored', () => {
  const f = fixture();
  try {
    fs.unlinkSync(path.join(f.store, 'articles.json')); fs.unlinkSync(path.join(f.store, 'sources.json'));
    const result = run(f); assert(!result.stdout.includes('scheduled published:'));
    const sources = read(f, 'sources.json'); assert.deepEqual(sources.sources, f.registry);
    assert.equal(sources.scheduler.lastCronMode, 'draft-only');
    // Registry terms may legitimately expire in future years; then no feed may bypass that safeguard.
    if (f.eligible.includes('epias')) {
      const state = read(f, 'articles.json');
      for (const [key, value] of Object.entries(f.state.articles)) assert.deepEqual(state.articles[key], value);
      const added = Object.values(state.articles).filter(a => !f.state.articles[a.id]);
      assert.equal(added.length, 1); assert.equal(added[0].status, 'draft');
    } else {
      assert(!fs.existsSync(path.join(f.store, 'articles.json')));
      assert(result.stdout.includes('terms_check_required'));
    }
    assert.equal(fs.readFileSync(path.join(f.store, 'subscribers.json'), 'utf8'), 'SYNTHETIC_SUBSCRIBERS_MUST_NOT_BE_READ');
  } finally { clean(f); }
});

test('draft-only appends a draft and preserves scheduled, old, edited and unknown existing fields', () => {
  const f = fixture();
  try {
    for (const a of [article(1, {status:'scheduled', publishAt:now - 3600}),
      article(2, {origin:'ingest', createdAt:now - 61 * 86400, updatedAt:now - 61 * 86400}),
      article(3, {origin:'ingest', createdAt:now - 62 * 86400, updatedAt:now - 60 * 86400}),
      article(4, {status:'published', publishedAt:now - 86400}), article(5, {status:'archived'})]) f.state.articles[a.id] = a;
    write(f, 'articles.json', f.state);
    const before = read(f, 'articles.json'); const result = run(f);
    assert(result.stdout.includes('mode=draft-only')); assert(!result.stdout.includes('scheduled published:'));
    const after = read(f, 'articles.json');
    for (const [key, value] of Object.entries(before.articles)) assert.deepEqual(after.articles[key], value);
    const added = Object.values(after.articles).filter(a => !before.articles[a.id]);
    assert.equal(added.length, 1); assert.equal(added[0].status, 'draft'); assert.equal(added[0].body, '');
    assert.equal(added[0].summary, ''); assert.equal(added[0].image, null); assert.equal(added[0].publishAt, null);
    assert(!JSON.stringify(after).includes(bodyMarker));
    assert.equal(read(f, 'sources.json').scheduler.lastCronMode, 'draft-only');
    const status = run(f, ['--status']); assert.equal(JSON.parse(status.stdout).scheduler.lastCronMode, 'draft-only');
    const once = fs.readFileSync(path.join(f.store, 'articles.json')); resetRuntime(f); run(f);
    assert.deepEqual(fs.readFileSync(path.join(f.store, 'articles.json')), once, 'A duplicate fetch must not rewrite article records.');
  } finally { clean(f); }
});

test('draft-only retains a full old inbox and retries unseen items after capacity becomes available', () => {
  const f = fixture();
  try {
    for (let n = 1; n <= 500; n++) f.state.articles[id(n)] = article(n, {origin:'ingest', createdAt:now - 61 * 86400, updatedAt:now - 61 * 86400});
    write(f, 'articles.json', f.state); const before = fs.readFileSync(path.join(f.store, 'articles.json'));
    assert(run(f).stdout.includes('capacity skipped: 1 reason=inbox_full'));
    assert.deepEqual(fs.readFileSync(path.join(f.store, 'articles.json')), before);
    assert.deepEqual(read(f, 'sources.json').runtime.epias.seen, []);
    const state = read(f, 'articles.json'); state.articles[id(1)].status = 'archived'; write(f, 'articles.json', state);
    resetRuntime(f); assert(run(f).stdout.includes('added=1'));
    const after = read(f, 'articles.json');
    for (let n = 1; n <= 500; n++) assert(after.articles[id(n)], 'No old draft is deleted.');
    assert.equal(Object.keys(after.articles).length, Object.keys(state.articles).length + 1);
  } finally { clean(f); }
});

test('draft-only respects total article capacity without pruning or rewriting', () => {
  const f = fixture();
  try {
    const count = Object.keys(f.state.articles).length;
    for (let n = 1; n <= 3000 - count; n++) f.state.articles[id(n)] = article(n);
    write(f, 'articles.json', f.state); const before = fs.readFileSync(path.join(f.store, 'articles.json'));
    assert(run(f).stdout.includes('reason=article_limit'));
    assert.deepEqual(fs.readFileSync(path.join(f.store, 'articles.json')), before);
    assert.deepEqual(read(f, 'sources.json').runtime.epias.seen, []);
  } finally { clean(f); }
});

test('draft-only respects the serialized byte limit and preserves the existing large store', () => {
  const f = fixture();
  try {
    f.state.articles[id(1)] = article(1, {body:''});
    const remaining = 16777216 - 64 - Buffer.byteLength(JSON.stringify(f.state));
    f.state.articles[id(1)].body = 'x'.repeat(remaining);
    write(f, 'articles.json', f.state); const before = digest(fs.readFileSync(path.join(f.store, 'articles.json')));
    assert(run(f).stdout.includes('reason=storage_full'));
    assert.equal(digest(fs.readFileSync(path.join(f.store, 'articles.json'))), before);
    assert.deepEqual(read(f, 'sources.json').runtime.epias.seen, []);
  } finally { clean(f); }
});

test('full mode retains existing scheduled-publication and old-draft pruning behavior', () => {
  const f = fixture();
  try {
    f.state.articles[id(1)] = article(1, {status:'scheduled', publishAt:now - 3600});
    f.state.articles[id(2)] = article(2, {origin:'ingest', createdAt:now - 61 * 86400, updatedAt:now - 61 * 86400});
    write(f, 'articles.json', f.state); assert(run(f, []).stdout.includes('scheduled published: 1'));
    const state = read(f, 'articles.json'); assert.equal(state.articles[id(1)].status, 'published');
    assert.equal(state.articles[id(1)].publishedAt, now - 3600); assert(!state.articles[id(2)]);
    assert.equal(read(f, 'sources.json').scheduler.lastCronMode, 'full');
  } finally { clean(f); }
});

test('CLI rejects unknown, duplicate, ambiguous and malformed options before any bootstrap writes', () => {
  const f = fixture();
  try {
    const before = snapshot(f.data);
    for (const args of [['--drafts-only'], ['--draft-only', '--draft-only'], ['--source'], ['--source', '../epias'],
      ['--draft-only', '--status'], ['--status', '--source', 'epias'], ['--parse', 'a.xml', '--draft-only'], ['--allow', 'epias.com.tr']]) {
      const result = invoke(f, args); assert.equal(result.status, 2, args.join(' ')); assert.equal(result.stdout, '');
      assert.deepEqual(snapshot(f.data), before, 'Invalid arguments must not initialize locks or runtime data.');
    }
    const help = invoke(f, ['--help']); assert.equal(help.status, 0); assert(help.stdout.includes('--draft-only'));
    assert.deepEqual(snapshot(f.data), before);
  } finally { clean(f); }
});

test('draft-only still enforces enabled sources, permissions, terms freshness and source rate limits', () => {
  const f = fixture();
  try {
    const before = fs.readFileSync(path.join(f.store, 'articles.json'));
    for (const patch of [{enabled:false}, {permission:'izin-gerekli'}, {termsCheckedAt:'2024-01-01'}]) {
      const sources = read(f, 'sources.json'); const source = sources.sources.find(s => s.id === 'epias');
      Object.assign(source, {enabled:true, permission:'kamu', termsCheckedAt:new Date().toISOString().slice(0, 10)}, patch);
      sources.runtime = {}; write(f, 'sources.json', sources); run(f, ['--draft-only', '--source', 'epias']);
      assert.deepEqual(fs.readFileSync(path.join(f.store, 'articles.json')), before);
      assert.equal(read(f, 'sources.json').runtime.epias, undefined);
    }
    const sources = read(f, 'sources.json'); Object.assign(sources.sources.find(s => s.id === 'epias'), {enabled:true, permission:'kamu', termsCheckedAt:new Date().toISOString().slice(0, 10)});
    sources.runtime = {epias:{lastFetchAt:now, seen:[]}}; write(f, 'sources.json', sources);
    assert(run(f).stdout.includes('rate_limited'));
    assert.deepEqual(fs.readFileSync(path.join(f.store, 'articles.json')), before);
  } finally { clean(f); }
});

test('CLI skips an overlapping cron without changing records and retains the lock inode', async () => {
  const f = fixture();
  try {
    const holder = spawn(php, ['-n', '-r', load + '$p=vh_dir()."/cron.lock"; $f=fopen($p,"c+"); flock($f,LOCK_EX); echo "ready\\n"; fflush(STDOUT); usleep(1200000);'], {env:f.env, windowsHide:true, stdio:['ignore','pipe','pipe']});
    const done = new Promise((resolve, reject) => { holder.on('error', reject); holder.on('close', resolve); });
    await new Promise((resolve, reject) => { holder.stdout.once('data', resolve); holder.once('error', reject); });
    const inode = fs.statSync(path.join(f.store, 'cron.lock')).ino; const before = fs.readFileSync(path.join(f.store, 'articles.json'));
    assert(run(f).stdout.includes('Another VoltHaber cron is running; skipped.'));
    assert.deepEqual(fs.readFileSync(path.join(f.store, 'articles.json')), before);
    assert.equal(await done, 0); run(f);
    assert.equal(fs.statSync(path.join(f.store, 'cron.lock')).ino, inode);
  } finally { clean(f); }
});

test('CLI refuses a hard-linked cron lock without altering its target or article records', () => {
  const f = fixture();
  try {
    const target = path.join(f.home, 'must-remain'); fs.writeFileSync(target, 'SYNTHETIC_LOCK_TARGET', {mode:0o600});
    fs.linkSync(target, path.join(f.store, 'cron.lock'));
    const mode = fs.statSync(target).mode; const before = fs.readFileSync(path.join(f.store, 'articles.json'));
    const result = invoke(f, ['--draft-only']); assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(target, 'utf8'), 'SYNTHETIC_LOCK_TARGET'); assert.equal(fs.statSync(target).mode, mode);
    assert.deepEqual(fs.readFileSync(path.join(f.store, 'articles.json')), before);
  } finally { clean(f); }
});
