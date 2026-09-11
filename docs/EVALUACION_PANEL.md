# Evaluación crítica del simulador por un panel de expertos (2026-09-11)

Evaluación exhaustiva de EchoTwin TTE hecha como la firmaría un panel internacional de ecocardiografía, cardiología, anatomía cardíaca, física del ultrasonido, ingeniería biomédica, simulación médica, gráficos por computador y educación médica. El estándar es el de una herramienta de entrenamiento de un fellowship de ecocardiografía o de un centro de simulación cardiológica internacional, no el de «un proyecto web que se ve bien».

La pregunta central es: **¿podría este simulador engañar durante unos segundos al cerebro entrenado de un ecocardiografista?** La respuesta es **no**. Este documento explica por qué con evidencia ejecutada, no con impresiones.

Versión evaluada: commit `467ecd0`, fin de la reconstrucción anatómica en 8 fases. Las capturas citadas están en `docs/validation/panel-2026-09-11/`.

## Método y evidencia

| Fuente | Qué se ejecutó | Dónde está |
|---|---|---|
| Capturas en vivo | Build de producción (`vite preview`) en Chromium 1440×900, calidad alta, backend por defecto (`atlas`); 12 vistas predeterminadas × 2D/color/M/CMM/PW/CW/TDI en 9 casos; 47 capturas del área de imagen | `docs/validation/panel-2026-09-11/*.png` (selección de 21) |
| Secuencias de fase | Trazador CPU a calidad alta, 10 fases del ciclo en PLAX, A4C y PSAX-PM | `motion-*-10-phases.png` |
| Medidor del modelo | `npm run measure -- normal-excellent-window`: 44 magnitudes contra rangos ASE/EACVI | sección 3 |
| Auditoría de planos | `audit-views.ts`: error de plano, rotación en el plano y distancia de cada referencia al plano en las 12 vistas | secciones 4, 5 y 33 |
| Mapas de estructuras | `slice-map.ts`, 12 vistas × 3 fases: clasificación exacta del SDF por muestra | secciones 5, 11 y 33 |
| Física medida | Estadística del speckle, niveles de gris por tejido y profundidad ante ganancia/TGC/rango dinámico/frecuencia/foco, banda especular, artefactos, correlación entre cuadros, tabla de frame rate | secciones 8–11, 18 y 20 |
| Interacción y Doppler medidos | Barrido continuo PLAX→PSAX, micro-pasos, atlas con anclas construidas, 300 poses aleatorias, 400 poses en la ventana difícil, PW/CW/TDI contra la verdad de terreno, sincronía ECG | secciones 12, 21, 22, 24 y 25 |
| Suite de pruebas | Al empezar, 131/132 unitarias: `goldens.test.ts` fallaba en `467ecd0`, que movió las raíces papilares sin regenerar goldens (deriva máxima de 17 niveles, sólo en PLAX, PSAX-PM y A4C, las vistas con papilares). Goldens regenerados tras revisar los renders: 132/132. E2E: 31/34 con tres esperas agotadas por carga de CPU en `core-flow`; repetido solo, 9/9; equivalencia CPU↔GPU 21/21 | `src/tests/goldens/frames.json` |
| Revisión adversarial | Tres revisores independientes con guiones propios sobre el mismo commit: anatomía y vistas, física y trazado, Doppler e interacción | anexo A |

Nota sobre el entorno: el navegador de captura no tiene GPU y cae al trazador CPU, que a calidad alta tarda ~1,1 s por cuadro mientras la sonda se mueve. Por eso algunas puntuaciones registradas durante la animación de los presets fueron más bajas que con WebGL2. Las imágenes son las mismas en ambos casos por diseño (prueba de equivalencia); las puntuaciones que se citan en la sección 5 son las canónicas del tier bajo, deterministas.

## Resumen ejecutivo

- **Nivel actual: B, simulador educativo básico.** La arquitectura es de nivel C/D: un solo corazón 3D paramétrico, sonda continua de 6 grados de libertad, cadena causal geometría→acústica→señal y Doppler derivado de las mismas tablas de flujo. La imagen que produce es de nivel B, varias vistas canónicas son de nivel A y el Doppler cuantitativo enseña valores equivocados.
- **Promedio de los 20 dominios: 3,2 / 7.** Ningún dominio llega a 6. Cinco dominios están en 2: speckle, realismo visual, Doppler, transferencia y realismo global.
- **Ecocardiografistas expertos que detectarían la simulación en menos de 5 s: 100 %.** El delator principal es el trazado: miocardio en bandas brillantes con estrías de líneas de barrido, cavidades de negro absoluto y un contorno especular grueso en todas las interfaces.
- **Seis fallas críticas**, que ningún promedio compensa:
  1. El speckle es ruido filtrado, sin estadística de interferencia ni escala real.
  2. La ecogenicidad es de dibujo: miocardio saturado, especular grueso, sangre negra.
  3. El backend por defecto (atlas) no muestra los ajustes finos: ±3° o ±3 mm no cambian la imagen y entre 4° y 8° se ven dos imágenes superpuestas.
  4. La ventana difícil es irresoluble: la atenuación de la pared se trata como sombra y deja el sector negro sin costilla ni pulmón en el trayecto.
  5. El Doppler color no tiene campo de flujo de cavidad: se dibuja en polígonos o no aparece.
  6. La subcostal 4C no se reconoce en la imagen aunque el plano contiene las cuatro cámaras.
- **Errores cuantitativos que un alumno aprendería como ciertos**: TDI con e′ de 4,7 cm/s en un corazón normal (E/e′ ≈ 20), CW que mide 1,27 m/s en una estenosis aórtica de 4,69 m/s desde la A5C canónica, PW que sobreestima la onda E un 19 % con tolerancia del 8 %, escala color de 1,2 m/s a 16 cm cuando el límite físico es 0,74 m/s.
- **Lo que está resuelto y no debe deshacerse**: las 44 medidas del corazón normal están en rango; la continuidad 3D es real, sin geometría por vista ni saltos entre presets; el movimiento es volumétrico y no un `scale()`; la convención de color, el aliasing, la PISA y la conservación de masa son correctos; la documentación de limitaciones es honesta en casi todo.

---

## 1. Nivel de exigencia

Referencias usadas: ecocardiografía clínica real (equipos de gama alta con sonda sectorial de 1,5–3,5 MHz y armónicos), simuladores profesionales de manipulación (CAE Vimedix, HeartWorks), anatomía 3D validada por TC/RM cardíaca, física plausible con Field II o k-Wave como referencia conceptual, respuesta continua a la sonda, coherencia entre vistas y movimiento fisiológico. No se concedió puntuación por «suficientemente bueno para la web». Cada simplificación que un ecocardiografista detectaría en segundos se anotó como error con evidencia.

## 2. Fidelidad anatómica

«Modelo» juzga la forma en `heartModel.ts`, `lvShape.ts` y los mapas de estructuras; «imagen» juzga lo que se ve en la ecografía simulada.

| Estructura | Modelo | Relaciones y tamaño | Imagen | Veredicto |
|---|---|---|---|---|
| Ventrículo izquierdo | Perfil «bala» tabulado: cuello anular 0,72·R, anchura máxima en el tercio basal, afilamiento (1−sⁿ)^½, cúpula elíptica; sección elíptica 0,94; campo de espesor con adelgazamiento apical | Eje a 33° del esternón; DTDVI 4,72 cm, longitud 8,59 cm, VTD 118 mL, masa 138 g, en rango | Cavidad reconocible en PLAX, A3C y A5C; la pared se ve más gruesa de lo modelado por la banda especular; sin capa trabecular visible | Forma correcta, imagen no |
| Ventrículo derecho | Semiluna entre surcos con infundíbulo, banda moderadora, papilar anterior y trabéculas de ruido | Anterior al VI, TSVD cruzando sobre la raíz; basal 3,10, medio 2,52, longitud 6,70 cm, VD/VI 0,64 | En PSAX-PM el VD está en el plano según el mapa, pero en la imagen es una franja oscura de campo cercano sin pared libre reconocible; en A4C es un triángulo pequeño de pared brillante | Modelo aceptable, imagen deficiente |
| Aurícula izquierda | Elipsoide recortado contra un tabique plano, recortes posterior y de techo; venas pulmonares como cápsulas; orejuela sin lóbulos | Posterior a la raíz; AP 3,58 cm, VAI 33 mL/m² en el límite alto | Globo elíptico de pared uniformemente brillante que domina la mitad inferior de A4C y A2C | Elipse simple, penalizado |
| Aurícula derecha | Elipsoide recortado con VCS y VCI como cápsulas; sin crista terminalis, válvula de Eustaquio ni orejuela | Relaciones venosas correctas; 21 mL/m² | Mismo globo | Elipse simple, penalizado |
| Septo interventricular | Espesor 0,88 cm, engrosamiento 45 % | Correctos | Banda brillante con estrías radiales y bordes nítidos | Aspecto de banda dibujada |
| Septo interauricular | Losa con fosa oval elíptica | Continuo con el SIV; 0,68 cm | Línea; la fosa no se distingue | Aceptable |
| Pared libre del VI | Espesor 0,84 cm, ruido de pared que se desvanece en el ápex | Correcta | En A4C brilla igual que el septo: sin anisotropía ni dropout | Imagen irreal |
| Pared libre del VD | 0,38 cm con trabéculas | Correcta | Banda brillante continua que nunca desaparece por ángulo | Imagen irreal |
| Ápex | Redondeado, 0,62 cm, fijo en el espacio | Correcto | Tapón brillante de campo cercano en A4C y A2C | Bien |
| TSVI | Continuidad mitroaórtica geométrica; 2,24 cm en sístole | Correcto | Reconocible | Bien |
| TSVD | Dos conos redondeados hasta la válvula pulmonar | 2,60 cm proximal | Tubo recto de radio casi constante en PSAX-AV | Cono, penalizado |
| Raíz aórtica | Senos en trébol suave; unión sinotubular | Anillo 2,48, senos 3,18, UST 2,80 cm | Correcta en PLAX; en PSAX-AV el trébol apenas se aprecia | Aceptable |
| Aorta ascendente | Tubo curvado que termina a 6,5 cm, sin arco | 2,98 cm | Salida visible en PLAX y A3C | Incompleta |
| Válvula aórtica | Tres cúspides de dos segmentos más aletas de coaptación | Correcta | Cúspides finas; en la estenosis severa sólo brillan más | Aceptable |
| Válvula mitral | Láminas con línea de coaptación y tres festones; anillo en silla | 3,00 cm | Valvas finas y móviles en PLAX y en modo M | Bien |
| Válvula tricúspide | Tres valvas radiales, desplazamiento apical 0,7 cm | 3,30 cm; TV/MV 1,10 | Apenas visible en A4C | Aceptable |
| Válvula pulmonar | Tres cúspides, sin senos propios | Correcta | No aparece en las vistas predeterminadas | Aceptable |
| Músculos papilares | Conos enraizados en la pared que se mueven con ella | Anterolateral y posteromedial correctos | Dos discos separados de la pared en PSAX-PM, confirmados por el mapa; en A5C un punto brillante suelto | Penalizado |
| Cuerdas tendinosas | 10 cuerdas rectas | Correctas | Líneas finas verosímiles | Aceptable |
| Anillos valvulares | Mitral en silla, tricúspide desplazado, aórtico plano | En rango | Sin estructura propia visible, correcto | Aceptable |
| Tronco pulmonar y ramas | Tubo de 2,28 cm con bifurcación corta | Correctas | Recto, radio constante | Cilindro, penalizado |
| Vena cava inferior | Cápsula recta; vena hepática recta en ángulo | Entra en la AD desde el hígado | Píldora de pared uniformemente brillante con extremo semicircular | Cápsula, penalizado |
| Vena cava superior | Cápsula | Correcta | No aparece en las vistas predeterminadas | — |
| Venas pulmonares | Cuatro cápsulas cortas | Correctas | No se distinguen en A4C | Débil |
| Pericardio | Unión suave de epicardios, grasa epicárdica, banda de 0,12 cm | Correcto | Trazo brillante de anchura uniforme; el derrame tiene contorno perfecto | Aspecto dibujado |

