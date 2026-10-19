# Banco de realismo (decisión 344)

Este documento es el registro del banco que juzga si un cambio acerca el simulador a la ecografía real. Arriba, la
lectura de la corrida; abajo, el informe tal como lo escribe `npm run realism` (procedimiento en
`docs/validation/README.md` § 5). Al repetir la corrida, el informe nuevo sustituye la parte de abajo y la lectura se
reescribe con sus cifras.

## Lectura de la corrida del 2026-10-18

**Qué se puede afirmar ya.**

1. **El haz lateral es más fino de lo que su transductor permite.** Con la apertura que declara (14 mm, 2,5 MHz, foco a
   9 cm), ni una apertura sin apodizar —la más estrecha posible— baja de 3,6 mm a −6 dB en el foco; el simulador dibuja
   2,9 mm (0,80×), y 4,4 frente a 6,1 mm a 15 cm (0,72×). Con la apodización de Hanning de los ejemplos de Field II la
   referencia es el doble de ancha (5,8 mm). La fórmula del simulador combina emisión y recepción como dos gaussianas de
   1,02 λF en cuadratura (0,72 λF) donde la difracción da 0,886 λF. A la vez, su celda de speckle (2,8 mm a 9 cm)
   coincide con la de la apertura sin apodizar y con la de CAMUS (decisión 317): **la textura se ajustó a CAMUS, y la
   física declarada no la produce**. O el transductor declarado no es el de un equipo cardiaco actual (más apertura, más
   frecuencia en armónico), o la imagen es más fina que su física. Consecuencia directa: el quiste anecoico de 8 mm
   contrasta −20,4 dB donde la referencia más favorable da −15,7 (y −9,8 con Hanning).
2. **El speckle mostrado es más regular que el speckle real, y el miocardio más liso que CAMUS.** Una sola mirada del
   simulador da la SNR de Rayleigh (1,90–1,92: los fasores de red son buenos dispersores), pero el compuesto de dos
   miradas (decisión 145) la sube a 2,67. En la imagen mostrada, el gris residual del miocardio del A4C normal tiene una
   desviación de 14,8 frente a 19,6 [17,7–22,0] en CAMUS Good (1,1 anchos intercuartiles por debajo) y una asimetría de
   0,19 frente a 0,53 [0,42–0,67] (1,4 por debajo); la métrica ya existente del repositorio da lo mismo (15,0 frente a
   21,6). Es la brecha de imagen más clara, y las dos medidas apuntan en la misma dirección.
3. **La geometría se mueve bien; el speckle no la sigue igual.** El GLS del contorno del modelo es −19,9 % en el normal
   (dentro de −18 a −22), −14,9 en la MCH obstructiva y −6,4 en la ICFEr. El speckle seguido da la mitad en los tres
   (−10,3, −5,6, −2,1) y los puntos no vuelven a su sitio tras un ciclo (deriva 1,5–4,2 mm). En el tabique medio del
   normal el speckle baja 0,9 mm donde el borde baja ~5; sin el clutter de la pared torácica baja 4,9 mm, pero el GLS
   global sin clutter no mejora (−8,0). El rastreador sólo está validado en una deformación sintética (recupera −21,8 %
   de −20 %); hasta correrlo sobre vídeos reales no se puede atribuir la diferencia al simulador.
4. **Volúmenes y tiempos, dentro de lo normal.** Biplano medido en la imagen del normal: 116 / 39 mL, FE 66 % (el modelo
   dice 120 / 45 mL y 62,5 %: la imagen recorta 6 mL de la telesístole). La telesístole llega a 407 ms de la
   telediástole frente a 336 [299–379] ms en CAMUS.

**Qué no se puede afirmar todavía.**

