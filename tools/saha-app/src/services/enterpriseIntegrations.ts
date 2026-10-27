import {reportPortalError} from '../portal/api';
// Faz 39 — Kurumsal Entegrasyonlar servisi (mock/local) — POZ-DEV-451..
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  ErpVendor, IntegrationStatus, ErpConnection, ErpSyncJob, ErpEntityKind, SyncDirection,
  ErpCustomerMapping, ErpStockMapping, ErpInvoiceDraft, QuoteOrderConversion,
  CrmConnection, CrmProvider, IntegrationWebhook, WebhookDelivery,
  IntegrationApiKey, ApiUsageLog, IntegrationErrorLog, IntegrationHealth,
} from '../types';

const K = {
  conn: 'erp_conn_v1',
  jobs: 'erp_jobs_v1',
  cust: 'erp_customers_v1',
  stock: 'erp_stock_v1',
  inv: 'erp_invoices_v1',
  ord: 'erp_quote_orders_v1',
  crm: 'int_crm_v1',
  wh: 'int_wh_v1',
  whd: 'int_whd_v1',
  ak: 'int_ak_v1',
  akl: 'int_akl_v1',
  err: 'int_errs_v1',
  hl: 'int_health_v1',
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const now = () => new Date().toISOString();
const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(arr: T[]) => arr[rand(arr.length)];

async function load<T>(key: string): Promise<T[]> {
   const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) : [];
}
async function save<T>(key: string, list: T[]) { await AsyncStorage.setItem(key, JSON.stringify(list)); }

export const ERP_VENDOR_LABEL: Record<ErpVendor, string> = { logo: 'Logo', mikro: 'Mikro', netsis: 'Netsis', custom: 'Özel' };
export const ERP_VENDOR_COLOR: Record<ErpVendor, string> = { logo: '#ef4444', mikro: '#0ea5e9', netsis: '#22c55e', custom: '#a855f7' };
export const STATUS_LABEL: Record<IntegrationStatus, string> = { connected: 'Bağlı', disconnected: 'Bağlı değil', error: 'Hata', pending: 'Beklemede' };
export const STATUS_COLOR: Record<IntegrationStatus, string> = { connected: '#22c55e', disconnected: '#64748b', error: '#ef4444', pending: '#f59e0b' };
export const ENTITY_LABEL: Record<ErpEntityKind, string> = { customer: 'Cari', stock: 'Stok', invoice: 'Fatura', order: 'Sipariş' };
export const DIRECTION_LABEL: Record<SyncDirection, string> = { pull: 'Çekme', push: 'Gönderme', bidirectional: 'İki yönlü' };
export const CRM_LABEL: Record<CrmProvider, string> = { hubspot: 'HubSpot', salesforce: 'Salesforce', zoho: 'Zoho', pipedrive: 'Pipedrive', custom: 'Özel' };
export const SEVERITY_COLOR = { info: '#0ea5e9', warning: '#f59e0b', error: '#ef4444', critical: '#dc2626' } as const;

