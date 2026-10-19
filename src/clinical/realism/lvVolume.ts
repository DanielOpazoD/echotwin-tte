/**
 * LV volumes of the realism bench (decision 344), measured the same way on the simulator's apical images and on the
 * clinical ones: the method of discs on a cavity mask (CAMUS ground truth, or the simulator's structure map seen through
 * the same scan conversion), single plane or biplane, and the reading of EchoNet-Dynamic's tables.
 *
 * Discs on a mask: the long axis is the mask's principal axis (area moments in mm), split into `discs` slabs; each disc's
 * diameter is its slab's area over the slab's thickness, the mean chord, which a pixel grid does not bias the way the
 * extreme chord does. Biplane: Σ π/4 · aᵢ · bᵢ · L/N with the longer of the two axes (ASE/EACVI 2015).
 */

export interface DiscMeasure {
  diametersMm: number[];
  longAxisMm: number;
  areaMm2: number;
}

/** Discs of the pixels of `mask` equal to `label` (row-major, width × height, pixel size in mm along x and y). */
export function maskDiscs(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  mmPerPx: readonly [number, number],
  label: number,
  discs = 20,
): DiscMeasure | null {
  const [sx, sy] = mmPerPx;
  let n = 0,
    mx = 0,
    my = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (mask[x + y * width] === label) {
        n++;
        mx += x * sx;
        my += y * sy;
      }
  if (n < 10) return null;
  mx /= n;
  my /= n;
  let cxx = 0,
    cyy = 0,
    cxy = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (mask[x + y * width] === label) {
        const dx = x * sx - mx,
          dy = y * sy - my;
        cxx += dx * dx;
        cyy += dy * dy;
        cxy += dx * dy;
      }
  const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const ux = Math.cos(angle),
    uy = Math.sin(angle);
  let tMin = Infinity,
    tMax = -Infinity;
  const ts = new Float64Array(n);
  let k = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (mask[x + y * width] === label) {
        const t = (x * sx - mx) * ux + (y * sy - my) * uy;
        ts[k++] = t;
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
      }
  // the pixels' centres span one pixel less than their area along the axis
  const pxAlong = Math.abs(ux) * sx + Math.abs(uy) * sy;
  const L = tMax - tMin + pxAlong;
  const lo = tMin - pxAlong / 2;
  const slab = L / discs;
  const counts = new Float64Array(discs);
  for (let i = 0; i < n; i++)
    counts[Math.min(discs - 1, Math.max(0, Math.floor((ts[i]! - lo) / slab)))]! += 1;
  const pxArea = sx * sy;
  return {
    diametersMm: Array.from(counts, (c) => (c * pxArea) / slab),
    longAxisMm: L,
    areaMm2: n * pxArea,
  };
}

/** Single-plane method of discs (mL): Σ π/4 dᵢ² · L/N. */
export function singlePlaneMl(d: DiscMeasure): number {
  const h = d.longAxisMm / d.diametersMm.length;
  return d.diametersMm.reduce((s, di) => s + (Math.PI / 4) * di * di * h, 0) / 1000;
}

/**
 * Biplane method of discs (mL) from two orthogonal planes (four- and two-chamber): Σ π/4 aᵢ bᵢ · L/N with L the longer
 * axis. Both planes must have the same number of discs, ordered the same way along the axis (the caller orients them,
 * e.g. apex first).
 */
export function biplaneMl(a: DiscMeasure, b: DiscMeasure): number {
  const n = a.diametersMm.length;
  if (b.diametersMm.length !== n) throw new Error('biplane: disc counts differ');
  const h = Math.max(a.longAxisMm, b.longAxisMm) / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (Math.PI / 4) * a.diametersMm[i]! * b.diametersMm[i]! * h;
  return v / 1000;
}

/** Orients a disc measure so its first disc is the narrower end (the apex of an LV cavity). */
export function apexFirst(d: DiscMeasure): DiscMeasure {
  const k = Math.max(1, Math.floor(d.diametersMm.length / 4));
  const head = d.diametersMm.slice(0, k).reduce((s, v) => s + v, 0);
  const tail = d.diametersMm.slice(-k).reduce((s, v) => s + v, 0);
  return head <= tail ? d : { ...d, diametersMm: [...d.diametersMm].reverse() };
}

