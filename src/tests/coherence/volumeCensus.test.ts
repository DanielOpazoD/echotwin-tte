// @tier slow
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { loadRoderoVolume } from '@/simulator/anatomy/roderoAsset';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import { volumeHeart } from '@/simulator/anatomy/volumeHeart';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import {
  analyticGrid,
  censusFindings,
  renderVolumeCensus,
  roderoGrid,
  volumeCensus,
  type LabelGrid,
  type V3,
} from './volumeCensus';

/**
 * The census by pairs of neighbouring structures (decision 365), over the Rodero volume as the app binds it and over the
 * analytic heart, both of the normal case at end-diastole: what lies between two cavities, the gaps and the fat within
 * reach of both inside the heart, the septa's thickness, the walls', the myocardium past each atrioventricular hinge and
 * the blood that touches blood away from the orifices, each against its threshold. What fails today is declared with its
 * figure; a declaration that stops failing fails the test.
 */

/**
 * Each entry: `anatomy key` → the figure the census read on main at decision 365 (mL, mm or cm², as the rule says).
 *
 * Rodero: the gaps the closing of the silhouette leaves between each atrium and the aortic root (0.47 and 0.39 mL, with
 * a little groove fat crept beside them), between the right ventricle and the pulmonary trunk (0.31), and between each
 * vein's cut end and its atrium (0.05–0.43) — the 2.5 mL decision 364 left outside the four chambers; the right
 * ventricular wall of the mean mesh rising 1–4 mm past the tricuspid rim all around the ring beside the right atrium
 * (2.15 mL; the LV's sheet past the mitral hinge did 10–15 mm before decision 364); and the cut ends of the aortic root and
 * the pulmonary trunk touching lumen to lumen above the valves (0.09 cm²).
 *
 * Analytic: its interatrial septum is IAS_MUSCULAR_CM = 5.5 mm thick (6.0 on the 1 mm grid; a septum measures 3–5);
 * pericardium (read as a gap) and groove fat lie within 6 mm of two cavities at every junction: the atria, the atria and
 * the root, the right ventricle and the trunk, each vein and the coronary sinus with its atrium. A right pulmonary vein
 * touched the right atrium's blood (0.07 cm²) until the septum thinned smoothly into the fossa (decision 369). Since its
 * right ventricular wall ends at the
 * tricuspid hinge and the atrium's lateral wall rises from it (decision 367; the wall rose up to 8.6 mm past the hinge,
 * 1.93 mL, and reads 0.26 mL now, under the census's threshold), the groove fat by the inferior vena cava reads 0.73 mL
 * (0.47).
 */
const KNOWN_VOLUME_CENSUS: Record<string, number> = {
  'rodero AI|RAo hueco': 0.47,
  'rodero AI|RAo grasa': 0.06,
  'rodero AD|RAo hueco': 0.39,
  'rodero AD|RAo grasa': 0.21,
  'rodero VD|TP hueco': 0.31,
  'rodero VD|TP grasa': 0.05,
  'rodero AI|VP hueco': 0.43,
  'rodero AD|VCS hueco': 0.1,
  'rodero AD|VCI hueco': 0.05,
  'rodero VD sobre bisagra AD': 2.15,
  'rodero sangre AorticRoot|PulmonaryArtery': 0.09,
  'analytic AI|AD hueco': 0.04,
  'analytic AI|AD grasa': 0.35,
  'analytic AI|AD tabique': 6.0,
  'analytic AD|VD hueco': 0.08,
  'analytic AI|RAo hueco': 0.08,
  'analytic AI|RAo grasa': 0.51,
  'analytic AD|RAo hueco': 0.24,
  'analytic AD|RAo grasa': 0.18,
  'analytic VD|TP hueco': 0.11,
  'analytic VD|TP grasa': 0.6,
  'analytic AI|VP hueco': 0.62,
  'analytic AI|VP grasa': 1.14,
  'analytic AD|VCS hueco': 0.21,
  'analytic AD|VCS grasa': 0.59,
  'analytic AD|VCI hueco': 0.26,
  'analytic AD|VCI grasa': 0.73,
  'analytic AD|SC hueco': 0.1,
  'analytic AD|SC grasa': 0.49,
};
/** A declared figure may grow this much before the test fails: a quarter for volumes and areas, half a millimetre for thicknesses. */
const allowed = (key: string, known: number): number =>
  /tabique|pared/.test(key) ? known + 0.5 : known * 1.25 + 0.02;