**Formas artificiales**: elipses simples en ambas aurículas; cápsulas y cilindros en VCI, vena hepática, VCS, venas pulmonares, seno coronario y tronco pulmonar; conos en TSVD y papilares; vasos rígidos que no pulsan. El tórax añade primitivas propias: los pulmones y el mediastino están limitados por caras planas, visibles como bordes rectos en PLAX, ejes cortos y subcostal (sección 11). Las paredes se ven de espesor uniforme por el trazado, aunque el modelo tiene campo de espesor. VI y VD son las únicas estructuras cuya forma evita las primitivas.

## 3. Dimensiones y proporciones

| Relación | Modelo | Referencia adulta | Juicio |
|---|---|---|---|
| VD/VI basal (A4C) | 0,64 | 0,45–0,80 | Correcto, VD algo generoso |
| Volumen máximo AI / VTD | 62/118 = 0,53 | 0,35–0,6 | Límite alto: la AI domina visualmente el A4C en telesístole |
| Volumen AD / VTD del VD | 39/132 = 0,30 | 0,25–0,45 | Correcto |
| AI/AD transversal | 4,62/3,58 = 1,29 | 1,0–1,3 | Correcto |
| VI diámetro/longitud | 4,72/8,59 = 0,55 | 0,50–0,62 | Correcto, no esférico |
| VD diámetro/longitud | 3,10/6,70 = 0,46 | 0,40–0,55 | Correcto |
| SIV / PP | 0,88 / 0,84 cm | 0,6–1,0 | Correctos en el modelo; se ven de 1,0–1,2 cm |
| Pared libre del VD | 0,38 cm | 0,2–0,5 | Correcta |
| TSVI | 2,24 cm | 1,8–2,4 | Correcto |
| Anillo / senos / UST | 2,48 / 3,18 / 2,80 cm | 2,3–2,9 / 3,1–3,7 / 2,6–3,2 | Correctos, senos en el límite inferior |
| Aorta ascendente | 2,98 cm | 2,6–3,4 | Correcta |
| Tronco pulmonar | 2,28 cm | 1,5–2,7 | Correcto |
| Anillo mitral / tricúspide | 3,00 / 3,30 cm | 2,7–3,5 / 2,8–4,0 | Correctos |

Errores buscados: VD pequeño, no; AI grande, sólo perceptualmente; VI circular, no; septo grueso, no en el modelo pero sí en la imagen; pared derecha gruesa, no; aorta desproporcionada, no; TSVD largo, ligeramente.

**Coherencia entre planos**: las dimensiones se conservan porque hay un único SDF. La distorsión que existe viene de la obliquidad de los ejes cortos canónicos: PSAX-MV a 24° alarga el VI y engruesa la pared aparente un 9,5 %. Eso sería aceptable como limitación de ventana si el plano contuviera lo que define, y no lo contiene (sección 5).

## 4. Geometría 3D y continuidad

Existe un corazón tridimensional real. Cada vista es un corte del mismo SDF, la sonda tiene 6 grados de libertad continuos y las vistas predeterminadas no saltan: interpolan la pose durante 1–4 s con GPU y hasta 11 s con el trazador CPU. En el trazador procedimental, un barrido PLAX→PSAX en 24 pasos cambia la imagen entre 7,8 y 11 niveles de gris por paso, sin saltos. Al rotar la sonda el VI pasa de bala a anillo y vuelve, y la raíz aparece al rotar hacia A3C.

Contradicciones geométricas: ninguna (sección 33). Penalizaciones:
- La imagen que ve el usuario pasa por el atlas, que congela la imagen en ±3° y mezcla dos anclas entre 4° y 8° (sección 12). La continuidad del modelo no llega a la pantalla.
- La transición A4C→A2C exige deslizar 2 cm además de rotar.
- El eje largo del PLAX canónico queda inclinado 31° en el plano de la imagen en lugar de horizontal.
- El movimiento cardíaco llega cuantizado a 32 fases por latido (sección 6).

## 5. Vistas ecocardiográficas

Criterios: anatomía, orientación, proporciones, estructuras ausentes, estructuras sobrantes, profundidad, relación con el sector, apariencia y continuidad. «Score» es la puntuación del propio simulador en la pose canónica (tier bajo). Las distancias al plano vienen de `audit-views.ts`.

| Vista (score) | Anatomía y orientación | Faltan | Sobran | Apariencia | Veredicto |
|---|---|---|---|---|---|
| PLAX (97) | VD, SIV, VI, PP, mitral, TSVI, raíz con cúspides, AI y aorta descendente presentes; eje largo inclinado 31° en el plano en vez de horizontal | Nada | Cuña negra de borde recto a la izquierda: pulmón limitado por un plano, no sombra costal | Bandas brillantes con estrías, cavidades negras; la más convincente | Reconocible en 1 s, sintética en 2 s |
| PSAX-VAo (90) | Raíz con signo de Y, AI, AD; plano 17° oblicuo | TSVD y tricúspide según el score; válvula pulmonar y ramas | Trazos en escalera en la mitad derecha: reverberación pulmonar | TSVD como tubo recto; AI globo | Aceptable, contaminada |
| PSAX-MV (68) | VI ovalado con boca de pez; plano 24° oblicuo | VD, septo inferior a 1,79 cm del plano, pared inferolateral a 3,44 cm | Bloque negro rectangular bajo el corazón: pulmón con cara vertical y escalón horizontal en el mapa | Miocardio como masa gris homogénea de ~2 cm aparentes | Deficiente |
| PSAX-PM (94) | Anillo circular a 0,5° de plano, dos papilares | VD reconocible (está en el mapa, no en la imagen) | Papilares como discos separados de la pared; escalera de reverberación a la derecha | Anillo de brillo uniforme, aspecto de «donut» | Deficiente |
| PSAX apical (88) | Anillo pequeño con cavidad | Ápex según el score; VD | Bloque negro rectangular en el tercio inferior | Igual que PM | Deficiente |
| A4C (91) | Cuatro cámaras en el orden correcto, septo continuo; plano 7°; tricúspide a 0,62 cm del plano | Venas pulmonares, orejuelas; valvas AV apenas visibles | Banda rayada a la izquierda de la AD: reverberación pulmonar | Aurículas globo más grandes que los ventrículos en telesístole; pared lateral tan brillante como el septo | Reconocible, «de animación médica» |
| A5C (93) | TSVI y raíz al centro; válvula aórtica a 0,87 cm y TSVI a 0,57 cm del plano | Mitral según el score | Punto brillante suelto | Igual que A4C | Aceptable en imagen; el CW falla desde esta pose |
| A2C (90) | VI alargado, AI, paredes anterior e inferior; plano 2° | Pared anterior según el score; seno coronario | Mitad derecha del sector ocupada por bandas paralelas de reverberación pulmonar en un caso de ventana excelente | Buena silueta del VI; AI globo | Aceptable si no fuera por el pulmón |
| A3C (93) | VI, TSVI, raíz, AI; plano 6° | Nada | Nada | La mejor apical | Aceptable |
| VD enfocada | VD con pared brillante y AD | Trabeculación apical y banda moderadora reconocibles | Aurículas globo | Igual que A4C | Aceptable |
| Subcostal 4C (65) | El mapa contiene las cuatro cámaras con el VD junto a la pared, pero el hígado sólo cubre el ángulo superior izquierdo y el haz central cruza pared abdominal y grasa | AI, tricúspide y mitral según el score; componente «geometría» siempre 0 | Cuña negra de borde recto a la izquierda: pulmón con cara plana | Corazón oscuro a 6–13 cm con la ganancia por defecto: irreconocible | **Fallida** |
| VCI (68) | Hígado, VCI, vena hepática, AD | Válvula de Eustaquio; colapso continuo | Nada | VCI como píldora de contorno brillante | Deficiente |
| Supraesternal | **No existe**: la aorta termina a 6,5 cm | — | — | — | Ausente |

