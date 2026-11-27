# Fase 8 — Ciclo Battle Royale

Base: `5135bdb1032f0b0452a28d32f2d4ff8f7faa2e45`, rama `brothers-royale-phase-3.1`.
Solo se modifica Brothers Royale. La fase 9 no está iniciada.

## Reglas y ciclo

- Tres vidas por jugador, cada una con 100 HP. No hay escudos ni reapariciones ilimitadas.
- Perder una vida consume una sola vida, cancela curación y recarga y espera exactamente 5 s.
  El reloj de vidas avanza una vez por tick del mundo, independientemente de las entradas recibidas.
- Las dos primeras reapariciones sitúan al personaje 30 m por encima de la superficie superior del
  punto elegido por la autoridad. Desciende a 6 m/s, con dirección horizontal controlable.
  El movimiento se restringe al círculo seguro, con margen del radio de la cápsula. No puede correr
  ni saltar durante el descenso. El estado necesario viaja en CharacterSnapshot y se reconcilia.
- El aterrizaje concede 3 s de protección, incluida la tormenta. Un ataque efectivo con arma o hacha
  la cancela antes de resolver el ataque. Saltar o seguir apoyado no renueva esa protección.
- La tercera vida agotada deja al jugador definitivamente eliminado. No puede moverse, atacar,
  recoger ni construir. Los botones Anterior/Siguiente seleccionan un superviviente para observar.
  La cámara mantiene la perspectiva elegida: isométrica, tercera o primera persona.
- Se conserva temporalmente todo el inventario al reaparecer, incluidos cargadores y munición;
  reaparecer no recarga armas ni duplica objetos. La regla definitiva de inventario queda pendiente.
- Sala de hasta 8 jugadores. Con al menos dos conectados hay una cuenta atrás de 10 s y un reinicio
  completo antes de empezar. El tiempo anterior es práctica; no cuenta dentro de los 30 minutos.
- Quien entra con una sesión nueva durante la ronda queda como espectador hasta la siguiente.
  La reconexión reservada (15 s) conserva el mismo participante, vidas, inventario y estado de descenso.
  La simulación continúa durante esa reserva. Abandonar definitivamente causa retirada de la ronda;
  se aplica la regla existente de soltar inventario una sola vez al salir.
- Vence el último participante con vidas restantes; esperar una reaparición no cuenta como eliminación
  definitiva. La tormenta resuelve todos los daños del tick antes de decidir el ganador.
- Límite de 1800 s desde el inicio. Se compara también con el reloj monotónico del servidor:
  una pausa del bucle no concede minutos adicionales de combate al volver a ejecutarse.
- Al límite, prioridad por vidas restantes, eliminaciones definitivas de oponentes y HP. Si todos
  esos criterios coinciden, se declara empate entre los mejores; si nadie sobrevive, empate sin ganador.
  `kills` conserva las bajas de vida de fase 6; `eliminations` cuenta solo la tercera vida agotada.
- El resultado dura 10 s. Después se reinician cofres, pickups, árboles, colliders de construcción,
  madera, inventarios, vidas, acciones, estadísticas e historial de poses. Las secuencias de entrada
  no retroceden y las revisiones de construcción siguen creciendo para que el cliente acepte el reinicio.
  Los conectados pasan a la siguiente cuenta atrás si aún hay al menos dos.

## Zona segura

La autoridad genera círculos anidados con un RNG separado del mapa y del botín. El 100 % inicial
es la circunferencia que contiene los cuatro vértices del área jugable (radio aproximado de 82 m en
el mapa actual). Los porcentajes se aplican al radio, no al área. Los centros se desplazan sin que
un nuevo círculo salga del anterior y respetan los límites del mapa cuando su radio permite encajarlo.

