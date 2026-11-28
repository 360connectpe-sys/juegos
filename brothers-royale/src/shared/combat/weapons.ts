/**
 * Armas y balance (datos puros, compartidos con el servidor).
 *
 * Valores de partida pedidos para la fase 6 (rareza común salvo la escopeta):
 *   Pistola 20 de daño · 3 disparos/s · 12 balas
 *   Subfusil 12 · 8/s · 30
 *   Rifle 24 · 4/s · 30
 *   Escopeta máx. 65 por disparo (épica a quemarropa) · 1/s · 5
 *   Hacha 15 · 1,5 golpes/s
 * El resto (alcance, caída de daño, dispersión, retroceso, recarga) se ajustó
 * con `expectedDps` y las pruebas de balance (tests/combatBalance.test.ts):
 * cada arma es la mejor en su distancia y ninguna domina en todas.
 */
import type { Rarity, WeaponKind } from '../items';

export const HEALTH = {
  max: 100,
  /** Tope de armas normales. Excepción explícita: cabeza de francotirador = 100. */
  maxShotDamage: 65,
} as const;

export const HEAL = {
  /** Botiquín: cura hasta 50 al terminar 5 s de uso, sin pasar del máximo. */
  amount: 50,
  seconds: 5,
} as const;

/** Espera entre vidas; BattleRound controla el ciclo y la autoridad el descenso. */
export const DEATH = { respawnSeconds: 5 } as const;

/** Altura de los ojos (origen de disparos y golpes) sobre los pies. */
export const EYE_HEIGHT = 1.5;

/**
 * Caja de impacto del jugador: cápsula vertical algo más generosa que la de
 * colisión. El francotirador añade una cabeza explícita en hitscan.ts.
 */
export const HITBOX = { radius: 0.42, bottom: 0.42, top: 1.3 } as const;

/**
 * Compensación de latencia: cuánto puede rebobinar el servidor (12 ticks a
 * 30 Hz = 400 ms ≈ 100 ms de interpolación + hasta ~250 ms de ida y jitter).
 * Con 9 ticks, una ida de 150 ms con jitter ya quedaba en el límite (prueba
 * de integración con blanco en movimiento: 56 % de aciertos → 100 % con 12).
 */
export const LAG_COMPENSATION = { maxRewindTicks: 12 } as const;

/** Cambiar de hueco tarda esto antes de poder atacar (evita alternar armas para saltarse la cadencia). */
export const EQUIP_SECONDS = 0.3;

export interface WeaponStats {
  label: string;
  /** Daño por bala (escopeta: por perdigón) en rareza común. */
  damage: number;
  pellets: number;
  /** Disparos por segundo (mantener pulsado dispara a esta cadencia). */
  fireRate: number;
  magazine: number;
  reloadSeconds: number;
  /** Alcance máximo: más allá no hay impacto. */
  range: number;
  /** Caída de daño lineal entre start y end hasta minFalloff. */
  falloffStart: number;
  falloffEnd: number;
  minFalloff: number;
  /** Dispersión (semiángulo del cono, rad) sin apuntar y apuntando. */
  spreadHip: number;
  spreadAim: number;
  /** Dispersión extra por disparo seguido (retroceso) y su recuperación. */
  bloomPerShot: number;
  bloomMax: number;
  bloomRecovery: number;
  /** Patada visual de la cámara al disparar (rad). Solo vista. */
  kick: number;
}

