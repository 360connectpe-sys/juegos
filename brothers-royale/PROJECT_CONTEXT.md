# BROTHERS ROYALE — Contexto completo del proyecto

Este documento basta para continuar el trabajo en una sesión nueva sin el historial anterior.
Léelo junto con `CLAUDE.md` (reglas permanentes) y `PROJECT.md` (bitácora detallada por fase).
Estado a 27 de noviembre de 2026, tras cerrar la **fase 6 (armas, combate y curación)**.

---

## 1. Estado actual

| Dato | Valor |
|---|---|
| Repositorio | `360connectpe-sys/juegos`, carpeta `brothers-royale/` (el resto de carpetas son otros juegos: no tocarlos) |
| Rama de trabajo | `brothers-royale-phase-3.1` (todas las fases desde la 3.1 se acumulan en ella) |
| Último trabajo | Fase 6 en `4ca37e2` (sobre `c20346d`) |
| `main` | En `85dee86` (fase 2.2). **No fusionar con `main` salvo que se pida explícitamente.** |
| Pruebas | **281 pruebas en 32 archivos, todas en verde** (`npm run check`): 237 previas + 44 de combate |
| Bundle publicado | `jugar/` regenerado e idéntico a `dist/` (`diff -qr dist jugar` sin diferencias) |
| Protocolo de red | v5 (`PROTOCOL_VERSION`) |
| Fases hechas | 1, 2 (2.1, 2.2), 3.1, 3.2, 4, 5, 6 |
| Siguiente | Fase 7 (no iniciada; requiere petición explícita). La fase 8 = tres vidas y reaparición definitiva. Véase §9 |

### Historial de commits de la rama (antiguo → reciente)

| Commit | Autor | Contenido |
|---|---|---|
| `d9b274c` | Claude | Fase 1: base técnica |
| `5cea818` | Claude | Versión jugable en `jugar/` (GitHub Pages) |
| `a9ccb55` | Claude | Fase 2: personaje, cámara, entrada, edificios |
| `1e49e60` | Codex | 2.1: estabilidad de inicialización y reconciliación |
| `85dee86` | Codex | 2.2: validación de entradas y reconciliación de colisiones (**`main` está aquí**) |
| `cf307f9` | Claude | Fase 3.1: servidor autoritativo Colyseus |
| `5da1a88` | Codex | Endurecimiento multijugador y límite de 8 jugadores (AUDIT-3.1.md, SOAK-8-PLAYERS.md) |
| `2b4c845` | Claude | Fase 3.2: optimización gráfica mobile first |
| `05c5e41` | Claude | Fase 4: cámaras, controles y HUD personalizable |
| `5103899` | Claude | Fase 5: mapa ampliado, cofres e inventario |
| `db67122` | Codex | Auditoría integral 3.2–5 y validación endurecida (AUDIT-3.2-5.md) |
| `c20346d` | Claude | PROJECT_CONTEXT.md (sin funcionalidades nuevas) |
| `4ca37e2` | Claude | Fase 6: armas, combate y curación |

Los commits de Codex figuran con la identidad git "Hoàng Ý Tiến"; es la del agente externo, no un error.

---

## 2. Qué es el juego

Battle royale web multijugador, low poly, 2.5D isométrico, **mobile first en horizontal** y también
jugable en computadora. Inspirado en las mecánicas del género (botín, construcción, tormenta) con
identidad propia: no copiar nombres, personajes, arte, música ni mapas de juegos existentes.

Stack: Vite 8 · TypeScript 5.9 strict · React 19 (solo UI) · Three.js · Rapier
(`@dimforge/rapier3d-compat`) · Colyseus 0.18 (`@colyseus/core` + `ws-transport` en servidor,
`@colyseus/sdk` en cliente, carga diferida) · Vitest (+ jsdom para UI). Node ≥ 22.

### Comandos (desde `brothers-royale/`)

