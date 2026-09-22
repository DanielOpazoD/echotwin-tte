/**
 * Blind test (decisions 144 and 146): a page of apical frames, half from CAMUS Good and half from the simulator,
 * resampled to the same scale and canvas, in random order, with the key kept apart. Whoever takes it marks each tile
 * as real or simulated; the page saves the answers as JSON and `--grade` scores them against the key: the accuracy,
 * the binomial probability of doing at least as well by chance, and the confusion counts. Nothing here goes into the
 * repository: CAMUS pixels stay in the output folder, which must lie outside it; only the aggregate result is recorded
 * (docs/VALIDATION.md, «Prueba ciega»).
 *
 * Protocol (decision 146): 24 tiles (12 real, 12 simulated), a new --seed per sitting, the rater never sees the key
 * before answering and answers every tile; one sitting per rater per simulator version. The result that counts is a
 * rater who reads echocardiograms; the goal is an accuracy at or under 70 % (17 of 24, p ≈ 0.03 against chance).
 *
 *   CAMUS_DIR=~/datos/CAMUS/database_nifti npx tsx tools/clinical/blind-test.ts --out ~/datos/CAMUS/blind [--n 24]
 *     [--cases normal-excellent-window,inferior-rwma] [--seed 7] [--gain -6] [--compensation 0.7]
 *   npx tsx tools/clinical/blind-test.ts --grade ~/datos/CAMUS/blind/answers.json [--key ~/datos/CAMUS/blind/key.json]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseNifti, type NiftiVolume } from '@/clinical/nifti';
import { orientApical, type RegionImage } from '@/clinical/regionStats';
import {
  presentApical,
  renderApical,
  type ConsoleOverride,
} from '@/simulator/renderer/clinicalImage';
import { encodePng } from '../offline/render/png';
import { gradeAnswers } from '@/clinical/blindTest';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const camusDir =
  process.env['CAMUS_DIR'] ?? join(process.env['HOME'] ?? '', 'datos/CAMUS/database_nifti');
const gradeFile = arg('--grade');
if (gradeFile) {
  const answers = JSON.parse(readFileSync(gradeFile, 'utf8')) as Record<string, 'real' | 'sim'>;
  const keyPath = arg('--key') ?? join(dirname(resolve(gradeFile)), 'key.json');
  const key = JSON.parse(readFileSync(keyPath, 'utf8')) as { tile: number; real: boolean }[];
  const r = gradeAnswers(key, answers);
  process.stdout.write(
    `${r.answered} of ${r.tiles} tiles answered · ${r.correct} correct (${(100 * r.accuracy).toFixed(0)} %) · ` +
      `real called simulated ${r.realCalledSim}, simulated called real ${r.simCalledReal} · ` +
      `p(at least this many by chance) = ${r.pChance.toFixed(3)}\n`,
  );
  process.exit(0);
}
const out = arg('--out');
if (!out) {
  process.stderr.write(
    'usage: --out <folder outside the repository> [--n 12] [--cases a,b] [--seed 7]\n',
  );
  process.exit(2);
}
const repoRoot = resolve(process.cwd());
const outAbs = resolve(out);
if (outAbs === repoRoot || outAbs.startsWith(repoRoot + sep)) {
  process.stderr.write(
    `--out (${outAbs}) está dentro del repositorio público; los píxeles de CAMUS no pueden acabar en git.\n`,
  );
  process.exit(2);
}
const n = Number(arg('--n') ?? 24);
const cases = (arg('--cases') ?? 'normal-excellent-window').split(',');
let seed = Number(arg('--seed') ?? 7);
const override: ConsoleOverride = {};
if (arg('--gain') !== undefined) override.gainDb = Number(arg('--gain'));
if (arg('--compensation') !== undefined)
  override.depthCompensationDbPerCmMHz = Number(arg('--compensation'));
const rand = (): number => {
  // xorshift32
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 1_000_000) / 1_000_000;
};

function readVolume(path: string): NiftiVolume {
  const raw = readFileSync(path);
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  return parseNifti(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}
function camusFrame(img: NiftiVolume): RegionImage {
  const [w, h] = img.dims;
  const plane = w * h;
  const grey = new Float32Array(plane);
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = img.voxels[i]!;
    grey[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo < 0 || hi > 255)
    for (let i = 0; i < plane; i++) grey[i] = (255 * (grey[i]! - lo)) / Math.max(1e-6, hi - lo);
  return {
    width: w,
    height: h,
    grey,
    labels: new Uint8Array(plane),
    mmPerPx: [img.spacing[0], img.spacing[1]],
  };
}
function cfg(path: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([^:]+):\s*(.*)$/.exec(line.trim());
    if (m) o[m[1]!.trim()] = m[2]!.trim();
  }
  return o;
}

/** Resample an apex-up image onto the common canvas: MM_PER_PX, sector apex at the top centre, bilinear. */
const MM_PER_PX = 0.35;
const TILE_W = 480,
  TILE_H = 560;
