import { describe, expect, it } from 'vitest';
import { analyzeView } from './viewQuality';
import { normalExcellentCase } from '@/cases/normal-excellent';
import { validateCase } from '@/cases/schema';
import { createHeartModel, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { allocPolarFrame, DEFAULT_ACQUISITION, polarSpecFor, type Scene } from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { beamFrameFromPose, poseFromControl, type ProbeControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';

const c = validateCase(normalExcellentCase).case!;
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
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
    physics: { frequencyMHz: 2.5, harmonics: true, clutterLevel: 0.1, windowAttenuation: 0.1, seed: 1 },
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
    expect(end.score).toBeGreaterThan(60);
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
    for (let i = 1; i < scores.length; i++) expect(Math.abs((scores[i] ?? 0) - (scores[i - 1] ?? 0))).toBeLessThan(45);
    expect(scores[0]).toBeGreaterThan(70);
    expect(scores[scores.length - 1]).toBeGreaterThan(60);
  });
  it('canonical A4C: apex visible, low foreshortening; a lifted probe foreshortens', () => {
    const a4c = canonicalControl(getViewTarget('a4c'), heart, thorax);
    const a = analyze(a4c);
    expect(a.bestViewId).toBe('a4c');
    expect(a.score).toBeGreaterThan(65);
    expect(a.foreshorteningDeg).toBeLessThan(15);
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
});
