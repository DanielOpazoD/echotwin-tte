/**
 * Aortic root profile and semilunar cusps (decision 79), in root coordinates: t along the root axis from the annulus
 * (the plane of the cusp nadirs, positive toward the aorta), r from the axis and φ around it in the e1/e2 basis.
 *
 * Each cusp is a pocket hung from a crown-shaped attachment on the sinus wall: its nadir at the annulus and its two
 * ends at the commissures, just below the sinotubular junction. It is described by one radial profile per azimuth, so a
 * short-axis section crosses it along a curve and a long-axis section along a line. Closed, every profile runs from
 * its attachment to the centre: the belly first inward and slightly toward the ventricle, then up to the bottom of the
 * coaptation zone. Toward the commissures the profiles rise along the edge of the coaptation surfaces, the bands where
 * adjacent cusps press together on the lines from the centre to each commissure (the Y of the short axis). Open, the
 * profiles lie along the sinus wall. Normal geometry: effective height (annulus to the centre of the free margin) ≈ 9 mm,
 * coaptation height 4-5 mm, geometric height > 16 mm.
 *
 * It replaced flat two-segment sheets hinged on a flat ring (decision 46): closed, their straight free edges drew a
 * triangle in every short-axis section instead of a Y, the free margin sat 13.5 mm above the annulus, and a thickness
 * floor made normal cusps 1.2-1.4 mm thick, as bright as the root wall in the long axis.
 */

/** Aortic root levels along its axis from the annulus (cm): widest sinus, sinotubular waist, start of the tubular ascending aorta. */
export const ROOT_SINUS_T = 0.95;
/**
 * Height (cm) below the annulus at which the outflow tract has narrowed to its own diameter (decision 161): the level at
 * which the measurement protocol takes the LVOT diameter, 0.5 cm proximal to the annulus. The tract used to reach it
 * 1.2 cm below, so at the protocol's level it measured 2.20–2.24 cm against the 2.1 cm of the case, whose flow and
 * stroke volume use the declared diameter: a well-placed caliper overestimated the stroke volume by 13 %.
 */
export const LVOT_TAPER_CM = 0.5;
export const ROOT_STJ_T = 2.0;
export const ROOT_ASC_T = 3.0;
/** Half thickness of the coaptation surfaces of the closed valve (cm). */
export const AV_COAPT_HALF = 0.02;
/** Normal cusp geometry (cm): effective height, coaptation height at the centre, commissure height, belly sag. */
export const AV_EFFECTIVE_HEIGHT = 0.9;
export const AV_COAPTATION_HEIGHT = 0.45;
export const AV_LATERAL_COAPTATION_HEIGHT = 0.59;
export const AV_LATERAL_PROFILE_RADIUS = 0.64;
export const AV_COMMISSURE_HEIGHT = 1.75;
export const AV_BELLY_SAG = 0.15;
/**
 * Shape of the crown-shaped attachment, as a superellipse in (azimuth fraction, height): k = 1 − √(1 − aq^n). With n = 2
 * (a semicircle, decision 79) the attachment reached mid-height 14° from each commissure, so a short-axis cut at the
 * coaptation level met each cusp body between its attachment and the closure line as a 5 mm «V» at the end of every arm
 * of the Y, and a physician reading the image saw folds at the base of the cusps that a real valve does not show. With
 * n = 6 the commissural posts are tall and narrow (the attachment is within 5° of the commissure down to 0.6 cm above the
 * annulus, 2.3° at the free-edge level), the interleaflet triangles narrow to their apex, and the cut shows the Y alone
 * (decision 147).
 */
export const AV_CROWN_EXPONENT = 6;
/**
 * Open cusps hang from the annulus like a slightly tapering cylinder rather than lying on the sinus wall: at the cusp
 * centre the free edge stands at AV_OPEN_EDGE_FRACTION of the annulus radius, at the commissures on the wall. Cusp
 * separation in the long axis ≈ 1.9 cm for a 2.4 cm annulus (normal 1.5–2.6 cm) and a rounded triangular orifice in the
 * short axis, instead of the concentric circle at 0.9 of the sinus radius that a wall-hugging profile drew (decision 147).
 */
export const AV_OPEN_EDGE_FRACTION = 0.8;
/** Gap between an open cusp and the sinus wall at the commissures (cm). */
export const AV_OPEN_WALL_GAP = 0.05;
/** Azimuth (rad, e1/e2 basis) of the centre of cusp 0; the sinus bulges share it. */
export const AV_PHI0 = 0.5;

/**
 * Lumen radius of the outflow tract at height t < 0 below the annulus: from 0.95 of the annulus radius to the tract's
 * own radius over LVOT_TAPER_CM, with zero slope at both ends. The flow field uses it too (decision 161), so the colour
 * and the PW gate see the lumen that is drawn.
 */
