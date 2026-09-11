import type { PolarFrameSpec } from './types';

/**
 * Sector scan conversion: polar (line, sample) → cartesian RGBA. Apex at top-centre, radius = depth.
 * A lookup table (bilinear indices + weights + polar coordinates per pixel) is built once per
 * mapping and reused, so per-frame work is a gather. The mapping is also the single source of the
 * pixel↔cm geometry used by calipers and overlays.
 */
export interface SectorMapping {
  apexX: number;
  apexY: number;
  pxPerCm: number;
  width: number;
  height: number;
  sectorRad: number;
  depthCm: number;
  invertLR: boolean;
}

export function computeSectorMapping(spec: PolarFrameSpec, width: number, height: number, invertLR: boolean, zoom = 1): SectorMapping {
  const margin = 14;
  const usableH = height - margin * 2;
  const halfAngle = spec.sectorRad / 2;
  const usableW = width - margin * 2;
  const pxByH = usableH / spec.depthCm;
  const pxByW = usableW / (2 * spec.depthCm * Math.sin(halfAngle));
  const pxPerCm = Math.min(pxByH, pxByW) * zoom;
  return { apexX: width / 2, apexY: margin, pxPerCm, width, height, sectorRad: spec.sectorRad, depthCm: spec.depthCm, invertLR };
}

export function pixelToPolar(m: SectorMapping, px: number, py: number): { rCm: number; thetaRad: number } {
  const dx = (px - m.apexX) * (m.invertLR ? -1 : 1);
  const dy = py - m.apexY;
  return { rCm: Math.hypot(dx, dy) / m.pxPerCm, thetaRad: Math.atan2(dx, dy) };
}

export function polarToPixel(m: SectorMapping, rCm: number, thetaRad: number): { x: number; y: number } {
  const dx = rCm * m.pxPerCm * Math.sin(thetaRad) * (m.invertLR ? -1 : 1);
  const dy = rCm * m.pxPerCm * Math.cos(thetaRad);
  return { x: m.apexX + dx, y: m.apexY + dy };
}

export interface ScanLut {
  key: string;
  idx: Int32Array; // polar index of the (l0,s0) corner, −1 outside the sector
  /** Compact gather lists over the pixels inside the sector (per-frame fast path). */
  inPix: Int32Array; // pixel index
  inIdx: Int32Array; // polar index of the (l0,s0) corner
  inWl: Uint16Array; // line weight × 1024
  inWs: Uint16Array; // sample weight × 1024
  inDl: Uint8Array; // 1 when a next line exists and carries weight
  inDs: Uint8Array; // 1 when a next sample exists and carries weight
  wl: Float32Array; // line interpolation weight
  ws: Float32Array; // sample interpolation weight
  li: Int16Array; // nearest line index (for colour/masks)
  si: Int16Array; // nearest sample index
  rCm: Float32Array;
  theta: Float32Array;
  samples: number;
  lines: number;
}

export function lutKey(spec: PolarFrameSpec, m: SectorMapping): string {
  return `${spec.lines}x${spec.samples}|${spec.sectorRad.toFixed(4)}|${spec.depthCm}|${m.width}x${m.height}|${m.pxPerCm.toFixed(3)}|${m.invertLR ? 1 : 0}`;
}

