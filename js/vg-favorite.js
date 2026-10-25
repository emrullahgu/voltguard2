/*!
 * VoltGuard – vg-favorite.js
 * Favori yıldızı (VoltSim ve diğer araç sayfaları). Hesap araçlarında (hesaplama/*) aynı işlev
 * js/voltguard-tools.js araç çubuğundaki "Favorilere ekle" düğmesindedir; bu betik orada bir şey yapmaz.
 *
 * Kayıt: VG.Auth.toggleFavorite — giriş yapılmamışsa bu tarayıcıda (localStorage "vg_guest_favorites_v1"),
 * giriş yapılmışsa üye hesabındaki "favorites" koleksiyonuna (api/auth.php data_put); girişte misafir favorileri hesaba aktarılır.
 * Liste: /hesap/favoriler.html. VG.Auth yoksa /js/voltguard-auth.js isteğe bağlı yüklenir (misafirde ağ isteği atmaz).
 */
(function (w, d) {
  'use strict';
  if (w.__vgFavStar) return;
  w.__vgFavStar = 1;
  if (d.querySelector('.vg-toolbar, [data-vg-action="fav"]')) return;  // hesap aracı: araç çubuğu zaten var

  function slug() {
    var m = w.location.pathname.match(/^\/voltsim\/([a-z0-9-]+)\/?(?:index\.html)?$/);
    if (m) return 'voltsim-' + m[1];
    m = w.location.pathname.match(/^\/araclar\/([a-z0-9-]+)\/?(?:index\.html)?$/);
    return m ? 'arac-' + m[1] : '';
  }
  var id = slug();
  var host = d.querySelector('[data-vg-fav-target]') || d.querySelector('.vs-head > div') || d.querySelector('main h1');
  if (!id || !host) return;

  function name() {
    var h1 = d.querySelector('main h1');
    return (h1 ? h1.textContent : d.title).replace(/\s+/g, ' ').trim().slice(0, 200);
  }
  function url() {
    var c = d.querySelector('link[rel="canonical"]');
    return c && c.href ? c.href : w.location.origin + w.location.pathname;
  }

  // Sayfa düğmeyi hazır getirdiyse (VoltSim: tools/build-voltsim.cjs, stil css/voltsim.css) yer baştan ayrılmıştır;
  // sonradan eklenen düğme başlığın altındaki her şeyi aşağı iterdi (yerleşim kayması).
  var btn = d.querySelector('[data-vg-fav]'), msg = btn && btn.parentNode.querySelector('.vg-fav-msg');
  if (btn && msg) btn.disabled = false;
  else build();
  function build() {
    if (!d.getElementById('vg-fav-css')) {
      var st = d.createElement('style'); st.id = 'vg-fav-css';
      st.textContent = '.vg-fav{display:inline-flex;align-items:center;gap:.45rem;margin-top:.75rem;font:inherit;font-size:.88rem;font-weight:600;min-height:40px;padding:.45rem .95rem;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#0a1628;cursor:pointer}' +
        '.vg-fav svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2}.vg-fav[aria-pressed="true"]{background:#fef3c7;border-color:#f59e0b;color:#78350f}' +
        '.vg-fav[aria-pressed="true"] svg{fill:#f59e0b;stroke:#b45309}.vg-fav:focus-visible{outline:3px solid rgba(59,130,246,.45);outline-offset:2px}.vg-fav:disabled{opacity:.6;cursor:wait}' +
        '.vg-fav-msg{display:block;font-size:.8rem;color:#475569;margin-top:.35rem;min-height:1em}.vg-fav-msg a{color:#1d4ed8}';
      d.head.appendChild(st);
    }
    btn = d.createElement('button');
    btn.type = 'button'; btn.className = 'vg-fav'; btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg><span>Favorilere ekle</span>';
    msg = d.createElement('span'); msg.className = 'vg-fav-msg'; msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
    if (host.tagName === 'H1') { host.parentNode.insertBefore(btn, host.nextSibling); btn.parentNode.insertBefore(msg, btn.nextSibling); }
    else { host.appendChild(btn); host.appendChild(msg); }
  }

  var authPromise = null;
  function auth() {
    if (w.VG && w.VG.Auth) return Promise.resolve(w.VG.Auth);
    if (authPromise) return authPromise;
    authPromise = new Promise(function (resolve, reject) {
      var s = d.createElement('script');
      s.src = '/js/voltguard-auth.js'; s.async = true;
      s.onload = function () { if (w.VG && w.VG.Auth) resolve(w.VG.Auth); else reject(new Error('auth')); };
      s.onerror = function () { reject(new Error('auth')); };
      d.head.appendChild(s);
    });
    return authPromise;
  }
  function paint(on) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.querySelector('span').textContent = on ? 'Favorilerde' : 'Favorilere ekle';
    btn.setAttribute('aria-label', on ? 'Favorilerden çıkar' : 'Favorilere ekle');
  }
  function sync(a) { try { paint(a.isFavorite(id)); } catch (e) { /* depolama kapalı */ } }

  auth().then(function (a) {
    sync(a);
    d.addEventListener('vg:data', function (e) { if (!e.detail || !e.detail.collection || e.detail.collection === 'favorites') sync(a); });
    d.addEventListener('vg:auth', function () { sync(a); });
    a.ready().then(function (user) { if (user) return a.loadData(['favorites']); }).then(function () { sync(a); }, function () { /* ağ yok */ });
  }, function () { btn.disabled = true; btn.title = 'Favoriler şu anda kullanılamıyor.'; });

  btn.addEventListener('click', function () {
    auth().then(function (a) {
      var on = a.toggleFavorite(id, name(), url());
      paint(on);
      msg.textContent = '';
      if (on && !a.isLoggedIn()) {
        msg.appendChild(d.createTextNode('Bu tarayıcıya kaydedildi. '));
        var l = d.createElement('a'); l.href = a.loginUrl(w.location.pathname); l.textContent = 'Giriş yapın'; msg.appendChild(l);
        msg.appendChild(d.createTextNode(', favorileriniz hesabınıza aktarılsın.'));
      } else {
        msg.textContent = on ? 'Favorilere eklendi.' : 'Favorilerden çıkarıldı.';
      }
    }).catch(function (e) { msg.textContent = (e && e.message && e.message !== 'auth') ? e.message : 'Favori kaydedilemedi.'; });
  });
}(window, document));
