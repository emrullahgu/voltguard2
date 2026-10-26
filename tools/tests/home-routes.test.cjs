'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const resolve=require('../../js/home-routes.js');
test('Bookmarked homepage sections open their new topic with the query intact',()=>{
  for(const [hash,expected] of [['#hakkimizda','/hakkimizda.html#hakkimizda'],['#projeler','/projeler.html#projeler'],['#referanslar','/projeler.html#referanslar'],['#haberler','/haberler.html#haberler'],['#emi-demo','/teknik-kaynaklar.html#emi-demo'],['#iletisim','/iletisim.html#iletisim']]){
    assert.equal(resolve('/','',hash),expected);
    assert.equal(resolve('/index.html','?kaynak=eski',hash),expected.replace('#','?kaynak=eski#'));
  }
});
test('Old service quote links retain preselection even without a fragment',()=>{
  assert.equal(resolve('/','?hizmet=trafo-bakimi',''),'\/iletisim.html?hizmet=trafo-bakimi#iletisim');
  assert.equal(resolve('/','?hizmet=trafo-bakimi','#iletisim'),'/iletisim.html?hizmet=trafo-bakimi#iletisim');
});
test('Local homepage navigation and other pages are never redirected',()=>{
  for(const hash of ['','#hizmetler','#anasayfa','#hizli-iletisim','#main','#unknown','#constructor','#__proto__','#%E0%A4%A','#https://example.invalid'])assert.equal(resolve('/','',hash),null,hash);
  assert.equal(resolve('/iletisim.html','?hizmet=trafo-bakimi','#iletisim'),null);
  assert.equal(resolve('/hakkimizda.html','','#hakkimizda'),null);
});
