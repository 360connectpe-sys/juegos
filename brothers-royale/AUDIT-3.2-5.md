# Auditoría integral de fases 3.2, 4 y 5

Repositorio 360connectpe-sys/juegos, rama brothers-royale-phase-3.1. Revisión de 5103899 comparada con 5da1a88, el 26 de noviembre de 2026. Las 223 pruebas originales pasaron antes de modificar código. Se conserva la arquitectura de Claude, el modo offline y las mecánicas existentes.

**Errores encontrados y correcciones**

| Gravedad | Fallo | Corrección y regresión |
|---|---|---|
| Alta | La tolerancia de visión de 0,6 m permitía ignorar una pared cercana al objetivo y recoger a través de ella. | Tolerancia reducida a 2 cm. Solo se excluye el collider marcado del cofre que contiene el punto objetivo. Prueba con Rapier verifica cofre visible y pared interpuesta a 40 cm del objetivo. La cámara conserva sus colisiones. |
| Media | La validación del inventario admitía claves heredadas de Object, cantidades excesivas, munición en huecos, hachas adicionales y rarezas desconocidas. | Pertenencia propia al catálogo, límites por tipo y bolsa, hacha única y rarezas reconocidas. Regresiones con constructor, __proto__, toString y cantidades malformadas. El servidor sigue siendo la única autoridad online. |
| Media | La validación de pickups admitía ids negativos, cantidades superiores al stack y rarezas desconocidas. | Id entero seguro positivo, cantidad limitada por catálogo y rareza reconocida. Regresión de mensajes malformados. |
| Media | Una bienvenida sin inventario válido conservaba el inventario anterior en la réplica. | La carga completa limpia el inventario cuando los datos son inválidos. Regresión de reemplazo de sesión. |
| Media | Dar de alta dos veces el mismo id en MatchState reemplazaba el inventario y perdía objetos. | Alta idempotente. Regresión de conservación de munición. ServerWorld mantiene su rechazo de jugadores duplicados. |
| Media | Engine.dispose liberaba geometrías y materiales pero no las texturas internas de BatchedMesh. | Llama a BatchedMesh.dispose y evita liberar otra vez su geometría. Regresión directa y verificación GPU en Chromium. |
| Media | AdaptiveResolution.reset conservaba el refresco más rápido de otra sesión o pantalla. | Reinicia el estimador de refresco y la transición pendiente. Regresión de cambio de 120 a 30 Hz. |
| Media | El HUD limitaba el centro, permitiendo recortar parte del control fuera del área segura. | Mide elemento y área con ResizeObserver, limita el centro con la mitad de su tamaño escalado y ajusta visualmente la escala si el elemento completo no cabe. Mantiene los valores persistidos y la opacidad. Regresión y prueba de navegador al 180%. |
| Media | Las flechas sobre sliders del editor movían el HUD además de operar sobre el campo. | Respeta las teclas nativas de input, select y textarea. Regresión de slider seguido de Guardar. |
| Media | El acceso a localStorage en los parámetros por defecto del HUD podía lanzar SecurityError antes del try/catch. | Reutiliza safeStorage de ajustes. Regresión de lectura, guardado y reset con almacenamiento bloqueado. |

**Áreas verificadas**

- Generación determinista del terreno, casas, árboles y cofres con RNG independientes y asentamiento de viviendas, mediante las pruebas existentes de mundo y botín.
- Interacciones basadas en posición autoritativa, límites horizontal y vertical, visión, flanco INTERACT y procesamiento serial. La integración de seis clientes verifica un solo ganador por cofre y conservación de totales al recoger, intercambiar y salir.
- Se añadió una reconexión real por corte de WebSocket que conserva la identidad, el mismo inventario servidor y los totales sin copias en el suelo.
- Protocolo v4. La integración rechaza explícitamente clientes v3. Permanecen las cuotas, rechazo de tipos desconocidos, validación de números, secuencias y botones, límite de ocho jugadores y reservas de reconexión.
- Persistencia, tamaños, transparencia, controles táctiles, edición y áreas seguras mediante la suite HUD y regresiones. En Chromium se recorrieron 1ª, 3ª e isométrica y ambas calidades.
- Dos dedos reales emulados por CDP movieron al personaje y saltaron simultáneamente. La posición pasó de aproximadamente (2,50; 7,50) a (4,41; 5,66), con locomoción jump.
- Se forzó WEBGL_lose_context. Los estados fueron lost y restored, la sesión siguió connected y el render se recuperó.

**Gráficos con ocho jugadores, casas y botín**

Chromium headless, SwiftShader, viewport horizontal 844×390. Siete clientes SDK adicionales y un cliente visual, nueve casas generadas y 46 objetos en el suelo creados mediante MatchState en una fixture de servidor. Las muestras de FPS son ventanas cortas del renderer y no un benchmark de un celular físico.

