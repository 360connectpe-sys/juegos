import { useEffect, useState } from 'react';

const isPortrait = () => window.matchMedia?.('(orientation: portrait)').matches ?? window.innerHeight > window.innerWidth;
const canFullscreen = () => typeof document.documentElement.requestFullscreen === 'function';

/**
 * El juego está pensado para el celular en horizontal. En vertical se muestra
 * un aviso que no bloquea (se puede cerrar) y, donde el navegador lo permite,
 * un botón de pantalla completa que además fija la orientación horizontal.
 */
export function OrientationHint() {
  const [portrait, setPortrait] = useState(isPortrait);
  const [dismissed, setDismissed] = useState(false);
  const [full, setFull] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    const onResize = () => setPortrait(isPortrait());
    const onFull = () => setFull(!!document.fullscreenElement);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFull);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFull);
    };
  }, []);

  const goFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      await o.lock?.('landscape').catch(() => undefined);
    } catch {
      /* el navegador no lo permite: se sigue jugando igual */
    }
  };

  return (
    <>
      {!full && canFullscreen() && (
        <button type="button" className="fullscreen-btn" onClick={() => void goFullscreen()}>
          Pantalla completa
        </button>
      )}
      {portrait && !dismissed && (
        <div className="rotate" role="status">
          <p>Gira el celular: se juega mejor en horizontal.</p>
          <button type="button" className="net__btn" onClick={() => setDismissed(true)}>
            Seguir así
          </button>
        </div>
      )}
    </>
  );
}
