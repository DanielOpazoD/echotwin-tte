/**
 * A minimal reader of MATLAB level 5 MAT-files (compressed or not): numeric arrays, character arrays, structs and cells,
 * enough for the synthetic sequences the realism bench validates its tracker on (decision 349). Numeric data comes back
 * as Float64Array in MATLAB's column-major order with its dims. The bytes and the zlib inflation come from the caller,
 * so the parser stays free of Node.
 */

export type MatValue =
  | { kind: 'numeric'; dims: number[]; data: Float64Array }
  | { kind: 'char'; dims: number[]; text: string }
  | { kind: 'struct'; dims: number[]; fields: Record<string, MatValue>[] }
  | { kind: 'cell'; dims: number[]; cells: MatValue[] };

const MI_MATRIX = 14,
  MI_COMPRESSED = 15;

interface Element {
  type: number;
  data: Uint8Array;
}

const latin1 = (b: Uint8Array): string => String.fromCharCode(...b);
const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** The data elements of a buffer from `offset` to `end` (small elements packed in their tag, others padded to 8 bytes). */
function* elements(buf: Uint8Array, offset: number, end: number): Generator<Element> {
  const v = view(buf);
  let o = offset;
  while (o + 8 <= end) {
    const tag = v.getUint32(o, true);
    if (tag >>> 16) {
      const n = tag >>> 16;
      yield { type: tag & 0xffff, data: buf.subarray(o + 4, o + 4 + n) };
      o += 8;
    } else {
      const n = v.getUint32(o + 4, true);
      yield { type: tag, data: buf.subarray(o + 8, o + 8 + n) };
      o += 8 + n + ((8 - (n % 8)) % 8);
    }
  }
}

/** Numeric data of an element, whatever its storage type, as doubles. */
function numbers(e: Element): Float64Array {
  const d = view(e.data);
  const read: Record<number, [number, (o: number) => number]> = {
    1: [1, (o) => d.getInt8(o)],
    2: [1, (o) => d.getUint8(o)],
    3: [2, (o) => d.getInt16(o, true)],
    4: [2, (o) => d.getUint16(o, true)],
    5: [4, (o) => d.getInt32(o, true)],
    6: [4, (o) => d.getUint32(o, true)],
    7: [4, (o) => d.getFloat32(o, true)],
    9: [8, (o) => d.getFloat64(o, true)],
  };
  const r = read[e.type];
  if (!r) throw new Error(`MAT: tipo de dato ${e.type} no soportado`);
  const [size, get] = r;
  return Float64Array.from({ length: e.data.length / size }, (_, i) => get(i * size));
}

/** A miMATRIX element's contents (without its tag). */
function matrix(buf: Uint8Array): MatValue {
  const it = elements(buf, 0, buf.length);
  const flags = it.next().value as Element;
  const cls = flags.data[0]!;
  const dims = Array.from(numbers(it.next().value as Element));
  it.next(); // name
  const count = dims.reduce((a, b) => a * b, 1);
  if (cls === 2) {
    const len = numbers(it.next().value as Element)[0]!;
    const names = (it.next().value as Element).data;
    const fields: string[] = [];
    for (let i = 0; i < names.length; i += len)
      fields.push(latin1(names.subarray(i, i + len)).replace(/\0.*$/s, ''));
    const out: Record<string, MatValue>[] = [];
    for (let k = 0; k < count; k++) {
      const rec: Record<string, MatValue> = {};
      for (const f of fields) rec[f] = matrix((it.next().value as Element).data);
      out.push(rec);
    }
    return { kind: 'struct', dims, fields: out };
  }
  if (cls === 1)
    return {
      kind: 'cell',
      dims,
      cells: Array.from({ length: count }, () => matrix((it.next().value as Element).data)),
    };
  const real = it.next().value as Element | undefined;
  if (cls === 4)
    return {
      kind: 'char',
      dims,
      text: real ? String.fromCharCode(...numbers(real)) : '',
    };
  return { kind: 'numeric', dims, data: real ? numbers(real) : new Float64Array(0) };
}

/** The named variables of a MAT-file's bytes; `inflate` undoes zlib (Node: `zlib.inflateSync`). */
export function parseMat(
  file: Uint8Array,
  inflate: (b: Uint8Array) => Uint8Array,
): Record<string, MatValue> {
  const out: Record<string, MatValue> = {};
  for (const e of elements(file, 128, file.length)) {
    const body = e.type === MI_COMPRESSED ? inflate(e.data) : e.data;
    const inner = e.type === MI_COMPRESSED ? [...elements(body, 0, body.length)] : [e];
    for (const m of inner) {
      if (m.type !== MI_MATRIX) continue;
      const it = elements(m.data, 0, m.data.length);
      it.next();
      it.next();
      const name = latin1((it.next().value as Element).data);
      out[name] = matrix(m.data);
    }
  }
  return out;
}

/** A field of a 1×1 struct, or an error naming what is missing. */
export function field(v: MatValue | undefined, name: string): MatValue {
  if (!v || v.kind !== 'struct' || !v.fields[0]?.[name])
    throw new Error(`MAT: falta el campo «${name}»`);
  return v.fields[0][name];
}

export function numeric(v: MatValue): { dims: number[]; data: Float64Array } {
  if (v.kind !== 'numeric') throw new Error('MAT: se esperaba una matriz numérica');
  return v;
}
