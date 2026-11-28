// @vitest-environment jsdom
/** Fase 12 — interfaz: Ajustes accesible para todos en partida (también en el celular). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/ui/styles.css', 'utf8');
const zOf = (selector: string): number => {
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  try {
    const el = document.createElement('div'); el.className = selector; document.body.append(el);
    const z = Number(getComputedStyle(el).zIndex); el.remove(); return z;
  } finally { style.remove(); }
};

describe('fase 12: Ajustes para todos los jugadores', () => {
  it('el HUD (botón de Ajustes) queda por encima de la zona táctil de mirada', () => {
    // Antes .hud (5) < .touch (6): en el celular .touch__look tapaba el engranaje y solo
    // podía abrir Ajustes quien jugaba en ordenador (normalmente el anfitrión).
    expect(zOf('hud')).toBeGreaterThan(zOf('touch'));
  });
});
