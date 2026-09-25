# Física del ultrasonido: qué se aproxima y cómo

El trazador procedimental (`src/simulator/renderer/procedural/sliceRenderer.ts`, con su espejo WebGL2 en `src/simulator/renderer/gpu/`, la ruta normal de la app) recorre cada línea de barrido muestra a muestra (`dr = profundidad/muestras`). Clasifica cada punto 3D contra el pulmón anterior, el corazón (`classifyHeart`) y el tórax (`classifyThorax`), y forma para cada muestra una señal compleja por cada mirada de compounding: la retrodispersión incoherente por un fasor de dispersores anclado al tejido, más los ecos coherentes (interfaces, granos, ring-down). La atenuación se aplica con la marcha del haz, una PSF separable filtra la señal y la envolvente detectada de cada mirada se promedia. No hay propagación de ondas ni portadora de RF: la señal es la envolvente compleja en banda base. La consola (`postprocess/consolePipeline.ts` en la CPU, `gpu/glslImage.ts` en la GPU) convierte la envolvente en gris de pantalla. Cada regla es explícita y está pensada para enseñar; los valores se calibraron contra imágenes clínicas de CAMUS (decisiones 69–70, 91, 144–146 y 155–157), no se midieron en tejido.

## Tabla de tejidos (`src/simulator/anatomy/tissue.ts`)
Valores del modelo, relativos entre sí. `src/tests/physicsDocs.test.ts` compara esta tabla con `TISSUE_PROPS`: cambiar un número en el código sin cambiarlo aquí hace fallar la prueba.

<!-- verificada: tissue-props -->
| Código | Tejido | Reflectividad difusa | Coeficiente especular | Atenuación (dB/cm/MHz, ida) | Frecuencia de grano (ciclos/cm) |
|---|---|---|---|---|---|
| `blood` | Sangre | 0,018 | 0 | 0,18 | 7 |
| `myocardium` | Miocardio | 0,21 | 0,12 | 0,9 | 6,5 |
| `valve` | Válvula | 0,5 | 0,7 | 0,8 | 5 |
| `pericardium` | Pericardio | 0,85 | 1 | 0,9 | 3 |
| `fat` | Grasa | 0,12 | 0,1 | 0,6 | 2,5 |
| `muscle` | Músculo | 0,05 | 0,2 | 1 | 3 |
| `bone` | Hueso | 1 | 1 | 20 | 3 |
| `spine` | Columna | 1 | 1 | 20 | 3 |
| `cartilage` | Cartílago | 0,45 | 0,5 | 3,5 | 3 |
| `lung` | Pulmón | 1 | 1 | 40 | 3 |
| `fluid` | Líquido (derrame) | 0,005 | 0 | 0,05 | 4 |
| `vessel wall` | Pared vascular | 0,55 | 0,6 | 0,9 | 3 |
| `calcium` | Calcio | 1 | 1 | 25 | 3 |
| `skin` | Piel | 0,5 | 0,4 | 1,2 | 4 |
| `liver` | Hígado | 0,35 | 0,1 | 0,7 | 3 |
| `fibrous annulus` | Tejido fibroso (anillos, fascia, diafragma) | 0,65 | 0,8 | 1 | 4 |
| `chordae` | Cuerdas tendinosas | 0,3 | 0,4 | 0,8 | 5 |

- La frecuencia de grano sólo se usa en miocardio, músculo e hígado, como retículo de los granos coherentes (decisión 145); el tamaño del speckle lo fija la PSF.
- Los valores de `lung` no intervienen: la línea termina en la pleura y detrás sólo hay reverberación.
- `calcium` no lo asigna ningún clasificador: la calcificación valvular es `extraReflect` (0–1) sobre `valve`, y también llega al anillo mitral como 0,15 × calcificación.
- La atenuación es de ida, en dB/cm/MHz; `ATTEN_NP_PER_DB = 0,23` (= 2·ln 10/20) la convierte en nepers de amplitud de ida y vuelta.
- El músculo está en 0,05 desde la decisión 156: con 0,2, isótropo, leía más brillante que el miocardio que tiene debajo, y la banda de 0–2 cm del sector apical 148 frente a 105 en CAMUS Good.

