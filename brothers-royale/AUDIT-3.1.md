# Auditoría de Brothers Royale 3.1

Commit auditado de Claude cf307f9b6caeb6083760a976ce768ede556899db. Revisión realizada el 26 de noviembre de 2026 en la rama brothers-royale-phase-3.1, conservando el modo offline y la arquitectura existente.

**Correcciones**

| Gravedad | Hallazgo | Corrección y comprobación |
|---|---|---|
| Alta | Repetir ready eludía las cuotas y generaba bienvenidas completas. Los tipos desconocidos eludían la validación de la sala. | Ready idempotente y sujeto a cuota, rechazo de tipos desconocidos y límite bruto de 180 mensajes/s antes de decodificar. Regresiones con clientes reales y expulsión. |
| Media | Los ticks de reposo acumulaban créditos aunque ya habían avanzado la simulación. | Se agotan los créditos al simular reposo. La siguiente ráfaga procesa solo una entrada en su primer tick. |
| Media | Se aceptaban controles antes de completar ready. | Se requiere la bienvenida antes de encolar controles. Prueba real comprueba cola vacía y secuencia sin avanzar. |
| Media | El SDK impedía reconectar en los primeros cinco segundos de conexión. | minUptime pasa a cero y se acota el presupuesto de reintentos a aproximadamente 15 segundos. Prueba con corte real de socket, conservación de identidad y confirmación de nuevas entradas. |
| Media | La nueva bienvenida podía convivir con una corrección pendiente y estados remotos anteriores. | Se limpian corrección, historial e interpolación y se descartan correcciones antiguas. Solo se anuncia connected tras la bienvenida. |
| Media | Un snapshot atrasado podía resucitar a un remoto retirado. | Los datos antiguos solo completan buffers de jugadores que siguen presentes. Regresión de salida seguida de snapshot atrasado. |
| Media | Un receptor lento podía acumular snapshots en el servidor. | Cierre si supera 256 KiB pendientes. La prueba inyecta bufferedAmount para comprobar el umbral. |
| Media | Una unión tardía podía dejar una sala sin sesión propietaria. Destruir Game durante una unión podía crear un cuerpo sobre física liberada. | Cierre de uniones tardías y cancelación antes de construir el personaje. Regresión de cancelación durante conexión real. |
| Media | Engine.dispose no liberaba geometrías, materiales, instancias ni recursos de luces. | Liberación explícita de recursos, retirada del avatar local y prueba de ciclos en Chromium. |
| Baja | Cada avatar creaba un array de claves por frame y liberaba varias veces su material compartido. | Claves de pose constantes y liberación única por material. Regresión de liberación de seis geometrías y dos materiales. |

Se conserva la validación de secuencias, magnitud, valores finitos y botones. Las entradas se copian antes de almacenarse. Las colas permanecen acotadas a 12 entradas y el historial predictivo a 128. El transporte WebSocket de Colyseus ya limita cada mensaje a 4 KiB.

**Mediciones históricas anteriores al límite de ocho**

Muestra dedicada con 16 clientes SDK reales en el mismo servidor local, enviando 150 entradas cada uno a 30 Hz durante cinco segundos. Se instrumentaron ServerWorld.step y los bytes entregados a los sockets del servidor.

| Medida | Resultado |
|---|---|
| Frecuencia observada | 149 ticks en 4,999 s, 29,81 Hz |
| Paso de simulación p50 / p95 / máximo | 1,68 / 3,56 / 6,43 ms |
| Intervalo entre ticks p95 | 34,01 ms |
| Presupuesto por tick | 33,33 ms |
| Tráfico saliente total observado | 314.334 bytes/s para los 16 clientes |
| Cola máxima al terminar la muestra | 1 entrada por jugador |
| Entrega en ráfagas de 100–167 ms y 10% de entradas omitidas | 12 omisiones de 121 entradas, cola máxima 3 |
| Corrección máxima en ese escenario / error final | 0,1716 m / 0 m |
| Creación y retirada física | 20 ciclos de 16 jugadores, sin cuerpos ni colisionadores residuales |

La prueba de reconexión corta un WebSocket real. Otra prueba deshabilita la reconexión del cliente y comprueba la retirada del personaje al expirar la reserva de 15 segundos.

Las omisiones simulan pérdida a nivel de aplicación. WebSocket usa TCP, donde la pérdida de paquetes produce retransmisión y bloqueo de entrega ordenada. Esta prueba no mide pérdida de paquetes IP. La prueba de receptor lento verifica el umbral mediante inyección del tamaño de buffer.

**Gráficos y memoria**

Chromium headless con SwiftShader, calidad low y servidor local con 15 clientes adicionales.

- En el encuadre normal a 800×600 se observaron 45 FPS, 50 draw calls y 17.874 triángulos, con resolución adaptativa en 0,7. Parte de los remotos estaba fuera de cámara.
- En un frame forzado con los 15 remotos visibles a 390×844 se contaron 102 draw calls y 18.530 triángulos. Este frame no mide FPS sostenidos.
- Tras 6, 12 y 18 ciclos online/offline quedaron 19 geometrías y 0 texturas en el renderer. La primera conexión habilitó una geometría estática adicional por el cambio de encuadre y después el recuento se estabilizó.
- Heap JavaScript tras GC en esas tres muestras, 58.179.860, 54.558.209 y 52.868.779 bytes.
- Tras Game.dispose quedaron 0 geometrías y 0 texturas. No hubo errores de página durante la prueba de ciclos.

Estas muestras detectan crecimiento por altas y bajas, pero no descartan fugas lentas durante horas ni miden consumo energético o FPS en un teléfono físico.

Los resultados vigentes con ocho jugadores y diez minutos figuran en SOAK-8-PLAYERS.md.

**Validación de la auditoría original**

- npm run check ejecuta tipos, todas las pruebas y los builds de cliente y servidor.
- npm run build:pages regenera jugar. diff -qr dist jugar comprueba la correspondencia completa.
- Las métricas se imprimen con vitest run tests/audit.integration.test.ts tests/serverWorld.test.ts --disableConsoleIntercept --reporter=verbose.
- Las 120 pruebas originales se ejecutaron antes de modificar código y pasaron. La suite final aprobó 134 pruebas, incluidos los controles táctiles y el modo offline, y ambos builds. El bundle jugar se regeneró y coincidió completamente con dist.

**Pendiente**

- Los 102 draw calls con todos los remotos visibles superan el objetivo de menos de 50 de la escena original. Reducirlos sustancialmente requiere batching o menos mallas por avatar. Se conserva la animación de Claude.
- Validar sesiones largas y celulares físicos. No se realizaron pruebas prolongadas de producción ni mediciones de pérdida IP en redes móviles.
- El bucle recupera como máximo 250 ms tras un bloqueo del proceso. Una pausa mayor reduce la frecuencia efectiva. La muestra de 16 clientes no llegó a ese límite.
- El historial de 128 entradas cubre unos 4,27 segundos a 30 Hz. Una interrupción mayor puede producir un salto visible al corregirse. La reconexión reinicia el historial.
- Las salas siguen siendo públicas y anónimas. El código selecciona sala y no actúa como credencial. No se añadieron autenticación, protección global contra creación masiva de salas ni límites por IP.
