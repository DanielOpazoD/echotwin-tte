# Motor Doppler

Todo el Doppler deriva de un **campo de flujo paramétrico** (`src/simulator/doppler/flow-primitives/flowField.ts`) alimentado por las mismas `BeatTables` que mueven el corazón: los flujos mitral, aórtico, tricuspídeo, pulmonar y regurgitantes (`mitralFlowMlps`, `aorticFlowMlps`, `tricuspidFlowMlps`, `pulmonaryFlowMlps`, `mrFlowMlps`, `arFlowMlps`), en mL/s. No hay CFD; cada sitio es un núcleo con perfil radial, ensanchamiento y turbulencia. Velocidades en m/s en el marco del corazón; los anclajes geométricos (`avAxis`, `mvCenter`, `tvCenter`, `rvotA/B`) son los del modelo anatómico y descienden con la base en cada fase (la raíz con `zAnn·ROOT_EXCURSION`, las válvulas derechas con `tvZ` y `pvZ`).

## Primitivas (`sampleFlow`)
| Sitio | Región | Velocidad | Dispersión |
|---|---|---|---|
| `mitral-inflow` | De 3 cm sobre el anillo (lado AI) hasta 0,2 cm antes del ápex; radio efectivo `r_e = √(A_mv/π)` hasta las puntas (1,2 cm) y después 0,35 cm más por cm durante 4 cm | Lado AI: sumidero hemisférico `v0·min(1, r_e²/2d²)` hacia un punto un radio del anillo más allá del orificio, entero sobre el orificio, apagado junto al anillo (coseno 0,3 → 0,6 visto desde el borde del orificio) y entre 2 y 3 cm; lado VI: perfil logístico con ½ en el radio del chorro y capa de cizalla de `0,25 + 0,25·d` cm (normalizado para que el eje conserve `v0`), decae `1/(1 + max(0, z − 1,2)/5)` y se apaga en el último centímetro; `v0 = Q_mv/A_mv`, con `A_mv` resuelta para que ∫Q_mv = VS dados E y A del caso (o fijada por `mvEffectiveAreaCm2`). Por el orificio pasa el caudal de la tabla (±5 %, decisión 166). El caudal se toma retrasado por la onda de llenado, cuyo frente es un hemisferio alrededor del orificio y cuya velocidad se resuelve para que la Vp del modo M color valga 6·e′ septal (decisión 102) | `turbulence` del caso + 0,15·ρ/R |
| `lvot` / `aortic-valve` | En la cavidad, sumidero hacia la entrada del tracto (0,8 cm bajo la válvula en `avAxis`); tubo del TSVI desde ahí; chorro hasta 5,5 cm | Cavidad: `min(v_TSVI, Q_ao/2πd²)` hacia la entrada, en un cono de 37–57° alrededor del eje, apagado entre 3 y 4,5 cm (decisión 166); tubo: `v = Q_ao/área(t)` con el perfil que se abre al anillo (decisión 161), **vena contracta** entre 0 y 1 cm con `área = AVA efectiva`, después chorro que se ensancha `1 + 0,45·(t − 1)` y se apaga entre 4 y 5,5 cm; perfil logístico con ½ en 0,917·R, con la capa de cizalla fina de un chorro rápido si AVA < 2 cm². Con obstrucción dinámica o subaórtica, un estrechamiento gaussiano centrado en t ≈ −0,6 cm resuelto para reproducir `lvotPeakGradientMmHg` | `turbulence` de `lvot` + término estenótico `min(0,6, (2 − AVA)·0,5)` distal a la válvula + 0,1·(ρ/R)⁴; la obstrucción añade `0,4·(1 − área/A_TSVI)·0,3`. Más allá de la válvula, la `turbulence` de `aortic-valve` cuando es mayor (decisión 171) |
| `tricuspid-inflow` | De 3 cm sobre el anillo tricúspide a 5 cm más allá | La misma forma que el llenado mitral con su tabla propia (área 1,35·A_mv), con la onda E 20 ms antes que la mitral porque la tricúspide abre antes (decisión 162; ya no se le suma un retraso de 0,01 del latido), decaimiento `1/(1 + (z − 1,2)/2,2)` que se apaga entre 4 y 5 cm | `turbulence` + 0,15·ρ/R |
| `rvot` | Cápsula entre `rvotA` y `rvotB`, radio 1,05 cm, que aparece en el centímetro previo a `rvotA` y se apaga en el siguiente a `rvotB` | `pulmonaryFlowMlps/(π·1,1²)` durante la eyección del VD, que empieza 15 ms antes que la aórtica y termina 25 ms después (decisión 162), con el tiempo de aceleración de la presión pulmonar (decisión 105); perfil logístico con ½ en 0,93 cm; desciende con la base (decisión 111) | `turbulence` |
| `tr-jet` | Sólo si `trPresent`; desde la coaptación (0,3 cm apical al anillo) hacia la AD, apagándose entre 3,5 y 4,5 cm; radio `√(ORE_IT/π)·1,1 + 0,28·d` si el caso define el ORE, 0,25 + 0,28·d si no | `v = Vmax_IT · sen^0,8(π·u)` durante la eyección, `Vmax_IT = √((PASP − PAD)/4)`, con decaimiento `1/(1 + (d − 1)/1,6)` más allá de 1 cm; perfil logístico con ½ en 0,84·R y la capa de cizalla fina de un chorro rápido (1 mm + 0,05 por cm); convergencia tipo PISA en el lado del VD, sobre el orificio, apagada entre 0,8 y 1,4 cm | `turbulence` de `tr-jet` (0,25 si el caso no la declara) + 0,2·ρ/R |
| `mr-jet` | Desde la coaptación (0,1 cm apical al anillo) hacia la AI, apagándose entre 4 y 5,5 cm, en el plano x–z e inclinado por la excentricidad del caso (`mrJetDirRad`); radio `√(ORE/π)·1,1 + 0,3·d` | `v = Q_IM/ORE` en la vena contracta, perfil logístico con ½ en 0,84·R y capa de chorro rápido, decaimiento `1/(1 + (d − 1,2)/1,8)` más allá de 1,2 cm; convergencia PISA en el lado del VI, sobre el orificio y apagada entre 1,2 y 1,8 cm, `v = min(0,6·v_vc, Q/(2π·d²))` (decisión 31) | `turbulence` de `mr-jet` (0,3 si no) + 0,2·ρ/R en el chorro, 0,08 en la PISA |
| `ar-jet` | Desde la válvula aórtica hacia el VI a lo largo del eje de la raíz, apagándose entre 4,5 y 6 cm; radio `√(ORE/π)·1,1 + 0,35·d` | `v = Q_IAo/ORE`, perfil logístico con ½ en 0,84·R y capa de chorro rápido, decaimiento `1/(1 + (d − 1,5)/2)` más allá de 1,5 cm; convergencia en el lado aórtico, sobre el orificio y apagada entre 1 y 1,5 cm | `turbulence` de `ar-jet` (0,3 si no) + 0,2·ρ/R en el chorro |
| `pulmonary-vein` | Venas pulmonares y su desembocadura en la AI | Ondas S, D y Ar de las tablas (decisión 35); el flujo aparece en los primeros 5 mm de la vena dibujada y se apaga entre 0,4 y 1,1 cm dentro de la AI; perfil logístico | `turbulence` de `pulmonary-vein` (0,06 si no) |

