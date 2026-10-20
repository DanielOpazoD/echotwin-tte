/**
 * Phantom benchmarks of the image formation in isolation (decision 344): point targets, an anechoic cyst and uniform
 * speckle, formed by the simulator's own stages and by the Field II–style delay-and-sum reference
 * (`src/clinical/realism/dasReference.ts`) for the same transducer, and measured with the same code.
 *
 * What the simulator side runs, on a phantom instead of the anatomy: the polar grid of the high tier, the complex
 * scatterer phasor of `ProceduralSliceRenderer` (two value-noise lattices at SCATTER_FREQ and ×SCATTER_FREQ_RATIO, one
 * pair per compounding look shifted by LOOK_SHIFT, scaled by PHASOR_NORM), the focusing gain, a point target as a
 * coherent echo on the nearest sample (how the tracer deposits an interface), the PSF kernel table with its side lobes
 * and the envelope detection with compounding (`formEnvelope`). Left out because a phantom has none: attenuation and the
 * beam march, the slice-thickness average, the grains and heterogeneity of tissue, clutter. The console is applied only
 * where a figure is read on the displayed grey.
 */
import { latticeNoise3, noiseLattice } from '@/core/noise';
import {
  COMPOUND_LOOKS,
  LOOK_SHIFT,
  PHASOR_IM_A,
  PHASOR_IM_B,
  PHASOR_NORM,
  PHASOR_RE_B,
  SCATTER_FREQ,
  SCATTER_FREQ_RATIO,
  focusingGain,
} from '@/simulator/renderer/acoustic/acoustics';
import {
  APERTURE_MM,
  axialFwhmMm,
  buildPsfKernels,
  formEnvelope,
  lateralFwhmMm,
  sideLobeLevelDb,
} from '@/simulator/renderer/acoustic/psf';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type PolarFrameSpec,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import {
  LATTICE_FORMATION,
  type ImageFormation,
} from '@/simulator/renderer/procedural/sliceRenderer';
import { sliceHalfWidthCm } from '@/simulator/renderer/acoustic/psf';
import {
  convolveEnvelope,
  narrowbandLateral,
  pointResponse,
  psf2d,
  type ArrayParams,
} from '@/clinical/realism/dasReference';
import { cnr, contrastDb, gcnr, widthAtLevel } from '@/clinical/realism/resolution';
import {
  envelopeSnr,
  kAlphaFromEnvelope,
  logMoments,
  nakagamiMFromLogSkew,
  RAYLEIGH_SNR,
  kernelSpeckleCell,
  SNR_WINDOW,
  speckleCell,
  windowedSnr,
} from '@/clinical/realism/speckleStats';
import { seededRandom } from '@/clinical/realism/turing';

const [PRB_X, PRB_Y, PRB_Z] = PHASOR_RE_B;
const [PIA_X, PIA_Y, PIA_Z] = PHASOR_IM_A;
const [PIB_X, PIB_Y, PIB_Z] = PHASOR_IM_B;

/** The transducer the reference models: the simulator's aperture and default focus, 64 elements, rx F-number 1. */
export function referenceArray(
  apodization: ArrayParams['apodization'],
  f0MHz = DEFAULT_ACQUISITION.frequencyMHz,
): ArrayParams {
  return {
    f0MHz,
    elements: 64,
    apertureMm: APERTURE_MM,
    txFocusMm: DEFAULT_ACQUISITION.focusCm * 10,
    apodization,
    rxFNumber: 1,
  };
}

interface Phantom {
  /** Backscatter σ at (x, z) cm, x across and z along the central line. */
  sigma(x: number, z: number): number;
  points: { x: number; z: number; amplitude: number }[];
}

interface SimFrame {
  spec: PolarFrameSpec;
  /** Compounded envelope, lines × samples. */
  amplitude: Float32Array;
  /** Envelope of the first look alone. */
  singleLook: Float32Array;
}

const SEED = 343;

