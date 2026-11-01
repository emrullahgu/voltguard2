// officeWorkspace.ts — Ofis Takip (Notion benzeri ofis çalışma alanı) veri katmanı.
// Üç varlık: Sayfa (blok editör + alt-sayfa ağacı), Pano (kanban), Toplantı notu.
// Sunucu onayı kalıcılığın kaynağıdır. Önbellek yalnız doğrulanmış kayıtları tutar.
// SUPABASE_CONFIGURED false ise yalnız yerel çalışır.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coalescePortalRead } from '../portal/coalescedRead';
import { supabase, SUPABASE_CONFIGURED } from './supabase';
import { newUuid } from './data/repository';
import { localDateISO } from '../utils/date';
import { matchesAnyField } from '../utils/search';
import { attachmentKind } from './photoUpload';
import type {
  OfficePage, OfficeBlock, OfficeBlockType,
  OfficeBoard, OfficeBoardColumn, OfficeBoardCard, OfficeCardPriority,
  OfficeMeeting, OfficeActionItem, OfficeLabel, OfficeChecklistItem, OfficeAttachment,
} from '../types';

const KEYS = {
  pages: 'office_pages_v1',
  boards: 'office_boards_v1',
  meetings: 'office_meetings_v1',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v?: string | null): string | null => (v && UUID_RE.test(v) ? v : null);

async function loadList<T>(key: string): Promise<T[]> {
  const raw = await AsyncStorage.getItem(key);
  const list = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(list)) throw new Error('Ofis kayıt önbelleği doğrulanamadı. Listeyi yenileyin.');
  return list;
}
async function saveList<T>(key: string, list: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(list));
}
async function cacheConfirmed<T>(key: string, list: T[]) {
  // An optional cache failure must not invite resubmission of an accepted save.
  // PrivateStorage reports its own failure through the portal notice channel.
  await saveList(key, list).catch(() => {});
}
function snapshotVersions(record: { id: string; serverRevision?: number }): Record<string, number> {
  if (record.serverRevision === undefined) return {};
  if (!Number.isSafeInteger(record.serverRevision) || record.serverRevision < 1) throw new Error('Ofis kaydının sürümü geçersiz. Listeyi yenileyin.');
  return { [record.id]: record.serverRevision };
}

const now = () => new Date().toISOString();

// =============================================================
// BLOK yardımcıları (Notion benzeri editör)
// =============================================================
export const BLOCK_LABEL: Record<OfficeBlockType, string> = {
  heading1: 'Başlık 1', heading2: 'Başlık 2', heading3: 'Başlık 3',
  text: 'Metin', todo: 'Yapılacak', bullet: 'Madde', numbered: 'Numaralı',
  divider: 'Ayraç', callout: 'Vurgu', quote: 'Alıntı', code: 'Kod',
};
export const BLOCK_ICON: Record<OfficeBlockType, string> = {
  heading1: 'text-outline', heading2: 'text-outline', heading3: 'text-outline',
  text: 'reorder-four-outline', todo: 'checkbox-outline', bullet: 'ellipse-outline',
  numbered: 'list-outline', divider: 'remove-outline', callout: 'bulb-outline',
  quote: 'chatbox-ellipses-outline', code: 'code-slash-outline',
};
export const BLOCK_MENU: OfficeBlockType[] = [
  'text', 'heading1', 'heading2', 'heading3', 'todo', 'bullet', 'numbered', 'callout', 'quote', 'code', 'divider',
];

export function newBlock(type: OfficeBlockType = 'text', text = ''): OfficeBlock {
  return { id: newUuid(), type, text, ...(type === 'todo' ? { checked: false } : {}) };
}

/** Tüm blok metnini düz metne indirger (arama/önizleme için). */
export function pagePlainText(p: OfficePage): string {
  return p.blocks.map(b => b.text).filter(Boolean).join(' ');
}

