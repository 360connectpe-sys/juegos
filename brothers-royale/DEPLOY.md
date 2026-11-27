# BROTHERS ROYALE — Despliegue del servidor multijugador

Rama: `brothers-royale-server-deploy` (sobre `181d2a6`). Nada de esto toca `main`, el HUD, la construcción ni
los controles de combate. El modo sin conexión sigue funcionando igual con o sin servidor.

## 1. Resumen y recomendación

| Opción | Coste | WSS | Región más cercana a Perú | Latencia estimada desde Lima* | Siempre encendido | Tarjeta |
|---|---|---|---|---|---|---|
| **Oracle Cloud Always Free** (VM + Docker + Caddy) | 0 (dentro de Always Free) | Sí, Caddy + Let's Encrypt | **Santiago, Chile** (`sa-santiago-1`) | **~20–40 ms** | Sí | Sí (verificación, sin cobro) |
| **Render Free** (Docker) | 0 | Sí, automático | Virginia (EE. UU.) | ~100–150 ms | **No**: se duerme tras 15 min sin uso; despertar ≈ 1 min | No |
| Google Cloud Run | Capa gratuita | Sí | Santiago | ~20–40 ms | No (escala a 0) | Sí (cuenta de facturación) |
| Fly.io | Sin capa gratuita permanente (crédito de prueba) | Sí | São Paulo | ~40–70 ms | Sí | Sí |
| Koyeb | Capa gratuita incierta en 2026 | Sí | Washington / Frankfurt | ~120 ms+ | No (duerme) | Según plan |

\* Estimaciones a partir de tablas públicas de latencia entre ciudades (p. ej. Lima–Santiago ≈ 22 ms de ida y
vuelta en la tabla de EdgeUno); **no se midieron desde Perú**. Tras desplegar, mide la real (§7).

**Recomendación**
1. **Principal: Oracle Cloud Always Free en Santiago.** Es la única opción gratuita, siempre encendida y en
   Sudamérica. Ojo: la región «de origen» se elige al registrarse y **no se puede cambiar**; elige
   *Chile Central (Santiago)*. A veces no hay capacidad Ampere A1 en la región: reintenta o usa la forma
   `VM.Standard.E2.1.Micro` (también Always Free, más modesta: `MAX_ROOMS=2`).
2. **Alternativa rápida (sin tarjeta): Render Free en Virginia.** Para probar en minutos. Peor latencia y se
   duerme: la primera conexión tras un rato inactivo tarda ~1 min (el juego lo despierta solo, §5).
3. Descartadas por ahora: Cloud Run (exige facturación; las salas viven en memoria y el escalado a cero o a
   varias instancias rompe las partidas), Fly.io y Railway (sin gratis permanente), Koyeb (incierto).

> No contrates ni actives nada de pago: en Oracle crea solo recursos marcados «Always Free eligible» y pon una
> alerta de presupuesto de 1 USD (Billing → Budgets) por si acaso.

## 2. Arquitectura actual del servidor (revisión)

- **Proceso único Node 22** con Colyseus 0.18 (`server/index.ts`) y transporte WebSocket. Rutas HTTP:
  `/matchmake/*` (emparejamiento de Colyseus) y `GET /health` (nuevo, para el alojamiento).
- **Sala `brothers`** (`BrothersRoom`): una por código (`filterBy(['code'])`), **máximo 8 jugadores**
  (`NET.maxPlayersPerRoom`, no configurable por entorno). Cada sala simula su propio `ServerWorld` (Rapier) a
  30 Hz: autoritativo para movimiento, cofres, combate, construcción, tormenta, vidas y lobby. Protocolo v8.
- **Estado en memoria**: nada se persiste. Reiniciar el proceso termina las partidas en curso. Por eso hay que
  usar **una sola instancia** (no escalar horizontalmente ni dejar que el alojamiento mueva conexiones).
- **Reconexión** 15 s, ping cada 3 s, límites de mensajes y entradas (anti-trampas), reservas acotadas.
- **Coste medido** (fase 6, 8 jugadores disparando): paso de simulación p50 0,66 ms / p95 1,05 ms en una CPU
  de escritorio; red ≈ 9 KB/s por cliente. En la instancia gratuita de Render (0,1 CPU) caben pocas salas.