## 6. Movimiento cardíaco

Comprobado en las secuencias de 10 fases y en `computeHeartPose`:
- **Acortamiento longitudinal**: sí. El anillo mitral desciende hacia un ápex fijo (MAPSE 1,32 cm).
- **Engrosamiento radial**: sí, por conservación del volumen parietal más un 12 % de compactación trabecular; SIV 45 %.
- **Reducción de volumen**: sí. El radio sale de las tablas de volumen (VTD 118, VTS 44 mL, FE 63 %).
- **Septo y pared posterior**: se acercan al centro con engrosamiento; sin asimetría regional en el caso normal.
- **VD**: TAPSE y acercamiento de la pared libre al septo; sin peristalsis infundibular.
- **Aurículas**: reservorio, conducto y contracción con retención tras la onda A.
- **Anillos, papilares y trabéculas**: descienden o acompañan a la pared en coordenadas materiales.

No hay `scale()` ni transformación uniforme: la deformación es un campo por acimut y nivel. Faltan la **torsión** (rotación apical y basal opuestas), el gradiente base–ápex, la traslación del corazón con la respiración y la asimetría entre paredes. Además el atlas **cuantiza el movimiento a 32 fases** (28,8 ms por fase a 65 lpm): a calidad alta 54 de 200 cuadros saltan dos fases o más y a calidad baja 58 de 200 repiten el anterior. Se percibe como tirones.

## 7. Válvulas

**Mitral**: valva anterior larga y posterior corta con festones, coaptación en línea, apertura en E y A con patrón M/W en modo M, anillo en silla que desciende, continuidad mitroaórtica correcta, papilares enraizados y 10 cuerdas. Errores: valvas de segmentos rígidos sin flexión continua; la válvula **se cierra del todo en la diástasis** durante 96 ms a 65 lpm; en MCH, estenosis aórtica y prolapso la E se funde con la A.

**Tricúspide**: inserción septal 0,7 cm más apical que la mitral, tres valvas y relación con el VD correctas; aparato subvalvular reducido a un papilar; en A4C la valva septal apenas se distingue.

**Aórtica**: tres cúspides que abren contra los senos y cierran con signo de Y; senos en trébol suave; inserción en anillo plano, no en corona; sin nódulos. A mesosístole los bordes todavía convergen en PSAX-AV y la válvula parece cerrada.

**Pulmonar**: cúspides reales entre un TSVD cónico y un tronco recto; sin senos propios.

Juicio: mitral y aórtica de simulador educativo; tricúspide y pulmonar de animación.

## 8. Física del ultrasonido

Existe una cadena causal real: clasificación del tejido por SDF, reflectividad y atenuación por tejido y frecuencia, transmisión acumulada a lo largo de cada línea, término especular dependiente del ángulo, dispersión difusa modulada por ruido en coordenadas materiales, promedio de tres planos de elevación y consola (ganancia, TGC, resolución axial, compresión logarítmica, desenfoque lateral, realce, persistencia, mapa de grises). Medido: la transmisión del miocardio cae de 0,46 a 1–2 cm hasta 0,06 a 8–9 cm a 2,5 MHz con armónicos; a 3,5 MHz baja a 0,03 y a 1,7 MHz se mantiene en 0,17.

Lo que no es física:
- No hay propagación de ondas ni PSF: el speckle es ruido de valor, no interferencia de dispersores.
- La resolución axial y lateral se imponen con filtros de consola; no emergen del pulso ni de la apertura.
- No hay refracción ni perfil de haz; el grosor de corte usa una anchura fija por profundidad.
- Los armónicos son multiplicadores fijos; la velocidad del sonido sólo fija el frame rate.
- La atenuación de la pared en la ventana difícil está descalibrada: transmisión de 0,0024 a 5,3 cm frente a 0,16 esperados, unos −52 dB a 5 cm sin costilla ni pulmón en la línea.

Conclusión: el esqueleto causal existe, pero la textura y los bordes no derivan de la física sino de ruido y filtros, y eso es lo que el ojo entrenado detecta.

## 9. Speckle y textura

Medido en el trazado crudo del miocardio a 3–8 cm, tier alto:

| Magnitud | Simulador | Speckle desarrollado |
|---|---|---|
| SNR de amplitud | 3,61 | 1,91 (Rayleigh) |
| Asimetría | 0,95 | 0,63 |
| SNR de intensidad | 1,69 | 1,00 |
| Semianchura lateral a 4–6 cm | 0,31 mm | ~1,5–2 mm con sonda de 2,5 MHz |
| Semianchura axial a 4–6 cm | 0,42 mm | ~0,4 mm |
| Contraste en pantalla | 0,22–0,27 | 0,5–0,6 |

El speckle está sub-desarrollado, es casi isótropo y su celda lateral es 5 veces menor de lo real. En pantalla el desenfoque lateral lo convierte en estrías a lo largo del haz: el septo se ve «cepillado».

Lo que está bien: el ruido está en coordenadas materiales y se desplaza con el tejido (el block-matching entre cuadros a 18 ms recupera r = 0,84–0,91), no se regenera en cada cuadro y el orden de ecogenicidades es correcto (pericardio > miocardio > sangre). Lo que está mal: el miocardio está saturado (gris 117 con bordes 1,5 veces más brillantes que el centro) y la sangre es negro absoluto (gris 3–10, sin textura ni clutter), lo que da un contraste de dibujo.

## 10. Atenuación y profundidad

La imagen se deteriora con la profundidad: la amplitud del miocardio pasa de 0,23 a 1–2 cm a 0,03 a 9–10 cm, la resolución lateral empeora lejos del foco y el TGC de 8 bandas compensa de forma selectiva. Fallas:
- El **ruido relativo no crece con la profundidad**: el suelo de ruido de consola es 0 hasta 12 cm, así que el campo lejano sigue negro y limpio.
- La pérdida de detalle es un desenfoque gaussiano, no pérdida de coherencia.
- La ganancia alta no satura: con +12 dB el miocardio llega a 191 sin recorte.
- La ventana difícil pasa directamente a negro: atenuación de pared ×1,9 sobre 4,76 cm, sin gradiente que el alumno pueda mejorar.

## 11. Artefactos

| Artefacto | Estado | Evidencia |
|---|---|---|
| Sombra costal | Existe en el código (costillas como tubos). No se observó en las vistas canónicas revisadas, que colocan la sonda en un espacio intercostal, y con la sonda sobre el eje de la 4.ª costilla el revisor de física no encontró ninguna línea que la cruzara: comportamiento no verificado | `thoraxModel.ts`; prueba del revisor B |
| Bordes rectos negros | Son **pulmón y mediastino limitados por caras planas**, no sombras: cara horizontal bajo el VI en PLAX, cara vertical y escalón en PSAX-MV/PM, cara vertical en subcostal | Mapas de estructuras de PLAX, PSAX-MV, PSAX-PM y subcostal 4C |
| Reverberación pulmonar | Causal: picos a múltiplos de la profundidad pleural (2,23 → 4,42, 6,63, 8,88 cm). Pero en un caso de ventana excelente ocupa la mitad derecha del A2C y el borde de los ejes cortos como escaleras de trazos nítidos | Revisor B; `a2c-2d.png` con su mapa |
| Refuerzo posterior | No existe | Tras el derrame no hay refuerzo |
| Dropout por ángulo | Parcial: el especular cae −18 dB a 60°, la dispersión difusa no depende del ángulo | Pared lateral del A4C |
| Clutter de campo cercano | Existe, evaluado en coordenadas del tórax (r = 0,83 al mover la sonda 0,6 cm) | Revisor B |
| Lóbulos laterales | Declarados pero **no operan**: 0 muestras cambian con el control al máximo | Revisor B |
| Espejo | Declarado pero **no opera**: 0 de 161 líneas encuentran reflector | Revisor B |
| Sombra por calcio | Declarada; invisible en la estenosis severa | PLAX de estenosis severa |
| Cola de cometa | No existe | — |

Los artefactos que existen surgen de la geometría y no son decorativos. Los inoperantes y los ausentes dejan el caso «desafío de artefactos» sin desafío en 2D: su PLAX canónico puntúa 91 y no muestra ningún artefacto evidente.

## 12. Sonda y plano de corte

La sonda desliza sobre la piel, rota, abanica (tilt), balancea (rock) y presiona de forma continua, y la ventana cambia al deslizar de paraesternal a apical y subcostal. No hay «snap»: unos grados no cambian de vista.

**Modelo procedimental, continuo**: 1° de rotación cambia la imagen 3,3 niveles de gris y 1 mm de deslizamiento 5,5–8 niveles, frente a 8,9 niveles entre dos fases consecutivas en reposo. Las cuencas de tolerancia son realistas: el PLAX mantiene score ≥ 70 hasta ±10° de rotación, ±8° de tilt, ±12° de rock y 1,5 cm de deslizamiento; el A4C pasa a A5C con 12° de tilt. Encontrar una vista al azar es difícil: 0 de 300 poses aleatorias alcanzan 70.

**Imagen por defecto, no continua (falla crítica)**: con la sonda quieta ~1 s el atlas construye un ancla y después devuelve esa misma imagen mientras la pose no se aleje más de 0,35 unidades de distancia (cm + 0,12·grados):

