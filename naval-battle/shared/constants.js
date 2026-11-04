/*
 * Constantes compartidas entre servidor (require) y navegador (window.CNB).
 * Todo el mundo del juego usa coordenadas lógicas de 480 × 270 px:
 * x crece hacia la derecha, y crece hacia abajo.
 */
(function (root) {
  const C = {
    WIDTH: 480,
    HEIGHT: 270,
    SEA_Y: 206,              // nivel del mar (lo que toca esta línea cae al agua)

    // Barco
    HULL_W: 64,              // largo del casco
    HULL_TOP: 194,           // cubierta (borde superior del casco)
    HULL_BOTTOM: 210,        // quilla visible (un poco bajo el agua)
    START_X: [92, 388],      // centro inicial de cada barco
    ZONES: [[40, 200], [280, 440]], // límites del CENTRO de cada barco (nunca se tocan: 232 < 248)
    FACING: [1, -1],         // jugador 0 mira a la derecha, jugador 1 a la izquierda
    MAX_HP: 100,

    // Cañón (pivote relativo al centro del barco, en el sentido en que mira)
    CANNON_PIVOT_DX: 10,
    CANNON_PIVOT_Y: 186,
    CANNON_LEN: 14,

    // Movimiento
    MOVE_BUDGET: 24,         // píxeles lógicos por turno (distancia absoluta)
    MOVE_STEP_MAX: 4,        // máximo por mensaje

    // Disparo
    ANGLE_MIN: 15, ANGLE_MAX: 80,
    POWER_MIN: 20, POWER_MAX: 100,
    V_MAX: 235,              // px/s a potencia 100 %
    GRAVITY: 120,            // px/s²
    PHYS_HZ: 60,             // paso fijo de la simulación
    PROJECTILE_R: 3,
    SELF_HIT_GRACE: 12,      // pasos en que el proyectil ignora el propio barco al salir
    MAX_FLIGHT_S: 14,
    PATH_EVERY: 2,           // se envía 1 de cada N pasos al cliente (30 puntos/s)

    // Daño por zona del casco (en coordenadas locales: 0 = popa, 1 = proa)
    DAMAGE_CRIT: 20,
    DAMAGE_ARMOR: 8,

    // Tiempos (ms) — el servidor los puede sobrescribir con variables de entorno
    MOVE_MS: 15000,
    AIM_MS: 20000,
    RESOLUTION_MS: 1800,
    START_DELAY_MS: 2500,
    RECONNECT_MS: 30000,
    EMPTY_ROOM_MS: 60000,

    COLORS: {
      morado: '#8A2BE2',
      azul: '#00BFFF',
      verde: '#32CD32',
    },
    PROJECTILES: ['tiktok', 'instagram'],
    NAME_MAX: 14,

    PHASES: ['WAITING', 'MOVEMENT', 'AIMING', 'PROJECTILE', 'RESOLUTION', 'NEXT_TURN', 'GAME_OVER', 'PAUSED'],
  };
  C.COLOR_KEYS = Object.keys(C.COLORS);
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  else root.CNB = C;
})(typeof window !== 'undefined' ? window : this);
