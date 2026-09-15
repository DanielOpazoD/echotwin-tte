# Auditoría de fidelidad y arquitectura (2026-09-11)

Primera tarea del plan de alta fidelidad: auditar el simulador antes de cambiarlo. Se apoya en la evaluación del panel (`docs/EVALUACION_PANEL.md`, commit `8919703`) y añade inventario de arquitectura, medidas de rendimiento en CPU y GPU, comparación conceptual con HeartWorks, Vimedix, U/S Mentor y SonoSim, hoja de ruta y propuesta de arquitectura.

## Reauditoría posterior al trabajo estructural — 2026-09-15

Esta sección prevalece como plan de trabajo sobre la hoja de ruta histórica de abajo. Alcance: imagen, anatomía, mecánica y operación; sin ampliar docencia, scores, examen ni patologías. PRF/Nyquist y dúplex están excluidos, también como criterio de cierre. No se otorga una nueva nota de fidelidad ni se declara validación clínica.

### Incremento de imagen: continuidad de reverberación (decisión 119)

La ablación por componentes del caso normal, con la escena obtenida del núcleo y comprobación de la reconstrucción contra la consola, confirma que el ruido receptor domina gran parte de la sangre interior A2C a 6–10 cm (91–93% de potencia esperada en las dos fases estudiadas). Eso no identifica un suelo de ruido clínico correcto; retirar ruido o especular no fue aceptado como calibración.

Sí se reprodujo y corrigió un defecto de imagen independiente de esos ajustes: un cambio de profundidad de 10⁻⁸ cm, sin cambio de tejido, movía hasta 61 niveles de gris en A2C y 35 en PSAX-MV por el redondeo de la atenuación en el pico de cada reverberación. El tren continuo de ecos deja 0 niveles distintos en esas pruebas y conserva PLAX como control negativo. Fantoma de suma completa, prueba por la cadena real y mutación protegen la clase de defecto. Las referencias visuales actualizadas se revisaron por región: sólo cambian pulmón y su soporte de PSF; no hay modificación anatómica ni relajación de tolerancias. La textura global y la entrada pleural discretizada siguen abiertas.

### Referencia reproducible

Base limpia: `ba995bd4bc9bc66fc752410386a95fec76395979`, después de #7, #10 y #11. Caso `normal-excellent-window`, semilla 101. La captura recorre `SimulatorCore` y `baseInput`, no un reconocedor de vistas ni una plantilla. Cada pose se calcula con `canonicalControl` y el plano medido es el `probeBeam` de la salida. Posición lateral izquierda en las vistas torácicas y `subcostal-supine` en las subcostales; espiración, elevación 0. Tier alto, backend procedimental CPU de referencia, 640×560, ajustes por defecto (16 cm, 2,5 MHz, THI, foco 9 cm, 70 dB, ganancia 0, TGC plano, persistencia 0,35, mapa clínico, zoom 1).

Se guardó el segundo latido tras pasos de RR nominal/32: 26 cuadros producidos por vista, 312 PNG en las 12 vistas, con timestamps y fases reales (el ritmo sinusal varía ligeramente el RR). El cuadro llamado ED es el más próximo a fase 0, no una fase exacta inferida de una captura. `manifest.json` conserva entradas completas, semilla, fase, haz, calibración espacial y tiempos; `sequences.html` reproduce las secuencias sintéticas. Artefactos y scripts de medición locales: `/tmp/echotwin-fidelity-ba995bd/`, fuera de git. Las capturas del núcleo no incluyen overlays de la UI. Los tiempos de esta captura, con la máquina cargada, no son un presupuesto de rendimiento.

### Qué se confirmó y qué no