## Pared torácica, costillas y posición del corazón
Las costillas son cartílago a menos de 5 cm del esternón y hueso más allá; su eje está a 0,7 de la pared torácica, el espacio intercostal crece un 3 % por cm lateral y el radio del tubo cae hasta un 45 % a 8 cm del esternón (`ribSpacingAt`, `ribRadiusAt`). La pared tiene capas (decisión 144): piel de 0,15 cm, grasa subcutánea hasta el 45 % del grosor, una fascia fibrosa de 0,8 mm que refleja de forma coherente y músculo. El corazón se retrasa `max(0, pared efectiva − 0,8)` cm (`heartOffset.z`), con pared efectiva `espesor·(1 + 0,8·obesidad)`; la posición del paciente y la respiración lo desplazan además (decúbito lateral izquierdo, inspiración).

## Formación de la señal en el trazador
| Fenómeno | Cómo se calcula |
|---|---|
| Retrodispersión difusa y speckle | σ = reflectividad × anisotropía × heterogeneidad × ganancia de enfoque, por un fasor complejo de dispersores: dos retículos anclados al tejido (25 celdas/cm y ×1,137), normalizados a E\|z\|² = 1, cuya celda de través al plano es el grosor del corte (decisión 99). La sangre refleja ×0,6 con armónicos. Anisotropía: en las paredes del VI y la pared libre del VD, una hélice de fibras de +60° en el endocardio a −60° en el epicardio, con piso 0,15 cuando el haz va a lo largo de la fibra; las paredes auriculares y el septo interauricular no tienen anisotropía; el resto del miocardio sigue `0,15 + 0,85·\|n·d\|²`. Heterogeneidad: 6 dB pico a pico en el miocardio y 4 dB en hígado y músculo, a 1,6 ciclos/cm. |
| Compounding | Cada cuadro se forma con dos miradas (`COMPOUND_LOOKS`): la misma escena con el retículo de dispersores desplazado, detectadas por separado y promediadas (decisión 145). Los ecos coherentes son iguales en las dos. |
| Sangre en movimiento | Los dispersores de la sangre viajan con el flujo, de 1 a 20 mm entre dos cuadros, y su speckle no se conserva de un cuadro al siguiente: cada cuadro desplaza su retículo `BLOOD_DECORRELATION_CELLS` celdas (decisión 163), como cada pulso en el modo M. El speckle del tejido sí se conserva y se mueve con él. La persistencia de la consola promedia así la sangre y no el tejido. |
| Granos coherentes | En miocardio, músculo e hígado, una componente coherente escasa: σ × 4,8 × el exceso de un retículo a la frecuencia de grano del tejido sobre el umbral 0,72, promediado ¼ ½ ¼ sobre tres retículos que cubren el grosor del corte (decisión 145). |
| Interfaces especulares | Un eco coherente en la muestra que cruza la interfaz (`\|sdf\| < max(\|n·d\|, 0,15)·dr`): coeficiente especular × \|n·d\|⁴ (×1,1 con armónicos) × ganancia de enfoque, con fase 0 y la PSF como único ensanchamiento. En las valvas se pondera por la fracción del corte que ocupa la lámina (`membraneWeight`, decisión 147). Del VI sólo el epicardio refleja de forma coherente. La fase de rango de estos ecos se probó y no se adoptó (decisión 158). |
| Calcificación | `+ extraReflect · 1,5 · (0,6 + 0,8·ruido)` y una atenuación extra de 0,09·extraReflect Np por cada 0,7 mm recorridos (≈ 10 dB/cm a 2,5 MHz) cuando extraReflect > 0,4. |

