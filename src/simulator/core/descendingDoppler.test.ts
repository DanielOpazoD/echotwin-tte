// @tier slow
import { it, expect } from 'vitest';
import { sceneClassifier } from '@/simulator/anatomy/sceneClassifier';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { Structure, Tissue, makeSample } from '@/simulator/anatomy/tissue';
import { classifyHeart, computeHeartPose, torsoToHeart } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';

it('PW acquires the descending aorta outside the cardiac classifier through the actual SSN beam', () => {
  const c = loadCaseById('normal-excellent-window'),
    input = baseInput({ quality: 'medium' }),
    seed = new SimulatorCore(c, input),
    { heart, thorax, tables } = seed.models;
  input.probe = canonicalControl(getViewTarget('suprasternal-arch'), heart, thorax);
  input.settings.frequencyMHz = 1.5;
  input.settings.depthCm = 20;
  seed.setInput(input);
  const frame = seed.step(0.2)!,
    b = seed.lastBeam!,
    spec = seed.lastFrame!.spec,
    ids = seed.lastFrame!.structure,
    s = makeSample(),
    hp = computeHeartPose(heart, cycleStateAt(tables, frame.phase));
  const classify = sceneClassifier({ heart, thorax, heartPose: hp });
  let best = -Infinity;
  let selected: { r: number; theta: number } | undefined;
  for (let k = 0; k < ids.length; k++)
    if (ids[k] === Structure.DescendingAorta && seed.lastFrame!.tissue[k] === Tissue.Blood) {
      const li = Math.floor(k / spec.samples),
        si = k % spec.samples,
        theta = ((li + 0.5) / spec.lines - 0.5) * spec.sectorRad,
        r = ((si + 0.5) / spec.samples) * spec.depthCm,
        ct = Math.cos(theta),
        sn = Math.sin(theta),
        p = {
          x: b.origin.x + r * (b.forward.x * ct + b.lateral.x * sn),
          y: b.origin.y + r * (b.forward.y * ct + b.lateral.y * sn),
          z: b.origin.z + r * (b.forward.z * ct + b.lateral.z * sn),
        },
        q = torsoToHeart(heart.frame, p);
      if (
        !classifyHeart(heart, hp, q.x, q.y, q.z, s) &&
        [0, 0.2, 0.4, 0.6, 0.8].every(
          (ph) =>
            !classifyHeart(
              heart,
              computeHeartPose(heart, cycleStateAt(tables, ph)),
              q.x,
              q.y,
              q.z,
              s,
            ),
        )
      ) {
        classify(p.x, p.y, p.z, s);
        if (-s.sdf > best) {
          best = -s.sdf;
          selected = { r, theta };
        }
      }
    }
  seed.dispose();
  if (!selected) throw Error('no descending target outside heart');
  input.modality = 'pw';
  input.gateDepthCm = selected.r;
  input.cursorThetaRad = selected.theta;
  input.spectral.gateLengthCm = 0.2;
  input.spectral.scaleMps = 0.6;
  input.spectral.wallFilterMps = 0.03;
  const core = new SimulatorCore(c, input);
  let gates = 0;
  let gate;
  for (let i = 0; i < 24; i++) {
    const o = core.step(0.05);
    if (o) {
      gate = o.gate;
      if (gate?.structure === Structure.DescendingAorta && gate.flowPresent) gates++;
    }
  }
  const trace = core.request({ kind: 'autoTrace', x0: 0, x1: core.spectralStrip.head - 1 });
  expect(gates).toBeGreaterThan(0);
  expect(trace?.kind).toBe('autoTrace');
  expect(
    trace?.kind === 'autoTrace' ? Math.max(...trace.velocitiesMps.map(Math.abs)) : 0,
  ).toBeGreaterThan(0.2);
  core.dispose();
});
