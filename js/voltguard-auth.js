/* =====================================================
   VoltGuard Auth — client-side membership (localStorage)
   ---------------------------------------------------
   NOT a production auth system. Data lives only in this
   browser. Passwords are SHA-256 salted for demonstration;
   real deployment must use a server + bcrypt/argon2 + HTTPS.
   ===================================================== */
(function (global) {
  'use strict';

  var KEYS = {
    users: 'vg_users_v1',
    session: 'vg_session_v1',
    history: 'vg_history_v1',
    favorites: 'vg_favorites_v1',
    projects: 'vg_projects_v1',
    documents: 'vg_documents_v1'
  };

  function read(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function uid() {
    return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function nowIso() { return new Date().toISOString(); }

  var STORAGE_ERR = 'Tarayıcı depolaması kullanılamıyor.';

  function bytesToHex(buf) {
    var arr = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
    return s;
  }

  async function sha256Hex(text) {
    var enc = new TextEncoder();
    var data = enc.encode(text);
    var buf = await crypto.subtle.digest('SHA-256', data);
    return bytesToHex(buf);
  }

  async function hashPassword(password, salt) {
    // Iterated SHA-256 (5000 rounds) as a lightweight KDF; SubtleCrypto PBKDF2 preferred but requires more setup.
    var out = password + '::' + salt;
    for (var i = 0; i < 5000; i++) { out = await sha256Hex(out); }
    return out;
  }

  function makeSalt() {
    var arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return bytesToHex(arr);
  }

  function normalizeEmail(email) { return (email || '').trim().toLowerCase(); }

  function getUsers() { return read(KEYS.users, []); }
  function saveUsers(list) { return write(KEYS.users, list); }

  function getSession() { return read(KEYS.session, null); }
  function saveSession(session) { return write(KEYS.session, session); }
  function clearSession() {
    try { localStorage.removeItem(KEYS.session); } catch (e) { /* storage unavailable: nothing persisted */ }
  }

  function findUserByEmail(email) {
    var e = normalizeEmail(email);
    return getUsers().find(function (u) { return u.email === e; }) || null;
  }
  function findUserById(id) {
    return getUsers().find(function (u) { return u.id === id; }) || null;
  }

  async function register(name, email, password) {
    var e = normalizeEmail(email);
    var cleanName = String(name || '').trim();
    if (!cleanName || !e || !password) throw new Error('Ad, e-posta ve şifre gereklidir.');
    if (cleanName.length < 2) throw new Error('Ad en az 2 karakter olmalı.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Geçerli bir e-posta girin.');
    if (password.length < 8) throw new Error('Şifre en az 8 karakter olmalı.');
    if (findUserByEmail(e)) throw new Error('Bu e-posta zaten kayıtlı.');
    var salt = makeSalt();
    var hash = await hashPassword(password, salt);
    // Hashing is async: re-read and re-check synchronously before writing, so two concurrent
    // register() calls (double click) cannot create duplicate accounts for the same e-mail.
    var users = getUsers();
    if (users.some(function (u) { return u.email === e; })) throw new Error('Bu e-posta zaten kayıtlı.');
    var user = { id: uid(), email: e, name: cleanName, salt: salt, hash: hash, createdAt: nowIso() };
    users.push(user);
    if (!saveUsers(users)) throw new Error(STORAGE_ERR);
    if (!saveSession({ userId: user.id, loginAt: nowIso() })) throw new Error(STORAGE_ERR);
    return sanitize(user);
  }

  async function login(email, password) {
    var user = findUserByEmail(email);
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    var hash = await hashPassword(password, user.salt);
    if (hash !== user.hash) throw new Error('Şifre hatalı.');
    if (!saveSession({ userId: user.id, loginAt: nowIso() })) throw new Error(STORAGE_ERR);
    return sanitize(user);
  }

  function logout() { clearSession(); }

  function sanitize(user) {
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
  }

  function currentUser() {
    var s = getSession();
    if (!s) return null;
    var user = findUserById(s.userId);
    return sanitize(user);
  }

  function requireAuth(redirectTo) {
    var user = currentUser();
    if (user) return user;
    var target = redirectTo || (pathPrefix() + 'hesap/giris.html');
    location.href = target + '?next=' + encodeURIComponent(location.pathname + location.search);
    return null;
  }

  // ---- History (saved calculations) ----
  function getAllHistory() { return read(KEYS.history, []); }
  function getHistory() {
    var u = currentUser(); if (!u) return [];
    return getAllHistory().filter(function (h) { return h.userId === u.id; });
  }
  function saveHistory(entry) {
    var u = currentUser(); if (!u) throw new Error('Önce giriş yapın.');
    var list = getAllHistory();
    var item = Object.assign({ id: 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), userId: u.id, savedAt: nowIso() }, entry);
    list.unshift(item);
    if (!write(KEYS.history, list.slice(0, 500))) throw new Error(STORAGE_ERR);
    return item;
  }
  function deleteHistory(id) {
    var u = currentUser(); if (!u) return false;
    var list = getAllHistory().filter(function (h) { return !(h.id === id && h.userId === u.id); });
    return write(KEYS.history, list);
  }

  // ---- Favorites ----
  function getAllFavorites() { return read(KEYS.favorites, []); }
  function getFavorites() {
    var u = currentUser(); if (!u) return [];
    return getAllFavorites().filter(function (f) { return f.userId === u.id; });
  }
  function isFavorite(toolSlug) {
    var u = currentUser(); if (!u) return false;
    return getAllFavorites().some(function (f) { return f.userId === u.id && f.toolSlug === toolSlug; });
  }
  function toggleFavorite(toolSlug, toolName, toolUrl) {
    var u = currentUser(); if (!u) throw new Error('Önce giriş yapın.');
    var list = getAllFavorites();
    var exists = list.findIndex(function (f) { return f.userId === u.id && f.toolSlug === toolSlug; });
    if (exists >= 0) {
      list.splice(exists, 1);
      if (!write(KEYS.favorites, list)) throw new Error(STORAGE_ERR);
      return false;
    }
    list.unshift({ userId: u.id, toolSlug: toolSlug, toolName: toolName, toolUrl: toolUrl, addedAt: nowIso() });
    if (!write(KEYS.favorites, list)) throw new Error(STORAGE_ERR);
    return true;
  }

  // ---- Projects ----
  function getAllProjects() { return read(KEYS.projects, []); }
  function getProjects() {
    var u = currentUser(); if (!u) return [];
    return getAllProjects().filter(function (p) { return p.userId === u.id; });
  }
  function createProject(name, description) {
    var u = currentUser(); if (!u) throw new Error('Önce giriş yapın.');
    if (!name || !name.trim()) throw new Error('Proje adı gerekli.');
    var list = getAllProjects();
    var p = { id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), userId: u.id, name: name.trim(), description: (description || '').trim(), calcIds: [], createdAt: nowIso() };
    list.unshift(p);
    if (!write(KEYS.projects, list)) throw new Error(STORAGE_ERR);
    return p;
  }
  function attachCalcToProject(projectId, historyId) {
    var u = currentUser(); if (!u) return false;
    var list = getAllProjects();
    var idx = list.findIndex(function (p) { return p.id === projectId && p.userId === u.id; });
    if (idx < 0) return false;
    if (!list[idx].calcIds.includes(historyId)) list[idx].calcIds.push(historyId);
    return write(KEYS.projects, list);
  }
  function deleteProject(projectId) {
    var u = currentUser(); if (!u) return false;
    var list = getAllProjects().filter(function (p) { return !(p.id === projectId && p.userId === u.id); });
    return write(KEYS.projects, list);
  }

  // ---- Documents (bookmark-style personal library) ----
  function getAllDocuments() { return read(KEYS.documents, []); }
  function getDocuments() {
    var u = currentUser(); if (!u) return [];
    return getAllDocuments().filter(function (d) { return d.userId === u.id; });
  }
  function addDocument(name, url, note) {
    var u = currentUser(); if (!u) throw new Error('Önce giriş yapın.');
    if (!name || !name.trim()) throw new Error('Doküman adı gerekli.');
    var cleanUrl = String(url || '').trim();
    // Optional field, but when present it must be an absolute http(s) link (blocks javascript:/data: URLs).
    if (cleanUrl && !isHttpUrl(cleanUrl)) throw new Error('Geçerli bir http(s) bağlantısı girin (örn. https://...).');
    var list = getAllDocuments();
    var doc = { id: 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), userId: u.id, name: name.trim(), url: cleanUrl, note: (note || '').trim(), addedAt: nowIso() };
    list.unshift(doc);
    if (!write(KEYS.documents, list)) throw new Error(STORAGE_ERR);
    return doc;
  }
  function deleteDocument(id) {
    var u = currentUser(); if (!u) return false;
    var list = getAllDocuments().filter(function (d) { return !(d.id === id && d.userId === u.id); });
    return write(KEYS.documents, list);
  }

  // ---- Link / redirect safety helpers ----
  function isHttpUrl(url) {
    try {
      var u = new URL(String(url));
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) { return false; }
  }

  // Returns the URL unchanged when it is safe to put in an href (http/https, or file: while browsing from
  // file:// during local preview), otherwise ''. Blocks javascript:, data:, vbscript: and friends.
  function safeHref(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      var u = new URL(url, document.baseURI);
      if (u.protocol === 'http:' || u.protocol === 'https:') return url;
      if (u.protocol === 'file:' && location.protocol === 'file:') return url;
    } catch (e) { /* unparsable */ }
    return '';
  }

  // Validates a post-login redirect target (?next=). Only same-origin pages (clean directory URLs or .html
  // files) are accepted and the result is returned as path+query+hash. Anything else (other origins,
  // protocol-relative or backslash tricks, javascript:/data: URLs, the login/register pages themselves)
  // yields '' so callers can fall back to a default page.
  function safeNext(raw) {
    if (typeof raw !== 'string' || !raw) return '';
    if (/[\u0000-\u001f\u007f\\]/.test(raw)) return '';
    try {
      var u = new URL(raw, location.href);
      if (u.protocol !== location.protocol || u.host !== location.host) return '';
      if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return '';
      if (/\/hesap\/(giris|kayit)\.html$/.test(u.pathname)) return '';
      if (!/(\/|\.html)$/.test(u.pathname)) return '';
      return u.pathname + u.search + u.hash;
    } catch (e) { return ''; }
  }

  // ---- Export / Import (backup and device migration) ----
  function exportAll() {
    var u = currentUser(); if (!u) return null;
    return {
      exportedAt: nowIso(),
      user: sanitize(u),
      history: getHistory(),
      favorites: getFavorites(),
      projects: getProjects(),
      documents: getDocuments()
    };
  }

  function clip(v, max) {
    if (typeof v === 'number' && isFinite(v)) v = String(v);
    return typeof v === 'string' ? v.slice(0, max) : '';
  }
  function validIso(v) {
    var d = typeof v === 'string' ? new Date(v) : null;
    return d && !isNaN(d.getTime()) ? d.toISOString() : nowIso();
  }
  function plainArray(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }
  function newId(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // Restores a file produced by exportAll() into the signed-in account. Every record is re-keyed to the
  // current user, validated and clipped field by field (nothing is copied verbatim), de-duplicated against
  // what the account already holds, and URLs are scheme-checked. The login itself (password hash) is
  // never part of an export, so on a new device the user registers first and imports afterwards.
  function importAll(data) {
    var u = currentUser(); if (!u) throw new Error('Önce giriş yapın.');
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        !(Array.isArray(data.history) || Array.isArray(data.favorites) || Array.isArray(data.projects) || Array.isArray(data.documents))) {
      throw new Error('Geçersiz yedek dosyası.');
    }
    var counts = { history: 0, favorites: 0, projects: 0, documents: 0 };

    // History
    var allHistory = getAllHistory();
    var usedHistoryIds = {}, ownHistoryIds = {}, idMap = {}, addedHistory = [];
    allHistory.forEach(function (h) {
      usedHistoryIds[h.id] = true;
      if (h.userId === u.id) ownHistoryIds[h.id] = true;
    });
    plainArray(data.history, 500).forEach(function (h) {
      if (!h || typeof h !== 'object') return;
      var slug = clip(h.toolSlug, 100);
      var name = clip(h.toolName, 200).trim();
      if (!slug && !name) return;
      var oldId = clip(h.id, 64);
      if (oldId && ownHistoryIds[oldId]) { idMap[oldId] = oldId; return; }
      var id = (/^h_[a-z0-9]+$/i.test(oldId) && !usedHistoryIds[oldId]) ? oldId : newId('h');
      usedHistoryIds[id] = true;
      if (oldId) idMap[oldId] = id;
      var res = h.result && typeof h.result === 'object' ? h.result : {};
      addedHistory.push({
        id: id,
        userId: u.id,
        savedAt: validIso(h.savedAt),
        toolSlug: slug,
        toolName: name || slug,
        toolUrl: safeHref(clip(h.toolUrl, 500)),
        params: plainArray(h.params, 60).filter(function (p) { return p && typeof p === 'object'; }).map(function (p) {
          return { label: clip(p.label, 200), value: clip(p.value, 400) };
        }),
        result: { value: clip(res.value, 300), note: clip(res.note, 1000) },
        note: clip(h.note, 1000)
      });
    });

    // Favorites (one per tool and user)
    var allFavorites = getAllFavorites();
    var ownSlugs = {}, addedFavorites = [];
    allFavorites.forEach(function (f) { if (f.userId === u.id) ownSlugs[f.toolSlug] = true; });
    plainArray(data.favorites, 200).forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var slug = clip(f.toolSlug, 100);
      if (!slug || ownSlugs[slug]) return;
      ownSlugs[slug] = true;
      addedFavorites.push({
        userId: u.id,
        toolSlug: slug,
        toolName: clip(f.toolName, 200).trim() || slug,
        toolUrl: safeHref(clip(f.toolUrl, 500)),
        addedAt: validIso(f.addedAt)
      });
    });

    // Projects (calcIds are remapped to the history ids that now exist in this account)
    var allProjects = getAllProjects();
    var usedProjectIds = {}, ownProjectIds = {}, addedProjects = [];
    allProjects.forEach(function (p) {
      usedProjectIds[p.id] = true;
      if (p.userId === u.id) ownProjectIds[p.id] = true;
    });
    plainArray(data.projects, 200).forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      var name = clip(p.name, 200).trim();
      if (!name) return;
      var oldId = clip(p.id, 64);
      if (oldId && ownProjectIds[oldId]) return;
      var id = (/^p_[a-z0-9]+$/i.test(oldId) && !usedProjectIds[oldId]) ? oldId : newId('p');
      usedProjectIds[id] = true;
      var seen = {};
      var calcIds = plainArray(p.calcIds, 500).map(function (c) {
        c = clip(c, 64);
        return idMap[c] || (ownHistoryIds[c] ? c : '');
      }).filter(function (c) {
        if (!c || seen[c]) return false;
        seen[c] = true;
        return true;
      });
      addedProjects.push({
        id: id,
        userId: u.id,
        name: name,
        description: clip(p.description, 600).trim(),
        calcIds: calcIds,
        createdAt: validIso(p.createdAt)
      });
    });

    // Documents (links must be absolute http(s); anything else is dropped but the entry is kept)
    var allDocuments = getAllDocuments();
    var usedDocIds = {}, ownDocIds = {}, addedDocuments = [];
    allDocuments.forEach(function (d) {
      usedDocIds[d.id] = true;
      if (d.userId === u.id) ownDocIds[d.id] = true;
    });
    plainArray(data.documents, 500).forEach(function (d) {
      if (!d || typeof d !== 'object') return;
      var name = clip(d.name, 200).trim();
      if (!name) return;
      var oldId = clip(d.id, 64);
      if (oldId && ownDocIds[oldId]) return;
      var id = (/^d_[a-z0-9]+$/i.test(oldId) && !usedDocIds[oldId]) ? oldId : newId('d');
      usedDocIds[id] = true;
      var link = clip(d.url, 500).trim();
      addedDocuments.push({
        id: id,
        userId: u.id,
        name: name,
        url: link && isHttpUrl(link) ? link : '',
        note: clip(d.note, 1000).trim(),
        addedAt: validIso(d.addedAt)
      });
    });

    function when(x) { return String(x.savedAt || x.addedAt || x.createdAt || ''); }
    function newestFirst(a, b) { return when(b).localeCompare(when(a)); }
    if (addedHistory.length) {
      if (!write(KEYS.history, addedHistory.concat(allHistory).sort(newestFirst).slice(0, 500))) throw new Error(STORAGE_ERR);
      counts.history = addedHistory.length;
    }
    if (addedFavorites.length) {
      if (!write(KEYS.favorites, addedFavorites.concat(allFavorites))) throw new Error(STORAGE_ERR);
      counts.favorites = addedFavorites.length;
    }
    if (addedProjects.length) {
      if (!write(KEYS.projects, addedProjects.concat(allProjects).sort(newestFirst))) throw new Error(STORAGE_ERR);
      counts.projects = addedProjects.length;
    }
    if (addedDocuments.length) {
      if (!write(KEYS.documents, addedDocuments.concat(allDocuments).sort(newestFirst))) throw new Error(STORAGE_ERR);
      counts.documents = addedDocuments.length;
    }
    return counts;
  }

  // ---- Nav decoration ----
  function decorateNav() {
    setupDocHeaderToggle();
    var user = currentUser();
    var prefix = pathPrefix();
    // Secondary "doc-header__nav" used on subpages (bilgi, akademi, sor, hesaplama, mm, hesap)
    document.querySelectorAll('.doc-header__nav').forEach(function (nav) {
      if (nav.querySelector('[data-vg-account]')) return;
      var link = document.createElement('a');
      link.setAttribute('data-vg-account', '');
      if (user) {
        link.href = prefix + 'hesap/panel.html';
        link.innerHTML = '<i class="fas fa-circle-user" aria-hidden="true"></i> ' + escapeHtml(user.name.split(' ')[0]);
      } else {
        link.href = prefix + 'hesap/giris.html';
        link.innerHTML = '<i class="fas fa-user" aria-hidden="true"></i> Hesabım';
      }
      var cta = nav.querySelector('.btn--accent');
      if (cta) nav.insertBefore(link, cta); else nav.appendChild(link);
    });
    // Main homepage nav uses .nav__menu list of <li> items
    document.querySelectorAll('.nav__menu').forEach(function (nav) {
      if (nav.querySelector('[data-vg-account]')) return;
      var li = document.createElement('li');
      var link = document.createElement('a');
      link.className = 'nav__link';
      link.setAttribute('data-vg-account', '');
      if (user) {
        link.href = prefix + 'hesap/panel.html';
        link.innerHTML = '<i class="fas fa-circle-user" aria-hidden="true"></i> ' + escapeHtml(user.name.split(' ')[0]);
      } else {
        link.href = prefix + 'hesap/giris.html';
        link.innerHTML = '<i class="fas fa-user" aria-hidden="true"></i> Hesabım';
      }
      li.appendChild(link);
      nav.appendChild(li);
    });
    // After the account links exist, so they are prefetched on intent too (runs on every page type).
    prefetchOnIntent();
  }

  // Alt sayfalardaki .doc-header'a mobil hamburger enjekte eder (markup'ı değiştirmeden).
  function setupDocHeaderToggle() {
    document.querySelectorAll('.doc-header__inner').forEach(function (inner) {
      var nav = inner.querySelector('.doc-header__nav');
      if (!nav || inner.querySelector('.doc-header__toggle')) return;
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'doc-header__toggle';
      toggle.setAttribute('aria-label', 'Menüyü aç/kapat');
      toggle.setAttribute('aria-controls', nav.id || '');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span></span><span></span><span></span>';
      inner.appendChild(toggle);

      function close() {
        nav.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
      function open() {
        nav.classList.add('open');
        toggle.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
      }
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        if (nav.classList.contains('open')) close(); else open();
      });
      nav.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', close);
      });
      document.addEventListener('click', function (e) {
        if (!nav.classList.contains('open')) return;
        if (nav.contains(e.target) || toggle.contains(e.target)) return;
        close();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('open')) {
          close();
          toggle.focus();
        }
      });
    });
  }

  // Hover/touch/focus üzerine link hedefini önden indir; tıklamada sayfa anında açılır.
  function prefetchOnIntent() {
    if (!document.head) return;
    var prefetched = {};
    function prefetch(href) {
      if (!href || prefetched[href]) return;
      /* Aynı origin dışı, sadece anchor veya özel şemalar: atla. */
      if (/^(#|mailto:|tel:|javascript:)/i.test(href)) return;
      try {
        var url = new URL(href, document.baseURI);
        if (url.origin !== location.origin) return;
        if (url.pathname === location.pathname) return;
      } catch (e) { return; }
      prefetched[href] = true;
      var link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = href;
      link.as = 'document';
      document.head.appendChild(link);
    }
    var selector = '.doc-header__nav a, .nav__menu a, .kb-card, .mm-card, .kb-libcard';
    document.querySelectorAll(selector).forEach(function (el) {
      var href = el.getAttribute('href');
      if (!href) return;
      var trigger = function () { prefetch(href); };
      el.addEventListener('mouseenter', trigger, { passive: true, once: true });
      el.addEventListener('focus', trigger, { passive: true, once: true });
      el.addEventListener('touchstart', trigger, { passive: true, once: true });
    });
  }

  function pathPrefix() {
    // Prefix that reaches the site root from the current page. Known sub-folders are matched by name
    // (works on file:// too) and resolved against the document base URL, so pages with <base href="/">
    // (hub and calculator pages served at clean /dir/slug/ URLs) correctly get ''.
    var subfolders = { hesaplama: 1, bilgi: 1, akademi: 1, sor: 1, hesap: 1, mm: 1 };
    var baseDir;
    try { baseDir = new URL('.', document.baseURI).pathname; }
    catch (e) { baseDir = location.pathname.replace(/[^/]*$/, ''); }
    var segs = baseDir.replace(/\\/g, '/').split('/').filter(Boolean);
    if (subfolders[segs[segs.length - 1]]) return '../';
    // Clean directory-style URL (/hesaplama/<slug>/) without a <base>: the document directory is the slug.
    if (!document.querySelector('base[href]') && /\/$/.test(location.pathname) &&
        segs.length >= 2 && subfolders[segs[segs.length - 2]]) return '../../';
    return '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  // ---- Public API ----
  var api = {
    KEYS: KEYS,
    register: register,
    login: login,
    logout: logout,
    currentUser: currentUser,
    requireAuth: requireAuth,
    saveHistory: saveHistory,
    getHistory: getHistory,
    deleteHistory: deleteHistory,
    getFavorites: getFavorites,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    createProject: createProject,
    getProjects: getProjects,
    deleteProject: deleteProject,
    attachCalcToProject: attachCalcToProject,
    addDocument: addDocument,
    getDocuments: getDocuments,
    deleteDocument: deleteDocument,
    exportAll: exportAll,
    importAll: importAll,
    safeNext: safeNext,
    safeHref: safeHref,
    decorateNav: decorateNav,
    pathPrefix: pathPrefix
  };

  global.VG = global.VG || {};
  global.VG.Auth = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decorateNav);
  } else {
    decorateNav();
  }
}(window));
