/* =====================================================================
   Sudoku - solo, race (same puzzle, first to finish) and co-op (shared board)
   ===================================================================== */
(function () {
  const CLUES = { easy: 40, medium: 33, hard: 28, expert: 24 };
  const DIFF_NAME = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

  /* ---------- solver / generator ---------- */
  const peersOf = (i) => [Math.floor(i / 9), i % 9, Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3)];
  const POP = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

  function solve(g, limit, rng) {
    const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
    for (let i = 0; i < 81; i++) {
      if (!g[i]) continue;
      const [r, c, b] = peersOf(i), bit = 1 << (g[i] - 1);
      if ((rows[r] | cols[c] | boxes[b]) & bit) return { count: 0, sol: null };
      rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
    }
    let count = 0, sol = null;
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const rec = () => {
      let bi = -1, bc = 10, bm = 0;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const [r, c, b] = peersOf(i);
        const m = ~(rows[r] | cols[c] | boxes[b]) & 511, n = POP(m);
        if (n < bc) { bc = n; bi = i; bm = m; if (n <= 1) break; }
      }
      if (bi < 0) { count++; if (!sol) sol = g.slice(); return count >= limit; }
      if (bc === 0) return false;
      const [r, c, b] = peersOf(bi);
      const digs = rng ? shuffle(order, rng) : order;
      for (const d of digs) {
        const bit = 1 << d;
        if (!(bm & bit)) continue;
        rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit; g[bi] = d + 1;
        const stop = rec();
        g[bi] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
        if (stop) return true;
      }
      return false;
    };
    rec();
    return { count, sol };
  }

  function generate(diff) {
    const rng = Math.random;
    const full = solve(new Array(81).fill(0), 1, rng).sol;
    const puz = full.slice();
    const target = CLUES[diff] || 33;
    let clues = 81;
    const idx = shuffle([...Array(81).keys()], rng);
    for (const i of idx) {
      if (clues <= target) break;
      const keep = puz[i]; puz[i] = 0;
      if (solve(puz.slice(), 2).count !== 1) puz[i] = keep; else clues--;
    }
    return { given: puz, sol: full };
  }

  /* ---------- game ---------- */
  function create(ctx) {
    const multi = ctx.mode === 'multi';
    const smode = multi ? (ctx.opts.smode === 'coop' ? 'coop' : 'race') : 'solo';
    const diff = CLUES[ctx.opts.diff] ? ctx.opts.diff : 'medium';
    const limit = !multi && String(ctx.opts.limit || '3') === '3';
    let given = [], sol = [], val = [], notes = [], who = [];
    let sel = -1, notesMode = false, undo = [], redo = [], mistakes = 0, hints = 0;
    let elapsed = 0, lastTick = 0, paused = false, finished = false, ready = false, limitOn = limit, destroyed = false;
    let oppProg = 0, myDone = null, oppDone = null, rematchMine = false, rematchTheirs = false;
    let timer = null, curDiff = diff;

    /* --- dom --- */
    const infoL = h('span'), infoT = h('b', { text: '00:00' });
    const pauseBtn = h('button', { class: 'iconbtn', style: { width: '34px', height: '34px', borderRadius: '10px' }, 'aria-label': 'Pause', onclick: () => setPaused(!paused) }, ico('pause', 'ic i20'));
    const newBtn = h('button', { class: 'btn sm', text: 'New', onclick: () => newGameConfirm() });
    const info = h('div', { class: 'sdk-info' }, infoL, h('div', { class: 'row', style: { gap: '8px' } }, infoT, multi ? null : pauseBtn, multi ? null : newBtn));
    const myBar = h('i', { style: { width: '0%' } }), opBar = h('i', { style: { width: '0%' } });
    const progBox = multi && smode === 'race' ? h('div', { style: { margin: '0 2px 8px' } },
      h('div', { class: 'row', style: { gap: '8px', fontSize: '12.5px', fontWeight: 700, marginBottom: '4px' } }, h('span', { text: 'You', style: { width: '56px' } }), h('div', { class: 'prog' }, myBar)),
      h('div', { class: 'row', style: { gap: '8px', fontSize: '12.5px', fontWeight: 700 } }, h('span', { text: ctx.opp.name, style: { width: '56px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }), h('div', { class: 'prog opp' }, opBar))) : null;
    const grid = h('div', { class: 'sdk-grid' });
    const gridWrap = h('div', { style: { position: 'relative', width: 'fit-content', margin: '0 auto', maxWidth: '100%' } });
    gridWrap.style.width = '100%';
    const cells = [];
    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / 9), c = i % 9;
      const cell = h('div', { class: 'cell' + (r === 2 || r === 5 ? ' r2' : '') + (c === 2 || c === 5 ? ' c2' : ''), onpointerdown: (e) => { e.preventDefault(); select(i); } });
      cells.push(cell); grid.append(cell);
    }
    gridWrap.append(grid);
    const mkTool = (name, label, fn) => { const b = h('button', { onclick: fn }, ico(name, 'ic'), label); return b; };
    const bUndo = mkTool('undo', 'Undo', () => doUndo()), bRedo = mkTool('redo', 'Redo', () => doRedo());
    const bErase = mkTool('eraser', 'Erase', () => erase()), bNotes = mkTool('pencil', 'Notes', () => { notesMode = !notesMode; refreshTools(); });
    const hintCnt = h('span', { class: 'cnt', hidden: true });
    const bHint = mkTool('bulb', 'Hint', () => hint()); bHint.append(hintCnt);
    const tools = h('div', { class: 'tools' }, bUndo, bRedo, bErase, bNotes, bHint);
    const pad = h('div', { class: 'pad' });
    const padBtns = [];
    for (let d = 1; d <= 9; d++) { const b = h('button', { onpointerdown: (e) => { e.preventDefault(); input(d); } }, String(d), h('small', { text: '' })); padBtns.push(b); pad.append(b); }
    const resultBox = h('div');
    const waiting = h('div', { class: 'card empty' }, h('div', { class: 'big', text: '🧩' }), 'Preparing the puzzle…');
    ctx.root.append(info); if (progBox) ctx.root.append(progBox); ctx.root.append(gridWrap, tools, pad, resultBox);
    if (multi && !ctx.isHost) { grid.style.opacity = '.35'; resultBox.append(waiting); }

    /* --- helpers --- */
    const correct = (i) => val[i] === sol[i];
    const filledCorrect = () => { let n = 0; for (let i = 0; i < 81; i++) if (!given[i] && val[i] === sol[i]) n++; return n; };
    const totalEmpty = () => given.filter((v) => !v).length;
    const pct = () => Math.round(filledCorrect() / Math.max(1, totalEmpty()) * 100);
    const nowMs = () => elapsed + (paused || finished || !ready ? 0 : Date.now() - lastTick);

    function setPuzzle(g, s, d) {
      given = g.slice(); sol = s.slice(); curDiff = d;
      val = g.slice(); notes = new Array(81).fill(0); who = new Array(81).fill(0);
      sel = -1; undo = []; redo = []; mistakes = 0; hints = 0; elapsed = 0; finished = false; paused = false; ready = true;
      myDone = oppDone = null; oppProg = 0; limitOn = limit; ctx.over = false;
      lastTick = Date.now(); resultBox.replaceChildren(); grid.style.opacity = '';
      const old = $('.paused', gridWrap); if (old) old.remove();
      refresh(); save();
    }
    function newPuzzle(d) {
      const p = generate(d);
      setPuzzle(p.given, p.sol, d);
      if (multi) ctx.send({ k: 'puz', g: p.given.join(''), s: p.sol.join(''), d, m: smode });
    }

    function select(i) { sel = i; refresh(); }

    function snapshot() { undo.push({ v: val.slice(), n: notes.slice() }); if (undo.length > 200) undo.shift(); redo = []; }
    function removeFromPeers(i, d) {
      const [r, c, b] = peersOf(i), bit = 1 << (d - 1);
      for (let j = 0; j < 81; j++) { const [r2, c2, b2] = peersOf(j); if (j !== i && (r2 === r || c2 === c || b2 === b)) notes[j] &= ~bit; }
    }

    function input(d) {
      if (!ready || finished || paused || sel < 0 || given[sel]) return;
      if (val[sel] && correct(sel)) return;                       // correct entries are locked
      if (notesMode && !val[sel]) { snapshot(); notes[sel] ^= 1 << (d - 1); refresh(); save(); return; }
      if (notesMode && val[sel]) return;
      if (val[sel] === d) { erase(); return; }
      snapshot();
      val[sel] = d; notes[sel] = 0; who[sel] = 1;
      if (d !== sol[sel]) { mistakes++; vibrate(60); } else { removeFromPeers(sel, d); }
      if (multi && smode === 'coop') ctx.send({ k: 'set', i: sel, v: d });
      afterChange(true);
    }
    function erase() {
      if (!ready || finished || paused || sel < 0 || given[sel]) return;
      if (val[sel] && correct(sel)) return;
      if (!val[sel] && !notes[sel]) return;
      snapshot(); val[sel] = 0; notes[sel] = 0; who[sel] = 0;
      if (multi && smode === 'coop') ctx.send({ k: 'set', i: sel, v: 0 });
      afterChange(false);
    }
    function hint() {
      if (!ready || finished || paused || (multi && smode === 'race')) return;
      let i = sel;
      if (i < 0 || given[i] || correct(i)) {
        const empties = []; for (let j = 0; j < 81; j++) if (!given[j] && !correct(j)) empties.push(j);
        if (!empties.length) return;
        i = empties[rint(empties.length)]; sel = i;
      }
      snapshot(); val[i] = sol[i]; notes[i] = 0; who[i] = 1; hints++;
      removeFromPeers(i, sol[i]);
      if (multi && smode === 'coop') ctx.send({ k: 'set', i, v: sol[i] });
      afterChange(true);
    }
    function doUndo() {
      if (!undo.length || finished || (multi && smode === 'coop')) return;
      redo.push({ v: val.slice(), n: notes.slice() });
      const s = undo.pop(); val = s.v; notes = s.n; refresh(); save(); sendProgress();
    }
    function doRedo() {
      if (!redo.length || finished || (multi && smode === 'coop')) return;
      undo.push({ v: val.slice(), n: notes.slice() });
      const s = redo.pop(); val = s.v; notes = s.n; refresh(); save(); sendProgress();
    }

    function afterChange(placed) {
      refresh(); save(); sendProgress();
      if (limitOn && mistakes >= 3 && !finished) { tooManyMistakes(); return; }
      if (placed && val.every((v, i) => v === sol[i])) win();
    }
    function sendProgress() { if (multi && smode === 'race') { ctx.send({ k: 'prog', n: pct() }); myBar.style.width = pct() + '%'; } }

    function tooManyMistakes() {
      setPausedInternal(true);
      let close;
      close = openSheet(h('div', null,
        h('h3', { text: '3 mistakes' }),
        h('p', { class: 'muted', style: { margin: '6px 0 16px' }, text: 'You can start a fresh puzzle or keep going without the limit.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', text: 'Keep playing', onclick: () => { close(); limitOn = false; setPausedInternal(false); refresh(); } }),
          h('button', { class: 'btn primary grow', text: 'New puzzle', onclick: () => { close(); newPuzzle(curDiff); } }))), { center: true, locked: true });
    }

    function win() {
      if (finished) return;
      const t = nowMs(); finished = true; ctx.over = true; clearInterval(timer); infoT.textContent = fmtTime(t);
      sel = -1; refresh(); clearSave();
      award('sudoku', 'win', { mode: multi ? 'multi' : 'solo', smode, level: curDiff, hints, mistakes });
      let title = 'Solved! 🎉', extra = '';
      if (multi && smode === 'race') {
        myDone = t; ctx.send({ k: 'done', t });
        if (oppDone != null && oppDone < t) { title = ctx.opp.name + ' finished first'; extra = ''; }
        else { confetti(); title = 'You win the race! 🏁'; }
        if (oppDone != null && oppDone >= t) title = 'You win the race! 🏁';
      } else confetti();
      if (!multi) {
        const best = store.get('sdk_best', {});
        if (!best[curDiff] || t < best[curDiff]) { best[curDiff] = t; store.set('sdk_best', best); extra = 'New best time!'; }
        else extra = 'Best: ' + fmtTime(best[curDiff]);
      }
      showResult(title, t, extra);
    }
    function showResult(title, t, extra) {
      resultBox.replaceChildren(h('div', { class: 'card', style: { textAlign: 'center', marginTop: '12px' } },
        h('b', { text: title, style: { fontSize: '19px' } }),
        h('div', { class: 'muted', style: { margin: '6px 0 2px' }, text: DIFF_NAME[curDiff] + ' · ' + fmtTime(t) + ' · ' + mistakes + ' mistake' + (mistakes === 1 ? '' : 's') + (hints ? ' · ' + hints + ' hint' + (hints === 1 ? '' : 's') : '') }),
        extra ? h('div', { class: 'tag g', text: extra }) : null,
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'btn primary grow', text: multi ? (rematchMine ? 'Waiting…' : 'Rematch') : 'New puzzle', onclick: (e) => { if (multi) { if (rematchMine) return; rematchMine = true; e.target.textContent = 'Waiting…'; ctx.send({ k: 'rematch' }); checkRematch(); } else newPuzzle(curDiff); } }))));
    }
    function lose(who2) {
      finished = true; ctx.over = true; clearInterval(timer); sel = -1; refresh();
      award('sudoku', 'loss', { mode: 'multi', smode });
      showResult(who2 + ' finished first', nowMs(), '');
    }

    function newGameConfirm() {
      if (!finished && ready && val.some((v, i) => v && !given[i])) confirmDialog('Start a new puzzle?', 'Your current progress will be lost.', 'New puzzle', () => newPuzzle(curDiff), null, true);
      else newPuzzle(curDiff);
    }

    /* --- pause / timer --- */
    function setPausedInternal(p) {
      if (finished) return;
      if (p && !paused) elapsed += Date.now() - lastTick;
      if (!p && paused) lastTick = Date.now();
      paused = p;
    }
    function setPaused(p) {
      if (multi || finished || !ready) return;
      setPausedInternal(p);
      const old = $('.paused', gridWrap); if (old) old.remove();
      if (p) gridWrap.append(h('div', { class: 'paused', onclick: () => setPaused(false) }, h('div', null, h('div', { style: { fontSize: '40px' }, text: '⏸' }), 'Paused - tap to resume')));
      pauseBtn.replaceChildren(ico(p ? 'play' : 'pause', 'ic i20'));
      save();
    }
    timer = setInterval(() => { if (ready && !paused && !finished) infoT.textContent = fmtTime(nowMs()); }, 500);
    const onVis = () => { if (document.hidden && !multi) setPaused(true); };
    document.addEventListener('visibilitychange', onVis);

    /* --- persistence (solo only) --- */
    function save() {
      if (multi || !ready || finished) return;
      store.set('sdk_save', { d: curDiff, g: given.join(''), s: sol.join(''), v: val.join(''), n: notes, t: nowMs(), m: mistakes, h: hints });
    }
    function clearSave() { if (!multi) store.del('sdk_save'); }
    function tryResume() {
      const sv = store.get('sdk_save', null);
      if (!sv || sv.d !== diff || !sv.g || sv.g.length !== 81) return false;
      const dg = (s) => s.split('').map(Number);
      given = dg(sv.g); sol = dg(sv.s); val = dg(sv.v); notes = sv.n || new Array(81).fill(0); who = new Array(81).fill(0);
      mistakes = sv.m || 0; hints = sv.h || 0; elapsed = sv.t || 0; lastTick = Date.now(); curDiff = sv.d; ready = true; finished = false;
      refresh(); toast('Resumed your saved game');
      return true;
    }

    /* --- rendering --- */
    function refresh() {
      const sv = sel >= 0 ? val[sel] : 0;
      const sr = sel >= 0 ? peersOf(sel) : null;
      // duplicates
      const dup = new Set();
      if (ready) {
        for (let i = 0; i < 81; i++) {
          if (!val[i]) continue;
          const [r, c, b] = peersOf(i);
          for (let j = i + 1; j < 81; j++) {
            if (val[j] !== val[i]) continue;
            const [r2, c2, b2] = peersOf(j);
            if (r === r2 || c === c2 || b === b2) { dup.add(i); dup.add(j); }
          }
        }
      }
      for (let i = 0; i < 81; i++) {
        const el = cells[i], cls = ['cell', (Math.floor(i / 9) === 2 || Math.floor(i / 9) === 5) ? 'r2' : '', (i % 9 === 2 || i % 9 === 5) ? 'c2' : ''];
        if (!ready) { el.className = cls.join(' '); el.textContent = ''; continue; }
        if (given[i]) cls.push('given');
        if (sr) { const p = peersOf(i); if (p[0] === sr[0] || p[1] === sr[1] || p[2] === sr[2]) cls.push('rel'); }
        if (sv && val[i] === sv) cls.push('same');
        if (val[i] && !given[i] && val[i] !== sol[i]) cls.push('err');
        else if (dup.has(i) && !given[i]) cls.push('conf');
        if (who[i] === 2) cls.push('theirs');
        if (i === sel) cls.push('sel');
        el.className = cls.filter(Boolean).join(' ');
        if (val[i]) { if (el.firstChild && el.firstChild.nodeType === 3 && el.childNodes.length === 1) el.firstChild.nodeValue = val[i]; else el.replaceChildren(String(val[i])); }
        else if (notes[i]) {
          const nn = h('div', { class: 'notes' });
          for (let d = 1; d <= 9; d++) nn.append(h('span', { class: sv === d && (notes[i] & (1 << (d - 1))) ? 'hl' : '', text: notes[i] & (1 << (d - 1)) ? String(d) : '' }));
          el.replaceChildren(nn);
        } else if (el.firstChild) el.replaceChildren();
      }
      refreshTools(); refreshInfo();
    }
    function refreshTools() {
      bNotes.classList.toggle('on', notesMode); bNotes.lastChild.textContent = '';
      bNotes.replaceChildren(ico('pencil', 'ic'), 'Notes ' + (notesMode ? 'on' : 'off'));
      pad.classList.toggle('notes-on', notesMode);
      const count = new Array(10).fill(0);
      for (let i = 0; i < 81; i++) if (val[i]) count[val[i]]++;
      padBtns.forEach((b, k) => { const d = k + 1, left = 9 - count[d]; b.lastChild.textContent = left > 0 ? left : ''; b.disabled = left <= 0 && !notesMode; });
      const noUndo = multi && smode === 'coop';
      bUndo.disabled = noUndo || !undo.length; bRedo.disabled = noUndo || !redo.length;
      bUndo.style.opacity = bUndo.disabled ? .35 : 1; bRedo.style.opacity = bRedo.disabled ? .35 : 1;
      const noHint = multi && smode === 'race';
      bHint.disabled = noHint; bHint.style.opacity = noHint ? .35 : 1;
      hintCnt.hidden = !hints; hintCnt.textContent = hints;
    }
    function refreshInfo() {
      infoL.replaceChildren(h('span', { text: DIFF_NAME[curDiff] + (multi ? ' · ' + (smode === 'coop' ? 'Co-op' : 'Race') : '') }), ' · Mistakes ', h('b', { text: mistakes + (limitOn ? '/3' : '') }));
    }

    /* --- keyboard --- */
    const onKey = (e) => {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      if (e.key >= '1' && e.key <= '9') input(+e.key);
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') erase();
      else if (e.key === 'n' || e.key === 'N') { notesMode = !notesMode; refreshTools(); }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault(); if (sel < 0) sel = 40; else { const r = Math.floor(sel / 9), c = sel % 9; const nr = Math.max(0, Math.min(8, r + (e.key === 'ArrowDown') - (e.key === 'ArrowUp'))), nc = Math.max(0, Math.min(8, c + (e.key === 'ArrowRight') - (e.key === 'ArrowLeft'))); sel = nr * 9 + nc; } refresh();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') doUndo();
    };
    document.addEventListener('keydown', onKey);

    /* --- multiplayer --- */
    function checkRematch() {
      if (!(rematchMine && rematchTheirs)) return;
      rematchMine = rematchTheirs = false;
      if (ctx.isHost) newPuzzle(curDiff);
      else { ready = false; grid.style.opacity = '.35'; resultBox.replaceChildren(waiting); refresh(); }
    }
    function onMsg(d) {
      if (!d) return;
      if (d.k === 'puz') {
        const dg = (s) => s.split('').map(Number);
        setPuzzle(dg(d.g), dg(d.s), d.d);
        myBar.style.width = '0%'; opBar.style.width = '0%';
      } else if (d.k === 'prog') { oppProg = d.n; opBar.style.width = d.n + '%'; }
      else if (d.k === 'done') {
        oppDone = d.t;
        if (finished && myDone != null) { if (oppDone < myDone) { resultBox.replaceChildren(); showResult(ctx.opp.name + ' finished first', myDone, ''); } }
        else if (!finished) lose(ctx.opp.name);
      } else if (d.k === 'set' && smode === 'coop') {
        if (given[d.i] || finished) return;
        val[d.i] = d.v; notes[d.i] = 0; who[d.i] = d.v ? 2 : 0;
        if (d.v && d.v !== sol[d.i]) mistakes++; else if (d.v) removeFromPeers(d.i, d.v);
        refresh();
        if (d.v && val.every((v, i) => v === sol[i])) win();
      } else if (d.k === 'rematch') { rematchTheirs = true; if (!rematchMine) toast(ctx.opp.name + ' wants a rematch'); checkRematch(); }
    }

    /* --- start --- */
    refresh();
    if (!multi) {
      setTimeout(() => { if (destroyed) return; if (!tryResume()) newPuzzle(diff); }, 30);
    } else if (ctx.isHost) {
      setTimeout(() => { if (!destroyed) newPuzzle(diff); }, 30);
    }
    return {
      onMsg,
      destroy() { destroyed = true; clearInterval(timer); document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVis); save(); },
    };
  }

  GAMES.sudoku = {
    id: 'sudoku', name: 'Sudoku', tint: 'tint2', icon: '<span style="font-weight:800;font-size:22px;letter-spacing:-1px">9×9</span>',
    tagline: 'Solo, race or co-op', desc: 'Notes, hints, undo, mistake check, timer and auto-save. Race a friend or solve one board together.',
    solo: true, multi: true, soloSub: 'Solo', soloLabel: 'Start puzzle',
    options: [
      { key: 'diff', label: 'Difficulty', def: 'medium', choices: [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['expert', 'Expert']] },
      { key: 'limit', label: 'Mistake limit', mode: 'solo', def: '3', choices: [['3', '3 mistakes'], ['off', 'No limit']] },
      { key: 'smode', label: 'Mode', mode: 'multi', def: 'race', choices: [['race', 'Race (same puzzle)'], ['coop', 'Co-op (one board)']] },
    ],
    describe(o) { return (o.smode === 'coop' ? 'Co-op' : 'Race') + ' · ' + (DIFF_NAME[o.diff] || 'Medium'); },
    create,
  };
})();
