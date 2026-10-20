# Banco de realismo (decisiones 344, 345, 347, 348, 349 y 355)

Este documento es el registro del banco que juzga si un cambio acerca el simulador a la ecografía real. Arriba, la
lectura de la corrida; abajo, el informe tal como lo escribe `npm run realism` (procedimiento en
`docs/validation/README.md` § 5). Al repetir la corrida, el informe nuevo sustituye la parte de abajo y la lectura se
reescribe con sus cifras.

## Lectura de la corrida del 2026-10-20

El banco mide primero el corazón sano (el caso normal con ventana excelente y con ventana difícil), contra CAMUS (500
pacientes, fotogramas de telediástole y telesístole) y, desde esta corrida, contra EchoNet-Dynamic (10 030 vídeos
apicales de cuatro cámaras).

**Qué se puede afirmar ya.**

1. **El speckle mostrado es más liso y más regular que el real: es la brecha de imagen más clara.** Una sola mirada del
   simulador tiene la SNR de Rayleigh (1,90–1,92), pero el compuesto de dos miradas (decisión 145) la sube a 2,67. En el
   miocardio del A4C normal el gris residual tiene una desviación de 14,8 frente a 19,6 [17,7–22,0] en CAMUS Good y una
   asimetría de 0,19 frente a 0,53 [0,42–0,67]: 1,1 y 1,4 anchos intercuartiles por debajo, en la misma dirección.
2. **El haz lateral es más fino de lo que su transductor permite.** Con la apertura que declara (14 mm, 2,5 MHz, foco a
   9 cm), ni una apertura sin apodizar baja de 3,6 mm en el foco; el simulador dibuja 2,9 mm (y 4,4 frente a 6,1 a
   15 cm), y el quiste anecoico de 8 mm contrasta −20,4 dB frente a −15,7. La fórmula combina emisión y recepción como
   dos gaussianas de 1,02 λF (0,72 λF) donde la difracción da 0,886 λF. Su celda de speckle también es más fina: 2,88 mm
   a 9 cm frente a los 3,30 de la apertura sin apodizar (decisión 355; la cifra anterior de la referencia, 2,80, salía de
   una sola realización de su campo, que da cualquier valor entre 2,85 y 3,60, y de restar la media de cada fila). La
   PSF es un ajuste a CAMUS, no la física declarada. La imagen por convolución (decisión 351) tiene la de la física:
   3,43 mm de celda, 3,53 mm de resolución lateral frente a 3,56 y un quiste de −16,7 dB frente a −16,5.
3. **El movimiento del corazón sano se parece al real en lo que el banco puede medir.**
   - El acortamiento del contorno endocárdico, medido igual que sobre los trazados de los expertos y en el formato de
     EchoNet, es −18,9 % en el simulador frente a −18,5 % [−23,6 a −12,7] en los 40 vídeos normales de EchoNet; el GLS
     del contorno del modelo, −19,9 %, dentro de −18 a −22.
   - El speckle se renueva entre cuadros como en EchoNet: correlación de bloques de 0,85 frente a 0,84 [0,81–0,87] en el
     mejor desplazamiento, y 0,81 frente a 0,81 [0,78–0,85] en el mismo sitio.
   - **El GLS seguido bajo no es una prueba contra el simulador.** El mismo rastreador, llevado sobre los vídeos de
     EchoNet desde el contorno trazado en telediástole hasta telesístole, recupera 0,28 [0,11–0,41] del acortamiento que
     trazan los expertos; sobre el simulador en el mismo formato, 0,43.
   - **Con movimiento verdadero, el speckle del simulador sigue a su tejido casi como el de una simulación lagrangiana.**
     En una secuencia sintética de CREATIS (Evain et al. 2022), cuyo speckle se mueve con la malla que la generó, el
     rastreador del banco (ahora regularizado) lee 0,66 [0,62–0,81] del acortamiento verdadero de las capas internas de la
     pared; en el simulador lee 0,55 del acortamiento de su contorno. La diferencia (0,8 de la tolerancia) es compatible
     con la capa fija del clutter de la pared torácica, que en el tabique medio frena el movimiento longitudinal del
     speckle. En la ventana difícil el rastreador no sigue nada: su textura está dominada por el clutter, como en una
     ventana difícil real.
