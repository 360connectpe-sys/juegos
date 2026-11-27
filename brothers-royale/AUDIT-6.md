# Auditoría de fase 6

Base 51269ce. Se ejecutaron primero las 281 pruebas originales sin cambios y pasaron.
La suite auditada conserva esas pruebas y añade siete regresiones, con 288 pruebas aprobadas,
tipos y builds de cliente y servidor correctos. No se cambia el balance de armas.

| Hallazgo | Corrección |
|---|---|
| Cambiar de hueco justo al terminar una curación o recarga podía completar la acción antes de cancelarla. | La comprobación del hueco precede a la finalización de temporizadores, incluso durante idle. |
| La compensación podía reutilizar poses de la vida anterior al reaparecer. | La vuelta provisional limpia y vuelve a registrar la historia de poses. |
| Las estadísticas crecían con cada jugador que abandonaba. | Se retiran las estadísticas del jugador al eliminar su Fighter. El registro de eventos continúa acotado a 2000. |
| BR_BENCH_LOADOUT dependía solo de una variable y un prefijo del nombre. | Arranque rechazado salvo NODE_ENV=test y argumento explícito --br-bench-loadout. Una variable en producción jamás concede equipamiento. |

Las regresiones están en tests/phase6Audit.test.ts. Las suites de combate comprueban daño máximo,
roles de armas por distancia, munición finita, recargas, curación, paredes de Rapier, entradas
maliciosas, ocho clientes disparando, objetivos móviles y compensación limitada. Los mensajes
siguen siendo autoritativos y la predicción del arma continúa siendo únicamente visual.

Se conservan las limitaciones de SwiftShader, compensación de hasta 400 ms y muerte provisional.
No se implementan vidas de fase 8. La comparación gráfica y de carga de fase 6 frente a fase 7
se recoge en PHASE-7.md al terminar el desarrollo.

Prueba de carga explícita permitida, exclusivamente en pruebas locales:
NODE_ENV=test BR_BENCH_LOADOUT=Bot node dist-server/index.js --br-bench-loadout.
El arranque normal omite completamente BR_BENCH_LOADOUT.
