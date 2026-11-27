# Fase 7 — Madera, tala y construcción

La fase se desarrolla después del commit independiente de auditoría 55b38f6. Se conservan las 281
pruebas anteriores, las regresiones de auditoría y el modo offline. La fase 8 sigue pendiente.

**Reglas implementadas**

- Único material, madera. Se empieza con 0, con máximo de 999 por jugador.
- Árboles con 90 de resistencia. El hacha mantiene el daño y cadencia de fase 6, 15 a 1,5 golpes/s.
  Cada 15 de daño efectivo con hacha concede 5 de madera. Un árbol completo concede como máximo 30.
  Las balas dañan árboles pero no dan madera. Árbol agotado deja de dar material y pierde su collider.
- Impactos animados sacuden el árbol. Destrucción y resistencia se sincronizan desde la autoridad.
- Pared, suelo, rampa y techo de madera, coste inicial de 10 cada uno, resistencia 150. El daño procede
  exclusivamente de CombatState. Un hachazo a estructura no concede material. No hay reembolso al destruir.
- Rotación en pasos de 90 grados y cuadrícula horizontal de 3 m. La vista previa verde/roja se decide
  con los mismos prefabs y consultas de espacio. El servidor revalida al colocar.
- El menú permite elegir pieza, rotación, nivel y colocación. B, mando Y o el botón Construir abren
  el modo. En ese modo el ataque coloca en el flanco y no dispara. El botón Colocar también sirve en
  táctil. Madera y menú son dos elementos editables del HUD y migran los layouts guardados.
- No se editan piezas colocadas. Los campos id, owner, hp y materiales que añada un cliente no
  modifican el estado. Solo se copian los campos conocidos de la solicitud.
- Máximo de 128 piezas por sala y 32 por propietario. Alcance de colocación 6 m y base máxima y=15.
  Se rechazan posiciones fuera del mapa, números no finitos, rotaciones inválidas, espacio ocupado,
  ausencia de soporte, paredes interpuestas y cualquier cápsula de jugador solapada.
- Las bases requieren terreno suficientemente plano, con tolerancia de 6 cm en sus cinco puntos de
  apoyo. Piezas elevadas se apoyan en construcciones propias del sistema. Suelos adyacentes transmiten
  soporte. Al destruir soporte se recalcula desde las raíces en terreno y se elimina la cadena huérfana.
  Los edificios originales del mapa no se convierten en soportes editables.
- La reserva de reconexión conserva madera y construcciones. Al abandonar definitivamente se retira
  la madera de esa sesión. Las construcciones pagadas permanecen hasta destruirse o cerrar la sala.
  Al volver a offline se reinician árboles, piezas y materiales; una regresión verifica también
  los colliders restaurados. No se añaden piedra, metal, edición de estructuras, vidas ni otras
  mecánicas de fase 8.

**Arquitectura y autoridad**

BuildingState, en shared/building, es puro e inyecta terreno y consultas de espacio. BuildingWorld
adapta Rapier y se usa en ServerWorld, OfflineSession y la réplica del cliente. BuildingView usa un
BatchedMesh para las cuatro clases, geometrías y material compartidos y una malla de vista previa.
Los árboles conservan los dos lotes originales. No se crean mallas por árbol ni por pieza.

El protocolo sube a v6 por los mensajes build, building y el snapshot de bienvenida. La construcción
no se predice ni altera materiales en el cliente. El servidor toma el actor de la sesión autenticada
por Colyseus y valida posición, coste, límites y estado de eliminación. El combate usa un gancho de
obstáculo alcanzado después de resolver rayos y paredes, conservando la cadencia y la munición.
El rebobinado sigue limitado a poses de jugadores. La geometría destructible se consulta en su
estado actual, sin inventar una historia de estructuras.

Rapier 0.21 actualiza su broad-phase en step. BuildingWorld publica cambios de colliders con un
paso físico solo cuando cambia la geometría. En este juego todos los cuerpos móviles son cinemáticos,
por lo que no avanza el motor del personaje ni el tick de juego. Incorporar cuerpos dinámicos en una
fase futura requerirá revisar esta estrategia. Una regresión verifica rayos inmediatamente tras una
carga con ids reutilizados.

