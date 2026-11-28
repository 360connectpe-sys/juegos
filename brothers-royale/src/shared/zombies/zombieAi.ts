/**
 * Fase 12 — zombis: constantes y decisiones PURAS (sin física): elección de objetivo y
 * navegación simplificada por puertas y escaleras de los prefabs. El cuerpo (colisiones
 * reales, peldaños) lo resuelve `physics/ZombieDirector` con el mismo CharacterBody de
 * los jugadores, así nunca atraviesa sólidos.
 */
import type { ItemStack } from '../items';
import { rotateXZ } from '../math';
import type { Vec3 } from '../types';
import { insideState, type PlacedPrefab } from '../world/prefab';

export const ZOMBIE = {
  hp: 40,
  damage: 5,
  /** Una aparición por sala cada 50 s (mientras haya menos de `maxActive`). */
  spawnEvery: 50,
  attackInterval: 1.3,
  /** Velocidad media: 0,7 × andar del jugador (3,5 m/s; el jugador anda a 5 y corre a 8). */
  speedMultiplier: 0.7,
  maxActive: 8,
  attackRange: 1.4,
  /** Distancia a la que detectan a un jugador. */
  aggroRange: 32,
  /** Nunca aparecen a menos de esto de un jugador vivo. */
  minSpawnDistance: 14,
  retargetEvery: 1,
  /** La IA piensa cada N ticks (escalonado por zombi); el cuerpo se mueve cada tick. */
  thinkEvery: 6,
  /** Botín garantizado de munición o curación (nunca madera ni armas). */
  dropChance: 1,
  /** Cadáver visible antes de desaparecer (animación de muerte). */
  corpseSeconds: 2.5,
  /** Aturdimiento al recibir un golpe (animación). */
  hitSeconds: 0.25,
} as const;

/** Animación visible: 0 quieto, 1 andar, 2 perseguir, 3 atacar, 4 golpeado, 5 muerto. */
export type ZombieAnim = 0 | 1 | 2 | 3 | 4 | 5;

export interface ZombieCandidate {
  id: string;
  feet: Vec3;
  /** Solo se persigue a quien está en tierra (no en el avión ni en el descenso protegido). */
  targetable: boolean;
}

/**
 * Objetivo: el jugador vivo y alcanzable más cercano. Se mantiene el actual salvo que
 * otro esté claramente más cerca (histéresis de 4 m) o el actual deje de ser válido.
 */
export function chooseTarget(from: Vec3, candidates: readonly ZombieCandidate[], current: string | null, range: number = ZOMBIE.aggroRange): string | null {
  let best: string | null = null, bestD = Infinity, currentD = Infinity;
  for (const c of candidates) {
    if (!c.targetable) continue;
    // Muy por encima o por debajo (otra planta lejana, torre alta): no "alcanzable" en línea recta.
    const dy = Math.abs(c.feet.y - from.y);
    const d = Math.hypot(c.feet.x - from.x, c.feet.z - from.z) + dy * 1.5;
    if (d > range) continue;
    if (c.id === current) currentD = d;
    if (d < bestD) { bestD = d; best = c.id; }
  }
  if (current !== null && currentD < Infinity && currentD <= bestD + 4) return current;
  return best;
}

const toWorld = (p: PlacedPrefab, x: number, y: number, z: number): Vec3 => {
  const r = rotateXZ(x, z, p.rotationY);
  return { x: p.x + r.x, y: p.y + y, z: p.z + r.z };
};
const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Edificio en el que está un punto: dentro (interior) o encima (tejado/azotea transitable). */
export function buildingAt(buildings: readonly PlacedPrefab[], p: Vec3): { b: PlacedPrefab; level: 'lower' | 'upper' | 'top' } | null {
  for (const b of buildings) {
    if (!b.def.nav) continue;
    const s = insideState(b, p.x, p.y, p.z);
    if (s !== 'outside') return { b, level: s };
    if (p.y - b.y > 1.6 && Math.hypot(p.x - b.x, p.z - b.z) < b.def.clearRadius - 1) return { b, level: 'top' };
  }
  return null;
}