// ── Sayfa şablonları (Notion benzeri hızlı başlangıç) ──
export interface PageTemplate {
  key: string;
  label: string;
  icon: string;
  desc: string;
  build: () => OfficeBlock[];
}
export const PAGE_TEMPLATES: PageTemplate[] = [
  { key: 'blank', label: 'Boş Sayfa', icon: '📄', desc: 'Temiz başla', build: () => [newBlock('text', '')] },
  {
    key: 'meeting', label: 'Toplantı Notu', icon: '📝', desc: 'Katılımcı · gündem · aksiyon',
    build: () => [
      newBlock('heading2', 'Katılımcılar'),
      newBlock('bullet', ''),
      newBlock('heading2', 'Gündem'),
      newBlock('numbered', ''),
      newBlock('heading2', 'Kararlar'),
      newBlock('text', ''),
      newBlock('heading2', 'Aksiyonlar'),
      newBlock('todo', ''),
    ],
  },
  {
    key: 'project', label: 'Proje Planı', icon: '🎯', desc: 'Hedef · kilometre taşı · riskler',
    build: () => [
      newBlock('heading2', 'Amaç'),
      newBlock('callout', 'Bu projenin hedefi…'),
      newBlock('heading2', 'Kilometre Taşları'),
      newBlock('todo', ''),
      newBlock('heading2', 'Riskler & Notlar'),
      newBlock('bullet', ''),
    ],
  },
  {
    key: 'checklist', label: 'Kontrol Listesi', icon: '✅', desc: 'Yapılacaklar listesi',
    build: () => [
      newBlock('heading2', 'Kontrol Listesi'),
      newBlock('todo', ''), newBlock('todo', ''), newBlock('todo', ''),
    ],
  },
  {
    key: 'sop', label: 'Prosedür (SOP)', icon: '⚙️', desc: 'Adım adım iş akışı',
    build: () => [
      newBlock('heading2', 'Amaç'),
      newBlock('text', ''),
      newBlock('heading2', 'Adımlar'),
      newBlock('numbered', ''),
      newBlock('heading2', 'Dikkat'),
      newBlock('callout', ''),
    ],
  },
];

// =============================================================
// SAYFALAR
// =============================================================
function pageToRow(p: OfficePage) {
  return {
    id: p.id,
    parent_id: uuidOrNull(p.parentId),
    title: p.title,
    icon: p.icon,
    blocks: p.blocks,
    is_favorite: p.isFavorite,
    archived: p.archived,
    order_index: p.orderIndex,
    created_by: uuidOrNull(p.createdBy),
    created_by_name: p.createdByName ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt ?? p.createdAt,
  };
}
function pageFromRow(r: any, serverRevision?: number): OfficePage {
  return {
    id: r.id,
    serverRevision,
    parentId: r.parent_id ?? null,
    title: r.title ?? '',
    icon: r.icon ?? '📄',
    blocks: Array.isArray(r.blocks) ? r.blocks : [],
    isFavorite: !!r.is_favorite,
    archived: !!r.archived,
    orderIndex: r.order_index ?? 0,
    createdBy: r.created_by ?? undefined,
    createdByName: r.created_by_name ?? undefined,
    createdAt: r.created_at ?? now(),
    updatedAt: r.updated_at ?? undefined,
  };
}

export function listPages(): Promise<OfficePage[]> {
  return coalescePortalRead(KEYS.pages, loadPages);
}
async function loadPages(): Promise<OfficePage[]> {
  if (!SUPABASE_CONFIGURED) return loadList<OfficePage>(KEYS.pages);
  const { data, error, versions } = await supabase.from('office_pages').select('*').order('order_index', { ascending: true });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Sunucu ofis kayıt listesi doğrulanamadı.');
  const list = data.map((row: any) => pageFromRow(row, versions?.[row.id]));
  await cacheConfirmed(KEYS.pages, list);
  return list;
}

/** Belirli ebeveynin (null = kök) arşivlenmemiş alt sayfaları, sıraya göre. */
export function childrenOf(all: OfficePage[], parentId: string | null): OfficePage[] {
  return all
    .filter(p => !p.archived && (p.parentId ?? null) === parentId)
    .sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt));
}

