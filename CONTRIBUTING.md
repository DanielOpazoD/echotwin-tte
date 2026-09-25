# Contribuir

Esta página es el punto de entrada para alguien que clona el repositorio y quiere cambiar algo sin
hablar antes con el autor. Enlaza lo que ya existe en vez de repetirlo.

## Preparar la máquina

```bash
nvm use            # .nvmrc fija Node 22; CI usa la misma versión
npm ci             # versiones exactas de package-lock.json
npx playwright install chromium   # sólo para los E2E
npm run dev        # http://localhost:5173
```

Requisitos: Node 22 y npm 11 (`packageManager` en `package.json`). WebGL2 por hardware para la
cadena de imagen en GPU; sin él la app funciona en CPU y cuatro E2E (`e2e/gpu-live.spec.ts`) se
saltan. Los datos clínicos de CAMUS nunca entran en el repositorio: si necesitas la comparación,
descárgalos aparte y pásalos con `CAMUS_DIR=<ruta fuera del repo>` (decisión 69).

## Antes de tocar código

1. `docs/ARCHITECTURE.md`: capas, flujo de datos por cuadro, contrato del worker.
2. `docs/DECISIONS.md`: registro numerado; si tu cambio altera el modelo, añade la decisión siguiente
   con las medidas que la justifican y regenera el índice con `npm run docs:index`. Una decisión que
   otra posterior sustituye lleva `[Estado: superada por N]` tras su título. `docs/LIMITATIONS.md`
   recoge lo que sigue mal; cada id de `KNOWN_MODEL_LIMITATIONS`, `KNOWN_VIEW_LIMITATIONS` y
   `KNOWN_UNREACHABLE_LANDMARKS` debe aparecer allí entre acentos graves, y la tabla final lista las
   entradas de todos los conjuntos `KNOWN_*` (`src/tests/limitationsConsistency.test.ts`).
   Las tablas generadas de `ARCHITECTURE.md` (qué importa cada capa) y `LIMITATIONS.md` se
   rehacen con `npm run docs:gen`, que también regenera el índice de decisiones; una prueba falla si
   alguna no coincide con el código.
3. `.claude/skills/fidelity-method/SKILL.md`: 20 reglas de método para anatomía e imagen (medir antes
   de tocar, CPU y GPU en paridad, tests validados por mutación). Están escritas para un agente pero
   valen igual para una persona.
4. `docs/AUDITORIA_INGENIERIA.md`: estado de la base técnica y deuda conocida.

Para reportar lo que se ve mal en una imagen —o para recibir de Claude un punto señalado sobre ella— usa el
**modo revisión** (tecla R en la app, `docs/REVIEW_MODE.md`): los marcadores dicen qué estructura del modelo hay
debajo y el informe lleva el estado exacto para reproducir el cuadro con `npm run review:render`.

## Reglas que no se negocian

- **Paridad CPU ↔ GPU.** Todo cambio en la cadena acústica se hace en
  `src/simulator/renderer/procedural/sliceRenderer.ts` y en `src/simulator/renderer/gpu/glslPasses.ts`;
  las constantes viven en `src/simulator/renderer/acoustic/acoustics.ts` y llegan al GLSL por
  `acousticDefinesGlsl()`. El clasificador anatómico (`src/simulator/anatomy/classify.ts` y módulos)
  tiene su espejo en `gpu/glslHeart.ts`; toda constante compartida es un `export const` interpolado en
  la cabecera del shader, nunca un literal repetido. Las funciones escalares puras compartidas (lista en
  `tools/glsl/ts2glsl.ts`) se escriben sólo en TypeScript y `npm run glsl:gen` las transpila a
  `gpu/glslGenerated.ts`; si cambias una, regenera. `e2e/gpu-equivalence.spec.ts` es el juez, ahora también
  por estructura.
- **Determinismo por semilla.** Los goldens (`src/tests/goldens/`) no se regeneran para que pasen: sólo
  cuando el cambio de imagen es intencional y revisado, con `npm run golden:update`.
