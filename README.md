# EchoTwin TTE Simulator

> **Simulador educacional con pacientes sintéticos. No utilizar para diagnóstico ni toma de decisiones clínicas reales.**

Simulador educativo de ecocardiografía transtorácica (ETT) del adulto escrito en TypeScript/React. La imagen se genera de forma continua a partir de la pose de la sonda sobre un tórax paramétrico: no hay vídeos grabados ni datos de pacientes reales; anatomía, fisiología y ruido son procedimentales y reproducibles por semilla.

## Qué hace hoy
- Renderiza en tiempo real un sector 2D de un corazón analítico (funciones de distancia con signo) que late según tablas de latido derivadas de la fisiología del caso (`src/simulator/cardiac-cycle`).
- Modalidades: 2D, Color Doppler, M-mode, Doppler pulsado (PW), continuo (CW) y tisular (TDI), con audio Doppler sintetizado a partir del mismo espectro que se dibuja.
- Reconoce la vista (PLAX, PSAX ×4, A4C, A5C, A2C, A3C, apical enfocada en VD) y puntúa la adquisición con componentes explícitos y consejos deterministas de manipulación. Botones de **vistas predeterminadas** que mueven la sonda de forma continua hasta la pose canónica (deshabilitados en examen).
- Protocolo de 18 mediciones semánticas (`src/simulator/measurements/protocol.ts`) con evaluación de técnica (modalidad, vista y calidad, fase del ciclo, colocación del volumen de muestra o del caliper sobre el mapa de estructuras del cuadro, ángulo haz–flujo, acortamiento apical) en `src/education/technique.ts`; herramientas: caliper, velocidad, VTI manual y automático, tiempo, tiempo de desaceleración, Simpson monoplano y TAPSE en modo M, todas con procedencia (vista, cuadro, fase); informe educativo con la verdad del modelo, la columna de técnica y los cálculos derivados de las mediciones del alumno; en modo examen, puntuación de adquisición y mediciones ponderada por técnica (`src/education/scoring`).
- Tres casos sintéticos: normal con ventana excelente, normal con ventana difícil y estenosis aórtica severa.

Lo que **no** hace todavía está en [docs/LIMITATIONS.md](docs/LIMITATIONS.md) y [docs/CLINICAL_SCOPE.md](docs/CLINICAL_SCOPE.md).

## Instalación y comandos
Requiere Node ≥ 20 (`engines` en `package.json`). Dependencias de ejecución: react, react-dom, three, zod, zustand.