| Comando | Uso |
|---|---|
| `npm ci` | Instalar dependencias |
| `npm run dev` | Desarrollo. `?q=low\|normal` fuerza calidad; `?debug` expone `window.__BR_GAME__` |
| `npm run check` | Tipos + 281 tests + build cliente + build servidor. **Obligatorio antes de cada commit** |
| `npm run server` | Compila y arranca Colyseus en `ws://localhost:2567` (`PORT`, `HOST`) |
| `npm run build:pages` | Regenera `jugar/` (lo que sirve GitHub Pages). Commitear `jugar/` al cerrar cada avance |
| Online local | `npm run server` + `npm run dev`, botón "Jugar en línea" o `?online&server=ws://localhost:2567&name=Ana&code=SALA1` |
| Soak de 8 clientes | `BR_SOAK_SECONDS=610 ./node_modules/.bin/vitest run tests/audit.integration.test.ts -t 'sostiene 8 clientes' --disableConsoleIntercept --reporter=verbose` |

---

## 3. Arquitectura

```
brothers-royale/
  server/            index.ts (arranque), BrothersRoom.ts (sala Colyseus: identidad, cuotas,
                     validación, snapshots, reconexión), ServerWorld.ts (simulación autoritativa PURA, sin red)
  src/shared/        Lógica pura y determinista, compartida cliente/servidor:
                     constants, types, math, random (createRng), movement (motor), inputValidation,
                     reconciliation, protocol (v5, mensajes y límites), netcodec (snapshots cuantizados),
                     session, items (catálogo), inventory (+ validación, cargador, recarga, consumo),
                     match/{MatchState.ts, loot.ts}, world/{terrain, layout, prefab, structures, colliders},
                     combat/{weapons.ts (armas, rarezas, balance, salud, constantes), hitscan.ts (rayo-cápsula,
                     dispersión), CombatState.ts (autoridad: disparos, golpes, cadencia, cargador, recarga,
                     salud, botiquín, muertes, CombatLog), lagcomp.ts (PoseHistory), gear.ts (estado visible)}
  src/physics/       PhysicsWorld (Rapier, heightfield, lineOfSight, castCameraSphere, castStatic), CharacterBody
                     (KinematicCharacterController), groups (capas de colisión, incl. `build`)
  src/engine/        Engine (renderer, dispose), quality (Baja/Normal), AdaptiveResolution,
                     ContextLossMonitor, FixedStepLoop (30 Hz), IsometricCamera, Lighting,
                     camera/cameraMath (matemática pura de las 3 perspectivas)
  src/game/          Game (orquestador), settings, camera/CameraController,
                     entities/PlayerAvatar (SkinnedMesh), input/{InputManager, sources},
                     world/{PrefabView (InteriorBatch, createStaticPrefabBatch), Loot (ChestView, PickupView),
                     Terrain, Trees, geometry},
                     combat/{WeaponModels (modelos + WeaponBatch), CombatFx, CombatOverlay (DOM: mira, daño),
                     SoundFx (WebAudio), LocalWeapon (predicción visual)}
  src/net/           GameSession (interfaz) → OfflineSession (+ muñecos de práctica) | OnlineSession (carga diferida),
                     Prediction (PredictionController), Interpolation, MatchView (ReplicatedMatch),
                     CombatView (validación de mensajes de combate), config
  src/ui/            App, styles.css, components/ (Hud, FpsCounter, QualityToggle, GraphicsNotice,
                     OrientationHint, SettingsPanel, InteractPrompt, OnlinePanel, TouchControls, DeathScreen,
                     LoadingScreen, Logo), hud/{layout.ts, HudSlot.tsx, HudEditor.tsx, widgets.tsx}
  tests/             32 archivos Vitest (§7)
  jugar/             Bundle publicado en GitHub Pages
  CLAUDE.md          Reglas permanentes  ·  PROJECT.md  Bitácora por fase  ·  PROJECT_CONTEXT.md  Este archivo
  AUDIT-3.1.md, SOAK-8-PLAYERS.md, AUDIT-3.2-5.md   Informes de Codex
```

