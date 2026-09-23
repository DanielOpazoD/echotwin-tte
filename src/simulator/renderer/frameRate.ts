import { SPEED_OF_SOUND_MPS } from '@/core/units';
import type { AcquisitionSettings, LineDensity, PolarFrameSpec } from './types';

/**
 * Two frame rates (decision 178). The acquisition frame rate is the scanner's: what the HUD shows and what teaches the
 * depth / sector / line density / colour box trade-off; it depends on the console alone, so it is the same in the three
 * quality tiers. The cadence is how often the simulator forms a frame: never above the acquisition rate, and bounded by
 * the work of the tier, whose polar frame has its own number of lines (the tier is a computing choice, not a scanner
 * setting). Until decision 178 both were one number, computed from the tier's lines: 48.8, 36.9 and 27.3 Hz at 16 cm
 * and 80° in the low, medium and high tiers, and 7.9 Hz with the default colour box in the medium tier.
 */

/** Dead time per transmit event (s): switching, and the reverberations of one line dying out before the next. */
const LINE_OVERHEAD_S = 0.00002;

/** Two-way time of one transmit event to a depth (cm), with its dead time. */
export function lineTimeS(depthCm: number): number {
  return (2 * (depthCm / 100)) / SPEED_OF_SOUND_MPS + LINE_OVERHEAD_S;
}

/**
 * Receive lines per degree of sector of each line density: an assumption of the model, not a published value. The
 * medium density puts 128 receive lines over the default 80° sector, and the low and high densities bracket it.
 */
export const RX_LINES_PER_DEG: Readonly<Record<LineDensity, number>> = {
  low: 1.0,
  medium: 1.6,
  high: 2.4,
};

/**
 * Receive lines formed in parallel from one transmit event in B-mode (multi-line acquisition). Clinical phased-array
 * scanners form two to four; two is the conservative end.
 */
export const BMODE_MLA = 2;

/**
 * Colour transmit lines per degree of the colour box, with the pulses each fires (the packet). Focused colour Doppler
 * over a 12 cm apical long axis uses 20–60 lines, depending on the width of the sector, with a packet around 8, and
 * runs at 10–30 frames/s (Puig et al., «Boosting cardiac color Doppler frame rates with deep learning», IEEE TUFFC
 * 2024, arXiv:2404.00067). The colour lines stop at the bottom of the box.
 */
export const COLOR_LINES_PER_DEG = 1.0;
export const COLOR_PACKET = 8;

/** The colour box as the frame rate reads it: its width and its deepest edge. */
export interface ColorBoxExtent {
  boxThetaMinRad: number;
  boxThetaMaxRad: number;
  boxRMaxCm: number;
}

/** B-mode transmit events of one frame: the receive lines of the sector over the parallel lines of each event. */
export function bmodeTransmitLines(settings: AcquisitionSettings): number {
  return Math.ceil((RX_LINES_PER_DEG[settings.lineDensity] * settings.sectorDeg) / BMODE_MLA);
}

/** Colour transmit lines of one frame. */
export function colorTransmitLines(box: ColorBoxExtent): number {
  const widthDeg = ((box.boxThetaMaxRad - box.boxThetaMinRad) * 180) / Math.PI;
  return Math.max(1, Math.round(COLOR_LINES_PER_DEG * widthDeg));
}

/**
 * The acquisition frame rate (Hz): the B-mode transmit events to the image depth, plus the colour packets to the bottom
 * of the box when colour is on. Conventional 2D echocardiography runs at about 40–80 frames/s (Fujikura et al., J Clin Med
 * 2021;10:2095); the default console gives 68.6 Hz at 16 cm and 80°, and 14.3 Hz with the default colour box.
 */
export function acquisitionFrameRate(
  settings: AcquisitionSettings,
  color?: ColorBoxExtent,
): number {
  const bmode = bmodeTransmitLines(settings) * lineTimeS(settings.depthCm);
  const colour = color
    ? colorTransmitLines(color) *
      COLOR_PACKET *
      lineTimeS(Math.min(color.boxRMaxCm, settings.depthCm))
    : 0;
  return 1 / (bmode + colour);
}

/**
 * The cadence (Hz) at which the simulator forms frames: at most the acquisition rate, and at most what the tier's polar
 * frame affords — the same line-by-line budget with the tier's lines, the colour lines of the box among them, capped at
 * 90 Hz. It paces the worker, sizes the frame budget and the M-mode trace, and is the interval persistence decays over.
 */
export function cadenceHz(
  spec: PolarFrameSpec,
  acquisitionHz: number,
  colorLines = 0,
  packetSize = COLOR_PACKET,
): number {
  const lineS = lineTimeS(spec.depthCm);
  const work = 1 / (spec.lines * lineS + colorLines * packetSize * lineS);
  return Math.min(90, work, acquisitionHz);
}
