'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const localPhp = path.join(root, '.qa/php/runtime/php.exe');
const php = process.env.VG_PHP_BIN || (fs.existsSync(localPhp) ? localPhp : 'php');
const names = ['VG_OPENWEATHER_API_KEY', 'VG_IPINFO_TOKEN', 'VG_COINGECKO_DEMO_KEY', 'VG_GITHUB_TOKEN', 'VG_UNSPLASH_ACCESS_KEY', 'VG_TMDB_TOKEN', 'VG_TMDB_COMMERCIAL_LICENSE', 'VG_NEWSAPI_KEY', 'VG_NEWSAPI_PRODUCTION_ALLOWED'];
const keys = Object.fromEntries(names.map(name => [name, name.endsWith('LICENSE') || name.endsWith('ALLOWED') ? '' : 'TEST_ONLY_' + name]));
const harness = `$case=json_decode(stream_get_contents(STDIN),true);
define('VG_API',true);
foreach($case['secretNames'] as $name) putenv($name.'='.($case['secrets'][$name]??''));
putenv('VG_INTEGRATIONS_LOCAL='.($case['development']?'1':''));
$_SERVER['REMOTE_ADDR']=$case['development']?'127.0.0.1':'203.0.113.1';
$_SERVER['SERVER_NAME']=$case['development']?'localhost':'voltguard.com.tr';
require $argv[1];
if(!function_exists('vg_int_development')) { function vg_int_development():bool {return $GLOBALS['case']['development'];} }
require $argv[2]; $calls=[];
try { $data=vg_int_misc($case['action'],$case['input'],function($method,$url,$options) use (&$calls,$case) {
  $calls[]=['method'=>$method,'url'=>$url,'options'=>$options]; return $case['response'];
}); echo json_encode(['ok'=>true,'data'=>$data,'calls'=>$calls],JSON_THROW_ON_ERROR); }
catch(VgIntegrationError $e) { echo json_encode(['ok'=>false,'status'=>$e->status,'code'=>$e->errCode,'calls'=>$calls]); }`;
function provider(action, body, input = {}, options = {}) {
  const args = { action, input, secretNames: names, secrets: { ...keys, ...options.secrets }, development: options.development || false, response: { status: options.status || 200, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) } };
  return JSON.parse(execFileSync(php, ['-r', harness, path.join(root, 'api/lib/integration-http.php'), path.join(root, 'api/lib/integration-misc.php')], { input: JSON.stringify(args), encoding: 'utf8' }));
}
const now = Math.floor(Date.now() / 1000);
const weather = () => ({ cod: 200, dt: now, main: { temp: 18, humidity: 0 }, wind: { speed: 0 }, name: '<b>İzmir</b>', weather: [{ description: 'açık' }] });
const repository = () => ({ private: false, visibility: 'public', full_name: 'public-apis/public-apis', description: '<b>Public</b> APIs', language: 'Python', stargazers_count: 10, forks_count: 2, license: { spdx_id: 'MIT' }, temp_clone_token: 'MUST_NOT_LEAK', security_and_analysis: { private: 'MUST_NOT_LEAK' } });
const photo = () => ({ id: 'abc', alt_description: 'Solar modules', urls: { small: 'https://images.unsplash.com/photo-abc?ixid=KEEP_THIS&width=400' }, links: { html: 'https://unsplash.com/photos/abc', download_location: 'https://api.unsplash.com/photos/abc/download' }, user: { name: 'Test Photographer', links: { html: 'https://unsplash.com/@test' } } });

test('OpenWeather requests metric current conditions and preserves observed time and valid zero', () => {
  const result = provider('openweather', weather(), { lat: 38.42, lon: 27.14 });
  assert.equal(result.ok, true);
  const request = result.calls[0], url = new URL(request.url);
  assert.equal(request.method, 'GET'); assert.equal(url.pathname, '/data/2.5/weather'); assert.equal(url.searchParams.get('units'), 'metric');
  assert.equal(result.data.temperatureC, 18); assert.equal(result.data.humidityPercent, 0); assert.equal(result.data.windSpeedMps, 0);
  assert.equal(result.data.location, 'İzmir'); assert.equal(result.data.stale, false); assert.ok(result.data.observedAt.endsWith('Z'));
  assert.ok(!JSON.stringify(result.data).includes('TEST_ONLY'));
  const stale = weather(); stale.dt = now - 14400;
  assert.equal(provider('openweather', stale, { lat: 0, lon: 0 }).data.stale, true);
});

