// @tier slow
/**
 * A heart read from a label volume (decision 346), on a synthetic one: an ellipsoidal ventricle (wall 8 mm, 90 mm from
 * the mitral centre to the apex, as the CT mean heart) with a 3 mm groove cut into its lateral surface, a left atrium
 * 2 mm above its base and a right atrium whose wall is thicker than the atrial walls keep (decision 358). The clinical
 * volume stays outside the repository; this checks what the sampler does with any volume: the alignment by the anatomical
 * frame, the LV wall's sectors, the groove fat, the pericardium and the distance beyond the sac, the interface distance
 * and normal, and the analytic valve apparatus drawn only in the cavities.
 */
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { atlasMarks } from './atlasFrame';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { classifyHeart, computeHeartPose } from './heartModel';
import { sceneClassifier } from './sceneClassifier';
import { makeSample, Structure, Tissue } from './tissue';
import {
  analyticAtrialVolumes,
  apicalStretchInverse,
  TWIST_APEX_DEG,
  TWIST_BASE_DEG,
  volumeHeart,
  type LabelVolume,
  type LabelVolumeHeader,
} from './volumeHeart';

const { heart, thorax, tables } = buildCaseModels(
  loadCaseById('normal-excellent-window'),
  REST_PATIENT,
);
const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
const F = atlasMarks(heart, ed);

const DIMS: [number, number, number] = [128, 112, 144];
const header: LabelVolumeHeader = {
  voxelMm: 1,
  origin: [0, 0, 0],
  dims: DIMS,
  // the mesh turned against the anatomical axes: septal → lateral is +y, toward the aortic valve −x, to the apex +z
  landmarks: {
    mitral: [64, 56, 28],
    tricuspid: [64, 22, 28],
    aortic: [40, 56, 36],
    pulmonary: [50, 90, 40],
    apex: [64, 56, 118],
  },
};
const C = [64, 56, 72];
/** The anatomical axes in mesh coordinates. */
const AX: [number, number, number][] = [
  [0, 1, 0],
  [-1, 0, 0],
  [0, 0, 1],
];
const inside = (x: number, y: number, z: number, rx: number, rz: number): boolean =>
  ((x - C[0]!) / rx) ** 2 + ((y - C[1]!) / rx) ** 2 + ((z - C[2]!) / rz) ** 2 <= 1;

function synthetic(fill?: number): LabelVolume {
  const [nx, ny, nz] = DIMS;
  const labels = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const v = i + nx * (j + ny * k);
        if (fill !== undefined) {
          labels[v] = i && j && k && i < nx - 1 && j < ny - 1 && k < nz - 1 ? fill : 0;
          continue;
        }
        const [x, y, z] = [i + 0.5, j + 0.5, k + 0.5];
        if (inside(x, y, z, 22, 38)) labels[v] = 31;
        else if (inside(x, y, z, 30, 46)) labels[v] = 1;
        // a box of RV on the septal side (−y in the mesh), walled, and a round left atrium above the annulus
        if (j >= 8 && j <= 23 && i >= 52 && i <= 76 && k >= 38 && k <= 102)
          labels[v] = j >= 10 && j <= 21 && i >= 54 && i <= 74 && k >= 40 && k <= 100 ? 32 : 2;
        const dla = Math.hypot(x - 64, y - 56, z - 12);
        if (dla <= 11) labels[v] = dla <= 9 ? 33 : 3;
        // a wide right atrium beside it, on the septal side: by distance over reach it would claim the left's septal side
        const dra = Math.hypot((x - 64) / 24, (y - 36) / 8, (z - 10) / 9);
        if (dra <= 1) labels[v] = dra <= 0.85 ? 34 : 4;
        // the groove: 3 mm wide, 3 mm deep, in the lateral wall at mid-ventricle
        if (j >= 83 && j <= 85 && i >= 63 && i <= 65 && k >= 64 && k <= 80) labels[v] = 0;
      }
  return { header, labels };
}

