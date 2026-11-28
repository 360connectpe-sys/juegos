# BROTHERS ROYALE — Fase 12: mejoras de jugabilidad real

Rama de desarrollo `brothers-royale-phase-3.1` · publicación `brothers-royale-beta-pages` (`brothers-royale/beta/`).
Protocolo de red **v9** (cliente y servidor deben ir juntos). Servidor: `wss://brothers-royale-server.onrender.com`.

## Resumen por bloque

| # | Bloque | Estado | Commit |
|---|---|---|---|
| 1 | Techos y colisiones sólidas | HECHO | 943f016 |
| 2-3 | 15 min, 5 fases de tormenta, desempate, HUD, barrera visual y minimapa | HECHO | 133e325 |
| 4 | Ajustes para todos los jugadores | HECHO | 8da9e5d |
| 7 | Seis diseños de edificio con muebles y botín | HECHO | c973d34 |
| 5-6 | Avión, caída libre, paracaídas y reaparición en avión | HECHO | 98ee242 |
| 8 | Zombis del servidor (y sin conexión) | HECHO | ba0edf1, c2a5169 |
| 9-10 | Rendimiento, pruebas, docs, beta | HECHO (sin la prueba de 30 min, omitida por petición) | este informe |

### 1. Techos y colisiones
- Tejados a dos aguas, cumbreras, chimeneas, azoteas, pretiles y tejadillos **colisionan** (antes eran solo visuales y se caía dentro).
  Mismas piezas → mismos colisionadores en cliente y servidor; la calidad no toca el mundo.
- El volumen "interior" termina bajo el tejado: quien está encima cuenta como fuera (el techo se sigue viendo).
- `PhysicsWorld.groundHeightAt` ignora cuerpos de jugadores (solo estático).

### 2-3. Partida de 15 min y tormenta
- `zone.ts`: `ROUND_SECONDS = 900`; fases 0-4 min 85 m (1 HP/s), 4-7 60 m (2), 7-10 40 m (4), 10-13 20 m (7), 13-15 5→0 m (12).
  Cierre progresivo (60 s; 45 s en la 5.ª; colapso final 14:00-15:00), aviso de 30 s, centros anidados (cada centro dentro
  de la zona anterior), radios proporcionales si cambia `WORLD.size` (hoy 120 m, sin cambios).
- Fin anticipado con un superviviente; fin obligatorio a los 15:00 (también con reloj monotónico). Desempate:
  **vidas → salud → eliminaciones de jugadores → empate**. Las reapariciones no alargan la partida.
- HUD: "Quedan m:ss · Fase N/5 · supervivientes", "Próximo cierre en…", aviso y "cerrándose". Minimapa: zona actual,
  siguiente (discontinua) y velo exterior.
- `StormView`: barrera de energía azul/violeta animada (un cilindro, shader aditivo, sin escribir profundidad) que late al
  estar fuera; tinte de pantalla pulsante al recibir daño de tormenta.

### 4. Ajustes para todos
- Causa real: en el celular la zona táctil de mirada (`.touch__look`, z 6) tapaba el engranaje del HUD (z 5); solo podía
  abrirlo quien jugaba en ordenador (normalmente el anfitrión). `.hud` sube a z 7.
- Verificado con 8 clientes en línea (4 táctiles): todos abren Ajustes, la partida sigue (entrada neutra mientras está
  abierto) y las preferencias son por jugador (localStorage). Solo iniciar la partida es del anfitrión.

### 5-6. Avión de transporte y reaparición
- `shared/battle/flight.ts` + `BattleRound`: autoridad total del servidor (y offline). Todos embarcan al empezar; ruta
  aleatoria por semilla que cruza el mapa; cada uno salta cuando quiere (botón **Saltar**/Espacio/A); salto automático al
  final de la ruta (dentro del mapa).
- Caída libre (dirección con el movimiento, correr = picado), paracaídas automático a 24 m o antes con Saltar (correr =
  bajar más rápido). Se aterriza en tejados y azoteas. Sin daño, disparos, construcción ni cofres en el aire; al aterrizar
  3 s de protección que el ataque cancela.
- Al perder una vida: avión propio cuya ruta termina **dentro de la zona segura actual** (máx. 12 s; más corta en zonas
  pequeñas). No reinicia los aviones de los demás. Máximo 9 aviones a la vez.
- Cliente: `AirView` (aviones y paracaídas: 2 InstancedMesh, 0 draw calls si no hay nada en el aire), cámara sobre el
  terreno bajo el avión (isométrica) o desde el avión (3ª/1ª), ruta y posición en el minimapa, textos del descenso.
