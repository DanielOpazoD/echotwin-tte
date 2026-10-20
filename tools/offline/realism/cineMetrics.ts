/**
 * The bench's measurements of one simulated cine (decision 344): LV discs per frame (apical views), the global
 * longitudinal strain of the four-chamber view by speckle tracking and from the model's own contour, the frame-to-frame
 * correlation of myocardial speckle, and the texture of the myocardium on the displayed grey and on the envelope.
 */
import { Structure } from '@/simulator/anatomy/tissue';
import { LABEL, orientApical, type RegionImage } from '@/clinical/regionStats';
import { apexFirst, maskDiscs, type DiscMeasure } from '@/clinical/realism/lvVolume';
import { regionResidual } from '@/clinical/realism/regionTexture';
import {
  envelopeSnr,
  impliedDynamicRangeDb,
  kAlphaFromEnvelope,
  moments,
  nakagamiMFromLogSkew,
  SNR_WINDOW,
  windowedSnr,
} from '@/clinical/realism/speckleStats';
import {
  FULL_RES_TRACKING,
  fullResOptions,
  matchBlock,
  offsetPolyline,
  peakStrain,
  polylineLength,
  resamplePolyline,
  trackPoints,
  type GreyFrame,
} from '@/clinical/realism/speckleTracking';
import { followMaterial } from '@/clinical/realism/materialStrain';
import { seededRandom } from '@/clinical/realism/turing';
import { CANVAS, labelMask, LV_WALLS, type Cine, type CineFrame } from './simCine';

export interface TextureStats {
  /** Nakagami m of the residual grey, its std and the dynamic range they imply, the median grey. */
  m: number;
  residualStd: number;
  impliedDrDb: number;
  skewness: number;
  excessKurtosis: number;
  medianGrey: number;
  n: number;
}

/** Texture of a labelled region image's myocardium (the same function runs on CAMUS). */
export function textureStats(img: RegionImage): TextureStats {
  const res = regionResidual(img, LABEL.myocardium);
  const mo = moments(res);
  const m = nakagamiMFromLogSkew(mo.skewness);
  const greys: number[] = [];
  for (let i = 0; i < img.labels.length; i++)
    if (img.labels[i] === LABEL.myocardium) greys.push(img.grey[i]!);
  greys.sort((a, b) => a - b);
  return {
    m,
    residualStd: mo.std,
    // only where the residual is log-compressed speckle (a Nakagami fit exists)
    impliedDrDb: Number.isFinite(m) ? impliedDynamicRangeDb(mo.std, m) : NaN,
    skewness: mo.skewness,
    excessKurtosis: mo.excessKurtosis,
    medianGrey: greys.length ? greys[Math.floor(greys.length / 2)]! : NaN,
    n: mo.n,
  };
}

export function regionImage(cine: Cine, f: CineFrame): RegionImage {
  const img: RegionImage = {
    width: CANVAS,
    height: CANVAS,
    grey: f.grey,
    labels: labelMask(f),
    mmPerPx: [cine.mmPerPx, cine.mmPerPx],
  };
  return cine.view === 'a4c' || cine.view === 'a2c' ? orientApical(img) : img;
}

/**
 * Envelope statistics of the LV wall samples of a polar frame (pre-console, linear): the SNR over the whole wall (its
 * level changes included), the windowed SNR (speckle alone), and the K shape of the intensity.
 */
export function envelopeStats(f: CineFrame): {
  snr: number;
  windowedSnr: number;
  windows: number;
  kAlpha: number;
  n: number;
} {
  const v: number[] = [];
  const { structure, amplitude, spec } = f.polar;
  for (let i = 0; i < structure.length; i++) if (LV_WALLS.has(structure[i]!)) v.push(amplitude[i]!);
  const w = windowedSnr(
    amplitude,
    (i) => LV_WALLS.has(structure[i]!),
    spec.lines,
    spec.samples,
    SNR_WINDOW.lines,
    SNR_WINDOW.samples,
  );
  return {
    snr: envelopeSnr(v),
    windowedSnr: w.median,
    windows: w.windows,
    kAlpha: kAlphaFromEnvelope(v),
    n: v.length,
  };
}

const grey = (f: CineFrame): GreyFrame => ({ width: CANVAS, height: CANVAS, grey: f.grey });

/**
 * The endocardial contour of the LV cavity in an apex-up frame, row by row: the left edge from the base up to the apex,
 * then the right edge back down, each edge smoothed over ±2 rows. The base is the top of the mitral annulus (the open
 * leaflets reach into the cavity, the closed ones bow towards the atrium, and the cavity's lowest row moves with them).
 */
