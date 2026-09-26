# Misión y objetivos

## Misión

Que un ecocardiografista experto apruebe EchoTwin para enseñar ecocardiografía transtorácica a nuevas generaciones.
Para eso la imagen, la anatomía, la física del ultrasonido y la hemodinamia tienen que comportarse como en un paciente
real en cada vista estándar, en todo el ciclo cardíaco y en cada caso: lo que un experto reconoce al primer vistazo
—una bisagra que no nace de su pared, un músculo papilar que flota, una línea brillante imposible, un volumen que no
cuadra con el flujo— no puede estar en el simulador sin estar medido y declarado.

## Objetivos

Cada objetivo tiene una comprobación en el código; un objetivo que no se puede medir todavía no es un objetivo.

1. **Anatomía correcta en sus uniones.** Las estructuras vecinas se tocan donde en un corazón se tocan (bisagras
   valvulares, anillos, raíces, septos, papilares) y guardan las proporciones publicadas. Se mide en
   `src/simulator/anatomy/valveAnatomy.test.ts` (uniones, sobre el plano dibujado) y `proportions.test.ts` (medidas
   contra rangos de referencia); las excepciones viven en conjuntos `KNOWN_*` con línea base y motivo, y sólo encogen.
2. **Imagen que se lee como clínica.** Grises, contraste, textura y sector completo dentro del rango intercuartílico de
   imágenes de ventana óptima (CAMUS Good) o con la desviación declarada y su línea base
   (`src/simulator/renderer/clinicalImage.test.ts`), y comprobado a la vista junto a imágenes clínicas a la misma escala
   física.
3. **Física del ultrasonido explícita.** El speckle, los ecos especulares, la atenuación, las sombras y los artefactos
   salen del modelo acústico, no de filtros de pantalla (`docs/ULTRASOUND_PHYSICS.md`), y la GPU dibuja lo mismo que la
   CPU (`e2e/gpu-equivalence.spec.ts`).
4. **Hemodinamia coherente.** Lo que se dibuja es lo que el caso declara: volúmenes, diámetros y flujos contra la verdad
   del caso (`truthCoherence.test.ts`), el volumen latido se conserva entre ventrículos y el Doppler lee lo que el caso
   declara.
5. **Vistas que muestran lo que las define.** Cada preajuste contiene las estructuras y los hitos de su vista, desde la
   ventana que usaría un ecografista (`viewContent.test.ts`, `viewLandmarks.test.ts`, `viewQuality.test.ts`).
6. **Docencia honesta.** Las medidas y la puntuación se evalúan contra la verdad del caso, y cada defecto conocido está
   en `docs/LIMITATIONS.md` con números, para que quien enseña sepa qué no creer.

## Cómo se elige qué mejorar

La prioridad es lo que un experto vería primero y con más frecuencia al enseñar:

1. Las vistas estándar por orden de uso (A4C, PLAX, ejes cortos, A2C/A3C/A5C, subcostal) antes que las derivadas.
2. Las relaciones entre estructuras (uniones, desniveles, grosores) antes que la textura, y la textura antes que el
   pulido de la interfaz.
3. La causa antes que la compensación: si un arreglo compensa un defecto de fondo, se dice cuál es, se mide su coste y
   el defecto de fondo queda en `docs/LIMITATIONS.md` como la siguiente tarea.
4. Cada tanda de cambios termina con una revisión de contexto limpio sobre las imágenes, que reordena la lista.

## Método

El detalle está en el método de fidelidad (`.claude/skills/fidelity-method/SKILL.md`). En resumen:

- Reducir el defecto a un número antes de atribuirle una causa, medido sobre el plano que se dibuja y en el marco de
  referencia correcto, y buscar el valor normal publicado, citado en `docs/REFERENCES.md`.
- Cada defecto corregido deja una prueba permanente que falla en `main` (validación por mutación); nunca se ajusta una
  prueba ni un umbral para que pase. Un calibrado heredado se rehace con su propia regla, y se escribe cuál es.
- La deuda del modelo (`KNOWN_*`) se separa de la patología deliberada del caso (`expectedDeviations`).
- Todo lo que dibuja la CPU lo dibuja la GPU con el mismo resultado.
- Cada decisión se documenta en `docs/DECISIONS.md` con las cifras de antes y de después, lo que se probó y se
  descartó, y su coste; los defectos abiertos, en `docs/LIMITATIONS.md`.

## Límites que no se cruzan

- Los datos clínicos (CAMUS, EchoNet) no entran en git: el repositorio es público y los acuerdos de uso lo prohíben. Se
  leen de un directorio local fuera del repositorio y sólo se publican estadísticas agregadas, citando la fuente.
- Ni dependencias, ni conjuntos de datos, ni servicios de pago; ninguna credencial en el código ni en las herramientas.
- No es un dispositivo médico: sirve para enseñar la relación entre la sonda y la imagen, no para decidir sobre
  pacientes.

## Forma de trabajo

El mantenedor autoriza abrir, integrar y cerrar pull requests que sigan esta misión. Cada mejora va en su rama, con
lint, tipos, la suite completa, el build y los E2E en verde, su decisión numerada y su prueba; se integra cuando la CI
está en verde, comprobando que se integra exactamente el commit revisado. El estado de la evaluación externa está en
`docs/EVALUACION_PANEL.md` y la auditoría de fidelidad en `docs/AUDITORIA_FIDELIDAD.md`.
