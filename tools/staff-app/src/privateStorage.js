/* Browser memory only. Durable values belong to the authenticated employee's private server store. */
const entries = new Map();
const dirty = new Map();
const failures = new Map();
let queue = Promise.resolve();
let owner = null;
let generation = 0;
let serial = 0;
let persist = null;
let identity = () => null;

function emit(name, detail) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
function keyName(key) {
  const value = String(key);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error('Özel kayıt anahtarı geçersiz.');
  return value;
}
function readOnlyKey(key) {
  return key === 'currentUser' || /(?:auth|session|token|csrf)/i.test(key) || key === 'role';
}
function storageStatus() {
  return { pending: dirty.size, error: failures.size ? [...failures.values()][0].message : null };
}
function changed() { emit('vg:private-storage-status', storageStatus()); }

export function configurePrivateStorage(configuration) {
  persist = configuration.persist;
  identity = configuration.identity;
}

export function resetPrivateStorage() {
  generation++;
  owner = null;
  entries.clear(); dirty.clear(); failures.clear();
  queue = Promise.resolve();
  changed();
}

export function hydratePrivateStorage(values, userId) {
  if (!userId) { resetPrivateStorage(); return; }
  if (owner !== userId) {
    resetPrivateStorage();
    owner = userId;
  }
  const pending = new Map([...dirty].map(([key]) => [key, entries.has(key) ? entries.get(key) : null]));
  entries.clear();
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    for (const [key, value] of Object.entries(values)) {
      if (/^[A-Za-z0-9_-]{1,100}$/.test(key) && !readOnlyKey(key) && typeof value === 'string') entries.set(key, value);
    }
  }
  for (const [key, value] of pending) if (value === null) entries.delete(key); else entries.set(key, value);
  changed();
}

function enqueue(key, value) {
  const user = identity();
  if (!user || user.id !== owner || typeof persist !== 'function') throw new Error('Özel kayıt için çalışan oturumu doğrulanmalıdır.');
  const expectedOwner = owner, expectedGeneration = generation, revision = ++serial;
  dirty.set(key, revision);
  changed();
  const job = queue.catch(() => {}).then(async () => {
    if (expectedGeneration !== generation) return;
    if (identity()?.id !== expectedOwner) throw new Error('Çalışan oturumu değişti. Kayıt yeniden doğrulanmalıdır.');
    await persist(key, value, expectedOwner);
    if (expectedGeneration === generation && dirty.get(key) === revision) {
      dirty.delete(key); failures.delete(key);
    }
    changed();
  }).catch(error => {
    if (expectedGeneration !== generation) return;
    if (dirty.get(key) === revision) failures.set(key, error);
    emit('vg:private-storage-error', { message: error.message || 'Özel kayıt sunucuya yazılamadı.' });
    changed();
    throw error;
  });
  queue = job;
  // Storage-compatible synchronous callers can ignore the promise; the UI still receives a visible failure event.
  job.catch(() => {});
  return job;
}

export const privateStorage = Object.freeze({
  getItem(key) {
    const value = keyName(key);
    if (value === 'currentUser') return identity() ? JSON.stringify(identity()) : null;
    return entries.has(value) ? entries.get(value) : null;
  },
  setItem(key, value) {
    const name = keyName(key);
    if (readOnlyKey(name)) throw new Error('Oturum ve yetki bilgileri istemciden değiştirilemez.');
    const text = String(value);
    if (new TextEncoder().encode(JSON.stringify({ key: name, value: text })).length > 2097152) {
      throw new Error('Bu kayıt 2 MB sunucu sınırını aşıyor. Logo veya yedeğin boyutunu küçültün.');
    }
    if (!identity() || identity().id !== owner) throw new Error('Çalışan oturumu gerekiyor.');
    entries.set(name, text);
    return enqueue(name, text);
  },
  removeItem(key) {
    const name = keyName(key);
    if (readOnlyKey(name)) throw new Error('Oturum ve yetki bilgileri istemciden değiştirilemez.');
    if (!identity() || identity().id !== owner) throw new Error('Çalışan oturumu gerekiyor.');
    entries.delete(name);
    return enqueue(name, null);
  },
  clear() { return Promise.all([...entries.keys()].map(key => this.removeItem(key))); },
  key(index) { return [...entries.keys()][Number(index)] ?? null; },
  get length() { return entries.size; },
  get pending() { return dirty.size; },
  get error() { return storageStatus().error; },
  async flush() {
    await queue;
    if (dirty.size) throw [...failures.values()][0] || new Error('Özel kayıtlar henüz sunucuya yazılmadı.');
  },
  retry() { return Promise.all([...dirty.keys()].map(key => enqueue(key, entries.has(key) ? entries.get(key) : null))); }
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', event => {
    if (dirty.size) { event.preventDefault(); event.returnValue = ''; }
  });
}
export default privateStorage;
