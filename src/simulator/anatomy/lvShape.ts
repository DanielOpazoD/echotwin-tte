
/**
 * Left-ventricular cavity shape: a bullet-shaped profile of revolution (elliptical cross-section)
 * instead of the former clipped ellipsoid. The dimensionless profile g(ζ) gives the cavity radius
 * as a fraction of the maximal radius R at the level fraction ζ (0 = mitral annulus plane, 1 =
 * endocardial apex):
 *   ζ < 0       : an elliptical dome closing the profile ζtop·L above the annulus (the annular plane
 *                clips it; the region holds the mitral orifice, the LVOT and the fibrous skeleton);
 *   0 ≤ ζ ≤ ζmax: annular neck rising quadratically from g0 to 1 (the LV flares below the annulus);
 *   ζmax ≤ ζ ≤ 1: g = (1 − sⁿ)^½ with s = (ζ − ζmax)/(1 − ζmax): a broad mid cavity that rounds off
 *                into a circular apex (n = 2 is the ellipse; n ≈ 3 keeps the apical third wide as in a
 *                normal bullet-shaped LV while the tip stays round, never flat).
 * `sphericity` (case parameter, 0 bullet → 1 spherical) moves the level of maximal width toward the
 * middle, opens the neck and lowers n.
 *
 * For signed distances the surface is tabulated every frame in polar coordinates from an interior
 * centre C on the long axis (ζc): R(φ) for φ ∈ [0, π] (0 = apex direction, π = base direction).
 * The profile is star-shaped from C, so the inside test is exact and the distance
 * d ≈ (|P − C| − R(φ))·cos α (α = angle between the radial direction and the surface normal) is
 * first-order accurate everywhere, including the rounded apex — no singularity. The same table is
 * uploaded to the GPU (paramLayout), so CPU and GLSL evaluate one geometry.
 */
export interface LvShape {
  g0: number; // cavity radius at the annulus plane as a fraction of the maximal radius
  zetaMax: number; // level (fraction of length) of the maximal width
  n: number; // superellipse exponent of the apical taper
  ratio: number; // anteroposterior / lateral radius ratio of the cross-section
  zetaC: number; // level of the polar centre
  I: number; // ∫₀¹ g(ζ)² dζ — cavity volume = π·ratio·R²·L·I (annulus plane → apex)
  zetaTop: number; // (negative) level where the dome closes the profile above the annulus
  gTab: Float64Array; // g(ζ) sampled uniformly over [zetaTop, 1]
  dgTab: Float64Array; // dg/dζ sampled likewise
}

export const LV_PROF_BINS = 96;
const DENSE = 160;
// per-bin sin/cos of the polar angle (shell-volume integration)
const BIN_SIN = new Float64Array(LV_PROF_BINS);
const BIN_COS = new Float64Array(LV_PROF_BINS);
for (let i = 0; i < LV_PROF_BINS; i++) {
  BIN_SIN[i] = Math.sin((Math.PI * i) / (LV_PROF_BINS - 1));
  BIN_COS[i] = Math.cos((Math.PI * i) / (LV_PROF_BINS - 1));
}
/** Per-shape lookup of g(ζ) and dg/dζ over [zetaTop, 1] (the per-sample CPU path avoids pow). */
const G_TAB = 512;

export function lvShapeFor(sphericity: number): LvShape {
  const s = Math.min(1, Math.max(0, sphericity));
  const g0 = 0.72 + 0.06 * s;
  const zetaMax = 0.3 + 0.2 * s;
  const n = 3.0 - 1.0 * s;
  const sh: LvShape = { g0, zetaMax, n, ratio: 0.94, zetaC: 0.42, I: 0, zetaTop: -0.17, gTab: new Float64Array(G_TAB + 1), dgTab: new Float64Array(G_TAB + 1) };
  // Simpson over [0, 1]
  const N = 400;
  let sum = 0;
  for (let i = 0; i <= N; i++) {
    const g = lvProfileGExact(sh, i / N);
    sum += (i === 0 || i === N ? 1 : i % 2 ? 4 : 2) * g * g;
  }
  sh.I = sum / (3 * N);
  for (let i = 0; i <= G_TAB; i++) {
    const zeta = sh.zetaTop + (1 - sh.zetaTop) * (i / G_TAB);
    sh.gTab[i] = lvProfileGExact(sh, zeta);
    sh.dgTab[i] = lvProfileDGExact(sh, zeta);
  }
  return sh;
}

