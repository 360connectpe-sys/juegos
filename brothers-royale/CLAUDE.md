# BROTHERS ROYALE — instrucciones permanentes

Battle Royale web multijugador, low poly, cámara isométrica 2.5D, para celular y computadora.
Inspirado en las mecánicas de Fortnite pero con identidad propia: no copiar nombres, personajes,
arte, música, mapas ni el aspecto de ningún juego existente.

## Stack
Vite 8 · TypeScript 5.9 (strict) · React 19 (solo UI/HUD) · Three.js (render) ·
Rapier (`@dimforge/rapier3d-compat`, física) · Colyseus (multijugador, fase futura) · Vitest.

## Comandos (desde `brothers-royale/`)
- `npm run dev` — servidor de desarrollo (`?q=low|medium|high` fuerza calidad, `?debug` expone `window.__BR_GAME__`).
- `npm run check` — typecheck + tests + build. **Ejecutarlo antes de cada commit; debe pasar.**
- `npm test`, `npm run typecheck`, `npm run build`, `npm run preview`.

## Arquitectura y reglas
```
src/shared/   Lógica PURA y determinista (sin Three, sin DOM): constantes, tipos, movimiento,
              generación del mapa, colisionadores, protocolo de red. La usará también el servidor.
src/physics/  Rapier, sin Three ni DOM (reutilizable en Node/Colyseus).
src/engine/   Render genérico: renderer, cámara isométrica, luces, calidad, bucle de paso fijo.
src/game/     Juego: mundo visual, entidades (vistas), entrada, orquestador `Game`.
src/net/      Frontera de red: `GameSession` (OfflineSession hoy, ColyseusSession después).
src/ui/       React: carga, HUD, controles táctiles. React NO toca la escena 3D por frame.
tests/        Vitest (node por defecto; `// @vitest-environment jsdom` para DOM/React).
```
1. **Determinismo**: todo lo que afecte a la jugabilidad (velocidades, mapa, colisiones) vive en
   `src/shared` y se genera con semilla (`createRng`). Nada de `Math.random()` en la simulación.
2. **Simulación ≠ render**: la simulación avanza a `SIMULATION.tickRate` (30 Hz) con `FixedStepLoop`;
   las vistas interpolan entre ticks. Las entidades visuales nunca son la fuente de verdad.
3. **Red**: el juego solo habla con `GameSession`. La entrada viaja como `PlayerInput` (ejes del
   mundo, con `seq`); el estado como `PlayerState`. Mensajes en `shared/protocol.ts`.
4. **Lo que se ve es lo que choca**: la geometría visual de muros/árboles usa las mismas medidas que
   `shared/world/colliders.ts`.
5. **Rendimiento móvil primero**:
   - Fusionar geometría estática (`game/world/geometry.ts` → 1 draw call por objeto) e
     `InstancedMesh` para elementos repetidos. Objetivo: < 50 draw calls en escena de prueba.
   - Materiales `MeshLambertMaterial` con color por vértice; sin texturas salvo necesidad.
   - Respetar `QualitySettings` (pixel ratio limitado, sombras solo medium/high, densidad).
   - `matrixAutoUpdate = false` en estáticos; no crear objetos por frame en bucles calientes.
   - Rapier se carga diferido en su propio chunk.
6. **Cámara isométrica**: ortográfica desde (+1,+1,+1). Convertir entrada de pantalla a mundo con
   `screenToWorld` (no duplicar la matemática).
7. Código y comentarios en español; nombres de identificadores en inglés.
8. Cada sistema nuevo llega con tests de su parte pura. Actualizar `PROJECT.md` al cerrar cada avance.

## Fuera de alcance hasta nueva fase
Armas, construcción, tormenta y multijugador real (Colyseus): no implementarlos sin pedirlo.
