import { describe, expect, it } from 'vitest';
import {
  envelopeAutocorrelation,
  envelopeCorrelation,
  envelopeSnr,
  impliedDynamicRangeDb,
  kernelSpeckleCell,
  speckleCell,
  iqrDistance,
  kAlphaFromEnvelope,
  logMoments,
  moments,
  nakagamiLogExcessKurtosis,
  nakagamiLogSkew,
  nakagamiMFromLogSkew,
  pearson,
  polygamma,
  quantiles,
  RAYLEIGH_LOG_SKEW,
  RAYLEIGH_LOG_STD_DB,
  RAYLEIGH_SNR,
  realizationStats,
  windowedSnr,
} from './speckleStats';
import { seededRandom } from './turing';

const rand = seededRandom(7);
const exp1 = (): number => -Math.log(Math.max(1e-300, rand()));
/** Rayleigh amplitudes: √ of an exponential intensity. */
const rayleigh = (n: number): Float64Array =>
  Float64Array.from({ length: n }, () => Math.sqrt(exp1()));
/** K amplitudes of integer shape α: intensity = exponential × Gamma(α)/α. */
const kAmplitudes = (n: number, alpha: number): Float64Array =>
  Float64Array.from({ length: n }, () => {
    let g = 0;
    for (let i = 0; i < alpha; i++) g += exp1();
    return Math.sqrt((exp1() * g) / alpha);
  });

describe('polygamma', () => {
  it('matches the closed forms at 1 and ½', () => {
    expect(polygamma(1, 1)).toBeCloseTo(Math.PI ** 2 / 6, 9);
    expect(polygamma(2, 1)).toBeCloseTo(-2 * 1.2020569031595942, 9);
    expect(polygamma(3, 1)).toBeCloseTo(Math.PI ** 4 / 15, 8);
    expect(polygamma(1, 0.5)).toBeCloseTo(Math.PI ** 2 / 2, 9);
  });
  it('keeps the recurrence ψ₁(x) = ψ₁(x+1) + 1/x²', () => {
    for (const x of [0.3, 2.7, 9.1])
      expect(polygamma(1, x)).toBeCloseTo(polygamma(1, x + 1) + 1 / x ** 2, 10);
  });
});

describe('Rayleigh speckle', () => {
  it('has the textbook constants', () => {
    expect(RAYLEIGH_SNR).toBeCloseTo(1.913, 3);
    expect(RAYLEIGH_LOG_SKEW).toBeCloseTo(-1.1395, 4);
    expect(RAYLEIGH_LOG_STD_DB).toBeCloseTo(5.57, 2);
    expect(nakagamiLogExcessKurtosis(1)).toBeCloseTo(2.4, 1);
  });
  it('reads SNR 1.91 and Nakagami m 1 from simulated Rayleigh amplitudes', () => {
    const a = rayleigh(200_000);
    expect(envelopeSnr(a)).toBeCloseTo(RAYLEIGH_SNR, 1);
    const m = nakagamiMFromLogSkew(logMoments(a).skewness);
    expect(m).toBeGreaterThan(0.93);
    expect(m).toBeLessThan(1.07);
    expect(kAlphaFromEnvelope(a)).toBeGreaterThan(30);
  });
  it('recovers the dynamic range a log-compressed grey was made with', () => {
    const a = rayleigh(100_000);
    const DR = 60;
    // grey linear in dB over DR, 0 dB at grey 255, no clipping inside the band used
    const grey = Float64Array.from(a, (v) => 200 + (255 / DR) * 20 * Math.log10(v));
    const m = nakagamiMFromLogSkew(moments(grey).skewness);
    expect(impliedDynamicRangeDb(moments(grey).std, m)).toBeCloseTo(DR, -0.5);
  });
});

describe('Nakagami and K fits', () => {
  it('inverts the log-skewness of a Nakagami amplitude', () => {
    for (const m of [0.4, 1, 2, 5])
      expect(nakagamiMFromLogSkew(nakagamiLogSkew(m))).toBeCloseTo(m, 4);
    expect(nakagamiMFromLogSkew(0.3)).toBeNaN();
  });
  it('reads a K shape from the intensity moments of K amplitudes', () => {
    const alpha = kAlphaFromEnvelope(kAmplitudes(300_000, 2));
    expect(alpha).toBeGreaterThan(1.7);
    expect(alpha).toBeLessThan(2.3);
  });
});

