# BROTHERS ROYALE — Contexto completo del proyecto

Este documento basta para continuar el trabajo en una sesión nueva sin el historial anterior.
Léelo junto con `CLAUDE.md` (reglas permanentes) y `PROJECT.md` (bitácora detallada por fase).
Estado a 28 de noviembre de 2026: fase 14 autorizada para desarrollo y beta; despliegue público pendiente de verificación externa.


## Checkpoint fase 15 (optimización, rediseño, construcción y estabilidad) — actualizar en cada bloque

Base: `ce5c450` (fases 13 y 14 de Codex, protocolo v10). Checkpoints en `claude/brothers-royale-setup-x3gvn0`;
`brothers-royale-phase-3.1` (Render auto-deploy) y `brothers-royale-beta-pages` SOLO tras confirmar con el usuario que
no hay partidas activas. Reanudación programada 2026-11-28 08:15 UTC (3:15 a. m. Perú). Manual:
`git fetch origin claude/brothers-royale-setup-x3gvn0 && git merge --ff-only FETCH_HEAD && cd brothers-royale && npm ci && npm run check`
y seguir por el primer bloque PENDIENTE.

| Bloque | Estado |
|---|---|
| 15.1 Optimización | HECHO (ver abajo) |
| 15.2 H1/H7/H16/H17 | HECHO (ver abajo) |
| 15.3 Construcción | HECHO (protocolo v11) |
| 15.4 Terreno/zonas/vegetación | PENDIENTE |
| 15.5 Personajes/armas/paracaídas | PENDIENTE |
| 15.6 Animaciones/agacharse | PENDIENTE |
| 15.7 Botín/HUD/tormenta | PENDIENTE |
| 15.8 Integración y preparación de publicación | PENDIENTE |

**15.1** (`quality.ts`, `AdaptiveResolution.ts`, `Engine.ts`, `Game.ts`): sin sombras ni manchas en Baja y Normal;
resolución adaptativa con pasos más suaves (0,08, máx. ×2) y suelos 0,6/0,75; `PerformanceGovernor`: si Normal no
llega al objetivo con la resolución mínima 4 ventanas seguidas pasa a Baja (solo sin elección manual); LOD aéreo
(sin cofres/objetos ni recorte de techos en avión/caída/paracaídas); remotos a > 45 m sin recalcular animación;
precompilación de shaders de lo oculto (avión, paracaídas, zombis, tormenta, objetos). Medido (Chromium swiftshader,
práctica offline 1280×720, NO dispositivo): Normal 20 → 12 draw calls, 33 k → 21 k triángulos; Baja 13 → 12.
**15.2**: H1 `config.js` y fuentes ya no bloquean el primer pintado (`loadRuntimeConfig`, máx. 2,5 s; SW con red
máx. 2 s y copia guardada). H7 `SoundFx`: desbloqueo en touchend/click/pointerup, `webkitAudioContext`, búfer
silencioso, `navigator.audioSession='playback'` + `<audio>` silencioso (interruptor de silencio), reanudación tras
segundo plano/`interrupted`; sonidos nuevos `chop` (madera) y `pickup` (recoger/abrir cofre). **Sin prueba en iPhone
real.** H16 corrección del servidor absorbida solo en el dibujo (`PlayerAvatar.absorbCorrection`, ~0,18 s; >2,5 m =
teletransporte). H17 `scripts/sync-beta.mjs` (publicar conservando build actual + anterior y `config.js`; borra
los antiguos; `releases.json`) y SW que ya no conserva cachés viejas para siempre. Pruebas: `tests/phase15.test.ts`.

**15.3** (protocolo **v11**; `BuildingState.ts`, `BuildingWorld.ts`, `BuildingView.ts`, `layout.ts` `buildSlots`,
`prefab.ts` `nav.openings`, `Game.ts`, `sources.ts`). Causas reales: (1) la pared se colocaba en el CENTRO de la
casilla (pared a mitad de plataforma) y dos paredes en esquina se solapaban (no se podían cerrar habitaciones);
(2) la cuadrícula de 3 m no coincide con las casas (giradas), así que una pared en la puerta chocaba con sus muros.
Ahora: pared en el borde (`WALL_EDGE`, `anchorOf`), una sola por borde compartido (`sameWall`), esquinas sin solape
(comprobación como plano), contacto pared↔suelo/rampa/techo permitido solo en su borde; planificador: borde
delante en la casilla propia (o la siguiente si está pegado), techo sobre la casilla propia, giro previo (tecla T,
`configureBuild(_, true)`); paneles a medida para huecos de puerta/boquete (`BuildRequest.slot/yaw/w/h`, la
autoridad compara con `buildSlots(layout)`); vista previa verde/roja. Pruebas: `tests/phase15Build.test.ts`.
Pendiente menor: botón táctil de giro (no añadido para no saturar el HUD).

