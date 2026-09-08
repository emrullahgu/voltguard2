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
  function clearSession() { localStorage.removeItem(KEYS.session); }

  function findUserByEmail(email) {
    var e = normalizeEmail(email);
    return getUsers().find(function (u) { return u.email === e; }) || null;
  }
  function findUserById(id) {
    return getUsers().find(function (u) { return u.id === id; }) || null;
  }

  async function register(name, email, password) {
    var e = normalizeEmail(email);
    if (!name || !e || !password) throw new Error('Ad, e-posta ve şifre gereklidir.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('Geçerli bir e-posta girin.');
    if (password.length < 8) throw new Error('Şifre en az 8 karakter olmalı.');
    if (findUserByEmail(e)) throw new Error('Bu e-posta zaten kayıtlı.');
    var salt = makeSalt();
    var hash = await hashPassword(password, salt);
    var user = { id: uid(), email: e, name: name.trim(), salt: salt, hash: hash, createdAt: nowIso() };
    var users = getUsers();
    users.push(user);
    saveUsers(users);
    saveSession({ userId: user.id, loginAt: nowIso() });
    return sanitize(user);
  }

  async function login(email, password) {
    var user = findUserByEmail(email);
    if (!user) throw new Error('Kullanıcı bulunamadı.');
    var hash = await hashPassword(password, user.salt);
    if (hash !== user.hash) throw new Error('Şifre hatalı.');
    saveSession({ userId: user.id, loginAt: nowIso() });
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
    var target = redirectTo || 'giris.html';
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
    write(KEYS.history, list.slice(0, 500));
    return item;
  }
  function deleteHistory(id) {
    var u = currentUser(); if (!u) return false;
    var list = getAllHistory().filter(function (h) { return !(h.id === id && h.userId === u.id); });
    write(KEYS.history, list);
    return true;
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
    if (exists >= 0) { list.splice(exists, 1); write(KEYS.favorites, list); return false; }
    list.unshift({ userId: u.id, toolSlug: toolSlug, toolName: toolName, toolUrl: toolUrl, addedAt: nowIso() });
    write(KEYS.favorites, list);
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
    write(KEYS.projects, list);
    return p;
  }
  function attachCalcToProject(projectId, historyId) {
    var u = currentUser(); if (!u) return false;
    var list = getAllProjects();
    var idx = list.findIndex(function (p) { return p.id === projectId && p.userId === u.id; });
    if (idx < 0) return false;
    if (!list[idx].calcIds.includes(historyId)) list[idx].calcIds.push(historyId);
    write(KEYS.projects, list);
    return true;
  }
  function deleteProject(projectId) {
    var u = currentUser(); if (!u) return false;
    var list = getAllProjects().filter(function (p) { return !(p.id === projectId && p.userId === u.id); });
    write(KEYS.projects, list);
    return true;
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
    var list = getAllDocuments();
    var doc = { id: 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), userId: u.id, name: name.trim(), url: (url || '').trim(), note: (note || '').trim(), addedAt: nowIso() };
    list.unshift(doc);
    write(KEYS.documents, list);
    return doc;
  }
  function deleteDocument(id) {
    var u = currentUser(); if (!u) return false;
    var list = getAllDocuments().filter(function (d) { return !(d.id === id && d.userId === u.id); });
    write(KEYS.documents, list);
    return true;
  }

  // ---- Export / Import (device migration) ----
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

  // ---- Nav decoration ----
  function decorateNav() {
    var navs = document.querySelectorAll('.doc-header__nav');
    if (!navs.length) return;
    var user = currentUser();
    navs.forEach(function (nav) {
      if (nav.querySelector('[data-vg-account]')) return;
      var link = document.createElement('a');
      link.setAttribute('data-vg-account', '');
      if (user) {
        link.href = pathPrefix() + 'hesap/panel.html';
        link.innerHTML = '<i class="fas fa-circle-user" aria-hidden="true"></i> ' + escapeHtml(user.name.split(' ')[0]);
      } else {
        link.href = pathPrefix() + 'hesap/giris.html';
        link.innerHTML = '<i class="fas fa-user" aria-hidden="true"></i> Hesabım';
      }
      // insert before the CTA button (last child) if any
      var cta = nav.querySelector('.btn--accent');
      if (cta) nav.insertBefore(link, cta); else nav.appendChild(link);
    });
  }

  function pathPrefix() {
    // Compute relative prefix based on current path depth (assumes /hesaplama/, /bilgi/, /akademi/, /sor/, /hesap/ subfolders).
    var p = location.pathname.replace(/\\/g, '/');
    var segs = p.split('/').filter(Boolean);
    if (segs.length >= 2) return '../';
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
