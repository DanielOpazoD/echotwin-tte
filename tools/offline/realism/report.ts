/**
 * Aggregates of the realism bench and its Spanish report (decision 343). Every gap is scored on one scale so the largest
 * can be ranked, with the rule written next to it in the report:
 *   - physics against the reference: |ln(sim / ref)| / ln 1.25 (1 = a 25 % error), or |Δ dB| / 6 for levels in dB;
 *   - a clinical distribution: |value − median| / IQR (1 = one interquartile width off the median);
 *   - a normal range: the distance outside it over half its width (0 inside).
 */
import { homedir } from 'node:os';
import { NORMAL_RANGES } from '@/clinical/guidelines/normalRanges';
import { biplaneMl, ejectionFraction } from '@/clinical/realism/lvVolume';
import { iqrDistance, RAYLEIGH_SNR, type Quantiles } from '@/clinical/realism/speckleStats';
import type { TuringScore } from '@/clinical/realism/turing';
import type { CineResult } from './bench';
import type { CamusSummary, EchonetSummary } from './clinicalData';
import type { PhantomResults } from './phantoms';
import type { TuringExport } from './turingExport';

/** ASE/EACVI 2015 (Lang et al.): normal biplane LV EF, men 52–72 %, women 54–74 %; the bench uses the union. */
export const EF_NORMAL = { low: 52, high: 74 };
/** Normal GLS of the brief: −18 to −22 % (Yingchoncharoen et al., JASE 2013: −19.7 %, 95 % CI −20.4 to −18.9). */
export const GLS_NORMAL = { low: -22, high: -18 };

export interface Gap {
  area: 'física' | 'imagen clínica' | 'volumen y tiempo' | 'movimiento' | 'Turing';
  metric: string;
  sim: number;
  ref: number;
  refLabel: string;
  score: number;
  unit: string;
  /** Why the number may say more about the instrument than about the simulator, when that is not settled. */
  caveat?: string;
}

export interface Results {
  generatedAt: string;
  wallSeconds: number;
  sources: { camus: boolean; echonet: boolean };
  phantoms: PhantomResults;
  volumes: {
    caseId: string;
    edvImage: number;
    esvImage: number;
    efImage: number;
    edvModel: number;
    esvModel: number;
    efModel: number;
    edToEsMs: number;
  }[];
  strain: {
    caseId: string;
    tracked: number;
    trackedNoClutter: number;
    modelMidwall: number;
    modelEndocardial: number;
    driftMm: number;
    driftMmNoClutter: number;
  }[];
  decorrelation: {
    caseId: string;
    view: string;
    peak: number;
    zeroShift: number;
    echonetPeak: number;
    echonetZeroShift: number;
  }[];
  texture: {
    caseId: string;
    view: string;
    phase: 'TD' | 'TS';
    skewness: number;
    excessKurtosis: number;
    residualStd: number;
    medianGrey: number;
  }[];
  envelope: { caseId: string; view: string; snr: number; windowedSnr: number; kAlpha: number }[];
  camus: CamusSummary | null;
  echonet: EchonetSummary | null;
  turing: TuringExport | null;
  graded: (TuringScore & { reader: string; echoReader: boolean })[] | null;
  gaps: Gap[];
}

const ratioScore = (sim: number, ref: number): number =>
  Math.abs(Math.log(sim / ref)) / Math.log(1.25);
const rangeScore = (v: number, lo: number, hi: number): number =>
  v < lo ? (lo - v) / ((hi - lo) / 2) : v > hi ? (v - hi) / ((hi - lo) / 2) : 0;