Se corrigieron 5 pruebas desfasadas por la fase 14 (categoría `attachment`, munición por casilla, minimapa arriba a la
izquierda) y la de 15 min (fixture fuera de zona). Suite: 443 OK + 2 omitidas.

## Fase 14 — publicación autorizada (2026-11-28)

Base de desarrollo sincronizada: `2882118` (PWA fase 13). Trabajo aislado de los cambios
antiguos de `/workspace/juegos`; solo se modifica `brothers-royale/`.

- Contrato **v10** en cliente y servidor: francotirador (65 cuerpo / 100 cabeza, 5 balas,
  1,5 s/disparo, 3 s recarga, 150 m), `scope2` y campo opcional `ItemStack.scope='x2'`.
  `gear` pasa a 11 bits; bit 10 = x2 instalada. Mensaje `scope: {equipped:boolean}` limitado
  por el presupuesto existente, permiso de jugador vivo en tierra y posesión real del objeto.
- Mira x2 desmontable en las cuatro armas anteriores; francotirador con x4 fija. Equipar,
  retirar, intercambiar, soltar y recoger conservan mira/cargador. Inventario lleno al retirar:
  la mira cae al suelo. Ópticas DOM y cámara única; modelos/siluetas/sonidos sintetizados.
- HUD: SVG distintos, munición por casilla, minimapa arriba a la izquierda, salud/vidas debajo,
  mapa ampliado con tormenta y hasta tres destinos personales, indicadores compactos y salida
  confirmada desde Ajustes. Migra solo posiciones de fábrica; conserva diseños personalizados.
- Zombis: 40 HP / 5 daño / máximo 8; aparición 50 s, ataque 1,3 s, una recompensa de munición
  o botiquín por muerte (también por tormenta), nunca armas ni madera.
- Tormenta morada sin cambiar sus cinco fases. Aviones 10,5 / 14 m/s (-30%); paracaídas
  3,6 / 6,4 m/s (-20%), misma dirección y rutas adaptadas a la zona. Una cuerda central.
- Solo el avión impide recibir daño. Descenso vulnerable pero sin atacar/construir; daño
  durante el descenso suprime la protección de aterrizaje. El servidor conserva ese estado
  entre mensajes/reconexiones; morir retira el estado aéreo y la siguiente vida lo reinicia.
- Comprobación limitada solicitada: 9 casos cortos de contrato, tipos, builds cliente/servidor,
  `/health` local v10/máximo 8, sintaxis SW y rutas/manifest/caché. No se ejecutó la suite completa,
  partidas, benchmarks ni pruebas físicas. Se actualizaron expectativas antiguas que cambiaron
  expresamente con esta fase; no se declara que las suites no ejecutadas estén aprobadas.
- **Publicación autorizada por el usuario**, quien confirmó que no hay partidas activas.
  Se integran los commits preparados mediante avance directo de las ramas existentes,
  sin crear servicios, modificar infraestructura ni fusionar con `main`.
- Desarrollo: `brothers-royale-phase-3.1` recibe los commits de `64e08c1` y este checkpoint.
  Su push activa el auto-deploy existente de Render (`autoDeploy: true`). Servidor esperado:
  `wss://brothers-royale-server.onrender.com`, `/health.protocol=10`, máximo ocho jugadores.
- Publicación: `brothers-royale-beta-pages` recibe `ea4e850`, preparado sobre `b2024a0`.
  Solo seis archivos de `brothers-royale/beta/`; conserva `config.js` con WSS y los trece
  chunks anteriores. Bundle idéntico a `jugar/`, salvo la configuración WSS preservada.
  Build PWA **`f5e108a7c607f68c`**, protocolo **v10** en fuente, servidor y bundle.
- Commits de implementación: `b078c44` (reglas/protocolo), `58efe4f` (HUD), `ae6b5b8`
  (bundle). Ramas de preparación conservadas como checkpoints, sin nuevo desarrollo.
