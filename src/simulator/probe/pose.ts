import type { Quat } from '@/core/quat';
import { qFromAxisAngle, qFromBasis, qMul, qRotate } from '@/core/quat';
import type { Vec3 } from '@/core/vec3';
import { add, cross, degToRad, dot, normalize, scale, sub, v3 } from '@/core/vec3';
import { skinNormal, skinZ, type ThoraxModel } from '@/simulator/anatomy/thoraxModel';

/**
 * Probe pose model (spec 4.3, 33, 58). The user manipulates a ProbeControl (skin position u,v +
 * rotation/tilt/rock + pressure). The pose is stored as position + quaternion; the beam frame is
 * derived. `rotationDeg` = 0 means the index marker points toward the patient's right shoulder;
 * positive = clockwise as seen by the operator. `tiltDeg` fans the plane (rotation about the marker
 * axis); `rockDeg` angulates within the plane (rotation about the plane normal).
 */
export interface ProbeControl {
  u: number; // skin x (cm, patient's left positive)
  v: number; // skin y (cm, superior positive)
  rotationDeg: number;
  tiltDeg: number;
  rockDeg: number;
  pressure: number; // 0..1
}

export interface ProbePose {
  position: Vec3; // torso frame, on (or slightly into) the skin
  orientation: Quat; // local basis: right = marker/lateral (screen right), up = elevation normal, forward = beam
}

export interface BeamFrame {
  origin: Vec3;
  forward: Vec3; // beam axis into the body
  lateral: Vec3; // in-plane, toward the index marker side (= screen right)
  normal: Vec3; // plane normal (elevation)
  contact: number; // 0..1 contact quality
}

export const RIGHT_SHOULDER_DIR: Vec3 = normalize(v3(-1, 1, 0));

/** How far under the skin the probe pressure puts the beam origin (cm), along the skin normal. */
export function probeCompressionCm(pressure: number): number {
  return 0.3 + 0.5 * Math.max(0, Math.min(1, pressure));
}

export function poseFromControl(t: ThoraxModel, c: ProbeControl): ProbePose {
  const n = skinNormal(t, c.u, c.v); // outward
  const into = scale(n, -1);
  // reference marker direction projected onto tangent plane
  let m0 = sub(RIGHT_SHOULDER_DIR, scale(n, dot(RIGHT_SHOULDER_DIR, n)));
  m0 = normalize(m0);
  const up0 = cross(into, m0); // elevation normal (right-handed with right=m0, forward=into)
  const qBase = qFromBasis(m0, up0, into);
  const qRot = qFromAxisAngle(into, degToRad(c.rotationDeg));
  // marker axis after rotation
  const m1 = qRotate(qRot, m0);
  const up1 = qRotate(qRot, up0);
  const qTilt = qFromAxisAngle(m1, degToRad(c.tiltDeg));
  const up2 = qRotate(qTilt, up1);
  const qRock = qFromAxisAngle(up2, degToRad(c.rockDeg));
  const orientation = qMul(qRock, qMul(qTilt, qMul(qRot, qBase)));
  const skinPoint = v3(c.u, c.v, skinZ(t, c.u, c.v));
  const position = add(skinPoint, scale(into, probeCompressionCm(c.pressure)));
  return { position, orientation };
}

export function beamFrameFromPose(pose: ProbePose, contact = 1): BeamFrame {
  const forward = qRotate(pose.orientation, v3(0, 0, 1));
  const lateral = qRotate(pose.orientation, v3(1, 0, 0));
  const normal = qRotate(pose.orientation, v3(0, 1, 0));
  return { origin: pose.position, forward, lateral, normal, contact };
}

/** Contact quality from pressure: too little pressure = partial coupling; excess adds nothing. */
export function contactQuality(pressure: number): number {
  const p = Math.max(0, Math.min(1, pressure));
  return p < 0.35 ? p / 0.35 : 1;
}

/**
 * Solve a ProbeControl that aims the beam from skin point (u,v) at a target point with a given
 * in-plane direction (the direction that should appear as screen-right). Used to compute canonical
 * view poses from anatomy (spec 5, 50) — never to teleport the user.
 */
export function controlAimingAt(
  t: ThoraxModel,
  u: number,
  v: number,
  target: Vec3,
  screenRightDir: Vec3,
  pressure = 0.6,
): ProbeControl {
  // Iteratively fit rotation/tilt/rock: cheap coordinate descent on angle error (deterministic). The beam leaves the
  // origin the pressure pushes under the skin, not the skin point: aimed from the skin, every canonical centre line
  // missed its target by 0.16-0.40 cm (0.16-0.39 cm out of the plane), and the great-vessel short axis cut the aortic
  // cusps 1.6 mm above its coaptation target (decision 139).
  const n = skinNormal(t, u, v);
  const origin = add(v3(u, v, skinZ(t, u, v)), scale(n, -probeCompressionCm(pressure)));
  const desiredForward = normalize(sub(target, origin));
  const desiredLateral = normalize(
    sub(screenRightDir, scale(desiredForward, dot(screenRightDir, desiredForward))),
  );
  let best: ProbeControl = { u, v, rotationDeg: 0, tiltDeg: 0, rockDeg: 0, pressure };
  let bestErr = Infinity;
  const evalErr = (c: ProbeControl): number => {
    const bf = beamFrameFromPose(poseFromControl(t, c));
    const e1 = 1 - dot(bf.forward, desiredForward);
    const e2 = 1 - dot(bf.lateral, desiredLateral);
    return e1 + e2;
  };
  for (let rot = -180; rot < 180; rot += 10) {
    const c = { ...best, rotationDeg: rot };
    const e = evalErr(c);
    if (e < bestErr) {
      bestErr = e;
      best = c;
    }
  }
  const steps = [8, 4, 2, 1, 0.5, 0.25];
  for (const step of steps) {
    for (let iter = 0; iter < 6; iter++) {
      for (const key of ['rotationDeg', 'tiltDeg', 'rockDeg'] as const) {
        for (const dir of [-1, 1]) {
          const c = { ...best, [key]: best[key] + dir * step };
          const e = evalErr(c);
          if (e < bestErr) {
            bestErr = e;
            best = c;
          }
        }
      }
    }
  }
  return best;
}
