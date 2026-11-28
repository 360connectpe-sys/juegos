# Fase 15.1 — preparada para revisión física y despliegue coordinado

Base: desarrollo `498abb9`, código publicado `f900c76`, beta `00ab6a7`. Protocolo **v11**.

- Mapa del escenario con zoom/pan/pellizco/rueda y destinos personales protegidos de gestos.
  Sin ubicación de rivales, muñecos ni aviones ajenos. Casas giradas, caminos, relieve, agua,
  bosques y sectores de la semilla real; cartografía base estática reutilizada de 768 px (minimapa: 320 px).
- Pelo que cubre la coronilla, rodillas/tobillos procedurales y agachado con caída visual de
  0,55 m, igual al estado existente. Un solo mesh por avatar, diez huesos, sin sombras.
- Rampas desde la casilla propia cuando caben; contacto perimetral conservado, validación
  de cápsulas y soporte en servidor, suelos a ras del extremo alto. No admite atravesar al
  jugador: hay que dejar espacio válido. Puertas/ventanas mantienen paneles fijos al hueco.
- Giro táctil personalizable durante selección; T y LB+Y. Resistencia temporal de 3 s,
  cuatro barras reutilizadas y oclusión física. Grietas en cuatro niveles y misma malla/material
  de estructuras; el cambio de madera o HP dentro del mismo nivel no reconstruye su geometría.
- Seis modelos de armas renovados, miras/rarezas/estadísticas intactas. Fogonazo existente más
  visible y alineado; pools fijos de efectos, ninguna luz dinámica.
- Audio: desconexión de nodos completados y al salir, conservando desbloqueo/reanudación iOS.
  Se rechazan snapshots de construcción con IDs repetidos y se revisa la geometría de paneles.

Validación: **69 casos focalizados**, tipos, builds cliente/servidor y bundle.
No se ejecuta la suite completa, benchmarks ni partidas prolongadas. No hay mediciones de FPS
físicos; aspecto, legibilidad, gestos y jugabilidad en iPhone quedan para las pruebas del usuario.

```sh
npx vitest run tests/phase15Map.test.ts tests/phase151*.test.ts* tests/phase15Build.test.ts tests/phase15.test.ts tests/graphics.test.ts tests/combatClient.test.tsx
npm run typecheck
npm run build:pages
npm run build:server
```

Build PWA: **`7cb2eb0a3b9646cc`**, protocolo 11. Se conserva el mecanismo de actualización,
la configuración WSS y dos generaciones de assets al preparar la beta con `sync-beta.mjs`.

Render vuelve a desplegar por documentación porque el filtro actual incluye toda la carpeta.
Propuesta: `buildFilter.ignoredPaths` para Markdown de Brothers Royale. No aplicada: no se
cambia infraestructura ni configuración externa sin autorización. Documentación de Render
bloqueada por red; verificar el filtro en el servicio al autorizarlo.

Publicación **pendiente de nueva ventana sin partidas**. Ramas de preparación independientes;
no tocar desarrollo/beta activas hasta confirmarla. Después: servidor primero, comprobar v11,
beta después. Toda la documentación se prepara antes de ese único despliegue final.
Se conservan 8 jugadores, configuración Render de 2 salas, 3 vidas, 5 fases, 15 min y 120×120 m.
