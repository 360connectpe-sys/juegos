# Fase 14

Base: `2882118`. Solo Brothers Royale. Protocolo nuevo **v10** (anterior: v9).

HUD compacto, mapa táctil con destinos personales, SVG por arma, munición dentro de los
huecos y salida confirmada en Ajustes. Se conservan HUD personalizado, áreas seguras,
dos calidades, tres perspectivas, apuntado alternable y PWA.

Francotirador: 65 cuerpo / 100 cabeza, cinco balas, 1,5 s entre disparos, recarga 3 s,
alcance 150 m y x4 fija. Mira x2 como botín desmontable en las otras cuatro armas.
Modelos low poly compartidos, sonido sintetizado, retículas DOM y una sola cámara.
Servidor dueño de munición, daño y equipamiento; no acepta valores de daño del cliente.

Zombis: aparición 50 s, golpe cada 1,3 s, HP40/daño5/máximo8; una recompensa aleatoria
(ammo o botiquín), nunca armas ni madera. Avión -30%, paracaídas -20% y cuerda única.
Tormenta morada, mismas cinco fases. Descenso vulnerable, sin disparar/construir;
recibir daño en el aire elimina la protección al aterrizar. Solo protege el avión.

Comprobaciones: `npx vitest run tests/phase14Protocol.test.ts` (9 casos),
`npm run typecheck`, `npm run build:pages`, `npm run build:server`, `/health` local,
`node --check jugar/sw.js` y revisión de manifest/rutas/caché. No se ejecutan suites
exhaustivas, jugabilidad, multijugador ni benchmarks, por petición del usuario.
Pendiente prueba física de controles, mira, mapa y legibilidad en iPhone.

## Publicación autorizada

El usuario confirmó que no hay partidas activas y autorizó integrar los checkpoints en
las ramas existentes, aun cuando la red impida comprobar las URLs públicas.

- Desarrollo: avance directo de `brothers-royale-phase-3.1` con `64e08c1` y el checkpoint
  de publicación. El push activa el auto-deploy ya configurado de Render.
- Beta: avance directo de `brothers-royale-beta-pages` a `ea4e850`; solo seis archivos
  de Brothers Royale. Se conservan `config.js` WSS y trece chunks anteriores.
- Cliente/servidor: protocolo **v10**. PWA: build **`f5e108a7c607f68c`**.
- Commits funcionales: `b078c44`, `58efe4f`; bundle: `ae6b5b8`.
- Sin cambios de infraestructura, servicios nuevos, main ni otros juegos.

La red sigue devolviendo CONNECT 403 para Render y GitHub Pages. No se confirma desde
este entorno que Render haya terminado ni que la URL pública sirva ya la nueva versión.
El usuario hará esa comprobación manual; no se ejecutaron pruebas extensas adicionales.

Comprobar `/health.protocol=10` en https://brothers-royale-server.onrender.com/health
y protocolo 10/build `f5e108a7c607f68c` en la beta (`version.json`). La PWA ofrece
«Actualizar y jugar» fuera de partida y valida el protocolo antes de aplicar el cambio.
El handshake impide jugar con versiones distintas durante el despliegue.

URL: https://360connectpe-sys.github.io/juegos/brothers-royale/beta/