- **Ninguna prueba ciega con lectores.** La sesión está generada (`~/datos/realism-turing`, 24 elementos: 6 + 6 por vista
  en A4C y A2C) pero nadie la ha rendido. Es de fotogramas, no de clips: la copia local de CAMUS sólo trae TD y TS, y
  EchoNet no está en la máquina. Con las secuencias `*_half_sequence.nii.gz` de CAMUS o con `ECHONET_DIR` el banco arma
  sesiones de clips; PLAX y PSAX necesitan clips propios (`REALISM_REAL_DIR`), porque ningún conjunto público los trae.
- **EchoNet-Dynamic no corrió**: falta su distribución de FE y volúmenes, el tiempo TD → TS de sus trazados y, sobre
  todo, la decorrelación entre cuadros de vídeos reales, la única referencia de movimiento del banco. La del simulador
  está medida (correlación de bloques 0,82–0,93 en el mejor desplazamiento a 50 cuadros/s) y espera su contraparte.
- **Field II de verdad no se ha corrido.** No hay una cifra publicada de Field II para este transductor exacto; la
  referencia es una suma con retardos propia con el modelo y el pulso de Field II, sin el tamaño de los elementos.
- **El código de discos del banco da en CAMUS una FE 7,7 puntos más alta que la declarada** (r = 0,97). Por eso la
  comparación con CAMUS usa siempre el mismo código en los dos lados, nunca la cifra declarada.

**Orden de trabajo que sugiere.** Antes de refundar nada: (1) que un ecocardiografista rinda la sesión de Turing; (2)
traer EchoNet o secuencias de CAMUS para tener clips y movimiento real; (3) decidir el transductor: o se declara una
apertura y frecuencia de equipo cardiaco actual y se deja que la difracción dé la PSF, o se documenta que la PSF es un
ajuste a CAMUS y no física. Sólo entonces tiene sentido medir si una anatomía por malla o una imagen por convolución
con dispersores lagrangianos mueve estas cifras.

## Informe generado

Generado por `npm run realism` (decisión 344) el 2026-10-19 02:04 UTC, en 5,7 min. Fuentes clínicas: CAMUS sí, EchoNet-Dynamic no (falta ECHONET_DIR). Sólo cifras agregadas: ninguna imagen clínica ni dato individual sale de las carpetas de origen.

### Brechas, de mayor a menor

Una sola escala para ordenarlas: en física, |ln(sim/ref)|/ln 1,25 (1 = un 25 % de error) o |Δ dB|/6; contra una distribución clínica, la distancia a la mediana en anchos intercuartiles; contra un rango normal, la distancia fuera de él sobre su media anchura (0 dentro). Por encima de 1 la brecha es mayor que la tolerancia con que se ha calibrado el simulador hasta ahora.

