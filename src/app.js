/* =====================================================================
   Battalo Ra4y - app: connection, lobby, invites, views, game host
   ===================================================================== */
const GAME_ORDER = ['chess', 'sudoku', 'xo', 'c4'];

/* ------------------------------------------------------------- session */
const wsSend = (o) => { if (S.online) NET.send(o); };

/* Top-bar account chip (name + sign-out). No connection polling anywhere. */
function setConn() {
  const c = $('#conn');
  c.hidden = !S.online;
  c.className = 'conn on';
  c.lastChild.textContent = S.me.name || 'Account';
}

/* The lobby chat is only listened to while it is on screen. */
function syncChat() {
  const want = S.online && ((S.view === 'chat' && !S.game) || !!(S.game && S.game.drawer && S.game.mode === 'solo'));
  NET.chatWatch(want);
}

function onServer(m) {
  switch (m.t) {
    case 'welcome':
      S.online = true;
      S.me.id = m.id; S.me.name = m.name;
      setConn(); renderAll(); syncChat();
      if (S.view === 'ranks') loadLB(false);
      if (S.view === 'lobby') NET.players(true);
      break;
    case 'players':
      S.players = m.list; S.playersLoaded = true; S.playersLoading = false;
      renderLobby(); renderHome();
      if (S.game && S.game.sheetRefresh) S.game.sheetRefresh();
      refreshOpenSheets();
      break;
    case 'inbox': {
      const first = !S.inboxLoaded; S.inboxLoaded = true;
      Object.keys(m.map).forEach((id) => {
        const v = m.map[id], old = S.inbox[id];
        if (S.dmOpen === id) return;
        if (!first && (!old || v.t > old.t)) { toast(v.n + ': ' + v.x, 3600); vibrate(50); }
      });
      S.inbox = m.map;
      if (S.dmOpen) markRead(S.dmOpen);
      renderLobby(); updateBadges();
      break;
    }
    case 'dm':
      (S.dm[m.peer] = S.dm[m.peer] || []).push(m); if (S.dm[m.peer].length > 200) S.dm[m.peer].shift();
      refreshChats('dm:' + m.peer);
      break;
    case 'chat':
      S.chat.push(m); if (S.chat.length > 300) S.chat.shift();
      refreshChats('global');
      break;
    case 'invite':
      S.invites.push(m); renderInvites(); vibrate([60, 40, 60]);
      break;
    case 'invite_gone':
      S.invites = S.invites.filter((i) => i.inviteId !== m.inviteId); renderInvites();
      break;
    case 'invite_sent':
      showWaiting(m);
      break;
    case 'invite_declined':
      if (S.pendingOut) { S.pendingOut.close(); S.pendingOut = null; }
      toast((m.by || 'Player') + ' declined');
      break;
    case 'invite_expired':
      if (S.pendingOut) { S.pendingOut.close(); S.pendingOut = null; }
      toast('No answer - invite expired');
      break;
    case 'invite_fail':
      if (S.pendingOut) { S.pendingOut.close(); S.pendingOut = null; }
      toast({ busy: 'That player is busy right now', offline: 'That player left', already: 'Invite already sent', invalid: 'Cannot invite right now' }[m.reason] || 'Invite failed');
      break;
    case 'room_start':
      startRoom(m);
      break;
    case 'game':
      if (S.game && S.game.inst && S.game.inst.onMsg) S.game.inst.onMsg(m.data);
      break;
    case 'room_chat':
      S.roomChat.push(m); refreshChats('room');
      if (m.from !== S.me.id && !(S.game && S.game.drawer)) { S.unreadRoom++; updateBadges(); }
      break;
    case 'room_end':
      S.room = null;
      if (S.game && S.game.mode === 'multi') {
        S.game.ctx.gone = true;
        if (S.game.inst && S.game.inst.onLeft) S.game.inst.onLeft();
        showGameNotice((S.game.ctx.opp ? S.game.ctx.opp.name : 'Your friend') + ' left the game.');
      }
      break;
    default: break;
  }
}

/* lobby list: fetched on demand (throttled inside NET), never polled */
function loadPlayers(force) {
  if (!S.online) return;
  S.playersLoading = true; renderLobby();
  NET.players(force).then(() => { S.playersLoading = false; renderLobby(); });
}

/* leaderboard: one fetch when the Ranks tab opens (cached for a few minutes) */
function loadLB(force) {
  if (!S.online) return;
  S.lbLoading = true; renderRanks();
  NET.getLeaderboard(force).then((rows) => { S.lb = rows; S.lbLoading = false; renderRanks(); },
    () => { S.lbLoading = false; if (!S.lb) S.lb = []; renderRanks(); });
}

/* ------------------------------------------------------------------ views */
function showView(name) {
  S.view = name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === name + 'View'));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.v === name));
  if (name === 'chat') refreshChats('global');
  if (name === 'ranks') { renderRanks(); loadLB(false); }
  if (name === 'lobby') loadPlayers(false);
  syncChat();
}
function updateBadges() {
  if (S.game) {
    const n = S.game.mode === 'multi' ? S.unreadRoom : 0;
    S.game.badge.hidden = !n; S.game.badge.textContent = n > 9 ? '9+' : n;
  }
  const inv = $('#lobbyBadge');
  const n = S.invites.length + unreadCount();
  inv.hidden = !n; inv.textContent = n > 9 ? '9+' : n;
}
function renderAll() { renderHome(); renderLobby(); renderRanks(); renderWatch(); renderStats(); updateBadges(); setConn(); }

