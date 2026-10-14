/**
 * CLI: RODERO_DIR=<the atlas .tar.gz files, outside the repository> npx tsx tools/clinical/heart-atlas.ts [--out rows.json]
 *        [--reference-out src/clinical/reference-values/heartAtlas.ts]
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
 *
 * Positions and vessels (decision 322), in a frame built from the anatomy alone so that the model is measured the same way
 * (`atlasFrame.ts`): origin the mitral valve centre, z toward the LV apex, x from the tricuspid centre toward the mitral
 * one (septal to lateral) square to z, y = z × x turned toward the aortic valve (anterior). The myocardium centroid of
 * each chamber and the valve centres in that frame, over the LV length; and the direction of each vessel where the
 * atlas cut it, the normal of its border ring pointing away from its atrium. Ring labels 18-24 were checked against the
 * inlets they surround (each ring within 1 cm of its inlet): 18 appendage, 19 left superior vein, 20 left inferior,
 * 21 right inferior, 22 right superior, 23 superior and 24 inferior vena cava (the record lists 19 and 21 the other
 * way round).
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

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V3): V3 => scale(a, 1 / len(a));
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** Rings around the cut vessels (label → vessel, atrium label it leaves). */
const RINGS: [number, string, number][] = [
  [18, 'appendage', 3],
  [19, 'leftSuperiorVein', 3],
  [20, 'leftInferiorVein', 3],
  [21, 'rightInferiorVein', 3],
  [22, 'rightSuperiorVein', 3],
  [23, 'superiorVenaCava', 4],
  [24, 'inferiorVenaCava', 4],
];
const CHAMBERS: [number, string][] = [
  [2, 'rightVentricle'],
  [3, 'leftAtrium'],
  [4, 'rightAtrium'],
  [9, 'aorticValve'],
  [10, 'pulmonaryValve'],
  [8, 'tricuspidValve'],
];
interface Marks {
  /** Centroids in the anatomical frame over the LV length (x septal→lateral, y anterior, z toward the apex). */
  positions: Record<string, V3>;
  /** Unit direction of each cut vessel in the anatomical frame. */
  vessels: Record<string, V3>;
}

