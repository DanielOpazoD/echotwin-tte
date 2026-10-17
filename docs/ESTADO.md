# Estado del proyecto — 16 de octubre de 2026

Resumen para quien retome EchoTwin TTE sin la conversación anterior. Complementa `docs/MISION.md`
(qué se busca), `docs/DECISIONS.md` (por qué se hizo cada cosa) y `docs/LIMITATIONS.md` (qué queda
mal, con cifra). El método de trabajo está en `.claude/skills/fidelity-method/SKILL.md`.

## Qué funciona

- `main` contiene las decisiones 1–332. Las últimas: 326 (hojas de revisión clínica por vista),
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
  de la AI más brillante que el pericardio en los apicales, VD plano en el eje corto (6,5 cm), techo
  auricular plano (3,3 cm). La cresta supraventricular (AD contra TSVD) quedó resuelta en la decisión
  334.
- Detrás del techo de la AI, la imagen sale algo más brillante que CAMUS en telesístole (decisión
  333, `KNOWN_LA_ROOF_EXCESS`): no es volumen parcial de láminas tangentes, que se midió y está bien,
  sino la reflectividad difusa del pericardio, atada a la línea pericárdica lateral.
- Después, en el orden fijado por Daniel: envoltura anterior del VD (media luna de los ejes
  cortos), AI dilatada que invade la aorta descendente en seis casos (`KNOWN_LA_IN_AORTA`),
  menores (orejuela izquierda pequeña, cava superior en el A4C, pared auricular junto a los
  anillos, inclinación del eje corto mitral), textura frente a CAMUS, y un segmentador entrenado
  con ecos reales como observador independiente.

## Cómo seguir

1. `git switch main && git pull`; los worktrees temporales viven en `$TMPDIR/wt-*` y se borran al
   fusionar su PR (`git worktree remove`), y las ramas locales fusionadas con `git branch -d`.
2. Antes de cada decisión: correr el censo de coherencia y las hojas de revisión de la vista
   afectada; después, otra vez, y comparar.
3. Cada cambio: rama propia, decisión numerada en `docs/DECISIONS.md`, `npm run docs:gen`, prueba
   permanente validada por mutación, PR; Daniel fusiona cuando la CI está en verde.
