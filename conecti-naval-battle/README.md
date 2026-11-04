# ⚓ CONECTI NAVAL BATTLE

**¡Domina el mar, conquista la batalla!**
Batalla naval de artillería 1 contra 1, online y por turnos, en pixel art de 8 bits, con **Conecti** (la mascota de 360 Connect) como capitán.

- Dos barcos enfrentados en vista lateral, sobre el mar de la costa de Trujillo (cerros, muelle de Huanchaco y caballitos de totora al fondo).
- **Turnos simultáneos:** en cada ronda los dos **mueven** su barco a la vez (máx. 24 px, 15 s), luego los dos **apuntan en secreto** ángulo (15°–80°) y potencia (20 %–100 %) y **disparan** (20 s). Los dos proyectiles salen juntos y el daño se aplica a la vez; si los dos barcos se hunden en la misma ronda, es **empate**.
- Proyectiles pixelados de **TikTok** e **Instagram** (misma física y daño; solo cambia el dibujo y la estela).
- Daño por zona del casco: **proa y popa −20 HP**, **centro blindado −8 HP**. Cada barco tiene 100 HP.
- Conecti en **morado #8A2BE2**, **azul #00BFFF** o **verde #32CD32**; el color del barco se elige aparte.
- Salas privadas con código `CNX-XXXX`, enlace para compartir, reconexión de 30 s, revancha.
- Funciona en computadora (teclado) y celular (botones táctiles).

---

## 0. Jugar ya, sin instalar nada

**https://360connectpe-sys.github.io/juegos/naval-battle/**

Esa es la **versión sin servidor**: funciona en GitHub Pages y usa Firebase (el mismo proyecto de Conecti Duelo) para conectar a los dos jugadores. El navegador de quien **crea la sala** ejecuta el mismo motor del servidor (`server/*.js`, empaquetado en `js/engine-bundle.js`) y es la autoridad de la partida: turnos, tiempos, física y daño. El invitado solo envía sus acciones.

Diferencias con la versión con servidor (Render):
- El anfitrión debe **mantener la página abierta y en pantalla** durante la partida. Si la recarga o la cierra, la partida termina (si el invitado se desconecta, sí puede volver en 30 s).
- Un jugador muy experto podría modificar su propio navegador si es el anfitrión; con el servidor en Render eso no es posible.

Se genera con `node scripts/build-pages.js` (copia `public/`, cambia Socket.io por `pages/net-firebase.js` y escribe el resultado en `../naval-battle/`). Después de cambiar el juego, vuelve a ejecutarlo.

## 1. Instalar y arrancar

Requisitos: **Node.js 18 o superior** (probado con Node 22).

```bash
cd conecti-naval-battle
npm install
npm start
```

Abre **http://localhost:3000**. El servidor usa `process.env.PORT` si existe.

| Comando | Qué hace |
|---|---|
| `npm install` | Instala Express y Socket.io (y `socket.io-client` para las pruebas). |
| `npm start` | Inicia el servidor (`node server.js`). |
| `npm test` | Corre las pruebas automáticas (física, colisiones, salas y una partida por red). |

### Variables de entorno (ver `.env.example`)

| Variable | Por defecto | Uso |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP (Render/Railway lo ponen solos). |
| `MOVE_MS` | `15000` | Tiempo de movimiento por turno. |
| `AIM_MS` | `20000` | Tiempo para apuntar y disparar. |
| `RESOLUTION_MS` | `1800` | Pausa para mostrar el resultado del disparo. |
| `START_DELAY_MS` | `2500` | Cuenta de inicio de cada partida. |
| `RECONNECT_MS` | `30000` | Tiempo para volver tras una desconexión. |
| `EMPTY_ROOM_MS` | `60000` | Si se van los dos, la sala se borra después de este tiempo. |
| `CORS_ORIGIN` | (vacío) | Solo si sirves la página desde otro dominio. |

El servidor lee `process.env` directamente (no hace falta instalar `dotenv`).

---

## 2. Probar con dos jugadores en tu computadora

1. `npm start`
2. Abre `http://localhost:3000` en **dos navegadores distintos** (por ejemplo Chrome y Firefox, o una ventana normal y una de incógnito). Dos pestañas del mismo navegador comparten la sesión guardada; usa navegadores o perfiles distintos.
3. En el primero: escribe tu nombre, elige colores y toca **CREAR PARTIDA**.
4. Copia el enlace (**COPIAR ENLACE**) y ábrelo en el segundo, o toca **UNIRSE A PARTIDA** y escribe el código.
5. Los dos tocan **¡ESTOY LISTO!**.

**Desde tu celular en la misma red wifi:** busca la IP de tu computadora (por ejemplo `192.168.1.20`) y abre `http://192.168.1.20:3000` en el teléfono.

### Controles

