// Shared operational calculations. Unknown measurements stay null; no synthetic data.
export function parseDecimal(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (value == null || String(value).trim() === '') return fallback;
  let text = String(value).trim().replace(/[\s\u00a0]/g, '');
  if (text.includes(',')) {
    if (text.includes('.')) {
      // A separator is a thousands separator only when every group is complete.
      // Otherwise a mistyped import such as 12.34,56 must not silently become 1234.56.
      if (text.lastIndexOf('.') > text.lastIndexOf(',')) {
        if (!/^[+-]?\d{1,3}(?:,\d{3})+\.\d*$/.test(text)) return fallback;
        text = text.replace(/,/g, '');
      } else {
        if (!/^[+-]?\d{1,3}(?:\.\d{3})+,\d*$/.test(text)) return fallback;
        text = text.replace(/\./g, '').replace(',', '.');
      }
    } else text = text.replace(',', '.');
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

const importColumnAliases = new Map();
const normalizeImportColumn = value => value.trim().replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
export function findImportColumn(row, names) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const aliases = names.join('\u0000');
  let normalized = importColumnAliases.get(aliases);
  if (!normalized) { normalized = new Set(names.map(normalizeImportColumn)); importColumnAliases.set(aliases, normalized); }
  const key = Object.keys(row).find(column => normalized.has(normalizeImportColumn(column)));
  return key === undefined ? undefined : row[key];
}

export function detectEnergyType(rows) {
  const types = rows.map(row => {
    const code = String(findImportColumn(row, ['Endeks Kodu', 'OBIS', 'OBIS Kodu', 'Enerji Tipi', 'energy_type']) ?? '').toLocaleLowerCase('tr-TR');
    const matches = [
      ['aktif', /(?:^|[^\d.])1\.8\.0(?:$|[^\d.])|(?:^|[^\p{L}])(?:aktif|active)(?:$|[^\p{L}])/u],
      ['induktif', /(?:^|[^\d.])5\.8\.0(?:$|[^\d.])|(?:^|[^\p{L}])(?:endüktif|enduktif|induktif|inductive)(?:$|[^\p{L}])/u],
      ['kapasitif', /(?:^|[^\d.])8\.8\.0(?:$|[^\d.])|(?:^|[^\p{L}])(?:kapasitif|capacitive)(?:$|[^\p{L}])/u]
    ].filter(([, pattern]) => pattern.test(code));
    return matches.length === 1 ? matches[0][0] : null;
  });
  return types.length > 0 && types[0] && types.every(type => type === types[0]) ? types[0] : null;
}

export function prepareEnergyRows(rows, energyType) {
  if (!Array.isArray(rows) || rows.length === 0 || !['aktif', 'induktif', 'kapasitif'].includes(energyType)) throw new Error('Gerçek sayaç verisi ve enerji tipi seçilmelidir.');
  const dates = new Set();
  const data = rows.map((row, index) => {
    const rawDate = findImportColumn(row, ['Tarih', 'Tarih2']);
    const date = parseImportDate(rawDate);
    if (!date) throw new Error(`${index + 1}. satırın tarihi geçersiz.`);
    if (dates.has(date.getTime())) throw new Error(`${index + 1}. satırda tarih ve saat tekrarlanıyor. Dosyayı tek bir sayaç ve enerji kategorisi için hazırlayın.`);
    dates.add(date.getTime());
    const tuketim = parseDecimal(findImportColumn(row, ['Tüketim ()', 'Tüketim', 'Tüketim (kWh)', 'Tüketim (kVArh)']), null);
    const endeks = parseDecimal(findImportColumn(row, ['Okunan Endeks Değeri', 'Okunan Değer']), null);
    const rawMultiplier = findImportColumn(row, ['Çarpan']);
    const carpan = rawMultiplier == null || String(rawMultiplier).trim() === '' ? 1 : parseDecimal(rawMultiplier, null);
    if (tuketim === null || tuketim < 0 || !(carpan > 0)) throw new Error(`${index + 1}. satırın tüketimi veya çarpanı geçersiz.`);
    return { id: index + 1, tarih: typeof rawDate === 'number' || rawDate instanceof Date ? date.toLocaleString('tr-TR') : String(rawDate), tuketim, endeks, carpan, okumaSuresi: parseDecimal(findImportColumn(row, ['Okuma Süresi (Saat)']), null), sonuc: 'Ölçüm verisi' };
  });
  const totals = data.reduce((result, row) => ({ sum: result.sum + row.tuketim, max: Math.max(result.max, row.tuketim), min: Math.min(result.min, row.tuketim) }), { sum: 0, max: -Infinity, min: Infinity });
  if (!Number.isFinite(totals.sum)) throw new Error('Toplam tüketim sayısal hesaplama sınırını aşıyor.');
  return { aktifData: energyType === 'aktif' ? data : [], induktifData: energyType === 'induktif' ? data : [], kapasitifData: energyType === 'kapasitif' ? data : [], istatistikler: { toplamTuketim: totals.sum.toFixed(2), ortalamaTuketim: (totals.sum / data.length).toFixed(2), maxTuketim: totals.max.toFixed(2), minTuketim: totals.min.toFixed(2) } };
}

export function cosPhiFromEnergy(active, reactive) {
  const p = parseDecimal(active, null), q = parseDecimal(reactive, null);
  if (p === null || q === null || p <= 0 || q < 0) return null;
  return (p / Math.hypot(p, q)).toFixed(3);
}

export function parseEnergySpreadsheet(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Sayaç dosyasında ölçüm satırı bulunamadı.');
  const normalized = rows.map((row, index) => {
    const date = parseImportDate(findImportColumn(row, ['Tarih']));
    if (!date) throw new Error(`${index + 1}. satırda geçerli tarih bulunamadı.`);
    const indexValue = findImportColumn(row, ['Okunan Endeks Değeri', 'Okunan Değer']);
    const rawIndex = parseDecimal(indexValue, null);
    const multiplierValue = findImportColumn(row, ['Çarpan']);
    const multiplier = multiplierValue == null || String(multiplierValue).trim() === '' ? 1 : parseDecimal(multiplierValue, null);
    const explicitValue = findImportColumn(row, ['Hesaplanmış Endeks', 'Hesaplanmis Endeks', 'Endeks Değeri']);
    const explicitIndex = parseDecimal(explicitValue, null);
    const calculated = explicitIndex ?? (rawIndex !== null ? rawIndex * multiplier : null);
    const consumptionValue = findImportColumn(row, ['Tüketim', 'Tuketim', 'Tüketim ()', 'Tüketim (kWh)', 'Tüketim (kVArh)']);
    const consumption = parseDecimal(consumptionValue, null);
    for (const [raw, parsed] of [[indexValue, rawIndex], [explicitValue, explicitIndex], [consumptionValue, consumption]]) {
      if (raw != null && String(raw).trim() !== '' && parsed === null) throw new Error(`${index + 1}. satırda tüketim veya endeks sayısal olmalıdır.`);
    }
    if (!(multiplier > 0) || (consumption !== null && consumption < 0) || (rawIndex !== null && rawIndex < 0) || (calculated !== null && (!Number.isFinite(calculated) || calculated < 0))) throw new Error(`${index + 1}. satırda tüketim, endeks veya çarpan geçersiz.`);
    return { date, rawIndex, multiplier, calculated, consumption, raw_data: row };
  }).sort((a, b) => a.date - b.date);
  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index].date.getTime() === normalized[index - 1].date.getTime()) throw new Error('Aynı tarih ve saatte birden fazla sayaç kaydı var. Tek bir sayaç/enerji kategorisi seçip yinelenen satırları düzeltin.');
  }
  const result = normalized.flatMap((row, index) => {
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
  if (!result.length) throw new Error('Tüketim hesaplamak için en az iki farklı zamanlı endeks veya doğrudan tüketim sütunu gerekli.');
  return result;
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
    const existing = result.find(product => product.name === item.name && product.category === item.category
      && (product.id == null && item.id == null || product.id === item.id)
      && (product.unit || '') === (item.unit || '')
      && parseDecimal(product.alis_fiyati ?? product.price, null) === parseDecimal(item.alis_fiyati ?? item.price, null)
      && (product.kdvOrani ?? 20) === (item.kdvOrani ?? 20)
      && (product.description || '') === (item.description || ''));
    if (existing) existing.quantity = parseDecimal(existing.quantity) + quantity;
    else result.push({ ...item, quantity, description: item.description || '', kdvOrani: item.kdvOrani ?? 20 });
  }
  return result;
}

