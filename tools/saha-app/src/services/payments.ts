// payments.ts — POZ-DEV-078, 080
// Tahsilat CRUD + müşteri bakiye hesabı.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
  CustomerBalance,
  Customer,
  WorkOrder,
  Quote,
} from '../types';
import { supabase, SUPABASE_CONFIGURED } from './supabase';
import { auditRepo } from './data/auditRepo';
import { newUuid } from './data/repository';

const KEY = '@SahaTakip:payments';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(v?: string | null): string | null { return v && UUID_RE.test(v) ? v : null; }

function fromRow(r: any, serverRevision?: number): Payment {
  return {
    id: r.id,
    serverRevision,
    customerId: r.customer_id ?? '',
    customerName: r.customer_name ?? '',
    workOrderId: r.work_order_id ?? undefined,
    quoteId: r.quote_id ?? undefined,
    amount: Number(r.amount ?? 0),
    currency: r.currency ?? 'TRY',
    method: r.method,
    status: r.status,
    receivedAt: r.received_at,
    receivedBy: r.received_by_name ?? undefined,
    receivedById: r.received_by ?? undefined,
    receiptNo: r.receipt_no ?? undefined,
    vatRate: r.vat_rate == null ? undefined : Number(r.vat_rate),
    note: r.note ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}
function toRow(p: Payment): Record<string, any> {
  const row: Record<string, any> = {
    customer_id: uuidOrNull(p.customerId),
    customer_name: p.customerName,
    work_order_id: uuidOrNull(p.workOrderId),
    quote_id: uuidOrNull(p.quoteId),
    amount: p.amount,
    currency: p.currency ?? 'TRY',
    method: p.method,
    status: p.status,
    received_at: p.receivedAt,
    received_by: uuidOrNull(p.receivedById),
    received_by_name: p.receivedBy ?? null,
    receipt_no: p.receiptNo ?? null,
    vat_rate: p.vatRate ?? null,
    note: p.note ?? null,
  };
  if (UUID_RE.test(p.id)) row.id = p.id;
  return row;
}

export async function listPayments(): Promise<Payment[]> {
  if (SUPABASE_CONFIGURED) {
      const { data, error, versions } = await supabase
        .from('payments')
        .select('*')
        .order('received_at', { ascending: false });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Tahsilat listesi sunucudan doğrulanamadı.');
      const list = data.map((row: any) => fromRow(row, versions?.[row.id]));
      await cacheConfirmed(list);
      return list;
  }
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Payment[];
  } catch {
    return [];
  }
}

