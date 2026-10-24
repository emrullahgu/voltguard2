'use strict';

// Netlify serves the verified, committed static release. PHP and development
// source belong on the PHP host or in Git, never in the Netlify publish folder.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const publish = path.join(root, '.netlify-publish');
const publicDirectories = ['akademi', 'araclar', 'assets', 'bilgi', 'css', 'fonts',
  'hesaplama', 'hizmetler', 'js', 'mm', 'public', 'sor', 'voltsim'];
const rootFiles = fs.readdirSync(root).filter(name => name.endsWith('.html'))
  .concat(['sw.js', 'manifest.json', 'robots.txt', 'sitemap.xml', 'llms.txt']);
// Account, employee and community pages need the PHP API: netlify.toml sends them to https://voltguard.com.tr.
const employeePages = [];
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/voltgame/release.json'), 'utf8'));
assert.equal(manifest.rules, 4);
assert.equal(manifest.levels.length, 27);
assert.equal(manifest.daily, 37);
for (const file of Object.values(manifest.files)) {
  const relative = file.path.slice(1);
  assert.ok(relative.startsWith('public/voltgame/') && !relative.includes('..'));
  assert.equal(fs.statSync(path.join(root, relative)).size, file.bytes, 'Complete game artifact: ' + relative);
}
const worker = fs.readFileSync(path.join(root, 'public/voltgame/solver-worker.js'));
assert.equal(crypto.createHash('sha256').update(worker).digest('hex'), manifest.workerSHA256);
for (const file of ['ekibimiz.html', 'voltgame.html', 'public/voltguard-logo.webp', 'araclar/index.html']) {
  assert.ok(fs.statSync(path.join(root, file)).isFile(), 'Release asset: ' + file);
}
if (fs.existsSync(publish)) {
  assert.ok(!fs.lstatSync(publish).isSymbolicLink(), 'Publish output cannot be a link.');
  const actual = fs.realpathSync(publish);
  assert.equal(path.dirname(actual), fs.realpathSync(root));
  assert.equal(path.basename(actual), '.netlify-publish');
  fs.rmSync(actual, {recursive:true, force:true});
}
fs.mkdirSync(publish);
for (const directory of publicDirectories) fs.cpSync(path.join(root, directory), path.join(publish, directory), {
  recursive:true, filter:source => !fs.lstatSync(source).isSymbolicLink(),
});
for (const file of rootFiles.concat(employeePages)) {
  const target = path.join(publish, file);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.copyFileSync(path.join(root, file), target);
}
for (const forbidden of ['api', 'tools', 'VoltGame', 'vesikalar', 'voltguardekleyelim', '.qa',
  'calisan', 'hesap', 'contact.php']) assert.ok(!fs.existsSync(path.join(publish, forbidden)), 'Excluded from static publication: ' + forbidden);
console.log('Netlify static release ready: site, 51 engineering tools, VoltSim, team and complete VoltGame. PHP and development sources excluded.');
