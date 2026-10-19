/**
 * The physics reference of the phantom benchmarks (decision 343): the pulse-echo response of a point scatterer seen by a
 * phased array with delay-and-sum beamforming, computed the way Field II does it (Jensen 1996; Jensen & Svendsen 1992)
 * except for the element size: point elements on a line, a fixed transmit focus, dynamic receive focusing with an
 * aperture that grows as F-number × depth, and the pulse of the Field II examples (a two-cycle sine excitation through a
 * two-cycle Hanning-weighted impulse response, on transmit and on receive). The simulator does not use this: it draws
 * its point response from closed formulas (`renderer/acoustic/psf.ts`), and this is what those formulas are measured
 * against.
 *
 * Units: mm, µs, MHz; sound speed 1.54 mm/µs.
 */

export const SOUND_SPEED_MM_PER_US = 1.54;

export interface ArrayParams {
  /** Centre frequency of the pulse (MHz). */
  f0MHz: number;
  elements: number;
  /** Width of the whole array (mm); the pitch is apertureMm / elements. */
  apertureMm: number;
  /** Fixed transmit focus on each line (mm). */
  txFocusMm: number;
  apodization: 'rect' | 'hanning';
  /** Receive F-number: the receive aperture is min(array, depth / F). 0 keeps the whole array. */
  rxFNumber: number;
  /** Cycles of the excitation and of each impulse response (Field II examples: 2 and 2). */
  excitationCycles?: number;
  impulseCycles?: number;
}

export interface Pulse {
  /** Analytic pulse-echo waveform (real and imaginary parts), sampled every dtUs, envelope peak at index `peak`. */
  re: Float64Array;
  im: Float64Array;
  dtUs: number;
  peak: number;
}

/** In-place radix-2 complex FFT (length a power of two); `inverse` scales by 1/n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang),
      wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k,
          b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci,
          ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
}

/** Analytic signal of a real waveform (FFT Hilbert transform, zero-padded to a power of two). */
export function analytic(x: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  let n = 1;
  while (n < 2 * x.length) n <<= 1;
  const re = new Float64Array(n),
    im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i]!;
  fft(re, im);
  for (let k = 1; k < n / 2; k++) {
    re[k] = re[k]! * 2;
    im[k] = im[k]! * 2;
  }
  for (let k = n / 2 + 1; k < n; k++) re[k] = im[k] = 0;
  fft(re, im, true);
  return { re: re.slice(0, x.length), im: im.slice(0, x.length) };
}

function convolve(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) out[i + j]! += a[i]! * b[j]!;
  return out;
}

/** The two-way pulse of the Field II examples at `f0MHz`, sampled at `fsMHz`, as an analytic waveform. */
export function fieldIiPulse(
  f0MHz: number,
  excitationCycles = 2,
  impulseCycles = 2,
  fsMHz = 200,
): Pulse {
  const dt = 1 / fsMHz;
  const exc = Float64Array.from(
    { length: Math.round((excitationCycles / f0MHz) * fsMHz) + 1 },
    (_, i) => Math.sin(2 * Math.PI * f0MHz * i * dt),
  );
  const nImp = Math.round((impulseCycles / f0MHz) * fsMHz) + 1;
  const imp = Float64Array.from(
    { length: nImp },
    (_, i) =>
      Math.sin(2 * Math.PI * f0MHz * i * dt) *
      (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (nImp - 1))),
  );
  const w = convolve(convolve(exc, imp), imp);
  const { re, im } = analytic(w);
  let peak = 0,
    best = -1;
  for (let i = 0; i < re.length; i++) {
    const e = re[i]! ** 2 + im[i]! ** 2;
    if (e > best) {
      best = e;
      peak = i;
    }
  }
  return { re, im, dtUs: dt, peak };
}

/** Envelope −6 dB duration of the pulse (µs) and the axial resolution it implies, c·Δt/2 (mm). */
export function pulseAxialFwhmMm(p: Pulse): number {
  const env = Float64Array.from(p.re, (r, i) => Math.hypot(r, p.im[i]!));
  const peak = env[p.peak]!;
  const half = peak / 2;
  let l = p.peak,
    r = p.peak;
  while (l > 0 && env[l - 1]! >= half) l--;
  while (r < env.length - 1 && env[r + 1]! >= half) r++;
  const li = l > 0 ? l - 1 + (half - env[l - 1]!) / (env[l]! - env[l - 1]!) : l;
  const ri = r < env.length - 1 ? r + (env[r]! - half) / (env[r]! - env[r + 1]!) : r;
  return ((ri - li) * p.dtUs * SOUND_SPEED_MM_PER_US) / 2;
}