4. **La sístole dura de más, y ya se sabe por qué.** De telediástole a telesístole el simulador tarda 407 ms; CAMUS,
   336 [299–379], y los vídeos normales de EchoNet a la misma frecuencia (65 lpm, estimada por la periodicidad de cada
   vídeo), 320 [300–360]. Los tiempos del modelo son los de Weissler (preeyectivo 105 ms, eyección 303 ms), pero la onda
   A termina con el QRS: la mitral cierra en la fase 0 y todo el preeyectivo es contracción isovolumétrica (105 ms
   frente a ~40–70). El índice de Tei del corazón sano sale 0,60 frente a 0,39 ± 0,05. Hay una propuesta en la rama
   `feat/electromechanical-delay` (fase 0 = cierre mitral, QRS 50 ms antes): isovolumétrica de 55 ms, Tei de 0,43 y
   358 ms de telediástole a telesístole, sin tocar la onda A; espera revisión porque mueve los estados sistólicos de las
   fases fijas y con ellos 23 pruebas lentas de anatomía e imagen.
5. **El VI normal es grande para EchoNet.** El volumen biplano de la imagen (116 / 39 mL, FE 66 %) está
   dentro de los rangos de la ASE/EACVI, pero por encima de los VI normales de EchoNet (VTD 75 [58–95], VTS 28 [21–37]
   mL, medidos por su sistema clínico en un solo plano).

**Qué no se puede afirmar todavía.**

- **Ninguna prueba ciega con lectores.** La sesión con clips está generada en `~/datos/realism-turing-clips` (36
  elementos: 6 + 6 clips A4C en el formato de EchoNet y 6 + 6 fotogramas A4C y A2C de CAMUS) y nadie la ha rendido.
  PLAX y PSAX no tienen contraparte pública (`REALISM_REAL_DIR`).
- **El rastreador se ha validado con una sola secuencia de movimiento verdadero.** El conjunto completo de CREATIS
  (proyecto MEDICAID) daría la dispersión entre pacientes; basta copiar sus `.mat` en `~/datos/CREATIS-sinteticos`.
- **Field II de verdad no se ha corrido**; la referencia física es una suma con retardos propia con su modelo y su pulso.
- **El código de discos del banco da en CAMUS una FE 7,7 puntos más alta que la declarada** (r = 0,97): con CAMUS se
  compara siempre con el mismo código en los dos lados.

**Orden de trabajo que sugiere para el corazón sano.** (1) Que un ecocardiografista rinda la sesión ciega. (2) La
textura del miocardio: es la brecha de imagen mayor y la que un lector ve primero; el banco dirá si un cambio del
compuesto o de los granos la cierra sin abrir otra. (3) Decidir la cronología de la sístole (la propuesta de la rama
`feat/electromechanical-delay`, o dejar la sístole en su sitio y prolongar la onda A más allá del QRS). (4) Decidir el transductor: declarar uno de equipo cardiaco actual y dejar que la difracción dé la PSF, o
documentar que la PSF es un ajuste a CAMUS.

## Informe generado

Generado por `npm run realism` (decisión 344) el 2026-10-20 01:49 UTC, en 8,8 min. Fuentes clínicas: CAMUS sí, EchoNet-Dynamic sí. Sólo cifras agregadas: ninguna imagen clínica ni dato individual sale de las carpetas de origen.

Motor medido: `actual` (modelo analítico actual (trazador CPU, nivel calibrado)), en el commit `faa698a`.

### Brechas, de mayor a menor

Una sola escala para ordenarlas: en física, |ln(sim/ref)|/ln 1,25 (1 = un 25 % de error) o |Δ dB|/6; contra una distribución clínica, la distancia a la mediana en anchos intercuartiles; contra un rango normal, la distancia fuera de él sobre su media anchura (0 dentro). Por encima de 1 la brecha es mayor que la tolerancia con que se ha calibrado el simulador hasta ahora.

