import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './SimpleAuth';
import { getStaffCapabilities } from './supabaseClient';
import { EMPLOYEE_MODULES, initialEmployeeModule, employeeModuleURL } from './employeeModules';
export const PORTAL_HOME = '/calisan/uygulama/';
export const PORTAL_MODULES = EMPLOYEE_MODULES;
export function canManagePayroll(user) { return Boolean(user?.approved && ['admin', 'payroll'].includes(user.role)); }
export function initialPortalModule(user) { return initialEmployeeModule(user); }
export function portalModuleURL(module) { return employeeModuleURL(module); }
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
    <nav id="portal-account-links" aria-label="Şirket uygulaması bağlantıları" hidden={compact && !menuOpen}><a href="/calisan/">Çalışan paneli</a><a href="/araclar/">Hesap araçları</a>{currentUser?.role === 'admin' && <a href={portalModuleURL('admin')}>Çalışan yönetimi</a>}{onProfile ? <button type="button" data-portal-profile-trigger onClick={() => { setMenuOpen(false); onProfile(); }}>Profil ve güvenlik</button> : <a href={PORTAL_HOME+'?profil=1'}>Profil ve güvenlik</a>}<button type="button" data-vg-theme-toggle="" aria-label={document.documentElement.dataset.theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'} aria-pressed={document.documentElement.dataset.theme === 'dark'}><span data-vg-theme-text="">Renk teması</span></button><button type="button" disabled={signingOut} aria-busy={signingOut} onClick={leave}>{signingOut ? 'Çıkış yapılıyor…' : 'Çıkış yap'}</button></nav>
  </div>;
}
