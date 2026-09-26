# Referencias clínicas

Fuente de esta página: la revisión del 2026-09-10 (páginas de guías de la ASE, PDF alojados por la ASE, PubMed E-utilities). Se mantienen las marcas **VERIFIED** (leído en el documento primario o en PubMed), **SECONDARY** (resumen de terceros), **FROM-MEMORY** (no recomprobado) y **NOT VERIFIED** de la revisión. No se copian tablas de las guías; sólo los cortes concretos que el código usa o debería usar.

En el código, cada referencia vive en `src/clinical/guidelines/references.ts` con un `id`, `accessedAt: 2026-09-10`, `usedBy` y `verification`. **Todas las entradas están marcadas `title-verified`**, y todos los valores de `src/clinical/reference-values/index.ts` llevan `confidence: 'recalled'`: el código todavía no refleja la verificación de esta página. La pantalla «Referencias» de la app muestra esa tabla tal cual.

## Documentos
| Id en código | Documento | Cita | Estado |
|---|---|---|---|
| `ase-tte-2019` | Guidelines for Performing a Comprehensive TTE Examination in Adults (ASE) | Mitchell C, et al. JASE 2019;32(1):1-64. DOI 10.1016/j.echo.2018.06.004. PMID 30282592 | VERIFIED; sin versión posterior |
| `ase-diastolic-2025` | LV Diastolic Function… and HFpEF Diagnosis: An Update (ASE) | Nagueh SF, et al. JASE 2025;38(7):537-569. DOI 10.1016/j.echo.2025.03.011. PMID 40617625 | VERIFIED; sustituye a 2016; sin revisión posterior |
| `ase-right-heart-2025` | Echocardiographic Assessment of the Right Heart in Adults… (ASE) | Mukherjee M, Rudski LG, Addetia K, et al. JASE 2025;38(3):141-186. DOI 10.1016/j.echo.2025.01.006. PMID 40044341 | VERIFIED. Erratum JASE 2025;38(7):641 (PMID 40617627) registrado; su contenido **NOT VERIFIED**; la ASE aloja un PDF «May 2025», presumiblemente corregido (**NOT VERIFIED**) |
| `ase-reporting-2025` | Standardization of Adult Echocardiography Reporting (ASE) | JASE 2025;38(9):735-774. DOI 10.1016/j.echo.2025.06.001. PMID 40912865 | VERIFIED (primer autor no capturado) |
| `ase-eacvi-strain-2025` | Clinical Applications of Strain Echocardiography (ASE/EACVI) | JASE 2025;38(11):985-1020. DOI 10.1016/j.echo.2025.07.007. PMID 40864001 | VERIFIED; sin uso en el código («future») |
| `ase-artifacts-2026` | Identification and Mitigation of Cardiac Ultrasound Artifacts (ASE) | Saric M, Sadeghpour A, Alizade L, et al. JASE 2026;39(5):435-475. DOI 10.1016/j.echo.2026.01.007. PMID 42070896 | VERIFIED vía PubMed; la fecha 2025-11-03 del índice ASE es presumiblemente online-first (**NOT VERIFIED**) |
| `ase-scmr-regurgitation-2017` | Noninvasive Evaluation of Native Valvular Regurgitation (ASE/SCMR) | Zoghbi WA, et al. JASE 2017;30(4):303-371. DOI 10.1016/j.echo.2017.01.007. PMID 28314623 | VERIFIED; sin uso («future») |
| `ase-prosthetic-2024` | Evaluation of Prosthetic Valve Function (ASE/SCMR/SCCT) | Zoghbi WA, et al. JASE 2024;37(1):2-63 | VERIFIED por búsqueda y página ASE; DOI no capturado; sin uso |
| `ase-eacvi-chamber-2015` | Cardiac Chamber Quantification by Echocardiography in Adults (ASE/EACVI) | Lang RM, Badano LP, Mor-Avi V, et al. JASE 2015;28(1):1-39.e14. DOI 10.1016/j.echo.2014.10.003. PMID 25559473 | VERIFIED. **Aviso**: JASE anunció un número monográfico con nuevas guías de cuantificación para inicios de 2026; no localizadas en PubMed ni en la ASE al 2026-09-10 — recomprobar antes de publicar |
| `ase-eacvi-aortic-stenosis-2017` | Echocardiographic Assessment of Aortic Valve Stenosis: A Focused Update (EACVI/ASE) | Baumgartner H, Hung J, Bermejo J, et al. JASE 2017;30(4):372-392. DOI 10.1016/j.echo.2017.02.009. PMID 28385280 | VERIFIED; sin actualización ASE/EACVI posterior. La URL en el código (`…/echocardiographic-assessment-of-aortic-valve-stenosis/`) difiere de la de la revisión (`…/update-of-aortic-valve-stenosis/`): cuál está viva es **NOT VERIFIED** |

