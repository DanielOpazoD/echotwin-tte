// @tier slow
import { describe, expect, it } from 'vitest';
import { aha17FromCode, lv16FromCode, lv18Segment, lvSegmentCode, lvWallKind } from './lvSegments';
import { RV_GROOVE_ANTERIOR_RAD, RV_GROOVE_INFERIOR_RAD } from './anchors';
import {
  classifyHeart,
  computeHeartPose,
  createHeartModel,
  lvCavityRadiusAt,
  torsoToHeart,
} from './heartModel';
import { makeSample, Structure, Tissue } from './tissue';
import { normalExcellentCase } from '@/cases/normal-excellent';
import { validateCase } from '@/cases/schema';
import { loadCaseById } from '@/cases';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { LV_18 } from '@/clinical/segmentation/catalog';
import { buildCaseModels } from './caseModels';
import { getViewTarget } from '@/simulator/windows/viewTargets';
import { canonicalControl } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { add, scale } from '@/core/vec3';

/**
 * LV myocardial segments of the model (decision 152): boundaries, orientation, the 17 / 16 / 18 models and the
 * identity of a piece of tissue through the cycle, measured on the classifier the renderers use.
 */
const A = RV_GROOVE_ANTERIOR_RAD;
const P = RV_GROOVE_INFERIOR_RAD;
const SEPTAL_DEG = (((A + P) / 2) * 180) / Math.PI;
/** Heart-frame azimuth (rad) of an angle of the AHA wheel (septal centre 180°, walls every 60°). */
const azOf = (ahaDeg: number): number => ((ahaDeg - 180 + SEPTAL_DEG) * Math.PI) / 180;
const code = (ahaDeg: number, levelFrac: number): number =>
  lvSegmentCode(azOf(ahaDeg), levelFrac, A, P);
const EPS = 0.01; // degrees

describe('LV segment code: rules', () => {
  it('orients the walls: anterior 1/7/13, inferior 4/10/15, septum between the RV insertions', () => {
    const at = (az: number, lf: number) => aha17FromCode(lvSegmentCode(az, lf, A, P));
    // heart frame: +y anterior, −y inferior, −x septal, +x lateral
    expect([0.15, 0.5, 0.8].map((lf) => at(Math.PI / 2, lf))).toEqual([1, 7, 13]);
    expect([0.15, 0.5, 0.8].map((lf) => at(-Math.PI / 2, lf))).toEqual([4, 10, 15]);
    expect(at(Math.PI, 0.8)).toBe(14);
    expect(at(0, 0.8)).toBe(16);
    // the septum holds exactly two basal and two mid segments, bounded by the anterior and inferior insertions
    const inSeptum = (az: number, lf: number) => at(az, lf);
    for (let k = 1; k < 20; k++) {
      const az = A + ((P - A) * k) / 20;
      expect([2, 3]).toContain(inSeptum(az, 0.15));
      expect([8, 9]).toContain(inSeptum(az, 0.5));
    }
    expect(at(A - 0.05, 0.15)).toBe(1); // anterior to the anterior insertion
    expect(at(P + 0.05, 0.15)).toBe(4); // inferior to the inferior insertion
  });

  it('puts the septal boundaries of 1|2 and 3|4 on the RV insertions of the model', () => {
    // the grooves are 2.1 rad (120.3°) apart; the boundaries are the septal centre ± 60°
    const toAha = (az: number) => (az * 180) / Math.PI - SEPTAL_DEG + 180;
    expect(Math.abs(toAha(A) - 120)).toBeLessThan(0.2);
    expect(Math.abs(toAha(P) - 240)).toBeLessThan(0.2);
  });

  it('draws every basal and mid boundary at a multiple of 60°, both sides, including 0/360', () => {
    // [boundary, segment just below, segment at/above] for the basal ring
    const basal: [number, number, number][] = [
      [60, 6, 1],
      [120, 1, 2],
      [180, 2, 3],
      [240, 3, 4],
      [300, 4, 5],
      [360, 5, 6],
    ];
    for (const [b, below, above] of basal) {
      expect(code(b - EPS, 0.1), `basal ${b}−`).toBe(below);
      expect(code(b + EPS, 0.1), `basal ${b}+`).toBe(above);
      expect(code(b - EPS, 0.5), `mid ${b}−`).toBe(below + 6);
      expect(code(b + EPS, 0.5), `mid ${b}+`).toBe(above + 6);
    }
    // centres
    expect([30, 90, 150, 210, 270, 330].map((d) => code(d, 0.1))).toEqual([6, 1, 2, 3, 4, 5]);
  });

  it('draws the four apical segments on 90° quadrants centred on the walls, including 0/360', () => {
    const apical: [number, number, number][] = [
      [45, 16, 13],
      [135, 13, 14],
      [225, 14, 15],
      [315, 15, 16],
      [360, 16, 16],
    ];
    for (const [b, below, above] of apical) {
      expect(code(b - EPS, 0.8), `apical ${b}−`).toBe(below);
      expect(code(b + EPS, 0.8), `apical ${b}+`).toBe(above);
    }
    expect([90, 180, 270, 0].map((d) => code(d, 0.8))).toEqual([13, 14, 15, 16]);
  });

  it('splits the axis into thirds of the annulus–cavity length and puts the cap beyond the cavity', () => {
    for (const d of [30, 90, 150, 210, 270, 330]) {
      const b = code(d, 0);
      expect(code(d, 1 / 3 - 1e-6)).toBe(b);
      expect(code(d, 1 / 3 + 1e-6)).toBe(b + 6);
      expect(code(d, 2 / 3 - 1e-6)).toBe(b + 6);
      expect(code(d, 2 / 3 + 1e-6)).toBeGreaterThanOrEqual(13);
      expect(code(d, 2 / 3 + 1e-6)).toBeLessThanOrEqual(16);
    }
    // up to the end of the cavity it is apical; the old model began the cap at 93 % of it
    expect(code(0, 0.95)).toBe(16);
    expect(code(0, 0.999)).toBe(16);
    expect([90, 180, 270, 0].map((d) => code(d, 1))).toEqual([17, 18, 19, 20]);
  });
});