| Movimiento desde el ancla | Cambio real de la imagen | Cambio mostrado |
|---|---|---|
| Rotación +1° | 4,1 niveles | 0,6 niveles (ninguno) |
| Rotación +3° | 7,3 niveles | 0,6 niveles (ninguno) |
| Deslizamiento +3 mm | 13,2 niveles | 0,6 niveles (ninguno) |
| Tilt +3° | 11,5 niveles | 0,6 niveles (ninguno) |
| Rotación +6° | 10,3 niveles | mezcla 59 % ancla vieja + 41 % imagen nueva: dos imágenes superpuestas |
| Rotación +10° | 13,3 niveles | salto a la imagen nueva |

Los pasos de teclado por defecto (3° y 2 mm) caen dentro de esa zona muerta. La optimización fina del plano, que es lo que se entrena, es justo el rango que el backend por defecto no muestra. La prueba `atlas.test.ts` que afirma «no frame jumps» corre sin anclas y no ejercita este caso.

Otros matices medidos: la pose predeterminada del PLAX no es el óptimo del propio score (−6° de rotación puntúa más); en hipertensión pulmonar el A4C predeterminado queda acortado 15,8°, sin ápex, AI ni VD, con score 79.

## 13. Campo de visión

El vértice del sector coincide con la posición de la sonda en el torso 3D. El sector es un abanico polar de 40–90° y 8–24 cm, las líneas divergen con la profundidad, el tamaño aparente de las estructuras depende de la profundidad y no hay perspectiva de cámara: la imagen es un corte. La escala de profundidad, el marcador de orientación y la marca de foco en el borde derecho están presentes. Correcto.

## 14. Frecuencia

Tres frecuencias (1,7 / 2,5 / 3,5 MHz) con o sin armónicos. A 3,5 MHz la transmisión a 6–10 cm cae de 0,078 a 0,030 y el miocardio profundo pasa de gris 88 a 64; a 1,7 MHz sube a 115. La celda axial pasa de 1,87 mm a 2,5 MHz a 1,30 mm a 3,5 MHz. Los armónicos reducen el clutter de campo cercano (sangre a 2–6 cm de gris 30 a 19). La dirección y la magnitud son plausibles. Falta que la resolución lateral dependa de la frecuencia y que el ruido suba al perder penetración.

## 15. Ganancia

| Ganancia | Miocardio | Sangre | Contraste Michelson | Saturación |
|---|---|---|---|---|
| −12 dB | 47 | 1,5 | 0,94 | 0 % |
| 0 dB | 117 | 9,5 | 0,85 | 0 % |
| +12 dB | 191 | 47 | 0,61 | 0 % |

Con poca ganancia los ecos débiles desaparecen de forma progresiva, como en un equipo. Con mucha ganancia el contraste cae, pero la imagen nunca «se quema» ni las cavidades se llenan de clutter estructurado: sube un ruido fino uniforme. Correcto en dirección, incompleto en carácter.

## 16. TGC

Ocho bandas de −15 a +15 dB interpoladas por profundidad. Con +12 dB en la banda profunda el miocardio a 10–14 cm sube de gris 88 a 134 sin tocar el de 2–6 cm; con +12 dB en la superficial el de 2–6 cm sube de 118 a 155 y el de 6–10 cm queda en 82. Es compensación selectiva, no brillo global. Correcto.

## 17. Profundidad y zoom

La profundidad (8–24 cm) cambia el campo visible, la escala, el número de muestras y el frame rate (50 Hz a 8 cm, 19 Hz a 24 cm en tier alto) sin romper la geometría. El **zoom de lectura** existe (1–2,5×, magnifica el mapeo del sector). No hay zoom de escritura con recálculo de líneas en la región ni desplazamiento de la región ampliada.

## 18. Frame rate

El modelo es 1/(líneas·(2·profundidad/c + 20 µs)): 27,3 Hz a 16 cm y 80° en tier alto, 36,9 Hz en medio, 48,8 Hz en bajo; 65 Hz a 60°. Es coherente con profundidad, sector y número de líneas. Un equipo actual con adquisición multilínea da 50–70 Hz en esa geometría, así que el 2D se comporta como un equipo antiguo. El color queda en 5,8 Hz (alto) y 8,7 Hz (medio) con la caja por defecto, en el límite bajo de lo real para una caja grande. El número que muestra la barra es el simulado; el de dibujo depende del render y el worker lo acota a 12–50 ms por paso. La animación no es «cinematográficamente suave»: tiene el defecto contrario, tirones del atlas.

## 19. Realismo visual

- **Contraste**: excesivo, sangre negra absoluta y miocardio casi blanco.
- **Escala de grises**: sin curva clínica con pie elevado; el fondo es 0.
- **Textura**: estrías radiales y speckle fino e isótropo, sin el grano de 1–2 mm del miocardio real.
- **Bordes**: continuos, nítidos y con halo especular de anchura constante; el endocardio real es intermitente.
- **Ecogenicidad**: orden correcto; hígado convincente; grasa epicárdica indistinguible.
- **Suavizado**: el grosor de corte difumina papilares, bien, y alisa las paredes en bandas, mal.
- **Ruido**: fino y uniforme, sin clutter estructurado ni ruido electrónico profundo.
- **Miocardio**: banda brillante homogénea, sin capas.
- **Cavidades**: negras y limpias.
- **Válvulas**: finas y verosímiles, lo mejor de la imagen.
- **Pericardio**: trazo grueso continuo.
- **Tórax**: bordes rectos de pulmón y escaleras de reverberación en vistas de ventana excelente.

Apariencia: **render 3D iluminado**, excesivamente limpio y sintético. No es vectorial ni de videojuego salvo en las caras planas del pulmón y en las cápsulas venosas.

## 20. Fidelidad temporal

Entre cuadros separados 18 ms el miocardio conserva una correlación de 0,89–0,98 y el speckle se desplaza con el tejido unos 1 mm; la sangre se decorrelaciona (0,5–0,7), como debe. No hay parpadeo de textura. Sí hay «popping» y cambios artificiales:
- Fases cuantizadas, cuadros repetidos o saltados y mezcla de anclas (sección 6 y 12).
- El **ECG no acompaña a los strips**: el ECG es una ventana deslizante de 3 s y el strip espectral o de modo M es un barrido con barra de borrado de 4, 2 o 1 s según la velocidad. El QRS que aparece bajo una columna no es el de esa columna, así que ninguna medida temporal contra el ECG es posible.
- Sin GPU, a calidad alta, el tiempo simulado avanza más despacio que el reloj.

## 21. Fisiología y ECG

Correcto: sístole con mitral cerrada y aórtica abierta, diástole con E y A, reservorio auricular, contracción auricular tras la onda P, secuencia coherente en modo M, FA sin onda P y con RR irregular. Errores:
- La aórtica abre 60 ms después del QRS; el periodo preeyectivo real es de 80–110 ms.
- La mitral se cierra del todo en la diástasis durante 96 ms a 65 lpm.
- En FA las tablas del latido se construyen una vez y se estiran con el RR: el tiempo de eyección varía de 154 a 376 ms y el tiempo de desaceleración de 102 a 249 ms, con la misma onda E en todos los latidos.
- No hay variación respiratoria de tamaños ni de flujos, tampoco en el taponamiento, ni traslación del corazón con la respiración.
- Sin extrasístoles, bloqueos ni derivaciones.

## 22. Hemodinámica

**Doppler color**:
- Dirección correcta: rojo hacia la sonda, azul desde ella (en A4C, 15 749 píxeles rojos en diástole y 5 582 azules en sístole).
- Aliasing por plegado con Nyquist igual a la escala; varianza en verde; la sombra suprime el color.
- El chorro de insuficiencia mitral del prolapso muestra PISA y mosaico convincentes: lo mejor del color.
- **Sin campo de flujo de cavidad**: sólo cinco primitivas (entrada mitral, tricúspide, TSVI/aórtica, TSVD, IT). En PLAX y A3C el color aparece como polígonos planos de bordes rectos; en el A4C normal casi no aparece.
- **Nyquist desacoplada de la profundidad**: la escala llega a 1,2 m/s a 16 cm cuando el máximo físico a 2,5 MHz es 0,74 m/s; no hay PRF alta.
- La persistencia no opera (el buffer anterior es el mismo que el actual) y la sombra del color usa 2,5 MHz fijo.

**Doppler pulsado (PW)**:
- Volumen de muestra móvil y ajustable, espectro con E y A, aliasing, temporalidad retro-datada: correcto.
- **Sobreestima los picos**: en las puntas mitrales desde A4C mide E 0,95 m/s (verdad 0,80, +19 %) y A 0,62 (0,55, +13 %), con tolerancia de protocolo del 8 %. Una técnica perfecta se califica como error.
- El ensanchamiento crece con la escala de pantalla (0,32 m/s a ±1,2 y 0,43 a ±2,5 para un flujo laminar de 1 m/s) y las muestras sin flujo entran con peso: no hay ventana espectral.
- Hay un flujo sistólico de −0,32 m/s en las puntas mitrales porque el tubo del TSVI se extiende 3,5 cm.

**Doppler continuo (CW)**:
- Sin resolución de rango y recortando en vez de plegar: correcto.
- **La línea CW tiene anchura cero** y los chorros son tubos finos fuera de los planos canónicos. Desde la A5C canónica, la estenosis aórtica severa mide 1,27 m/s con Vmax verdadera de 4,69 m/s; la IT desde A4C mide 1,03 m/s con verdad de 2,35. La lección central del caso no se obtiene desde la vista de referencia.

**Doppler tisular (TDI)**:
- La velocidad del tejido es MAPSE·long′(φ)·(1 − z/L), sin acimut: septal, lateral y anillo del VD dan lo mismo.
- Velocidades anulares analíticas del caso normal: s′ 7,0, e′ 4,7 y a′ 4,1 cm/s, frente a e′ septal 11 y lateral 14 cm/s declarados. El S′ del VD sale de la MAPSE (8 frente a 13 cm/s).
- La cinta mide unos 10 cm/s de grosor a escala ±25 cm/s y el anillo fibroso no se muestrea. El resultado es E/e′ ≈ 20 en un corazón normal (verdad 6,4).

