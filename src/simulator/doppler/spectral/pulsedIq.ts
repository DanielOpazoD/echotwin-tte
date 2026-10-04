import { SPEED_OF_SOUND_MPS } from '@/core/units';
import { hash3 } from '@/core/random';
import { APERTURE_MM } from '@/simulator/probe/transducer';
import {
  SPECTRAL_BINS,
  spectralRange,
  type SpectralSettings,
  type VelocitySample,
} from './spectrum';

/** One contiguous slow-time packet. B-mode gaps alter packet availability, not its intra-packet PRF. */
export function pulsedPacketTiming(scaleMps: number, frequencyMHz: number, count = SPECTRAL_BINS) {
  const prfHz = (4 * frequencyMHz * 1e6 * scaleMps) / SPEED_OF_SOUND_MPS;
  if (!(prfHz > 0) || !Number.isFinite(prfHz)) throw new Error('Invalid pulsed acquisition');
  return { prfHz, durationS: count / prfHz };
}

/** In-place radix-2 complex FFT, forward convention exp(-i 2πkn/N). */
export function complexFft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || n < 2 || n & (n - 1))
    throw new Error('FFT needs equal power-of-two arrays');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const c = Math.cos((-2 * Math.PI) / size),
      s = Math.sin((-2 * Math.PI) / size);
    for (let start = 0; start < n; start += size) {
      let wr = 1,
        wi = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j,
          b = a + size / 2;
        const tr = wr * re[b]! - wi * im[b]!,
          ti = wr * im[b]! + wi * re[b]!;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const next = wr * c - wi * s;
        wi = wr * s + wi * c;
        wr = next;
      }
    }
  }
}

export interface IqTone {
  velocityMps: number;
  power: number;
  phaseRad: number;
}
/** Complex baseband from phase increments 2 f0 v / c. Velocity is frozen within this packet.
 * No RF propagation solver: gate samples already supply acoustic access and spatial velocities.
 */
export function synthesizeIq(
  tones: readonly IqTone[],
  frequencyMHz: number,
  prfHz: number,
  timeS: number,
  re: Float64Array,
  im: Float64Array,
): void {
  re.fill(0);
  im.fill(0);
  for (const tone of tones) {
    if (!(tone.power > 0)) continue;
    const fd = (2 * frequencyMHz * 1e6 * tone.velocityMps) / SPEED_OF_SOUND_MPS;
    const angle = (2 * Math.PI * fd) / prfHz,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const phase = tone.phaseRad + 2 * Math.PI * fd * timeS;
    let ar = Math.sqrt(tone.power) * Math.cos(phase),
      ai = Math.sqrt(tone.power) * Math.sin(phase);
    for (let i = 0; i < re.length; i++) {
      re[i] = re[i]! + ar;
      im[i] = im[i]! + ai;
      const next = ar * c - ai * s;
      ai = ar * s + ai * c;
      ar = next;
    }
  }
}

const PACKET = SPECTRAL_BINS;
const REALIZATIONS = 4;
// Midpoint quadrature of |N(0,1)|: Phi^-1((1 + (k+0.5)/5)/2).
// sqrt(-2 ln U) is Rayleigh, not half-normal, and incorrectly shifts the modal velocity.
const HALF_NORMAL_QUANTILES = [
  0.12566134685507413, 0.3853204664075676, 0.6744897501960817, 1.0364333894937894,
  1.6448536269514715,
] as const;
const MICROSCATTERERS = HALF_NORMAL_QUANTILES.length;
const re = new Float64Array(PACKET),
  im = new Float64Array(PACKET);
const window = Float64Array.from(
  { length: PACKET },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / PACKET),
);
const windowPower = window.reduce((a, b) => a + b * b, 0);

/** IQ → Hann window → FFT power → ideal sampled-frequency wall filter → displayed velocity bins.
 * Four independent scattering realizations reduce periodogram variance. They share the same packet time,
 * not four successive time windows. Microvelocity spread is an explicit subgrid model, not CFD.
 */
export function accumulatePulsedSpectrum(
  samples: readonly VelocitySample[],
  s: SpectralSettings,
  frequencyMHz: number,
  seed: number,
  timeS: number,
  out: Float32Array,
): void {
  const { prfHz, durationS } = pulsedPacketTiming(s.scaleMps, frequencyMHz);
  const { vMin, vMax } = spectralRange(s),
    span = vMax - vMin;
  out.fill(0);
  for (let ensemble = 0; ensemble < REALIZATIONS; ensemble++) {
    const tones: IqTone[] = [];
    for (let j = 0; j < samples.length; j++) {
      const p = samples[j]!;
      if (!(p.weight > 0)) continue;
      const aperture =
        p.vPerp && p.depthCm ? (Math.abs(p.vPerp) * (APERTURE_MM / 10)) / p.depthCm : 0;
      for (let k = 0; k < MICROSCATTERERS; k++) {
        // Half-normal deceleration, capped at zero; aperture rays span D/F uniformly.
        const turbulent = Math.min(
          Math.abs(p.v),
          0.9 * p.dispersion * Math.abs(p.v) * HALF_NORMAL_QUANTILES[k]!,
        );
        const geometric = aperture * (hash3(j, k, ensemble + 103, seed) - 0.5);
        const v = p.v - Math.sign(p.v) * turbulent + geometric;
        tones.push({
          velocityMps: v,
          power: p.weight / MICROSCATTERERS,
          phaseRad: 2 * Math.PI * hash3(j, k, ensemble + 211, seed),
        });
      }
    }
    // Strip timestamps denote the packet centre, not its first pulse.
    synthesizeIq(tones, frequencyMHz, prfHz, timeS - durationS / 2, re, im);
    for (let i = 0; i < PACKET; i++) {
      re[i] = re[i]! * window[i]!;
      im[i] = im[i]! * window[i]!;
    }
    complexFft(re, im);
    for (let k = 0; k < PACKET; k++) {
      const signed = k < PACKET / 2 ? k : k - PACKET;
      const sampledVelocity = (signed * span) / PACKET;
      if (Math.abs(sampledVelocity) < s.wallFilterMps) continue;
      const v = s.invert ? -sampledVelocity : sampledVelocity;
      const b = ((vMax - v) / span) * PACKET - 0.5;
      const floor = Math.floor(b),
        frac = b - floor;
      const power = (re[k]! ** 2 + im[k]! ** 2) / (PACKET * windowPower * REALIZATIONS);
      // Baseline is a circular display shift only; it cannot change the wall filter's physical stop band.
      const b0 = ((floor % PACKET) + PACKET) % PACKET,
        b1 = (b0 + 1) % PACKET;
      out[b0] = out[b0]! + power * (1 - frac);
      out[b1] = out[b1]! + power * frac;
    }
  }
}
