import { portalRpc } from '../../portal/api';

export interface VisitRecord {
  id: string; user_id: string; customer_id: string; customer_name: string;
  start_at: string; start_lat: number; start_lng: number;
  end_at?: string | null; end_lat?: number | null; end_lng?: number | null;
  status: 'active' | 'completed'; notes?: string; photos?: string[];
}
export interface StoredVisit { visit: VisitRecord | null; revision: number }
async function call(name: string, args: Record<string, any> = {}): Promise<StoredVisit> {
  const result = await portalRpc('app_saha_rpc', { name, args });
  if (!result || !Number.isSafeInteger(result.revision) || result.revision < 0 ||
      (result.visit !== null && (!result.visit?.id || !result.visit?.user_id || result.revision < 1))) {
    throw new Error('Ziyaret kaydının sunucu yanıtı doğrulanamadı. Kayıt listesini yenileyin.');
  }
  return result;
}
export const visitsRepo = {
  active: () => call('visit_active'),
  start: (customerId: string, lat: number, lng: number) => call('visit_check_in', { customer_id: customerId, lat, lng }),
  finish: (id: string, revision: number, lat: number, lng: number, notes = '', photos: string[] = []) =>
    call('visit_check_out', { id, revision, lat, lng, notes, photos }),
};
