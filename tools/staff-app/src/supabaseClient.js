/* Compatibility surface for the reviewed modules. Identity and data always come from the private PHP API. */
import { configurePrivateStorage, hydratePrivateStorage, resetPrivateStorage, privateStorage } from './privateStorage.js';

export const COMPANY_ENDPOINT = '/api/company.php';
const listeners = new Set();
let currentUser = null;
let currentCapabilities = {};
let currentCatalog = {};
let csrf = '';
let bootstrapPromise = null;

function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function errorFrom(message, code = 'client_error', status = 0, fields) {
  const error = new Error(message);
  error.code = code; error.status = status;
  if (fields) error.fields = fields;
  return error;
}
function notify(event) {
  const session = currentUser ? { user: copy(currentUser) } : null;
  for (const callback of listeners) queueMicrotask(() => callback(event, copy(session)));
}
export function getStaffIdentity() { return copy(currentUser); }
export function getStaffCapabilities() { return copy(currentCapabilities); }
export function clearStaffClientState() {
  currentUser = null; currentCapabilities = {}; currentCatalog = {}; csrf = '';
  resetPrivateStorage();
  notify('SIGNED_OUT');
}

async function transport(action, body, expectedApi = 'vg-company/1', endpoint = COMPANY_ENDPOINT) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) {
      if (!csrf) throw errorFrom('Çalışan güvenlik doğrulaması eksik. Oturumu yeniden kontrol edin.', 'staff_csrf');
      headers['Content-Type'] = 'application/json';
      headers['X-VG-STAFF-CSRF'] = csrf;
    }
    let response;
    try {
      response = await fetch(`${endpoint}?action=${encodeURIComponent(action)}`, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal
      });
    } catch (_) { throw errorFrom('Şirket sunucusuna ulaşılamıyor. Bağlantıyı kontrol edip yeniden deneyin.', 'network_error'); }
    let payload;
    try { payload = await response.json(); }
    catch (_) { throw errorFrom('Şirket sunucusu geçerli bir yanıt vermedi. Lütfen yeniden deneyin.', 'invalid_response', response.status); }
    if (payload.api !== expectedApi || typeof payload.ok !== 'boolean') throw errorFrom('Şirket sunucusu yanıtı doğrulanamadı.', 'invalid_response', response.status);
    if (typeof payload.csrf === 'string' && /^[a-f0-9]{64}$/.test(payload.csrf)) csrf = payload.csrf;
    if (!response.ok || !payload.ok) {
      if (response.status === 401) clearStaffClientState();
      throw errorFrom(payload.message || 'Şirket işlemi tamamlanamadı.', payload.error || 'server_error', response.status, payload.fields);
    }
    return payload;
  } finally { clearTimeout(timeout); }
}

export function bootstrapCompany({ force = false } = {}) {
  if (bootstrapPromise) return bootstrapPromise;
  if (!force && currentUser && csrf) return Promise.resolve({ user: getStaffIdentity(), capabilities: getStaffCapabilities(), catalog: copy(currentCatalog) });
  bootstrapPromise = transport('bootstrap').then(payload => {
    const data = payload.data;
    if (!data || !data.user || !['employee', 'payroll', 'admin'].includes(data.user.role)
        || data.user.approved !== true || !csrf) {
      clearStaffClientState();
      throw errorFrom('Geçerli çalışan oturumu gerekiyor.', 'staff_identity', 401);
    }
    const previous = JSON.stringify(currentUser);
    const changedOwner = currentUser?.id !== data.user.id;
    if (changedOwner) resetPrivateStorage();
    currentUser = copy(data.user);
    currentCapabilities = copy(data.capabilities || {});
    currentCatalog = copy(data.catalog || {});
    hydratePrivateStorage(data.storage || {}, currentUser.id);
    if (previous !== JSON.stringify(currentUser)) notify(changedOwner ? 'SIGNED_IN' : 'USER_UPDATED');
    return { user: getStaffIdentity(), capabilities: getStaffCapabilities(), catalog: copy(currentCatalog) };
  }).finally(() => { bootstrapPromise = null; });
  return bootstrapPromise;
}

export function initializePortal() { return bootstrapCompany({ force: true }); }

export async function companyRequest(action, body) {
  await bootstrapCompany();
  return transport(action, body);
}

export async function forgetRememberedDevices() {
  await bootstrapCompany();
  await transport('forget_devices', {}, 'vg-staff/1', '/api/staff.php');
  clearStaffClientState();
}

configurePrivateStorage({
  identity: getStaffIdentity,
  async persist(key, value, expectedOwner) {
    if (currentUser?.id !== expectedOwner) throw errorFrom('Çalışan oturumu değişti. Kayıt yeniden doğrulanmalıdır.', 'staff_identity');
    await companyRequest('storage', { key, value });
  }
});

