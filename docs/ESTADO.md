# Estado del proyecto — 18 de octubre de 2026

Resumen para quien retome EchoTwin TTE sin la conversación anterior. Complementa `docs/MISION.md`
(qué se busca), `docs/DECISIONS.md` (por qué se hizo cada cosa) y `docs/LIMITATIONS.md` (qué queda
mal, con cifra). El método de trabajo está en `.claude/skills/fidelity-method/SKILL.md`.

## Qué funciona

- `main` contiene las decisiones 1–343 (333–343, del 16 al 18 de octubre: pericardio, cresta supraventricular, septo y pulmón del PSAX-AV, vena pulmonar, limpieza de la PR 173, interfaz, modo revisión con identificación y lápiz, AI apoyada en la raíz, panel de segmentos estable y apertura en el PLAX canónico). Las últimas: 326 (hojas de revisión clínica por vista),
  327 (aurículas planas sobre el septo, fosa por la derecha), 328 (base ancha de la aurícula
  izquierda sobre todo el anillo; cortina aortomitral como lámina), 329 (clips de revisión: cine de
  un ciclo y barridos de sonda, GIF/MP4), 330 (la pared posterior de la AI apoyada en la aorta
  descendente) y 331 (censo de coherencia interna: contactos entre sangres, islas, grises por
  estructura y bordes rectos; `src/tests/coherence/`, CLI en `tools/offline/review/coherence-census.ts`
  y `coherence-planes.ts`).
- El guardián del coste del trazador CPU (decisión 332) mide el árbol de referencia que nombra
  `tools/ci/tracer-budget.json` (hoy, la fusión de la decisión 331) y el de la rama en la misma
  máquina, alternados, y falla si la rama cuesta más de un 25 % más. Antes comparaba con un número
  fijo, que variaba ±7 % entre máquinas del mismo modelo y tumbaba `main` en las lentas. Un trazador
  más caro necesita una decisión que lo explique y que ponga su commit como referencia. Se puede
  correr en local: `npx tsx tools/ci/tracer-budget.ts --reference <worktree del commit>`.
- Herramientas de revisión con ojo clínico, que son el mecanismo por el que Daniel aporta defectos:
  `tools/offline/review/review-sheets.ts` (eco + mapa rotulado del mismo fotograma polar) y
  `review-clips.ts` (cine y barridos). El censo de coherencia es el instrumento de «ojos limpios»:
  correrlo antes y después de cada decisión y comparar.
- Banco de realismo (decisión 344, `npm run realism`): fantomas de la formación de imagen frente a una referencia tipo
  Field II, volumen del VI, GLS por seguimiento de speckle, decorrelación y textura frente a CAMUS y EchoNet, y una
  prueba de Turing visual ciega. Es el juez de cualquier refundación de la anatomía o de la imagen; el informe con las
  brechas ordenadas está en `docs/validation/banco-realismo.md`.
- CI: lint, cuatro shards de la suite completa (`VITEST_TIER=all`), cobertura fundida, build con
  presupuesto de bundle y de trazador CPU, E2E sobre `dist/`, fidelidad. Las pruebas de documentación
  (`docsConsistency.test.ts`, `limitationsConsistency.test.ts`) exigen numeración sin huecos en
  `DECISIONS.md`, bloques generados al día (`npm run docs:gen`) y listas `KNOWN_*` registradas en
  `tools/docs/known-sets.ts`, no vacías y sin entradas obsoletas.

## Qué está a medias (16-10-2026)

- `docs/ROADMAP.md` se detiene en la decisión 211 y `docs/ITERATIONS.md` en octubre 4: el orden de
  prioridades vigente es el de este archivo, hasta que se actualicen o se retiren.
- El trazador creció un 23,5 % entre las decisiones 248 y 318 sin que ninguna lo declarara; la
  decisión 332 lo declara y mueve la referencia a la 331.
