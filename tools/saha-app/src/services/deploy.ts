// Faz 51 — Deploy & Platform servisi (dep_*_v1)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bootstrapPortal } from '../portal/api';
import type {
  DepEnvVar, DepSupabaseConfig, DepRlsPolicy, DepStorageBucket,
  DepNetlifyDeploy, DepBuildError, DepAiProvider, DepAiRateLimit,
  DepAiRequestLog, DepApkBuild, DepCheckStatus,
} from '../types';

const K = {
  env: 'dep_env_v1',
  sb: 'dep_sb_v1',
  rls: 'dep_rls_v1',
  storage: 'dep_storage_v1',
  netlify: 'dep_netlify_v1',
  errors: 'dep_errors_v1',
  ai: 'dep_ai_v1',
  rl: 'dep_rl_v1',
  ailog: 'dep_ailog_v1',
  apk: 'dep_apk_v1',
};

export const DEP_STATUS_LABEL: Record<DepCheckStatus, string> = { ok: 'Hazır', warn: 'Uyarı', fail: 'Hata', pending: 'Beklemede' };
export const DEP_STATUS_COLOR: Record<DepCheckStatus, string> = { ok: '#22c55e', warn: '#f59e0b', fail: '#ef4444', pending: '#64748b' };
export const DEP_STATUS_ICON: Record<DepCheckStatus, string> = { ok: 'checkmark-circle', warn: 'warning', fail: 'close-circle', pending: 'time' };

async function getOrSeed<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (raw) return JSON.parse(raw) as T;
  // Sahte/seed veri yok — diziler boş döner, nesneler fallback olarak verilir.
  return Array.isArray(fallback) ? (([] as unknown) as T) : fallback;
}


// --- Env vars
export async function listDepEnvVars(): Promise<DepEnvVar[]> {
  return getOrSeed<DepEnvVar[]>(K.env, []);
}

// --- Şirket sunucusu config
export async function getDepSupabase(): Promise<DepSupabaseConfig> {
  await bootstrapPortal(true);
  return {
    projectUrl: `${window.location.origin}/api/company.php`,
    anonKeySet: false, serviceRoleSet: false,
    region: 'Şirket Ubuntu sunucusu',
    dbSize: 'Ölçülmedi', monthlyEgress: 'Ölçülmedi',
    authProviders: ['VoltGuard çalışan hesabı', 'İki adımlı doğrulama'],
    status: 'ok',
  };
}

// --- RLS
export async function listDepRls(): Promise<DepRlsPolicy[]> {
  return getOrSeed<DepRlsPolicy[]>(K.rls, []);
}

// --- Storage buckets
export async function listDepStorage(): Promise<DepStorageBucket[]> {
  return getOrSeed<DepStorageBucket[]>(K.storage, []);
}

// --- Netlify
export async function listDepNetlify(): Promise<DepNetlifyDeploy[]> {
  return getOrSeed<DepNetlifyDeploy[]>(K.netlify, []);
}

// --- Build errors
export async function listDepErrors(): Promise<DepBuildError[]> {
  return getOrSeed<DepBuildError[]>(K.errors, []);
}

export async function toggleErrorFixed(id: string): Promise<void> {
  const list = await listDepErrors();
  const next = list.map(b => b.id === id ? { ...b, fixed: !b.fixed } : b);
  await AsyncStorage.setItem(K.errors, JSON.stringify(next));
}

// --- AI providers
export async function listDepAiProviders(): Promise<DepAiProvider[]> {
  return getOrSeed<DepAiProvider[]>(K.ai, []);
}

// --- AI security
export async function listDepRateLimits(): Promise<DepAiRateLimit[]> {
  return getOrSeed<DepAiRateLimit[]>(K.rl, []);
}

export async function listDepAiLogs(): Promise<DepAiRequestLog[]> {
  return getOrSeed<DepAiRequestLog[]>(K.ailog, []);
}

// --- APK builds
export async function listDepApkBuilds(): Promise<DepApkBuild[]> {
  return getOrSeed<DepApkBuild[]>(K.apk, []);
}