test('public weather validates coordinates and missing key without contacting provider', () => {
  for (const args of [{}, { lat: 91, lon: 1 }, { lat: 1, lon: 'NaN' }, { lat: false, lon: 1 }]) {
    const result = provider('openweather', weather(), args); assert.equal(result.status, 400); assert.equal(result.calls.length, 0);
  }
  const result = provider('openweather', weather(), { lat: 1, lon: 1 }, { secrets: { VG_OPENWEATHER_API_KEY: '' } });
  assert.equal(result.code, 'not_configured'); assert.equal(result.calls.length, 0);
});

test('IPinfo uses Lite explicit manual public IP and bearer auth; excludes city and coordinates', () => {
  const result = provider('ipinfo', { ip: '8.8.8.8', country_code: 'US', country: 'United States', asn: 'AS15169', as_name: 'Google', city: 'DO_NOT_RETURN', loc: 'DO_NOT_RETURN' }, { ip: '8.8.8.8' });
  assert.equal(result.ok, true); assert.equal(new URL(result.calls[0].url).pathname, '/lite/8.8.8.8');
  assert.ok(result.calls[0].options.headers.Authorization.startsWith('Bearer TEST_ONLY_'));
  assert.equal(result.data.city, undefined); assert.equal(result.data.loc, undefined); assert.equal(result.data.countryCode, 'US'); assert.ok(result.data.attribution.url);
});

test('IPinfo rejects implicit, private, reserved, multicast, mapped-private and malicious IP inputs', () => {
  for (const ip of [undefined, 'me', '127.0.0.1', '10.1.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', '2001:db8::1', '8.8.8.8/path']) {
    const result = provider('ipinfo', {}, { ip }); assert.equal(result.status, 400, String(ip)); assert.equal(result.calls.length, 0);
  }
});

test('Nominatim is manual bounded search with max five results, plaintext labels and OSM attribution', () => {
  const result = provider('nominatim', [{ display_name: '<b>İzmir</b>', lat: '38.42', lon: '27.14' }], { q: 'İzmir sanayi' });
  assert.equal(result.ok, true); const url = new URL(result.calls[0].url);
  assert.equal(url.searchParams.get('format'), 'jsonv2'); assert.equal(url.searchParams.get('limit'), '5');
  assert.deepEqual(result.data.items[0], { label: 'İzmir', lat: 38.42, lon: 27.14 }); assert.match(result.data.attribution.label, /OpenStreetMap/);
  assert.equal(provider('nominatim', [], { q: 'a'.repeat(181) }).status, 400);
  assert.equal(provider('nominatim', [{ display_name: 'bad', lat: '91', lon: '0' }], { q: 'x' }).status, 502);
  assert.deepEqual(provider('nominatim', [], { q: 'No results' }).data.items, []);
});

test('CoinGecko fixed currencies include provider timestamp and optional header key, never fake missing price', () => {
  const body = { bitcoin: { try: 100, usd: 3, last_updated_at: now }, ethereum: { try: 10, usd: 0, last_updated_at: now - 1200 } };
  const result = provider('coingecko', body);
  assert.equal(result.ok, true); assert.equal(result.data.items[1].prices.USD, 0); assert.equal(result.data.items[1].stale, true);
  const url = new URL(result.calls[0].url); assert.equal(url.searchParams.get('vs_currencies'), 'try,usd'); assert.equal(url.searchParams.get('include_last_updated_at'), 'true');
  assert.ok(result.calls[0].options.headers['x-cg-demo-api-key']);
  const keyless = provider('coingecko', body, {}, { secrets: { VG_COINGECKO_DEMO_KEY: '' } });
  assert.equal(keyless.calls[0].options.headers['x-cg-demo-api-key'], undefined);
  assert.equal(provider('coingecko', { bitcoin: body.bitcoin }).status, 502);
});

test('GitHub response whitelist rejects private/internal repositories and never returns temporary credentials', () => {
  const result = provider('github', repository(), { owner: 'public-apis', repo: 'public-apis' });
  assert.equal(result.ok, true); assert.equal(result.data.repository.license, 'MIT'); assert.ok(!JSON.stringify(result.data).includes('MUST_NOT_LEAK'));
  assert.equal(result.calls[0].options.headers['X-GitHub-Api-Version'], '2026-03-10');
  for (const body of [{ ...repository(), private: true }, { ...repository(), visibility: 'internal' }]) assert.equal(provider('github', body, { owner: 'public-apis', repo: 'public-apis' }).status, 403);
  assert.equal(provider('github', repository(), { owner: 'x/y', repo: 'public-apis' }).status, 400);
});