Los nueve sitios del esquema están implementados (`sampleRegurgitantJets`, `samplePulmonaryVeins`). La activación por sitio (`enabled`) y la turbulencia del caso se leen en todos (la turbulencia de los chorros regurgitantes, de las venas y de la válvula aórtica desde la decisión 171).

Cada primitiva llega a cero en su propia frontera (decisión 166): el color sólo aparece donde hay una primitiva, y un flujo que se cortaba en un cilindro, un cono o un plano dibujaba esa superficie como un borde recto (el llenado mitral del A4C normal era un rectángulo). Los flujos de las válvulas y las venas no dibujan bordes rectos de más de 5 mm en cinco vistas de los doce casos (`flowContinuity.test.ts`); los chorros regurgitantes conservan una capa de cizalla fina y su color se corta en un milímetro al costado del cono. Más allá de las puntas el chorro de llenado arrastra la sangre que lo rodea y lleva más caudal que la tabla (1,0–1,5 veces a 2,5 cm del anillo): el retorno del vórtice de llenado no se modela.

## Proyección y aliasing
Para una muestra en la dirección `d` de la línea (convertida del torso al marco cardíaco), `v_axial = −(v · d)` (positivo = hacia el transductor). La subestimación por ángulo es exactamente `cos θ` entre haz y flujo; no hay corrección de ángulo. El plegado usa `aliasVelocity(v, escala, baseline)` (`clinical/formulas`): envuelve `v` en `[−escala + baseline, escala + baseline]`. La escala se fija directamente en m/s (Nyquist); `nyquistVelocity` y `maxPrfForDepth` existen como fórmulas pero la PRF **no** se deriva de la profundidad ni limita la escala en la UI. La duración de cada estimado espectral usa la PRF que pide la escala a 2,5 MHz nominales.

