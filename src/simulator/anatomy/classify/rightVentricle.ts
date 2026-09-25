import { Structure, Tissue } from '../tissue';
import { sdCapsule, sdRoundCone, smin } from '../sdf';
import { skirtOffsetAt, tvInflowSdf } from '../valveSkirt';
import { rvCrescent } from '../rv';
import { setSample, type ClassifyCtx } from './context';

/** RV free-wall thickness now: thickens with the contraction. */
export function rvFreeWallNow(freeWallCm: number, contraction: number): number {
  return freeWallCm * (1 + 0.35 * contraction);
}

/**
 * Blend (cm) of the smooth union between the RV body and the outflow cones (decision 214): the inflow sinus narrows into
 * the infundibulum without a boundary (Ho and Nihoyannopoulos, Heart 2006). A plain union left a crease between the two
 * lumens, and in systole, when the body pulled in, a band of wall a centimetre thick between them in the long axis.
 */
export const RV_OUTFLOW_BLEND_CM = 0.6;

/** Radial scale of the outflow tract and pulmonary root with the contraction. */
export function rvOutflowScale(contraction: number): number {
  return 0.85 + 0.15 * (1 - contraction);
}

/**
 * RV: crescent around the septum, infundibulum, outflow, pulmonary trunk and branches. Leaves c.rvSdf[0] as the
 * distance to the RV cavity united with the tricuspid inflow, which the pericardium reads. True when the point is
 * one of these.
 */
