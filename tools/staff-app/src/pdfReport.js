import { COMPANY_NAME, COMPANY_CONTACT_LINE } from './companyInfo';
import { sanitizeReportHTML } from './safeReportHTML.mjs';

const FONT = 'VoltGuardNoto';
let fontPromise;
let pdfLibrary;
function loadPDFLibrary() {
  if (!pdfLibrary) pdfLibrary = Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([{ default: jsPDF }, { applyPlugin }]) => {
    applyPlugin(jsPDF);
    return jsPDF;
  }).catch(error => { pdfLibrary = undefined; throw error; });
  return pdfLibrary;
}

export const reportDate = (value = new Date()) => {
  if (!value) return 'Belirtilmedi';
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(String(value))) { const [day, month, year] = String(value).split('.'); value = `${year}-${month}-${day}`; }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Geçersiz tarih' : date.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
};

export const reportDateISO = (value = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(value));

export const reportDecimal = value => {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return value;
  let text = String(value).trim().replace(/\s/g, '');
  if (text.includes(',')) text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  return Number(text);
};

export const reportNumber = (value, decimals = 2) => {
  const number = reportDecimal(value);
  return Number.isFinite(number) ? number.toLocaleString('tr-TR', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  }) : 'Belirtilmedi';
};
export const reportMoney = value => `${reportNumber(value)} TL`;

export const reportFileName = (prefix, subject = '', extension = 'pdf') => {
  const safe = String(subject).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').replace(/[. ]+$/g, '').slice(0, 100);
  return [prefix, safe, reportDateISO()].filter(Boolean).join('_') + '.' + extension;
};

const plainText = value => String(value ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\p{Emoji_Presentation}\uFE0F?/gu, '');

async function loadFonts() {
  if (!fontPromise) fontPromise = Promise.all(['Regular', 'Bold'].map(async style => {
    const response = await fetch(`${import.meta.env?.BASE_URL || '/'}fonts/NotoSans-${style}.ttf`, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Türkçe PDF yazı tipi yüklenemedi. Sayfayı yenileyip tekrar deneyin.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  })).catch(error => { fontPromise = undefined; throw error; });
  return fontPromise;
}

/** Every company report embeds the same Unicode font and reserves the footer area. */
export async function createReportPDF(options = {}) {
  const [fonts, jsPDF] = await Promise.all([loadFonts(), loadPDFLibrary()]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, ...options });
  ['normal', 'bold'].forEach((style, index) => {
    const name = `NotoSans-${index ? 'Bold' : 'Regular'}.ttf`;
    doc.addFileToVFS(name, fonts[index]);
    doc.addFont(name, FONT, style);
  });
  const setFont = doc.setFont.bind(doc);
  doc.setFont = (_family, style = 'normal') => setFont(FONT, /bold/i.test(style) ? 'bold' : 'normal');
  doc.setFont(FONT, 'normal');
  doc.setProperties({ title: options.title || 'VoltGuard Şirket Raporu', author: COMPANY_NAME, creator: 'VoltGuard Şirket Portalı', subject: 'Şirket içi belge' });
  const text = doc.text.bind(doc);
  doc.text = (value, ...args) => text(Array.isArray(value) ? value.map(plainText) : plainText(value), ...args);
  const autoTable = doc.autoTable.bind(doc);
  doc.autoTable = (table = {}) => {
    const margin = { top: 16, bottom: 20, left: 14, right: 14, ...(typeof table.margin === 'object' ? table.margin : {}) };
    margin.bottom = Math.max(20, margin.bottom);
    const columnStyles = Object.fromEntries(Object.entries(table.columnStyles || {}).map(([key, style]) => [key, { ...style, font: FONT }]));
    const columns = Object.values(columnStyles);
    const fixedWidth = columns.reduce((sum, style) => sum + (typeof style.cellWidth === 'number' ? style.cellWidth : 0), 0);
    const available = doc.internal.pageSize.getWidth() - margin.left - margin.right;
    if (fixedWidth > available) for (const style of columns) if (typeof style.cellWidth === 'number') style.cellWidth *= available / fixedWidth;
    return autoTable({ ...table, margin, showHead: 'everyPage', showFoot: 'lastPage', rowPageBreak: 'avoid',
      styles: { fontSize: 9, cellPadding: 2.5, overflow: 'linebreak', ...table.styles, font: FONT },
      headStyles: { fillColor: [24, 57, 95], textColor: 255, fontStyle: 'bold', ...table.headStyles, font: FONT },
      bodyStyles: { ...table.bodyStyles, font: FONT }, footStyles: { ...table.footStyles, font: FONT }, columnStyles
    });
  };
  const save = doc.save.bind(doc);
  doc.save = (filename, ...args) => {
    addReportFooter(doc);
    return save(filename, ...args);
  };
  return doc;
}

