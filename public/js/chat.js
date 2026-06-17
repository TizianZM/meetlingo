// MeetLingo Chat — shared conversation renderer for host + listener.
// One card per speaker turn: header "Name + LANG", the original (foreign)
// text, and below it a box with the translation into the viewer's language.
// Source deltas (original speech) and translation deltas (output transcript)
// for the same speaker are merged into the same card until the turn finalizes.
(function () {
  'use strict';

  var LANG_CODE = {
    English: 'EN', German: 'DE', Spanish: 'ES', French: 'FR', Italian: 'IT',
    Japanese: 'JA', Portuguese: 'PT', Turkish: 'TR', Dutch: 'NL', Korean: 'KO',
    Chinese: 'ZH', Arabic: 'AR', Russian: 'RU', Polish: 'PL', Swedish: 'SV',
    Hindi: 'HI', Greek: 'EL', Ukrainian: 'UK'
  };

  var _container   = null;
  var _emptyText   = 'Waiting for speaker…';
  var _turns       = {};   // speakerId -> { el, srcEl, transEl, srcText, transText, timer }
  var FINALIZE_MS  = 2600; // gap of silence that ends a turn (next delta = new card)

  // Inject the one-time entrance animation (self-contained, no page CSS needed)
  function _ensureStyle() {
    if (document.getElementById('ml-chat-style')) return;
    var s = document.createElement('style');
    s.id = 'ml-chat-style';
    s.textContent = '@keyframes mlChatIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(s);
  }

  function init(el, opts) {
    _container = el;
    opts = opts || {};
    if (opts.emptyText) _emptyText = opts.emptyText;
    _ensureStyle();
    _renderEmpty();
  }

  function setEmptyText(t) {
    _emptyText = t || _emptyText;
    var e = _container && _container.querySelector('.ml-chat-empty');
    if (e) e.textContent = _emptyText;
  }

  function _renderEmpty() {
    if (!_container || _container.querySelector('.ml-chat-empty')) return;
    if (_container.children.length > 0) return;
    var p = document.createElement('p');
    p.className = 'ml-chat-empty';
    p.textContent = _emptyText;
    p.style.cssText = 'color:#999;font-style:italic;text-align:center;margin:auto;font-size:15px;';
    _container.appendChild(p);
  }
  function _removeEmpty() {
    var e = _container && _container.querySelector('.ml-chat-empty');
    if (e) e.remove();
  }

  function _atBottom() {
    return _container.scrollHeight - _container.scrollTop - _container.clientHeight < 80;
  }
  function _scroll() { _container.scrollTop = _container.scrollHeight; }

  function _code(lang) {
    return LANG_CODE[lang] || String(lang || '').slice(0, 2).toUpperCase();
  }

  // Get (or create) the live card for a speaker's current turn.
  function _ensureTurn(speakerId, name, sourceLang) {
    var turn = _turns[speakerId];
    if (turn) return turn;
    _removeEmpty();
    var wasBottom = _atBottom();

    var card = document.createElement('div');
    card.style.cssText = 'align-self:flex-start;max-width:88%;background:#fff;border:1px solid #ECECEC;' +
      'border-radius:14px;padding:12px 14px;box-shadow:0 1px 4px rgba(0,0,0,.04);animation:mlChatIn .25s ease;';

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:baseline;gap:8px;margin-bottom:6px;';
    var nm = document.createElement('span');
    nm.style.cssText = 'font-size:14px;font-weight:700;color:#1A1A1A;';
    nm.textContent = name || '?';                       // user-controlled → textContent
    var lg = document.createElement('span');
    lg.style.cssText = 'font-size:11px;font-weight:700;color:#95C11E;letter-spacing:.05em;';
    lg.textContent = _code(sourceLang);
    head.appendChild(nm); head.appendChild(lg);

    var src = document.createElement('div');
    src.style.cssText = 'font-size:15px;line-height:1.45;color:#1A1A1A;white-space:pre-wrap;word-break:break-word;';
    var trans = document.createElement('div');
    trans.style.cssText = 'display:none;margin-top:8px;background:#F4F4F5;border-radius:10px;padding:9px 12px;' +
      'font-size:15px;line-height:1.45;color:#333;white-space:pre-wrap;word-break:break-word;';

    card.appendChild(head); card.appendChild(src); card.appendChild(trans);
    _container.appendChild(card);
    if (wasBottom) _scroll();

    turn = { el: card, srcEl: src, transEl: trans, srcText: '', transText: '', timer: null };
    _turns[speakerId] = turn;
    return turn;
  }

  function _bump(turn) {
    clearTimeout(turn.timer);
    turn.timer = setTimeout(function () {
      for (var k in _turns) { if (_turns[k] === turn) delete _turns[k]; }
    }, FINALIZE_MS);
  }

  // Original (foreign-language) speech delta.
  function addSource(speakerId, name, sourceLang, delta) {
    if (!_container || !delta) return;
    var wasBottom = _atBottom();
    var turn = _ensureTurn(speakerId, name, sourceLang);
    turn.srcText += delta;
    turn.srcEl.textContent = turn.srcText;
    _bump(turn);
    if (wasBottom) _scroll();
  }

  // Translation delta (already in the viewer's language).
  function addTranslation(speakerId, name, sourceLang, delta) {
    if (!_container || !delta) return;
    var wasBottom = _atBottom();
    var turn = _ensureTurn(speakerId, name, sourceLang);
    turn.transText += delta;
    turn.transEl.textContent = turn.transText;
    turn.transEl.style.display = 'block';
    _bump(turn);
    if (wasBottom) _scroll();
  }

  function reset() {
    if (_container) _container.innerHTML = '';
    _turns = {};
    _renderEmpty();
  }

  window.MeetLingoChat = {
    init: init,
    addSource: addSource,
    addTranslation: addTranslation,
    setEmptyText: setEmptyText,
    reset: reset
  };

  console.log('[Chat] chat.js loaded ✓');
})();