| # | área | métrica | simulador | referencia | fuente de la referencia | puntuación |
|---:|---|---|---:|---:|---|---:|
| 1 | física | SNR del speckle uniforme (envolvente mostrada, 2 miradas) | 2,67  | 1,91  | Rayleigh (Burckhardt 1978) y la referencia | 1,5 |
| 2 | física | resolución lateral −6 dB a 15 cm | 4,39 mm | 6,05 mm | DAS tipo Field II sin apodizar (con Hanning 9,76 mm) | 1,4 |
| 3 | imagen clínica | asimetría del gris residual del miocardio (A4C, TD) | 0,19  | 0,53  | CAMUS Good, mediana [0,42–0,67] | 1,4 |
| 4 | imagen clínica | desviación del gris residual del miocardio (A4C, TD) | 14,81 gris | 19,64 gris | CAMUS Good, mediana [17,73–21,97] | 1,1 |
| 5 | física | resolución lateral −6 dB a 9 cm | 2,86 mm | 3,56 mm | DAS tipo Field II sin apodizar (con Hanning 5,79 mm) | 1,0 |
| 6 | volumen y tiempo | telediástole → telesístole (caso normal) | 407,50 ms | 336,28 ms | CAMUS, mediana [299–379] | 0,9 |
| 7 | imagen clínica | curtosis del gris residual del miocardio (A4C, TD) | 0,23  | 0,95  | CAMUS Good, mediana [0,61–1,42] | 0,9 |
| 8 | movimiento | fracción del acortamiento que el rastreador lee en el simulador (A4C normal) | 0,55  | 0,66  | la misma fracción con movimiento verdadero (CREATIS), mediana [0,62–0,81] | 0,9 |
| 9 | física | contraste de un quiste anecoico de 8 mm a 9 cm | −20,44 dB | −15,69 dB | DAS tipo Field II sin apodizar (con Hanning −9,8 dB) | 0,8 |
| 10 | volumen y tiempo | FE de la imagen frente a la del modelo (caso normal) | 66,13 % | 62,50 % | el volumen del modelo (tablas del latido) | 0,7 |
| 11 | física | celda de speckle lateral a 9 cm | 2,88 mm | 3,30 mm | DAS tipo Field II sin apodizar (con Hanning 5,53 mm) | 0,6 |
| 12 | movimiento | razón rastreado / trazado de TD a TS, formato EchoNet (A4C normal) | 0,43  | 0,28  | EchoNet, mediana [0,11–0,41] | 0,5 |
| 13 | física | resolución axial −6 dB a 9 cm | 0,69 mm | 0,64 mm | pulso de Field II (2 + 2 ciclos) | 0,3 |
| 14 | imagen clínica | gris mediano del miocardio (A4C, TD) | 109,00 gris | 100,00 gris | CAMUS Good, mediana [87,00–115,00] | 0,3 |
| 15 | movimiento | correlación de bloques entre cuadros, formato EchoNet (A4C normal) | 0,85  | 0,84  | EchoNet, mediana [0,81–0,87] | 0,2 |
| 16 | física | resolución lateral −6 dB a 5 cm | 2,06 mm | 2,15 mm | DAS tipo Field II sin apodizar (con Hanning 3,36 mm) | 0,2 |
| 17 | volumen y tiempo | VTD biplano medido en la imagen (caso normal) | 115,82 mL | 98,00 mL | ASE/EACVI 2015, 46–150 mL | 0,0 |
| 18 | volumen y tiempo | VTS biplano medido en la imagen (caso normal) | 39,23 mL | 37,50 mL | ASE/EACVI 2015, 14–61 mL | 0,0 |
| 19 | volumen y tiempo | FE biplano medida en la imagen (caso normal) | 66,13 % | 63,00 % | ASE/EACVI 2015, 52–74 % | 0,0 |
| 20 | movimiento | GLS del contorno del modelo, 2 mm dentro de la pared (A4C, caso normal) | −19,94 % | −20,00 % | normal −18 a −22 % | 0,0 |

Fuera del orden, porque el instrumento no está validado:

- GLS por seguimiento de speckle (A4C, caso normal): −10,95 % frente a −20,00 % (normal −18 a −22 %; puntuación 3,5). El rastreador del banco recupera −20 % en una deformación sintética, pero en los vídeos de EchoNet recupera sólo una fracción del acortamiento que trazan los expertos, como en el simulador reducido a su formato (ver «Rastreo de los trazados»); validarlo a resolución completa pide clips con el movimiento verdadero.

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
| 5 | 2,64 / 1,90 / 2,91 | 1,94 | 2,40 / 1,06 | 0,90 | 70 | 0,69 / 0,56 | 1,98 / 1,86 / 3,15 |
| 9 | 2,67 / 1,92 / 3,05 | 1,80 | 2,30 / 1,03 | 1,26 | — | 0,65 / 0,56 | 2,88 / 3,30 / 5,53 |
| 13 | 2,51 / 1,84 / 3,02 | 1,98 | 3,28 / 1,14 | 0,94 | 14 | 0,77 / 0,57 | 3,66 / 4,78 / 7,81 |

### 2. Imagen clínica: textura del miocardio frente a CAMUS

Gris residual del miocardio erosionado (gris menos su media local de ±4 mm, sin los píxeles recortados en 0 o 255), el mismo código sobre CAMUS (imágenes Good, cuatro y dos cámaras, TD y TS) y sobre el simulador. La forma (asimetría, curtosis) no depende de la escala de grises si ésta es lineal en dB; la desviación sí.

