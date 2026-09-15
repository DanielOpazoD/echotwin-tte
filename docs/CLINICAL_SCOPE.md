# Alcance clínico (V1)

Todo lo que sigue se refiere a **pacientes sintéticos**. Los valores «normales» y los cortes de severidad se toman de `src/clinical/reference-values` y llevan el id de la guía de origen; ver `docs/REFERENCES.md` para su estado de verificación.

> Este documento está sincronizado con el código al 2026-09-14. `src/tests/docsConsistency.test.ts` falla si un caso o una vista dejan de aparecer aquí.

## Casos incluidos (`src/cases`, 12 casos)

Todos los casos patológicos derivan del normal cambiando sólo parámetros anatómicos/fisiológicos del mismo motor (no hay geometría ad hoc por caso). Las verdades citadas las calcula `computeGroundTruth` a partir de las tablas de latido.

| Id | Qué enseña | Parámetros clave |
|---|---|---|
| `normal-excellent-window` | Adquisición estándar: PLAX, PSAX (3 niveles), A4C; PW en TSVI | 32 a, sinusal 65 lpm, VTD/VTS 120/45 mL → FE 62,5 %, VS 75 mL, E/A 1,45, e′ 11/14 cm/s (E/e′ ≈ 6,4), PASP 25 mmHg |
| `normal-difficult-window` | Optimizar una ventana difícil: espacio intercostal, frecuencia baja, armónicos; sombra costal e interposición pulmonar | Mismo corazón de tamaño femenino; 61 a, IMC 34, pared torácica gruesa, atenuación y solapamiento pulmonar del caso |
| `hfref-severe-mr` | VI dilatado con FE reducida e IM funcional por tracción | VTD/VTS 250/190 mL → FE 24 %, sinusal 88 lpm, ORE IM 0,25 cm² (jet central), e′ septal 4 cm/s, PASP 48 mmHg |
| `inferior-rwma` | Alteración segmentaria inferior/inferolateral con compensación de los segmentos sanos | VTD/VTS 145/78 mL, `wallMotion` inferior+inferolateral, E/A invertido (0,7/0,75), e′ 6/8 cm/s |
| `aortic-stenosis-moderate` | Estenosis aórtica moderada: Vmax 3–4 m/s, AVA 1,0–1,5 cm² | AVA efectiva 1,1 cm², cúspides calcificadas, HVI con patrón diastólico |
| `aortic-stenosis-severe` | EA severa: Vmax/VTI con CW, AVA por continuidad, TSVI con zoom | AVA efectiva 0,88 cm² → Vmax 4,69 m/s, gradiente medio 44 mmHg, VTI 89 cm, índice 0,25 (los tres criterios de severa) |
| `hocm-sam` | MCH obstructiva: SAM septal, chorro en daga del TSVI, IM excéntrica | Septo hipertrófico, `samSeverity` 0,7, obstrucción dinámica resuelta al gradiente del caso, ORE IM 0,15 cm² a 35° |
| `mvp-primary-mr` | Prolapso del velo posterior con IM primaria excéntrica, PISA | `prolapse` 0,7, ORE 0,45 cm² dirigido −35°, VI volumen-cargado hiperdinámico (165/58 mL), E 1,2 m/s |
| `pulmonary-hypertension-rv` | VD dilatado con disfunción, aplanamiento septal en «D», IT para RVSP | VD basal 4,9 cm, `septalFlattening` 0,8, PASP 72 mmHg, TAPSE 1,3 cm, S′ 7 cm/s, ORE IT 0,3 cm² |
| `pericardial-effusion-tamponade` | Derrame con colapsos de AD y VD, oscilación, variación respiratoria de E mitral/tricuspídea | Derrame 2,2 cm, `tamponade` 0,8, taquicardia 108 lpm, PAS 92 mmHg, PAD 16 mmHg |
| `af-diastolic` | FA: RR irregular sin onda A, llenado y eyección latido a latido, límites de la evaluación diastólica | FA 92 lpm (variabilidad 22 %), E 0,95 m/s sin A, e′ 5,5/7,5, IM leve (ORE 0,12) |
| `artifact-challenge` | Laboratorio de artefactos: calcificación con sombra, reverberación, lóbulos laterales, espejo, blooming de color | `caseDef.artifacts` con intensidades propias; EA leve-moderada de fondo (AVA 1,4 cm²) |

## Vistas modeladas (`src/simulator/windows/viewTargets.ts`, 12 vistas)

La pose canónica de cada vista se **deriva de la anatomía del caso** (plano en marco cardíaco + punto de piel ajustado al espacio intercostal), y sólo se usa para puntuar e insinuar, nunca para colocar la sonda. La oblicuidad residual de los planos paraesternales está medida y documentada en `docs/LIMITATIONS.md`.

