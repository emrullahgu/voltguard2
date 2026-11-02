// ====================================================================
// warehouses — POZ-DEV-054, 056
// Depo / araç / personel zimmet noktaları. Şirket sunucusu + AsyncStorage cache.
// ====================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Warehouse, WarehouseKind } from '../types';
import { supabase, SUPABASE_CONFIGURED } from './supabase';

const KEY = '@SahaTakip:warehouses';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(v?: string | null): string | null { return v && UUID_RE.test(v) ? v : null; }

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function fromRow(r: any, serverRevision?: number): Warehouse {
  return {
    id: r.id,
    serverRevision,
    name: r.name ?? '',
    kind: r.kind,
    responsibleId: r.responsible_id ?? undefined,
    responsibleName: r.responsible_name ?? undefined,
    code: r.code ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}
function toRow(w: Warehouse): Record<string, any> {
  const row: Record<string, any> = {
    name: w.name,
    kind: w.kind,
    responsible_id: uuidOrNull(w.responsibleId),
    responsible_name: w.responsibleName ?? null,
    code: w.code ?? null,
    notes: w.notes ?? null,
  };
  if (UUID_RE.test(w.id)) row.id = w.id;
  return row;
}

export async function listWarehouses(): Promise<Warehouse[]> {
  if (SUPABASE_CONFIGURED) {
    try {
      const { data, error, versions } = await supabase
        .from('warehouses')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) {
        const list = data.map((row: any) => fromRow(row, versions?.[row.id]));
        await AsyncStorage.setItem(KEY, JSON.stringify(list));
        return list;
      }
    } catch { /* fallback */ }
  }
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Warehouse[]) : [];
  } catch {
    return [];
  }
}

export async function listByKind(kind: WarehouseKind): Promise<Warehouse[]> {
  const all = await listWarehouses();
  return all.filter(w => w.kind === kind);
}

export async function getWarehouse(id: string): Promise<Warehouse | null> {
  const all = await listWarehouses();
  return all.find(w => w.id === id) ?? null;
}

export async function saveWarehouses(list: Warehouse[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

async function cachedWarehouses(): Promise<Warehouse[]> {
  const raw = await AsyncStorage.getItem(KEY);
  const list = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(list)) throw new Error('Depo önbelleği doğrulanamadı. Listeyi yenileyin.');
  return list;
}
async function cacheConfirmed(list: Warehouse[]) {
  await saveWarehouses(list).catch(() => {});
}
function expectedVersion(id: string, revision?: number) {
  if (!Number.isSafeInteger(revision) || revision! < 1) throw new Error('Depo sürümü eksik. Kaydı yeniden açın.');
  return { [id]: revision! };
}

export async function upsertWarehouse(w: Warehouse) {
  const all = await cachedWarehouses();
  let saved: Warehouse = w;
  if (SUPABASE_CONFIGURED) {
      const { data, error, versions } = await supabase
        .from('warehouses')
        .upsert(toRow(w), { onConflict: 'id' })
        .expectVersions(UUID_RE.test(w.id) ? expectedVersion(w.id, w.serverRevision) : {})
        .select()
        .single();
      if (error) throw error;
      if (!data?.id) throw new Error('Depo kaydı sunucudan doğrulanamadı. Yeniden göndermeden önce listeyi kontrol edin.');
      saved = fromRow(data, versions?.[data.id]);
  }
  const idx = all.findIndex(x => x.id === saved.id || x.id === w.id);
  if (idx >= 0) all[idx] = saved;
  else all.unshift(saved);
  if (SUPABASE_CONFIGURED) await cacheConfirmed(all);
  else await saveWarehouses(all);
}

export async function deleteWarehouse(id: string, serverRevision?: number) {
  const all = await cachedWarehouses();
  if (SUPABASE_CONFIGURED) {
    const revision = serverRevision ?? all.find(w => w.id === id)?.serverRevision;
    const { data, error } = await supabase.from('warehouses').delete().eq('id', id).expectVersions(expectedVersion(id, revision)).select('id');
    if (error) throw error;
    if (!Array.isArray(data) || !data.some((row: any) => row.id === id)) throw new Error('Depo silme işlemi doğrulanamadı. Listeyi yenileyin.');
  }
  const next = all.filter(w => w.id !== id);
  if (SUPABASE_CONFIGURED) await cacheConfirmed(next);
  else await saveWarehouses(next);
}

export function newWarehouse(kind: WarehouseKind = 'depo'): Warehouse {
  return {
    id: uid(),
    name: '',
    kind,
    createdAt: new Date().toISOString(),
  };
}