const vol = volumeHeart(synthetic(), heart, ed);
const k = vol.cmPerMm;
/** A mesh point (mm) in the heart frame (cm). */
function heartPoint(m: [number, number, number]): [number, number, number] {
  const d = [0, 1, 2].map((i) => m[i]! - header.landmarks.mitral[i]!);
  const a = AX.map((e) => d[0]! * e[0] + d[1]! * e[1] + d[2]! * e[2]);
  const o = F.frame;
  return [0, 1, 2].map(
    (i) => o.origin[i]! + k * (a[0]! * o.ex[i]! + a[1]! * o.ey[i]! + a[2]! * o.ez[i]!),
  ) as [number, number, number];
}
function sampleAt(m: [number, number, number], cls = vol.classifier()) {
  const q = makeSample();
  const hit = cls(...heartPoint(m), q);
  return { hit, q };
}

describe('volume heart (decision 346)', () => {
  it('scales the volume to the model by the LV length', () => {
    expect(k).toBeCloseTo(F.lvLength / 90, 6);
  });

  it('places the cavity and names the LV wall by its sector in the anatomical frame', () => {
    expect(sampleAt([64.5, 56.5, 72.5]).q.structure).toBe(Structure.LvCavity);
    expect(sampleAt([64.5, 56.5, 72.5]).q.tissue).toBe(Tissue.Blood);
    const wall: [string, [number, number, number], Structure][] = [
      ['lateral', [64.5, 81.5, 60.5], Structure.LvWallLateral],
      ['septal', [64.5, 30.5, 60.5], Structure.LvWallSeptal],
      ['anterior', [38.5, 56.5, 60.5], Structure.LvWallAnterior],
      ['inferior', [89.5, 56.5, 60.5], Structure.LvWallInferior],
      ['apex', [64.5, 56.5, 113.5], Structure.LvApex],
    ];
    for (const [, m, s] of wall) {
      const { hit, q } = sampleAt(m);
      expect(hit).toBe(true);
      expect(q.tissue).toBe(Tissue.Myocardium);
      expect(q.structure).toBe(s);
    }
  });

  it('fills the atrioventricular groove with epicardial fat and wraps the heart in the pericardium', () => {
    // the 2 mm gap between the left atrium and the ventricle's base: a groove between an atrium and a ventricle
    expect(sampleAt([64.5, 56.5, 24.5]).q.structure).toBe(Structure.EpicardialFat);
    // and the 2 mm gap between the right ventricle's wall and the left's: an interventricular groove
    expect(sampleAt([64.5, 24.5, 72.5]).q.structure).toBe(Structure.EpicardialFat);
    // the groove cut in the lateral wall alone, far from the atria and the right ventricle, holds no fat (decision 358)
    expect(sampleAt([64.5, 84.5, 72.5]).q.structure).not.toBe(Structure.EpicardialFat);
    // the first voxel beyond the lateral epicardium lies 1 mm out, 0.10 cm in the model: inside the 0.12 cm sac
    const sac = sampleAt([64.5, 85.5, 60.5]);
    expect(sac.hit).toBe(true);
    expect(sac.q.structure).toBe(Structure.Pericardium);
  });

  it('thins the atrial walls to two voxels from their cavity, and keeps them closed (decision 358)', () => {
    // the right atrium's wall runs 0.85–1 of its 24 mm semi-axis along x, voxels 84–87 beyond the cavity's last (83):
    // the two nearest it stay, the outer ones are peeled
    expect(sampleAt([85.5, 36.5, 10.5]).q.structure).toBe(Structure.RaWall);
    expect(sampleAt([86.5, 36.5, 10.5]).q.structure).not.toBe(Structure.RaWall);
    expect(sampleAt([87.5, 36.5, 10.5]).q.structure).not.toBe(Structure.RaWall);
    // the left atrium's wall, 2 voxels, stays whole
    expect(sampleAt([64.5, 66.5, 12.5]).q.structure).toBe(Structure.LaWall);
    // no atrial blood touches the outside
    const g = vol.gpu();
    const [nx, ny] = g.dims;
    let open = 0;
    for (let v = 0; v < g.labels.length; v++)
      if (g.labels[v] === 33 || g.labels[v] === 34)
        for (const s of [1, -1, nx, -nx, nx * ny, -nx * ny]) if (g.labels[v + s] === 0) open++;
    expect(open).toBe(0);
  });

  it('leaves on a miss the distance beyond the sac, growing outward and past the grid', () => {
    const near = sampleAt([64.5, 87.5, 60.5]);
    const far = sampleAt([64.5, 102.5, 60.5]);
    const out = sampleAt([64.5, 130, 60.5]);
    expect(near.hit || far.hit || out.hit).toBe(false);
    expect(near.q.sdf).toBeGreaterThan(0.1);
    expect(near.q.sdf).toBeLessThan(0.25);
    expect(far.q.sdf).toBeGreaterThan(near.q.sdf + 1);
    expect(out.q.sdf).toBeGreaterThan(far.q.sdf + 2);
  });

  it('gives the distance to the nearest interface and its normal in the heart frame', () => {
    // the lateral wall runs over voxels 77–84: 3.5 mm from the centre of voxel 81 to the epicardium
    expect(sampleAt([64.5, 81.5, 60.5]).q.sdf).toBeCloseTo(-3.5 * k, 2);
    // on the septal endocardium (clear of the baked papillary muscles), the normal of the inner ellipsoid there carried
    // into the heart frame, within 5°
    const m: [number, number, number] = [64.5, 34.5, 60.5];
    const { q } = sampleAt(m);
    expect(q.sdf).toBeCloseTo(-0.5 * k, 3);
    const g = [(m[0] - C[0]!) / 22 ** 2, (m[1] - C[1]!) / 22 ** 2, (m[2] - C[2]!) / 38 ** 2];
    const p0 = heartPoint(m);
    const p1 = heartPoint([m[0] + g[0]!, m[1] + g[1]!, m[2] + g[2]!]);
    const e = [0, 1, 2].map((i) => p1[i]! - p0[i]!);
    const cos = Math.abs(q.nx * e[0]! + q.ny * e[1]! + q.nz * e[2]!) / Math.hypot(...e);
    expect(cos).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
  });

  it('bakes the papillary muscles into the cavities and draws the analytic leaflets of the pose asked for', () => {
    // a point inside the analytic LV papillary muscle at end diastole (its six neighbours 1 mm away inside too), and one
    // of the closed mitral leaflets
    const s = makeSample();
    const isPap = (x: number, y: number, z: number) =>
      classifyHeart(heart, ed, x + ed.swingX, y, z, s) && s.structure === Structure.PapillaryMuscle;
    let p: [number, number, number] | null = null;
    for (let z = 3; z <= 7 && !p; z += 0.1)
      for (let x = -3; x <= 3 && !p; x += 0.1)
        for (let y = -3; y <= 3 && !p; y += 0.1)
          if (
            isPap(x, y, z) &&
            [-0.1, 0.1].every((d) => isPap(x + d, y, z) && isPap(x, y + d, z) && isPap(x, y, z + d))
          )
            p = [x, y, z];
    expect(p).not.toBeNull();
    let leaf: [number, number, number] | null = null;
    for (let z = -0.5; z <= 1.5 && !leaf; z += 0.05)
      for (let y = -2; y <= 1 && !leaf; y += 0.05)
        if (
          classifyHeart(heart, ed, 0.2 + ed.swingX, y, z, s) &&
          (s.structure === Structure.MitralAnterior || s.structure === Structure.MitralPosterior)
        )
          leaf = [0.2, y, z];
    expect(leaf).not.toBeNull();
    const vol31 = volumeHeart(synthetic(31), heart, ed);
    const at = (pt: [number, number, number], v = vol31, pose?: typeof ed) => {
      const q = makeSample();
      v.classifier({ apparatus: pose })(...pt, q);
      return q.structure;
    };
    // the papillary muscle is the volume's own, with or without a pose
    expect(at(p!, vol31, ed)).toBe(Structure.PapillaryMuscle);
    expect(at(p!)).toBe(Structure.PapillaryMuscle);
    // the leaflet only with the pose, and only in cavity blood: in the wall of the volume its wall stands
    expect([Structure.MitralAnterior, Structure.MitralPosterior]).toContain(at(leaf!, vol31, ed));
    expect(at(leaf!)).toBe(Structure.LvCavity);
    const vol1 = volumeHeart(synthetic(1), heart, ed);
    expect(at(p!, vol1, ed)).not.toBe(Structure.PapillaryMuscle);
    expect(at(leaf!, vol1, ed)).not.toBe(Structure.MitralAnterior);
  });

  it('is what the scene classifier asks for the heart when the scene carries it', () => {
    const fake = (_x: number, _y: number, _z: number, q: ReturnType<typeof makeSample>) => {
      q.tissue = Tissue.Valve;
      q.structure = Structure.PulmonaryValve;
      return true;
    };
    const o = heart.frame.origin;
    const q = makeSample();
    const scene = { heart, heartPose: ed, thorax };
    expect(sceneClassifier({ ...scene, heartClassifier: fake })(o.x, o.y, o.z, q)).toBe(2);
    expect(q.structure).toBe(Structure.PulmonaryValve);
    sceneClassifier(scene)(o.x, o.y, o.z, q);
    expect(q.structure).not.toBe(Structure.PulmonaryValve);
  });
});

