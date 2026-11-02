'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('./test-dependencies.cjs').testDependency('typescript');
const source = path.resolve(__dirname, '../staff-app/src');
function load(name, dependencies = {}, globals = {}) {
  const filename = path.join(source, name), module = {exports: {}};
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {module, exports: module.exports, require: name => { if (!(name in dependencies)) throw Error('Unexpected dependency ' + name); return dependencies[name]; }, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, console, ...globals}, {filename});
  return module.exports;
}
const helper = load('connectedServicesTransport.js');
const plain = value => JSON.parse(JSON.stringify(value));
const me = (id = 'staff-a', csrf = 'a'.repeat(64), role = 'admin') => ({api: 'vg-staff/1', ok: true, user: {id, name: 'Synthetic employee', email: 'fixture@example.test', role}, csrf, mfa: null});
const reply = provider => ({provider, text: 'Synthetic reply', model: 'fixture-model', generatedAt: '2026-11-02T00:00:00Z', truncated: false, usage: {inputTokens: 1, outputTokens: 2, totalTokens: 3}});
const result = {provider: 'IPinfo Lite', source: {name: 'IPinfo', url: 'https://ipinfo.io/'}, retrievedAt: '2026-11-02T00:00:00Z', ip: '8.8.8.8'};
function status() { return {ai: Object.fromEntries(helper.AI_PROVIDERS.map(provider => [provider, {provider, model: 'fixture', configured: true, notice: 'Synthetic privacy notice', privacyUrl: 'https://example.test/privacy'}])), services: Object.fromEntries(helper.DATA_SERVICES.map(service => [service, {configured: true, available: true, notice: 'Synthetic service notice'}]))}; }
function response(payload, status = 200) { return {ok: status >= 200 && status < 300, status, json: async () => payload}; }
function deferred() { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; }
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function fixture(handler = () => response({api: 'vg-integrations/1', ok: true, data: result})) {
  const calls = []; let invalidations = 0;
  const session = helper.createConnectedServiceSession({expectedUserId: 'staff-a', onInvalid: () => invalidations++, fetchImpl: async (url, options) => { calls.push({url, options}); return handler(url, options, calls.length) || response(me()); }});
  return {session, calls, invalidations: () => invalidations};
}

test('Only the exact two connected routes select the independent workspace', () => {
  for (const route of ['ConnectedAi', 'ConnectedData']) assert.equal(helper.isConnectedServiceRoute(route), true);
  for (const route of ['WorkOrders', 'ConnectedAi/../WorkOrders', 'connectedai', ' ConnectedAi', '', null, undefined]) assert.equal(helper.isConnectedServiceRoute(route), false);
  const react = {createElement: (type, props) => ({type, props})};
  const connected = () => null;
  const entry = load('EmployeeModule.jsx', {react, './employeeRuntime': {loadEmployeeRuntime() {throw Error('Native runtime must not be loaded.');}}, './ConnectedServices': connected, './connectedServicesTransport': helper});
  assert.equal(entry.default({route: 'ConnectedAi'}).type, connected);
  assert.equal(entry.default({route: 'ConnectedData'}).type, connected);
  assert.notEqual(entry.default({route: 'WorkOrders'}).type, connected);
});

test('Status uses only native staff MFA and the integration endpoint, with post-read ownership verification', async () => {
  const f = fixture(url => url.includes('/staff.php') ? response(me()) : response({api: 'vg-integrations/1', ok: true, data: status()}));
  const data = await f.session.status(); assert.equal(data.ai.groq.configured, true);
  assert.deepEqual(f.calls.map(call => new URL(call.url, 'https://example.test').pathname), ['/api/staff.php', '/api/integrations.php', '/api/staff.php']);
  assert.ok(f.calls.every(call => call.options.credentials === 'same-origin' && call.options.cache === 'no-store'));
  f.session.dispose();
});

test('AI sends one explicitly chosen provider, no hidden history, and the current native CSRF token', async () => {
  const f = fixture(url => url.includes('/staff.php') ? response(me()) : response({api: 'vg-integrations/1', ok: true, data: reply('groq')}));
  assert.equal((await f.session.send('groq', 'Only a synthetic check.')).provider, 'groq');
  const call = f.calls[1]; assert.equal(call.options.method, 'POST'); assert.equal(call.options.headers['X-VG-STAFF-CSRF'], 'a'.repeat(64));
  assert.deepEqual(JSON.parse(call.options.body), {provider: 'groq', prompt: 'Only a synthetic check.', maxOutputTokens: 1024});
  assert.equal(f.calls.filter(call => call.url.includes('/integrations.php')).length, 1);
  f.session.dispose();
});

test('Pending MFA, missing identity, wrong owner, malformed role and malformed CSRF cannot reach providers', async () => {
  for (const payload of [Object.assign(me(), {user: null}), Object.assign(me(), {mfa: {required: true}}), me('staff-b'), me('staff-a', 'a'.repeat(64), 'unknown'), me('staff-a', '')]) {
    const f = fixture(() => response(payload));
    await assert.rejects(f.session.send('gemini', 'Synthetic check.'));
    assert.equal(f.calls.length, 1); assert.equal(f.invalidations(), 1); f.session.dispose();
  }
});

test('Fresh employee role cannot query administrator-only IPinfo even when outer UI was previously admin', async () => {
  const f = fixture(() => response(me('staff-a', 'a'.repeat(64), 'employee')));
  await assert.rejects(f.session.query('ipinfo', {ip: '8.8.8.8'}), error => error.code === 'admin_required');
  assert.equal(f.calls.length, 1); assert.equal(f.session.getUser().role, 'employee'); f.session.dispose();
});