## Color (`color/colorDoppler.ts`)
- Caja polar (`θ_min/θ_max`, `r_min/r_max`) editable con el ratón; sus líneas reducen el frame rate simulado (`líneas_color · paquete 8`). El campo se calcula **cada dos cuadros 2D** y se reutiliza en el intermedio.
- **Sombra**: se descarta la muestra cuya transmisión es menor que el 2 % (`DOPPLER_SHADOW_TRANSMISSION`) de la que dejaría el tejido blando (0,5 dB/cm/MHz) a esa profundidad con la frecuencia y los armónicos actuales (decisión 87). Se requiere sangre, salvo **blooming**: con `bloom = round((ganancia_dB − 2)·0,6)` muestras, el color se dilata sobre muestras vecinas (±bloom axial, ±1 línea) que toquen sangre.
- **Potencia**: la esperada es `min(1, ganancia·min(1, T_rel)·respuesta del filtro de pared de 2.º orden)`, por un speckle de potencia nuevo en cada actualización (decisión 116); por debajo de 0,25 no se pinta.
- **Estimador**: la velocidad estimada dispersa con una desviación que combina `0,035·escala`, `0,45·dispersión·|v|` y un término que crece hacia el umbral de potencia; la varianza suma esa dispersión. Filtro de pared sobre la velocidad verdadera; después aliasing.
- **Persistencia**: promedia fasores ponderados por potencia (como la autocorrelación), con peso `p^(Δt/2T)`, y no mezcla historias de otra escala, línea de base o inversión.
- Mapa: rojo hacia / azul desde, más brillante = más rápido, amarillo/cian por encima de |v/escala| > 0,55; verde de varianza cuando `showVariance` y varianza > 0,15; `invert` cambia el signo. El overlay mezcla 85 % color / 15 % gris. El modo M color (`cmm`) usa el mismo estimador a lo largo del cursor, con aliasing.

