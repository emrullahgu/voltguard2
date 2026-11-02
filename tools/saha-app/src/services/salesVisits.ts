// salesVisits.ts — POZ-DEV-089 Satış ziyaret formu + rakip bilgisi
// Şirket sunucusu + AsyncStorage cache. customerName/salespersonName local-only (not in schema).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SalesVisit, SalesVisitOutcome } from '../types';
import { supabase } from './supabase';

const KEY = '@SahaTakip:sales_visits';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(v?: string | null): string | null { return v && UUID_RE.test(v) ? v : null; }

function rid(): string {
  return 'sv_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function fromRow(r: any, prev?: SalesVisit): SalesVisit {
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: prev?.customerName ?? '',
    visitDate: r.visit_date,
    salespersonId: r.salesperson_id ?? undefined,
    salespersonName: prev?.salespersonName,
    purpose: r.purpose ?? undefined,
    summary: r.summary ?? undefined,
    nextStep: r.next_step ?? undefined,
    nextStepDate: r.next_step_date ?? undefined,
    outcome: r.outcome,
    estimatedAmount: r.estimated_amount == null ? undefined : Number(r.estimated_amount),
    competitor: r.competitor ?? undefined,
    photos: Array.isArray(r.photos) ? r.photos : undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}
function toRow(v: SalesVisit): Record<string, any> {
  const row: Record<string, any> = {
    customer_id: v.customerId,
    visit_date: v.visitDate,
    salesperson_id: uuidOrNull(v.salespersonId),
    purpose: v.purpose ?? null,
    summary: v.summary ?? null,
    next_step: v.nextStep ?? null,
    next_step_date: v.nextStepDate ?? null,
    outcome: v.outcome,
    estimated_amount: v.estimatedAmount ?? null,
    competitor: v.competitor ?? null,
    photos: v.photos ?? null,
  };
  if (UUID_RE.test(v.id)) row.id = v.id;
  return row;
}

async function cachedVisits(): Promise<SalesVisit[]> {
  const raw = await AsyncStorage.getItem(KEY);
  const list = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(list)) throw new Error('Kayıt önbelleği doğrulanamadı. Listeyi yenileyin.');
  return list;
}
export async function listVisits(): Promise<SalesVisit[]> {
  const {data,error} = await supabase.from('sales_visits').select('*').order('visit_date',{ascending:false});
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Sunucu kayıt listesi doğrulanamadı.');
  const previous=new Map((await cachedVisits()).map(item=>[item.id,item]));
  const list=data.map((row:any)=>fromRow(row,previous.get(row.id)));
  await AsyncStorage.setItem(KEY,JSON.stringify(list));
  return list;
}

export async function getVisit(id: string): Promise<SalesVisit | undefined> {
  const all = await listVisits();
  return all.find(v => v.id === id);
}

export async function createVisit(input:Omit<SalesVisit,'id'|'createdAt'>):Promise<SalesVisit> {
  const draft:SalesVisit={...input,id:rid(),visitDate:input.visitDate||new Date().toISOString(),createdAt:new Date().toISOString()};
  const {data,error}=await supabase.from('sales_visits').insert(toRow(draft)).select().single();
  if(error)throw error;
  if(!data?.id)throw new Error('Kayıt sonucu doğrulanamadı. Yeniden göndermeden önce listeyi kontrol edin.');
  const saved=fromRow(data,draft),all=await cachedVisits();
  await AsyncStorage.setItem(KEY,JSON.stringify([saved,...all.filter(item=>item.id!==saved.id)]));
  return saved;
}
export async function updateVisit(id:string,patch:Partial<SalesVisit>):Promise<SalesVisit|undefined> {
  // Use the previously loaded DTO; a fresh server read would silently advance
  // the native CAS revision and overwrite a concurrent employee edit.
  const all=await cachedVisits(),previous=all.find(item=>item.id===id);
  if(!previous)throw new Error('Güncel kayıt yüklenmeli. Listeyi yenileyin.');
  const draft={...previous,...patch,id};
  const {data,error}=await supabase.from('sales_visits').update(toRow(draft)).eq('id',id).select().single();
  if(error)throw error;
  if(!data?.id)throw new Error('Güncelleme sonucu doğrulanamadı. Listeyi kontrol edin.');
  const saved=fromRow(data,draft);
  await AsyncStorage.setItem(KEY,JSON.stringify(all.map(item=>item.id===id?saved:item)));
  return saved;
}
export async function deleteVisit(id:string):Promise<void> {
  const {data,error}=await supabase.from('sales_visits').delete().eq('id',id).select('id');
  if(error)throw error;
  if(!Array.isArray(data)||!data.some(row=>row.id===id))throw new Error('Silme işlemi doğrulanamadı. Listeyi kontrol edin.');
  const all=await cachedVisits();
  await AsyncStorage.setItem(KEY,JSON.stringify(all.filter(item=>item.id!==id)));
}

export async function listByCustomer(customerId: string): Promise<SalesVisit[]> {
  const all = await listVisits();
  return all.filter(v => v.customerId === customerId);
}

export const OUTCOME_LABEL: Record<SalesVisitOutcome, string> = {
  opportunity: 'Fırsat',
  won: 'Kazandı',
  lost: 'Kaybetti',
  follow_up: 'Takip',
  no_interest: 'İlgisiz',
};

export const OUTCOME_COLOR: Record<SalesVisitOutcome, string> = {
  opportunity: '#0ea5e9',
  won: '#16a34a',
  lost: '#dc2626',
  follow_up: '#f59e0b',
  no_interest: '#6b7280',
};
