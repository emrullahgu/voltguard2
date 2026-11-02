// The two API workspaces use the native MFA staff session, independently of
// company-record storage. No credentials, prompts or responses are persisted.
export const CONNECTED_ROUTES = ['ConnectedAi', 'ConnectedData'];
export const AI_PROVIDERS = ['gemini', 'groq', 'openrouter', 'cloudflare'];
export const DATA_SERVICES = ['epias', 'ipinfo', 'github', 'unsplash', 'tmdb', 'newsapi', 'jsonplaceholder', 'dummyjson'];
export function isConnectedServiceRoute(route) { return CONNECTED_ROUTES.includes(route); }
function failure(message, code = 'integration_request', status = 0) { return Object.assign(new Error(message), {code, status}); }
function validURL(value) { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch (_) { return false; } }
function validateStatus(data) {
  for (const provider of AI_PROVIDERS) {
    const row = data?.ai?.[provider];
    if (!row || row.provider !== provider || typeof row.configured !== 'boolean' || typeof row.model !== 'string' || typeof row.notice !== 'string' || !validURL(row.privacyUrl)) throw failure('Yapay zekâ bağlantı durumu doğrulanamadı.', 'invalid_response');
  }
  for (const service of DATA_SERVICES) {
    const row = data?.services?.[service];
    if (!row || typeof row.configured !== 'boolean' || typeof row.available !== 'boolean' || typeof row.notice !== 'string') throw failure('Veri servislerinin bağlantı durumu doğrulanamadı.', 'invalid_response');
  }
  return data;
}
export function connectedDataParams(service, fields) {
  const value = key => String(fields[key] || '').trim();
  if (service === 'epias') {
    const date = value('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T12:00:00Z')) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) throw failure('Geçerli bir tarih girin: YYYY-AA-GG.', 'invalid_input');
    return {date};
  }
  if (service === 'ipinfo') { const ip = value('ip'); if (!ip || ip.length > 45 || !/^[A-Fa-f0-9:.]+$/.test(ip)) throw failure('Sorgulanacak genel IP adresini girin.', 'invalid_input'); return {ip}; }
  if (service === 'github') { const owner = value('owner'), repo = value('repo'); if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(owner) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repo)) throw failure('GitHub depo sahibi ve depo adını girin.', 'invalid_input'); return {owner, repo}; }
  if (['unsplash', 'tmdb', 'newsapi'].includes(service)) { const q = value('q'); if (!q || [...q].length > 100 || /[\x00-\x1F\x7F]/.test(q)) throw failure('En fazla 100 karakterlik arama sözcüğü girin.', 'invalid_input'); return {q}; }
  if (['jsonplaceholder', 'dummyjson'].includes(service)) { const limit = value('limit'); if (!/^(?:[5-9]|1[0-9]|20)$/.test(limit)) throw failure('Örnek kayıt sayısını 5–20 arasında girin.', 'invalid_input'); return {limit}; }
  throw failure('Geçerli bir veri servisi seçin.', 'invalid_input');
}

