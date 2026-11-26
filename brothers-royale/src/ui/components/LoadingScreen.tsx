import { Logo } from './Logo';

interface Props {
  progress: number;
  label: string;
  error: string | null;
  hidden: boolean;
}

export function LoadingScreen({ progress, label, error, hidden }: Props) {
  return (
    <div className={`loading${hidden ? ' loading--hidden' : ''}`} aria-hidden={hidden}>
      <Logo />
      {error ? (
        <p className="loading__error" role="alert">
          No se pudo iniciar el juego: {error}. Recarga la página para intentarlo de nuevo.
        </p>
      ) : (
        <div className="loading__progress">
          <div
            className="loading__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label={label}
          >
            <div className="loading__fill" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <p className="loading__label">{label}</p>
        </div>
      )}
    </div>
  );
}