- Red: `RoundSnapshot.planes` y `players[].air/plane` (validados). `MotorModifiers.air` (2/3) va en las correcciones.

### 7. Diseños de edificio
- Rural de una planta (`cabin`), familiar de dos plantas (casa grande), **moderna con azotea** y escalera exterior,
  **casa con balcón** (dos plantas, escalera interior, puerta al balcón), **almacén/garaje** (coche, estanterías, banco),
  **edificio abandonado** (paredes rotas, media cubierta y losa caída como rampa). Siguen `stone`, `long` y `porch`.
- Muebles (cama, mesa, silla, estantería, caja, sofá, banco, coche, escombros) con una caja de colisión de volumen
  completo (sin huecos donde atascarse). Cada partida incluye los 6 diseños; cofres extra en planta alta, azotea y garaje.
- Todo sigue fusionado en el lote de interiores (mismas draw calls).

### 8. Zombis
- `physics/ZombieDirector.ts` + `shared/zombies/zombieAi.ts`. 40 HP, 5 HP por golpe cada 0,8 s, uno cada 30 s, máx. 8,
  velocidad media (3,5 m/s), cuerpo a cuerpo. Cuerpos `CharacterBody` (mismas colisiones: no atraviesan sólidos, suben
  peldaños y rampas). IA escalonada (cada 6 ticks por zombi), persecución con histéresis, navegación por puertas y
  escaleras declaradas en cada prefab (`nav`), atasco → salto y rodeo.
- Aparecen dentro de la zona, a ≥ 14 m de cualquier jugador y fuera de edificios; nunca tras terminar la partida. Les dañan
  armas, hacha y tormenta. No persiguen a quien está en el avión o en el descenso. No cuentan en estadísticas,
  eliminaciones ni ganador. Botín configurable (`dropChance` 0,3): munición en el suelo o 15 de madera.
- Cliente: una InstancedMesh con andar/perseguir/atacar/golpe/muerte en el shader; barra de salud al apuntar; gruñido
  sintetizado. Red: `snapshot.z` (7 enteros por zombi, validado).

## Pruebas
- Suite: **434 pasan + 2 omitidas** (soak10 y soak12 solo con variable de entorno). Antes de la fase: 404.
- Nuevas: `phase12Roofs`, `phase12Buildings`, `phase12Flight`, `phase12Zombies`, `phase12Ui` y casos añadidos en
  `battle.test` (5 fases, 15 min, desempate). Las pruebas de sistemas ajenos al avión arrancan en tierra
  (`BattleRound.defaultTransport = false`).
- E2E (Chromium, swiftshader): Ajustes con 8 clientes en línea; avión→caída→paracaídas→aterrizaje offline (isométrica y
  3ª persona) y en línea (2 clientes: salto manual y automático); zombis atacando y barra de salud.
- Estabilidad: **la prueba de 30 min se omitió por petición del usuario**. Corrida corta de 40 s del escenario máximo
  (`tests/soak12.integration.test.ts`, 8 clientes SDK, avión, 8 zombis, combate, hasta 109 estructuras): 31,5 Hz medios
  (mín. 29), paso p95 máx. 5,9 ms, 0 desconexiones, desconexión aislada correcta, heap ≤ 59 MB.
  Comando: `BR_SOAK12_SECONDS=1800 BR_SOAK12_OUT=soak12.json npx vitest run tests/soak12.integration.test.ts`.

## Métricas (entorno de pruebas, no dispositivos reales)
- Servidor, 8 jugadores corriendo: paso medio 0,995 ms (p95 1,69) sin zombis → 1,544 ms (p95 2,26) con 8 zombis.
- Cliente (Chromium headless con swiftshader, 1280×720, calidad Normal): 14-25 draw calls con avión/paracaídas/zombis
  y barrera de tormenta; nuevos elementos: tormenta 1, aviones 1, paracaídas 1, zombis 1 (solo si existen).
- **No se midió en iPhone 13 Pro ni Android**: los objetivos de 60 / 30-60 FPS quedan por verificar en dispositivo.

## Pendiente / riesgos
- Prueba de 30 min del escenario máximo (omitida). Medición en dispositivos reales.
- Render gratis (0,1 CPU): los zombis suman ~0,55 ms por tick; vigilar la carga con 2 salas llenas.
- La navegación de zombis es simplificada (puerta/escalera directa); en bordes complejos pueden tardar en rodear.
- El despliegue cambia el protocolo a v9: clientes v8 abiertos reciben "versión distinta" y deben recargar.
