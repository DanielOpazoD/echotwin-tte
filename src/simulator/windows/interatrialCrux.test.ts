// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose, heartAnchors } from '@/simulator/anatomy/heartModel';
import {
  IAS_FOSSA_DESCENT_SHARE,
  IAS_FOSSA_EDGE_FROM,
  IAS_LEFT_FACE_CM,
  iasBow,
  iasThickness,
} from '@/simulator/anatomy/laGeometry';
import { makeSample } from '@/simulator/anatomy/tissue';
import { Structure } from '@/simulator/anatomy/tissue';
import { CUT_MAP_LABELS } from '@/simulator/anatomy/structurePalette';

const NAME = CUT_MAP_LABELS as Partial<Record<number, string>>;
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { scenePhysicsFor } from '@/simulator/renderer/scenePhysics';
import {
  allocPolarFrame,
  CALIBRATED_TIER,
  DEFAULT_ACQUISITION,
  polarSpecFor,
} from '@/simulator/renderer/types';

/**
 * Between the atria of the four-chamber view lies the interatrial septum, 4-7 mm thick, and nothing else (decisions 318
 * and 327). A reviewer pointed at a wedge under the septal hinge of the mitral valve that should not be there: 13.5 mm of
 * right atrial wall, septum, 2-5 mm of fat and the left atrium's own wall running beside the septum, because the atrium, an
 * ellipsoid, met the septum only around its equator (decision 318). Lower down the same ellipsoid curved away again, so
 * 2-3.4 cm below the annulus the view showed 7-11 mm of thick septum, atrial wall and fat, and the atrium's septal border
 * stepped 3.4-4.5 mm where the fossa began and where the wall began (decision 327). On the drawn plane, from 0.5 to 2.9 cm
 * beyond the deepest annulus sample, across the lines from the right atrial blood to the left atrial blood: at most 8 mm
 * of tissue, nothing but septum and right atrial wall, and no step of the left atrial border larger than 1.5 mm between
 * consecutive millimetres of depth (the lines are 1 mm apart there).
 *
 * Declared: the difficult window and the artifact challenge, whose four-chamber plane passes behind the septum through
 * the interatrial groove (since decision 324 the superior vena cava no longer lies there), and the tamponade at end-diastole.
 * Moderate aortic stenosis and the prolapse showed 1-3 mm of fat behind the membrane at mid-systole, where the right atrium
 * tapered from the fossa's upper rim, until the fossa followed the base down (decision 369).
 */
const KNOWN_INTERATRIAL_TISSUE: Record<string, string> = {
  'normal-difficult-window':
    'the plane passes behind the septum, through the interatrial groove: right atrial wall, fat and septum (19 mm)',
  'artifact-challenge':
    'the plane passes behind the septum, through the interatrial groove: right atrial wall, fat and septum (19-22 mm)',
  'pericardial-effusion-tamponade @0':
    'at end-diastole the smallest atrium (42 mL) at its radial minimum (decision 330, 0.70) recedes from the septum at its roof: 2.4-2.6 cm above the annulus its wall and 1-2 cm of fat stand between the right atrial blood and its own (10-23 mm), and higher the plane finds no left atrial blood',
};
const MAX_MM = 8;
const MAX_STEP_MM = 1.5;
const BETWEEN = new Set<number>([Structure.InteratrialSeptum, Structure.RaWall]);

function between(id: string, phase: number): { widthMm: number; others: string; stepMm: number } {
  const c = loadCaseById(id);
  const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
  const spec = polarSpecFor(DEFAULT_ACQUISITION, CALIBRATED_TIER);
  const beam = beamFrameFromPose(
    poseFromControl(thorax, canonicalControl(getViewTarget('a4c'), heart, thorax)),
    1,
  );
  const f = allocPolarFrame(spec);
  new ProceduralSliceRenderer().render(
    {
      heart,
      heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
      thorax,
      physics: scenePhysicsFor(c, DEFAULT_ACQUISITION),
    },
    beam,
    spec,
    phase,
    f,
  );
  const S = spec.samples,
    dr = spec.depthCm / S,
    dth = spec.sectorRad / spec.lines;
  let ann = 0;
  for (let i = 0; i < f.structure.length; i++)
    if (f.structure[i] === Structure.MitralAnnulus) ann = Math.max(ann, (i % S) * dr);
  let widthMm = 0,
    stepMm = 0,
    lastEdge = NaN;
  const others = new Set<number>();
  for (let depth = ann + 0.5; depth <= ann + 2.9; depth += 0.1) {
    const s = Math.round(depth / dr);
    let lastRa = -1;
    for (let li = 0; li < spec.lines; li++) {
      const st = f.structure[li * S + s]!;
      if (st === Structure.RaCavity) lastRa = li;
      if (st === Structure.LaCavity && lastRa >= 0) {
        widthMm = Math.max(widthMm, (li - lastRa - 1) * dth * depth * 10);
        for (let k = lastRa + 1; k < li; k++) {
          const t = f.structure[k * S + s]!;
          if (!BETWEEN.has(t)) others.add(t);
        }
        // the left atrial border: its lateral position, and the step from the millimetre above
        const edge = (li + 0.5 - spec.lines / 2) * dth * depth;
        if (!Number.isNaN(lastEdge)) stepMm = Math.max(stepMm, Math.abs(edge - lastEdge) * 10);
        lastEdge = edge;
        break;
      }
    }
  }
  return { widthMm, others: [...others].join(','), stepMm };
}

