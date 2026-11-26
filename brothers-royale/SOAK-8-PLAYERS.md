# Estabilidad de diez minutos con ocho jugadores

Prueba local completada el 26 de noviembre de 2026 en brothers-royale-phase-3.1. Servidor Colyseus y ocho clientes SDK conectados por WebSocket, con movimiento a 30 Hz, cambio de dirección cada tres segundos y saltos periódicos. La instrumentación conserva métricas agregadas y limpia el registro de paquetes de los spies en cada iteración.

| Medida | Resultado |
|---|---|
| Duración de la carga | 599.999 s, diez minutos |
| Clientes presentes durante toda la carga | 8 |
| Desconexiones | 0 |
| Entradas enviadas | 18.000 por cliente, 144.000 en total |
| Ticks de servidor | 18000 |
| Frecuencia observada | 30.00004 Hz |
| Snapshots recibidos por cada uno de los ocho clientes | 18.000 |
| Paso de simulación p50 / p95 / máximo | 0.740 / 1.189 / 39.487 ms |
| Intervalo entre ticks p95 | 33.897 ms |
| Tráfico saliente total | 125168 bytes/s |
| Cola máxima observada | 3 entradas por jugador, límite 12 |
| Buffer de salida máximo observado al muestrear | 0 bytes |

El máximo de un paso superó puntualmente el presupuesto de 33,33 ms. El bucle recuperó el retraso y completó los 18.000 ticks previstos. Los buffers se muestrean durante la prueba y no representan una medición continua de cada escritura TCP.

**Memoria del proceso de prueba**

El proceso incluye el servidor, los ocho clientes SDK y la instrumentación de Vitest. Son muestras sin forzar GC, expresadas en MB decimales.

| Segundo | RSS MB | Heap usado MB |
|---|---|---|
| 0 | 170.87 | 31.35 |
| 60 | 295.52 | 44.01 |
| 120 | 270.28 | 32.21 |
| 180 | 275.39 | 32.97 |
| 240 | 277.10 | 35.90 |
| 300 | 274.15 | 31.87 |
| 360 | 275.19 | 37.00 |
| 420 | 282.93 | 34.59 |
| 480 | 282.93 | 38.50 |
| 540 | 280.55 | 29.66 |
| 600 | 280.55 | 32.86 |

El RSS sube durante el calentamiento. Desde el segundo 120 oscila entre 270.28 y 282.93 MB. El heap usado termina en 32.86 MB frente a 31.35 MB iniciales, con oscilaciones por GC. La muestra no presenta crecimiento monotónico del heap y no descarta fugas de aparición más lenta.

**Capacidad y regresiones**

- NET.maxPlayersPerRoom vale ocho y lo comparten servidor y cliente.
- Colyseus rechaza al noveno al entrar por roomId porque la sala está bloqueada. La plaza de un cliente desconectado sigue contando durante la reserva de reconexión.
- Tras una salida voluntaria, otro cliente ocupa la plaza libre y el total vuelve a ocho.
- ServerWorld rechaza un noveno cuerpo antes de asignar recursos.
- OnlineSession rechaza bienvenidas y altas que excedan ocho. La UI muestra n/8 jugadores.
- joinOrCreate mantiene la posibilidad de abrir otra sala cuando la anterior está llena.
- Los 134 casos anteriores se conservan, adaptando la carga y los ciclos al límite actual. Cuatro regresiones adicionales elevan el total a 138 pruebas aprobadas.
- Tipos y builds de cliente, servidor y Pages aprobados. El contenido completo de jugar coincide con dist.

**Reproducción**

    BR_SOAK_SECONDS=600 ./node_modules/.bin/vitest run tests/audit.integration.test.ts -t 'sostiene 8 clientes' --disableConsoleIntercept --reporter=verbose

En la suite normal el mismo escenario dura cinco segundos. La ejecución prolongada selecciona ese escenario y omite los otros seis del archivo. La suite completa de 138 pruebas se ejecutó por separado, sin omisiones.

La prueba mide ocho clientes SDK locales. No ejecuta ocho renderizadores gráficos ni reproduce una red móvil real. Las limitaciones gráficas y de seguridad global de AUDIT-3.1.md continúan vigentes.
