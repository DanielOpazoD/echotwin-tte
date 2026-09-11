import type { CaseDefinition } from '@/cases/schema';
import { buildBeatTables, type BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import { lvGeometryFromVolume } from '@/simulator/anatomy/heartModel';
import { lvProfileG } from '@/simulator/anatomy/lvShape';
import { lvotNarrowing, pulmonaryVeinPeaks, solveLvotObstruction } from '@/simulator/doppler/flow-primitives/flowField';
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
  lvot: { diameterCm: number; areaCm2: number; vtiCm: number; vmaxMps: number; strokeVolumeMl: number; peakGradientMmHg: number; dynamicObstruction: boolean };
  regurgitation: {
    mr: { eroaCm2: number; regurgitantVolumeMl: number; regurgitantFractionPct: number; vmaxMps: number; vtiCm: number; jetDirectionDeg: number } | null;
    ar: { eroaCm2: number; regurgitantVolumeMl: number; regurgitantFractionPct: number; vmaxMps: number; phtMs: number } | null;
    tr: { eroaCm2: number } | null;
  };
  wallMotion: { abnormalSegments: number[]; description: string };
  pulmonaryVein: { sMps: number; dMps: number; arMps: number; sdRatio: number };
  rv: { basalDiameterCm: number; freeWallThicknessCm: number; septalFlattening: number };
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
  pericardium: { effusionCm: number; tamponade: number };
}

/** LV internal diameter (cm) of the geometric model at end diastole, 2 cm below the annulus on the lateral axis (what the image shows). */
export function geometricEdd(c: CaseDefinition, edvMl: number): number {
  const g = lvGeometryFromVolume(edvMl, c.anatomy.lv.lengthEdCm, c.anatomy.lv.sphericity, c.anatomy.lv);
  return 2 * g.rMax * lvProfileG(g.shape, 2.0 / g.lengthCm);
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
  const sv = t.strokeVolumeMl; // total (EDV − ESV)
  const ef = ejectionFraction(t.edvMl, t.esvMl);
  // LVOT peak with a subaortic/dynamic obstruction (same solver as the flow field)
  const obs = solveLvotObstruction(t, lvotArea, c.hemodynamics.lvotPeakGradientMmHg, c.anatomy.mitral.samSeverity > 0);
  let lvotPeakV = lvotVmax;
  if (obs) {
    lvotPeakV = 0;
    for (let i = 0; i < t.n; i++) {
      const q = t.aorticFlowMlps[i] ?? 0;
      if (q <= 0) continue;
      const u = (((i + 0.5) / t.n) * t.rrS - t.timings.ejectionStartS) / (t.timings.ejectionEndS - t.timings.ejectionStartS);
      lvotPeakV = Math.max(lvotPeakV, q / Math.max(0.05, lvotArea * (1 - lvotNarrowing(obs.fMax, obs.dynamic, u))) / 100);
    }
  }
  const rg = t.regurgitation;
  const mrCfg = c.hemodynamics.regurgitation.mr;
  const arCfg = c.hemodynamics.regurgitation.ar;
  const abnormal = c.anatomy.wallMotion.filter((w) => w.amplitude < 0.85).map((w) => w.segment);
  const pvPeaks = pulmonaryVeinPeaks(c);
  // ESD from EDD and contraction geometry (radial fractional shortening ~ derived from volumes)
  const esd = geometricEdd(c, t.edvMl) * Math.cbrt(t.esvMl / t.edvMl) * 0.93;
  const tr = c.hemodynamics.trPresent ? Math.sqrt(Math.max(0, (c.hemodynamics.paspMmHg - c.hemodynamics.rapMmHg) / 4)) : null;
  const eOverA = t.timings.hasAWave && c.physiology.aPeakMps > 0 ? c.physiology.ePeakMps / c.physiology.aPeakMps : null;
  const ePrimeAvg = (c.physiology.ePrimeSeptalCmps + c.physiology.ePrimeLateralCmps) / 2;
  return {
    bsaM2: bsa,
    heartRateBpm: c.rhythm.heartRateBpm,
    rhythm: c.rhythm.type,
    lv: {
      eddCm: geometricEdd(c, t.edvMl),
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
    lvot: { diameterCm: c.anatomy.aorta.lvotDiameterCm, areaCm2: lvotArea, vtiCm: lvotVti, vmaxMps: lvotPeakV, strokeVolumeMl: lvotArea * lvotVti, peakGradientMmHg: simplifiedBernoulli(lvotPeakV), dynamicObstruction: Boolean(obs?.dynamic) },
    regurgitation: {
      mr: mrCfg && mrCfg.eroaCm2 > 0 ? { eroaCm2: mrCfg.eroaCm2, regurgitantVolumeMl: rg.mrVolumeMl, regurgitantFractionPct: (rg.mrVolumeMl / Math.max(sv, 1)) * 100, vmaxMps: rg.mrVmaxMps, vtiCm: rg.mrVtiCm, jetDirectionDeg: mrCfg.jetDirectionDeg } : null,
      ar: arCfg && arCfg.eroaCm2 > 0 ? { eroaCm2: arCfg.eroaCm2, regurgitantVolumeMl: rg.arVolumeMl, regurgitantFractionPct: (rg.arVolumeMl / Math.max(sv, 1)) * 100, vmaxMps: rg.arVmaxMps, phtMs: rg.arPhtMs } : null,
      tr: c.hemodynamics.regurgitation.tr ? { eroaCm2: c.hemodynamics.regurgitation.tr.eroaCm2 } : null,
    },
    pulmonaryVein: { ...pvPeaks, sdRatio: pvPeaks.dMps > 0 ? pvPeaks.sMps / pvPeaks.dMps : 0 },
    wallMotion: { abnormalSegments: abnormal, description: abnormal.length ? `Alteración segmentaria en ${abnormal.length} segmento(s) AHA: ${abnormal.join(', ')}` : 'Motilidad segmentaria normal' },
    rv: { basalDiameterCm: c.anatomy.rv.basalDiameterCm, freeWallThicknessCm: c.anatomy.rv.freeWallThicknessCm, septalFlattening: c.anatomy.rv.septalFlattening },
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
    pericardium: { effusionCm: c.anatomy.pericardium.effusionCm, tamponade: c.anatomy.pericardium.tamponade },
  };
}
