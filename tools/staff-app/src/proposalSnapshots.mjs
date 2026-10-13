import { parseDecimal, roundMoney } from './operations.mjs';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function newDraftReference() { return 'TASLAK-'+globalThis.crypto.randomUUID().toUpperCase(); }
export function cloneProposal(value) { return JSON.parse(JSON.stringify(value)); }
export function normalizeProposal(type, raw, sanitizeHTML = value => value) {
 if (!['yg','periodic','kesif','ges'].includes(type) || !isRecord(raw)) throw Error('Teklif kaydı veya türü geçersiz.');
 const data = cloneProposal(raw);
 const fields = { yg:['form','params'], periodic:['customer','inputs','results'], kesif:['customer','settings'], ges:['form'] }[type];
 for (const field of fields) if (!isRecord(data[field])) throw Error('Teklif kaydında '+field+' bilgisi eksik veya geçersiz.');
 if (type === 'kesif' && !Array.isArray(data.products) || type === 'ges' && !Array.isArray(data.items)) throw Error('Teklif kalemleri geçersiz.');
 if (data.reportHtml !== undefined) { if (typeof data.reportHtml !== 'string') throw Error('Teklif düzenlemesi geçersiz.'); data.reportHtml = sanitizeHTML(data.reportHtml); }
 if (type==='kesif' && data.componentSnapshot!==undefined) {if(!isRecord(data.componentSnapshot))throw Error('Keşif form kaydı geçersiz.');if(data.componentSnapshot.reportHtml!==undefined){if(typeof data.componentSnapshot.reportHtml!=='string')throw Error('Keşif düzenlemesi geçersiz.');data.componentSnapshot.reportHtml=sanitizeHTML(data.componentSnapshot.reportHtml);}}
 const metadata=isRecord(data.metadata)?data.metadata:{};data.metadata={...metadata,schemaVersion:1,currency:['TRY','USD','EUR'].includes(metadata.currency)?metadata.currency:'TRY'};
 return data;
}
function parsePower(value) {
 const values=String(value ?? '').split('+').map(part=>parseDecimal(part,null));
 if (!values.length || values.some(part=>part===null || part<=0)) throw Error('Trafo gücünü pozitif kVA değerleriyle girin (örneğin 400+630).');
 return values.reduce((sum,part)=>sum+part,0);
}

export function calculatePeriodicQuote(raw, prices) {
 if(!isRecord(raw)||!isRecord(prices))throw Error('Periyodik kontrol girdileri geçersiz.');
 const inputs={};for(const key of ['trafoGucu','yapiAlani','topraklamaAdet','paratonerAdet','rcdAdet','İskonto']){inputs[key]=parseDecimal(raw[key],null);if(inputs[key]===null || inputs[key]<0)throw Error('Kontrol miktarları sıfır veya pozitif sayı olmalı.');}
 for(const key of ['topraklamaAdet','paratonerAdet','rcdAdet'])if(!Number.isInteger(inputs[key]))throw Error('Adet alanları tam sayı olmalı.');
 if(inputs.İskonto>100)throw Error('İskonto 0–100 arasında olmalı.');
 const service=(quantity,limit,base,increment,unit)=>{
  if(quantity===0)return {total:0,desc:'Hizmet seçilmedi'};
  const total=quantity<=limit?base:base+(quantity-limit)*increment;
  if(!Number.isFinite(total)||total<0)throw Error('Referans ücret parametreleri geçersiz.');
  return {total:roundMoney(total),desc:quantity<=limit?limit+' '+unit+' değerine kadar sabit.':'Sabit + ('+(quantity-limit)+' '+unit+' × '+increment+' TL)'};
 };
 let yg=service(inputs.trafoGucu,prices.yg_base_limit,prices.yg_base_price,prices.yg_tier1_increment,'kVA');
 if(inputs.trafoGucu>prices.yg_tier1_limit){const firstBand=prices.yg_tier1_limit-prices.yg_base_limit,remaining=inputs.trafoGucu-prices.yg_tier1_limit;yg={total:roundMoney(prices.yg_base_price+firstBand*prices.yg_tier1_increment+remaining*prices.yg_tier2_increment),desc:'Sabit + ('+firstBand+' kVA × '+prices.yg_tier1_increment+') + ('+remaining+' kVA × '+prices.yg_tier2_increment+')'};}
 const ag=service(inputs.yapiAlani,prices.ag_area_limit,prices.ag_base_price,prices.ag_increment,'m²'),topraklama=service(inputs.topraklamaAdet,prices.topraklama_base_limit,prices.topraklama_base_price,prices.topraklama_increment,'nokta'),paratoner=service(inputs.paratonerAdet,prices.paratoner_base_limit,prices.paratoner_base_price,prices.paratoner_increment,'tesisat'),rcd=service(inputs.rcdAdet,prices.rcd_base_limit,prices.rcd_base_price,prices.rcd_increment,'adet');
 const subTotal=roundMoney(yg.total+ag.total+topraklama.total+paratoner.total+rcd.total),selected=['trafoGucu','yapiAlani','topraklamaAdet','paratonerAdet','rcdAdet'].some(key=>inputs[key]>0),kesif=selected?roundMoney(prices.kesif_bedeli):0,grandTotal=roundMoney(subTotal+kesif),discountAmount=roundMoney(grandTotal*inputs.İskonto/100),finalPrice=roundMoney(grandTotal-discountAmount);
 if(![yg.total,subTotal,kesif,grandTotal,finalPrice].every(value=>Number.isFinite(value)&&value>=0))throw Error('Referans ücret parametreleri geçersiz.');
 return {yg,ag,topraklama,paratoner,rcd,subTotal,kesif,grandTotal,discountAmount,finalPrice};
}

