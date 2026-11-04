/*
 * CONECTI NAVAL BATTLE — cliente.
 * El navegador solo muestra lo que el servidor decide: recibe 'state' (estado completo),
 * 'shots' (las dos trayectorias, ya calculadas, salen juntas) y 'resolution' (daño aplicado).
 */
(function () {
  const C = window.CNB, UI = window.UI, NET = window.NET, A = window.AUDIO, $ = UI.$;

  // Dirección base del juego (sirve en la raíz de un servidor o dentro de una carpeta, como en GitHub Pages)
  const BASE = location.pathname.replace(/index\.html$/, '');

  // ---------------- Perfil del jugador ----------------
  const PERFIL_KEY = 'cnb-perfil';
  const azar = () => C.COLOR_KEYS[Math.floor(Math.random() * C.COLOR_KEYS.length)];
  const perfil = (() => { try { return { name: '', conecti: azar(), ship: azar(), ...JSON.parse(localStorage.getItem(PERFIL_KEY)) }; } catch (e) { return { name: '', conecti: azar(), ship: azar() }; } })();
  if (!C.COLORS[perfil.conecti]) perfil.conecti = 'azul';
  if (!C.COLORS[perfil.ship]) perfil.ship = 'morado';
  const guardarPerfil = () => { try { localStorage.setItem(PERFIL_KEY, JSON.stringify(perfil)); } catch (e) {} };

  // ---------------- Estado del cliente ----------------
  let st = null, yo = null, codigo = null, offset = 0;
  let aimLocal = { angle: 45, power: 60, projectile: 'tiktok' };
  let ultimaClave = '', disparoEnVuelo = false, revanchaPedida = false, ultimoTick = -1;
  const ahoraServidor = () => Date.now() + offset;
  const rival = () => (yo === null ? 1 : 1 - yo);
  const nombre = i => (st && st.players[i] && st.players[i].name) || 'Rival';
  const miColor = () => (st && yo !== null && st.players[yo] ? st.players[yo].conecti : perfil.conecti);

  // ---------------- Renderizadores ----------------
  const rJuego = window.RENDERER.create($('c-juego'));
  const rPortada = window.RENDERER.create($('c-portada'));
  const modelo = {
    ships: [{ x: C.START_X[0], hp: 100 }, { x: C.START_X[1], hp: 100 }],
    colores: [{ ship: C.COLORS.azul, conecti: C.COLORS.azul }, { ship: C.COLORS.morado, conecti: C.COLORS.verde }],
    nombres: ['', ''], aim: [{ angle: 45, power: 60 }, { angle: 45, power: 60 }],
    turn: 0, enJuego: false, mostrarBarras: true, moveHint: null, aimGuide: null, poseBase: [null, null],
    winner: null, sinking: null, sinkT: 0,
  };

  // ---------------- Portada: vista previa animada con tus colores ----------------
  const demo = {
    ships: [{ x: 110, hp: 100 }, { x: 370, hp: 100 }], colores: [{}, {}], nombres: ['TÚ', 'RIVAL'],
    aim: [{ angle: 45, power: 60 }, { angle: 45, power: 60 }], turn: -1, enJuego: false, mostrarBarras: true,
    moveHint: null, aimGuide: null, poseBase: [null, null], winner: null, sinking: null, sinkT: 0,
  };
  let demoRival = 'morado', demoProximo = performance.now() + 2500, demoTurno = 0;
  function colorearDemo() {
    const otros = C.COLOR_KEYS.filter(k => k !== perfil.ship);
    demoRival = otros[0];
    demo.colores[0] = { ship: C.COLORS[perfil.ship], conecti: C.COLORS[perfil.conecti] };
    demo.colores[1] = { ship: C.COLORS[demoRival], conecti: C.COLORS[otros[1] || 'verde'] };
    demo.nombres[0] = (perfil.name || 'TÚ').slice(0, 10);
  }
  function disparoDemo() {
    const s = demoTurno, o = 1 - s, f = C.FACING[s];
    const ang = 40 + Math.random() * 20, g = C.GRAVITY;
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
    rPortada.disparo({ path, flightMs: path.length * 33, projectile: Math.random() < 0.5 ? 'tiktok' : 'instagram', shooter: s }, () => {
      if (impacto.type === 'hull') { rPortada.explosion(impacto.x, impacto.y); rPortada.pose(o, 'hit', 1000); rPortada.golpe(o); }
      else rPortada.salpicadura(impacto.x);
    });
    demoTurno = o;
  }

  // ---------------- Pantalla de inicio ----------------
  $('i-nombre').value = perfil.name;
  $('i-nombre').addEventListener('input', e => { perfil.name = e.target.value.slice(0, C.NAME_MAX); guardarPerfil(); colorearDemo(); });
  UI.muestras('m-conecti', perfil.conecti, k => { perfil.conecti = k; guardarPerfil(); colorearDemo(); A.play('click'); rPortada.pose(0, 'cheer', 700); });
  UI.muestras('m-barco', perfil.ship, k => { perfil.ship = k; guardarPerfil(); colorearDemo(); A.play('click'); });
  colorearDemo();

  const datosJugador = () => ({ name: perfil.name || 'Capitán', conecti: perfil.conecti, ship: perfil.ship });
  async function crear() {
    A.play('click'); $('e-inicio').textContent = 'Creando sala...';
    const r = await NET.request('create', datosJugador());
    if (!r.ok) { $('e-inicio').textContent = r.error || 'No se pudo crear la sala.'; return; }
    entrarSala(r);
  }
  async function unirse(cod) {
    A.play('click'); $('e-inicio').textContent = 'Entrando...';
    const r = await NET.request('join', { code: cod, ...datosJugador() });
    if (!r.ok) { $('e-inicio').textContent = r.error || 'No se pudo entrar.'; return; }
    entrarSala(r);
  }
  function entrarSala(r) {
    $('e-inicio').textContent = '';
    codigo = r.code; yo = r.slot; ultimaClave = ''; revanchaPedida = false;
    NET.session.set(r.code, r.token);
    try { history.replaceState(null, '', BASE + '?sala=' + r.code); } catch (e) {}
  }
  $('b-crear').onclick = crear;
  $('b-unirse').onclick = () => { A.play('click'); const f = $('f-unirse'); f.hidden = !f.hidden; if (!f.hidden) $('i-codigo').focus(); };
  $('f-unirse').onsubmit = e => { e.preventDefault(); unirse($('i-codigo').value); };
  $('i-codigo').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''); });

  // ---------------- Sonido ----------------
  function pintarSonido() { $('b-sonido').classList.toggle('mudo', A.muted); $('b-sonido').setAttribute('aria-pressed', String(!A.muted)); $('r-volumen').value = Math.round(A.volume * 100); }
  $('b-sonido').onclick = () => { A.unlock(); A.setMuted(!A.muted); pintarSonido(); A.play('click'); };
  $('r-volumen').oninput = e => { A.unlock(); A.setVolume(e.target.value / 100); if (A.muted) A.setMuted(false); pintarSonido(); };
  pintarSonido();
  addEventListener('pointerdown', () => A.unlock(), { once: true });
  document.addEventListener('visibilitychange', () => (document.hidden ? A.suspend() : A.resume()));

  // ---------------- Sala de espera ----------------
  const enlace = () => `${location.origin}${BASE}?sala=${codigo}`;
  $('b-copiar-codigo').onclick = () => UI.copiar(codigo, '¡Código copiado!');
  $('b-copiar-enlace').onclick = () => UI.copiar(enlace(), '¡Enlace copiado!');
  $('b-listo').onclick = () => {
    A.play('click');
    const yaListo = st && st.players[yo] && st.players[yo].ready;
    NET.request('ready', { ready: !yaListo });
  };
  async function salir() {
    A.play('click');
    await NET.request('leave', {});
    NET.session.clear();
    st = null; yo = null; codigo = null; ultimaClave = '';
    rJuego.reset();
    try { history.replaceState(null, '', BASE); } catch (e) {}
    UI.show('s-inicio');
  }
  $('b-salir-sala').onclick = salir;
  $('b-menu').onclick = salir;
  $('b-invitar').onclick = () => UI.copiar(enlace(), '¡Enlace copiado! Mándalo a tu próximo rival.');
  $('b-revancha').onclick = async () => {
    A.play('click');
    const r = await NET.request('rematch', {});
    if (r.ok) { revanchaPedida = true; pintarFin(); }
  };
  let abandonarArmado = 0;
  $('b-abandonar').onclick = () => {
    if (Date.now() - abandonarArmado < 3000) { salir(); return; }
    abandonarArmado = Date.now();
    $('b-abandonar').textContent = '¿SEGURO? TOCA OTRA VEZ';
    setTimeout(() => { $('b-abandonar').textContent = 'ABANDONAR PARTIDA'; }, 3000);
  };

  function pintarSala() {
    $('t-codigo').textContent = codigo;
    $('a-whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(`⚓ ¡Te reto a CONECTI NAVAL BATTLE! Entra aquí: ${enlace()} (sala ${codigo})`);
    UI.jugadores(st, yo);
    const r = st.players[rival()], meListo = st.players[yo] && st.players[yo].ready;
    $('b-listo').textContent = meListo ? 'CANCELAR LISTO' : '¡ESTOY LISTO!';
    let msg;
    if (!r || r.left) msg = `¡Comparte el código ${codigo} con tu rival! Yo te aviso cuando llegue.`;
    else if (!r.connected) msg = `${r.name} se desconectó. Lo esperamos un momento…`;
    else if (!meListo) msg = `¡Llegó ${r.name}! Presiona ESTOY LISTO cuando quieras zarpar.`;
    else if (!r.ready) msg = `Esperando a que ${r.name} esté listo…`;
    else msg = '¡Todos listos! Zarpamos…';
    UI.conecti('cp-sala', msg, { color: miColor(), pose: meListo ? 'cheer' : 'idle' });
  }

  // ---------------- Combate: controles (turnos simultáneos) ----------------
  const fase = () => {
    if (!st || yo === null) return null;
    if (st.phase === 'MOVEMENT' && !st.moved[yo]) return 'move';
    if (st.phase === 'AIMING' && !st.locked[yo] && !disparoEnVuelo) return 'aim';
    return null;
  };
  let ultimoSonidoMotor = 0;
  function paso(dir) {
    if (fase() !== 'move' || st.ships[yo].moveLeft <= 0) return;
    NET.send('move', { dx: dir * 2 });
    const ahora = performance.now();
    if (ahora - ultimoSonidoMotor > 140) { A.play('move'); ultimoSonidoMotor = ahora; }
  }
  const confirmar = () => { if (fase() === 'move') { A.play('click'); NET.request('endMove', {}); } };
  // La mira es SECRETA: no se envía al rival; solo se manda al disparar.
  function setMira(cambios) {
    aimLocal = { ...aimLocal, ...cambios };
    aimLocal.angle = Math.max(C.ANGLE_MIN, Math.min(C.ANGLE_MAX, Math.round(aimLocal.angle)));
    aimLocal.power = Math.max(C.POWER_MIN, Math.min(C.POWER_MAX, Math.round(aimLocal.power)));
    $('r-angulo').value = aimLocal.angle; $('o-angulo').textContent = aimLocal.angle + '°';
    $('r-potencia').value = aimLocal.power; $('o-potencia').textContent = aimLocal.power + '%';
    document.querySelectorAll('.proy').forEach(b => b.setAttribute('aria-checked', String(b.dataset.p === aimLocal.projectile)));
  }
  async function disparar() {
    if (fase() !== 'aim') return;
    disparoEnVuelo = true; $('b-disparar').disabled = true;
    A.play('click');
    const r = await NET.request('fire', aimLocal);
    if (!r.ok) { disparoEnVuelo = false; UI.toast(r.error || 'No se pudo disparar.'); pintarControles(); return; }
    rJuego.pose(yo, 'cheer', 900);
    decir(`¡Cañón cargado! Tu disparo saldrá junto con el de ${nombre(rival())}.`, { reaccion: 'salta', pose: 'cheer' });
  }
  const ctl = window.CONTROLS.create({
    phase: fase, step: paso, confirm: confirmar, fire: disparar,
    angle: d => setMira({ angle: aimLocal.angle + d }), power: d => setMira({ power: aimLocal.power + d }),
    projectile: p => { A.play('click'); setMira({ projectile: p }); },
  });
  ctl.mantener($('b-izq'), () => paso(-1));
  ctl.mantener($('b-der'), () => paso(1));
  ctl.mantener($('b-ang-menos'), () => setMira({ angle: aimLocal.angle - 1 }));
  ctl.mantener($('b-ang-mas'), () => setMira({ angle: aimLocal.angle + 1 }));
  ctl.mantener($('b-pot-menos'), () => setMira({ power: aimLocal.power - 1 }));
  ctl.mantener($('b-pot-mas'), () => setMira({ power: aimLocal.power + 1 }));
  $('b-confirmar').onclick = confirmar;
  $('b-disparar').onclick = disparar;
  $('r-angulo').oninput = e => setMira({ angle: +e.target.value });
  $('r-potencia').oninput = e => setMira({ power: +e.target.value });
  document.querySelectorAll('.proy').forEach(b => {
    const cv = b.querySelector('canvas'), ico = window.RENDERER.iconoSprite(b.dataset.p);
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(ico, 0, 0);
    b.onclick = () => { A.play('click'); setMira({ projectile: b.dataset.p }); };
  });
  setMira({});

  function pintarControles() {
    const f = fase(), r = rival();
    $('ctl-mover').hidden = f !== 'move';
    $('ctl-apuntar').hidden = !(st && st.phase === 'AIMING' && !st.locked[yo]);
    $('ctl-espera').hidden = !$('ctl-mover').hidden || !$('ctl-apuntar').hidden;
    $('b-disparar').disabled = f !== 'aim';
    if (f === 'move') {
      const left = st.ships[yo].moveLeft;
      $('motor-barra').style.width = (left / C.MOVE_BUDGET * 100) + '%';
      $('motor-txt').textContent = `${left}/${C.MOVE_BUDGET}`;
      $('b-izq').disabled = $('b-der').disabled = left <= 0;
    }
    if (!st) return;
    const espera = {
      WAITING: '¡Prepárate! La batalla empieza en un instante…',
      MOVEMENT: `Barco en posición. Esperando a que ${nombre(r)} termine de moverse…`,
      AIMING: `¡Disparo listo! Esperando el disparo de ${nombre(r)}${st.locked[r] ? ' (¡ya disparó!)' : '…'}`,
      PROJECTILE: '¡Los dos proyectiles están en el aire!',
      RESOLUTION: 'Contando los daños…',
      NEXT_TURN: 'Preparando la siguiente ronda…',
      PAUSED: 'Partida en pausa.',
      GAME_OVER: 'Fin de la batalla.',
    };
    $('t-espera').textContent = espera[st.phase] || 'Observa el mar…';
  }

  // ---------------- Mensajes de Conecti en combate ----------------
  const decir = (txt, opts = {}) => UI.conecti('cp-juego', txt, { color: miColor(), ...opts });
  const ZONA = { proa: 'la proa', popa: 'la popa', centro: 'el centro' };
  let rivalListoAviso = '';

  function alCambiarFase() {
    const clave = `${st.match}-${st.phase}-${st.round}`;
    // Aviso cuando el rival ya fijó su disparo y tú todavía no
    const r = rival();
    if (st.phase === 'AIMING' && st.locked[r] && !st.locked[yo] && rivalListoAviso !== clave) {
      rivalListoAviso = clave; A.play('alert');
      decir(`¡${nombre(r)} ya disparó! Apura tu tiro antes de que se acabe el tiempo.`, { reaccion: 'tiembla', pose: 'point' });
    }
    if (clave === ultimaClave) return;
    ultimaClave = clave;
    switch (st.phase) {
      case 'WAITING':
        rJuego.reset(); modelo.sinking = null; modelo.sinkT = 0; modelo.winner = null; disparoEnVuelo = false; revanchaPedida = false;
        modelo.ships.forEach((s, i) => { s.x = st.ships[i].x; });
        A.play('start');
        rJuego.banner('¡A LOS CAÑONES!', '#FFD84A', 2200);
        decir('¡Capitán, prepara tu barco! Esta vez los dos atacan al mismo tiempo.', { reaccion: 'salta', pose: 'cheer' });
        break;
      case 'MOVEMENT':
        disparoEnVuelo = false;
        A.play('turn'); rJuego.banner(`RONDA ${st.round}`, '#FFD84A', 1100);
        decir(`¡A moverse! Los dos se mueven a la vez: tienes ${C.MOVE_BUDGET} pasos de motor y 15 segundos.`, { reaccion: 'salta' });
        break;
      case 'AIMING':
        disparoEnVuelo = false; setMira({});
        rJuego.banner('¡APUNTEN!', '#FFD84A', 1000);
        decir('¡Ajusta tu cañón! Tu disparo es secreto hasta que disparen los dos.', { pose: 'point' });
        break;
      case 'PAUSED': {
        const p = st.players.findIndex(x => x && !x.connected);
        decir(`${nombre(p)} se desconectó. Lo esperamos unos segundos…`, { pose: 'sad' });
        break;
      }
      case 'GAME_OVER': {
        const empate = st.winner === null && st.reason === 'empate', gane = st.winner === yo;
        A.play(gane ? 'win' : 'lose');
        modelo.winner = st.winner;
        modelo.sinking = empate ? 'ambos' : st.reason === 'hp' ? 1 - st.winner : null; modelo.sinkT = 0;
        rJuego.banner(empate ? '¡EMPATE!' : gane ? '¡CONECTI DOMINA EL MAR!' : '¡VOLVEREMOS MÁS FUERTES!', gane || empate ? '#FFD84A' : '#9FC3FF', 2600);
        if (gane) for (let i = 0; i < 4; i++) setTimeout(() => rJuego.explosion(60 + Math.random() * 360, 40 + Math.random() * 60, false), 300 + i * 350);
        decir(empate ? '¡Empate! Los dos barcos se hundieron a la vez. ¡Pidan la revancha!'
          : gane ? (st.reason === 'abandono' ? `${nombre(rival())} abandonó la partida. ¡Victoria para Conecti!` : '¡Victoria para Conecti! ¡Dominamos el mar!')
          : '¡Volveremos más fuertes! Pide la revancha.', { reaccion: gane ? 'salta' : 'tiembla', pose: gane ? 'cheer' : 'sad' });
        break;
      }
    }
  }

  function resultadoDisparo(p) {
    const imp = p.impact, mio = p.shooter === yo, x = imp.x, y = imp.y;
    if (imp.type === 'hull') {
      const crit = imp.damage >= C.DAMAGE_CRIT;
      rJuego.explosion(x, y, crit);
      rJuego.texto('-' + imp.damage, x, y - 14, crit ? '#FF4D5E' : '#FFD84A');
      rJuego.golpe(imp.target); rJuego.pose(imp.target, 'hit', 1300);
      A.play(crit ? 'impact' : 'armor');
      rJuego.banner(crit ? '¡IMPACTO CRÍTICO!' : '¡BLINDAJE RESISTENTE!', crit ? '#FF4D5E' : '#FFD84A', 1400);
      const z = ZONA[imp.zone];
      if (imp.self) decir(mio ? `¡Uy! Te diste a ti mismo en ${z}. −${imp.damage} HP` : `¡${nombre(p.shooter)} se disparó a sí mismo en ${z}!`, { reaccion: mio ? 'tiembla' : 'salta', pose: mio ? 'hit' : 'cheer' });
      else if (mio) decir(crit ? `¡Impacto crítico en ${z}! −${imp.damage} HP. ¡Buen disparo!` : `¡Blindaje resistente! Le diste en el centro: −${imp.damage} HP.`, { reaccion: 'salta', pose: 'cheer' });
      else decir(crit ? `¡Nos dieron en ${z}! −${imp.damage} HP. ¡Hay que responder!` : `¡Nuestro blindaje aguantó! Solo −${imp.damage} HP.`, { reaccion: 'tiembla', pose: 'hit' });
    } else if (imp.type === 'water') {
      rJuego.salpicadura(x); A.play('splash');
      rJuego.banner('¡AL AGUA!', '#9BD8FF', 1200);
      decir(mio ? '¡Al agua! Ajusta el ángulo o la potencia.' : '¡El enemigo ha fallado!', { reaccion: mio ? 'tiembla' : 'salta' });
    } else {
      rJuego.banner('¡DISPARO FALLIDO!', '#9FC3FF', 1200); A.play('splash');
      decir(mio ? '¡Disparo fallido! Se fue fuera del mar.' : `¡${nombre(p.shooter)} disparó fuera del mar!`);
    }
  }

  // ---------------- Fin de partida ----------------
  function pintarFin() {
    const ov = $('ov-fin');
    if (!st || st.phase !== 'GAME_OVER') { ov.hidden = true; return; }
    const empate = st.winner === null, gane = st.winner === yo, r = st.players[rival()];
    ov.hidden = false;
    ov.classList.toggle('gana', gane || empate); ov.classList.toggle('pierde', !gane && !empate);
    $('fin-titulo').textContent = empate ? '¡EMPATE!' : gane ? '¡VICTORIA NAVAL!' : '¡VOLVEREMOS MÁS FUERTES!';
    $('fin-titulo').classList.toggle('tilde', /[ÁÉÍÓÚÑ]/.test($('fin-titulo').textContent));
    $('fin-texto').textContent = empate ? 'Los dos barcos se hundieron en la misma ronda. ¡Nadie domina el mar… todavía!'
      : gane ? `Ganó ${nombre(yo)}${st.reason === 'abandono' ? ' (el rival abandonó)' : ''}. ¡Conecti domina el mar!`
      : `Ganó ${nombre(st.winner)}. Tu barco se hundió, pero Conecti no se rinde.`;
    UI.sprite($('c-fin'), gane ? 'cheer' : empate ? 'idle' : 'sad', miColor()); $('c-fin').style.width = '';
    const rivalSeFue = !r || r.left;
    const rivalPide = r && r.rematch && !rivalSeFue;
    $('b-revancha').disabled = rivalSeFue || (st.players[yo] && st.players[yo].rematch);
    $('b-revancha').textContent = st.players[yo] && st.players[yo].rematch ? 'ESPERANDO AL RIVAL…' : 'SOLICITAR REVANCHA';
    $('fin-nota').textContent = rivalSeFue ? 'Tu rival se fue. Copia el enlace e invita a otro: entrará a esta misma sala.'
      : !r.connected ? `${r.name} se desconectó. Si vuelve pronto, pueden jugar la revancha.`
      : rivalPide ? `¡${r.name} quiere la revancha!` : '';
  }

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
  // Solo en la versión sin servidor (Firebase): el anfitrión lleva la partida en su navegador
  NET.on('hostAway', fuera => { if (codigo && fuera) { UI.toast('El anfitrión perdió la conexión. Esperando…'); decir('El anfitrión se desconectó. Si vuelve pronto, seguimos.', { pose: 'sad' }); } else if (codigo && fuera === false) UI.toast('¡El anfitrión volvió!'); });
  NET.on('closed', () => { if (!codigo) return; NET.session.clear(); codigo = null; yo = null; st = null; rJuego.reset(); UI.toast('El anfitrión cerró la sala.'); try { history.replaceState(null, '', BASE); } catch (e) {} UI.show('s-inicio'); });

  NET.on('state', s => {
    if (!codigo || s.code !== codigo) return;
    offset = s.serverNow - Date.now();
    st = s;
    st.moved = st.moved || [false, false]; st.locked = st.locked || [false, false];
    NET.session.touch();
    if (s.phase === 'LOBBY') { UI.show('s-sala'); pintarSala(); return; }
    if ($('s-juego').hidden) { UI.show('s-juego'); modelo.ships.forEach((sh, i) => { sh.x = s.ships[i].x; }); }
    UI.hud(s, yo);
    alCambiarFase();
    pintarControles(); pintarFin(); pintarPausa();
  });
  // Los dos disparos salen juntos
  NET.on('shots', p => {
    if (!st) return;
    const shots = p.shots || [], missed = p.missed || [];
    for (const sh of shots) {
      st.aim[sh.shooter] = { angle: sh.angle, power: sh.power, projectile: sh.projectile };
      rJuego.pose(sh.shooter, 'cheer', 1000);
      rJuego.disparo(sh, () => resultadoDisparo(sh));
    }
    if (shots.length) { A.play('fire'); A.play('whistle', Math.max(...shots.map(x => x.flightMs))); }
    if (shots.length === 2) { rJuego.banner('¡FUEGO CRUZADO!', '#FF9A2E', 1100); decir('¡Fuego! Los dos proyectiles están en el aire…', { reaccion: 'salta', pose: 'cheer' }); }
    else if (missed.includes(yo) && missed.length === 2) { rJuego.banner('¡TIEMPO!', '#FF4D5E', 1200); A.play('alert'); decir('¡Nadie disparó a tiempo! Siguiente ronda.', { pose: 'sad' }); }
    else if (missed.includes(yo)) { rJuego.banner('¡TIEMPO!', '#FF4D5E', 1200); A.play('alert'); decir('¡Se acabó el tiempo! Perdiste tu disparo de esta ronda.', { reaccion: 'tiembla', pose: 'sad' }); }
    else if (missed.length) decir(`¡${nombre(rival())} no disparó a tiempo! Solo vuela tu proyectil.`, { reaccion: 'salta', pose: 'cheer' });
    pintarControles();
  });
  NET.on('resolution', r => { if (st) r.hp.forEach((h, i) => { st.ships[i].hp = h; }); UI.hud(st, yo); });

  // ---------------- Bucle de dibujo ----------------
  function actualizarModelo(dt) {
    if (!st) return;
    st.players.forEach((p, i) => {
      if (!p) return;
      modelo.colores[i] = { ship: C.COLORS[p.ship], conecti: C.COLORS[p.conecti] };
      modelo.nombres[i] = (i === yo ? 'TÚ' : p.name).slice(0, 10);
    });
    modelo.ships.forEach((s, i) => {
      const meta = st.ships[i].x, d = meta - s.x, v = 70 * dt;
      s.x = Math.abs(d) <= v ? meta : s.x + Math.sign(d) * v;
      s.hp = st.ships[i].hp;
    });
    const enRonda = ['MOVEMENT', 'AIMING'].includes(st.phase);
    modelo.turn = -1; modelo.enJuego = enRonda;
    modelo.listos = st.phase === 'MOVEMENT' ? st.moved : st.phase === 'AIMING' ? st.locked : [false, false];
    modelo.decidiendo = [0, 1].map(i => enRonda && !modelo.listos[i]);
    // Tu cañón muestra tu mira (solo en tu pantalla); el del rival, su último disparo ya lanzado
    modelo.aim = [0, 1].map(i => (i === yo && st.phase === 'AIMING' ? aimLocal : st.aim[i]));
    modelo.moveHint = fase() === 'move' ? { slot: yo, min: C.ZONES[yo][0], max: C.ZONES[yo][1], x: st.ships[yo].x, left: st.ships[yo].moveLeft } : null;
    modelo.aimGuide = fase() === 'aim' ? yo : null;
    modelo.poseBase = [0, 1].map(i => {
      if (st.phase === 'GAME_OVER') return i === st.winner ? 'cheer' : 'sad';
      if (st.phase === 'AIMING') return st.locked[i] ? 'cheer' : 'point';
      return null;
    });
  }

  function reloj() {
    const el = $('hud-reloj'), t = $('hud-turno');
    if (!st) return;
    const etiquetas = { WAITING: '¡A ZARPAR!', PROJECTILE: '¡FUEGO!', RESOLUTION: 'DAÑOS', PAUSED: 'PAUSA', GAME_OVER: 'FIN', NEXT_TURN: '…' };
    if (st.phase === 'MOVEMENT') t.textContent = `RONDA ${st.round} · ${st.moved[yo] ? 'ESPERANDO' : 'MOVIMIENTO'}`;
    else if (st.phase === 'AIMING') t.textContent = `RONDA ${st.round} · ${st.locked[yo] ? 'LISTO' : 'ATAQUE'}`;
    else t.textContent = etiquetas[st.phase] || '';
    let seg = '';
    if (st.phaseEndsAt && ['MOVEMENT', 'AIMING', 'WAITING'].includes(st.phase)) {
      const s = Math.max(0, Math.ceil((st.phaseEndsAt - ahoraServidor()) / 1000));
      seg = String(s).padStart(2, '0');
      const urgente = s <= 5 && st.phase !== 'WAITING';
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
        demo.aim[0].angle = 45 + Math.sin(ahora / 900) * 15;
        demo.aim[1].angle = 45 + Math.cos(ahora / 1100) * 15;
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
  window.__debug = () => ({ yo, codigo, phase: st && st.phase, round: st && st.round, moved: st && st.moved, locked: st && st.locked, ships: st ? st.ships.map(s => ({ x: s.x, hp: s.hp, moveLeft: s.moveLeft })) : [] });

  // ---------------- Arranque ----------------
  const salaURL = new URLSearchParams(location.search).get('sala');
  const ses = NET.session.get();
  if (ses && (!salaURL || salaURL.toUpperCase() === ses.code)) {
    codigo = ses.code;                     // intentará recuperar el lugar al conectar
    UI.conecti('cp-sala', 'Recuperando tu partida…', { color: perfil.conecti });
  } else if (salaURL) {
    $('f-unirse').hidden = false; $('i-codigo').value = salaURL.toUpperCase().slice(0, 8);
    $('e-inicio').textContent = 'Elige tu nombre y colores, y toca ENTRAR.';
  }
  UI.show('s-inicio');
})();