## Haz, PSF y enfoque (`acoustic/psf.ts`, `acoustic/acoustics.ts`)
- **Pulso axial**: anchura a media altura `0,77·(2,5/f)·1,35` mm (×1,15 con armónicos), unos 1,20 mm a 2,5 MHz con armónicos.
- **Haz lateral de ida y vuelta**: recepción dinámica con número F ≥ 1 combinada con una transmisión gaussiana enfocada, apertura de 14 mm y λ = 1,54/f mm, ×0,8 con armónicos; el artefacto «anchura de haz» la multiplica por `1 + 1,6·intensidad·min(1, |r − foco|/6)`. A 9 cm y 2,5 MHz con armónicos mide unos 2,3 mm.
- **Lóbulos laterales** (decisión 155): cuatro lóbulos de signo alterno y periodo λ/D (×0,8 con armónicos) tras el lóbulo principal, el primero a −35 dB; el artefacto «lóbulos laterales» los sube hasta 20 dB. El lóbulo principal se limita a 8 líneas y el núcleo entero a 32. El ruido del receptor usa la respuesta sin lóbulos.
- **Ganancia de enfoque** (decisión 144): la sensibilidad sobre el eje de una apertura que converge hacia el foco (semiapertura 7 mm, semielemento 6,5 mm, cinturas de 2 mm); unos −11 dB junto a la cara con el foco a 9 cm. La consola devuelve lo que se pierde más allá del foco y nada de lo de antes.
- **Grosor de corte**: semiancho `0,2 + 0,04·|r − foco|` cm. En calidad alta, σ y el eco especular son la media ¼ ½ ¼ de tres planos de elevación; en todas las calidades el speckle y los granos se descorrelacionan con el grosor del corte. Las valvas no se promedian: se ponderan por `membraneWeight`.

<!-- verificada: beam-psf -->
| Constante | Valor | Qué es |
|---|---|---|
| `APERTURE_MM` | 14 | apertura lateral (mm) |
| `PSF_AXIAL_SCALE` | 1,35 | escala del pulso axial sobre la fórmula (decisión 145) |
| `PSF_LATERAL_SCALE` | 1 | escala del haz lateral sobre la fórmula |
| `SIDE_LOBE_DB` | −35 | primer lóbulo lateral bajo el lóbulo principal (dB) |
| `SIDE_LOBE_COUNT` | 4 | lóbulos laterales modelados |
| `SIDE_LOBE_ARTIFACT_DB` | 20 | subida máxima de los lóbulos con el artefacto (dB) |
| `MAIN_LOBE_MAX_RADIUS` | 8 | radio máximo del lóbulo principal (líneas) |
| `MAX_LATERAL_RADIUS` | 32 | radio máximo del núcleo lateral (líneas) |
| `FOCUS_HALF_APERTURE_MM` | 7 | semiapertura de la ganancia de enfoque (mm) |
| `FOCUS_HALF_ELEVATION_MM` | 6,5 | semielemento en elevación (mm) |
| `SLICE_HALF_BASE_CM` | 0,2 | semigrosor del corte en el foco (cm) |
| `SLICE_HALF_SLOPE` | 0,04 | crecimiento del semigrosor por cm lejos del foco |
| `COMPOUND_LOOKS` | 2 | miradas de compounding |
| `BLOOD_DECORRELATION_CELLS` | 2,7 | desplazamiento del retículo de la sangre por cuadro o pulso (celdas) |
| `GRAIN_GAIN` | 4,8 | ganancia de los granos coherentes |
| `GRAIN_THRESHOLD` | 0,72 | umbral del retículo de granos |
| `MYO_ANISO_FLOOR` | 0,15 | piso de la anisotropía miocárdica |
| `HARMONIC_ATTEN_FACTOR` | 1,2 | factor de la atenuación con armónicos |
| `SOFT_TISSUE_ATTEN_DB` | 0,5 | atenuación del tejido blando de referencia para sombras (dB/cm/MHz) |
| `BLOOD_HARMONIC_SIGMA` | 0,6 | retrodispersión de la sangre con armónicos |
| `SPECULAR_HARMONIC` | 1,1 | eco especular con armónicos |
| `ATTEN_NP_PER_DB` | 0,23 | nepers de amplitud de ida y vuelta por dB/cm/MHz |
| `WINDOW_ATTEN_GAIN` | 1,5 | atenuación extra de la pared con mala ventana |
| `BEAM_ATTEN_MAX_HALF_ANGLE_RAD` | 0,208 | semiángulo máximo de la media de la marcha del haz (rad; 24 líneas de la malla calibrada) |
| `BEAM_ATTEN_MAX_LINES` | 36 | líneas que recorre como máximo el bucle GPU de esa media (la malla más densa pide 34) |
| `TRANSMISSION_FLOOR` | 0,0001 | suelo de la transmisión |

