/**
 * Mitral valve apparatus (decision 76), heart frame: z toward the apex, the hinge plane at the annulus.
 *
 * The annulus is D-shaped: a circle of radius R cut by a straight segment at distance D from the centre on the side
 * facing the aortic valve. That segment is the aortomitral curtain — the fibrous continuity with the aortic root —
 * and the anterior leaflet hangs from it and from a short arc beyond each end (a third of the circumference); the
 * posterior leaflet takes the rest, from commissure to commissure around the back. The saddle rises anteriorly and
 * posteriorly and dips at the commissures, and the anterior part moves with the aortic root rather than with the
 * ventricular base.
 *
 * Closed, the free edges meet on the coaptation line K: on every anteroposterior line (lateral offset u) the point a
 * fixed fraction of the way from the posterior hinge to the anterior one, a curve posterior to the centre. Each
 * leaflet is a fan of fibres converging on a focus on the far side of K — behind it for the anterior leaflet, in
 * front of it for the posterior — so every fibre crosses K once, and that is where its closed free edge ends. Open,
 * the fibres swing away from their focus: the anterior leaflet toward the septum and the outflow tract, its medial
 * part medially; the posterior toward the posterior and lateral walls.
 *
 * It replaced two half-annulus sheets on a circular annulus (decision 46): the anterior hinge then sat inside the
 * outflow tract, 0.6 cm from its axis, so in the parasternal long axis the anterior leaflet hung from nothing; both
 * leaflets seen in the apical four-chamber view were anterior; the closed valve tented 1.2 cm into the ventricle;
 * and the open leaflets swung out of the four-chamber plane.
 */

export interface MitralParams {
  anteriorLeafletLengthCm: number;
  posteriorLeafletLengthCm: number;
  maxOpeningDeg: number;
  thickeningCm: number;
  samSeverity: number;
  prolapse: number;
}

/** Bins per leaflet across its angular span, as seen from its focus. */
export const MV_BINS = 32;

export interface MitralLeaflet {
  /** Focus on the anteroposterior axis (v coordinate from the centre). */
  focusV: number;
  /** Direction of the fan's central ray: +1 anterior (û), −1 posterior. */
  axisSign: number;
  /** Half span of ray angles (rad) from the central ray. */
  halfSpan: number;
  /** Per bin: hinge distance from the focus, closed reach from the hinge to K, closed free-edge depth below this fibre's hinge, hinge z (saddle + lift). */
  hinge: Float64Array;
  reach: Float64Array;
  tent: Float64Array;
  hingeZ: Float64Array;
  /** Open profile [a1, z1, a2, z2, a3, z3]: distance along the fibre toward the focus (negative = outward), apical depth. */
  openProf: Float64Array;
  /** Per bin: inward rotation (rad) of the open profile that keeps the open fibre off the ventricular wall (fitOpenLeaflets). */
  openRot: Float64Array;
}

export interface MitralValve {
  cx: number;
  cy: number;
  /** Hinge plane z (annulus). */
  cz: number;
  R: number;
  D: number;
  /** Unit direction from the centre toward the aortic valve. */
  ux: number;
  uy: number;
  saddle: number;
  /** z offset of the anterior (curtain) annulus from the hinge plane: it moves with the aortic root, not the base. */
  lift: number;
  thickness: number;
  open: number;
  /** Systolic anterior motion: fraction of the open anterior profile blended into the closed one. */
  samBlend: number;
  /** Inflow below the annulus (inflowTaper): inward slope of the outline and the depth where it closes into the cavity profile. */
  inflowSlope: number;
  inflowDepth: number;
  anterior: MitralLeaflet;
  posterior: MitralLeaflet;
}

/** Linear shortening of the annulus at end systole (area −19 %). */
export const MV_SYSTOLIC_SHORTENING = 0.1;
/** D/R of the D-shaped annulus: anteroposterior diameter ≈ 0.82 of the intercommissural one. */
export const MV_D_RATIO = 0.64;
/** Anterior leaflet arc beyond each end of the straight segment (rad, seen from the centre). */
export const AML_ARC_EXTENSION = 0.35;
/** Closed free edges meet this fraction of the way from the posterior hinge to the anterior one. */
const COAPT = 0.38;
/**
 * Closed profile vertices as fractions of the reach to K and of the depth of the free edge below the hinge: the body
 * descends steadily. A profile that kept the body at the height of its hinge until the last third ([0.02, 0.26, 1])
 * left the bodies of the curtain fibres high, and the apical four-chamber plane, whose hinges are the low commissural
 * points of the saddle, showed the closed valve sagging 6 mm toward the atrium, a prolapse in a normal heart.
 */
