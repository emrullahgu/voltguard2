'use strict';

// Yayın bütünlüğü: deploy git içeriğini kopyalar; sayfaların yüklediği derlenmiş dosyalar git'te izlenmiyorsa canlıda 404 olur.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

function tracked() {
  try { return new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)); }
  catch (_) { return null; }
}

test('çalışan uygulamasının giriş etiketlerindeki her paket mevcut ve git’te izleniyor', t => {
  const files = tracked();
  if (!files) { t.skip('git yok'); return; }
  const tags = fs.readFileSync(path.join(root, 'calisan/uygulama/entry-tags.html'), 'utf8');
  const refs = Array.from(tags.matchAll(/(?:src|href)="\/(calisan\/uygulama\/[^"]+)"/g), m => m[1]);
  assert.ok(refs.length >= 2, 'giriş etiketlerinde paket bulunmalı');
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(root, ref)), 'dosya yok: ' + ref);
    assert.ok(files.has(ref), 'git’te izlenmiyor (deploy’da eksik kalır): ' + ref);
  }
  // paketlerin birbirini çağırdığı dinamik içe aktarmalar da izlenmeli
  const dir = 'calisan/uygulama/assets';
  for (const f of fs.readdirSync(path.join(root, dir)).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(root, dir, f), 'utf8');
    for (const m of src.matchAll(/["'`]\.\/([A-Za-z0-9_.-]+\.(?:js|css))["'`]/g)) {
      const ref = dir + '/' + m[1];
      assert.ok(files.has(ref), f + ' içinden çağrılan paket git’te yok: ' + ref);
    }
  }
});

test('VoltSim sayfalarının yüklediği yerel betik ve stiller mevcut', () => {
  const dirs = fs.readdirSync(path.join(root, 'voltsim'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => 'voltsim/' + d.name + '/index.html').concat(['voltsim/index.html']);
  for (const page of dirs) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="(\/(?:js|css|public)\/[^"?#]+)/g)) assert.ok(fs.existsSync(path.join(root, m[1])), page + ': ' + m[1]);
  }
});

test('css/js ?v= sürümleri dosya içeriğiyle eşleşiyor (python tools/sync-versions.py)', t => {
  const { spawnSync } = require('node:child_process');
  const py = ['python', 'python3', 'py'].find(c => { try { return spawnSync(c, ['--version']).status === 0; } catch (_) { return false; } });
  if (!py) { t.skip('python yok'); return; }
  const r = spawnSync(py, [path.join(root, 'tools/sync-versions.py'), '--check'], { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
  assert.equal(r.status, 0, 'Eski sürüm referansları var; “python tools/sync-versions.py” çalıştırın.\n' + r.stdout.slice(0, 1500));
});

test('mevzuat değişiklikleri sayfası VoltSim mevzuat kaydıyla güncel (node tools/build-mevzuat-guncellemeleri.cjs)', () => {
  execFileSync(process.execPath, [path.join(root, 'tools/build-mevzuat-guncellemeleri.cjs'), '--check'], { cwd: root, stdio: 'pipe' });
});