/** Dimensionless cavity radius at level ζ, interpolated from the per-shape table (per-sample path). */
export function lvProfileG(sh: LvShape, zeta: number): number {
  if (zeta >= 1 || zeta <= sh.zetaTop) return 0;
  const f = ((zeta - sh.zetaTop) / (1 - sh.zetaTop)) * G_TAB;
  const i = Math.min(G_TAB - 1, Math.floor(f));
  const t = f - i;
  return sh.gTab[i]! + (sh.gTab[i + 1]! - sh.gTab[i]!) * t;
}

/** dg/dζ interpolated from the per-shape table. */
export function lvProfileDG(sh: LvShape, zeta: number): number {
  if (zeta >= 1) return -6;
  if (zeta <= sh.zetaTop) return 6;
  const f = ((zeta - sh.zetaTop) / (1 - sh.zetaTop)) * G_TAB;
  const i = Math.min(G_TAB - 1, Math.floor(f));
  const t = f - i;
  return sh.dgTab[i]! + (sh.dgTab[i + 1]! - sh.dgTab[i]!) * t;
}

/** Dimensionless cavity radius at level ζ (analytic; clamped to ≥ 0; 0 beyond the apex). */
export function lvProfileGExact(sh: LvShape, zeta: number): number {
  if (zeta < 0) {
    const v = zeta / sh.zetaTop;
    return v >= 1 ? 0 : sh.g0 * Math.sqrt(1 - v * v);
  }
  if (zeta <= sh.zetaMax) {
    const u = 1 - zeta / sh.zetaMax;
    return Math.max(0, 1 - (1 - sh.g0) * u * u);
  }
  if (zeta >= 1) return 0;
  const s = (zeta - sh.zetaMax) / (1 - sh.zetaMax);
  return Math.sqrt(Math.max(0, 1 - Math.pow(s, sh.n)));
}

/** dg/dζ (analytic; clamped to [−6, 6] near the apex where the tangent is vertical). */
export function lvProfileDGExact(sh: LvShape, zeta: number): number {
  if (zeta < 0) {
    const v = zeta / sh.zetaTop;
    if (v >= 0.999) return 6;
    return (-sh.g0 * v) / sh.zetaTop / Math.sqrt(1 - v * v);
  }
  if (zeta <= sh.zetaMax) {
    const u = 1 - zeta / sh.zetaMax;
    return (2 * (1 - sh.g0) * u) / sh.zetaMax;
  }
  if (zeta >= 1) return -6;
  const s = (zeta - sh.zetaMax) / (1 - sh.zetaMax);
  const sn = Math.pow(s, sh.n);
  const d = -((sh.n / 2) * Math.pow(s, sh.n - 1)) / Math.sqrt(Math.max(1e-9, 1 - sn)) / (1 - sh.zetaMax);
  return Math.max(-6, d);
}

/** Cross-section factor: real-space radius at azimuth az for a profile radius ρ is ρ·ellipseFactor(az). */
export function ellipseFactor(ratio: number, az: number): number {
  const c = Math.cos(az),
    s = Math.sin(az) / ratio;
  return 1 / Math.sqrt(c * c + s * s);
}