CAMUS (1010 imágenes): asimetría 0,53 [0,42–0,67], curtosis 0,95 [0,61–1,42], desviación 19,6 [17,7–22,0], gris mediano 100 [87–115].

| caso | vista | fase | asimetría | curtosis | desviación | gris mediano |
|---|---|---|---:|---:|---:|---:|
| normal | a2c | TD | 0,37 | 0,54 | 15,1 | 115 |
| normal | a2c | TS | 0,40 | 1,05 | 13,2 | 98 |
| normal, ventana difícil | a2c | TD | −0,01 | 0,46 | 10,9 | 83 |
| normal, ventana difícil | a2c | TS | 0,05 | 0,37 | 10,6 | 79 |
| normal | a4c | TD | 0,19 | 0,23 | 14,8 | 109 |
| normal | a4c | TS | 0,45 | 0,95 | 13,2 | 97 |
| normal, ventana difícil | a4c | TD | 0,22 | 0,55 | 12,2 | 89 |
| normal, ventana difícil | a4c | TS | −0,07 | 0,89 | 10,1 | 82 |

Envolvente del miocardio antes de la consola (TD): la SNR de toda la pared lleva sus cambios de nivel (ángulo de fibra, profundidad, granos); la SNR por ventanas, el speckle. Compárese con la del speckle uniforme por ventanas.

| caso | vista | SNR pared | SNR ventanas | α de K |
|---|---|---:|---:|---:|
| normal | plax | 1,49 | 2,63 | 0,87 |
| normal | a2c | 0,98 | 2,48 | 0,27 |
| normal | psax-mv | 1,00 | 2,59 | 0,36 |
| normal, ventana difícil | plax | 0,96 | 2,56 | 0,51 |
| normal, ventana difícil | a2c | 1,08 | 2,79 | 0,51 |
| normal | a4c | 0,90 | 2,46 | 0,21 |
| normal, ventana difícil | psax-mv | 0,65 | 2,41 | 0,08 |
| normal, ventana difícil | a4c | 0,98 | 2,55 | 0,39 |

### 3. Volumen del VI a lo largo del ciclo

Método de discos biplano sobre la máscara de la cavidad (el mapa de estructuras del simulador visto por la misma conversión de barrido, A4C y A2C a 50 cuadros/s), frente al volumen del modelo (las tablas del latido). En CAMUS el mismo código corre sobre las máscaras de los expertos.

| caso | VTD imagen / modelo (mL) | VTS imagen / modelo (mL) | FE imagen / modelo (%) | TD → TS (ms) |
|---|---:|---:|---:|---:|
| normal | 116 / 120 | 39 / 45 | 66,1 / 62,5 | 407 |
| normal, ventana difícil | 80 / 96 | 25 / 36 | 68,3 / 62,5 | 407 |

CAMUS (500 pacientes, población con FE reducida en buena parte): VTD 91 [72–116] mL, VTS 42 [30–58] mL, FE del banco 53,4 [44,9–60,7] %, FE declarada 46,0 [37,0–52,0] %. El código del banco da una FE 7,7 puntos por encima de la declarada (error medio absoluto 7,7, r = 0,97, 500 pacientes): por eso el simulador se compara con CAMUS siempre con el mismo código, nunca con la cifra declarada. TD → TS: 336 [299–379] ms.

EchoNet-Dynamic (10030 vídeos): FE 59,2 [51,6–64,0] %, VTD 82 [62–108] mL, VTS 34 [24–49] mL; con FE ≥ 55 % (6961): VTD 75 [58–95], VTS 28 [21–37] mL. TD → TS de los cuadros trazados: 320 [280–360] ms. La FE de los trazados (discos monoplano en píxeles) frente a la declarada: sesgo −0,7, error medio absoluto 1,1 (10024).

### 4. Movimiento: deformación longitudinal global y decorrelación

GLS del A4C: una línea 2 mm dentro de la pared desde el endocardio telediastólico, 40 puntos llevados cuadro a cuadro por correlación de bloques de 5 mm (sin regularizar), y la misma línea construida en cada cuadro sobre el mapa de estructuras del modelo. «Sin clutter»: el mismo cine sin la reverberación de la pared torácica ni la neblina de las cavidades. La deriva es lo que los puntos no vuelven a su sitio tras un ciclo.

| caso | GLS seguido (%) | GLS seguido sin clutter (%) | GLS del modelo, 2 mm / endocardio (%) | deriva con / sin clutter (mm) |
|---|---:|---:|---:|---:|
| normal | −10,9 | −8,2 | −19,9 / −19,9 | 3,3 / 3,2 |
| normal, ventana difícil | −1,1 | −2,1 | −24,0 / −23,9 | 2,5 / 3,5 |