### Anatomía del anillo tricúspide (decisión 138)
| Id en código | Documento | Cita | Estado |
|---|---|---|---|
| `fukuda-ta-2006` | Three-dimensional geometry of the tricuspid annulus in healthy subjects and in patients with functional tricuspid regurgitation (RT3DE) | Fukuda S, et al. Circulation 2006;114(1 Suppl):I492-8. PMID 16820625 | VERIFIED vía PubMed: anillo no plano en sanos, porción anteroseptal la más alta (auricular) y posteroseptal la más baja (hacia el ápex) |
| `malinowski-ta-2019` | Sonomicrometry-derived 3-dimensional geometry of the human tricuspid annulus | Malinowski M, Jazwiec T, Goehler M, et al. J Thorac Cardiovasc Surg 2019;157(4):1452-1461.e1 | VERIFIED por búsqueda: puntos altos en la comisura anteroseptal y la región medioposterior, altura máxima 5,0 ± 1,1 mm |
| `muraru-ta-2022` | Reference ranges of tricuspid annulus geometry in healthy adults using a dedicated 3D echocardiography software package | Muraru D, Gavazzoni M, Heilbron F, et al. Front Cardiovasc Med 2022;9:1011931. DOI 10.3389/fcvm.2022.1011931 | VERIFIED (texto completo en PMC9513148): silla con puntos altos anteroseptal y posterolateral y bajos anterolateral y posteroseptal; telediástole área 9,6 ± 2,1 cm², diámetro 4C 33 ± 4 mm |

### Orientación del corazón y ventana apical (decisión 139)
| Id en código | Documento | Cita | Estado |
|---|---|---|---|
| `engblom-axis-2005` | The relationship between electrical axis by 12-lead electrocardiogram and anatomical axis of the heart by cardiac magnetic resonance in healthy subjects | Engblom H, Foster JE, Martin TN, et al. Am Heart J 2005;150(3):507-12. DOI 10.1016/j.ahj.2004.10.041. PMID 16169332 | VERIFIED (resumen en PubMed): eje anatómico del VI en 94 sanos, frontal +38 ± 10°, transversal +46 ± 7° |
| `martin-axis-2003` | Comparison of the anatomical and electrical cardiac axes in subjects with no history of cardiac disease | Martin TN, Wagner GS, Groenning BA, et al. Proc ISMRM 2003;11:1586 | VERIFIED (texto del resumen): eje anatómico frontal 39 ± 14°, horizontal 51 ± 8°, definido del centro de la mitral a la punta del VI en el 4C; reproducibilidad 16 % y 8,7 % |
| `gottlieb-lld-2021` | A left lateral body position increases pulmonary vein stress in healthy humans | Gottlieb LA, El Hamrani D, Naulin J, et al. Physiol Rep 2021;9(18):e15022 | VERIFIED (texto completo en PMC8461032): RM en 20 sanos; de supino a decúbito lateral izquierdo el VI se desplaza 1,1 cm lateral (8,8 → 9,9 cm desde la vértebra) y 1,3 cm anterior (13,3 → 14,6 cm) |
| `rosman-precordial-1990` | Precordial Impulses (Clinical Methods, 3.ª ed., cap. 21) | Rosman HS. En: Walker HK, Hall WD, Hurst JW (eds). Butterworths 1990. NBK322 | VERIFIED (NCBI Bookshelf): latido apical normal de menos de 3 cm, dentro de la línea medioclavicular; el decúbito lateral izquierdo lo desplaza lateralmente |
| `wickline-aniso-1992` | Three-dimensional characterization of human ventricular myofiber architecture by ultrasonic backscatter | Wickline SA, Verdonk ED, Wong AK, Shepard RK, Miller JG. J Clin Invest 1992;89(2):572-580 | VERIFIED por búsqueda (texto en JCI): retrodispersión integrada 14,5 ± 0,6 dB mayor con insonación perpendicular que paralela a las fibras en miocardio ventricular humano |
| `leclerc-camus-2019` | Deep Learning for Segmentation Using an Open Large-Scale Dataset in 2D Echocardiography (CAMUS) | Leclerc S, Smistad E, Jodoin PM, et al. IEEE TMI 2019;38(9):2198-2210 | VERIFIED: 505 secuencias de calidad Good medidas con `tools/clinical/camus-compare.ts`; geometría apical de referencia en `camusApicalGeometry.ts` (ápex del 4C a 0 mm de la línea central, RIC −3,9 a 3,2; profundidad 27 mm; eje 6°) |

