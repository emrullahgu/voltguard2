import React from 'react';
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
  { id: 'gorev', label: 'Görev takibi', group: 'İş ve kayıtlar' },
  { id: 'is-takip', label: 'İş takibi', group: 'İş ve kayıtlar' },
  { id: 'urun-takip', label: 'Ürün takibi', group: 'İş ve kayıtlar' },
  { id: 'akaryakit', label: 'Akaryakıt takibi', group: 'İş ve kayıtlar' },
  { id: 'kontrol', label: 'Periyodik kontrol raporları', group: 'Enerji ve kontrol' },
  { id: 'osos', label: 'OSOS ve canlı izleme', group: 'Enerji ve kontrol' },
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
  const source = getStaffCapabilities().dataSource;
  const role = { admin: 'Yönetici', payroll: 'Bordro yöneticisi', employee: 'Çalışan' }[currentUser?.role] || 'Çalışan';
  return <div className="portal-navigation no-print">
    <div className="portal-navigation__identity"><a href={PORTAL_HOME} className="portal-navigation__title">Şirket uygulaması</a><p><span>{currentUser?.name || currentUser?.email}</span><span className="portal-navigation__role">{role}</span></p>{source === 'ubuntu' && <p className="portal-navigation__source">Kayıtlar: Ubuntu sunucusu</p>}</div>
    <nav aria-label="Şirket uygulaması bağlantıları"><a href="/calisan/">Çalışan paneli</a><a href="/araclar/">Hesap araçları</a>{currentUser?.role === 'admin' && <a href={portalModuleURL('admin')}>Çalışan yönetimi</a>}{onProfile ? <button type="button" onClick={onProfile}>Profil ve güvenlik</button> : <a href={PORTAL_HOME+'?profil=1'}>Profil ve güvenlik</a>}<button type="button" onClick={signOut}>Çıkış yap</button></nav>
  </div>;
}
