# Protocolo de validación externa

Propuesta 8 del plan de mejora (aprobada el 2026-09-10). Define cómo se validará EchoTwin TTE con personas externas al desarrollo en tres estudios independientes y acumulativos. Nada de este protocolo se ha ejecutado todavía: el simulador sólo cuenta con validación interna (`docs/VALIDATION.md`). Los materiales que el protocolo necesita ya existen en el repositorio: el conjunto de revisión exportable (`npm run review:export`), la exportación anónima del progreso (pantalla «Progreso») y el versionado de casos y reglas clínicas.

## Principios
- **Sin datos de pacientes en el repositorio ni en los exportables.** Las imágenes reales comparadas en el estudio 2 permanecen en el centro que las custodia; al repositorio sólo vuelven puntuaciones agregadas.
- **Trazabilidad por versión.** Cada hoja de puntuación registra el commit (`git rev-parse HEAD`), la versión de la app y el identificador del caso; los resultados se archivan en `docs/validation/results/<fecha>-<estudio>.md`.
- **Ciego cuando es posible.** En el estudio 2 los evaluadores no saben si la imagen es sintética o real hasta terminar.
- **Preregistro.** Hipótesis, métricas y umbrales de éxito se fijan aquí antes de recoger datos; los cambios posteriores se anotan con fecha.

## Estudio 1 — Puntuación experta por vista y versión
**Objetivo.** Medir la fidelidad percibida de cada vista canónica de cada caso y detectar los defectos anatómicos, de movimiento y de textura con mayor impacto docente.

**Participantes.** ≥ 3 cardiólogos ecocardiografistas con ≥ 5 años de práctica y ≥ 1 docente de residentes; ninguno involucrado en el desarrollo.

**Material.** `npm run review:export -- <carpeta>` genera, por caso y vista canónica (PLAX, PSAX-AV, PSAX-MV, PSAX-PM, A4C, A2C, A3C, A5C), tres cuadros (telediástole, mesosístole, diástole precoz) en PNG y una hoja CSV (`review-sheet.csv`) con una fila por (caso, vista, cuadro) y las columnas de la rúbrica. También se puntúa el cine en la aplicación (barrido y ciclo completo) siguiendo el guion `review-script.md` que genera el mismo comando.

**Rúbrica (Likert 1–5, 1 = inaceptable, 3 = útil con reservas, 5 = indistinguible de una imagen real de calidad media).**
| Ítem | Qué se juzga |
|---|---|
| Anatomía | Proporciones y forma de cámaras, válvulas, raíz, VD, aurículas |
| Movimiento | Contracción, engrosamiento, excursión anular, apertura valvular, coherencia temporal del cine |
| Textura | Speckle, contraste miocardio/sangre, bordes endocárdicos, campo cercano |
| Artefactos | Sombra costal, reverberación, clutter, atenuación en profundidad: presencia y verosimilitud |
| Doppler | Color (dirección, aliasing, blooming), espectro (envolvente, banda, ruido), M-mode |
| Utilidad docente | ¿Sirve para enseñar la adquisición y la medición de esta vista? |
| Defecto principal | Texto libre: el error que más distrae |

**Análisis.** Media y desviación por ítem y vista; acuerdo inter-evaluador (ICC(2,k)); lista de defectos codificada por dos personas. **Criterio de éxito preregistrado:** media ≥ 3,5 en «utilidad docente» para PLAX, PSAX-PM, A4C y A5C del caso normal y de la EA severa; ningún ítem con media < 2,5. Los defectos con ≥ 2 menciones entran en `docs/ROADMAP.md`.

**Repetición.** El estudio se repite en cada versión menor; las hojas quedan enlazadas al commit para medir el progreso.

## Estudio 2 — Comparación con imágenes reales anonimizadas
**Objetivo.** Cuantificar la distancia entre el simulador y la ecografía real en las mismas vistas.

**Material real.** Cines anonimizados (sin metadatos DICOM identificativos, sin fecha, sin texto quemado con datos) de ≥ 10 estudios de calidad media procedentes de un centro con aprobación de su comité de ética; permanecen en el centro. Se seleccionan las mismas vistas canónicas y tres cuadros equivalentes por vista.

**Diseño.** Pares (real, sintético) y (real, real) presentados en orden aleatorio a ≥ 5 evaluadores ciegos; para cada par se pide (a) ¿cuál es sintética? (elección forzada) y (b) diferencia percibida (0–10) en anatomía, movimiento y textura. Además, dos ecocardiografistas miden en ambos tipos de imagen las magnitudes del protocolo (TSVI, DTDVI, SIV, PP, AI AP, E, e′, TAPSE, VTI TSVI) para comparar la variabilidad intra/interobservador con la obtenida en imágenes reales.

**Métricas.** Tasa de detección de la imagen sintética (50 % = indistinguible; se reporta con IC 95 %), diferencia percibida media por dimensión, coeficientes de variación de las mediciones en sintético vs real, y sesgo medio de cada medición frente a la verdad del modelo. **Criterio de éxito preregistrado:** detección ≤ 75 % en al menos dos vistas y variabilidad de medición en sintético dentro de 1,5× la real.

**Datos que vuelven al repositorio.** Sólo tablas agregadas y las conclusiones; ninguna imagen real.

## Estudio 3 — Piloto con residentes
**Objetivo.** Comprobar validez educativa: que practicar en el simulador mejora la adquisición y la técnica de medición y que la mejora se transfiere.

**Participantes.** ≥ 12 residentes de cardiología o medicina de urgencias sin formación previa formal en ecocardiografía, asignados al azar a (A) simulador + currículo o (B) material de lectura equivalente durante 2 semanas.

**Medidas (pre y post).**
- En el simulador, en modo examen sobre dos casos no vistos: puntuación de adquisición, de mediciones (con técnica) y de impresión; tiempo hasta score ≥ 70 en PLAX y A4C.
- Transferencia: adquisición de PLAX y A4C en un voluntario sano con un equipo real, puntuadas por un experto ciego con la misma rúbrica de vista (plano, referencias, centrado, profundidad, ganancia).
- Cuestionario de carga cognitiva y utilidad percibida (NASA-TLX abreviado, 5 ítems Likert).

**Datos.** Cada participante exporta su progreso anónimo desde «Progreso» (JSON sin identificadores, generado por `exportProgressJson`); el investigador asigna un código y guarda la correspondencia fuera del repositorio.

**Análisis.** Diferencia pre-post entre grupos (ANCOVA con la puntuación pre como covariable); tamaño del efecto (d de Cohen) y su IC; correlación entre la puntuación en el simulador y la transferencia. **Criterio de éxito preregistrado:** d ≥ 0,5 en la puntuación de adquisición y en la técnica de medición, sin aumento de la carga cognitiva.

## Calendario y responsables
| Estudio | Prerrequisito | Duración estimada |
|---|---|---|
| 1 | versión con los 12 casos (actual) | 2 semanas de revisión + 1 de análisis |
| 2 | aprobación ética del centro para las imágenes reales | 4–6 semanas |
| 3 | estudios 1 y 2 sin defectos bloqueantes | 4 semanas |

## Registro de cambios del protocolo
- 2026-09-11 · versión inicial (preregistro). Ningún estudio ejecutado.
