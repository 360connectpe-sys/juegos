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
 * URL de `public/config.js` (window.BR_CONFIG.serverUrl), editable en el sitio
 * publicado sin recompilar. Solo se acepta si es ws:// o wss:// válida.
 */
export function runtimeServerUrl(cfg: unknown = (globalThis as { BR_CONFIG?: unknown }).BR_CONFIG): string | undefined {
  const url = typeof cfg === 'object' && cfg !== null ? (cfg as { serverUrl?: unknown }).serverUrl : undefined;
  if (typeof url !== 'string' || !url.trim()) return undefined;
  const clean = url.trim().replace(/\/+$/, '');
  return checkServerUrl(clean, 'http:') === null ? clean : undefined;
}

/**
 * URL del servidor por defecto: ?server=… > config.js (runtime) > VITE_SERVER_URL
 * > mismo host, puerto 2567 (wss si la página es https).
 */
export function defaultServerUrl(loc: Pick<Location, 'protocol' | 'hostname'>, envUrl?: string, runtimeUrl: string | undefined = runtimeServerUrl()): string {
  if (runtimeUrl) return runtimeUrl;
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

/** URL HTTP(S) del chequeo de salud de un servidor ws:// o wss:// (o null si no es válida). */
export function healthUrl(serverUrl: string): string | null {
  try {
    const u = new URL(serverUrl);
    if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/health';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Despierta un servidor dormido (alojamientos gratuitos como Render apagan la
 * instancia tras 15 min sin uso y tardan ~1 min en volver) antes de unirse.
 * Nunca falla: si no responde (o el navegador bloquea la respuesta por CORS,
 * que llega igualmente después de despertarlo) la conexión sigue como siempre.
 */
export async function wakeServer(serverUrl: string, timeoutMs = 75_000, signal?: AbortSignal): Promise<void> {
  const url = healthUrl(serverUrl);
  if (!url || typeof fetch !== 'function') return;
  const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
  try {
    await fetch(url, { cache: 'no-store', signal: AbortSignal.any(signals) });
  } catch {
    /* dormido, caído o CORS: la unión dirá lo que pase */
  }
}
