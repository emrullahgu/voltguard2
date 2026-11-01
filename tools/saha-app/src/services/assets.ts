// assets.ts — POZ-DEV-086 Cihaz/ekipman geçmişi (asset tracking)
// Şirket sunucusu + AsyncStorage cache. customerName/siteName local-only.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset, AssetType } from '../types';
import { supabase } from './supabase';
import { auditRepo } from './data/auditRepo';

const KEY = '@SahaTakip:assets';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuidOrNull(v?: string | null): string | null { return v && UUID_RE.test(v) ? v : null; }

function fromRow(r: any, prev?: Partial<Asset>, serverRevision?: number): Asset {
  return {
    id: r.id,
    serverRevision,
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
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(item => item && typeof item.id === 'string') : [];
  } catch { return []; }
}
async function cacheConfirmed(list: Asset[]) {
  // Cache refresh cannot turn an acknowledged server save into a failed save.
  await AsyncStorage.setItem(KEY, JSON.stringify(list)).catch(() => {});
}
function expectedVersion(id: string, revision?: number) {
  if (!Number.isSafeInteger(revision) || revision! < 1) throw new Error('Cihaz kaydının sürümü eksik. Kaydı yeniden açın.');
  return { [id]: revision! };
}
function patchRow(id: string, patch: Partial<Asset>) {
  const fields: Record<string,string> = { code:'code',name:'name',type:'type',customerId:'customer_id',siteId:'site_id',serialNo:'serial_no',manufacturer:'manufacturer',model:'model',power:'power',installDate:'install_date',warrantyEnd:'warranty_end',location:'location',notes:'notes' };
  const mapped = toRow({ ...patch, id } as Asset);
  return Object.fromEntries(Object.entries(fields).filter(([field]) => Object.prototype.hasOwnProperty.call(patch, field)).map(([,column]) => [column, mapped[column]]));
}
export async function listAssets(): Promise<Asset[]> {
  const {data,error,versions} = await supabase.from('assets').select('*').order('created_at',{ascending:false});
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Sunucu kayıt listesi doğrulanamadı.');
  const previous=new Map((await cachedAssets()).map(item=>[item.id,item]));
  const list=data.map((row:any)=>fromRow(row,previous.get(row.id),versions?.[row.id]));
  await cacheConfirmed(list);
  return list;
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  const all = await listAssets();
  return all.find(a => a.id === id);
}

export async function createAsset(input:Omit<Asset,'id'|'createdAt'>):Promise<Asset> {
  const draft:Asset={...input,id:rid(),createdAt:new Date().toISOString()};
  const {data,error,versions}=await supabase.from('assets').insert(toRow(draft)).expectVersions({}).select().single();
  if(error)throw error;
  if(!data?.id)throw new Error('Kayıt sonucu doğrulanamadı. Yeniden göndermeden önce listeyi kontrol edin.');
  const saved=fromRow(data,draft,versions?.[data.id]),all=await cachedAssets();
  await cacheConfirmed([saved,...all.filter(item=>item.id!==saved.id)]);
  void auditRepo.logCurrent({action:'asset.create',tableName:'assets',refId:saved.id,meta:{type:saved.type,name:saved.name}});
  return saved;
}
export async function updateAsset(id:string,patch:Partial<Asset>):Promise<Asset|undefined> {
  // The editor's version belongs to its visible DTO, never a later global read.
  const versionsExpected=expectedVersion(id,patch.serverRevision);
  const {data,error,versions}=await supabase.from('assets').update(patchRow(id,patch)).eq('id',id).expectVersions(versionsExpected).select().single();
  if(error)throw error;
  if(data?.id!==id)throw new Error('Güncelleme sonucu doğrulanamadı. Listeyi kontrol edin.');
  const all=await cachedAssets(),previous=all.find(item=>item.id===id);
  const saved=fromRow(data,{...previous,...patch},versions?.[data.id]);
  await cacheConfirmed([saved,...all.filter(item=>item.id!==id)]);
  void auditRepo.logCurrent({action:'asset.update',tableName:'assets',refId:id});
  return saved;
}
export async function deleteAsset(id:string,serverRevision?:number):Promise<void> {
  const {data,error}=await supabase.from('assets').delete().eq('id',id).expectVersions(expectedVersion(id,serverRevision)).select('id');
  if(error)throw error;
  if(!Array.isArray(data)||!data.some(row=>row.id===id))throw new Error('Silme işlemi doğrulanamadı. Listeyi kontrol edin.');
  const all=await cachedAssets();
  await cacheConfirmed(all.filter(item=>item.id!==id));
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
