# BROTHERS ROYALE — Estado del proyecto

## Auditoría integral de fases 3.2, 4 y 5

Revisión de 5103899 frente a 5da1a88. Informe completo en AUDIT-3.2-5.md.
Se corrigieron visión a través de paredes cercanas al objetivo, validación de inventarios y pickups,
inventarios obsoletos o reemplazados al repetir alta, limpieza de BatchedMesh, reinicio del refresco
adaptativo y recorte, teclado y almacenamiento del HUD. Se conservan las mecánicas existentes.
Validación final de 237 pruebas, tipos y builds, con bundle actualizado. Ocho clientes completaron
610 segundos sin desconexiones a 30,00 Hz de media, p95 de simulación de 1,14 ms y pico de 190,45 ms.
El informe documenta las mediciones de gráficos, recursos, multitouch, contexto WebGL y las
limitaciones pendientes de hardware físico y redes reales.


## Visión
Battle Royale multijugador web, low poly, perspectiva isométrica 2.5D, jugable en celular y
computadora. Mecánicas inspiradas en el género (caída, botín, construcción, tormenta), identidad propia.

## Roadmap
| Fase | Contenido | Estado |
|------|-----------|--------|
| 1 | Base técnica: arquitectura, escena isométrica, mapa de prueba, personaje, física, tests | ✅ Hecha |
| 2 | Controlador de personaje, cámara, entrada (táctil/teclado/mando), edificios con plantas y escaleras, animaciones, FPS | ✅ Hecha |
| 3 | Multijugador con Colyseus: servidor autoritativo, salas, predicción y reconciliación | 🟡 3.1 (red) y 3.2 (gráficos móviles) hechas |
| 4 | Cámaras (isométrica, 3ª y 1ª persona), controles con apuntado y HUD personalizable | ✅ Hecha |
| 5 | Mapa ampliado (casas pequeñas), cofres, botín e inventario sincronizado | ✅ Hecha |
| 4b | Armas y combate | Pendiente |
| 5 | Construcción | Pendiente |
| 6 | Tormenta, partida completa, salas, lobby | Pendiente |

## Fase 5 — Mapa ampliado, cofres e inventario (2026-11-26)
**Hecho**
- **Mapa**: se conservan la casa grande, el mirador y las cajas. Se añaden **8-12 casas pequeñas** (9 con la
  semilla del juego) repartidas por sectores alrededor de la isla (cuatro cuadrantes siempre), con **4 diseños**
  (cabaña, casa de piedra con azotea, casa alargada y casita con porche) y 4 paletas. Cada una se asienta en una
  **zona plana a la altura de su colina** (`TerrainParams.flatZones`), con la puerta hacia el pueblo y su interior
  accesible (techo y paredes frontales se ocultan al entrar, como en la casa grande). El terreno del pueblo es
  idéntico al anterior. Se mantienen **140 árboles** para la futura tala.
- **Cofres** (deterministas): uno dentro de cada casa pequeña, dos en la casa grande (planta baja y entreplanta),
  uno en el mirador y 6 exteriores en sitios despejados (17-21 en total; 18 con la semilla del juego). Son prefabs
  con colisionador.
- **Botón Abrir / Recoger**: aparece al acercarse (≤ 2 m al cofre, ≤ 1,8 m al objeto, misma planta) y con **línea
  de visión** (no se abre a través de paredes). Táctil: botón grande; teclado `F`; mando `B`; el botón "Usar" del HUD
  también vale.
- **Cada cofre se abre una vez por partida**. Botín **aleatorio por partida** pero determinista por (semilla de partida,
  cofre): siempre un arma (pistola, subfusil, escopeta o rifle; común 60 %, rara 30 %, épica 10 %) con su munición,
  a veces botiquines y munición extra. **Sin escudos**.
