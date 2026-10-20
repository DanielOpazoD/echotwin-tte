/**
 * The point scatterers on the GPU (decision 354), on a recording stand-in for WebGL2: every uniform the GLSL declares is
 * set with the CPU's numbers for the frame, the kernels and the looks are the formation's, and the GLSL hash mixes the
 * cubes with the same constants as the CPU's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ELEVATION_REACH_SIGMAS,
  SCATTER_FIELD,
  SCATTERER_CELL_CM,
  STRONG_SCATTERER_FRACTION,
  STRONG_SCATTERER_GAIN,
  wavenumberRadPerCm,
} from '../acoustic/scatterers';
import type { PsfKernels } from '../acoustic/psf';
import type { ImageFormation, PolarFrameSpec } from '../types';
import { ELEVATION_SIGMA_PER_HALF_WIDTH } from '../acoustic/acoustics';
import { GLSL_SCATTERERS } from './glslScatterers';
import { scatterFieldGpu } from './scatterFieldGpu';

/** A WebGL2 stand-in whose uniform locations are their names; every uniform call is kept. */
function recordingGl() {
  const set = new Map<string, number[]>();
  const gl = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === 'getUniformLocation') return (_p: unknown, name: string) => name;
        if (prop.startsWith('uniform')) return (loc: string, ...v: number[]) => set.set(loc, v);
        return prop;
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, set };
}

const sentinel = { key: 'sentinel' } as PsfKernels;
const asked: unknown[][] = [];
const kernels: NonNullable<ImageFormation['kernels']> = (...a) => {
  asked.push(a);
  return sentinel;
};
const formation: ImageFormation = { looks: 1, scatterers: SCATTER_FIELD, kernels };

describe('point scatterers on the GPU (decision 354)', () => {
  it('sets every uniform the shader declares with the frame’s wavenumber and seed', () => {
    const { gl, set } = recordingGl();
    const gpu = scatterFieldGpu(formation, 'test');
    gpu.frame(gl, {}, { frequencyMHz: 2.5, harmonics: true, seed: -7 });
    const declared = [...GLSL_SCATTERERS.matchAll(/^uniform \w+ (\w+);/gm)].map((m) => m[1]!);
    expect(declared.length).toBe(7);
    expect(declared.filter((n) => !set.has(n))).toEqual([]);
    expect(set.get('uScatK')).toEqual([wavenumberRadPerCm(2.5, true)]);
    // the seed as the unsigned bits the CPU's hash mixes in
    expect(set.get('uScatSeed')).toEqual([-7 >>> 0]);
    expect(set.get('uScatCell')).toEqual([SCATTERER_CELL_CM]);
    expect(set.get('uScatReach')).toEqual([ELEVATION_REACH_SIGMAS]);
    expect(set.get('uScatElev')).toEqual([ELEVATION_SIGMA_PER_HALF_WIDTH]);
    // parenchyma's strong scatterers (decision 356)
    expect(set.get('uScatStrong')).toEqual([STRONG_SCATTERER_FRACTION]);
    expect(set.get('uScatStrongGain')).toEqual([STRONG_SCATTERER_GAIN]);
  });

  it('brings the formation’s kernels and looks, and refuses a formation without scatterers', () => {
    const gpu = scatterFieldGpu(formation, 'test');
    const spec = { lines: 3 } as PolarFrameSpec;
    expect(gpu.kernels(spec, 2.5, true)).toBe(sentinel);
    expect(asked).toEqual([[spec, 2.5, true]]);
    expect(gpu.looks).toBe(1);
    expect(gpu.key).toBe('test');
    expect(() => scatterFieldGpu({ looks: 2 }, 'x')).toThrow(/no scatterers/);
  });

  it('mixes the cubes with the CPU hash’s constants, in the same order', () => {
    const cpu = readFileSync(
      join(process.cwd(), 'src/simulator/renderer/acoustic/scatterers.ts'),
      'utf8',
    );
    const body = (code: string, start: string) => {
      const a = code.indexOf(start);
      return code.slice(a, code.indexOf('}', a));
    };
    const hex = (code: string) =>
      [...code.matchAll(/0x[0-9a-f]+/gi)].map((m) => m[0].toLowerCase());
    const js = hex(body(cpu, 'function hash('));
    expect(js.length).toBe(6);
    expect(hex(body(GLSL_SCATTERERS, 'uint scatHash('))).toEqual(js);
  });
});