export const CLOSED_REACH = [0.36, 0.71, 1];
export const CLOSED_DEPTH = [0.3, 0.62, 1];

const segAngle = (R: number, D: number): number => Math.atan2(Math.sqrt(R * R - D * D), D);

/** v of the coaptation line at lateral offset u. */
function coaptV(u: number, R: number, D: number): number {
  const s = Math.sqrt(Math.max(0, R * R - u * u));
  const vAnt = Math.min(D, s);
  return -s + COAPT * (vAnt + s);
}

/** Distance from a focus (v = fv, u = 0) along a unit direction whose v component is dv to the D-shaped annulus. */
function rayToAnnulus(fv: number, dv: number, R: number, D: number): number {
  const b = fv * dv;
  const sCircle = -b + Math.sqrt(Math.max(0, b * b - fv * fv + R * R));
  if (dv > 1e-9) {
    const sSeg = (D - fv) / dv;
    if (sSeg > 0 && sSeg < sCircle) return sSeg;
  }
  return sCircle;
}

function openProfile(angles: number[], segLen: number): Float64Array {
  const out = new Float64Array(6);
  let a = 0,
    z = 0;
  for (let i = 0; i < 3; i++) {
    a += Math.sin(angles[i]!) * segLen;
    z += Math.cos(angles[i]!) * segLen;
    out[i * 2] = a;
    out[i * 2 + 1] = z;
  }
  return out;
}

/** Hinge height above the hinge plane at angle theta from the anteroposterior axis: saddle plus the curtain lift. */
function hingeHeight(
  R: number,
  D: number,
  saddle: number,
  lift: number,
  u: number,
  v: number,
): number {
  const theta = Math.atan2(Math.abs(u), v);
  const onCurtain = Math.max(
    0,
    Math.min(1, (segAngle(R, D) + AML_ARC_EXTENSION - theta) / AML_ARC_EXTENSION),
  );
  return saddle * ((u * u) / (u * u + v * v || 1)) + lift * onCurtain;
}