- **Inventario** (`shared/inventory.ts`): 5 huecos; el 1 es el **hacha permanente** (todos empiezan con ella; no se
  suelta ni se reemplaza); armas 1 por hueco, botiquines hasta 3; munición en una bolsa aparte con tope por tipo;
  si está lleno, el arma de la mano se cambia por la nueva (nunca el hacha). Selección con 1-5, `RB` o tocando el hueco.
- **Autoridad del servidor** (`shared/match/MatchState.ts`, puro; el mismo código sin conexión en `OfflineSession`):
  cofres, botín, objetos en el suelo e inventarios solo los modifica la autoridad, en un único hilo y por orden. La
  interacción se procesa en el **flanco** del bit `INTERACT` de cada entrada, con la posición autoritativa tras ese
  paso y comprobando distancia y línea de visión (rayo de Rapier). El primero gana: no hay aperturas dobles ni
  duplicados (comprobado con 6 jugadores pulsando en el mismo tick). Quien sale de la partida suelta sus objetos.
- **Red** (protocolo v4): el estado de la partida va en la bienvenida; los cambios públicos (cofre abierto, objeto
  aparece/desaparece/cambia) en **un mensaje por tick** para la sala; el inventario y los avisos solo al dueño; elegir
  hueco es un mensaje validado. El cliente valida todo lo que recibe (`ReplicatedMatch`).
- **Minimapa**: casas pequeñas y cofres aún cerrados.
- **Rendimiento**: todos los edificios con interior en un **`BatchedMesh`** (1 draw call + 1 de sombra; al entrar en
  uno solo ese sale del lote), cofres en 2 `InstancedMesh` (sin sombra: son bajos), objetos en 3 `InstancedMesh` que
  no se dibujan si están vacíos, material compartido, plano lejano de 3ª/1ª persona a 100 m (lo que tapa la niebla
  no se dibuja).

**Rendimiento antes / después** — 6 jugadores (local + 5 bots reales), resolución fija ×1, SwiftShader.

| Vista | Calidad | Draw calls | Triángulos | Programas | CPU/frame p50 · p95 (ms) | FPS* |
|---|---|---|---|---|---|---|
| Celular horizontal | Baja | 13 → **15** | 18,0k → 20,0k | 5 → 7 | 0,8 · 1,2 → 0,9 · 1,5 | 60 → 60 |
| Celular horizontal | Normal | 22 → **24** | 27,6k → 30,3k | 10 → 14 | 1,0 · 1,5 → 1,3 · 1,9 | 33 → 30 |
| Escritorio | Baja | 13 → **15** | 18,0k → 20,1k | 5 → 7 | 1,0 · 1,5 → 1,4 · 2,0 | 32 → 28 |
| Escritorio | Normal | 22 → **24** | 27,6k → 30,5k | 10 → 14 | 1,6 · 2,5 → 1,7 · 2,7 | 14 → 13 |

Servidor con 6 jugadores (600 ticks): paso p50 0,311 → 0,312 ms, p95 0,627 → 0,635 ms; colisionadores 203 → 277.
Bundle inicial: 31,4 → 39,5 KB gzip. El +2 draw calls son los cofres: las 9 casas nuevas no añaden ninguno (sin el
`BatchedMesh` la primera versión llegaba a 33-34 en Normal, por encima del presupuesto de 30). Los programas suben
por las variantes de `BatchedMesh` e instancias con color. \* FPS por software (SwiftShader), no representativos de
una GPU móvil; se mantienen dentro del ruido salvo la CPU/frame, que sube unas décimas de ms por las vistas nuevas.

**Pruebas**: 223 (las 200 anteriores + 23 nuevas). Se adaptó 1 afirmación existente: la lista exacta de estructuras
(ahora se comprueba que el pueblo sigue intacto al principio). Nuevas: mapa (casas, zonas planas, cuadrantes,
cofres, árboles), objetos e inventario, botín determinista, reglas de cofres, línea de visión con Rapier, 6
jugadores en el mismo tick, réplica del cliente con datos mal formados, sesión sin conexión, vistas instanciadas,
selección de hueco, HUD de inventario y botón Abrir/Recoger, e **integración real con 6 clientes** (`OnlineSession`
contra Colyseus): un único ganador por cofre, sin duplicados, inventarios privados iguales a los del servidor y
objetos que caen cuando alguien sale. E2E en navegador: abrir, recoger, seleccionar, entrar en una casa pequeña y
cofre abierto por un jugador visto por otro.