| Vista | Ventana | Referencias requeridas (peso) |
|---|---|---|
| `plax` | paraesternal | VM, VAo, AI, TSVI, septo, pared inferolateral |
| `psax-av` | paraesternal | VAo, AI, AD, TSVD |
| `psax-mv` | paraesternal | VM, VD |
| `psax-pm` | paraesternal | papilar AL, papilar PM, VI |
| `psax-apex` | paraesternal | ápex del VI |
| `a4c` | apical | ápex, VM, VT, AI, AD, VD, septo, pared lateral |
| `a5c` | apical | TSVI, VAo, ápex |
| `a2c` | apical | ápex, VM, AI, pared anterior, pared inferior |
| `a3c` | apical | ápex, VM, TSVI, VAo, AI |
| `rv-focused` | apical | VD, VT, AD, septo |
| `subcostal-4c` | subcostal | cuatro cámaras a través del hígado |
| `subcostal-ivc` | subcostal | VCI, vena hepática, AD |

La ventana supraesternal no existe: la aorta termina a 6,5 cm sin arco. Las ventanas se detectan por posición de la sonda (`windowFromSkin`).

## Anatomía y fisiología representadas

- VI en perfil «bala» tabulado con espesor por acimut y nivel, miocardio incompresible (el engrosamiento emerge), dos papilares enraizados, 17 segmentos AHA con motilidad regional; VD en semiluna con infundíbulo, banda moderadora y trabéculas; aurículas elipsoidales con fosa oval; venas pulmonares, cavas y vena hepática; TSVI→raíz→aorta ascendente de 6,5 cm; TSVD y tronco pulmonar con bifurcación; válvula pulmonar de tres cúspides.
- Válvulas: mitral en anillo de silla con velos en abanico y línea de coaptación, tricúspide de tres valvas con anillo que se acorta en sístole, aórtica con tres cúspides y coaptación en Y; todas abren siguiendo el flujo y producen clics en el espectro (decisión 103).
- Ritmo: sinusal con variabilidad RR, y FA con tablas por latido (cada latido llena y eyecta según su propio RR, decisión 107). Respiración libre: variación de las ondas E mitral y tricuspídea y colapso inspiratorio de la VCI (decisiones 108, 113).
- Regurgitaciones por ORE con PISA hemiesférica (IM, IAo, IT), obstrucción dinámica del TSVI con SAM, flujo de venas pulmonares S/D/Ar (decisión 31).

## Modalidades

2D (B-mode), Doppler color, modo M, modo M color, PW, CW y TDI, con consola completa (ganancia, TGC, rango dinámico, frecuencia, armónicos, foco, sector, densidad, zoom de lectura, persistencia, inversión), audio Doppler y cine de 96 cuadros.

## Lo que NO está en V1

| Ausente | Estado en el código |
|---|---|
| Ventana supraesternal (arco aórtico, troncos supraaórticos) | No existe: la aorta termina a 6,5 cm |
| Estenosis mitral, prótesis valvulares, congénitas, endocarditis/masas | No modeladas |
| Strain, 3D/4D, modo M anatómico, contraste ecocardiográfico | No existen |
| Extrasístoles | `pvcProbability` se valida en el esquema y se ignora |
| Bicúspide | El esquema admite `aorticValve.bicuspid`; ningún caso lo usa |
| Simpson biplano, FAC, áreas, PHT, IVRT como herramientas | Simpson monoplano y TD por pendiente existen; el resto no |
| Graduación diastólica y del VD en el informe | Cortes presentes en `reference-values`; el informe sólo gradúa EA automáticamente |
| PRF ligada a profundidad/frecuencia, PRF alta, comportamiento dúplex | Fórmulas presentes en `clinical/formulas`, no conectadas |
| Flujo Doppler de cavas y venas hepáticas | Geometría existe; sin flujo propio |

## Modos de producto (`src/app/store.ts`)

| Modo | Efecto real en el código |
|---|---|
| `sandbox` | Todo visible: ayudas, componentes del score, panel Dev, referencias, verdad de terreno en el informe. |
| `guided` | Igual que sandbox más selector de «vista objetivo» con score e hints canónicos. |
| `exam` | Vacía progreso y mediciones; oculta hints, física, panel Dev y referencias; bloquea el cambio de caso y las pantallas Currículo/Progreso/Referencias; el informe oculta verdad y desviación hasta «Finalizar examen y ver puntuación», que congela y muestra el resumen de `src/education/scoring`. **Limitación conocida**: el score de la vista sigue visible en el HUD sobre la imagen (`ImageHud.tsx`) y el torso 3D sigue mostrando el corazón; están listados en `docs/LIMITATIONS.md`. Sin límite de tiempo. |

## Mediciones y puntuación

Catálogo de 18 mediciones semánticas (`src/simulator/measurements/protocol.ts`) con herramienta, modalidad, vista, fase, colocación y alineación exigidas; la captura es evaluada por `education/technique.ts` y el examen las puntúa contra la verdad con `tolerancePct`. Los casos declaran como requeridas, según el caso: `lvot-diameter`, `lv-edd`, `ivsd`, `lvpwd`, `lv-edv-simpson`, `lv-esv-simpson`, `la-ap`, `tapse`, `lvot-vti`, `lvot-peak-velocity`, `mitral-e`, `av-vmax`, `av-vti`, `tr-vmax`, `e-prime-septal`, `e-prime-lateral`. El puntuador empareja por id semántico (ver `docs/MEASUREMENTS.md` y `docs/SCORING.md`).
