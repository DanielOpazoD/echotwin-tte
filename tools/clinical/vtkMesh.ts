/**
 * Reader for the ASCII legacy VTK unstructured grids of the four-chamber heart atlas (Rodero et al., PLoS Comput Biol
 * 2021;17:e1008851; Zenodo 4590294): the points (mm, CT coordinates), the tetrahedra and the integer label of each cell.
 * Streams the file line by line: a heart is ~260 MB of text.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface LabelledMesh {
  points: Float64Array; // x, y, z per point
  /** for each point, the label of one cell that uses it (the last read) */
  pointLabel: Int32Array;
}

export async function readLabelledVtk(path: string): Promise<LabelledMesh> {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let section: 'none' | 'points' | 'cells' | 'types' | 'ids' = 'none';
  let points = new Float64Array(0),
    pi = 0;
  let cells: Int32Array[] = [];
  let ci = 0,
    nCells = 0,
    idi = 0;
  let pointLabel = new Int32Array(0);
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('POINTS')) {
      points = new Float64Array(3 * Number(line.split(/\s+/)[1]));
      pointLabel = new Int32Array(points.length / 3).fill(-1);
      section = 'points';
      continue;
    }
    if (line.startsWith('CELLS')) {
      nCells = Number(line.split(/\s+/)[1]);
      cells = new Array<Int32Array>(nCells);
      section = 'cells';
      continue;
    }
    if (line.startsWith('CELL_TYPES')) {
      section = 'types';
      continue;
    }
    if (line.startsWith('SCALARS ID')) {
      section = 'ids';
      continue;
    }
    if (line.startsWith('LOOKUP_TABLE')) continue;
    if (line.startsWith('CELL_DATA')) {
      section = 'none';
      continue;
    }
    if (line.startsWith('POINT_DATA') || line.startsWith('SCALARS')) {
      if (section === 'ids') break;
      section = 'none';
      continue;
    }
    if (section === 'points') {
      for (const v of line.split(/\s+/)) points[pi++] = Number(v);
    } else if (section === 'cells') {
      const parts = line.split(/\s+/).map(Number);
      cells[ci++] = Int32Array.from(parts.slice(1));
    } else if (section === 'ids') {
      for (const v of line.split(/\s+/)) {
        const label = Number(v);
        const c = cells[idi++];
        if (c) for (const p of c) pointLabel[p] = label;
      }
    }
  }
  return { points, pointLabel };
}
