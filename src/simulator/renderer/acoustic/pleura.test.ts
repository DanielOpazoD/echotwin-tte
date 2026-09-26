// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { Tissue } from '@/simulator/anatomy/tissue';
import { pleuralCoherence, pleuralIncidenceCos, PLEURA_SLOPE_WINDOW_CM } from './acoustics';

/**
 * The pleural line and its A-lines are specular (decision 221): they come back to the probe where the pleura faces the
 * beam and fade where it runs along it. Drawn at full strength on every line that entered lung, the replicas copied each
 * line's entry depth, and where the lung surface ran along the beam they drew staircases — «square-wave zigzags» and
 * «a giant U» to a reviewing echocardiographer, in the parasternal short axes and at the sides of the apical views.
 */
/** The incidence the renderer reads, written out so the frame test also measures a renderer without it. */
const WINDOW_CM = 1.5;
const incidenceCos = (dEntryCm: number, arcCm: number): number =>
  arcCm / Math.sqrt(arcCm * arcCm + dEntryCm * dEntryCm);

describe('pleura and A-lines follow the incidence (decision 221)', () => {
  it('the incidence comes from the change of entry depth across the lines', () => {
    expect(pleuralIncidenceCos(0, 1)).toBe(1);
    expect(pleuralIncidenceCos(1, 1)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(pleuralIncidenceCos(-1, 1)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(pleuralCoherence(1)).toBe(1);
    expect(pleuralCoherence(Math.SQRT1_2)).toBeCloseTo(0.25, 12);
    expect(pleuralCoherence(0)).toBe(0);
    expect(PLEURA_SLOPE_WINDOW_CM).toBe(WINDOW_CM);
    for (const [d, a] of [
      [0.3, 0.4],
      [-1.2, 0.2],
    ] as const)
      expect(incidenceCos(d, a)).toBeCloseTo(pleuralIncidenceCos(d, a), 12);
  });

  it(
    'behind a pleura running along the beam the lung holds almost no bright echo; where it faces the beam the A-lines stay',
    { timeout: 120_000 },
    () => {
      const c = loadCaseById('normal-excellent-window');
      const { thorax, heart, tables } = buildCaseModels(c, {
        position: 'left-lateral',
        respiration: 'expiration',
        headElevationDeg: 0,
      });
      const out: string[] = [];
      // bright share (display grey > 170) of the lung behind the pleura; until decision 221, 5.5 and 7.1 % behind an
      // oblique pleura against 2.6 and 4.0 % behind a square one
      for (const view of ['psax-pm', 'psax-apex']) {
        const spec = polarSpecFor(DEFAULT_ACQUISITION, 'high');
        const beam = beamFrameFromPose(
          poseFromControl(thorax, canonicalControl(getViewTarget(view), heart, thorax)),
          1,
        );
        const scene: Scene = {
          heart,
          heartPose: computeHeartPose(heart, cycleStateAt(tables, 0)),
          thorax,
          physics: {
            frequencyMHz: 2.5,
            harmonics: true,
            clutterLevel: c.acousticWindow.clutterLevel,
            windowAttenuation: c.acousticWindow.chestWallAttenuation,
            seed: c.seed,
          },
        };
        const f = allocPolarFrame(spec);
        new ProceduralSliceRenderer().render(scene, beam, spec, 0, f);
        const disp = new Uint8ClampedArray(spec.lines * spec.samples);
        applyConsole(f, DEFAULT_ACQUISITION, createConsoleState(c.seed), disp);
        const S = spec.samples,
          L = spec.lines,
          dr = spec.depthCm / S,
          dTheta = spec.sectorRad / L,
          w = Math.round(WINDOW_CM / dr);
        const entry = new Int32Array(L).fill(-1);
        for (let li = 0; li < L; li++)
          for (let s = 0; s < S; s++)
            if (f.tissue[li * S + s] === Tissue.Lung) {
              entry[li] = s;
              break;
            }
        const oblique: [number, number] = [0, 0],
          square: [number, number] = [0, 0];
        for (let li = 1; li < L - 1; li++) {
          const e = entry[li]!;
          if (e < 0) continue;
          const near = (j: number) =>
            entry[j]! < 0 ? e + w : Math.min(e + w, Math.max(e - w, entry[j]!));
          const cos = incidenceCos((near(li + 1) - near(li - 1)) * dr, 2 * (e + 0.5) * dr * dTheta);
          const acc = cos < 0.5 ? oblique : cos > 0.9 ? square : null;
          if (!acc) continue;
          for (let s = e; s < S; s++) {
            acc[1]++;
            if (disp[li * S + s]! > 170) acc[0]++;
          }
        }
        const share = (a: [number, number]) => a[0] / Math.max(1, a[1]);
        if (!(oblique[1] > 1000 && share(oblique) < 0.015))
          out.push(
            `${view}: ${(share(oblique) * 100).toFixed(2)} % bright behind an oblique pleura`,
          );
        if (!(square[1] > 1000 && share(square) > 0.02))
          out.push(`${view}: ${(share(square) * 100).toFixed(2)} % bright behind a square pleura`);
      }
      expect(out).toEqual([]);
    },
  );
});
