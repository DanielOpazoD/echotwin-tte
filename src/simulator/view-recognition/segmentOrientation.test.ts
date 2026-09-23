// @tier slow
import { describe, expect, it } from 'vitest';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import type { SimOutput } from '@/simulator/core/protocol';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { Structure } from '@/simulator/anatomy/tissue';
import { aha17FromCode } from '@/simulator/anatomy/lvSegments';

/**
 * Where the LV segments sit on the images of the app (decision 181): the review of the numbering made permanent, on
 * the canonical views of the twelve cases at end-diastole, through the app chain.
 *
 * The AHA segments are anatomical: the RV insertions bound the septum (ASE/EACVI 2015), so on a short-axis cut the
 * numbered septum (2 and 3, 8 and 9) must be the arc of the LV the RV touches — whatever clock position the window gives
 * it. On the long-axis views the display conventions fix the side of each wall: A4C inferoseptal left and anterolateral
 * right, A2C inferior left and anterior right, A3C inferolateral left and anteroseptal right, PLAX anteroseptal toward the
 * probe and inferolateral away from it.
 *
 * Measured when the learner found the numbering of the short axis wrong: the RV touched the LV from 9.1 to 1.3 o'clock
 * in every case and the numbered septum ran from 9.1 to 1.2–1.3, so the numbers followed the insertions; the cut was
 * turned, the RV at the top where the schematic polar map draws it on the left. Decision 182 took the papillary short
 * axis 2 cm further from the sternum, which turns the cut toward what an average patient's shows (the RV at the upper
 * left near 10 o'clock, its insertions near 12 and 8, the papillary muscles near 4 and 8): 0.69-0.80 h clockwise of it
 * in the twelve cases, where it stood 1.07-1.14 h. Turning the heart about its long axis instead moved the pulmonary
 * valve, the long axis and the apical images out of their validated ranges.
 */

interface Frame {
  out: SimOutput;
  /** LV cavity centroid, cm on the display (x right, y down from the probe). */
  cx: number;
  cy: number;
}

function frameOf(caseId: string, view: string): Frame {
  const c = loadCaseById(caseId);
  const setup = new SimulatorCore(c, baseInput());
  const probe = canonicalControl(getViewTarget(view), setup.models.heart, setup.models.thorax);
  setup.dispose();
  const core = new SimulatorCore(c, baseInput({ probe, quality: 'medium' }));
  const out = core.step(1 / 30)!;
  core.dispose();
  const p = out.polar;
  let cx = 0,
    cy = 0,
    n = 0;
  for (let li = 0; li < p.lines; li++)
    for (let si = 0; si < p.samples; si++) {
      if (out.structure[li * p.samples + si] !== Structure.LvCavity) continue;
      const th = -p.sectorRad / 2 + (p.sectorRad * (li + 0.5)) / p.lines;
      const r = (p.depthCm * (si + 0.5)) / p.samples;
      cx += r * Math.sin(th);
      cy += r * Math.cos(th);
      n++;
    }
  return { out, cx: cx / n, cy: cy / n };
}

/** Structure and AHA segment at a display point (cm). */
function at(out: SimOutput, x: number, y: number): [number, number] {
  const p = out.polar;
  const r = Math.hypot(x, y),
    th = Math.atan2(x, y);
  const li = Math.floor(((th + p.sectorRad / 2) / p.sectorRad) * p.lines);
  const si = Math.floor((r / p.depthCm) * p.samples);
  if (li < 0 || li >= p.lines || si < 0 || si >= p.samples) return [0, 0];
  const i = li * p.samples + si;
  return [out.structure[i]!, aha17FromCode(out.segment[i]!)];
}

const RV = new Set<number>([
  Structure.RvCavity,
  Structure.RvWall,
  Structure.RvPapillary,
  Structure.ModeratorBand,
]);
const SEPTUM = new Set([2, 3, 8, 9]);

/**
 * Rays every 2° from the LV centre (0 = toward the probe, clockwise on screen): the ones whose LV wall is numbered as
 * septum, and the ones where the RV lies just beyond the epicardium (past the pericardium and epicardial fat).
 */
function arcs(f: Frame): { septum: boolean[]; rv: boolean[] } {
  const septum: boolean[] = [],
    rv: boolean[] = [];
  for (let deg = 0; deg < 360; deg += 2) {
    const a = (deg * Math.PI) / 180;
    const dx = Math.sin(a),
      dy = -Math.cos(a);
    let seg = 0,
      beyond = 0,
      inWall = false;
    for (let t = 0.3; t < 5; t += 0.02) {
      const [s, g] = at(f.out, f.cx + dx * t, f.cy + dy * t);
      if (g) {
        seg = g;
        inWall = true;
        continue;
      }
      if (!inWall) continue;
      beyond = s;
      if (s !== Structure.Pericardium && s !== Structure.EpicardialFat) break;
    }
    septum.push(SEPTUM.has(seg));
    rv.push(RV.has(beyond));
  }
  return { septum, rv };
}

