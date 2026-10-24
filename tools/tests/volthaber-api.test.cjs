/* VoltHaber: real PHP/HTTP checks (roles, CSRF, validation, duplicates, publish rules, fetcher, newsletter, escaping, SSR).
   Everything runs against a temporary private data directory; feeds come from local fixtures (no network). */
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const root = path.resolve(__dirname, '../..');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
let checks = 0;
const check = (actual, expected, why) => { assert.deepEqual(actual, expected, why); checks++; };
const ok = (value, why) => { assert.ok(value, why); checks++; };

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

const rfc = d => d.toUTCString().replace('GMT', '+0000');
function fixtures(dir) {
  const now = new Date();
  const old = new Date(Date.now() - 60 * 86400e3);
  fs.writeFileSync(path.join(dir, 'epias.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>EPİAŞ</title>
<item><title>Kasım Dönemi Serbest Tüketici Listelerinin Yayımlanması Hakkında Duyuru</title><link>https://www.epias.com.tr/duyuru/serbest-tuketici-kasim/?utm_source=rss</link>
<pubDate>${rfc(now)}</pubDate><description>GOVDE-ISARETI-AÇIKLAMA metni saklanmamalı</description><content:encoded><![CDATA[<p>GOVDE-ISARETI-ICERIK</p><img src="https://www.epias.com.tr/x.png">]]></content:encoded></item>
<item><title>Piyasa &lt;script&gt;alert(1)&lt;/script&gt; Takas Duyurusu Ekim Dönemi</title><link>http://www.epias.com.tr/duyuru/takas</link><pubDate>${rfc(now)}</pubDate></item>
<item><title>Eski Arşiv Duyurusu Altmış Gün Önceki Kayıt</title><link>https://www.epias.com.tr/duyuru/eski</link><pubDate>${rfc(old)}</pubDate></item>
</channel></rss>`);
  const m = String(now.getMonth() + 1), d = String(now.getDate());
  fs.writeFileSync(path.join(dir, 'etkb-haber.xml'), `<rss version="2.0"><channel><item><title>Bakanlık Yenilenebilir Enerji Kapasite Açıklaması Yapıldı</title><description>GOVDE-ISARETI-ETKB</description><PublishStartDate>${m}/${d}/${now.getFullYear()} 12:00:00 AM</PublishStartDate><haberResmi>https://enerji.gov.tr/Media/x.png</haberResmi></item></channel></rss>`);
  fs.writeFileSync(path.join(dir, 'ec-energy.xml'), `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Energy</title>
<entry><title>Commission publishes electricity grid action progress report</title><link rel="alternate" href="https://energy.ec.europa.eu/news/grid-report_en"/><updated>${now.toISOString()}</updated><summary>GOVDE-ISARETI-ATOM</summary></entry>
</feed>`);
  fs.writeFileSync(path.join(dir, 'doctype.xml'), `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa">]><rss version="2.0"><channel><item><title>&a;&a;</title></item></channel></rss>`);
}

async function run() {
  const probe = spawnSync(php, ['-n', '-v'], { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) throw new Error('Set VG_PHP to a PHP 7.4+ executable to run these checks.');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-volthaber-api-'));
  const feeds = path.join(sandbox, 'feeds');
  fs.mkdirSync(feeds);
  fixtures(feeds);
  const env = { ...process.env, VG_DATA_DIR: path.join(sandbox, 'data'), VG_STORE: 'json', VG_MAIL_OUTBOX: '1', VG_RATE_SCALE: '3', VG_VOLTHABER_TEST_FEEDS: feeds };
  fs.mkdirSync(env.VG_DATA_DIR);
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root, path.join(root, 'tools/volthaber-dev-router.php')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const logs = [];
  child.stderr.on('data', c => logs.push(String(c)));
  child.stdout.resume();
  const cli = (...args) => spawnSync(php, ['-n', ...args], { env, encoding: 'utf8', windowsHide: true });
  const client = () => ({ cookies: new Map(), csrf: '' });
  const anon = client(), member = client(), editor = client();

  async function request(actor, action, options = {}) {
    const endpoint = options.endpoint || 'volthaber';
    const query = new URLSearchParams({ action, ...(options.query || {}) });
    const headers = { Cookie: [...actor.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...options.headers };
    let body;
    const method = options.method || (options.body !== undefined ? 'POST' : 'GET');
    if (options.body !== undefined) {
      headers['Content-Type'] ||= 'application/json';
      headers.Origin ||= base;
      if (options.csrf !== false) headers['X-VG-CSRF'] = options.csrf || actor.csrf;
      body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    const response = await fetch(`${base}/api/${endpoint}.php?${query}`, { method, headers, body });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0];
      const eq = first.indexOf('=');
      actor.cookies.set(first.slice(0, eq), first.slice(eq + 1));
    }
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch (_) { result = { raw: text }; }
    if (result.csrf) actor.csrf = result.csrf;
    return { status: response.status, body: result, headers: response.headers, text };
  }
  async function expect(actor, action, options, status, code) {
    const r = await request(actor, action, options);
    if (r.status !== status) console.error(action, r.status, JSON.stringify(r.body).slice(0, 400));
    check(r.status, status, `${action} HTTP status`);
    if (code) check(r.body.error, code, `${action} error code`);
    return r;
  }
  const page = async (p, opts = {}) => {
    const r = await fetch(base + p, { redirect: 'manual', headers: { 'User-Agent': opts.ua || 'Mozilla/5.0 test' } });
    return { status: r.status, text: await r.text(), headers: r.headers };
  };
  const outbox = () => { const d = path.join(env.VG_DATA_DIR, 'outbox'); return fs.existsSync(d) ? fs.readdirSync(d).sort().map(f => fs.readFileSync(path.join(d, f), 'utf8')) : []; };

  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      try { await fetch(`${base}/api/volthaber.php?action=categories`); ready = true; } catch (_) { await new Promise(r => setTimeout(r, 50)); }
    }
    ok(ready, 'PHP test server starts');

    // ---------------------------------------------------------------- public reads + seed content
    let r = await expect(anon, 'list', {}, 200);
    const seed = JSON.parse(fs.readFileSync(path.join(root, 'api/lib/volthaber-seed.json'), 'utf8')).articles;
    check(r.body.total, seed.length, 'Seeded launch content is published');
    ok(r.body.items.every(i => i.source && /^https:\/\//.test(i.source.url)), 'Every seeded item cites an https source');
    ok(!r.headers.getSetCookie().length, 'Public list starts no session');
    r = await expect(anon, 'list', { query: { type: 'resmi' } }, 200);
    check(r.body.items.every(i => i.type === 'resmi'), true, 'Type filter');
    ok(r.body.items.every(i => i.source.url.startsWith('https://www.resmigazete.gov.tr/eskiler/')), 'Official digests link to Resmî Gazete pages');
    await expect(anon, 'list', { query: { category: '../x' } }, 422, 'invalid_category');
    await expect(anon, 'list', { query: { page: '0' } }, 422, 'invalid_page');
    r = await expect(anon, 'list', { query: { q: 'reaktif' } }, 200);
    ok(r.body.items.some(i => i.slug.startsWith('reaktif-enerji')), 'Search finds analysis');
    const analysis = seed.find(a => a.type === 'analiz');
    r = await expect(anon, 'article', { query: { slug: analysis.slug } }, 200);
    ok(r.body.item.bodyHtml.includes('<h2>'), 'Limited Markdown rendered server side');
    await expect(anon, 'article', { query: { slug: 'yok-boyle-bir-yazi' } }, 404, 'not_found');
    await expect(anon, 'categories', {}, 200);
    await expect(anon, 'save', { method: 'GET' }, 405, 'method_not_allowed');
    await expect(anon, 'nope', {}, 404, 'unknown_action');

    // ---------------------------------------------------------------- roles
    await expect(anon, 'editor_list', {}, 401, 'unauthorized');
    await expect(member, 'me', { endpoint: 'auth' }, 200);
    const unique = `${Date.now()}-${process.pid}`;
    r = await expect(member, 'register', { endpoint: 'auth', body: { name: 'Normal Üye', email: `vh-member-${unique}@example.test`, password: 'Deneme12345', consent: true } }, 201);
    await expect(member, 'editor_list', {}, 403, 'forbidden');
    await expect(member, 'save', { body: { title: 'Üyenin yazmaya çalıştığı başlık', type: 'analiz', category: 'mevzuat' } }, 403, 'forbidden');
    r = await expect(member, 'editor_me', {}, 200);
    check(r.body.editor, false, 'Normal member is not editor');
    await expect(editor, 'me', { endpoint: 'auth' }, 200);
    r = await expect(editor, 'register', { endpoint: 'auth', body: { name: 'Editör Ayşe', email: `vh-editor-${unique}@example.test`, password: 'Deneme12345', consent: true } }, 201);
    const editorId = r.body.user.id;
    check(cli(path.join(root, 'tools/volthaber-admin.php'), 'grant', 'u' + '0'.repeat(24)).status, 2, 'Grant refuses unknown account');
    check(cli(path.join(root, 'tools/volthaber-admin.php'), 'grant', editorId).status, 0, 'Editor granted via CLI');
    ok(cli(path.join(root, 'tools/volthaber-admin.php'), 'list').stdout.includes(editorId), 'CLI lists editor');
    r = await expect(editor, 'editor_me', {}, 200);
    check(r.body.editor, true, 'Granted editor recognized');
    check((await page('/tools/volthaber-admin.php')).status, 404, 'Admin CLI never served over HTTP');

    // ---------------------------------------------------------------- CSRF / origin / body
    const draft = { title: 'Kompanzasyon panolarında harmonik rezonans riski üzerine notlar', type: 'analiz', category: 'kompanzasyon', summary: 'Kompanzasyon panolarında harmonik kaynaklı rezonansın nasıl oluştuğunu ve sahada nasıl fark edileceğini editör olarak özetliyoruz.', body: 'Giriş paragrafı.' };
    await expect(editor, 'save', { body: draft, csrf: false }, 403, 'csrf');
    await expect(editor, 'save', { body: draft, csrf: 'f'.repeat(64) }, 403, 'csrf');
    await expect(editor, 'save', { body: draft, headers: { Origin: 'https://evil.example' } }, 403, 'forbidden_origin');
    await expect(editor, 'save', { body: draft, headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403, 'forbidden_origin');
    await expect(editor, 'save', { body: draft, headers: { 'Content-Type': 'text/plain' } }, 415, 'unsupported_media_type');
    await expect(editor, 'save', { body: '[1,2]' }, 400, 'invalid_json');
    await expect(editor, 'save', { body: 'x'.repeat(270000) }, 413, 'too_large');

    // ---------------------------------------------------------------- validation
    await expect(editor, 'save', { body: { ...draft, title: 'Kısa' } }, 422, 'invalid_field');
    await expect(editor, 'save', { body: { ...draft, status: 'published' } }, 400, 'invalid_request');
    await expect(editor, 'save', { body: { ...draft, category: 'yok' } }, 422, 'invalid_field');
    await expect(editor, 'save', { body: { ...draft, source: { name: 'Örnek', url: 'http://example.com/haber' } } }, 422, 'invalid_field');
    await expect(editor, 'save', { body: { ...draft, source: { name: 'Örnek', url: 'javascript:alert(1)' } } }, 422, 'invalid_field');
    await expect(editor, 'save', { body: { ...draft, image: { url: '/public/og-image.png', credit: 'VoltGuard' } } }, 422, 'invalid_field');
    await expect(editor, 'save', { body: { ...draft, related: [{ url: 'https://evil.example/', label: 'Dış' }] } }, 422, 'invalid_field');
    await expect(editor, 'save', { body: { ...draft, slug: 'kategori' } }, 422, 'invalid_field');
    await expect(editor, 'save', { body: { ...draft, title: 'Başlık‮ters çevrilmiş metin denemesi' } }, 422, 'invalid_field');

    // ---------------------------------------------------------------- escaping + publish rules
    const hostile = { ...draft, title: 'Ölçüm <b>kalın</b> & "tırnak" içeren başlık örneği',
      body: '## Bölüm\n\n<script>alert(1)</script> metin **kalın** [kötü](javascript:alert(1)) [iyi](https://www.epdk.gov.tr/) [iç](/voltsim/ges/)\n\n- madde <img src=x onerror=alert(1)>',
      image: { url: '/public/og-image.png', credit: 'VoltGuard arşivi', rightsNote: 'VoltGuard tarafından üretildi, kendi görselimiz.' } };
    r = await expect(editor, 'save', { body: hostile }, 201);
    const hostileId = r.body.item.id;
    const html = r.body.item.bodyHtml;
    ok(!html.includes('<script') && html.includes('&lt;script&gt;'), 'Raw HTML is escaped');
    ok(!/href="javascript/i.test(html) && !html.includes('<img'), 'Dangerous links/images not rendered');
    ok(html.includes('<a href="https://www.epdk.gov.tr/" target="_blank" rel="noopener noreferrer">iyi</a>') && html.includes('<a href="/voltsim/ges/">iç</a>'), 'Safe links rendered');
    ok(html.includes('<strong>kalın</strong>') && html.includes('<h2>Bölüm</h2>'), 'Markdown subset works');
    r = await expect(editor, 'preview', { body: { body: '<iframe src=x>' } }, 200);
    ok(r.body.html.includes('&lt;iframe'), 'Preview escapes HTML');
    await expect(editor, 'publish', { body: { id: hostileId } }, 422, 'not_publishable'); // analysis body too short
    r = await expect(editor, 'editor_get', { query: { id: hostileId } }, 200);
    await expect(editor, 'save', { body: { id: hostileId, updatedAt: '2000-01-01T00:00:00Z', body: hostile.body } }, 409, 'conflict');
    const longBody = hostile.body + '\n\n' + 'Bu paragraf analiz için gereken özgün metni oluşturur ve sahadaki ölçüm yöntemlerini anlatır. '.repeat(5);
    r = await expect(editor, 'save', { body: { id: hostileId, updatedAt: r.body.item.updatedAt, body: longBody } }, 200);
    r = await expect(editor, 'publish', { body: { id: hostileId } }, 200);
    const hostileSlug = r.body.item.slug;
    check(r.body.item.status, 'published', 'Analysis published');
    let p = await page(`/volthaber/${hostileSlug}/`);
    check(p.status, 200, 'Article page renders');
    ok(p.text.includes('Ölçüm &lt;b&gt;kalın&lt;/b&gt; &amp; &quot;tırnak&quot;') && !p.text.includes('<b>kalın</b>'), 'Title escaped in SSR page');
    ok(p.text.includes('"@type":"Article"') && p.text.includes('"@type":"BreadcrumbList"'), 'Article + Breadcrumb JSON-LD');
    ok(!/<\/script>[^]*<b>/.test(p.text) && p.text.includes('\\u003Cb\\u003E'), 'JSON-LD escapes markup');
    ok(p.text.includes(`<link rel="canonical" href="https://voltguard.com.tr/volthaber/${hostileSlug}/">`), 'Canonical');
    ok(p.text.includes('property="og:title"') && p.text.includes('linkedin.com/sharing/share-offsite/?url=') && p.text.includes('wa.me/?text=') && p.text.includes('twitter.com/intent/tweet') && p.text.includes('facebook.com/sharer'), 'OG + plain share URLs');
    ok(!/<script[^>]+src="https?:/.test(p.text), 'No third-party scripts');
    ok(p.text.includes('VoltGuard arşivi'), 'Image credit shown');

    // ---------------------------------------------------------------- duplicates
    const srcA = { name: 'Örnek Kurum', url: 'https://www.ornek.gov.tr/duyuru/123', publishedAt: '2026-10-20' };
    r = await expect(editor, 'save', { body: { title: 'Örnek kurumdan şebeke bağlantı başvurularına ilişkin duyuru', type: 'kaynak', category: 'mevzuat', source: srcA } }, 201);
    const kaynakId = r.body.item.id;
    r = await expect(editor, 'save', { body: { title: 'Bambaşka bir başlık ama aynı kaynak bağlantısı', type: 'kaynak', category: 'mevzuat', source: { ...srcA, url: 'https://ornek.gov.tr/duyuru/123/?utm_source=x' } } }, 409, 'duplicate_source');
    check(r.body.duplicateOf, kaynakId, 'Duplicate points at original');
    await expect(editor, 'save', { body: { title: 'Örnek kurumdan şebeke bağlantı başvurularına ilişkin duyurular', type: 'analiz', category: 'mevzuat' } }, 409, 'duplicate_title');
    r = await expect(editor, 'save', { body: { title: 'Örnek kurumdan şebeke bağlantı başvurularına ilişkin duyurular', type: 'analiz', category: 'mevzuat', confirmSimilar: true } }, 201);
    ok(r.body.item.flags.includes('similar_title'), 'Confirmed similar title is flagged');
    const similarId = r.body.item.id;

    // kaynak publish rules
    await expect(editor, 'publish', { body: { id: kaynakId } }, 422, 'not_publishable');
    r = await expect(editor, 'editor_get', { query: { id: kaynakId } }, 200);
    await expect(editor, 'save', { body: { id: kaynakId, summary: 'Örnek kurumdan şebeke bağlantı başvurularına ilişkin duyuru' } }, 200);
    r = await expect(editor, 'publish', { body: { id: kaynakId } }, 422, 'not_publishable');
    ok(r.body.fields.summary.includes('tekrar'), 'Summary may not repeat the headline');
    await expect(editor, 'save', { body: { id: kaynakId, summary: 'Kurum, bağlantı başvurularında yeni belge listesini yayımladı; tesis sahiplerinin dosyalarını buna göre güncellemesi gerekiyor.' } }, 200);
    await expect(editor, 'publish', { body: { id: kaynakId } }, 200);

    // schedule / archive / discard
    await expect(editor, 'schedule', { body: { id: similarId, publishAt: '2001-01-01T00:00:00Z' } }, 422, 'invalid_field');
    await expect(editor, 'save', { body: { id: similarId, summary: 'Benzer başlıklı ikinci kayıt; zamanlanmış yayın denetimi için kullanılan editör özeti metni.', body: longBody } }, 200);
    const future = new Date(Date.now() + 3 * 86400e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
    r = await expect(editor, 'schedule', { body: { id: similarId, publishAt: future } }, 200);
    check(r.body.item.status, 'scheduled', 'Scheduled');
    r = await expect(anon, 'list', { query: { q: 'benzer basl' } }, 200);
    r = await expect(anon, 'list', {}, 200);
    ok(!r.body.items.some(i => i.id === similarId), 'Scheduled item hidden until publish time');
    await expect(editor, 'archive', { body: { id: kaynakId } }, 200);
    r = await expect(anon, 'list', { query: { type: 'kaynak' } }, 200);
    check(r.body.total, 0, 'Archived item not public');
    await expect(editor, 'discard', { body: { id: hostileId } }, 409, 'not_discardable');

    // ---------------------------------------------------------------- fetcher (fixtures, no network)
    r = await expect(editor, 'fetch_run', { body: {} }, 200);
    const byId = Object.fromEntries(r.body.results.map(x => [x.sourceId, x]));
    check([byId.epias.ok, byId.epias.items, byId.epias.added], [true, 3, 2], 'EPİAŞ fixture: 3 items, old one skipped');
    check([byId['etkb-haber'].ok, byId['etkb-haber'].added], [true, 1], 'ETKB non-standard feed parsed');
    check([byId['ec-energy'].ok, byId['ec-energy'].added], [true, 1], 'Atom feed parsed');
    ok(!byId.irena && !byId.yesilhaber, 'Sources pending permission are not fetched');
    r = await expect(editor, 'fetch_run', { body: {} }, 200);
    ok(r.body.results.every(x => x.error === 'rate_limited'), 'Per-source rate limit');
    r = await expect(editor, 'fetch_run', { body: { sourceId: 'irena' } }, 200);
    check(r.body.results[0].error, 'permission_required', 'Disabled source requiring permission cannot be fetched');
    const stored = fs.readFileSync(path.join(env.VG_DATA_DIR, 'volthaber/articles.json'), 'utf8');
    ok(!stored.includes('GOVDE-ISARETI'), 'Feed descriptions/content are never stored');
    ok(!stored.includes('Media/x.png') && !stored.includes('epias.com.tr/x.png'), 'Feed images are never stored');
    r = await expect(editor, 'editor_list', { query: { origin: 'inbox' } }, 200);
    check(r.body.total, 4, 'Four ingested drafts in inbox');
    const inbox = Object.fromEntries(r.body.items.map(a => [a.ingest.sourceId + ':' + a.title.slice(0, 5), a]));
    const epiasItem = r.body.items.find(a => a.title.startsWith('Kasım'));
    check(epiasItem.status, 'draft', 'Ingested item is a draft');
    check(epiasItem.summary, '', 'No summary is ingested');
    check(epiasItem.category, 'enerji-piyasasi', 'Category guessed');
    const httpItem = r.body.items.find(a => a.title.startsWith('Piyasa'));
    check(httpItem.source.url, '', 'Non-https feed link is not stored');
    ok(!httpItem.title.includes('<') && httpItem.title.startsWith('Piyasa'), 'Markup stripped from feed titles');
    const etkbItem = r.body.items.find(a => a.ingest.sourceId === 'etkb-haber');
    ok(etkbItem.flags.includes('link_missing') && etkbItem.source.publishedAt !== '', 'Linkless official feed item flagged, date parsed');
    check(r.body.items.find(a => a.ingest.sourceId === 'ec-energy').category, 'enerji-piyasasi', 'Atom item stored');
    ok(Object.keys(inbox).length === 4, 'inbox map');
    // ingested title alone may not be published
    await expect(editor, 'publish', { body: { id: epiasItem.id } }, 422, 'not_publishable');
    await expect(editor, 'save', { body: { id: etkbItem.id, summary: 'Bakanlık yenilenebilir kurulu güçteki gelişmeleri açıkladı; ayrıntılar bakanlığın haber sayfasında yer alıyor.' } }, 200);
    r = await expect(editor, 'publish', { body: { id: etkbItem.id } }, 422, 'not_publishable');
    ok('source.url' in r.body.fields, 'Linkless item needs exact source URL before publishing');
    r = await expect(editor, 'save', { body: { id: epiasItem.id, summary: 'Piyasa işletmecisi kasım dönemi için serbest tüketici listelerini yayımladı; tedarikçi değiştirmek isteyen işletmeler listeyi kontrol etmeli.' } }, 200);
    ok(r.body.item.summaryBy === editorId, 'Summary attributed to human editor');
    r = await expect(editor, 'publish', { body: { id: epiasItem.id } }, 200);
    p = await page(`/volthaber/${r.body.item.slug}/`);
    ok(p.text.includes('Haberin tamamını kaynağında okuyun') && p.text.includes('href="https://www.epias.com.tr/duyuru/serbest-tuketici-kasim/?utm_source=rss"'), 'Source card links to original');
    await expect(editor, 'discard', { body: { id: httpItem.id } }, 200);
    r = await expect(anon, 'list', { query: { q: 'piyasa takas' } }, 200);
    check(r.body.total, 0, 'Discarded item gone');
    r = await expect(editor, 'fetch_log', {}, 200);
    ok(r.body.items.length >= 3 && r.body.items.every(e => 'ms' in e && 'httpStatus' in e), 'Fetch log recorded');
    r = await expect(editor, 'pub_log', {}, 200);
    ok(r.body.items.some(e => e.action === 'publish' && e.by === 'Editör Ayşe'), 'Publication log');

    // sources
    r = await expect(editor, 'sources', {}, 200);
    ok(r.body.items.length >= 8 && r.body.items.every(s => /2026/.test(s.notes)), 'Registry with dated evidence');
    const irena = r.body.items.find(s => s.id === 'irena');
    await expect(editor, 'source_save', { body: { ...irena, enabled: true } }, 400, 'invalid_request');
    const { lastFetchAt, lastOkAt, lastStatus, ...irenaClean } = irena;
    await expect(editor, 'source_save', { body: { ...irenaClean, enabled: true } }, 422, 'permission_required');
    await expect(editor, 'source_save', { body: { ...irenaClean, feedUrl: 'http://www.irena.org/rss' } }, 422, 'invalid_field');

    // SSRF and parser hardening via CLI (no network for IP literals)
    for (const u of ['https://127.0.0.1/feed', 'https://localhost/feed', 'https://10.1.2.3/', 'https://169.254.169.254/latest', 'https://[::1]/', 'https://192.168.1.1/', 'https://100.64.0.1/', 'http://example.com/rss', 'https://user:pw@example.com/', 'https://example.com:8443/', 'file:///etc/passwd', 'https://2130706433/']) {
      const res = cli(path.join(root, 'tools/volthaber-fetch.php'), '--check-url', u);
      check(res.status, 3, 'SSRF blocked: ' + u);
    }
    let res = cli(path.join(root, 'tools/volthaber-fetch.php'), '--parse', path.join(feeds, 'doctype.xml'));
    ok(res.status === 3 && res.stdout.includes('xml_rejected'), 'DOCTYPE/ENTITY feeds rejected');
    res = cli(path.join(root, 'tools/volthaber-fetch.php'), '--parse', path.join(feeds, 'epias.xml'));
    ok(res.status === 0 && !res.stdout.includes('GOVDE'), 'Parser returns only title/link/date');
    check((await page('/tools/volthaber-fetch.php')).status, 404, 'Fetch CLI never served over HTTP');

    // ---------------------------------------------------------------- newsletter
    await expect(anon, 'subscribe', { body: { email: 'okur@example.test' }, csrf: false }, 422, 'consent_required');
    await expect(anon, 'subscribe', { body: { email: 'not-an-email', consent: true }, csrf: false }, 422, 'invalid_email');
    await expect(anon, 'subscribe', { body: { email: 'okur@example.test', consent: true, extra: 1 }, csrf: false }, 400, 'invalid_request');
    await expect(anon, 'subscribe', { body: { email: 'okur@example.test', consent: true }, csrf: false, headers: { Origin: 'https://evil.example' } }, 403, 'forbidden_origin');
    const before = outbox().length;
    await expect(anon, 'subscribe', { body: { email: 'bot@example.test', consent: true, website: 'http://spam' }, csrf: false }, 200);
    check(outbox().length, before, 'Honeypot sends nothing');
    r = await expect(anon, 'subscribe', { body: { email: 'Okur@Example.test', consent: true }, csrf: false }, 200);
    const confirmMail = outbox().slice(-1)[0];
    const token = (confirmMail.match(/#onay=([A-Za-z0-9_-]{32})/) || [])[1];
    ok(token, 'Double opt-in mail with token');
    const unsubToken = (confirmMail.match(/#iptal=(s[a-f0-9]{20}\.[a-f0-9]{32})/) || [])[1];
    ok(unsubToken, 'Every email carries an unsubscribe link');
    let subs = JSON.parse(fs.readFileSync(path.join(env.VG_DATA_DIR, 'volthaber/subscribers.json'), 'utf8'));
    let rec = Object.values(subs.subscribers)[0];
    check([rec.status, rec.consentVersion.startsWith('volthaber-bulten'), /^[a-f0-9]{32}$/.test(rec.ipHash), typeof rec.consentAt], ['pending', true, true, 'number'], 'Consent timestamp, version and IP hash recorded');
    ok(!JSON.stringify(subs).includes('127.0.0.1'), 'Raw IP never stored');
    r = await expect(editor, 'stats', {}, 200);
    check(r.body.subscribers.active, 0, 'Pending is not active');
    await expect(anon, 'confirm', { body: { token: 'A'.repeat(32) }, csrf: false }, 404, 'invalid_token');
    await expect(anon, 'confirm', { body: { token: '../../x' }, csrf: false }, 422, 'invalid_token');
    await expect(anon, 'confirm', { body: { token }, csrf: false }, 200);
    await expect(anon, 'confirm', { body: { token }, csrf: false }, 404, 'invalid_token');
    for (let i = 0; i < 3; i++) await expect(anon, 'subscribe', { body: { email: 'ikinci@example.test', consent: true }, csrf: false }, 200);
    const n = outbox().length;
    await expect(anon, 'subscribe', { body: { email: 'ikinci@example.test', consent: true }, csrf: false }, 200);
    check(outbox().length, n, 'Per-email confirmation mails are capped silently');
    r = await expect(editor, 'stats', {}, 200);
    check([r.body.subscribers.active, r.body.subscribers.pending], [1, 1], 'Subscriber stats');
    r = await request(editor, 'subscribers_export', { body: {} });
    check(r.status, 200, 'Export works');
    ok(r.headers.get('content-type').startsWith('text/csv') && r.text.includes('okur@example.test') && !r.text.includes('ikinci@'), 'CSV contains only active subscribers');
    await expect(member, 'subscribers_export', { body: {} }, 403, 'forbidden');
    // An unconfirmed address is deleted once its 48 h window has passed (privacy notice promise; cannot fill the cap).
    const subsFile = path.join(env.VG_DATA_DIR, 'volthaber/subscribers.json');
    subs = JSON.parse(fs.readFileSync(subsFile, 'utf8'));
    for (const s of Object.values(subs.subscribers)) if (s.status === 'pending') s.confirmExpires = Math.floor(Date.now() / 1000) - 10;
    fs.writeFileSync(subsFile, JSON.stringify(subs));
    await expect(anon, 'subscribe', { body: { email: 'ucuncu@example.test', consent: true }, csrf: false }, 200);
    subs = JSON.parse(fs.readFileSync(subsFile, 'utf8'));
    ok(!JSON.stringify(subs).includes('ikinci@example.test') && JSON.stringify(subs).includes('ucuncu@example.test'), 'Expired pending sign-ups are erased, new one kept');
    r = await expect(editor, 'stats', {}, 200);
    check([r.body.subscribers.active, r.body.subscribers.pending], [1, 1], 'Only the fresh pending sign-up remains');
    const lastConfirm = outbox().filter(m => m.includes('ucuncu@example.test')).pop() || '';
    const expiredToken = (lastConfirm.match(/#onay=([A-Za-z0-9_-]+)/) || [])[1];
    subs.subscribers[Object.keys(subs.subscribers).find(k => subs.subscribers[k].status === 'pending')].confirmExpires = Math.floor(Date.now() / 1000) - 10;
    fs.writeFileSync(subsFile, JSON.stringify(subs));
    await expect(anon, 'confirm', { body: { token: expiredToken }, csrf: false }, 410, 'token_expired');
    ok(!fs.readFileSync(subsFile, 'utf8').includes('ucuncu@example.test'), 'Opening an expired link also erases the address');
    // Newsletter form: notice and consent are separate texts with separate headings (KVKK Board decision 2026/347).
    p = await page('/volthaber/');
    const news = (p.text.match(/<section class="vh-news"[\s\S]*?<\/section>/) || [''])[0];
    const consentLabel = (news.match(/<label class="vh-consent">[\s\S]*?<\/label>/) || [''])[0];
    ok(news.includes('>Aydınlatma</h3>') && news.includes('>Açık rıza</h3>') && news.indexOf('>Aydınlatma</h3>') < news.indexOf('>Açık rıza</h3>'), 'Notice and consent under separate headings, notice first');
    ok(consentLabel.includes('açık rıza veriyorum') && !/aydınlatma|gizlilik\.html/i.test(consentLabel), 'Consent checkbox does not bundle the privacy notice');
    // digest
    r = await expect(anon, 'list', {}, 200);
    const liveIds = r.body.items.slice(0, 2).map(i => i.id);
    await expect(editor, 'digest_create', { body: { subject: 'VoltHaber deneme', intro: '', articleIds: [hostileId, similarId] } }, 422, 'invalid_field');
    r = await expect(editor, 'digest_create', { body: { subject: 'VoltHaber deneme bülteni', intro: 'Merhaba okurlar.', articleIds: liveIds } }, 201);
    const digestId = r.body.id;
    check(r.body.total, 1, 'Digest goes to active subscribers only');
    r = await expect(editor, 'digest_send', { body: { id: digestId } }, 200);
    check([r.body.sent, r.body.done], [1, true], 'Digest batch sent');
    const digestMail = outbox().slice(-1)[0];
    ok(digestMail.includes('#iptal=' + unsubToken) && digestMail.includes('/volthaber/'), 'Digest has unsubscribe link and article links');
    await expect(anon, 'unsubscribe', { body: { token: unsubToken.slice(0, -1) + (unsubToken.endsWith('0') ? '1' : '0') }, csrf: false }, 422, 'invalid_token');
    await expect(anon, 'unsubscribe', { body: { token: unsubToken }, csrf: false }, 200);
    subs = JSON.parse(fs.readFileSync(path.join(env.VG_DATA_DIR, 'volthaber/subscribers.json'), 'utf8'));
    ok(!JSON.stringify(subs).includes('okur@example.test'), 'Unsubscribe erases the e-mail address');

    // ---------------------------------------------------------------- social drafts
    r = await expect(editor, 'social', { query: { id: liveIds[0] } }, 200);
    ok(r.body.drafts.linkedin.includes('https://voltguard.com.tr/volthaber/') && r.body.drafts.instagram && r.body.drafts.shorts.akis.length >= 4 && r.body.drafts.card.title, 'Template social drafts');

    // ---------------------------------------------------------------- SSR pages, feeds
    p = await page('/volthaber/');
    ok(p.status === 200 && p.text.includes('VoltGuard analizleri') && p.text.includes('Mevzuat ve resmî duyurular') && p.text.includes('<!--vg:header-->'), 'Home renders with shared shell');
    ok(p.text.includes('"@type":"CollectionPage"'), 'Home JSON-LD');
    ok(p.text.includes('En çok okunanlar'), 'Most read appears after views were counted');
    p = await page('/volthaber/kategori/mevzuat');
    check([p.status, p.headers.get('location')], [301, '/volthaber/kategori/mevzuat/'], 'Missing slash redirects');
    p = await page('/volthaber/kategori/yenilenebilir/');
    ok(p.status === 200 && p.text.includes('aria-current="page">Yenilenebilir Enerji'), 'Category page');
    p = await page('/volthaber/etiket/lisanssiz-uretim/');
    ok(p.status === 200 && p.text.includes('noindex'), 'Tag page (noindex)');
    check((await page('/volthaber/etiket/olmayan-etiket/')).status, 404, 'Empty tag 404');
    check((await page('/volthaber/yok-boyle/')).status, 404, 'Unknown slug 404');
    check((await page('/volthaber/?sayfa=abc')).status, 404, 'Invalid page 404');
    p = await page('/volthaber/?q=%3Cscript%3E');
    ok(p.status === 200 && p.text.includes('&lt;script&gt;') && p.text.includes('noindex'), 'Search page escapes query');
    p = await page('/volthaber/rss.xml');
    ok(p.status === 200 && p.headers.get('content-type').includes('rss') && p.text.includes('<rss version="2.0"') && p.text.includes(`/volthaber/${hostileSlug}/`), 'Own RSS feed');
    ok(p.text.includes('&lt;b&gt;'), 'RSS escapes titles');
    p = await page('/volthaber/sitemap.xml');
    ok(p.status === 200 && p.text.includes('<urlset') && p.text.includes(seed[0].slug) && !p.text.includes(similarId), 'Sitemap lists live articles only');
    // views: bots are not counted, humans are
    const vBefore = JSON.parse(fs.readFileSync(path.join(env.VG_DATA_DIR, 'volthaber/views.json'), 'utf8')).views[seed[0] && Object.keys(JSON.parse(fs.readFileSync(path.join(env.VG_DATA_DIR, 'volthaber/views.json'), 'utf8')).views)[0]];
    ok(typeof vBefore === 'number', 'Aggregate view counter');
    const views = () => JSON.parse(fs.readFileSync(path.join(env.VG_DATA_DIR, 'volthaber/views.json'), 'utf8')).views;
    const c0 = Object.values(views()).reduce((a, b) => a + b, 0);
    await page(`/volthaber/${seed[1].slug}/`, { ua: 'Googlebot/2.1' });
    check(Object.values(views()).reduce((a, b) => a + b, 0), c0, 'Bots not counted');
    ok(!JSON.stringify(views()).includes('127.0.0.1'), 'Views are aggregate only');
    const c1 = Object.values(views()).reduce((a, b) => a + b, 0);
    for (let i = 0; i < 4; i++) await page(`/volthaber/${seed[2].slug}/`);
    check(Object.values(views()).reduce((a, b) => a + b, 0), c1 + 1, 'Repeated reads from one client count once per 30 minutes');
    p = await page('/volthaber/yayin-ilkeleri.html');
    ok(p.status === 200 && p.text.includes('FSEK') === false && p.text.includes('Fikir ve Sanat Eserleri Kanunu') && p.text.includes('id="kaldirma"'), 'Policy page');

    // ---------------------------------------------------------------- real mail transport (no outbox)
    // Without VG_MAIL_OUTBOX the reply must never claim the confirmation mail was sent: no mail() -> 503;
    // mail() present but the transport rejects (no SMTP here) -> neutral "received" wording only.
    for (const [label, phpArgs, status] of [['mail() disabled', ['-d', 'disable_functions=mail'], 503], ['transport rejects', ['-d', 'SMTP=127.0.0.1', '-d', `smtp_port=${await unusedPort()}`], 200]]) {
      const mailPort = await unusedPort();
      const mailEnv = { ...env, VG_MAIL_OUTBOX: '', VG_DATA_DIR: path.join(sandbox, 'data-mail-' + mailPort) };
      fs.mkdirSync(mailEnv.VG_DATA_DIR);
      const mailServer = spawn(php, ['-n', ...phpArgs, '-S', `127.0.0.1:${mailPort}`, '-t', root, path.join(root, 'tools/volthaber-dev-router.php')], { env: mailEnv, stdio: 'ignore', windowsHide: true });
      try {
        let res;
        for (let i = 0; i < 100; i++) {
          try {
            res = await fetch(`http://127.0.0.1:${mailPort}/api/volthaber.php?action=subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${mailPort}` }, body: JSON.stringify({ email: 'posta@example.test', consent: true }) });
            break;
          } catch { await new Promise(resolve => setTimeout(resolve, 30)); }
        }
        const body = await res.json();
        check(res.status, status, `${label}: subscribe status`);
        if (status === 503) check(body.error, 'mail_unavailable', `${label}: explicit mail error, nothing stored`);
        ok(!/gönderildi/i.test(body.message || ''), `${label}: reply does not claim the mail was sent`);
      } finally {
        mailServer.kill();
        await new Promise(resolve => { if (mailServer.exitCode !== null) resolve(); else { mailServer.once('exit', resolve); setTimeout(resolve, 3000); } });
      }
    }

    // ---------------------------------------------------------------- storage safety
    ok(!fs.existsSync(path.join(root, 'volthaber', 'articles.json')) && fs.existsSync(path.join(env.VG_DATA_DIR, 'volthaber', 'articles.json')), 'Data lives outside docroot');
    fs.writeFileSync(path.join(env.VG_DATA_DIR, 'volthaber/articles.json'), '{broken');
    await expect(anon, 'list', {}, 503, 'unavailable');
    check((await page('/volthaber/')).status, 503, 'SSR fails closed on corrupt data');
    console.log(`VoltHaber API: ${checks} checks passed; temporary dataset isolated.`);
  } catch (e) {
    if (logs.length) console.error(logs.join('').slice(-3000));
    throw e;
  } finally {
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 3000); } });
    const resolved = fs.realpathSync(sandbox);
    assert.ok(path.relative(fs.realpathSync(os.tmpdir()), resolved).startsWith('voltguard-volthaber-api-'), 'Cleanup stays in temp');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
