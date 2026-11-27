# BROTHERS ROYALE — Estado del proyecto

## Estado actual (fase 9 cerrada + corrección móvil)
Fases 1–9 hechas. Lobby con anfitrión y Listo, doce polos cosméticos, salas privadas/públicas y
estadísticas finales autoritativas. **392 pruebas** en 46 archivos. Contexto completo para retomar: `PROJECT_CONTEXT.md`.

## Corrección integral de jugabilidad móvil y optimización (2026-11-27)
Informe completo con métricas: **MOBILE-FIXES.md**. Sin nuevas mecánicas.
- Disparo/golpe: el mismo dedo que mantiene el botón gira la cámara o apunta (`TouchDrag`, sin saltos);
  dos dedos caminan, apuntan y disparan a la vez; soltar/cancelar detiene siempre. Mira conmutable visible.
- Construcción: sin ventana central; botones pared/rampa/suelo a la izquierda (mantener = vista previa
  marrón/roja, soltar = construir una vez); orientación y altura automáticas (`planBuild`). Encaje: el extremo
  de la rampa y el borde del suelo dan soporte, apoyo en laderas; techo con V/mando/modo Construir.
- HUD móvil: botones más pequeños, centro despejado, «Jugar en línea» oculto en partida, migración de
  disposiciones de fábrica antiguas y sin solapes en 4 resoluciones horizontales.
- Rendimiento: sin `WEBGL_multi_draw` (Safari iOS) un `BatchedMesh` costaba 1 draw call por instancia; ahora
  estructuras en 1 malla, edificios fusionados y armas instanciadas: con 8 jugadores y 128 estructuras,
  Baja 155 → 20 y Normal 307 → 32. Sin cambio de programa por frame y con menos basura (19,1 → 14,6 MB/5 s).
  Pendiente: medición física en iPhone.

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
| 3 | Multijugador con Colyseus: servidor autoritativo, salas, predicción y reconciliación | ✅ 3.1 (red) y 3.2 (gráficos móviles) |
| 4 | Cámaras (isométrica, 3ª y 1ª persona), controles con apuntado y HUD personalizable | ✅ Hecha |
| 5 | Mapa ampliado (casas pequeñas), cofres, botín e inventario sincronizado | ✅ Hecha |
| 6 | Armas, combate y curación (autoridad del servidor, compensación de latencia) | ✅ Hecha |
| 7 | Madera, tala y construcción autoritativa | ✅ Hecha |
| 8 | Tres vidas, tormenta y ciclo completo de partida | ✅ Hecha |
| 9 | Pantalla principal, lobby, personalización y resultados | ✅ Hecha |
| 10 | Validación de 30 minutos reales reservada por el usuario | Pendiente |
| — | Lobby y servicios persistentes | Pendiente |

## Fase 9 — Lobby, polos y resultados

PHASE-9.md detalla arquitectura, validación y pruebas. Pantalla principal con el personaje animado
sin otro renderer; doce colores de polo, nombre y preferencias locales. Crear/entrar a privadas por
código y públicas. Ocho jugadores, anfitrión migrable, Listo, inicio autorizado y cuenta atrás.
Nombres sobre personajes con ocultación por paredes. Resultado con clasificación, combate, precisión,
madera, construcciones y supervivencia; vuelta al lobby y revancha con consentimiento de participantes.
Protocolo v8. 362 pruebas, incluyendo las 346 anteriores, y flujo con ocho clientes reales.
Se mantiene práctica offline, dos calidades, tres perspectivas y HUD editable. No iniciar fase 10.

## Fase 8 — Ciclo completo Battle Royale

PHASE-8.md documenta reglas y decisiones, cronograma, pruebas aceleradas y soak real de 300 s.
Protocolo v7, tres vidas de 100 HP, espera 5 s, descenso controlable y protección de 3 s cancelada
al atacar. Espectador definitivo, tormenta autoritativa, límite estricto de 1800 s, desempates y
reinicio completo. Registro en memoria de los últimos diez resultados para fase 9.
Ocho clientes: 30,003 Hz, paso p95 1,005 ms, cero desconexiones en cinco minutos.
Se conservan las 313 pruebas anteriores; una espera antigua pasa de 3 a 5 s sin quitar aserciones.
Los 30 minutos reales se reservan para fase 10. La fase 9 no está iniciada.