### Física del haz y fibras del miocardio (decisión 144)
| Id en código | Documento | Cita | Estado |
|---|---|---|---|
| `streeter-fibre-1969` | Fiber orientation in the canine left ventricle during diastole and systole | Streeter DD Jr, Spotnitz HM, Patel DP, Ross J Jr, Sonnenblick EH. Circ Res 1969;24(3):339-347. DOI 10.1161/01.RES.24.3.339 | VERIFIED (resumen en AHA Journals): 18 corazones caninos fijados en sístole, diástole y diástole dilatada; el ángulo de las fibras varía de ≈ +60° (endocardio) a ≈ −60° (epicardio) respecto de la dirección circunferencial y no cambia de diástole a sístole (28 % de engrosamiento) |
| `kato-pv-2003` | Pulmonary vein anatomy in patients undergoing catheter ablation of atrial fibrillation: lessons learned by use of magnetic resonance imaging | Kato R, Lickfett L, Meininger G, et al. Circulation 2003;107(15):2004-2010. PMID 12681994 | VERIFIED (resumen en PubMed): 28 pacientes y 27 controles por RM; los ostios de las venas pulmonares son ovalados, con el diámetro anteroposterior menor que el superoinferior (el modelo los deja redondos, LIMITATIONS) |

### Aparato subvalvular mitral (decisión 225)
| Id en código | Documento | Cita | Estado |
|---|---|---|---|
| `zhang-pm-2026` | Evaluation of Left Ventricular Papillary Muscles Using Targeted Views by Echocardiography | Zhang L, Xie Y, Zhang X, et al. J Clin Med 2026;15(9):3496. DOI 10.3390/jcm15093496 | VERIFIED (texto completo en PMC13163397): 245 adultos sanos; longitud telediastólica 28 ± 3 mm (anterolateral) y 28 ± 2 (posteromedial), telesistólica 21 ± 3; diámetro medio 8,5 ± 0,9 y 8,1 ± 0,9 mm; origen en el tercio medio (0,33–0,66 de la distancia ápex–anillo desde el ápex) en el 97 y el 93 %; distancia vertical de la punta al anillo mitral 22,4 ± 3,3 mm en sístole precoz y 22,3 ± 3,5 en la tardía; distancia interpapilar 21,8 ± 1,7 mm en telediástole y 10,6 ± 2,1 en telesístole |
| `li-pm-2024` | Left Ventricular Papillary Muscle: Anatomy, Pathophysiology, and Multimodal Evaluation | Li S, Wang Z, Fu W, et al. Diagnostics (Basel) 2024 (PMC11202998) | VERIFIED (texto completo): por TC multidetector (Axel, 25 sujetos) los músculos papilares se unen a la pared a través de una red de trabéculas entrelazadas, no directamente al miocardio compacto |

