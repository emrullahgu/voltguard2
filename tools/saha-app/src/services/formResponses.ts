// ====================================================================
// formResponses — POZ-DEV-052, 053
// Sunucuda doğrulanmış form cevapları; mevcut revizyon görünümü çalışan deposunda tutulur.
// ====================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { FormResponse, FormResponseRevision, FormFieldValue } from '../types';
import { supabase } from './supabase';

const RESP_KEY = '@SahaTakip:form_responses';
const REV_KEY = '@SahaTakip:form_response_revisions';

function respFromRow(r: any): FormResponse {
  return {
    id: r.id,
    templateId: r.template_id,
    templateName: r.template_name,
    workOrderId: r.work_order_id || undefined,
    customerId: r.customer_id || undefined,
    filledBy: r.filled_by || undefined,
    values: r.values || {},
    revision: r.revision ?? 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as FormResponse;
}
function respToRow(r: FormResponse) {
  return {
    id: r.id,
    template_id: r.templateId || null,
    template_name: r.templateName,
    work_order_id: r.workOrderId || null,
    customer_id: r.customerId || null,
    filled_by: r.filledBy || null,
    values: r.values || {},
    revision: r.revision ?? 1,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function nowISO() {
  return new Date().toISOString();
}

// ---------------- RESPONSES ----------------

async function cachedResponses(): Promise<FormResponse[]> {
  const raw=await AsyncStorage.getItem(RESP_KEY);
  const list=raw?JSON.parse(raw):[];
  if(!Array.isArray(list))throw new Error('Form kayıt görünümü doğrulanamadı. Listeyi yenileyin.');
  return list;
}
export async function listResponses(): Promise<FormResponse[]> {
  const {data,error}=await supabase.from('form_responses').select('*').order('updated_at',{ascending:false});
  if(error)throw error;
  if(!Array.isArray(data))throw new Error('Form listesi sunucudan doğrulanamadı.');
  const list=data.map(respFromRow);
  await saveResponses(list);
  return list;
}

export async function listResponsesByWorkOrder(
  workOrderId: string,
): Promise<FormResponse[]> {
  const all = await listResponses();
  return all.filter(r => r.workOrderId === workOrderId);
}

export async function listResponsesByTemplate(
  templateId: string,
): Promise<FormResponse[]> {
  const all = await listResponses();
  return all.filter(r => r.templateId === templateId);
}

export async function getResponse(id: string): Promise<FormResponse | null> {
  const all = await listResponses();
  return all.find(r => r.id === id) ?? null;
}

export async function saveResponses(list: FormResponse[]) {
  await AsyncStorage.setItem(RESP_KEY, JSON.stringify(list));
}

export async function createResponse(input: {
  templateId: string;
  templateName: string;
  workOrderId?: string;
  customerId?: string;
  filledBy?: string;
  values: Record<string, FormFieldValue>;
}): Promise<FormResponse> {
  const all = await cachedResponses();
  const t = nowISO();
  let resp: FormResponse = {
    id: uid(),
    templateId: input.templateId,
    templateName: input.templateName,
    workOrderId: input.workOrderId,
    customerId: input.customerId,
    filledBy: input.filledBy,
    values: input.values,
    revision: 1,
    createdAt: t,
    updatedAt: t,
  };
  const row=respToRow(resp);delete (row as any).id;
  const {data,error}=await supabase.from('form_responses').insert(row).select().single();
  if(error)throw error;
  if(!data?.id)throw new Error('Form kaydının sonucu doğrulanamadı. Yeniden göndermeden önce listeyi kontrol edin.');
  resp=respFromRow(data);

  await saveResponses([resp, ...all]);
  await recordRevision({
    responseId: resp.id,
    revision: 1,
    editedBy: input.filledBy,
    reason: 'İlk kayıt',
    values: input.values,
  });
  return resp;
}

export async function updateResponse(
  responseId: string,
  newValues: Record<string, FormFieldValue>,
  editedBy?: string,
  reason?: string,
): Promise<FormResponse | null> {
  const all = await cachedResponses();
  const idx = all.findIndex(r => r.id === responseId);
  if (idx < 0) throw new Error('Güncel form kaydı yüklenmeli. Listeyi yenileyin.');
  const prev = all[idx];
  const nextRev = (prev.revision ?? 1) + 1;
  const updated: FormResponse = {
    ...prev,
    values: newValues,
    revision: nextRev,
    updatedAt: nowISO(),
  };
  const {data,error}=await supabase.from('form_responses').update({values:newValues,revision:nextRev,updated_at:updated.updatedAt}).eq('id',responseId).select().single();
  if(error)throw error;
  if(!data?.id)throw new Error('Form güncellemesinin sonucu doğrulanamadı. Listeyi kontrol edin.');
  Object.assign(updated,respFromRow(data));

  all[idx] = updated;
  await saveResponses(all);
  await recordRevision({
    responseId,
    revision: nextRev,
    editedBy,
    reason,
    values: newValues,
  });
  return updated;
}

export async function deleteResponse(id:string) {
  const {data,error}=await supabase.from('form_responses').delete().eq('id',id).select('id');
  if(error)throw error;
  if(!Array.isArray(data)||!data.some(row=>row.id===id))throw new Error('Form silme işlemi doğrulanamadı. Listeyi kontrol edin.');
  const all=await cachedResponses();
  await saveResponses(all.filter(item=>item.id!==id));
  const revisions=await listAllRevisions();
  await saveRevisions(revisions.filter(item=>item.responseId!==id));
}

// ---------------- REVISIONS ----------------

// Revizyonları flat liste halinde saklıyoruz; id = `${responseId}::${revNo}`
interface StoredRevision extends FormResponseRevision {
  responseId: string;
}

async function listAllRevisions(): Promise<StoredRevision[]> {
  const raw=await AsyncStorage.getItem(REV_KEY);
  const list=raw?JSON.parse(raw):[];
  if(!Array.isArray(list))throw new Error('Form revizyon görünümü doğrulanamadı.');
  return list;
}

async function saveRevisions(list: StoredRevision[]) {
  await AsyncStorage.setItem(REV_KEY, JSON.stringify(list));
}

export async function listRevisionsByResponse(
  responseId: string,
): Promise<FormResponseRevision[]> {
  const all = await listAllRevisions();
  return all
    .filter(r => r.responseId === responseId)
    .sort((a, b) => b.revision - a.revision)
    .map(({ responseId: _r, ...rest }) => rest);
}

async function recordRevision(input: {
  responseId: string;
  revision: number;
  editedBy?: string;
  reason?: string;
  values: Record<string, FormFieldValue>;
}) {
  const all = await listAllRevisions();
  const rev: StoredRevision = {
    id: `${input.responseId}::${input.revision}`,
    responseId: input.responseId,
    revision: input.revision,
    editedAt: nowISO(),
    editedBy: input.editedBy,
    reason: input.reason,
    values: input.values,
  };
  await saveRevisions([rev, ...all]);
}
