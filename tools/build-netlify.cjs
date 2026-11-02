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
  'hesaplama', 'hizmetler', 'js', 'mm', 'public', 'sor', 'voltsim', 'volthaber'];
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
for (const file of ['ekibimiz.html', 'voltgame.html', 'public/voltguard-logo-koyu.webp', 'araclar/index.html']) {
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
  recursive:true, filter:source => !fs.lstatSync(source).isSymbolicLink() && !source.endsWith('.php'),
});
for (const file of rootFiles.concat(employeePages)) {
  const target = path.join(publish, file);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.copyFileSync(path.join(root, file), target);
}
// This host has no PHP runtime. Keep the public workshop explicit about its
// dependencies and link private tools to the PHP host, never a blocked local URL.
const dataCenter=path.join(publish,'araclar/canli-veri-merkezi/index.html');
if(fs.existsSync(dataCenter)) {
  let html=fs.readFileSync(dataCenter,'utf8');
  const intro='<div class="intro">';
  assert.ok(html.includes(intro),'Live-data workshop introduction exists.');
  html=html.replace(intro,intro+'<p id="vg-data-host-notice" role="status"><strong>Netlify yayını:</strong> Bu adresteki sürüm statiktir. Canlı veri sorguları ve çalışan araçları PHP sunucusunda çalışır; cPanel yayını tamamlandığında <a href="https://voltguard.com.tr/araclar/canli-veri-merkezi/">canlı veri merkezinden</a> kullanılabilir. Bu sayfada sorgu düğmeleri kapalıdır.</p>');
  html=html.replace(/href="\/calisan\/uygulama\//g,'href="https://voltguard.com.tr/calisan/uygulama/');
  html=html.replace(/<form id="(?:addressForm|weatherForm|currencyForm)"[\s\S]*?<\/form>/g,form=>form.replace(/<button\b/g,'<button disabled'));
  html=html.replace(/<button id="(?:cryptoButton|statusButton)"/g,button=>button+' disabled');
  fs.writeFileSync(dataCenter,html);
}
for (const forbidden of ['api', 'tools', 'VoltGame', 'SahaTakip-main', 'vesikalar', 'voltguardekleyelim', '.qa',
  'calisan', 'hesap', 'contact.php']) assert.ok(!fs.existsSync(path.join(publish, forbidden)), 'Excluded from static publication: ' + forbidden);
const tools=JSON.parse(fs.readFileSync(path.join(root,'araclar/tool-catalog.json'),'utf8'));
console.log('Netlify static release ready: site, '+(Array.isArray(tools)?tools.length:require('./engineering/src/catalog.cjs').length)+' engineering tools, VoltSim, team and complete VoltGame. PHP and development sources excluded.');
