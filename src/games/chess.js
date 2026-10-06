/* =====================================================================
   Chess - vs Stockfish (WASM) or a friend
   ===================================================================== */
(function () {
  const LEVELS = {
    1: { skill: 0, ms: 60, depth: 1, fb: 1 },
    2: { skill: 4, ms: 150, depth: 4, fb: 2 },
    3: { skill: 9, ms: 400, depth: 8, fb: 2 },
    4: { skill: 15, ms: 900, depth: 12, fb: 3 },
    5: { skill: 20, ms: 1600, depth: 16, fb: 3 },
  };
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

  /* ---------- engine: Stockfish worker with a built-in fallback ---------- */
  function StockfishEngine() {
    let w = null, ready = false, failed = false, waiter = null, readyCbs = [];
    const fail = () => { failed = true; if (w) { try { w.terminate(); } catch (e) { /* ignore */ } } readyCbs.splice(0).forEach((f) => f(false)); if (waiter) waiter(null); };
    try {
      w = new Worker('vendor/stockfish-19-lite-single.js');
      w.onerror = fail;
      w.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line === 'uciok') { w.postMessage('setoption name Hash value 16'); w.postMessage('isready'); }
        else if (line === 'readyok' && !ready) { ready = true; readyCbs.splice(0).forEach((f) => f(true)); }
        else if (line.startsWith('bestmove') && waiter) { const f = waiter; waiter = null; f(line.split(' ')[1]); }
      };
      w.postMessage('uci');
      setTimeout(() => { if (!ready && !failed) fail(); }, 9000);
    } catch (e) { failed = true; }
    return {
      whenReady() { return new Promise((res) => { if (ready) res(true); else if (failed) res(false); else readyCbs.push(res); }); },
      get ok() { return ready && !failed; },
      skill(n) { if (w && ready) w.postMessage('setoption name Skill Level value ' + n); },
      best(fen, ms, depth) {
        return new Promise((res) => {
          if (!ready || failed) return res(null);
          waiter = res;
          w.postMessage('position fen ' + fen);
          w.postMessage('go movetime ' + ms + (depth ? ' depth ' + depth : ''));
        });
      },
      stop() { if (w && waiter) { w.postMessage('stop'); } },
      destroy() { try { if (w) w.terminate(); } catch (e) { /* ignore */ } w = null; waiter = null; },
    };
  }

  /* small alpha-beta used only if the WASM engine cannot start (e.g. blocked workers) */
  const PV = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  function evalPos(ch) {
    const b = ch.board(); let s = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c]; if (!p) continue;
      let v = PV[p.type];
      const cen = (3.5 - Math.abs(3.5 - c)) + (3.5 - Math.abs(3.5 - r));
      if (p.type === 'p') v += (p.color === 'w' ? 6 - r : r - 1) * 7 + cen * 2;
      else if (p.type === 'n' || p.type === 'b') v += cen * 5;
      else if (p.type === 'q') v += cen;
      s += p.color === 'w' ? v : -v;
    }
    return s;
  }
  function negamax(ch, d, a, b) {
    if (ch.in_checkmate()) return -99000 - d;
    if (d === 0 || ch.in_draw()) return ch.in_draw() ? 0 : (ch.turn() === 'w' ? 1 : -1) * evalPos(ch);
    const ms = ch.moves({ verbose: true });
    ms.sort((x, y) => (y.captured ? 10 : 0) - (x.captured ? 10 : 0));
    let best = -Infinity;
    for (const m of ms) {
      ch.move(m);
      const v = -negamax(ch, d - 1, -b, -a);
      ch.undo();
      if (v > best) best = v;
      if (best > a) a = best;
      if (a >= b) break;
    }
    return best;
  }
  function fallbackMove(fen, depth) {
    const ch = new Chess(fen);
    const ms = shuffleArr(ch.moves({ verbose: true }));
    let best = null, bv = -Infinity;
    for (const m of ms) {
      ch.move(m);
      const v = -negamax(ch, depth - 1, -Infinity, Infinity) + (depth === 1 ? Math.random() * 120 : 0);
      ch.undo();
      if (v > bv) { bv = v; best = m; }
    }
    return best ? best.from + best.to + (best.promotion || '') : null;
  }
  const shuffleArr = (a) => shuffle(a);

  /* ---------------------------------------------------------------- game */
  function create(ctx) {
    const multi = ctx.mode === 'multi';
    const level = LEVELS[ctx.opts.level || 2] || LEVELS[2];
    let myColor;
    if (multi) { const hostColor = ctx.opts.color === 'b' ? 'b' : 'w'; myColor = ctx.isHost ? hostColor : (hostColor === 'w' ? 'b' : 'w'); }
    else myColor = ctx.opts.color === 'b' ? 'b' : (ctx.opts.color === 'r' ? (Math.random() < .5 ? 'w' : 'b') : 'w');
    const oppName = multi ? ctx.opp.name : 'Stockfish';

    let ch = new Chess();
    let flipped = myColor === 'b';
    let sel = null, legal = [], last = null, hintMv = null, drag = null;
    let result = null, thinking = false, token = 0, destroyed = false;
    let rematchMine = false, rematchTheirs = false, drawOffered = false;
    let engine = null, engineNote = '';

    /* ----- dom ----- */
    const board = h('div', { class: 'board' });
    const promo = h('div', { class: 'promo', hidden: true });
    const wrap = h('div', { class: 'chess-wrap', style: { position: 'relative' } }, board, promo);
    const topBar = h('div', { class: 'capbar' }), botBar = h('div', { class: 'capbar' });
    const status = h('div', { class: 'statusline' });
    const notice = h('div');
    const moves = h('div', { class: 'movelist' });
    const resultBox = h('div');
    const foot = h('div', { class: 'gfoot' });
    ctx.root.append(topBar, wrap, botBar, status, notice, moves, resultBox, foot);

    /* ----- helpers ----- */
    const canMove = () => !result && !thinking && !ctx.gone && ch.turn() === myColor;
    const pieceStyle = (c, t) => 'url("' + PIECE_IMG[c + t] + '")';
    const fileOf = (x) => 'abcdefgh'[x];

    function capturedLists() {
      const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
      ch.board().forEach((row) => row.forEach((p) => { if (p && p.type !== 'k') cnt[p.color][p.type]++; }));
      const lost = { w: [], b: [] }; let score = { w: 0, b: 0 };
      for (const c of ['w', 'b']) for (const t of ['q', 'r', 'b', 'n', 'p']) {
        for (let i = 0; i < START[t] - cnt[c][t]; i++) lost[c].push(t);
        score[c] += cnt[c][t] * VAL[t];
      }
      return { lost, adv: score.w - score.b };
    }
    function drawBars() {
      const { lost, adv } = capturedLists();
      const opp = myColor === 'w' ? 'b' : 'w';
      const fill = (bar, name, takenColor, ahead) => bar.replaceChildren(
        h('div', { class: 'nm', text: name }),
        h('div', { class: 'caps' }, lost[takenColor].map((t) => h('i', { style: { backgroundImage: pieceStyle(takenColor, t) } }))),
        h('span', { class: 'adv', text: ahead > 0 ? '+' + ahead : '' }));
      const myAdv = myColor === 'w' ? adv : -adv;
      fill(topBar, oppName, myColor, myAdv < 0 ? -myAdv : 0);            // opp captured my pieces
      fill(botBar, (ctx.me.name || 'You') + ' (you)', opp, myAdv > 0 ? myAdv : 0);
    }

    function draw() {
      const b = ch.board();
      const checkSq = ch.in_check() ? findKing(ch.turn()) : null;
      const frag = document.createDocumentFragment();
      for (let vr = 0; vr < 8; vr++) for (let vc = 0; vc < 8; vc++) {
        const r = flipped ? 7 - vr : vr, c = flipped ? 7 - vc : vc;
        const name = fileOf(c) + (8 - r);
        const dark = (r + c) % 2 === 1;
        const p = b[r][c];
        const mv = legal.find((m) => m.to === name);
        const cls = ['sq', dark ? 'd' : 'l'];
        if (last && (last.from === name || last.to === name)) cls.push('last');
        if (sel === name) cls.push('sel');
        if (checkSq === name) cls.push('chk');
        if (hintMv && (hintMv.from === name || hintMv.to === name)) cls.push('hint');
        if (mv && p) cls.push('cap');
        const sq = h('div', { class: cls.join(' '), 'data-sq': name });
        if (vc === 0) sq.append(h('span', { class: 'co r', text: String(8 - r) }));
        if (vr === 7) sq.append(h('span', { class: 'co f', text: fileOf(c) }));
        if (p) sq.append(h('div', { class: 'pc', style: { backgroundImage: pieceStyle(p.color, p.type) } }));
        if (mv) sq.append(h('div', { class: 'dot' }));
        frag.append(sq);
      }
      board.replaceChildren(frag);
      drawBars(); drawMoves(); drawStatus(); drawFoot();
    }
    function findKing(color) {
      const b = ch.board();
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = b[r][c]; if (p && p.type === 'k' && p.color === color) return fileOf(c) + (8 - r); }
      return null;
    }
    function drawMoves() {
      const hist = ch.history();
      const items = [];
      for (let i = 0; i < hist.length; i += 2) {
        items.push(h('span', { class: i + 2 >= hist.length ? 'cur' : '', text: (i / 2 + 1) + '. ' + hist[i] + (hist[i + 1] ? ' ' + hist[i + 1] : '') }));
      }
      moves.replaceChildren(...items);
      moves.scrollLeft = moves.scrollWidth;
    }
    function drawStatus() {
      let t;
      if (result) t = result.text;
      else if (thinking) { status.replaceChildren(h('span', { class: 'think' }), 'Stockfish is thinking…'); return; }
      else if (ctx.gone && multi) t = 'Opponent is gone';
      else {
        const mine = ch.turn() === myColor;
        t = (ch.in_check() ? 'Check! ' : '') + (mine ? 'Your move' : (multi ? oppName + ' is thinking…' : ''));
      }
      status.textContent = t + (engineNote && !multi ? '' : '');
    }
    function drawFoot() {
      foot.replaceChildren();
      const add = (label, icon, fn, cls, dis) => foot.append(h('button', { class: 'btn sm ' + (cls || ''), disabled: dis, onclick: fn }, ico(icon, 'ic i20'), label));
      add('Flip', 'flip', () => { flipped = !flipped; draw(); });
      if (!multi) {
        add('Undo', 'undo', undo, '', thinking || ch.history().length < (myColor === 'w' ? 1 : 2) || !!result && false);
        add('Hint', 'bulb', hint, '', thinking || !!result || ch.turn() !== myColor);
        add('New', 'refresh', newGameConfirm);
      } else if (!result) {
        add(drawOffered ? 'Draw sent' : 'Draw', 'hand', offerDraw, '', drawOffered || ctx.gone);
        add('Resign', 'flag', () => confirmDialog('Resign?', 'This counts as a loss.', 'Resign', resign, null, true), 'danger', ctx.gone);
      }
    }

    /* ----- interaction ----- */
    function sqFromPoint(x, y) {
      const r = board.getBoundingClientRect();
      const bw = board.clientWidth, bh = board.clientHeight;
      const px = x - r.left - board.clientLeft, py = y - r.top - board.clientTop;
      if (px < 0 || py < 0 || px >= bw || py >= bh) return null;
      let c = Math.floor(px / bw * 8), rr = Math.floor(py / bh * 8);
      if (flipped) { c = 7 - c; rr = 7 - rr; }
      return fileOf(c) + (8 - rr);
    }
    function select(sq) { sel = sq; legal = ch.moves({ square: sq, verbose: true }); hintMv = null; draw(); }
    function clearSel() { sel = null; legal = []; }

    board.addEventListener('pointerdown', (e) => {
      if (!canMove()) return;
      const sq = sqFromPoint(e.clientX, e.clientY); if (!sq) return;
      if (sel && legal.some((m) => m.to === sq)) { tryMove(sel, sq); return; }
      const p = ch.get(sq);
      if (p && p.color === myColor) {
        select(sq);
        const el = board.querySelector('[data-sq="' + sq + '"] .pc');
        drag = { sq, el, x0: e.clientX, y0: e.clientY, moved: false };
        try { board.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      } else { clearSel(); draw(); }
    });
    board.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) > 7) { drag.moved = true; if (drag.el) drag.el.classList.add('drag'); }
      if (drag.moved && drag.el) drag.el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.18)';
    });
    const endDrag = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.moved) return;
      const t = sqFromPoint(e.clientX, e.clientY);
      if (t && t !== d.sq && legal.some((m) => m.to === t)) tryMove(d.sq, t); else draw();
    };
    board.addEventListener('pointerup', endDrag);
    board.addEventListener('pointercancel', () => { if (drag) { drag = null; draw(); } });

    function tryMove(from, to) {
      const cand = legal.filter((m) => m.from === from && m.to === to);
      if (!cand.length) { clearSel(); draw(); return; }
      if (cand[0].promotion) { askPromotion(from, to); return; }
      doMove(from, to);
    }
    function askPromotion(from, to) {
      promo.hidden = false;
      promo.replaceChildren(h('div', null, ['q', 'r', 'b', 'n'].map((t) => h('i', { title: NAMES[t], style: { backgroundImage: pieceStyle(myColor, t) }, onclick: () => { promo.hidden = true; doMove(from, to, t); } }))));
    }

    function doMove(from, to, pr, remote) {
      const mv = ch.move({ from, to, promotion: pr || 'q' });
      if (!mv) { clearSel(); draw(); return false; }
      last = { from: mv.from, to: mv.to }; hintMv = null; clearSel();
      vibrate(remote ? 25 : 12);
      if (multi && !remote) ctx.send({ k: 'move', from: mv.from, to: mv.to, pr: mv.promotion || null });
      afterMove();
      return true;
    }

    function afterMove() {
      if (ch.game_over()) {
        let text;
        if (ch.in_checkmate()) { const whiteWon = ch.turn() === 'b'; const iWon = (whiteWon ? 'w' : 'b') === myColor; text = 'Checkmate - ' + (iWon ? 'you win! 🎉' : (multi ? oppName + ' wins' : 'Stockfish wins')); finish(text, iWon ? 'win' : 'loss'); }
        else if (ch.in_stalemate()) finish('Draw by stalemate', 'draw');
        else if (ch.insufficient_material()) finish('Draw - not enough material', 'draw');
        else if (ch.in_threefold_repetition()) finish('Draw by repetition', 'draw');
        else finish('Draw (50-move rule)', 'draw');
        return;
      }
      draw();
      if (!multi && ch.turn() !== myColor) engineTurn();
    }

    function finish(text, kind) {
      result = { text, kind }; ctx.over = true; thinking = false; clearSel();
      award('chess', kind === 'win' ? 'win' : kind === 'draw' ? 'draw' : 'loss', { mode: ctx.mode, level: ctx.opts.level });
      if (kind === 'win') { confetti(); }
      draw();
      const box = h('div', { class: 'card', style: { textAlign: 'center', marginTop: '10px' } },
        h('div', { style: { fontSize: '34px' }, text: kind === 'win' ? '🏆' : kind === 'draw' ? '🤝' : '♟️' }),
        h('b', { text: text }),
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'btn primary grow', text: multi ? (rematchMine ? 'Waiting…' : 'Rematch') : 'Play again', onclick: (e) => { if (multi) { if (rematchMine) return; rematchMine = true; e.target.textContent = 'Waiting…'; ctx.send({ k: 'rematch' }); checkRematch(); } else newGame(); } })));
      resultBox.replaceChildren(box);
    }

    /* ----- solo: engine ----- */
    async function engineTurn() {
      if (destroyed) return;
      const my = ++token;
      thinking = true; draw();
      if (!engine) { engine = StockfishEngine(); }
      let uci = null;
      const ok = await engine.whenReady();
      if (my !== token || destroyed) return;
      if (ok) { engine.skill(level.skill); uci = await engine.best(ch.fen(), level.ms, level.depth); }
      if (my !== token || destroyed) return;
      if (!uci) { await new Promise((r) => setTimeout(r, 60)); uci = fallbackMove(ch.fen(), level.fb); engineNote = 'basic'; }
      if (my !== token || destroyed) return;
      thinking = false;
      if (!uci) { draw(); return; }
      doMove(uci.slice(0, 2), uci.slice(2, 4), uci[4], true);
    }
    async function hint() {
      if (thinking || result || ch.turn() !== myColor) return;
      thinking = true; draw();
      const my = token;
      if (!engine) engine = StockfishEngine();
      const ok = await engine.whenReady();
      let uci = null;
      if (ok) { engine.skill(20); uci = await engine.best(ch.fen(), 700, 14); engine.skill(level.skill); }
      if (!uci) uci = fallbackMove(ch.fen(), 3);
      if (destroyed || my !== token) return;
      thinking = false;
      if (uci) { hintMv = { from: uci.slice(0, 2), to: uci.slice(2, 4) }; }
      draw();
    }
    function undo() {
      if (thinking) return;
      token++;
      const n = ch.history().length; if (!n) return;
      ch.undo();
      if (ch.turn() !== myColor && ch.history().length) ch.undo();
      result = null; ctx.over = false; resultBox.replaceChildren();
      const h2 = ch.history({ verbose: true }); last = h2.length ? { from: h2[h2.length - 1].from, to: h2[h2.length - 1].to } : null;
      clearSel(); hintMv = null; draw();
      if (ch.turn() !== myColor) engineTurn();
    }
    function newGameConfirm() {
      if (ch.history().length > 1 && !result) confirmDialog('Start a new game?', 'Your current game will be lost.', 'New game', newGame, null, true); else newGame();
    }
    function newGame() {
      token++; thinking = false;
      if (ctx.opts.color === 'r') myColor = Math.random() < .5 ? 'w' : 'b';
      ch = new Chess(); last = null; hintMv = null; clearSel(); result = null; ctx.over = false;
      flipped = myColor === 'b'; resultBox.replaceChildren(); draw();
      if (ch.turn() !== myColor) engineTurn();
    }

    /* ----- multiplayer ----- */
    function offerDraw() { if (drawOffered || result) return; drawOffered = true; ctx.send({ k: 'draw' }); toast('Draw offer sent'); draw(); }
    function resign() { if (result) return; ctx.send({ k: 'resign' }); finish('You resigned', 'loss'); }
    function checkRematch() {
      if (!(rematchMine && rematchTheirs)) return;
      rematchMine = rematchTheirs = false;
      myColor = myColor === 'w' ? 'b' : 'w';
      ch = new Chess(); last = null; hintMv = null; clearSel(); result = null; ctx.over = false; drawOffered = false;
      flipped = myColor === 'b'; resultBox.replaceChildren(); notice.replaceChildren();
      toast('New game - you are ' + (myColor === 'w' ? 'White' : 'Black')); draw();
    }
    function onMsg(d) {
      if (!d || !multi) return;
      if (d.k === 'move') {
        if (result || ch.turn() === myColor) return;
        doMove(d.from, d.to, d.pr || undefined, true);
      } else if (d.k === 'resign') {
        if (!result) finish(oppName + ' resigned - you win! 🎉', 'win');
      } else if (d.k === 'draw') {
        if (result) return;
        notice.replaceChildren(h('div', { class: 'card', style: { marginTop: '8px' } },
          h('b', { text: oppName + ' offers a draw' }),
          h('div', { class: 'row', style: { marginTop: '10px' } },
            h('button', { class: 'btn grow', text: 'Decline', onclick: () => { ctx.send({ k: 'drawres', ok: false }); notice.replaceChildren(); } }),
            h('button', { class: 'btn ok grow', text: 'Accept', onclick: () => { ctx.send({ k: 'drawres', ok: true }); notice.replaceChildren(); finish('Draw by agreement', 'draw'); } }))));
      } else if (d.k === 'drawres') {
        drawOffered = false;
        if (d.ok) finish('Draw by agreement', 'draw'); else { toast(oppName + ' declined the draw'); draw(); }
      } else if (d.k === 'rematch') {
        rematchTheirs = true;
        if (!rematchMine) toast(oppName + ' wants a rematch');
        checkRematch();
      }
    }

    draw();
    if (!multi) {
      ctx.setSub('vs Stockfish · ' + ['', 'Beginner', 'Easy', 'Medium', 'Hard', 'Max'][ctx.opts.level || 2]);
      if (ch.turn() !== myColor) engineTurn();
      else { engine = StockfishEngine(); }         // warm up while the player thinks
    } else {
      ctx.setSub('vs ' + oppName + ' · you are ' + (myColor === 'w' ? 'White' : 'Black'));
    }
    return {
      onMsg,
      onLeft() { draw(); },
      destroy() { destroyed = true; if (engine) engine.destroy(); },
    };
  }

  GAMES.chess = {
    id: 'chess', name: 'Chess', tint: 'tint1', icon: '<span style="font-family:\'Segoe UI Symbol\',\'Noto Sans Symbols 2\',\'Apple Symbols\',serif;font-size:34px;line-height:1">♞&#xFE0E;</span>',
    tagline: 'Stockfish or a friend', desc: 'Classic chess with legal-move hints, drag & tap, and a built-in Stockfish engine.',
    solo: true, multi: true, soloSub: 'vs Stockfish', soloLabel: 'Start game',
    options: [
      { key: 'level', label: 'Stockfish strength', mode: 'solo', def: '2', choices: [['1', 'Beginner'], ['2', 'Easy'], ['3', 'Medium'], ['4', 'Hard'], ['5', 'Max']] },
      { key: 'color', label: 'Play as', def: 'w', choices: [['w', 'White'], ['b', 'Black'], ['r', 'Random']] },
    ],
    resolve(o) { if (o.color === 'r') o.color = Math.random() < .5 ? 'w' : 'b'; return o; },
    describe(o) { return 'they play ' + (o.color === 'b' ? 'Black' : 'White'); },
    create,
  };
})();
