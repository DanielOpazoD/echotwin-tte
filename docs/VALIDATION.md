# Validación

Estado observado el **2026-09-11 a las 21:21 (hora local)** sobre el commit `23eb62c`: **30 archivos, 149 pruebas unitarias, todas pasan** con `npx vitest run --testTimeout=60000 --maxWorkers=3` (82 s), y **34 pruebas E2E** —`core-flow` 10 y `gpu-equivalence` 24— en 28,5 min, todas pasan. La suite E2E completa son 42 (esas dos más `measurements` 2, `learning` 2 y `gpu-live` 4); las otras ocho se corrieron verdes justo antes de ese commit, no en esta tanda. Con la máquina cargada por otros proyectos (media 40–200 esa tarde) `npm run check` llama a `vitest run` sin ampliar el tiempo de espera y expira en tres pruebas (`measurementSupport` auto-trace, `doppler` ley del coseno, `pulmonaryVein` modo M color) que pasan con los parámetros de arriba: son artefactos de carga, no regresiones. Lint y typecheck en verde. Vuelve a ejecutar `npm test` y `npm run test:e2e` antes de fiarte de esta tabla. `.github/workflows/ci.yml` (lint → typecheck → test → build → Playwright en Chromium) existe pero nunca se ha ejecutado en remoto: el repositorio tiene commits locales y no tiene remoto.

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
| | PW pliega 1,0 m/s con escala 0,6 → −0,2; CW fuera de escala no se apila en el borde y reaparece en su velocidad al ampliar la escala (decisión 87) | — | ±0,05 | pasa |
| | PW conserva la distribución completa al cruzar Nyquist: energía de una gaussiana ancha frente a su suma analítica en cuatro posiciones junto al borde (decisión 87) | suma analítica | < 2 % | pasa |
| | Filtro de pared elimina 0,1 m/s; turbulencia ensancha > 1,5× | — | — | pasa |
| | PW en TSVI desde 9 posiciones de sonda (ajustadas al espacio intercostal, sonda re-apuntada al TSVI desde cada una para que quede en el plano): ≥ 6 con señal; mejor pico 0,45–1,6 m/s; pico ≈ \|v·d\| en el gate; la peor alineación (> 12° más) mide < 0,8× la mejor | cos θ | error < 0,35 m/s | pasa (una versión anterior mantenía la orientación y desde posiciones mediales el gate proyectado caía en los senos aórticos sin flujo) |
| | CW independiente del gate (Δ < 0,08); PW en campo cercano < PW en TSVI | — | — | pasa |
| `doppler/color/colorDoppler.test.ts` | Persistencia del color (decisión 56): con 0,5 la segunda actualización de un cuadro sintético mezcla velocidad y varianza con la primera, y con 0 es el campo crudo; a través del núcleo, cada actualización es la mezcla del campo crudo con el anterior, la versión sube una vez por actualización y el cine muestra el mismo color que el cuadro en vivo | analítico; el mismo núcleo sin persistencia | ±10⁻⁵ | pasa (3) |
| | Persistencia como autocorrelación (decisión 87): dos flujos a ambos lados de Nyquist quedan cerca de Nyquist (no −0,24 m/s); una historia de otra escala no se mezcla; la sombra sigue la frecuencia de adquisición (3,5 MHz colorea hasta el final de la caja); con −6 dB se apaga antes el flujo atenuado y una sombra real no tiene color con +12 dB | cuadros sintéticos | — | pasa |
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
| Planos canónicos (incl. subcostal 4C y VCI) | `audit-views.ts` | error de plano ≤ 7,1° salvo PSAX-VAo (16,6°) y PSAX-MV (24,3°); rotación en el plano ≤ 6,6° salvo PLAX (31,1°) y PSAX apical (19,5°); detalle en `EVALUACION_PANEL.md` | medido, con esas excepciones |

