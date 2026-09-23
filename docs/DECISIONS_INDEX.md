# Índice de decisiones

Generado por `npx tsx tools/docs/decisions-index.ts` a partir de `DECISIONS.md`; no editar a mano.
Una decisión marcada en su texto con `[Estado: superada por N]` o `[Estado: revertida en N]` lo muestra aquí;
las demás están vigentes. `src/tests/docsConsistency.test.ts` falla si este índice no coincide con el registro.

Decisiones: 160 (última: 160).

| N | Fecha | Decisión | Estado |
|---|---|---|---|
| [1](DECISIONS.md#L7) | 2026-09-10 | Stack | vigente |
| [2](DECISIONS.md#L8) | 2026-09-10 | Anatomía como modelo implícito (SDF) paramétrico | vigente |
| [3](DECISIONS.md#L9) | 2026-09-10 | Atlas pose-condicionado con anclas procedimentales | superada por 50: el atlas ya no mezcla poses, es una caché de pose idéntica |
| [4](DECISIONS.md#L10) | 2026-09-10 | Postproceso en CPU, no en WebGL | superada por 54: la consola y la conversión de barrido corren en la GPU |
| [5](DECISIONS.md#L11) | 2026-09-10 | El simulador vive en un Web Worker y se marca su propio paso | vigente |
| [6](DECISIONS.md#L12) | 2026-09-10 | Frame rate ecográfico simulado | vigente |
| [7](DECISIONS.md#L13) | 2026-09-10 | Speckle en coordenadas materiales | vigente |
| [8](DECISIONS.md#L14) | 2026-09-10 | Punto blanco y escala de grises | vigente |
| [9](DECISIONS.md#L15) | 2026-09-10 | Doppler paramétrico | vigente |
| [10](DECISIONS.md#L16) | 2026-09-10 | Tiempos del ciclo | vigente |
| [11](DECISIONS.md#L17) | 2026-09-10 | A4C↔A2C en el modelo están a 90° | superada por 26 |
| [12](DECISIONS.md#L18) | 2026-09-10 | Eje del TSVI | superada por 26 |
| [13](DECISIONS.md#L19) | 2026-09-10 | Posición canónica de la sonda derivada de la anatomía | vigente |
| [14](DECISIONS.md#L20) | 2026-09-10 | Valores de referencia clínicos marcados `recalled` | vigente |
| [15](DECISIONS.md#L21) | 2026-09-10 | Sin telemetría ni datos de pacientes | vigente |
| [16](DECISIONS.md#L22) | 2026-09-10 | Idioma | vigente |
| [17](DECISIONS.md#L26) | 2026-09-10 | Válvulas como «faldones» de revolución | vigente |
| [18](DECISIONS.md#L27) | 2026-09-10 | Vistas predeterminadas = movimiento continuo, no teletransporte | vigente |
| [19](DECISIONS.md#L28) | 2026-09-10 | Atlas: 32 fases, fase más cercana y construcción sólo con la sonda quieta | superada por 50 |
| [20](DECISIONS.md#L29) | 2026-09-10 | Ruido de retícula (128³) en vez de hash por muestra | vigente |
| [21](DECISIONS.md#L30) | 2026-09-10 | Torso 3D | vigente |
| [22](DECISIONS.md#L31) | 2026-09-10 | Ruido electrónico | vigente |
| [23](DECISIONS.md#L35) | 2026-09-10 | Las proporciones del modelo son una prueba automática | vigente |
| [24](DECISIONS.md#L36) | 2026-09-10 | Correcciones geométricas surgidas del medidor | vigente |
| [25](DECISIONS.md#L40) | 2026-09-10 | VD como semiluna paramétrica, no elipsoide | vigente |
| [26](DECISIONS.md#L41) | 2026-09-10 | Planos apicales a 60° | vigente |
| [27](DECISIONS.md#L42) | 2026-09-10 | Detalles anatómicos añadidos | vigente |
| [28](DECISIONS.md#L43) | 2026-09-10 | Vistas de eje corto desde el mismo espacio que el PLAX | vigente |
| [29](DECISIONS.md#L47) | 2026-09-10 | Trazador procedimental portado a WebGL2 con equivalencia comprobada | vigente |
| [30](DECISIONS.md#L51) | 2026-09-10 | Mediciones semánticas con evaluación de técnica | vigente |
| [31](DECISIONS.md#L55) | 2026-09-11 | Regurgitaciones y obstrucción como flujo de las mismas tablas de latido | vigente |
| [32](DECISIONS.md#L56) | 2026-09-11 | Fisiología estructural de los casos | vigente |
| [33](DECISIONS.md#L57) | 2026-09-11 | Artefactos configurables por caso | vigente |
| [34](DECISIONS.md#L58) | 2026-09-11 | Doce casos | vigente |
| [35](DECISIONS.md#L62) | 2026-09-11 | Flujo de venas pulmonares, modo M color y laboratorio de artefactos | vigente |
| [36](DECISIONS.md#L66) | 2026-09-11 | Capa instruccional local y explicable | vigente |
| [37](DECISIONS.md#L70) | 2026-09-11 | Validación externa preregistrada, no ejecutada | vigente |
| [38](DECISIONS.md#L74) | 2026-09-11 | VI como perfil «bala» tabulado en coordenadas polares | vigente |
| [39](DECISIONS.md#L75) | 2026-09-11 | Pared con campo de espesor y engrosamiento por conservación de masa | vigente |
| [40](DECISIONS.md#L76) | 2026-09-11 | Contabilidad de volúmenes y verdad de terreno | vigente |
| [41](DECISIONS.md#L80) | 2026-09-11 | VD triangular con puntas suaves y ápex trabeculado | vigente |
| [42](DECISIONS.md#L81) | 2026-09-11 | Tracto de salida, tronco pulmonar y válvula pulmonar | vigente |
| [43](DECISIONS.md#L85) | 2026-09-11 | Aurículas aplanadas contra el tabique y fosa oval | vigente |
| [44](DECISIONS.md#L86) | 2026-09-11 | Retorno venoso y ventana subcostal | vigente |
| [45](DECISIONS.md#L87) | 2026-09-11 | Mecánica auricular | vigente |
| [46](DECISIONS.md#L91) | 2026-09-11 | Valvas como láminas con línea de coaptación, festones y tres valvas tricuspídeas | vigente |
| [47](DECISIONS.md#L95) | 2026-09-11 | Vasos y movimiento (fases 5 y 6) sin cambios de arquitectura | vigente |
| [48](DECISIONS.md#L96) | 2026-09-11 | Trazado (fase 7): grosor de corte, resolución lateral con la profundidad y grasa epicárdica | vigente |
| [49](DECISIONS.md#L97) | 2026-09-11 | Ajuste fino (fase 8) | vigente |
| [50](DECISIONS.md#L101) | 2026-09-11 | El atlas deja de sustituir y mezclar poses | vigente |
| [51](DECISIONS.md#L102) | 2026-09-11 | Conversión de barrido con reunión en punto fijo | vigente |
| [52](DECISIONS.md#L106) | 2026-09-11 | El speckle y la resolución salen de una PSF aplicada a una señal compleja, no de ruido y filtros de pantalla | vigente |
| [53](DECISIONS.md#L108) | 2026-09-11 | WebGL por software usa el trazador CPU | vigente |
| [54](DECISIONS.md#L112) | 2026-09-11 | La imagen se forma en la GPU de extremo a extremo | vigente |
| [55](DECISIONS.md#L113) | 2026-09-11 | El worker marca el ritmo contra un horario absoluto | vigente |
| [56](DECISIONS.md#L117) | 2026-09-11 | La persistencia del Doppler color actúa: dos buffers que se alternan | vigente |
| [57](DECISIONS.md#L121) | 2026-09-11 | El navegador 3D corta la misma anatomía implícita que el haz | vigente |
| [58](DECISIONS.md#L125) | 2026-09-11 | El transductor deja de ser un esquema, con la huella tomada de sondas reales y el resto declarado como tal | vigente |
| [60](DECISIONS.md#L129) | 2026-09-11 | Corrección de la 58: el transductor estaba del revés | vigente |
| [59](DECISIONS.md#L133) | 2026-09-12 | La válvula pulmonar y el infundíbulo estaban a más del doble de su distancia real de la aorta; el eje corto de grandes vasos sigue roto por la ventana | vigente |
| [61](DECISIONS.md#L138) | 2026-09-12 | El medidor pasa a comprobar relaciones espaciales, no sólo tamaños; y eso caza tres defectos el mismo día | superada por 62 en la medida pv-above-av, escrita en el marco equivocado |
| [62](DECISIONS.md#L142) | 2026-09-12 | La válvula pulmonar se coloca desde coordenadas del tórax, y el plano de las tres válvulas pasa de 64° a 15° | vigente |
| [63](DECISIONS.md#L146) | 2026-09-12 | Cada vista debe contener lo que muestra, y no contener lo imposible | vigente |
| [64](DECISIONS.md#L150) | 2026-09-12 | La aurícula derecha estaba sellada por su propia pared en el orificio tricuspídeo | vigente |
| [65](DECISIONS.md#L153) | 2026-09-12 | El corazón vive dentro de la pared torácica, y una prueba de física impide corregirlo | revertida en 66 |
| [66](DECISIONS.md#L157) | 2026-09-12 | El corazón sale de la pared torácica, y con él aparece el campo proximal | vigente |
| [67](DECISIONS.md#L161) | 2026-09-12 | El navegador 3D se ve mejor sin dejar de ser el mismo corazón que corta el haz | vigente |
| [68](DECISIONS.md#L165) | 2026-09-12 | El corazón del navegador late, y late en la fase de la imagen | vigente |
| [69](DECISIONS.md#L169) | 2026-09-12 | Comparación contra ecocardiogramas clínicos reales, preparada y verificada antes de tener los datos | vigente |
| [70](DECISIONS.md#L176) | 2026-09-12 | La consola se calibra contra imágenes clínicas de ventana óptima, y la sangre deja de ser negra | vigente |
| [71](DECISIONS.md#L183) | 2026-09-12 | La GPU seguía dibujando la pared auricular sobre la tricúspide, y los E2E no lo vieron porque probaban un build viejo | vigente |
| [72](DECISIONS.md#L186) | 2026-09-12 | El preajuste A3C mostraba pulmón en ocho de los doce casos, y la prueba de contenido de vistas no podía verlo | vigente |
| [73](DECISIONS.md#L189) | 2026-09-12 | La puntuación de ganancia se calibra contra las mismas imágenes clínicas, y deja de pedir sangre negra | vigente |
| [74](DECISIONS.md#L193) | 2026-09-12 | La textura se mide bien antes de corregirla, y dos modelos que igualaban las cifras se descartan por la imagen | vigente |
| [75](DECISIONS.md#L200) | 2026-09-13 | La raíz aórtica terminaba en escalones y el cierre aórtico dibujaba una línea que no existe | vigente |
| [76](DECISIONS.md#L202) | 2026-09-13 | El aparato mitral se rehace sobre un anillo en D colgado de la cortina mitroaórtica | vigente |
| [77](DECISIONS.md#L207) | 2026-09-13 | La raíz aórtica baja con la base y la silla mitral tiene la altura publicada | vigente |
| [78](DECISIONS.md#L210) | 2026-09-13 | La tricúspide tenía los mismos defectos que la mitral, y peores | vigente |
| [79](DECISIONS.md#L214) | 2026-09-13 | Las cúspides aórticas cierran en «Y» y son finas | vigente |
| [80](DECISIONS.md#L218) | 2026-09-13 | El anillo vuelve en diástole a la velocidad del e′ del caso | vigente |
| [81](DECISIONS.md#L220) | 2026-09-13 | La ventana paraesternal es oblicua y se queda donde dice el estándar | vigente |
| [82](DECISIONS.md#L224) | 2026-09-13 | Los papilares desplazados traccionan la mitral en el ventrículo remodelado | vigente |
| [83](DECISIONS.md#L228) | 2026-09-13 | El preajuste A2C deja de deslizarse bajo el pulmón | vigente |
| [84](DECISIONS.md#L231) | 2026-09-13 | El modo M dibuja cada columna en su instante, con una línea que resuelve el pulso | vigente |
| [85](DECISIONS.md#L245) | 2026-09-13 | En el apical de cinco cámaras la válvula aórtica vuelve junto al septo | vigente |
| [86](DECISIONS.md#L247) | 2026-09-13 | El tronco pulmonar sale hacia atrás, arriba y a la izquierda, rodeando la aorta | vigente |
| [87](DECISIONS.md#L251) | 2026-09-13 | Doppler: la señal fuera de escala, el aliasing y la persistencia se comportan como una señal, no como una etiqueta | vigente |
| [88](DECISIONS.md#L258) | 2026-09-13 | Las desviaciones clínicas declaradas tienen un valor basal y no pueden empeorar sin fallar; las pruebas pesadas tienen un tiempo acorde con su coste | vigente |
| [89](DECISIONS.md#L260) | 2026-09-13 | El hueso atenúa por distancia, no por muestra | vigente |
| [90](DECISIONS.md#L262) | 2026-09-13 | La forma de la escala de grises se mide contra CAMUS antes de tocar el ruido | vigente |
| [91](DECISIONS.md#L268) | 2026-09-13 | El ruido del receptor es una señal compleja que pasa la respuesta de recepción y se detecta con el eco, y la consola usa la curva de gris medida en CAMUS | vigente |
| [92](DECISIONS.md#L278) | 2026-09-13 | La geometría apical se mide contra el sector, y el A4C sale mirado desde el lado del septo | vigente |
| [93](DECISIONS.md#L284) | 2026-09-13 | El corazón sigue dentro de la pared torácica, y ahora una prueba lo mide | vigente |
| [94](DECISIONS.md#L288) | 2026-09-13 | La persistencia decae con el tiempo simulado, no por cuadro dibujado | vigente |
| [95](DECISIONS.md#L292) | 2026-09-13 | El latido cierra con sus propios flujos: la corrección de deriva ya no tapa un llenado incompleto | vigente |
| [96](DECISIONS.md#L296) | 2026-09-13 | La envolvente espectral lee la velocidad del volumen de muestra | vigente |
| [97](DECISIONS.md#L304) | 2026-09-13 | La E y la A del caso son los picos que muestra el Doppler: la contracción auricular añade sólo lo que falta hasta la A | vigente |
| [98](DECISIONS.md#L308) | 2026-09-13 | El Doppler tisular mueve cada pared con su e′: el anillo lateral recupera la e′ lateral del caso | vigente |
| [99](DECISIONS.md#L312) | 2026-09-13 | El speckle del cuadro se descorrelaciona a lo largo del grosor del corte, no de una celda de dispersores | vigente |
| [100](DECISIONS.md#L316) | 2026-09-13 | Las válvulas auriculoventriculares flotan semicerradas en la diástasis en lugar de cerrarse | vigente |
| [101](DECISIONS.md#L320) | 2026-09-13 | El final de la contracción auricular cierra la válvula: nada entra después de la onda A | vigente |
| [102](DECISIONS.md#L322) | 2026-09-13 | La onda de llenado viaja hacia el ápex a la Vp del caso | vigente |
| [103](DECISIONS.md#L326) | 2026-09-13 | Las válvulas hacen clic en el trazo espectral cuando se abren y se cierran | vigente |
| [104](DECISIONS.md#L330) | 2026-09-13 | El tiempo de relajación isovolumétrica se mide entre los clics | vigente |
| [105](DECISIONS.md#L332) | 2026-09-13 | El ventrículo derecho eyecta con el tiempo de aceleración de su presión pulmonar | vigente |
| [106](DECISIONS.md#L336) | 2026-09-13 | El anillo tricuspídeo y el Doppler tisular del VD siguen la S′ y el TAPSE del caso | vigente |
| [107](DECISIONS.md#L340) | 2026-09-13 | En fibrilación auricular cada latido llena y eyecta según sus propios intervalos | vigente |
| [108](DECISIONS.md#L344) | 2026-09-13 | Respiración libre: las ondas de llenado varían con la inspiración y el taponamiento muestra su signo Doppler | vigente |
| [109](DECISIONS.md#L346) | 2026-09-13 | El tronco pulmonar tiene el diámetro del caso y se ensancha por encima de los senos | vigente |
| [110](DECISIONS.md#L348) | 2026-09-13 | El plano tricuspídeo vuelve a estar en las valvas | vigente |
| [111](DECISIONS.md#L350) | 2026-09-13 | El tracto de salida y la raíz pulmonar descienden con la base | vigente |
| [112](DECISIONS.md#L352) | 2026-09-13 | La raíz pulmonar se coloca junto a la raíz aórtica, no dentro | vigente |
| [113](DECISIONS.md#L354) | 2026-09-13 | La vena cava inferior se estrecha con la inspiración en respiración libre | vigente |
| [114](DECISIONS.md#L356) | 2026-09-13 | La velocidad anular de los latidos encadenados no tiene un pico en el cambio de latido | vigente |
| [115](DECISIONS.md#L358) | 2026-09-13 | La pantalla del Doppler espectral muestra un estimado con su grano, en escala logarítmica | vigente |
| [116](DECISIONS.md#L360) | 2026-09-13 | El Doppler color es un estimado que dispersa y parpadea | vigente |
| [117](DECISIONS.md#L363) | 2026-09-13 | La cobertura de código se mide y tiene pisos por área, no una cifra global | vigente |
| [118](DECISIONS.md#L365) | 2026-09-13 | La caché representa una adquisición, no sólo una pose, y el foco viaja con el cuadro | vigente |
| [119](DECISIONS.md#L369) | 2026-09-13 | Cada reverberación es un pulso continuo, no una cresta cortada por el redondeo | vigente |
| [120](DECISIONS.md#L377) | 2026-09-13 | Los calipers conservan la calibración de la imagen, también durante el trazado | vigente |
| [121](DECISIONS.md#L383) | 2026-09-13 | Coaptación aórtica y unión VD–tracto de salida, a partir de defectos de las ventanas normales | vigente |
| [122](DECISIONS.md#L391) | 2026-09-13 | La anatomía respiratoria renderizada no puede repetirse desde un latido anterior | vigente |
| [123](DECISIONS.md#L395) | 2026-09-13 | La anisotropía miocárdica sigue la orientación de las fibras, no la normal de la pared | vigente |
| [124](DECISIONS.md#L405) | 2026-09-16 | Ningún número de la cadena acústica se escribe dos veces | vigente |
| [125](DECISIONS.md#L407) | 2026-09-16 | Las funciones escalares puras compartidas por CPU y GPU se generan desde su TypeScript | vigente |
| [126](DECISIONS.md#L409) | 2026-09-16 | El clasificador del corazón se parte en siete bloques con un contexto compartido | vigente |
| [127](DECISIONS.md#L411) | 2026-09-16 | Cada modalidad de imagen se describe una sola vez | vigente |
| [128](DECISIONS.md#L413) | 2026-09-16 | La pose de una vista predeterminada la calcula el worker | vigente |
| [129](DECISIONS.md#L415) | 2026-09-16 | El hilo principal no construye modelos: el navegador 3D recibe los suyos del worker de mallas y el núcleo en línea se carga bajo demanda | vigente |
| [130](DECISIONS.md#L417) | 2026-09-16 | Los bloques del clasificador exponen sus fórmulas escalares y el sombreador las recibe generadas | vigente |
| [131](DECISIONS.md#L419) | 2026-09-16 | La subcostal de la vena cava inferior contiene la cava y la vena hepática en todos los casos | vigente |
| [132](DECISIONS.md#L420) | 2026-09-16 | El navegador 3D marca sobre la piel las ventanas acústicas de las vistas canónicas | vigente |
| [133](DECISIONS.md#L421) | 2026-09-16 | La base del ventrículo derecho que deja libre el descenso del anillo es aurícula, el infundíbulo desciende con la raíz pulmonar y el eje corto de grandes vasos es perpendicular a la raíz | vigente |
| [134](DECISIONS.md#L423) | 2026-09-16 | Modo revisión: marcar sobre la imagen lo que se ve mal y llevarse el estado exacto para reproducirlo | vigente |
| [135](DECISIONS.md#L425) | 2026-09-16 | Los marcadores de revisión se mueven, se seleccionan, se borran con una tecla y se ponen también sobre el modelo 3D | vigente |
| [136](DECISIONS.md#L427) | 2026-09-16 | Un marcador de revisión puede tener puntos secundarios enlazados | vigente |
| [137](DECISIONS.md#L429) | 2026-09-16 | El navegador 3D se divide en dos: la sonda sobre el tórax arriba y el corte cardíaco de frente abajo | superada por 142 en la vista de abajo; la división y las capas siguen |
| [138](DECISIONS.md#L431) | 2026-09-16 | Los velos tricúspides abiertos van paralelos a las paredes y el anillo es una silla anteroseptal de 5 mm | vigente |
| [139](DECISIONS.md#L435) | 2026-09-21 | El eje largo del VI sigue la resonancia de sanos, el ápex descansa contra la pared, todas las vistas apicales comparten la sonda sobre el eje y los haces se apuntan desde su origen | vigente |
| [140](DECISIONS.md#L439) | 2026-09-22 | La pared libre del VD toma la respuesta de fibras y las paredes auriculares dispersan sin anisotropía; la mitral del A5C queda declarada | vigente |
| [141](DECISIONS.md#L443) | 2026-09-22 | El panel de guía de la vista queda plegado por defecto | vigente |
| [142](DECISIONS.md#L445) | 2026-09-22 | El corte ecográfico del navegador es un mapa a color del plano de la imagen, dibujado desde el mapa de estructuras del propio cuadro | vigente |
| [143](DECISIONS.md#L449) | 2026-09-22 | Las venas pulmonares corren hacia los hilios desde la pared lateral y la esquina posteromedial de la aurícula, y ya no hacia atrás | vigente |
| [144](DECISIONS.md#L453) | 2026-09-22 | El haz tiene perfil de enfoque y anchura, la pared torácica capas, el miocardio una hélice de fibras y el entorno del VI se mide contra CAMUS | vigente |
| [145](DECISIONS.md#L457) | 2026-09-22 | La imagen se forma con dos miradas de speckle promediadas tras la detección, el parénquima lleva granos coherentes integrados sobre el corte y el pulso axial es el del filtro armónico | vigente |
| [146](DECISIONS.md#L461) | 2026-09-22 | El sector entero se mide sin etiquetas contra CAMUS, un clasificador puntúa cuánto delata al simulador y la prueba ciega tiene protocolo | vigente |
| [147](DECISIONS.md#L465) | 2026-09-22 | Los postes comisurales aórticos son estrechos, los velos abiertos cuelgan del anillo y una lámina valvular se ve por la fracción del corte que ocupa | vigente |
| [148](DECISIONS.md#L467) | 2026-09-22 | El eje corto de grandes vasos gira 12° hacia la entrada del VD y el anillo tricúspide inclina su borde anterior hacia la raíz: la aurícula derecha se abre al ventrículo por la tricúspide a las 9–10 | vigente |
| [149](DECISIONS.md#L469) | 2026-09-22 | La aurícula derecha alcanza en sístole el volumen declarado: su techo sigue la mitad del TAPSE y la base libre es aurícula sólo sobre el orificio tricúspide | vigente |
| [150](DECISIONS.md#L471) | 2026-09-22 | El mediastino es una columna posterior y otra superior redondeadas: a los lados del corazón el pulmón llega a la almohadilla grasa del pericardio | vigente |
| [151](DECISIONS.md#L473) | 2026-09-22 | La tricúspide fuera del eje corto al final de la sístole es movimiento a través del plano, y la distinguibilidad no cambia con la anatomía del corazón derecho | vigente |
| [152](DECISIONS.md#L477) | 2026-09-22 | Cada muestra de miocardio compacto del VI lleva el segmento del tejido que atraviesa el haz; el 16 cubre el ápex, el 17 empieza donde acaba la cavidad y la motilidad se puntúa aparte de la amplitud | vigente |
| [153](DECISIONS.md#L481) | 2026-09-22 | La imagen ecográfica tiene un botón que colorea los segmentos del VI y nombra el que está bajo el ratón, el corazón 3D también los nombra, y el segmento señalado se resalta en las cuatro vistas | vigente |
| [154](DECISIONS.md#L485) | 2026-09-23 | La app abre en el nivel calibrado, el examen no nombra la vista, las etiquetas de pared siguen a los segmentos, la app sobrevive sin WebGL y dos guardas vuelven a funcionar | vigente |
| [155](DECISIONS.md#L489) | 2026-09-23 | La respuesta lateral tiene lóbulos laterales a −35 dB, y no son lo que ennegrece las cavidades | vigente |
| [156](DECISIONS.md#L491) | 2026-09-23 | El músculo de la pared torácica baja a su gris clínico y el campo cercano entra en el rango de CAMUS | vigente |
| [157](DECISIONS.md#L493) | 2026-09-23 | La reducción de speckle y un rango dinámico mayor, medidos contra el VI y el sector a la vez, no se adoptan | vigente |
| [158](DECISIONS.md#L495) | 2026-09-23 | La fase de los ecos de interfaz no quita las crestas finas: son las líneas A de la pleura y el pericardio | vigente |
| [159](DECISIONS.md#L497) | 2026-09-23 | La imagen no se convierte a la densidad del dispositivo: la rejilla polar es más gruesa que el píxel | vigente |
| [160](DECISIONS.md#L499) | 2026-09-23 | La documentación de física dice lo que hace el código, y sus tablas están protegidas | vigente |
