/*
 * Contador anónimo de visitas y partidas de los juegos de Conecti (sin datos personales).
 * Suma +1 en Firebase (salas/STATS) con la API REST: no necesita cargar Firebase.
 *   salas/STATS/t/<juego>/{v,p}          total histórico
 *   salas/STATS/d/<AAMMDD>/<juego>/{v,p}  por día (hora de Lima)
 * v = visitas (una por pestaña cada 30 min) · p = partidas iniciadas
 */
(function (root) {
  var URL = 'https://connect-juegos-4be1b-default-rtdb.firebaseio.com/salas/STATS.json';
  var local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);   // las pruebas no ensucian los números
  function dia() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()).replace(/-/g, '').slice(2); }
    catch (e) { var d = new Date(Date.now() - 5 * 3600 * 1000); return d.toISOString().slice(2, 10).replace(/-/g, ''); }
  }
  function sumar(juego, campo) {
    if (local) return;
    var inc = { '.sv': { increment: 1 } }, cuerpo = {};
    cuerpo['t/' + juego + '/' + campo] = inc;
    cuerpo['d/' + dia() + '/' + juego + '/' + campo] = inc;
    try { fetch(URL, { method: 'PATCH', body: JSON.stringify(cuerpo), keepalive: true }).catch(function () {}); } catch (e) {}
  }
  root.CNSTATS = {
    visita: function (juego) {
      try {
        var k = 'cn-visita-' + juego, t = +sessionStorage.getItem(k) || 0;
        if (Date.now() - t < 30 * 60 * 1000) return;
        sessionStorage.setItem(k, String(Date.now()));
      } catch (e) {}
      sumar(juego, 'v');
    },
    partida: function (juego) { sumar(juego, 'p'); },
  };
})(window);
