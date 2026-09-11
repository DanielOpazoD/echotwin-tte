# Motor de artefactos: matriz causa → efecto

Formato de la «spec 38»: para cada artefacto implementado, cómo se ve, qué lo causa en la realidad, qué lo aumenta en el simulador, qué maniobras lo reducen, cómo está aproximado y qué prueba lo cubre. Importante: **el renderer no lee `caseDef.artifacts`**; los artefactos emergen de la geometría del tórax, de `acousticWindow`, de la pose y de los ajustes. La referencia clínica del módulo es `ase-artifacts-2026` (ver `docs/REFERENCES.md`).

| Artefacto | Modalidad | Apariencia | Causa física | Lo aumenta en el simulador | Lo reduce | Implementación aproximada | Test |
|---|---|---|---|---|---|---|---|
| Sombra costal | 2D, Color, CW | Cuña oscura distal a una costilla; sin color ni señal CW detrás | Reflexión/absorción casi total en hueso o cartílago | Sonda sobre una costilla (`u,v` fuera del espacio intercostal), espacios estrechos (`intercostalWidthCm` pequeño), profundidad alta en `rib` | Deslizar un espacio (hints «Desliza… hacia la cabeza/pies»), rock/tilt | `classifyThorax` sitúa tubos de costilla (radio `(espacio − ancho intercostal)/2`); atenuación fija 1,2 Np/muestra → `transmission ≈ 0`; Color descarta muestras con transmisión < 0,2·esperada; CW deja de muestrear con transmisión < 0,02; `shadowFraction` penaliza el score | `viewQuality.test.ts` (hint por sombra indirecto), sin prueba específica de costilla |
| Reverberación pleural (líneas A) | 2D | Repeticiones brillantes equiespaciadas bajo la pleura, campo sin anatomía | Rebote múltiple sonda↔pleura | Solapamiento pulmonar (`lungOverlapCm`), inspiración (+1,4 cm), supino (+0,6 cm), enfisema; cualquier posición lateral a la escotadura cardíaca (pulmón anterior interpuesto, `isAnteriorLung`) | Espiración, decúbito lateral, deslizar medial | Al alcanzar `Tissue.Lung` la línea muere; bandas gaussianas en múltiplos de la profundidad pleural, decaimiento 0,55 por orden | Ninguna específica |
| Clutter de campo cercano | 2D | Neblina brillante en los primeros centímetros que oculta el ápex/pared anterior | Reverberación en la pared torácica, lóbulos laterales | `clutterLevel`, `emphysemaScatter`, `chestWallAttenuation`, frecuencia baja, sin armónicos | Armónicos (×0,35), subir frecuencia, bajar ganancia cercana (TGC) | Término `clutter·exp(−r/1,8)·ruido` para r < 4,5 cm más anillo de contacto < 3,5 mm | Ninguna específica |
| Sombra por calcificación | 2D, Color, CW | Velo muy brillante con cono oscuro distal; TSVI/aorta parcialmente ocultos | Absorción/reflexión del calcio | `aorticValve.calcification`, `mitral.calcification` (> 0,4 activa la atenuación extra) | Cambiar de ventana (A5C/A3C para ver el flujo distal) | `extraReflect` añade brillo y `+0,6·extra` Np/muestra | Ninguna específica (el caso `aortic-stenosis-severe` la exhibe) |
| Dropout por mal acoplamiento | 2D | Líneas enteras apagadas, imagen «rayada» | Aire entre sonda y piel, poca presión | `pressure < 0,35` | Subir presión (W) | `contactQuality = p/0,35`; cada línea cuyo `hash3(línea)` > contacto se atenúa ×0,08 | Ninguna específica |
| Aliasing color | Color | Inversión de color (amarillo→cian) en el centro del chorro | Velocidad > Nyquist | Escala baja, línea de base desplazada hacia el flujo, chorros rápidos (EA, IT) | Subir escala, desplazar línea de base, CW | `aliasVelocity` por muestra antes del mapa de color | `formulas.test.ts` (`aliasVelocity`) |
| Aliasing espectral | PW, TDI | Envolvente cortada arriba y reaparece por abajo | Idem | Escala baja, gate en el chorro estenótico | Subir escala/línea de base, cambiar a CW | `aliasVelocity` por muestra; CW recorta en vez de plegar | `doppler.test.ts` («PW aliases…; CW clips») |
| Blooming | Color | El color «sangra» sobre paredes y velos | Ganancia de color excesiva | `color.gainDb` > 2 dB (radio de dilatación `round((g−2)·0,6)` muestras) | Bajar ganancia de color | Dilatación de la máscara de sangre en la caja | Ninguna específica |
| Subestimación por ángulo | PW, CW, Color | Velocidad menor que la real; color pálido | `v_medida = v·cos θ` | Cursor no alineado con el chorro; ventana equivocada | A5C/A3C para el TSVI, mover la sonda (no basta con rockear desde el mismo punto, ver nota) | Proyección `−(v·d)` sin corrección de ángulo | `doppler.test.ts` («cosine law» y «PW peak falls monotonically…»: 9 posiciones de sonda, error < 0,35 m/s frente a |v·d|, la peor alineación < 0,8× la mejor) |
| Sobre-ganancia | 2D | Sangre gris, cavidades «llenas», ruido de fondo | Amplificación excesiva | `gainDb` alto, TGC alto, rango dinámico bajo | Bajar ganancia/TGC | Ganancia lineal antes de la compresión; ruido de suelo se amplifica; `gainScore` cae si la media de sangre > 0,22 | `viewQuality` (componente gain) sin prueba dedicada |
| Infra-ganancia | 2D | Miocardio oscuro, bordes perdidos | Amplificación insuficiente | `gainDb` bajo, atenuación de pared alta sin TGC | Subir ganancia, TGC profundo, bajar frecuencia | `gainScore` cae si la media de miocardio < 0,32 | Idem |
| Ensanchamiento espectral | PW, TDI | Envolvente gruesa, «relleno» del espectro | Gate grande, turbulencia, ganancia | `gateLengthCm`, `turbulence` del sitio, AVA < 2 cm² distal a la válvula, ganancia espectral | Gate pequeño, gate en flujo laminar, bajar ganancia | σ por muestra = intrínseco + 0,9·dispersión·|v|; 20 muestras en el gate | `doppler.test.ts` («turbulence broadens») |

