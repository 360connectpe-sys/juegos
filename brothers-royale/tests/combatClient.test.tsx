// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BatchedMesh, Matrix4, OrthographicCamera, Scene } from 'three';
import { fullVitals, isValidCombatEvent, isValidDamageEvent, isValidVitals } from '@/net/CombatView';
import { LocalWeapon } from '@/game/combat/LocalWeapon';
import { CombatFx } from '@/game/combat/CombatFx';
import { CombatOverlay } from '@/game/combat/CombatOverlay';
import { HELD_KINDS, WeaponBatch, heldKey } from '@/game/combat/WeaponModels';
import { attackLabel } from '@/ui/components/TouchControls';
import { AmmoCounter, HealthBar, KillFeed } from '@/ui/hud/widgets';
import { DEFAULT_VOLUME, loadVolume, parseVolume, saveVolume, VOLUME_KEY } from '@/game/settings';
import { packGear, unpackGear } from '@shared/combat/gear';
import { EQUIP_SECONDS, HEALTH } from '@shared/combat/weapons';
import { addItem, createInventory, selectSlot } from '@shared/inventory';
import { isValidPlayerInput } from '@shared/inputValidation';
import { packPlayer, unpackPlayers } from '@shared/netcodec';
import { Buttons, emptyInput, type PlayerState } from '@shared/types';

const v3 = { x: 1, y: 2, z: 3 };

describe('validación en el cliente de lo que llega del servidor', () => {
  it('salud y acciones', () => {
    expect(isValidVitals(fullVitals())).toBe(true);
    expect(isValidVitals({ ...fullVitals(), hp: 101 })).toBe(false);
    expect(isValidVitals({ ...fullVitals(), hp: Number.NaN })).toBe(false);
    expect(isValidVitals({ ...fullVitals(), dead: 'no' })).toBe(false);
    expect(isValidVitals(null)).toBe(false);
  });

  it('eventos públicos de combate y daño', () => {
    const shot = { type: 'shot', by: 'a', weapon: 'smg', rarity: 'rare', origin: v3, ends: [v3], hits: [true] };
    expect(isValidCombatEvent(shot)).toBe(true);
    expect(isValidCombatEvent({ ...shot, weapon: 'medkit' })).toBe(false);
    expect(isValidCombatEvent({ ...shot, ends: Array(40).fill(v3), hits: Array(40).fill(false) })).toBe(false);
    expect(isValidCombatEvent({ ...shot, hits: [] })).toBe(false);
    expect(isValidCombatEvent({ type: 'death', victim: 'b', killer: 'a', weapon: 'axe', tick: 5, at: v3 })).toBe(true);
    expect(isValidCombatEvent({ type: 'explode' })).toBe(false);
    const dmg = { type: 'damage', victim: 'b', by: 'a', weapon: 'rifle', amount: 24, hp: 76, at: v3 };
    expect(isValidDamageEvent(dmg)).toBe(true);
    expect(isValidDamageEvent({ ...dmg, amount: HEALTH.maxShotDamage + 1 })).toBe(false); // nunca un "one-shot"
    expect(isValidDamageEvent({ ...dmg, at: { x: 1 } })).toBe(false);
  });

  it('entrada v5: pitch acotado y tick visto entero; sin ellos sigue siendo válida', () => {
    expect(isValidPlayerInput({ ...emptyInput(1), aimPitch: 0.3, viewTick: 120 }, 0)).toBe(true);
    expect(isValidPlayerInput({ ...emptyInput(1), aimPitch: 3 }, 0)).toBe(false);
    expect(isValidPlayerInput({ ...emptyInput(1), viewTick: -1 }, 0)).toBe(false);
    expect(isValidPlayerInput({ ...emptyInput(1), viewTick: 1.5 }, 0)).toBe(false);
    expect(isValidPlayerInput(emptyInput(1), 0)).toBe(true);
  });

  it('el snapshot lleva el estado de combate visible sin cambiar el tamaño', () => {
    const s: PlayerState = { id: 'a', name: 'A', position: v3, velocity: v3, yaw: 0, grounded: true, locomotion: 'run', lastProcessedSeq: 9 };
    const out: number[] = [];
    const gear = packGear({ held: 'rifle', rarity: 'epic', action: 'fire', dead: false });
    packPlayer(out, 3, s, gear);
    packPlayer(out, 4, s);
    const [a, b] = unpackPlayers(out);
    expect(a!.locomotion).toBe('run');
    expect(a!.grounded).toBe(true);
    expect(unpackGear(a!.gear)).toEqual({ held: 'rifle', rarity: 'epic', action: 'fire', dead: false });
    expect(unpackGear(b!.gear).held).toBeNull();
  });
});

describe('predicción visual del arma propia', () => {
  it('respeta cadencia, desenfundado y cargador; no dispara recargando ni eliminado', () => {
    const w = new LocalWeapon();
    let inv = addItem(createInventory(), { kind: 'pistol', qty: 1, mag: 2 }).inventory;
    inv = selectSlot(inv, 1);
    const fire = { ...emptyInput(1), buttons: Buttons.FIRE };
    const dt = 1 / 30;
    let shots = 0;
    w.tick(fire, inv, fullVitals(), dt); // primer contacto con el hueco: sin desenfundar
    for (let i = 0; i < 60; i++) if (w.tick(fire, inv, fullVitals(), dt)) shots++;
    expect(shots).toBe(1); // ya había disparado uno en el primer tick → quedaban 2, total 2
    w.sync(inv);
    expect(w.tick(fire, inv, { ...fullVitals(), reload: 1, reloadTotal: 1.3 }, dt)).toBeNull();
    expect(w.tick(fire, inv, { ...fullVitals(), dead: true }, dt)).toBeNull();
    // Cambiar de hueco exige desenfundar.
    const axe = selectSlot(inv, 0);
    expect(w.tick(fire, axe, fullVitals(), dt)).toBeNull();
    let swung = 0;
    for (let i = 0; i < Math.ceil(EQUIP_SECONDS / dt) + 2; i++) if (w.tick(fire, axe, fullVitals(), dt)?.type === 'melee') swung++;
    expect(swung).toBe(1);
  });
});

