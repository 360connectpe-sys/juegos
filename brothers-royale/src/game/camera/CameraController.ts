import { type Camera, PerspectiveCamera, Vector3 } from 'three';
import type { IsometricCamera } from '@/engine/IsometricCamera';
import {
  applyLook,
  forwardFromYaw,
  hideOwnAvatar,
  pivotPoint,
  resolveCameraDistance,
  smoothCameraDistance,
  thirdPersonDirection,
  type CameraMode,
  type LookState,
} from '@/engine/camera/cameraMath';
import { CAMERA_RIG, PLAYER } from '@shared/constants';
import { clamp } from '@shared/math';
import type { Vec3 } from '@shared/types';

/** Consulta de colisión para la cámara (esfera): distancia al primer obstáculo o null. */
export type CameraCollider = (origin: Vec3, dir: Vec3, maxDistance: number, radius: number) => number | null;

/**
 * Cámaras del jugador: isométrica (ortográfica, la de siempre), tercera
 * persona detrás del personaje (sobre el hombro, con colisión) y primera
 * persona (ojos). SOLO es vista: nunca toca la simulación; lo único que
 * aporta al juego es el yaw para orientar el movimiento y el apuntado.
 */
export class CameraController {
  mode: CameraMode = 'isometric';
  readonly perspective = new PerspectiveCamera(CAMERA_RIG.fov, 1, CAMERA_RIG.near, CAMERA_RIG.far);
  readonly look: LookState = { yaw: 0, pitch: 0.2 };
  /** Distancia de 3ª persona deseada (rueda/pinza) y la real tras colisiones. */
  desiredDistance: number = CAMERA_RIG.thirdDistance;
  distance: number = CAMERA_RIG.thirdDistance;
  /** Último resultado de colisión (para pruebas y depuración). */
  lastHit: number | null = null;
  /** Apuntando (1ª/3ª): la cámara se acerca un poco (solo vista). */
  aiming = false;
  magnification: 1 | 2 | 4 = 1;
  private zoomK = 1;
  private readonly forwardVec = new Vector3();
  private readonly focusPoint = new Vector3();
  private readonly tmp = new Vector3();

  constructor(
    private readonly iso: IsometricCamera,
    private readonly collide: CameraCollider | null = null,
  ) {
    this.perspective.rotation.order = 'YXZ';
  }

  get camera(): Camera {
    return this.mode === 'isometric' ? this.iso.camera : this.perspective;
  }