Los snapshots se almacenan en caché por revisión. La vista no reconstruye estructuras por frame.
Las instancias se reutilizan y se retiran al destruir. Los materiales, geometrías y texturas internas
del lote se liberan al cerrar Game.

**Pruebas**

La suite completa conserva las 281 pruebas previas. Nuevas pruebas cubren los fallos de fase 6,
coste, duplicación de madera, campos maliciosos, mapa, alcance, superposición, jugadores, visión,
soporte y colapso, límites, física real de las cuatro piezas, subida de rampas en cuatro rotaciones,
hacha y armas, restauración de colliders,
vista previa, árboles destruidos y restaurados y migración del HUD.

La integración usa ocho clientes SDK reales a 30 Hz. Los ocho golpean árboles hasta obtener
30 de madera cada uno, construyen una pieza cada uno (las cuatro clases representadas), reciben
equipamiento desde la fixture de servidor y disparan hasta destruir todas las piezas. Se verifica
saldo de 20 tras cada colocación, rechazo de campos fraudulentos y reconexión conservando saldo.
Las ocho solicitudes de construcción se envían en una ráfaga. La fixture espera el evento real
de reconexión del SDK antes de continuar.
La ejecución dedicada final duró 11,4 s, con 330 ticks observados, p95 de simulación 1,20 ms,
máximo 6,08 ms y máximo de validación/colocación 0,68 ms. Los ocho clientes siguieron presentes
y todas las piezas acabaron destruidas. Son mediciones locales cortas y no un soak de producción.

En Chromium táctil se probó el flujo completo, hacha → árbol destruido → 30 madera → menú →
rotación → colocación mediante clic real → saldo 20. También se detectó y corrigió la interceptación
del menú por la zona de joystick, colocando el HUD interactivo por encima. No hubo errores de página.

Se corrigió un atasco del motor al entrar en pendientes de 45 grados: el avance que la colisión
convierte en subida se trataba como choque contra una pared y frenaba la velocidad horizontal
cada tick. La corrección compartida conserva el impulso durante una subida apoyada. La nueva
regresión recorre las cuatro orientaciones con CharacterBody y Rapier reales.

**Comparación de rendimiento**

Chromium headless con SwiftShader, 844×390, ocho jugadores, cámara isométrica y ventanas de unos 2 s.
La referencia de fase 6 usa el bundle del commit auditado 55b38f6. La fase 7 añade 16 piezas.
La resolución es adaptativa, de modo que estas muestras no demuestran una mejora estadística de FPS.

| Medida | Fase 6 Baja | Fase 7 Baja | Fase 6 Normal | Fase 7 Normal |
|---|---|---|---|---|
| Draw calls | 14 | 15 | 25 | 27 |
| CPU de frame media observada | 1,53 ms | 1,66 ms | 2,82 ms | 2,92 ms |
| Geometrías registradas | 15 | 16 | 17 | 18 |
| Texturas registradas | 7 | 10 | 12 | 15 |
| Programas registrados | 7 | 8 | 21 | 25 |

La versión inicial con cuatro InstancedMesh añadió cuatro llamadas en Baja y ocho en Normal.
Se sustituyó por un BatchedMesh, reduciendo el incremento a +1 y +2. En ambos bundles el renderer
quedó en 0 geometrías y 0 texturas después de Game.dispose.

**Reproducción y límites**

- npm run check comprueba tipos, todas las pruebas y builds.
- npm run build:pages y diff -qr dist jugar comprueban el bundle.
- vitest run tests/building.integration.test.ts --disableConsoleIntercept --reporter=verbose imprime
  las métricas de ocho clientes. tests/building.test.ts y buildingClient.test.tsx cubren reglas y HUD.
- Las fixtures conceden armas o materiales exclusivamente en código de prueba. El servidor normal
  no concede equipamiento por variables de entorno.
- Se requieren mediciones en teléfonos reales, sesiones de horas y redes móviles. No se contratan
  servicios ni se publica un servidor. Se mantienen las limitaciones de infraestructura y memoria
  documentadas en PROJECT_CONTEXT.md.
