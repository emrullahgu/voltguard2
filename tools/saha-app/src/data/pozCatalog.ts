// Poz Katalog — SahaTakipHızlı Teklif Kalemleri (hizli_teklif_kalemleri.csv kaynaklı)
// Her kalem: malzeme birim fiyatı + montaj işçilik + demontaj (opsiyonel) + genel gider% + kâr%

export type PozCategory = 'Malzeme' | 'İşçilik' | 'Servis' | 'Mühendislik' | 'Ulaşım' | 'Diğer';

export interface PozItem {
  id: string;              // Poz No (örn: KE-0089-01)
  name: string;            // İş tanımı / kalem adı
  description?: string;    // Detaylı açıklama
  category: PozCategory;
  unit: string;            // Adet, Mt, m², Kg, Saat
  materialPrice: number;   // Malzeme birim fiyatı (KDV hariç)
  installPrice: number;    // Montaj/işçilik birim fiyatı
  dismantlePrice?: number; // Demontaj birim fiyatı (opsiyonel)
  vatRate: number;         // KDV %
  defaultOverhead: number; // Varsayılan genel gider %
  defaultProfit: number;   // Varsayılan kâr %
}

// Kategori varsayılan oranları
export const DEFAULT_OVERHEAD = 10; // %10 genel gider
export const DEFAULT_PROFIT = 15;   // %15 kâr
export const DEFAULT_VAT = 20;      // %20 KDV


export const POZ_CATALOG: PozItem[]=[];
export const POZ_CATEGORIES: PozCategory[]=['Malzeme','İşçilik','Servis','Mühendislik','Ulaşım','Diğer'];
export const findPoz=(id:string)=>POZ_CATALOG.find(p=>p.id===id);
export const pozByCategory=(category:PozCategory)=>POZ_CATALOG.filter(p=>p.category===category);
