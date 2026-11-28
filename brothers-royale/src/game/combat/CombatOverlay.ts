import { StructureHealth } from './StructureHealth';
import { type Camera, Vector3 } from 'three';
import type { Vec3 } from '@shared/types';

/**
 * Capa DOM del combate (sin React por frame): mira, marcador de acierto,
 * destello de daño recibido y números de daño flotantes. Los números son un
 * grupo fijo de elementos reutilizados que se proyectan desde el mundo en
 * cada frame (0 draw calls).
 */
interface Marker {
  el: HTMLSpanElement;
  at: Vector3;
  t: number;
  live: boolean;
}

const MARKER_LIFE = 0.85;

export class CombatOverlay {
  static readonly MAX_MARKERS = 20;
  readonly root: HTMLDivElement;
  readonly structures: StructureHealth;
  private readonly scope: HTMLDivElement;
  private scopeZoom = 0;
  private readonly crosshair: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly hurt: HTMLDivElement;
  private readonly markers: Marker[] = [];
  private next = 0;
  private hitT = 0;
  private hurtT = 0;
  private readonly v = new Vector3();
  /** Fase 12: barra de salud del zombi al que se apunta. */
  private readonly bar: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly barAt = new Vector3();
  private barOn = false;

  constructor(doc: Document = document) {
    this.root = doc.createElement('div');
    this.root.className = 'combat-layer';
    this.structures=new StructureHealth(this.root);
    this.root.setAttribute('aria-hidden', 'true');
    this.hurt = doc.createElement('div');
    this.hurt.className = 'combat-hurt';
    this.crosshair = doc.createElement('div');
    this.crosshair.className = 'crosshair';
    for (const side of ['t', 'r', 'b', 'l']) {
      const s = doc.createElement('i');
      s.className = `crosshair__${side}`;
      this.crosshair.append(s);
    }
    this.hitmarker = doc.createElement('div');
    this.hitmarker.className = 'hitmarker';
    this.bar = doc.createElement('div');
    this.bar.className = 'zbar';
    this.bar.style.display = 'none';
    this.barFill = doc.createElement('div');
    this.barFill.className = 'zbar__fill';
    this.bar.append(this.barFill);
    this.scope = doc.createElement('div');
    this.scope.className = 'optic';
    this.scope.style.display='none';
    this.scope.innerHTML='<div class="optic__lens"><svg viewBox="0 0 100 100"><path d="M0 50h43m14 0h43M50 0v43m0 14v43M40 60h20M44 70h12M47 80h6"/><circle cx="50" cy="50" r="1"/></svg><span class="optic__label"></span></div>';
    this.root.append(this.scope);
    this.root.append(this.hurt, this.crosshair, this.hitmarker, this.bar);
    for (let i = 0; i < CombatOverlay.MAX_MARKERS; i++) {
      const el = doc.createElement('span');
      el.className = 'dmg';
      el.style.display = 'none';
      this.root.append(el);
      this.markers.push({ el, at: new Vector3(), t: 0, live: false });
    }
  }

  attach(parent: HTMLElement): void {
    parent.append(this.root);
  }

  /** Número de daño en un punto del mundo (lo ve quien acierta). */
  damage(at: Vec3, amount: number, kill: boolean): void {
    const m = this.markers[this.next]!;
    this.next = (this.next + 1) % this.markers.length;
    m.at.set(at.x, at.y + 0.35, at.z);
    m.t = 0;
    m.live = true;
    m.el.textContent = String(Math.round(amount));
    m.el.className = `dmg${kill ? ' dmg--kill' : amount >= 40 ? ' dmg--big' : ''}`;
    m.el.style.display = '';
  }

  hit(kill: boolean): void {
    this.hitT = kill ? 0.35 : 0.18;
    this.hitmarker.classList.toggle('hitmarker--kill', kill);
  }

  /** Zombi apuntado (o null): barra de vida sobre su cabeza. */
  aimTarget(at: Vec3 | null, fraction: number): void {
    this.barOn = at !== null;
    if (!at) { this.bar.style.display = 'none'; return; }
    this.barAt.set(at.x, at.y + 2.15, at.z);
    this.barFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  }

  hurtFlash(): void {
    this.hurtT = 0.45;
  }

  /**
   * @param crosshairPx semiapertura de la mira en px (0 = oculta).
   */
  setScope(zoom: 0 | 2 | 4): void {
    if(this.scopeZoom===zoom)return;
    this.scopeZoom=zoom; this.scope.style.display=zoom?'':'none'; this.scope.dataset.zoom=String(zoom);
    this.scope.querySelector('.optic__label')!.textContent=zoom ? `x${zoom}` : '';
  }
  frame(camera: Camera, width: number, height: number, dt: number, crosshairPx: number): void {
    this.crosshair.style.display = crosshairPx > 0 && !this.scopeZoom ? '' : 'none';
    if (crosshairPx > 0) this.crosshair.style.setProperty('--gap', `${Math.min(80, crosshairPx).toFixed(1)}px`);
    this.hitT = Math.max(0, this.hitT - dt);
    this.hitmarker.style.opacity = this.hitT > 0 ? String(Math.min(1, this.hitT * 8)) : '0';
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.hurt.style.opacity = this.hurtT > 0 ? String(this.hurtT * 1.4) : '0';
    if (this.barOn) {
      this.v.copy(this.barAt).project(camera);
      const show = this.v.z <= 1 && this.v.z >= -1;
      this.bar.style.display = show ? '' : 'none';
      if (show) this.bar.style.transform = `translate(${(((this.v.x + 1) / 2) * width).toFixed(1)}px, ${(((1 - this.v.y) / 2) * height).toFixed(1)}px) translate(-50%, -50%)`;
    }
    for (const m of this.markers) {
      if (!m.live) continue;
      m.t += dt;
      if (m.t >= MARKER_LIFE) {
        m.live = false;
        m.el.style.display = 'none';
        continue;
      }
      this.v.copy(m.at);
      this.v.y += m.t * 0.9;
      this.v.project(camera);
      if (this.v.z > 1 || this.v.z < -1) {
        m.el.style.opacity = '0';
        continue;
      }
      const x = ((this.v.x + 1) / 2) * width;
      const y = ((1 - this.v.y) / 2) * height;
      m.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${(1 + (1 - m.t / MARKER_LIFE) * 0.25).toFixed(2)})`;
      m.el.style.opacity = String(Math.min(1, (MARKER_LIFE - m.t) * 3));
    }
  }

  dispose(): void {
    this.structures.dispose();
    this.root.remove();
  }
}