## Mapeo a `src/clinical/reference-values` y discrepancias
| Regla en código | Valor en código | Valor verificado | Acción |
|---|---|---|---|
| `LV_RULES.lvEddNormalMen/Women` | 4,2–5,8 / 3,8–5,2 cm | [R9] 42,0–58,4 / 37,8–52,2 mm (VERIFIED) | concuerda (redondeo) |
| `ivsdNormal`, `lvpwdNormal` | 0,6–1,0 cm (nota: mujeres 0,6–0,9) | [R9] hombres 0,6–1,0; mujeres 0,6–0,9 | concuerda; separar por sexo si se gradúa |
| `lvefNormalLowerMen/Women` | 52 / 54 % | [R9] 52–72 / 54–74 % | concuerda |
| `laviUpperNormal` | 34 mL/m² | [R9] 34 | concuerda |
| `AORTIC_STENOSIS_RULES.severeVmax / severeMeanGradient` | 4,0 m/s / 40 mmHg | [R10] ≥ 4,0 / ≥ 40 | concuerda |
| `severeAva` | «≤ 1,0» en la nota | [R10] < 1,0 cm² (indexada < 0,6) | ajustar el signo en la nota y en `report.ts` |
| `moderateVmax`, `moderateMeanGradient`, `moderateAva` | 3,0–3,9; 20–39; 1,0–1,5 | [R10] 3,0–4,0; 20–40; 1,0–1,5 | límites superiores abiertos; usar 4,0/40 con «<» |
| `severeVelocityRatio` | < 0,25 | [R10] < 0,25 | concuerda |
| `RIGHT_HEART_RULES.tapseAbnormal` | 1,7 cm | [R3] normal > 1,7; leve ≤1,7–>1,3; moderada ≤1,3–>1,0; severa ≤ 1,0 | concuerda como umbral; añadir grados |
| `facAbnormal`, `sPrimeAbnormal` | 35 %; 9,5 cm/s | [R3] > 35; > 9,5 | concuerda |
| `rapFromIvc` | ≤2,1 cm y >50 % → 3; >2,1 y <50 % → 15; otro → 8 | [R3] igual, medido 0,5–3,0 cm de la AD; >2,5 cm con <50 % puede considerarse 20 | concuerda; la nota «re-verify» puede retirarse |
| `DIASTOLIC_RULES.averageEeAbnormal` | 14 | [R2] media ≥ 14 (>14 alta especificidad; <8 normal; 8–14 gris); septal ≥ 15, lateral ≥ 13 | concuerda; faltan los cortes por lado |
| `septalEPrimeAbnormal`, `lateralEPrimeAbnormal` | 7 / 10 cm/s (valores 2016) | [R2] septal ≤ 6, lateral ≤ 7, media ≤ 6,5 (independientes de la edad), más límites por edad | **desactualizados**: sustituir antes de graduar |
| `trVelocityAbnormal` | 2,8 m/s | [R2]/[R3] ≥ 2,8 (o PASP ≥ 35) | concuerda |
| `REPORT_PRECISION` | 1 decimal cm, 2 m/s, 0 mmHg/mL/%… | [R4] velocidades, áreas y lineales no más allá de 0,1; hemodinámica y volúmenes enteros | velocidades con 2 decimales exceden la recomendación (0,1) |
| TSVI: sitio de medición | hint en `viewTargets` y objetivos de caso | [R1] PLAX zoom, borde interno a borde interno, 3–10 mm bajo el plano valvular, mesosístole, donde se sitúa el PW | coherente; no se valida en las mediciones |
| BSA | Mosteller (código); DuBois disponible | [R9] las poblaciones de referencia usaron Mosteller; sin recomendación explícita (NOT STATED) | mantener |
| Diámetro del TSVI «normal» | no existe regla | [R9] no da rango; ≈2,0 cm es FROM-MEMORY | derivar del fantoma, no citar |

## Cambios 2025–2026 relevantes para el simulador
- Diástole 2025: cortes de e′ más bajos y promedio añadido, E/e′ por lado, strain de reservorio de AI (≤ 18 %) como marcador de segunda etapa, IVAI movido a la segunda etapa, PASP ≥ 35 aceptado, exclusiones explícitas y sección HFpEF.
- Corazón derecho 2025: rangos leve/moderado/severo en vez de cortes únicos, acoplamiento TAPSE/PASP, VCI medida 0,5–3,0 cm de la AD, HP definida como PAPm > 20 mmHg (SECONDARY).
- Informe 2025: campos obligatorios (fechas ordenado→realizado→interpretado, plataforma/transductor, tabla de mediciones con unidades y decimales, resumen con ≥ 3 elementos, comunicación de hallazgos críticos). El informe educativo del simulador no implementa esa estructura.
- Artefactos 2026: cubre 2D, Doppler espectral/color, 3D, ETT y ETE con apariencia, mecanismo, impacto y mitigación por artefacto; es la referencia de `docs/ARTIFACT_ENGINE.md`.