export function classifyRightVentricle(c: ClassifyCtx): boolean {
  const { m, hp, A, x, y, z, out, az } = c;
  const V = hp.valves;
  const s = hp.state.contraction;
  const rvTmp = c.rvSdf;
  rvCrescent(m, hp, A, x, y, z, az, rvTmp);
  const dRv = rvTmp[0]!;
  const dRvU = smin(dRv, tvInflowSdf(x, y, z, V.tv, hp.tvZ), 0.3);
  const fw = rvFreeWallNow(m.anatomy.rv.freeWallThicknessCm, s);
  const k = rvOutflowScale(s);
  // outflow: infundibulum → subpulmonary region as two tapering segments bowed anteriorly over the aortic root
  // the outflow tract and the pulmonary root move with the base (pvZ, decision 111): evaluated at the point shifted back
  const pvZ = hp.pvZ;
  const zo = z - pvZ;
  const dRvot = Math.min(
    sdRoundCone(
      x,
      y,
      zo,
      A.rvotA.x,
      A.rvotA.y,
      A.rvotA.z,
      A.rvotM.x,
      A.rvotM.y,
      A.rvotM.z,
      A.rvotRa * k,
      A.rvotRm * k,
    ),
    sdRoundCone(
      x,
      y,
      zo,
      A.rvotM.x,
      A.rvotM.y,
      A.rvotM.z,
      A.rvotB.x,
      A.rvotB.y,
      A.rvotB.z,
      A.rvotRm * k,
      A.rvotR * k,
    ),
  );
  // pulmonary trunk from the valve to the bifurcation; right branch behind the ascending aorta, left branch
  const dPa = Math.min(
    sdRoundCone(
      x,
      y,
      zo,
      A.rvotB.x,
      A.rvotB.y,
      A.rvotB.z,
      A.paStj.x,
      A.paStj.y,
      A.paStj.z,
      A.paRootR,
      A.paR,
    ),
    // the trunk runs from the moving junction to the bifurcation, which stays
    sdCapsule(
      x,
      y,
      z,
      A.paStj.x,
      A.paStj.y,
      A.paStj.z + pvZ,
      A.paEnd.x,
      A.paEnd.y,
      A.paEnd.z,
      A.paR,
    ),
  );
  const dRpa = sdCapsule(
    x,
    y,
    z,
    A.paEnd.x,
    A.paEnd.y,
    A.paEnd.z,
    A.rpaEnd.x,
    A.rpaEnd.y,
    A.rpaEnd.z,
    A.rpaR,
  );
  const dLpa = sdCapsule(
    x,
    y,
    z,
    A.paEnd.x,
    A.paEnd.y,
    A.paEnd.z,
    A.lpaEnd.x,
    A.lpaEnd.y,
    A.lpaEnd.z,
    A.lpaR,
  );
  const dTrunk = Math.min(dPa, dRpa, dLpa);
  const vx = x - A.rvotB.x,
    vy = y - A.rvotB.y,
    vz = zo - A.rvotB.z;
  if (dTrunk < 0) {
    setSample(out, Tissue.Blood, dTrunk, vx, vy, vz, x, y, z, 0, Structure.PulmonaryArtery);
    return true;
  }
  if (dTrunk < 0.18 && dRvot > 0 && dRvU > 0) {
    setSample(
      out,
      Tissue.VesselWall,
      -Math.min(dTrunk, 0.18 - dTrunk),
      vx,
      vy,
      vz,
      x,
      y,
      z,
      0,
      Structure.PulmonaryArtery,
    );
    return true;
  }
  // tricuspid inflow: the RV cavity and its wall reach the whole annulus. The crescent is closed at the tricuspid
  // plane, so its wall ran as a floor 0.5-1.5 cm thick across the orifice, and in systole its free wall pulled in
  // while the annulus stayed put: the lateral hinge sat outside the heart in 6-10 of 10 frames of eleven cases.
  rvTmp[0] = dRvU;
  const dCavRv = smin(dRvU, dRvot, RV_OUTFLOW_BLEND_CM);
  if (dCavRv < 0) {
    if (dRv < 0) {
      // moderator band: from the lower septum to the anterior free wall at the base of the anterior papillary muscle
      const L = m.lv.lengthCm;
      const rIn = rvTmp[1]!;
      const rOut = rvTmp[2]!;
      const bx0 = -(rIn + 0.12),
        by0 = -0.2,
        bz0 = L * 0.6;
      const rB = rOut - fw * 1.2;
      const bx1 = rB * Math.cos(A.rvPapAz),
        by1 = rB * Math.sin(A.rvPapAz),
        bz1 = L * 0.68;
      const dBand = sdCapsule(x, y, z, bx0, by0, bz0, bx1, by1, bz1, 0.28);
      if (dBand < 0) {
        setSample(out, Tissue.Myocardium, dBand, 0, 0, 1, x, y, z, 0, Structure.ModeratorBand);
        return true;
      }
      const P = hp.rvPap;
      const dRp = sdRoundCone(x, y, z, P[0]!, P[1]!, P[2]!, P[3]!, P[4]!, P[5]!, P[6]!, P[7]!);
      if (dRp < 0) {
        setSample(out, Tissue.Myocardium, dRp, x, y, 0, x, y, z, 0, Structure.RvPapillary);
        return true;
      }
    }
    const rr = Math.hypot(x, y) || 1;
    setSample(
      out,
      Tissue.Blood,
      dCavRv,
      x / rr,
      y / rr,
      0,
      x / (1 - 0.3 * s),
      y / (1 - 0.3 * s),
      z,
      0,
      dRvot < dRvU
        ? Structure.Rvot
        : // the inflow column above the annulus is atrium (the annulus level itself since decisions 133 and 138)
          dRv >= 0 && z <= A.tvCenter.z + hp.tvZ + skirtOffsetAt(V.tv, x, y)
          ? Structure.RaCavity
          : Structure.RvCavity,
    );
    return true;
  }
  if (dCavRv < fw) {
    const rr = Math.hypot(x, y) || 1;
    setSample(
      out,
      Tissue.Myocardium,
      -Math.min(dCavRv, fw - dCavRv),
      x / rr,
      y / rr,
      0,
      x / (1 - 0.3 * s),
      y / (1 - 0.3 * s),
      z,
      0,
      Structure.RvWall,
    );
    return true;
  }
  return false;
}
