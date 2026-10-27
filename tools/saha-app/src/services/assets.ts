// assets.ts — POZ-DEV-086 Cihaz/ekipman geçmişi (asset tracking)
// Şirket sunucusu + AsyncStorage cache. customerName/siteName local-only.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset, AssetType } from '../types';
import { supabase } from './supabase';
import { auditRepo } from './data/auditRepo';

const KEY = '@SahaTakip:assets';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(v?: string | null): string | null { return v && UUID_RE.test(v) ? v : null; }

function fromRow(r: any, prev?: Asset): Asset {
  return {
    id: r.id,
    code: r.code ?? undefined,
    name: r.name ?? '',
    type: r.type,
    customerId: r.customer_id ?? undefined,
    customerName: prev?.customerName,
    siteId: r.site_id ?? undefined,
    siteName: prev?.siteName,
    serialNo: r.serial_no ?? undefined,
    manufacturer: r.manufacturer ?? undefined,
    model: r.model ?? undefined,
    power: r.power ?? undefined,
    installDate: r.install_date ?? undefined,
    warrantyEnd: r.warranty_end ?? undefined,
    location: r.location ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
  };
}
function toRow(a: Asset): Record<string, any> {
  const row: Record<string, any> = {
    code: a.code ?? null,
    name: a.name,
    type: a.type,
    customer_id: uuidOrNull(a.customerId),
    site_id: uuidOrNull(a.siteId),
    serial_no: a.serialNo ?? null,
    manufacturer: a.manufacturer ?? null,
    model: a.model ?? null,
    power: a.power ?? null,
    install_date: a.installDate ?? null,
    warranty_end: a.warrantyEnd ?? null,
    location: a.location ?? null,
    notes: a.notes ?? null,
  };
  if (UUID_RE.test(a.id)) row.id = a.id;
  return row;
}

function rid(): string {
  return 'asset_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

async function cachedAssets(): Promise<Asset[]> {
  const raw = await AsyncStorage.getItem(KEY);
  const list = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(list)) throw new Error('Kayıt önbelleği doğrulanamadı. Listeyi yenileyin.');
  return list;
}
export async function listAssets(): Promise<Asset[]> {
  const {data,error} = await supabase.from('assets').select('*').order('created_at',{ascending:false});
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Sunucu kayıt listesi doğrulanamadı.');
  const previous=new Map((await cachedAssets()).map(item=>[item.id,item]));
  const list=data.map((row:any)=>fromRow(row,previous.get(row.id)));
  await AsyncStorage.setItem(KEY,JSON.stringify(list));
  return list;
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  const all = await listAssets();
  return all.find(a => a.id === id);
}

export async function createAsset(input:Omit<Asset,'id'|'createdAt'>):Promise<Asset> {
  const draft:Asset={...input,id:rid(),createdAt:new Date().toISOString()};
  const {data,error}=await supabase.from('assets').insert(toRow(draft)).select().single();
  if(error)throw error;
  if(!data?.id)throw new Error('Kayıt sonucu doğrulanamadı. Yeniden göndermeden önce listeyi kontrol edin.');
  const saved=fromRow(data,draft),all=await cachedAssets();
  await AsyncStorage.setItem(KEY,JSON.stringify([saved,...all.filter(item=>item.id!==saved.id)]));
  void auditRepo.logCurrent({action:'asset.create',tableName:'assets',refId:saved.id,meta:{type:saved.type,name:saved.name}});
  return saved;
}
export async function updateAsset(id:string,patch:Partial<Asset>):Promise<Asset|undefined> {
  // Use the previously loaded DTO; a fresh server read would silently advance
  // the native CAS revision and overwrite a concurrent employee edit.
  const all=await cachedAssets(),previous=all.find(item=>item.id===id);
  if(!previous)throw new Error('Güncel kayıt yüklenmeli. Listeyi yenileyin.');
  const draft={...previous,...patch,id};
  const {data,error}=await supabase.from('assets').update(toRow(draft)).eq('id',id).select().single();
  if(error)throw error;
  if(!data?.id)throw new Error('Güncelleme sonucu doğrulanamadı. Listeyi kontrol edin.');
  const saved=fromRow(data,draft);
  await AsyncStorage.setItem(KEY,JSON.stringify(all.map(item=>item.id===id?saved:item)));
  void auditRepo.logCurrent({action:'asset.update',tableName:'assets',refId:id});
  return saved;
}
export async function deleteAsset(id:string):Promise<void> {
  const {data,error}=await supabase.from('assets').delete().eq('id',id).select('id');
  if(error)throw error;
  if(!Array.isArray(data)||!data.some(row=>row.id===id))throw new Error('Silme işlemi doğrulanamadı. Listeyi kontrol edin.');
  const all=await cachedAssets();
  await AsyncStorage.setItem(KEY,JSON.stringify(all.filter(item=>item.id!==id)));
  void auditRepo.logCurrent({action:'asset.delete',tableName:'assets',refId:id});
}

export async function listByCustomer(customerId: string): Promise<Asset[]> {
  const all = await listAssets();
  return all.filter(a => a.customerId === customerId);
}

export async function findByCode(code: string): Promise<Asset | undefined> {
  const all = await listAssets();
  return all.find(a => a.code === code);
}

export const ASSET_TYPES: { value: AssetType; label: string; icon: string }[] = [
  { value: 'meter', label: 'Sayaç', icon: 'speedometer-outline' },
  { value: 'panel', label: 'Pano', icon: 'grid-outline' },
  { value: 'transformer', label: 'Trafo', icon: 'flash-outline' },
  { value: 'ges_inverter', label: 'GES Inverter', icon: 'sunny-outline' },
  { value: 'ges_panel', label: 'GES Panel', icon: 'sunny-outline' },
  { value: 'compensation', label: 'Kompanzasyon', icon: 'pulse-outline' },
  { value: 'machine', label: 'Makine', icon: 'cog-outline' },
  { value: 'other', label: 'Diğer', icon: 'cube-outline' },
];

export const ASSET_TYPE_LABEL: Record<AssetType, string> = ASSET_TYPES.reduce(
  (acc, t) => { acc[t.value] = t.label; return acc; },
  {} as Record<AssetType, string>,
);
