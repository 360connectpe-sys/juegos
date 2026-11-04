/*
 * Renderizador Canvas en resolución lógica 480 × 270 (se escala con imageSmoothingEnabled = false).
 * Solo dibuja: todo lo que pasa en la partida lo decide el servidor.
 */
(function (root) {
  const C = root.CNB, S = root.SPRITES;
  const W = C.WIDTH, H = C.HEIGHT, HORIZONTE = 148;
  // Press Start 2P no dibuja bien las mayúsculas con tilde: en esos textos se usa VT323 (también pixelada)
  const TILDE = /[ÁÉÍÓÚÑÜ]/;
  const fuente = (txt, tam) => (TILDE.test(txt) ? `${Math.round(tam * 2)}px "VT323", monospace` : `${tam}px "Press Start 2P", monospace`);

  // ---------- utilidades de color ----------
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgb = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  function tono(h, k) { // k < 0 oscurece, k > 0 aclara
    const [r, g, b] = hex(h);
    return k < 0 ? rgb(r * (1 + k), g * (1 + k), b * (1 + k)) : rgb(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k);
  }

  // ---------- sprites pre-renderizados ----------
  const cache = new Map();
  function spriteCanvas(mapa, paleta) {
    const w = Math.max(...mapa.map(f => f.length)), h = mapa.length;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    mapa.forEach((fila, y) => [...fila].forEach((ch, x) => {
      if (ch === '.') return;
      const col = typeof paleta === 'function' ? paleta(ch, x, y) : paleta[ch];
      if (col) { c.fillStyle = col; c.fillRect(x, y, 1, 1); }
    }));
    return cv;
  }
  function conectiSprite(pose, color, voltear) {
    const k = pose + color + (voltear ? 'v' : '');
    if (!cache.has(k)) {
      const pal = { B: color, D: tono(color, -0.35), W: '#F2F7FF', K: '#0F1B3D', P: '#F7A1B0', Q: '#FFFFFF', H: '#FFFFFF', L: '#1B1B1B' };
      let mapa = S.CONECTI[pose];
      if (voltear) { const w = Math.max(...mapa.map(f => f.length)); mapa = mapa.map(f => f.padEnd(w, '.').split('').reverse().join('')); }
      cache.set(k, spriteCanvas(mapa, pal));
    }
    return cache.get(k);
  }
  function iconoSprite(tipo) {
    const k = 'ico-' + tipo;
    if (!cache.has(k)) cache.set(k, spriteCanvas(S.ICONOS[tipo].mapa, S.ICONOS[tipo].paleta));
    return cache.get(k);
  }
  function banderaSprite(color) {
    const k = 'flag-' + color;
    if (!cache.has(k)) cache.set(k, spriteCanvas(S.BANDERA, { W: '#FFFFFF', C: color, B: '#0F1B3D' }));
    return cache.get(k);
  }

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    ctx.imageSmoothingEnabled = false;

    // ---------- efectos ----------
    const parts = [];        // partículas cuadradas
    const textos = [];       // números flotantes
    let banner = null, shake = 0, flash = 0;
    const proyectiles = [];  // { path, flightMs, t0, tipo, onEnd } — pueden volar dos a la vez
    const capitan = [{ pose: null, hasta: 0 }, { pose: null, hasta: 0 }];
    const golpeBarco = [0, 0];
    const nubes = Array.from({ length: 6 }, (_, i) => ({ x: i * 90 + Math.random() * 40, y: 18 + (i % 3) * 22 + Math.random() * 8, v: 3 + Math.random() * 4, w: 26 + Math.random() * 22 }));
    const gaviotas = Array.from({ length: 3 }, (_, i) => ({ x: Math.random() * W, y: 40 + i * 18, v: 10 + i * 4, f: Math.random() * 6 }));

    function particula(x, y, vx, vy, vida, color, size = 2, g = 140) {
      parts.push({ x, y, vx, vy, vida, max: vida, color, size, g });
      if (parts.length > 500) parts.splice(0, parts.length - 500);
    }

    const api = {
      explosion(x, y, fuerte = true) {
        const cols = ['#FFF3B0', '#FFD84A', '#FF9A2E', '#FF4D2E', '#B23A1E', '#555A66'];
        const n = fuerte ? 46 : 26;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, v = 20 + Math.random() * (fuerte ? 110 : 70);
          particula(x, y, Math.cos(a) * v, Math.sin(a) * v - 30, 0.5 + Math.random() * 0.7, cols[(Math.random() * cols.length) | 0], Math.random() < 0.3 ? 3 : 2);
        }
        for (let i = 0; i < 10; i++) particula(x + (Math.random() - 0.5) * 10, y, (Math.random() - 0.5) * 20, -20 - Math.random() * 25, 1.4, '#6B7080', 3, -10);
        shake = fuerte ? 7 : 4; flash = fuerte ? 0.25 : 0.12;
      },
      salpicadura(x) {
        for (let i = 0; i < 28; i++) {
          const v = 40 + Math.random() * 90, a = -Math.PI / 2 + (Math.random() - 0.5) * 1.1;
          particula(x, C.SEA_Y, Math.cos(a) * v, Math.sin(a) * v, 0.6 + Math.random() * 0.5, Math.random() < 0.5 ? '#FFFFFF' : '#9BD8FF', 2, 220);
        }
        anillos.push({ x, t: 0 });
        shake = 2;
      },
      texto(txt, x, y, color = '#FFD84A') { textos.push({ txt, x, y, t: 0, color }); },
      banner(txt, color = '#FFD84A', ms = 1500) { banner = { txt, color, t: 0, ms }; },
      disparo({ path, flightMs, projectile, shooter }, onEnd) {
        proyectiles.push({ path, flightMs, t0: performance.now(), tipo: projectile, onEnd, shooter, rot: 0 });
        const p0 = path[0];
        for (let i = 0; i < 12; i++) particula(p0[0], p0[1], C.FACING[shooter] * (20 + Math.random() * 40), -10 - Math.random() * 30, 0.4, i % 2 ? '#FFFFFF' : '#C8CCD6', 3, -20);
        golpeBarco[shooter] = -0.2;
      },
      terminarDisparo() { for (const p of proyectiles.splice(0)) p.onEnd && p.onEnd(); },
      pose(slot, pose, ms = 1200) { capitan[slot] = { pose, hasta: performance.now() + ms }; },
      golpe(slot) { golpeBarco[slot] = 0.5; },
      reset() { parts.length = 0; textos.length = 0; banner = null; proyectiles.length = 0; anillos.length = 0; capitan[0] = { pose: null, hasta: 0 }; capitan[1] = { pose: null, hasta: 0 }; },
      draw,
    };
    const anillos = [];

    // ---------- escenario ----------
    function cielo(t, noche) {
      const bandas = noche
        ? ['#0B1636', '#101E47', '#152858', '#1B3369', '#223E7A']
        : ['#3D8BE0', '#4F9BEA', '#63ACF2', '#7CBDF7', '#9ACFFB', '#B9E0FF'];
      const alto = Math.ceil(HORIZONTE / bandas.length);
      bandas.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * alto, W, alto + 1); });
      // Tramado entre bandas (detalle 8 bits)
      for (let i = 1; i < bandas.length; i++) {
        ctx.fillStyle = bandas[i];
        for (let x = (i % 2) * 2; x < W; x += 4) ctx.fillRect(x, i * alto - 2, 2, 2);
      }
      // Sol con rayos que laten
      const sx = 396, sy = 40, r = 14;
      ctx.fillStyle = '#FFE680';
      const p = (Math.sin(t * 2) + 1) * 1.5;
      for (let a = 0; a < 8; a++) {
        const an = a * Math.PI / 4 + t * 0.2;
        ctx.fillRect(Math.round(sx + Math.cos(an) * (r + 5 + p)) - 1, Math.round(sy + Math.sin(an) * (r + 5 + p)) - 1, 3, 3);
      }
      for (let y = -r; y <= r; y++) {
        const w = Math.round(Math.sqrt(r * r - y * y));
        ctx.fillStyle = y < -r / 3 ? '#FFF6C2' : '#FFD84A';
        ctx.fillRect(sx - w, sy + y, w * 2, 1);
      }
    }
    function nubesYAves(t, dt) {
      for (const n of nubes) {
        n.x += n.v * dt; if (n.x > W + 40) n.x = -n.w - 20;
        const x = Math.round(n.x), y = Math.round(n.y), w = Math.round(n.w);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(x + 6, y, w - 12, 4); ctx.fillRect(x, y + 4, w, 6); ctx.fillRect(x + w * 0.3, y - 4, w * 0.35, 5);
        ctx.fillStyle = '#D6ECFF'; ctx.fillRect(x + 2, y + 9, w - 4, 2);
      }
      ctx.fillStyle = '#F4F8FF';
      for (const g of gaviotas) {
        g.x += g.v * dt; if (g.x > W + 10) { g.x = -10; g.y = 30 + Math.random() * 60; }
        const ala = Math.sin(t * 8 + g.f) > 0 ? 1 : 0, x = Math.round(g.x), y = Math.round(g.y);
        ctx.fillRect(x - 3, y - ala, 2, 1); ctx.fillRect(x - 1, y + 1 - ala * 0, 2, 1); ctx.fillRect(x + 1, y - ala, 2, 1);
      }
    }
    function costa() {
      // Cerros de la costa de Trujillo y el muelle de Huanchaco al fondo
      ctx.fillStyle = '#7FA6C9';
      const cerros = [[0, 132, 70], [60, 138, 60], [110, 128, 90], [190, 140, 60]];
      for (const [x, y, w] of cerros) for (let i = 0; i < w; i++) {
        const h = Math.round(Math.sin((i / w) * Math.PI) * (HORIZONTE - y));
        ctx.fillRect(x + i, HORIZONTE - h, 1, h);
      }
      ctx.fillStyle = '#5F84A8';
      ctx.fillRect(250, HORIZONTE - 6, 120, 2);
      for (let x = 254; x < 370; x += 8) ctx.fillRect(x, HORIZONTE - 4, 1, 5);
      // Caballitos de totora
      for (const x of [300, 334]) {
        ctx.fillStyle = '#C79A4B'; ctx.fillRect(x, HORIZONTE - 3, 10, 2); ctx.fillRect(x + 8, HORIZONTE - 5, 3, 2);
        ctx.fillStyle = '#5A3A1C'; ctx.fillRect(x + 4, HORIZONTE - 7, 1, 4);
      }
    }
    function marFondo(t) {
      const bandas = ['#2D7FD3', '#2772C4', '#2167B6', '#1C5DA8'];
      const alto = Math.ceil((C.SEA_Y - HORIZONTE) / bandas.length);
      bandas.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, HORIZONTE + i * alto, W, alto + 1); });
      ctx.fillStyle = '#7EC3FF';
      for (let i = 0; i < 26; i++) {
        const y = HORIZONTE + 4 + ((i * 13) % (C.SEA_Y - HORIZONTE - 8));
        const x = ((i * 97 + t * (8 + (i % 4) * 4)) % (W + 20)) - 10;
        ctx.fillRect(Math.round(x), y, 4 + (i % 3) * 2, 1);
      }
    }
    function marFrente(t) {
      const base = C.SEA_Y;
      ctx.fillStyle = '#1A4F96'; ctx.fillRect(0, base + 2, W, H - base);
      ctx.fillStyle = '#16447F'; ctx.fillRect(0, base + 22, W, H - base);
      ctx.fillStyle = '#123A6D'; ctx.fillRect(0, base + 42, W, H - base);
      // Cresta animada (pixeles de 2×2)
      for (let x = 0; x < W; x += 2) {
        const y = base + Math.round(Math.sin(x * 0.07 + t * 2.2) * 1.6 + Math.sin(x * 0.023 - t * 1.3));
        ctx.fillStyle = '#2B86E0'; ctx.fillRect(x, y, 2, base + 4 - y);
        ctx.fillStyle = (x + Math.floor(t * 12) * 2) % 16 < 4 ? '#E9F6FF' : '#8FD0FF';
        ctx.fillRect(x, y - 1, 2, 1);
      }
      // Brillos
      ctx.fillStyle = '#4C9BEA';
      for (let i = 0; i < 18; i++) {
        const y = base + 8 + ((i * 11) % 54);
        const x = ((i * 131 - t * (14 + (i % 3) * 6)) % (W + 30) + W + 30) % (W + 30) - 15;
        ctx.fillRect(Math.round(x), y, 6, 1);
      }
      // Anillos de salpicadura
      for (let i = anillos.length - 1; i >= 0; i--) {
        const a = anillos[i]; a.t += 1 / 60;
        if (a.t > 0.8) { anillos.splice(i, 1); continue; }
        const r = Math.round(4 + a.t * 26);
        ctx.fillStyle = 'rgba(233,246,255,' + (1 - a.t / 0.8).toFixed(2) + ')';
        ctx.fillRect(Math.round(a.x - r), base + 1, r * 2, 1);
        ctx.fillRect(Math.round(a.x - r / 2), base + 3, r, 1);
      }
    }

    // ---------- barco ----------
    function barco(slot, s, m, t) {
      const f = C.FACING[slot];
      const hund = (m.sinking === slot || m.sinking === 'ambos') ? Math.min(1, m.sinkT / 3.5) : 0;
      const bob = Math.round(Math.sin(t * 2 + slot * 1.7) * 1 + golpeBarco[slot] * 4 * Math.sin(t * 40));
      const cx = Math.round(s.x), dy = bob + Math.round(hund * 40);
      const col = m.colores[slot].ship, osc = tono(col, -0.35), clr = tono(col, 0.35);
      ctx.save();
      if (hund) { ctx.translate(cx, C.HULL_TOP + dy); ctx.rotate(-f * hund * 0.5); ctx.translate(-cx, -(C.HULL_TOP + dy)); }

      // Mástil y bandera de 360
      const mx = cx - f * 22;
      ctx.fillStyle = '#5A3A1C'; ctx.fillRect(mx, 154 + dy, 2, 30);
      const flag = banderaSprite(col);
      const ondea = Math.floor(t * 4) % 2;
      ctx.save(); if (f < 0) { ctx.translate(mx * 2 + 2, 0); ctx.scale(-1, 1); }
      ctx.drawImage(flag, mx + 2, 155 + dy + ondea);
      ctx.restore();
      // Cabina en la popa
      const cabX = f > 0 ? cx - 30 : cx + 14;
      ctx.fillStyle = '#E9F1FF'; ctx.fillRect(cabX, 184 + dy, 16, 10);
      ctx.fillStyle = osc; ctx.fillRect(cabX - 1, 182 + dy, 18, 3);
      ctx.fillStyle = '#5DB8FF'; ctx.fillRect(cabX + 3, 187 + dy, 4, 3); ctx.fillRect(cabX + 9, 187 + dy, 4, 3);
      // Casco (fila por fila: proa en punta, popa recta)
      for (let r = 0; r < C.HULL_BOTTOM - C.HULL_TOP + 2; r++) {
        const proa = Math.floor(r * 1.1), popa = Math.floor(r * 0.35);
        const izq = cx - C.HULL_W / 2 + (f > 0 ? popa : proa);
        const der = cx + C.HULL_W / 2 - (f > 0 ? proa : popa);
        ctx.fillStyle = r < 2 ? clr : r === 5 || r === 6 ? '#FFFFFF' : r > 10 ? osc : col;
        ctx.fillRect(izq, C.HULL_TOP + r + dy, der - izq, 1);
      }
      // Ojos de buey
      ctx.fillStyle = '#0F1B3D';
      for (let i = -2; i <= 1; i++) ctx.fillRect(cx + i * 11 + 2, C.HULL_TOP + 8 + dy, 3, 3);
      ctx.fillStyle = '#9FDCFF';
      for (let i = -2; i <= 1; i++) ctx.fillRect(cx + i * 11 + 2, C.HULL_TOP + 8 + dy, 1, 1);
      // Cañón: base + caño girado por el ángulo (línea gruesa pixelada)
      const px = cx + f * C.CANNON_PIVOT_DX, py = C.CANNON_PIVOT_Y + dy;
      const ang = ((m.aim[slot] && m.aim[slot].angle) || 45) * Math.PI / 180;
      const retro = golpeBarco[slot] < 0 ? -golpeBarco[slot] * 10 : 0;
      ctx.fillStyle = '#3A4152';
      const largo = C.CANNON_LEN - retro;
      for (let i = 0; i <= largo; i += 0.5) {
        const x = Math.round(px + f * Math.cos(ang) * i), y = Math.round(py - Math.sin(ang) * i);
        ctx.fillRect(x - 1, y - 1, 3, 3);
      }
      ctx.fillStyle = '#7C8599';
      const bx = Math.round(px + f * Math.cos(ang) * largo), by = Math.round(py - Math.sin(ang) * largo);
      ctx.fillRect(bx - 2, by - 2, 4, 4);
      ctx.fillStyle = '#262B38'; ctx.fillRect(px - 4, py + 1, 9, 7);
      ctx.fillStyle = '#4A5266'; ctx.fillRect(px - 3, py + 2, 7, 2);
      // Conecti capitán
      const ahora = performance.now();
      let pose = m.poseBase[slot] || ((Math.floor(t * 2 + slot) % 2) ? 'idle' : 'idle2');
      if (capitan[slot].pose && ahora < capitan[slot].hasta) pose = capitan[slot].pose;
      const salto = pose === 'cheer' ? -Math.abs(Math.round(Math.sin(t * 10) * 3)) : 0;
      const tiembla = pose === 'hit' ? Math.round(Math.sin(t * 50)) : 0;
      const spr = conectiSprite(pose, m.colores[slot].conecti, f < 0);
      const cxC = cx - f * 4;
      ctx.drawImage(spr, cxC - 6 + tiembla - (f < 0 && spr.width > 12 ? spr.width - 12 : 0), C.HULL_TOP - 16 + dy + salto);
      if (m.winner === slot) { // Conecti levanta la bandera
        ctx.fillStyle = '#5A3A1C'; ctx.fillRect(cxC + f * 7, 160 + dy + salto, 1, 18);
        ctx.drawImage(banderaSprite(m.colores[slot].conecti), cxC + f * 7 + (f > 0 ? 1 : -9), 160 + dy + salto + (Math.floor(t * 6) % 2));
      }
      // Daño visible: humo y fuego en cubierta
      if (s.hp < 60 && Math.random() < (s.hp < 30 ? 0.5 : 0.2)) particula(cabX + 8, 182 + dy, (Math.random() - 0.5) * 6, -12 - Math.random() * 8, 1.4, s.hp < 30 ? '#444A55' : '#8A90A0', 2, -6);
      if (s.hp < 30 && s.hp > 0 && Math.random() < 0.6) particula(cx + f * 18 + (Math.random() - 0.5) * 8, C.HULL_TOP + dy, 0, -20 - Math.random() * 20, 0.35, Math.random() < 0.5 ? '#FF9A2E' : '#FFD84A', 2, -40);
      if (hund > 0 && hund < 1 && Math.random() < 0.6) particula(cx + (Math.random() - 0.5) * 50, C.SEA_Y, 0, -15 - Math.random() * 15, 0.8, '#CFEAFF', 2, -10);
      ctx.restore();
    }

    function barraVida(slot, s, m) {
      if ((m.sinking === slot || m.sinking === 'ambos') && m.sinkT > 1) return;
      const cx = Math.round(s.x), y = 140, w = 48;
      const v = Math.max(0, s.hp) / C.MAX_HP;
      ctx.fillStyle = '#0F1B3D'; ctx.fillRect(cx - w / 2 - 2, y - 2, w + 4, 8);
      ctx.fillStyle = '#3A1020'; ctx.fillRect(cx - w / 2, y, w, 4);
      ctx.fillStyle = v > 0.5 ? '#3BD16F' : v > 0.25 ? '#FFC928' : '#FF4D5E';
      ctx.fillRect(cx - w / 2, y, Math.round(w * v), 4);
      ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(cx - w / 2, y, Math.round(w * v), 1);
      const decide = m.enJuego && m.decidiendo && m.decidiendo[slot];
      texto8(m.nombres[slot], cx, y - 12, decide ? '#FFD84A' : '#FFFFFF', 'center');
      if (m.enJuego && m.listos && m.listos[slot]) texto8('LISTO', cx, y - 24, '#3BD16F', 'center');
      else if (decide) { // flecha que rebota: todavía está decidiendo
        const b = Math.round(Math.abs(Math.sin(performance.now() / 200)) * 3);
        ctx.fillStyle = '#FFD84A';
        ctx.fillRect(cx - 3, y - 24 - b, 7, 2); ctx.fillRect(cx - 2, y - 22 - b, 5, 2); ctx.fillRect(cx - 1, y - 20 - b, 3, 2);
      }
    }

    function texto8(txt, x, y, color, alin = 'left', tam = 8) {
      ctx.font = fuente(txt, tam); ctx.textAlign = alin; ctx.textBaseline = 'top';
      if (TILDE.test(txt)) y -= Math.round(tam * 0.35);
      ctx.fillStyle = '#0F1B3D';
      ctx.fillText(txt, x + 1, y + 1); ctx.fillText(txt, x - 1, y + 1); ctx.fillText(txt, x, y + 2);
      ctx.fillStyle = color; ctx.fillText(txt, x, y);
    }

    function guias(m, t) {
      // Zona de movimiento: boyas y rango alcanzable
      if (m.moveHint) {
        const { slot, min, max, x, left } = m.moveHint;
        for (const bx of [min - C.HULL_W / 2, max + C.HULL_W / 2]) {
          const by = C.SEA_Y - 6 + Math.round(Math.sin(t * 3 + bx) * 1);
          ctx.fillStyle = '#FFFFFF'; ctx.fillRect(Math.round(bx) - 2, by, 5, 3);
          ctx.fillStyle = '#FF4D5E'; ctx.fillRect(Math.round(bx) - 2, by + 3, 5, 3); ctx.fillRect(Math.round(bx), by - 3, 1, 3);
        }
        const a = Math.max(min, x - left), b = Math.min(max, x + left);
        ctx.fillStyle = '#FFD84A';
        for (let i = Math.round(a); i <= b; i += 4) ctx.fillRect(i, C.SEA_Y + 6, 2, 2);
        ctx.fillRect(Math.round(a), C.SEA_Y + 4, 1, 5); ctx.fillRect(Math.round(b), C.SEA_Y + 4, 1, 5);
      }
      // Guía de puntería (solo la dirección inicial, sin revelar la trayectoria)
      if (m.aimGuide !== null && m.aimGuide !== undefined) {
        const slot = m.aimGuide, s = m.ships[slot], f = C.FACING[slot], a = m.aim[slot];
        const ang = a.angle * Math.PI / 180;
        const px = s.x + f * C.CANNON_PIVOT_DX, py = C.CANNON_PIVOT_Y;
        const paso = 4 + a.power / 12;
        for (let i = 1; i <= 6; i++) {
          const d = C.CANNON_LEN + i * paso;
          const on = (Math.floor(t * 8) + i) % 6 !== 0;
          if (!on) continue;
          ctx.fillStyle = i < 3 ? '#FFFFFF' : '#FFD84A';
          ctx.fillRect(Math.round(px + f * Math.cos(ang) * d) - 1, Math.round(py - Math.sin(ang) * d) - 1, 2, 2);
        }
      }
    }

    function dibujarProyectil(ahora) {
      for (const p of proyectiles.slice()) {
        const k = Math.min(1, (ahora - p.t0) / p.flightMs);
        const idx = k * (p.path.length - 1), i = Math.floor(idx), fr = idx - i;
        const a = p.path[i], b = p.path[Math.min(i + 1, p.path.length - 1)];
        const x = a[0] + (b[0] - a[0]) * fr, y = a[1] + (b[1] - a[1]) * fr;
        p.rot += 0.25 * C.FACING[p.shooter];
        // Estela
        const est = S.ICONOS[p.tipo].estela;
        for (let j = 0; j < 2; j++) particula(x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, 0.45, est[(Math.random() * est.length) | 0], p.tipo === 'tiktok' ? 2 : 1 + (Math.random() < 0.5), 0);
        const ico = iconoSprite(p.tipo);
        ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(Math.round(p.rot / (Math.PI / 8)) * (Math.PI / 8));
        ctx.drawImage(ico, -6, -6); ctx.restore();
        if (k >= 1) { proyectiles.splice(proyectiles.indexOf(p), 1); p.onEnd && p.onEnd(); }
      }
    }

    function efectos(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.vida -= dt; if (q.vida <= 0) { parts.splice(i, 1); continue; }
        q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt;
        ctx.globalAlpha = Math.min(1, q.vida / q.max * 1.5);
        ctx.fillStyle = q.color; ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size);
      }
      ctx.globalAlpha = 1;
      for (let i = textos.length - 1; i >= 0; i--) {
        const q = textos[i]; q.t += dt;
        if (q.t > 1.4) { textos.splice(i, 1); continue; }
        texto8(q.txt, Math.round(q.x), Math.round(q.y - q.t * 22), Math.floor(q.t * 10) % 2 && q.t < 0.4 ? '#FFFFFF' : q.color, 'center');
      }
    }

    function cartel(dt) {
      if (!banner) return;
      banner.t += dt * 1000;
      if (banner.t > banner.ms) { banner = null; return; }
      const k = Math.min(1, banner.t / 150), tam = 16;
      ctx.font = fuente(banner.txt, tam);
      const w = Math.min(W - 8, ctx.measureText(banner.txt).width + 24);
      const y = 70;
      ctx.fillStyle = 'rgba(15,27,61,.82)'; ctx.fillRect(Math.round(W / 2 - w / 2 * k), y - 8, Math.round(w * k), 34);
      ctx.fillStyle = banner.color; ctx.fillRect(Math.round(W / 2 - w / 2 * k), y - 8, Math.round(w * k), 2); ctx.fillRect(Math.round(W / 2 - w / 2 * k), y + 24, Math.round(w * k), 2);
      if (k >= 1) {
        let tamF = tam;
        while (tamF > 8 && (ctx.font = fuente(banner.txt, tamF), ctx.measureText(banner.txt).width > W - 24)) tamF -= 2;
        texto8(banner.txt, W / 2, y + (16 - tamF) / 2, banner.color, 'center', tamF);
      }
    }

    let ultimo = performance.now();
    /** Dibuja un cuadro. m = modelo de la vista (lo arma main.js). */
    function draw(m) {
      const ahora = performance.now();
      const dt = Math.min(0.05, (ahora - ultimo) / 1000); ultimo = ahora;
      const t = ahora / 1000;
      golpeBarco[0] *= 0.9; golpeBarco[1] *= 0.9;
      if (m.sinking !== null && m.sinking !== undefined) m.sinkT = (m.sinkT || 0) + dt;
      ctx.save();
      if (shake > 0.2) { ctx.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake)); shake *= 0.86; }
      cielo(t, false); nubesYAves(t, dt); costa(); marFondo(t);
      for (const slot of [0, 1]) barco(slot, m.ships[slot], m, t);
      marFrente(t);
      guias(m, t);
      dibujarProyectil(ahora);
      efectos(dt);
      if (m.mostrarBarras) for (const slot of [0, 1]) barraVida(slot, m.ships[slot], m);
      cartel(dt);
      ctx.restore();
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash.toFixed(2)})`; ctx.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt); }
    }
    return api;
  }

  root.RENDERER = { create, conectiSprite, iconoSprite, tono };
})(window);