- Verificación local de publicación: contrato v10, coincidencia de bundles, URL WSS y
  alcance de archivos; no se repiten suites extensas ni pruebas de jugabilidad.
- **Limitación confirmada**: Render y Pages devuelven CONNECT 403 por restricciones
  de red del entorno. El push solicita los despliegues existentes; no prueba que Render
  haya terminado ni permite confirmar `/health` o el contenido servido por la URL pública.
  El usuario autorizó publicar en estas condiciones y verificará manualmente desde iPhone.
- Comprobación manual: esperar que Render esté listo con `/health.protocol=10`; abrir
  `https://360connectpe-sys.github.io/juegos/brothers-royale/beta/version.json` y comprobar
  protocolo 10 / build `f5e108a7c607f68c`. En la PWA, salir al lobby y pulsar
  «Actualizar y jugar». El SW difiere la actualización en partidas y comprueba el protocolo
  del servidor; el handshake rechaza versiones distintas. Hasta que Render termine,
  los clientes v10 pueden rechazar la conexión. Las ventanas v9 deben actualizarse.
  No se declara comprobada una conexión multijugador pública. Resumen: `PHASE-14.md`.



## Fase 13 — PWA iPhone (2026-11-28)

Base sincronizada: `5def706` (fase 12 de Claude). Los cambios locales anteriores de Codex
quedan aparte; no se incorporan mecánicas de esas versiones. Protocolo **v9**, mismo Render:
`wss://brothers-royale-server.onrender.com`. Sin cambios de jugabilidad ni de main.

- PWA standalone con manifest relativo, PNG 180/192/512 originales, carga inicial de marca y áreas seguras.
- SW exclusivo de cada ruta (`beta/` o `jugar/`): precaché atómica con ID del build, shell offline y recursos compartidos entre pestañas de la misma versión.
- Comprueba versiones al abrir/recuperar la aplicación. «Actualizar y jugar» solo fuera de partida/cuenta atrás/conexión; consulta también las otras ventanas.
- No cambia localStorage ni HUD. Conserva cachés usadas por ventanas antiguas y chunks anteriores en beta.
- Si una futura versión cambia el protocolo, exige coincidencia en `/health` antes de activarla con el botón; el handshake multijugador existente sigue validando v9. `/health` permite lectura CORS solo a orígenes ya autorizados.
- Publicación: copiar `jugar/` sobre `brothers-royale/beta/` conservando `config.js` de Render y los chunks anteriores. No cambiar otros archivos de la rama beta.
- Validación limitada por instrucción del usuario: tipos, builds cliente/servidor, manifest, rutas, iconos y ciclo básico del SW. Sin suites completas, partidas, simulaciones ni benchmarks.
- Instalación y uso físico en iPhone pendientes de la comprobación del usuario. iOS puede requerir girar manualmente a horizontal; la PWA no puede forzar todas las restricciones del sistema.
- Detalle breve e instalación: `PHASE-13.md`.

---

## Checkpoint fase 12 (jugabilidad real) — actualizar en cada avance

Detalle completo en **PHASE-12-REPORT.md**. Protocolo v9.

Continuar desde aquí sin repetir trabajo. Desarrollo local en `brothers-royale-phase-3.1`, pero **Render redepliega
el servidor en cada push a esa rama** (`autoDeploy: true`): los checkpoints intermedios se suben a
`claude/brothers-royale-setup-x3gvn0` y `brothers-royale-phase-3.1` solo se empuja al publicar (cliente y servidor
compatibles a la vez, protocolo v9). No fusionar con `main`, no tocar otros juegos, sin pagos, plan gratuito de Render.

| Bloque | Estado |
|---|---|
| 1. Techos/azoteas sólidos (cliente = servidor) | HECHO 943f016 (`tests/phase12Roofs.test.ts`) |
| 2-3. 15 min, 5 fases de tormenta, desempate, HUD, barrera visual, minimapa | HECHO 133e325 |
| 4. Ajustes para todos (z-index del HUD sobre `.touch__look` en móvil) | HECHO 8da9e5d (8 clientes verificados) |
| 7. Seis diseños de edificio con muebles y botín | HECHO c973d34 |
| 5-6. Avión, caída libre, paracaídas, reaparición desde avión (protocolo v9) | HECHO 98ee242 |
| 8. Zombis del servidor | HECHO ba0edf1, c2a5169 |
| 9-10. Rendimiento, pruebas, PHASE-12-REPORT.md, beta + Render | HECHO (prueba de 30 min omitida por petición del usuario) |

