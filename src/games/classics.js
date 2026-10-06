/* =====================================================================
   Tic-Tac-Toe and Connect Four
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
})();