function buildLeaflet(
  anterior: boolean,
  R: number,
  D: number,
  saddle: number,
  lift: number,
  tentBase: number,
  tetherAL: number,
  tetherPM: number,
  openProf: Float64Array,
): MitralLeaflet {
  const axisSign = anterior ? 1 : -1;
  // foci on the far side of the coaptation line
  const focusV = anterior ? -0.85 * R : 0.85 * D;
  const theta0 = segAngle(R, D);
  const thetaC = theta0 + AML_ARC_EXTENSION;
  // hinge angle seen from the centre for a ray at angle psi from the fan's central ray
  const hingeOf = (psi: number): { s: number; v: number; u: number; theta: number } => {
    const dv = Math.cos(psi) * axisSign,
      du = Math.sin(psi);
    const s = rayToAnnulus(focusV, dv, R, D);
    const v = focusV + s * dv,
      u = s * du;
    return { s, v, u, theta: Math.atan2(Math.abs(u), v) };
  };
  // the fan spans the rays whose hinge lies on this leaflet's arc of the annulus
  const inArc = (psi: number): boolean => {
    const th = hingeOf(psi).theta;
    return anterior ? th <= thetaC : th >= thetaC;
  };
  let lo = 0,
    hi = Math.PI * 0.999;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inArc(mid)) lo = mid;
    else hi = mid;
  }
  const halfSpan = lo;
  const hinge = new Float64Array(MV_BINS),
    reach = new Float64Array(MV_BINS),
    tent = new Float64Array(MV_BINS),
    hingeZ = new Float64Array(MV_BINS);
  for (let k = 0; k < MV_BINS; k++) {
    const psi = -halfSpan + ((k + 0.5) / MV_BINS) * 2 * halfSpan;
    const h = hingeOf(psi);
    hinge[k] = h.s;
    // closed reach: from the hinge along the ray back toward the focus until the coaptation line
    const dv = Math.cos(psi) * axisSign,
      du = Math.sin(psi);
    const g = (s: number): number => focusV + s * dv - coaptV(s * du, R, D);
    let a = 0,
      b = h.s;
    const ga = g(a);
    for (let i = 0; i < 40; i++) {
      const m = (a + b) / 2;
      if (Math.sign(g(m)) === Math.sign(ga)) a = m;
      else b = m;
    }
    const sK = (a + b) / 2;
    reach[k] = Math.max(0.05, h.s - sK);
    const hz = hingeHeight(R, D, saddle, lift, h.u, h.v);
    hingeZ[k] = hz;
    // Both leaflets' free edges reach the same height on K: the line between the posterior and anterior hinges on this
    // anteroposterior line, at the coaptation fraction, plus the tenting depth. Measured from each fibre's own hinge,
    // so a curtain lifted with the aortic root steepens the anterior leaflet instead of leaving its edge above the
    // posterior one.
    const uK = sK * du;
    const sP = Math.sqrt(Math.max(0, R * R - uK * uK));
    const zPost = hingeHeight(R, D, saddle, lift, uK, -sP);
    const zLine = zPost + COAPT * (hingeHeight(R, D, saddle, lift, uK, Math.min(D, sP)) - zPost);
    const t = Math.abs(uK) / R;
    // papillary tether: each muscle pulls its half of both leaflets (negative u is the anterolateral side), less toward
    // the commissures, the same at the same point of K for both leaflets so the edges still meet
    const side = Math.max(-1, Math.min(1, uK / R));
    const tether = (tetherAL * (1 - side) + tetherPM * (1 + side)) / 2;
    tent[k] = zLine + (tentBase + tether) * (1 - 0.7 * t * t) - hz;
  }
  return {
    focusV,
    axisSign,
    halfSpan,
    hinge,
    reach,
    tent,
    hingeZ,
    openProf,
    openRot: new Float64Array(MV_BINS),
  };
}

/**
 * @param lift z offset of the anterior (curtain) annulus relative to the hinge plane: the aortic root moves half as
 * much as the ventricular base, and the curtain with it.
 * @param tetherAL,tetherPM apical pull (cm) of each papillary muscle on the closed coaptation (papillaryTether).
 */
export function buildMitralValve(
  cx0: number,
  cy0: number,
  cz: number,
  R0: number,
  toAortaX: number,
  toAortaY: number,
  p: MitralParams,
  open: number,
  contraction: number,
  lift: number,
  tetherAL = 0,
  tetherPM = 0,
): MitralValve {
  const l = Math.hypot(toAortaX, toAortaY) || 1;
  // systolic annular contraction (area about a fifth smaller at end systole): the fibrous curtain keeps its place and
  // the muscular posterior annulus moves toward it
  const R = R0 * (1 - MV_SYSTOLIC_SHORTENING * contraction);
  const D = R * MV_D_RATIO;
  const shift = (R0 - R) * MV_D_RATIO;
  const cx = cx0 + (toAortaX / l) * shift,
    cy = cy0 + (toAortaY / l) * shift;
  // saddle: the commissures lie 0.3 cm apical of the anterior and posterior horns, and the anterior horn rises with the
  // root in systole — annular height ≈ 11 % of the intercommissural width in diastole and ≈ 15 % in systole (normal
  // 3D values 10.6 ± 3.7 % and 13.5 ± 4.0 %)
  const saddle = 0.3;
  const openScale = (p.maxOpeningDeg * Math.PI) / 180 / 1.22;
  return {
    cx,
    cy,
    cz,
    R,
    D,
    ux: toAortaX / l,
    uy: toAortaY / l,
    saddle,
    lift,
    thickness: p.thickeningCm,
    open,
    samBlend: Math.min(0.8, p.samSeverity * 0.9 * contraction),
    inflowSlope: 0,
    inflowDepth: 2,
    // normal coaptation 3.5 mm apical of the line between the hinges; prolapse carries the posterior body (and a little
    // of the anterior) into the LA
    anterior: buildLeaflet(
      true,
      R,
      D,
      saddle,
      lift,
      0.35 - 0.5 * p.prolapse,
      tetherAL,
      tetherPM,
      openProfile(
        [-0.61 * openScale, -0.7 * openScale, -0.79 * openScale],
        p.anteriorLeafletLengthCm / 3,
      ),
    ),
    posterior: buildLeaflet(
      false,
      R,
      D,
      saddle,
      lift,
      0.35 - 1.4 * p.prolapse,
      tetherAL,
      tetherPM,
      openProfile(
        [-0.61 * openScale, -0.79 * openScale, -0.96 * openScale],
        p.posteriorLeafletLengthCm / 3,
      ),
    ),
  };
}