/** FWHM of a Gaussian over its standard deviation. */
const FWHM_PER_SIGMA = 2 * Math.sqrt(2 * Math.log(2));

/**
 * One phantom frame through the simulator's stages (see the header), or through another image formation (decision
 * 351): point scatterers on the plane's axes (forward along the central line, lateral across it) with their kernels and
 * looks.
 */
function simFrame(
  ph: Phantom,
  harmonics: boolean,
  seed = SEED,
  fm: ImageFormation = LATTICE_FORMATION,
): SimFrame {
  const looks = fm.looks;
  const settings = { ...DEFAULT_ACQUISITION, harmonics };
  const spec = polarSpecFor(settings, 'high');
  const n = spec.lines * spec.samples;
  const dr = spec.depthCm / spec.samples;
  const latA = noiseLattice(seed),
    latB = noiseLattice(seed ^ 0x2545f491),
    latC = noiseLattice(seed ^ 0x51);
  const R = SCATTER_FREQ_RATIO;
  const re = new Float32Array(n * looks),
    im = new Float32Array(n * looks);
  const field = fm.scatterers;
  const kWave = field ? field.wavenumber(settings.frequencyMHz, harmonics) : 0;
  const dTheta = spec.sectorRad / spec.lines;
  const ph1 = { re: 0, im: 0 };
  for (let li = 0; li < spec.lines; li++) {
    const theta = -spec.sectorRad / 2 + (spec.sectorRad * (li + 0.5)) / spec.lines;
    for (let si = 0; si < spec.samples; si++) {
      const r = (si + 0.5) * dr;
      const x = r * Math.sin(theta),
        z = r * Math.cos(theta);
      const sigma = ph.sigma(x, z) * focusingGain(r, spec.focusCm);
      if (sigma === 0) continue;
      const qx = x * SCATTER_FREQ,
        qy = z * SCATTER_FREQ,
        qz = 0;
      const idx = li * spec.samples + si;
      if (field) {
        field.phasor(
          z,
          x,
          0,
          Math.cos(theta),
          Math.sin(theta),
          r,
          dr,
          r * dTheta,
          (2 * sliceHalfWidthCm(r)) / FWHM_PER_SIGMA,
          kWave,
          seed,
          ph1,
        );
        re[idx] = sigma * ph1.re;
        im[idx] = sigma * ph1.im;
        continue;
      }
      for (let k = 0; k < COMPOUND_LOOKS; k++) {
        const [sx, sy, sz] = LOOK_SHIFT[k]!;
        const zr =
          (latticeNoise3(qx + sx, qy + sy, qz + sz, latA) +
            latticeNoise3(qx * R + PRB_X + sx, qy * R + PRB_Y + sy, qz * R + PRB_Z + sz, latB) -
            1) *
          PHASOR_NORM;
        const zi =
          (latticeNoise3(qx + PIA_X + sx, qy + PIA_Y + sy, qz + PIA_Z + sz, latC) +
            latticeNoise3(qx * R + PIB_X + sx, qy * R + PIB_Y + sy, qz * R + PIB_Z + sz, latA) -
            1) *
          PHASOR_NORM;
        re[k * n + idx] = sigma * zr;
        im[k * n + idx] = sigma * zi;
      }
    }
  }
  // point targets: a coherent echo on the nearest sample, the same in every look
  for (const p of ph.points) {
    const r = Math.hypot(p.x, p.z),
      theta = Math.atan2(p.x, p.z);
    const li = Math.round(((theta + spec.sectorRad / 2) / spec.sectorRad) * spec.lines - 0.5);
    const si = Math.round(r / dr - 0.5);
    if (li < 0 || li >= spec.lines || si < 0 || si >= spec.samples) continue;
    const a = p.amplitude * focusingGain(r, spec.focusCm);
    for (let k = 0; k < looks; k++) re[k * n + li * spec.samples + si]! += a;
  }
  const kernels = fm.kernels
    ? fm.kernels(spec, settings.frequencyMHz, harmonics)
    : buildPsfKernels(spec, settings.frequencyMHz, harmonics, 0, sideLobeLevelDb(0));
  const amplitude = new Float32Array(n),
    singleLook = new Float32Array(n),
    tmp = new Float32Array(n),
    tRe = new Float32Array(n),
    tIm = new Float32Array(n);
  for (let k = 0; k < looks; k++) {
    formEnvelope(
      re.subarray(k * n, (k + 1) * n),
      im.subarray(k * n, (k + 1) * n),
      spec.lines,
      spec.samples,
      kernels,
      tmp,
      tRe,
      tIm,
    );
    if (k === 0) singleLook.set(tmp);
    for (let i = 0; i < n; i++) amplitude[i]! += tmp[i]! / looks;
  }
  return { spec, amplitude, singleLook };
}