**Pendiente**
- Usar los objetos (disparar, curar, talar) llega con el combate y la recolección.
- Los cofres no se vuelven a llenar: la partida aún no tiene final ni reinicio de sala.
- Medir en celulares reales con las casas nuevas a la vista en 3ª persona.

## Fase 4 — Cámaras, controles y HUD personalizable (2026-11-26)
**Hecho**
- **Tres perspectivas** (`engine/camera/cameraMath.ts` puro + `game/camera/CameraController.ts`): isométrica
  (la de siempre), **tercera persona** detrás y sobre el hombro, y **primera persona** desde los ojos. Se eligen
  **solo desde Ajustes** (sin atajos de teclado).
- **Colisión de cámara**: en 3ª persona se lanza una esfera (Rapier `castShape`) desde la cabeza hasta la
  posición deseada; choca con mundo, estructuras y construcciones, nunca con jugadores. Se acerca al instante
  (no atraviesa) y se aleja suave. Verificado: de espaldas a la fachada, la cámara queda a 4,80 con la pared en
  z = 4,5 (su radio, 0,3).
- **Avatar propio oculto** en 1ª persona y cuando la cámara de 3ª queda a menos de 1,1 m (pegada a una pared). En
  3ª/1ª persona no se recortan techos ni paredes (eso es propio de la vista isométrica).
- **Movimiento relativo a la cámara** en 3ª/1ª persona (`moveToWorld`); en isométrica, la conversión de siempre.
  En 1ª persona el personaje mira siempre hacia la cámara (bit AIM + `aimYaw`); en 3ª, hacia donde camina, o
  hacia la cámara mientras se apunta.
- **Controles**:
  - Táctil multitouch: joystick a la izquierda y **zona de mirada a la derecha a la vez** (en isométrica esa zona es
    un stick de apuntado), más botones Saltar, Correr, Atacar, Apuntar, Recargar, Usar y Construir; cada uno sigue
    su propio dedo.
  - Teclado y ratón: WASD, Shift, Espacio; clic en el juego para mirar con el ratón (puntero bloqueado, Esc lo
    suelta), Q/E giran, botón derecho apunta (en isométrica, hacia el cursor), izquierdo ataca; R/F/B recarga,
    interacción y construcción.
  - Mando: stick derecho mira (o apunta en isométrica), LT apunta, RT ataca, X/B/Y recarga, interacción y construcción.
  - Ataque, recarga, interacción y construcción envían su bit de `Buttons` pero **aún no tienen efecto**.
- **Sensibilidad** de cámara (×0,2-3) y **al apuntar** (×0,2-1,5), e **invertir eje vertical**.
- **HUD personalizable** (`ui/hud/layout.ts`): 12 elementos (joystick, 7 botones, salud, vidas, inventario y
  minimapa) con posición normalizada al **área segura** (notch y barra de inicio excluidos), tamaño (50-180 %),
  opacidad (20-100 %) y visibilidad propios. Disposición de fábrica pensada para celular en horizontal.
- **Editor visual del HUD** (Ajustes → Editar HUD): arrastre directo de cada elemento, deslizadores de tamaño y
  opacidad, mostrar/ocultar, flechas del teclado para mover con precisión, restablecer elemento o todo,
  guardar/cancelar. La barra del editor se coloca en el lado opuesto al elemento elegido y se atenúa al arrastrar.
- **Indicadores preparados**: barra de salud, vidas, inventario de 5 huecos y **minimapa real** (terreno pintado una
  vez, jugadores redibujados 10 veces/s, girado 45° para coincidir con la vista isométrica).
