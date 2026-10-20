// @tier slow
/**
 * The GPU side of the volume heart (decision 353), on a recording stand-in for WebGL2: every uniform the GLSL declares
 * is set, the textures carry the volume with the formats the shader reads, and each frame's motion is the CPU's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { loadRoderoVolume } from '@/simulator/anatomy/roderoAsset';
import { GPU_SLICE_COLUMNS, volumeHeart } from '@/simulator/anatomy/volumeHeart';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { GLSL_VOLUME_HEART } from './glslVolumeHeart';
import { volumeHeartGpu } from './volumeHeartGpu';

/** A WebGL2 stand-in: constants are their own names, uniform locations their names, and every call is kept. */
function recordingGl() {
  const set = new Map<string, number[]>();
  const textures: { target: string; internal: string; dims: number[]; length: number }[] = [];
  let bound = '';
  const fns: Record<string, (...a: unknown[]) => unknown> = {
    createTexture: () => ({}),
    bindTexture: (target) => void (bound = String(target)),
    texParameteri: () => undefined,
    pixelStorei: () => undefined,
    activeTexture: () => undefined,
    texImage3D: (_t, _l, internal, w, h, d, _b, _f, _ty, data) =>
      void textures.push({
        target: bound,
        internal: String(internal),
        dims: [w as number, h as number, d as number],
        length: (data as ArrayLike<number>).length,
      }),
    texImage2D: (_t, _l, internal, w, h, _b, _f, _ty, data) =>
      void textures.push({
        target: bound,
        internal: String(internal),
        dims: [w as number, h as number],
        length: (data as ArrayLike<number>).length,
      }),
    getUniformLocation: (_p, name) => name,
  };
  const gl = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop in fns) return fns[prop];
        if (prop.startsWith('uniform'))
          return (loc: string, ...v: unknown[]) =>
            set.set(
              loc,
              v.flatMap((x) => (typeof x === 'number' ? [x] : Array.from(x as ArrayLike<number>))),
            );
        return prop;
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, set, textures };
}

const fromPublic = (path: string): Promise<ArrayBuffer> => {
  const b = readFileSync(join(process.cwd(), 'public', path));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('volume heart on the GPU (decision 353)', async () => {
  const { heart, tables } = buildCaseModels(loadCaseById('normal-excellent-window'), REST_PATIENT);
  const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
  const es = computeHeartPose(heart, cycleStateAt(tables, tables.endSystoleS / tables.rrS));
  const vh = volumeHeart(await loadRoderoVolume(fromPublic), heart, ed);
  const gpu = volumeHeartGpu(vh, ed);
  const prog = {} as WebGLProgram;

  it('sets every uniform the shader declares', () => {
    const { gl, set } = recordingGl();
    gpu.upload(gl);
    gpu.bind(gl, prog, 2);
    gpu.frame(gl, prog, es);
    const declared = [
      ...GLSL_VOLUME_HEART.matchAll(/^uniform [\w ]+? (\w+(?:, \w+)*)(?:\[\d+\])?;/gm),
    ]
      .flatMap((m) => m[1]!.split(/,\s*/))
      .sort();
    expect(declared.length).toBeGreaterThan(30);
    expect(declared.filter((n) => !set.has(n))).toEqual([]);
  });

  it('uploads the volume, its fields and slice tables in the formats the shader reads', () => {
    const { gl, textures } = recordingGl();
    const fresh = volumeHeartGpu(vh, ed);
    fresh.upload(gl);
    const d = vh.gpu();
    const n = d.dims[0] * d.dims[1] * d.dims[2];
    expect(textures).toEqual([
      { target: 'TEXTURE_3D', internal: 'R8UI', dims: d.dims, length: n },
      { target: 'TEXTURE_3D', internal: 'RGBA16F', dims: d.dims, length: 4 * n },
      {
        target: 'TEXTURE_2D',
        internal: 'R32F',
        dims: [GPU_SLICE_COLUMNS, d.nSlices],
        length: GPU_SLICE_COLUMNS * d.nSlices,
      },
    ]);
  });

  it('moves the heart with the CPU’s numbers for the frame', () => {
    const { gl, set } = recordingGl();
    gpu.bind(gl, prog, 2);
    gpu.frame(gl, prog, es);
    const m = vh.motionParams(es, ed);
    expect(m.sL).toBeGreaterThan(1);
    for (const [name, v] of [
      ['uVolSL', m.sL],
      ['uVolSR', m.sR],
      ['uVolLambda', m.lambda],
      ['uVolCapLambda', m.capLambda],
      ['uVolAlpha', m.alpha],
      ['uVolTwist', m.twist],
      ['uVolRoof', m.roof],
      ['uVolRvRatio', m.rvRatio],
    ] as const)
      expect(set.get(name), name).toEqual([v]);
    expect(set.get('uVolAtrialScale')).toEqual(m.atrialScales);
    expect(set.get('uVolMotion')).toEqual([1]);
  });
});