- **Desviaciones declaradas.** `expectedDeviations` de un caso es patología deliberada; los conjuntos
  `KNOWN_*` de las pruebas (`KNOWN_MODEL_LIMITATIONS` en `proportions.test.ts`, `KNOWN_VIEW_LIMITATIONS`
  en `viewContent.test.ts` y los demás de la tabla de `docs/LIMITATIONS.md`) son deuda del modelo y
  deben figurar en ese documento. `KNOWN_DEVIATIONS` de
  `clinicalImage.test.ts` lleva el valor basal medido: si mueves una métrica, actualiza el basal con
  el valor medido y documenta el motivo. CAMUS es calibración, nunca «validación clínica».
- **Fronteras de capa.** ESLint impide que el motor (`src/simulator`, `src/clinical`, `src/education`,
  `src/cases`, `src/core`) importe la aplicación, la UI, los workers o React; `src/core` no importa
  nada del resto. `src/tests/layers.test.ts` prohíbe los ciclos entre capas, y la tabla de
  `ARCHITECTURE.md`, generada desde los imports, muestra qué importa cada una.

## Verificar

En serie, porque las pruebas lentas saturan la CPU y con la máquina cargada fallan por tiempo
(`uptime` antes de culpar al cambio):

```bash
npm run lint && npm run format:check && npm run typecheck
npm test              # suite rápida, ~1 min
npm run test:slow     # acústica, clínica CAMUS, goldens: varios minutos
npm run check         # todo lo anterior con la suite completa + build (lo que exige el pipeline)
npx vite build && npm run test:e2e   # Playwright prueba dist/, así que construye antes (7–12 min)
```

`npm run coverage` aplica los pisos por área de `vite.config.ts`. Un test nuevo que renderice cuadros
o avance el núcleo varios latidos lleva `// @tier slow` en su primera línea (y `// @tier fast` si
importa esos módulos pero se mantiene ligero a propósito); `src/tests/testTiers.test.ts` lo exige.

Herramientas de medición (`npm run measure -- <caso>`, `slice-map.ts`, `audit-views.ts`,
`fidelity-bench.ts`, `structure-share.ts`, `render-views.ts`, `camus-compare.ts`, `blind-test.ts`) y el runbook de goldens y renders: `docs/validation/README.md`
y la sección «Herramientas» del método de fidelidad. Los scripts temporales van fuera del repositorio.

Los E2E locales levantan su propio `vite preview` en el puerto 4190 (`E2E_PORT` lo cambia) y nunca reutilizan un
servidor ya existente: el CI usa el 4173 y en una máquina de trabajo suelen quedar vistas previas de worktrees
viejos en otros puertos, y una corrida que las reutilizara probaría otra build y no tu árbol de trabajo.
Si el puerto está ocupado, Playwright falla en vez de probar lo que no es.

## Entregar

Rama `feat/<nombre>` desde `main`, commit con mensaje en imperativo y PR en GitHub
(`DanielOpazoD/echotwin-tte`). El workflow `.github/workflows/ci.yml` corre en cada PR y en cada push a `main`:
lint, formato y tipos; la suite completa con cobertura en tres shards; el build con el presupuesto de bundle; y los
E2E sobre `dist/`. El trabajo `check` resume los demás y es el check que exige la protección de `main`, también a los
administradores; `main` no admite force push. Un PR se mergea con `check` en verde y se vigila el run de `main`.

Los trabajos corren en runners alojados de GitHub (gratuitos en un repositorio público) con el Node de `.nvmrc`, y el
workflow sólo tiene permiso de lectura sobre el repositorio. Los PR de forks corren con el evento `pull_request`, sin
secretos ni permisos de escritura. Entre el 2026-09-16 y el 2026-09-25 el proyecto vivió en GitLab con un runner
propio, porque los trabajos de Actions dejaron de arrancar en la cuenta (decisión 211); `docs/AUDITORIA_INGENIERIA.md`
conserva esa etapa y sus MR.
