# BROTHERS ROYALE — Estado del proyecto

## Visión
Battle Royale multijugador web, low poly, perspectiva isométrica 2.5D, jugable en celular y
computadora. Mecánicas inspiradas en el género (caída, botín, construcción, tormenta), identidad propia.

## Roadmap
| Fase | Contenido | Estado |
|------|-----------|--------|
| 1 | Base técnica: arquitectura, escena isométrica, mapa de prueba, personaje, física, tests | ✅ Hecha |
| 2 | Controlador de personaje, cámara, entrada (táctil/teclado/mando), edificios con plantas y escaleras, animaciones, FPS | ✅ Hecha |
| 3 | Multijugador con Colyseus (servidor autoritativo; la predicción/reconciliación ya está lista en `net/Prediction.ts`) | Pendiente |
| 4 | Armas y combate | Pendiente |
| 5 | Construcción | Pendiente |
| 6 | Tormenta, partida completa, salas, lobby | Pendiente |

## Fase 2.2 — Reconciliación y validación compartida (2026-11-26)
- Sincronización de colisionadores después de cada desplazamiento cinemático, también en resimulación
  sin world.step. Regresión con 90 entradas pendientes: snapshot final idéntico al de la ejecución normal.
- Validación pura compartida de entradas antes de simular o añadir al historial: valores finitos,
  magnitud ≤ 1 (tolerancia de redondeo 1e-12), secuencia entera segura y estrictamente creciente,
  máscara de botones conocidos. Las entradas rechazadas no consumen secuencia ni modifican el motor.
- Contrato privado CharacterSnapshot en shared/reconciliation.ts: posición, velocidad pública,
  locomoción, motor completo (incluidos coyote, jumpBuffer y jumpHeld), modificadores y última
  secuencia procesada. Protocolo v2 con mensaje correction para el propietario. El servidor futuro
  deberá enviar el estado al final del tick confirmado y compartir mapa, colisiones y paso fijo.
- PredictionController marca explícitamente los pasos de resimulación. Estos actualizan la física
  y la locomoción sin volver a emitir eventos de salto o aterrizaje. El historial conserva copias
  de las entradas aceptadas para evitar cambios posteriores del llamador.
- Validación final: 93 pruebas, tipos y compilación. Incluye entradas malformadas, secuencias
  duplicadas, multitouch, física, reconciliación al subir ambas escaleras y snapshots
  serializados como JSON. La implementación de Colyseus continúa pendiente.

## Fase 2.1 — Estabilidad y corrección técnica (2026-11-26)
- La UI captura los fallos de creación de WebGL y muestra el mensaje de error de carga.
- El mapa físico y sus 140 árboles son iguales en todas las calidades. Todos los obstáculos se dibujan
  con las mismas mallas instanciadas (3 draw calls para árboles). La calidad sigue ajustando sombras,
  antialias y resolución. Se retiró el parámetro de densidad que alteraba el mundo.
- Los snapshots incluyen velocidad y locomoción, restauradas inmediatamente incluso sin entradas
  pendientes. La restauración limpia los eventos transitorios para evitar repetir un salto o aterrizaje.
- Regresiones automatizadas para arranque WebGL, colisionadores desde Game en las tres calidades y
  reconciliación sin entradas pendientes con física real.
- Sigue pendiente medir el coste de los 140 árboles en celulares reales de gama baja.

## Fase 2 — Personaje, cámara, entrada y edificios (2026-11-26)
**Hecho**
- **Motor de personaje** puro y determinista (`shared/movement.ts`): movimiento analógico 360°, aceleración y
  frenado, control reducido en el aire, carrera, salto con *coyote time* y búfer, gravedad más fuerte al caer,
  velocidad terminal y giro suave. Separado en `motorIntent` (intención) + `applyCollisionResult` (lo que pasó).
- **CharacterBody** (Rapier KCC): escalones ≤ 0,4 m (autostep), pendientes ≤ 50°, *snap* al suelo,
  capas de colisión (`physics/groups.ts`: mundo, estructuras, construcciones, jugador) y
  `snapshot()/restore()` exactos para reconciliación.
- **Preparado para combate/construcción/red**: `PlayerInput` con máscara de botones (`Buttons`: JUMP, SPRINT y
  reservados FIRE, AIM, BUILD, INTERACT, RELOAD, CROUCH) y `aimYaw`; `MotorModifiers` (velocidad, sin
  correr/saltar, no girar al apuntar); `PredictionController` + `InputHistory` (`net/Prediction.ts`) con tests;
  `PlayerState.locomotion` para animar jugadores remotos sin datos extra.
- **Prefabs** (`shared/world/prefab.ts`, `structures.ts`): estructuras descritas como datos de las que salen a la
  vez la malla y las colisiones. Casa de dos plantas (puerta, entreplanta con barandilla, escalera interior con
  rellano), mirador elevado con escalera exterior y pilas de cajas para subir saltando.
- **Ocultación de techos**: al entrar se desvanecen el techo y las paredes que miran a la cámara; en la planta baja
  también se oculta la planta alta (`PrefabView`, 3-5 draw calls por edificio).
- **Cámara**: seguimiento suave con adelanto según la velocidad, vertical más lento (los saltos no marean) y zoom
  (rueda, +/-).
- **Entrada unificada** (`game/input/sources.ts`): teclado (WASD/flechas, Shift, Espacio), táctil multitouch
  (joystick flotante + botones Correr/Saltar, cada uno con su dedo; sin re-render de React al mover) y
  **Gamepad API** (stick/cruceta, A saltar, L3/LB correr, zona muerta radial). La ayuda en pantalla cambia según
  el último dispositivo usado; los controles táctiles se ocultan al usar mando.
- **Animaciones procedurales** por locomoción (reposo con respiración, caminar, correr inclinado, salto, caída y
  aplastamiento al aterrizar), mezcladas suavemente.
- **Contador de FPS** con color (verde/amarillo/rojo) y detalle con F3 o al tocarlo: ms por frame, peor frame,
  draw calls, triángulos y resolución.
- **Rendimiento**: sombras re-dibujadas cada 2 frames en calidad media, sin dependencias nuevas, HUD sin
  re-renders por frame, motor sin asignaciones por tick en el camino caliente. Escena: ~32 draw calls, ~26k triángulos.
- **Pruebas**: 59 tests (motor puro, prefabs, escaleras, visibilidad, cámara, fuentes de entrada, mando falso,
  multitouch, predicción/reconciliación y física real: subir la escalera interior y la del mirador, paredes, puerta,
  saltos, snapshot/restore exacto). E2E con Playwright: entrar en la casa, subir a la entreplanta (y = 2,82),
  subir al mirador (y = 2,62), correr+saltar, zoom, mando simulado y dos dedos a la vez en móvil.

**Pendiente / ideas siguientes**
- Ocluir con silueta al jugador cuando queda detrás de un edificio desde fuera.
- Agacharse (bit CROUCH ya reservado) y puertas que se abren con INTERACT.
- Medir FPS en celulares reales de gama baja y ajustar presets.

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
# Controles: WASD/flechas, Shift correr, Espacio saltar, rueda o +/- zoom, F3 rendimiento.
# Mando: stick o cruceta, A saltar, L3/LB correr. Móvil: joystick izquierdo, botones Correr y Saltar.
npm run check      # typecheck + tests + build
```