function apodization(kind: ArrayParams['apodization'], u: number): number {
  // u ∈ [−½, ½] across the active aperture
  if (Math.abs(u) > 0.5) return 0;
  return kind === 'rect' ? 1 : 0.5 + 0.5 * Math.cos(2 * Math.PI * u);
}

/** Element x positions (mm), centred on 0. */
export function elementPositions(p: ArrayParams): Float64Array {
  const pitch = p.apertureMm / p.elements;
  return Float64Array.from({ length: p.elements }, (_, k) => (k - (p.elements - 1) / 2) * pitch);
}

/** Receive weights at depth r: the apodization over the active aperture min(array, r / F). */
function rxWeights(p: ArrayParams, xs: Float64Array, rMm: number): Float64Array {
  const width = p.rxFNumber > 0 ? Math.min(p.apertureMm, rMm / p.rxFNumber) : p.apertureMm;
  return Float64Array.from(xs, (x) => apodization(p.apodization, x / Math.max(width, 1e-6)));
}

/**
 * Complex beamformed value at the image point (line angle θ, depth r) for a unit scatterer at (px, pz): Σⱼ bⱼ Σᵢ aᵢ
 * w(t_Q,j − tᵢⱼ), with tᵢⱼ the transmit delay of element i plus the flight e_i → P → e_j and t_Q,j = r/c + |Q − e_j|/c
 * the receive focusing time of element j.
 */
export function beamformedSample(
  p: ArrayParams,
  pulse: Pulse,
  xs: Float64Array,
  thetaRad: number,
  rMm: number,
  px: number,
  pz: number,
): { re: number; im: number } {
  const c = SOUND_SPEED_MM_PER_US;
  const s = Math.sin(thetaRad),
    co = Math.cos(thetaRad);
  const fx = p.txFocusMm * s,
    fz = p.txFocusMm * co;
  const qx = rMm * s,
    qz = rMm * co;
  const b = rxWeights(p, xs, rMm);
  const n = xs.length;
  // transmit: the delay that makes element i reach the focus at Rf / c, then its flight to P
  const txT = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const delay = (p.txFocusMm - Math.hypot(xs[i]! - fx, fz)) / c;
    txT[i] = delay + Math.hypot(xs[i]! - px, pz) / c;
  }
  const a = Float64Array.from(xs, (x) => apodization(p.apodization, x / p.apertureMm));
  let sr = 0,
    si = 0;
  const last = pulse.re.length - 1;
  for (let j = 0; j < n; j++) {
    if (b[j] === 0) continue;
    const back = Math.hypot(px - xs[j]!, pz) / c;
    const tq = rMm / c + Math.hypot(qx - xs[j]!, qz) / c;
    for (let i = 0; i < n; i++) {
      if (a[i] === 0) continue;
      const tau = tq - (txT[i]! + back);
      const f = pulse.peak + tau / pulse.dtUs;
      if (f < 0 || f >= last) continue;
      const k = Math.floor(f),
        u = f - k;
      const w = a[i]! * b[j]!;
      sr += w * (pulse.re[k]! * (1 - u) + pulse.re[k + 1]! * u);
      si += w * (pulse.im[k]! * (1 - u) + pulse.im[k + 1]! * u);
    }
  }
  return { re: sr, im: si };
}

export interface PointResponse {
  /** −6 dB widths (mm). */
  axialMm: number;
  lateralMm: number;
  /** Lateral profile: the maximum envelope over depth on each line, against the arc R·θ (mm). */
  lateral: { xMm: Float64Array; env: Float64Array };
  axial: { rMm: Float64Array; env: Float64Array };
}

