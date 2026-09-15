# Motor Doppler

Todo el Doppler deriva de un **campo de flujo paramétrico** (`src/simulator/doppler/flow-primitives/flowField.ts`) alimentado por las mismas `BeatTables` que mueven el corazón: `Q_mv(φ)` y `Q_ao(φ)` en mL/s. No hay CFD; cada sitio es un núcleo con perfil radial, ensanchamiento y turbulencia. Velocidades en m/s en el marco del corazón; los anclajes geométricos (`avAxis`, `mvCenter`, `tvCenter`, `rvotA/B`) son los mismos del modelo anatómico.

## Primitivas (`sampleFlow`)
| Sitio | Región | Velocidad | Dispersión |
|---|---|---|---|
| `mitral-inflow` | De 2,5 cm sobre el anillo (lado AI) a 5,5 cm dentro del VI; radio `R = 1,05·r_anillo` creciendo 0,35 por cm | Lado AI: convergencia `v0·min(1, R²/2d²)·0,9`; lado VI: perfil tapón `v0·(1 − (ρ/Rj)⁶)`, decae `1/(1+(z−1,2)/2,2)` más allá de 1,2 cm; `v0 = Q_mv/A_mv`, con `A_mv` resuelta para que ∫Q_mv = VS dados E y A del caso (o fijada por `mvEffectiveAreaCm2`) | `turbulence` del caso + 0,15·ρ/R |
| `lvot` / `aortic-valve` | Tubo a lo largo de `avAxis`, de −3,5 a +5 cm respecto al anillo | `v = Q_ao/área(t)`: TSVI convergente (área crece hacia el VI), **vena contracta** entre 0 y 1 cm con `área = AVA efectiva`, después chorro que se ensancha `1 + 0,45·(t−1)`; perfil `1 − (ρ/R)⁸` | `turbulence` + término estenótico `min(0,6, (2 − AVA)·0,5)` distal a la válvula + 0,1·(ρ/R)⁴ |
| `tricuspid-inflow` | Espejo del mitral, área 1,35·A_mv, retardo de fase 0,01 | Igual que mitral | `turbulence` |
| `rvot` | Cápsula entre `rvotA` y `rvotB`, radio 1,05 cm | `Q_ao(φ+0,01)/(π·1,1²)`, perfil `1 − (ρ/1,05)⁶` | `turbulence` |
| `tr-jet` | Sólo si `trPresent`; desde la coaptación (0,3 cm apical al anillo) hacia la AD hasta 4,5 cm; radio 0,25 + 0,28·d | `v = Vmax_IT · sen^0,8(π·u)` durante la eyección, `Vmax_IT = √((PASP − PAD)/4)`; convergencia tipo PISA en el lado VD | 0,25 + 0,2·ρ/R |

No implementados aunque el esquema los admite: `mr-jet`, `ar-jet`, `pulmonary-vein`. La activación por sitio (`enabled`) y la turbulencia vienen de `flowPrimitives` del caso.

## Proyección y aliasing
Para una muestra en la dirección `d` de la línea (convertida del torso al marco cardíaco), `v_axial = −(v · d)` (positivo = hacia el transductor). La subestimación por ángulo es exactamente `cos θ` entre haz y flujo; no hay corrección de ángulo. El plegado usa `aliasVelocity(v, escala, baseline)` (`clinical/formulas`): envuelve `v` en `[−escala + baseline, escala + baseline]`. La escala se fija directamente en m/s (Nyquist); `nyquistVelocity` y `maxPrfForDepth` existen como fórmulas pero la PRF **no** se deriva de la profundidad ni limita la escala en la UI.

## Color (`color/colorDoppler.ts`)
- Caja polar (`θ_min/θ_max`, `r_min/r_max`) editable con el ratón; sus líneas reducen el frame rate simulado (`líneas_color · paquete 8`). El campo se calcula **cada dos cuadros 2D** y se reutiliza en el intermedio.
- Por muestra: descarta si `transmission < 0,2·exp(−0,23·0,5·2,5·1,2·r)` (**sombra**; usa 2,5 MHz fijo, no la frecuencia actual); requiere `Tissue.Blood`, salvo **blooming**: con `bloom = round((gain_dB − 2)·0,6)` muestras, el color se dilata sobre muestras vecinas (±bloom axial, ±1 línea) que toquen sangre.
- Filtro de pared sobre la velocidad verdadera; después aliasing; potencia `min(1, 10^(g/20)·(0,6 + 0,4·min(1, |v|/0,3)))`, por debajo de 0,25 no se pinta (ganancia baja); varianza `min(1, 1,6·dispersión)`; persistencia exponencial con el campo anterior.
- Mapa: rojo hacia / azul desde, más brillante = más rápido, amarillo/cian por encima de |v/escala| > 0,55; verde de varianza cuando `showVariance` y varianza > 0,15; `invert` cambia el signo. El overlay mezcla 85 % color / 15 % gris.

