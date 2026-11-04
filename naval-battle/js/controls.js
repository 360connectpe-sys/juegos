/*
 * Controles: teclado en computadora y botones táctiles en el celular.
 * Fase de plan (todo a la vez y en secreto):
 *   A / D mueven el barco · ↑ / ↓ ángulo · ← / → potencia · 1 TikTok · 2 Instagram · Espacio dispara.
 */
(function (root) {
  function create(h) {
    // h: { phase(): 'plan'|null, step(dir), angle(d), power(d), projectile(t), fire() }
    const presionadas = new Set();
    let bucle = null;

    function tick() {
      if (h.phase() !== 'plan') return;
      if (presionadas.has('a')) h.step(-1);
      if (presionadas.has('d')) h.step(+1);
      if (presionadas.has('up')) h.angle(+1);
      if (presionadas.has('down')) h.angle(-1);
      if (presionadas.has('left')) h.power(-1);
      if (presionadas.has('right')) h.power(+1);
    }
    function arrancar() { if (!bucle) { tick(); bucle = setInterval(tick, 60); } }
    function parar() { if (!presionadas.size && bucle) { clearInterval(bucle); bucle = null; } }
    const press = k => { presionadas.add(k); arrancar(); };
    const release = k => { presionadas.delete(k); parar(); };

    const TECLAS = { KeyA: 'a', KeyD: 'd', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range') return;
      if (h.phase() !== 'plan') return;
      const k = TECLAS[e.code];
      if (k) { e.preventDefault(); if (!e.repeat) press(k); return; }
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) h.fire(); }
      if (e.code === 'Digit1') h.projectile('tiktok');
      if (e.code === 'Digit2') h.projectile('instagram');
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
