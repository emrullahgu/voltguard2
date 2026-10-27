import {reportPortalError} from '../portal/api';
// services/ai.ts — POZ-DEV-090..092 AI core (OpenAI/Claude/mock)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { AiProvider, AiSettings, DamageAnalysis, DamageSeverity, PozSuggestion, VoiceReport } from '../types';
import { POZ_CATALOG, PozItem } from '../data/pozCatalog';
import { supabase, SUPABASE_CONFIGURED } from './supabase';
import { recordAiCall } from './aiTelemetry';

const SETTINGS_KEY = '@SahaTakip:ai_settings';
const SETTINGS_REMOTE_KEY = 'ai_settings'; // app_settings.key
const VOICE_KEY = '@SahaTakip:voice_reports';

const DEFAULT_MODEL: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  claude: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-2.5-flash',
  groq: 'llama-3.3-70b-versatile',
  mock: 'mock',
};

/**
 * Eski/emekliye ayrılmış Claude model adlarını çalışan güncel modele yükseltir.
 * (Gemini 1.5→2.5 yükseltmesinin Claude karşılığı.) Anthropic, claude-2/instant ve
 * ilk claude-3 (sonnet/opus/haiku 2024-02/03) modellerini emekliye ayırıyor;
 * bunlar 404 verir. Boş/bilinmeyen de güvenli varsayılana düşer.
 */
export function normalizeClaudeModel(m?: string): string {
  const s = (m || '').trim();
  if (!s) return DEFAULT_MODEL.claude;
  // Emekli/eski aileler → güncel sonnet
  if (/^claude-(2|instant|1)/i.test(s)) return DEFAULT_MODEL.claude;
  if (/^claude-3-(sonnet|opus|haiku)-202(40229|40307|403)/i.test(s)) return DEFAULT_MODEL.claude;
  return s;
}

// Sağlayıcı isteklerinde varsayılan zaman aşımı. Mobil ağlarda asılı kalan bir
// fetch sonsuza dek "yükleniyor" gösterip ekranı kilitliyordu; AbortController ile
// belirli süre sonra iptal edilir. Mesaj "timeout" içerir → isTransientAiError
// bunu yakalayıp diğer sağlayıcıya/denemeye geçer.
export const AI_TIMEOUT_MS = 45000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = AI_TIMEOUT_MS,
): Promise<Response> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// Sağlayıcı kartına tıklandığında otomatik dolduracağımız built-in anahtarlar —
// Önce Şirket sunucusu'den indirilmiş `ai_settings.keys` map'i, yoksa .env fallback.
export function getBuiltinKey(p: AiProvider): string | undefined {
  // Yalnızca ÇALIŞMA ZAMANINDA gelen anahtarlar: admin'in Ayarlar'dan girdiği ve
  // `app_settings.ai_settings.keys` üzerinden senkronlanan map (_cachedRemoteKeys;
  // syncRemoteAiSettings her giriş yapan kullanıcı için doldurur).
  // GÜVENLİK: .env (EXPO_PUBLIC_*_KEY) fallback'i KALDIRILDI — o değişkenler web/APK
  // bundle'ına derlenip kolayca çıkarılabiliyordu (kritik sızıntı). Anahtarlar artık
  // bundle'a girmez; sunucuda (ai-proxy/ai-tools/ai-vision edge env) ya da admin'in
  // çalışma-zamanı girişinde tutulur.
  const map = _cachedRemoteKeys;
  if (map && map[p]) return map[p];
  return undefined;
}

let _cachedRemoteKeys: Partial<Record<AiProvider, string>> | null = null;

/** Sağlayıcı anahtarlarını çalışma-zamanı bellek önbelleğine yükler (replace).
 *  Anahtarlar yalnızca güvenli çalışma-zamanı kaynağından (Şirket sunucusu app_settings)
 *  gelir; client bundle'ına derlenmez. fetchRemoteAiSettings ve testler kullanır. */
export function primeRemoteAiKeys(map: Partial<Record<AiProvider, string>> | null): void {
  _cachedRemoteKeys = map ? { ...map } : null;
}

