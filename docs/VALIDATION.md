# Validación

Estado observado el **2026-09-11 a las 03:30 (hora local)** con `npx vitest run`: **23 archivos, 128 pruebas, todas pasan**. Playwright: 30 pruebas (`core-flow` 9, `measurements` 2, `learning` 2, `gpu-equivalence` 17); `test-results/.last-run.json` registra la última ejecución local como `passed`. Lint y typecheck en verde. Vuelve a ejecutar `npm test` y `npm run test:e2e` antes de fiarte de esta tabla. `.github/workflows/ci.yml` (lint → typecheck → test → build → Playwright en Chromium) existe pero nunca se ha ejecutado en remoto: el repositorio tiene commits locales y no tiene remoto.

## Feature → referencia → tolerancia → resultado
Referencia = con qué se compara (valor analítico, consistencia interna o rango fisiológico). Ninguna prueba compara con datos de pacientes reales.

| Archivo | Feature | Referencia | Tolerancia | Resultado |
|---|---|---|---|---|
| `clinical/formulas/formulas.test.ts` | BSA Mosteller / DuBois (175 cm, 75 kg) | 1,909 / ≈1,9 m² | ±0,005 / ±0,05 | pasa |
| | Bernoulli 4 m/s | 64 mmHg | exacto | pasa |
| | Área circular, VS, AVA continuidad, índice de velocidades | π, 62,83 mL, 0,785 cm², 0,25 | ±0,05 / ±0,005 / exacto | pasa |
| | FE, GC, error si VTS > VTD | 62,5 %, 4,875 L/min, lanza | 1e-6 | pasa |
| | RVSP (IT 2,8 + PAD 3) | 34,36 mmHg | ±0,005 | pasa |
| | VTI de semiseno 1 m/s × 0,3 s | 19,1 cm | ±0,05 | pasa |
| | Simpson biplano de un cilindro | π/4·a·b·L | 1e-6 | pasa |
| | Desplazamiento Doppler, Nyquist, PRF máx. | 3246,75 Hz; 0,616 m/s; 7700 Hz | ±0,05 / ±0,0005 / exacto | pasa |
| | `aliasVelocity` con y sin línea de base | plegado esperado | 1e-9 | pasa |
| | `formatClinical` | decimales por familia | exacto | pasa |
| `core/vec3.test.ts` | Base ortonormal; rotación 90°; `qFromBasis` ida y vuelta; composición | identidades | 1e-9 / 1e-6 | pasa |
| | PRNG y `hash3` deterministas en [0,1); ruido continuo; speckle media 0,6–1,4 | — | Δ < 1e-3 | pasa |
| `anatomy/heartModel.test.ts` | Clasificación VI (sangre/miocardio/fuera) | modelo | — | pasa |
| | Volumen VI Monte Carlo (200 000 muestras) en TD y TS | VTD/VTS de las tablas | ±10 % / ±12 %; TS < 0,5·TD | pasa (falló una vez en el conjunto completo bajo carga; no reproducido) |
| | Engrosamiento sistólico; secuencia MV/VAo; referencias en su estructura; ápex izquierdo-inferior-anterior; segmentos AHA | consistencia | — | pasa |
| `cardiac-cycle/cycle.test.ts` | VTD/VTS/VS = 120/45/75; periodicidad | caso normal | ±0,5 mL; drift < 3 mL | pasa |
| | ∫Q_ao = ∫Q_mv = VS | 75 mL | ±0,5 | pasa |
| | Área mitral efectiva | 3–7 cm² | rango | pasa |
| | Orden VAo→IVRT→MV→A; aperturas por fase | — | umbrales 0,05/0,7/0,9 | pasa |
| | Picos E/A emergentes | 0,8 / 0,55 m/s | ±0,05 | pasa |
| | FA: sin onda A; RR irregular pero reproducible; ECG sin P; reloj | — | > 5 RR distintos | pasa |
| `hemodynamics/groundTruth.test.ts` | VS Doppler TSVI = VS volumétrico | — | < 2 % | pasa |
| | AVA continuidad = área efectiva; Bernoulli; medio < pico | — | ±0,005 | pasa |
| | Rangos: VTI TSVI 16–28, Vmax 0,7–1,4, VAo < 1,9, FE 62,5 | — | rango | pasa |
| | RVSP = PASP del caso | — | 1e-5 | pasa |
| `view-recognition/viewQuality.test.ts` | PLAX canónica reconocida, > 70, MV y AI visibles | — | — | pasa |
| | PSAX-MV (> 60) y PSAX-PM canónicas reconocidas; camino PLAX→PSAX-MV interpolado en 8 pasos | — | saltos < 45 pts | pasa |
| | A4C > 65, acortamiento < 15°, sonda elevada acorta más | — | — | pasa |
| | Fuera de ventana → 0 + hint; PLAX oblicua puntúa menos y sugiere maniobra | — | — | pasa |
| `core/simulatorCore.test.ts` | Cuadros en 2D/Color/PW/CW/M/TDI, freeze y cine | humo | — | pasa |
| | PLAX canónica > 60 vía núcleo | — | — | pasa |
| `renderer/atlas/atlas.test.ts` | Ancla completa reproduce al procedimental (fill 0) | — | dif. media < 0,01 | pasa |
| | Barrido PLAX→PSAX sin saltos | — | máx < 3,5× media | pasa |
| `doppler/doppler.test.ts` | Flujo TSVI en sístole 0,6–1,5 m/s y < 0,2 en diástole; mitral 0,5–1,1 hacia el ápex | fisiológico | rango | pasa |
| | Ley del coseno (0°, 20°, 60°) | 1, 0,94, 0,5 | ±0,005 | pasa |
| | PW pliega 1,0 m/s con escala 0,6 → −0,2; CW recorta | — | ±0,05 | pasa |
| | Filtro de pared elimina 0,1 m/s; turbulencia ensancha > 1,5× | — | — | pasa |
| | PW en TSVI desde 9 posiciones de sonda (ajustadas al espacio intercostal, sonda re-apuntada al TSVI desde cada una para que quede en el plano): ≥ 6 con señal; mejor pico 0,45–1,6 m/s; pico ≈ \|v·d\| en el gate; la peor alineación (> 12° más) mide < 0,8× la mejor | cos θ | error < 0,35 m/s | pasa (una versión anterior mantenía la orientación y desde posiciones mediales el gate proyectado caía en los senos aórticos sin flujo) |
| | CW independiente del gate (Δ < 0,08); PW en campo cercano < PW en TSVI | — | — | pasa |
| `education/scoring/scoring.test.ts` | Adquisición 100 con las 4 vistas sobre el mínimo; < 70 con PLAX 90 + A4C 35 | — | — | pasa |
| | Medición correcta (+3 %) con vista 20 → inválida, < 50 puntos; con vista 80 → 100 | — | — | pasa |
| | VTI con +40 % pierde puntos (0 < p < 100); `mitral-e` no medida = 0 | — | — | pasa |
| | Resumen reproducible; lista A4C omitida; total < 60 | — | igualdad profunda | pasa |
| `anatomy/proportions.test.ts` | 44 medidas geométricas por caso (volúmenes MC, diámetros en planos estándar, grosores, raíz, anillos, índices por BSA) contra rangos adultos por sexo (ASE/EACVI 2015, corazón derecho 2025; «≈» = aproximado); sólo salen de rango las desviaciones declaradas por el caso (`expectedDeviations`); una declaración obsoleta falla | rangos de guía | rango | pasa (3 casos) |
| `education/technique.test.ts` | Motor de técnica: TSVI en PLAX/mesosístole/segmento en el TSVI = 1,0; A4C inválida; fase errónea; caliper con pared o extremos dentro de la cavidad; gate en VD inválido; 45° de ángulo = inválido con «29 %» de subestimación; CW sin cruzar la válvula; TAPSE con línea por el anillo; Simpson acortado; todo id requerido de todo caso tiene spec y verdad | reglas del protocolo | exacto | pasa (6) |
| `measurements/simpson.test.ts` | Discos desde un contorno: media elipsoide → 2/3·π·a²·L | analítico | 3 %; invariante a rotación 2 % | pasa (2) |
| `core/measurementSupport.test.ts` | Mapa polar de estructuras en cada cuadro; hitos de fase ordenados; gate PW en el TSVI reporta estructura, flujo y ángulo < 40°; auto-trace del espectro del TSVI: Vmax 0,5–1,8 m/s y > 40 % de columnas sin flujo | fisiológico | rango | pasa (3) |
| `cases/cases.test.ts` | Los 12 casos en el orden de la especificación, ids/semillas únicos, esquema válido, vistas/mediciones requeridas existentes, ≥ 2 objetivos e impresiones; la verdad de cada caso coincide con su intención (FEVI < 30 en ICFEr; segmentos 4/5/10/11/15; EA moderada 3–4 m/s y 20–40 mmHg; EA severa ≥ 4 / ≥ 40 / < 1,0; MCH dinámica > 50 mmHg y SIV/PP > 1,3; prolapso ORE ≥ 0,4 excéntrico; HTP PSVD > 60 y TAPSE < 1,7; derrame ≥ 2 cm con taponamiento; FA sin A y E/e′ > 13; esclerosis 2–3 m/s) y produce impresiones | intención del caso | rango | pasa (14) |
| `doppler/regurgitation.test.ts` | IM: Vmax 4,5–6 m/s, VR 25–70 mL, VS aórtico = VS total − VR, chorro > 3,5 m/s en la AI en mesosístole, PISA convergente en el lado ventricular, nada en diástole; IAo: Vmax 3,3–4,5, VR > 20, llenado mitral = VS total − VR, chorro precoz > 2,5 m/s que decae > 20 % a los 450 ms; MCH: obstrucción dinámica 55–75 mmHg, pico > 3,2 m/s después del 55 % de la eyección (el normal pica antes del 50 % y < 1,6 m/s) | conservación de masa, Bernoulli | rango | pasa (3) |
| `renderer/postprocess/artifacts.test.ts` | Lóbulos laterales (+20 niveles a 3 líneas), espejo (+25 niveles al doble de la profundidad de la interfaz, sin fantasma en líneas sin reflector), anchura de haz (más líneas > 60 lejos del foco) | construcción | umbrales | pasa (3) |
| `doppler/pulmonaryVein.test.ts` | Picos S ≥ 0,9·D y Ar > 0,15 en el normal; S < 0,5·D con IM severa; Ar = 0 en FA; flujo en el ostium hacia la AI en sístole (> 0,25 m/s) y reversión en la contracción auricular; el modo M color produce columnas coloreadas a través del llenado mitral; las anulaciones del laboratorio de artefactos aclaran la imagen > 5 % en núcleos en paralelo con la misma fase | fisiológico | rango | pasa (4) |
| `education/impression.test.ts` | Hallazgos esperados por caso (normal, ICFEr, ASM, EA moderada/severa, MCH, prolapso, HTP, taponamiento, FA, esclerosis); grupos excluyentes sin colisión; F1 con listas explícitas (100/40/0) | umbrales de guía | exacto | pasa (3) |
| `education/curriculum.test.ts` | Ids únicos y razones > 30 caracteres; casos existentes; checks (PLAX 72 sí/65 no, color con escala 0,3, PW alineado 12° sí/35° no, técnica 0,8 sí/0,3 no, impresión por caso); progreso: persistencia, idempotencia, resumen, exportación sin identificadores, JSON roto; explicaciones causales con causa/efecto/remedio y ninguna para un análisis perfecto | construcción | exacto | pasa (5) |
| `tests/goldens.test.ts` | Determinismo por semilla (500 muestras iguales) | — | exacto | pasa |
| | Goldens: rejilla 12×12 de medias para PLAX/PSAX-PM/A4C/A2C a fases 0 y 0,3 (tier low) | `src/tests/goldens/frames.json` (regenerado a las 20:09) | ≤ 6 niveles por celda | pasa |