### Flujo de un tick
1. `InputManager` combina las `InputSource` (teclado, ratón con pointer lock, táctil multitouch, mando)
   en ejes de pantalla y las convierte a ejes del mundo con `moveToWorld` de la cámara activa.
2. `Game` produce un `PlayerInput` (`seq`, ejes, `aimYaw`, `aimPitch`, bits `Buttons`) por tick de
   `FixedStepLoop` (30 Hz). `computeAim` calcula la dirección del disparo desde los ojos (1ª/3ª: al punto del
   centro de la pantalla; isométrica: yaw de apuntado + ayuda vertical). `LocalWeapon` decide los efectos
   visuales inmediatos del arma propia. La sesión online añade `viewTick` (tick visto de los demás).
3. La `GameSession` lo aplica:
   - **Offline**: simulación local + `MatchState` + `CombatState` locales (+ 3 muñecos de práctica).
   - **Online**: se envía al servidor y se predice localmente (`PredictionController`); el servidor
     responde con snapshot público cuantizado a todos y `correction` (`CharacterSnapshot`) privada al dueño;
     el cliente reconcilia re-simulando desde la corrección. Los remotos se interpolan.
   - En el servidor, por cada entrada: movimiento → interacción (cofres) → combate (`CombatState.step` con la
     posición autoritativa y los objetivos rebobinados a `viewTick`). Eventos de combate: `combat` (sala),
     `hits` (atacante y víctima), `vitals`/`self` (dueño).
4. Las vistas (avatar con arma y poses de combate, cofres, objetos, efectos, HUD) interpolan entre ticks;
   nunca son fuente de verdad.

---

## 4. Funcionalidades implementadas por fase

### Fase 1 — Base técnica
Escena isométrica ortográfica desde (+1,+1,+1), terreno por heightfield con semilla, casa, árboles,
personaje provisional, iluminación, física Rapier, bucle de paso fijo, arquitectura preparada para red.

### Fase 2 (+2.1, 2.2 de Codex)
- Controlador 360°, sprint, salto, gravedad, giro suave; motor puro (`motorIntent` + `applyCollisionResult`).
- Cámara con seguimiento suave y recorte de techos al entrar en edificios.
- Entrada multitouch (joystick), WASD y Gamepad.
- Edificios como prefabs de datos: la misma lista de piezas genera malla y colisionadores.
  Escaleras = peldaños ≤ 0,4 m + rampa invisible.
- Animaciones de locomoción y contador de FPS.
- Codex 2.1/2.2: inicialización estable, `isValidPlayerInput` compartido, reconciliación de estado de colisión.

### Fase 3.1 — Servidor autoritativo (Colyseus)
- `ServerWorld` puro a 30 Hz (medido con `performance.now()`, no con `clock.deltaTime`).
- Salas por código, máximo **8 jugadores**, identificación, bienvenida que verifica la semilla del mapa.
- Protocolo v4, snapshots cuantizados (`netcodec`), correcciones privadas.
- Validación: `isValidPlayerInput`, `validateJoinOptions`, cola acotada (12) con máx. `NET.maxInputsPerTick`
  por tick y 1 de media (anti speed hack), límite de mensajes/s, rechazo de tipos desconocidos,
  cierre si el buffer de salida supera 256 KiB.
- Códigos de cierre propios ≥ 4100 (`closeReason()`); Colyseus usa 4000–4010.
- Reconexión con reserva de 15 s conservando identidad e inventario.
- Offline primero: el SDK solo se descarga al pulsar "Jugar en línea"; si se cae la conexión,
  se vuelve a offline conservando la posición.

### Fase 3.2 — Gráficos mobile first
- Solo dos calidades, **Baja** y **Normal**, que tocan únicamente el render (resolución, sombras, manchas),
  nunca física, mundo, oclusores ni cámara. Cambio en vivo con `Game.setQuality`.
