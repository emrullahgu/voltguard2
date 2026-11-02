import {reportPortalError} from '../portal/api';
// integrations service — Şirket sunucusu bağlı; AsyncStorage offline cache olarak kullanılır
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, SUPABASE_CONFIGURED } from './supabase';
import { ApiKey, ApiKeyScope, ErpAdapter, ErpProvider, ImportError, ImportResult, ImportType, Webhook, WebhookEvent } from '../types';

const KEY_API = '@SahaTakip:api_keys';
const KEY_WH = '@SahaTakip:webhooks';
const KEY_ERP = '@SahaTakip:erp_adapters';
const KEY_IMPORTS = '@SahaTakip:import_history';

// ---- snake/camel mappers ----
function apiKeyFromRow(r: any): ApiKey {
  return { id: r.id, label: r.label, key: r.key, scopes: r.scopes || [], active: !!r.active, createdAt: r.created_at, lastUsedAt: r.last_used_at || undefined, expiresAt: r.expires_at || undefined };
}
function apiKeyToRow(k: ApiKey) {
  return { id: k.id, label: k.label, key: k.key, scopes: k.scopes, active: k.active, created_at: k.createdAt, last_used_at: k.lastUsedAt || null, expires_at: k.expiresAt || null };
}
function webhookFromRow(r: any): Webhook {
  return { id: r.id, label: r.label, url: r.url, events: r.events || [], secret: r.secret || undefined, active: !!r.active, createdAt: r.created_at, lastDeliveryAt: r.last_delivery_at || undefined, lastStatus: r.last_status || undefined, lastError: r.last_error || undefined };
}
function webhookToRow(w: Webhook) {
  return { id: w.id, label: w.label, url: w.url, events: w.events, secret: w.secret || null, active: w.active, created_at: w.createdAt, last_delivery_at: w.lastDeliveryAt || null, last_status: w.lastStatus || null, last_error: w.lastError || null };
}
function erpFromRow(r: any): ErpAdapter {
  return { id: r.id, provider: r.provider, label: r.label, baseUrl: r.base_url || undefined, apiKey: r.api_key || undefined, username: r.username || undefined, active: !!r.active, syncCustomers: !!r.sync_customers, syncInvoices: !!r.sync_invoices, syncProducts: !!r.sync_products, createdAt: r.created_at, lastSyncAt: r.last_sync_at || undefined, lastSyncStatus: r.last_sync_status || undefined };
}
function erpToRow(a: ErpAdapter) {
  return { id: a.id, provider: a.provider, label: a.label, base_url: a.baseUrl || null, api_key: a.apiKey || null, username: a.username || null, active: a.active, sync_customers: a.syncCustomers, sync_invoices: a.syncInvoices, sync_products: a.syncProducts, created_at: a.createdAt, last_sync_at: a.lastSyncAt || null, last_sync_status: a.lastSyncStatus || null };
}
function importFromRow(r: any): ImportResult {
  return { type: r.type, rowsTotal: r.rows_total, rowsImported: r.rows_imported, rowsSkipped: r.rows_skipped, errors: r.errors || [], importedAt: r.imported_at };
}

export const SCOPE_LABEL_TR: Record<ApiKeyScope, string> = {
  read: 'Okuma',
  write: 'Yazma',
  admin: 'Yönetici',
};

export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, string> = {
  'work_order.created': 'İş emri oluşturuldu',
  'work_order.completed': 'İş emri tamamlandı',
  'quote.created': 'Teklif oluşturuldu',
  'quote.accepted': 'Teklif kabul edildi',
  'quote.rejected': 'Teklif reddedildi',
  'payment.received': 'Tahsilat alındı',
  'inspection.failed': 'Denetim başarısız',
  'anomaly.detected': 'Anomali tespit edildi',
};

export const WEBHOOK_EVENTS: WebhookEvent[] = Object.keys(WEBHOOK_EVENT_LABEL) as WebhookEvent[];

export const ERP_PROVIDER_LABEL: Record<ErpProvider, string> = {
  logo: 'Logo',
  netsis: 'Netsis',
  mikro: 'Mikro',
  custom: 'Özel',
};

export const ERP_PROVIDER_COLOR: Record<ErpProvider, string> = {
  logo: '#dc2626',
  netsis: '#0ea5e9',
  mikro: '#16a34a',
  custom: '#8b5cf6',
};

function rid(prefix: string): string {
  return prefix + '-' + Math.random().toString(36).slice(2, 10);
}

function makeKey(): string {
  // sk_live_<32 hex>
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return 'sk_live_' + hex;
}

