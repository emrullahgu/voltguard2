import { parseDecimal, parseImportDate } from './operations.mjs';

export const sourceKey = source => JSON.stringify([source.facility ?? null, source.meter ?? null]);

export function measurementSources(rows) {
  const sources = new Map();
  for (const row of rows) {
    const source = { facility: row.fabrika_adi ?? null, meter: row.sayac_no ?? null };
    const key = sourceKey(source);
    if (!sources.has(key)) sources.set(key, { ...source, key });
  }
  return [...sources.values()];
}

// Keep different meters apart even when their records share a facility name.
export function measurementSeries(rows, source) {
  return rows.filter(row => (row.fabrika_adi ?? null) === source.facility && (row.sayac_no ?? null) === source.meter)
    .map(row => ({ ...row, date: parseImportDate(row.olcum_zamani || row.created_at) }))
    .filter(row => row.date)
    .sort((a, b) => a.date - b.date)
    .map(row => ({ ...row, zaman: row.date.toLocaleString('tr-TR'), aktif_guc: parseDecimal(row.aktif_guc, null), reaktif_guc: parseDecimal(row.reaktif_guc, null), gerilim: parseDecimal(row.gerilim_l1, null) }));
}

export function measurementRange(value, min, max) {
  const number = parseDecimal(value, null);
  return number === null ? null : number >= min && number <= max;
}
