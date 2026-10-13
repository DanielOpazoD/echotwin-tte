/**
 * CLI: RODERO_DIR=<the atlas .tar.gz files, outside the repository> npx tsx tools/clinical/heart-atlas.ts [--out rows.json]
 *
 * Measures the left ventricle's long axis and the place of the valves in twenty four-chamber hearts segmented from
 * end-diastolic CT (Rodero et al., PLoS Comput Biol 2021;17:e1008851; Zenodo 4590294, CC-BY-4.0), to tell apart what
 * the whole-heart CT masks could not (decision 310): whether the aortic root sits high because the ventricle's axis is
 * too steep or because the root sits high on the ventricle. Each heart is unpacked to a temporary folder, read and
 * deleted; only aggregates are printed.
 *
 * The meshes are in CT coordinates, LPS (+x left, +y posterior, +z superior; checked on the anatomy: the right atrium
 * lies to the right of the left ventricle, the right ventricle in front of the left atrium, the aorta above). Labels
 * (Strocchi/Rodero convention): 1 LV, 2 RV, 3 LA, 4 RA, 5 aorta, 6 pulmonary artery, 7 mitral, 8 tricuspid, 9 aortic and
 * 10 pulmonary valve planes. The simulator's torso frame is +x left, +y superior, +z anterior: x = x, y = z, z = −y.
 *
 * Per heart: the LV apex (the LV point farthest from the mitral valve centre), the long axis from the mitral centre to it
 * (length, tilt below the horizontal, azimuth toward the left from straight ahead), the aortic valve centre's height above
 * the mitral centre (vertical, cm) and along the axis (toward the base, cm), and the root-to-apex axis as the chest CT tool
 * measures it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLabelledVtk } from './vtkMesh';

type V3 = [number, number, number];
const ROOT = process.env['RODERO_DIR'];
if (!ROOT || !existsSync(ROOT)) {
  console.error(
    'RODERO_DIR must point to the folder of the atlas .tar.gz files (outside the repository)',
  );
  process.exit(1);
}
const log = (line: string): void => void process.stdout.write(`${line}\n`);
const torso = (p: V3): V3 => [p[0], p[2], -p[1]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const deg = (r: number): number => (r * 180) / Math.PI;

interface Row {
  heart: string;
  lvAxisLength: number;
  lvAxisDownTiltDeg: number;
  lvAxisLeftTiltDeg: number;
  avAboveMv: number;
  avBasalToMvAlongAxis: number;
  avMvDistance: number;
  rootApexDownTiltDeg: number;
  rootApexLength: number;
}

async function measure(vtk: string, name: string): Promise<Row> {
  const m = await readLabelledVtk(vtk);
  const centroid = (label: number): V3 => {
    const s: V3 = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < m.pointLabel.length; i++)
      if (m.pointLabel[i] === label) {
        s[0] += m.points[3 * i]!;
        s[1] += m.points[3 * i + 1]!;
        s[2] += m.points[3 * i + 2]!;
        n++;
      }
    if (!n) throw new Error(`${name}: no label ${label}`);
    return torso([s[0] / n, s[1] / n, s[2] / n]);
  };
  const mv = centroid(7),
    av = centroid(9);
  // the LV apex: the LV point farthest from the mitral centre
  let apex: V3 = mv,
    far = -1;
  for (let i = 0; i < m.pointLabel.length; i++) {
    if (m.pointLabel[i] !== 1) continue;
    const p = torso([m.points[3 * i]!, m.points[3 * i + 1]!, m.points[3 * i + 2]!]);
    const d = len(sub(p, mv));
    if (d > far) {
      far = d;
      apex = p;
    }
  }
  const axis = sub(apex, mv); // base to apex
  const a = len(axis);
  const u: V3 = [axis[0] / a, axis[1] / a, axis[2] / a];
  const rootApex = sub(apex, av);
  const cm = (mm: number) => mm / 10;
  return {
    heart: name,
    lvAxisLength: cm(a),
    lvAxisDownTiltDeg: deg(Math.atan2(-u[1], Math.hypot(u[0], u[2]))),
    lvAxisLeftTiltDeg: deg(Math.atan2(u[0], u[2])),
    avAboveMv: cm(av[1] - mv[1]),
    avBasalToMvAlongAxis: cm(
      -(sub(av, mv)[0] * u[0] + sub(av, mv)[1] * u[1] + sub(av, mv)[2] * u[2]),
    ),
    avMvDistance: cm(len(sub(av, mv))),
    rootApexDownTiltDeg: deg(Math.atan2(-rootApex[1], Math.hypot(rootApex[0], rootApex[2]))),
    rootApexLength: cm(len(rootApex)),
  };
}

void (async () => {
  const files = readdirSync(ROOT)
    .filter((f) => /^\d+\.tar\.gz$/.test(f))
    .sort();
  const rows: Row[] = [];
  for (const f of files) {
    const dir = mkdtempSync(join(tmpdir(), 'rodero-'));
    try {
      execFileSync('tar', ['-xzf', join(ROOT, f), '-C', dir]);
      const vtk = readdirSync(dir).find((x) => x.endsWith('.vtk'));
      if (!vtk) throw new Error(`${f}: no .vtk inside`);
      rows.push(await measure(join(dir, vtk), f.replace('.tar.gz', '')));
      process.stderr.write(`${f} ok\n`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const metrics = Object.keys(rows[0] ?? {}).filter((k) => k !== 'heart') as (keyof Row)[];
  const q = (xs: number[], p: number) => {
    const s = [...xs].sort((x, y) => x - y);
    const at = (s.length - 1) * p,
      lo = Math.floor(at);
    return s[lo]! + (s[Math.min(s.length - 1, lo + 1)]! - s[lo]!) * (at - lo);
  };
  log(`${rows.length} hearts`);
  for (const k of metrics) {
    const xs = rows.map((r) => r[k] as number);
    log(
      `${k.padEnd(24)} median ${q(xs, 0.5).toFixed(2)}  IQR ${q(xs, 0.25).toFixed(2)}–${q(xs, 0.75).toFixed(2)}  range ${Math.min(...xs).toFixed(2)}–${Math.max(...xs).toFixed(2)}`,
    );
  }
  const out = process.argv.indexOf('--out');
  if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(rows, null, 1));
})();