## Atenuación, sombras y marcha del haz
Cada muestra pierde `0,23·α·f·dr` nepers de amplitud de ida y vuelta, con α la atenuación de la tabla y f ×1,2 con armónicos; todos los tejidos, hueso incluido, atenúan por distancia (decisión 89). La grasa, el músculo y la piel fuera del corazón se multiplican por `1 + 1,5·chestWallAttenuation`. La transmisión de un cuadro no es la del rayo: en cada profundidad se usa la media de los incrementos de las líneas que caben en la semianchura del haz (hasta ±0,208 rad, unos 12°: el mismo ancho físico en los tres niveles de calidad; hasta la decisión 215 eran 24 líneas, y el borde de una costilla cruzada en oblicuo sombreaba 13 dB más en el nivel alto que en el bajo), sin contar las muestras fuera del cuerpo ni las de pulmón (`beamMarch`, decisión 144). Suelo 1e-4. Tras una costilla ósea la transmisión cae a ~0; tras el cartílago paraesternal (3,5 dB/cm/MHz) la sombra es parcial, y la marcha del haz suaviza sus bordes. El mapa de transmisión viaja con el cuadro (en la GPU como código logarítmico de 8 bits) para que el Doppler y la calidad de vista lo consulten.

## Pulmón y reverberación pleural
Antes de clasificar el corazón, `isAnteriorLung` comprueba si el punto cae en la lengüeta de pulmón interpuesta entre la pared y el corazón, lateral a la escotadura cardíaca; además el pulmón envuelve el pericardio fuera del mediastino (decisiones 144 y 150) y el decúbito lateral izquierdo abre 1,6 cm la escotadura. Al entrar en `lung` la línea queda muerta: la muestra de entrada es un eco coherente `transmisión·(1,2 + 0,4·ruido)` y las siguientes reciben líneas A, pulsos `exp(−(d/0,12)²)` (σ ≈ 0,85 mm) a múltiplos de la profundidad pleural que decaen 0,55 por orden con ganancia 0,9, sumados como un tren continuo (decisión 119), sobre una neblina difusa `0,35·exp(−d/1,5 cm)·(0,4 + 0,6·ruido)`. La reverberación es incoherente, distinta en cada mirada.

## Acoplamiento, clutter y ring-down
- **Acoplamiento parcial**: `contactQuality(p) = p/0,35` si p < 0,35, si no 1; cada línea cuyo `hash3(línea)` supere el contacto se atenúa ×0,08 entera. La presión hunde el origen del haz `0,3 + 0,5·p` cm bajo la piel.
- **Clutter de campo cercano**: para r < 4,5 cm, `clutter · exp(−r/1,8) · (0,15 + 0,5·ruido)`, con `clutter = (2,5·clutterLevel + 0,8·chestWallAttenuation)·√(2,5/f)` (×0,35 con armónicos) y `clutterLevel = min(1, nivel de la ventana + 0,6 × artefacto «clutter de campo cercano») + 0,5·enfisema`. Es un fasor incoherente fijo a la sonda, uno por mirada.
- **Ring-down del transductor**: en los primeros 3,5 mm, un eco coherente débil `0,05·(1 − r/0,35 cm)`.