| Comando | Qué hace |
|---|---|
| `npm install` | Instala dependencias. |
| `npm run dev` | Servidor Vite de desarrollo (`.claude/launch.json` lo lanza en el puerto 5173). |
| `npm run build` | `tsc --noEmit` y después `vite build` (salida en `dist/`, chunks separados para three y react). |
| `npm run preview` | Sirve `dist/` (Playwright lo usa en el puerto 4173). |
| `npm test` | Suite Vitest (`src/**/*.test.ts`, entorno node). |
| `npm run test:e2e` | Playwright (Chromium, 1440×900) contra `npm run preview` en el puerto 4173: 9 pruebas en `e2e/core-flow.spec.ts`, 2 del protocolo de mediciones en `e2e/measurements.spec.ts`, 2 de la capa instruccional en `e2e/learning.spec.ts` y 17 de equivalencia CPU/GPU en `e2e/gpu-equivalence.spec.ts`. Requiere `npx playwright install chromium` la primera vez. |
| `npm run lint` | ESLint (incluye la regla que prohíbe importar `clinical/formulas/*` desde `src/ui`). |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` (strict, `noUncheckedIndexedAccess`). |
| `npm run check` | lint → typecheck → test → build, en ese orden. |
| `npm run golden:update` | Regenera `src/tests/goldens/frames.json` (ver `docs/validation/README.md`). |
| `npm run measure -- <caseId>` | Mide el modelo geométrico del caso (43 magnitudes: volúmenes, diámetros, grosores, raíz, anillos, índices) contra rangos adultos por sexo y marca ok/LOW/HIGH; es la misma tabla que comprueba `proportions.test.ts`. |
| `npx tsx tools/offline/render/slice-map.ts [outDir] [vistas] [caseId]` | Mapa de estructuras del plano canónico de cada vista (colores por estructura, sin acústica) para control anatómico; `audit-views.ts` imprime el error de plano/rotación de cada vista canónica frente al plano anatómico y la distancia de cada referencia al plano. |
| `npm run atlas:build` | Renderiza los cines de 16 fases de cada vista canónica (una hoja de contacto PNG por vista) con la fuente de anclas procedimental: `tools/offline/atlas-generation/build-atlas.ts [outDir] [caseId]`. |

## Controles de la sonda
La sonda se describe con `ProbeControl` (`src/simulator/probe/pose.ts`): posición en la piel `u,v` (cm; `u` hacia la izquierda del paciente, `v` hacia la cabeza), `rotationDeg` (0 = marcador hacia el hombro derecho; positivo = horario visto por el operador), `tiltDeg` (abanico: giro sobre el eje del marcador), `rockDeg` (angulación dentro del plano) y `pressure` (0–1; por debajo de 0,35 el acoplamiento es parcial).

**Torso 3D** (`src/ui/TorsoView.tsx`): arrastrar la piel = deslizar (raycast contra la malla del tórax) · arrastrar el marcador azul del transductor o rueda = rotar (±3°, Shift: ±10°) · dial 2D «marcador» con botones ±15° · Shift+arrastrar = rock · Alt+arrastrar = tilt · botón derecho = orbitar · Ctrl/⌘+rueda o botones +/− = zoom · «Sonda» centra la cámara · «Hueso» muestra/oculta la caja torácica bajo la piel. Nunca «teletransporta» a una vista.

**Imagen ecográfica** (`src/ui/DisplayCanvas.tsx`): en Color, arrastrar dentro de la caja la mueve, Shift+arrastrar la redimensiona y un clic fuera crea una nueva centrada en el clic; en PW/CW/TDI/M-mode, clic o arrastre coloca el cursor (y el gate en PW/TDI); con una herramienta de medición activa, los clics registran puntos.

**Barra inferior** (`src/ui/ModeBar.tsx`): modalidades, Freeze/Live y cine, torso, ayudas, física (líneas de barrido y zona focal), ECG, panel Dev, «Guardar PNG» (imagen + overlays con la marca de agua «SYNTHETIC TRAINING — EchoTwin TTE — no diagnóstico», `src/app/exportImage.ts`) y «Tutorial» (reinicia el tutorial de 8 pasos de `src/ui/Tutorial.tsx`, que aparece en perfiles nuevos; recarga la página).

**Teclado** (`src/app/shortcuts.ts`; se ignora cuando el foco está en un `input`, `select` o `textarea`):

| Teclas | Acción |
|---|---|
| Q / E | Rotar −/+ 3° (Shift: 15°) |
| ← → ↑ ↓ | Deslizar 2 mm (Shift: 1 cm) |
| Alt + ← → | Rock −/+ 3° |
| Alt + ↑ ↓ | Tilt +/− 3° |
| W / S | Presión +/− 0,1 |
| Espacio | Freeze / Live |
| 2 · C · M · P · X · T | 2D · Color (C alterna con 2D) · M-mode · PW · CW · TDI |
| [ / ] | Profundidad −/+ 1 cm |
| − / + | Ganancia −/+ 2 dB |
| H | Mostrar/ocultar torso 3D |
| . / , | Cine siguiente/anterior (solo en freeze) |

Límites (`clampProbe`, `clampSettings` en `src/app/store.ts`): u ±14 cm, v −12…11 cm, tilt ±70°, rock ±60°, profundidad 6–30 cm, sector 30–100°, ganancia ±30 dB, rango dinámico 30–90 dB, frecuencia 1,5–5 MHz, zoom 1–2,5×.

## Modalidades
| Modalidad | Implementación (resumen) |
|---|---|
| Currículo y progreso | Pantallas «Currículo» (5 módulos, 23 tareas verificadas automáticamente con su «por qué») y «Progreso» (mejor score por vista, técnica media, exámenes, exportación JSON local); «Por qué» en el panel de guía explica causa, efecto y remedio de cada problema de la vista. |
| Impresión estructurada | En el informe, catálogo de 29 hallazgos por dominio comparado con los que implica la verdad del caso (F1); el examen pondera adquisición 40 %, mediciones 40 %, impresión 20 %. |
| Modo M color (`cmm`, Mayús+M) | Modo M gris con la velocidad axial de flujo a lo largo del cursor superpuesta en color (plegada con la escala de color). |
| Laboratorio de artefactos | Sección del panel de consola con deslizadores de clutter, lóbulos laterales, espejo y anchura de haz que anulan los del caso y explican causa y remedio. |
| 2D | Marcha por línea de barrido a través de tórax + corazón (`renderer/procedural/sliceRenderer.ts` en CPU, referencia; `renderer/gpu/` es el mismo modelo en WebGL2 y alimenta el atlas cuando está disponible), consola (`postprocess/consolePipeline.ts`) y scan conversion por tabla de búsqueda. |
| Color | Campo de flujo paramétrico proyectado sobre cada línea, aliasing por Nyquist, filtro de pared, blooming por ganancia, sombra acústica; se recalcula cada dos cuadros 2D. |
| M-mode | Una línea por columna renderizada con el mismo trazador, sin persistencia. |
| PW / TDI | 20 muestras dentro del gate (PW: sangre; TDI: miocardio), histograma de 128 bins con ensanchamiento intrínseco y por turbulencia, aliasing. |
| CW | Muestras cada 2,5 mm a lo largo del cursor (sin resolución de rango); recorta en vez de plegar; se detiene tras una sombra. |
| Audio | 48 osciladores (24 bandas × 2 sentidos) cuya ganancia sigue la columna espectral. |

Detalle en [docs/DOPPLER_ENGINE.md](docs/DOPPLER_ENGINE.md).

## Estructura del repositorio
```
src/
  app/            App, store (zustand), frameBus, shortcuts, useSimulation, exportImage
  ui/             DisplayCanvas, TorsoView (three.js), ConsolePanel, GuidancePanel, DevPanel, Tutorial, informe, referencias
  workers/        sim.worker.ts
  simulator/
    core/         SimulatorCore (headless), protocol, client
    anatomy/      heartModel (SDF), thoraxModel, tissue, sdf
    cardiac-cycle/ timing, cycleModel (tablas de latido), clock, ecg
    hemodynamics/ groundTruth
    probe/        pose (ProbeControl → ProbePose → BeamFrame)
    windows/      viewTargets (vistas canónicas derivadas de la anatomía)
    view-recognition/ viewQuality (score + hints)
    renderer/     types (RendererBackend), procedural/ (CPU), gpu/ (WebGL2: paramLayout, glsl*, webgl2Renderer), atlas/, postprocess/, scanConvert, frameRate
    doppler/      flow-primitives, color, spectral, audio
    measurements/ types
  clinical/       formulas, guidelines/references, reference-values, reporting
  cases/          schema (Zod) y tres casos
  core/           vec3, quat, random, noise, units
  education/scoring/ scoreAcquisition, scoreMeasurements, buildExamSummary (exams/ y tutorials/ vacías)
  tests/          goldens.test.ts + goldens/frames.json
  (carpetas vacías de andamiaje: assets/, devtools/, shaders/, simulator/cine, simulator/doppler/tdi, simulator/pose-manifold, simulator/renderer/artifacts)
