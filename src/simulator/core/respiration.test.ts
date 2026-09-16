// @tier slow
import { describe, expect, it, vi } from 'vitest';
import { AtlasRenderer, ATLAS_PHASES } from '@/simulator/renderer/atlas/atlasRenderer';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame } from '@/simulator/renderer/types';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import {
  classifyHeart,
  computeHeartPose,
  heartAnchors,
  heartToTorso,
} from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import { DEFAULT_SPECTRAL } from '@/simulator/doppler/spectral/spectrum';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import { add, cross, dot, normalize, scale, sub, v3, type Vec3 } from '@/core/vec3';

describe('rendered respiratory anatomy', () => {
  it.each(['expiration', 'free-breathing'] as const)(
    'the atlas shows the IVC of the current beat in %s',
    (respiration) => {
      const render = AtlasRenderer.prototype.render;
      const schedule = vi.spyOn(AtlasRenderer.prototype, 'render').mockImplementation(function (
        this: AtlasRenderer,
        sc,
        b,
        sp,
        ph,
        out,
        hints,
      ) {
        return render.call(this, sc, b, sp, ph, out, { ...hints, stationary: true, budgetMs: 0 });
      });
      try {
        const c = loadCaseById('normal-excellent-window'),
          input = baseInput({ rendererBackend: 'atlas' });
        input.patient = { ...input.patient, position: 'subcostal-supine', respiration };
        const core = new SimulatorCore(c, input);
        input.probe = canonicalControl(
          getViewTarget('subcostal-ivc'),
          core.models.heart,
          core.models.thorax,
        );
        core.setInput(input);
        const reference = new ProceduralSliceRenderer();
        let compared = 0,
          cacheHits = 0;
        const errors: number[] = [];
        for (let i = 0; i < 96; i++) {
          const out = core.step(1 / 30);
          if (!out) continue;
          const f = core.lastFrame!;
          if (out.stats['served'] === 'cache') cacheHits++;
          if (out.beatIndex > 0) {
            const phase =
              out.stats['mode'] === 'cache'
                ? (Math.round(out.phase * ATLAS_PHASES) % ATLAS_PHASES) / ATLAS_PHASES
                : out.phase;
            const frame = allocPolarFrame(f.spec);
            reference.render(
              {
                heart: core.models.heart,
                thorax: core.models.thorax,
                heartPose: computeHeartPose(
                  core.models.heart,
                  cycleStateAt(core.models.tables, phase),
                ),
                physics: {
                  frequencyMHz: input.settings.frequencyMHz,
                  harmonics: input.settings.harmonics,
                  seed: c.seed,
                  clutterLevel: c.acousticWindow.clutterLevel,
                  windowAttenuation: c.acousticWindow.chestWallAttenuation,
                },
              },
              core.lastBeam!,
              f.spec,
              phase,
              frame,
            );
            let mismatch = 0,
              ivc = 0;
            for (let j = 0; j < f.structure.length; j++) {
              const actual = f.structure[j] === Structure.Ivc,
                expected = frame.structure[j] === Structure.Ivc;
              if (actual !== expected) mismatch++;
              if (expected) ivc++;
            }
            expect(ivc, 'the acquired plane must contain the IVC').toBeGreaterThan(20);
            errors.push(mismatch);
            compared++;
          }
          core.recycle(out.rgba);
        }
        expect(compared).toBeGreaterThan(20);
        if (respiration === 'expiration') expect(cacheHits).toBeGreaterThan(20);
        expect(
          Math.max(...errors),
          'cached IVC geometry must match the current respiratory beat',
        ).toBe(0);
      } finally {
        schedule.mockRestore();
      }
    },
  );
});

/**
 * Respiratory variation of the inflows through the core (decision 108): the pulsed Doppler auto-trace in time order, split
 * into beats at the phase wraps of its columns, peak velocity per beat over three breaths.
 */