// Remote (Şirket sunucusu) → tüm kullanıcılar tarafından paylaşılan ayarları çek.
// Admin bir kere yazar, herkes okur. RLS bunu zorunlu kılar.
async function fetchRemoteAiSettings(): Promise<AiSettings | null> {
  if (!SUPABASE_CONFIGURED) return null;
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', SETTINGS_REMOTE_KEY)
      .maybeSingle();
    if (error || !data?.value) return null;
    const v = data.value as AiSettings & { keys?: Partial<Record<AiProvider, string>> };
    // `keys` map'ini cache'e al — sağlayıcı değiştirildiğinde UI doğru anahtarı bulur.
    if (v?.keys && typeof v.keys === 'object') {
      primeRemoteAiKeys(v.keys);
    }
    if (v?.provider && v.provider !== 'mock' && v.apiKey) return v;
    return null;
  } catch {
    return null;
  }
}

async function pushRemoteAiSettings(s: AiSettings): Promise<void> {
  if (!SUPABASE_CONFIGURED) return;
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes?.user?.id ?? null;
    await supabase
      .from('app_settings')
      .upsert({ key: SETTINGS_REMOTE_KEY, value: s, updated_by: uid, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  } catch {
    // RLS reddi (non-admin) sessizce geçilir — yerel kayıt yine de yapılır.
  }
}

let _settingsCache: { value: AiSettings; at: number } | null = null;
const SETTINGS_TTL_MS = 30000;
/** Ayar bellek önbelleğini temizler (setAiSettings veya admin değişikliği sonrası). */
export function clearAiSettingsCache(): void { _settingsCache = null; }

export async function getAiSettings(): Promise<AiSettings> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

async function resolveAiSettings(): Promise<AiSettings> {
  // 0) Proxy modu: anahtar cihazda gerekmez. Üst katman gate'leri (provider!=='mock'
  //    && apiKey) geçsin diye yapılandırılmış-görünen sentinel döndür; gerçek anahtar
  //    sunucuda. chat() shouldUseProxy() görünce zaten proxy'ye yönlenir.
  if (shouldUseProxy()) {
    const envProv = (process.env.EXPO_PUBLIC_AI_DEFAULT_PROVIDER || 'openai').toLowerCase() as AiProvider;
    const provider: AiProvider = envProv === 'claude' || envProv === 'gemini' ? envProv : 'openai';
    return { provider, apiKey: PROXY_SENTINEL, model: DEFAULT_MODEL[provider] };
  }

  // 1) Yerel cache (en hızlı)
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AiSettings;
      if (parsed.provider && parsed.provider !== 'mock' && parsed.apiKey) return parsed;
    }
  } catch { /* ignore */ }

  // 2) Şirket sunucusu paylaşımlı ayar (admin'in yazdığı, herkes okuyabilir)
  const remote = await fetchRemoteAiSettings();
  if (remote) {
    try { await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(remote)); } catch { /* ignore */ }
    return remote;
  }

  // 3) Anahtar yok → demo (mock).
  // GÜVENLİK: .env (EXPO_PUBLIC_*_KEY) fallback'i KALDIRILDI — bundle'a gömülen
  // anahtar sızıntısını kapatır. Üretimde metin için proxy (yukarıda) tercih edilir;
  // ajan/görsel için admin Ayarlar ekranından anahtar girer (cihazda AsyncStorage)
  // veya app_settings üzerinden senkronlanır.
  return { provider: 'mock' };
}

export async function setAiSettings(s: AiSettings): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

/** Uygulama açılışında çağrılır — remote ayarları cache'e indirip non-admin kullanıcıların hemen kullanmasını sağlar. */
export async function syncRemoteAiSettings(): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI (ChatGPT)',
  claude: 'Anthropic (Claude)',
  gemini: 'Google (Gemini)',
  groq: 'Groq (Llama 3.3 70B — ücretsiz, hızlı)',
  mock: 'Demo (yerel)',
};

// Tek seferlik bağlantı testi — UI'daki "Test" butonu için.
export async function pingAi(s: AiSettings): Promise<{ ok: boolean; message: string; sample?: string }> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- Sunucu-tarafı proxy (güvenlik) ----------
// EXPO_PUBLIC_AI_USE_PROXY=true iken metin AI çağrıları cihazdan API anahtarı
// GÖNDERMEDEN supabase/functions/ai-proxy üzerinden yapılır (anahtarlar sunucu
// ortam değişkeninde: OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY).
// Varsayılan KAPALI → mevcut doğrudan-çağrı davranışı korunur (geriye dönük uyumlu).
export const PROXY_SENTINEL = 'via-proxy';

