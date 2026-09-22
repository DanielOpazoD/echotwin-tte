import { describe, expect, it } from 'vitest';
import { LABEL, type RegionImage } from './regionStats';
import { surroundings } from './surroundings';

/**
 * The surroundings metrics on a phantom of known truth (fidelity method, rule 16): a sector with a bright near field,
 * an LV whose septal side faces dark right-ventricular blood and whose lateral side carries a bright pericardial line,
 * a myocardium brighter at the epicardium than at the endocardium, and a grey far field.
 */
function phantom(opts: { flip?: boolean } = {}): RegionImage {
  const w = 400,
    h = 480,
    mm = 0.3;
  const grey = new Float32Array(w * h);
  const labels = new Uint8Array(w * h);
  const apexX = 200,
    apexY = 10;
  const cavity = { cx: 200, cy: 200, rx: 45, ry: 110 }; // LV cavity ellipse (px)
  const wall = 22; // myocardium thickness (px)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      // 80° sector
      const dy = y - apexY,
        dx = x - apexX;
      if (dy < 0 || Math.abs(Math.atan2(dx, dy)) > (40 * Math.PI) / 180 || Math.hypot(dx, dy) > 460)
        continue;
      grey[i] = 40; // far field
      if (dy < 15 / mm) grey[i] = 150; // near field
      const ex = (x - cavity.cx) / cavity.rx,
        ey = (y - cavity.cy) / cavity.ry;
      const rCav = Math.hypot(ex, ey);
      const exW = (x - cavity.cx) / (cavity.rx + wall),
        eyW = (y - cavity.cy) / (cavity.ry + wall);
      const rWall = Math.hypot(exW, eyW);
      if (rCav <= 1) {
        labels[i] = LABEL.cavity;
        grey[i] = 20;
      } else if (rWall <= 1) {
        labels[i] = LABEL.myocardium;
        // brighter toward the epicardium: 100 at the endocardium, 180 at the epicardium
        const t = (rCav - 1) / (wall / cavity.rx);
        grey[i] = 100 + 80 * Math.min(1, Math.max(0, t));
      } else if (y > cavity.cy + cavity.ry + wall + 5 && y < cavity.cy + cavity.ry + wall + 90) {
        if (Math.abs(x - cavity.cx) < 60) {
          labels[i] = LABEL.atrium;
          grey[i] = 30;
        }
      }
      // right-ventricular blood to the left of the septum, a pericardial line to the right of the lateral wall
      const septalSide = opts.flip ? x > cavity.cx : x < cavity.cx;
      if (labels[i] === LABEL.background && rWall > 1 && Math.abs(y - cavity.cy) < 80) {
        if (septalSide && rWall < 1.9) grey[i] = 12;
        if (!septalSide && rWall > 1.02 && rWall < 1.08) grey[i] = 230;
      }
    }
  return { width: w, height: h, grey, labels, mmPerPx: [mm, mm] };
}

describe('surroundings of the left ventricle on a phantom', () => {
  it('reads the near field, both bands, the pericardial line, the far field and the wall profile', () => {
    const s = surroundings(phantom(), '4CH');
    expect(s.nearFieldGrey).toBe(150);
    expect(s.side1BandGrey).toBe(12); // septal = the dark band
    expect(s.side2BandGrey).toBeGreaterThanOrEqual(40);
    expect(s.side2EpicardialPeakGrey).toBe(230);
    expect(s.side1EpicardialPeakGrey).toBeLessThan(30);
    expect(s.farBackgroundGrey).toBe(40);
    expect(s.side2Transmural[0]).toBeLessThan(s.side2Transmural[4]!);
    expect(s.side2EpiOverMid).toBeGreaterThan(1.15);
    expect(s.side2EndoOverMid).toBeLessThan(0.85);
  });
  it('finds the septum by the dark band whichever side it lies on', () => {
    const a = surroundings(phantom(), '4CH');
    const b = surroundings(phantom({ flip: true }), '4CH');
    expect(b.side1BandGrey).toBe(a.side1BandGrey);
    expect(b.side2EpicardialPeakGrey).toBe(a.side2EpicardialPeakGrey);
  });
  it('keeps image sides in a two-chamber image', () => {
    const s = surroundings(phantom({ flip: true }), '2CH');
    expect(s.side1EpicardialPeakGrey).toBe(230); // the line is on image left after the flip
    expect(s.side2BandGrey).toBe(12);
  });
});