function toTile(img: RegionImage): Uint8ClampedArray {
  const { width: w, height: h, grey } = img;
  // sector apex: centre of the topmost row with lit pixels
  let vy = -1,
    vx = w / 2;
  for (let y = 0; y < h && vy < 0; y++) {
    let l = -1,
      r = -1;
    for (let x = 0; x < w; x++)
      if (grey[x + y * w]! > 0) {
        if (l < 0) l = x;
        r = x;
      }
    if (l >= 0 && r - l >= 2) {
      vy = y;
      vx = (l + r) / 2;
    }
  }
  if (vy < 0) vy = 0;
  const rgba = new Uint8ClampedArray(TILE_W * TILE_H * 4);
  const sx = MM_PER_PX / img.mmPerPx[0],
    sy = MM_PER_PX / img.mmPerPx[1];
  for (let ty = 0; ty < TILE_H; ty++)
    for (let tx = 0; tx < TILE_W; tx++) {
      const x = vx + (tx - TILE_W / 2) * sx,
        y = vy + (ty - 8) * sy;
      let v = 0;
      if (x >= 0 && y >= 0 && x < w - 1 && y < h - 1) {
        const x0 = Math.floor(x),
          y0 = Math.floor(y),
          fx = x - x0,
          fy = y - y0;
        const g = (xx: number, yy: number) => grey[xx + yy * w]!;
        v =
          g(x0, y0) * (1 - fx) * (1 - fy) +
          g(x0 + 1, y0) * fx * (1 - fy) +
          g(x0, y0 + 1) * (1 - fx) * fy +
          g(x0 + 1, y0 + 1) * fx * fy;
      }
      const o = (tx + ty * TILE_W) * 4;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = Math.round(v);
      rgba[o + 3] = 255;
    }
  return rgba;
}

interface Tile {
  id: string;
  real: boolean;
  what: string;
  png: Buffer;
}
const tiles: Tile[] = [];
// clinical half: random Good sequences, ED or ES, 4CH or 2CH
const good: { p: string; ch: string }[] = [];
for (const p of readdirSync(camusDir).filter((x) => /^patient\d+$/.test(x)))
  for (const ch of ['4CH', '2CH']) {
    const info = join(camusDir, p, `Info_${ch}.cfg`);
    if (existsSync(info) && (cfg(info)['ImageQuality'] ?? '') === 'Good') good.push({ p, ch });
  }