export function addReportFooter(doc) {
  const total = doc.internal.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    doc.setFont(FONT, 'normal'); doc.setFontSize(7); doc.setTextColor(91, 105, 120);
    doc.setDrawColor(209, 217, 227); doc.setLineWidth(0.2); doc.line(14, height - 15, width - 14, height - 15);
    doc.text(`${COMPANY_NAME} | Şirket içi belge`, 14, height - 10);
    doc.text(COMPANY_CONTACT_LINE, 14, height - 6);
    doc.text(`Sayfa ${page} / ${total}`, width - 14, height - 8, { align: 'right' });
  }
  return doc;
}

export function writeReportParagraph(doc, value, { x = 14, y = 20, width, lineHeight = 5 } = {}) {
  const lines = doc.splitTextToSize(plainText(value), width || doc.internal.pageSize.getWidth() - x - 14);
  for (const line of lines) {
    if (y + lineHeight > doc.internal.pageSize.getHeight() - 21) { doc.addPage(); y = 20; }
    doc.text(line, x, y); y += lineHeight;
  }
  return y;
}

export function fitReportImage(doc, image, x, y, maxWidth = 40, maxHeight = 25) {
  const info = doc.getImageProperties(image);
  const scale = Math.min(maxWidth / info.width, maxHeight / info.height);
  doc.addImage(image, info.fileType, x, y, info.width * scale, info.height * scale, undefined, 'FAST');
}

export async function exportTableReport({ title, subtitle, head, body, summary = [], filename, orientation = 'landscape' }) {
  if (!body?.length) throw new Error('Seçili filtrelere uygun kayıt yok. Rapor oluşturmak için en az bir kayıt gerekir.');
  const doc = await createReportPDF({ orientation, title });
  doc.setFont(undefined, 'bold'); doc.setFontSize(17); doc.setTextColor(24, 57, 95);
  let y = writeReportParagraph(doc, title, { y: 22, lineHeight: 8 });
  doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(60);
  y = writeReportParagraph(doc, subtitle || `Rapor tarihi: ${reportDate()}`, { y: y + 2 });
  if (summary.length) {
    doc.autoTable({ startY: y + 4, head: [['Özet', 'Değer']], body: summary, tableWidth: 150, theme: 'grid' });
    y = doc.lastAutoTable.finalY + 7;
  }
  doc.autoTable({ startY: y + 4, head: [head], body, theme: 'striped' });
  if (filename) doc.save(filename);
  return doc;
}

function reportContentHeight(canvas) {
  const context = canvas.getContext('2d');
  // A4 min-height and the removed HTML footer reserve can leave white padding.
  // It must not create another PDF page or move the last total to a continuation.
  for (let bottom = canvas.height; bottom > 0;) {
    const height = Math.min(128, bottom), top = bottom - height;
    const pixels = context.getImageData(0, top, canvas.width, height).data;
    for (let row = height - 1; row >= 0; row--) {
      const first = row * canvas.width * 4, last = first + canvas.width * 4;
      for (let pixel = first; pixel < last; pixel += 4) {
        if (pixels[pixel + 3] && (pixels[pixel] < 255 || pixels[pixel + 1] < 255 || pixels[pixel + 2] < 255)) return top + row + 1;
      }
    }
    bottom = top;
  }
  return 0;
}