## Continuidad sonda→imagen (2026-09-11)
| Aspecto | Comprobación | Resultado |
|---|---|---|
| Sin zona muerta ni mezcla con un cine construido | `atlas.test.ts`: rotación +0,5°, +1° y +3°, tilt +3°, rock +3° y deslizamientos de 1 y 3 mm dan exactamente el render directo de la nueva pose (diferencia media < 1e-9) y una imagen distinta del cine | pasa |
| Llenar el cine no añade trabajo | `atlas.test.ts`: con la fase avanzando media ranura por cuadro, el cine se completa en ≤ 65 cuadros con ≤ 33 renders y después se sirve sin renders | pasa |
| Fuente rápida | `atlas.test.ts`: render de la fase exacta y ningún cine guardado | pasa |
| Barrido PLAX→PSAX con un cine presente | `atlas.test.ts`: diferencia máxima entre cuadros < 3,5 veces la media | pasa |

## Formación acústica de la imagen (2026-09-11)
Medido con `tools/offline/render/image-metrics.ts` en el caso normal, fase 0,35, trazador CPU (antes → después de la decisión 52):

| Magnitud | Tier medio | Tier alto | Referencia |
|---|---|---|---|
| SNR local del speckle miocárdico | 2,5–2,8 → 2,0 | 4,2–4,6 → 2,0–2,1 | 1,91 (Rayleigh) |
| Celda lateral a 3–5 / 7–9 / 11–13 cm | 0,7–0,9 / 1,1–2,2 / 2,6 mm → 1,1–1,3 / 1,6–2,0 / 2,3 mm | → 1,1–1,3 / 1,5–2,0 / 2,7 mm | crece con la profundidad, ≥ 2× la axial a media profundidad |
| Celda axial | 0,7–0,8 mm → 0,7–0,9 mm | igual | ≈ 0,9 mm a 2,5 MHz con armónicos |
| Miocardio sobre sangre alejada de paredes | 35–37 dB → 28–36 dB | 28–36 dB → 23,5–34 dB | 25–35 dB |
| Septo en A4C respecto de PLAX | −1,0 dB → −7,7 dB | −0,7 dB → −8,5 dB | 6–10 dB más oscuro con el haz a lo largo de las fibras |
| Gris por defecto miocardio / sangre / pericardio p95 | 79–108 / 1 / 144–224 → 85–132 / 11–12 / 196–255 | → 86–136 / 13–19 / 194–255 | sangre oscura pero no negra |
| Saturación con +12 dB | 0,1–0,6 % → 8–11 % | 0–0,2 % → 9–13 % | la ganancia excesiva quema |

