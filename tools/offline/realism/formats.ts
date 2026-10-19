/**
 * Presentation formats of the Turing test (decision 343): a clinical clip and a simulated one must reach the reader in
 * the same geometry, or the frame gives the answer away.
 *   - `tile`: the sector resampled to 0.35 mm/px on a 480 × 560 canvas, apex at the top centre, as the still-frame blind
 *     test of decision 146 (CAMUS stills and sequences, and the simulator's views).
 *   - `echonet`: the bounding square of the sector resized to 112 × 112, as EchoNet-Dynamic distributes its videos
 *     (Ouyang et al., Nature 2020).
 * Clips are written as grey H.264 MP4 through ffmpeg; stills as PNG. Videos are read back as raw grey frames.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { encodePng } from '../render/png';

export type Format = 'tile' | 'echonet';

export interface Grey {
  width: number;
  height: number;
  /** 0–255, row-major. */
  data: Uint8Array;
}

export const TILE_MM_PER_PX = 0.35;
export const TILE_W = 480,
  TILE_H = 560;
export const ECHONET_SIZE = 112;

function bilinear(src: ArrayLike<number>, w: number, h: number, x: number, y: number): number {
  if (!(x >= 0 && y >= 0 && x < w - 1 && y < h - 1)) return 0;
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  const g = (xx: number, yy: number): number => src[xx + yy * w]!;
  return (
    g(x0, y0) * (1 - fx) * (1 - fy) +
    g(x0 + 1, y0) * fx * (1 - fy) +
    g(x0, y0 + 1) * (1 - fx) * fy +
    g(x0 + 1, y0 + 1) * fx * fy
  );
}

/** The sector's apex: the centre of the topmost row with at least three lit pixels (blind-test.ts). */
export function sectorApex(src: ArrayLike<number>, w: number, h: number): { x: number; y: number } {
  for (let y = 0; y < h; y++) {
    let l = -1,
      r = -1;
    for (let x = 0; x < w; x++)
      if (src[x + y * w]! > 0) {
        if (l < 0) l = x;
        r = x;
      }
    if (l >= 0 && r - l >= 2) return { x: (l + r) / 2, y };
  }
  return { x: w / 2, y: 0 };
}

/**
 * The sector every tile of the Turing test is cut to (decision 343): CAMUS sectors run from 11 to 20 cm deep and mostly
 * ±37° wide, the simulator's 16 cm and ±40°, so a frame's outline would tell the source. Both are cut to this, and a
 * clinical image whose own sector does not cover it is left out.
 */
export const COMMON_SECTOR = { radiusMm: 140, halfAngleDeg: 36 };

/** Depth (mm) and half-angle (°, the 99.5th percentile beyond 4 cm) of the lit sector of an apex-up image. */
export function sectorExtent(
  src: ArrayLike<number>,
  w: number,
  h: number,
  mmPerPx: readonly [number, number],
): { radiusMm: number; halfAngleDeg: number } {
  const a = sectorApex(src, w, h);
  let rmax = 0;
  const ang: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (src[x + y * w]! > 0) {
        const dx = (x - a.x) * mmPerPx[0],
          dy = (y - a.y) * mmPerPx[1];
        const r = Math.hypot(dx, dy);
        rmax = Math.max(rmax, r);
        if (r > 40) ang.push((Math.abs(Math.atan2(dx, dy)) * 180) / Math.PI);
      }
  ang.sort((x, y) => x - y);
  return { radiusMm: rmax, halfAngleDeg: ang.length ? ang[Math.floor(ang.length * 0.995)]! : 0 };
}

/** Whether an image's sector covers the common one. */
export function coversCommonSector(e: { radiusMm: number; halfAngleDeg: number }): boolean {
  return e.radiusMm >= COMMON_SECTOR.radiusMm && e.halfAngleDeg >= COMMON_SECTOR.halfAngleDeg;
}

/**
 * An apex-up image at `mmPerPx` (x, y) on the tile canvas, cut to COMMON_SECTOR. The apex is found once per clip (`apex`) so a sequence does
 * not jitter when the first rows change.
 */
