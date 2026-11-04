/*
 * Controles: teclado en computadora y botones táctiles en el celular.
 *   Movimiento: A / ← mueve el barco a la izquierda, D / → a la derecha, Espacio confirma.
 *   Ataque: ↑/↓ (W/S) ángulo, ←/→ (A/D) potencia, 1 TikTok, 2 Instagram, Espacio dispara.
 * Las flechas siguen la pantalla: así nunca se confunde quien juega del lado derecho.
 */
(function (root) {
  function create(h) {
    // h: { phase(): 'move'|'aim'|null, step(dir), confirm(), angle(d), power(d), projectile(t), fire() }
    const presionadas = new Set();
    let bucle = null;

    function tick() {
      const f = h.phase();
      let mover = 0;
      if (presionadas.has('left')) mover -= 1;
      if (presionadas.has('right')) mover += 1;
      if (f === 'move' && mover) h.step(mover);
      if (f === 'aim') {
        if (presionadas.has('up')) h.angle(+1);
        if (presionadas.has('down')) h.angle(-1);
        if (presionadas.has('left')) h.power(-1);
        if (presionadas.has('right')) h.power(+1);
      }
    }
    function arrancar() { if (!bucle) { tick(); bucle = setInterval(tick, 60); } }
    function parar() { if (!presionadas.size && bucle) { clearInterval(bucle); bucle = null; } }
    const press = k => { presionadas.add(k); arrancar(); };
    const release = k => { presionadas.delete(k); parar(); };

    const TECLAS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
    addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range') return;
      const f = h.phase(); if (!f) return;
      const k = TECLAS[e.code];
      if (k) { e.preventDefault(); if (!e.repeat) press(k); return; }
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) (f === 'move' ? h.confirm() : h.fire()); }
      if (f === 'aim' && e.code === 'Digit1') h.projectile('tiktok');
      if (f === 'aim' && e.code === 'Digit2') h.projectile('instagram');
    });
    addEventListener('keyup', e => { const k = TECLAS[e.code]; if (k) release(k); });
    addEventListener('blur', () => { presionadas.clear(); parar(); });

    /** Botón que repite mientras se mantiene presionado (mouse o dedo). */
    function mantener(el, accion) {
      if (!el) return;
      let iv = null;
      const on = e => { e.preventDefault(); root.AUDIO.unlock(); el.classList.add('on'); accion(); clearInterval(iv); iv = setInterval(accion, 60); try { el.setPointerCapture(e.pointerId); } catch (_) {} };
      const off = () => { el.classList.remove('on'); clearInterval(iv); iv = null; };
      el.addEventListener('pointerdown', on);
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => el.addEventListener(ev, off));
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); accion(); } });
    }
    return { mantener };
  }
  root.CONTROLS = { create };
})(window);
