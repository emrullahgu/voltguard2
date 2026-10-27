// ====================================================================
// formTemplates — POZ-DEV-049, 050, 051
// Dinamik form şablonları + seed presets (Denetim, Bakım, Arıza, Montaj, Teslimat).
// ====================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { FormTemplate, FormField, FormTemplateCategory } from '../types';
import { supabase, SUPABASE_CONFIGURED } from './supabase';

const KEY = '@SahaTakip:form_templates';
const SEED_FLAG = '@SahaTakip:form_templates_seeded_v1';

function tplFromRow(r: any): FormTemplate {
  return {
    id: r.id,
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
    try {
      const { data, error } = await supabase.from('form_templates').select('*').order('updated_at', { ascending: false });
      if (!error && data) {
        const list = data.map(tplFromRow);
        await AsyncStorage.setItem(KEY, JSON.stringify(list));
        return list;
      }
    } catch { /* fallback */ }
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

export async function upsertTemplate(tpl: FormTemplate) {
  const updated: FormTemplate = { ...tpl, updatedAt: nowISO() };
  if (SUPABASE_CONFIGURED) {
    try { await supabase.from('form_templates').upsert(tplToRow(updated)); } catch { /* offline */ }
  }
  const all = await listTemplates();
  const idx = all.findIndex(x => x.id === tpl.id);
  if (idx >= 0) all[idx] = updated;
  else all.unshift(updated);
  await saveTemplates(all);
}

export async function deleteTemplate(id: string) {
  if (SUPABASE_CONFIGURED) {
    try { await supabase.from('form_templates').delete().eq('id', id); } catch { /* offline */ }
  }
  const all = await listTemplates();
  await saveTemplates(all.filter(t => t.id !== id));
}

export async function ensureSeeded() {
  const flag = await AsyncStorage.getItem(SEED_FLAG);
  if (flag) return;
  const existing = await listTemplates();
  if (existing.length === 0) {
    const seeded = seedTemplates();
    if (SUPABASE_CONFIGURED) {
      try { await supabase.from('form_templates').insert(seeded.map(tplToRow)); } catch { /* offline */ }
    }
    await saveTemplates(seeded);
  }
  await AsyncStorage.setItem(SEED_FLAG, '1');
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
