import { BoxGeometry, Color, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';

/**
 * Efectos visuales ligeros de disparos e impactos: trazadoras, fogonazos y
 * chispas son cubos estirados de UNA InstancedMesh con color por instancia:
 * 1 draw call como mucho, y 0 cuando no hay efectos vivos (se oculta). Sin
 * texturas; solo se recorren los efectos vivos (acotados).
 */
const TRACER_LIFE = 0.07;
const SPARK_LIFE = 0.16;
const FLASH_LIFE = 0.05;

interface Tracer {
  from: Vector3;
  to: Vector3;
  t: number;
}
interface Spark {
  at: Vector3;
  t: number;
  life: number;
  size: number;
  color: Color;
}

export const IMPACT_COLOR = { world: new Color('#d9cfb8'), player: new Color('#ffb347'), flash: new Color('#fff3b0'), melee: new Color('#ffffff'), tracer: new Color('#ffe9a8') } as const;

export class CombatFx {
  static readonly MAX = 96;
  /** Trazadoras, fogonazos y chispas en UNA InstancedMesh: 1 draw call (0 sin efectos). */
  readonly mesh: InstancedMesh;
  private readonly liveTracers: Tracer[] = [];
  private readonly liveSparks: Spark[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly spin = new Quaternion().setFromEuler(new Euler(0.6, 0.785, 0));
  private readonly s = new Vector3();
  private readonly p = new Vector3();
  private readonly dir = new Vector3();
  private static readonly Z = new Vector3(0, 0, 1);

  constructor() {
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), CombatFx.MAX);
    this.mesh.name = 'combat-fx';
    this.mesh.setColorAt(0, IMPACT_COLOR.flash);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  tracer(from: Vec3, to: Vec3): void {
    if (this.liveTracers.length >= CombatFx.MAX / 2) this.liveTracers.shift();
    this.liveTracers.push({ from: new Vector3(from.x, from.y, from.z), to: new Vector3(to.x, to.y, to.z), t: 0 });
  }

  /** Fogonazo en la boca del cañón. */
  flash(at: Vec3, size = 0.09): void {
    this.spark(at, IMPACT_COLOR.flash, size, FLASH_LIFE);
  }

  impact(at: Vec3, onPlayer: boolean): void {
    this.spark(at, onPlayer ? IMPACT_COLOR.player : IMPACT_COLOR.world, onPlayer ? 0.12 : 0.08, SPARK_LIFE);
  }

  spark(at: Vec3, color: Color, size: number, life = SPARK_LIFE): void {
    if (this.liveSparks.length >= CombatFx.MAX / 2) this.liveSparks.shift();
    this.liveSparks.push({ at: new Vector3(at.x, at.y, at.z), t: 0, life, size, color });
  }

  get active(): number {
    return this.liveTracers.length + this.liveSparks.length;
  }

  update(dt: number): void {
    let n = 0;
    for (let i = this.liveTracers.length - 1; i >= 0; i--) {
      const tr = this.liveTracers[i]!;
      tr.t += dt;
      if (tr.t >= TRACER_LIFE) {
        this.liveTracers.splice(i, 1);
        continue;
      }
      // La trazadora avanza: su cola se acerca al impacto mientras vive.
      const k = tr.t / TRACER_LIFE;
      this.p.lerpVectors(tr.from, tr.to, k * 0.6);
      this.dir.subVectors(tr.to, this.p);
      const len = this.dir.length();
      if (len < 1e-3) continue;
      this.q.setFromUnitVectors(CombatFx.Z, this.dir.multiplyScalar(1 / len));
      const thick = 0.03 * (1 - k * 0.5);
      this.s.set(thick, thick, len);
      this.p.addScaledVector(this.dir, len / 2); // centro del segmento
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, IMPACT_COLOR.tracer);
      n++;
    }
    for (let i = this.liveSparks.length - 1; i >= 0; i--) {
      const sp = this.liveSparks[i]!;
      sp.t += dt;
      if (sp.t >= sp.life) {
        this.liveSparks.splice(i, 1);
        continue;
      }
      const k = sp.t / sp.life;
      const size = sp.size * (1 + k * 1.4) * (1 - k * 0.7);
      this.s.set(size, size, size);
      this.m.compose(sp.at, this.spin, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, sp.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.dispose();
  }
}