## Fase 7 — Tala y construcción de madera

PHASE-7.md documenta reglas, arquitectura, controles, pruebas y rendimiento antes/después.
Cuatro piezas de 150 de resistencia, coste 10, madera máxima 999, límite de 128 por sala y 32 por
propietario. Autoridad compartida servidor/offline, protocolo v6, soporte y colapso, colisiones y
vista previa. HUD editable con contador y menú. Sin edición posterior ni mecánicas de fase 8.
La auditoría previa está en AUDIT-6.md, commit independiente 55b38f6.

## Fase 6 — Armas, combate y curación (2026-11-27)
Descripción histórica: las reapariciones provisionales se sustituyen en fase 8.
**Hecho**
- **Armas**: pistola, subfusil, rifle y escopeta (disparo instantáneo, «hitscan») y hacha cuerpo a cuerpo
  (`shared/combat/weapons.ts`). Cadencia, cargador, recarga (`R`, mando X, botón «Recargar», o automática al
  vaciar el cargador si hay bolsa), dispersión (apuntando / sin apuntar, al moverse ×1,35, en el aire ×1,9),
  retroceso (dispersión creciente por disparo seguido + patada visual de cámara), alcance y caída de daño.
  El cargador vive en el objeto (`ItemStack.mag`, sin definir = lleno): soltar y recoger no recarga gratis.
  Cambiar de hueco tarda 0,3 s (`EQUIP_SECONDS`), así alternar armas no salta la cadencia.
- **Salud**: 100, sin escudos. Ningún disparo supera 65 (`HEALTH.maxShotDamage`): nadie cae de un disparo con
  salud completa. El daño se maneja en décimas y la salud se muestra redondeada hacia arriba.
- **Botiquín**: con el botiquín en la mano, «atacar» (clic, RT o el botón, que pasa a llamarse «Curar») empieza
  5 s de uso; al terminar cura 50 sin pasar de 100 y gasta uno. Recibir daño, atacar o cambiar de hueco lo
  cancela (sin gastarlo). Con 100 de salud no empieza. Se puede caminar mientras se cura.
- **Muerte (provisional)**: con 0 de salud el jugador queda eliminado 3 s (no se mueve ni actúa; el servidor
  convierte su entrada en neutra y su secuencia avanza), aparece el aviso «Eliminado / Te eliminó X» y vuelve
  con 100 en un punto de aparición, conservando el inventario. **Fase 8** sustituirá esto por las tres vidas:
  el evento `death` (víctima, autor, arma, tick, lugar) y el gancho `CombatState.onDeath` ya están listos.
- **Registro**: `CombatLog` guarda cada daño y baja (tick, autor, víctima, arma, cantidad, distancia; acotado
  a 2000) y estadísticas por jugador (disparos, aciertos, daño hecho/recibido, bajas, muertes, curado). El
  registro de bajas (killfeed) del HUD usa los eventos `death`.
- **Autoridad y anti-trampas**: `CombatState` (`shared/combat/`) lo ejecutan `ServerWorld` y, sin conexión,
  `OfflineSession`. El cliente solo envía botones, `aimYaw` y `aimPitch` (dirección desde los ojos) y
  `viewTick`. Protecciones (con pruebas): balas cortadas por el primer obstáculo estático de Rapier
  (`PhysicsWorld.castStatic`) y salidas de los ojos del cuerpo autoritativo (nunca dentro de una pared); golpes
  de hacha con alcance, cono y línea de visión; daño solo desde las tablas (campos extra del cliente se
  descartan); cadencia medida con el tiempo de las entradas procesadas (1 por tick de media: ráfagas de 12
  entradas/tick no disparan más rápido); munición del servidor; muertos sin acciones.
