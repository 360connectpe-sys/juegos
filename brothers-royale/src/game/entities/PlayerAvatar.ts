import { CircleGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Vector3 } from 'three';
import { PLAYER } from '@shared/constants';
import { lerp, wrapAngle } from '@shared/math';
import type { PlayerState } from '@shared/types';
import { box, merge } from '../world/geometry';

export interface AvatarColors {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
}

export const DEFAULT_COLORS: AvatarColors = { shirt: '#ff8c1a', pants: '#2b3a67', skin: '#f1c27d', hair: '#3b2416' };

/**
 * Personaje provisional low poly (cajas). Solo es la VISTA: la posición viene
 * de un PlayerState (local hoy, del servidor mañana) y se interpola entre ticks.
 */
export class PlayerAvatar {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly legL: Mesh;
  private readonly legR: Mesh;
  private readonly armL: Mesh;
  private readonly armR: Mesh;
  private readonly blob: Mesh;
  private readonly prev = new Vector3();
  private readonly curr = new Vector3();
  private prevYaw = 0;
  private currYaw = 0;
  private walkPhase = 0;
  private speed = 0;
  private grounded = true;

  constructor(colors: AvatarColors = DEFAULT_COLORS, castShadow = true, useBlobShadow = false) {
    const mat = new MeshLambertMaterial({ vertexColors: true });
    const limb = (geo: ReturnType<typeof box>) => {
      const m = new Mesh(geo, mat);
      m.castShadow = castShadow;
      return m;
    };

    // Torso + cabeza + pelo + mochila en una sola malla
    const torso = new Mesh(
      merge([
        box(0.62, 0.7, 0.36, colors.shirt, 0, 1.15, 0),
        box(0.5, 0.48, 0.46, colors.skin, 0, 1.76, 0),
        box(0.54, 0.16, 0.5, colors.hair, 0, 2.04, -0.02),
        box(0.54, 0.3, 0.12, colors.hair, 0, 1.86, -0.21),
        box(0.08, 0.08, 0.02, '#1d1d1d', -0.12, 1.8, 0.235),
        box(0.08, 0.08, 0.02, '#1d1d1d', 0.12, 1.8, 0.235),
        box(0.46, 0.5, 0.2, '#4c8c4a', 0, 1.15, -0.27),
      ]),
      mat,
    );
    torso.castShadow = castShadow;

    // Extremidades con pivote en la articulación (y = 0 en la parte superior)
    this.legL = limb(box(0.24, 0.8, 0.28, colors.pants, 0, -0.4, 0));
    this.legR = limb(box(0.24, 0.8, 0.28, colors.pants, 0, -0.4, 0));
    this.legL.position.set(-0.15, 0.8, 0);
    this.legR.position.set(0.15, 0.8, 0);
    this.armL = limb(merge([box(0.18, 0.55, 0.2, colors.shirt, 0, -0.27, 0), box(0.16, 0.16, 0.18, colors.skin, 0, -0.62, 0)]));
    this.armR = limb(merge([box(0.18, 0.55, 0.2, colors.shirt, 0, -0.27, 0), box(0.16, 0.16, 0.18, colors.skin, 0, -0.62, 0)]));
    this.armL.position.set(-0.41, 1.45, 0);
    this.armR.position.set(0.41, 1.45, 0);

    this.body.add(torso, this.legL, this.legR, this.armL, this.armR);
    this.root.add(this.body);

    // Sombra de mancha: alternativa barata cuando las sombras reales están apagadas
    const blobGeo = new CircleGeometry(PLAYER.radius * 1.4, 12);
    blobGeo.rotateX(-Math.PI / 2);
    this.blob = new Mesh(blobGeo, new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
    this.blob.position.y = 0.03;
    this.blob.visible = useBlobShadow;
    this.root.add(this.blob);
    this.root.name = 'player-avatar';
  }

  /** Recibe el estado tras un tick de simulación. */
  pushState(s: PlayerState, snap = false): void {
    this.prev.copy(snap ? new Vector3(s.position.x, s.position.y, s.position.z) : this.curr);
    this.prevYaw = snap ? s.yaw : this.currYaw;
    this.curr.set(s.position.x, s.position.y, s.position.z);
    this.currYaw = s.yaw;
    this.speed = Math.hypot(s.velocity.x, s.velocity.z);
    this.grounded = s.grounded;
  }

  /** Interpola entre los dos últimos ticks y anima. */
  render(alpha: number, dt: number): void {
    this.root.position.lerpVectors(this.prev, this.curr, alpha);
    this.root.rotation.y = this.prevYaw + wrapAngle(this.currYaw - this.prevYaw) * alpha;

    const moving = this.speed > 0.2;
    this.walkPhase += dt * (moving ? this.speed * 2.2 : 0);
    const swing = moving && this.grounded ? Math.sin(this.walkPhase) * Math.min(this.speed / 6, 1) * 0.9 : 0;
    const air = this.grounded ? 0 : 0.6;
    const k = Math.min(1, dt * 14);
    this.legL.rotation.x = lerp(this.legL.rotation.x, swing - air * 0.3, k);
    this.legR.rotation.x = lerp(this.legR.rotation.x, -swing + air * 0.5, k);
    this.armL.rotation.x = lerp(this.armL.rotation.x, -swing * 0.8 - air, k);
    this.armR.rotation.x = lerp(this.armR.rotation.x, swing * 0.8 - air, k);
    this.body.position.y = moving && this.grounded ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : 0;
  }

  get position(): Vector3 {
    return this.root.position;
  }
}