/** Displayed grey (0–255, polar) of a phantom frame through the default console without depth compensation. */
function displayed(f: SimFrame): Uint8ClampedArray {
  const frame = allocPolarFrame(f.spec);
  frame.amplitude.set(f.amplitude);
  frame.transmission.fill(1);
  const out = new Uint8ClampedArray(f.spec.lines * f.spec.samples);
  applyConsole(
    frame,
    { ...DEFAULT_ACQUISITION, depthCompensationDbPerCmMHz: 0 },
    createConsoleState(SEED),
    out,
  );
  return out;
}

/** Peak side-lobe level (dB under the main-lobe peak) of a lateral profile: the highest local maximum beyond −6 dB lobes. */
function peakSideLobeDb(env: ArrayLike<number>): number {
  let ip = 0;
  for (let i = 1; i < env.length; i++) if (env[i]! > env[ip]!) ip = i;
  const peak = env[ip]!;
  // walk down the main lobe to its first null (first local minimum) on each side
  let l = ip,
    r = ip;
  while (l > 0 && env[l - 1]! <= env[l]!) l--;
  while (r < env.length - 1 && env[r + 1]! <= env[r]!) r++;
  let side = 0;
  for (let i = 0; i < env.length; i++) if (i < l || i > r) side = Math.max(side, env[i]!);
  return side > 0 ? 20 * Math.log10(side / peak) : -Infinity;
}

export interface PointRow {
  depthCm: number;
  /** Simulator: the kernel's own FWHM (formula) and the −6 dB width measured on the polar envelope. */
  simAxialFormulaMm: number;
  simAxialMeasuredMm: number;
  simLateralFormulaMm: number;
  simLateralMeasuredMm: number;
  simSideLobeDb: number;
  /** Grid spacing at that depth: along the beam and across it (arc of one line). */
  sampleMm: number;
  lineMm: number;
  /** Reference (delay-and-sum, Field II pulse): rectangular and Hanning apodization. */
  refAxialMm: number;
  refLateralRectMm: number;
  refLateralHanningMm: number;
  refSideLobeRectDb: number;
  refSideLobeHanningDb: number;
}

