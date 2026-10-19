import { describe, expect, it } from 'vitest';
import {
  analytic,
  convolveEnvelope,
  fft,
  fieldIiPulse,
  narrowbandLateral,
  pointResponse,
  psf2d,
  pulseAxialFwhmMm,
  SOUND_SPEED_MM_PER_US,
  type ArrayParams,
} from './dasReference';
import { envelopeSnr, RAYLEIGH_SNR } from './speckleStats';
import { seededRandom } from './turing';

const array = (over: Partial<ArrayParams> = {}): ArrayParams => ({
  f0MHz: 2.5,
  elements: 64,
  apertureMm: 14,
  txFocusMm: 90,
  apodization: 'rect',
  rxFNumber: 0,
  ...over,
});
const lambda = SOUND_SPEED_MM_PER_US / 2.5;

describe('fft and analytic signal', () => {
  it('round-trips and gives a cosine a unit envelope', () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.3) + 0.2 * i);
    const im = new Float64Array(64);
    const copy = re.slice();
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < 64; i++) expect(re[i]).toBeCloseTo(copy[i]!, 9);
    const a = analytic(
      Float64Array.from({ length: 512 }, (_, i) => Math.cos((2 * Math.PI * 16 * i) / 512)),
    );
    for (let i = 100; i < 400; i += 37) expect(Math.hypot(a.re[i]!, a.im[i]!)).toBeCloseTo(1, 2);
  });
});

describe('Field II–style reference', () => {
  it('the two-way beam of a rectangular aperture at its focus is 0.886 λF wide at −6 dB', () => {
    const w = narrowbandLateral(array(), 90, 2.5, 2.5, false).widthMm;
    expect(w / ((0.886 * lambda * 90) / 14)).toBeCloseTo(1, 1);
  });
  it('a Hanning apodization widens the beam, and the harmonic model narrows it', () => {
    const rect = narrowbandLateral(array(), 90, 2.5, 2.5, false).widthMm;
    const han = narrowbandLateral(array({ apodization: 'hanning' }), 90, 2.5, 2.5, false).widthMm;
    const thi = narrowbandLateral(array(), 90, 2.5, 5, true).widthMm;
    expect(han / rect).toBeGreaterThan(1.3);
    expect(thi / rect).toBeLessThan(0.7);
  });
  it('the pulse of the Field II examples is about two cycles long, and the broadband point response matches it', () => {
    const p = fieldIiPulse(2.5);
    const ax = pulseAxialFwhmMm(p);
    expect(ax).toBeGreaterThan(0.55);
    expect(ax).toBeLessThan(0.75);
    const r = pointResponse(array(), 90, { halfWidthMm: 6, lateralStepMm: 0.2 });
    expect(r.axialMm / ax).toBeCloseTo(1, 1);
    expect(r.lateralMm / narrowbandLateral(array(), 90, 2.5, 2.5, false).widthMm).toBeCloseTo(
      1,
      0.5,
    );
  });
  it('random scatterers through its 2-D response form fully developed speckle (SNR 1.91)', () => {
    const h = psf2d(array(), 60, 2.4, 0.3, 0.8, 0.1);
    const nx = 160,
      nz = 160;
    const rand = seededRandom(11);
    const re = new Float64Array(nx * nz),
      im = new Float64Array(nx * nz);
    for (let i = 0; i < nx * nz; i++) {
      const g = Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))),
        t = 2 * Math.PI * rand();
      re[i] = g * Math.cos(t);
      im[i] = g * Math.sin(t);
    }
    const env = convolveEnvelope(re, im, nx, nz, h);
    const core: number[] = [];
    for (let z = 20; z < nz - 20; z++)
      for (let x = 20; x < nx - 20; x++) core.push(env[x + z * nx]!);
    expect(envelopeSnr(core)).toBeCloseTo(RAYLEIGH_SNR, 0.7);
  });
});
