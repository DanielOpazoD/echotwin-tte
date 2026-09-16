# Arquitectura

## Capas y dependencias

| Capa                    | Carpeta                            | Responsabilidad                                                                                                                                                                | Importa de                                                                    |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Núcleo matemático       | `src/core`                         | vec3/quat, PRNG mulberry32 y `hash3`, value noise 3D, unidades (cm, m/s, mmHg, mL, s)                                                                                          | —                                                                             |
| Casos                   | `src/cases`                        | `CaseDefinitionSchema` (Zod) y 12 casos (`docs/CLINICAL_SCOPE.md`)                                                                                                             | zod                                                                           |
| Anatomía                | `src/simulator/anatomy`            | corazón paramétrico por SDF, tórax, tabla de tejidos                                                                                                                           | cases, core                                                                   |
| Ciclo cardíaco          | `src/simulator/cardiac-cycle`      | timings, tablas de latido, reloj RR, ECG sintético                                                                                                                             | cases, core                                                                   |
| Hemodinámica            | `src/simulator/hemodynamics`       | `StructuredEchoTruth` a partir de las tablas                                                                                                                                   | cardiac-cycle, clinical/formulas                                              |
| Sonda / ventanas        | `src/simulator/probe`, `windows`   | `ProbeControl → ProbePose → BeamFrame`; vistas canónicas                                                                                                                       | anatomy, core                                                                 |
| Renderer                | `src/simulator/renderer`           | interfaz `RendererBackend`, trazador procedimental, atlas, consola, scan conversion, frame rate                                                                                | anatomy, probe                                                                |
| Doppler                 | `src/simulator/doppler`            | campo de flujo, color, espectral, audio                                                                                                                                        | cardiac-cycle, clinical/formulas                                              |
| Reconocimiento de vista | `src/simulator/view-recognition`   | score 0–100 y hints deterministas                                                                                                                                              | windows, renderer/types                                                       |
| Núcleo del simulador    | `src/simulator/core`               | `SimulatorCore` (headless), `protocol.ts`, `client.ts`                                                                                                                         | todo lo anterior                                                              |
| Clínica                 | `src/clinical`                     | fórmulas puras, referencias versionadas, valores de referencia, lector NIfTI y estadísticas de región (capa hoja: cualquier capa puede leerla, ella no importa nada del motor) | —                                                                             |
| Educación               | `src/education`                    | técnica de medición, currículo, causas, impresión, informe educativo (`report.ts`) y `scoring/` (adquisición, mediciones, resumen de examen)                                   | cases, measurements, hemodynamics, renderer/types, view-recognition, clinical |
| Aplicación              | `src/app`, `src/ui`, `src/workers` | React 19, zustand, `frameBus`, three.js (torso), tutorial de 8 pasos (`Tutorial.tsx`), exportación PNG con marca de agua (`exportImage.ts`)                                    | core del simulador, clinical                                                  |

El grafo entre capas es acíclico y una prueba lo exige (`src/tests/layers.test.ts`: componentes fuertemente conexas sobre los imports reales de `src/`, con la única excepción declarada `app` ↔ `ui`). ESLint fija además las fronteras por directorio: el motor, la clínica, los casos, la educación y el núcleo no importan `app`/`ui`/`workers`/React; `src/clinical` no importa el motor ni la educación; el motor no importa `education` (los tipos del resultado de técnica viven en `measurements/types.ts`); `renderer` no importa `doppler` (la pasada de presentación recibe `ColorPresentSettings` de `renderer/types.ts`); la apertura del transductor vive en `probe/transducer.ts` para que ni `renderer` ni `doppler` dependan del otro; `src/core` no importa nada. La regla de ESLint `no-restricted-imports` bloquea `**/clinical/formulas` y `**/clinical/formulas/*` en `src/ui/**`: la UI no importa fórmulas clínicas ni por el índice ni por subruta; el cálculo de las herramientas de medición vive en `src/simulator/measurements` (`simpson.ts`, `vti.ts`).

## Flujo de datos

