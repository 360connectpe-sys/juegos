// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventBus } from '@/core/EventBus';
import type { Game, GameEvents } from '@/game/Game';
import { InputManager } from '@/game/input/InputManager';
import { GamepadSource, PAD } from '@/game/input/sources';
import { ChestView, PickupView } from '@/game/world/Loot';
import { isValidPickup, ReplicatedMatch } from '@/net/MatchView';
import { OfflineSession } from '@/net/OfflineSession';
import { loadRapier, PhysicsWorld } from '@/physics/PhysicsWorld';
import { InteractPrompt } from '@/ui/components/InteractPrompt';
import { Inventory } from '@/ui/hud/widgets';
import { addItem, createInventory } from '@shared/inventory';
import { Buttons, emptyInput, hasButton } from '@shared/types';
import { worldColliders } from '@shared/world/colliders';
import { generateWorldLayout } from '@shared/world/layout';

afterEach(cleanup);
const layout = generateWorldLayout();

describe('réplica de la partida en el cliente', () => {
  it('aplica lo que manda el servidor y descarta datos mal formados', () => {
    const r = new ReplicatedMatch(layout.chests);
    r.load({ opened: [1, 999, -3], pickups: [{ id: 1, item: { kind: 'rifle', qty: 1, rarity: 'epic' }, x: 1, y: 0, z: 1 }, { id: 2, item: { kind: 'escudo', qty: 1 }, x: 0, y: 0, z: 0 } as never] }, createInventory());
    expect(r.opened.filter(Boolean)).toHaveLength(1);
    expect([...r.pickups.keys()]).toEqual([1]);
    expect(r.apply({ type: 'chestOpened', chestId: 9999, by: 'x' })).toBeNull();
    expect(r.apply({ type: 'pickupAdded', pickup: { id: 3, item: { kind: 'medkit', qty: Number.NaN }, x: 0, y: 0, z: 0 } })).toBeNull();
    expect(r.apply({ type: 'pickupRemoved', id: 1 })).not.toBeNull();
    expect(r.setInventory({ slots: [null, null, null, null, null], ammo: {}, selected: 0 })).toBeNull();
    expect(r.inventory?.slots[0]?.kind).toBe('axe');
    expect(isValidPickup({ id: 1, item: { kind: 'pistol', qty: 1 }, x: 0, y: Infinity, z: 0 })).toBe(false);
  });
});

describe('sin conexión: misma autoridad local', () => {
  it('abrir un cofre y recoger con INTERACT (flanco) en OfflineSession', async () => {
    const physics = new PhysicsWorld(await loadRapier());
    physics.addTerrain(layout.terrain);
    worldColliders(layout).forEach((c) => physics.addStatic(c));
    const chest = layout.chests.find((c) => c.where === 'outside')!;
    const s = new OfflineSession(physics, { x: chest.x + Math.sin(chest.yaw) * 1.3, y: chest.y + 0.1, z: chest.z + Math.cos(chest.yaw) * 1.3 }, 'Yo', layout.chests, 7);
    const events: string[] = [];
    s.onMatchEvent = (e) => events.push(e.type);
    expect(s.match.inventory?.slots[0]?.kind).toBe('axe');
    let seq = 0;
    for (let i = 0; i < 10; i++) s.tick(emptyInput(++seq), 1 / 30);
    s.tick({ ...emptyInput(++seq), buttons: Buttons.INTERACT }, 1 / 30);
    expect(s.match.opened[chest.id]).toBe(true);
    s.tick({ ...emptyInput(++seq), buttons: Buttons.INTERACT }, 1 / 30); // mantenido: nada nuevo
    const n = events.length;
    s.tick(emptyInput(++seq), 1 / 30);
    s.tick({ ...emptyInput(++seq), buttons: Buttons.INTERACT }, 1 / 30); // nueva pulsación: recoge
    expect(events.length).toBeGreaterThan(n);
    expect(events).toContain('inventory');
    s.selectSlot(2);
    expect(s.match.inventory?.selected).toBe(2);
    s.dispose();
    physics.dispose();
  });
});