export async function getPage(id: string): Promise<OfficePage | undefined> {
  return (await listPages()).find(p => p.id === id);
}

export async function savePage(
  input: Partial<OfficePage> & { id?: string },
): Promise<OfficePage> {
  const list = await loadList<OfficePage>(KEYS.pages);
  let page: OfficePage;
  if (input.id) {
    const idx = list.findIndex(p => p.id === input.id);
    if (idx >= 0) {
      page = { ...list[idx], ...input, id: input.id, updatedAt: now() } as OfficePage;
      list[idx] = page;
    } else {
      page = normalizeNewPage(input);
      list.unshift(page);
    }
  } else {
    page = normalizeNewPage(input);
    list.unshift(page);
  }
  if (SUPABASE_CONFIGURED) {
    const { data, error, versions } = await supabase.from('office_pages')
      .upsert(pageToRow(page)).expectVersions(snapshotVersions(page)).select().single();
    if (error) throw error;
    if (!data?.id) throw new Error('Sunucu sayfa kaydını doğrulamadı. Tekrar göndermeden önce kayıtları kontrol edin.');
    page = pageFromRow(data, versions?.[data.id]);
    await cacheConfirmed(KEYS.pages, list.map(p => p.id === page.id ? page : p));
  } else await saveList(KEYS.pages, list);
  return page;
}

function normalizeNewPage(input: Partial<OfficePage>): OfficePage {
  return {
    id: input.id || newUuid(),
    serverRevision: input.serverRevision,
    parentId: input.parentId ?? null,
    title: input.title ?? 'Adsız sayfa',
    icon: input.icon ?? '📄',
    blocks: input.blocks ?? [],
    isFavorite: input.isFavorite ?? false,
    archived: input.archived ?? false,
    orderIndex: input.orderIndex ?? Date.now(),
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: input.createdAt ?? now(),
    updatedAt: now(),
  };
}

/** Sayfayı ve TÜM alt ağacını siler (Şirket sunucusu'te FK cascade; yerelde elle). */
export async function deletePage(id: string, serverRevision?: number): Promise<void> {
  const list = await loadList<OfficePage>(KEYS.pages);
  const toDelete = new Set<string>();
  const collect = (pid: string) => {
    if (toDelete.has(pid)) return; // döngü guard (bozuk veride sonsuz özyineleme olmasın)
    toDelete.add(pid);
    list.filter(p => p.parentId === pid).forEach(c => collect(c.id));
  };
  collect(id);
  if (SUPABASE_CONFIGURED) {
    const expected = Object.assign({}, ...list.filter(p => toDelete.has(p.id)).map(snapshotVersions));
    if (serverRevision !== undefined) Object.assign(expected, snapshotVersions({ id, serverRevision }));
    const { error } = await supabase.from('office_pages').delete().in('id', Array.from(toDelete)).expectVersions(expected);
    if (error) throw new Error(`Sayfa silinemedi: ${error.message}`);
  }
  const next = list.filter(p => !toDelete.has(p.id));
  if (SUPABASE_CONFIGURED) await cacheConfirmed(KEYS.pages, next);
  else await saveList(KEYS.pages, next);
}

export async function toggleFavorite(id: string): Promise<void> {
  const p = await getPage(id);
  if (!p) return;
  await savePage({ id, serverRevision: p.serverRevision, isFavorite: !p.isFavorite });
}

/** id'in kendisi + tüm alt ağacı (taşımada döngüyü önlemek için). Döngüye karşı guard'lı. */
export function descendantIds(all: OfficePage[], id: string): Set<string> {
  const out = new Set<string>([id]);
  const walk = (pid: string) => all.filter(p => p.parentId === pid).forEach(c => {
    if (!out.has(c.id)) { out.add(c.id); walk(c.id); }
  });
  walk(id);
  return out;
}

