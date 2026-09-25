# Score de adquisición y puntuación de examen

## 1. Score de vista (`src/simulator/view-recognition/viewQuality.ts`)
El motor **mide**, nunca «encaja» la vista: compara la pose actual con la **pose canónica alcanzable** de cada `ViewTarget` de la ventana y comprueba la presencia de referencias anatómicas contra el mismo modelo que renderiza. La pose canónica (`canonicalBeam`, cacheada por corazón/vista/tórax) es la que `canonicalControl` resuelve para esta anatomía desde un punto de piel ajustado al centro del espacio intercostal (`snapToIntercostal`), no el plano anatómico ideal: así el 100 es alcanzable por un operador real en este tórax. Corre en el worker cada 5 cuadros renderizados; el resultado viaja en `SimOutput.view`.

### Ventana
`windowFromSkin(u, v)`: `v > 8` → supraesternal; `v < −7,5` → subcostal; `0 ≤ u < 5,2` y `v > −2,5` → paraesternal; `u ≥ 4,2` y `v ≤ 0,5` → apical; si no, `none`. Sólo paraesternal y apical tienen vistas; en las demás el score es 0 con un hint.

### Componentes y pesos
| Componente | Peso | Cálculo (0–1) |
|---|---|---|
| `plane` | 0,20 | `(1 − ángulo_plano/(2·tol_plano)) · (1 − rotación/(2,5·tol_rot))`; ángulo entre la normal del haz canónico y la del actual; rotación entre el `lateral` canónico proyectado sobre el plano actual y el `lateral` actual |
| `landmarks` | 0,30 | `Σ peso(visibles) / Σ peso(requeridas) − 0,12·Σ peso(penalizadoras visibles)`; una referencia «parcial» (en sector, a < 1,6 cm del plano, transmisión > 0,5) suma 0,4 de su peso |
| `geometry` | 0,15 | Apical: `1 − acortamiento/40`, con `acortamiento = ángulo(eje VI, plano) + 12·dist_plano(ápex)`; PLAX: `1 − ángulo(eje VI, plano)/35`; PSAX: `1 − max(0, obliquidad − 12)/50`, obliquidad = 90° − ángulo(eje VI, plano) (una obliquidad leve es normal) |
| `centering` | 0,10 | `1 − desplazamiento/3,5` del centro de la vista respecto al eje central del haz; 0 si está detrás. El centro es el punto objetivo llevado a la línea central del haz canónico (decisión 215): las apicales giradas alrededor del eje del VI no apuntan a su objetivo, y el preajuste del A4C se puntuaba 0,67 |
| `depth` | 0,10 | 1 dentro del rango recomendado; `1 − déficit/5` por debajo, `1 − exceso/8` por encima |
| `gain` | 0,10 | Sobre la imagen post-consola: −3·(media_sangre − 0,22) si > 0,22 (sobre-ganancia); −3·(0,32 − media_miocardio) si < 0,32 (infra-ganancia); máx. −0,7 cada uno |
| `artifacts` | 0,05 | `1 − 1,6·fracción_sombra` (muestras cardíacas con transmisión < 0,2·esperada) |

`score = 100 · Σ peso·componente`, seguido de dos compuertas: `score *= 0,35 + 0,65·plane` (un plano equivocado no se rescata con referencias compartidas entre vistas vecinas) y, si `landmarks < 0,4`, `score *= 0,5 + landmarks`. La mejor vista de la ventana es la de mayor score; `perView` conserva todas.

Visibilidad de una referencia: dentro del sector (profundidad > 0,4 cm, |θ| < sector/2 − 0,02 rad, r < profundidad − 0,3), distancia al plano `< 0,45 + 0,55·radio` cm y **no en sombra** (`transmission > 0,2·exp(−0,23·0,5·f·1,2·r)`, relativa a la atenuación esperada en tejido blando a esa profundidad).

Tolerancias (`ViewTarget.tolerance`): paraesternal 18° plano / 20° (PLAX) o 25° (PSAX) rotación / 1,5 cm; apical 15° / 20° / 1,5 cm.

### Hints deterministas
1. **`poseHints`**: si el error frente a la pose canónica ya es pequeño (plano < 8°, rotación < 10°, offset < 1,2 cm) no dice nada. Si no, prueba diez movimientos (rotar ±10°, tilt ±8°, rock ±8°, deslizar ±1 cm en u y en v), recalcula `poseError = 1,2·e_plano + 0,8·e_rotación + 0,25·offset` y devuelve los **dos** que más lo reducen, con texto en español («Rota 10° en sentido horario.», «Desliza 1,0 cm hacia la cabeza (otro espacio intercostal).»).
2. Reglas fijas: fracción de sombra > 0,35 (costilla/pulmón), cobertura cardíaca < 8 % (fuera de ventana), referencias faltantes con el plano casi correcto (< 12°), acortamiento apical > 15°, profundidad fuera de rango, `gain < 0,7` (mensaje distinto para exceso y defecto).
3. En modo guiado se añaden los `hints` estáticos del `ViewTarget` elegido y su score específico.

El `GuidancePanel` muestra el número grande (verde ≥ 75, ámbar ≥ 50, rojo), barras por componente, referencias visibles/faltantes y los hints; queda plegado por defecto tras el botón «Guía de la vista» (`ui.guidanceOpen`, decisión 141) y en modo examen se oculta todo.

