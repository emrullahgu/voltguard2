import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './SimpleAuth';
import { getStaffCapabilities } from './supabaseClient';
export const PORTAL_HOME = '/calisan/uygulama/';
export const PORTAL_MODULES = [
  { id: 'dashboard', label: 'Ürün ve fiyat analizi', group: 'Teklifler' },
  { id: 'manual', label: 'YG işletme sorumluluğu teklifi', group: 'Teklifler' },
  { id: 'periodic', label: 'Periyodik kontrol teklifi', group: 'Teklifler' },
  { id: 'kesif', label: 'Keşif ve metraj', group: 'Teklifler' },
  { id: 'ges', label: 'GES teklifi', group: 'Teklifler' },
  { id: 'saved', label: 'Kaydedilen teklifler', group: 'Teklifler' },
  { id: 'proposal', label: 'Teklif önizleme', group: 'Teklifler', draftOnly: true },
  { id: 'saha-takip', label: 'SahaTakip', group: 'İş ve kayıtlar' },
  { id: 'gorev', label: 'Görev takibi', group: 'İş ve kayıtlar' },
  { id: 'is-takip', label: 'İş takibi', group: 'İş ve kayıtlar' },
  { id: 'urun-takip', label: 'Ürün takibi', group: 'İş ve kayıtlar' },
  { id: 'akaryakit', label: 'Akaryakıt takibi', group: 'İş ve kayıtlar' },
  { id: 'kontrol', label: 'Periyodik kontrol raporları', group: 'Enerji ve kontrol' },
  { id: 'osos', label: 'OSOS ve ölçüm kayıtları', group: 'Enerji ve kontrol' },
  { id: 'haftalik-raporlama', label: 'Haftalık enerji raporları', group: 'Enerji ve kontrol' },
  { id: 'bordro', label: 'Personel bordrosu', group: 'Bordro' },
  { id: 'beyaz-yaka', label: 'Beyaz yaka bordrosu', group: 'Bordro' },
  { id: 'admin', label: 'Çalışan yönetimi', group: 'Yönetim', adminOnly: true }
];
export function canManagePayroll(user) { return Boolean(user?.approved && ['admin', 'payroll'].includes(user.role)); }
export function initialPortalModule(user) {
  const requested = new URLSearchParams(window.location.search).get('module');
  return PORTAL_MODULES.some(item => item.id === requested && !item.draftOnly && (!item.adminOnly || user?.role === 'admin')) ? requested : 'dashboard';
}
export function portalModuleURL(module) { return PORTAL_HOME + '?module=' + encodeURIComponent(module); }
export default function PortalNavigation({ onProfile }) {
  const { currentUser, signOut } = useAuth();
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuButton = useRef(null);
  const leaving = useRef(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = event => { setCompact(event.matches); setMenuOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!compact || !menuOpen) return;
    const close = event => {
      if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [compact, menuOpen]);
  const leave = async () => {
    if (leaving.current) return;
    leaving.current = true; setSigningOut(true);
    try { await signOut(); }
    catch (_) { /* AuthProvider displays the failure; keep the workspace open for retry. */ }
    finally { leaving.current = false; setSigningOut(false); }
  };
  const source = getStaffCapabilities().dataSource;
  const role = { admin: 'Yönetici', payroll: 'Bordro yöneticisi', employee: 'Çalışan' }[currentUser?.role] || 'Çalışan';
  return <div className="portal-navigation no-print">
    <div className="portal-navigation__identity"><a href={PORTAL_HOME} className="portal-navigation__title">Şirket uygulaması</a><p><span>{currentUser?.name || currentUser?.email}</span><span className="portal-navigation__role">{role}</span></p>{source === 'ubuntu' && <p className="portal-navigation__source">Kayıtlar: şirket sunucusu</p>}</div>
    {compact && <button type="button" id="portal-account-toggle" ref={menuButton} className="portal-navigation__toggle" aria-controls="portal-account-links" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>Çalışan menüsü</button>}
    <nav id="portal-account-links" aria-label="Şirket uygulaması bağlantıları" hidden={compact && !menuOpen}><a href="/calisan/">Çalışan paneli</a><a href="/araclar/">Hesap araçları</a>{currentUser?.role === 'admin' && <a href={portalModuleURL('admin')}>Çalışan yönetimi</a>}{onProfile ? <button type="button" data-portal-profile-trigger onClick={() => { setMenuOpen(false); onProfile(); }}>Profil ve güvenlik</button> : <a href={PORTAL_HOME+'?profil=1'}>Profil ve güvenlik</a>}<button type="button" disabled={signingOut} aria-busy={signingOut} onClick={leave}>{signingOut ? 'Çıkış yapılıyor…' : 'Çıkış yap'}</button></nav>
  </div>;
}
