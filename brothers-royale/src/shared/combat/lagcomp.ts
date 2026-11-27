/**
 * Compensación de latencia: el servidor guarda la posición de cada jugador en
 * los últimos ticks y, al resolver un disparo, coloca a los objetivos donde
 * los VEÍA el atacante (su `viewTick`, interpolación incluida). El rebobinado
 * se limita a LAG_COMPENSATION.maxRewindTicks: con más latencia hay que
 * adelantar el tiro, y nadie puede "disparar al pasado" a voluntad.
 */
import type { Vec3 } from '../types';
import type { TargetPose } from './CombatState';
import { LAG_COMPENSATION } from './weapons';

const CAPACITY = 32;

export class PoseHistory {
  private readonly ring = new Map<string, { tick: number; feet: Vec3 }[]>();

  record(tick: number, id: string, feet: Vec3): void {
    let buf = this.ring.get(id);
    if (!buf) {
      buf = [];
      this.ring.set(id, buf);
    }
    buf.push({ tick, feet: { x: feet.x, y: feet.y, z: feet.z } });
    if (buf.length > CAPACITY) buf.shift();
  }

  forget(id: string): void {
    this.ring.delete(id);
  }

  /** Tick efectivo de rebobinado para un tick visto (limitado). */
  static clampTick(now: number, viewTick: number | undefined): number {
    if (viewTick === undefined || !Number.isFinite(viewTick)) return now;
    return Math.max(now - LAG_COMPENSATION.maxRewindTicks, Math.min(now, Math.round(viewTick)));
  }

  /** Pose de `id` en `tick` (o la más cercana anterior conocida). */
  pose(id: string, tick: number): Vec3 | null {
    const buf = this.ring.get(id);
    if (!buf || buf.length === 0) return null;
    for (let i = buf.length - 1; i >= 0; i--) if (buf[i]!.tick <= tick) return buf[i]!.feet;
    return buf[0]!.feet;
  }

  /** Poses de los jugadores dados en el tick visto (limitado). */
  *at(now: number, viewTick: number | undefined, ids: Iterable<string>): Generator<TargetPose> {
    const tick = PoseHistory.clampTick(now, viewTick);
    for (const id of ids) {
      const feet = this.pose(id, tick);
      if (feet) yield { id, feet };
    }
  }
}
