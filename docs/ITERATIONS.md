# Diez iteraciones de fidelidad

Plan autorizado el 4 de octubre de 2026, sobre `9a1690c` (PR #90).
Cada fila corresponde a una PR funcional, comprobada y fusionada en orden.
La preparación de la siguiente puede hacerse en un worktree aislado durante la CI.
Una prueba interna no constituye validación clínica.

| Orden | Objetivo | Evidencia exigida | Estado |
| --- | --- | --- | --- |
| 1 | Acceso acústico PW/TDI desde la sonda hasta cada muestra | Ventanas accesibles y obstruidas, transiciones, fase, frecuencia y coste | [PR #91](https://github.com/DanielOpazoD/echotwin-tte/pull/91), fusionada |
| 2 | Historia común de adquisición | Identidad, tiempo, haz, gate y calibración coherentes al congelar y recorrer cine | [PR #92](https://github.com/DanielOpazoD/echotwin-tte/pull/92), fusionada |
| 3 | Frecuencia y presupuesto temporal Doppler | Eliminar 2,5 MHz nominales en señal/audio; límites PRF/profundidad y duplex verificables | En validación |
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

## Iteración 1 cerrada

PR #91, merge `cee1371`: PW/TDI respetan la sombra del haz central. Siete de siete posiciones totalmente bloqueadas del barrido pierden la señal espuria; la referencia abierta conserva 1 m/s. Pasan 886 pruebas y 61 E2E (cuatro requieren GPU por hardware), incluida paridad CPU/GPU. CI completa aprobada. Pendientes: oclusión parcial de apertura, potencia recibida calibrada y propagación CW a su fase. La siguiente prioridad es la procedencia común del cine y las mediciones.


## Iteración 2 cerrada

PR #92, merge `a1816c2`: cine, consulta anatómica, gate y mediciones conservan su adquisición; la tira tiene identidad y tiempo propios. Pasan 890 pruebas y 62 E2E, con cuatro omisiones por GPU de hardware. CI completa aprobada. Una ejecución remota anterior falló sin detalle accesible desde este entorno; se añadieron anotaciones de Playwright a GitHub y la siguiente ejecución completa pasó. La causa de ese primer fallo remoto no quedó identificada. Persisten una sola adquisición de tira retenida y diez fases nominales de malla. Siguiente prioridad: frecuencia fundamental y tiempo de muestreo duplex, distinguiendo PRF intra-paquete y tasa media.
