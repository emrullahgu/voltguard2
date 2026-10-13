/* Site navigation and game layout live separately so gameplay owns its keys and canvas. */
(function () {
  'use strict';
  var frame = document.getElementById('voltgameFrame');
  var stage = document.getElementById('gameStage');
  var toggle = document.getElementById('gameFullscreen');
  var label = toggle && toggle.querySelector('[data-game-fullscreen-label]');
  var status = document.getElementById('gameStatus');
  if (!frame || !stage || !toggle) return;
  var fallback = false;
  var covered = [];
  var full = function () { return fallback || document.fullscreenElement === stage || document.webkitFullscreenElement === stage; };
  function updateFullscreen() {
    var active = full();
    toggle.setAttribute('aria-pressed', String(active));
    toggle.setAttribute('aria-label', active ? 'Tam ekrandan çık' : 'Tam ekran oyna');
    if (label) label.textContent = active ? 'Tam ekrandan çık' : 'Tam ekran';
    document.body.classList.toggle('game-expanded', active);
  }
  function fallbackFullscreen() {
    var branch = stage;
    while (branch.parentElement && branch !== document.body) {
      var parent = branch.parentElement;
      Array.prototype.forEach.call(parent.children, function (element) {
        if (element === branch || /^(SCRIPT|STYLE|LINK)$/.test(element.tagName)) return;
        covered.push({element:element,inert:element.hasAttribute('inert')});
        element.setAttribute('inert', '');
      });
      branch = parent;
    }
    fallback = true;
    stage.classList.add('is-expanded');
    updateFullscreen();
    toggle.focus({preventScroll:true});
  }
  function leaveFullscreen() {
    if (fallback) {
      fallback = false;
      stage.classList.remove('is-expanded');
      covered.forEach(function (item) { if (!item.inert) item.element.removeAttribute('inert'); });
      covered = [];
      updateFullscreen();
      toggle.focus({preventScroll:true});
      return;
    }
    var exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) {
      try { var leaving = exit.call(document); if (leaving && leaving.catch) leaving.catch(function () {}); }
      catch (_) { /* Browser keeps its own fullscreen exit control. */ }
    }
  }
  toggle.addEventListener('click', function () {
    if (full()) { leaveFullscreen(); return; }
    var enter = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (!enter) { fallbackFullscreen(); return; }
    try {
      var entering = enter.call(stage);
      if (entering && entering.catch) entering.catch(fallbackFullscreen);
    } catch (_) { fallbackFullscreen(); }
  });
  document.addEventListener('fullscreenchange', updateFullscreen);
  document.addEventListener('webkitfullscreenchange', updateFullscreen);
  function escape(event) { if (event.key === 'Escape' && fallback) leaveFullscreen(); }
  document.addEventListener('keydown', escape);
  document.addEventListener('focusin', function (event) {
    if (fallback && !stage.contains(event.target)) toggle.focus({preventScroll:true});
  });
  frame.addEventListener('load', function () {
    if (status) status.hidden = true;
    try { frame.contentWindow.addEventListener('keydown', escape); } catch (_) { /* Same-origin game is required. */ }
  });
  function gameURL() {
    var url = new URL('/public/voltgame/oyun.html', location.origin);
    var query = new URLSearchParams(location.search);
    ['lvl', 'daily', 'debug', 'nostorage', 'kalite'].forEach(function (key) {
      if (query.has(key)) url.searchParams.set(key, query.get(key));
    });
    if (/^#PX2-/.test(location.hash)) url.hash = location.hash;
    return url;
  }
  var initialURL = gameURL();
  if (frame.src !== initialURL.href) frame.src = initialURL.href;
  window.addEventListener('hashchange', function () {
    if (!/^#PX2-/.test(location.hash)) return;
    var next = gameURL();
    if (frame.src !== next.href) frame.src = next.href;
  });
  window.addEventListener('message', function (event) {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'voltgame:ready' && status) status.hidden = true;
    if (event.data.type === 'voltgame:hash' && typeof event.data.hash === 'string' && /^#PX2-[A-Za-z0-9_.~-]+$/.test(event.data.hash) && event.data.hash.length < 16000) {
      history.replaceState(null, '', location.pathname + location.search + event.data.hash);
    }
  });
  updateFullscreen();
}());