describe('free breathing through the core (decision 108)', () => {
  const peaks = (
    id: string,
    respiration: PatientState['respiration'],
    tricuspid: boolean,
  ): number[] => {
    const c = loadCaseById(id);
    const models = new SimulatorCore(c, baseInput()).models;
    const A = heartAnchors(models.heart);
    const gate: Vec3 = tricuspid
      ? v3(A.tvCenter.x, A.tvCenter.y, A.tvCenter.z + 1.5)
      : v3(0.2, -0.9, 1.7);
    const control = canonicalControl(getViewTarget('a4c'), models.heart, models.thorax);
    const beam = beamFrameFromPose(poseFromControl(models.thorax, control));
    const d = sub(heartToTorso(models.heart.frame, gate), beam.origin);
    const spectral = { ...DEFAULT_SPECTRAL, scaleMps: 1.2, sweepSpeedMmPerS: 25 };
    const core = new SimulatorCore(
      c,
      baseInput({
        patient: { ...baseInput().patient, respiration },
        probe: control,
        modality: 'pw',
        quality: 'low',
        display: { width: 640, height: 480 },
        cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
        gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
        spectral,
      }),
    );
    const cols: { t: number; ph: number; v: number }[] = [];
    let now = 0;
    for (let snap = 0; snap < 4; snap++) {
      for (let s = 0; s < 3.8; s += 0.02) {
        core.step(0.02);
        now += 0.02;
      }
      const st = core.spectralStrip;
      const n = Math.min(st.head, st.cols);
      const trace = core.request({ kind: 'autoTrace', x0: 0, x1: n - 1 });
      const vel = trace?.kind === 'autoTrace' ? trace.velocitiesMps : [];
      const head = st.head % st.cols;
      for (let j = 0; j < n; j++) {
        const x = n < st.cols ? j : (head + j) % st.cols;
        cols.push({ t: now - ((n - j) * 4) / st.cols, ph: st.phase[x]!, v: vel[x] ?? 0 });
      }
    }
    cols.sort((a, b) => a.t - b.t);
    const out: number[] = [];
    let start = -1;
    for (let i = 1; i < cols.length; i++) {
      if (cols[i]!.t - cols[i - 1]!.t < 1e-6 || cols[i]!.ph > cols[i - 1]!.ph - 0.5) continue;
      if (start >= 0) {
        let pk = 0;
        for (let k = start; k < i; k++) pk = Math.max(pk, cols[k]!.v);
        if (pk > 0.1) out.push(pk);
      }
      start = i;
    }
    return out;
  };
  const fall = (p: number[]) => (Math.max(...p) - Math.min(...p)) / Math.max(...p);
  const rise = (p: number[]) => (Math.max(...p) - Math.min(...p)) / Math.min(...p);

  it(
    'in tamponade the mitral E falls more than 30% with inspiration and the tricuspid E rises more than 60%',
    { timeout: 600_000 },
    () => {
      const mitral = peaks('pericardial-effusion-tamponade', 'free-breathing', false);
      const tricuspid = peaks('pericardial-effusion-tamponade', 'free-breathing', true);
      expect(mitral.length).toBeGreaterThan(15);
      // before: the tables were the same in every beat whatever the breathing
      expect(fall(mitral), mitral.map((v) => v.toFixed(2)).join(' ')).toBeGreaterThan(0.3);
      expect(fall(mitral)).toBeLessThan(0.45);
      expect(rise(tricuspid), tricuspid.map((v) => v.toFixed(2)).join(' ')).toBeGreaterThan(0.6);
    },
  );

  it(
    'a normal heart varies within the normal limits, and holding the breath does not vary',
    { timeout: 600_000 },
    () => {
      const mitral = peaks('normal-excellent-window', 'free-breathing', false);
      // normal respiratory variation of the mitral E: 95% limits 6–26%
      expect(fall(mitral), mitral.map((v) => v.toFixed(2)).join(' ')).toBeGreaterThan(0.06);
      expect(fall(mitral)).toBeLessThan(0.26);
      expect(rise(peaks('normal-excellent-window', 'free-breathing', true))).toBeLessThan(0.3);
      expect(fall(peaks('normal-excellent-window', 'expiration', false))).toBeLessThan(0.05);
    },
  );
});

describe('the inferior vena cava follows the breathing (decision 113)', () => {
  /** IVC diameter (cm) across the middle of the vessel, every 0.1 s of the core's clock for 10 s. */
  const diameters = (id: string, respiration: PatientState['respiration']): number[] => {
    const c = loadCaseById(id);
    const core = new SimulatorCore(
      c,
      baseInput({ patient: { ...baseInput().patient, respiration }, quality: 'low' }),
    );
    const heart = core.models.heart;
    const A = heartAnchors(heart);
    const mid = scale(add(A.ivcA, A.ivcB), 0.5);
    const across = normalize(cross(normalize(sub(A.ivcB, A.ivcA)), v3(1, 0, 0)));
    const s = makeSample();
    const out: number[] = [];
    for (let k = 0; k < 100; k++) {
      core.step(0.1);
      const pose = computeHeartPose(heart, cycleStateAt(core.models.tables, core.currentPhase));
      const inside = (t: number): boolean => {
        const p = add(mid, scale(across, t));
        return (
          classifyHeart(heart, pose, p.x + pose.swingX, p.y, p.z, s) &&
          s.structure === Structure.Ivc &&
          s.tissue === Tissue.Blood
        );
      };
      let a = 0,
        b = 0;
      while (a > -3 && inside(a - 0.01)) a -= 0.01;
      while (b < 3 && inside(b + 0.01)) b += 0.01;
      out.push(b - a);
    }
    return out;
  };
  const collapse = (d: number[]) => (Math.max(...d) - Math.min(...d)) / Math.max(...d);
  const largestStep = (d: number[]) =>
    d.slice(1).reduce((m, x, i) => Math.max(m, Math.abs(x - d[i]!)), 0);

  it(
    'in free breathing it collapses by the inspiratory collapse of the case and fills again, without jumps between beats',
    { timeout: 300_000 },
    () => {
      // The anatomy stayed in expiration while breathing freely (decision 108): the diameter did not change, and an IVC
      // collapsibility could not be measured. The case gives the inspiratory collapse (70% normal, 20% pulmonary hypertension).
      for (const [id, pct] of [
        ['normal-excellent-window', 70],
        ['pulmonary-hypertension-rv', 20],
      ] as const) {
        const d = diameters(id, 'free-breathing');
        const report = `${id}: ${d.map((x) => x.toFixed(2)).join(' ')}`;
        expect(collapse(d), report).toBeGreaterThan(pct / 100 - 0.08);
        expect(collapse(d), report).toBeLessThan(pct / 100 + 0.08);
        // 0.1 s apart the calibre moves by what the breath gives it, not by a step at each beat
        expect(largestStep(d), report).toBeLessThan(0.12);
      }
      expect(collapse(diameters('normal-excellent-window', 'expiration'))).toBeLessThan(0.02);
    },
  );
});