**Modo M color**: columnas rectangulares sin pendiente de propagación.

**Audio Doppler**: 48 osciladores con frecuencia portadora fija; funcional.

## 23. Interfaz del ecocardiógrafo

Controles presentes y causales: ganancia, profundidad, rango dinámico, frecuencia, armónicos, foco, sector, densidad de líneas, zoom, realce de bordes, persistencia, inversión izquierda/derecha y TGC de 8 bandas; en color, escala, línea de base, filtro de pared, ganancia, persistencia, mapa de varianza, inversión y caja editable; en espectral, escala, línea de base, filtro de pared, ganancia, barrido 25/50/100 mm/s, tamaño y profundidad del gate, ángulo del cursor, inversión y audio; freeze con cine de 96 cuadros; modo M, CMM, PW, CW y TDI; mediciones con protocolo calificado y exportación con marca de agua.

Faltan o fallan: PRF ligada a profundidad y frecuencia, PRF alta, dúplex honesto (el 2D sigue a frame rate completo durante PW, CW y modo M), selector de mapa de grises, compresión, foco múltiple, zoom de escritura, ECG sincronizado con el barrido. La disposición es un panel web de deslizadores, no una consola con perillas, y a 1440 px la barra de estado trunca sus etiquetas. Un fellow aprendería qué hace cada control, no dónde está ni cómo interactúa con la PRF.

## 24. Experiencia de manipulación

- **Orientación espacial**: el torso 3D con costillas y la sonda ayudan, pero el torso muestra siempre un **corazón translúcido con el eje del VI**, también en modo examen: la búsqueda se convierte en apuntar al dibujo.
- **Coordinación mano–imagen**: continua en el trazador procedimental; rota por la zona muerta del atlas en la configuración por defecto.
- **Reconocimiento de ventanas**: sí, la ventana se infiere de la posición.
- **Optimización del plano**: el score es geométricamente honesto, pero premia planos canónicos que no contienen lo que definen (sección 5) y castiga la atenuación como si fuera sombra.
- **Búsqueda de estructuras**: las indicaciones apuntan a la mejor vista actual, no a la vista objetivo, y sólo usan geometría. Siguiendo la primera indicación desde 20 poses aleatorias, 13 llegan a PLAX ≥ 70 en 10 movimientos de media y 7 quedan atrapadas sin indicación útil.

## 25. Dificultad de obtener una buena vista

Lo que está bien: la sonda arranca en una pose imperfecta, no hay snap y 0 de 300 poses aleatorias alcanzan score 70. Lo que no:
- Los presets llevan solos a la pose canónica y **completan tareas del currículo** (la prueba E2E de aprendizaje supera «PLAX ≥ 70» pulsando el botón PLAX); el modo examen los desactiva, pero no oculta el score ni el corazón translúcido.
- La **ventana difícil es irresoluble**: la mejor A4C en 400 poses aleatorias puntúa 24 (74 en la ventana excelente); la tarea «A4C ≥ 55 en ventana difícil» es imposible; la indicación culpa a «costilla o pulmón» cuando no hay ninguno en la línea.
- No hay respiración que aprovechar ni presión que optimizar con efecto visible más allá del acoplamiento.

## 26. Realismo global

**Estimación**: si se mostrara sólo el loop, el **100 % de los ecocardiografistas expertos** (intervalo razonable 98–100 %) identificarían la simulación en menos de 5 s. En el PLAX, la vista más lograda, la textura del septo y la sangre negra se reconocen en el primer cuadro. En A4C, PSAX-PM y subcostal el reconocimiento es inmediato por las aurículas globo, los papilares desprendidos y la ausencia de cámaras reconocibles. Ningún experto necesitaría ver el movimiento.

**Delator principal**: el trazado de miocardio e interfaces, con bandas uniformemente brillantes estriadas a lo largo de las líneas de barrido, bordes continuos con halo especular de anchura constante y cavidades sin ruido. Siguen, por orden: las aurículas elípticas de pared brillante y los papilares separados de la pared; los bordes rectos del pulmón; y, en cuanto se manipula, la imagen que no responde a los ajustes finos y se duplica al moverse.

## 27. Puntuación por dominio (1–7)

| # | Dominio | Nota | Justificación |
|---|---|---|---|
| 1 | Anatomía | 3 | VI y VD sin primitivas; aurículas, venas, TSVD y tronco con primitivas visibles; papilares desprendidos en eje corto |
| 2 | Proporciones | 5 | 44 medidas en rango y coherentes entre planos; AI perceptualmente grande; espesor aparente inflado por el trazado |
| 3 | Geometría 3D | 5 | Un solo volumen, sin geometría por vista ni contradicciones |
| 4 | Vistas ecocardiográficas | 3 | PLAX, A3C y A4C reconocibles; planos canónicos que dejan fuera lo que definen; PSAX-MV/PM deficientes; subcostal 4C fallida; sin supraesternal |
| 5 | Movimiento cardíaco | 4 | Volumétrico con MAPSE, engrosamiento por masa, TAPSE y aurículas; sin torsión ni traslación; cuantizado a 32 fases |
| 6 | Válvulas | 3 | Mitral y aórtica con zonas y coaptación; segmentos rígidos; cierre mitral completo en diástasis; tricúspide y pulmonar de animación |
| 7 | Física acústica | 3 | Transmisión, reflectividad y ángulo causales; sin PSF; resolución impuesta por filtros; lóbulos y espejo inoperantes |
| 8 | Speckle | 2 | SNR 3,6 frente a 1,9, celda lateral 5 veces menor, estrías, contraste 0,22 |
| 9 | Atenuación | 3 | Tendencia correcta y TGC selectivo; sin ruido profundo ni saturación; ventana difícil descalibrada hasta el negro |
| 10 | Artefactos | 3 | Reverberación causal; lóbulos, espejo y sombra de calcio inoperantes; sombra costal no observada; sin refuerzo ni cola de cometa |
| 11 | Interacción sonda–imagen | 3 | Seis grados de libertad continuos y cuencas realistas en el modelo; la imagen por defecto no muestra ±3° ni ±3 mm y duplica la imagen entre 4° y 8° |
| 12 | Continuidad entre planos | 4 | Continuidad real del modelo; en pantalla, anclas mezcladas y saltos |
| 13 | Realismo visual | 2 | Render iluminado: bandas, contornos, cavidades negras, caras planas del pulmón, cápsulas venosas |
| 14 | Realismo temporal | 3 | Speckle coherente con el tejido; tirones del atlas; ECG que no acompaña a los strips |
| 15 | Fisiología | 3 | Fases y ECG ordenados; periodo preeyectivo corto; cierre mitral en diástasis; FA estirada; sin respiración |
| 16 | Doppler | 2 | Signos, aliasing y PISA correctos; color sin campo de cavidad; TDI al 40 % de la verdad; CW que no ve la estenosis desde la vista de referencia; PW +19 %; Nyquist sin límite físico |
| 17 | Controles del ecógrafo | 4 | Completos y causales, con zoom y TGC; PRF desacoplada, sin PRF alta ni dúplex; disposición web |
| 18 | Valor educativo | 4 | Casos con verdad de terreno, currículo, protocolo calificado e informe; examen con score y corazón visibles; tareas imposibles o resueltas por presets; tolerancias que castigan la técnica correcta |
| 19 | Transferencia al examen real | 2 | Transfiere la lógica de planos y controles; no transfiere reconocimiento de imagen, ajuste fino ni valores Doppler |
| 20 | Realismo global | 2 | Corazón coherente que ningún experto confundiría con una ecografía |

**Promedio: 63 / 20 = 3,15 ≈ 3,2 / 7.**

El promedio no debe ocultar las seis fallas críticas del resumen ejecutivo. Tres dominios están por encima del promedio porque describen la estructura del sistema (proporciones, geometría 3D, controles) y no lo que el usuario ve y mide.

## 28. Clasificación final

**Nivel B — Simulador educativo básico.**

Es adecuado para estudiantes iniciales que aprenden qué es cada ventana, cómo se relacionan los planos con la sonda, qué hace cada control y qué significan el color, el aliasing y los espectros. No es adecuado todavía para enseñar valores Doppler (TDI, picos PW, gradientes CW) ni para evaluar en modo examen, porque el examen deja ver el score y el corazón.

Los dominios estructurales ya cumplen lo que exige el Nivel C y parte del D. Para llegar al C con margen hacen falta las mejoras 1–6 de la sección 30. El Nivel D exige además física de haz, artefactos completos, Doppler de cavidad calibrado y validación con expertos. El Nivel E exige validación cuantitativa contra imágenes reales.

## 29. Identificación de errores