describe('windowedSnr', () => {
  it('reads uniform speckle near its SNR, biased low by small windows, and skips windows outside the mask', () => {
    const lines = 60,
      samples = 70;
    const a = rayleigh(lines * samples);
    const big = windowedSnr(a, () => true, lines, samples, 10, 14);
    expect(big.median).toBeGreaterThan(1.6);
    expect(big.median).toBeLessThan(2.1);
    const half = windowedSnr(a, (i) => Math.floor(i / samples) < 30, lines, samples, 10, 14);
    expect(half.windows).toBe(big.windows / 2);
  });
});

describe('summaries', () => {
  it('quantiles, IQR distance and Pearson', () => {
    const qs = quantiles([5, 1, 4, 2, 3, NaN]);
    expect(qs.n).toBe(5);
    expect(qs.median).toBe(3);
    expect(iqrDistance(6, { p25: 2, median: 3, p75: 4 })).toBe(1.5);
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
  });
});

describe('speckle cell (decision 355)', () => {
  /** A unit complex Gaussian. */
  const cgauss = (): [number, number] => {
    const g = Math.sqrt(exp1());
    const ph = 2 * Math.PI * rand();
    return [g * Math.cos(ph), g * Math.sin(ph)];
  };

  it('maps the field’s correlation to the envelope’s as Monte Carlo does', () => {
    expect(envelopeCorrelation(0)).toBeCloseTo(0, 12);
    expect(envelopeCorrelation(1)).toBeCloseTo(1, 4);
    for (const mu2 of [0.25, 0.5, 0.8]) {
      // two envelopes whose fields have |μ|² = mu2
      const mu = Math.sqrt(mu2),
        n = 1_000_000;
      const a = new Float64Array(n),
        b = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const [x, y] = cgauss(),
          [u, v] = cgauss();
        a[i] = Math.hypot(x, y);
        b[i] = Math.hypot(mu * x + Math.sqrt(1 - mu2) * u, mu * y + Math.sqrt(1 - mu2) * v);
      }
      expect(pearson(a, b)).toBeCloseTo(envelopeCorrelation(mu2), 2);
    }
    // slightly under |μ|²
    expect(envelopeCorrelation(0.5)).toBeCloseTo(0.474, 3);
    expect(envelopeCorrelation(0.5)).toBeLessThan(0.5);
  });

  // an anisotropic complex kernel: Gaussian amplitude, σ 3 cells across and 1.5 along, with a phase ramp along
  const kx = 25,
    kz = 13,
    kernel = {
      nx: kx,
      nz: kz,
      dxMm: 0.2,
      dzMm: 0.05,
      re: new Float64Array(kx * kz),
      im: new Float64Array(kx * kz),
    };
  for (let iz = 0; iz < kz; iz++)
    for (let ix = 0; ix < kx; ix++) {
      const x = ix - 12,
        z = iz - 6,
        amp = Math.exp(-(x * x) / 18 - (z * z) / 4.5);
      kernel.re[ix + iz * kx] = amp * Math.cos(1.3 * z);
      kernel.im[ix + iz * kx] = amp * Math.sin(1.3 * z);
    }
  /** Envelope of a white complex field through the kernel, as rows (across) and columns (along). */
  const image = () => {
    const nx = 400,
      nz = 120;
    const fr = new Float64Array(nx * nz),
      fi = new Float64Array(nx * nz);
    for (let i = 0; i < nx * nz; i++) [fr[i], fi[i]] = cgauss();
    const env = new Float64Array(nx * nz);
    for (let z = 6; z < nz - 6; z++)
      for (let x = 12; x < nx - 12; x++) {
        let sr = 0,
          si = 0;
        for (let iz = 0; iz < kz; iz++)
          for (let ix = 0; ix < kx; ix++) {
            const j = x - (ix - 12) + (z - (iz - 6)) * nx,
              k = ix + iz * kx;
            sr += fr[j]! * kernel.re[k]! - fi[j]! * kernel.im[k]!;
            si += fr[j]! * kernel.im[k]! + fi[j]! * kernel.re[k]!;
          }
        env[x + z * nx] = Math.hypot(sr, si);
      }
    const rows: number[][] = [],
      cols: number[][] = [];
    for (let z = 6; z < nz - 6; z += 3)
      rows.push(Array.from(env.subarray(12 + z * nx, nx - 12 + z * nx)));
    for (let x = 12; x < nx - 12; x += 5) {
      const c: number[] = [];
      for (let z = 6; z < nz - 6; z++) c.push(env[x + z * nx]!);
      cols.push(c);
    }
    return { rows, cols };
  };

  it('reads a kernel’s cell along each axis from the kernel alone', () => {
    // a Gaussian amplitude of σ s gives |μ(Δ)|² = exp(−Δ²/(2s²))
    const theory = (s: number, spacing: number) => {
      let lo = 0,
        hi = 10 * s;
      for (let k = 0; k < 60; k++) {
        const m = (lo + hi) / 2;
        if (envelopeCorrelation(Math.exp(-(m * m) / (2 * s * s))) > 0.5) lo = m;
        else hi = m;
      }
      return 2 * lo * spacing;
    };
    expect(kernelSpeckleCell(kernel, 'x')).toBeCloseTo(theory(3, 0.2), 1);
    expect(kernelSpeckleCell(kernel, 'z')).toBeCloseTo(theory(1.5, 0.05), 2);
    // and the image the kernel forms reads the same cells
    const { rows, cols } = image();
    expect(speckleCell(rows, 0.2) / kernelSpeckleCell(kernel, 'x')).toBeCloseTo(1, 1);
    expect(speckleCell(cols, 0.05) / kernelSpeckleCell(kernel, 'z')).toBeCloseTo(1, 1);
  });

  it('pools short series around one mean: the mean of each pulled the cell down', () => {
    // 600 series of 40 samples, each some six cells long
    const series: number[][] = [];
    for (let k = 0; k < 600; k++) {
      const n = 40 + 24;
      const f = Array.from({ length: n }, cgauss);
      const row: number[] = [];
      for (let i = 12; i < n - 12; i++) {
        let sr = 0,
          si = 0;
        for (let j = -12; j <= 12; j++) {
          const w = Math.exp(-(j * j) / 18);
          sr += f[i + j]![0] * w;
          si += f[i + j]![1] * w;
        }
        row.push(Math.hypot(sr, si));
      }
      series.push(row);
    }
    const truth = kernelSpeckleCell(
      {
        nx: 25,
        nz: 1,
        dxMm: 1,
        dzMm: 1,
        re: Float64Array.from({ length: 25 }, (_, j) => Math.exp(-((j - 12) ** 2) / 18)),
        im: new Float64Array(25),
      },
      'x',
    );
    expect(speckleCell(series, 1) / truth).toBeCloseTo(1, 1);
    // what each series' own mean gives
    const perSeries = series.map((s) => {
      const m = s.reduce((a, b) => a + b, 0) / s.length;
      return s.map((v) => v - m);
    });
    const biased = envelopeAutocorrelation(perSeries, 20);
    const pooled = envelopeAutocorrelation(series, 20);
    expect(biased[6]!).toBeLessThan(pooled[6]! - 0.03);
  });
});

describe('realizationStats (decision 359)', () => {
  it('gives each field’s mean and sample standard deviation over the realizations', () => {
    const r = realizationStats(
      [
        { a: 1, b: 10 },
        { a: 3, b: 10 },
        { a: 5, b: 10 },
      ],
      ['a', 'b'],
    );
    expect(r.a.mean).toBe(3);
    expect(r.a.sd).toBeCloseTo(2, 12);
    expect(r.b).toEqual({ mean: 10, sd: 0 });
    expect(realizationStats([{ a: 7 }], ['a']).a).toEqual({ mean: 7, sd: 0 });
  });
});