Todo el ruido deriva de `latticeNoise3` (un retículo por semilla) y de `hash3`; con la misma semilla e índice de cuadro el cuadro es idéntico (prueba en `src/tests/goldens.test.ts`).

## Consola (`applyConsole`, en orden)
1. **Ruido del receptor**: señal compleja gaussiana por muestra, cuadro y semilla, filtrada por la respuesta de recepción (sin lóbulos laterales) y detectada junto con el eco como \|A + n\| (decisión 91); el suelo de ruido `NOISE_FLOOR` es por mirada y el compounding lo divide por √2.
2. **Compensación**: `comp = 10^(min(0,7·f·r + D(r) + TGC(r), 60)/20) · 10^(ganancia/20)`, con D(r) la corrección de difracción más allá del foco (0 antes; unos +9 dB a 16 cm con el foco a 9) y el TGC interpolado entre 8 bandas de ±15 dB. Amplifica por igual el eco y el ruido.
3. **Espejo** (sólo con el artefacto activo, y entonces el cuadro se forma en la CPU): más allá de la primera interfaz pericárdica o pleural fuerte a más de 5 cm se repite la imagen superficial atenuada.
4. **Compresión logarítmica**: `y = (20·log10(a + 10⁻⁶) − REF_DB + RD)/RD` recortado a [0, 1], con REF_DB = −4 dB y RD = rango dinámico (30–90 dB).
5. **Realce de bordes**: unsharp axial suave (`realce·0,8`).
6. **Persistencia**: `y = a·(1 − p′) + prev·p′` con `p′ = p^max(0,25, Δt/intervalo)` en tiempo simulado (decisión 94); se reinicia al cambiar la geometría del cuadro. El modo M no tiene persistencia.
7. **Mapa de gris**: `clinical` (por defecto), `((1 + C)^y − 1)/C` con C = 3,5; lineal; curva S (`smoothstep·0,85 + lineal·0,15`); o alto contraste (`y^1,6`).

La resolución axial y lateral ya no son pasos de la consola: las forma la PSF del trazador (decisión 52).

<!-- verificada: console-defaults -->
| Ajuste | Valor | Qué es |
|---|---|---|
| `settings.depthCm` | 16 | profundidad (cm) |
| `settings.sectorDeg` | 80 | sector (°) |
| `settings.gainDb` | 0 | ganancia (dB) |
| `settings.dynamicRangeDb` | 70 | rango dinámico (dB) |
| `settings.frequencyMHz` | 2,5 | frecuencia (MHz) |
| `settings.focusCm` | 9 | foco (cm) |
| `settings.persistence` | 0,35 | persistencia |
| `settings.edgeEnhance` | 0,1 | realce de bordes |
| `settings.grayMap` | `clinical` | mapa de gris |
| `settings.lineDensity` | `medium` | densidad de líneas |
| `DEPTH_COMPENSATION_DB_PER_CM_MHZ` | 0,7 | compensación por defecto (dB/cm/MHz) |
| `REF_DB` | −4 | punto blanco (dB) |
| `CLINICAL_GREY_CURVE` | 3,5 | convexidad del mapa `clinical` |
| `S_CURVE_MIX` | 0,85 | peso de la curva S |
| `HIGH_CONTRAST_GAMMA` | 1,6 | exponente del mapa de alto contraste |
| `NOISE_FLOOR` | 0,00045 | suelo del ruido del receptor por mirada |

Los armónicos están activados y el TGC en 0 en las ocho bandas por defecto.