export function endocardialContour(structure: Uint8Array): { x: number; y: number }[] {
  let top = CANVAS,
    bottom = -1,
    annulusTop = CANVAS;
  for (let y = 0; y < CANVAS; y++)
    for (let x = 0; x < CANVAS; x++) {
      const s = structure[x + y * CANVAS];
      if (s === Structure.LvCavity) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      } else if (s === Structure.MitralAnnulus && y < annulusTop) annulusTop = y;
    }
  const base = annulusTop < CANVAS ? Math.min(bottom, annulusTop) : bottom - 3;
  const left: { x: number; y: number }[] = [],
    right: { x: number; y: number }[] = [];
  for (let y = top; y <= base; y++) {
    let l = -1,
      r = -1;
    for (let x = 0; x < CANVAS; x++)
      if (structure[x + y * CANVAS] === Structure.LvCavity) {
        if (l < 0) l = x;
        r = x;
      }
    if (l < 0) continue;
    left.push({ x: l - 0.5, y });
    right.push({ x: r + 0.5, y });
  }
  const smooth = (pts: { x: number; y: number }[]): { x: number; y: number }[] =>
    pts.map((p, i) => {
      const w = pts.slice(Math.max(0, i - 2), i + 3);
      return { x: w.reduce((s, q) => s + q.x, 0) / w.length, y: p.y };
    });
  return [...smooth(left).reverse(), ...smooth(right)];
}

export interface StrainResult {
  /**
   * Peak (most negative) GLS (%) and the frame of the peak: tracked, and the model's own, the tissue under the same line
   * 2 mm inside the wall and under the end-diastolic endocardium (decision 361).
   */
  tracked: number;
  trackedFrame: number;
  modelMidwall: number;
  modelEndocardial: number;
  modelFrame: number;
  /** Points left out of the model's two lines: not on the LV at end diastole, or whose tissue was lost. */
  modelLost: number;
  /** Mean distance (mm) between the tracked points after a whole cycle and where they started: the tracker's drift. */
  driftMm: number;
  points: number;
  lost: number;
  /** Strain curves over the cycle (%), tracked and model mid-wall. */
  trackedCurve: number[];
  modelCurve: number[];
}

/**
 * The fastest the bench lets a point of tissue move (mm/s): myocardial velocities stay under 15 cm/s (tissue Doppler s′
 * and e′), so a point found further than this allows from where it was in the frame before has landed on other tissue.
 */
const MATERIAL_MAX_SPEED_MM_S = 200;

/**
 * Lengths over the cine (px) of a line of the model's tissue (decision 361): the start points on the LV at end diastole
 * (cavity or wall), each followed by its material coordinates, and the line through those whose tissue was found in
 * every frame; `left` counts the points left out.
 */
function modelLine(
  cine: Cine,
  line: readonly { x: number; y: number }[],
): { lengths: number[]; left: number } {
  const ed = cine.frames[0]!.structure;
  const onLv = line.filter((p) => {
    const st = ed[Math.round(p.x) + Math.round(p.y) * CANVAS]!;
    return st === Structure.LvCavity || LV_WALLS.has(st);
  });
  const f = followMaterial(
    cine.frames.map((fr) => fr.material),
    onLv,
    MATERIAL_MAX_SPEED_MM_S / cine.fps / cine.mmPerPx,
  );
  return {
    lengths: f.positions.map((p) => polylineLength(p.filter((_, i) => f.kept[i]))),
    left: line.length - f.kept.filter(Boolean).length,
  };
}

