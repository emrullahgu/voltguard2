/* Legacy source interface backed by the employee PHP API; no remote SDK/Auth. */
import { bootstrapPortal, portalRpc, logoutPortal, onPortalReset, reportPortalError } from './api';
export const SUPABASE_CONFIGURED = true;
const revisions: Record<string, Record<string, number>> = Object.create(null);
const listeners = new Set<Function>();
const channels = new Set<any>();
onPortalReset(() => { for (const key of Object.keys(revisions)) delete revisions[key]; for (const channel of channels) channel.unsubscribe(); for (const callback of listeners) callback('SIGNED_OUT', null); });
function unavailable(service = 'Bu hizmet'): never { throw reportPortalError(Object.assign(new Error(`${service} şirket sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.`), { code: 'service_unavailable' })); }
class NativeQuery implements PromiseLike<any> {
  private args: any;
  private promise: Promise<any> | null = null;
  private rejectErrors=false;
  constructor(table: string) { this.args = { table, operation: 'select', select: '*', filters: [], order: [], returning: true }; }
  select(columns = '*', options: any = {}) { this.args.select = columns; this.args.returning = true; if (options.count) this.args.count = options.count; if (options.head) this.args.head = true; return this; }
  insert(rows: any, options: any = {}) { this.args.operation = 'insert'; this.args.rows = Array.isArray(rows) ? rows : [rows]; this.args.returning = false; Object.assign(this.args, options); return this; }
  update(row: any) { this.args.operation = 'update'; this.args.rows = row; this.args.returning = false; return this; }
  upsert(rows: any, options: any = {}) { this.args.operation = 'upsert'; this.args.rows = Array.isArray(rows) ? rows : [rows]; this.args.onConflict = options.onConflict; this.args.returning = false; return this; }
  delete() { this.args.operation = 'delete'; this.args.returning = false; return this; }
  filter(field: string, op: string, value: any) { this.args.filters.push({ op, field, value }); return this; }
  eq(field: string, value: any) { return this.filter(field, 'eq', value); }
  neq(field: string, value: any) { return this.filter(field, 'neq', value); }
  gt(field: string, value: any) { return this.filter(field, 'gt', value); }
  gte(field: string, value: any) { return this.filter(field, 'gte', value); }
  lt(field: string, value: any) { return this.filter(field, 'lt', value); }
  lte(field: string, value: any) { return this.filter(field, 'lte', value); }
  is(field: string, value: any) { return this.filter(field, 'is', value); }
  in(field: string, value: any[]) { return this.filter(field, 'in', value); }
  like(field: string, value: any) { return this.filter(field, 'like', value); }
  ilike(field: string, value: any) { return this.filter(field, 'ilike', value); }
  contains(field: string, value: any) { return this.filter(field, 'contains', value); }
  overlaps(field: string, value: any) { return this.filter(field, 'overlaps', value); }
  match(values: any) { for (const [key, value] of Object.entries(values)) this.eq(key, value); return this; }
  not(field: string, operator: string, value: any) { return this.filter(field, 'not', { op: operator, value }); }
  or(value: string) { return this.filter('', 'or', value); }
  order(field: string, options: any = {}) { this.args.order.push({ field, ascending: options.ascending !== false, nullsFirst: options.nullsFirst }); return this; }
  limit(value: number) { this.args.limit = value; return this; }
  range(from: number, to: number) { this.args.range = [from, to]; return this; }
  single() { this.args.single = 'one'; return this; }
  maybeSingle() { this.args.single = 'maybe'; return this; }
  abortSignal(_signal: AbortSignal) { return this; }
  throwOnError() { this.rejectErrors=true;return this; }
  private async execute() {
    const args = { ...this.args, versions: { ...(revisions[this.args.table] || {}) } };
    const result: any = await portalRpc('app_saha_query', args);
    for (const [table, versions] of Object.entries(result.tableVersions || {})) revisions[table] = { ...(revisions[table] || {}), ...(versions as any) };
    revisions[args.table] = { ...(revisions[args.table] || {}), ...(result.versions || {}) };
    return { data: result.data ?? null, count: result.count ?? null, error: null, status: 200, statusText: 'OK' };
  }
  then<TResult1 = any, TResult2 = never>(resolve?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> {
    if (!this.promise) this.promise = this.execute().catch(error=>{if(this.rejectErrors)throw error;return {data:null,count:null,error,status:error.status||500,statusText:'Error'};});
    return this.promise.then(resolve, reject);
  }
}
function nativeChannel(_name: string) {
  const handlers: any[] = []; let timer: any = null; let stopped = false; let busy = false;
  const snapshots = new Map<string, Map<string, any>>();
  const channel: any = {
    on(event: string, filter: any, callback: Function) { if (event !== 'postgres_changes') unavailable('Canlı yayın türü'); handlers.push({ filter, callback }); return channel; },
    subscribe(callback?: Function) {
      const poll = async () => {
        if (stopped || busy || document.visibilityState === 'hidden') return; busy = true;
        try {
          for (const handler of handlers) {
            const table = handler.filter.table; if (!table) continue;
            const query = new NativeQuery(table).select('*').limit(500);
            const filter = handler.filter.filter || '';
            if (filter) {
              const match = /^([A-Za-z_][A-Za-z0-9_]*)=(eq|neq|is)\.(.+)$/.exec(filter);
              if (!match) throw new Error('Canlı kayıt filtresi desteklenmiyor.');
              query[match[2] as 'eq'|'neq'|'is'](match[1], match[3] === 'null' ? null : match[3]);
            }
            const { data, error } = await query;
            if (error) throw error;
            const rows = new Map<string, any>((Array.isArray(data) ? data : []).map((row: any) => [row.id, row]));
            const snapshotKey = table + '|' + filter;
            const previous = snapshots.get(snapshotKey);
            if (previous) {
              for (const [id, row] of rows) {
                const old = previous.get(id); const eventType = old ? 'UPDATE' : 'INSERT';
                if ((!old || JSON.stringify(old) !== JSON.stringify(row)) && (handler.filter.event === '*' || handler.filter.event === eventType)) handler.callback({ eventType, new: row, old: old || {}, table });
              }
              if (rows.size < 500) for (const [id, old] of previous) if (!rows.has(id) && (handler.filter.event === '*' || handler.filter.event === 'DELETE')) handler.callback({ eventType: 'DELETE', new: {}, old, table });
            }
            snapshots.set(snapshotKey, rows);
          }
          callback?.('SUBSCRIBED');
        } catch (error) { callback?.('CHANNEL_ERROR', error); } finally { busy = false; }
      };
      void poll(); timer = setInterval(poll, 20000); channels.add(channel); return channel;
    },
    async unsubscribe() { stopped = true; if (timer) clearInterval(timer); channels.delete(channel); snapshots.clear(); return 'ok'; },
    send() { return unavailable('Canlı yayın gönderimi'); },
  }; return channel;
}
function storageBucket(bucket: string) {
  const assetUrl = (path: string) => `/api/saha-asset.php?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
  return {
    async upload(path: string, input: any, options: any = {}) {
      const buffer = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input instanceof ArrayBuffer ? new Uint8Array(input) : input instanceof Uint8Array ? input : null;
      if (!buffer) throw reportPortalError(new Error('Dosya yükleme biçimi desteklenmiyor.'));
      if (buffer.byteLength > 1024 * 1024) throw reportPortalError(new Error('Dosya 1 MB sınırını aşıyor. Yükleme yapılmadı.'));
      let binary = ''; for (let i = 0; i < buffer.length; i += 8192) binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
      const data = await portalRpc('app_saha_storage', { operation: 'upload', bucket, path, base64: btoa(binary), contentType: options.contentType || input.type || 'application/octet-stream', upsert: options.upsert === true });
      return { data, error: null };
    },
    getPublicUrl(path: string) { return { data: { publicUrl: assetUrl(path) } }; },
    async createSignedUrl(path: string, _seconds = 3600) { return { data: await portalRpc('app_saha_storage', { operation: 'url', bucket, path }), error: null }; },
    async download(path: string) {
      try {
        await bootstrapPortal();
        const response = await fetch(assetUrl(path), { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('Özel dosya indirilemedi. Erişim yetkinizi ve dosyayı kontrol edin.');
        const type = response.headers.get('Content-Type') || '';
        if (type.includes('text/html') || type.includes('application/json')) throw new Error('Dosya yanıtı doğrulanamadı.');
        return { data: await response.blob(), error: null };
      } catch (error) { reportPortalError(error); return { data: null, error }; }
    },
    async remove(paths: string[]) { return { data: await portalRpc('app_saha_storage', { operation: 'remove', bucket, paths }), error: null }; },
    async list(path = '') { return { data: await portalRpc('app_saha_storage', { operation: 'list', bucket, path }), error: null }; },
  };
}
export const supabase: any = {
  from: (table: string) => new NativeQuery(table),
  async rpc(name: string, args: any = {}) {
    try {
      const data = await portalRpc('app_saha_rpc', { name, args });
      for (const [table, versions] of Object.entries(data?.tableVersions || {})) revisions[table] = { ...(revisions[table] || {}), ...(versions as Record<string,number>) };
      return { data, error: null };
    } catch(error) { return {data:null,error}; }
  },
  functions: { async invoke(name: string, options: any = {}) {
    try {
      const identity = await bootstrapPortal();
      if (identity.capabilities?.externalServices !== true) return { data: null, error: Object.assign(new Error('Harici bildirim ve servis bağlantıları henüz yapılandırılmadı. Gönderim yapılmadı.'), { code: 'service_unavailable' }) };
      return { data: await portalRpc('app_saha_function', { name, body: options.body || {} }), error: null };
    } catch(error) { return {data:null,error}; }
  } },
  storage: { from: storageBucket }, channel: nativeChannel,
  async removeChannel(channel: any) { return channel.unsubscribe(); },
  async removeAllChannels() { return Promise.all([...channels].map(channel => channel.unsubscribe())); },
  auth: {
    async getUser() { const data = await bootstrapPortal(); return { data: { user: data.user }, error: null }; },
    async getSession() { const data = await bootstrapPortal(); return { data: { session: { user: data.user } }, error: null }; },
    onAuthStateChange(callback: Function) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
    async signOut() { await logoutPortal(); return { error: null }; },
    signInWithPassword() { return unavailable('Giriş işlemi'); }, signUp() { return unavailable('Hesap oluşturma'); },
    resetPasswordForEmail() { return unavailable('Şifre sıfırlama'); }, updateUser() { return unavailable('Kimlik bilgisi değişikliği'); }, setSession() { return unavailable('İstemciden oturum atama'); },
    mfa: { listFactors() { return unavailable('MFA ayarı'); }, enroll() { return unavailable('MFA ayarı'); }, unenroll() { return unavailable('MFA ayarı'); }, challengeAndVerify() { return unavailable('MFA doğrulaması'); } },
  },
};
export const getAuthRedirectUrl = () => '/calisan/giris.html';
export async function signIn() { return unavailable('Giriş işlemi'); }
export async function signUp() { return unavailable('Hesap oluşturma'); }
export async function signOut() { return supabase.auth.signOut(); }
export async function getCurrentUser() { return (await bootstrapPortal()).user; }
export const db = {
  quotes: { list: () => supabase.from('quotes').select('*, quote_lines(*)'), insert: (row: any) => supabase.from('quotes').insert(row).select().single(), update: (id: string, row: any) => supabase.from('quotes').update(row).eq('id', id), delete: (id: string) => supabase.from('quotes').delete().eq('id', id) },
  customers: { list: () => supabase.from('customers').select('*'), insert: (row: any) => supabase.from('customers').insert(row).select().single(), update: (id: string, row: any) => supabase.from('customers').update(row).eq('id', id) },
  workOrders: { list: () => supabase.from('work_orders').select('*, work_order_materials(*)'), insert: (row: any) => supabase.from('work_orders').insert(row).select().single(), update: (id: string, row: any) => supabase.from('work_orders').update(row).eq('id', id) },
  employees: { list: () => supabase.from('employees').select('*') },
};
