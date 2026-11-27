# Repositorio de juegos (GitHub Pages)

Cada carpeta es un juego independiente servido como sitio estático; `index.html` es el menú.

- **BROTHERS ROYALE** vive en `brothers-royale/` (Vite + TypeScript). Sus instrucciones permanentes
  están en `brothers-royale/CLAUDE.md`, el contexto completo para retomar en `brothers-royale/PROJECT_CONTEXT.md`
  y la bitácora por fase en `brothers-royale/PROJECT.md`.
  Antes de terminar cualquier cambio allí: `cd brothers-royale && npm run check`.
  Su servidor multijugador (Colyseus) vive en `brothers-royale/server/` y se arranca con `npm run server`.
- No modificar los otros juegos salvo que se pida.
