import type { HeartModel, HeartPose } from '@/simulator/anatomy/heartModel';
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
}

export function buildFlowParams(c: CaseDefinition, heart: HeartModel, tables: BeatTables): FlowFieldParams {
  const A = (heart as HeartModel & { _anchors?: { avAxis: { x: number; y: number; z: number }; avCenter: { x: number; y: number; z: number }; mvCenter: { x: number; y: number; z: number }; mvR: number; tvCenter: { x: number; y: number; z: number }; tvR: number; rvotA: { x: number; y: number; z: number }; rvotB: { x: number; y: number; z: number } } })._anchors;
  if (!A) throw new Error('heart anchors not initialised (render one frame or call heartLandmarks first)');
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
        // LVOT: converging from the LV cavity (wider) to the LVOT diameter
        const widen = 1 + Math.max(0, -t - 0.8) * 0.6;
        R = rLvot * widen;
        area = p.lvotAreaCm2 * widen * widen;
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
        const stenotic = p.avAreaCm2 < 2.0 && t > 0 ? Math.min(0.6, (2.0 - p.avAreaCm2) * 0.5) : 0;
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
        const Rj = 0.25 + Math.max(0, dzj) * 0.28; // jet spreading
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
          const conv = Math.min(vmax * 0.5, (vmax * 0.25 * 0.25) / (2 * d * d));
          out.vz -= conv;
          out.present = 1;
          out.dispersion = Math.max(out.dispersion, 0.1);
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
