# Evaluación multiparamétrica al cerrar la segunda tanda

Corte: implementación del PR110, tras integrar PR91–PR109; 4 de octubre de 2026.
Evaluación técnica interna, con código, adquisiciones sintéticas, medidas independientes
e interacción real. No equivale a validación clínica externa.

Se mantienen la escala 1–7 y los pesos de [AUDIT_AFTER_PR100.md](AUDIT_AFTER_PR100.md).
Las notas son juicio técnico sustentado, no intervalos estadísticos; 7 exige validación
profesional independiente. El número de pruebas no puntúa por sí mismo.

| Parámetro | Peso | PR100 | Cierre | Evidencia y límite |
| --- | ---: | ---: | ---: | --- |
| Arquitectura y mantenibilidad | 8 % | 5,8 | 5,9 | Rejilla temporal, historial y geometría/flujo compartidos; instantáneas explícitas por latido. Los motores de tira y núcleo siguen grandes. |
| Causalidad y procedencia | 10 % | 4,3 | 5,0 | Timestamps exactos, RR/tablas históricos y propagación contemporánea; B/M aún retienen anatomía con contacto cero. |
| Anatomía y continuidad | 12 % | 4,8 | 5,0 | AI y VI aplanado coherentes con dimensiones/volumen; seis cruces AI–aorta y colocación torácica defectuosa. |
| Mecánica cardíaca | 10 % | 4,2 | 4,3 | Conservación volumétrica con forma septal en D y balance derecho explícito; sin presión–volumen ni geometría absoluta del VD derivada de caudales. |
| Ventanas y transiciones | 8 % | 4,7 | 5,0 | SSN supina accesible en normal, sin eliminar ventanas difíciles; cuello/tráquea idealizados y limitaciones subcostales/apicales persistentes. |
| Imagen B y artefactos | 12 % | 4,1 | 4,0 | Física reducida compartida; textura sintética, deuda radial nueva y defecto B/M de acoplamiento. No RF completa. |
| Doppler y hemodinámica | 12 % | 4,4 | 5,0 | Potencia recibida continua, CW sin sombra obsoleta, TR integrada y balance derecho; apertura parcial, turbulencia y circuito vascular completo pendientes. |
| Mediciones y calibración | 8 % | 3,9 | 4,8 | Tiempo de tira y volumen geométrico corregidos, oráculo biplano contrastado con fantomas; biplanos del alumno sin emparejamiento por latido y errores por plano todavía relevantes. |
| Interfaz y accesibilidad | 6 % | 5,3 | 5,3 | Escritorio/móvil, navegación 3D, cine y controles conservados; no evaluación formal con lector de pantalla ni usuarios clínicos. |
| Rendimiento y estabilidad | 6 % | 4,3 | 4,4 | Benchmark causal con sonda en movimiento y equivalencia numérica; CPU sin garantía universal de tiempo real, GPU física no medida. |
| Docencia y criterios clínicos | 4 % | 4,5 | 5,2 | e′ por edad, FA con incertidumbre y disfunción separada de presión; evaluación nominal y exclusiones clínicas incompletas. |
| Reproducibilidad y validación | 4 % | 3,6 | 3,8 | Banco CI, mutaciones, fantomas e integración espacial independientes; aún no hay validación externa ni conjunto clínico reservado evaluado. |

## Evidencia nueva

La nota ponderada es **4,81/7 (4,8/7)**, frente a **4,50/7 (4,5/7)** tras PR100.
La mejora principal es de coherencia temporal, geometría medible y Doppler; la imagen
sigue reconociblemente sintética. La nota B baja al incorporar explícitamente el
contacto cero defectuoso y el coste de textura, sin asumir que más pruebas dan más fidelidad.

- Matriz independiente: **312 adquisiciones**, doce casos × trece vistas × fases 0/0,35,
  CPU medio, profundidad/foco recomendados, supino en SSN/subcostal y lateral izquierdo
  en apical/paraesternal, espiración. No desaparece ninguna estructura con ≥100 muestras
  en la base PR100 (excluidos fondo, pulmón y capas superficiales). Es una comprobación
  de contenido, no prueba de forma anatómica correcta ni sensibilidad diagnóstica.
- Se revisaron visualmente las 26 imágenes normales y seis HFrEF: cavidades, válvulas,
  contracción y ventanas reconocibles; persisten bordes demasiado regulares y textura
  sintética. Las revisiones específicas PR106–109 incluyen pares antes/después y ventanas difíciles.
- AI: error absoluto máximo **1,82 %** en la integración independiente final; HFrEF
  **97,765/98 mL**, antes 87,693/98. VI PH diastólico **84,540/85 mL**, antes 76,759/85.
  El máximo error VI diastólico en doce casos es 2,46 %. Estos volúmenes del clasificador
  no equivalen a precisión de mediciones biplanas hechas por un alumno.
- SSN supina normal: descendente **213/222 muestras** en las dos fases, antes cero;
  ventana difícil 2/2 y artefactos 18/12. Diez de doce casos superan 60 en ambas fases.
  Los valores difieren del ensayo de adquisición real PR109 por su protocolo de muestreo;
  ambos se documentan sin intercambiar los denominadores.
- Balance nominal derecho: residuo <0,001 mL en doce casos; en PH 50 mL pulmonares más
  24,896 mL TR. La geometría VD continúa desacoplada: HFrEF expulsa 83,20 mL geométricos
  frente a 21,81 mL anterógrados y TR no cuantificada. No se oculta con un cierre algebraico.
