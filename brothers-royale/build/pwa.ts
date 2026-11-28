import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { Plugin } from 'vite';
import { PROTOCOL_VERSION } from '../src/shared/protocol';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)]).sort();
}

/** La identidad incluye fuentes, configuración y recursos; dist/ y jugar/ son reproducibles. */
export function pwa(root: string): Plugin {
  const hash = createHash('sha256');
  const inputs = ['src', 'public', 'pwa', 'build'].flatMap(dir => files(resolve(root, dir)));
  inputs.push(resolve(root, 'index.html'), resolve(root, 'vite.config.ts'), resolve(root, 'package-lock.json'));
  for (const file of inputs.sort()) hash.update(relative(root, file)).update(readFileSync(file));
  hash.update(process.env.VITE_SERVER_URL ?? '');
  const build = hash.digest('hex').slice(0, 16);
  let out = '';
  return {
    name: 'brothers-royale-pwa',
    apply: 'build',
    config: () => ({ define: { __BR_BUILD_ID__: JSON.stringify(build) } }),
    configResolved: config => { out = resolve(config.root, config.build.outDir); },
    closeBundle() {
      const version = { build, protocol: PROTOCOL_VERSION };
      writeFileSync(resolve(out, 'version.json'), JSON.stringify(version) + '\n');
      const precache = files(out).map(file => './' + relative(out, file).replaceAll('\\', '/')).filter(file => file !== './sw.js');
      const worker = `const RELEASE = ${JSON.stringify(version)};\nconst PRECACHE = ${JSON.stringify(precache)};\n` + readFileSync(resolve(root, 'pwa/sw.js'), 'utf8');
      writeFileSync(resolve(out, 'sw.js'), worker);
    },
  };
}