```
CaseDefinition (validada con Zod)
  → buildCaseModels(caseDef, patient)  [anatomy/caseModels.ts: el único sitio que encadena los tres constructores]
      createThoraxModel(bodyHabitus, acousticWindow, patient, ivc.collapsePct) → heartOffset, ivcCollapse
      createHeartModel(anatomy, physiology, heartOffset, seed, ivcCollapse)    → marco corazón↔torso
      buildBeatTables(RR, physiology, rhythm, hemodynamics)                    → V(φ), Q_ao(φ), Q_mv(φ), long(φ) (n = 512)
  → computeGroundTruth(case, tables)                           → StructuredEchoTruth (se envía a la UI en 'ready')
  → buildFlowParams(case, heart, tables)                       → primitivas de flujo (mismas tablas)

Por cada step(dt) en SimulatorCore:
  CardiacClock.advance(dt)               → phase, beatIndex, RR (determinista por semilla)
  poseFromControl → beamFrameFromPose    → origen + forward/lateral/normal + contacto
  polarSpecFor(settings, quality)        → líneas × muestras; simulatedFrameRate → intervalo de cuadro
  backend.renderDisplay(…)  [GPU]        → consola en GLSL; única lectura: gris 0..255 + structure + tissue + transmission (8 bits)
  o backend.render(…) + applyConsole     → PolarFrame con amplitud lineal → intensidades 0..255 (CPU; artefactos espejo y lóbulo lateral)
  [color]  computeColorField cada dos cuadros 2D          [strips] StripEngine.advance (stripEngine.ts): columnas espectrales / M-mode desde líneas por fase (mmodeStrip.ts)
  analyzeView cada 5 cuadros             → ViewAnalysis (score, componentes, hints)
  composite()                            → 2D/color en vivo con GPU: pasada de presentación → ImageBitmap; si no, LUT en CPU → RGBA + overlay color + strip; ECG + stats
UI:
  frameBus → DisplayCanvas dibuja el ImageBitmap (drawImage) o el RGBA (putImageData) y los overlays; el buffer (vacío con bitmap) vuelve al worker (recycle = acuse)
  herramientas → Measurement en el store → buildEducationalReport(measurements, truth, hideTruth)
  viewProgress (mejor score por vista) + mediciones → scoreAcquisition / scoreMeasurements / buildExamSummary → ReportScreen
```

Puntos de diseño que el código impone:

- **Una sola fuente de verdad fisiológica.** Volúmenes, apertura valvular, movimiento longitudinal, velocidades Doppler y verdad de terreno salen de las mismas `BeatTables`.
- **Cuadros pre-consola.** Los backends producen amplitud lineal; ganancia, TGC, compresión, foco y persistencia se aplican después, de modo que cualquier control de consola actúa sobre el mismo cuadro (también sobre el atlas). Con WebGL2 esa consola corre en la GPU sobre la misma envolvente y con los mismos parámetros (decisión 54).
- **Pose canónica alcanzable.** `canonicalControl` resuelve cada vista desde un punto de piel ajustado al centro del espacio intercostal (`snapToIntercostal`) y `canonicalBeam` la cachea por (corazón, vista, tórax); el score compara contra esa pose, no contra el plano anatómico ideal.
- **Mapas auxiliares por muestra.** `structure`, `tissue` y `transmission` viajan con el cuadro y alimentan el reconocimiento de vista (sombras), el Doppler (máscara de sangre, sombra) y las mediciones.

## Formación de la imagen acústica (decisión 52)

Los dos trazadores (CPU de referencia y WebGL2) producen el mismo cuadro polar por etapas:

1. **Muestreo de escena**: por muestra (línea, profundidad y, en el tier alto, tres planos de elevación) se clasifica el tejido y se obtienen estructura, distancia con signo a la interfaz, normal y coordenadas materiales.
2. **Acústica local**: retrodispersión incoherente σ (reflectividad × anisotropía miocárdica × heterogeneidad) y eco especular coherente sólo en la muestra que cruza la interfaz (∝ |n·d|⁴).
3. **Propagación**: transmisión de ida y vuelta acumulada a lo largo de la línea (sombras), entrada en pulmón con reverberación, clutter de campo cercano fijo a la sonda.
4. **Señal compleja**: σ × fasor de dispersores anclado al tejido + eco especular, por la transmisión.
5. **PSF y envolvente** (`renderer/acoustic/psf.ts`): pulso axial y haz lateral de ida y vuelta según profundidad, foco, frecuencia y armónicos, con núcleos de energía unidad; después, módulo de la señal. El resultado es la amplitud lineal del `PolarFrame`.

