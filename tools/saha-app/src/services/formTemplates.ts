// ====================================================================
// formTemplates — POZ-DEV-049, 050, 051
// Dinamik form şablonları + seed presets (Denetim, Bakım, Arıza, Montaj, Teslimat).
// ====================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { FormTemplate, FormField, FormTemplateCategory } from '../types';
import { supabase, SUPABASE_CONFIGURED } from './supabase';

const KEY = '@SahaTakip:form_templates';
const SEED_FLAG = '@SahaTakip:form_templates_seeded_v1';

function tplFromRow(r: any, serverRevision?: number): FormTemplate {
  return {
    id: r.id,
    serverRevision,
    name: r.name,
    category: r.category,
    description: r.description || '',
    fields: r.fields || [],
    isSeed: !!r.is_seed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  } as FormTemplate;
}
function tplToRow(t: FormTemplate) {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description || null,
    fields: t.fields || [],
    is_seed: !!t.isSeed,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function nowISO() {
  return new Date().toISOString();
}

// ---------------- SEED ----------------

function field(
  label: string,
  type: FormField['type'],
  extra: Partial<FormField> = {},
): FormField {
  return { id: uid(), label, type, ...extra };
}

function seedTemplates(): FormTemplate[] {
  const t = nowISO();
  return [];
}

// ---------------- CRUD ----------------

export async function listTemplates(): Promise<FormTemplate[]> {
  if (SUPABASE_CONFIGURED) {
    const { data, error, versions } = await supabase.from('form_templates').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Şablon listesi sunucudan doğrulanamadı.');
    const list = data.map((row: any) => tplFromRow(row, versions?.[row.id]));
    await saveTemplates(list).catch(() => {});
    return list;
  }
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as FormTemplate[]) : [];
  } catch {
    return [];
  }
}

export async function listTemplatesByCategory(
  category: FormTemplateCategory,
): Promise<FormTemplate[]> {
  const all = await listTemplates();
  return all.filter(t => t.category === category);
}

export async function getTemplate(id: string): Promise<FormTemplate | null> {
  const all = await listTemplates();
  return all.find(t => t.id === id) ?? null;
}

export async function saveTemplates(list: FormTemplate[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

async function cachedTemplates(): Promise<FormTemplate[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY), list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function expectedVersion(id: string, revision?: number) {
  if (!Number.isSafeInteger(revision) || revision! < 1) throw new Error('Şablon sürümü eksik. Kaydı yeniden açın.');
  return { [id]: revision! };
}
export async function upsertTemplate(tpl: FormTemplate): Promise<FormTemplate> {
  const updated: FormTemplate = { ...tpl, updatedAt: nowISO() };
  let saved = updated;
  if (SUPABASE_CONFIGURED) {
    const existing = tpl.serverRevision !== undefined || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tpl.id);
    const row = tplToRow(updated);
    let query;
    if (existing) query = supabase.from('form_templates').update(row).eq('id', tpl.id).expectVersions(expectedVersion(tpl.id, tpl.serverRevision));
    else { delete (row as any).id; query = supabase.from('form_templates').insert(row).expectVersions({}); }
    const { data, error, versions } = await query.select().single();
    if (error) throw error;
    if (!data?.id || existing && data.id !== tpl.id) throw new Error('Şablon kaydının sonucu doğrulanamadı. Yeniden göndermeden önce listeyi kontrol edin.');
    saved = tplFromRow(data, versions?.[data.id]);
  }
  const all = await cachedTemplates();
  const list = [saved, ...all.filter(x => x.id !== tpl.id && x.id !== saved.id)];
  if (SUPABASE_CONFIGURED) await saveTemplates(list).catch(() => {});
  else await saveTemplates(list);
  return saved;
}

export async function deleteTemplate(id: string, serverRevision?: number) {
  if (SUPABASE_CONFIGURED) {
    const { data, error } = await supabase.from('form_templates').delete().eq('id', id).expectVersions(expectedVersion(id, serverRevision)).select('id');
    if (error) throw error;
    if (!Array.isArray(data) || !data.some((row: any) => row.id === id)) throw new Error('Şablon silme işlemi doğrulanamadı. Listeyi yenileyin.');
  }
  const all = await cachedTemplates();
  if (SUPABASE_CONFIGURED) await saveTemplates(all.filter(t => t.id !== id)).catch(() => {});
  else await saveTemplates(all.filter(t => t.id !== id));
}

export async function ensureSeeded() {
  const flag = await AsyncStorage.getItem(SEED_FLAG).catch(() => null);
  if (flag) return;
  const existing = await listTemplates();
  if (existing.length === 0) {
    const seeded = seedTemplates();
    if (seeded.length > 0) {
      if (SUPABASE_CONFIGURED) {
        try { await supabase.from('form_templates').insert(seeded.map(tplToRow)); } catch { /* offline */ }
      }
      await saveTemplates(seeded);
    }
  }
  await AsyncStorage.setItem(SEED_FLAG, '1').catch(() => {});
}

export function newEmptyTemplate(): FormTemplate {
  const t = nowISO();
  return {
    id: uid(),
    name: '',
    category: 'Diğer',
    description: '',
    fields: [],
    createdAt: t,
    updatedAt: t,
  };
}

export function newField(type: FormField['type'] = 'text'): FormField {
  return {
    id: uid(),
    label: '',
    type,
  };
}