export function buildScanLut(spec: PolarFrameSpec, m: SectorMapping): ScanLut {
  const { lines, samples, sectorRad, depthCm } = spec;
  const half = sectorRad / 2;
  const w = m.width,
    h = m.height;
  const n = w * h;
  const idx = new Int32Array(n).fill(-1);
  const wl = new Float32Array(n);
  const ws = new Float32Array(n);
  const li = new Int16Array(n);
  const si = new Int16Array(n);
  const rArr = new Float32Array(n);
  const thArr = new Float32Array(n);
  const inPix = new Int32Array(n);
  const inIdx = new Int32Array(n);
  const inWl = new Uint16Array(n);
  const inWs = new Uint16Array(n);
  const inDl = new Uint8Array(n);
  const inDs = new Uint8Array(n);
  let count = 0;
  const invPx = 1 / m.pxPerCm;
  const maxR = depthCm;
  const tanHalf = Math.tan(half);
  for (let y = 0; y < h; y++) {
    const dy = y - m.apexY;
    if (dy < 0) continue;
    const xLimit = dy * tanHalf;
    for (let x = 0; x < w; x++) {
      let dx = x - m.apexX;
      if (m.invertLR) dx = -dx;
      if (dx > xLimit || dx < -xLimit) continue;
      const r = Math.sqrt(dx * dx + dy * dy) * invPx;
      if (r > maxR) continue;
      const th = Math.atan2(dx, dy);
      if (th < -half || th > half) continue;
      const p = y * w + x;
      const lf = ((th + half) / sectorRad) * lines - 0.5;
      const sf = (r / depthCm) * samples - 0.5;
      let l0 = Math.floor(lf),
        s0 = Math.floor(sf);
      let lt = lf - l0,
        st = sf - s0;
      if (l0 < 0) {
        l0 = 0;
        lt = 0;
      }
      if (s0 < 0) {
        s0 = 0;
        st = 0;
      }
      if (l0 >= lines - 1) {
        l0 = lines - 1;
        lt = 0;
      }
      if (s0 >= samples - 1) {
        s0 = samples - 1;
        st = 0;
      }
      idx[p] = l0 * samples + s0;
      wl[p] = lt;
      ws[p] = st;
      // 10-bit fixed-point weights keep the whole bilinear sum inside int32 (255·1024² < 2³¹)
      const wlQ = Math.floor(lt * 1024);
      const wsQ = Math.floor(st * 1024);
      inPix[count] = p;
      inIdx[count] = l0 * samples + s0;
      inWl[count] = wlQ;
      inWs[count] = wsQ;
      inDl[count] = wlQ > 0 && l0 < lines - 1 ? 1 : 0;
      inDs[count] = wsQ > 0 && s0 < samples - 1 ? 1 : 0;
      count++;
      li[p] = Math.min(lines - 1, Math.round(lf));
      si[p] = Math.min(samples - 1, Math.round(sf));
      rArr[p] = r;
      thArr[p] = th;
    }
  }
  return {
    key: lutKey(spec, m),
    idx,
    wl,
    ws,
    li,
    si,
    rCm: rArr,
    theta: thArr,
    samples,
    lines,
    inPix: inPix.slice(0, count),
    inIdx: inIdx.slice(0, count),
    inWl: inWl.slice(0, count),
    inWs: inWs.slice(0, count),
    inDl: inDl.slice(0, count),
    inDs: inDs.slice(0, count),
  };
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * Gather polar intensities into RGBA using a prebuilt LUT. Pixels outside the sector are black.
 * Fast path: one native fill for the background and a fixed-point bilinear gather over the in-sector
 * list written as 32-bit pixels (≤ 1 gray level from the float reference).
 */
export function scanConvertLut(polar: Uint8ClampedArray, lut: ScanLut, rgba: Uint8ClampedArray): void {
  const n = lut.idx.length;
  if (LITTLE_ENDIAN && rgba.byteOffset % 4 === 0 && rgba.length >= n * 4) {
    const px = new Uint32Array(rgba.buffer, rgba.byteOffset, n);
    px.fill(0xff000000);
    const S = lut.samples;
    const { inPix, inIdx, inWl, inWs, inDl, inDs } = lut;
    const m = inPix.length;
    for (let k = 0; k < m; k++) {
      const i = inIdx[k]!;
      const dl = inDl[k]! * S;
      const ds = inDs[k]!;
      const lt = inWl[k]!;
      const st = inWs[k]!;
      const v00 = polar[i]!;
      const v10 = polar[i + dl]!;
      const v01 = polar[i + ds]!;
      const v11 = polar[i + dl + ds]!;
      const g = ((v00 * (1024 - lt) + v10 * lt) * (1024 - st) + (v01 * (1024 - lt) + v11 * lt) * st) >>> 20;
      px[inPix[k]!] = (0xff000000 | (g * 0x010101)) >>> 0;
    }
    return;
  }
  scanConvertLutReference(polar, lut, rgba);
}

/** Float bilinear gather (reference for the fast path and fallback on big-endian hosts). */
export function scanConvertLutReference(polar: Uint8ClampedArray, lut: ScanLut, rgba: Uint8ClampedArray): void {
  const n = lut.idx.length;
  const S = lut.samples;
  const lines = lut.lines;
  for (let p = 0, o = 0; p < n; p++, o += 4) {
    const i = lut.idx[p] ?? -1;
    if (i < 0) {
      rgba[o] = 0;
      rgba[o + 1] = 0;
      rgba[o + 2] = 0;
      rgba[o + 3] = 255;
      continue;
    }
    const lt = lut.wl[p] ?? 0,
      st = lut.ws[p] ?? 0;
    const hasL = lt > 0 && i + S < lines * S;
    const v00 = polar[i] ?? 0;
    const v01 = st > 0 ? (polar[i + 1] ?? v00) : v00;
    const v10 = hasL ? (polar[i + S] ?? v00) : v00;
    const v11 = hasL && st > 0 ? (polar[i + S + 1] ?? v10) : v10;
    const g = ((v00 * (1 - lt) + v10 * lt) * (1 - st) + (v01 * (1 - lt) + v11 * lt) * st) | 0;
    rgba[o] = g;
    rgba[o + 1] = g;
    rgba[o + 2] = g;
    rgba[o + 3] = 255;
  }
}

/** Reference (LUT-free) implementation, kept for tests and offline tools. */
export function scanConvert(polar: Uint8ClampedArray, spec: PolarFrameSpec, m: SectorMapping, rgba: Uint8ClampedArray): void {
  const lut = buildScanLut(spec, m);
  scanConvertLut(polar, lut, rgba);
}
