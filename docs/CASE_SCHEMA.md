# Esquema de casos (`src/cases/schema.ts`)

Los casos son **datos**: objetos validados con Zod (`CaseDefinitionSchema`), serializables y reproducibles por `seed`. Las cadenas nunca se interpretan como código ni HTML. `validateCase(input)` devuelve `{ ok, case, errors }` con mensajes legibles (`ruta: mensaje`); `loadCaseById` lanza si un caso incluido no valida. Sólo `schemaVersion: 1` existe.

## Campos (resumen)
| Sección | Campos | Notas |
|---|---|---|
| Raíz | `schemaVersion` (1), `id` (`^[a-z0-9-]+$`), `title` (≤120), `seed` (entero ≥0), `history` (≤2000, vacío por defecto), `difficulty` (1–5), `learningObjectives[]`, `requiredViews[{viewId, minScore=60}]`, `requiredMeasurements[{measurementId, tolerancePct=15}]`, `references[{referenceId, usage}]`, `impressionTruth[]` | `requiredViews` y `requiredMeasurements` los consume `src/education/scoring` (ids reconocidos: lvot-diameter, lv-edd, ivsd, lvot-vti, av-vti, av-vmax, mitral-e, tr-vmax; otros se omiten sin aviso); `learningObjectives` e `impressionTruth` sólo se validan. |
| `demographics` | `ageYears` 18–100, `sexForReference`, `heightCm` 120–220, `weightKg` 35–200 | Sólo para BSA (Mosteller) e IVAI. Sexo no afecta al render. |
| `bodyHabitus` | `chestWallThicknessCm` 1–6, `chestWidthCm` 24–44, `chestDepthCm` 16–30, `ribSpacingCm` 1,6–3,2, `intercostalWidthCm` 0,8–2,2 | Superelipse del tórax, radio de costilla `(espacio − ancho)/2`. |
| `rhythm` | `type` (sinus, sinus-tachycardia, sinus-bradycardia, atrial-fibrillation), `heartRateBpm` 30–180, `rrVariabilityPct` (1), `pvcProbability` (0) | Sólo `atrial-fibrillation` cambia el comportamiento; `pvcProbability` se ignora. |
| `anatomy.lv` | `eddCm`, `lengthEdCm`, `ivsdCm`, `lvpwdCm`, `sphericity` (0,55), `apexWallThicknessCm` (0,7) | Los radios del VI **no** salen de `eddCm` sino de `physiology.edvMl` y la longitud (`lvGeometryFromVolume`); `eddCm` se usa en la verdad de terreno y para derivar el DTS. |
| `anatomy.la/ra/rv` | AI: `apDiameterCm`, `volumeMl`; AD: `volumeMl`; VD: `basalDiameterCm`, `lengthCm`, `freeWallThicknessCm` | Radios de las aurículas desde el volumen (esfera equivalente escalada). |
| `anatomy.aorta` | `lvotDiameterCm`, `annulusCm`, `sinusCm`, `ascendingCm` | Perfil de radio del tubo TSVI→ascendente; el TSVI define el área para VTI/VS. |
| `anatomy.mitral` | `annulusDiameterCm`, longitudes de velos, `maxOpeningDeg` 10–85, `calcification`, `thickeningCm` (0,1), `samSeverity` | Parches finos; SAM desplaza el velo anterior en sístole. |
| `anatomy.aorticValve` | `maxOpeningFraction`, `calcification`, `cuspThicknessCm`, `bicuspid` | 3 velos (2 si bicúspide); la fracción escala el ángulo de apertura. |
| `anatomy.tricuspid`, `ivc`, `pericardium` | `annulusDiameterCm`; `diameterCm`, `collapsePct`; `effusionCm` (0) | VCI sólo en verdad de terreno; derrame se renderiza como `Tissue.Fluid`. |
| `anatomy.heartPosition` | `baseCm {x,y,z}`, `longAxis`, `anterior` (marco torso: x izquierda, y superior, z anterior) | Construye el marco corazón↔torso; `anterior` se ortogonaliza contra `longAxis`. |
| `anatomy.wallMotion[]` | `segment` 1–17, `amplitude` −0,5–1,2, `delayPhase` | `delayPhase` se ignora. |
| `physiology` | `edvMl`, `esvMl`, `mapseCm`, `tapseCm`, `ePeakMps`, `aPeakMps`, `decelerationTimeMs`, `ivrtMs`, `ePrimeSeptalCmps`, `ePrimeLateralCmps`, `sPrimeTricuspidCmps`, `contractility` (1) | Fuente de las tablas de latido. `contractility` acorta el tiempo de eyección (−8 % por unidad). |
| `hemodynamics` | `systolicBpMmHg`, `diastolicBpMmHg`, `rapMmHg`, `paspMmHg`, `avEffectiveAreaCm2` 0,3–5, `mvEffectiveAreaCm2?`, `trPresent` (true), `regurgitation {mr?, ar?, tr?}` | Presiones arteriales no se usan; `regurgitation` se ignora; la IT sale de PASP−PAD. |
| `acousticWindow` | `chestWallAttenuation`, `lungOverlapCm` −2–6, `clutterLevel`, `obesityAttenuation`, `emphysemaScatter`, `cardiacRotationDeg` (0) | Obesidad engrosa la pared efectiva ×(1+0,8·o) y, si esa pared supera 2 cm, el corazón retrocede el exceso; `chestWallAttenuation` también alimenta el clutter (×0,8); rotación desplaza el corazón 0,02 cm/°. |
| `flowPrimitives[]` | `id`, `site` (mitral-inflow, lvot, aortic-valve, tricuspid-inflow, rvot, mr-jet, tr-jet, ar-jet, pulmonary-vein), `enabled`, `turbulence` (0,05) | `mr-jet`, `ar-jet`, `pulmonary-vein` no implementados. |
| `artifacts[]` | `type` (rib-shadow, lung-reverberation, near-field-clutter, calcium-shadow, mirror, side-lobe, beam-width), `intensity`, `enabled` | **No lo lee ningún módulo.** |

