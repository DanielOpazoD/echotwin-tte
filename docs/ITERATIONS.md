# Diez iteraciones de fidelidad

Plan autorizado el 4 de octubre de 2026, sobre `9a1690c` (PR #90).
Cada fila corresponde a una PR funcional, comprobada y fusionada en orden.
La preparación de la siguiente puede hacerse en un worktree aislado durante la CI.
Una prueba interna no constituye validación clínica.

| Orden | Objetivo | Evidencia exigida | Estado |
| --- | --- | --- | --- |
| 1 | Acceso acústico PW/TDI desde la sonda hasta cada muestra | Ventanas accesibles y obstruidas, transiciones, fase, frecuencia y coste | [PR #91](https://github.com/DanielOpazoD/echotwin-tte/pull/91), fusionada |
| 2 | Historia común de adquisición | Identidad, tiempo, haz, gate y calibración coherentes al congelar y recorrer cine | [PR #92](https://github.com/DanielOpazoD/echotwin-tte/pull/92), fusionada |
| 3 | Frecuencia y presupuesto temporal Doppler | Eliminar 2,5 MHz nominales en señal/audio; límites PRF/profundidad y duplex verificables | [PR #93](https://github.com/DanielOpazoD/echotwin-tte/pull/93), fusionada |
| 4 | Navegación y consola adaptables | Uso a 390 px, paneles plegables, cámara independiente y medidas invariantes | [PR #94](https://github.com/DanielOpazoD/echotwin-tte/pull/94), fusionada |
| 5 | Geometría y mecánica basal coherentes | Continuidad mitroaórtica, TSVD, tronco pulmonar y aurículas durante el ciclo; referencias publicadas | [PR #95](https://github.com/DanielOpazoD/echotwin-tte/pull/95), fusionada |
| 6 | Aorta torácica continua compartida | Raíz, ascendente, arco, descendente y orígenes supraaórticos en CPU/GPU/malla sin intersecciones indebidas | [PR #96](https://github.com/DanielOpazoD/echotwin-tte/pull/96), fusionada |
| 7 | Ventana supraesternal TTE | Sonda físicamente alcanzable, navegación y barrido continuo sobre la misma anatomía | [PR #97](https://github.com/DanielOpazoD/echotwin-tte/pull/97), fusionada |
| 8 | Conservación espacial de flujo | Integrales de sección frente a tablas de flujo y variaciones de volumen; aproximaciones explícitas | En validación |
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

## Iteración 3 cerrada

PR #93, merge `e173a8b`: frecuencia adquirida en espectro y audio, presupuesto medio duplex separado de PRF instantánea. 894 pruebas y 63 E2E, cuatro omitidos por GPU de hardware; CI y cobertura aprobadas. El primer control de coste CPU falló sin registro descargable; con anotaciones diagnósticas y el mismo presupuesto, la ejecución siguiente pasa (+17,5 %, límite +25 %). No está confirmada la causa del primer fallo. Persisten el reparto 25/75 % supuesto y la ausencia de adquisición IQ con huecos reales.

## Iteración 4 cerrada

PR #94, merge `71e04c4`: sector de 378 px a anchura de 390 px (antes 82), paneles plegables y cámara táctil independiente. Congelar conserva el worker de mallas cuando no cambia el paciente. 894 pruebas y 64 recorridos de navegador, cuatro omitidos por GPU de hardware; CI y cobertura aprobadas. La prueba histórica selecciona un cuadro adquirido con color y conserva todos sus controles de procedencia; pasa tres repeticiones locales y la CI completa. Persisten la interacción de un solo puntero y diez fases nominales de malla.


## Iteración 5 cerrada

PR #95, merge `03531bf`: TDI longitudinal sigue la coordenada material entre el anillo actual y el ápex. En 48 muestras normales, la razón respecto de la derivada geométrica pasa de 0,843–0,995 a 1 dentro de 4×10⁻⁸. La mutación anterior falla en los doce casos. Pasan 906 pruebas, 64 recorridos de navegador y CI completa; cuatro recorridos requieren GPU por hardware. Persisten el ajuste empírico lateral/septal y la ausencia de velocidad tisular radial/torsional completa. Siguiente prioridad: continuidad y separación de los grandes vasos.

## Iteración 6 cerrada

PR #96, merge `fe29c0c`: aorta torácica y tres ramas proximales comparten geometría en CPU/GPU/malla. Se elimina el cruce demostrado con cava/pulmonar y se comprueba continuidad y curvatura en todo el ciclo. 946 pruebas y 72 recorridos de navegador, cuatro omitidos por GPU de hardware; CI completa aprobada. Geometría idealizada y desplazamiento del extremo pulmonar de hasta 4,27 cm requieren revisión externa. La siguiente prioridad es adquirir el arco desde la escotadura supraesternal con controles reales.

## Iteración 7 cerrada

PR #97, merge `f06dc5c`: botón SSN y barrido continuo desde la escotadura, con clasificador anatómico común. 949 pruebas y 75 recorridos de navegador, cuatro omitidos por GPU de hardware; CI completa y cobertura aprobadas. La adquisición sigue siendo parcial: arco visible en las 24 combinaciones medidas, descendente oculta en todos los supinos y dos ventanas laterales difíciles. No se abrió artificialmente el mediastino. Siguiente prioridad: flujo aórtico que siga el árbol vascular y conserve su balance de volumen.