/** Point targets on the central line at each depth: −6 dB widths and side lobes, fundamental imaging. */
export function pointTargets(
  depthsCm: readonly number[],
  fm: ImageFormation = LATTICE_FORMATION,
): PointRow[] {
  const f = simFrame(
    { sigma: () => 0, points: depthsCm.map((d) => ({ x: 0, z: d, amplitude: 1 })) },
    false,
    SEED,
    fm,
  );
  const { spec } = f;
  const dr = spec.depthCm / spec.samples;
  const dTheta = spec.sectorRad / spec.lines;
  return depthsCm.map((d) => {
    const li = Math.round(((0 + spec.sectorRad / 2) / spec.sectorRad) * spec.lines - 0.5);
    const si = Math.round(d / dr - 0.5);
    const win = 12;
    const axial = Array.from({ length: 2 * win + 1 }, (_, k) => {
      const s = si - win + k;
      return s >= 0 && s < spec.samples ? f.amplitude[li * spec.samples + s]! : 0;
    });
    const lw = 40;
    const lateral = Array.from({ length: 2 * lw + 1 }, (_, k) => {
      const l = li - lw + k;
      return l >= 0 && l < spec.lines ? f.amplitude[l * spec.samples + si]! : 0;
    });
    const rCm = (si + 0.5) * dr;
    const rect = pointResponse(referenceArray('rect'), d * 10, { halfWidthMm: 12 });
    const han = pointResponse(referenceArray('hanning'), d * 10, { halfWidthMm: 12 });
    return {
      depthCm: d,
      simAxialFormulaMm: axialFwhmMm(DEFAULT_ACQUISITION.frequencyMHz, false),
      simAxialMeasuredMm: widthAtLevel(axial, dr * 10),
      simLateralFormulaMm: lateralFwhmMm(
        rCm,
        spec.focusCm,
        DEFAULT_ACQUISITION.frequencyMHz,
        false,
      ),
      simLateralMeasuredMm: widthAtLevel(lateral, rCm * dTheta * 10),
      simSideLobeDb: peakSideLobeDb(lateral),
      sampleMm: dr * 10,
      lineMm: rCm * dTheta * 10,
      refAxialMm: rect.axialMm,
      refLateralRectMm: rect.lateralMm,
      refLateralHanningMm: han.lateralMm,
      refSideLobeRectDb: peakSideLobeDb(rect.lateral.env),
      refSideLobeHanningDb: peakSideLobeDb(han.lateral.env),
    };
  });
}

export interface HarmonicRow {
  depthCm: number;
  /** Simulator's lateral FWHM with harmonics over its fundamental one (0.8 by construction). */
  simRatio: number;
  /** First-order harmonic model (source ∝ p², received at 2f): transmit at f, and transmit at f/2 (received at f). */
  refRatioTxF: number;
  refRatioTxHalfF: number;
}

/** The harmonic setting's lateral narrowing against the narrowband model of tissue harmonic imaging. */
export function harmonicLateral(depthsCm: readonly number[]): HarmonicRow[] {
  const f = DEFAULT_ACQUISITION.frequencyMHz;
  const p = referenceArray('hanning');
  return depthsCm.map((d) => {
    const fund = narrowbandLateral(p, d * 10, f, f, false).widthMm;
    return {
      depthCm: d,
      simRatio:
        lateralFwhmMm(d, DEFAULT_ACQUISITION.focusCm, f, true) /
        lateralFwhmMm(d, DEFAULT_ACQUISITION.focusCm, f, false),
      refRatioTxF: narrowbandLateral(p, d * 10, f, 2 * f, true).widthMm / fund,
      refRatioTxHalfF: narrowbandLateral(p, d * 10, f / 2, f, true).widthMm / fund,
    };
  });
}

export interface CystRow {
  depthCm: number;
  radiusMm: number;
  sim: { contrastDb: number; cnr: number; gcnr: number; gcnrDisplay: number };
  /** Reference with a Hanning apodization (the Field II examples') and with none (the narrowest a 14 mm aperture gives). */
  ref: { contrastDb: number; cnr: number; gcnr: number };
  refRect: { contrastDb: number; cnr: number; gcnr: number };
}

/** Polar samples inside a disc of radius a and in a ring b..c around (0, depth), from a polar envelope. */
function polarRegions(
  spec: PolarFrameSpec,
  values: ArrayLike<number>,
  depthCm: number,
  inCm: number,
  ringIn: number,
  ringOut: number,
): { inside: number[]; outside: number[] } {
  const dr = spec.depthCm / spec.samples;
  const inside: number[] = [],
    outside: number[] = [];
  for (let li = 0; li < spec.lines; li++) {
    const theta = -spec.sectorRad / 2 + (spec.sectorRad * (li + 0.5)) / spec.lines;
    for (let si = 0; si < spec.samples; si++) {
      const r = (si + 0.5) * dr;
      const d = Math.hypot(r * Math.sin(theta), r * Math.cos(theta) - depthCm);
      const v = values[li * spec.samples + si]!;
      if (d < inCm) inside.push(v);
      else if (d > ringIn && d < ringOut) outside.push(v);
    }
  }
  return { inside, outside };
}

