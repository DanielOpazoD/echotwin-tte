/**
 * Assembles a sitting of the Turing test (decision 344) in a folder outside the repository: the clinical clips the user
 * has on disk and the simulator's (already written by the bench's workers into `<dir>/.staging`), balanced per view and
 * format by `buildTrial`, copied under opaque names (`clips/clip-007.mp4`), the reader's page (`index.html`) and the key
 * (`key.json`), which never travels with the page.
 *
 * Clinical sources, each optional:
 *   - CAMUS_DIR: stills (end-diastole or end-systole, four- and two-chamber, Good quality) and, when the folder holds
 *     them (`*_half_sequence.nii.gz`, the full CAMUS release), clips of the half cycle.
 *   - ECHONET_DIR: four-chamber videos of EchoNet-Dynamic in their own 112-px format.
 *   - REALISM_REAL_DIR: any other clips, in a sub-folder per view (`plax/`, `psax-mv/`, `a4c/`, `a2c/`), fitted to the
 *     tile canvas; their geometry is the user's to match (the bench cannot know their pixel size).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import { orientApical } from '@/clinical/regionStats';
import { parseEchonetFileList } from '@/clinical/realism/lvVolume';
import { buildTrial, seededRandom, type ClipItem } from '@/clinical/realism/turing';
import { camusImage, camusPatients, readCfg, readNifti } from './clinicalData';
import {
  coversCommonSector,
  readVideoGrey,
  sectorExtent,
  sectorApex,
  toTile,
  TILE_H,
  TILE_W,
  writeMp4,
  writePngGrey,
  type Grey,
} from './formats';
import { turingPage } from './turingPage';

export interface TuringOptions {
  dir: string;
  perView: number;
  seed: number;
  clipSeconds: number;
  camusDir: string | null;
  echonetDir: string | null;
  extraDir: string | null;
}

/** CAMUS stills and half-cycle clips (Good images), as clip items in the staging folder. */
function camusItems(o: TuringOptions, staging: string, rand: () => number): ClipItem[] {
  if (!o.camusDir) return [];
  const items: ClipItem[] = [];
  const good = camusPatients(o.camusDir).flatMap((p) =>
    (['4CH', '2CH'] as const)
      .filter((ch) => readCfg(join(o.camusDir!, p, `Info_${ch}.cfg`))['ImageQuality'] === 'Good')
      .map((ch) => ({ p, ch })),
  );
  const view = (ch: string): string => (ch === '4CH' ? 'a4c' : 'a2c');
  const want = 3 * o.perView;
  for (const ch of ['4CH', '2CH']) {
    const pool = good.filter((g) => g.ch === ch);
    let taken = 0;
    while (taken < want && pool.length) {
      const { p } = pool.splice(Math.floor(rand() * pool.length), 1)[0]!;
      const phase = rand() < 0.5 ? 'ED' : 'ES';
      const img = orientApical(
        camusImage(readNifti(join(o.camusDir, p, `${p}_${ch}_${phase}.nii.gz`)), null),
      );
      // a sector that does not cover the common one would show its outline
      if (!coversCommonSector(sectorExtent(img.grey, img.width, img.height, img.mmPerPx))) continue;
      taken++;
      const file = join(staging, `camus-${p}-${ch}-${phase}.png`);
      writePngGrey(file, toTile(img.grey, img.width, img.height, img.mmPerPx));
      items.push({
        source: 'real',
        view: `${view(ch)}/tile-still`,
        file,
        what: `CAMUS ${p} ${ch} ${phase}`,
      });
      const seq = join(o.camusDir, p, `${p}_${ch}_half_sequence.nii.gz`);
      if (existsSync(seq)) {
        const vol = readNifti(seq);
        const nT = vol.dims[2] ?? 1;
        const frames = Array.from({ length: nT }, (_, t) => orientApical(camusImage(vol, null, t)));
        const apex = sectorApex(frames[0]!.grey, frames[0]!.width, frames[0]!.height);
        const fps = Number(readCfg(join(o.camusDir, p, `Info_${ch}.cfg`))['FrameRate']) || 30;
        const clip = join(staging, `camus-${p}-${ch}-seq.mp4`);
        writeMp4(
          clip,
          frames.map((f) => toTile(f.grey, f.width, f.height, f.mmPerPx, apex)),
          fps,
        );
        items.push({
          source: 'real',
          view: `${view(ch)}/tile-clip`,
          file: clip,
          what: `CAMUS ${p} ${ch} medio ciclo`,
        });
      }
    }
  }
  return items;
}