- **TLS (wss://)**: el servidor habla HTTP/WS plano en `PORT`; el certificado lo pone el alojamiento (Render)
  o Caddy (Oracle). Desde GitHub Pages (https) el navegador **exige** `wss://`.

Cambios de esta rama para desplegar (sin tocar jugabilidad):
- `server/config.ts`: configuración por entorno validada (§4).
- `server/index.ts`: `GET /health`; CORS del emparejamiento y handshake WebSocket limitados a
  `ALLOWED_ORIGINS` (otra web no puede abrir partidas desde el navegador de un visitante); sin banner.
- `server/capacity.ts` + `BrothersRoom`: límite de salas simultáneas `MAX_ROOMS`; al superarlo, el jugador
  recibe «El servidor está lleno ahora mismo…» (código 4105) y las salas existentes siguen igual.
- Cliente (`src/net/config.ts`, `public/config.js`, `index.html`): la URL del servidor se lee de
  `config.js` **sin recompilar**; antes de unirse se «despierta» el servidor (GET `/health`, hasta 75 s);
  los errores de red del navegador se muestran en español.
- `Dockerfile` (multiarquitectura amd64/arm64, usuario sin privilegios, chequeo de salud),
  `render.yaml` (Blueprint de Render), `deploy/oracle/` (Docker Compose + Caddy + script de la VM).

## 3. Probar en local (opcional)

```bash
cd brothers-royale
npm ci
npm run server                                  # ws://localhost:2567, sin restricciones de origen
curl http://localhost:2567/health
# Imagen de producción:
docker build -t brothers-royale-server .
docker run --rm -p 2567:2567 -e ALLOWED_ORIGINS=http://localhost:5173 brothers-royale-server
```

## 4. Variables de entorno del servidor

| Variable | Defecto | Uso |
|---|---|---|
| `PORT` | `2567` | Puerto HTTP/WS. Render lo fija solo (no lo toques allí). |
| `HOST` | `0.0.0.0` | Interfaz de escucha. |
| `ALLOWED_ORIGINS` | *(vacío = todos)* | Orígenes web permitidos, separados por comas. Producción: `https://360connectpe-sys.github.io`. Para probar también desde el ordenador: añade `,http://localhost:5173`. |
| `MAX_ROOMS` | `8` | Salas simultáneas (de 8 jugadores). Render Free: `2`. Oracle A1: `6`. E2.1.Micro: `2`. |
| `NODE_ENV` | `production` (imagen) | — |
| `BR_BENCH_LOADOUT` | — | **Solo pruebas de carga. Nunca en producción** (el servidor se niega a arrancar). |

No hay secretos: ninguna variable es una contraseña ni una clave.

## 5. Opción A — Render Free (la más rápida, sin tarjeta)

1. Entra en <https://render.com> con tu cuenta de GitHub y autoriza el repositorio `360connectpe-sys/juegos`.
2. **New → Blueprint** → elige el repositorio y la rama `brothers-royale-server-deploy`.
   En **Blueprint file path** escribe `brothers-royale/render.yaml` (el `render.yaml` de la raíz es de otro
   juego y no se toca).
3. Revisa el servicio `brothers-royale-server` (plan **Free**, región **Virginia**, runtime Docker) y pulsa
   **Apply**. La primera construcción tarda unos minutos.
4. Cuando esté «Live», copia la URL (`https://brothers-royale-server-XXXX.onrender.com`) y comprueba
   `https://…onrender.com/health` → `{"ok":true,…}`.
5. La URL del juego es la misma con `wss://`: `wss://brothers-royale-server-XXXX.onrender.com`. Sigue en §7.

Límites del plan Free: 512 MB, 0,1 CPU, 750 h/mes, se duerme tras 15 min sin peticiones ni mensajes WebSocket
(una partida en curso lo mantiene despierto) y despertarlo tarda ~1 min: el juego espera hasta 75 s antes de
unirse, así que el primer jugador verá «Conectando…» un rato.

## 6. Opción B — Oracle Cloud Always Free en Santiago (recomendada para jugar desde Perú)

1. **Cuenta**: regístrate en <https://www.oracle.com/cloud/free/> y elige como *Home Region*
   **Chile Central (Santiago)**. Te pedirán tarjeta solo para verificar identidad; no actives «Upgrade to Pay As
   You Go» si quieres coste cero.
2. **VM**: Compute → Instances → Create instance.
   - Imagen: **Canonical Ubuntu 24.04** (o 22.04).
   - Forma: **VM.Standard.A1.Flex** (Ampere, Always Free) con **1 OCPU y 6 GB** (dentro del límite
     gratuito). Si dice «Out of capacity», reintenta más tarde o usa **VM.Standard.E2.1.Micro**.
   - Red: VCN por defecto con **IP pública**. Descarga la clave SSH.
3. **Abrir puertos en Oracle**: en la VCN → Subnet → *Security List* → *Add Ingress Rules*: origen
   `0.0.0.0/0`, TCP, puertos **80** y **443** (el 80 lo necesita Let's Encrypt).
4. **Preparar la VM** (por SSH, `ssh ubuntu@IP_PUBLICA`):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/360connectpe-sys/juegos/brothers-royale-server-deploy/brothers-royale/deploy/oracle/setup-vm.sh -o setup-vm.sh
   bash setup-vm.sh
   ```
   Instala Docker, abre 80/443 en el cortafuegos interno de la VM y clona la rama.
5. **Dominio y certificado**: sin dominio propio usa **sslip.io** (gratis, sin registro): si la IP es
   `203.0.113.7`, el dominio es `203-0-113-7.sslip.io`. Edita `juegos/brothers-royale/deploy/oracle/.env`:
   ```
   DOMAIN=203-0-113-7.sslip.io
   ALLOWED_ORIGINS=https://360connectpe-sys.github.io
   MAX_ROOMS=6
   ```
   (Alternativa con nombre fijo: un subdominio gratis de DuckDNS apuntando a la IP.)
6. **Arrancar**:
   ```bash
   cd juegos/brothers-royale/deploy/oracle
   sudo docker compose up -d --build
   sudo docker compose logs -f        # Caddy obtiene el certificado en ~1 min
   ```
7. Comprueba `https://203-0-113-7.sslip.io/health`. La URL del juego es `wss://203-0-113-7.sslip.io`.

**Mantenimiento**: actualizar = `cd juegos && git pull && cd brothers-royale/deploy/oracle && sudo docker
compose up -d --build`. Reinicio automático tras caídas o reinicios de la VM (`restart: unless-stopped`).
Oracle puede reclamar VMs Always Free «inactivas» (CPU muy baja durante semanas): jugar con regularidad lo evita.

## 7. Conectar GitHub Pages con el servidor

La beta publicada (`https://360connectpe-sys.github.io/juegos/brothers-royale/beta/`) se construyó antes de
esta rama, pero ya acepta el parámetro `?server=`. **Prueba inmediata** sin tocar nada:

```
https://360connectpe-sys.github.io/juegos/brothers-royale/beta/?server=wss://TU-SERVIDOR
```

**Configuración permanente** (con las mejoras de esta rama: `config.js`, despertar y mensajes en español):

1. En esta rama: `cd brothers-royale && npm ci && npm run build:pages` (genera `jugar/` con `config.js`).
2. Edita `jugar/config.js`: `window.BR_CONFIG = { serverUrl: 'wss://TU-SERVIDOR' };`
3. Copia el contenido de `jugar/` a la carpeta publicada `brothers-royale/beta/` de la rama
   `brothers-royale-beta-pages` (la que sirve Pages), haz commit y push a **esa** rama. Nunca a `main`.
4. En adelante, cambiar de servidor = editar solo `brothers-royale/beta/config.js` en esa rama (sin
   recompilar). Ojo: `npm run build:pages` vuelve a dejar `config.js` vacío; repite el paso 2 tras compilar.

Prioridad de la URL en el cliente: `?server=` > `config.js` > `VITE_SERVER_URL` (al compilar) > mismo host:2567.
Sin servidor configurado o si no responde, el menú y «Practicar sin conexión» funcionan igual.

**Comprobación final** (desde el iPhone y otro dispositivo): abrir la beta → «Crear sala» → compartir el código
→ el otro «Entrar a sala» → ambos ven 2/8. Latencia: `curl -w '%{time_connect}\n' -o /dev/null -s
https://TU-SERVIDOR/health` desde Perú, o el RTT que muestra el panel en línea.

## 8. Seguridad y operación

- El servidor es autoritativo (movimiento, combate, construcción, botín): el cliente nunca decide resultados.
- `ALLOWED_ORIGINS` impide que otra web use tu servidor desde el navegador de sus visitantes; un programa
  propio podría conectarse igualmente (no lleva Origin), pero sigue sometido a todas las validaciones.
- `MAX_ROOMS` acota CPU y memoria; el máximo de 8 jugadores por sala es fijo.
- Sin datos personales: solo nombre visible y color, en memoria. `/health` no expone jugadores.
- Logs: Render → pestaña *Logs*; Oracle → `sudo docker compose logs -f server`.

## 9. Verificación hecha en esta rama

- `npm run check`: tipos, todas las pruebas (incluye `tests/deploy.test.ts`: configuración, orígenes, CORS,
  handshake WebSocket rechazado desde otro origen, `/health`, límite de salas y liberación, URL de
  `config.js`, despertar y mensajes de error) y builds de cliente y servidor.
- Imagen Docker construida y ejecutada: `/health` correcto, bienvenida real con el SDK (protocolo 8, 8 plazas),
  WebSocket desde otro origen → 401, proceso sin root. `docker compose config` y `caddy validate` correctos.
- Navegador (iPhone 13 emulado): página servida con `config.js` apuntando a un servidor con orígenes
  restringidos → «Crear sala» → sala privada 1/8; desde un origen no permitido → aviso y el juego sigue
  sin conexión.
- No verificado (requiere tus cuentas): despliegue real en Render/Oracle, certificado de Let's Encrypt y
  latencia real desde Perú.
