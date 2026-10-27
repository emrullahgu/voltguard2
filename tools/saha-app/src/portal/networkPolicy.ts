/* Pure source-local request policy. Never replace host fetch, XHR or WebSocket. */
const nativeFetch = globalThis.fetch.bind(globalThis);
const allowed = new Set(['/api/company.php', '/api/staff.php', '/api/saha-asset.php', '/api/company-asset.php']);
export function assertModuleRequest(input: any) {
  const raw = typeof input === 'string' ? input : input?.url || String(input);
  const url = new URL(raw, window.location.origin);
  if (url.protocol === 'blob:' || url.protocol === 'data:') return url;
  if (url.origin !== window.location.origin || (!allowed.has(url.pathname) && !url.pathname.startsWith('/calisan/uygulama/assets/saha/'))) throw new Error('Bu dış hizmet şirket sunucusunda yapılandırılmadı. İstek gönderilmedi.');
  return url;
}
export function scopedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try { assertModuleRequest(input); return nativeFetch(input, { ...init, credentials: 'same-origin' }); }
  catch (error) { return Promise.reject(error); }
}
export const ScopedXMLHttpRequest = function ModuleXMLHttpRequest() {
  const NativeRequest = globalThis.XMLHttpRequest;
  if (!NativeRequest) throw new Error('Bu ortamda dosya isteği desteklenmiyor.');
  const request = new NativeRequest(), open = request.open.bind(request);
  request.open = ((...args: any[]) => { assertModuleRequest(args[1]); return (open as any)(...args); }) as typeof request.open;
  return request;
} as unknown as typeof XMLHttpRequest;
export class ScopedWebSocket { constructor(..._args: any[]) { throw new Error('Canlı kayıtlar şirket API’sinden alınır. Harici bağlantı kurulmadı.'); } }
