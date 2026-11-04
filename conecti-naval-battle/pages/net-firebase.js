/*
 * Versión para GitHub Pages (sin servidor propio): mismo NET que network.js, pero por Firebase.
 *
 * El navegador que CREA la sala (anfitrión) ejecuta el mismo motor del servidor
 * (server/rooms.js, turns.js, physics.js… empaquetados en engine-bundle.js) y es la
 * autoridad de la partida. El invitado solo envía intenciones y recibe estado y eventos.
 *
 *   salas/N<XXXX> = { tipo:'battle', creado, host:{on}, guest:{name,conecti,ship,token,on},
 *                     state:{…público…}, events:{e000001:{ev,p}}, intents:{<id>:{ev,p}}, replies:{<id>:{…}} }
 */
(function (root) {
  const FIREBASE = {
    apiKey: "AIzaSyDoilyRBvsKCh3alD0nEJsMuitR89Q2Anc",
    authDomain: "connect-juegos-4be1b.firebaseapp.com",
    databaseURL: "https://connect-juegos-4be1b-default-rtdb.firebaseio.com",
    projectId: "connect-juegos-4be1b",
    storageBucket: "connect-juegos-4be1b.firebasestorage.app",
    messagingSenderId: "23629421007",
    appId: "1:23629421007:web:e3b200ebf1beaa710adaba",
  };
  const KEY = 'cnb-session-fb';
  const ENG = root.CNB_ENGINE;              // motor del servidor empaquetado
  const V = ENG.validation;
  let db = null;
  try { firebase.initializeApp(FIREBASE); db = firebase.database(); } catch (e) { console.error(e); }

  const handlers = {};
  let ultimoEstado = null;
  const dispatch = (ev, p) => {
    if (ev === 'state') ultimoEstado = p;
    (handlers[ev] || []).forEach(fn => { try { fn(p); } catch (e) { console.error(e); } });
  };
  const keyDe = code => 'N' + code.slice(4);      // CNX-K7P2 → NK7P2 (las reglas de Firebase aceptan 4–6 caracteres)
  const rnd = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
  const nuevoToken = () => Array.from(rnd(24), b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');

  // Sesión: la del anfitrión vive solo en SU pestaña (sessionStorage sobrevive a recargar pero no a otra pestaña);
  // la del invitado en localStorage, para volver aunque cierre el navegador.
  const leerDe = st => { try { const s = JSON.parse(st.getItem(KEY)); return s && s.code && s.token && Date.now() - s.t < 10 * 60 * 1000 ? s : null; } catch (e) { return null; } };
  const session = {
    get() { return leerDe(sessionStorage) || leerDe(localStorage); },
    set(code, token, rol) {
      rol = rol || (session.get() || {}).rol;
      const v = JSON.stringify({ code, token, rol, t: Date.now() });
      try { (rol === 'host' ? sessionStorage : localStorage).setItem(KEY, v); } catch (e) {}
    },
    touch() { const s = session.get(); if (s) session.set(s.code, s.token, s.rol); },
    clear() { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch (e) {} },
  };

  // ======================= ANFITRIÓN =======================
  let host = null;   // { code, ref, rooms, seq, guestToken, guestConocido }
  function crearAnfitrion(code, ref) {
    const h = { code, ref, seq: 0, guestToken: null, guestConocido: false, limiter: V.createRateLimiter({ capacity: 30, refillPerSec: 20, minIntervals: { move: 35, aim: 45, fire: 500 } }) };
    h.rooms = ENG.rooms.createRoomManager({
      emit: (room, ev, p) => {
        dispatch(ev, p);
        const k = 'e' + String(++h.seq).padStart(7, '0');
        ref.child('events/' + k).set({ ev, p: limpiar(p) });
        if (h.seq > 25) ref.child('events/e' + String(h.seq - 25).padStart(7, '0')).remove();
      },
      sync: (room, snap) => {
        dispatch('state', snap);
        ref.child('state').set(limpiar(snap));
        // Si el lugar del invitado quedó libre (salió o no volvió a tiempo), se libera en Firebase
        const g = room.players[1];
        if (h.guestConocido && (!g || g.left)) { h.guestConocido = false; h.guestToken = null; ref.child('guest').remove(); }
      },
    });
    return h;
  }
  const limpiar = v => JSON.parse(JSON.stringify(v === undefined ? null : v));

  /** Lo mismo que hace server.js con cada evento: validar y pasar al motor. */
  function manejar(h, sid, ev, p) {
    const R = h.rooms, ctx = R.context(sid);
    switch (ev) {
      case 'ready': return { ok: R.setReady(sid, !!(p && p.ready)) };
      case 'move': { const dx = V.moveStep(p); if (!ctx || dx === null) return { ok: false }; return { ok: true, moved: R.engine.move(ctx.room, ctx.slot, dx) }; }
      case 'endMove': return { ok: !!ctx && R.engine.confirmMove(ctx.room, ctx.slot) };
      case 'aim': { const a = V.aim(p); if (!ctx || !a) return { ok: false }; return { ok: R.engine.setAim(ctx.room, ctx.slot, a) }; }
      case 'fire': { const a = V.aim(p); if (!ctx || !a) return { ok: false, error: 'Disparo no válido.' }; const ok = R.engine.fire(ctx.room, ctx.slot, a); return ok ? { ok } : { ok, error: 'Ahora no puedes disparar.' }; }
      case 'rematch': return { ok: !!ctx && R.engine.requestRematch(ctx.room, ctx.slot) };
      case 'leave': R.leave(sid); return { ok: true };
      default: return { ok: false, error: 'Acción desconocida.' };
    }
  }

  function escucharComoAnfitrion(h) {
    const presencia = h.ref.child('host/on');
    db.ref('.info/connected').on('value', s => { if (s.val() === true) { presencia.onDisconnect().set(false); presencia.set(true); } });
    // Llega, se va o vuelve el invitado
    h.ref.child('guest').on('value', s => {
      const g = s.val(), room = h.rooms.rooms.get(h.code);
      if (!room || !g) return;
      if (!h.guestConocido) {
        const prof = V.profile(g);
        if (!prof || typeof g.token !== 'string') return;
        const r = h.rooms.joinRoom(h.code, prof, 'guest');
        if (r.error) { h.ref.child('guest').remove(); return; }
        h.guestConocido = true; h.guestToken = g.token;
        return;
      }
      const p = room.players[1];
      if (!p) return;
      if (g.on === false && p.connected) h.rooms.disconnect('guest');
      else if (g.on === true && !p.connected && !p.left) h.rooms.resumeRoom(h.code, p.token, 'guest');
    });
    // Intenciones del invitado
    h.ref.child('intents').on('child_added', s => {
      const it = s.val(), id = s.key;
      s.ref.remove();
      if (!it || typeof it.ev !== 'string') return;
      const res = h.limiter(it.ev) ? manejar(h, 'guest', it.ev, it.p) : { ok: false, error: 'Vas muy rápido. Espera un momento.' };
      if (it.r) h.ref.child('replies/' + id).set(limpiar(res));
    });
  }

  // ======================= INVITADO =======================
  let guest = null;  // { code, ref, token }
  function escucharComoInvitado(g) {
    const presencia = g.ref.child('guest/on');
    db.ref('.info/connected').on('value', s => { if (s.val() === true && guest) { presencia.onDisconnect().set(false); presencia.set(true); } });
    g.ref.child('state').on('value', s => {
      const st = s.val();
      if (st) dispatch('state', normalizar(st));
    });
    g.ref.child('host/on').on('value', s => { if (s.val() === false) dispatch('hostAway', true); else if (s.val() === true) dispatch('hostAway', false); });
    g.ref.on('value', s => { if (!s.exists() && guest) { dispatch('closed', true); } });
    g.ref.child('events').orderByKey().startAt('e' + String(g.desde).padStart(7, '0')).on('child_added', s => {
      const e = s.val(); if (e && e.ev) dispatch(e.ev, e.p);
    });
  }
  /** Firebase quita valores null y convierte objetos a listas: se devuelve la forma original. */
  function normalizar(st) {
    st.players = [0, 1].map(i => (st.players && st.players[i]) || null);
    st.ships = [0, 1].map(i => st.ships[i]);
    st.aim = [0, 1].map(i => st.aim[i]);
    ['pausedPhase', 'winner', 'reason'].forEach(k => { if (st[k] === undefined) st[k] = null; });
    return st;
  }
  function enviarComoInvitado(ev, p, conRespuesta) {
    const ref = guest.ref.child('intents').push();
    const id = ref.key;
    ref.set({ ev, p: limpiar(p), r: conRespuesta ? 1 : 0 });
    if (!conRespuesta) return Promise.resolve({ ok: true });
    return new Promise(resolve => {
      const rr = guest.ref.child('replies/' + id);
      const t = setTimeout(() => { rr.off(); resolve({ ok: false, error: 'El anfitrión no respondió.' }); }, 6000);
      rr.on('value', s => { const v = s.val(); if (v) { clearTimeout(t); rr.off(); rr.remove(); resolve(v); } });
    });
  }

  // ======================= API común =======================
  async function crear(p) {
    const prof = V.profile(p); if (!prof) return { ok: false, error: 'Datos de jugador no válidos.' };
    for (let i = 0; i < 6; i++) {
      const code = ENG.rooms.genCode(), ref = db.ref('salas/' + keyDe(code));
      const r = await ref.transaction(a => (a === null ? { tipo: 'battle', creado: firebase.database.ServerValue.TIMESTAMP, host: { on: true } } : undefined));
      if (!r.committed) continue;
      host = crearAnfitrion(code, ref);
      // El motor genera su propio código: se reemplaza por el reservado en Firebase
      const res = host.rooms.createRoom(prof, 'host');
      const room = res.room; host.rooms.rooms.delete(room.code); room.code = code; host.rooms.rooms.set(code, room);
      host.rooms.bySocket.set('host', { code, slot: 0 });
      const snap = ENG.gameState.publicState(room);
      ultimoEstado = snap; ref.child('state').set(limpiar(snap));
      escucharComoAnfitrion(host);
      session.set(code, res.token, 'host');
      return { ok: true, code, slot: 0, token: res.token };
    }
    return { ok: false, error: 'No se pudo crear la sala.' };
  }

  async function unirse(p) {
    const prof = V.profile(p), code = V.roomCode(p && p.code);
    if (!prof) return { ok: false, error: 'Datos de jugador no válidos.' };
    if (!code) return { ok: false, error: 'El código no es válido. Tiene la forma CNX-ABCD.' };
    const ref = db.ref('salas/' + keyDe(code));
    const snap = await ref.once('value'), v = snap.val();
    if (!v || v.tipo !== 'battle') return { ok: false, error: 'Esa sala no existe. Revisa el código.' };
    if (v.host && v.host.on === false) return { ok: false, error: 'El anfitrión no está conectado.' };
    const token = nuevoToken();
    const r = await ref.child('guest').transaction(a => (a === null ? { ...prof, token, on: true } : undefined));
    if (!r.committed) return { ok: false, error: 'Esa sala ya está llena.' };
    const ultimo = Object.keys(v.events || {}).sort().pop();
    guest = { code, ref, token, desde: ultimo ? parseInt(ultimo.slice(1), 10) + 1 : 0 };
    // Esperar a que el anfitrión lo acepte en su motor
    const ok = await new Promise(resolve => {
      const t = setTimeout(() => { ref.child('state').off('value', f); resolve(false); }, 8000);
      const f = s => { const st = s.val(); if (st && st.players && st.players[1] && st.players[1].name === prof.name) { clearTimeout(t); ref.child('state').off('value', f); resolve(true); } };
      ref.child('state').on('value', f);
    });
    if (!ok) { ref.child('guest').remove(); guest = null; return { ok: false, error: 'El anfitrión no respondió. Intenta otra vez.' }; }
    escucharComoInvitado(guest);
    session.set(code, token, 'guest');
    return { ok: true, code, slot: 1, token };
  }

  async function reanudar(p) {
    const ses = session.get();
    const code = V.roomCode(p && p.code);
    if (!ses || !code || ses.code !== code) return { ok: false, error: 'No se pudo recuperar la sesión.' };
    if (host && host.code === code) return { ok: true, code, slot: 0, token: ses.token };   // mismo navegador, Firebase se reconectó
    const ref = db.ref('salas/' + keyDe(code));
    const v = (await ref.once('value')).val();
    if (!v) return { ok: false, error: 'La sala ya no existe.' };
    if (ses.rol === 'host') {
      // El motor vivía en esta página: al recargarla, la partida no se puede recuperar.
      ref.remove();
      return { ok: false, error: 'Recargaste la página del anfitrión y la sala se cerró. Crea una nueva.' };
    }
    if (!v.guest || v.guest.token !== ses.token) return { ok: false, error: 'No se pudo recuperar tu lugar en la sala.' };
    const ultimo = Object.keys(v.events || {}).sort().pop();
    guest = { code, ref, token: ses.token, desde: ultimo ? parseInt(ultimo.slice(1), 10) + 1 : 0 };
    await ref.child('guest/on').set(true);
    escucharComoInvitado(guest);
    return { ok: true, code, slot: 1, token: ses.token };
  }

  async function salir() {
    if (host) {
      const h = host; host = null;
      manejar(h, 'host', 'leave', {});
      db.ref('.info/connected').off();
      const room = h.rooms.rooms.get(h.code);
      const enJuego = room && !['LOBBY', 'GAME_OVER'].includes(room.state.phase);
      // En la sala de espera se borra la sala; en una partida queda el resultado (gana el invitado por abandono)
      if (!enJuego && (!room || room.state.phase === 'LOBBY')) await h.ref.remove();
      else { await h.ref.child('host/on').set(false); setTimeout(() => h.ref.remove(), 15000); }
      h.ref.child('guest').off(); h.ref.child('intents').off();
      h.rooms.deleteRoom(h.code);
    } else if (guest) {
      const g = guest;
      await enviarComoInvitado('leave', {}, true);
      guest = null;
      g.ref.off(); g.ref.child('state').off(); g.ref.child('events').off(); g.ref.child('host/on').off();
      db.ref('.info/connected').off();
    }
    return { ok: true };
  }

  async function request(ev, p = {}) {
    if (!db) return { ok: false, error: 'No se pudo conectar. Revisa tu internet.' };
    try {
      if (ev === 'create' || ev === 'join' || ev === 'resume') {
        const r = await (ev === 'create' ? crear(p) : ev === 'join' ? unirse(p) : reanudar(p));
        // Igual que el servidor: después de responder se envía el estado actual
        if (r.ok) setTimeout(() => { if (ultimoEstado) dispatch('state', ultimoEstado); }, 30);
        return r;
      }
      if (ev === 'leave') return await salir();
      if (host) {
        const r = manejar(host, 'host', ev, p);
        return r;
      }
      if (guest) return await enviarComoInvitado(ev, p, true);
      return { ok: false, error: 'No estás en una sala.' };
    } catch (e) { console.error(e); return { ok: false, error: 'No se pudo conectar. Revisa tu internet.' }; }
  }
  function send(ev, p = {}) {
    if (host) manejar(host, 'host', ev, p);
    else if (guest) enviarComoInvitado(ev, p, false);
  }
  function on(ev, fn) {
    (handlers[ev] = handlers[ev] || []).push(fn);
    if (ev === 'connect' && db) setTimeout(() => fn(), 0);   // Firebase no necesita "conectar" antes de pedir
  }

  // Si el anfitrión está en la sala de espera y cierra, la sala se borra sola
  root.addEventListener('pagehide', () => { if (host) { const room = host.rooms.rooms.get(host.code); if (room && room.state.phase === 'LOBBY') host.ref.remove(); } });

  root.NET = { request, send, on, session, socket: null, modo: 'firebase' };
})(window);