- **Ajustes y persistencia**: perspectiva, sensibilidades, eje Y, calidad (Baja/Normal), editar HUD, pantalla
  completa y "Restablecer ajustes y HUD" (con confirmación). Se guardan en `localStorage` (`br.settings.v1`,
  `br.hud.v1`) con validación al leer: valores corruptos o manipulados vuelven a los de fábrica o se acotan. Con
  Ajustes o el editor abiertos el personaje no se mueve y el ratón se suelta (la partida y la red siguen).
- Se mantienen Baja/Normal, la resolución adaptativa y el FPS sin límite.

**La perspectiva no toca la simulación**: la cámara solo cambia cómo se convierte la entrada de pantalla a una
dirección del mundo; `PlayerInput` mantiene formato y significado. Pruebas: misma dirección del mundo → posición
idéntica desde isométrica y desde 3ª persona; cliente con 1ª, 3ª e isométrica mezcladas frente al servidor →
snapshot idéntico; E2E en línea con un jugador en 3ª persona y otro en 1ª: cada uno se ve exactamente donde lo
ve el otro.

**Pruebas**: 200 (las 163 anteriores, sin cambios, + 37 nuevas): matemática de cámaras, colisión con Rapier,
controlador, independencia física y de red, entrada por perspectiva, ratón/teclado/mando/táctil, sensibilidades,
multitouch con mirada simultánea, persistencia y saneado de ajustes y HUD, editor (arrastre, tamaño, opacidad,
visibilidad, flechas, restablecer, barra que no tapa) y panel de Ajustes. E2E en navegador: perspectivas desde
Ajustes, mirada táctil + joystick, colisión con la pared, puntero bloqueado, editor con guardado tras recargar,
restablecer y multijugador.

**Pendiente**
- Probar en celulares reales la sensibilidad táctil por defecto y la disposición del HUD con distintos notch.
- La cámara de 3ª persona no aparta ramas de árboles (solo chocan los troncos).
- Mirar con el ratón en isométrica no gira la cámara (es fija por diseño): el ratón apunta.

## Fase 3.2 — Optimización gráfica Mobile First (2026-11-26)
**Auditoría del commit de Codex `5da1a88`** (endurecimiento de red y límite de 8 jugadores): las 138 pruebas
pasaban y los cambios de seguridad son correctos (el `onMessage('*')` de Colyseus solo recibe tipos sin
manejador). Hallazgo corregido: el snapshot se codificaba **una vez por cliente** (`client.send` en bucle); vuelve
a generarse una sola vez por tick y se difunde excluyendo a quien no está listo o va saturado.

**Hecho**
- **Dos calidades, Baja y Normal** (`engine/quality.ts`). Solo cambian resolución, sombras reales/de mancha y
  frecuencia del mapa de sombras. Mundo, física, colisiones, árboles, techos y cámara son idénticos (prueba que
  compara campo a campo). Selector en el HUD con cambio **en vivo** y recordado; `?q=low|baja|normal`
  (`medium`/`high` siguen valiendo como Normal). Sin MSAA en ninguna: en móvil es caro.
- **Avatares**: cada personaje es **una `SkinnedMesh` rígida de 6 huesos** (antes 6 mallas): 1 draw call (+1 de
  sombra). Geometría cacheada por paleta y **un único material** para todos; las sombras de mancha de todos los
  jugadores van en **un `InstancedMesh`**. Los remotos fuera de cámara no calculan su animación.
- **Draw calls del mundo**: la casa es **1 malla vista desde fuera** (se divide en grupos solo al entrar, y esos
  grupos solo son transparentes mientras se desvanecen); mirador y cajas en **un lote estático**; árboles en
  **2 `InstancedMesh`** (tronco fusionado con la copa); agua **opaca y dibujada al final** de la pasada opaca.
- **CPU**: sin asignaciones por tick en la interpolación de remotos (`writePlayerState`), ni por frame en la
  visibilidad de edificios (tablas constantes) ni en la lista de remotos.
