# Arquitectura

## Capas y dependencias
| Capa | Carpeta | Responsabilidad | Importa de |
|---|---|---|---|
| Núcleo matemático | `src/core` | vec3/quat, PRNG mulberry32 y `hash3`, value noise 3D, unidades (cm, m/s, mmHg, mL, s) | — |
| Casos | `src/cases` | `CaseDefinitionSchema` (Zod) y tres casos | zod |
| Anatomía | `src/simulator/anatomy` | corazón paramétrico por SDF, tórax, tabla de tejidos | cases, core |
| Ciclo cardíaco | `src/simulator/cardiac-cycle` | timings, tablas de latido, reloj RR, ECG sintético | cases, core |
| Hemodinámica | `src/simulator/hemodynamics` | `StructuredEchoTruth` a partir de las tablas | cardiac-cycle, clinical/formulas |
| Sonda / ventanas | `src/simulator/probe`, `windows` | `ProbeControl → ProbePose → BeamFrame`; vistas canónicas | anatomy, core |
| Renderer | `src/simulator/renderer` | interfaz `RendererBackend`, trazador procedimental, atlas, consola, scan conversion, frame rate | anatomy, probe |
| Doppler | `src/simulator/doppler` | campo de flujo, color, espectral, audio | cardiac-cycle, clinical/formulas |
| Reconocimiento de vista | `src/simulator/view-recognition` | score 0–100 y hints deterministas | windows, renderer/types |
| Núcleo del simulador | `src/simulator/core` | `SimulatorCore` (headless), `protocol.ts`, `client.ts` | todo lo anterior |
| Clínica | `src/clinical` | fórmulas puras, referencias versionadas, valores de referencia, informe | measurements/types |
| Educación | `src/education/scoring` | puntuación de adquisición (mejor score por vista requerida), de mediciones (tolerancia + validez técnica) y resumen de examen | cases, measurements/types, hemodynamics |
| Aplicación | `src/app`, `src/ui`, `src/workers` | React 19, zustand, `frameBus`, three.js (torso), tutorial de 8 pasos (`Tutorial.tsx`), exportación PNG con marca de agua (`exportImage.ts`) | core del simulador, clinical |

La regla de ESLint `no-restricted-imports` bloquea `**/clinical/formulas/*` en `src/ui/**`. Nótese que el patrón exige un segmento tras `formulas/`, por lo que `DisplayCanvas.tsx` importa `vtiFromEnvelope` desde el índice `@/clinical/formulas` y pasa el lint.

## Flujo de datos
```
CaseDefinition (validada con Zod)
  → createThoraxModel(bodyHabitus, acousticWindow, patient)   → heartOffset (posición/respiración)
  → createHeartModel(anatomy, physiology, heartOffset)         → marco corazón↔torso
  → buildBeatTables(RR, physiology, rhythm, hemodynamics)      → V(φ), Q_ao(φ), Q_mv(φ), long(φ) (n = 512)
  → computeGroundTruth(case, tables)                           → StructuredEchoTruth (se envía a la UI en 'ready')
  → buildFlowParams(case, heart, tables)                       → primitivas de flujo (mismas tablas)

Por cada step(dt) en SimulatorCore:
  CardiacClock.advance(dt)               → phase, beatIndex, RR (determinista por semilla)
  poseFromControl → beamFrameFromPose    → origen + forward/lateral/normal + contacto
  polarSpecFor(settings, quality)        → líneas × muestras; simulatedFrameRate → intervalo de cuadro
  backend.render(scene(φ), beam, spec)   → PolarFrame: amplitud lineal + structure + transmission + tissue
  applyConsole(frame, settings, state)   → intensidades 0..255 (polar)
  [color]  computeColorField cada dos cuadros 2D          [strips] advanceStrip: columnas M-mode / espectrales
  analyzeView cada 5 cuadros             → ViewAnalysis (score, componentes, hints)
  composite()                            → scan conversion por LUT → RGBA + overlay color + strip + ECG + stats
UI:
  frameBus → DisplayCanvas dibuja RGBA y overlays; el buffer vuelve al worker (recycle)
  herramientas → Measurement en el store → buildEducationalReport(measurements, truth, hideTruth)
  viewProgress (mejor score por vista) + mediciones → scoreAcquisition / scoreMeasurements / buildExamSummary → ReportScreen
```

Puntos de diseño que el código impone:
- **Una sola fuente de verdad fisiológica.** Volúmenes, apertura valvular, movimiento longitudinal, velocidades Doppler y verdad de terreno salen de las mismas `BeatTables`.
- **Cuadros pre-consola.** Los backends producen amplitud lineal; ganancia, TGC, compresión, foco y persistencia se aplican después, de modo que cualquier control de consola actúa sobre el mismo cuadro (también sobre el atlas).
- **Pose canónica alcanzable.** `canonicalControl` resuelve cada vista desde un punto de piel ajustado al centro del espacio intercostal (`snapToIntercostal`) y `canonicalBeam` la cachea por (corazón, vista, tórax); el score compara contra esa pose, no contra el plano anatómico ideal.
- **Mapas auxiliares por muestra.** `structure`, `tissue` y `transmission` viajan con el cuadro y alimentan el reconocimiento de vista (sombras), el Doppler (máscara de sangre, sombra) y las mediciones.

