// ====================================================================
// materials — POZ-DEV-054
// Malzeme/ürün kataloğu. Şirket sunucusu (public.materials) + AsyncStorage cache.
// ====================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Material } from '../types';
import { supabase, SUPABASE_CONFIGURED } from './supabase';
import { auditRepo } from './data/auditRepo';

const KEY = '@SahaTakip:materials';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function fromRow(r: any, serverRevision?: number): Material {
  return {
    id: r.id,
    serverRevision,
    code: r.code ?? '',
    name: r.name ?? '',
    unit: r.unit ?? 'adet',
    price: r.price == null ? undefined : Number(r.price),
    minStock: r.min_stock == null ? undefined : Number(r.min_stock),
    category: r.category ?? undefined,
    barcode: r.barcode ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}

function toRow(m: Material): Record<string, any> {
  const row: Record<string, any> = {
    code: m.code,
    name: m.name,
    unit: m.unit,
    price: m.price ?? null,
    min_stock: m.minStock ?? null,
    category: m.category ?? null,
    barcode: m.barcode ?? null,
    notes: m.notes ?? null,
  };
  if (UUID_RE.test(m.id)) row.id = m.id;
  return row;
}

export async function listMaterials(): Promise<Material[]> {
  if (SUPABASE_CONFIGURED) {
    try {
      const { data, error, versions } = await supabase
        .from('materials')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && data) {
        const list = data.map((row: any) => fromRow(row, versions?.[row.id]));
        await AsyncStorage.setItem(KEY, JSON.stringify(list));
        return list;
      }
    } catch { /* fall through */ }
  }
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Material[]) : [];
  } catch {
    return [];
  }
}

export async function getMaterial(id: string): Promise<Material | null> {
  const all = await listMaterials();
  return all.find(m => m.id === id) ?? null;
}

export async function findByBarcode(code: string): Promise<Material | null> {
  if (!code) return null;
  const all = await listMaterials();
  return all.find(m => m.barcode === code || m.code === code) ?? null;
}

export async function saveMaterials(list: Material[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

async function cachedMaterials(): Promise<Material[]> {
  const raw = await AsyncStorage.getItem(KEY);
  const list = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(list)) throw new Error('Malzeme önbelleği doğrulanamadı. Listeyi yenileyin.');
  return list;
}
async function cacheConfirmed(list: Material[]) {
  await saveMaterials(list).catch(() => {});
}
function expectedVersion(id: string, revision?: number) {
  if (!Number.isSafeInteger(revision) || revision! < 1) throw new Error('Malzeme sürümü eksik. Kaydı yeniden açın.');
  return { [id]: revision! };
}

export async function upsertMaterial(m: Material) {
  const all = await cachedMaterials();
  let saved: Material = m;
  if (SUPABASE_CONFIGURED) {
      const { data, error, versions } = await supabase
        .from('materials')
        .upsert(toRow(m), { onConflict: 'id' })
        .expectVersions(UUID_RE.test(m.id) ? expectedVersion(m.id, m.serverRevision) : {})
        .select()
        .single();
      if (error) throw error;
      if (!data?.id) throw new Error('Malzeme kaydı sunucudan doğrulanamadı. Yeniden göndermeden önce listeyi kontrol edin.');
      saved = fromRow(data, versions?.[data.id]);
  }
  const idx = all.findIndex(x => x.id === saved.id || x.id === m.id);
  if (idx >= 0) all[idx] = saved;
  else all.unshift(saved);
  if (SUPABASE_CONFIGURED) await cacheConfirmed(all);
  else await saveMaterials(all);
  void auditRepo.logCurrent({ action: 'material.upsert', tableName: 'materials', refId: saved.id, meta: { code: saved.code, name: saved.name, price: (saved as any).price ?? (saved as any).unitPrice } });
}

export async function deleteMaterial(id: string, serverRevision?: number) {
  const all = await cachedMaterials();
  if (SUPABASE_CONFIGURED) {
    const revision = serverRevision ?? all.find(m => m.id === id)?.serverRevision;
    const { data, error } = await supabase.from('materials').delete().eq('id', id).expectVersions(expectedVersion(id, revision)).select('id');
    if (error) throw error;
    if (!Array.isArray(data) || !data.some((row: any) => row.id === id)) throw new Error('Malzeme silme işlemi doğrulanamadı. Listeyi yenileyin.');
  }
  const next = all.filter(m => m.id !== id);
  if (SUPABASE_CONFIGURED) await cacheConfirmed(next);
  else await saveMaterials(next);
  void auditRepo.logCurrent({ action: 'material.delete', tableName: 'materials', refId: id });
}

export function newMaterial(): Material {
  return {
    id: uid(),
    code: '',
    name: '',
    unit: 'adet',
    createdAt: new Date().toISOString(),
  };
}
