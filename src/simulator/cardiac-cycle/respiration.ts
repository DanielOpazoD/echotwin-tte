/**
 * Free breathing (decision 108). A breath at rest lasts BREATH_PERIOD_S, 15 breaths per minute, with inspiration taking
 * INSPIRATION_FRACTION of it; both are declared values within the adult resting range (12–20 per minute).
 */
export const BREATH_PERIOD_S = 4;
export const INSPIRATION_FRACTION = 0.4;

/** Depth of inspiration at `timeS`: 0 at end-expiration, 1 at end-inspiration, rising and falling as half cosines. */
export function respiratoryDepth(timeS: number): number {
  const u = (((timeS / BREATH_PERIOD_S) % 1) + 1) % 1;
  if (u < INSPIRATION_FRACTION) return 0.5 - 0.5 * Math.cos((Math.PI * u) / INSPIRATION_FRACTION);
  return 0.5 + 0.5 * Math.cos((Math.PI * (u - INSPIRATION_FRACTION)) / (1 - INSPIRATION_FRACTION));
}

/**
 * Respiratory variation of the early inflow waves, as a fraction of their end-expiratory peak: the mitral E falls by `mitral`
 * and the tricuspid E rises by `tricuspid` at end-inspiration. The normal mitral variation is 16 ± 5% (95% limits 6–26%;
 * Thalén et al., J Cardiovasc Magn Reson 2016; 18(Suppl 1):Q70, real-time phase-contrast CMR). Tamponade is supported by a
 * mitral fall of more than 30% and a tricuspid rise of more than 60% (American Society of Echocardiography pericardial
 * guidelines). The variation grows linearly with the case's tamponade severity to 40% and 80% at full tamponade; the
 * normal tricuspid 20% and those end points are declared values.
 */
export function inflowRespiratoryVariation(tamponade: number): { mitral: number; tricuspid: number } {
  const t = Math.min(1, Math.max(0, tamponade));
  return { mitral: 0.16 + t * (0.4 - 0.16), tricuspid: 0.2 + t * (0.8 - 0.2) };
}