export function createConnectedServiceSession({expectedUserId, fetchImpl = (...args) => fetch(...args), onInvalid = () => {}}) {
  let generation = 0, disposed = false, user = null;
  const pending = new Set();
  const changed = () => failure('Çalışan oturumu değişti. Önceki isteğin sonucu kullanılmadı.', 'staff_session_changed');
  function invalidate(notify = true) {
    generation++; user = null;
    for (const controller of pending) controller.abort();
    pending.clear();
    if (notify && !disposed) onInvalid();
  }
  function guard(version) { if (disposed || generation !== version) throw changed(); }
  async function read(route, options, version, api) {
    guard(version);
    const controller = new AbortController(); pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetchImpl(route, {...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
      guard(version);
      const payload = await response.json().catch(() => { throw failure('Sunucu geçerli bir yanıt vermedi.', 'invalid_response', response.status); });
      guard(version);
      if (payload?.api !== api || typeof payload.ok !== 'boolean') throw failure('Sunucu yanıtı doğrulanamadı.', 'invalid_response', response.status);
      if (!response.ok || !payload.ok) {
        if (response.status === 401 || ['staff_csrf', 'staff_unauthorized'].includes(payload.error)) invalidate();
        throw failure(payload.message || 'Sunucu işlemi reddetti.', payload.error || 'server_error', response.status);
      }
      return payload;
    } catch (error) {
      guard(version);
      if (error?.name === 'AbortError') throw failure('Sunucu zamanında yanıt vermedi. İstek otomatik yeniden gönderilmedi.', 'request_timeout');
      throw error;
    } finally { clearTimeout(timer); pending.delete(controller); }
  }
  async function identity(version) {
    const payload = await read('/api/staff.php?action=me', {method: 'GET', headers: {Accept: 'application/json'}}, version, 'vg-staff/1');
    const actor = payload.user;
    if (!actor || typeof actor.id !== 'string' || actor.id !== expectedUserId || !['employee', 'payroll', 'admin'].includes(actor.role) || payload.mfa !== null || typeof payload.csrf !== 'string' || !/^[a-f0-9]{64}$/.test(payload.csrf)) {
      invalidate(); throw failure('Çalışan hesabınızla ve doğrulama kodunuzla yeniden giriş yapın.', 'staff_unauthorized', 401);
    }
    user = {id: actor.id, role: actor.role};
    return {user, csrf: payload.csrf};
  }
  async function perform(action, body, query = {}) {
    const version = generation;
    const before = await identity(version); guard(version);
    if (DATA_SERVICES.includes(action) && action !== 'epias' && before.user.role !== 'admin') throw failure('Bu sorgu için yönetici yetkisi gerekiyor.', 'admin_required', 403);
    const parameters = new URLSearchParams(query); parameters.set('action', action);
    const headers = {Accept: 'application/json'};
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['X-VG-STAFF-CSRF'] = before.csrf; }
    const payload = await read('/api/integrations.php?' + parameters, {method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : {body: JSON.stringify(body)})}, version, 'vg-integrations/1');
    // A private GET has no CSRF request header. Recheck both owner and session
    // token after decoding so a cross-tab account switch cannot expose its result.
    const after = await identity(version); guard(version);
    if (after.user.id !== before.user.id || after.user.role !== before.user.role || after.csrf !== before.csrf) { invalidate(); throw changed(); }
    return payload.data;
  }
  return {
    invalidate,
    dispose() { disposed = true; invalidate(false); },
    getUser() { return user ? {...user} : null; },
    async status() { return validateStatus(await perform('status')); },
    async send(provider, prompt) {
      if (!AI_PROVIDERS.includes(provider) || typeof prompt !== 'string' || !prompt.trim() || [...prompt].length > 12000) throw failure('Sağlayıcı seçin ve en fazla 12.000 karakterlik bir ileti yazın.', 'invalid_input');
      const result = await perform('ai_chat', {provider, prompt, maxOutputTokens: 1024});
      if (result?.provider !== provider || typeof result.text !== 'string' || !result.text.trim() || typeof result.model !== 'string' || !Number.isFinite(Date.parse(result.generatedAt)) || typeof result.truncated !== 'boolean' || !result.usage) throw failure('Yapay zekâ yanıtı doğrulanamadı.', 'invalid_response');
      return result;
    },
    async query(service, fields) {
      if (!DATA_SERVICES.includes(service)) throw failure('Geçerli bir veri servisi seçin.', 'invalid_input');
      const result = await perform(service, undefined, connectedDataParams(service, fields));
      if (!result || typeof result.provider !== 'string' || typeof result.source?.name !== 'string' || !validURL(result.source?.url) || !Number.isFinite(Date.parse(result.retrievedAt))) throw failure('Veri servisinin yanıtı doğrulanamadı.', 'invalid_response');
      return result;
    },
  };
}
