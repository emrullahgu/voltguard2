import {reportPortalError} from '../portal/api';
// aiAssistant.ts — Faz 41 AI servis katmanı (mock, AsyncStorage)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { localDateISO } from '../utils/date';
import type {
  AiPermission, AiSession, AiMessage, AiPozSuggestion, AiQuoteDraft,
  AiWorkOrderSummary, AiCustomerInsight, AiRiskAlert, AiDailyReport, AiUsageLog,
  AiFeature, AiUserRole, AiAssistantProvider, AiRiskType, AiRiskLevel, AiRole,
} from '../types';

const K = {
  perms: 'ai_perms_v1', sessions: 'ai_conversations_v1', messages: 'ai_messages_v1',
  poz: 'ai_poz_v1', quotes: 'ai_quotes_v1', woSum: 'ai_wo_sum_v1',
  custIns: 'ai_cust_v1', risks: 'ai_risks_v1', daily: 'ai_daily_v1', usage: 'ai_usage_v1',
};

const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10);
async function load<T>(k: string): Promise<T[]> {  const r = await AsyncStorage.getItem(k); return r ? JSON.parse(r) : [];  }
async function save<T>(k: string, v: T[]) { await AsyncStorage.setItem(k, JSON.stringify(v)); }

export const FEATURE_LABEL: Record<AiFeature, string> = {
  chat: 'Sohbet', poz_suggest: 'POZ Öneri', quote_draft: 'Teklif Taslağı',
  workorder_summary: 'İş Emri Özeti', customer_summary: 'Müşteri Özeti',
  risk_analysis: 'Risk Analizi', daily_report: 'Günlük Rapor', logs: 'Loglar',
  agent: 'Ajan', vision: 'Görsel/Belge',
};
export const FEATURE_ICON: Record<AiFeature, string> = {
  chat: 'chatbubbles-outline', poz_suggest: 'pricetag-outline', quote_draft: 'document-text-outline',
  workorder_summary: 'newspaper-outline', customer_summary: 'person-outline',
  risk_analysis: 'warning-outline', daily_report: 'calendar-outline', logs: 'list-outline',
  agent: 'sparkles-outline', vision: 'image-outline',
};
export const ROLE_LABEL: Record<AiUserRole, string> = { admin: 'Yönetici', manager: 'Müdür', staff: 'Personel', sales: 'Satış' };
export const ROLE_COLOR: Record<AiUserRole, string> = { admin: '#ef4444', manager: '#a855f7', staff: '#0ea5e9', sales: '#f59e0b' };
export const PROVIDER_LABEL: Record<AiAssistantProvider, string> = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', local: 'Yerel' };
export const RISK_COLOR: Record<AiRiskLevel, string> = { low: '#22c55e', medium: '#eab308', high: '#f97316', critical: '#ef4444' };
export const RISK_LABEL: Record<AiRiskLevel, string> = { low: 'Düşük', medium: 'Orta', high: 'Yüksek', critical: 'Kritik' };
export const RISK_TYPE_LABEL: Record<AiRiskType, string> = {
  delay: 'Gecikme', sla: 'SLA İhlali', low_stock: 'Düşük Stok',
  vehicle_maintenance: 'Araç Bakım', customer_churn: 'Müşteri Kaybı',
};

// Permissions
async function seedPerms(): Promise<AiPermission[]> {
  return [];
}
export async function listPermissions() { return load<AiPermission>(K.perms); }
export async function togglePermission(id: string) {
  const list = await load<AiPermission>(K.perms);
  const i = list.findIndex(p => p.id === id);
  if (i >= 0) { list[i].enabled = !list[i].enabled; await save(K.perms, list); }
}

