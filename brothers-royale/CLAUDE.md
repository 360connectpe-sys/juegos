# BROTHERS ROYALE — instrucciones permanentes

Battle Royale web multijugador, low poly, cámara isométrica 2.5D, para celular y computadora.
Inspirado en las mecánicas de Fortnite pero con identidad propia: no copiar nombres, personajes,
arte, música, mapas ni el aspecto de ningún juego existente.

## Stack
Vite 8 · TypeScript 5.9 (strict) · React 19 (solo UI/HUD) · Three.js (render) ·
Rapier (`@dimforge/rapier3d-compat`, física) · Colyseus 0.18 (`@colyseus/core` + `ws-transport` en el
servidor, `@colyseus/sdk` en el cliente, cargado de forma diferida) · Vitest.

## Comandos (desde `brothers-royale/`)
- `npm run dev` — servidor de desarrollo (`?q=low|normal` fuerza calidad, `?debug` expone `window.__BR_GAME__`).
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
src/engine/   Render genérico: renderer, cámara isométrica, luces, calidad, bucle de paso fijo;
              `engine/camera/cameraMath.ts` (matemática pura de las 3 perspectivas).
src/game/     Juego: mundo visual, entidades (vistas), entrada, orquestador `Game`.
src/net/      Frontera de red: `GameSession` → `OfflineSession` (por defecto) y `OnlineSession`
              (Colyseus: predicción + reconciliación + interpolación de remotos).
server/       Servidor Node: `ServerWorld` (simulación autoritativa pura, sin red) y
              `BrothersRoom` (sala Colyseus: identidad, validación, snapshots, conexión).
src/ui/       React: carga, HUD, controles táctiles, Ajustes. React NO toca la escena 3D por frame.
              `ui/hud/` = disposición del HUD (datos puros), editor visual e indicadores.
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
   - Solo DOS calidades: Baja y Normal (`engine/quality.ts`). La calidad SOLO puede tocar render (resolución,
     sombras, manchas de sombra): nunca el mundo, la física, los oclusores ni la cámara (ventaja competitiva).
     Se cambia en vivo con `Game.setQuality`.
   - Presupuesto: < 30 draw calls con 8 jugadores en Normal (hoy 26) y < 20 en Baja (hoy 15). Avatares =
     una `SkinnedMesh` con geometría por paleta y material compartidos; sombras de mancha en un `InstancedMesh`;
     prefabs sin interior en un lote estático (`createStaticPrefabBatch`); la casa es 1 malla desde fuera.
   - Superficies grandes opacas (agua) con `renderOrder` alto para que la profundidad descarte lo cubierto.
   - Sin límite de FPS. La resolución adaptativa (`AdaptiveResolution`) apunta a min(refresco, 60) Hz.
   - Pérdida de contexto WebGL: `ContextLossMonitor`; la simulación sigue con entrada neutra.
   - Prioridad: celular en horizontal. El ancho visible máximo es el de 16:9 (`CAMERA.maxViewWidth`).
   - `matrixAutoUpdate = false` en estáticos; no crear objetos por frame en bucles calientes.
   - React no se re-renderiza por frame: HUD y joystick escriben en el DOM con refs.
   - Medir antes y después de cualquier optimización (draw calls, programas, geometrías, CPU/frame).
   - Sombras: `shadowMap.autoUpdate = false`; se re-dibujan cada `shadowUpdateInterval` frames.
   - Rapier se carga diferido en su propio chunk.
6. **Cámaras**: isométrica (ortográfica desde (+1,+1,+1)), 3ª y 1ª persona (`CameraController`). La perspectiva
   se elige SOLO desde Ajustes. Es SOLO vista: convierte la entrada de pantalla a mundo con `moveToWorld`
   (isométrica = `screenToWorld`) y aporta el yaw para `aimYaw`; nunca toca la física ni el protocolo. La colisión
   de cámara usa `PhysicsWorld.castCameraSphere` (consulta, no simulación; ignora jugadores). En 3ª/1ª no hay
   recorte de techos. El avatar propio se oculta en 1ª persona y con la cámara a < `CAMERA_RIG.hideAvatarBelow`.
6b. **Mirada y apuntado**: la mirada se consume por frame de render (`InputManager.consumeLook`), con
   sensibilidad de cámara, de apuntado e invertir Y. Acciones nuevas = bit de `Buttons` en la fuente que
   corresponda (teclado, ratón, táctil, mando). Ataque, recarga, interacción y construcción ya envían su bit, pero
   no tienen efecto hasta su fase.
6c. **HUD y preferencias**: los elementos del HUD se colocan con `HudSlot` en coordenadas normalizadas al área
   segura (`.hud-safe` usa `env(safe-area-inset-*)`). Todo lo que se guarda en `localStorage` (`br.settings.v1`,
   `br.hud.v1`, `br.quality`) se valida al leerlo (`parseSettings`, `parseHudLayout`); nunca confiar en lo guardado.
   Un elemento nuevo del HUD = entrada en `HUD_ELEMENTS` + posición de fábrica en `defaultHudLayout()`.
7. Código y comentarios en español; nombres de identificadores en inglés.
8. Cada sistema nuevo llega con tests de su parte pura. Actualizar `PROJECT.md` al cerrar cada avance.

## Fuera de alcance hasta nueva fase
Armas/combate, cofres, construcción funcional y tormenta: no implementarlos sin pedirlo.
Los ganchos ya existen (bits de `Buttons`, `MotorModifiers`, capa `build`, `PredictionController`).
