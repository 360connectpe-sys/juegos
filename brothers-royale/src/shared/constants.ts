/**
 * Constantes de simulación compartidas entre cliente y (futuro) servidor.
 * Todo lo que afecte a la jugabilidad debe vivir aquí y no en el código de render,
 * para que el servidor autoritativo (Colyseus) use exactamente los mismos valores.
 */
export const WORLD = {
  /** Lado del mapa de prueba en metros (cuadrado centrado en el origen). */
  size: 120,
  /** Celdas por lado del terreno (malla visual y heightfield físico). */
  segments: 64,
  /** Semilla por defecto del mapa de prueba. */
  seed: 1337,
  /** Altura máxima aproximada de las colinas. */
  maxHeight: 4,
  /** Radio plano reservado alrededor de la casa. */
  houseClearRadius: 10,
} as const;

export const SIMULATION = {
  /** Ticks por segundo de la simulación (mismo valor que usará el servidor). */
  tickRate: 30,
  get fixedDt(): number {
    return 1 / this.tickRate;
  },
  gravity: -24,
} as const;

export const PLAYER = {
  walkSpeed: 5.5,
  sprintSpeed: 8.5,
  jumpVelocity: 8,
  /** Cápsula: radio y media altura del segmento cilíndrico. */
  radius: 0.35,
  halfHeight: 0.5,
  /** Velocidad angular de giro hacia la dirección de movimiento (rad/s). */
  turnSpeed: 14,
} as const;

export const CAMERA = {
  /** Altura visible del mundo en metros (zoom ortográfico) en escritorio. */
  viewHeight: 20,
  /** Ancho mínimo visible en pantallas verticales (móvil en retrato). */
  minViewWidth: 15,
  distance: 40,
  followLerp: 8,
} as const;