- **Compensación de latencia** (`shared/combat/lagcomp.ts`): el servidor guarda 32 ticks de poses y rebobina
  a los objetivos al `viewTick` que veía el atacante (su interpolación), limitado a 12 ticks (400 ms).
- **Red (protocolo v5)**: `PlayerInput` gana `aimPitch` y `viewTick` (opcionales: sin ellos, tiro horizontal y
  sin rebobinado). El snapshot lleva en los flags 10 bits de estado visible (`shared/combat/gear.ts`: arma en
  mano, rareza, acción y muerte) sin cambiar su tamaño. Mensajes nuevos: `combat` (disparos, golpes, bajas y
  vueltas, uno por tick para la sala), `hits` (daño: solo al atacante y a la víctima), `vitals` (salud, recarga
  y curación propias) y `self` (curado, sin balas). El cliente valida todo (`net/CombatView.ts`).
- **Muñecos de práctica** sin conexión (3, delante del punto de aparición): reciben daño, caen y vuelven. Así se
  pueden probar las armas en GitHub Pages sin servidor.
- **Vista (cliente)**: modelos low poly de armas, hacha y botiquín con franja del color de la rareza
  (`game/combat/WeaponModels.ts`) en la mano de cada avatar y delante de la cámara en 1ª persona; todo en el
  **mismo BatchedMesh que los edificios** (mismo material): 0 draw calls extra. Trazadoras, fogonazos y
  chispas en una sola InstancedMesh (`CombatFx`, 1 draw call solo mientras hay efectos). Números de daño
  flotantes, mira con apertura según la dispersión, marcador de acierto/baja y destello al recibir daño en
  una capa DOM sin React por frame (`CombatOverlay`). Sonidos sintetizados con WebAudio (`SoundFx`, sin
  archivos, máx. 10 voces, volumen en Ajustes guardado en `br.volume.v1`). Animaciones: brazos al frente con
  arma, retroceso, recarga, hachazo, botiquín y caída al ser eliminado (`PlayerAvatar.combatPose`).
- **Predicción visual** (`LocalWeapon`): el fogonazo, la trazadora, el sonido y el retroceso propios salen
  al instante con la misma cadencia y cargador que la autoridad; el daño y los números esperan al servidor.
- **Apuntado** en las 3 perspectivas: en 1ª/3ª el disparo va desde los ojos al punto del centro de la pantalla
  (lo que tapa una pared también lo tapa para el servidor); apuntar acerca la cámara (×0,78) y en 3ª la separa
  del hombro. En isométrica se dispara hacia donde se apunta (ratón derecho, stick derecho, arrastre táctil) o,
  sin apuntar, hacia donde mira el personaje, con una ligera ayuda vertical (nunca horizontal) hacia el pecho
  del rival más alineado. Atacar también orienta al personaje (`movement.ts`).
- **HUD**: salud real (verde/amarilla/roja), munición «cargador/capacidad · bolsa» con barra de recarga y de
  curación (`ammo`), registro de bajas (`killfeed`) y aviso de eliminación; los nuevos elementos son
  editables en el editor del HUD. El botón táctil de ataque dice «Disparar», «Golpear» o «Curar».

**Balance** (`expectedTimeToKill`: tiempo esperado para eliminar a un jugador quieto, con dispersión, bloom y
recargas; pruebas en `tests/combatBalance.test.ts`)

| Arma (común) | Daño | Cadencia | Cargador | Recarga | Alcance | Caída de daño | Dispersión cadera / apuntando |
|---|---|---|---|---|---|---|---|
| Pistola | 20 | 3/s | 12 | 1,3 s | 60 m | 18→50 m hasta ×0,65 | 0,030 / 0,012 rad |
| Subfusil | 12 | 8/s | 30 | 1,9 s | 45 m | 9→30 m hasta ×0,45 | 0,045 / 0,028 |
| Rifle | 24 | **3,5/s** | 30 | 2,3 s | 90 m | 35→80 m hasta ×0,75 | 0,060 / 0,006 |
| Escopeta | 10 × 6,2 = 62 | 1/s | 5 | 2,6 s | 24 m | 6→20 m hasta ×0,25 | 0,070 / 0,055 |
| Hacha | 15 | 1,5/s | — | — | 1,9 m (cono 50°) | — | — |

