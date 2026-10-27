import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Search, Users, Briefcase, FileText, Package, CalendarDays, Gauge, Wallet, Settings } from 'lucide-react';
import { availableModules, MODULE_GROUPS } from './employeeModules';

const icons = { 'Teklifler': FileText, 'İş ve kayıtlar': Briefcase, 'Stok ve araçlar': Package, 'Enerji ve kontrol': Gauge, 'Ofis ve iletişim': CalendarDays, 'Personel ve bordro': Users, 'Finans ve raporlar': Wallet, 'Yönetim': Settings };
export default function EmployeeHome({ user, onSelect }) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('Tümü');
  const modules = useMemo(() => availableModules(user).filter(item => item.id !== 'uygulamalar' && !item.draftOnly), [user]);
  const groups = MODULE_GROUPS.filter(value => modules.some(item => item.group === value));
  const needle = search.trim().toLocaleLowerCase('tr-TR');
  const matches = modules.filter(item => (group === 'Tümü' || item.group === group) && (!needle || [item.label, item.description, ...(item.variants || []).map(variant => variant.label)].join(' ').toLocaleLowerCase('tr-TR').includes(needle)));
  return <section className="employee-home" aria-labelledby="employee-home-title" data-employee-applications="">
    <header className="employee-home__heading"><div><p className="employee-eyebrow">VoltGuard çalışma alanı</p><h1 id="employee-home-title">Çalışan uygulamaları</h1><p>Tekliften iş emrine, stoktan ekip planlamasına günlük çalışmalarınız.</p></div><span className="employee-home__count">{modules.length} modül</span></header>
    <label className="employee-module-search"><Search size={20} aria-hidden="true" /><span className="sr-only">Uygulamalarda ara</span><input type="search" placeholder="Müşteri, iş emri, stok, bakım…" value={search} onChange={event => setSearch(event.target.value)} /></label>
    <div className="employee-group-filters" aria-label="Uygulama kategorileri">{['Tümü', ...groups].map(value => <button type="button" key={value} aria-pressed={group === value} onClick={() => setGroup(value)}>{value}</button>)}</div>
    {!matches.length && <p role="status" className="employee-empty">Aramanızla eşleşen uygulama bulunamadı.</p>}
    {groups.filter(value => matches.some(item => item.group === value)).map(value => <section className="employee-module-category" key={value} aria-label={value}><h2>{value}</h2><div className="employee-module-grid">{matches.filter(item => item.group === value).map(item => { const Icon = icons[item.group] || Briefcase; return <button type="button" className="employee-module-card" key={item.id} onClick={() => onSelect(item.id)}><span className="employee-module-card__icon"><Icon size={23} /></span><span className="employee-module-card__body"><strong>{item.label}</strong><span>{item.description}</span></span><ArrowUpRight size={19} aria-hidden="true" /></button>; })}</div></section>)}
  </section>;
}
