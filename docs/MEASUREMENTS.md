# Mediciones

## Herramientas (`src/ui/DisplayCanvas.tsx`, `ConsolePanel` › pestaña «Medir»)
| Herramienta | Dónde se usa | Interacción | Valor |
|---|---|---|---|
| Caliper (`caliper`) | Sector (2D, color o el sector sobre la tira del modo M) | Dos clics | distancia en cm |
| Velocidad (`velocity`) | Tira espectral (PW/CW/TDI) | Un clic sobre el espectro | m/s o cm/s |
| VTI (`vti`) | Tira espectral | Clics a lo largo de la envolvente; doble clic cierra | VTI en cm, con Vmax y gradientes |
| VTI automática (`auto-vti`) | Tira espectral | Dos clics que acotan el latido | envolvente calculada en el worker (decisión 96) |
| Tiempo (`time`) | Tira espectral o modo M | Dos clics | ms |
| Pendiente (`slope`) | Tira espectral | Pico y un punto de la pendiente | tiempo de desaceleración extrapolado a la línea de base |
| Simpson (`simpson`) | Sector 2D | Trazado de anillo a anillo por el ápex (≥ 5 puntos); doble clic cierra | volumen por 20 discos del trazado (`simpson.ts`) |
| TAPSE (`tapse`) | Modo M | Dos clics | excursión vertical en cm |

La UI sugiere congelar, pero no lo exige.

## Protocolo (`src/simulator/measurements/protocol.ts`)
Cada medida del protocolo lleva un id semántico. Declara su herramienta, modalidad, vistas, fase, colocación (qué estructura debe tocar), ángulo máximo haz–flujo y la verdad del modelo contra la que se puntúa con su tolerancia. La tabla se genera desde `MEASUREMENT_SPECS` con `npm run docs:gen`:

<!-- generado por tools/docs/measurements-table.ts: no editar a mano -->
| Id | Medida | Herramienta | Modalidad | Vistas | Fase | Ángulo | Tolerancia |
|---|---|---|---|---|---|---|---|
| `lvot-diameter` | Diámetro del TSVI | `caliper` | 2d | plax, a5c, a3c | mesosístole | — | 8 % |
| `lv-edd` | Diámetro telediastólico del VI (DTDVI) | `caliper` | 2d, m-mode | plax, psax-pm, psax-mv | telediástole | — | 8 % |
| `lv-esd` | Diámetro telesistólico del VI (DTSVI) | `caliper` | 2d, m-mode | plax, psax-pm, psax-mv | telesístole | — | 10 % |
| `ivsd` | Septum interventricular en diástole | `caliper` | 2d, m-mode | plax, psax-pm, psax-mv | telediástole | — | 12 % |
| `lvpwd` | Pared posterior en diástole | `caliper` | 2d, m-mode | plax, psax-pm, psax-mv | telediástole | — | 12 % |
| `la-ap` | Diámetro anteroposterior de la AI | `caliper` | 2d, m-mode | plax | telesístole | — | 10 % |
| `la-volume` | Volumen máximo de la AI (discos) | `simpson` | 2d | a4c, a2c | telesístole | — | 18 % |
| `aortic-root` | Raíz aórtica (senos de Valsalva) | `caliper` | 2d | plax | telediástole | — | 8 % |
| `lv-edv-simpson` | Volumen telediastólico del VI (Simpson) | `simpson` | 2d | a4c, a2c | telediástole | — | 15 % |
| `lv-esv-simpson` | Volumen telesistólico del VI (Simpson) | `simpson` | 2d | a4c, a2c | telesístole | — | 18 % |
| `lvot-vti` | VTI del TSVI | `auto-vti` | pw | a5c, a3c | sístole | ≤ 20° | 12 % |
| `av-vti` | VTI transaórtico | `auto-vti` | cw | a5c, a3c | sístole | ≤ 20° | 12 % |
| `av-vmax` | Velocidad máxima transaórtica | `velocity` | cw | a5c, a3c | sístole | ≤ 20° | 8 % |
| `lvot-peak-velocity` | Velocidad máxima en el TSVI (obstrucción) | `velocity` | cw, pw | a5c, a3c | sístole | ≤ 20° | 10 % |
| `mitral-e` | Onda E mitral | `velocity` | pw | a4c | protodiástole | ≤ 20° | 8 % |
| `mitral-a` | Onda A mitral | `velocity` | pw | a4c | telediástole (A) | ≤ 20° | 8 % |
| `mitral-dt` | Tiempo de desaceleración de la onda E | `slope` | pw | a4c | protodiástole | — | 15 % |
| `ivrt` | Tiempo de relajación isovolumétrica | `time` | pw, cw | a5c | protodiástole | — | 15 % |
| `e-prime-septal` | e′ septal (Doppler tisular) | `velocity` | tdi | a4c | protodiástole | ≤ 20° | 12 % |
| `e-prime-lateral` | e′ lateral (Doppler tisular) | `velocity` | tdi | a4c | protodiástole | ≤ 20° | 12 % |
| `tapse` | TAPSE | `tapse` | m-mode, cmm | a4c, rv-focused | cualquiera | — | 12 % |
| `rv-basal` | Diámetro basal del VD | `caliper` | 2d | rv-focused, a4c | telediástole | — | 10 % |
| `ivc-diameter` | Diámetro de la vena cava inferior | `caliper` | 2d, m-mode | subcostal-ivc | cualquiera | — | 12 % |
| `rv-s-prime` | S′ tricuspídea (Doppler tisular) | `velocity` | tdi | a4c, rv-focused | sístole | ≤ 20° | 12 % |
| `rvot-acceleration-time` | Tiempo de aceleración pulmonar | `time` | pw | psax-av | sístole | — | 15 % |
| `tr-vmax` | Velocidad máxima de la insuficiencia tricuspídea | `velocity` | cw | a4c, rv-focused, psax-av | sístole | ≤ 20° | 8 % |
<!-- /generado -->

