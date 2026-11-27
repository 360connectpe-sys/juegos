/**
 * Sonidos ligeros sintetizados con WebAudio (sin archivos que descargar):
 * disparos por arma, golpe de hacha, impacto, marcador de acierto, baja,
 * recarga, clic sin balas, curación y daño recibido. Con un tope de voces
 * simultáneas para no saturar CPU en móviles. El AudioContext se crea en el
 * primer gesto del jugador (política de autoplay de los navegadores).
 */
import type { WeaponKind } from '@shared/items';

export type SoundName = WeaponKind | 'axe' | 'hit' | 'kill' | 'hurt' | 'reload' | 'empty' | 'heal' | 'impact';

interface Voice {
  end: number;
}

/** Parámetros de cada sonido: ruido filtrado y/o tono con envolvente. Datos, no código. */
const PRESETS: Record<SoundName, { noise: number; tone: number; freq: number; filter: number; decay: number; gain: number }> = {
  pistol: { noise: 1, tone: 0.3, freq: 160, filter: 2600, decay: 0.12, gain: 0.5 },
  smg: { noise: 1, tone: 0.2, freq: 220, filter: 3200, decay: 0.07, gain: 0.35 },
  rifle: { noise: 1, tone: 0.35, freq: 120, filter: 2000, decay: 0.16, gain: 0.55 },
  shotgun: { noise: 1, tone: 0.45, freq: 80, filter: 1400, decay: 0.28, gain: 0.7 },
  axe: { noise: 0.6, tone: 0, freq: 0, filter: 900, decay: 0.14, gain: 0.3 },
  impact: { noise: 0.5, tone: 0, freq: 0, filter: 1800, decay: 0.05, gain: 0.18 },
  hit: { noise: 0, tone: 1, freq: 1250, filter: 0, decay: 0.06, gain: 0.25 },
  kill: { noise: 0, tone: 1, freq: 660, filter: 0, decay: 0.35, gain: 0.35 },
  hurt: { noise: 0.3, tone: 0.8, freq: 90, filter: 600, decay: 0.2, gain: 0.45 },
  reload: { noise: 0.4, tone: 0.5, freq: 520, filter: 3000, decay: 0.05, gain: 0.25 },
  empty: { noise: 0, tone: 1, freq: 900, filter: 0, decay: 0.03, gain: 0.2 },
  heal: { noise: 0, tone: 1, freq: 520, filter: 0, decay: 0.4, gain: 0.25 },
};

export class SoundFx {
  static readonly MAX_VOICES = 10;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices: Voice[] = [];
  private _volume = 0.7;
  private readonly unlock = () => this.ensure();

  constructor(private readonly target: Window | null = typeof window === 'undefined' ? null : window) {
    target?.addEventListener('pointerdown', this.unlock);
    target?.addEventListener('keydown', this.unlock);
  }

  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this._volume;
  }

  get volume(): number {
    return this._volume;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return this.ctx;
    }
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this._volume;
    this.master.connect(this.ctx.destination);
    // 0,4 s de ruido blanco reutilizable (determinista: sin Math.random).
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return this.ctx;
  }

  /**
   * Reproduce un sonido. `distance` (m) atenúa y `pan` (-1..1) lo coloca a
   * izquierda/derecha. Si no hay audio disponible, no hace nada.
   */
  play(name: SoundName, distance = 0, pan = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this._volume <= 0 || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length >= SoundFx.MAX_VOICES) return;
    const p = PRESETS[name];
    const att = 1 / (1 + distance / 12);
    if (att < 0.04) return;
    const out = ctx.createGain();
    out.gain.setValueAtTime(p.gain * att, now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
    let tail: AudioNode = out;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      out.connect(panner);
      tail = panner;
    }
    tail.connect(this.master);
    if (p.noise > 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = p.filter;
      const g = ctx.createGain();
      g.gain.value = p.noise;
      src.connect(f).connect(g).connect(out);
      src.start(now, Math.random() * 0.2, p.decay + 0.02);
    }
    if (p.tone > 0) {
      const osc = ctx.createOscillator();
      osc.type = name === 'heal' || name === 'kill' || name === 'hit' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(p.freq, now);
      if (name === 'heal' || name === 'kill') osc.frequency.linearRampToValueAtTime(p.freq * 1.5, now + p.decay);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(30, p.freq * 0.5), now + p.decay);
      const g = ctx.createGain();
      g.gain.value = p.tone;
      osc.connect(g).connect(out);
      osc.start(now);
      osc.stop(now + p.decay + 0.02);
    }
    this.voices.push({ end: now + p.decay + 0.03 });
  }

  dispose(): void {
    this.target?.removeEventListener('pointerdown', this.unlock);
    this.target?.removeEventListener('keydown', this.unlock);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
