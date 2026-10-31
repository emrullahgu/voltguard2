import React from 'react';
import { dashboardSummary } from './dashboardSummary.mjs';
import { getStaffCapabilities } from './supabaseClient';
import { employeeSourceStatus } from './sourceConnection';

const money = value => value.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
const provided = value => typeof value === 'string' && value.trim() ? value : 'Belirtilmedi';
const Card = ({ title, children }) => <section className="company-dashboard__card rounded-xl shadow-lg p-6"><h2 className="company-dashboard__heading text-xl font-bold mb-4">{title}</h2>{children}</section>;
const Empty = ({ children }) => <p className="company-dashboard__muted text-sm">{children}</p>;
function Prices({ title, rows }) {
  return <Card title={title}>{rows.length ? <ol className="space-y-2 max-h-96 overflow-y-auto">{rows.map((row, index) => <li key={row.kaynak + '-' + index} className="company-dashboard__row flex items-center justify-between gap-3 p-2 rounded">
    <div className="flex-1"><p className="company-dashboard__text text-sm font-semibold">{row.urun || 'Ürün adı belirtilmedi'}</p><p className="company-dashboard__muted text-xs">{row.marka} · {row.kaynak}</p></div>
    <span className="company-dashboard__text text-sm font-bold">{money(row.birimFiyat)}</span>
  </li>)}</ol> : <Empty>Karşılaştırılabilecek geçerli birim fiyatı yok.</Empty>}</Card>;
}

export default function CompanyDashboard({ invoice1, invoice2, cable, stats, products, onSelect }) {
  const source = employeeSourceStatus(getStaffCapabilities().dataSource, typeof window === 'undefined' ? '' : window.location.hostname);
  if (!source.available) return <section className="portal-source-warning" role="alert" data-company-source-unavailable=""><h2>Şirket kayıtlarına erişim bekleniyor</h2><p>{source.message}</p></section>;
  const summary = dashboardSummary(invoice1, invoice2, cable);
  const categories = stats.kategoriSayilari.filter(category => category.adet > 0);
  return <div className="company-dashboard space-y-6" data-company-dashboard="">

    <div className="company-dashboard__hero rounded-xl shadow-lg p-8">
      <h1 className="text-3xl font-bold mb-2">VoltGuard Ürün ve Fiyat Veritabanı</h1>
      <p className="company-dashboard__hero-copy">Yüklenen geçmiş fatura ürünleri ve birim fiyatlarının analizi. Güncel katalog veya güncel satış fiyatı değildir.</p>
    </div>
    {!stats.toplamUrun && <section className="company-dashboard__notice rounded-xl p-6" role="status">
      <h2 className="company-dashboard__heading text-lg font-bold mb-2">Henüz geçmiş fatura verisi yüklenmedi</h2>
      <p className="company-dashboard__text text-sm mb-4">Fatura verileri eklendiğinde ürün, marka ve fiyat analizleri burada görünür. Şimdi müşteri bilgileriyle teklif hazırlayabilir veya keşfe kendi ürünlerinizi ekleyebilirsiniz.</p>
      <div className="flex flex-wrap gap-3"><button type="button" className="company-dashboard__primary px-4 py-2 rounded font-semibold" onClick={() => onSelect('manual')}>YG teklifi hazırla</button><button type="button" className="company-dashboard__secondary px-4 py-2 rounded font-semibold" onClick={() => onSelect('kesif')}>Keşif ve metrajı aç</button></div>
    </section>}
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      {[['Toplam Ürün', stats.toplamUrun], ['Farklı Marka', stats.markalar.length], ['Kablo Kategorisi', cable.kategoriler.length], ['Geçmiş fatura ort. birim fiyatı', summary.averagePrice === null ? '—' : money(summary.averagePrice)], ['Veri Kaynağı', `${summary.sources} Fatura`]].map(([label, value]) => <div key={label} className="company-dashboard__card rounded-lg shadow-lg p-6"><p className="company-dashboard__muted text-sm font-semibold">{label}</p><p className="company-dashboard__text text-xl font-bold mt-2">{value}</p>{label === 'Veri Kaynağı' && <p className="company-dashboard__muted text-xs mt-2">Fatura1: {invoice1.length} · Fatura2: {invoice2.length}</p>}</div>)}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card title="Kategori Dağılımı">{categories.length ? <ul className="space-y-3">{categories.map(({ ad, adet }) => <li key={ad} className="flex items-center justify-between gap-3"><span className="company-dashboard__text text-sm">{ad}</span><span className="company-dashboard__text text-sm font-bold">{adet} ürün</span></li>)}</ul> : <Empty>Henüz sınıflandırılabilecek fatura ürünü yok.</Empty>}</Card>
      <Card title="En Popüler Markalar">{stats.enPopulerMarkalar.length ? <ol className="space-y-3">{stats.enPopulerMarkalar.map(([brand, count]) => <li key={brand} className="flex items-center justify-between gap-3"><span className="company-dashboard__text text-sm">{brand}</span><span className="company-dashboard__text text-sm font-bold">{count} ürün</span></li>)}</ol> : <Empty>Henüz marka verisi yok.</Empty>}</Card>
      <Prices title="En Pahalı 10 Ürün" rows={summary.highest} />
      <Prices title="En Ekonomik 10 Ürün" rows={summary.lowest} />
    </div>
    <Card title="Kablo Fiyat Listesi Özeti">
      {cable.kategoriler.length ? <>
        <dl className="company-dashboard__inset grid grid-cols-2 md:grid-cols-4 gap-4 text-sm p-4 rounded-lg mb-4">{[['Firma', provided(cable.firma)], ['Telefon', provided(cable.telefon)], ['Web', provided(cable.web)], ['KDV', summary.vat]].map(([label, value]) => <div key={label}><dt className="company-dashboard__muted">{label}</dt><dd className="company-dashboard__text font-bold break-words">{value}</dd></div>)}</dl>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{cable.kategoriler.map(category => <div key={category.id} className="company-dashboard__category rounded-lg p-4"><h3 className="company-dashboard__heading font-bold">{category.ad}</h3>{category.aciklama && <p className="company-dashboard__muted text-xs mb-3">{category.aciklama}</p>}<p className="company-dashboard__text text-sm">{Array.isArray(category.urunler) ? category.urunler.length : 0} çeşit kablo</p></div>)}</div>
      </> : <Empty>Henüz kablo fiyat listesi yüklenmedi. Katalog eklendiğinde kategori ve tedarikçi bilgileri burada görünür.</Empty>}
    </Card>
    {products.length > 0 && <Card title="Mevcut Keşif Projesindeki Ürün Analizi"><p className="company-dashboard__text text-sm">{products.length} kalem · {products.filter(row => row.type === 'normal').length} malzeme · {products.filter(row => row.type === 'kablo').length} kablo</p>{stats.enCokkullanılanlar.length > 0 && <ul className="space-y-2 mt-4">{stats.enCokkullanılanlar.map(([name, count]) => <li className="flex items-center justify-between gap-3 text-sm" key={name}><span>{name}</span><span>{count} kez kullanıldı</span></li>)}</ul>}</Card>}
  </div>;
}