## Espectral (`spectral/spectrum.ts`, `StripEngine.sampleSpectralColumn`)
- Strip de 100 mm físicos: `columnas/s = ancho_px / (100 / velocidad_barrido)` con barrido 25/50/100 mm/s; máximo 10 columnas por paso; cada columna se calcula a la fase retro-datada que le corresponde.
- **PW**: 20 muestras pseudoaleatorias (semilla ⊕ columna) dentro de `gateDepth ± gateLength/2` con jitter lateral/elevacional ±1,75 mm; sólo sangre (las muestras sin flujo aportan v = 0 con peso 0,3, que el filtro de pared elimina salvo que valga 0); plegado activo. Cada muestra lleva su velocidad transversal y su profundidad para el ensanchamiento geométrico, y los clics valvulares (decisión 103). Gate grande → más muestras con velocidades distintas → espectro más ancho.
- **CW**: muestras cada 2,5 mm desde 1 cm hasta la profundidad a lo largo del cursor, **sin resolución de rango**; se detiene donde la transmisión **relativa** del cuadro 2D baja de 0,02 (decisión 96). CW no pliega: la distribución se centra en la velocidad verdadera y sólo se dibuja la parte dentro del rango; lo que queda fuera sale de la pantalla y no se apila en el borde (decisión 87).
- **TDI**: mismas 20 muestras del gate pero sólo miocardio; en el VI la velocidad es `MAPSE·v_long(φ)·(1 − z/L)·[1 + (e′lat/e′sep − 1)·lateralidad]` (decisión 98) y en el VD `TAPSE·v_long,VD(φ)·(1 − nivel)` (decisión 106); sin componente radial; dispersión 0,05.
- **Columna**: histograma de 128 bins sobre `[vMin, vMax]`. Cada muestra aporta un ensanchamiento asimétrico (decisión 96): hacia fuera, una resolución de 0,6 bins combinada con el ensanchamiento geométrico `v⊥·D/(F·√12)` (D = 14 mm); hacia la línea de base, además `0,9·dispersión·|v|`. Dos canales (decisión 115): la **envolvente** (normalización suave, ganancia lineal, ruido 0,05, `y^0,7`), de la que leen el trazado automático, el audio y las mediciones; y la **pantalla** (el espectro esperado por un grano exponencial de las celdas de un estimado y 1,5 bins, ruido a −36 dB y el clic, en escala logarítmica de 40 dB con el blanco a +6 dB).
- Las cotas `topValue/bottomValue` y `secondsPerColumn` del strip (en `SimOutput.strip`) son la única fuente para las herramientas de velocidad, VTI y tiempo.

## Audio (`audio/dopplerAudio.ts`)
`AudioContext` con 24 bandas de velocidad × 2 sentidos = 48 osciladores diente de sierra. Frecuencia por banda `|2·f0·v/1540|` con `f0 = 2,5 MHz` fijo (mínimo 80 Hz); ganancia `columna[bin]²·0,12`; flujo hacia el transductor al canal izquierdo, desde al derecho; `setTargetAtTime` con 20–30 ms de suavizado. Se activa con «Audio Doppler» en PW/CW/TDI; el volumen escala el nodo maestro (×0,4).

## Coherencia con la verdad de terreno
`computeGroundTruth` obtiene Vmax y VTI del TSVI y de la válvula aórtica de la **misma** curva `Q_ao(φ)` dividida por el área del TSVI y por el AVA efectivo, y RVSP de `4·Vmax_IT² + PAD`. Un PW bien alineado en el TSVI y un CW bien alineado en la válvula deben reproducir esos valores salvo cos θ, jitter del gate y ensanchamiento. `doppler.test.ts` comprueba esa coherencia, incluida la ley del coseno desplazando la sonda entre espacios intercostales (ver `docs/VALIDATION.md`).

## Valores esperados en los casos incluidos
Calculados con `computeGroundTruth`; son los números contra los que se compara una medición bien hecha. `src/tests/physicsDocs.test.ts` los recalcula: si un caso cambia, la tabla tiene que cambiar con él.

<!-- verificada: doppler-expected -->
| Caso | TSVI Vmax (m/s) | TSVI VTI (cm) | VAo Vmax (m/s) | VAo VTI (cm) | ΔP pico (mmHg) | ΔP medio (mmHg) | AVA cont. (cm²) | Índice de velocidades | E (m/s) | A (m/s) | IT Vmax (m/s) | RVSP (mmHg) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `normal-excellent-window` | 1,13 | 21,7 | 1,30 | 25,0 | 7 | 3 | 3,00 | 0,87 | 0,80 | 0,55 | 2,35 | 25 |
| `normal-difficult-window` | 1,10 | 21,2 | 1,25 | 24,0 | 6 | 3 | 2,50 | 0,88 | 0,80 | 0,55 | 2,35 | 25 |
| `aortic-stenosis-severe` | 1,19 | 22,5 | 4,69 | 88,6 | 88 | 44 | 0,88 | 0,25 | 0,65 | 0,85 | 2,96 | 38 |

