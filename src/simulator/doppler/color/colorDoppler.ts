import { softTissueTransmission } from '@/simulator/renderer/acoustic/acoustics';
import { aliasVelocity } from '@/clinical/formulas';
import { hash3 } from '@/core/random';
import { Tissue } from '@/simulator/anatomy/tissue';
import type { PolarFrame } from '@/simulator/renderer/types';
import type { ScanLut } from '@/simulator/renderer/scanConvert';
import { COLOR_BLEND, colorMap } from '@/simulator/renderer/postprocess/colorMap';

export interface ColorSettings {
  boxThetaMinRad: number;
  boxThetaMaxRad: number;
  boxRMinCm: number;
  boxRMaxCm: number;
  scaleMps: number; // Nyquist
  baselineShiftMps: number;
  wallFilterMps: number;
  gainDb: number;
  persistence: number;
  showVariance: boolean;
  invert: boolean;
}

export const DEFAULT_COLOR: ColorSettings = {
  boxThetaMinRad: -0.32,
  boxThetaMaxRad: 0.32,
  boxRMinCm: 5,
  boxRMaxCm: 13,
  scaleMps: 0.62,
  baselineShiftMps: 0,
  wallFilterMps: 0.06,
  gainDb: 0,
  persistence: 0.3,
  showVariance: true,
  invert: false,
};

/** Acquisition the colour field was formed with: the expected tissue attenuation depends on it. */
export interface ColorAcquisition {
  frequencyMHz: number;
  harmonics: boolean;
}

/** Below this fraction of the expected transmission a sample lies in an acoustic shadow: no Doppler signal at any gain. */
export const DOPPLER_SHADOW_TRANSMISSION = 0.02;

/**
 * Two-way transmission of a frame sample relative to what soft tissue (0.5 dB/cm/MHz) would leave at its depth for the
 * acquisition that formed the frame (decisions 87 and 96): depth alone does not make a shadow.
 */
export function relativeTransmission(
  transmission: number,
  depthCm: number,
  acquisition: ColorAcquisition,
): number {
  return (
    transmission / softTissueTransmission(depthCm, acquisition.frequencyMHz, acquisition.harmonics)
  );
}

/** Second-order wall-filter magnitude at |v| over the cutoff: −3 dB at the cutoff, flat from about twice it. */
export function wallFilterResponse(vAbs: number, cutoffMps: number): number {
  if (cutoffMps <= 0) return 1;
  const x = (vAbs / cutoffMps) ** 2;
  return x / Math.sqrt(1 + x * x);
}

/** Per-sample colour result buffers (polar). vel in m/s after aliasing, NaN where no colour. */
export interface ColorField {
  vel: Float32Array;
  variance: Float32Array;
  power: Float32Array;
  /** Velocity scale, baseline and inversion the field was formed with: its phases mean nothing under other ones. */
  scaleMps: number;
  baselineShiftMps: number;
  invert: boolean;
}

/**
 * The colour field as a scanner estimates it (decision 116). Each update the velocity comes from the autocorrelation of a short
 * packet of echoes and the power from the same echoes of moving blood, so both scatter: the power of the blood's speckle
 * (exponential, averaged over the packet and the sample volume) decides whether a sample passes the display threshold,
 * and the velocity estimate scatters around the velocity, more with a broad spectrum and with a weak echo. Both are
 * correlated over about two samples and two lines (the resolution cell) and new at every update, as the blood moves on.
 * Without an estimate the field is the expected one. Declared values: no measured colour Doppler texture was found to
 * calibrate against.
 */
export interface ColorEstimate {
  /** Index of the colour update: every update draws a new realization. */
  realization: number;
  seed: number;
}
/** Display threshold of the colour power (after gain). */
const COLOR_THRESHOLD = 0.25;
/** Pulses per colour line: the packet of the frame-rate model (decision 178). */
export const COLOR_PACKET = 8;
/**
 * Receiver noise power, relative to the echo of blood at the transmission soft tissue would leave, and the pulse-to-pulse
 * phase jitter of a laminar flow (rad): the transit of the scatterers through the sample volume and the beam's
 * geometric broadening. Declared values, set so a strong laminar flow scatters by a few per cent of Nyquist; no measured
 * colour texture was found to calibrate against.
 */
