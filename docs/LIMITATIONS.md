# Limitaciones conocidas

Este documento existe para que nadie use el simulador más allá de lo que hace. Cada punto está verificado en el código al 2026-09-10.

## Física no simulada
- Sin propagación de ondas, difracción, interferencia, fase ni RF; el «haz» es un rayo recto por línea y el speckle es ruido de valor en coordenadas materiales, no interferencia de dispersores.
- Sin lóbulos laterales/de rejilla, sin grosor de corte, sin zonas focales múltiples, sin refracción, sin imagen en espejo, sin cola de cometa/ring-down, sin artefactos de movimiento de color.
- Velocidad del sonido uniforme (1540 m/s) y sólo para el frame rate; atenuación en escala relativa, no en dB/cm/MHz medidos; «armónicos» = multiplicadores fijos.
- La sombra por Doppler color y el umbral de visibilidad de referencias usan una atenuación esperada con 2,5 MHz fijo (color) o la frecuencia actual (scoring), no la del cuadro real.
- `caseDef.artifacts` no se lee: los artefactos no se pueden activar/desactivar ni graduar por caso; dependen de geometría y `acousticWindow`.
- Frame rate simulado sin relación con un equipo; la PRF no limita la escala Doppler ni depende de la profundidad.

## Anatomía y patologías simplificadas
- Corazón analítico (elipsoides, tubos, parches, semiluna paramétrica para el VD): sin trabéculas discretas (el endocardio apical del VI y del VD sólo es rugoso), banda moderadora única, orejuela izquierda sin lóbulos reales ni orejuela derecha, venas pulmonares como cuatro tubos cortos, sin VCI/venas hepáticas ni cavas, sin arco aórtico (la aorta ascendente se curva y termina a 6,5 cm), seno coronario como tubo recto; aurículas elipsoidales con tabique plano entre ellas.
- Proporciones: `proportions.test.ts` mide 44 magnitudes por caso contra rangos adultos por sexo; todas están en rango o declaradas por el caso (no hay exenciones). Los rangos marcados «≈» en el medidor son aproximaciones sin cifra de guía (longitud del VD, anillos, tronco pulmonar, fracción de vaciado auricular). La dimensión AP del VD en PLAX (2,4 cm) y la longitud del VD (7,0 cm) dependen del perfil de la semiluna, no de parámetros del caso.
- Planos canónicos de eje corto: se obtienen desde el 3.º espacio con inclinación, por lo que son oblicuos respecto del eje largo (PSAX-MV ≈ 24°, PSAX-AV ≈ 17°): el VI se ve algo ovalado y la pared aparentemente más gruesa en el nivel mitral; el nivel papilar es casi perpendicular (0,5°).
- Válvulas como faldones de revolución sobre anillos en silla de montar (mitral, tricúspide) y cúspides de dos segmentos (aórtica): perfiles poligonales rígidos por tramos, sin prolapso, sin vegetaciones, sin comisuras reales; la inserción de las cúspides sigue siendo un anillo plano (no una corona): el signo de Y del PSAX aórtico en diástole lo producen tres aletas radiales de coaptación añadidas a las cúspides, y a media altura se ve además un triángulo formado por los bordes libres rectos; cuatro cuerdas tendinosas simplificadas; la calcificación es un brillo más atenuación (~10 dB/cm) sin geometría propia.
- Estenosis aórtica: la severidad viene de `avEffectiveAreaCm2` (vena contracta) y de la fracción de apertura, sin relación mecánica entre ambas; el caso incluido usa un área efectiva de 0,95 cm² que, según `computeGroundTruth`, produce Vmax 4,35 m/s, gradiente medio 38 mmHg, VTI 82 cm e índice VTI 0,27: cumple «severa» por Vmax ≥ 4 y AVA < 1,0, pero el gradiente medio queda por debajo de los 40 mmHg que enuncian el comentario del archivo («≈ 45») y su `impressionTruth` («≥ 40»).
- Sin regurgitaciones (salvo un chorro de IT paramétrico derivado de PASP), sin estenosis mitral, sin miocardiopatías más allá de amplitud segmentaria (que ningún caso usa), sin prótesis, sin congénitas, sin pericarditis constrictiva (el derrame existe como capa de líquido sin fisiología).
- Ritmo: sinusal y FA; `sinus-tachycardia`/`sinus-bradycardia` no añaden nada; sin extrasístoles ni bloqueos; ECG de gaussianas sin derivaciones.
- Diástole y corazón derecho parametrizados (E, A, DT, IVRT, e′, S′, TAPSE, PASP) sin acoplamiento entre parámetros: un caso puede ser físicamente incoherente si se escribe mal (sólo cuatro validaciones cruzadas).
- Tórax de superelipse; la posición `subcostal-supine` no cambia nada; la elevación de la cabeza (`headElevationDeg`) se ignora.