/** Support of the reference kernel (mm): beyond it the Hanning-apodized response is under −60 dB at every depth here. */
const REF_KERNEL_HALF_X_MM = 8;
const REF_KERNEL_HALF_Z_MM = 1.6;
/** Grid of the reference images and kernels (mm), across and along the beam. */
const REF_GRID_DX_MM = 0.2;
const REF_GRID_DZ_MM = 0.05;

/** A Field II–style scatterer field (random phase, unit amplitude, one per cell) times a mask, through the reference PSF. */
function referenceImage(
  depthCm: number,
  mask: (xMm: number, zMm: number) => number,
  halfXMm: number,
  halfZMm: number,
  seed: number,
  apodization: ArrayParams['apodization'] = 'hanning',
): { env: Float64Array; nx: number; nz: number; dx: number; dz: number } {
  const dx = REF_GRID_DX_MM,
    dz = REF_GRID_DZ_MM;
  const h = psf2d(
    referenceArray(apodization),
    depthCm * 10,
    REF_KERNEL_HALF_X_MM,
    dx,
    REF_KERNEL_HALF_Z_MM,
    dz,
  );
  const nx = 2 * Math.round(halfXMm / dx) + 1,
    nz = 2 * Math.round(halfZMm / dz) + 1;
  const rand = seededRandom(seed);
  const fr = new Float64Array(nx * nz),
    fi = new Float64Array(nx * nz);
  for (let iz = 0; iz < nz; iz++)
    for (let ix = 0; ix < nx; ix++) {
      const m = mask((ix - (nx - 1) / 2) * dx, (iz - (nz - 1) / 2) * dz);
      if (m === 0) continue;
      // complex Gaussian amplitude: Box–Muller
      const u = Math.max(1e-12, rand()),
        v = rand();
      const g = Math.sqrt(-2 * Math.log(u));
      fr[ix + iz * nx] = m * g * Math.cos(2 * Math.PI * v);
      fi[ix + iz * nx] = m * g * Math.sin(2 * Math.PI * v);
    }
  return { env: convolveEnvelope(fr, fi, nx, nz, h), nx, nz, dx, dz };
}

/** Anechoic cysts of radius `radiusMm` at each depth in uniform speckle: contrast, CNR and gCNR, simulator and reference. */
export function cysts(
  depthsCm: readonly number[],
  radiusMm = 4,
  fm: ImageFormation = LATTICE_FORMATION,
): CystRow[] {
  const a = radiusMm / 10;
  const f = simFrame(
    {
      sigma: (x, z) => (depthsCm.some((d) => Math.hypot(x, z - d) < a) ? 0 : 0.1),
      points: [],
    },
    false,
    SEED,
    fm,
  );
  const disp = displayed(f);
  return depthsCm.map((d, k) => {
    const s = polarRegions(f.spec, f.amplitude, d, 0.75 * a, 1.25 * a, 2.5 * a);
    const sd = polarRegions(f.spec, disp, d, 0.75 * a, 1.25 * a, 2.5 * a);
    // the field reaches a kernel's half-width beyond the ring, so the ring is formed by a complete scatterer field
    const refFigures = (apodization: ArrayParams['apodization']) => {
      const ref = referenceImage(
        d,
        (x, z) => (Math.hypot(x, z) < radiusMm ? 0 : 1),
        2.5 * radiusMm + REF_KERNEL_HALF_X_MM,
        2.5 * radiusMm + REF_KERNEL_HALF_Z_MM,
        SEED + k,
        apodization,
      );
      const inside: number[] = [],
        outside: number[] = [];
      for (let iz = 0; iz < ref.nz; iz++)
        for (let ix = 0; ix < ref.nx; ix++) {
          const r = Math.hypot((ix - (ref.nx - 1) / 2) * ref.dx, (iz - (ref.nz - 1) / 2) * ref.dz);
          const v = ref.env[ix + iz * ref.nx]!;
          if (r < 0.75 * radiusMm) inside.push(v);
          else if (r > 1.25 * radiusMm && r < 2.5 * radiusMm) outside.push(v);
        }
      return {
        contrastDb: contrastDb(inside, outside),
        cnr: cnr(inside, outside),
        gcnr: gcnr(inside, outside),
      };
    };
    return {
      depthCm: d,
      radiusMm,
      sim: {
        contrastDb: contrastDb(s.inside, s.outside),
        cnr: cnr(s.inside, s.outside),
        gcnr: gcnr(s.inside, s.outside),
        gcnrDisplay: gcnr(sd.inside, sd.outside),
      },
      ref: refFigures('hanning'),
      refRect: refFigures('rect'),
    };
  });
}