- La sustitución de poses vecinas, la PSF aplicada después de la compresión y el ruido receptor puramente aditivo de envolvente del informe inicial ya no describen el código. Hay caché de pose exacta, PSF de señal compleja antes de la envolvente y ruido complejo filtrado. No se repiten aquellos diagnósticos.
- Hay un defecto distinto en esa caché: su identidad no incluía el estado acústico. En PLAX, ranura 8/32, fuente CPU real y presupuesto de caché 0 declarado para hacer reproducible la ruta lenta, cambiar frecuencia, THI, clutter o anchura del haz no provoca una nueva adquisición. La presentación puede cambiar por la consola, pero sigue procesando ecos antiguos. Corrección del primer incremento, abajo.
- El foco nuevo llega al render pero `PolarFrame.spec` conserva el anterior si no cambian líneas/muestras/profundidad/sector: 9 cm retenidos después de pedir 4 cm. Eso deja desalineados el render y la respuesta de ruido de la consola. Corrección del primer incremento.
- Persisten visualmente cavidades granulosas, paredes de brillo muy desigual y tramos de interfaces demasiado regulares. Esto es observación de imagen, no confirmación de que baste con bajar ruido, subir ganancia o engrosar paredes.
- El navegador usa el mismo clasificador, pero sólo diez mallas por ciclo y fase del HUD; no es una representación continua de toda la mecánica. Su plano sigue los controles actuales, no el haz histórico de cine. La referencia común de anatomía existe; la equivalencia temporal completa no.
- La cinemática es prescrita por tablas y funciones geométricas, con conservación aproximada del volumen parietal; no es un solver biomecánico. THI, anisotropía, PSF gaussiana y artefactos contienen aproximaciones declaradas. No se cambia esa naturaleza en este incremento.

Medidas nuevas sobre el plano renderizado, caso normal. Los ángulos de esta tabla son normal del plano objetivo frente a normal del haz: **no** son el ángulo del haz central frente al eje ventricular ni un umbral de aceptación clínica. Las distancias se refieren a los landmarks del modelo; no se exige que todas las estructuras de una vista estén en un único plano infinitamente fino.

| Vista | Diferencia de normales | Distancia perpendicular de referencias seleccionadas |
|---|---:|---|
| PLAX | 3,59° | Mitral 4,5 mm; AI 9,5 mm; raíz aórtica 4,1 mm |
| PSAX basal / mitral / papilar / apical | 47,26° / 25,56° / 2,50° / 3,34° | En mitral: inferoseptal 17,3 mm, inferolateral 34,7 mm |
| A4C | 10,55° | Ápex 4,9 mm; mitral 0,2 mm; tricúspide 5,6 mm |
| A5C | 2,15° | TSVI 5,6 mm; aórtica 8,6 mm; ápex 8,1 mm |
| A2C / A3C | 14,58° / 6,71° | Ápex 14,0 / 8,2 mm |
| Subcostal 4C | 1,79° | AD y AI 12,1 mm; tricúspide 20,5 mm |
| Subcostal VCI | 0,12° | VCI 2,6 mm; vena hepática 6,6 mm |
| VD focalizada | 8,95° | VD 7,5 mm; tricúspide 2,8 mm |

### Inventario operativo inicial

`Conectado` significa que el parámetro tiene consumidor en el motor; no certifica por sí solo un comportamiento completo de equipo. Las filas parciales son trabajo pendiente, no botones eliminados.

