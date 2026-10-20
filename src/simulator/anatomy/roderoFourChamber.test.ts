// @tier slow
/**
 * The Rodero heart's four-chamber plane (decision 359): declared on the analytic heart, it cut the CT heart in front of
 * its crux, with 17–21 mm of ventricular septum and pericardial space between the atria under the annuli where an
 * interatrial septum stands; turned through the volume's own crux, the atria meet at a septum.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { add, dot, scale, sub, type Vec3 } from '@/core/vec3';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl, type ProbeControl } from '@/simulator/probe/pose';
import {
  canonicalControl,
  controlThroughCrux,
  getViewTarget,
} from '@/simulator/windows/viewTargets';
import { buildCaseModels, REST_PATIENT } from './caseModels';
import { heartToTorso } from './heartFrame';
import { computeHeartPose } from './heartModel';
import { loadRoderoVolume } from './roderoAsset';
import { sceneClassifier } from './sceneClassifier';
import { makeSample, Structure } from './tissue';
import { volumeHeart } from './volumeHeart';

const fromPublic = (path: string): Promise<ArrayBuffer> => {
  const b = readFileSync(join(process.cwd(), 'public', path));
  return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

describe('the Rodero four-chamber plane (decision 359)', async () => {
  const { heart, thorax, tables } = buildCaseModels(
    loadCaseById('normal-excellent-window'),
    REST_PATIENT,
  );
  const ed = computeHeartPose(heart, cycleStateAt(tables, 0));
  const vh = volumeHeart(await loadRoderoVolume(fromPublic), heart, ed);
  const c = vh.crux();
  const crux: Vec3 = { x: c[0], y: c[1], z: c[2] };
  const cruxT = heartToTorso(heart.frame, crux);
  const classify = sceneClassifier({
    heart,
    heartPose: ed,
    thorax,
    heartClassifier: vh.classifier({ apparatus: ed }),
  });
  /** The narrowest run of anything but blood between the RA and the LA cavity, across the plane `below` cm under the crux (mm). */
  const septumBelowCrux = (control: ProbeControl, below: number): number => {
    const b = beamFrameFromPose(poseFromControl(thorax, control), 1);
    const depth = dot(sub(cruxT, b.origin), b.forward) + below;
    const q = makeSample();
    let best = Infinity,
      lastRa = -Infinity;
    for (let x = -4; x <= 4; x += 0.025) {
      const p = add(add(b.origin, scale(b.forward, depth)), scale(b.lateral, x));
      classify(p.x, p.y, p.z, q);
      if (q.structure === Structure.RaCavity) lastRa = x;
      else if (q.structure === Structure.LaCavity) {
        if (lastRa > -Infinity) best = Math.min(best, (x - lastRa) * 10);
        lastRa = -Infinity;
      }
    }
    return best;
  };

  it('lies between both atria, by the atrioventricular junction', () => {
    const q = makeSample();
    // around the crux, within 1 cm, both atria
    const seen = new Set<Structure>();
    for (const d of [-1, -0.5, 0.5, 1])
      for (const axis of [
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
      ]) {
        const p = heartToTorso(heart.frame, add(crux, scale(axis, d)));
        classify(p.x, p.y, p.z, q);
        seen.add(q.structure);
      }
    expect(seen.has(Structure.LaCavity) && seen.has(Structure.RaCavity)).toBe(true);
  });

  it('turns the four-chamber plane through it, and the atria meet at a septum', () => {
    const view = getViewTarget('a4c');
    const declared = canonicalControl(view, heart, thorax);
    const turned = controlThroughCrux(view, heart, thorax, crux);
    // at the crux's depth: 18.5 mm declared, 7.0 turned (0.5 cm deeper, 9.0 and 6.75)
    expect(septumBelowCrux(declared, 0)).toBeGreaterThan(15);
    expect(septumBelowCrux(turned, 0)).toBeLessThan(8);
  });
});
