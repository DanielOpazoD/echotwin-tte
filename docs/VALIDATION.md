# Validación

Estado observado el **2026-09-10 a las 22:05 (hora local)** con `npx vitest run`: **14 archivos, 73 pruebas, todas pasan**. Playwright: 9 pruebas en `e2e/core-flow.spec.ts`; `test-results/.last-run.json` registra la última ejecución local como `passed`. Lint y typecheck en verde. El árbol se estaba editando activamente mientras se escribía esto (nuevos `doppler.test.ts`, `atlas.test.ts`, `goldens.test.ts`, `scoring.test.ts`, E2E y CI aparecieron durante la sesión): vuelve a ejecutar `npm test` y `npm run test:e2e` antes de fiarte de esta tabla. `.github/workflows/ci.yml` (lint → typecheck → test → build → Playwright en Chromium) existe pero nunca se ha ejecutado porque el repositorio no tiene commits ni remoto.

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
| | PW en TSVI desde 9 posiciones de sonda (ajustadas al espacio intercostal): ≥ 6 con señal; mejor pico 0,45–1,6 m/s; pico ≈ \|v·d\| en el gate; la peor alineación (> 12° más) mide < 0,8× la mejor | cos θ | error < 0,35 m/s | pasa (sustituye a una versión que rockeaba desde el mismo origen y no podía cambiar el ángulo) |
| | CW independiente del gate (Δ < 0,08); PW en campo cercano < PW en TSVI | — | — | pasa |
| `education/scoring/scoring.test.ts` | Adquisición 100 con las 4 vistas sobre el mínimo; < 70 con PLAX 90 + A4C 35 | — | — | pasa |
| | Medición correcta (+3 %) con vista 20 → inválida, < 50 puntos; con vista 80 → 100 | — | — | pasa |
| | VTI con +40 % pierde puntos (0 < p < 100); `mitral-e` no medida = 0 | — | — | pasa |
| | Resumen reproducible; lista A4C omitida; total < 60 | — | igualdad profunda | pasa |
| `anatomy/proportions.test.ts` | 43 medidas geométricas por caso (volúmenes MC, diámetros en planos estándar, grosores, raíz, anillos, índices por BSA) contra rangos adultos por sexo (ASE/EACVI 2015, corazón derecho 2025; «≈» = aproximado); sólo salen de rango las desviaciones declaradas por el caso (`expectedDeviations`) y las limitaciones conocidas del modelo (volumen del VD); una declaración obsoleta falla | rangos de guía | rango | pasa (3 casos) |
| `tests/goldens.test.ts` | Determinismo por semilla (500 muestras iguales) | — | exacto | pasa |
| | Goldens: rejilla 12×12 de medias para PLAX/PSAX-PM/A4C/A2C a fases 0 y 0,3 (tier low) | `src/tests/goldens/frames.json` (regenerado a las 20:09) | ≤ 6 niveles por celda | pasa |

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

El `beforeEach` de las siete primeras marca `tutorialDone` en `localStorage` para que el tutorial no tape la interfaz. Los helpers usan el gancho `window.__echotwin` (`src/main.tsx`) para leer los stores; el buffer RGBA no se serializa.

## Pendiente de validar
- Comparación contra imágenes reales o contra un simulador físico (PyMUST/OpenBCSim/i4h): `tools/offline/{pymust-validation,optional-cuda-reference,optical-flow}` están vacías (`atlas-generation/build-atlas.ts` sólo produce hojas de contacto para inspección visual).
- Precisión numérica de las herramientas frente a la verdad de terreno a través de la UI: el E2E sólo comprueba que un caliper produce un valor > 0,5 cm; no hay prueba unitaria del mapeo píxel↔cm ni de velocidad/VTI/tiempo.
- Color Doppler en imagen (aliasing, blooming, sombra) y M-mode: sólo humo.
- Caso de estenosis aórtica: ninguna prueba comprueba su Vmax/gradientes/AVA ni la graduación del informe (sus proporciones y su válvula sí se prueban).
- Worker (contrapresión, reciclaje), reloj/ECG en la app, audio Doppler.
- Rendimiento: `bench.ts` se ejecuta a mano; sin umbral automatizado.
- CI nunca ejecutada.