/** EchoNet-Dynamic four-chamber videos, the first `clipSeconds`, re-encoded grey like the simulator's. */
function echonetItems(o: TuringOptions, staging: string, rand: () => number): ClipItem[] {
  if (!o.echonetDir) return [];
  const videoDir = existsSync(join(o.echonetDir, 'Videos'))
    ? join(o.echonetDir, 'Videos')
    : o.echonetDir;
  const listPath = join(o.echonetDir, 'FileList.csv');
  const names = existsSync(listPath)
    ? parseEchonetFileList(readFileSync(listPath, 'utf8')).map((r) => r.fileName)
    : readdirSync(videoDir)
        .filter((f) => /\.avi$/i.test(f))
        .map((f) => f.replace(/\.avi$/i, ''));
  const pool = names.filter((n) => existsSync(join(videoDir, `${n}.avi`)));
  const items: ClipItem[] = [];
  // the count is fixed before the loop: each pick leaves the pool one shorter
  const n = Math.min(3 * o.perView, pool.length);
  for (let k = 0; k < n; k++) {
    const name = pool.splice(Math.floor(rand() * pool.length), 1)[0]!;
    const v = readVideoGrey(join(videoDir, `${name}.avi`));
    const frames = v.frames.slice(0, Math.max(2, Math.round(o.clipSeconds * v.fps)));
    const file = join(staging, `echonet-${name}-112.mp4`);
    writeMp4(file, frames, v.fps);
    items.push({ source: 'real', view: 'a4c/echonet-clip', file, what: `EchoNet ${name}` });
  }
  return items;
}

/** Any clip of REALISM_REAL_DIR/<view>/, scaled to the tile canvas's width (top-aligned, aspect kept). */
function extraItems(o: TuringOptions, staging: string): ClipItem[] {
  if (!o.extraDir || !existsSync(o.extraDir)) return [];
  const items: ClipItem[] = [];
  for (const view of readdirSync(o.extraDir)) {
    const vdir = join(o.extraDir, view);
    if (!existsSync(vdir) || !readdirSync(vdir).length) continue;
    for (const f of readdirSync(vdir).filter((x) => /\.(mp4|avi|mov|webm|mkv)$/i.test(x))) {
      const v = readVideoGrey(join(vdir, f));
      const frames = v.frames
        .slice(0, Math.max(2, Math.round(o.clipSeconds * v.fps)))
        .map((g) => fitTile(g));
      const file = join(staging, `extra-${view}-${f.replace(extname(f), '')}.mp4`);
      writeMp4(file, frames, v.fps);
      items.push({ source: 'real', view: `${view}/tile-clip`, file, what: `externo ${view}/${f}` });
    }
  }
  return items;
}

function fitTile(g: Grey): Grey {
  const s = Math.max(g.width / TILE_W, g.height / TILE_H);
  const out = new Uint8Array(TILE_W * TILE_H);
  const ox = (TILE_W - g.width / s) / 2;
  for (let y = 0; y < TILE_H; y++)
    for (let x = 0; x < TILE_W; x++) {
      const sx = Math.floor((x - ox) * s),
        sy = Math.floor(y * s);
      if (sx >= 0 && sy >= 0 && sx < g.width && sy < g.height)
        out[x + y * TILE_W] = g.data[sx + sy * g.width]!;
    }
  return { width: TILE_W, height: TILE_H, data: out };
}

export interface TuringExport {
  dir: string;
  clips: number;
  byView: Record<string, { real: number; sim: number }>;
  skipped: { view: string; real: number; sim: number }[];
}

/** Builds the sitting from the simulator's items (already in staging) and the clinical ones. */
export function exportTuring(o: TuringOptions, simItems: ClipItem[]): TuringExport {
  const staging = join(o.dir, '.staging');
  mkdirSync(staging, { recursive: true });
  const rand = seededRandom(o.seed);
  const items = [
    ...simItems,
    ...camusItems(o, staging, rand),
    ...echonetItems(o, staging, rand),
    ...extraItems(o, staging),
  ];
  const trial = buildTrial(items, o.perView, o.seed);
  const clipsDir = join(o.dir, 'clips');
  rmSync(clipsDir, { recursive: true, force: true });
  mkdirSync(clipsDir, { recursive: true });
  const shown = trial.clips.map((c) => {
    const ext = extname(c.file);
    const name = `clips/clip-${String(c.n).padStart(3, '0')}${ext}`;
    copyFileSync(c.file, join(o.dir, name));
    return { ...c, file: name };
  });
  writeFileSync(join(o.dir, 'index.html'), turingPage({ clips: shown }, o.seed));
  writeFileSync(
    join(o.dir, 'key.json'),
    JSON.stringify(
      {
        seed: o.seed,
        createdAt: new Date().toISOString(),
        key: trial.key,
        skipped: trial.skipped,
        files: shown.map((c) => ({ n: c.n, file: c.file })),
      },
      null,
      2,
    ),
  );
  const byView: TuringExport['byView'] = {};
  for (const k of trial.key) {
    const v = (byView[k.view] ??= { real: 0, sim: 0 });
    if (k.real) v.real++;
    else v.sim++;
  }
  rmSync(staging, { recursive: true, force: true });
  return { dir: o.dir, clips: trial.clips.length, byView, skipped: trial.skipped };
}
