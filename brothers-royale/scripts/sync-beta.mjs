#!/usr/bin/env node
/**
 * Fase 15 (H17): publica `jugar/` en la carpeta de la beta sin acumular builds viejos.
 *
 *   node scripts/sync-beta.mjs <jugar> <beta> [generaciones=2]
 *
 * - Copia el build nuevo; conserva el `config.js` de la beta (URL WSS del servidor).
 * - `releases.json` recuerda qué archivos usa cada build. Se mantienen el actual y el
 *   anterior (una pestaña o PWA abierta con el build previo sigue cargando sus chunks
 *   diferidos); los de builds más antiguos se borran.
 * - Sin red ni dependencias. No toca nada fuera de la carpeta de la beta.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const rel = (root, f) => relative(root, f).replaceAll('\\', '/');
/** Archivos que pertenecen a un build (los de nombre fijo se sobrescriben siempre). */
const versioned = (f) => f.startsWith('assets/');

export function syncBeta(jugar, beta, generations = 2) {
  const version = JSON.parse(readFileSync(join(jugar, 'version.json'), 'utf8'));
  const fresh = walk(jugar).map((f) => rel(jugar, f));
  mkdirSync(beta, { recursive: true });
  const manifestPath = join(beta, 'releases.json');
  let releases = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  if (!Array.isArray(releases)) {
    // Primera vez: lo que ya está publicado cuenta como el build anterior (se conserva una vez).
    const legacy = existsSync(beta) ? walk(beta).map((f) => rel(beta, f)).filter(versioned) : [];
    releases = legacy.length ? [{ build: 'legacy', files: legacy }] : [];
  }
  const keepConfig = existsSync(join(beta, 'config.js'));
  for (const f of fresh) {
    if (f === 'config.js' && keepConfig) continue;
    mkdirSync(dirname(join(beta, f)), { recursive: true });
    copyFileSync(join(jugar, f), join(beta, f));
  }
  releases = releases.filter((r) => r.build !== version.build);
  releases.push({ build: version.build, protocol: version.protocol, files: fresh.filter(versioned) });
  releases = releases.slice(-generations);
  const keep = new Set(releases.flatMap((r) => r.files));
  const removed = [];
  for (const f of walk(beta).map((x) => rel(beta, x))) if (versioned(f) && !keep.has(f)) { rmSync(join(beta, f)); removed.push(f); }
  writeFileSync(manifestPath, JSON.stringify(releases, null, 1) + '\n');
  return { build: version.build, kept: [...keep].length, removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [jugar, beta, gens] = process.argv.slice(2);
  if (!jugar || !beta) { console.error('Uso: node scripts/sync-beta.mjs <jugar> <beta> [generaciones]'); process.exit(1); }
  const r = syncBeta(jugar, beta, gens ? Number(gens) : 2);
  console.log(`Beta ${r.build}: ${r.kept} archivos versionados conservados, ${r.removed.length} eliminados.`);
}