## Reconstrucción anatómica (2026-09-11)
| Aspecto | Referencia | Comprobación | Resultado |
|---|---|---|---|
| Perfil «bala» del VI, tabla polar y engrosamiento por conservación de masa | `lvShape.ts` (decisiones 38–39) | `lvShape.test.ts` (4), `heartModel.test.ts` (volúmenes MC ±10 %, papilares enraizados, engrosamiento 1,25–2,2) | pasa |
| Proporciones de los 12 casos tras cada fase | ASE/EACVI (`measureModel.ts`) | `proportions.test.ts` con desviaciones declaradas | pasa (44 medidas × 12 casos) |
| Espejo GLSL de cada fase | `e2e/gpu-equivalence.spec.ts` | acuerdo de estructura/tejido > 99,5 % en 21 combinaciones (incluye subcostal y tier alto con grosor de corte) | pasa |
| Planos canónicos (incl. subcostal 4C y VCI) | `audit-views.ts` | error de plano ≤ 7° (ejes cortos oblicuos por ventana), rotación ≤ 7° | pasa |

## Pruebas E2E (`e2e/core-flow.spec.ts`, Playwright + `vite preview`)
| Prueba | Qué verifica |
|---|---|
| Carga | Disclaimer y título del caso visibles; media de la imagen > 4/255; `hud.view` presente tras 3 cuadros |
| Teclado | `e` ×2 y `→` cambian rotación +6° y u +0,2 cm; seis `Shift+E` cambian score o rotación en plano del análisis |
| Color | Botón «Color» activo; slider «Escala (Nyquist)» → 0,3 en el store; `colorFps > 0` |
| Freeze + caliper | `Espacio` → FREEZE y slider «Cine»; dos clics con Caliper → 1 medición `linear` en cm > 0,5 |
| PW y M-mode | Strip `spectral` con `spectrumColumn`; después `m-mode` |
| Modo examen | Texto «Modo examen…»; botones Dev, Física y Referencias deshabilitados |
| Preferencias | Tras recargar, `showTorso` persiste; mediciones y pose no |
| Tutorial | En un perfil nuevo aparece el diálogo «Tutorial de controles»; «Siguiente» muestra el paso 2; «Saltar» lo cierra y no reaparece tras recargar |
| Mediciones (`e2e/measurements.spec.ts`, 2 pruebas) | «Medir Diámetro del TSVI» arma el caliper con id semántico; tras PLAX predeterminada, freeze y dos clics, la medición lleva `measurementId`, técnica con ≥ 4 hallazgos (modalidad, fase, colocación…) y score en (0, 1]; el panel muestra la píldora de técnica y el informe la columna «Técnica» y el área del TSVI derivada. Las herramientas libres siguen registrando mediciones sin id ni técnica |
| Aprendizaje (`e2e/learning.spec.ts`, 2 pruebas) | La tarea `plax-70` se completa sola al alcanzar PLAX con la vista predeterminada y persiste tras recargar; «Progreso» muestra el mejor score de PLAX; el panel de guía muestra «Por qué»; en el informe, marcar los 4 hallazgos normales da 100/100 y elegir «EA severa» sustituye a «sin EA» (grupo excluyente) y baja la puntuación |
| Equivalencia GPU (`e2e/gpu-equivalence.spec.ts`, 17 pruebas) | Para dos casos × PLAX/A4C/PSAX-AV × fases 0 y 0,35 más HTP (septo en D), taponamiento (colapso y oscilación) y MCH, el cuadro polar del trazador WebGL2 coincide con el de CPU: estructura y tejido > 99,5 %, amplitud < 1 % relativa, transmisión < 0,001 (medido: 100 %, ~10⁻⁵, ~10⁻⁷) |

