# EchoTwin TTE — instrucciones para el agente

Lo general está en `CONTRIBUTING.md` (máquina, verificación, paridad CPU ↔ GPU, goldens, capas) y el método de
fidelidad en `.claude/skills/fidelity-method/SKILL.md`. Dónde está el proyecto y qué sigue: `docs/ESTADO.md`. Esto
recoge lo operativo que antes se repetía en cada conversación.

## Con Daniel

- Daniel es médico y enseña ecocardiografía; habla, decide y revisa en español. Las decisiones, `LIMITATIONS.md` y
  las respuestas, en español.
- Mide y enseña las cifras antes de cambiar nada. Cuando pregunta qué hacer, una recomendación concreta, no un menú.
- Fusiona tú una PR cuando toda la CI está en verde y él autorizó el trabajo. Las PR de Dependabot no se tocan sin
  su orden.

## Cada cambio

- Una rama por decisión desde `main`, en kebab-case con el prefijo de `CONTRIBUTING.md` (`feat/`, `fix/`, `test/`),
  y un worktree propio en `$TMPDIR` si hay trabajo en paralelo. Al fusionar, se borran el worktree y la rama.
- La decisión siguiente en `docs/DECISIONS.md`. La numeración no admite huecos (`docsConsistency.test.ts`), así que
  dos PR abiertas a la vez chocan: toma el número siguiente al más alto abierto, y fusiona en orden numérico. Una PR
  apilada sobre otra se fusiona con commit de fusión, no squash, para que la siguiente entre limpia.
- Después de editar docs: `npm run docs:gen`. Prettier no se pasa por `docs/` (reformatea las decisiones).
- Toda corrección acaba en una prueba permanente validada por mutación. No se ajusta una prueba para que pase. Lo que
  no se corrige va a una lista `KNOWN_*` con su cifra, registrada en `tools/docs/known-sets.ts` y explicada en
  `docs/LIMITATIONS.md`. Una lista vacía se borra. El lector de `known-sets.ts` sólo entiende literales planos, y un
  apóstrofo dentro de una cadena entre comillas dobles le hace contar cero entradas.
- Antes y después de tocar la anatomía o la imagen, corre el censo de coherencia (`tools/offline/review/coherence-census.ts`
  y `coherence-planes.ts`) y las hojas de revisión de la vista afectada (`review-sheets.ts`, `review-clips.ts`).
- El coste del trazador CPU se compara con un árbol de referencia medido en la misma máquina (decisión 332):
  `npx tsx tools/ci/tracer-budget.ts --reference <worktree del commit de tools/ci/tracer-budget.json>`. Si una
  decisión lo encarece más de un 25 %, lo explica y pone su commit como referencia.
- Los scripts de medición temporales van al scratchpad de la sesión, nunca al repositorio; lo que se reutiliza pasa a
  `tools/offline`. Los datos clínicos (CAMUS, EchoNet) nunca entran en git.
- Renombrar la rama de una PR abierta la cierra en GitHub: elige el nombre antes de abrirla.