/** Per-frame polar table of the cavity surface. */
export interface LvProfileTable {
  R: Float64Array; // radius from C per φ bin
  S: Float64Array; // (dR/dφ)/R per bin (slope → normal tilt)
  zc: number; // z of the polar centre (heart frame)
  rMax: number; // maximal cavity radius (lateral)
  length: number; // annulus plane → apex now
  zAnn: number; // annulus plane z
}

export function allocLvProfileTable(): LvProfileTable {
  return { R: new Float64Array(LV_PROF_BINS), S: new Float64Array(LV_PROF_BINS), zc: 0, rMax: 1, length: 1, zAnn: 0 };
}

const densePhi = new Float64Array(DENSE + 1);
const denseRad = new Float64Array(DENSE + 1);

/** Tabulate the profile (rMax, length, annulus position) into `out`. */
export function buildLvProfile(sh: LvShape, rMax: number, length: number, zAnn: number, out: LvProfileTable): LvProfileTable {
  const zc = zAnn + sh.zetaC * length;
  out.zc = zc;
  out.rMax = rMax;
  out.length = length;
  out.zAnn = zAnn;
  // dense samples from the closure above the annulus (φ = π) to the apex tip (φ = 0)
  for (let i = 0; i <= DENSE; i++) {
    const zeta = sh.zetaTop + (1 - sh.zetaTop) * (i / DENSE);
    const rho = rMax * lvProfileG(sh, zeta);
    const dz = zAnn + zeta * length - zc;
    densePhi[i] = i === 0 ? Math.PI : i === DENSE ? 0 : Math.atan2(rho, dz);
    denseRad[i] = Math.sqrt(rho * rho + dz * dz);
  }
  // resample onto uniform φ (monotone decreasing along i for a star-shaped profile)
  const N = LV_PROF_BINS;
  let i = 0;
  for (let k = 0; k < N; k++) {
    const phi = Math.PI * (1 - k / (N - 1)); // walk from π down to 0 with the dense index
    while (i < DENSE - 1 && densePhi[i + 1]! >= phi) i++;
    const p0 = densePhi[i]!,
      p1 = densePhi[i + 1]!;
    const t = p0 === p1 ? 0 : Math.min(1, Math.max(0, (p0 - phi) / (p0 - p1)));
    out.R[N - 1 - k] = denseRad[i]! + (denseRad[i + 1]! - denseRad[i]!) * t;
  }
  const dphi = Math.PI / (N - 1);
  for (let k = 0; k < N; k++) {
    const a = out.R[Math.max(0, k - 1)]!,
      b = out.R[Math.min(N - 1, k + 1)]!;
    const span = (Math.min(N - 1, k + 1) - Math.max(0, k - 1)) * dphi;
    out.S[k] = (b - a) / span / Math.max(1e-6, out.R[k]!);
  }
  return out;
}

/** Scratch for the last SDF query's normal (unnormalised, heart frame). */
export const lvSdfNormal = new Float64Array(3);

/**
 * Signed distance from (xs, y, z) to the cavity surface (negative inside). `xs` is the lateral
 * coordinate after any septal shift; the anteroposterior axis is scaled by the cross-section ratio.
 * Writes the surface normal into `lvSdfNormal`.
 */
