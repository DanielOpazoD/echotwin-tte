/**
 * Run-length code of a label volume (decision 352): the bytes of the volume in order (x fastest) as runs of
 * (label, length), the length as a little-endian base-128 varint. A heart's labels come in long runs along x, so the
 * shipped volume is a few hundred kilobytes where the raw one is megabytes. Pure: no store, no DOM.
 */

/** The runs of `labels`. */
export function encodeLabelRuns(labels: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < labels.length) {
    const l = labels[i]!;
    let n = 1;
    while (i + n < labels.length && labels[i + n] === l) n++;
    out.push(l);
    let m = n;
    while (m >= 0x80) {
      out.push((m & 0x7f) | 0x80);
      m >>>= 7;
    }
    out.push(m);
    i += n;
  }
  return Uint8Array.from(out);
}

/** The `count` labels coded in `runs`; throws when the code is short, long or holds an empty run. */
export function decodeLabelRuns(runs: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  let o = 0,
    p = 0;
  while (p < runs.length) {
    const l = runs[p++]!;
    let n = 0,
      shift = 0;
    for (;;) {
      if (p >= runs.length) throw new Error('label runs: truncated length');
      const b = runs[p++]!;
      n += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) break;
      shift += 7;
    }
    if (n === 0) throw new Error('label runs: empty run');
    // a run past the end leaves the count off: the check below refuses it
    out.fill(l, o, o + n);
    o += n;
  }
  if (o !== count) throw new Error(`label runs: ${o} labels for ${count}`);
  return out;
}
