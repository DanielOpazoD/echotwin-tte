/**
 * The bench's tracker on synthetic sequences whose true motion is known (decision 349): the CREATIS synthetic 2-D
 * echocardiograms of Evain et al. (IEEE TMI 2022, the MEDICAID project), simulated from moving meshes so their speckle
 * follows the tissue. Each `.mat` holds `bmode` with `imgs` (rows × columns × frames, grey 0–1), `grid` (pixel size and
 * origin, m), `id_ED`/`id_ES` (1-based frames) and `meshes` (nodes × xyz × frames, m): 180 nodes in five transmural
 * layers of 36, each running round the wall from base to base, endocardium first. A layer's true strain is its length at
 * end-systole against end-diastole; the tracker carries the same nodes from the end-diastolic frame and reads its own.
 * Read from SYNTHETIC_MOTION_DIR, outside the repository; only the ratios leave it.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  fullResOptions,
  polylineLength,
  strainPercent,
  trackPoints,
  type GreyFrame,
} from '@/clinical/realism/speckleTracking';
import { quantiles, type Quantiles } from '@/clinical/realism/speckleStats';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { field, numeric, parseMat } from '@/clinical/realism/matV5';

const readMat = (path: string) => parseMat(readFileSync(path), (b) => inflateSync(b));

/** Nodes per transmural layer of the CREATIS meshes, and the layers measured (the inner half of the wall). */
export const LAYER_NODES = 36;
export const LAYERS = [0, 1, 2];

export interface TruthLayer {
  file: string;
  layer: number;
  trueStrain: number;
  trackedStrain: number;
  ratio: number;
  /** Mean distance (mm) between the tracked nodes and the true ones at end-systole. */
  errorMm: number;
}

export interface TruthSummary {
  sequences: number;
  layers: TruthLayer[];
  ratio: Quantiles;
  errorMm: Quantiles;
}

function sequenceLayers(path: string, file: string): TruthLayer[] {
  const b = readMat(path)['bmode'];
  const g = field(b, 'grid');
  const res = numeric(field(g, 'res_x')).data[0]!;
  const xmin = numeric(field(g, 'xmin')).data[0]!;
  const zmin = numeric(field(g, 'zmin')).data[0]!;
  const ed = numeric(field(b, 'id_ED')).data[0]! - 1;
  const es = numeric(field(b, 'id_ES')).data[0]! - 1;
  const imgs = numeric(field(b, 'imgs'));
  const [H, W] = imgs.dims as [number, number];
  const mesh = numeric(field(b, 'meshes'));
  const [P, C] = mesh.dims as [number, number];
  if (P % LAYER_NODES !== 0)
    throw new Error(`${file}: ${P} nodos no forman capas de ${LAYER_NODES}`);
  // column-major: imgs(z, x, t), meshes(node, coordinate, t)
  const frame = (f: number): GreyFrame => {
    const grey = new Float32Array(W * H);
    for (let x = 0; x < W; x++)
      for (let z = 0; z < H; z++) grey[x + z * W] = imgs.data[z + H * x + H * W * f]!;
    return { width: W, height: H, grey };
  };
  const node = (i: number, f: number) => ({
    x: (mesh.data[i + P * C * f]! - xmin) / res,
    y: (mesh.data[i + P * 2 + P * C * f]! - zmin) / res,
  });
  const frames = Array.from({ length: es - ed + 1 }, (_, k) => frame(ed + k));
  const mm = res * 1000;
  return LAYERS.map((layer) => {
    const idx = Array.from({ length: LAYER_NODES }, (_, k) => layer * LAYER_NODES + k);
    const start = idx.map((i) => node(i, ed));
    const truth = idx.map((i) => node(i, es));
    const t = trackPoints(frames, start, fullResOptions(mm));
    const end = t.positions[t.positions.length - 1]!;
    const trueStrain = strainPercent(polylineLength(start), polylineLength(truth));
    const trackedStrain = strainPercent(polylineLength(start), polylineLength(end));
    return {
      file,
      layer,
      trueStrain,
      trackedStrain,
      ratio: trackedStrain / trueStrain,
      errorMm:
        (end.reduce((s, p, k) => s + Math.hypot(p.x - truth[k]!.x, p.y - truth[k]!.y), 0) /
          end.length) *
        mm,
    };
  });
}

/** Every `.mat` of the folder through the bench's tracker. */
export function syntheticTruth(dir: string): TruthSummary {
  const files = readdirSync(dir)
    .filter((f) => /\.mat$/i.test(f))
    .sort();
  const layers = files.flatMap((f) => sequenceLayers(join(dir, f), f));
  return {
    sequences: files.length,
    layers,
    ratio: quantiles(layers.map((l) => l.ratio)),
    errorMm: quantiles(layers.map((l) => l.errorMm)),
  };
}
