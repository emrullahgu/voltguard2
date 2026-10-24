/* hesap/kayit.html sayfa betiği. CSP için satır içinden taşındı (script-src 'self'); DOM hazır olduktan sonra, sayfa sonunda yüklenir. */
(function () {
  'use strict';
  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) {
    var failEl = document.getElementById('kayit-alert');
    failEl.className = 'vg-acct-alert vg-acct-alert--error';
    failEl.setAttribute('role', 'alert');
    failEl.textContent = 'Sayfa tam yüklenemedi. Lütfen bağlantınızı kontrol edip sayfayı yenileyin.';
    failEl.hidden = false;
    return;
  }
  var Auth = window.VG.Auth;
  var UI = window.VG.AccountUI;
  var params = new URLSearchParams(location.search);
  /* ?next= yalnızca aynı site içindeki sayfalara izin verir (açık yönlendirme ve javascript: engeli). */
  var next = Auth.safeNext(params.get('next'));
  var dest = next || 'panel.html';
  var form = document.getElementById('kayit-form');
  var alertEl = document.getElementById('kayit-alert');
  var submitBtn = form.querySelector('button[type="submit"]');
  var $ = function (id) { return document.getElementById(id); };

  if (next) $('giris-link').href = 'giris.html?next=' + encodeURIComponent(next);
  UI.bindPasswordRules($('password'), $('pw-rules'));

  /* Eski sürüm kayıtları: taşıma seçeneği ve ad / e-posta ön doldurması yalnızca bu tarayıcıda kaydı olan TEK eski
     hesap varsa gösterilir. Birden fazla eski hesap varsa seçim, hesap oluşturulduktan sonra panelde yapılır. */
  var legacy = Auth.legacy.detect();
  var legacyWho = null;
  if (legacy && legacy.total) {
    legacyWho = Auth.legacy.pick(legacy);
    var box = $('legacy-box');
    if (legacyWho) {
      box.innerHTML = '<i class="fas fa-circle-info" aria-hidden="true"></i><div class="vg-acct-alert__body">' +
        '<p><strong>Eski kayıtlarınız bu tarayıcıda duruyor.</strong> Hesap sistemimiz yenilendi; eski hesabınıza ait ' + legacyWho.total +
        ' kayıt (hesaplama, favori, proje, doküman) yeni hesabınıza taşınabilir. Eski şifreniz taşınmaz, yeni bir şifre belirleyin.</p></div>';
      $('legacy-opt').hidden = false;
      $('legacy-opt-text').textContent = 'Bu tarayıcıdaki eski kayıtlarımı (' + legacyWho.total + ') yeni hesabıma taşı';
      if (legacyWho.name && !$('name').value) $('name').value = legacyWho.name;
      if (legacyWho.email && !$('email').value) $('email').value = legacyWho.email;
    } else {
      box.innerHTML = '<i class="fas fa-circle-info" aria-hidden="true"></i><div class="vg-acct-alert__body">' +
        '<p><strong>Eski kayıtlar bu tarayıcıda duruyor.</strong> Hesap sistemimiz yenilendi; bu tarayıcıda birden fazla eski hesaba ait kayıt bulundu. ' +
        'Hesabınızı oluşturduktan sonra Hesabım sayfasındaki “Bu tarayıcıdaki eski kayıtlarınız” bölümünden kendi eski hesabınızı seçip kayıtlarını taşıyabilirsiniz.</p></div>';
    }
    box.hidden = false;
  }

  /* Giriş yapmadan bu tarayıcıya kaydedilen favori ve hesaplamalar: yeni hesaba eklenip eklenmeyeceği sorulur. */
  var guest = Auth.guestCounts();
  if (guest.favorites + guest.history) {
    var parts = [];
    if (guest.favorites) parts.push(guest.favorites + ' favori');
    if (guest.history) parts.push(guest.history + ' hesaplama');
    $('guest-opt-text').textContent = 'Bu tarayıcıda giriş yapmadan kaydedilen kayıtları (' + parts.join(', ') + ') yeni hesabıma ekle. İşaretlemezseniz yalnızca bu tarayıcıda kalır.';
    $('guest-opt').hidden = false;
  }

  Auth.session({ force: true }).then(function (user) {
    if (user) location.replace(dest);
  }, function (e) {
    if (e && e.code === 'unreachable') UI.alertBox(alertEl, 'warning', UI.errorMessage(e));
  });

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    UI.clearAlert(alertEl);
    var errors = {};
    var p1 = $('password').value, p2 = $('password2').value;
    var nameErr = UI.nameProblem($('name').value);
    if (nameErr) errors.name = nameErr;
    if (!UI.validEmail($('email').value)) errors.email = 'Geçerli bir e-posta adresi girin.';
    var pwErr = UI.passwordProblem(p1);
    if (pwErr) errors.password = pwErr;
    if (!pwErr && p1 !== p2) errors.password2 = 'Şifreler eşleşmiyor.';
    var phoneErr = UI.phoneProblem($('phone').value);
    if (phoneErr) errors.phone = phoneErr;
    if ($('company').value.trim().length > 120) errors.company = 'Firma adı en fazla 120 karakter olabilir.';
    if (Object.keys(errors).length) {
      UI.showFormError(form, alertEl, { message: 'Lütfen işaretli alanları kontrol edin.' }, errors);
      return;
    }
    UI.clearFieldErrors(form);
    UI.busy(submitBtn, true, 'Hesabınız oluşturuluyor…');
    var mergeGuest = !$('guest-opt').hidden && $('guest-merge').checked;
    var migrateLegacy = !!legacyWho && !$('legacy-opt').hidden && $('legacy').checked;
    Auth.register({
      name: $('name').value,
      email: $('email').value,
      password: p1,
      company: $('company').value,
      phone: $('phone').value,
      consent: true,
      website: $('website').value,
      mergeGuest: mergeGuest
    }).then(function (res) {
      var merged = res && res.merged;
      var mergedN = merged ? merged.favorites + merged.history : 0;
      Auth.setFlash('success', 'Hesabınız oluşturuldu, hoş geldiniz!' + (mergedN ? ' Bu cihazda kaydettiğiniz ' + mergedN + ' kayıt hesabınıza eklendi.' : ''));
      if (!migrateLegacy) return null;
      return Auth.legacy.migrate(legacyWho.id).then(function (c) {
        var n = c.history + c.favorites + c.projects + c.documents;
        Auth.setFlash('success', 'Eski kayıtlarınızdan ' + n + ' tanesi hesabınıza taşındı.', true);
      }, function () {
        Auth.setFlash('warning', 'Eski kayıtlarınız şu anda taşınamadı. Panelden tekrar deneyebilirsiniz.', true);
      });
    }).then(function () {
      location.replace(dest);
    }, function (e) {
      UI.busy(submitBtn, false);
      if (e && e.code === 'email_taken') {
        UI.showFormError(form, alertEl, e);
        UI.alertBox(alertEl, 'error', e.message, {
          html: '<div class="vg-acct-alert__actions"><a class="vg-btn vg-btn--ghost vg-btn--sm" href="giris.html' + (next ? '?next=' + encodeURIComponent(next) : '') + '">Giriş yap</a>' +
            '<a class="vg-btn vg-btn--ghost vg-btn--sm" href="sifre-sifirla.html">Şifremi unuttum</a></div>'
        });
        return;
      }
      UI.showFormError(form, alertEl, e);
    });
  });
  UI.enableSubmit(form);
}());