El caso de ventana difícil tiene un TSVI de 1,9 cm (2,84 cm²) y un AVA efectiva de 2,5 cm², la proporción del caso normal (decisión 161; heredaba 3,0 cm², mayor que su propio TSVI, y la válvula leía más lenta que el tracto). Con la escala PW máxima de la UI (2,5 m/s) el chorro de la EA aliasea siempre en PW; sólo CW (escala hasta 7 m/s) lo recorre entero, que es la lección del caso.

## Frecuencia de cuadro: la del equipo y la cadencia del simulador (decisión 178)
Hay dos números.

- **La frecuencia de adquisición** es la del equipo simulado, la que muestra el HUD (`acquisitionFrameRate`). Depende sólo de la consola y es la misma en los tres niveles de calidad:
  - la profundidad fija el tiempo de ida y vuelta de cada disparo, más 20 µs de tiempo muerto;
  - el sector y la densidad de líneas dan las líneas de recepción: 1,0, 1,6 o 2,4 por grado, un supuesto del modelo;
  - cada disparo en 2D forma dos líneas de recepción en paralelo (MLA 2);
  - con color, cada grado de la caja lleva una línea de color con un paquete de 8 pulsos hasta el fondo de la caja.

  El 2D convencional corre a unos 40–80 cuadros/s (Fujikura et al., J Clin Med 2021), y el color focalizado a 10–30 a 12 cm con 20–60 líneas y un paquete de 8 (Puig et al., IEEE TUFFC 2024).
- **La cadencia** es cada cuánto forma el simulador un cuadro (`cadenceHz`). Nunca supera la adquisición y la acota además el trabajo del nivel, con las líneas de su cuadro polar y un tope de 90 Hz. Marca el paso del worker (acotado a 12–50 ms por paso), el presupuesto de cuadro, la traza del modo M y el intervalo sobre el que decae la persistencia. Antes de la decisión 178 era también el número del HUD, y cambiaba con el nivel de cálculo.

Con los ajustes por defecto (16 cm, 80°) y la caja de color por defecto (±0,32 rad, hasta 13 cm):

<!-- verificada: frame-rate-acquisition -->
| Densidad de líneas | Disparos 2D | 2D (Hz) | 2D + caja de color (Hz) |
|---|---|---|---|
| `low` | 40 | 109,7 | 15,4 |
| `medium` | 64 | 68,6 | 14,2 |
| `high` | 96 | 45,7 | 12,9 |

<!-- verificada: frame-rate -->
| Calidad | Cuadro polar | Cadencia 2D (Hz) | Cadencia con color (Hz) | Líneas de color del nivel |
|---|---|---|---|---|
| `low` | 90 × 160 | 48,8 | 10,5 | 41 |
| `medium` | 119 × 224 | 36,9 | 7,9 | 55 |
| `high` | 161 × 320 | 27,3 | 5,8 | 74 |

La calidad automática, la de arranque, es la alta cuando la GPU forma la imagen (decisión 154). El coste real del paso del worker es de 5–18 ms cuando la GPU forma la imagen (decisión 54), unos 40 ms con el trazador de CPU en calidad media y unos 300 ms en alta.

## Contrato de datos
- Entrada (`SimInput`): `modality`, `quality`, `color` (`ColorSettings`), `spectral` (`SpectralSettings`), `cursorThetaRad`, `gateDepthCm`, `artifactOverrides`.
- Salida (`SimOutput`): `spectrumColumn` (la última columna del canal de envolvente, 128 bins, para el audio), `spectralRange` (`vMin/vMax`), `strip` (geometría y cotas del strip), `colorFps`, y el cuadro compuesto con el color ya mezclado (el overlay se compone en el worker, no en la UI): como `bitmap` (`ImageBitmap`) cuando la GPU lo forma, con `rgba` vacío, o como `rgba` en la CPU.
