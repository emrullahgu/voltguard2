// ====================================================================
// vehicleLogs — POZ-DEV-061
// Km / yakıt / bakım / muayene / sigorta kayıtları.
// ====================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { VehicleLog, VehicleLogKind } from '../types';
import { getVehicle, upsertVehicle } from './vehicles';
import { supabase, SUPABASE_CONFIGURED } from './supabase';

const KEY = '@SahaTakip:vehicle_logs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fromRow(r: any, serverRevision?: number): VehicleLog {
  return {
    id: r.id,
    serverRevision,
    vehicleId: r.vehicle_id,
    kind: r.kind,
    km: r.km == null ? undefined : Number(r.km),
    liters: r.liters == null ? undefined : Number(r.liters),
    unitPrice: r.unit_price == null ? undefined : Number(r.unit_price),
    totalCost: r.total_cost == null ? undefined : Number(r.total_cost),
    serviceType: r.service_type ?? undefined,
    dueAt: r.due_at ?? undefined,
    note: r.note ?? undefined,
    performedBy: r.performed_by ?? undefined,
    receiptUri: r.receipt_uri ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}
function toRow(l: VehicleLog): Record<string, any> {
  const row: Record<string, any> = {
    vehicle_id: l.vehicleId,
    kind: l.kind,
    km: l.km ?? null,
    liters: l.liters ?? null,
    unit_price: l.unitPrice ?? null,
    total_cost: l.totalCost ?? null,
    service_type: l.serviceType ?? null,
    due_at: l.dueAt ?? null,
    note: l.note ?? null,
    performed_by: l.performedBy ?? null,
  };
  // receipt_uri yalnızca değer varsa eklenir — kolon migration'ı uygulanmadan
  // önce fişsiz kayıtların buluta yazılması bozulmasın.
  if (l.receiptUri) row.receipt_uri = l.receiptUri;
  return row;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function listLogs(): Promise<VehicleLog[]> {
  if (SUPABASE_CONFIGURED) {
      const { data, error, versions } = await supabase
        .from('vehicle_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Araç kayıtları sunucudan doğrulanamadı.');
      const list = data.map((row: any) => fromRow(row, versions?.[row.id]));
      await cacheConfirmed(list);
      return list;
  }
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as VehicleLog[]) : [];
  } catch {
    return [];
  }
}