export function shouldUseProxy(): boolean {
  const v = (process.env.EXPO_PUBLIC_AI_USE_PROXY || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/** ai-proxy edge function'ı üzerinden metin tamamlama (anahtar cihaza inmez). */
export async function chatViaProxy(
  prompt: string,
  systemPrompt: string | undefined,
  provider: AiProvider | 'auto',
): Promise<string> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- Provider-agnostic chat call ----------
export async function chat(prompt: string, settings: AiSettings, systemPrompt?: string): Promise<string> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- Görsel (vision) çağrısı — çoklu sağlayıcı ----------
// Vision destekleyen sağlayıcılar. Groq'un varsayılan metin modeli görsel almaz.
export function isVisionCapable(p: AiProvider): boolean {
  return p === 'openai' || p === 'gemini' || p === 'claude';
}

export interface VisionImage {
  base64: string;
  mimeType?: string; // varsayılan image/jpeg
}

/** Dosya uzantısından MIME tipini tahmin eder (vision için). */
export function guessImageMime(uri: string): string {
  const u = uri.toLowerCase();
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.heic') || u.endsWith('.heif')) return 'image/heic';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/**
 * Görsel + metin promptu ile çok-sağlayıcılı analiz.
 * OpenAI, Gemini ve Claude'un vision API'lerini tek arayüzde toplar.
 * (Önceden yalnızca OpenAI destekleniyordu; Gemini/Claude anahtarı olan
 *  kullanıcılar mock sonuç alıyordu — bu eksik giderildi.)
 */
export async function chatVision(
  prompt: string,
  image: VisionImage,
  settings: AiSettings,
  systemPrompt?: string,
): Promise<string> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- Çoklu sağlayıcı otomatik fallback ----------
// Tercih sırası: Claude (birincil) → OpenAI/ChatGPT → Gemini (Google) → Groq.
// Yapılandırılmış birincil sağlayıcı çalışmazsa bu sırayla anahtarı olana geçilir.
// Aktif/seçili olan her zaman önce denenir.
export const PROVIDER_PRIORITY: AiProvider[] = ['claude', 'openai', 'gemini', 'groq'];
const FALLBACK_ORDER: AiProvider[] = PROVIDER_PRIORITY;

export async function chatWithFallback(
  prompt: string,
  primary: AiSettings,
  systemPrompt?: string,
): Promise<{ reply: string; usedProvider: AiProvider; usedModel?: string; attempts: { provider: AiProvider; error?: string }[] }> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- POZ-DEV-090: Smart POZ suggestion ----------
const TR_LOWER = (s: string) => s.toLocaleLowerCase('tr-TR');

function scoreByKeywords(query: string, p: PozItem): number {
  const q = TR_LOWER(query);
  const tokens = q.split(/[\s,;./()-]+/).filter(t => t.length >= 3);
  if (tokens.length === 0) return 0;
  const hay = TR_LOWER(`${p.name} ${p.description || ''} ${p.category}`);
  let hits = 0;
  let partial = 0;
  for (const t of tokens) {
    if (hay.includes(t)) hits++;
    else if (t.length >= 4 && hay.includes(t.slice(0, 4))) partial++;
  }
  const ratio = (hits + partial * 0.5) / tokens.length;
  return Math.round(ratio * 100);
}

export async function suggestPozFromDescription(description: string): Promise<PozSuggestion[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- Teklif keşif notu → ayrı iş kalemleri (miktar + birim) ----------
export interface SurveyLineItem {
  description: string; // tek bir iş tanımı
  quantity: number;    // adet/miktar (belirtilmemişse 1)
  unit?: string;       // Adet | Mt | m² | Kg | Saat ...
}

/**
 * Bir keşif/saha notunu ayrı ayrı iş kalemlerine böler. Tek bir blok yerine
 * her kalemi tek tek POZ ile eşleştirebilmek için kullanılır. AI yoksa veya
 * başarısız olursa satır/cümle bazlı yerel ayrıştırmaya düşer.
 */
export async function decomposeSurveyToItems(surveyText: string): Promise<SurveyLineItem[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- POZ-DEV-091: Photo damage analysis ----------
function mockAnalyze(context?: string): DamageAnalysis {
  const lc = TR_LOWER(context || '');
  let severity: DamageSeverity = 'medium';
  let findings = ['Görsel ön inceleme tamamlandı'];
  let recs = ['Yerinde detaylı inceleme önerilir'];
  let cost = 1500;
  if (lc.includes('yangin') || lc.includes('yanık') || lc.includes('kısa devre')) {
    severity = 'critical';
    findings = ['Yanık izi tespit edildi', 'İzolasyon bozulmuş olabilir', 'Bağlantı noktaları renk değiştirmiş'];
    recs = ['ACİL: enerjiyi kesin', 'Yetkili teknisyen gönderin', 'Yangın söndürücü hazır bulundurun'];
    cost = 8500;
  } else if (lc.includes('akıntı') || lc.includes('su') || lc.includes('nem')) {
    severity = 'high';
    findings = ['Nem/su izleri tespit edildi', 'Korozyon başlangıcı görülüyor'];
    recs = ['Sızıntı kaynağını kapatın', 'Etkilenen bileşenleri değiştirin', 'Topraklama kontrolü yapın'];
    cost = 4200;
  } else if (lc.includes('eski') || lc.includes('aşınma')) {
    severity = 'low';
    findings = ['Genel aşınma görülüyor', 'Fonksiyonel'];
    recs = ['Periyodik bakım planına alın'];
    cost = 800;
  }
  return {
    severity,
    findings,
    recommendations: recs,
    estimatedCost: cost,
    confidence: 72,
    analyzedAt: new Date().toISOString(),
    source: 'demo',
  };
}

/** Seçili sağlayıcı vision yapamıyorsa, anahtarı olan vision-yetenekli ilk
 *  sağlayıcıya geçer (openai → gemini → claude). Hiçbiri yoksa null döner. */
export function pickVisionSettings(primary: AiSettings): AiSettings | null {
  if (isVisionCapable(primary.provider) && primary.apiKey) return primary;
  for (const p of ['openai', 'gemini', 'claude'] as AiProvider[]) {
    const key = getBuiltinKey(p);
    if (key) return { provider: p, apiKey: key, model: DEFAULT_MODEL[p] };
  }
  return null;
}

/** PDF/belge okumak için: yalnız Gemini ve Claude inline PDF destekler (OpenAI
 *  chat/completions PDF almaz). Önce mevcut sağlayıcı uygunsa onu, değilse
 *  anahtarı olan gemini → claude'u seçer. */
export function pickDocSettings(primary: AiSettings): AiSettings | null {
  if ((primary.provider === 'gemini' || primary.provider === 'claude') && primary.apiKey) return primary;
  for (const p of ['gemini', 'claude'] as AiProvider[]) {
    const key = getBuiltinKey(p);
    if (key) return { provider: p, apiKey: key, model: DEFAULT_MODEL[p] };
  }
  return null;
}

export async function analyzePhoto(imageUri: string, context?: string): Promise<DamageAnalysis> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// ---------- POZ-DEV-092: Voice → report ----------
function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function listVoiceReports(): Promise<VoiceReport[]> {
  try {
    const raw = await AsyncStorage.getItem(VOICE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
async function saveVoiceReports(list: VoiceReport[]): Promise<void> {
  await AsyncStorage.setItem(VOICE_KEY, JSON.stringify(list));
}
export async function deleteVoiceReport(id: string): Promise<void> {
  const list = (await listVoiceReports()).filter(r => r.id !== id);
  await saveVoiceReports(list);
}

function mockSummarize(transcript: string): { summary: string; actionItems: string[] } {
  const lower = TR_LOWER(transcript);
  const sentences = transcript.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean);
  const summary = sentences.slice(0, 2).join('. ') + (sentences.length > 2 ? '.' : '');
  const actions: string[] = [];
  const triggers = ['lazım', 'gerekli', 'gönder', 'al ', 'kontrol', 'değiştir', 'tamir', 'yarın', 'sonra', 'plan'];
  for (const s of sentences) {
    const sl = TR_LOWER(s);
    if (triggers.some(t => sl.includes(t))) actions.push(s);
  }
  return {
    summary: summary || transcript.slice(0, 200),
    actionItems: actions.slice(0, 6),
  };
}

export async function summarizeTranscript(transcript: string, ctx?: { customerName?: string; workOrderId?: string }): Promise<VoiceReport> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export const SEVERITY_LABEL_TR: Record<DamageSeverity, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};
export const SEVERITY_COLOR_AI: Record<DamageSeverity, string> = {
  low: '#0ea5e9',
  medium: '#f59e0b',
  high: '#ea580c',
  critical: '#dc2626',
};

// ============================================================================
// Tool-calling (OpenAI-compatible) — Groq/OpenAI ile uyumlu agent altyapısı
// ============================================================================

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatWithToolsResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  raw?: any;
}

// ============================================================================
// Tool-calling format dönüştürücüler — Gemini & Claude
// Agent loop OpenAI formatında (messages + ToolSchema) çalışır; bu yardımcılar
// onu Gemini (functionDeclarations) ve Claude (tools) formatına çevirir ve
// yanıtı tekrar OpenAI formatına döndürür.
// ============================================================================

/** tool_call_id → fonksiyon adı haritası. Gemini functionResponse `name` ister
 *  ama OpenAI 'tool' mesajı yalnızca id taşır; adı assistant tool_calls'tan kurtarırız. */
function buildToolCallNameMap(messages: ChatMessage[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) map[tc.id] = tc.function.name;
    }
  }
  return map;
}

/** OpenAI JSON-schema parametrelerini Gemini'nin kabul ettiği alt kümeye indirger
 *  (additionalProperties, $schema, default vb. desteklenmez → 400 hatası verir). */
export function sanitizeGeminiSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const ALLOWED = ['type', 'description', 'enum', 'items', 'properties', 'required', 'nullable', 'format'];
  const out: any = {};
  for (const k of ALLOWED) {
    if (schema[k] === undefined) continue;
    if (k === 'properties' && schema.properties && typeof schema.properties === 'object') {
      out.properties = {};
      for (const [pk, pv] of Object.entries(schema.properties)) out.properties[pk] = sanitizeGeminiSchema(pv);
    } else if (k === 'items') {
      out.items = sanitizeGeminiSchema(schema.items);
    } else {
      out[k] = schema[k];
    }
  }
  return out;
}

export function toGeminiTools(tools: ToolSchema[]): any[] {
  const functionDeclarations = tools.map(t => {
    const decl: any = { name: t.function.name, description: t.function.description };
    const params = sanitizeGeminiSchema(t.function.parameters);
    // Boş parametreli (no-arg) tool'larda `parameters` gönderme — Gemini boş object'i reddedebilir.
    if (params && params.properties && Object.keys(params.properties).length) decl.parameters = params;
    return decl;
  });
  return [{ functionDeclarations }];
}

export function toGeminiContents(
  messages: ChatMessage[],
  nameMap: Record<string, string>,
): { systemInstruction?: any; contents: any[] } {
  const sys = messages.filter(m => m.role === 'system').map(m => (m as any).content).filter(Boolean);
  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.tool_calls ?? []) {
        let args: any = {};
        try { args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { args = {}; }
        parts.push({ functionCall: { name: tc.function.name, args } });
      }
      if (parts.length) contents.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      const name = nameMap[m.tool_call_id] || 'unknown';
      let resp: any;
      try { resp = JSON.parse(m.content); } catch { resp = { result: m.content }; }
      // Gemini `response` bir struct (obje) olmalı; primitive/dizi ise sarmala.
      if (resp === null || typeof resp !== 'object' || Array.isArray(resp)) resp = { result: resp };
      contents.push({ role: 'user', parts: [{ functionResponse: { name, response: resp } }] });
    }
  }
  return {
    systemInstruction: sys.length ? { parts: [{ text: sys.join('\n') }] } : undefined,
    contents,
  };
}