| # | área | métrica | simulador | referencia | fuente de la referencia | puntuación |
|---:|---|---|---:|---:|---|---:|
| 1 | movimiento | GLS por seguimiento de speckle (A4C, caso normal) † | −10,33 % | −20,00 % | normal −18 a −22 % | 3,8 |
| 2 | física | SNR del speckle uniforme (envolvente mostrada, 2 miradas) | 2,67  | 1,91  | Rayleigh (Burckhardt 1978) y la referencia | 1,5 |
| 3 | física | resolución lateral −6 dB a 15 cm | 4,39 mm | 6,05 mm | DAS tipo Field II sin apodizar (con Hanning 9,76 mm) | 1,4 |
| 4 | imagen clínica | asimetría del gris residual del miocardio (A4C, TD) | 0,19  | 0,53  | CAMUS Good, mediana [0,42–0,67] | 1,4 |
| 5 | imagen clínica | desviación del gris residual del miocardio (A4C, TD) | 14,81 gris | 19,64 gris | CAMUS Good, mediana [17,73–21,97] | 1,1 |
| 6 | física | resolución lateral −6 dB a 9 cm | 2,86 mm | 3,56 mm | DAS tipo Field II sin apodizar (con Hanning 5,79 mm) | 1,0 |
| 7 | volumen y tiempo | telediástole → telesístole (caso normal) | 407,50 ms | 336,28 ms | CAMUS, mediana [299–379] | 0,9 |
| 8 | imagen clínica | curtosis del gris residual del miocardio (A4C, TD) | 0,23  | 0,95  | CAMUS Good, mediana [0,61–1,42] | 0,9 |
| 9 | física | contraste de un quiste anecoico de 8 mm a 9 cm | −20,44 dB | −15,69 dB | DAS tipo Field II sin apodizar (con Hanning −9,8 dB) | 0,8 |
| 10 | volumen y tiempo | FE de la imagen frente a la del modelo (caso normal) | 66,13 % | 62,50 % | el volumen del modelo (tablas del latido) | 0,7 |
| 11 | física | resolución axial −6 dB a 9 cm | 0,69 mm | 0,64 mm | pulso de Field II (2 + 2 ciclos) | 0,3 |
| 12 | imagen clínica | gris mediano del miocardio (A4C, TD) | 109,00 gris | 100,00 gris | CAMUS Good, mediana [87,00–115,00] | 0,3 |
| 13 | física | resolución lateral −6 dB a 5 cm | 2,06 mm | 2,15 mm | DAS tipo Field II sin apodizar (con Hanning 3,36 mm) | 0,2 |
| 14 | física | celda de speckle lateral a 9 cm | 2,79 mm | 2,80 mm | DAS tipo Field II sin apodizar (con Hanning 4,82 mm) | 0,0 |
| 15 | volumen y tiempo | VTD biplano medido en la imagen (caso normal) | 115,82 mL | 98,00 mL | ASE/EACVI 2015, 46–150 mL | 0,0 |
| 16 | volumen y tiempo | VTS biplano medido en la imagen (caso normal) | 39,23 mL | 37,50 mL | ASE/EACVI 2015, 14–61 mL | 0,0 |
| 17 | volumen y tiempo | FE biplano medida en la imagen (caso normal) | 66,13 % | 63,00 % | ASE/EACVI 2015, 52–74 % | 0,0 |
| 18 | movimiento | GLS del contorno del modelo, 2 mm dentro de la pared (A4C, caso normal) | −19,92 % | −20,00 % | normal −18 a −22 % | 0,0 |

† GLS por seguimiento de speckle (A4C, caso normal): el rastreador del banco no regulariza y sólo está validado en una deformación sintética; hasta correrlo sobre vídeos reales (EchoNet) no se sabe qué parte es del simulador.

### 1. Formación de imagen en fantomas

Transductor de referencia: 64 elementos sobre 14 mm (la apertura del simulador), 2.5 MHz, foco de emisión a 9 cm, recepción dinámica con F/1, pulso de los ejemplos de Field II (excitación de 2 ciclos por respuesta al impulso de 2 ciclos con ventana de Hanning, en emisión y recepción), elementos puntuales. El simulador corre sus propias etapas (fasores, compuesto de 2 miradas, ganancia de foco, PSF con lóbulos laterales, envolvente) en la rejilla polar del nivel alto, en fundamental para comparar con la referencia. No se encontró una cifra publicada de Field II para este transductor exacto (el ejemplo de matriz en fase de Field II usa otros parámetros), así que la referencia se calcula aquí con su mismo modelo lineal y su pulso, y se valida contra la teoría: 0,886 λF a −6 dB en el foco de una apertura rectangular y SNR 1,91 en speckle plenamente desarrollado (`dasReference.test.ts`). Una corrida de Field II de verdad queda pendiente. La apertura sin apodizar es la cota más estrecha que da una apertura de 14 mm; la de Hanning, la de los ejemplos de Field II y la habitual en un equipo.

#### Blancos puntuales

