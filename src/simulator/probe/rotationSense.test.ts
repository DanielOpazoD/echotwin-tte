// @tier fast
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { cross, dot } from '@/core/vec3';
import { beamFrameFromPose, poseFromControl } from './pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { poseHints } from '@/simulator/view-recognition/viewQuality';
import { allTasks } from '@/education/curriculum';

/**
 * The words the hints use for a rotation, measured on the model instead of assumed: «horario» is clockwise as the
 * operator sees it, looking down the probe into the patient, and the apical views go A4C → A2C → A3C turning the other
 * way, as the echocardiography texts teach (decision 248).
 */
const signedTurnDeg = (
  from: { lateral: ReturnType<typeof beamFrameFromPose>['lateral'] },
  to: { lateral: ReturnType<typeof beamFrameFromPose>['lateral'] },
  into: ReturnType<typeof beamFrameFromPose>['forward'],
): number => {
  const sin = dot(cross(from.lateral, to.lateral), into);
  return (Math.atan2(sin, dot(from.lateral, to.lateral)) * 180) / Math.PI;
};

describe('rotation sense of the probe and of its hints', () => {
  const { thorax, heart } = buildCaseModels(loadCaseById('normal-excellent-window'), REST_PATIENT);

  it('a positive rotation turns the marker clockwise as the operator sees it', () => {
    const base = { u: 0, v: 0, rotationDeg: 0, tiltDeg: 0, rockDeg: 0, pressure: 0.6 };
    const b0 = beamFrameFromPose(poseFromControl(thorax, base));
    const b1 = beamFrameFromPose(poseFromControl(thorax, { ...base, rotationDeg: 30 }));
    // the operator looks along the beam: a right-handed turn about the direction one looks along is clockwise
    expect(signedTurnDeg(b0, b1, b0.forward)).toBeCloseTo(30, 1);
    // and from the front of the chest (+x the patient's left, +y the head) the marker goes from the right shoulder
    // toward the head: 10:30 → 11:30 on the clock face, clockwise
    expect(b0.lateral.x).toBeLessThan(0);
    expect(b1.lateral.y).toBeGreaterThan(b0.lateral.y);
  });

  it('from the four-chamber to the two- and three-chamber views the probe turns counterclockwise', () => {
    for (const id of ['normal-excellent-window', 'hfref-severe-mr', 'normal-difficult-window']) {
      const m = buildCaseModels(loadCaseById(id), REST_PATIENT);
      const beam = (v: string) =>
        beamFrameFromPose(
          poseFromControl(m.thorax, canonicalControl(getViewTarget(v), m.heart, m.thorax)),
        );
      const a4c = beam('a4c');
      const a2c = beam('a2c');
      const a3c = beam('a3c');
      const toA2c = signedTurnDeg(a4c, a2c, a4c.forward);
      const toA3c = signedTurnDeg(a2c, a3c, a2c.forward);
      // about 60° each, counterclockwise (negative): 64° and 56° in the normal case
      expect(toA2c, id).toBeLessThan(-45);
      expect(toA2c, id).toBeGreaterThan(-80);
      expect(toA3c, id).toBeLessThan(-40);
      expect(toA3c, id).toBeGreaterThan(-80);
    }
  });

  it('the hints say «antihorario» on the way from A4C to A2C, and a rotation hint names the turn it asks for', () => {
    const a2c = getViewTarget('a2c');
    const c2 = canonicalControl(a2c, heart, thorax);
    // 20° past the two-chamber view (clockwise): the hint turns back counterclockwise, and the other way round
    expect(
      poseHints(a2c, heart, thorax, { ...c2, rotationDeg: c2.rotationDeg + 20 }, 20, 20, 0)[0],
    ).toBe('Rota 10° en sentido antihorario.');
    expect(
      poseHints(a2c, heart, thorax, { ...c2, rotationDeg: c2.rotationDeg - 20 }, 20, 20, 0)[0],
    ).toBe('Rota 10° en sentido horario.');
    expect(a2c.hints.join(' ')).toMatch(/Desde A4C rota ~60° en sentido antihorario/);
    expect(getViewTarget('a3c').hints.join(' ')).toMatch(/Desde A2C .*antihorario/);
    expect(allTasks().find((t) => t.id === 'a2c-55')?.title).toMatch(/antihorario/);
  });
});
