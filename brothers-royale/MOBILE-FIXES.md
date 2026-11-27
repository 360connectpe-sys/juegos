# BROTHERS ROYALE — Corrección integral de jugabilidad móvil y optimización

Rama `brothers-royale-phase-3.1`, sobre `181d2a6` (último commit confirmado). Publicación en
`brothers-royale-beta-pages` (solo `brothers-royale/beta/`). Fecha: 27 de noviembre de 2026.

## 0. Recuperación del trabajo de Codex

- Ramas remotas comprobadas: `brothers-royale-phase-3.1` = `181d2a6`; `brothers-royale-beta-pages` = `7727f17`;
  `main` = `85dee86`. El commit local de Codex **`dd705fa` no existe en ninguna rama remota**: no se pudo
  reutilizar. Todas las correcciones de este informe se implementaron desde `181d2a6`.
- Las «372 pruebas» confirmadas en remoto son las de `brothers-royale-server-deploy` (362 + 10 de despliegue);
  esa rama es independiente y no se mezcló aquí. Base de esta corrección: **362 pruebas** de `181d2a6`.
- La reducción «149 → 25 draw calls sin `WEBGL_multi_draw`» que informó Codex no estaba disponible; se
  reprodujo la causa y se implementó de nuevo (§7).

## 1. Disparo y movimiento de cámara

- `game/input/touchDrag.ts` (`TouchDrag`, puro): el **mismo dedo** que mantiene el botón de disparo/golpe gira
  la cámara (3ª y 1ª persona) o apunta (isométrica) al deslizarse. La zona derecha de la pantalla usa el mismo
  ayudante.
- Sin saltos al empezar: zona muerta de 6 px (un toque quieto no mueve la cámara) y tope de 60 px por evento
  (iOS agrupa eventos o el dedo «salta» al apoyarse).
- Sensibilidad de Ajustes: los giros pasan por `TouchSource.addLook` → `InputManager.consumeLook`, con la
  sensibilidad de cámara y la de apuntado (prueba: con la mira activada el giro escala por `aim`).
- Soltar, cancelar el toque (`pointercancel`) o perder la captura (`lostpointercapture`) detienen el disparo
  siempre y sueltan el apuntado isométrico.
- Dos dedos: joystick (caminar) + botón de disparo deslizando (girar/apuntar) a la vez. Vale igual para el hacha.

## 2. Botón de apuntado

- `TouchSource.toggleAim()`: una pulsación activa la mira y otra la desactiva; no hay que mantener.
- Con la mira activada se puede caminar, girar la cámara y disparar (el bit `AIM` se combina con los demás).
- Estado visible: anillo y color invertido (`.is-toggled`) y `aria-pressed`. Se reinicia al abrir Ajustes.

## 3. HUD de construcción

- **Eliminada la ventana central** (elegir pieza, rotar, nivel, colocar).
- Tres botones circulares pequeños a la izquierda con iconos SVG: **pared, rampa, suelo** (elemento HUD
  `construction`, editable: posición, tamaño, transparencia).
- **Mantener** = vista previa que sigue al jugador y a la cámara; **soltar** = construir una sola vez si es
  válida; cancelar el toque o soltar con colocación inválida no construye (sin colocaciones accidentales ni
  duplicadas).
- Orientación automática por la dirección de la mirada y la cuadrícula de 3 m (`rotationForYaw`): pared de
  frente, rampa subiendo hacia delante. Altura automática (§5).
- El **techo sigue en el sistema**: tecla V (y Z/X/C = pared/suelo/rampa), modo construcción con B o Y del mando
  y RB para cambiar de pieza, y el botón táctil «Construir» (alterna el modo).

## 4. Vista previa

- Válida: **marrón oscuro** semitransparente (`#5a3414`); inválida: **rojo** semitransparente (`#e02424`).
  El botón pulsado se colorea igual.
- Misma geometría que la pieza real (posición, orientación y dimensiones) en una sola malla ligera, dibujada
  encima (`renderOrder`).

## 5. Encaje perfecto de estructuras

Causas encontradas de los rechazos («posiciones válidas que rechazan el suelo»):

1. **La altura solo consideraba la misma casilla**: un suelo al final de una rampa caía al nivel del terreno.
2. **Una rampa no sostenía la casilla siguiente** y **un suelo no sostenía la rampa que arranca en su borde**:
   la reglas de soporte rechazaban cualquier cadena rampa → suelo → rampa.
