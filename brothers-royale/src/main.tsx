import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { loadRuntimeConfig } from './net/config';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Falta el elemento #root');
// Fase 15 (H1): la pantalla de inicio estática de index.html ya está pintada; config.js se
// espera como mucho 2,5 s y, pase lo que pase, la aplicación arranca.
void loadRuntimeConfig(2500).then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
