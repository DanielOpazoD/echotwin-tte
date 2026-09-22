import { Structure, Tissue } from '../tissue';
import { sdCapsule, sdEllipsoid, smax } from '../sdf';
import { lvCavityRadius } from '../lvShape';
import { latticeNoise3 } from '@/core/noise';
import { inflowTaper } from '../mitralValve';
import { rvFloorZ, rvRadii } from '../rv';
import { skirtOffsetAt } from '../valveSkirt';
import { setSample, type ClassifyCtx } from './context';
import { PV_RADIUS, pulmonaryVeinSegment } from '../pulmonaryVeins';

/** Scratch for the pulmonary vein segment of the sample being classified (no allocation per sample). */
const PV_SEG = new Float64Array(6);

/** Radial scale of the atria: reservoir/conduit/booster with the LV contraction, shrunk by the atrial kick and its hold. */
export function atrialScale(booster: number, reservoir: number, contraction: number): number {
  return booster * (reservoir + (1 - reservoir) * contraction);
}

/** Interatrial septum thickness (cm) at normalised distance `fo` from the fossa ovalis centre: membrane, limbus, muscle. */
export function iasThickness(fo: number): number {
  return fo < 1 ? 0.12 : fo < 1.3 ? 0.7 : 0.55;
}

/** Right atrial radial scale under tamponade: late-diastolic collapse of `raCollapse` (0..1). */
export function raCollapseScale(raCollapse: number): number {
  return 1 - 0.35 * raCollapse;
}

/**
 * Atria (lengthen in systole as the annulus descends), interatrial septum, left atrial appendage, pulmonary veins,
 * venae cavae with the hepatic vein, and the coronary sinus. True when the point is one of them.
 */