const NOISE_POWER = 0.02;
const TRANSIT_JITTER_RAD = 0.4;
/** 1 − |R1|/R0 of a strong laminar flow: the transit jitter and the receiver noise alone. */
const LAMINAR_DECORRELATION = 1 - Math.exp(-(TRANSIT_JITTER_RAD ** 2)) / (1 + NOISE_POWER);

/** Unit Gaussian from two hashes (Box–Muller). */
function hashGaussian(li: number, si: number, stream: number, seed: number): number {
  const u1 = hash3(li, si, stream, seed);
  const u2 = hash3(li, si, stream + 1, seed);
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, u1))) * Math.cos(2 * Math.PI * u2);
}

/** A pair of independent unit Gaussians from the same two hashes (both outputs of Box–Muller), into `out`. */
function hashGaussianPair(
  li: number,
  si: number,
  stream: number,
  seed: number,
  out: { a: number; b: number },
): void {
  const u1 = hash3(li, si, stream, seed);
  const u2 = hash3(li, si, stream + 1, seed);
  const r = Math.sqrt(-2 * Math.log(Math.max(1e-12, u1)));
  out.a = r * Math.cos(2 * Math.PI * u2);
  out.b = r * Math.sin(2 * Math.PI * u2);
}

/** Binomial [1 2 1]/4 smoothing of a lines × samples grid, along lines and along samples, in place. */
function smoothGrid(g: Float32Array, nL: number, nS: number, tmp: Float32Array): void {
  for (let l = 0; l < nL; l++)
    for (let k = 0; k < nS; k++) {
      const i = l * nS + k;
      tmp[i] = 0.25 * (g[k > 0 ? i - 1 : i]! + 2 * g[i]! + g[k < nS - 1 ? i + 1 : i]!);
    }
  for (let l = 0; l < nL; l++)
    for (let k = 0; k < nS; k++) {
      const i = l * nS + k;
      g[i] = 0.25 * (tmp[l > 0 ? i - nS : i]! + 2 * tmp[i]! + tmp[l < nL - 1 ? i + nS : i]!);
    }
}

/**
 * The colour estimate of one update (decision 300), as a scanner forms it. Each sample of the box receives a packet of
 * `COLOR_PACKET` echoes: the blood's speckle amplitude (a complex Gaussian correlated over the resolution cell, new at every
 * update), turning by π·v/Nyquist per pulse, with a pulse-to-pulse jitter from transit and turbulence (the spectral width
 * 0.9 × dispersion × speed of spectrum.ts), plus receiver noise. A regression wall filter removes the packet's mean (and
 * its linear trend for a high cutoff): it acts on the sampled phase, so it is periodic in the PRF and rejects a jet that
 * aliases to near zero as well as slow flow. The lag-zero and lag-one autocorrelations R0 and R1, averaged over the
 * resolution cell as a scanner's range and lateral averaging does, give the power, the velocity Nyquist·arg(R1)/π (Kasai) and the
 * variance 1 − |R1|/R0. Until then the field was the true velocity plus a Gaussian scatter and the wall filter a cut on
 * the true velocity, which kept a jet at twice Nyquist that a real filter rejects.
 */
