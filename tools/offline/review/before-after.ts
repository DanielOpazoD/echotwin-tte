/**
 * Before/after review sheets for a decision: the echo and its structure map of the same planes in two trees.
 *
 *   # in each tree (the base and the branch), with REVIEW_ANATOMY / REVIEW_IMAGE as the review sheets read them:
 *   npx tsx tools/offline/review/before-after.ts render <outDir> <view> <cases,comma> <label:tilt:turn,...>
 *   # then, from either tree:
 *   npx tsx tools/offline/review/before-after.ts compose <beforeDir> <afterDir> <outDir> "<TITLE>" <cases,comma> <label:phase,...>
 *
 * `render` writes `<case>__<plane>__<TD|MS|TS>__{eco,map}.png` for end diastole, mid-systole and end systole of each plane
 * (tilt and turn in degrees, as the neighbouring planes of the suspicion sheet). `compose` lays one sheet per case: a row
 * per plane and phase, columns before echo, before map, after echo, after map. The title is drawn in the bitmap font,
 * which has no lower case nor accents.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { encodePng } from '../render/png';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import {
  ascii,
  blit,
  buildReviewModels,
  drawText,
  echoImage,
  fill,
  H,
  nudged,
  renderPolar,
  reviewControl,
  structureMap,
  W,
} from './reviewFrame';

const PHASES = ['TD', 'MS', 'TS'] as const;
const GAP = 6,
  HEADER = 26;

function render(outDir: string, viewId: string, cases: string, planes: string): void {
  mkdirSync(outDir, { recursive: true });
  const view = VIEW_TARGETS.find((v) => v.id === viewId);
  if (!view) throw new Error(`unknown view ${viewId}`);
  const renderer = new ProceduralSliceRenderer();
  for (const m of buildReviewModels(cases.split(','))) {
    for (const p of planes.split(',')) {
      const [label, tilt, turn] = p.split(':');
      const beam = beamFrameFromPose(
        poseFromControl(m.thorax, nudged(reviewControl(view, m), Number(tilt), Number(turn))),
        1,
      );
      for (const ph of PHASES) {
        const phase = ph === 'TD' ? 0 : ph === 'MS' ? 0.5 * m.esPhase : m.esPhase;
        const frame = renderPolar(renderer, m, beam, phase);
        const base = join(outDir, `${m.c.id}__${label}__${ph}`);
        writeFileSync(`${base}__eco.png`, encodePng(W, H, echoImage(frame, m)));
        writeFileSync(`${base}__map.png`, encodePng(W, H, structureMap(frame).map));
      }
    }
    process.stdout.write(`${m.c.id}\n`);
  }
}

function readPng(path: string): Uint8ClampedArray {
  const b = readFileSync(path);
  let off = 8;
  const idat: Buffer[] = [];
  let w = 0,
    h = 0;
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  // the encoder writes filter 0 on every row
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) raw.copy(out, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  return new Uint8ClampedArray(out.buffer);
}

function compose(
  before: string,
  after: string,
  outDir: string,
  title: string,
  cases: string,
  rowsArg: string,
): void {
  mkdirSync(outDir, { recursive: true });
  const rows = rowsArg.split(',').map((r) => r.split(':') as [string, string]);
  for (const c of cases.split(',')) {
    const width = 4 * W + 5 * GAP,
      height = 2 * HEADER + rows.length * (HEADER + H + GAP) + GAP;
    const rgba = new Uint8ClampedArray(width * height * 4);
    fill(rgba, [28, 28, 32]);
    drawText(
      rgba,
      width,
      height,
      GAP,
      6,
      `${ascii(title)}  -  ${c}`.toUpperCase(),
      [255, 220, 120],
    );
    ['ANTES - ECO', 'ANTES - MAPA', 'DESPUES - ECO', 'DESPUES - MAPA'].forEach((t, k) =>
      drawText(rgba, width, height, GAP + k * (W + GAP) + 180, 6 + HEADER, t, [150, 200, 255]),
    );
    rows.forEach(([plane, ph], r) => {
      const top = 2 * HEADER + r * (HEADER + H + GAP);
      const phase = ph === 'TD' ? 'TELEDIASTOLE' : ph === 'MS' ? 'MESOSISTOLE' : 'TELESISTOLE';
      drawText(
        rgba,
        width,
        height,
        GAP,
        top + 6,
        `PLANO ${plane.toUpperCase()}  -  ${phase}`,
        [255, 220, 120],
      );
      [before, after].forEach((dir, a) =>
        (['eco', 'map'] as const).forEach((kind, k) =>
          blit(
            rgba,
            width,
            readPng(join(dir, `${c}__${plane}__${ph}__${kind}.png`)),
            GAP + (2 * a + k) * (W + GAP),
            top + HEADER,
          ),
        ),
      );
    });
    writeFileSync(join(outDir, `${c}.png`), encodePng(width, height, rgba));
    process.stdout.write(`${join(outDir, `${c}.png`)}\n`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'render') render(args[0]!, args[1]!, args[2]!, args[3]!);
else if (cmd === 'compose') compose(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!);
else throw new Error('before-after.ts render|compose …');
