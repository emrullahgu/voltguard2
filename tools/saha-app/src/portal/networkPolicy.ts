import { reportPortalError } from './api';
const allowed = ['/api/company.php','/api/staff.php','/api/saha-asset.php','/api/company-asset.php'];
export function installNetworkPolicy() {
  const safe = (input: any) => {
    const raw = typeof input === 'string' ? input : input?.url || String(input);
    const url = new URL(raw, window.location.origin);
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    if (url.origin !== window.location.origin || (!allowed.includes(url.pathname) && !url.pathname.startsWith('/calisan/uygulama/assets/saha/'))) {
      throw reportPortalError(new Error('Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İstek gönderilmedi.'));
    }
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: any, init?: any) => { try { safe(input); return originalFetch(input,{...init,credentials:'same-origin'}); } catch(error) { return Promise.reject(error); } }) as any;
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(this: XMLHttpRequest,method: string,url: string,...args: any[]) { safe(url); return originalOpen.call(this,method,url,...args as [any]); } as any;
  if (window.WebSocket) window.WebSocket = class { constructor() { throw reportPortalError(new Error('Canlı bağlantı yalnız şirket API üzerinden kullanılabilir.')); } } as any;
  window.addEventListener('unhandledrejection',event=>{ reportPortalError(event.reason); });
}