describe('vista del combate con pocos draw calls', () => {
  it('las armas se alojan en el lote de edificios: 0 draw calls extra', () => {
    const reserve = WeaponBatch.reserve();
    expect(reserve.instances).toBeGreaterThanOrEqual(8 + 1);
    const host = new BatchedMesh(4 + reserve.instances, 100 + reserve.vertices, 0);
    const w = new WeaponBatch(host);
    expect(w.hosted).toBe(true);
    expect(w.mesh).toBe(host);
    w.begin();
    for (let i = 0; i < 8; i++) w.place(`p${i}`, heldKey(HELD_KINDS[i % HELD_KINDS.length]!, 'rare'), new Matrix4());
    w.end();
    expect(w.count).toBe(8);
    expect(host.visible).toBe(true);
    w.begin();
    w.end();
    expect(host.visible).toBe(true); // nunca oculta los edificios
    w.release('p1');
    w.dispose(); // el anfitrión es quien libera
  });

  it('trazadoras, fogonazos y chispas en UNA InstancedMesh, oculta sin efectos', () => {
    const fx = new CombatFx();
    const scene = new Scene();
    scene.add(fx.mesh);
    expect(scene.children).toHaveLength(1);
    fx.update(0.016);
    expect(fx.mesh.visible).toBe(false);
    for (let i = 0; i < 200; i++) {
      fx.tracer({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 });
      fx.impact({ x: 10, y: 1, z: 0 }, i % 2 === 0);
    }
    fx.flash(v3);
    fx.update(0.016);
    expect(fx.mesh.visible).toBe(true);
    expect(fx.mesh.count).toBeLessThanOrEqual(CombatFx.MAX);
    fx.update(1);
    expect(fx.mesh.visible).toBe(false);
    expect(fx.active).toBe(0);
    fx.dispose();
  });

  it('números de daño reutilizan un grupo fijo de elementos DOM', () => {
    const o = new CombatOverlay(document);
    o.attach(document.body);
    const cam = new OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.updateMatrixWorld();
    for (let i = 0; i < 50; i++) o.damage({ x: 0, y: 0, z: 0 }, 24, i === 49);
    o.frame(cam, 800, 600, 0.016, 12);
    const markers = document.querySelectorAll('.dmg');
    expect(markers).toHaveLength(CombatOverlay.MAX_MARKERS);
    expect([...markers].some((m) => m.className.includes('dmg--kill'))).toBe(true);
    expect((document.querySelector('.crosshair') as HTMLElement).style.display).toBe('');
    o.frame(cam, 800, 600, 2, 0);
    expect((document.querySelector('.crosshair') as HTMLElement).style.display).toBe('none');
    expect([...document.querySelectorAll('.dmg')].every((m) => (m as HTMLElement).style.display === 'none')).toBe(true);
    o.dispose();
  });
});

describe('HUD de combate', () => {
  it('salud: redondea hacia arriba y cambia de color al bajar', () => {
    const { container, rerender } = render(<HealthBar value={0.4} />);
    expect(screen.getByRole('meter', { name: 'Salud' }).getAttribute('aria-valuenow')).toBe('1');
    expect(container.querySelector('.w-health')!.className).toContain('is-low');
    rerender(<HealthBar value={45} />);
    expect(container.querySelector('.w-health')!.className).toContain('is-mid');
  });

  it('munición: cargador, bolsa, aviso sin balas y curación', () => {
    let inv = addItem(createInventory(), { kind: 'smg', qty: 1, mag: 0 }).inventory;
    inv = addItem(inv, { kind: 'ammo_light', qty: 40 }).inventory;
    inv = selectSlot(inv, 1);
    const { rerender } = render(<AmmoCounter inventory={inv} vitals={fullVitals()} />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Munición: 0 de 30, 40 en la bolsa');
    expect(screen.getByText('Recarga')).toBeTruthy();
    rerender(<AmmoCounter inventory={inv} vitals={{ ...fullVitals(), heal: 4, healTotal: 5 }} />);
    expect(screen.getByRole('status', { name: 'Curándote' })).toBeTruthy();
  });

  it('registro de bajas y texto del botón de ataque según lo que hay en la mano', () => {
    render(<KillFeed entries={[{ key: 1, killer: 'Ana', victim: 'Beto', weapon: 'shotgun', mine: true, me: false }]} />);
    expect(screen.getByText('[escopeta]')).toBeTruthy();
    let inv = addItem(createInventory(), { kind: 'medkit', qty: 1 }).inventory;
    expect(attackLabel(inv)).toBe('Golpear');
    inv = selectSlot(inv, 1);
    expect(attackLabel(inv)).toBe('Curar');
    expect(attackLabel(selectSlot(addItem(createInventory(), { kind: 'rifle', qty: 1 }).inventory, 1))).toBe('Disparar');
    expect(attackLabel(null)).toBe('Atacar');
  });

  it('volumen guardado aparte y validado', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadVolume(st)).toBe(DEFAULT_VOLUME);
    saveVolume(0.25, st);
    expect(loadVolume(st)).toBe(0.25);
    m.set(VOLUME_KEY, 'muy alto');
    expect(loadVolume(st)).toBe(DEFAULT_VOLUME);
    expect(parseVolume(7)).toBe(1);
  });
});
