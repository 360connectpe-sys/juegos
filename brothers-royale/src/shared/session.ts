import { PROTOCOL_VERSION, type JoinOptions } from './protocol';

export const NAME_MAX = 16;
export const CODE_MAX = 8;

/** Limpia el nombre visible: sin caracteres de control, espacios colapsados, longitud acotada. */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

/** Código de sala: letras y números, en mayúsculas. Vacío = sala pública. */
export function sanitizeRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_MAX);
}

export type JoinValidation = { ok: true; options: Required<JoinOptions> } | { ok: false; reason: 'protocol' | 'options' };

/** Valida las opciones de unión que manda el cliente (nunca confiar en ellas). */
export function validateJoinOptions(raw: unknown): JoinValidation {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'options' };
  const o = raw as Record<string, unknown>;
  if (o.protocol !== PROTOCOL_VERSION) return { ok: false, reason: 'protocol' };
  return { ok: true, options: { protocol: PROTOCOL_VERSION, name: sanitizeName(o.name) || 'Jugador', code: sanitizeRoomCode(o.code) } };
}

/** Evita nombres repetidos en la sala: "Ana", "Ana 2", "Ana 3"… */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  for (let i = 2; i < 1000; i++) {
    const suffix = ` ${i}`;
    const candidate = name.slice(0, NAME_MAX - suffix.length) + suffix;
    if (!set.has(candidate)) return candidate;
  }
  return name;
}
