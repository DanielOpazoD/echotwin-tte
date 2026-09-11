# Auditoría anatómica del modelo cardíaco (2026-09-11)

Análisis previo a la reconstrucción geométrica pedida el 2026-09-11 («el corazón debe reconocerse de inmediato por un ecocardiografista»). Método: lectura completa de `heartModel.ts` (1266 líneas) y de su espejo GLSL, mapas de estructuras por plano (`slice-map.ts`, 10 vistas × 2 fases), imágenes ecográficas (`render-views.ts`, 8 vistas × 2 fases), auditoría de planos (`audit-views.ts`) y medidor (`npm run measure`, 44 medidas). Todo sobre el caso normal; los demás casos derivan del mismo motor.

## 1. Resultado numérico: las proporciones ya son correctas
- Las 44 medidas del caso normal están dentro de los rangos ASE/EACVI (VTD 123 mL, DTDVI 4,80 cm, SIV 0,90, PP 0,88, VD basal 3,12, AI AP 3,56, anillo aórtico 2,48, senos 3,16, UST 2,80, aorta ascendente 2,98, VD/VI basal 0,64, TV/MV 1,10...).
- Los planos canónicos tienen errores de plano ≤ 7° (salvo los ejes cortos obtenidos desde el 3.º espacio: 17–24°, decisión 28) y de rotación ≤ 7° (PLAX 31° por convención de pantalla).
- Conclusión: **el problema no es de tamaño ni de posición global, sino de forma**. Las medidas lineales «pasan» aunque las estructuras sean elipsoides y esferas.

## 2. Cómo está construido el modelo actual
| Estructura | Primitiva actual | Consecuencia visible |
|---|---|---|
| Cavidad VI | Elipsoide prolato (a, b = 0,94a, c) recortado por el plano anular con `smax`; radio resuelto del volumen cada cuadro | Simétrico respecto del eje; el tercio apical se estrecha como una elipse (radio 0,6·R a 80 % de la longitud; real ≈ 0,75·R); ápex puntiagudo |
| Pared VI | Banda del SDF de espesor `t(az)` = interpolación coseno SIV↔PP × ruido ±14 %; salto brusco al espesor apical a 0,5 cm del ápex; engrosamiento global de la relación epi/endo elipsoidal | Espesor casi uniforme a lo largo del eje; no hay adelgazamiento apical progresivo |
| Papilares | Dos cápsulas axiales que flotan 0,8 cm dentro de la cavidad (base a 0,65·a del eje) | En PSAX-PM aparecen como dos puntos separados de la pared («dibujo») |
| Trabéculas | Ruido de retícula sobre el SDF apical en coordenadas del mundo | Rugosidad isótropa que no se mueve con la pared |
| VD | Semiluna paramétrica entre surcos (92°→212°) con meseta acimutal, afilamiento **elíptico** desde el plano tricuspídeo y cierre de puntas por `max(d, 0,35 − t)` | En A4C el VD abomba en el tercio medio en vez de ser triangular; puntas «cuadradas» en los surcos; ápex sin trabéculas; TSVD/AP como cápsulas rectas de radio constante; válvula pulmonar = disco |
| AI | Elipsoide 2,4k × 1,8k × 2,55k | Esférica en A4C/A2C; pared posterior redonda (real: aplanada contra aorta descendente/esófago); techo redondo |
| AD | Elipsoide casi esférico | Sin VCS ni VCI ni orejuela; esférica |
| Tabique interauricular | Zona de unión entre elipsoides + plano \|x − x_ias\| < 0,3 | Grosor uniforme 0,5–0,6 cm sin fosa oval |
| Mitral | Faldón de revolución con dos zonas (anterior/posterior) sobre anillo en silla; 4 cuerdas rectas | Sin festones ni comisuras; la coaptación es un anillo, no una línea; cuerdas nacen de puntos fijos |
| Tricúspide | Mismo faldón; desplazamiento apical 0,3 cm | Sin valva septal diferenciada; desplazamiento apical corto (real 0,5–1,0 cm) |
| Aórtica | Cadenas de 2 segmentos por cúspide + aletas de coaptación; senos como perfil radial simétrico `sin(πt/2,2)` | Raíz circular en PSAX-AV (real: trébol suave); sin nódulos; inserción plana (documentado) |
| Pulmonar | Disco de 0,08 cm en la unión TSVD/AP | Nunca se ven cúspides |
| Vasos | Aorta ascendente con curva a partir de t = 3 y fin a 6,5 cm; AP recta sin bifurcación; 4 venas pulmonares cápsulas cortas; seno coronario recto; sin VCS/VCI/venas hepáticas | Subcostal imposible (no hay VCI); la bifurcación pulmonar no existe en PSAX-AV |
| Pericardio | Envolvente 0,12 cm sobre la unión de todos los epicardios (elipsoide epicárdico separado del SDF de la pared) | Línea brillante uniforme en todo el contorno |
| Trazado | Un solo plano por línea (sin grosor de corte); grano de speckle fijo por tejido; resolución lateral constante con la profundidad | Bordes «vectoriales», papilares y banda moderadora aparecen/desaparecen de golpe; falta la neblina de las estructuras fuera de plano |

