'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../build-home-directory.cjs');
const read = file => fs.readFileSync(path.join(D.ROOT,file),'utf8');
const entries = D.buildCatalogue();
const urls = new Set(entries.map(e=>e.u));

test('homepage catalogue covers every published sitemap URL, including the PDF', () => {
  for (const [,url] of read('sitemap.xml').matchAll(/<loc>https:\/\/voltguard\.com\.tr(\/[^<]*)<\/loc>/g)) {
    assert.ok(urls.has(url), 'Missing published content: '+url);
  }
  assert.equal(urls.size,entries.length,'Every canonical target appears once in the directory');
});

test('all glossary terms, real projects, news and films have direct homepage links', () => {
  for (const term of require('../data/elektrik-terimleri.cjs')) assert.ok(urls.has('/bilgi/elektrik-terimleri-sozlugu.html#'+term.id));
  for (const [file,prefix,minimum] of [['projeler.html','proje-',9],['haberler.html','haber-',15]]) {
    const ids = [...read(file).matchAll(/<article\b[^>]*\bid="([^"]+)"/g)].map(m=>m[1]).filter(id=>id.startsWith(prefix));
    assert.ok(ids.length>=minimum,'Previously published cards remain present; new cards have no fixed upper limit');
    ids.forEach(id=>assert.ok(urls.has('/'+file+'#'+id),'Missing article '+id));
  }
  for (const id of ['voltguard-kimdir','calisanlarimizin-duygulari']) assert.ok(urls.has('/hakkimizda.html#'+id));
});

test('explicit public utilities, downloads and account gateways are covered without private internals', () => {
  D.EXTRA.forEach(([u])=>assert.ok(urls.has(u),u));
  for (const entry of entries) {
    assert.ok(entry.u.startsWith('/')&&!entry.u.startsWith('//'));
    assert.doesNotMatch(entry.u,/^\/(?:api|tools|\.qa)\//);
    assert.doesNotMatch(entry.u,/[?&](?:token|t|csrf|key)=/i);
    if (/^\/(?:hesap|calisan)\//.test(entry.u)) assert.ok(D.EXTRA.some(e=>e[0]===entry.u));
  }
  assert.throws(()=>D.fileFor('https://outside.example/'));
  assert.throws(()=>D.fileFor('//outside.example/'));
});

test('all current public VoltHaber publications appear as canonical article links', () => {
  const snapshot=JSON.parse(read('tools/data/home-directory-volthaber.json'));
  const actual=entries.filter(e=>e.kind==='VoltHaber');
  assert.equal(actual.length,snapshot.entries.length);
  for (const item of snapshot.entries) {
    assert.ok(urls.has(item.u),item.u);
    assert.equal(item.c,'haberler');
    assert.match(item.u,/^\/volthaber\/[a-z0-9-]+\/$/);
  }
});

test('every native directory link is generated as an escaped static anchor and category images exist', () => {
  const html=D.renderDirectory(entries);
  assert.equal((html.match(/data-directory-entry /g)||[]).length,entries.length);
  assert.deepEqual([...html.matchAll(/<a href="([^"]+)"/g)].map(m=>m[1]).sort(),entries.map(e=>e.u).sort(),
    'Visual category cards retain every canonical content destination');
  assert.equal((html.match(/<details\b/g)||[]).length,D.CATEGORIES.length);
  assert.doesNotMatch(html,/<details\b[^>]*\sopen(?:\s|>)/);
  assert.match(html,/id="homeDirectoryControls" hidden/);
  const images=[...html.matchAll(/<img\b[^>]*>/g)].map(m=>m[0]);
  assert.equal(images.length,D.CATEGORIES.length);
  for (const category of D.CATEGORIES) {
    assert.match(category.image,/^\/public\/[^?#]+\.(?:webp|avif|png|jpe?g)$/i);
    assert.ok(fs.statSync(D.fileFor(category.image)).size>0,category.image+' is a bundled image');
    assert.ok(images.some(tag=>(tag.match(/\bsrc="([^"]+)"/)||[])[1]===category.image),category.id+' uses its bundled image');
  }
  const malicious=D.renderDirectory([{u:'/arama.html',t:'<img onerror="bad">',c:'kurumsal',kind:'Sayfa',keywords:'" onclick="bad'}]);
  assert.equal((malicious.match(/<img\b/g)||[]).length,1,'Only the legitimate category image is emitted');
  assert.ok(malicious.includes('&lt;img onerror=&quot;bad&quot;&gt;'));
  assert.doesNotMatch(malicious,/\s(?:onerror|onclick)="bad/);
});

test('homepage directory stays fresh and does not contaminate the homepage search record', () => {
  assert.doesNotThrow(()=>D.updateHome(true));
  const scope={window:{}};
  vm.runInNewContext(read('js/search-index.js'),scope,{timeout:1000});
  const home=scope.window.VG_SEARCH_INDEX.find(e=>e.u==='/');
  assert.ok(home);
  // This tool title exists only in the generated catalogue, not the editorial homepage.
  assert.ok(entries.some(e=>/Clarke|Park/i.test(e.t)));
  assert.doesNotMatch((home.k||'')+' '+(home.b||''),/Clarke|Park|homeDirectory/);
});
