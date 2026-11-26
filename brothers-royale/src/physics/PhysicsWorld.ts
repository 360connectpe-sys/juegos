/**
 * Envoltorio de Rapier. NO depende de Three.js ni del DOM: el mismo código
 * podrá ejecutarse en el servidor autoritativo (Node + Colyseus).
 */
import type RAPIERNS from '@dimforge/rapier3d-compat';
import { SIMULATION, WORLD } from '@shared/constants';
import type { StaticColliderSpec } from '@shared/world/colliders';
import { sampleTerrainGrid, type TerrainParams } from '@shared/world/terrain';
import type { Vec3 } from '@shared/types';
import { CAMERA_QUERY_GROUPS, staticGroups } from './groups';

const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };

export type Rapier = typeof RAPIERNS;

let rapierPromise: Promise<Rapier> | null = null;

/** Carga diferida del WASM de Rapier (chunk separado, no bloquea el primer render). */
export function loadRapier(): Promise<Rapier> {
  rapierPromise ??= import('@dimforge/rapier3d-compat').then(async (mod) => {
    const R = (mod.default ?? mod) as Rapier;
    await R.init();
    return R;
  });
  return rapierPromise;
}

export class PhysicsWorld {
  private readonly interactionTargets = new Set<number>();
  readonly world: RAPIERNS.World;
  private cameraBall: RAPIERNS.Ball | null = null;

  constructor(readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: SIMULATION.gravity, z: 0 });
    this.world.timestep = SIMULATION.fixedDt;
  }

  /**
   * Heightfield del terreno. Rapier espera una matriz (nrows+1)×(ncols+1) en
   * orden por columnas, con filas a lo largo de Z y columnas a lo largo de X.
   */
  addTerrain(params: TerrainParams, segments: number = WORLD.segments): RAPIERNS.Collider {
    const n = segments + 1;
    const rowMajor = sampleTerrainGrid(params, segments); // [row(z) * n + col(x)]
    const colMajor = new Float32Array(n * n);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        colMajor[col * n + row] = rowMajor[row * n + col]!;
      }
    }
    const desc = this.R.ColliderDesc.heightfield(segments, segments, colMajor, {
      x: params.size,
      y: 1,
      z: params.size,
    });
    desc.setCollisionGroups(staticGroups('world'));
    return this.world.createCollider(desc);
  }

  addStatic(spec: StaticColliderSpec): RAPIERNS.Collider {
    const R = this.R;
    let desc: RAPIERNS.ColliderDesc;
    if (spec.kind === 'box') {
      const e = spec.halfExtents;
      desc = R.ColliderDesc.cuboid(e.x, e.y, e.z).setRotation(spec.rotation);
    } else {
      desc = R.ColliderDesc.cylinder(spec.halfHeight, spec.radius);
    }
    desc.setTranslation(spec.center.x, spec.center.y, spec.center.z).setCollisionGroups(staticGroups(spec.layer));
    const collider = this.world.createCollider(desc);
    if (spec.interactionTarget) this.interactionTargets.add(collider.handle);
    return collider;
  }

  /** Para piezas destructibles/construcciones (fase futura). */
  removeStatic(collider: RAPIERNS.Collider): void {
    this.interactionTargets.delete(collider.handle);
    this.world.removeCollider(collider, false);
  }

  /**
   * Lanza una esfera de `radius` desde `origin` en la dirección unitaria `dir`.
   * Devuelve la distancia recorrida hasta el primer obstáculo (mundo,
   * estructuras o construcciones; nunca jugadores) o null si no choca.
   * Solo lo usa la cámara: es una consulta, no modifica la simulación.
   */
  castCameraSphere(origin: Vec3, dir: Vec3, maxDistance: number, radius: number): number | null {
    if (!(maxDistance > 0)) return null;
    this.cameraBall ??= new this.R.Ball(radius);
    if (this.cameraBall.radius !== radius) this.cameraBall = new this.R.Ball(radius);
    const hit = this.world.castShape(origin, IDENTITY_ROT, dir, this.cameraBall, 0, maxDistance, true, undefined, CAMERA_QUERY_GROUPS);
    return hit ? hit.time_of_impact : null;
  }

  /**
   * ¿Hay línea de visión entre `from` y `to`? (mundo y estructuras; nunca
   * jugadores). Solo se ignora el colisionador del cofre que contiene el objetivo. Un impacto en los últimos `slack` metros cuenta como visible:
   * es el propio objetivo (p. ej. el cofre, que tiene colisionador).
   */
  lineOfSight(from: Vec3, to: Vec3, slack = 0.02): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    const ray = new this.R.Ray(from, { x: dx / len, y: dy / len, z: dz / len });
    const hit = this.world.castRay(ray, len, true, undefined, CAMERA_QUERY_GROUPS, undefined, undefined, (collider) => !(this.interactionTargets.has(collider.handle) && collider.containsPoint(to)));
    return !hit || hit.timeOfImpact >= len - slack;
  }

  /** Lanza un rayo hacia abajo y devuelve la altura del primer impacto. */
  groundHeightAt(x: number, z: number, fromY = 50): number | null {
    const ray = new this.R.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, fromY * 2, true);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  step(): void {
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}