| # | Problema | Dominio | Gravedad | Evidencia visual/técnica | Impacto en realismo | Solución recomendada |
|---|---|---|---|---|---|---|
| 1 | El speckle es ruido de valor filtrado: SNR de amplitud 3,6 (Rayleigh 1,9), asimetría 0,95, celda lateral 0,31 mm y axial 0,42 mm a 4–6 cm, casi isótropa | Speckle | Crítica | Estadística y autocorrelación del revisor B; estrías del septo en `plax-2d.png` | Primer delator; ninguna mejora anatómica se percibe a través de esta textura | PSF separable (axial ∝ 1/f, lateral ∝ λ·r/apertura, elevación) sobre dispersores fijos en coordenadas materiales con fase aleatoria; envolvente y compresión después |
| 2 | Miocardio saturado y homogéneo con banda especular de ~7,8 mm en pantalla en todas las interfaces, y sangre a negro absoluto con suelo de ruido 0 hasta 12 cm | Realismo visual | Crítica | Niveles de gris del revisor B; `a4c-2d.png` | Aspecto de dibujo iluminado, contornos continuos, cavidades vacías | Reflectividad heterogénea y anisótropa, especular de ±0,5 mm sólo a incidencia casi normal, ruido electrónico y clutter de sangre, mapa de grises clínico con saturación |
| 3 | El atlas por defecto devuelve la misma imagen hasta ±3° o ±3 mm, mezcla dos anclas entre 4° y 8° y salta a los 10° | Interacción | Crítica | Distancias atlas/ancla/verdad del revisor C (sección 12); `atlas.test.ts` corre sin anclas | La optimización fina del plano no se ve; se aprende contra histéresis; imagen doble | Reutilizar un ancla sólo si la distancia de pose es < 0,05 y renderizar directo con GPU en otro caso; prueba de continuidad con anclas construidas |
| 4 | La ventana difícil trata la atenuación absoluta como sombra: transmisión 0,0024 a 5,3 cm frente a 0,16 esperados sin costilla ni pulmón; mejor A4C 24 en 400 poses; tarea «A4C ≥ 55» imposible; la indicación culpa a costilla o pulmón | Atenuación / educación | Crítica | Registro de transmisión por línea del revisor C; `difficult-a4c-2d.png` | Un caso y un módulo del currículo no se pueden completar; diagnóstico de causa falso | Sombra como caída relativa de transmisión respecto a líneas vecinas; atenuación de pared recalibrada con imagen pobre pero presente; indicaciones separadas para atenuación y sombra |
| 5 | Sin campo de flujo de cavidad: el color se dibuja en polígonos de bordes rectos (PLAX, A3C) o casi no aparece (A4C normal) | Doppler | Crítica | `plax-color.png`, `a4c-color.png`; tabla de primitivas de `DOPPLER_ENGINE.md` | El color pintado rompe la ilusión en cuanto se enciende | Campo de cavidad con vórtice diastólico, eyección y flujo auricular interpolado entre primitivas; ruido de color y borde de filtro de pared irregular |
| 6 | Subcostal 4C irreconocible aunque el plano contiene las cuatro cámaras: el hígado no cubre el haz central, pared abdominal y grasa en el campo cercano, corazón oscuro a 6–13 cm; componente «geometría» del score siempre 0 | Vistas | Crítica | `subcostal-4c-2d.png` y su mapa; score canónico 65 | Una vista básica y el caso de taponamiento pierden su ventana | Hígado interpuesto bajo el xifoides en la pose canónica, atenuación hepática realista, rama de score propia para subcostales |
| 7 | TDI sin acimut: s′ 7,0, e′ 4,7 y a′ 4,1 cm/s frente a e′ 11/14 cm/s declarados; S′ del VD derivado de la MAPSE; cinta de 10 cm/s; E/e′ ≈ 20 en un normal | Doppler | Alta | `flowField.ts` (velocidad tisular); medidas del revisor C | Un alumno aprendería valores de disfunción diastólica como normales | Tabla longitudinal por pared construida desde e′, S′ y TAPSE; ensanchamiento fijo en cm/s; picos isovolumétricos |
| 8 | CW de anchura cero y chorros fuera de los planos canónicos: estenosis aórtica 1,27 frente a 4,69 m/s desde A5C; IT 1,03 frente a 2,35 m/s desde A4C | Doppler | Alta | Medidas del revisor C; válvula aórtica a 0,87 cm del plano A5C | La lección central del caso de estenosis no se obtiene desde la vista de referencia | Haz CW con anchura (±2 mm) y elevación; vistas canónicas que contengan los chorros; indicación «chorro fuera de plano» |
| 9 | Picos PW sobreestimados: E 0,95 frente a 0,80 m/s (+19 %) y A 0,62 frente a 0,55 (+13 %), con tolerancia de protocolo del 8 % | Doppler / educación | Alta | Medidas del revisor C; tolerancia de `mitral-e` en el protocolo | Una técnica perfecta se califica como error | Calibrar el ensanchamiento intrínseco (~5 % de la velocidad) o definir la verdad como borde modal |
| 10 | Nyquist y PRF desacopladas de profundidad y frecuencia, sin PRF alta: color hasta 1,2 m/s y PW hasta 2,5 m/s a cualquier profundidad (máximo físico 0,74 m/s a 16 cm) | Doppler / controles | Alta | Límites de los deslizadores; funciones de PRF máxima sin uso | El aliasing se «arregla» con un deslizador | Escala limitada por c²/(8·f·d), PRF alta con ambigüedad de rango, frame rate de color derivado de la PRF |
| 11 | ECG como ventana deslizante de 3 s y strips con barrido y barra de borrado de 4, 2 o 1 s | Doppler / temporal | Alta | Dibujo del ECG y del strip en el código | Ninguna medida temporal contra el ECG es posible | ECG dibujado con el mismo barrido y la misma barra de borrado |
| 12 | El modo examen deja visible el score de la mejor vista en la barra superior y el corazón translúcido con el eje del VI en el torso | Educación | Alta | `TopBar.tsx` sin condición de modo; `TorsoView.tsx` añade siempre el corazón | El examen no mide reconocimiento ni orientación | Ocultar score y corazón en examen; opción de torso opaco en los demás modos |
| 13 | Planos canónicos que dejan fuera lo que definen: PLAX con eje inclinado 31° en la imagen; PSAX-MV sin septo inferior (1,79 cm) ni pared inferolateral (3,44 cm); A5C con la válvula aórtica a 0,87 cm; A4C con la tricúspide a 0,62 cm. `VALIDATION.md` afirma error ≤ 7° | Vistas | Alta | `audit-views.ts`; scores canónicos del revisor C | Scores de 90+ para planos que un experto rechazaría; el Doppler canónico falla | Redefinir los objetivos de A5C, A4C y PSAX-MV; PLAX con eje horizontal eligiendo espacio intercostal; corregir `VALIDATION.md` |
| 14 | Aurículas como globos elípticos de pared uniformemente brillante que dominan la mitad inferior de A4C, A2C y A3C | Anatomía | Alta | `a4c-2d.png`, `a2c-2d.png` | Delator anatómico inmediato en apicales | Superelipsoides con pared de 0,15–0,25 cm menos reflectiva, techo aplanado, venas pulmonares visibles, orejuela |
| 15 | Papilares como discos separados de la pared en PSAX-PM, y VD en el plano pero irreconocible en la imagen | Anatomía | Alta | `psax-pm-2d.png` y su mapa | Vista de eje corto «de libro» | Base papilar ancha unida al endocardio con separación sólo distal; pared libre del VD visible en campo cercano |
| 16 | Pulmón y mediastino limitados por caras planas: cuña negra de borde recto en PLAX y subcostal, bloque rectangular en PSAX-MV y PSAX apical | Tórax | Alta | Mapas de PLAX, PSAX-MV, PSAX-PM y subcostal 4C | Primitiva visible, aspecto de videojuego | Superficies pulmonares curvas y móviles con la respiración; escotadura cardíaca con forma real |
| 17 | Reverberación pulmonar en escaleras de trazos nítidos dentro de vistas de ventana excelente: mitad derecha del A2C, borde de PSAX-AV y PSAX-PM | Tórax / artefactos | Alta | `a2c-2d.png` y su mapa | Estructuras imposibles en un buen paciente | Poses canónicas que eviten el pulmón en ventana excelente; reverberación con decaimiento y textura de líneas A difusas |
| 18 | VCI como cápsula recta de extremos redondeados con pared brillante y vena hepática en ángulo recto | Anatomía | Alta | `subcostal-ivc-2d.png` | Se lee como tubería | VCI curva que se ensancha hacia la AD, pared fina, colapso continuo, venas hepáticas oblicuas |
| 19 | FA con tablas fijas estiradas por el RR: tiempo de eyección 154–376 ms, desaceleración 102–249 ms, misma onda E en todos los latidos | Fisiología | Alta | Medidas del revisor C | Los objetivos del caso de FA no se pueden practicar | Tablas por latido dependientes del RR previo con eyección casi fija y diástasis variable |
| 20 | Movimiento cuantizado a 32 fases: 54 de 200 cuadros saltan fases en tier alto y 58 de 200 se repiten en tier bajo | Temporal | Alta | Secuencias de índices del revisor B | Tirones perceptibles | 64–96 fases con interpolación temporal o render directo con GPU |
| 21 | Pared lateral del VI en A4C tan brillante como el septo: la dispersión difusa no depende del ángulo | Física | Alta | `a4c-2d.png` | La imagen ve paredes que un equipo no ve | Término difuso dependiente de \|n·d\| y de la orientación de fibras |
| 22 | 2D a 27 Hz a 16 cm y 80°; color a 5,8–8,7 Hz con la caja por defecto | Rendimiento | Moderada | Tabla de frame rate del revisor B | 2D de equipo antiguo; color en el límite bajo | Modelo de frame rate con multilínea y paquete de color adaptativo |
| 23 | Lóbulos laterales y espejo declarados pero inoperantes: 0 muestras cambian | Artefactos | Moderada | Pruebas del revisor B | El caso de artefactos no enseña ninguno de los dos | Umbral relativo al máximo del cuadro; detección del reflector antes de la consola; prueba que exija efecto |
| 24 | Sombra de calcio invisible en la estenosis severa; sin refuerzo posterior ni cola de cometa; sombra costal no observada con la sonda sobre la costilla | Artefactos | Moderada | PLAX de estenosis severa; prueba de costilla del revisor B | Patologías que brillan sin sus artefactos | Atenuación de calcio de 40–60 dB/cm; refuerzo tras líquido; verificar la sombra costal con una prueba de pipeline |
| 25 | Pose canónica no adaptada al paciente: A4C acortado 15,8° en hipertensión pulmonar; −6° puntúa más que la pose PLAX predeterminada | Vistas | Moderada | Registros de score | El preset enseña una pose subóptima | Optimizar la pose por caso sobre el score |
| 26 | El score se calcula sobre el cuadro renderizado: la misma pose puntúa distinto en CPU y en GPU mientras el atlas se construye | Arquitectura | Moderada | Capturas CPU frente a servidor con GPU | Retroalimentación inconsistente entre máquinas | Visibilidad de referencias calculada con el modelo |
| 27 | Espectros rellenos: ensanchamiento proporcional a la escala de pantalla, muestras sin flujo con peso, sin ventana espectral ni clics valvulares | Doppler | Moderada | `a4c-pw.png`, `a5c-cw.png`; medidas del revisor C | Trazo reconocible como sintético | Espectro por suma de dispersores con ventana laminar; clics de apertura y cierre |
| 28 | Flujo sistólico de −0,32 m/s en las puntas mitrales por un tubo de TSVI que se extiende 3,5 cm | Doppler | Moderada | Medidas del revisor C | Contaminación permanente del PW mitral | Acotar el tubo del TSVI a −1,5 cm |
| 29 | Modo M color en columnas rectangulares sin velocidad de propagación | Doppler | Moderada | `plax-cmm.png` | El CMM no enseña lo que enseña el CMM | Onda de llenado propagante de 40–60 cm/s |
| 30 | Cierre mitral completo en diástasis (96 ms a 65 lpm) y fusión E–A en MCH, estenosis aórtica y prolapso | Fisiología / válvulas | Moderada | Modo M mitral del revisor C | Modo M mitral irreal | Apertura mínima en diástasis; tiempos acoplados a la frecuencia |
| 31 | Valvas y cúspides de segmentos rígidos, inserción aórtica plana, sin nódulos | Válvulas | Moderada | Decisión 46; secuencias de fase | Válvulas «de bisagra» | Superficies con curvatura por presión; corona de inserción |
| 32 | Sin arco aórtico ni vista supraesternal | Anatomía | Moderada | La aorta termina a 6,5 cm | Falta una ventana estándar | Arco con troncos supraaórticos y ventana supraesternal |
| 33 | TSVD y tronco pulmonar como conos y tubo recto | Anatomía | Moderada | Render de PSAX-AV | Cilindros visibles | Tubo curvo con radio variable |
| 34 | Pericardio como trazo uniforme; derrame de contorno perfecto | Realismo visual | Moderada | `plax-2d.png`, taponamiento | Contorno dibujado | Especular fino dependiente del ángulo; grasa epicárdica con textura; fibrina |
| 35 | Sin variación respiratoria de tamaños y flujos, tampoco en el taponamiento | Fisiología | Moderada | `LIMITATIONS.md` | El taponamiento pierde su signo cardinal | Modular tablas y posición cardíaca con la respiración |
| 36 | Ruido que no crece con la profundidad ni con la ganancia; +12 dB sin saturación | Atenuación | Moderada | Suelo de ruido del revisor B | Campo lejano limpio; ganancia que no quema | Ruido electrónico proporcional a la compensación; recorte a 255 |
| 37 | Presets e indicaciones numéricas completan tareas del currículo; las indicaciones apuntan a la mejor vista actual y sólo usan geometría | Educación | Moderada | Prueba E2E de aprendizaje; 13 de 20 búsquedas guiadas llegan, 7 se atascan | Aprendizaje del resultado sin el proceso | Tareas que exijan adquisición manual; indicaciones hacia la vista objetivo que consideren sombra y pulmón |
| 38 | Documentación desfasada: `CLINICAL_SCOPE.md` habla de tres casos, sin regurgitaciones ni subcostal; `VALIDATION.md` afirma error de plano ≤ 7° | Educación / documentación | Moderada | Comparación del revisor C con el código | Erosiona la confianza que exige la validación externa | Regenerar la documentación desde el código; prueba que compare la auditoría con `VALIDATION.md` |
| 39 | Sin comportamiento dúplex: el 2D sigue a frame rate completo durante PW, CW y modo M | Controles | Moderada | Bucle del núcleo del simulador | Verosimilitud de máquina | 2D lento o congelado en dúplex |
| 40 | Sin torsión ni gradiente base–ápex; contracción simétrica | Movimiento | Baja | `computeHeartPose` | Sólo lo notaría un experto en strain | Rotación apical y basal opuestas con retraso regional |
| 41 | Clutter de campo cercano evaluado en coordenadas del tórax | Artefactos | Baja | Correlación 0,83 al mover la sonda | El clutter se pega a la anatomía | Evaluarlo en coordenadas de la sonda |
| 42 | Persistencia de color inoperante; sombra de color a 2,5 MHz fijo; periodo preeyectivo de 60 ms; flujos derechos copiados de los izquierdos | Doppler / fisiología | Baja | Código de color, tiempos y campo de flujo | Detalles de máquina y fisiología | Buffer previo separado; frecuencia actual; 90 ms; tablas derechas propias |
| 43 | Etiquetas de estado truncadas a 1440 px; disposición web | Interfaz | Baja | `ui-1440x900.png` | Rompe la ilusión de consola | Anchos fijos; panel tipo consola opcional |
| 44 | Sin GPU el tiempo simulado avanza más despacio que el reloj a calidad alta | Rendimiento | Baja | Strips cortos en las capturas CPU | Aulas sin GPU ven un simulador lento | Bajar el tier automáticamente cuando el render supera el intervalo |
| 45 | Ventana decidida por un rectángulo de piel; sin paraesternal derecha | Interacción | Baja | `windowFromSkin` | Límite de ventanas | Ventanas por geometría acústica |

