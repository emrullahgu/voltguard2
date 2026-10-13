import DOMPurify from 'dompurify';
export function sanitizeReportHTML(value, { allowSVG = false } = {}) {
 return DOMPurify.sanitize(String(value ?? ''), { USE_PROFILES:{html:true,...(allowSVG ? {svg:true,svgFilters:true} : {})}, FORBID_TAGS:['script','style','iframe','object','embed','form','input','button','textarea','select','link','meta','foreignObject'], FORBID_ATTR:['srcdoc'], ALLOW_DATA_ATTR:false, ADD_ATTR:['data-vg-reference'] });
}
export function pasteReportHTML(event) {
 event.preventDefault();const data=event.clipboardData || event.dataTransfer;const html=data?.getData('text/html'),text=data?.getData('text/plain') || '';
 document.execCommand(html?'insertHTML':'insertText',false,html?sanitizeReportHTML(html):text);
}

export function reportHTMLWithReference(value, reference) {
 const html=sanitizeReportHTML(value);if(!html)return '';const template=document.createElement('template');template.innerHTML=html;
 let markers=[...template.content.querySelectorAll('[data-vg-reference]')];
 if(!markers.length){const line=document.createElement('div');line.className='vg-reference-line';line.textContent='Referans: ';const marker=document.createElement('span');marker.setAttribute('data-vg-reference','');line.append(marker);template.content.prepend(line);markers=[marker];}
 for(const marker of markers)marker.textContent=String(reference || 'TASLAK');return template.innerHTML;
}