test('Unsplash returns API hotlinks and complete linked attribution, with no download/selection action', () => {
  const result = provider('unsplash', { results: [photo()] }, { q: 'solar panels' });
  assert.equal(result.ok, true); const item = result.data.items[0];
  assert.match(item.imageUrl, /ixid=KEEP_THIS/); assert.match(item.photographerUrl, /utm_source=voltguard/); assert.match(item.attribution, /Test Photographer on Unsplash/);
  assert.equal(item.download_location, undefined); assert.equal(item.downloadUrl, undefined); assert.equal(result.calls[0].method, 'GET');
  const wrongHost = photo(); wrongHost.urls.small = 'https://images.unsplash.com.evil.example/img';
  assert.equal(provider('unsplash', { results: [wrongHost] }, { q: 'x' }).status, 502);
  const missingAttribution = photo(); missingAttribution.user.name = '';
  assert.equal(provider('unsplash', { results: [missingAttribution] }, { q: 'x' }).status, 502);
});

test('TMDB commercial gate runs before request; local development allows only movie search with attribution', () => {
  const body = { results: [{ id: 1, title: 'Test', release_date: '2025-01-01', adult: false }, { id: 2, title: 'Excluded', adult: true }] };
  const denied = provider('tmdb', body, { q: 'test' }); assert.equal(denied.code, 'license_required'); assert.equal(denied.calls.length, 0);
  const local = provider('tmdb', body, { q: 'test' }, { development: true }); assert.equal(local.ok, true); assert.equal(local.data.items.length, 1); assert.match(local.data.attribution, /not endorsed/);
  const approved = provider('tmdb', body, { q: 'test' }, { secrets: { VG_TMDB_COMMERCIAL_LICENSE: '1' } }); assert.equal(approved.ok, true);
  assert.equal(new URL(local.calls[0].url).searchParams.get('include_adult'), 'false');
});

test('NewsAPI developer plan never runs in production without explicit configuration; full article is excluded', () => {
  const body = { status: 'ok', articles: [{ title: '<b>Test headline</b>', source: { name: 'Publisher' }, url: 'https://example.com/news', publishedAt: '2026-11-01T10:00:00Z', content: 'DO_NOT_RETURN', description: 'DO_NOT_RETURN' }] };
  const denied = provider('newsapi', body, { q: 'energy' }); assert.equal(denied.code, 'development_only'); assert.equal(denied.calls.length, 0);
  const local = provider('newsapi', body, { q: 'energy' }, { development: true }); assert.equal(local.ok, true); assert.equal(local.data.items[0].title, 'Test headline'); assert.ok(!JSON.stringify(local.data).includes('DO_NOT_RETURN'));
  const approved = provider('newsapi', body, { q: 'energy' }, { secrets: { VG_NEWSAPI_PRODUCTION_ALLOWED: '1' } }); assert.equal(approved.ok, true);
  assert.ok(local.calls[0].options.headers['X-Api-Key']);
});

test('read-only mock providers stay explicitly synthetic, bounded and separate from business records', () => {
  const posts = provider('jsonplaceholder', [{ id: 1, title: '<b>Mock</b>', body: 'Fake body' }], { limit: 5 });
  assert.equal(posts.data.synthetic, true); assert.equal(posts.data.items[0].title, 'Mock'); assert.equal(posts.calls[0].method, 'GET');
  const products = provider('dummyjson', { products: [{ id: 1, title: 'Demo product', price: 4.2, category: 'test' }] });
  assert.equal(products.data.synthetic, true); assert.equal(products.data.items[0].demoPrice, 4.2); assert.equal(products.data.items[0].price, undefined);
  for (const limit of [0, 4, 21, 5.5, [], 'NaN']) { const result = provider('dummyjson', {}, { limit }); assert.equal(result.status, 400); assert.equal(result.calls.length, 0); }
});

test('provider transport errors, malformed JSON and unsupported actions return controlled errors', () => {
  assert.equal(provider('jsonplaceholder', '{invalid').status, 502);
  assert.equal(provider('jsonplaceholder', [], {}, { status: 429 }).status, 429);
  assert.equal(provider('jsonplaceholder', [], {}, { status: 500 }).status, 502);
  const result = provider('arbitrary-url', {}); assert.equal(result.status, 400); assert.equal(result.calls.length, 0);
});
