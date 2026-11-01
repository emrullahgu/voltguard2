// maintenancePlans.ts — POZ-DEV-085 Periyodik bakım planı (önleyici/düzeltici)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coalescePortalRead } from '../portal/coalescedRead';
import { MaintenanceKind, MaintenancePlan } from '../types';
import { supabase, SUPABASE_CONFIGURED } from './supabase';

const KEY = '@SahaTakip:maintenance_plans';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(v?: string | null): string | null { return v && UUID_RE.test(v) ? v : null; }

function planFromRow(r: any, serverRevision?: number): MaintenancePlan {
  return {
    id: r.id,
    serverRevision,
    name: r.name,
    kind: r.kind,
    assetId: r.asset_id || undefined,
    customerId: r.customer_id || undefined,
    frequencyDays: r.frequency_days,
    lastDoneAt: r.last_done_at || undefined,
    nextDueAt: r.next_due_at,
    assignedToId: r.assigned_to || undefined,
    active: r.active !== false,
    notes: r.notes || undefined,
    createdAt: r.created_at,
  } as MaintenancePlan;
}
function planToRow(p: MaintenancePlan) {
  return {
    name: p.name,
    kind: p.kind,
    asset_id: uuidOrNull(p.assetId),
    customer_id: uuidOrNull(p.customerId),
    frequency_days: p.frequencyDays,
    last_done_at: p.lastDoneAt || null,
    next_due_at: p.nextDueAt,
    assigned_to: uuidOrNull(p.assignedToId),
    active: p.active !== false,
    notes: p.notes || null,
    created_at: p.createdAt,
  };
}

function rid(): string {
  return 'mnt_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function listPlans(): Promise<MaintenancePlan[]> {
  return coalescePortalRead(KEY, loadPlans);
}
async function cachedPlans(): Promise<MaintenancePlan[]> {
  const raw = await AsyncStorage.getItem(KEY);
  const list = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(list)) throw new Error('Bakım planı önbelleği doğrulanamadı. Listeyi yenileyin.');
  return list;
}
async function cacheConfirmed(list: MaintenancePlan[]) {
  // Cache maintenance cannot turn an acknowledged business write into a retry.
  // The private transport already publishes any failed cache request to the UI.
  await AsyncStorage.setItem(KEY, JSON.stringify(list)).catch(() => {});
}
function expectedVersion(id: string, revision?: number): Record<string, number> {
  if (!Number.isSafeInteger(revision) || revision! < 1) throw new Error('Bakım planının sürümü eksik. Listeyi yenileyin.');
  return { [id]: revision! };
}
async function loadPlans(): Promise<MaintenancePlan[]> {
  if (!SUPABASE_CONFIGURED) return cachedPlans();
  const { data, error, versions } = await supabase.from('maintenance_plans').select('*').order('next_due_at', { ascending: true });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Sunucu bakım planı listesi doğrulanamadı.');
  const list = data.map((row: any) => planFromRow(row, versions?.[row.id]));
  await cacheConfirmed(list);
  return list;
}

export async function createPlan(
  input: Omit<MaintenancePlan, 'id' | 'createdAt' | 'nextDueAt'> & { nextDueAt?: string },
): Promise<MaintenancePlan> {
  const all = await cachedPlans();
  const now = new Date().toISOString();
  let next: MaintenancePlan = {
    ...input, id: rid(),
    nextDueAt: input.nextDueAt || addDays(now, input.frequencyDays || 30), createdAt: now,
  };
  if (SUPABASE_CONFIGURED) {
    const { data, error, versions } = await supabase.from('maintenance_plans').insert(planToRow(next)).select().single();
    if (error) throw error;
    if (!data?.id) throw new Error('Sunucu bakım planı kaydını doğrulamadı. Tekrar göndermeden önce listeyi kontrol edin.');
    next = planFromRow(data, versions?.[data.id]);
    await cacheConfirmed([next, ...all.filter(plan => plan.id !== next.id)]);
  } else await AsyncStorage.setItem(KEY, JSON.stringify([next, ...all]));
  return next;
}

export async function updatePlan(
  id: string, patch: Partial<MaintenancePlan>, serverRevision?: number,
): Promise<MaintenancePlan | undefined> {
  // Never refresh the table before a mutation: that would replace the token
  // belonging to the displayed record with a colleague's newer revision.
  const all = await cachedPlans();
  const i = all.findIndex(p => p.id === id);
  if (i < 0) throw new Error('Bakım planı yüklenmedi. Listeyi yenileyin.');
  let next = { ...all[i], ...patch, id };
  if (SUPABASE_CONFIGURED) {
    const row: any = planToRow(next); delete row.created_at;
    const { data, error, versions } = await supabase.from('maintenance_plans')
      .update(row).eq('id', id).expectVersions(expectedVersion(id, serverRevision ?? all[i].serverRevision)).select().single();
    if (error) throw error;
    if (!data?.id) throw new Error('Sunucu bakım planı değişikliğini doğrulamadı. Listeyi kontrol edin.');
    next = planFromRow(data, versions?.[data.id]);
  }
  all[i] = next;
  if (SUPABASE_CONFIGURED) await cacheConfirmed(all);
  else await AsyncStorage.setItem(KEY, JSON.stringify(all));
  return next;
}

export async function deletePlan(id: string, serverRevision?: number): Promise<void> {
  const all = await cachedPlans();
  if (SUPABASE_CONFIGURED) {
    const revision = serverRevision ?? all.find(plan => plan.id === id)?.serverRevision;
    const { error } = await supabase.from('maintenance_plans').delete().eq('id', id).expectVersions(expectedVersion(id, revision));
    if (error) throw error;
  }
  const next = all.filter(p => p.id !== id);
  if (SUPABASE_CONFIGURED) await cacheConfirmed(next);
  else await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

// Bakım tamamlandığında nextDueAt'i ileri öteler
export async function markDone(id: string, doneAt?: string, serverRevision?: number): Promise<MaintenancePlan | undefined> {
  const all = await cachedPlans();
  const p = all.find(x => x.id === id);
  if (!p) throw new Error('Bakım planı yüklenmedi. Listeyi yenileyin.');
  const t = doneAt || new Date().toISOString();
  return updatePlan(id, {
    lastDoneAt: t,
    nextDueAt: addDays(t, p.frequencyDays),
  }, serverRevision ?? p.serverRevision);
}

export async function listByAsset(assetId: string): Promise<MaintenancePlan[]> {
  const all = await listPlans();
  return all.filter(p => p.assetId === assetId);
}

export async function dueSoon(days: number = 7): Promise<MaintenancePlan[]> {
  const all = await listPlans();
  const limit = Date.now() + days * 86_400_000;
  return all
    .filter(p => p.active !== false && new Date(p.nextDueAt).getTime() <= limit)
    .sort((a, b) => new Date(a.nextDueAt).getTime() - new Date(b.nextDueAt).getTime());
}

export const MAINTENANCE_KIND_LABEL: Record<MaintenanceKind, string> = {
  preventive: 'Önleyici',
  corrective: 'Düzeltici',
};
