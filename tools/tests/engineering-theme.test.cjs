'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scopeCss, scopeSelector, splitSelectors } = require('../engineering/scope-css.cjs');
const { rewriteArchiveReferences } = require('../engineering/scripts/make-download.cjs');
const workspace = '#vg-tool-workspace';
const prefix = ':where(' + workspace + ')';

test('Legacy selectors are isolated while nested selector lists keep their meaning', () => {
  const css = '.panel,button:is(.primary,.secondary),input:not([type="radio"],[type="checkbox"]){color:red}';
  assert.equal(scopeCss(css), prefix + ' .panel,' + prefix + ' button:is(.primary,.secondary),' + prefix + ' input:not([type="radio"],[type="checkbox"]){color:red}');
  assert.deepEqual(splitSelectors('a[data-label="a,b"],:is(.a,.b),:not([x=","])'), ['a[data-label="a,b"]', ':is(.a,.b)', ':not([x=","])']);
  assert.equal(scopeSelector(' /* source, attribution */ .wrap > h2 '), ' /* source, attribution */ ' + prefix + ' .wrap > h2 ');
});

test('Native root styles become workspace styles and real body print states survive', () => {
  assert.equal(scopeCss(':root{--paper:#fff}html,body{margin:0}'), workspace + '{--paper:#fff}' + workspace + ',' + workspace + '{margin:0}');
  assert.equal(scopeSelector(':root:not([data-theme="light"])'), workspace + ':not([data-theme="light"])');
  assert.equal(scopeSelector('html body .panel'), workspace + ' .panel');
  assert.equal(scopeSelector('html > body.pt-print .panel'), 'body.pt-print ' + prefix + ' .panel');
  assert.equal(scopeSelector('body.yazdir-tum .page'), 'body.yazdir-tum ' + prefix + ' .page');
  assert.equal(scopeSelector('body.pt-print'), 'body.pt-print ' + prefix);
  assert.equal(scopeSelector('body > *:not(#printArea)'), workspace + ' > *:not(#printArea)');
});

test('Nested responsive and print groups recurse without touching declaration values', () => {
  const css = '@media print{@supports(display:grid){@container (width > 20px){@layer legacy{body>*:not(#printArea){display:none}.cell{content:"brace } {, quote \\\"";background:url("data:image/svg+xml,<svg>{}</svg>")}}}}@page{size:A4;margin:8mm}}';
  const scoped = scopeCss(css);
  assert.ok(scoped.includes(workspace + '>*:not(#printArea){display:none}'));
  assert.ok(scoped.includes(prefix + ' .cell{content:"brace } {, quote \\\"";background:url("data:image/svg+xml,<svg>{}</svg>")}'));
  assert.ok(scoped.includes('@page{size:A4;margin:8mm}'));
  assert.equal(scopeCss('@layer one,two;@import url("print,{x}.css");.x{content:"x,y"}'), '@layer one,two;@import url("print,{x}.css");' + prefix + ' .x{content:"x,y"}');
});

test('Animation frames, fonts and CSS comments remain intact', () => {
  const definitions = '@keyframes pulse{0%,50%{opacity:0}to{opacity:1}}@-webkit-keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}@font-face{font-family:"A {, B}";src:url("../font.woff2")}';
  assert.equal(scopeCss(definitions), definitions);
  assert.equal(scopeCss('/* } { */.x{--shape:{left:1;right:2};content:"}\\\"{"}'), '/* } { */' + prefix + ' .x{--shape:{left:1;right:2};content:"}\\\"{"}');
  assert.throws(() => scopeCss('.x{color:red'), /Unclosed CSS block/);
});

test('Every native inline style parses with isolated workspace selectors', () => {
  const dir = path.resolve(__dirname, '../engineering/src/tools');
  let count = 0;
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, file), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      assert.doesNotThrow(() => scopeCss(match[1]), file);
      count++;
    }
  }
  assert.ok(count >= 51, 'All calculator styles were exercised');
});

test('Offline archives keep the shared site shell assets and integrated routes local', () => {
  const html = '<link rel="stylesheet" href="/css/style.css?v=1"><script src="/js/main.js" defer></script><a href="/araclar/#araclar">Araçlar</a><a href="/araclar/ag-gerilim-dusumu/">AG</a><a href="../yontem/">Yöntem</a><a href="/bilgi-bankasi.html">Bilgi</a><a href="/">Ana sayfa</a><style>.icon{src:url(/fonts/outfit.woff2)}</style>';
  const output = rewriteArchiveReferences(html, 'ag-gerilim-dusumu/index.html');
  assert.match(output, /href="\.\.\/assets\/host\/css\/style\.css\?v=1"/);
  assert.match(output, /src="\.\.\/assets\/host\/js\/main\.js"/);
  assert.match(output, /href="\.\.\/index\.html#araclar"/);
  assert.match(output, /href="index\.html"/);
  assert.match(output, /href="\.\.\/yontem\/index\.html"/);
  assert.match(output, /href="https:\/\/voltguard\.com\.tr\/bilgi-bankasi\.html"/);
  assert.match(output, /href="https:\/\/voltguard\.com\.tr\/"/);
  assert.match(output, /url\(\.\.\/assets\/host\/fonts\/outfit\.woff2\)/);
  assert.equal(rewriteArchiveReferences('<a href="/araclar/">Araçlar</a>', 'index.html'), '<a href="index.html">Araçlar</a>');
});

test('Packaged CSS resolves root font and import paths from its own archive location', () => {
  const css = '@import "/css/fonts.css";@font-face{src:url("/fonts/outfit.woff2")}a{background:url(data:image/svg+xml;base64,ABC)}';
  assert.equal(rewriteArchiveReferences(css, 'assets/host/css/style.css'), '@import "fonts.css";@font-face{src:url("../fonts/outfit.woff2")}a{background:url(data:image/svg+xml;base64,ABC)}');
});