| Fase | Computadora | Celular |
|---|---|---|
| Movimiento | `A`/`←` izquierda · `D`/`→` derecha · `Espacio` confirmar | ◀ ▶ (mantener) · CONFIRMAR |
| Ataque | `↑`/`↓` ángulo · `←`/`→` potencia · `1` TikTok · `2` Instagram · `Espacio` disparar | Barras y botones − + · TikTok/Instagram · ¡DISPARAR! |

---

## 3. Publicarlo gratis en internet (Render)

Condiciones del plan gratis de Render según su documentación oficial (revisada en noviembre de 2026; pueden cambiar):
- Un servicio web gratis **se duerme tras 15 minutos sin tráfico** y tarda **alrededor de 1 minuto en despertar** con la siguiente visita.
- Hay **750 horas gratis al mes** por cuenta (alcanza para un servicio encendido todo el mes).
- Render puede reiniciar el servicio en cualquier momento. Las salas viven en memoria, así que un reinicio corta las partidas en curso.

### Pasos

1. Crea una cuenta en **render.com** (puedes entrar con tu cuenta de GitHub).
2. **New → Blueprint**, elige el repositorio **`360connectpe-sys/juegos`**. Render lee el archivo `render.yaml` de la raíz y configura todo solo (carpeta `conecti-naval-battle`, `npm install`, `npm start`, plan Free).
   - Si prefieres hacerlo a mano: **New → Web Service** → repositorio `juegos` → **Root Directory:** `conecti-naval-battle` → **Build:** `npm install --omit=dev` → **Start:** `npm start` → **Instance type:** Free.
3. Espera a que diga **Live**. Tu juego queda en una dirección como `https://conecti-naval-battle.onrender.com`.
4. Comparte ese enlace. Al crear una sala, el botón **COPIAR ENLACE** genera `https://…/?sala=CNX-XXXX`, que lleva directo a la sala.

> **Consejo:** como el servidor gratis se duerme, abre el enlace un minuto antes de jugar para despertarlo.

### Railway (alternativa)
Railway da un **crédito de prueba único de 5 USD** (30 días). Después pasa a un plan gratis muy limitado o al **plan Hobby de 5 USD al mes**. Pasos: **New Project → Deploy from GitHub repo → `juegos`**, en *Settings* pon **Root Directory** `conecti-naval-battle` y **Start Command** `npm start`, y en *Networking* genera un dominio público. Verifica los precios vigentes en railway.com/pricing.

---

## 4. Arquitectura

```
conecti-naval-battle/
├── server.js                 Express (sirve el juego) + Socket.io (eventos validados y con límite de frecuencia)
├── server/
│   ├── rooms.js              Salas de 2, códigos CNX-XXXX, tokens de reconexión, abandono, limpieza
│   ├── turns.js              Máquina de estados y temporizadores (autoridad del servidor)
│   ├── gameState.js          Estado de la partida y versión pública (sin tokens)
│   ├── physics.js            Trayectoria parabólica con paso fijo (60 Hz) y sub-muestreo
│   ├── collisions.js         Casco, zonas en coordenadas locales y daño
│   └── validation.js         Tipos, rangos, saneo de nombres, límite de frecuencia
├── shared/constants.js       Constantes comunes (servidor y navegador)
├── public/
│   ├── index.html · css/style.css
│   ├── js/renderer.js        Canvas 480×270: mar, barcos, Conecti, proyectiles, explosiones
│   ├── js/main.js            Flujo del cliente (solo muestra lo que decide el servidor)
│   ├── js/network.js · controls.js · ui.js · audio.js
│   └── assets/sprites/sprites.js   Sprites de Conecti, TikTok, Instagram y bandera (reemplazables)
└── tests/                    physics · collisions · rooms · multiplayer (servidor real + 2 clientes)
```

**Máquina de estados (turnos simultáneos):** `LOBBY → WAITING → MOVEMENT → AIMING → PROJECTILE → RESOLUTION → NEXT_TURN → … → GAME_OVER` (más `PAUSED` si alguien se desconecta). `MOVEMENT` termina cuando los dos confirman o a los 15 s; `AIMING` cuando los dos disparan o a los 20 s (quien no disparó pierde ese tiro). Mientras apuntan, el rival solo ve que ya disparaste (`locked`), nunca tu ángulo ni tu potencia: el servidor guarda los disparos en secreto y los lanza juntos (evento `shots`).

**El servidor es la única autoridad** sobre posición, turnos, tiempos, física, colisiones, daño, vida, victoria y desconexiones. El cliente envía solo intenciones (`move {dx}`, `endMove`, `aim`, `fire {angle, power, projectile}`); si manda valores de daño o vida, se ignoran. El disparo se simula completo en el servidor y se envía la trayectoria ya calculada (`shot`), así los dos teléfonos ven exactamente lo mismo.

**Física:** `vx = v·cos θ`, `vy = v·sin θ`, `x = x0 + vx·t`, `y = y0 − vy·t + ½·g·t²`, con `v = potencia × 235 px/s` y `g = 120 px/s²`, paso fijo de 1/60 s y 3 sub-pasos de colisión. El proyectil sale de la boca real del cañón, puede caer al agua, salir del mapa o golpear incluso al propio barco.

