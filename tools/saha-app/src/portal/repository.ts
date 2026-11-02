import { supabase } from './nativeClient';
import { onPortalReset, reportPortalError } from './api';
/* No offline business writes. Reads and commits require the employee server. */
export const isOnlineMode = () => true;
export const isWriteQueued = (_id?: string) => false;
export const isUuid = (id: string) => typeof id === 'string' && /^[A-Za-z0-9_:.-]{1,128}$/.test(id);
export function newUuid() { return globalThis.crypto.randomUUID(); }
export function cleanupNetworkChecking() {}
export function setRuntimeOnline(_value: boolean) {}
export function getRuntimeOnline() { return navigator.onLine !== false; }
const memory = new Map<string, any>(); onPortalReset(() => memory.clear());
export async function cacheGet<T>(key: string): Promise<T|null> { return memory.has(key) ? memory.get(key) : null; }
export async function cacheSet<T>(key: string, value: T) { memory.set(key, value); }
export async function cacheClear(key: string) { memory.delete(key); }
export interface Repository<T> { list(): Promise<T[]>; insert(item:T): Promise<T>; update(id:string,item:T): Promise<T>; delete(id:string): Promise<void>; }
export async function enqueueSync(_op: any): Promise<never> { throw reportPortalError(new Error('Çevrimdışı işlem kaydedilmedi. Sunucu bağlantısını kontrol edin.')); }
export async function getSyncQueue(): Promise<any[]> { return []; }
export async function clearSyncOp(_id: string) {}
export async function clearSyncQueue() {}
export { supabase };
