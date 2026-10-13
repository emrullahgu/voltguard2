import React, { useState } from 'react';
import { AuthProvider, useAuth } from './SimpleAuth';
import PortalNavigation, { PORTAL_HOME } from './PortalNavigation';
import UserProfile from './UserProfile';
function Gate({ children, sadeceAdmin }) {
  const { currentUser, loading, isAuthenticated, authError, recheck } = useAuth(); const [profile, setProfile] = useState(false);
  if (loading) return <section className="portal-session" role="status">Şirket oturumu doğrulanıyor…</section>;
  if (!isAuthenticated) return <section className="portal-session"><h1>Çalışan girişi gerekiyor</h1><p role="alert">{authError || 'Devam etmek için şirket hesabınızla giriş yapın.'}</p><div className="portal-session__actions"><a href="/calisan/giris.html">Çalışan girişine dön</a><button type="button" onClick={recheck}>Yeniden kontrol et</button></div></section>;
  if (sadeceAdmin && currentUser?.role !== 'admin') return <section className="portal-session"><h1>Yönetici erişimi gerekiyor</h1><a href={PORTAL_HOME}>Şirket uygulamasına dön</a></section>;
  return <><PortalNavigation onProfile={() => setProfile(true)} />{authError && <p role="alert" className="portal-status">{authError} <button type="button" onClick={recheck}>Yeniden dene</button></p>}{profile && <UserProfile onClose={() => setProfile(false)} />}{children}</>;
}
export default function AuthGate({ children, sadeceAdmin = false }) { return <AuthProvider><Gate sadeceAdmin={sadeceAdmin}>{children}</Gate></AuthProvider>; }
