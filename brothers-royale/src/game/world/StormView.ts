import { AdditiveBlending, CylinderGeometry, DoubleSide, Mesh, ShaderMaterial } from 'three';
import type { Circle } from '@shared/battle/zone';
import type { TerrainParams } from '@shared/world/terrain';

/** Altura de la barrera (m): supera tejados y el mirador; el avión vuela por encima. */
export const STORM_WALL = { bottom: -4, height: 46, segments: 72 } as const;

const vertex = /* glsl */ `
varying vec2 vUv;
varying float vY;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vY = world.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const fragment = /* glsl */ `
uniform float uTime;
uniform float uRadius;
uniform float uPulse;
varying vec2 vUv;
varying float vY;
void main() {
  // Franjas verticales que suben despacio + bandas horizontales: se nota el borde sin tapar el combate.
  float around = vUv.x * max(8.0, uRadius * 1.1);
  float streak = 0.5 + 0.5 * sin(around * 6.2831 + vY * 0.35 - uTime * 2.2);
  float band = smoothstep(0.82, 1.0, 0.5 + 0.5 * sin(vY * 0.9 - uTime * 3.0));
  float fade = (1.0 - smoothstep(0.55, 1.0, vUv.y)) * smoothstep(0.0, 0.08, vUv.y);
  vec3 blue = vec3(0.30, 0.45, 1.0);
  vec3 violet = vec3(0.68, 0.32, 1.0);
  vec3 color = mix(blue, violet, streak) + band * 0.35;
  float alpha = (0.16 + 0.14 * streak + 0.22 * band) * fade * (0.85 + 0.3 * uPulse);
  gl_FragColor = vec4(color, alpha);
}`;

/**
 * Barrera de energía de la tormenta: UN cilindro abierto (1 draw call, sin texturas ni
 * sombras) escalado al círculo actual. Aditiva, sin escribir profundidad: deja ver a través.
 */
export class StormView {
  readonly mesh: Mesh<CylinderGeometry, ShaderMaterial>;
  private time = 0;
  constructor(_terrain: TerrainParams) {
    const geometry = new CylinderGeometry(1, 1, 1, STORM_WALL.segments, 1, true);
    geometry.translate(0, 0.5, 0);
    const material = new ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uRadius: { value: 1 }, uPulse: { value: 0 } },
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 5;
    this.mesh.matrixAutoUpdate = false;
  }
  /** `outside` = el jugador seguido recibe daño: la barrera late más fuerte. */
  update(circle: Circle | null, dt = 0, outside = false): void {
    const m = this.mesh;
    m.visible = circle !== null && circle.radius > 0.05;
    if (!circle || !m.visible) return;
    this.time = (this.time + dt) % 1000;
    const u = m.material.uniforms;
    u.uTime!.value = this.time;
    u.uRadius!.value = circle.radius;
    u.uPulse!.value = outside ? 0.5 + 0.5 * Math.sin(this.time * 6.2831) : 0;
    m.position.set(circle.x, STORM_WALL.bottom, circle.z);
    m.scale.set(circle.radius, STORM_WALL.height, circle.radius);
    m.updateMatrix();
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
