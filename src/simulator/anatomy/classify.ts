import { Structure, Tissue, type TissueSample } from './tissue';
import {
  sdCapsule,
  sdEllipsoid,
  sdRoundCone,
  sdSegmentChain,
  sdTorusZ,
  smax,
  smin,
  type ChainHit,
} from './sdf';
import { lvCavityRadius, lvCavitySdf, lvProfileG, lvSdfNormal } from './lvShape';
import { fastAtan2, latticeNoise3 } from '@/core/noise';
import {
  aorticContactBand,
  aorticCuspDistance,
  aorticHit,
  rootRadiusAt,
  AV_COAPT_HALF,
} from './aorticValve';
import {
  inflowTaper,
  insideMitralOutline,
  mitralAnnulusDistance,
  mitralDistance,
  mitralHingeZ,
  mitralHit,
  mitralInflowSdf,
} from './mitralValve';
import { ROOT_EXCURSION } from './heartFrame';
import { TWO_PI, saddleOffset, skirtDistance, skirtHit, tvInflowSdf } from './valveSkirt';
import { septalShiftAt, wallThicknessAt } from './lvWall';
import { ahaSegment } from './lvGeometry';
import { rvCrescent, rvTmp } from './rv';
import { anchorsCached } from './anchors';
import type { HeartModel } from './heartModel';
import type { HeartPose } from './heartPose';

const chainHit: ChainHit = { d: 0, frac: 0 };

function setSample(
  out: TissueSample,
  tissue: Tissue,
  sdf: number,
  nx: number,
  ny: number,
  nz: number,
  mx: number,
  my: number,
  mz: number,
  extra: number,
  structure: Structure,
): void {
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  out.tissue = tissue;
  out.sdf = sdf;
  out.nx = nx / l;
  out.ny = ny / l;
  out.nz = nz / l;
  out.mx = mx;
  out.my = my;
  out.mz = mz;
  out.extraReflect = extra;
  out.structure = structure;
}

/**
 * Classify a heart-frame point. Writes into `out` and returns true when the point belongs to a
 * cardiac structure (including pericardium/effusion); false when outside the heart.
 */
