# BROTHERS ROYALE — instrucciones permanentes

> **Sesión nueva: lee primero `PROJECT_CONTEXT.md`** (arquitectura, funcionalidades, decisiones, auditorías,
> pruebas, errores conocidos y estado actual). Permite continuar sin el historial de conversaciones anteriores.

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
  Incluye `config.js` (URL del servidor editable sin recompilar; queda vacío tras compilar).
- Despliegue del servidor (Docker, Render, Oracle + Caddy/WSS, variables `PORT`, `HOST`, `ALLOWED_ORIGINS`,
  `MAX_ROOMS`): **DEPLOY.md**. El máximo de 8 jugadores por sala no se configura por entorno.

## Arquitectura y reglas
```
src/shared/   Lógica PURA y determinista (sin Three, sin DOM): constantes, tipos, movimiento,
              generación del mapa, colisionadores, protocolo de red, partida (`match/`) y combate
              (`combat/`: armas, balance, disparos, salud, compensación de latencia). La usa el servidor.
src/physics/  Rapier, sin Three ni DOM (reutilizable en Node/Colyseus).
src/engine/   Render genérico: renderer, cámara isométrica, luces, calidad, bucle de paso fijo;
              `engine/camera/cameraMath.ts` (matemática pura de las 3 perspectivas).
src/game/     Juego: mundo visual, entidades (vistas), entrada, orquestador `Game`; `game/combat/` = armas
              en la mano, efectos, sonido, capa de mira/daño y predicción visual del arma propia.
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
3c. **Modo offline primero**: la pantalla principal carga sin conexión y el SDK de red solo se descarga al
   pulsar "Jugar en línea". Si la conexión se pierde, `Game` vuelve a offline conservando la posición.
4. **Lo que se ve es lo que choca**: los edificios se definen como prefabs de datos
   (`shared/world/prefab.ts`, `structures.ts`); de la misma lista de piezas salen la malla (`PrefabView`)
   y los colisionadores (`prefabColliders`). Escaleras = peldaños ≤ 0,4 m + rampa invisible (`stairs()`).
   Las construcciones de jugadores deberán usar este mismo formato y la capa de colisión `build`.
   Mapa (fase 5): pueblo fijo (casa grande, mirador, cajas) + casas pequeñas por sectores (`placeSmallHouses`, su
   propio RNG) asentadas en `TerrainParams.flatZones` + cofres (prefab `chest`, ids estables = orden en
   `layout.chests`). Un generador nuevo = su propio RNG derivado de la semilla, para no alterar los demás.
4d. **Cofres, objetos e inventario**: la autoridad es `MatchState` (`shared/match/`), que ejecuta el servidor
   (`ServerWorld`) y, sin conexión, `OfflineSession`. Nunca se predicen en el cliente: el cliente solo muestra
   (`ReplicatedMatch`, que valida lo que llega). Las interacciones van por el bit `INTERACT` en el flanco, con la
   posición autoritativa, distancia y línea de visión (`PhysicsWorld.lineOfSight`). El botín se decide con
   `rollChestLoot(semilla de partida, cofre)`. El hacha (hueco 1) es permanente. Sin escudos. Cualquier cambio de
   objetos debe conservar `MatchState.totals()` (no duplicar ni perder) salvo al abrir un cofre.
4b. **Personaje**: la lógica de movimiento es pura (`shared/movement.ts`: `motorIntent` +
   `applyCollisionResult`); `physics/CharacterBody` solo resuelve colisiones. Todo el estado del motor debe
   caber en `MotorState`/`CharacterSnapshot` (serializable) para que la reconciliación (`net/Prediction.ts`)
   siga siendo exacta. Nuevas acciones = nuevo bit en `Buttons`, nunca booleanos sueltos en `PlayerInput`.
4c. **Entrada**: cada dispositivo es una `InputSource` (`game/input/sources.ts`) en ejes de pantalla;
   `InputManager` las combina y convierte a mundo. Nada fuera de `game/input` lee teclado/táctil/mando.
4e. **Combate (fase 6)**: la autoridad es `CombatState` (`shared/combat/`), que ejecutan `ServerWorld` y, sin
   conexión, `OfflineSession`, DESPUÉS del paso de movimiento y con la posición autoritativa. El cliente solo
   manda botones, `aimYaw`/`aimPitch` (desde los ojos, `EYE_HEIGHT`) y `viewTick`; nunca daño, impactos,
   munición ni cadencia. Reglas: ningún disparo supera `HEALTH.maxShotDamage` (65 < 100); las balas se cortan
   en el primer obstáculo estático (`PhysicsWorld.castStatic`); la cadencia se mide con el tiempo de las
   entradas procesadas y sin "ahorrar" disparos; el cargador vive en `ItemStack.mag`; el rebobinado de la
   compensación de latencia se limita a `LAG_COMPENSATION.maxRewindTicks`. Valores de armas y rarezas SOLO en
   `shared/combat/weapons.ts`, y cualquier cambio de balance pasa `tests/combatBalance.test.ts` y se documenta.
   El estado visible de los demás viaja en 10 bits del snapshot (`combat/gear.ts`). Fase 8: tres vidas,
   espera de 5 s y reaparición desde el cielo; la tercera muerte es definitiva. Véase PHASE-8.md.
   Vista: lo que se lleva en la mano va en el `BatchedMesh` de los edificios (`WeaponBatch`, 0 draw calls);
   trazadoras/chispas en una InstancedMesh (`CombatFx`); números de daño y mira en DOM (`CombatOverlay`);
   sonidos sintetizados (`SoundFx`). La predicción del arma propia (`LocalWeapon`) es SOLO visual.
5. **Rendimiento móvil primero**:
   - Fusionar geometría estática (`game/world/geometry.ts` → 1 draw call por objeto) e
     `InstancedMesh` para elementos repetidos. Objetivo: < 50 draw calls en escena de prueba.
   - Materiales `MeshLambertMaterial` con color por vértice; sin texturas salvo necesidad.
   - Solo DOS calidades: Baja y Normal (`engine/quality.ts`). La calidad SOLO puede tocar render (resolución,
     sombras, manchas de sombra): nunca el mundo, la física, los oclusores ni la cámara (ventaja competitiva).
     Se cambia en vivo con `Game.setQuality`.
   - Presupuesto: < 30 draw calls en Normal y < 20 en Baja (fase 6, 8 jugadores disparando: 28-29 y 18). Edificios con
     interior = un `BatchedMesh` (`InteriorBatch`); cofres y objetos = `InstancedMesh` (vacíos, invisibles). Avatares =
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
   corresponda (teclado, ratón, táctil, mando). Ataque, apuntado, recarga e interacción tienen efecto desde la
   fase 6; construir usa el mismo bit BUILD desde la fase 7. Atacar también orienta al personaje hacia `aimYaw`.
6c. **HUD y preferencias**: los elementos del HUD se colocan con `HudSlot` en coordenadas normalizadas al área
   segura (`.hud-safe` usa `env(safe-area-inset-*)`). Todo lo que se guarda en `localStorage` (`br.settings.v1`,
   `br.hud.v1`, `br.quality`) se valida al leerlo (`parseSettings`, `parseHudLayout`); nunca confiar en lo guardado.
   Un elemento nuevo del HUD = entrada en `HUD_ELEMENTS` + posición de fábrica en `defaultHudLayout()`. El volumen
   va aparte (`br.volume.v1`) para no cambiar el formato de `br.settings.v1`.
7. Código y comentarios en español; nombres de identificadores en inglés.
8. Cada sistema nuevo llega con tests de su parte pura. Actualizar `PROJECT.md` al cerrar cada avance.

## Estado vigente y fuera de alcance

Fases 7, 8 y 9 implementadas; leer PHASE-7.md, PHASE-8.md y PHASE-9.md. No iniciar fase 10,
cuentas ni persistencia externa sin petición. La prueba real de 30 minutos está reservada para fase 10.

Construcción: BuildingState, BuildingWorld y BuildingView; materiales y colocaciones solo cambian
en la autoridad. Respetar límites y soporte. Desde la corrección móvil (MOBILE-FIXES.md): sin ventana
central; botones pared/rampa/suelo (mantener = vista previa marrón/roja, soltar = colocar una vez);
casilla, rotación y altura con `planBuild` (no hay nivel manual); el extremo alto de la rampa y el borde
del suelo dan soporte; apoyo en laderas sobre el punto más alto. El techo sigue en el sistema (V, mando).
Render en Safari iOS (sin WEBGL_multi_draw): NUNCA un BatchedMesh con muchas instancias sin alternativa
(cuesta 1 draw call por instancia); comprobar `Engine.multiDraw`. Un BatchedMesh no comparte material con
mallas normales (cambio de programa por frame). Nada de objetos nuevos por acceso en getters de sesión.
Controles táctiles: arrastre con `TouchDrag` (zona muerta + tope); la mira táctil es conmutable.
Ciclo: BattleRound y zone, compartidos servidor/offline. Vidas, protección y espera avanzan una
vez por tick real de simulación, no por entrada. Máximo 1800 s también con reloj monotónico.
Desempate: vidas, eliminations (definitivas), HP. El inventario se conserva al reaparecer hasta
que se defina otra regla. No reiniciar secuencias ni retroceder revisiones de construcción.
Red v8: nuevas sesiones durante una ronda son espectadoras; reconectar conserva las vidas.
Lobby: LobbyState valida anfitrión, Listo y perfiles. Sala online = BattleRound.managed; sin
inicio automático, acciones bloqueadas fuera de partida y resultados hasta elección del jugador.
Doce skins de polo en shared/lobby/profile; nunca cambian física o estadísticas. Nombre/skin en
br.profile.v1. Mantener los nombres DOM limitados a ocho, con visión y sin HTML interpretado.
Registro: hasta diez resultados por sala y 2000 eventos de combate por ronda. No persistencia externa.
BR_BENCH_LOADOUT requiere NODE_ENV=test y --br-bench-loadout; jamás habilitarlo en producción.
