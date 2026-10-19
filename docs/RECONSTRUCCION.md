# Plan de reconstrucción (acordado el 2026-10-18)

Tras la crítica de experto del 18 de octubre, Daniel aprobó cambiar de método: dejar de parchar el modelo analítico
pieza a pieza y reconstruir la anatomía, la imagen y el Doppler sobre bases verificables, con un banco de realismo que
juzgue cada paso. Este documento recoge el plan, lo medido antes de empezar y las fuentes elegidas.

## Por qué

- 342 decisiones en 39 días; 35 listas `KNOWN_*`; el clasificador de la aurícula izquierda tiene 1.126 líneas de
  recortes locales, y las decisiones 318–341 casi todas parchean la misma esquina (aurícula, raíz, septo).
- La imagen se calibra contra la estadística de grises de CAMUS en dos vistas apicales; no hay fantomas de referencia,
  ni comparación del movimiento con datos reales, ni lectura ciega de expertos.
- CPU y GPU son dos implementaciones escritas a mano, guardadas por un contador de literales.

## Fases

0. **Banco de realismo** (en curso, sesión aparte): prueba ciega de clips reales y simulados con varios lectores,
   curvas de volumen frente a EchoNet-Dynamic, deformación longitudinal en clips simulados, estadística del speckle
   frente a CAMUS y fantomas (puntos, quiste, speckle uniforme) frente a Field II. Toda fase posterior se juzga aquí,
   comparando el modelo nuevo con el actual detrás de un interruptor.
1. **Anatomía estática desde mallas**: la forma media del modelo estadístico de Rodero et al. 2021 (20 corazones
   sanos por TC, CC BY 4.0, Zenodo 4593739; la cohorte en 4590294), pasada fuera de línea a volúmenes de distancia y
   etiqueta (texturas 3D) que CPU y GPU muestrean igual. Faltan velos valvulares, aparato subvalvular y pericardio:
   paramétricos sobre los anillos y el epicardio.
2. **Movimiento cinemático en coordenadas ventriculares universales** (las trae Rodero por nodo): objetivos clínicos
   de volúmenes, MAPSE/TAPSE, engrosamiento, torsión (Kocabay 2014: base −6,9 ± 3,5°, ápex +13,0 ± 6,5°, torsión
   20,0 ± 7,3°; destorsión en la relajación isovolumétrica) y curvas auriculares (vaciado 55–65 %). No hay movimiento
   abierto de corazón completo; los datos de cine-RM de KIT (CC BY-NC) sirven para calibrar, no para redistribuir.
3. **Imagen por convolución tipo COLE** (Gao et al. 2009) con dispersores lagrangianos que se mueven con el tejido;
   PSF calibrada fuera de línea con SIMUS/Field II; segundo armónico calibrado con CREANUIS/Fullwave; capa de
   reverberación y aberración de la pared torácica. WebGPU es lo indicado (WebGL2 no tiene sombreadores de cómputo).
4. **Doppler**: plantillas paramétricas de flujo (llenado E/A, eyección, vórtice, chorros de insuficiencia),
   ensamble IQ con autocorrelación de Kasai para el color y espectro PW/CW por histograma de velocidades ponderado por
   el haz; validación con DUPLEX (Sun et al. 2022) y valores clínicos.

## Medido antes de empezar

- La raíz aórtica ya se mueve 8,2 mm hacia el transductor de telediástole a telesístole en el PLAX canónico del caso
  normal (clínico 9 ± 1,5 mm, 7–12) y 3,4 mm en la insuficiencia cardiaca (reducida, como en la clínica): no es una
  mejora pendiente. Lo que fallaba era la aurícula, que no la seguía (decisión 341).
- La torsión del VI no se añade al modelo analítico: un giro local del ventrículo desencaja el VD y las válvulas, que
  no giran; entra con el movimiento de la fase 2.
- La práctica libre abre en el PLAX canónico (decisión 343).

## Riesgos

- Sin movimiento abierto de corazón completo, el movimiento depende de la calidad de los parámetros clínicos.
- Licencias: Field II prohíbe su uso en productos comerciales sin permiso (sólo como referencia fuera de línea); KIT es
  no comercial; XCAT y Zygote son de pago; MM-WHS, DUPLEX y la base de Alessandrini sin términos confirmados.
- Datos brutos de 1,5–37 GB: nunca en git; sólo derivados compactos y reproducibles.
- La paridad CPU ↔ GPU y el presupuesto del trazador (decisión 332) cambian de naturaleza con WebGPU.

## Fuentes principales

- Rodero et al. 2021, PLoS Comput Biol 17:e1008851 — https://zenodo.org/records/4593739 · https://zenodo.org/records/4590294
- Strocchi et al. 2020, PLoS One — https://zenodo.org/records/3890034
- Gao et al. 2009, IEEE TUFFC 56:404 (COLE); OpenBCSim (BSD) — https://github.com/sigurdstorve/OpenBCSim
- SIMUS/MUST (Garcia 2022) — https://www.biomecardio.com/MUST/ ; Field II — https://field-ii.dk/ ; Fullwave — https://github.com/pinton-lab/fullwave25
- Kocabay et al. 2014, Rev Esp Cardiol — https://www.revespcardiol.org/en-normal-left-ventricular-mechanics-by-articulo-S1885585714000711
- Sun et al. 2022 (DUPLEX) — http://humanheart-project.creatis.insa-lyon.fr/duplex.html
- Raíz aórtica en modo M: 9 ± 1,5 mm en 30 normales (PubMed 647772); 12 ± 2 frente a 9 ± 3 mm en miocardiopatía
  dilatada (Sci Rep 2019, PMC6405754)
