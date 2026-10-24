/* hesap/giris.html sayfa betiği. CSP için satır içinden taşındı (script-src 'self'); DOM hazır olduktan sonra, sayfa sonunda yüklenir. */
(function () {
  'use strict';
  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) {
    var failEl = document.getElementById('giris-alert');
    failEl.className = 'vg-acct-alert vg-acct-alert--error';
    failEl.setAttribute('role', 'alert');
    failEl.textContent = 'Sayfa tam yüklenemedi. Lütfen bağlantınızı kontrol edip sayfayı yenileyin.';
    failEl.hidden = false;
    return;
  }
  var Auth = window.VG.Auth;
  var UI = window.VG.AccountUI;
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  /* ?next= yalnızca aynı site içindeki sayfalara izin verir (açık yönlendirme ve javascript: engeli). */
  var next = Auth.safeNext(params.get('next'));
  var dest = next || 'panel.html';
  var form = $('giris-form');
  var alertEl = $('giris-alert');
  var submitBtn = form.querySelector('button[type="submit"]');
  var emailIn = $('email');
  var pwIn = $('password');

  $('remember').setAttribute('aria-describedby', 'remember-hint');
  if (next) $('kayit-link').href = 'kayit.html?next=' + encodeURIComponent(next);

  var flash = Auth.takeFlash();
  if (flash) UI.alertBox(alertEl, flash.kind === 'error' ? 'error' : flash.kind, flash.text);

  /* E-posta, şifre sıfırlama sayfasına adres çubuğu yerine sekme belleğiyle taşınır (URL'de kişisel veri olmaz). */
  $('forgot-link').addEventListener('click', function () {
    try { sessionStorage.setItem('vg_reset_email', emailIn.value.trim().slice(0, 254)); } catch (e) { /* depolama kapalı */ }
  });

  /* Eski sürümde yalnızca bu tarayıcıda tutulan hesap verisi varsa bilgilendir. Taşıma seçeneği ve e-posta ön
     doldurması yalnızca bu tarayıcıda kaydı olan TEK eski hesap varsa gösterilir; birden fazla eski hesap varsa
     seçim, giriş yaptıktan sonra panelde yapılır (başkasının verisi taşınmaz, başkasının adresi gösterilmez). */
  var legacy = Auth.legacy.detect();
  var legacyWho = null;
  if (legacy && legacy.total) {
    legacyWho = Auth.legacy.pick(legacy);
    var box = $('legacy-box');
    if (legacyWho) {
      box.innerHTML = '<i class="fas fa-circle-info" aria-hidden="true"></i><div class="vg-acct-alert__body">' +
        '<p><strong>Hesap sistemimiz yenilendi.</strong> Bu tarayıcıda eski VoltGuard hesabınıza ait ' + legacyWho.total + ' kayıt bulundu. ' +
        'Eski hesaplar yalnızca bu tarayıcıda tutulduğu için artık giriş için kullanılamıyor; kayıtlarınız ise kaybolmadı.</p>' +
        '<p>Yeni hesabınızla giriş yaptığınızda bu kayıtları hesabınıza taşıyabilirsiniz. Henüz yeni hesabınız yoksa <a href="kayit.html?aktar=1">ücretsiz hesap oluşturun</a>.</p></div>';
      $('legacy-opt').hidden = false;
      $('legacy-opt-text').textContent = 'Bu tarayıcıdaki eski kayıtlarımı (' + legacyWho.total + ') hesabıma taşı';
      if (legacyWho.email && !emailIn.value) emailIn.value = legacyWho.email;
    } else {
      box.innerHTML = '<i class="fas fa-circle-info" aria-hidden="true"></i><div class="vg-acct-alert__body">' +
        '<p><strong>Hesap sistemimiz yenilendi.</strong> Bu tarayıcıda birden fazla eski VoltGuard hesabına ait kayıt bulundu. ' +
        'Eski hesaplar artık giriş için kullanılamıyor; kayıtlar ise kaybolmadı.</p>' +
        '<p>Giriş yaptıktan sonra Hesabım sayfasındaki “Bu tarayıcıdaki eski kayıtlarınız” bölümünden kendi eski hesabınızı seçip kayıtlarını taşıyabilirsiniz. Henüz yeni hesabınız yoksa <a href="kayit.html?aktar=1">ücretsiz hesap oluşturun</a>.</p></div>';
    }
    box.hidden = false;
  }

  /* Giriş yapmadan bu tarayıcıya kaydedilen favori ve hesaplamalar: hesaba eklenip eklenmeyeceği sorulur. */
  var guest = Auth.guestCounts();
  if (guest.favorites + guest.history) {
    var parts = [];
    if (guest.favorites) parts.push(guest.favorites + ' favori');
    if (guest.history) parts.push(guest.history + ' hesaplama');
    $('guest-opt-text').textContent = 'Bu tarayıcıda giriş yapmadan kaydedilen kayıtları (' + parts.join(', ') + ') hesabıma ekle. İşaretlemezseniz yalnızca bu tarayıcıda kalır.';
    $('guest-opt').hidden = false;
  }

  /* Zaten giriş yapılmışsa doğrudan hedefe git. API'ye ulaşılamıyorsa form açık kalır ve uyarı gösterilir. */
  Auth.session({ force: true }).then(function (user) {
    if (user) location.replace(dest);
  }, function (e) {
    if (e && e.code === 'unreachable') UI.alertBox(alertEl, 'warning', UI.errorMessage(e));
  });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    UI.clearAlert(alertEl);
    var errors = {};
    if (!UI.validEmail(emailIn.value)) errors.email = 'Geçerli bir e-posta adresi girin.';
    if (!pwIn.value) errors.password = 'Şifrenizi girin.';
    if (Object.keys(errors).length) {
      UI.showFormError(form, alertEl, { message: 'Lütfen işaretli alanları kontrol edin.' }, errors);
      return;
    }
    UI.clearFieldErrors(form);
    UI.busy(submitBtn, true, 'Giriş yapılıyor…');
    var mergeGuest = !$('guest-opt').hidden && $('guest-merge').checked;
    var migrateLegacy = !!legacyWho && !$('legacy-opt').hidden && $('legacy').checked;
    Auth.login(emailIn.value, pwIn.value, { remember: $('remember').checked, mergeGuest: mergeGuest }).then(function () {
      if (!migrateLegacy) return null;
      return Auth.legacy.migrate(legacyWho.id).then(function (c) {
        var n = c.history + c.favorites + c.projects + c.documents;
        Auth.setFlash('success', n ? 'Eski kayıtlarınızdan ' + n + ' tanesi hesabınıza taşındı.' : 'Eski kayıtlarınız hesabınızda zaten vardı.', true);
      }, function () {
        Auth.setFlash('warning', 'Giriş yaptınız ancak eski kayıtlarınız şu anda taşınamadı. Panelden tekrar deneyebilirsiniz.', true);
      });
    }).then(function () {
      location.replace(dest);
    }, function (e) {
      UI.busy(submitBtn, false);
      if (e && e.code === 'invalid_credentials') {
        pwIn.value = '';
        UI.showFormError(form, alertEl, e, { password: 'E-posta adresi veya şifre hatalı.' });
        return;
      }
      UI.showFormError(form, alertEl, e);
    });
  });
  UI.enableSubmit(form);
}());
