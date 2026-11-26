import { describe, expect, it, vi } from 'vitest';
import { avatarGeometry, disposeAvatarResources, paletteColors, PlayerAvatar } from '@/game/entities/PlayerAvatar';

describe('recursos de avatares remotos', () => {
  // Fase 3.2: el avatar es UNA SkinnedMesh con geometría (por paleta) y material
  // compartidos. Retirar un jugador no debe liberar lo que usan los demás; la
  // limpieza final libera cada recurso compartido una sola vez.
  it('libera cada material compartido una sola vez al retirar un avatar', () => {
    const a = new PlayerAvatar(0, false);
    const b = new PlayerAvatar(0, false);
    expect(a.mesh.geometry).toBe(b.mesh.geometry);
    expect(a.mesh.material).toBe(b.mesh.material);
    const geoDispose = vi.spyOn(a.mesh.geometry, 'dispose');
    const matDispose = vi.spyOn(a.mesh.material as { dispose(): void }, 'dispose');
    a.dispose();
    expect(a.root.parent).toBeNull();
    expect(geoDispose).not.toHaveBeenCalled();
    expect(matDispose).not.toHaveBeenCalled();
    b.dispose();
    disposeAvatarResources();
    expect(geoDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
    // Tras la limpieza, un avatar nuevo recrea sus recursos.
    expect(avatarGeometry(paletteColors(0))).not.toBe(a.mesh.geometry);
  });
});