| Calidad y cámara | FPS observado | Draw calls | Triángulos | Pixel ratio |
|---|---|---|---|---|
| Baja isométrica | 42 | 15 | 20.674 | 0,90 |
| Baja tercera | 50 | 19 | 21.846 | 0,75 |
| Baja primera | 60 | 18 | 21.530 | 0,55 |
| Normal isométrica | 15 | 14 | 20.578 | 1,00 |
| Normal tercera | 22 | 30 | 32.702 | 0,75 |
| Normal primera | 38 | 28 | 32.230 | 0,70 |

Las muestras normales tienen frustum culling. Para medir el coste completo se forzó otro frame con los ocho avatares agrupados y el culling de lotes desactivado.

| Calidad | Draw calls con todos visibles | Triángulos |
|---|---|---|
| Baja | 20 | 22.886 |
| Normal | 31 | 34.266 |

**Recursos y memoria de navegador**

Después de 3, 6 y 9 ciclos online/offline y Baja/Normal quedaron 20 geometrías y 5 texturas en los tres casos. El heap tras GC fue de 59.865.667, 56.270.771 y 56.748.414 bytes. No hubo errores de página. Al destruir Game quedaron 0 geometrías y 0 texturas. Las texturas activas incluyen esqueletos y lotes, por lo que no se espera cero durante una partida.

La prueba HUD persistió salto en x=0,98, y=0,98, escala 1,8 y opacidad 0,35. El rectángulo final en 844×390 fue aproximadamente x=692,79, y=238,79 y 151,20×151,20, dentro del viewport.

**Validación y reproducción**

- npm run check comprueba tipos, suite completa y builds de cliente y servidor.
- npm run build:pages y diff -qr dist jugar verifican el bundle completo.
- BR_SOAK_SECONDS=610 ./node_modules/.bin/vitest run tests/audit.integration.test.ts -t 'sostiene 8 clientes' --disableConsoleIntercept --reporter=verbose ejecuta la carga prolongada. Envía movimiento, salto e interacción y coloca a los ocho participantes junto al mismo cofre exterior al inicio.
- Las nuevas regresiones están en auditFinal.test.ts y hudSafe.test.tsx, junto con la ampliación de match.integration.test.ts y server.integration.test.ts.

**Limitaciones pendientes**

- SwiftShader no representa una GPU móvil. Se requieren mediciones sostenidas en celulares físicos, notch real, temperatura y consumo energético.
- La muestra corta de Normal isométrica obtuvo 15 FPS. El ajuste adaptativo reduce resolución, pero el objetivo de rendimiento de dispositivos reales sigue pendiente de validación.
- El frame completo de Normal usa 31 draw calls y supera en uno el objetivo de menos de 30 de la escena de referencia. Se conserva el modelo de render y la apariencia existentes.
- El refresco se estima a partir de tiempos RAF. No puede distinguir perfectamente un navegador limitado a 30 Hz de una GPU que solo consigue 30 FPS.
- Los ciclos y los diez minutos no descartan fugas lentas durante horas. El historial de predicción sigue limitado a 128 entradas y puede corregir con un salto tras retrasos largos.
- No se probaron pérdida IP real, redes móviles, proxies TLS ni despliegue público. Las salas continúan anónimas y la protección global contra creación masiva de salas sigue pendiente.

**Resultado final de la carga prolongada**

| Medida | Resultado |
|---|---|
| Duración | 609.999 s, más de diez minutos |
| Clientes / desconexiones | 8 / 0 |
| Ticks / snapshots por cliente | 18300 / 18300 |
| Frecuencia media | 30.00005 Hz |
| Paso de simulación p50 / p95 / máximo | 0.577 / 1.141 / 190.450 ms |
| Intervalo entre ticks p95 | 33.985 ms |
| Tráfico saliente total | 126687 bytes/s |
| Cola máxima / límite | 8 / 12 |
| Buffer máximo al muestrear | 0 bytes |

El pico de 190,45 ms supera el presupuesto de 33,33 ms de un tick. El bucle recuperó la deuda y la frecuencia media terminó en 30 Hz. El entorno compartió máquina con compilaciones y pruebas de navegador, por lo que la muestra no aísla la causa del pico. No se promete que cada tick cumpla el presupuesto.

El proceso de carga incluye servidor, ocho clientes SDK e instrumentación. Sin forzar GC, el heap pasó de 35,07 MB iniciales a 32,83 MB en la muestra del segundo 600, con oscilaciones intermedias. El RSS pasó de 158,95 MB a 173,74 MB, con máximo muestreado de 191,50 MB durante el calentamiento. No hay crecimiento monotónico del heap en esta ventana.

**Cierre**

Las 223 pruebas existentes se conservaron. Resultado final de la suite completa, 237 pruebas aprobadas en 26 archivos. La selección prolongada ejecutó además su escenario durante 610 segundos. Tipos, build del cliente, build del servidor y build de Pages aprobados. El árbol completo de jugar coincide con dist. Las correcciones se limitan a brothers-royale.
