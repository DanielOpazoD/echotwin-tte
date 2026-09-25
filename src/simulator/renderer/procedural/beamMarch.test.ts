// @tier fast
import { describe, expect, it } from 'vitest';
import { beamMarch } from './sliceRenderer';
import { Tissue } from '@/simulator/anatomy/tissue';
import { DEFAULT_ACQUISITION, polarSpecFor } from '../types';
import {
  BEAM_ATTEN_MAX_LINES,
  beamAttenWindowLines,
  beamHalfWidthCm,
  TRANSMISSION_FLOOR,
} from '../acoustic/acoustics';

/**
 * The march of the beam (decision 144): a line grazing a wall pays the attenuation of the beam's width, not of its own
 * pencil, so two adjacent lines through wall and blood end up far closer than their pencils; lung and outside-body
 * samples neither pay nor count; a line's lung echoes are scaled by the transmission at its pleural entry.
 */
describe('beam march', () => {
  const spec = polarSpecFor(DEFAULT_ACQUISITION, 'medium');
  const { lines, samples } = spec;
  const n = lines * samples;
  const frame = () => ({
    re: new Float32Array(n).fill(1),
    im: new Float32Array(n),
    tr: new Float32Array(n),
    ti: new Uint8Array(n).fill(Tissue.Blood),
    atten: new Float32Array(n),
    prefix: new Float32Array((lines + 1) * samples),
  });
  const march = (f: ReturnType<typeof frame>) =>
    beamMarch(f.re, f.im, f.tr, f.ti, f.atten, spec, 1, 1, f.prefix);

  it('averages the increment across the beam: a wall line beside blood loses far less than its pencil', () => {
    // lines 0..59 blood (no attenuation), lines 60..118 myocardium-like (0.05 Np per sample)
    const f = frame();
    for (let li = 0; li < lines; li++)
      for (let si = 0; si < samples; si++) if (li >= 60) f.atten[li * samples + si] = 0.05;
    const pencilWall = Math.exp(-0.05 * (samples - 1));
    march(f);
    const last = samples - 1;
    const tWallEdge = f.tr[60 * samples + last]!;
    const tBloodEdge = f.tr[59 * samples + last]!;
    const tDeepWall = f.tr[110 * samples + last]!;
    // at the boundary the two neighbours share most of the same window
    expect(tWallEdge).toBeGreaterThan(pencilWall * 10);
    expect(tBloodEdge / tWallEdge).toBeLessThan(10); // pencils differ by e¹¹
    // far inside the wall the window holds wall only: the pencil value
    expect(tDeepWall).toBeCloseTo(Math.max(TRANSMISSION_FLOOR, pencilWall), 6);
    // echoes are scaled by the transmission of the beam
    expect(f.re[60 * samples + last]).toBeCloseTo(tWallEdge, 6);
  });

  it('leaves outside-body and lung samples out of the window and scales lung echoes at the entry', () => {
    const f = frame();
    const entry = 100;
    for (let si = 0; si < samples; si++) {
      f.atten[10 * samples + si] = 0.05;
      // line 11: outside the body (no attenuation, no echo), line 12: lung from `entry` on
      f.ti[11 * samples + si] = Tissue.None;
      if (si >= entry) f.ti[12 * samples + si] = Tissue.Lung;
      else f.atten[12 * samples + si] = 0.05;
    }
    march(f);
    // the outside-body line keeps unit transmission and did not dilute line 10's window with zeros… nor add to it
    expect(f.tr[11 * samples + samples - 1]).toBe(1);
    // line 12 beyond the pleura: pleural sample keeps the transmission at entry, the reverberation behind it is
    // scaled by that same value and marked shadowed
    const tEntry = f.tr[12 * samples + entry]!;
    expect(tEntry).toBeGreaterThan(0);
    expect(tEntry).toBeLessThan(1);
    expect(f.re[12 * samples + entry]).toBeCloseTo(tEntry, 6);
    expect(f.re[12 * samples + entry + 20]).toBeCloseTo(tEntry, 6);
    expect(f.tr[12 * samples + entry + 20]).toBe(0);
  });

  it('averages over the same width in every tier and line density, within the GPU loop (decision 215)', () => {
    // the cap was 24 lines: at 1 cm under the face that is 0.37 cm in the low tier and 0.21 cm in the high one
    for (const lineDensity of ['low', 'medium', 'high'] as const)
      // every sector the console allows (30-100°): the densest grid asks for 34 lines, under the GPU loop's bound
      for (let sectorDeg = 30; sectorDeg <= 100; sectorDeg += 5)
        for (const r of [0.5, 1, 2, 4, 8]) {
          const widths = (['low', 'medium', 'high'] as const).map((tier) => {
            const sp = polarSpecFor({ ...DEFAULT_ACQUISITION, lineDensity, sectorDeg }, tier);
            const dTheta = sp.sectorRad / sp.lines;
            const K = beamAttenWindowLines(r, sp.focusCm, dTheta);
            // below the bound, not at it: a K the bound clipped would be a window narrower than the angle asks
            expect(K).toBeLessThan(BEAM_ATTEN_MAX_LINES);
            return K * dTheta * r;
          });
          // to one line of the coarsest grid, and never wider than the beam
          const coarse =
            r *
            (polarSpecFor({ ...DEFAULT_ACQUISITION, lineDensity, sectorDeg }, 'low').sectorRad /
              polarSpecFor({ ...DEFAULT_ACQUISITION, lineDensity, sectorDeg }, 'low').lines);
          expect(
            Math.max(...widths) - Math.min(...widths),
            `${lineDensity} ${sectorDeg}° r ${r}`,
          ).toBeLessThanOrEqual(coarse + 1e-9);
          for (const w of widths)
            expect(w).toBeLessThanOrEqual(beamHalfWidthCm(r, DEFAULT_ACQUISITION.focusCm) + coarse);
        }
    // the calibrated grid keeps its 24 lines (the images it forms do not change)
    const hi = polarSpecFor(DEFAULT_ACQUISITION, 'high');
    expect(beamAttenWindowLines(0.5, hi.focusCm, hi.sectorRad / hi.lines)).toBe(24);
  });
});
