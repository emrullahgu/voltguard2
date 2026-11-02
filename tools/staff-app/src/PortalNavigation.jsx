import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './SimpleAuth';
import { getStaffCapabilities } from './supabaseClient';
import { EMPLOYEE_MODULES, initialEmployeeModule, employeeModuleURL } from './employeeModules';
import { employeeSourceStatus } from './sourceConnection';
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
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const menuButton = useRef(null);
  const leaving = useRef(false);
  useEffect(() => {
    const update = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    document.addEventListener('vg:theme', update);
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    update();
    return () => { document.removeEventListener('vg:theme', update); observer?.disconnect(); };
  }, []);
  const themeFallback = event => {
    if (window.VGTheme) return; // The site shell handles its delegated toggle.
    event.stopPropagation();
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('vg-theme', next); } catch (_) { /* Keep the current page usable without storage. */ }
    document.dispatchEvent(new CustomEvent('vg:theme', { detail: { theme: next } }));
  };
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
  const capabilities = getStaffCapabilities();
  const source = employeeSourceStatus(capabilities.dataSource, window.location.hostname, capabilities.sahaSource);
  const role = { admin: 'Yönetici', payroll: 'Bordro yöneticisi', employee: 'Çalışan' }[currentUser?.role] || 'Çalışan';
  return <div className="portal-navigation no-print">
    <div className="portal-navigation__identity"><a href={PORTAL_HOME} className="portal-navigation__title">Şirket uygulaması</a><p><span>{currentUser?.name || currentUser?.email}</span><span className="portal-navigation__role">{role}</span></p><p className={source.available && !source.development ? 'portal-navigation__source' : 'portal-source-warning'} role={source.available ? 'status' : 'alert'}><strong>{source.label}</strong>{source.message && <>. {source.message}</>}</p></div>
    <div className="portal-navigation__controls"><button type="button" className="portal-theme-toggle" data-portal-theme-toggle="" data-vg-theme-toggle="" aria-label={theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'} aria-pressed={theme === 'dark'} onClick={themeFallback}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{theme === 'dark' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></> : <path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z"/>}</svg><span data-vg-theme-text="">{theme === 'dark' ? 'Açık tema' : 'Koyu tema'}</span></button>{compact && <button type="button" id="portal-account-toggle" ref={menuButton} className="portal-navigation__toggle" aria-controls="portal-account-links" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>Çalışan menüsü</button>}</div>
    <nav id="portal-account-links" aria-label="Şirket uygulaması bağlantıları" hidden={compact && !menuOpen}><a href="/calisan/">Çalışan paneli</a><a href="/araclar/">Hesap araçları</a>{currentUser?.role === 'admin' && <a href={portalModuleURL('admin')}>Çalışan yönetimi</a>}{onProfile ? <button type="button" data-portal-profile-trigger onClick={() => { setMenuOpen(false); onProfile(); }}>Profil ve güvenlik</button> : <a href={PORTAL_HOME+'?profil=1'}>Profil ve güvenlik</a>}<button type="button" disabled={signingOut} aria-busy={signingOut} onClick={leave}>{signingOut ? 'Çıkış yapılıyor…' : 'Çıkış yap'}</button></nav>
  </div>;
}
