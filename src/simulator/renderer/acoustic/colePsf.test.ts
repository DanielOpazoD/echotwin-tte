/**
 * Kernels of the convolution image formation (decision 351): the delay-and-sum response of the bench's reference array,
 * in the table `formEnvelope` reads.
 */
import { describe, expect, it } from 'vitest';
import { narrowbandLateral, pulseAxialFwhmMm, fieldIiPulse } from '@/clinical/realism/dasReference';
import { widthAtLevel } from '@/clinical/realism/resolution';
import { DEFAULT_ACQUISITION, polarSpecFor } from '../types';
import { buildColeKernels, coleArray, COLE_HARMONIC_AXIAL_STRETCH } from './colePsf';
import { LATERAL_TAPS, MAX_LATERAL_RADIUS } from './psf';

const spec = polarSpecFor({ ...DEFAULT_ACQUISITION, harmonics: false }, 'high');
const f = DEFAULT_ACQUISITION.frequencyMHz;
const dr = spec.depthCm / spec.samples,
  dTheta = spec.sectorRad / spec.lines;
const fund = buildColeKernels(spec, f, false);
/** The lateral taps of a sample, −R..R. */
const taps = (k: typeof fund, si: number): number[] => {
  const R = k.lateralRadius[si]!,
    c = si * LATERAL_TAPS + MAX_LATERAL_RADIUS;
  return Array.from({ length: 2 * R + 1 }, (_, j) => k.lateral[c - R + j]!);
};
const atFocus = Math.round(spec.focusCm / dr - 0.5);

describe('convolution kernels from the delay-and-sum reference (decision 351)', () => {
  it('have unit energy', () => {
    expect(fund.axial.reduce((s, w) => s + w * w, 0)).toBeCloseTo(1, 5);
    for (const si of [20, atFocus, spec.samples - 10])
      expect(taps(fund, si).reduce((s, w) => s + w * w, 0)).toBeCloseTo(1, 5);
  });

  it('are as wide across the beam as the reference’s pulse-echo profile at the focus', () => {
    const r = (atFocus + 0.5) * dr;
    const ref = narrowbandLateral(coleArray(f, spec.focusCm), r * 10, f, f, false).widthMm;
    const t = taps(fund, atFocus);
    const sim = widthAtLevel(
      t.map((w) => Math.abs(w)),
      r * dTheta * 10,
    );
    // the taps sample the profile at the line spacing (0.8 mm at the focus): measured to a tenth of it
    expect(Math.abs(sim - ref)).toBeLessThan(0.12 * r * dTheta * 10 + 0.05);
  });

  it('narrow across the beam in harmonic imaging as the harmonic model of the reference does', () => {
    // harmonic source ∝ p², received at twice the frequency
    const hs = polarSpecFor(DEFAULT_ACQUISITION, 'high');
    const harm = buildColeKernels(hs, f, true);
    const si = Math.round(hs.focusCm / (hs.depthCm / hs.samples) - 0.5);
    const r = (si + 0.5) * (hs.depthCm / hs.samples);
    const ref = narrowbandLateral(coleArray(f, hs.focusCm), r * 10, f, 2 * f, true).widthMm;
    const spacing = r * (hs.sectorRad / hs.lines) * 10;
    const sim = widthAtLevel(
      taps(harm, si).map((w) => Math.abs(w)),
      spacing,
    );
    expect(Math.abs(sim - ref)).toBeLessThan(0.12 * spacing + 0.05);
  });

  it('carry the side lobes of the aperture: at the focus those of a two-way sinc², 26 dB down', () => {
    // past the main lobe's first null (λF/D) the profile rises again to its first side lobe
    const t = taps(fund, atFocus),
      R = (t.length - 1) / 2;
    const r = (atFocus + 0.5) * dr;
    const nullTaps =
      ((1.54 / f) * (spec.focusCm * 10)) /
      coleArray(f, spec.focusCm).apertureMm /
      (r * dTheta * 10);
    const lobe = Math.max(...t.slice(R + Math.ceil(nullTaps)).map((w) => Math.abs(w)));
    const db = 20 * Math.log10(lobe / t[R]!);
    expect(db).toBeGreaterThan(-32);
    expect(db).toBeLessThan(-20);
  });

  it('change the sign of their lobes away from the focus, where the transmit field is not a sinc', () => {
    // at 3 cm the transmit beam focused at the console's focus is far from its waist: the pulse-echo profile swings
    // negative beside the main lobe (a third of the centre tap); a profile of magnitudes never does
    const t = taps(fund, Math.round(3 / dr - 0.5));
    const R = (t.length - 1) / 2;
    expect(Math.min(...t) / t[R]!).toBeLessThan(-0.2);
  });

  it('follow the Field II pulse along the beam, lengthened in harmonic imaging', () => {
    const fw = (k: typeof fund) => widthAtLevel(Array.from(k.axial), dr * 10);
    const pulse = pulseAxialFwhmMm(fieldIiPulse(f));
    // sampled every half millimetre, the measured width falls short of the pulse's by up to a third of a sample
    expect(Math.abs(fw(fund) - pulse)).toBeLessThan(0.35 * dr * 10);
    const harm = buildColeKernels(polarSpecFor(DEFAULT_ACQUISITION, 'high'), f, true);
    expect(fw(harm)).toBeGreaterThan(fw(fund) * (1 + (COLE_HARMONIC_AXIAL_STRETCH - 1) / 2));
  });
});