| Aspecto | Comprobación | Resultado |
|---|---|---|
| Núcleos de energía unidad, haz que se ensancha con la profundidad y con el artefacto de anchura de haz | `psf.test.ts` | pasa |
| Speckle Rayleigh con dispersores gaussianos sintéticos (media ≈ σ, SNR 1,8–2,03) | `psf.test.ts` | pasa |
| Fasor de dispersores de media nula, potencia unidad y partes incorreladas | `psf.test.ts` | pasa |
| SNR local, celda anisótropa creciente, contraste, anisotropía y grises en PLAX/A4C | `imageFormation.test.ts` | pasa |
| Sombra de costilla independiente del muestreo: sonda sobre una costilla (A4C + 1,4 cm) y en su borde, transmisión 1 cm detrás del hueso en los tiers bajo, medio y alto con < 3 dB de diferencia (decisión 89) | `boneShadow.test.ts` | pasa |
| Imagen apical del caso de ventana óptima frente a CAMUS Good (A4C y A2C, telediástole y telesístole): doce métricas de gris, contraste, textura y forma de la escala de grises, medias de 4 realizaciones del ruido, dentro del rango intercuartílico o a menos de 0,1 anchuras de él; 23 de 48 declaradas como desviaciones del modelo, cada una con su valor basal y una tolerancia de 0,15 anchuras intercuartílicas (decisiones 88, 90 y 91) | `clinicalImage.test.ts` | pasa |
| Ruido del receptor complejo y limitado en banda: el ruido solo detecta a su suelo, un eco fijo da el segundo momento de Rice (±5%), y la correlación de potencia a una línea y a una muestra, también en la línea de modo M, es la del núcleo de recepción (±0,06) (decisión 91) | `receiverNoise.test.ts` | pasa |
| Métricas de forma de la escala de grises validadas con speckle de estadística conocida: asimetría −1,14 ± 0,05 y pendiente nula con escala lineal en dB, pendiente > 6 y asimetría > −0,9 con una escala que expande el blanco; percentil 99 sin píxeles negros (decisión 90) | `regionStats.test.ts` | pasa |
| Línea de modo M 4× más fina que el cuadro: potencia filtrada de la red (+4,25 dB, analítica frente a la red a 0,25 dB), speckle, interfaz y cursor a media celda con los niveles del cuadro (±0,3 / ±0,3 / ±0,5 dB) | `psf.test.ts` | pasa |
| Modo M por `SimulatorCore` (320 px, 100 mm/s, pasos de 50 ms): ningún salto de tiempo, eco pericárdico continuo respecto del modelo, speckle de septo y pared posterior que sigue al tejido (> 0,9) y sangre que no (< 0,65), textura de estructuras con coordenadas fijas que se desplaza con ellas, niveles por tejido frente a la línea de cuadro (±1 dB) | `mmodeStrip.test.ts` | pasa |

## Cadena de imagen en GPU (2026-09-11)
Decisiones 54 y 55. App con GPU real (Apple M4, ANGLE Metal), lienzo 890×814 px, caso normal, sonda oscilando ±1° cada 90 ms durante 9 s por tier. Carga media de la máquina: ≈ 20 antes y 7–17 después.

| Magnitud (p50 / p90 / p99) | Antes, medio | Después, medio | Antes, alto | Después, alto | Criterio |
|---|---|---|---|---|---|
| Paso del worker | 20,7 / 34,8 / 91,3 ms | 4,6 / 10,3 / 14,3 ms | 27,0 / 45,3 / 77,2 ms | 6,6 / 12,5 / 17,7 ms | < 16 ms p90 en medio |
| Espera de la GPU | 7,3 / 12,3 / 21,2 ms | 3,5 / 8,9 / 12,1 ms | — | 5,4 / 10,6 / 14,6 ms | — |
| Lectura | 2,8 / 11,5 / 20,8 ms | 0,4 / 1,5 / 2,3 ms | 5,5 / 14,3 / 29,6 ms | 0,6 / 1,6 / 2,8 ms | — |
| Consola en CPU | 1,6 / 6,0 / 16,5 ms | en GPU | 3,7 / 11,3 / 31,4 ms | en GPU | — |
| Composición en CPU | 5,8 / 12,2 / 53,7 ms | 0,1 / 0,1 / 0,2 ms | 4,7 / 15,7 / 34,4 ms | 0,1 / 0,2 / 0,3 ms | — |
| Dibujo en el hilo principal | `putImageData` de 2,9 MB | 0 / 0,1 / 0,2 ms | — | 0 / 0,1 / 0,1 ms | — |
| Cuadros entregados / simulados por segundo | 29,0 / 36,9 | 36,9 / 36,89 | 22,6 / 27,3 | 27,2 / 27,27 | la cadencia simulada |
| Cuadros descartados | 0 | 0 | 0 | 0 | 0 |

