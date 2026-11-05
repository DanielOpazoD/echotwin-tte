// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { torsoToHeart } from '@/simulator/anatomy/heartFrame';
import { classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl, type ProbeControl } from '@/simulator/probe/pose';

const PATIENT = {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
} as const;

/** Daniel's five-chamber view of decisions 385-387. */
const MARKED: ProbeControl = {
  u: 9.4519,
  v: -5.6626,
  rotationDeg: 164,
  tiltDeg: 18,
  rockDeg: -38,
  pressure: 0.6,
};

/**
 * Above the atrioventricular groove the left atrium's wall meets the pericardium without fat between them (decision 387).
 * The blend of the ventricles' epicardium with the atria's filled the groove with fat, and above it, where the left
 * ventricle's cap kept beside the root (decision 380) lay 1-2 mm from the atrial wall, filled that space too: in the
 * five-chamber view Daniel marked, a band of fat 1 mm thick under the atrium on 10-11 of the beams that cross it, at
 * end-diastole and at 0.15 of the cycle. On beams 0.25° apart across the sector, the first 3 mm past the atrium's blood
 * hold a band of epicardial fat at least MIN_BAND_CM thick, more than GROOVE_CM above the annular plane, on at most
 * MAX_BEAMS; what is left, where the atrial wall and the ventricle's cap nearly touch, is 0.1-0.3 mm.
 */
const MAX_BEAMS = 3;
/** How far (cm) above the annular plane the groove reaches: its fat, beside the lateral wall, stays. */
const GROOVE_CM = 1.2;
/** The thinnest band (cm) the image draws: the trace samples every 0.5 mm. */
const MIN_BAND_CM = 0.05;

describe('no band of fat lies under the left atrium above the atrioventricular groove (decision 387)', () => {
  for (const phase of [0, 0.15])
    it(`in the marked five-chamber view @${phase}`, () => {
      const { heart, thorax, tables } = buildCaseModels(
        loadCaseById('normal-excellent-window'),
        PATIENT,
      );
      const beam = beamFrameFromPose(poseFromControl(thorax, MARKED), 1);
      const hp = computeHeartPose(heart, cycleStateAt(tables, phase));
      const s = makeSample();
      let above = 0;
      const at = (d: number, a: number) => {
        const u = d * Math.sin(a),
          dd = d * Math.cos(a);
        const h = torsoToHeart(heart.frame, {
          x: beam.origin.x + beam.forward.x * dd + beam.lateral.x * u,
          y: beam.origin.y + beam.forward.y * dd + beam.lateral.y * u,
          z: beam.origin.z + beam.forward.z * dd + beam.lateral.z * u,
        });
        above = hp.zAnn - h.z;
        return classifyHeart(heart, hp, h.x + hp.swingX, h.y, h.z, s) ? s.structure : -1;
      };
      let crossing = 0;
      const fat: string[] = [];
      for (let deg = -40; deg <= 40; deg += 0.25) {
        const a = (deg * Math.PI) / 180;
        let last = NaN;
        for (let d = 8; d < 17; d += 0.05) if (at(d, a) === Structure.LaCavity) last = d;
        if (Number.isNaN(last)) continue;
        crossing++;
        let run = 0;
        for (let d = last + 0.025; d <= last + 0.3; d += 0.025)
          if (at(d, a) === Structure.EpicardialFat && above > GROOVE_CM) run += 0.025;
        if (run >= MIN_BAND_CM) fat.push(`${deg}° (${(run * 10).toFixed(2)} mm)`);
      }
      expect(crossing).toBeGreaterThan(30);
      expect(fat.length, fat.join(', ')).toBeLessThanOrEqual(MAX_BEAMS);
    });
});