Correlación de bloques de miocardio entre cuadros consecutivos a 50 cuadros/s: en el mejor desplazamiento (lo que el speckle se parece a sí mismo tras moverse) y en el mismo sitio. «EchoNet»: el cine reducido al formato de EchoNet (112 px) y los bloques elegidos sólo por su gris, como en los vídeos clínicos.

| caso | vista | pico | mismo sitio | pico EchoNet | mismo sitio EchoNet |
|---|---|---:|---:|---:|---:|
| normal | plax | 0,88 | 0,80 | 0,88 | 0,86 |
| normal | a2c | 0,90 | 0,86 | 0,83 | 0,79 |
| normal | psax-mv | 0,87 | 0,84 | 0,87 | 0,84 |
| normal, ventana difícil | plax | 0,81 | 0,74 | 0,86 | 0,83 |
| normal, ventana difícil | a2c | 0,82 | 0,80 | 0,83 | 0,80 |
| normal | a4c | 0,89 | 0,85 | 0,85 | 0,81 |
| normal, ventana difícil | psax-mv | 0,72 | 0,66 | 0,84 | 0,80 |
| normal, ventana difícil | a4c | 0,82 | 0,79 | 0,83 | 0,79 |

EchoNet (40 vídeos con FE ≥ 55 %, 50 [50–50] cuadros/s): pico 0,84 [0,81–0,87], mismo sitio 0,81 [0,78–0,85].

#### Rastreador frente al movimiento verdadero

El rastreador del banco (bloques de 2,5 mm, mediana de ±2 vecinos, 36 puntos) sobre 1 secuencia(s) sintética(s) de CREATIS (Evain et al. 2022), cuyo speckle sigue a la malla que la generó: de telediástole a telesístole lee 0,66 [0,62–0,81] del acortamiento verdadero de las capas internas de la pared, con un error de 1,8 [1,5–2,2] mm en la posición final. En el simulador el mismo rastreador lee 0,55 del acortamiento del contorno del modelo: si las dos fracciones coinciden, el speckle del simulador sigue a su tejido como el de una simulación lagrangiana.

| secuencia | capa | verdadero (%) | rastreado (%) | fracción | error (mm) |
|---|---:|---:|---:|---:|---:|
| patient050.mat | 0 | −22,8 | −14,1 | 0,62 | 2,2 |
| patient050.mat | 1 | −20,0 | −16,2 | 0,81 | 1,5 |
| patient050.mat | 2 | −17,4 | −11,6 | 0,66 | 1,8 |

#### Rastreo de los trazados

El contorno endocárdico de telediástole, 2 px dentro de la pared y en 13 puntos, llevado cuadro a cuadro hasta telesístole con bloques de 7 px y la mediana de los desplazamientos vecinos, frente al mismo contorno trazado en telesístole. En EchoNet el contorno sale de los trazados de los expertos (los extremos de las cuerdas de los discos); en el simulador, del mapa de estructuras, y el cine se reduce al formato de EchoNet (112 px) con el mismo recorte. Una razón de 1 es un rastreador que sigue la pared como la sigue el trazado.

EchoNet (40 vídeos con FE ≥ 55 %): deformación trazada −18,5 [−23,6–−12,7] %, rastreada −5,5 [−7,1–−1,8] %, razón 0,28 [0,11–0,41].

| caso | trazado (%) | rastreado (%) | razón | correlación media |
|---|---:|---:|---:|---:|
| normal | −18,9 | −8,2 | 0,43 | 0,96 |
| normal, ventana difícil | −23,5 | −0,4 | 0,02 | 0,90 |

### 5. Prueba de Turing visual

No se generó sesión (sin `--turing`).

### Fuentes de datos

- CAMUS: Leclerc et al., «Deep learning for segmentation using an open large-scale dataset in 2D echocardiography», IEEE TMI 38(9):2198–2210, 2019, doi:10.1109/TMI.2019.2900516.
- EchoNet-Dynamic: Ouyang et al., «Video-based AI for beat-to-beat assessment of cardiac function», Nature 580:252–256, 2020, doi:10.1038/s41586-020-2145-8; conjunto de datos doi:10.71718/yqp5-y078. Datos del Stanford Center for Artificial Intelligence in Medicine and Imaging (AIMI), bajo su acuerdo de uso para investigación, que no permite redistribuir partes de los datos: aquí sólo hay cifras agregadas.
