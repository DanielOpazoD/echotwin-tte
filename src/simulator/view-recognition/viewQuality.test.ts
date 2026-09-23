// @tier slow
import { describe, expect, it } from 'vitest';
import { analyzeView } from './viewQuality';
import { normalExcellentCase } from '@/cases/normal-excellent';
import { validateCase } from '@/cases/schema';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { beamFrameFromPose, poseFromControl, type ProbeControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget, VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';

const c = validateCase(normalExcellentCase).case!;
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
});
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const renderer = new ProceduralSliceRenderer();
const settings = { ...DEFAULT_ACQUISITION };
const spec = polarSpecFor(settings, 'low');

function analyze(control: ProbeControl) {
  const beam = beamFrameFromPose(poseFromControl(thorax, control), 1);
  const scene: Scene = {
    heart,
    heartPose: computeHeartPose(heart, cycleStateAt(tables, 0.05)),
    thorax,
    physics: {
      frequencyMHz: 2.5,
      harmonics: true,
      clutterLevel: 0.1,
      windowAttenuation: 0.1,
      seed: 1,
    },
  };
  const frame = allocPolarFrame(spec);
  renderer.render(scene, beam, spec, 0.05, frame);
  const display = new Uint8ClampedArray(spec.lines * spec.samples);
  applyConsole(frame, settings, createConsoleState(1), display);
  return analyzeView({ heart, thorax, control, beam, frame, display, settings });
}