/** Degrees by which two sets of rays differ (a ray in one and not in the other counts 2°). */
const mismatchDeg = (a: boolean[], b: boolean[]): number =>
  2 * a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);

/** Centroid of the samples of some segments, cm on the display. */
function centroid(out: SimOutput, ids: readonly number[]): { x: number; y: number } | null {
  const p = out.polar;
  let x = 0,
    y = 0,
    n = 0;
  for (let li = 0; li < p.lines; li++)
    for (let si = 0; si < p.samples; si++) {
      if (!ids.includes(aha17FromCode(out.segment[li * p.samples + si]!))) continue;
      const th = -p.sectorRad / 2 + (p.sectorRad * (li + 0.5)) / p.lines;
      const r = (p.depthCm * (si + 0.5)) / p.samples;
      x += r * Math.sin(th);
      y += r * Math.cos(th);
      n++;
    }
  return n ? { x: x / n, y: y / n } : null;
}

/** Horizontal display position (cm) of the centroid of a structure, or null when absent. */
function structureCentroidX(out: SimOutput, structure: number): number | null {
  const p = out.polar;
  let x = 0,
    n = 0;
  for (let li = 0; li < p.lines; li++)
    for (let si = 0; si < p.samples; si++) {
      if (out.structure[li * p.samples + si] !== structure) continue;
      const th = -p.sectorRad / 2 + (p.sectorRad * (li + 0.5)) / p.lines;
      x += ((p.depthCm * (si + 0.5)) / p.samples) * Math.sin(th);
      n++;
    }
  return n ? x / n : null;
}

/**
 * Whether the segments of a ring follow each other counter-clockwise on the display — 7, 8, 9, 10, 11, 12 (or 1–6) — as
 * on the polar map, which is laid out as the short axis is displayed: the order a mirror would reverse, 8 and 9 swapped
 * across the septum with it.
 */
function counterClockwise(f: Frame, ring: readonly number[]): boolean {
  const angles: [number, number][] = [];
  for (const id of ring) {
    const c = centroid(f.out, [id]);
    // angle from up, counter-clockwise toward the screen left
    if (c) angles.push([id, Math.atan2(-(c.x - f.cx), -(c.y - f.cy))]);
  }
  if (angles.length < 4) return false;
  angles.sort((a, b) => a[1] - b[1]);
  const ids = angles.map((a) => a[0]);
  // cyclically increasing: every next id is the following one of the ring (skipping absent ones is not allowed)
  return ids.every((id, i) => {
    const next = ids[(i + 1) % ids.length]!;
    return (ring.indexOf(next) - ring.indexOf(id) + ring.length) % ring.length === 1;
  });
}

/** Circular mean of clock hours. */
function meanHour(hours: readonly number[]): number {
  let sx = 0,
    sy = 0;
  for (const h of hours) {
    sx += Math.cos((h / 12) * 2 * Math.PI);
    sy += Math.sin((h / 12) * 2 * Math.PI);
  }
  const m = ((Math.atan2(sy, sx) / (2 * Math.PI)) * 12 + 12) % 12;
  return m < 0.5 ? m + 12 : m;
}

/**
 * Where the parasternal short axis at the papillary level puts the RV, its insertions and the papillary muscles, in
 * clock hours: the RV at the mean of the rays it touches, the insertions at the ends of the longest run of them once
 * gaps of up to three rays are closed (rays that miss the RV inside the arc split it in two in one case, and the ends of
 * the longer piece read an insertion an hour off), each papillary muscle at the mean of its samples on its side of their
 * common mean.
 */
function shortAxisClock(f: Frame): {
  rv: number;
  insertions: [number, number];
  papillary: [number, number];
} {
  const { rv } = arcs(f);
  const hourOf = (i: number) => (i * 2) / 30;
  const rvHours = rv.flatMap((v, i) => (v ? [hourOf(i)] : []));
  // the longest circular run of rays that touch the RV, with gaps of up to three rays closed: going clockwise it starts
  // at the inferior insertion and ends at the anterior one
  const n = rv.length;
  const touched = rv.map((v, i) => {
    if (v) return true;
    // a ray inside a gap of at most three rays between two that touch the RV
    for (let back = 1; back <= 3; back++)
      if (rv[(i - back + n) % n])
        for (let ahead = 1; ahead <= 4 - back; ahead++) if (rv[(i + ahead) % n]) return true;
    return false;
  });
  let best = { start: 0, length: 0 };
  for (let i = 0; i < n; i++) {
    if (!touched[i] || touched[(i - 1 + n) % n]) continue;
    let length = 0;
    while (length < n && touched[(i + length) % n]) length++;
    if (length > best.length) best = { start: i, length };
  }
  const p = f.out.polar;
  const pap: number[] = [];
  for (let li = 0; li < p.lines; li++)
    for (let si = 0; si < p.samples; si++) {
      if (f.out.structure[li * p.samples + si] !== Structure.PapillaryMuscle) continue;
      const th = -p.sectorRad / 2 + (p.sectorRad * (li + 0.5)) / p.lines;
      const r = (p.depthCm * (si + 0.5)) / p.samples;
      let a = Math.atan2(r * Math.sin(th) - f.cx, -(r * Math.cos(th) - f.cy));
      if (a < 0) a += 2 * Math.PI;
      pap.push((a / (2 * Math.PI)) * 12);
    }
  const mid = meanHour(pap);
  const side = (h: number) => ((h - mid + 18) % 12) - 6;
  return {
    rv: meanHour(rvHours),
    insertions: best.length
      ? [hourOf((best.start + best.length - 1) % n), hourOf(best.start)]
      : [Number.NaN, Number.NaN],
    papillary: [
      meanHour(pap.filter((h) => side(h) < 0)),
      meanHour(pap.filter((h) => side(h) >= 0)),
    ],
  };
}