export function aggregate(input: {
  phantoms: PhantomResults;
  cines: CineResult[];
  camus: CamusSummary | null;
  echonet: EchonetSummary | null;
  turing: TuringExport | null;
  graded: Results['graded'];
  sources: Results['sources'];
  wallSeconds: number;
}): Results {
  const { cines, phantoms, camus, echonet } = input;
  const def = cines.filter((c) => c.job.variant === 'default');
  const find = (caseId: string, view: string, variant = 'default'): CineResult | undefined =>
    cines.find((c) => c.job.caseId === caseId && c.job.view === view && c.job.variant === variant);
  const caseIds = [...new Set(def.map((c) => c.job.caseId))];

  const volumes: Results['volumes'] = [];
  for (const caseId of caseIds) {
    const a4 = find(caseId, 'a4c'),
      a2 = find(caseId, 'a2c');
    if (!a4?.metrics.discs || !a2?.metrics.discs) continue;
    const v = a4.metrics.discs.map((d, i) => {
      const e = a2.metrics.discs![Math.min(i, a2.metrics.discs!.length - 1)];
      return d && e ? biplaneMl(d, e) : NaN;
    });
    const ok = v.filter(Number.isFinite);
    const edv = Math.max(...ok),
      esv = Math.min(...ok);
    const mv = a4.metrics.modelVolumeMl;
    volumes.push({
      caseId,
      edvImage: edv,
      esvImage: esv,
      efImage: ejectionFraction(edv, esv),
      edvModel: Math.max(...mv),
      esvModel: Math.min(...mv),
      efModel: ejectionFraction(Math.max(...mv), Math.min(...mv)),
      edToEsMs: 1000 * a4.metrics.esPhase * a4.metrics.rrS,
    });
  }
  const strain: Results['strain'] = [];
  for (const caseId of caseIds) {
    const s = find(caseId, 'a4c')?.metrics.strain,
      n = find(caseId, 'a4c', 'noclutter')?.metrics.strain;
    if (!s) continue;
    strain.push({
      caseId,
      tracked: s.tracked,
      trackedNoClutter: n?.tracked ?? NaN,
      modelMidwall: s.modelMidwall,
      modelEndocardial: s.modelEndocardial,
      driftMm: s.driftMm,
      driftMmNoClutter: n?.driftMm ?? NaN,
    });
  }
  const decorrelation = def.map((c) => ({
    caseId: c.job.caseId,
    view: c.job.view,
    peak: c.metrics.decorrelation.peak,
    zeroShift: c.metrics.decorrelation.zeroShift,
    echonetPeak: c.echonetDecorrelation.peak,
    echonetZeroShift: c.echonetDecorrelation.zeroShift,
  }));
  const texture: Results['texture'] = def.flatMap((c) =>
    c.metrics.texture
      ? (['ed', 'es'] as const).map((ph) => ({
          caseId: c.job.caseId,
          view: c.job.view,
          phase: ph === 'ed' ? ('TD' as const) : ('TS' as const),
          skewness: c.metrics.texture![ph].skewness,
          excessKurtosis: c.metrics.texture![ph].excessKurtosis,
          residualStd: c.metrics.texture![ph].residualStd,
          medianGrey: c.metrics.texture![ph].medianGrey,
        }))
      : [],
  );
  const envelope = def.map((c) => ({
    caseId: c.job.caseId,
    view: c.job.view,
    snr: c.metrics.envelope.snr,
    windowedSnr: c.metrics.envelope.windowedSnr,
    kAlpha: c.metrics.envelope.kAlpha,
  }));

  // ---- gaps
  const gaps: Gap[] = [];
  const at = (d: number) => phantoms.points.find((p) => p.depthCm === d)!;
  for (const d of [5, 9, 15]) {
    const p = at(d);
    gaps.push({
      area: 'física',
      metric: `resolución lateral −6 dB a ${d} cm`,
      sim: p.simLateralMeasuredMm,
      ref: p.refLateralRectMm,
      refLabel: `DAS tipo Field II sin apodizar (con Hanning ${fmt(p.refLateralHanningMm)} mm)`,
      score: ratioScore(p.simLateralMeasuredMm, p.refLateralRectMm),
      unit: 'mm',
    });
  }
  const p9 = at(9);
  gaps.push({
    area: 'física',
    metric: 'resolución axial −6 dB a 9 cm',
    sim: p9.simAxialMeasuredMm,
    ref: p9.refAxialMm,
    refLabel: 'pulso de Field II (2 + 2 ciclos)',
    score: ratioScore(p9.simAxialMeasuredMm, p9.refAxialMm),
    unit: 'mm',
  });
  for (const c of phantoms.cysts.filter((c) => c.depthCm === 9)) {
    gaps.push({
      area: 'física',
      metric: `contraste de un quiste anecoico de ${2 * c.radiusMm} mm a ${c.depthCm} cm`,
      sim: c.sim.contrastDb,
      ref: c.refRect.contrastDb,
      refLabel: `DAS tipo Field II sin apodizar (con Hanning ${fmt(c.ref.contrastDb, 1)} dB)`,
      score: Math.abs(c.sim.contrastDb - c.refRect.contrastDb) / 6,
      unit: 'dB',
    });
  }
  const s9 = phantoms.speckle.find((s) => s.depthCm === 9)!;
  gaps.push({
    area: 'física',
    metric: 'SNR del speckle uniforme (envolvente mostrada, 2 miradas)',
    sim: s9.simSnr,
    ref: RAYLEIGH_SNR,
    refLabel: 'Rayleigh (Burckhardt 1978) y la referencia',
    score: ratioScore(s9.simSnr, RAYLEIGH_SNR),
    unit: '',
  });
  gaps.push({
    area: 'física',
    metric: 'celda de speckle lateral a 9 cm',
    sim: s9.simCellLateralMm,
    ref: s9.refRectCellLateralMm,
    refLabel: `DAS tipo Field II sin apodizar (con Hanning ${fmt(s9.refCellLateralMm)} mm)`,
    score: ratioScore(s9.simCellLateralMm, s9.refRectCellLateralMm),
    unit: 'mm',
  });
  const normal = 'normal-excellent-window';
  if (camus) {
    const t = texture.find((x) => x.caseId === normal && x.view === 'a4c' && x.phase === 'TD');
    if (t)
      for (const [k, label] of [
        ['residualStd', 'desviación del gris residual del miocardio (A4C, TD)'],
        ['skewness', 'asimetría del gris residual del miocardio (A4C, TD)'],
        ['excessKurtosis', 'curtosis del gris residual del miocardio (A4C, TD)'],
        ['medianGrey', 'gris mediano del miocardio (A4C, TD)'],
      ] as const) {
        const q = camus.texture[k];
        gaps.push({
          area: 'imagen clínica',
          metric: label,
          sim: t[k],
          ref: q.median,
          refLabel: `CAMUS Good, mediana [${fmt(q.p25)}–${fmt(q.p75)}]`,
          score: Math.abs(iqrDistance(t[k], q)),
          unit: k === 'medianGrey' || k === 'residualStd' ? 'gris' : '',
        });
      }
    const v = volumes.find((x) => x.caseId === normal);
    if (v)
      gaps.push({
        area: 'volumen y tiempo',
        metric: 'telediástole → telesístole (caso normal)',
        sim: v.edToEsMs,
        ref: camus.edToEsMs.median,
        refLabel: `CAMUS, mediana [${fmt(camus.edToEsMs.p25, 0)}–${fmt(camus.edToEsMs.p75, 0)}]`,
        score: Math.abs(iqrDistance(v.edToEsMs, camus.edToEsMs)),
        unit: 'ms',
      });
  }
  const v = volumes.find((x) => x.caseId === normal);
  if (v) {
    const edvR = NORMAL_RANGES['lv-edv-simpson']!,
      esvR = NORMAL_RANGES['lv-esv-simpson']!;
    const lo = (r: typeof edvR) => Math.min(r.male.low!, r.female.low!),
      hi = (r: typeof edvR) => Math.max(r.male.high!, r.female.high!);
    gaps.push({
      area: 'volumen y tiempo',
      metric: 'VTD biplano medido en la imagen (caso normal)',
      sim: v.edvImage,
      ref: (lo(edvR) + hi(edvR)) / 2,
      refLabel: `ASE/EACVI 2015, ${lo(edvR)}–${hi(edvR)} mL`,
      score: rangeScore(v.edvImage, lo(edvR), hi(edvR)),
      unit: 'mL',
    });
    gaps.push({
      area: 'volumen y tiempo',
      metric: 'VTS biplano medido en la imagen (caso normal)',
      sim: v.esvImage,
      ref: (lo(esvR) + hi(esvR)) / 2,
      refLabel: `ASE/EACVI 2015, ${lo(esvR)}–${hi(esvR)} mL`,
      score: rangeScore(v.esvImage, lo(esvR), hi(esvR)),
      unit: 'mL',
    });
    gaps.push({
      area: 'volumen y tiempo',
      metric: 'FE biplano medida en la imagen (caso normal)',
      sim: v.efImage,
      ref: (EF_NORMAL.low + EF_NORMAL.high) / 2,
      refLabel: `ASE/EACVI 2015, ${EF_NORMAL.low}–${EF_NORMAL.high} %`,
      score: rangeScore(v.efImage, EF_NORMAL.low, EF_NORMAL.high),
      unit: '%',
    });
    gaps.push({
      area: 'volumen y tiempo',
      metric: 'FE de la imagen frente a la del modelo (caso normal)',
      sim: v.efImage,
      ref: v.efModel,
      refLabel: 'el volumen del modelo (tablas del latido)',
      score: Math.abs(v.efImage - v.efModel) / 5,
      unit: '%',
    });
  }
  const sN = strain.find((x) => x.caseId === normal);
  if (sN) {
    gaps.push({
      area: 'movimiento',
      metric: 'GLS por seguimiento de speckle (A4C, caso normal)',
      sim: sN.tracked,
      ref: -20,
      refLabel: 'normal −18 a −22 %',
      score: rangeScore(sN.tracked, GLS_NORMAL.low, GLS_NORMAL.high),
      unit: '%',
      caveat:
        'el rastreador del banco no regulariza y sólo está validado en una deformación sintética; hasta correrlo sobre vídeos reales (EchoNet) no se sabe qué parte es del simulador',
    });
    gaps.push({
      area: 'movimiento',
      metric: 'GLS del contorno del modelo, 2 mm dentro de la pared (A4C, caso normal)',
      sim: sN.modelMidwall,
      ref: -20,
      refLabel: 'normal −18 a −22 %',
      score: rangeScore(sN.modelMidwall, GLS_NORMAL.low, GLS_NORMAL.high),
      unit: '%',
    });
  }
  if (echonet?.decorrelation) {
    const d = decorrelation.find((x) => x.caseId === normal && x.view === 'a4c');
    if (d)
      gaps.push({
        area: 'movimiento',
        metric: 'correlación de bloques entre cuadros, formato EchoNet (A4C normal)',
        sim: d.echonetPeak,
        ref: echonet.decorrelation.peak.median,
        refLabel: `EchoNet, mediana [${fmt(echonet.decorrelation.peak.p25)}–${fmt(echonet.decorrelation.peak.p75)}]`,
        score: Math.abs(iqrDistance(d.echonetPeak, echonet.decorrelation.peak)),
        unit: '',
      });
  }
  if (input.graded?.length) {
    const echo = input.graded.filter((g) => g.echoReader);
    const g = echo.length ? echo : input.graded;
    const auc = g.reduce((s, x) => s + x.auc, 0) / g.length;
    gaps.push({
      area: 'Turing',
      metric: `AUC de los lectores${echo.length ? ' que leen ecos' : ''} (${g.length})`,
      sim: auc,
      ref: 0.5,
      refLabel: 'indistinguible',
      score: Math.max(0, auc - 0.5) / 0.1,
      unit: '',
    });
  }
  gaps.sort((a, b) => b.score - a.score);
  return {
    generatedAt: new Date().toISOString(),
    wallSeconds: input.wallSeconds,
    sources: input.sources,
    phantoms,
    volumes,
    strain,
    decorrelation,
    texture,
    envelope,
    camus,
    echonet,
    turing: input.turing,
    graded: input.graded,
    gaps,
  };
}

