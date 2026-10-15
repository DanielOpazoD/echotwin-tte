/**
 * The model measured as the four-chamber CT atlas is (decision 322, `tools/clinical/heart-atlas.ts`): a frame built from
 * the anatomy alone, origin the mitral valve centre, z toward the LV apex (the LV myocardium point farthest from the
 * mitral centre), x from the tricuspid centre toward the mitral one square to z (septal to lateral), y = z × x turned
 * toward the aortic valve. In it, the myocardium centroid of the right ventricle and the atria and the centres of the
 * aortic, pulmonary and tricuspid valves over the LV length, and the direction of the pulmonary veins, the left atrial
 * appendage and the venae cavae, from the atrium outward. Valve centres are the centroids of the annular rings and of the
 * closed cusps the classifier draws; chamber centroids those of its wall labels, sampled on a grid.
 */
import type { HeartModel, HeartPose } from './heartModel';
import { classifyHeart, heartAnchors } from './heartModel';
import { makeSample, Structure } from './tissue';
import { pulmonaryVeinSegment } from './pulmonaryVeins';
import { atrialScale } from './classify/atria';

export type AtlasV3 = [number, number, number];

export interface AtlasMarks {
  /** Mitral centre to the LV apex (cm). */
  lvLength: number;
  /** Centroids in the anatomical frame over the LV length. */
  positions: Record<string, AtlasV3>;
  /** Unit vessel directions in the anatomical frame. */
  vessels: Record<string, AtlasV3>;
}

const GROUP: Partial<Record<Structure, string>> = {
  [Structure.LvWallSeptal]: 'lv',
  [Structure.LvWallLateral]: 'lv',
  [Structure.LvWallAnterior]: 'lv',
  [Structure.LvWallInferior]: 'lv',
  [Structure.LvApex]: 'lv',
  [Structure.RvWall]: 'rightVentricle',
  [Structure.LaWall]: 'leftAtrium',
  [Structure.RaWall]: 'rightAtrium',
  [Structure.MitralAnnulus]: 'mitral',
  [Structure.TricuspidAnnulus]: 'tricuspidValve',
  [Structure.AorticValve]: 'aorticValve',
  [Structure.PulmonaryValve]: 'pulmonaryValve',
};

const sub = (a: AtlasV3, b: AtlasV3): AtlasV3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: AtlasV3, b: AtlasV3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: AtlasV3, k: number): AtlasV3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: AtlasV3): AtlasV3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
const cross = (a: AtlasV3, b: AtlasV3): AtlasV3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Atlas landmarks of the heart in pose `hp`, from a census on a grid of `h` cm in the heart frame. */
export function atlasMarks(heart: HeartModel, hp: HeartPose, h = 0.2): AtlasMarks {
  const s = makeSample();
  const sum = new Map<string, { n: number; s: AtlasV3 }>();
  const lv: AtlasV3[] = [];
  for (let x = -8; x <= 8; x += h)
    for (let y = -8; y <= 8; y += h)
      for (let z = -7; z <= 11; z += h) {
        // the classifier takes the swing of the tamponade heart off x itself
        if (!classifyHeart(heart, hp, x + hp.swingX, y, z, s)) continue;
        const g = GROUP[s.structure];
        if (!g) continue;
        const a = sum.get(g) ?? { n: 0, s: [0, 0, 0] as AtlasV3 };
        a.n++;
        a.s = [a.s[0] + x, a.s[1] + y, a.s[2] + z];
        sum.set(g, a);
        if (g === 'lv') lv.push([x, y, z]);
      }
  const centroid = (g: string): AtlasV3 => {
    const a = sum.get(g);
    if (!a) throw new Error(`atlasMarks: no ${g} in the census`);
    return scale(a.s, 1 / a.n);
  };
  const mv = centroid('mitral'),
    tv = centroid('tricuspidValve'),
    av = centroid('aorticValve');
  let apex = mv,
    far = -1;
  for (const p of lv) {
    const d = Math.hypot(...sub(p, mv));
    if (d > far) {
      far = d;
      apex = p;
    }
  }
  const ez = unit(sub(apex, mv));
  let ex = sub(mv, tv);
  ex = unit(sub(ex, scale(ez, dot(ex, ez))));
  let ey = cross(ez, ex);
  if (dot(sub(av, mv), ey) < 0) ey = scale(ey, -1);
  const local = (p: AtlasV3): AtlasV3 => {
    const d = sub(p, mv);
    return [dot(d, ex) / far, dot(d, ey) / far, dot(d, ez) / far];
  };
  const dir = (d: AtlasV3): AtlasV3 => unit([dot(d, ex), dot(d, ey), dot(d, ez)]);
  const positions: Record<string, AtlasV3> = {};
  for (const k of [
    'rightVentricle',
    'leftAtrium',
    'rightAtrium',
    'aorticValve',
    'pulmonaryValve',
    'tricuspidValve',
  ])
    positions[k] = local(centroid(k));
  const A = heartAnchors(heart);
  const la = A.laCenter,
    lr = A.laR;
  const zTop = la.z - lr.z,
    zBottom = hp.zAnn + 0.25;
  const czL = (zTop + zBottom) / 2,
    rzL = (zBottom - zTop) / 2;
  const bo = atrialScale(hp.laBooster, A.laReservoir, hp.state.contraction);
  const seg = new Float64Array(6);
  const vessels: Record<string, AtlasV3> = {};
  const veins = ['rightSuperiorVein', 'leftSuperiorVein', 'rightInferiorVein', 'leftInferiorVein'];
  for (let i = 0; i < 4; i++) {
    pulmonaryVeinSegment(i, la, lr, bo, czL, rzL, seg);
    vessels[veins[i]!] = dir([seg[3]! - seg[0]!, seg[4]! - seg[1]!, seg[5]! - seg[2]!]);
  }
  // the appendage's axis (classify/atria.ts) and the venae cavae from the atrium outward
  vessels['appendage'] = dir([lr.x * 0.4, 2.0, 0.5]);
  vessels['superiorVenaCava'] = dir([
    A.svcM.x - A.svcA.x,
    A.svcM.y - A.svcA.y,
    A.svcM.z - A.svcA.z,
  ]);
  vessels['inferiorVenaCava'] = dir([
    A.ivcB.x - A.ivcA.x,
    A.ivcB.y - A.ivcA.y,
    A.ivcB.z - A.ivcA.z,
  ]);
  return { lvLength: far, positions, vessels };
}