describe('volume heart in motion (decision 350)', () => {
  const es = computeHeartPose(heart, cycleStateAt(tables, tables.endSystoleS / tables.rrS));
  const o = F.frame;
  /** The heart-frame point of an anatomical one (cm). */
  const fromAnat = (x: number, y: number, z: number): [number, number, number] =>
    [0, 1, 2].map((c) => o.origin[c]! + x * o.ex[c]! + y * o.ey[c]! + z * o.ez[c]!) as [
      number,
      number,
      number,
    ];
  const LV_WALL = new Set([
    Structure.LvWallSeptal,
    Structure.LvWallLateral,
    Structure.LvWallAnterior,
    Structure.LvWallInferior,
    Structure.LvApex,
  ]);
  /** LV cavity and wall volumes (mL) of the synthetic heart at a pose, on a 1 mm grid in the anatomical frame. */
  function volumes(pose: typeof ed) {
    const cls = vol.classifier({ motion: { pose, endDiastole: ed } });
    const q = makeSample();
    let cav = 0,
      wall = 0,
      rv = 0,
      la = 0,
      ra = 0;
    const hh = 0.1;
    for (let x = -6.5; x <= 4; x += hh)
      for (let y = -4; y <= 4; y += hh)
        for (let z = -3.5; z <= 10.5; z += hh) {
          if (!cls(...fromAnat(x, y, z), q)) continue;
          if (q.structure === Structure.LvCavity) cav += hh ** 3;
          else if (LV_WALL.has(q.structure)) wall += hh ** 3;
          else if (q.structure === Structure.RvCavity) rv += hh ** 3;
          else if (q.structure === Structure.LaCavity) la += hh ** 3;
          else if (q.structure === Structure.RaCavity) ra += hh ** 3;
        }
    return { cav, wall, rv, la, ra };
  }
  const v0 = volumes(ed),
    v1 = volumes(es);
  const ref = { x: 0, y: 0, z: 0, twist: 0 };

  it('is the identity at end diastole', () => {
    const back = vol.toReference(ed, ed);
    for (const p of [
      [1.2, -0.4, 3],
      [-2.5, 1, 6.5],
      [0.3, 0.2, -1.5],
    ] as const) {
      back(p[0], p[1], p[2], ref);
      [ref.x, ref.y, ref.z, ref.twist].forEach((v, i) => expect(v).toBeCloseTo([...p, 0][i]!, 5));
    }
  });

  it('keeps the myocardium incompressible and empties the cavity with the case’s volume curve', () => {
    expect(v1.wall / v0.wall).toBeCloseTo(1, 1);
    // 1.009 (1.024 when the radial step took each point's own stretch, decision 363)
    expect(Math.abs(v1.wall / v0.wall - 1)).toBeLessThan(0.015);
    const target = es.state.lvVolumeMl / es.state.edvMl;
    expect(Math.abs(v1.cav / v0.cav - target)).toBeLessThan(0.05);
  });

  it('brings the base down by the annulus’s descent, with the apex still', () => {
    const back = vol.toReference(es, ed);
    const sL = es.zAnn - ed.zAnn;
    expect(sL).toBeGreaterThan(1);
    // the lateral wall at the annulus now lies sL toward the apex; the apex has not moved along the axis
    back(2.5, 0, sL, ref);
    expect(ref.z).toBeCloseTo(0, 6);
    back(0, 0, F.lvLength, ref);
    expect(ref.z).toBeCloseTo(F.lvLength, 6);
  });

  it('thickens the apical cap as the wall before it, and brings the cavity’s tip toward the base (decision 362)', () => {
    const m = vol.motionParams(es, ed);
    // the cap's mean stretch: the ramp from the cavity's stretch at its tip to the apex's
    const capStretch = (m.lambda + m.capLambda) / 2;
    expect(capStretch).toBeGreaterThan(1.2);
    // along the long axis, through the apex: where the cavity ends and where the wall ends
    const along = (pose: typeof ed) => {
      const cls = vol.classifier({ motion: { pose, endDiastole: ed } });
      const q = makeSample();
      let tip = 0,
        epi = 0;
      for (let z = 5; z < F.lvLength + 0.5; z += 0.005) {
        if (!cls(...fromAnat(0, 0, z), q)) continue;
        if (q.structure === Structure.LvCavity) tip = z;
        else if (LV_WALL.has(q.structure)) epi = z;
      }
      return { tip, epi };
    };
    const a = along(ed),
      b = along(es);
    expect(a.tip - b.tip).toBeGreaterThan(0.1);
    // the cap along the axis thickens by the ramp's stretch at its middle (the axis reaches past the mean tip)
    const [z0, z1] = vol.gpu().apicalRamp;
    const mid = (a.tip + a.epi) / 2;
    const expected = m.lambda + ((m.capLambda - m.lambda) * (mid - z0)) / (z1 - z0);
    expect(Math.abs((b.epi - b.tip) / (a.epi - a.tip) - expected)).toBeLessThan(0.05);
    expect(Math.abs(b.epi - a.epi)).toBeLessThan(0.05);
    // the cap's myocardium (the tissue whose end-diastolic height lies beyond the cavity's tip) keeps its volume
    const o = F.frame;
    const refZ = (q: { mx: number; my: number; mz: number }): number =>
      (q.mx - o.origin[0]) * o.ez[0] +
      (q.my - o.origin[1]) * o.ez[1] +
      (q.mz - o.origin[2]) * o.ez[2];
    const capVolume = (pose: typeof ed): number => {
      const cls = vol.classifier({ motion: { pose, endDiastole: ed } });
      const q = makeSample();
      let n = 0;
      const hh = 0.05;
      for (let x = -3; x <= 3; x += hh)
        for (let y = -3; y <= 3; y += hh)
          for (let z = z0 - 0.6; z <= F.lvLength + 0.3; z += hh)
            if (cls(...fromAnat(x, y, z), q) && LV_WALL.has(q.structure) && refZ(q) >= z0) n++;
      return n * hh ** 3;
    };
    expect(Math.abs(capVolume(es) / capVolume(ed) - 1)).toBeLessThan(0.05);
    // the LV's end stays put wherever the base descends, the septum and the RV side toward the tricuspid's descent too
    const backEs = vol.toReference(es, ed);
    for (const x of [1, 0, -2.5, -3.5]) {
      backEs(x, 0.2, F.lvLength - 1e-4, ref);
      expect(ref.z, `x ${x}`).toBeCloseTo(F.lvLength, 3);
    }
    // the identity at end diastole holds through the ramp too, where the map is the root of a quadratic
    const back = vol.toReference(ed, ed);
    for (let z = 6; z < F.lvLength; z += 0.25) {
      back(0.4, 0.3, z, ref);
      expect(ref.z).toBeCloseTo(z, 6);
    }
  });

  it('inverts the stretch of the cavity, the ramp and the cap, exactly when the two stretches meet (decision 362)', () => {
    const forward = (t: number, lc: number, la: number, z1: number, z2: number): number =>
      t <= z1
        ? lc * t
        : t >= z2
          ? lc * z1 + ((lc + la) * (z2 - z1)) / 2 + la * (t - z2)
          : lc * z1 + lc * (t - z1) + ((la - lc) * (t - z1) ** 2) / (2 * (z2 - z1));
    for (const [lc, la] of [
      [0.79, 1.41],
      [1, 1],
      [0.93, 0.93],
    ] as const)
      for (let t = 0; t <= 9; t += 0.1)
        expect(apicalStretchInverse(forward(t, lc, la, 7.5, 8.5), lc, la, 7.5, 8.5)).toBeCloseTo(
          t,
          9,
        );
  });

  it('ramps the stretch through the cap, without a step in the epicardium (decision 362)', () => {
    // the epicardium's radius at end systole over its radius at end diastole, height by height: the 1 mm voxels make it
    // jump by up to 0.07 between heights 1 mm apart; a step from the cavity's stretch to the cap's would drop it by a quarter
    /** The epicardium's distance from the axis toward the lateral wall at height z (cm). */
    const epiRadius = (cls: ReturnType<typeof vol.classifier>, z: number): number => {
      const q = makeSample();
      let r0 = 0;
      for (let r = 0; r < 4; r += 0.005)
        if (cls(...fromAnat(r, 0, z), q) && LV_WALL.has(q.structure)) r0 = r;
      return r0;
    };
    const c0 = vol.classifier({ motion: { pose: ed, endDiastole: ed } }),
      c1 = vol.classifier({ motion: { pose: es, endDiastole: ed } });
    let prev = NaN;
    for (let z = 6; z <= F.lvLength - 0.6; z += 0.1) {
      const ratio = epiRadius(c1, z) / epiRadius(c0, z);
      if (Number.isFinite(prev))
        expect(Math.abs(ratio - prev), `z ${z.toFixed(1)}`).toBeLessThan(0.12);
      prev = ratio;
    }
  });

  it('twists the base clockwise and the apex counterclockwise seen from the apex (Kocabay 2014)', () => {
    const back = vol.toReference(es, ed);
    const deg = (r: number) => (r * 180) / Math.PI;
    const c = es.state.contraction;
    // mid-wall of the lateral wall near the base and near the apex: the backward map turns them back, as much as the
    // linear profile from the base's −6.9° to the apex's +13.0° says at their height
    const expected = (z: number) =>
      TWIST_BASE_DEG + (TWIST_APEX_DEG - TWIST_BASE_DEG) * (z / F.lvLength);
    // near the base: now 2.2 cm from the mitral centre, mid-wall at end diastole 1 cm from it
    back(1.3, 0, 2.2, ref);
    expect(ref.z).toBeCloseTo(1, 0);
    const base = expected(ref.z);
    expect(-deg(ref.twist) / c).toBeCloseTo(base, 1);
    back(1.2, 0, 0.9 * F.lvLength, ref);
    const apex = expected(ref.z);
    expect(-deg(ref.twist) / c).toBeCloseTo(apex, 1);
    expect(base).toBeLessThan(-3);
    expect(apex).toBeGreaterThan(9);
  });

  it('thickens the wall and carries the speckle with the tissue', () => {
    // lateral wall thickness at mid-ventricle, along +x from the slice centre
    const zm = F.lvLength / 2;
    const thick = (pose: typeof ed) => {
      const cls = vol.classifier({ motion: { pose, endDiastole: ed } });
      const q = makeSample();
      let n = 0;
      for (let r = 0; r < 5; r += 0.01)
        if (cls(...fromAnat(r, 0, zm), q) && LV_WALL.has(q.structure)) n++;
      return n * 0.01;
    };
    expect(thick(es) / thick(ed)).toBeGreaterThan(1.3);
    // a wall sample's material coordinates are where that tissue lay at end diastole, not where it is now
    const q = makeSample();
    const p = fromAnat(2.2, 0, zm);
    vol.classifier({ motion: { pose: es, endDiastole: ed } })(...p, q);
    vol.toReference(es, ed)(2.2, 0, zm, ref);
    const at = fromAnat(ref.x, ref.y, ref.z);
    [q.mx, q.my, q.mz].forEach((v, i) => expect(v).toBeCloseTo(at[i]!, 9));
    expect(Math.hypot(q.mx - p[0], q.my - p[1], q.mz - p[2])).toBeGreaterThan(0.3);
  });

  it('moves the RV free wall in, beyond what the descent of the tricuspid annulus does', () => {
    // the descent alone shortens the RV by 1 − TAPSE/L; with the free wall's inward motion it empties more
    const descentOnly = 1 - (es.tvZ - ed.tvZ) / F.lvLength;
    expect(v1.rv / v0.rv).toBeLessThan(descentOnly - 0.15);
  });

  it('fills each atrium in systole as the analytic atrium does', () => {
    const a1 = analyticAtrialVolumes(heart, es),
      a0 = analyticAtrialVolumes(heart, ed);
    expect(a1.la / a0.la).toBeGreaterThan(1.2);
    expect(Math.abs(v1.la / v0.la - a1.la / a0.la)).toBeLessThan(0.06);
    // the radial scale is solved on the cavity's voxels with the weights in place: on this wide atrium it overshoots by
    // 0.10 (1.61 for 1.50)
    expect(Math.abs(v1.ra / v0.ra - a1.ra / a0.ra)).toBeLessThan(0.12);
  });

  it('scales the left atrium’s septal side about the left atrium, not about the wider right atrium beside it', () => {
    // a voxel of the left atrial cavity 8.5 mm from its axis toward the septum; by distance over reach it is nearer the
    // right atrium. No ventricular step reaches this height, so the backward map moves it radially about the left
    // atrium's axis (the anatomical origin), onto left atrial tissue
    const back = vol.toReference(es, ed);
    const p = [(47.5 - 56) * k, -(64.5 - 64) * k, (12.5 - 28) * k];
    back(p[0]!, p[1]!, p[2]!, ref);
    const moved = Math.hypot(ref.x - p[0]!, ref.y - p[1]!);
    // the synthetic atrium grows little in systole (its radial scale is about 1.01): enough to tell the axis it turns about
    expect(moved).toBeGreaterThan(0.002);
    const cross = p[0]! * ref.y - p[1]! * ref.x;
    expect(Math.abs(cross) / (Math.hypot(p[0]!, p[1]!) * moved)).toBeLessThan(0.02);
    expect([33, 3]).toContain(vol.labelAt(...fromAnat(ref.x, ref.y, ref.z)));
  });

  it('turns the wall’s normal with the twist', () => {
    // a mid-wall point near the apex: its normal at end systole is the end-diastolic one turned by the twist
    const back = vol.toReference(es, ed);
    const p: [number, number, number] = [1.0, 0.4, 0.88 * F.lvLength];
    back(...p, ref);
    const q1 = makeSample(),
      q0 = makeSample();
    vol.classifier({ motion: { pose: es, endDiastole: ed } })(...fromAnat(...p), q1);
    vol.classifier()(...fromAnat(ref.x, ref.y, ref.z), q0);
    const anat = (q: typeof q0) => [
      q.nx * o.ex[0] + q.ny * o.ex[1] + q.nz * o.ex[2],
      q.nx * o.ey[0] + q.ny * o.ey[1] + q.nz * o.ey[2],
    ];
    const [a0, b0] = anat(q0),
      [a1, b1] = anat(q1);
    const turn = Math.atan2(a0! * b1! - b0! * a1!, a0! * a1! + b0! * b1!);
    expect(Math.abs(ref.twist)).toBeGreaterThan((5 * Math.PI) / 180);
    expect(turn).toBeCloseTo(-ref.twist, 2);
  });

  it('draws the fibrous annulus where the mitral plane meets the wall, and cavity across the rest of it', () => {
    // LV cavity everywhere, a wall on the low-x side and a mitral plane across the middle
    const [nx, ny, nz] = DIMS;
    const labels = new Uint8Array(nx * ny * nz);
    for (let kk = 1; kk < nz - 1; kk++)
      for (let j = 1; j < ny - 1; j++)
        for (let i = 1; i < nx - 1; i++)
          labels[i + nx * (j + ny * kk)] = i <= 20 ? 1 : kk === 60 ? 7 : 31;
    const plane = volumeHeart({ header, labels }, heart, ed);
    const q = makeSample();
    const at = (i: number) => {
      plane.classifier()(...heartPoint([i + 0.5, 56.5, 60.5]), q);
      return [q.tissue, q.structure];
    };
    expect(at(21)).toEqual([Tissue.Fibrous, Structure.MitralAnnulus]);
    expect(at(60)).toEqual([Tissue.Blood, Structure.LvCavity]);
  });
});
