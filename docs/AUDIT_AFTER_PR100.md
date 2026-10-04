# Evaluación multiparamétrica después de los primeros diez PR

Corte: `aa5f03c0b63b8f0b5ce2f531c375e67c426a3206` (PR #100), 4 de octubre de 2026.
Evaluación técnica interna, con inspección de código, imágenes y aplicación ejecutada.
No es una validación clínica independiente ni un dictamen de un ecocardiografista.

## Escala y criterio

1: ausente o incorrecto. 2: rudimentario. 3: parcial, con limitaciones dominantes.
4: funcional y plausible, con simplificaciones importantes. 5: sólido para docencia,
causal y comprobado. 6: avanzado y robusto, con fidelidad medida próxima al uso
profesional. 7: referencia profesional con validación externa independiente.
Las décimas expresan juicio técnico, no precisión estadística. Los pesos dan mayor
importancia a la fidelidad que al volumen de funcionalidades o pruebas.

| Parámetro | Peso | Nota / 7 | Fundamento y límite decisivo |
| --- | ---: | ---: | --- |
| Arquitectura y mantenibilidad | 8 % | 5,8 | Capas, contratos, módulos compartidos, CI y presupuestos; `stripEngine` aún mezcla programación temporal, recepción y presentación. |
| Causalidad de adquisición y procedencia | 10 % | 4,3 | Sonda → tejidos → señal e identidad histórica coherentes; la tira comprime tiempo bajo carga y usa tablas actuales para muestras de un latido previo. |
| Anatomía y continuidad espacial | 12 % | 4,8 | Cámaras, válvulas y aorta torácica compartida CPU/GPU/3D; AI dilatada recortada, VI aplanado sin compensación volumétrica y uniones idealizadas. |
| Mecánica y coordenadas materiales | 10 % | 4,2 | Contracción y annulus móviles, TDI septal derivado geométricamente; factor lateral empírico y discordancia del volumen expulsado del VD en regurgitación. |
| Ventanas, transiciones y adquisiciones imperfectas | 8 % | 4,7 | 13 vistas y controles continuos; sombras/ángulo/contacto afectan señal. SSN supina no alcanza descendente en los doce casos. |
| Formación de imagen B y artefactos | 12 % | 4,1 | Propagación, impedancia, PSF, speckle y consola; textura reconociblemente sintética, modelos reducidos de reverberación/refacción y sin onda RF completa. |
| Doppler y hemodinámica | 12 % | 4,4 | IQ/Hann/FFT PW/TDI, aliasing, red aórtica con continuidad; acceso binario central, CW dependiente del último cuadro B y flujos valvulares reducidos. |
| Mediciones y calibración | 8 % | 3,9 | Calipers físicos, VTI/volúmenes e identidad de adquisición; eje temporal erróneo bajo carga y discrepancias geometría–truth comprometen resultados concretos. |
| Navegación, interfaz y accesibilidad | 6 % | 5,3 | Paneles adaptables, cámara independiente, teclado y cine; móvil conserva 378 px útiles, pero overlays densos y tareas precisas siguen exigentes. No auditoría formal con lector de pantalla. |
| Rendimiento y estabilidad | 6 % | 4,3 | Worker, caché, presupuestos y fallbacks; trazado CPU completo no alcanza tiempo real a calidad alta y cadencia mostrada no equivale a cuadros nuevos. |
| Docencia y criterios clínicos | 4 % | 4,5 | Casos, protocolo, segmentos y feedback; e′ usa umbrales anteriores bajo cita 2025, y algunos hallazgos combinan diagnósticos distintos. |
| Reproducibilidad y validación externa | 4 % | 3,6 | Banco obligatorio y separación por paciente verificables; evaluación clínica externa no realizada. CAMUS histórico fue calibración, no evaluación reservada. |

**Nota ponderada: 4,50 / 7 (4,5 redondeada).** No debe compararse como un cambio
numérico directo con el 5,03 del PDF: aquel corte PR87 era principalmente estático
y usaba otra ponderación. Esta evaluación incorpora fallos dinámicos reproducidos.
La arquitectura puede estar más madura mientras la fidelidad demostrada sigue limitada.
Confianza alta en fallos numéricos y rutas de código; media en valoración visual;
baja en equivalencia clínica y rendimiento de GPU física, que no se midieron.

## Evidencia examinada

- Los diez PR #91–#100 están integrados con CI aprobada. En el corte final:
  979 pruebas unitarias, 75 recorridos de navegador, cuatro omisiones por GPU física
  y 43 comparaciones de paridad. Estas cifras indican cobertura, no realismo clínico.
- Matriz nueva de **312 adquisiciones**: doce casos × trece vistas × fases 0 y 0,35.
  Controles reales → posición → haz → clasificador → trazador CPU, calidad media.
  Decúbito supino subcostal/SSN, lateral izquierdo apical/paraesternal, espiración,
  profundidad media del rango recomendado y foco de cada vista.
- Inspección visual de las 26 vistas normales en ambas fases y tres vistas de alta
  calidad a fase 0,60 (PLAX, A4C y PSAX mitral). Contornos y cavidades reconocibles;
  textura sintética y reflejos finos muy dominantes. La imagen aislada no demuestra
  la causa de esos rasgos. No se usó una captura clínica ajena como supuesto control.
- Doce modelos medidos con 160.000 muestras de volumen; patología esperada separada
  de errores del modelo. AI de HFrEF: **87,69 frente a 98 mL (−10,52 %)**. VI en
  hipertensión pulmonar: **76,76 frente a 85 mL (−9,70 %)**. Son estimaciones de
  integración espacial, con dispersión de muestreo; los tests históricos con otra
  densidad presentan aproximadamente −10,6 % y −8,4 % respectivamente.
- El VD de HFrEF expulsa geométricamente unos **83,2 mL**, frente a **21,8 mL** de
  flujo anterógrado izquierdo. No se atribuye toda diferencia a error sin integrar
  también insuficiencia tricuspídea: esa integral todavía no está representada en
  las tablas. La discrepancia ya figura como deuda, no como validación de continuidad.
- En la matriz SSN supina no aparecen muestras de aorta descendente en los doce
  casos. Normal, fase 0: arco 1472 muestras; descendente 0. En lateral izquierdo la
  adquisición anterior sí alcanza 110 muestras de descendente. La guía TTE exige
  explorar desde supino; el cuello/tráquea y la orientación requieren revisión.
- Prueba de tira PW real durante dos segundos: anchura 320, paso 20 ms y barrido
  50 mm/s conserva tiempo (razón real/representado 0,9994). Anchura 1024 y paso 50 ms
  genera **400 columnas frente a 1024 esperadas** a 50 mm/s; razón **2,5248**.
  A 100 mm/s genera **400 frente a 2048**, razón **5,0271**. Medido con timestamps
  adquiridos, no con fase × RR nominal. El límite de diez columnas conserva deuda
  pero fecha cada lote cerca del presente. El sesgo exacto de VTI de una onda clínica
  no se deduce de esta razón: se verificará con un fantoma independiente.
- Navegador Chromium, build nuevo, escritorio 1440×900 y móvil 390×844; modos B,
  Color, PW, CW, TDI y M accesibles, sin excepciones JS. En ocho segundos de escena
  estable se recibieron 132 cuadros (**16,5/s**), servidos desde caché; no son 16,5
  trazados completos/s. El panel indicaba frecuencia física simulada ~68,6 Hz.
  CPU media del cuadro de origen ~139 ms; tres trazados de alta calidad 406–486 ms.
  Móvil: documento 390 px sin desbordamiento, sector 378 px. GPU SwiftShader/fallback;
  no se extrapola este resultado a hardware físico ni a todos los dispositivos.
- Banco de fidelidad: 169 observaciones, 168 cumplidas y una limitación declarada
  SSN supina; 48 adquisiciones reproducibles. Dos ejecuciones concordantes. Un fallo
  del banco sale con error; una limitación resuelta también exige actualizar su estado.

Artefactos de sesión fuera de git: `/tmp/echotwin-audit-after100/` contiene matriz,
truth, timestamps, capturas y registro de navegador; scripts de generación en
`/tmp/echotwin-audit-{matrix,truth,temporal,browser}.*`. Su disponibilidad es local,
no se presentan como archivos públicos permanentes. El banco versionado es
`npm run fidelity:audit`; las regresiones de cada hallazgo se incorporarán en su PR.

## Fundamentos contrastados

- ASE TTE 2019, DOI [10.1016/j.echo.2018.06.004](https://doi.org/10.1016/j.echo.2018.06.004):
  instrumentación, barrido para temporización/VTI, posición supraesternal y descendente.
- ASE Doppler cuantitativo 2002, DOI [10.1067/mje.2002.120202](https://doi.org/10.1067/mje.2002.120202):
  integral velocidad-tiempo, volumen de muestra y densidad espectral.
- ASE diástole 2025, DOI [10.1016/j.echo.2025.03.011](https://doi.org/10.1016/j.echo.2025.03.011):
  figura 2 y tabla 6. Rangos e′ por edad; disfunción y presión elevada no son equivalentes.
  En el caso de 70 años, e′ lateral 8 cm/s figura bajo el umbral heredado de 10,
  aunque supera el umbral de 7 para mayores de 65. Esto no convierte por sí solo
  ese caso en normal ni excluye disfunción por los restantes criterios.
- ASE corazón derecho 2025, DOI [10.1016/j.echo.2025.01.006](https://doi.org/10.1016/j.echo.2025.01.006):
  probabilidad de hipertensión pulmonar con velocidad TR y signos adicionales;
  la etiqueta actual basada sólo en PSVD ≥50 necesita revisión.
- ASE artefactos 2026, DOI [10.1016/j.echo.2026.01.007](https://doi.org/10.1016/j.echo.2026.01.007):
  tiempo de propagación, trayectos múltiples y reflectores; no valida automáticamente
  los efectos de postprocesado existentes.
- Referencias anatómicas, de continuidad y de IQ de los PR96/98/99 están en sus
  decisiones. El atlas TEE se usa como referencia de navegación/relación plano–3D;
  no sustituye anatomía TTE, ni se copian sus mallas o vistas transesofágicas.

## Próxima tanda: diez bloques ejecutables

El orden aborda primero coherencia estructural y medición; luego propagación,
anatomía/mecánica y adquisición. Cada bloque tendrá PR, comparación contra base,
regresión por mutación, pruebas pertinentes, revisión visual si cambia imagen,
CI y merge cuando estén aprobados. Un límite físico no resuelto se documenta,
no se oculta relajando pruebas. Se puede ajustar el alcance ante evidencia nueva.

| Orden | Bloque | Criterio verificable de aceptación |
| --- | --- | --- |
| 1 | Reloj de tira y muestreo espectral separados de píxeles | Timestamps y duración correctos a 320/1024 px, 25/50/100 mm/s y pasos variables; VTI de fantoma estable; coste acotado y resolución temporal declarada. |
| 2 | Contexto de latido histórico para adquisición | Muestras al cruzar QRS usan RR/tablas de su instante, incluida FA y respiración; continuidad y procedencia sin reconstruir desde el latido actual. |
| 3 | Criterios clínicos y rangos con contexto | e′ por edad y citas correctas; separar disfunción de presión; PH sin inferencia excesiva. Fronteras y casos verificables contra guías. |
| 4 | Propagación CW en la escena adquirida | Eliminar dependencia del último B/THI; sombras/contacto/frecuencia a la fase de cada muestra y concordancia con PW donde corresponda. |
| 5 | Potencia recibida y volumen de muestra | Atenuación continua y obstrucción parcial afectan peso espectral; recepción normalizada físicamente sin cancelar la atenuación en el estimador. Fantomas y barridos de apertura. |
| 6 | Continuidad AI–VI en dilatación | Eliminar el recorte patológico de AI HFrEF conservando unión mitral, volúmenes y vecinos en todo el ciclo; CPU/GPU/3D coherentes. |
| 7 | Volumen del VI con aplanamiento septal | Geometría conserva el volumen de tablas mientras cambia forma; integrales y medidas no divergen por compresión septal. |
| 8 | Mecánica del VD ligada al balance de flujo | Integrar flujos valvulares relevantes y volumen geométrico; reducir deuda de regurgitación con aproximaciones y límites explícitos. |
| 9 | Acceso supraesternal supino anatómicamente fundado | Localizar obstrucción y corregir pose/topografía apropiada; arco y descendente accesibles con transiciones causales, sin desactivar pulmón. |
| 10 | Coste del trazador y fidelidad bajo interacción | Perfilar antes de optimizar, acelerar consultas geométricas sin cambiar resultados, verificar latencia y calidad durante movimiento; repetir auditoría y cerrar resultados/incertidumbres. |

Persistirán tareas posteriores: PSF/RF más completas, partículas advectadas y
clutter IQ, movimiento regional/torsional, anatomía individual, revisión clínica
externa y evaluación con pacientes no usados en calibración. Estas limitaciones
impiden calificar el producto como simulador profesional de fidelidad validada.
