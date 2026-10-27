// ====================================================================
// RecurringTasks — POZ-DEV-029
// Periyodik bakım gibi tekrarlayan iş emri şablonları.
// Ubuntu kayıtları kullanılır; zamanı gelen iş emri ve şablon tarihi sunucuda
// aynı işlem içinde kaydedilir.
// ====================================================================

import { RecurringTemplate, WorkOrder } from '../types';
import { supabase } from './supabase';
import { workOrderFromRow } from './data/mappers';

function fromRow(r: any): RecurringTemplate {
  return {
    id: r.id,
    title: r.title ?? '',
    serviceName: r.service_name ?? '',
    client: r.client ?? '',
    priority: r.priority ?? 'Normal',
    intervalDays: Number(r.interval_days ?? 30),
    nextRunDate: r.next_run_date,
    defaultEngineer: r.default_engineer ?? undefined,
    active: r.active !== false,
    notes: r.notes ?? undefined,
  };
}
function toRow(t: RecurringTemplate): Record<string, any> {
  return {
    id: t.id,
    title: t.title,
    service_name: t.serviceName,
    client: t.client,
    priority: t.priority,
    interval_days: t.intervalDays,
    next_run_date: t.nextRunDate,
    default_engineer: t.defaultEngineer ?? null,
    active: t.active,
    notes: t.notes ?? null,
  };
}

export async function listTemplates(): Promise<RecurringTemplate[]> {
  const { data, error } = await supabase.from('recurring_templates').select('*').order('next_run_date', { ascending: true });
  if (error) throw error;
  return (data || []).map(fromRow);
}

export async function saveTemplates(list: RecurringTemplate[]): Promise<void> {
  for (const template of list) await upsertTemplate(template);
}

export async function upsertTemplate(t: RecurringTemplate): Promise<void> {
  const { error } = await supabase.from('recurring_templates').upsert(toRow(t), { onConflict: 'id' });
  if (error) throw error;
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('recurring_templates').delete().eq('id', id);
  if (error) throw error;
}

/**
 * nextRunDate <= bugün olan tüm aktif şablonları çalıştırır,
 * yeni iş emirleri döndürür ve şablonların nextRunDate'ini ileri taşır.
 */
export async function runDueTemplates(): Promise<WorkOrder[]> {
  const { data, error } = await supabase.rpc('run_due_templates');
  if (error) throw error;
  if (!data || !Array.isArray(data.orders)) throw new Error('Periyodik iş emri sonucu doğrulanamadı.');
  return data.orders.map(workOrderFromRow);
}
