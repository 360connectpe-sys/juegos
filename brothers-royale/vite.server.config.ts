import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Compilación del servidor Colyseus (Node 22, ESM). Reutiliza los alias del
 * cliente para compartir `src/shared` y `src/physics` sin duplicar código.
 * Las dependencias (Colyseus, Rapier) se cargan desde node_modules.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: true,
    rollupOptions: { output: { entryFileNames: 'index.js', format: 'es' } },
  },
});