export async function listLogsByVehicle(vehicleId: string): Promise<VehicleLog[]> {
  const all = await listLogs();
  return all
    .filter(l => l.vehicleId === vehicleId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function listLogsByKind(kind: VehicleLogKind): Promise<VehicleLog[]> {
  const all = await listLogs();
  return all.filter(l => l.kind === kind);
}

export async function getLog(id: string): Promise<VehicleLog | null> {
  const all = await listLogs();
  return all.find(l => l.id === id) ?? null;
}

async function saveAll(list: VehicleLog[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}
async function cachedLogs(): Promise<VehicleLog[]> {
  try { const raw=await AsyncStorage.getItem(KEY),list=raw?JSON.parse(raw):[];return Array.isArray(list)?list:[]; }
  catch { return []; }
}
async function cacheConfirmed(list: VehicleLog[]) { await saveAll(list).catch(() => {}); }
function expectedVersion(id: string, revision?: number) {
  if (!Number.isSafeInteger(revision)||revision!<1) throw new Error('Araç kaydının sürümü eksik. Kaydı yeniden açın.');
  return {[id]:revision!};
}

export async function addLog(input: Omit<VehicleLog, 'id' | 'createdAt'>): Promise<VehicleLog> {
  let log: VehicleLog = {
    id: uid(),
    createdAt: new Date().toISOString(),
    ...input,
  };
  if (SUPABASE_CONFIGURED) {
      if (!UUID_RE.test(input.vehicleId)) throw new Error('Geçerli bir araç kaydı seçin.');
      const { data, error, versions } = await supabase.from('vehicle_logs').insert(toRow(log)).expectVersions({}).select().single();
      if (error) throw error;
      if (!data?.id) throw new Error('Araç kaydı sunucudan doğrulanamadı. Yeniden göndermeden önce listeyi kontrol edin.');
      log=fromRow(data,versions?.[data.id]);
  }
  const all = await cachedLogs();
  if (SUPABASE_CONFIGURED) await cacheConfirmed([log,...all.filter(item=>item.id!==log.id)]);
  else await saveAll([log,...all.filter(item=>item.id!==log.id)]);

  // The log is already durable. A separate derived vehicle update must not
  // make its caller retry this primary insert and create a duplicate log.
  if (typeof input.km !== 'number' && !((input.kind==='inspection'||input.kind==='insurance')&&input.dueAt)) return log;
  try {
  const v = await getVehicle(input.vehicleId);
  if (!v) throw new Error('Araç bulunamadı.');
  {
    let updated = false;
    const next = { ...v };
    if (typeof input.km === 'number' && (!v.kmTotal || input.km > v.kmTotal)) {
      next.kmTotal = input.km;
      updated = true;
    }
    if (input.kind === 'inspection' && input.dueAt) {
      next.inspectionDueAt = input.dueAt;
      updated = true;
    }
    if (input.kind === 'insurance' && input.dueAt) {
      next.insuranceDueAt = input.dueAt;
      updated = true;
    }
    if (updated) await upsertVehicle(next);
  }
  } catch {
    log={...log,vehicleSyncWarning:'Kayıt kaydedildi ancak araç kilometre/vade bilgileri güncellenemedi. Araç bilgilerini ayrıca kontrol edin; bu kaydı yeniden eklemeyin.'};
  }

  return log;
}

export async function updateLog(log: VehicleLog): Promise<VehicleLog> {
  let saved=log;
  if (SUPABASE_CONFIGURED) {
    const {data,error,versions}=await supabase.from('vehicle_logs').update(toRow(log)).eq('id',log.id).expectVersions(expectedVersion(log.id,log.serverRevision)).select().single();
    if(error)throw error;
    if(data?.id!==log.id)throw new Error('Araç kaydı güncellemesi doğrulanamadı. Listeyi kontrol edin.');
    saved=fromRow(data,versions?.[data.id]);
  }
  const all = await cachedLogs(),next=[saved,...all.filter(item=>item.id!==saved.id)];
  if(SUPABASE_CONFIGURED)await cacheConfirmed(next);else await saveAll(next);
  return saved;
}

export async function deleteLog(id: string, serverRevision?: number) {
  if (SUPABASE_CONFIGURED) {
    const {data,error}=await supabase.from('vehicle_logs').delete().eq('id',id).expectVersions(expectedVersion(id,serverRevision)).select('id');
    if(error)throw error;
    if(!Array.isArray(data)||!data.some((row: any)=>row.id===id))throw new Error('Araç kaydı silme işlemi doğrulanamadı. Listeyi yenileyin.');
  }
  const all = await cachedLogs();
  if(SUPABASE_CONFIGURED)await cacheConfirmed(all.filter(l=>l.id!==id));else await saveAll(all.filter(l=>l.id!==id));
}

// Yakıt verimliliği özeti (vehicleId için)
export interface FuelSummary {
  totalLiters: number;
  totalCost: number;
  totalKm: number;
  avgConsumption: number; // L / 100km
}

export async function fuelSummary(vehicleId: string): Promise<FuelSummary> {
  const logs = (await listLogsByVehicle(vehicleId)).filter(l => l.kind === 'fuel');
  const totalLiters = logs.reduce((s, l) => s + (l.liters ?? 0), 0);
  const totalCost = logs.reduce((s, l) => s + (l.totalCost ?? 0), 0);
  const kms = logs.map(l => l.km ?? 0).filter(k => k > 0).sort((a, b) => a - b);
  const totalKm = kms.length >= 2 ? kms[kms.length - 1] - kms[0] : 0;
  const avgConsumption = totalKm > 0 ? (totalLiters / totalKm) * 100 : 0;
  return { totalLiters, totalCost, totalKm, avgConsumption };
}
