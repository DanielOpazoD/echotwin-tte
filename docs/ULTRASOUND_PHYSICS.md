# Física del ultrasonido: qué se aproxima y cómo

El trazador procedimental (`src/simulator/renderer/procedural/sliceRenderer.ts`) recorre cada línea de barrido muestra a muestra (`dr = profundidad/muestras`), clasifica el punto 3D contra el corazón (`classifyHeart`) y, si no es cardíaco, contra el tórax (`classifyThorax`), y acumula una **amplitud de eco lineal** por muestra. No hay propagación de ondas ni señal RF: cada fenómeno es una regla explícita y barata pensada para enseñar, no para reproducir un equipo concreto. La consola (`postprocess/consolePipeline.ts`) convierte esa amplitud en gris de pantalla.

## Tabla de tejidos (`src/simulator/anatomy/tissue.ts`)
Valores relativos y educativos, no constantes medidas.

| Tejido | reflect (difuso) | specular | atenuación (rel.) | grano (ciclos/cm) |
|---|---|---|---|---|
| Sangre | 0,012 | 0 | 0,18 | 5 |
| Miocardio | 0,42 | 0,5 | 0,9 | 3,2 |
| Válvula | 0,7 | 0,9 | 0,8 | 4 |
| Pericardio | 0,85 | 1,0 | 0,9 | 3 |
| Grasa | 0,2 | 0,2 | 0,6 | 2,5 |
| Músculo | 0,38 | 0,3 | 1,0 | 3 |
| Hueso / Columna | 1,0 | 1,0 | 20 | 3 |
| Cartílago | 0,45 | 0,5 | 3,5 | 3 |
| Pulmón | 1,0 | 1,0 | 40 | 3 |
| Líquido (derrame) | 0,005 | 0 | 0,05 | 4 |
| Pared vascular | 0,55 | 0,8 | 0,9 | 3 |
| Calcio | 1,0 | 1,0 | 25 | 3 |
| Piel | 0,5 | 0,6 | 1,2 | 4 |
| Hígado | 0,35 | 0,2 | 0,7 | 3 |

`Tissue.Calcium` está definido, pero la calcificación valvular se expresa hoy como `extraReflect` (0–1) sobre `Tissue.Valve`, no como tejido propio. Las costillas son cartílago a menos de 5 cm del esternón y hueso más allá; su eje está a 0,7·pared torácica de profundidad, el espacio intercostal crece un 3 % por cm lateral y el radio del tubo cae hasta un 45 % a 8 cm del esternón (`ribSpacingAt`, `ribRadiusAt`). Si la pared torácica efectiva (`espesor·(1 + 0,8·obesidad)`) supera 2 cm, el corazón se desplaza ese exceso hacia atrás (`heartOffset.z`).

## Fenómenos aproximados en el trazador
| Fenómeno | Cómo se calcula |
|---|---|
| Retrodispersión difusa + speckle | `eco = reflect · speckle`, con `speckle = ((0,6·n1 + 0,4·n2)·2)²·0,8 + 0,2`; n1, n2 son value noise 3D evaluados en **coordenadas materiales** (`mx,my,mz` de la muestra) proyectadas sobre los ejes lateral / elevación / axial del haz, de modo que el grano se mueve con el tejido y no con la pantalla. Frecuencia lateral `grano·√(f/2,5)`, axial `grano·(f/2,5)·2,2` (×1,25 con armónicos). Con armónicos la sangre refleja ×0,6. |
| Interfaces especulares | `+ specular · |n·d|³ · fall · 1,6` (×1,25 con armónicos), `fall = max(0, 1 − |sdf|/0,16 cm)`: sólo las muestras a menos de 1,6 mm de una interfaz y con normal alineada con el haz brillan (pericardio, velos, endocardio perpendicular). |
| Calcificación | `+ extraReflect · 1,5 · (0,6 + 0,8·ruido)` y atenuación extra `+0,6·extraReflect` Np/muestra cuando `extraReflect > 0,4`. |
| Atenuación bidireccional | `transmission *= exp(−0,23 · atenuación_tejido · f_aten · dr)` con `f_aten = f · (1,2 si armónicos)`; grasa, músculo y piel de la pared torácica se multiplican por `1 + 1,5·chestWallAttenuation`. Hueso, calcio y columna imponen 1,2 Np por muestra. Suelo 1e-4. El eco de cada muestra se multiplica por la `transmission` acumulada hasta ella (una sola exponencial; la constante 0,23 ≈ ln 10/10 pasa la escala relativa a nepers). El código la llama «bidireccional» pero no modela ida y vuelta por separado. |
| Sombra ósea / cálcica | Consecuencia de lo anterior: tras una costilla o un velo calcificado la transmisión cae a ~0 y todo lo distal se apaga. El mapa `transmission` viaja con el cuadro para que Doppler y scoring lo consulten. |
| Pulmón y reverberación pleural | Antes de clasificar el corazón, `isAnteriorLung` comprueba si el punto cae en la lengüeta de pulmón interpuesta entre pared y corazón lateral a la escotadura cardíaca (espesor `min(5, 1,3·(x − borde) + 0,4)` cm, con el borde desplazado por `lungOverlapCm`, inspiración y decúbito): el pulmón ocluye al corazón. Al entrar en `Tissue.Lung` la línea queda «muerta»: la muestra de entrada brilla `transmission·(1,2 + 0,4·ruido)` y las siguientes reciben **líneas A**: bandas gaussianas (σ ≈ 1,2 mm) a múltiplos de la profundidad pleural (`period = max(r_entrada, 0,4 cm)`) que decaen 0,55 por orden, sobre un fondo de ruido. |
| Acoplamiento parcial | `contactQuality(p) = p/0,35` si p < 0,35, si no 1; cada línea cuyo `hash3(línea)` supere el contacto se atenúa ×0,08 completa (dropout de líneas enteras). La presión también hunde el origen del haz `0,3 + 0,5·p` cm bajo la piel. |
| Clutter de campo cercano | Para r < 4,5 cm: `+ clutter · exp(−r/1,8) · (0,15 + 0,5·ruido)`, con `clutter = (2,5·(clutterLevel + 0,5·emphysemaScatter) + 0,8·chestWallAttenuation) · √(2,5/f)` (×0,35 con armónicos). Anillo brillante de contacto para r < 3,5 mm. |