/** Spanish decimal comma; NaN and infinities as a dash. */
export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return v === Infinity ? '∞' : v === -Infinity ? '−∞' : '—';
  return v.toFixed(digits).replace('-', '−').replace('.', ',');
}

const q = (x: Quantiles, d = 1): string =>
  `${fmt(x.median, d)} [${fmt(x.p25, d)}–${fmt(x.p75, d)}]`;
const short = (id: string): string =>
  ({
    'normal-excellent-window': 'normal',
    'hfref-severe-mr': 'ICFEr + IM',
    'hocm-sam': 'MCH obstructiva',
  })[id] ?? id;

export function reportMd(r: Results): string {
  const L: string[] = [];
  const P = r.phantoms;
  L.push(
    '# Banco de realismo — informe',
    '',
    `Generado por \`npm run realism\` (decisión 343) el ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC, en ${fmt(r.wallSeconds / 60, 1)} min. ` +
      `Fuentes clínicas: CAMUS ${r.sources.camus ? 'sí' : 'no'}, EchoNet-Dynamic ${r.sources.echonet ? 'sí' : 'no (falta ECHONET_DIR)'}. ` +
      'Sólo cifras agregadas: ninguna imagen clínica ni dato individual sale de las carpetas de origen.',
    '',
    '## Brechas, de mayor a menor',
    '',
    'Una sola escala para ordenarlas: en física, |ln(sim/ref)|/ln 1,25 (1 = un 25 % de error) o |Δ dB|/6; contra una distribución clínica, la distancia a la mediana en anchos intercuartiles; contra un rango normal, la distancia fuera de él sobre su media anchura (0 dentro). Por encima de 1 la brecha es mayor que la tolerancia con que se ha calibrado el simulador hasta ahora.',
    '',
    '| # | área | métrica | simulador | referencia | fuente de la referencia | puntuación |',
    '|---:|---|---|---:|---:|---|---:|',
  );
  r.gaps.forEach((g, i) =>
    L.push(
      `| ${i + 1} | ${g.area} | ${g.metric}${g.caveat ? ' †' : ''} | ${fmt(g.sim)} ${g.unit} | ${fmt(g.ref)} ${g.unit} | ${g.refLabel} | ${fmt(g.score, 1)} |`,
    ),
  );
  const caveats = r.gaps.filter((g) => g.caveat);
  if (caveats.length) L.push('', ...caveats.map((g) => `† ${g.metric}: ${g.caveat}.`));
  L.push(
    '',
    '## 1. Formación de imagen en fantomas',
    '',
    `Transductor de referencia: ${P.transducer.elements} elementos sobre ${P.transducer.apertureMm} mm (la apertura del simulador), ${P.transducer.f0MHz} MHz, foco de emisión a ${P.transducer.focusCm} cm, recepción dinámica con F/${P.transducer.rxFNumber}, pulso de los ejemplos de Field II (excitación de 2 ciclos por respuesta al impulso de 2 ciclos con ventana de Hanning, en emisión y recepción), elementos puntuales. El simulador corre sus propias etapas (fasores, compuesto de 2 miradas, ganancia de foco, PSF con lóbulos laterales, envolvente) en la rejilla polar del nivel alto, en fundamental para comparar con la referencia. No se encontró una cifra publicada de Field II para este transductor exacto (el ejemplo de matriz en fase de Field II usa otros parámetros), así que la referencia se calcula aquí con su mismo modelo lineal y su pulso, y se valida contra la teoría: 0,886 λF a −6 dB en el foco de una apertura rectangular y SNR 1,91 en speckle plenamente desarrollado (\`dasReference.test.ts\`). Una corrida de Field II de verdad queda pendiente. La apertura sin apodizar es la cota más estrecha que da una apertura de 14 mm; la de Hanning, la de los ejemplos de Field II y la habitual en un equipo.`,
    '',
    '### Blancos puntuales',
    '',
    '| profundidad (cm) | axial sim, fórmula / medida (mm) | axial ref (mm) | lateral sim, fórmula / medida (mm) | lateral ref rect / Hanning (mm) | lóbulo sim (dB) | lóbulo ref rect / Hanning (dB) | muestra / línea (mm) |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const p of P.points)
    L.push(
      `| ${p.depthCm} | ${fmt(p.simAxialFormulaMm)} / ${fmt(p.simAxialMeasuredMm)} | ${fmt(p.refAxialMm)} | ${fmt(p.simLateralFormulaMm)} / ${fmt(p.simLateralMeasuredMm)} | ${fmt(p.refLateralRectMm)} / ${fmt(p.refLateralHanningMm)} | ${fmt(p.simSideLobeDb, 1)} | ${fmt(p.refSideLobeRectDb, 1)} / ${Number.isFinite(p.refSideLobeHanningDb) ? fmt(p.refSideLobeHanningDb, 1) : '< −60'} | ${fmt(p.sampleMm)} / ${fmt(p.lineMm)} |`,
    );
  L.push(
    '',
    'Imagen armónica (la consola por omisión): el simulador estrecha el haz lateral por 0,8 a toda profundidad. El modelo de primer orden (fuente ∝ p², recibida al doble de la frecuencia de emisión) da estas razones respecto de la fundamental:',
    '',
    '| profundidad (cm) | simulador | emisión a f (recepción 2f) | emisión a f/2 (recepción f) |',
    '|---:|---:|---:|---:|',
  );
  for (const h of P.harmonic)
    L.push(
      `| ${h.depthCm} | ${fmt(h.simRatio)} | ${fmt(h.refRatioTxF)} | ${fmt(h.refRatioTxHalfF)} |`,
    );
  L.push(
    '',
    '### Quiste anecoico en speckle uniforme',
    '',
    '| profundidad (cm) | diámetro (mm) | contraste sim / ref rect / ref Hanning (dB) | CNR sim / rect / Hanning | gCNR sim / rect / Hanning | gCNR sim en el gris mostrado |',
    '|---:|---:|---:|---:|---:|---:|',
  );
  for (const c of P.cysts)
    L.push(
      `| ${c.depthCm} | ${2 * c.radiusMm} | ${fmt(c.sim.contrastDb, 1)} / ${fmt(c.refRect.contrastDb, 1)} / ${fmt(c.ref.contrastDb, 1)} | ${fmt(c.sim.cnr)} / ${fmt(c.refRect.cnr)} / ${fmt(c.ref.cnr)} | ${fmt(c.sim.gcnr)} / ${fmt(c.refRect.gcnr)} / ${fmt(c.ref.gcnr)} | ${fmt(c.sim.gcnrDisplay)} |`,
    );
  L.push(
    '',
    '### Speckle uniforme',
    '',
    `SNR de la envolvente: ${fmt(RAYLEIGH_SNR)} para speckle plenamente desarrollado (Rayleigh). «Ventanas»: el estimador con que se lee el miocardio más abajo (5 líneas × 7 muestras), aplicado aquí al speckle uniforme como vara de medir.`,
    '',
    '| profundidad (cm) | SNR sim (2 miradas / 1 mirada / ventanas) | SNR ref | m de Nakagami sim (2 / 1) | m ref | α de K, 1 mirada | celda axial sim / ref (mm) | celda lateral sim / ref rect / ref Hanning (mm) |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const s of P.speckle)
    L.push(
      `| ${s.depthCm} | ${fmt(s.simSnr)} / ${fmt(s.simSnrSingleLook)} / ${fmt(s.simWindowedSnr)} | ${fmt(s.refSnr)} | ${fmt(s.simM)} / ${fmt(s.simMSingleLook)} | ${fmt(s.refM)} | ${fmt(s.simKAlphaSingleLook, 0)} | ${fmt(s.simCellAxialMm)} / ${fmt(s.refCellAxialMm)} | ${fmt(s.simCellLateralMm)} / ${fmt(s.refRectCellLateralMm)} / ${fmt(s.refCellLateralMm)} |`,
    );
  L.push(
    '',
    '## 2. Imagen clínica: textura del miocardio frente a CAMUS',
    '',
    'Gris residual del miocardio erosionado (gris menos su media local de ±4 mm, sin los píxeles recortados en 0 o 255), el mismo código sobre CAMUS (imágenes Good, cuatro y dos cámaras, TD y TS) y sobre el simulador. La forma (asimetría, curtosis) no depende de la escala de grises si ésta es lineal en dB; la desviación sí.',
    '',
  );
  if (r.camus) {
    const c = r.camus.texture;
    L.push(
      `CAMUS (${r.camus.textureImages} imágenes): asimetría ${q(c.skewness, 2)}, curtosis ${q(c.excessKurtosis, 2)}, desviación ${q(c.residualStd)}, gris mediano ${q(c.medianGrey, 0)}.`,
      '',
    );
  }
  L.push(
    '| caso | vista | fase | asimetría | curtosis | desviación | gris mediano |',
    '|---|---|---|---:|---:|---:|---:|',
  );
  for (const t of r.texture)
    L.push(
      `| ${short(t.caseId)} | ${t.view} | ${t.phase} | ${fmt(t.skewness)} | ${fmt(t.excessKurtosis)} | ${fmt(t.residualStd, 1)} | ${fmt(t.medianGrey, 0)} |`,
    );
  L.push(
    '',
    'Envolvente del miocardio antes de la consola (TD): la SNR de toda la pared lleva sus cambios de nivel (ángulo de fibra, profundidad, granos); la SNR por ventanas, el speckle. Compárese con la del speckle uniforme por ventanas.',
    '',
    '| caso | vista | SNR pared | SNR ventanas | α de K |',
    '|---|---|---:|---:|---:|',
  );
  for (const e of r.envelope)
    L.push(
      `| ${short(e.caseId)} | ${e.view} | ${fmt(e.snr)} | ${fmt(e.windowedSnr)} | ${fmt(e.kAlpha)} |`,
    );
  L.push(
    '',
    '## 3. Volumen del VI a lo largo del ciclo',
    '',
    'Método de discos biplano sobre la máscara de la cavidad (el mapa de estructuras del simulador visto por la misma conversión de barrido, A4C y A2C a 50 cuadros/s), frente al volumen del modelo (las tablas del latido). En CAMUS el mismo código corre sobre las máscaras de los expertos.',
    '',
    '| caso | VTD imagen / modelo (mL) | VTS imagen / modelo (mL) | FE imagen / modelo (%) | TD → TS (ms) |',
    '|---|---:|---:|---:|---:|',
  );
  for (const v of r.volumes)
    L.push(
      `| ${short(v.caseId)} | ${fmt(v.edvImage, 0)} / ${fmt(v.edvModel, 0)} | ${fmt(v.esvImage, 0)} / ${fmt(v.esvModel, 0)} | ${fmt(v.efImage, 1)} / ${fmt(v.efModel, 1)} | ${fmt(v.edToEsMs, 0)} |`,
    );
  L.push('');
  if (r.camus) {
    const c = r.camus;
    L.push(
      `CAMUS (${c.patients} pacientes, población con FE reducida en buena parte): VTD ${q(c.edvMl, 0)} mL, VTS ${q(c.esvMl, 0)} mL, FE del banco ${q(c.efPct)} %, FE declarada ${q(c.efDeclaredPct)} %. El código del banco da una FE ${fmt(c.efAgreement.bias, 1)} puntos por encima de la declarada (error medio absoluto ${fmt(c.efAgreement.mae, 1)}, r = ${fmt(c.efAgreement.r)}, ${c.efAgreement.n} pacientes): por eso el simulador se compara con CAMUS siempre con el mismo código, nunca con la cifra declarada. TD → TS: ${q(c.edToEsMs, 0)} ms.`,
      '',
    );
  }
  if (r.echonet) {
    const e = r.echonet;
    L.push(
      `EchoNet-Dynamic (${e.videos} vídeos): FE ${q(e.efPct)} %, VTD ${q(e.edvMl, 0)} mL, VTS ${q(e.esvMl, 0)} mL; con FE ≥ 55 % (${e.normal.videos}): VTD ${q(e.normal.edvMl, 0)}, VTS ${q(e.normal.esvMl, 0)} mL. TD → TS de los cuadros trazados: ${q(e.edToEsMs, 0)} ms. La FE de los trazados (discos monoplano en píxeles) frente a la declarada: sesgo ${fmt(e.tracingEfAgreement.bias, 1)}, error medio absoluto ${fmt(e.tracingEfAgreement.mae, 1)} (${e.tracingEfAgreement.n}).`,
      '',
    );
  } else
    L.push(
      'EchoNet-Dynamic: no corrió (falta `ECHONET_DIR`). Con la carpeta del conjunto (FileList.csv, VolumeTracings.csv y Videos/) el banco añade la distribución de FE, VTD y VTS, el tiempo TD → TS de los trazados y la decorrelación de sus vídeos.',
      '',
    );
  L.push(
    '## 4. Movimiento: deformación longitudinal global y decorrelación',
    '',
    'GLS del A4C: una línea 2 mm dentro de la pared desde el endocardio telediastólico, 40 puntos llevados cuadro a cuadro por correlación de bloques de 5 mm (sin regularizar), y la misma línea construida en cada cuadro sobre el mapa de estructuras del modelo. «Sin clutter»: el mismo cine sin la reverberación de la pared torácica ni la neblina de las cavidades. La deriva es lo que los puntos no vuelven a su sitio tras un ciclo.',
    '',
    '| caso | GLS seguido (%) | GLS seguido sin clutter (%) | GLS del modelo, 2 mm / endocardio (%) | deriva con / sin clutter (mm) |',
    '|---|---:|---:|---:|---:|',
  );
  for (const s of r.strain)
    L.push(
      `| ${short(s.caseId)} | ${fmt(s.tracked, 1)} | ${fmt(s.trackedNoClutter, 1)} | ${fmt(s.modelMidwall, 1)} / ${fmt(s.modelEndocardial, 1)} | ${fmt(s.driftMm, 1)} / ${fmt(s.driftMmNoClutter, 1)} |`,
    );
  L.push(
    '',
    'Correlación de bloques de miocardio entre cuadros consecutivos a 50 cuadros/s: en el mejor desplazamiento (lo que el speckle se parece a sí mismo tras moverse) y en el mismo sitio. «EchoNet»: el cine reducido al formato de EchoNet (112 px) y los bloques elegidos sólo por su gris, como en los vídeos clínicos.',
    '',
    '| caso | vista | pico | mismo sitio | pico EchoNet | mismo sitio EchoNet |',
    '|---|---|---:|---:|---:|---:|',
  );
  for (const d of r.decorrelation)
    L.push(
      `| ${short(d.caseId)} | ${d.view} | ${fmt(d.peak)} | ${fmt(d.zeroShift)} | ${fmt(d.echonetPeak)} | ${fmt(d.echonetZeroShift)} |`,
    );
  if (r.echonet?.decorrelation) {
    const d = r.echonet.decorrelation;
    L.push(
      '',
      `EchoNet (${d.videos} vídeos con FE ≥ 55 %, ${q(d.fps, 0)} cuadros/s): pico ${q(d.peak, 2)}, mismo sitio ${q(d.zeroShift, 2)}.`,
    );
  }
  L.push('', '## 5. Prueba de Turing visual', '');
  if (r.turing) {
    L.push(
      `Sesión en \`${r.turing.dir.replace(homedir(), '~')}\`: ${r.turing.clips} elementos.`,
      '',
      '| vista / formato | reales | simulados |',
      '|---|---:|---:|',
      ...Object.entries(r.turing.byView).map(([v, n]) => `| ${v} | ${n.real} | ${n.sim} |`),
    );
    if (r.turing.skipped.length)
      L.push(
        '',
        `Fuera de la sesión por no tener contraparte: ${r.turing.skipped.map((s) => `${s.view} (${s.real} reales, ${s.sim} simulados)`).join('; ')}.`,
      );
  } else L.push('No se generó sesión (sin `--turing`).');
  if (r.graded?.length) {
    L.push(
      '',
      '| lector | lee ecos | respondidas | aciertos | p (azar) | AUC | sim detectados | reales aceptados | delatores más citados |',
      '|---|---|---:|---:|---:|---:|---:|---:|---|',
    );
    for (const g of r.graded)
      L.push(
        `| ${g.reader || '—'} | ${g.echoReader ? 'sí' : 'no'} | ${g.answered} | ${fmt(100 * g.accuracy, 0)} % | ${fmt(g.pChance, 3)} | ${fmt(g.auc)} | ${fmt(100 * g.simDetected, 0)} % | ${fmt(100 * g.realAccepted, 0)} % | ${
          g.giveaways
            .slice(0, 3)
            .map((x) => `${x.giveaway} (${x.count})`)
            .join(', ') || '—'
        } |`,
      );
  } else if (r.turing) L.push('', 'Todavía sin respuestas corregidas (`--answers`).');
  L.push('');
  return L.join('\n');
}
