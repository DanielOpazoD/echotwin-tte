# Auditoría de fidelidad y arquitectura (2026-09-11)

Primera tarea del plan de alta fidelidad: auditar el simulador antes de cambiarlo. Se apoya en la evaluación del panel (`docs/EVALUACION_PANEL.md`, commit `8919703`) y añade inventario de arquitectura, medidas de rendimiento en CPU y GPU, comparación conceptual con HeartWorks, Vimedix, U/S Mentor y SonoSim, hoja de ruta y propuesta de arquitectura.

## Evidencia nueva de esta auditoría

**Inventario** (líneas de código fuente sin pruebas):

| Módulo | Líneas | Pruebas | Comentario |
|---|---|---|---|
| `simulator/anatomy` | 2 798 | 249 | `heartModel.ts` tiene 1 606 líneas: geometría, pose, clasificación y referencias en un solo archivo |
| `simulator/renderer/gpu` | 1 709 | E2E | Espejo GLSL del clasificador (657 líneas) mantenido a mano |
| `ui` | 2 379 | E2E | `DisplayCanvas.tsx` (587) mezcla dibujo, overlays y herramientas |
| `simulator/core` | 1 106 | 128 | `simulatorCore.ts` (869) orquesta reloj, render, color, strips, ECG, análisis y composición |
| `simulator/doppler` | 774 | 405 | Campo de flujo paramétrico |
| `education` + `scoring` | 876 | 302 | Currículo, técnica, examen |
| `simulator/windows` + `view-recognition` | 845 | 94 | Vistas canónicas y score |
| Resto (casos, clínica, ciclo, sonda, medidas, app) | ~4 900 | ~440 | — |

Pruebas: 132 unitarias, 34 E2E (21 de equivalencia CPU↔GPU). Build: 654 KB de aplicación, 540 KB de three.js y 172 KB del worker.

**Rendimiento medido** (Apple M4 con carga media de 26 por otras aplicaciones, así que son cotas altas):

| Ruta | Coste por cuadro (mediana / p90) |
|---|---|
| Trazador CPU en Node, tier medio (119×224) | 47 ms render + 2,9 ms consola + 8,9 ms conversión (≈ 10 ms de render documentado sin carga) |
| Worker con WebGL2 directo, tier medio | 11 / 19 ms render (incluye `readPixels` síncrono); paso completo 27 / 51 ms |
| Worker con WebGL2 directo, tier alto (161×320) | 17 / 27 ms render; consola 7–10 ms; paso 33 / 50 ms |
| Worker con atlas, sonda quieta o moviéndose ±1° junto a un ancla | 0,7 / 1,7 ms render (**imagen almacenada, no la de la pose**); paso 15 / 23 ms |
| Composición (conversión de barrido a RGBA + ECG + estadísticas) en el worker | 9–26 ms |
| Interfaz (rAF) | 60 fps |

Hallazgo de rendimiento clave: el atlas existe para ahorrar render, y ese ahorro es exactamente la zona muerta. Con la sonda oscilando ±1° junto a un ancla, el atlas devolvió la imagen almacenada con peso de relleno 0 (medido en la app con GPU). La conversión de barrido y la consola en CPU cuestan tanto como el render en GPU, y el `readPixels` síncrono obliga a esperar a la GPU en cada cuadro.

## A. Evaluación 1–7

