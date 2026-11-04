/*
 * Ranking semanal y torneos (lógica pura, compartida por el servidor y el navegador).
 *   - Ranking: 3 puntos por victoria, 1 por empate. Se reinicia cada semana (lunes).
 *   - Torneo: 4 u 8 capitanes, llaves eliminatorias. Cada partido se juega en una sala normal
 *     vinculada al torneo; al terminar, el ganador pasa solo a la siguiente ronda.
 */
(function (root) {
  const C = typeof module !== 'undefined' && module.exports ? require('./constants') : root.CNB;

  /** Semana ISO como "AASS" (ej. 2645 = año 2026, semana 45). */
  function semana(fecha = new Date()) {
    const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
    const dia = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dia);
    const inicio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const n = Math.ceil(((d - inicio) / 86400000 + 1) / 7);
    return String(d.getUTCFullYear()).slice(2) + String(n).padStart(2, '0');
  }

  /** Clave segura para un nombre (sin . # $ [ ] / que Firebase no acepta). */
  const claveNombre = n => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ_-]/g, '_').slice(0, 20) || 'capitan';

  /** Suma el resultado de una partida a la tabla { clave: {name, pts, v, e, d} }. */
  function sumarResultado(tabla, nombres, ganador) {
    nombres.forEach((name, i) => {
      if (!name) return;
      const k = claveNombre(name);
      const fila = tabla[k] || { name, pts: 0, v: 0, e: 0, d: 0 };
      fila.name = name;
      if (ganador === null) { fila.pts += C.POINTS.draw; fila.e += 1; }
      else if (ganador === i) { fila.pts += C.POINTS.win; fila.v += 1; }
      else { fila.pts += C.POINTS.loss; fila.d += 1; }
      tabla[k] = fila;
    });
    return tabla;
  }
  const top = (tabla, n = 10) => Object.values(tabla || {}).sort((a, b) => b.pts - a.pts || b.v - a.v || a.name.localeCompare(b.name)).slice(0, n);

  /** Crea las llaves de un torneo con 4 u 8 nombres (orden al azar). */
  function crearTorneo({ nombre, negocio = '', premio = '', jugadores }, random = Math.random) {
    const lista = jugadores.slice();
    for (let i = lista.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [lista[i], lista[j]] = [lista[j], lista[i]]; }
    const rondas = [];
    let n = lista.length / 2;
    rondas.push(Array.from({ length: n }, (_, m) => ({ a: lista[m * 2], b: lista[m * 2 + 1], ganador: null })));
    while (n > 1) { n /= 2; rondas.push(Array.from({ length: n }, () => ({ a: null, b: null, ganador: null }))); }
    return { tipo: 'torneo', nombre, negocio, premio, tam: lista.length, rondas, campeon: null };
  }

  /** Marca al ganador de un partido y lo pasa a la siguiente ronda. Devuelve true si cambió algo. */
  function ponerGanador(t, r, m, nombre) {
    const p = t.rondas[r] && t.rondas[r][m];
    if (!p || !p.a || !p.b || p.ganador) return false;
    const elegido = [p.a, p.b].find(x => claveNombre(x) === claveNombre(nombre));
    if (!elegido) return false;
    p.ganador = elegido;
    if (r + 1 < t.rondas.length) {
      const sig = t.rondas[r + 1][Math.floor(m / 2)];
      if (m % 2 === 0) sig.a = elegido; else sig.b = elegido;
    } else t.campeon = elegido;
    return true;
  }

  /** Ganador de la partida de una sala vinculada a un torneo, buscando su nombre en el partido. */
  function ganadorDeSala(t, r, m, nombresSala, ganadorSlot) {
    const p = t.rondas[r] && t.rondas[r][m];
    if (!p || ganadorSlot === null || ganadorSlot === undefined) return null;
    const nombre = nombresSala[ganadorSlot];
    return [p.a, p.b].find(x => x && claveNombre(x) === claveNombre(nombre)) || null;
  }

  const api = { semana, claveNombre, sumarResultado, top, crearTorneo, ponerGanador, ganadorDeSala };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CNB_EXTRAS = api;
})(typeof window !== 'undefined' ? window : this);
