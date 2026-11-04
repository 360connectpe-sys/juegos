/* Interfaz: pantallas, panel de Conecti, HUD, sala de espera y avisos. */
(function (root) {
  const C = root.CNB, R = root.RENDERER;
  const $ = id => document.getElementById(id);

  function show(id) {
    for (const s of document.querySelectorAll('.pantalla')) s.hidden = s.id !== id;
    window.scrollTo(0, 0);
  }

  /** Dibuja a Conecti en un canvas pequeño (12×16) con la pose y el color dados. */
  function sprite(canvas, pose, colorKey) {
    const spr = R.conectiSprite(pose, C.COLORS[colorKey] || C.COLORS.azul, false);
    canvas.width = spr.width; canvas.height = spr.height;
    const c = canvas.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(spr, 0, 0);
    canvas.style.width = (spr.width * 4) + 'px';
  }

  // Panel de mensajes de Conecti con efecto de máquina de escribir
  const escritura = new Map();
  function conecti(panelId, texto, { reaccion = null, pose = 'idle', color = 'azul' } = {}) {
    const panel = $(panelId); if (!panel) return;
    const p = panel.querySelector('.cp-texto'), av = panel.querySelector('.cp-avatar');
    sprite(av, pose, color);
    av.style.width = '';
    if (reaccion) { av.classList.remove('salta', 'tiembla'); void av.offsetWidth; av.classList.add(reaccion); }
    if (p.dataset.full === texto) return;
    p.dataset.full = texto;
    clearInterval(escritura.get(panelId));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { p.textContent = texto; return; }
    let i = 0;
    p.textContent = '';
    const iv = setInterval(() => { i += 2; p.textContent = texto.slice(0, i); if (i >= texto.length) clearInterval(iv); }, 18);
    escritura.set(panelId, iv);
  }

  let toastT = null;
  function toast(txt) {
    const t = $('toast'); t.textContent = txt; t.classList.add('ver');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('ver'), 2200);
  }

  async function copiar(txt, ok = '¡Copiado!') {
    try { await navigator.clipboard.writeText(txt); toast(ok); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(ok); } catch (_) { toast(txt); }
      ta.remove();
    }
  }

  function muestras(id, actual, onChange) {
    const cont = $(id); cont.innerHTML = '';
    for (const k of C.COLOR_KEYS) {
      const b = document.createElement('button');
      b.className = 'muestra'; b.type = 'button'; b.style.background = C.COLORS[k];
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === actual));
      b.setAttribute('aria-label', k.charAt(0).toUpperCase() + k.slice(1));
      b.onclick = () => { cont.querySelectorAll('.muestra').forEach(x => x.setAttribute('aria-checked', String(x === b))); onChange(k); };
      cont.appendChild(b);
    }
  }

  function jugadores(st, yo) {
    const cont = $('l-jugadores'); cont.innerHTML = '';
    st.players.forEach((p, i) => {
      const d = document.createElement('div');
      if (!p || p.left) {
        d.className = 'jugador vacio';
        d.innerHTML = '<div class="n">RIVAL</div><div class="est esperando">Esperando</div>';
      } else {
        d.className = 'jugador';
        const estado = !p.connected ? 'Reconectando…' : p.ready ? '¡LISTO!' : 'Preparando…';
        d.innerHTML = `<canvas></canvas><div class="n"></div><div class="chips"><i style="background:${C.COLORS[p.conecti]}" title="Conecti"></i><i style="background:${C.COLORS[p.ship]}" title="Barco"></i></div><div class="est ${p.ready ? 'ok' : ''}">${estado}</div>`;
        d.querySelector('.n').textContent = p.name + (i === yo ? ' (TÚ)' : '');
        sprite(d.querySelector('canvas'), p.ready ? 'cheer' : 'idle', p.conecti);
        d.querySelector('canvas').style.width = '';
      }
      cont.appendChild(d);
    });
  }

  function hud(st, yo) {
    st.players.forEach((p, i) => {
      const el = $('hud-' + i); if (!p) { el.innerHTML = ''; return; }
      const hp = st.ships[i].hp, pct = Math.max(0, hp) / C.MAX_HP * 100;
      const cls = pct > 50 ? '' : pct > 25 ? 'media' : 'baja';
      const listo = st.phase === 'PLANNING' && st.locked && st.locked[i];
      el.classList.toggle('activo', st.phase === 'PLANNING' && !listo);
      const pw = (st.powers && st.powers[i]) || {};
      const poderes = [pw.escudo ? '🛡 ESCUDO' : '', pw.doble ? '✖2 DOBLE' : ''].filter(Boolean).join(' · ');
      el.innerHTML = `<div class="nom"><i style="background:${C.COLORS[p.ship]}"></i><span></span></div><div class="vida"><b class="${cls}" style="width:${pct}%"></b></div><div class="hp">${hp}/${C.MAX_HP} HP${p.connected ? '' : ' · ⚠'}${listo ? ' · ✓ LISTO' : ''}</div><div class="poderes">${poderes}</div>`;
      el.querySelector('span').textContent = (i === yo ? 'TÚ: ' : '') + p.name;
    });
  }

  root.UI = { $, show, sprite, conecti, toast, copiar, muestras, jugadores, hud };
})(window);
