// @tier slow
import { describe, expect, it, vi } from 'vitest';
import { AtlasRenderer, ATLAS_PHASES } from '@/simulator/renderer/atlas/atlasRenderer';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame } from '@/simulator/renderer/types';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from './simulatorCore';
import { baseInput } from './baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { classifyHeart, computeHeartPose, heartAnchors } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure, Tissue } from '@/simulator/anatomy/tissue';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import { add, cross, normalize, scale, sub, v3 } from '@/core/vec3';

describe('rendered respiratory anatomy', () => {
  it.each(['expiration', 'free-breathing'] as const)(
    'the atlas shows the IVC of the current beat in %s',
    (respiration) => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with .call(this) below
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

  it('in free breathing it collapses by the inspiratory collapse of the case and fills again, without jumps between beats', () => {
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
  });
});