- Banco de fidelidad: **181 criterios cumplidos, cero excepciones conocidas en ese banco**.
  Esto no significa cero defectos: su alcance es limitado y las deudas siguientes permanecen.

### Rendimiento medido y modo M

[Datos emparejados y repeticiones](benchmarks/pr110-performance.json), Node 24.19.0,
mismo equipo tranquilo, CPU baja, 1024 px, dos segundos de calentamiento y dos medidos,
normal/PH, sonda quieta o inclinación continua ±3°, seis modalidades. Los hashes incluyen
imagen, estructuras, espectro y calibración; el tiempo total incluye calcular los hashes,
los tiempos por paso sólo `core.step`.

| Modalidad | Cambio de tiempo total (cuatro condiciones) | Equivalencia |
| --- | ---: | --- |
| B | +0,42 % | 4/4 hashes idénticos; sin mejora demostrada |
| Color | −34,73 % | 4/4 idénticos |
| PW | −9,48 % | 4/4 idénticos |
| CW | −19,34 % | 4/4 idénticos |
| TDI | −0,82 % | 4/4 idénticos; efecto pequeño |
| M | Sin conclusión de velocidad | 0/4 hashes idénticos en producción |

Las veinte condiciones comparables consumen **73,568→64,673 s (−12,09 %)** para 40 s
simulados. Una matriz no permite generalizar estadísticamente. Tres parejas alternadas
PW normal quieto confirman medianas **4,241→3,883 s (−8,42 %)** por dos segundos simulados,
con señal idéntica. No se ha alcanzado tiempo real universal.

El modo M ya ajustaba cuántas líneas físicas trazar según el tiempo de pared medido:
cuatro repeticiones de la base sin modificar también producen hashes diferentes. Una
intervención diagnóstica con presupuesto de trabajo fijo (2290 llamadas verificadas por
versión) da 4/4 pares idénticos. Esto respalda equivalencia bajo trabajo fijo, **no**
equivalencia del modo adaptativo en producción. La calidad dependiente de carga y el
caché M limitado al latido actual quedan como defectos abiertos.

La matriz independiente media, no emparejada estadísticamente, da mediana/p95 de traza
113,2/149,8 ms (base 114,3/150,7): tampoco demuestra trazado completo en tiempo real.

[Resultados agregados de la auditoría](benchmarks/pr110-audit.json) conservan las
medidas de los doce casos, comparación de estructuras, configuración y firmas del código.
Las imágenes y la matriz completa de sesión están en `/tmp/echotwin-audit-after110/`;
son evidencia local, no se presentan como archivos públicos persistentes. El banco
versionado se reproduce con `npm run fidelity:audit`; el benchmark con
`npx tsx tools/offline/validation/core-benchmark.ts /tmp/core-benchmark.json`.

### Navegador y comprobaciones de entrega

Navegación real por B, Color, PW, CW, TDI y M en escritorio 1440×900;
revisión visual de B/PW/M y móvil 390×844. Cero errores JavaScript; ancho de documento
390 px y sector 378 px, sin desbordamiento horizontal. Cadencia recibida 15,98 cuadros/s
durante ocho segundos, incluyendo fases cacheadas: no es frecuencia de trazado físico.

La suite completa pasa **1018 pruebas en 187 archivos (659,0 s)**, lint, formato, tipos,
build y presupuestos. Pasan **82 recorridos de navegador (11,4 min)**, incluidas **47
comparaciones CPU/GPU**. Los resultados finales se registran en la decisión 295 y
[la iteración 10](ITERATIONS.md); la CI del commit publicado se consulta en
[PR110](https://github.com/DanielOpazoD/echotwin-tte/pull/110). Las cuatro pruebas que
requieren GPU física permanecen omitidas en este entorno.


## Qué se completó y qué cambió de alcance

Los diez PR101–PR110 abordan los diez bloques de la auditoría anterior. Tres objetivos
siguen parciales y no deben presentarse como cerrados por tener un PR fusionado:

- PR105 resuelve potencia espectral continua sobre el haz central. La oclusión parcial
  de apertura se aplazó por coste y necesita un modelo de recepción distribuida.
- PR108 cierra el balance de flujos y cuantifica TR. No liga aún el volumen absoluto
  ni toda la contracción del VD a ese balance; la comparación geométrica conserva deuda.
- PR110 reduce trabajo repetido de consulta por latido. No sustituye el trazador por
  una simulación RF ni demuestra tiempo real a toda calidad o en cualquier dispositivo.

La corrección septal acepta un coste explícito: la intrusión torácica PH aumenta
0,5 mm en diástole y 1 mm en sístole. La normalización auricular resuelve dos cruces
posteriores pero mantiene otros seis, y añade deuda de textura medida. Ninguno de
estos cambios se cuenta como una mejora universal de anatomía o imagen.

## Próxima prioridad técnica

La primera prioridad pendiente es el acoplamiento B/M: eliminar la conversión doble
del contacto normalizado y el suelo que deja pasar anatomía sin contacto, de forma
coherente en CPU, GPU, modo M, ring-down y ruido. Después, presupuesto de trabajo reproducible y contexto histórico en modo M, geometría VD–flujo y
colocación cardíaca/pericárdica sin colisiones; recepción con apertura finita; evaluación
clínica independiente con pacientes no usados en calibración. Esta lista no sustituye
los resultados de los veinte PR ni supone que esas tareas ya estén ejecutadas.
