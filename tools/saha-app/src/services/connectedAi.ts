import { bootstrapPortal, transport } from '../portal/api';

export const CONNECTED_AI_PROVIDERS = ['gemini', 'groq', 'openrouter', 'cloudflare'] as const;
export type ConnectedAiProvider = typeof CONNECTED_AI_PROVIDERS[number];
export type ConnectedAiProviderStatus = {
  provider: ConnectedAiProvider; label: string; configured: boolean; model: string;
  privacyUrl: string; notice: string;
};
export type ConnectedAiStatus = Record<ConnectedAiProvider, ConnectedAiProviderStatus>;
export type ConnectedAiReply = {
  text: string; provider: ConnectedAiProvider; model: string; generatedAt: string; truncated: boolean;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
};
const endpoint = '/api/integrations.php';
const api = 'vg-integrations/1';

export async function getConnectedAiStatus(): Promise<ConnectedAiStatus> {
  await bootstrapPortal();
  const data = await transport('status', undefined, endpoint, api, true);
  const status = data?.ai;
  for (const provider of CONNECTED_AI_PROVIDERS) {
    const item = status?.[provider];
    if (!item || item.provider !== provider || typeof item.configured !== 'boolean'
      || typeof item.model !== 'string' || typeof item.label !== 'string'
      || typeof item.notice !== 'string' || typeof item.privacyUrl !== 'string'
      || !item.privacyUrl.startsWith('https://')) throw new Error('Yapay zekâ bağlantı durumu doğrulanamadı.');
  }
  return status as ConnectedAiStatus;
}

export async function sendConnectedAi(provider: ConnectedAiProvider, prompt: string): Promise<ConnectedAiReply> {
  if (!CONNECTED_AI_PROVIDERS.includes(provider) || !prompt.trim() || [...prompt].length > 12000) {
    throw new Error('Sağlayıcı seçin ve en fazla 12.000 karakterlik bir ileti yazın.');
  }
  await bootstrapPortal();
  // Every send is explicit. No customer records, stored prompts, hidden history or replay queue.
  const data = await transport('ai_chat', { provider, prompt, maxOutputTokens: 1024 }, endpoint, api, true);
  if (data?.provider !== provider || typeof data.text !== 'string' || !data.text.trim()
    || typeof data.model !== 'string' || typeof data.generatedAt !== 'string'
    || typeof data.truncated !== 'boolean' || !data.usage) throw new Error('Yapay zekâ yanıtı doğrulanamadı.');
  return data as ConnectedAiReply;
}
