/* VoltHaber herkese açık sayfa betiği: bülten formu, bağlantı kopyalama, abonelik onayı/çıkışı ve
   statik yansıda (Netlify, PHP yok) API'ye ulaşılamazsa açıklayıcı yedek görünüm. innerHTML kullanılmaz. */
(function () {
  'use strict';
  var API = '/api/volthaber.php';
  var LIVE = 'https://voltguard.com.tr/volthaber/';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function post(action, body) {
    return fetch(API + '?action=' + action, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, message: 'Sunucuya ulaşılamadı.' }; }).then(function (j) {
        if (!r.ok || !j || j.ok !== true) {
          var err = new Error((j && j.message) || 'İşlem tamamlanamadı.');
          err.fields = j && j.fields;
          throw err;
        }
        return j;
      });
    });
  }

  /* ---------------------------------------------------------- bülten formu */
  Array.prototype.forEach.call(document.querySelectorAll('form[data-vh-subscribe]'), function (form) {
    var msg = form.querySelector('.vh-news__msg');
    var btn = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.elements.email.value.trim();
      var consent = form.elements.consent.checked;
      msg.className = 'vh-news__msg';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'Geçerli bir e-posta adresi yazın.'; msg.classList.add('is-error'); form.elements.email.focus(); return; }
      if (!consent) { msg.textContent = 'Abone olmak için açık rıza kutusunu işaretleyin.'; msg.classList.add('is-error'); form.elements.consent.focus(); return; }
      btn.disabled = true;
      msg.textContent = 'Gönderiliyor…';
      post('subscribe', { email: email, consent: true, website: form.elements.website.value })
        .then(function (j) { msg.textContent = j.message || 'Onay e-postası gönderildi.'; msg.classList.add('is-ok'); form.reset(); })
        .catch(function (err) { msg.textContent = err.message; msg.classList.add('is-error'); })
        .then(function () { btn.disabled = false; });
    });
  });

  /* ---------------------------------------------------------- bağlantı kopyalama */
  Array.prototype.forEach.call(document.querySelectorAll('[data-vh-copy]'), function (b) {
    b.addEventListener('click', function () {
      var url = b.getAttribute('data-vh-copy');
      var done = function () { var t = b.textContent; b.textContent = 'Kopyalandı'; setTimeout(function () { b.textContent = t; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Bağlantı:', url); });
      else window.prompt('Bağlantı:', url);
    });
  });

  /* ---------------------------------------------------------- abonelik onayı / çıkış */
  var sub = document.querySelector('[data-vh-subpage]');
  if (sub) {
    var m = /^#(onay|iptal)=([A-Za-z0-9_.-]{20,80})$/.exec(location.hash || '');
    var out = sub.querySelector('[data-vh-sub-msg]');
    var title = document.querySelector('[data-vh-sub-title]');
    if (!m) {
      out.textContent = 'Bağlantı eksik veya hatalı. E-postadaki bağlantıyı tam olarak açtığınızdan emin olun.';
    } else {
      // Jeton adres çubuğunda ve geçmişte kalmasın.
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* eski tarayıcı */ }
      var kind = m[1], token = m[2];
      title.textContent = kind === 'onay' ? 'Aboneliği onaylayın' : 'Abonelikten çıkın';
      out.textContent = kind === 'onay'
        ? 'VoltHaber bültenine aboneliğinizi başlatmak için aşağıdaki düğmeye basın.'
        : 'VoltHaber bülteninden çıkmak için aşağıdaki düğmeye basın. E-posta adresiniz listeden silinir.';
      var go = el('button', 'btn btn--accent btn--md', kind === 'onay' ? 'Aboneliği onayla' : 'Abonelikten çık');
      go.type = 'button';
      out.parentNode.insertBefore(go, out.nextSibling);
      go.addEventListener('click', function () {
        go.disabled = true;
        post(kind === 'onay' ? 'confirm' : 'unsubscribe', { token: token }).then(function () {
          out.textContent = kind === 'onay' ? 'Teşekkürler, aboneliğiniz başladı.' : 'Abonelikten çıktınız. Bundan sonra VoltHaber bülteni gönderilmeyecek.';
          go.remove();
        }).catch(function (err) { out.textContent = err.message; go.disabled = false; });
      });
    }
  }

  /* ---------------------------------------------------------- statik yedek (PHP olmayan yansı) */
  var box = document.querySelector('[data-vh-static]');
  if (box) {
    var msgBox = box.querySelector('[data-vh-static-msg]');
    var list = box.querySelector('[data-vh-static-list]');
    var fail = function () {
      while (msgBox.firstChild) msgBox.removeChild(msgBox.firstChild);
      msgBox.appendChild(el('h2', '', 'VoltHaber bu adreste çalışmıyor'));
      msgBox.appendChild(el('p', '', 'Haberler, mevzuat özetleri ve analizler voltguard.com.tr sunucusunda yayımlanır. Bu sayfa statik bir yansıdır.'));
      var p = el('p');
      var a = el('a', 'btn btn--primary btn--md', 'VoltHaber\'i voltguard.com.tr üzerinde açın');
      a.href = LIVE;
      p.appendChild(a);
      msgBox.appendChild(p);
    };
    fetch(API + '?action=list', { headers: { 'Accept': 'application/json' } }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      if (!j || j.ok !== true || !j.items || !j.items.length) { fail(); return; }
      msgBox.hidden = true;
      j.items.forEach(function (it) {
        var art = el('article', 'vh-card');
        var meta = el('div', 'vh-card__meta');
        meta.appendChild(el('span', 'vh-badge', it.typeName));
        meta.appendChild(el('span', 'vh-card__cat', it.categoryName));
        art.appendChild(meta);
        var h = el('h3', 'vh-card__title');
        var a = el('a', '', it.title);
        a.href = /^\/volthaber\/[a-z0-9-]+\/$/.test(it.url) ? it.url : '/volthaber/';
        h.appendChild(a);
        art.appendChild(h);
        art.appendChild(el('p', 'vh-card__sum', it.summary));
        list.appendChild(art);
      });
    }).catch(fail);
  }
}());
