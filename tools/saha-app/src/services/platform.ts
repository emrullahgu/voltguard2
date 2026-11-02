import {reportPortalError} from '../portal/api';
// platform.ts — Faz 40 servis (Çoklu Firma / Modül / Lisans / Bakım)
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Tenant, TenantMember, TenantSetting, AppModule, PackageDefinition,
  LicenseRecord, UsageMetric, DbIndexHint, ArchivePolicy, ArchiveJob,
  PlatformBackup, RestoreTest, SystemHealthCheck, MaintenanceWindow,
  PackagePlan, TenantStatus, SystemHealthStatus,
} from '../types';

const K = {
  tenants: 'pf_tenants_v1', members: 'pf_members_v1', settings: 'pf_settings_v1',
  modules: 'pf_modules_v1', packages: 'pf_packages_v1', licenses: 'pf_licenses_v1',
  usage: 'pf_usage_v1', idx: 'pf_idx_v1', arcPol: 'pf_arcpol_v1', arcJobs: 'pf_arcjobs_v1',
  backups: 'pf_backups_v1', restore: 'pf_restore_v1', health: 'pf_health_v1', maint: 'pf_maint_v1',
  current: 'pf_current_tenant_v1',
};

const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);
async function load<T>(k: string): Promise<T[]> { const r = await AsyncStorage.getItem(k); return r ? JSON.parse(r) : []; }
async function save<T>(k: string, v: T[]) { await AsyncStorage.setItem(k, JSON.stringify(v)); }

export const PLAN_LABEL: Record<PackagePlan, string> = { starter: 'Başlangıç', pro: 'Pro', enterprise: 'Kurumsal' };
export const PLAN_COLOR: Record<PackagePlan, string> = { starter: '#64748b', pro: '#0ea5e9', enterprise: '#a855f7' };
export const TENANT_STATUS_LABEL: Record<TenantStatus, string> = { active: 'Aktif', trial: 'Deneme', suspended: 'Askıda', expired: 'Süresi Doldu' };
export const TENANT_STATUS_COLOR: Record<TenantStatus, string> = { active: '#22c55e', trial: '#0ea5e9', suspended: '#f59e0b', expired: '#ef4444' };
export const HEALTH_COLOR: Record<SystemHealthStatus, string> = { ok: '#22c55e', warn: '#f59e0b', down: '#ef4444' };
export const HEALTH_LABEL: Record<SystemHealthStatus, string> = { ok: 'Sağlıklı', warn: 'Uyarı', down: 'Çökmüş' };
export const COMPONENT_LABEL: Record<SystemHealthCheck['component'], string> = {
  database: 'Veritabanı', storage: 'Depolama', auth: 'Kimlik', jobs: 'Görevler', notifications: 'Bildirim', integrations: 'Entegrasyon',
};

// Tenants
async function seedTenants(): Promise<Tenant[]> { return load<Tenant>(K.tenants); }
export async function listTenants() { return seedTenants(); }
export async function getCurrentTenantId() { return (await AsyncStorage.getItem(K.current)) || 't1'; }
export async function setCurrentTenant(id: string) {
  await AsyncStorage.setItem(K.current, id);
  const list = await load<Tenant>(K.tenants);
  await save(K.tenants, list.map(t => ({ ...t, isCurrent: t.id === id })));
}
export async function saveTenant(t: Partial<Tenant>) {
  const list = await load<Tenant>(K.tenants);
  if (t.id) {
    const idx = list.findIndex(x => x.id === t.id);
    if (idx >= 0) { list[idx] = { ...list[idx], ...t }; await save(K.tenants, list); return list[idx]; }
  }
  const created: Tenant = { id: uid(), name: t.name || 'Yeni Firma', plan: t.plan || 'starter', status: t.status || 'trial', createdAt: now(), memberCount: 1, storageMb: 0, expiresAt: t.expiresAt };
  list.push(created); await save(K.tenants, list); return created;
}
export async function deleteTenant(id: string) {
  const list = await load<Tenant>(K.tenants);
  await save(K.tenants, list.filter(t => t.id !== id));
}

