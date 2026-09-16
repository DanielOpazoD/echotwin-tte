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
   recoge lo que sigue mal; cada id de `KNOWN_MODEL_LIMITATIONS` y `KNOWN_VIEW_LIMITATIONS` debe
   aparecer allí entre acentos graves (`src/tests/limitationsConsistency.test.ts`).
3. `.claude/skills/fidelity-method/SKILL.md`: 18 reglas de método para anatomía e imagen (medir antes
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
- **Desviaciones declaradas.** `expectedDeviations` de un caso es patología deliberada;
  `KNOWN_MODEL_LIMITATIONS` (`proportions.test.ts`) y `KNOWN_VIEW_LIMITATIONS` (`viewContent.test.ts`)
  son deuda del modelo y deben figurar en `docs/LIMITATIONS.md`. `KNOWN_DEVIATIONS` de
  `clinicalImage.test.ts` lleva el valor basal medido: si mueves una métrica, actualiza el basal con
  el valor medido y documenta el motivo. CAMUS es calibración, nunca «validación clínica».
- **Fronteras de capa.** ESLint impide que el motor (`src/simulator`, `src/clinical`, `src/education`,
  `src/cases`, `src/core`) importe la aplicación, la UI, los workers o React; `src/core` no importa
  nada del resto. La tabla completa está en `ARCHITECTURE.md`.

## Verificar

En serie, porque las pruebas lentas saturan la CPU y con la máquina cargada fallan por tiempo
(`uptime` antes de culpar al cambio):

```bash
npm run lint && npm run format:check && npm run typecheck
npm test              # suite rápida, ~1 min
npm run test:slow     # acústica, clínica CAMUS, goldens: varios minutos
npm run check         # todo lo anterior con la suite completa + build (lo que exige el pipeline)
npx vite build && npm run test:e2e   # Playwright prueba dist/, así que construye antes (~28 min)
```

`npm run coverage` aplica los pisos por área de `vite.config.ts`. Un test nuevo que renderice cuadros
o avance el núcleo varios latidos lleva `// @tier slow` en su primera línea (y `// @tier fast` si
importa esos módulos pero se mantiene ligero a propósito); `src/tests/testTiers.test.ts` lo exige.

Herramientas de medición (`npm run measure -- <caso>`, `slice-map.ts`, `audit-views.ts`,
`render-views.ts`, `camus-compare.ts`) y el runbook de goldens y renders: `docs/validation/README.md`
y la sección «Herramientas» del método de fidelidad. Los scripts temporales van fuera del repositorio.

## Entregar

Rama `feat/<nombre>` desde `main`, commit con mensaje en imperativo, MR en GitLab. El pipeline
(`.gitlab-ci.yml`) tiene dos perfiles: en el MR corre lint, formato, tipos, la suite rápida, el build
y el presupuesto de bundle (~5 min); en `main` añade la suite completa con cobertura en tres shards
y los E2E sobre `dist/`. Un MR se mergea con su pipeline en verde y se vigila el de `main`.

Los pipelines corren en un **runner propio** (`gitlab-runner`, executor `shell`, registrado para
este proyecto el 2026-09-16 en el Mac del proyecto; los runners compartidos de GitLab están
desactivados porque el plan gratuito agotó sus 400 minutos ese mismo día). Qué implica:

- El job usa el Node y el Chromium de Playwright instalados en esa máquina (`PATH` fijado en
  `~/.gitlab-runner/config.toml` al Node 22 de nvm, el de `.nvmrc`); las claves `image:` del YAML
  se ignoran. Si cambia la versión de Playwright, ejecuta `npx playwright install chromium` allí.
- Un job a la vez (`concurrent = 1`): un pipeline completo de `main` tarda unos 8–10 min.
- Se administra con `brew services start|stop gitlab-runner`; el estado se ve en Settings → CI/CD →
  Runners del proyecto. Para otra máquina: `brew install gitlab-runner`, crear el runner en esa
  página (o `POST /user/runners`) y `gitlab-runner register --executor shell --token <token>`.
- Un runner `shell` ejecuta lo que se empuje con los permisos del usuario que lo corre. Los MR de
  forks de usuarios externos no disparan pipelines en runners del proyecto sin aprobación de un
  mantenedor; aun así, revisa el diff de `.gitlab-ci.yml` antes de aprobar uno.
