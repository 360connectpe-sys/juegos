# Fase 13 — PWA iPhone

Base de Claude: `5def706` (fase 12). Sin cambios de mecánicas; protocolo **v9**, mismo servidor Render.

- Manifest standalone e iconos PNG originales 180/192/512. Carga de marca antes y después de arrancar React; conserva horizontal y áreas seguras.
- Caché versionada del shell y todos los chunks, incluyendo los diferidos. Solo controla su carpeta; no afecta a otros juegos.
- Busca una nueva versión al abrir, recuperar foco o conexión. «Actualizar y jugar» aparece fuera de partidas, práctica, cuenta atrás y conexión. Una ventana ocupada bloquea la activación.
- No se borran ajustes ni HUD. Se conservan recursos de versiones usadas por otras ventanas. Los chunks anteriores quedan disponibles en beta para páginas web ya abiertas.
- Una futura actualización con otro protocolo necesita confirmación de `/health`; si no coincide o no puede verificarse, se aplaza. La validación de protocolo del multijugador se conserva.
- `/health` permite CORS únicamente a los orígenes autorizados del servidor, sin cambiar reglas ni formato del juego.

## Instalar gratis

Abrir **https://360connectpe-sys.github.io/juegos/brothers-royale/beta/** en Safari del iPhone → **Compartir → Añadir a pantalla de inicio → Añadir**. Abrir desde ese icono y girar a horizontal. No requiere App Store, cuenta de desarrollador ni reinstalación para futuras mejoras.

## Comprobaciones y límites

Por petición del usuario: solo tipos, builds cliente/servidor, sintaxis/rutas del SW, manifest, tamaños de iconos y ciclo básico de caché/actualización. No se ejecutaron suites completas, partidas, simulaciones multijugador, benchmarks ni pruebas prolongadas.

iOS puede ignorar el bloqueo de orientación; girar manualmente. Safari decide la pantalla nativa de lanzamiento; el juego muestra además su carga propia. La primera carga necesita internet; el multijugador siempre necesita conexión. iOS puede desalojar la caché si falta espacio. Render gratuito puede tardar en despertar.

La comprobación directa de la URL pública desde este entorno está bloqueada por el proxy (403); se comprueba por Git el payload publicado y por GitHub el estado del despliegue cuando está disponible. Instalación y jugabilidad física en iPhone pendientes del usuario.