- `AdaptiveResolution`: objetivo min(refresco, 60) Hz, p90 de frame, sondeo con backoff 2→32 ventanas,
  reversión exacta de sondeos fallidos. **Sin límite de FPS.**
- `ContextLossMonitor`: pérdida/restauración de contexto WebGL; la simulación sigue con entrada neutra.
- Avatar = 1 `SkinnedMesh` con material compartido; sombras de mancha en `InstancedMesh`;
  props estáticos en lote; árboles en 2 `InstancedMesh`; agua opaca con `renderOrder` 1.
- Ancho visible máximo 16:9 (`CAMERA.maxViewWidth`), aviso de orientación.

### Fase 4 — Cámaras, controles y HUD
- Cámaras isométrica, 3ª y 1ª persona, elegidas **solo desde Ajustes** (`CameraController`).
- Colisión de cámara con `castCameraSphere` (ignora jugadores). Avatar propio oculto en 1ª persona y con
  cámara a < 1,1 m (`CAMERA_RIG.hideAvatarBelow`).
- Mirada por frame (`consumeLook`) con sensibilidad de cámara, de apuntado e invertir Y.
- Táctil: joystick de movimiento + zona/stick de apuntado; teclado/ratón y mando completos.
- Bits `Buttons` reservados y enviados: FIRE, AIM, RELOAD, INTERACT, BUILD (sin efecto salvo INTERACT).
- HUD personalizable: `HudSlot` en coordenadas normalizadas al área segura (`.hud-safe`, `env(safe-area-inset-*)`),
  editor visual (arrastrar, tamaño, opacidad, guardar, restablecer). Elementos preparados: vida, vidas,
  inventario, minimapa, ataque, recarga, salto, interactuar, construir.
- Persistencia validada: `br.settings.v1`, `br.hud.v1`, `br.quality` (`parseSettings`, `parseHudLayout`, `safeStorage`).

### Fase 5 — Mapa ampliado, cofres e inventario
- Se mantienen casa grande, mirador y cajas; **8–12 casas pequeñas** accesibles (4 variantes, 4 paletas)
  por sectores (`placeSmallHouses`, RNG propio) sobre `TerrainParams.flatZones`; 140 árboles.
- Cofres deterministas dentro y fuera (prefab `chest`; id = orden en `layout.chests`), botón "Abrir".
- `MatchState` es la autoridad (servidor y `OfflineSession`): cada cofre se abre una vez por partida;
  interacción por flanco de INTERACT, posición autoritativa, distancia horizontal/vertical y línea de visión;
  procesamiento serial (sin aperturas simultáneas fraudulentas ni duplicación).
- Botín `rollChestLoot(semilla de partida, cofre)`: armas, munición, botiquines; **sin escudos**.
- Inventario de 5 huecos con **hacha permanente** en el hueco 1, bolsa de munición, recoger/intercambiar/soltar.
  Invariante: `MatchState.totals()` se conserva salvo al abrir un cofre.
- Cliente: `ReplicatedMatch` valida todo lo recibido; cofres y objetos en `InstancedMesh`;
  edificios con interior en un `BatchedMesh` (`InteriorBatch`). Minimapa con casas y cofres.

### Fase 6 — Armas, combate y curación
- Pistola, subfusil, rifle y escopeta (hitscan) + hacha cuerpo a cuerpo; rarezas común/rara/épica.
- Disparo, apuntado (zoom en 1ª/3ª), retroceso (bloom + patada de cámara), dispersión (cadera/apuntando,
  moverse, aire), alcance, caída de daño, cadencia, cargador (`ItemStack.mag`) y recarga (manual o automática).
- Salud 100 sin escudos; **ningún disparo > 65**. Botiquín: 5 s → +50 (tope 100), cancelable al atacar,
  recibir daño o cambiar de hueco.
