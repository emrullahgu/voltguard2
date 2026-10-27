import { bootstrapPortal, reportPortalError } from '../portal/api';
// security service — POZ-DEV-105..108
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessRule, AccessRuleKind, BackupRecord, BackupStatus, KvkkConsent, KvkkSettings, TwoFactorSettings } from '../types';

const KEY_KVKK = '@SahaTakip:kvkk';
const KEY_BACKUP = '@SahaTakip:backups';
const KEY_2FA = '@SahaTakip:2fa';
const KEY_ACCESS = '@SahaTakip:access_rules';

const DEFAULT_KVKK_TEXT = `KİŞİSEL VERİLERİN KORUNMASI KANUNU AYDINLATMA METNİ

SahaTakip mobil uygulaması ("Uygulama"), KVKK kapsamında veri sorumlusu sıfatıyla işbu aydınlatma metni ile hangi kişisel verileri, hangi amaçlarla işlediğini açıklar.

1. İşlenen Veriler: Ad-soyad, iletişim bilgileri, konum verileri, müşteri ve iş emri kayıtları.
2. İşleme Amaçları: Saha operasyonlarının yönetimi, iş emri takibi, müşteri ilişkileri, finansal kayıt tutma.
3. Aktarım: Veriler yalnızca yasal yükümlülük halinde yetkili kurumlarla paylaşılır.
4. Saklama Süresi: Yasal yükümlülükler boyunca saklanır, sonra silinir/anonimleştirilir.
5. Haklarınız: KVKK m.11 kapsamında bilgi edinme, düzeltme, silme, itiraz etme haklarına sahipsiniz.

Bu metni kabul ederek, kişisel verilerinizin yukarıdaki amaçlar doğrultusunda işlenmesine onay vermiş olursunuz.`;

function rid(p: string): string { return p + '-' + Math.random().toString(36).slice(2, 10); }

// ---- KVKK ----
export async function getKvkkSettings(): Promise<KvkkSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY_KVKK);
    if (raw) return JSON.parse(raw);
  } catch {}
  const init: KvkkSettings = { currentVersion: 'v1.0', text: DEFAULT_KVKK_TEXT, updatedAt: new Date().toISOString(), consents: [] };
  await AsyncStorage.setItem(KEY_KVKK, JSON.stringify(init));
  return init;
}
export async function updateKvkkText(text: string, version: string): Promise<KvkkSettings> {
  const cur = await getKvkkSettings();
  const next: KvkkSettings = { ...cur, text, currentVersion: version, updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(KEY_KVKK, JSON.stringify(next));
  return next;
}
export async function recordConsent(consent: Omit<KvkkConsent, 'acceptedAt'>): Promise<void> {
  const cur = await getKvkkSettings();
  const next: KvkkSettings = { ...cur, consents: [{ ...consent, acceptedAt: new Date().toISOString() }, ...cur.consents].slice(0, 200) };
  await AsyncStorage.setItem(KEY_KVKK, JSON.stringify(next));
}

// ---- Backup ----
export async function listBackups(): Promise<BackupRecord[]> {
  try { const raw = await AsyncStorage.getItem(KEY_BACKUP); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
async function saveBackups(list: BackupRecord[]): Promise<void> { await AsyncStorage.setItem(KEY_BACKUP, JSON.stringify(list)); }
export async function createBackup(): Promise<BackupRecord> { throw reportPortalError(new Error('Gerçek Ubuntu yedekleme hizmeti yapılandırılmadı. Yedek oluşturulmadı.')); }
export async function markRestored(id: string, notes?: string): Promise<void> { throw reportPortalError(new Error('Gerçek bir sunucu yedeği geri yüklenmedi. Bu işlem sunucu yöneticisi tarafından yürütülmelidir.')); }
export async function deleteBackup(id: string): Promise<void> {
  const list = await listBackups();
  await saveBackups(list.filter(b => b.id !== id));
}

// ---- 2FA TOTP ----
export async function getTwoFactorSettings(): Promise<TwoFactorSettings> { await bootstrapPortal(true); return { enabled: true, backupCodes: [] }; }
export async function startTwoFactorSetup(): Promise<TwoFactorSettings> { throw reportPortalError(new Error('Zorunlu doğrulama mevcut çalışan hesabınız tarafından yönetilir. SahaTakip ikinci bir doğrulama hesabı oluşturmaz.')); }
export async function confirmTwoFactor(code: string): Promise<{ ok: boolean; settings: TwoFactorSettings; error?: string }> { throw reportPortalError(new Error('Doğrulama kodları mevcut çalışan girişinde denetlenir. Bu ekrandan doğrulama değiştirilemez.')); }
export async function disableTwoFactor(): Promise<TwoFactorSettings> { throw reportPortalError(new Error('Çalışan uygulamalarında zorunlu doğrulama kapatılamaz.')); }
export function buildTotpOtpAuthUri(secret: string, account = 'admin', issuer = 'SahaTakip'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}

// ---- Access Rules ----
export async function listAccessRules(): Promise<AccessRule[]> {
  try { const raw = await AsyncStorage.getItem(KEY_ACCESS); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
async function saveAccessRules(list: AccessRule[]): Promise<void> { await AsyncStorage.setItem(KEY_ACCESS, JSON.stringify(list)); }
export async function upsertAccessRule(r: AccessRule): Promise<void> { throw reportPortalError(new Error('Erişim kuralları çalışan yönetimi ve sunucu ayarlarından uygulanır. Bu ekrandan etkin bir kural oluşturulmadı.')); }
export async function deleteAccessRule(id: string): Promise<void> { throw reportPortalError(new Error('Sunucunun erişim kuralları bu ekrandan değiştirilemez.')); }
export function makeAccessRule(input: { kind: AccessRuleKind; value: string; label?: string }): AccessRule {
  return { id: rid('ar'), kind: input.kind, value: input.value.trim(), label: input.label, active: true, createdAt: new Date().toISOString() };
}

export function validateIpRule(value: string): boolean { const v = value.trim(); if (v === '*' || v.toLowerCase() === 'any') return true; const match = /^(\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$/.test(v); if (!match) return false; const [ip, prefix] = v.split('/'); return ip.split('.').every(part => Number(part) <= 255) && (prefix === undefined || Number(prefix) <= 32); }