- **Sin límite artificial de FPS**: se dibuja a lo que dé `requestAnimationFrame`.
- **Resolución adaptativa nueva**: objetivo = frecuencia real de la pantalla, como mucho 60 (a 30 Hz en modo
  ahorro no baja la nitidez; a 120 Hz no la sacrifica por perseguir 120); decide con el percentil 90 e ignora
  tirones > 250 ms; baja rápido y sube de 0,05 en 0,05; si una subida no aguanta se revierte y la espera para
  reintentarla se duplica (2 → 32 ventanas): no oscila. Límites: Baja 0,5-1; Normal 0,7-1,5 (móvil) o 0,7-2.
- **Contexto WebGL** (`ContextLossMonitor`): al perderse se pide su recuperación, se muestra un aviso y el
  personaje se queda quieto (la conexión en línea y la gravedad siguen); al volver se re-dibujan las sombras;
  si no vuelve en 6 s se ofrece recargar.
- **Celular en horizontal**: el ancho visible se limita al de una pantalla 16:9 (36 m), así en un celular
  horizontal (~2,16:1) la cámara se acerca un 17 % en lugar de mostrar más mundo (personajes más grandes y nadie
  ve más que otro por su pantalla). HUD compacto para alturas ≤ 520 px, márgenes del notch a los lados, joystick
  en toda la mitad izquierda y botones al alcance del pulgar, botón de pantalla completa que fija la orientación
  horizontal donde el navegador lo permite, aviso no bloqueante en vertical y `manifest.webmanifest` en horizontal.
- Se mantienen el máximo de 8 jugadores y la simulación a 30 Hz (sin cambios en `shared/` ni en la física).

**Métricas antes / después** — Chromium sin GPU (SwiftShader), 8 jugadores reales (local + 7 bots del SDK
alrededor del jugador), resolución fija ×1 para comparar en igualdad de condiciones, 5 s por medida.

| Vista | Calidad (antes → después) | Draw calls | Programas | Geometrías | CPU/frame p50 · p95 (ms) | FPS* |
|---|---|---|---|---|---|---|
| Celular horizontal 844×390 | Baja → Baja | 59 → **15** | 6 → 5 | 61 → **15** | 1,0 · 1,6 → **0,8 · 1,3** | 58 → 59 |
| Celular horizontal 844×390 | Media → Normal | 104 → **26** | 11 → 10 | 53 → **14** | 1,5 · 2,2 → **1,2 · 1,9** | 30 → 32 |
| Escritorio 1280×720 | Baja → Baja | 61 → **15** | 6 → 5 | 61 → **15** | 1,5 · 2,4 → **1,2 · 1,9** | 28 → 32 |
| Escritorio 1280×720 | Media → Normal | 104 → **23** | 11 → 10 | 53 → **14** | 2,1 · 3,0 → **1,7 · 2,7** | 13 → 13 |

\* Los FPS en SwiftShader dependen sobre todo del relleno de píxeles por CPU; no representan una GPU móvil, donde
el coste por draw call y por cambio de estado pesa mucho más. Triángulos sin cambios (18-28 mil): el modelo es el
mismo. Las "texturas" pasan de 0-2 a 8-10 porque cada esqueleto usa una textura de huesos diminuta (6 huesos).
Heap JS igual (~18 MB). Bundle inicial: 20,7 → 23,8 KB gzip (+3,1 KB: selector de calidad, avisos de gráficos y orientación, nueva resolución adaptativa); three, react, red y Rapier sin cambios.

**Pruebas**: 163 (las 138 anteriores + 25 nuevas). Se adaptaron 3 afirmaciones de pruebas existentes que
comprobaban exactamente lo que esta fase cambia: `pickTier` devolviendo `'high'`/`'medium'` (ahora `'normal'`) y la
liberación de "6 geometrías y 2 materiales" por avatar (ahora geometría y material son compartidos: retirar un
jugador no libera nada y la limpieza final libera cada recurso una vez). E2E en navegador: cambio de calidad en
vivo, pérdida/recuperación/fallo del contexto, horizontal y vertical, y dos clientes en línea (mismas posiciones
que en la fase 3.1).

