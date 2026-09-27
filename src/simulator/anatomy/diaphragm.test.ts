// @tier slow
import { describe, expect, it } from 'vitest';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { classifyHeart, computeHeartPose, heartAnchors } from '@/simulator/anatomy/heartModel';
import { heartToTorso, torsoToHeart } from '@/simulator/anatomy/heartFrame';
import { classifyThorax } from '@/simulator/anatomy/thoraxModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  CALIBRATED_TIER,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { add, dot, normalize, scale, sub } from '@/core/vec3';

/**
 * The right heart rests on the diaphragm (decision 229). Until then the liver dome was a paraboloid under the right heart
 * and the heart floated above it, with lung in the gap: the subcostal beams crossed a pleura before the heart in 14–16 % of
 * their lines, and the junction of the inferior vena cava with the right atrium — what the subcostal view of the cava is
 * for — was drawn as lung reverberation.
 */
const RIGHT_HEART: ReadonlySet<number> = new Set([
  Structure.RvWall,
  Structure.RvCavity,
  Structure.RaWall,
  Structure.RaCavity,
]);
const LINING: ReadonlySet<number> = new Set([
  Structure.Pericardium,
  Structure.EpicardialFat,
  Structure.PericardialEffusion,
]);

describe('the right heart rests on the diaphragm (decision 229)', () => {
  it('leaves no lung between the right ventricle or atrium and the diaphragm under them', () => {
    const s = makeSample();
    const problems: string[] = [];
    for (const { id } of CASE_INPUTS) {
      const { heart, thorax, tables } = new SimulatorCore(loadCaseById(id), baseInput()).models;
      const pose = computeHeartPose(heart, cycleStateAt(tables, 0));
      const heartAt = (x: number, y: number, z: number): number => {
        const h = torsoToHeart(heart.frame, { x, y, z });
        return classifyHeart(heart, pose, h.x + pose.swingX, h.y, h.z, s) &&
          s.structure !== Structure.Ivc &&
          s.structure !== Structure.HepaticVein
          ? s.structure
          : -1;
      };
      let lung = 0,
        gap = 0,
        columns = 0;
      // torso columns (cm) whose lowest chamber is the right ventricle or atrium
      for (let x = -6; x <= 8; x += 1)
        for (let z = -12; z <= 0; z += 1) {
          let yb = NaN;
          for (let y = -12; y < 4; y += 0.1)
            if (heartAt(x, y, z) >= 0) {
              yb = y;
              break;
            }
          if (!Number.isFinite(yb)) continue;
          let k = -1;
          for (let d = 0.1; d < 4.5 && k < 0; d += 0.1) {
            const st = heartAt(x, yb + d, z);
            if (st >= 0 && !LINING.has(st)) k = st;
          }
          if (!RIGHT_HEART.has(k)) continue;
          // at the acute margin a sliver of free wall covers the lung's cardiophrenic recess: whole chambers only
          let top = yb;
          while (top < yb + 1.6 && heartAt(x, top + 0.1, z) >= 0) top += 0.1;
          if (top < yb + 1.5) continue;
          columns++;
          // down from the heart to the diaphragm or the liver
          for (let y = yb - 0.05; y > -14; y -= 0.05) {
            const h = torsoToHeart(heart.frame, { x, y, z });
            if (classifyHeart(heart, pose, h.x + pose.swingX, h.y, h.z, s)) continue;
            classifyThorax(thorax, x, y, z, s, s.sdf);
            if (s.structure === Structure.Diaphragm || s.structure === Structure.Liver) break;
            gap++;
            if (s.structure === Structure.Lung) lung++;
          }
        }
      if (columns < 20) problems.push(`${id}: only ${columns} columns under the right heart`);
      if (lung > 0)
        problems.push(`${id}: ${lung} of ${gap} samples under the right heart are lung`);
    }
    expect(problems).toEqual([]);
  });

  it('shows the cava opening into the right atrium in the subcostal view', () => {
    const spec = polarSpecFor(DEFAULT_ACQUISITION, CALIBRATED_TIER);
    const L = spec.lines,
      S = spec.samples,
      dr = spec.depthCm / S;
    const problems: string[] = [];
    for (const { id } of CASE_INPUTS) {
      const c = loadCaseById(id);
      const { heart, thorax, tables } = new SimulatorCore(c, baseInput()).models;
      const beam = beamFrameFromPose(
        poseFromControl(thorax, canonicalControl(getViewTarget('subcostal-ivc'), heart, thorax)),
        1,
      );
      const scene: Scene = {
        heart,
        heartPose: computeHeartPose(heart, cycleStateAt(tables, 0)),
        thorax,
        physics: {
          frequencyMHz: DEFAULT_ACQUISITION.frequencyMHz,
          harmonics: DEFAULT_ACQUISITION.harmonics,
          clutterLevel: c.acousticWindow.clutterLevel,
          windowAttenuation: c.acousticWindow.chestWallAttenuation,
          seed: c.seed,
        },
      };
      const f = allocPolarFrame(spec);
      new ProceduralSliceRenderer().render(scene, beam, spec, 0, f);
      const A = heartAnchors(heart);
      const a = heartToTorso(heart.frame, A.ivcA);
      const u = normalize(sub(heartToTorso(heart.frame, A.ivcB), a));
      // along the axis of the cava, from 1 cm inside the atrium to 1.5 cm into the cava
      let lung = 0,
        n = 0;
      for (let t = -1; t <= 1.5; t += 0.1) {
        const q = sub(add(a, scale(u, t)), beam.origin);
        const th = Math.atan2(dot(q, beam.lateral), dot(q, beam.forward));
        const li = Math.floor(((th + spec.sectorRad / 2) / spec.sectorRad) * L);
        const si = Math.floor(Math.hypot(dot(q, beam.lateral), dot(q, beam.forward)) / dr);
        if (li < 0 || li >= L || si >= S) continue;
        n++;
        if (f.structure[li * S + si] === Structure.Lung) lung++;
      }
      if (n < 20 || lung > 0)
        problems.push(`${id}: ${lung} of ${n} samples of the junction are lung`);
    }
    expect(problems).toEqual([]);
  });
});
