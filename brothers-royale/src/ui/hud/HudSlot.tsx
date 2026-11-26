import type { CSSProperties, ReactNode } from 'react';
import type { HudElementId, HudElementLayout } from './layout';

/**
 * Coloca un elemento del HUD según su disposición. La posición se expresa
 * como fracción del área segura (el contenedor `.hud-safe` ya descuenta notch
 * y barra de inicio con env(safe-area-inset-*)).
 */
export function HudSlot({
  id,
  layout,
  children,
  className = '',
  interactive = false,
}: {
  id: HudElementId;
  layout: HudElementLayout;
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  if (!layout.visible) return null;
  const style = {
    '--x': layout.x,
    '--y': layout.y,
    '--s': layout.scale,
    '--o': layout.opacity,
  } as CSSProperties;
  return (
    <div className={`hud-slot${interactive ? ' hud-slot--interactive' : ''} ${className}`} data-hud={id} style={style}>
      {children}
    </div>
  );
}
