/* =====================================================================
   Tic-Tac-Toe, Connect Four, Rock-Paper-Scissors, Memory Match
   Each one: solo vs computer (where it makes sense) + 2-player over the lobby
   ===================================================================== */
(function () {
  const pill = (text, cls) => h('span', { class: 'pill ' + (cls || ''), text });
  function scoreRow(a, b, mid) {
    return h('div', { class: 'scorebar' }, pill(a[0] + '  ' + a[1], a[2]), mid != null ? pill(mid) : null, pill(b[0] + '  ' + b[1], b[2]));
  }
  function resultCard(emoji, title, sub, label, onClick) {
    return h('div', { class: 'card', style: { textAlign: 'center', marginTop: '12px' } },
      h('div', { style: { fontSize: '34px' }, text: emoji }), h('b', { text: title, style: { fontSize: '18px' } }),
      sub ? h('div', { class: 'muted small', style: { margin: '4px 0 0' }, text: sub }) : null,
      label ? h('button', { class: 'btn primary block', style: { marginTop: '12px' }, text: label, onclick: (e) => onClick(e.target) }) : null);
  }
  function Rematch(ctx, restart) {
    let m = false, t = false;
    const chk = () => { if (m && t) { m = t = false; restart(); } };
    return {
      request(btn) { if (m) return; m = true; if (btn) btn.textContent = 'Waiting…'; ctx.send({ k: 'rematch' }); chk(); },
      theirs() { t = true; if (!m) toast(ctx.opp.name + ' wants a rematch'); chk(); },
      reset() { m = t = false; },
    };
  }

  /* ============================== Tic-Tac-Toe ============================== */
  const LINES3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const win3 = (b) => { for (const l of LINES3) if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]]) return { s: b[l[0]], l }; return null; };
  function tttBest(b, sym) {
    const opp = sym === 'X' ? 'O' : 'X';
    const mm = (bd, turn, d) => {
      const w = win3(bd); if (w) return w.s === sym ? 10 - d : d - 10;
      if (bd.every(Boolean)) return 0;
      let best = turn === sym ? -99 : 99;
      for (let i = 0; i < 9; i++) if (!bd[i]) { bd[i] = turn; const v = mm(bd, turn === sym ? opp : sym, d + 1); bd[i] = ''; best = turn === sym ? Math.max(best, v) : Math.min(best, v); }
      return best;
    };
    let bi = -1, bv = -99;
    const order = shuffle([...Array(9).keys()]);
    for (const i of order) if (!b[i]) { b[i] = sym; const v = mm(b, opp, 1); b[i] = ''; if (v > bv) { bv = v; bi = i; } }
    return bi;
  }

  function xoCreate(ctx) {
    const multi = ctx.mode === 'multi';
    const me = multi ? (ctx.isHost ? 'X' : 'O') : 'X', opp = me === 'X' ? 'O' : 'X';
    const oppName = multi ? ctx.opp.name : 'Computer';
    const hard = ctx.opts.level !== 'easy';
    let b = Array(9).fill(''), turn = 'X', round = 0, over = false, sc = { me: 0, opp: 0 }, destroyed = false;
    const head = h('div'), status = h('div', { class: 'statusline' }), grid = h('div', { class: 'xo' }), res = h('div');
    const btns = [];
    for (let i = 0; i < 9; i++) { const bt = h('button', { 'aria-label': 'cell ' + (i + 1), onclick: () => play(i) }); btns.push(bt); grid.append(bt); }
    ctx.root.append(head, status, grid, res);

    const starter = () => (round % 2 === 0 ? 'X' : 'O');
    function render(wl) {
      btns.forEach((bt, i) => { bt.textContent = b[i]; bt.className = b[i] + (wl && wl.includes(i) ? ' win' : ''); bt.disabled = !!b[i] || over; });
      head.replaceChildren(scoreRow(['You (' + me + ')', sc.me, turn === me && !over ? 'turn' : ''], [oppName + ' (' + opp + ')', sc.opp, turn === opp && !over ? 'turn' : '']));
      if (!over) status.textContent = ctx.gone && multi ? 'Opponent is gone' : (turn === me ? 'Your turn' : (multi ? oppName + ' is thinking…' : 'Computer is thinking…'));
    }
    function place(i, sym) {
      b[i] = sym; vibrate(10);
      const w = win3(b);
      if (w) { end(w.s === me ? 'me' : 'opp', w.l); return; }
      if (b.every(Boolean)) { end('draw'); return; }
      turn = sym === 'X' ? 'O' : 'X'; render();
      if (!multi && turn === opp) cpu();
    }
    function play(i) {
      if (over || b[i] || turn !== me || ctx.gone) return;
      if (multi) ctx.send({ k: 'm', i, r: round });
      place(i, me);
    }
    function cpu() {
      setTimeout(() => {
        if (destroyed || over || turn !== opp) return;
        let i;
        const free = b.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0);
        if (hard || Math.random() < 0.35) i = tttBest(b.slice(), opp); else i = free[rint(free.length)];
        place(i, opp);
      }, 450);
    }
    function end(who, line) {
      over = true; ctx.over = true;
      award('xo', who === 'me' ? 'win' : who === 'opp' ? 'loss' : 'draw', { mode: ctx.mode, level: ctx.opts.level });
      if (who === 'me') sc.me++; else if (who === 'opp') sc.opp++;
      render(line);
      const t = who === 'me' ? 'You win! 🎉' : who === 'opp' ? oppName + ' wins' : "It's a draw";
      status.textContent = t; if (who === 'me') confetti();
      res.replaceChildren(resultCard(who === 'me' ? '🏆' : who === 'opp' ? '😅' : '🤝', t, null, 'Next round', () => { if (multi) ctx.send({ k: 'next', r: round + 1 }); nextRound(); }));
    }
    function nextRound() {
      round++; b = Array(9).fill(''); over = false; ctx.over = false; turn = starter(); res.replaceChildren(); render();
      if (!multi && turn === opp) cpu();
    }
    function onMsg(d) {
      if (!d) return;
      if (d.k === 'm' && !over && d.r === round && turn === opp && !b[d.i]) place(d.i, opp);
      else if (d.k === 'next' && over && d.r === round + 1) nextRound();
    }
    render(); turn = starter(); render();
    return { onMsg, destroy() { destroyed = true; } };
  }

  GAMES.xo = {
    id: 'xo', name: 'Tic-Tac-Toe', tint: 'tint3', icon: '<span style="font-weight:800;font-size:26px">✕○</span>',
    tagline: 'Quick rounds, running score', desc: 'Best played in streaks. First player alternates every round.',
    solo: true, multi: true, soloSub: 'vs Computer', soloLabel: 'Start',
    options: [{ key: 'level', label: 'Computer', mode: 'solo', def: 'hard', choices: [['easy', 'Easy'], ['hard', 'Unbeatable']] }],
    create: xoCreate,
  };

  /* =============================== Connect Four =============================== */
  const ROWS = 6, COLS = 7, ORDER = [3, 2, 4, 1, 5, 0, 6];
  function c4Drop(b, col, p) { for (let r = ROWS - 1; r >= 0; r--) if (!b[r * COLS + col]) { b[r * COLS + col] = p; return r; } return -1; }
  function c4Win(b, p) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (b[r * COLS + c] !== p) continue;
      for (const [dr, dc] of dirs) {
        const cells = [r * COLS + c]; let ok = true;
        for (let k = 1; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || b[rr * COLS + cc] !== p) { ok = false; break; } cells.push(rr * COLS + cc); }
        if (ok) return cells;
      }
    }
    return null;
  }
  function c4Eval(b, p) {
    const o = 3 - p; let s = 0;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const [dr, dc] of dirs) {
      let mine = 0, theirs = 0, ok = true;
      for (let k = 0; k < 4; k++) { const rr = r + dr * k, cc = c + dc * k; if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) { ok = false; break; } const v = b[rr * COLS + cc]; if (v === p) mine++; else if (v === o) theirs++; }
      if (!ok) continue;
      if (mine && !theirs) s += mine === 3 ? 6 : mine === 2 ? 2 : 0.3;
      else if (theirs && !mine) s -= theirs === 3 ? 7 : theirs === 2 ? 2 : 0.3;
    }
    for (let r = 0; r < ROWS; r++) if (b[r * COLS + 3] === p) s += 1.5;
    return s;
  }
  function c4Search(b, depth, a, bt, p) {
    let best = -Infinity, any = false;
    for (const col of ORDER) {
      const r = c4Drop(b, col, p); if (r < 0) continue; any = true;
      let v;
      if (c4Win(b, p)) v = 100000 + depth;
      else if (depth <= 1) v = c4Eval(b, p);
      else v = -c4Search(b, depth - 1, -bt, -a, 3 - p);
      b[r * COLS + col] = 0;
      if (v > best) best = v;
      if (best > a) a = best;
      if (a >= bt) break;
    }
    return any ? best : 0;
  }
  function c4Pick(b, p, depth, noise) {
    let bc = -1, bv = -Infinity;
    for (const col of shuffle(ORDER)) {
      const r = c4Drop(b, col, p); if (r < 0) continue;
      let v = c4Win(b, p) ? 100000 + depth : (depth <= 1 ? c4Eval(b, p) : -c4Search(b, depth - 1, -Infinity, Infinity, 3 - p));
      b[r * COLS + col] = 0;
      v += Math.random() * noise;
      if (v > bv) { bv = v; bc = col; }
    }
    return bc;
  }

  function c4Create(ctx) {
    const multi = ctx.mode === 'multi';
    const me = multi ? (ctx.isHost ? 1 : 2) : 1, opp = 3 - me;
    const oppName = multi ? ctx.opp.name : 'Computer';
    const depth = { easy: 2, medium: 4, hard: 6 }[ctx.opts.level || 'medium'] || 4;
    const noise = ctx.opts.level === 'easy' ? 6 : 0.01;
    let b = Array(42).fill(0), turn = 1, round = 0, over = false, sc = { me: 0, opp: 0 }, destroyed = false, lastIdx = -1, busy = false;
    const head = h('div'), status = h('div', { class: 'statusline' }), res = h('div');
    const board = h('div', { class: 'c4' });
    const slots = [];
    for (let c = 0; c < COLS; c++) {
      const col = h('button', { class: 'col', 'aria-label': 'Drop in column ' + (c + 1), onclick: () => play(c) });
      for (let r = 0; r < ROWS; r++) { const s = h('div', { class: 'slot' }); slots[r * COLS + c] = s; col.append(s); }
      board.append(col);
    }
    ctx.root.append(head, status, board, res);
    const starter = () => (round % 2 === 0 ? 1 : 2);
    const color = (p) => (p === 1 ? 'R' : 'Y');
    function renderHead() {
      head.replaceChildren(scoreRow(['You (' + (me === 1 ? '🔴' : '🟡') + ')', sc.me, turn === me && !over ? 'turn' : ''], [oppName + ' (' + (opp === 1 ? '🔴' : '🟡') + ')', sc.opp, turn === opp && !over ? 'turn' : '']));
      if (!over) status.textContent = ctx.gone && multi ? 'Opponent is gone' : (turn === me ? 'Your turn - tap a column' : oppName + ' is thinking…');
    }
    function drop(col, p) {
      const r = c4Drop(b, col, p); if (r < 0) return false;
      const idx = r * COLS + col;
      slots.forEach((s) => s.classList.remove('lastm'));
      slots[idx].append(h('i', { class: color(p) })); slots[idx].classList.add('lastm'); lastIdx = idx; vibrate(10);
      const w = c4Win(b, p);
      if (w) { w.forEach((i) => slots[i].classList.add('win')); end(p === me ? 'me' : 'opp'); return true; }
      if (b.every(Boolean)) { end('draw'); return true; }
      turn = 3 - p; renderHead();
      if (!multi && turn === opp) cpu();
      return true;
    }
    function play(col) {
      if (over || turn !== me || ctx.gone) return;
      if (b[col]) { toast('That column is full'); return; }
      if (multi) ctx.send({ k: 'm', c: col, r: round });
      drop(col, me);
    }
    function cpu() {
      setTimeout(() => {
        if (destroyed || over || turn !== opp) return;
        const col = c4Pick(b.slice(), opp, depth, noise);
        if (col >= 0) drop(col, opp);
      }, 600);
    }
    function end(who) {
      over = true; ctx.over = true;
      award('c4', who === 'me' ? 'win' : who === 'opp' ? 'loss' : 'draw', { mode: ctx.mode, level: ctx.opts.level });
      if (who === 'me') sc.me++; else if (who === 'opp') sc.opp++;
      renderHead();
      const t = who === 'me' ? 'You win! 🎉' : who === 'opp' ? oppName + ' wins' : "It's a draw";
      status.textContent = t; if (who === 'me') confetti();
      res.replaceChildren(resultCard(who === 'me' ? '🏆' : who === 'opp' ? '😅' : '🤝', t, null, 'Next round', () => { if (multi) ctx.send({ k: 'next', r: round + 1 }); nextRound(); }));
    }
    function nextRound() {
      round++; b = Array(42).fill(0); over = false; ctx.over = false; turn = starter(); res.replaceChildren();
      slots.forEach((s) => { s.replaceChildren(); s.className = 'slot'; });
      renderHead();
      if (!multi && turn === opp) cpu();
    }
    function onMsg(d) {
      if (!d) return;
      if (d.k === 'm' && !over && d.r === round && turn === opp) drop(d.c, opp);
      else if (d.k === 'next' && over && d.r === round + 1) nextRound();
    }
    turn = starter(); renderHead();
    return { onMsg, destroy() { destroyed = true; } };
  }

  GAMES.c4 = {
    id: 'c4', name: 'Connect 4', tint: 'tint5', icon: '<span style="font-size:20px;white-space:nowrap;letter-spacing:-3px">🔴🟡</span>',
    tagline: 'Drop, line up four', desc: 'Get four in a row before your opponent does. Running score across rounds.',
    solo: true, multi: true, soloSub: 'vs Computer', soloLabel: 'Start',
    options: [{ key: 'level', label: 'Computer', mode: 'solo', def: 'medium', choices: [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']] }],
    create: c4Create,
  };

  /* ============================ Rock Paper Scissors ============================ */
  const HANDS = { r: '✊', p: '✋', s: '✌️' };
  const beats = { r: 's', p: 'r', s: 'p' };
  function rpsCreate(ctx) {
    const multi = ctx.mode === 'multi';
    const target = ctx.opts.goal === '5' ? 5 : (ctx.opts.goal === '1' ? 1 : 3);
    const oppName = multi ? ctx.opp.name : 'Computer';
    let round = 1, myPick = null, theirPicks = {}, sc = { me: 0, opp: 0 }, history = [], revealing = false, matchOver = false, destroyed = false;
    const head = h('div'), status = h('div', { class: 'statusline' }), arena = h('div', { class: 'arena' }), dots = h('div', { class: 'rounds' }), res = h('div');
    const btns = {};
    const row = h('div', { class: 'rps' }, ['r', 'p', 's'].map((k) => (btns[k] = h('button', { 'aria-label': k, onclick: () => pick(k), text: HANDS[k] }))));
    ctx.root.append(head, dots, arena, status, row, res);
    const rematch = Rematch(ctx, () => reset());

    function renderHead() {
      head.replaceChildren(scoreRow(['You', sc.me, ''], [oppName, sc.opp, ''], 'First to ' + target));
      dots.replaceChildren(...history.map((x) => h('i', { class: x })));
    }
    function showArena(a, b2, outcome) {
      arena.replaceChildren(
        h('div', { class: 'hand ' + (outcome === 'w' ? 'win' : outcome === 'l' ? 'lose' : ''), text: a ? HANDS[a] : '❔' }),
        h('div', { class: 'vs', text: 'VS' }),
        h('div', { class: 'hand ' + (outcome === 'l' ? 'win' : outcome === 'w' ? 'lose' : ''), text: b2 ? HANDS[b2] : '❔' }));
    }
    function pick(k) {
      if (revealing || matchOver || myPick || ctx.gone) return;
      myPick = k; vibrate(10);
      Object.keys(btns).forEach((x) => { btns[x].classList.toggle('pick', x === k); btns[x].disabled = x !== k; });
      if (multi) { ctx.send({ k: 'pick', v: k, r: round }); status.textContent = 'Waiting for ' + oppName + '…'; showArena(k, null, null); arena.firstChild.textContent = '✔️'; tryReveal(); }
      else { theirPicks[round] = ['r', 'p', 's'][rint(3)]; tryReveal(); }
    }
    function tryReveal() {
      const t = theirPicks[round];
      if (!myPick || !t || revealing) return;
      revealing = true;
      const out = myPick === t ? 'd' : (beats[myPick] === t ? 'w' : 'l');
      showArena(myPick, t, out);
      if (out === 'w') sc.me++; else if (out === 'l') sc.opp++;
      history.push(out === 'w' ? 'w' : out === 'l' ? 'l' : 'd');
      status.textContent = out === 'w' ? 'You win this round!' : out === 'l' ? oppName + ' wins this round' : 'Draw - go again';
      renderHead();
      if (sc.me >= target || sc.opp >= target) { setTimeout(() => finish(), 900); return; }
      setTimeout(() => { if (destroyed) return; round++; myPick = null; revealing = false; delete theirPicks[round - 1]; Object.keys(btns).forEach((x) => { btns[x].classList.remove('pick'); btns[x].disabled = false; }); showArena(null, null, null); status.textContent = 'Round ' + round + ' - choose!'; if (theirPicks[round]) status.textContent += ' (' + oppName + ' is ready)'; }, 1800);
    }
    function finish() {
      matchOver = true; ctx.over = true;
      const won = sc.me > sc.opp;
      award('rps', won ? 'win' : 'loss', { mode: ctx.mode, level: ctx.opts.goal });
      if (won) confetti();
      res.replaceChildren(resultCard(won ? '🏆' : '😅', won ? 'You win the match! 🎉' : oppName + ' wins the match', sc.me + ' - ' + sc.opp, multi ? 'Rematch' : 'Play again', (btn) => { if (multi) rematch.request(btn); else reset(); }));
    }
    function reset() {
      round = 1; myPick = null; theirPicks = {}; sc = { me: 0, opp: 0 }; history = []; revealing = false; matchOver = false; ctx.over = false;
      res.replaceChildren(); Object.keys(btns).forEach((x) => { btns[x].classList.remove('pick'); btns[x].disabled = false; });
      showArena(null, null, null); renderHead(); status.textContent = 'Round 1 - choose!';
    }
    function onMsg(d) {
      if (!d) return;
      if (d.k === 'pick' && HANDS[d.v]) { theirPicks[d.r] = d.v; if (d.r === round) { if (myPick) tryReveal(); else if (!revealing) status.textContent = oppName + ' is ready - your turn!'; } }
      else if (d.k === 'rematch') rematch.theirs();
    }
    reset();
    return { onMsg, destroy() { destroyed = true; } };
  }

  GAMES.rps = {
    id: 'rps', name: 'Rock Paper Scissors', tint: 'tint4', icon: '<span style="font-size:28px">✊</span>',
    tagline: 'Best of a series', desc: 'Both players pick in secret, then the hands are revealed together.',
    solo: true, multi: true, soloSub: 'vs Computer', soloLabel: 'Start',
    options: [{ key: 'goal', label: 'First to', def: '3', choices: [['1', '1 win'], ['3', '3 wins'], ['5', '5 wins']] }],
    describe(o) { return 'first to ' + (o.goal || 3); },
    create: rpsCreate,
  };

  /* ================================ Memory Match ================================ */
  const FACES = ['🍎', '🚀', '🐱', '🌵', '🎲', '🍕', '🦊', '🎧', '⚽', '🌈', '🍩', '🐙', '🔔', '🍉', '🎸', '🦋', '🌙', '🍋'];
  const SIZES = { s: { pairs: 8, cols: 4 }, m: { pairs: 10, cols: 4 }, l: { pairs: 15, cols: 5 } };
  function memCreate(ctx) {
    const multi = ctx.mode === 'multi';
    const size = SIZES[ctx.opts.size] || SIZES.s;
    const oppName = multi ? ctx.opp.name : '';
    let deck = [], up = [], done = [], owner = [], turn = 0, lock = false, sc = [0, 0], moves = 0, queue = [], ready = false, finished = false, destroyed = false;
    let t0 = 0, timer = null;
    const myIdx = ctx.idx;
    const head = h('div'), status = h('div', { class: 'statusline' }), grid = h('div', { class: 'mem', style: { gridTemplateColumns: 'repeat(' + size.cols + ',1fr)' } }), res = h('div');
    ctx.root.append(head, status, grid, res);
    const rematch = Rematch(ctx, () => { if (ctx.isHost) newDeck(); else { ready = false; grid.style.opacity = '.4'; status.textContent = 'Shuffling…'; } });
    let cardEls = [];

    function build() {
      cardEls = deck.map((f, i) => h('div', { class: 'card3d', onclick: () => tap(i) }, h('div', { class: 'inner' }, h('div', { class: 'b', text: '?' }), h('div', { class: 'f', text: FACES[f] }))));
      grid.replaceChildren(...cardEls); grid.style.opacity = '';
    }
    function newDeck() {
      const ids = shuffle([...Array(FACES.length).keys()]).slice(0, size.pairs);
      const d = shuffle([...ids, ...ids]);
      if (multi) ctx.send({ k: 'deck', d });
      startDeck(d);
    }
    function startDeck(d) {
      deck = d; up = []; done = deck.map(() => false); owner = deck.map(() => -1); turn = 0; lock = false; sc = [0, 0]; moves = 0; queue = []; ready = true; finished = false; ctx.over = false;
      res.replaceChildren(); build(); renderHead(); t0 = Date.now(); clearInterval(timer);
      if (!multi) timer = setInterval(() => { if (!finished) renderHead(); }, 1000);
    }
    function renderHead() {
      if (multi) {
        head.replaceChildren(scoreRow(['You', sc[myIdx], turn === myIdx && !finished ? 'turn me' : 'me'], [oppName, sc[1 - myIdx], turn !== myIdx && !finished ? 'turn th' : 'th']));
        if (!finished) status.textContent = ctx.gone ? 'Opponent is gone' : (turn === myIdx ? 'Your turn - flip two cards' : oppName + ' is picking…');
      } else {
        head.replaceChildren(scoreRow(['Pairs', sc[0] + '/' + size.pairs, ''], ['Moves', moves, ''], fmtTime(Date.now() - t0)));
        if (!finished) status.textContent = 'Find all the pairs';
      }
    }
    function tap(i) {
      if (!ready || lock || finished || ctx.gone || done[i] || up.includes(i)) return;
      if (multi && turn !== myIdx) return;
      flip(i);
      if (multi) ctx.send({ k: 'f', i });
    }
    function flip(i) {
      if (lock) { queue.push(i); return; }
      if (done[i] || up.includes(i) || up.length >= 2) return;
      up.push(i); cardEls[i].classList.add('up'); vibrate(8);
      if (up.length === 2) {
        moves++; lock = true;
        const [a, b] = up;
        if (deck[a] === deck[b]) {
          setTimeout(() => {
            if (destroyed) return;
            [a, b].forEach((x) => { done[x] = true; owner[x] = turn; cardEls[x].classList.remove('up'); cardEls[x].classList.add('done'); if (multi) cardEls[x].classList.add(turn === myIdx ? 'mine' : 'theirs'); });
            sc[multi ? turn : 0]++; up = []; lock = false; renderHead();
            if (done.every(Boolean)) return end();
            drain();
          }, 450);
        } else {
          setTimeout(() => {
            if (destroyed) return;
            cardEls[a].classList.remove('up'); cardEls[b].classList.remove('up'); up = []; lock = false;
            if (multi) turn = 1 - turn;
            renderHead(); drain();
          }, 950);
        }
      }
    }
    function drain() { while (queue.length && !lock) flip(queue.shift()); }
    function end() {
      finished = true; ctx.over = true; clearInterval(timer);
      if (!multi) {
        award('memory', 'win', { mode: 'solo', level: ctx.opts.size });
        const t = Date.now() - t0, best = store.get('mem_best_' + ctx.opts.size, null); let sub = fmtTime(t) + ' · ' + moves + ' moves';
        if (!best || moves < best) { store.set('mem_best_' + ctx.opts.size, moves); sub += ' · New best!'; }
        confetti(); status.textContent = 'All pairs found!';
        res.replaceChildren(resultCard('🎉', 'Well done!', sub, 'Play again', () => newDeck()));
      } else {
        const mine = sc[myIdx], theirs = sc[1 - myIdx];
        award('memory', mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw', { mode: 'multi' });
        const t = mine > theirs ? 'You win! 🎉' : mine < theirs ? oppName + ' wins' : "It's a tie";
        if (mine > theirs) confetti();
        status.textContent = t; renderHead();
        res.replaceChildren(resultCard(mine > theirs ? '🏆' : mine < theirs ? '😅' : '🤝', t, mine + ' - ' + theirs + ' pairs', 'Rematch', (btn) => rematch.request(btn)));
      }
    }
    function onMsg(d) {
      if (!d) return;
      if (d.k === 'deck') startDeck(d.d);
      else if (d.k === 'f' && ready && turn !== myIdx) flip(d.i);
      else if (d.k === 'rematch') rematch.theirs();
    }
    if (!multi || ctx.isHost) newDeck(); else { status.textContent = 'Shuffling…'; }
    return { onMsg, destroy() { destroyed = true; clearInterval(timer); } };
  }

  GAMES.memory = {
    id: 'memory', name: 'Memory Match', tint: 'tint6', icon: '<span style="font-size:28px">🃏</span>',
    tagline: 'Flip, remember, match', desc: 'Find the pairs. Solo against the clock, or take turns with a friend - a match lets you go again.',
    solo: true, multi: true, soloSub: 'Solo', soloLabel: 'Start',
    options: [{ key: 'size', label: 'Board', def: 's', choices: [['s', '4×4'], ['m', '4×5'], ['l', '5×6']] }],
    describe(o) { return { s: '4×4', m: '4×5', l: '5×6' }[o.size] || '4×4'; },
    create: memCreate,
  };
})();