/**
 * Chordal reach per cm of total leaflet length (anterior + posterior): the distance from a papillary tip to the annulus
 * centre that the chordae and leaflets span without pulling the coaptation toward the apex. Set so that the normal
 * case's longer muscle is just untethered at its longest (end diastole, 3.59 cm with leaflets of 2.4 + 1.3 cm).
 */
export const CHORDAL_REACH_PER_CM = 0.97;

/**
 * Apical pull (cm) of one papillary muscle on the closed leaflets: how far its tip lies beyond the reach of the chordae
 * and leaflets, projected on the long axis. In a remodelled, spherical ventricle the muscles move apically and outward
 * while the chordae keep their length, so the coaptation is dragged into the ventricle (functional MR). Normal tenting
 * height is 5–6 mm and 8–12 mm with functional MR.
 */
export function papillaryTether(
  tipX: number,
  tipY: number,
  tipZ: number,
  cx: number,
  cy: number,
  cz: number,
  p: MitralParams,
): number {
  const dx = tipX - cx,
    dy = tipY - cy,
    dz = tipZ - cz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const beyond =
    dist - CHORDAL_REACH_PER_CM * (p.anteriorLeafletLengthCm + p.posteriorLeafletLengthCm);
  return beyond > 0 ? (beyond * dz) / dist : 0;
}

/** Result of the last query: distance, fraction hinge→free edge, leaflet (0 anterior, 1 posterior), weight, normal. */
export const mitralHit = { d: 1e3, frac: 0, leaflet: 0, w: 1, nx: 0, ny: 0, nz: 1 };

const poly = new Float64Array(6);

function sampleBins(tab: Float64Array, f: number): number {
  const x = Math.max(0, Math.min(MV_BINS - 1, f - 0.5));
  const i = Math.min(MV_BINS - 2, Math.floor(x));
  const w = x - i;
  return tab[i]! * (1 - w) + tab[i + 1]! * w;
}

function leafletDistance(
  v: number,
  u: number,
  zr0: number,
  mv: MitralValve,
  L: MitralLeaflet,
  leaflet: number,
  openness: number,
  best: number,
): number {
  const dv = v - L.focusV;
  const rho = Math.hypot(dv, u);
  if (rho < 1e-6) return best;
  const psi = Math.atan2(u, dv * L.axisSign);
  const q = psi / L.halfSpan;
  if (q <= -1 || q >= 1) return best;
  const f = ((q + 1) / 2) * MV_BINS;
  const hingeS = sampleBins(L.hinge, f);
  const reach = sampleBins(L.reach, f);
  const tent = sampleBins(L.tent, f);
  const zr = zr0 - sampleBins(L.hingeZ, f);
  const aq = Math.abs(q);
  const w =
    aq < 0.9 ? 1 : 1 - ((aq - 0.9) / 0.1) * ((aq - 0.9) / 0.1) * (3 - 2 * ((aq - 0.9) / 0.1));
  const openScale = 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - q * q));
  const c = 1 - openness;
  const rot = openness > 0 ? sampleBins(L.openRot, f) : 0;
  const cr = Math.cos(rot),
    sr = Math.sin(rot);
  for (let i = 0; i < 3; i++) {
    const oa = L.openProf[i * 2]! * openScale,
      oz = L.openProf[i * 2 + 1]! * openScale;
    poly[i * 2] = reach * CLOSED_REACH[i]! * c + (oa * cr + oz * sr) * openness;
    poly[i * 2 + 1] = tent * CLOSED_DEPTH[i]! * c + (oz * cr - oa * sr) * openness;
  }
  const inw = hingeS - rho;
  // inward direction (toward the focus) in the heart frame
  const ix = -(dv * mv.ux - u * mv.uy) / rho,
    iy = -(dv * mv.uy + u * mv.ux) / rho;
  let b = best;
  let ax = 0,
    az = 0;
  for (let i = 0; i < 3; i++) {
    const bx = poly[i * 2]!,
      bz = poly[i * 2 + 1]!;
    const ex = bx - ax,
      ez = bz - az;
    const l2 = ex * ex + ez * ez;
    let s = l2 > 0 ? ((inw - ax) * ex + (zr - az) * ez) / l2 : 0;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const qx = ax + ex * s - inw,
      qz = az + ez * s - zr;
    const d = Math.sqrt(qx * qx + qz * qz);
    if (d < b) {
      b = d;
      mitralHit.d = d;
      mitralHit.frac = (i + s) / 3;
      mitralHit.leaflet = leaflet;
      mitralHit.w = w;
      mitralHit.nx = -ez * ix;
      mitralHit.ny = -ez * iy;
      mitralHit.nz = ex;
    }
    ax = bx;
    az = bz;
  }
  return b;
}