- Muerte **provisional**: 3 s eliminado y vuelta con 100 (fase 8 pondrá las tres vidas). Evento `death` +
  gancho `CombatState.onDeath` + `CombatLog` (daño y bajas con estadísticas por jugador).
- Autoridad del servidor sobre impactos, salud, munición y cadencia; balas cortadas por paredes; daño solo de
  las tablas; compensación de latencia limitada a 12 ticks (400 ms).
- Vista: armas low poly en la mano (y en 1ª persona) dentro del lote de edificios (0 draw calls), efectos en 1
  InstancedMesh, números de daño, mira, marcador de acierto, destello al recibir daño, sonidos WebAudio,
  animaciones de ataque/recarga/hachazo/botiquín/caída, HUD de salud, munición, registro de bajas y aviso de
  eliminación, botón táctil «Disparar/Golpear/Curar», volumen en Ajustes.
- Muñecos de práctica sin conexión (para probar en GitHub Pages).
- Detalle, tablas de balance y mediciones: `PROJECT.md` → «Fase 6».

---

## 5. Decisiones técnicas clave (y por qué)

1. **Determinismo con semilla** (`createRng`) en `src/shared`; cada generador nuevo usa su propio RNG
   derivado para no alterar los demás. Nada de `Math.random()` en la simulación.
2. **Simulación separada del render** (30 Hz fijo, vistas interpoladas): permite servidor autoritativo y
   predicción exacta.
3. **Motor de personaje puro y serializable** (`MotorState`/`CharacterSnapshot`): la reconciliación
   re-simula exactamente. Acciones nuevas = bit nuevo en `Buttons`, nunca booleanos sueltos.
4. **Servidor autoritativo sin confiar en el cliente**; `ServerWorld` se prueba sin red, la sala solo conecta.
   Cambiar formato de mensaje = subir `PROTOCOL_VERSION` (hoy v4).
5. **Lo que se ve es lo que choca**: prefabs de datos → malla + colisionadores. Futuras construcciones usarán
   el mismo formato y la capa `build`.
6. **Objetos nunca predichos en el cliente**: más simple y seguro; la latencia de abrir/recoger es aceptable.
7. **Calidad solo afecta al render** para que no dé ventaja competitiva.
8. **Presupuesto de draw calls**: < 30 en Normal y < 20 en Baja (fase 5 con 6 jugadores: 24 / 15).
   `MeshLambertMaterial` con color por vértice, sin texturas; `matrixAutoUpdate = false` en estáticos;
   sombras con `autoUpdate = false` cada `shadowUpdateInterval` frames; Rapier y SDK de red en chunks diferidos.
9. **React no re-renderiza por frame**: HUD y joystick escriben en el DOM con refs.
10. **Cámara = solo vista**: nunca toca física ni protocolo; solo aporta `moveToWorld` y el yaw de apuntado.
11. Código y comentarios en español, identificadores en inglés.
12. **Combate autoritativo y puro** (`CombatState`, misma clase en servidor y offline): el cliente nunca decide
    impactos ni daño; su predicción es solo visual (`LocalWeapon`). Disparos hitscan (baratos en CPU y red).
13. **Balance por tiempo esperado para eliminar** (`expectedTimeToKill`) con pruebas de roles: escopeta/subfusil
    cerca, subfusil a media distancia, rifle lejos, pistola de reserva. Rifle 4 → 3,5 disparos/s. La rareza
    nunca ahorra un disparo a quemarropa (daño casi igual; mejora dispersión y recarga).
14. **Compensación de latencia** por rebobinado de poses (no por extrapolación en el cliente), limitada.
15. **Estado visible en los flags del snapshot** (10 bits) en vez de un campo nuevo: mismo tamaño de paquete.
16. **Combate sin draw calls nuevos en reposo**: armas en el `BatchedMesh` de edificios (mismo material),
    efectos en una InstancedMesh oculta sin efectos, números de daño en DOM.
