interface LogoProps {
  size?: 'hero' | 'small';
}

/** Logotipo tipográfico: el único elemento "ruidoso" de la interfaz. */
export function Logo({ size = 'hero' }: LogoProps) {
  return (
    <h1 className={`logo logo--${size}`} aria-label="Brothers Royale">
      <span className="logo__top" aria-hidden="true">BROTHERS</span>
      <span className="logo__bottom" aria-hidden="true">ROYALE</span>
    </h1>
  );
}
