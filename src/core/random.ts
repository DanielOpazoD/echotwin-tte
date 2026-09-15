/**
 * Deterministic PRNG (mulberry32) + hashing utilities. Every stochastic component of the
 * simulator (speckle, noise floor, clutter, RR variability) must derive from a seed so a case
 * can be replayed exactly (rule 8 of the specification).
 */
export interface Rng {
  next(): number; // [0,1)
  int(maxExclusive: number): number;
  range(lo: number, hi: number): number;
  gaussian(): number;
  readonly seed: number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  return {
    seed,
    next,
    int: (m) => Math.floor(next() * m),
    range: (lo, hi) => lo + (hi - lo) * next(),
    gaussian: () => {
      if (spare !== null) {
        const s = spare;
        spare = null;
        return s;
      }
      let u = 0,
        v = 0,
        s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * mul;
      return u * mul;
    },
  };
}

/** Integer hash (Wang / xxhash-like mixing) → [0,1). Deterministic per (x,y,z,seed). */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h =
    (Math.imul(x | 0, 0x8da6b343) ^
      Math.imul(y | 0, 0xd8163841) ^
      Math.imul(z | 0, 0xcb1ab31f) ^
      seed) >>>
    0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Stable 32-bit hash of a string (FNV-1a), used to derive sub-seeds from ids. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