| profundidad (cm) | axial sim, fórmula / medida (mm) | axial ref (mm) | lateral sim, fórmula / medida (mm) | lateral ref rect / Hanning (mm) | lóbulo sim (dB) | lóbulo ref rect / Hanning (dB) | muestra / línea (mm) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 | 0,73 / 0,69 | 0,60 | 1,32 / 1,33 | 1,86 / 2,36 | −35,6 | −13,0 / −76,4 | 0,50 / 0,26 |
| 5 | 0,73 / 0,69 | 0,65 | 2,04 / 2,06 | 2,15 / 3,36 | −35,6 | −23,0 / < −60 | 0,50 / 0,44 |
| 7 | 0,73 / 0,69 | 0,64 | 2,53 / 2,54 | 2,80 / 4,53 | −35,6 | −28,2 / < −60 | 0,50 / 0,61 |
| 9 | 0,73 / 0,69 | 0,64 | 2,86 / 2,86 | 3,56 / 5,79 | −35,6 | −30,0 / < −60 | 0,50 / 0,78 |
| 11 | 0,73 / 0,69 | 0,64 | 3,23 / 3,25 | 4,37 / 7,10 | −35,6 | −29,1 / < −60 | 0,50 / 0,96 |
| 13 | 0,73 / 0,69 | 0,64 | 3,74 / 3,76 | 5,20 / 8,42 | −35,6 | −28,1 / < −60 | 0,50 / 1,13 |
| 15 | 0,73 / 0,69 | 0,64 | 4,36 / 4,39 | 6,05 / 9,76 | −35,6 | −27,3 / < −60 | 0,50 / 1,30 |

Imagen armónica (la consola por omisión): el simulador estrecha el haz lateral por 0,8 a toda profundidad. El modelo de primer orden (fuente ∝ p², recibida al doble de la frecuencia de emisión) da estas razones respecto de la fundamental:

| profundidad (cm) | simulador | emisión a f (recepción 2f) | emisión a f/2 (recepción f) |
|---:|---:|---:|---:|
| 5 | 0,80 | 0,57 | 1,12 |
| 9 | 0,80 | 0,58 | 1,15 |
| 13 | 0,80 | 0,58 | 1,15 |

#### Quiste anecoico en speckle uniforme

| profundidad (cm) | diámetro (mm) | contraste sim / ref rect / ref Hanning (dB) | CNR sim / rect / Hanning | gCNR sim / rect / Hanning | gCNR sim en el gris mostrado |
|---:|---:|---:|---:|---:|---:|
| 5 | 8 | −26,8 / −21,1 / −18,0 | 2,56 / 1,68 / 1,59 | 0,99 / 0,92 / 0,83 | 0,99 |
| 9 | 8 | −20,4 / −15,7 / −9,8 | 2,54 / 1,46 / 1,15 | 0,97 / 0,79 / 0,65 | 0,97 |
| 13 | 8 | −16,8 / −10,8 / −7,2 | 2,25 / 1,30 / 1,07 | 0,98 / 0,68 / 0,61 | 0,98 |

#### Speckle uniforme

SNR de la envolvente: 1,91 para speckle plenamente desarrollado (Rayleigh). «Ventanas»: el estimador con que se lee el miocardio más abajo (5 líneas × 7 muestras), aplicado aquí al speckle uniforme como vara de medir.

| profundidad (cm) | SNR sim (2 miradas / 1 mirada / ventanas) | SNR ref | m de Nakagami sim (2 / 1) | m ref | α de K, 1 mirada | celda axial sim / ref (mm) | celda lateral sim / ref rect / ref Hanning (mm) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 2,64 / 1,90 / 2,91 | 1,94 | 2,40 / 1,06 | 0,90 | 70 | 0,67 / 0,56 | 1,89 / 1,61 / 2,83 |
| 9 | 2,67 / 1,92 / 3,05 | 1,80 | 2,30 / 1,03 | 1,26 | ∞ | 0,64 / 0,53 | 2,79 / 2,80 / 4,82 |
| 13 | 2,51 / 1,84 / 3,02 | 1,98 | 3,28 / 1,14 | 0,94 | 14 | 0,75 / 0,55 | 3,56 / 4,26 / 6,54 |

### 2. Imagen clínica: textura del miocardio frente a CAMUS