| Dominio | Nota | Base de la nota |
|---|---|---|
| Anatomía | 3 | VI «bala» y VD en semiluna sin primitivas; aurículas elipsoidales de pared brillante, VCI/venas/TSVD/tronco como cápsulas y conos, papilares desprendidos en eje corto, sin arco aórtico |
| Proporciones | 5 | 44 medidas del caso normal dentro de rangos ASE/EACVI y coherentes entre planos; AI en el límite alto |
| Movimiento | 4 | Volumétrico y acoplado a una sola fase (MAPSE, engrosamiento por conservación de masa, TAPSE, aurículas); sin torsión, respiración ni FA por latido; cierre mitral en diástasis |
| Válvulas | 3 | Mitral con coaptación lineal y festones, aórtica con signo de Y; segmentos rígidos; tricúspide y pulmonar esquemáticas |
| Relación sonda–imagen | 3 | Seis grados de libertad continuos en el modelo; la imagen por defecto no cambia con ±3° o ±3 mm y se duplica entre 4° y 8° |
| Continuidad entre planos | 4 | Un solo volumen, sin geometría por vista; en pantalla, mezcla de anclas y saltos |
| Realismo ecográfico | 2 | Render iluminado: bandas brillantes, contornos especulares gruesos, sangre negra, caras planas de pulmón |
| Speckle | 2 | Ruido de valor filtrado: SNR 3,6 (Rayleigh 1,9), celda lateral 0,3 mm isótropa, estrías por desenfoque después de la compresión logarítmica |
| Artefactos | 3 | Sombra por transmisión y reverberación pulmonar causales; lóbulos laterales y espejo inoperantes; sin refuerzo, cola de cometa ni sombra de calcio visible |
| Controles | 4 | Ganancia, TGC, profundidad, foco, frecuencia, armónicos, rango dinámico, sector, zoom, persistencia; Nyquist sin límite físico, sin dúplex, ECG no sincronizado con el barrido |
| Rendimiento | 3 | UI a 60 fps y GPU funcional, pero cuadro de imagen de 27–50 ms bajo carga con conversión de barrido y consola en CPU, lectura síncrona de GPU y un atlas que compra rendimiento a costa de la fidelidad |
| Arquitectura de software | 4 | Capas, worker con protocolo tipado, determinismo por semilla, pruebas unitarias, E2E y de equivalencia; clasificador duplicado CPU/GLSL, archivos-dios (`heartModel.ts`, `simulatorCore.ts`), consola que mezcla resolución, artefactos y presentación |
| Potencial de escalabilidad | 4 | Patologías como parámetros de un motor común e interfaz de backend de render; cada cambio anatómico se hace dos veces, la cadena de imagen no es GPU de extremo a extremo y no hay generador de pacientes ni biblioteca de referencias |

Promedio 3,5. Los dominios críticos para el criterio de éxito (realismo ecográfico, speckle y relación sonda–imagen) están en 2–3.

## B. Los 10 problemas que más reducen el realismo

1. **El speckle no nace de una PSF.** Es ruido de valor en coordenadas materiales, y la resolución lateral se simula desenfocando la imagen ya comprimida: celdas isótropas de 0,3 mm y estrías radiales en lugar de celdas alargadas lateralmente que crecen con la profundidad.
2. **La ecogenicidad es de dibujo.** Banda especular de ±1,6 mm en todas las interfaces sea cual sea el ángulo, miocardio saturado y homogéneo, sangre en negro absoluto y suelo de ruido invisible hasta 12 cm.
3. **La imagen mostrada no es la de la pose actual.** El atlas sirve anclas almacenadas hasta ±3° o ±3 mm, mezcla dos poses entre 4° y 8° y cuantiza el movimiento a 32 fases.
4. **El tórax tiene caras planas.** Pulmón y mediastino limitados por planos (bordes negros rectos en PLAX, ejes cortos y subcostal) y reverberación pulmonar en escaleras nítidas dentro de ventanas excelentes.
5. **Las aurículas y las venas son primitivas.** Elipsoides de pared brillante que dominan las apicales; VCI, venas pulmonares, TSVD y tronco como cápsulas y conos rígidos.
6. **No hay anisotropía miocárdica.** La pared lateral en A4C brilla como el septo; los papilares son discos separados de la pared y el VD no se reconoce en eje corto.
7. **Las vistas no emergen bien.** El eje del PLAX queda inclinado 31°, PSAX-MV y A5C dejan fuera sus estructuras, la subcostal 4C no se reconoce, no hay supraesternal y la ventana difícil es negra.
8. **El Doppler color no tiene flujo de cavidad** y los valores cuantitativos son erróneos (TDI al 40 %, CW de 1,27 frente a 4,69 m/s, PW +19 %).
9. **Faltan fenómenos del movimiento real**: torsión, traslación respiratoria, variación latido a latido en FA y apertura mitral residual en diástasis.
10. **La máquina no se comporta como una máquina.** La ganancia alta no satura, el ruido no crece con la profundidad, la escala de Nyquist ignora la profundidad y el ECG no acompaña al barrido.

## C. Qué incorporar de los simuladores de referencia (conceptos, no implementaciones)

