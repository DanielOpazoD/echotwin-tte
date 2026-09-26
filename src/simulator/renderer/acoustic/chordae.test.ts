// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  CALIBRATED_TIER,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { CORD_CM, cordAlignment, cordWeight } from './acoustics';

/**
 * A chorda tendinea is a cord thinner than the beam and the slice (decision 227). The classifier gave its samples the
 * heart's long axis as a surface normal, which the apical beams follow: every cord sample took the full interface echo,
 * and the chordae were drawn as bright rods twice as bright as the LV wall — a reviewing echocardiographer read them as
 * thrombus or vegetation. A cylinder reflects along its radial normals, so its echo is strongest with the beam across it
 * and none along it, and a cord lying in the plane fills only its diameter of the slice.
 */
describe('chordae are thin cords (decision 227)', () => {
  it('the echo follows the angle to the cord axis and the share of the slice it fills', () => {
    expect(cordAlignment(1)).toBe(0);
    expect(cordAlignment(0)).toBe(1);
    expect(cordAlignment(Math.SQRT1_2)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(cordWeight(1, 0.3)).toBe(1);
    expect(cordWeight(0, 0.3)).toBeCloseTo(CORD_CM / (CORD_CM + 0.6), 12);
  });

  it('a chordae sample carries the axis of its cord', () => {
    const c = loadCaseById('normal-excellent-window');
    const { heart, tables } = buildCaseModels(c, {
      position: 'left-lateral',
      respiration: 'expiration',
      headElevationDeg: 0,
    });
    const pose = computeHeartPose(heart, cycleStateAt(tables, 0.3));
    const ch = pose.valves.chordae;
    const s = makeSample();
    let checked = 0;
    for (let i = 0; i < pose.valves.chordaeCount; i++) {
      const a = [ch[i * 6]!, ch[i * 6 + 1]!, ch[i * 6 + 2]!],
        b = [ch[i * 6 + 3]!, ch[i * 6 + 4]!, ch[i * 6 + 5]!];
      const ax = b.map((v, k) => v - a[k]!);
      const len = Math.hypot(ax[0]!, ax[1]!, ax[2]!);
      // the middle of the cord, where no leaflet or muscle claims the point
      const m = a.map((v, k) => v + ax[k]! / 2);
      if (!classifyHeart(heart, pose, m[0]! + pose.swingX, m[1]!, m[2]!, s)) continue;
      if (s.structure !== Structure.Chordae) continue;
      const cosAxis = Math.abs(s.nx * ax[0]! + s.ny * ax[1]! + s.nz * ax[2]!) / len;
      expect(cosAxis, `cord ${i}`).toBeGreaterThan(0.999);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it(
    'the cords, which run near the long axis, echo less along the apical beams than across the parasternal one',
    { timeout: 240_000 },
    () => {
      const c = loadCaseById('normal-excellent-window');
      const { thorax, heart, tables } = buildCaseModels(c, {
        position: 'left-lateral',
        respiration: 'expiration',
        headElevationDeg: 0,
      });
      const spec = polarSpecFor(DEFAULT_ACQUISITION, CALIBRATED_TIER);
      // mean displayed grey of the cord samples per view (ED and early systole); until decision 227 the apical views
      // read 190-207 against 143-145 in the parasternal long axis
      const grey = (view: string): number => {
        let g = 0,
          n = 0;
        for (const ph of [0, 0.25]) {
          const beam = beamFrameFromPose(
            poseFromControl(thorax, canonicalControl(getViewTarget(view), heart, thorax)),
            1,
          );
          const scene: Scene = {
            heart,
            heartPose: computeHeartPose(heart, cycleStateAt(tables, ph)),
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
          new ProceduralSliceRenderer().render(scene, beam, spec, ph, f);
          const disp = new Uint8ClampedArray(spec.lines * spec.samples);
          applyConsole(f, DEFAULT_ACQUISITION, createConsoleState(c.seed), disp);
          for (let i = 0; i < disp.length; i++)
            if (f.structure[i] === Structure.Chordae && f.tissue[i] === Tissue.Chordae) {
              g += disp[i]!;
              n++;
            }
        }
        expect(n, `${view}: cords in the image`).toBeGreaterThan(3);
        return g / n;
      };
      const parasternal = grey('plax');
      const apical = ['a2c', 'a3c', 'a5c', 'rv-focused'].map(grey);
      const mean = apical.reduce((a, b) => a + b, 0) / apical.length;
      expect(
        mean,
        `apical ${apical.map((v) => v.toFixed(0)).join(', ')} against parasternal ${parasternal.toFixed(0)}`,
      ).toBeLessThan(parasternal);
    },
  );
});