const fromPublic = (path: string): Promise<ArrayBuffer> => {
  const b = readFileSync(join(process.cwd(), 'public', path));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('the volume census by pairs reads both hearts, and finds only what is declared (decision 365)', async () => {
  const { heart, tables } = buildCaseModels(loadCaseById('normal-excellent-window'), REST_PATIENT);
  const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
  const grids: Record<string, () => LabelGrid> = {
    rodero: () => roderoGrid(volumeHeart(roderoVolume, heart, ed).gpu()),
    analytic: () => analyticGrid(heart, ed, 1),
  };
  const roderoVolume = await loadRoderoVolume(fromPublic);
  const seen = new Set<string>();
  for (const anatomy of Object.keys(grids))
    it(anatomy, () => {
      const c = volumeCensus(grids[anatomy]!());
      // the census reads what it is built to read: both septa, both hinges, the five walls
      const pair = (a: string, b: string) => c.pairs.find((p) => p.a === a && p.b === b)!;
      expect(pair('AI', 'AD').span!.n).toBeGreaterThan(100);
      expect(pair('VI', 'VD').span!.n).toBeGreaterThan(1000);
      expect(c.hinges.map((h) => h.ventricle)).toEqual(['VI', 'VD']);
      expect(c.walls.filter((w) => w.stats).map((w) => w.wall)).toEqual([
        'VI tabique',
        'VI pared libre',
        'VD',
        'AI',
        'AD',
      ]);
      const problems: string[] = [];
      for (const f of censusFindings(c)) {
        const key = `${anatomy} ${f.key}`;
        const known = KNOWN_VOLUME_CENSUS[key];
        if (known === undefined) problems.push(f.text);
        else {
          seen.add(key);
          if (f.figure > allowed(key, known)) problems.push(`${f.text}; declarado ${known}`);
        }
      }
      expect(problems, renderVolumeCensus(c).join('\n')).toEqual([]);
    });
  it('every declared finding still shows', () => {
    expect(Object.keys(KNOWN_VOLUME_CENSUS).filter((k) => !seen.has(k))).toEqual([]);
  });
});

/**
 * A synthetic grid with known figures (1 mm voxels, 0.1 cm of the model per mm): two atria with a four-voxel septum
 * between them, a gap of 24 voxels and 24 of fat above the septum inside the body, the outside beneath the atria within
 * reach of both (which the closure must leave out), a pulmonary vein touching the right atrium's blood, a left ventricle
 * with its annulus ring and a slab of its myocardium rising 1–5 mm past the hinge beside the left atrium, and two-voxel
 * walls on the atria and the ventricle.
 */
function syntheticGrid(): LabelGrid {
  const N = 40;
  const L = new Uint8Array(N * N * N);
  const at = (i: number, j: number, k: number) => i + N * (j + N * k);
  const box = (
    i0: number,
    i1: number,
    j0: number,
    j1: number,
    k0: number,
    k1: number,
    l: number,
  ) => {
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) L[at(i, j, k)] = l;
  };
  const LV_WALL = 1,
    BODY = 2,
    LA_WALL = 3,
    RA_WALL = 4,
    LV = 7,
    LA = 9,
    RA = 11,
    PV = 12,
    ANNULUS = 33,
    FAT = 50;
  const meaning: Record<number, readonly [Tissue, Structure]> = {
    [LV_WALL]: [Tissue.Myocardium, Structure.LvWallLateral],
    [BODY]: [Tissue.Myocardium, Structure.RvWall],
    [LA_WALL]: [Tissue.Myocardium, Structure.LaWall],
    [RA_WALL]: [Tissue.Myocardium, Structure.RaWall],
    [LV]: [Tissue.Blood, Structure.LvCavity],
    [LA]: [Tissue.Blood, Structure.LaCavity],
    [RA]: [Tissue.Blood, Structure.RaCavity],
    [PV]: [Tissue.Blood, Structure.PulmonaryVein],
    [ANNULUS]: [Tissue.Fibrous, Structure.MitralAnnulus],
  };
  box(5, 35, 5, 35, 5, 35, BODY);
  box(8, 16, 10, 30, 6, 14, LA);
  box(20, 28, 10, 30, 6, 14, RA);
  box(16, 18, 10, 30, 6, 14, LA_WALL);
  box(18, 20, 10, 30, 6, 14, RA_WALL);
  box(17, 19, 18, 22, 14, 17, 0); // the gap: 2 × 4 × 3
  box(17, 19, 22, 26, 14, 17, FAT); // the fat: 2 × 4 × 3
  box(28, 31, 12, 16, 6, 10, PV); // against the right atrium over 4 × 4 faces
  box(9, 15, 30, 33, 6, 10, PV); // against the left atrium, where a vein belongs
  box(8, 16, 10, 30, 21, 30, LV);
  box(6, 18, 8, 32, 21, 30, LV_WALL);
  box(8, 16, 10, 30, 21, 30, LV);
  for (let j = 10; j < 30; j++)
    for (let i = 8; i < 16; i++)
      if (i === 8 || i === 15 || j === 10 || j === 29) L[at(i, j, 20)] = ANNULUS;
  box(8, 14, 12, 28, 15, 20, LV_WALL); // the slab past the hinge beside the left atrium: 6 × 16 × 5
  return {
    dims: [N, N, N],
    voxelMm: 1,
    labels: L,
    meaning: (l) => (l === FAT ? null : (meaning[l] ?? null)),
    fat: FAT,
    cmPerMm: 0.1,
    // the mitral centre at voxel (12, 20, 20), z toward the ventricle
    toAnat: (v) => [(v % N) - 12, (Math.floor(v / N) % N) - 20, Math.floor(v / (N * N)) - 20] as V3,
  };
}