const others = () => S.players.filter((p) => p.id !== S.me.id);

function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }

function installCard() {
  if (isStandalone() || store.get('hideInstall', false)) return null;
  const hide = h('button', { class: 'iconbtn', 'aria-label': 'Hide', onclick: () => { store.set('hideInstall', true); renderHome(); } }, ico('close'));
  if (S.installEvt) {
    return h('div', { class: 'card install-card' }, h('div', { class: 'grow' }, h('b', { text: 'Install the app' }), h('div', { class: 'muted small', text: 'Add Battalo Ra4y to your home screen.' })),
      h('button', { class: 'btn primary sm', text: 'Install', onclick: installApp }), hide);
  }
  if (isIOS()) {
    return h('div', { class: 'card install-card' }, h('div', { class: 'grow' }, h('b', { text: 'Add to Home Screen' }), h('div', { class: 'muted small', text: 'Play full-screen like a real app.' })),
      h('button', { class: 'btn primary sm', text: 'How?', onclick: openIosInstall }), hide);
  }
  return null;
}
async function installApp() {
  const e = S.installEvt; if (!e) return;
  e.prompt();
  try { await e.userChoice; } catch (_) { /* ignore */ }
  S.installEvt = null; renderHome();
}
function openIosInstall() {
  openSheet(h('div', null,
    h('h3', { text: 'Add to Home Screen' }),
    h('ol', { class: 'steps' },
      h('li', { text: 'Open this page in Safari.' }),
      h('li', { text: 'Tap the Share button (the square with an arrow).' }),
      h('li', { text: 'Choose “Add to Home Screen”, then tap Add.' })),
    h('button', { class: 'btn primary block', style: { marginTop: '16px' }, text: 'Got it', onclick: (e) => e.target.closest('.backdrop').remove() })));
}

function renderHome() {
  const root = $('#homeView');
  const o = others().length;
  let title, text, btn;
  if (!S.playersLoaded) {
    title = 'Play with friends';
    text = 'Solo games are ready now. Open the lobby to see who is online.';
    btn = ['Open lobby', () => showView('lobby')];
  } else if (!o) {
    title = 'Nobody else is online';
    text = 'Share the game link so your friends can join you.';
    btn = ['Invite friends', () => showView('lobby')];
  } else {
    title = o + (o === 1 ? ' friend is' : ' friends are') + ' online';
    text = 'Pick a game and send a request, or open the lobby to see who is free.';
    btn = ['Open lobby', () => showView('lobby')];
  }
  root.replaceChildren(
    h('div', { class: 'hero' }, h('h3', { text: title }), h('p', { text }), h('button', { class: 'btn sm', text: btn[0], onclick: btn[1] })),
    installCard(),
    h('div', { class: 'h2', text: 'Games' }),
    h('div', { class: 'games' }, GAME_ORDER.filter((id) => GAMES[id]).map((id) => {
      const g = GAMES[id];
      return h('button', { class: 'game-card ' + g.tint, onclick: () => openGameSheet(id) },
        h('div', { class: 'ico', html: g.icon }),
        h('b', { text: g.name }),
        h('span', { class: 'muted small', text: g.tagline }),
        h('div', { class: 'tags' }, g.solo ? h('span', { class: 'tag', text: 'Solo' }) : null, g.multi ? h('span', { class: 'tag g', text: '2 players' }) : null));
    })),
    h('div', { class: 'h2', text: 'Coming soon' }),
    h('button', { class: 'game-card wide tint6', onclick: () => showView('watch') },
      h('div', { class: 'ico', html: icoSvg('tv') }),
      h('div', { class: 'grow' }, h('b', { text: 'Watch' }), h('div', { class: 'muted small', text: 'Coming soon.' })),
      h('span', { class: 'ribbon', text: 'Soon' })),
    h('p', { class: 'muted small', style: { textAlign: 'center', marginTop: '22px' }, text: 'Less talking, more playing 😉' }));
}

const shareUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
function makeQR(url) {
  try {
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (e) { return ''; }
}
async function shareGame() {
  const url = shareUrl();
  try { if (navigator.share) { await navigator.share({ title: 'Battalo Ra4y', text: 'Play with me on Battalo Ra4y!', url }); return; } } catch (e) { return; }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { toast(url); }
}

/* ------------------------------------------------- search, player rows, private chat */
const searchQ = { lobby: '', sheet: '' };

/* re-rendering replaces the search box; put the cursor back where it was */
function keepFocus(fn) {
  const a = document.activeElement, id = a && a.dataset && a.dataset.q, pos = id ? a.selectionStart : 0;
  fn();
  if (id) { const n = document.querySelector('[data-q="' + id + '"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } } }
}

const avatarOf = (name, style) => h('div', { class: 'avatar', text: String(name || '?').charAt(0).toUpperCase(), style: style || { background: 'linear-gradient(145deg,#7fe0cf,#18a5b8)' } });

function playerRow(p, actions) {
  return h('div', { class: 'player' + (p.status !== 'free' ? ' busy' : '') },
    avatarOf(p.name),
    h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', { class: 'ellip', text: p.name }), h('div', { class: 'st' }, h('i'), p.status === 'free' ? 'Free to play' : 'In a game')),
    actions);
}

/* search box + list of ONLINE players only; actions(p) returns the buttons for a row */
function playersPanel(key, actions) {
  const input = h('input', { type: 'search', class: 'search', placeholder: 'Search online players…', autocomplete: 'off', 'aria-label': 'Search online players', 'data-q': key, value: searchQ[key] });
  const list = h('div', { class: 'plist' });
  const draw = () => {
    const q = searchQ[key].trim().toLowerCase(), all = others();
    const arr = all.filter((p) => !q || p.name.toLowerCase().includes(q));
    list.replaceChildren(...(arr.length ? arr.map((p) => playerRow(p, actions(p)))
      : [h('div', { class: 'card empty' }, h('div', { class: 'big', text: S.playersLoading ? '⏳' : '🛰️' }),
        h('b', { text: S.playersLoading ? 'Looking for friends…' : all.length ? 'No online player matches “' + searchQ[key].trim() + '”' : 'Nobody else is online' }),
        all.length || S.playersLoading ? null : h('div', { class: 'small', style: { marginTop: '4px' }, text: 'Share the link below, then tap refresh when they have joined.' }))]));
  };
  input.addEventListener('input', () => { searchQ[key] = input.value; draw(); });
  draw();
  return h('div', null, input, list);
}

function unreadCount() { const r = store.get('dmread', {}); return Object.keys(S.inbox).filter((id) => S.inbox[id].t > (r[id] || 0)).length; }
function markRead(id) { const r = store.get('dmread', {}); r[id] = S.inbox[id] ? S.inbox[id].t : Date.now(); store.set('dmread', r); }

/* private chat with one person: a sheet that listens only while it is open */
function openDm(id, name) {
  if (!S.online || !id || id === S.me.id) return;
  closeDm();
  S.dmOpen = id; S.dm[id] = S.dm[id] || []; markRead(id);
  const box = ChatBox('dm:' + id);
  let close;
  const body = h('div', { class: 'dm-sheet' },
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      avatarOf(name),
      h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', { class: 'ellip', text: name }), h('div', { class: 'muted small', text: 'Private chat' })),
      h('button', { class: 'iconbtn', 'aria-label': 'Close chat', onclick: () => close() }, ico('close'))),
    box.el);
  close = openSheet(body, { onClose: () => { box.destroy(); if (S.dmOpen === id) { S.dmOpen = null; NET.dmWatch(null); } renderLobby(); updateBadges(); } });
  S.dmClose = close;
  NET.dmWatch(id); box.render(); renderLobby(); updateBadges();
}
function closeDm() { if (S.dmClose) { const c = S.dmClose; S.dmClose = null; c(); } }

function renderLobby() {
  keepFocus(() => {
    const root = $('#lobbyView');
    const url = shareUrl();

    const meCard = h('div', { class: 'card me-card' },
      avatarOf(S.me.name, {}),
      h('div', { class: 'grow' }, h('b', { text: S.me.name || 'You' }), h('div', { class: 'muted small', text: 'Signed in with Google · visible to friends in the lobby' })),
      h('button', { class: 'iconbtn', 'aria-label': 'Edit name', onclick: () => openNameSheet(false) }, ico('edit')));

    const read = store.get('dmread', {});
    const convos = Object.keys(S.inbox).map((id) => Object.assign({ id }, S.inbox[id])).sort((a, b) => b.t - a.t).slice(0, 8);
    const messages = convos.length ? [
      h('div', { class: 'h2', text: 'Messages' }),
      h('div', { class: 'plist' }, convos.map((c) => h('button', { class: 'player', style: { textAlign: 'left', width: '100%' }, onclick: () => openDm(c.id, c.n) },
        avatarOf(c.n),
        h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', { class: 'ellip', text: c.n }), h('div', { class: 'muted small ellip', text: c.x })),
        c.t > (read[c.id] || 0) ? h('i', { class: 'udot', 'aria-label': 'Unread' }) : null)))] : [];

    const refreshBtn = h('button', { class: 'iconbtn', 'aria-label': 'Refresh players', disabled: S.playersLoading, onclick: () => loadPlayers(true) }, ico('refresh'));
    const panel = playersPanel('lobby', (p) => h('div', { class: 'row', style: { gap: '8px', flex: 'none' } },
      h('button', { class: 'iconbtn', 'aria-label': 'Message ' + p.name, onclick: () => openDm(p.id, p.name) }, ico('chat')),
      h('button', { class: 'btn primary sm', text: 'Invite', disabled: p.status !== 'free', onclick: () => openGamePicker(p.id) })));

    const inviteCard = h('div', { class: 'card' },
      h('b', { text: 'Invite friends' }),
      h('div', { class: 'qr', html: makeQR(url) }),
      h('div', { style: { textAlign: 'center' } }, h('span', { class: 'urlchip', text: url.replace(/^https?:\/\//, '') })),
      h('button', { class: 'btn primary block sm', style: { marginTop: '12px' }, text: 'Share link', onclick: shareGame }),
      h('button', { class: 'btn block sm', style: { marginTop: '8px' }, text: 'How does it work?', onclick: () => openHelp() }));

    root.replaceChildren(
      h('div', { class: 'h2', text: 'You' }), meCard, ...messages,
      h('div', { class: 'row-h' }, h('div', { class: 'h2', text: 'Players online' }), refreshBtn), panel,
      h('div', { class: 'h2', text: 'Share the game' }), inviteCard);
  });
}

/* ---------------------------------------------------------- leaderboard */
function renderStats() {
  const c = $('#ptsChip');
  c.hidden = !S.me.name;
  c.textContent = '⭐ ' + ((S.stats && S.stats.points) || 0);
  if (S.view === 'ranks') renderRanks();
}

function renderRanks() {
  const root = $('#ranksView');
  const st = S.stats || { points: 0, wins: 0, games: 0 };
  const rows = S.lb;
  const myIdx = rows ? rows.findIndex((r) => r.id === S.me.id) : -1;
  const medal = (i) => ['🥇', '🥈', '🥉'][i] || String(i + 1);
  const meCard = h('div', { class: 'card' },
    h('div', { class: 'row', style: { gap: '12px' } },
      h('div', { class: 'avatar', text: (S.me.name || '?').charAt(0).toUpperCase() }),
      h('div', { class: 'grow' }, h('b', { text: S.me.name || 'You' }), h('div', { class: 'muted small', text: myIdx >= 0 ? 'Rank #' + (myIdx + 1) : (rows ? 'Outside the top 50' : '') })),
      h('button', { class: 'iconbtn', 'aria-label': 'How points work', onclick: () => openPointsHelp() }, ico('info'))),
    h('div', { class: 'stat3' },
      h('div', null, h('b', { text: st.points }), h('span', { text: 'Points' })),
      h('div', null, h('b', { text: st.wins }), h('span', { text: 'Wins' })),
      h('div', null, h('b', { text: st.games }), h('span', { text: 'Games' }))));

  let list;
  if (!rows) list = h('div', { class: 'card empty' }, h('div', { class: 'big', text: '📊' }), h('b', { text: 'Loading the leaderboard…' }));
  else if (!rows.length) list = h('div', { class: 'card empty' }, h('div', { class: 'big', text: '🏆' }), h('b', { text: 'No scores yet' }), h('div', { class: 'small', text: 'Win a game to be the first on the board.' }));
  else list = h('div', { class: 'plist' }, rows.map((r, i) => h('div', { class: 'lb-row' + (r.id === S.me.id ? ' me' : '') },
    h('div', { class: 'lb-rank', text: medal(i) }),
    h('div', { class: 'avatar', text: String(r.name || '?').charAt(0).toUpperCase(), style: { width: '38px', height: '38px', fontSize: '16px' } }),
    h('div', { class: 'grow' }, h('b', { text: r.name }), h('div', { class: 'muted small', text: r.wins + ' wins · ' + r.games + ' games' })),
    h('b', { class: 'lb-pts', text: r.points }))));

  root.replaceChildren(h('div', { class: 'h2', style: { marginTop: '8px' }, text: 'Leaderboard' }), meCard,
    h('div', { class: 'row-h' }, h('div', { class: 'h2', text: 'Top players' }),
      h('button', { class: 'iconbtn', 'aria-label': 'Refresh leaderboard', disabled: S.lbLoading, onclick: () => loadLB(true) }, ico('refresh'))), list);
}

function renderWatch() {
  $('#watchView').replaceChildren(
    h('div', { class: 'soon-hero', style: { marginTop: '8px' } },
      h('div', { class: 'big', text: '🍿' }),
      h('h3', { text: 'Coming soon', style: { margin: '6px 0' } }),
      h('span', { class: 'ribbon', text: 'Soon' })));
}

/* ----------------------------------------------------------------- sheets */
function openHelp() {
  openSheet(h('div', null,
    h('h3', { text: 'Play with friends' }),
    h('ol', { class: 'steps' },
      h('li', { text: 'Share the game link (or QR code) from the Lobby tab.' }),
      h('li', { text: 'When your friend opens it and signs in with Google, they show up in your lobby (tap refresh).' }),
      h('li', { text: 'Pick a game, search for a player who is online, tap Invite, and they get a request to accept.' }),
      h('li', { text: 'Tap the chat button next to a player to message them privately.' }),
      h('li', { text: 'Win games to earn points and climb the leaderboard. Every game has its own chat.' })),
    h('button', { class: 'btn primary block', style: { marginTop: '16px' }, text: 'Got it', onclick: (e) => e.target.closest('.backdrop').remove() })));
}

function openPointsHelp() {
  const P = POINTS, row = (a, b) => h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line)' } }, h('span', { text: a }), h('b', { text: b }));
  openSheet(h('div', null,
    h('h3', { text: 'How points work' }),
    h('p', { class: 'muted small', style: { margin: '2px 0 10px' }, text: 'Points are added to your total after each finished game.' }),
    h('div', { class: 'h2', style: { margin: '8px 0 4px' }, text: 'Vs a friend' }),
    row('Win', '+' + P.multi.win), row('Draw', '+' + P.multi.draw), row('Loss', '+' + P.multi.loss),
    row('Sudoku race win / loss', '+' + P.sudokuRace.win + ' / +' + P.sudokuRace.loss), row('Sudoku co-op solved', '+' + P.sudokuCoop),
    h('div', { class: 'h2', style: { margin: '14px 0 4px' }, text: 'Solo wins vs the computer' }),
    row('Tic-Tac-Toe', P.solo.xo.easy + ' easy · ' + P.solo.xo.hard + ' unbeatable'),
    row('Connect 4', P.solo.c4.easy + ' · ' + P.solo.c4.medium + ' · ' + P.solo.c4.hard),
    row('Chess', P.solo.chess['1'] + ' · ' + P.solo.chess['2'] + ' · ' + P.solo.chess['3'] + ' · ' + P.solo.chess['4'] + ' · ' + P.solo.chess['5'] + ' (level 1-5)'),
    row('Sudoku', P.solo.sudoku.easy + ' · ' + P.solo.sudoku.medium + ' · ' + P.solo.sudoku.hard + ' · ' + P.solo.sudoku.expert + ' (minus hints and mistakes)'),
    h('p', { class: 'muted small', style: { margin: '10px 0 0' }, text: 'Draws vs the computer give a third of a win. Leaving a game early gives no points.' }),
    h('button', { class: 'btn primary block', style: { marginTop: '14px' }, text: 'Got it', onclick: (e) => e.target.closest('.backdrop').remove() })));
}

function openNameSheet(first) {
  const input = h('input', { type: 'text', maxlength: '16', value: S.me.name || NET.suggestedName(), placeholder: 'Your name', autocomplete: 'off',
    style: { width: '100%', height: '48px', borderRadius: '14px', border: '1.5px solid var(--line)', padding: '0 14px', marginTop: '10px', outline: 'none' } });
  const err = h('div', { class: 'small', style: { color: 'var(--bad)', fontWeight: 700, minHeight: '18px', marginTop: '6px' } });
  const btn = h('button', { class: 'btn primary block', type: 'submit', style: { marginTop: '10px' }, text: first ? "Let's play" : 'Save' });
  let close;
  const done = async () => {
    err.textContent = '';
    const raw = input.value;
    if (!first && NET.cleanName(raw) === S.me.name) { close(); return; }
    btn.disabled = true;
    try {
      const nm = await NET.setName(raw);
      S.me.name = nm; close();
      if (first) begin(); else { renderAll(); toast('Name set to ' + nm); }
    } catch (e) {
      btn.disabled = false;
      err.textContent = e.message === 'short' ? 'Use at least 2 letters or numbers.' : 'Could not save. Check your internet and try again.';
    }
  };
  const body = h('form', { onsubmit: (e) => { e.preventDefault(); done(); } },
    h('h3', { text: first ? 'Welcome! What should we call you?' : 'Change your name' }),
    h('p', { class: 'muted small', style: { margin: '4px 0 0' }, text: 'Friends see this name in the lobby, in chat and on the leaderboard.' }),
    input, err, btn);
  close = openSheet(body, { locked: first });
  setTimeout(() => input.focus(), 250);
}

function openGamePicker(targetId) {
  loadPlayers(false);
  const t = S.players.find((p) => p.id === targetId);
  let close;
  const body = h('div', null,
    h('h3', { text: 'Invite ' + (t ? t.name : 'player') }),
    h('p', { class: 'muted small', style: { margin: '2px 0 10px' }, text: 'Choose a game to request.' }),
    h('div', { class: 'plist' }, GAME_ORDER.filter((id) => GAMES[id] && GAMES[id].multi).map((id) => {
      const g = GAMES[id];
      return h('button', { class: 'player ' + g.tint, style: { textAlign: 'left' }, onclick: () => { close(); openGameSheet(id, targetId); } },
        h('div', { class: 'ico', html: g.icon, style: { width: '42px', height: '42px', borderRadius: '13px', display: 'grid', placeItems: 'center', fontSize: '24px', background: 'var(--soft)' } }),
        h('div', { class: 'grow' }, h('b', { text: g.name }), h('div', { class: 'muted small', text: g.tagline })));
    })));
  close = openSheet(body);
}

let sheetRefreshers = new Set();
function refreshOpenSheets() { sheetRefreshers.forEach((f) => f()); }

function openGameSheet(id, targetId) {
  const def = GAMES[id];
  searchQ.sheet = '';
  if (S.online && (!targetId || !S.playersLoaded) && def.multi) loadPlayers(false);
  const saved = store.get('o_' + id, {});
  const opts = {};
  def.options.forEach((o) => { opts[o.key] = saved[o.key] != null && o.choices.some((c) => c[0] === saved[o.key]) ? saved[o.key] : o.def; });
  let mode = targetId ? 'multi' : (def.solo ? 'solo' : 'multi');
  const body = h('div');
  let close;
  const render = () => {
    const target = targetId ? S.players.find((p) => p.id === targetId) : null;
    const parts = [];
    parts.push(h('div', { class: 'row', style: { gap: '12px', marginBottom: '4px' } },
      h('div', { class: 'ico', html: def.icon, style: { width: '52px', height: '52px', borderRadius: '16px', display: 'grid', placeItems: 'center', fontSize: '28px', background: 'var(--soft)', color: 'var(--pd)' } }),
      h('div', null, h('h3', { text: def.name, style: { margin: 0 } }), h('div', { class: 'muted small', text: def.desc }))));
    if (!targetId && def.solo && def.multi) {
      parts.push(h('div', { class: 'opt' }, h('div', { class: 'seg stretch' },
        h('button', { class: mode === 'solo' ? 'on' : '', text: 'Solo', onclick: () => { mode = 'solo'; render(); } }),
        h('button', { class: mode === 'multi' ? 'on' : '', text: 'With a friend', onclick: () => { mode = 'multi'; render(); } }))));
    }
    def.options.filter((o) => !o.mode || o.mode === mode).forEach((o) => {
      parts.push(h('div', { class: 'opt' }, h('label', { class: 't', text: o.label }),
        h('div', { class: 'seg' }, o.choices.map(([v, l]) => h('button', { class: opts[o.key] === v ? 'on' : '', text: l, onclick: () => { opts[o.key] = v; store.set('o_' + id, opts); render(); } })))));
    });
    parts.push(h('div', { style: { height: '12px' } }));
    if (mode === 'solo') {
      parts.push(h('button', { class: 'btn primary block', text: def.soloLabel || 'Start', onclick: () => { close(); openGame(def, 'solo', { ...opts }); } }));
    } else if (targetId) {
      parts.push(h('button', { class: 'btn primary block', disabled: !target || target.status !== 'free', text: target ? 'Send request to ' + target.name : 'Player left', onclick: () => { sendInvite(targetId, def, opts); close(); } }));
    } else {
      parts.push(h('label', { class: 't', style: { display: 'block', fontSize: '12.5px', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 8px' }, text: 'Search an online player to invite' }));
      parts.push(playersPanel('sheet', (p) => h('button', { class: 'btn primary sm', style: { flex: 'none' }, text: 'Invite', disabled: p.status !== 'free', onclick: () => { sendInvite(p.id, def, opts); close(); } })));
    }
    keepFocus(() => body.replaceChildren(...parts));
  };
  render();
  close = openSheet(body, { onClose: () => sheetRefreshers.delete(render) });
  sheetRefreshers.add(render);
}

function sendInvite(pid, def, opts) {
  store.set('o_' + def.id, opts);
  const o = def.resolve ? def.resolve({ ...opts }) : { ...opts };
  wsSend({ t: 'invite', to: pid, game: def.id, opts: o });
}

function showWaiting(m) {
  if (S.pendingOut) S.pendingOut.close();
  const body = h('div', { style: { textAlign: 'center' } },
    h('div', { style: { fontSize: '34px', margin: '6px 0' }, text: '⏳' }),
    h('h3', { text: 'Waiting for ' + m.toName }),
    h('p', { class: 'muted small', text: 'They got your request to play ' + (GAMES[m.game] ? GAMES[m.game].name : 'a game') + '.' }),
    h('button', { class: 'btn block', text: 'Cancel request', onclick: () => { wsSend({ t: 'invite_cancel', inviteId: m.inviteId }); S.pendingOut.close(); S.pendingOut = null; } }));
  const close = openSheet(body, { center: true, locked: true });
  S.pendingOut = { inviteId: m.inviteId, close };
}

function renderInvites() {
  const box = $('#inviteBox');
  box.replaceChildren(...S.invites.slice(-2).map((inv) => {
    const g = GAMES[inv.game];
    const desc = g && g.describe ? g.describe(inv.opts) : '';
    const el = h('div', { class: 'invite-banner' },
      h('div', { class: 'row' },
        h('div', { class: 'ico', html: g ? g.icon : '🎮', style: { width: '44px', height: '44px', borderRadius: '14px', display: 'grid', placeItems: 'center', fontSize: '24px', background: 'var(--soft)', flex: 'none' } }),
        h('div', { class: 'grow' }, h('b', { text: inv.fromName + ' wants to play' }), h('div', { class: 'muted small', text: (g ? g.name : inv.game) + (desc ? ' · ' + desc : '') }))),
      h('div', { class: 'row', style: { marginTop: '12px' } },
        h('button', { class: 'btn grow', text: 'Decline', onclick: () => { wsSend({ t: 'invite_reply', inviteId: inv.inviteId, accept: false }); S.invites = S.invites.filter((i) => i !== inv); renderInvites(); } }),
        h('button', { class: 'btn ok grow', text: 'Accept', onclick: () => { wsSend({ t: 'invite_reply', inviteId: inv.inviteId, accept: true }); S.invites = S.invites.filter((i) => i !== inv); renderInvites(); } })),
      h('div', { class: 'bar' }, h('i')));
    return el;
  }));
  updateBadges();
}

/* ------------------------------------------------------------- game host */
function startRoom(m) {
  S.dmClose = null; S.dmOpen = null; NET.dmWatch(null);
  closeAllSheets(); S.pendingOut = null; S.invites = []; renderInvites();
  const def = GAMES[m.game];
  if (!def) { toast('This device does not know that game'); wsSend({ t: 'leave_room' }); return; }
  S.room = { id: m.room, players: m.players, idx: m.you };
  S.roomChat = []; S.unreadRoom = 0;
  openGame(def, 'multi', m.opts || {}, S.room);
  toast('Game on! vs ' + m.players[1 - m.you].name);
  vibrate(80);
}

function openGame(def, mode, opts, room) {
  if (S.game) teardownGame();
  const body = h('div', { class: 'gbody' });
  const badge = h('span', { class: 'badge', hidden: true });
  const sub = h('span', { text: mode === 'multi' ? 'vs ' + room.players[1 - room.idx].name : (def.soloSub || 'Solo') });
  const chatBtn = h('button', { class: 'iconbtn', 'aria-label': 'Chat', onclick: () => toggleChat() }, ico('chat'), badge);
  const root = h('div', { class: 'game-screen' },
    h('div', { class: 'gbar' },
      h('button', { class: 'iconbtn', 'aria-label': 'Back', onclick: () => requestLeave(false) }, ico('back')),
      h('div', { class: 'ttl' }, h('b', { text: def.name }), sub),
      chatBtn),
    body);
  $('#gameRoot').append(root);
  const ctx = {
    root: body, mode, opts, idx: room ? room.idx : 0, isHost: !room || room.idx === 0,
    me: S.me, opp: room ? room.players[1 - room.idx] : null,
    gone: false, over: false,
    send: (data) => { if (mode === 'multi' && !ctx.gone) wsSend({ t: 'game', data }); },
    setSub: (t) => { sub.textContent = t; },
    toast, confetti, vibrate,
    leave: () => requestLeave(true),
  };
  S.game = { def, mode, opts, root, body, ctx, badge, sub, drawer: null, chatBox: null, inst: null };
  history.pushState({ g: 1 }, '');
  updateBadges();
  S.game.inst = def.create(ctx);
}

function toggleChat() {
  const g = S.game; if (!g) return;
  if (g.drawer) { g.chatBox.destroy(); g.drawer.remove(); g.drawer = null; g.chatBox = null; syncChat(); return; }
  const kind = g.mode === 'multi' ? 'room' : 'global';
  const box = ChatBox(kind);
  const drawer = h('div', { class: 'chatdrawer' },
    h('div', { class: 'hd' }, h('b', { text: kind === 'room' ? 'Chat with ' + g.ctx.opp.name : 'Lobby chat' }),
      h('button', { class: 'iconbtn', 'aria-label': 'Close chat', onclick: () => toggleChat() }, ico('close'))),
    box.el);
  g.root.append(drawer); g.drawer = drawer; g.chatBox = box;
  if (kind === 'room') S.unreadRoom = 0;
  updateBadges();
  box.render();
  syncChat();
}

function showGameNotice(text) {
  const g = S.game; if (!g) return;
  const old = $('.gnotice', g.root); if (old) old.remove();
  const n = h('div', { class: 'gnotice', style: { position: 'absolute', left: '12px', right: '12px', top: 'calc(var(--st) + 68px)', zIndex: 9, background: '#fff', border: '1.5px solid var(--warn)', borderRadius: '16px', padding: '12px 14px', boxShadow: 'var(--shadow)', display: 'flex', gap: '10px', alignItems: 'center' } },
    h('div', { class: 'grow', style: { fontWeight: 700 }, text: text }),
    h('button', { class: 'btn sm primary', text: 'Leave', onclick: () => closeGame(false) }));
  g.root.append(n);
}

function teardownGame() {
  const g = S.game; if (!g) return;
  try { if (g.inst && g.inst.destroy) g.inst.destroy(); } catch (e) { /* ignore */ }
  if (g.chatBox) g.chatBox.destroy();
  g.root.remove(); S.game = null;
  syncChat();
}

function closeGame(fromPop) {
  const g = S.game; if (!g) return;
  if (S.room) { wsSend({ t: 'leave_room' }); S.room = null; }
  teardownGame();
  if (!fromPop && history.state && history.state.g) { S.skipPop = true; history.back(); }
  renderAll();
}

function requestLeave(fromPop) {
  const g = S.game; if (!g) return;
  const needConfirm = g.mode === 'multi' && S.room && !g.ctx.over && !g.ctx.gone;
  if (!needConfirm) { closeGame(fromPop); return; }
  confirmDialog('Leave this game?', 'Your friend will be told that you left.', 'Leave', () => closeGame(fromPop), () => { if (fromPop) history.pushState({ g: 1 }, ''); }, true);
}

window.addEventListener('popstate', () => {
  if (S.skipPop) { S.skipPop = false; return; }
  if (S.game) requestLeave(true);
});

/* ------------------------------------------------------------ fake loader */
function fakeLoader(done) {
  const el = $('#loader'), fill = $('#ldFill'), msg = $('#ldMsg'), pct = $('#ldPct');
  if (!el) { done(); return; }
  const lines = [
    [0, 'Warming things up…'], [18, 'Teaching Stockfish some manners…'], [38, 'Shuffling 81 sudoku cells…'],
    [58, 'Telling everyone to stop talking and play…'], [78, 'Polishing the chess pieces…'], [93, 'Almost there… probably'],
  ];
  let p = 0, stalled = false, finished = false;
  const set = (v) => {
    p = Math.min(100, v);
    fill.style.width = p + '%'; pct.textContent = Math.floor(p) + '%';
    for (const [t, m] of lines) if (p >= t) msg.textContent = m;
  };
  const finish = () => {
    if (finished) return; finished = true; set(100); msg.textContent = 'Ready. Less talking, more playing!';
    setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); done(); }, 520); }, 450);
  };
  const tick = () => {
    if (finished) return;
    if (p >= 97 && !stalled) { stalled = true; set(99); setTimeout(finish, 900); return; }   // the classic "stuck at 99%" moment
    set(p + 3 + Math.random() * 11);
    setTimeout(tick, 120 + Math.random() * 260);
  };
  setTimeout(tick, 250);
  el.addEventListener('click', () => { if (p > 60) finish(); });      // impatient? tap to skip near the end
}

/* ------------------------------------------------------------------- boot */
let loaderDone = false, bootDone = false;

function showFatal(kind) {
  const msg = {
    config: ['Firebase is not set up yet', 'Fill in firebase-config.js with your Firebase web-app settings (see the README), then reload.'],
    google: ['Google sign-in is off', 'In the Firebase console open Authentication → Sign-in method and enable “Google”.'],
    domain: ['This website is not allowed to sign in', 'In the Firebase console open Authentication → Settings → Authorized domains and add this site’s domain.'],
    rules: ['Database is not ready', 'In the Firebase console create a Firestore database and publish firestore.rules (see the README), then reload.'],
    sdk: ['Could not load the game servers', 'Check your internet connection and reload the page.'],
    net: ['Could not connect', 'Check your internet connection and try again.'],
  }[kind] || ['Something went wrong', 'Please reload the page.'];
  openSheet(h('div', { style: { textAlign: 'center' } },
    h('div', { style: { fontSize: '34px', margin: '6px 0' }, text: '⚠️' }), h('h3', { text: msg[0] }),
    h('p', { class: 'muted', text: msg[1] }),
    h('button', { class: 'btn primary block', text: 'Reload', onclick: () => location.reload() })), { center: true, locked: true });
}

const errKind = (e) => !e ? 'net' : e.code === 'auth/operation-not-allowed' ? 'google' : e.code === 'auth/unauthorized-domain' ? 'domain'
  : e.code === 'permission-denied' ? 'rules' : 'net';

async function boot() {
  if (!NET.configured) S.err = 'config';
  else if (!NET.init()) S.err = 'sdk';
  else {
    NET.onStats = (st) => { S.stats = st; renderStats(); };
    try {
      await Promise.race([
        (async () => { if (await NET.restoreUser()) await loadAccount(); })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
      ]);
    } catch (e) { S.err = errKind(e); }
  }
  bootDone = true; proceed();
}

/* after sign-in: one read of this account's row (name + points) */
async function loadAccount() {
  S.me.id = NET.uid();
  S.hasName = !!(await NET.loadProfile());
  if (S.hasName) S.me.name = NET.name();
  S.signedIn = true;
}

function openLogin() {
  const err = h('div', { class: 'small', style: { color: 'var(--bad)', fontWeight: 700, minHeight: '18px', marginTop: '8px' } });
  const btn = h('button', { class: 'btn gbtn block', type: 'button' },
    h('span', { html: '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>' }),
    h('span', { text: 'Continue with Google' }));
  const body = h('div', { style: { textAlign: 'center' } },
    h('div', { class: 'logo big', style: { margin: '4px auto 10px' } }, h('img', { src: 'logo.png', alt: '', width: '84', height: '84' })),
    h('h3', { text: 'Welcome to Battalo Ra4y' }),
    h('p', { class: 'muted small', style: { margin: '4px 0 14px' }, text: 'Sign in with Google to keep your name and points on every device.' }),
    btn, err);
  const close = openSheet(body, { center: true, locked: true });
  btn.addEventListener('click', async () => {
    btn.disabled = true; err.textContent = '';
    try {
      const u = await NET.loginGoogle();
      if (!u) return;                                       // redirect flow: the page reloads
      await loadAccount();
      close(); proceed();
    } catch (e) {
      btn.disabled = false;
      if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
      const k = errKind(e);
      if (k === 'google' || k === 'domain' || k === 'rules') { close(); showFatal(k); return; }
      err.textContent = 'Could not sign in. Check your internet and try again.';
    }
  });
}

function openAccount() {
  let close;
  const body = h('div', null,
    h('h3', { text: 'Your account' }),
    h('div', { class: 'row', style: { gap: '12px', margin: '10px 0 14px' } },
      h('div', { class: 'avatar', text: (S.me.name || '?').charAt(0).toUpperCase() }),
      h('div', { class: 'grow', style: { minWidth: 0 } }, h('b', { text: S.me.name }),
        h('div', { class: 'muted small', style: { overflowWrap: 'anywhere' }, text: (NET.user() && NET.user().email) || '' }))),
    h('button', { class: 'btn block', text: 'Change name', onclick: () => { close(); openNameSheet(false); } }),
    h('button', { class: 'btn danger block', style: { marginTop: '8px' }, text: 'Sign out', onclick: async (e) => { e.target.disabled = true; await NET.logout(); location.reload(); } }));
  close = openSheet(body);
}

function proceed() {
  if (!loaderDone || !bootDone) return;
  if (S.err) { showFatal(S.err); return; }
  if (!S.signedIn) { openLogin(); return; }
  if (!S.hasName) openNameSheet(true); else begin();
}

async function begin() {
  S.me.id = NET.uid(); S.me.name = NET.name();
  try { await NET.start(); } catch (e) { showFatal(errKind(e)); }
}

function setupPwa() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; renderHome(); });
  window.addEventListener('appinstalled', () => { S.installEvt = null; toast('Installed 🎉'); renderHome(); });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function init() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.v)));
  const cb = ChatBox('global');
  $('#chatHost').append(cb.el);
  renderAll();
  setupPwa();
  $('#conn').addEventListener('click', openAccount);
  fakeLoader(() => { loaderDone = true; proceed(); });
  boot();
}