export function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

export function saleLineTotal(item, discount, profit) {
  const quantity = parseDecimal(item.quantity, null);
  if (!(quantity > 0)) throw new Error('Miktar sıfırdan büyük olmalıdır.');
  const total = roundMoney(saleUnitPrice(item, discount, profit) * quantity);
  if (!Number.isFinite(total)) throw new Error('Satır tutarı sayısal hesaplama sınırını aşıyor.');
  return total;
}

export function saleUnitPrice(item, discount, profit) {
  const price = parseDecimal(item.alis_fiyati ?? item.price, null), d = parseDecimal(discount, null), p = parseDecimal(profit, null);
  if (price === null || price < 0 || d === null || d < 0 || d > 100 || p === null || p < 0) throw new Error('Fiyat, iskonto veya kâr oranı geçersiz.');
  const result = roundMoney(price * (1 - d / 100) * (1 + p / 100));
  if (!Number.isFinite(result)) throw new Error('Birim fiyat sayısal hesaplama sınırını aşıyor.');
  return result;
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
  const times = new Set();
  return rows.map((row,index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${index+1}. satır ölçüm nesnesi olmalıdır.`);
    const date = parseImportDate(row.olcum_zamani ?? row.zaman ?? row.tarih);
    if (!date) throw new Error(`${index+1}. satırda gerçek olcum_zamani / zaman / tarih gerekli.`);
    const result = { fabrika_adi: String(facility).trim(), sayac_no: row.sayac_no == null ? null : String(row.sayac_no), olcum_zamani: date.toISOString() };
    const key = JSON.stringify([result.sayac_no, result.olcum_zamani]);
    if (times.has(key)) throw new Error(`${index+1}. satırda aynı sayaç ve ölçüm zamanı tekrarlanıyor.`);
    times.add(key);
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