## Espectral (`spectral/spectrum.ts`, `SimulatorCore.sampleSpectralColumn`)
- Strip de 100 mm físicos: `columnas/s = ancho_px / (100 / velocidad_barrido)` con barrido 25/50/100 mm/s; máximo 10 columnas por paso; cada columna se calcula a la fase retro-datada que le corresponde.
- **PW**: 20 muestras pseudoaleatorias (semilla ⊕ columna) dentro de `gateDepth ± gateLength/2` con jitter lateral/elevacional ±1,75 mm; sólo sangre (muestras sin flujo aportan v = 0 con peso 0,3); plegado activo. Gate grande → más muestras con velocidades distintas → espectro más ancho.
- **CW**: muestras cada 2,5 mm desde 1 cm hasta la profundidad a lo largo del cursor, **sin resolución de rango**; se detiene si la transmisión del cuadro 2D baja de 0,02 (sombra); las velocidades fuera de escala se **recortan**, no se pliegan.
- **TDI**: mismas 20 muestras del gate pero sólo `Tissue.Myocardium`; velocidad `MAPSE · long′(φ) · (1 − z/L)` (anillo móvil, ápex fijo), sin componente radial; dispersión 0,05.
- Columna: histograma de 128 bins sobre `[vMin, vMax]`; cada muestra aporta una gaussiana de σ = `0,035·escala + 0,02` (**ensanchamiento intrínseco**) `+ 0,9·dispersión·|v|` (**turbulencia**); filtro de pared; normalización suave, ganancia, ruido `0,05·hash`, compresión `y^0,7`.
- Las cotas `topValue/bottomValue` y `secondsPerColumn` del strip (en `SimOutput.strip`) son la única fuente para las herramientas de velocidad, VTI y tiempo.

## Audio (`audio/dopplerAudio.ts`)
`AudioContext` con 24 bandas de velocidad × 2 sentidos = 48 osciladores diente de sierra. Frecuencia por banda `|2·f0·v/1540|` con `f0 = 2,5 MHz` fijo (mínimo 80 Hz); ganancia `columna[bin]²·0,12`; flujo hacia el transductor al canal izquierdo, desde al derecho; `setTargetAtTime` con 20–30 ms de suavizado. Se activa con «Audio Doppler» en PW/CW/TDI; el volumen escala el nodo maestro (×0,4).

## Coherencia con la verdad de terreno
`computeGroundTruth` obtiene Vmax y VTI del TSVI y de la válvula aórtica de la **misma** curva `Q_ao(φ)` dividida por el área del TSVI y por el AVA efectivo, y RVSP de `4·Vmax_IT² + PAD`. Un PW bien alineado en el TSVI y un CW bien alineado en la válvula deben reproducir esos valores salvo cos θ, jitter del gate y ensanchamiento. `doppler.test.ts` comprueba esa coherencia, incluida la ley del coseno desplazando la sonda entre espacios intercostales (ver `docs/VALIDATION.md`).

## Valores esperados en los casos incluidos
Calculados con `computeGroundTruth` (2026-09-10); son los números contra los que se compara una medición bien hecha. Un PW/CW alineado debe acercarse a ellos; el color debe aliasear cuando la escala sea menor que la velocidad proyectada.

| Caso | TSVI Vmax / VTI | VAo Vmax / VTI | ΔP pico / medio | AVA cont. / índice | E / A | IT Vmax → RVSP |
|---|---|---|---|---|---|---|
| `normal-excellent-window` | 1,13 m/s / 21,7 cm | 1,30 m/s / 25,0 cm | 7 / 3 mmHg | 3,00 cm² / 0,87 | 0,80 / 0,55 m/s | 2,35 m/s → 25 mmHg |
| `normal-difficult-window` | idénticos (mismo corazón) | | | | | |
| `aortic-stenosis-severe` | 1,19 m/s / 22,5 cm | 4,35 m/s / 82,1 cm | 76 / 38 mmHg | 0,95 cm² / 0,27 | 0,65 / 0,85 m/s | 2,96 m/s → 38 mmHg |

Con la escala PW máxima de la UI (2,5 m/s) el chorro de la EA aliasea siempre en PW; sólo CW (escala hasta 7 m/s) lo recorre entero, que es la lección del caso.

## Coste de la caja de color en el frame rate simulado
`simulatedFrameRate` con los ajustes por defecto (16 cm, 80°, densidad media) y la caja de color por defecto (±0,32 rad):

| Tier | Cuadro polar | 2D | 2D + caja de color |
|---|---|---|---|
| low | 90 × 160 | 48,8 Hz | 10,5 Hz (41 líneas × paquete 8) |
| medium | 119 × 224 | 36,9 Hz | 7,9 Hz (55 líneas) |
| high | 161 × 320 | 27,3 Hz | 5,8 Hz (74 líneas) |

A 30 cm de profundidad (medium): 20,5 Hz; a 8 cm y 40° de sector: tope de 90 Hz. Estos valores fijan la cadencia del worker (acotada a 12–50 ms por paso) y el número que muestra el HUD sobre la imagen; el frame rate real de dibujo depende además del coste del render (20–35 ms).

## Contrato de datos
- Entrada (`SimInput`): `modality`, `color` (`ColorSettings`), `spectral` (`SpectralSettings`), `cursorThetaRad`, `gateDepthCm`.
- Salida (`SimOutput`): `spectrumColumn` (última columna de 128 bins, para el audio), `spectralRange` (`vMin/vMax`), `strip` (geometría y cotas del strip), `colorFps`, y el RGBA con el color ya mezclado (el overlay se compone en el worker, no en la UI).
