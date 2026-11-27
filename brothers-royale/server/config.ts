/**
 * Configuración del servidor por variables de entorno (ver DEPLOY.md). Todo se
 * valida: un valor ausente o mal escrito cae en un valor seguro por defecto.
 *
 *   PORT             Puerto HTTP/WebSocket (Render lo fija solo). Defecto 2567.
 *   HOST             Interfaz de escucha. Defecto 0.0.0.0.
 *   ALLOWED_ORIGINS  Orígenes web permitidos, separados por comas
 *                    (p. ej. https://360connectpe-sys.github.io). Vacío o "*" = todos.
 *   MAX_ROOMS        Salas simultáneas como máximo (protege instancias gratuitas). Defecto 8.
 *
 * El máximo de 8 jugadores por sala NO es configurable: vive en NET.maxPlayersPerRoom.
 */
import { NET } from '@shared/protocol';

export interface ServerConfig {
  port: number;
  host: string;
  /** null = cualquier origen. */
  allowedOrigins: readonly string[] | null;
  maxRooms: number;
}

export const DEFAULT_MAX_ROOMS = 8;
const MAX_ROOMS_LIMIT = 200;

/** Normaliza un origen a esquema://host[:puerto] en minúsculas, o null si no es válido. */
export function normalizeOrigin(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

const int = (v: string | undefined, def: number, min: number, max: number): number => {
  const n = Number(v);
  return v !== undefined && v.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : def;
};

export function readServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const rawOrigins = (env.ALLOWED_ORIGINS ?? '').trim();
  let allowedOrigins: string[] | null = null;
  if (rawOrigins && rawOrigins !== '*') {
    allowedOrigins = [...new Set(rawOrigins.split(',').map(normalizeOrigin).filter((o): o is string => o !== null))];
    // Si nada era válido, mejor cerrar que abrir por error.
    if (allowedOrigins.length === 0) allowedOrigins = [];
  }
  return {
    port: int(env.PORT, NET.defaultPort, 1, 65535),
    host: (env.HOST ?? '').trim() || '0.0.0.0',
    allowedOrigins,
    maxRooms: int(env.MAX_ROOMS, DEFAULT_MAX_ROOMS, 1, MAX_ROOMS_LIMIT),
  };
}

/**
 * ¿Se acepta una petición con esta cabecera Origin? Sin cabecera (clientes
 * nativos, pruebas, herramientas) se acepta: el origen solo lo imponen los
 * navegadores y la autoridad del servidor no depende de él.
 */
export function isOriginAllowed(origin: string | undefined | null, cfg: Pick<ServerConfig, 'allowedOrigins'>): boolean {
  if (cfg.allowedOrigins === null || !origin) return true;
  const o = normalizeOrigin(origin);
  return o !== null && cfg.allowedOrigins.includes(o);
}