// ---- ApiKey CRUD ----
export async function listApiKeys(): Promise<ApiKey[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function saveApiKeys(list: ApiKey[]): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function createApiKey(input: { label: string; scopes: ApiKeyScope[]; expiresAt?: string }): Promise<ApiKey> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function revokeApiKey(id: string): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function deleteApiKey(id: string): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---- Webhook CRUD ----
export async function listWebhooks(): Promise<Webhook[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function saveWebhooks(list: Webhook[]): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function upsertWebhook(w: Webhook): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function deleteWebhook(id: string): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export function makeWebhook(input: { label: string; url: string; events: WebhookEvent[]; secret?: string }): Webhook {
  return { id: rid('wh'), label: input.label, url: input.url, events: input.events, secret: input.secret, active: true, createdAt: new Date().toISOString() };
}

export async function testWebhook(w: Webhook): Promise<{ ok: boolean; status?: number; error?: string }> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---- ERP Adapter CRUD ----
export async function listErpAdapters(): Promise<ErpAdapter[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function saveErpAdapters(list: ErpAdapter[]): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function upsertErpAdapter(a: ErpAdapter): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function deleteErpAdapter(id: string): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export function makeErpAdapter(input: { provider: ErpProvider; label: string; baseUrl?: string; apiKey?: string; username?: string }): ErpAdapter {
  return {
    id: rid('erp'),
    provider: input.provider,
    label: input.label,
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    username: input.username,
    active: true,
    syncCustomers: true,
    syncInvoices: true,
    syncProducts: false,
    createdAt: new Date().toISOString(),
  };
}

export async function mockSyncErp(id: string): Promise<{ ok: boolean }> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---- Excel/CSV Import ----
export interface ImportFieldSpec { key: string; label: string; required?: boolean }

export const IMPORT_FIELDS: Record<ImportType, ImportFieldSpec[]> = {
  customers: [
    { key: 'shortName', label: 'Kısa Ad', required: true },
    { key: 'title', label: 'Unvan' },
    { key: 'taxNumber', label: 'Vergi No' },
    { key: 'phone', label: 'Telefon' },
    { key: 'email', label: 'E-posta' },
    { key: 'city', label: 'Şehir' },
  ],
  poz: [
    { key: 'pozId', label: 'POZ Kodu', required: true },
    { key: 'name', label: 'İş Tanımı', required: true },
    { key: 'unit', label: 'Birim', required: true },
    { key: 'unitPrice', label: 'Birim Fiyat', required: true },
  ],
  employees: [
    { key: 'name', label: 'Ad Soyad', required: true },
    { key: 'role', label: 'Görev' },
    { key: 'monthlyWage', label: 'Aylık Ücret' },
    { key: 'dailyRate', label: 'Günlük Yevmiye' },
  ],
};

export function parseCsvOrTsv(text: string): { headers: string[]; rows: string[][] } {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.trim()) return { headers: [], rows: [] };
  const first = text.split('\n')[0];
  const separators = ['\t', ';', ','];
  const counts = separators.map(separator => { let count = 0, quoted = false; for (let i = 0; i < first.length; i++) { if (first[i] === '"') { if (quoted && first[i + 1] === '"') i++; else quoted = !quoted; } else if (!quoted && first[i] === separator) count++; } return count; });
  const separator = separators[counts.indexOf(Math.max(...counts))];
  const records: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (quoted || !cell.trim()) quoted = !quoted; else cell += c; }
    else if (!quoted && (c === separator || c === '\n')) { row.push(cell.trim()); cell = ''; if (c === '\n') { if (row.some(value => value !== '')) records.push(row); row = []; } }
    else cell += c;
  }
  if (quoted) throw new Error('CSV içinde kapanmamış tırnak var. Verileri düzeltin.');
  row.push(cell.trim()); if (row.some(value => value !== '')) records.push(row);
  return { headers: records[0] || [], rows: records.slice(1) };
}

