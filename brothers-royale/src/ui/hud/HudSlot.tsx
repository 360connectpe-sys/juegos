import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0, areaWidth: 0, areaHeight: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    const parent = node?.parentElement;
    if (!node || !parent) return;
    const measure = () => setBounds({ width: node.offsetWidth, height: node.offsetHeight, areaWidth: parent.clientWidth, areaHeight: parent.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [layout.visible]);
  if (!layout.visible) return null;
  const scale = Math.min(layout.scale,
    bounds.areaWidth && bounds.width ? bounds.areaWidth / bounds.width : layout.scale,
    bounds.areaHeight && bounds.height ? bounds.areaHeight / bounds.height : layout.scale);
  const halfWidth = bounds.width * scale / 2;
  const halfHeight = bounds.height * scale / 2;
  const style = {
    '--x': layout.x,
    '--y': layout.y,
    '--s': scale,
    left: `clamp(${halfWidth}px, ${layout.x * 100}%, calc(100% - ${halfWidth}px))`,
    top: `clamp(${halfHeight}px, ${layout.y * 100}%, calc(100% - ${halfHeight}px))`,
    '--o': layout.opacity,
  } as CSSProperties;
  return (
    <div ref={ref} className={`hud-slot${interactive ? ' hud-slot--interactive' : ''} ${className}`} data-hud={id} style={style}>
      {children}
    </div>
  );
}
