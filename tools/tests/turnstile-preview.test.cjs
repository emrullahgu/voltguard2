'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');

test('Loopback preview uses visibly labelled Turnstile test keys without changing published forms', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voltguard-turnstile-preview-'));
  const forms = ['/iletisim.html', '/sor.html', '/fabrika-cozumleri.html'];
  const originals = new Map(forms.map(route => [route, fs.readFileSync(path.join(root, route), 'utf8')]));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  // This test reads HTTP HTML only: no PHP, Cloudflare request or mail transport.
  const child = spawn(process.execPath, ['tools/preview.cjs'], {
    cwd: root, windowsHide: true, stdio: 'ignore',
    env: {...process.env, LOCALAPPDATA: directory, VG_PREVIEW_PORT: String(port), VG_PHP: path.join(directory, 'no-php-runtime')},
  });
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/manifest.json')).ok) break; }
      catch (_) { if (i === 99) throw new Error('Preview did not start'); }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    for (const route of forms) {
      const original = originals.get(route);
      const productionKeys = [...original.matchAll(/data-sitekey="([^"]+)"/g)].map(match => match[1]);
      assert.ok(productionKeys.length > 0, route + ' has a maintained production site key');
      for (const key of productionKeys) assert.match(key, /^0x[A-Za-z0-9_-]+$/, 'Published HTML retains real site key');
      const response = await fetch(base + route + '?preview-test=1');
      assert.equal(response.status, 200, route);
      const html = await response.text();
      const localKeys = [...html.matchAll(/data-sitekey="([^"]+)"/g)].map(match => match[1]);
      assert.deepEqual(localKeys, productionKeys.map(() => '1x00000000000000000000AA'));
      for (const key of productionKeys) assert.ok(!html.includes(key), 'Production key is not used by loopback widget');
      assert.equal((html.match(/data-vg-preview-turnstile/g) || []).length, 1);
      assert.match(html, /Önizleme: güvenlik doğrulaması test anahtarıyla çalışır; gerçek e-posta gönderilmez\./);
      assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(html));
      assert.equal(response.headers.get('accept-ranges'), 'none');
      const head = await fetch(base + route, {method: 'HEAD'});
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-length'), response.headers.get('content-length'));
      assert.equal(await head.text(), '');
      const ranged = await fetch(base + route, {headers: {Range: 'bytes=0-99'}});
      assert.equal(ranged.status, 200, 'Transformed HTML ignores byte ranges rather than serving original key');
      assert.equal(await ranged.text(), html);
      assert.equal(fs.readFileSync(path.join(root, route), 'utf8'), original, 'Preview does not edit source HTML');
    }
    const ordinary = await fetch(base + '/gizlilik.html');
    assert.equal(await ordinary.text(), fs.readFileSync(path.join(root, 'gizlilik.html'), 'utf8'));
  } finally {
    child.kill();
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 3000).unref(); } });
    assert.ok(path.dirname(directory) === fs.realpathSync(os.tmpdir()) && path.basename(directory).startsWith('voltguard-turnstile-preview-'));
    fs.rmSync(directory, {recursive: true, force: true});
  }
});