export function parseGeminiToolResponse(json: any): ChatWithToolsResult {
  const cand = json?.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  let content = '';
  const toolCalls: ToolCall[] = [];
  let idx = 0;
  for (const p of parts) {
    if (typeof p.text === 'string') content += p.text;
    else if (p.functionCall) {
      toolCalls.push({
        id: `gem_${p.functionCall.name}_${idx++}`,
        type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
      });
    }
  }
  const fr = cand?.finishReason;
  const finishReason = toolCalls.length ? 'tool_calls' : fr === 'MAX_TOKENS' ? 'length' : 'stop';
  return { content: content || null, toolCalls, finishReason, raw: json };
}

export function toClaudeTools(tools: ToolSchema[]): any[] {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema:
      t.function.parameters && (t.function.parameters as any).type
        ? t.function.parameters
        : { type: 'object', properties: {} },
  }));
}

export function toClaudeMessages(messages: ChatMessage[]): { system?: string; messages: any[] } {
  const sys = messages.filter(m => m.role === 'system').map(m => (m as any).content).filter(Boolean);
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls ?? []) {
        let input: any = {};
        try { input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { input = {}; }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
      }
      // Claude boş içeriği reddeder — düşünce/araç yoksa yer tutucu metin koy.
      if (!blocks.length) blocks.push({ type: 'text', text: '(devam)' });
      out.push({ role: 'assistant', content: blocks });
    } else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      // Ardışık tool sonuçlarını TEK user turn'ünde birleştir (Claude şartı:
      // bir assistant turn'ündeki tüm tool_use'lara aynı user turn'ünde yanıt).
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return { system: sys.length ? sys.join('\n') : undefined, messages: out };
}