### Técnica (`src/education/technique.ts`)
Cada captura del protocolo se califica en el momento con el cuadro en que se tomó. Cada hallazgo es `ok`, `warn` (×0,75) o `invalid` (×0,3), y el producto pondera la puntuación. Los hallazgos son:
- `modality` y `view`: la modalidad y la vista reconocida con su puntuación;
- `phase`: la fase frente a las ventanas alrededor de los hitos del latido;
- `placement`: la estructura del mapa polar en el volumen de muestra, en la línea del cursor, a lo largo del segmento del caliper o dentro del trazado;
- `edges`: los extremos del caliper en el borde de la cavidad o de la pared;
- `alignment`: el ángulo haz–flujo del campo de flujo;
- `foreshortening`: la longitud trazada del VI frente a la del modelo;
- `depth` (decisión 180): la cavidad trazada llega al fondo del sector, así que el volumen se subestima.

## Registro de procedencia (`src/simulator/measurements/types.ts`)
Cada medición guarda:
- `measurementId` y `technique` para las del protocolo;
- la modalidad, la vista reconocida y su puntuación, el cuadro, la fase y el instante;
- la geometría en píxeles de pantalla y el mapeo del sector al capturar (`captureSector`), del que salen las distancias y los discos de un trazado;
- `derived`.

## Informe (`src/education/report.ts`, pantalla «Informe»)
**Filas.** Una por medición:
- el valor;
- la vista;
- la verdad del modelo y la desviación, salvo en examen;
- el rango normal del sexo del paciente y su bandera (decisión 175);
- la técnica.

Las medidas del protocolo se emparejan con la verdad por id. Las libres, sin id, por cercanía entre candidatas del mismo tipo.

**Cálculos derivados.** Salen sólo de las mediciones del alumno, con su fórmula y sus entradas:
- FEVI y volumen sistólico por Simpson (`ef-simpson`, `sv-simpson`);
- área del TSVI (`lvot-area`), volumen sistólico Doppler (`sv-doppler`), AVA por continuidad (`ava-continuity`), índice de velocidades (`velocity-ratio`) y gradiente pico (`av-peak-gradient`);
- E/A (`e-a`), E/e′ (`e-eprime`) y PSVD (`rvsp`);
- biplano (decisión 180): con un trazado de la misma medida en A4C y otro en A2C, el método de discos biplano combina los dos como discos elípticos sobre el mayor de los dos ejes largos:
  - VTD y VTS del VI (`lv-edv-biplane`, `lv-esv-biplane`) y su FEVI (`ef-biplane`);
  - volumen de la AI (`la-volume-biplane`).

  La fila da las dos longitudes y avisa si difieren más de un 10 % (VI) o de 5 mm (AI).
- índice de volumen de la AI (`la-volume-index`): el biplano, o si falta el monoplano, entre la superficie corporal del paciente, con el límite de 34 mL/m².

**Puntuación** (`src/education/scoring`, `docs/SCORING.md`). Para cada medida exigida por el caso toma la medición con ese id: 100 puntos dentro de la tolerancia y −3 por punto porcentual de exceso, multiplicados por la puntuación de técnica.

## Mapeo píxel ↔ unidades
Todo sale de `SimOutput` (`src/simulator/core/protocol.ts`), que el worker calcula con la misma geometría con la que dibuja:
- **Sector** (`SectorMapping`): `apexX`, `apexY`, `pxPerCm`, `sectorRad`, `depthCm`, `invertLR`. La distancia es `hypot(Δx, Δy) / pxPerCm`, y el zoom entra en `pxPerCm`. `pixelToPolar` y `polarToPixel` (`scanConvert.ts`) convierten para la caja de color, el cursor y el mapa de estructuras. Los dibujos se reproyectan al cambiar el zoom, la inversión o el tamaño (decisión 120).
- **Tira** (`StripInfo`): `y`, `height`, `topValue`, `bottomValue`, `secondsPerColumn`.
- Las coordenadas de clic se escalan de CSS a píxeles del cuadro.

## Pendientes
- FAC y áreas planimetradas (AD, VAo); PHT (`mvaFromPht` está lista).
- Trazado automático del endocardio.
- Corrección de ángulo en el Doppler.