| Concepto | Dónde se ve | Cómo encaja aquí |
|---|---|---|
| Vista docente sincronizada: torso + corazón 3D + sonda + sector ecográfico + imagen | HeartWorks, Vimedix, U/S Mentor | Ya existe el torso con sonda; falta dibujar el sector y el plano de corte sobre el corazón, con etiquetas de las estructuras intersectadas |
| Capas de anatomía: transparencia, retirar capas, etiquetas, resaltar la estructura seleccionada en 3D y en la imagen | HeartWorks | Los mapas de estructura por muestra ya permiten la correspondencia 3D ↔ imagen |
| Ventana acústica condicionada por costillas, pulmón e hígado | Vimedix | El tórax existe; hay que quitarle las caras planas y hacer que la calidad de imagen dependa de la ventana de forma gradual |
| Métricas objetivas de adquisición: tiempo hasta la vista, recorrido de la sonda, correcciones, desviación angular del plano objetivo, calidad de imagen | Vimedix, U/S Mentor | El score por componentes existe; faltan trayectoria, eficiencia y referencia de expertos |
| Tareas guiadas con retroalimentación automática | U/S Mentor, HeartWorks | Currículo existente; las tareas deben exigir adquisición manual |
| Biblioteca de patologías sobre un modelo común | HeartWorks, Vimedix | Ya es la arquitectura de casos; ampliar sólo cuando el normal cumpla |
| Diversidad de pacientes | SonoSim, U/S Mentor (datos reales) | Generador paramétrico de pacientes con distribuciones (habitus, posición y rotación cardíaca, profundidad, tamaños) |
| Referencias reales para juzgar la imagen | SonoSim, U/S Mentor | Banco de métricas de imagen contra clips con licencia adecuada, como validación, no como fuente de la imagen |
| Sonda física asequible | SonoSim (sonda con sensores de movimiento) | Adaptadores de entrada: ratón y teclado (existe), mando o ratón 3D, teléfono como sensor de orientación |
| Doppler y modo M sobre la misma anatomía | Vimedix, HeartWorks | Ya existe; hay que calibrarlo |

## D. Qué NO copiar

- **Contenido propietario**: mallas, texturas, loops, casos, textos del currículo, interfaz y marcas de cualquiera de los cuatro productos.
- **Datos de pacientes ajenos**: los volúmenes grabados de SonoSim o U/S Mentor, o cualquier conjunto de datos sin licencia verificada.
- **La reproducción de volúmenes grabados como núcleo del render.** Da textura real, pero limita la exploración al volumen adquirido, congela la fisiología en el loop grabado y rompe el objetivo de un corazón 4D explorable y paramétrico.
- **El hardware**: maniquíes con seguimiento electromagnético. No es replicable en web y no es lo que enseña la ecografía.
- **Ayudas que llevan a la vista perfecta** activadas por defecto (conos objetivo, imanes): sólo como ayuda docente desactivable y nunca en examen.
- **Fórmulas de puntuación comerciales**: no son públicas ni están validadas para este modelo; hay que construir y validar las propias.
- **Etiquetas o dibujos quemados en la imagen ecográfica**: las ayudas deben ser capas separadas.
- **Simulación de onda completa** (k-Wave, Field II) en tiempo real: no es viable en navegador y ningún simulador comercial la hace; la cadena por etapas es la aproximación correcta.

## E. Hoja de ruta priorizada

Ordenada por impacto en el criterio de éxito, por dependencias y por coste. Cada iteración cierra con pruebas, revisión visual y documentación. Ninguna vista se da por terminada con menos de 6/7 en los dominios críticos de la matriz de validación, y no se añaden patologías hasta que el corazón normal cumpla.

