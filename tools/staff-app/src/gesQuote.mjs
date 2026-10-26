import { parseDecimal, parseImportDate } from './operations.mjs';

function number(value, field, label, positive = false, max = Infinity) {
  const parsed = parseDecimal(value, null);
  if (parsed === null || parsed < 0 || positive && parsed === 0 || parsed > max) {
    const error = new Error(label + (positive ? ' sıfırdan büyük bir sayı olmalı.' : max === 100 ? ' 0–100 arasında olmalı.' : ' sıfır veya pozitif bir sayı olmalı.'));
    error.field = field;
    throw error;
  }
  return parsed;
}

export function calculateGESQuote(rawForm, rawItems) {
  const form = { ...rawForm };
  form.usdRate = number(form.usdRate, 'usdRate', 'Dolar kuru', true);
  form.autoPower = number(form.autoPower, 'autoPower', 'Kurulu güç', true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.offerDate || '') || !parseImportDate(form.offerDate)) {
    const error = new Error('Geçerli bir teklif tarihi girin.'); error.field = 'offerDate'; throw error;
  }
  for (const [field, label] of [['laborRate', 'Montaj oranı'], ['transportRate', 'Nakliye oranı'], ['overheadRate', 'Mühendislik oranı'], ['marginRate', 'Kâr oranı'], ['vatRate', 'KDV oranı']]) form[field] = number(form[field], field, label, false, field === 'vatRate' ? 100 : Infinity);
  if (!Array.isArray(rawItems) || !rawItems.length) throw new Error('En az bir malzeme satırı ekleyin.');
  const items = rawItems.map((row, index) => ({ ...row,
    qty: number(row.qty, `items.${index}.qty`, `${index + 1}. satır miktarı`, true),
    price: number(row.price, `items.${index}.price`, `${index + 1}. satır birim fiyatı`)
  }));
  const materialTotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const laborCost = materialTotal * (form.laborRate / 100), transportCost = materialTotal * (form.transportRate / 100), overheadCost = materialTotal * (form.overheadRate / 100);
  const directCost = materialTotal + laborCost + transportCost + overheadCost, marginAmount = directCost * (form.marginRate / 100);
  const grandTotalExVat = directCost + marginAmount, vatAmount = grandTotalExVat * (form.vatRate / 100), finalTotal = grandTotalExVat + vatAmount;
  const totals = { materialTotal, laborCost, transportCost, overheadCost, directCost, marginAmount, grandTotalExVat, vatAmount, finalTotal, tlTotal: finalTotal * form.usdRate };
  if (!Object.values(totals).every(value => Number.isFinite(value) && value >= 0)) throw new Error('Teklif tutarı hesaplanamıyor. Miktar, fiyat ve oranları kontrol edin.');
  return { form, items, totals };
}