Todo el ruido deriva de `hash3(...)`/`valueNoise3(...)` con la semilla del caso: dos ejecuciones con la misma semilla producen el mismo cuadro (prueba en `src/tests/goldens.test.ts`).

## Consola (`applyConsole`, en orden)
1. **Compensación de profundidad + TGC + ganancia**: `comp = 10^(min(0,38·f·r + TGC(r), 60)/20) · 10^(gain/20)`, TGC interpolado linealmente entre 8 bandas (±15 dB); se añade un suelo de ruido `0,006·(0,5+hash)·(1+0,15·r)` por muestra y cuadro.
2. **Resolución axial**: media móvil a lo largo de la línea de anchura `0,09·(2,5/f)` cm (×0,75 con armónicos).
3. **Compresión logarítmica**: `y = (20·log10(a) − 15 + RD)/RD` recortado a [0,1]; RD = rango dinámico (30–90 dB).
4. **Resolución lateral y foco**: desenfoque gaussiano entre líneas de anchura `0,9° + 0,55°·|r − foco|·(2,5/f)` (×0,85 con armónicos), convertida a líneas según la densidad, máximo ±6 líneas. Sectores anchos con pocas líneas se ven más borrosos lejos del foco.
5. **Realce de bordes**: unsharp axial suave (`edgeEnhance·0,8`).
6. **Persistencia**: `y = a·(1−p) + prev·p`; se reinicia al cambiar la geometría del cuadro.
7. **Mapa de grises**: lineal, curva S (`smoothstep·0,85 + lineal·0,15`) o alto contraste (`y^1,6`).

El M-mode aplica la misma cadena a una sola línea por columna con persistencia 0 y un estado de consola sembrado por columna.

## Frame rate simulado (`frameRate.ts`)
`t_línea = 2·profundidad/1540 + 20 µs`; `fps = 1/(líneas·t_línea·zonas_focales + líneas_color·8·t_línea)`, tope 90 Hz. Enseña la relación profundidad / sector / densidad / caja de color; no reproduce ningún equipo. El worker usa este valor para su cadencia real (acotada a 12–50 ms por paso) y la UI lo muestra como «FR».

## Scan conversion (`scanConvert.ts`)
Sector con ápex arriba-centro, `pxPerCm = min(alto_útil/prof, ancho_útil/(2·prof·sin(sector/2)))·zoom`, margen 14 px; LUT bilineal (línea, muestra) por píxel, reconstruida sólo cuando cambia la clave (dimensiones, sector, profundidad, escala, inversión). `invertLR` refleja el sector; el zoom multiplica `pxPerCm` manteniendo el ápex arriba (el fondo del sector queda fuera del lienzo); no hay zoom por región de interés.

## Lo que NO se simula
- Propagación de ondas, difracción, interferencia, fase, RF, apodización ni formación de haz; la «línea» es un rayo recto.
- Lóbulos laterales y de rejilla, grosor de corte (elevación), zonas focales múltiples (`focalZones` existe como opción de `simulatedFrameRate` pero nadie la pasa).
- Refracción, imagen en espejo, cola de cometa / ring-down, artefactos de ganancia multiplicativos reales, ruido electrónico dependiente del equipo.
- Velocidad del sonido variable por tejido (1540 m/s uniforme; la geometría ni siquiera la usa).
- Armónicos reales: los «armónicos» son multiplicadores fijos sobre clutter, especularidad, reflectividad de la sangre y atenuación.
- Los tipos `mirror`, `side-lobe` y `beam-width` de `ArtifactConfigSchema` se validan y se ignoran; en general **el renderer no lee `caseDef.artifacts`**: sombra costal, reverberación y clutter dependen sólo de la geometría y de `acousticWindow`.
