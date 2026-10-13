import {parseDecimal} from './operations.mjs';
function field(row,keys){for(const key of keys)if(row[key]!==undefined && row[key]!==null)return row[key];return null;}
// Keep the original descriptions; several supplied spreadsheet headers were already damaged.
export function normalizeHistoricalInvoice(rows,source){
 if(!Array.isArray(rows))throw Error('Fatura veri listesi geçersiz.');
 return rows.map(row=>{
  const first=source==='Fatura1',name=field(row,first?['ÜRÜN','Ürün','ıRıN']:['Ürün/hizmet','ürün/hizmet','?r?n/hizmet','Ürün/hizmet açıklaması','ürün/hizmet açıklaması','?r?n/hizmet a??klamas?']);
  const price=parseDecimal(field(row,first?['BİRİM FİYAT','Birim fiyatı','BıRıM FıYAT']:['Birim fiyatı','Birim fiyat?']),null),netPrice=parseDecimal(field(row,['İSKONTOLU BİRİM FİYAT','ıSKONTOLU BıRıM FıYAT']),null),date=field(row,['TARİH','TARıH','Tarih']);
  return {urun:String(name ?? '').trim(),marka:String(field(row,['MARKA','Marka']) || 'Belirtilmedi'),birimFiyat:price,netBirimFiyat:netPrice,miktar:parseDecimal(field(row,['MİKTAR','MıKTAR','Miktar']),null),olcu:String(field(row,['ÖLÇÜ','ıLıı','Birim']) || ''),aciklama:String(field(row,['Ürün/hizmet açıklaması','ürün/hizmet açıklaması','?r?n/hizmet a??klamas?']) || ''),kdvOrani:parseDecimal(field(row,['KDV oranı','KDV oran?']),null),kaynak:source,tarih:date,priceStatus:'Geçmiş fatura birim fiyatı'+(date?' · '+date:'')+'; güncel fiyatı doğrulayın'};
 });
}
