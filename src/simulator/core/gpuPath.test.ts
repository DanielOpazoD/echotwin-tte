import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BeamFrame } from '@/simulator/probe/pose';
import type { DisplayConsole, PolarFrame, PolarFrameSpec, Scene } from '@/simulator/renderer/types';
import type { ConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import type { SimInput, SimOutput } from './protocol';

/**
 * Core routing of the GPU image chain (decision 54) with a stand-in for the WebGL2 renderer: which frames are
 * formed and presented on the GPU, the CPU fallbacks, the persistence hand-over and a context lost while a
 * frame is formed. The stand-in forms frames with the CPU tracer and console, so the images are real; WebGL
 * itself is covered by e2e/gpu-equivalence.spec.ts and e2e/gpu-live.spec.ts.
 */
const gpu = vi.hoisted(() => ({
  lost: false,
  loseDuringNext: false,
  displays: 0,
  presents: 0,
  restores: 0,
  lastColor: false,
  colourVersions: [] as number[],
}));

vi.mock('@/simulator/renderer/gpu/webgl2Renderer', async () => {
  const { ProceduralSliceRenderer } = await import('@/simulator/renderer/procedural/sliceRenderer');
  const { applyConsole } = await import('@/simulator/renderer/postprocess/consolePipeline');
  class StandInGpu {
    readonly id = 'webgl2-procedural' as const;
    private cpu = new ProceduralSliceRenderer();
    get contextLost(): boolean {
      return gpu.lost;
    }
    render(
      scene: Scene,
      beam: BeamFrame,
      spec: PolarFrameSpec,
      phase: number,
      out: PolarFrame,
    ): void {
      this.cpu.render(scene, beam, spec, phase, out);
    }
    renderDisplay(
      scene: Scene,
      beam: BeamFrame,
      spec: PolarFrameSpec,
      phase: number,
      out: PolarFrame,
      _hints: unknown,
      con: DisplayConsole,
      display: Uint8ClampedArray,
    ): boolean {
      if (gpu.lost) return false;
      if (gpu.loseDuringNext) {
        gpu.loseDuringNext = false;
        gpu.lost = true;
        return false;
      }
      this.cpu.render(scene, beam, spec, phase, out);
      applyConsole(out, con.settings, con.state, display);
      con.state.gpuHistory = true; // as the real renderer: the history now lives on the GPU
      con.state.prev = null;
      gpu.displays++;
      return true;
    }
    restoreCpuHistory(state: ConsoleState): void {
      if (!state.gpuHistory) return;
      gpu.restores++;
      state.gpuHistory = false;
    }
    present(req: { color: { version: number } | null }): ImageBitmap {
      gpu.presents++;
      gpu.lastColor = req.color !== null;
      gpu.colourVersions.push(req.color ? req.color.version : -1); // -1 = no colour field with this frame
      return { close: () => undefined } as unknown as ImageBitmap;
    }
    stats(): Record<string, number | string> {
      return { gpu: 'stand-in' };
    }
    dispose(): void {}
  }
  return { createWebgl2Renderer: () => ({ renderer: new StandInGpu(), reason: 'ok' }) };
});

const { SimulatorCore } = await import('./simulatorCore');
const { loadCaseById } = await import('@/cases');
const { DEFAULT_ACQUISITION } = await import('@/simulator/renderer/types');
const { DEFAULT_COLOR } = await import('@/simulator/doppler/color/colorDoppler');
const { DEFAULT_SPECTRAL } = await import('@/simulator/doppler/spectral/spectrum');

function input(over: Partial<SimInput> = {}): SimInput {
  return {
    probe: { u: 3.4, v: 0.4, rotationDeg: 25, tiltDeg: 6, rockDeg: -4, pressure: 0.55 },
    patient: { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 },
    settings: { ...DEFAULT_ACQUISITION, tgcDb: [...DEFAULT_ACQUISITION.tgcDb] },
    modality: '2d',
    frozen: false,
    cineOffset: 0,
    color: { ...DEFAULT_COLOR },
    spectral: { ...DEFAULT_SPECTRAL },
    cursorThetaRad: 0,
    gateDepthCm: 9,
    quality: 'low',
    display: { width: 320, height: 260 },
    rendererBackend: 'webgl2', // the port directly: the atlas could decline a slow stand-in and hide the routing
    artifactOverrides: null,
    ...over,
  };
}

function stepFrames(core: InstanceType<typeof SimulatorCore>, steps: number): SimOutput[] {
  const outs: SimOutput[] = [];
  for (let i = 0; i < steps; i++) {
    const o = core.step(1 / 30);
    if (o) outs.push(o);
  }
  return outs;
}

describe('GPU image chain routing in the core (stand-in renderer)', () => {
  it('updates the polar focus metadata on the GPU display path', () => {
    const inp = input();
    const core = new SimulatorCore(loadCaseById('normal-excellent-window'), inp);
    const first = core.step(0)!;
    expect(first.bitmap).toBeTruthy();
    const oldSpec = core.lastFrame!.spec;
    core.setInput({ ...inp, settings: { ...inp.settings, focusCm: 4 } });
    const changed = core.step(0.1)!;
    expect(changed.bitmap).toBeTruthy();
    expect(core.lastFrame!.spec.focusCm).toBe(4);
    expect(oldSpec.focusCm).toBe(9);
  });
  beforeEach(() =>
    Object.assign(gpu, {
      lost: false,
      loseDuringNext: false,
      displays: 0,
      presents: 0,
      restores: 0,
      lastColor: false,
      colourVersions: [],
    }),
  );

  it(
    'presents live 2D and colour frames from the GPU and keeps the CPU composite for strips, cine review and console artifacts',
    { timeout: 60_000 },
    () => {
      const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input());
      const live = stepFrames(core, 4);
      expect(live.length).toBeGreaterThan(2);
      for (const o of live) {
        expect(o.bitmap).toBeTruthy();
        expect(o.rgba.byteLength).toBe(0);
        expect(o.stats['console']).toBe('gpu');
        expect(o.stats['present']).toBe('gpu');
      }
      expect(
        gpu.colourVersions.every((v) => v === -1),
        '2D frames carry no colour field',
      ).toBe(true);
      core.setInput(input({ modality: 'color' }));
      gpu.colourVersions.length = 0;
      // colour packets cost frames: at ~10 simulated frames per second these steps yield about seven of them
      expect(stepFrames(core, 20).some((o) => o.bitmap)).toBe(true);
      expect(gpu.lastColor).toBe(true);
      // the present pass uploads the colour field keyed by this version: it must move one step per update and
      // stay put on the frames in between (the field is recomputed every other frame)
      const versions = gpu.colourVersions;
      expect(versions.length).toBeGreaterThanOrEqual(5);
      expect(versions.every((v) => v >= 0)).toBe(true);
      expect([...versions].sort((a, b) => a - b)).toEqual(versions);
      const steps = versions.filter((v, i) => i > 0 && v !== versions[i - 1]);
      expect(steps.length, 'the version changes with an update').toBeGreaterThan(0);
      expect(steps.length, 'and not on every frame').toBeLessThan(versions.length - 1);
      expect(
        Math.max(...versions.map((v, i) => (i ? v - versions[i - 1]! : 0))),
        'one step per update',
      ).toBe(1);
      // strips: the sector is still formed on the GPU, the composite with the strip on the CPU
      core.setInput(input({ modality: 'pw' }));
      const pw = stepFrames(core, 4);
      expect(pw.length).toBeGreaterThan(0);
      for (const o of pw) {
        expect(o.bitmap ?? null).toBeNull();
        expect(o.rgba.byteLength).toBe(o.width * o.height * 4);
      }
      expect(pw.some((o) => o.stats['console'] === 'gpu')).toBe(true);
      core.setInput(input({ frozen: true, cineOffset: -1 }));
      const frozen = core.step(1 / 30);
      expect(frozen?.frozen).toBe(true);
      expect(frozen?.bitmap ?? null).toBeNull();
      expect(frozen?.rgba.byteLength).toBe((frozen?.width ?? 0) * (frozen?.height ?? 0) * 4);
      // mirror artifact: CPU console, and persistence is handed back from the GPU exactly once, at the switch
      core.setInput(
        input({ artifactOverrides: { sideLobe: 0, mirror: 0.5, beamWidth: 0, clutter: 0 } }),
      );
      const mirror = stepFrames(core, 3);
      expect(mirror.length).toBeGreaterThan(0);
      expect(gpu.restores).toBe(1);
      for (const o of mirror) {
        expect(o.stats['console']).toBe('cpu');
        expect(o.bitmap ?? null).toBeNull();
      }
      core.setInput(input());
      const back = stepFrames(core, 3);
      expect(back.length).toBeGreaterThan(0);
      expect(back.every((o) => o.stats['present'] === 'gpu')).toBe(true);
    },
  );

  it(
    'forms the frame again with the CPU tracer when the context is lost while forming it',
    { timeout: 60_000 },
    () => {
      const core = new SimulatorCore(loadCaseById('normal-excellent-window'), input());
      stepFrames(core, 2);
      gpu.loseDuringNext = true;
      let out: SimOutput | null = null;
      for (let i = 0; i < 3 && !out; i++) out = core.step(1 / 30);
      expect(out).not.toBeNull();
      const o = out!;
      expect(o.bitmap ?? null).toBeNull();
      expect(o.stats['console']).toBe('cpu');
      expect(o.stats['gpu']).toBe('WebGL context lost: CPU tracer');
      const px = new Uint8ClampedArray(o.rgba);
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] ?? 0;
      expect(
        sum / (px.length / 4),
        'the re-formed frame is an image, not the stale or empty GPU read',
      ).toBeGreaterThan(1);
      const displays = gpu.displays;
      const later = stepFrames(core, 3);
      expect(later.every((f) => f.stats['console'] === 'cpu' && !f.bitmap)).toBe(true);
      expect(gpu.displays).toBe(displays);
    },
  );
});
