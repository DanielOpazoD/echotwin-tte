import {
  heartAnchors,
  ROOT_EXCURSION,
  type HeartModel,
  type HeartPose,
} from '@/simulator/anatomy/heartModel';
import type { BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import { sampleTable } from '@/simulator/cardiac-cycle/cycleModel';
import type { CaseDefinition } from '@/cases/schema';
import { circularArea } from '@/clinical/formulas';
import { smoothstep } from '@/core/vec3';
import { Structure } from '@/simulator/anatomy/tissue';
import { lvotRadiusAt } from '@/simulator/anatomy/aorticValve';
import { atrialScale } from '@/simulator/anatomy/classify/atria';
import { PV_RADIUS, PV_REACH, pulmonaryVeinSegment } from '@/simulator/anatomy/pulmonaryVeins';

/** Scratch for the pulmonary vein being sampled (no allocation per sample). */
const PV_SEG = new Float64Array(6);

/**
 * Parametric hemodynamic flow field (spec 0.5, 10.5, 63). Velocities in m/s, heart frame.
 * Every primitive is driven by the SAME beat tables that define volumes and ground truth, so
 * Color, PW, CW, TDI and measurements agree by construction. No CFD: jets are cores with
 * radial profiles, spreading and turbulence; regurgitant jets exist only when the case defines them.
 */
export interface FlowSample {
  vx: number;
  vy: number;
  vz: number;
  /** Fractional velocity dispersion (0 laminar … 1 fully turbulent). */
  dispersion: number;
  /** 1 if inside a flow primitive, 0 otherwise. */
  present: number;
}

export interface FlowFieldParams {
  lvotAreaCm2: number;
  /** Annulus radius (cm): the outflow tract widens to it over its last LVOT_TAPER_CM (decision 161). */
  avR: number;
  avAreaCm2: number;
  mvAreaCm2: number;
  tvAreaCm2: number;
  rvotAreaCm2: number;
  trVmaxMps: number | null;
  turbulence: Record<string, number>;
  enabled: Record<string, boolean>;
  avAxis: { x: number; y: number; z: number };
  avCenter: { x: number; y: number; z: number };
  mvCenter: { x: number; y: number; z: number };
  mvR: number;
  tvCenter: { x: number; y: number; z: number };
  tvR: number;
  rvotA: { x: number; y: number; z: number };
  rvotB: { x: number; y: number; z: number };
  /** Regurgitant orifices (cm²) and the MR jet direction (rad, in the x–z plane; 0 = along the LV axis into the LA). */
  mrEroCm2: number;
  mrJetDirRad: number;
  arEroCm2: number;
  trEroCm2: number | null;
  /** Dynamic/subaortic LVOT obstruction: maximal area reduction fraction and its onset (fraction of ejection). */
  lvotObstruction: { fMax: number; dynamic: boolean } | null;
  /** Pulmonary venous flow: the four ostia (heart frame at ED) and the S/D/Ar peak velocities (m/s). */
  pulmonaryVeins: {
    laCenter: { x: number; y: number; z: number };
    laR: { x: number; y: number; z: number };
    /** Atrial reservoir scale (the veins ride on the atrial surface as it breathes). */
    laReservoir: number;
    sMps: number;
    dMps: number;
    arMps: number;
  };
  /** Colour M-mode flow propagation velocity (cm/s) the conventional slope reads, and the filling-wave speed that gives it. */
  inflowPropagationCmps: number;
  inflowWaveCmps: number;
}

/**
 * Colour M-mode flow propagation velocity (cm/s) of a case. The guideline cut-offs for raised filling pressure are a septal
 * E/e′ above 15 and an E/Vp of 2.5 or more (Nagueh et al., J Am Soc Echocardiogr 2009; 22:107–133), so at that pressure
 * Vp = 6·e′ septal; the proportion is kept at every e′ as a declared assumption. It gives 66 cm/s for the normal e′ of
 * 11 cm/s (normal Vp above 50 cm/s) and 36 cm/s for an impaired-relaxation e′ of 6 cm/s.
 */
export function flowPropagationCmps(c: CaseDefinition): number {
  return Math.min(120, Math.max(15, 6 * c.physiology.ePrimeSeptalCmps));
}

/** Length (cm) of the inflow core beyond the annulus, where the jet keeps its orifice velocity: the leaflet tips. */
const INFLOW_CORE_CM = 1.2;
/**
 * Distance (cm) beyond the tips over which the inflow core falls to half its velocity. The conventional Vp follows the
 * contour at half the maximal inflow velocity for 4 cm into the ventricle (Garcia et al., J Am Coll Cardiol 1998; 32:865–875,
 * as described by Chakraborty et al. 2019), so the core keeps at least half its velocity there; 5 cm is a declared value
 * above that bound. It was 2.2 cm, and the jet ended 4.3 cm beyond the tips, so that contour could not be followed.
 */
const INFLOW_DECAY_CM = 5;

/** Fraction of the core velocity left `zr` cm beyond the annulus, fading over the last centimetre before the apex. */
function inflowAxial(zr: number, lengthNow: number): number {
  return (
    smoothstep(0.2, 1.2, lengthNow - zr) / (1 + Math.max(0, zr - INFLOW_CORE_CM) / INFLOW_DECAY_CM)
  );
}

/**
 * Continuous flow primitives (decision 166). The colour map shows flow only where a primitive is present, so a primitive
 * whose velocity stopped on a cylinder, a cone or a plane drew that surface as a straight colour border: the mitral
 * inflow of the normal four-chamber view was a rectangle, with straight borders of 7-13 mm in the normal case and 29 mm
 * in the HFrEF one. Every primitive now falls to nothing at its own boundary: a jet keeps its core and loses its velocity
 * across a shear layer that thickens with the distance from its orifice, a convergence zone is a hemisphere that fades
 * out, and every jet ends by fading. The radius where a jet keeps half its velocity is the one its old profile had, so
 * its flux and its colour area at half velocity stay where they were.
 */
/**
 * Width (cm) of a jet's shear layer at its orifice, and its growth per cm along the jet: the velocity falls across it as a
 * logistic of scale width / 3, from 95 % to 5 % of the core over one width on either side of the half-velocity radius.
 * A smoothstep flattened near zero, and a 1 m/s jet went from 5 to 16 cm/s within a tenth of the layer.
 */
const SHEAR_ORIFICE_CM = 0.25;
const SHEAR_GROWTH = 0.25;
/**
 * Shear layer of a regurgitant or stenotic jet: 1 mm wide at its orifice, growing 0.05 cm per cm. A 2-5 m/s jet shows its
 * colour down to a few per cent of its core, and with the layer of the slow flows its visible edge reached 2.5 cm from the
 * axis 3 cm along the trace tricuspid jet of the normal case, which filled the atrium with a wedge; with this one the
 * edge stays where the old profile ended it.
 */
const FAST_JET_SHEAR = { orifice: 0.1, growth: 0.05 } as const;
const SLOW_SHEAR = { orifice: SHEAR_ORIFICE_CM, growth: SHEAR_GROWTH } as const;
type Shear = { orifice: number; growth: number };
/** Logistic fall of a jet's velocity at `rho` from its axis, with ½ at `rHalf` over a layer `w` wide. */
function logisticFall(rho: number, rHalf: number, w: number): number {
  return 1 / (1 + Math.exp((3 * (rho - rHalf)) / w));
}
/**
 * Velocity across a jet at `rho` from its axis, `s` cm from its orifice: the core velocity on the axis (a narrow jet keeps
 * its peak, which a CW or PW measurement reads), ½ near `rHalf`, and nothing beyond `jetReach`.
 */
function jetProfile(rho: number, rHalf: number, s: number, shear: Shear = SLOW_SHEAR): number {
  const w = shear.orifice + shear.growth * Math.max(0, s);
  if (rho >= rHalf + 3 * w) return 0;
  return logisticFall(rho, rHalf, w) / logisticFall(0, rHalf, w);
}
/** Distance from the axis beyond which a jet carries no velocity (0.01 % of its core). */
function jetReach(rHalf: number, s: number, shear: Shear = SLOW_SHEAR): number {
  return rHalf + 3 * (shear.orifice + shear.growth * Math.max(0, s));
}
/** 1 before `from`, 0 after `to`: the end of a jet or of a convergence zone. */
function fadeOut(s: number, from: number, to: number): number {
  return 1 - smoothstep(from, to, s);
}
/**
 * Atrial convergence toward an atrioventricular orifice: the velocity of a hemispheric sink, Q / (2π d²), capped at the
 * orifice velocity, fading out between these distances (cm) from the orifice centre, where it has fallen to 7-16 cm/s at
 * the E peak of the normal case. It used to fill a cylinder of the orifice radius up to 2.5 cm into the atrium.
 */
const FUNNEL_FADE_FROM_CM = 2;
const FUNNEL_FADE_TO_CM = 3;
/**
 * The convergence fills the atrial side of the orifice: seen from the nearest point of the orifice's rim, nothing beyond
 * 72° from the axis (cosine 0.3) and all of it within 53° (0.6), so it is whole over the orifice and fades beside the
 * annulus. A full hemisphere reached the outflow tract beside the anterior leaflet, at the level of the annulus, and
 * drew a 6 mm border there.
 */
/**
 * The ventricle's outflow converges on the entrance of the outflow tract, this far below the aortic valve along its axis
 * (cm), where the old tube began to widen into the cavity; the sink fades out between these distances from the entrance.
 */
const LVOT_ENTRANCE_T = -0.8;
const LVOT_SINK_FADE_FROM_CM = 3;
const LVOT_SINK_FADE_TO_CM = 4.5;
/**
 * The sink draws from the cavity along the tract's axis: all within 37° of it (cosine 0.8), nothing beyond 57° (0.55).
 * The wider cone of the atrioventricular convergence reached, behind the closed mitral leaflets, the left atrium, which
 * the ventricle's outflow cannot drain.
 */
const LVOT_SINK_COS_FROM = 0.55;
const LVOT_SINK_COS_TO = 0.8;
const FUNNEL_COS_FROM = 0.3;
const FUNNEL_COS_TO = 0.6;
/**
 * Weight of a convergence zone at `rho` from the axis and `upstream` cm before an orifice of radius `r`: whole over the
 * orifice, fading beside it toward the plane of the orifice, where the jet it feeds does not reach (decision 166).
 */
function convergenceWeight(
  rho: number,
  upstream: number,
  r: number,
  cosFrom = FUNNEL_COS_FROM,
  cosTo = FUNNEL_COS_TO,
): number {
  if (upstream <= 0) return 0;
  return smoothstep(cosFrom, cosTo, upstream / Math.hypot(Math.max(0, rho - r), upstream));
}

/**
 * Filling through an atrioventricular valve (decision 166): the atrial convergence toward the orifice and the jet beyond it.
 * `zr` is the distance beyond the annulus, `r` the orifice radius. The filling wave reaches a point of the jet after the
 * distance from the orifice centre, so its front is a hemisphere around the orifice rather than a plane across the jet.
 */
function inflowJet(
  tables: BeatTables,
  table: Float32Array,
  phase: number,
  waveCmps: number,
  dx: number,
  dy: number,
  zr: number,
  r: number,
  areaCm2: number,
  axial: (zr: number) => number,
  turbulence: number,
  out: FlowSample,
): void {
  const rho = Math.hypot(dx, dy);
  // the effective orifice: the velocity of the case's E wave times its area is the transmitral flow, so the convergence
  // and the jet up to the tips carry that flow and no more; with the anatomical radius (1.58 cm against 1.26 in the
  // normal case) the orifice section carried 1.7-1.9 times the inflow
  const re = Math.sqrt(areaCm2 / Math.PI);
  if (zr < 0) {
    const d = Math.hypot(rho, zr);
    if (d >= FUNNEL_FADE_TO_CM) return;
    const q = inflowFlow(tables, phase, 0, waveCmps, table);
    if (q <= 1) return;
    // a hemispheric sink carries π·re²·v0 through every hemisphere; only on the atrial side of the orifice: beside the
    // annulus, at its level, lie the outflow tract and the walls
    const mag =
      (q / areaCm2 / 100) *
      Math.min(1, (re * re) / (2 * d * d)) *
      fadeOut(d, FUNNEL_FADE_FROM_CM, FUNNEL_FADE_TO_CM) *
      convergenceWeight(rho, -zr, r);
    // toward a sink one orifice radius beyond the annulus: along the axis at the orifice, converging from the sides
    const sx = -dx,
      sy = -dy,
      sz = r - zr;
    const n = Math.hypot(sx, sy, sz);
    out.vx += (sx / n) * mag;
    out.vy += (sy / n) * mag;
    out.vz += (sz / n) * mag;
    out.dispersion = Math.max(out.dispersion, turbulence);
    out.present = 1;
    return;
  }
  // the jet keeps the effective orifice up to the leaflet tips, then widens for 4 cm and fills the cavity it reaches (it
  // entrains the blood around it: beyond the tips it carries more than the inflow, whose return is not modelled)
  const rHalf = re + Math.min(4, Math.max(0, zr - INFLOW_CORE_CM)) * 0.35;
  if (rho >= jetReach(rHalf, zr)) return;
  const q = inflowFlow(tables, phase, Math.hypot(zr, rho), waveCmps, table);
  if (q <= 1) return;
  // jet core with plug profile, slowing beyond the tips
  out.vz += (q / areaCm2 / 100) * jetProfile(rho, rHalf, zr) * axial(zr);
  out.dispersion = Math.max(out.dispersion, turbulence + 0.15 * Math.min(1, rho / r));
  out.present = 1;
}

/**
 * Inflow (mL/s) that left the leaflet tips when the filling wave now `zr` cm beyond an atrioventricular annulus was there
 * (decision 102): the wave takes (zr − INFLOW_CORE_CM)/speed to arrive. Zero for a wave that would have left before the
 * beat began, when the ventricle already contracts.
 */
function inflowFlow(
  tables: BeatTables,
  phase: number,
  zr: number,
  waveCmps: number,
  table: Float32Array = tables.mitralFlowMlps,
): number {
  const delayed = phase - Math.max(0, zr - INFLOW_CORE_CM) / (waveCmps * tables.rrS);
  return delayed < 0 ? 0 : sampleTable(table, delayed);
}

/**
 * Conventional colour M-mode slope (cm/s) of an inflow wave travelling at `waveCmps`, on the inflow axis at a fixed
 * position as an M-mode line sees it: from the leaflet tips at valve opening to 4 cm beyond them, the first time the
 * velocity reaches half the early-filling maximum at the tips, fitted against depth. The core slows with depth and the
 * annulus recoils during early filling, so the contour runs slower than the wave. NaN when the contour does not reach 4 cm.
 */
export function conventionalPropagation(
  tables: BeatTables,
  mapseCm: number,
  lvLengthCm: number,
  mvAreaCm2: number,
  waveCmps: number,
): number {
  const tm = tables.timings;
  const velocity = (z: number, t: number): number => {
    const phase = t / tables.rrS;
    const zAnn = mapseCm * sampleTable(tables.longitudinal, phase);
    const zr = z - zAnn;
    if (zr < 0) return 0;
    return (
      (inflowFlow(tables, phase, zr, waveCmps) / mvAreaCm2 / 100) *
      inflowAxial(zr, lvLengthCm - zAnn)
    );
  };
  const t0 = tm.mitralOpenS;
  // the maximum of the early wave at the tips: up to atrial contraction, or 50 ms past the E peak when atrial contraction
  // starts before it; its front reaches each depth first, whenever that is in diastole
  const eEnd = Math.min(
    tables.rrS,
    t0 + 0.5,
    tm.hasAWave ? Math.max(tm.aStartS, t0 + tm.eAccelS + 0.05) : Infinity,
  );
  const tEnd = tables.rrS;
  const tips = mapseCm * sampleTable(tables.longitudinal, t0 / tables.rrS) + INFLOW_CORE_CM;
  let vMax = 0;
  for (let t = t0; t < eEnd; t += 0.001) vMax = Math.max(vMax, velocity(tips, t));
  let n = 0,
    st = 0,
    sd = 0,
    stt = 0,
    std = 0;
  for (let d = 0; d <= 4.0001; d += 0.25) {
    let reached = -1;
    for (let t = t0; t < tEnd; t += 0.001)
      if (velocity(tips + d, t) >= 0.5 * vMax) {
        reached = t;
        break;
      }
    if (reached < 0) return Number.NaN;
    n++;
    st += reached;
    sd += d;
    stt += reached * reached;
    std += reached * d;
  }
  return (n * std - st * sd) / (n * stt - st * st);
}

/** Filling-wave speed (cm/s) at which the conventional slope reads `targetCmps`; the fastest tried when none is fast enough. */
export function solveInflowWave(
  tables: BeatTables,
  mapseCm: number,
  lvLengthCm: number,
  mvAreaCm2: number,
  targetCmps: number,
): number {
  let lo = Math.log(5),
    hi = Math.log(5000);
  const reads = (logSpeed: number): number =>
    conventionalPropagation(tables, mapseCm, lvLengthCm, mvAreaCm2, Math.exp(logSpeed));
  if (!(reads(hi) > targetCmps)) return Math.exp(hi);
  for (let it = 0; it < 24; it++) {
    const mid = 0.5 * (lo + hi);
    if (reads(mid) > targetCmps) hi = mid;
    else lo = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}

/**
 * Pulmonary venous velocities (spec 63): S follows the annular descent (LA reservoir) and is blunted by
 * mitral regurgitation, D mirrors the mitral E wave (conduit) and Ar is the atrial reversal (absent in AF).
 */
export function pulmonaryVeinPeaks(c: CaseDefinition): {
  sMps: number;
  dMps: number;
  arMps: number;
} {
  const mrEro = c.hemodynamics.regurgitation.mr?.eroaCm2 ?? 0;
  const s = 0.55 * Math.min(1.3, c.physiology.mapseCm / 1.3) * (1 - 0.9 * Math.min(1, mrEro / 0.4));
  const d = 0.58 * (c.physiology.ePeakMps / 0.8);
  const ar =
    c.rhythm.type === 'atrial-fibrillation' || c.physiology.aPeakMps <= 0
      ? 0
      : 0.22 + 0.12 * Math.min(1, (c.physiology.aPeakMps - 0.4) / 0.5);
  return { sMps: Math.max(0, s), dMps: d, arMps: ar };
}

/** Fractional LVOT narrowing along the ejection (dynamic: late-peaking as SAM contact develops; static: constant). */
export function lvotNarrowing(fMax: number, dynamic: boolean, u: number): number {
  if (fMax <= 0) return 0;
  if (!dynamic) return fMax;
  const s = Math.min(1, Math.max(0, (u - 0.25) / 0.6));
  return fMax * s * s * (3 - 2 * s);
}

/** Solve the maximal LVOT narrowing so that the peak LVOT velocity matches the case's peak gradient. */
export function solveLvotObstruction(
  tables: BeatTables,
  lvotAreaCm2: number,
  peakGradientMmHg: number,
  dynamic: boolean,
): { fMax: number; dynamic: boolean } | null {
  if (peakGradientMmHg <= 0) return null;
  const vTarget = Math.sqrt(peakGradientMmHg / 4);
  const tm = tables.timings;
  const vmaxFor = (fMax: number): number => {
    let best = 0;
    for (let i = 0; i < tables.n; i++) {
      const q = tables.aorticFlowMlps[i] ?? 0;
      if (q <= 0) continue;
      const t = ((i + 0.5) / tables.n) * tables.rrS;
      const u = (t - tm.ejectionStartS) / (tm.ejectionEndS - tm.ejectionStartS);
      const area = lvotAreaCm2 * (1 - lvotNarrowing(fMax, dynamic, u));
      best = Math.max(best, q / Math.max(area, 0.05) / 100);
    }
    return best;
  };
  let lo = 0,
    hi = 0.97;
  if (vmaxFor(hi) < vTarget) return { fMax: hi, dynamic };
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    if (vmaxFor(mid) < vTarget) lo = mid;
    else hi = mid;
  }
  return { fMax: (lo + hi) / 2, dynamic };
}

export function buildFlowParams(
  c: CaseDefinition,
  heart: HeartModel,
  tables: BeatTables,
): FlowFieldParams {
  const A = heartAnchors(heart);
  const turbulence: Record<string, number> = {};
  const enabled: Record<string, boolean> = {};
  for (const fp of c.flowPrimitives) {
    turbulence[fp.site] = fp.turbulence;
    enabled[fp.site] = fp.enabled;
  }
  const tr = c.hemodynamics.trPresent
    ? Math.sqrt(Math.max(0, (c.hemodynamics.paspMmHg - c.hemodynamics.rapMmHg) / 4))
    : null;
  return {
    lvotAreaCm2: circularArea(c.anatomy.aorta.lvotDiameterCm),
    avR: A.avR,
    avAreaCm2: c.hemodynamics.avEffectiveAreaCm2,
    mvAreaCm2: tables.mvEffectiveAreaCm2,
    tvAreaCm2: tables.mvEffectiveAreaCm2 * 1.35,
    rvotAreaCm2: Math.PI * 1.1 * 1.1,
    trVmaxMps: tr,
    turbulence,
    enabled,
    avAxis: A.avAxis,
    avCenter: A.avCenter,
    mvCenter: A.mvCenter,
    mvR: A.mvR,
    tvCenter: A.tvCenter,
    tvR: A.tvR,
    rvotA: A.rvotA,
    rvotB: A.rvotB,
    mrEroCm2: c.hemodynamics.regurgitation.mr?.eroaCm2 ?? 0,
    mrJetDirRad: ((c.hemodynamics.regurgitation.mr?.jetDirectionDeg ?? 0) * Math.PI) / 180,
    arEroCm2: c.hemodynamics.regurgitation.ar?.eroaCm2 ?? 0,
    trEroCm2: c.hemodynamics.regurgitation.tr?.eroaCm2 ?? null,
    lvotObstruction: solveLvotObstruction(
      tables,
      circularArea(c.anatomy.aorta.lvotDiameterCm),
      c.hemodynamics.lvotPeakGradientMmHg,
      c.anatomy.mitral.samSeverity > 0,
    ),
    pulmonaryVeins: {
      laCenter: A.laCenter,
      laR: A.laR,
      laReservoir: A.laReservoir,
      ...pulmonaryVeinPeaks(c),
    },
    inflowPropagationCmps: flowPropagationCmps(c),
    inflowWaveCmps: solveInflowWave(
      tables,
      c.physiology.mapseCm,
      heart.lv.lengthCm,
      tables.mvEffectiveAreaCm2,
      flowPropagationCmps(c),
    ),
  };
}

const SYSTOLE_SHAPE = (u: number): number =>
  u <= 0 || u >= 1 ? 0 : Math.pow(Math.sin(Math.PI * u), 0.8);

/** Sample the flow field at heart-frame point (x,y,z) for the given phase. */
export function sampleFlow(
  p: FlowFieldParams,
  tables: BeatTables,
  hp: HeartPose,
  phase: number,
  x: number,
  y: number,
  z: number,
  out: FlowSample,
): void {
  out.vx = 0;
  out.vy = 0;
  out.vz = 0;
  out.dispersion = 0;
  out.present = 0;
  const qao = sampleTable(tables.aorticFlowMlps, phase);
  const zAnn = hp.zAnn;

  // ---- Mitral inflow: from the LA through the annulus into the LV toward the apex ----
  const zrMv = z - zAnn; // distance beyond the annulus into the LV
  if (
    p.enabled['mitral-inflow'] !== false &&
    zrMv > -FUNNEL_FADE_TO_CM &&
    zrMv < hp.lengthNow - 0.2
  )
    inflowJet(
      tables,
      tables.mitralFlowMlps,
      phase,
      p.inflowWaveCmps,
      x - p.mvCenter.x,
      y - p.mvCenter.y,
      zrMv,
      p.mvR * 1.05,
      p.mvAreaCm2,
      (zr) => inflowAxial(zr, hp.lengthNow),
      p.turbulence['mitral-inflow'] ?? 0.04,
      out,
    );
  // ---- LVOT → aortic valve → ascending aorta ----
  if ((p.enabled['lvot'] !== false || p.enabled['aortic-valve'] !== false) && qao > 1) {
    const ax = p.avAxis;
    const cz = p.avCenter.z + zAnn * ROOT_EXCURSION;
    const dx = x - p.avCenter.x,
      dy = y - p.avCenter.y,
      dz = z - cz;
    const t = dx * ax.x + dy * ax.y + dz * ax.z;
    const qx = dx - ax.x * t,
      qy = dy - ax.y * t,
      qz = dz - ax.z * t;
    const rho = Math.sqrt(qx * qx + qy * qy + qz * qz);
    const rLvot = Math.sqrt(p.lvotAreaCm2 / Math.PI);
    // a subaortic/dynamic obstruction narrows the effective area around the septal contact point (t ≈ −0.6)
    const narrowAt = (tt: number): number => {
      if (!p.lvotObstruction) return 0;
      const tm = tables.timings;
      const u = (phase * tables.rrS - tm.ejectionStartS) / (tm.ejectionEndS - tm.ejectionStartS);
      const w = Math.exp(-((tt + 0.6) * (tt + 0.6)) / (2 * 0.45 * 0.45));
      return lvotNarrowing(p.lvotObstruction.fMax, p.lvotObstruction.dynamic, u) * w;
    };
    if (t < LVOT_ENTRANCE_T) {
      // the cavity converges on the entrance of the outflow tract (decision 166): a hemispheric sink carries the aortic
      // flow through every hemisphere around the entrance, capped at the tract's velocity, so its colour ends on a curve
      // where it falls under the wall filter. A widening cone cut 3.5 cm below the valve drew a straight edge there.
      const up = LVOT_ENTRANCE_T - t;
      const d = Math.hypot(rho, up);
      if (d < LVOT_SINK_FADE_TO_CM) {
        const vEntrance = qao / (p.lvotAreaCm2 * (1 - narrowAt(LVOT_ENTRANCE_T))) / 100;
        const v =
          Math.min(vEntrance, qao / (2 * Math.PI * d * d) / 100) *
          fadeOut(d, LVOT_SINK_FADE_FROM_CM, LVOT_SINK_FADE_TO_CM) *
          convergenceWeight(rho, up, rLvot, LVOT_SINK_COS_FROM, LVOT_SINK_COS_TO);
        if (v > 0) {
          // toward the entrance point, on the axis LVOT_ENTRANCE_T from the valve
          out.vx += ((-qx + ax.x * up) / d) * v;
          out.vy += ((-qy + ax.y * up) / d) * v;
          out.vz += ((-qz + ax.z * up) / d) * v;
          out.dispersion = Math.max(out.dispersion, p.turbulence['lvot'] ?? 0.04);
          out.present = 1;
        }
      }
    } else if (t < 5.5) {
      let area: number;
      let R: number;
      if (t < 0) {
        // LVOT: the tract's diameter, widening over the last LVOT_TAPER_CM to the annulus as the drawn lumen does
        // (decision 161), narrowed by an obstruction
        const widen = lvotRadiusAt(p.avR, rLvot, t) / rLvot;
        const narrow = narrowAt(t);
        R = rLvot * widen * Math.sqrt(1 - narrow);
        area = p.lvotAreaCm2 * widen * widen * (1 - narrow);
      } else if (t < 1.0) {
        // vena contracta at/just beyond the valve: effective orifice area
        R = Math.sqrt(p.avAreaCm2 / Math.PI) * 1.15;
        area = p.avAreaCm2;
      } else {
        // jet spreading in the root / ascending aorta, momentum decays
        const spread = 1 + (t - 1.0) * 0.45;
        R = Math.sqrt(p.avAreaCm2 / Math.PI) * 1.15 * spread;
        area = p.avAreaCm2 * spread * spread;
      }
      // ½ velocity where the old plug profile had it; beyond the vena contracta a stenotic jet keeps the thin shear layer
      // of a fast jet and the normal outflow the one of the slow flows, and the jet fades out at its end
      const rHalf = 0.917 * R;
      const sShear = Math.max(0, t - 1);
      const shear = p.avAreaCm2 < 2.0 ? FAST_JET_SHEAR : SLOW_SHEAR;
      if (rho < jetReach(rHalf, sShear, shear)) {
        const v = qao / area / 100;
        const prof = jetProfile(rho, rHalf, sShear, shear) * fadeOut(t, 4, 5.5);
        out.vx += ax.x * v * prof;
        out.vy += ax.y * v * prof;
        out.vz += ax.z * v * prof;
        const stenotic =
          p.avAreaCm2 < 2.0 && t > 0
            ? Math.min(0.6, (2.0 - p.avAreaCm2) * 0.5)
            : p.lvotObstruction && t < 0
              ? 0.4 * (1 - area / p.lvotAreaCm2)
              : 0;
        // beyond the valve the case's own turbulence for it, when larger than what the tract and the stenosis give
        // (decision 171): the two describe the same jet and are not added
        out.dispersion = Math.max(
          out.dispersion,
          (p.turbulence['lvot'] ?? 0.04) +
            stenotic * (t > 0 ? 1 : 0.3) +
            0.1 * Math.pow(Math.min(1, rho / R), 4),
          t > 0 ? (p.turbulence['aortic-valve'] ?? 0) : 0,
        );
        out.present = 1;
      }
    }
  }
  // ---- Tricuspid inflow (mirrors mitral, larger area): its table carries its own timing (decision 162) ----
  const zrTv = z - (p.tvCenter.z + hp.tvZ);
  if (p.enabled['tricuspid-inflow'] !== false && zrTv > -FUNNEL_FADE_TO_CM && zrTv < 5)
    inflowJet(
      tables,
      tables.tricuspidFlowMlps,
      phase,
      p.inflowWaveCmps,
      x - p.tvCenter.x,
      y - p.tvCenter.y,
      zrTv,
      p.tvR * 1.05,
      p.tvAreaCm2,
      // slowing beyond the tips and fading out over the last centimetre it reaches
      (zr) => (zr < 1.2 ? 1 : 1 / (1 + (zr - 1.2) / 2.2)) * fadeOut(zr, 4, 5),
      p.turbulence['tricuspid-inflow'] ?? 0.04,
      out,
    );
  // ---- RVOT / pulmonary ----
  if (p.enabled['rvot'] !== false) {
    const qpv = sampleTable(tables.pulmonaryFlowMlps, phase);
    if (qpv > 1) {
      // the outflow tract moves with the base (decision 111): a translation along z, which leaves its axis unchanged
      const ax = p.rvotB.x - p.rvotA.x,
        ay = p.rvotB.y - p.rvotA.y,
        az = p.rvotB.z - p.rvotA.z;
      const L = Math.hypot(ax, ay, az);
      const ux = ax / L,
        uy = ay / L,
        uz = az / L;
      const dx = x - p.rvotA.x,
        dy = y - p.rvotA.y,
        dz = z - hp.pvZ - p.rvotA.z;
      const t = dx * ux + dy * uy + dz * uz;
      if (t > -1 && t < L + 1) {
        const qx = dx - ux * t,
          qy = dy - uy * t,
          qz = dz - uz * t;
        const rho = Math.sqrt(qx * qx + qy * qy + qz * qz);
        // ½ velocity where the old plug profile had it; the tube fades in below the tract and out beyond the trunk
        if (rho < jetReach(0.89 * 1.05, 0)) {
          const v = qpv / p.rvotAreaCm2 / 100;
          const prof =
            jetProfile(rho, 0.89 * 1.05, 0) * smoothstep(-1, 0, t) * fadeOut(t, L, L + 1);
          out.vx += ux * v * prof;
          out.vy += uy * v * prof;
          out.vz += uz * v * prof;
          out.dispersion = Math.max(out.dispersion, p.turbulence['rvot'] ?? 0.04);
          out.present = 1;
        }
      }
    }
  }
  // ---- TR jet (systole): from the tricuspid coaptation into the RA, narrow, high velocity ----
  if (p.enabled['tr-jet'] !== false && p.trVmaxMps) {
    const tm = tables.timings;
    const t = phase * tables.rrS;
    const u = (t - tm.ejectionStartS + 0.02) / (tm.ejectionEndS - tm.ejectionStartS + 0.04);
    const s = SYSTOLE_SHAPE(u);
    if (s > 0.02) {
      const ox = p.tvCenter.x,
        oy = p.tvCenter.y,
        oz = p.tvCenter.z + hp.tvZ + 0.3; // coaptation just apical of the annulus
      const dx = x - ox,
        dy = y - oy,
        dzj = oz - z; // distance along −z (toward RA)
      const rho = Math.hypot(dx, dy);
      if (dzj > -1.4 && dzj < 4.5) {
        const r0 = p.trEroCm2 ? Math.sqrt(p.trEroCm2 / Math.PI) * 1.1 : 0.25;
        const Rj = r0 + Math.max(0, dzj) * 0.28; // jet spreading
        const vmax = p.trVmaxMps * s;
        // ½ velocity where the old profile had it; the jet fades out over its last centimetre
        const rHalf = 0.84 * Rj;
        if (dzj >= 0 && rho < jetReach(rHalf, dzj, FAST_JET_SHEAR)) {
          const prof = jetProfile(rho, rHalf, dzj, FAST_JET_SHEAR);
          const decay = (dzj < 1.0 ? 1 : 1 / (1 + (dzj - 1.0) / 1.6)) * fadeOut(dzj, 3.5, 4.5);
          out.vz -= vmax * prof * decay; // toward the RA (−z)
          // the case's turbulence for the jet, 0.25 when it declares none (decision 171)
          out.dispersion = Math.max(
            out.dispersion,
            (p.turbulence['tr-jet'] ?? 0.25) + 0.2 * Math.min(1, rho / Rj),
          );
          out.present = 1;
        } else if (dzj < 0) {
          // PISA-like convergence on the RV side, fading out where it used to stop
          const d = Math.hypot(rho, -dzj) + 0.2;
          if (d < 1.4) {
            const conv =
              Math.min(vmax * 0.5, (vmax * r0 * r0) / (2 * d * d)) *
              fadeOut(d, 0.8, 1.4) *
              convergenceWeight(rho, -dzj, r0);
            out.vz -= conv;
            out.present = 1;
            out.dispersion = Math.max(out.dispersion, 0.1);
          }
        }
      }
    }
  }
  sampleRegurgitantJets(p, tables, hp, phase, x, y, z, out);
  samplePulmonaryVeins(p, tables, hp, phase, x, y, z, out);
}

/** Pulmonary venous flow in the four vein stubs and their ostia (geometry mirrors heartModel's veins). */
export function samplePulmonaryVeins(
  p: FlowFieldParams,
  tables: BeatTables,
  hp: HeartPose,
  phase: number,
  x: number,
  y: number,
  z: number,
  out: FlowSample,
): void {
  if (p.enabled['pulmonary-vein'] === false) return;
  const pv = p.pulmonaryVeins;
  const la = pv.laCenter,
    lr = pv.laR;
  // quick reject: far from the atrium's sides and back
  if (y > la.y + lr.y * 0.3 + PV_REACH || Math.abs(x - la.x) > lr.x + PV_REACH + 1) return;
  const zTop = la.z - lr.z;
  const zBottom = hp.zAnn + 0.25;
  const czL = (zTop + zBottom) / 2;
  const tm = tables.timings;
  const t = phase * tables.rrS;
  // S: during ventricular systole (annular descent pulls blood into the LA)
  const uS = (t - tm.ejectionStartS + 0.03) / (tm.ejectionEndS - tm.ejectionStartS + 0.08);
  const sWave = uS > 0 && uS < 1 ? Math.pow(Math.sin(Math.PI * uS), 0.9) : 0;
  // D: mirrors the mitral E wave (conduit), Ar: atrial contraction reversal
  const qmvMax = Math.max(1e-6, ...Array.from(tables.mitralFlowMlps));
  const inE = t > tm.mitralOpenS && t < tm.mitralOpenS + tm.eAccelS + tm.eDecelS + 0.02;
  const dWave = inE ? sampleTable(tables.mitralFlowMlps, phase) / qmvMax : 0;
  const inA = tm.hasAWave && t > tm.aStartS && t < tm.aEndS + 0.03;
  const arWave = inA ? Math.sin((Math.PI * (t - tm.aStartS)) / (tm.aEndS + 0.03 - tm.aStartS)) : 0;
  const vAlong = pv.sMps * sWave + pv.dMps * dWave - pv.arMps * arWave; // + = into the LA
  if (Math.abs(vAlong) < 0.02) return;
  const rzL = (zBottom - zTop) / 2;
  const bo = atrialScale(hp.laBooster, pv.laReservoir, hp.state.contraction);
  for (let i = 0; i < 4; i++) {
    // the vein of the classifier (pulmonaryVeins.ts): the flow runs where the wall is drawn
    pulmonaryVeinSegment(i, la, lr, bo, czL, rzL, PV_SEG);
    const ox = PV_SEG[0]!,
      oy = PV_SEG[1]!,
      oz = PV_SEG[2]!;
    const ex = PV_SEG[3]!,
      ey = PV_SEG[4]!,
      ez = PV_SEG[5]!;
    // vein axis from the distal end toward the ostium, extended 0.8 cm into the LA
    const ax = ox - ex,
      ay = oy - ey,
      az = oz - ez;
    const L = Math.hypot(ax, ay, az);
    const ux = ax / L,
      uy = ay / L,
      uz = az / L;
    const dx = x - ex,
      dy = y - ey,
      dz = z - ez;
    const along = dx * ux + dy * uy + dz * uz;
    if (along < 0 || along > L + 1.1) continue;
    const qx = dx - ux * along,
      qy = dy - uy * along,
      qz = dz - uz * along;
    const rho = Math.sqrt(qx * qx + qy * qy + qz * qz);
    const R = along <= L ? PV_RADIUS - 0.03 : PV_RADIUS - 0.03 + (along - L) * 0.6; // spreads into the atrium
    // ½ velocity where the old profile had it; beyond the ostium the stream thickens its shear layer and fades out
    const sOut = Math.max(0, along - L);
    if (rho >= jetReach(0.84 * R, sOut)) continue;
    const prof = jetProfile(rho, 0.84 * R, sOut);
    // the stream fades in from the distal end of the drawn vein and out into the atrium
    const decay =
      (along <= L ? 1 : 1 / (1 + (along - L) / 0.6)) *
      smoothstep(0, 0.5, along) *
      fadeOut(along, L + 0.4, L + 1.1);
    const v = vAlong * prof * decay;
    out.vx += ux * v;
    out.vy += uy * v;
    out.vz += uz * v;
    out.dispersion = Math.max(out.dispersion, p.turbulence['pulmonary-vein'] ?? 0.06);
    out.present = 1;
    return;
  }
}

/** Regurgitant jets (MR in systole into the LA, AR in diastole into the LV) with proximal flow convergence (PISA). */
export function sampleRegurgitantJets(
  p: FlowFieldParams,
  tables: BeatTables,
  hp: HeartPose,
  phase: number,
  x: number,
  y: number,
  z: number,
  out: FlowSample,
): void {
  const zAnn = hp.zAnn;
  // ---- MR jet ----
  if (p.enabled['mr-jet'] !== false && p.mrEroCm2 > 0) {
    const q = sampleTable(tables.mrFlowMlps, phase);
    if (q > 1) {
      const vj = q / p.mrEroCm2 / 100; // vena contracta velocity (m/s)
      const r0 = Math.sqrt(p.mrEroCm2 / Math.PI) * 1.1;
      // coaptation just apical of the annulus; jet direction in the x–z plane, tilted by the case's eccentricity
      const ox = p.mvCenter.x,
        oy = p.mvCenter.y,
        oz = zAnn - 0.1;
      const dirX = Math.sin(p.mrJetDirRad),
        dirZ = -Math.cos(p.mrJetDirRad);
      const dx = x - ox,
        dy = y - oy,
        dz = z - oz;
      const along = dx * dirX + dz * dirZ; // distance along the jet (into the LA)
      const px = dx - dirX * along,
        pz = dz - dirZ * along;
      const rho = Math.hypot(px, dy, pz);
      if (along >= 0 && along < 5.5) {
        // ½ velocity where the old profile had it; the jet fades out over its last 1.5 cm (decision 166)
        const rHalf = 0.84 * (r0 + along * 0.3);
        if (rho < jetReach(rHalf, along, FAST_JET_SHEAR)) {
          const prof = jetProfile(rho, rHalf, along, FAST_JET_SHEAR);
          const decay = (along < 1.2 ? 1 : 1 / (1 + (along - 1.2) / 1.8)) * fadeOut(along, 4, 5.5);
          const v = vj * prof * decay;
          out.vx += dirX * v;
          out.vz += dirZ * v;
          // the case's turbulence for the jet, 0.3 when it declares none (decision 171)
          out.dispersion = Math.max(
            out.dispersion,
            (p.turbulence['mr-jet'] ?? 0.3) + 0.2 * Math.min(1, rho / (rHalf / 0.84)),
          );
          out.present = 1;
        }
      } else if (along < 0) {
        // PISA: hemispheric convergence on the LV side, v = Q / (2π r²), fading out where it used to stop
        const d = Math.hypot(dx, dy, dz);
        if (d < 1.8 && d > 0.05) {
          const v =
            Math.min(vj * 0.6, q / (2 * Math.PI * d * d) / 100) *
            fadeOut(d, 1.2, 1.8) *
            convergenceWeight(rho, -along, r0);
          if (v > 0.03) {
            out.vx += (-dx / d) * v;
            out.vy += (-dy / d) * v;
            out.vz += (-dz / d) * v;
            out.dispersion = Math.max(out.dispersion, 0.08);
            out.present = 1;
          }
        }
      }
    }
  }
  // ---- AR jet ----
  if (p.enabled['ar-jet'] !== false && p.arEroCm2 > 0) {
    const q = sampleTable(tables.arFlowMlps, phase);
    if (q > 1) {
      const vj = q / p.arEroCm2 / 100;
      const r0 = Math.sqrt(p.arEroCm2 / Math.PI) * 1.1;
      const ax = p.avAxis;
      const cz = p.avCenter.z + zAnn * ROOT_EXCURSION;
      const dx = x - p.avCenter.x,
        dy = y - p.avCenter.y,
        dz = z - cz;
      const t = dx * ax.x + dy * ax.y + dz * ax.z; // along the root axis (negative = into the LV)
      const qx = dx - ax.x * t,
        qy = dy - ax.y * t,
        qz = dz - ax.z * t;
      const rho = Math.sqrt(qx * qx + qy * qy + qz * qz);
      const along = -t;
      if (along >= 0 && along < 6) {
        // ½ velocity where the old profile had it; the jet fades out over its last 1.5 cm (decision 166)
        const rHalf = 0.84 * (r0 + along * 0.35);
        if (rho < jetReach(rHalf, along, FAST_JET_SHEAR)) {
          const prof = jetProfile(rho, rHalf, along, FAST_JET_SHEAR);
          const decay = (along < 1.5 ? 1 : 1 / (1 + (along - 1.5) / 2.0)) * fadeOut(along, 4.5, 6);
          const v = vj * prof * decay;
          out.vx -= ax.x * v;
          out.vy -= ax.y * v;
          out.vz -= ax.z * v;
          out.dispersion = Math.max(
            out.dispersion,
            (p.turbulence['ar-jet'] ?? 0.3) + 0.2 * Math.min(1, rho / (rHalf / 0.84)),
          );
          out.present = 1;
        }
      } else if (along < 0) {
        // convergence in the root, fading out where it used to stop
        const d = Math.hypot(dx, dy, dz);
        if (d > 0.05 && d < 1.5) {
          const v =
            Math.min(vj * 0.6, q / (2 * Math.PI * d * d) / 100) *
            fadeOut(d, 1.0, 1.5) *
            convergenceWeight(rho, -along, r0);
          if (v > 0.03) {
            out.vx += (-dx / d) * v;
            out.vy += (-dy / d) * v;
            out.vz += (-dz / d) * v;
            out.present = 1;
          }
        }
      }
    }
  }
}

/** Structures of the right ventricle, whose tissue moves with the tricuspid annulus. */
const RV_TISSUE = new Set<number>([
  Structure.RvWall,
  Structure.TricuspidAnnulus,
  Structure.RvPapillary,
  Structure.ModeratorBand,
]);

/**
 * Tissue (myocardial) velocity for TDI (m/s, heart frame) at heart-frame point (x, y, z): the longitudinal annular motion of
 * the shared displacement table, scaled by level (base moves, apex fixed) and by wall (decision 98). The table recoils at
 * the case's septal e′ (decision 80); the lateral wall moves by the case's lateral over septal e′, the septum by 1, and the
 * walls between by a cosine of the azimuth. Every wall used to move alike, so tissue Doppler at the lateral annulus read
 * the septal e′: 8.6 cm/s where the normal case's 14 cm/s projected to 10.6, 16–29% low in the twelve cases.
 */
export function sampleTissueVelocity(
  heart: HeartModel,
  tables: BeatTables,
  phase: number,
  x: number,
  y: number,
  z: number,
  structure = -1,
): { vx: number; vy: number; vz: number } {
  if (RV_TISSUE.has(structure)) {
    // the right ventricle moves with its own annular table and TAPSE (decision 106), from the tricuspid annulus to its apex
    const A = heartAnchors(heart);
    const apexZ = A.rvApexFrac * heart.lv.lengthCm;
    const rvLevel = Math.min(
      1,
      Math.max(0, (z - A.tvCenter.z) / Math.max(1, apexZ - A.tvCenter.z)),
    );
    return {
      vx: 0,
      vy: 0,
      vz:
        (heart.physiology.tapseCm *
          sampleTable(tables.rvLongitudinalVelocity, phase) *
          (1 - rvLevel)) /
        100,
    };
  }
  const longVel = sampleTable(tables.longitudinalVelocity, phase); // fraction of MAPSE per s
  const mapse = heart.physiology.mapseCm;
  const level = Math.min(1, Math.max(0, z / heart.lv.lengthCm));
  const rho = Math.hypot(x, y);
  const lateralness = rho > 1e-6 ? 0.5 * (1 + x / rho) : 0.5; // 1 at the lateral wall (+x), 0 at the septum (−x)
  const wall =
    1 + (heart.physiology.ePrimeLateralCmps / heart.physiology.ePrimeSeptalCmps - 1) * lateralness;
  const vz = (mapse * longVel * (1 - level) * wall) / 100; // cm/s → m/s, +z = toward the apex (systole)
  return { vx: 0, vy: 0, vz };
}