const widthAtHalf = (env: Float64Array, spacing: number): number => {
  let ip = 0;
  for (let i = 1; i < env.length; i++) if (env[i]! > env[ip]!) ip = i;
  const half = env[ip]! / 2;
  let l = ip,
    r = ip;
  while (l > 0 && env[l - 1]! >= half) l--;
  while (r < env.length - 1 && env[r + 1]! >= half) r++;
  const li = l > 0 ? l - 1 + (half - env[l - 1]!) / (env[l]! - env[l - 1]!) : NaN;
  const ri = r < env.length - 1 ? r + (env[r]! - half) / (env[r]! - env[r + 1]!) : NaN;
  return (ri - li) * spacing;
};

/**
 * Broadband point response of a scatterer on the central line at depth `depthMm`: the axial envelope along that line and
 * the lateral profile over ±`halfWidthMm` of arc, each line's maximum over ±`searchMm` of depth (the projection a
 * resolution measurement takes).
 */
export function pointResponse(
  p: ArrayParams,
  depthMm: number,
  opts: {
    halfWidthMm?: number;
    lateralStepMm?: number;
    searchMm?: number;
    axialStepMm?: number;
  } = {},
): PointResponse {
  const pulse = fieldIiPulse(p.f0MHz, p.excitationCycles, p.impulseCycles);
  const xs = elementPositions(p);
  const halfWidth = opts.halfWidthMm ?? 8;
  const latStep = opts.lateralStepMm ?? 0.1;
  const search = opts.searchMm ?? 1.5;
  const axStep = opts.axialStepMm ?? 0.02;
  const ax = Math.round((2 * search) / axStep) + 1;
  const rMm = Float64Array.from({ length: ax }, (_, k) => depthMm - search + k * axStep);
  const axialEnv = Float64Array.from(rMm, (r) => {
    const v = beamformedSample(p, pulse, xs, 0, r, 0, depthMm);
    return Math.hypot(v.re, v.im);
  });
  const nl = Math.round((2 * halfWidth) / latStep) + 1;
  const xMm = Float64Array.from({ length: nl }, (_, k) => -halfWidth + k * latStep);
  const coarse = Math.max(axStep, 0.05);
  const latEnv = Float64Array.from(xMm, (x) => {
    const theta = x / depthMm;
    let best = 0;
    for (let r = depthMm - search; r <= depthMm + search + 1e-9; r += coarse) {
      const v = beamformedSample(p, pulse, xs, theta, r, 0, depthMm);
      best = Math.max(best, Math.hypot(v.re, v.im));
    }
    return best;
  });
  return {
    axialMm: widthAtHalf(axialEnv, axStep),
    lateralMm: widthAtHalf(latEnv, latStep),
    lateral: { xMm, env: latEnv },
    axial: { rMm, env: axialEnv },
  };
}

/**
 * Narrowband (continuous-wave) lateral profile at the depth of a scatterer on the central line: |T(P; θ)|ᵖ · |R(P; θ)|,
 * the transmit field focused on line θ reaching P at `txMHz` (raised to the power 2 for a second-harmonic source) times
 * the receive sensitivity of line θ focused at P's depth at `rxMHz`. The first-order model of tissue harmonic imaging
 * (harmonic source ∝ p², received at twice the transmit frequency); with `harmonic` false and equal frequencies it is the
 * fundamental pulse-echo beam, whose −6 dB width at the focus with a rectangular aperture is 0.886 λF.
 */
