import { lerp, wrapAngle } from '@shared/math';
import type { PublicPlayer } from '@shared/netcodec';

interface Sample {
  tick: number;
  p: PublicPlayer;
}

/**
 * Interpolación de entidades remotas: se muestran ligeramente en el pasado
 * (NET.interpolationDelayTicks) entre dos snapshots conocidos, así se ven
 * fluidas aunque los paquetes lleguen con jitter. Sin extrapolación larga:
 * si faltan datos, se mantiene la última posición conocida.
 */
export class SnapshotInterpolator {
  private readonly buffers = new Map<number, Sample[]>();
  latestTick = -1;

  constructor(private readonly capacity = 32) {}

  push(tick: number, players: readonly PublicPlayer[]): void {
    if (!Number.isFinite(tick) || tick <= this.latestTick - this.capacity) return; // muy viejo
    this.latestTick = Math.max(this.latestTick, tick);
    const seen = new Set<number>();
    for (const p of players) {
      seen.add(p.netId);
      let buf = this.buffers.get(p.netId);
      if (!buf && tick < this.latestTick) continue; // No resucitar jugadores retirados.
      if (!buf) {
        buf = [];
        this.buffers.set(p.netId, buf);
      }
      // Inserción ordenada (los mensajes por WebSocket llegan en orden, pero no confiamos).
      let i = buf.length;
      while (i > 0 && buf[i - 1]!.tick > tick) i--;
      if (buf[i - 1]?.tick === tick) buf[i - 1] = { tick, p };
      else buf.splice(i, 0, { tick, p });
      if (buf.length > this.capacity) buf.shift();
    }
    // Quien ya no aparece en el snapshot más reciente se olvida.
    if (tick === this.latestTick) for (const id of [...this.buffers.keys()]) if (!seen.has(id)) this.buffers.delete(id);
  }

  clear(): void {
    this.buffers.clear();
    this.latestTick = -1;
  }

  remove(netId: number): void {
    this.buffers.delete(netId);
  }

  /** Iterador sin copiar (para el bucle por tick). */
  keys(): IterableIterator<number> {
    return this.buffers.keys();
  }

  ids(): number[] {
    return [...this.buffers.keys()];
  }

  /** Estado interpolado de `netId` en un tick (puede ser fraccionario). */
  sample(netId: number, tick: number, out?: PublicPlayer): PublicPlayer | null {
    const buf = this.buffers.get(netId);
    if (!buf || buf.length === 0) return null;
    const first = buf[0]!;
    const last = buf[buf.length - 1]!;
    if (tick <= first.tick) return copy(first.p, out);
    if (tick >= last.tick) return copy(last.p, out);
    let i = buf.length - 1;
    while (i > 0 && buf[i - 1]!.tick > tick) i--;
    const a = buf[i - 1]!;
    const b = buf[i]!;
    const t = (tick - a.tick) / (b.tick - a.tick);
    const r = copy(t < 0.5 ? a.p : b.p, out); // campos discretos del más cercano
    r.x = lerp(a.p.x, b.p.x, t);
    r.y = lerp(a.p.y, b.p.y, t);
    r.z = lerp(a.p.z, b.p.z, t);
    r.vx = lerp(a.p.vx, b.p.vx, t);
    r.vy = lerp(a.p.vy, b.p.vy, t);
    r.vz = lerp(a.p.vz, b.p.vz, t);
    r.yaw = a.p.yaw + wrapAngle(b.p.yaw - a.p.yaw) * t;
    return r;
  }
}

function copy(p: PublicPlayer, out?: PublicPlayer): PublicPlayer {
  return out ? Object.assign(out, p) : { ...p };
}
