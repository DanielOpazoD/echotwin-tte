import type { ProbeControl } from './pose';

/** Smooth ease-in-out (cubic) on [0,1]. */
export function easeInOut(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Shortest signed angular difference b − a in degrees, in (−180, 180]. */
export function shortestArcDeg(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Interpolate two probe controls (t ∈ [0,1]); rotation follows the shortest arc. Because the pose is
 * continuous in control space, the resulting image transition is continuous too (no teleport).
 */
export function lerpControl(a: ProbeControl, b: ProbeControl, t: number): ProbeControl {
  const k = Math.max(0, Math.min(1, t));
  return {
    u: a.u + (b.u - a.u) * k,
    v: a.v + (b.v - a.v) * k,
    rotationDeg: a.rotationDeg + shortestArcDeg(a.rotationDeg, b.rotationDeg) * k,
    tiltDeg: a.tiltDeg + (b.tiltDeg - a.tiltDeg) * k,
    rockDeg: a.rockDeg + (b.rockDeg - a.rockDeg) * k,
    pressure: a.pressure + (b.pressure - a.pressure) * k,
  };
}

/** Duration (ms) proportional to the manipulation needed: translation + angles, clamped to 0.8–3.5 s. */
export function presetDurationMs(a: ProbeControl, b: ProbeControl): number {
  const dist = Math.hypot(b.u - a.u, b.v - a.v);
  const ang = Math.abs(shortestArcDeg(a.rotationDeg, b.rotationDeg)) + Math.abs(b.tiltDeg - a.tiltDeg) + Math.abs(b.rockDeg - a.rockDeg);
  return Math.max(800, Math.min(3500, 500 + dist * 220 + ang * 9));
}