| Minutos | Radio objetivo | Daño fuera de zona |
|---|---|---|
| 0–3 | 100 % | 0 HP/s |
| 3–7 | 80 % | 1 HP/s |
| 7–12 | 60 % | 2 HP/s |
| 12–17 | 40 % | 4 HP/s |
| 17–22 | 25 % | 6 HP/s |
| 22–26 | 10 % | 10 HP/s |
| 26–29 | 3 % | 20 HP/s |
| 29–30 | 0 % | 50 HP/s |

Cada intervalo de cierre interpola posición y radio durante sus primeros 60 s y después mantiene
el objetivo hasta el siguiente intervalo. El cierre final ocupa todo el último minuto. Hay aviso
30 s antes de cada comienzo. El daño se aplica una vez por segundo desde la posición autoritativa,
sin proyectiles ni comprobación de paredes. El minimapa dibuja el círculo actual y el siguiente
objetivo. Una línea de 96 segmentos marca el límite en el mundo; fuera aparece un tinte CSS ligero.
No se añaden texturas, sombras ni postprocesado a la tormenta.

## Arquitectura, red y seguridad

- `shared/battle/zone.ts`: cronograma, geometría circular y RNG determinista.
- `shared/battle/BattleRound.ts`: cuenta atrás, participantes, tiempo, daño ambiental, resultado,
  desempate, reinicio y archivo de estadísticas. Sin DOM, Three ni Colyseus.
- `CombatState`: vidas, espera, protección y dos contadores de bajas, compartidos offline/servidor.
- `CharacterBody`/`movement`: congelación y descenso serializados con las correcciones existentes.
- `ServerWorld`/`OfflineSession`: adaptadores físicos y de reinicio. El modo offline conserva la práctica
  inicial con tres muñecos; el botón Iniciar partida offline inicia el ciclo con esos competidores.
- Protocolo **v7**: `battle` a 3 Hz, estado completo en bienvenida y al reiniciar, más vidas/descenso/
  protección en vitals. Los snapshots públicos de movimiento mantienen su formato compacto.
- No hay mensajes para cambiar vidas, HP, tiempo, zona, ganador ni inventario. La sala toma el actor
  de la sesión Colyseus. Se conservan cuotas, validación y límites existentes de mensajes/colas/buffers.
- Los paquetes de ronda, salud y daño ambiental se validan antes de tocar HUD y minimapa.
- Los resultados incluyen identidad, nombre, vidas, HP, disparos, aciertos, daño hecho/recibido,
  bajas, eliminaciones definitivas, muertes, curación y retirada. Se conservan los últimos **10**
  resultados por sala; el log detallado sigue acotado a **2000** entradas por ronda.
  Es un registro en memoria preparado para fase 9, sin base de datos ni persistencia tras cerrar la sala.

## Validación

La suite conserva las 313 pruebas anteriores y añade 33: **346 pruebas en 40 archivos**. Una prueba
anterior de combate servidor se adapta a los 5 s mediante DEATH.respawnSeconds; conserva todas sus
aserciones de inmovilidad, rechazo de disparos, estado público y regreso con 100 HP.

Las regresiones cubren tres vidas, espera bajo ráfagas, descenso dentro del círculo, aterrizaje,
protección y cancelación, reconciliación con entradas pendientes, cronograma, daño ambiental,
ganador, desempates, muertes simultáneas, reconexión, nueva sesión espectadora, reinicio de todos
los recursos, revisiones monotónicas, secuencias antiguas rechazadas y estadísticas acotadas.
También cubren HUD, datos malformados y la prioridad de los botones del espectador sobre la zona
multitáctil: una prueba de navegador detectó la interceptación y se corrigió el z-index.

Dos simulaciones completas aceleradas:

- Lógica compartida: **54 000 ticks**, 1800 s virtuales, ocho competidores, todas las fases, empate y
  una segunda ronda limpia; unos 69 ms en una ejecución dedicada.
