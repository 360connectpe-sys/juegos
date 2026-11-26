import { CircleGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Vector3 } from 'three';
import { PLAYER } from '@shared/constants';
import { damp, wrapAngle } from '@shared/math';
import type { Locomotion, PlayerState } from '@shared/types';
import { box, merge } from '../world/geometry';

export interface AvatarColors {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
}

export const DEFAULT_COLORS: AvatarColors = { shirt: '#ff8c1a', pants: '#2b3a67', skin: '#f1c27d', hair: '#3b2416' };

/** Paleta para distinguir jugadores en línea (índice = color del roster). */
export const AVATAR_PALETTE: readonly AvatarColors[] = [
  DEFAULT_COLORS,
  { shirt: '#3ddc97', pants: '#23395b', skin: '#c68642', hair: '#1b1b1b' },
  { shirt: '#5bc0eb', pants: '#3b2f2f', skin: '#f1c27d', hair: '#a0522d' },
  { shirt: '#ff5a5f', pants: '#2b2d42', skin: '#8d5524', hair: '#111111' },
  { shirt: '#9b5de5', pants: '#1d3557', skin: '#e0ac69', hair: '#f4d35e' },
  { shirt: '#f5f7ff', pants: '#c1121f', skin: '#ffdbac', hair: '#5a3825' },
  { shirt: '#ffd166', pants: '#073b4c', skin: '#c68642', hair: '#2d1e12' },
  { shirt: '#06d6a0', pants: '#5f0f40', skin: '#8d5524', hair: '#e85d04' },
];

export const paletteColors = (index: number): AvatarColors => AVATAR_PALETTE[((index % AVATAR_PALETTE.length) + AVATAR_PALETTE.length) % AVATAR_PALETTE.length]!;

/** Pose objetivo de cada locomoción (ángulos en rad). Datos, no código. */
interface Pose {
  armSwing: number;
  legSwing: number;
  /** Frecuencia de zancada por m/s. */
  cadence: number;
  lean: number;
  armsUp: number;
  legsTuck: number;
  bob: number;
}

const POSES: Record<Locomotion, Pose> = {
  idle: { armSwing: 0.05, legSwing: 0, cadence: 0, lean: 0, armsUp: 0, legsTuck: 0, bob: 0.02 },
  walk: { armSwing: 0.7, legSwing: 0.75, cadence: 2.1, lean: 0.06, armsUp: 0, legsTuck: 0, bob: 0.05 },
  run: { armSwing: 1.1, legSwing: 1.0, cadence: 1.75, lean: 0.22, armsUp: 0.2, legsTuck: 0, bob: 0.09 },
  jump: { armSwing: 0, legSwing: 0, cadence: 0, lean: 0.05, armsUp: 2.4, legsTuck: 0.6, bob: 0 },
  fall: { armSwing: 0, legSwing: 0, cadence: 0, lean: -0.05, armsUp: 1.3, legsTuck: 0.25, bob: 0 },
};

/**
 * Personaje provisional low poly (cajas) con animación procedural por
 * locomoción. Solo es la VISTA: el estado viene de un PlayerState (local hoy,
 * del servidor mañana) y se interpola entre ticks. Valdrá tal cual para los
 * jugadores remotos.
 */
export class PlayerAvatar {
  readonly root = new Group();
  private readonly pivot = new Group();
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
  private phase = 0;
  private speed = 0;
  private locomotion: Locomotion = 'idle';
  private landTimer = 0;
  private time = 0;
  /** Pose actual suavizada. */
  private readonly pose: Pose = { ...POSES.idle };
  readonly velocity = new Vector3();