Comando para continuar a mano: `cd brothers-royale && git fetch origin claude/brothers-royale-setup-x3gvn0 &&
git merge FETCH_HEAD && npm ci && npm run check`, y seguir por el primer bloque PENDIENTE.

## Checkpoint fase 10 (multijugador real) — actualizar en cada avance

Reanudación automática programada: 2026-11-27 04:25 hora de Perú (09:25 UTC), por si se agota la cuota.
Continuar desde aquí sin repetir trabajo. Rama: `brothers-royale-phase-3.1`; publicación: `brothers-royale-beta-pages`
(solo `brothers-royale/beta/`). No fusionar con `main`, no tocar otros juegos, sin pagos, no iniciar fase 11.

| Paso | Estado |
|---|---|
| 1. Integrar `brothers-royale-server-deploy` (29b1e23) en desarrollo (aba1015) | HECHO: merge, 402 pruebas |
| 2. Salas públicas/privadas, 8 máx., ping/conexión/reconexión, anfitrión, revanchas, aislamiento | HECHO: `NetBadge` en partida; lo demás ya cubierto por lobby/battle.integration |
| 3. Prueba de 30 min, 8 clientes, combate y 128 estructuras (métricas y fugas) | HECHO: 30,24 Hz, 0 desconexiones, sin fuga (PHASE-10.md, SOAK-10.json) |
| 4. Despliegue real (necesita cuenta del usuario) + `config.js` de la beta | PENDIENTE (bloqueado por el usuario) |
| 5. Docs (DEPLOY.md, PHASE-10.md), `npm run check`, commit/push, beta, verificación pública | HECHO (beta con `config.js` vacío hasta tener la URL del servidor) |

Comando para continuar a mano: `cd brothers-royale && git pull && npm ci && npm run check`, y seguir por el
primer paso no HECHO de esta tabla.

## 1. Estado actual

| Dato | Valor |
|---|---|
| Repositorio | `360connectpe-sys/juegos`, carpeta `brothers-royale/` (el resto de carpetas son otros juegos: no tocarlos) |
| Rama de trabajo | `brothers-royale-phase-3.1` (todas las fases desde la 3.1 se acumulan en ella) |
| Último trabajo | Fase 13 PWA sobre `5def706` (fase 12 de Claude) |
| `main` | En `85dee86` (fase 2.2). **No fusionar con `main` salvo que se pida explícitamente.** |
| Pruebas | **392 pruebas en 46 archivos, todas en verde** (`npm run check`): 362 de fase 9 + 30 de la corrección móvil |
| Bundle publicado | `jugar/` regenerado e idéntico a `dist/` (`diff -qr dist jugar` sin diferencias) |
| Protocolo de red | v9 (`PROTOCOL_VERSION`, conservado en fase 13) |
| Fases hechas | 1, 2 (2.1, 2.2), 3.1, 3.2, 4, 5, 6, 7, 8, 9 |
| Siguiente | Fase 10 hecha salvo el despliegue real (necesita la cuenta del usuario, ver checkpoint paso 4). No iniciar la fase 11 sin petición. |
| Beta publicada | https://360connectpe-sys.github.io/juegos/brothers-royale/beta/ — GitHub Pages sirve la rama `brothers-royale-beta-pages` (= `main` + `brothers-royale/beta/`, copia de `jugar/`). |
| Despliegue del servidor | Preparado en la rama independiente `brothers-royale-server-deploy` (DEPLOY.md); aún sin desplegar. |
| Pendiente móvil | Medir FPS en iPhone 13 Pro físico (Safari) tras la corrección; ver MOBILE-FIXES.md §7 y §9. |

### Corrección móvil (resumen; detalle en MOBILE-FIXES.md)
- Controles táctiles: `game/input/touchDrag.ts` (disparo/golpe + arrastre del mismo dedo; zona muerta y tope),
  `TouchSource.toggleAim` (mira conmutable).
