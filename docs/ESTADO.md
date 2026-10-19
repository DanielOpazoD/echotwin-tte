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
analítico, 27 con Rodero; 523 ms en la CPU). Siguiente: juzgar la convolución en la app y en el banco con Rodero.

## Cómo seguir

1. `git switch main && git pull`; los worktrees temporales viven en `$TMPDIR/wt-*` y se borran al
   fusionar su PR (`git worktree remove`), y las ramas locales fusionadas con `git branch -d`.
2. Antes de cada decisión: correr el censo de coherencia y las hojas de revisión de la vista
   afectada; después, otra vez, y comparar.
3. Cada cambio: rama propia, decisión numerada en `docs/DECISIONS.md`, `npm run docs:gen`, prueba
   permanente validada por mutación, PR; Daniel fusiona cuando la CI está en verde.
