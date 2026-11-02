// ====================================================================
// quoteTemplates.ts — POZ-DEV-041
// Teklif şablonları (lokal AsyncStorage tabanlı).
// ====================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QuoteTemplate, QuoteLine } from '../types';

const KEY = '@SahaTakip:quote_templates';

const SEED: QuoteTemplate[] = [];

export async function listQuoteTemplates(): Promise<QuoteTemplate[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      await AsyncStorage.setItem(KEY, JSON.stringify(SEED));
      return SEED;
    }
    return JSON.parse(raw) as QuoteTemplate[];
  } catch {
    return SEED;
  }
}

export async function saveQuoteTemplates(list: QuoteTemplate[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

export async function upsertQuoteTemplate(t: QuoteTemplate): Promise<void> {
  const list = await listQuoteTemplates();
  const idx = list.findIndex(x => x.id === t.id);
  if (idx >= 0) list[idx] = t;
  else list.push(t);
  await saveQuoteTemplates(list);
}

export async function deleteQuoteTemplate(id: string): Promise<void> {
  const list = await listQuoteTemplates();
  await saveQuoteTemplates(list.filter(x => x.id !== id));
}

/** Şablon satırlarını teklif satırlarına çevir (lineNo atar). */
export function templateToLines(t: QuoteTemplate): QuoteLine[] {
  return t.lines.map((l, i) => ({ ...l, lineNo: i + 1 }));
}