## Reglas verificadas que el código todavía no codifica
Resumen de los cortes leídos en los documentos primarios (VERIFIED salvo indicación), para cuando se implementen los módulos correspondientes:
- **EA [R10]**: esclerosis ≤ 2,5 m/s; leve 2,6–2,9; moderada 3,0–4,0; severa ≥ 4,0. Gradiente medio leve < 20, moderado 20–40, severo ≥ 40 mmHg. AVA leve > 1,5, moderada 1,0–1,5, severa < 1,0 cm² (indexada < 0,6 cm²/m²). Índice de velocidades leve > 0,50, moderado 0,25–0,50, severo < 0,25. TSVI en PLAX con zoom, borde interno a borde interno, mesosístole; promediar ≥ 3 latidos (≥ 5 si irregular).
- **Diástole [R2]**: paso 1, e′ reducida: septal ≤ 6, lateral ≤ 7 o media ≤ 6,5 cm/s (límites por edad 20–39 / 40–65 / > 65: septal < 7/6/6, lateral < 10/8/7, media < 9/7/6,5). E/e′ elevada: septal ≥ 15, lateral ≥ 13, media ≥ 14. IT ≥ 2,8 m/s o PASP ≥ 35 mmHg. Segunda etapa: strain de reservorio de AI ≤ 18 % o IVAI > 34 mL/m² (también S/D venoso pulmonar ≤ 0,67, IVRT ≤ 70 ms). Disfunción si e′ reducida y ≥ 1 marcador, o e′ conservada y ≥ 2 (E/e′ media > 14, LARS ≤ 18 %, E/A ≤ 0,8 o ≥ 2, IVAI > 34); masa VI > 95 g/m² (mujeres) / > 115 (hombres) también cuenta.
- **Corazón derecho [R3]** (normal / leve / moderado / severo): diámetro basal VD < 4,1 / 4,1–4,4 / > 4,4–4,9 / > 4,9 cm; TAPSE > 1,7 / ≤ 1,7–> 1,3 / ≤ 1,3–> 1,0 / ≤ 1,0 cm; S′ > 9,5 / ≤ 9,5–> 7,2 / ≤ 7,2–> 5,0 / ≤ 5,0 cm/s; FAC > 35 / ≤ 35–> 29 / ≤ 29–> 22 / ≤ 22 %; FEVD 3D normal > 45 %; strain de pared libre (3 segmentos) > 20 / ≤ 20–≥ 15 / < 15–≥ 11 / < 11 %; IT Vmax < 2,8 / 2,8–3,1 / 3,2–3,5 / ≥ 3,6 m/s; RVSP ≤ 34 / 35–49 / 50–69 / ≥ 70 mmHg. PAD por VCI: ≤ 2,1 cm con colapso ≥ 50 % → 3 (0–5); > 2,1 con < 50 % → 15 (10–20); indeterminado → 8 (5–10) con índices secundarios; > 2,5 cm con < 50 % → puede considerarse 20. Acoplamiento TAPSE/PASP normal ~0,5–0,7 mm/mmHg.
- **Cavidades [R9]**: DTD hombres 42,0–58,4 mm (50,2 ± 4,1), mujeres 37,8–52,2 (45,0 ± 3,6); indexado 2,2–3,0 / 2,3–3,1 cm/m²; DTS 25,0–39,8 / 21,6–34,8 mm. FEVI leve 41–51 / 41–53, moderada 30–40, severa < 30 %. Raíz aórtica (media ± DE, hombres / mujeres): anillo 2,6 ± 0,3 / 2,3 ± 0,2; senos 3,4 ± 0,3 / 3,0 ± 0,3; unión sinotubular 2,9 ± 0,3 / 2,6 ± 0,3; ascendente proximal 3,0 ± 0,4 / 2,7 ± 0,4 cm, medidas en telediástole (borde interno a borde interno recomendado).
- **Protocolo ETT [R1]**: 27 adquisiciones 2D numeradas (PLAX con profundidad aumentada, VI, VAo y VM ampliadas, TSVD, entrada VD; PSAX en grandes vasos, VAo, VT, VP/AP, VM, papilares, ápex; A4C, A4C VI ampliado, VD-enfocada, A5C, A4C angulación posterior, A2C, A2C ampliado, A3C, A3C ampliado, A4C venas pulmonares; subcostal 4C, VCI, vena hepática; supraesternal arco). El simulador cubre 9 de esas vistas (sin zooms dedicados) y ninguna subcostal/supraesternal.
