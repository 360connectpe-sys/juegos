# BROTHERS ROYALE — Estado del proyecto

## Visión
Battle Royale multijugador web, low poly, perspectiva isométrica 2.5D, jugable en celular y
computadora. Mecánicas inspiradas en el género (caída, botín, construcción, tormenta), identidad propia.

## Roadmap
| Fase | Contenido | Estado |
|------|-----------|--------|
| 1 | Base técnica: arquitectura, escena isométrica, mapa de prueba, personaje, física, tests | ✅ Hecha |
| 2 | Personaje: animaciones, cámara (zoom), interacción con puertas, minimapa | Pendiente |
| 3 | Multijugador con Colyseus (servidor autoritativo, predicción y reconciliación) | Pendiente |
| 4 | Armas y combate | Pendiente |
| 5 | Construcción | Pendiente |
| 6 | Tormenta, partida completa, salas, lobby | Pendiente |

## Fase 1 — Base técnica (2026-11-26)
**Hecho**
- Proyecto Vite + TypeScript estricto + React en `brothers-royale/` (independiente del resto de juegos del repo).
- Arquitectura por capas: `shared` (pura/determinista), `physics`, `engine`, `game`, `net`, `ui` (ver `CLAUDE.md`).
- Cámara ortográfica isométrica verdadera que sigue al jugador; frustum adaptado a pantallas verticales.
- Mapa de prueba 120×120 m generado por semilla: terreno con colinas (ruido de valor), playa y mar,
  casa low poly con puerta, ventanas y tejado a dos aguas, ~140 árboles (pinos y redondos) instanciados.
- Personaje provisional low poly con animación de caminar/saltar e interpolación entre ticks.
- Física Rapier: heightfield del terreno, paredes de la casa, troncos, bordes del mapa;
  personaje con `KinematicCharacterController` (pendientes, escalones, salto, gravedad).
- Controles: teclado (WASD/flechas, Shift correr, Espacio saltar) y joystick táctil flotante + botón Saltar.
- Iluminación: hemisférica + ambiental + sol direccional con sombra que sigue al jugador; niebla.
- Rendimiento: detección de calidad (low/medium/high), pixel ratio limitado y adaptativo según FPS,
  sombras solo en medium/high (mancha de sombra barata en low), geometría fusionada + instancing
  (~20 draw calls, ~24k triángulos), pausa con la pestaña oculta, Rapier en chunk diferido.
- Preparación multijugador: bucle de simulación a 30 Hz fijo, `PlayerInput`/`PlayerState` serializables,
  `GameSession` (OfflineSession) y `shared/protocol.ts`; física y mapa sin dependencias de navegador.
- Tests (Vitest, 35): matemática, PRNG, movimiento isométrico, terreno/layout deterministas,
  colisionadores, calidad, bucle fijo, resolución adaptativa, proyección de cámara, física real con
  Rapier (heightfield, caminar, paredes/puerta, salto), UI de carga y entrada.
- Verificación e2e con Playwright (escritorio y Pixel 7): carga, movimiento con teclado, salto y joystick táctil.
- CI de GitHub Actions: `npm run check` en cada push que toque `brothers-royale/`.

**Notas / deuda técnica**
- Rapier compat incrusta el WASM en base64 (~1,7 MB gzip). Valorar el paquete no‑compat (`.wasm`
  separado, ~1,2 MB gzip y compilación en streaming) cuando se monte el servidor.
- Los FPS medidos en CI/headless usan render por software; medir en dispositivos reales.
- Publicación en GitHub Pages: `npm run build:pages` genera la versión jugable en `brothers-royale/jugar/`
  (se commitea, porque Pages sirve archivos estáticos sin paso de build). URL una vez en `main`:
  https://360connectpe-sys.github.io/juegos/brothers-royale/jugar/ . Regenerarla tras cada cambio.
- La triangulación del heightfield de Rapier puede diferir de la malla visual en la diagonal de cada
  celda (diferencias de cm en pendientes).

## Cómo probar
```bash
cd brothers-royale
npm install
npm run dev        # http://localhost:5173  (?q=low para simular gama baja, ?debug)
npm run check      # typecheck + tests + build
```