/** Capture a detached clone, preserve edited HTML, and split oversized pages without clipping. */
export async function exportHTMLReport({ root, selector, filename, title = 'VoltGuard Raporu' }) {
  if (!root) throw new Error('Rapor önizlemesi bulunamadı. Önizlemeyi açıp tekrar deneyin.');
  const { default: html2canvas } = await import('html2canvas');
  if (document.fonts?.ready) await document.fonts.ready;
  const sources = [...(selector ? root.querySelectorAll(selector) : [])];
  if (!sources.length) sources.push(root);
  const doc = await createReportPDF({ title });
  let pageCount = 0;
  for (const source of sources) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;width:210mm;background:#fff;z-index:-1;';
    const clone = source.cloneNode(true);
    // Clean a detached copy before it enters the live document. Preserve charts
    // created by the report while excluding executable or interactive content.
    clone.innerHTML = sanitizeReportHTML(clone.innerHTML, { allowSVG: true });
    clone.style.width = '210mm'; clone.style.maxWidth = 'none'; clone.style.height = 'auto';
    clone.style.minHeight = '297mm'; clone.style.margin = '0'; clone.style.boxShadow = 'none'; clone.style.overflow = 'visible';
    clone.classList.add('pdf-exporting');
    clone.querySelectorAll('.no-print,.print-hide,button').forEach(node => node.remove());
    clone.querySelectorAll('[contenteditable]').forEach(node => node.removeAttribute('contenteditable'));
    clone.querySelectorAll('div').forEach(node => {
      const footerPosition = node.style.position === 'absolute' || node.className.includes('absolute');
      const atBottom = node.style.bottom || /bottom-/.test(node.className);
      if (footerPosition && atBottom && /Sayfa\s+\d/i.test(node.textContent)) node.remove();
    });
    // Older saved pages kept their reference above the selected page wrappers.
    // Preserve it when each page is captured separately.
    const reference = root.querySelector('[data-vg-reference]')?.textContent?.trim();
    if (reference && !clone.querySelector('[data-vg-reference]')) {
      const line = document.createElement('p');
      line.style.cssText = 'font-size:9pt;line-height:1.3;margin:0 0 8px;color:#475569;';
      line.textContent = `Referans: ${reference}`;
      clone.prepend(line);
    }
    // Production utilities are scoped to the company workspace. Moving a report
    // outside that scope drops its typography, table layout and box sizing.
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    host.appendChild(clone);
    (root.closest('#vg-company-workspace') || document.body).appendChild(host);
    try {
      const images = [...clone.querySelectorAll('img')];
      await Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
        const timer = setTimeout(resolve, 6000);
        image.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
        image.addEventListener('error', () => { clearTimeout(timer); resolve(); }, { once: true });
      })));
      const canvas = await html2canvas(clone, { scale: 2, width: clone.offsetWidth, height: Math.max(clone.scrollHeight, clone.offsetHeight),
        windowWidth: 1100, useCORS: true, allowTaint: false, logging: false, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 });
      if (!canvas.width || !canvas.height) throw new Error('Rapor görüntüsü oluşturulamadı.');
      const contentHeight = reportContentHeight(canvas);
      if (!contentHeight) continue;
      const widthMM = 190;
      // Prefer existing row boundaries, so table text does not straddle a page break.
      const rect = clone.getBoundingClientRect();
      const tableHead = clone.querySelector('thead');
      let headerImage, headerHeightMM = 0, tableStart = 0, tableEnd = 0;
      if (tableHead) {
        const box = tableHead.getBoundingClientRect();
        const tableBox = tableHead.closest('table').getBoundingClientRect();
        tableStart = Math.round((tableBox.top - rect.top) * 2);
        tableEnd = Math.round((tableBox.bottom - rect.top) * 2);
        const header = document.createElement('canvas');
        header.width = canvas.width; header.height = Math.max(1, Math.round(box.height * 2));
        header.getContext('2d').drawImage(canvas, 0, Math.round((box.top - rect.top) * 2), canvas.width, header.height, 0, 0, canvas.width, header.height);
        headerImage = header.toDataURL('image/jpeg', 0.96);
        headerHeightMM = header.height * widthMM / canvas.width;
      }
      const boundaries = [...clone.querySelectorAll('tr,p,li')].flatMap(element => {
        const box = element.getBoundingClientRect();
        return [Math.round((box.top - rect.top) * 2), Math.round((box.bottom - rect.top) * 2)];
      }).filter(y => y > 0).sort((a, b) => a - b);
      for (let offset = 0; offset < contentHeight;) {
        const continuation = offset > 0;
        const repeatHeader = continuation && headerImage && offset > tableStart && offset < tableEnd;
        const imageTop = continuation ? 20 + (repeatHeader ? headerHeightMM : 0) : 8;
        const maximumPixels = Math.floor((281 - imageTop) * canvas.width / widthMM);
        let end = Math.min(offset + maximumPixels, contentHeight);
        if (end < contentHeight) {
          const boundary = boundaries.filter(y => y > offset + maximumPixels * 0.65 && y <= end).pop();
          if (boundary) end = boundary;
        }
        const height = Math.max(1, end - offset);
        const slice = document.createElement('canvas'); slice.width = canvas.width; slice.height = height;
        slice.getContext('2d').drawImage(canvas, 0, offset, canvas.width, height, 0, 0, canvas.width, height);
        if (pageCount++) doc.addPage();
        if (continuation) {
          doc.setFont(undefined, 'bold'); doc.setFontSize(9); doc.setTextColor(24, 57, 95);
          doc.text(`${title} - devam`, 10, 13);
          if (repeatHeader) doc.addImage(headerImage, 'JPEG', 10, 18, widthMM, headerHeightMM, undefined, 'FAST');
        }
        doc.addImage(slice.toDataURL('image/jpeg', 0.96), 'JPEG', 10, imageTop, widthMM, height * widthMM / canvas.width, undefined, 'FAST');
        offset = end;
      }
    } finally { host.remove(); }
  }
  if (!pageCount) throw new Error('PDF oluşturmak için rapora içerik ekleyin.');
  doc.save(filename);
  return doc;
}
