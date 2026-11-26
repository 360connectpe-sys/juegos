import { NET } from '@shared/protocol';
import { sanitizeName, sanitizeRoomCode } from '@shared/session';

export interface OnlineParams {
  server: string;
  name: string;
  code: string;
  /** Conectarse al cargar (?online). */
  auto: boolean;
}

/**
 * URL del servidor por defecto: ?server=… > VITE_SERVER_URL > mismo host,
 * puerto 2567 (wss si la página es https).
 */
export function defaultServerUrl(loc: Pick<Location, 'protocol' | 'hostname'>, envUrl?: string): string {
  if (envUrl) return envUrl;
  const scheme = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${loc.hostname || 'localhost'}:${NET.defaultPort}`;
}

/** ¿La URL es utilizable? Solo ws:// o wss://; desde https el navegador exige wss://. */
export function checkServerUrl(url: string, pageProtocol: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'La dirección del servidor no es válida (ejemplo: ws://192.168.1.20:2567).';
  }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return 'La dirección debe empezar por ws:// o wss://.';
  if (pageProtocol === 'https:' && u.protocol === 'ws:') return 'Desde una página https el navegador solo permite servidores wss://.';
  return null;
}

export function readOnlineParams(search: string, loc: Pick<Location, 'protocol' | 'hostname'>, envUrl?: string, savedName = ''): OnlineParams {
  const q = new URLSearchParams(search);
  return {
    server: q.get('server') || defaultServerUrl(loc, envUrl),
    name: sanitizeName(q.get('name') ?? savedName),
    code: sanitizeRoomCode(q.get('code') ?? ''),
    auto: q.has('online'),
  };
}

const NAME_KEY = 'br.name';

export function loadSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* almacenamiento no disponible: no pasa nada */
  }
}
