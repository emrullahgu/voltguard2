import {reportPortalError} from '../portal/api';
// ====================================================================
// Selected photos and attachments are saved to the private employee store.
// The returned URL remains protected by staff authentication; failed uploads
// never fall back to a temporary browser URI or a public storage address.
// ====================================================================
import { supabase } from './supabase';

const BUCKET = 'photos';

/**
 * Seçilen fotoğrafı özel çalışan deposuna yükler ve korumalı bağlantı döner.
 * @param localUri ImagePicker'dan dönen web blob/data URI'si
 * @param folder Klasör örn. "work-orders/abc-id" / "expenses/xy-id"
 */
async function sourceBlob(uri: string): Promise<Blob> {
  const url = new URL(uri, window.location.origin);
  if (!['blob:', 'data:'].includes(url.protocol) && !(url.origin === window.location.origin && url.pathname === '/api/saha-asset.php')) throw new Error('Dosyayı bu çalışan uygulamasından seçin. Dış bağlantıdan dosya alınmadı.');
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Seçilen dosya okunamadı. Yeniden seçin.');
  return response.blob();
}
function alreadyPrivate(uri: string) {
  const url = new URL(uri, window.location.origin);
  return url.origin === window.location.origin && url.pathname === '/api/saha-asset.php';
}
async function preparePhoto(blob: Blob): Promise<Blob> {
  if (blob.size <= 1048576 && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(blob.type)) return blob;
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Fotoğraf açılamadı. JPEG veya PNG seçin.')); img.src = url;
    });
    for (const edge of [1600, 1200, 900, 640]) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Fotoğraf hazırlanamadı.');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Fotoğraf hazırlanamadı.')), 'image/jpeg', 0.82));
      if (result.size <= 1048576) return result;
    }
    throw new Error('Fotoğraf 1 MB sınırına küçültülemedi. Daha küçük bir fotoğraf seçin.');
  } finally { URL.revokeObjectURL(url); }
}
async function store(blob: Blob, folder: string, extension: string, originalName?: string): Promise<string> {
  if (!blob.size || blob.size > 1048576) throw new Error('Dosya en fazla 1 MB olabilir. Yükleme yapılmadı.');
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(folder) || folder.includes('..') || folder.includes('//')) throw new Error('Dosya klasörü geçerli değil.');
  const stem = (originalName || 'file').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40);
  const path = `${folder.replace(/\/$/, '')}/${globalThis.crypto.randomUUID()}-${stem}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Yüklenen özel dosya bağlantısı alınamadı.');
  return data.publicUrl;
}
export async function uploadPhoto(localUri: string, folder: string): Promise<string> {
  try {
    if (!localUri) throw new Error('Önce bir fotoğraf seçin.');
    if (alreadyPrivate(localUri)) return localUri;
    const blob = await preparePhoto(await sourceBlob(localUri));
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : blob.type === 'image/gif' ? 'gif' : 'jpg';
    return await store(blob, folder, ext);
  } catch (error) { throw reportPortalError(error); }
}

// ====================================================================
// uploadAttachment — Generic dosya yükleyici (pdf, video, görüntü, diğer).
// uploadPhoto ile aynı bucket/akış, ama content-type uzantıdan tahmin edilir
// ve özgün dosya adı korunur. Ofis görev ekleri vb. için.
// ====================================================================
const ATTACH_MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', heic: 'image/heic', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip', txt: 'text/plain', csv: 'text/csv',
};
export type AttachmentKind = 'image' | 'video' | 'pdf' | 'audio' | 'other';
export function attachmentKind(nameOrUri: string): AttachmentKind {
  const ext = (nameOrUri.split('.').pop() || '').toLowerCase().split('?')[0];
  if (['png', 'jpg', 'jpeg', 'webp', 'heic', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'm4v', '3gp', 'avi', 'mkv'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (['mp3', 'm4a', 'wav', 'aac'].includes(ext)) return 'audio';
  return 'other';
}

/**
 * Seçilen dosyayı özel çalışan deposuna yükler, korumalı bağlantı döner.
 * @param localUri kaynak web blob/data URI'si
 * @param folder klasör (örn. "office/cards/<cardId>")
 * @param originalName özgün dosya adı (uzantı/MIME için)
 */
export async function uploadAttachment(localUri: string, folder: string, originalName?: string): Promise<string> {
  try {
    if (!localUri) throw new Error('Önce bir dosya seçin.');
    if (alreadyPrivate(localUri)) return localUri;
    const source = await sourceBlob(localUri);
    const ext = ((originalName || '').split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin';
    const contentType = ATTACH_MIME[ext] || source.type || 'application/octet-stream';
    const blob = source.type === contentType ? source : new Blob([source], { type: contentType });
    return await store(blob, folder, ext, originalName);
  } catch (error) { throw reportPortalError(error); }
}
