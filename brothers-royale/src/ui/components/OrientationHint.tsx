import { useEffect, useState } from 'react';

const isPortrait = () => window.matchMedia?.('(orientation: portrait)').matches ?? window.innerHeight > window.innerWidth;
export const canFullscreen = () => typeof document.documentElement.requestFullscreen === 'function';

/** Pantalla completa + orientación horizontal donde el navegador lo permita (desde Ajustes). */
export async function enterFullscreenLandscape(): Promise<void> {
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape').catch(() => undefined);
  } catch {
    /* el navegador no lo permite: se sigue jugando igual */
  }
}

/**
 * El juego está pensado para el celular en horizontal. En vertical se muestra
 * un aviso que no bloquea (se puede cerrar). La pantalla completa está en Ajustes.
 */
export function OrientationHint() {
  const [portrait, setPortrait] = useState(isPortrait);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onResize = () => setPortrait(isPortrait());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!portrait || dismissed) return null;
  return (
    <div className="rotate" role="status">
      <p>Gira el celular: se juega mejor en horizontal.</p>
      <button type="button" className="net__btn" onClick={() => setDismissed(true)}>
        Seguir así
      </button>
    </div>
  );
}
