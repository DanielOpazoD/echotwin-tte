import type { SimOutput } from '@/simulator/core/protocol';
import type { Measurement } from '@/simulator/measurements/types';
import { getMeasurementSpec, type MeasurementSpec } from '@/simulator/measurements/protocol';
import { cutBySectorDepth } from '@/simulator/measurements/simpson';
import { evaluateTechnique, type MeasurementContext } from '@/education/technique';
import { pixelToPolar } from '@/simulator/renderer/scanConvert';
import type { PhaseMarks } from '@/simulator/core/protocol';

/**
 * Builds the technique context of a measurement from the frame it was taken on (structure map,
 * gate info, view analysis, phase) and evaluates it against the protocol spec. Pure: no store access.
 */
export function structureAtPixel(hud: SimOutput, x: number, y: number): number {
  const m = hud.sector;
  if (y >= m.height || hud.structure.length === 0) return 0;
  const { rCm, thetaRad } = pixelToPolar(m, x, y);
  const p = hud.polar;
  if (rCm < 0 || rCm > p.depthCm || Math.abs(thetaRad) > p.sectorRad / 2) return 0;
  const li = Math.min(
    p.lines - 1,
    Math.max(0, Math.floor(((thetaRad + p.sectorRad / 2) / p.sectorRad) * p.lines)),
  );
  const si = Math.min(p.samples - 1, Math.max(0, Math.floor((rCm / p.depthCm) * p.samples)));
  return hud.structure[li * p.samples + si] ?? 0;
}

/** Structures sampled along a display-space segment (n samples) and just beyond each end. */
export function segmentStructures(
  hud: SimOutput,
  a: { x: number; y: number },
  b: { x: number; y: number },
  n = 24,
): { along: number[]; ends: [number, number] } {
  const along: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    along.push(structureAtPixel(hud, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
  }
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / L,
    uy = (b.y - a.y) / L;
  const beyond = 3; // px
  return {
    along,
    ends: [
      structureAtPixel(hud, a.x - ux * beyond, a.y - uy * beyond),
      structureAtPixel(hud, b.x + ux * beyond, b.y + uy * beyond),
    ],
  };
}

/** Structures sampled inside a closed contour (grid samples within its bounding box, point-in-polygon). */
export function contourStructures(
  hud: SimOutput,
  pts: { x: number; y: number }[],
  grid = 14,
): number[] {
  if (pts.length < 3) return [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const out: number[] = [];
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = minX + ((i + 0.5) / grid) * (maxX - minX);
      const y = minY + ((j + 0.5) / grid) * (maxY - minY);
      if (pointInPolygon(x, y, pts)) out.push(structureAtPixel(hud, x, y));
    }
  }
  return out;
}

export function pointInPolygon(x: number, y: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!,
      b = pts[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface CaptureExtras {
  segment?: [{ x: number; y: number }, { x: number; y: number }];
  contour?: { x: number; y: number }[];
  longAxisCm?: number;
  trueLongAxisCm?: number | null;
  userAssisted?: boolean;
}

/** Technique evaluation for a measurement taken on `hud`; null when the measurement has no protocol id. */
export function evaluateCapture(
  spec: MeasurementSpec | undefined,
  hud: SimOutput,
  modality: string,
  phaseMarks: PhaseMarks | null,
  extras: CaptureExtras,
): Measurement['technique'] {
  if (!spec) return null;
  const ctx: MeasurementContext = {
    modality,
    viewId: hud.view?.bestViewId ?? null,
    viewScore: hud.view?.score ?? null,
    phase: hud.phase,
    phaseMarks,
    gate: hud.gate,
    userAssisted: extras.userAssisted,
  };
  if (extras.segment) {
    const s = segmentStructures(hud, extras.segment[0], extras.segment[1]);
    ctx.segmentStructures = s.along;
    ctx.segmentEndsOutside = s.ends;
  }
  if (extras.contour) ctx.segmentStructures = contourStructures(hud, extras.contour);
  if (spec.tool === 'simpson' && spec.placement)
    ctx.cutByDepth = cutBySectorDepth(hud, spec.placement.structures);
  if (extras.longAxisCm !== undefined) ctx.longAxisCm = extras.longAxisCm;
  if (extras.trueLongAxisCm) ctx.trueLongAxisCm = extras.trueLongAxisCm;
  return evaluateTechnique(spec, ctx);
}

export function specFor(id: string | null): MeasurementSpec | undefined {
  return id ? getMeasurementSpec(id) : undefined;
}
