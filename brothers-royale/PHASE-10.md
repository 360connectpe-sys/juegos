# Fase 10 — Multijugador real

Rama `brothers-royale-phase-3.1`. Publicación: `brothers-royale-beta-pages` (solo `brothers-royale/beta/`).

## Hecho
- **Despliegue integrado** (rama `brothers-royale-server-deploy`, 29b1e23) sobre la corrección móvil (aba1015),
  conservando todas las correcciones: `GET /health`, CORS y WebSocket limitados a `ALLOWED_ORIGINS`, límite de
  salas `MAX_ROOMS` (código 4105), Dockerfile multiarquitectura, Blueprint de Render, Oracle + Caddy (WSS) y
  `config.js` en la página publicada (URL del servidor sin recompilar). Guía: **DEPLOY.md**.
- **Indicador de red en partida** (`NetBadge`): ping con color (< 80 ms verde, < 160 amarillo, más rojo),
  «Conectando…», «Reconectando…» y «Sin conexión». El panel «Jugar en línea» sigue oculto en partida.
- Ya existentes y verificados por pruebas con 8 clientes reales: salas públicas y privadas por código (una
  privada no se alcanza sin código), máximo 8 por sala, migración de anfitrión, reconexión que conserva vidas,
  revancha, espectadores durante una ronda, cuenta atrás cancelada si cae un participante.
- Simulación autoritativa a 30 Hz sin cambios.

## Prueba de estabilidad de 30 minutos (`tests/soak10.integration.test.ts`, datos en `SOAK-10.json`)
8 clientes SDK reales (WebSocket local) en una sala: lobby → partida, combate continuo (rifles y subfusiles),
construcción hasta 128 estructuras (se reconstruyen al destruirse), tormenta real y revancha automática al
terminar la ronda. Un cliente se desconecta al minuto: los otros 7 siguen recibiendo estado.

| Medida | Resultado |
|---|---|
| Duración | 1800 s (1814 s reales) |
| Desconexiones no provocadas | 0 |
| Desconexión aislada | sí (los 7 restantes siguieron) |
| Frecuencia de simulación | 30,24 Hz de media (mín. 29 en una muestra de 1 s) |
| Paso de simulación p95 (por minuto) | 1,2–2,3 ms; máximo de una muestra 10,0 ms |
| Latencia ping/pong p50 / p95 máx. | 0,4 / 11,9 ms (red local; mide el coste del servidor, no la red) |
| CPU del proceso (servidor + 8 clientes) | 8 % de un núcleo de media; 143,9 s de CPU en 30 min |
| Memoria RSS inicio / fin / máx. | 331,5 / 335,1 / 337,8 MB |
| Montículo JS minuto 2 / último minuto / máx. | 44,8 / 39,8 / 53,9 MB → **sin fuga** |
| Estructuras | 128 alcanzadas; a 128 durante 1707 s |
| Rondas | 2 (una revancha) |

Ejecutar: `BR_SOAK10_SECONDS=1800 BR_SOAK10_OUT=SOAK-10.json npx vitest run tests/soak10.integration.test.ts`
(sin la variable la prueba se omite y no alarga la suite).

## Pendiente (necesita al usuario)
- Crear la cuenta y desplegar el servidor (Render Free o Oracle Santiago, DEPLOY.md), poner su URL `wss://` en
  `brothers-royale/beta/config.js` de la rama de publicación y verificar una partida real entre celulares.
- Medir la latencia real desde Perú y FPS en celulares físicos.
