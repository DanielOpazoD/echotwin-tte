/**
 * Single source of truth for clinical formulas (spec 53). Pure functions, SI-ish internal units:
 * cm, m/s, mL, mmHg. No rounding here — round only at presentation (spec 55).
 */

/** Body surface area, Mosteller. */
export function bsaMosteller(heightCm: number, weightKg: number): number {
  assertPositive(heightCm, 'heightCm');
  assertPositive(weightKg, 'weightKg');
  return Math.sqrt((heightCm * weightKg) / 3600);
}

/** Body surface area, DuBois & DuBois. */
export function bsaDuBois(heightCm: number, weightKg: number): number {
  assertPositive(heightCm, 'heightCm');
  assertPositive(weightKg, 'weightKg');
  return 0.007184 * Math.pow(heightCm, 0.725) * Math.pow(weightKg, 0.425);
}

/** Simplified Bernoulli: ΔP (mmHg) ≈ 4·v² with v in m/s. Ignores proximal velocity. */
export function simplifiedBernoulli(vMps: number): number {
  return 4 * vMps * vMps;
}

/** Bernoulli including proximal velocity: 4(v2² − v1²). */
export function bernoulliWithProximal(vDistalMps: number, vProximalMps: number): number {
  return 4 * (vDistalMps * vDistalMps - vProximalMps * vProximalMps);
}

/** Circular area from diameter (cm → cm²). */
export function circularArea(diameterCm: number): number {
  assertPositive(diameterCm, 'diameterCm');
  return Math.PI * Math.pow(diameterCm / 2, 2);
}

/** Stroke volume (mL) = LVOT area (cm²) × LVOT VTI (cm). */
export function strokeVolume(lvotDiameterCm: number, lvotVtiCm: number): number {
  return circularArea(lvotDiameterCm) * lvotVtiCm;
}

/** Continuity equation aortic valve area (cm²). */
export function continuityAva(lvotDiameterCm: number, lvotVtiCm: number, avVtiCm: number): number {
  assertPositive(avVtiCm, 'avVtiCm');
  return (circularArea(lvotDiameterCm) * lvotVtiCm) / avVtiCm;
}

/** Dimensionless velocity (or VTI) index for AS. */
export function velocityRatio(lvotValue: number, avValue: number): number {
  assertPositive(avValue, 'avValue');
  return lvotValue / avValue;
}

export function ejectionFraction(edvMl: number, esvMl: number): number {
  assertPositive(edvMl, 'edvMl');
  if (esvMl < 0 || esvMl > edvMl) throw new RangeError('esvMl must be within [0, edvMl]');
  return ((edvMl - esvMl) / edvMl) * 100;
}

export function cardiacOutput(strokeVolumeMl: number, heartRateBpm: number): number {
  return (strokeVolumeMl * heartRateBpm) / 1000; // L/min
}

/** Educational RVSP estimate (mmHg) from TR peak velocity (m/s) and RAP (mmHg). */
export function rvspFromTr(trVmaxMps: number, rapMmHg: number): number {
  return simplifiedBernoulli(trVmaxMps) + rapMmHg;
}

/** Mean gradient from a velocity envelope sampled at uniform time steps (m/s → mmHg). */
export function meanGradientFromEnvelope(velocitiesMps: readonly number[]): number {
  if (velocitiesMps.length === 0) return 0;
  let sum = 0;
  for (const v of velocitiesMps) sum += simplifiedBernoulli(v);
  return sum / velocitiesMps.length;
}

/** VTI (cm) = ∫ v dt with v in m/s, dt in s → ×100. Trapezoidal rule. */
export function vtiFromEnvelope(velocitiesMps: readonly number[], dtS: number): number {
  if (velocitiesMps.length < 2) return 0;
  let area = 0;
  for (let i = 1; i < velocitiesMps.length; i++) {
    const a = velocitiesMps[i - 1] ?? 0;
    const b = velocitiesMps[i] ?? 0;
    area += ((a + b) / 2) * dtS;
  }
  return area * 100;
}

