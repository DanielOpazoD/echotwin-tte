import type { CaseDefinition } from '@/cases/schema';
import { buildBeatTables, type BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import {
  bsaMosteller,
  cardiacOutput,
  circularArea,
  continuityAva,
  ejectionFraction,
  meanGradientFromEnvelope,
  rvspFromTr,
  simplifiedBernoulli,
  velocityRatio,
} from '@/clinical/formulas';

/**
 * StructuredEchoTruth: the ground truth that scoring/report compare against. Every value derives
 * from the same beat tables + anatomy that drive rendering and Doppler (spec 15, 32, 67).
 */
export interface StructuredEchoTruth {
  bsaM2: number;
  heartRateBpm: number;
  rhythm: string;
  lv: {
    eddCm: number;
    esdCm: number;
    ivsdCm: number;
    lvpwdCm: number;
    edvMl: number;
    esvMl: number;
    efPct: number;
    strokeVolumeMl: number;
    cardiacOutputLpm: number;
    mapseCm: number;
  };
  lvot: { diameterCm: number; areaCm2: number; vtiCm: number; vmaxMps: number; strokeVolumeMl: number };
  aorticValve: {
    effectiveAreaCm2: number;
    vmaxMps: number;
    vtiCm: number;
    peakGradientMmHg: number;
    meanGradientMmHg: number;
    continuityAvaCm2: number;
    velocityRatio: number;
  };
  mitral: {
    ePeakMps: number;
    aPeakMps: number;
    eOverA: number | null;
    decelerationTimeMs: number;
    ivrtMs: number;
    ePrimeSeptalCmps: number;
    ePrimeLateralCmps: number;
    eOverEPrimeAvg: number;
    effectiveAreaCm2: number;
  };
  rightHeart: { tapseCm: number; sPrimeCmps: number; trVmaxMps: number | null; rvspMmHg: number | null; rapMmHg: number; ivcCm: number; ivcCollapsePct: number };
  la: { volumeMl: number; volumeIndexMlM2: number; apDiameterCm: number };
  aorta: { annulusCm: number; sinusCm: number; ascendingCm: number };
  pericardium: { effusionCm: number };
}

export function computeGroundTruth(c: CaseDefinition, tables?: BeatTables): StructuredEchoTruth {
  const rr = 60 / c.rhythm.heartRateBpm;
  const t = tables ?? buildBeatTables(rr, c.physiology, c.rhythm, c.hemodynamics);
  const bsa = bsaMosteller(c.demographics.heightCm, c.demographics.weightKg);
  const lvotArea = circularArea(c.anatomy.aorta.lvotDiameterCm);
  const dt = t.rrS / t.n;
  // LVOT and AV velocity envelopes from the SAME ejection flow curve
  const lvotEnv: number[] = [];
  const avEnv: number[] = [];
  let lvotVmax = 0,
    avVmax = 0,
    lvotVti = 0,
    avVti = 0;
  for (let i = 0; i < t.n; i++) {
    const q = t.aorticFlowMlps[i] ?? 0;
    if (q <= 0) continue;
    const vL = q / lvotArea / 100; // m/s
    const vA = q / c.hemodynamics.avEffectiveAreaCm2 / 100;
    lvotEnv.push(vL);
    avEnv.push(vA);
    lvotVmax = Math.max(lvotVmax, vL);
    avVmax = Math.max(avVmax, vA);
    lvotVti += vL * 100 * dt;
    avVti += vA * 100 * dt;
  }
  const sv = t.strokeVolumeMl;
  const ef = ejectionFraction(t.edvMl, t.esvMl);
  // ESD from EDD and contraction geometry (radial fractional shortening ~ derived from volumes)
  const esd = c.anatomy.lv.eddCm * Math.cbrt(t.esvMl / t.edvMl) * 0.93;
  const tr = c.hemodynamics.trPresent ? Math.sqrt(Math.max(0, (c.hemodynamics.paspMmHg - c.hemodynamics.rapMmHg) / 4)) : null;
  const eOverA = t.timings.hasAWave && c.physiology.aPeakMps > 0 ? c.physiology.ePeakMps / c.physiology.aPeakMps : null;
  const ePrimeAvg = (c.physiology.ePrimeSeptalCmps + c.physiology.ePrimeLateralCmps) / 2;
  return {
    bsaM2: bsa,
    heartRateBpm: c.rhythm.heartRateBpm,
    rhythm: c.rhythm.type,
    lv: {
      eddCm: c.anatomy.lv.eddCm,
      esdCm: esd,
      ivsdCm: c.anatomy.lv.ivsdCm,
      lvpwdCm: c.anatomy.lv.lvpwdCm,
      edvMl: t.edvMl,
      esvMl: t.esvMl,
      efPct: ef,
      strokeVolumeMl: sv,
      cardiacOutputLpm: cardiacOutput(sv, c.rhythm.heartRateBpm),
      mapseCm: c.physiology.mapseCm,
    },
    lvot: { diameterCm: c.anatomy.aorta.lvotDiameterCm, areaCm2: lvotArea, vtiCm: lvotVti, vmaxMps: lvotVmax, strokeVolumeMl: lvotArea * lvotVti },
    aorticValve: {
      effectiveAreaCm2: c.hemodynamics.avEffectiveAreaCm2,
      vmaxMps: avVmax,
      vtiCm: avVti,
      peakGradientMmHg: simplifiedBernoulli(avVmax),
      meanGradientMmHg: meanGradientFromEnvelope(avEnv),
      continuityAvaCm2: continuityAva(c.anatomy.aorta.lvotDiameterCm, lvotVti, avVti),
      velocityRatio: velocityRatio(lvotVti, avVti),
    },
    mitral: {
      ePeakMps: c.physiology.ePeakMps,
      aPeakMps: t.timings.hasAWave ? c.physiology.aPeakMps : 0,
      eOverA,
      decelerationTimeMs: c.physiology.decelerationTimeMs,
      ivrtMs: c.physiology.ivrtMs,
      ePrimeSeptalCmps: c.physiology.ePrimeSeptalCmps,
      ePrimeLateralCmps: c.physiology.ePrimeLateralCmps,
      eOverEPrimeAvg: (c.physiology.ePeakMps * 100) / ePrimeAvg,
      effectiveAreaCm2: t.mvEffectiveAreaCm2,
    },
    rightHeart: {
      tapseCm: c.physiology.tapseCm,
      sPrimeCmps: c.physiology.sPrimeTricuspidCmps,
      trVmaxMps: tr,
      rvspMmHg: tr !== null ? rvspFromTr(tr, c.hemodynamics.rapMmHg) : null,
      rapMmHg: c.hemodynamics.rapMmHg,
      ivcCm: c.anatomy.ivc.diameterCm,
      ivcCollapsePct: c.anatomy.ivc.collapsePct,
    },
    la: { volumeMl: c.anatomy.la.volumeMl, volumeIndexMlM2: c.anatomy.la.volumeMl / bsa, apDiameterCm: c.anatomy.la.apDiameterCm },
    aorta: { annulusCm: c.anatomy.aorta.annulusCm, sinusCm: c.anatomy.aorta.sinusCm, ascendingCm: c.anatomy.aorta.ascendingCm },
    pericardium: { effusionCm: c.anatomy.pericardium.effusionCm },
  };
}
