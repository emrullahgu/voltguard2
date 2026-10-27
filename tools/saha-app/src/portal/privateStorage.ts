import { bootstrapPortal, portalRpc, onPortalReset, reportPortalError,reportWriteFailure } from './api';
const values = new Map<string, string>();
const loaded = new Set<string>();
const sharedKeys = new Set<string>();
const revisions = new Map<string, number>();
let owner = '';
const LIMIT = 2 * 1024 * 1024;
const denied = /(?:auth|session|token|csrf|password|secret|api[_-]?key|currentUser|^role$)/i;
function keyOf(key: unknown) { if (typeof key !== 'string' || !key || key.length > 180 || denied.test(key)) throw reportPortalError(new Error('Kimlik bilgileri ve anahtarlar uygulama deposuna kaydedilemez.')); return key; }
export function clearPrivateMemory() { values.clear(); loaded.clear(); sharedKeys.clear(); revisions.clear(); owner = ''; }
onPortalReset(clearPrivateMemory);
async function ready() {
  const bootstrap = await bootstrapPortal();
  if (owner !== bootstrap.user.id) {
    clearPrivateMemory(); owner = bootstrap.user.id;
    for (const key of bootstrap.sharedCacheKeys || bootstrap.capabilities?.sharedCacheKeys || []) if (typeof key === 'string') sharedKeys.add(key);
    for (const [key, value] of Object.entries(bootstrap.cache || {})) if (!denied.test(key) && typeof value === 'string') { values.set(key, value); loaded.add(key); }
  }
}
async function readKey(key: string): Promise<string | null> {
  const result = await portalRpc('app_saha_cache', { operation: 'get', key });
  if (result?.shared === true) sharedKeys.add(key);
  if (sharedKeys.has(key)) {
    if (!Number.isSafeInteger(result?.revision) || result.revision < 0) throw reportPortalError(new Error('Ortak kaydın sürümü doğrulanamadı. Sayfayı yeniden açın.'));
    revisions.set(key, result.revision);
  }
  const value = typeof result?.value === 'string' ? result.value : null;
  loaded.add(key); if (value !== null) values.set(key, value); else values.delete(key);
  return value;
}
async function persist(operation: string, key?: string, value?: string) {
  await ready(); const expectedOwner = owner;
  let submitted = false;
  try {
    if (key && sharedKeys.has(key) && !revisions.has(key)) await readKey(key);
    submitted = true;
    const result = await portalRpc('app_saha_cache', { operation, key, value, ...(key && sharedKeys.has(key) ? { revision: revisions.get(key) } : {}) });
    if (owner !== expectedOwner) throw new Error('Çalışan oturumu değişti. İşlem yeniden doğrulanmalıdır.');
    if (key && sharedKeys.has(key)) {
      if (!Number.isSafeInteger(result?.revision) || result.revision < 0) throw new Error('Ortak kaydın yeni sürümü doğrulanamadı. Sayfayı yeniden açın.');
      revisions.set(key, result.revision);
    }
    return result;
  } catch (error: any) {
    // Failure status describes a completed attempt. No failed payload is queued.
    reportWriteFailure(error, submitted ? undefined : 'rejected');
    reportPortalError(error); throw error;
  }
}
const privateStorage = {
  async getItem(key: string): Promise<string | null> {
    key = keyOf(key); await ready();
    if (!sharedKeys.has(key) && loaded.has(key)) return values.get(key) ?? null;
    return readKey(key);
  },
  async setItem(key: string, value: string) {
    key = keyOf(key); if (typeof value !== 'string') throw new Error('Depolama değeri metin olmalıdır.'); await ready();
    const proposed = new Map([...values].filter(([existing]) => !sharedKeys.has(existing))); proposed.set(key, value);
    const bytes = new TextEncoder().encode(sharedKeys.has(key) ? value : [...proposed.values()].join('')).length;
    if (bytes > LIMIT) throw reportPortalError(new Error('Çalışan uygulama deposunun 2 MB sınırı aşıldı. Kayıt tamamlanmadı.'));
    await persist('set', key, value); values.set(key, value); loaded.add(key);
  },
  async removeItem(key: string) { key = keyOf(key); await persist('remove', key); values.delete(key); loaded.add(key); },
  async clear() { await persist('clear'); for (const key of [...values.keys()]) if (!sharedKeys.has(key)) { values.delete(key); loaded.delete(key); } },
  async getAllKeys(): Promise<string[]> { await ready(); const result = await portalRpc('app_saha_cache', { operation: 'keys' }); return (result?.keys || []).filter((key: string) => !denied.test(key)); },
  async multiGet(keys: string[]) { return Promise.all(keys.map(async key => [key, await privateStorage.getItem(key)])); },
  async multiSet(entries: [string, string][]) { for (const [key, value] of entries) await privateStorage.setItem(key, value); },
  async multiRemove(keys: string[]) { for (const key of keys) await privateStorage.removeItem(key); },
  async mergeItem(key: string, value: string) { const old = await privateStorage.getItem(key); await privateStorage.setItem(key, JSON.stringify({ ...(old ? JSON.parse(old) : {}), ...JSON.parse(value) })); },
  async flushGetRequests() {},
};
export default privateStorage;
