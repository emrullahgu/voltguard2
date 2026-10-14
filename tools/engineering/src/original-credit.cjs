'use strict';

const author = 'Baki SONAY';
const sourceName = 'Sonay Enerji';
const profileUrl = 'https://tr.linkedin.com/in/baki-sonay-468a2b1a8';
const thankYou = 'Paylaştığı özgün hesap araçları ve açık kaynak katkıları için teşekkür ederiz.';
const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

function html({ compact = false } = {}) {
  return `<aside class="vg-source-credit${compact ? ' vg-source-credit--compact' : ''}" aria-label="Özgün araçların geliştiricisine teşekkür"><strong>Özgün hesap araçları: <a href="${profileUrl}" target="_blank" rel="noopener noreferrer">${author}</a></strong><p>Elektrik-Elektronik Mühendisi · ${sourceName} · Bağımsız geliştirici</p><p>${escape(thankYou)}</p><small>25 özgün aracın site uyarlaması: VoltGuard. Diğer araçların kaynakları kendi yöntem açıklamalarında belirtilir.</small></aside>`;
}

module.exports = { author, sourceName, profileUrl, thankYou, html };
