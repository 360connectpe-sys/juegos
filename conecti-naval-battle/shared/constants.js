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
    ZONES: [[40, 190], [290, 440]], // límites del CENTRO de cada barco (dejan el centro del mar libre para las rocas)
    FACING: [1, -1],         // jugador 0 mira a la derecha, jugador 1 a la izquierda
    MAX_HP: 100,

    // Cañón (pivote relativo al centro del barco, en el sentido en que mira)
    CANNON_PIVOT_DX: 10,
    CANNON_PIVOT_Y: 186,
    CANNON_LEN: 14,

    // Movimiento (se planea en secreto y se revela junto con el disparo)
    MOVE_BUDGET: 24,         // desplazamiento máximo por ronda, en píxeles lógicos
    MOVE_STEP_MAX: 4,        // (compatibilidad) paso máximo de un movimiento suelto

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

    // Viento: aceleración horizontal (px/s²) que cambia cada ronda y desvía todos los disparos
    WIND_MAX: 26,

    // Rocas en el centro del mar (bloquean los tiros bajos). Se sortean al empezar cada partida.
    ROCKS_X: [222, 258],     // rango donde puede estar el centro de una roca
    ROCK_W: [10, 16],
    ROCK_H: [14, 30],

    // Caja 360: cuelga de un globo cada 3 rondas; quien le acierta gana un poder
    CRATE_EVERY: 3,
    CRATE_X: [200, 280],
    CRATE_Y: [70, 120],
    CRATE_SIZE: 12,
    POWERS: ['escudo', 'doble', 'reparar'],
    REPAIR_HP: 15,

    // Efectos de los proyectiles (ya no son iguales)
    TIKTOK_BOUNCE: { vy: 0.55, vx: 0.85 },   // rebota una vez en el agua
    INSTAGRAM_SPLIT: [0.72, 1, 1.28],        // se divide en 3 en el punto más alto
    FRAGMENT_FACTOR: 0.5,                    // cada fragmento hace la mitad del daño de la zona

    // Tiempos (ms) — el servidor los puede sobrescribir con variables de entorno
    PLAN_MS: 20000,          // moverse y apuntar, en secreto y al mismo tiempo
    REVEAL_MOVE_MS: 700,     // los barcos se deslizan a su nueva posición antes de que salgan las bombas
    MOVE_MS: 15000,          // (compatibilidad)
    AIM_MS: 20000,           // (compatibilidad)
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

    PHASES: ['LOBBY', 'WAITING', 'PLANNING', 'REVEAL', 'RESOLUTION', 'NEXT_TURN', 'GAME_OVER', 'PAUSED'],

    // Ranking semanal
    POINTS: { win: 3, draw: 1, loss: 0 },
    NEGOCIO_MAX: 24, PREMIO_MAX: 40,
  };
  C.COLOR_KEYS = Object.keys(C.COLORS);
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  else root.CNB = C;
})(typeof window !== 'undefined' ? window : this);
