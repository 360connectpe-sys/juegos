'use strict';
/*
 * Genera la versión estática para GitHub Pages (sin servidor propio) en ../naval-battle/
 *   - copia public/ y shared/constants.js
 *   - empaqueta el motor del servidor (rooms, turns, physics…) para el navegador
 *   - cambia Socket.io por Firebase (pages/net-firebase.js)
 * Uso: node scripts/build-pages.js
 */
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, '..', 'naval-battle');

function copiar(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const a = path.join(src, f), b = path.join(dst, f);
    fs.statSync(a).isDirectory() ? copiar(a, b) : fs.copyFileSync(a, b);
  }
}
fs.rmSync(DESTINO, { recursive: true, force: true });
copiar(path.join(RAIZ, 'public'), DESTINO);
fs.mkdirSync(path.join(DESTINO, 'shared'), { recursive: true });
fs.copyFileSync(path.join(RAIZ, 'shared/constants.js'), path.join(DESTINO, 'shared/constants.js'));
fs.rmSync(path.join(DESTINO, 'js/network.js'));
fs.copyFileSync(path.join(RAIZ, 'pages/net-firebase.js'), path.join(DESTINO, 'js/net-firebase.js'));

// ---- Motor del servidor como un solo archivo para el navegador ----
const modulos = {
  constants: 'shared/constants.js',
  collisions: 'server/collisions.js',
  physics: 'server/physics.js',
  gameState: 'server/gameState.js',
  turns: 'server/turns.js',
  validation: 'server/validation.js',
  rooms: 'server/rooms.js',
};
let bundle = `/* Generado por scripts/build-pages.js — NO editar a mano: edita server/*.js y vuelve a generar. */
(function (root) {
  'use strict';
  // "crypto" de Node usando la API del navegador
  const cryptoShim = {
    randomInt(n) { const a = new Uint32Array(1); let x; do { root.crypto.getRandomValues(a); x = a[0]; } while (x >= Math.floor(0x100000000 / n) * n); return x % n; },
    randomBytes(n) { const a = new Uint8Array(n); root.crypto.getRandomValues(a); return { toString() { return btoa(String.fromCharCode(...a)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); } }; },
    timingSafeEqual(a, b) { let d = a.length ^ b.length; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; },
  };
  const Buffer = { from: s => new TextEncoder().encode(String(s)) };
  const defs = {}, cache = {};
  function req(nombre) {
    if (nombre === 'crypto') return cryptoShim;
    const k = nombre.split('/').pop().replace(/\\.js$/, '');
    if (!cache[k]) { const module = { exports: {} }; cache[k] = module; defs[k](module, module.exports, req, Buffer); }
    return cache[k].exports;
  }
`;
for (const [nombre, archivo] of Object.entries(modulos)) {
  const codigo = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
  bundle += `\n  defs[${JSON.stringify(nombre)}] = function (module, exports, require, Buffer) {\n${codigo}\n  };\n`;
}
bundle += `
  root.CNB_ENGINE = { rooms: req('rooms'), validation: req('validation'), gameState: req('gameState'), physics: req('physics') };
})(window);
`;
fs.writeFileSync(path.join(DESTINO, 'js/engine-bundle.js'), bundle);

// ---- index.html: Firebase en lugar de Socket.io ----
const idx = path.join(DESTINO, 'index.html');
let html = fs.readFileSync(idx, 'utf8');
const antes = '<script src="/socket.io/socket.io.js"></script>\n<script src="/shared/constants.js"></script>';
if (!html.includes(antes)) throw new Error('No encontré los scripts de Socket.io en index.html');
html = html.replace(antes, [
  '<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>',
  '<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js"></script>',
  '<script src="shared/constants.js"></script>',
  '<script src="js/engine-bundle.js"></script>',
].join('\n'));
html = html.replace('<script src="js/network.js"></script>', '<script src="js/net-firebase.js"></script>');
fs.writeFileSync(idx, html);
console.log('Versión para GitHub Pages generada en', path.relative(process.cwd(), DESTINO));