- Las PR apiladas de esta tanda (#160, #161, #162) se fusionaron con commit de fusión, no squash,
  para que cada una entrara limpia sobre la anterior; el historial de `main` tiene esos merges.

## Decisiones tomadas y deudas con cifra

- Las PR se fusionan en el orden en que se numeran las decisiones; una PR apilada se fusiona con
  commit de fusión para que la siguiente entre limpia.
- Los scripts de medición temporales viven en el scratchpad de la sesión, nunca en el repo; lo que
  se reutiliza pasa a `tools/offline`.
- Lo que el censo de coherencia (331) deja declarado con cifra, cada punto una decisión futura:
  cava inferior en el flujo de entrada del VD (1,1 cm²), seno coronario contra cava inferior, pared
  de la AI más brillante que el pericardio en los apicales y techo auricular plano (3,3 cm). La
  cresta supraventricular (AD contra TSVD) quedó resuelta en la decisión 334. El «VD plano en el eje
  corto (6,5 cm)» no es un defecto: medido el 2026-10-17, es la resolución de la regla de rectas
  del censo (ver `LIMITATIONS.md`).
- Detrás del techo de la AI, la imagen sale algo más brillante que CAMUS en telesístole (decisión
  333, `KNOWN_LA_ROOF_EXCESS`): no es volumen parcial de láminas tangentes, que se midió y está bien,
  sino la reflectividad difusa del pericardio, atada a la línea pericárdica lateral.
- Hechos del orden fijado por Daniel: la envoltura anterior del VD se midió el 2026-10-17 y está
  dentro de la anatomía (arco septal de 120°, cavidad de 18–34 mm); la AI dilatada ya no invade la
  aorta (decisión 330) y la boca de su vena superior izquierda abre desde la 337. Siguen los
  menores (orejuela izquierda pequeña, cava superior en el A4C, pared auricular junto a los
  anillos, inclinación del eje corto mitral), textura frente a CAMUS, y un segmentador entrenado
  con ecos reales como observador independiente.

## Rumbo desde el 2026-10-18

El método cambió: en vez de parchar el modelo analítico pieza a pieza, la anatomía, la imagen y el Doppler se
reconstruyen sobre bases verificables, juzgadas por un banco de realismo (prueba ciega con expertos, métricas frente a
EchoNet y CAMUS, fantomas frente a Field II). El plan, lo medido y las fuentes están en `docs/RECONSTRUCCION.md`. Las
correcciones del modelo actual quedan para lo que estorbe la enseñanza mientras tanto.

Fase 1 en piloto (decisión 346): el corazón medio de Rodero, estático, entra al trazador CPU como volumen detrás del
motor `rodero-estatico` del banco. Mejora la textura del miocardio y, sin movimiento, pierde todas las brechas de
movimiento; la fase 2 es la siguiente.

Fase 2 en piloto (decisión 350): el mismo corazón movido por el ciclo del caso (descenso de la base, VI incompresible
con la curva de volumen, torsión de Kocabay, VD y aurículas), motor `rodero-movil`. Frente al modelo actual, el banco
da 7 brechas mejores, 1 peor (el gris del miocardio) y 12 iguales; GLS del contorno −18,3 %. Siguiente: la imagen por
convolución con dispersores lagrangianos (fase 3) o llevar el corazón móvil al GPU.

Fase 3 en piloto (decisión 351): imagen por convolución de dispersores puntuales anclados al tejido con la PSF de la
referencia del banco y una mirada, motores `cole` y `rodero-cole`. Los fantomas casan con la referencia (resolución
lateral, SNR de Rayleigh, quiste); con el corazón móvil el banco da 9 brechas mejores, 4 peores y 7 iguales. Siguiente:
llevar anatomía móvil e imagen al GPU, o el Doppler (fase 4).

En la app (decisión 352): el panel Dev elige la anatomía, analítica o Rodero (experimental, volumen de 1 mm en
`public/anatomy`). Desde la decisión 353 lo forma el GPU (37 ms por cuadro; CPU sin WebGL2). Desde la decisión 354 el
panel elige también la imagen, red o convolución (experimental), en la CPU y en el GPU (24 ms por cuadro con el corazón
analítico, 27 con Rodero; 523 ms en la CPU). Decisión 355: el banco compara la referencia en la rejilla del
simulador y saca sus celdas del núcleo; la convolución tiene la resolución y la celda de la física y la red las tiene
finas. Frente a la línea base nueva, `rodero-cole` da 12 mejor, 2 peor (asimetría y gris mediano del miocardio), 7
igual. Decisión 356: la convolución dibuja los granos del parénquima
con dispersores fuertes escasos (0,2 %, ×22); `cole` acerca en 14 brechas sin empeorar ninguna y `rodero-cole` da 14
mejor, 1 peor (la curtosis de su realización), 6 igual. Las hojas de revisión dibujan Rodero y la convolución
(`REVIEW_ANATOMY`, `REVIEW_IMAGE`). Desde la decisión 357 la anatomía y la imagen están arriba en el panel Dev
(menú de deslizadores → Panel Dev). Decisión 358: las paredes auriculares de Rodero
miden 1,7 mm (la TC, 1,45–1,8) y su grasa epicárdica queda en los surcos auriculoventriculares e interventriculares.
Decisión 359: la textura del banco es la media de seis
realizaciones; `rodero-cole` 15 mejor, 0 peor, 6 igual. Decisión 360: el cuatro cámaras de Rodero gira 15° sobre el
eje del VI hasta su propia cruz (la masa gris bajo la bisagra septal mitral era el septo basal y la grasa entre dos
aurículas que no se tocaban en el plano declarado); la caída del GLS del modelo que traía resultó ser la fragilidad de
esa medida, que cuenta los escalones del contorno. Decisión 361: el GLS del modelo en el banco es el de su tejido,
seguido por las coordenadas materiales que anclan el speckle (analítico −19,3 %; Rodero −13,4 % en su cuatro cámaras, y
su speckle lo sigue). Decisión 362: el casquete apical de Rodero se engrosa en sístole como la pared que lo precede,
y la punta de la cavidad se acerca a la base; su tejido se acorta −15,4 % en el cuatro cámaras por la cruz (−17,6 % en
el endocardio), aún bajo el rango normal. En el plano de la cruz, la bisagra septal se desplaza 3 mm hacia el VD en
sístole y alarga el primer tramo del septo basal: queda por mirar. Decisión 363: el paso radial vuelve al estiramiento
del VI (con el de cada punto, la pared crecía un 2,6 % en sístole; ahora un 1,5 %); en sístole la cúpula apical se
estrecha 2–3 mm, a juzgar en las hojas. Decisión 364: dentro del corazón de Rodero no queda hueco, grasa ni pericardio. La malla media no tenía tabique
interauricular (dos paredes con un hueco pintado como pericardio, 9 mm entre cavidades: ahora un tabique único de 4 mm),
llevaba el septo basal del VI 10–15 mm más allá de la bisagra mitral por el lado de la AI (ahora la AI baja hasta el
plano valvular, y el septo auriculoventricular junto a la AD se conserva) y dejaba huecos entre las aurículas y la raíz
aórtica (ahora las aurículas se apoyan en ella). La masa gris bajo la bisagra septal a +15° de giro pasa de 135 a 111 de
gris: lo que queda es la pared de la AI cortada en rasante. Regla de Daniel para todo lo que siga: una estructura visible
tiene que poder nombrarse como anatomía en cualquier plano, y en los tabiques y uniones interiores no hay grasa ni
pericardio. Decisión 365: un censo por pares del corazón de volumen (distancias entre cavidades donde se enfrentan,
huecos, grasa, miocardio sobre las bisagras, paredes, sangre contra sangre; `KNOWN_VOLUME_CENSUS` con 31 cifras de Rodero y
del analítico, y el anillo tricuspídeo de Rodero, que estaba vacío) y una hoja de sospechas en las hojas de revisión
(`hoja-sospechas.md`: brillo en sangre, islas, apariciones a 5°, lista blanca, espesores, con recorte y cifra) para que
los candidatos a defecto le lleguen a Daniel sin buscarlos. Decisión 366: la pared lateral de la AI analítica
sube desde un estante sobre el surco, 5 mm por fuera de la bisagra lateral, y continúa el borde del VI; antes la base se
abocinaba hasta +7 mm y daba un paso de 9–18 mm hacia un cuerpo 6–13 mm dentro del anillo (el vértice que marcó Daniel).
Decisión 367: la pared libre del VD termina en su bisagra tricuspídea y la pared lateral de la AD sube desde ella
(antes, la pared del VD seguía 4–8 mm por encima del anillo y la AD daba un paso de 9 mm hacia el tabique, con su sangre
contra la grasa). La pared de la AD se mueve con el anillo tricuspídeo en el Doppler tisular. Decisión 368: el PSAX mitral corta las puntas de los velos (2,0 cm) desde el espacio
superior cuando el pulmón lo permite, a 11–14° del eje corto; conserva todo el anillo del VI en el ciclo (antes la AI se
llevaba el 28–57 % desde la mesosístole). Decisión 369: el tabique interauricular pasa sin escalón de la membrana de la fosa al septo
muscular (sin el limbo de 7 mm), la fosa sigue a la base y el tabique se abomba 2,5 mm hacia la AD en sístole. Decisión 370: la pared de las venas pulmonares es miocardio de 0,7 mm (era pared arterial de
1,2 mm) y ya no destacan. Decisión 371: Rodero tiene cortina aortomitral (fibrosa, 2 mm). La unión de la 364 había dejado 4,5 cm² de sangre de la AI contra el tracto de salida, y el velo anterior colgaba a 15–23 mm de la raíz en el PLAX; el censo cuenta ahora ese contacto por encima de la bisagra. Daniel decidió el 24 de octubre mantener las dos anatomías y mejorar ambas; Decisión 372: donde la TC de Rodero cortó sus grandes vasos, siguen los del analítico (ascendente, arco y ramas, tronco pulmonar con sus ramas); el supraesternal de Rodero ya tiene arco y el PSAX aórtico, tronco. Decisión 373: la válvula aórtica de Rodero ya no es un disco cerrado de 3,8 mm; el disco es sangre de la raíz y las valvas del analítico, llevadas al anillo de la TC, se abren en sístole y cierran en diástole. Decisión 374: los velos mitrales de Rodero nacen de su propio anillo (el analítico quedaba 2–5 mm por fuera en la ICFEr y el velo anterior se cortaba al cruzar la cortina). Decisión 375: la válvula pulmonar de Rodero se abre (sus valvas son las analíticas sobre el disco de la TC) y el tórax lee alrededor del tronco injertado la misma distancia que alrededor del analítico; el tronco visible en el PSAX aórtico pasa del 2–5 % al 4–6 % del sector. De Rodero queda sobre todo la geometría de cada caso patológico. Decisión 376: el corazón (analítico o Rodero) y el modo revisión con sus notas están a un clic en la barra superior. Decisión 377: el mediastino posterior tiene esófago y su grasa tiene nombre; nada queda «fuera del modelo». Decisión 378: la grasa epicárdica sobre las paredes libres de las aurículas es una capa fina; la cara externa de cada aurícula es la de su propia pared, no la de un elipsoide de anclaje, y la grasa libre sobre la AD baja de 6–15 a 0,3–2 cm³. Decisión 379: el vestíbulo de la AD llega al anillo tricuspídeo con su pared; la sangre de la AD sin pared baja de 13–22 a 1,7–2,5 cm² en telediástole, y lo que queda, junto a las bocas de las venas, está en `KNOWN_RA_BARE_BLOOD`. Decisión 380: la cara epicárdica del VI termina en su base (salvo junto a la raíz); su casquete, 2–2,5 cm por encima de la bisagra mitral, dejaba una cuña de grasa junto a la pared lateral de la AI en el subcostal, y era también la grasa sobre la AI de la MCH obstructiva (6,3 → 0,4 cm³). Decisión 381: la pared lateral de la AI de la 366 no añade nada por encima de su techo; allí su relleno se estrechaba hasta una lámina de ancho cero cuya pared se alzaba como una aleta de 4 mm sobre el techo, sin sangre a ningún lado (hasta 2,5 cm³), y el subcostal la dibujaba como una línea rosada bajo la aurícula. Decisión 382: el censo de coherencia cuenta las esquinas de los bordes en los planos de las vistas (2498 en 120 planos: saco 775, AI 733, AD 574, VD 288, VI 128), como trinquete en `KNOWN_BORDER_CORNERS`. Decisión 383: sobre el derrame del taponamiento, el pericardio parietal es una envoltura lisa del corazón desplazada por un grosor que cambia suavemente y se adelgaza detrás de la AI (seno oblicuo): sus esquinas bajan de 72 a 27, el derrame de 1201 a 1090 mL, y quedan 0,42 cm detrás de la AI y 2,2 detrás del VI. Decisión 384: el borde de la fosa oval se redondea (6,5 mm en vez de 4) y el censo deja de contar el seno coronario: la AD baja de 456 a 335 esquinas, a cambio de 0,12 mL más de hueco junto a la cava superior. Lo siguiente del censo es la AI (733). Siguen de la revisión del 24 de octubre la pared de la AI del A5C («rombo») y la costilla del A5C. Encontrados al medir la 368: la
pared basal acinética del IAM inferior se separa 4 mm de su cavidad en sístole con grasa entre las dos, y la unión de la
cava inferior con la AD queda a la altura de la mitral (la cava entra en el eje corto mitral).

## Cómo seguir

1. `git switch main && git pull`; los worktrees temporales viven en `$TMPDIR/wt-*` y se borran al
   fusionar su PR (`git worktree remove`), y las ramas locales fusionadas con `git branch -d`.
2. Antes de cada decisión: correr el censo de coherencia y las hojas de revisión de la vista
   afectada; después, otra vez, y comparar.
3. Cada cambio: rama propia, decisión numerada en `docs/DECISIONS.md`, `npm run docs:gen`, prueba
   permanente validada por mutación, PR; Daniel fusiona cuando la CI está en verde.
