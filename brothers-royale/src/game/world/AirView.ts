import { DynamicDrawUsage, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3, CylinderGeometry } from 'three';
import { planeAt, type PlaneRoute, type PlanePose } from '@shared/battle/flight';
import type { RoundSnapshot } from '@shared/battle/BattleRound';
import { box, merge, paint, transform } from './geometry';

const MAX_PLANES = 9;
const MAX_CHUTES = 16;

/** Avión low poly original (morro hacia +Z): fuselaje, alas altas, cola en T y hélice. */
function planeGeometry() {
  const body = '#f2b134', wing = '#e2562b', dark = '#3a3a46', glass = '#7fd3f7';
  return merge([
    box(1.7, 1.7, 7.2, body),
    box(1.75, 0.9, 1.4, glass, 0, 0.45, 2.4),
    box(1.2, 1.2, 0.8, dark, 0, 0, 3.9),
    box(0.25, 0.25, 0.4, '#777777', 0, 0, 4.45),
    box(3.2, 0.18, 0.18, dark, 0, 0, 4.6),
    box(11.5, 0.24, 1.9, wing, 0, 0.75, 0.6),
    box(0.9, 0.7, 1.6, dark, -3, 0.25, 1.0),
    box(0.9, 0.7, 1.6, dark, 3, 0.25, 1.0),
    box(1.0, 1.0, 2.2, body, 0, 0.2, -4.4),
    box(0.22, 1.8, 1.3, wing, 0, 1.4, -4.9),
    box(4.2, 0.18, 1.0, wing, 0, 0.6, -4.9),
    box(1.72, 0.2, 5.4, '#ffffff', 0, -0.35, 0.2),
  ]);
}
/** Paracaídas: cúpula octogonal a dos colores y cuatro cuerdas hasta el jugador. */
function chuteGeometry() {
  const dome = paint(new CylinderGeometry(1.4, 2.3, 0.7, 8, 1, false), '#ff5a5f');
  const cap = paint(new CylinderGeometry(0.6, 1.4, 0.35, 8, 1, false), '#ffffff');
  transform(cap, 0, 0.52, 0);
  const cord = box(0.05, 2.6, 0.05, '#e9e2d0', 0, -1.5, 0);
  return merge([dome, cap, cord]);
}

/**
 * Aviones y paracaídas de TODOS los jugadores: dos InstancedMesh (≤ 2 draw calls, ninguna si
 * no hay nada en el aire). La posición del avión sale de la ruta autoritativa y del reloj de
 * la ronda (que llega a 3 Hz): entre mensajes el reloj avanza localmente.
 */
export class AirView {
  readonly planes: InstancedMesh;
  readonly chutes: InstancedMesh;
  private clock = 0;
  private lastElapsed = -1;
  private routes: readonly PlaneRoute[] = [];
  private readonly pose: PlanePose = { x: 0, y: 0, z: 0, yaw: 0, progress: 0 };
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3(1, 1, 1);
  private readonly s2 = new Vector3(1, 1, 1);
  private readonly up = new Vector3(0, 1, 0);
  private chuteCount = 0;
  private spin = 0;

  constructor(shadows: boolean) {
    const mat = new MeshLambertMaterial({ vertexColors: true });
    this.planes = new InstancedMesh(planeGeometry(), mat, MAX_PLANES);
    this.chutes = new InstancedMesh(chuteGeometry(), mat, MAX_CHUTES);
    for (const mesh of [this.planes, this.chutes]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false; mesh.castShadow = shadows;
    }
  }

  /** Reloj de la ronda estimado en el cliente (segundos). */
  get elapsed(): number { return this.clock; }

  update(battle: RoundSnapshot | null | undefined, dt: number): void {
    if (!battle || battle.phase !== 'running') { this.routes = []; this.planes.count = 0; this.planes.visible = false; this.lastElapsed = -1; return; }
    if (battle.elapsed !== this.lastElapsed) { this.lastElapsed = battle.elapsed; this.clock = battle.elapsed; }
    else this.clock = Math.min(this.clock + dt, this.lastElapsed + 0.6);
    this.routes = battle.planes;
    this.spin += dt;
    let n = 0;
    for (const r of this.routes) {
      if (n >= MAX_PLANES) break;
      const p = planeAt(r, this.clock, this.pose);
      if (this.clock > r.start + r.duration + 1.5) continue;
      // Alabeo suave para que se note que vuela.
      this.q.setFromAxisAngle(this.up, p.yaw);
      this.v.set(p.x, p.y + Math.sin(this.spin * 1.3 + r.id) * 0.25, p.z);
      this.m.compose(this.v, this.q, this.s);
      this.planes.setMatrixAt(n++, this.m);
    }
    this.planes.count = n; this.planes.visible = n > 0;
    if (n) this.planes.instanceMatrix.needsUpdate = true;
  }

  /** Posición del avión `id` según el reloj local (null si no existe). */
  planePose(id: number | undefined): PlanePose | null {
    const r = id === undefined ? undefined : this.routes.find((x) => x.id === id);
    return r ? planeAt(r, this.clock, this.pose) : null;
  }

  beginChutes(): void { this.chuteCount = 0; }
  /** Un paracaídas abierto sobre el jugador en (x, y, z) (pies). */
  addChute(x: number, y: number, z: number, yaw: number, scale = 1): void {
    if (this.chuteCount >= MAX_CHUTES || scale <= 0) return;
    this.q.setFromAxisAngle(this.up, yaw);
    // Fase 15: el propio, más pequeño y más alto (no tapa el terreno ni la elección de aterrizaje).
    this.v.set(x, y + 4.2 + (1 - scale) * 2.5, z);
    this.s2.setScalar(scale);
    this.m.compose(this.v, this.q, this.s2);
    this.chutes.setMatrixAt(this.chuteCount++, this.m);
  }
  endChutes(): void {
    this.chutes.count = this.chuteCount; this.chutes.visible = this.chuteCount > 0;
    if (this.chuteCount) this.chutes.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.planes, this.chutes]) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.dispose(); }
    (this.planes.material as MeshLambertMaterial).dispose();
  }
}