export interface SpeckleRow {
  depthCm: number;
  /** Envelope SNR: compounded (what the simulator shows), one look, the reference, and Rayleigh theory. */
  simSnr: number;
  simSnrSingleLook: number;
  /** The windowed estimator the myocardium is read with (`windowedSnr`), on this uniform speckle. */
  simWindowedSnr: number;
  refSnr: number;
  theorySnr: number;
  /** Nakagami m from the log-skewness and K α from the intensity moments, compounded and one look. */
  simM: number;
  simMSingleLook: number;
  simKAlphaSingleLook: number;
  refM: number;
  /** Speckle cell: twice the lag (mm) where the envelope autocorrelation falls to ½, along and across the beam. */
  simCellAxialMm: number;
  simCellLateralMm: number;
  refCellAxialMm: number;
  refCellLateralMm: number;
  /** The lateral cell of the reference without apodization. */
  refRectCellLateralMm: number;
}

/** Scatterer realizations of the uniform-speckle phantom: a statistic of one region moves with its realization. */
const SPECKLE_SEEDS = [SEED, SEED + 1, SEED + 2, SEED + 3];

/**
 * Uniform speckle: envelope statistics and speckle cell in a band of ±1.5 cm at each depth over the central ±25°, pooled
 * over SPECKLE_SEEDS for the simulator; the reference forms a 50 × 14 mm field per depth and keeps its part a kernel
 * away from the edges.
 */
