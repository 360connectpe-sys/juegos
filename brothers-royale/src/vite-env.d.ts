/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del servidor Colyseus por defecto (ws:// o wss://). */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
