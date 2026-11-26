# BROTHERS ROYALE — instrucciones permanentes

Battle Royale web multijugador, low poly, cámara isométrica 2.5D, para celular y computadora.
Inspirado en las mecánicas de Fortnite pero con identidad propia: no copiar nombres, personajes,
arte, música, mapas ni el aspecto de ningún juego existente.

## Stack
Vite 8 · TypeScript 5.9 (strict) · React 19 (solo UI/HUD) · Three.js (render) ·
Rapier (`@dimforge/rapier3d-compat`, física) · Colyseus 0.18 (`@colyseus/core` + `ws-transport` en el
servidor, `@colyseus/sdk` en el cliente, cargado de forma diferida) · Vitest.

## Comandos (desde `brothers-royale/`)
- `npm run dev` — servidor de desarrollo (`?q=low|medium|high` fuerza calidad, `?debug` expone `window.__BR_GAME__`).
- `npm run check` — typecheck + tests + build del cliente + build del servidor. **Ejecutarlo antes de cada commit; debe pasar.**
- `npm run server` — compila (`vite.server.config.ts` → `dist-server/`) y arranca el servidor Colyseus en
  `ws://localhost:2567` (`PORT`, `HOST` configurables). `npm run build:server` solo compila.
- Probar en línea: `npm run server` + `npm run dev`, y en el juego "Jugar en línea", o abrir
  `?online&server=ws://localhost:2567&name=Ana&code=SALA1` (dos pestañas o dispositivos = dos jugadores).
- `npm test`, `npm run typecheck`, `npm run build`, `npm run preview`.
- `npm run build:pages` — regenera `jugar/` (versión publicada en GitHub Pages). Ejecutarlo y commitear `jugar/` al cerrar cada avance.

## Arquitectura y reglas
```
src/shared/   Lógica PURA y determinista (sin Three, sin DOM): constantes, tipos, movimiento,
              generación del mapa, colisionadores, protocolo de red. La usará también el servidor.
src/physics/  Rapier, sin Three ni DOM (reutilizable en Node/Colyseus).
src/engine/   Render genérico: renderer, cámara isométrica, luces, calidad, bucle de paso fijo.
src/game/     Juego: mundo visual, entidades (vistas), entrada, orquestador `Game`.
src/net/      Frontera de red: `GameSession` → `OfflineSession` (por defecto) y `OnlineSession`
              (Colyseus: predicción + reconciliación + interpolación de remotos).
server/       Servidor Node: `ServerWorld` (simulación autoritativa pura, sin red) y
              `BrothersRoom` (sala Colyseus: identidad, validación, snapshots, conexión).
src/ui/       React: carga, HUD, controles táctiles. React NO toca la escena 3D por frame.
tests/        Vitest (node por defecto; `// @vitest-environment jsdom` para DOM/React).
```
1. **Determinismo**: todo lo que afecte a la jugabilidad (velocidades, mapa, colisiones) vive en
   `src/shared` y se genera con semilla (`createRng`). Nada de `Math.random()` en la simulación.
2. **Simulación ≠ render**: la simulación avanza a `SIMULATION.tickRate` (30 Hz) con `FixedStepLoop`;
   las vistas interpolan entre ticks. Las entidades visuales nunca son la fuente de verdad.
3. **Red**: el juego solo habla con `GameSession`. La entrada viaja como `PlayerInput` (ejes del
   mundo, con `seq`); el estado público como snapshot cuantizado (`shared/netcodec.ts`) y el privado
   del propietario como `CharacterSnapshot` (`correction`). Mensajes y límites en `shared/protocol.ts`.
3b. **Servidor autoritativo**: nunca confiar en el cliente. Toda entrada pasa por `isValidPlayerInput`
   y por la cola de `ServerWorld` (máx. `NET.maxInputsPerTick` por tick y 1 de media: anti speed-hack);
   opciones de unión por `validateJoinOptions`; límite de mensajes por segundo. Cambiar el formato de
   un mensaje = subir `PROTOCOL_VERSION`. Códigos de cierre propios ≥ 4100 (Colyseus usa 4000-4010).
   El servidor y el cliente deben usar el mismo mapa (semilla), colisionadores y paso fijo: la
   bienvenida verifica la semilla. `ServerWorld` se prueba sin red; la sala solo conecta.
3c. **Modo offline primero**: el juego arranca sin conexión y el SDK de red solo se descarga al
   pulsar "Jugar en línea". Si la conexión se pierde, `Game` vuelve a offline conservando la posición.
4. **Lo que se ve es lo que choca**: los edificios se definen como prefabs de datos
   (`shared/world/prefab.ts`, `structures.ts`); de la misma lista de piezas salen la malla (`PrefabView`)
   y los colisionadores (`prefabColliders`). Escaleras = peldaños ≤ 0,4 m + rampa invisible (`stairs()`).
   Las construcciones de jugadores deberán usar este mismo formato y la capa de colisión `build`.
4b. **Personaje**: la lógica de movimiento es pura (`shared/movement.ts`: `motorIntent` +
   `applyCollisionResult`); `physics/CharacterBody` solo resuelve colisiones. Todo el estado del motor debe
   caber en `MotorState`/`CharacterSnapshot` (serializable) para que la reconciliación (`net/Prediction.ts`)
   siga siendo exacta. Nuevas acciones = nuevo bit en `Buttons`, nunca booleanos sueltos en `PlayerInput`.
4c. **Entrada**: cada dispositivo es una `InputSource` (`game/input/sources.ts`) en ejes de pantalla;
   `InputManager` las combina y convierte a mundo. Nada fuera de `game/input` lee teclado/táctil/mando.
5. **Rendimiento móvil primero**:
   - Fusionar geometría estática (`game/world/geometry.ts` → 1 draw call por objeto) e
     `InstancedMesh` para elementos repetidos. Objetivo: < 50 draw calls en escena de prueba.
   - Materiales `MeshLambertMaterial` con color por vértice; sin texturas salvo necesidad.
   - Respetar `QualitySettings` (pixel ratio limitado, sombras solo medium/high, densidad).
   - `matrixAutoUpdate = false` en estáticos; no crear objetos por frame en bucles calientes.
   - React no se re-renderiza por frame: HUD y joystick escriben en el DOM con refs.
   - Sombras: `shadowMap.autoUpdate = false`; se re-dibujan cada `shadowUpdateInterval` frames.
   - Rapier se carga diferido en su propio chunk.
6. **Cámara isométrica**: ortográfica desde (+1,+1,+1). Convertir entrada de pantalla a mundo con
   `screenToWorld` (no duplicar la matemática).
7. Código y comentarios en español; nombres de identificadores en inglés.
8. Cada sistema nuevo llega con tests de su parte pura. Actualizar `PROJECT.md` al cerrar cada avance.

## Fuera de alcance hasta nueva fase
Armas, construcción, tormenta y multijugador real (Colyseus): no implementarlos sin pedirlo.
Los ganchos ya existen (bits de `Buttons`, `MotorModifiers`, capa `build`, `PredictionController`).