function kasaiEstimate(
  cellV: Float32Array,
  cellDisp: Float32Array,
  cellRel: Float32Array,
  liMin: number,
  siMin: number,
  nL: number,
  nS: number,
  s: ColorSettings,
  estimate: ColorEstimate,
): { velocity: Float32Array; power: Float32Array; variance: Float32Array } {
  const n = nL * nS;
  const stream = estimate.realization * 64;
  // the blood's speckle amplitude: a complex Gaussian of unit power, correlated over about two samples and two lines
  const zr = new Float32Array(n);
  const zi = new Float32Array(n);
  const tmp = new Float32Array(n);
  for (let l = 0; l < nL; l++)
    for (let k = 0; k < nS; k++) {
      zr[l * nS + k] = hashGaussian(liMin + l, siMin + k, stream, estimate.seed);
      zi[l * nS + k] = hashGaussian(liMin + l, siMin + k, stream + 2, estimate.seed);
    }
  smoothGrid(zr, nL, nS, tmp);
  smoothGrid(zi, nL, nS, tmp);
  // the pulse-to-pulse jitter of each pulse, correlated over the same cell: neighbouring samples share their scatterers
  const N = COLOR_PACKET;
  const jit: Float32Array[] = [];
  for (let p = 0; p < N; p++) {
    const j = new Float32Array(n);
    for (let l = 0; l < nL; l++)
      for (let k = 0; k < nS; k++)
        j[l * nS + k] = hashGaussian(liMin + l, siMin + k, stream + 4 + 2 * p, estimate.seed);
    smoothGrid(j, nL, nS, tmp);
    for (let g = 0; g < n; g++) j[g]! /= 0.375;
    jit.push(j);
  }
  // [1 2 1]/4 in two directions keeps (6/16)² of the variance; each part then carries half the unit power
  const unit = 1 / (0.375 * Math.SQRT2);
  // the wall filter's order: none, the mean, or the mean and the linear trend, by its cutoff against Nyquist
  const cut = s.wallFilterMps / s.scaleMps;
  const order = s.wallFilterMps <= 0 ? -1 : cut < 0.15 ? 0 : 1;
  const pair = { a: 0, b: 0 };
  const xr = new Float64Array(N);
  const xi = new Float64Array(N);
  const r0 = new Float32Array(n);
  const r1r = new Float32Array(n);
  const r1i = new Float32Array(n);
  const valid = new Uint8Array(n);
  // the centred linear basis, orthonormal over the packet
  const lin = new Float64Array(N);
  let linNorm = 0;
  for (let p = 0; p < N; p++) {
    lin[p] = p - (N - 1) / 2;
    linNorm += lin[p]! * lin[p]!;
  }
  for (let p = 0; p < N; p++) lin[p]! /= Math.sqrt(linNorm);
  for (let g = 0; g < n; g++) {
    const v = cellV[g]!;
    if (Number.isNaN(v)) continue;
    valid[g] = 1;
    const l = Math.floor(g / nS),
      k = g - l * nS;
    const li = liMin + l,
      si = siMin + k;
    const amp = Math.sqrt(cellRel[g]!);
    const ar = amp * zr[g]! * unit,
      ai = amp * zi[g]! * unit;
    const phi = (Math.PI * v) / s.scaleMps;
    const turbulent = (Math.PI * 0.9 * cellDisp[g]! * Math.abs(v)) / s.scaleMps / Math.SQRT2;
    const jitter = Math.hypot(TRANSIT_JITTER_RAD, turbulent);
    const noise = Math.sqrt(NOISE_POWER / 2);
    for (let p = 0; p < N; p++) {
      const ph = p * phi + jitter * jit[p]![g]!;
      const c = Math.cos(ph),
        sn = Math.sin(ph);
      hashGaussianPair(li, si, stream + 24 + 2 * p, estimate.seed, pair);
      xr[p] = ar * c - ai * sn + noise * pair.a;
      xi[p] = ar * sn + ai * c + noise * pair.b;
    }
    // regression wall filter: the packet less its projection on the low-order polynomials
    if (order >= 0) {
      let mr = 0,
        mi = 0;
      for (let p = 0; p < N; p++) {
        mr += xr[p]!;
        mi += xi[p]!;
      }
      mr /= N;
      mi /= N;
      for (let p = 0; p < N; p++) {
        xr[p]! -= mr;
        xi[p]! -= mi;
      }
      if (order >= 1) {
        let pr = 0,
          pi = 0;
        for (let p = 0; p < N; p++) {
          pr += xr[p]! * lin[p]!;
          pi += xi[p]! * lin[p]!;
        }
        for (let p = 0; p < N; p++) {
          xr[p]! -= pr * lin[p]!;
          xi[p]! -= pi * lin[p]!;
        }
      }
    }
    let a0 = 0,
      a1r = 0,
      a1i = 0;
    for (let p = 0; p < N; p++) a0 += xr[p]! * xr[p]! + xi[p]! * xi[p]!;
    for (let p = 0; p + 1 < N; p++) {
      // x[p+1] · conj(x[p])
      a1r += xr[p + 1]! * xr[p]! + xi[p + 1]! * xi[p]!;
      a1i += xi[p + 1]! * xr[p]! - xr[p + 1]! * xi[p]!;
    }
    r0[g] = a0 / N;
    r1r[g] = a1r / (N - 1);
    r1i[g] = a1i / (N - 1);
  }
  // averaged over the resolution cell ([1 2 1] in range and across lines), over the samples that carry colour only
  const avg = (src: Float32Array): Float32Array => {
    const outA = new Float32Array(n);
    for (let l = 0; l < nL; l++)
      for (let k = 0; k < nS; k++) {
        const g = l * nS + k;
        if (!valid[g]) continue;
        let sum = 0,
          w = 0;
        for (let dl = -1; dl <= 1; dl++)
          for (let dk = -1; dk <= 1; dk++) {
            const ll = l + dl,
              kk = k + dk;
            if (ll < 0 || ll >= nL || kk < 0 || kk >= nS) continue;
            const h = ll * nS + kk;
            if (!valid[h]) continue;
            const wt = (dl === 0 ? 2 : 1) * (dk === 0 ? 2 : 1);
            sum += wt * src[h]!;
            w += wt;
          }
        outA[g] = sum / w;
      }
    return outA;
  };
  const R0 = avg(r0),
    R1r = avg(r1r),
    R1i = avg(r1i);
  const velocity = new Float32Array(n).fill(NaN);
  const power = new Float32Array(n);
  const variance = new Float32Array(n);
  for (let g = 0; g < n; g++) {
    if (!valid[g]) continue;
    const p0 = R0[g]!;
    if (p0 <= 0) continue;
    velocity[g] = (s.scaleMps * Math.atan2(R1i[g]!, R1r[g]!)) / Math.PI;
    // the noise is part of what the receiver measures: subtract its expected share, as a scanner's power estimate does
    power[g] = Math.max(0, p0 - NOISE_POWER);
    // the variance over what a laminar flow already shows through transit and noise: laminar flow reads 0, as on a
    // scanner whose variance map starts at the system's own decorrelation
    const raw = 1 - Math.hypot(R1r[g]!, R1i[g]!) / p0;
    variance[g] = Math.min(
      1,
      Math.max(0, (raw - LAMINAR_DECORRELATION) / (1 - LAMINAR_DECORRELATION)),
    );
  }
  return { velocity, power, variance };
}