/**
 * Distance from a heart-frame point to the mitral leaflets. Writes `mitralHit`; returns the local half thickness,
 * so the point is inside a leaflet when mitralHit.d < the returned value.
 */
export function mitralDistance(x: number, y: number, z: number, mv: MitralValve): number {
  mitralHit.d = 1e3;
  const dx = x - mv.cx,
    dy = y - mv.cy;
  const zr0 = z - mv.cz;
  if (zr0 > 3.5 || zr0 < -2.5 || dx * dx + dy * dy > (mv.R + 2.2) * (mv.R + 2.2)) return 0;
  const v = dx * mv.ux + dy * mv.uy;
  const u = -dx * mv.uy + dy * mv.ux;
  let best = leafletDistance(
    v,
    u,
    zr0,
    mv,
    mv.anterior,
    0,
    Math.max(mv.open, mv.samBlend),
    Infinity,
  );
  best = leafletDistance(v, u, zr0, mv, mv.posterior, 1, mv.open, best);
  if (!(best < Infinity)) return 0;
  // leaflets are thickest at the free edge (rough zone) and thin out toward the commissures
  return (mv.thickness * (0.6 + 0.4 * mitralHit.frac) * 0.5 + 0.035) * (0.4 + 0.6 * mitralHit.w);
}

/**
 * Point of a leaflet's current profile at fraction q ∈ (−1, 1) of its fan (negative = the anterolateral side) and
 * fraction `along` ∈ [0, 1] of its polyline from the hinge (1 = the free edge), in the heart frame.
 */
export function mitralLeafletPoint(
  mv: MitralValve,
  leaflet: 0 | 1,
  q: number,
  along: number,
  out: number[],
): void {
  const L = leaflet === 0 ? mv.anterior : mv.posterior;
  const openness = leaflet === 0 ? Math.max(mv.open, mv.samBlend) : mv.open;
  const psi = q * L.halfSpan;
  const f = ((q + 1) / 2) * MV_BINS;
  const hingeS = sampleBins(L.hinge, f);
  const reach = sampleBins(L.reach, f);
  const tent = sampleBins(L.tent, f);
  const openScale = 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - q * q));
  const rot = openness > 0 ? sampleBins(L.openRot, f) : 0;
  const cr = Math.cos(rot),
    sr = Math.sin(rot);
  const pos = Math.max(0, Math.min(1, along)) * 3;
  const seg = Math.min(2, Math.floor(pos));
  let pa = 0,
    pz = 0,
    a = 0,
    zt = 0;
  for (let i = 0; i <= seg; i++) {
    const oa = L.openProf[i * 2]! * openScale,
      oz = L.openProf[i * 2 + 1]! * openScale;
    const na = reach * CLOSED_REACH[i]! * (1 - openness) + (oa * cr + oz * sr) * openness;
    const nz = tent * CLOSED_DEPTH[i]! * (1 - openness) + (oz * cr - oa * sr) * openness;
    if (i === seg) {
      const t = pos - seg;
      a = pa + (na - pa) * t;
      zt = pz + (nz - pz) * t;
    }
    pa = na;
    pz = nz;
  }
  const dv = Math.cos(psi) * L.axisSign,
    du = Math.sin(psi);
  const sd = hingeS - a;
  const v = L.focusV + sd * dv,
    u = sd * du;
  out[0] = mv.cx + mv.ux * v - mv.uy * u;
  out[1] = mv.cy + mv.uy * v + mv.ux * u;
  out[2] = mv.cz + sampleBins(L.hingeZ, f) + zt;
}