export function normalizeKesifSnapshot(data, referenceNo='') {
 const source=isRecord(data.componentSnapshot)?cloneProposal(data.componentSnapshot):null;
 const snapshot=source || {schemaVersion:1,teklifForm:{musteriAdi:data.customer?.name || '',firmaAdi:'',yetkili:'',telefon:'',email:'',adres:data.customer?.address || '',projeAdi:'',aciklama:'',kdvOrani:data.settings?.kdvOrani ?? 20,tarih:data.customer?.date || '',gecerlilikSuresi:''},cart:(data.products || []).map(item=>({...item,name:item.urun || item.name || '',category:item.category || 'Kayıtlı teklif',quantity:item.miktar ?? item.quantity,unit:item.birim || item.unit || '',price:item.birimFiyat ?? item.price,alis_fiyati:item.birimFiyat ?? item.alis_fiyati ?? item.price,kdvOrani:item.kdvOrani ?? data.settings?.kdvOrani ?? 20,priceStatus:item.priceStatus || 'Kayıtlı teklif fiyatı; güncelliğini doğrulayın'})),discount:data.settings?.discount ?? data.settings?.İskonto ?? 0,profit:data.settings?.profit ?? 0,logo:data.metadata?.logo,reportHtml:data.reportHtml || ''};
 if(!isRecord(snapshot.teklifForm)||!Array.isArray(snapshot.cart))throw Error('Keşif formu veya sepet kaydı geçersiz.');
 snapshot.discount=parseDecimal(snapshot.discount,null);snapshot.profit=parseDecimal(snapshot.profit,null);
 if(snapshot.discount===null || snapshot.discount<0 || snapshot.discount>100 || snapshot.profit===null || snapshot.profit<0)throw Error('Keşif iskonto veya kâr oranı geçersiz.');
 snapshot.cart=snapshot.cart.map(item=>{const quantity=parseDecimal(item.quantity,null),price=parseDecimal(item.alis_fiyati ?? item.price,null),kdvOrani=parseDecimal(item.kdvOrani ?? snapshot.teklifForm.kdvOrani ?? 20,null);if(!isRecord(item)||!String(item.name || '').trim()||!(quantity>0)||price===null||price<0||kdvOrani===null||kdvOrani<0||kdvOrani>100)throw Error('Kayıtlı keşif kalemi geçersiz.');return {...item,quantity,price:parseDecimal(item.price,price),alis_fiyati:price,kdvOrani,category:String(item.category || 'Kayıtlı teklif')};});
 snapshot.teklifForm={...snapshot.teklifForm,teklifNo:referenceNo || snapshot.teklifForm.teklifNo || newDraftReference()};
 snapshot.schemaVersion=1;return snapshot;
}

export function calculateYGQuote(companyData, params, { referenceNo = newDraftReference() } = {}) {
      const totalKVA = parsePower(companyData.powerStr);
      let nominalFee = 0;
      
      // EMO 2026 Hesaplama Mantii
      if (companyData.type === 'direk' || (totalKVA < 400 && companyData.type !== 'uretim')) {
          // Direk Tipi Trafo Merkezleri (EMO 2026 Kısım III - Madde 3.1)
          if (totalKVA <= 50) {
              nominalFee = params.poleFee1;
          } else if (totalKVA <= 160) {
              nominalFee = params.poleFee2;
          } else if (totalKVA <= 400) {
              nominalFee = params.poleFee3;
          } else {
              // 400 kVA izeri direk tipi EMO listesinde net değilse bina tipi baz alinir
              nominalFee = params.baseFee + ((totalKVA - 400) * params.rate1);
          }
      } else {
          // Bina Tipi Trafo Merkezleri (EMO 2026 - Kısım III - Madde 5.2)
          if (totalKVA <= 400) {
             // Madde 5.2.1: İlk 400 kVA (2 hücre)
             nominalFee = params.baseFee;
          } else if (totalKVA <= 5000) {
             // Madde 5.2.2: 401 kVA - 5 MVA arasi artan her kVA için
             nominalFee = params.baseFee + ((totalKVA - 400) * params.rate1);
          } else {
             // Madde 5.2.3: 5 MVA izeri artan her kVA için
             // ilk 400 sabit + (4600 * rate1) + (kalan * rate2)
             nominalFee = params.baseFee + (4600 * params.rate1) + ((totalKVA - 5000) * params.rate2);
          }
      }

      // Bölge Katsayisi Uygulamasi
      const appliedRegionCoeff = companyData.regionCoeff !== undefined ? companyData.regionCoeff : params.regionCoeff;
      nominalFee = nominalFee * appliedRegionCoeff;

      // İskonto Uygulamasi - manualForm.customDiscount kullan
      const appliedDiscountRate = companyData.customDiscount !== undefined ? companyData.customDiscount : 
                                   (companyData.discountRate !== undefined ? companyData.discountRate : params.discountRate);

      if (!Number.isFinite(nominalFee) || nominalFee<0 || !(Number(appliedRegionCoeff)>0) || !Number.isFinite(Number(appliedDiscountRate)) || Number(appliedDiscountRate)<0 || Number(appliedDiscountRate)>100) throw Error('Ücret, bölge katsayısı veya iskonto geçersiz.');
      nominalFee = roundMoney(nominalFee);
      const discountAmount = roundMoney(nominalFee * (appliedDiscountRate / 100));
      const offerPrice = roundMoney(nominalFee - discountAmount);

      return {
        ...companyData,
        totalKVA,
        nominalFee,
        discountAmount,
        offerPrice,
        regionCoeff: appliedRegionCoeff,
        appliedDiscountRate,
        refNo: referenceNo // Referans Numarası Oluşturma
      };
  }