Gris residual del miocardio erosionado (gris menos su media local de ±4 mm, sin los píxeles recortados en 0 o 255), el mismo código sobre CAMUS (imágenes Good, cuatro y dos cámaras, TD y TS) y sobre el simulador. La forma (asimetría, curtosis) no depende de la escala de grises si ésta es lineal en dB; la desviación sí.

CAMUS (1010 imágenes): asimetría 0,53 [0,42–0,67], curtosis 0,95 [0,61–1,42], desviación 19,6 [17,7–22,0], gris mediano 100 [87–115].

| caso | vista | fase | asimetría | curtosis | desviación | gris mediano |
|---|---|---|---:|---:|---:|---:|
| normal | a2c | TD | 0,37 | 0,54 | 15,1 | 115 |
| normal | a2c | TS | 0,40 | 1,05 | 13,2 | 98 |
| MCH obstructiva | a4c | TD | 0,38 | 0,79 | 14,5 | 114 |
| MCH obstructiva | a4c | TS | 0,23 | 0,92 | 11,6 | 102 |
| ICFEr + IM | a2c | TD | 0,43 | 0,96 | 16,9 | 136 |
| ICFEr + IM | a2c | TS | 0,44 | 0,75 | 15,9 | 129 |
| normal | a4c | TD | 0,19 | 0,23 | 14,8 | 109 |
| normal | a4c | TS | 0,45 | 0,95 | 13,2 | 97 |
| MCH obstructiva | a2c | TD | 0,56 | 1,38 | 15,9 | 118 |
| MCH obstructiva | a2c | TS | 0,46 | 1,36 | 12,4 | 103 |
| ICFEr + IM | a4c | TD | 0,28 | 0,15 | 16,2 | 131 |
| ICFEr + IM | a4c | TS | 0,45 | 0,77 | 16,1 | 123 |

Envolvente del miocardio antes de la consola (TD): la SNR de toda la pared lleva sus cambios de nivel (ángulo de fibra, profundidad, granos); la SNR por ventanas, el speckle. Compárese con la del speckle uniforme por ventanas.

| caso | vista | SNR pared | SNR ventanas | α de K |
|---|---|---:|---:|---:|
| normal | plax | 1,49 | 2,63 | 0,87 |
| normal | a2c | 0,98 | 2,48 | 0,27 |
| MCH obstructiva | a4c | 0,82 | 2,56 | 0,26 |
| normal | psax-mv | 1,00 | 2,59 | 0,36 |
| ICFEr + IM | plax | 1,41 | 2,65 | 1,01 |
| ICFEr + IM | a2c | 0,86 | 2,56 | 0,18 |
| normal | a4c | 0,90 | 2,46 | 0,21 |
| ICFEr + IM | psax-mv | 1,10 | 2,36 | 0,49 |
| MCH obstructiva | plax | 1,20 | 2,50 | 0,47 |
| MCH obstructiva | a2c | 0,83 | 2,56 | 0,22 |
| ICFEr + IM | a4c | 0,89 | 2,57 | 0,25 |
| MCH obstructiva | psax-mv | 0,85 | 2,40 | 0,30 |

### 3. Volumen del VI a lo largo del ciclo

Método de discos biplano sobre la máscara de la cavidad (el mapa de estructuras del simulador visto por la misma conversión de barrido, A4C y A2C a 50 cuadros/s), frente al volumen del modelo (las tablas del latido). En CAMUS el mismo código corre sobre las máscaras de los expertos.

| caso | VTD imagen / modelo (mL) | VTS imagen / modelo (mL) | FE imagen / modelo (%) | TD → TS (ms) |
|---|---:|---:|---:|---:|
| normal | 116 / 120 | 39 / 45 | 66,1 / 62,5 | 407 |
| MCH obstructiva | 97 / 100 | 24 / 30 | 75,7 / 70,0 | 405 |
| ICFEr + IM | 253 / 270 | 194 / 205 | 23,5 / 24,0 | 429 |

