/* =====================================================
   VoltGuard – vg-account.js
   Hesap sayfalarının (hesap/*.html) ortak arayüz yardımcıları: form doğrulama ve hata gösterimi,
   şifre göster/gizle, durum kutuları, yükleniyor/hata/boş hâlleri, onay diyaloğu, hesap menüsü,
   senkron göstergesi. VG.Auth'a (js/voltguard-auth.js) bağımlıdır; ondan SONRA yüklenmelidir.
   Genel API: window.VG.AccountUI
   ===================================================== */
(function (global) {
  'use strict';

  var doc = document;
  var Auth = global.VG && global.VG.Auth;
  var leaving = false;   // çıkış / hesap silme sırasında "oturum kapandı" yönlendirmesi yapılmaz
  function setLeaving(v) { leaving = !!v; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c];
    });
  }
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

  function fmtDate(iso) {
    var d = iso ? new Date(iso) : null;
    return d && !isNaN(d.getTime()) ? d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  }
  function fmtDateTime(iso) {
    var d = iso ? new Date(iso) : null;
    return d && !isNaN(d.getTime()) ? d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function plural(n, word) { return n + ' ' + word; }

  var ICONS = { error: 'fa-circle-exclamation', success: 'fa-circle-check', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };

  /* ---------------------------------------------------------------- durum kutusu */
  // kind: error | success | info | warning. opts.focus: kutuya odaklan. opts.html: güvenli ek içerik (ör. düğme).
  function alertBox(el, kind, message, opts) {
    if (!el) return;
    opts = opts || {};
    el.className = 'vg-acct-alert vg-acct-alert--' + kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = '<i class="fas ' + (ICONS[kind] || ICONS.info) + '" aria-hidden="true"></i>' +
      '<div class="vg-acct-alert__body"><p>' + esc(message) + '</p>' + (opts.html || '') + '</div>';
    el.hidden = false;
    if (opts.focus) { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: false }); }
  }
  function clearAlert(el) { if (el) { el.hidden = true; el.innerHTML = ''; } }

  function errorMessage(e) {
    if (!e) return 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
    if (e.code === 'unreachable') return (Auth && Auth.MESSAGES.down) || 'Hesap sistemine şu anda ulaşılamıyor.';
    return e.message || 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
  }

  /* ---------------------------------------------------------------- alan hataları */
  function fieldInput(form, name) {
    var el = form.elements[name];
    if (el && typeof el.length === 'number' && !el.tagName) el = el[0];
    return el && el.tagName ? el : null;
  }
  function clearFieldErrors(form) {
    $$('.vg-field-error', form).forEach(function (p) {
      var input = form.querySelector('[aria-describedby~="' + p.id + '"]');
      if (input) {
        var ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (x) { return x && x !== p.id; });
        if (ids.length) input.setAttribute('aria-describedby', ids.join(' ')); else input.removeAttribute('aria-describedby');
      }
      p.remove();
    });
    $$('[aria-invalid="true"]', form).forEach(function (el) { el.removeAttribute('aria-invalid'); });
  }
  // fields: { alanAdı: 'mesaj' }. İlk hatalı alanı döndürür.
  function setFieldErrors(form, fields) {
    clearFieldErrors(form);
    var first = null;
    Object.keys(fields || {}).forEach(function (name) {
      var input = fieldInput(form, name);
      if (!input) return;
      var id = (input.id || name) + '-hata';
      var p = doc.createElement('p');
      p.className = 'vg-field-error';
      p.id = id;
      p.innerHTML = '<i class="fas fa-circle-exclamation" aria-hidden="true"></i><span>' + esc(fields[name]) + '</span>';
      var holder = input.closest('.vg-field') || input.closest('.vg-check') || input.parentNode;
      if (holder.classList && holder.classList.contains('vg-check')) holder.parentNode.insertBefore(p, holder.nextSibling);
      else holder.appendChild(p);
      input.setAttribute('aria-invalid', 'true');
      var desc = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      desc.push(id);
      input.setAttribute('aria-describedby', desc.join(' '));
      if (!first) first = input;
    });
    return first;
  }
  // Sunucu/istemci hatasını formda gösterir: alan hataları varsa ilk alana, yoksa durum kutusuna odaklanır.
  function showFormError(form, alertEl, e, fallbackFields) {
    var fields = (e && e.fields) || fallbackFields || null;
    var first = fields ? setFieldErrors(form, fields) : null;
    alertBox(alertEl, 'error', errorMessage(e), { focus: !first });
    if (first) first.focus();
  }

  /* ---------------------------------------------------------------- doğrulama kuralları (sunucunun aynası) */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function validEmail(v) { v = String(v || '').trim(); return v.length <= 254 && EMAIL_RE.test(v); }
  function passwordProblem(pw) {
    pw = String(pw || '');
    if (!pw) return 'Şifre girin.';
    if (pw.length < 8) return 'Şifre en az 8 karakter olmalı.';
    if (pw.length > 64 || new TextEncoder().encode(pw).length > 72) return 'Şifre en fazla 64 karakter olabilir.';
    if (!/\p{L}/u.test(pw) || !/\p{Nd}/u.test(pw)) return 'Şifre en az bir harf ve bir rakam içermeli.';
    return '';
  }
  function phoneProblem(v) {
    v = String(v || '').trim();
    if (!v) return '';
    var digits = v.replace(/\D+/g, '');
    if (v.length > 32 || !/^\+?[0-9 ()\-.]+$/.test(v) || digits.length < 7 || digits.length > 15) return 'Geçerli bir telefon numarası girin (örn. 0 5xx xxx xx xx).';
    return '';
  }
  function nameProblem(v) {
    v = String(v || '').replace(/\s+/g, ' ').trim();
    if (v.length < 2) return 'Ad soyad en az 2 karakter olmalı.';
    if (v.length > 80) return 'Ad soyad en fazla 80 karakter olabilir.';
    if (!/\p{L}/u.test(v)) return 'Lütfen geçerli bir ad soyad girin.';
    if (/[:\/@<>\\]/.test(v)) return 'Ad soyad alanında : / @ < > \\ karakterleri kullanılamaz.';
    return '';
  }

  /* ---------------------------------------------------------------- şifre göster/gizle + kural listesi */
  function initPasswordToggles(ctx) {
    $$('[data-vg-pw-toggle]', ctx).forEach(function (btn) {
      if (btn.__vg) return;
      btn.__vg = 1;
      var input = doc.getElementById(btn.getAttribute('aria-controls'));
      if (!input) return;
      btn.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        btn.setAttribute('aria-label', show ? 'Şifreyi gizle' : 'Şifreyi göster');
        btn.innerHTML = '<i class="fas ' + (show ? 'fa-eye-slash' : 'fa-eye') + '" aria-hidden="true"></i>';
        input.focus();
      });
    });
  }
  function bindPasswordRules(input, list) {
    if (!input || !list) return;
    function upd() {
      var v = input.value;
      var rules = { len: v.length >= 8 && v.length <= 64, mix: /\p{L}/u.test(v) && /\p{Nd}/u.test(v) };
      $$('[data-rule]', list).forEach(function (li) {
        var ok = !!rules[li.getAttribute('data-rule')];
        li.classList.toggle('is-ok', ok);
        var sr = li.querySelector('.vg-sr-only');
        if (sr) sr.textContent = ok ? ' (karşılandı)' : ' (henüz karşılanmadı)';
      });
    }
    input.addEventListener('input', upd);
    upd();
  }

  /* ---------------------------------------------------------------- düğme meşgul hâli */
  function busy(btn, on, text) {
    if (!btn) return;
    if (on) {
      if (!btn.hasAttribute('data-vg-label')) btn.setAttribute('data-vg-label', btn.innerHTML);
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.innerHTML = '<span class="vg-spinner" aria-hidden="true"></span> ' + esc(text || 'İşleniyor…');
    } else {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (btn.hasAttribute('data-vg-label')) { btn.innerHTML = btn.getAttribute('data-vg-label'); btn.removeAttribute('data-vg-label'); }
    }
  }

  /* ---------------------------------------------------------------- onay diyaloğu */
  // Promise<boolean>. <dialog> desteklenmiyorsa tarayıcının confirm() penceresi kullanılır.
  function confirmDialog(opts) {
    opts = opts || {};
    if (typeof HTMLDialogElement !== 'function') return Promise.resolve(global.confirm(opts.message || opts.title || 'Emin misiniz?'));
    return new Promise(function (resolve) {
      var opener = doc.activeElement;
      var dlg = doc.createElement('dialog');
      var uid = 'vgdlg' + Date.now().toString(36);
      dlg.className = 'vg-dialog';
      dlg.setAttribute('aria-labelledby', uid + '-t');
      dlg.setAttribute('aria-describedby', uid + '-m');
      dlg.innerHTML = '<form method="dialog">' +
        '<h2 id="' + uid + '-t">' + esc(opts.title || 'Emin misiniz?') + '</h2>' +
        '<p id="' + uid + '-m">' + esc(opts.message || '') + '</p>' +
        '<div class="vg-dialog__actions">' +
        '<button type="submit" value="cancel" class="vg-btn vg-btn--ghost">' + esc(opts.cancelText || 'Vazgeç') + '</button>' +
        '<button type="submit" value="ok" class="vg-btn ' + (opts.danger ? 'vg-btn--danger' : 'vg-btn--primary') + '">' + esc(opts.confirmText || 'Onayla') + '</button>' +
        '</div></form>';
      doc.body.appendChild(dlg);
      dlg.addEventListener('close', function () {
        var ok = dlg.returnValue === 'ok';
        dlg.remove();
        if (opener && opener.focus && doc.contains(opener)) opener.focus();
        resolve(ok);
      });
      dlg.showModal();
    });
  }

  /* ---------------------------------------------------------------- hesap menüsü + senkron göstergesi */
  function initNav(page, user) {
    var nav = $('[data-vg-acct-nav]');
    if (!nav) return;
    $$('a[data-vg-nav]', nav).forEach(function (a) {
      var on = a.getAttribute('data-vg-nav') === page;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $$('[data-vg-member]', nav).forEach(function (el) { el.hidden = !user; });
    var guest = $('[data-vg-guest]', nav);
    if (guest) {
      guest.hidden = !!user;
      $$('a[data-vg-login]', guest).forEach(function (a) { a.href = Auth.loginUrl(location.pathname); });
    }
    var out = $('[data-vg-logout]', nav);
    if (out && !out.__vg) {
      out.__vg = 1;
      out.addEventListener('click', function () {
        busy(out, true, 'Çıkış yapılıyor…');
        leaving = true;
        Auth.logout().then(function () {
          Auth.setFlash('success', 'Çıkış yaptınız. Tekrar görüşmek üzere!');
          location.replace('giris.html');
        }, function (e) {
          leaving = false;
          busy(out, false);
          var al = $('[data-vg-alert]');
          alertBox(al, 'error', 'Çıkış yapılamadı: ' + errorMessage(e), { focus: true });
        });
      });
    }
    initSync($('[data-vg-sync]', nav), !!user);
  }

  function initSync(el, member) {
    if (!el) return;
    function render(d) {
      if (!member || !Auth.isLoggedIn()) { el.textContent = ''; return; }
      var s = d || Auth.syncState();
      el.className = 'vg-sync';
      if (s.status === 'saving' || s.status === 'pending') {
        el.innerHTML = '<span class="vg-spinner" aria-hidden="true"></span> Değişiklikler kaydediliyor…';
      } else if (s.status === 'offline' || s.status === 'error') {
        el.classList.add('vg-sync--error');
        el.innerHTML = '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i><span>' + esc(s.message || 'Değişiklikler kaydedilemedi.') + ' <button type="button">Tekrar dene</button></span>';
        el.querySelector('button').addEventListener('click', function () { Auth.flush().catch(function () {}); });
      } else {
        el.classList.add('vg-sync--ok');
        el.innerHTML = '<i class="fas fa-circle-check" aria-hidden="true"></i> Tüm değişiklikler hesabınıza kaydedildi';
      }
    }
    doc.addEventListener('vg:sync', function (e) { render(e.detail); });
    render();
  }

  /* ---------------------------------------------------------------- sayfa kapısı (yükleniyor / hata) */
  function gateLoading(gate, text) {
    if (!gate) return;
    gate.hidden = false;
    gate.innerHTML = '<div class="vg-section vg-acct-loading" role="status"><span class="vg-spinner" aria-hidden="true"></span> ' + esc(text || 'Hesabınız yükleniyor…') + '</div>';
  }
  function gateError(gate, e, onRetry) {
    if (!gate) return;
    gate.hidden = false;
    var down = e && e.code === 'unreachable';
    gate.innerHTML = '<div class="vg-section vg-acct-state vg-acct-state--error" role="alert">' +
      '<span class="vg-acct-state__icon" aria-hidden="true"><i class="fas ' + (down ? 'fa-triangle-exclamation' : 'fa-circle-exclamation') + '"></i></span>' +
      '<h2>' + (down ? 'Hesap sistemine ulaşılamıyor' : 'Hesap bilgileri yüklenemedi') + '</h2>' +
      '<p>' + esc(errorMessage(e)) + '</p>' +
      '<button type="button" class="vg-btn vg-btn--primary"><i class="fas fa-arrows-rotate" aria-hidden="true"></i> Tekrar dene</button></div>';
    gate.querySelector('button').addEventListener('click', function () { if (onRetry) onRetry(); else location.reload(); });
  }

  /*
   * Hesap sayfasını başlatır.
   *   opts.page        menüde işaretlenecek sayfa (panel | gecmis | favoriler | projeler | dokumanlar)
   *   opts.protected   true: oturum yoksa giriş sayfasına yönlendirilir
   *   opts.collections yüklenecek veri koleksiyonları
   *   opts.onReady(ctx) veri hazır olunca çağrılır (hata sonrası "Tekrar dene" başarılı olursa yine çağrılır);
   *                    ctx = { user, apiDown }. İçerik ([data-vg-content]) bu noktada görünür olur.
   */
  function initPage(opts) {
    opts = opts || {};
    var gate = $('[data-vg-gate]');
    var content = $('[data-vg-content]');
    var alertEl = $('[data-vg-alert]');
    var flash = Auth.takeFlash();
    if (flash && alertEl) alertBox(alertEl, flash.kind === 'error' ? 'error' : (flash.kind || 'info'), flash.text);
    if (content) content.hidden = true;
    gateLoading(gate);
    initNav(opts.page, Auth.currentUser());
    var wasMember = false;
    var memberId = null;
    // Başka sekmede çıkış yapıldı / oturum süresi doldu: korumalı sayfa giriş ekranına, diğerleri misafir görünümüne geçer.
    // Bu tarayıcıda başka bir hesaba geçildiyse sayfa o hesabın verisiyle yeniden yüklenir.
    doc.addEventListener('vg:auth', function (e) {
      var u = e.detail && e.detail.user;
      if (!wasMember || leaving) return;
      if (!u) {
        if (opts.protected) {
          Auth.setFlash('info', 'Oturumunuz kapatıldı. Devam etmek için yeniden giriş yapın.');
          location.replace(Auth.loginUrl(location.pathname + location.search));
        } else {
          location.reload();
        }
      } else if (memberId && u.id !== memberId) {
        location.reload();
      }
    });

    function start() {
      var who = opts.protected ? Auth.requireAuth() : Auth.session({ force: true }).catch(function (e) {
        // Misafir kullanılabilen sayfalar API'ye ulaşılamasa da bu tarayıcıdaki kayıtları gösterir.
        if (e && e.code === 'unreachable') return { __down: e };
        throw e;
      });
      who.then(function (user) {
        var down = user && user.__down;
        if (down) user = null;
        initNav(opts.page, user);
        var load = user ? Auth.loadData(opts.collections || [], { fresh: true }) : Promise.resolve();
        return load.then(function () {
          // Oturum, kontrol ile veri yükleme arasında sona erdiyse korumalı sayfa giriş ekranına döner.
          if (user && !Auth.isLoggedIn() && !leaving) {
            if (opts.protected) {
              Auth.setFlash('info', 'Oturumunuzun süresi doldu. Lütfen yeniden giriş yapın.');
              location.replace(Auth.loginUrl(location.pathname + location.search));
              return;
            }
            user = null;
            initNav(opts.page, null);
          }
          if (gate) { gate.hidden = true; gate.innerHTML = ''; }
          if (content) content.hidden = false;
          if (down && alertEl) alertBox(alertEl, 'warning', 'Hesap sistemine şu anda ulaşılamıyor; yalnızca bu tarayıcıda kayıtlı veriler gösteriliyor.');
          wasMember = !!user;
          memberId = user ? user.id : null;
          if (opts.onReady) opts.onReady({ user: user, apiDown: !!down });
        });
      }).catch(function (e) {
        if (content) content.hidden = true;
        gateError(gate, e, function () { gateLoading(gate); start(); });
      });
    }
    start();
  }

  global.VG = global.VG || {};
  global.VG.AccountUI = {
    esc: esc,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    plural: plural,
    alertBox: alertBox,
    clearAlert: clearAlert,
    errorMessage: errorMessage,
    setFieldErrors: setFieldErrors,
    clearFieldErrors: clearFieldErrors,
    showFormError: showFormError,
    validEmail: validEmail,
    passwordProblem: passwordProblem,
    phoneProblem: phoneProblem,
    nameProblem: nameProblem,
    initPasswordToggles: initPasswordToggles,
    bindPasswordRules: bindPasswordRules,
    busy: busy,
    confirmDialog: confirmDialog,
    initNav: initNav,
    initPage: initPage,
    setLeaving: setLeaving,
    gateLoading: gateLoading,
    gateError: gateError
  };

  /* ---------------------------------------------------------------- adres çubuğu temizliği */
  // Formlar JavaScript yüklenmeden gönderilirse (yavaş bağlantı, betik hatası) tarayıcı alanları adres çubuğuna
  // yazabilir. Bu tür kişisel alanlar geçmişte ve paylaşılan bağlantılarda kalmasın diye hemen silinir.
  var SENSITIVE_PARAMS = ['password', 'password2', 'current', 'email', 'username', 'name', 'company', 'phone', 'website', 'consent', 'remember', 'legacy', 'guest'];
  function scrubUrl() {
    if (!location.search) return false;
    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { return false; }
    var hit = false;
    SENSITIVE_PARAMS.forEach(function (k) { if (params.has(k)) { params.delete(k); hit = true; } });
    if (!hit) return false;
    var q = params.toString();
    try { history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash); } catch (e) { /* eski tarayıcı */ }
    return true;
  }
  scrubUrl();

  // Gönderim düğmeleri HTML'de "disabled" gelir (betik yüklenmeden gönderim olmasın); sayfa betiği olay dinleyicisini
  // bağladıktan sonra bu işlevle açılır.
  function enableSubmit(form) {
    if (!form) return;
    $$('button[type="submit"][data-vg-wait]', form).forEach(function (b) { b.disabled = false; b.removeAttribute('data-vg-wait'); });
  }
  global.VG.AccountUI.enableSubmit = enableSubmit;
  global.VG.AccountUI.scrubUrl = scrubUrl;

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { initPasswordToggles(doc); });
  else initPasswordToggles(doc);
}(window));