export function allocColorField(n: number): ColorField {
  return {
    vel: new Float32Array(n).fill(NaN),
    variance: new Float32Array(n),
    power: new Float32Array(n),
    scaleMps: 0,
    baselineShiftMps: 0,
    invert: false,
  };
}

/**
 * Compute colour for samples inside the box. `axialVelocity(idx)` returns the projected velocity
 * (m/s, +toward) and dispersion for a polar sample, computed by the caller from the flow field.
 * Blooming: gain above 0 extends colour into adjacent non-blood samples (dilation).
 * Signal power (decision 87) is the colour gain × the sample's two-way transmission relative to what soft tissue would
 * leave at that depth for this acquisition × the wall-filter response, so low gain loses attenuated, partly shadowed and
 * slow flow first; under a real shadow (< 2 % of the expected transmission) there is no signal at any gain. It used to
 * depend on velocity only, with the shadow threshold computed at a fixed 2.5 MHz.
 * Persistence blends each coloured sample with `prev`, the field of the previous update, as the lag-one autocorrelation
 * the velocity comes from: power-weighted phasors at the Doppler phase of each velocity, whose angle is the blended
 * velocity. Averaging aliased velocities linearly turned two flows on either side of Nyquist into a false slow flow.
 * `prev` must be a different buffer from `out`, which is cleared first.
 */
