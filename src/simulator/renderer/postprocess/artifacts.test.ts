import { describe, expect, it } from 'vitest';
import { applyConsole, createConsoleState, NO_ARTIFACTS } from './consolePipeline';
import { allocPolarFrame, DEFAULT_ACQUISITION } from '../types';
import { Tissue } from '@/simulator/anatomy/tissue';

/** Case-configurable artifacts (spec 12): side lobes and mirror image act on the polar frame (beam width: psf.test.ts). */
function frameWithReflector(): ReturnType<typeof allocPolarFrame> {
  const spec = { lines: 41, samples: 160, sectorRad: 1.2, depthCm: 16, elevationSamples: 1, focusCm: 9 };
  const f = allocPolarFrame(spec);
  f.amplitude.fill(0.02);
  f.transmission.fill(1);
  // a bright point reflector on the central line at 6 cm, and a pericardial interface at 8 cm on every line
  f.amplitude[20 * 160 + 60] = 3.0;
  for (let li = 0; li < 41; li++) {
    f.amplitude[li * 160 + 80] = 2.0;
    f.tissue[li * 160 + 80] = Tissue.Pericardium;
  }
  return f;
}
const settings = { ...DEFAULT_ACQUISITION, persistence: 0, edgeEnhance: 0 };

describe('console artifacts', () => {
  it('side lobes leak a strong reflector into neighbouring lines', () => {
    const f = frameWithReflector();
    const out0 = new Uint8ClampedArray(41 * 160);
    applyConsole(f, settings, createConsoleState(1), out0, NO_ARTIFACTS);
    const out1 = new Uint8ClampedArray(41 * 160);
    applyConsole(f, settings, createConsoleState(1), out1, { ...NO_ARTIFACTS, sideLobe: 1 });
    const neighbour = 23 * 160 + 60; // 3 lines away, same depth
    expect(out1[neighbour]!).toBeGreaterThan(out0[neighbour]! + 20);
    expect(out1[20 * 160 + 60]!).toBeGreaterThanOrEqual(out0[20 * 160 + 60]! - 1);
  });
  it('mirror artifact repeats the shallower image beyond the pericardial interface', () => {
    const f = frameWithReflector();
    const out0 = new Uint8ClampedArray(41 * 160);
    applyConsole(f, settings, createConsoleState(1), out0, NO_ARTIFACTS);
    const out1 = new Uint8ClampedArray(41 * 160);
    applyConsole(f, settings, createConsoleState(1), out1, { ...NO_ARTIFACTS, mirror: 1 });
    // reflector at sample 60 mirrors around the interface at 80 → sample 100 on the central line
    const mirrored = 20 * 160 + 100;
    expect(out1[mirrored]!).toBeGreaterThan(out0[mirrored]! + 25);
    // a line without the point reflector shows no mirrored point at that depth
    expect(Math.abs(out1[5 * 160 + 100]! - out0[5 * 160 + 100]!)).toBeLessThan(12);
  });
});
