import { describe, expect, it } from 'vitest';
import { polarMaskDiscs } from './maskDiscs.testkit';
import { simpsonBiplaneVolume } from '@/clinical/formulas';

describe('image-mask disc oracle against an independent ellipsoid', () => {
  it('recovers analytic volume across resolution, subpixel position and axis rotation', () => {
    const length = 5.2,
      widths = [3.5, 3] as const;
    const truth = (Math.PI / 6) * length * widths[0] * widths[1];
    for (const factor of [1, 2])
      for (const offset of [-0.23, 0.17])
        for (const angle of [-0.18, 0.12]) {
          const spec = {
            lines: 112 * factor,
            samples: 400 * factor,
            sectorRad: (70 * Math.PI) / 180,
            depthCm: 20,
          };
          const profiles = widths.map((width) => {
            const mask = new Uint8Array(spec.lines * spec.samples);
            for (let l = 0; l < spec.lines; l++)
              for (let s = 0; s < spec.samples; s++) {
                const theta = -spec.sectorRad / 2 + ((l + 0.5) * spec.sectorRad) / spec.lines;
                const r = ((s + 0.5) * spec.depthCm) / spec.samples;
                const x = r * Math.sin(theta) - offset,
                  y = r * Math.cos(theta) - 13;
                const across = x * Math.cos(angle) - y * Math.sin(angle);
                const along = x * Math.sin(angle) + y * Math.cos(angle);
                mask[l * spec.samples + s] =
                  (across / (width / 2)) ** 2 + (along / (length / 2)) ** 2 <= 1 ? 1 : 0;
              }
            return polarMaskDiscs(mask, spec, 1);
          });
          const volume = simpsonBiplaneVolume(
            profiles[0]!.diametersCm,
            profiles[1]!.diametersCm,
            Math.max(profiles[0]!.longAxisCm, profiles[1]!.longAxisCm),
          );
          expect(Math.abs(volume / truth - 1), `${factor}/${offset}/${angle}`).toBeLessThan(0.03);
        }
  });
  it('orders asymmetric contours from shallow to deep for either direction of tilt', () => {
    const spec = { lines: 224, samples: 800, sectorRad: 1.3, depthCm: 20 };
    for (const angle of [-0.15, 0.15]) {
      const mask = new Uint8Array(spec.lines * spec.samples);
      for (let l = 0; l < spec.lines; l++)
        for (let s = 0; s < spec.samples; s++) {
          const theta = -spec.sectorRad / 2 + ((l + 0.5) * spec.sectorRad) / spec.lines;
          const r = ((s + 0.5) * spec.depthCm) / spec.samples;
          const x = r * Math.sin(theta),
            y = r * Math.cos(theta) - 13;
          const along = x * Math.sin(angle) + y * Math.cos(angle);
          const across = x * Math.cos(angle) - y * Math.sin(angle);
          const t = (along + 2.5) / 5;
          if (t >= 0 && t <= 1 && Math.abs(across) < 1.5 * (1 - 0.6 * t))
            mask[l * spec.samples + s] = 1;
        }
      const profile = polarMaskDiscs(mask, spec, 1);
      expect(profile.diametersCm[4]!).toBeGreaterThan(profile.diametersCm[15]!);
    }
  });
  it('rejects an empty mask instead of silently passing a NaN volume', () => {
    expect(() =>
      polarMaskDiscs(new Uint8Array(16), { lines: 4, samples: 4, sectorRad: 1, depthCm: 20 }, 1),
    ).toThrow('Empty chamber');
  });
});