describe('between the atria of the four-chamber view only the septum (decisions 318, 327)', () => {
  for (const { id } of CASE_INPUTS)
    for (const phase of [0, 0.35])
      it(`${id} @${phase}`, () => {
        const m = between(id, phase);
        const ok = m.widthMm <= MAX_MM && m.others === '' && m.stepMm <= MAX_STEP_MM;
        const declared =
          KNOWN_INTERATRIAL_TISSUE[id] ?? KNOWN_INTERATRIAL_TISSUE[`${id} @${phase}`];
        // a declared case must still need it: once it holds, the entry is stale
        expect(
          ok,
          `${m.widthMm.toFixed(1)} mm${m.others ? ` with ${m.others}` : ''}, border step ${m.stepMm.toFixed(1)} mm${declared ? ` (declared: ${declared})` : ''}`,
        ).toBe(!declared);
      });
});

/**
 * Under the septal hinge of the mitral valve the left atrium is blood (decision 327). The aortomitral curtain's filler
 * stopped 1.2 cm basal of the mean annular plane, and under the septal hinge, which the saddle lifts above that plane,
 * it hung into the atrium as a bright tooth, 1-2 lines wide, 3-5 mm below the hinge and 7-8 mm lateral of the septum:
 * on the review sheets "the end of a structure cut off and moved laterally". On the drawn plane, 3 to 8 mm below the
 * septal hinge, over the 2 cm beside the septum's left face: left atrial blood and nothing else. Declared: the difficult
 * window and the artifact challenge, whose four-chamber plane passes behind the septum (see above) and cuts the anterior
 * leaflet and the ventricle where this scan expects the atrium.
 */
const KNOWN_UNDER_SEPTAL_HINGE: Record<string, string> = {
  'normal-difficult-window @0':
    'the ventricle and the anterior leaflet (LvCavity×8, MitralAnterior×2)',
  'normal-difficult-window @0.35': 'the anterior leaflet (MitralAnterior×4)',
  'artifact-challenge @0': 'the ventricle and the anterior leaflet (LvCavity×7, MitralAnterior×5)',
  'artifact-challenge @0.35': 'the anterior leaflet (MitralAnterior×1)',
};

describe('under the septal hinge the left atrium is blood (decision 327)', () => {
  for (const { id } of CASE_INPUTS)
    for (const phase of [0, 0.35])
      it(`${id} @${phase}`, () => {
        const c = loadCaseById(id);
        const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
        const spec = polarSpecFor(DEFAULT_ACQUISITION, CALIBRATED_TIER);
        const beam = beamFrameFromPose(
          poseFromControl(thorax, canonicalControl(getViewTarget('a4c'), heart, thorax)),
          1,
        );
        const f = allocPolarFrame(spec);
        new ProceduralSliceRenderer().render(
          {
            heart,
            heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
            thorax,
            physics: scenePhysicsFor(c, DEFAULT_ACQUISITION),
          },
          beam,
          spec,
          phase,
          f,
        );
        const S = spec.samples,
          dr = spec.depthCm / S,
          dth = spec.sectorRad / spec.lines;
        // the septal hinge: the annulus sample on the lowest line (the right atrium lies at the low lines)
        let hingeLine = -1,
          hingeS = -1;
        for (let li = 0; li < spec.lines && hingeLine < 0; li++)
          for (let si = 0; si < S; si++)
            if (f.structure[li * S + si] === Structure.MitralAnnulus) {
              hingeLine = li;
              hingeS = si;
              break;
            }
        expect(hingeLine).toBeGreaterThanOrEqual(0);
        const others = new Map<number, number>();
        for (let mm = 3; mm <= 8; mm++) {
          const si = Math.round(hingeS + mm / 10 / dr);
          const span = Math.round(2 / (dth * si * dr));
          // from the first line lateral of the septum's left face
          let start = -1;
          for (let li = hingeLine - 14; li <= hingeLine + 20; li++)
            if (f.structure[li * S + si] === Structure.InteratrialSeptum) start = li + 1;
          if (start < 0) continue;
          for (let li = start; li < start + span; li++) {
            const st = f.structure[li * S + si]!;
            if (st !== Structure.LaCavity) others.set(st, (others.get(st) ?? 0) + 1);
          }
        }
        const found = [...others].map(([st, n]) => `${NAME[st] ?? st}×${n}`).join(', ');
        const declared = KNOWN_UNDER_SEPTAL_HINGE[`${id} @${phase}`];
        expect(
          found === '',
          `${found || 'blood'}${declared ? ` (declared: ${declared})` : ''}`,
        ).toBe(!declared);
      });
});