export function computeColorField(
  frame: PolarFrame,
  s: ColorSettings,
  prev: ColorField | null,
  axialVelocity: (
    idx: number,
    li: number,
    si: number,
    out: { v: number; disp: number; present: number },
  ) => void,
  out: ColorField,
  acquisition: ColorAcquisition,
  estimate?: ColorEstimate,
): { colorLines: number } {
  const { lines, samples, sectorRad, depthCm } = frame.spec;
  const tmp = { v: 0, disp: 0, present: 0 };
  const half = sectorRad / 2;
  const liMin = Math.max(0, Math.floor(((s.boxThetaMinRad + half) / sectorRad) * lines));
  const liMax = Math.min(lines - 1, Math.ceil(((s.boxThetaMaxRad + half) / sectorRad) * lines));
  const siMin = Math.max(0, Math.floor((s.boxRMinCm / depthCm) * samples));
  const siMax = Math.min(samples - 1, Math.ceil((s.boxRMaxCm / depthCm) * samples));
  out.vel.fill(NaN);
  out.power.fill(0);
  out.variance.fill(0);
  out.scaleMps = s.scaleMps;
  out.baselineShiftMps = s.baselineShiftMps;
  out.invert = s.invert;
  // a history formed under another scale, baseline or inversion is not blended: its velocities are other phases
  const history =
    prev &&
    prev.scaleMps === s.scaleMps &&
    prev.baselineShiftMps === s.baselineShiftMps &&
    prev.invert === s.invert
      ? prev
      : null;
  const gainLin = Math.pow(10, s.gainDb / 20);
  const bloomSamples = Math.max(0, Math.round((s.gainDb - 2) * 0.6)); // dilation radius grows with gain
  const nL = Math.max(0, liMax - liMin + 1);
  const nS = Math.max(0, siMax - siMin + 1);
  // pass 1: what reaches the receiver at each sample of the box — moving blood (or, with blooming, a sample beside it)
  // over the shadow threshold: its axial velocity, the dispersion of its spectrum and its transmission
  const cellV = new Float32Array(nL * nS).fill(NaN);
  const cellDisp = new Float32Array(nL * nS);
  const cellRel = new Float32Array(nL * nS);
  for (let li = liMin; li <= liMax; li++) {
    for (let si = siMin; si <= siMax; si++) {
      const idx = li * samples + si;
      const tissue = frame.tissue[idx];
      const trans = frame.transmission[idx] ?? 0;
      const r = ((si + 0.5) / samples) * depthCm;
      const relTrans = relativeTransmission(trans, r, acquisition);
      if (relTrans < DOPPLER_SHADOW_TRANSMISSION) continue; // acoustic shadow: no Doppler signal at any gain
      let isBlood = tissue === Tissue.Blood;
      if (!isBlood && bloomSamples > 0) {
        // blooming: colour bleeds onto adjacent tissue when gain is high
        for (let d = 1; d <= bloomSamples && !isBlood; d++) {
          if (frame.tissue[idx - d] === Tissue.Blood || frame.tissue[idx + d] === Tissue.Blood)
            isBlood = true;
          if (li > 0 && frame.tissue[idx - samples] === Tissue.Blood) isBlood = true;
          if (li < lines - 1 && frame.tissue[idx + samples] === Tissue.Blood) isBlood = true;
        }
      }
      if (!isBlood) continue;
      axialVelocity(idx, li, si, tmp);
      if (!tmp.present) continue;
      const g = (li - liMin) * nS + (si - siMin);
      cellV[g] = s.invert ? -tmp.v : tmp.v;
      cellDisp[g] = tmp.disp;
      cellRel[g] = Math.min(1, relTrans);
    }
  }
  // the estimate of this update (decision 300): a packet of echoes per sample, wall-filtered and autocorrelated
  const kasai =
    estimate && nL > 0 && nS > 0
      ? kasaiEstimate(cellV, cellDisp, cellRel, liMin, siMin, nL, nS, s, estimate)
      : null;
  for (let li = liMin; li <= liMax; li++) {
    for (let si = siMin; si <= siMax; si++) {
      const g = (li - liMin) * nS + (si - siMin);
      const vTrue = cellV[g]!;
      if (Number.isNaN(vTrue)) continue;
      const idx = li * samples + si;
      let power: number;
      let vEstimate: number;
      let variance: number;
      if (kasai) {
        if (Number.isNaN(kasai.velocity[g]!)) continue;
        power = Math.min(1, gainLin * kasai.power[g]!);
        vEstimate = kasai.velocity[g]!;
        variance = kasai.variance[g]!;
      } else {
        // the expected field: the wall filter's response on the true velocity, its spectral spread as variance
        if (Math.abs(vTrue) < s.wallFilterMps) continue;
        power = Math.min(
          1,
          gainLin * cellRel[g]! * wallFilterResponse(Math.abs(vTrue), s.wallFilterMps),
        );
        vEstimate = vTrue;
        variance = Math.min(1, cellDisp[g]! * 1.6);
      }
      if (power < COLOR_THRESHOLD) continue; // below the display threshold: weak signal not shown
      const v = aliasVelocity(vEstimate, s.scaleMps, s.baselineShiftMps);
      let vel = v;
      let pow = power;
      const pv = history ? (history.vel[idx] ?? NaN) : NaN;
      if (history && !Number.isNaN(pv)) {
        const p = s.persistence;
        const pp = history.power[idx] ?? power;
        const a1 = (Math.PI * (v - s.baselineShiftMps)) / s.scaleMps;
        const a0 = (Math.PI * (pv - s.baselineShiftMps)) / s.scaleMps;
        const re = (1 - p) * power * Math.cos(a1) + p * pp * Math.cos(a0);
        const im = (1 - p) * power * Math.sin(a1) + p * pp * Math.sin(a0);
        vel = aliasVelocity(
          s.baselineShiftMps + (s.scaleMps * Math.atan2(im, re)) / Math.PI,
          s.scaleMps,
          s.baselineShiftMps,
        );
        variance = variance * (1 - p) + (history.variance[idx] ?? variance) * p;
        pow = power * (1 - p) + pp * p;
      }
      out.vel[idx] = vel;
      out.variance[idx] = variance;
      out.power[idx] = pow;
    }
  }
  return { colorLines: Math.max(0, liMax - liMin + 1) };
}