export const WEAPON_STATS: Readonly<Record<WeaponKind, WeaponStats>> = {
  sniper: {
    label: 'Francotirador', damage: 65, pellets: 1, fireRate: 1 / 1.5, magazine: 5, reloadSeconds: 3,
    range: 150, falloffStart: 150, falloffEnd: 151, minFalloff: 1,
    spreadHip: 0.09, spreadAim: 0.0012, bloomPerShot: 0.015, bloomMax: 0.02, bloomRecovery: 0.1, kick: 0.13,
  },
  pistol: {
    label: 'Pistola', damage: 20, pellets: 1, fireRate: 3, magazine: 12, reloadSeconds: 1.3,
    range: 60, falloffStart: 18, falloffEnd: 50, minFalloff: 0.65,
    spreadHip: 0.03, spreadAim: 0.012, bloomPerShot: 0.008, bloomMax: 0.03, bloomRecovery: 0.12, kick: 0.035,
  },
  smg: {
    label: 'Subfusil', damage: 12, pellets: 1, fireRate: 8, magazine: 30, reloadSeconds: 1.9,
    range: 45, falloffStart: 9, falloffEnd: 30, minFalloff: 0.45,
    spreadHip: 0.045, spreadAim: 0.028, bloomPerShot: 0.005, bloomMax: 0.045, bloomRecovery: 0.14, kick: 0.018,
  },
  rifle: {
    label: 'Rifle', damage: 24, pellets: 1, fireRate: 3.5, magazine: 30, reloadSeconds: 2.3,
    range: 90, falloffStart: 35, falloffEnd: 80, minFalloff: 0.75,
    spreadHip: 0.06, spreadAim: 0.006, bloomPerShot: 0.004, bloomMax: 0.025, bloomRecovery: 0.012, kick: 0.03,
  },
  shotgun: {
    label: 'Escopeta', damage: 6.2, pellets: 10, fireRate: 1, magazine: 5, reloadSeconds: 2.6,
    range: 24, falloffStart: 6, falloffEnd: 20, minFalloff: 0.25,
    spreadHip: 0.07, spreadAim: 0.055, bloomPerShot: 0, bloomMax: 0, bloomRecovery: 1, kick: 0.09,
  },
};

export const MELEE = {
  label: 'Hacha',
  damage: 15,
  rate: 1.5,
  /** Alcance desde los ojos hasta la superficie de la caja de impacto. */
  reach: 1.9,
  /** Semiángulo horizontal del golpe. */
  cone: (50 * Math.PI) / 180,
  kick: 0.05,
} as const;

/**
 * Mejoras por rareza: pequeñas, para que la épica sea deseable sin decidir la
 * pelea. El daño sube poco y NUNCA cambia los disparos necesarios a
 * quemarropa (sería un +20-25 % de velocidad de eliminación); el resto de la
 * ventaja es menos dispersión y recarga más rápida.
 */
export const RARITY_MODS: Readonly<Record<Rarity, { spread: number; reload: number }>> = {
  common: { spread: 1, reload: 1 },
  // La dispersión cuenta al cuadrado en la probabilidad de acierto: ×0,9 ya es +23 %.
  rare: { spread: 0.95, reload: 0.93 },
  epic: { spread: 0.9, reload: 0.86 },
};

/** Daño por bala/perdigón según rareza (la común es el valor base de WEAPON_STATS). */
export const RARITY_DAMAGE: Readonly<Record<WeaponKind, Record<Rarity, number>>> = {
  sniper: { common: 65, rare: 65, epic: 65 },
  pistol: { common: 20, rare: 21, epic: 22 },
  smg: { common: 12, rare: 12.2, epic: 12.4 },
  rifle: { common: 24, rare: 24.4, epic: 24.8 },
  shotgun: { common: 6.2, rare: 6.35, epic: 6.5 },
};

export const rarityOf = (r: Rarity | undefined): Rarity => r ?? 'common';

/** Daño de UNA bala/perdigón a una distancia. */
export function pelletDamage(kind: WeaponKind, rarity: Rarity, distance: number): number {
  const s = WEAPON_STATS[kind];
  if (distance > s.range) return 0;
  return RARITY_DAMAGE[kind][rarity] * falloff(s, distance);
}

/** El daño se maneja en décimas (la salud se muestra redondeada hacia arriba). */
export const roundDamage = (v: number): number => Math.round(v * 10) / 10;

export function falloff(s: Pick<WeaponStats, 'falloffStart' | 'falloffEnd' | 'minFalloff'>, distance: number): number {
  if (distance <= s.falloffStart) return 1;
  if (distance >= s.falloffEnd) return s.minFalloff;
  const t = (distance - s.falloffStart) / (s.falloffEnd - s.falloffStart);
  return 1 + (s.minFalloff - 1) * t;
}

/** Daño máximo posible de un disparo (todos los perdigones a quemarropa). */
export function maxShotDamage(kind: WeaponKind, rarity: Rarity): number {
  return Math.min(HEALTH.maxShotDamage, roundDamage(pelletDamage(kind, rarity, 0) * WEAPON_STATS[kind].pellets));
}