export function toTile(
  src: ArrayLike<number>,
  w: number,
  h: number,
  mmPerPx: readonly [number, number],
  apex = sectorApex(src, w, h),
): Grey {
  const out = new Uint8Array(TILE_W * TILE_H);
  const sx = TILE_MM_PER_PX / mmPerPx[0],
    sy = TILE_MM_PER_PX / mmPerPx[1];
  const rMax = COMMON_SECTOR.radiusMm / TILE_MM_PER_PX,
    tanMax = Math.tan((COMMON_SECTOR.halfAngleDeg * Math.PI) / 180);
  for (let ty = 0; ty < TILE_H; ty++)
    for (let tx = 0; tx < TILE_W; tx++) {
      const u = tx - TILE_W / 2,
        v = ty - 8;
      if (v <= 0 || Math.hypot(u, v) > rMax || Math.abs(u) > v * tanMax) continue;
      out[tx + ty * TILE_W] = Math.round(bilinear(src, w, h, apex.x + u * sx, apex.y + v * sy));
    }
  return { width: TILE_W, height: TILE_H, data: out };
}

/** Bounding box of the lit pixels. */
export function litBox(
  src: ArrayLike<number>,
  w: number,
  h: number,
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (src[x + y * w]! > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return { x0, y0, x1, y1 };
}

/** The bounding square of `box` (centred on it) resized to 112 × 112, as EchoNet's videos. */
export function toEchonet(
  src: ArrayLike<number>,
  w: number,
  h: number,
  box = litBox(src, w, h),
): Grey {
  const side = Math.max(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
  const cx = (box.x0 + box.x1) / 2,
    cy = (box.y0 + box.y1) / 2;
  const out = new Uint8Array(ECHONET_SIZE * ECHONET_SIZE);
  const s = side / ECHONET_SIZE;
  // area average of the source pixels each output pixel covers: a 640-px sector shrinks ~5×
  const taps = Math.max(1, Math.round(s));
  for (let y = 0; y < ECHONET_SIZE; y++)
    for (let x = 0; x < ECHONET_SIZE; x++) {
      let acc = 0;
      for (let j = 0; j < taps; j++)
        for (let i = 0; i < taps; i++)
          acc += bilinear(
            src,
            w,
            h,
            cx - side / 2 + (x + (i + 0.5) / taps) * s,
            cy - side / 2 + (y + (j + 0.5) / taps) * s,
          );
      out[x + y * ECHONET_SIZE] = Math.round(acc / (taps * taps));
    }
  return { width: ECHONET_SIZE, height: ECHONET_SIZE, data: out };
}

export function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

/** Grey frames to an H.264 MP4 at `fps` (yuv420p; the grey is untouched in luma). */
export function writeMp4(file: string, frames: readonly Grey[], fps: number): void {
  const { width, height } = frames[0]!;
  const raw = Buffer.concat(
    frames.map((f) => Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength)),
  );
  const r = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-s',
      `${width}x${height}`,
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      file,
    ],
    { input: raw, maxBuffer: 1 << 30 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${r.stderr?.toString() ?? ''}`);
}

export function writePngGrey(file: string, g: Grey): void {
  const rgba = new Uint8Array(g.width * g.height * 4);
  for (let i = 0; i < g.width * g.height; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g.data[i]!;
    rgba[i * 4 + 3] = 255;
  }
  writeFileSync(file, encodePng(g.width, g.height, rgba));
}

/** A video file as grey frames (ffprobe for its size and rate, ffmpeg for the frames). */
export function readVideoGrey(file: string): { frames: Grey[]; fps: number } {
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate',
      '-of',
      'csv=p=0',
      file,
    ],
    { encoding: 'utf8' },
  );
  if (probe.status !== 0) throw new Error(`ffprobe failed on ${file}`);
  const [w, h, rate] = probe.stdout.trim().split(',');
  const width = Number(w),
    height = Number(h);
  const [num, den] = (rate ?? '0/1').split('/').map(Number);
  const fps = (num ?? 0) / (den || 1);
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    {
      maxBuffer: 1 << 30,
    },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed reading ${file}`);
  const buf = r.stdout as Buffer;
  const size = width * height;
  const frames: Grey[] = [];
  for (let o = 0; o + size <= buf.length; o += size)
    frames.push({ width, height, data: new Uint8Array(buf.subarray(o, o + size)) });
  return { frames, fps };
}
