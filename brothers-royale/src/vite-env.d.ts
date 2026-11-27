/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del servidor Colyseus por defecto (ws:// o wss://). */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** public/config.js: configuración de despliegue editable sin recompilar. */
  BR_CONFIG?: { serverUrl?: unknown };
}