test('A private GET result is discarded after either owner, role or CSRF changes across tabs', async () => {
  for (const next of [me('staff-b'), me('staff-a', 'b'.repeat(64)), me('staff-a', 'a'.repeat(64), 'employee')]) {
    let reads = 0;
    const f = fixture(url => url.includes('/staff.php') ? response(++reads === 1 ? me() : next) : response({api: 'vg-integrations/1', ok: true, data: result}));
    await assert.rejects(f.session.query('ipinfo', {ip: '8.8.8.8'}));
    assert.equal(f.invalidations(), 1); assert.equal(f.session.getUser(), null); f.session.dispose();
  }
});

test('Logout during JSON decoding aborts in-flight work and cannot expose or replay an old response', async () => {
  const gate = deferred();
  const f = fixture(url => url.includes('/staff.php') ? response(me()) : {ok: true, status: 200, json: () => gate.promise});
  const pending = f.session.query('ipinfo', {ip: '8.8.8.8'}).then(data => ({data}), error => ({error}));
  await flush(); assert.equal(f.calls.length, 2);
  f.session.invalidate(); assert.equal(f.calls[1].options.signal.aborted, true);
  gate.resolve({api: 'vg-integrations/1', ok: true, data: result});
  const outcome = await pending; assert.equal(outcome.data, undefined); assert.equal(outcome.error.code, 'staff_session_changed');
  assert.equal(f.calls.length, 2); f.session.dispose();
});

test('Unmount aborts an AI request and ignores its eventual completion without a retry', async () => {
  const gate = deferred();
  const f = fixture(url => url.includes('/staff.php') ? response(me()) : gate.promise);
  const pending = f.session.send('openrouter', 'Synthetic check.').then(data => ({data}), error => ({error}));
  await flush(); assert.equal(f.calls.length, 2); f.session.dispose();
  assert.equal(f.calls[1].options.signal.aborted, true);
  gate.resolve(response({api: 'vg-integrations/1', ok: true, data: reply('openrouter')}));
  assert.equal((await pending).error.code, 'staff_session_changed'); assert.equal(f.calls.length, 2);
});

test('Quota/access/provider errors remain a single explicit request without provider fallback', async () => {
  for (const [code, statusCode] of [['ai_quota_exceeded', 429], ['ai_provider_access', 503], ['ai_provider_unavailable', 502]]) {
    const f = fixture(url => url.includes('/staff.php') ? response(me()) : response({api: 'vg-integrations/1', ok: false, error: code, message: 'Synthetic provider rejection.'}, statusCode));
    await assert.rejects(f.session.send('gemini', 'Synthetic check.'), error => error.code === code && error.status === statusCode);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].options.method, 'POST'); assert.equal(JSON.parse(f.calls[1].options.body).provider, 'gemini');
    assert.equal(f.invalidations(), 0, 'Ordinary provider failures retain the current session and draft.');
    assert.equal(f.session.getUser().id, 'staff-a'); f.session.dispose();
  }
});

test('Known staff CSRF or identity rejection invalidates private state after preflight without replay', async () => {
  for (const code of ['staff_csrf', 'staff_unauthorized']) {
    const f = fixture(url => url.includes('/staff.php') ? response(me()) : response({api: 'vg-integrations/1', ok: false, error: code, message: 'Synthetic native session rejection.'}, 403));
    await assert.rejects(f.session.send('groq', 'Synthetic check.'), error => error.code === 'staff_session_changed');
    assert.equal(f.calls.length, 2, 'One ME preflight and one rejected POST; no third request or replay.');
    assert.equal(f.calls[1].options.method, 'POST'); assert.equal(f.invalidations(), 1);
    assert.equal(f.session.getUser(), null, 'Prior private identity is cleared immediately.'); f.session.dispose();
  }
});

test('Inputs whitelist provider/service fields before any network access', async () => {
  const f = fixture();
  await assert.rejects(f.session.send('unknown', 'Synthetic check.')); await assert.rejects(f.session.send('groq', 'x'.repeat(12001)));
  await assert.rejects(f.session.query('unknown', {})); await assert.rejects(f.session.query('epias', {date: '2026-02-30'}));
  assert.equal(f.calls.length, 0);
  assert.deepEqual(plain(helper.connectedDataParams('ipinfo', {ip: ' 8.8.8.8 ', secret: 'never send'})), {ip: '8.8.8.8'});
  assert.deepEqual(plain(helper.connectedDataParams('github', {owner: 'public-apis', repo: 'public-apis', token: 'never send'})), {owner: 'public-apis', repo: 'public-apis'});
  f.session.dispose();
});

test('Workspace owner changes remount private React state before rendering another employee', () => {
  let actor = {id: 'staff-a', role: 'admin'};
  const react = {createElement: (type, props) => ({type, props})};
  const screen = load('ConnectedServices.jsx', {react, './SimpleAuth': {useAuth: () => ({currentUser: actor})}, './employeeModules': {}, './connectedServicesTransport': helper});
  const first = screen.default({route: 'ConnectedAi'});
  actor = {id: 'staff-b', role: 'admin'};
  const second = screen.default({route: 'ConnectedAi'});
  assert.equal(first.type, second.type); assert.notEqual(first.props.key, second.props.key);
  assert.equal(first.props.key, 'ConnectedAi:staff-a:admin'); assert.equal(second.props.key, 'ConnectedAi:staff-b:admin');
  actor = {id: 'staff-b', role: 'employee'};
  assert.notEqual(screen.default({route: 'ConnectedAi'}).props.key, second.props.key, 'Known permission changes also clear prior private output before rendering.');
});
