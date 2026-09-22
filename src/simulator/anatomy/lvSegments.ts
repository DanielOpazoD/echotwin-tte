/**
 * Left-ventricular myocardial segments of a point of LV compact myocardium (decision 152), in the heart frame: azimuth
 * atan2(y, x) with 0 = lateral and π/2 = anterior, and the level fraction (z − zAnn) / (L − zAnn) from the mitral annulus
 * (0) to the end of the LV cavity (1; the endocardial apex stays at z = L through the cycle).
 *
 * Both are material in this model: the ventricle shortens along its axis with the apex fixed and thickens radially
 * without torsion, so a point of tissue keeps its azimuth and its level fraction through the cycle (its material
 * coordinates are the same numbers scaled back to end-diastole; `lvSegments.test.ts` follows material points).
 *
 * Clinical rules (AHA 2002; ASE/EACVI 2015): the anterior and inferior right-ventricular insertions bound the septum —
 * anterior (1, 7) | anteroseptal (2, 8) at the anterior one, inferoseptal (3, 9) | inferior (4, 10) at the inferior one
 * — and the six basal and mid segments are 60° each; the apical level has four segments centred on the anterior, septal,
 * inferior and lateral walls; the long axis is divided into basal, mid and apical thirds; the apex (17) is the
 * myocardium beyond the end of the cavity. Model choices: the insertions are the model's interventricular grooves
 * (`RV_GROOVE_ANTERIOR_RAD`, `RV_GROOVE_INFERIOR_RAD`), 2.1 rad (120.3°) apart; the boundaries are the septal centre
 * midway between them ± 60°, within 0.2° of each groove, so that the septum holds exactly two segments; equal thirds of the current annulus–cavity length (the model's papillary tips and bases lie at 0.40 and 0.68
 * of it, not at the thirds); half-open intervals, the lower bound belonging to the next segment clockwise.
 *
 * One code carries two models: 1–16 are the AHA segments; 17–20 are the apical cap in the quadrant of apical segment
 * 13, 14, 15 or 16. AHA 17 reads 17–20 as 17; the 16-segment wall-motion model reads them as 13–16, so its four apical
 * segments cover the whole apex (it is not the 17-segment volume with the cap removed). 0 = not LV compact myocardium.
 * This function is translated to GLSL (`npm run glsl:gen`): the CPU and GPU tracers share its boundaries.
 */
export function lvSegmentCode(
  azimuthRad: number,
  levelFrac: number,
  rvAzA: number,
  rvAzP: number,
): number {
  // AHA angle: the septal centre (midway between the insertions) at 180°, lateral near 0°, anterior near 90°
  const septal = (rvAzA + rvAzP) * 0.5;
  const raw = ((azimuthRad - septal) * 180) / Math.PI + 180;
  let deg = raw - 360 * Math.floor(raw / 360);
  // a raw angle a hair below 0 rounds to exactly 360: that is 0 (anterolateral), not the end of inferolateral
  if (deg >= 360) deg = 0;
  let quadrant = 15;
  if (deg < 45 || deg >= 315) quadrant = 16;
  else if (deg < 135) quadrant = 13;
  else if (deg < 225) quadrant = 14;
  if (levelFrac >= 1) return quadrant + 4;
  if (levelFrac >= 2 / 3) return quadrant;
  const base = levelFrac < 1 / 3 ? 0 : 6;
  if (deg < 60) return base + 6;
  if (deg < 120) return base + 1;
  if (deg < 180) return base + 2;
  if (deg < 240) return base + 3;
  if (deg < 300) return base + 4;
  return base + 5;
}

/** AHA 17 identity of a segment code (0 when none). */
export function aha17FromCode(code: number): number {
  return code >= 17 ? 17 : code;
}

/** 16-segment wall-motion identity of a segment code: the cap belongs to its apical quadrant (0 when none). */
export function lv16FromCode(code: number): number {
  return code >= 17 ? code - 4 : code;
}

/**
 * The separate 18-segment strain topology: six segments at every level, the apical ones like the basal and mid ones and
 * reaching the apex. Not rendered: kept so that an 18-segment analysis never borrows AHA ids.
 */
export function lv18Segment(
  azimuthRad: number,
  levelFrac: number,
  rvAzA: number,
  rvAzP: number,
): number {
  // the wall of the azimuth, read on the mid ring (ids 7–12 → 1–6)
  const wall = lvSegmentCode(azimuthRad, 0.5, rvAzA, rvAzP) - 6;
  const level = levelFrac < 1 / 3 ? 0 : levelFrac < 2 / 3 ? 1 : 2;
  return level * 6 + wall;
}