CAMUS (500 pacientes, población con FE reducida en buena parte): VTD 91 [72–116] mL, VTS 42 [30–58] mL, FE del banco 53,4 [44,9–60,7] %, FE declarada 46,0 [37,0–52,0] %. El código del banco da una FE 7,7 puntos por encima de la declarada (error medio absoluto 7,7, r = 0,97, 500 pacientes): por eso el simulador se compara con CAMUS siempre con el mismo código, nunca con la cifra declarada. TD → TS: 336 [299–379] ms.

EchoNet-Dynamic: no corrió (falta `ECHONET_DIR`). Con la carpeta del conjunto (FileList.csv, VolumeTracings.csv y Videos/) el banco añade la distribución de FE, VTD y VTS, el tiempo TD → TS de los trazados y la decorrelación de sus vídeos.

### 4. Movimiento: deformación longitudinal global y decorrelación

GLS del A4C: una línea 2 mm dentro de la pared desde el endocardio telediastólico, 40 puntos llevados cuadro a cuadro por correlación de bloques de 5 mm (sin regularizar), y la misma línea construida en cada cuadro sobre el mapa de estructuras del modelo. «Sin clutter»: el mismo cine sin la reverberación de la pared torácica ni la neblina de las cavidades. La deriva es lo que los puntos no vuelven a su sitio tras un ciclo.

| caso | GLS seguido (%) | GLS seguido sin clutter (%) | GLS del modelo, 2 mm / endocardio (%) | deriva con / sin clutter (mm) |
|---|---:|---:|---:|---:|
| normal | −10,3 | −8,0 | −19,9 / −19,9 | 3,9 / 3,3 |
| MCH obstructiva | −5,6 | −10,5 | −14,9 / −15,4 | 4,2 / 3,9 |
| ICFEr + IM | −2,1 | −2,5 | −6,4 / −6,8 | 1,5 / 1,5 |

Correlación de bloques de miocardio entre cuadros consecutivos a 50 cuadros/s: en el mejor desplazamiento (lo que el speckle se parece a sí mismo tras moverse) y en el mismo sitio. «EchoNet»: el cine reducido al formato de EchoNet (112 px) y los bloques elegidos sólo por su gris, como en los vídeos clínicos.

| caso | vista | pico | mismo sitio | pico EchoNet | mismo sitio EchoNet |
|---|---|---:|---:|---:|---:|
| normal | plax | 0,88 | 0,80 | 0,88 | 0,86 |
| normal | a2c | 0,90 | 0,86 | 0,83 | 0,79 |
| MCH obstructiva | a4c | 0,84 | 0,76 | 0,82 | 0,78 |
| normal | psax-mv | 0,87 | 0,84 | 0,87 | 0,84 |
| ICFEr + IM | plax | 0,91 | 0,87 | 0,93 | 0,92 |
| ICFEr + IM | a2c | 0,93 | 0,90 | 0,85 | 0,82 |
| normal | a4c | 0,89 | 0,85 | 0,85 | 0,81 |
| ICFEr + IM | psax-mv | 0,90 | 0,89 | 0,91 | 0,90 |
| MCH obstructiva | plax | 0,84 | 0,72 | 0,88 | 0,86 |
| MCH obstructiva | a2c | 0,86 | 0,79 | 0,81 | 0,76 |
| ICFEr + IM | a4c | 0,92 | 0,89 | 0,87 | 0,84 |
| MCH obstructiva | psax-mv | 0,82 | 0,76 | 0,85 | 0,82 |

### 5. Prueba de Turing visual

Sesión en `~/datos/realism-turing`: 24 elementos.

| vista / formato | reales | simulados |
|---|---:|---:|
| a4c/tile-still | 6 | 6 |
| a2c/tile-still | 6 | 6 |

Fuera de la sesión por no tener contraparte: a2c/tile-clip (0 reales, 3 simulados); a4c/echonet-clip (0 reales, 3 simulados); a4c/tile-clip (0 reales, 3 simulados); plax/tile-clip (0 reales, 3 simulados); psax-mv/tile-clip (0 reales, 3 simulados).

Todavía sin respuestas corregidas (`--answers`).
