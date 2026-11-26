import { AmbientLight, Color, DirectionalLight, Fog, HemisphereLight, Object3D, Scene, Vector3 } from 'three';
import type { QualitySettings } from './quality';

export const PALETTE = {
  sky: new Color('#8fd3ff'),
  ground: new Color('#5a8f3c'),
  sun: new Color('#fff1d6'),
};

/**
 * Iluminación básica barata: hemisférica + ambiental + un sol direccional.
 * La sombra del sol cubre solo la zona alrededor del jugador y lo sigue,
 * así el shadow map pequeño sirve para un mapa grande.
 */
export class Lighting {
  readonly sun: DirectionalLight;
  private readonly sunOffset = new Vector3(18, 30, 10);
  private readonly sunTarget = new Object3D();

  constructor(scene: Scene, quality: QualitySettings) {
    scene.background = PALETTE.sky.clone();
    scene.fog = new Fog(PALETTE.sky.getHex(), 45, 95);

    scene.add(new HemisphereLight(PALETTE.sky, PALETTE.ground, 1.1));
    scene.add(new AmbientLight(0xffffff, 0.25));

    this.sun = new DirectionalLight(PALETTE.sun, 2.2);
    this.sun.position.copy(this.sunOffset);
    this.sun.target = this.sunTarget;
    scene.add(this.sun, this.sunTarget);

    if (quality.shadows) {
      this.sun.castShadow = true;
      const s = this.sun.shadow;
      s.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      const r = 22;
      s.camera.left = -r;
      s.camera.right = r;
      s.camera.top = r;
      s.camera.bottom = -r;
      s.camera.near = 1;
      s.camera.far = 80;
      s.bias = -0.0005;
      s.normalBias = 0.03;
    }
  }

  /** Mueve el sol junto al foco (en pasos de texel para evitar parpadeo). */
  follow(focus: Vector3): void {
    const snap = 0.5;
    const x = Math.round(focus.x / snap) * snap;
    const z = Math.round(focus.z / snap) * snap;
    this.sunTarget.position.set(x, 0, z);
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
  }
}
