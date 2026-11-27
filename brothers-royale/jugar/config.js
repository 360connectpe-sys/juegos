/*
 * BROTHERS ROYALE — configuración de despliegue (se puede editar SIN recompilar).
 * serverUrl: dirección del servidor multijugador, siempre wss:// desde GitHub Pages.
 * Ejemplos: 'wss://brothers-royale-server.onrender.com' o 'wss://203-0-113-7.sslip.io'.
 * Vacío = sin servidor configurado: el juego sigue funcionando sin conexión.
 * Prioridad: ?server= en la URL > este archivo > VITE_SERVER_URL al compilar.
 */
window.BR_CONFIG = { serverUrl: '' };
