(function () {
  'use strict';
  var page = document.body.dataset.staffPage;
  if (!page) return;
  var csrf = '', factorMode = 'verify', user = null;
  var token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
  if (page === 'activate' && location.hash) history.replaceState(null, '', location.pathname);
  var roles = {employee: 'Çalışan', payroll: 'Bordro sorumlusu', admin: 'Yönetici'};
  var statuses = {active: 'Aktif', invited: 'Davet gönderilmeye hazır', enrollment: 'Doğrulama kurulumu bekleniyor', disabled: 'Erişimi kapalı'};
  var money = new Intl.NumberFormat('tr-TR', {style: 'currency', currency: 'TRY'});
  function $(id) { return document.getElementById(id); }
  // Formlar betik bağlanana kadar gönderilemez (aksi halde tarayıcı varsayılan gönderimi yapardı); bağlanınca etkinleşir.
  Array.prototype.forEach.call(document.querySelectorAll('button[type="submit"][data-vg-wait]'), function (b) { b.disabled = false; b.removeAttribute('data-vg-wait'); });
  function node(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function status(message, error) { $('staff-status').textContent = message || ''; $('staff-status').classList.toggle('is-error', !!error); }
  async function api(action, body) {
    var options = {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: {Accept: 'application/json'}};
    if (body !== undefined) {
      options.headers['X-VG-STAFF-CSRF'] = csrf;
      if (body instanceof FormData) options.body = body;
      else { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    }
    var response, data;
    try { response = await fetch('/api/staff.php?action=' + encodeURIComponent(action), options); data = await response.json(); }
    catch (_) { throw new Error('Çalışan sistemine şu anda ulaşılamıyor. Lütfen yeniden deneyin.'); }
    if (data.api !== 'vg-staff/1') throw new Error('Çalışan sistemi şu anda kullanılamıyor.');
    if (typeof data.csrf === 'string') csrf = data.csrf;
    if (!response.ok || !data.ok) {
      if (response.status === 401 && page === 'panel') location.replace('/calisan/giris.html');
      var error = new Error(data.message || 'İşlem tamamlanamadı.');
      error.code = data.error; error.status = response.status;
      throw error;
    }
    return data;
  }
  async function busy(form, work) {
    var buttons = Array.from(form.querySelectorAll('button'));
    buttons.forEach(function (b) { b.disabled = true; });
    form.setAttribute('aria-busy', 'true'); status('');
    try { await work(); } catch (e) { status(e.message, true); }
    finally { buttons.forEach(function (b) { b.disabled = false; }); form.removeAttribute('aria-busy'); }
  }
  async function copy(input, message) {
    try { await navigator.clipboard.writeText(input.value); status(message); }
    catch (_) { input.focus(); input.select(); status('Bağlantıyı veya anahtarı seçip cihazınızın kopyalama işlemini kullanın.'); }
  }
  function activationRecovery(message) {
    token = '';
    $('staff-activate-form').hidden = true;
    $('staff-factor').hidden = true;
    $('staff-secret').value = '';
    $('staff-activate-form').reset();
    $('staff-activation-recovery').hidden = false;
    status(message || 'Bu davet kullanılmış, geçersiz veya süresi dolmuş.', true);
    $('staff-recovery-title').focus({preventScroll: true});
    $('staff-activation-recovery').scrollIntoView({block: 'start', behavior: 'instant'});
  }
  function challenge(data) {
    factorMode = data.mode || 'verify';
    ['staff-login-form', 'staff-activate-form'].forEach(function (id) { if ($(id)) $(id).hidden = true; });
    $('staff-factor').hidden = false; $('staff-enroll').hidden = factorMode !== 'enroll';
    if ($('staff-activation-recovery')) $('staff-activation-recovery').hidden = true;
    $('staff-factor-title').textContent = factorMode === 'enroll' ? 'Doğrulayıcı uygulamanızı bağlayın' : 'Doğrulama kodunuzu girin';
    $('staff-secret').value = data.secret || '';
    // During enrollment keep the setup instructions visible; focusing the last
    // field used to scroll past the secret and made the code look like an email OTP.
    if (factorMode === 'enroll') {
      $('staff-factor-title').setAttribute('tabindex', '-1');
      $('staff-factor-title').focus({preventScroll: true});
      $('staff-factor').scrollIntoView({block: 'start', behavior: 'instant'});
    } else $('staff-factor-form').elements.code.focus();
  }
  function authForms() {
    var login = $('staff-login-form'), activate = $('staff-activate-form');
    if (login) login.addEventListener('submit', function (ev) {
      ev.preventDefault(); busy(login, async function () {
        var password = login.elements.password.value;
        login.elements.password.value = '';
        var data = await api('login', {email: login.elements.email.value.trim(), password: password});
        challenge(data);
      });
    });
    if (activate) activate.addEventListener('submit', function (ev) {
      ev.preventDefault(); busy(activate, async function () {
        if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Özel davet bağlantınızı açın. Yeni davet için şirket yöneticinizle görüşün.');
        if (activate.elements.password.value !== activate.elements.confirm.value) throw new Error('Şifreler eşleşmiyor.');
        var password = activate.elements.password.value;
        activate.elements.password.value = ''; activate.elements.confirm.value = '';
        var data;
        try { data = await api('activate', {token: token, password: password}); }
        catch (e) {
          if (e.code === 'staff_invite_invalid') { activationRecovery('Bu davet kullanılmış, geçersiz veya süresi dolmuş.'); return; }
          throw e;
        }
        token = ''; challenge(data);
      });
    });
    $('staff-factor-form').addEventListener('submit', function (ev) {
      ev.preventDefault(); var form = ev.currentTarget;
      busy(form, async function () {
        var code = form.elements.code.value; form.elements.code.value = '';
        await api(factorMode === 'enroll' ? 'mfa_enroll' : 'mfa_verify', {code: code});
        $('staff-secret').value = ''; location.replace('/calisan/');
      });
    });
    $('staff-copy-secret').addEventListener('click', function () { copy($('staff-secret'), 'Kurulum anahtarı kopyalandı.'); });
    if ($('staff-cancel-factor')) $('staff-cancel-factor').addEventListener('click', function () {
      busy($('staff-factor'), async function () { await api('logout', {}); $('staff-secret').value = ''; location.replace('/calisan/giris.html'); });
    });
  }
  function periodLabel(period) {
    var parts = period.split('-');
    return new Intl.DateTimeFormat('tr-TR', {month: 'long', year: 'numeric'}).format(new Date(Number(parts[0]), Number(parts[1]) - 1, 1));
  }
  function showPayroll(data) {
    var list = $('staff-payroll-list'); list.replaceChildren();
    $('staff-payroll-manager').hidden = !data.canManage;
    if (!data.items.length) { list.append(node('p', 'staff-empty', 'Henüz bordro kaydı bulunmuyor.')); return; }
    data.items.forEach(function (row) {
      var card = node('article', 'staff-record'), head = node('div', 'staff-record-head'), heading = node('div');
      heading.append(node('h3', '', periodLabel(row.period)));
      if (data.canManage) heading.append(node('p', 'staff-muted', row.employeeName));
      head.append(heading);
      var actions = node('div', 'staff-record-actions');
      if (row.hasPdf) {
        var link = node('a', 'staff-secondary', 'PDF bordroyu indir');
        link.href = '/api/staff.php?action=payroll_download&id=' + encodeURIComponent(row.id); actions.append(link);
      }
      if (data.canManage) {
        var del = node('button', 'staff-link staff-danger', 'Kaydı sil'); del.type = 'button';
        del.addEventListener('click', function () {
          if (!confirm(periodLabel(row.period) + ' bordro kaydı silinsin mi?')) return;
          busy(card, async function () { await api('payroll_delete', {statementId: row.id}); await loadPayroll(); status('Bordro kaydı silindi.'); });
        }); actions.append(del);
      }
      head.append(actions); card.append(head);
      var amounts = node('dl', 'staff-money');
      [['Brüt', row.gross], ['Kesintiler', row.deductions], ['Net', row.net]].forEach(function (entry, i) {
        var cell = node('div', i === 2 ? 'staff-net' : ''); cell.append(node('dt', '', entry[0]), node('dd', '', money.format(Number(entry[1])))); amounts.append(cell);
      }); card.append(amounts);
      if (row.note) card.append(node('p', 'staff-note', row.note));
      list.append(card);
    });
  }
  async function loadPayroll() { showPayroll(await api('payroll_list')); }
  async function loadPeople() {
    var data = await api('users'), list = $('staff-people-list'), select = $('staff-payroll-user');
    list.replaceChildren(); select.replaceChildren(); $('staff-invite-section').hidden = !data.canInvite;
    data.items.forEach(function (person) {
      var card = node('div', 'staff-person'), info = node('div');
      info.append(node('strong', '', person.name), node('p', 'staff-muted', person.email + ' · ' + roles[person.role] + ' · ' + (statuses[person.status] || person.status))); card.append(info);
      if (person.status === 'active') { var option = node('option', '', person.name + ' · ' + person.email); option.value = person.id; select.append(option); }
      if (data.canInvite && person.status !== 'disabled' && person.id !== user.id) {
        var disable = node('button', 'staff-secondary staff-danger', 'Erişimi kapat'); disable.type = 'button';
        disable.addEventListener('click', function () {
          if (!confirm(person.name + ' adlı çalışanın erişimi kapatılsın mı? Açık oturumları da kapanır.')) return;
          busy(card, async function () { await api('disable_user', {userId: person.id}); await loadPeople(); status('Çalışanın erişimi kapatıldı.'); });
        }); card.append(disable);
      }
      list.append(card);
    });
    if (!select.options.length) select.append(node('option', '', 'Önce bir çalışan hesabını etkinleştirin'));
  }
  function panelForms() {
    var manage = user.role === 'admin' || user.role === 'payroll';
    $('staff-role-label').textContent = roles[user.role] + (manage ? ' · Çalışan ve bordro yönetimi' : ' · Size ait bordro kayıtları');
    $('staff-security-email').textContent = user.email; $('staff-security-role').textContent = roles[user.role];
    $('staff-people-tab').hidden = !manage;
    if (manage) { $('staff-payroll-title').textContent = 'Bordro yönetimi'; document.querySelector('[data-staff-tab="payroll"]').textContent = 'Bordrolar'; }
    document.querySelectorAll('[data-staff-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('[data-staff-tab]').forEach(function (t) {
          var active = t === tab; t.classList.toggle('is-active', active); t.setAttribute('aria-selected', String(active)); $('staff-tab-' + t.dataset.staffTab).hidden = !active;
        });
      });
    });
    $('staff-logout').addEventListener('click', function () { busy(document.body, async function () { await api('logout', {}); location.replace('/calisan/giris.html'); }); });
    $('staff-refresh').addEventListener('click', function () { busy($('staff-tab-payroll'), loadPayroll); });
    $('staff-payroll-form').addEventListener('submit', function (ev) {
      ev.preventDefault(); var form = ev.currentTarget;
      busy(form, async function () {
        var pdf = form.elements.pdf.files[0];
        if (pdf && pdf.size > 8388608) throw new Error('PDF dosyası en fazla 8 MB olmalı.');
        var body = {}; ['userId', 'period', 'gross', 'net', 'deductions', 'note'].forEach(function (key) { body[key] = form.elements[key].value; });
        var data = await api('payroll_create', body), uploadError = '';
        if (pdf) {
          var files = new FormData(); files.append('statementId', data.item.id); files.append('pdf', pdf);
          try { await api('payroll_upload', files); }
          catch (e) { uploadError = 'Bordro kaydı eklendi, PDF yüklenemedi: ' + e.message + ' Kaydı silip PDF ile yeniden ekleyebilirsiniz.'; }
        }
        form.reset(); await loadPayroll(); status(uploadError || 'Bordro kaydı eklendi.', !!uploadError);
      });
    });
    $('staff-invite-form').addEventListener('submit', function (ev) {
      ev.preventDefault(); var form = ev.currentTarget;
      busy(form, async function () {
        var data = await api('create_invite', {name: form.elements.name.value.trim(), email: form.elements.email.value.trim(), role: form.elements.role.value});
        $('staff-invite-link').value = data.activationUrl; $('staff-invite-result').hidden = false; form.reset(); await loadPeople(); status('Özel davet hazır. Bağlantıyı yalnızca ilgili çalışanla paylaşın.');
      });
    });
    $('staff-copy-invite').addEventListener('click', function () { copy($('staff-invite-link'), 'Davet bağlantısı kopyalandı.'); });
    return manage;
  }
  // Never leave payroll text visible when a tab is restored from the browser's memory cache.
  if (page === 'panel') {
    addEventListener('pagehide', function () { $('staff-payroll-list').replaceChildren(); $('staff-people-list').replaceChildren(); $('staff-invite-link').value = ''; });
    addEventListener('pageshow', function (event) { if (event.persisted) location.reload(); });
  } else authForms();
  (async function () {
    try {
      var data = await api('me'); user = data.user;
      if (page === 'panel') {
        if (!user) { location.replace('/calisan/giris.html'); return; }
        var manage = panelForms(); await loadPayroll(); if (manage) await loadPeople();
      } else if (user) location.replace('/calisan/');
      else if (data.mfa && data.mfa.required) challenge(data.mfa);
      else if (page === 'activate' && !/^[a-f0-9]{64}$/.test(token)) {
        activationRecovery('Size özel davet bağlantısını açın veya daha önce belirlediğiniz şifreyle çalışan girişinden devam edin.');
      }
    } catch (e) { status(e.message, true); }
  }());
}());
