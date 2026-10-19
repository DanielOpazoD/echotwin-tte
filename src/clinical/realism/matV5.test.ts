import { describe, expect, it } from 'vitest';
import { field, numeric, parseMat, type MatValue } from './matV5';

/** A data element: tag (type, byte count) and data padded to 8 bytes. */
function el(type: number, data: Uint8Array): Uint8Array {
  const pad = (8 - (data.length % 8)) % 8;
  const out = new Uint8Array(8 + data.length + pad);
  const v = new DataView(out.buffer);
  v.setUint32(0, type, true);
  v.setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const i32 = (...v: number[]) => new Uint8Array(Int32Array.from(v).buffer);
const f64 = (...v: number[]) => new Uint8Array(Float64Array.from(v).buffer);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
/** A miMATRIX of class `cls` (6 double, 4 char, 2 struct, 9 uint8 stored as uint8) with its body elements. */
const matrix = (cls: number, dims: number[], name: string, ...body: Uint8Array[]) =>
  el(14, cat(el(6, i32(cls, 0)), el(5, i32(...dims)), el(1, ascii(name)), ...body));

const header = new Uint8Array(128);
// bmode = struct('grid', [1 2 3; 4 5 6], 'id_ED', uint8(7), 'label', 'ab')
const names = new Uint8Array(3 * 8);
['grid', 'id_ED', 'label'].forEach((n, i) => names.set(ascii(n), i * 8));
const bmode = matrix(
  2,
  [1, 1],
  'bmode',
  el(5, i32(8)),
  el(1, names),
  matrix(6, [2, 3], '', el(9, f64(1, 4, 2, 5, 3, 6))),
  matrix(9, [1, 1], '', el(2, Uint8Array.of(7))),
  matrix(4, [1, 2], '', el(4, new Uint8Array(Uint16Array.from([97, 98]).buffer))),
);

describe('parseMat', () => {
  it('reads a struct of a numeric matrix (column-major), a small integer and a string', () => {
    const m = parseMat(cat(header, bmode), (b) => b);
    const b = m['bmode'];
    const grid = numeric(field(b, 'grid'));
    expect(grid.dims).toEqual([2, 3]);
    expect(Array.from(grid.data)).toEqual([1, 4, 2, 5, 3, 6]);
    expect(numeric(field(b, 'id_ED')).data[0]).toBe(7);
    expect((field(b, 'label') as Extract<MatValue, { kind: 'char' }>).text).toBe('ab');
  });
  it('reads a compressed variable through the inflate it is given', () => {
    const compressed = el(15, bmode);
    let calls = 0;
    const m = parseMat(cat(header, compressed), (b) => {
      calls++;
      return b;
    });
    expect(calls).toBe(1);
    expect(Array.from(numeric(field(m['bmode'], 'grid')).data)).toEqual([1, 4, 2, 5, 3, 6]);
  });
  it('names a missing field', () => {
    const m = parseMat(cat(header, bmode), (b) => b);
    expect(() => field(m['bmode'], 'meshes')).toThrow(/meshes/);
  });
});
