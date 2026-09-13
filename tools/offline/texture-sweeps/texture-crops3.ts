// Local-only visual texture comparison: 30×30 mm crops around mid-depth myocardium at 0.15 mm/px.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { encodePng } from '../render/png';
import { parseNifti } from '@/clinical/nifti';
import { identifyLabels, LABEL, orientApical, type RegionImage } from '@/clinical/regionStats';
import { presentApical, renderApical, type ConsoleOverride } from '@/simulator/renderer/clinicalImage';
import { DISPLAY_SMOOTHING, POST_SMOOTHING } from '@/simulator/renderer/acoustic/psf';
import { BLOOD_ECHO } from '@/simulator/renderer/acoustic/acoustics';
import { CONSOLE_NOISE } from '@/simulator/renderer/postprocess/consolePipeline';
const T = 200, MM = 0.15; // 30 mm crop
function crop(img: RegionImage): Uint8ClampedArray {
  // centre on the myocardium pixel closest to 60% of the myocardium's vertical extent, left half (septum side varies; take any)
  let y0 = Infinity, y1 = -Infinity;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.labels[x + y * img.width] === LABEL.myocardium) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const yc = Math.round(y0 + 0.55 * (y1 - y0));
  let xc = img.width / 2, best = Infinity;
  for (let x = 0; x < img.width; x++) if (img.labels[x + yc * img.width] === LABEL.myocardium && Math.abs(x - img.width * 0.4) < best) { best = Math.abs(x - img.width * 0.4); xc = x; }
  const out = new Uint8ClampedArray(T * T);
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    const x = Math.round(xc + ((i - T / 2) * MM) / img.mmPerPx[0]), y = Math.round(yc + ((j - T / 2) * MM) / img.mmPerPx[1]);
    if (x >= 0 && y >= 0 && x < img.width && y < img.height) out[i + j * T] = img.grey[x + y * img.width]!;
  }
  return out;
}
function sheet(rows: Uint8ClampedArray[][], file: string) {
  const cols = Math.max(...rows.map((r) => r.length)), G = 4, W = cols * T + (cols - 1) * G, H = rows.length * T + (rows.length - 1) * G;
  const rgba = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = 40; rgba[i * 4 + 1] = 40; rgba[i * 4 + 2] = 70; }
  rows.forEach((r, ri) => r.forEach((t, ci) => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const o = ((ri * (T + G) + y) * W + ci * (T + G) + x) * 4; const g = t[x + y * T]!; rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; } }));
  writeFileSync(file, encodePng(W, H, rgba));
}
const variant = (psfLat: number, psfAx: number, blood: number, noise: number, quad: boolean, o: ConsoleOverride, postLat = 0, postAx = 0) => {
  DISPLAY_SMOOTHING.lateralMm = psfLat; DISPLAY_SMOOTHING.axialMm = psfAx; POST_SMOOTHING.lateralMm = postLat; POST_SMOOTHING.axialMm = postAx;
  BLOOD_ECHO.factor = blood; CONSOLE_NOISE.scale = noise; CONSOLE_NOISE.quadrature = quad;
  return (['a4c', 'a2c'] as const).flatMap((v) => [true, false].map((ed) => crop(presentApical(renderApical('normal-excellent-window', v, ed), o))));
};
const rows = [
  variant(1.5, 0.8, 1, 0.3, true, { dynamicRangeDb: 45, gainDb: 6 }, 2.5, 1.0),
  variant(1.5, 0.8, 1, 0.3, true, { grayMap: 's-curve', dynamicRangeDb: 55, gainDb: 4 }, 2.5, 1.0),
  variant(0, 0, 1, 0.3, true, { dynamicRangeDb: 45, gainDb: 6 }, 3.0, 1.2),
  variant(0, 0, 1, 1, false, { grayMap: 'high-contrast', dynamicRangeDb: 60, gainDb: 8 }, 3.0, 1.2),
];
const dir = process.env['CAMUS_DIR']!;
const read = (p: string) => { const raw = readFileSync(p); const b = raw[0] === 0x1f ? gunzipSync(raw) : raw; return parseNifti(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)); };
const camus: Uint8ClampedArray[] = [];
for (const p of readdirSync(dir).filter((x) => /^patient\d+$/.test(x)).sort()) {
  const cfg = join(dir, p, 'Info_4CH.cfg'); if (!existsSync(cfg) || !/ImageQuality:\s*Good/.test(readFileSync(cfg, 'utf8'))) continue;
  if (Number(p.slice(7)) % 37 !== 0) continue;
  const img = read(join(dir, p, `${p}_4CH_ED.nii.gz`)), gt = read(join(dir, p, `${p}_4CH_ED_gt.nii.gz`));
  const [w, h] = img.dims; const grey = new Float32Array(w * h), labels = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { grey[i] = img.voxels[i]!; labels[i] = Math.round(gt.voxels[i]!); }
  try { identifyLabels(labels, w, h); } catch { continue; }
  camus.push(crop(orientApical({ width: w, height: h, grey, labels, mmPerPx: [img.spacing[0], img.spacing[1]] })));
  if (camus.length === 4) break;
}
sheet([...rows, camus], join(process.argv[2]!, 'texture-crops3-LOCAL-ONLY.png'));
console.log('rows: psf1.5+post2.5 lin45 | psf1.5+post2.5 s55 | post3 lin45 | post3 high-contrast60 | CAMUS (', camus.length, ')');