La consola trabaja sobre esa envolvente (ganancia, TGC, ruido electrónico Rayleigh, compresión, realce, persistencia y mapa de grises) y ya no aplica resolución. En la GPU las etapas 1–2 son la pasada A (tres destinos: σ/atenuación, identificadores, especular/fasor), la 3–4 la pasada B, y la 5 las pasadas C (axial) y D (lateral y envolvente), que leen la misma tabla de núcleos Float32 que la CPU desde una textura. `acoustic/acoustics.ts` define las constantes compartidas y las exporta a GLSL como `#define`.

### Espejo GLSL del clasificador

`gpu/glslHeart.ts` es un port a mano de `anatomy/classify.ts` y sus módulos, función por función. Desde la decisión 126 el clasificador CPU es un orquestador de siete bloques en `anatomy/classify/` (`root`, `valves`, `leftVentricle`, `aorticRoot`, `atria`, `rightVentricle`, `pericardium`) que comparten un contexto (`classify/context.ts`) en el mismo orden de prioridad que el sombreador; los módulos de primitivas (`valveSkirt`, `lvWall`, `rv`, `mitralValve`, `aorticValve`) siguen debajo de ambos. Los parámetros de pose llegan por la textura de parámetros (`paramLayout.ts`, `P(i)` con `#define` de desplazamientos) y los enumerados de tejido y estructura por `glslCommon.ts`; ambos son de fuente única. **Convención**: toda constante numérica que compartan el clasificador CPU y su port debe ser un `export const` en el módulo TS de anatomía e interpolarse en la cabecera de `GLSL_HEART` (`const float NOMBRE = ${f(NOMBRE)};`), nunca un literal repetido a ambos lados. `glslHeart.test.ts` comprueba en Node que cada identificador en mayúsculas que usa el shader está declarado, que cada constante interpolada se usa y que su valor es un literal GLSL bien formado; la equivalencia numérica CPU↔GPU sigue siendo cosa de `e2e/gpu-equivalence.spec.ts` en el navegador, que desde la decisión 124 acota también el desacuerdo por estructura. Las funciones escalares puras compartidas por los dos lados (`saddleOffset`, `ellipseFactor`, `axialWallFactor`, `rvAxialTaper`, `septalShiftAt`, `myoAnisoGain`, `pleuralReverberation`, `sliceHalfWidthCm`) no se espejan: `tools/glsl/ts2glsl.ts` las transpila desde su TypeScript a `gpu/glslGenerated.ts` (`npm run glsl:gen`, decisión 125) y `glslGenerated.test.ts` falla si el archivo está desactualizado.

## Cadena de imagen en GPU (decisiones 54 y 55)

Con WebGL2 por hardware el cuadro no vuelve a la CPU hasta estar formado:

1. **Pasadas A–D** (formación acústica, arriba) dejan la envolvente y la transmisión en una textura y los identificadores en otra.
2. **Consola** (`gpu/glslImage.ts`, `GLSL_CONSOLE_FRAG`): la misma secuencia que `applyConsole` —tabla de compensación por muestra (`consoleCompensation`, subida como textura), ruido Rayleigh con el mismo hash entero por línea, muestra, cuadro y semilla, compresión logarítmica, realce de bordes, persistencia contra una textura de historia en ping-pong y mapa de grises—. Escribe la historia (coma flotante) y un cuadro RGBA8 empaquetado: gris, estructura, tejido y código logarítmico de la transmisión (`transmissionCode.ts`, el mismo del atlas). `ConsoleState.gpuHistory` indica que la historia de la GPU es la del estado, de modo que alternar consola CPU y GPU nunca mezcla historias ajenas.
3. **Lectura única** de ese cuadro empaquetado (100 kB en tier medio): rellena `display`, `structure`, `tissue` y `transmission` para el cine, el análisis de vista, las máscaras Doppler y el HUD. La amplitud lineal no se lee.
4. **Presentación** (`GLSL_PRESENT_FRAG`): por píxel, la reunión bilineal entera de la LUT de conversión de barrido de la CPU, subida como texels RGBA16UI (`packScanLutTexels`) sólo cuando cambia la geometría, y el campo de color (subido cuando se recalcula) mezclado dentro de la caja con el mismo mapa de colores. La caja se prueba contra las coordenadas polares de la propia LUT (textura flotante), no con `atan` en GLSL, que es aproximado en algunas GPU. Dibuja en el lienzo del worker y `transferToImageBitmap` entrega el cuadro sin copias; el hilo principal lo dibuja con `drawImage` y lo cierra.

