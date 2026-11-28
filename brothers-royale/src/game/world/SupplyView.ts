import { DynamicDrawUsage, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { SUPPLY, supplyHeight, type SupplyDrop } from '@shared/battle/supply';
import { box, merge } from './geometry';
import type { AirView } from './AirView';

/** Caja de suministros low poly original: madera azul con bandas naranjas y baliza. */
function crateGeometry() {
  const body = '#2f5f9e', band = '#ff9a1f', dark = '#1d355c';
  return merge([
    box(1.1, 0.9, 1.1, body, 0, 0.45, 0),
    box(1.14, 0.16, 1.14, band, 0, 0.62, 0),
    box(1.14, 0.16, 1.14, band, 0, 0.24, 0),
    box(0.16, 0.92, 1.14, dark, 0, 0.45, 0),
    box(1.14, 0.92, 0.16, dark, 0, 0.45, 0),
    box(0.22, 0.22, 0.22, '#ffd34d', 0, 1.0, 0),
  ]);
}

/**
 * Cajas de suministros (máx. 3) en UNA InstancedMesh; su paracaídas reutiliza el de AirView.
 * La altura sale del instante de la suelta (sin sincronización por tick).
 */
export class SupplyView {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly up = new Vector3(0, 1, 0);

  constructor() {
    this.mesh = new InstancedMesh(crateGeometry(), new MeshLambertMaterial({ vertexColors: true }), SUPPLY.maxActive);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.visible = false; this.mesh.frustumCulled = false;
  }

  update(drops: readonly SupplyDrop[] | undefined, elapsed: number, air: AirView | null): void {
    let n = 0;
    for (const d of drops ?? []) {
      if (n >= SUPPLY.maxActive) break;
      const h = supplyHeight(d, elapsed);
      // Leve balanceo mientras cae; quieta al aterrizar.
      const sway = h.landed ? 0 : Math.sin(elapsed * 1.7 + d.id) * 0.08;
      this.q.setFromAxisAngle(this.up, d.id * 1.3 + sway);
      this.v.set(d.x, h.y, d.z);
      this.m.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
      if (!h.landed) air?.addChute(d.x, h.y - 2.6, d.z, 0, 0.85);
    }
    this.mesh.count = n; this.mesh.visible = n > 0;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); (this.mesh.material as MeshLambertMaterial).dispose(); }
}