export const reloadSeconds = (kind: WeaponKind, rarity: Rarity): number => WEAPON_STATS[kind].reloadSeconds * (kind === 'sniper' ? 1 : RARITY_MODS[rarity].reload);

export function spreadOf(kind: WeaponKind, rarity: Rarity, aiming: boolean): number {
  const s = WEAPON_STATS[kind];
  return (aiming ? s.spreadAim : s.spreadHip) * RARITY_MODS[rarity].spread;
}

/** Penalización de dispersión por moverse o estar en el aire. */
export const MOVE_SPREAD = { moving: 1.35, airborne: 1.9, movingSpeed: 1.5 } as const;

/**
 * Probabilidad de que una bala de un cono uniforme de semiángulo `spread`
 * impacte un disco de radio `radius` a `distance` (modelo de balance).
 */
export function hitChance(spread: number, distance: number, radius: number = HITBOX.radius): number {
  const target = Math.atan2(radius, distance);
  if (spread <= target) return 1;
  return (target / spread) ** 2;
}

/**
 * DPS sostenido esperado contra un jugador quieto (balance, no simulación):
 * cargador completo con dispersión creciente + recarga. `aiming` = apuntando.
 */
export function expectedDps(kind: WeaponKind, rarity: Rarity, distance: number, aiming: boolean): number {
  const s = WEAPON_STATS[kind];
  const base = spreadOf(kind, rarity, aiming);
  const interval = 1 / s.fireRate;
  let bloom = 0;
  let damage = 0;
  for (let i = 0; i < s.magazine; i++) {
    const perPellet = pelletDamage(kind, rarity, distance) * hitChance(base + bloom, distance);
    damage += Math.min(HEALTH.maxShotDamage, perPellet * s.pellets);
    bloom = Math.max(0, Math.min(s.bloomMax, bloom + s.bloomPerShot) - s.bloomRecovery * interval);
  }
  const time = s.magazine * interval + reloadSeconds(kind, rarity);
  return damage / time;
}

/**
 * Tiempo esperado (s) para eliminar a un jugador quieto con salud completa a
 * `distance`, empezando con el cargador lleno: daño esperado por disparo
 * (dispersión creciente incluida) y recargas si hacen falta. Es la métrica
 * principal del balance.
 */
export function expectedTimeToKill(kind: WeaponKind, rarity: Rarity, distance: number, aiming: boolean): number {
  const s = WEAPON_STATS[kind];
  const base = spreadOf(kind, rarity, aiming);
  const interval = 1 / s.fireRate;
  let bloom = 0;
  let dealt = 0;
  let time = 0;
  let mag = s.magazine;
  for (let shot = 0; shot < 400; shot++) {
    if (mag === 0) {
      time += reloadSeconds(kind, rarity);
      mag = s.magazine;
      bloom = 0;
    }
    const perPellet = pelletDamage(kind, rarity, distance) * hitChance(base + bloom, distance);
    dealt += Math.min(HEALTH.maxShotDamage, perPellet * s.pellets);
    mag--;
    if (dealt >= HEALTH.max - 1e-9) return time;
    time += interval;
    bloom = Math.max(0, Math.min(s.bloomMax, bloom + s.bloomPerShot) - s.bloomRecovery * interval);
  }
  return Infinity;
}

/** Disparos necesarios para eliminar a alguien con salud completa (a quemarropa, sin fallar). */
export function shotsToKill(kind: WeaponKind, rarity: Rarity, distance = 0): number {
  const per = Math.min(HEALTH.maxShotDamage, roundDamage(pelletDamage(kind, rarity, distance) * WEAPON_STATS[kind].pellets));
  return per > 0 ? Math.ceil(HEALTH.max / per - 1e-9) : Infinity;
}

/** Tiempo mínimo para eliminar (s) sin fallar: el primer disparo es inmediato. */
export const timeToKill = (kind: WeaponKind, rarity: Rarity, distance = 0): number =>
  (shotsToKill(kind, rarity, distance) - 1) / WEAPON_STATS[kind].fireRate;

/** Dirección unitaria desde yaw (convención de Three: +Z adelante) y pitch (+ arriba). */
export function directionFromAim(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}

export const AIM_PITCH_LIMIT = 1.5;