describe('the LV segments on the images of the app (decision 181)', () => {
  it(
    'number as septum the arc of a short-axis cut the RV touches, counter-clockwise, in every case',
    { timeout: 600_000 },
    () => {
      const off: string[] = [];
      for (const input of CASE_INPUTS)
        for (const view of ['psax-mv', 'psax-pm']) {
          const f = frameOf(input.id, view);
          const ring = view === 'psax-mv' ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
          if (!counterClockwise(f, ring))
            off.push(`${input.id} ${view}: the ring is not numbered counter-clockwise`);
          const { septum, rv } = arcs(f);
          const rvDeg = 2 * rv.filter(Boolean).length;
          const miss = mismatchDeg(septum, rv);
          // the insertions sit within a few degrees of the boundaries; the RV spans the septum, 120° of the ring
          if (miss > 20 || rvDeg < 100 || rvDeg > 150)
            off.push(`${input.id} ${view}: RV over ${rvDeg}°, septum and RV differ over ${miss}°`);
        }
      expect(off).toEqual([]);
    },
  );

  it(
    "turn the papillary short axis toward the average patient's: RV near 10, insertions near 12 and 8, papillary muscles near 4 and 8 (decision 182)",
    { timeout: 600_000 },
    () => {
      const off: string[] = [];
      for (const input of CASE_INPUTS) {
        const c = shortAxisClock(frameOf(input.id, 'psax-pm'));
        const [ant, inf] = c.insertions;
        const [al, pm] = c.papillary;
        // hours clockwise of where an average patient's image puts each landmark
        const turn = [c.rv - 10, ant - 12, inf - 8, al - 4, pm - 8].map((d) => ((d + 18) % 12) - 6);
        const mean = turn.reduce((a, d) => a + d, 0) / turn.length;
        // 0.69-0.80 h in the twelve cases; 1.07-1.14 from the sternal edge, 0.83-0.95 from 1.2 cm and 0.77-0.90 from
        // 1.6 cm. A landmark 1.5 h off would be another cut, not a turned one.
        if (Math.abs(mean) > 0.85 || turn.some((d) => Math.abs(d) > 1.5))
          off.push(
            `${input.id}: turned ${mean.toFixed(2)} h; RV ${c.rv.toFixed(1)}, insertions ${ant.toFixed(1)} and ${inf.toFixed(1)}, papillary ${al.toFixed(1)} and ${pm.toFixed(1)} o'clock`,
          );
      }
      expect(off).toEqual([]);
    },
  );

  it(
    'put each wall of the long-axis views on the side the display convention gives it',
    { timeout: 600_000 },
    () => {
      const off: string[] = [];
      // [view, walls expected left of (or, for PLAX, nearer the probe than) the LV centre, walls on the other side]
      const sides: [string, number[], number[]][] = [
        ['a4c', [3, 9], [6, 12]],
        ['a2c', [4, 10], [1, 7]],
        ['a3c', [5, 11], [2, 8]],
        ['plax', [2, 8], [5, 11]],
      ];
      for (const input of CASE_INPUTS)
        for (const [view, first, second] of sides) {
          const f = frameOf(input.id, view);
          const a = centroid(f.out, first),
            b = centroid(f.out, second);
          if (!a || !b) {
            off.push(`${input.id} ${view}: a wall is missing`);
            continue;
          }
          const ok = view === 'plax' ? a.y < f.cy && b.y > f.cy : a.x < f.cx && b.x > f.cx;
          if (!ok)
            off.push(
              `${input.id} ${view}: ${first.join('/')} at (${a.x.toFixed(1)}, ${a.y.toFixed(1)}), ${second.join('/')} at (${b.x.toFixed(1)}, ${b.y.toFixed(1)}), LV centre (${f.cx.toFixed(1)}, ${f.cy.toFixed(1)})`,
            );
          // and the RV on the septal side of the four-chamber view
          if (view === 'a4c') {
            const rvX = structureCentroidX(f.out, Structure.RvCavity);
            if (rvX === null || rvX > f.cx)
              off.push(`${input.id} a4c: the RV is not left of the LV`);
          }
        }
      expect(off).toEqual([]);
    },
  );
});