| # | Iteración | Fase del plan | Qué cambia | Criterio de aceptación medible |
|---|---|---|---|---|
| 1 | **La imagen es siempre la de la pose actual** | 3–4 | El atlas deja de sustituir y mezclar poses: es una caché de pose idéntica que sólo actúa cuando el render directo no cabe en el presupuesto del cuadro | Con un cine construido, ±0,5°, ±1°, ±3° y ±1–3 mm dan exactamente el render directo de la nueva pose; nunca hay mezcla; el cine no añade renders |
| 2 | **Formación acústica de la imagen** | 5 | Dispersores complejos en coordenadas materiales, PSF axial y lateral dependiente de profundidad, foco y frecuencia **antes** de la envolvente; especular sólo en el cruce de interfaz y dependiente del ángulo; anisotropía miocárdica; sangre con suelo y clutter; consola recalibrada con saturación y ruido creciente | SNR de amplitud del miocardio 1,7–2,2; celda lateral ≥ 2,5 veces la axial y creciente con la profundidad; miocardio/sangre 25–35 dB; pared lateral del A4C 6–10 dB bajo el septo; equivalencia CPU↔GPU |
| 3 | **Cadena de imagen en GPU de extremo a extremo** | rendimiento | Consola y conversión de barrido en shader; lectura asíncrona sólo de los mapas de análisis a cadencia reducida | Paso del worker < 16 ms p90 en tier medio con GPU; imagen a la cadencia simulada sin pérdidas |
| 4 | **Ventana acústica** | 6 | Pulmón con superficies curvas que se mueven con la respiración, escotadura cardíaca realista, costillas con penumbra verificadas por prueba, hígado como ventana subcostal, ventana difícil por atenuación parcial | Mapas sin bordes rectos; ventana difícil mejorable a ≥ 55 buscando; sombra costal medida |
| 5 | **Vistas que emergen y espacio continuo alrededor de cada una** | 4 | Objetivos de vista que contienen sus referencias (PLAX horizontal, PSAX-MV, A5C, subcostal); score con visibilidad calculada sobre el modelo; defectos nombrados (acortamiento, corte anterior o posterior, exceso de VD, TSVI en A4C, AI parcial) como componentes; métricas de trayectoria | Auditoría de planos realmente ≤ 7°; cada vista ≥ 90 alcanzable a mano; retroalimentación por defecto nombrado |
| 6 | **Anatomía pendiente** | 1 | Aurículas de pared fina con venas pulmonares, VCI y VCS curvas, TSVD y tronco curvos, papilares con base ancha, arco aórtico y ventana supraesternal | Medidor en rango; mapas sin primitivas; matriz ≥ 6 en anatomía por vista |
| 7 | **Cinemática** | 2 | Torsión, traslación respiratoria, tablas por latido (FA, extrasístoles), apertura mitral en diástasis, periodo preeyectivo | MAPSE, TAPSE y tiempos en rango; variación latido a latido en FA |
| 8 | **Consola y Doppler calibrados** | 7–8 | Nyquist y PRF según profundidad y frecuencia, PRF alta, dúplex, ECG con el barrido; TDI por pared, CW con anchura de haz, espectros calibrados, flujo de cavidad | PW, CW y TDI dentro de la tolerancia del protocolo con técnica correcta |
| 9 | **Modo «Anatomía» y examen íntegro** | docente | Sector y plano sobre el corazón 3D, etiquetas, transparencia, correspondencia 3D ↔ imagen, cuadro a cuadro; examen sin score ni corazón visibles; tareas con adquisición manual | Pruebas E2E del modo y del examen |
| 10 | **Validación visual contra referencias** | validación | Banco de métricas (histograma, speckle, autocorrelación, contraste, nitidez de bordes, movimiento) contra clips con licencia verificada; matriz 1–7 por vista | Informe por vista con la matriz completa |
| 11 | **Variabilidad de pacientes** | 9 | Generador paramétrico: habitus, posición y rotación cardíaca, profundidad, tamaños, frecuencia | Casos generados dentro de rangos; ventanas distintas por paciente |
| 12 | **Patologías** | 10 | Sólo como modificadores del motor común | Cada patología con medidas y vistas validadas |

Las métricas cuantitativas de imagen de la iteración 2 (estadística y tamaño del speckle, contrastes) se convierten en pruebas automáticas desde esa iteración; la iteración 10 añade referencias reales.

## F. Mayor aumento de realismo con menor coste computacional

| Cambio | Coste computacional | Ganancia |
|---|---|---|
| Atlas como caché de pose idéntica | Ninguno al mover la sonda (ya se renderizaba); con GPU y sonda quieta se renderiza en lugar de copiar | Desaparecen la zona muerta, la imagen doble y la cuantización a 32 fases con GPU |
| Resolución axial y lateral aplicadas a la señal compleja antes de la compresión | +2–3 ms en CPU, < 1 ms en GPU | Speckle con estadística y forma reales; fin de las estrías |
| Especular sólo en el cruce de interfaz, con dependencia angular | Ninguno | Contornos finos que se pierden cuando la pared es paralela al haz |
| Anisotropía miocárdica por el ángulo entre haz y pared | Ninguno | Dropout lateral y paredes paralelas al haz más oscuras |
| Suelo de ruido visible, clutter de sangre y punto blanco con saturación | Ninguno | Cavidades con «humo», ganancia que quema como en un equipo |
| Pulmón con superficies curvas | Casi nulo | Desaparecen los bordes negros rectos |
| Examen sin score ni corazón, ECG con el barrido, Nyquist por profundidad | Ninguno | Honestidad de la máquina y validez del examen |
| Consola y conversión de barrido en GPU | Ahorra 10–35 ms de CPU por cuadro | Deja margen para 60 fps y para el resto de mejoras |