## 30. Top 10 mejoras

Ordenadas por impacto sobre varias vistas a la vez y por dependencia entre ellas.

| Prioridad | Problema | Solución | Dificultad | Impacto esperado |
|---|---|---|---|---|
| 1 | Imagen que no responde a los ajustes finos (#3, #20, #26) | Render directo con GPU y ancla sólo en pose idéntica; más fases con interpolación; visibilidad por modelo | Baja–media | Muy alto en manipulación: todas las vistas pasan a responder de forma continua |
| 2 | Speckle sin estadística ni escala (#1) | PSF separable sobre dispersores materiales con fase aleatoria y celda creciente con la profundidad | Alta: nuevo núcleo CPU y GLSL, coste 3–5 veces mayor | Muy alto: cambia el juicio de «dibujo» a «ecografía» en todas las vistas |
| 3 | Ecogenicidad de dibujo (#2, #21, #34, #36) | Reflectividad heterogénea y anisótropa, especular fino, suelo de ruido, clutter de sangre, mapa de grises clínico y saturación | Media | Muy alto; por sí sola reduce a la mitad los delatores |
| 4 | Doppler cuantitativo que enseña valores falsos (#7–#11, #27–#28) | TDI por pared desde e′/S′/TAPSE; ensanchamiento calibrado; haz CW con anchura; PRF ligada a profundidad; ECG con el barrido | Media | Alto: todas las lecciones Doppler se vuelven fiables |
| 5 | Color sin campo de cavidad (#5, #29) | Campo de flujo de cavidad y onda de propagación en CMM | Alta | Alto en A4C, A5C, A3C, PLAX y VD |
| 6 | Planos canónicos y subcostal (#6, #13, #25) | Objetivos de vista que contengan sus referencias y chorros; subcostal con hígado interpuesto y score propio; pose optimizada por caso | Media | Alto en todas las vistas predeterminadas y en el Doppler canónico |
| 7 | Tórax con caras planas y reverberación en ventana excelente (#16, #17) | Pulmón curvo y móvil, escotadura real, poses que eviten el pulmón | Media | Alto en PLAX, ejes cortos, A2C y subcostal |
| 8 | Aurículas, venas, TSVD y tronco con primitivas (#14, #18, #33) | Superelipsoides de pared fina, venas pulmonares visibles, VCI y tronco curvos | Media | Alto en apicales, subcostal y PSAX-AV |
| 9 | Ventana difícil irresoluble e integridad del examen (#4, #12, #37) | Sombra relativa y atenuación recalibrada; ocultar score y corazón en examen; tareas con adquisición manual | Baja | Alto en valor educativo y validez de la evaluación |
| 10 | Papilares desprendidos y VD invisible en eje corto (#15) | Base papilar ancha y pared libre del VD visible | Media | Medio–alto en PSAX-PM, PSAX apical y A5C |

Después de estas diez: artefactos inoperantes (#23, #24), FA por latido y diástasis (#19, #30), válvulas con curvatura (#31), arco aórtico (#32), respiración (#35), dúplex (#39) y torsión (#40).

## 31. Limitaciones de motor frente a modelo

Capas: modelo anatómico, motor gráfico, algoritmo de ultrasonido, animación, interfaz, arquitectura, rendimiento, limitación de datos.

| Problema (#) | Capa principal | Capa secundaria |
|---|---|---|
| Speckle (1) | Algoritmo de ultrasonido | Rendimiento (coste de la PSF), arquitectura (espejo CPU/GLSL) |
| Ecogenicidad, especular, sangre negra (2, 21, 34, 36) | Algoritmo de ultrasonido | Interfaz (mapa de grises) |
| Zona muerta y mezcla del atlas (3) | Arquitectura | Rendimiento |
| Ventana difícil (4) | Algoritmo (sombra por transmisión absoluta) | Limitación de datos (un solo perfil de pared) |
| Color sin cavidad (5), CMM (29) | Modelo de flujo | Algoritmo de color |
| Subcostal 4C (6) | Modelo (pose de vista y tórax) | Interfaz (rama de score) |
| TDI (7), picos PW (9), espectros (27) | Algoritmo espectral | Modelo de flujo tisular |
| CW (8) | Algoritmo (haz de anchura cero) | Modelo de poses (planos canónicos) |
| PRF (10), dúplex (39) | Interfaz | Algoritmo de ultrasonido |
| ECG y strips (11) | Interfaz | Arquitectura del dibujo |
| Examen (12), presets e indicaciones (37) | Interfaz | Arquitectura del currículo |
| Planos canónicos (13), pose por paciente (25) | Modelo de poses | — |
| Aurículas, VCI, TSVD (14, 18, 33), papilares (15), arco (32) | Modelo anatómico | Algoritmo (pared brillante) |
| Pulmón plano y reverberación (16, 17) | Modelo torácico | Algoritmo de artefactos |
| FA (19), diástasis (30), respiración (35), preeyección (42) | Modelo fisiológico | Animación |
| Cuantización temporal (20), dilatación sin GPU (44) | Arquitectura | Rendimiento |
| Frame rate (22) | Rendimiento (modelo de frame rate) | — |
| Lóbulos, espejo, calcio, costilla (23, 24), clutter (41) | Algoritmo de artefactos | Limitación de pruebas |
| Score por cuadro (26) | Arquitectura | — |
| Válvulas rígidas (31), torsión (40) | Animación | Modelo anatómico |
| Documentación (38), etiquetas (43) | Interfaz y documentación | — |
| Ventana por rectángulo (45) | Modelo de ventanas | — |

**Corolario**: de las seis fallas críticas, sólo una (#6) pertenece principalmente al modelo anatómico o de poses. Las otras cinco están en el algoritmo de ultrasonido, la arquitectura del atlas y el modelo de flujo. Seguir mejorando la anatomía sin tocar trazado, atlas y Doppler no cambiaría el veredicto.

## 32. Trucos visuales

| Técnica buscada | ¿Existe? | Juicio |
|---|---|---|
| Geometría deformada para una vista | No | Un solo SDF; la auditoría usa el mismo modelo en todas las vistas |
| Anatomía incoherente en A4C | No | Misma anatomía; se ve de animación, pero no se contradice |
| Válvulas pintadas sobre la imagen | No | Son superficies con espesor cortadas por el plano |
| Texturas independientes de la anatomía | No | El ruido está en coordenadas materiales y sigue al tejido |
| Ruido aleatorio para imitar ultrasonido | Sí, parcialmente | El speckle es ruido de valor filtrado, no interferencia. No rompe la coherencia 3D, pero no es física |
| Cortes prerrenderizados | Sí, parcialmente | El atlas prerrenderiza fases por pose desde el modelo y **reutiliza la imagen de una pose para poses vecinas**, con mezcla de anclas: produce zona muerta e imagen doble. Penalizado en interacción y temporalidad |

Atajos que hacen que la imagen parezca ecografía sin serlo:
1. Término especular en una banda de ±1,6 mm de todas las interfaces, que dibuja contornos continuos.
2. Sangre con reflectividad casi nula y suelo de ruido cero, que regala contraste.
3. Desenfoque lateral gaussiano de consola en lugar de resolución lateral, que produce las estrías.
4. Grosor de corte por promedio de tres planos con anchura fija.
5. Armónicos como multiplicadores fijos.
6. «Blooming» de color como dilatación según la ganancia.
7. Atenuación en escala relativa, que en la ventana difícil lleva al negro.

Ninguno rompe la consistencia tridimensional; todos impiden que la imagen se sienta física. El corazón translúcido del torso no es un truco de la imagen, pero es una ayuda que invalida la evaluación de orientación cuando no se puede quitar.

## 33. Auditoría de coherencia

**Ventrículo izquierdo**: PLAX (DTDVI 4,72 cm, plano a 2,7°, eje inclinado 31° en la imagen) → PSAX-MV (24° oblicuo, VI ovalado) → PSAX-PM (0,5°, anillo circular) → PSAX apical → A4C (7°, longitud 8,6 cm) → A2C (2°) → A3C (6°, TSVI). El radio es el mismo en cada nivel según los mapas. No hay contradicción geométrica. La única inconsistencia es perceptual: el espesor aparente de la pared va de 1,0–1,2 cm en PLAX y A4C a unos 2 cm en PSAX-MV frente a 0,88 cm modelados.

**Aorta**: PLAX (anillo 2,48, senos 3,18, UST 2,80, ascendente 2,98 cm) → PSAX-VAo (raíz con signo de Y y trébol suave) → A5C (TSVI 2,24 cm y raíz en el centro, con la válvula a 0,87 cm del plano) → A3C (TSVI y raíz continuos con la valva anterior). Coherente. La falta de arco es una omisión, no una contradicción.

**Ventrículo derecho**: PLAX (AP 2,62 cm) → PSAX-VAo (TSVD 2,60 cm cruzando sobre la raíz) → PSAX-MV (presente en el mapa, ausente según el score) → PSAX-PM (presente en el mapa como semiluna anterior, irreconocible en la imagen) → A4C (basal 3,10, longitud 6,70 cm) → subcostal (semiluna fina contra la pared, irreconocible en la imagen). Sin contradicción geométrica; incoherencia perceptual grave entre A4C, donde el VD se ve, y los ejes cortos, donde no.

**Aurícula izquierda**: PLAX (AP 3,58 cm tras la raíz) → PSAX-VAo (posterior a la raíz) → A4C, A2C y A3C (el mismo globo) → subcostal (en el mapa, pequeña y profunda). Coherente.

**Mitral**: PLAX (valvas y coaptación) → PSAX-MV (boca de pez) → A4C (anillo de 3,00 cm por encima de la tricúspide) → modo M (patrón M/W con cierre completo en diástasis). Coherente.

**Afirmación documental contradicha**: `VALIDATION.md` dice que las vistas canónicas tienen error de plano y de rotación ≤ 7°. La auditoría mide 17° y 24° de plano en PSAX-VAo y PSAX-MV y 31° y 19,5° de rotación en PLAX y PSAX apical.

Conclusión: la coherencia tridimensional es real y es el activo principal del simulador. Lo que falla es cómo esa coherencia llega a la imagen.

## 34. Benchmark de realismo por dominio

Escala: A dibujo anatómico · B animación médica · C simulador educativo · D ecocardiografía clínica · E ecocardiografía real de alta calidad.

| Dominio | Nivel | Comentario |
|---|---|---|
| Anatomía | C, aurículas y venas en B | VI y VD de simulador; aurículas de animación |
| Proporciones | D | Medidas de guía |
| Geometría 3D | D | Un volumen único cortado en continuo |
| Vistas | C, subcostal 4C en A, PSAX-PM en B | PLAX, A3C y A5C de simulador |
| Movimiento | C | Volumétrico; cuantizado |
| Válvulas | C, tricúspide y pulmonar en B | — |
| Física acústica | C | Esqueleto causal sin PSF |
| Speckle | B | Ruido filtrado |
| Atenuación | C | Tendencia correcta; ventana difícil en A |
| Artefactos | C, los inoperantes en A | Reverberación causal |
| Interacción sonda–imagen | C | D en el modelo, B en la imagen por defecto |
| Continuidad entre planos | C | D en el modelo, atlas con mezcla en pantalla |
| Realismo visual | B | Render iluminado |
| Realismo temporal | C | Speckle coherente, tirones |
| Fisiología | C | Fases y ECG ordenados; FA y respiración de B |
| Doppler | B, PISA de IM en C | Signos correctos, valores y color de animación |
| Controles | C | Completos; PRF sin física |
| Valor educativo | C | Currículo y calificación; examen con fugas |
| Transferencia | B | Planos sí; imagen, ajuste fino y valores no |
| Realismo global | B | Simulador educativo coherente, no una ecografía |

Ningún dominio alcanza E. Dos alcanzan D (proporciones y geometría 3D), y son precisamente los que no se ven en una captura.

---

## Anexo A. Revisores adversariales

| Revisor | Alcance | Estado | Integración |
|---|---|---|---|
| A | Anatomía y vistas | Generó mapas de estructuras de 12 vistas × 3 fases, renders de revisión de 12 vistas y de tres casos patológicos, medidor y auditoría de planos; se detuvo por límite de uso antes de redactar su informe | Mapas y renders usados en las secciones 2, 5, 11 y 33; los mapas corrigieron la atribución inicial de los bordes negros y las escaleras (pulmón, no costillas) |
| B | Física y trazado | Midió consola, profundidad, speckle, correlación temporal, artefactos, banda especular y frame rate; se detuvo por límite de uso antes de redactar su informe | Medidas usadas en las secciones 8–11, 14–18, 20 y 29 |
| C | Doppler, interacción, fisiología y educación | Informe completo con 57 pruebas unitarias relevantes en verde y guiones sobre el pipeline real | Hallazgos verificados contra sus registros y el código e integrados en las secciones 5, 7, 12 y 20–29; su medida del atlas cambió el juicio de interacción de 5 a 3 y la del TDI y el CW el de Doppler de 3 a 2 |

Correcciones hechas durante la evaluación al contrastar con los revisores: el zoom sí existe (1–2,5×); la marca de foco sí se dibuja; los bordes negros rectos y las escaleras de las vistas canónicas son pulmón y reverberación pulmonar, no sombras costales; el VD de PSAX-PM está en el plano aunque no se reconozca.

## Anexo B. Reproducción

```bash
npm run measure -- normal-excellent-window
npx tsx tools/offline/render/audit-views.ts
PHASES=0,0.35,0.55 npx tsx tools/offline/render/slice-map.ts <salida> plax,psax-av,psax-mv,psax-pm,psax-apex,a4c,a5c,a2c,a3c,rv-focused,subcostal-4c,subcostal-ivc
PHASES=0,0.08,0.16,0.24,0.32,0.4,0.5,0.6,0.72,0.85 npx tsx tools/offline/render/render-views.ts <salida> plax,a4c,psax-pm
```

Las capturas en vivo se tomaron con un guion de Playwright contra `npm run preview` que recorre los presets, cambia de modalidad desde el store expuesto en `window.__echotwin` y fotografía el contenedor de la imagen.
