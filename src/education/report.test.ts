// @tier fast
import { describe, expect, it } from 'vitest';
import { buildEducationalReport, deriveCalculations, pathologyImpressions } from './report';
import { loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import type { Measurement, TechniqueFinding } from '@/simulator/measurements/types';

const truthOf = (id: string) => computeGroundTruth(loadCaseById(id));
const normal = truthOf('normal-excellent-window');

let seq = 0;
const m = (over: Partial<Measurement>): Measurement => ({
  id: `m${++seq}`,
  kind: 'linear',
  label: 'Distancia',
  value: 1,
  units: 'cm',
  modality: '2d',
  sourceViewId: 'plax',
  viewScore: 80,
  frameId: 1,
  phase: 0.1,
  timeS: 1,
  geometry: [],
  imageQualityScore: 90,
  userAssisted: false,
  referenceGuidelineIds: [],
  createdAt: '2026-09-10T00:00:00Z',
  ...over,
});
const protocol = (measurementId: string, value: number, over: Partial<Measurement> = {}) =>
  m({ measurementId, value, ...over });
const finding = (level: TechniqueFinding['level'], message: string): TechniqueFinding => ({
  code: message,
  level,
  message,
});

describe('buildEducationalReport', () => {
  it('reports an empty study without rows and with the model impression', () => {
    const r = buildEducationalReport([], normal, false);
    expect(r.rows).toEqual([]);
    expect(r.derived).toEqual([]);
    expect(r.studyQuality).toBe('Sin mediciones registradas.');
    expect(r.impression[0]).toMatch(/^FEVI del modelo .*función sistólica conservada\.$/);
    expect(r.impression).toContain('Sin estenosis aórtica significativa.');
  });

  it('compares protocol measurements with the truth and states the deviation', () => {
    const r = buildEducationalReport(
      [protocol('lvot-diameter', normal.lvot.diameterCm * 1.1)],
      normal,
      false,
    );
    const row = r.rows[0]!;
    expect(row.truth).not.toBeNull();
    expect(row.deviation).toBe('+10 %');
    expect(row.technique).toBeNull();
    expect(row.value).toMatch(/cm$/);
    expect(r.studyQuality).toBe('Mediciones obtenidas con técnica adecuada.');
  });

  it('formats time and volume rows without decimals and others with two', () => {
    const r = buildEducationalReport(
      [
        m({ kind: 'time', value: 210.4, units: 'ms', measurementId: 'mitral-dt' }),
        m({ kind: 'volume', value: 120.6, units: 'mL', measurementId: 'lv-edv-simpson' }),
        m({ kind: 'velocity', value: 1.234, units: 'm/s', measurementId: 'av-vmax' }),
      ],
      normal,
      false,
    );
    expect(r.rows.map((x) => x.value)).toEqual(['210 ms', '121 mL', '1.23 m/s']);
    for (const row of r.rows) expect(row.truth).not.toBeNull();
  });

  it('maps free measurements to the closest plausible truth by kind and modality', () => {
    const r = buildEducationalReport(
      [
        m({ kind: 'velocity', units: 'm/s', modality: 'cw', value: normal.aorticValve.vmaxMps }),
        m({ kind: 'vti', units: 'cm', modality: 'pw', value: normal.lvot.vtiCm }),
        m({ kind: 'linear', value: normal.lv.eddCm }),
        m({ kind: 'area', units: 'cm²', value: 3 }),
      ],
      normal,
      false,
    );
    expect(r.rows[0]!.deviation).toBe('+0 %');
    expect(r.rows[1]!.deviation).toBe('+0 %');
    expect(r.rows[2]!.deviation).toBe('+0 %');
    expect(r.rows[3]!.truth).toBeNull();
    expect(r.rows[3]!.deviation).toBeNull();
  });

  it('hides the truth in exam mode and asks for the user impression', () => {
    const r = buildEducationalReport([protocol('lvot-diameter', 2)], normal, true);
    expect(r.rows[0]!.truth).toBeNull();
    expect(r.rows[0]!.deviation).toBeNull();
    expect(r.impression).toHaveLength(1);
    expect(r.impression[0]).toMatch(/^Redacta tu impresión/);
  });

  it('names no view and grades no technique until the exam is finished', () => {
    const graded = protocol('lvot-diameter', 2, {
      sourceViewId: 'a4c',
      viewScore: 35,
      technique: { score: 0.2, findings: [finding('invalid', 'Vista A4C: se mide en PLAX.')] },
    });
    const exam = buildEducationalReport([graded], normal, true);
    expect(exam.rows[0]!.view).toBeNull();
    expect(exam.rows[0]!.viewScore).toBeNull();
    expect(exam.rows[0]!.technique).toBeNull();
    expect(exam.studyQuality).toBe(
      '1 medición registrada; la técnica se evalúa al finalizar el examen.',
    );
    expect(JSON.stringify(exam)).not.toMatch(/a4c|A4C/);
    const finished = buildEducationalReport([graded], normal, false);
    expect(finished.rows[0]!.view).toBe('a4c');
    expect(finished.rows[0]!.technique?.level).toBe('invalid');
  });

  it('gives no impression without truth and none hidden', () => {
    const r = buildEducationalReport([protocol('lvot-diameter', 2)], null, false);
    expect(r.rows[0]!.truth).toBeNull();
    expect(r.impression).toEqual([]);
  });

  it('summarises the technique grade and lists only the non-ok findings', () => {
    const r = buildEducationalReport(
      [
        m({ technique: { score: 0.92, findings: [finding('ok', 'bien')] } }),
        m({
          technique: {
            score: 0.6,
            findings: [finding('ok', 'bien'), finding('warn', 'fase tardía')],
          },
        }),
        m({
          technique: {
            score: 0.2,
            findings: [finding('warn', 'fase tardía'), finding('invalid', 'vista errónea')],
          },
        }),
      ],
      normal,
      false,
    );
    expect(r.rows.map((x) => x.technique)).toEqual([
      { score: 92, level: 'ok', notes: [] },
      { score: 60, level: 'warn', notes: ['fase tardía'] },
      { score: 20, level: 'invalid', notes: ['fase tardía', 'vista errónea'] },
    ]);
    expect(r.studyQuality).toMatch(/^1 de 3 mediciones tienen problemas de técnica/);
  });

  it('counts a free measurement on a poor view as low quality', () => {
    const r = buildEducationalReport([m({ viewScore: 30 }), m({ viewScore: null })], normal, false);
    expect(r.studyQuality).toMatch(/^1 de 2 mediciones/);
  });

  it('grades the aortic stenosis of the model in the impression', () => {
    const severe = buildEducationalReport([], truthOf('aortic-stenosis-severe'), false);
    expect(severe.impression.some((l) => /estenosis aórtica severa/.test(l))).toBe(true);
    const moderate = buildEducationalReport([], truthOf('aortic-stenosis-moderate'), false);
    expect(moderate.impression.some((l) => /estenosis aórtica moderada/.test(l))).toBe(true);
    const sclerosis = buildEducationalReport(
      [],
      { ...normal, aorticValve: { ...normal.aorticValve, vmaxMps: 2.4 } },
      false,
    );
    expect(sclerosis.impression).toContain('Esclerosis aórtica / estenosis leve (Vmax 2–3 m/s).');
    const reduced = buildEducationalReport([], truthOf('hfref-severe-mr'), false);
    expect(reduced.impression[0]).toMatch(/función sistólica reducida/);
  });
});

describe('deriveCalculations', () => {
  const ids = (ms: Measurement[]) => deriveCalculations(ms).map((r) => r.id);

  it('derives nothing from free measurements', () => {
    expect(ids([m({ value: 4 })])).toEqual([]);
  });

  it('computes EF and stroke volume by Simpson from the latest volumes', () => {
    const rows = deriveCalculations([
      protocol('lv-edv-simpson', 90),
      protocol('lv-esv-simpson', 70),
      protocol('lv-edv-simpson', 120),
      protocol('lv-esv-simpson', 48),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['ef-simpson', 'sv-simpson']);
    expect(rows[0]!.value).toBe('60 %');
    expect(rows[0]!.inputs).toBe('VTD 120 mL, VTS 48 mL');
    expect(rows[1]!.value).toBe('72 mL');
  });

  it('skips Simpson when the end-diastolic volume is missing or zero', () => {
    expect(ids([protocol('lv-esv-simpson', 48)])).toEqual([]);
    expect(ids([protocol('lv-edv-simpson', 0), protocol('lv-esv-simpson', 0)])).toEqual([]);
  });

  it('chains LVOT area, Doppler stroke volume, AVA by continuity and velocity ratio', () => {
    const rows = deriveCalculations([
      protocol('lvot-diameter', 2),
      protocol('lvot-vti', 20),
      protocol('av-vti', 80),
    ]);
    expect(rows.map((r) => r.id)).toEqual([
      'lvot-area',
      'sv-doppler',
      'ava-continuity',
      'velocity-ratio',
    ]);
    expect(rows[0]!.value).toBe('3.14 cm²');
    expect(rows[1]!.value).toBe('63 mL');
    expect(rows[2]!.value).toBe('0.79 cm²');
    expect(rows[3]!.value).toBe('0.25');
    expect(rows[3]!.formula).toBe('VTI TSVI / VTI VAo');
  });

  it('stops the continuity chain at the first missing input', () => {
    expect(ids([protocol('lvot-diameter', 2)])).toEqual(['lvot-area']);
    expect(ids([protocol('lvot-diameter', 2), protocol('lvot-vti', 20)])).toEqual([
      'lvot-area',
      'sv-doppler',
    ]);
    expect(ids([protocol('lvot-vti', 20), protocol('av-vti', 80)])).toEqual([]);
    expect(
      ids([protocol('lvot-diameter', 2), protocol('lvot-vti', 20), protocol('av-vti', 0)]),
    ).toEqual(['lvot-area', 'sv-doppler']);
  });

  it('computes the aortic peak gradient and the RV systolic pressure with Bernoulli', () => {
    const rows = deriveCalculations([protocol('av-vmax', 4), protocol('tr-vmax', 3)]);
    expect(rows.map((r) => [r.id, r.value])).toEqual([
      ['av-peak-gradient', '64 mmHg'],
      ['rvsp', '39 mmHg'],
    ]);
  });

  it('computes E/A and E/e′ with the available annular velocities', () => {
    expect(ids([protocol('mitral-e', 0.8), protocol('mitral-a', 0)])).toEqual([]);
    const both = deriveCalculations([
      protocol('mitral-e', 0.8),
      protocol('mitral-a', 0.5),
      protocol('e-prime-septal', 8),
      protocol('e-prime-lateral', 12),
    ]);
    expect(both.map((r) => [r.id, r.value, r.label])).toEqual([
      ['e-a', '1.60', 'Relación E/A'],
      ['e-eprime', '8.0', 'E/e′ promedio'],
    ]);
    const septal = deriveCalculations([protocol('mitral-e', 0.8), protocol('e-prime-septal', 8)]);
    expect(septal.map((r) => [r.id, r.value, r.label])).toEqual([
      ['e-eprime', '10.0', 'E/e′ septal'],
    ]);
    const lateral = deriveCalculations([
      protocol('mitral-e', 0.8),
      protocol('e-prime-lateral', 10),
    ]);
    expect(lateral.map((r) => [r.id, r.value, r.label])).toEqual([
      ['e-eprime', '8.0', 'E/e′ lateral'],
    ]);
    expect(ids([protocol('e-prime-septal', 8)])).toEqual([]);
  });
});

describe('pathologyImpressions', () => {
  const lines = (id: string) => pathologyImpressions(truthOf(id));
  const has = (ls: string[], re: RegExp) => ls.some((l) => re.test(l));

  it('is silent for the normal case', () => {
    expect(lines('normal-excellent-window')).toEqual([]);
  });

  it('describes the systolic dysfunction, the mitral regurgitation and the dilated atrium of HFrEF', () => {
    const ls = lines('hfref-severe-mr');
    expect(has(ls, /^Disfunción sistólica (severa|moderada) del VI \(FEVI \d+ %\)\.$/)).toBe(true);
    expect(has(ls, /^Insuficiencia mitral (leve|moderada|severa) \(ORE/)).toBe(true);
    expect(has(ls, /^Aurícula izquierda dilatada/)).toBe(true);
  });

  it('describes the regional wall motion abnormality', () => {
    expect(
      has(
        lines('inferior-rwma'),
        /^Alteración segmentaria en \d+ segmento\(s\) del modelo de 16: [\d, ]+; índice de motilidad \d,\d\d\.$/,
      ),
    ).toBe(true);
  });

  it('describes the septal hypertrophy and the dynamic obstruction of HOCM', () => {
    const ls = lines('hocm-sam');
    expect(has(ls, /^Obstrucción dinámica del TSVI con gradiente pico \d+ mmHg/)).toBe(true);
    expect(has(ls, /^Hipertrofia septal asimétrica \(SIV/)).toBe(true);
  });

  it('describes the right heart of pulmonary hypertension', () => {
    const ls = lines('pulmonary-hypertension-rv');
    expect(has(ls, /^Presión sistólica del VD estimada \d+ mmHg \(probabilidad/)).toBe(true);
    expect(has(ls, /^Ventrículo derecho dilatado/)).toBe(true);
  });

  it('grades the effusion and the tamponade', () => {
    const ls = lines('pericardial-effusion-tamponade');
    expect(has(ls, /^Derrame pericárdico (leve|moderado|severo) \(\d\.\d cm\)/)).toBe(true);
    expect(has(ls, /taponamiento/)).toBe(true);
  });

  it('warns about the diastolic assessment in atrial fibrillation', () => {
    expect(has(lines('af-diastolic'), /^Fibrilación auricular: sin onda A/)).toBe(true);
  });

  it('grades regurgitations by orifice area and flags eccentric jets', () => {
    const base = truthOf('mvp-primary-mr');
    const mr = base.regurgitation.mr;
    if (!mr) throw new Error('mvp case must model MR');
    const severe = pathologyImpressions({
      ...base,
      regurgitation: { ...base.regurgitation, mr: { ...mr, eroaCm2: 0.45, jetDirectionDeg: 40 } },
    });
    expect(has(severe, /^Insuficiencia mitral severa .*, chorro excéntrico\.$/)).toBe(true);
    const mild = pathologyImpressions({
      ...base,
      regurgitation: { ...base.regurgitation, mr: { ...mr, eroaCm2: 0.1, jetDirectionDeg: 0 } },
    });
    expect(has(mild, /^Insuficiencia mitral leve /)).toBe(true);
    expect(has(mild, /excéntrico/)).toBe(false);
    const ar = pathologyImpressions({
      ...normal,
      regurgitation: {
        ...normal.regurgitation,
        ar: { eroaCm2: 0.15, phtMs: 400, regurgitantVolumeMl: 30 } as never,
      },
    });
    expect(has(ar, /^Insuficiencia aórtica moderada \(ORE 0\.15 cm², PHT 400 ms/)).toBe(true);
  });

  it('grades a fixed obstruction, an intermediate RV pressure and a mild effusion', () => {
    const ls = pathologyImpressions({
      ...normal,
      lvot: { ...normal.lvot, peakGradientMmHg: 35, dynamicObstruction: false },
      rightHeart: { ...normal.rightHeart, rvspMmHg: 40 },
      pericardium: { ...normal.pericardium, effusionCm: 0.6, tamponade: 0 },
    });
    expect(ls).toContain('Obstrucción fija del TSVI con gradiente pico 35 mmHg.');
    expect(ls).toContain(
      'Presión sistólica del VD estimada 40 mmHg (probabilidad intermedia de hipertensión pulmonar).',
    );
    expect(ls).toContain('Derrame pericárdico leve (0.6 cm).');
  });
});

/**
 * The biplane method of discs (decision 180). A trace from one side of the annulus to the other through the apex of a
 * half-ellipse of base radius r and length L outlines half an ellipsoid; two perpendicular planes with radii r₁ and r₂
 * outline half an ellipsoid of volume (2/3)·π·r₁·r₂·L, which a single plane misses by the ratio of the radii.
 */
describe('biplane volumes', () => {
  const PX_PER_CM = 30;
  const sector = {
    apexX: 300,
    apexY: 20,
    pxPerCm: PX_PER_CM,
    width: 600,
    height: 520,
    sectorRad: 1.4,
    depthCm: 16,
    invertLR: false,
  };
  const halfEllipse = (rCm: number, lCm: number) =>
    Array.from({ length: 61 }, (_, i) => {
      const th = Math.PI * (1 - i / 60);
      return { x: 300 + rCm * Math.cos(th) * PX_PER_CM, y: 400 - lCm * Math.sin(th) * PX_PER_CM };
    });
  const trace = (id: string, view: string, rCm: number, lCm: number) =>
    protocol(id, (2 / 3) * Math.PI * rCm * rCm * lCm, {
      kind: 'volume',
      units: 'mL',
      sourceViewId: view,
      geometry: halfEllipse(rCm, lCm),
      captureSector: sector,
    });
  const half = (r1: number, r2: number, l: number) => (2 / 3) * Math.PI * r1 * r2 * l;
  const row = (rows: ReturnType<typeof deriveCalculations>, id: string) =>
    rows.find((r) => r.id === id);

  it('combines the four- and two-chamber traces of the LV into biplane volumes and EF', () => {
    const rows = deriveCalculations([
      trace('lv-edv-simpson', 'a4c', 2.5, 8),
      trace('lv-edv-simpson', 'a2c', 2.0, 8),
      trace('lv-esv-simpson', 'a4c', 1.8, 7),
      trace('lv-esv-simpson', 'a2c', 1.5, 7),
    ]);
    const edv = Number.parseFloat(row(rows, 'lv-edv-biplane')!.value);
    const esv = Number.parseFloat(row(rows, 'lv-esv-biplane')!.value);
    expect(Math.abs(edv / half(2.5, 2.0, 8) - 1)).toBeLessThan(0.02);
    expect(Math.abs(esv / half(1.8, 1.5, 7) - 1)).toBeLessThan(0.02);
    // the single planes miss it by the ratio of the radii: 105 and 67 mL against 84
    const ef = 100 * (1 - half(1.8, 1.5, 7) / half(2.5, 2.0, 8));
    expect(Math.abs(Number.parseFloat(row(rows, 'ef-biplane')!.value) - ef)).toBeLessThan(1.5);
    expect(row(rows, 'lv-edv-biplane')!.inputs).toBe('L A4C 8.0 cm, A2C 8.0 cm');
  });

  it('gives the biplane LA volume and its index, and flags lengths more than 5 mm apart', () => {
    const rows = deriveCalculations(
      [trace('la-volume', 'a4c', 2.0, 5.0), trace('la-volume', 'a2c', 1.8, 4.8)],
      1.9,
    );
    const v = Number.parseFloat(row(rows, 'la-volume-biplane')!.value);
    expect(Math.abs(v / half(2.0, 1.8, 5.0) - 1)).toBeLessThan(0.05);
    expect(row(rows, 'la-volume-biplane')!.inputs).toBe('L A4C 5.0 cm, A2C 4.8 cm');
    expect(row(rows, 'la-volume-index')!.value).toBe(`${(v / 1.9).toFixed(0)} mL/m²`);
    expect(row(rows, 'la-volume-index')!.inputs).toMatch(/^biplano /);
    const foreshortened = deriveCalculations(
      [trace('la-volume', 'a4c', 2.0, 5.0), trace('la-volume', 'a2c', 1.8, 4.2)],
      1.9,
    );
    expect(row(foreshortened, 'la-volume-biplane')!.inputs).toMatch(/longitudes dispares/);
  });

  it('needs both views and the same measurement; the index falls back to one plane and flags a dilated atrium', () => {
    const one = deriveCalculations([trace('la-volume', 'a4c', 2.6, 6.2)], 1.8);
    expect(row(one, 'la-volume-biplane')).toBeUndefined();
    expect(row(one, 'la-volume-index')!.inputs).toMatch(/^monoplano /);
    expect(row(one, 'la-volume-index')!.value).toMatch(/\(dilatada\)$/);
    const mixed = deriveCalculations([
      trace('lv-edv-simpson', 'a4c', 2.5, 8),
      trace('lv-esv-simpson', 'a2c', 1.5, 7),
    ]);
    expect(row(mixed, 'lv-edv-biplane')).toBeUndefined();
    expect(row(mixed, 'lv-esv-biplane')).toBeUndefined();
    expect(row(deriveCalculations([trace('la-volume', 'a4c', 2.0, 5.0)]), 'la-volume-index')).toBe(
      undefined,
    );
  });
});
