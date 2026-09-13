---
name: fidelity-method
description: Método de trabajo para mejorar la fidelidad anatómica y acústica del simulador EchoTwin (modelo implícito del corazón, vistas ecocardiográficas, imagen, navegador 3D). Úsalo siempre que trabajes en este repositorio sobre anatomía, posición de estructuras, planos o ventanas de vista, realismo de la imagen (brillo, speckle, contraste), el navegador 3D, calibración de consola o comparación con ecocardiogramas reales (CAMUS, EchoNet-Dynamic), y también cuando alguien describa un defecto visto en una captura aunque no mencione la palabra fidelidad.
---

# Método de fidelidad — EchoTwin

Este método existe porque casi todos los errores de una sesión larga sobre la fidelidad del simulador tuvieron la misma forma: afirmar algo a partir de una imagen, de un plano equivocado o de una firma supuesta, en vez de medirlo. Cada regla viene de un error real.

## Reglas

1. **Reduce el defecto a un número antes de atribuirle una causa.** Una captura muestra un síntoma, no su origen. Diagnósticos hechos a ojo que resultaron falsos: una sonda construida al revés que se explicó como escorzo de cámara; una válvula pulmonar declarada «nunca dibujada» que existía (1,19% de los puntos alrededor del anillo); una línea entre aurícula y ventrículo derechos atribuida a grasa epicárdica cuando era la pared auricular atravesando el orificio tricuspídeo. Mide con el contador de estructuras por vista, perfiles a lo largo de líneas de barrido o cajas envolventes en Node.

2. **Mide sobre el plano que se dibuja, no sobre el que se pide.** El plano real sale de `canonicalControl → poseFromControl → beamFrameFromPose`; `canonicalPlane` es sólo el objetivo de la vista y puede distar 48°. Medir contra el canónico predijo mejoras que el render no mostró.

3. **Comprueba el marco de referencia.** Tórax: +x izquierda del paciente, +y superior, +z anterior. En el marco del corazón, z es base–ápex y está inclinado respecto al cuerpo, así que «1,5 cm más alto» es craneocaudal en el tórax; aplicarlo en el eje del corazón dejó la válvula pulmonar a la derecha de la aorta. Descompón las relaciones en componentes: una distancia escalar puede cumplirse en la dirección equivocada, y una medida escrita en el marco equivocado acusa al código correcto.

4. **Lee las firmas antes de usarlas.** Nombres de función, formas de retorno y rutas de módulo se leen en el código antes de escribir un script: `analyzeView` y no `assessView`; `useHudStore` expone `{ hud }` y la fase es `hud?.phase`; `canonicalPlane` devuelve coordenadas de tórax. Suponerlas costó varios intentos fallidos.

5. **Atribuye cambios comparando contra HEAD en un `git worktree` aislado**, nunca contra una medición intermedia que ya incluye el cambio.

6. **Con la máquina cargada, los E2E no son interpretables.** Mira `uptime`; si la carga es alta, vuelve a correr sólo lo que falla y compara contra HEAD antes de culpar al cambio. Espera a que baje antes que commitear sin verificar.

7. **Cada clase de defecto se convierte en prueba permanente, validada por mutación.** Vacía la lista de limitaciones conocidas y confirma que la prueba falla exactamente donde debe; si no falla, es vacua. Una limitación declarada que ya no falla debe detectarse como obsoleta, porque desactiva un requisito que sí se cumple. Si el defecto se ve en la app, la prueba debe recorrer la cadena de la app (`SimulatorCore` con `core/baseInput.ts`): la primera prueba de la puntuación de ganancia analizaba un cuadro estático con otra semilla y otra fase, y pasaba también con el umbral antiguo.

8. **No ajustes una prueba para que pase.** Si una prueba de física depende de la posición de la anatomía, desacóplala sin rebajar lo que exige —por ejemplo, anclando las bandas de medida al tejido y no a profundidades fijas—. Probar parámetros hasta que el test pase es maquillaje.

9. **Separa deuda del modelo de patología intencionada.** `KNOWN_MODEL_LIMITATIONS` (en `proportions.test.ts`) y `KNOWN_VIEW_LIMITATIONS` (en `viewContent.test.ts`) son deuda del modelo, con su entrada en `docs/LIMITATIONS.md`; `expectedDeviations` es la patología deliberada del caso. Mezclarlas disfraza un defecto de característica del paciente.

10. **Deriva los landmarks de los anclajes.** Un landmark clavado en coordenadas fijas se queda atrás cuando la anatomía se mueve: el del TSVD acabó en pericardio y tumbó 26 E2E.

11. **Sabe qué llega solo a la GPU.** Los anclajes pasan al sombreador por `paramLayout.ts` y la compensación de consola por `consoleCompensation()`. Todo lo replicado a mano en GLSL debe pasar `e2e/gpu-equivalence`.

12. **Revisa los calibrados heredados.** Umbrales y ventanas ajustados sobre una anatomía defectuosa se rompen al corregirla. Documenta el valor nuevo como propiedad de la geometría en lugar de devolver la anatomía a una posición imposible para salvar un umbral.