## Validaciones cruzadas (`validateCase`)
1. `physiology.esvMl < edvMl`.
2. `diastolicBpMmHg < systolicBpMmHg`.
3. Si `rhythm.type === 'atrial-fibrillation'`, `physiology.aPeakMps` debe ser 0.
4. `anatomy.aorta.lvotDiameterCm ≤ annulusCm + 0,3`.

## Cómo emerge la verdad de terreno
Nada del informe se escribe a mano en el caso:
1. `buildBeatTables(RR, physiology, rhythm, hemodynamics)` construye 512 muestras por latido: tiempo de eyección `0,413 − 0,0017·FC` s (acotado 0,16–0,36), retraso electromecánico 60 ms, IVRT del caso, onda E (aceleración `min(0,1, DT/2)`, deceleración DT), onda A de 130 ms tras la P (PR 160 ms). `Q_ao` tiene forma `u^0,9(1−u)^1,35` escalada para que ∫ = VS; `Q_mv` suma E y A con las velocidades pico del caso y un área mitral efectiva resuelta sobre la propia tabla para que ∫ = VS, también cuando el latido siguiente corta la onda E; `V(φ)` es la integral, y la corrección de deriva que la hace periódica es sólo discretización y queda registrada en `volumeCorrectionMl` (decisión 95). El desplazamiento longitudinal sigue la contracción con retardo de primer orden (τ = 0,03 s en sístole, `0,09·10/e′_sept` en diástole).
2. `computeGroundTruth` divide `Q_ao(φ)` por el área del TSVI y por `avEffectiveAreaCm2` para obtener Vmax, VTI, gradientes (Bernoulli), AVA por continuidad e índice de velocidades; FE de VTD/VTS; GC = VS·FC; DTS = `DTD·∛(VTS/VTD)·0,93`; E/A, E/e′ medio; IT Vmax = `√((PASP−PAD)/4)` y RVSP = `4·IT² + PAD`; IVAI = volumen/BSA.
3. El mismo `Q_ao`/`Q_mv` alimenta el campo de flujo, y `V(φ)`/`long(φ)` mueven la geometría: lo que se ve, lo que se mide y lo que se informa provienen de una sola fuente.

Consecuencia: con `avEffectiveAreaCm2` 0,95 cm² y VS ≈ 78 mL el modelo produce Vmax 4,35 m/s, gradiente medio 38 mmHg, VTI 82 cm y AVA por continuidad 0,95 cm² (el comentario de `aortic-stenosis-severe.ts` anuncia «≈ 45 mmHg» de gradiente medio y su `impressionTruth` «≥ 40»; el valor calculado es 38).

## Ejemplo (extracto de `aortic-stenosis-severe.ts`)
```ts
export const aorticStenosisSevereCase: CaseDefinitionInput = {
  ...normalExcellentCase,                         // hereda tórax, ventana y posición del corazón
  schemaVersion: 1, id: 'aortic-stenosis-severe', seed: 606,
  title: 'Estenosis aórtica severa con flujo conservado',
  demographics: { ageYears: 74, sexForReference: 'male', heightCm: 170, weightKg: 78 },
  rhythm: { type: 'sinus', heartRateBpm: 68, rrVariabilityPct: 2, pvcProbability: 0 },
  anatomy: { ...normalExcellentCase.anatomy,
    lv: { eddCm: 4.7, lengthEdCm: 8.5, ivsdCm: 1.3, lvpwdCm: 1.25, sphericity: 0.5, apexWallThicknessCm: 0.8 },
    la: { apDiameterCm: 4.2, volumeMl: 78 },
    aorticValve: { maxOpeningFraction: 0.3, calcification: 0.85, cuspThicknessCm: 0.25, bicuspid: false },
  },
  physiology: { ...normalExcellentCase.physiology, edvMl: 125, esvMl: 47, ePeakMps: 0.65, aPeakMps: 0.85,
    decelerationTimeMs: 240, ivrtMs: 100, ePrimeSeptalCmps: 5.5, ePrimeLateralCmps: 7 },
  hemodynamics: { systolicBpMmHg: 135, diastolicBpMmHg: 80, rapMmHg: 3, paspMmHg: 38,
    avEffectiveAreaCm2: 0.95, trPresent: true, regurgitation: {} },
  flowPrimitives: [ { id: 'av', site: 'aortic-valve', enabled: true, turbulence: 0.45 }, /* … */ ],
  requiredViews: [ { viewId: 'plax', minScore: 65 }, { viewId: 'psax-av', minScore: 55 }, { viewId: 'a5c', minScore: 55 } ],
  requiredMeasurements: [ { measurementId: 'av-vmax', tolerancePct: 10 }, /* … */ ],
  references: [ { referenceId: 'ase-eacvi-aortic-stenosis-2017', usage: 'criterios de severidad y ecuación de continuidad' } ],
  impressionTruth: [ 'Estenosis aórtica severa (Vmax ≥ 4 m/s, gradiente medio ≥ 40 mmHg, AVA ≤ 1,0 cm²) con flujo conservado.' ],
};
```
Los casos se registran en `src/cases/index.ts` (`CASE_INPUTS`); no hay carga de JSON externo desde la UI, aunque `validateCase` está preparado para entradas no confiables.
