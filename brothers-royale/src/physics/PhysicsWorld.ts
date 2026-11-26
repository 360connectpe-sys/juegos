/**
 * Envoltorio de Rapier. NO depende de Three.js ni del DOM: el mismo código
 * podrá ejecutarse en el servidor autoritativo (Node + Colyseus).
 */
import type RAPIERNS from '@dimforge/rapier3d-compat';
import { SIMULATION, WORLD } from '@shared/constants';
import type { StaticColliderSpec } from '@shared/world/colliders';
import { sampleTerrainGrid, type TerrainParams } from '@shared/world/terrain';
import { staticGroups } from './groups';

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
  readonly world: RAPIERNS.World;

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
    return this.world.createCollider(desc);
  }

  /** Para piezas destructibles/construcciones (fase futura). */
  removeStatic(collider: RAPIERNS.Collider): void {
    this.world.removeCollider(collider, false);
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
