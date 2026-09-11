# Hoja de ruta

Estado real según el código el 2026-09-10. Los hitos M0–M6 siguen la especificación del proyecto (los números «spec N» de los comentarios del código); si la numeración original difiere, ajusta las etiquetas, no el estado. Leyenda: **hecho** = existe y tiene pruebas; **parcial** = existe sin pruebas o incompleto; **pendiente** = no hay código.

## M0 — Cimientos
| Entregable | Estado | Evidencia |
|---|---|---|
| Toolchain (Vite 7, TS 5.9 strict, ESLint 9, Prettier, Vitest 4, Playwright) | hecho | `package.json`, `tsconfig.json`, `eslint.config.js` |
| Núcleo matemático determinista (vec3, quat, PRNG, hash, ruido, unidades) | hecho | `src/core`, `vec3.test.ts` |
| Esquema de casos Zod con validaciones cruzadas | hecho | `src/cases/schema.ts` |
| Regla de capas UI ↛ fórmulas | parcial | la regla existe pero no cubre el import del índice |
| Control de versiones | pendiente | `.git` sin commits |
| CI (GitHub Actions: lint, typecheck, test, build, Playwright) | parcial | `.github/workflows/ci.yml` existe; nunca se ha ejecutado (sin commits ni remoto) |

## M1 — Anatomía y ciclo cardíaco
| Entregable | Estado | Evidencia |
|---|---|---|
| Corazón paramétrico SDF con contracción volumétrica, válvulas (faldones + cúspides curvas), anillos, cuerdas, aurículas, VD, papilares, pericardio | hecho | `heartModel.ts`, `heartModel.test.ts` (volumen MC ±10–12 %) |
| Tórax con costillas, esternón, pulmones, hígado, columna, aorta descendente; posición/respiración | hecho | `thoraxModel.ts` (sin prueba propia) |
| Tablas de latido (V, Q_ao, Q_mv, longitudinal), reloj RR sinusal/FA, ECG | hecho | `cycle.test.ts` |
| Verdad de terreno estructurada | hecho | `groundTruth.test.ts` |
| Posición `subcostal-supine`, VCI, venas hepáticas | pendiente | la posición no altera nada; `Structure.Ivc` sin uso |

## M2 — Render 2D y consola
| Entregable | Estado | Evidencia |
|---|---|---|
| Trazador procedimental (speckle material, especular, atenuación, sombra, reverberación, clutter, acoplamiento) | hecho | `sliceRenderer.ts`, goldens |
| Consola (TGC, ganancia, RD, foco, persistencia, mapas, zoom, inversión) | hecho | `consolePipeline.ts` (sin prueba unitaria propia) |
| Scan conversion por LUT, frame rate simulado, tiers de calidad | hecho | `scanConvert.ts`, `frameRate.ts` |
| Worker con reloj propio, contrapresión y reciclaje de buffers | hecho | `sim.worker.ts`, `client.ts` (sin prueba) |
| Sonda: pose por cuaternión, torso 3D (caja torácica completa, esternón, clavículas, transductor con marcador arrastrable y dial), atajos | hecho | `pose.ts`, `TorsoView.tsx`, `RotationDial.tsx`, `shortcuts.ts` |
| M-mode | parcial | funciona; sólo prueba de humo |
| WebGPU / backend remoto | pendiente | ids reservados en `RendererBackend` |

## M3 — Reconocimiento de vista y guía
| Entregable | Estado | Evidencia |
|---|---|---|
| 10 vistas paraesternales/apicales derivadas de la anatomía (incluye PSAX apical) | hecho | `viewTargets.ts` |
| Score por componentes con gating y hints deterministas | hecho | `viewQuality.test.ts` |
| Modo guiado con vista objetivo y vistas predeterminadas (movimiento continuo de la sonda) | hecho | `PresetViews.tsx`, `interpolate.test.ts`, prueba E2E |
| Vistas subcostal y supraesternal | pendiente | ventana detectada sin `ViewTarget` |
| Tutorial de 8 pasos (saltable, reiniciable) | hecho | `src/ui/Tutorial.tsx`, prueba E2E |

## M4 — Doppler
| Entregable | Estado | Evidencia |
|---|---|---|
| Campo de flujo paramétrico (mitral, TSVI/VAo, tricúspide, TSVD, IT) | hecho | `flowField.ts`, `doppler.test.ts` |
| Color con aliasing, filtro de pared, blooming, sombra, varianza, persistencia | parcial | funciona; sólo humo |
| PW/CW/TDI con gate, ensanchamiento, aliasing/recorte, sombra en CW | hecho | `doppler.test.ts` (cosine law, aliasing, CW sin resolución de rango) |
| Audio Doppler | parcial | sin prueba (requiere `AudioContext`) |
| Regurgitaciones (IM, IAo, IT por ERO), venas pulmonares | pendiente | sitios en el enum sin código |
| PRF ligada a la profundidad, corrección de ángulo | pendiente | fórmulas presentes, no conectadas |

## M5 — Mediciones, informe y casos
| Entregable | Estado | Evidencia |
|---|---|---|
| Caliper, velocidad, VTI, tiempo con procedencia | hecho | `DisplayCanvas.tsx`, `measurements/types.ts` (sin prueba) |
| Informe educativo con verdad y desviación; modo examen que las oculta hasta finalizar | parcial | tabla de mediciones por heurística; el puntuador empareja por tipo e id requerido |
| Casos: normal, ventana difícil, EA severa | hecho | `src/cases` (la EA queda con gradiente medio 38 mmHg, por debajo de lo que enuncia su `impressionTruth`) |
| Exportación PNG con marca de agua sintética | hecho | `src/app/exportImage.ts` (sin prueba) |
| Simpson, TAPSE, FAC, áreas, PHT | pendiente | fórmulas sí, herramientas no |
| Puntuación de examen (`requiredViews`, `requiredMeasurements`) | hecho | `src/education/scoring` + `scoring.test.ts` + «Finalizar examen» en `ReportScreen`; `impressionTruth` sigue sin uso |
| Casos con FA, alteraciones segmentarias, derrame, SAM, bicúspide | pendiente | el modelo los soporta; no hay casos |

## M6 — Atlas, validación y rendimiento
| Entregable | Estado | Evidencia |
|---|---|---|
| Atlas pose-condicionado (32 fases, anclas construidas con la sonda quieta, kNN/RBF, relleno, cuadros compactos) | hecho | `atlasRenderer.ts`, `atlas.test.ts` |
| Generación offline de atlas (`atlas:build`) | parcial | `build-atlas.ts` genera hojas de contacto de 16 fases por vista para inspección; no exporta un paquete de anclas cargable |
| Goldens por semilla y renders offline | hecho | `goldens.test.ts`, `render-views.ts` |
| Pruebas E2E | hecho | 9 pruebas Playwright en `e2e/core-flow.spec.ts`; última ejecución local `passed` |
| Validación contra PyMUST / OpenBCSim / referencia CUDA | pendiente | carpetas vacías |
| Rendimiento objetivo en navegador (render < 16 ms a calidad media) | parcial | trazador ≈ 10 ms en Node (ruido de retícula); en el navegador, con ancla completa, `stepMs` ≈ 2–3 ms; barridos ≈ 15–30 ms según núcleo |
| Documentación | hecho | `docs/` (este conjunto) |