/**
 * The fossa ovalis is a membrane between the two atrial cavities (decision 319): its floor is the one true septum, the
 * window of a patent foramen ovale or a secundum defect. It sat where only the left atrium reached the septum, under the
 * superior vena cava and 5 mm of fat on the right: 11 mm from blood to blood. Across the septum at its centre and 0.2 cm
 * around it, from the right atrial blood to the left: at most 4.5 mm, a millimetre thinner than the model's muscular
 * septum (5.5 mm): a 1.2 mm membrane and the right atrium's thin wall, all of it septum or right atrial wall. Declared: the tamponade at end-diastole, when the right atrium collapses
 * away from the septum and fat fills the gap.
 */
const KNOWN_FOSSA: Record<string, string> = {
  'pericardial-effusion-tamponade @0': 'the right atrium collapses away from the septum',
};

describe('the fossa ovalis is a membrane between the atria (decision 319)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const c = loadCaseById(id);
      const { heart, tables } = new SimulatorCore(c, baseInput()).models;
      const A = heartAnchors(heart);
      const s = makeSample();
      const problems: string[] = [];
      for (const phase of [0, 0.35]) {
        if (KNOWN_FOSSA[`${id} @${phase}`]) continue;
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        for (const [dy, dz] of [
          [0, 0],
          [0.2, 0],
          [-0.2, 0],
          [0, 0.2],
          [0, -0.2],
        ] as const) {
          const y = A.fossaY + dy,
            z = A.fossaZ + dz;
          let lastRa = NaN,
            firstLa = NaN;
          const between = new Set<number>();
          for (let x = A.iasX - 1.5; x <= A.iasX + 1.5; x += 0.02) {
            const st = classifyHeart(heart, pose, x, y, z, s) ? s.structure : -1;
            if (st === Structure.RaCavity) {
              lastRa = x;
              between.clear();
            } else if (st === Structure.LaCavity) {
              firstLa = x;
              break;
            } else if (Number.isFinite(lastRa)) between.add(st);
          }
          const mm = (firstLa - lastRa - 0.02) * 10;
          const others = [...between].filter(
            (st) => st !== Structure.InteratrialSeptum && st !== Structure.RaWall,
          );
          if (!(mm <= 4.5) || others.length)
            problems.push(
              `@${phase} (${dy}, ${dz}): ${mm.toFixed(1)} mm, other tissue ${others.join(',') || '-'}`,
            );
        }
      }
      expect(problems).toEqual([]);
    });
});

/**
 * Seen from the left atrium the septum is flat: the fossa ovalis is a depression of the right atrial side (decision 327).
 * The septal slab was centred on the plane, so on the left the membrane sat 2.2 mm deeper than the muscular septum and the
 * left atrial blood stepped toward the right atrium over the fossa. At the fossa's centre and 1 cm toward the annulus, on
 * the muscular septum, the left atrial blood begins at the same x, within the 0.02 cm of the walk.
 */
