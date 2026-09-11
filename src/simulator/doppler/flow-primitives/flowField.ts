import { heartAnchors, type HeartModel, type HeartPose } from '@/simulator/anatomy/heartModel';
import type { BeatTables } from '@/simulator/cardiac-cycle/cycleModel';
import { sampleTable } from '@/simulator/cardiac-cycle/cycleModel';
import type { CaseDefinition } from '@/cases/schema';
import { circularArea } from '@/clinical/formulas';

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
  pulmonaryVeins: { laCenter: { x: number; y: number; z: number }; laR: { x: number; y: number; z: number }; sMps: number; dMps: number; arMps: number };
}

/**
 * Pulmonary venous velocities (spec 63): S follows the annular descent (LA reservoir) and is blunted by
 * mitral regurgitation, D mirrors the mitral E wave (conduit) and Ar is the atrial reversal (absent in AF).
 */
export function pulmonaryVeinPeaks(c: CaseDefinition): { sMps: number; dMps: number; arMps: number } {
  const mrEro = c.hemodynamics.regurgitation.mr?.eroaCm2 ?? 0;
  const s = 0.55 * Math.min(1.3, c.physiology.mapseCm / 1.3) * (1 - 0.9 * Math.min(1, mrEro / 0.4));
  const d = 0.58 * (c.physiology.ePeakMps / 0.8);
  const ar = c.rhythm.type === 'atrial-fibrillation' || c.physiology.aPeakMps <= 0 ? 0 : 0.22 + 0.12 * Math.min(1, (c.physiology.aPeakMps - 0.4) / 0.5);
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
export function solveLvotObstruction(tables: BeatTables, lvotAreaCm2: number, peakGradientMmHg: number, dynamic: boolean): { fMax: number; dynamic: boolean } | null {
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

export function buildFlowParams(c: CaseDefinition, heart: HeartModel, tables: BeatTables): FlowFieldParams {
  const A = heartAnchors(heart);
  const turbulence: Record<string, number> = {};
  const enabled: Record<string, boolean> = {};
  for (const fp of c.flowPrimitives) {
    turbulence[fp.site] = fp.turbulence;
    enabled[fp.site] = fp.enabled;
  }
  const tr = c.hemodynamics.trPresent ? Math.sqrt(Math.max(0, (c.hemodynamics.paspMmHg - c.hemodynamics.rapMmHg) / 4)) : null;
  return {
    lvotAreaCm2: circularArea(c.anatomy.aorta.lvotDiameterCm),
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
    lvotObstruction: solveLvotObstruction(tables, circularArea(c.anatomy.aorta.lvotDiameterCm), c.hemodynamics.lvotPeakGradientMmHg, c.anatomy.mitral.samSeverity > 0),
    pulmonaryVeins: { laCenter: A.laCenter, laR: A.laR, ...pulmonaryVeinPeaks(c) },
  };
}

const SYSTOLE_SHAPE = (u: number): number => (u <= 0 || u >= 1 ? 0 : Math.pow(Math.sin(Math.PI * u), 0.8));

/** Sample the flow field at heart-frame point (x,y,z) for the given phase. */
export function sampleFlow(p: FlowFieldParams, tables: BeatTables, hp: HeartPose, phase: number, x: number, y: number, z: number, out: FlowSample): void {
  out.vx = 0;
  out.vy = 0;
  out.vz = 0;
  out.dispersion = 0;
  out.present = 0;
  const qmv = sampleTable(tables.mitralFlowMlps, phase); // mL/s
  const qao = sampleTable(tables.aorticFlowMlps, phase);
  const zAnn = hp.zAnn;

  // ---- Mitral inflow: from the LA through the annulus into the LV toward the apex ----
  if (p.enabled['mitral-inflow'] !== false && qmv > 1) {
    const dx = x - p.mvCenter.x,
      dy = y - p.mvCenter.y;
    const rho = Math.hypot(dx, dy);
    const zr = z - zAnn; // distance beyond the annulus into the LV
    const R = p.mvR * 1.05;
    if (zr > -2.5 && zr < 5.5 && rho < R + Math.max(0, zr) * 0.35) {
      const v0 = qmv / p.mvAreaCm2 / 100; // m/s at the orifice
      let mag: number;
      if (zr < 0) {
        // LA side: convergence toward the annulus (hemispheric-ish), slower
        const d = Math.max(0.6, -zr);
        mag = v0 * Math.min(1, (R * R) / (2 * d * d)) * 0.9;
      } else {
        // jet core with plug profile, spreading and decaying ~ 1/(1+zr/3)
        const Rj = R + zr * 0.35;
        const prof = 1 - Math.pow(Math.min(1, rho / Rj), 6);
        mag = v0 * prof * (zr < 1.2 ? 1 : 1 / (1 + (zr - 1.2) / 2.2));
      }
      out.vz += mag; // toward the apex
      out.dispersion = Math.max(out.dispersion, (p.turbulence['mitral-inflow'] ?? 0.04) + 0.15 * Math.min(1, rho / R));
      out.present = 1;
    }
  }
  // ---- LVOT → aortic valve → ascending aorta ----
  if ((p.enabled['lvot'] !== false || p.enabled['aortic-valve'] !== false) && qao > 1) {
    const ax = p.avAxis;
    const cz = p.avCenter.z + zAnn * 0.5;
    const dx = x - p.avCenter.x,
      dy = y - p.avCenter.y,
      dz = z - cz;
    const t = dx * ax.x + dy * ax.y + dz * ax.z;
    if (t > -3.5 && t < 5) {
      const qx = dx - ax.x * t,
        qy = dy - ax.y * t,
        qz = dz - ax.z * t;
      const rho = Math.sqrt(qx * qx + qy * qy + qz * qz);
      let area: number;
      let R: number;
      const rLvot = Math.sqrt(p.lvotAreaCm2 / Math.PI);
      if (t < 0) {
        // LVOT: converging from the LV cavity (wider) to the LVOT diameter; a subaortic/dynamic obstruction
        // narrows the effective area around the septal contact point (t ≈ −0.6)
        const widen = 1 + Math.max(0, -t - 0.8) * 0.6;
        let narrow = 0;
        if (p.lvotObstruction) {
          const tm = tables.timings;
          const u = (phase * tables.rrS - tm.ejectionStartS) / (tm.ejectionEndS - tm.ejectionStartS);
          const w = Math.exp(-((t + 0.6) * (t + 0.6)) / (2 * 0.45 * 0.45));
          narrow = lvotNarrowing(p.lvotObstruction.fMax, p.lvotObstruction.dynamic, u) * w;
        }
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
      if (rho < R) {
        const v = qao / area / 100;
        const prof = 1 - Math.pow(rho / R, 8);
        out.vx += ax.x * v * prof;
        out.vy += ax.y * v * prof;
        out.vz += ax.z * v * prof;
        const stenotic = p.avAreaCm2 < 2.0 && t > 0 ? Math.min(0.6, (2.0 - p.avAreaCm2) * 0.5) : p.lvotObstruction && t < 0 ? 0.4 * (1 - area / p.lvotAreaCm2) : 0;
        out.dispersion = Math.max(out.dispersion, (p.turbulence['lvot'] ?? 0.04) + stenotic * (t > 0 ? 1 : 0.3) + 0.1 * Math.pow(rho / R, 4));
        out.present = 1;
      }
    }
  }
  // ---- Tricuspid inflow (mirrors mitral, larger area, slight delay) ----
  if (p.enabled['tricuspid-inflow'] !== false) {
    const qtv = sampleTable(tables.mitralFlowMlps, phase - 0.01);
    if (qtv > 1) {
      const dx = x - p.tvCenter.x,
        dy = y - p.tvCenter.y;
      const rho = Math.hypot(dx, dy);
      const zr = z - (p.tvCenter.z + hp.tvZ);
      const R = p.tvR * 1.05;
      if (zr > -2.2 && zr < 5 && rho < R + Math.max(0, zr) * 0.35) {
        const v0 = qtv / p.tvAreaCm2 / 100;
        const mag = zr < 0 ? v0 * Math.min(1, (R * R) / (2 * Math.max(0.6, -zr) ** 2)) * 0.9 : v0 * (1 - Math.pow(Math.min(1, rho / (R + zr * 0.35)), 6)) * (zr < 1.2 ? 1 : 1 / (1 + (zr - 1.2) / 2.2));
        out.vz += mag;
        out.dispersion = Math.max(out.dispersion, p.turbulence['tricuspid-inflow'] ?? 0.04);
        out.present = 1;
      }
    }
  }
  // ---- RVOT / pulmonary ----
  if (p.enabled['rvot'] !== false) {
    const qpv = sampleTable(tables.aorticFlowMlps, phase + 0.01);
    if (qpv > 1) {
      const ax = p.rvotB.x - p.rvotA.x,
        ay = p.rvotB.y - p.rvotA.y,
        az = p.rvotB.z - p.rvotA.z;
      const L = Math.hypot(ax, ay, az);
      const ux = ax / L,
        uy = ay / L,
        uz = az / L;
      const dx = x - p.rvotA.x,
        dy = y - p.rvotA.y,
        dz = z - p.rvotA.z;
      const t = dx * ux + dy * uy + dz * uz;
      if (t > -1 && t < L + 1) {
        const qx = dx - ux * t,
          qy = dy - uy * t,
          qz = dz - uz * t;
        const rho = Math.sqrt(qx * qx + qy * qy + qz * qz);
        if (rho < 1.05) {
          const v = qpv / p.rvotAreaCm2 / 100;
          const prof = 1 - Math.pow(rho / 1.05, 6);
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
      if (dzj > -0.6 && dzj < 4.5) {
        const r0 = p.trEroCm2 ? Math.sqrt(p.trEroCm2 / Math.PI) * 1.1 : 0.25;
        const Rj = r0 + Math.max(0, dzj) * 0.28; // jet spreading
        const vmax = p.trVmaxMps * s;
        if (dzj >= 0 && rho < Rj) {
          const prof = 1 - Math.pow(rho / Rj, 4);
          const decay = dzj < 1.0 ? 1 : 1 / (1 + (dzj - 1.0) / 1.6);
          out.vz -= vmax * prof * decay; // toward the RA (−z)
          out.dispersion = Math.max(out.dispersion, 0.25 + 0.2 * (rho / Rj));
          out.present = 1;
        } else if (dzj < 0 && rho < 1.2) {
          // PISA-like convergence on the RV side
          const d = Math.hypot(rho, -dzj) + 0.2;
          const conv = Math.min(vmax * 0.5, (vmax * r0 * r0) / (2 * d * d));
          out.vz -= conv;
          out.present = 1;
          out.dispersion = Math.max(out.dispersion, 0.1);
        }
      }
    }
  }
  sampleRegurgitantJets(p, tables, hp, phase, x, y, z, out);
  samplePulmonaryVeins(p, tables, hp, phase, x, y, z, out);
}

/** Pulmonary venous flow in the four vein stubs and their ostia (geometry mirrors heartModel's veins). */
export function samplePulmonaryVeins(p: FlowFieldParams, tables: BeatTables, hp: HeartPose, phase: number, x: number, y: number, z: number, out: FlowSample): void {
  if (p.enabled['pulmonary-vein'] === false) return;
  const pv = p.pulmonaryVeins;
  const la = pv.laCenter,
    lr = pv.laR;
  // quick reject: far from the posterior LA
  if (y > la.y - lr.y * 0.3 || Math.abs(x - la.x) > lr.x + 1.5) return;
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
  for (let i = 0; i < 4; i++) {
    const sx = i % 2 === 0 ? -1 : 1;
    const ox = la.x + sx * lr.x * 0.6;
    const oz = czL + (i < 2 ? -0.7 : 0.6);
    const oy = la.y - lr.y * 0.8;
    const ex = ox + sx * 0.9,
      ey = oy - 1.6,
      ez = oz + (i < 2 ? -0.5 : 0.4);
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
    if (along < 0 || along > L + 0.8) continue;
    const qx = dx - ux * along,
      qy = dy - uy * along,
      qz = dz - uz * along;
    const rho = Math.sqrt(qx * qx + qy * qy + qz * qz);
    const R = along <= L ? 0.42 : 0.42 + (along - L) * 0.6; // spreads into the atrium
    if (rho >= R) continue;
    const prof = 1 - Math.pow(rho / R, 4);
    const decay = along <= L ? 1 : 1 / (1 + (along - L) / 0.6);
    const v = vAlong * prof * decay;
    out.vx += ux * v;
    out.vy += uy * v;
    out.vz += uz * v;
    out.dispersion = Math.max(out.dispersion, 0.06);
    out.present = 1;
    return;
  }
}

/** Regurgitant jets (MR in systole into the LA, AR in diastole into the LV) with proximal flow convergence (PISA). */
export function sampleRegurgitantJets(p: FlowFieldParams, tables: BeatTables, hp: HeartPose, phase: number, x: number, y: number, z: number, out: FlowSample): void {
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
        const Rj = r0 + along * 0.3;
        if (rho < Rj) {
          const prof = 1 - Math.pow(rho / Rj, 4);
          const decay = along < 1.2 ? 1 : 1 / (1 + (along - 1.2) / 1.8);
          const v = vj * prof * decay;
          out.vx += dirX * v;
          out.vz += dirZ * v;
          out.dispersion = Math.max(out.dispersion, 0.3 + 0.2 * (rho / Rj));
          out.present = 1;
        }
      } else if (along < 0 && along > -1.8) {
        // PISA: hemispheric convergence on the LV side, v = Q / (2π r²)
        const d = Math.hypot(dx, dy, dz);
        if (d < 1.8 && d > 0.05) {
          const v = Math.min(vj * 0.6, q / (2 * Math.PI * d * d) / 100);
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
      const cz = p.avCenter.z + zAnn * 0.5;
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
        const Rj = r0 + along * 0.35;
        if (rho < Rj) {
          const prof = 1 - Math.pow(rho / Rj, 4);
          const decay = along < 1.5 ? 1 : 1 / (1 + (along - 1.5) / 2.0);
          const v = vj * prof * decay;
          out.vx -= ax.x * v;
          out.vy -= ax.y * v;
          out.vz -= ax.z * v;
          out.dispersion = Math.max(out.dispersion, 0.3 + 0.2 * (rho / Rj));
          out.present = 1;
        }
      } else if (along < 0 && along > -1.5 && rho < 1.5) {
        const d = Math.hypot(dx, dy, dz);
        if (d > 0.05) {
          const v = Math.min(vj * 0.6, q / (2 * Math.PI * d * d) / 100);
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

/**
 * Tissue (myocardial) velocity for TDI (m/s, heart frame): longitudinal annular motion scaled by
 * level (base moves, apex fixed) — derived from the same longitudinal displacement table.
 */
export function sampleTissueVelocity(heart: HeartModel, tables: BeatTables, phase: number, z: number): { vx: number; vy: number; vz: number } {
  const longVel = sampleTable(tables.longitudinalVelocity, phase); // fraction of MAPSE per s
  const mapse = heart.physiology.mapseCm;
  const level = Math.min(1, Math.max(0, z / heart.lv.lengthCm));
  const vz = (mapse * longVel * (1 - level)) / 100; // cm/s → m/s, +z = toward the apex (systole)
  return { vx: 0, vy: 0, vz };
}