Siguen en la CPU, con resultado equivalente (≤ 1 nivel de gris): la consola con los artefactos espejo y lóbulo lateral (con ellos activos el cuadro va por `render` + `applyConsole`), la conversión y composición de los modos con tira (M, CMM, PW, CW, TDI; su sector se sigue formando en la GPU), la revisión de cine congelada (se compone desde el cine en CPU), el atlas en modo caché y todo el camino sin WebGL2 o con WebGL por software. Al cambiar de consola la persistencia continúa: `renderDisplay` sube la historia de la CPU cuando el cuadro anterior se formó allí, y `restoreCpuHistory` lee la de la GPU en el caso contrario. Si el contexto WebGL se pierde, incluso a mitad de un cuadro, el núcleo sustituye el port por el trazador CPU y vuelve a formar ese cuadro. `compareImageChain` (gancho de depuración) compara consola y presentación GPU con las de CPU.

## Navegador 3D (decisión 57)

`heartMesh.ts` extrae las superficies del mismo `classifyHeart` que muestrea el trazador, de modo que el navegador y la imagen no pueden discrepar: surface nets sobre una rejilla de ocupación (0,28 cm, límites (−8,−7,−7)–(7,8,12) cm del marco del corazón), siete grupos conmutables y normales geométricas ponderadas por área con dos pasadas de suavizado. `heartMesh.worker.ts` hace la extracción fuera del hilo de UI (516 ms en Node) y transfiere posiciones, normales e índices; `TorsoView` mantiene el fantasma de elipsoides hasta que llegan y sitúa las mallas con la base del marco del corazón. El plano de imagen se usa como plano de recorte local de three.js, actualizado en cada cuadro desde el origen y la normal del haz, y los ejes de examinación salen de la misma trama del haz. Sólo se vuelve a extraer al cambiar de caso o de paciente.

## Worker y protocolo

- `SimClient` (`core/client.ts`) crea `new Worker(sim.worker.ts, { type: 'module' })`; si `Worker` no existe, cae a un `SimulatorCore` inline con `setInterval` de 33 ms.
- Mensajes (`protocol.ts`): `init` / `loadCase` (caso + `SimInput`), `input`, `recycle` (devuelve el `ArrayBuffer` transferido); respuestas `ready` (con la verdad de terreno), `frame` (`SimOutput`, con `rgba` o, si la GPU formó la imagen, `bitmap` y un `rgba` vacío, ambos transferidos) y `error`.
- **El worker marca su propio ritmo contra un horario absoluto** (decisión 55): cada tick se programa a `targetMs = frozen ? 80 : clamp(12, 50, 1000/simulatedFps)` de la hora prevista del anterior, así que un temporizador tardío acorta la espera siguiente (mínimo 1 ms); tras un atasco de más de un intervalo el horario se reinicia. El núcleo conserva el resto de su acumulador de cuadro (hasta un intervalo). Con `outstanding < 2` cuadros sin reciclar se envía el cuadro; si no, se descarta (el bitmap se cierra) y el buffer vuelve al pool (contrapresión). `stats.lateMs` mide el retraso del temporizador. Si ninguna pantalla está montada (Informe, Referencias, Currículo, Progreso), `frameBus` acusa y cierra el cuadro al llegar; si no, la contrapresión dejaba al worker sin enviar cuadros al volver.
- La UI empuja `SimInput` solo cuando cambia (comparación JSON) al suscribirse al store y, como red de seguridad, cada 500 ms. `requestAnimationFrame` únicamente cuenta los fps de la UI: en pestañas ocultas el rAF se pausa pero el worker sigue simulando.
- `SimOutput` incluye la geometría del sector (`apexX/Y`, `pxPerCm`) y del strip (`secondsPerColumn`, valores superior/inferior), que son la única fuente del mapeo píxel↔unidades usado por calipers y overlays.

## Stores (zustand)

