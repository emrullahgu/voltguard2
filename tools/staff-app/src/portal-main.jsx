import React from 'react';
import {createRoot} from 'react-dom/client';
import {initializePortal} from './supabaseClient';
import {setCatalog} from './catalogData';
import './index.css';
import './site-theme.css';

const host = document.getElementById('vg-company-workspace');
const root = createRoot(host);
class PortalBoundary extends React.Component {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() {
    if (this.state.failed) return <section className="company-load-error" role="alert"><h1>Bu bölüm açılamadı.</h1><p>Kaydedilmiş şirket kayıtlarınız korunuyor. Sayfayı yenileyip tekrar deneyin.</p><button onClick={()=>location.reload()}>Yeniden yükle</button><a href="/calisan/">Çalışan ana sayfası</a></section>;
    return this.props.children;
  }
}
async function start() {
  try {
    const data = await initializePortal();
    setCatalog(data.catalog);
    const {default:Portal} = await import('./SimpleAppWithAuth');
    root.render(<PortalBoundary><Portal/></PortalBoundary>);
  } catch (error) {
    if (error.status === 401 || error.status === 403) { location.replace('/calisan/giris.html'); return; }
    root.render(<section className="company-load-error" role="alert"><h1>Çalışan portalına ulaşılamıyor.</h1><p>{error.message || 'Lütfen yeniden deneyin.'}</p><button onClick={()=>location.reload()}>Yeniden dene</button><a href="/calisan/giris.html">Çalışan girişine dön</a></section>);
  }
}
// Sensitive company data must be discarded before a browser memory-cache restore.
addEventListener('pagehide',()=>{ root.unmount(); host.replaceChildren(); setCatalog(); });
addEventListener('pageshow',event=>{ if(event.persisted) location.reload(); });
start();