describe('the left face of the septum is flat over the fossa (decision 327)', () => {
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const c = loadCaseById(id);
      const { heart, tables } = new SimulatorCore(c, baseInput()).models;
      const A = heartAnchors(heart);
      const s = makeSample();
      const firstLa = (y: number, z: number, pose: ReturnType<typeof computeHeartPose>): number => {
        for (let x = A.iasX - 0.5; x <= A.iasX + 1.5; x += 0.02)
          if (classifyHeart(heart, pose, x, y, z, s) && s.structure === Structure.LaCavity)
            return x;
        return NaN;
      };
      const problems: string[] = [];
      for (const phase of [0, 0.35]) {
        if (KNOWN_FOSSA[`${id} @${phase}`]) continue;
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        // the fossa follows the base and the septum bows toward the right atrium (decision 369): its plane is the
        // septum's own, read where it stands at this phase
        const zF = A.fossaZ + IAS_FOSSA_DESCENT_SHARE * pose.zAnn;
        const plane = (z: number) =>
          A.iasX - iasBow(Math.abs(z - zF) / 0.7, pose.state.contraction);
        const atFossa = firstLa(A.fossaY, zF, pose) - plane(zF);
        const onMuscle = firstLa(A.fossaY, zF + 1.0, pose) - plane(zF + 1.0);
        if (!(Math.abs(atFossa - onMuscle) <= 0.021))
          problems.push(
            `@${phase}: left atrial blood begins ${(atFossa * 10).toFixed(1)} mm from the septal plane over the fossa and ${(onMuscle * 10).toFixed(1)} mm over the muscular septum`,
          );
      }
      expect(problems).toEqual([]);
    });
});

/**
 * Wherever the two atria face each other the septum lies whole between them (decision 327). The right atrium's release in
 * front of the left atrium (decision 222) read the bare ellipsoid, so where a fill of decisions 318-319 brought the left
 * atrium to the plane the right atrium was let through the slab: in main, blood against blood over 0.1-0.34 cm² in five
 * cases and a septum thinned to 0.5-2 mm over 0.4-1.6 cm² in every case. On a 1.5 mm grid over the septal plane, at every
 * cell with left atrial blood within 3 mm of the plane and right atrial blood within 1.5 cm across it: at least 0.5 mm of
 * tissue from blood to blood, and, away from the fossa's edge where the membrane rises to the muscular septum, no less
 * than the septum's nominal thickness there minus 0.6 mm. The septum is read where it stands at each phase: the fossa
 * follows the base and the septum bows toward the right atrium (decision 369).
 */
describe('the septum lies whole wherever the atria face each other (decision 327)', () => {
  const RIGHT = new Set<number>([Structure.RaCavity, Structure.RaAppendage]);
  /**
   * Declared, `case @phase` → the thinnest septum (mm) and how many cells: since decision 366 the volume fit pays the left
   * atrium's lateral wall with 3 % of the body's scale, and in moderate aortic stenosis at end-diastole one cell beside
   * the root, 9 mm above the annulus, has the left atrium 1.4 mm from the right (its wall, fat and the right atrial wall).
   */
  const KNOWN_THIN_SEPTUM: Record<string, [mm: number, cells: number]> = {
    'aortic-stenosis-moderate @0': [1.4, 1],
  };
  const seenThin = new Set<string>();
  const ANY_BLOOD = new Set<number>([
    Structure.RaCavity,
    Structure.RaAppendage,
    Structure.Svc,
    Structure.Ivc,
    Structure.CoronarySinus,
    Structure.PulmonaryVein,
  ]);
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const c = loadCaseById(id);
      const { heart, tables } = new SimulatorCore(c, baseInput()).models;
      const A = heartAnchors(heart);
      const s = makeSample();
      const problems: string[] = [];
      for (const phase of [0, 0.35]) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        // the fossa follows the base and the septum bows with it (decision 369)
        const zF = A.fossaZ + IAS_FOSSA_DESCENT_SHARE * pose.zAnn;
        let cells = 0,
          holes = 0,
          thin = 0,
          minMm = 99;
        for (let z = -6; z <= 2; z += 0.15)
          for (let y = -4; y <= 3; y += 0.15) {
            const fo = Math.hypot((y - A.fossaY) / 0.6, (z - zF) / 0.7);
            const xFace = A.iasX - iasBow(fo, pose.state.contraction) + IAS_LEFT_FACE_CM;
            // the last left atrial blood, walking toward the right from 3 mm left of the plane
            let xLa = NaN;
            for (let dx = -0.3; dx <= 0.4; dx += 0.02) {
              if (
                classifyHeart(heart, pose, xFace - dx, y, z, s) &&
                s.structure === Structure.LaCavity
              )
                xLa = xFace - dx;
              else if (!Number.isNaN(xLa)) break;
            }
            if (Number.isNaN(xLa)) continue;
            let t = NaN,
              kind = -1;
            for (let dx = 0.02; dx <= 1.5; dx += 0.02) {
              if (!classifyHeart(heart, pose, xLa - dx, y, z, s)) continue;
              if (ANY_BLOOD.has(s.structure)) {
                t = dx;
                kind = s.structure;
                break;
              }
            }
            if (!RIGHT.has(kind)) continue;
            cells++;
            // (where the membrane rises to the muscular septum the thickness changes faster than the grid resolves; the rise
            // is gentler since decision 384, and the exemption keeps its reach: following the edge, it hid the thin septum
            // declared above)
            const onRim = fo >= IAS_FOSSA_EDGE_FROM - 0.1 && fo <= 1.5;
            if (t < 0.05) holes++;
            else if (!onRim && t < iasThickness(fo) - 0.06) {
              thin++;
              minMm = Math.min(minMm, t * 10);
            }
          }
        const declared = KNOWN_THIN_SEPTUM[`${id} @${phase}`];
        if (declared && !holes && thin > 0) {
          seenThin.add(`${id} @${phase}`);
          if (thin <= declared[1] && minMm >= declared[0] - 0.3) continue;
        }
        if (holes || thin)
          problems.push(
            `@${phase}: ${cells} cells facing, ${holes} with blood against blood, ${thin} with the septum thinned (down to ${minMm.toFixed(1)} mm)`,
          );
      }
      expect(problems).toEqual([]);
    });
  it('every declared thin septum is still thin', () => {
    expect(Object.keys(KNOWN_THIN_SEPTUM).filter((k) => !seenThin.has(k))).toEqual([]);
  });
});