// Members
async function seedMembers(): Promise<TenantMember[]> { return load<TenantMember>(K.members); }
export async function listMembers(tenantId?: string) {
  const all = await seedMembers();
  return tenantId ? all.filter(m => m.tenantId === tenantId) : all;
}
export async function addMember(tenantId: string, email: string, role: TenantMember['role']) {
  const list = await seedMembers();
  list.push({ id: uid(), tenantId, email, role, joinedAt: now() });
  await save(K.members, list);
}
export async function removeMember(id: string) {
  const list = await load<TenantMember>(K.members);
  await save(K.members, list.filter(m => m.id !== id));
}

// Settings
const DEFAULT_SETTING_KEYS = ['currency', 'timezone', 'language', 'invoice_prefix', 'allow_offline_login'];
async function seedSettings(tenantId: string): Promise<TenantSetting[]> {
  const all = await load<TenantSetting>(K.settings);
  if (all.some(s => s.tenantId === tenantId)) return all.filter(s => s.tenantId === tenantId);
  const defaults: TenantSetting[] = DEFAULT_SETTING_KEYS.map(key => ({
    id: uid(), tenantId, key, updatedAt: now(),
    value: key === 'currency' ? 'TRY' : key === 'timezone' ? 'Europe/Istanbul' : key === 'language' ? 'tr' : key === 'invoice_prefix' ? 'INV-' : 'false',
  }));
  await save(K.settings, [...all, ...defaults]);
  return defaults;
}
export async function listSettings(tenantId: string) { return seedSettings(tenantId); }
export async function updateSetting(id: string, value: string) {
  const list = await load<TenantSetting>(K.settings);
  const idx = list.findIndex(s => s.id === id);
  if (idx >= 0) { list[idx] = { ...list[idx], value, updatedAt: now() }; await save(K.settings, list); }
}

// Modules
async function seedModules(): Promise<AppModule[]> { return load<AppModule>(K.modules); }
export async function listModules() { return seedModules(); }
export async function toggleModule(id: string) {
  const list = await load<AppModule>(K.modules);
  const idx = list.findIndex(m => m.id === id);
  if (idx >= 0) { list[idx].enabled = !list[idx].enabled; await save(K.modules, list); }
}

// Packages
export const PACKAGE_DEFINITIONS: PackageDefinition[] = [
  { id: 'starter', name: 'Başlangıç', monthlyPrice: 199, maxUsers: 5, maxStorageMb: 500, modules: ['workorders', 'quotes', 'finance'] },
  { id: 'pro', name: 'Pro', monthlyPrice: 599, maxUsers: 20, maxStorageMb: 5000, modules: ['workorders', 'quotes', 'finance', 'invoicing', 'route_optimization', 'bi', 'webhooks'] },
  { id: 'enterprise', name: 'Kurumsal', monthlyPrice: 1499, maxUsers: 9999, maxStorageMb: 100000, modules: ['workorders', 'quotes', 'finance', 'invoicing', 'route_optimization', 'bi', 'webhooks', 'erp', 'crm', 'multi_tenant'] },
];
export async function getCurrentPackage(): Promise<PackagePlan> {
  const t = (await listTenants()).find(x => x.isCurrent);
  return t?.plan || 'starter';
}

// Licenses
async function seedLicenses(): Promise<LicenseRecord[]> { return load<LicenseRecord>(K.licenses); }
export async function listLicenses() { return seedLicenses(); }

// Usage limits
async function seedUsage(): Promise<UsageMetric[]> { return load<UsageMetric>(K.usage); }
export async function listUsage() { return seedUsage(); }
export const USAGE_LABEL: Record<UsageMetric['metric'], string> = {
  users: 'Kullanıcı', storage_mb: 'Depolama (MB)', api_calls: 'API Çağrısı', workorders: 'İş Emri', sms: 'SMS',
};

// DB Index hints
async function seedIdx(): Promise<DbIndexHint[]> { return load<DbIndexHint>(K.idx); }
export async function listIndexHints() { return seedIdx(); }
export async function applyIndex(id: string) {
  const list = await load<DbIndexHint>(K.idx);
  const idx = list.findIndex(i => i.id === id);
  if (idx >= 0) { list[idx].applied = true; await save(K.idx, list); }
}

