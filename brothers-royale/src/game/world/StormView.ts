import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineLoop } from 'three';
import type { Circle } from '@shared/battle/zone';
import { terrainHeight, type TerrainParams } from '@shared/world/terrain';
/** Una línea de 96 segmentos, sin texturas, sombras ni pasada de postprocesado. */
export class StormView {
  readonly line: LineLoop;
  private readonly points = new Float32Array(96 * 3);
  private last = '';
  constructor(private readonly terrain: TerrainParams) {
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(this.points, 3));
    this.line = new LineLoop(geometry, new LineBasicMaterial({ color: '#b284ff', transparent: true, opacity: .85 }));
    this.line.frustumCulled = false; this.line.visible = false;
  }
  update(circle: Circle | null): void {
    this.line.visible = circle !== null;
    if (!circle) return;
    const key = `${circle.x.toFixed(2)}:${circle.z.toFixed(2)}:${circle.radius.toFixed(2)}`;
    if (key === this.last) return; this.last = key;
    for (let i = 0; i < 96; i++) {
      const angle = i / 96 * Math.PI * 2, x = circle.x + Math.cos(angle) * circle.radius, z = circle.z + Math.sin(angle) * circle.radius;
      this.points[i * 3] = x; this.points[i * 3 + 1] = terrainHeight(x, z, this.terrain) + .15; this.points[i * 3 + 2] = z;
    }
    this.line.geometry.getAttribute('position').needsUpdate = true;
  }
  dispose(): void { this.line.removeFromParent(); this.line.geometry.dispose(); (this.line.material as LineBasicMaterial).dispose(); }
}
