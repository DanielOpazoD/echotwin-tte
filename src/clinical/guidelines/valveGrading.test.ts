import { describe, expect, it } from 'vitest';
import {
  efCategory,
  gradeAorticStenosis,
  gradeMitralRegurgitation,
  wallThickened,
} from './valveGrading';

const as = (o: Partial<Parameters<typeof gradeAorticStenosis>[0]>) =>
  gradeAorticStenosis({
    vmaxMps: 2.2,
    meanGradientMmHg: 10,
    avaCm2: 1.8,
    strokeVolumeIndexMlM2: 42,
    efPct: 60,
    ...o,
  });

describe('aortic stenosis, integrative (ASE/EACVI 2017)', () => {
  it('a high gradient is severe whatever the area', () => {
    expect(as({ vmaxMps: 4.2, meanGradientMmHg: 45, avaCm2: 1.1 })).toMatchObject({
      grade: 'severe',
      pattern: 'high-gradient',
    });
    expect(as({ vmaxMps: 3.8, meanGradientMmHg: 41 }).grade).toBe('severe');
  });
  it('a severe area with a low gradient is read through the flow', () => {
    // classic low-flow low-gradient: low EF
    expect(
      as({ vmaxMps: 3.3, meanGradientMmHg: 28, avaCm2: 0.8, strokeVolumeIndexMlM2: 28, efPct: 35 }),
    ).toMatchObject({ grade: 'severe', pattern: 'classic-low-flow-low-gradient' });
    // paradoxical: preserved EF, small ventricle
    expect(
      as({
        vmaxMps: 3.4,
        meanGradientMmHg: 30,
        avaCm2: 0.85,
        strokeVolumeIndexMlM2: 30,
        efPct: 62,
      }),
    ).toMatchObject({ grade: 'severe', pattern: 'paradoxical-low-flow-low-gradient' });
    // normal flow: an AVA of 1.0 alone used to make it severe; the discordance is usually moderate
    expect(
      as({ vmaxMps: 3.5, meanGradientMmHg: 32, avaCm2: 0.95, strokeVolumeIndexMlM2: 40 }),
    ).toMatchObject({ grade: 'moderate', pattern: 'normal-flow-low-gradient' });
  });
  it('moderate by velocity or by mean gradient, mild above 2 m/s, none below', () => {
    expect(as({ vmaxMps: 3.1, avaCm2: 1.2 }).grade).toBe('moderate');
    expect(as({ vmaxMps: 2.9, meanGradientMmHg: 21, avaCm2: 1.3 }).grade).toBe('moderate');
    expect(as({ vmaxMps: 2.5 }).grade).toBe('mild');
    expect(as({ vmaxMps: 1.4 }).grade).toBe('none');
  });
});

describe('mitral regurgitation: the grade two of three criteria agree on', () => {
  it('reads the regurgitant volume and fraction, not the orifice alone', () => {
    // the HFrEF case before decision 297: a moderate orifice with a severe fraction is still moderate
    expect(
      gradeMitralRegurgitation({
        eroaCm2: 0.25,
        regurgitantVolumeMl: 38,
        regurgitantFractionPct: 64,
      }),
    ).toBe('moderate');
    expect(
      gradeMitralRegurgitation({
        eroaCm2: 0.35,
        regurgitantVolumeMl: 62,
        regurgitantFractionPct: 55,
      }),
    ).toBe('severe');
    expect(
      gradeMitralRegurgitation({
        eroaCm2: 0.15,
        regurgitantVolumeMl: 11,
        regurgitantFractionPct: 16,
      }),
    ).toBe('mild');
    // a small orifice whose volume and fraction are moderate is not mild
    expect(
      gradeMitralRegurgitation({
        eroaCm2: 0.15,
        regurgitantVolumeMl: 30,
        regurgitantFractionPct: 42,
      }),
    ).toBe('moderate');
    expect(
      gradeMitralRegurgitation({
        eroaCm2: 0.05,
        regurgitantVolumeMl: 5,
        regurgitantFractionPct: 8,
      }),
    ).toBe('none');
  });
});

describe('sex-specific limits (ASE/EACVI 2015)', () => {
  it('EF is normal from 52 % in men and 54 % in women', () => {
    expect(efCategory(53, 'male')).toBe('normal');
    expect(efCategory(53, 'female')).toBe('mild');
    expect(efCategory(35, 'female')).toBe('moderate');
    expect(efCategory(24, 'male')).toBe('severe');
  });
  it('walls are thick above 1.0 cm in men and 0.9 cm in women', () => {
    expect(wallThickened(1.0, 0.9, 'male')).toBe(false);
    expect(wallThickened(1.1, 0.9, 'male')).toBe(true);
    expect(wallThickened(1.0, 0.85, 'female')).toBe(true);
    expect(wallThickened(0.9, 0.85, 'female')).toBe(false);
  });
});

describe('aortic stenosis with a moderate area and low flow', () => {
  it('is moderate when the area and the index are moderate and the flow keeps the gradients low', () => {
    const g = gradeAorticStenosis({
      vmaxMps: 2.47,
      meanGradientMmHg: 14,
      avaCm2: 1.15,
      strokeVolumeIndexMlM2: 29,
      efPct: 63,
      velocityRatio: 0.37,
    });
    expect(g).toMatchObject({ grade: 'moderate', pattern: 'low-flow-moderate' });
    // the same valve at normal flow, gradients still low: sclerosis or mild by velocity
    expect(
      gradeAorticStenosis({
        vmaxMps: 2.47,
        meanGradientMmHg: 14,
        avaCm2: 1.6,
        strokeVolumeIndexMlM2: 40,
        efPct: 63,
        velocityRatio: 0.6,
      }).grade,
    ).toBe('mild');
  });
});