/** Sayfayı başka bir ebeveyne (veya köke) taşır. Döngü oluşturacak hedef reddedilir. */
export async function movePage(id: string, newParentId: string | null): Promise<void> {
  if (newParentId) {
    const all = await listPages();
    if (descendantIds(all, id).has(newParentId)) {
      throw new Error('Bir sayfa kendi alt sayfasının altına taşınamaz.');
    }
  }
  const page = await getPage(id);
  if (!page) throw new Error('Sayfa bulunamadı. Listeyi yenileyin.');
  await savePage({ id, serverRevision: page.serverRevision, parentId: newParentId, orderIndex: Date.now() });
}

/**
 * Kardeşler arasında bir basamak yukarı/aşağı taşır. Eşit/çakışan orderIndex'lere
 * dayanıklı: tüm kardeş grubunu yeni sıraya göre kesin artan adımlarla yeniden numaralandırır.
 */
export async function reorderSibling(all: OfficePage[], id: string, dir: -1 | 1): Promise<void> {
  const me = all.find(p => p.id === id);
  if (!me) return;
  const sibs = childrenOf(all, me.parentId ?? null);
  const i = sibs.findIndex(p => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return;
  const ordered = sibs.slice();
  [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  // Yeni konuma göre kesin artan orderIndex (adım 1000) — eşit-index no-op'unu engeller.
  for (let k = 0; k < ordered.length; k++) {
    const want = (k + 1) * 1000;
    if (ordered[k].orderIndex !== want) await savePage({ id: ordered[k].id, serverRevision: ordered[k].serverRevision, orderIndex: want });
  }
}

// ── Son görüntülenenler ──
const RECENT_KEY = 'office_recent_v1';
export async function touchRecent(id: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    const next = [id, ...ids.filter(x => x !== id)].slice(0, 15);
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* sessiz */ }
}
export async function recentPageIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
/** Görüntülenme sırasına göre, arşivlenmemiş son sayfalar. */
export function orderByRecent(all: OfficePage[], ids: string[], limit = 8): OfficePage[] {
  const byId = new Map(all.map(p => [p.id, p]));
  const out: OfficePage[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p && !p.archived) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Arama (başlık + blok içeriği, aksan-duyarsız) ──
export interface OfficeSearchHit { page: OfficePage; snippet: string; }
export function searchPages(all: OfficePage[], term: string): OfficeSearchHit[] {
  const q = term.trim();
  if (!q) return [];
  return all
    .filter(p => !p.archived && matchesAnyField([p.title, pagePlainText(p)], q))
    .slice(0, 50)
    .map(p => ({ page: p, snippet: pagePlainText(p).slice(0, 120) }));
}

// =============================================================
// PANOLAR (Kanban)
// =============================================================
export const PRIORITY_LABEL: Record<OfficeCardPriority, string> = {
  low: 'Düşük', normal: 'Normal', high: 'Yüksek', urgent: 'Acil',
};
export const PRIORITY_COLOR: Record<OfficeCardPriority, string> = {
  low: '#64748b', normal: '#3b82f6', high: '#f59e0b', urgent: '#ef4444',
};

export function defaultColumns(): OfficeBoardColumn[] {
  return [
    { id: newUuid(), title: 'Yapılacak', color: '#64748b', cards: [] },
    { id: newUuid(), title: 'Devam Eden', color: '#3b82f6', cards: [] },
    { id: newUuid(), title: 'İncelemede', color: '#a855f7', cards: [] },
    { id: newUuid(), title: 'Tamamlandı', color: '#22c55e', cards: [] },
  ];
}

function boardToRow(b: OfficeBoard) {
  return {
    id: b.id,
    title: b.title,
    icon: b.icon,
    description: b.description ?? null,
    columns: b.columns,
    archived: b.archived,
    created_by: uuidOrNull(b.createdBy),
    created_by_name: b.createdByName ?? null,
    created_at: b.createdAt,
    updated_at: b.updatedAt ?? b.createdAt,
  };
}
function boardFromRow(r: any, serverRevision?: number): OfficeBoard {
  return {
    id: r.id,
    serverRevision,
    title: r.title ?? '',
    icon: r.icon ?? '📋',
    description: r.description ?? undefined,
    // Savunmasız deserializasyon koruması: her kolonun cards'ı her zaman dizi olsun.
    columns: Array.isArray(r.columns)
      ? r.columns.map((c: any) => ({ ...c, cards: Array.isArray(c?.cards) ? c.cards : [] }))
      : [],
    archived: !!r.archived,
    createdBy: r.created_by ?? undefined,
    createdByName: r.created_by_name ?? undefined,
    createdAt: r.created_at ?? now(),
    updatedAt: r.updated_at ?? undefined,
  };
}

export function listBoards(): Promise<OfficeBoard[]> {
  return coalescePortalRead(KEYS.boards, loadBoards);
}
async function loadBoards(): Promise<OfficeBoard[]> {
  if (!SUPABASE_CONFIGURED) return loadList<OfficeBoard>(KEYS.boards);
  const { data, error, versions } = await supabase.from('office_boards').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Sunucu ofis kayıt listesi doğrulanamadı.');
  const list = data.map((row: any) => boardFromRow(row, versions?.[row.id]));
  await cacheConfirmed(KEYS.boards, list);
  return list;
}

export async function getBoard(id: string): Promise<OfficeBoard | undefined> {
  return (await listBoards()).find(b => b.id === id);
}

export async function saveBoard(input: Partial<OfficeBoard> & { id?: string }): Promise<OfficeBoard> {
  const list = await loadList<OfficeBoard>(KEYS.boards);
  let board: OfficeBoard;
  const idx = input.id ? list.findIndex(b => b.id === input.id) : -1;
  if (idx >= 0) {
    board = { ...list[idx], ...input, id: input.id!, updatedAt: now() } as OfficeBoard;
    list[idx] = board;
  } else {
    board = {
      id: input.id || newUuid(),
      serverRevision: input.serverRevision,
      title: input.title ?? 'Adsız pano',
      icon: input.icon ?? '📋',
      description: input.description,
      columns: input.columns ?? defaultColumns(),
      archived: input.archived ?? false,
      createdBy: input.createdBy,
      createdByName: input.createdByName,
      createdAt: input.createdAt ?? now(),
      updatedAt: now(),
    };
    list.unshift(board);
  }
  if (SUPABASE_CONFIGURED) {
    const { data, error, versions } = await supabase.from('office_boards')
      .upsert(boardToRow(board)).expectVersions(snapshotVersions(board)).select().single();
    if (error) throw error;
    if (!data?.id) throw new Error('Sunucu pano kaydını doğrulamadı. Tekrar göndermeden önce kayıtları kontrol edin.');
    board = boardFromRow(data, versions?.[data.id]);
    await cacheConfirmed(KEYS.boards, list.map(b => b.id === board.id ? board : b));
  } else await saveList(KEYS.boards, list);
  return board;
}

export async function deleteBoard(id: string, serverRevision?: number): Promise<void> {
  const list = await loadList<OfficeBoard>(KEYS.boards);
  if (SUPABASE_CONFIGURED) {
    const snapshot = list.find(record => record.id === id);
    const { error } = await supabase.from('office_boards').delete().eq('id', id)
      .expectVersions(snapshotVersions({ id, serverRevision: serverRevision ?? snapshot?.serverRevision }));
    if (error) throw new Error(`Pano silinemedi: ${error.message}`);
  }
  const next = list.filter(record => record.id !== id);
  if (SUPABASE_CONFIGURED) await cacheConfirmed(KEYS.boards, next);
  else await saveList(KEYS.boards, next);
}

export function newCard(title: string): OfficeBoardCard {
  return { id: newUuid(), title, priority: 'normal' };
}

// ── Etiket & kontrol listesi (jsonb içinde — migration gerektirmez) ──
export const LABEL_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#64748b'];
export function newLabel(text: string, color = LABEL_COLORS[0]): OfficeLabel {
  return { text, color };
}
export function newChecklistItem(text: string): OfficeChecklistItem {
  return { id: newUuid(), text, done: false };
}
export function newAttachment(name: string, url: string): OfficeAttachment {
  return { id: newUuid(), name, url, kind: attachmentKind(name || url) };
}
/** Kontrol listesi ilerlemesi: {done, total, pct}. */
export function checklistProgress(card: OfficeBoardCard): { done: number; total: number; pct: number } {
  const items = card.checklist ?? [];
  const done = items.filter(i => i.done).length;
  const total = items.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// ── Termin durumu (gecikme/yaklaşma görsel vurgusu) ──
export type DueStatus = 'overdue' | 'today' | 'soon' | 'future' | 'none';
export function dueStatus(dueDate?: string): DueStatus {
  if (!dueDate) return 'none';
  const today = localDateISO();
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  // 3 gün içinde mi?
  const d = new Date(dueDate + 'T00:00:00');
  const t = new Date(today + 'T00:00:00');
  const diff = (d.getTime() - t.getTime()) / 86400000;
  return diff <= 3 ? 'soon' : 'future';
}
export const DUE_COLOR: Record<DueStatus, string> = {
  overdue: '#ef4444', today: '#f59e0b', soon: '#f59e0b', future: '#64748b', none: '#64748b',
};

/** Kartı kolonlar arası taşır (yeni columns dizisi döndürür — saf). */
export function moveCard(
  columns: OfficeBoardColumn[], cardId: string, toColumnId: string,
): OfficeBoardColumn[] {
  let moving: OfficeBoardCard | undefined;
  const stripped = columns.map(col => {
    const found = col.cards.find(c => c.id === cardId);
    if (found) moving = found;
    return { ...col, cards: col.cards.filter(c => c.id !== cardId) };
  });
  if (!moving) return columns;
  return stripped.map(col =>
    col.id === toColumnId ? { ...col, cards: [...col.cards, moving!] } : col,
  );
}

export function countCards(b: OfficeBoard): number {
  return b.columns.reduce((sum, c) => sum + c.cards.length, 0);
}

// =============================================================
// TOPLANTI NOTLARI
// =============================================================
function meetingToRow(m: OfficeMeeting) {
  return {
    id: m.id,
    title: m.title,
    date: m.date,
    time: m.time ?? null,
    attendees: m.attendees,
    notes: m.notes,
    action_items: m.actionItems,
    created_by: uuidOrNull(m.createdBy),
    created_by_name: m.createdByName ?? null,
    created_at: m.createdAt,
    updated_at: m.updatedAt ?? m.createdAt,
  };
}
function meetingFromRow(r: any, serverRevision?: number): OfficeMeeting {
  return {
    id: r.id,
    serverRevision,
    title: r.title ?? '',
    date: r.date ?? localDateISO(),
    time: r.time ?? undefined,
    attendees: Array.isArray(r.attendees) ? r.attendees : [],
    notes: r.notes ?? '',
    actionItems: Array.isArray(r.action_items) ? r.action_items : [],
    createdBy: r.created_by ?? undefined,
    createdByName: r.created_by_name ?? undefined,
    createdAt: r.created_at ?? now(),
    updatedAt: r.updated_at ?? undefined,
  };
}

export function listMeetings(): Promise<OfficeMeeting[]> {
  return coalescePortalRead(KEYS.meetings, loadMeetings);
}
async function loadMeetings(): Promise<OfficeMeeting[]> {
  if (!SUPABASE_CONFIGURED) return (await loadList<OfficeMeeting>(KEYS.meetings)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const { data, error, versions } = await supabase.from('office_meetings').select('*').order('date', { ascending: false });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Sunucu ofis kayıt listesi doğrulanamadı.');
  const list = data.map((row: any) => meetingFromRow(row, versions?.[row.id]));
  await cacheConfirmed(KEYS.meetings, list);
  return list;
}

export async function getMeeting(id: string): Promise<OfficeMeeting | undefined> {
  return (await listMeetings()).find(m => m.id === id);
}

export async function saveMeeting(input: Partial<OfficeMeeting> & { id?: string }): Promise<OfficeMeeting> {
  const list = await loadList<OfficeMeeting>(KEYS.meetings);
  let m: OfficeMeeting;
  const idx = input.id ? list.findIndex(x => x.id === input.id) : -1;
  if (idx >= 0) {
    m = { ...list[idx], ...input, id: input.id!, updatedAt: now() } as OfficeMeeting;
    list[idx] = m;
  } else {
    m = {
      id: input.id || newUuid(),
      serverRevision: input.serverRevision,
      title: input.title ?? 'Toplantı',
      date: input.date ?? localDateISO(),
      time: input.time,
      attendees: input.attendees ?? [],
      notes: input.notes ?? '',
      actionItems: input.actionItems ?? [],
      createdBy: input.createdBy,
      createdByName: input.createdByName,
      createdAt: input.createdAt ?? now(),
      updatedAt: now(),
    };
    list.unshift(m);
  }
  if (SUPABASE_CONFIGURED) {
    const { data, error, versions } = await supabase.from('office_meetings')
      .upsert(meetingToRow(m)).expectVersions(snapshotVersions(m)).select().single();
    if (error) throw error;
    if (!data?.id) throw new Error('Sunucu toplantı kaydını doğrulamadı. Tekrar göndermeden önce kayıtları kontrol edin.');
    m = meetingFromRow(data, versions?.[data.id]);
    await cacheConfirmed(KEYS.meetings, list.map(x => x.id === m.id ? m : x));
  } else await saveList(KEYS.meetings, list);
  return m;
}

export async function deleteMeeting(id: string, serverRevision?: number): Promise<void> {
  const list = await loadList<OfficeMeeting>(KEYS.meetings);
  if (SUPABASE_CONFIGURED) {
    const snapshot = list.find(record => record.id === id);
    const { error } = await supabase.from('office_meetings').delete().eq('id', id)
      .expectVersions(snapshotVersions({ id, serverRevision: serverRevision ?? snapshot?.serverRevision }));
    if (error) throw new Error(`Toplantı silinemedi: ${error.message}`);
  }
  const next = list.filter(record => record.id !== id);
  if (SUPABASE_CONFIGURED) await cacheConfirmed(KEYS.meetings, next);
  else await saveList(KEYS.meetings, next);
}

export function newActionItem(text: string): OfficeActionItem {
  return { id: newUuid(), text, done: false };
}

export function openActionItems(meetings: OfficeMeeting[]): OfficeActionItem[] {
  return meetings.flatMap(m => m.actionItems.filter(a => !a.done));
}

// =============================================================
// ÖZET (Hub istatistikleri)
// =============================================================
export interface OfficeStats {
  pages: number;
  favorites: number;
  boards: number;
  openCards: number;
  meetings: number;
  openActions: number;
}

export async function officeStats(): Promise<OfficeStats> {
  const [pages, boards, meetings] = await Promise.all([listPages(), listBoards(), listMeetings()]);
  const active = pages.filter(p => !p.archived);
  return {
    pages: active.length,
    favorites: active.filter(p => p.isFavorite).length,
    boards: boards.filter(b => !b.archived).length,
    openCards: boards.reduce((s, b) => s + countCards(b), 0),
    meetings: meetings.length,
    openActions: openActionItems(meetings).length,
  };
}

// =============================================================
// GERÇEK ZAMANLI (ekip eşzamanlılığı) — Şirket sunucusu realtime
// =============================================================
type OfficeTable = 'office_pages' | 'office_boards' | 'office_meetings';
/**
 * Tabloya gelen değişikliklerde cb() çağırır. SUPABASE_CONFIGURED değilse no-op.
 * Dönen fonksiyon aboneliği kapatır (useEffect cleanup'ında çağır).
 */
export function subscribeOffice(table: OfficeTable, cb: () => void): () => void {
  if (!SUPABASE_CONFIGURED) return () => {};
  try {
    const channel = supabase
      .channel(`office-${table}-${newUuid().slice(0, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => cb())
      .subscribe();
    return () => { try { supabase.removeChannel(channel); } catch { /* sessiz */ } };
  } catch {
    return () => {};
  }
}