export function narrowbandLateral(
  p: ArrayParams,
  depthMm: number,
  txMHz: number,
  rxMHz: number,
  harmonic: boolean,
  halfWidthMm = 8,
  stepMm = 0.02,
): { xMm: Float64Array; env: Float64Array; widthMm: number } {
  const xs = elementPositions(p);
  const c = SOUND_SPEED_MM_PER_US;
  const kt = (2 * Math.PI * txMHz) / c,
    kr = (2 * Math.PI * rxMHz) / c;
  const a = Float64Array.from(xs, (x) => apodization(p.apodization, x / p.apertureMm));
  const b = rxWeights(p, xs, depthMm);
  const n = Math.round((2 * halfWidthMm) / stepMm) + 1;
  const xMm = Float64Array.from({ length: n }, (_, k) => -halfWidthMm + k * stepMm);
  const env = Float64Array.from(xMm, (x) => {
    const theta = x / depthMm;
    const s = Math.sin(theta),
      co = Math.cos(theta);
    let tr = 0,
      ti = 0,
      rr = 0,
      ri = 0;
    for (let i = 0; i < xs.length; i++) {
      // phase of element i's wave at P = (0, depth), focused on line θ at the transmit focus
      const delay = p.txFocusMm - Math.hypot(xs[i]! - p.txFocusMm * s, p.txFocusMm * co);
      const ph = kt * (delay + Math.hypot(xs[i]!, depthMm));
      tr += a[i]! * Math.cos(ph);
      ti -= a[i]! * Math.sin(ph);
      // receive focused at Q = depth on line θ, listening to P
      const phr =
        kr * (Math.hypot(xs[i]!, depthMm) - Math.hypot(xs[i]! - depthMm * s, depthMm * co));
      rr += b[i]! * Math.cos(phr);
      ri -= b[i]! * Math.sin(phr);
    }
    const t = Math.hypot(tr, ti);
    return (harmonic ? t * t : t) * Math.hypot(rr, ri);
  });
  return { xMm, env, widthMm: widthAtHalf(env, stepMm) };
}

export interface ComplexGrid {
  /** Columns across the beam (x) and rows along it (z), row-major: index ix + iz·nx. */
  nx: number;
  nz: number;
  dxMm: number;
  dzMm: number;
  re: Float64Array;
  im: Float64Array;
}

/**
 * Complex 2-D point response around a scatterer on the central line at `depthMm`, on a grid of ±halfX across (arc) and
 * ±halfZ along the beam: the space-invariant kernel of the convolution model of speckle at that depth (Bamber & Dickinson
 * 1980), which is what a Field II image of many scatterers sums locally.
 */
export function psf2d(
  p: ArrayParams,
  depthMm: number,
  halfXMm: number,
  dxMm: number,
  halfZMm: number,
  dzMm: number,
): ComplexGrid {
  const pulse = fieldIiPulse(p.f0MHz, p.excitationCycles, p.impulseCycles);
  const xs = elementPositions(p);
  const nx = 2 * Math.round(halfXMm / dxMm) + 1,
    nz = 2 * Math.round(halfZMm / dzMm) + 1;
  const re = new Float64Array(nx * nz),
    im = new Float64Array(nx * nz);
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++) {
      const x = (ix - (nx - 1) / 2) * dxMm,
        z = (iz - (nz - 1) / 2) * dzMm;
      // the image point on line θ = x / depth at depth + z, the scatterer fixed on the axis
      const v = beamformedSample(p, pulse, xs, x / depthMm, depthMm + z, 0, depthMm);
      re[ix + iz * nx] = v.re;
      im[ix + iz * nx] = v.im;
    }
  return { nx, nz, dxMm, dzMm, re, im };
}

/**
 * Envelope of a scatterer field convolved with a complex kernel (both on the same grid spacing): |Σ s(x−u) h(u)|. The
 * field is real amplitudes times a random phase, one scatterer per cell, as Field II's random scatterer phantoms.
 * Returns the envelope over the field's grid (the kernel's support outside the field reads zero).
 */
export function convolveEnvelope(
  fieldRe: Float64Array,
  fieldIm: Float64Array,
  nx: number,
  nz: number,
  h: ComplexGrid,
): Float64Array {
  const out = new Float64Array(nx * nz);
  const hx = (h.nx - 1) / 2,
    hz = (h.nz - 1) / 2;
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++) {
      let sr = 0,
        si = 0;
      for (let kz = 0; kz < h.nz; kz++) {
        const zz = z - (kz - hz);
        if (zz < 0 || zz >= nz) continue;
        const row = zz * nx,
          krow = kz * h.nx;
        for (let kx = 0; kx < h.nx; kx++) {
          const xx = x - (kx - hx);
          if (xx < 0 || xx >= nx) continue;
          const fr = fieldRe[row + xx]!,
            fi = fieldIm[row + xx]!;
          if (fr === 0 && fi === 0) continue;
          const kr = h.re[krow + kx]!,
            ki = h.im[krow + kx]!;
          sr += fr * kr - fi * ki;
          si += fr * ki + fi * kr;
        }
      }
      out[x + z * nx] = Math.hypot(sr, si);
    }
  return out;
}