## G. Propuesta de arquitectura

**Correspondencia de los motores pedidos con el código actual**:

| Motor | Hoy | Cambio propuesto |
|---|---|---|
| A. Anatomy Engine | `anatomy/heartModel.ts` (1 606 líneas) + espejo `gpu/glslHeart.ts`; `thoraxModel.ts` | Partir por estructura (VI, VD, aurículas, válvulas, vasos, pericardio) con un archivo GLSL gemelo por módulo y equivalencia por módulo; tabla de parámetros normalizados con rangos |
| B. Cardiac Motion Engine | `cardiac-cycle/` + `computeHeartPose` | Mantener la fase única; tablas por latido para ritmos irregulares; torsión y respiración como campos de deformación |
| C. Probe Engine | `probe/pose.ts`, controles clínicos en el store | Mantener; añadir adaptadores de entrada (mando, ratón 3D, teléfono) y registro de trayectoria |
| D. Ultrasound Geometry Engine | `BeamFrame`, `PolarFrameSpec`, `polarSpecFor` | Añadir modelo de transductor (apertura, frecuencia central, ancho de banda, foco de transmisión, perfil de elevación) del que derivan PSF y frame rate |
| E. Acoustic Renderer | `procedural/sliceRenderer.ts` y `gpu/glslPasses.ts` mezclan muestreo, propiedades, speckle y artefactos | Etapas explícitas con contrato: muestreo de escena → propiedades acústicas → propagación (transmisión) → campo de dispersores complejo → PSF → envolvente |
| F. Artifact Engine | Repartido entre el trazador (sombra, reverberación) y la consola (espejo, lóbulos, clutter) | Artefactos de propagación en la etapa de propagación; artefactos de haz (lóbulos, grosor de corte) en la PSF; artefactos del sistema (ruido, clutter electrónico) en la consola |
| G. Scan Conversion | `scanConvert.ts` en CPU dentro del worker (9–26 ms) | Shader de conversión con zoom en el hilo principal o `OffscreenCanvas` |
| H. Machine Controls | `postprocess/consolePipeline.ts` (hace además la resolución) | Consola sólo con ganancia, TGC, ruido, compresión, suavizado, persistencia y mapa de grises; modelo de PRF y frame rate |
| I. Education Engine | `view-recognition/`, `education/`, `measurements/` | Visibilidad de referencias calculada con el modelo; defectos de vista nombrados; métricas de trayectoria; examen sin fugas |
| J. Pathology Engine | `cases/` (parámetros validados con Zod) | Mantener como modificadores del motor común; generador de pacientes |
| Caché de render | `atlas/atlasRenderer.ts` | Semántica de identidad de pose (iteración 1) |

**Flujo objetivo por cuadro**:
```
ProbeControl → ProbePose (6 GDL) → BeamGeometry (transductor, sector, foco, elevación)
CardiacClock → CycleState → HeartPose (una sola fase para anatomía, flujo y verdad)
Por muestra (línea, profundidad, elevación):
  SceneSample   : tejido, estructura, distancia con signo, normal, coordenadas materiales
  Acoustic      : retrodispersión (anisótropa), coeficiente especular, atenuación(f)
  Propagation   : transmisión acumulada, fuentes de reverberación
  Scatterers    : campo complejo anclado al tejido
  PSF           : axial (pulso) × lateral (haz según profundidad y foco) × elevación
  Envelope      : amplitud lineal + mapas (estructura, transmisión, tejido)
Console         : ganancia/TGC → ruido → compresión → suavizado → persistencia → mapa de grises
ScanConversion  : polar → pantalla (GPU), zoom
Analysis        : visibilidad por modelo, score, mediciones (cadencia reducida)
```

**Reglas de arquitectura**:
- Cada etapa tiene implementación de referencia en CPU (pruebas en Node) e implementación GPU, con prueba de equivalencia por etapa.
- Los parámetros de cada etapa están en unidades físicas (mm, MHz, dB/cm/MHz) y derivan del modelo de transductor y de la tabla de tejidos, nunca del estado de la interfaz.
- Ningún artefacto se añade como efecto de imagen: todos nacen de geometría, propagación, haz o sistema.
- `simulatorCore.ts` pasa a orquestar módulos (reloj, imagen, Doppler, strips, análisis, composición) en lugar de implementarlos.
- WebGL2 sigue siendo la base porque funciona en todos los navegadores de destino y ya tiene equivalencia probada. WebGPU se evaluará cuando una etapa necesite cómputo general (PSF de núcleo grande, campos de flujo 3D).

