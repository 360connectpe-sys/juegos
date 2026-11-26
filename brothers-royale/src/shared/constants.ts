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
  /** Radio totalmente plano alrededor del pueblo (casa, mirador, cajas). */
  flatRadius: 17,
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
  walkSpeed: 5,
  sprintSpeed: 8,
  /** Aceleración horizontal en suelo y en el aire (m/s²). */
  groundAccel: 55,
  groundDecel: 45,
  airAccel: 14,
  jumpVelocity: 8.2,
  /** Multiplicador de gravedad al caer: saltos menos "flotantes". */
  fallGravityMultiplier: 1.5,
  terminalVelocity: -40,
  /** Margen para saltar justo después de dejar el borde (s). */
  coyoteTime: 0.1,
  /** Margen para registrar un salto pulsado justo antes de aterrizar (s). */
  jumpBuffer: 0.12,
  /** Cápsula: radio y media altura del segmento cilíndrico. */
  radius: 0.35,
  halfHeight: 0.5,
  /** Escalón máximo que se sube sin saltar (m). */
  maxStepHeight: 0.4,
  maxSlopeDeg: 50,
  /** Velocidad angular de giro hacia la dirección de movimiento (rad/s). */
  turnSpeed: 12,
  /** Velocidad mínima para considerar que corre (animación). */
  runThreshold: 6.2,
} as const;

/** Altura total aproximada del personaje (para techos, cámara, etc.). */
export const PLAYER_HEIGHT = (PLAYER.halfHeight + PLAYER.radius) * 2;

export const CAMERA = {
  /** Altura visible del mundo en metros (zoom ortográfico) en escritorio. */
  viewHeight: 20,
  /** Ancho mínimo visible en pantallas verticales (móvil en retrato). */
  minViewWidth: 15,
  /**
   * Ancho máximo visible: el de una pantalla 16:9. En pantallas más anchas
   * (celular en horizontal, ~2,16:1) se acerca la cámara en vez de mostrar más
   * mundo: personajes más grandes y nadie ve más que otro por su pantalla.
   */
  maxViewWidth: 36,
  distance: 40,
  /** Suavizado del seguimiento horizontal y vertical (mayor = más rígido). */
  followLerp: 7,
  verticalLerp: 4,
  /** Adelanto de la cámara en la dirección de movimiento (s de velocidad). */
  lookAhead: 0.35,
  maxLookAhead: 2.5,
  minZoom: 0.7,
  maxZoom: 1.5,
} as const;

/** Cámaras en perspectiva (3ª y 1ª persona). Solo afectan a la vista, nunca a la simulación. */
export const CAMERA_RIG = {
  /** Altura de los ojos sobre los pies (1ª persona). */
  eyeHeight: 1.62,
  /** Altura del pivote de 3ª persona (hombro). */
  shoulderHeight: 1.55,
  /** Desplazamiento lateral del pivote de 3ª persona (cámara sobre el hombro derecho). */
  shoulderOffset: 0.45,
  thirdDistance: 4.2,
  thirdMinDistance: 1.4,
  thirdMaxDistance: 7,
  /** Radio de la "esfera" de la cámara al chocar con paredes. */
  collisionRadius: 0.3,
  /** Más cerca que esto, el avatar propio se oculta para no tapar la vista. */
  hideAvatarBelow: 1.1,
  firstPitch: { min: -1.45, max: 1.45 },
  thirdPitch: { min: -0.55, max: 1.1 },
  fov: 70,
  firstFov: 78,
  near: 0.05,
  // = fin de la niebla (95 m) con margen: lo que no se ve ni se dibuja.
  far: 100,
} as const;
