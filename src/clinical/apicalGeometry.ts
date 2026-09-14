import { erode, LABEL, type RegionImage } from './regionStats';

/**
 * Where the left ventricle sits in an apical image, measured against the sector (decision 92). The same code runs on a
 * CAMUS image and on the simulator's apical image, both apex up (`orientApical`), so the numbers compare the probe
 * placement and the anatomy behind it rather than the grey levels.
 *
 * The sector apex is the centre of the topmost lit row; the centre line runs from it to the centroid of the lit pixels in
 * the lower 40% of the image. The LV cavity apex is the centre of its topmost row, the basal midpoint the mean centre of
 * the lowest tenth of its rows. In a four-chamber image the septal side is the one whose band 3–9 mm outside the wall is
 * darker — right-ventricular blood against pericardium and lung — at mid-cavity height; signed quantities are positive
 * toward the lateral wall. In a two-chamber image they are positive toward image right.
 */
export interface ApicalGeometry {
  /** Offset (mm) of the LV cavity apex from the sector centre line. */
  apexOffsetMm: number;
  /** Distance (mm) along the centre line from the sector apex to the LV cavity apex. */
  apexDepthMm: number;
  /** Angle (°) of the LV long axis (cavity apex → basal midpoint) to the centre line. */
  axisTiltDeg: number;
  /** Four-chamber only (NaN otherwise): angle (°) between each wall over mid-cavity rows and the scan line through its middle. */
  septalRayAngleDeg: number;
  lateralRayAngleDeg: number;
  /** Four-chamber only: median grey of the septal wall minus the lateral wall over mid-cavity rows (eroded 1 px). */
  septalMinusLateralGrey: number;
}

const median = (v: number[]): number => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1]!;
};

export function apicalGeometry(img: RegionImage, view: '4CH' | '2CH'): ApicalGeometry {
  const { width: w, height: h, grey, labels } = img;
  const mm = img.mmPerPx[0];
  let vy = -1,
    vx = 0;
  for (let y = 0; y < h && vy < 0; y++) {
    let s = 0,
      n = 0;
    for (let x = 0; x < w; x++)
      if (grey[x + y * w]! > 0) {
        s += x;
        n++;
      }
    if (n >= 3) {
      vy = y;
      vx = s / n;
    }
  }
  let cx = 0,
    cy = 0,
    cn = 0;
  for (let y = Math.floor(0.6 * h); y < h; y++)
    for (let x = 0; x < w; x++)
      if (grey[x + y * w]! > 0) {
        cx += x;
        cy += y;
        cn++;
      }
  const nan: ApicalGeometry = { apexOffsetMm: NaN, apexDepthMm: NaN, axisTiltDeg: NaN, septalRayAngleDeg: NaN, lateralRayAngleDeg: NaN, septalMinusLateralGrey: NaN };
  if (vy < 0 || cn === 0) return nan;
  const len = Math.hypot(cx / cn - vx, cy / cn - vy);
  const ux = (cx / cn - vx) / len,
    uy = (cy / cn - vy) / len; // centre line; (uy, −ux) points to image right
  // cavity rows
  const rows: { y: number; left: number; right: number }[] = [];
  for (let y = 0; y < h; y++) {
    let l = -1,
      r = -1;
    for (let x = 0; x < w; x++)
      if (labels[x + y * w] === LABEL.cavity) {
        if (l < 0) l = x;
        r = x;
      }
    if (l >= 0) rows.push({ y, left: l, right: r });
  }
  if (rows.length < 10) return nan;
  const top = rows[0]!,
    bottom = rows[rows.length - 1]!;
  const apexX = (top.left + top.right) / 2,
    apexY = top.y;
  const basal = rows.filter((r) => r.y >= bottom.y - 0.1 * (bottom.y - top.y));
  const baseX = basal.reduce((a, r) => a + (r.left + r.right) / 2, 0) / basal.length,
    baseY = basal.reduce((a, r) => a + r.y, 0) / basal.length;
  const mid = rows.filter((r) => r.y >= top.y + 0.3 * (bottom.y - top.y) && r.y <= top.y + 0.7 * (bottom.y - top.y));
  // walls over mid-cavity rows: outer edge of the myocardium on each side and the wall centre
  const walls = mid.map((r) => {
    let lo = r.left - 1;
    while (lo > 0 && labels[lo + r.y * w] === LABEL.myocardium) lo--;
    let ro = r.right + 1;
    while (ro < w - 1 && labels[ro + r.y * w] === LABEL.myocardium) ro++;
    return { y: r.y, lc: (lo + 1 + r.left - 1) / 2, rc: (ro - 1 + r.right + 1) / 2, lo, ro };
  });
  const band = (side: -1 | 1): number => {
    const v: number[] = [];
    for (const wl of walls) {
      const edge = side < 0 ? wl.lo : wl.ro;
      for (let k = Math.round(3 / mm); k <= Math.round(9 / mm); k++) {
        const x = edge + side * k;
        if (x < 0 || x >= w || labels[x + wl.y * w] !== LABEL.background) break;
        if (grey[x + wl.y * w]! > 0) v.push(grey[x + wl.y * w]!);
      }
    }
    return median(v);
  };
  // + toward lateral (4CH) or image right (2CH)
  const sign = view === '4CH' ? (band(-1) < band(1) ? 1 : -1) : 1;
  const rightX = uy,
    rightY = -ux;
  const ax = apexX - vx,
    ay = apexY - vy;
  const apexDepthMm = (ax * ux + ay * uy) * mm;
  const apexOffsetMm = sign * (ax * rightX + ay * rightY) * mm;
  const lx = baseX - apexX,
    ly = baseY - apexY;
  const ll = Math.hypot(lx, ly);
  const axisTiltDeg = (sign * Math.asin(Math.max(-1, Math.min(1, (lx * rightX + ly * rightY) / ll))) * 180) / Math.PI;
  if (view !== '4CH' || walls.length < 5) return { ...nan, apexOffsetMm, apexDepthMm, axisTiltDeg };
  const rayAngle = (key: 'lc' | 'rc'): number => {
    const n = walls.length;
    const my = walls.reduce((a, wl) => a + wl.y, 0) / n,
      mx = walls.reduce((a, wl) => a + wl[key], 0) / n;
    let sxy = 0,
      syy = 0;
    for (const wl of walls) {
      sxy += (wl[key] - mx) * (wl.y - my);
      syy += (wl.y - my) ** 2;
    }
    const slope = sxy / syy; // wall direction (slope, 1)
    const rx = mx - vx,
      ry = my - vy;
    const cos = Math.abs((slope * rx + ry) / (Math.hypot(slope, 1) * Math.hypot(rx, ry)));
    return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
  };
  const myo = erode(labels, w, h, LABEL.myocardium, 1);
  const wallGrey = (side: -1 | 1): number => {
    const v: number[] = [];
    for (const r of mid) {
      let x = side < 0 ? r.left - 1 : r.right + 1;
      while (x > 0 && x < w - 1 && labels[x + r.y * w] === LABEL.myocardium) {
        if (myo[x + r.y * w]) v.push(grey[x + r.y * w]!);
        x += side;
      }
    }
    return median(v);
  };
  const septalLeft = sign > 0;
  return {
    apexOffsetMm,
    apexDepthMm,
    axisTiltDeg,
    septalRayAngleDeg: rayAngle(septalLeft ? 'lc' : 'rc'),
    lateralRayAngleDeg: rayAngle(septalLeft ? 'rc' : 'lc'),
    septalMinusLateralGrey: septalLeft ? wallGrey(-1) - wallGrey(1) : wallGrey(1) - wallGrey(-1),
  };
}