  constructor(colors: AvatarColors = DEFAULT_COLORS, castShadow = true, useBlobShadow = false) {
    const mat = new MeshLambertMaterial({ vertexColors: true });
    const limb = (geo: ReturnType<typeof box>) => {
      const m = new Mesh(geo, mat);
      m.castShadow = castShadow;
      return m;
    };

    // Torso + cabeza + pelo + ojos + mochila en una sola malla
    const torso = new Mesh(
      merge([
        box(0.62, 0.7, 0.36, colors.shirt, 0, 0.35, 0),
        box(0.5, 0.48, 0.46, colors.skin, 0, 0.96, 0),
        box(0.54, 0.16, 0.5, colors.hair, 0, 1.24, -0.02),
        box(0.54, 0.3, 0.12, colors.hair, 0, 1.06, -0.21),
        box(0.08, 0.08, 0.02, '#1d1d1d', -0.12, 1.0, 0.235),
        box(0.08, 0.08, 0.02, '#1d1d1d', 0.12, 1.0, 0.235),
        box(0.46, 0.5, 0.2, '#4c8c4a', 0, 0.35, -0.27),
      ]),
      mat,
    );
    torso.castShadow = castShadow;

    // El cuerpo pivota en la cadera (y = 0.8) para inclinarse al correr.
    this.legL = limb(box(0.24, 0.8, 0.28, colors.pants, 0, -0.4, 0));
    this.legR = limb(box(0.24, 0.8, 0.28, colors.pants, 0, -0.4, 0));
    this.legL.position.set(-0.15, 0.8, 0);
    this.legR.position.set(0.15, 0.8, 0);
    const armGeo = () => merge([box(0.18, 0.55, 0.2, colors.shirt, 0, -0.27, 0), box(0.16, 0.16, 0.18, colors.skin, 0, -0.62, 0)]);
    this.armL = limb(armGeo());
    this.armR = limb(armGeo());
    this.armL.position.set(-0.41, 0.65, 0);
    this.armR.position.set(0.41, 0.65, 0);

    this.body.position.y = 0.8;
    this.body.add(torso, this.armL, this.armR);
    this.pivot.add(this.body, this.legL, this.legR);
    this.root.add(this.pivot);

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
    // Aterrizaje detectado desde el propio estado (sirve igual para jugadores remotos).
    const wasAirborne = this.locomotion === 'jump' || this.locomotion === 'fall';
    const impactSpeed = -this.velocity.y;
    const landed = wasAirborne && s.grounded;
    if (snap) this.prev.set(s.position.x, s.position.y, s.position.z);
    else this.prev.copy(this.curr);
    this.prevYaw = snap ? s.yaw : this.currYaw;
    this.curr.set(s.position.x, s.position.y, s.position.z);
    this.currYaw = s.yaw;
    this.velocity.set(s.velocity.x, s.velocity.y, s.velocity.z);
    this.speed = Math.hypot(s.velocity.x, s.velocity.z);
    this.locomotion = s.locomotion;
    if (landed && impactSpeed > 4) this.landTimer = Math.min(0.22, 0.08 + impactSpeed * 0.012);
  }

  /** Interpola entre los dos últimos ticks y anima. */
  render(alpha: number, dt: number): void {
    this.root.position.lerpVectors(this.prev, this.curr, alpha);
    this.root.rotation.y = this.prevYaw + wrapAngle(this.currYaw - this.prevYaw) * alpha;
    this.time += dt;

    // Mezcla suave hacia la pose de la locomoción actual.
    const target = POSES[this.locomotion];
    const p = this.pose;
    const k = 12;
    for (const key of Object.keys(p) as (keyof Pose)[]) p[key] = damp(p[key], target[key], k, dt);

    this.phase += dt * this.speed * p.cadence;
    const s = Math.sin(this.phase);
    const amp = Math.min(this.speed / PLAYER.walkSpeed, 1.2);
    const legSwing = s * p.legSwing * amp;
    const armSwing = s * p.armSwing * amp;
    const idleBreath = this.locomotion === 'idle' ? Math.sin(this.time * 2.2) : 0;

    this.legL.rotation.x = legSwing - p.legsTuck;
    this.legR.rotation.x = -legSwing - p.legsTuck * 0.4;
    this.armL.rotation.x = -armSwing - p.armsUp;
    this.armR.rotation.x = armSwing - p.armsUp;
    this.armL.rotation.z = -0.05 - idleBreath * 0.03 - p.armsUp * 0.12;
    this.armR.rotation.z = 0.05 + idleBreath * 0.03 + p.armsUp * 0.12;
    this.body.rotation.x = p.lean;

    // Rebote al caminar/correr + respiración en reposo.
    let bob = Math.abs(Math.cos(this.phase)) * p.bob * amp + idleBreath * p.bob * 0.5;
    // Aplastamiento al aterrizar.
    let squash = 1;
    if (this.landTimer > 0) {
      this.landTimer = Math.max(0, this.landTimer - dt);
      const t = this.landTimer / 0.22;
      squash = 1 - Math.sin(t * Math.PI) * 0.18;
      bob -= (1 - squash) * 0.5;
    }
    this.pivot.position.y = bob;
    this.pivot.scale.set(2 - squash, squash, 2 - squash);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  /** Libera geometrías y materiales (al salir un jugador remoto). */
  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material;
      (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
    });
  }
}