export { colorMap } from '@/simulator/renderer/postprocess/colorMap';

/**
 * Blend a polar colour field over a scan-converted grey image (85 % colour, 15 % grey) inside the colour
 * box, using the nearest polar sample of each pixel. The GPU present pass (gpu/glslImage.ts) does the same.
 */
export function overlayColorField(
  rgba: Uint8ClampedArray,
  lut: ScanLut,
  vel: Float32Array,
  variance: Float32Array,
  c: ColorSettings,
): void {
  const rgb: [number, number, number] = [0, 0, 0];
  const S = lut.samples;
  const n = lut.idx.length;
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    if ((lut.idx[p] ?? -1) < 0) continue;
    const r = lut.rCm[p] ?? 0;
    if (r < c.boxRMinCm || r > c.boxRMaxCm) continue;
    const th = lut.theta[p] ?? 0;
    if (th < c.boxThetaMinRad || th > c.boxThetaMaxRad) continue;
    const k = (lut.li[p] ?? 0) * S + (lut.si[p] ?? 0);
    const v = vel[k];
    if (v === undefined || Number.isNaN(v)) continue;
    colorMap(v, c.scaleMps, variance[k] ?? 0, c.showVariance, rgb);
    const g = rgba[o] ?? 0;
    rgba[o] = Math.round(rgb[0] * COLOR_BLEND + g * (1 - COLOR_BLEND));
    rgba[o + 1] = Math.round(rgb[1] * COLOR_BLEND + g * (1 - COLOR_BLEND));
    rgba[o + 2] = Math.round(rgb[2] * COLOR_BLEND + g * (1 - COLOR_BLEND));
  }
}