/** Smallest principal axis of a point set (inverse power iteration on its scatter matrix). */
function ringNormal(pts: V3[]): V3 {
  const c = scale(
    pts.reduce<V3>((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]),
    1 / pts.length,
  );
  const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = sub(p, c);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[3 * a + b]! += d[a]! * d[b]!;
  }
  for (let a = 0; a < 3; a++) M[4 * a]! += 1e-6;
  const [a, b, cc, d, e, f, g, h, i] = M as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + cc * (d * h - e * g);
  const inv = [
    (e * i - f * h) / det,
    (cc * h - b * i) / det,
    (b * f - cc * e) / det,
    (f * g - d * i) / det,
    (a * i - cc * g) / det,
    (cc * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  let v: V3 = [1, 0.3, 0.2];
  for (let it = 0; it < 60; it++)
    v = unit([
      inv[0]! * v[0] + inv[1]! * v[1] + inv[2]! * v[2],
      inv[3]! * v[0] + inv[4]! * v[1] + inv[5]! * v[2],
      inv[6]! * v[0] + inv[7]! * v[1] + inv[8]! * v[2],
    ]);
  return v;
}

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

async function measure(vtk: string, name: string): Promise<{ row: Row; marks: Marks }> {
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
  // the anatomical frame (decision 322)
  const tv = centroid(8);
  let ex = sub(mv, tv);
  ex = unit(sub(ex, scale(u, dot(ex, u))));
  let ey = cross(u, ex);
  if (dot(sub(av, mv), ey) < 0) ey = scale(ey, -1);
  const local = (p: V3): V3 => {
    const d = sub(p, mv);
    return [dot(d, ex) / a, dot(d, ey) / a, dot(d, u) / a];
  };
  const positions: Record<string, V3> = {};
  for (const [label, key] of CHAMBERS) positions[key] = local(centroid(label));
  const vessels: Record<string, V3> = {};
  for (const [label, key, atrium] of RINGS) {
    const pts: V3[] = [];
    for (let i = 0; i < m.pointLabel.length; i++)
      if (m.pointLabel[i] === label)
        pts.push(torso([m.points[3 * i]!, m.points[3 * i + 1]!, m.points[3 * i + 2]!]));
    if (pts.length < 10) continue;
    let n = ringNormal(pts);
    const c = scale(
      pts.reduce<V3>((s0, p) => [s0[0] + p[0], s0[1] + p[1], s0[2] + p[2]], [0, 0, 0]),
      1 / pts.length,
    );
    if (dot(n, sub(c, centroid(atrium))) < 0) n = scale(n, -1);
    vessels[key] = [dot(n, ex), dot(n, ey), dot(n, u)];
  }
  const marks: Marks = { positions, vessels };
  const row: Row = {
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
  return { row, marks };
}

void (async () => {
  const files = readdirSync(ROOT)
    .filter((f) => /^\d+\.tar\.gz$/.test(f))
    .sort();
  const rows: Row[] = [];
  const allMarks: Marks[] = [];
  for (const f of files) {
    const dir = mkdtempSync(join(tmpdir(), 'rodero-'));
    try {
      execFileSync('tar', ['-xzf', join(ROOT, f), '-C', dir]);
      const vtk = readdirSync(dir).find((x) => x.endsWith('.vtk'));
      if (!vtk) throw new Error(`${f}: no .vtk inside`);
      const r = await measure(join(dir, vtk), f.replace('.tar.gz', ''));
      rows.push(r.row);
      allMarks.push(r.marks);
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
  // positions (over the LV length) and vessel directions (decision 322)
  const dist = (xs: number[]) => ({
    n: xs.length,
    p10: +q(xs, 0.1).toFixed(3),
    median: +q(xs, 0.5).toFixed(3),
    p90: +q(xs, 0.9).toFixed(3),
  });
  const positions: Record<string, Record<'x' | 'y' | 'z', ReturnType<typeof dist>>> = {};
  for (const [, key] of CHAMBERS) {
    const ps = allMarks.map((mk) => mk.positions[key]!).filter(Boolean);
    positions[key] = {
      x: dist(ps.map((p) => p[0])),
      y: dist(ps.map((p) => p[1])),
      z: dist(ps.map((p) => p[2])),
    };
    log(
      `${key.padEnd(24)} x ${positions[key]!.x.median}  y ${positions[key]!.y.median}  z ${positions[key]!.z.median}`,
    );
  }
  const vessels: Record<string, { n: number; mean: V3; p90Deg: number; maxDeg: number }> = {};
  for (const [, key] of RINGS) {
    const ds = allMarks.map((mk) => mk.vessels[key]).filter((d): d is V3 => !!d);
    const mean = unit(
      ds.reduce<V3>((s0, d) => [s0[0] + d[0], s0[1] + d[1], s0[2] + d[2]], [0, 0, 0]),
    );
    const angles = ds.map((d) => deg(Math.acos(Math.max(-1, Math.min(1, dot(d, mean))))));
    vessels[key] = {
      n: ds.length,
      mean: mean.map((c) => +c.toFixed(3)) as V3,
      p90Deg: +q(angles, 0.9).toFixed(1),
      maxDeg: +Math.max(...angles).toFixed(1),
    };
    log(
      `${key.padEnd(24)} mean ${vessels[key]!.mean.join(', ')}  spread P90 ${vessels[key]!.p90Deg}° max ${vessels[key]!.maxDeg}°`,
    );
  }
  const refOut = process.argv.indexOf('--reference-out');
  if (refOut >= 0)
    writeFileSync(
      process.argv[refOut + 1]!,
      `/**
 * Positions and vessel directions of twenty healthy four-chamber hearts (decision 322), generated by
 * tools/clinical/heart-atlas.ts from the end-diastolic CT atlas of Rodero et al. (PLoS Comput Biol 2021;17:e1008851;
 * Zenodo 4590294, CC-BY-4.0). Aggregates only. Frame from the anatomy (atlasFrame.ts): origin the mitral valve centre,
 * z toward the LV apex, x from the tricuspid centre toward the mitral one, y toward the aortic valve; positions are
 * myocardium or valve-plane centroids over the LV length, vessels the direction where the atlas cut them.
 * Do not edit by hand; regenerate with the tool and format with Prettier.
 */
export interface AtlasDistribution {
  n: number;
  p10: number;
  median: number;
  p90: number;
}
export interface AtlasVessel {
  n: number;
  mean: readonly [number, number, number];
  p90Deg: number;
  maxDeg: number;
}

export const HEART_ATLAS_POSITIONS: Record<string, Record<'x' | 'y' | 'z', AtlasDistribution>> = ${JSON.stringify(positions)};

export const HEART_ATLAS_VESSELS: Record<string, AtlasVessel> = ${JSON.stringify(vessels)};
`,
    );
  const out = process.argv.indexOf('--out');
  if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(rows, null, 1));
})();
