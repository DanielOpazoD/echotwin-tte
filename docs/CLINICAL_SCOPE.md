# Alcance clínico (V1)

Todo lo que sigue se refiere a **pacientes sintéticos**. Los valores «normales» y los cortes de severidad se toman de `src/clinical/reference-values` y llevan el id de la guía de origen; ver `docs/REFERENCES.md` para su estado de verificación.

## Casos incluidos (`src/cases`)
| Id | Qué enseña | Parámetros clave (verdad de terreno calculada por el modelo) |
|---|---|---|
| `normal-excellent-window` | Adquisición estándar: PLAX, PSAX (3 niveles), A4C; PW en TSVI | 32 a, sinusal 65 lpm, VTD/VTS 120/45 mL → FE 62,5 %, VS 75 mL, VTI TSVI 21,7 cm, VAo Vmax 1,30 m/s, E/A 1,45, E/e′ 6,4, VIT 2,35 m/s (RVSP 25 mmHg), IVAI 28 mL/m² |
| `normal-difficult-window` | Optimizar una ventana difícil: espacio intercostal, espiración, decúbito, frecuencia baja y armónicos; reconocer sombra costal e interposición pulmonar | Mismo corazón; 61 a, IMC 34; pared torácica 3,4 cm; atenuación 0,6, solapamiento pulmonar 1,2 cm, clutter 0,55, obesidad 0,5, enfisema 0,4 |
| `aortic-stenosis-severe` | Válvula engrosada/calcificada con apertura restringida; TSVI en PLAX; VTI TSVI con PW; Vmax/VTI con CW; AVA por continuidad | AVA efectiva 0,95 cm², VS 78 mL → **Vmax 4,35 m/s, VTI 82 cm, gradiente pico 76 / medio 38 mmHg, índice VTI 0,27, AVA por continuidad 0,95 cm²**; HVI 1,3/1,25 cm; AI 78 mL (IVAI 41); E/A 0,76, DT 240 ms, e′ 5,5/7 cm/s (E/e′ 10,4); PASP 38. *Nota: el modelo cumple «severa» por Vmax ≥ 4 y AVA < 1,0, pero su gradiente medio (38 mmHg) queda por debajo de los 40 que enuncia la propia `impressionTruth` del caso; el comentario del archivo anuncia «≈ 45 mmHg».* |

## Vistas modeladas (`src/simulator/windows/viewTargets.ts`)
La pose canónica de cada vista se **deriva de la anatomía del caso** (plano en marco cardíaco + punto de piel), no de una tabla fija, y solo se usa para puntuar e insinuar, nunca para colocar la sonda.

| Vista | Ventana | Referencias requeridas (peso) | Penaliza si aparece | Profundidad recomendada |
|---|---|---|---|---|
| PLAX | paraesternal | VM 1,2 · VAo 1,2 · AI · TSVI · septum anteroseptal · pared inferolateral · (VD anterior 0,7, raíz 0,6, Ao descendente 0,3) | ápex, AD, VT, papilar AL | 13–18 cm |
| PSAX aórtica | paraesternal | VAo 1,5 · AI · AD 0,8 · TSVD 0,9 · (VT, SIA) | VI medio, papilar | 12–16 |
| PSAX mitral | paraesternal | VM 1,5 · VD 0,8 · (septum inferoseptal, pared inferolateral) | VAo, papilar, AI | 12–16 |
| PSAX papilar | paraesternal | papilar AL 1,2 · papilar PM 1,2 · VI medio · (VD) | VM, VAo, AI | 12–16 |
| A4C | apical | ápex 1,4 · VM 1,2 · VT 1,1 · AI · AD · VD · septum inferoseptal 0,9 · pared anterolateral 0,9 · (SIA) | VAo, raíz | 14–18 |
| A5C | apical | TSVI 1,3 · VAo 1,2 · ápex · (VM, VD) | — | 14–18 |
| A2C | apical | ápex 1,4 · VM 1,2 · AI · pared anterior · pared inferior | VD, VT, AD, VAo | 14–18 |
| A3C | apical | ápex 1,3 · VM 1,1 · TSVI 1,2 · VAo 1,2 · AI 0,9 · (raíz) | VD, AD | 14–18 |
| VD enfocada | apical | VD 1,5 · VT 1,2 · AD · septum inferoseptal 0,8 · (ápex) | VAo | 14–18 |

Las ventanas subcostal y supraesternal se **detectan** por la posición de la sonda (`windowFromSkin`: v < −7,5 cm o v > 8 cm) pero no tienen vistas definidas: el motor responde «Ventana sin vistas definidas en esta versión».