## Mediciones no validadas
- Las herramientas sólo tienen una prueba E2E (un caliper que produce > 0,5 cm); el mapeo píxel↔cm y las herramientas de velocidad/VTI/tiempo no tienen prueba unitaria.
- Las mediciones no llevan etiqueta semántica; el informe empareja con la verdad «más cercana», así que la desviación puede ser engañosa; el puntuador de examen hace lo mismo por tipo de herramienta.
- Sin Simpson, TAPSE, FAC, áreas, PHT, corrección de ángulo, DT/IVRT sobre el espectro, ni cálculos compuestos (VS, AVA) desde mediciones del usuario.
- Velocidad y VTI dependen de la envolvente dibujada por el usuario sobre un histograma con ruido; no hay trazado automático.
- Los valores de referencia están marcados `recalled`; los cortes de e′ son los de 2016 (ver `docs/REFERENCES.md`). No hay graduación diastólica ni del corazón derecho; la graduación de EA de `report.ts` lee `AORTIC_STENOSIS_RULES` de `reference-values` (valores marcados `recalled`).

## Navegador y rendimiento
- Render procedimental en el worker de **~10 ms por cuadro a calidad media** en Node (`bench.ts`; en el navegador el panel Dev muestra `renderFrameMs`); en núcleos de eficiencia puede duplicarse y la cadencia real quedar por debajo del frame rate simulado; el worker acota su paso a 12–50 ms.
- El atlas construye anclas sólo cuando la sonda está quieta (32 fases, ~1 s); durante un barrido se renderiza directamente (~10 ms por cuadro en Node, más en núcleos de eficiencia). El movimiento reproducido desde un ancla está cuantizado a 32 fases por latido (fase más cercana, sin fundido). No hay atlas pre-generado.
- Color duplica el coste cada dos cuadros; los strips añaden hasta 10 columnas por paso (PW/CW clasifican 20 muestras por columna; M-mode renderiza una línea completa por columna).
- `requestAnimationFrame` se pausa en pestañas ocultas: el worker sigue simulando, pero el canvas no se actualiza y los buffers pendientes se limitan a 2 (se descartan cuadros).
- Sin fallback si `Worker` existe pero falla al cargar el módulo (sólo se captura la excepción del constructor); el modo inline usa `setInterval` de 33 ms.
- Audio Doppler con 48 osciladores siempre activos mientras está encendido; `AudioContext` requiere gesto del usuario en algunos navegadores.
- UI pensada para escritorio con ratón (1440×900 en Playwright); sin soporte táctil ni accesibilidad más allá de etiquetas ARIA básicas; preferencias en `localStorage` sin versionado más allá del sufijo `v1`.
- 9 pruebas E2E y un flujo de CI (`.github/workflows/ci.yml`) que nunca se ha ejecutado en remoto: el repositorio tiene commits locales pero no tiene remoto.

## Qué falta para uso en investigación
- Validación cuantitativa contra un simulador físico (PyMUST/OpenBCSim/i4h) y contra imágenes reales anonimizadas; hoy sólo hay goldens internos y rangos fisiológicos.
- Modelo de PSF y speckle con estadística de Rayleigh medible; atenuación y velocidad del sonido en unidades físicas por tejido.
- Casos con distribución de parámetros (no un solo paciente por caso), semillas por sesión y registro exportable de trayectorias de sonda y mediciones.
- Tolerancias validadas con expertos y estudio de validez educativa: la puntuación de examen es determinista y está probada, pero sus pesos (50/50, ×0,4, −3 puntos por punto porcentual) son elecciones de diseño sin validación.
- Métricas de rendimiento automatizadas y presupuesto de cuadro; hoy `bench.ts` se ejecuta a mano.

## Vistas predeterminadas
- Los botones de vistas mueven la sonda de forma continua hasta la pose canónica calculada para el paciente sintético actual; es una ayuda de demostración. La pose final es la que el motor considera alcanzable desde la ventana (puede ser ligeramente oblicua) y el score no llega a 100 en todas las vistas.
- Están deshabilitadas en modo examen; en modo guiado también fijan la vista objetivo.

## Comportamientos que pueden sorprender
- La sonda arranca en una pose deliberadamente imperfecta cerca de la ventana paraesternal (`START_PROBE`: u 3,4, v 0,4, rotación 25°, tilt 6°, rock −4°); «Reiniciar sonda» vuelve a ella, no a PLAX.
- La tecla C alterna Color/2D; las demás teclas de modalidad fijan el modo. Cambiar de modalidad descongela y reinicia el strip.
- Las herramientas de medición funcionan también en vivo; el cuadro que se registra es el último recibido, no necesariamente el mostrado si la UI va por detrás.
- Al cambiar el tamaño del lienzo (`ResizeObserver`, 320–1024 × 240–820 px) o la geometría del sector se reconstruye la LUT y se pierde la persistencia; las mediciones guardadas mantienen sus píxeles originales y ya no coinciden con la imagen.
- El score «Vista» de la barra superior es el de la mejor vista de la ventana actual, no el de la vista objetivo; en modo guiado el panel de guía muestra ambos.
- «Calidad» sólo cambia líneas y muestras; el atlas se invalida al cambiar posición/respiración del paciente pero no al cambiar de tier (las anclas con otra especificación simplemente no se usan hasta que se construyen nuevas).
- El tutorial de 8 pasos aparece en perfiles sin `tutorialDone`; «Tutorial» en la barra inferior lo reinicia recargando la página. «Guardar PNG» descarga imagen + overlays con marca de agua.
- El backend por defecto es `atlas`; en el panel Dev se puede cambiar a `procedural` para comparar coste y nitidez.
- La verdad de terreno del panel Dev y del informe es la del modelo, no lo que «vería» un observador: por ejemplo el DTS se deriva de VTS/VTD con un factor fijo 0,93.
