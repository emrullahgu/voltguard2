/* VoltGuard public community. Messages are stored by the server only. */
(function () {
  'use strict';
  const API = '/api/community.php';
  const form = document.getElementById('community-form');
  if (!form) return;
  const nameInput = document.getElementById('community-name');
  const messageInput = document.getElementById('community-message');
  const submit = document.getElementById('community-submit');
  const formStatus = document.getElementById('community-form-status');
  const feedStatus = document.getElementById('community-feed-status');
  const feed = document.getElementById('community-feed');
  const loading = document.getElementById('community-loading');
  const empty = document.getElementById('community-empty');
  const loadError = document.getElementById('community-load-error');
  const loadErrorText = document.getElementById('community-load-error-text');
  const more = document.getElementById('community-more');
  const refresh = document.getElementById('community-refresh');
  const account = document.getElementById('community-account');
  const replyContext = document.getElementById('community-reply-context');
  const replyTo = document.getElementById('community-reply-to');
  const formatter = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'medium', timeStyle: 'short' });
  const state = { items: new Map(), csrf: '', nextBefore: null, canPublish: false, loading: false, publishing: false, replyId: null, guestName: '', user: null };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function status(element, text, kind) {
    element.textContent = text || '';
    element.classList.toggle('community-status--error', kind === 'error');
    element.classList.toggle('community-status--success', kind === 'success');
  }
  function updateSubmit() {
    submit.disabled = state.publishing || !state.canPublish || !state.csrf;
    submit.textContent = state.publishing ? 'Yayımlanıyor…' : state.replyId ? 'Yanıtı yayımla →' : 'Yorumu yayımla →';
    nameInput.disabled = state.publishing;
    messageInput.disabled = state.publishing;
    document.getElementById('community-cancel-reply').disabled = state.publishing;
  }
  function updateCount() {
    document.getElementById('community-character-count').textContent = messageInput.value.length.toLocaleString('tr-TR') + ' / 2.000';
  }
  function setReply(item, focus) {
    state.replyId = item ? String(item.id) : null;
    replyContext.hidden = !item;
    replyTo.textContent = item ? item.authorName + ' adlı kişinin paylaşımına yanıt veriyorsunuz.' : '';
    document.getElementById('community-message-label').textContent = item ? 'Yanıtınız' : 'Yorumunuz';
    updateSubmit();
    if (focus) {
      document.getElementById('yorum-yaz').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      messageInput.focus({ preventScroll: true });
    }
  }
  function updateAccount(user) {
    if (!user && state.user && nameInput.readOnly) nameInput.value = state.guestName;
    if (user && !state.user) state.guestName = nameInput.value;
    state.user = user && typeof user.name === 'string' ? user : null;
    account.replaceChildren();
    nameInput.readOnly = !!state.user;
    if (state.user) {
      nameInput.value = state.user.name;
      const label = node('span', '', 'Üye hesabınızla katılıyorsunuz: ');
      label.append(node('strong', '', state.user.name));
      account.append(label);
      const link = node('a', '', 'Hesabımı aç ↗');
      link.href = '/hesap/panel.html';
      account.append(link);
      document.getElementById('community-name-hint').textContent = 'Hesabınızda kayıtlı ad kullanılır.';
    } else {
      account.append(node('span', '', 'Misafir olarak katılabilirsiniz.'));
      const link = node('a', '', 'Üye hesabıyla giriş yap ↗');
      link.href = '/hesap/giris.html?next=%2Ftopluluk.html';
      account.append(link);
      document.getElementById('community-name-hint').textContent = 'Paylaşımınız bu adla görünür.';
    }
  }
  async function request(action, payload, before) {
    const url = new URL(API, location.origin);
    url.searchParams.set('action', action);
    if (before !== null && before !== undefined) url.searchParams.set('before', String(before));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const options = { method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } };
    if (payload) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['X-VG-CSRF'] = state.csrf;
      options.body = JSON.stringify(payload);
    }
    try {
      const response = await fetch(url.href, options);
      let result;
      try { result = await response.json(); } catch (_) { throw new Error('Topluluk servisine şu anda ulaşılamıyor. Biraz sonra tekrar deneyin.'); }
      if (!result || result.api !== 'vg-auth/1') throw new Error('Topluluk servisine şu anda ulaşılamıyor. Biraz sonra tekrar deneyin.');
      if (!response.ok || result.ok === false) {
        const error = new Error(typeof result.message === 'string' && result.message ? result.message : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.');
        error.code = result.error;
        error.status = response.status;
        error.fields = result.fields;
        throw error;
      }
      if (result.service !== 'vg-community/1') throw new Error('Topluluk servisine şu anda ulaşılamıyor. Biraz sonra tekrar deneyin.');
      if (typeof result.csrf === 'string' && result.csrf) state.csrf = result.csrf;
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Yanıt alınması uzun sürdü. Bağlantınızı kontrol edip yeniden deneyin.');
      if (error instanceof TypeError) throw new Error('Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function validItem(item) {
    return item && (typeof item.id === 'string' || typeof item.id === 'number') && typeof item.authorName === 'string' && typeof item.message === 'string' && typeof item.createdAt === 'string';
  }
  function renderComment(item) {
    const id = String(item.id);
    const article = node('article', 'community-comment' + (item.parentId ? ' community-comment--reply' : ''));
    article.id = 'community-comment-' + id;
    article.setAttribute('role', 'listitem');
    const header = node('div', 'community-comment-header');
    const avatar = node('span', 'community-avatar', item.deleted ? '·' : Array.from(item.authorName.trim())[0]?.toLocaleUpperCase('tr-TR') || 'V');
    avatar.setAttribute('aria-hidden', 'true');
    const meta = node('div', 'community-comment-meta');
    const row = node('div', 'community-author-row');
    const author = node('h3', 'community-author', item.authorName);
    author.id = 'community-author-' + id;
    article.setAttribute('aria-labelledby', author.id);
    row.append(author);
    if (item.authorType === 'guest' || item.authorType === 'member') row.append(node('span', 'community-author-type', item.authorType === 'guest' ? 'Ziyaretçi' : 'Üye'));
    meta.append(row);
    const date = new Date(item.createdAt);
    const time = node('time', '', Number.isNaN(date.getTime()) ? 'Tarih bilgisi yok' : formatter.format(date));
    if (!Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
    meta.append(time);
    header.append(avatar, meta);
    article.append(header);
    if (item.parentId) {
      const parent = state.items.get(String(item.parentId));
      const parentNote = node('p', 'community-parent-note', '↳ ');
      if (parent) {
        const link = node('a', '', parent.authorName + ' adlı kişinin paylaşımına yanıt');
        link.href = '#community-comment-' + encodeURIComponent(String(parent.id));
        parentNote.append(link);
      } else parentNote.append(document.createTextNode('Bir paylaşıma yanıt'));
      article.append(parentNote);
    }
    article.append(node('p', 'community-message' + (item.deleted ? ' community-message--deleted' : ''), item.deleted ? 'Bu yorum kaldırıldı.' : item.message));
    if (!item.deleted) {
      const actions = node('div', 'community-comment-actions');
      const reply = node('button', 'community-action', 'Yanıt ver ↗');
      reply.type = 'button';
      reply.addEventListener('click', () => setReply(item, true));
      actions.append(reply);
      if (item.canDelete === true) {
        const remove = node('button', 'community-action community-action--delete', 'Sil');
        remove.type = 'button';
        remove.addEventListener('click', () => confirmDelete(item, article, remove));
        actions.append(remove);
      }
      article.append(actions);
    }
    return article;
  }
  function renderFeed() {
    const fragment = document.createDocumentFragment();
    for (const item of state.items.values()) fragment.append(renderComment(item));
    feed.replaceChildren(fragment);
    empty.hidden = state.items.size > 0;
    more.hidden = state.nextBefore === null || state.nextBefore === undefined;
  }
  async function load(append) {
    if (state.loading) return;
    state.loading = true;
    loading.hidden = append || state.items.size > 0;
    loadError.hidden = true;
    empty.hidden = true;
    refresh.disabled = true;
    more.disabled = true;
    more.textContent = append ? 'Yükleniyor…' : 'Önceki paylaşımları yükle ↓';
    feed.setAttribute('aria-busy', 'true');
    status(feedStatus, '');
    try {
      const result = await request('list', null, append ? state.nextBefore : null);
      if (!Array.isArray(result.items) || !result.items.every(validItem) || typeof result.csrf !== 'string' || !result.csrf) throw new Error('Paylaşımlar alınamadı. Lütfen tekrar deneyin.');
      if (!append) state.items.clear();
      for (const item of result.items) state.items.set(String(item.id), item);
      state.nextBefore = result.nextBefore ?? null;
      state.canPublish = result.canPublish === true;
      if (state.replyId && state.items.get(state.replyId)?.deleted) setReply(null, false);
      renderFeed();
      if (!state.canPublish) status(formStatus, 'Yeni yorumlar şu anda kabul edilmiyor. Daha sonra tekrar deneyebilirsiniz.');
      else if (!state.publishing && formStatus.textContent === 'Paylaşım alanı hazırlanıyor…') status(formStatus, '');
      if (append) status(feedStatus, result.items.length + ' paylaşım daha yüklendi.');
      updateAccount(window.VG?.Auth?.currentUser?.() || null);
    } catch (error) {
      if (!state.items.size) {
        loadError.hidden = false;
        loadErrorText.textContent = error.message;
      } else status(feedStatus, error.message, 'error');
      if (!state.csrf) status(formStatus, 'Yorum yazmak için paylaşım alanının yüklenmesi gerekiyor. “Tekrar dene” ile yeniden açabilirsiniz.', 'error');
    } finally {
      state.loading = false;
      loading.hidden = true;
      refresh.disabled = false;
      more.disabled = false;
      more.textContent = 'Önceki paylaşımları yükle ↓';
      feed.setAttribute('aria-busy', 'false');
      updateSubmit();
    }
  }
  function confirmDelete(item, article, trigger) {
    if (article.querySelector('.community-delete-confirm')) return;
    const box = node('div', 'community-delete-confirm');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Yorumu silme onayı');
    box.append(node('span', '', 'Bu yorumu kaldırmak istiyor musunuz?'));
    const accept = node('button', 'community-secondary community-delete-accept', 'Yorumu sil');
    const cancel = node('button', 'community-secondary', 'Vazgeç');
    accept.type = cancel.type = 'button';
    cancel.addEventListener('click', () => { box.remove(); trigger.focus(); });
    accept.addEventListener('click', async () => {
      accept.disabled = cancel.disabled = true;
      accept.textContent = 'Siliniyor…';
      try {
        const result = await request('delete', { id: item.id });
        if (result.deleted !== true) throw new Error('Yorum kaldırılamadı. Lütfen tekrar deneyin.');
        state.items.set(String(item.id), { ...item, deleted: true, canDelete: false, message: '', authorName: 'Kaldırılmış yorum', authorType: null });
        if (state.replyId === String(item.id)) setReply(null, false);
        renderFeed();
        status(feedStatus, 'Yorum kaldırıldı.', 'success');
        feedStatus.focus({ preventScroll: true });
      } catch (error) {
        accept.disabled = cancel.disabled = false;
        accept.textContent = 'Yorumu sil';
        if (error.status === 403) await load(false);
        status(feedStatus, error.message, 'error');
      }
    });
    box.append(accept, cancel);
    article.append(box);
    accept.focus({ preventScroll: true });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.publishing || !state.csrf || !state.canPublish) return;
    const authorName = nameInput.value.trim();
    const message = messageInput.value.trim();
    if (!state.user && (Array.from(authorName).length < 2 || Array.from(authorName).length > 60)) {
      status(formStatus, 'Görünen adınız 2 ile 60 karakter arasında olmalı.', 'error');
      nameInput.focus();
      return;
    }
    if (Array.from(message).length < 2 || Array.from(message).length > 2000) {
      status(formStatus, 'Yorumunuz 2 ile 2.000 karakter arasında olmalı.', 'error');
      messageInput.focus();
      return;
    }
    state.publishing = true;
    updateSubmit();
    status(formStatus, 'Yorumunuz yayımlanıyor…');
    try {
      const result = await request('publish', { authorName, message, parentId: state.replyId, website: document.getElementById('community-website').value });
      if (!validItem(result.item)) throw new Error('Yayım sonucu doğrulanamadı. Tekrar göndermeden önce paylaşımları yenileyin.');
      state.items = new Map([[String(result.item.id), result.item], ...state.items]);
      renderFeed();
      messageInput.value = '';
      updateCount();
      setReply(null, false);
      status(formStatus, 'Yorumunuz yayımlandı. Teşekkürler.', 'success');
    } catch (error) {
      status(formStatus, error.message, 'error');
      if (error.fields?.authorName) nameInput.focus();
      else if (error.fields?.message) messageInput.focus();
      if (error.status === 403) load(false);
    } finally {
      state.publishing = false;
      updateSubmit();
    }
  });
  messageInput.addEventListener('input', updateCount);
  nameInput.addEventListener('input', () => { if (!state.user) state.guestName = nameInput.value; });
  more.addEventListener('click', () => load(true));
  refresh.addEventListener('click', () => load(false));
  document.getElementById('community-retry').addEventListener('click', () => load(false));
  document.getElementById('community-cancel-reply').addEventListener('click', () => setReply(null, true));
  document.addEventListener('vg:auth', event => {
    updateAccount(event.detail?.user || null);
    if (state.csrf) load(false);
  });
  updateAccount(window.VG?.Auth?.currentUser?.() || null);
  updateCount();
  // The public account module may skip a cookie-only session when its optional
  // local hint is absent. Check the real server session after list establishes
  // the guest cookie, keeping anonymous and member CSRF values in one session.
  load(false).then(async () => {
    const auth = window.VG?.Auth;
    if (!auth?.session) return;
    try { await auth.session({ force: true }); updateAccount(auth.currentUser()); }
    catch (_) { /* The community remains usable without an account check. */ }
  });
}());
