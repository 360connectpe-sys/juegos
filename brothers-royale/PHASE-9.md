# Fase 9 — Lobby, personalización y resultados

Base `8d15ae3a60e331769486a149bf2e10c602b8d06c`. Rama `brothers-royale-phase-3.1`.
Cambios exclusivos de Brothers Royale. No se fusiona main ni se inicia fase 10.

## Flujo implementado

La pantalla principal utiliza la identidad tipográfica y la paleta de Brothers Royale. El personaje
3D respira y se anima en la misma escena/renderer del juego, con una cámara de presentación. No se
crea un segundo contexto WebGL ni se descargan modelos, imágenes o texturas de personalización.

- Nombre visible, doce colores de polo, Crear sala, Entrar a sala, Practicar sin conexión y Ajustes.
- Crear permite elegir sala privada o pública. La privada obtiene un código aleatorio de ocho
  caracteres generado con crypto.getRandomValues y confirmado por el servidor. Los códigos de salas
  activas son únicos en la instancia; una colisión se rechaza sin apropiarse de una sala existente.
- Entrar por código usa join, sin crear una sala si el código no existe. Buscar sala pública usa
  matchmaking con código vacío. Crear pública crea una sala nueva abierta al matchmaking público.
- Las privadas quedan unlisted, fuera del listado público, y exigen el código correcto incluso al
  intentar joinById. Un código compartido autoriza entrar; no sustituye a una cuenta o contraseña.
- El lobby muestra hasta ocho jugadores, colores, nombres únicos, estados de carga/conexión/Listo,
  código e identificación del anfitrión. Los asientos reservados para reconexión siguen ocupados.
- El primer conectado es anfitrión. Los demás confirman Listo. Solo el anfitrión puede iniciar;
  hacen falta al menos dos jugadores, todos conectados y cargados, y todos los participantes listos.
  El anfitrión confirma su intención con Iniciar partida, sin un segundo botón Listo.
- Cuenta atrás de 10 s. Si alguien pierde la conexión o entra un participante sin preparar, se cancela
  sin consumir una ronda. Los perfiles y el estado Listo no cambian durante la cuenta atrás o partida.
- Ante una caída del anfitrión, se elige al primer miembro restante conectado por orden de llegada.
  Si vuelve, conserva su identidad pero no recupera automáticamente el puesto del nuevo anfitrión.
  La reserva de 15 s conserva vidas, inventario, skin y estadísticas; no crea otro participante.
- Durante una ronda, los recién llegados siguen siendo espectadores, como en fase 8.
- La partida termina con una pantalla de resultados que permanece hasta que el usuario elija.
  Volver al lobby abre una sala limpia sin marcar al jugador listo. Jugar otra vez abre el lobby y
  confirma solo la preparación de quien lo pulsa. El anfitrión vuelve a iniciar cuando todos están
  listos; nadie puede forzar la aceptación de otros jugadores.
- Cada cliente mantiene su resultado mientras los demás vuelven al lobby. Se evita que una respuesta
  de red lenta vuelva a abrir un resultado ya descartado. La clave incluye sesión y número de ronda.
- En práctica offline se conservan mapa, cofres, combate, construcción y tres muñecos. El botón
  Iniciar partida offline permite ejecutar el ciclo con esos competidores. Menú principal restaura
  la práctica; este nuevo botón pertenece al HUD editable y migra layouts guardados anteriores.

## Personalización, nombres y preferencias

Solo cambia el color del polo: doce opciones compartidas en shared/lobby/profile.ts. Pantalón, piel,
pelo, tamaño, geometría, hitbox, estadísticas y movimiento son iguales. Las geometrías se cachean por
paleta y el material permanece compartido; cambiar de skin retira el esqueleto anterior.

br.profile.v1 conserva nombre y skin y migra br.name. Cada lectura normaliza los datos y recupera
valores de fábrica ante JSON corrupto, índices inválidos o almacenamiento bloqueado. Perspectiva,
sensibilidades, volumen, calidad y HUD continúan usando sus preferencias existentes. Los enlaces
?online conservan la skin guardada. El SDK de red sigue cargándose únicamente al conectar.

Los nombres sobre los personajes son un máximo de ocho elementos DOM reutilizables, sin texturas
ni draw calls nuevos. Se proyectan con la cámara activa, se ocultan fuera de pantalla y ante paredes
con consultas de visión limitadas a 10 Hz. textContent evita interpretar nombres como HTML. Se
retiran al desaparecer el jugador y se liberan al cerrar Game.

## Autoridad y estadísticas

Protocolo **v8**. LobbyState contiene miembros, anfitrión, preparación y permisos. BrothersRoom toma
siempre el actor de client.sessionId; los ids, host, HP o estadísticas que añada un cliente no otorgan
permisos. Se conservan los límites previos de entrada, mensajes, colas, reconexión y salida saturada.

Nombres normalizados y limitados a 16 caracteres, únicos en la sala; skin entera de 0 a 11. Tanto
unión como cambios de perfil se validan en servidor. Los mensajes nuevos son profile, lobbyReady,
start, returnLobby y rematch; no hay mensaje para escribir estadísticas. Durante el lobby se bloquean
movimiento, ataques, interacción y construcción. Los datos de lobby y resultados también se validan
antes de dibujarlos en cliente.

