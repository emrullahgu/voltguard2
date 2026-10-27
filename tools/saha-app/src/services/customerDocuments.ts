// ====================================================================
// customerDocuments — POZ-DEV-045
// Müşteri belgeleri. expo-document-picker / expo-image-picker zorunlu değil:
// kayıt sırasında uri (file://… veya Şirket sunucusu Storage URL) verilir.
// Dosya özel çalışan deposuna yüklendikten sonra ortak belge kaydı oluşturulur.
// ====================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CustomerDocument } from '../types';
import { supabase } from './supabase';

const KEY = '@SahaTakip:customer_documents';
const BUCKET = 'customer-docs';

export async function listDocuments(): Promise<CustomerDocument[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as CustomerDocument[]) : [];
}

export async function listDocumentsByCustomer(customerId: string): Promise<CustomerDocument[]> {
  const all = await listDocuments();
  return all
    .filter(d => d.customerId === customerId)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function saveDocuments(list: CustomerDocument[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

/**
 * Belge ekler. uri lokal (file://…) ya da indirilebilir URL olabilir.
 * Online modda supabase Storage'a yüklemeye çalışır.
 */
export async function addDocument(
  doc: Omit<CustomerDocument, 'id' | 'uploadedAt'>,
): Promise<CustomerDocument> {
  const url = new URL(doc.uri, window.location.origin);
  let finalUri = doc.uri;
  let storagePath = doc.storagePath;
  if (url.origin === window.location.origin && url.pathname === '/api/saha-asset.php') {
    finalUri = url.pathname + url.search;
    if (url.searchParams.get('bucket') === BUCKET) storagePath = url.searchParams.get('path') || undefined;
  } else {
    if (!['blob:', 'data:'].includes(url.protocol)) throw new Error('Belgeyi cihazınızdan seçin. Dosya yüklenmedi.');
    const response = await fetch(doc.uri);
    if (!response.ok) throw new Error('Seçilen belge okunamadı.');
    const blob = await response.blob();
    if (!blob.size || blob.size > 1048576) throw new Error('Belge en fazla 1 MB olabilir. Yükleme yapılmadı.');
    const ext = (doc.name.match(/\.([A-Za-z0-9]+)$/)?.[1] || 'bin').toLowerCase();
    storagePath = `${doc.customerId.replace(/[^A-Za-z0-9_-]/g, '_')}/${globalThis.crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, blob, { contentType: blob.type || doc.mimeType || 'application/octet-stream', upsert: false });
    if (error) throw error;
    finalUri = supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
  }

  const newDoc: CustomerDocument = {
    ...doc,
    id: `doc-${globalThis.crypto.randomUUID()}`,
    uploadedAt: new Date().toISOString(),
    uri: finalUri,
    storagePath,
  };
  const all = await listDocuments();
  all.unshift(newDoc);
  await saveDocuments(all);
  return newDoc;
}

export async function deleteDocument(id: string) {
  const all = await listDocuments();
  const target = all.find(d => d.id === id);
  await saveDocuments(all.filter(d => d.id !== id));
  if (target?.storagePath) {
    // The metadata commit removes access from the document list first.
    const { error } = await supabase.storage.from(BUCKET).remove([target.storagePath]);
    if (error) throw new Error('Belge listeden kaldırıldı; dosya temizliği tamamlanamadı.');
  }
}