export function lvotRadiusAt(avR: number, lvotR: number, t: number): number {
  const u = Math.min(1, Math.max(0, -t / LVOT_TAPER_CM));
  return avR * 0.95 + (lvotR - avR * 0.95) * u * u * (3 - 2 * u);
}

export interface RootProfile {
  avR: number;
  sinusR: number;
  ascR: number;
  lvotR: number;
  count: number;
}

/**
 * Lumen radius of the outflow tract and aortic root at height t and azimuth φ: LVOT (t < 0) → annulus → widest sinus
 * (ROOT_SINUS_T) → sinotubular waist (ROOT_STJ_T) → tubular ascending aorta (ROOT_ASC_T), each piece meeting the next
 * with zero slope, and the sinuses bulging ±6 % at the cusp centres between the annulus and the junction (decision 75).
 */
export function rootRadiusAt(p: RootProfile, t: number, phi: number): number {
  const sinusMax =
    p.sinusR *
    (1 +
      0.06 *
        Math.cos(p.count * (phi - AV_PHI0)) *
        (t > 0 && t < ROOT_STJ_T ? Math.sin((Math.PI * t) / ROOT_STJ_T) : 0));
  const stjR = Math.min(p.ascR, p.sinusR * 0.88);
  if (t < 0) return lvotRadiusAt(p.avR, p.lvotR, t);
  if (t < ROOT_SINUS_T)
    return p.avR + (sinusMax - p.avR) * Math.sin((Math.PI / 2) * (t / ROOT_SINUS_T));
  if (t < ROOT_STJ_T)
    return (
      stjR +
      (sinusMax - stjR) *
        0.5 *
        (1 + Math.cos((Math.PI * (t - ROOT_SINUS_T)) / (ROOT_STJ_T - ROOT_SINUS_T)))
    );
  if (t < ROOT_ASC_T)
    return (
      stjR +
      (p.ascR - stjR) *
        0.5 *
        (1 - Math.cos((Math.PI * (t - ROOT_STJ_T)) / (ROOT_ASC_T - ROOT_STJ_T)))
    );
  return p.ascR;
}

export interface AorticValve {
  count: number;
  eH: number;
  cH: number;
  hComm: number;
  sag: number;
  /** Opening 0 (closed) … 1 (profiles along the sinus wall): the cycle's opening times the case's maximum. */
  open: number;
  thickness: number;
}

export function buildAorticValve(count: number, open: number, thickness: number): AorticValve {
  return {
    count,
    eH: AV_EFFECTIVE_HEIGHT,
    cH: AV_COAPTATION_HEIGHT,
    hComm: AV_COMMISSURE_HEIGHT,
    sag: AV_BELLY_SAG,
    open: Math.max(0, Math.min(1, open)),
    thickness,
  };
}

/** Coaptation band on the line to a commissure at normalized radius rn = r / wall radius: [bottom, top] heights. */
export function aorticCoaptationBand(av: AorticValve, rn: number): [number, number] {
  const r = Math.max(0, Math.min(1, rn));
  const margin = av.count === 3 ? r * r * r : Math.pow(r, 1.5);
  const top = av.eH + (av.hComm - av.eH) * margin;
  if (av.count !== 3) return [top - (av.cH * (1 - r) + 0.1 * r), top];
  const inner = r <= AV_LATERAL_PROFILE_RADIUS;
  const u = inner
    ? r / AV_LATERAL_PROFILE_RADIUS
    : (r - AV_LATERAL_PROFILE_RADIUS) / (1 - AV_LATERAL_PROFILE_RADIUS);
  const blend = u * u * (3 - 2 * u);
  const height = inner
    ? av.cH + (AV_LATERAL_COAPTATION_HEIGHT - av.cH) * blend
    : AV_LATERAL_COAPTATION_HEIGHT + (0.1 - AV_LATERAL_COAPTATION_HEIGHT) * blend;
  return [top - height, top];
}

export function aorticContactBand(
  av: AorticValve,
  root: RootProfile,
  t: number,
  r: number,
  phi: number,
): [number, number] | null {
  const closed = 1 - av.open;
  if (closed <= 0) return null;
  const hingeT = av.hComm - 0.1;
  const hingeR = rootRadiusAt(root, hingeT, phi) - 0.05;
  const restT = (t - av.open * hingeT) / closed;
  const restR = (r - av.open * hingeR) / closed;
  if (restT < 0 || restR < 0) return null;
  const wallR = rootRadiusAt(root, restT, phi);
  if (restR >= wallR * 0.97) return null;
  const [bottom, top] = aorticCoaptationBand(av, restR / wallR);
  return [closed * bottom + av.open * hingeT, closed * top + av.open * hingeT];
}

