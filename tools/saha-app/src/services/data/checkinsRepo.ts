// Server-confirmed QR/NFC/manual check-ins. A rejected write never opens a job gate.
import { supabase, cacheGet, cacheSet, newUuid } from './repository';
import { bootstrapPortal } from '../../portal/api';

export interface Checkin {
  id?: string; userId: string; customerId?: string | null; siteCode: string;
  method: 'qr' | 'nfc' | 'manual'; lat?: number | null; lng?: number | null;
  workOrderId?: string | null; recordedAt?: string;
}
const CACHE_KEY='checkins:mine';
const fromRow=(r:any):Checkin=>({id:r.id,userId:r.user_id,customerId:r.customer_id,siteCode:r.site_code,
  method:r.method,lat:r.lat!=null?Number(r.lat):null,lng:r.lng!=null?Number(r.lng):null,
  workOrderId:r.work_order_id??null,recordedAt:r.recorded_at});
async function ownUser(expected?:string){
  const id=(await bootstrapPortal()).user.id;
  if(expected&&expected!==id)throw new Error('Konum kaydı yalnız kendi çalışan hesabınız adına yapılabilir.');
  return id;
}
export const checkinsRepo={
  async create(c:Checkin):Promise<Checkin>{
    const id=await ownUser(c.userId);
    const {data,error}=await supabase.from('location_checkins').insert({id:newUuid(),user_id:id,
      customer_id:c.customerId??null,site_code:c.siteCode,method:c.method,lat:c.lat??null,lng:c.lng??null,
      work_order_id:c.workOrderId??null,recorded_at:new Date().toISOString()}).select().single();
    if(error)throw error;
    if(!data?.id)throw new Error('Konum kaydı sunucudan doğrulanamadı.');
    const record=fromRow(data),previous=(await cacheGet<Checkin[]>(CACHE_KEY))??[];
    await cacheSet(CACHE_KEY,[record,...previous].slice(0,50));
    return record;
  },
  async hasRecentCheckin(workOrderId:string,withinMs=2*60*60*1000):Promise<boolean>{
    if(!workOrderId)return false;
    const userId=await ownUser(),now=Date.now();
    const {data,error}=await supabase.from('location_checkins').select('*').eq('user_id',userId)
      .eq('work_order_id',workOrderId).order('recorded_at',{ascending:false}).limit(50);
    if(error)throw error;
    return (data??[]).some((r:any)=>{const elapsed=now-Date.parse(r.recorded_at);return elapsed>=0&&elapsed<=withinMs;});
  },
  async listMine(userId:string,limit=20):Promise<Checkin[]>{
    const id=await ownUser(userId);
    const {data,error}=await supabase.from('location_checkins').select('*').eq('user_id',id)
      .order('recorded_at',{ascending:false}).limit(limit);
    if(error)throw error;
    return (data??[]).map(fromRow);
  },
};