export function lvCavitySdf(tab: LvProfileTable, ratio: number, xs: number, y: number, z: number): number {
  const ys = y / ratio;
  const rho2 = xs * xs + ys * ys;
  const rho = Math.sqrt(rho2);
  const dz = z - tab.zc;
  const phi = rho > 1e-9 ? Math.atan2(rho, dz) : dz >= 0 ? 0 : Math.PI;
  const rad = Math.sqrt(rho2 + dz * dz);
  const N = LV_PROF_BINS;
  let fk = (phi / Math.PI) * (N - 1);
  if (fk < 0) fk = 0;
  else if (fk > N - 1.0001) fk = N - 1.0001;
  const k = Math.floor(fk);
  const t = fk - k;
  const R = tab.R[k]! + (tab.R[k + 1]! - tab.R[k]!) * t;
  const S = tab.S[k]! + (tab.S[k + 1]! - tab.S[k]!) * t;
  const f = 1 / Math.sqrt(1 + S * S);
  const sinP = rad > 1e-9 ? rho / rad : 0,
    cosP = rad > 1e-9 ? dz / rad : 1;
  // normal in the (ρ, z) half-plane: radial direction tilted by the slope
  const nr = sinP - S * cosP,
    nz = cosP + S * sinP;
  const ir = rho > 1e-9 ? 1 / rho : 0;
  lvSdfNormal[0] = nr * xs * ir;
  lvSdfNormal[1] = (nr * ys * ir) / ratio;
  lvSdfNormal[2] = nz;
  // distances in the y-scaled space are stretched by 1/ratio along y: correct toward the real distance
  const q = rho2 > 1e-12 ? Math.sqrt((xs * xs + ratio * ratio * ys * ys) / rho2) : 1;
  const corr = 1 - (1 - q) * sinP * sinP;
  return (rad - R) * f * corr;
}

/** Cavity radius (real space, from the long axis) at azimuth az and height z. */
export function lvCavityRadius(sh: LvShape, tab: LvProfileTable, az: number, z: number): number {
  const zeta = (z - tab.zAnn) / Math.max(tab.length, 1e-3);
  return tab.rMax * lvProfileG(sh, zeta) * ellipseFactor(sh.ratio, az);
}

/** Radial (cylindrical) offset that a normal offset `t` of the surface produces at height z. */
export function lvRadialOffsetFactor(sh: LvShape, tab: LvProfileTable, az: number, z: number): number {
  const zeta = (z - tab.zAnn) / Math.max(tab.length, 1e-3);
  const drdz = (tab.rMax * lvProfileDG(sh, zeta) * ellipseFactor(sh.ratio, az)) / Math.max(tab.length, 1e-3);
  return Math.sqrt(1 + Math.min(9, drdz * drdz));
}

/**
 * Volume (mL) of the myocardial shell of normal thickness k·tMean(ζ) around the tabulated cavity,
 * counted apical of the annulus plane: Σ [(R + k·T/cos α)³ − R³]·sin φ over the polar body.
 */
export function lvShellVolume(tab: LvProfileTable, ratio: number, tMean: (zeta: number) => number, k: number): number {
  const N = LV_PROF_BINS;
  const dphi = Math.PI / (N - 1);
  let sum = 0;
  const invL = 1 / Math.max(tab.length, 1e-3);
  for (let i = 0; i < N; i++) {
    const R = tab.R[i]!;
    const z = tab.zc + R * BIN_COS[i]!;
    if (z < tab.zAnn) continue;
    const S = tab.S[i]!;
    const T = k * tMean((z - tab.zAnn) * invL) * Math.sqrt(1 + S * S);
    const Ro = R + T;
    const w = i === 0 || i === N - 1 ? 0.5 : 1;
    sum += w * (Ro * Ro * Ro - R * R * R) * BIN_SIN[i]!;
  }
  return ((2 * Math.PI) / 3) * ratio * sum * dphi;
}

/** Thickening factor k such that the shell volume equals `wallVolumeMl` (bisection on [0.5, 3.5]). */
export function solveThickening(tab: LvProfileTable, ratio: number, tMean: (zeta: number) => number, wallVolumeMl: number): number {
  let lo = 0.5,
    hi = 3.5;
  for (let it = 0; it < 14; it++) {
    const mid = (lo + hi) / 2;
    if (lvShellVolume(tab, ratio, tMean, mid) < wallVolumeMl) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Axial wall-thickness factor: full thickness in the basal half, quadratic taper to `apexFrac` at the apex. */
export function axialWallFactor(zeta: number, apexFrac: number): number {
  if (zeta <= 0.5) return 1;
  const u = Math.min(1, (zeta - 0.5) / 0.5);
  return 1 - (1 - apexFrac) * u * u;
}
