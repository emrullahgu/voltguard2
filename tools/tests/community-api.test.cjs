/* Real PHP/HTTP security checks. All accounts/comments live in a temporary private data directory. */
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

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function run() {
  const probe = spawnSync(php, ['-n', '-v'], { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) throw new Error('Set VG_PHP to a PHP 7.4+ executable to run these checks.');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-community-api-'));
  const environment = { ...process.env, VG_DATA_DIR: sandbox, VG_STORE: 'json', VG_MAIL_OUTBOX: '1', VG_RATE_SCALE: '1', VG_COMMUNITY_GUEST_DAILY: '4' };
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(php, ['-n', '-S', `127.0.0.1:${port}`, '-t', root], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const logs = [];
  child.stderr.on('data', chunk => logs.push(String(chunk)));
  child.stdout.resume();
  const client = () => ({ cookies: new Map(), csrf: '' });
  const a = client(), b = client(), member = client();

  async function request(actor, action, options = {}) {
    const endpoint = options.endpoint || 'community';
    const query = new URLSearchParams({ action, ...(options.query || {}) });
    const headers = { Cookie: [...actor.cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers };
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
      const equals = first.indexOf('=');
      actor.cookies.set(first.slice(0, equals), first.slice(equals + 1));
    }
    const result = await response.json();
    if (result.csrf) actor.csrf = result.csrf;
    return { status: response.status, body: result, headers: response.headers };
  }

  async function expect(actor, action, options, status, code) {
    const result = await request(actor, action, options);
    check(result.status, status, `${action} HTTP status`);
    if (code) check(result.body.error, code, `${action} error code`);
    return result;
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { await fetch(`${base}/api/community.php?action=list`); ready = true; break; }
      catch (_) { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready, 'PHP test server starts');
    let result = await expect(a, 'list', {}, 200);
    check(result.body.items, [], 'No synthetic initial comments');
    check(result.body.canPublish, true, 'Guests can publish');
    check(/^[a-f0-9]{64}$/.test(a.csrf), true, 'Guest has real server CSRF token');
    check(result.headers.getSetCookie().some(cookie => /^VGSESS=/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie)), true, 'Guest session is HttpOnly and SameSite');
    check(result.headers.get('cache-control').includes('no-store'), true, 'Comments and ownership are never cached');
    check(JSON.stringify(result.body).includes('vg_community_guest'), false, 'Session actor never exposed');
    await expect(a, 'unknown', {}, 404, 'unknown_action');
    await expect(a, 'publish', { method: 'GET' }, 405, 'method_not_allowed');
    await expect(a, 'list', { query: { limit: '51' } }, 422, 'invalid_limit');
    await expect(a, 'list', { query: { before: '../../secret.key' } }, 422, 'invalid_cursor');
    const valid = { authorName: 'Ayşe Ziyaretçi', message: 'Herkese açık ilk yorum.' };
    await expect(a, 'publish', { body: valid, csrf: false }, 403, 'csrf');
    await expect(a, 'publish', { body: valid, csrf: '0'.repeat(64) }, 403, 'csrf');
    await expect(a, 'publish', { body: valid, headers: { Origin: 'https://outside.example' } }, 403, 'forbidden_origin');
    await expect(a, 'publish', { body: valid, headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403, 'forbidden_origin');
    await expect(a, 'publish', { body: valid, headers: { 'Content-Type': 'text/plain' } }, 415, 'unsupported_media_type');
    await expect(a, 'publish', { body: 'x'.repeat(17000) }, 413, 'too_large');
    await expect(a, 'publish', { body: { ...valid, authorId: 'g' + '1'.repeat(48) } }, 400, 'invalid_request');
    await expect(a, 'publish', { body: { ...valid, role: 'moderator' } }, 400, 'invalid_request');
    await expect(a, 'publish', { body: { ...valid, website: 'spam.example' } }, 422, 'invalid_request');
    await expect(a, 'publish', { body: { ...valid, authorName: 'A' } }, 422, 'invalid_name');
    await expect(a, 'publish', { body: { ...valid, authorName: '<script>Admin</script>' } }, 422, 'invalid_name');
    await expect(a, 'publish', { body: { ...valid, authorName: 'A'.repeat(61) } }, 422, 'invalid_name');
    await expect(a, 'publish', { body: { ...valid, message: '' } }, 422, 'invalid_message');
    await expect(a, 'publish', { body: { ...valid, message: 'a'.repeat(2001) } }, 422, 'invalid_message');
    await expect(a, 'publish', { body: { ...valid, message: 'Nul\u0000byte' } }, 422, 'invalid_message');
    const literalMarkup = '<img src=x onerror="window.bad=true">\nYorum metni olarak kalmalı.';
    result = await expect(a, 'publish', { body: { ...valid, message: literalMarkup } }, 201);
    const firstId = result.body.item.id;
    check(result.body.item.message, literalMarkup, 'HTML is returned only as literal text');
    check(result.body.item.authorName, valid.authorName, 'Guest name is validated display name');
    check(result.body.item.authorType, 'guest', 'Guest is explicitly distinguished');
    check(result.body.item.canDelete, true, 'Original guest can delete');
    check(Object.keys(result.body.item).sort(), ['authorName', 'authorType', 'canDelete', 'createdAt', 'deleted', 'id', 'message', 'parentId'].sort(), 'No private author ID, email or role in public comments');
    result = await expect(b, 'list', {}, 200);
    check(result.body.items[0].canDelete, false, 'Second guest never owns another session comment');
    await expect(b, 'delete', { body: { id: firstId } }, 403, 'forbidden');
    await expect(a, 'publish', { body: { ...valid, message: 'İkinci yorum.' } }, 429, 'rate_limited');
    result = await expect(b, 'publish', { body: { authorName: 'İkinci Ziyaretçi', message: 'İlk yoruma yanıt.', parentId: firstId } }, 201);
    const replyId = result.body.item.id;
    check(result.body.item.parentId, firstId, 'Reply is attached to an existing comment');
    await expect(b, 'publish', { body: { ...valid, parentId: '../../private' } }, 422, 'invalid_parent');
    await expect(b, 'publish', { body: { ...valid, parentId: 'c_' + '0'.repeat(24) } }, 404, 'comment_not_found');
    result = await expect(a, 'list', { query: { limit: '1' } }, 200);
    check(result.body.items[0].id, replyId, 'Newest first pagination');
    check(result.body.nextBefore, replyId, 'Next cursor matches last item');
    result = await expect(a, 'list', { query: { limit: '1', before: replyId } }, 200);
    check(result.body.items[0].id, firstId, 'Cursor reads older item once');
    check(result.body.nextBefore, null, 'No next cursor at end');
    await expect(a, 'delete', { body: { id: firstId } }, 200);
    result = await expect(b, 'list', {}, 200);
    const tombstone = result.body.items.find(item => item.id === firstId);
    check(tombstone.deleted, true, 'Deletion leaves safe parent marker');
    check(tombstone.message, '', 'Deleted text removed');
    check(tombstone.authorName, 'Yorum silindi', 'Deleted author identity removed');
    check(result.body.items.find(item => item.id === replyId).deleted, false, 'Deleting parent does not delete another visitor reply');
    await expect(b, 'publish', { body: { ...valid, parentId: firstId } }, 409, 'comment_deleted');

    await expect(member, 'me', { endpoint: 'auth' }, 200);
    const unique = `${Date.now()}-${process.pid}`;
    result = await expect(member, 'register', { endpoint: 'auth', body: { name: 'Kayıtlı Üye', email: `community-${unique}@example.test`, password: 'Deneme12345', consent: true } }, 201);
    const memberId = result.body.user.id;
    result = await expect(member, 'publish', { body: { authorName: 'Sahte Yönetici', message: 'Kayıtlı üyeden yorum.' } }, 201);
    const memberPostId = result.body.item.id;
    check(result.body.item.authorName, 'Kayıtlı Üye', 'Member cannot spoof an author name');
    check(result.body.item.authorType, 'member', 'Normal account is member, never employee');
    await expect(member, 'delete', { body: { id: replyId } }, 403, 'forbidden');
    const grant = spawnSync(php, ['-n', path.join(root, 'tools/community-admin.php'), 'grant', memberId], { env: environment, encoding: 'utf8', windowsHide: true });
    check(grant.status, 0, 'Moderator provisioned only through private CLI');
    result = await expect(member, 'list', {}, 200);
    check(result.body.moderator, true, 'Provisioned moderator is recognized');
    check(result.body.items.find(item => item.id === replyId).canDelete, true, 'Moderator can manage guest comments');
    const revoke = spawnSync(php, ['-n', path.join(root, 'tools/community-admin.php'), 'revoke', memberId], { env: environment, encoding: 'utf8', windowsHide: true });
    check(revoke.status, 0, 'Moderator can be revoked through private CLI');
    await expect(member, 'delete', { body: { id: replyId } }, 403, 'forbidden');
    await expect(b, 'delete', { body: { id: replyId } }, 200);
    await expect(member, 'delete_account', { endpoint: 'auth', body: { password: 'Deneme12345', confirm: true } }, 200);
    result = await expect(a, 'list', {}, 200);
    const removedMemberPost = result.body.items.find(item => item.id === memberPostId);
    check(removedMemberPost.deleted, true, 'Account deletion removes public comments as well as account collections');
    check(removedMemberPost.message, '', 'Deleted account comment content is erased');
    result = await fetch(`${base}/tools/community-admin.php`);
    check(result.status, 404, 'CLI administration refuses HTTP even without .htaccess');
    const stored = JSON.parse(fs.readFileSync(path.join(sandbox, 'community/comments.json'), 'utf8'));
    check(Object.keys(stored.posts[firstId]).sort(), ['createdAt', 'deleted', 'deletedAt', 'id', 'parentId'].sort(), 'Private tombstone contains no author identity or original content');
    check(Object.keys(stored.posts[memberPostId]).sort(), ['createdAt', 'deleted', 'deletedAt', 'id', 'parentId'].sort(), 'Account deletion erases private author identity and comment content');
    check(JSON.stringify(stored).includes('@example.test'), false, 'Community does not store email addresses');
    check(Object.keys(stored.rates).every(key => /^[a-f0-9]{64}$/.test(key)), true, 'Spam counters use HMAC keys');

    // Reserved display names cannot impersonate VoltGuard, staff roles or moderators.
    const c = client(), d = client(), e = client();
    for (const actor of [c, d, e]) await expect(actor, 'list', {}, 200);
    for (const name of ['VoltGuard', 'V0lt-Guard Destek', 'Site Yönetici', 'moderatör', 'Admin', 'Emrullah Günay'])
      await expect(c, 'publish', { body: { authorName: name, message: 'Taklit denemesi.' } }, 422, 'reserved_name');
    // Reports: three distinct visitors hide a comment until a moderator reviews it.
    result = await expect(c, 'publish', { body: { authorName: 'Rapor Edilen', message: 'Bildirilecek yorum.' } }, 201);
    const reportedId = result.body.item.id;
    await expect(c, 'report', { body: { id: reportedId } }, 409, 'own_comment');
    await expect(d, 'report', { body: { id: 'c_' + '0'.repeat(24) } }, 404, 'comment_not_found');
    await expect(d, 'report', { body: { id: reportedId, reason: 'x' } }, 400, 'invalid_request');
    result = await expect(d, 'report', { body: { id: reportedId } }, 200); check(result.body.hidden, false, 'One report does not hide a comment');
    await expect(d, 'report', { body: { id: reportedId } }, 200);
    result = await expect(e, 'report', { body: { id: reportedId } }, 200); check(result.body.hidden, false, 'Second session from the same network is not a second reporter');
    result = await expect(a, 'report', { body: { id: reportedId } }, 200); check(result.body.hidden, false, 'Throwaway sessions from one network cannot hide a comment');
    // Every test client shares 127.0.0.1: two reports from other networks are seeded directly into the private store.
    const commentsFile = path.join(sandbox, 'community/comments.json');
    const seeded = JSON.parse(fs.readFileSync(commentsFile, 'utf8'));
    check(seeded.posts[reportedId].reportNets.length, 1, 'One network mark for the local client');
    seeded.posts[reportedId].reportNets.push('a'.repeat(24), 'b'.repeat(24));
    fs.writeFileSync(commentsFile, JSON.stringify(seeded));
    result = await expect(b, 'list', {}, 200);
    const masked = result.body.items.find(item => item.id === reportedId);
    check([masked.hidden, masked.message, masked.authorName], [true, '', 'İncelemedeki yorum'], 'Hidden comment content and author are withheld from the public');
    await expect(d, 'approve', { body: { id: reportedId } }, 403, 'forbidden');
    const mod = client(); await expect(mod, 'me', { endpoint: 'auth' }, 200);
    result = await expect(mod, 'register', { endpoint: 'auth', body: { name: 'Topluluk Moderatörü', email: `moderator-${unique}@example.test`, password: 'Deneme12345', consent: true } }, 201);
    check(spawnSync(php, ['-n', path.join(root, 'tools/community-admin.php'), 'grant', result.body.user.id], { env: environment, encoding: 'utf8', windowsHide: true }).status, 0, 'Second moderator provisioned');
    result = await expect(mod, 'list', {}, 200);
    const review = result.body.items.find(item => item.id === reportedId);
    check([review.message, review.reports], ['Bildirilecek yorum.', 3], 'Moderator sees reported content and report count');
    await expect(mod, 'approve', { body: { id: reportedId } }, 200);
    result = await expect(b, 'list', {}, 200);
    check(result.body.items.find(item => item.id === reportedId).message, 'Bildirilecek yorum.', 'Approved comment is visible again');
    // Site-wide guest quota (VG_COMMUNITY_GUEST_DAILY=4 in this test): members are not limited by it.
    await expect(d, 'publish', { body: { authorName: 'Dördüncü Misafir', message: 'Kota içindeki yorum.' } }, 201);
    result = await expect(e, 'publish', { body: { authorName: 'Beşinci Misafir', message: 'Kota dışındaki yorum.' } }, 429, 'rate_limited');
    check(result.body.message.includes('misafir yorum kotası'), true, 'Guest quota explains member alternative');
    result = await expect(mod, 'publish', { body: { message: 'Üye kotadan etkilenmez.' } }, 201);
    check(result.body.item.authorName, 'Topluluk Moderatörü', 'A moderator keeps a staff-like display name');
    const impostor = client(); await expect(impostor, 'me', { endpoint: 'auth' }, 200);
    await expect(impostor, 'register', { endpoint: 'auth', body: { name: 'VoltGuard Destek', email: `impostor-${unique}@example.test`, password: 'Deneme12345' } }, 201);
    result = await expect(impostor, 'publish', { body: { message: 'Ekip adına yazıyormuş gibi.' } }, 201);
    check(result.body.item.authorName, 'Üye', 'A member account name cannot impersonate VoltGuard staff');
    const storedAfter = JSON.parse(fs.readFileSync(path.join(sandbox, 'community/comments.json'), 'utf8'));
    check(storedAfter.posts[reportedId].reviewed, true, 'Moderator review is persisted');
    check((storedAfter.posts[reportedId].reports || []).length + (storedAfter.posts[reportedId].reportNets || []).length, 0, 'Approval clears stored reports');
    const corruptFile = path.join(sandbox, 'community/comments.json');
    fs.writeFileSync(corruptFile, '{broken');
    await expect(a, 'list', {}, 503, 'unavailable');
    console.log(`Community API: ${checks} checks passed; temporary dataset isolated from preview data.`);
  } finally {
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 3000); } });
    const resolved = fs.realpathSync(sandbox);
    const temporary = fs.realpathSync(os.tmpdir());
    assert.ok(path.relative(temporary, resolved).startsWith('voltguard-community-api-'), 'Cleanup path must stay inside the named temporary test directory');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error.message); process.exitCode = 1; });
