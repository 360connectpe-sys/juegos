/*
 * CONECTI NAVAL BATTLE — cliente.
 * El navegador solo muestra lo que decide el servidor (o el anfitrión, en la versión sin servidor):
 *   'state'      estado público (nunca incluye los planes secretos del rival)
 *   'reveal'     movimientos + disparos ya calculados: primero se deslizan los barcos, luego vuelan las bombas
 *   'resolution' daño final (con poderes) y la Caja 360
 */
(function () {
  const C = window.CNB, UI = window.UI, NET = window.NET, A = window.AUDIO, X = window.CNB_EXTRAS, $ = UI.$;

  // Dirección base del juego (sirve en la raíz de un servidor o dentro de una carpeta, como en GitHub Pages)
  const BASE = location.pathname.replace(/index\.html$/, '');
  const params = new URLSearchParams(location.search);

  // ---------------- Perfil del jugador ----------------
  const PERFIL_KEY = 'cnb-perfil';
  const azar = () => C.COLOR_KEYS[Math.floor(Math.random() * C.COLOR_KEYS.length)];
  const perfil = (() => { try { return { name: '', conecti: azar(), ship: azar(), negocio: '', premio: '', ...JSON.parse(localStorage.getItem(PERFIL_KEY)) }; } catch (e) { return { name: '', conecti: azar(), ship: azar(), negocio: '', premio: '' }; } })();
  if (!C.COLORS[perfil.conecti]) perfil.conecti = 'azul';
  if (!C.COLORS[perfil.ship]) perfil.ship = 'morado';
  const guardarPerfil = () => { try { localStorage.setItem(PERFIL_KEY, JSON.stringify(perfil)); } catch (e) {} };

  // ---------------- Estado del cliente ----------------
  let st = null, yo = null, codigo = null, offset = 0;
  let aimLocal = { angle: 45, power: 60, projectile: 'tiktok' };
  let planDx = 0, enviando = false, ultimaClave = '', ultimoTick = -1, rivalListoAviso = '';
  let revelando = null;        // { hasta, vel } mientras los barcos se deslizan
  let torneoActual = null;     // torneo abierto en pantalla
  const ahoraServidor = () => Date.now() + offset;
  const rival = () => (yo === null ? 1 : 1 - yo);
  const nombre = i => (st && st.players[i] && st.players[i].name) || 'Rival';
  const miColor = () => (st && yo !== null && st.players[yo] ? st.players[yo].conecti : perfil.conecti);
  const meta = () => (st && st.meta) || {};

  // ---------------- Renderizadores ----------------
  const rJuego = window.RENDERER.create($('c-juego'));
  const rPortada = window.RENDERER.create($('c-portada'));
  const modelo = {
    ships: [{ x: C.START_X[0], hp: 100 }, { x: C.START_X[1], hp: 100 }],
    colores: [{ ship: C.COLORS.azul, conecti: C.COLORS.azul }, { ship: C.COLORS.morado, conecti: C.COLORS.verde }],
    nombres: ['', ''], aim: [{ angle: 45, power: 60 }, { angle: 45, power: 60 }],
    turn: -1, enJuego: false, mostrarBarras: true, moveHint: null, aimGuide: null, poseBase: [null, null],
    winner: null, sinking: null, sinkT: 0, wind: null, rocks: [], crate: null, negocio: '',
  };

  // ---------------- Portada: vista previa animada con tus colores ----------------
  const demo = {
    ships: [{ x: 110, hp: 100 }, { x: 370, hp: 100 }], colores: [{}, {}], nombres: ['TÚ', 'RIVAL'],
    aim: [{ angle: 45, power: 60 }, { angle: 45, power: 60 }], turn: -1, enJuego: false, mostrarBarras: true,
    moveHint: null, aimGuide: null, poseBase: [null, null], winner: null, sinking: null, sinkT: 0,
    wind: 8, rocks: [{ x: 240, w: 14, h: 22 }], crate: { x: 250, y: 95 }, negocio: '',
  };
  let demoProximo = performance.now() + 2500, demoTurno = 0;
  function colorearDemo() {
    const otros = C.COLOR_KEYS.filter(k => k !== perfil.ship);
    demo.colores[0] = { ship: C.COLORS[perfil.ship], conecti: C.COLORS[perfil.conecti] };
    demo.colores[1] = { ship: C.COLORS[otros[0]], conecti: C.COLORS[otros[1] || 'verde'] };
    demo.nombres[0] = (perfil.name || 'TÚ').slice(0, 10);
    demo.negocio = perfil.negocio || '';
  }
  function disparoDemo() {
    const s = demoTurno, o = 1 - s, f = C.FACING[s];
    const ang = 50 + Math.random() * 15, g = C.GRAVITY;
    const objetivo = demo.ships[o].x + (Math.random() - 0.5) * 70;
    const px = demo.ships[s].x + f * C.CANNON_PIVOT_DX, a = ang * Math.PI / 180;
    const x0 = px + f * Math.cos(a) * C.CANNON_LEN, y0 = C.CANNON_PIVOT_Y - Math.sin(a) * C.CANNON_LEN;
    const v = Math.sqrt(Math.abs(objetivo - x0) * g / Math.sin(2 * a));
    const path = [];
    let impacto = { type: 'water' };
    for (let t = 0; t < 8; t += 2 / 60) {
      const x = x0 + f * v * Math.cos(a) * t, y = y0 - v * Math.sin(a) * t + 0.5 * g * t * t;
      path.push([x, y]);
      if (t > 0.2 && Math.abs(x - demo.ships[o].x) < C.HULL_W / 2 && y >= C.HULL_TOP) { impacto = { type: 'hull', x, y }; break; }
      if (y >= C.SEA_Y) { impacto = { type: 'water', x, y: C.SEA_Y }; break; }
    }
    demo.aim[s] = { angle: ang, power: 60 };
    rPortada.pose(s, 'cheer', 900);
    rPortada.disparo({ shooter: s, projectile: Math.random() < 0.5 ? 'tiktok' : 'instagram', trayectorias: [{ path, startMs: 0, durMs: path.length * 33, impact: impacto }] }, 0, () => {
      if (impacto.type === 'hull') { rPortada.explosion(impacto.x, impacto.y); rPortada.pose(o, 'hit', 1000); rPortada.golpe(o); }
      else rPortada.salpicadura(impacto.x);
    });
    demoTurno = o;
  }

  // ---------------- Pantalla de inicio ----------------
  $('i-nombre').value = perfil.name;
  $('i-nombre').addEventListener('input', e => { perfil.name = e.target.value.slice(0, C.NAME_MAX); guardarPerfil(); colorearDemo(); });
  $('i-negocio').value = perfil.negocio; $('i-premio').value = perfil.premio;
  if (perfil.negocio) $('d-negocio').open = true;
  $('i-negocio').addEventListener('input', e => { perfil.negocio = e.target.value.slice(0, C.NEGOCIO_MAX); guardarPerfil(); colorearDemo(); });
  $('i-premio').addEventListener('input', e => { perfil.premio = e.target.value.slice(0, C.PREMIO_MAX); guardarPerfil(); });
  UI.muestras('m-conecti', perfil.conecti, k => { perfil.conecti = k; guardarPerfil(); colorearDemo(); A.play('click'); rPortada.pose(0, 'wave', 1500); });
  UI.muestras('m-barco', perfil.ship, k => { perfil.ship = k; guardarPerfil(); colorearDemo(); A.play('click'); });
  colorearDemo();

  const datosJugador = () => ({ name: perfil.name || 'Capitán', conecti: perfil.conecti, ship: perfil.ship });
  async function crear(metaExtra) {
    A.play('click'); $('e-inicio').textContent = 'Creando sala...';
    const m = metaExtra || { negocio: perfil.negocio, premio: perfil.premio };
    const r = await NET.request('create', { ...datosJugador(), meta: m });
    if (!r.ok) { $('e-inicio').textContent = r.error || 'No se pudo crear la sala.'; UI.toast(r.error || 'No se pudo crear la sala.'); return false; }
    entrarSala(r); return true;
  }
  async function unirse(cod) {
    A.play('click'); $('e-inicio').textContent = 'Entrando...';
    const r = await NET.request('join', { code: cod, ...datosJugador() });
    if (!r.ok) { $('e-inicio').textContent = r.error || 'No se pudo entrar.'; return; }
    entrarSala(r);
  }
  function entrarSala(r) {
    $('e-inicio').textContent = '';
    codigo = r.code; yo = r.slot; ultimaClave = '';
    NET.session.set(r.code, r.token);
    try { history.replaceState(null, '', BASE + '?sala=' + r.code); } catch (e) {}
  }
  $('b-crear').onclick = () => crear();
  $('b-unirse').onclick = () => { A.play('click'); const f = $('f-unirse'); f.hidden = !f.hidden; if (!f.hidden) $('i-codigo').focus(); };
  $('f-unirse').onsubmit = e => { e.preventDefault(); unirse($('i-codigo').value); };
  $('i-codigo').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });

  // ---------------- Sonido ----------------
  function pintarSonido() { $('b-sonido').classList.toggle('sonido-off', A.muted); $('b-sonido').setAttribute('aria-pressed', String(!A.muted)); $('r-volumen').value = Math.round(A.volume * 100); }
  $('b-sonido').onclick = () => { A.unlock(); A.setMuted(!A.muted); pintarSonido(); A.play('click'); };
  $('r-volumen').oninput = e => { A.unlock(); A.setVolume(e.target.value / 100); if (A.muted) A.setMuted(false); pintarSonido(); };
  pintarSonido();
  addEventListener('pointerdown', () => A.unlock(), { once: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? A.suspend() : A.resume()));

  // ---------------- Ajustes ⚙ y guía ----------------
  const menu = $('menu-ajustes');
  $('b-ajustes').onclick = e => { e.stopPropagation(); A.unlock(); menu.hidden = !menu.hidden; $('b-ajustes').setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) pintarControles(); };
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== $('b-ajustes')) { menu.hidden = true; $('b-ajustes').setAttribute('aria-expanded', 'false'); } });
  $('b-guia').onclick = () => { A.play('click'); $('ov-guia').hidden = false; };
  $('b-cerrar-guia').onclick = () => { $('ov-guia').hidden = true; };

  // ---------------- Sala de espera ----------------
  const enlace = () => {
    let u = `${location.origin}${BASE}?sala=${codigo}`;
    const t = meta().torneo;
    if (t && torneoActual && torneoActual.id === t.id) {   // en un torneo, el enlace ya trae el nombre del rival
      const p = torneoActual.rondas[t.r][t.m], otro = [p.a, p.b].find(n => X.claveNombre(n) !== X.claveNombre(nombre(yo)));
      if (otro) u += '&nombre=' + encodeURIComponent(otro);
    }
    return u;
  };
  const enlaceJuego = () => `${location.origin}${BASE}`;
  $('b-copiar-codigo').onclick = () => UI.copiar(codigo, '¡Código copiado!');
  $('b-copiar-enlace').onclick = () => UI.copiar(enlace(), '¡Enlace copiado!');
  $('b-listo').onclick = () => {
    A.play('click');
    const yaListo = st && st.players[yo] && st.players[yo].ready;
    NET.request('ready', { ready: !yaListo });
  };
  async function salir(destino = 's-inicio') {
    A.play('click');
    await NET.request('leave', {});
    NET.session.clear();
    st = null; yo = null; codigo = null; ultimaClave = '';
    rJuego.reset(); $('ov-fin').hidden = true;
    try { history.replaceState(null, '', BASE); } catch (e) {}
    UI.show(destino);
  }
  $('b-salir-sala').onclick = () => salir();
  $('b-menu').onclick = () => salir();
  $('b-invitar').onclick = () => UI.copiar(enlace(), '¡Enlace copiado! Mándalo a tu próximo rival.');
  $('b-revancha').onclick = async () => { A.play('click'); const r = await NET.request('rematch', {}); if (r.ok) pintarFin(); };
  $('b-volver-torneo-fin').onclick = async () => { const id = meta().torneo && meta().torneo.id; await salir('s-torneo'); if (id) abrirTorneo(id); };
  let abandonarArmado = 0;
  $('b-abandonar').onclick = () => {
    if (Date.now() - abandonarArmado < 3000) { salir(); return; }
    abandonarArmado = Date.now();
    $('b-abandonar').textContent = '¿SEGURO? TOCA OTRA VEZ';
    setTimeout(() => { $('b-abandonar').textContent = 'ABANDONAR PARTIDA'; }, 3000);
  };

  let qrHecho = '';
  function qr(div, texto) {
    if (qrHecho === div.id + texto) return;
    qrHecho = div.id + texto;
    div.innerHTML = '';
    if (!window.qrcode) { div.parentElement.hidden = true; return; }
    try {   // qrcode-generator (MIT, incluido en js/vendor): funciona sin internet
      const q = window.qrcode(0, 'M'); q.addData(texto); q.make();
      div.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      div.parentElement.hidden = false;
    } catch (e) { div.parentElement.hidden = true; }
  }

  function pintarSala() {
    $('t-codigo').textContent = codigo;
    $('a-whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(`⚓ ¡Te reto a CONECTI NAVAL BATTLE! Entra aquí: ${enlace()} (sala ${codigo})`);
    const m = meta();
    $('t-negocio-sala').hidden = !m.negocio && !m.torneo;
    $('t-negocio-sala').textContent = [m.torneo ? '⚔ Partido de torneo' : '', m.negocio ? `Presentado por ${m.negocio}` : '', m.premio ? `Premio: ${m.premio}` : ''].filter(Boolean).join(' · ');
    UI.jugadores(st, yo);
    const r = st.players[rival()], meListo = st.players[yo] && st.players[yo].ready;
    $('b-listo').textContent = meListo ? 'CANCELAR LISTO' : '¡ESTOY LISTO!';
    let msg, pose = meListo ? 'cheer' : 'idle';
    if (!r || r.left) msg = `Comparte el código ${codigo} con tu rival.`;
    else if (!r.connected) msg = `${r.name} se desconectó…`;
    else if (!meListo) { msg = `¡Llegó ${r.name}! Toca ESTOY LISTO.`; pose = 'wave'; }
    else if (!r.ready) msg = `Esperando a ${r.name}…`;
    else msg = '¡Todos listos! Zarpamos…';
    UI.conecti('cp-sala', msg, { color: miColor(), pose });
  }

  // ---------------- Plan secreto: moverse + apuntar + disparar ----------------
  const fase = () => (st && yo !== null && st.phase === 'PLANNING' && !st.locked[yo] && !enviando ? 'plan' : null);
  const xPlan = () => {
    const [min, max] = C.ZONES[yo];
    return Math.max(min, Math.min(max, st.ships[yo].x + planDx));
  };
  let ultimoSonidoMotor = 0;
  function paso(dir) {
    if (fase() !== 'plan') return;
    const nuevo = Math.max(-C.MOVE_BUDGET, Math.min(C.MOVE_BUDGET, planDx + dir));
    const [min, max] = C.ZONES[yo];
    if (st.ships[yo].x + nuevo < min || st.ships[yo].x + nuevo > max) return;
    planDx = nuevo;
    pintarMotor();
    const ahora = performance.now();
    if (ahora - ultimoSonidoMotor > 140) { A.play('move'); ultimoSonidoMotor = ahora; }
  }
  function pintarMotor() {
    const left = C.MOVE_BUDGET - Math.abs(planDx);
    $('motor-barra').style.width = (left / C.MOVE_BUDGET * 100) + '%';
    $('motor-txt').textContent = planDx === 0 ? '24' : `${planDx > 0 ? '▶' : '◀'}${Math.abs(planDx)}`;
  }
  function setMira(cambios) {
    aimLocal = { ...aimLocal, ...cambios };
    aimLocal.angle = Math.max(C.ANGLE_MIN, Math.min(C.ANGLE_MAX, Math.round(aimLocal.angle)));
    aimLocal.power = Math.max(C.POWER_MIN, Math.min(C.POWER_MAX, Math.round(aimLocal.power)));
    $('o-angulo').textContent = aimLocal.angle + '°';
    $('o-potencia').textContent = aimLocal.power + '%';
    document.querySelectorAll('.proy').forEach(b => b.setAttribute('aria-checked', String(b.dataset.p === aimLocal.projectile)));
  }
  async function disparar() {
    if (fase() !== 'plan') return;
    enviando = true; $('b-disparar').disabled = true; A.play('click');
    const dx = xPlan() - st.ships[yo].x;
    const r = await NET.request('plan', { dx, ...aimLocal });
    enviando = false;
    if (!r.ok) { UI.toast(r.error || 'No se pudo disparar.'); pintarControles(); return; }
    rJuego.pose(yo, 'cheer', 900);
    decir('¡Cañón listo!', { pose: 'cheer' });
    pintarControles();
  }
  const ctl = window.CONTROLS.create({
    phase: fase, step: paso, fire: disparar,
    angle: d => setMira({ angle: aimLocal.angle + d }), power: d => setMira({ power: aimLocal.power + d }),
    projectile: p => { A.play('click'); setMira({ projectile: p }); },
  });
  ctl.mantener($('b-izq'), () => paso(-1));
  ctl.mantener($('b-der'), () => paso(1));
  ctl.mantener($('b-ang-menos'), () => setMira({ angle: aimLocal.angle - 1 }));
  ctl.mantener($('b-ang-mas'), () => setMira({ angle: aimLocal.angle + 1 }));
  ctl.mantener($('b-pot-menos'), () => setMira({ power: aimLocal.power - 1 }));
  ctl.mantener($('b-pot-mas'), () => setMira({ power: aimLocal.power + 1 }));
  $('b-disparar').onclick = disparar;
  // Apuntar arrastrando sobre el mar: la dirección desde tu cañón da el ángulo y la distancia, la potencia
  (function arrastrarParaApuntar() {
    const cv = $('c-juego');
    let activo = false;
    function apuntarDesde(e) {
      const r = cv.getBoundingClientRect();
      const lx = (e.clientX - r.left) * C.WIDTH / r.width, ly = (e.clientY - r.top) * C.HEIGHT / r.height;
      const f = C.FACING[yo], px = modelo.ships[yo].x + f * C.CANNON_PIVOT_DX, py = C.CANNON_PIVOT_Y;
      const dx = (lx - px) * f, dy = py - ly;
      if (Math.hypot(dx, dy) < 6) return;
      const ang = Math.atan2(Math.max(0, dy), Math.max(0.01, dx)) * 180 / Math.PI;
      setMira({ angle: ang, power: Math.hypot(dx, dy) / 1.2 });
    }
    cv.addEventListener('pointerdown', e => { if (fase() !== 'plan') return; activo = true; A.unlock(); try { cv.setPointerCapture(e.pointerId); } catch (_) {} apuntarDesde(e); });
    cv.addEventListener('pointermove', e => { if (activo && fase() === 'plan') apuntarDesde(e); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => cv.addEventListener(ev, () => { if (activo) { activo = false; A.play('click'); } }));
  })();
  document.querySelectorAll('.proy').forEach(b => {
    const cv = b.querySelector('canvas'), ico = window.RENDERER.iconoSprite(b.dataset.p);
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(ico, 0, 0);
    b.onclick = () => { A.play('click'); setMira({ projectile: b.dataset.p }); };
  });
  setMira({});

  function pintarControles() {
    const f = fase(), r = rival();
    $('ctl-plan').hidden = !(st && st.phase === 'PLANNING' && !st.locked[yo]);
    $('b-disparar').disabled = f !== 'plan';
    const esperando = st && st.phase === 'PLANNING' && st.locked[yo];
    $('ctl-espera').hidden = !esperando;
    if (esperando) $('t-espera').textContent = st.locked[r] ? '¡Fuego!' : `Esperando a ${nombre(r)}…`;
    $('b-abandonar').hidden = !st || $('s-juego').hidden || st.phase === 'GAME_OVER';
  }

  // ---------------- Mensajes de Conecti en combate ----------------
  let burbujaT = null;
  /** Conecti habla en un globito sobre el mar (2 s) y desaparece. */
  function decir(txt, opts = {}) {
    const b = $('burbuja'); if (!b) return;
    UI.sprite(b.querySelector('canvas'), opts.pose || 'idle', miColor()); b.querySelector('canvas').style.width = '';
    b.querySelector('span').textContent = txt;
    b.hidden = false; b.classList.remove('sale');
    clearTimeout(burbujaT);
    burbujaT = setTimeout(() => { b.classList.add('sale'); burbujaT = setTimeout(() => { b.hidden = true; }, 260); }, opts.ms || 2200);
  }
  const ZONA = { proa: 'la proa', popa: 'la popa', centro: 'el centro' };
  const PODER = { escudo: 'ESCUDO 🛡 (bloquea el próximo golpe)', doble: 'DOBLE DAÑO ✖2 (en tu próximo acierto)', reparar: `REPARACIÓN +${C.REPAIR_HP} HP` };
  const vientoTxt = w => (w === 0 ? 'sin viento' : `viento ${w > 0 ? 'hacia la derecha ▶' : 'hacia la izquierda ◀'} (${Math.abs(w)})`);

  function alCambiarFase() {
    const clave = `${st.match}-${st.phase}-${st.round}`;
    const r = rival();
    if (st.phase === 'PLANNING' && st.locked[r] && !st.locked[yo] && rivalListoAviso !== clave) {
      rivalListoAviso = clave; A.play('alert');
      decir(`¡${nombre(r)} ya disparó!`, { pose: 'point' });
    }
    if (clave === ultimaClave) return;
    ultimaClave = clave;
    switch (st.phase) {
      case 'WAITING':
        rJuego.reset(); modelo.sinking = null; modelo.sinkT = 0; modelo.winner = null; revelando = null;
        modelo.ships.forEach((s, i) => { s.x = st.ships[i].x; });
        A.play('start');
        rJuego.pose(0, 'wave', 2400); rJuego.pose(1, 'wave', 2400);
        decir('¡Prepárate para atacar!', { pose: 'wave' });
        break;
      case 'PLANNING':
        planDx = 0; enviando = false; pintarMotor(); setMira({});
        A.play('turn'); rJuego.banner(`RONDA ${st.round}`, '#FFD84A', 800);
        if (st.crate && st.round % C.CRATE_EVERY === 0) rJuego.banner('¡CAJA 360!', '#1FA4F5', 900);
        decir('¡Mueve y apunta!', { pose: 'point' });
        break;
      case 'PAUSED': {
        const p = st.players.findIndex(x => x && !x.connected);
        decir(`${nombre(p)} se desconectó`, { pose: 'sad', ms: 3000 });
        break;
      }
      case 'GAME_OVER': {
        const empate = st.winner === null && st.reason === 'empate', gane = st.winner === yo;
        A.play(gane ? 'win' : 'lose');
        modelo.winner = st.winner;
        modelo.sinking = empate ? 'ambos' : st.reason === 'hp' ? 1 - st.winner : null; modelo.sinkT = 0;
        rJuego.banner(empate ? '¡EMPATE!' : gane ? '¡VICTORIA!' : '¡DERROTA!', gane || empate ? '#FFD84A' : '#9FC3FF', 1800);
        if (gane) for (let i = 0; i < 5; i++) setTimeout(() => rJuego.explosion(60 + Math.random() * 360, 40 + Math.random() * 60, false), 300 + i * 350);
        decir(empate ? '¡Empate!' : gane ? '¡Ganamos!' : '¡Volveremos!', { pose: gane ? 'cheer' : 'sad' });
        break;
      }
    }
  }

  /** Efectos cuando termina cada trayectoria (el daño definitivo llega en 'resolution'). Solo carteles cortos. */
  function finTrayectoria(sh, tr) {
    const imp = tr.impact;
    if (!imp || imp.type === 'split') return;
    if (imp.type === 'hull') {
      const crit = imp.zone !== 'centro';
      rJuego.explosion(imp.x, imp.y, crit && !tr.fragment);
      rJuego.golpe(imp.target); rJuego.pose(imp.target, 'hit', 1300);
      A.play(crit ? 'impact' : 'armor');
      if (!tr.fragment) rJuego.banner(imp.self ? '¡AUTOGOL!' : crit ? '¡CRÍTICO!' : '¡BLINDAJE!', crit ? '#FF4D5E' : '#FFD84A');
    } else if (imp.type === 'water') {
      rJuego.salpicadura(imp.x); A.play('splash');
      if (!tr.fragment) rJuego.banner('¡AL AGUA!', '#9BD8FF');
    } else if (imp.type === 'rock') {
      rJuego.explosion(imp.x, imp.y, false); A.play('armor');
      if (!tr.fragment) rJuego.banner('¡ROCA!', '#B9C2D4');
    } else if (imp.type === 'crate') {
      rJuego.explosion(imp.x, imp.y, false); A.play('impact');
      rJuego.banner('¡CAJA 360!', '#1FA4F5');
    } else {
      A.play('splash');
      if (!tr.fragment) rJuego.banner('¡FALLÓ!', '#9FC3FF');
    }
  }

  // ---------------- Fin de partida ----------------
  function pintarFin() {
    const ov = $('ov-fin');
    if (!st || st.phase !== 'GAME_OVER' || $('s-juego').hidden) { ov.hidden = true; return; }
    const empate = st.winner === null, gane = st.winner === yo, r = st.players[rival()], m = meta();
    ov.hidden = false;
    ov.classList.toggle('gana', gane || empate); ov.classList.toggle('pierde', !gane && !empate);
    $('fin-titulo').textContent = empate ? '¡EMPATE!' : gane ? '¡VICTORIA NAVAL!' : '¡VOLVEREMOS MÁS FUERTES!';
    $('fin-titulo').classList.toggle('tilde', /[ÁÉÍÓÚÑ]/.test($('fin-titulo').textContent));
    $('fin-texto').textContent = empate ? 'Los dos barcos se hundieron en la misma ronda. ¡Nadie domina el mar… todavía!'
      : gane ? `Ganó ${nombre(yo)}${st.reason === 'abandono' ? ' (el rival abandonó)' : ''} en ${st.round} ronda${st.round === 1 ? '' : 's'}. ¡Conecti domina el mar!`
      : `Ganó ${nombre(st.winner)}. Tu barco se hundió, pero Conecti no se rinde.`;
    UI.sprite($('c-fin'), gane ? 'cheer' : empate ? 'idle' : 'sad', miColor()); $('c-fin').style.width = '';
    // Premio del negocio
    const pr = $('fin-premio');
    pr.hidden = !m.premio || empate;
    if (m.premio && !empate) pr.innerHTML = gane
      ? `<b>🎁 TU PREMIO${m.negocio ? ' DE ' + esc(m.negocio).toUpperCase() : ''}</b>${esc(m.premio)}<br><small>Muestra esta pantalla para reclamarlo.</small>`
      : `<b>PREMIO${m.negocio ? ' DE ' + esc(m.negocio).toUpperCase() : ''}</b>${esc(nombre(st.winner))} se lleva: ${esc(m.premio)}`;
    $('b-volver-torneo-fin').hidden = !m.torneo;
    const rivalSeFue = !r || r.left;
    $('b-revancha').disabled = rivalSeFue || (st.players[yo] && st.players[yo].rematch);
    $('b-revancha').textContent = st.players[yo] && st.players[yo].rematch ? 'ESPERANDO AL RIVAL…' : 'SOLICITAR REVANCHA';
    $('fin-nota').textContent = rivalSeFue ? 'Tu rival se fue. Copia el enlace e invita a otro: entrará a esta misma sala.'
      : !r.connected ? `${r.name} se desconectó. Si vuelve pronto, pueden jugar la revancha.`
      : r.rematch ? `¡${r.name} quiere la revancha!` : '';
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  $('b-compartir').onclick = async () => {
    if (!st) return;
    A.play('click');
    const empate = st.winner === null, gane = st.winner === yo;
    const titulo = empate ? '¡EMPATE!' : gane ? '¡VICTORIA NAVAL!' : `¡GANÓ ${nombre(st.winner).toUpperCase()}!`;
    const r = await window.SHARE.compartir({
      titulo, nombres: [nombre(0), nombre(1)], colores: st.players.map(p => C.COLORS[(p && p.conecti) || 'azul']),
      hp: st.ships.map(s => s.hp), rondas: st.round, ganadorSlot: st.winner, negocio: meta().negocio, premio: meta().premio, enlace: enlaceJuego(),
    });
    if (r === 'descargado') UI.toast('Imagen guardada. ¡Súbela a tus historias!');
  };

  // ---------------- Pausa ----------------
  function pintarPausa() {
    const ov = $('ov-pausa');
    if (!st || st.phase !== 'PAUSED') { ov.hidden = true; return; }
    ov.hidden = false;
    const p = st.players.findIndex(x => x && !x.connected);
    const fin = p >= 0 ? st.players[p].reconnectEndsAt : 0;
    const s = Math.max(0, Math.ceil((fin - ahoraServidor()) / 1000));
    $('ov-pausa-txt').textContent = p >= 0 ? `${nombre(p)} se desconectó. Si no vuelve en ${s} s, gana ${p === yo ? 'el rival' : 'quien sigue conectado'}.` : 'Reanudando…';
  }

  // ---------------- Red ----------------
  NET.on('connect', async () => {
    const ses = NET.session.get();
    if (!ses) return;
    const r = await NET.request('resume', { code: ses.code, token: ses.token });
    if (r.ok) { codigo = r.code; yo = r.slot; ultimaClave = ''; if (st) UI.toast('¡Reconectado!'); }
    else { NET.session.clear(); if (codigo) { UI.toast(r.error || 'No se pudo volver a la sala.'); codigo = null; yo = null; st = null; UI.show('s-inicio'); } }
  });
  NET.on('disconnect', () => { if (codigo) UI.toast('Se perdió la conexión. Reconectando…'); });
  NET.on('hostAway', fuera => { if (codigo && fuera) UI.toast('El anfitrión se desconectó…'); else if (codigo && fuera === false) UI.toast('¡El anfitrión volvió!'); });
  NET.on('closed', () => { if (!codigo) return; NET.session.clear(); codigo = null; yo = null; st = null; rJuego.reset(); $('ov-fin').hidden = true; UI.toast('El anfitrión cerró la sala.'); try { history.replaceState(null, '', BASE); } catch (e) {} UI.show('s-inicio'); });

  NET.on('state', s => {
    if (!codigo || s.code !== codigo) return;
    offset = s.serverNow - Date.now();
    st = s;
    st.locked = st.locked || [false, false];
    st.powers = st.powers || [{}, {}];
    st.rocks = st.rocks || [];
    NET.session.touch();
    if (s.phase === 'LOBBY') { $('ov-fin').hidden = true; UI.show('s-sala'); pintarSala(); return; }
    if ($('s-juego').hidden) { UI.show('s-juego'); modelo.ships.forEach((sh, i) => { sh.x = s.ships[i].x; }); }
    UI.hud(s, yo);
    alCambiarFase();
    pintarControles(); pintarFin(); pintarPausa();
  });
  // Se revela todo: primero se deslizan los barcos, luego vuelan las bombas
  NET.on('reveal', p => {
    if (!st) return;
    const moveMs = p.moveMs || C.REVEAL_MOVE_MS;
    p.moves.forEach((mv, i) => { st.ships[i].x = mv.to; });
    const maxDist = Math.max(...p.moves.map(mv => Math.abs(mv.to - mv.from)), 1);
    revelando = { hasta: performance.now() + moveMs, vel: Math.max(70, maxDist / (moveMs / 1000)) };
    const rv = p.moves[rival()];
    if (rv && rv.to !== rv.from) A.play('move');
    for (const sh of p.shots) {
      st.aim[sh.shooter] = { angle: sh.angle, power: sh.power, projectile: sh.projectile };
      rJuego.disparo(sh, moveMs, tr => finTrayectoria(sh, tr));
    }
    if (p.shots.length) setTimeout(() => {
      A.play('fire'); A.play('whistle', Math.max(...p.shots.map(x => x.flightMs)));
      p.shots.forEach(sh => rJuego.pose(sh.shooter, 'cheer', 900));
      rJuego.banner('¡FUEGO!', '#FF9A2E', 700);
    }, moveMs);
    if (p.missed.includes(yo) && p.missed.length === 2) decir('¡Nadie disparó!', { pose: 'sad' });
    else if (p.missed.includes(yo)) decir('¡Se acabó el tiempo!', { pose: 'sad' });
    else if (p.missed.length) decir(`¡${nombre(rival())} no disparó!`, { pose: 'cheer' });
    pintarControles();
  });
  NET.on('resolution', r => {
    if (!st) return;
    r.hp.forEach((h, i) => { st.ships[i].hp = h; });
    if (r.powers) st.powers = r.powers;
    for (const imp of r.impacts || []) {
      if (imp.type !== 'hull') continue;
      if (imp.blocked) rJuego.texto('¡BLOQUEADO!', imp.x, imp.y - 14, '#1FA4F5');
      else rJuego.texto('-' + imp.damage, imp.x, imp.y - 14, imp.damage >= C.DAMAGE_CRIT ? '#FF4D5E' : '#FFD84A');
    }
    if (r.crate) {
      const mio = r.crate.by === yo, nombreP = { escudo: 'ESCUDO', doble: 'DOBLE DAÑO', reparar: '+15 HP' }[r.crate.power];
      rJuego.banner(`¡${nombreP}!`, '#1FA4F5', 1000);
      decir(mio ? `¡${nombreP} para ti!` : `¡${nombreP} para ${nombre(r.crate.by)}!`, { pose: mio ? 'cheer' : 'idle' });
      A.play('win');
    }
    UI.hud(st, yo);
  });

  // ---------------- Ranking semanal ----------------
  async function abrirRanking() {
    UI.show('s-ranking');
    const l = $('l-ranking'); l.innerHTML = '<li class="vacio">Cargando…</li>';
    const r = await NET.request('ranking:get', {});
    if (!r.ok) { l.innerHTML = `<li class="vacio">${esc(r.error || 'No se pudo cargar el ranking.')}</li>`; return; }
    $('t-semana').textContent = `Semana ${String(r.semana).slice(2)} del 20${String(r.semana).slice(0, 2)}`;
    l.innerHTML = r.top.length ? r.top.map(f => `<li><span>${esc(f.name)}<small>${f.v} victorias · ${f.e} empates · ${f.d} derrotas</small></span><b>${f.pts} PTS</b></li>`).join('')
      : '<li class="vacio">Todavía nadie juega esta semana. ¡Sé el primero!</li>';
  }
  $('b-ranking').onclick = () => { A.play('click'); abrirRanking(); };
  $('b-volver-ranking').onclick = () => UI.show('s-inicio');

  // ---------------- Torneo ----------------
  const tokenTorneo = id => { try { return localStorage.getItem('cnb-torneo-' + id); } catch (e) { return null; } };
  function camposJugadores() {
    const n = +document.querySelector('input[name=t-tam]:checked').value, cont = $('t-jugadores');
    const previos = [...cont.querySelectorAll('input')].map(i => i.value);
    cont.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const inp = document.createElement('input');
      inp.maxLength = C.NAME_MAX; inp.placeholder = `Capitán ${i + 1}`; inp.value = previos[i] || (i === 0 ? perfil.name : '');
      inp.setAttribute('aria-label', `Capitán ${i + 1}`);
      cont.appendChild(inp);
    }
  }
  document.querySelectorAll('input[name=t-tam]').forEach(r => r.onchange = camposJugadores);
  $('b-torneo').onclick = () => { A.play('click'); torneoActual = null; $('f-torneo').hidden = false; $('v-torneo').hidden = true; $('i-t-negocio').value = perfil.negocio; $('i-t-premio').value = ''; camposJugadores(); UI.show('s-torneo'); };
  $('b-volver-torneo').onclick = () => { try { history.replaceState(null, '', BASE); } catch (e) {} UI.show('s-inicio'); };
  $('f-torneo').onsubmit = async e => {
    e.preventDefault(); A.play('click');
    const jugadores = [...$('t-jugadores').querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
    $('e-torneo').textContent = 'Creando torneo…';
    const r = await NET.request('torneo:create', { nombre: $('i-t-nombre').value, negocio: $('i-t-negocio').value, premio: $('i-t-premio').value, jugadores });
    if (!r.ok) { $('e-torneo').textContent = r.error || 'No se pudo crear el torneo.'; return; }
    $('e-torneo').textContent = '';
    try { localStorage.setItem('cnb-torneo-' + r.id, r.token); } catch (err) {}
    abrirTorneo(r.id);
  };
  async function abrirTorneo(id) {
    UI.show('s-torneo'); $('f-torneo').hidden = true; $('v-torneo').hidden = false;
    $('t-llaves').innerHTML = '<p class="ayuda">Cargando torneo…</p>';
    const r = await NET.request('torneo:get', { id });
    if (!r.ok) { $('t-llaves').innerHTML = `<p class="error">${esc(r.error || 'Ese torneo no existe.')}</p>`; return; }
    try { history.replaceState(null, '', BASE + '?torneo=' + id); } catch (e) {}
    pintarTorneo(r.torneo);
  }
  NET.on('torneo', t => { if (torneoActual && t && t.id === torneoActual.id) pintarTorneo(t); });
  function pintarTorneo(t) {
    torneoActual = t;
    const org = !!tokenTorneo(t.id);
    const nombresRonda = t.rondas.length === 3 ? ['CUARTOS', 'SEMIFINAL', 'FINAL'] : ['SEMIFINAL', 'FINAL'];
    $('t-t-nombre').textContent = t.nombre + (t.negocio ? ` · ${t.negocio}` : '');
    $('t-t-premio').textContent = t.premio ? `🎁 Premio para el campeón: ${t.premio}` : '';
    const cont = $('t-llaves'); cont.innerHTML = '';
    t.rondas.forEach((ronda, ri) => {
      const col = document.createElement('div'); col.className = 'llave-ronda';
      col.innerHTML = `<h3>${nombresRonda[ri]}</h3>`;
      ronda.forEach((p, mi) => {
        const d = document.createElement('div'); d.className = 'partido';
        for (const n of [p.a, p.b]) {
          const el = document.createElement(org && n && p.a && p.b && !p.ganador ? 'button' : 'div');
          el.className = 'j' + (!n ? ' vacio' : p.ganador ? (p.ganador === n ? ' gana' : ' pierde') : '');
          el.textContent = n || 'Por definir';
          if (el.tagName === 'BUTTON') { el.title = 'Marcar ganador'; el.onclick = () => marcarGanador(t.id, ri, mi, n, el); }
          d.appendChild(el);
        }
        if (p.a && p.b && !p.ganador) for (const n of [p.a, p.b]) {
          const b = document.createElement('button'); b.className = 'btn'; b.textContent = `JUGAR: SOY ${n.toUpperCase()}`;
          b.onclick = () => jugarPartido(t, ri, mi, n);
          d.appendChild(b);
        }
        col.appendChild(d);
      });
      cont.appendChild(col);
    });
    if (t.campeon) { const c = document.createElement('div'); c.className = 'campeon'; c.textContent = `🏆 CAMPEÓN: ${t.campeon}`; cont.appendChild(c); }
    const url = `${location.origin}${BASE}?torneo=${t.id}`;
    qr($('qr-torneo'), url);
    $('b-t-enlace').onclick = () => UI.copiar(url, '¡Enlace del torneo copiado!');
    $('t-t-ayuda').textContent = org ? 'Eres el organizador: si algún resultado no se registra solo, toca dos veces el nombre del ganador.' : 'Los resultados se actualizan solos al terminar cada partida.';
  }
  let marcarArmado = '';
  async function marcarGanador(id, r, m, n, el) {
    const k = `${r}-${m}-${n}`;
    if (marcarArmado !== k) { marcarArmado = k; el.textContent = `¿Ganó ${n}? Toca otra vez`; setTimeout(() => { if (marcarArmado === k) { marcarArmado = ''; el.textContent = n; } }, 3000); return; }
    marcarArmado = '';
    const res = await NET.request('torneo:winner', { id, token: tokenTorneo(id), r, m, nombre: n });
    if (!res.ok) UI.toast(res.error || 'No se pudo marcar.');
  }
  async function jugarPartido(t, r, m, soy) {
    perfil.name = soy; guardarPerfil(); $('i-nombre').value = soy;
    const ok = await crear({ negocio: t.negocio, premio: r === t.rondas.length - 1 ? t.premio : '', torneo: { id: t.id, r, m } });
    if (!ok) UI.show('s-torneo');
  }

  // ---------------- Bucle de dibujo ----------------
  function actualizarModelo(dt) {
    if (!st) return;
    st.players.forEach((p, i) => {
      if (!p) return;
      modelo.colores[i] = { ship: C.COLORS[p.ship], conecti: C.COLORS[p.conecti] };
      modelo.nombres[i] = (i === yo ? 'TÚ' : p.name).slice(0, 10);
    });
    if (revelando && performance.now() > revelando.hasta + 400) revelando = null;
    const vel = revelando ? revelando.vel : 70;
    modelo.ships.forEach((s, i) => {
      // En el plan secreto solo TU barco se mueve en TU pantalla
      const meta = i === yo && st.phase === 'PLANNING' && !st.locked[yo] ? xPlan() : i === yo && st.phase === 'PLANNING' ? st.ships[yo].x + planDx : st.ships[i].x;
      const d = meta - s.x, v = vel * dt;
      s.x = Math.abs(d) <= v ? meta : s.x + Math.sign(d) * v;
      s.hp = st.ships[i].hp;
    });
    modelo.turn = -1;
    modelo.enJuego = st.phase === 'PLANNING';
    modelo.listos = st.phase === 'PLANNING' ? st.locked : [false, false];
    modelo.decidiendo = [0, 1].map(i => st.phase === 'PLANNING' && !st.locked[i]);
    modelo.aim = [0, 1].map(i => (i === yo && st.phase === 'PLANNING' ? aimLocal : st.aim[i]));
    modelo.moveHint = fase() === 'plan' ? { slot: yo, min: C.ZONES[yo][0], max: C.ZONES[yo][1], x: st.ships[yo].x, left: C.MOVE_BUDGET } : null;
    modelo.aimGuide = fase() === 'plan' ? yo : null;
    modelo.wind = ['PLANNING', 'REVEAL', 'RESOLUTION'].includes(st.phase) ? st.wind : null;
    modelo.rocks = st.rocks; modelo.crate = st.crate; modelo.negocio = meta().negocio || '';
    modelo.poseBase = [0, 1].map(i => {
      if (st.phase === 'GAME_OVER') return i === st.winner ? 'dance' : 'sad';
      if (st.phase === 'PLANNING') return st.locked[i] ? 'cheer' : 'point';
      return null;
    });
  }

  function reloj() {
    const el = $('hud-reloj'), t = $('hud-turno');
    if (!st) return;
    const etiquetas = { WAITING: '¡A ZARPAR!', REVEAL: '¡FUEGO!', RESOLUTION: 'DAÑOS', PAUSED: 'PAUSA', GAME_OVER: 'FIN', NEXT_TURN: '…' };
    t.textContent = st.phase === 'PLANNING' ? `RONDA ${st.round} · ${st.locked[yo] ? 'LISTO' : 'MUEVE Y APUNTA'}` : etiquetas[st.phase] || '';
    $('hud-viento').textContent = ['PLANNING', 'REVEAL', 'RESOLUTION'].includes(st.phase) ? (st.wind === 0 ? 'SIN VIENTO' : `VIENTO ${st.wind > 0 ? '▶' : '◀'} ${Math.abs(st.wind)}`) : '';
    let seg = '';
    if (st.phaseEndsAt && ['PLANNING', 'WAITING'].includes(st.phase)) {
      const s = Math.max(0, Math.ceil((st.phaseEndsAt - ahoraServidor()) / 1000));
      seg = String(s).padStart(2, '0');
      const urgente = s <= 5 && st.phase === 'PLANNING';
      el.classList.toggle('urgente', urgente);
      if (urgente && fase() && s !== ultimoTick && s > 0) { ultimoTick = s; A.play('tick'); }
    } else if (st.phase === 'PAUSED') { seg = '❚❚'; el.classList.remove('urgente'); }
    else { seg = '--'; el.classList.remove('urgente'); }
    el.textContent = seg;
    if (st.phase === 'PAUSED') pintarPausa();
  }

  let antes = performance.now();
  function cuadro(ahora) {
    const dt = Math.min(0.05, (ahora - antes) / 1000); antes = ahora;
    if (!document.hidden) {
      if (!$('s-inicio').hidden) {
        if (ahora > demoProximo) { disparoDemo(); demoProximo = ahora + 3800; }
        demo.aim[0].angle = 50 + Math.sin(ahora / 900) * 12;
        demo.aim[1].angle = 50 + Math.cos(ahora / 1100) * 12;
        rPortada.draw(demo);
      } else if (!$('s-juego').hidden) {
        actualizarModelo(dt);
        rJuego.draw(modelo);
        reloj();
      }
    }
    requestAnimationFrame(cuadro);
  }
  requestAnimationFrame(cuadro);

  // Solo lectura, para pruebas manuales/automáticas desde la consola (no cambia nada del juego)
  window.__debug = () => ({ yo, codigo, phase: st && st.phase, round: st && st.round, locked: st && st.locked, wind: st && st.wind, rocks: st && st.rocks, crate: st && st.crate,
    powers: st && st.powers, ships: st ? st.ships.map(s => ({ x: s.x, hp: s.hp })) : [], planDx, torneo: torneoActual });

  window.__apuntar = (angle, power, projectile) => setMira({ angle, power, projectile: projectile || aimLocal.projectile });

  // ---------------- Arranque ----------------
  const salaURL = params.get('sala'), torneoURL = params.get('torneo'), nombreURL = params.get('nombre');
  if (nombreURL) { perfil.name = nombreURL.slice(0, C.NAME_MAX); guardarPerfil(); $('i-nombre').value = perfil.name; colorearDemo(); }
  const ses = NET.session.get();
  UI.show('s-inicio');
  if (ses && (!salaURL || salaURL === ses.code)) {
    codigo = ses.code;                     // intentará recuperar el lugar al conectar
    UI.conecti('cp-sala', 'Recuperando tu partida…', { color: perfil.conecti });
  } else if (salaURL) {
    $('f-unirse').hidden = false; $('i-codigo').value = salaURL.replace(/\D/g, '').slice(0, 4);
    $('e-inicio').textContent = 'Elige tu nombre y colores, y toca ENTRAR.';
  } else if (torneoURL && C && /^T[A-Z2-9]{4}$/.test(torneoURL.toUpperCase())) {
    abrirTorneo(torneoURL.toUpperCase());
  }
})();
