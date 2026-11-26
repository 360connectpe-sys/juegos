import { OrthographicCamera, Vector3 } from 'three';
import { CAMERA } from '@shared/constants';
import { clamp, damp } from '@shared/math';

export interface Frustum {
  halfWidth: number;
  halfHeight: number;
}

/** Calcula el frustum ortográfico: altura fija, y ancho mínimo en pantallas verticales. */
export function computeFrustum(aspect: number, viewHeight: number = CAMERA.viewHeight, minViewWidth: number = CAMERA.minViewWidth): Frustum {
  let halfHeight = viewHeight / 2;
  let halfWidth = halfHeight * aspect;
  if (halfWidth * 2 < minViewWidth) {
    halfWidth = minViewWidth / 2;
    halfHeight = halfWidth / aspect;
  }
  return { halfWidth, halfHeight };
}

/** Punto al que mira la cámara: posición + adelanto en la dirección de la velocidad (limitado). */
export function lookAheadTarget(px: number, pz: number, vx: number, vz: number): { x: number; z: number } {
  let ax = vx * CAMERA.lookAhead;
  let az = vz * CAMERA.lookAhead;
  const len = Math.hypot(ax, az);
  if (len > CAMERA.maxLookAhead) {
    ax = (ax / len) * CAMERA.maxLookAhead;
    az = (az / len) * CAMERA.maxLookAhead;
  }
  return { x: px + ax, z: pz + az };
}

/** Dirección de la cámara isométrica verdadera: desde (+1,+1,+1). */
export const ISO_OFFSET = new Vector3(1, 1, 1).normalize();

/**
 * Cámara ortográfica isométrica con seguimiento suave:
 *  - horizontal rápido con adelanto según la velocidad (ves hacia dónde vas),
 *  - vertical más lento (los saltos no marean),
 *  - zoom limitado (rueda, +/-).
 */
export class IsometricCamera {
  readonly camera: OrthographicCamera;
  private readonly target = new Vector3();
  private readonly offset = ISO_OFFSET.clone().multiplyScalar(CAMERA.distance);
  private aspect = 1;
  zoom = 1;
  private zoomTarget = 1;

  constructor(aspect: number) {
    this.aspect = aspect;
    const f = computeFrustum(aspect);
    this.camera = new OrthographicCamera(-f.halfWidth, f.halfWidth, f.halfHeight, -f.halfHeight, 0.1, 200);
    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);
  }

  resize(aspect: number): void {
    this.aspect = aspect;
    this.applyFrustum();
  }

  private applyFrustum(): void {
    const f = computeFrustum(this.aspect, CAMERA.viewHeight * this.zoom, CAMERA.minViewWidth * this.zoom);
    this.camera.left = -f.halfWidth;
    this.camera.right = f.halfWidth;
    this.camera.top = f.halfHeight;
    this.camera.bottom = -f.halfHeight;
    this.camera.updateProjectionMatrix();
  }

  addZoom(delta: number): void {
    this.zoomTarget = clamp(this.zoomTarget + delta, CAMERA.minZoom, CAMERA.maxZoom);
  }

  snapTo(p: Vector3): void {
    this.target.copy(p);
    this.apply();
  }

  /** Sigue al jugador. `v` es su velocidad (m/s) para el adelanto. */
  follow(p: Vector3, vx: number, vz: number, dt: number): void {
    const aim = lookAheadTarget(p.x, p.z, vx, vz);
    this.target.x = damp(this.target.x, aim.x, CAMERA.followLerp, dt);
    this.target.z = damp(this.target.z, aim.z, CAMERA.followLerp, dt);
    this.target.y = damp(this.target.y, p.y, CAMERA.verticalLerp, dt);
    if (Math.abs(this.zoom - this.zoomTarget) > 1e-3) {
      this.zoom = damp(this.zoom, this.zoomTarget, 10, dt);
      this.applyFrustum();
    }
    this.apply();
  }

  get focus(): Vector3 {
    return this.target;
  }

  private apply(): void {
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
  }
}