describe('the volume census on a grid with known figures (decision 365)', () => {
  const c = volumeCensus(syntheticGrid());
  const voxelMl = 0.001;
  it('reads the septum through every voxel between the facing atria: four voxels of wall, one more of distance', () => {
    const p = c.pairs.find((x) => x.a === 'AI' && x.b === 'AD')!;
    expect(p.span).toEqual({ n: 4 * 20 * 8, median: 5, p90: 5, max: 5 });
    // what lies within 8 mm of both: the two walls, the gap, the fat, and the body
    const share = Object.fromEntries(p.between.map((e) => [e.name, e.share]));
    expect(share['LaWall/myo']).toBeCloseTo(share['RaWall/myo']!, 6);
    expect(share['hueco']).toBeCloseTo(share['grasa']!, 6);
    expect(share['RvWall/myo']).toBeGreaterThan(0);
    // the outside beneath the atria lies within reach of both, and is not a gap
    expect(share['exterior']).toBeGreaterThan(share['hueco']!);
  });
  it('counts the gap inside the body, not the outside beneath the atria, and the fat', () => {
    const p = c.pairs.find((x) => x.a === 'AI' && x.b === 'AD')!;
    expect(p.gapMl).toBeCloseTo(24 * voxelMl, 9);
    expect(p.gapAt!.map((x) => Math.round(10 * x) / 10)).toEqual([5.5, -0.5, -5]);
    expect(p.fatMl).toBeCloseTo(24 * voxelMl, 9);
  });
  it('finds the vein touching the right atrium over its sixteen faces, and not the one opening into the left', () => {
    expect(c.contacts.map((k) => k.key)).toEqual(['PulmonaryVein|RaCavity']);
    expect(c.contacts[0]!.cm2).toBeCloseTo(16 * 0.01, 9);
  });
  it('measures the slab of ventricular myocardium past the hinge beside the left atrium, and how far it rises', () => {
    const h = c.hinges.find((x) => x.ventricle === 'VI')!;
    expect(h.side.AI).toBeCloseTo(6 * 16 * 5 * voxelMl, 9);
    expect(h.side.AD).toBe(0);
    expect(h.side.otro).toBe(0);
    expect(h.above.AI).toEqual({ n: 480, median: 3, p90: 5, max: 5 });
    expect(h.sectors.reduce((s, x) => s + x.AI, 0)).toBeCloseTo(h.side.AI, 9);
  });
  it('measures two-voxel walls as 2 mm', () => {
    const median = Object.fromEntries(c.walls.map((w) => [w.wall, w.stats?.median]));
    expect(median).toEqual({ 'VI pared libre': 2, AI: 2, AD: 2 });
  });
  it('holds the figures against the thresholds', () => {
    expect(censusFindings(c).map((f) => f.key)).toEqual([
      'AI|AD hueco',
      'AI|AD grasa',
      'VI sobre bisagra AI',
      'pared VI pared libre',
      'sangre PulmonaryVein|RaCavity',
    ]);
  });
});