## Worker y protocolo
- `SimClient` (`core/client.ts`) crea `new Worker(sim.worker.ts, { type: 'module' })`; si `Worker` no existe, cae a un `SimulatorCore` inline con `setInterval` de 33 ms.
- Mensajes (`protocol.ts`): `init` / `loadCase` (caso + `SimInput`), `input`, `recycle` (devuelve el `ArrayBuffer` transferido); respuestas `ready` (con la verdad de terreno), `frame` (`SimOutput`, con `rgba` transferido) y `error`.
- **El worker marca su propio ritmo**: `setTimeout` con `targetMs = frozen ? 80 : clamp(12, 50, 1000/simulatedFps)` menos el coste del paso, mínimo 4 ms. Con `outstanding < 2` cuadros sin reciclar se envía el cuadro; si no, se descarta y el buffer vuelve al pool (contrapresión).
- La UI empuja `SimInput` solo cuando cambia (comparación JSON) al suscribirse al store y, como red de seguridad, cada 500 ms. `requestAnimationFrame` únicamente cuenta los fps de la UI: en pestañas ocultas el rAF se pausa pero el worker sigue simulando.
- `SimOutput` incluye la geometría del sector (`apexX/Y`, `pxPerCm`) y del strip (`secondsPerColumn`, valores superior/inferior), que son la única fuente del mapeo píxel↔unidades usado por calipers y overlays.

## Stores (zustand)
- `useSimStore` (`src/app/store.ts`): todo lo que forma el `SimInput` (sonda, paciente, `AcquisitionSettings`, modalidad, freeze/cine, color, espectral, cursor/gate, tier de calidad, backend) más modo de producto (`sandbox` / `guided` / `exam`), vista objetivo, preferencias de UI, verdad de terreno, mediciones, herramienta activa, `viewProgress` (mejor score por vista, actualizado desde `App.onFrame` con cada HUD cuando no está congelado), `examFinished`, error y modo del worker. `setMode('exam')` y `loadCase` vacían progreso y mediciones; `finishExam` congela y abre el informe. Las preferencias `showTorso`, `showHints`, `showEcg`, `tutorialDone` persisten en `localStorage` (`echotwin.prefs.v1`).
- `useHudStore`: el último `SimOutput`, actualizado como máximo cada 120 ms para que la consola no se re-renderice por cuadro.
- `frameBus`: entrega imperativa del cuadro al canvas fuera de React.

## RendererBackend
```ts
interface RendererBackend {
  readonly id: 'atlas' | 'procedural' | 'webgpu-procedural' | 'remote-cuda';
  render(scene, beam, spec, phase, out: PolarFrame): void;
  stats(): Record<string, number | string>;
  dispose(): void;
}
```
Implementados: `ProceduralSliceRenderer` (`procedural`) y `AtlasRenderer` (`atlas`, el predeterminado en el store). Los ids `webgpu-procedural` y `remote-cuda` están reservados en el tipo pero no existen.

**Por qué el atlas usa anclas procedimentales.** El atlas está pensado para servir cines pre-renderizados indexados por pose: para una pose de consulta escoge las 4 anclas más cercanas (distancia = cm de desplazamiento + 0,12·grados de ángulo entre bases, umbral 2,5) y mezcla sus 16 fases con pesos 1/(d²+0,02). No existe ningún cine grabado ni ningún paquete de anclas cargable (`tools/offline/atlas-generation/build-atlas.ts` sólo renderiza hojas de contacto de 16 fases por vista para inspección), así que la única `AnchorSource` disponible es el propio trazador procedimental del mismo paciente sintético: cuando la pose cuantizada (0,5 cm, 5°) no tiene ancla, se crea una y se construye **una fase por cuadro** (16 cuadros), manteniendo hasta 48 anclas con desalojo LRU. Mientras no hay ancla suficientemente cercana, el trazador rellena directamente con un peso `fillWeight = clamp((d_min − 0,35)/0,9)` para que la imagen nunca salte. Consecuencia honesta: durante un barrido el atlas puede costar **más** que el backend procedimental (una fase de ancla + el relleno por cuadro); el ahorro solo aparece cuando la sonda permanece cerca de anclas completas, donde el cuadro es una suma ponderada sin marcha de rayos. Los mapas `structure`/`tissue` se copian del ancla dominante (o del relleno si su peso supera 0,5).

## Tiers de calidad
`polarSpecFor(settings, tier)` fija únicamente la resolución del cuadro polar; no toca la fisiología ni el score.

| Tier | Multiplicador de líneas | Muestras base (a 16 cm) |
|---|---|---|
| low | 0,75 | 160 |
| medium | 1,00 | 224 |
| high | 1,35 | 320 |

Líneas = `round(base · mult · sector/75)` con base 64/112/160 según densidad baja/media/alta (mínimo 32); muestras escalan con `sqrt(profundidad/16)` (mínimo 96). El cuadro polar se realoja y la persistencia se reinicia cuando cambia la especificación.

## Tiempos observados (Node, `tools/offline/render/bench.ts`, tier medium, 119×224, PLAX/A4C/PSAX-PM)
Render procedimental 22–35 ms, consola 2–3 ms, scan conversion 7–10 ms por cuadro (más en la primera ejecución por el JIT). En la app el worker reporta `renderFrameMs`, `consoleMs`, `analysisMs`, `compositeMs` y `stepMs` en `SimOutput.stats` (panel Dev).
