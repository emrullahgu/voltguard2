import {reportPortalError} from '../portal/api';
// src/services/aiRouter.ts
// Edge function 'ai-proxy' ve 'ai-rag' için ince mobil istemci.
// Tüm anahtarlar Şirket sunucusu tarafında — mobilde sadece JWT (anon) kullanılır.

import { supabase, SUPABASE_CONFIGURED } from './supabase';

export type AiProviderId = 'auto' | 'openai' | 'claude' | 'gemini';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiResult {
  provider: 'openai' | 'claude' | 'gemini';
  model: string;
  content: string;
  usage?: { input_tokens: number; output_tokens: number };
  latency_ms: number;
}

export interface RagSource {
  index: number;
  document_id: string;
  title: string;
  source: string;
  similarity: number;
  excerpt: string;
}

export interface RagResult {
  answer: string;
  provider: string;
  model: string;
  sources: RagSource[];
}

function ensureReady(): void {
  if (!SUPABASE_CONFIGURED) {
    throw new Error('Şirket sunucusu yapılandırılmamış — AI çağrıları kullanılamıyor.');
  }
}

/**
 * AI çağrısını timeout + retry ile sar. 5xx ve network hatalarında tekrar dener;
 * 4xx (validation/auth) hatalarında anında throw eder.
 */
async function withRetry<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  opts: { name: string; timeoutMs?: number; maxAttempts?: number } = { name: 'ai' },
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastErr: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await Promise.race([
        fn(),
        new Promise<{ data: null; error: any }>((_, reject) =>
          setTimeout(() => reject(new Error(`${opts.name} zaman aşımı (${timeoutMs / 1000}s).`)), timeoutMs),
        ),
      ]);
      if (result.error) {
        const status = result.error?.context?.status ?? result.error?.status;
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw result.error;
        }
        lastErr = result.error;
      } else {
        if (!result.data) throw new Error(`${opts.name}: boş yanıt.`);
        return result.data;
      }
    } catch (e: any) {
      lastErr = e;
      if (e?.context?.status && e.context.status >= 400 && e.context.status < 500 && e.context.status !== 429) {
        throw e;
      }
    }
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1))); // 500ms, 1s, 2s
    }
  }
  throw lastErr ?? new Error(`${opts.name}: tüm denemeler başarısız.`);
}

