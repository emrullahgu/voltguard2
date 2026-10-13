/* =====================================================
   VoltGuard Auth — sunucu tabanlı üyelik istemcisi
   ---------------------------------------------------
   Hesaplar sunucuda (api/auth.php) tutulur; oturum HttpOnly "VGSESS" çerezindedir, JS şifre veya oturum
   kimliği görmez. Durum değiştiren her istek X-VG-CSRF başlığıyla gönderilir.

   - Giriş yapmamış ziyaretçi: favoriler ve kayıtlı hesaplamalar bu tarayıcıda (localStorage) tutulur;
     giriş/kayıt sayfasındaki onay kutusu işaretliyse hesaba aktarılır (birleştirilir).
   - Oturum sunucuda sona ererse gönderilemeyen değişiklikler kullanıcı kimliğiyle sekme belleğine alınır ve
     yalnızca AYNI kullanıcı yeniden giriş yaptığında gönderilir (başka hesaba karışmaz).
   - Giriş yapmış kullanıcı: değişiklikler hemen ekrana yansır, sunucuya gecikmeli (debounce) gönderilir.
     Bekleyen değişiklikler sekme oturumunda (sessionStorage) saklanır; sayfa kapanırken keepalive ile yollanır.
   - Eski sürümün yalnızca tarayıcıda tutulan hesap verileri (vg_users_v1 ...) yeni hesaba taşınabilir;
     şifre özetleri asla taşınmaz.

   Genel API: window.VG.Auth (aşağıda "Public API"). Olaylar (document üzerinde):
     'vg:auth'  { user }                  oturum durumu değişti / ilk kontrol bitti
     'vg:data'  { collection }            bir koleksiyon değişti (yerel veya sunucudan)
     'vg:sync'  { status, message }       senkron durumu: idle | pending | saving | saved | offline | error
   ===================================================== */