const RN = [1, AV_LATERAL_PROFILE_RADIUS, 0.29, 0];
const prof = new Float64Array(8);

/** Current profile of a cusp at fraction q ∈ [−1, 1] of its sector (0 = centre, ±1 = commissures), as (r, t) × 4 in `prof`. */
function cuspProfile(av: AorticValve, root: RootProfile, q: number, phi: number): void {
  const aq = Math.min(1, Math.abs(q));
  const k = 1 - Math.sqrt(Math.max(0, 1 - Math.pow(aq, AV_CROWN_EXPONENT)));
  const tAtt = (av.hComm - 0.1) * k;
  const rw = rootRadiusAt(root, tAtt, phi) - 0.02;
  const tTopOpen = av.hComm - 0.35 + 0.25 * aq * aq;
  const o = av.open;
  // open: at the cusp centre the cusp hangs from the annulus, tapering to AV_OPEN_EDGE_FRACTION of the annulus radius at
  // the free edge; toward the commissures it lies on the sinus wall
  const centreWeight = 1 - aq * aq;
  for (let i = 0; i < 4; i++) {
    const rn = RN[i]!;
    // closed: belly toward the ventricle at the cusp centre, rising to the edge of the coaptation surfaces toward the commissures
    const tMid = (av.eH - av.cH) * (1 - rn) - av.sag * Math.sin(Math.PI * rn) * (1 - aq);
    const [edge] = aorticCoaptationBand(av, rn);
    const rc = rw * rn,
      tc = tMid + (edge - tMid) * k;
    const f = i / 3;
    const to = tAtt + (tTopOpen - tAtt) * f;
    const wallR = rootRadiusAt(root, to, phi) - AV_OPEN_WALL_GAP;
    const hangR = root.avR * (1 - (1 - AV_OPEN_EDGE_FRACTION) * f);
    const ro = Math.min(wallR, wallR + (hangR - wallR) * centreWeight);
    prof[i * 2] = rc + (ro - rc) * o;
    prof[i * 2 + 1] = tc + (to - tc) * o;
  }
}

/** Result of the last query: distance, fraction along the profile (0 attachment → 1 free end), edge weight, normal in (r, t). */
export const aorticHit = { d: 1e3, frac: 0, w: 1, nr: 0, nt: 1 };

/**
 * Distance from a point in root coordinates to the cusps; writes `aorticHit` and returns the local half thickness, so
 * the point is inside a cusp when aorticHit.d is below it. Cusps are thickest at the free edge (nodule) and thin out
 * toward the commissures.
 */
export function aorticCuspDistance(
  av: AorticValve,
  root: RootProfile,
  t: number,
  rr: number,
  phi: number,
): number {
  aorticHit.d = 1e3;
  if (t < -0.5 || t > av.hComm + 0.3) return 0;
  const per = (2 * Math.PI) / av.count;
  let psi = (phi - AV_PHI0) % per;
  if (psi < 0) psi += per;
  if (psi > per / 2) psi -= per;
  const q = psi / (per / 2);
  cuspProfile(av, root, q, phi);
  let ax = prof[0]!,
    az = prof[1]!;
  for (let i = 1; i < 4; i++) {
    const bx = prof[i * 2]!,
      bz = prof[i * 2 + 1]!;
    const ex = bx - ax,
      ez = bz - az;
    const l2 = ex * ex + ez * ez;
    let s = l2 > 0 ? ((rr - ax) * ex + (t - az) * ez) / l2 : 0;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const qx = ax + ex * s - rr,
      qz = az + ez * s - t;
    const d = Math.sqrt(qx * qx + qz * qz);
    if (d < aorticHit.d) {
      aorticHit.d = d;
      aorticHit.frac = (i - 1 + s) / 3;
      const l = Math.sqrt(l2) || 1;
      aorticHit.nr = -ez / l;
      aorticHit.nt = ex / l;
    }
    ax = bx;
    az = bz;
  }
  const aq = Math.abs(q);
  const tw = (aq - 0.85) / 0.15;
  aorticHit.w = aq < 0.85 ? 1 : 1 - tw * tw * (3 - 2 * tw);
  return (av.thickness * (0.7 + 0.3 * aorticHit.frac) * 0.5 + 0.012) * (0.4 + 0.6 * aorticHit.w);
}

/** Free end of a cusp's profile at fraction q of its sector: radius from the axis and height, for tests and tools. */
export function aorticCuspTip(
  av: AorticValve,
  root: RootProfile,
  q: number,
): { r: number; t: number } {
  cuspProfile(av, root, q, AV_PHI0 + q * (Math.PI / av.count));
  return { r: prof[6]!, t: prof[7]! };
}