El `beforeEach` de las siete primeras marca `tutorialDone` en `localStorage` para que el tutorial no tape la interfaz. Los helpers usan el gancho `window.__echotwin` (`src/main.tsx`) para leer los stores; el buffer RGBA no se serializa.

## Validación externa
El protocolo preregistrado (tres estudios: puntuación experta por vista y versión, comparación ciega con imágenes reales anonimizadas, piloto con residentes) está en `docs/VALIDATION_PROTOCOL.md`. Materiales listos: `npm run review:export` (288 imágenes + hoja CSV + guion) y la exportación anónima del progreso. **Ninguno de los tres estudios se ha ejecutado**; los resultados irán a `docs/validation/results/`.

## Pendiente de validar
- Comparación contra imágenes reales o contra un simulador físico (PyMUST/OpenBCSim/i4h): `tools/offline/{pymust-validation,optional-cuda-reference,optical-flow}` están vacías (`atlas-generation/build-atlas.ts` sólo produce hojas de contacto para inspección visual).
- Precisión numérica de las herramientas frente a la verdad de terreno a través de la UI: los E2E comprueban el flujo y la procedencia, no el valor; no hay prueba unitaria del mapeo píxel↔cm ni de velocidad/VTI/tiempo manuales.
- Color Doppler en imagen (aliasing, blooming, sombra) y M-mode: sólo humo.
- Caso de estenosis aórtica: ninguna prueba comprueba su Vmax/gradientes/AVA ni la graduación del informe (sus proporciones y su válvula sí se prueban).
- Worker (contrapresión, reciclaje), reloj/ECG en la app, audio Doppler.
- Rendimiento: `bench.ts` se ejecuta a mano; sin umbral automatizado.
- CI nunca ejecutada.
