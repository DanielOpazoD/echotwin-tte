# Procedimiento de validación offline

Todo corre en Node ≥ 20 con `tsx`; no hace falta navegador. Los scripts usan el caso `normal-excellent-window` con paciente en decúbito lateral izquierdo y espiración.

## 1. Renders de vistas canónicas
```
npx tsx tools/offline/render/render-views.ts [dirSalida] [vistas] [casoId]
```
- `dirSalida` por defecto `tools/offline/render/out` (no está en `.gitignore`: usa una carpeta fuera del repo si no quieres versionar PNG).
- `vistas` es una lista separada por comas; por defecto `plax,psax-av,psax-mv,psax-pm,a4c,a2c,a3c`.
- `casoId` por defecto `normal-excellent-window`; los archivos se llaman `<casoId>-<vista>-phase<fase>.png`.
- Para cada vista calcula la pose canónica (`canonicalControl`), renderiza las fases 0,00 y 0,30 con el trazador procedimental (tier medium, ajustes por defecto), aplica la consola y la scan conversion (512×440) y escribe `<vista>-phase<fase>.png` con el codificador PNG mínimo de `png.ts`. En stdout imprime los tiempos de render/consola/scan y el `ProbeControl` usado.
- Uso: revisión visual tras cambiar anatomía, tejidos, consola o vistas. No hay comparación automática de PNG.

## 2. Banco de rendimiento
```
npx tsx tools/offline/render/bench.ts [vista]
```
40 cuadros (10 de calentamiento) de la vista indicada (`plax` por defecto) y media de render / consola / scan en ms. Valores observados hoy: render 22–35 ms, consola 2–3 ms, scan 7–10 ms (Apple Silicon, Node 22).

## 3. Goldens
`src/tests/goldens.test.ts` renderiza PLAX, PSAX-PM, A4C y A2C a las fases 0 y 0,3 (tier low) y resume cada cuadro en una rejilla 12×12 de intensidades medias, comparada con `src/tests/goldens/frames.json` con tolerancia ≤ 6 niveles por celda. Regenerar después de un cambio intencionado:
```
npm run golden:update        # UPDATE_GOLDENS=1 vitest run src/tests/goldens.test.ts
```
Si el archivo no existe, la prueba lo crea en lugar de fallar. Revisa el diff del JSON y, si el cambio es visual, acompáñalo con renders del paso 1.

## 4. Suite completa
```
npm test            # vitest run
npm run check       # lint + typecheck + test + build
```
`npm run test:e2e` arranca `vite preview` en 4173 sobre el último `dist/` (construye antes con `npm run build:e2e`, que instala el gancho de pruebas; regla 15 del método de fidelidad) y ejecuta las 46 pruebas de `e2e/` (`core-flow` 10, `gpu-equivalence` 26, `gpu-live` 4 sólo con GPU por hardware, `measurements` 4, `learning` 2; ~28 min); necesita `npx playwright install chromium`. `test-results/.last-run.json` guarda el resultado de la última ejecución local (hoy: `passed`).

## 5. Banco de realismo (decisión 343)
```
npm run realism -- [--turing <carpeta fuera del repo>] [--jobs 4] [--quick]
```
Un solo comando que juzga si un cambio acerca el simulador a la ecografía real, antes de cualquier refundación de la anatomía o de la formación de imagen. Corre, en este orden: los fantomas de la formación de imagen (blancos puntuales, quiste anecoico, speckle uniforme) frente a una referencia de suma con retardos tipo Field II con el mismo transductor; un ciclo de PLAX, PSAX mitral, A4C y A2C del caso normal y dos patologías a 50 cuadros/s por la cadena CPU de la app (volumen del VI por discos, GLS por seguimiento de speckle y del contorno del modelo, decorrelación entre cuadros, textura del miocardio); los agregados de CAMUS (`CAMUS_DIR`, o `~/datos/CAMUS/database_nifti` si existe) y EchoNet-Dynamic (`ECHONET_DIR`); y, con `--turing`, una sesión ciega de la prueba de Turing visual. Escribe `tools/offline/realism/out/results.json` (sólo agregados) y el informe en español `informe.md`; `--report docs/validation/banco-realismo.md` lo copia al registro. Con la máquina en reposo tarda unos 10 min con cuatro procesos.