- Construcción: `ConstructionWidget` = 3 botones (pared, rampa, suelo) con `Game.pressBuild`/`releaseBuild`;
  `planBuild`, `rotationForYaw`, soporte de rampa/suelo y apoyo en laderas en `shared/building/BuildingState.ts`;
  teclas Z/X/C/V, RB del mando cambia de pieza en modo construcción.
- Render sin `WEBGL_multi_draw` (`Engine.multiDraw` falso): `MergedInteriors` + `InstancedHeldItems`;
  `BuildingView` dibuja todas las piezas en una malla dinámica. El lote de edificios tiene material propio.
- HUD: nueva disposición de fábrica (`defaultHudLayout`) y migración de la anterior (`PREVIOUS_DEFAULTS`).

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
| `npm run check` | Tipos + 362 tests + build cliente + build servidor. **Obligatorio antes de cada commit** |
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
                     reconciliation, protocol (v8, mensajes y límites), netcodec (snapshots cuantizados),
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
  tests/             43 archivos Vitest (§7)
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
- Bits `Buttons` enviados: FIRE, AIM, RELOAD, INTERACT y BUILD; todos tienen efecto en la fase 7.
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
   Cambiar formato de mensaje = subir `PROTOCOL_VERSION` (hoy v8).
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

## 7. Pruebas: 362 en 43 archivos

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
| phase6Audit.test.ts | 7 | Seguridad del banco, temporizadores, poses y estadísticas |
| building.test.ts | 22 | Madera, colocación, soporte, colisiones, daño y límites |
| buildingClient.test.tsx | 2 | Lotes, vista previa, restauración y HUD |
| building.integration.test.ts | 1 | Ocho clientes recolectando, construyendo, disparando y reconectando |
| battle.test.ts | 19 | Vidas, zona, ganador, empate, ciclo completo, estadísticas y validación |
| battleWorld.test.ts | 5 | Descenso físico, ráfagas, reinicio, reconciliación y offline |
| battle.integration.test.ts | 3 | Reconexión, ciclo completo acelerado con 8 clientes y soak |
| battleClient.test.tsx | 6 | Vidas reales, espectador táctil, tormenta y validación |
| lobby.test.ts | 7 | Perfiles, permisos, anfitrión y estadísticas autoritativas |
| lobbyClient.test.tsx | 6 | Pantallas, preferencias, resultados y nombres seguros |
| lobby.integration.test.ts | 3 | Ocho clientes, host/reconexión, inicio, final y revancha |

Regla: no bajar de 362; cada sistema nuevo llega con tests de su parte pura.

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
- El ciclo de partida y el reinicio ya existen; fases 8 y 9 sustituyen las limitaciones antiguas.
- Sin multiplicador por cabeza. Inventario conservado al reaparecer hasta definir otra regla.
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

1. `cd brothers-royale && npm ci && npm run check` → deben salir 362 tests en verde.
2. Leer `CLAUDE.md` (reglas, presupuestos de rendimiento, fuera de alcance) y la sección de la fase
   correspondiente en `PROJECT.md`.
3. Trabajar en la rama indicada por el usuario (hasta ahora `brothers-royale-phase-3.1`), sin fusionar con
   `main` y sin modificar otros juegos del repositorio.
4. Al cerrar un avance: tests nuevos, actualizar `PROJECT.md` (y este archivo si cambia la arquitectura,
   el estado o los errores conocidos), `npm run build:pages`, `npm run check`, commit y push a la rama.

**Fuera de alcance hasta que se pida**: fase 10 y persistencia de cuentas. Ganchos listos: evento `death` y
`CombatState.onDeath`, `CombatLog`, bit `BUILD`, `MotorModifiers`, capa `build`, `PredictionController`.

**Probar el combate**: sin conexión hay 3 muñecos de práctica delante del punto de aparición; en `?debug`,
`__BR_GAME__.debugGive({ kind: 'rifle', qty: 1, rarity: 'epic' })` y `debugGive({ kind: 'ammo_medium', qty: 90 })`
dan objetos. En línea: `npm run server` + «Jugar en línea» en dos pestañas (las armas salen de los cofres).

**Roadmap pendiente** (PROJECT.md): fase 10 y posteriores; prueba de 30 minutos reales en fase 10. Candidatos técnicos: suavizar correcciones,
cuantizar los mensajes de combate, colisión de cámara con copas, fin de partida/reinicio de sala, despliegue de
un servidor `wss://`, medición en móviles reales.


## Auditoría de fase 6 posterior a 51269ce

