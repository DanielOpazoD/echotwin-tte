# Mediciones

## Herramientas disponibles (`src/ui/DisplayCanvas.tsx`, `ConsolePanel` › «Mediciones»)
| Herramienta | Dónde se usa | Interacción | Valor | Derivados |
|---|---|---|---|---|
| Caliper (`linear`) | Sector 2D/Color | Dos clics | distancia en cm | — |
| Velocidad (`velocity`) | Strip espectral (PW/CW/TDI) | Un clic sobre el espectro | |v| en m/s | `gradientMmHg = 4v²` |
| VTI (`vti`) | Strip espectral | Clics a lo largo de la envolvente; doble clic con ≥ 2 puntos cierra | VTI en cm (trapecios sobre la envolvente remuestreada columna a columna) | `vmaxMps`, `peakGradientMmHg = 4·vmax²`, `meanGradientMmHg = media(4v²)` |
| Tiempo (`time`) | Strip espectral o M-mode | Dos clics | ms | — |

La UI sugiere congelar («Congela (Espacio) y usa una herramienta») pero **no lo exige**: la herramienta funciona también en vivo. Las mediciones se listan en la consola con su modalidad y vista de origen y se pueden borrar una a una; se vacían al cambiar de caso.

## Mapeo píxel ↔ unidades
Todo sale de `SimOutput` (`src/simulator/core/protocol.ts`), que el worker calcula con la misma geometría que usa para dibujar:
- **Sector** (`SectorMapping`): `apexX`, `apexY`, `pxPerCm`, `sectorRad`, `depthCm`, `invertLR`. Distancia = `hypot(Δx, Δy) / pxPerCm`. `pixelToPolar`/`polarToPixel` (`scanConvert.ts`) convierten para la caja de color y el cursor. El zoom entra en `pxPerCm`, así que los calipers siguen siendo correctos con zoom.
- **Strip** (`StripInfo`): `y`, `height`, `topValue`, `bottomValue`, `secondsPerColumn`. Velocidad = `top + (y − y_strip)/height · (bottom − top)` (m/s; en M-mode top/bottom son profundidades en cm, pero la herramienta de velocidad sólo acepta strips espectrales). Tiempo = `|Δx| · secondsPerColumn · 1000`.
- Las coordenadas de clic se escalan de CSS a píxeles del cuadro (`toLocal`) porque el canvas se dibuja al tamaño de `SimOutput`.

## Registro de procedencia (`src/simulator/measurements/types.ts`)
```ts
interface Measurement {
  id; kind: 'linear'|'velocity'|'vti'|'time'|'area'|'volume'; label; value; units; modality;
  sourceViewId: string|null;   // bestViewId del análisis en el momento de la captura
  viewScore: number|null;       // score 0–100 de esa vista
  frameId; phase; timeS;        // cuadro y fase cardíaca del cuadro mostrado
  geometry: {x,y}[];            // píxeles de pantalla al capturar
  derived?: Record<string,number>;
  imageQualityScore: number|null; // hoy = componente gain × 100
  userAssisted: boolean;        // siempre false (no hay asistencia)
  referenceGuidelineIds: string[]; // siempre ['ase-tte-2019']
  createdAt: string;            // ISO
}
```
`kind` `area` y `volume` están reservados: no hay herramienta que los produzca. Las etiquetas son genéricas («Distancia», «Velocidad», «VTI», «Tiempo»): la medición **no sabe** si es un TSVI o un DTD.

## Fórmulas usadas (`src/clinical/formulas/index.ts`)
| Fórmula | Dónde se usa |
|---|---|
| `vtiFromEnvelope(v[], dt)` (trapecios, ×100) | Herramienta VTI |
| `simplifiedBernoulli(v) = 4v²` | Derivados de velocidad/VTI; verdad de terreno |
| `meanGradientFromEnvelope` | Verdad de terreno (la herramienta VTI calcula la media inline) |
| `circularArea`, `continuityAva`, `velocityRatio`, `strokeVolume` | Verdad de terreno (`groundTruth.ts`) |
| `bsaMosteller` | Verdad de terreno (IVAI); `bsaDuBois` existe pero no se usa |
| `ejectionFraction`, `cardiacOutput`, `rvspFromTr` | Verdad de terreno |
| `aliasVelocity`, `dopplerShiftHz` | Motor Doppler y audio |
| `formatClinical` (`reference-values`) | Presentación con decimales por familia (`ase-reporting-2025`) |

## Informe (`src/clinical/reporting/report.ts`, pantalla «Informe»)
- Una fila por medición: valor, modalidad/vista, score de vista y, salvo en modo examen, el valor «verdad» y la desviación porcentual.
- Emparejamiento heurístico: velocidad PW/CW → la más cercana entre VAo Vmax, TSVI Vmax, E mitral, IT Vmax; VTI → la más cercana entre VTI VAo y VTI TSVI; lineal → la más cercana entre DTD, TSVI, SIV, AI AP y senos. Por eso una medida errónea puede «acertar» contra el valor equivocado.
- «Calidad del estudio»: cuenta las mediciones con `viewScore < 50`.
- Puntuación (`src/education/scoring`, ver `docs/SCORING.md`): para cada `requiredMeasurements[].measurementId` toma la medición del tipo correspondiente más cercana a la verdad; 100 puntos dentro de `tolerancePct`, −3 por punto porcentual de exceso, ×0,4 si `viewScore` < 50 («técnicamente inválida»); no medida = 0. Se muestra en el informe en sandbox/guiado y, en examen, tras «Finalizar examen».
- Impresión: FE del modelo (≥ 52 % = conservada) y graduación de estenosis aórtica con los cortes de `AORTIC_STENOSIS_RULES` (severa si Vmax ≥ 4, gradiente medio ≥ 40 o AVA ≤ 1,0; moderada si Vmax ≥ 3), citando el `referenceId`. No se compara con `impressionTruth`.

## Pendientes
- Etiquetado semántico al capturar: hoy el puntuador infiere el id por tipo y cercanía, así que dos mediciones lineales compiten por el mismo id y una medición correcta «por casualidad» puntúa.
- Simpson monoplano/biplano (fórmulas listas), FAC, TAPSE (M-mode existe pero no hay caliper sobre él), áreas planimetradas, volúmenes de AI, DT/IVRT sobre el espectro con criterios de pendiente, PHT (`mvaFromPht` lista), E/e′ combinando PW y TDI, corrección de ángulo.
- Cálculos compuestos en la UI (VS, AVA por continuidad, índice de velocidades) a partir de mediciones del usuario: hoy sólo existen en la verdad de terreno.
- Asistencia (`userAssisted`) y validación de técnica (fase correcta, borde interno) más allá del `viewScore`.
