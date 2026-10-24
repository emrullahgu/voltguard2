/* hesap/volthaber-panel.html – VoltHaber editör paneli. CSP: satır içi betik yok (script-src 'self').
   Yetki sunucudadır: istemci yalnızca /api/volthaber.php yanıtlarını gösterir. Kullanıcı verisi esc() ile kaçışlanır;
   önizleme HTML'i yalnızca sunucunun sınırlı Markdown çıktısıdır. Otomatik yayın veya paylaşım yoktur. */
(function () {
  'use strict';
  var doc = document;
  var gate = doc.querySelector('[data-vhp-gate]');
  if (!window.VG || !window.VG.Auth || !window.VG.AccountUI) {
    gate.textContent = 'Hesap betikleri yüklenemedi. Sayfayı yenileyin.';
    return;
  }
  var Auth = window.VG.Auth, UI = window.VG.AccountUI, esc = UI.esc;
  var API = '/api/volthaber.php';
  var csrf = '';
  var meta = { categories: {}, types: {}, tools: [] };
  var current = null;          // düzenlenen kayıt
  var alertEl = doc.querySelector('[data-vhp-alert]');
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var STATUS = { draft: 'Taslak', scheduled: 'Planlı', published: 'Yayında', archived: 'Arşiv' };
  var ERRORS = { rate_limited: 'çok sık', permission_required: 'izin gerekli', fixture_missing: 'test akışı yok', blocked_address: 'engelli adres', dns_failed: 'DNS hatası', xml_rejected: 'XML reddedildi', xml_invalid: 'geçersiz XML', not_a_feed: 'akış değil', too_large: 'çok büyük', time_budget: 'süre doldu' };

  function say(kind, text) {
    alertEl.hidden = !text;
    alertEl.className = 'vhp-alert' + (kind ? ' vhp-alert--' + kind : '');
    alertEl.textContent = text || '';
    if (text) alertEl.scrollIntoView({ block: 'nearest' });
  }
  function fmt(iso) { return iso ? UI.fmtDateTime(iso) : '–'; }

  function api(action, opts) {
    opts = opts || {};
    var init = { method: opts.body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'Accept': 'application/json' } };
    if (opts.body) {
      init.headers['Content-Type'] = 'application/json';
      init.headers['X-VG-CSRF'] = csrf;
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API + '?action=' + action + (opts.query || ''), init).then(function (r) {
      if (opts.raw && r.ok) return r.blob();
      return r.json().catch(function () { return { ok: false, message: 'Sunucu yanıtı okunamadı.' }; }).then(function (j) {
        if (j && j.csrf) csrf = j.csrf;
        if (!r.ok || !j.ok) {
          var e = new Error(j.message || 'İşlem tamamlanamadı.');
          e.code = j.error; e.fields = j.fields; e.status = r.status;
          throw e;
        }
        return j;
      });
    });
  }

  /* ------------------------------------------------------------ sekmeler */
  var loaders = {};
  function showTab(name) {
    $$('[role="tab"]').forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      doc.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (loaders[name]) loaders[name]();
  }
  $$('[role="tab"]').forEach(function (t, i, all) {
    t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
    t.addEventListener('keydown', function (e) {
      var k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!k) return;
      var n = all[(i + k + all.length) % all.length];
      n.focus(); showTab(n.getAttribute('data-tab'));
    });
  });

  /* ------------------------------------------------------------ listeler */
  function statusPill(a) { return '<span class="vhp-st vhp-st--' + esc(a.status) + '">' + esc(STATUS[a.status] || a.status) + '</span>'; }
  function row(cells) { return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }
  function btn(act, id, label, cls) { return '<button type="button" class="vhp-btn' + (cls ? ' ' + cls : '') + '" data-act="' + act + '" data-id="' + esc(id) + '">' + esc(label) + '</button>'; }

  loaders.inbox = function () {
    var tb = $('[data-list="inbox"]');
    tb.innerHTML = row(['Yükleniyor…', '', '', '']);
    api('editor_list', { query: '&origin=inbox' }).then(function (j) {
      setMeta(j);
      tb.innerHTML = j.items.length ? j.items.map(function (a) {
        var src = a.source || {};
        return row([
          esc(a.title) + (a.flags.indexOf('link_missing') >= 0 ? '<span class="vhp-flag">Kaynak akışı bağlantı vermiyor: haberin tam adresini girin.</span>' : ''),
          esc(src.name || '') + (src.url ? '<br><a href="' + esc(src.url) + '" target="_blank" rel="noopener noreferrer">kaynağı aç</a>' : ''),
          esc(src.publishedAt || ''),
          btn('edit', a.id, 'Özet yaz ve düzenle', 'vhp-btn--primary') + btn('discard', a.id, 'Sil', 'vhp-btn--danger')
        ]);
      }).join('') : row(['Gelen kutusu boş. "Şimdi tara" ile etkin kaynakları tarayabilirsiniz.', '', '', '']);
    }).catch(function (e) { tb.innerHTML = row([esc(e.message), '', '', '']); });
  };

  loaders.posts = function () {
    var tb = $('[data-list="posts"]');
    var q = '&origin=editorial&status=' + encodeURIComponent($('#f-status').value) + '&q=' + encodeURIComponent($('#f-q').value.trim());
    tb.innerHTML = row(['Yükleniyor…', '', '', '', '', '']);
    api('editor_list', { query: q }).then(function (j) {
      setMeta(j);
      tb.innerHTML = j.items.length ? j.items.map(function (a) {
        var acts = btn('edit', a.id, 'Düzenle');
        if (a.status === 'draft' || a.status === 'scheduled') acts += btn('publish-id', a.id, 'Yayımla', 'vhp-btn--accent');
        if (a.status !== 'archived') acts += btn('archive-id', a.id, 'Arşivle', 'vhp-btn--danger');
        if (a.status !== 'draft') acts += btn('draft-id', a.id, 'Taslağa al');
        acts += btn('social-id', a.id, 'Sosyal');
        return row([
          (a.live ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>' : esc(a.title)) + (a.flags.indexOf('similar_title') >= 0 ? '<span class="vhp-flag">Benzer başlıklı kayıt var</span>' : ''),
          esc(meta.types[a.type] || a.type), statusPill(a) + (a.publishAt ? '<br><small>' + esc(fmt(a.publishAt)) + '</small>' : ''),
          String(a.views), esc(fmt(a.updatedAt)), acts]);
      }).join('') : row(['Kayıt yok.', '', '', '', '', '']);
    }).catch(function (e) { tb.innerHTML = row([esc(e.message), '', '', '', '', '']); });
  };

  function setMeta(j) {
    if (!j.categories) return;
    meta.categories = j.categories; meta.types = j.types || meta.types; meta.tools = j.tools || meta.tools;
    ['#e-category', '#s-cat'].forEach(function (sel) {
      var s = $(sel);
      if (s.options.length) return;
      Object.keys(meta.categories).forEach(function (k) { var o = doc.createElement('option'); o.value = k; o.textContent = meta.categories[k][0]; s.appendChild(o); });
    });
    $('[data-tool-hints]').textContent = meta.tools.map(function (t) { return t[0]; }).join(', ');
  }

  /* ------------------------------------------------------------ düzenleyici */
  var form = $('[data-form="article"]');
  function fill(a) {
    current = a;
    var f = form.elements;
    f.title.value = a ? a.title : ''; f.type.value = a ? a.type : 'analiz';
    if (a && a.category) f.category.value = a.category;
    f.summary.value = a ? a.summary : ''; f.body.value = a ? a.body : '';
    f.tags.value = a ? a.tags.join(', ') : ''; f.slug.value = a ? a.slug : '';
    var s = (a && a.source) || {};
    f.src_name.value = s.name || ''; f.src_url.value = s.url || ''; f.src_date.value = (s.publishedAt || '').slice(0, 10); f.src_lic.value = s.licenseNote || '';
    var im = (a && a.image) || {};
    f.img_url.value = im.url || ''; f.img_credit.value = im.credit || ''; f.img_rights.value = im.rightsNote || '';
    f.seo_title.value = a ? a.seo.title : ''; f.seo_desc.value = a ? a.seo.description : '';
    f.related.value = a ? a.related.map(function (r) { return r.url + ' | ' + r.label; }).join('\n') : '';
    f.featured.checked = !!(a && a.featured); f.pick.checked = !!(a && a.pick);
    $('[data-ed-status]').textContent = a ? (STATUS[a.status] || a.status) + ' · son güncelleme ' + fmt(a.updatedAt) + (a.origin === 'ingest' ? ' · kaynak tarayıcıdan geldi (özgün başlık: ' + ((a.ingest || {}).originalTitle || '') + ')' : '') : 'Yeni yazı';
    var view = $('[data-ed-view]');
    view.hidden = !(a && a.live); if (a) view.href = a.url;
    clearErrors(); counts(); preview();
  }
  function collect(confirmSimilar) {
    var f = form.elements;
    var body = {
      title: f.title.value.trim(), type: f.type.value, category: f.category.value, summary: f.summary.value.trim(), body: f.body.value,
      tags: f.tags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
      seo: { title: f.seo_title.value.trim(), description: f.seo_desc.value.trim() },
      related: f.related.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
        var p = l.split('|'); return { url: p[0].trim(), label: (p.slice(1).join('|') || p[0]).trim() };
      }),
      featured: f.featured.checked, pick: f.pick.checked
    };
    if (f.slug.value.trim()) body.slug = f.slug.value.trim();
    body.source = (f.src_name.value.trim() || f.src_url.value.trim()) ? { name: f.src_name.value.trim(), url: f.src_url.value.trim(), publishedAt: f.src_date.value, licenseNote: f.src_lic.value.trim() } : null;
    body.image = f.img_url.value.trim() ? { url: f.img_url.value.trim(), credit: f.img_credit.value.trim(), rightsNote: f.img_rights.value.trim() } : null;
    if (current) { body.id = current.id; body.updatedAt = current.updatedAt; }
    if (confirmSimilar) body.confirmSimilar = true;
    return body;
  }
  var FIELD_MAP = { title: 'title', summary: 'summary', body: 'body', category: 'category', type: 'type', tags: 'tags', slug: 'slug', 'source.url': 'src_url', 'source.name': 'src_name', 'source.publishedAt': 'src_date', 'image.url': 'img_url', 'image.credit': 'img_credit', 'image.rightsNote': 'img_rights', 'seo.title': 'seo_title', 'seo.description': 'seo_desc', related: 'related' };
  function clearErrors() { $$('.vhp-field.has-error', form).forEach(function (f) { f.classList.remove('has-error'); var e = $('.vhp-err', f); if (e) e.remove(); }); }
  function showErrors(fields) {
    clearErrors();
    Object.keys(fields || {}).forEach(function (k) {
      var input = form.elements[FIELD_MAP[k] || k];
      if (!input || !input.closest) return;
      var wrap = input.closest('.vhp-field');
      wrap.classList.add('has-error');
      var s = doc.createElement('span'); s.className = 'vhp-err'; s.textContent = fields[k]; wrap.appendChild(s);
    });
  }
  function save(confirmSimilar) {
    return api('save', { body: collect(confirmSimilar) }).then(function (j) { fill(j.item); return j.item; }).catch(function (e) {
      if (e.code === 'duplicate_title' && !confirmSimilar) {
        return UI.confirmDialog ? UI.confirmDialog({ title: 'Benzer başlık', message: e.message, confirm: 'Yine de kaydet' }).then(function (ok) { if (ok) return save(true); throw e; }) : Promise.reject(e);
      }
      showErrors(e.fields); throw e;
    });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    save(false).then(function () { say('ok', 'Kaydedildi.'); }, function (err) { say('error', err.message); });
  });
  function lifecycle(action, id, extra) {
    var body = { id: id }; if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    return api(action, { body: body });
  }
  doc.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    var done = function (msg) { return function () { say('ok', msg); var tab = $('[role="tab"][aria-selected="true"]').getAttribute('data-tab'); if (loaders[tab] && tab !== 'edit') loaders[tab](); }; };
    var fail = function (err) { if (err && err.fields) showErrors(err.fields); say('error', err.message); };
    switch (act) {
      case 'new': fill(null); showTab('edit'); break;
      case 'edit': api('editor_get', { query: '&id=' + encodeURIComponent(id) }).then(function (j) { fill(j.item); showTab('edit'); }, fail); break;
      case 'discard': if (window.confirm('Bu otomatik taslak silinsin mi?')) lifecycle('discard', id).then(done('Silindi.'), fail); break;
      case 'publish-id': lifecycle('publish', id).then(done('Yayımlandı.'), fail); break;
      case 'archive-id': lifecycle('archive', id).then(done('Arşivlendi.'), fail); break;
      case 'draft-id': lifecycle('to_draft', id).then(done('Taslağa alındı.'), fail); break;
      case 'social-id': showTab('social'); $('#soc-article').value = id; social(); break;
      case 'posts-reload': loaders.posts(); break;
      case 'publish': save(false).then(function (a) { return lifecycle('publish', a.id); }).then(function (j) { fill(j.item); say('ok', 'Yayımlandı: ' + j.item.url); }, fail); break;
      case 'schedule':
        var when = $('#e-when').value;
        if (!when) { say('error', 'Yayın zamanını seçin.'); break; }
        var iso = new Date(when).toISOString().replace(/\.\d{3}Z$/, 'Z');
        save(false).then(function (a) { return lifecycle('schedule', a.id, { publishAt: iso }); }).then(function (j) { fill(j.item); say('ok', 'Planlandı: ' + fmt(j.item.publishAt)); }, fail);
        break;
      case 'archive': if (current) lifecycle('archive', current.id).then(function (j) { fill(j.item); say('ok', 'Arşivlendi.'); }, fail); break;
      case 'fetch-all': case 'fetch-one':
        b.disabled = true; say('', 'Taranıyor…');
        api('fetch_run', { body: act === 'fetch-one' ? { sourceId: id } : {} }).then(function (j) {
          var parts = j.results.map(function (r) { return r.name + ': ' + (r.ok ? r.added + ' yeni / ' + r.items + ' öğe' : (ERRORS[r.error] || r.error)); });
          say('ok', parts.length ? parts.join(' · ') : 'Etkin kaynak yok.');
          loaders.inbox(); if (act === 'fetch-one') loaders.sources();
        }, fail).then(function () { b.disabled = false; });
        break;
      case 'src-edit': editSource(id); break;
      case 'export':
        api('subscribers_export', { body: {}, raw: true }).then(function (blob) {
          var a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'volthaber-aboneler.csv'; doc.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        }, fail);
        break;
      case 'digest-send': sendDigest(id, b); break;
      case 'social': social(); break;
      case 'card-png':
        var cv = $('[data-card]');
        cv.toBlob(function (blob) { var a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'volthaber-bilgi-karti.png'; doc.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }, 'image/png');
        break;
    }
  });
  $$('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () { var t = doc.getElementById(b.getAttribute('data-copy')); t.select(); (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(function () { b.textContent = 'Kopyalandı'; setTimeout(function () { b.textContent = 'Kopyala'; }, 1500); }, function () { doc.execCommand && doc.execCommand('copy'); }); });
  });

  /* canlı önizleme */
  var timer = 0, seq = 0;
  function counts() {
    var f = form.elements;
    $('[data-count="summary"]').textContent = '(' + f.summary.value.trim().length + '/400)';
    $('[data-count="seo_title"]').textContent = '(' + f.seo_title.value.length + '/70)';
    $('[data-count="seo_desc"]').textContent = '(' + f.seo_desc.value.length + '/170)';
  }
  function preview() {
    var f = form.elements, box = $('[data-preview]'), my = ++seq;
    box.textContent = '';
    var cat = doc.createElement('span'); cat.className = 'article__cat'; cat.textContent = (meta.categories[f.category.value] || [''])[0]; box.appendChild(cat);
    var h = doc.createElement('h1'); h.textContent = f.title.value || 'Başlık'; box.appendChild(h);
    var s = doc.createElement('p'); s.className = 'article__summary'; s.textContent = f.summary.value; box.appendChild(s);
    var body = doc.createElement('div'); body.className = 'vh-body'; box.appendChild(body);
    if (!f.body.value.trim()) return;
    api('preview', { body: { body: f.body.value } }).then(function (j) { if (my === seq) body.innerHTML = j.html; }, function (e) { if (my === seq) body.textContent = e.message; });
  }
  form.addEventListener('input', function () { counts(); clearTimeout(timer); timer = setTimeout(preview, 600); });

  /* ------------------------------------------------------------ kaynaklar */
  var sources = [];
  loaders.sources = function () {
    var tb = $('[data-list="sources"]');
    api('sources').then(function (j) {
      sources = j.items; setMeta({ categories: j.categories });
      tb.innerHTML = j.items.map(function (s) {
        return row([
          '<strong>' + esc(s.name) + '</strong><br><small>' + esc(s.feedUrl) + '</small>',
          esc(s.permission), s.enabled ? '<span class="vhp-st vhp-st--published">Etkin</span>' : '<span class="vhp-st vhp-st--archived">Kapalı</span>',
          esc(fmt(s.lastFetchAt)) + (s.lastStatus ? '<br><small>' + esc(ERRORS[s.lastStatus] || s.lastStatus) + '</small>' : ''),
          '<div class="vhp-src-notes">' + esc(s.notes) + (s.termsUrl ? '<br><a href="' + esc(s.termsUrl) + '" target="_blank" rel="noopener noreferrer">koşullar</a>' : '') + '</div>',
          btn('src-edit', s.id, 'Düzenle') + btn('fetch-one', s.id, 'Şimdi tara')]);
      }).join('');
    }, function (e) { tb.innerHTML = row([esc(e.message), '', '', '', '', '']); });
  };
  var sform = $('[data-form="source"]');
  function editSource(id) {
    var s = sources.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    ['id', 'name', 'feedUrl', 'homepage', 'termsUrl', 'format', 'category', 'permission', 'licenseNote', 'notes'].forEach(function (k) { sform.elements[k].value = s[k] || ''; });
    sform.elements.enabled.checked = !!s.enabled;
    sform.elements.id.readOnly = true;
    $('[data-src-legend]').textContent = 'Kaynağı düzenle: ' + s.name;
    sform.scrollIntoView({ block: 'start' });
  }
  sform.addEventListener('reset', function () { sform.elements.id.readOnly = false; $('[data-src-legend]').textContent = 'Kaynak ekle / düzenle'; });
  sform.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {};
    ['id', 'name', 'feedUrl', 'homepage', 'termsUrl', 'format', 'category', 'permission', 'licenseNote', 'notes'].forEach(function (k) { body[k] = sform.elements[k].value.trim(); });
    body.enabled = sform.elements.enabled.checked;
    api('source_save', { body: body }).then(function () { say('ok', 'Kaynak kaydedildi.'); sform.reset(); loaders.sources(); }, function (err) { say('error', err.message); });
  });

  /* ------------------------------------------------------------ günlükler */
  loaders.logs = function () {
    api('fetch_log').then(function (j) {
      $('[data-list="fetchlog"]').innerHTML = j.items.length ? j.items.map(function (e) {
        return row([esc(fmt(e.at)), esc(e.name), e.ok ? 'tamam' : esc(ERRORS[e.error] || e.error), esc(e.items + ' / ' + e.added), esc(e.ms + ' ms'), esc(e.trigger)]);
      }).join('') : row(['Henüz tarama yapılmadı.', '', '', '', '', '']);
    }, function (e) { say('error', e.message); });
    api('pub_log').then(function (j) {
      $('[data-list="publog"]').innerHTML = j.items.length ? j.items.map(function (e) {
        return row([esc(fmt(e.at)), esc(e.action), esc(e.title || e.id), esc(e.by || '')]);
      }).join('') : row(['Kayıt yok.', '', '', '']);
    }, function (e) { say('error', e.message); });
  };

  /* ------------------------------------------------------------ istatistik + bülten */
  loaders.stats = function () {
    api('stats').then(function (j) {
      var c = j.counts, s = j.subscribers;
      var tiles = [['Yayında', c.published], ['Planlı', c.scheduled], ['Taslak', c.draft - c.inbox], ['Gelen kutusu', c.inbox], ['Arşiv', c.archived], ['Aktif abone', s.active], ['Onay bekleyen', s.pending], ['Ayrılan', s.unsubscribed]];
      $('[data-stats]').innerHTML = tiles.map(function (t) { return '<div class="vhp-stat"><b>' + esc(String(t[1])) + '</b><span>' + esc(t[0]) + '</span></div>'; }).join('');
      $('[data-list="mostread"]').innerHTML = j.mostRead.length ? j.mostRead.map(function (a) { return row(['<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a>', String(a.views)]); }).join('') : row(['Henüz okunma verisi yok.', '']);
    }, function (e) { say('error', e.message); });
    api('editor_list', { query: '&status=published' }).then(function (j) {
      $('[data-digest-articles]').innerHTML = j.items.slice(0, 30).map(function (a) {
        return '<label class="vhp-check"><input type="checkbox" name="art" value="' + esc(a.id) + '"> ' + esc(a.title) + '</label>';
      }).join('') || '<p class="vhp-muted">Yayında yazı yok.</p>';
    });
    loadDigests();
  };
  function loadDigests() {
    api('digest_list').then(function (j) {
      $('[data-list="digests"]').innerHTML = j.items.length ? j.items.map(function (d) {
        return row([esc(d.subject) + '<br><small>' + esc(fmt(d.createdAt)) + '</small>', String(d.total), esc(d.sent + (d.failed ? ' (' + d.failed + ' hata)' : '')),
          d.done ? 'Tamamlandı' : 'Sürüyor', d.done ? '' : btn('digest-send', d.id, 'Sonraki grubu gönder', 'vhp-btn--primary')]);
      }).join('') : row(['Henüz bülten yok.', '', '', '', '']);
    }, function (e) { say('error', e.message); });
  }
  function sendDigest(id, b) {
    b.disabled = true;
    api('digest_send', { body: { id: id } }).then(function (j) {
      say('ok', j.sent + ' / ' + j.total + ' gönderildi' + (j.done ? '. Bülten tamamlandı.' : '. Sonraki grup ' + j.nextInSeconds + ' saniye sonra gönderilebilir.'));
      loadDigests();
    }, function (e) { say('error', e.message); b.disabled = false; });
  }
  $('[data-form="digest"]').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var ids = $$('input[name="art"]:checked', f).map(function (i) { return i.value; });
    api('digest_create', { body: { subject: f.elements.subject.value.trim(), intro: f.elements.intro.value.trim(), articleIds: ids } }).then(function (j) {
      say('ok', 'Bülten oluşturuldu: ' + j.total + ' alıcı. "Sonraki grubu gönder" ile gönderin.'); f.reset(); loadDigests();
    }, function (err) { say('error', err.message); });
  });

  /* ------------------------------------------------------------ sosyal taslak + bilgi kartı */
  loaders.social = function () {
    var sel = $('#soc-article');
    if (sel.options.length) return;
    api('editor_list', { query: '&origin=editorial' }).then(function (j) {
      j.items.forEach(function (a) { var o = doc.createElement('option'); o.value = a.id; o.textContent = (STATUS[a.status] || '') + ' · ' + a.title; sel.appendChild(o); });
    });
  };
  function social() {
    var id = $('#soc-article').value;
    if (!id) return;
    api('social', { query: '&id=' + encodeURIComponent(id) }).then(function (j) {
      var d = j.drafts;
      $('#soc-li').value = d.linkedin; $('#soc-ig').value = d.instagram;
      $('#soc-yt').value = 'Konu: ' + d.shorts.konu + '\nSüre: ' + d.shorts.sure + '\n\n' + d.shorts.akis.join('\n') + '\n\nNot: ' + d.shorts.not;
      $('[data-soc-notice]').textContent = d.notice;
      $('[data-social]').hidden = false;
      drawCard(d.card);
    }, function (e) { say('error', e.message); });
  }
  function wrap(ctx, text, maxW, maxLines) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; });
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
    return lines;
  }
  function drawCard(c) {
    var cv = $('[data-card]'), x = cv.getContext('2d'), W = cv.width, H = cv.height, P = 84;
    var g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0a1628'); g.addColorStop(1, '#1e3a5f');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 2;
    for (var i = -H; i < W; i += 60) { x.beginPath(); x.moveTo(i, H); x.lineTo(i + H, 0); x.stroke(); }
    x.fillStyle = '#f59e0b'; x.fillRect(0, 0, W, 14);
    x.textBaseline = 'top';
    x.font = '800 46px Outfit, system-ui, sans-serif'; x.fillStyle = '#fff'; x.fillText('Volt', P, P);
    var vw = x.measureText('Volt').width; x.fillStyle = '#f59e0b'; x.fillText('Haber', P + vw, P);
    x.font = '600 26px Inter, system-ui, sans-serif'; x.fillStyle = 'rgba(255,255,255,.7)'; x.fillText('VOLTGUARD BİLGİ KARTI', P, P + 62);
    var y = P + 150;
    x.font = '700 28px Inter, system-ui, sans-serif'; var cw = x.measureText(c.category).width + 40;
    x.fillStyle = 'rgba(245,158,11,.18)'; x.fillRect(P, y, cw, 52); x.fillStyle = '#fcd34d'; x.fillText(c.category, P + 20, y + 11);
    y += 92;
    x.font = '800 64px Outfit, system-ui, sans-serif'; x.fillStyle = '#fff';
    wrap(x, c.title, W - 2 * P, 6).forEach(function (l) { x.fillText(l, P, y); y += 78; });
    y += 30; x.fillStyle = '#f59e0b'; x.fillRect(P, y, 120, 6); y += 40;
    x.font = '400 36px Inter, system-ui, sans-serif'; x.fillStyle = 'rgba(255,255,255,.88)';
    wrap(x, c.summary, W - 2 * P, Math.max(2, Math.floor((H - 260 - y) / 52))).forEach(function (l) { x.fillText(l, P, y); y += 52; });
    x.font = '600 28px Inter, system-ui, sans-serif'; x.fillStyle = 'rgba(255,255,255,.75)';
    wrap(x, c.source + ' · ' + c.date, W - 2 * P, 2).forEach(function (l, k) { x.fillText(l, P, H - 190 + k * 38); });
    x.fillStyle = '#f59e0b'; x.font = '800 34px Outfit, system-ui, sans-serif'; x.fillText(c.url, P, H - 108);
  }

  /* ------------------------------------------------------------ başlat */
  Auth.requireAuth().then(function (user) {
    if (UI.initNav) UI.initNav('volthaber', user);
    return api('editor_me');
  }).then(function (j) {
    if (!j.editor) {
      gate.innerHTML = '<div class="vg-acct-state"><h2>Bu alan VoltHaber editörlerine açıktır</h2><p>Hesabınızda editör yetkisi yok. Yetki yalnızca site yönetimi tarafından sunucuda verilir.</p><p><a class="vg-btn vg-btn--primary" href="panel.html">Hesabıma dön</a></p></div>';
      return;
    }
    gate.hidden = true;
    $('[data-vhp-app]').hidden = false;
    showTab('inbox');
    fill(null);
  }).catch(function (e) {
    gate.textContent = (e && e.message) || 'Panel yüklenemedi.';
  });
}());