- `useSimStore` (`src/app/store.ts`): todo lo que forma el `SimInput` (sonda, paciente, `AcquisitionSettings`, modalidad, freeze/cine, color, espectral, cursor/gate, tier de calidad, backend) más modo de producto (`sandbox` / `guided` / `exam`), vista objetivo, preferencias de UI, verdad de terreno, mediciones, herramienta activa, `viewProgress` (mejor score por vista, actualizado desde `App.onFrame` con cada HUD cuando no está congelado), `examFinished`, error y modo del worker. `setMode('exam')` y `loadCase` vacían progreso y mediciones; `finishExam` congela y abre el informe. Las preferencias `showTorso`, `showHints`, `showEcg`, `tutorialDone` persisten en `localStorage` (`echotwin.prefs.v1`).
- `useHudStore`: el último `SimOutput`, actualizado como máximo cada 120 ms para que la consola no se re-renderice por cuadro.
- `frameBus`: entrega imperativa del cuadro al canvas fuera de React.

## RendererBackend

```ts
interface RendererBackend {
  readonly id: 'atlas' | 'procedural' | 'webgl2-procedural' | 'webgpu-procedural' | 'remote-cuda';
  render(scene, beam, spec, phase, out: PolarFrame, hints?): void;
  // opcional (decisión 54): renderiza y forma el display; false si este cuadro no puede formarse así
  renderDisplay?(
    scene,
    beam,
    spec,
    phase,
    out: PolarFrame,
    hints,
    console: { settings; state },
    display,
  ): boolean;
  stats(): Record<string, number | string>;
  dispose(): void;
}
```

Implementados: `ProceduralSliceRenderer` (`procedural`), su port `webgl2-procedural` y `AtlasRenderer` (`atlas`, el predeterminado en el store, que envuelve a uno de los dos). El port sólo se crea con WebGL2 por hardware: con un rasterizador por software el núcleo usa el trazador CPU (decisión 53). Los ids `webgpu-procedural` y `remote-cuda` están reservados en el tipo pero no existen.

**Atlas: caché de pose idéntica (decisión 50).** La imagen mostrada es siempre la de la pose actual. `AtlasRenderer` envuelve la fuente (WebGL2 si está disponible, si no el trazador CPU) y mide su coste. Si cabe en `budgetMs` (0,6 del intervalo de cuadro simulado, calculado por el núcleo), renderiza directamente la pose y la fase exactas y no guarda nada (histéresis ×1,25/×0,75 sobre el coste medido; los cines se liberan tras 120 cuadros directos seguidos). Si la fuente es más lenta, y sólo mientras la sonda descansa (6 cuadros con desplazamiento < 0,03), cada cuadro es el de su ranura de fase (32 por latido) para esa pose exacta (0,1 mm / 0,08°): la ranura guardada se sirve y la vacía se renderiza una vez en su fase y se guarda, de modo que el cine se llena en torno a un latido y el movimiento en reposo queda cuantizado a 32 fases. Cualquier desplazamiento renderiza la nueva pose: nunca se sustituye una pose vecina ni se mezclan anclas. Guarda hasta 4 cines y desaloja primero los incompletos. El nombre «atlas» se conserva porque el mismo contrato admitiría cines grabados de una pose idéntica; hoy no existe ninguno.

## Tiers de calidad

`polarSpecFor(settings, tier)` fija únicamente la resolución del cuadro polar; no toca la fisiología ni el score.

| Tier   | Multiplicador de líneas | Muestras base (a 16 cm) |
| ------ | ----------------------- | ----------------------- |
| low    | 0,75                    | 160                     |
| medium | 1,00                    | 224                     |
| high   | 1,35                    | 320                     |

Líneas = `round(base · mult · sector/75)` con base 64/112/160 según densidad baja/media/alta (mínimo 32); muestras escalan con `sqrt(profundidad/16)` (mínimo 96). El cuadro polar se realoja y la persistencia se reinicia cuando cambia la especificación.

## Tiempos observados (Node, `tools/offline/render/bench.ts`, tier medium, 119×224, PLAX/A4C/PSAX-PM)

Render procedimental 22–47 ms según la carga de la máquina, consola 2–3 ms, scan conversion 7–10 ms por cuadro (más en la primera ejecución por el JIT). En el navegador con WebGL2 (2026-09-11, M4 con carga alta): render 11–17 ms con lectura de vuelta, consola 2–10 ms, composición 9–26 ms. En la app el worker reporta `renderFrameMs`, `consoleMs`, `analysisMs`, `compositeMs` y `stepMs` en `SimOutput.stats` (panel Dev).
