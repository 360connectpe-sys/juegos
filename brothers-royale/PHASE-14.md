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

## Publicación coordinada pendiente

Render se redepliega al subir a `brothers-royale-phase-3.1`. Sin acceso al estado del
servicio ni credenciales, no es posible garantizar que no haya partidas en curso.
El entorno restringido devuelve CONNECT 403 para Render y GitHub Pages. Por ello se
prepara la actualización y se sube una rama de entrega sin activar el despliegue.
La beta pública sigue en fase 13/v9 hasta coordinar servidor y cliente.

1. Habilitar acceso a `brothers-royale-server.onrender.com`, `360connectpe-sys.github.io`
   y, si se usa el panel para desplegar, `dashboard.render.com`/`api.render.com`.
2. Coordinar ventana sin partidas y desactivar temporalmente auto-deploy si hace falta;
   subir el commit final a desarrollo sin forzar historial. No tocar `main`.
3. Desplegar Render v10 y comprobar salud/protocolo. El handshake rechaza clientes v9.
4. Copiar `jugar/` a `brothers-royale/beta/` en la rama beta, conservar el `config.js`
   de Render y chunks anteriores; no reemplazar archivos de otros juegos.
5. Publicar beta y comprobar `version.json`, manifest, SW y rutas. La PWA ofrece
   «Actualizar y jugar» fuera de partida, previa comprobación de protocolo.

URL existente: https://360connectpe-sys.github.io/juegos/brothers-royale/beta/

Commits de preparación: `b078c44` (reglas/v10), `58efe4f` (HUD), `ae6b5b8` (bundle).
Beta lista en `ea4e850`, rama `brothers-royale-phase-14-beta-ready`; desarrollo preparado
en `brothers-royale-phase-14-ready`. Build PWA: `f5e108a7c607f68c`.
Verificado por Git remoto: desarrollo sigue `2882118`, beta publicada sigue `b2024a0`,
main sigue `85dee86`. El bloqueo de red se confirmó al cerrar las comprobaciones.