/** GLS of a four-chamber cine. The tracked line starts 2 mm inside the wall from the end-diastolic endocardium. */
export function strain(cine: Cine): StrainResult {
  const insidePx = 2 / cine.mmPerPx;
  const start = resamplePolyline(
    offsetPolyline(endocardialContour(cine.frames[0]!.structure), insidePx),
    FULL_RES_TRACKING.points,
  );
  // the tracker validated on a sequence of known motion (decision 349)
  const frames = cine.frames.map(grey);
  const tr = trackPoints([...frames, frames[0]!], start, fullResOptions(cine.mmPerPx));
  const tracked = tr.positions.slice(0, frames.length).map((p) => polylineLength(p));
  // the model's own strain (decision 361): the tissue under the tracked line's start points, and under the end-diastolic
  // endocardium, followed by its material coordinates. A contour redrawn on each frame's structure map counted its pixel
  // and voxel steps as length: its strain changed by several points with how much it was smoothed
  const mid = modelLine(cine, start);
  const endoLine = modelLine(
    cine,
    resamplePolyline(endocardialContour(cine.frames[0]!.structure), FULL_RES_TRACKING.points),
  );
  const model = mid.lengths;
  const endo = endoLine.lengths;
  const last = tr.positions[tr.positions.length - 1]!;
  const drift =
    last.reduce((s, p, k) => s + Math.hypot(p.x - start[k]!.x, p.y - start[k]!.y), 0) / last.length;
  const pt = peakStrain(tracked),
    pm = peakStrain(model);
  return {
    tracked: pt.strain,
    trackedFrame: pt.frame,
    modelMidwall: pm.strain,
    modelEndocardial: peakStrain(endo).strain,
    modelFrame: pm.frame,
    modelLost: mid.left + endoLine.left,
    driftMm: drift * cine.mmPerPx,
    points: start.length,
    lost: tr.lost,
    trackedCurve: tracked.map((L) => (100 * (L - tracked[0]!)) / tracked[0]!),
    modelCurve: model.map((L) => (100 * (L - model[0]!)) / model[0]!),
  };
}

export interface Decorrelation {
  /** Mean NCC of myocardial blocks between consecutive frames: at the best match, and at the same place. */
  peak: number;
  zeroShift: number;
  pairs: number;
}

/** Frame-to-frame correlation of 5 mm myocardial blocks (60 random LV-wall pixels per frame pair). */
export function decorrelation(cine: Cine, points = 60): Decorrelation {
  const rand = seededRandom(343);
  const halfKernel = Math.round(2.5 / cine.mmPerPx);
  const search = Math.ceil(2.5 / cine.mmPerPx);
  let sp = 0,
    sz = 0,
    n = 0;
  for (let f = 0; f + 1 < cine.frames.length; f++) {
    const st = cine.frames[f]!.structure;
    const wall: number[] = [];
    for (let i = 0; i < st.length; i++) if (LV_WALLS.has(st[i]!)) wall.push(i);
    if (!wall.length) continue;
    for (let k = 0; k < points; k++) {
      const i = wall[Math.floor(rand() * wall.length)]!;
      const m = matchBlock(
        grey(cine.frames[f]!),
        grey(cine.frames[f + 1]!),
        i % CANVAS,
        Math.floor(i / CANVAS),
        {
          halfKernel,
          search,
        },
      );
      if (!m || !Number.isFinite(m.zeroShift)) continue;
      sp += m.peak;
      sz += m.zeroShift;
      n++;
    }
  }
  return { peak: sp / n, zeroShift: sz / n, pairs: n };
}

export interface CineMetrics {
  caseId: string;
  view: string;
  fps: number;
  rrS: number;
  esPhase: number;
  frames: number;
  /** LV discs per frame (apical views), apex first. */
  discs: (DiscMeasure | null)[] | null;
  modelVolumeMl: number[];
  texture: { ed: TextureStats; es: TextureStats } | null;
  envelope: ReturnType<typeof envelopeStats>;
  decorrelation: Decorrelation;
  strain: StrainResult | null;
}

export function cineMetrics(cine: Cine): CineMetrics {
  const apical = cine.view === 'a4c' || cine.view === 'a2c';
  const esFrame = Math.min(cine.frames.length - 1, Math.round(cine.esPhase * cine.rrS * cine.fps));
  return {
    caseId: cine.caseId,
    view: cine.view,
    fps: cine.fps,
    rrS: cine.rrS,
    esPhase: cine.esPhase,
    frames: cine.frames.length,
    discs: apical
      ? cine.frames.map((f) => {
          const d = maskDiscs(
            labelMask(f),
            CANVAS,
            CANVAS,
            [cine.mmPerPx, cine.mmPerPx],
            LABEL.cavity,
          );
          return d ? apexFirst(d) : null;
        })
      : null,
    modelVolumeMl: cine.modelVolumeMl,
    texture: apical
      ? {
          ed: textureStats(regionImage(cine, cine.frames[0]!)),
          es: textureStats(regionImage(cine, cine.frames[esFrame]!)),
        }
      : null,
    envelope: envelopeStats(cine.frames[0]!),
    decorrelation: decorrelation(cine),
    strain: cine.view === 'a4c' ? strain(cine) : null,
  };
}
