import type { CycleState } from '@/simulator/cardiac-cycle/cycleModel';
import { Structure } from './tissue';
import { smin } from './sdf';
import { allocLvProfileTable, axialWallFactor, buildLvProfile, lvCavityRadius, lvCavitySdf, solveThickening, type LvProfileTable } from './lvShape';
import { buildAorticValve, type AorticValve, type RootProfile } from './aorticValve';
import { buildMitralValve, fitOpenLeaflets, mitralFreeEdge, mitralInflowSdf, papillaryTether, type MitralValve } from './mitralValve';
import { ROOT_EXCURSION, PV_ROOT_EXCURSION } from './heartFrame';
import { TWO_PI, buildCuspChains, buildProfile, saddleOffset, skirtTip, tvInflowSdf, type SkirtDesc } from './valveSkirt';
import { septalShiftAt } from './lvWall';
import { rvRadii, rvRad } from './rv';
import { anchorsCached } from './anchors';
import type { HeartModel } from './heartModel';

/**
 * Systolic shortening of the tricuspid annular dimensions. In healthy adults the annulus is largest in late diastole
 * and smallest in mid-to-late systole, with fractional area change 35 ± 10 % and perimeter and diameters shortening by
 * 20 % or more (3D echocardiography, n = 209); the septal edge is anchored to the fibrous septum and the free-wall side
 * moves.
 */
export const TV_SYSTOLIC_SHORTENING = 0.2;
/** Closed tricuspid leaflets: depth of the central coaptation below the hinges (cm) and the profile's vertex fractions. */
const TV_TENTING_CM = 0.3;
const TV_CLOSED_REACH = [0.36, 0.71, 1];
const TV_CLOSED_DEPTH = [0.3, 0.62, 1];

/** Per-frame deformation parameters derived from the cycle state (computed once per frame). */
export interface HeartPose {
  state: CycleState;
  zAnn: number; // annulus displacement toward apex (cm)
  /** Maximal cavity radius now (lateral) and the polar table of the cavity surface (lvShape.ts). */
  rMax: number;
  prof: LvProfileTable;
  /** Systolic wall-thickening factor from wall-volume conservation (1 at end diastole). */
  thickK: number;
  lengthNow: number;
  radialScale: number; // rMax / rMax at ED
  longScale: number; // lengthNow / length at ED
  /** Papillary muscles as round cones [ax,ay,az,bx,by,bz,ra,rb] × 2 (anterolateral, posteromedial), current frame. */
  paps: Float64Array;
  /** RV anterior papillary muscle (round cone, 8 floats), current frame. */
  rvPap: Float64Array;
  mvAngleAnt: number; // anterior leaflet angle (rad) in y–z plane from +z toward −y
  mvAnglePost: number;
  avOpenAngle: number; // rad from perpendicular (closed) toward axis (open)
  tvAngleAnt: number;
  tvAnglePost: number;
  rvScale: number;
  tvZ: number; // tricuspid annulus displacement (TAPSE)
  pvZ: number; // outflow tract and pulmonary root displacement along the heart axis (decision 111)
  ivcCollapse: number; // inferior vena cava collapse this frame (fraction of its diameter; follows free breathing, decision 113)
  laBooster: number; // atrial contraction radial scale (1 = none)
  effusion: number;
  /** Tamponade signs this frame: RV free-wall inward collapse (0..1), RA collapse (0..1) and heart swing (cm, x). */
  rvCollapse: number;
  raCollapse: number;
  swingX: number;
  /** Interventricular septal flattening amplitude (cm) toward the LV. */
  septalShiftCm: number;
  /** Precomputed per-frame valve geometry (avoids trig per sample). */
  valves: ValveGeometry;
}

export interface ValveGeometry {
  /** Mitral apparatus: D-shaped annulus on the aortomitral curtain, a fan of fibres per leaflet (decision 76). */
  mitral: MitralValve;
  /**
   * Tricuspid leaflets as revolution "skirts" hanging from the annulus ring: a 2D profile (ρ, z) polyline per leaflet
   * zone blended by azimuth around the ring, so long-axis views cut hinged leaflets and short-axis views the orifice.
   */
  tv: SkirtDesc;
  /** Aortic cusps as pockets on the sinus wall (decision 79), and the root profile they hang from. */
  aortic: AorticValve;
  root: RootProfile;
  cuspCount: number;
  /** Chordae tendineae as capsules [ax,ay,az,bx,by,bz] × n. */
  chordae: Float64Array;
  chordaeCount: number;
  /** Pulmonary cusps: three 2-segment chains on the trunk axis (same layout as the aortic ones). */
  pvSegs: Float64Array;
  pvWidths: Float64Array;
  pvHalf: number;
  pvSegLen: number;
  pvThickness: number;
  /** Tricuspid annulus ring (torus, axis z): [cx,cy,cz,R]. */
  tvRing: [number, number, number, number];
}