describe('LV segment models: AHA 17, wall motion 16 and the separate 18', () => {
  const grid: [number, number][] = [];
  for (let d = 0; d < 360; d += 5) for (let lf = 0; lf <= 1.0001; lf += 0.05) grid.push([d, lf]);

  it('AHA 17 reads the cap as 17 and nothing else; the 16-segment model gives the cap to 13–16', () => {
    const aha = new Set<number>();
    const wm = new Set<number>();
    for (const [d, lf] of grid) {
      const c = code(d, Math.min(1, lf));
      aha.add(aha17FromCode(c));
      wm.add(lv16FromCode(c));
      if (c >= 17) {
        expect(aha17FromCode(c)).toBe(17);
        // the apex of the wall-motion model is the apical segment of the same quadrant
        expect(lv16FromCode(c)).toBe(code(d, 0.9));
      }
    }
    expect([...aha].sort((a, b) => a - b)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    expect([...wm].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(aha17FromCode(0)).toBe(0);
    expect(lv16FromCode(0)).toBe(0);
  });

  it('keeps the 18-segment topology apart: six apical segments reaching the apex', () => {
    const ids = new Set<number>();
    for (const [d, lf] of grid) ids.add(lv18Segment(azOf(d), Math.min(1, lf), A, P));
    expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    // apical anteroseptal and apical inferoseptal are distinct 18-segment ids that AHA folds into apical septal 14
    const as = lv18Segment(azOf(150), 0.8, A, P);
    const is = lv18Segment(azOf(210), 0.8, A, P);
    expect(LV_18[as - 1]!.nameEn).toBe('Apical anteroseptal');
    expect(LV_18[is - 1]!.nameEn).toBe('Apical inferoseptal');
    expect(code(150, 0.8)).toBe(14);
    expect(code(210, 0.8)).toBe(14);
    // the apex belongs to the apical ring, never to a cap id
    expect(lv18Segment(azOf(90), 1, A, P)).toBe(13);
  });
});

describe('LV segments on the classifier', () => {
  const c = validateCase(normalExcellentCase).case!;
  const model = createHeartModel(c.anatomy, c.physiology);
  const tables = buildBeatTables(
    60 / c.rhythm.heartRateBpm,
    c.physiology,
    c.rhythm,
    c.hemodynamics,
  );
  const esPhase = tables.timings.ejectionEndS / tables.rrS;
  const phases = [0, esPhase * 0.5, esPhase, (esPhase + 1) * 0.5];
  const poses = phases.map((p) => computeHeartPose(model, cycleStateAt(tables, p)));
  const L = model.lv.lengthCm;
  const s = makeSample();

  /** Mid-wall point of the LV at a material azimuth and level fraction for a pose, walking out from the cavity. */
  function midWall(
    pose: (typeof poses)[number],
    az: number,
    lf: number,
  ): { r: number; z: number } | null {
    const z = pose.zAnn + lf * pose.lengthNow;
    const r0 = lvCavityRadiusAt(model, pose, az, z);
    const hits: number[] = [];
    for (let r = Math.max(0, r0 - 1); r < r0 + 2.5; r += 0.01) {
      classifyHeart(model, pose, r * Math.cos(az), r * Math.sin(az), z, s);
      if (s.tissue === Tissue.Myocardium && s.segment > 0) hits.push(r);
      else if (hits.length) break;
    }
    return hits.length > 2 ? { r: hits[hits.length >> 1]!, z } : null;
  }

  it('keeps the segment of a piece of tissue through the cycle (material azimuth and level)', () => {
    let followed = 0;
    // 10° off every boundary: the classifier's azimuth is a fast arctangent (error < 0.3°), the shader's is exact
    for (let d = 10; d < 360; d += 20) {
      for (const lf of [0.1, 0.3, 0.36, 0.5, 0.64, 0.7, 0.9]) {
        const az = azOf(d);
        const expected = lvSegmentCode(az, lf, A, P);
        const seen: number[] = [];
        const material: number[] = [];
        const materialAz: number[] = [];
        for (const pose of poses) {
          const w = midWall(pose, az, lf);
          if (!w) continue;
          classifyHeart(model, pose, w.r * Math.cos(az), w.r * Math.sin(az), w.z, s);
          seen.push(s.segment);
          // the material long-axis coordinate of the sample is the same at every phase
          material.push(s.mz);
          materialAz.push(Math.atan2(s.my, s.mx));
        }
        if (seen.length < poses.length) continue; // outflow tract or annulus at that point
        followed++;
        for (const v of seen) expect(v, `${d}° lf ${lf}`).toBe(expected);
        for (const mz of material) expect(mz).toBeCloseTo(material[0]!, 6);
        // and the material azimuth: the sample's tissue coordinates turn with no torsion
        for (const a of materialAz) expect(a).toBeCloseTo(materialAz[0]!, 6);
      }
    }
    expect(followed).toBeGreaterThan(90);
  });

  it('labels only LV compact myocardium: cavity, papillary muscles and other tissue carry no segment', () => {
    const pose = poses[0]!;
    const counts = new Map<string, number>();
    for (let x = -6; x <= 6; x += 0.1)
      for (let y = -6; y <= 6; y += 0.25)
        for (let z = -1; z <= L + 1.5; z += 0.25) {
          if (!classifyHeart(model, pose, x, y, z, s)) {
            expect(s.segment).toBe(0);
            continue;
          }
          const lvWall =
            s.tissue === Tissue.Myocardium &&
            [
              Structure.LvWallSeptal,
              Structure.LvWallLateral,
              Structure.LvWallAnterior,
              Structure.LvWallInferior,
              Structure.LvApex,
            ].includes(s.structure);
          const key = s.segment > 0 ? 'labelled' : 'none';
          counts.set(key, (counts.get(key) ?? 0) + 1);
          if (s.segment > 0) expect(lvWall, `structure ${s.structure}`).toBe(true);
          if (s.structure === Structure.PapillaryMuscle || s.tissue === Tissue.Blood)
            expect(s.segment).toBe(0);
        }
    expect(counts.get('labelled') ?? 0).toBeGreaterThan(1000);
  });

  it('distinguishes the cap (beyond the cavity) from the apex structure of the image map', () => {
    const pose = poses[0]!;
    const codes = new Set<number>();
    for (let x = -3; x <= 3; x += 0.05)
      for (let z = L - 0.6; z <= L + 1.5; z += 0.05) {
        if (!classifyHeart(model, pose, x, 0.2, z, s)) continue;
        if (s.structure === Structure.LvApex && s.tissue === Tissue.Myocardium)
          codes.add(s.segment);
      }
    // Structure.LvApex (the last 6 mm) holds apical segments and the cap: it is not AHA 17
    expect([...codes].some((c) => c >= 13 && c <= 16)).toBe(true);
    expect([...codes].some((c) => c >= 17)).toBe(true);
    // on the long axis beyond the endocardial apex the myocardium is the cap
    let cap = 0;
    for (let z = L + 0.02; z < L + 2; z += 0.02) {
      if (!classifyHeart(model, pose, 0, 0, z, s)) break;
      if (s.tissue !== Tissue.Myocardium) break;
      expect(aha17FromCode(s.segment)).toBe(17);
      cap++;
    }
    expect(cap).toBeGreaterThan(5);
  });
});

describe('LV wall labels of the structure map', () => {
  const WALL: Record<number, Structure> = {
    0: Structure.LvWallLateral,
    1: Structure.LvWallSeptal,
    2: Structure.LvWallAnterior,
    3: Structure.LvWallInferior,
  };

  it('groups the AHA walls in four labels bounded by the RV insertions', () => {
    const at = (d: number, lf: number) => lvWallKind(code(d, lf));
    // basal and mid: anterior 60–120°, septum 120–240°, inferior and inferolateral 240–360°, anterolateral 0–60°
    for (const lf of [0.1, 0.5]) {
      expect([90, 150, 210, 270, 330, 30].map((d) => at(d, lf))).toEqual([2, 1, 1, 3, 3, 0]);
      expect(at(120 - EPS, lf)).toBe(2);
      expect(at(120 + EPS, lf)).toBe(1);
      expect(at(240 - EPS, lf)).toBe(1);
      expect(at(240 + EPS, lf)).toBe(3);
    }
    // apical quadrants, and the cap by its quadrant
    expect([90, 180, 270, 0].map((d) => at(d, 0.8))).toEqual([2, 1, 3, 0]);
    expect([90, 180, 270, 0].map((d) => at(d, 1))).toEqual([2, 1, 3, 0]);
  });

  it('labels every LV wall sample with the wall of its segment, and no septum in the A2C', () => {
    const c = loadCaseById('normal-excellent-window');
    const { thorax, heart, tables } = buildCaseModels(c, {
      position: 'left-lateral',
      respiration: 'expiration',
      headElevationDeg: 0,
    });
    const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
    const s = makeSample();
    const L = heart.lv.lengthCm;
    let n = 0;
    for (let x = -5; x <= 5; x += 0.2)
      for (let y = -5; y <= 5; y += 0.2)
        for (let z = 0.5; z < L - 0.7; z += 0.5) {
          if (!classifyHeart(heart, pose, x, y, z, s) || s.segment === 0) continue;
          n++;
          expect(s.structure, `${x},${y},${z} segment ${s.segment}`).toBe(
            WALL[lvWallKind(s.segment)],
          );
        }
    expect(n).toBeGreaterThan(1000);
    // the two-chamber plane cuts the anterior and inferior walls, not the septum: until decision 154, 2.6–2.8 % of it
    // read «septum», the label being centred 28° off the septum. What «septum» remains there is the fibrous tissue
    // under the aortic root (aorticRoot.ts labels it so), not LV myocardium
    const wallShare = (viewId: string) => {
      const beam = beamFrameFromPose(
        poseFromControl(thorax, canonicalControl(getViewTarget(viewId), heart, thorax)),
        1,
      );
      const count = new Map<number, number>();
      let total = 0;
      for (let dep = 0.05; dep < 16; dep += 0.1)
        for (let lat = -8 + 0.05; lat < 8; lat += 0.1) {
          total++;
          const p = torsoToHeart(
            heart.frame,
            add(beam.origin, add(scale(beam.forward, dep), scale(beam.lateral, lat))),
          );
          if (!classifyHeart(heart, pose, p.x, p.y, p.z, s) || s.tissue !== Tissue.Myocardium)
            continue;
          count.set(s.structure, (count.get(s.structure) ?? 0) + 1);
        }
      return (st: Structure) => (count.get(st) ?? 0) / total;
    };
    const a2c = wallShare('a2c');
    expect(a2c(Structure.LvWallSeptal)).toBe(0);
    expect(a2c(Structure.LvWallAnterior)).toBeGreaterThan(0.005);
    expect(a2c(Structure.LvWallInferior)).toBeGreaterThan(0.005);
    // and the four-chamber plane cuts the septum
    expect(wallShare('a4c')(Structure.LvWallSeptal)).toBeGreaterThan(0.005);
  }, 120_000);
});
