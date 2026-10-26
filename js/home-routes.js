/* Preserve bookmarked homepage anchors after moving details to topic pages. */
(function (factory) {
  var resolve = factory();
  if (typeof module === 'object' && module.exports) { module.exports = resolve; return; }
  function redirect() { var next = resolve(location.pathname, location.search, location.hash); if (next) location.replace(next); }
  redirect();
  window.addEventListener('hashchange', redirect);
}(function () {
  var pages = {
    hakkimizda:'/hakkimizda.html#hakkimizda', surec:'/hakkimizda.html#surec',
    'neden-biz':'/hakkimizda.html#neden-biz', 'tanitim-videosu':'/hakkimizda.html#tanitim-videosu',
    certsTitle:'/hakkimizda.html#certsTitle', projeler:'/projeler.html#projeler',
    referanslar:'/projeler.html#referanslar', haberler:'/haberler.html#haberler',
    iletisim:'/iletisim.html#iletisim', sss:'/iletisim.html#sss',
    teknik:'/teknik-kaynaklar.html#teknik', 'emi-demo':'/teknik-kaynaklar.html#emi-demo',
    'vg-engage-title':'/teknik-kaynaklar.html#vg-engage-title', downtimeCalc:'/teknik-kaynaklar.html#downtimeCalc',
    downtimeTitle:'/teknik-kaynaklar.html#downtimeTitle', voltsim:'/voltsim/',
    fabrikalar:'/fabrika-cozumleri.html', katalog:'/hizmetler/#katalog'
  };
  return function (pathname, search, hash) {
    if (pathname !== '/' && pathname !== '/index.html') return null;
    var key; try { key = decodeURIComponent(String(hash || '').replace(/^#/, '')); } catch (_) { return null; }
    var next = Object.prototype.hasOwnProperty.call(pages, key) ? pages[key] : null;
    if (!next && /(?:^|[?&])hizmet=/.test(search || '')) next = pages.iletisim;
    if (!next) return null;
    var parts = next.split('#');
    return parts[0] + (search || '') + (parts[1] ? '#' + parts[1] : '');
  };
}));