### Ejemplo numérico (código del 2026-09-10 20:07, caso normal, tier low, fase 0,05)
| | PLAX | A4C |
|---|---|---|
| `ProbeControl` canónico | u 2,8 · v 1,4 · rot 0° · tilt 11,5° · rock −3,5° | u 6,6 · v −4,7 · rot 133,5° · tilt 30,5° · rock −31,5° |
| Score | **97** | **88** |
| plane / landmarks / geometry | 1,00 / 0,91 / 1,00 | 1,00 / 0,74 / 0,83 |
| centering / depth / gain / artifacts | 0,97 / 1,00 / 1,00 / 1,00 | 0,89 / 1,00 / 1,00 / 0,91 |
| Ángulo de plano / rotación / offset | 0° / 0° / 0,12 cm | 0° / 0° / 0,40 cm |
| Acortamiento | 0,1° | 6,9° |
| Visibles | mv, av, la, lvot, ivs-anteroseptal, wall-inferolateral, aortic-root | mv, tv, la, ra, rv, wall-anterolateral, ias |
| Faltantes | rv-anterior, desc-aorta | **lv-apex**, ivs-inferoseptal |
| Cobertura / sombra | 0,65 / 0,00 | 0,67 / 0,06 |
| Otras vistas de la ventana | psax-mv 16, psax-av 12, psax-pm 8 | rv-focused 42, a5c 24, a3c 9, a2c 8 |

Lectura honesta: incluso la pose canónica A4C no marca visible el ápex (la referencia está a 0,3 cm del ápex endocárdico y su tolerancia de plano es estrecha), así que el 100 no es alcanzable hoy en A4C; el componente `landmarks` es el que más separa vistas vecinas (A4C 88 frente a VD-enfocada 42 con la misma pose).

## 2. Puntuación de examen (`src/education/scoring/scoring.ts`)
- **Progreso**: `store.recordViewScore(bestViewId, score)` guarda el mejor score alcanzado por vista; lo llama `App.onFrame` con cada actualización del HUD (≤ 1 cada 120 ms) mientras no esté congelado. Se vacía al cambiar de caso, al entrar en modo examen y con `resetProgress`.
- **`scoreAcquisition(caso, progreso)`**: por cada `requiredViews[i]`, `min(100, alcanzado/minScore·100)`; el total es la media; `ok` si alcanzado ≥ mínimo. Sin vistas requeridas → 100.
- **`scoreMeasurements(caso, verdad, mediciones)`**: por cada `requiredMeasurements[i]`, `truthFor(id)` devuelve valor, unidades, etiqueta y tipo de herramienta (`linear`, `vti`, `velocity`); se elige la medición del usuario **de ese tipo más cercana a la verdad**; puntos = 100 si error ≤ `tolerancePct`, si no `max(0, 100 − 3·(error − tolerancia))`; si su `viewScore` < 50 la medición es «técnicamente inválida» y los puntos se multiplican por 0,4 aunque el número sea correcto; no medida = 0. Ids reconocidos: `lvot-diameter`, `lv-edd`, `ivsd`, `lvot-vti`, `av-vti`, `av-vmax`, `mitral-e`, `tr-vmax` (otros se omiten sin aviso).
- **`buildExamSummary`**: total = 50 % adquisición + 50 % mediciones; listas de fortalezas, errores principales, vistas omitidas, mediciones inválidas y recomendaciones de práctica. Determinista (`scoring.test.ts` exige igualdad entre dos llamadas).
- **UI** (`ReportScreen`): la tabla de vistas requeridas se muestra siempre; el resumen con puntuación aparece en sandbox/guiado como «progreso» y, en examen, sólo tras «Finalizar examen y ver puntuación» (`finishExam` congela la imagen y abre el informe). No hay límite de tiempo.

## Pruebas que lo cubren
`viewQuality.test.ts` (PLAX canónica > 70 y reconocida; PSAX-MV y PSAX-PM canónicas reconocidas, PSAX-MV > 60, y el camino PLAX→PSAX-MV interpolado en 8 pasos sin saltos > 45 puntos; A4C > 65 con acortamiento < 5° que crece al elevar la sonda; pose fuera de ventana → 0 con hint; PLAX oblicua puntúa menos y sugiere rotar/inclinar/rockear/deslizar), `simulatorCore.test.ts` (PLAX > 60 a través del núcleo) y `scoring.test.ts` (adquisición 100 con todas las vistas y parcial sin A4C; número correcto en vista con score 20 → inválido, < 50 puntos; VTI con 40 % de error pierde puntos progresivamente y `mitral-e` no medida = 0; resumen reproducible que lista A4C como omitida).

## Lo que falta
- **Scoring Doppler**: alineación del cursor con el chorro, elección PW/CW, escala/aliasing, tamaño del gate. No existe.
- **Etiquetado semántico al capturar**: dos mediciones del mismo tipo compiten por el mismo id, y una medición correcta «por casualidad» puntúa; no se comprueba fase (mesosístole para TSVI, telediástole para DTD) ni borde interno más allá del `viewScore`.
- Comparación con `impressionTruth`, uso de `learningObjectives`, tiempo, historial de sesiones (del tutorial de `Tutorial.tsx` sólo se persiste si se completó o saltó).
- Vistas subcostal y supraesternal; tolerancias por dificultad.
- El componente `gain` es independiente de la vista y `artifacts` sólo mira sombras, no reverberación ni clutter.
- Los pesos (50/50, ×0,4, −3 puntos por punto porcentual, umbral 50) son decisiones de diseño sin validación con expertos.
