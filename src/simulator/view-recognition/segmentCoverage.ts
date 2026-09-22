import { aha17FromCode, lv16FromCode } from '@/simulator/anatomy/lvSegments';
import { classifyHeart, type HeartModel, type HeartPose } from '@/simulator/anatomy/heartModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import type { BeamFrame } from '@/simulator/probe/pose';
import { TRANSMISSION_FLOOR } from '@/simulator/renderer/acoustic/acoustics';
import type { PolarFrame } from '@/simulator/renderer/types';

/**
 * Which LV segments the drawn frame shows, and how well (decision 152). The labels come from the tissue the beam
 * actually crosses — the per-sample segment code the classifier wrote into the frame — so an oblique or foreshortened
 * cut gets the segments it cuts, not those of the view it resembles.
 *
 * The states of the segmentation guide's contract, kept apart:
 *  - in the plane: the plane crosses the segment's compact myocardium (more than a boundary sliver). The frame labels
 *    every sample the beam reaches; behind the pleura it only knows «lung», so there the plane is classified apart
 *    (`hiddenSegmentCodes`), and a wall the lung hides is in the plane but not insonified;
 *  - insonified: the beam reaches most of that tissue, i.e. it is not behind the lung nor extinguished behind bone,
 *    calcium or a lost contact (the renderer's transmission is above its floor). A weak but present echo is still insonified: the
 *    difficult window leaves the whole heart 30–50 dB under a thin chest's and its walls are still seen;
 *  - assessable: in the plane, insonified, long enough to judge its thickening and, when the displayed image is given,
 *    with its myocardium visibly brighter than the LV cavity (the endocardial border can be followed).
 * The thresholds are model choices, not clinical criteria; `reason` says why a segment is not assessable.
 */
export type SegmentCoverageModel = 'LV_AHA17' | 'LV_16';
export type CoverageReason =
  'not_in_plane' | 'shadowed' | 'insufficient_extent' | 'insufficient_border_visibility';

export interface SegmentCoverage {
  model: SegmentCoverageModel;
  segmentId: number;
  inPlane: boolean;
  insonified: boolean;
  assessable: boolean;
  reason: CoverageReason | null;
  /** Area of the segment's compact myocardium in the plane (cm²). */
  areaCm2: number;
  /** Fraction of that area the beam reaches (0–1; 0 when not in the plane). */
  insonifiedFraction: number;
  /** Length of the segment's section along its longest direction (cm): √12 × the principal standard deviation. */
  lengthCm: number;
  /**
   * Median displayed grey of the segment minus the LV cavity's (0–255 levels); null without a displayed image or when
   * the segment is not in the plane.
   */
  borderContrast: number | null;
}

/** Below this area the plane only grazes the segment (a boundary sliver of a few samples). */
export const SEGMENT_IN_PLANE_MIN_CM2 = 0.05;
/** A sample is insonified above this transmission: twice the renderer's floor, where an extinguished beam ends. */
export const SEGMENT_INSONIFIED_MIN_TRANSMISSION = 2 * TRANSMISSION_FLOOR;
/** A segment is insonified when at least this fraction of its area is. */
export const SEGMENT_INSONIFIED_MIN_FRACTION = 0.5;
/** Shortest section along which thickening can be judged: 1 cm of wall (a basal or mid segment is 2–3 cm long). */
export const SEGMENT_ASSESSABLE_MIN_LENGTH_CM = 1;
/** And its area: a tangential cut through a thin rim of wall is long but not assessable. */
export const SEGMENT_ASSESSABLE_MIN_CM2 = 0.3;
/**
 * The border can be followed when the median displayed grey of the segment exceeds the cavity's by this many levels
 * (4 % of the display range). Chosen by eye on the optimal-window apical images of the high tier (the live one): the
 * walls seen clearly sit 40–110 levels above the cavity; the mid anterior wall of the A2C, 13 levels above it, can still
 * be followed in an enlarged image; the mid anteroseptal wall of the A3C, 4 levels below it, cannot. The difficult
 * window, whose default image shows no wall at all, stays under it almost everywhere.
 */
export const SEGMENT_BORDER_MIN_CONTRAST = 10;

const CODES = 21; // 0 and the codes 1–20 of lvSegments.ts

/**
 * Segment codes of the drawn plane where the frame is blind — the samples it labels lung, behind the pleura — from the
 * classifier on every `stride`-th line and sample (255 elsewhere). The rest of the frame already is the plane. Only the
 * lung near the LV is classified: measured at the high tier, the pass adds 1–11 ms to an analysis at stride 3 (the
 * analysis runs on one frame in five).
 */