/** Free-edge point of a leaflet at fraction q ∈ (−1, 1) of its fan (negative = the anterolateral side). */
export function mitralFreeEdge(mv: MitralValve, leaflet: 0 | 1, q: number, out: number[]): void {
  mitralLeafletPoint(mv, leaflet, q, 1, out);
}

/** Height (z) of the annulus at the angular position of (x, y) around the valve centre: saddle and curtain lift. */
export function mitralHingeZ(x: number, y: number, mv: MitralValve): number {
  const dx = x - mv.cx,
    dy = y - mv.cy;
  return (
    mv.cz +
    hingeHeight(mv.R, mv.D, mv.saddle, mv.lift, -dx * mv.uy + dy * mv.ux, dx * mv.ux + dy * mv.uy)
  );
}

/** Signed distance (cm, negative inside) to the D-shaped annulus outline projected on the hinge plane. */
export function mitralOutlineSdf(x: number, y: number, mv: MitralValve): number {
  const dx = x - mv.cx,
    dy = y - mv.cy;
  return Math.max(Math.hypot(dx, dy) - mv.R, dx * mv.ux + dy * mv.uy - mv.D);
}

/** Inside the D-shaped annulus outline (hinge plane projection), with a relative margin. */
export function insideMitralOutline(x: number, y: number, mv: MitralValve, margin = 0.98): boolean {
  const dx = x - mv.cx,
    dy = y - mv.cy;
  return (
    dx * dx + dy * dy < mv.R * margin * (mv.R * margin) && dx * mv.ux + dy * mv.uy < mv.D * margin
  );
}

/** Signed distance to the fibrous annulus: a tube of radius `tube` around the D curve (saddle and curtain lift included). */
export function mitralAnnulusDistance(
  x: number,
  y: number,
  z: number,
  mv: MitralValve,
  tube: number,
): number {
  const dx = x - mv.cx,
    dy = y - mv.cy;
  const v = dx * mv.ux + dy * mv.uy;
  const u = -dx * mv.uy + dy * mv.ux;
  const R = mv.R,
    D = mv.D;
  const uc = Math.sqrt(R * R - D * D);
  const rho = Math.hypot(u, v) || 1e-6;
  let qu = (u / rho) * R,
    qv = (v / rho) * R;
  const su = Math.max(-uc, Math.min(uc, u));
  if (
    qv > D ||
    (u - su) * (u - su) + (v - D) * (v - D) < (u - qu) * (u - qu) + (v - qv) * (v - qv)
  ) {
    qu = su;
    qv = D;
  }
  const dPlane = Math.hypot(u - qu, v - qv);
  const dzz = z - (mv.cz + hingeHeight(R, D, mv.saddle, mv.lift, qu, qv));
  return Math.sqrt(dPlane * dPlane + dzz * dzz) - tube;
}

/**
 * How far the inflow outline has moved inward at h cm apical of the local hinge (negative h: basal, where the column
 * closes 0.25 cm beyond the hinge). The ventricle's own profile narrows toward the annulus, and the annulus lies behind
 * the long axis; below it the posterior wall runs from the posterior annulus almost parallel to the long axis, and the
 * outline follows a straight line to just inside the profile at its widest level (inflowDepth), then closes.
 */
export function inflowTaper(h: number, mv: MitralValve): number {
  if (h < 0) return h < -0.25 ? 2 * (-h - 0.25) : 0;
  const beyond = h - mv.inflowDepth;
  return mv.inflowSlope * h + (beyond > 0 ? 3 * beyond * beyond : 0);
}

/** Signed distance to the mitral inflow column: the annular outline, narrowing below the hinges (negative inside). */
export function mitralInflowSdf(x: number, y: number, z: number, mv: MitralValve): number {
  return mitralOutlineSdf(x, y, mv) + 0.04 + inflowTaper(z - mitralHingeZ(x, y, mv), mv);
}

