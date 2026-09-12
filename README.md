# EchoTwin — simulador de ecocardiografía transtorácica

Simulador educativo de ecocardiografía transtorácica que corre entero en el navegador. La imagen no
es un vídeo grabado ni un atlas de fotogramas: cada cuadro se traza contra un **modelo anatómico
implícito** del tórax y del corazón, en la pose exacta en que está la sonda y en la fase exacta del
ciclo cardíaco. Mover la sonda un grado cambia la imagen como cambiaría en un paciente.

> ### Aviso
> **No es un dispositivo médico y no debe usarse para decidir nada sobre un paciente real.** Sirve
> para enseñar la relación entre la posición de la sonda y la imagen que aparece. Todos los
> «pacientes» son sintéticos y paramétricos: no hay datos de personas reales, ni imágenes clínicas,
> ni estudios DICOM en este repositorio. El modelo tiene defectos conocidos y medidos, listados en
> [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — léelos antes de usarlo para docencia.

## Cómo se forma la imagen

1. **Anatomía implícita** (`src/simulator/anatomy/`): corazón y tórax como campos de distancia con
   parámetros clínicos (volúmenes, espesores, diámetros anulares). Una sola función, `classifyHeart`,
   dice qué estructura y qué tejido hay en cada punto del espacio.
2. **Ciclo cardíaco** (`src/simulator/cardiac-cycle/`): tablas de volumen, flujo y apertura valvular
   por fase; el movimiento es volumétrico, no una escala de la figura.
3. **Formación acústica** (`src/simulator/renderer/`): cada muestra aporta una señal compleja
   (retrodispersión con anisotropía miocárdica y dispersores anclados al tejido, más el eco especular
   de las interfaces), a la que se aplica una PSF separable con foco dinámico antes de detectar la
   envolvente. El speckle sale de ahí, no de un filtro de ruido sobre la pantalla.
4. **Consola y presentación**: compensación de ganancia, compresión logarítmica, persistencia y
   conversión de barrido. Con WebGL2 toda la cadena corre en la GPU y sólo se lee de vuelta un cuadro
   empaquetado; sin WebGL2 el mismo camino corre en CPU, y una prueba de equivalencia exige que
   coincidan con ≤ 1 nivel de gris.

Hay además Doppler color, pulsado, continuo y tisular, modo M, medidor con evaluación de la técnica,
navegador 3D del tórax con el corazón mallado desde el mismo modelo que corta el haz, y una capa
instruccional con tareas, causas y un informe estructurado.

## Ejecutar

```bash
npm install
npm run dev
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run check` | lint + tipos + pruebas unitarias + build |
| `npm run test:e2e` | pruebas de extremo a extremo (Playwright) |
| `npm run measure -- <caseId>` | 44 medidas del modelo contra rangos de referencia |

Necesita Node 20+. El navegador debe soportar WebGL2 para la cadena en GPU; sin él todo sigue
funcionando en CPU, más despacio.

## Documentación

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — cada decisión de diseño con las mediciones que la
  motivaron, incluidos los callejones sin salida y los errores corregidos.
- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — qué no simula y qué está mal, con números.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — capas, flujo de datos y tiempos medidos.
- [`docs/VALIDATION_PROTOCOL.md`](docs/VALIDATION_PROTOCOL.md) — protocolo de validación externa
  preregistrado. **Ningún estudio de validación se ha ejecutado todavía.**

## Estado

En desarrollo activo. La fidelidad se mide, no se declara: hay defectos anatómicos abiertos y
cuantificados (por ejemplo, el eje corto de grandes vasos no muestra la válvula pulmonar porque el
plano alcanzable desde la ventana intercostal se desvía 48° del pedido). Están todos en
`docs/LIMITATIONS.md`.

## Licencia

MIT — ver [`LICENSE`](LICENSE).
