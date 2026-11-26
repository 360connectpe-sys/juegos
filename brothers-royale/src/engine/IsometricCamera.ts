import { OrthographicCamera, Vector3 } from 'three';
import { CAMERA } from '@shared/constants';
import { damp } from '@shared/math';

export interface Frustum {
  halfWidth: number;
  halfHeight: number;
}

/** Calcula el frustum ortográfico: altura fija, y ancho mínimo en pantallas verticales. */
export function computeFrustum(aspect: number, viewHeight = CAMERA.viewHeight, minViewWidth = CAMERA.minViewWidth): Frustum {
  let halfHeight = viewHeight / 2;
  let halfWidth = halfHeight * aspect;
  if (halfWidth * 2 < minViewWidth) {
    halfWidth = minViewWidth / 2;
    halfHeight = halfWidth / aspect;
  }
  return { halfWidth, halfHeight };
}

/** Dirección de la cámara isométrica verdadera: desde (+1,+1,+1). */
export const ISO_OFFSET = new Vector3(1, 1, 1).normalize();

export class IsometricCamera {
  readonly camera: OrthographicCamera;
  private readonly target = new Vector3();
  private readonly offset = ISO_OFFSET.clone().multiplyScalar(CAMERA.distance);

  constructor(aspect: number) {
    const f = computeFrustum(aspect);
    this.camera = new OrthographicCamera(-f.halfWidth, f.halfWidth, f.halfHeight, -f.halfHeight, 0.1, 200);
    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);
  }

  resize(aspect: number): void {
    const f = computeFrustum(aspect);
    this.camera.left = -f.halfWidth;
    this.camera.right = f.halfWidth;
    this.camera.top = f.halfHeight;
    this.camera.bottom = -f.halfHeight;
    this.camera.updateProjectionMatrix();
  }

  snapTo(p: Vector3): void {
    this.target.copy(p);
    this.apply();
  }

  follow(p: Vector3, dt: number): void {
    this.target.x = damp(this.target.x, p.x, CAMERA.followLerp, dt);
    this.target.y = damp(this.target.y, p.y, CAMERA.followLerp, dt);
    this.target.z = damp(this.target.z, p.z, CAMERA.followLerp, dt);
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
