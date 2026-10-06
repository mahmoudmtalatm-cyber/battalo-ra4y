'use strict';
/* =====================================================================
   Battalo Ra4y - point system
   ===================================================================== */
const POINTS = {
  /* beating the computer: points depend on the level */
  solo: {
    xo: { easy: 2, hard: 6 },
    c4: { easy: 2, medium: 4, hard: 7 },
    chess: { '1': 2, '2': 4, '3': 7, '4': 10, '5': 14 },
    sudoku: { easy: 6, medium: 10, hard: 15, expert: 20 },
  },
  /* playing a real friend */
  multi: { win: 15, draw: 6, loss: 2 },
  sudokuRace: { win: 20, loss: 3 },
  sudokuCoop: 10,
};

/* result: 'win' | 'draw' | 'loss'.  o: { mode, level, smode, hints, mistakes } */
function award(gameId, result, o = {}) {
  let pts = 0;
  if (o.mode === 'multi') {
    if (gameId === 'sudoku' && o.smode === 'coop') pts = result === 'win' ? POINTS.sudokuCoop : 0;
    else if (gameId === 'sudoku') pts = result === 'win' ? POINTS.sudokuRace.win : POINTS.sudokuRace.loss;
    else pts = POINTS.multi[result] || 0;
  } else {
    const base = (POINTS.solo[gameId] || {})[o.level] || 0;
    if (result === 'win') pts = base;
    else if (result === 'draw') pts = Math.max(1, Math.round(base / 3));
    if (gameId === 'sudoku' && result === 'win') pts = Math.max(2, base - 2 * (o.hints || 0) - (o.mistakes || 0));
  }
  NET.addPoints(pts, result === 'win');
  if (pts) toast('+' + pts + ' points ⭐');
  return pts;
}