export function parseClaudeToolResponse(json: any): ChatWithToolsResult {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  let content = '';
  const toolCalls: ToolCall[] = [];
  for (const b of blocks) {
    if (b.type === 'text') content += b.text;
    else if (b.type === 'tool_use') {
      toolCalls.push({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      });
    }
  }
  const sr = json?.stop_reason;
  const finishReason = toolCalls.length ? 'tool_calls' : sr === 'max_tokens' ? 'length' : 'stop';
  return { content: content || null, toolCalls, finishReason, raw: json };
}

/**
 * Tool-calling destekli chat çağrısı — OpenAI, Groq, Gemini ve Claude.
 * Agent loop OpenAI formatında konuşur; Gemini/Claude için format çevirisi
 * şeffaf yapılır. (Önceden Gemini/Claude sessizce text-only'a düşüyordu.)
 */
// OpenAI/Groq: HER mesajın `content`'i string olmalı; YALNIZ tool_calls'lu
// assistant mesajında null kabul edilir. Ajan döngüsü boş-tur/araçsız adımda
// content:null tutabiliyordu → "Invalid value for 'content': expected a string,
// got null" (HTTP 400). Burada gönderimden önce null/undefined content'i ''e çevir
// (tool_calls korunur; '' + tool_calls OpenAI tarafından kabul edilir).
function sanitizeOpenAiMessages(messages: ChatMessage[]): any[] {
  return messages.map(m => {
    const content = (m as any).content;
    if (content === null || content === undefined) {
      return { ...m, content: '' };
    }
    return m;
  });
}

