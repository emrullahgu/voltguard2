import { parseDecimal } from './operations.mjs';

export function dashboardSummary(invoice1 = [], invoice2 = [], cable = {}) {
  const sources = [invoice1, invoice2].filter(rows => rows.length > 0).length;
  const priced = [...invoice1, ...invoice2].filter(row => Number.isFinite(row.birimFiyat) && row.birimFiyat > 0);
  const rate = parseDecimal(cable.kdvOrani, null);
  return {
    sources,
    pricedCount: priced.length,
    averagePrice: priced.length ? priced.reduce((sum, row) => sum + row.birimFiyat, 0) / priced.length : null,
    highest: [...priced].sort((a, b) => b.birimFiyat - a.birimFiyat).slice(0, 10),
    lowest: [...priced].sort((a, b) => a.birimFiyat - b.birimFiyat).slice(0, 10),
    vat: cable.kdvDahil === true ? 'Dahil' : cable.kdvDahil === false && rate !== null && rate >= 0 && rate <= 100 ? `Hariç (%${rate.toLocaleString('tr-TR')})` : 'Belirtilmedi'
  };
}