| Herramienta | Parámetro, unidades y límites de UI | Etapa y efecto previsto | Estado y congelación/cine |
|---|---|---|---|
| Ganancia 2D / TGC | `gainDb` −30…30 dB; 8 bandas −15…15 dB | Amplificación global / por profundidad antes de compresión | Conectados en vivo. En congelado el cambio de ganancia y mapa produjo 0 píxeles distintos: se guarda el gris ya procesado, no la señal para reprocesar. Parcial |
| Profundidad / sector / densidad | 6…30 cm; 30…100°; baja/media/alta | Geometría y muestreo de adquisición | Conectados en vivo. En cine se usa la geometría guardada; los controles actuales pueden discrepar del cuadro histórico. Falta una política explícita de bloqueo/diferimiento |
| Frecuencia / THI | 1,5…5 MHz; encendido/apagado | PSF, especular y atenuación; resolución frente a penetración | Conectados, pero la caché reutilizaba ecos con ajustes anteriores. Corregido en este incremento. No hay nueva adquisición estando congelado |
| Foco | 2 cm…profundidad, paso 0,5 cm | PSF lateral/elevacional | Conectado; metadatos retenidos incorrectos corregidos. No se inventa reenfoque retrospectivo de cine |
| Rango dinámico / mapas | 30…90 dB; clínico/lineal/S/alto contraste | Compresión y presentación | Conectados en vivo; no reprocesan el gris guardado en congelado. Parcial |
| Persistencia / realce | 0…0,9; 0…1 | Promedio temporal / realce posterior a compresión | Conectados. Persistencia compensada por tiempo transcurrido; no se acumula en freeze. Revisar transitorios al cambiar adquisición |
| Zoom / inversión lateral | 1…2,5×; booleano | Conversión de barrido, no adquisición | Es **display zoom**, no zoom acústico ni HR-ROI. Opera en vivo/cine; nuevas distancias usan `pxPerCm`, pero geometrías guardadas de calipers siguen en píxeles y no se reproyectan. Parcial |
| Freeze / cine | Congelado; índice 0…−(n−1), máximo 96 cuadros | Revisión de gris, estructuras, haz y fase guardados | Funcional en 2D básico. Tiempo/ECG siguen al último instante y las tiras no son snapshots del cine; falta coherencia multimodal y metadatos históricos |
| M-mode / CMM y línea | Ángulo dentro del sector; 25/50/100 mm/s | Muestreo de una línea y escritura de columnas | Adquieren señal; CMM existe, pero no tiene todos los controles de M-mode expuestos. Barrido histórico y ECG no comparten aún timestamps públicos por columna |
| Cursor PW/TDI / volumen | Ángulo del sector; profundidad 1…profundidad; longitud 1…15 mm | Selección del volumen de flujo | Conectados al campo y a la geometría; CW integra la línea y no tiene gate localizado. Revisar sombras y cambios con cine |
| Baseline / inversión espectral | −2…2 m/s; booleano | Rango y representación del espectro | Conectados. Reinterpretación de columnas antiguas al cambiar ajustes requiere auditoría temporal; no se modifica PRF/escala física en esta fase |
| Ganancia espectral / filtro | −20…20 dB; 0…0,4 m/s | Nivel del estimado / rechazo de velocidades bajas | Conectados; historia y modificación en congelado parciales |
| Velocidad de barrido | 25/50/100 mm/s | Segundos por columna | Es funcional al escribir; al cambiarla no se guarda la calibración original de todas las columnas anteriores. No es válido asumir intervalos históricos uniformes |
| Color: caja, ganancia, filtro, persistencia, varianza e inversión | Caja en rad/cm; −20…20 dB; 0…0,3 m/s; 0…0,9 | Región de adquisición, potencia y mapa color | Consumidores reales. La revisión usa parámetros de presentación actuales y potencia/velocidad guardadas; falta contrato integral de cine. Escala/PRF excluidas del cambio |
| Distancias, velocidades, tiempos, VTI manual, Simpson monoplano, TAPSE | cm, m/s o cm/s, ms, cm, mL | Geometría/píxeles de imagen o tira calibrados | No devuelven sin más la verdad del caso. Falta anclaje de calipers a la adquisición, conservación tras zoom, manejo de costura de barrido y precisión ligada al muestreo |
| VTI automático | Intervalo de columnas | Detección de envolvente del espectro esperado | No es lectura del valor del caso, pero usa el espectro esperado y no el estimado granular mostrado. Parcial |
| Audio Doppler | activación; volumen 0…1 | Osciladores derivados del espectro | Implementado; no valida la cadena acústica ni el espectro mostrado |
| Artefactos | intensidades 0…1 | Sombra/reverberación en propagación; ancho de haz en PSF; espejo/lóbulos en consola | No meros rótulos, pero espejo/lóbulos son aproximaciones por umbral. Su plausibilidad/localización siguen abiertas |
| Área libre, zoom HR de adquisición, Vp y PHT | — | — | Ausentes como herramientas completas. No se añaden por cantidad antes de consolidar las existentes |