for (let i = 0; i < n / 2; i++) {
  const pick = good[Math.floor(rand() * good.length)]!;
  const phase = rand() < 0.5 ? 'ED' : 'ES';
  const path = join(camusDir, pick.p, `${pick.p}_${pick.ch}_${phase}.nii.gz`);
  const img = orientApical(camusFrame(readVolume(path)));
  const rgba = toTile(img);
  tiles.push({
    id: `c${i}`,
    real: true,
    what: `CAMUS ${pick.p} ${pick.ch} ${phase}`,
    png: Buffer.from(encodePng(TILE_W, TILE_H, rgba)),
  });
}
// simulated half: cases × views × phases, scatterer seed per tile
for (let i = 0; i < n / 2; i++) {
  const caseId = cases[i % cases.length]!;
  const view = rand() < 0.5 ? 'a4c' : 'a2c';
  const ed = rand() < 0.5;
  const scatterSeed = 1000 + Math.floor(rand() * 1e6);
  const img = presentApical(renderApical(caseId, view, ed, scatterSeed), override, i);
  const rgba = toTile(img);
  tiles.push({
    id: `s${i}`,
    real: false,
    what: `simulador ${caseId} ${view} ${ed ? 'ED' : 'ES'} semilla ${scatterSeed}`,
    png: Buffer.from(encodePng(TILE_W, TILE_H, rgba)),
  });
}
// shuffle
for (let i = tiles.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!];
}
mkdirSync(outAbs, { recursive: true });
const key = tiles.map((t, i) => ({ tile: i + 1, real: t.real, what: t.what }));
writeFileSync(join(outAbs, 'key.json'), JSON.stringify(key, null, 2));
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba ciega</title>
<style>body{font-family:system-ui;background:#111;color:#eee;margin:16px}h1{font-size:18px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.tile{background:#000;padding:6px;border-radius:6px}.tile img{width:100%;display:block}.tile label{display:inline-block;margin:6px 8px 0 0}
.tile .r{margin-top:4px;font-size:12px;color:#9cf;display:none}.revealed .tile .r{display:block}#score{margin:12px 0;font-size:16px}</style></head><body>
<h1>Prueba ciega: ¿real (CAMUS) o simulada? ${tiles.length} imágenes apicales a la misma escala (${MM_PER_PX} mm/px)</h1>
<p>Marca cada imagen (todas), guarda las respuestas y sólo después pulsa «Corregir». La clave está en key.json; la corrección oficial: <code>npx tsx tools/clinical/blind-test.ts --grade answers.json</code>.</p>
<div class="grid">${tiles
  .map(
    (
      t,
      i,
    ) => `<div class="tile" data-i="${i}"><img src="data:image/png;base64,${t.png.toString('base64')}" alt="imagen ${i + 1}">
<div>#${i + 1} <label><input type="radio" name="t${i}" value="real">real</label><label><input type="radio" name="t${i}" value="sim">simulada</label></div>
<div class="r">${t.real ? 'REAL' : 'SIMULADA'} · ${t.what}</div></div>`,
  )
  .join('\n')}</div>
<div id="score"></div><button id="save">Guardar respuestas (answers.json)</button> <button id="check">Corregir</button>
<script>const key=${JSON.stringify(tiles.map((t) => t.real))};
const answers=()=>{const o={};key.forEach((_,i)=>{const v=document.querySelector('input[name=t'+i+']:checked');if(v)o[String(i+1)]=v.value;});return o;};
document.getElementById('save').onclick=()=>{const a=document.createElement('a');a.href='data:application/json,'+encodeURIComponent(JSON.stringify(answers(),null,2));a.download='answers.json';a.click();};
document.getElementById('check').onclick=()=>{let ok=0,ans=0;key.forEach((real,i)=>{const v=document.querySelector('input[name=t'+i+']:checked');if(!v)return;ans++;if((v.value==='real')===real)ok++;});document.body.classList.add('revealed');document.getElementById('score').textContent='Aciertos: '+ok+' de '+ans+' respondidas ('+key.length+' imágenes; el azar da '+(key.length/2)+')';};</script>
</body></html>`;
writeFileSync(join(outAbs, 'index.html'), html);
process.stdout.write(`${tiles.length} tiles → ${join(outAbs, 'index.html')} (clave en key.json)\n`);