## Anatomía y fisiología representadas
- VI elipsoidal recortado en el anillo mitral con espesor septal/posterior independiente, ápex fijo y base que desciende MAPSE·long(φ); miocardio incompresible (el engrosamiento emerge); dos músculos papilares; 17 segmentos AHA con amplitud regional configurable.
- Válvulas como parches finos: mitral bivalva (longitudes de velo, apertura máxima, engrosamiento, calcificación, SAM), aórtica de 3 velos (o 2 si `bicuspid`) con fracción de apertura, espesor y calcificación; tricúspide simplificada de dos velos que sigue el TAPSE.
- TSVI → anillo → senos → unión sinotubular → aorta ascendente como tubo con perfil de radio; AI y AD elipsoidales que se alargan en sístole; septum interauricular; VD en semiluna (elipsoide tallado por el epicardio del VI) más TSVD; pericardio y derrame opcional; aorta descendente, columna, hígado, pulmones, costillas (cartílago medial, hueso lateral), esternón, grasa/músculo de pared; pulmón anterior interpuesto entre pared y corazón lateral a la escotadura cardíaca (`isAnteriorLung`, ocluye el corazón) y corazón desplazado hacia atrás cuando la pared efectiva supera 2 cm.
- Ritmo sinusal con variabilidad RR gaussiana y fibrilación auricular (RR log-normal, sin onda A, línea de base fibrilatoria en el ECG). Los tipos `sinus-tachycardia` y `sinus-bradycardia` se aceptan pero se comportan como `sinus` (solo cambia la FC configurada).
- Diástole: onda E (sen² de aceleración, deceleración casi lineal con DT), onda A (semiseno), IVRT; e′ septal/lateral y S′ tricuspídeo son parámetros del caso; el TDI sintetiza la velocidad anular a partir de la tabla longitudinal.

## Lo que NO está en V1
| Ausente | Estado en el código |
|---|---|
| Ventanas subcostal y supraesternal (VCI, venas hepáticas, arco aórtico) | Detección de ventana sí; sin `ViewTarget`; el hígado y la posición `subcostal-supine` existen pero esa posición no modifica el tórax (`createThoraxModel` solo trata `supine` y `left-lateral`). La VCI solo existe como número en la verdad de terreno (`Structure.Ivc` nunca se asigna). |
| Regurgitaciones (IM, IAo, IT por ERO) | `hemodynamics.regurgitation` y los sitios `mr-jet`/`ar-jet` se validan pero el campo de flujo no los implementa. Solo hay chorro de IT derivado de PASP−PAD. |
| Flujo de venas pulmonares | Sitio `pulmonary-vein` en el enum; no implementado. |
| Strain, 3D, modo M anatómico, contraste | No existen. |
| Prótesis valvulares, endocarditis, masas | No existen. |
| Alteraciones segmentarias, derrame pericárdico, SAM, FA, bicúspide | **Soportados por el modelo** (parámetros del esquema) pero **ningún caso los usa**. |
| Extrasístoles | `pvcProbability` se valida y se ignora. |
| Graduación diastólica y del corazón derecho | Cortes presentes en `reference-values` con `confidence: 'recalled'`; no hay algoritmo de graduación. El informe sólo gradúa estenosis aórtica, leyendo los cortes de `AORTIC_STENOSIS_RULES` (severa si Vmax ≥ 4, gradiente medio ≥ 40 o AVA ≤ 1,0; moderada si Vmax ≥ 3) y citando su `referenceId`. |
| Simpson, TAPSE, FAC, áreas, volúmenes | Fórmulas en `clinical/formulas`; sin herramienta de medición (`MeasurementKind` reserva `area` y `volume`). |
| Examen puntuado | **Parcial**: `src/education/scoring` puntúa `requiredViews` (mejor score alcanzado frente a `minScore`) y `requiredMeasurements` (mejor medición del tipo adecuado frente a la verdad, con `tolerancePct` y ×0,4 si la vista tuvo score < 50); `impressionTruth` y `learningObjectives` siguen sin consumidor; no hay tiempo límite ni comparación de la impresión. |

## Modos de producto (`src/app/store.ts`)
| Modo | Efecto real en el código |
|---|---|
| `sandbox` | Todo visible: ayudas, componentes del score, panel Dev, pantalla de referencias, verdad de terreno en el informe. |
| `guided` | Igual que sandbox más un selector de «vista objetivo»; el panel de guía muestra el score de esa vista y sus hints canónicos. |
| `exam` | Al entrar vacía progreso y mediciones; oculta ayudas, física, panel Dev y referencias; bloquea el cambio de caso; el informe oculta verdad y desviación hasta pulsar «Finalizar examen y ver puntuación», que congela la imagen y muestra el resumen de `src/education/scoring` (50 % adquisición + 50 % mediciones). Sin límite de tiempo. |

## Sitios de medición que los casos declaran (`requiredMeasurements`)
`lvot-diameter`, `lv-edd`, `lvot-vti`, `mitral-e` (normal) y `lvot-diameter`, `lvot-vti`, `av-vmax`, `av-vti` (estenosis aórtica), con tolerancias del 10–15 %. Las herramientas no etiquetan la medición con un `measurementId`: el puntuador toma, para cada id requerido, la medición del tipo adecuado (lineal / velocidad / VTI) más cercana a la verdad, y la tabla de mediciones del informe sigue emparejando por heurística (ver `docs/MEASUREMENTS.md` y `docs/SCORING.md`).