tools/offline/render/   render-views.ts, bench.ts, png.ts · tools/offline/atlas-generation/build-atlas.ts (hojas de contacto de cines); optical-flow/, pymust-validation/ y optional-cuda-reference/ están vacías
docs/                   esta documentación
e2e/                    core-flow.spec.ts (9 pruebas Playwright) + helpers.ts
.github/workflows/ci.yml lint → typecheck → test → build → Playwright
```

## Estado actual (observado el 2026-09-10 hacia las 20:15; el código se estaba editando activamente)
Corte vertical funcionando: ventanas paraesternal y apical de un corazón normal, Doppler paramétrico coherente con la verdad de terreno, un caso de estenosis aórtica severa y puntuación de examen. Vitest: 23 archivos / 128 pruebas, todas en verde; Playwright: 30 pruebas (flujo, mediciones, aprendizaje, equivalencia GPU), última ejecución local `passed`; lint y typecheck en verde. Hay un flujo de CI en `.github/workflows/ci.yml` que nunca se ha ejecutado: el repositorio tiene commits locales pero **sin remoto**. Detalle y avisos en [docs/VALIDATION.md](docs/VALIDATION.md).

## Documentación
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — capas, flujo de datos, worker, backends, tiers.
- [docs/CLINICAL_SCOPE.md](docs/CLINICAL_SCOPE.md) — alcance clínico V1 y lo que falta.
- [docs/ULTRASOUND_PHYSICS.md](docs/ULTRASOUND_PHYSICS.md) — qué física se aproxima y cómo.
- [docs/DOPPLER_ENGINE.md](docs/DOPPLER_ENGINE.md) — campo de flujo, color, PW/CW/TDI, audio.
- [docs/ARTIFACT_ENGINE.md](docs/ARTIFACT_ENGINE.md) — matriz causa → efecto de artefactos.
- [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) — herramientas, mapeo píxel↔unidades, procedencia.
- [docs/CASE_SCHEMA.md](docs/CASE_SCHEMA.md) — esquema Zod y verdad de terreno.
- [docs/SCORING.md](docs/SCORING.md) — score de adquisición, hints y puntuación de examen.
- [docs/VALIDATION.md](docs/VALIDATION.md) y [docs/validation/README.md](docs/validation/README.md) — pruebas y renders offline.
- [docs/ROADMAP.md](docs/ROADMAP.md) · [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
- [docs/REFERENCES.md](docs/REFERENCES.md) · [docs/THIRD_PARTY_REVIEW.md](docs/THIRD_PARTY_REVIEW.md) · [ASSET_LICENSES.md](ASSET_LICENSES.md).
