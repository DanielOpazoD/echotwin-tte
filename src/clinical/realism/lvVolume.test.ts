import { describe, expect, it } from 'vitest';
import {
  apexFirst,
  biplaneMl,
  ejectionFraction,
  maskDiscs,
  parseEchonetFileList,
  parseVolumeTracings,
  singlePlaneMl,
  tracedEdEs,
  tracingContour,
  tracingVolumePx3,
} from './lvVolume';

/** An ellipse mask (semi-axes a across, c along y, mm), tilted by `tilt` rad, on a 0.25 mm grid. */
function ellipse(aMm: number, cMm: number, tilt = 0): { mask: Uint8Array; w: number; h: number } {
  const px = 0.25,
    w = 400,
    h = 400;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = (x - w / 2) * px,
        Y = (y - h / 2) * px;
      const u = X * Math.cos(tilt) + Y * Math.sin(tilt),
        v = -X * Math.sin(tilt) + Y * Math.cos(tilt);
      if ((u / aMm) ** 2 + (v / cMm) ** 2 <= 1) mask[x + y * w] = 1;
    }
  return { mask, w, h };
}

describe('method of discs on a mask', () => {
  it('measures a prolate spheroid from its long-axis section, at any tilt', () => {
    // spheroid of radius 22 mm and half length 40 mm: 4/3 π a² c = 81.1 mL
    const exact = ((4 / 3) * Math.PI * 22 * 22 * 40) / 1000;
    for (const tilt of [0, 0.4]) {
      const e = ellipse(22, 40, tilt);
      const d = maskDiscs(e.mask, e.w, e.h, [0.25, 0.25], 1)!;
      expect(d.longAxisMm).toBeCloseTo(80, -0.5);
      // 20 discs of a convex end lose a little of the tips
      expect(singlePlaneMl(d) / exact).toBeGreaterThan(0.97);
      expect(singlePlaneMl(d) / exact).toBeLessThan(1.01);
    }
  });
  it('biplane: two equal planes give the single-plane volume, an oval cross-section its product', () => {
    const a = maskDiscs(ellipse(22, 40).mask, 400, 400, [0.25, 0.25], 1)!;
    const b = maskDiscs(ellipse(16, 40).mask, 400, 400, [0.25, 0.25], 1)!;
    expect(biplaneMl(a, a)).toBeCloseTo(singlePlaneMl(a), 6);
    const exact = ((4 / 3) * Math.PI * 22 * 16 * 40) / 1000;
    expect(biplaneMl(a, b) / exact).toBeCloseTo(1, 1);
  });
  it('apexFirst puts the narrow end first; EF', () => {
    const d = { diametersMm: [30, 30, 20, 10], longAxisMm: 4, areaMm2: 0 };
    expect(apexFirst(d).diametersMm).toEqual([10, 20, 30, 30]);
    expect(apexFirst(apexFirst(d))).toEqual(apexFirst(d));
    expect(ejectionFraction(120, 48)).toBe(60);
    expect(maskDiscs(new Uint8Array(100), 10, 10, [1, 1], 1)).toBeNull();
  });
});

describe('EchoNet-Dynamic tables', () => {
  it('reads FileList.csv', () => {
    const r = parseEchonetFileList(
      'FileName,EF,ESV,EDV,FrameHeight,FrameWidth,FPS,NumberOfFrames,Split\n0X1A,61.2,35.1,90.4,112,112,50,201,TRAIN\n',
    );
    expect(r).toEqual([
      { fileName: '0X1A', ef: 61.2, esv: 35.1, edv: 90.4, fps: 50, frames: 201, split: 'TRAIN' },
    ]);
  });
  it('reads VolumeTracings.csv and tells end-diastole from end-systole by the traced volume', () => {
    // a long axis of 40 px and 20 chords: 20 px wide in frame 10, 14 px in frame 30
    const rows = ['FileName,X1,Y1,X2,Y2,Frame'];
    for (const [frame, width] of [
      [10, 20],
      [30, 14],
    ] as const) {
      rows.push(`0X1A.avi,50,10,50,50,${frame}`);
      for (let i = 0; i < 20; i++)
        rows.push(
          `0X1A.avi,${50 - width / 2},${11 + 2 * i},${50 + width / 2},${11 + 2 * i},${frame}`,
        );
    }
    const t = parseVolumeTracings(rows.join('\n')).get('0X1A')!;
    expect(t.size).toBe(2);
    expect(tracingVolumePx3(t.get(10)!)).toBeCloseTo((Math.PI / 4) * 400 * 40, 6);
    const e = tracedEdEs(t)!;
    expect([e.edFrame, e.esFrame]).toEqual([10, 30]);
    expect(e.ef).toBeCloseTo(100 * (1 - (14 / 20) ** 2), 6);
  });
});

describe('tracingContour', () => {
  // long axis, then chords from the base (wide, y = 80) to the apex (narrow, y = 20)
  const segs = [
    { x1: 50, y1: 80, x2: 50, y2: 10 },
    ...Array.from({ length: 6 }, (_, i) => {
      const y = 80 - 12 * i,
        w = 30 - 4 * i;
      return { x1: 50 - w / 2, y1: y, x2: 50 + w / 2, y2: y };
    }),
  ];
  it('runs from one side of the base round the apex to the other, without the long axis', () => {
    const c = tracingContour(segs);
    expect(c).toHaveLength(12);
    expect(c[0]).toEqual({ x: 35, y: 80 });
    expect(c[5]).toEqual({ x: 45, y: 20 });
    expect(c[6]).toEqual({ x: 55, y: 20 });
    expect(c[11]).toEqual({ x: 65, y: 80 });
  });
  it('starts at the base whichever end the chords were listed from', () => {
    const reversed = [segs[0]!, ...segs.slice(1).reverse()];
    expect(tracingContour(reversed)).toEqual(tracingContour(segs));
  });
});