## Modo M
El modo M (decisión 84) traza una línea cada 0,2 mm (`MMODE_SAMPLE_CM`) con la PSF axial y sus propios núcleos, que conservan los niveles del cuadro (lo incoherente se escala por la potencia filtrada de la red de dispersores, que crece al muestrear más fino que la celda; los ecos coherentes conservan su pico). La línea lleva una sola mirada, su propia transmisión (sin marcha del haz) y sus granos por tramo de estructura (decisión 145). El fasor de dispersores de la línea usa una red orientada con el haz (celda de dispersor a lo largo, anchura del haz de través, recorrida en fracciones irracionales para que la posición del cursor no fije una ganancia), anclada en el centro de cada tramo de estructura del corazón y fija en el tórax; la sangre cambia de fasor en cada pulso, como en cada cuadro (decisión 163). Las líneas se guardan por fases del latido para la misma sonda y cursor y cada columna del strip se forma entre las dos que rodean su instante; la consola promedia la envolvente del ruido de los pulsos de la columna (1000 pulsos/s), sin persistencia y con el realce de bordes a distancia de una muestra de cuadro.

## Frame rate simulado (`frameRate.ts`, decisión 178)
`t_línea(d) = 2·d/1540 + 20 µs`. La frecuencia de adquisición, la que muestra la UI como «FR», es `1/(disparos_2D·t_línea(profundidad) + líneas_color·8·t_línea(fondo de la caja))`:
- `disparos_2D` son las líneas de recepción del sector (1,0, 1,6 o 2,4 por grado según la densidad) divididas entre 2 (MLA 2);
- `líneas_color` es una por grado de la caja.

Depende sólo de la consola, así que es la misma en los tres niveles de calidad. Con la consola por defecto da 68,6 Hz a 16 cm y 80°, dentro de los 40–80 cuadros/s del 2D convencional, y 14,2 Hz con la caja de color por defecto; junto al Doppler espectral (PW, CW, TDI) la 2D conserva un cuarto, 17,1 Hz, porque comparte el tiempo de transmisión (decisión 212). El simulador forma los cuadros a su propia cadencia (`cadenceHz`): nunca por encima de la adquisición, y acotada por las líneas del cuadro polar de cada nivel. La tabla de ambas está en `DOPPLER_ENGINE.md`. Enseña la relación profundidad / sector / densidad / caja de color; no reproduce ningún equipo concreto.

## Scan conversion (`scanConvert.ts`)
Sector con ápex arriba-centro, `pxPerCm = min(alto_útil/prof, ancho_útil/(2·prof·sin(sector/2)))·zoom`, margen 14 px; LUT bilineal (línea, muestra) por píxel, reconstruida sólo cuando cambia la clave (dimensiones, sector, profundidad, escala, inversión). `invertLR` refleja el sector; el zoom multiplica `pxPerCm` manteniendo el ápex arriba (el fondo del sector queda fuera del lienzo); no hay zoom por región de interés. La imagen se convierte a la resolución CSS del lienzo y no a la del dispositivo: la rejilla polar (0,5–0,78 mm) es más gruesa que el píxel CSS (0,27 mm) y convertir a 2× cambia 2 niveles de gris de media (decisión 159).

## Lo que no se simula
- Propagación de ondas y portadora de RF; formación de haz por elemento, apodización explícita y lóbulos de rejilla; varias zonas focales (`focalZones` existe como opción de `simulatedFrameRate` pero nadie la pasa); refracción y velocidad del sonido variable por tejido (1540 m/s uniforme); pérdida de transmisión en las interfaces; propagación no lineal.
- La fase de rango de los ecos de interfaz (decisión 158). Los armónicos son factores fijos: sangre ×0,6, especular ×1,1, clutter ×0,35, atenuación ×1,2, pulso axial ×1,15, haz lateral y lóbulos ×0,8.
- Cola de cometa y ring-down de burbujas; compensación lateral de ganancia; compounding por inclinación del haz (las dos miradas son realizaciones estadísticas, no cuadros inclinados); reducción de speckle de la consola (decisión 157).
- De `caseDef.artifacts`, `rib-shadow`, `lung-reverberation` y `calcium-shadow` no se leen: esos artefactos salen de la anatomía. `side-lobe` y `beam-width` modifican la PSF, `mirror` actúa en la consola de la CPU (con él activo el cuadro se forma en la CPU) y `near-field-clutter` suma al clutter.