// Archive
async function seedArcPol(): Promise<ArchivePolicy[]> { return load<ArchivePolicy>(K.arcPol); }
export async function listArchivePolicies() { return seedArcPol(); }
export async function toggleArchivePolicy(id: string) {
  const list = await load<ArchivePolicy>(K.arcPol);
  const idx = list.findIndex(p => p.id === id);
  if (idx >= 0) { list[idx].active = !list[idx].active; await save(K.arcPol, list); }
}
export async function updateArchiveDays(id: string, days: number) {
  const list = await load<ArchivePolicy>(K.arcPol);
  const idx = list.findIndex(p => p.id === id);
  if (idx >= 0) { list[idx].olderThanDays = days; await save(K.arcPol, list); }
}
export async function runArchiveJob(entity: ArchivePolicy['entity']): Promise<ArchiveJob> { throw reportPortalError(new Error("Bu sunucu yönetimi işlemi henüz yapılandırılmadı. İşlem veya yedek oluşturulmadı.")); }
export async function listArchiveJobs() { return load<ArchiveJob>(K.arcJobs); }
export const ENTITY_LABEL: Record<ArchivePolicy['entity'], string> = {
  workorders: 'İş Emirleri', services: 'Servisler', quotes: 'Teklifler', expenses: 'Giderler', logs: 'Log Kayıtları',
};

// Backups
async function seedBackups(): Promise<PlatformBackup[]> { return load<PlatformBackup>(K.backups); }
export async function listBackups() { return seedBackups(); }
export async function triggerBackup(): Promise<PlatformBackup> { throw reportPortalError(new Error("Bu sunucu yönetimi işlemi henüz yapılandırılmadı. İşlem veya yedek oluşturulmadı.")); }

// Restore tests
async function seedRestore(): Promise<RestoreTest[]> { return load<RestoreTest>(K.restore); }
export async function listRestoreTests() { return seedRestore(); }
export async function runRestoreTest(backupId: string): Promise<RestoreTest> { throw reportPortalError(new Error("Bu sunucu yönetimi işlemi henüz yapılandırılmadı. İşlem veya yedek oluşturulmadı.")); }

// System Health
async function seedHealth(): Promise<SystemHealthCheck[]> { return load<SystemHealthCheck>(K.health); }
export async function listSystemHealth() { return seedHealth(); }
export async function refreshSystemHealth() { throw reportPortalError(new Error("Bu sunucu yönetimi işlemi henüz yapılandırılmadı. İşlem veya yedek oluşturulmadı.")); }

// Maintenance
export async function listMaintenance() { return load<MaintenanceWindow>(K.maint); }
export async function saveMaintenance(m: Partial<MaintenanceWindow>): Promise<MaintenanceWindow> {
  const list = await load<MaintenanceWindow>(K.maint);
  if (m.id) {
    const idx = list.findIndex(x => x.id === m.id);
    if (idx >= 0) { list[idx] = { ...list[idx], ...m }; await save(K.maint, list); return list[idx]; }
  }
  const created: MaintenanceWindow = {
    id: uid(), title: m.title || 'Bakım Penceresi',
    startsAt: m.startsAt || now(),
    endsAt: m.endsAt || new Date(Date.now() + 60 * 60000).toISOString(),
    message: m.message || 'Sistem bakımdadır.',
    active: m.active ?? true, affectsAll: m.affectsAll ?? true,
  };
  list.unshift(created); await save(K.maint, list); return created;
}
export async function toggleMaintenance(id: string) {
  const list = await load<MaintenanceWindow>(K.maint);
  const idx = list.findIndex(m => m.id === id);
  if (idx >= 0) { list[idx].active = !list[idx].active; await save(K.maint, list); }
}
export async function deleteMaintenance(id: string) {
  const list = await load<MaintenanceWindow>(K.maint);
  await save(K.maint, list.filter(m => m.id !== id));
}