17. **Muerte provisional** (3 s) para poder jugar ya, con el evento y el gancho listos para la fase 8.

---

## 6. Auditorías

| Auditoría | Alcance | Resultado |
|---|---|---|
| Claude sobre `1e49e60` | Revisión de la fase 2.1 de Codex, solo lectura (sin cambios ni commit) | Hallazgos entregados en conversación; Codex los incorporó en `85dee86` (2.2) |
| `AUDIT-3.1.md` (Codex, `5da1a88`) | Fase 3.1 (`cf307f9`) | Ready idempotente con cuota, rechazo de tipos desconocidos, límite bruto 180 msg/s, créditos de reposo, controles solo tras bienvenida, reconexión (minUptime 0, ~15 s), limpieza al re-bienvenir, snapshots atrasados no resucitan remotos, cierre a 256 KiB, cancelación de uniones tardías, `Engine.dispose` completo. Medición histórica con 16 clientes: 29,81 Hz, paso p95 3,56 ms. Tras ello: límite de 8 jugadores |
| `SOAK-8-PLAYERS.md` (Codex) | 8 clientes, 10 min (fase 3.1) | 0 desconexiones, 30,00 Hz, paso p50/p95/máx 0,740/1,189/39,5 ms, 125 KB/s salientes, cola máx. 3 |
| `AUDIT-3.2-5.md` (Codex, `db67122`) | Fases 3.2, 4 y 5 (`5103899` vs `5da1a88`) | Ver detalle abajo |

### Correcciones de `db67122` (AUDIT-3.2-5)
- **Alta**: `PhysicsWorld.lineOfSight` tenía tolerancia 0,6 m (se podía recoger a través de una pared cercana).
  Ahora 2 cm y solo se excluye el collider marcado `interactionTarget` (cofre) que contiene el punto objetivo.
- `isValidInventory` estricto: pertenencia propia al catálogo (sin `__proto__`/`toString`), límites por tipo,
  sin munición en huecos, hacha única, rarezas conocidas.
- `isValidPickup`: id entero seguro positivo, cantidad ≤ stack, rareza válida.
- `ReplicatedMatch.load` limpia el inventario si llega inválido.
- `MatchState.addPlayer` idempotente (no pierde objetos al repetir alta).
- `Engine.dispose` llama a `BatchedMesh.dispose`.
- `AdaptiveResolution.reset` reinicia también `fastestFrame`, `refreshHz`, `lastChange`, `windowsSinceChange`.
- `HudSlot` mide con `ResizeObserver` y mantiene el elemento completo en el área segura (ajuste visual de escala).
- `HudEditor`: las flechas respetan input/select/textarea. Almacenamiento del HUD vía `safeStorage`.
- Soak final: 8 clientes, 610 s, 30,00 Hz, paso p50 0,577 / p95 1,141 / máx 190,45 ms,
  126.687 B/s salientes, 0 desconexiones.
- Gráficos con 8 jugadores (SwiftShader 844×390): Baja 15–19 draw calls; Normal 14–30; frame completo sin
  culling: Baja 20, **Normal 31** (1 sobre el objetivo).

---

## 7. Pruebas: 281 en 32 archivos

