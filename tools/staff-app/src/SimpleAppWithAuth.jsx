import React, { useEffect, useState } from 'react';
import { privateStorage } from './privateStorage';
import { AuthProvider, useAuth } from './SimpleAuth';
import App from './App';
import UserProfile from './UserProfile';
import PortalNavigation from './PortalNavigation';
import SunucuDurumu from './SunucuDurumu';
export function PortalStatus() {
  const { authError, recheck } = useAuth();
  const [storage, setStorage] = useState(() => ({ pending:privateStorage.pending, error:privateStorage.error }));
  useEffect(() => { const changed = event => setStorage(event.detail); window.addEventListener('vg:private-storage-status', changed); return () => window.removeEventListener('vg:private-storage-status', changed); }, []);
  return <>{authError && <div role="alert" className="portal-status no-print">{authError} <button type="button" onClick={recheck}>Bağlantıyı yeniden kontrol et</button></div>}{storage.error ? <div role="alert" className="portal-status no-print">Özel kayıtlarınız henüz şirket sunucusuna yazılamadı. Bu sayfayı kapatmayın. {storage.error} <button type="button" onClick={() => privateStorage.retry().catch(() => {})}>Kaydı yeniden dene</button></div> : storage.pending > 0 ? <div role="status" className="portal-status no-print">Özel kayıtlarınız şirket sunucusuna kaydediliyor…</div> : null}</>;
}
export function PortalSessionNotice() {
  const { loading, authError, recheck } = useAuth();
  return <section className="portal-session" aria-labelledby="portal-session-title"><h1 id="portal-session-title">{loading ? 'Şirket oturumu doğrulanıyor' : 'Şirket oturumu gerekiyor'}</h1><p role={loading ? 'status' : 'alert'}>{loading ? 'Uygulama hazırlanıyor…' : authError || 'Devam etmek için çalışan girişini kullanın.'}</p>{!loading && <div className="portal-session__actions"><a href="/calisan/giris.html">Çalışan girişine dön</a><button type="button" onClick={recheck}>Yeniden dene</button></div>}</section>;
}
function Wrapper() { const { loading, isAuthenticated } = useAuth(); const [profile, setProfile] = useState(() => new URLSearchParams(window.location.search).get('profil') === '1'); if (loading || !isAuthenticated) return <PortalSessionNotice />; return <><PortalNavigation onProfile={() => setProfile(true)} /><PortalStatus />{profile && <UserProfile onClose={() => setProfile(false)} />}<App /><SunucuDurumu /></>; }
export default function SimpleAppWithAuth() { return <AuthProvider><Wrapper /></AuthProvider>; }
