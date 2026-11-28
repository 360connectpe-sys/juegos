import { useEffect, useRef, useState } from 'react';
import { PROTOCOL_VERSION } from '@shared/protocol';

declare const __BR_BUILD_ID__: string;
/** Build que se está ejecutando realmente ('dev' sin compilar). */
export const RUNNING_BUILD: string = typeof __BR_BUILD_ID__ === 'string' ? __BR_BUILD_ID__ : 'dev';
/** Fase 15.2: un solo intento automático por build en ejecución (evita bucles de actualización). */
const AUTO_KEY = 'br.pwa.auto';
interface Release { build: string; protocol: number }

function ask<T>(worker: ServiceWorker, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => { channel.port1.close(); reject(new Error('No se pudo comprobar la actualización. Inténtalo de nuevo.')); }, 5000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data as T); };
    worker.postMessage({ type }, [channel.port2]);
  });
}

/** Sin recarga automática durante la partida y sin tocar preferencias ni datos del jugador. */
export function PwaUpdate({ isBusy, server }: { isBusy: () => boolean; server: string }) {
  const busy = useRef(isBusy); busy.current = isBusy;
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [reloadReady, setReloadReady] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState('');
  const registration = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    let disposed = false, hadController = !!navigator.serviceWorker.controller;
    let lastCheck = 0;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PWA_STATE') event.ports[0]?.postMessage({ safe: !busy.current(), build: __BR_BUILD_ID__ });
    };
    const onController = () => {
      if (!hadController) { hadController = true; return; }
      if (!disposed) {
        setApplying(false);
        if (!busy.current()) window.location.reload();
        else setReloadReady(true);
      }
    };
    const check = () => {
      if (document.hidden || Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      void registration.current?.update().catch(() => undefined);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    navigator.serviceWorker.addEventListener('controllerchange', onController);
    window.addEventListener('pageshow', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    void navigator.serviceWorker.register(new URL('./sw.js', window.location.href).href, { scope: './', updateViaCache: 'none' }).then(reg => {
      if (disposed) return;
      registration.current = reg;
      if (reg.waiting) setWaiting(reg.waiting);
      reg.active?.postMessage({ type: 'PWA_CLEANUP' });
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (!disposed && worker.state === 'installed' && reg.waiting) setWaiting(reg.waiting);
        });
      });
      check();
    }).catch(() => undefined); // La web sigue funcionando si iOS no permite caché persistente.
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('message', onMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', onController);
      window.removeEventListener('pageshow', check); window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  // Fase 15.2: en el lobby y sin partida activa, la actualización se aplica sola (una vez por
  // build en ejecución). Nunca durante una partida; preferencias y HUD viven en localStorage.
  const applyRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    if (!waiting && !reloadReady) return;
    const tick = () => {
      if (busy.current() || applying) return;
      try { if (sessionStorage.getItem(AUTO_KEY) === RUNNING_BUILD) return; sessionStorage.setItem(AUTO_KEY, RUNNING_BUILD); } catch { return; }
      void applyRef.current();
    };
    tick();
    const timer = window.setInterval(tick, 2000);
    return () => window.clearInterval(timer);
  }, [waiting, reloadReady, applying]);

  const apply = async () => {
    if (busy.current()) return;
    if (reloadReady) { window.location.reload(); return; }
    if (!waiting) return;
    setApplying(true); setNotice('');
    try {
      const release = await ask<Release>(waiting, 'PWA_VERSION');
      if (release.protocol !== PROTOCOL_VERSION && server) {
        const health = new URL(server); health.protocol = health.protocol === 'wss:' ? 'https:' : 'http:';
        health.pathname = '/health'; health.search = ''; health.hash = '';
        const response = await fetch(health, { cache: 'no-store', signal: AbortSignal.timeout(10000) }).catch(() => { throw new Error('No se pudo comprobar el servidor. Inténtalo de nuevo cuando haya conexión.'); });
        if (!response.ok || (await response.json()).protocol !== release.protocol) throw new Error('La nueva versión aún no es compatible con el servidor. Puedes seguir con la actual.');
      }
      if (busy.current()) { setApplying(false); return; }
      const result = await ask<{ applied: boolean }>(waiting, 'PWA_APPLY');
      if (!result.applied) throw new Error('Vuelve al lobby o cierra las otras ventanas para actualizar.');
    } catch (error) {
      setApplying(false);
      setNotice(error instanceof Error ? error.message : 'No se pudo actualizar. Inténtalo con conexión.');
    }
  };
  applyRef.current = apply;
  if ((!waiting && !reloadReady) || isBusy()) return null;
  return <aside className="pwa-update" role="status">
    <img src="./icons/icon-192.png" width="36" height="36" alt="" />
    <span>{notice || 'Nueva versión de Brothers Royale disponible.'}</span>
    <button type="button" disabled={applying} onClick={() => void apply()}>{applying ? 'Actualizando…' : 'Actualizar y jugar'}</button>
  </aside>;
}