const headerKey = (value: string) => value.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, '');
function columnMap(type: ImportType, headers: string[]) {
  const map: Record<string, number> = {};
  for (const field of IMPORT_FIELDS[type]) map[field.key] = headers.findIndex(header => headerKey(header) === headerKey(field.key) || headerKey(header) === headerKey(field.label));
  return map;
}
function numericCell(raw: string): number | undefined {
  let value = raw.trim().replace(/\s|₺/g, '');
  if (!value) return undefined;
  if (value.includes(',')) { if (!/^(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d+)?$/.test(value)) return undefined; value = value.replace(/\./g, '').replace(',', '.'); }
  else if (!/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const number = Number(value); return Number.isFinite(number) && number >= 0 && number <= 1e12 ? number : undefined;
}

export function validateImport(type: ImportType, headers: string[], rows: string[][]): ImportResult {
  const spec = IMPORT_FIELDS[type];
  const errors: ImportError[] = [];
  const hIdx = columnMap(type, headers);
  for (const f of spec) {
    const idx = hIdx[f.key];
    if (idx >= 0) hIdx[f.key] = idx;
    else if (f.required) errors.push({ row: 0, message: `Zorunlu sütun yok: ${f.label} (${f.key})` });
  }
  let imported = 0; let skipped = 0;
  rows.forEach((r, i) => {
    let ok = true;
    if (r.length !== headers.length) { errors.push({ row: i + 2, message: 'Satırdaki sütun sayısı başlıklarla aynı olmalıdır.' }); ok = false; }
    for (const f of spec) {
      if (f.required) {
        const v = r[hIdx[f.key]];
        if (!v || v.trim() === '') {
          errors.push({ row: i + 2, message: `${f.label} boş` });
          ok = false;
          break;
        }
      }
    }
    for (const key of type === 'poz' ? ['unitPrice'] : type === 'employees' ? ['monthlyWage', 'dailyRate'] : []) {
      const raw = r[hIdx[key]] || '';
      if (raw.trim() && numericCell(raw) === undefined) { errors.push({ row: i + 2, message: `${spec.find(field => field.key === key)?.label}: geçerli ve negatif olmayan bir sayı girin.` }); ok = false; }
    }
    if (ok) imported++; else skipped++;
  });
  return { type, rowsTotal: rows.length, rowsImported: imported, rowsSkipped: skipped, errors: errors.slice(0, 50), importedAt: new Date().toISOString() };
}

export async function listImportHistory(): Promise<ImportResult[]> {
  const { data, error } = await supabase.from('import_history').select('*').order('imported_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data || []).map(importFromRow);
}
export async function saveImportResult(r: ImportResult): Promise<void> {
  const { error } = await supabase.from('import_history').insert({ type: r.type, rows_total: r.rowsTotal, rows_imported: r.rowsImported, rows_skipped: r.rowsSkipped, errors: r.errors, imported_at: r.importedAt });
  if (error) throw error;
}
export async function importRecords(type: ImportType, text: string): Promise<ImportResult & { warning?: string }> {
  const { headers, rows } = parseCsvOrTsv(text);
  if (!rows.length) throw new Error('İçe aktarılacak veri satırı bulunamadı.');
  if (rows.length > 500) throw new Error('Tek işlemde en fazla 500 satır aktarılabilir. Verileri bölerek yeniden deneyin.');
  const validation = validateImport(type, headers, rows);
  if (validation.errors.length) return { ...validation, rowsImported: 0, rowsSkipped: rows.length };
  const columns = columnMap(type, headers);
  const get = (row: string[], key: string) => (row[columns[key]] || '').trim();
  const payload = rows.map(row => {
    if (type === 'customers') return { short_name: get(row, 'shortName'), title: get(row, 'title') || get(row, 'shortName'), tax_number: get(row, 'taxNumber') || null, phone: get(row, 'phone') || null, email: get(row, 'email') || null, city: get(row, 'city') || null };
    if (type === 'employees') return { full_name: get(row, 'name'), role: get(row, 'role'), monthly_wage: numericCell(get(row, 'monthlyWage')) || 0, daily_wage: numericCell(get(row, 'dailyRate')) || 0, attendance_json: {}, active: true };
    return { id: 'custom-' + globalThis.crypto.randomUUID(), code: get(row, 'pozId'), name: get(row, 'name'), unit: get(row, 'unit'), price: numericCell(get(row, 'unitPrice')), category: 'POZ', deleted: false };
  });
  const table = type === 'customers' ? 'customers' : type === 'employees' ? 'employees' : 'catalog_custom_products';
  const { data, count, error } = await supabase.from(table).insert(payload).select('id');
  if (error) throw error;
  const committed = Array.isArray(data) ? data.length : Number(count);
  if (committed !== rows.length) throw new Error('Sunucunun içe aktarma sonucu doğrulanamadı. Yeniden göndermeden önce kayıt listesini kontrol edin.');
  const result: ImportResult & { warning?: string } = { ...validation, rowsImported: committed, rowsSkipped: 0, errors: [] };
  try { await saveImportResult(result); } catch { result.warning = 'Veriler sunucuya kaydedildi; içe aktarma geçmişi yazılamadı. Aynı verileri tekrar göndermeyin.'; }
  return result;
}