// ---------- ERP Connections ----------
async function ensureSeedConn() {
  const list = await load<ErpConnection>(K.conn);
  if (list.length) return list;
  const seed: ErpConnection[] = [];
  await save(K.conn, seed); return seed;
}
export async function listConnections(): Promise<ErpConnection[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function saveConnection(c: Partial<ErpConnection>): Promise<ErpConnection> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function deleteConnection(id: string) { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function testConnection(id: string): Promise<IntegrationStatus> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- ERP Sync Jobs ----------
export async function listSyncJobs(): Promise<ErpSyncJob[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function startSyncJob(connectionId: string, entity: ErpEntityKind, direction: SyncDirection = 'pull'): Promise<ErpSyncJob> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- ERP Customer Mapping ----------
async function ensureSeedCust() {
  const list = await load<ErpCustomerMapping>(K.cust);
  if (list.length) return list;
  const names = ['ABC Soğutma', 'Mavi Tesisat', 'Akın Endüstri', 'Yıldız Otomasyon', 'Demir Bakım', 'Çelik Klima'];
  const seed: ErpCustomerMapping[] = names.map((n, i) => ({
    id: uid(), vendor: pick<ErpVendor>(['logo', 'mikro', 'netsis']),
    externalCode: `CARI-${1000 + i}`, localCustomerId: `cust-${i + 1}`,
    customerName: n, syncedAt: now(),
  }));
  await save(K.cust, seed); return seed;
}
export async function listErpCustomers(): Promise<ErpCustomerMapping[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function resetErpCustomers() { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- ERP Stock Mapping ----------
async function ensureSeedStock() {
  const list = await load<ErpStockMapping>(K.stock);
  if (list.length) return list;
  const items = [
    { sku: 'KMP-01', name: 'Kompresör 5HP', unit: 'adet' },
    { sku: 'GAZ-R32', name: 'Soğutucu R32', unit: 'kg' },
    { sku: 'BAK-1/2', name: 'Bakır Boru 1/2"', unit: 'm' },
    { sku: 'FAN-12', name: 'Fan Motoru 12"', unit: 'adet' },
    { sku: 'FILT-30', name: 'Hava Filtresi 30x30', unit: 'adet' },
  ];
  const seed: ErpStockMapping[] = items.map((it, i) => ({
    id: uid(), vendor: pick<ErpVendor>(['logo', 'mikro', 'netsis']),
    externalCode: `STK-${2000 + i}`, sku: it.sku, name: it.name, unit: it.unit,
    stockQty: 5 + rand(200), unitPrice: 100 + rand(5000), syncedAt: now(),
  }));
  await save(K.stock, seed); return seed;
}
export async function listErpStock(): Promise<ErpStockMapping[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function resetErpStock() { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- Invoice Drafts ----------
export async function listInvoiceDrafts(): Promise<ErpInvoiceDraft[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function createInvoiceDraft(payload: Partial<ErpInvoiceDraft>): Promise<ErpInvoiceDraft> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function sendInvoiceDraft(id: string) { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- Quote → Order ----------
export async function listQuoteOrders(): Promise<QuoteOrderConversion[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function convertQuoteToOrder(quoteId: string, customerName: string, amount: number, vendor: ErpVendor = 'logo'): Promise<QuoteOrderConversion> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- CRM ----------
async function ensureSeedCrm() {
  const list = await load<CrmConnection>(K.crm);
  if (list.length) return list;
  const seed: CrmConnection[] = [];
  await save(K.crm, seed); return seed;
}
export async function listCrmConnections(): Promise<CrmConnection[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function saveCrmConnection(c: Partial<CrmConnection>): Promise<CrmConnection> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function deleteCrmConnection(id: string) { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function importCrmContacts(id: string) { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- Webhooks ----------
const WH_EVENTS = ['quote.created', 'workorder.completed', 'invoice.sent', 'customer.updated', 'payment.received'];
export const WEBHOOK_EVENTS = WH_EVENTS;

async function ensureSeedWh() {
  const list = await load<IntegrationWebhook>(K.wh);
  if (list.length) return list;
  const seed: IntegrationWebhook[] = [];
  await save(K.wh, seed); return seed;
}
export async function listWebhooksV2(): Promise<IntegrationWebhook[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function saveWebhookV2(w: Partial<IntegrationWebhook>): Promise<IntegrationWebhook> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function deleteWebhookV2(id: string) { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function toggleWebhookV2(id: string) { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function triggerWebhookV2(id: string): Promise<WebhookDelivery> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function listWebhookDeliveriesV2(webhookId?: string): Promise<WebhookDelivery[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- API Keys ----------
async function ensureSeedApiKeys() {
  const list = await load<IntegrationApiKey>(K.ak);
  if (list.length) return list;
  const seed: IntegrationApiKey[] = [];
  await save(K.ak, seed); return seed;
}
export async function listApiKeysV2(): Promise<IntegrationApiKey[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function createApiKeyV2(name: string, scopes: string[]): Promise<IntegrationApiKey> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function revokeApiKeyV2(id: string) { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function deleteApiKeyV2(id: string) { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- API Usage Logs ----------
async function ensureSeedApiLogs() {
  const list = await load<ApiUsageLog>(K.akl);
  if (list.length) return list;
  const endpoints = ['/api/quotes', '/api/workorders', '/api/customers', '/api/invoices', '/api/stock'];
  const methods = ['GET', 'POST', 'PUT', 'DELETE'];
  const seed: ApiUsageLog[] = Array.from({ length: 40 }, () => ({
    id: uid(),
    endpoint: pick(endpoints),
    method: pick(methods),
    statusCode: Math.random() > 0.1 ? 200 : pick([400, 401, 404, 500]),
    durationMs: 20 + rand(800),
    ip: `192.168.${rand(255)}.${rand(255)}`,
    occurredAt: new Date(Date.now() - rand(7 * 86400000)).toISOString(),
  }));
  await save(K.akl, seed); return seed;
}
export async function listApiUsageLogs(): Promise<ApiUsageLog[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function resetApiUsageLogs() { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- Integration Errors ----------
async function ensureSeedErrors() {
  const list = await load<IntegrationErrorLog>(K.err);
  if (list.length) return list;
  const sources = ['Logo ERP', 'Mikro ERP', 'HubSpot CRM', 'IntegrationWebhook: Slack', 'Stripe API'];
  const messages = ['Bağlantı zaman aşımı', 'Yetkilendirme hatası', 'Veri formatı hatalı', 'Servis 5xx yanıtladı', 'Hız sınırı aşıldı'];
  const sevs = ['info', 'warning', 'error', 'critical'] as const;
  const seed: IntegrationErrorLog[] = Array.from({ length: 12 }, () => ({
    id: uid(), source: pick([...sources]), message: pick([...messages]),
    severity: pick([...sevs]),
    occurredAt: new Date(Date.now() - rand(14 * 86400000)).toISOString(),
    resolved: Math.random() > 0.5,
  }));
  await save(K.err, seed); return seed;
}
export async function listIntegrationErrors(): Promise<IntegrationErrorLog[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function resolveIntegrationError(id: string) { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function resetIntegrationErrors() { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- Health ----------
export async function listIntegrationHealth(): Promise<IntegrationHealth[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function refreshHealth() { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
