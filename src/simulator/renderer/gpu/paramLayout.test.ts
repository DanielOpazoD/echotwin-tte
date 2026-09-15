import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { DEFAULT_ACQUISITION, polarSpecFor, type Scene } from '@/simulator/renderer/types';
import {
  allocPacked,
  packScene,
  PARAM_COUNT,
  PARAM_OFFSET,
  PARAM_TEXELS,
  paramDefinesGlsl,
} from './paramLayout';

const c = loadCaseById('normal-excellent-window');
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
});
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const scene: Scene = {
  heart,
  heartPose: computeHeartPose(heart, cycleStateAt(tables, 0.3)),
  thorax,
  physics: { frequencyMHz: 2.5, harmonics: true, clutterLevel: 0.2, windowAttenuation: 0.1, seed: c.seed },
};
const beam = beamFrameFromPose(poseFromControl(thorax, canonicalControl(getViewTarget('plax'), heart, thorax)));
const spec = polarSpecFor(DEFAULT_ACQUISITION, 'low');

describe('GPU parameter layout', () => {
  it('assigns every name a unique, contiguous offset inside one texture of RGBA texels', () => {
    const offsets = Object.values(PARAM_OFFSET).sort((a, b) => a - b);
    expect(offsets[0]).toBe(0);
    for (let i = 0; i < offsets.length; i++) {
      // arrays take several slots, so the sorted list is strictly increasing but not +1
      if (i > 0) expect(offsets[i]).toBeGreaterThan(offsets[i - 1]!);
      expect(offsets[i]).toBeLessThan(PARAM_COUNT);
    }
    expect(PARAM_TEXELS * 4).toBeGreaterThanOrEqual(PARAM_COUNT);
  });

  it('emits a GLSL define per scalar and per array base at the same offsets the packer writes', () => {
    const defines = paramDefinesGlsl().split('\n');
    const seen = new Set<string>();
    for (const line of defines) {
      const m = /^#define (\w+?)(_BASE)? (?:P\()?(\d+)\)?$/.exec(line);
      expect(m, line).toBeTruthy();
      const name = m![1]!;
      const idx = Number(m![3]);
      // the define's index must be the offset the TypeScript packer writes to
      expect(PARAM_OFFSET[name]).toBe(idx);
      seen.add(name + (m![2] ?? ''));
    }
    // every packed name is defined for the shader (arrays appear as NAME_BASE)
    for (const name of Object.keys(PARAM_OFFSET)) {
      expect(seen.has(name) || seen.has(`${name}_BASE`), `${name} has no #define`).toBe(true);
    }
  });

  it('packs the scene into the slots the shader reads: frame, beam and spec', () => {
    const out = allocPacked();
    packScene(scene, beam, spec, out);
    const d = out.data;
    // the buffer is Float32: values arrive as the shader would read them
    const at = (n: string) => d[PARAM_OFFSET[n]!]!;
    expect(at('HF_OX')).toBe(Math.fround(heart.frame.origin.x));
    expect(at('HF_EZZ')).toBe(Math.fround(heart.frame.ez.z));
    expect(at('B_OY')).toBe(Math.fround(beam.origin.y));
    expect(at('B_FZ')).toBe(Math.fround(beam.forward.z));
    expect(at('B_NX')).toBe(Math.fround(beam.normal.x));
    expect(at('LINES')).toBe(spec.lines);
    expect(at('SAMPLES')).toBe(spec.samples);
    expect(at('DEPTH')).toBe(spec.depthCm);
    expect(at('HARM')).toBe(1);
    // no scalar slot is left unwritten or non-finite: a NaN reaching the shader reads as tissue
    const scalarCount = defines_scalar_count();
    for (let i = 0; i < scalarCount; i++) expect(Number.isFinite(d[i]), `scalar ${i}`).toBe(true);
  });

  it('packs deterministically: the same scene and beam give the same buffer', () => {
    const a = allocPacked();
    const b = allocPacked();
    packScene(scene, beam, spec, a);
    packScene(scene, beam, spec, b);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});

function defines_scalar_count(): number {
  // number of plain `#define NAME P(i)` defines (scalars), i.e. the leading packed region
  return paramDefinesGlsl()
    .split('\n')
    .filter((l) => /^#define \w+ P\(\d+\)$/.test(l) && !l.includes('_BASE')).length;
}
