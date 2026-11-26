import { describe, expect, it, vi } from 'vitest';
import { Mesh } from 'three';
import { PlayerAvatar } from '@/game/entities/PlayerAvatar';

describe('recursos de avatares remotos', () => {
  it('libera cada material compartido una sola vez al retirar un avatar', () => {
    const avatar = new PlayerAvatar(undefined, false, true);
    const materials = new Set<Mesh['material']>();
    let geometryDisposals = 0;

    avatar.root.traverse((object) => {
      if (object instanceof Mesh) {
        materials.add(object.material);
        object.geometry.addEventListener('dispose', () => { geometryDisposals++; });

      }
    });
    const disposals = [...materials].flatMap((material) => Array.isArray(material) ? material : [material])
      .map((material) => vi.spyOn(material, 'dispose'));
    avatar.dispose();
    expect(avatar.root.parent).toBeNull();
    expect(disposals).toHaveLength(2);
    expect(geometryDisposals).toBe(6);
    for (const spy of disposals) expect(spy).toHaveBeenCalledTimes(1);
  });
});