async function saveAll(items: Payment[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}
async function cachedPayments(): Promise<Payment[]> {
  try { const raw=await AsyncStorage.getItem(KEY); const list=raw?JSON.parse(raw):[]; return Array.isArray(list)?list:[]; }
  catch { return []; }
}
async function cacheConfirmed(items: Payment[]) { await saveAll(items).catch(() => {}); }
function expectedVersion(id: string, revision?: number) {
  if (!Number.isSafeInteger(revision) || revision! < 1) throw new Error('Tahsilat kaydının sürümü eksik. Kaydı yeniden açın.');
  return { [id]: revision! };
}
function paymentPatch(id: string, patch: Partial<Payment>) {
  const fields: Record<string,string> = {customerId:'customer_id',customerName:'customer_name',workOrderId:'work_order_id',quoteId:'quote_id',amount:'amount',currency:'currency',method:'method',status:'status',receivedAt:'received_at',receivedById:'received_by',receivedBy:'received_by_name',receiptNo:'receipt_no',vatRate:'vat_rate',note:'note'};
  const mapped=toRow({...patch,id} as Payment);
  return Object.fromEntries(Object.entries(fields).filter(([field])=>Object.prototype.hasOwnProperty.call(patch,field)).map(([,column])=>[column,mapped[column]]));
}

export async function getPayment(id: string): Promise<Payment | null> {
  const all = await listPayments();
  return all.find(p => p.id === id) ?? null;
}

export async function createPayment(
  data: Omit<Payment, 'id' | 'createdAt'> & { id?: string },
): Promise<Payment> {
  const all = await listPayments();
  // A stable-id retry may acknowledge the same payment, but must never rewrite
  // an already committed row while attempting a later, separate cash operation.
  const existing = all.find(p => p.id === data.id);
  let next: Payment = {
    ...data,
    id: data.id ?? newUuid(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    currency: data.currency ?? 'TRY',
    receiptNo: data.receiptNo ?? existing?.receiptNo ?? autoReceiptNo(all),
  };
  if (existing) {
    if (JSON.stringify(toRow(existing)) !== JSON.stringify(toRow(next))) throw new Error('Bu tahsilat daha önce kaydedilmiş ve bilgiler değişmiş. Mevcut kaydı yeniden açın.');
    return existing;
  }
  if (SUPABASE_CONFIGURED) {
    const { data: row, error, versions } = await supabase
      .from('payments')
      .insert(toRow(next))
      .expectVersions({})
      .select()
      .single();
    if (error) throw error;
    if (row?.id !== next.id) throw new Error('Tahsilat kaydının sonucu doğrulanamadı. Yeniden göndermeden önce listeyi kontrol edin.');
    next = fromRow(row, versions?.[row.id]);
  }
  if (SUPABASE_CONFIGURED) await cacheConfirmed([next, ...all.filter(p => p.id !== next.id)]);
  else await saveAll([next, ...all.filter(p => p.id !== next.id)]);
  void auditRepo.logCurrent({ action: 'payment.create', tableName: 'payments', refId: next.id, meta: { amount: next.amount, method: next.method, status: next.status, customerId: next.customerId } });
  return next;
}

export async function updatePayment(
  id: string,
  patch: Partial<Omit<Payment, 'id' | 'createdAt'>>,
): Promise<Payment | null> {
  let updated: Payment | null;
  if (SUPABASE_CONFIGURED) {
    const expected=expectedVersion(id,patch.serverRevision);
    const { data: row, error, versions } = await supabase
      .from('payments')
      .update(paymentPatch(id,patch))
      .eq('id', id)
      .expectVersions(expected)
      .select()
      .single();
    if (error) throw error;
    if (row?.id !== id) throw new Error('Tahsilat güncellemesinin sonucu doğrulanamadı. Listeyi kontrol edin.');
    updated=fromRow(row,versions?.[id]);
    const all=await cachedPayments(); await cacheConfirmed([updated,...all.filter(p=>p.id!==id)]);
  } else {
    const all=await cachedPayments(),previous=all.find(p=>p.id===id);
    if(!previous)throw new Error('Tahsilat kaydı bulunamadı. Listeyi yenileyin.');
    updated={...previous,...patch};await saveAll(all.map(p=>p.id===id?updated!:p));
  }
  if (updated) {
    void auditRepo.logCurrent({ action: 'payment.update', tableName: 'payments', refId: id, meta: { amount: updated.amount, status: updated.status, method: updated.method } });
  }
  return updated;
}

export async function deletePayment(id: string, serverRevision?: number): Promise<void> {
  if (SUPABASE_CONFIGURED) {
    const { data, error } = await supabase.from('payments').delete().eq('id', id).expectVersions(expectedVersion(id,serverRevision)).select('id');
    if (error) throw error;
    if (!Array.isArray(data)||!data.some((row: any)=>row.id===id)) throw new Error('Tahsilat silme işlemi doğrulanamadı. Listeyi yenileyin.');
  }
  const all = await cachedPayments();
  if(SUPABASE_CONFIGURED)await cacheConfirmed(all.filter(p=>p.id!==id));
  else await saveAll(all.filter(p=>p.id!==id));
  void auditRepo.logCurrent({ action: 'payment.delete', tableName: 'payments', refId: id });
}

export async function listByCustomer(customerId: string): Promise<Payment[]> {
  const all = await listPayments();
  return all.filter(p => p.customerId === customerId);
}

export async function listByWorkOrder(workOrderId: string): Promise<Payment[]> {
  const all = await listPayments();
  return all.filter(p => p.workOrderId === workOrderId);
}

export async function listByEmployee(employeeId: string): Promise<Payment[]> {
  const all = await listPayments();
  return all.filter(p => p.receivedById === employeeId);
}

function autoReceiptNo(existing: Payment[]): string {
  const year = new Date().getFullYear();
  const prefix = `MBZ-${year}-`;
  const max = existing
    .map(p => p.receiptNo ?? '')
    .filter(n => n.startsWith(prefix))
    .map(n => parseInt(n.slice(prefix.length), 10))
    .filter(n => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

// ------------- Balance computation -------------

function isInvoicedWO(w: WorkOrder): boolean {
  return w.status === 'Faturalandırıldı' || w.status === 'Tamamlandı';
}

function quoteInvoiced(q: Quote): boolean {
  // Defansif: Quote shape projeye göre değişebilir.
  const status = (q as unknown as { status?: string }).status;
  return status === 'Kabul Edildi' || status === 'Faturalandırıldı';
}

function quoteAmount(q: Quote): number {
  const any = q as unknown as { total?: number; amount?: number; grandTotal?: number };
  return Number(any.total ?? any.amount ?? any.grandTotal ?? 0) || 0;
}

export async function computeCustomerBalances(
  customers: Customer[],
  workOrders: WorkOrder[],
  quotes: Quote[],
): Promise<CustomerBalance[]> {
  const payments = await listPayments();
  return customers.map(c => {
    const wos = workOrders.filter(w => w.client === c.shortName || w.client === c.title);
    const invoicedOrders = wos.filter(isInvoicedWO);
    const woInvoiced = invoicedOrders
      .reduce((s, w) => s + (Number(w.quoteAmount) || 0), 0);

    const cQuotes = quotes.filter(q => {
      const cid = (q as unknown as { customerId?: string }).customerId;
      const cname = (q as unknown as { client?: string; customerName?: string });
      return cid === c.id || cname.client === c.shortName || cname.customerName === c.shortName;
    });
    // A converted quote and its completed/billed order describe one business
    // amount. Only explicit links to this customer's eligible orders deduplicate;
    // independent equal-value jobs and unfinished/missing orders stay separate.
    const invoicedOrderIds = new Set(invoicedOrders.map(w => w.id));
    const convertedQuoteIds = new Set(invoicedOrders.map(w => w.sourceQuoteId).filter(Boolean));
    const qInvoiced = cQuotes.filter(quoteInvoiced)
      .filter(q => !convertedQuoteIds.has(q.id) && !(q.generatedWorkOrderId && invoicedOrderIds.has(q.generatedWorkOrderId)))
      .reduce((s, q) => s + quoteAmount(q), 0);

    const totalInvoiced = woInvoiced + qInvoiced;

    const cPayments = payments.filter(p => p.customerId === c.id);
    const totalReceived = cPayments
      .filter(p => p.status === 'received')
      .reduce((s, p) => s + p.amount, 0);
    const pendingAmount = cPayments
      .filter(p => p.status === 'pending')
      .reduce((s, p) => s + p.amount, 0);

    const lastPaymentAt = cPayments
      .filter(p => p.status === 'received')
      .map(p => p.receivedAt)
      .sort()
      .pop();

    return {
      customerId: c.id,
      customerName: c.shortName,
      totalInvoiced,
      totalReceived,
      pendingAmount,
      balance: totalInvoiced - totalReceived,
      lastPaymentAt,
    } as CustomerBalance;
  });
}

export const PAYMENT_METHODS: { value: PaymentMethod; label: string; icon: string }[] = [
  { value: 'cash', label: 'Nakit', icon: 'cash-outline' },
  { value: 'card', label: 'Kart', icon: 'card-outline' },
  { value: 'transfer', label: 'Havale/EFT', icon: 'swap-horizontal-outline' },
  { value: 'check', label: 'Çek/Senet', icon: 'document-text-outline' },
  { value: 'other', label: 'Diğer', icon: 'ellipsis-horizontal-outline' },
];

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  received: 'Alındı',
  pending: 'Bekliyor',
  cancelled: 'İptal',
  refunded: 'İade',
};
