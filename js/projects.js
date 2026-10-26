/* Progressively enhance the public project gallery; all real work stays visible without JS. */
(function () {
  'use strict';
  var controls = document.getElementById('projectFilters');
  var gallery = document.getElementById('projectGallery');
  var search = document.getElementById('projectSearch');
  var clear = document.getElementById('projectClear');
  var reset = document.getElementById('projectReset');
  var count = document.getElementById('projectResultCount');
  var empty = document.getElementById('projectEmpty');
  if (!controls || !gallery || !search || !clear || !reset || !count || !empty) return;

  function normalize(value) {
    var text = String(value || '');
    if (text.normalize) text = text.normalize('NFKD');
    return text.replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  var buttons = Array.prototype.slice.call(controls.querySelectorAll('[data-vgp-filter]'));
  var cards = Array.prototype.slice.call(gallery.querySelectorAll('[data-vgp-category]')).map(function (card) {
    var content = Array.prototype.map.call(card.querySelectorAll('.project-card__tags,.project-card__title,.project-card__desc,.project-card__meta'), function (part) { return part.textContent; }).join(' ');
    return { element: card, categories: card.getAttribute('data-vgp-category').split(/\s+/), text: normalize(content) };
  });
  if (!cards.length || !buttons.length) return;
  var category = 'all';
  function apply() {
    var query = normalize(search.value);
    var words = query ? query.split(' ') : [];
    var shown = 0;
    cards.forEach(function (card) {
      var matches = (category === 'all' || card.categories.indexOf(category) !== -1) && words.every(function (word) { return card.text.indexOf(word) !== -1; });
      card.element.hidden = !matches;
      if (matches) shown++;
    });
    buttons.forEach(function (button) { button.setAttribute('aria-pressed', String(button.getAttribute('data-vgp-filter') === category)); });
    clear.hidden = search.value.length === 0;
    reset.hidden = category === 'all' && search.value.length === 0;
    empty.hidden = shown !== 0;
    count.textContent = shown + ' / ' + cards.length + ' saha çalışması gösteriliyor.';
  }
  buttons.forEach(function (button) {
    button.addEventListener('click', function () { category = button.getAttribute('data-vgp-filter'); apply(); });
  });
  search.addEventListener('input', apply);
  clear.addEventListener('click', function () { search.value = ''; apply(); search.focus(); });
  reset.addEventListener('click', function () { category = 'all'; search.value = ''; apply(); search.focus(); });
  apply();
  controls.hidden = false;
}());