/**
 * And the two atrial bloods never touch, in any direction (decision 327, third mark). The walk above runs along x; the
 * corner's anterior bound, measured along y, left the left atrium 8-11 mm in front of the mitral straight edge beside
 * the septum, over the membranous septum, and there the right atrium met it face to face: 0.20 cm² in the moderate aortic
 * stenosis at end-diastole, found by an adversarial reviewer on a 1 mm grid with six-neighbour adjacency. On that grid,
 * over the atria from 2 cm right of the septal plane to 2.5 cm left of it, no left atrial blood cell borders a right
 * atrial one.
 */
describe('the atrial bloods never touch (decision 327)', () => {
  const H = 0.1;
  for (const { id } of CASE_INPUTS)
    it(id, () => {
      const c = loadCaseById(id);
      const { heart, tables } = new SimulatorCore(c, baseInput()).models;
      const A = heartAnchors(heart);
      const s = makeSample();
      const problems: string[] = [];
      for (const phase of [0, 0.35]) {
        const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
        const la = A.laCenter,
          lr = A.laR;
        const x0 = A.iasX - 2.0,
          y0 = la.y - lr.y - 0.5,
          z0 = la.z - lr.z - 0.2;
        const nx = Math.round(4.5 / H) + 1,
          ny = Math.round((pose.valves.mitral.cy + 3.0 - y0) / H) + 1,
          nz = Math.round((pose.zAnn + 0.6 - z0) / H) + 1;
        const g = new Uint8Array(nx * ny * nz);
        const at = (i: number, j: number, k: number) => (i * ny + j) * nz + k;
        for (let i = 0; i < nx; i++)
          for (let j = 0; j < ny; j++)
            for (let k = 0; k < nz; k++) {
              const hit = classifyHeart(
                heart,
                pose,
                x0 + i * H + pose.swingX,
                y0 + j * H,
                z0 + k * H,
                s,
              );
              const st = hit ? s.structure : Structure.None;
              g[at(i, j, k)] =
                st === Structure.LaCavity
                  ? 1
                  : st === Structure.RaCavity || st === Structure.RaAppendage
                    ? 2
                    : 0;
            }
        let faces = 0;
        let where = '';
        for (let i = 1; i < nx - 1; i++)
          for (let j = 1; j < ny - 1; j++)
            for (let k = 1; k < nz - 1; k++) {
              if (g[at(i, j, k)] !== 1) continue;
              const touches =
                g[at(i + 1, j, k)] === 2 ||
                g[at(i - 1, j, k)] === 2 ||
                g[at(i, j + 1, k)] === 2 ||
                g[at(i, j - 1, k)] === 2 ||
                g[at(i, j, k + 1)] === 2 ||
                g[at(i, j, k - 1)] === 2;
              if (touches) {
                faces++;
                if (!where)
                  where = ` at (${(x0 + i * H).toFixed(1)}, ${(y0 + j * H).toFixed(1)}, ${(z0 + k * H).toFixed(1)})`;
              }
            }
        if (faces)
          problems.push(`@${phase}: ${faces} left atrial cells against right atrial blood${where}`);
      }
      expect(problems).toEqual([]);
    });
});