/** Minimum blood between an open leaflet and the ventricular wall (cm), beyond the first few millimetres of leaflet. */
const OPEN_WALL_GAP = 0.25;
/** Largest inward rotation of an open fibre (rad). */
const OPEN_ROT_MAX = 1.5;

/**
 * Rotate each open fibre inward, the least that keeps it inside the ventricle with a gap: the open profiles are the
 * same angles for every fibre, and without this the posterior leaflet opened through the posterior wall (the wall runs
 * almost parallel to the long axis below the posterior annulus) while its lateral fibres, facing a wall that flares
 * outward, have room to swing. `cavity` is the ventricular cavity's signed distance (negative inside).
 */
export function fitOpenLeaflets(
  mv: MitralValve,
  cavity: (x: number, y: number, z: number) => number,
): void {
  const pts = new Float64Array(12);
  for (const [L, openness] of [
    [mv.anterior, Math.max(mv.open, mv.samBlend)],
    [mv.posterior, mv.open],
  ] as const) {
    if (openness <= 0) {
      L.openRot.fill(0);
      continue;
    }
    for (let k = 0; k < MV_BINS; k++) {
      const q = -1 + ((k + 0.5) / MV_BINS) * 2;
      const psi = q * L.halfSpan;
      const dv = Math.cos(psi) * L.axisSign,
        du = Math.sin(psi);
      const hs = L.hinge[k]!;
      const hv = L.focusV + hs * dv,
        hu = hs * du;
      const hx = mv.cx + mv.ux * hv - mv.uy * hu,
        hy = mv.cy + mv.uy * hv + mv.ux * hu;
      const hz = mv.cz + L.hingeZ[k]!;
      // inward (toward the focus) in the heart frame
      const ix = -(mv.ux * dv - mv.uy * du),
        iy = -(mv.uy * dv + mv.ux * du);
      const openScale = 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - q * q));
      // vertices and segment midpoints of the fully open profile
      let pa = 0,
        pz = 0;
      for (let i = 0; i < 3; i++) {
        const na = L.openProf[i * 2]! * openScale,
          nz = L.openProf[i * 2 + 1]! * openScale;
        pts[i * 4] = (pa + na) / 2;
        pts[i * 4 + 1] = (pz + nz) / 2;
        pts[i * 4 + 2] = na;
        pts[i * 4 + 3] = nz;
        pa = na;
        pz = nz;
      }
      const clear = (rot: number): boolean => {
        const cr = Math.cos(rot),
          sr = Math.sin(rot);
        for (let j = 0; j < 6; j++) {
          const a0 = pts[j * 2]!,
            z0 = pts[j * 2 + 1]!;
          // the leaflet leaves the wall at its hinge: the gap it needs grows over the first half centimetre
          const need = Math.min(OPEN_WALL_GAP, 0.4 * (Math.hypot(a0, z0) - 0.15));
          if (need <= 0) continue;
          const a = a0 * cr + z0 * sr,
            zz = z0 * cr - a0 * sr;
          if (cavity(hx + ix * a, hy + iy * a, hz + zz) > -need) return false;
        }
        return true;
      };
      let rot = 0;
      while (rot < OPEN_ROT_MAX && !clear(rot)) rot += 0.1;
      if (rot > 0 && rot < OPEN_ROT_MAX) {
        // refine between the last blocked and the first clear angle
        let lo = rot - 0.1,
          hi = rot;
        for (let i = 0; i < 4; i++) {
          const mid = (lo + hi) / 2;
          if (clear(mid)) hi = mid;
          else lo = mid;
        }
        rot = hi;
      }
      L.openRot[k] = Math.min(rot, OPEN_ROT_MAX);
    }
    // neighbouring fibres of one sheet cannot turn independently: smooth across the fan
    const tmp = Float64Array.from(L.openRot);
    for (let k = 0; k < MV_BINS; k++)
      L.openRot[k] = Math.max(
        tmp[k]!,
        0.5 * ((tmp[Math.max(0, k - 1)]! + tmp[Math.min(MV_BINS - 1, k + 1)]!) / 2) + 0.5 * tmp[k]!,
      );
  }
}