// Sessions & Messages
async function seedSessions(): Promise<AiSession[]> {
  return [];
}
export async function listSessions() { return load<AiSession>(K.sessions); }
export async function createSession(title: string, feature: AiFeature): Promise<AiSession> {
  const list = await load<AiSession>(K.sessions);
  const s: AiSession = { id: uid(), title, feature, createdAt: now(), updatedAt: now(), messageCount: 0, tokenTotal: 0 };
  list.unshift(s); await save(K.sessions, list); return s;
}
export async function deleteSession(id: string) {
  const list = await load<AiSession>(K.sessions);
  await save(K.sessions, list.filter(s => s.id !== id));
  const msgs = await load<AiMessage>(K.messages);
  await save(K.messages, msgs.filter(m => m.sessionId !== id));
}
export async function listMessages(sessionId: string): Promise<AiMessage[]> {
  await seedSessions();
  const all = await load<AiMessage>(K.messages);
  return all.filter(m => m.sessionId === sessionId);
}
export async function sendMessage(
  sessionId: string,
  content: string,
  snapshot?: import('./aiCopilot').CopilotSnapshot,
): Promise<AiMessage> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export interface ChatAttachment {
  base64: string;
  mimeType: string;
  kind: 'image' | 'pdf';
  name?: string;
}

/**
 * Foto/PDF ekli mesaj gönderir. Eki OpenAI/Gemini/Claude vision/belge-okuma ile
 * analiz eder (askCopilotWithAttachment) ve hem kullanıcı hem asistan mesajını
 * oturuma kalıcı yazar. Sohbet ekranı düz metin sendMessage'a benzer kullanır.
 */
export async function sendMessageWithAttachment(
  sessionId: string,
  content: string,
  attachment: ChatAttachment,
  snapshot?: import('./aiCopilot').CopilotSnapshot,
): Promise<AiMessage> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

export async function approveMessage(id: string) {
  const msgs = await load<AiMessage>(K.messages);
  const i = msgs.findIndex(m => m.id === id);
  if (i >= 0) { msgs[i].approved = true; await save(K.messages, msgs); }
}
function mockReply(q: string): string {
  const l = q.toLowerCase();
  if (l.includes('poz')) return 'POZ-26.110.1001 (Trafo Periyodik Bakım) önerilir. Test, temizlik, yağ analizi içerir.';
  if (l.includes('teklif')) return 'Müşteri profili ve geçmiş tekliflere göre 3 kalemli teklif taslağı hazırladım. Detay için POZ önerilerine bakın.';
  if (l.includes('rapor')) return 'Bugün tamamlanan 12 iş emrinden 10 başarılı, 2 ertelendi. SLA hedefi %92.';
  if (l.includes('risk')) return '3 araç bakım süresi yaklaşıyor (Plaka A,B,C). 2 müşteride SLA risk seviyesi yüksek.';
  return 'İsteğinizi anladım. Daha fazla bilgi için ilgili modülü kontrol edebilirsiniz.';
}

// POZ suggestion
async function seedPoz(): Promise<AiPozSuggestion[]> {
  return [];
}
// Kalıcı listeyi döndür (suggestPoz buraya yazıyor). Önceden hep seedPoz()=[] dönüp
// kaydedilen önerileri YOK SAYIYORDU → AiPozSuggest ekranı önerileri anında siliyordu.
export async function listPozSuggestions(): Promise<AiPozSuggestion[]> { return load<AiPozSuggestion>(K.poz); }
export async function suggestPoz(description: string): Promise<AiPozSuggestion> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function acceptPoz(id: string, accepted: boolean) {
  const list = await load<AiPozSuggestion>(K.poz);
  const i = list.findIndex(p => p.id === id);
  if (i >= 0) { list[i].accepted = accepted; await save(K.poz, list); }
}

// Quote draft
// DÜZELTME: önceden seedQuotes() (boş dizi) dönüyordu → üretilen taslaklar
// (K.quotes'a yazılmasına rağmen) listede HİÇ görünmüyordu. listPozSuggestions/
// listUsageLogs deseniyle aynı: kalıcı depodan oku.
export async function listQuoteDrafts(): Promise<AiQuoteDraft[]> {
  return load<AiQuoteDraft>(K.quotes);
}
export async function generateQuoteDraft(customerName: string, surveyText: string): Promise<AiQuoteDraft> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }
export async function setQuoteDraftStatus(id: string, status: AiQuoteDraft['status']) {
  const list = await load<AiQuoteDraft>(K.quotes);
  const i = list.findIndex(q => q.id === id);
  if (i >= 0) { list[i].status = status; await save(K.quotes, list); }
}
export async function getQuoteDraft(id: string): Promise<AiQuoteDraft | undefined> {
  const list = await load<AiQuoteDraft>(K.quotes);
  return list.find(q => q.id === id);
}

