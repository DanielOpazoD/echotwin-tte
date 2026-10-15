/**
 * Minimal animated GIF encoder (GIF89a, one global 256-colour table, LZW, infinite loop), with no dependency, for the
 * review clips (decision 329). A GIF holds 256 colours per image and delays in hundredths of a second: the palette is
 * built by `buildPalette` from the colours a clip is known to draw, and a cadence the delay grid cannot express exactly
 * (40 fps = 2.5 cs) is kept on average by alternating delays (`delaysFor`).
 */

export interface GifPalette {
  /** 256 × RGB. */
  table: Uint8Array;
  /** Number of grey levels (equally spaced 0…255) at the start of the table; chromatic colours follow. */
  greys: number;
  /** Chromatic colours of the table, as 0xRRGGBB, in table order after the greys. */
  colours: number[];
  /** Maps an RGBA canvas to palette indices: greys by the nearest level, other colours by the nearest entry. */
  index(rgba: Uint8ClampedArray, out?: Uint8Array): Uint8Array;
}

/**
 * A palette of `colours` (0xRRGGBB, the non-grey colours a clip draws: the map's structures and tissues, dimmed or
 * not, the captions) and as many equally spaced grey levels as the remaining entries allow. The echo image is grey, so
 * it keeps 256 − colours levels; a colour outside the list is replaced by its nearest entry.
 */
export function buildPalette(colours: Iterable<number>): GifPalette {
  const chroma = [...new Set(colours)].filter((c) => !isGrey(c));
  if (chroma.length > 240) throw new Error(`too many colours for a GIF palette: ${chroma.length}`);
  const greys = 256 - chroma.length;
  const table = new Uint8Array(768);
  for (let i = 0; i < greys; i++) {
    const g = Math.round((255 * i) / (greys - 1));
    table[3 * i] = g;
    table[3 * i + 1] = g;
    table[3 * i + 2] = g;
  }
  chroma.forEach((c, k) => {
    table[3 * (greys + k)] = (c >> 16) & 255;
    table[3 * (greys + k) + 1] = (c >> 8) & 255;
    table[3 * (greys + k) + 2] = c & 255;
  });
  const cache = new Map<number, number>();
  const nearest = (c: number): number => {
    let hit = cache.get(c);
    if (hit !== undefined) return hit;
    const r = (c >> 16) & 255,
      g = (c >> 8) & 255,
      b = c & 255;
    let best = 0,
      d2 = Infinity;
    for (let i = 0; i < 256; i++) {
      const d =
        (r - table[3 * i]!) ** 2 + (g - table[3 * i + 1]!) ** 2 + (b - table[3 * i + 2]!) ** 2;
      if (d < d2) {
        d2 = d;
        best = i;
      }
    }
    hit = best;
    cache.set(c, hit);
    return hit;
  };
  const k = (greys - 1) / 255;
  return {
    table,
    greys,
    colours: chroma,
    index(rgba, out = new Uint8Array(rgba.length / 4)) {
      for (let p = 0, o = 0; p < out.length; p++, o += 4) {
        const r = rgba[o]!,
          g = rgba[o + 1]!,
          b = rgba[o + 2]!;
        out[p] = r === g && g === b ? Math.round(r * k) : nearest((r << 16) | (g << 8) | b);
      }
      return out;
    },
  };
}

function isGrey(c: number): boolean {
  const r = (c >> 16) & 255,
    g = (c >> 8) & 255,
    b = c & 255;
  return r === g && g === b;
}

/**
 * Frame delays in hundredths of a second for `n` frames at `fps`: the exact grid value when the cadence sits on it
 * (20 fps = 5 cs), otherwise the two neighbouring values alternated so the clip's total time is kept on average
 * (40 fps = 2.5 cs → 2, 3, 2, 3…; the jitter is 5 ms). Browsers play delays under 2 cs as 10 cs, so a cadence above
 * 50 fps is refused.
 */
export function delaysFor(n: number, fps: number): number[] {
  const cs = 100 / fps;
  if (cs < 2) throw new Error(`GIF cannot play ${fps} fps (minimum delay 2 cs)`);
  const lo = Math.floor(cs),
    hi = Math.ceil(cs);
  const out: number[] = [];
  let acc = 0; // accumulated error against the exact cadence
  for (let i = 0; i < n; i++) {
    const want = cs * (i + 1);
    const d = acc + lo < want - 1e-9 ? hi : lo;
    acc += d;
    out.push(d);
  }
  return out;
}

/** Encodes an animated GIF: all frames full-size, drawn in place (no disposal), looping forever. */
export function encodeGif(
  width: number,
  height: number,
  palette: GifPalette,
  frames: Uint8Array[],
  delaysCs: number[],
): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from('GIF89a', 'ascii'));
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0xf7; // global colour table, 8 bits per channel, 256 entries
  lsd[5] = 0;
  lsd[6] = 0;
  parts.push(lsd, Buffer.from(palette.table));
  parts.push(
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'ascii'),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  );
  frames.forEach((f, i) => {
    const gce = Buffer.alloc(8);
    gce[0] = 0x21;
    gce[1] = 0xf9;
    gce[2] = 0x04;
    gce[3] = 0x04; // disposal 1 (leave in place), no transparency
    gce.writeUInt16LE(delaysCs[i] ?? delaysCs[delaysCs.length - 1] ?? 5, 4);
    gce[6] = 0;
    gce[7] = 0;
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(0, 1);
    desc.writeUInt16LE(0, 3);
    desc.writeUInt16LE(width, 5);
    desc.writeUInt16LE(height, 7);
    desc[9] = 0; // no local colour table, not interlaced
    parts.push(gce, desc, Buffer.from([8]), lzw(f), Buffer.from([0]));
  });
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

/** LZW of 8-bit indices (minimum code size 8), packed little-endian in 255-byte sub-blocks. */
function lzw(indices: Uint8Array): Buffer {
  const CLEAR = 256,
    EOI = 257;
  const out = Buffer.alloc(indices.length + (indices.length >> 6) + 64);
  let outLen = 0;
  const block = Buffer.alloc(255);
  let blockLen = 0;
  let bitBuf = 0,
    bitLen = 0;
  const flushBlock = () => {
    out[outLen++] = blockLen;
    block.copy(out, outLen, 0, blockLen);
    outLen += blockLen;
    blockLen = 0;
  };
  const emit = (code: number, size: number) => {
    bitBuf |= code << bitLen;
    bitLen += size;
    while (bitLen >= 8) {
      block[blockLen++] = bitBuf & 255;
      bitBuf >>>= 8;
      bitLen -= 8;
      if (blockLen === 255) flushBlock();
    }
  };
  // dictionary: key = prefix code << 8 | byte, kept in a hash table rebuilt at each clear
  const dict = new Map<number, number>();
  let next = 258,
    size = 9;
  emit(CLEAR, size);
  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i]!;
    const key = (prefix << 8) | c;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === 1 << size && size < 12) size++;
    } else {
      emit(CLEAR, size);
      dict.clear();
      next = 258;
      size = 9;
    }
    prefix = c;
  }
  emit(prefix, size);
  emit(EOI, size);
  if (bitLen > 0) {
    block[blockLen++] = bitBuf & 255;
    if (blockLen === 255) flushBlock();
  }
  if (blockLen > 0) flushBlock();
  return out.subarray(0, outLen);
}
