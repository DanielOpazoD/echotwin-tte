// @tier slow
import { describe, expect, it } from 'vitest';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { Structure } from '@/simulator/anatomy/tissue';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { getMeasurementSpec } from './protocol';
import { simpsonBiplaneVolume } from '@/clinical/formulas';
import { cutBySectorDepth } from './simpson';

/**
 * The LA volume the protocol asks for can be measured on the images of the app (decision 180): at the end of systole,
 * in the canonical four- and two-chamber views, the atrium of the structure map cut into 20 discs along its long axis
 * and combined as the biplane method of discs gives 0.88–1.02 of the declared volume in the twelve cases at 20 cm (the
 * 0.88 is the HFrEF atrium, drawn 11 % under its declaration, `KNOWN_TRUTH_DEVIATIONS`), within the tolerance the scorer
 * uses. A single plane does not: the four-chamber one gives 1.00–1.19 of it and the two-chamber one 0.64–0.87, since
 * the atrium is wider across the four-chamber plane. At the default depth of 16 cm a dilated atrium reaches the bottom
 * of the sector (the HFrEF one measures 17 % less than at 20 cm), and the technique engine flags a traced chamber the
 * sector cuts.
 */
function atrium(caseId: string, view: string, depthCm: number) {
  const c = loadCaseById(caseId);
  const setup = new SimulatorCore(c, baseInput());
  const probe = canonicalControl(getViewTarget(view), setup.models.heart, setup.models.thorax);
  const target = setup.phaseMarks().mitralOpen - 0.02;
  setup.dispose();
  const b = baseInput({ probe, quality: 'medium' });
  const core = new SimulatorCore(c, { ...b, settings: { ...b.settings, depthCm } });
  let out = core.step(1 / 30)!;
  // frames come at the cadence: accept the one within 0.6 of a frame's phase step of the target
  const tol = 0.6 / out.cadenceHz / out.rrS;
  for (let n = 0; n < 4000 && Math.abs(out.phase - target) > tol; n++)
    out = core.step(1 / 240) ?? out;
  expect(Math.abs(out.phase - target), `${caseId} ${view} phase`).toBeLessThanOrEqual(tol);
  core.dispose();
  const p = out.polar;
  const pts: [number, number][] = [];
  for (let li = 0; li < p.lines; li++)
    for (let si = 0; si < p.samples; si++)
      if (out.structure[li * p.samples + si] === Structure.LaCavity) {
        const th = -p.sectorRad / 2 + (p.sectorRad * (li + 0.5)) / p.lines;
        const r = (p.depthCm * (si + 0.5)) / p.samples;
        pts.push([r * Math.sin(th), r * Math.cos(th)]);
      }
  return { pts, cut: cutBySectorDepth(out, [Structure.LaCavity]) };
}

/** Disc diameters along the long axis of a chamber mask, from its shallow end (the annulus) to its deep end. */
function discs(pts: [number, number][], n = 20): { diametersCm: number[]; longAxisCm: number } {
  const mx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
  const my = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.sin(a) < 0 ? -Math.cos(a) : Math.cos(a),
    uy = Math.abs(Math.sin(a));
  const t = pts.map(([x, y]) => (x - mx) * ux + (y - my) * uy);
  const s = pts.map(([x, y]) => -(x - mx) * uy + (y - my) * ux);
  let t0 = Infinity,
    t1 = -Infinity;
  for (const v of t) {
    t0 = Math.min(t0, v);
    t1 = Math.max(t1, v);
  }
  const lo = new Array<number>(n).fill(Infinity),
    hi = new Array<number>(n).fill(-Infinity);
  t.forEach((v, k) => {
    const i = Math.min(n - 1, Math.floor(((v - t0) / (t1 - t0)) * n));
    lo[i] = Math.min(lo[i]!, s[k]!);
    hi[i] = Math.max(hi[i]!, s[k]!);
  });
  return {
    diametersCm: lo.map((l, i) => (Number.isFinite(l) ? hi[i]! - l : 0)),
    longAxisCm: t1 - t0,
  };
}

function biplane(caseId: string, depthCm: number) {
  const a4c = atrium(caseId, 'a4c', depthCm),
    a2c = atrium(caseId, 'a2c', depthCm);
  const p4 = discs(a4c.pts),
    p2 = discs(a2c.pts);
  return {
    volumeMl: simpsonBiplaneVolume(
      p4.diametersCm,
      p2.diametersCm,
      Math.max(p4.longAxisCm, p2.longAxisCm),
    ),
    cut: a4c.cut || a2c.cut,
  };
}

describe('the LA volume of the images (decision 180)', () => {
  const tolerance = getMeasurementSpec('la-volume')!.tolerancePct / 100;

  it(
    'is within the scoring tolerance of every case, at a depth that holds the atrium',
    { timeout: 600_000 },
    () => {
      const off: string[] = [];
      for (const input of CASE_INPUTS) {
        const declared = computeGroundTruth(loadCaseById(input.id)).la.volumeMl;
        const b = biplane(input.id, 20);
        if (b.cut) off.push(`${input.id}: the atrium reaches the bottom of a 20 cm sector`);
        if (Math.abs(b.volumeMl / declared - 1) > tolerance)
          off.push(`${input.id}: ${b.volumeMl.toFixed(0)} mL against ${declared.toFixed(0)}`);
      }
      expect(off).toEqual([]);
    },
  );

  it(
    'flags a dilated atrium the default depth cuts, which loses a sixth of its volume',
    { timeout: 300_000 },
    () => {
      const at16 = biplane('hfref-severe-mr', 16),
        at20 = biplane('hfref-severe-mr', 20);
      expect(at16.cut).toBe(true);
      expect(at20.cut).toBe(false);
      expect(at16.volumeMl / at20.volumeMl).toBeLessThan(0.9);
      expect(biplane('normal-excellent-window', 16).cut).toBe(false);
    },
  );
});