Tiempo esperado para eliminar (s, común; apuntando desde 8 m):

| Distancia | Pistola | Subfusil | Rifle | Escopeta |
|---|---|---|---|---|
| 2 m | 1,33 | **1,00** | 1,14 | **1,00** |
| 10 m | 1,33 | **1,00** | 1,14 | 3,0 |
| 20 m | 1,67 | 2,50 | **1,14** | 69 |
| 45 m | 3,67 | 30 | **1,14** | — |

Decisiones tomadas con las pruebas:
- **Rifle 4 → 3,5 disparos/s**: con 4/s igualaba al subfusil de cerca y le ganaba en todo lo demás (1,0 s en
  todas las distancias). Con 3,5/s el subfusil gana hasta ~12 m y el rifle desde ~15 m.
- **Escopeta**: 10 perdigones; 62 (común) / 63,5 (rara) / **65 (épica, el máximo pedido)**. Dispersión
  0,11 → 0,07 rad y caída 4–16 → 6–20 m: con los valores iniciales necesitaba 3 s para eliminar a 5 m.
- **Rarezas**: el daño sube poco (pistola 20/21/22, subfusil 12/12,2/12,4, rifle 24/24,4/24,8, escopeta
  62/63,5/65) para que la épica **nunca ahorre un disparo a quemarropa** (con +5 %/+10 % el rifle raro pasaba de
  5 a 4 disparos: un 25 % más rápido). La dispersión (×0,95 / ×0,9: cuenta al cuadrado en la probabilidad de
  acierto) y la recarga (×0,93 / ×0,86) completan la ventaja: de media un 1–6 % más rápida en el alcance útil
  de cada arma (con daño discreto siempre hay alguna distancia umbral en la que ahorra un disparo).
- **Bloom del rifle** 0,004 rad/disparo con recuperación 0,012 rad/s: castiga el fuego continuo a distancia sin
  anularlo; la pistola es el arma de reserva (precisa, nunca la mejor, nunca inútil).
- **Compensación 9 → 12 ticks**: con 150 ms de ida + jitter el rebobinado quedaba al límite.

**Pruebas** (237 → 281, todas en verde)
- `combat.test.ts` (18): geometría del rayo y la cápsula, dispersión determinista dentro del cono, estado
  visible en 10 bits, cadencia de pistola y subfusil sin acumular disparos, munición finita y recarga
  automática, tiempos de recarga, cambio de arma, ningún disparo elimina (4 armas × 3 rarezas × 4 distancias),
  escopeta épica = 65, pared, muerte + registro + vuelta, hacha (cono y alcance), botiquín (curación, tope,
  cancelación por daño y al atacar), rebobinado limitado.
- `combatServer.test.ts` (5): con Rapier y `ServerWorld` reales: impacto y estado en el snapshot, pared real
  que bloquea, compensación dentro y fuera del límite, ráfagas de 12 entradas/tick con un campo `damage` falso
  (cadencia intacta, daño ignorado), eliminado sin moverse ni disparar y vuelta con 100.
- `combat.integration.test.ts` (2): **8 clientes SDK reales** disparándose en anillo durante 3 s con latencia
  simulada de 60–135 ms ± 25 ms (orden conservado): todos aciertan, daño hecho = recibido, disparos = balas
  gastadas (sin munición infinita), ningún impacto > 65, todos los clientes reciben las mismas bajas en el mismo
  orden, la salud de cada cliente = la del servidor y nadie recibe daños ajenos. Y **compensación de latencia**:
  con 150 ms ± 20 ms, blanco cruzando a 5 m/s: **9/9 aciertos** (sin rebobinado: **1/9**).
- `combatBalance.test.ts` (6), `combatClient.test.tsx` (12: validación de mensajes v5, predicción visual,
  armas en el lote de edificios, FX en una malla, números de daño con DOM reutilizado, HUD, volumen),
  `combatOffline.test.ts` (1: muñecos de práctica con física real).

