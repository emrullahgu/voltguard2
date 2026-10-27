/* Native employee-session transport. No browser token or third-party SDK. */
import { scopedFetch } from './networkPolicy';
import { emitModuleEvent } from './moduleHostBridge';
export type PortalUser = { id: string; email?: string; user_metadata?: { full_name?: string }; app_metadata?: { role?: string } };
export type PortalBootstrap = { user: PortalUser; profile: any; capabilities: Record<string, any>; cache?: Record<string, string>; sharedCacheKeys?: string[] };
let csrf = '';
let identity: PortalBootstrap | null = null;
let booting: Promise<PortalBootstrap> | null = null;
const resetters = new Set<() => void>();
const nativeFetch = scopedFetch;
let pendingWrites=0;
let writeError='';
export type WriteFailureOutcome = 'rejected' | 'unknown';
let writeOutcome: WriteFailureOutcome | null = null;
// This is request status, not an offline queue. Failed payloads are never retained or replayed.
export function getWriteStatus(){return {pending:pendingWrites,error:writeError||null,outcome:writeOutcome};}
function publishWrites(){postParent('vg:saha-storage',getWriteStatus());}
export function getPendingWrites(){return pendingWrites;}
export function reportWriteFailure(error:any,outcome?:WriteFailureOutcome){
  if(error?.quietTelemetry===true)return;
  writeError=String(error?.message||error);
  const status=Number(error?.status);
  writeOutcome=outcome||error?.writeOutcome||(status>=400&&status<500&&status!==408?'rejected':'unknown');
  publishWrites();
}
export function clearWriteFailure(){
  if(pendingWrites>0)return false;
  writeError='';writeOutcome=null;publishWrites();return true;
}
export function postParent(type: string, fields: Record<string, any> = {}) {
  emitModuleEvent(type, fields);
}
export function reportPortalError(error: any) {
  if(error?.quietTelemetry===true)return error;
  const message = String(error?.message || error || 'İşlem tamamlanamadı.');
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('vg:saha-notice', { detail: message }));
  postParent('vg:saha-notice', { message });
  return error;
}
export function onPortalReset(callback: () => void) { resetters.add(callback); return () => { resetters.delete(callback); }; }
export function clearPortalMemory() {
  identity = null; csrf = ''; booting = null;
  writeError='';writeOutcome=null;publishWrites();
  for (const clear of resetters) clear();
}
export function currentPortalIdentity() { return identity; }
function loginRequired() {
  clearPortalMemory();
  if (typeof window !== 'undefined') window.top!.location.replace('/calisan/giris.html');
}
export async function transport(action: string, body?: unknown, endpoint = '/api/company.php', expected = 'vg-company/1', quietTelemetry = false): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) {
      if (!csrf) throw Object.assign(new Error('Çalışan oturumu doğrulanamadı. Sayfayı yeniden açın.'),{writeOutcome:'rejected'});
      headers['Content-Type'] = 'application/json'; headers['X-VG-STAFF-CSRF'] = csrf;
    }
    const response = await nativeFetch(`${endpoint}?action=${encodeURIComponent(action)}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    const payload = await response.json().catch(() => { throw new Error('Şirket sunucusu geçerli bir yanıt vermedi.'); });
    if (payload.api !== expected || typeof payload.ok !== 'boolean') throw new Error('Şirket API yanıtı doğrulanamadı.');
    if (typeof payload.csrf === 'string' && /^[a-f0-9]{64}$/.test(payload.csrf)) csrf = payload.csrf;
    if (!response.ok || !payload.ok) {
      const error: any = new Error(payload.message || 'Sunucu işlemi reddetti.');
      error.code = payload.error || 'server_error'; error.status = response.status;
      if (response.status === 401) loginRequired();
      throw error;
    }
    return payload.data;
  } catch (error: any) {
    if (error?.name === 'AbortError') error = Object.assign(new Error('Şirket sunucusu zamanında yanıt vermedi. İşlemin sonucu doğrulanamadı; yeniden göndermeden önce kayıt listesini kontrol edin.'),{writeOutcome:'unknown'});
    if(quietTelemetry)error=Object.assign(error instanceof Error?error:new Error(String(error?.message||error)),{quietTelemetry:true});
    else reportPortalError(error);
    throw error;
  } finally { clearTimeout(timer); }
}
export function bootstrapPortal(force = false): Promise<PortalBootstrap> {
  if (booting) return booting;
  if (identity && !force) return Promise.resolve(identity);
  booting = (async () => {
    const data = await transport('saha_bootstrap');
    if (!csrf || !data?.user?.id || data.profile?.id !== data.user.id || data.profile?.approval_status !== 'approved') {
      loginRequired(); throw new Error('Saha çalışan profili doğrulanamadı.');
    }
    if (identity && identity.user.id !== data.user.id) for (const clear of resetters) clear();
    identity = data; return data;
  })().catch((error) => { if (error?.status === 403) loginRequired(); throw error; }).finally(() => { booting = null; });
  return booting;
}
export async function portalRpc<T = any>(name: string, args: Record<string, any> = {}): Promise<T> {
  const telemetry=(name==='app_saha_cache'&&args.key==='app_usage_buffer_v1'&&['get','set'].includes(args.operation))||(name==='app_saha_rpc'&&args.name==='bump_app_usage');
  const readOnlyRpc=name==='app_saha_rpc'&&args.name==='visit_active';
  const mutation=!telemetry&&!readOnlyRpc&&((name==='app_saha_query'&&args.operation!=='select')||(name==='app_saha_cache'&&['set','remove','clear'].includes(args.operation))||(name==='app_saha_storage'&&['upload','remove'].includes(args.operation))||['app_saha_rpc','app_saha_function'].includes(name));
  if(mutation){pendingWrites++;publishWrites();}
  try {await bootstrapPortal();return await transport('rpc', { name, args },'/api/company.php','vg-company/1',telemetry);}
  catch(error){if(mutation)reportWriteFailure(error);throw error;}
  finally{if(mutation){pendingWrites--;publishWrites();}}
}
export async function logoutPortal() {
  if(pendingWrites>0)throw reportPortalError(new Error('Sunucuya yazılan işlemler tamamlanana kadar oturum kapatılamaz.'));
  await bootstrapPortal();
  await transport('logout', {}, '/api/staff.php', 'vg-staff/1');
  clearPortalMemory();
  if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('vg-staff-auth'); channel.postMessage({ type: 'SIGNED_OUT' }); channel.close(); }
  if (typeof window !== 'undefined') window.top!.location.replace('/calisan/giris.html');
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload',event=>{if(pendingWrites>0){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide', clearPortalMemory);
  window.addEventListener('message', (event) => {
    if(event.origin!==window.location.origin)return;
    if(event.data?.type==='vg:staff-signout')clearPortalMemory();
    if(event.source===window.parent&&event.data?.type==='vg:saha-clear-write-notice')clearWriteFailure();
  });
  if (typeof BroadcastChannel !== 'undefined') {
    const authChannel = new BroadcastChannel('vg-staff-auth');
    authChannel.onmessage = (event) => { if (['SIGNED_OUT', 'logout', 'vg:staff-signout'].includes(event.data?.type)) loginRequired(); };
  }
}