13. **Calibra contra la ventana óptima.** La referencia son imágenes clínicas de alta calidad (CAMUS Good), porque son las que se aprende a reconocer y porque una imagen pobre lo es por causas que la consola no modela: mezclar la ventana difícil con CAMUS Poor sesgó el primer barrido de consola. Lo pobre se imprime como información y no vota.

14. **Que las medianas coincidan no significa que la imagen parezca clínica.** Tras calibrar, pon la imagen del simulador junto a varias clínicas a la misma escala física (mm por píxel). Con 16 de 20 estadísticas dentro del rango clínico seguían viéndose un speckle de grano fino, un miocardio hecho de dos líneas especulares, un entorno gris uniforme y bandas imposibles en el A2C. La hoja con imágenes clínicas se genera sólo en el scratchpad: no se commitea ni se envía.

15. **Los E2E prueban `dist/`, no el código.** `playwright.config.ts` sirve la app con `vite preview`, que publica el último build sin reconstruir, y reutiliza un servidor que ya esté escuchando. Corridos sin `vite build` delante, dieron 42 verdes sobre un build viejo mientras la GPU seguía dibujando una pared auricular que el clasificador de CPU ya no emitía (decisión 64 sin espejo en `glslHeart.ts`). Construye siempre antes de los E2E.

16. **Valida la métrica antes de calibrar contra ella, y mira el resultado.** Pásala por un fantoma de verdad conocida, variando lo que no debería importar: el estimador de la celda de speckle leía el grosor de la pared (una PSF de 3 mm medía 1,62 mm en 9 mm de pared y 2,05 en 20). Y un ajuste que iguala las cifras puede ser falso a la vista: ensanchar la PSF dejó 24 de 32 valores en rango clínico con nulos en forma de gusano y sangre granulosa. Compara recortes ampliados a la misma escala física antes de aceptar un modelo.

## Herramientas

- `npx tsx tools/offline/render/slice-map.ts <salida> <vistas> [caso]` — mapa de estructuras por plano.
- `npm run measure -- <caso>` — medidas del modelo, incluidas las relaciones espaciales entre anillos valvulares.
- `npx tsx tools/offline/render/audit-views.ts` — desviación de plano, rotación y centrado por vista.
- `PHASES=0,0.35 npx tsx tools/offline/render/render-views.ts <salida> <vistas> [caso]` — imágenes.
- `src/simulator/windows/viewContent.ts` — fracción del sector que ocupa cada estructura sobre el plano dibujado.
- `CAMUS_DIR=<fuera del repo> npx tsx tools/clinical/camus-compare.ts --limit 500 [--sweep-console] [--out stats.json] [--reference-out src/clinical/reference-values/camusImageStats.ts]` — comparación región a región con CAMUS; el barrido puntúa sólo la ventana óptima contra Good, y `--reference-out` regenera la referencia que usa `clinicalImage.test.ts`.
- `src/simulator/renderer/clinicalImage.ts` — `renderApical` y `presentApical`: la imagen apical del simulador tal como la mide la comparación clínica; úsala en pruebas en vez de rehacer la cadena.
- Los scripts de medición temporales van en el scratchpad de la sesión, fuera del repositorio, y se ejecutan con `npx tsx <script>` desde la raíz del repo: el alias `@/` lo resuelve el `tsconfig.json` del directorio actual. Un script que importa un `*.test.ts` falla fuera de vitest; copia lo que necesites. No crees `scratchpad/` dentro del repositorio.

## Comparación con ecocardiogramas reales

- **CAMUS primero.** Acceso abierto, resolución nativa y segmentaciones por región (endocardio, epicardio y aurícula izquierda del VI): es la fuente adecuada para textura de speckle y contraste tejido/sangre por estructura.
- **EchoNet-Dynamic después.** Son 10.030 vídeos A4C, pero reescalados a 112×112, lo que destruye la estructura del speckle; úsalo sólo para histogramas y variedad.
- **Los datos clínicos no entran en git.** El repositorio es público y los acuerdos de uso lo prohíben: se leen de un directorio local fuera del repositorio mediante una variable de entorno, y sólo se commitean estadísticas agregadas, nunca imágenes ni fotogramas. Cita el artículo de CAMUS (IEEE TMI) al usarlo.
- Los registros y la firma de acuerdos los hace el usuario; no introduzcas credenciales.

## Antes de commitear

1. `npm run lint` y `npx tsc --noEmit -p tsconfig.json` limpios.
2. `npx vitest run --testTimeout=180000 --maxWorkers=3` en verde. Si cambias anatomía, revisa la imagen afectada antes de `npm run golden:update`.
3. `npx vite build` y después `npx playwright test`, en verde y con la máquina tranquila (regla 15).
4. Documenta la decisión con sus números en `docs/DECISIONS.md` y los defectos abiertos en `docs/LIMITATIONS.md`, incluidos los errores propios que la medición destapó.
5. El mensaje de commit termina con la línea `Co-Authored-By` que indique el sistema.