class Query {
  constructor(table) {
    if (typeof table !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(table)) throw errorFrom('Tablo kimliği geçersiz.', 'invalid_table');
    this.request = { table, operation: 'select', select: '*', filters: [], order: [], limit: null, range: null,
      single: null, rows: null, onConflict: null, returning: false };
    this.promise = null;
  }
  mutable() {
    if (this.promise) throw errorFrom('Çalıştırılmış sorgu değiştirilemez. Yeni bir sorgu oluşturun.', 'query_executed');
  }
  select(columns = '*') {
    this.mutable();
    if (typeof columns !== 'string' || columns.length > 4000) throw errorFrom('Sorgu alanları geçersiz.', 'invalid_select');
    this.request.select = columns.trim() || '*';
    if (this.request.operation !== 'select') this.request.returning = true;
    return this;
  }
  insert(rows) { this.mutable(); this.request.operation = 'insert'; this.request.rows = copy(Array.isArray(rows) ? rows : [rows]); return this; }
  upsert(rows, options = {}) {
    this.mutable(); this.request.operation = 'upsert'; this.request.rows = copy(Array.isArray(rows) ? rows : [rows]);
    this.request.onConflict = options.onConflict ?? null; return this;
  }
  update(rows) { this.mutable(); this.request.operation = 'update'; this.request.rows = copy(rows); return this; }
  delete() { this.mutable(); this.request.operation = 'delete'; this.request.rows = null; return this; }
  filter(op, field, value) {
    this.mutable();
    if (typeof field !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/.test(field)) throw errorFrom('Sorgu alanı geçersiz.', 'invalid_field');
    this.request.filters.push({ op, field, value: copy(value) }); return this;
  }
  eq(field, value) { return this.filter('eq', field, value); }
  neq(field, value) { return this.filter('neq', field, value); }
  gt(field, value) { return this.filter('gt', field, value); }
  gte(field, value) { return this.filter('gte', field, value); }
  lt(field, value) { return this.filter('lt', field, value); }
  lte(field, value) { return this.filter('lte', field, value); }
  in(field, values) { if (!Array.isArray(values)) throw errorFrom('Sorgu değerleri liste olmalıdır.', 'invalid_filter'); return this.filter('in', field, values); }
  is(field, value) { return this.filter('is', field, value); }
  not(field, operator, value) { return this.filter('not', field, { op: operator, value }); }
  or(expression) {
    this.mutable(); this.request.filters.push({ op: 'or', field: '', value: String(expression) }); return this;
  }
  order(field, options = {}) {
    this.mutable();
    if (typeof field !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/.test(field)) throw errorFrom('Sıralama alanı geçersiz.', 'invalid_field');
    this.request.order.push({ field, ascending: options.ascending !== false }); return this;
  }
  limit(value) { this.mutable(); if (!Number.isInteger(value) || value < 1 || value > 1000) throw errorFrom('Sayfa boyutu geçersiz.', 'invalid_limit'); this.request.limit = value; return this; }
  range(from, to) { this.mutable(); if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) throw errorFrom('Sayfa aralığı geçersiz.', 'invalid_range'); this.request.range = [from, to]; return this; }
  single() { this.mutable(); this.request.single = 'one'; return this; }
  maybeSingle() { this.mutable(); this.request.single = 'maybe'; return this; }
  execute() {
    if (!this.promise) {
      const request = copy(this.request);
      this.promise = companyRequest('query', request).then(payload => ({ data: payload.data ?? null, error: null, count: payload.count ?? null, status: 200 }))
        .catch(error => ({ data: null, error, count: null, status: error.status || 0 }));
    }
    return this.promise;
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  catch(reject) { return this.execute().catch(reject); }
  finally(callback) { return this.execute().finally(callback); }
}

const unsupported = async () => ({ data: null, error: errorFrom('Bu işlem güvenli çalışan giriş ekranından yönetilir.', 'unsupported_auth') });
const auth = {
  async getUser() {
    try { const data = await bootstrapCompany({ force: true }); return { data: { user: data.user }, error: null }; }
    catch (error) { return { data: { user: null }, error }; }
  },
  async getSession() {
    try { const data = await bootstrapCompany(); return { data: { session: { user: data.user } }, error: null }; }
    catch (error) { return { data: { session: null }, error }; }
  },
  onAuthStateChange(callback) {
    listeners.add(callback);
    queueMicrotask(() => { if (listeners.has(callback)) callback('INITIAL_SESSION', currentUser ? { user: getStaffIdentity() } : null); });
    return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } };
  },
  async signOut() {
    try {
      await privateStorage.flush();
      await bootstrapCompany();
      await transport('logout', {}, 'vg-staff/1', '/api/staff.php');
      clearStaffClientState();
      return { error: null };
    } catch (error) { return { error }; }
  },
  signInWithPassword: unsupported, signUp: unsupported, setSession: unsupported,
  updateUser: unsupported, resetPasswordForEmail: unsupported,
  mfa: { listFactors: unsupported, enroll: unsupported, unenroll: unsupported, challengeAndVerify: unsupported }
};

export const supabase = Object.freeze({
  from(table) { return new Query(table); },
  async rpc(name, args = {}) {
    try { const payload = await companyRequest('rpc', { name, args: copy(args) }); return { data: payload.data ?? null, error: null }; }
    catch (error) { return { data: null, error }; }
  },
  auth
});
// This is an alias, never a privileged client or credential.
export const adminSupabase = supabase;