| Archivo | Nº | Cubre |
|---|---|---|
| `shared.test.ts` | 16 | Constantes, RNG, matemática, movimiento puro |
| `world.test.ts` | 13 | Terreno, layout, casas pequeñas, prefabs, colisionadores, determinismo |
| `physics.test.ts` | 13 | Rapier: personaje, escaleras, pendientes, línea de visión, cámara |
| `inputValidation.test.ts` | 27 | `isValidPlayerInput`, opciones de unión, inventarios y pickups malformados |
| `netcode.test.ts` | 15 | Codec de snapshots, predicción y reconciliación, interpolación |
| `net.test.ts` | 2 | Interfaz `GameSession` / offline |
| `onlineSession.test.ts` | 7 | `OnlineSession`: bienvenida, correcciones, reconexión, limpieza |
| `serverWorld.test.ts` | 9 | Simulación autoritativa sin red, cola y anti speed hack |
| `server.integration.test.ts` | 2 | Clientes SDK reales contra la sala (incl. reconexión con inventario) |
| `serverPerf.test.ts` | 2 | Coste del paso del servidor |
| `audit.integration.test.ts` | 7 | Regresiones de AUDIT-3.1 y soak de 8 clientes (duración vía `BR_SOAK_SECONDS`) |
| `auditFinal.test.ts` | 10 | Regresiones de AUDIT-3.2-5 (visión, inventario, alta idempotente, dispose, reset) |
| `match.integration.test.ts` | 2 | 6 clientes: un ganador por cofre, conservación de totales |
| `loot.test.ts` | 14 | `rollChestLoot`, `MatchState`, inventario, intercambio, soltar |
| `lootClient.test.tsx` | 8 | `ReplicatedMatch`, vistas de cofres/objetos, prompt "Abrir" |
| `engine.test.ts` | 11 | Engine, paso fijo, dispose |
| `graphics.test.ts` | 18 | Calidades, resolución adaptativa, pérdida de contexto, draw calls |
| `graphicsUi.test.tsx` | 5 | UI de calidad y avisos gráficos |
| `avatar.test.ts` | 1 | Avatar SkinnedMesh y recursos compartidos |
| `cameras.test.ts` | 13 | Matemática de las 3 cámaras, colisión, ocultar avatar |
| `controls.test.tsx` | 12 | Fuentes de entrada, táctil multitouch, sensibilidad |
| `hudSettings.test.tsx` | 12 | Ajustes, editor del HUD, persistencia validada |
| `hudSafe.test.tsx` | 3 | Área segura del HUD, teclado del editor, almacenamiento bloqueado |
| `ui.test.tsx` | 9 | App, carga, HUD básico |
| `onlineUi.test.tsx` | 4 | Panel online |
| `stability.test.tsx` | 2 | Ciclos de montaje/desmontaje sin fugas |
| `combat.test.ts` | 18 | Fase 6: rayo-cápsula, dispersión, estado visible, cadencia, munición finita, recarga, cambio de arma, ningún one-shot, pared, muerte/registro/vuelta, hacha, botiquín, rebobinado |
| `combatServer.test.ts` | 5 | Fase 6 con `ServerWorld` y Rapier reales: impacto, pared real, compensación con límite, ráfagas tramposas, eliminado inactivo |
| `combat.integration.test.ts` | 2 | Fase 6: 8 clientes SDK disparándose con latencia simulada (coherencia total) y blanco en movimiento con 150 ms (9/9 con compensación; 1/9 sin ella) |
| `combatBalance.test.ts` | 6 | Fase 6: valores pedidos, ajuste del rifle, sin one-shot, roles por distancia, ninguna arma domina, rarezas moderadas |
| `combatClient.test.tsx` | 12 | Fase 6: validación v5, predicción visual, armas en el lote de edificios, FX en 1 malla, números de daño, HUD, volumen |
| `combatOffline.test.ts` | 1 | Fase 6: muñecos de práctica con física real |

Regla: no bajar de 281; cada sistema nuevo llega con tests de su parte pura.

---

## 8. Errores conocidos y limitaciones

**Medición / hardware**
- Los FPS medidos con SwiftShader (Chromium headless) no representan celulares; faltan mediciones en
  teléfonos físicos y en redes reales (la pérdida simulada es a nivel aplicación; WebSocket usa TCP).
- La detección de refresco no distingue un navegador limitado a 30 Hz de una GPU que solo llega a 30 FPS.

**Render**
- Normal con todos los avatares visibles y sin culling: 31 draw calls (objetivo < 30). Con el banco de 8
  jugadores disparando (culling normal) la fase 6 mide 28-29 en Normal y 18 en Baja.
