/*
 * Conexión con el servidor (Socket.io). Guarda la sesión (código + token) para
 * recuperar el lugar si se corta el internet o se recarga la página.
 */
(function (root) {
  const KEY = 'cnb-session';
  const socket = root.io({ reconnectionDelay: 800, reconnectionDelayMax: 4000, timeout: 8000 });

  const session = {
    get() {
      try {
        const s = JSON.parse(localStorage.getItem(KEY));
        return s && s.code && s.token && Date.now() - s.t < 10 * 60 * 1000 ? s : null;
      } catch (e) { return null; }
    },
    set(code, token) { try { localStorage.setItem(KEY, JSON.stringify({ code, token, t: Date.now() })); } catch (e) {} },
    touch() { const s = session.get(); if (s) session.set(s.code, s.token); },
    clear() { try { localStorage.removeItem(KEY); } catch (e) {} },
  };

  /** Envía un evento y espera la respuesta del servidor (con tiempo límite). */
  function request(event, payload = {}, ms = 6000) {
    return new Promise(resolve => {
      if (!socket.connected) return resolve({ ok: false, error: 'Sin conexión con el servidor.' });
      let listo = false;
      const t = setTimeout(() => { if (!listo) { listo = true; resolve({ ok: false, error: 'El servidor no respondió.' }); } }, ms);
      socket.emit(event, payload, res => { if (listo) return; listo = true; clearTimeout(t); resolve(res || { ok: false }); });
    });
  }

  /** Envío sin esperar respuesta (movimiento y mira, que van muy seguido). */
  function send(event, payload = {}) { if (socket.connected) socket.emit(event, payload, () => {}); }

  root.NET = { socket, request, send, session, on: (ev, fn) => socket.on(ev, fn) };
})(window);