  /** Cambia de perspectiva. La mirada arranca alineada con el personaje. */
  setMode(mode: CameraMode, characterYaw = this.look.yaw): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.look.yaw = characterYaw;
    this.look.pitch = mode === 'first' ? 0 : 0.25;
    this.distance = this.desiredDistance;
    this.perspective.fov = mode === 'first' ? CAMERA_RIG.firstFov : CAMERA_RIG.fov;
    this.perspective.updateProjectionMatrix();
  }

  resize(aspect: number): void {
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
  }

  /** Giro de mirada en radianes (ratón, arrastre táctil, stick derecho). */
  addLook(dYaw: number, dPitch: number): void {
    if (this.mode === 'isometric') return;
    applyLook(this.look, dYaw, dPitch, this.mode);
  }

  /** Rueda / +/-: zoom isométrico o distancia de 3ª persona. */
  addZoom(delta: number): void {
    if (this.mode === 'isometric') this.iso.addZoom(delta);
    else if (this.mode === 'third')
      this.desiredDistance = clamp(this.desiredDistance + delta * 6, CAMERA_RIG.thirdMinDistance, CAMERA_RIG.thirdMaxDistance);
  }

  /** Yaw con el que se orienta el movimiento (WASD/joystick) y el apuntado. */
  get yaw(): number {
    return this.look.yaw;
  }

  get hideAvatar(): boolean {
    return hideOwnAvatar(this.mode, this.distance);
  }

  /** Dirección a la que mira la cámara en perspectiva (para apuntar). */
  forward(): Vector3 {
    return this.perspective.getWorldDirection(this.forwardVec);
  }

  /** Centro para la sombra del sol. */
  get focus(): Vector3 {
    return this.mode === 'isometric' ? this.iso.focus : this.focusPoint;
  }

  snapTo(feet: Vector3): void {
    if (this.mode === 'isometric') this.iso.snapTo(feet);
    else this.update(feet, 0, 0, 0);
  }

  /** Coloca la cámara activa. `feet` = posición interpolada del personaje. */
  /** Fase 15: el jugador seguido está agachado (solo vista). */
  crouched = false;
  private crouchK = 0;

  update(feet: Vector3, vx: number, vz: number, dt: number): void {
    const optical = this.aiming ? this.magnification : 1;
    if (this.mode === 'isometric') {
      const cam = this.iso.camera;
      const target = optical;
      cam.zoom += (target-cam.zoom)*Math.min(1,dt>0?dt*14:1);
      cam.updateProjectionMatrix();
      this.iso.follow(feet, vx, vz, dt);
      return;
    }
    if (this.iso.camera.zoom !== 1) { this.iso.camera.zoom = 1; this.iso.camera.updateProjectionMatrix(); }
    const cam = this.perspective;
    const base = this.mode === 'first' ? CAMERA_RIG.firstFov : CAMERA_RIG.fov;
    const targetK = optical > 1 ? (2*Math.atan(Math.tan(base*Math.PI/360)/optical)*180/Math.PI)/base : this.aiming ? CAMERA_RIG.aimZoom : 1;
    this.zoomK = dt > 0 ? this.zoomK + (targetK - this.zoomK) * Math.min(1, dt * 14) : targetK;
    const fov = base * this.zoomK;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const head = pivotPoint(feet, this.mode);
    // Fase 15: agachado, la cabeza (1ª) y el hombro (3ª) bajan suavemente.
    this.crouchK += ((this.crouched ? 1 : 0) - this.crouchK) * Math.min(1, dt > 0 ? dt * 12 : 1);
    head.y -= PLAYER.crouchDrop * this.crouchK;
    this.focusPoint.set(feet.x, feet.y, feet.z);
    cam.rotation.set(-this.look.pitch, this.look.yaw + Math.PI, 0);

    if (this.mode === 'first') {
      cam.position.set(head.x, head.y, head.z);
      this.distance = 0;
      return;
    }

    // 3ª persona: sobre el hombro derecho, detrás y elevada según la inclinación.
    const f = forwardFromYaw(this.look.yaw);
    // Al apuntar, la cámara se separa más del hombro para no tapar la mira con el personaje.
    // Fase 15: al apuntar la cámara se aparta más del hombro (×2,4): el personaje no tapa el objetivo.
    const offset = CAMERA_RIG.shoulderOffset * (1 + Math.min(1, (1 - this.zoomK) / (1 - CAMERA_RIG.aimZoom)) * 1.4);
    const shoulder = { x: head.x - f.y * offset, y: head.y, z: head.z + f.x * offset };
    const d = thirdPersonDirection(this.look.yaw, this.look.pitch);
    const target = this.tmp.set(shoulder.x + d.x * this.desiredDistance, shoulder.y + d.y * this.desiredDistance, shoulder.z + d.z * this.desiredDistance);
    // Colisión: esfera desde la cabeza hasta la posición deseada.
    const dir = { x: target.x - head.x, y: target.y - head.y, z: target.z - head.z };
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= len;
    dir.y /= len;
    dir.z /= len;
    const hit = this.collide ? this.collide(head, dir, len, CAMERA_RIG.collisionRadius) : null;
    this.lastHit = hit;
    // castCameraSphere ya devuelve la distancia del CENTRO de la esfera: sin margen extra.
    const allowed = resolveCameraDistance(len, hit === null ? null : hit + CAMERA_RIG.collisionRadius, CAMERA_RIG.collisionRadius, 0);
    this.distance = dt > 0 ? smoothCameraDistance(this.distance, allowed, dt) : allowed;
    cam.position.set(head.x + dir.x * this.distance, head.y + dir.y * this.distance, head.z + dir.z * this.distance);
  }
}