- Normal isométrica dio 15 FPS en SwiftShader (no representativo, pero vigilar).
- La cámara de 3ª persona no colisiona con las copas de los árboles.

**Red**
- Historial de predicción de 128 entradas: tras retrasos largos puede haber salto brusco.
- Correcciones ~300 B por tick, aplicadas sin suavizado.
- Pico puntual del paso del servidor de 190 ms en el soak (el bucle se recupera).
- Una sola instancia de servidor, salas anónimas, sin protección contra creación masiva de salas.
- Desde GitHub Pages (https) el modo online necesita un servidor `wss://`; no hay ninguno desplegado.

**Juego**
- Los cofres no se rellenan: no hay fin de partida ni reinicio de sala.
- Muerte provisional (vuelta a los 3 s con el inventario); sin daño por caída; sin multiplicador por cabeza.
- El rifle épico deja a 0,8 de salud con 4 disparos (99,2): diseño deliberado (la rareza no ahorra disparos).

**Combate (fase 6)**
- La compensación de latencia no pasa de 400 ms (con más latencia hay que adelantar el tiro).
- La predicción visual puede mostrar un disparo de más/menos al final del cargador con latencia alta.
- El arma de 1ª persona puede atravesar visualmente una pared si el jugador se pega mucho (solo vista).
- Los mensajes de combate no están cuantizados (~3,7 KB/s por cliente con 8 disparando sin parar).
- `BR_BENCH_LOADOUT` arma a jugadores por prefijo de nombre: SOLO para pruebas de carga; no activarlo en
  producción.

---

## 9. Cómo continuar

1. `cd brothers-royale && npm ci && npm run check` → deben salir 281 tests en verde.
2. Leer `CLAUDE.md` (reglas, presupuestos de rendimiento, fuera de alcance) y la sección de la fase
   correspondiente en `PROJECT.md`.
3. Trabajar en la rama indicada por el usuario (hasta ahora `brothers-royale-phase-3.1`), sin fusionar con
   `main` y sin modificar otros juegos del repositorio.
4. Al cerrar un avance: tests nuevos, actualizar `PROJECT.md` (y este archivo si cambia la arquitectura,
   el estado o los errores conocidos), `npm run build:pages`, `npm run check`, commit y push a la rama.

**Fuera de alcance hasta que se pida**: fase 7 (no iniciarla sin petición), tres vidas y reaparición definitiva
(fase 8), tala de árboles, construcción funcional y tormenta. Ganchos listos: evento `death` y
`CombatState.onDeath`, `CombatLog`, bit `BUILD`, `MotorModifiers`, capa `build`, `PredictionController`.

**Probar el combate**: sin conexión hay 3 muñecos de práctica delante del punto de aparición; en `?debug`,
`__BR_GAME__.debugGive({ kind: 'rifle', qty: 1, rarity: 'epic' })` y `debugGive({ kind: 'ammo_medium', qty: 90 })`
dan objetos. En línea: `npm run server` + «Jugar en línea» en dos pestañas (las armas salen de los cofres).

**Roadmap pendiente** (PROJECT.md): fase 7 (contenido a confirmar), fase 8 (tres vidas y reaparición
definitiva), tala, construcción, tormenta, partida completa y lobby. Candidatos técnicos: suavizar correcciones,
cuantizar los mensajes de combate, colisión de cámara con copas, fin de partida/reinicio de sala, despliegue de
un servidor `wss://`, medición en móviles reales.


## Auditoría de fase 6 posterior a 51269ce

288 pruebas aprobadas. AUDIT-6.md describe cancelación de temporizadores al cambiar de hueco,
limpieza de poses tras reaparecer, estadísticas acotadas y cierre seguro del loadout de pruebas.
BR_BENCH_LOADOUT solo se permite con NODE_ENV=test y --br-bench-loadout.