export interface HiddenSegments {
  codes: Uint8Array;
  stride: number;
}

export function hiddenSegmentCodes(
  frame: Pick<PolarFrame, 'spec' | 'structure'>,
  heart: HeartModel,
  heartPose: HeartPose,
  beam: BeamFrame,
  stride = 4,
): HiddenSegments {
  const { lines, samples, sectorRad, depthCm } = frame.spec;
  const codes = new Uint8Array(lines * samples).fill(255);
  const s = makeSample();
  const hf = heart.frame;
  const dr = depthCm / samples;
  const half = stride >> 1;
  // only the lung around the left ventricle can hide one of its segments: a cylinder about its axis with room for the
  // end-diastolic wall and the septal shift, from above the annulus to beyond the apex
  const reach = heart.lv.rMax + 2.5;
  const zMin = -1.5,
    zMax = heart.lv.lengthCm + 2;
  for (let li = half; li < lines; li += stride) {
    const theta = -sectorRad / 2 + (sectorRad * (li + 0.5)) / lines;
    const ct = Math.cos(theta),
      sn = Math.sin(theta);
    // the central plane's sample positions, as the tracers march them
    const dx = beam.forward.x * ct + beam.lateral.x * sn,
      dy = beam.forward.y * ct + beam.lateral.y * sn,
      dz = beam.forward.z * ct + beam.lateral.z * sn;
    for (let si = half; si < samples; si += stride) {
      const i = li * samples + si;
      if (frame.structure[i] !== Structure.Lung) continue;
      const r = (si + 0.5) * dr;
      const px = beam.origin.x + dx * r - hf.origin.x,
        py = beam.origin.y + dy * r - hf.origin.y,
        pz = beam.origin.z + dz * r - hf.origin.z;
      const hx = px * hf.ex.x + py * hf.ex.y + pz * hf.ex.z,
        hy = px * hf.ey.x + py * hf.ey.y + pz * hf.ey.z,
        hz = px * hf.ez.x + py * hf.ez.y + pz * hf.ez.z;
      if (hz < zMin || hz > zMax || hx * hx + hy * hy > reach * reach) {
        codes[i] = 0;
        continue;
      }
      codes[i] = classifyHeart(heart, heartPose, hx, hy, hz, s) ? s.segment : 0;
    }
  }
  return { codes, stride };
}

/** The displayed polar image (grey 0–255, same indexing as the frame) and the median grey of the LV cavity in it. */
export interface CoverageDisplay {
  grey: ArrayLike<number>;
  cavityGrey: number;
}

/**
 * Coverage of the LV segments in a frame, for the anatomical AHA 17 model or the 16-segment wall-motion model (whose
 * apical segments include the cap). One entry per segment id of the model, in id order.
 */
export function segmentCoverage(
  frame: Pick<PolarFrame, 'spec' | 'segment' | 'transmission'>,
  model: SegmentCoverageModel,
  display?: CoverageDisplay,
  hidden?: HiddenSegments,
): SegmentCoverage[] {
  const acc = accumulate(frame, display, hidden);
  const ids = model === 'LV_AHA17' ? 17 : 16;
  const toId = model === 'LV_AHA17' ? aha17FromCode : lv16FromCode;
  const out: SegmentCoverage[] = [];
  const hist = new Uint32Array(256);
  for (let id = 1; id <= ids; id++) {
    let a = 0,
      lit = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      syy = 0,
      sxy = 0,
      nGrey = 0;
    hist.fill(0);
    for (let c = 1; c < CODES; c++) {
      if (toId(c) !== id) continue;
      a += acc.area[c]!;
      lit += acc.lit[c]!;
      sx += acc.sx[c]!;
      sy += acc.sy[c]!;
      sxx += acc.sxx[c]!;
      syy += acc.syy[c]!;
      sxy += acc.sxy[c]!;
      if (acc.hist) {
        for (let g = 0; g < 256; g++) hist[g]! += acc.hist[c * 256 + g]!;
        nGrey += acc.nGrey[c]!;
      }
    }
    let lengthCm = 0;
    if (a > 0) {
      const mx = sx / a,
        my = sy / a;
      const cxx = sxx / a - mx * mx,
        cyy = syy / a - my * my,
        cxy = sxy / a - mx * my;
      const tr = cxx + cyy,
        det = cxx * cyy - cxy * cxy;
      const lMax = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
      lengthCm = Math.sqrt(12 * Math.max(0, lMax));
    }
    const inPlane = a >= SEGMENT_IN_PLANE_MIN_CM2;
    const insonifiedFraction = inPlane ? lit / a : 0;
    const insonified = inPlane && insonifiedFraction >= SEGMENT_INSONIFIED_MIN_FRACTION;
    const bigEnough =
      lengthCm >= SEGMENT_ASSESSABLE_MIN_LENGTH_CM && a >= SEGMENT_ASSESSABLE_MIN_CM2;
    const borderContrast =
      display && inPlane && nGrey > 0 ? median(hist, nGrey) - display.cavityGrey : null;
    const borderVisible = borderContrast === null || borderContrast >= SEGMENT_BORDER_MIN_CONTRAST;
    out.push({
      model,
      segmentId: id,
      inPlane,
      insonified,
      assessable: insonified && bigEnough && borderVisible,
      reason: !inPlane
        ? 'not_in_plane'
        : !insonified
          ? 'shadowed'
          : !bigEnough
            ? 'insufficient_extent'
            : !borderVisible
              ? 'insufficient_border_visibility'
              : null,
      areaCm2: a,
      insonifiedFraction,
      lengthCm,
      borderContrast,
    });
  }
  return out;
}

