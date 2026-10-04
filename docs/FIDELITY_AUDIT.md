# Banco reproducible de fidelidad

`npm run fidelity:audit -- --out /tmp/echotwin-fidelity.json` ejecuta adquisiciones reales del núcleo y fantomas analíticos. No necesita servidor ni imágenes clínicas. La salida debe quedar fuera del checkout. El trabajo `fidelity` de CI ejecuta el mismo comando, adjunta el JSON y participa en el check obligatorio de merge.

El reporte identifica commit, huella de los archivos fuente, estado de trabajo, versión de Node y fecha. Conserva además controles adquiridos, haz y fase de las adquisiciones muestreadas, incluidos barrido y congelado. Cada observación conserva valor, unidad, criterio, referencia y estado. Los tiempos describen una corrida CPU a calidad media; no son FPS de navegador ni una garantía para otros equipos. Deben compararse con la máquina tranquila.

## Qué comprueba

- Doce casos, adquisición A4C, PLAX y supraesternal desde sus controles reales: presencia de cavidad VI o arco, e identidad de la posición adquirida.
- Barrido manual supraesternal: varios estados intermedios y pérdida del arco fuera de ventana.
- Cine: identidad y frecuencia histórica pese a cambios pendientes de consola.
- PW del mismo TSVI a través de una trayectoria abierta y otra obstruida por pulmón.
- Fantoma IQ de pulso semiseno a 1,5/2,5/5 MHz: Vmax y VTI frente a una solución analítica, sin usar una tabla hemodinámica como verdad de referencia.
- Balance aórtico en doce casos y cuatro fases: caudal obtenido del campo espacial más derivada de volumen por integración independiente. Comprueba una aproximación unidimensional, no CFD ni presión.

Estos criterios son verificaciones internas predeclaradas. El banco complementa las pruebas de uniones anatómicas, paridad CPU/GPU, controles, mediciones y navegador; no las sustituye. Tampoco prueba que la imagen sea indistinguible de una ecografía clínica.

## Limitaciones que no desaparecen en un reporte verde

La descendente no se adquiere en la supraesternal supina normal actual. Ese escenario figura como `known-limitation` con su medida, criterio incumplido y motivo. Si empieza a cumplirlo, pasa a `resolved-limitation` y el banco falla hasta revisar la declaración: no se permite mantener una excepción obsoleta. Un valor no finito, observación duplicada o reporte vacío nunca pasa por ser una limitación conocida.

Persisten anatomía idealizada, ventana SSN parcial, flujo aórtico sin ecuación de momento, IQ cuasiestacionaria sin huecos duplex explícitos, TDI regional aproximado y ausencia de revisión externa. Los cuatro recorridos que necesitan GPU por hardware siguen requiriendo un equipo adecuado.

## Separación de pacientes para evaluación externa

El estado actual es **evaluación externa no realizada**. Los 500 pacientes CAMUS ya empleados en las referencias históricas son calibración, incluso si ahora se separan sus vistas, fases o fotogramas en carpetas distintas. No existe un conjunto CAMUS reservado retroactivamente.

Para auditar una partición propuesta, añadir `--partition /ruta/privada/particion.json`. El archivo contiene `calibration`, `development` y `evaluation`, cada uno con objetos `{ "dataset": "estudio", "patientId": "identificador-seudonimo" }`. La unidad es el paciente, nunca un fotograma. Los identificadores deben ser estables dentro del estudio; corresponde documentar y resolver sujetos compartidos entre estudios antes de asignar espacios de nombres distintos. El auditor no puede detectar por sí solo que dos seudónimos diferentes representan a la misma persona.

Se rechazan sujetos repetidos, cruces entre particiones, un conjunto de evaluación vacío y cualquier sujeto CAMUS 1–500 marcado como evaluación. Una partición elegible sólo demuestra separación declarada: el reporte sigue diciendo `performed: false`; no demuestra que se hayan obtenido imágenes ni puntuaciones de expertos. El JSON de resultados contiene recuentos y la huella del manifiesto, no identificadores de pacientes ni píxeles clínicos. Un manifiesto solicitado que no sea elegible hace fallar el comando.

La evaluación con personas y datos independientes sigue el [protocolo externo](VALIDATION_PROTOCOL.md). El exportador `npm run review:export` prepara material sintético para esa revisión; no inventa evaluadores ni resultados.

## Lectura de resultados

Consultar el artefacto `fidelity-report` de la CI de cada PR para la corrida del commit exacto. Las observaciones analíticas y de adquisición son reproducibles; duración y tiempos CPU pueden variar. Un reporte aprobado significa que los criterios internos se cumplen y la deuda declarada sigue identificada. No autoriza una afirmación de validación clínica.

La prioridad posterior es corregir y contrastar la anatomía mediastínica del acceso supraesternal supino, conservando el bloqueo acústico causal. Después, adquisición IQ con movimiento durante el paquete y dispersores persistentes entre paquetes.

## Corrida de referencia de esta iteración

Dos ejecuciones locales del banco final (2026-10-04) reproducen exactamente 169 observaciones y 48 adquisiciones: 168 criterios cumplidos y una limitación conocida. Duración 9,85/9,89 s; mediana/p95 de las 36 adquisiciones CPU medias: 116,7/264,7 y 119,8/240,9 ms. Estas cifras no demuestran tiempo real en CPU ni rendimiento de GPU; la prueba de hardware permanece pendiente. El peor residuo del balance aórtico es 0,692 mL/s. Los valores de CI se conservan por commit en su artefacto.
