// @tier slow
/**
 * A heart read from a label volume (decision 346), on a synthetic one: an ellipsoidal ventricle (wall 8 mm, 90 mm from
 * the mitral centre to the apex, as the CT mean heart) with a 3 mm groove cut into its lateral surface. The clinical
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
import { volumeHeart, type LabelVolume, type LabelVolumeHeader } from './volumeHeart';

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

  it('fills the groove with epicardial fat and wraps the heart in the pericardium', () => {
    expect(sampleAt([64.5, 84.5, 72.5]).q.structure).toBe(Structure.EpicardialFat);
    // the first voxel beyond the lateral epicardium lies 1 mm out, 0.10 cm in the model: inside the 0.12 cm sac
    const sac = sampleAt([64.5, 85.5, 60.5]);
    expect(sac.hit).toBe(true);
    expect(sac.q.structure).toBe(Structure.Pericardium);
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
    // on the lateral endocardium, the normal of the inner ellipsoid there carried into the heart frame, within 5°
    const m: [number, number, number] = [64.5, 77.5, 60.5];
    const { q } = sampleAt(m);
    expect(q.sdf).toBeCloseTo(-0.5 * k, 3);
    const g = [(m[0] - C[0]!) / 22 ** 2, (m[1] - C[1]!) / 22 ** 2, (m[2] - C[2]!) / 38 ** 2];
    const p0 = heartPoint(m);
    const p1 = heartPoint([m[0] + g[0]!, m[1] + g[1]!, m[2] + g[2]!]);
    const e = [0, 1, 2].map((i) => p1[i]! - p0[i]!);
    const cos = Math.abs(q.nx * e[0]! + q.ny * e[1]! + q.nz * e[2]!) / Math.hypot(...e);
    expect(cos).toBeGreaterThan(Math.cos((5 * Math.PI) / 180));
  });

  it('draws the analytic valve apparatus only in cavity blood', () => {
    // a point of the analytic LV papillary muscle at end diastole
    const s = makeSample();
    let p: [number, number, number] | null = null;
    for (let z = 3; z <= 7 && !p; z += 0.1)
      for (let x = -3; x <= 3 && !p; x += 0.1)
        for (let y = -3; y <= 3 && !p; y += 0.1)
          if (
            classifyHeart(heart, ed, x + ed.swingX, y, z, s) &&
            s.structure === Structure.PapillaryMuscle
          )
            p = [x, y, z];
    expect(p).not.toBeNull();
    const at = (labels: number, pose?: typeof ed) => {
      const q = makeSample();
      volumeHeart(synthetic(labels), heart, ed).classifier(pose)(...p!, q);
      return q.structure;
    };
    expect(at(31, ed)).toBe(Structure.PapillaryMuscle);
    expect(at(31)).toBe(Structure.LvCavity);
    // in the wall of the volume the volume's wall stands
    expect(at(1, ed)).not.toBe(Structure.PapillaryMuscle);
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