/** Index a value by BSA (e.g. mL → mL/m²). */
export function indexToBsa(value: number, bsaM2: number): number {
  assertPositive(bsaM2, 'bsaM2');
  return value / bsaM2;
}

/** E/e′ ratio (both cm/s or both m/s). */
export function eOverEPrime(eCmps: number, ePrimeCmps: number): number {
  assertPositive(ePrimeCmps, 'ePrimeCmps');
  return eCmps / ePrimeCmps;
}

/**
 * Method of discs (single plane) volume: sum of 20 elliptical discs (circular in single plane)
 * along the long axis L. `diametersCm` are the disc diameters from base to apex.
 */
export function simpsonSinglePlaneVolume(
  diametersCm: readonly number[],
  longAxisCm: number,
): number {
  const n = diametersCm.length;
  if (n === 0) return 0;
  const h = longAxisCm / n;
  let vol = 0;
  for (const d of diametersCm) vol += Math.PI * (d / 2) * (d / 2) * h;
  return vol;
}

/**
 * Biplane method of discs: discs are ellipses with diameters from A4C and A2C at matching
 * levels. L is the longer of the two long axes (ASE chamber quantification convention).
 */
export function simpsonBiplaneVolume(
  a4cDiametersCm: readonly number[],
  a2cDiametersCm: readonly number[],
  longAxisCm: number,
): number {
  const n = Math.min(a4cDiametersCm.length, a2cDiametersCm.length);
  if (n === 0) return 0;
  const h = longAxisCm / n;
  let vol = 0;
  for (let i = 0; i < n; i++) {
    const a = a4cDiametersCm[i] ?? 0;
    const b = a2cDiametersCm[i] ?? 0;
    vol += (Math.PI / 4) * a * b * h;
  }
  return vol;
}

/** Pressure half-time (ms) → mitral valve area (cm²) via the 220 empirical constant. */
export function mvaFromPht(phtMs: number): number {
  assertPositive(phtMs, 'phtMs');
  return 220 / phtMs;
}

/** Fractional area change (%) of the RV. */
export function fractionalAreaChange(edAreaCm2: number, esAreaCm2: number): number {
  assertPositive(edAreaCm2, 'edAreaCm2');
  return ((edAreaCm2 - esAreaCm2) / edAreaCm2) * 100;
}

/** Doppler shift: fd = 2·f0·v·cosθ / c. f0 in Hz, v in m/s, c in m/s → Hz. */
export function dopplerShiftHz(f0Hz: number, vMps: number, cosTheta: number, cMps = 1540): number {
  return (2 * f0Hz * vMps * cosTheta) / cMps;
}

/** Nyquist velocity (m/s) for a given PRF and carrier: vN = PRF·c / (4·f0). */
export function nyquistVelocity(prfHz: number, f0Hz: number, cMps = 1540): number {
  return (prfHz * cMps) / (4 * f0Hz);
}

/** Maximum PRF allowed by depth: PRFmax = c / (2·depth). depth in m. */
export function maxPrfForDepth(depthM: number, cMps = 1540): number {
  assertPositive(depthM, 'depthM');
  return cMps / (2 * depthM);
}

/** Wrap an axial velocity into the Nyquist interval given a baseline shift (all m/s). */
export function aliasVelocity(vMps: number, nyquistMps: number, baselineShiftMps = 0): number {
  const lo = -nyquistMps + baselineShiftMps;
  const hi = nyquistMps + baselineShiftMps;
  const span = hi - lo;
  if (span <= 0) return vMps;
  let x = vMps - lo;
  x = x - Math.floor(x / span) * span;
  return lo + x;
}

function assertPositive(x: number, name: string): void {
  if (!(x > 0) || !Number.isFinite(x))
    throw new RangeError(`${name} must be a positive finite number, got ${x}`);
}