- Colyseus y Rapier con **ocho clientes SDK reales**: todas las fases llegan a cada cliente, cierre
  total, resultado y reinicio. Unos **7,69 s** de ejecución del ciclo en una medición dedicada.
  La fixture mantiene los participantes dentro del círculo para alcanzar el límite; no es una IA
  de navegación ni una simulación de comportamiento humano. El bucle real sigue ejecutándose entre
  lotes, por lo que el número de pasos manuales es menor que 54 000.

Por instrucción del usuario, la prueba de **30 minutos reales queda reservada para fase 10**.
La validación prolongada de esta fase es de cinco minutos reales.

### Estabilidad de cinco minutos

Ocho clientes SDK, movimiento, salto, interacción y hachazos, con un jugador fuera del círculo para
comprobar daño/vidas. Instrumentación sin retener paquetes de red en spies. Se ejecutaron otras
comprobaciones de gráficos y pruebas en la misma máquina durante la medición.

| Medida | Resultado |
|---|---|
| Duración real | 300,000 s |
| Jugadores / desconexiones | 8 / 0 |
| Frecuencia / ticks | 30,003 Hz / 9001 |
| Paso p50 / p95 / máximo | 0,544 / 1,005 / 136,140 ms |
| Snapshots por cliente | 9001 para cada uno |
| Cola máxima / buffer de salida máximo | 4 / 0 B |
| Tráfico saliente total | 131 502 B/s, unos 16,05 KiB/s por cliente |
| Heap JS inicial / final | 35,42 / 36,31 MiB |
| Heap observado entre minutos 1 y 5 | 32,00–36,31 MiB |
| RSS inicial / final / máximo observado | 226,79 / 300,91 / 313,14 MiB |
| Colliders inicial / final | 279 / 278 (un árbol destruido) |
| Entradas de estadísticas | Máximo 8 |

El heap no muestra crecimiento sostenido en esta ventana. El RSS sube durante el calentamiento y
no vuelve a su punto inicial; cinco minutos no bastan para descartar crecimiento nativo a largo
plazo. El pico de 136 ms queda registrado, aunque el p95 permanece lejos del presupuesto de 33,3 ms.

### Gráficos y táctil

Chromium headless/SwiftShader, 844×390, ocho jugadores, siete avatares remotos y 16 estructuras.
Ventanas cortas, resolución adaptativa y trabajo concurrente: la CPU media observada varía y no
se usa como medida de FPS de teléfonos físicos.

| Perspectiva | Baja, draw calls | Normal, draw calls |
|---|---|---|
| Isométrica | 19 | 18–31 |
| Tercera | 19 | 18–31 |
| Primera | 15 | 14–26 |

La tormenta añade una sola línea y una geometría compartida. En la muestra activa se registraron
19 geometrías, 13 texturas en Baja y 15 en Normal. Tras Game.dispose: **0 geometrías y 0 texturas**.
Se comprobó arranque offline, inicio de ronda, aviso de cierre, tinte fuera de zona, cambio de
observado con clic real, las tres perspectivas del espectador, empate y vuelta con tres vidas.
También se verificó joystick y salto con dos dedos simultáneos. El tinte del espectador sigue
al observado en vez del cuerpo eliminado. No hubo errores de página. Se mantiene pendiente medir GPU, consumo y memoria en móviles físicos.
El pico Normal de 31 draw calls supera en uno el objetivo de 30; no se oculta esa limitación.

## Reproducción

```bash
npm run check
npm run build:pages
diff -qr dist jugar
npx vitest run tests/battle.test.ts tests/battleWorld.test.ts tests/battleClient.test.tsx
npx vitest run tests/battle.integration.test.ts --disableConsoleIntercept
BR_PHASE8_SOAK_SECONDS=300 npx vitest run tests/battle.integration.test.ts \
  -t 'estabilidad de fase 8' --disableConsoleIntercept --reporter=verbose
```

La suite normal usa cinco segundos para el soak; la ejecución dedicada anterior usó 300.
No se contratan servicios ni se publica servidor. No se fusiona main ni se implementan lobby,
cuentas, persistencia de fase 9 u otras mecánicas posteriores.
