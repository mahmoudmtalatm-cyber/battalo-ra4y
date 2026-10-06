'use strict';
/* =====================================================================
   Battalo Ra4y - Firebase layer (Cloud Firestore + Google sign-in)
   Talks to app.js with message objects (welcome, players, chat, invite,
   room_start, game, ...).

   Built to stay far below the free Spark limits (50k reads / 20k writes a day):
   - NO constant listeners. Lobby list, leaderboard and chat are fetched only
     while the person is looking at them (and cached / throttled).
   - Presence is one tiny write every few minutes, not every 15 seconds.
   - No ghost clean-up deletes, no connection watcher, no clock re-reads.
   - Points use a single increment write (no read-then-write transaction).
   Always-on listeners: incoming invites and your private-message inbox (both only cost
   when something arrives) and the current room.

   Collections:  players/{uid}  chat/{id}  invites/{id}  rooms/{id}  leaderboard/{uid}
                 dms/{pair}/msgs/{id}  private chat (pair = both uids, sorted, joined by "_")
                 inbox/{uid}           one small doc per person: last message from each sender
   (the leaderboard row also holds the display name)
   ===================================================================== */
const NET = (() => {
  const cfg = window.FIREBASE_CONFIG || {};
  const configured = !!(cfg.apiKey && cfg.projectId && !/YOUR_/.test(cfg.apiKey + cfg.projectId));
  const FV = () => firebase.firestore.FieldValue;
  const TS = () => FV().serverTimestamp();
  const EST = { serverTimestamps: 'estimate' };
  const ms = (t) => (t && t.toMillis ? t.toMillis() : null);
  const sleep = (r) => new Promise((res) => setTimeout(res, r));
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
  const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);

  const HEARTBEAT = 3 * 60000;      // presence write interval (only while the app is visible)
  const ONLINE_FOR = 7 * 60000;     // someone counts as online this long after their last write
  const PLAYERS_EVERY = 15000;      // minimum gap between lobby fetches
  const LB_EVERY = 3 * 60000;       // leaderboard cache time
  const CHAT_FIRST = 20;            // messages loaded when chat is opened for the first time

  let db = null, auth = null, user = null, uid = null, myName = '';
  let started = false, welcomed = false, offset = 0, lastBeat = 0;
  let fresh = {}, playersAt = 0, playersBusy = null;
  let lbRows = null, lbAt = 0, lbBusy = null;
  let chatUnsub = null, chatLastTs = null;
  let dmUnsub = null;
  const dmLast = {}, dmSeen = new Set();   // per-peer newest timestamp / seen message ids
  const pairKey = (peer) => [uid, peer].sort().join('_');
  const seenChat = new Set();
  const invitesIn = {};              // inviteId -> data (so replying needs no read)
  const outgoing = {};               // inviteId -> { to, timer, unsub }
  let room = null;                   // { id, you, opp, ref, unsub, seen:Set, seenChat:Set }
  let hb = null, kN = 0;
  let chain = Promise.resolve(), lastWrite = 0;

  const emit = (m) => onServer(m);                       // onServer lives in app.js
  const now = () => Date.now() + offset;
  const api = { configured, onStats: null, stats: null };
  const pdoc = () => db.doc('players/' + uid);

  /* ------------------------------------------------------------ setup & sign-in */
  api.init = function () {
    if (!configured || typeof firebase === 'undefined') return false;
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    db = firebase.firestore(); auth = firebase.auth();
    try { db.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) { /* already started */ }
    return true;
  };
  api.uid = () => uid;
  api.name = () => myName;
  api.cleanName = cleanName;
  api.user = () => user;
  api.suggestedName = () => cleanName(user && user.displayName ? user.displayName.split(' ')[0] : '');

  /* Returns the signed-in Google user (restored from the browser) or null. */
  api.restoreUser = async function () {
    try { await auth.getRedirectResult(); } catch (e) { /* handled by onAuthStateChanged */ }
    const u = await new Promise((res) => { const off = auth.onAuthStateChanged((x) => { off(); res(x); }); });
    if (u) { user = u; uid = u.uid; }
    return u;
  };

  api.loginGoogle = async function () {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const c = await auth.signInWithPopup(provider);
      user = c.user; uid = user.uid; return user;
    } catch (e) {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
        await auth.signInWithRedirect(provider);        // page leaves; user is restored on return
        return null;
      }
      throw e;
    }
  };

  api.logout = async function () {
    try { if (room) room.ref.delete(); if (uid && db) await pdoc().delete(); } catch (e) { /* best effort */ }
    try { await auth.signOut(); } catch (e) { /* ignore */ }
  };

  /* One read: the leaderboard row holds this account's name and points. */
  api.loadProfile = async function () {
    const s = await db.doc('leaderboard/' + uid).get();
    api.stats = s.exists ? s.data() : null;
    myName = s.exists && s.data().name ? s.data().name : '';
    if (api.onStats) api.onStats(api.stats);
    return myName;
  };

  /* Pick / change the display name (also creates the leaderboard row). */
  api.setName = async function (raw0) {
    const name = cleanName(raw0);
    if (name.length < 2) throw new Error('short');
    const prev = myName; myName = name;
    try { await lbWrite(0, 0, 0); } catch (e) { myName = prev; throw e; }
    if (welcomed) pdoc().update({ name }).catch(() => {});
    return name;
  };

  /* ------------------------------------------------------------ points */
  /* One write, no read: increments are applied on the server. The rules allow one write / 3 s. */
  function lbWrite(p, w, g) {
    const job = async () => {
      const wait = 3500 - (Date.now() - lastWrite);
      if (wait > 0) await sleep(wait);
      lastWrite = Date.now();
      const inc = (n) => FV().increment(n);
      await db.doc('leaderboard/' + uid).set({ name: myName, ts: TS(), points: inc(p), wins: inc(w), games: inc(g) }, { merge: true });
      const o = api.stats || { points: 0, wins: 0, games: 0 };
      api.stats = Object.assign({}, o, { name: myName, points: (o.points || 0) + p, wins: (o.wins || 0) + w, games: (o.games || 0) + g });
      lbAt = 0;                                            // leaderboard cache is out of date now
      if (api.onStats) api.onStats(api.stats);
    };
    const p2 = chain.then(job, job);
    chain = p2.catch(() => {});
    return p2;
  }
  api.addPoints = function (pts, won) {
    if (!db || !uid || !myName) return Promise.resolve();
    return lbWrite(pts, won ? 1 : 0, 1).catch(() => {});
  };

  /* Top 50, fetched once and cached for a few minutes (pass force=true for a manual refresh). */
  api.getLeaderboard = function (force) {
    if (lbBusy) return lbBusy;
    if (!force && lbRows && Date.now() - lbAt < LB_EVERY) return Promise.resolve(lbRows);
    lbBusy = db.collection('leaderboard').orderBy('points', 'desc').limit(50).get().then((s) => {
      const a = [];
      s.forEach((d) => { a.push(Object.assign({ id: d.id }, d.data())); });
      a.sort((x, y) => (y.points - x.points) || (y.wins - x.wins));
      lbRows = a; lbAt = Date.now(); lbBusy = null; return a;
    }, (e) => { lbBusy = null; throw e; });
    return lbBusy;
  };

  /* ------------------------------------------------------------ presence & lobby */
  const beat = () => { lastBeat = Date.now(); return pdoc().set({ name: myName, ts: TS() }, { merge: true }); };

  async function goOnline() {
    await pdoc().set({ name: myName, ts: TS(), room: FV().delete() }, { merge: true });
    lastBeat = Date.now();
    try {                                                   // one read per session: clock difference to the server
      const s = await pdoc().get();
      if (s.exists && ms(s.data().ts)) offset = ms(s.data().ts) - Date.now();
    } catch (e) { /* keep 0 */ }
    welcomed = true;
    if (!hb) hb = setInterval(() => { if (welcomed && !document.hidden) beat().catch(() => {}); }, HEARTBEAT);
    emit({ t: 'welcome', id: uid, name: myName, list: [] });
  }

  const listArr = () => Object.keys(fresh).map((id) => ({ id, name: fresh[id].name, status: fresh[id].room ? 'playing' : 'free' }));

  /* Who is online: one query for recent presence rows, only when the lobby is looked at. */
  api.players = function (force) {
    if (!db || !welcomed) return Promise.resolve();
    if (playersBusy) return playersBusy;
    if (!force && Date.now() - playersAt < PLAYERS_EVERY) return Promise.resolve();
    const cutoff = firebase.firestore.Timestamp.fromMillis(now() - ONLINE_FOR);
    playersBusy = db.collection('players').where('ts', '>', cutoff).limit(50).get().then((s) => {
      const cur = {};
      s.forEach((d) => { const v = d.data(EST); cur[d.id] = { name: v.name || '?', room: v.room || null }; });
      cur[uid] = { name: myName, room: room ? room.id : null };
      fresh = cur; playersAt = Date.now(); playersBusy = null;
      emit({ t: 'players', list: listArr() });
    }, () => { playersBusy = null; });
    return playersBusy;
  };

  api.start = async function () {
    if (started) return;
    started = true;
    try {
      await goOnline();
    } catch (e) { started = false; throw e; }
    attachInvites();
    attachInbox();
    window.addEventListener('pagehide', () => { try { if (room) room.ref.delete(); pdoc().delete(); } catch (e) { /* best effort */ } });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && welcomed && Date.now() - lastBeat > HEARTBEAT / 2) beat().catch(() => {});
    });
  };

  /* ------------------------------------------------------------ lobby chat (only while it is on screen) */
  api.chatWatch = function (on) {
    if (!db || !welcomed) return;
    if (!on) { if (chatUnsub) { chatUnsub(); chatUnsub = null; } return; }
    if (chatUnsub) return;
    const col = db.collection('chat');
    const q = chatLastTs ? col.orderBy('ts').startAfter(chatLastTs) : col.orderBy('ts', 'desc').limit(CHAT_FIRST);
    const first = !chatLastTs;
    chatUnsub = q.onSnapshot((s) => {
      const add = [];
      s.docChanges().forEach((c) => {
        const t = c.doc.data().ts;                          // null while our own message is still pending
        if (t && (!chatLastTs || t.toMillis() > chatLastTs.toMillis())) chatLastTs = t;
        if (c.type === 'added' && !seenChat.has(c.doc.id)) { seenChat.add(c.doc.id); add.push(c.doc); }
      });
      const rows = add.map((d) => Object.assign({ id: d.id }, d.data(EST))).sort((a, b) => ms(a.ts) - ms(b.ts));
      rows.forEach((v) => { if (v.text) emit({ t: 'chat', from: v.from, name: v.name, text: v.text, ts: ms(v.ts) || Date.now(), hist: first }); });
    }, () => {});
  };

  /* ------------------------------------------------------------ private chat */
  /* Messages of one conversation, listened to only while that chat is open (null = close). */
  api.dmWatch = function (peer) {
    if (dmUnsub) { dmUnsub(); dmUnsub = null; }
    if (!peer || !db || !welcomed) return;
    const col = db.collection('dms/' + pairKey(peer) + '/msgs');
    const q = dmLast[peer] ? col.orderBy('ts').startAfter(dmLast[peer]) : col.orderBy('ts', 'desc').limit(30);
    dmUnsub = q.onSnapshot((s) => {
      const add = [];
      s.docChanges().forEach((c) => {
        const t = c.doc.data().ts;                          // null while our own message is pending
        if (t && (!dmLast[peer] || t.toMillis() > dmLast[peer].toMillis())) dmLast[peer] = t;
        if (c.type === 'added' && !dmSeen.has(c.doc.id)) { dmSeen.add(c.doc.id); add.push(c.doc); }
      });
      add.map((d) => Object.assign({ id: d.id }, d.data(EST))).sort((a, b) => ms(a.ts) - ms(b.ts))
        .forEach((v) => { if (v.text) emit({ t: 'dm', peer, from: v.from, text: v.text, ts: ms(v.ts) || Date.now() }); });
    }, () => {});
  };

  /* inbox/{me}: one tiny doc holding the latest message from each sender (unread badges, "Messages" list) */
  function attachInbox() {
    db.doc('inbox/' + uid).onSnapshot((s) => {
      const d = s.exists ? s.data() : {}, map = {};
      Object.keys(d).forEach((id) => { const v = d[id]; if (v && typeof v === 'object') map[id] = { n: v.n || '?', x: v.x || '', t: ms(v.t) || 0 }; });
      emit({ t: 'inbox', map });
    }, () => {});
  }

  /* ------------------------------------------------------------ invites */
  function attachInvites() {
    db.collection('invites').where('to', '==', uid).onSnapshot((s) => {
      s.docChanges().forEach((c) => {
        const id = c.doc.id, v = c.doc.data(EST);
        if (c.type === 'removed' || v.status !== 'pending') { delete invitesIn[id]; emit({ t: 'invite_gone', inviteId: id }); return; }
        if (c.type !== 'added') return;
        if (now() - (ms(v.ts) || now()) > 65000 || room) { c.doc.ref.delete().catch(() => {}); return; }
        invitesIn[id] = v;
        emit({ t: 'invite', inviteId: id, from: v.from, fromName: v.fromName, game: v.game, opts: v.opts || {} });
      });
    }, () => {});
  }

  function dropOutgoing(id, writes) {
    const o = outgoing[id]; if (!o) return;
    clearTimeout(o.timer); o.unsub(); delete outgoing[id];
    if (writes) db.doc('invites/' + id).delete().catch(() => {});
  }

  function invite(m) {
    const to = fresh[m.to];
    if (!to || m.to === uid || room || to.room) { emit({ t: 'invite_fail', reason: !to ? 'offline' : (to.room ? 'busy' : 'invalid') }); return; }
    if (Object.keys(outgoing).some((k) => outgoing[k].to === m.to)) { emit({ t: 'invite_fail', reason: 'already' }); return; }
    const ref = db.collection('invites').doc(), id = ref.id, toName = to.name, game = clean(m.game, 20);
    ref.set({ from: uid, fromName: myName, to: m.to, toName, game, opts: m.opts && typeof m.opts === 'object' ? m.opts : {}, status: 'pending', ts: TS() })
      .then(() => {
        const unsub = ref.onSnapshot((s) => {
          if (!s.exists) return;
          const v = s.data();
          if (v.status === 'declined') { dropOutgoing(id, true); emit({ t: 'invite_declined', inviteId: id, by: toName }); }
          else if (v.status === 'accepted' && v.room) {
            dropOutgoing(id, true);
            if (room) { db.doc('rooms/' + v.room).delete().catch(() => {}); return; }
            enterRoom(v.room, 0, game, v.opts || {}, [{ id: uid, name: myName }, { id: v.to, name: toName }]);
          }
        }, () => {});
        const timer = setTimeout(() => { if (!outgoing[id]) return; dropOutgoing(id, true); emit({ t: 'invite_expired', inviteId: id }); }, 60000);
        outgoing[id] = { to: m.to, timer, unsub };
        emit({ t: 'invite_sent', inviteId: id, to: m.to, toName, game });
      })
      .catch(() => emit({ t: 'invite_fail', reason: 'invalid' }));
  }

  async function reply(m) {
    const id = m.inviteId, ref = db.doc('invites/' + id), v = invitesIn[id];
    delete invitesIn[id];
    if (!v || v.to !== uid || v.status !== 'pending') return;
    if (!m.accept) { ref.update({ status: 'declined' }).catch(() => {}); return; }
    if (room) { ref.delete().catch(() => {}); emit({ t: 'invite_fail', reason: 'busy' }); return; }
    const roomId = db.collection('rooms').doc().id;
    try {
      const b = db.batch();
      b.set(db.doc('rooms/' + roomId), { game: v.game, opts: v.opts || {}, u0: v.from, u1: uid, n0: v.fromName, n1: myName, ts: TS(), moves: [], chat: [] });
      b.update(ref, { status: 'accepted', room: roomId });
      await b.commit();
    } catch (e) { emit({ t: 'invite_fail', reason: 'invalid' }); return; }
    enterRoom(roomId, 1, v.game, v.opts || {}, [{ id: v.from, name: v.fromName }, { id: uid, name: myName }]);
  }

  /* ------------------------------------------------------------ rooms */
  function enterRoom(id, you, game, opts, plist) {
    Object.keys(outgoing).forEach((k) => dropOutgoing(k, true));
    const ref = db.doc('rooms/' + id);
    room = { id, you, opp: plist[1 - you].id, ref, unsub: null, seen: new Set(), seenChat: new Set() };
    pdoc().update({ room: id }).catch(() => {});
    emit({ t: 'room_start', room: id, game, opts, players: plist, you });   // game screen exists before messages arrive
    const mine = room;
    mine.unsub = ref.onSnapshot((s) => {
      if (room !== mine) return;
      if (!s.exists) { if (!s.metadata.fromCache) { detachRoom(true); emit({ t: 'room_end', reason: 'left' }); } return; }
      const d = s.data();
      (d.moves || []).forEach((x) => {
        if (mine.seen.has(x.k)) return; mine.seen.add(x.k);
        if (x.f === you) return;
        let data; try { data = JSON.parse(x.d); } catch (e) { return; }
        emit({ t: 'game', from: mine.opp, data });
      });
      (d.chat || []).forEach((x) => {
        if (mine.seenChat.has(x.k)) return; mine.seenChat.add(x.k);
        emit({ t: 'room_chat', from: x.u, name: x.n, text: x.x, ts: x.t });
      });
    }, () => {});
  }

  function detachRoom(write) {
    if (!room) return;
    const r = room; room = null;
    if (r.unsub) r.unsub();
    if (write) pdoc().update({ room: FV().delete() }).catch(() => {});
  }

  function leaveRoom() {
    if (!room) return;
    const ref = room.ref;
    detachRoom(true);
    ref.delete().catch(() => {});                           // the other player sees the room disappear
  }

  /* ------------------------------------------------------------ outgoing messages */
  api.send = function (m) {
    if (!db || !uid || !welcomed) return;
    switch (m.t) {
      case 'chat': {
        const text = clean(m.text, 300); if (!text) return;
        db.collection('chat').add({ from: uid, name: myName, text, ts: TS() }).catch(() => {});
        break;
      }
      case 'dm': {
        const text = clean(m.text, 300); if (!text || !m.to || m.to === uid) return;
        db.collection('dms/' + pairKey(m.to) + '/msgs').add({ from: uid, text, ts: TS() }).catch(() => {});
        db.doc('inbox/' + m.to).set({ [uid]: { n: myName, x: text.slice(0, 80), t: TS() } }, { merge: true }).catch(() => {});
        break;
      }
      case 'invite': invite(m); break;
      case 'invite_cancel': dropOutgoing(m.inviteId, true); break;
      case 'invite_reply': reply(m); break;
      case 'game':
        if (room) room.ref.update({ moves: FV().arrayUnion({ f: room.you, d: JSON.stringify(m.data), k: uid + '-' + Date.now() + '-' + (++kN) }) }).catch(() => {});
        break;
      case 'room_chat': {
        const text = clean(m.text, 300); if (!text || !room) return;
        room.ref.update({ chat: FV().arrayUnion({ u: uid, n: myName, x: text, t: Date.now(), k: uid + '-' + Date.now() + '-' + (++kN) }) }).catch(() => {});
        break;
      }
      case 'leave_room': leaveRoom(); break;
      default: break;
    }
  };

  return api;
})();