**Pendiente**
- Medir en celulares reales (gama baja y media) FPS, temperatura y batería.
- El selector de calidad no cambia el tamaño del mapa de sombras a uno mayor en escritorio (1024 en Normal).
- Instanciar los avatares (un draw call para todos) requeriría animación por shader; con 8 jugadores no compensa.

## Fase 3.1 — Servidor autoritativo con Colyseus (2026-11-26)

**Máximo actual de ocho jugadores**

- NET.maxPlayersPerRoom comparte el límite de 8 entre servidor y cliente. Colyseus limita
  las plazas activas y reservadas para reconexión. ServerWorld también rechaza un noveno cuerpo
  antes de asignar recursos físicos.
- OnlineSession rechaza bienvenidas o altas que excedan ocho y OnlinePanel muestra n/8 jugadores.
- La unión por roomId a una sala llena se rechaza, incluso si un jugador está desconectado y
  conserva su reserva. El matchmaking joinOrCreate conserva su comportamiento de poder crear
  otra sala con capacidad disponible.
- Se conservan los 134 casos anteriores, adaptando las cargas de 16 a la capacidad actual de 8.
  Cuatro nuevas regresiones cubren capacidad física, rechazo de unión y límites del cliente.
- La prueba prolongada se reproduce con BR_SOAK_SECONDS=600 seguido de
  ./node_modules/.bin/vitest run tests/audit.integration.test.ts -t 'sostiene 8 clientes'
  --disableConsoleIntercept --reporter=verbose. En la suite normal dura cinco segundos.
  Los resultados de diez minutos se registran en SOAK-8-PLAYERS.md.


**Auditoría posterior de cf307f9**

134 pruebas aprobadas tras las correcciones de cuotas, simulación, reconexión y recursos.
La medición histórica, anterior al límite de ocho, con 16 clientes sostuvo 29,81 Hz y un p95 de simulación de 3,56 ms.
El informe AUDIT-3.1.md detalla regresiones, mediciones y límites pendientes de gráficos, memoria y seguridad global.

**Hecho**
- **Servidor** (`server/`, Colyseus 0.18 sobre WebSocket, Node 22, sin servicios externos):
  - `ServerWorld`: simulación autoritativa a **30 Hz** con el mismo mapa, colisionadores y `CharacterBody`
    que el cliente. Sin dependencia de Colyseus: se prueba directamente en Node.
  - `BrothersRoom`: bucle de paso fijo propio (`FixedStepLoop`) medido con `performance.now()` (el
    `deltaTime` del reloj de la sala no era fiable y daba 10 ticks/s), hasta 8 jugadores por sala.
- **Salas**: sala pública por defecto y salas privadas por código (`filterBy(['code'])`, letras y números).
- **Identificación**: `sessionId` de Colyseus + `netId` corto (0-255, reutilizable) + nombre saneado y
  único en la sala ("Ana", "Ana 2") + color de avatar. Roster en la bienvenida y eventos `join`/`leave`.
- **Validación**: versión de protocolo (v3) y opciones al unirse; cada entrada con `isValidPlayerInput`
  (fase 2.2), copia solo de campos conocidos, cola de 12, como mucho 3 entradas por tick y 1 de media
  (anti speed-hack), límite de 90 mensajes/s y expulsión tras 30 entradas inválidas o 3 ráfagas.
- **Snapshots**: snapshot público por tick, cuantizado (cm, mrad, cm/s) en 10 enteros por jugador
  (~21 B/jugador en MessagePack); corrección privada (`CharacterSnapshot`) al propietario solo si su estado
  cambió. Ancho de banda histórico medido antes del límite de ocho, con 16 jugadores: ~19 KB/s de bajada y ~1,8 KB/s de subida por cliente.