export function uniformSpeckle(
  depthsCm: readonly number[],
  fm: ImageFormation = LATTICE_FORMATION,
): SpeckleRow[] {
  const frames = SPECKLE_SEEDS.map((seed) =>
    simFrame({ sigma: () => 0.1, points: [] }, false, seed, fm),
  );
  const { spec } = frames[0]!;
  const dr = spec.depthCm / spec.samples;
  const dTheta = spec.sectorRad / spec.lines;
  return depthsCm.map((d, k) => {
    const sAll: number[] = [],
      sOne: number[] = [];
    const axialSeries: number[][] = [],
      lateralSeries: number[][] = [];
    const s0 = Math.max(0, Math.round((d - 1.5) / dr)),
      s1 = Math.min(spec.samples - 1, Math.round((d + 1.5) / dr));
    const halfLines = Math.round((25 * Math.PI) / 180 / dTheta);
    const l0 = Math.floor(spec.lines / 2) - halfLines,
      l1 = Math.floor(spec.lines / 2) + halfLines;
    for (const f of frames) {
      for (let li = l0; li <= l1; li++) {
        const col: number[] = [];
        for (let si = s0; si <= s1; si++) {
          sAll.push(f.amplitude[li * spec.samples + si]!);
          sOne.push(f.singleLook[li * spec.samples + si]!);
          col.push(f.amplitude[li * spec.samples + si]!);
        }
        axialSeries.push(col);
      }
      // across the beam only near the band's centre depth, where a line's arc is the depth's
      for (let si = Math.round((d - 0.3) / dr); si <= Math.round((d + 0.3) / dr); si++) {
        const row: number[] = [];
        for (let li = l0; li <= l1; li++) row.push(f.amplitude[li * spec.samples + si]!);
        lateralSeries.push(row);
      }
    }
    const ref = referenceImage(
      d,
      () => 1,
      25 + REF_KERNEL_HALF_X_MM,
      7 + REF_KERNEL_HALF_Z_MM,
      SEED + 100 + k,
    );
    const mx = Math.round(REF_KERNEL_HALF_X_MM / ref.dx),
      mz = Math.round(REF_KERNEL_HALF_Z_MM / ref.dz);
    const core: number[] = [];
    for (let ix = mx; ix < ref.nx - mx; ix++)
      for (let iz = mz; iz < ref.nz - mz; iz++) core.push(ref.env[ix + iz * ref.nx]!);
    // the reference's cells come from its kernels (decision 355): one realization of its field read 2.85–3.60 mm across
    // at 9 cm for a cell of 3.30 mm
    const kernel = (apodization: ArrayParams['apodization']) =>
      psf2d(
        referenceArray(apodization),
        d * 10,
        REF_KERNEL_HALF_X_MM,
        REF_GRID_DX_MM,
        REF_KERNEL_HALF_Z_MM,
        REF_GRID_DZ_MM,
      );
    const hanning = kernel('hanning'),
      rect = kernel('rect');
    return {
      depthCm: d,
      simSnr: envelopeSnr(sAll),
      simSnrSingleLook: envelopeSnr(sOne),
      simWindowedSnr: windowedSnr(
        frames[0]!.amplitude,
        (i) => {
          const li = Math.floor(i / spec.samples),
            si = i % spec.samples;
          return li >= l0 && li <= l1 && si >= s0 && si <= s1;
        },
        spec.lines,
        spec.samples,
        SNR_WINDOW.lines,
        SNR_WINDOW.samples,
      ).median,
      refSnr: envelopeSnr(core),
      theorySnr: RAYLEIGH_SNR,
      simM: nakagamiMFromLogSkew(logMoments(sAll).skewness),
      simMSingleLook: nakagamiMFromLogSkew(logMoments(sOne).skewness),
      simKAlphaSingleLook: kAlphaFromEnvelope(sOne),
      refM: nakagamiMFromLogSkew(logMoments(core).skewness),
      simCellAxialMm: speckleCell(axialSeries, dr * 10),
      simCellLateralMm: speckleCell(lateralSeries, d * dTheta * 10),
      refCellAxialMm: kernelSpeckleCell(hanning, 'z'),
      refCellLateralMm: kernelSpeckleCell(hanning, 'x'),
      refRectCellLateralMm: kernelSpeckleCell(rect, 'x'),
    };
  });
}

export interface PhantomResults {
  points: PointRow[];
  harmonic: HarmonicRow[];
  cysts: CystRow[];
  speckle: SpeckleRow[];
  transducer: {
    f0MHz: number;
    apertureMm: number;
    focusCm: number;
    elements: number;
    rxFNumber: number;
  };
}

export function runPhantoms(fm: ImageFormation = LATTICE_FORMATION): PhantomResults {
  const depths = [3, 5, 7, 9, 11, 13, 15];
  const p = referenceArray('hanning');
  return {
    points: pointTargets(depths, fm),
    harmonic: harmonicLateral([5, 9, 13]),
    cysts: cysts([5, 9, 13], 4, fm),
    speckle: uniformSpeckle([5, 9, 13], fm),
    transducer: {
      f0MHz: p.f0MHz,
      apertureMm: p.apertureMm,
      focusCm: p.txFocusMm / 10,
      elements: p.elements,
      rxFNumber: p.rxFNumber,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = performance.now();
  const r = runPhantoms();
  process.stdout.write(JSON.stringify(r, null, 1) + '\n');
  process.stderr.write(`fantomas en ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);
}