La pantalla final muestra:

| Dato | Fuente autoritativa |
|---|---|
| Ganador / empate | BattleRound, mismas reglas de fase 8 |
| Posición | Clasificación con empates compartidos; supervivientes por vidas/eliminaciones/HP, eliminados por tiempo de eliminación |
| Eliminaciones | Tercera vida agotada de un oponente; kills conserva separadas las bajas de vida |
| Muertes | Vidas perdidas registradas por CombatState |
| Daño causado | HP realmente retirados a oponentes, sin exceso sobre la vida; el registro bruto histórico sigue intacto |
| Precisión | Disparos de armas con algún impacto válido en un jugador / disparos de armas × 100; sin hachazos y sin contar cada perdigón como otro disparo |
| Madera recolectada | Madera efectivamente acreditada por golpes de hacha, respetando el tope de almacenamiento |
| Estructuras construidas | Colocaciones aceptadas y pagadas, no solicitudes rechazadas o repetidas |
| Supervivencia | Tiempo hasta perder la última vida o retirarse; incluye esperas y descensos de vidas anteriores |

Los contadores de materiales los notifican BuildingState.onHarvest/onBuild a BattleRound. Los de
combate los calcula CombatState. Los resultados se archivan antes de retirar estadísticas de un
participante y quedan separados de la siguiente ronda. Se mantienen los límites de diez resultados
por sala y 2000 eventos detallados por ronda. No se añade persistencia de servidor, cuentas ni servicios.

## Pruebas y navegador

**362 pruebas en 43 archivos**: se conservan las 346 anteriores y se añaden 16. Las fixtures antiguas
que probaban jugabilidad ahora inician explícitamente una partida; la prueba de código por roomId
aporta el código requerido y la de unión espera la nueva skin por defecto. La prueba de reinicio
pide volver al lobby. Se mantienen las aserciones de movimiento, combate, botín, construcción,
reconexión, reinicio, colisiones, táctil, cámaras y límites.

- lobby.test.ts: perfiles/12 colores, permisos, estados, límite de ocho, migración del anfitrión,
  validación y contadores autoritativos, incluido daño sin exceso sobre HP.
- lobbyClient.test.tsx: menú, formas de entrada, Listo/inicio/cuenta atrás, guardado y datos corruptos,
  resultados completos y etiquetas seguras/ocultas por paredes. El HUD anterior incorpora Menú principal.
- lobby.integration.test.ts: ocho SDK reales, sala privada, nombres únicos, skin 11, noveno rechazado,
  entradas bloqueadas en lobby, perfiles malformados, huésped sin permisos, anfitrión desconectado y
  reconectado, vidas/inventario conservados, final, datos fraudulentos ignorados y revancha limpia.
  También código incorrecto, colisión de código, privada excluida del matchmaking público y cancelación
  de cuenta atrás por desconexión.

Chromium/SwiftShader con viewport táctil 844×390: dos clientes de navegador y seis SDK en una sala.
Se verificó crear y compartir código, ocho miembros, Listo, inicio, cuenta atrás, las tres cámaras,
resultado, conservación de la pantalla final del otro cliente y revancha con tres vidas. Se inyectó
una demora de un segundo al solicitar revancha para comprobar que el resultado no se reabre.
Se comprobó persistencia tras recargar, cambio de polo, Ajustes y práctica con nombres visibles.
No hubo errores de página. El mismo flujo pasó sirviendo directamente jugar/, sin Vite.
Todo el flujo conserva una única escena canvas/WebGL por cliente.

Mediciones orientativas, con resolución adaptativa y ventanas cortas:

| Escenario | Draw calls observadas |
|---|---|
| Lobby con ocho miembros | 10 |
| Baja, isométrica / tercera / primera | 16 / 13 / 12 |
| Normal, isométrica / tercera / primera | 27 / 12–24 / 22 |

La diferencia entre frames en Normal depende de la actualización alternada de sombras y del culling.
Se registraron 19 geometrías y 8 texturas en Baja, 12 en Normal; tras Game.dispose, **0 geometrías y
0 texturas**. Las etiquetas no añaden llamadas de dibujo. La compilación inicial de shaders al cambiar
calidad genera picos en SwiftShader; estas muestras no representan FPS ni batería de móviles físicos.

## Reproducción y límites

```bash
npm run check
npm run build:pages
diff -qr dist jugar
npx vitest run tests/lobby.test.ts tests/lobbyClient.test.tsx tests/lobby.integration.test.ts \
  --disableConsoleIntercept
npm run server
npm run dev
```

Abrir dos navegadores: Crear sala privada → copiar código → Entrar a sala → participante Listo →
anfitrión Iniciar partida. La configuración de conexión permite indicar el servidor disponible.
GitHub Pages sigue necesitando un servidor wss:// accesible; esta fase no despliega ni contrata uno.
Los códigos identifican salas de una sola instancia y no son autenticación de cuentas. Se mantienen
las limitaciones de hardware real y memoria nativa documentadas en PHASE-8.md. La validación real
de 30 minutos permanece reservada para fase 10; no se ejecuta ni se desarrolla esa fase aquí.