## 3. Errores por categoría
**Anatómicamente incorrectos**: papilares flotantes; válvula pulmonar sin cúspides; aurículas esféricas; ausencia de VCS/VCI/venas hepáticas/bifurcación pulmonar; tabique interauricular sin fosa oval; ápex del VI elíptico.

**Proporción**: ninguna medida lineal fuera de rango, pero el perfil apical del VI (relación anchura apical/anchura máxima) y la forma triangular del VD no se miden y están mal; el desplazamiento apical de la tricúspide es corto.

**Relaciones espaciales**: correctas en lo global (VD anterior, AI posterior a la raíz, raíz central a 33°, TSVD cruzando sobre la raíz, tabique orientado). Fallan las relaciones venosas (VCI→AD desde el hígado; VCS desde arriba; venas pulmonares derechas por detrás de la AD) y la pared posterior de la AI contra la aorta descendente.

**Coherencia entre vistas**: garantizada por construcción (un solo modelo 3D); no se detectó ninguna estructura que cambie de tamaño o posición entre vistas. La obliquidad de los ejes cortos es una limitación de ventana realista, no del modelo.

**Válvulas y paredes**: simplificaciones listadas arriba; espesor parietal sin gradiente base→ápex; endocardio sin trabéculas orientadas.

**Aspecto ecográfico**: sin grosor de corte, sin pérdida de resolución lateral con la profundidad, bordes endocárdicos duros, pericardio uniforme.

## 4. Arquitectura geométrica propuesta
1. **VI como perfil «bala» tabulado en coordenadas polares** (`lvShape.ts`): perfil analítico g(ζ) (cuello anular ≈ 0,72·R, anchura máxima en el tercio basal, afilamiento superelíptico de exponente 2,0–2,7 según `sphericity`, ápex redondeado) muestreado cada cuadro en una tabla R(φ) desde un centro interior; SDF = (r − R(φ))·cosα con corrección elíptica. El radio máximo sale del volumen de las tablas (∫g²) y el ápex queda fijo. Ventajas: forma arbitraria, prueba interior exacta, misma tabla en CPU y GLSL.
2. **Pared con campo de espesor** T(az, ζ): SIV/PP del caso en la base y mitad, afilamiento cuadrático hacia el espesor apical, modulación suave; **engrosamiento sistólico por conservación del volumen parietal** (factor k resuelto por bisección sobre el volumen del cuerpo polar desplazado), escalado por la motilidad segmentaria. El epicardio es el mismo SDF desplazado T (pericardio y VD lo usan).
3. **Papilares anclados**: conos redondeados desde el interior de la pared (ζ ≈ 0,72) hacia la cavidad (ζ ≈ 0,42), que se mueven con la pared; cuerdas desde sus puntas.
4. **Trabéculas** en coordenadas materiales, anisótropas (crestas longitudinales), crecientes hacia el ápex; en el VD, tercio apical más trabeculado.
5. **VD triangular**: afilamiento lineal con punta redondeada desde la base, perfil acimutal suave sin puntas cuadradas, infundíbulo con subida cuadrática, TSVD curvo, tronco pulmonar con bifurcación (APD por detrás de la aorta ascendente), **válvula pulmonar de tres cúspides** con la misma maquinaria que la aórtica.
6. **Aurículas superelipsoidales**: AI con pared posterior y techo aplanados, venas pulmonares en las esquinas posteriores; AD con **VCS y VCI** (direcciones superior/inferior del torso transformadas al marco cardíaco), vena hepática, válvula de Eustaquio; **fosa oval** en el tabique.
7. **Válvulas**: mitral con tres festones posteriores y zona de coaptación lineal, 8 cuerdas; tricúspide con desplazamiento apical 0,7 cm y valva septal corta; nódulos aórticos y raíz trilobulada suave.
8. **Vistas subcostales** (4C y VCI) con cúpula hepática/diafragma en el tórax; posición `subcostal-supine` con efecto.
9. **Movimiento**: se conserva el motor volumétrico (radio del volumen, longitud del MAPSE, ápex fijo, TAPSE, reservorio auricular); se añade engrosamiento por conservación de masa real y papilares/trabéculas que acompañan la pared. Sin animación por escala uniforme.
10. **Trazado**: grosor de corte por promedio de 1/3/5 planos de elevación según tier (CPU y GPU, mismo esquema), resolución lateral dependiente de la profundidad, borde endocárdico difuso por trabéculas.

Orden de ejecución (el pedido): geometría global → proporciones → relaciones → VI/VD → aurículas → válvulas → vasos → movimiento → trazado → ajuste fino, con `proportions.test.ts`, mapas y renders antes de cada commit; el espejo GLSL y la prueba de equivalencia se actualizan en cada fase.

## 5. Criterio de aceptación
Para cada estructura, la pregunta del pedido («¿tiene esta forma, tamaño, orientación y relación en un corazón humano normal visto por ecocardiografía?») se responde con: medidas del medidor dentro de rango, mapa de estructuras del plano canónico con la silueta esperada (VI bala, VD triangular/semiluna, AI ovoide con venas, AD con cavas) y render revisado a ojo en telediástole y mesosístole antes de regenerar goldens.
