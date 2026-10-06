'use strict';
/* =====================================================================
   Battalo Ra4y - helpers, shared state, tiny UI toolkit
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;            // trusted static strings only
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

const store = {
  get(k, d) { try { const v = localStorage.getItem('br_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('br_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  del(k) { try { localStorage.removeItem('br_' + k); } catch (e) { /* ignore */ } },
};

/* ---------------------------------------------------------------- icons */
const ICON_PATHS = {
  gamepad: '<rect x="2" y="6" width="20" height="12" rx="5"/><path d="M7 10v4M5 12h4"/><circle cx="15.5" cy="11" r=".6"/><circle cx="18" cy="13" r=".6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.6"/><path d="M17 14.2c2.7.2 4.5 2 4.5 5"/>',
  chat: '<path d="M21 12a8.5 8.5 0 0 1-12.2 7.6L3.5 21l1.4-5A8.5 8.5 0 1 1 21 12z"/>',
  tv: '<rect x="2.5" y="4" width="19" height="13" rx="3"/><path d="M10 8.5v4l3.5-2z"/><path d="M8 21h8"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-8-8-4z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>',
  eraser: '<path d="M20 20H9L4 15a2 2 0 0 1 0-2.8L12 4a2 2 0 0 1 2.8 0l5.2 5.2a2 2 0 0 1 0 2.8L12 20"/><path d="M8 11l6 6"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.7.6 1 1.3 1 2.1h5c0-.8.3-1.5 1-2.1A6 6 0 0 0 12 3z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  flip: '<path d="M7 4v14M7 18l-3-3M7 18l3-3"/><path d="M17 20V6M17 6l-3 3M17 6l3 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  hand: '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7"/><path d="M8 12l-1.4-1.6a1.6 1.6 0 0 0-2.4 2L8 17.5c1.2 2 3 3.5 5.5 3.5 3.3 0 5.5-2.4 5.5-6V9.5"/>',
};
function ico(name, cls) {
  return h('span', { class: cls || 'ic', style: { display: 'inline-grid', placeItems: 'center' },
    html: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICON_PATHS[name] || '') + '</svg>' });
}
function icoSvg(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICON_PATHS[name] || '') + '</svg>';
}

/* ---------------------------------------------------------------- misc */
const rint = (n) => Math.floor(Math.random() * n);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function fmtTime(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
}
const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } };
const clockStr = (ts) => { const d = new Date(ts); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); };

function toast(msg, ms = 2400) {
  const t = h('div', { class: 'toast', text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

function confetti() {
  const box = h('div', { class: 'confetti' });
  const cols = ['#2f8fff', '#7cc2ff', '#22b07d', '#f6a823', '#ee5a6c', '#18a5b8'];
  for (let i = 0; i < 60; i++) {
    box.append(h('i', { style: { left: Math.random() * 100 + '%', background: cols[i % cols.length], animationDuration: (1.6 + Math.random() * 1.8) + 's', animationDelay: Math.random() * .5 + 's', transform: 'rotate(' + rint(360) + 'deg)' } }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4200);
}

/* ---------------------------------------------------------------- shared state */
const S = {
  me: { id: null, name: store.get('name', '') },
  players: [], playersLoaded: false, playersLoading: false,
  online: false, signedIn: false, err: null, hasName: false, installEvt: null,
  stats: null, lb: null, lbLoading: false,
  view: 'home',
  chat: [], roomChat: [],
  unreadRoom: 0,
  game: null,         // {def, mode, opts, inst, root, room}
  room: null,         // {id, players, idx}
  pendingOut: null,
  invites: [],        // incoming
};
const GAMES = {};     // id -> definition (filled by game files)

/* ---------------------------------------------------------------- sheets */
function openSheet(content, o = {}) {
  const bd = h('div', { class: 'backdrop' + (o.center ? ' center-modal' : '') });
  const sh = h('div', { class: 'sheet' }, o.center ? null : h('div', { class: 'grab' }), content);
  bd.append(sh);
  $('#layer').append(bd);
  const close = () => { if (!bd.isConnected) return; bd.remove(); if (o.onClose) o.onClose(); };
  if (!o.locked) bd.addEventListener('pointerdown', (e) => { if (e.target === bd) close(); });
  return close;
}
function closeAllSheets() { $('#layer').replaceChildren(); }

function confirmDialog(title, text, okLabel, onOk, onCancel, danger) {
  let close;
  const body = h('div', null,
    h('h3', { text: title }),
    h('p', { class: 'muted', text: text, style: { margin: '6px 0 16px' } }),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', text: 'Cancel', onclick: () => { close(); if (onCancel) onCancel(); } }),
      h('button', { class: 'btn grow ' + (danger ? 'danger' : 'primary'), text: okLabel, onclick: () => { close(); onOk(); } })));
  close = openSheet(body, { center: true, onClose: null });
  return close;
}

/* ---------------------------------------------------------------- chat box */
const chatBoxes = new Set();
const QUICK = ['👍', '😂', '😮', '🔥', '👏', 'GG', '😎', '🤝'];

function ChatBox(kind) {
  const el = h('div', { class: 'chat' });
  const list = h('div', { class: 'msgs' });
  const input = h('input', { type: 'text', placeholder: kind === 'room' ? 'Message your opponent…' : 'Message everyone…', maxlength: '300', enterkeyhint: 'send', autocomplete: 'off' });
  const send = (txt) => {
    txt = (txt || '').trim();
    if (!txt) return;
    if (kind === 'room' && !S.room) { toast('Not in a multiplayer game'); return; }
    wsSend({ t: kind === 'room' ? 'room_chat' : 'chat', text: txt });
  };
  const quick = h('div', { class: 'quick' }, QUICK.map((e) => h('button', { type: 'button', text: e, onclick: () => send(e) })));
  const form = h('form', { class: 'composer', onsubmit: (e) => { e.preventDefault(); send(input.value); input.value = ''; } },
    input, h('button', { class: 'btn primary', type: 'submit', 'aria-label': 'Send' }, ico('send', 'ic i20')));
  el.append(list, quick, form);
  const box = {
    el, input,
    render() {
      const msgs = kind === 'room' ? S.roomChat : S.chat;
      list.replaceChildren(...msgs.map((m) => {
        if (m.sys) return h('div', { class: 'msg sys', text: m.text });
        const mine = m.from === S.me.id;
        return h('div', { class: 'msg' + (mine ? ' mine' : '') },
          mine ? null : h('div', { class: 'who', text: m.name }),
          h('span', { text: m.text }), h('span', { class: 'tm', text: clockStr(m.ts) }));
      }));
      if (!msgs.length) list.append(h('div', { class: 'empty' }, h('div', { class: 'big', text: '💬' }), kind === 'room' ? 'Say something to your opponent.' : 'Say hi 👋 Everyone online can see this chat.'));
      list.scrollTop = list.scrollHeight;
    },
    destroy() { chatBoxes.delete(box); },
  };
  chatBoxes.add(box);
  box.kind = kind;
  box.render();
  return box;
}
function refreshChats(kind) { chatBoxes.forEach((b) => { if (!kind || b.kind === kind) b.render(); }); }
