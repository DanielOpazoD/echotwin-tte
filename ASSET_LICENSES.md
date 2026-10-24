# Licencias de activos y dependencias

## Activos
**No hay activos de terceros.** Todo lo que se ve y se oye es procedimental y se genera en tiempo de ejecución:
- Imagen ecográfica: trazador por reglas sobre modelos analíticos (`src/simulator`), ruido determinista por semilla.
- Torso 3D: geometría construida en código con three.js (`src/ui/TorsoView.tsx`); sin mallas, texturas ni imágenes.
- Audio Doppler: osciladores de `AudioContext` (`src/simulator/doppler/audio/dopplerAudio.ts`); sin grabaciones.
- Exportación «Guardar PNG»: compone imagen + overlays y estampa «SYNTHETIC TRAINING — EchoTwin TTE — no diagnóstico» (`src/app/exportImage.ts`); es la única salida de imagen de la app.
- ECG: suma de gaussianas (`src/simulator/cardiac-cycle/ecg.ts`).
- PNG offline: codificador propio (`tools/offline/render/png.ts`, zlib de Node).
- `public/` contiene sólo `manifest.webmanifest` (sin iconos); `.gitignore` reserva `public/atlas/*.bin` para atlas futuros que hoy no existen.
- `dist/`, `test-results/` y `playwright-report/` son salidas de build y de pruebas ignoradas por git; la CI instala Chromium con `playwright install` sólo para las pruebas E2E.
- No hay datos de pacientes: los 12 casos de `src/cases` son sintéticos y sus historias lo declaran.

## Fuentes
Inter y JetBrains Mono **se incluyen en el bundle** (decisión 198): `src/main.tsx` importa `@fontsource-variable/inter` y `@fontsource-variable/jetbrains-mono`, cuyos `@font-face` y archivos `woff2` sirve la propia app; no hay peticiones a CDN. Ambas fuentes se distribuyen bajo la **SIL Open Font License 1.1** (Inter: © The Inter Project Authors; JetBrains Mono: © The JetBrains Mono Project Authors), que permite incluirlas y redistribuirlas con la aplicación siempre que se conserve su licencia y no se vendan por separado. El texto de la licencia viaja en `node_modules/@fontsource-variable/*/LICENSE`; una distribución de la app fuera del repositorio debe acompañarlo. La pila de respaldo (`'Segoe UI', system-ui…` y `'SF Mono', Menlo…` en `src/app/styles.css`) sólo se usa si la carga falla.

## Dependencias npm (versiones exactas en `package.json`; licencia leída de `node_modules/*/package.json`)
| Paquete | Versión | Licencia | Uso |
|---|---|---|---|
| @fontsource-variable/inter, @fontsource-variable/jetbrains-mono | 5.3.0 | OFL-1.1 | tipografía |
| react, react-dom | 19.3.0 | MIT | UI |
| three | 0.186.0 | MIT | torso 3D |
| zustand | 5.0.15 | MIT | estado |
| zod | 4.6.7 | MIT | validación de casos |
| vite, @vitejs/plugin-react | 7.3.6, 5.2.0 | MIT | build/dev |
| vitest, @vitest/coverage-v8 | 4.1.11 | MIT | pruebas |
| typescript | 5.9.3 | Apache-2.0 | tipos |
| typescript-eslint, eslint, @eslint/js, eslint-plugin-react-hooks, globals | 8.70.0, 9.39.5, 9.39.5, 7.1.1, 16.3.0 | MIT | lint |
| prettier | 3.9.6 | MIT | formato |
| tsx | 4.20.5 | MIT | scripts offline |
| jsdom | 30.0.1 | MIT | entorno de las pruebas de UI (`@vitest-environment jsdom`) |
| @playwright/test | 1.63.0 | Apache-2.0 | E2E (14 archivos en `e2e/`) |
| @types/react, @types/react-dom, @types/three, @types/node | 19.3.0, 19.3.0, 0.185.4, 22.20.2 | MIT | tipos |

Sólo react, react-dom, three, zod, zustand y las dos fuentes llegan al bundle de producción; el resto son herramientas de desarrollo. Las dependencias transitivas se listan en `package-lock.json`; no se ha ejecutado una auditoría de licencias transitivas.

## Código de terceros estudiado
Ninguno de los repositorios de `docs/THIRD_PARTY_REVIEW.md` (i4h-sensor-simulation, UltraG-Ray, OpenBCSim, PyMUST, moculus) está copiado, vendorizado ni enlazado. Si en el futuro se reimplementa COLE (OpenBCSim, BSD-3) habrá que añadir su atribución aquí.

## Guías clínicas
No se reproducen tablas ni texto de las guías; sólo cortes numéricos concretos con su `referenceId` (`src/clinical/reference-values`). Ver `docs/REFERENCES.md`.

## Licencia de este proyecto
MIT: archivo `LICENSE` y campo `"license": "MIT"` de `package.json` (que además declara `"private": true`, para no publicarlo en npm).

## Cómo se verificó
- `grep` sobre `src/` e `index.html` en busca de `url(`, `@import`, extensiones de imagen/fuente/audio, `fetch(` y `new Audio`: la única coincidencia es la creación de `AudioContext` en `dopplerAudio.ts`.
- `find public tools -type f`: sólo `manifest.webmanifest`, los tres scripts de `tools/offline/render` y `tools/offline/atlas-generation/build-atlas.ts` (hojas de contacto PNG de los cines procedimentales).
- Licencias leídas de `node_modules/<paquete>/package.json` el 2026-09-10 (para `three` y `@vitejs/plugin-react` mediante `grep` porque su campo `exports` bloquea `require('…/package.json')`).

## Qué actualizar si…
- …se añade un atlas pre-generado en `public/atlas/*.bin`: documentar aquí su origen (siempre sintético) y tamaño.
- …se añaden otras fuentes web: añadir aquí su licencia y el mecanismo de carga, como las dos actuales.
- …se reimplementa COLE u otro algoritmo de `docs/THIRD_PARTY_REVIEW.md`: añadir la atribución BSD/Apache y el aviso NOTICE que corresponda.
- …se añaden iconos al manifiesto: hoy `icons: []`.