Nota sobre la subestimación por ángulo: `poseFromControl` sitúa el origen del haz sólo con `u`, `v` y `pressure`; el rock y el tilt cambian qué línea del sector atraviesa un punto pero no la dirección origen→punto. Si el cursor se vuelve a apuntar al mismo objetivo desde el mismo origen (como hacía una versión anterior de la prueba; la actual desplaza la sonda entre espacios intercostales), el cos θ no cambia; para subestimar hay que **desplazar** la sonda o dejar el cursor sin re-apuntar.

## Pendientes (no implementados)
| Artefacto | Estado |
|---|---|
| Imagen en espejo (pericardio/pleura) | Enum `mirror` en el esquema; sin código. |
| Refracción (duplicación, desplazamiento) | Sin código; el rayo es recto. |
| Lóbulos laterales / de rejilla | Enum `side-lobe`; sin código. |
| Grosor de corte / anchura de haz | Enum `beam-width`; sólo existe el desenfoque lateral dependiente del foco en la consola, que no es un artefacto de volumen parcial. |
| Cola de cometa, ring-down, ganancia lateral, sombras de refracción en bordes | Sin código. |
| Artefactos de movimiento (ghosting de color, flash) | Sin código; la persistencia sólo suaviza. |

## Cómo reproducir cada artefacto en la app
Pasos con los controles reales (`ConsolePanel`, atajos de `shortcuts.ts`); el panel Dev muestra `shadow` (fracción de sombra) y `coverage` para confirmar.

| Artefacto | Receta |
|---|---|
| Sombra costal | Caso normal, PLAX aproximada; desliza con ↑/↓ de 2 mm en 2 mm hasta que el score caiga y aparezca «Gran parte del corazón está en sombra…»; `shadow` sube por encima de 0,35. Vuelve al espacio intercostal con el hint «Desliza … (otro espacio intercostal)». |
| Reverberación pleural | Caso `normal-difficult-window`; respiración «Insp» y posición «Supino»; desliza lateral (→) hasta que el sector se llene de bandas horizontales; pasa a «Esp» y decúbito lateral para recuperar el corazón. |
| Clutter | Caso difícil; apaga «Armónicos (THI)» y baja la frecuencia a 1,5 MHz: el campo cercano se vela; enciende THI y sube a 3,5 MHz para limpiarlo (a costa de penetración). |
| Sombra por calcio | Caso `aortic-stenosis-severe`, PLAX: la válvula brilla y la raíz/AI distal se apagan; en Color (C) la caja sobre la raíz queda sin color detrás de la válvula. |
| Dropout de acoplamiento | Baja la presión con S hasta < 0,35: aparecen líneas negras verticales; súbela con W. |
| Aliasing color | Caso EA, A5C, Color con caja sobre el TSVI/válvula y «Escala (Nyquist)» en 0,15–0,3 m/s: el chorro se vuelve mosaico; sube la escala o desplaza la línea de base. |
| Aliasing espectral | Mismo caso, PW (P) con el gate en la válvula: la envolvente se corta y reaparece abajo; cambia a CW (X), que recorta en vez de plegar. |
| Blooming | Color con «Ganancia color» ≥ +8 dB: el color invade el septum y los velos; baja a 0 dB. |
| Subestimación por ángulo | Compara CW en la válvula desde A5C (u ≈ 6,2, v ≈ −3,8) y desde PLAX: la Vmax desde PLAX es muy inferior porque el chorro es casi perpendicular al haz. |
| Sobre/infra-ganancia | «Ganancia» +20 dB: sangre gris y hint «Exceso de ganancia…»; −20 dB: miocardio negro y hint «Ganancia insuficiente…». La barra «Ganancia» del panel de guía cae. |
| Ensanchamiento espectral | PW en el TSVI con «Tamaño de gate» 15 mm frente a 2 mm; o gate dentro del chorro estenótico del caso EA (turbulencia 0,45). |

## Señales que el motor expone
- `PolarFrame.transmission` (por muestra) y `SimOutput.view.shadowFraction`: sombra.
- `SimOutput.view.components.gain` y los hints de ganancia: sobre/infra-ganancia.
- `SimOutput.stats.fillWeight` / `nearestAnchorDist`: cuánto del cuadro viene del relleno procedimental (sólo backend atlas).
- `colorFps` frente a `simulatedFps`: coste de la caja de color en el frame rate simulado.