// Work order summaries
async function seedWoSum(): Promise<AiWorkOrderSummary[]> {
  return [];
}
export async function listWoSummaries() { return load<AiWorkOrderSummary>(K.woSum); }
export async function summarizeWorkOrder(workOrderId: string): Promise<AiWorkOrderSummary> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// Customer insight
async function seedCust(): Promise<AiCustomerInsight[]> {
  return [];
}
export async function listCustomerInsights() { return load<AiCustomerInsight>(K.custIns); }
export async function generateCustomerInsight(customerId: string, customerName: string): Promise<AiCustomerInsight> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// Risk alerts
async function seedRisks(): Promise<AiRiskAlert[]> {
  return [];
}
export async function listRiskAlerts() { return load<AiRiskAlert>(K.risks); }
export async function dismissRisk(id: string) {
  const list = await load<AiRiskAlert>(K.risks);
  const i = list.findIndex(r => r.id === id);
  if (i >= 0) { list[i].dismissed = true; await save(K.risks, list); }
}

// Daily report
async function seedDaily(): Promise<AiDailyReport[]> {
  return [];
}
export async function listDailyReports() { return load<AiDailyReport>(K.daily); }
export async function generateDailyReport(): Promise<AiDailyReport> { throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }

// Usage logs
async function seedUsage(): Promise<AiUsageLog[]> {
  return [];
}
// Gerçek kayıtlı kullanım logunu döndürür (önceden seedUsage()=[] dönüp ekranı
// hep boş bırakıyordu — çekirdek AI telemetrisi artık ai_usage_v1'e yazılır).
export async function listUsageLogs(): Promise<AiUsageLog[]> { return load<AiUsageLog>(K.usage); }

export interface AiUsageStats {
  total: number;
  successRate: number;       // 0..100
  failures: number;
  avgMs: number;             // ortalama gecikme
  byProvider: { provider: AiAssistantProvider; count: number }[];
  byFeature: { feature: AiFeature; count: number }[];
}

/** Kullanım loglarından AI sağlık özeti (saf fonksiyon — test edilebilir). */
export function computeAiUsageStats(logs: AiUsageLog[]): AiUsageStats {
  const total = logs.length;
  const ok = logs.filter(l => l.success).length;
  const failures = total - ok;
  const successRate = total ? Math.round((ok / total) * 100) : 0;
  const avgMs = total ? Math.round(logs.reduce((sum, l) => sum + (l.durationMs || 0), 0) / total) : 0;
  const tally = <T,>(items: T[]): { key: T; count: number }[] => {
    const m = new Map<T, number>();
    for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
    return Array.from(m, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  };
  return {
    total, successRate, failures, avgMs,
    byProvider: tally(logs.map(l => l.provider)).map(x => ({ provider: x.key, count: x.count })),
    byFeature: tally(logs.map(l => l.feature)).map(x => ({ feature: x.key, count: x.count })),
  };
}
async function logUsage(feature: AiFeature, provider: AiAssistantProvider, pTok: number, cTok: number, success: boolean, errorMessage?: string, durationMs?: number) {
  const list = await load<AiUsageLog>(K.usage);
  const hasTokens = pTok > 0 || cTok > 0;
  list.unshift({
    id: uid(), feature, provider, promptTokens: pTok, completionTokens: cTok,
    // Maliyet yalnız token varsa TAHMİN edilir; yoksa undefined. Süre GERÇEK ölçümdür
    // (verilmediyse undefined) — önceki `500 + random*3000` UYDURMASI kaldırıldı (Gereksinim 3).
    costUsd: hasTokens ? (pTok * 0.003 + cTok * 0.006) / 1000 : undefined,
    durationMs,
    createdAt: now(), success, errorMessage,
  });
  await save(K.usage, list.slice(0, 200));
}