288 pruebas aprobadas. AUDIT-6.md describe cancelación de temporizadores al cambiar de hueco,
limpieza de poses tras reaparecer, estadísticas acotadas y cierre seguro del loadout de pruebas.
BR_BENCH_LOADOUT solo se permite con NODE_ENV=test y --br-bench-loadout.

## Fase 7 y auditoría de fase 6

La fase 7 está implementada. La descripción vigente está en PHASE-7.md y la auditoría independiente
en AUDIT-6.md (55b38f6). El protocolo de esa fase era v6. La fase 8, descrita al final, lo sustituye por v7. Las
descripciones de fases anteriores son históricas.

- BuildingState (shared/building) gestiona 90 de resistencia de árboles, madera, piezas, costes y soporte.
- BuildingWorld (physics) sincroniza colliders y daño ambiental. BuildingView usa un BatchedMesh.
- ServerWorld y OfflineSession ejecutan la misma autoridad. OnlineSession carga snapshots completos
  y añade colisiones para la predicción. No se predicen materiales ni colocaciones.
- Madera es el único material. Se empieza en 0, máximo 999, hasta 30 por árbol mediante hacha.
  Piezas wall/floor/ramp/roof cuestan 10, tienen resistencia 150 y rotan de 90 en 90 grados.
- Límite de 128 piezas por sala, 32 por propietario y base de construcción hasta y=15. Bases en
  terreno suficientemente plano y piezas elevadas sobre otras construcciones. Colapso si pierden soporte.
- Sin editar piezas ya colocadas. Destruir no reembolsa. Reconectar conserva madera y construcciones;
  abandonar definitivamente retira la madera de esa sesión y conserva las piezas pagadas.
- Controles B, mando Y, botón Construir y menú HUD editable. Atacar en modo construcción coloca,
  fuera de él conserva el combate. Hay rotación, nivel y botón táctil de colocación con vista previa.
- BR_BENCH_LOADOUT queda prohibido salvo NODE_ENV=test y --br-bench-loadout, comprobados al arrancar.
- Auditoría de fase 6 corrigió temporizadores al cambiar de hueco, poses antiguas tras reaparecer y
  acumulación de estadísticas. No se modificó el balance ni las reglas provisionales de muerte.
- Suite final de 313 pruebas. Ocho clientes reales recolectan, construyen y destruyen con disparos,
  incluyendo reconexión. El informe contiene mediciones y límites de SwiftShader.

## Fase 8 — Historial del ciclo (el lobby se sustituye en fase 9)

Leer PHASE-8.md para reglas completas, métricas y reproducción. Protocolo v7.

- shared/battle contiene BattleRound, zone y validación. CombatState tiene tres vidas finitas,
  respawn de 5 s, descenso y protección de 3 s; desaparece la reaparición provisional ilimitada.
- CharacterSnapshot incluye modificadores frozen/descent. Reconciliación y servidor usan la misma
  restricción circular y caída de 6 m/s. Se invalida la historia de poses en cada reaparición/reinicio.
- Online: mínimo dos conectados → cuenta atrás 10 s → reinicio limpio → partida de hasta 1800 s →
  resultado durante 10 s → reinicio y siguiente cuenta atrás. El reloj monotónico limita pausas del bucle.
- Offline conserva la práctica inicial y ofrece Iniciar partida offline. Los tres muñecos participan
  sin atacar al jugador; comparten vidas, descenso y daño de tormenta.
- Reserva de reconexión de 15 s conserva identidad, inventario y vidas; la simulación sigue.
  Sesiones nuevas durante la ronda son espectadoras. Salida definitiva = retirada sin volver a entrar
  con vidas en la misma ronda. El inventario se conserva temporalmente al reaparecer.
- Zona: radios objetivo 100/80/60/40/25/10/3/0 %, etapas en minutos 0/3/7/12/17/22/26/29,
  daño 0/1/2/4/6/10/20/50 HP/s. Cada cierre dura los primeros 60 s de su intervalo. Aviso previo 30 s.
- Ganador: último participante con vidas. Al límite: vidas, eliminations (eliminaciones definitivas)
  y HP; igualdad implica empate. kills conserva las bajas de vida para compatibilidad/estadísticas.
- BattleRound.history guarda hasta diez resultados en memoria por sala; CombatLog hasta 2000 eventos
  por ronda. No hay persistencia externa ni cuentas de fase 9.