export function classifyHeart(
  m: HeartModel,
  hp: HeartPose,
  x0: number,
  y: number,
  z: number,
  out: TissueSample,
): boolean {
  // swinging heart (tamponade): rigid translation of the whole heart inside the pericardial sac
  const x = x0 - hp.swingX;
  const bc = m.boundCenter;
  const bdx = x - bc.x,
    bdy = y - bc.y,
    bdz = z - bc.z;
  if (bdx * bdx + bdy * bdy + bdz * bdz > m.boundRadius * m.boundRadius) return false;

  const A = anchorsCached(m);
  const lv = m.lv;
  const zAnn = hp.zAnn;

  // ---------- Aortic root coordinates (tube along avAxis; also carves the LV base) ----------
  let rootT = -99,
    rootRr = 0,
    rootR = 0,
    rootQx = 0,
    rootQy = 0,
    rootQz = 0,
    rootPhi = 0;
  {
    const c = A.avCenter;
    const ax = A.avAxis;
    const czz = c.z + zAnn * ROOT_EXCURSION;
    const dx = x - c.x,
      dy = y - c.y,
      dz = z - czz;
    const t = dx * ax.x + dy * ax.y + dz * ax.z; // along axis, 0 at annulus, negative toward LV
    if (t > -1.6 && t < 6.5) {
      // the ascending aorta curves toward the patient's right/anterior beyond the sinotubular junction
      // (it leaves the long-axis plane after ~3 cm instead of running straight for 7 cm)
      const bend = t > 3 ? 0.16 * (t - 3) * (t - 3) : 0;
      rootQx = dx - ax.x * t - A.avBend.x * bend;
      rootQy = dy - ax.y * t - A.avBend.y * bend;
      rootQz = dz - ax.z * t - A.avBend.z * bend;
      rootRr = Math.sqrt(rootQx * rootQx + rootQy * rootQy + rootQz * rootQz);
      rootT = t;
      // sinuses of Valsalva bulge at the cusp centres (trefoil in short axis, ±6 %), narrowing at the commissures;
      // the bulge fades to nothing at the annulus and at the sinotubular junction
      rootPhi = fastAtan2(
        rootQx * A.avE2.x + rootQy * A.avE2.y + rootQz * A.avE2.z,
        rootQx * A.avE1.x + rootQy * A.avE1.y + rootQz * A.avE1.z,
      );
      rootR = rootRadiusAt(hp.valves.root, t, rootPhi);
    }
  }
  // the aortic lumen from the annulus upward is never LV wall or fibrous skeleton
  const inRootLumen = rootT >= -0.05 && rootRr < rootR;
  // nor is the outflow tract below it: the basal septal shell reached 0.35 cm into the tract at end diastole and, once
  // the root descended with the base (ROOT_EXCURSION), 0.75 cm at end systole
  const inOutflowLumen = rootT > -1.6 && rootRr < rootR;

  // ---------- Valves, annuli and chordae (thin, highest priority) ----------
  const V = hp.valves;
  const hit = chainHit;
  // mitral leaflets: anterior leaflet on the aortomitral curtain, posterior around the rest of the D-shaped annulus
  {
    const t = mitralDistance(x, y, z, V.mitral);
    if (mitralHit.d < t) {
      setSample(
        out,
        Tissue.Valve,
        mitralHit.d - t,
        mitralHit.nx,
        mitralHit.ny,
        mitralHit.nz,
        x,
        y,
        z,
        m.anatomy.mitral.calcification,
        mitralHit.leaflet === 0 ? Structure.MitralAnterior : Structure.MitralPosterior,
      );
      return true;
    }
  }
  // aortic cusps: pockets hung from the crown-shaped attachment on the sinus wall
  if (rootT > -0.5 && rootRr < rootR + 0.02) {
    const half = aorticCuspDistance(V.aortic, V.root, rootT, rootRr, rootPhi);
    if (aorticHit.d < half) {
      const ur = 1 / (rootRr || 1);
      const ax = A.avAxis;
      setSample(
        out,
        Tissue.Valve,
        aorticHit.d - half,
        aorticHit.nr * rootQx * ur + aorticHit.nt * ax.x,
        aorticHit.nr * rootQy * ur + aorticHit.nt * ax.y,
        aorticHit.nr * rootQz * ur + aorticHit.nt * ax.z,
        x,
        y,
        z,
        m.anatomy.aorticValve.calcification,
        Structure.AorticValve,
      );
      return true;
    }
  }
  // aortic coaptation surfaces: when the valve is closed adjacent cusps press together along the lines from the
  // centre to each commissure (Y sign in PSAX-AV), in a band below the free margin that is 4.5 mm tall at the centre
  // and rises with the margin toward the commissures. Until 2026-09-13 these fins sat 28.6° away from the commissures
  // of the cusps — 3.7° from the parasternal long-axis plane — reached 0.65 cm down into the ventricular side of the
  // valve and were 0.8 mm thick: a long bright line through the middle of the closed valve in PLAX.
  if (V.aortic.open < 1 && rootT > 0 && rootT < V.aortic.hComm && rootRr < rootR * 0.97) {
    const band = aorticContactBand(V.aortic, V.root, rootT, rootRr, rootPhi);
    const axialDistance = band ? Math.max(band[0] - rootT, rootT - band[1], 0) : Infinity;
    if (axialDistance < AV_COAPT_HALF) {
      const n = V.cuspCount;
      let dphi = (((rootPhi - 0.5 - Math.PI / n) % (TWO_PI / n)) + TWO_PI / n) % (TWO_PI / n);
      if (dphi > Math.PI / n) dphi = TWO_PI / n - dphi;
      const dist = Math.hypot(rootRr * Math.sin(dphi), axialDistance);
      if (dist < AV_COAPT_HALF) {
        // the surface normal is tangential (the band contains the axis and the radial direction)
        const ux = rootQx / (rootRr || 1),
          uy = rootQy / (rootRr || 1),
          uz = rootQz / (rootRr || 1);
        const ax = A.avAxis;
        setSample(
          out,
          Tissue.Valve,
          dist - AV_COAPT_HALF,
          ax.y * uz - ax.z * uy,
          ax.z * ux - ax.x * uz,
          ax.x * uy - ax.y * ux,
          x,
          y,
          z,
          m.anatomy.aorticValve.calcification,
          Structure.AorticValve,
        );
        return true;
      }
    }
  }
  // pulmonary cusps (three, hinged at the outflow–trunk junction; clipped to the trunk lumen). They must not enter
  // the aortic root or its wall: at the level of the sinuses they used to replace 0.3 cm of the anterior aortic wall
  // (decision 75)
  const outsideAorticRoot = rootT <= -1.6 || rootRr > rootR + 0.22;
  if (
    outsideAorticRoot &&
    sdCapsule(
      x,
      y,
      z,
      A.rvotM.x,
      A.rvotM.y,
      A.rvotM.z + hp.pvZ,
      A.paEnd.x,
      A.paEnd.y,
      A.paEnd.z,
      A.paR + 0.02,
    ) < 0
  ) {
    for (let i = 0; i < 3; i++) {
      const wx = V.pvWidths[i * 3]!,
        wy = V.pvWidths[i * 3 + 1]!,
        wz = V.pvWidths[i * 3 + 2]!;
      sdSegmentChain(x, y, z, V.pvSegs, i * 12, 2, V.pvSegLen, wx, wy, wz, V.pvHalf, hit, 0.75);
      const t = V.pvThickness * (1 - 0.3 * hit.frac) * 0.5 + 0.03;
      if (hit.d < t) {
        const o = i * 12 + Math.min(1, Math.floor(hit.frac * 2)) * 6;
        const dx = V.pvSegs[o + 3]!,
          dy = V.pvSegs[o + 4]!,
          dz = V.pvSegs[o + 5]!;
        setSample(
          out,
          Tissue.Valve,
          hit.d - t,
          dy * wz - dz * wy,
          dz * wx - dx * wz,
          dx * wy - dy * wx,
          x,
          y,
          z,
          0,
          Structure.PulmonaryValve,
        );
        return true;
      }
    }
  }
  // tricuspid leaflets (anterior, septal, posterior)
  {
    const t = skirtDistance(x, y, z, V.tv);
    if (skirtHit.d < t) {
      setSample(
        out,
        Tissue.Valve,
        skirtHit.d - t,
        skirtHit.nx,
        skirtHit.ny,
        skirtHit.nz,
        x,
        y,
        z,
        0,
        V.tv.zones[skirtHit.zone]!.structure,
      );
      return true;
    }
  }
  // fibrous annuli (bright hinge points in long-axis views)
  {
    const dR = mitralAnnulusDistance(x, y, z, V.mitral, 0.11);
    if (dR < 0) {
      setSample(
        out,
        Tissue.Fibrous,
        dR,
        x - V.mitral.cx,
        y - V.mitral.cy,
        0,
        x,
        y,
        z,
        0.15 * m.anatomy.mitral.calcification,
        Structure.MitralAnnulus,
      );
      return true;
    }
    const q = V.tvRing;
    const dT = sdTorusZ(
      x,
      y,
      z - saddleOffset(fastAtan2(y - q[1], x - q[0]), V.tv.zones[0]!.phi, V.tv.saddle),
      q[0],
      q[1],
      q[2],
      q[3],
      0.09,
    );
    if (dT < 0) {
      setSample(
        out,
        Tissue.Fibrous,
        dT,
        x - q[0],
        y - q[1],
        0,
        x,
        y,
        z,
        0,
        Structure.TricuspidAnnulus,
      );
      return true;
    }
  }
  // chordae tendineae (thin, only visible when in plane)
  for (let i = 0; i < V.chordaeCount; i++) {
    const o = i * 6;
    const c = V.chordae;
    const d = sdCapsule(
      x,
      y,
      z,
      c[o]!,
      c[o + 1]!,
      c[o + 2]!,
      c[o + 3]!,
      c[o + 4]!,
      c[o + 5]!,
      0.045,
    );
    if (d < 0) {
      setSample(out, Tissue.Chordae, d, 0, 0, 1, x, y, z, 0, Structure.Chordae);
      return true;
    }
  }

  // ---------- LV cavity & wall ----------
  // local wall thickness by azimuth (septal thicker if IVS > PW) & level, regional motion by segment
  const az = fastAtan2(y, x);
  const levelFrac = Math.min(1, Math.max(0, (z - zAnn) / Math.max(hp.lengthNow, 1)));
  // septal flattening (D-shape): the septum is pushed toward the LV centre by the RV; the LV ellipsoids are
  // evaluated at x − shift so that both endocardium and epicardium move (the RV crescent uses the same shift)
  const septalShift = septalShiftAt(hp.septalShiftCm, az, levelFrac);
  const xs = x - septalShift;
  const sh = lv.shape;
  const dProf = lvCavitySdf(hp.prof, sh.ratio, xs, y, z);
  const nx0 = lvSdfNormal[0]!,
    ny0 = lvSdfNormal[1]!,
    nz0 = lvSdfNormal[2]!;
  // clip at annulus plane (z ≥ zAnn) with a smooth max
  const dCav = smax(dProf, zAnn - z, 0.6);
  const seg = ahaSegment(az, levelFrac);
  const amp = m.segAmp[seg] ?? 1;
  // Regional wall motion: an akinetic segment keeps its end-diastolic radius → local cavity SDF shifted outward
  const regional = amp < 1 ? (1 - amp) * (lv.rMax - hp.rMax) * lvProfileG(sh, levelFrac) : 0;
  const rsc = hp.radialScale;
  const lsc = hp.longScale;
  // trabeculation: rough endocardium with longitudinal ridges (material coordinates, so it moves with the
  // wall), growing from the mid cavity to the apex
  const trab =
    levelFrac > 0.45
      ? 0.2 *
        Math.min(1, (levelFrac - 0.45) / 0.35) *
        (latticeNoise3(
          (x / rsc) * 2.6 + 11.3,
          (y / rsc) * 2.6 + 2.9,
          ((z - lv.lengthCm) / lsc) * 1.1 + 6.1,
          m.wallNoise,
        ) -
          0.5)
      : 0;
  const dCavR = dCav - regional + trab;
  // wall thickness: interpolate septal (az≈π, i.e. x<0) vs free wall
  const septalness = 0.5 - 0.5 * Math.cos(az); // 1 at septum (az=π), 0 at lateral
  const tNow = wallThicknessAt(m, hp.thickK, az, levelFrac, amp);

  // Mitral inflow: the ventricle opens onto the whole annulus. The bullet profile is centred on the long axis and the
  // annulus 0.9 cm behind it, so the posterior and commissural hinges used to lie 0.2-0.8 cm (diastole) and up to
  // 1.2 cm (systole) inside the wall: the posterior leaflet grew out of myocardium and its insertion was lost. The
  // cavity and the wall around it are the smooth union of the profile with the annular outline, which narrows apically
  // into the profile (inflowTaper); basal to the hinges the column is atrium. The outflow tract and root keep their own
  // geometry.
  const inRootTube = rootT > -1.6 && rootRr < rootR + 0.2;
  const zHinge = mitralHingeZ(x, y, V.mitral);
  const dInflow = inRootTube ? 1e3 : mitralInflowSdf(x, y, z, V.mitral);
  const dLvBlood = smin(dCavR, dInflow, 0.3);
  // Papillary muscles inside the cavity (round cones rooted in the wall, see computeHeartPose)
  if (dLvBlood < 0) {
    const P = hp.paps;
    const dPa = sdRoundCone(x, y, z, P[0]!, P[1]!, P[2]!, P[3]!, P[4]!, P[5]!, P[6]!, P[7]!);
    const dPm = sdRoundCone(x, y, z, P[8]!, P[9]!, P[10]!, P[11]!, P[12]!, P[13]!, P[14]!, P[15]!);
    const dPap = Math.min(dPa, dPm);
    if (dPap < 0) {
      setSample(
        out,
        Tissue.Myocardium,
        dPap,
        x,
        y,
        0,
        x / rsc,
        y / rsc,
        z / lsc,
        0,
        Structure.PapillaryMuscle,
      );
      return true;
    }
    // LV blood (the inflow column basal to the hinge plane belongs to the atrium)
    setSample(
      out,
      Tissue.Blood,
      dLvBlood,
      nx0,
      ny0,
      nz0,
      x / rsc,
      y / rsc,
      (z - lv.lengthCm) / lsc,
      0,
      dCavR >= 0 && z < zHinge ? Structure.LaCavity : Structure.LvCavity,
    );
    return true;
  }
  const wallT = tNow;
  // Ventricular wall: shell of local thickness around the *unclipped* profile, apical to (slightly above)
  // the annulus. The annular plane itself is not a wall: it holds the mitral orifice, the LVOT and fibrous tissue.
  const dEllR = smin(dProf, dInflow, 0.3) - regional;
  // the trabeculated inner surface belongs to the wall: from the rough endocardium to the smooth epicardium
  if (dEllR + trab >= 0 && dEllR < wallT && z >= zAnn - 0.25 && !inOutflowLumen) {
    let structure = Structure.LvWallLateral;
    if (z > lv.lengthCm - 0.6) structure = Structure.LvApex;
    else if (septalness > 0.7) structure = Structure.LvWallSeptal;
    else if (Math.sin(az) > 0.5) structure = Structure.LvWallAnterior;
    else if (Math.sin(az) < -0.5) structure = Structure.LvWallInferior;
    const dIn = -Math.min(dEllR, wallT - dEllR);
    const nearEpi = wallT - dEllR < dEllR;
    const sign = nearEpi ? 1 : -1;
    setSample(
      out,
      Tissue.Myocardium,
      dIn,
      sign * nx0,
      sign * ny0,
      sign * nz0,
      x / rsc,
      y / rsc,
      (z - lv.lengthCm) / lsc,
      0,
      structure,
    );
    return true;
  }
  // Annular plane region (inside the ellipsoid but basal to the annulus): mitral orifice is blood
  // continuous with the LA; the LVOT is handled by the aortic tube below; the rest is fibrous tissue.
  const inAnnularRegion = dEllR < 0 && z < zAnn && !inRootLumen;
  if (inAnnularRegion) {
    // the mitral orifice column basal to the annular plane is atrial blood (the LV ends at the annulus); it follows the
    // D-shaped annulus, so in front of the straight segment the aortomitral curtain and the outflow tract remain
    if (insideMitralOutline(x, y, V.mitral)) {
      setSample(out, Tissue.Blood, -0.3, 0, 0, 1, x, y, z, 0, Structure.LaCavity);
      return true;
    }
  }

  // ---------- Aortic root / LVOT (tube along avAxis) ----------
  if (rootT > -1.6) {
    const t = rootT,
      rr = rootRr,
      R = rootR;
    const wall = 0.2;
    if (rr < R) {
      setSample(
        out,
        Tissue.Blood,
        rr - R,
        rootQx / rr,
        rootQy / rr,
        rootQz / rr,
        x,
        y,
        z - zAnn * ROOT_EXCURSION,
        0,
        t < 0 ? Structure.Lvot : Structure.AorticRoot,
      );
      return true;
    }
    if (rr < R + wall) {
      const dIn = -Math.min(rr - R, R + wall - rr);
      setSample(
        out,
        Tissue.VesselWall,
        dIn,
        rootQx / rr,
        rootQy / rr,
        rootQz / rr,
        x,
        y,
        z,
        0,
        Structure.AorticRoot,
      );
      return true;
    }
  }

  if (inAnnularRegion && z > zAnn - 1.2) {
    // aorto-mitral curtain / fibrous skeleton
    setSample(out, Tissue.Fibrous, -0.15, 0, 0, 1, x, y, z, 0, Structure.LvWallSeptal);
    return true;
  }

  // ---------- Atria (lengthen in systole as the annulus descends) ----------
  {
    const la = A.laCenter,
      lr = A.laR;
    const zTop = la.z - lr.z; // fixed superior boundary (roof, under the pulmonary bifurcation)
    const zBottom = zAnn + 0.25;
    const czL = (zTop + zBottom) / 2,
      rzL = (zBottom - zTop) / 2;
    // reservoir / conduit / booster: radial size follows LV contraction (maximal at end-systole); the atrial
    // kick and its hold until ejection shrink it further (laBooster)
    const bo = hp.laBooster * (A.laReservoir + (1 - A.laReservoir) * hp.state.contraction);
    const xIas = A.iasX;
    // interatrial septum: muscular septum ~0.55 cm with a thicker limbus around the thin fossa ovalis membrane
    const fo = Math.hypot((y - A.fossaY) / 0.6, (z - A.fossaZ) / 0.7);
    const tIas = fo < 1 ? 0.12 : fo < 1.3 ? 0.7 : 0.55;
    // LA: ellipsoid flattened against the septum (medial clip), against the oesophagus / descending aorta
    // (posterior clip) and under the pulmonary bifurcation (roof clip)
    const dEllLa = sdEllipsoid(x, y, z, la.x, la.y, czL, lr.x * bo, lr.y * bo, rzL);
    const dFreeLa = smax(
      smax(dEllLa, la.y - 0.72 * lr.y * bo - y, 0.6),
      zTop + 0.15 * rzL - z,
      0.5,
    );
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
    const zBotR = A.tvCenter.z + hp.tvZ * 0.7 + 0.03; // the caval junction moves a little with TAPSE
    const czR = (zTopR + zBotR) / 2,
      rzR = (zBotR - zTopR) / 2;
    const raC = 1 - 0.35 * hp.raCollapse; // tamponade: late-diastolic RA collapse
    const dEllRa = sdEllipsoid(x, y, z, ra.x, ra.y, czR, rr.x * bo * raC, rr.y * bo * raC, rzR);
    const dFreeRa = smax(dEllRa, ra.y - 0.8 * rr.y * bo - y, 0.6);
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
        const past = z > A.tvCenter.z + hp.tvZ * 0.7;
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
    // pulmonary veins: four ostia on the flat posterior wall (two superior, two inferior), the right pair behind the septum
    for (let i = 0; i < 4; i++) {
      const sx = i % 2 === 0 ? -1 : 1;
      const px = la.x + sx * lr.x * 0.6;
      const pz = czL + (i < 2 ? -0.7 : 0.6);
      const py0 = la.y - lr.y * 0.7;
      const dPv = sdCapsule(
        x,
        y,
        z,
        px,
        py0,
        pz,
        px + sx * 1.2,
        py0 - 2.2,
        pz + (i < 2 ? -0.6 : 0.5),
        0.45,
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
      const dIvc = sdCapsule(
        x,
        y,
        z,
        A.ivcA.x,
        A.ivcA.y,
        A.ivcA.z,
        A.ivcB.x,
        A.ivcB.y,
        A.ivcB.z,
        rI,
      );
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
  }

  // ---------- RV: crescent around the septum, infundibulum, outflow, pulmonary trunk and branches ----------
  {
    const s = hp.state.contraction;
    rvCrescent(m, hp, A, x, y, z, az, rvTmp);
    const dRv = rvTmp[0]!;
    const dRvU = smin(dRv, tvInflowSdf(x, y, z, V.tv, hp.tvZ), 0.3);
    const fw = m.anatomy.rv.freeWallThicknessCm * (1 + 0.35 * s);
    const k = 0.85 + 0.15 * (1 - s);
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
    const dCavRv = Math.min(dRvU, dRvot);
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
          : dRv >= 0 && z <= A.tvCenter.z + hp.tvZ * 0.7
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
  }

  // ---------- Pericardium & effusion (outer envelope of all epicardial surfaces) ----------
  {
    const dLvEpi = dEllR - wallT; // the epicardium is the outer face of the wall shell
    const fw = m.anatomy.rv.freeWallThicknessCm;
    const dRvEpi = rvTmp[0]! - fw; // crescent and tricuspid inflow, computed just above (this point is outside the RV)
    const la = A.laCenter,
      lr = A.laR;
    const dLaEpi = sdEllipsoid(x, y, z, la.x, la.y, la.z, lr.x + 0.25, lr.y + 0.25, lr.z + 0.25);
    const ra = A.raCenter,
      rar = A.raR;
    const dRaEpi = sdEllipsoid(x, y, z, ra.x, ra.y, ra.z, rar.x + 0.22, rar.y + 0.22, rar.z + 0.22);
    // The sac around the outflow tract and the trunk stays where the pericardium is anchored (sternopericardial ligaments in
    // front, the arterial reflection on the trunk) while they descend in systole (decision 111). One envelope stands for the
    // epicardial fat, the pericardium and the effusion here; moved with the tract, the effusion of the tamponade case, which
    // reaches the transducer face in the parasternal views (chestWall.test.ts), changed its near field with every beat.
    const dRvotEpi = sdCapsule(
      x,
      y,
      z,
      A.rvotA.x,
      A.rvotA.y,
      A.rvotA.z,
      A.rvotB.x,
      A.rvotB.y,
      A.rvotB.z,
      A.rvotRa + fw,
    );
    const dPaEpi = Math.min(
      sdRoundCone(
        x,
        y,
        z,
        A.rvotB.x,
        A.rvotB.y,
        A.rvotB.z,
        A.paStj.x,
        A.paStj.y,
        A.paStj.z,
        A.paRootR + 0.2,
        A.paR + 0.2,
      ),
      sdCapsule(
        x,
        y,
        z,
        A.paStj.x,
        A.paStj.y,
        A.paStj.z,
        A.paEnd.x,
        A.paEnd.y,
        A.paEnd.z,
        A.paR + 0.2,
      ),
    );
    // the cardiac silhouette is the smooth union of the epicardial surfaces: the grooves between chambers and
    // the space between outflow and root are filled with epicardial fat, and one pericardium wraps the whole heart
    const dEpi = smin(
      smin(smin(dLvEpi, dRvEpi, 0.8), smin(dLaEpi, dRaEpi, 0.8), 0.8),
      smin(dRvotEpi, dPaEpi, 0.8),
      0.8,
    );
    const eff = hp.effusion;
    if (dEpi < 0) {
      setSample(out, Tissue.Fat, dEpi, nx0, ny0, nz0, x, y, z, 0, Structure.EpicardialFat);
      return true;
    }
    if (dEpi < 0.12) {
      setSample(
        out,
        Tissue.Pericardium,
        -Math.min(Math.max(dEpi, 0), 0.12 - Math.max(dEpi, 0)),
        nx0,
        ny0,
        nz0,
        x,
        y,
        z,
        0,
        Structure.Pericardium,
      );
      return true;
    }
    if (eff > 0 && dEpi < 0.12 + eff) {
      setSample(
        out,
        Tissue.Fluid,
        dEpi - 0.12 - eff,
        nx0,
        ny0,
        nz0,
        x,
        y,
        z,
        0,
        Structure.PericardialEffusion,
      );
      return true;
    }
    if (eff > 0 && dEpi < 0.12 + eff + 0.12) {
      setSample(out, Tissue.Pericardium, 0, nx0, ny0, nz0, x, y, z, 0, Structure.Pericardium);
      return true;
    }
  }
  return false;
}