(function (global) {
  'use strict';

  var API = '/api/auth.php';
  var API_MARK = 'vg-auth/1';
  var COLLS = ['favorites', 'history', 'projects', 'documents'];
  var GUEST_COLLS = { favorites: 1, history: 1 };
  var LIMITS = { favorites: 200, history: 500, projects: 200, documents: 500 };
  var ME_TTL = 5 * 60 * 1000;     // içerik sayfalarında oturum bilgisi en fazla 5 dk önbellekten kullanılır
  var DATA_TTL = 5 * 60 * 1000;
  var SYNC_DELAY = 700;
  var RESCUE_TTL = 24 * 60 * 60 * 1000;   // kurtarılan değişiklikler en fazla 24 saat saklanır

  var KEYS = {
    hint: 'vg_auth_hint_v1',             // localStorage: yalnızca "bu tarayıcıda oturum açıldı" işareti (kişisel veri yok)
    cache: 'vg_acct_cache_v1',           // sessionStorage: sekmeye özel hesap verisi önbelleği + bekleyen değişiklikler
    flash: 'vg_flash_v1',                // sessionStorage: yönlendirme sonrası gösterilecek tek seferlik mesaj
    rescue: 'vg_rescue_v1',              // sessionStorage: oturum sona erdiğinde kaydedilemeyen değişiklikler (kullanıcı kimliğine bağlı)
    guestFavorites: 'vg_guest_favorites_v1',
    guestHistory: 'vg_guest_history_v1',
    legacyState: 'vg_legacy_state_v1',   // localStorage: 'migrated' | 'discarded' | 'dismissed'
    // Eski (yalnızca tarayıcıda saklanan) üyelik sürümünün anahtarları
    users: 'vg_users_v1',
    session: 'vg_session_v1',
    history: 'vg_history_v1',
    favorites: 'vg_favorites_v1',
    projects: 'vg_projects_v1',
    documents: 'vg_documents_v1'
  };
  var LEGACY_KEYS = [KEYS.users, KEYS.session, KEYS.history, KEYS.favorites, KEYS.projects, KEYS.documents];

  var MSG = {
    down: 'Hesap sistemine şu anda ulaşılamıyor. İnternet bağlantınızı kontrol edip birkaç dakika sonra tekrar deneyin.',
    login: 'Bu işlem için giriş yapmanız gerekiyor.',
    expired: 'Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.',
    generic: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
  };

  /* ---------------------------------------------------------------- depolama yardımcıları */
  function store(kind) {
    try { return kind === 'session' ? global.sessionStorage : global.localStorage; } catch (e) { return null; }
  }
  function read(key, fallback, kind) {
    var s = store(kind);
    if (!s) return fallback;
    try { var raw = s.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function write(key, value, kind) {
    var s = store(kind);
    if (!s) return false;
    try { s.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function remove(key, kind) {
    var s = store(kind);
    if (!s) return;
    try { s.removeItem(key); } catch (e) { /* depolama kapalı */ }
  }

  function nowIso() { return new Date().toISOString(); }
  function newId(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clip(v, max) {
    if (typeof v === 'number' && isFinite(v)) v = String(v);
    return typeof v === 'string' ? v.slice(0, max) : '';
  }
  function validIso(v) {
    var d = typeof v === 'string' ? new Date(v) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString() : nowIso();
  }
  function plainArray(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }
  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (e) { /* eski tarayıcı */ }
  }
  function isHesapPage() { return /\/hesap\//.test(location.pathname); }

  /* ---------------------------------------------------------------- bağlantı / yönlendirme güvenliği */
  function isHttpUrl(url) {
    try {
      var u = new URL(String(url));
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) { return false; }
  }

  // href'e konulması güvenliyse URL'yi aynen döndürür (http/https, file:// önizlemede file:), değilse ''.
  // javascript:, data:, vbscript: vb. engellenir.
  function safeHref(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      var u = new URL(url, document.baseURI);
      if (u.protocol === 'http:' || u.protocol === 'https:') return url;
      if (u.protocol === 'file:' && location.protocol === 'file:') return url;
    } catch (e) { /* ayrıştırılamadı */ }
    return '';
  }

  // Giriş sonrası dönüş adresi (?next=). Yalnızca aynı kökendeki sayfalar (temiz dizin adresi veya .html) kabul
  // edilir, sonuç yol+sorgu+çapa olarak döner. Başka köken, // veya \ hileleri, javascript:/data:, giriş / kayıt /
  // şifre sıfırlama sayfalarının kendisi '' döndürür; çağıran varsayılan sayfaya düşer.
  function safeNext(raw) {
    if (typeof raw !== 'string' || !raw) return '';
    if (/[\u0000-\u001f\u007f\\]/.test(raw)) return '';
    try {
      var u = new URL(raw, location.href);
      if (u.protocol !== location.protocol || u.host !== location.host) return '';
      if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return '';
      if (/\/hesap\/(giris|kayit|sifre-sifirla)\.html$/.test(u.pathname)) return '';
      if (!/(\/|\.html)$/.test(u.pathname)) return '';
      return u.pathname + u.search + u.hash;
    } catch (e) { return ''; }
  }

  function pathPrefix() {
    // Sitenin köküne ulaşan önek. Bilinen alt klasörler adıyla eşleşir (file:// için de çalışır) ve belge temel
    // adresine göre çözülür; <base href="/"> olan sayfalar (temiz /dir/slug/ adresli araçlar) doğru biçimde '' alır.
    var subfolders = { hesaplama: 1, bilgi: 1, akademi: 1, sor: 1, hesap: 1, mm: 1 };
    var baseDir;
    try { baseDir = new URL('.', document.baseURI).pathname; }
    catch (e) { baseDir = location.pathname.replace(/[^/]*$/, ''); }
    var segs = baseDir.replace(/\\/g, '/').split('/').filter(Boolean);
    if (subfolders[segs[segs.length - 1]]) return '../';
    if (!document.querySelector('base[href]') && /\/$/.test(location.pathname) &&
        segs.length >= 2 && subfolders[segs[segs.length - 2]]) return '../../';
    return '';
  }

  function rootUrl(path) {
    // http(s) üzerinde kök-mutlak adres; file:// önizlemede göreli önek.
    return (/^https?:$/.test(location.protocol) ? '/' : pathPrefix()) + path;
  }
  function loginUrl(next) {
    var n = safeNext(next || (location.pathname + location.search));
    return rootUrl('hesap/giris.html') + (n ? '?next=' + encodeURIComponent(n) : '');
  }

  /* ---------------------------------------------------------------- durum */
  var state = {
    user: null,
    csrf: '',
    checked: false,      // sunucu ile oturum kontrolü yapıldı mı
    apiDown: false,
    expired: false,
    meAt: 0,
    hintAt: 0
  };
  var srv = {};        // koleksiyon -> { items, rev, at }  (sunucudaki son bilinen hâl)
  var pending = {};    // koleksiyon -> [op]               (henüz sunucuya ulaşmamış değişiklikler)
  var viewCache = {};
  COLLS.forEach(function (c) { srv[c] = null; pending[c] = []; });
  var sync = { status: 'idle', message: '', at: 0, retry: 0 };

  function sanitizeUser(u) {
    if (!u || typeof u !== 'object' || !u.id) return null;
    return {
      id: String(u.id),
      name: String(u.name || ''),
      email: String(u.email || ''),
      company: String(u.company || ''),
      phone: String(u.phone || ''),
      createdAt: u.createdAt || null,
      lastLoginAt: u.lastLoginAt || null
    };
  }

  function getHint() { var h = read(KEYS.hint, null); return h && h.at ? h : null; }
  function setHint() { var h = { at: Date.now() }; write(KEYS.hint, h); state.hintAt = h.at; return h; }
  function clearHint() { remove(KEYS.hint); state.hintAt = 0; }

  function persistCache() {
    if (!state.user) { remove(KEYS.cache, 'session'); return; }
    write(KEYS.cache, {
      v: 1, hintAt: state.hintAt, uid: state.user.id, user: state.user, csrf: state.csrf,
      meAt: state.meAt, srv: srv, pending: pending
    }, 'session');
  }

  function loadCache() {
    var hint = getHint();
    if (!hint) return false;
    state.hintAt = hint.at;
    var c = read(KEYS.cache, null, 'session');
    if (!c || c.v !== 1 || c.hintAt !== hint.at || !c.user) return false;
    state.user = sanitizeUser(c.user);
    if (!state.user) return false;
    state.csrf = typeof c.csrf === 'string' ? c.csrf : '';
    state.meAt = +c.meAt || 0;
    COLLS.forEach(function (k) {
      var s = c.srv && c.srv[k];
      srv[k] = s && Array.isArray(s.items) ? { items: s.items, rev: +s.rev || 0, at: +s.at || 0 } : null;
      pending[k] = c.pending && Array.isArray(c.pending[k]) ? c.pending[k].slice(0, 1000) : [];
    });
    viewCache = {};
    return true;
  }

  function resetAccountData() {
    COLLS.forEach(function (c) { srv[c] = null; pending[c] = []; });
    viewCache = {};
  }

  function setUser(u, opts) {
    var before = state.user ? state.user.id : null;
    state.user = sanitizeUser(u);
    if (state.user) {
      if (!getHint()) setHint(); else state.hintAt = getHint().at;
      if (before && before !== state.user.id) resetAccountData();
    } else {
      clearHint();
      resetAccountData();
      remove(KEYS.cache, 'session');
    }
    persistCache();
    refreshHeader();
    if (!opts || !opts.silent) emit('vg:auth', { user: state.user });
  }

  /* ---------------------------------------------------------------- API istemcisi */
  function ApiError(code, message, status, data) {
    var e = new Error(message || MSG.generic);
    e.name = 'ApiError';
    e.code = code || 'error';
    e.status = status || 0;
    e.fields = data && data.fields ? data.fields : null;
    e.retryAfter = data && data.retryAfter ? +data.retryAfter : 0;
    e.data = data || null;
    return e;
  }

  function fetchJson(action, opts) {
    var method = opts.method || 'GET';
    var url = API + '?action=' + encodeURIComponent(action) + (opts.query || '');
    var headers = { Accept: 'application/json' };
    var init = { method: method, credentials: 'same-origin', cache: 'no-store', headers: headers };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      headers['X-VG-CSRF'] = state.csrf || '';
      init.body = JSON.stringify(opts.body || {});
      if (opts.keepalive && init.body.length < 60000) init.keepalive = true;
    }
    var ctrl = typeof AbortController === 'function' && !init.keepalive ? new AbortController() : null;
    var timer = 0;
    if (ctrl) { init.signal = ctrl.signal; timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 20000); }
    return fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        clearTimeout(timer);
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        // PHP çalışmayan statik önizleme (kaynak metin, 404 sayfası) veya ara sunucu hatası: API'ye ulaşılamadı.
        if (!json || json.api !== API_MARK) throw ApiError('unreachable', MSG.down, res.status);
        if (typeof json.csrf === 'string' && json.csrf) state.csrf = json.csrf;
        if (!res.ok || json.ok === false) throw ApiError(json.error, json.message, res.status, json);
        state.apiDown = false;
        return json;
      });
    }, function (err) {
      clearTimeout(timer);
      throw ApiError('unreachable', MSG.down, 0);
    }).catch(function (e) {
      // Gövde okunurken kesilen bağlantı / zaman aşımı gibi beklenmeyen hatalar da "ulaşılamıyor" sayılır.
      if (!e || e.name !== 'ApiError') e = ApiError('unreachable', MSG.down, 0);
      if (e.code === 'unreachable') state.apiDown = true;
      throw e;
    });
  }

  // Dışa aktarma gibi JSON olmayan biçimde dönebilen yanıtlarda API işaretini taşımayan geçerli JSON kabul edilir.
  function fetchExport() {
    return fetch(API + '?action=export', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (res) {
        return res.text().then(function (text) {
          var json = null;
          try { json = JSON.parse(text); } catch (e) { json = null; }
          if (!json) throw ApiError('unreachable', MSG.down, res.status);
          if (json.api === API_MARK && json.ok === false) throw ApiError(json.error, json.message, res.status, json);
          if (json.format !== 'voltguard-account-export/1') throw ApiError('unreachable', MSG.down, res.status);
          var cd = res.headers.get('Content-Disposition') || '';
          var m = cd.match(/filename="?([^";]+)"?/);
          return { text: text, data: json, filename: m ? m[1] : 'voltguard-hesap-verilerim.json' };
        });
      }, function () { throw ApiError('unreachable', MSG.down, 0); })
      .catch(function (e) {
        if (!e || e.name !== 'ApiError') e = ApiError('unreachable', MSG.down, 0);
        if (e.status === 401) handleUnauthorized(e);
        throw e;
      });
  }

  // CSRF jetonunu sunucudan yeniler. İstek bir kullanıcı adına (uid) hazırlandıysa ve sunucudaki oturum artık o
  // kullanıcıya ait değilse (süresi doldu, çerez silindi, başka sekmede başka hesapla giriş yapıldı) istek yeni
  // oturuma GÖNDERİLMEZ: bekleyen değişiklikler önce o kullanıcı adına saklanır, ardından 401 ile reddedilir.
  function refreshCsrf(uid) {
    return fetchJson('me', {}).then(function (j) {
      var now = j && j.user && j.user.id ? String(j.user.id) : null;
      if (uid && now !== uid) {
        rescuePending(uid);
        applyMe(j);
        throw ApiError('unauthorized', MSG.expired, 401, { switched: !!now });
      }
      applyMe(j);
      return state.csrf;
    });
  }
  function ensureCsrf(uid) {
    return state.csrf ? Promise.resolve(state.csrf) : refreshCsrf(uid);
  }

  // POST: CSRF jetonu yoksa önce alınır; jeton bayatsa (başka sekmede oturum değişti) bir kez yenilenip tekrar denenir.
  // opts.anon: hesaba bağlı olmayan işlemler (giriş, kayıt, çıkış, şifre sıfırlama) için oturum sahibi denetlenmez.
  function post(action, body, opts) {
    opts = opts || {};
    var uid = !opts.anon && state.user ? state.user.id : null;
    return ensureCsrf(uid).then(function () {
      return fetchJson(action, { method: 'POST', body: body, keepalive: opts.keepalive, timeout: opts.timeout });
    }).catch(function (e) {
      if (e && e.code === 'csrf' && !opts.retried) {
        state.csrf = '';
        return refreshCsrf(uid).then(function () {
          return post(action, body, { keepalive: opts.keepalive, timeout: opts.timeout, anon: opts.anon, retried: true });
        });
      }
      throw e;
    });
  }

  function applyMe(j) {
    state.checked = true;
    state.apiDown = false;
    state.expired = !!j.expired;
    state.meAt = Date.now();
    var had = state.user ? state.user.id : null;
    var now = sanitizeUser(j.user);
    if ((had || null) !== (now ? now.id : null)) {
      setUser(now);
    } else {
      state.user = now;
      if (now) { if (!getHint()) setHint(); persistCache(); }
      refreshHeader();
    }
  }

  /* ---------------------------------------------------------------- oturum kontrolü */
  var mePromise = null;
  // Sunucudan oturumu doğrular. API'ye ulaşılamazsa ApiError('unreachable') ile reddedilir.
  function session(opts) {
    opts = opts || {};
    if (!opts.force && state.checked && (Date.now() - state.meAt) < ME_TTL) return Promise.resolve(state.user);
    if (mePromise && !opts.force) return mePromise;
    mePromise = fetchJson('me', {}).then(function (j) {
      applyMe(j);
      mePromise = null;
      emit('vg:auth', { user: state.user, checked: true });
      if (state.user) maybeFlushPending();
      return state.user;
    }, function (e) {
      mePromise = null;
      state.checked = true;
      emit('vg:auth', { user: state.user, checked: true, error: e.code });
      throw e;
    });
    return mePromise;
  }
  // Hiç reddedilmeyen sürüm (bileşenler için): hata durumunda bilinen kullanıcıyı (veya null) döndürür.
  function ready() {
    if (!getHint() && !isHesapPage() && !state.user) { state.checked = true; return Promise.resolve(null); }
    return session().catch(function () { return state.user; });
  }

  // Korumalı sayfa: oturum yoksa giriş sayfasına (dönüş adresiyle) yönlendirir. API'ye ulaşılamazsa reddedilir.
  function requireAuth() {
    return session({ force: true }).then(function (user) {
      if (user) return user;
      if (state.expired) setFlash('info', MSG.expired);
      location.replace(loginUrl(location.pathname + location.search));
      return new Promise(function () { /* yönlendirme sürerken sayfa kodu durur */ });
    });
  }

  /* ---------------------------------------------------------------- başlık (header) */
  var shellWaiting = false;
  function refreshShell() {
    if (global.VGShell && typeof global.VGShell.refreshCurrent === 'function') {
      global.VGShell.refreshCurrent();
    } else if (!shellWaiting) {
      shellWaiting = true;
      document.addEventListener('vg:shell-ready', function () {
        shellWaiting = false;
        if (global.VGShell) global.VGShell.refreshCurrent();
      }, { once: true });
    }
  }
  // Başlıktaki iki [data-vg-account] bağlantısı: giriş yapılmışsa "Hesabım" (/hesap/panel.html), değilse "Giriş Yap".
  // Kişi simgesi CSS ::before ile çizilir; içeriğe <i> eklenmez.
  function refreshHeader() {
    if (!document.body) return;
    var logged = !!state.user || (!state.checked && !!getHint());
    var links = document.querySelectorAll('[data-vg-account]');
    if (!links.length) return;
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = logged ? '/hesap/panel.html' : '/hesap/giris.html';
      var text = logged ? 'Hesabım' : 'Üye Girişi';
      if (a.getAttribute('href') !== href) a.setAttribute('href', href);
      if (a.textContent !== text) a.textContent = text;
      a.setAttribute('data-vg-state', logged ? 'in' : 'out');
      if (logged && state.user && state.user.name) a.setAttribute('title', 'Hesabım: ' + state.user.name);
      else a.removeAttribute('title');
    }
    refreshShell();
  }
  // Eski genel API uyumluluğu (yeni başlıkta tek iş: hesap bağlantılarını güncellemek).
  var decorateNav = refreshHeader;

  /* ---------------------------------------------------------------- tek seferlik mesajlar */
  // append: true ise bekleyen mesajın sonuna eklenir; tür, ikisinden daha önemli olanı olur (error > warning > info > success).
  function setFlash(kind, text, append) {
    text = String(text || '');
    var prev = append ? read(KEYS.flash, null, 'session') : null;
    if (prev && prev.text && (Date.now() - (+prev.at || 0)) < 10 * 60 * 1000) {
      var rank = { success: 0, info: 1, warning: 2, error: 3 };
      if ((rank[prev.kind] || 0) > (rank[kind] || 0)) kind = prev.kind;
      text = prev.text + ' ' + text;
    }
    write(KEYS.flash, { kind: kind, text: text, at: Date.now() }, 'session');
  }
  function takeFlash() {
    var f = read(KEYS.flash, null, 'session');
    remove(KEYS.flash, 'session');
    return f && f.text && (Date.now() - (+f.at || 0)) < 10 * 60 * 1000 ? { kind: f.kind || 'info', text: f.text } : null;
  }

  /* ---------------------------------------------------------------- kayıt temizleme (sunucu kurallarının aynası) */
  var ID_RE = { history: /^h_[a-z0-9]{4,40}$/, projects: /^p_[a-z0-9]{4,40}$/, documents: /^d_[a-z0-9]{4,40}$/ };
  var SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
  function toolUrlOk(u) {
    u = clip(u, 500).trim();
    if (!u) return '';
    if (/^\/(?![\/\\])[^\s<>"'`]*$/.test(u)) return u;
    return /^https?:\/\/[^\s\/?#<>"'`\\@]+([\/?#][^\s<>"'`]*)?$/i.test(u) ? u : '';
  }
  function cleanItem(coll, x) {
    if (!x || typeof x !== 'object') return null;
    if (coll === 'favorites') {
      var slug = clip(x.toolSlug || x.id, 100);
      if (!SLUG_RE.test(slug)) return null;
      return { id: slug, toolSlug: slug, toolName: clip(x.toolName, 200).trim() || slug, toolUrl: toolUrlOk(x.toolUrl), addedAt: validIso(x.addedAt) };
    }
    if (coll === 'history') {
      var hid = clip(x.id, 64);
      if (!ID_RE.history.test(hid)) return null;
      var name = clip(x.toolName, 200).trim();
      var hs = clip(x.toolSlug, 100);
      if (!SLUG_RE.test(hs)) hs = '';
      if (!name && !hs) return null;
      var res = x.result && typeof x.result === 'object' ? x.result : {};
      var result = { value: clip(res.value, 300), note: clip(res.note, 1000) };
      // Hesap dökümü satırları (isteğe bağlı): en fazla 20 satır, satır başına 200 karakter; boşsa alan hiç yazılmaz.
      var breakdown = plainArray(res.breakdown, 20).map(function (l) {
        return typeof l === 'string' || typeof l === 'number' ? clip(String(l).replace(/\s+/g, ' ').trim(), 200).trim() : '';
      }).filter(Boolean);
      if (breakdown.length) result.breakdown = breakdown;
      return {
        id: hid, toolSlug: hs, toolName: name || hs, toolUrl: toolUrlOk(x.toolUrl),
        params: plainArray(x.params, 60).filter(function (p) { return p && typeof p === 'object'; }).map(function (p) {
          return { label: clip(p.label, 200), value: clip(p.value, 400) };
        }),
        result: result,
        note: clip(x.note, 1000),
        savedAt: validIso(x.savedAt)
      };
    }
    if (coll === 'projects') {
      var pid = clip(x.id, 64);
      var pname = clip(x.name, 200).trim();
      if (!ID_RE.projects.test(pid) || !pname) return null;
      var seen = {};
      return {
        id: pid, name: pname, description: clip(x.description, 600).trim(),
        calcIds: plainArray(x.calcIds, 500).map(function (c) { return clip(c, 64); }).filter(function (c) {
          if (!ID_RE.history.test(c) || seen[c]) return false;
          seen[c] = 1; return true;
        }),
        createdAt: validIso(x.createdAt)
      };
    }
    if (coll === 'documents') {
      var did = clip(x.id, 64);
      var dname = clip(x.name, 200).trim();
      if (!ID_RE.documents.test(did) || !dname) return null;
      var link = clip(x.url, 500).trim();
      return { id: did, name: dname, url: link && isHttpUrl(link) && toolUrlOk(link) ? link : '', note: clip(x.note, 1000).trim(), addedAt: validIso(x.addedAt) };
    }
    return null;
  }

  function applyOps(items, ops, coll) {
    var list = items.slice();
    ops.forEach(function (op) {
      if (!op) return;
      if (op.op === 'delete') {
        list = list.filter(function (it) { return !it || it.id !== op.id; });
        return;
      }
      if (op.op !== 'upsert' || !op.item) return;
      var idx = -1;
      for (var i = 0; i < list.length; i++) { if (list[i] && list[i].id === op.item.id) { idx = i; break; } }
      if (idx >= 0) list[idx] = op.item; else list.unshift(op.item);
    });
    if (coll === 'history') {
      // Geçmiş her zaman en yeni kayıt başta olacak şekilde sıralanır (sunucu da aynı kuralı uygular).
      list.sort(function (a, b) { return String((b && b.savedAt) || '').localeCompare(String((a && a.savedAt) || '')); });
      if (list.length > LIMITS.history) list = list.slice(0, LIMITS.history);
    }
    return list;
  }

  /* ---------------------------------------------------------------- misafir (giriş yapmamış) verisi */
  function guestKey(coll) { return coll === 'favorites' ? KEYS.guestFavorites : KEYS.guestHistory; }
  function guestGet(coll) {
    if (!GUEST_COLLS[coll]) return [];
    var list = read(guestKey(coll), []);
    return Array.isArray(list) ? list.filter(function (x) { return x && typeof x === 'object' && x.id; }) : [];
  }
  function guestApply(coll, op) {
    var list = applyOps(guestGet(coll), [op], coll);
    if (coll === 'favorites' && list.length > LIMITS.favorites) throw new Error('En fazla ' + LIMITS.favorites + ' favori ekleyebilirsiniz.');
    if (!write(guestKey(coll), list)) throw new Error('Tarayıcı depolaması kullanılamıyor; kayıt yapılamadı.');
    emit('vg:data', { collection: coll, guest: true });
  }

  /* ---------------------------------------------------------------- hesap verisi (görünüm) */
  function view(coll) {
    if (!state.user) return guestGet(coll);
    if (viewCache[coll]) return viewCache[coll];
    var base = srv[coll] ? srv[coll].items : [];
    viewCache[coll] = applyOps(base, pending[coll], coll);
    return viewCache[coll];
  }
  function isLoaded(coll) { return !state.user || !!srv[coll]; }

  // Hesap verisini sunucudan yükler. opts.fresh: önbellek taze olsa da yeniden çek.
  function loadData(colls, opts) {
    opts = opts || {};
    colls = (colls && colls.length ? colls : COLLS).filter(function (c) { return COLLS.indexOf(c) >= 0; });
    return ready().then(function (user) {
      if (!user) return { guest: true };
      var need = colls.filter(function (c) { return opts.fresh || !srv[c] || (Date.now() - (srv[c].at || 0)) > DATA_TTL; });
      if (!need.length) return { cached: true };
      return fetchJson('data_get', { query: '&collection=' + need.join(',') }).then(function (j) {
        need.forEach(function (c) {
          var s = j.collections && j.collections[c];
          if (s && Array.isArray(s.items)) srv[c] = { items: s.items, rev: +s.rev || 0, at: Date.now() };
          delete viewCache[c];
        });
        persistCache();
        need.forEach(function (c) { emit('vg:data', { collection: c, source: 'server' }); });
        return { loaded: need };
      }, function (e) {
        if (e.status === 401) { handleUnauthorized(e); return { guest: true }; }
        throw e;
      });
    });
  }

  function mutate(coll, op) {
    if (state.user) {
      pending[coll].push(op);
      delete viewCache[coll];
      persistCache();
      emit('vg:data', { collection: coll, source: 'local' });
      scheduleSync();
      return;
    }
    if (GUEST_COLLS[coll]) { guestApply(coll, op); return; }
    throw new Error(MSG.login);
  }

  /* ---------------------------------------------------------------- senkronizasyon */
  var syncTimer = 0;
  var syncing = null;
  function setSync(status, message) {
    sync.status = status;
    sync.message = message || '';
    if (status === 'saved') sync.at = Date.now();
    emit('vg:sync', { status: status, message: sync.message, pending: pendingCount() });
  }
  function pendingCount() { return COLLS.reduce(function (n, c) { return n + pending[c].length; }, 0); }
  function scheduleSync(delay) {
    clearTimeout(syncTimer);
    if (!state.user) return;
    if (sync.status !== 'saving') setSync('pending');
    syncTimer = setTimeout(function () { flush().catch(function () { /* durum vg:sync ile bildirilir */ }); }, delay == null ? SYNC_DELAY : delay);
  }
  function maybeFlushPending() { if (pendingCount()) scheduleSync(300); }

  /* ---------------------------------------------------------------- oturum sona erince bekleyen değişiklikler */
  // Bekleyen değişiklikler, sahibi olan kullanıcının kimliğiyle sekme belleğine (vg_rescue_v1) alınır ve bellekten
  // çıkarılır. Misafir verisine YAZILMAZ: aynı tarayıcıda sonra giriş yapan başka bir hesaba karışmasın.
  // Aynı kullanıcı yeniden giriş yaptığında gönderilir (replayRescue); başka hesap girerse veya 24 saat geçerse silinir.
  function rescuePending(uid) {
    if (!uid) return 0;
    var ops = [];
    COLLS.forEach(function (c) { pending[c].forEach(function (op) { if (op) ops.push({ c: c, op: op }); }); });
    COLLS.forEach(function (c) { pending[c] = []; });
    viewCache = {};
    if (!ops.length) return 0;
    var prev = read(KEYS.rescue, null, 'session');
    var all = prev && prev.uid === uid && Array.isArray(prev.ops) && (Date.now() - (+prev.at || 0)) < RESCUE_TTL ? prev.ops.concat(ops) : ops;
    write(KEYS.rescue, { v: 1, uid: uid, at: Date.now(), ops: all.slice(-2000) }, 'session');
    return ops.length;
  }
  function rescuedCount(uid) {
    var r = read(KEYS.rescue, null, 'session');
    return r && r.uid === uid && Array.isArray(r.ops) && (Date.now() - (+r.at || 0)) < RESCUE_TTL ? r.ops.length : 0;
  }
  function replayRescue(uid) {
    var r = read(KEYS.rescue, null, 'session');
    remove(KEYS.rescue, 'session');
    if (!r || r.uid !== uid || !Array.isArray(r.ops) || (Date.now() - (+r.at || 0)) >= RESCUE_TTL) return 0;
    var n = 0;
    r.ops.forEach(function (x) {
      if (!x || !x.op || COLLS.indexOf(x.c) < 0) return;
      var op = null;
      if (x.op.op === 'delete' && typeof x.op.id === 'string' && x.op.id) op = { op: 'delete', id: x.op.id.slice(0, 100) };
      else if (x.op.op === 'upsert') { var it = cleanItem(x.c, x.op.item); if (it) op = { op: 'upsert', item: it }; }
      if (op) { pending[x.c].push(op); n++; }
    });
    if (n) { viewCache = {}; persistCache(); }
    return n;
  }

  // Sunucu oturumu tanımadı (401). e.data.switched: bu tarayıcıda artık başka bir hesap açık (durum zaten ona geçti).
  function handleUnauthorized(e) {
    var uid = state.user ? state.user.id : null;
    if (uid) rescuePending(uid);
    var owner = uid || (read(KEYS.rescue, null, 'session') || {}).uid || null;
    var saved = owner ? rescuedCount(owner) : 0;
    state.expired = true;
    if (e && e.data && e.data.switched) {
      setSync('idle');
      return;
    }
    if (state.user) setUser(null);
    if (saved) {
      var msg = 'Oturumunuz sona erdi. Henüz kaydedilmemiş ' + saved + ' değişikliğiniz bu sekmede saklandı; aynı hesapla yeniden giriş yaptığınızda hesabınıza kaydedilecek.';
      setSync('error', msg);
      // Korumalı sayfanın "oturum kapandı" mesajının yerine geçer (giriş sayfasında gösterilir).
      setFlash('warning', msg);
    } else {
      setSync('error', MSG.expired);
    }
  }

  // Bekleyen değişiklikleri sunucuya gönderir. Koleksiyon başına en fazla 200 işlem bir istekte gider.
  var holdSync = 0;   // şifre / e-posta değişikliği sırasında (oturum kimliği yenilenirken) senkron bekletilir
  function flush(opts) {
    opts = opts || {};
    if (!state.user) return Promise.resolve();
    if (holdSync) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(function () { flush().catch(function () {}); }, 500);
      return Promise.resolve();
    }
    if (syncing) return syncing.then(function () { return pendingCount() ? flush(opts) : null; });
    clearTimeout(syncTimer);
    var colls = COLLS.filter(function (c) { return pending[c].length; });
    if (!colls.length) { if (sync.status === 'pending') setSync('saved'); return Promise.resolve(); }
    if (!opts.keepalive) setSync('saving');
    var chain = Promise.resolve();
    colls.forEach(function (c) {
      chain = chain.then(function () { return pushCollection(c, opts); });
    });
    syncing = chain.then(function () {
      syncing = null;
      sync.retry = 0;
      if (pendingCount()) { scheduleSync(0); return; }
      setSync('saved');
    }, function (e) {
      syncing = null;
      if (e && e.status === 401) { handleUnauthorized(e); throw e; }
      if (e && e.code === 'unreachable') {
        sync.retry = Math.min(sync.retry + 1, 6);
        setSync('offline', 'Bağlantı yok: değişiklikleriniz bu sekmede saklanıyor, bağlantı gelince kaydedilecek.');
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function () { flush().catch(function () {}); }, Math.min(60000, 3000 * Math.pow(2, sync.retry)));
        throw e;
      }
      setSync('error', (e && e.message) || MSG.generic);
      throw e;
    });
    return syncing;
  }

  function pushCollection(c, opts) {
    if (!pending[c].length) return Promise.resolve();
    var batch = pending[c].slice(0, 200);
    return post('data_put', { collection: c, ops: batch }, { keepalive: opts.keepalive }).then(function (j) {
      pending[c].splice(0, batch.length);
      srv[c] = { items: Array.isArray(j.items) ? j.items : [], rev: +j.rev || 0, at: Date.now() };
      delete viewCache[c];
      persistCache();
      emit('vg:data', { collection: c, source: 'server' });
      if (pending[c].length) return pushCollection(c, opts);
    }, function (e) {
      if (e && e.code === 'invalid_item' && e.fields && e.fields.index != null) {
        // Sunucunun kabul etmediği tek kayıt atlanır, kalanlar yeniden gönderilir.
        var idx = +e.fields.index;
        if (idx >= 0 && idx < batch.length) {
          pending[c].splice(idx, 1);
          delete viewCache[c];
          persistCache();
          emit('vg:data', { collection: c, source: 'local' });
          return pushCollection(c, opts);
        }
      }
      if (e && (e.code === 'limit' || e.code === 'too_large' || e.code === 'invalid_item' || e.code === 'too_many_ops' || e.code === 'invalid_request')) {
        // Bu değişiklikler hiçbir zaman kabul edilmeyecek: geri alınır, sunucudaki liste yeniden yüklenir.
        pending[c].splice(0, batch.length);
        delete viewCache[c];
        persistCache();
        emit('vg:data', { collection: c, source: 'local' });
        return loadData([c], { fresh: true }).then(function () { throw e; }, function () { throw e; });
      }
      throw e;
    });
  }

  function onHide() {
    if (state.user && pendingCount()) flush({ keepalive: true }).catch(function () { /* sonraki sayfada yeniden denenir */ });
  }

  /* ---------------------------------------------------------------- hesap işlemleri */
  // Giriş / kayıt sonrası. opts.mergeGuest: true ise bu tarayıcıda giriş yapmadan kaydedilen favori ve hesaplamalar
  // hesaba eklenir (giriş / kayıt sayfasındaki onay kutusu). Aynı kullanıcının oturumu sona ererken kaydedilemeyen
  // değişiklikleri (vg_rescue_v1) her durumda gönderilir; başka bir hesabın kurtarılan verisi silinir.
  function afterLogin(j, opts) {
    opts = opts || {};
    resetAccountData();
    state.checked = true;
    state.meAt = Date.now();
    setHint();
    setUser(j.user);
    var rescued = state.user ? replayRescue(state.user.id) : 0;
    var work = opts.mergeGuest ? mergeGuestData() : (rescued ? flush().then(function () { return null; }) : Promise.resolve(null));
    return work.then(function (merged) {
      if (rescued) setFlash('success', 'Oturumunuz sona ermeden önce kaydedilemeyen ' + rescued + ' değişikliğiniz hesabınıza kaydedildi.', true);
      return { user: state.user, merged: merged, rescued: rescued };
    }, function () {
      return { user: state.user, merged: null, rescued: rescued };
    });
  }

  // register({ name, email, password, company, phone, consent, website, remember, mergeGuest }) veya eski imza (ad, e-posta, şifre).
  function register(nameOrFields, email, password) {
    var f = typeof nameOrFields === 'object' && nameOrFields ? nameOrFields : { name: nameOrFields, email: email, password: password, consent: true };
    return post('register', {
      name: String(f.name || ''), email: String(f.email || ''), password: String(f.password || ''),
      company: String(f.company || ''), phone: String(f.phone || ''), consent: !!f.consent,
      website: String(f.website || ''), remember: !!f.remember
    }, { anon: true }).then(function (j) { return afterLogin(j, { mergeGuest: !!f.mergeGuest }); });
  }

  // login(email, password, { remember, mergeGuest })
  function login(email, password, opts) {
    opts = opts || {};
    return post('login', { email: String(email || ''), password: String(password || ''), remember: !!opts.remember }, { anon: true }).then(function (j) {
      return afterLogin(j, { mergeGuest: !!opts.mergeGuest });
    });
  }

  function logout() {
    var pre = state.user && pendingCount()
      ? Promise.race([flush().catch(function () {}), new Promise(function (r) { setTimeout(r, 3000); })])
      : Promise.resolve();
    return pre.then(function () {
      return post('logout', {}, { anon: true }).catch(function (e) { if (e.code !== 'unreachable') return null; throw e; });
    }).then(function () {
      state.csrf = '';
      remove(KEYS.rescue, 'session');   // bilinçli çıkış: bu sekmede hesap verisi kalmaz
      setUser(null);
      setSync('idle');
    });
  }

  // Oturum kimliğini yenileyen işlemler (şifre / e-posta değişikliği): önce bekleyen değişiklikler gönderilir, işlem
  // sürerken yeni senkron başlatılmaz; eski oturum çerezli bir istek yeni çerezin üzerine yazmasın.
  function withSyncHeld(fn) {
    var pre = state.user && pendingCount()
      ? Promise.race([flush().catch(function () {}), new Promise(function (r) { setTimeout(r, 5000); })])
      : Promise.resolve();
    return pre.then(function () {
      holdSync++;
      var release = function () { holdSync = Math.max(0, holdSync - 1); maybeFlushPending(); };
      return Promise.resolve().then(fn).then(function (r) { release(); return r; }, function (e) { release(); throw e; });
    });
  }

  function updateProfile(fields) {
    fields = fields || {};
    var run = function () { return post('update_profile', fields); };
    var emailChange = typeof fields.email === 'string' && state.user && fields.email.trim().toLowerCase() !== state.user.email;
    return (emailChange ? withSyncHeld(run) : run()).then(function (j) {
      state.user = sanitizeUser(j.user);
      persistCache();
      refreshHeader();
      emit('vg:auth', { user: state.user });
      return state.user;
    }, function (e) { if (e.status === 401) handleUnauthorized(e); throw e; });
  }

  function changePassword(current, next) {
    return withSyncHeld(function () {
      return post('change_password', { current: String(current || ''), password: String(next || '') });
    }).then(function (j) {
      persistCache();
      return j.message || 'Şifreniz güncellendi.';
    }, function (e) { if (e.status === 401) handleUnauthorized(e); throw e; });
  }

  function deleteAccount(password) {
    return post('delete_account', { password: String(password || ''), confirm: true }).then(function (j) {
      state.csrf = '';
      remove(KEYS.guestFavorites);
      remove(KEYS.guestHistory);
      remove(KEYS.rescue, 'session');
      setUser(null);
      return j.message || 'Hesabınız silindi.';
    }, function (e) { if (e.status === 401) handleUnauthorized(e); throw e; });
  }

  function forgotPassword(email) {
    return post('forgot_password', { email: String(email || '') }, { anon: true }).then(function (j) { return j.message; });
  }

  function resetPassword(token, password) {
    return post('reset_password', { token: String(token || ''), password: String(password || '') }, { anon: true }).then(function (j) {
      // Sunucu bu tarayıcıdaki oturumu da kapatır.
      if (state.user) setUser(null);
      return j.message || 'Şifreniz güncellendi.';
    });
  }

  function exportAccount() {
    return flush().catch(function () {}).then(fetchExport);
  }

  /* ---------------------------------------------------------------- misafir verisini hesaba aktarma */
  function mergeGuestData() {
    var favs = guestGet('favorites').map(function (x) { return cleanItem('favorites', x); }).filter(Boolean);
    var hist = guestGet('history').map(function (x) { return cleanItem('history', x); }).filter(Boolean);
    if (!favs.length && !hist.length) return Promise.resolve({ favorites: 0, history: 0 });
    favs.forEach(function (it) { pending.favorites.push({ op: 'upsert', item: it }); });
    hist.slice().reverse().forEach(function (it) { pending.history.push({ op: 'upsert', item: it }); });
    viewCache = {};
    persistCache();
    return flush().then(function () {
      remove(KEYS.guestFavorites);
      remove(KEYS.guestHistory);
      setFlash('success', mergedText(favs.length, hist.length, 'Bu cihazda kaydettiğiniz'));
      return { favorites: favs.length, history: hist.length };
    });
  }
  function mergedText(f, h, prefix) {
    var parts = [];
    if (f) parts.push(f + ' favori');
    if (h) parts.push(h + ' hesaplama');
    return prefix + ' ' + parts.join(' ve ') + ' hesabınıza eklendi.';
  }

  /* ---------------------------------------------------------------- favoriler / geçmiş / projeler / dokümanlar */
  function getHistory() { return view('history'); }
  function getFavorites() { return view('favorites'); }
  function getProjects() { return state.user ? view('projects') : []; }
  function getDocuments() { return state.user ? view('documents') : []; }

  function isFavorite(toolSlug) {
    return getFavorites().some(function (f) { return f.toolSlug === toolSlug || f.id === toolSlug; });
  }
  // Favori durumunu değiştirir ve yeni durumu (true: favoride) döndürür. Misafirde bu tarayıcıya kaydedilir.
  function toggleFavorite(toolSlug, toolName, toolUrl) {
    var slug = clip(toolSlug, 100);
    if (!SLUG_RE.test(slug)) throw new Error('Bu araç favorilere eklenemiyor.');
    if (isFavorite(slug)) { mutate('favorites', { op: 'delete', id: slug }); return false; }
    if (getFavorites().length >= LIMITS.favorites) throw new Error('En fazla ' + LIMITS.favorites + ' favori ekleyebilirsiniz.');
    mutate('favorites', { op: 'upsert', item: cleanItem('favorites', { toolSlug: slug, toolName: toolName, toolUrl: toolUrl, addedAt: nowIso() }) });
    return true;
  }

  function saveHistory(entry) {
    var item = cleanItem('history', Object.assign({}, entry || {}, { id: newId('h'), savedAt: nowIso() }));
    if (!item) throw new Error('Hesaplama kaydedilemedi.');
    mutate('history', { op: 'upsert', item: item });
    return item;
  }
  function deleteHistory(id) {
    if (!getHistory().some(function (h) { return h.id === id; })) return false;
    mutate('history', { op: 'delete', id: id });
    if (state.user) {
      getProjects().forEach(function (p) {
        if (p.calcIds && p.calcIds.indexOf(id) >= 0) {
          var upd = cleanItem('projects', Object.assign({}, p, { calcIds: p.calcIds.filter(function (c) { return c !== id; }) }));
          if (upd) mutate('projects', { op: 'upsert', item: upd });
        }
      });
    }
    return true;
  }

  function createProject(name, description) {
    if (!state.user) throw new Error(MSG.login);
    var clean = String(name || '').trim();
    if (!clean) throw new Error('Proje adı gerekli.');
    if (getProjects().length >= LIMITS.projects) throw new Error('En fazla ' + LIMITS.projects + ' proje oluşturabilirsiniz.');
    var p = cleanItem('projects', { id: newId('p'), name: clean, description: description, calcIds: [], createdAt: nowIso() });
    mutate('projects', { op: 'upsert', item: p });
    return p;
  }
  function updateProject(id, fields) {
    if (!state.user) throw new Error(MSG.login);
    var cur = getProjects().filter(function (p) { return p.id === id; })[0];
    if (!cur) return null;
    var p = cleanItem('projects', Object.assign({}, cur, fields || {}, { id: cur.id, createdAt: cur.createdAt }));
    if (!p) throw new Error('Proje adı gerekli.');
    mutate('projects', { op: 'upsert', item: p });
    return p;
  }
  function attachCalcToProject(projectId, historyId) {
    var cur = getProjects().filter(function (p) { return p.id === projectId; })[0];
    if (!cur) return false;
    if ((cur.calcIds || []).indexOf(historyId) >= 0) return true;
    return !!updateProject(projectId, { calcIds: (cur.calcIds || []).concat([historyId]) });
  }
  function detachCalcFromProject(projectId, historyId) {
    var cur = getProjects().filter(function (p) { return p.id === projectId; })[0];
    if (!cur) return false;
    return !!updateProject(projectId, { calcIds: (cur.calcIds || []).filter(function (c) { return c !== historyId; }) });
  }
  function deleteProject(projectId) {
    if (!state.user || !getProjects().some(function (p) { return p.id === projectId; })) return false;
    mutate('projects', { op: 'delete', id: projectId });
    return true;
  }

  function addDocument(name, url, note) {
    if (!state.user) throw new Error(MSG.login);
    var clean = String(name || '').trim();
    if (!clean) throw new Error('Doküman adı gerekli.');
    var cleanUrl = String(url || '').trim();
    // İsteğe bağlı alan; doluysa mutlak http(s) bağlantısı olmalı (javascript:/data: engellenir).
    if (cleanUrl && (!isHttpUrl(cleanUrl) || !toolUrlOk(cleanUrl))) throw new Error('Geçerli bir http(s) bağlantısı girin (örn. https://...).');
    if (getDocuments().length >= LIMITS.documents) throw new Error('En fazla ' + LIMITS.documents + ' doküman ekleyebilirsiniz.');
    var d = cleanItem('documents', { id: newId('d'), name: clean, url: cleanUrl, note: note, addedAt: nowIso() });
    mutate('documents', { op: 'upsert', item: d });
    return d;
  }
  function deleteDocument(id) {
    if (!state.user || !getDocuments().some(function (d) { return d.id === id; })) return false;
    mutate('documents', { op: 'delete', id: id });
    return true;
  }

  /* ---------------------------------------------------------------- dışa / içe aktarma (yedek) */
  // Bu sekmede yüklü verinin anlık görüntüsü (sunucudaki tam dışa aktarma için exportAccount kullanın).
  function exportAll() {
    if (!state.user) return null;
    return { exportedAt: nowIso(), user: state.user, history: getHistory(), favorites: getFavorites(), projects: getProjects(), documents: getDocuments() };
  }

  // Yedek dosyasını (eski sürümün yedeği veya sunucu dışa aktarımı) hesaba ekler. Hesapta olan kayıtlar
  // tekrar eklenmez; her kayıt doğrulanır ve kırpılır. Döner: Promise<{history, favorites, projects, documents}>.
  function importAll(data) {
    if (!state.user) return Promise.reject(new Error(MSG.login));
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        !(Array.isArray(data.history) || Array.isArray(data.favorites) || Array.isArray(data.projects) || Array.isArray(data.documents))) {
      return Promise.reject(new Error('Geçersiz yedek dosyası.'));
    }
    return loadData(COLLS).then(function () { return queueImport(data); });
  }

  function queueImport(data) {
    var counts = { history: 0, favorites: 0, projects: 0, documents: 0 };
    var ownHistory = {}, idMap = {};
    getHistory().forEach(function (h) { ownHistory[h.id] = 1; });
    var newHistory = [];
    plainArray(data.history, 500).forEach(function (h) {
      if (!h || typeof h !== 'object') return;
      var oldId = clip(h.id, 64);
      if (oldId && ownHistory[oldId]) { idMap[oldId] = oldId; return; }
      var id = ID_RE.history.test(oldId) ? oldId : newId('h');
      var item = cleanItem('history', Object.assign({}, h, { id: id }));
      if (!item) return;
      if (oldId) idMap[oldId] = id;
      ownHistory[id] = 1;
      newHistory.push(item);
    });
    newHistory.sort(function (a, b) { return String(a.savedAt).localeCompare(String(b.savedAt)); });
    newHistory.forEach(function (item) { pending.history.push({ op: 'upsert', item: item }); counts.history++; });

    var favSlugs = {};
    getFavorites().forEach(function (f) { favSlugs[f.toolSlug] = 1; });
    plainArray(data.favorites, 200).forEach(function (f) {
      var item = cleanItem('favorites', f);
      if (!item || favSlugs[item.toolSlug]) return;
      if (getFavorites().length + counts.favorites >= LIMITS.favorites) return;
      favSlugs[item.toolSlug] = 1;
      pending.favorites.push({ op: 'upsert', item: item });
      counts.favorites++;
    });

    var ownProjects = {};
    getProjects().forEach(function (p) { ownProjects[p.id] = 1; });
    plainArray(data.projects, 200).forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      var oldId = clip(p.id, 64);
      if (oldId && ownProjects[oldId]) return;
      if (getProjects().length + counts.projects >= LIMITS.projects) return;
      var calcIds = plainArray(p.calcIds, 500).map(function (c) { c = clip(c, 64); return idMap[c] || (ownHistory[c] ? c : ''); }).filter(Boolean);
      var item = cleanItem('projects', Object.assign({}, p, { id: ID_RE.projects.test(oldId) ? oldId : newId('p'), calcIds: calcIds }));
      if (!item) return;
      ownProjects[item.id] = 1;
      pending.projects.push({ op: 'upsert', item: item });
      counts.projects++;
    });

    var ownDocs = {};
    getDocuments().forEach(function (d) { ownDocs[d.id] = 1; });
    plainArray(data.documents, 500).forEach(function (d) {
      if (!d || typeof d !== 'object') return;
      var oldId = clip(d.id, 64);
      if (oldId && ownDocs[oldId]) return;
      if (getDocuments().length + counts.documents >= LIMITS.documents) return;
      var link = clip(d.url, 500).trim();
      var item = cleanItem('documents', Object.assign({}, d, { id: ID_RE.documents.test(oldId) ? oldId : newId('d'), url: link && isHttpUrl(link) ? link : '' }));
      if (!item) return;
      ownDocs[item.id] = 1;
      pending.documents.push({ op: 'upsert', item: item });
      counts.documents++;
    });

    viewCache = {};
    persistCache();
    COLLS.forEach(function (c) { emit('vg:data', { collection: c, source: 'local' }); });
    return flush().then(function () { return counts; });
  }

  /* ---------------------------------------------------------------- eski (yalnızca tarayıcıda) hesaplar */
  function legacyDetect() {
    var st = read(KEYS.legacyState, null);
    var flag = st && st.state;
    if (flag === 'migrated' || flag === 'discarded') return null;
    var users = read(KEYS.users, []);
    if (!Array.isArray(users) || !users.length) return null;
    var data = {};
    ['history', 'favorites', 'projects', 'documents'].forEach(function (c) { var v = read(KEYS[c], []); data[c] = Array.isArray(v) ? v : []; });
    var out = users.filter(function (u) { return u && u.id; }).map(function (u) {
      var counts = { history: 0, favorites: 0, projects: 0, documents: 0 };
      Object.keys(data).forEach(function (c) { counts[c] = data[c].filter(function (x) { return x && String(x.userId) === String(u.id); }).length; });
      return { id: String(u.id), email: String(u.email || ''), name: String(u.name || ''), counts: counts, total: counts.history + counts.favorites + counts.projects + counts.documents };
    });
    var total = out.reduce(function (n, u) { return n + u.total; }, 0);
    return { users: out, total: total, dismissed: flag === 'dismissed' };
  }

  // Taşınacak eski hesap: yalnızca e-posta adresi eşleşen ya da bu tarayıcıda kaydı olan TEK eski hesap. Birden fazla
  // eski hesap varsa ve e-posta eşleşmiyorsa null döner (seçim panelde kullanıcıya bırakılır; başkasının verisi taşınmaz).
  function legacyPick(info, email) {
    if (!info || !info.users.length) return null;
    var withData = info.users.filter(function (u) { return u.total > 0; });
    var e = String(email || (state.user && state.user.email) || '').trim().toLowerCase();
    if (e) {
      var match = withData.filter(function (u) { return u.email.toLowerCase() === e; })[0];
      if (match) return match;
    }
    return withData.length === 1 ? withData[0] : null;
  }

  // Eski hesabın verilerini (şifre olmadan) giriş yapılmış hesaba taşır; başarılı olunca yalnızca taşınan eski hesabın
  // kayıtları (ve şifre özeti) silinir. Kaydı olan başka eski hesap kalmadıysa eski anahtarların tümü kaldırılır.
  function legacyMigrate(legacyUserId) {
    if (!state.user) return Promise.reject(new Error(MSG.login));
    var info = legacyDetect();
    if (!info) return Promise.resolve({ history: 0, favorites: 0, projects: 0, documents: 0 });
    var who = legacyUserId ? info.users.filter(function (u) { return u.id === legacyUserId; })[0] : legacyPick(info);
    if (!who) return Promise.resolve({ history: 0, favorites: 0, projects: 0, documents: 0 });
    var pick = function (c) { var v = read(KEYS[c], []); return (Array.isArray(v) ? v : []).filter(function (x) { return x && String(x.userId) === who.id; }); };
    var data = { history: pick('history'), favorites: pick('favorites'), projects: pick('projects'), documents: pick('documents') };
    return loadData(COLLS).then(function () { return queueImport(data); }).then(function (counts) {
      legacyRemoveUser(who.id);
      return counts;
    });
  }
  function legacyRemoveUser(uid) {
    ['history', 'favorites', 'projects', 'documents'].forEach(function (c) {
      var v = read(KEYS[c], null);
      if (!Array.isArray(v)) return;
      var rest = v.filter(function (x) { return x && String(x.userId) !== uid; });
      if (rest.length) write(KEYS[c], rest); else remove(KEYS[c]);
    });
    var users = read(KEYS.users, null);
    if (Array.isArray(users)) {
      var restUsers = users.filter(function (u) { return u && String(u.id) !== uid; });
      if (restUsers.length) write(KEYS.users, restUsers); else remove(KEYS.users);
    }
    var sess = read(KEYS.session, null);
    if (sess && String(sess.userId) === uid) remove(KEYS.session);
    var left = legacyDetect();
    if (!left || !left.total) legacyDiscard('migrated');
  }
  function legacyDiscard(reason) {
    LEGACY_KEYS.forEach(function (k) { remove(k); });
    write(KEYS.legacyState, { state: reason || 'discarded', at: Date.now() });
    var n = document.getElementById('vg-legacy-notice');
    if (n) n.remove();
  }
  function legacyDismiss() { write(KEYS.legacyState, { state: 'dismissed', at: Date.now() }); }

  // Eski hesap verisi olan ziyaretçiye (hesap sayfaları dışında) bir kez, kapatılabilir bilgi kutusu gösterilir.
  function legacyNotice() {
    if (isHesapPage() || !document.body || document.getElementById('vg-legacy-notice')) return;
    var info = legacyDetect();
    if (!info || info.dismissed || !info.total) return;
    // Çerez tercihi henüz verilmemişse (ana sayfadaki çerez bildirimi açık/açılacak) iki kutu üst üste binmesin:
    // bilgi kutusu bir sonraki sayfa görüntülemesinde gösterilir.
    var consent = null;
    try { consent = global.localStorage.getItem('vg_cookie_consent'); } catch (e) { consent = null; }
    if (document.getElementById('cookieConsent') && consent !== 'granted' && consent !== 'denied') return;
    if (!document.getElementById('vg-legacy-style')) {
      var st = document.createElement('style');
      st.id = 'vg-legacy-style';
      st.textContent = '#vg-legacy-notice{position:fixed;z-index:9000;left:16px;right:16px;bottom:16px;max-width:30rem;margin-left:auto;' +
        'background:#0a1628;color:#fff;border:1px solid rgba(245,158,11,.55);border-radius:12px;padding:1rem 1.1rem;' +
        'box-shadow:0 20px 40px -8px rgba(0,0,0,.35);font:400 .9rem/1.5 var(--font-body,Inter,system-ui,sans-serif)}' +
        '#vg-legacy-notice strong{display:block;font:700 1rem/1.3 var(--font-heading,Outfit,system-ui,sans-serif);margin-bottom:.25rem}' +
        '#vg-legacy-notice p{margin:0 0 .75rem;color:rgba(255,255,255,.86)}' +
        '#vg-legacy-notice .vgl-actions{display:flex;flex-wrap:wrap;gap:.5rem}' +
        '#vg-legacy-notice a,#vg-legacy-notice button{min-height:40px;display:inline-flex;align-items:center;padding:.5rem .9rem;border-radius:8px;' +
        'font:700 .86rem/1 var(--font-heading,Outfit,system-ui,sans-serif);cursor:pointer;text-decoration:none}' +
        '#vg-legacy-notice a{background:#f59e0b;color:#0a1628;border:0}' +
        '#vg-legacy-notice button{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.35)}' +
        '#vg-legacy-notice a:focus-visible,#vg-legacy-notice button:focus-visible{outline:3px solid #fcd34d;outline-offset:2px}' +
        '@media print{#vg-legacy-notice{display:none}}';
      document.head.appendChild(st);
    }
    var box = document.createElement('section');
    box.id = 'vg-legacy-notice';
    box.setAttribute('aria-labelledby', 'vg-legacy-title');
    var target = state.user ? '/hesap/panel.html#eski-veriler' : '/hesap/kayit.html?aktar=1';
    var owners = info.users.filter(function (u) { return u.total > 0; }).length;
    box.innerHTML = '<strong id="vg-legacy-title">VoltGuard Tools hesabınız yenilendi</strong>' +
      '<p>Bu tarayıcıda ' + (owners > 1 ? owners + ' eski hesaba ait toplam ' : 'eski hesabınıza ait ') + info.total + ' kayıt (hesaplama, favori, proje, doküman) var. ' +
      'Artık hesaplar güvenli sunucuda tutuluyor; kayıtlarınızı tek adımda yeni hesabınıza taşıyabilirsiniz.</p>' +
      '<div class="vgl-actions"><a href="' + target + '">' + (state.user ? 'Kayıtlarımı taşı' : 'Hesap oluştur ve taşı') + '</a>' +
      '<button type="button">Daha sonra</button></div>';
    box.querySelector('button').addEventListener('click', function () { legacyDismiss(); box.remove(); });
    document.body.appendChild(box);
  }

  /* ---------------------------------------------------------------- başlangıç */
  function init() {
    var cached = loadCache();
    refreshHeader();
    if (!isHesapPage()) {
      if (!getHint()) {
        state.checked = true;          // misafir: içerik sayfalarında API'ye hiç istek atılmaz
      } else if (cached && (Date.now() - state.meAt) < ME_TTL) {
        state.checked = true;          // sekme önbelleği taze: yeniden doğrulama gerekmez
        maybeFlushPending();
      } else {
        // Oturum doğrulaması içerik sayfasını bekletmez; başlık o sırada ipucuna göre gösterilir.
        var run = function () { session().catch(function () { /* başlık ipucuna göre kalır */ }); };
        if ('requestIdleCallback' in global) global.requestIdleCallback(run, { timeout: 2000 }); else setTimeout(run, 400);
      }
      var showLegacy = function () { try { legacyNotice(); } catch (e) { /* bilgi kutusu kritik değil */ } };
      if ('requestIdleCallback' in global) global.requestIdleCallback(showLegacy, { timeout: 4000 }); else setTimeout(showLegacy, 1500);
    }
    // Hesap sayfaları oturumu kendisi doğrular (VG.Auth.requireAuth / session({ force: true })).
  }

  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') onHide(); });
  global.addEventListener('pagehide', onHide);
  global.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    // Geri/ileri önbellekten dönüldü: başka sayfada giriş/çıkış yapılmış olabilir.
    loadCache();
    if (!getHint() && state.user) setUser(null, { silent: false });
    refreshHeader();
  });
  global.addEventListener('online', function () { if (state.user && pendingCount()) scheduleSync(200); });
  global.addEventListener('storage', function (e) {
    if (e.key === KEYS.hint) {
      if (!e.newValue) { if (state.user) { rescuePending(state.user.id); setUser(null); } }
      else { session({ force: true }).catch(function () { /* ağ yok: mevcut durum korunur */ }); }
    } else if (e.key === KEYS.guestFavorites || e.key === KEYS.guestHistory) {
      if (!state.user) emit('vg:data', { collection: e.key === KEYS.guestFavorites ? 'favorites' : 'history', guest: true });
    }
  });

  /* ---------------------------------------------------------------- Public API */
  var api = {
    KEYS: KEYS,
    API: API,
    // oturum
    ready: ready,
    session: session,
    requireAuth: requireAuth,
    currentUser: function () { return state.user; },
    isLoggedIn: function () { return !!state.user; },
    status: function () { return { checked: state.checked, apiDown: state.apiDown, expired: state.expired, user: state.user }; },
    register: register,
    login: login,
    logout: logout,
    updateProfile: updateProfile,
    changePassword: changePassword,
    deleteAccount: deleteAccount,
    forgotPassword: forgotPassword,
    resetPassword: resetPassword,
    exportAccount: exportAccount,
    // veri
    loadData: loadData,
    isLoaded: isLoaded,
    flush: flush,
    syncState: function () { return { status: sync.status, message: sync.message, pending: pendingCount(), savedAt: sync.at }; },
    saveHistory: saveHistory,
    getHistory: getHistory,
    deleteHistory: deleteHistory,
    getFavorites: getFavorites,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    createProject: createProject,
    updateProject: updateProject,
    getProjects: getProjects,
    deleteProject: deleteProject,
    attachCalcToProject: attachCalcToProject,
    detachCalcFromProject: detachCalcFromProject,
    addDocument: addDocument,
    getDocuments: getDocuments,
    deleteDocument: deleteDocument,
    exportAll: exportAll,
    importAll: importAll,
    guestCounts: function () { return { favorites: guestGet('favorites').length, history: guestGet('history').length }; },
    rescuedCount: function () { var r = read(KEYS.rescue, null, 'session'); return r && r.uid ? rescuedCount(r.uid) : 0; },
    // eski hesaplar
    legacy: { detect: legacyDetect, pick: legacyPick, migrate: legacyMigrate, discard: legacyDiscard, dismiss: legacyDismiss },
    // yardımcılar
    setFlash: setFlash,
    takeFlash: takeFlash,
    loginUrl: loginUrl,
    safeNext: safeNext,
    safeHref: safeHref,
    pathPrefix: pathPrefix,
    refreshHeader: refreshHeader,
    decorateNav: decorateNav,
    LIMITS: LIMITS,
    MESSAGES: MSG
  };

  global.VG = global.VG || {};
  global.VG.Auth = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window));