/**
 * Siguiente punto hacia el que caminar para llegar a `target` desde `from`:
 * puerta (fuera → dentro), escalera/rampa (pie → llegada) o el propio objetivo.
 */
export function nextWaypoint(buildings: readonly PlacedPrefab[], from: Vec3, target: Vec3): Vec3 {
  const t = buildingAt(buildings, target);
  const z = buildingAt(buildings, from);
  // Salir del edificio en el que está el zombi si el objetivo está en otro sitio.
  if (z && (!t || t.b !== z.b)) {
    const nav = z.b.def.nav!;
    if (z.level === 'lower') {
      const inside = toWorld(z.b, nav.inside.x, 0, nav.inside.z);
      return flat(from, inside) > 0.8 ? inside : toWorld(z.b, nav.door.x, 0, nav.door.z);
    }
    // Arriba: bajar por el primer recorrido (al revés).
    const path = nav.climbs[0];
    if (path) for (let i = path.length - 1; i >= 0; i--) {
      const w = toWorld(z.b, path[i]!.x, path[i]!.y, path[i]!.z);
      if (w.y < from.y - 0.5 || i === 0) return w;
    }
    return target;
  }
  if (!t) return target;
  const nav = t.b.def.nav!;
  const high = t.level !== 'lower';
  const zLevel = z?.b === t.b ? z.level : null;
  if (high && zLevel !== t.level) {
    // Subir: el recorrido cuyo final está más cerca del objetivo; ir al punto siguiente al más cercano.
    const path = nav.climbs[0];
    if (path) {
      const pts = path.map((q) => toWorld(t.b, q.x, q.y, q.z));
      // Si el pie de la escalera está dentro y el zombi fuera, primero la puerta.
      if (!zLevel && insideState(t.b, pts[0]!.x, pts[0]!.y + 0.1, pts[0]!.z) !== 'outside') {
        const door = toWorld(t.b, nav.door.x, 0, nav.door.z), inside = toWorld(t.b, nav.inside.x, 0, nav.inside.z);
        return flat(from, door) > 1.2 && flat(from, inside) > 1.2 ? door : inside;
      }
      // Tramo del recorrido sobre el que está (distancia horizontal al segmento y altura
      // coherente): se avanza a su final. Si no está en ninguno, al pie de la escalera.
      let best = -1, bestD = 0.6;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]!, b = pts[i + 1]!;
        const sx = b.x - a.x, sz = b.z - a.z, len2 = sx * sx + sz * sz;
        const u = len2 > 1e-6 ? Math.max(0, Math.min(1, ((from.x - a.x) * sx + (from.z - a.z) * sz) / len2)) : 0;
        const d = Math.hypot(a.x + sx * u - from.x, a.z + sz * u - from.z);
        const yAt = a.y + (b.y - a.y) * u;
        if (Math.abs(from.y - yAt) < 0.8 && d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return pts[0]!;
      const end = pts[best + 1]!;
      // Al llegar al final del último tramo, directo al objetivo.
      return best + 2 >= pts.length && flat(from, end) < 0.7 ? target : end;
    }
  }
  if (!zLevel) {
    // Entrar: delante de la puerta y después dentro.
    const door = toWorld(t.b, nav.door.x, 0, nav.door.z), inside = toWorld(t.b, nav.inside.x, 0, nav.inside.z);
    if (flat(from, inside) < 1.2) return target;
    return flat(from, door) > 1.2 ? door : inside;
  }
  return target;
}

/** Exactamente una recompensa por muerte. No acepta objetos elegidos por el cliente. */
export function zombieLoot(rng: () => number): ItemStack {
  return rng()<0.5 ? {kind:'medkit',qty:1}
    : {kind:rng()<0.5?'ammo_light':'ammo_medium',qty:15+Math.floor(rng()*16)};
}