3. **`grounded()` exigía terreno plano con 6 cm de tolerancia en 5 puntos**: casi cualquier ladera rechazaba el
   suelo.
4. El nivel y la rotación se elegían a mano en la ventana.

Correcciones (`shared/building/BuildingState.ts`, autoridad compartida servidor/sin conexión):

- **Soporte del extremo alto de la rampa**: sostiene la casilla siguiente; rampa o pared empiezan a su altura y
  el suelo queda **a ras** (superficie = extremo alto, sin escalón).
- **Un suelo sostiene la rampa** que arranca en su borde y sube alejándose.
- **Laderas**: la pieza se apoya en el punto más alto de su huella (hasta 1,5 m de desnivel); flotar por encima
  sigue prohibido.
- **`planBuild`** (puro, lo usa la vista previa): casilla vecina en la dirección de la mirada, rotación
  automática y, entre las alturas posibles (terreno, techo de lo que hay en la casilla, extremo de una rampa
  vecina, suelos vecinos), la primera válida empezando por la altura de los pies. Construir hacia arriba no
  requiere elegir nivel; un suelo sobre una pared se elige solo.
- Se conservan todas las validaciones (coste, límites, alcance, solapes, jugadores, paredes interpuestas,
  colapso de cadenas sin soporte) y la autoridad del servidor (revalida al colocar). Sin edición de piezas.
  Madera como único material.
- Verificado con Rapier en las **cuatro orientaciones**: rampa → suelo a ras → rampa → suelo; suelo sobre
  pared y pared sobre ese suelo; ladera; el personaje sube la rampa y pasa al suelo sin quedar atrapado.

## 6. Interfaz móvil

- Botones de combate más pequeños: ataque 78 → 66 px, acciones 66 → 54 px, saltar 86 → 72 px, correr 64 → 54 px.
- Nueva distribución de fábrica: construcción y madera en columna a la izquierda; combate en el arco del pulgar
  derecho; menú bajo el logo; **zona central despejada** (prueba: ningún elemento de fábrica en el centro).
- **«Jugar en línea» oculto durante las partidas** (para salir está «Menú principal»).
- Sin solapes medidos en 844×390 (iPhone 13), 667×375 (iPhone SE), 932×430 (Pro Max) y 800×360 (Android);
  antes había un solape menú/inventario en 667×375.
- Preferencias guardadas: los elementos que seguían en su posición de fábrica **antigua** migran a la nueva; lo
  personalizado se respeta. **Restablecer todo** aplica la nueva distribución. Áreas seguras (notch) intactas.

## 7. Rendimiento

### Causas reales investigadas

1. **`WEBGL_multi_draw` ausente (Safari iOS)**: three.js dibuja un `BatchedMesh` con **una llamada por
   instancia** si falta la extensión (y otra vez en la pasada de sombras). Afectaba a edificios con interior,
   armas en mano (alojadas en ese lote) y **cada estructura de madera** (lote de 128).
2. **Cambio de programa por frame**: el lote de edificios (`BatchedMesh`) compartía material con mallas
   normales; three.js alternaba el programa (batching sí/no) y recalculaba sus parámetros en cada frame
   (`getParameters`: 1,8 MB de basura cada 5 s).
3. **Basura por frame** (pausas del recolector): `OfflineSession` creaba objetos nuevos en cada acceso a
   `match`, `combat` y `battle` (este recorría a todos los jugadores varias veces por frame); iteradores de
   `Map`/desestructuración en bucles de render; `Set` por frame en las etiquetas de nombre; cierres y arrays
   en `rayHitbox`.
4. Descartado: el paso físico de Rapier (0,2 ms p50 con 432 colisionadores) no explica las caídas.

### Correcciones

- Estructuras: **una sola malla dinámica** (1 draw call, +1 sombra) reescrita solo al cambiar la revisión.
- Sin `WEBGL_multi_draw` (`Engine.multiDraw`): edificios con interior en **una malla fusionada**
  (`MergedInteriors`, ocultar = colapsar vértices solo al entrar/salir) y armas con **una InstancedMesh por
  modelo visible** (`InstancedHeldItems`). Con la extensión se mantiene el `BatchedMesh`.
- Material propio para el lote de edificios; vistas cacheadas en `OfflineSession` (invalidadas por tick);
  bucles sin iteradores ni `Set`/cierres por frame.
- Asignaciones (perfil de montículo, 5 s, 3ª persona disparando): **19,1 MB → 14,6 MB**; `getParameters`
  desaparece.
