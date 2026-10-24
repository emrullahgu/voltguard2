/* Elektrik terimleri sözlüğü: sayfa içi süzme. Türkçe büyük/küçük harf ve aksan farkı gözetilmez. */
(function () {
  'use strict';
  var q = document.getElementById('gl-q'), empty = document.getElementById('gl-empty');
  if (!q) return;
  var fold = function (s) {
    return String(s).toLocaleLowerCase('tr').replace(/[ıİ]/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
      .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[âî]/g, function (c) { return c === 'â' ? 'a' : 'i'; });
  };
  var items = Array.prototype.map.call(document.querySelectorAll('.gl-term'), function (el) {
    return { el: el, text: fold(el.getAttribute('data-terms') + ' ' + el.textContent) };
  });
  var letters = document.querySelectorAll('.gl-letter');
  q.hidden = false;
  q.addEventListener('input', function () {
    var words = fold(q.value).split(/\s+/).filter(Boolean), shown = 0;
    items.forEach(function (it) {
      var ok = words.every(function (w) { return it.text.indexOf(w) !== -1; });
      it.el.hidden = !ok; if (ok) shown++;
    });
    // Boş kalan harf başlıklarını gizle
    Array.prototype.forEach.call(letters, function (h) {
      var dl = h.nextElementSibling;
      h.hidden = dl.hidden = !dl.querySelector('.gl-term:not([hidden])');
    });
    empty.hidden = shown > 0;
    empty.textContent = shown ? '' : '“' + q.value + '” için sözlükte sonuç yok. Tüm sitede aramak için ';
    if (!shown) {
      var a = document.createElement('a'); a.href = '/arama.html?q=' + encodeURIComponent(q.value); a.textContent = 'site aramasını kullanın';
      empty.appendChild(a); empty.appendChild(document.createTextNode('.'));
    }
  });
})();
