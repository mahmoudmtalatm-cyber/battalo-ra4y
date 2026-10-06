// Inlines CSS + JS into public/index.html  ->  node build.js
const fs = require('fs'), path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const js = ['src/pieces.js', 'src/utils.js', 'src/net.js', 'src/points.js', 'src/games/chess.js', 'src/games/sudoku.js', 'src/games/classics.js', 'src/app.js']
  .map(r).join('\n;\n') + '\n;init();\n';
let html = r('src/index.template.html');
html = html.replace('/*__CSS__*/', () => r('src/style.css')).replace('/*__JS__*/', () => js.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync(path.join(__dirname, 'public/index.html'), html);
console.log('built public/index.html', (html.length / 1024).toFixed(0) + ' KB');