Con sólo la cadena en GPU, antes de programar el worker contra un horario absoluto, llegaban 31,5 de 36,9 cuadros/s en medio y 23,7 de 27,3 en alto: el temporizador del worker disparaba 3,8 / 8,2 ms tarde (p50/p90) y el intervalo mediano entre cuadros era 32,5 ms. Después, 27,5 ms en medio y 35,7 ms en alto. Coste por pasada medido en el M4 antes del cambio, sincronizando cada una: A 2,6 ms, B 2,7 ms, C 2,1 ms y D 1,3 ms en tier medio (5,3 ms en total sin sincronizar); por eso la marcha cuadrática de la pasada B no se reestructuró.

| Equivalencia | Configuración | Resultado |
|---|---|---|
| Cadena de cuatro cuadros formados en GPU, GPU, CPU y GPU frente a la consola CPU en todos (persistencia dentro de la GPU y en los dos cambios de consola) | PLAX medio por defecto; A4C alto con mapa high-contrast, realce 0,6, persistencia 0,6, +6 dB, TGC y rango de 45 dB; PSAX-AV medio lineal, sin realce ni persistencia, −8 dB y 20 cm | M4: diferencia media 0, máxima 1 nivel de gris, ninguna muestra > 1 en los cuatro cuadros. SwiftShader: máxima 1 nivel y ninguna muestra > 1 en los cuatro cuadros; la prueba exige media < 0,05, máxima ≤ 2 y < 0,1 % de muestras > 1 |
| Identificadores y transmisión de la lectura empaquetada | las mismas | identificadores 100 %; error relativo máximo de la transmisión 1,82 % (medio paso del código de 8 bits) |
| Presentación GPU frente a conversión de barrido + color en CPU | sector invertido de 640×520 px, color con saltos de signo como los del aliasing, valores saturados, varianza y huecos | M4: máximo 1 nivel, ningún píxel > 1 y ningún píxel coloreado sólo en un lado, 20–26 mil píxeles con color. SwiftShader: con la caja probada por `atan` en GLSL, 216–217 niveles en el 0,10–0,12 % de los píxeles del sector (bordes radiales de la caja desplazados); con la caja probada contra las coordenadas de la LUT, máximo 1 nivel, ningún píxel > 1 y ningún píxel coloreado sólo en un lado |
| Reunión entera sobre texels frente a `scanConvertLut` | tiers medio y alto, 640×520 y 890×680 invertido | idéntica en todos los píxeles, también la muestra más cercana que usa el color (`scanConvert.test.ts`) |
| Cuadros GPU en vivo frente a los mismos cuadros compuestos en CPU al congelar | app en modo color, 890×814 px, 6 cuadros emparejados por fase | 0 píxeles distintos; dos de ellos con 13 430 píxeles de color |
| Vuelta a la CPU con artefactos de consola | app en 2D, artefacto espejo 0,6 desde el laboratorio y después sin él | 43 cuadros GPU → 44 cuadros con consola y composición en CPU → 44 cuadros GPU |
| Camino completo con GPU real (`e2e/gpu-live.spec.ts`, Chromium completo headless) | cuadros en vivo en 2D y color frente a los mismos cuadros compuestos en CPU al congelar; tiras, cine y artefactos; ida y vuelta a Referencias | 4/4 con GPU real (Chromium completo en modo headless, ANGLE Metal sobre Apple M4): los cuadros en vivo en 2D (7,7 s) y en color (5,4 s) llegan como `ImageBitmap` y son idénticos a los mismos cuadros compuestos en CPU al congelar; las tiras, el cine y los artefactos van por CPU y los cuadros vuelven a la GPU al quitarlos (11,7 s); los cuadros siguen llegando tras visitar otra pantalla (5,0 s) |
| Imagen tras visitar otra pantalla | app, 2,5 s en Referencias y vuelta al simulador | antes: 55 cuadros en 1,5 s y ninguno al volver (imagen congelada); después: los cuadros siguen llegando en Referencias (95 cuadros en 2,5 s) y al volver llegan 93 en 2,5 s, todos formados en la GPU |