## Iteraciones realizadas

### Iteración 1 — La imagen es siempre la de la pose actual

**Problema.** El backend por defecto (atlas) mezclaba hasta cuatro anclas con pesos 1/(d²+0,02) y sólo renderizaba la pose real cuando el ancla más cercana quedaba a más de 0,35 (cm + 0,12·grados). Medido en la app con GPU: con la sonda oscilando ±1° junto a un ancla, el render tardaba 0,7 ms con peso de relleno 0, es decir, se mostraba la imagen almacenada de otra pose. Entre 4° y 8° se veían dos imágenes superpuestas y el movimiento quedaba cuantizado a 32 fases. Esto contradice el principio central del simulador: en un ecógrafo cada cuadro es una adquisición nueva de la pose actual.

**Solución.**
- El atlas pasa a ser una caché de pose idéntica (0,1 mm / 0,08°). Nunca sustituye una pose vecina ni mezcla anclas.
- Renderiza directamente la pose y la fase exactas cuando el coste medido de la fuente cabe en 0,6 del intervalo de cuadro simulado, con histéresis ×1,25/×0,75. Es el caso normal con WebGL2, y entonces no guarda nada.
- Sólo con una fuente lenta y la sonda en reposo, cada cuadro es el de su ranura de fase: la ranura guardada se sirve y la vacía se renderiza una vez y se guarda, así que el cine se llena en torno a un latido sin superar un render por cuadro. Los cines incompletos se desalojan primero.
- El núcleo calcula el presupuesto del cuadro a partir del frame rate simulado.
- La conversión de barrido reúne sólo los píxeles del sector con pesos de 10 bits y escritura de 32 bits: con calentamiento y orden alterno, 8,5 ms frente a 15,1 ms a 890×680 px.

**Verificación.**
- `atlas.test.ts` (5 pruebas): con un cine construido, rotación +0,5°, +1° y +3°, tilt +3°, rock +3° y deslizamientos de 1 y 3 mm dan exactamente el render directo de la nueva pose y una imagen distinta del cine; el cine se llena con un render por ranura vacía; una fuente rápida renderiza la fase exacta sin guardar cines; un barrido PLAX→PSAX con cine presente no tiene saltos.
- `scanConvert.test.ts`: la reunión rápida queda a ≤ 1 nivel de gris de la de coma flotante en los tres tiers y dos tamaños, y el exterior del sector queda negro.
- En la app con GPU y la sonda oscilando ±1°: 27 de 27 y 40 de 40 cuadros fueron renders de la pose actual (antes, la imagen almacenada); composición 5,4 ms de mediana (antes ≈ 9 ms).
- Prueba de humo del núcleo en Node, misma carga de máquina: 9 s frente a 12 s en `8919703`.
- Suite completa: lint y tipos sin errores; 135/135 pruebas unitarias (con 60 s de tiempo de espera, porque otro proyecto mantuvo la máquina en cargas medias de 25–100); E2E 29/34 en la corrida completa y 2 más al reintentar, incluidas las 21 comparaciones CPU↔GPU. Las 3 pruebas de `core-flow` que agotaron la espera de cuadros también la agotan en `8919703` con la misma carga (comparación A/B) y pasaron 9/9 al repetir la especificación con menos carga.

**Coste.** Con GPU y la sonda quieta se renderiza en lugar de copiar. Con la máquina muy cargada (carga media 26–90 por otro proyecto) la app entregó 25 cuadros/s a calidad media (36,9 simulados) y 18–20 a calidad alta (27,3). El cuello de botella restante es la consola y la composición en CPU, objetivo de la iteración 3.

**Comparación con ecografía real.** Un ecógrafo nunca muestra la imagen de una pose vecina: cada cuadro sale de la adquisición actual y los loops de cine sólo existen al congelar. Con GPU el simulador cumple ahora esa propiedad en todos los cuadros. Con CPU lenta y la sonda quieta muestra un cine de la pose exacta, equivalente a un loop cuantizado a 32 fases por latido.
