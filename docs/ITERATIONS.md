# Diez iteraciones de fidelidad

Plan autorizado el 4 de octubre de 2026, sobre `9a1690c` (PR #90).
Cada fila corresponde a una PR funcional, comprobada y fusionada antes de
comenzar la siguiente. Una prueba interna no constituye validación clínica.

| Orden | Objetivo | Evidencia exigida | Estado |
| --- | --- | --- | --- |
| 1 | Acceso acústico PW/TDI desde la sonda hasta cada muestra | Ventanas accesibles y obstruidas, transiciones, fase, frecuencia y coste | Validada localmente; pendiente de CI y merge |
| 2 | Historia común de adquisición | Identidad, tiempo, haz, gate y calibración coherentes al congelar y recorrer cine | Pendiente |
| 3 | Frecuencia y presupuesto temporal Doppler | Eliminar 2,5 MHz nominales en señal/audio; límites PRF/profundidad y duplex verificables | Pendiente |
| 4 | Navegación y consola adaptables | Uso a 390 px, paneles plegables, cámara independiente y medidas invariantes | Pendiente |
| 5 | Geometría y mecánica basal coherentes | Continuidad mitroaórtica, TSVD, tronco pulmonar y aurículas durante el ciclo; referencias publicadas | Pendiente |
| 6 | Aorta torácica continua compartida | Raíz, ascendente, arco, descendente y orígenes supraaórticos en CPU/GPU/malla sin intersecciones indebidas | Pendiente |
| 7 | Ventana supraesternal TTE | Sonda físicamente alcanzable, navegación y barrido continuo sobre la misma anatomía | Pendiente |
| 8 | Conservación espacial de flujo | Integrales de sección frente a tablas de flujo y variaciones de volumen; aproximaciones explícitas | Pendiente |
| 9 | Cadena IQ/FFT PW/TDI | Fantomas de Vmax/VTI, aliasing, filtros y rendimiento; comparación con cadena previa | Pendiente |
| 10 | Banco independiente y reporte | Vistas ideales e imperfectas, transiciones y controles; separación de calibración/evaluación por paciente | Pendiente |

## Criterios comunes

- Reproducir el defecto sobre la cadena real de controles y sonda, con un número.
- Comparar contra la base en un worktree aislado y probar que la regresión detecta el defecto previo.
- Mantener las comprobaciones existentes; explicar cualquier calibrado que cambie.
- Registrar fuentes, aproximaciones, rendimiento y límites pendientes por iteración.
- Ejecutar comprobaciones de código, pruebas y navegador; fusionar con CI aprobada.
- No usar como evaluación independiente los pacientes ya empleados para calibrar.
  Los 500 pacientes CAMUS usados anteriormente no constituyen un conjunto reservado.
- La revisión clínica externa queda pendiente de datos y revisores independientes;
  no se sustituye por capturas sintéticas ni por el número de pruebas aprobadas.

Las iteraciones 5 → 6 → 7 dependen de una geometría estable. La 9 depende de la
propagación, el tiempo de adquisición y el campo de flujo (1, 3 y 8). Al cerrar
cada PR se actualizarán aquí su enlace, evidencia y limitaciones.