export function classifyAtria(c: ClassifyCtx): boolean {
  const { m, hp, A, x, y, z, out } = c;
  const lv = m.lv;
  const sh = lv.shape;
  const zAnn = hp.zAnn;
  const V = hp.valves;
  const la = A.laCenter,
    lr = A.laR;
  const zTop = la.z - lr.z; // fixed superior boundary (roof, under the pulmonary bifurcation)
  const zBottom = zAnn + 0.25;
  const czL = (zTop + zBottom) / 2,
    rzL = (zBottom - zTop) / 2;
  // reservoir / conduit / booster: radial size follows LV contraction (maximal at end-systole); the atrial
  // kick and its hold until ejection shrink it further (laBooster)
  const bo = atrialScale(hp.laBooster, A.laReservoir, hp.state.contraction);
  const xIas = A.iasX;
  // interatrial septum: muscular septum ~0.55 cm with a thicker limbus around the thin fossa ovalis membrane
  const fo = Math.hypot((y - A.fossaY) / 0.6, (z - A.fossaZ) / 0.7);
  const tIas = iasThickness(fo);
  // LA: ellipsoid flattened against the septum (medial clip), against the oesophagus / descending aorta
  // (posterior clip) and under the pulmonary bifurcation (roof clip)
  const dEllLa = sdEllipsoid(x, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL);
  const dFreeLa = smax(smax(dEllLa, la.y - 0.72 * lr.y * bo - y, 0.6), zTop + 0.15 * rzL - z, 0.5);
  const d = smax(dFreeLa, xIas + tIas / 2 - x, 0.3);
  if (d < 0) {
    setSample(
      out,
      Tissue.Blood,
      d,
      (x - la.x) / lr.x,
      (y - la.y) / lr.y,
      (z - czL) / rzL,
      x,
      y,
      z,
      0,
      Structure.LaCavity,
    );
    return true;
  }
  if (dFreeLa < 0.25 && x > xIas + tIas / 2) {
    setSample(
      out,
      Tissue.Myocardium,
      -Math.min(dFreeLa, 0.25 - dFreeLa),
      (x - la.x) / lr.x,
      (y - la.y) / lr.y,
      (z - czL) / rzL,
      x,
      y,
      z,
      0,
      Structure.LaWall,
    );
    return true;
  }
  // RA: rounder, flattened against the septum and posteriorly
  const ra = A.raCenter,
    rr = A.raR;
  const zTopR = ra.z - rr.z;
  // The atrium ends AT the annulus: it used to run 0.25 cm past it, with its own 0.22 cm wall sealing the
  // orifice and hiding the excess, so the cavity measured 5.60 cm (the top of the 3.5-5.6 range) while the
  // ellipsoid was really 5.82 cm long. Opening the orifice exposed that, so the ellipsoid is shortened by
  // the same amount instead of letting a wall trim it.
  // the floor is the annulus, wherever TAPSE has taken it (decision 133) and with its saddle and tilt (decision 138)
  const tvOff = skirtOffsetAt(V.tv, x, y);
  const zBotR = A.tvCenter.z + hp.tvZ + tvOff + 0.03;
  const czR = (zTopR + zBotR) / 2,
    rzR = (zBotR - zTopR) / 2;
  const raC = raCollapseScale(hp.raCollapse);
  const dEllRa = sdEllipsoid(x, y, z, ra.x, ra.y, czR, rr.x * bo * raC, rr.y * bo * raC, rzR);
  let dFreeRa = smax(dEllRa, ra.y - 0.8 * rr.y * bo - y, 0.6);
  // The base the ventricle vacates as its annulus descends belongs to the atrium: the atrioventricular plane works as a
  // piston and the atria lengthen by what the ventricles shorten (Carlsson 2004: the total heart volume barely changes).
  // Here it is the end-diastolic crescent at this height, below the floor of the moment and above the end-diastolic one,
  // inside the free wall. Without it the basal RV between inflow and infundibulum was 2 cm of fat and wall at end
  // systole, and the short axis of the great vessels showed the ventricle contracting over that edge (decision 133).
  let dSleeve = 1e3;
  if (hp.tvZ > 0.05) {
    const rad = c.sleeveRad;
    rvRadii(m, A, hp.prof, hp.thickK, zAnn, hp.lengthNow, 0, 0, hp.septalShiftCm, 0, c.az, z, rad);
    const u = rad[1]!;
    if (u > 0 && u < 1) {
      const r = Math.hypot(x, y);
      dSleeve = Math.max(
        rad[0]! + 0.1 - r,
        r - (rad[2]! - m.anatomy.rv.freeWallThicknessCm),
        rvFloorZ(A.tvCenter.z, 0, 0, u, tvOff) - z,
        z - rvFloorZ(A.tvCenter.z, hp.tvZ, hp.pvZ, u, tvOff),
      );
    }
  }
  c.raSleeve = dSleeve;
  dFreeRa = Math.min(dFreeRa, dSleeve);
  const dR = smax(dFreeRa, x - (xIas - tIas / 2), 0.3);
  if (dR < 0) {
    setSample(
      out,
      Tissue.Blood,
      dR,
      (x - ra.x) / rr.x,
      (y - ra.y) / rr.y,
      (z - czR) / rzR,
      x,
      y,
      z,
      0,
      Structure.RaCavity,
    );
    return true;
  }
  if (dFreeRa < 0.22 && x < xIas - tIas / 2) {
    // No wall across the tricuspid orifice: there the atrium opens into the ventricle, and the annulus and
    // leaflets are emitted by the valve block above. Both atria end 0.25 cm past their annulus, but on the
    // left the LV cavity is classified first and claims the orifice, while on the right nothing did — so
    // the atrial wall filled the gap and drew a 2.6 mm echogenic line splitting RA from RV in every A4C.
    // Reported from the images by a cardiologist; measured as RaCavity -> RaWall 0.28 -> RvCavity along a
    // line straight through the annulus centre.
    if (Math.hypot(x - V.tv.cx, y - V.tv.cy) < V.tv.R) {
      // past the annulus the blood belongs to the ventricle, as it does on the left where the LV cavity
      // claims the mitral orifice: calling it atrium instead stretched ra-long past its reference range
      const past = z > A.tvCenter.z + hp.tvZ + tvOff;
      setSample(
        out,
        Tissue.Blood,
        dFreeRa - 0.22,
        (x - ra.x) / rr.x,
        (y - ra.y) / rr.y,
        (z - czR) / rzR,
        x,
        y,
        z,
        0,
        past ? Structure.RvCavity : Structure.RaCavity,
      );
      return true;
    }
    setSample(
      out,
      Tissue.Myocardium,
      -Math.min(dFreeRa, 0.22 - dFreeRa),
      (x - ra.x) / rr.x,
      (y - ra.y) / rr.y,
      (z - czR) / rzR,
      x,
      y,
      z,
      0,
      Structure.RaWall,
    );
    return true;
  }
  // interatrial septum: slab between the clipped atria wherever either atrium reaches the septal plane
  // (behind the aortic root in PSAX-AV as well as in A4C and subcostal views)
  if (Math.abs(x - xIas) <= tIas / 2 && z < zAnn + 0.4) {
    if (
      sdEllipsoid(xIas, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL) < 0.45 ||
      sdEllipsoid(xIas, y, z, ra.x, ra.y, czR, rr.x * bo * raC, rr.y * bo * raC, rzR) < 0.45
    ) {
      setSample(
        out,
        Tissue.Myocardium,
        -(tIas / 2 - Math.abs(x - xIas)),
        1,
        0,
        0,
        x,
        y,
        z,
        0,
        Structure.InteratrialSeptum,
      );
      return true;
    }
  }
  // left atrial appendage: lobulated pouch on the anterolateral LA, pointing anteriorly (A2C/PSAX-AV)
  {
    const ax0 = la.x + lr.x * 0.55,
      ay0 = la.y + lr.y * 0.55,
      az0 = czL + 0.4;
    const ax1 = la.x + lr.x * 0.95,
      ay1 = ay0 + 2.0,
      az1 = czL + 0.9;
    const lob =
      0.12 * (latticeNoise3(x * 2.3 + 1.7, y * 2.3 + 4.2, z * 2.3 + 8.8, m.wallNoise) - 0.5);
    const dApp = sdCapsule(x, y, z, ax0, ay0, az0, ax1, ay1, az1, 0.55 * bo + lob);
    if (dApp < 0) {
      setSample(out, Tissue.Blood, dApp, 0, 1, 0, x, y, z, 0, Structure.LaAppendage);
      return true;
    }
    if (dApp < 0.18) {
      setSample(
        out,
        Tissue.Myocardium,
        -Math.min(dApp, 0.18 - dApp),
        0,
        1,
        0,
        x,
        y,
        z,
        0,
        Structure.LaWall,
      );
      return true;
    }
  }
  // pulmonary veins: towards the hila from the lateral wall (left) and the posteromedial corner (right); the
  // geometry lives in pulmonaryVeins.ts, shared with the venous flow sampler (decision 143)
  for (let i = 0; i < 4; i++) {
    pulmonaryVeinSegment(i, la, lr, bo, czL, rzL, PV_SEG);
    const dPv = sdCapsule(
      x,
      y,
      z,
      PV_SEG[0]!,
      PV_SEG[1]!,
      PV_SEG[2]!,
      PV_SEG[3]!,
      PV_SEG[4]!,
      PV_SEG[5]!,
      PV_RADIUS,
    );
    if (dPv < 0) {
      setSample(out, Tissue.Blood, dPv, 0, -1, 0, x, y, z, 0, Structure.PulmonaryVein);
      return true;
    }
    if (dPv < 0.12) {
      setSample(
        out,
        Tissue.VesselWall,
        -Math.min(dPv, 0.12 - dPv),
        0,
        -1,
        0,
        x,
        y,
        z,
        0,
        Structure.PulmonaryVein,
      );
      return true;
    }
  }
  // venae cavae: the superior enters the RA roof from above (torso superior), the inferior its floor from
  // below and behind through the liver, joined by a hepatic vein (subcostal views); the IVC narrows with the sniff
  {
    const dSvc = sdCapsule(
      x,
      y,
      z,
      A.svcA.x,
      A.svcA.y,
      A.svcA.z,
      A.svcB.x,
      A.svcB.y,
      A.svcB.z,
      A.svcR,
    );
    if (dSvc < 0) {
      setSample(out, Tissue.Blood, dSvc, 0, 0, -1, x, y, z, 0, Structure.Svc);
      return true;
    }
    if (dSvc < 0.12) {
      setSample(
        out,
        Tissue.VesselWall,
        -Math.min(dSvc, 0.12 - dSvc),
        0,
        0,
        -1,
        x,
        y,
        z,
        0,
        Structure.Svc,
      );
      return true;
    }
    const rI = A.ivcR * (1 - hp.ivcCollapse);
    const dIvc = sdCapsule(x, y, z, A.ivcA.x, A.ivcA.y, A.ivcA.z, A.ivcB.x, A.ivcB.y, A.ivcB.z, rI);
    if (dIvc < 0) {
      setSample(out, Tissue.Blood, dIvc, 0, 0, 1, x, y, z, 0, Structure.Ivc);
      return true;
    }
    if (dIvc < 0.12) {
      setSample(
        out,
        Tissue.VesselWall,
        -Math.min(dIvc, 0.12 - dIvc),
        0,
        0,
        1,
        x,
        y,
        z,
        0,
        Structure.Ivc,
      );
      return true;
    }
    const dHv = sdCapsule(x, y, z, A.hvA.x, A.hvA.y, A.hvA.z, A.hvB.x, A.hvB.y, A.hvB.z, 0.4);
    if (dHv < 0) {
      setSample(out, Tissue.Blood, dHv, 0, 0, 1, x, y, z, 0, Structure.HepaticVein);
      return true;
    }
    if (dHv < 0.08) {
      setSample(
        out,
        Tissue.VesselWall,
        -Math.min(dHv, 0.08 - dHv),
        0,
        0,
        1,
        x,
        y,
        z,
        0,
        Structure.HepaticVein,
      );
      return true;
    }
  }
  // coronary sinus: runs in the posterior atrioventricular groove toward the RA (A4C posterior, A2C inferior)
  {
    // outside the inferior wall, which at the annulus follows the posterior mitral annulus
    const mvI = V.mitral;
    const rInflow =
      -mvI.cy + Math.sqrt(Math.max(0, mvI.R * mvI.R - mvI.cx * mvI.cx)) - inflowTaper(0.6, mvI);
    const gy = -(
      Math.max(lvCavityRadius(sh, hp.prof, -Math.PI / 2, zAnn + 0.6), rInflow) +
      lv.lvpwd * hp.thickK +
      0.4
    );
    const dCs = sdCapsule(
      x,
      y,
      z,
      2.2,
      gy * 0.85,
      zAnn + 0.35,
      ra.x + rr.x * 0.4,
      gy * 0.7,
      zAnn + 0.1,
      0.33,
    );
    if (dCs < 0) {
      setSample(out, Tissue.Blood, dCs, 0, -1, 0, x, y, z, 0, Structure.CoronarySinus);
      return true;
    }
    if (dCs < 0.1) {
      setSample(
        out,
        Tissue.VesselWall,
        -Math.min(dCs, 0.1 - dCs),
        0,
        -1,
        0,
        x,
        y,
        z,
        0,
        Structure.CoronarySinus,
      );
      return true;
    }
  }
  return false;
}