**Rendimiento** (Chromium + SwiftShader, pixel ratio fijo en 1, 8 jugadores: local + 7 bots SDK reales;
«antes» = c20346d con los bots caminando; «después» = los 7 bots **disparando sin parar**; máximo de draw calls
en 5 s)

| Vista | Calidad | Draw calls antes → después | Triángulos | FPS antes → después | CPU/frame p50 |
|---|---|---|---|---|---|
| Móvil horizontal, isométrica | Baja | 17 → 18 | 20,1k → 20,6k | 60,4 → 60,2 | 0,8 → 0,8 ms |
| Móvil horizontal, isométrica | Normal | 28 → 28 | 30,6k → 31,8k | 32,4 → 31,2 | 1,2 → 1,1 ms |
| Escritorio, isométrica | Baja | 17 → 18 | 20,2k → 21,1k | 30,6 → 32,2 | 1,2 → 1,1 ms |
| Escritorio, isométrica | Normal | 28 → 29 | 31,5k → 31,8k | 13,6 → 14,6 | 1,5 → 1,6 ms |
| Móvil horizontal, 3ª persona (después) | Baja / Normal | — / — → 11 / 25 | 18,5k / 31,2k | 60,2 / 54,8 | 0,7 / 0,8 ms |
| Móvil horizontal, 1ª persona (después) | Baja / Normal | — / — → 11 / 25 | 18,9k / 31,4k | 60,2 / 53,0 | 0,7 / 1,0 ms |

- Primera versión: 31 draw calls en Normal (armas +1, trazadoras +1, chispas +1). Se corrigió alojando las
  armas en el `BatchedMesh` de los edificios (mismo material) y uniendo trazadoras, fogonazos y chispas en una
  sola `InstancedMesh`: el combate cuesta **+1 draw call solo mientras hay efectos**. Presupuestos cumplidos
  (< 30 Normal, < 20 Baja). 1 programa de shader más (MeshBasic de los efectos). Memoria JS ≈ igual (+0,5 MB).
- Servidor (`ServerWorld.step`, 8 jugadores, 1800 ticks): sin disparar p50 0,64 / p95 1,04 ms; los 8 disparando
  sin parar (1277 disparos) p50 0,66 / p95 1,05 ms.
- Red: con los 8 disparando sin parar, `combat` suma ≈ 3,7 KB/s por cliente (el snapshot ≈ 4,9 KB/s); los
  mensajes privados ≈ 0,2 KB/s en total.
- Banco reproducible: `BR_BENCH_LOADOUT=Bot npm run server` (SOLO pruebas: los jugadores cuyo nombre empieza
  por ese prefijo entran armados) + bots SDK con `FIRE`.

**Limitaciones conocidas de la fase 6**
- La muerte es provisional (vuelta a los 3 s con el inventario); las tres vidas y la reaparición definitiva son
  de la fase 8. No hay daño por caída.
- Sin multiplicador por cabeza (decisión: con él un rifle épico se acercaría al «one-shot»).
- El arma de 1ª persona puede atravesar visualmente una pared si se pega mucho (solo vista).
- La predicción visual puede mostrar un disparo de más o de menos al final del cargador si la latencia es alta
  (el servidor manda: el daño y la munición son siempre los suyos).
- La compensación no pasa de 400 ms: con más latencia hay que adelantar el tiro.
- Los mensajes de combate van en JSON/msgpack con nombres de campo; se podrían cuantizar como el snapshot.
- Los FPS de SwiftShader no representan celulares reales (pendiente medir en dispositivos).

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


## Auditoría de fase 6 posterior a 51269ce

288 pruebas aprobadas. AUDIT-6.md describe cancelación de temporizadores al cambiar de hueco,
limpieza de poses tras reaparecer, estadísticas acotadas y cierre seguro del loadout de pruebas.
BR_BENCH_LOADOUT solo se permite con NODE_ENV=test y --br-bench-loadout.