- Se mantienen: solo Baja y Normal, sin límite de FPS, resolución adaptativa sin cambios, simulación a 30 Hz,
  mismas físicas y condiciones en ambas calidades.

### Mediciones (Chromium + SwiftShader, 844×390, pixel ratio 1; «sin multi_draw» emula Safari iOS)

Sin conexión, 3 muñecos + **128 estructuras** + disparo continuo (draw calls máximos):

| Calidad · cámara | Sin multi_draw antes → después | Con multi_draw antes → después |
|---|---|---|
| Baja · isométrica | **146 → 16** | 15 → 15 |
| Baja · 3ª persona | **143 → 14** | 13 → 13 |
| Normal · isométrica | **286 → 24** | 23 → 23 |
| Normal · 3ª persona | **283 → 22** | 21 → 21 |

En línea, **8 jugadores** (local + 7 bots SDK disparando sin parar) + **128 estructuras**:

| Calidad · cámara | Sin multi_draw antes → después | CPU/frame p50 (sin multi_draw) | Con multi_draw antes → después |
|---|---|---|---|
| Baja · isométrica | **155 → 20** | 1,3 → 1,0 ms | 20 → 20 |
| Baja · 3ª persona | **153 → 18** | 1,4 → 1,0 ms | 18 → 17 |
| Normal · isométrica | **307 → 32** | 2,2 → 1,5 ms | 31 → 31 |
| Normal · 3ª persona | **305 → 29** | 1,9 → 1,6 ms | 28 → 28 |

- Los FPS de SwiftShader (CPU) no representan un iPhone y no se usan como conclusión.
- Normal con 8 jugadores **y** 128 estructuras queda en 28–32 (el presupuesto < 30 se definió con 6–8 jugadores
  sin estructuras); Baja queda bajo 20 en todos los casos.
- **No se declara resuelto el problema de FPS del iPhone 13 Pro sin una medición física.** La reducción de
  llamadas de dibujo (×8–×10 sin `WEBGL_multi_draw`) ataca la causa más probable de las caídas a 16 FPS en
  Safari; queda pendiente medir en el dispositivo (FPS del HUD, calidad Baja, partida con estructuras).

## 8. Validación

- **392 pruebas** en 46 archivos, todas en verde (362 previas + 30 nuevas), tipos y builds (`npm run check`).
- Nuevas: `buildFit.test.ts` (12: orientación/casilla, cadena rampa-suelo en 4 orientaciones, suelo sobre pared,
  ladera, subida física sin atascarse, superficie a ras), `mobileControls.test.tsx` (13: arrastre sin saltos,
  disparo + giro con el mismo dedo en 3ª/1ª, apuntado isométrico, cancelar/perder captura, dos dedos, mira
  conmutable y sensibilidad, teclas de construcción, migración/restablecer HUD, centro despejado),
  `mobilePerf.test.ts` (5: estructuras en una malla, edificios fusionados, armas instanciadas, vistas
  cacheadas, rayo sin basura).
- Adaptadas (la funcionalidad que probaban se eliminó por requisito): en `buildingClient.test.tsx`, la prueba
  de la ventana central ahora verifica los tres botones (mantener/soltar/cancelar) y que no hay rotar/nivel/
  colocar ni edición. El resto de pruebas previas no se modificó.
- Navegador con toques multitáctiles reales (CDP, 844×390): mantener «Pared/Rampa/Suelo» → vista previa
  marrón válida → soltar = 1 pieza y −10 de madera; casilla ocupada → roja y no construye; 3ª persona con dos
  dedos: giro 0,446 rad (80 px × sensibilidad), avance 4,2 m, 8 disparos y el disparo se detiene al soltar;
  mira: activar/desactivar con zoom de cámara. Sin errores de página.
- Modo sin conexión y multijugador (8 clientes reales) verificados en las mediciones.

## 9. Limitaciones pendientes

- Falta la medición física en iPhone 13 Pro (Safari) y en Android real.
- Normal con 8 jugadores y 128 estructuras: 28–32 draw calls.
- El techo no tiene botón táctil propio (se mantiene en el sistema: V, mando, modo «Construir»).
- La pared sigue la línea central de la casilla (formato de red y pruebas existentes); no se pueden cerrar
  cuatro paredes alrededor de un mismo suelo.
- El planificador elige la casilla vecina en la dirección de la mirada; no se puede apuntar a casillas lejanas.