function median(hist: Uint32Array, n: number): number {
  let acc = 0;
  for (let g = 0; g < hist.length; g++) {
    acc += hist[g]!;
    if (acc * 2 >= n) return g;
  }
  return 255;
}

/**
 * Per-code area, insonified area and area-weighted moments of the sample positions in the image plane (cm), and the
 * grey histogram of each code's samples when a display is given.
 */
function accumulate(
  frame: Pick<PolarFrame, 'spec' | 'segment' | 'transmission'>,
  display: CoverageDisplay | undefined,
  hidden: HiddenSegments | undefined,
): {
  area: Float64Array;
  lit: Float64Array;
  sx: Float64Array;
  sy: Float64Array;
  sxx: Float64Array;
  syy: Float64Array;
  sxy: Float64Array;
  hist: Uint32Array | null;
  nGrey: Uint32Array;
} {
  const { lines, samples, sectorRad, depthCm } = frame.spec;
  const area = new Float64Array(CODES),
    lit = new Float64Array(CODES),
    sx = new Float64Array(CODES),
    sy = new Float64Array(CODES),
    sxx = new Float64Array(CODES),
    syy = new Float64Array(CODES),
    sxy = new Float64Array(CODES),
    nGrey = new Uint32Array(CODES);
  const n = lines * samples;
  const grey = display && display.grey.length >= n ? display.grey : null;
  const hist = grey ? new Uint32Array(CODES * 256) : null;
  const dr = depthCm / samples,
    dTheta = sectorRad / lines;
  const seg = frame.segment,
    tr = frame.transmission;
  if (seg.length < n) return { area, lit, sx, sy, sxx, syy, sxy, hist, nGrey };
  for (let li = 0; li < lines; li++) {
    const theta = -sectorRad / 2 + dTheta * (li + 0.5);
    const st = Math.sin(theta),
      ct = Math.cos(theta);
    const base = li * samples;
    for (let si = 0; si < samples; si++) {
      const i = base + si;
      let c = seg[i]!;
      // behind the pleura: the classified plane on a sparse grid, each sample standing for stride² of them, never lit
      const h = hidden ? hidden.codes[i]! : 255;
      const behindLung = h !== 255;
      if (behindLung) c = h;
      if (c === 0 || c >= CODES) continue;
      const r = (si + 0.5) * dr;
      const w = r * dTheta * dr * (behindLung ? hidden!.stride * hidden!.stride : 1);
      const x = r * st,
        y = r * ct;
      area[c]! += w;
      if (behindLung) {
        sx[c]! += w * x;
        sy[c]! += w * y;
        sxx[c]! += w * x * x;
        syy[c]! += w * y * y;
        sxy[c]! += w * x * y;
        continue;
      }
      if ((tr[i] ?? 0) > SEGMENT_INSONIFIED_MIN_TRANSMISSION) lit[c]! += w;
      sx[c]! += w * x;
      sy[c]! += w * y;
      sxx[c]! += w * x * x;
      syy[c]! += w * y * y;
      sxy[c]! += w * x * y;
      if (grey && hist) {
        const g = Math.max(0, Math.min(255, Math.round(grey[i] ?? 0)));
        hist[c * 256 + g]!++;
        nGrey[c]!++;
      }
    }
  }
  return { area, lit, sx, sy, sxx, syy, sxy, hist, nGrey };
}