- **Conexión/desconexión**: saludo en dos pasos (`ready` → `welcome`) para no perder mensajes; reserva
  de 15 s para reconectar tras una caída (el SDK reintenta solo y pide una bienvenida nueva); al salir se
  avisa al resto. Si un cliente deja de enviar entradas, el servidor sigue aplicando la gravedad sin
  consumir secuencia. Códigos de cierre propios ≥ 4100 con mensajes claros en castellano.
- **Cliente** (`src/net/OnlineSession.ts`): predice al jugador local con `CharacterBody` +
  `PredictionController` (fase 2.2) y reconcilia con las correcciones; interpola a los remotos 3 ticks en el
  pasado (`SnapshotInterpolator`, sin basura por frame). `Game` crea/retira avatares remotos con colores de
  la paleta y vuelve a offline automáticamente (conservando la posición) si se pierde la conexión.
- **Interfaz**: botón "Jugar en línea" (nombre, código de sala, servidor) y estado de la sala (jugadores,
  ping, salir). Enlace directo `?online&server=…&name=…&code=…`. Escribir en los campos ya no mueve al
  personaje.
- **Móvil**: el modo offline sigue siendo el predeterminado; el SDK de Colyseus (~54 KB gzip) se descarga
  solo al conectar. Los remotos no tienen cuerpo físico en el cliente.
- **Pruebas**: 120 (las 93 anteriores + 27 nuevas): códec, identidad, puntos de aparición, interpolación,
  `ServerWorld` (cola, anti speed-hack, gravedad sin entradas, snapshots), **cliente predictivo + servidor
  con 3 ticks de retraso → estado idéntico**, integración real con **dos clientes simultáneos**
  (Colyseus SDK y `OnlineSession`), salas por código, protocolo viejo rechazado, expulsión, caída del servidor
  e interfaz. E2E en navegador: escritorio + celular en la misma sala, ambos se ven y se mueven (teclado y
  joystick), y vuelta a offline al apagar el servidor.

**Limitaciones conocidas / siguientes pasos**
- GitHub Pages sirve por https: desde ahí el navegador solo acepta servidores `wss://` (TLS). Hoy el
  modo en línea se prueba en local o en red local (`http://` + `ws://`). Publicar un servidor con TLS
  queda para una fase con hosting decidido.
- Corrección privada ~300 B/tick: cuantizarla o enviarla a 15 Hz si el ancho de banda móvil lo exige.
- Las correcciones grandes se aplican de golpe (sin suavizado visual del error).
- Avatares remotos: ~5 draw calls cada uno; con muchos jugadores habrá que instanciarlos.
- Sin nombres sobre los avatares, sin colisión entre jugadores y sin "lag compensation" (llega con combate).
- Una sola instancia de servidor (sin presencia/Redis); suficiente para pruebas y partidas pequeñas.

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
npm run dev        # http://localhost:5173  (?q=low|normal fuerza la calidad, ?debug)
# Controles: WASD/flechas, Shift correr, Espacio saltar, rueda o +/- zoom, F3 rendimiento, Q/E girar cámara.
# 3ª/1ª persona (Ajustes → Perspectiva): clic en el juego para mirar con el ratón, Esc para soltarlo.
# Mando: stick izquierdo moverse, stick derecho mirar/apuntar, A saltar, LB correr, LT apuntar.
# Móvil: joystick izquierdo, arrastrar a la derecha para mirar, botones de acción (editables en Ajustes → Editar HUD).
npm run check      # typecheck + tests + build (cliente y servidor)
npm run server     # servidor multijugador en ws://localhost:2567 (otra terminal)
# Jugar en línea: botón "Jugar en línea", o http://localhost:5173/?online&name=Ana&code=SALA1
# Para un celular en la misma red: npm run dev y abrir http://<IP-del-PC>:5173/?online&server=ws://<IP-del-PC>:2567
```