- Reinicio restaura cofres, pickups, árboles, piezas, madera, inventarios, acciones, salud, vidas y
  estadísticas. Las revisiones de construcción y secuencias permanecen monotónicas.
- HUD de vidas real, minimapa actual/siguiente zona, línea de tormenta, tinte fuera de zona,
  avisos, resultado y botones de espectador compatibles con las tres perspectivas.
- 346 pruebas en 40 archivos. Ciclo acelerado completo con ocho clientes SDK reales y Rapier;
  soak de 300 s: 30,003 Hz, p95 1,005 ms, máximo 136,140 ms, cola máxima 4 y cero desconexiones.
- Heap JS 35,42 → 36,31 MiB; RSS 226,79 → 300,91 MiB, máximo 313,14 MiB. No se infiere ausencia de
  fugas nativas de esa ventana corta. En gráficos: Baja 15–19 llamadas, Normal 14–31 con 8 jugadores
  y 16 piezas; tras dispose, 0 geometrías/texturas. Faltan teléfonos físicos y prueba larga.
- La validación real de 30 minutos se reserva para fase 10 por instrucción explícita. No iniciar
  fase 10 ni fusionar main sin petición del usuario.

## Fase 9 — Estado vigente

PHASE-9.md contiene el flujo y las mediciones. Protocolo v8. No iniciar fase 10.

- Pantalla principal con personaje 3D en la misma escena/canvas, nombre, doce polos, crear/entrar,
  práctica y Ajustes. La cámara de presentación no cambia la perspectiva de juego guardada.
- LobbyState en shared/lobby: miembros, host, estados Listo/cargado/conectado y permisos. Solo el
  anfitrión inicia, con mínimo dos, todos cargados/conectados y participantes listos. Cuenta atrás 10 s.
  La caída de un miembro cancela la cuenta atrás; el host pasa al primer conectado y no se revierte
  al reconectar. Máximo ocho, incluidas reservas de reconexión de 15 s.
- BrothersRoom activa BattleRound.managed: bloquea movimiento/combate/botín/construcción en lobby,
  desactiva inicio automático y conserva resultados hasta returnLobby o rematch. Las clases puras
  mantienen el modo anterior para fixtures; la sala real siempre usa el nuevo flujo, sin bypass de red.
- Privadas: código aleatorio de ocho caracteres, unlisted, único por instancia y comprobado incluso
  por roomId. Entrar no crea una sala si no existe. Públicas usan código vacío, independientes de privadas.
- Skins en shared/lobby/profile.ts solo cambian polo; misma geometría, hitbox y estadísticas. Registro
  de perfil en br.profile.v1 con migración de br.name. Ajustes/HUD/volumen/calidad conservan sus claves.
- NameTags usa hasta ocho nodos DOM, texto literal, proyección y visión a 10 Hz, sin draw calls nuevos.
- Resultados: posición con empates, eliminaciones definitivas, muertes, daño efectivo en HP, precisión
  de disparos contra jugadores, madera acreditada, colocaciones aceptadas y supervivencia hasta última
  vida/retirada. Los contadores proceden de CombatState/BuildingState; no se aceptan estadísticas cliente.
- Revancha abre lobby limpio y marca listo solo al solicitante. Los otros deciden; el host vuelve a
  iniciar. El resultado de cada cliente permanece mientras otros vuelven al lobby. Caché por sesión/ronda
  evita reabrir resultados ante latencia o confundir rondas de salas diferentes.
- Menú principal forma parte del HUD editable, con migración automática de layouts previos.
- 362 pruebas en 43 archivos (346 conservadas +16 nuevas). Integración con ocho SDK y navegador con
  dos clientes táctiles + seis SDK. Reconexión conserva vidas/inventario, transferencia de host probada.
- Lobby observado: 10 draw calls, un solo canvas; juego: Baja 12–16, Normal hasta 27 en las muestras.
  Tras dispose: 0 geometrías/texturas. SwiftShader no representa móviles reales; shader warmup genera picos.
- No hay cuentas ni almacenamiento externo. Se conservan diez resultados en memoria por sala.
  GitHub Pages sigue necesitando un servidor wss://; no se despliega ninguno. Validación real de 30 min
  reservada para fase 10. Main y los otros juegos permanecen fuera del alcance.