describe('vistas instanciadas', () => {
  it('todos los cofres en 2 InstancedMesh; la tapa se abre animada', () => {
    const v = new ChestView(layout.chests, false);
    expect(v.body.count).toBe(layout.chests.length);
    expect(v.lid.count).toBe(layout.chests.length);
    v.setOpened(0, true);
    const before = v.lid.instanceMatrix.array.slice(0, 16);
    v.update(0.5);
    expect(Array.from(v.lid.instanceMatrix.array.slice(0, 16))).not.toEqual(Array.from(before));
  });
  it('objetos: 3 InstancedMesh, altas y bajas sin huecos', () => {
    const v = new PickupView();
    v.reset([
      { id: 1, item: { kind: 'rifle', qty: 1, rarity: 'rare' }, x: 0, y: 0, z: 0 },
      { id: 2, item: { kind: 'pistol', qty: 1, rarity: 'common' }, x: 1, y: 0, z: 0 },
      { id: 3, item: { kind: 'ammo_light', qty: 30 }, x: 2, y: 0, z: 0 },
      { id: 4, item: { kind: 'medkit', qty: 1 }, x: 3, y: 0, z: 0 },
    ]);
    expect(v.meshes.weapon.count).toBe(2);
    expect(v.meshes.ammo.count).toBe(1);
    expect(v.meshes.heal.count).toBe(1);
    v.remove(1);
    expect(v.meshes.weapon.count).toBe(1);
    expect(v.size).toBe(3);
    v.animate(0.1);
    v.remove(42);
    expect(v.size).toBe(3);
  });
});

describe('selección de hueco', () => {
  it('teclas 1-5 y RB del mando (siguiente)', () => {
    const pad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), connected: true, mapping: 'standard' as GamepadMappingType };
    const input = new InputManager(window, new GamepadSource(() => [pad]));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3' }));
    expect(input.consumeSlotRequest(0)).toBe(2);
    expect(input.consumeSlotRequest(0)).toBeNull();
    pad.buttons[PAD.RB]!.pressed = true;
    input.sample();
    expect(input.consumeSlotRequest(4)).toBe(0);
    input.sample(); // mantenido: no repite
    expect(input.consumeSlotRequest(0)).toBeNull();
    input.pulse(Buttons.INTERACT);
    expect(hasButton(input.sample().buttons, Buttons.INTERACT)).toBe(true);
    input.dispose();
  });
});

describe('HUD de inventario y botón Abrir/Recoger', () => {
  it('muestra hacha, objetos con rareza y cantidad, munición; tocar un hueco lo elige', () => {
    let inv = addItem(createInventory(), { kind: 'shotgun', qty: 1, rarity: 'epic' }).inventory;
    inv = addItem(inv, { kind: 'medkit', qty: 2 }).inventory;
    inv = addItem(inv, { kind: 'ammo_shells', qty: 12 }).inventory;
    const onSelect = vi.fn();
    render(<Inventory inventory={inv} onSelect={onSelect} />);
    expect(screen.getByRole('list', { name: 'Inventario' }).children).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Hueco 1: Hacha' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Hueco 2: Escopeta épica' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hueco 3: Botiquín ×2' }).textContent).toContain('2');
    expect(screen.getByLabelText('Munición').textContent).toContain('Cartuchos 12');
    fireEvent.click(screen.getByRole('button', { name: 'Hueco 4: vacío' }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });
  it('aparece "Abrir" junto a un cofre, pulsa la interacción y muestra avisos', () => {
    vi.useFakeTimers();
    const events = new EventBus<GameEvents>();
    const pressInteract = vi.fn();
    const game = { events, pressInteract } as unknown as Game;
    render(<InteractPrompt game={game} device="touch" />);
    expect(screen.queryByRole('button')).toBeNull();
    act(() => events.emit('interact', { type: 'chest', id: 3, action: 'Abrir', label: 'Cofre' }));
    const btn = screen.getByRole('button', { name: /Abrir/ });
    fireEvent.pointerDown(btn);
    expect(pressInteract).toHaveBeenCalledTimes(1);
    act(() => events.emit('interact', { type: 'pickup', id: 8, action: 'Recoger', label: 'Rifle raro' }));
    expect(screen.getByRole('button', { name: /Recoger/ }).textContent).toContain('Rifle raro');
    act(() => events.emit('notice', 'full'));
    expect(screen.getByRole('status').textContent).toMatch(/lleno/);
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => events.emit('interact', null));
    expect(screen.queryByRole('button')).toBeNull();
    vi.useRealTimers();
  });
  it('con teclado muestra la tecla F', () => {
    const events = new EventBus<GameEvents>();
    render(<InteractPrompt game={{ events, pressInteract: vi.fn() } as unknown as Game} device="keyboard" />);
    act(() => events.emit('interact', { type: 'chest', id: 1, action: 'Abrir', label: 'Cofre' }));
    expect(screen.getByRole('button').textContent).toMatch(/^FAbrir/);
  });
});