describe('view quality engine', () => {
  it('canonical PLAX scores high and is recognised as PLAX', () => {
    const a = analyze(canonicalControl(getViewTarget('plax'), heart, thorax));
    expect(a.bestViewId).toBe('plax');
    expect(a.score).toBeGreaterThan(70);
    expect(a.visibleLandmarks).toContain('mv');
    expect(a.visibleLandmarks).toContain('la');
  });
  it('canonical PSAX levels are recognised, and the PLAX→PSAX path degrades gradually (no jumps)', () => {
    const plax = canonicalControl(getViewTarget('plax'), heart, thorax);
    const psax = canonicalControl(getViewTarget('psax-mv'), heart, thorax);
    const end = analyze(psax);
    expect(end.bestViewId).toBe('psax-mv');
    // the landmarks of its own level (decision 164): with those of the mid ventricle it saw only the mitral valve (69)
    expect(end.score).toBeGreaterThan(85);
    expect(end.visibleLandmarks).toEqual(expect.arrayContaining(['mv', 'rv-basal']));
    const pm = analyze(canonicalControl(getViewTarget('psax-pm'), heart, thorax));
    expect(pm.bestViewId).toBe('psax-pm');
    const ap = analyze(canonicalControl(getViewTarget('psax-apex'), heart, thorax));
    expect(ap.bestViewId).toBe('psax-apex');
    expect(ap.score).toBeGreaterThan(55);
    const scores: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const ctrl = {
        u: plax.u + (psax.u - plax.u) * t,
        v: plax.v + (psax.v - plax.v) * t,
        rotationDeg: plax.rotationDeg + (psax.rotationDeg - plax.rotationDeg) * t,
        tiltDeg: plax.tiltDeg + (psax.tiltDeg - plax.tiltDeg) * t,
        rockDeg: plax.rockDeg + (psax.rockDeg - plax.rockDeg) * t,
        pressure: 0.6,
      };
      scores.push(analyze(ctrl).score);
    }
    for (let i = 1; i < scores.length; i++)
      expect(Math.abs((scores[i] ?? 0) - (scores[i - 1] ?? 0))).toBeLessThan(45);
    expect(scores[0]).toBeGreaterThan(70);
    expect(scores[scores.length - 1]).toBeGreaterThan(60);
  });
  it('canonical A4C: apex visible, low foreshortening; a lifted probe foreshortens', () => {
    const a4c = canonicalControl(getViewTarget('a4c'), heart, thorax);
    const a = analyze(a4c);
    expect(a.bestViewId).toBe('a4c');
    expect(a.score).toBeGreaterThan(65);
    // 18, not 15: with the heart placed BEHIND the chest wall instead of inside it (decision 66) the apical
    // window this thorax offers cuts the long axis at 16.4°. Sliding the probe further does not help — it
    // makes it worse (16.7° at 2.3 cm, and at 2.8 cm the view is recognised as subcostal) — because the
    // foreshortening comes from the plane angle, not from missing the apex. The number is a property of the
    // thorax geometry, recorded in docs/LIMITATIONS.md rather than hidden by moving the heart back.
    expect(a.foreshorteningDeg).toBeLessThan(18);
    const fs = analyze({ ...a4c, v: a4c.v + 1.8, tiltDeg: a4c.tiltDeg - 12 });
    expect(fs.foreshorteningDeg).toBeGreaterThan(a.foreshorteningDeg);
  });
  it('off-window pose has no useful view and produces a hint', () => {
    const a = analyze({ u: -9, v: 4, rotationDeg: 0, tiltDeg: 0, rockDeg: 0, pressure: 0.6 });
    expect(a.window).toBe('none');
    expect(a.score).toBe(0);
    expect(a.hints.length).toBeGreaterThan(0);
  });
  it('an oblique PLAX gets manipulation hints that mention rotate/tilt/rock', () => {
    const plax = canonicalControl(getViewTarget('plax'), heart, thorax);
    const a = analyze({ ...plax, rotationDeg: plax.rotationDeg + 25 });
    expect(a.score).toBeLessThan(analyze(plax).score);
    expect(a.hints.join(' ')).toMatch(/Rota|Inclina|Rockea|Desliza/);
  });
  // Decision 73: the gain check is calibrated on CAMUS apical images rated Good. Its old threshold — blood above 22% of
  // white is overgain — came from textbook anechoic blood and put the gain hint on the clinically calibrated default
  // console. Measured through the simulator core, as the app shows it: the static analysis above, with other seeds,
  // phase and no frame history, did not reproduce the regression (the old check passed there).
  it(
    'gain hints follow clinical optimal-window images: none at the default console, overgain at +18 dB, undergain at −18 dB in apical views',
    { timeout: 240_000 },
    () => {
      const c0 = loadCaseById('normal-excellent-window');
      const models = new SimulatorCore(c0, baseInput()).models;
      const gainHint = (id: string, gainDb: number): string => {
        const probe = canonicalControl(getViewTarget(id), models.heart, models.thorax);
        const core = new SimulatorCore(
          c0,
          baseInput({
            probe,
            quality: 'medium',
            settings: { ...DEFAULT_ACQUISITION, tgcDb: [...DEFAULT_ACQUISITION.tgcDb], gainDb },
          }),
        );
        for (let i = 0; i < 8; i++) core.step(1 / 30);
        const h = core.lastView?.hints.find((t) => /ganancia/i.test(t)) ?? '';
        return h.startsWith('Exceso') ? 'over' : h ? 'under' : 'none';
      };
      const ids = VIEW_TARGETS.map((v) => v.id);
      expect(ids.map((id) => `${id}:${gainHint(id, 0)}`)).toEqual(ids.map((id) => `${id}:none`));
      // +18 dB since the receiver's noise floor follows the focused beam (decision 144): the apical cavity reads 50 at the
      // default console and 81–87 at +12 dB, at the clinical fence (p90 84–89) rather than beyond it, and the shallow
      // short-axis cavities, darker still, cross it between +15 and +18 dB (gain component 0.72 → 0.52)
      expect(ids.map((id) => `${id}:${gainHint(id, 18)}`)).toEqual(ids.map((id) => `${id}:over`));
      const apical = ['a4c', 'a5c', 'a2c', 'a3c'];
      expect(apical.map((id) => `${id}:${gainHint(id, -18)}`)).toEqual(
        apical.map((id) => `${id}:under`),
      );
    },
  );
});
