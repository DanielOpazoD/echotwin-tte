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
import {
  ATTEN_NP_PER_DB,
  pleuralCoherence,
  pleuralIncidenceCos,
  pleuralReverberation,
  PLEURA_SLOPE_WINDOW_CM,
  REVERB_DECAY,
  SOFT_TISSUE_ATTEN_DB,
} from './acoustics';

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

  it('behind a pleura running along the beam the lung holds almost no bright echo; where it faces the beam the A-lines stay', () => {
    const c = loadCaseById('normal-excellent-window');
    const { thorax, heart, tables } = buildCaseModels(c, {
      position: 'left-lateral',
      respiration: 'expiration',
      headElevationDeg: 0,
    });
    const out: string[] = [];
    // bright share (display grey > 170) of the lung behind the pleura; until decision 221, 5.5 and 7.1 % behind an
    // oblique pleura against 2.6 and 4.0 % behind a square one. The square pleura of the papillary short axis was the
    // lung under the LV inferior wall, which became diaphragm and liver at decision 262 (4864 samples to 464): the mitral
    // short axis faces the pleura instead
    const OBLIQUE = new Set(['psax-pm', 'psax-apex']),
      SQUARE = new Set(['psax-apex', 'psax-mv']);
    for (const view of ['psax-pm', 'psax-apex', 'psax-mv']) {
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
      if (OBLIQUE.has(view) && !(oblique[1] > 1000 && share(oblique) < 0.015))
        out.push(`${view}: ${(share(oblique) * 100).toFixed(2)} % bright behind an oblique pleura`);
      if (SQUARE.has(view) && !(square[1] > 1000 && share(square) > 0.02))
        out.push(`${view}: ${(share(square) * 100).toFixed(2)} % bright behind a square pleura`);
    }
    expect(out).toEqual([]);
  });
});

/**
 * A-lines fade like echoes from their depth (decision 250). An A-line seen a pleura depth further down has made one more
 * round trip between the pleura and the probe face: it lost what a bounce takes and the attenuation of that much more
 * tissue, as any echo from its depth did; the console's depth gain gives back the second and leaves the first. Drawn
 * without the path, each order kept its strength while the tissue around it lost it, and the gain lifted it.
 */
describe('A-lines are attenuated over their path (decision 250)', () => {
  it('each order is the one before it times the bounce loss and the attenuation of one more pleura depth', () => {
    const f = 2.5;
    for (const entry of [1.2, 2, 3.5]) {
      const order = (j: number) => pleuralReverberation(entry + j * entry, entry, 1, 0, 1, f);
      for (const j of [1, 2]) {
        const expected =
          REVERB_DECAY * Math.exp(-ATTEN_NP_PER_DB * SOFT_TISSUE_ATTEN_DB * f * entry);
        expect(order(j + 1) / order(j), `entry ${entry} cm, order ${j} → ${j + 1}`).toBeCloseTo(
          expected,
          2,
        );
      }
    }
  });
});

describe('the diffuse reverberation behind the pleura is attenuated over its path too (decision 270)', () => {
  it('seen d past the pleura it carries the loss of d of soft tissue, which the depth gain gives back', () => {
    // Behind the posterior pleura of the parasternal views (11 cm deep) the diffuse reverberation, drawn without its path
    // loss, was lifted by the console's depth gain and stayed as bright as the myocardium for 5 cm (PLAX: 144 against a
    // septum of 144).
    const f = 2.5;
    for (const entry of [2, 11])
      for (const d of [0.5, 2, 4]) {
        // coherence 0 leaves only the diffuse term
        const lossy = pleuralReverberation(entry + d, entry, 1, 1, 0, f);
        const lossless = pleuralReverberation(entry + d, entry, 1, 1, 0, 0);
        expect(lossy / lossless, `entry ${entry} cm, ${d} cm past it`).toBeCloseTo(
          Math.exp(-ATTEN_NP_PER_DB * SOFT_TISSUE_ATTEN_DB * f * d),
          6,
        );
      }
  });
});