La prueba de Turing: `index.html` en la carpeta de `--turing` (funciona desde el disco, sin servidor) muestra los clips uno a uno, mitad reales y mitad simulados en cada vista y formato, con nombres opacos; el lector dice real o simulado, su seguridad (1–3) y qué lo delató, y la página descarga `respuestas-<lector>-<semilla>.json`. La clave (`key.json`) queda en la carpeta y nunca viaja con la página. Corrección: `npx tsx tools/offline/realism/turing-grade.ts respuestas-*.json` (acierto con su cola binomial, AUC de la calificación de seis pasos, acierto por vista y delatores), o `npm run realism -- --turing <carpeta> --answers <carpeta de respuestas>` para que entre en el informe. Fuentes de clips reales: CAMUS (fotogramas TD/TS y, si están, las secuencias `*_half_sequence.nii.gz`), EchoNet (`ECHONET_DIR`, A4C en su formato de 112 px) y `REALISM_REAL_DIR/<vista>/` para PLAX y PSAX, que ningún conjunto público trae. Una vista sin contraparte real queda fuera de la sesión y el informe lo dice.

El informe y lo que mide, con las cifras de la última corrida: `docs/validation/banco-realismo.md`.

## Herramientas previstas y ausentes
`npm run atlas:build` (`tools/offline/atlas-generation/build-atlas.ts [dirSalida] [casoId]`) renderiza el cine de 16 fases de cada vista canónica con el trazador procedimental (tier low) y escribe una hoja de contacto 4×4 por vista (`<casoId>-<vista>-cine.png`) para inspeccionar las anclas del atlas; **no** exporta un paquete de anclas cargable en la app. La validación contra PyMUST/OpenBCSim o una referencia CUDA no tiene herramientas en el repositorio; la referencia física del banco de realismo (§ 5) es una suma con retardos propia, al modo de Field II, no Field II. Ver `docs/THIRD_PARTY_REVIEW.md` para lo que se pensaba validar con PyMUST/OpenBCSim.

## Salida esperada
`render-views.ts` imprime una línea por PNG, por ejemplo (ejecución del 2026-09-10 a las 20:10 en Apple Silicon; el `ctrl` es la pose canónica ya ajustada al espacio intercostal):
```
…/normal-excellent-window-plax-phase0.30.png  render 15.6 ms, console 5.9 ms, scan 5.2 ms  ctrl={"u":2.78,"v":1.39,"rotationDeg":0,"tiltDeg":11.25,"rockDeg":-3.5,"pressure":0.6}
…/normal-excellent-window-a4c-phase0.00.png   render 15.8 ms, console 1.5 ms, scan 3.7 ms  ctrl={"u":6.55,"v":-4.71,"rotationDeg":133.25,"tiltDeg":30.25,"rockDeg":-31,"pressure":0.6}
```
El `ctrl` lo resuelve `controlAimingAt` (descenso por coordenadas sobre rotación/tilt/rock desde el punto de piel sobre el plano, ajustado por `snapToIntercostal`); cambia si cambian la anatomía del caso, el tórax o las definiciones de `viewTargets.ts`.

## Lista de comprobación para un cambio visual
1. `npm test` en verde antes del cambio (y `npm run test:slow` si el cambio toca anatomía, acústica o consola).
2. Renders «antes» con el paso 1 en una carpeta externa.
3. Aplica el cambio; renders «después»; compara a ojo PLAX y A4C en fases 0,00 (telediástole) y 0,30 (sístole).
4. `npm run test:slow`: si `goldens.test.ts` falla por más de 6 niveles en alguna celda, decide si el cambio es intencionado; sólo entonces `npm run golden:update`, que reescribe `frames.json` y un PNG por cuadro en `src/tests/goldens/`: revisa las imágenes en el diff, no los números. Sin `frames.json` la prueba falla (no lo regenera en silencio) y una clave guardada que el test ya no renderiza también falla.
5. `npx tsx tools/offline/render/bench.ts plax` para comprobar que el coste no se dispara.

## Añadir una vista o un caso a los goldens
Edita la lista `['plax', 'psax-pm', 'a4c', 'a2c']` o el `loadCaseById` en `src/tests/goldens.test.ts`, ejecuta `npm run golden:update` y versiona el JSON resultante junto con los renders de referencia.
