import {reportPortalError} from '../portal/api';
// services/parasut.ts — Paraşüt (muhasebe) entegrasyonu, İSTEMCİ tarafı.
// TÜM çağrılar parasut-proxy edge fonksiyonu üzerinden gider; client_id/secret
// İSTEMCİDE TUTULMAZ. Varsayılan SALT-OKUNUR: fatura/cari/ürün/harcama görüntülenir,
// fatura KESİLMEZ (çift kilit: bu istemci toggle'ı + sunucu PARASUT_INVOICING_ENABLED).

import { supabase } from './supabase';

const FN = 'parasut-proxy';
const SETTINGS_KEY = 'parasut_settings';

export interface ParasutSettings {
  enabled: boolean;          // entegrasyon aktif mi (okuma)
  invoicingEnabled: boolean; // fatura kesme (POST) aktif mi — varsayılan false (İŞ KURALI 1)
  offersEnabled: boolean;    // TASLAK teklif (sales_offers POST) aktif mi — faturadan AYRI (İŞ KURALI 2)
  updatedAt?: string;
}

const DEFAULT_SETTINGS: ParasutSettings = { enabled: false, invoicingEnabled: false, offersEnabled: false };

// ── Slim tipler (JSON:API attributes düzleştirilir) ──────────────────────────
export interface ParasutInvoice {
  id: string;
  no?: string;
  date?: string;
  dueDate?: string;
  total?: number;
  remaining?: number;
  status?: string;
  description?: string;
}
export interface ParasutBill {
  id: string;
  date?: string;
  total?: number;
  description?: string;
  status?: string;
}
export interface ParasutProduct {
  id: string;
  name?: string;
  code?: string;
  listPrice?: number;
  vatRate?: number;
  unit?: string;
}
export interface ParasutContact {
  id: string;
  name?: string;
  email?: string;
  taxNumber?: string;
  balance?: number;
}

type Op = 'list' | 'show' | 'create';
interface CallBody {
  resource: 'sales_invoices' | 'sales_offers' | 'purchase_bills' | 'products' | 'contacts';
  op: Op;
  id?: string;
  query?: Record<string, string>;
  payload?: unknown;
}

export interface OfferLineInput { name: string; quantity: number; unitPrice: number; vatRate?: number; }
export interface OfferInput { contactId?: string; description?: string; issueDate?: string; lines: OfferLineInput[]; }

async function call(body: CallBody): Promise<any> {
  const { data, error } = await supabase.functions.invoke(FN, { body });
  if (error) {
    // edge fonksiyonu JSON gövdesinde { error } döndürür; mesajı ortaya çıkar.
    const msg = (error as any)?.context?.error || (error as any)?.message || 'Paraşüt çağrısı başarısız';
    throw new Error(String(msg));
  }
  if (data && typeof data === 'object' && 'error' in data && (data as any).error) {
    throw new Error(String((data as any).error));
  }
  return data;
}

const num = (v: any): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function mapRows<T>(resp: any, mapper: (id: string, a: any) => T): T[] {
  const rows = Array.isArray(resp?.data) ? resp.data : [];
  return rows.map((r: any) => mapper(String(r.id), r.attributes ?? {}));
}

// ── Ayarlar (app_settings 'parasut_settings' — SIR İÇERMEZ, sadece toggle) ────
export async function loadParasutSettings(): Promise<ParasutSettings> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export async function saveParasutSettings(s: Partial<ParasutSettings>): Promise<ParasutSettings> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export async function isParasutEnabled(): Promise<boolean> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ── OKUMA fonksiyonları ──────────────────────────────────────────────────────
export async function listSalesInvoices(query: Record<string, string> = { 'page[size]': '25' }): Promise<ParasutInvoice[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export async function listPurchaseBills(query: Record<string, string> = { 'page[size]': '25' }): Promise<ParasutBill[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

/** Harcamalar = purchase_bills (Paraşüt'te gider faturaları). */
export const listExpenses = listPurchaseBills;

export async function listProducts(query: Record<string, string> = { 'page[size]': '50' }): Promise<ParasutProduct[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export async function listContacts(query: Record<string, string> = { 'page[size]': '50' }): Promise<ParasutContact[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

/** Bağlantı testi — tek kayıt çeker; başarısızsa hata fırlatır. */
export async function testParasutConnection(): Promise<{ ok: boolean; message: string }> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ── YAZMA (fatura kesme) — ÇİFT KİLİT arkasında ──────────────────────────────
export async function createSalesInvoice(payload: unknown): Promise<any> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ── TASLAK TEKLİF (sales_offers) — faturadan AYRI kilit (İŞ KURALI 2) ─────────
// Paraşüt v4 JSON:API teklif gövdesi. NOT: İlk canlı testte alan adlarını Paraşüt
// apidocs'a göre doğrula (sales_offers/sales_offer_details şeması). Çift kilit (bu
// toggle + sunucu PARASUT_OFFERS_ENABLED) açık değilse çağrı sunucuda reddedilir.
export function buildSalesOfferPayload(input: OfferInput): { data: any; included: any[] } {
  const today = input.issueDate || new Date().toISOString().slice(0, 10);
  const included = input.lines.map((l, i) => ({
    type: 'sales_offer_details',
    id: String(i + 1),
    attributes: {
      quantity: l.quantity,
      unit_price: l.unitPrice,
      vat_rate: l.vatRate ?? 20,
      description: l.name,
    },
  }));
  const data: any = {
    type: 'sales_offers',
    attributes: { description: input.description ?? '', issue_date: today, currency: 'TRL' },
    relationships: {
      details: { data: included.map(d => ({ type: 'sales_offer_details', id: d.id })) },
      ...(input.contactId ? { contact: { data: { type: 'contacts', id: input.contactId } } } : {}),
    },
  };
  return { data, included };
}

/** Paraşüt'e TASLAK teklif kaydeder — ASLA fatura. İki kilit: bu toggle + sunucu secret. */
export async function createSalesOffer(input: OfferInput): Promise<any> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