/** Early-diastolic RV free-wall collapse window (tamponade): after AV closure, before the mitral E peak. */
function rvCollapseWindow(state: CycleState): number {
  const p = state.phase;
  // window centred just after ejection end (≈ 0.42–0.6 of the cycle for typical timings)
  const c = 0.5;
  const w = 0.1;
  return Math.exp(-((p - c) * (p - c)) / (2 * w * w));
}
/** Late-diastolic / early-systolic RA collapse window (tamponade). */
function raCollapseWindow(state: CycleState): number {
  const p = state.phase;
  const d = Math.min(Math.abs(p - 0.02), Math.abs(p - 1.02));
  return Math.exp(-(d * d) / (2 * 0.06 * 0.06));
}

export function computeHeartPose(m: HeartModel, state: CycleState): HeartPose {
  const { lv } = m;
  const sh = lv.shape;
  const tamp = m.anatomy.pericardium.tamponade;
  const long = state.longitudinal;
  const zAnn = m.physiology.mapseCm * long;
  const lengthNow = lv.lengthCm - zAnn; // apex fixed at z = L
  const volNow = state.lvVolumeMl;
  // cavity radius from the volume tables: V = π·ratio·R²·L·∫g² over the bullet profile
  const rMax0 = Math.sqrt(Math.max(volNow, 5) / (Math.PI * sh.ratio * Math.max(lengthNow, 1) * sh.I));
  // regional wall-motion abnormalities keep their segments at the end-diastolic radius; the remaining
  // segments contract more (compensatory hyperkinesia) so that the surface-averaged radius — and the
  // cavity volume — still follow the tables: R²·(1 − F) + F·R_ED² = R0²
  const F = Math.min(0.6, m.regionalMeanFrac);
  const rMax = rMax0 < lv.rMax && F > 0 ? Math.max(0.5, Math.sqrt(Math.max(0.25, (rMax0 * rMax0 - F * lv.rMax * lv.rMax) / (1 - F)))) : rMax0;
  const prof = buildLvProfile(sh, rMax, lengthNow, zAnn, allocLvProfileTable());
  // incompressible myocardium: the thickening factor keeps the shell volume of the end-diastolic wall
  const tBase = (lv.ivsd + lv.lvpwd) / 2;
  const tMean = (zeta: number): number => tBase * axialWallFactor(zeta, lv.apexT / tBase);
  // The traced end-diastolic cavity (the volume tables follow the ASE tracing convention) includes the
  // blood among the trabeculae; in systole that trabecular layer compacts against the wall, so the
  // apparent wall gains ~12 % of the shell volume on top of mass conservation of the compact wall.
  const thickK = solveThickening(prof, sh.ratio, tMean, lv.wallVolumeMl * (1 + 0.12 * state.contraction));
  const radialScale = rMax / lv.rMax;
  const longScale = lengthNow / lv.lengthCm;
  const open = state.mvOpen;
  const maxOpen = (m.anatomy.mitral.maxOpeningDeg * Math.PI) / 180;
  const sam = m.anatomy.mitral.samSeverity;
  const openScale = maxOpen / 1.22;
  // Mitral leaflets as 3-segment chains. Closed: bodies bow toward the LA, tips point apically to the
  // coaptation. Open: the anterior leaflet whips toward the septum, the posterior toward the wall.
  const samShift = sam * 0.9 * state.contraction; // SAM: anterior leaflet drifts outward (toward the LVOT/septum) in systole
  // angles from +z (apical) toward inward (−ρ); positive = pointing to the orifice centre
  const antClosed = [1.2 - samShift, 1.1 - samShift, 0.8 - samShift];
  const antOpen = [-0.61 * openScale, -0.7 * openScale, -0.79 * openScale];
  const prol = m.anatomy.mitral.prolapse;
  // prolapse: the closed leaflet body billows beyond the annular plane into the LA (angles beyond π/2 point basally)
  const postClosed = [1.05 + 1.1 * prol, 0.85 + 1.5 * prol, 0.6 + 1.7 * prol];
  const postOpen = [-0.61 * openScale, -0.79 * openScale, -0.96 * openScale];
  const mvAngleAnt = antClosed[1]! + (antOpen[1]! - antClosed[1]!) * open;
  const mvAnglePost = postClosed[1]! + (postOpen[1]! - postClosed[1]!) * open;
  const avOpenAngle = 0.15 + (1.35 * m.anatomy.aorticValve.maxOpeningFraction - 0.15) * state.avOpen;
  const tvAngleAnt = -1.0 + (0.6 + 1.0) * state.tvOpen;
  const tvAnglePost = 0.8 + (-0.7 - 0.8) * state.tvOpen;
  const A = anchorsCached(m);
  const cusps = m.anatomy.aorticValve.bicuspid ? 2 : 3;
  const tvZ = m.physiology.tapseCm * state.rvLongitudinal;
  const septalShiftCm = m.anatomy.rv.septalFlattening * 0.9;
  const rvCollapse = tamp * rvCollapseWindow(state);
  // papillary tips (the apices of the cones built below): about halfway to the axis at 40% of the ventricle's length
  const papTip = (paz: number): [number, number, number] => {
    const zt = zAnn + A.papZetaTip * lengthNow;
    const rt = lvCavityRadius(sh, prof, paz, zt) * A.papTipFrac;
    return [rt * Math.cos(paz), rt * Math.sin(paz), zt];
  };
  const tipAL = papTip(A.papAzAL),
    tipPM = papTip(A.papAzPM);
  // the curtain (anterior annulus) is fibrous continuity with the aortic root, which descends a little less than the
  // ventricular base: the anterior hinge follows it so the anterior leaflet stays attached to the root through the cycle.
  // Each papillary muscle whose tip lies beyond the reach of its chordae pulls the coaptation apically.
  const mitral = buildMitralValve(
    A.mvCenter.x,
    A.mvCenter.y,
    zAnn,
    A.mvR,
    A.avCenter.x - A.mvCenter.x,
    A.avCenter.y - A.mvCenter.y,
    m.anatomy.mitral,
    open,
    state.contraction,
    -(1 - ROOT_EXCURSION) * zAnn,
    papillaryTether(tipAL[0], tipAL[1], tipAL[2], A.mvCenter.x, A.mvCenter.y, zAnn, m.anatomy.mitral),
    papillaryTether(tipPM[0], tipPM[1], tipPM[2], A.mvCenter.x, A.mvCenter.y, zAnn, m.anatomy.mitral),
  );
  {
    // inflow below the annulus: from the outline where it lies farthest outside the cavity profile, straight to just
    // inside the profile at its widest level
    const hMax = sh.zetaMax * lengthNow;
    let worst = 0,
      worstAz = -Math.PI / 2;
    for (let i = 0; i <= 36; i++) {
      const az = -Math.PI + (i / 36) * Math.PI;
      const c = Math.cos(az),
        sn = Math.sin(az);
      // exit radius of the ray from the long axis through the annular outline
      const ox = -mitral.cx,
        oy = -mitral.cy;
      const b = ox * c + oy * sn;
      const r = -b + Math.sqrt(Math.max(0, b * b - (ox * ox + oy * oy) + mitral.R * mitral.R));
      const gap = r - lvCavityRadius(sh, prof, az, zAnn);
      if (gap > worst) {
        worst = gap;
        worstAz = az;
      }
    }
    const c = Math.cos(worstAz),
      sn = Math.sin(worstAz);
    const b = -mitral.cx * c - mitral.cy * sn;
    const rOut = -b + Math.sqrt(Math.max(0, b * b - (mitral.cx * mitral.cx + mitral.cy * mitral.cy) + mitral.R * mitral.R));
    mitral.inflowDepth = hMax;
    mitral.inflowSlope = Math.max(0, (rOut - lvCavityRadius(sh, prof, worstAz, zAnn + hMax) + 0.15) / hMax);
    // the open leaflets swing apically into the ventricle, so the annular plane that clips the profile is not a wall here;
    // the septum is where the classifier puts it, flattened toward the LV by a pressure-loaded RV
    fitOpenLeaflets(mitral, (px, py, pz) => {
      const xs = px - septalShiftAt(septalShiftCm, Math.atan2(py, px), Math.min(1, Math.max(0, (pz - zAnn) / Math.max(lengthNow, 1))));
      return smin(lvCavitySdf(prof, sh.ratio, xs, py, pz), mitralInflowSdf(px, py, pz, mitral), 0.3);
    });
  }
  // Tricuspid valve: three radial leaflets — anterior (largest), septal (hanging along the septum, the +x side
  // of the RV inflow) and posterior (inferior) — whose closed tips converge toward the orifice centre. The annulus
  // shortens in systole with its septal edge fixed (TV_SYSTOLIC_SHORTENING); leaflet lengths do not change.
  const tvOpen = state.tvOpen;
  const tvRNow = A.tvR * (1 - TV_SYSTOLIC_SHORTENING * state.contraction);
  const tv: SkirtDesc = {
    cx: A.tvCenter.x + (A.tvR - tvRNow),
    cy: A.tvCenter.y,
    cz: A.tvCenter.z + tvZ,
    R: tvRNow,
    blend: 0.25,
    thickness: 0.09,
    saddle: 0.15,
    closed: 1 - tvOpen,
    zones: [],
  };
  {
    // Each leaflet opens by the same angles turned inward just enough to stay 2.5 mm off the ventricular wall: with
    // shared angles the septal leaflet opened into the septum and the anterior one through the free wall.
    // [centre azimuth, half span, leaflet length / annular radius, open angles]: anterior 2.2 cm, septal and posterior
    // 1.6 cm long (they were 1.7, 1.2 and 1.4 cm)
    const zoneDefs: [number, number, number, number[]][] = [
      [Math.PI / 2, 1.45, 1.35, [-0.5, -0.6, -0.7]],
      [0, 0.85, 1.0, [-0.45, -0.55, -0.65]],
      [-2.0, 1.05, 1.0, [-0.5, -0.65, -0.8]],
    ];
    // Closed, every leaflet reaches the centre, where the three meet: a shallow dome whose free edges lie 3 mm apical of
    // the hinges. Each leaflet used to close by its own angles and length, shorter toward its commissures, so the
    // four-chamber plane, which crosses the annulus close to a commissure, showed a 0.3-1.3 cm coaptation gap in
    // all twelve cases: tricuspid regurgitation in normal hearts.
    const closedProf = new Float64Array(8);
    closedProf[0] = tvRNow;
    for (let i = 0; i < 3; i++) {
      closedProf[2 + i * 2] = tvRNow * (1 - 0.97 * TV_CLOSED_REACH[i]!);
      closedProf[3 + i * 2] = TV_TENTING_CM * TV_CLOSED_DEPTH[i]!;
    }
    const blendProfiles = (open: Float64Array): Float64Array => open.map((v, i) => closedProf[i]! + (v - closedProf[i]!) * tvOpen);
    const rvCavity = (px: number, py: number, pz: number): number => {
      rvRadii(m, A, prof, thickK, zAnn, lengthNow, tvZ, state.contraction, septalShiftCm, rvCollapse, Math.atan2(py, px), pz, rvRad);
      let d = 1e3;
      const u = rvRad[1]!;
      if (u > 0 && u < 1) {
        const tvPlane = A.tvCenter.z + tvZ;
        const zBase = u >= 0.35 ? tvPlane : tvPlane - 2.6 * (1 - u / 0.35);
        const r = Math.hypot(px, py);
        d = Math.max(rvRad[0]! - r, r - rvRad[2]!, zBase - pz, pz - A.rvApexFrac * m.lv.lengthCm);
      }
      return smin(d, tvInflowSdf(px, py, pz, tv, tvZ), 0.3);
    };
    // zones first (the saddle and the inflow column refer to zone 0), then each open profile fitted
    for (const [phi, halfSpan, lenFrac, opened] of zoneDefs) tv.zones.push({ phi, halfSpan, prof: blendProfiles(buildProfile(tvRNow, opened, (A.tvR * lenFrac) / 3)), kind: 0, lobes: 0, c: 0, structure: Structure.TricuspidValve });
    const rots: number[] = [];
    for (let zi = 0; zi < zoneDefs.length; zi++) {
      const [phi, halfSpan, lenFrac, opened] = zoneDefs[zi]!;
      const segLen = (A.tvR * lenFrac) / 3;
      let rot = 0;
      if (tvOpen > 0) {
        const clear = (r: number): boolean => {
          const pr = buildProfile(tvRNow, opened.map((a) => a + r), segLen);
          for (const off of [-0.6, 0, 0.6]) {
            const ang = phi + off * halfSpan;
            const ca = Math.cos(ang),
              sa = Math.sin(ang);
            for (let i = 1; i <= 6; i++) {
              // vertices (even i) and segment midpoints (odd i) of the three segments
              const j = i >> 1,
                t = i % 2 ? 0.5 : 0;
              const rho = i % 2 ? pr[j * 2]! + (pr[j * 2 + 2]! - pr[j * 2]!) * t : pr[j * 2]!;
              const zz = i % 2 ? pr[j * 2 + 1]! + (pr[j * 2 + 3]! - pr[j * 2 + 1]!) * t : pr[j * 2 + 1]!;
              const need = Math.min(0.25, 0.4 * (Math.hypot(tvRNow - rho, zz) - 0.15));
              if (need <= 0) continue;
              if (rvCavity(tv.cx + rho * ca, tv.cy + rho * sa, tv.cz + zz + saddleOffset(ang, zoneDefs[0]![0], tv.saddle)) > -need) return false;
            }
          }
          return true;
        };
        while (rot < 1.5 && !clear(rot)) rot += 0.1;
        if (rot > 0 && rot < 1.5) {
          let lo = rot - 0.1,
            hi = rot;
          for (let i = 0; i < 4; i++) {
            const mid = (lo + hi) / 2;
            if (clear(mid)) hi = mid;
            else lo = mid;
          }
          rot = hi;
        }
        rot = Math.min(rot, 1.5);
      }
      rots.push(rot);
    }
    // adjacent leaflets meet at their commissures: a plane crossing near one showed the neighbour's differently turned
    // sheet as a separate fragment, so no leaflet turns more than 0.2 rad less than its neighbours
    const maxRot = Math.max(...rots);
    for (let zi = 0; zi < zoneDefs.length; zi++) {
      const [, , lenFrac, opened] = zoneDefs[zi]!;
      const rot = Math.max(rots[zi]!, maxRot - 0.2);
      tv.zones[zi]!.prof = blendProfiles(buildProfile(tvRNow, opened.map((a) => a + rot), (A.tvR * lenFrac) / 3));
    }
  }
  // aortic cusps: pockets on the sinus wall opening by the cycle's opening times the case's maximum (decision 79)
  const aortic = buildAorticValve(cusps, Math.max(0, Math.min(1, state.avOpen)) * m.anatomy.aorticValve.maxOpeningFraction, m.anatomy.aorticValve.cuspThicknessCm);
  const root: RootProfile = { avR: A.avR, sinusR: A.sinusR, ascR: A.ascR, lvotR: m.anatomy.aorta.lvotDiameterCm / 2, count: cusps };
  // pulmonary valve: three cusps hinged at the outflow–trunk junction on the trunk axis, opening with RV ejection
  const pvSegs = new Float64Array(36);
  const pvWidths = new Float64Array(9);
  const pvZ = PV_ROOT_EXCURSION * zAnn;
  const pvSegLen = buildCuspChains(A.rvotB.x, A.rvotB.y, A.rvotB.z + pvZ, A.paDir, A.pvE1, A.pvE2, A.pvR, Math.max(0, Math.min(1, state.pvOpen)), 3, pvSegs, pvWidths, 0.2);
  // papillary muscles: round cones rooted inside the wall (level ζb) leaning into the cavity toward the
  // annulus (tip at level ζt, about halfway to the axis); they move with the wall and thicken in systole
  const paps = new Float64Array(16);
  const papAz = [A.papAzAL, A.papAzPM];
  for (let i = 0; i < 2; i++) {
    const paz = papAz[i]!;
    const zb = zAnn + A.papZetaBase * lengthNow;
    const rb = lvCavityRadius(sh, prof, paz, zb) + 0.25;
    const tip = i === 0 ? tipAL : tipPM;
    const grow = 0.9 + 0.3 * state.contraction;
    paps.set([rb * Math.cos(paz), rb * Math.sin(paz), zb, tip[0], tip[1], tip[2], A.papR * grow, A.papR * 0.65 * grow], i * 8);
  }
  // RV anterior papillary muscle: cone from the free wall at the moderator-band insertion toward the tricuspid
  const rvPap = new Float64Array(8);
  {
    const zb = zAnn + A.rvPapZetaBase * lengthNow;
    const zt = zAnn + A.rvPapZetaTip * lengthNow;
    rvRadii(m, A, prof, thickK, zAnn, lengthNow, tvZ, state.contraction, septalShiftCm, rvCollapse, A.rvPapAz, zb, rvRad);
    const rb = rvRad[2]! + 0.15;
    rvRadii(m, A, prof, thickK, zAnn, lengthNow, tvZ, state.contraction, septalShiftCm, rvCollapse, A.rvPapAz + 0.1, zt, rvRad);
    const rt = rvRad[0]! + 0.5 * (rvRad[2]! - rvRad[0]!);
    const grow = 0.9 + 0.3 * state.contraction;
    rvPap.set([rb * Math.cos(A.rvPapAz), rb * Math.sin(A.rvPapAz), zb, rt * Math.cos(A.rvPapAz + 0.1), rt * Math.sin(A.rvPapAz + 0.1), zt, 0.42 * grow, 0.28 * grow]);
  }
  // chordae tendineae: two primary chordae per mitral leaflet half from the free edge to each papillary tip
  // (anterolateral papillary ← lateral half, posteromedial ← medial half), plus two from the anterior
  // tricuspid leaflet to the RV anterior papillary muscle
  const pa = [paps[3]!, paps[4]!, paps[5]!],
    pm = [paps[11]!, paps[12]!, paps[13]!],
    rvp = [rvPap[3]!, rvPap[4]!, rvPap[5]!];
  const chordae = new Float64Array(10 * 6);
  const tipBuf = [0, 0, 0];
  const chordDefs: ['mitral' | SkirtDesc, number, number, number[]][] = [
    ['mitral', 0, -0.5, pa],
    ['mitral', 0, -0.2, pa],
    ['mitral', 0, 0.2, pm],
    ['mitral', 0, 0.5, pm],
    ['mitral', 1, 0.3, pa],
    ['mitral', 1, 0.7, pa],
    ['mitral', 1, -0.3, pm],
    ['mitral', 1, -0.7, pm],
    [tv, 0, -0.5, rvp],
    [tv, 0, 0.4, rvp],
  ];
  for (let i = 0; i < 10; i++) {
    const [k, zi, prm, e] = chordDefs[i]!;
    // mitral chordae start at the free edges of the fans: −q is the anterolateral side
    if (k === 'mitral') mitralFreeEdge(mitral, zi as 0 | 1, zi === 0 ? prm : -prm, tipBuf);
    else skirtTip(k, k.zones[zi]!, prm, tipBuf);
    chordae.set([tipBuf[0]!, tipBuf[1]!, tipBuf[2]!, e[0]!, e[1]!, e[2]!], i * 6);
  }
  const valves: ValveGeometry = {
    mitral,
    tv,
    aortic,
    root,
    cuspCount: cusps,
    chordae,
    chordaeCount: 10,
    pvSegs,
    pvWidths,
    pvHalf: A.pvR * Math.sin(Math.PI / 3) * 0.95,
    pvSegLen,
    pvThickness: 0.06,
    tvRing: [tv.cx, tv.cy, tv.cz, tv.R * 0.98],
  };
  return {
    state,
    zAnn,
    rMax,
    prof,
    thickK,
    lengthNow,
    radialScale,
    longScale,
    paps,
    rvPap,
    mvAngleAnt,
    mvAnglePost,
    avOpenAngle,
    tvAngleAnt,
    tvAnglePost,
    rvScale: 1 - 0.3 * state.contraction,
    // the displacement the leaflets hang from (RV longitudinal table, decision 106): returning the LV curve here left the
    // classifier's tricuspid plane up to 3.8 mm from the leaflets in mid-systole (decision 110)
    tvZ,
    pvZ,
    ivcCollapse: Math.min(0.95, Math.max(0, state.ivcCollapse ?? m.ivcCollapse)),
    laBooster: 1 - 0.06 * Math.max(state.atrialContraction, state.atrialHold),
    effusion: m.anatomy.pericardium.effusionCm,
    rvCollapse,
    raCollapse: tamp * raCollapseWindow(state),
    swingX: tamp * 0.45 * Math.sin(TWO_PI * state.phase),
    septalShiftCm,
    valves,
  };
}
