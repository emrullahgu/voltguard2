// ====================================================================
// expenses — masraf kalıcılığı (Şirket sunucusunda doğrulanmış kayıtlar)
// Şema: public.expenses (id,date,category,description,amount,created_by,...)
// ====================================================================

import { supabase } from './supabase';
import { auditRepo } from './data/auditRepo';

export interface Expense {
  id: string;
  type: string;        // category
  amount: number;
  date: string;        // YYYY-MM-DD
  description: string;
  status: 'Bekliyor' | 'Onaylandı';
  createdBy?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fromRow(r: any): Expense {
  return {
    id: r.id,
    type: r.category ?? 'Diğer',
    amount: Number(r.amount ?? 0),
    date: (r.date ?? '').slice(0, 10),
    description: r.description ?? '',
    status: 'Bekliyor',
    createdBy: r.created_by ?? null,
  };
}

function toRow(e: Expense): Record<string, any> {
  const row: Record<string, any> = {
    category: e.type,
    amount: e.amount,
    description: e.description ?? null,
    date: e.date,
  };
  if (UUID_RE.test(e.id)) row.id = e.id;
  if (e.createdBy) row.created_by = e.createdBy;
  return row;
}

/** Expenses are committed to the shared database before success is returned. */
export async function listExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase.from('expenses').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(fromRow);
}
export async function addExpense(input: Omit<Expense, 'id' | 'status'> & Partial<Pick<Expense, 'status'>>): Promise<Expense> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Pozitif ve geçerli bir masraf tutarı girin.');
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user?.id) throw new Error('Çalışan oturumu doğrulanamadı.');
  const expense: Expense = { ...input, id: globalThis.crypto.randomUUID(), status: 'Bekliyor', createdBy: auth.user.id };
  const { data, error } = await supabase.from('expenses').insert(toRow(expense)).select().single();
  if (error) throw error;
  if (!data?.id) throw new Error('Masraf kaydı sunucuda doğrulanamadı.');
  const saved = fromRow(data);
  void auditRepo.log(auth.user.id, { action: 'expense.create', tableName: 'expenses', refId: saved.id, meta: { category: saved.type, amount: saved.amount } }).catch((e: unknown) => console.warn('[expenses.audit]', e));
  return saved;
}
export async function deleteExpense(id: string): Promise<void> {
  const { data, error } = await supabase.from('expenses').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!Array.isArray(data) || !data.some((row: any) => row.id === id)) throw new Error('Masraf silinemedi: kayıt bulunamadı veya erişiminiz yok.');
}