## Persistencia del Doppler color (2026-09-11)
Decisión 56. Pruebas en `src/simulator/doppler/color/colorDoppler.test.ts`. Cada fila se comprobó contra copias del núcleo alteradas en un directorio aparte (la corrección revertida, cada reinicio suprimido, y los lectores apuntando al buffer viejo): todas hacen fallar la prueba, ninguna copia se escribió en el árbol.

| Aspecto | Comprobación | Resultado |
|---|---|---|
| Mezcla en `computeColorField` | cuadro sintético con sangre en todas las muestras y transmisión 1; dos actualizaciones a 0,2 y 0,5 m/s con dispersión 0,1 y 0,4 | persistencia 0,5: 0,35 m/s y varianza 0,40 en toda la caja, sin escribir el campo anterior; persistencia 0: idéntica al campo crudo |
| Persistencia a través de `SimulatorCore` | caso normal, A4C canónica, tier bajo, pasos de 0,1 s: 6 actualizaciones con persistencia 0,5 frente al mismo núcleo con 0 | cada campo es la mezcla del crudo con el anterior (0 discrepancias > 10⁻⁵; 379 muestras mezcladas con un cambio > 0,05 m/s) y la versión sube una vez por actualización; con la corrección revertida, 412 discrepancias y la prueba falla |
| El compuesto muestra el campo de la última actualización | en cada actualización, R−B de cada píxel del compuesto frente al del campo nuevo y el anterior dibujados aparte (el gris se cancela en esa diferencia), sobre los píxeles que distinguen ambos campos | 9845 píxeles los distinguen y ninguno discrepa (± 2 niveles); con los lectores apuntando al buffer viejo discrepan los 9845 y la prueba falla |
| Cine frente a cuadro en vivo | los 10 cuadros de esa corrida, congelados y revisados uno a uno | 0 bytes distintos; 11 927 píxeles con color. Este par no distingue el buffer viejo —cine y vivo envejecen juntos—, por eso la fila anterior compara contra el campo de la última actualización |
| Reinicio al cambiar de modalidad y al realojarse el cuadro polar | 4 intentos en fases distintas: color → 2D → color, y alternando 16 y 13 cm de profundidad; la primera actualización tras cada cambio se compara con la del núcleo sin persistencia | idénticas en las 8 comparaciones; 290 y 442 muestras habrían cambiado de haberse mezclado. Sin el reinicio de modalidad la prueba falla con 1385 muestras distintas; sin el del cuadro polar, con 447 |
| Sin regresión en los E2E | `e2e/core-flow.spec.ts` y `e2e/gpu-equivalence.spec.ts` sobre `23eb62c`, Chromium con WebGL por software y 300 s de espera por prueba (carga 14–100) | 34/34 en 28,5 min: 10 de flujo (incluidas «Color» y freeze/cine) y 24 de equivalencia, con las tres de la cadena de imagen |
| Clave de la subida del color a la GPU (`colorVersion`) | `core/gpuPath.test.ts` (iteración 3) y `e2e/gpu-live.spec.ts` con GPU real | la versión sube exactamente una vez por actualización y no en los cuadros intermedios; en GPU real los cuadros de color en vivo son idénticos a los compuestos en CPU al congelar (4/4, con la persistencia por defecto de 0,3) |

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
- Color Doppler en imagen (aliasing, blooming, sombra): sólo humo; la persistencia del color sí tiene prueba (decisión 56). El modo M tiene pruebas de tiempo, definición, textura y niveles (decisión 84), pero no de sus mediciones (TAPSE, diámetros) frente a la verdad de terreno.
- Caso de estenosis aórtica: ninguna prueba comprueba su Vmax/gradientes/AVA ni la graduación del informe (sus proporciones y su válvula sí se prueban).
- Worker (contrapresión, reciclaje), reloj/ECG en la app, audio Doppler.
- Rendimiento: `bench.ts` se ejecuta a mano; sin umbral automatizado.
- CI nunca ejecutada.
