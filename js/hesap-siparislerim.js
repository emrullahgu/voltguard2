/* hesap/siparislerim.html: üyenin mağaza siparişleri (liste + ayrıntı), e-posta doğrulamasıyla eski siparişleri ekleme,
   kayıtlı fatura/teslimat bilgisini silme. Veriler /api/magaza.php üye işlemlerinden gelir (hesap_*); sunucu yalnızca
   oturumdaki üyeye bağlı siparişleri döndürür. Mağaza ayrı bir hesap sistemi kullanmaz: bu sayfa site üyeliğinin parçasıdır. */
(function () {
  'use strict';
  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) { var gateEl = document.querySelector('[data-vg-gate]'); if (gateEl) { gateEl.hidden = false; gateEl.innerHTML = '<div class="vg-section vg-acct-state vg-acct-state--error" role="alert"><h2>Sayfa tam yüklenemedi</h2><p>Hesap betikleri indirilemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.</p></div>'; } return; }
  var Auth = window.VG.Auth;
  var UI = window.VG.AccountUI;
  var esc = UI.esc;
  var API = '/api/magaza.php';
  var REF_RE = /^VGS-[0-9]{6}-[A-HJ-NP-Z2-9]{5}$/;
  var STEPS = [['teyit_bekliyor', 'Teyit bekleniyor'], ['odeme_bekleniyor', 'Ödeme bekleniyor'], ['odeme_alindi', 'Ödeme alındı'], ['tedarikte', 'Tedarik ediliyor'], ['kargoda', 'Kargoya verildi'], ['teslim_edildi', 'Teslim edildi']];
  var listEl = document.getElementById('so-list');
  var detailEl = document.getElementById('so-detail');
  var extraEl = document.getElementById('so-extra');
  var msgEl = document.getElementById('so-msg');
  var alertEl = document.querySelector('[data-vg-alert]');
  var st = { csrf: '', data: null, codeSent: false, busy: false, detailSeq: 0 };

  /* ---------------------------------------------------------------- sunucu */
  function api(action, body, query) {
    var init = { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body) { init.headers['Content-Type'] = 'application/json'; init.headers['X-VG-CSRF'] = st.csrf; init.body = JSON.stringify(body); }
    return fetch(API + '?action=' + encodeURIComponent(action) + (query || ''), init).then(function (res) {
      return res.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { j = null; }
        if (j && typeof j.csrf === 'string' && j.csrf) st.csrf = j.csrf;
        if (j && j.ok === true) return j;
        var err = new Error(j && j.message ? String(j.message) : 'Mağaza hizmetine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.');
        err.status = res.status; err.code = j && j.error ? String(j.error) : ''; err.fields = j && j.fields || null;
        if (res.status === 401) {
          Auth.setFlash('info', 'Oturumunuzun süresi doldu. Siparişlerinizi görmek için yeniden giriş yapın.');
          location.replace(Auth.loginUrl(location.pathname + location.hash));
        }
        throw err;
      });
    }, function () {
      var e = new Error('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.'); e.code = 'network'; throw e;
    });
  }

  /* ---------------------------------------------------------------- biçimlendirme */
  function fmtTry(n) {
    var v = Number(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
  }
  function fmtDT(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    try { return d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return UI.fmtDateTime(iso); }
  }
  function tone(status) { return status === 'iptal' || status === 'iade' ? 'off' : status === 'teslim_edildi' ? 'ok' : status === 'odeme_bekleniyor' || status === 'teyit_bekliyor' ? 'wait' : 'info'; }
  function chip(o) { return '<span class="so-chip so-chip--' + tone(o.status) + '">' + esc(o.statusLabel || o.status) + '</span>'; }
  function say(kind, text) {
    if (!text) { msgEl.hidden = true; msgEl.innerHTML = ''; return; }
    UI.alertBox(msgEl, kind, text);
  }

  /* Teyit bekleyen talep: ödeme bilgisi YOK (teyit gelmeden ödeme yapılmaz). Ödeme bekleyen (teyit edilmiş) sipariş:
     havale/EFT bilgisi (sunucu yalnızca süre dolmadıysa döndürür). */
  function paymentBox(o) {
    if (o.status === 'teyit_bekliyor') {
      return '<div class="so-pay so-pay--wait" role="note"><p><strong>Stok ve fiyat teyidi bekleniyor.</strong> Teyitten sonra kesin tutar ve ödeme bilgileri e-postayla gönderilir'
        + (o.respondBy ? ' (yanıt: en geç ' + esc(fmtDT(o.respondBy)) + ' TSİ)' : '') + '. <strong>Teyit gelmeden ödeme yapmayın.</strong> Teyit edemezsek talebiniz bedelsiz kapanır.</p></div>';
    }
    if (o.status !== 'odeme_bekleniyor') return '';
    if (o.payOverdue) {
      return '<div class="so-pay so-pay--late" role="note"><p><strong>Son ödeme süresi doldu.</strong> Ödeme yapmadan önce lütfen bizimle iletişime geçin: <a href="tel:+905454346735">0545 434 67 35</a> · <a href="mailto:info@voltguard.com.tr">info@voltguard.com.tr</a>.</p></div>';
    }
    var p = o.payment;
    if (!p) return '';
    return '<div class="so-pay" role="note">' +
      '<p class="so-pay__lead"><strong>Ödeme bekleniyor.</strong> ' + esc(p.amountText || fmtTry(p.amountTry)) + ' tutarını son ödeme zamanına kadar havale/EFT ile gönderin; açıklamaya sipariş numaranızı yazın.</p>' +
      '<dl class="so-pay__dl">' +
      row('Son ödeme zamanı', esc(fmtDT(o.payBy)) + ' (TSİ)') +
      row('Banka', esc(p.bank)) +
      row('Hesap sahibi', esc(p.holder)) +
      row('IBAN', '<span class="so-mono">' + esc(p.iban) + '</span> <button type="button" class="so-copy" data-copy="' + esc(p.iban) + '">Kopyala</button>') +
      row('Açıklama', '<span class="so-mono">' + esc(p.description) + '</span> <button type="button" class="so-copy" data-copy="' + esc(p.description) + '">Kopyala</button>') +
      '</dl></div>';
  }
  function row(k, v) { return v ? '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>' : ''; }
  function trackingLine(t) {
    if (!t || !(t.company || t.code)) return '';
    var link = typeof t.url === 'string' && /^https:\/\/[^\s"<>]+$/i.test(t.url) ? ' · <a href="' + esc(t.url) + '" target="_blank" rel="noopener noreferrer">Kargo takip sayfası</a>' : '';
    return '<p class="so-track"><i class="fas fa-truck-fast" aria-hidden="true"></i> ' + esc(t.company || '') + ' · takip no <span class="so-mono">' + esc(t.code || '') + '</span>' + link + '</p>';
  }

  /* ---------------------------------------------------------------- liste */
  function load() {
    listEl.innerHTML = '<div class="vg-acct-loading" role="status"><span class="vg-spinner" aria-hidden="true"></span> Siparişleriniz yükleniyor…</div>';
    return api('hesap_siparisler').then(function (d) {
      st.data = d;
      if (d.claimed > 0) say('success', d.claimed + ' sipariş, doğrulanmış e-posta adresinizle eşleştiği için hesabınıza eklendi.');
      route();
    }, function (e) {
      listEl.innerHTML = '<div class="vg-acct-state vg-acct-state--error" role="alert"><span class="vg-acct-state__icon" aria-hidden="true"><i class="fas fa-circle-exclamation"></i></span><h2>Siparişler yüklenemedi</h2><p>' + esc(e.message) + '</p><button type="button" class="vg-btn vg-btn--primary" data-retry><i class="fas fa-arrows-rotate" aria-hidden="true"></i> Tekrar dene</button></div>';
    });
  }

  function renderList() {
    var d = st.data || { orders: [] };
    var orders = Array.isArray(d.orders) ? d.orders : [];
    if (!orders.length) {
      listEl.innerHTML = '<div class="vg-acct-state"><span class="vg-acct-state__icon" aria-hidden="true"><i class="fas fa-file-invoice"></i></span>' +
        '<h2>Henüz hesabınıza bağlı sipariş yok</h2><p>Üye girişi yaparak verdiğiniz mağaza siparişleri burada görünür.</p>' +
        '<p><a class="vg-btn vg-btn--primary vg-btn--sm" href="/magaza/">Mağazaya git</a></p></div>';
    } else {
      var head = '<p class="so-count">' + (d.total > orders.length ? orders.length + ' / ' + d.total + ' sipariş (en yeni)' : orders.length + ' sipariş') + '</p>';
      listEl.innerHTML = head + '<ol class="so-orders">' + orders.map(function (o) {
        var more = o.itemCount > 1 ? ' ve ' + (o.itemCount - 1) + ' ürün daha' : '';
        return '<li class="so-card">' +
          '<div class="so-card__head"><a class="so-card__ref so-mono" href="#' + esc(o.reference) + '" aria-label="Sipariş ' + esc(o.reference) + ' ayrıntıları">' + esc(o.reference) + '</a>' + chip(o) + '</div>' +
          '<p class="so-card__meta">' + esc(fmtDT(o.createdAt)) + ' · ' + esc(o.itemCount) + ' kalem · ' + (o.estimate
            ? (o.totalTry > 0 ? 'tahmini <strong>' + esc(fmtTry(o.totalTry)) + '</strong> (KDV dahil' + (o.unpriced > 0 ? '; ' + esc(o.unpriced) + ' ürün teyitte' : '') + ')' : 'fiyat teyitte bildirilir')
            : '<strong>' + esc(fmtTry(o.totalTry)) + '</strong> (KDV dahil)') + '</p>' +
          '<p class="so-card__items">' + esc(o.firstItem) + esc(more) + '</p>' +
          paymentBox(o) + trackingLine(o.tracking) +
          '<p class="so-card__foot"><a class="vg-btn vg-btn--ghost vg-btn--sm" href="#' + esc(o.reference) + '">Ayrıntılar ve belgeler</a></p>' +
          '</li>';
      }).join('') + '</ol>';
    }
    renderExtra();
  }

  /* E-posta doğrulama (eski misafir siparişleri) ve kayıtlı bilgiler. */
  function renderExtra() {
    var d = st.data || {};
    var html = '';
    if (d.verified) {
      html += '<section class="so-box" aria-labelledby="so-ver-h"><h2 id="so-ver-h"><i class="fas fa-circle-check" aria-hidden="true"></i> E-posta adresiniz doğrulandı</h2>' +
        '<p><strong>' + esc(d.email) + '</strong> adresiyle üye girişi yapmadan verdiğiniz siparişler de hesabınıza kendiliğinden eklenir.</p></section>';
    } else {
      html += '<section class="so-box" aria-labelledby="so-ver-h"><h2 id="so-ver-h"><i class="fas fa-envelope" aria-hidden="true"></i> Üye girişi yapmadan verdiğiniz siparişler</h2>' +
        '<p>Daha önce <strong>' + esc(d.email || '') + '</strong> adresiyle üye girişi yapmadan sipariş verdiyseniz, bu adresin size ait olduğunu doğrulayın; o siparişler hesabınıza eklenir. Güvenliğiniz için siparişler yalnızca doğrulanmış e-posta adresine eklenir.</p>' +
        '<div class="so-verify" id="so-verify">' +
        (st.codeSent
          ? '<form id="so-code-form" class="so-code" novalidate><div class="vg-field"><label for="so-code">E-postanıza gelen 6 haneli kod</label>' +
            '<input id="so-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required></div>' +
            '<div class="so-code__btns"><button type="submit" class="vg-btn vg-btn--primary vg-btn--sm">Doğrula ve siparişleri hesabıma ekle</button>' +
            '<button type="button" class="vg-btn vg-btn--ghost vg-btn--sm" data-send-code>Kodu yeniden gönder</button></div></form>'
          : '<button type="button" class="vg-btn vg-btn--primary vg-btn--sm" data-send-code><i class="fas fa-paper-plane" aria-hidden="true"></i> Bu e-postayla verilen siparişleri hesabıma ekle</button>') +
        '<div class="vg-acct-alert" id="so-verify-alert" hidden></div></div></section>';
    }
    if (d.hasSaved) {
      html += '<section class="so-box" aria-labelledby="so-saved-h"><h2 id="so-saved-h"><i class="fas fa-location-dot" aria-hidden="true"></i> Kayıtlı fatura ve teslimat bilgisi</h2>' +
        '<p>Onayınızla son siparişinizdeki fatura ve teslimat bilgileri, ödeme sayfasını doldurmak için hesabınızda saklanıyor.</p>' +
        '<p><button type="button" class="vg-btn vg-btn--ghost vg-btn--sm" data-forget-saved><i class="fas fa-trash" aria-hidden="true"></i> Kayıtlı bilgileri sil</button></p></section>';
    }
    extraEl.innerHTML = html;
  }

  function verifyAlert(kind, text) { UI.alertBox(document.getElementById('so-verify-alert'), kind, text, { focus: kind === 'error' }); }

  function sendCode(btn) {
    if (st.busy) return;
    st.busy = true; UI.busy(btn, true, 'Gönderiliyor…');
    api('hesap_dogrula_gonder', {}).then(function (j) {
      st.busy = false;
      st.codeSent = true;
      renderExtra();
      verifyAlert('info', j.message || 'Doğrulama kodu gönderildi.');
      var input = document.getElementById('so-code'); if (input) input.focus();
    }, function (e) {
      st.busy = false; UI.busy(btn, false);
      if (e.code === 'already_verified') { load(); return; }
      verifyAlert('error', e.message);
    });
  }
  function checkCode(form) {
    if (st.busy) return;
    var input = form.elements.code, code = String(input.value || '').replace(/\s+/g, '');
    UI.clearFieldErrors(form);
    if (!/^[0-9]{6}$/.test(code)) { UI.setFieldErrors(form, { code: 'E-postanıza gelen 6 haneli kodu girin.' }); input.focus(); return; }
    var btn = form.querySelector('button[type="submit"]');
    st.busy = true; UI.busy(btn, true, 'Doğrulanıyor…');
    api('hesap_dogrula', { code: code }).then(function (j) {
      st.busy = false; st.codeSent = false;
      say('success', j.message || 'E-posta adresiniz doğrulandı.');
      load();
    }, function (e) {
      st.busy = false; UI.busy(btn, false);
      if (e.code === 'code_expired') { st.codeSent = false; renderExtra(); verifyAlert('error', e.message); return; }
      if (e.fields) { UI.setFieldErrors(form, e.fields); input.focus(); }
      verifyAlert('error', e.message);
    });
  }
  function forgetSaved(btn) {
    UI.confirmDialog({ title: 'Kayıtlı bilgiler silinsin mi?', message: 'Ödeme sayfasını doldurmak için saklanan fatura ve teslimat bilgileriniz silinir. Siparişleriniz etkilenmez.', confirmText: 'Sil', danger: true }).then(function (ok) {
      if (!ok) return;
      UI.busy(btn, true, 'Siliniyor…');
      api('hesap_adres_sil', {}).then(function () {
        if (st.data) st.data.hasSaved = false;
        renderExtra();
        say('success', 'Kayıtlı fatura ve teslimat bilgileriniz silindi.');
      }, function (e) { UI.busy(btn, false); say('error', e.message); });
    });
  }

  /* ---------------------------------------------------------------- ayrıntı */
  function addr(a, title) {
    if (!a) return '';
    var lines = [a.name, a.company, a.address, [a.district, a.city].filter(Boolean).join(' / '), a.postalCode, a.phone].filter(function (x) { return x; });
    return '<div class="so-addr"><h4>' + esc(title) + '</h4><p>' + lines.map(esc).join('<br>') + '</p></div>';
  }
  function renderDetail(o) {
    var status = String(o.status || ''), idx = -1, seen = {};
    STEPS.forEach(function (s, i) { if (s[0] === status) idx = i; });
    (o.history || []).forEach(function (h) { seen[h.status] = true; });
    var off = status === 'iptal' || status === 'iade';
    var steps = '<ol class="so-steps" aria-label="Sipariş aşamaları">' + STEPS.map(function (s, i) {
      var state = off ? (seen[s[0]] ? 'done' : 'todo') : (i < idx ? 'done' : i === idx ? 'current' : 'todo');
      return '<li class="so-step" data-state="' + state + '">' + esc(s[1]) + (state === 'current' ? '<span class="vg-sr-only"> (güncel aşama)</span>' : '') + '</li>';
    }).join('') + '</ol>';
    var t = o.totals || {};
    var items = '<div class="so-table-wrap"><table class="so-table"><caption class="vg-sr-only">Siparişteki ürünler</caption><thead><tr><th scope="col">Ürün</th><th scope="col" class="so-num">Miktar</th><th scope="col" class="so-num">Birim fiyat</th><th scope="col" class="so-num">Tutar</th></tr></thead><tbody>' +
      (o.items || []).map(function (it) {
        var sub = [it.brand, it.mpn].filter(Boolean).join(' · ');
        return '<tr><td data-label="Ürün">' + esc(it.name) + (sub ? '<span class="so-sub">' + esc(sub) + '</span>' : '') + '</td><td data-label="Miktar" class="so-num">' + esc(it.qty) + ' ' + esc(it.unit || 'adet') + '</td>' +
          '<td data-label="Birim fiyat" class="so-num">' + (typeof it.unitTryGross === 'number' ? esc(fmtTry(it.unitTryGross)) : 'Teyitte') + '</td><td data-label="Tutar" class="so-num">' + (typeof it.lineTryGross === 'number' ? esc(fmtTry(it.lineTryGross)) : 'Teyitte') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (o.estimate
        ? '<dl class="so-totals">' + row('Kargo', 'Teyitte bildirilir') + '<div class="so-totals__grand"><dt>Tahmini tutar (KDV dahil)</dt><dd>' + (t.tryGross > 0 ? esc(fmtTry(t.tryGross)) : '—') + '</dd></div></dl>'
          + '<p class="so-fine">Talepteki fiyatlar bilgi amaçlıdır. Kesin tutar stok ve fiyat teyidinde sabitlenir ve e-postayla bildirilir.</p>'
        : '<dl class="so-totals">' + row('Ara toplam (KDV hariç)', esc(fmtTry(t.tryNet))) + row('KDV', esc(fmtTry(t.tryVat))) +
          row('Kargo', typeof t.shippingTry === 'number' && t.shippingTry > 0 ? esc(fmtTry(t.shippingTry)) : 'Ücretsiz') +
          '<div class="so-totals__grand"><dt>Toplam (KDV dahil)</dt><dd>' + esc(fmtTry(t.tryGross)) + '</dd></div></dl>' +
          '<p class="so-fine">Fiyatlar ' + (o.confirmedAt ? esc(fmtDT(o.confirmedAt)) + ' tarihli stok ve fiyat teyidinde' : 'teyitte') + ' Türk lirası olarak sabitlendi' + (o.rate && o.rate.date ? ' (' + esc(o.rate.date.split('-').reverse().join('.')) + ' tarihli TCMB kuru)' : '') + '.</p>');
    var b = o.billing || {}, s = o.shippingAddress || {};
    var billing = { name: b.type === 'kurumsal' ? '' : b.name, company: b.type === 'kurumsal' ? b.company : '', address: b.address, district: b.district, city: b.city };
    var billExtra = b.type === 'kurumsal' ? 'Vergi dairesi / no: ' + (b.taxOffice || '') + ' / ' + (b.vkn || '') : (b.tckn ? 'T.C. kimlik no: ' + b.tckn : '');
    var ship = s.sameAsBilling ? null : s;
    var hist = (o.history || []).slice().reverse().map(function (h) {
      return '<li><time datetime="' + esc(h.at) + '">' + esc(fmtDT(h.at)) + '</time> <strong>' + esc(h.label || h.status) + '</strong>' + (h.note ? ' – ' + esc(h.note) : '') + '</li>';
    }).join('');
    var docs = o.docs || {};
    var cons = o.consents;
    var docBlock = function (key, title) {
      return docs[key] ? '<details class="so-doc"><summary>' + esc(title) + '</summary><pre class="so-doc__text" tabindex="0">' + esc(docs[key]) + '</pre></details>' : '';
    };
    detailEl.innerHTML =
      '<p class="so-back so-noprint"><a href="#" data-back><i class="fas fa-arrow-left" aria-hidden="true"></i> Tüm siparişlerim</a></p>' +
      '<div class="so-detail__head"><h2 tabindex="-1" id="so-detail-h">' + (status === 'teyit_bekliyor' ? 'Sipariş talebi' : 'Sipariş') + ' <span class="so-mono">' + esc(o.reference) + '</span></h2>' + chip(o) + '</div>' +
      '<p class="so-card__meta">Talep tarihi: ' + esc(fmtDT(o.createdAt)) + (o.confirmedAt ? ' · Teyit: ' + esc(fmtDT(o.confirmedAt)) : '') + (o.linkedVia === 'claim' ? ' · Üye girişi yapılmadan verildi; doğrulanmış e-postanızla hesabınıza eklendi.' : '') + '</p>' +
      (off ? '<div class="vg-acct-alert vg-acct-alert--error" role="note"><i class="fas fa-circle-xmark" aria-hidden="true"></i><div class="vg-acct-alert__body"><p>' + (status === 'iade' ? 'Bu sipariş iade edildi.' : (seen.odeme_bekleniyor ? 'Bu sipariş iptal edildi.' : 'Bu talep teyit edilemedi ve bedelsiz kapatıldı; sizden ödeme alınmadı.')) + '</p></div></div>' : '') +
      steps + paymentBox(o) + trackingLine(o.tracking) +
      '<section class="so-part"><h3>Ürünler ve tutar</h3>' + items + '</section>' +
      '<section class="so-part"><h3>Fatura ve teslimat</h3><div class="so-addrs">' +
      addr(billing, b.type === 'kurumsal' ? 'Fatura (kurumsal)' : 'Fatura (bireysel)').replace('</p></div>', billExtra ? '<br>' + esc(billExtra) + '</p></div>' : '</p></div>') +
      (ship ? addr(ship, 'Teslimat adresi') : '<div class="so-addr"><h4>Teslimat adresi</h4><p>Fatura adresiyle aynı.</p></div>') +
      '<div class="so-addr"><h4>İletişim</h4><p>' + esc((o.customer || {}).name || '') + '<br>' + esc((o.customer || {}).email || '') + '<br>' + esc((o.customer || {}).phone || '') + '</p></div>' +
      '</div>' + (o.notes ? '<p class="so-fine"><strong>Sipariş notunuz:</strong> ' + esc(o.notes) + '</p>' : '') + '</section>' +
      (hist ? '<section class="so-part"><h3>Sipariş geçmişi</h3><ul class="so-history">' + hist + '</ul></section>' : '') +
      '<section class="so-part"><h3>Sipariş belgeleri</h3>' +
      (cons ? '<p class="so-fine">' + (o.confirmedAt ? 'Teyitte kesin tutarlarla düzenlenen metinler (talepte onayladığınız: ' : 'Talepte onayladığınız metinler (onay: ') + esc(fmtDT(cons.preInfo)) + (cons.docVersion ? ' · belge sürümü ' + esc(cons.docVersion) : '') + '). Aynı metinler e-postanızda da yer alır.</p>' : '') +
      (docBlock('preInfo', 'Ön Bilgilendirme Formu') + docBlock('contract', 'Mesafeli Satış Sözleşmesi') || '<p class="so-fine">Bu sipariş için kayıtlı belge metni bulunamadı; e-postanızdaki metinler geçerlidir.</p>') +
      '<p class="so-fine"><a href="/magaza/iade-ve-cayma.html">İade ve cayma koşulları</a> · <a href="/magaza/odeme-ve-teslimat.html">Ödeme ve teslimat</a> · Sorularınız için <a href="mailto:info@voltguard.com.tr">info@voltguard.com.tr</a></p></section>' +
      '<p class="so-noprint"><button type="button" class="vg-btn vg-btn--ghost vg-btn--sm" data-print><i class="fas fa-print" aria-hidden="true"></i> Yazdır</button></p>';
    var h = document.getElementById('so-detail-h');
    if (h) { h.focus({ preventScroll: true }); detailEl.scrollIntoView({ block: 'start' }); }
  }

  function openDetail(ref) {
    var seq = ++st.detailSeq;
    listEl.hidden = true; extraEl.hidden = true; detailEl.hidden = false;
    detailEl.innerHTML = '<div class="vg-acct-loading" role="status"><span class="vg-spinner" aria-hidden="true"></span> Sipariş yükleniyor…</div>';
    api('hesap_siparis', null, '&ref=' + encodeURIComponent(ref)).then(function (j) {
      if (seq !== st.detailSeq) return;
      renderDetail(j.order || {});
    }, function (e) {
      if (seq !== st.detailSeq) return;
      detailEl.innerHTML = '<p class="so-back"><a href="#" data-back><i class="fas fa-arrow-left" aria-hidden="true"></i> Tüm siparişlerim</a></p>' +
        '<div class="vg-acct-state vg-acct-state--error" role="alert"><span class="vg-acct-state__icon" aria-hidden="true"><i class="fas fa-circle-exclamation"></i></span><h2>Sipariş açılamadı</h2><p>' + esc(e.message) + '</p></div>';
    });
  }

  function route() {
    var ref = decodeURIComponent((location.hash || '').slice(1)).toUpperCase();
    if (REF_RE.test(ref)) { openDetail(ref); return; }
    st.detailSeq++;
    var fromDetail = !detailEl.hidden;
    detailEl.hidden = true; detailEl.innerHTML = '';
    listEl.hidden = false; extraEl.hidden = false;
    renderList();
    if (fromDetail) document.getElementById('page-title').scrollIntoView({ block: 'start' });
  }

  /* ---------------------------------------------------------------- olaylar */
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    var copy = t.closest('[data-copy]');
    if (copy) {
      var text = copy.getAttribute('data-copy') || '';
      var done = function (ok) { copy.textContent = ok ? 'Kopyalandı' : 'Kopyalanamadı'; setTimeout(function () { copy.textContent = 'Kopyala'; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      else done(false);
      return;
    }
    if (t.closest('[data-back]')) { ev.preventDefault(); history.pushState(null, '', location.pathname + location.search); route(); return; }
    if (t.closest('[data-retry]')) { load(); return; }
    if (t.closest('[data-print]')) { window.print(); return; }
    var send = t.closest('[data-send-code]');
    if (send) { sendCode(send); return; }
    var forget = t.closest('[data-forget-saved]');
    if (forget) forgetSaved(forget);
  });
  document.addEventListener('submit', function (ev) {
    if (ev.target && ev.target.id === 'so-code-form') { ev.preventDefault(); checkCode(ev.target); }
  });
  window.addEventListener('hashchange', function () { if (st.data) { say(''); route(); } });

  UI.initPage({
    page: 'siparislerim',
    protected: true,
    collections: [],
    onReady: function () { load(); }
  });
})();