/**
 * Tool-calling'i ai-proxy üzerinden yapar (WEB/proxy). Tarayıcı CORS'u openai/claude
 * doğrudan çağrısını engeller ve anahtarlar istemcide olmamalı; bu yüzden tek LLM
 * round-trip'i ai-proxy'de yapılır. Araç YÜRÜTME yine istemcidedir (loop.ts + app context).
 * Eski ai-proxy yalnız 'content' döner → araçsız metin yanıtına ZARİF DÜŞÜŞ (redeploy'a kadar).
 */
async function chatWithToolsViaProxy(
  messages: ChatMessage[],
  tools: ToolSchema[],
): Promise<ChatWithToolsResult> {
  if (!SUPABASE_CONFIGURED) throw new Error('AI proxy için Şirket sunucusu yapılandırılmalı.');
  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: {
      provider: 'openai',
      messages: sanitizeOpenAiMessages(messages),
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
    },
  });
  if (error) throw new Error(`AI proxy (agent) hatası: ${error.message || error}`);
  const d: any = data;
  const msg = d?.message ?? { content: d?.content ?? null, tool_calls: null };
  const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  return {
    content: msg.content ?? null,
    toolCalls,
    finishReason: d?.finish_reason ?? (toolCalls.length ? 'tool_calls' : 'stop'),
    raw: d,
  };
}

export async function chatWithTools(
  messages: ChatMessage[],
  tools: ToolSchema[],
  settings?: AiSettings,
): Promise<ChatWithToolsResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

/** Geçici (retry edilebilir) sağlayıcı hatası mı? (503/429/overload/timeout) */
function isTransientAiError(err: any): boolean {
  const m = String(err?.message ?? err);
  return /\b(429|500|502|503|504)\b|high demand|overload|rate.?limit|timeout|temporar|ECONNRESET|unavailable/i.test(m);
}

/**
 * Dayanıklı tool-calling: seçili sağlayıcı geçici hata (ör. Gemini 503) verirse
 * önce kısa bekleyip 1 kez tekrar dener; yine olmazsa anahtarı olan diğer
 * tool-destekli sağlayıcıya (gemini→openai→claude→groq) otomatik geçer.
 * Agent döngüsü tek bir Gemini yoğunluğunda kesilmesin diye kullanılır.
 */
export async function chatWithToolsFallback(
  messages: ChatMessage[],
  tools: ToolSchema[],
  primary?: AiSettings,
): Promise<ChatWithToolsResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
