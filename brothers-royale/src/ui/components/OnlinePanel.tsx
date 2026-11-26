import { useEffect, useId, useState, type FormEvent } from 'react';
import type { EventBus } from '@/core/EventBus';
import type { GameEvents, NetEvent, OnlineRequest } from '@/game/Game';
import { NET } from '@shared/protocol';
import { checkServerUrl, saveName } from '@/net/config';
import { sanitizeName, sanitizeRoomCode } from '@shared/session';

interface Props {
  events: EventBus<GameEvents>;
  initial: { server: string; name: string; code: string };
  onConnect(req: OnlineRequest): void;
  onDisconnect(): void;
}

const STATUS_LABEL: Record<NetEvent['status'], string> = {
  offline: 'Sin conexión',
  connecting: 'Conectando…',
  connected: 'En línea',
  reconnecting: 'Reconectando…',
  disconnected: 'Desconectado',
};

/**
 * Panel de juego en línea: abre un formulario corto (nombre, sala, servidor)
 * y, una vez dentro, muestra el estado de la sala. El modo offline sigue
 * siendo el predeterminado: nada se conecta sin que el jugador lo pida.
 */
export function OnlinePanel({ events, initial, onConnect, onDisconnect }: Props) {
  const [open, setOpen] = useState(false);
  const [net, setNet] = useState<NetEvent>({ status: 'offline' });
  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code);
  const [server, setServer] = useState(initial.server);
  const [formError, setFormError] = useState<string | null>(null);
  const ids = { name: useId(), code: useId(), server: useId() };

  useEffect(
    () =>
      events.on('net', (e) => {
        setNet(e);
        if (e.status === 'connected') setOpen(false);
      }),
    [events],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const urlError = checkServerUrl(server.trim(), window.location.protocol);
    if (urlError) return setFormError(urlError);
    const clean = sanitizeName(name) || 'Jugador';
    saveName(clean);
    setFormError(null);
    onConnect({ url: server.trim(), name: clean, code: sanitizeRoomCode(code) });
  };

  const online = net.status === 'connected' || net.status === 'reconnecting';
  const busy = net.status === 'connecting';

  if (online) {
    return (
      <div className="net net--online" role="status">
        <span className={`net__dot net__dot--${net.status}`} aria-hidden="true" />
        <span className="net__text">
          <strong>{STATUS_LABEL[net.status]}</strong>
          {net.code ? `, sala ${net.code}` : ', sala pública'}, {net.players ?? 1}/{NET.maxPlayersPerRoom} jugadores
          {net.rtt ? `, ${net.rtt} ms` : ''}
        </span>
        <button type="button" className="net__btn" onClick={onDisconnect}>
          Salir
        </button>
      </div>
    );
  }

  return (
    <div className="net">
      {!open && (
        <button type="button" className="net__open" onClick={() => setOpen(true)}>
          Jugar en línea
        </button>
      )}
      {!open && net.reason && (
        <p className="net__notice" role="alert">
          {net.reason}. Sigues jugando sin conexión.
        </p>
      )}
      {open && (
        <form className="net__form" onSubmit={submit} aria-label="Jugar en línea">
          <label htmlFor={ids.name}>Tu nombre</label>
          <input id={ids.name} value={name} maxLength={16} autoComplete="nickname" placeholder="Jugador" onChange={(e) => setName(e.target.value)} />
          <label htmlFor={ids.code}>Código de sala (vacío para la pública)</label>
          <input id={ids.code} value={code} maxLength={8} autoCapitalize="characters" placeholder="Opcional" onChange={(e) => setCode(e.target.value)} />
          <details className="net__adv">
            <summary>Servidor</summary>
            <label htmlFor={ids.server}>Dirección</label>
            <input id={ids.server} value={server} inputMode="url" spellCheck={false} onChange={(e) => setServer(e.target.value)} />
          </details>
          {(formError || net.reason) && (
            <p className="net__error" role="alert">
              {formError ?? `No se pudo conectar: ${net.reason}`}
            </p>
          )}
          <div className="net__actions">
            <button type="submit" className="net__btn net__btn--primary" disabled={busy}>
              {busy ? 'Conectando…' : 'Conectar'}
            </button>
            <button type="button" className="net__btn" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