/** Çoklu sağlayıcı chat. */
export async function aiChat(opts: {
  messages: AiMessage[];
  provider?: AiProviderId;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<AiResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

/**
 * Streaming chat (sadece OpenAI). onToken her yeni delta için çağrılır.
 * Tam yanıt resolve olur. AbortController.signal ile iptal edilebilir.
 */
export async function aiChatStream(opts: {
  messages: AiMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  onToken: (delta: string, fullSoFar: string) => void;
  signal?: AbortSignal;
}): Promise<{ content: string; model: string }> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

/** NotebookLM-tarzı sorgu: kaynak chunks + AI yanıtı. */
export async function aiRagQuery(opts: {
  question: string;
  top_k?: number;
  provider?: AiProviderId;
}): Promise<RagResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

/** Web sitesi içeriğini RAG'a tara/öğret (yalnız admin/manager). URL(ler) veya sitemap. */
export async function aiRagCrawl(opts: {
  urls?: string[];
  sitemap?: string;
  limit?: number;
}): Promise<{ crawled: number; ok: number; failed: number; results: Array<{ url: string; ok: boolean; error?: string }> }> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

/** Belge ekle / embed. */
export async function aiRagIngest(documents: Array<{
  title: string;
  source?: string;
  source_id?: string;
  content: string;
  meta?: Record<string, any>;
}>): Promise<{ ok: boolean; ingested: Array<{ id: string; chunks: number }> }> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

/** Bir belgeyi RAG'dan sil. */
export async function aiRagDelete(document_id: string): Promise<void> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export interface RagDocument {
  id: string;
  title: string;
  source: string;
  source_id: string | null;
  created_at: string;
  meta: Record<string, any>;
  chunk_count: number;
}

/** RAG'daki belgeleri listele. */
export async function aiRagList(limit = 100): Promise<RagDocument[]> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export interface AgentAction {
  tool: string;
  args: Record<string, any>;
  result: any;
}

export interface AgentResult {
  answer: string;
  actions: AgentAction[];
  usage?: { prompt_tokens: number; completion_tokens: number };
  model: string;
}

/** Function-calling AI Agent — DB'de gerçek aksiyon yapar (iş emri oluştur, müşteri ekle vs.). */
export async function aiAgent(opts: {
  messages: AiMessage[];
  max_iterations?: number;
}): Promise<AgentResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export type VisionMode = 'invoice' | 'business_card' | 'product_label' | 'meter' | 'plate' | 'free';

export interface VisionResult {
  mode: VisionMode;
  data: any;
  raw: string;
  usage?: any;
  latency_ms: number;
  model: string;
}

/** GPT-4o Vision ile fotoğraftan yapılandırılmış veri çıkar. image: data URL ya da https URL. */
export async function aiVision(opts: {
  image: string;
  mode?: VisionMode;
  hint?: string;
}): Promise<VisionResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export interface SqlResult {
  question: string;
  sql: string;
  rows: any[];
  row_count: number;
  summary: string;
  latency_ms: number;
  model: string;
}

/** Doğal dil → SQL → sonuç + Türkçe özet. */
export async function aiSql(opts: {
  question: string;
  max_rows?: number;
}): Promise<SqlResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export interface RouteStopInput {
  id: string;
  label?: string;
  lat: number;
  lng: number;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  time_window?: { start: string; end: string };
  service_minutes?: number;
  customer?: string;
}

export interface AiRouteResult {
  order: Array<{
    stop_id: string;
    eta: string;
    leave_at: string;
    distance_km_from_prev: number;
    notes?: string;
  }>;
  total_km: number;
  total_minutes: number;
  reasoning: string;
  model: string;
}

/** AI ile rota optimizasyonu (öncelik, zaman penceresi, trafik dahil). */
export async function aiOptimizeRoute(opts: {
  stops: RouteStopInput[];
  start?: { lat: number; lng: number; label?: string };
  departure_time?: string;
  constraints?: string;
}): Promise<AiRouteResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export interface RagWorkerStatus {
  pending: number;
  failed: number;
  processed_24h: number;
}

export interface RagWorkerRunResult {
  processed: number;
  ok: number;
  failed: number;
  errors?: Array<{ id: number; error: string }>;
}

/** Kuyruk durumunu getir (pending / failed / processed_24h). */
export async function aiRagQueueStatus(): Promise<RagWorkerStatus> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

/** Worker'ı manuel tetikle — bekleyen kayıtları işler. */
export async function aiRagWorkerRun(batchSize = 25): Promise<RagWorkerRunResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export interface VoiceResult {
  transcript: string;
  language: string;
  duration: number;
  summary?: string;
  action_items?: string[];
  sentiment?: 'olumlu' | 'nötr' | 'olumsuz';
  key_entities?: {
    customers?: string[];
    products?: string[];
    dates?: string[];
    amounts?: string[];
  };
  model: string;
}

/** Ses dosyası → Whisper → özet + aksiyon. */
export async function aiVoice(opts: {
  audio_base64: string;
  mime?: string;
  filename?: string;
  language?: 'tr' | 'en' | 'auto';
  context?: string;
  summarize?: boolean;
}): Promise<VoiceResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export interface InsightsKpis {
  period_days: number;
  work_orders_new: number;
  work_orders_completed: number;
  work_orders_completed_prev: number;
  completion_trend_pct: number;
  customers_new: number;
  customers_total: number;
  sales_visits_new: number;
  quotes_new: number;
  urgent_open: number;
  top_clients: Array<{ key: string; count: number }>;
  top_services: Array<{ key: string; count: number }>;
  top_statuses: Array<{ key: string; count: number }>;
}

export interface InsightsResult {
  report: { subject: string; markdown: string; gchat_text: string; html: string };
  kpis: InsightsKpis;
  email_sent?: { ok: boolean; response: any } | null;
  gchat_sent?: { ok: boolean; response: any } | null;
  dry_run: boolean;
  model: string;
}

/** Haftalık AI Insights raporu üret (+ opsiyonel gönder). */
export async function aiInsights(opts?: {
  days?: number;
  to_email?: string | string[];
  send_email?: boolean;
  send_gchat?: boolean;
  dry_run?: boolean;
}): Promise<InsightsResult> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