Referencia operativa adoptada para distinguir adquisición/presentación/cine: **GE Vivid E80/E90/E95, User Manual GC092307 rev. 06**, secciones 4-25/4-26 y 5-5/5-6. Frecuencia alta mejora resolución y baja mejora penetración; Octave alterna fundamental/armónico; display zoom y HR zoom son distintos. Se consultó el [manual técnico del fabricante alojado por un distribuidor](https://umetex.ru/wa-data/public/shop/manuals/GE_Vivid_E90-95-en.pdf), no un resumen comercial. No se afirma emular todas las funciones de esa familia ni copiar sus valores propietarios.

### Comparación real y validación pendiente

CAMUS local está fuera de git, con cita obligatoria: Leclerc et al., *IEEE TMI* 2019;38(9):2198–2210, DOI 10.1109/TMI.2019.2900516. Se prepararon hojas A4C/A2C con tres estudios Good por vista, elegidos por orden de identificador y calidad, no por parecido. Se comprobaron unidades NIfTI en mm y espaciado; las hojas de conjunto usan 0,5 mm/píxel y barras de 20 mm, con PNG nativos separados. Esos remuestreos sirven para comparar campo/escala, no para estimar microtextura. No se han retocado parámetros contra estas hojas.

La calibración histórica ya utilizó los 500 sujetos, por lo que no existe un holdout local intacto. Una nueva separación no borraría esa exposición: cualquier evaluación independiente requiere datos no utilizados antes o una revisión externa explícitamente identificada. Los archivos disponibles inspeccionados contienen ED/ES anotados, no se atribuye a esas parejas una validación del movimiento. EchoNet de 112×112 no se usa para microtextura. Las imágenes clínicas permanecen en los artefactos locales y no se incorporan a git ni a las PR.

### Orden de incrementos

1. Coherencia de adquisición: caché acústica + foco (bajo coste, prerrequisito de calibración).
2. Imagen normal y transiciones: localizar por tejido y profundidad la textura de sangre/miocardio y el brillo especular, validar las métricas con fantomas antes de calibrar y revisar secuencias (coste medio/alto).
3. Vistas y relaciones anatómicas: tolerancias por landmark y fase para A5C, PSAX mitral/basal y subcostal; después continuidad/coaptación durante el ciclo (alto coste, referencias anatómicas antes de cambiar valores).
4. Cine, ECG, barrido y calipers: historial temporal/espacial común y precisión de medida acorde al muestreo (coste medio).
5. Artefactos con controles negativos y material para revisión por especialistas, sin declarar validación externa hasta ejecutarla.

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

### Iteración 2 — Formación acústica de la imagen

**Problema.** El trazador multiplicaba la reflectividad de cada tejido por un factor de ruido de valor positivo y la consola simulaba la resolución con una media móvil axial y un desenfoque gaussiano lateral aplicado **después** de la compresión logarítmica. Resultado medido: celdas de speckle isótropas de 0,3–0,9 mm, estrías a lo largo del haz, estadística lejos de Rayleigh (SNR local 2,5–2,8 en tier medio y 4,2–4,6 en alto), una banda especular gruesa en todas las interfaces, sangre en negro absoluto, ninguna diferencia entre paredes perpendiculares y paralelas al haz (septo en A4C −1 dB respecto de PLAX) y una ganancia alta que no saturaba.

**Solución** (decisión 52).
- Cada muestra aporta una señal compleja: retrodispersión incoherente (reflectividad × anisotropía miocárdica × heterogeneidad) por un fasor de dispersores anclado al tejido, más el eco coherente de la interfaz sólo en la muestra que la cruza (∝ |n·d|⁴), por la transmisión de ida y vuelta.
- Una PSF separable de energía unidad (pulso axial según frecuencia y armónicos; haz lateral de ida y vuelta según profundidad, foco, frecuencia, armónicos y artefacto de anchura de haz) y la detección de envolvente producen la amplitud. El speckle, su tamaño y su crecimiento con la profundidad salen de ahí.
- CPU y GPU comparten constantes y tabla de núcleos; la GPU gana dos pasadas (C axial, D lateral y envolvente).
- La consola ya no desenfoca: ruido electrónico Rayleigh que crece con la compensación, punto blanco +7 dB. La grasa pasa a hipoecoica y la reverberación difusa entre líneas A se reduce, para que el fondo no se llene de ruido.

**Verificación.**

| Magnitud (caso normal, tier medio) | Antes | Después | Objetivo |
|---|---|---|---|
| SNR local del speckle miocárdico | 2,5–2,8 | 2,0 | 1,91 |
| Celda lateral a 3–5 / 7–9 / 11–13 cm | 0,7–0,9 / 1,1–2,2 / 2,6 mm | 1,1–1,3 / 1,6–2,0 / 2,3 mm | crece con la profundidad |
| Celda axial | 0,7–0,8 mm | 0,7–0,9 mm | ≈ 0,9 mm |
| Miocardio sobre sangre alejada de paredes | 35–37 dB | 28–36 dB | 25–35 dB |
| Septo en A4C respecto de PLAX | −1,0 dB | −7,7 dB | 6–10 dB más oscuro |
| Gris miocardio / sangre / pericardio p95 | 79–108 / 1 / 144–224 | 85–132 / 11–12 / 196–255 | sangre oscura, no negra |
| Saturación con +12 dB | 0,1–0,6 % | 8–11 % | quema como un equipo |

- `psf.test.ts` (4 pruebas) e `imageFormation.test.ts` (4 pruebas) fijan esos números.
- Equivalencia CPU↔GPU: 21/21 comparaciones, incluidas las de tier alto.
- Unitarias: 141/142 antes de regenerar los goldens, cuyo cambio es el esperado tras revisar las imágenes; después, 142/142. Lint y tipos sin errores.
- E2E: los 13 de flujo (core-flow, learning, measurements) pasan sin reintentos tras la decisión 53, en 4,7 min frente a 12 min y 3 fallos antes de ella; equivalencia CPU↔GPU 21/21 otra vez con SwiftShader forzado.
- Rendimiento. Trazador CPU en Node (tier medio, PLAX, dos rondas alternas): render 27–33 ms antes y 33–34 ms después (+1 a +6 ms por las cuatro consultas de ruido del fasor y la PSF). WebGL2 con GPU real en la app (carga media 13–19): render 8,4 ms de mediana en tier medio y 17,7 ms en tier alto con la sonda oscilando ±1°, 28,6 y 23,6 cuadros entregados por segundo frente a 36,9 y 27,3 simulados. Chromium sin GPU (SwiftShader, el de Playwright): los tres primeros cuadros llegan a los 19–27 s frente a 18–21 s con la iteración 1, casi todo compilación del sombreador del corazón, y con carga los E2E dejaron de recibir cuadros incluso con 60 s de espera. Por eso el WebGL por software pasa a usar el trazador CPU (decisión 53), que además es lo más rápido para quien no tiene aceleración gráfica.

**Evaluación visual** (`docs/validation/iteracion-2/antes-despues-*.png`, izquierda antes, derecha después). El miocardio tiene grano de speckle que se alarga lateralmente con la profundidad y ya no hay estrías radiales. El endocardio deja de ser un contorno brillante continuo. El septo y la pared lateral se apagan donde el haz corre a lo largo de ellos. Las válvulas siguen finas y visibles. La sangre muestra un suelo oscuro con grano. Las líneas A del pulmón quedan sobre fondo oscuro.

**Comparación con ecografía real.** Textura miocárdica, sangre y comportamiento de la ganancia se parecen ahora a un equipo: speckle de celda lateral de 1–3 mm, cavidades casi negras con ruido, saturación con ganancia alta y dropout de paredes paralelas al haz. Lo que todavía delata la simulación ya no es la textura sino la escena: grasa y pulmón del tórax con caras planas, campo cercano demasiado brillante, aurículas elipsoidales y papilares desprendidos (iteraciones 4 y 6).

### Iteración 3 — Cadena de imagen en GPU de extremo a extremo

**Problema.** Con WebGL2 la GPU formaba la envolvente, pero todo lo demás volvía a la CPU: el worker leía la envolvente en coma flotante y los identificadores, aplicaba la consola, convertía el barrido a 890×814 px y transfería 2,9 MB por cuadro, que el hilo principal volvía a copiar. Medido en la app (tier medio, sonda oscilando ±1°): paso del worker 20,7 / 34,8 ms (p50/p90), del que la lectura eran 2,8 / 11,5 ms, la consola 1,6 / 6,0 ms y la composición 5,8 / 12,2 ms. Llegaban 29,0 cuadros/s de 36,9 simulados, y 22,6 de 27,3 en tier alto. Antes de cambiar nada se cronometró cada pasada en el M4: 2,6 / 2,7 / 2,1 / 1,3 ms. La GPU no era el cuello de botella, y tampoco la marcha cuadrática de la pasada B, que era la sospechosa.

**Solución** (decisiones 54 y 55).
- Una pasada de consola en GLSL repite la de CPU paso a paso: compensación, ruido con el mismo hash entero, compresión, realce, persistencia con la historia en la GPU y mapa de grises. Escribe un cuadro RGBA8 empaquetado con gris, estructura, tejido y transmisión en 8 bits, que es la única lectura. La amplitud lineal se queda en la GPU.
- Una pasada de presentación usa la LUT de conversión de barrido de la CPU, subida como texels enteros, y el campo de color. Dibuja en el lienzo del worker, que se entrega como `ImageBitmap` sin copias.
- Siguen en CPU, con resultado equivalente (≤ 1 nivel de gris), la consola con los artefactos espejo y lóbulo lateral, la composición de los modos con tira (su sector se sigue formando en la GPU), el cine congelado y el camino sin GPU. La persistencia continúa al cambiar de consola en los dos sentidos. Si se pierde el contexto WebGL, incluso a mitad de un cuadro, el núcleo vuelve a formar el cuadro con el trazador CPU.
- Ritmo: con el paso ya en 5 ms seguían faltando cuadros (31,5 de 36,9), porque los temporizadores del worker disparaban 3,8 ms tarde de mediana y el acumulador del núcleo tiraba el resto. El worker programa ahora contra un horario absoluto y el acumulador conserva el resto.
- La lectura asíncrona que proponía la hoja de ruta (PBO + fence) no se implementó. Con una sola lectura de 100 kB el criterio se cumple con holgura, y un cuadro leído tarde habría desalineado el cine y las máscaras Doppler de la imagen mostrada. Queda como opción para GPU integradas lentas.

**Verificación.**

| Criterio de la hoja de ruta | Resultado |
|---|---|
| Paso del worker < 16 ms p90 en tier medio con GPU | 10,3 ms p90 (4,6 p50, 14,3 p99); 12,5 ms p90 en tier alto |
| Imagen a la cadencia simulada sin pérdidas | 36,9 de 36,89 cuadros/s en medio y 27,2 de 27,27 en alto, 0 descartados |

- Equivalencia en el M4: una cadena de cuatro cuadros formados en GPU, GPU, CPU y GPU difiere de la consola CPU como máximo en 1 nivel de gris, en ninguna muestra más de 1, con tres configuraciones de consola. La presentación difiere como máximo en 1 nivel, en ningún píxel más de 1 y sin píxeles coloreados sólo en un lado, con saltos de signo en el color y el sector invertido. En la app, 6 cuadros en vivo formados en GPU y los mismos cuadros compuestos en CPU al congelar son idénticos píxel a píxel.
- `scanConvert.test.ts`: la reunión entera sobre los texels de la LUT reproduce exactamente la de CPU, también la muestra que usa el color.
- `e2e/gpu-equivalence.spec.ts`: 24/24 sobre SwiftShader: las 21 comparaciones de cuadro y 3 de la cadena de imagen (cadena mixta GPU, GPU, CPU, GPU y presentación con color), dentro de una corrida completa de 42 pruebas E2E en 25,2 min.
- `e2e/gpu-live.spec.ts` (GPU real): 4/4 con GPU real (Chromium completo en modo headless, ANGLE Metal sobre Apple M4): los cuadros en vivo en 2D (7,7 s) y en color (5,4 s) llegan como `ImageBitmap` y son idénticos a los mismos cuadros compuestos en CPU al congelar; las tiras, el cine y los artefactos van por CPU y los cuadros vuelven a la GPU al quitarlos (11,7 s); los cuadros siguen llegando tras visitar otra pantalla (5,0 s).
- E2E de flujo (core-flow, learning, measurements): 14/14 (core-flow 10, incluida la prueba nueva de ida y vuelta a otra pantalla en 13,2 s; learning 2; measurements 2). Corren sobre SwiftShader, es decir, por el camino CPU con el nuevo ritmo del worker.
- Unitarias: 146/146 en 29 archivos sobre el commit de esta iteración aislado en un worktree, donde también quedan verdes lint, tipos y compilación; 149/149 en 30 archivos en el árbol combinado con la corrección del Doppler color en curso. Con `--testTimeout=60000`: con la máquina en cargas de 150–200 por otros procesos, las pruebas de 5 s expiran también en HEAD (comparación A/B: 15–19 s). Lint, tipos y compilación sin errores (`npm run check`).
- En la app, al activar el artefacto espejo desde el laboratorio los cuadros pasan a consola y composición en CPU, y vuelven a la GPU al quitarlo.

**Revisión adversarial.** Un revisor de contexto limpio no encontró defectos graves y sí estos, todos corregidos:
- Al cambiar entre la consola CPU y la GPU se saltaba la persistencia durante un cuadro. Ahora la historia pasa de una a otra (`gpuPath.test.ts` y la cadena mixta de `compareImageChain`).
- Un contexto perdido a mitad de un cuadro devolvía el cuadro anterior como nuevo; ahora el cuadro se vuelve a formar en CPU.
- Un renderizador liberado seguía aceptando trabajo y no liberaba su contexto.
- La prueba de equivalencia de la presentación medía la fracción sobre todo el lienzo, esquinas negras incluidas, y no exigía la diferencia máxima. Al endurecerla apareció la caja de color desplazada por `atan` en SwiftShader, que ahora se prueba contra las coordenadas de la LUT.
- Varias afirmaciones de la documentación eran inexactas (tiras, «resultado idéntico», un color que en realidad satura, qué prueba cubría el `ImageBitmap`, la causa de los cuadros perdidos) y se corrigieron.
- Vio además, sin relación con el cambio, que la imagen se congelaba al volver de otra pantalla (corregido aquí, con prueba E2E) y que la persistencia del color nunca se aplicaba (tarea aparte).

**Evaluación visual.** En modo color, un mismo cuadro PLAX en vivo (GPU) y en revisión de cine (CPU) no se distinguen, y el recuento de píxeles lo confirma. La imagen no cambia: cambia la cadencia. Con la sonda en movimiento la imagen sigue al gesto a 36,9 cuadros/s en lugar de 29, con un intervalo mediano de 27,5 ms, y el hilo principal dibuja cada cuadro en 0,1 ms.

**Comparación con ecografía real.** Un equipo cardíaco adquiere en 2D a decenas de cuadros por segundo según profundidad y sector, no pierde cuadros al mover la sonda y la latencia es de un cuadro. Con GPU el simulador entrega ahora exactamente la cadencia que calcula su propio modelo de adquisición (líneas × profundidad), también en tier alto. Una GPU integrada lenta puede volver a limitarla, porque la lectura sigue siendo síncrona. Lo que queda por acercar a un equipo real es el campo de color, que se recalcula cada dos cuadros en CPU con un modelo paramétrico.
