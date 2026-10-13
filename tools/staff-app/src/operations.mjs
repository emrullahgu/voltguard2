// Shared operational calculations. Unknown measurements stay null; no synthetic data.
export function parseDecimal(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (value == null || String(value).trim() === '') return fallback;
  let text = String(value).trim().replace(/[\s\u00a0]/g, '');
  if (text.includes(',')) {
    if (text.includes('.') && text.lastIndexOf('.') > text.lastIndexOf(',')) text = text.replace(/,/g, '');
    else text = text.replace(/\./g, '').replace(',', '.');
  } else if ((text.match(/\./g) || []).length > 1 && /^[+-]?\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

export function localISODate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseImportDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const day = Math.floor(value);
    const seconds = Math.round((value - day) * 86400);
    const date = new Date(1899, 11, 30 + day, 0, 0, seconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  let year, month, day, hour = 0, minute = 0, second = 0;
  if (match) [, year, month, day, hour = 0, minute = 0, second = 0] = match;
  else {
    match = text.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) [, day, month, year, hour = 0, minute = 0, second = 0] = match;
  }
  if (match) {
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 ? date : null;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (!iso) return null;
  const calendar = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  if (calendar.getUTCFullYear() !== Number(iso[1]) || calendar.getUTCMonth() !== Number(iso[2]) - 1 || calendar.getUTCDate() !== Number(iso[3]) || Number(iso[4]) > 23 || Number(iso[5]) > 59 || Number(iso[6] || 0) > 59) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function findImportColumn(row, names) {
  const normalized = names.map(name => name.toLocaleLowerCase('tr-TR'));
  const key = Object.keys(row).find(column => normalized.includes(column.trim().toLocaleLowerCase('tr-TR')));
  return key === undefined ? undefined : row[key];
}

export function detectEnergyType(rows) {
  const types = rows.map(row => {
    const code = String(findImportColumn(row, ['Endeks Kodu', 'OBIS', 'OBIS Kodu', 'Enerji Tipi', 'energy_type']) ?? '').toLocaleLowerCase('tr-TR');
    if (/1\.8\.0|aktif|active/.test(code) && !/reaktif/.test(code)) return 'aktif';
    if (/5\.8\.0|endüktif|enduktif|induktif|inductive/.test(code)) return 'induktif';
    if (/8\.8\.0|kapasitif|capacitive/.test(code)) return 'kapasitif';
    return null;
  });
  return types.length > 0 && types[0] && types.every(type => type === types[0]) ? types[0] : null;
}

export function prepareEnergyRows(rows, energyType) {
  if (!Array.isArray(rows) || rows.length === 0 || !['aktif', 'induktif', 'kapasitif'].includes(energyType)) throw new Error('Gerçek sayaç verisi ve enerji tipi seçilmelidir.');
  const data = rows.map((row, index) => {
    const rawDate = findImportColumn(row, ['Tarih', 'Tarih2']);
    if (!parseImportDate(rawDate)) throw new Error(`${index + 1}. satırın tarihi geçersiz.`);
    const tuketim = parseDecimal(findImportColumn(row, ['Tüketim ()', 'Tüketim', 'Tüketim (kWh)', 'Tüketim (kVArh)']), null);
    const endeks = parseDecimal(findImportColumn(row, ['Okunan Endeks Değeri', 'Okunan Değer']), null);
    const carpan = parseDecimal(findImportColumn(row, ['Çarpan']), 1);
    if (tuketim === null || tuketim < 0 || !(carpan > 0)) throw new Error(`${index + 1}. satırın tüketimi veya çarpanı geçersiz.`);
    return { id: index + 1, tarih: String(rawDate), tuketim, endeks, carpan, okumaSuresi: parseDecimal(findImportColumn(row, ['Okuma Süresi (Saat)']), null), sonuc: 'Ölçüm verisi' };
  });
  const sum = data.reduce((total, row) => total + row.tuketim, 0);
  return { aktifData: energyType === 'aktif' ? data : [], induktifData: energyType === 'induktif' ? data : [], kapasitifData: energyType === 'kapasitif' ? data : [], istatistikler: { toplamTuketim: sum.toFixed(2), ortalamaTuketim: (sum / data.length).toFixed(2), maxTuketim: Math.max(...data.map(row => row.tuketim)).toFixed(2), minTuketim: Math.min(...data.map(row => row.tuketim)).toFixed(2) } };
}

export function cosPhiFromEnergy(active, reactive) {
  const p = parseDecimal(active, null), q = parseDecimal(reactive, null);
  if (p === null || q === null || p <= 0 || q < 0) return null;
  return (p / Math.hypot(p, q)).toFixed(3);
}

export function parseEnergySpreadsheet(rows) {
  const normalized = rows.map((row, index) => {
    const date = parseImportDate(findImportColumn(row, ['Tarih']));
    if (!date) throw new Error(`${index + 1}. satırda geçerli tarih bulunamadı.`);
    const rawIndex = parseDecimal(findImportColumn(row, ['Okunan Endeks Değeri', 'Okunan Değer']), null);
    const multiplier = parseDecimal(findImportColumn(row, ['Çarpan']), 1);
    const explicitIndex = parseDecimal(findImportColumn(row, ['Hesaplanmış Endeks', 'Hesaplanmis Endeks', 'Endeks Değeri']), null);
    const calculated = explicitIndex ?? (rawIndex !== null ? rawIndex * multiplier : null);
    const consumption = parseDecimal(findImportColumn(row, ['Tüketim', 'Tuketim', 'Tüketim ()', 'Tüketim (kWh)', 'Tüketim (kVArh)']), null);
    if (!(multiplier > 0) || (consumption !== null && consumption < 0)) throw new Error(`${index + 1}. satırda tüketim veya çarpan geçersiz.`);
    return { date, rawIndex, multiplier, calculated, consumption, raw_data: row };
  }).sort((a, b) => a.date - b.date);
  return normalized.flatMap((row, index) => {
    let consumption = row.consumption;
    if (consumption === null) {
      const next = normalized[index + 1];
      if (!next) return [];
      if (row.calculated === null || next.calculated === null) throw new Error('Tüketim veya karşılaştırılabilir endeks sütunu gerekli.');
      consumption = next.calculated - row.calculated;
      if (consumption < 0) throw new Error('Sayaç endeksi azalmış. Sayaç değişimi/devri kontrol edilmeden tüketim hesaplanamaz.');
    }
    const day = row.date.getDate().toString().padStart(2, '0'), month = (row.date.getMonth() + 1).toString().padStart(2, '0');
    const name = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'][row.date.getDay()];
    return [{ tarih: localISODate(row.date), saat: `${name} ${day}.${month} ${row.date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`, okunan_endeks: row.rawIndex, carpan: row.multiplier, hesaplanmis_endeks: row.calculated, tuketim: consumption, raw_data: row.raw_data }];
  });
}

export function workDurationHours(start, end) {
  const parse = text => { const match = String(text || '').match(/^(\d{2}):(\d{2})(?::\d{2})?$/); return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null; };
  const from = parse(start), to = parse(end);
  return from !== null && to !== null && to > from ? Math.round((to - from) / 60 * 100) / 100 : null;
}

export function mergeCartItems(cart, additions) {
  const result = cart.map(item => ({ ...item }));
  for (const item of additions) {
    const quantity = parseDecimal(item.quantity, null);
    if (!(quantity > 0)) throw new Error('Miktar sıfırdan büyük olmalıdır.');
    const existing = result.find(product => product.name === item.name && product.category === item.category);
    if (existing) existing.quantity = parseDecimal(existing.quantity) + quantity;
    else result.push({ ...item, quantity, description: item.description || '', kdvOrani: item.kdvOrani ?? 20 });
  }
  return result;
}

export function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

export function saleLineTotal(item, discount, profit) { return roundMoney(saleUnitPrice(item, discount, profit) * parseDecimal(item.quantity)); }

export function saleUnitPrice(item, discount, profit) {
  const price = parseDecimal(item.alis_fiyati ?? item.price, null), d = parseDecimal(discount, null), p = parseDecimal(profit, null);
  if (price === null || price < 0 || d === null || d < 0 || d > 100 || p === null || p < 0) throw new Error('Fiyat, iskonto veya kâr oranı geçersiz.');
  return roundMoney(price * (1 - d / 100) * (1 + p / 100));
}

export function installmentAmount(amount, count, offset) {
  const value = parseDecimal(amount, null), total = Number(count), month = Number(offset);
  if (value === null || value < 0 || !Number.isInteger(total) || total < 1 || !Number.isInteger(month) || month < 0 || month >= total) return 0;
  const cents = Math.round((value + Number.EPSILON) * 100);
  const quotient = Math.floor(cents / total), remainder = cents % total;
  return (quotient + (month < remainder ? 1 : 0)) / 100;
}

export function monthlyAdvanceAmount(advance, year, month) {
  const date = parseImportDate(advance.advance_date ?? advance.date);
  if (!date || advance.is_fully_paid) return 0;
  const offset = (year - date.getFullYear()) * 12 + month - date.getMonth();
  return installmentAmount(advance.amount, advance.installment_count ?? advance.installment_total ?? 1, offset);
}

export function directOsosMeasurements(rows, facility) {
  if (!Array.isArray(rows) || !rows.length || !String(facility || '').trim()) throw new Error('Tesis adı ve gerçek ölçümler gerekli.');
  const fields = ['aktif_guc','reaktif_guc','kapasitif_guc','gorunen_guc','gerilim_l1','gerilim_l2','gerilim_l3','akim_l1','akim_l2','akim_l3','guc_faktoru','frekans','toplam_enerji'];
  return rows.map((row,index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${index+1}. satır ölçüm nesnesi olmalıdır.`);
    const date = parseImportDate(row.olcum_zamani ?? row.zaman ?? row.tarih);
    if (!date) throw new Error(`${index+1}. satırda gerçek olcum_zamani / zaman / tarih gerekli.`);
    const result = { fabrika_adi: String(facility).trim(), sayac_no: row.sayac_no == null ? null : String(row.sayac_no), olcum_zamani: date.toISOString() };
    let supplied = 0;
    for (const field of fields) {
      const value = row[field] ?? (field === 'gerilim_l1' ? row.gerilim : field === 'akim_l1' ? row.akim : field === 'toplam_enerji' ? row.enerji : undefined);
      const number = parseDecimal(value, null);
      if (value != null && value !== '' && number === null) throw new Error(`${index+1}. satırda ${field} sayısal olmalıdır.`);
      if (number !== null) supplied++;
      if (number !== null && (/^(gerilim_|akim_)/.test(field) || ['frekans','toplam_enerji','gorunen_guc'].includes(field)) && number < 0) throw new Error(`${index+1}. satırda ${field} negatif olamaz.`);
      if (field === 'guc_faktoru' && number !== null && (number < -1 || number > 1)) throw new Error('Güç faktörü -1 ile 1 arasında olmalıdır.');
      result[field] = number;
    }
    if (!supplied) throw new Error(`${index+1}. satırda hiçbir ölçüm değeri bulunamadı.`);
    return result;
  });
}

export function sanitizeLegacyEnergyReport(record) {
  let unverified = 0;
  const factories = (record.fabrikaVerileri || []).map(factory => {
    const type = Array.isArray(factory.hamVeri) ? detectEnergyType(factory.hamVeri) : null;
    if (type) {
      try { const actual = prepareEnergyRows(factory.hamVeri,type); return {...factory,enerjiTipi:type,aktifEnerji:actual.aktifData,induktifEnerji:actual.induktifData,kapasitifEnerji:actual.kapasitifData,istatistikler:actual.istatistikler}; } catch {}
    }
    unverified++;
    return {...factory,enerjiTipi:'belirsiz',aktifEnerji:[],induktifEnerji:[],kapasitifEnerji:[],istatistikler:{toplamTuketim:'Doğrulanmadı',ortalamaTuketim:'Doğrulanmadı',maxTuketim:'Doğrulanmadı',minTuketim:'Doğrulanmadı'}};
  });
  const first=factories[0];
  const note='Eski sürümde otomatik üretilen enerji tahminleri aktarılmadı. Türü OBIS bilgisinden doğrulanamayan ham sayaç dosyalarını doğru enerji tipini seçerek yeniden içe aktarın.';
  return {...record,formData:{...record.formData,aciklama:[record.formData?.aciklama,unverified||!factories.length?note:null].filter(Boolean).join('\n\n')},fabrikaVerileri:factories,aktifEnerji:first?.aktifEnerji||[],induktifEnerji:first?.induktifEnerji||[],kapasitifEnerji:first?.kapasitifEnerji||[],legacyEnergyChecked:true};
}
