import { bootstrapPortal, transport } from '../portal/api';

export const CONNECTED_DATA_SERVICES = ['epias', 'ipinfo', 'github', 'unsplash', 'tmdb', 'newsapi', 'jsonplaceholder', 'dummyjson'] as const;
export type ConnectedDataService = typeof CONNECTED_DATA_SERVICES[number];
export type ConnectedDataStatus = Record<ConnectedDataService, {
  label: string; configured: boolean; available: boolean; notice: string; private: boolean;
}>;
export type ConnectedDataResult = {
  provider: string; source: { name: string; url: string }; retrievedAt: string; [key: string]: unknown;
};
const endpoint = '/api/integrations.php', api = 'vg-integrations/1';

export async function getConnectedDataStatus(): Promise<ConnectedDataStatus> {
  await bootstrapPortal();
  const data = await transport('status', undefined, endpoint, api, true);
  const status = data?.services;
  for (const service of CONNECTED_DATA_SERVICES) {
    const item = status?.[service];
    if (!item || typeof item.label !== 'string' || typeof item.configured !== 'boolean'
      || typeof item.available !== 'boolean' || typeof item.notice !== 'string' || typeof item.private !== 'boolean') {
      throw new Error('Veri servislerinin bağlantı durumu doğrulanamadı.');
    }
  }
  return status as ConnectedDataStatus;
}

export function connectedDataParams(service: ConnectedDataService, fields: Record<string, string>): Record<string, string> {
  const value = (key: string) => (fields[key] || '').trim();
  if (service === 'epias') {
    const date = value('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
      || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Geçerli bir tarih girin: YYYY-AA-GG.');
    return { date };
  }
  if (service === 'ipinfo') {
    const ip = value('ip');
    if (!ip || ip.length > 45 || !/^[A-Fa-f0-9:.]+$/.test(ip)) throw new Error('Sorgulanacak genel IP adresini girin.');
    return { ip };
  }
  if (service === 'github') {
    const owner = value('owner'), repo = value('repo');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(owner) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(repo)) throw new Error('GitHub depo sahibi ve depo adını girin.');
    return { owner, repo };
  }
  if (service === 'unsplash' || service === 'tmdb' || service === 'newsapi') {
    const q = value('q');
    if (!q || [...q].length > 100 || /[\x00-\x1F\x7F]/.test(q)) throw new Error('En fazla 100 karakterlik arama sözcüğü girin.');
    return { q };
  }
  if (service === 'jsonplaceholder' || service === 'dummyjson') {
    const limit = value('limit');
    if (!/^(?:[5-9]|1[0-9]|20)$/.test(limit)) throw new Error('Örnek kayıt sayısını 5–20 arasında girin.');
    return { limit };
  }
  throw new Error('Geçerli bir veri servisi seçin.');
}

export async function requestConnectedData(service: ConnectedDataService, fields: Record<string, string>): Promise<ConnectedDataResult> {
  if (!CONNECTED_DATA_SERVICES.includes(service)) throw new Error('Geçerli bir veri servisi seçin.');
  const params = connectedDataParams(service, fields);
  await bootstrapPortal();
  const result = await transport(service, undefined, endpoint, api, true, params);
  if (!result || typeof result.provider !== 'string' || typeof result.source?.name !== 'string'
    || typeof result.source?.url !== 'string' || !result.source.url.startsWith('https://')
    || typeof result.retrievedAt !== 'string' || !Number.isFinite(Date.parse(result.retrievedAt))) throw new Error('Veri servisinin yanıtı doğrulanamadı.');
  return result as ConnectedDataResult;
}