/** Ejection fraction (%) from end-diastolic and end-systolic volumes. */
export function ejectionFraction(edv: number, esv: number): number {
  return (100 * (edv - esv)) / edv;
}

/** Parses a CSV with a header row into records (no quoted commas: EchoNet's tables have none). */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const head = lines[0]!.split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    const r: Record<string, string> = {};
    head.forEach((h, i) => (r[h] = (cells[i] ?? '').trim()));
    return r;
  });
}

export interface EchonetRecord {
  fileName: string;
  ef: number;
  esv: number;
  edv: number;
  fps: number;
  frames: number;
  split: string;
}

/** EchoNet-Dynamic `FileList.csv`: one row per video with its EF, ESV and EDV (mL) as the clinical system reported them. */
export function parseEchonetFileList(text: string): EchonetRecord[] {
  return parseCsv(text)
    .map((r) => ({
      fileName: (r['FileName'] ?? '').replace(/\.avi$/i, ''),
      ef: Number(r['EF']),
      esv: Number(r['ESV']),
      edv: Number(r['EDV']),
      fps: Number(r['FPS']),
      frames: Number(r['NumberOfFrames']),
      split: r['Split'] ?? '',
    }))
    .filter((r) => r.fileName.length > 0);
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * EchoNet-Dynamic `VolumeTracings.csv`: per video and traced frame, the segments of the expert's tracing in pixels, in
 * file order. For each frame the first segment is the long axis and the rest the disc chords perpendicular to it.
 */
export function parseVolumeTracings(text: string): Map<string, Map<number, Segment[]>> {
  const out = new Map<string, Map<number, Segment[]>>();
  for (const r of parseCsv(text)) {
    const file = (r['FileName'] ?? '').replace(/\.avi$/i, '');
    const frame = Number(r['Frame']);
    if (!file || !Number.isFinite(frame)) continue;
    let byFrame = out.get(file);
    if (!byFrame) out.set(file, (byFrame = new Map<number, Segment[]>()));
    let segs = byFrame.get(frame);
    if (!segs) byFrame.set(frame, (segs = []));
    segs.push({
      x1: Number(r['X1']),
      y1: Number(r['Y1']),
      x2: Number(r['X2']),
      y2: Number(r['Y2']),
    });
  }
  return out;
}

/** Single-plane disc volume of one EchoNet tracing, in cubic pixels (EchoNet gives no pixel size): Σ π/4 dᵢ² · L/N. */
export function tracingVolumePx3(segments: readonly Segment[]): number {
  if (segments.length < 3) return NaN;
  const len = (s: Segment): number => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const L = len(segments[0]!);
  const chords = segments.slice(1);
  const h = L / chords.length;
  return chords.reduce((v, s) => v + (Math.PI / 4) * len(s) ** 2 * h, 0);
}

/**
 * The two traced frames of a video: the one of larger traced volume is end-diastole. Returns their frame numbers and the
 * EF the tracings imply.
 */
export function tracedEdEs(
  byFrame: Map<number, Segment[]>,
): { edFrame: number; esFrame: number; ef: number } | null {
  const v = [...byFrame.entries()].map(([f, s]) => ({ f, v: tracingVolumePx3(s) }));
  if (v.length < 2) return null;
  v.sort((a, b) => b.v - a.v);
  const ed = v[0]!,
    es = v[v.length - 1]!;
  return { edFrame: ed.f, esFrame: es.f, ef: ejectionFraction(ed.v, es.v) };
}

/**
 * The endocardial contour of an EchoNet tracing, from one side of the base round the apex to the other: the chords
 * ordered from the wide end (the base) to the apex, their first ends going up, then their second ends coming back down
 * (as EchoNet's own code closes the tracing into a polygon). The long axis, the first segment, is left out.
 */
export function tracingContour(segments: readonly Segment[]): { x: number; y: number }[] {
  let chords = segments.slice(1);
  const width = (s: Segment): number => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const k = Math.max(1, Math.floor(chords.length / 4));
  const head = chords.slice(0, k).reduce((a, s) => a + width(s), 0);
  const tail = chords.slice(-k).reduce((a, s) => a + width(s), 0);
  if (head < tail) chords = [...chords].reverse();
  return [
    ...chords.map((s) => ({ x: s.x1, y: s.y1 })),
    ...chords.map((s) => ({ x: s.x2, y: s.y2 })).reverse(),
  ];
}
