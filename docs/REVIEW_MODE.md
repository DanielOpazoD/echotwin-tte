# Modo revisión

Herramienta de mejora continua (decisión 134): quien mira la imagen señala sobre ella lo que ve mal, y quien
cambia el modelo recibe el estado exacto para reproducir ese cuadro. Funciona en los dos sentidos: el usuario
informa a Claude y Claude informa al usuario con el mismo formato.

## Cómo se usa en la app

1. Activa el modo con la tecla **R** o en el menú ⋯ → «Modo revisión» (no disponible en modo examen).
   Aparece la pestaña **Revisar** en la consola y una línea magenta sobre la imagen.
2. **Clic sobre la imagen** deja un marcador numerado. Debajo del marcador la app escribe lo que el modelo
   tiene ahí: la estructura y el tejido del clasificador, la posición polar (profundidad y ángulo), las
   coordenadas en el marco del corazón, el nivel y acimut del ventrículo y, cerca de la raíz aórtica, la altura
   sobre el anillo. La primera lectura sale del mapa de estructuras del cuadro; la completa la calcula el
   worker con el mismo clasificador que formó el píxel. Sobre una tira (PW, CW, TDI, modo M) el marcador guarda
   la columna y la velocidad o profundidad.
   **Shift+clic** conserva el comportamiento normal (caja de color, cursor, herramientas de medición).
3. En la pestaña Revisar, escribe en cada marcador qué está mal y elige una categoría (anatomía, movimiento,
   textura, Doppler, vista, interfaz, otro). La nota general es para lo que no cabe en un punto.
4. **Copiar informe** copia al portapapeles un texto listo para pegar en el chat: las líneas legibles (caso,
   paciente, sonda, vista reconocida, consola, fase) seguidas de un bloque JSON con el estado exacto del
   simulador. **Copiar imagen** copia el PNG con los marcadores (o lo descarga si el navegador no permite
   copiar imágenes). **Descargar PNG** guarda la imagen.
5. **Cargar un informe**: pega un informe (tuyo o de Claude) y la app restaura el caso, el paciente, la sonda,
   la modalidad y la consola, y muestra los marcadores con sus notas. Un cine congelado no se restaura: el
   cuadro se reproduce en vivo con la misma sonda y consola.

## Mover, seleccionar, borrar, deshacer

- **Arrastra** un marcador sobre la imagen para moverlo: la lectura del modelo se recalcula al soltarlo.
- **Clic** en un marcador (o en su tarjeta del panel) lo selecciona: anillo blanco en la imagen, tarjeta resaltada.
- **Supr** o **Retroceso** borra el marcador seleccionado; **Ctrl+Z** (⌘Z) lo recupera; **Esc** deselecciona.
  Las teclas no actúan mientras escribes en un campo de texto.
- **Congelar al poner el primer marcador** (activo por defecto): al marcar sobre una imagen en vivo la app congela,
  así los marcadores conservan el cuadro en que se pusieron; con Espacio vuelves a vivo. Cada marcador guarda de
  todos modos la fase de su propio cuadro.

## Puntos secundarios

Un marcador principal puede tener uno o más **puntos secundarios**: sitios que muestran el mismo tipo de problema
o cuya relación con el principal se quiere poner en evidencia. Se crean con **Alt+clic** (imagen o torso) teniendo
seleccionado el principal, o con el botón «+ Punto secundario» de su tarjeta, que deja el modo armado hasta Esc.
Se numeran con la letra del principal (1a, 1b…), se unen a él con una línea en la imagen y en el 3D, heredan su
categoría, admiten una nota propia y el informe añade la distancia de cada uno al principal (en el tórax cuando
el modelo los ha situado, si no en el plano de imagen). Borrar el principal borra sus secundarios (Ctrl+Z recupera
el grupo); borrar un secundario deja el principal.

## Marcar el modelo 3D

En modo revisión, un **clic sin arrastre** sobre el torso 3D deja un marcador en la superficie tocada: miocardio
del VI o del VD, cavidades, aurículas, válvulas, grandes vasos, piel o hueso (con el corte activo, la mitad
retirada del corazón no cuenta). El marcador muestra el punto en el torso y, con la respuesta del worker, la
estructura y el tejido del clasificador en ese punto, las coordenadas del corazón y **la distancia al plano de
imagen**, que dice si lo señalado está en el corte que ves o fuera de él. Arrastrar sigue deslizando la sonda.
Los marcadores 3D aparecen como esferas magenta con su número sobre el modelo, y en el informe con el prefijo «3D».

Los marcadores viven en la sesión (no se guardan al recargar). El modo revisión se apaga al entrar en examen.

## Cómo lo reproduce Claude

```bash
npm run review:render -- informe.md
```

`tools/offline/review/render-report.ts` lee el bloque JSON del informe, construye los modelos del caso con el
paciente del informe, coloca la sonda con el mismo control, forma el cuadro con el trazador CPU al mismo tamaño,
calidad y fase (y 0,15 del ciclo antes y después, más un cuadro por cada fase distinta en la que se puso un
marcador: cada marcador guarda la fase de su propio cuadro, y una pared que estaba bajo el clic a 0,70 ya se
movió a 0,56), dibuja los marcadores y escribe una hoja de verificación con, para cada marcador, lo que vio
quien marcó y lo que el clasificador devuelve en esa posición a esa fase. Como el render es
determinista por semilla, el cuadro es el mismo que vio el usuario salvo por la GPU (equivalente por estructura,
`e2e/gpu-equivalence.spec.ts`).

## Cómo informa Claude

Claude genera informes en el mismo formato con `author: "claude"`: escribe el JSON a partir de un estado que ha
medido offline (caso, control de sonda, consola, fase) y de los puntos que quiere señalar, y el usuario lo pega
en «Cargar un informe». Así una observación como «la vena hepática entra en el sector a 9,6 cm y −17°» se ve en la
app exactamente donde Claude la midió.

## Formato

`ReviewReport` (`src/app/review.ts`): `format: "echotwin-review"`, `version`, `createdAt`, `author`, `caseId`,
`caseTitle`, `mode`, `workerMode`, `input` (el `SimInput` completo: sonda, paciente, ajustes, modalidad, color,
espectral, cursor y compuerta, calidad, tamaño de pantalla, backend, anulaciones de artefactos), `frame` (id,
fase, tiempo, latido, FC, análisis de vista, backend), `note` y `markers` (`ReviewMarker`: número, píxel y
mapeo del sector en que se puso, posición polar o de tira, estructura del mapa del cuadro, lectura del worker
`ProbePointInfo`, nota y categoría). El protocolo del worker añade la petición `probePoint`
(`src/simulator/core/probePoint.ts`).