**Seguridad:** códigos con `crypto.randomInt` (32⁴ combinaciones, sin letras confusas), tokens de 24 bytes aleatorios comparados en tiempo constante, nombres saneados, mensajes de máx. 4 KB, límite de frecuencia por conexión y por tipo de evento, sin disparos duplicados ni acciones fuera de fase, y nadie puede tomar el lugar de un jugador desconectado sin su token.

---

## 5. Pruebas realizadas

### Automáticas (`npm test`) — 32 de 32 pasan
- **Física (10):** sale de la boca del cañón, es determinista, la caída al agua coincide con la fórmula de la parábola (±1,5 px), más potencia llega más lejos, el ángulo cambia la altura, se puede dar en proa/popa/centro con su daño, autoimpacto, tiro al agua sin daño, salida del mapa, duración del vuelo.
- **Colisiones (5):** tamaño del casco, zonas para cada orientación, zonas que se mueven con el barco, bordes del casco.
- **Salas y turnos (15):** formato y unicidad de códigos, tercer jugador rechazado, una conexión no ocupa dos lugares, validación de entradas, límite de frecuencia, reconexión solo con token, sorteo del primer turno, movimiento solo del jugador activo, presupuesto de 24 px sin recuperarse yendo y viniendo, límites de zona, tiempo agotado en movimiento y en ataque, disparo solo en fase y una vez, −20 en proa, −8 en centro, vida nunca bajo 0, pausa/reanudación/abandono, borrado de sala vacía, revancha.
- **Partida por red (2):** servidor real + 2 clientes Socket.io: crear, unirse, tercero rechazado, nombres saneados, tokens nunca enviados, movimiento sincronizado, mira visible para el rival, daño enviado por el cliente ignorado, misma trayectoria en ambos, reconexión con token y victoria por abandono; además `/health` y archivos estáticos.

### De punta a punta con navegadores (Playwright, en el servidor local)
Se jugó una partida completa entre **dos navegadores Chromium independientes** (uno de escritorio con teclado y otro emulando un **Pixel 7** con toques), sin errores en consola:
creación de sala, entrada por enlace `?sala=`, tercer jugador rechazado, colores elegidos visibles, movimiento con teclado y con botones táctiles, ajuste de ángulo/potencia/proyectil, disparos con impactos críticos (−20) y fallos al agua, barras de vida sincronizadas, cambio de turnos, fin de partida (victoria en uno y derrota en el otro), revancha aceptada por los dos con vida y posiciones reiniciadas, y reconexión automática al recargar la página.

### Guía de pruebas manuales (multijugador real)
1. Dos dispositivos distintos (celular + computadora) entran a la misma sala.
2. Un tercer dispositivo intenta entrar → "Esa sala ya está llena".
3. Durante el turno rival, los botones de mover/disparar no aparecen.
4. Mantén ◀ hasta agotar el motor: se detiene en 24 px y pasa a ataque.
5. Deja correr los 15 s de movimiento y los 20 s de ataque: pasa solo al ataque y luego al rival.
6. Pega en proa (−20), centro (−8) y falla al agua (sin daño).
7. Apaga el wifi de un teléfono 10 s y vuelve a prenderlo → se reconecta y la partida sigue.
8. Ciérralo por más de 30 s → el otro gana por abandono.
9. Termina una partida y pidan revancha los dos.

---

## 6. Limitaciones conocidas
- **Las salas viven en memoria** de una sola instancia: si el servidor se reinicia (o Render lo duerme), se pierden las partidas en curso. Es lo esperado para el MVP.
- En Render gratis, la **primera visita tras 15 min sin uso tarda ~1 minuto**.
- No se probó todavía en **teléfonos físicos** ni en **Safari de iPhone real** (solo emulación en Chromium); tampoco el despliegue en Render (desde este entorno no hay acceso a internet público).
- La reconexión guarda la sesión en el navegador: si se borra el almacenamiento o se cambia de navegador, no se recupera el lugar.
- Los íconos de TikTok e Instagram son referencias pixeladas; su uso público o comercial debe respetar las normas de marca de cada empresa (se cambian en `public/assets/sprites/sprites.js`).
- Sin viento ni obstáculos: el reto está en ángulo, potencia y posición.

## 7. Ideas para la versión 2.0
- Guardar salas en Redis para varias instancias y sobrevivir reinicios.
- Viento variable por turno, olas que mueven el barco y obstáculos (rocas, boyas).
- Más proyectiles con efectos distintos (WhatsApp, Google) y mejoras desbloqueables.
- Ranking por temporada y perfiles de capitán.
- Modo espectador y torneos para eventos de 360 Connect.
- Sprite oficial de Conecti hecho por la marca y música chiptune original.
- Modo práctica contra la computadora.
