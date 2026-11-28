import { useEffect, useState } from 'react';
import type { Game } from '@/game/Game';
import { QUALITY_LABEL } from '@/engine/quality';
import { PROTOCOL_VERSION } from '@shared/protocol';
import { RUNNING_BUILD } from './PwaUpdate';

const KEY = 'br.diag.v1';
/** Fase 15.2: panel de diagnóstico desactivado por defecto (preferencia local aparte). */
export function loadDiagnostics(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function saveDiagnostics(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* sin almacenamiento */ }
}

/**
 * Panel ligero: se refresca 2 veces por segundo con datos que el motor ya mide (sin consultas a la
 * GPU ni objetos por frame). Solo existe mientras está activado.
 */
export function DiagnosticsPanel({ game }: { game: Game }) {
  const [d, setD] = useState(() => game.diagnostics());
  useEffect(() => {
    const t = window.setInterval(() => setD(game.diagnostics()), 500);
    return () => window.clearInterval(t);
  }, [game]);
  return (
    <div className="diag" aria-label="Diagnóstico de rendimiento">
      <span>{Math.round(d.fps)} FPS · {d.frameMs.toFixed(1)} ms (peor {d.worstMs.toFixed(0)})</span>
      <span>{d.drawCalls} draw calls · {(d.triangles / 1000).toFixed(1)} k triáng.</span>
      <span>Pixel ratio {d.pixelRatio.toFixed(2)}</span>
      <span>Calidad {QUALITY_LABEL[d.selected]} → efectiva {QUALITY_LABEL[d.effective]}{d.automatic ? ' (auto)' : ''}</span>
      <span>Build {RUNNING_BUILD} · v{PROTOCOL_VERSION}</span>
    </div>
  );
}
