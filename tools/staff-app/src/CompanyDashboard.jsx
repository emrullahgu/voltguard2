import React from 'react';
import { dashboardSummary } from './dashboardSummary.mjs';

const money = value => value.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
const provided = value => typeof value === 'string' && value.trim() ? value : 'Belirtilmedi';
const Card = ({ title, children }) => <section className="bg-white rounded-xl shadow-lg p-6"><h2 className="text-xl font-bold text-gray-800 mb-4">{title}</h2>{children}</section>;
const Empty = ({ children }) => <p className="text-sm text-gray-600">{children}</p>;
function Prices({ title, rows }) {
  return <Card title={title}>{rows.length ? <ol className="space-y-2 max-h-96 overflow-y-auto">{rows.map((row, index) => <li key={row.kaynak + '-' + index} className="flex items-center justify-between gap-3 p-2 bg-gray-50 rounded">
    <div className="flex-1"><p className="text-sm font-semibold text-gray-800">{row.urun || 'Ürün adı belirtilmedi'}</p><p className="text-xs text-gray-500">{row.marka} · {row.kaynak}</p></div>
    <span className="text-sm font-bold text-gray-800">{money(row.birimFiyat)}</span>
  </li>)}</ol> : <Empty>Karşılaştırılabilecek geçerli birim fiyatı yok.</Empty>}</Card>;
}

export default function CompanyDashboard({ invoice1, invoice2, cable, stats, products, onSelect }) {
  const summary = dashboardSummary(invoice1, invoice2, cable);
  const categories = stats.kategoriSayilari.filter(category => category.adet > 0);
  return <div className="space-y-6" data-company-dashboard="">
    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-xl shadow-lg p-8 text-white">
      <h1 className="text-3xl font-bold mb-2">VoltGuard Ürün ve Fiyat Veritabanı</h1>
      <p className="text-indigo-100">Yüklenen geçmiş fatura ürünleri ve birim fiyatlarının analizi. Güncel katalog veya güncel satış fiyatı değildir.</p>
    </div>
    {!stats.toplamUrun && <section className="bg-blue-50 border border-blue-200 rounded-xl p-6" role="status">
      <h2 className="text-lg font-bold text-gray-800 mb-2">Henüz geçmiş fatura verisi yüklenmedi</h2>
      <p className="text-sm text-gray-700 mb-4">Fatura verileri eklendiğinde ürün, marka ve fiyat analizleri burada görünür. Şimdi müşteri bilgileriyle teklif hazırlayabilir veya keşfe kendi ürünlerinizi ekleyebilirsiniz.</p>
      <div className="flex flex-wrap gap-3"><button type="button" className="bg-blue-600 text-white px-4 py-2 rounded font-semibold" onClick={() => onSelect('manual')}>YG teklifi hazırla</button><button type="button" className="border border-gray-300 bg-white px-4 py-2 rounded font-semibold" onClick={() => onSelect('kesif')}>Keşif ve metrajı aç</button></div>
    </section>}
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      {[['Toplam Ürün', stats.toplamUrun], ['Farklı Marka', stats.markalar.length], ['Kablo Kategorisi', cable.kategoriler.length], ['Geçmiş fatura ort. birim fiyatı', summary.averagePrice === null ? '—' : money(summary.averagePrice)], ['Veri Kaynağı', `${summary.sources} Fatura`]].map(([label, value]) => <div key={label} className="bg-white rounded-lg shadow-lg p-6"><p className="text-gray-600 text-sm font-semibold">{label}</p><p className="text-xl font-bold text-gray-800 mt-2">{value}</p>{label === 'Veri Kaynağı' && <p className="text-xs text-gray-600 mt-2">Fatura1: {invoice1.length} · Fatura2: {invoice2.length}</p>}</div>)}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card title="Kategori Dağılımı">{categories.length ? <ul className="space-y-3">{categories.map(({ ad, adet }) => <li key={ad} className="flex items-center justify-between gap-3"><span className="text-sm text-gray-700">{ad}</span><span className="text-sm font-bold text-gray-800">{adet} ürün</span></li>)}</ul> : <Empty>Henüz sınıflandırılabilecek fatura ürünü yok.</Empty>}</Card>
      <Card title="En Popüler Markalar">{stats.enPopulerMarkalar.length ? <ol className="space-y-3">{stats.enPopulerMarkalar.map(([brand, count]) => <li key={brand} className="flex items-center justify-between gap-3"><span className="text-sm text-gray-700">{brand}</span><span className="text-sm font-bold text-gray-800">{count} ürün</span></li>)}</ol> : <Empty>Henüz marka verisi yok.</Empty>}</Card>
      <Prices title="En Pahalı 10 Ürün" rows={summary.highest} />
      <Prices title="En Ekonomik 10 Ürün" rows={summary.lowest} />
    </div>
    <Card title="Kablo Fiyat Listesi Özeti">
      {cable.kategoriler.length ? <>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-purple-50 p-4 rounded-lg mb-4">{[['Firma', provided(cable.firma)], ['Telefon', provided(cable.telefon)], ['Web', provided(cable.web)], ['KDV', summary.vat]].map(([label, value]) => <div key={label}><dt className="text-gray-600">{label}</dt><dd className="font-bold text-gray-800 break-words">{value}</dd></div>)}</dl>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{cable.kategoriler.map(category => <div key={category.id} className="border border-purple-200 rounded-lg p-4"><h3 className="font-bold text-gray-800">{category.ad}</h3>{category.aciklama && <p className="text-xs text-gray-600 mb-3">{category.aciklama}</p>}<p className="text-sm text-gray-700">{Array.isArray(category.urunler) ? category.urunler.length : 0} çeşit kablo</p></div>)}</div>
      </> : <Empty>Henüz kablo fiyat listesi yüklenmedi. Katalog eklendiğinde kategori ve tedarikçi bilgileri burada görünür.</Empty>}
    </Card>
    {products.length > 0 && <Card title="Mevcut Keşif Projesindeki Ürün Analizi"><p className="text-sm text-gray-700">{products.length} kalem · {products.filter(row => row.type === 'normal').length} malzeme · {products.filter(row => row.type === 'kablo').length} kablo</p>{stats.enCokkullanılanlar.length > 0 && <ul className="space-y-2 mt-4">{stats.enCokkullanılanlar.map(([name, count]) => <li className="flex items-center justify-between gap-3 text-sm" key={name}><span>{name}</span><span>{count} kez kullanıldı</span></li>)}</ul>}</Card>}
  </div>;
}
