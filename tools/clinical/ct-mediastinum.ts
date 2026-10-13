/**
 * CLI: TOTALSEG_DIR=<TotalSegmentator dataset, outside the repository> npx tsx tools/clinical/ct-mediastinum.ts
 *        [--limit N] [--out rows.json] [--reference-out src/clinical/reference-values/ctMediastinum.ts]
 *
 * Measures the base of the heart and the mediastinum on CT (decision 307): the anatomy the simulator's root, great
 * vessels and thorax are placed by, read from segmented volumes instead of single published numbers. Source: the small
 * subset of the TotalSegmentator dataset (Wasserthal et al., Radiol Artif Intell 2023;5:e230024; Zenodo 10047263,
 * CC-BY-4.0): CT volumes with one mask per structure. Only aggregated statistics leave this tool — the volumes stay
 * where they are, and `--out` writes per-subject numbers to a file outside the repository.
 *
 * World space is NIfTI's RAS+ (mm): +X the subject's right, +Y anterior, +Z superior. The simulator's torso frame is
 * +x left, +y superior, +z anterior; the conversion is x = −X, y = Z, z = Y (cm).
 *
 * Per subject whose volume holds the heart, the whole arch and the sternum:
 * - the carina (lowest point of the trachea): the level of the axial measurements, where the ascending and descending
 *   aorta appear as two sections (the level of the pulmonary bifurcation at which the ascending aorta is measured);
 * - at that level: the gap from the back of the sternum to the front of the ascending aorta, the depth of the ascending
 *   and descending centres and of the front of the vertebral body below the anterior skin, the arch's width (centre to
 *   centre) and the chest's anteroposterior diameter;
 * - the arch apex (the highest aortic voxels) and the suprasternal notch (the skin in front of the top of the manubrium):
 *   their distance, and the apex's drop and depth below the notch;
 * - the aortic root (the lowest aortic voxels): its depth below the anterior skin, and the direction of the first 4 cm
 *   of the ascending aorta (principal axis of its section centres) in the torso frame;
 * - the descending aorta at the level of the root, against its place at the carina: how far the posterior column comes
 *   forward toward the arch.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseNifti, voxelToWorld, type NiftiVolume } from '@/clinical/nifti';

type V3 = [number, number, number];

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ROOT = process.env['TOTALSEG_DIR'];
if (!ROOT || !existsSync(ROOT)) {
  console.error(
    'TOTALSEG_DIR must point to the unzipped TotalSegmentator dataset (outside the repository)',
  );
  process.exit(1);
}
const LIMIT = Number(opt('--limit') ?? Infinity);

const load = (path: string): NiftiVolume => {
  const raw = readFileSync(path);
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  return parseNifti(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
};

/** Inverse of the 3 × 4 affine: world mm → fractional voxel index. */
function inverseAffine(a: number[]): (w: V3) => V3 {
  const m = [a[0]!, a[1]!, a[2]!, a[4]!, a[5]!, a[6]!, a[8]!, a[9]!, a[10]!];
  const det =
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  const inv = [
    (m[4]! * m[8]! - m[5]! * m[7]!) / det,
    (m[2]! * m[7]! - m[1]! * m[8]!) / det,
    (m[1]! * m[5]! - m[2]! * m[4]!) / det,
    (m[5]! * m[6]! - m[3]! * m[8]!) / det,
    (m[0]! * m[8]! - m[2]! * m[6]!) / det,
    (m[2]! * m[3]! - m[0]! * m[5]!) / det,
    (m[3]! * m[7]! - m[4]! * m[6]!) / det,
    (m[1]! * m[6]! - m[0]! * m[7]!) / det,
    (m[0]! * m[4]! - m[1]! * m[3]!) / det,
  ];
  const t = [a[3]!, a[7]!, a[11]!];
  return (w) => {
    const d = [w[0] - t[0]!, w[1] - t[1]!, w[2] - t[2]!];
    return [
      inv[0]! * d[0]! + inv[1]! * d[1]! + inv[2]! * d[2]!,
      inv[3]! * d[0]! + inv[4]! * d[1]! + inv[5]! * d[2]!,
      inv[6]! * d[0]! + inv[7]! * d[1]! + inv[8]! * d[2]!,
    ];
  };
}

/** The world points (mm) of a mask's voxels, with the subject's axes. */
function maskPoints(vol: NiftiVolume): V3[] {
  const [nx, ny, nz] = vol.dims;
  const out: V3[] = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        if (vol.voxels[i + nx * (j + ny * k)]! > 0.5) out.push(voxelToWorld(vol, i, j, k));
  return out;
}

/** Largest and smallest of a coordinate, without spreading masks of 10⁵–10⁶ points into Math.max (stack overflow). */
const maxOf = (ps: V3[], a: 0 | 1 | 2): number => {
  let m = -Infinity;
  for (const p of ps) if (p[a] > m) m = p[a];
  return m;
};
const minOf = (ps: V3[], a: 0 | 1 | 2): number => {
  let m = Infinity;
  for (const p of ps) if (p[a] < m) m = p[a];
  return m;
};

const mean = (ps: V3[]): V3 => {
  const s: V3 = [0, 0, 0];
  for (const p of ps) for (let a = 0; a < 3; a++) s[a] = s[a]! + p[a]!;
  return [s[0] / ps.length, s[1] / ps.length, s[2] / ps.length];
};
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 2D connected components (8-neighbourhood) of points in one axial band, by grid hashing at `cell` mm. */
function components(points: V3[], cell: number): V3[][] {
  const key = (p: V3) => `${Math.round(p[0] / cell)},${Math.round(p[1] / cell)}`;
  const byKey = new Map<string, V3[]>();
  for (const p of points) {
    const k = key(p);
    const list = byKey.get(k);
    if (list) list.push(p);
    else byKey.set(k, [p]);
  }
  const seen = new Set<string>();
  const out: V3[][] = [];
  for (const start of byKey.keys()) {
    if (seen.has(start)) continue;
    const comp: V3[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(...byKey.get(k)!);
      const [cx, cy] = k.split(',').map(Number) as [number, number];
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const n = `${cx + dx},${cy + dy}`;
          if (!seen.has(n) && byKey.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Hounsfield units at a world point (mm), or null outside the volume. */
function huAt(ct: NiftiVolume, toVoxel: (w: V3) => V3, w: V3): number | null {
  const [nx, ny, nz] = ct.dims;
  const v = toVoxel(w).map(Math.round) as V3;
  if (v[0] < 0 || v[1] < 0 || v[2] < 0 || v[0] >= nx || v[1] >= ny || v[2] >= nz) return null;
  return ct.voxels[v[0] + nx * (v[1] + ny * v[2])]!;
}

/**
 * The anterior skin at (x, z): walking in from the front of the volume, the first 2 mm of soft tissue (HU > −300). From
 * the inside out a walk stopped at the first air it met, which was the lung.
 */
function frontSkin(
  ct: NiftiVolume,
  toVoxel: (w: V3) => V3,
  x: number,
  z: number,
  frontY: number,
): number | null {
  let run = 0;
  for (let y = frontY; y > frontY - 400; y -= 1) {
    const hu = huAt(ct, toVoxel, [x, y, z]);
    if (hu === null) {
      run = 0;
      continue;
    }
    run = hu > -300 ? run + 1 : 0;
    if (run >= 2) return y + 1;
  }
  return null;
}

/** The posterior skin behind a point of the spine: walking back, the first 5 mm of air (HU < −400). */
function backSkin(ct: NiftiVolume, toVoxel: (w: V3) => V3, from: V3): number | null {
  let run = 0;
  for (let s = 0; s < 300; s += 1) {
    const hu = huAt(ct, toVoxel, [from[0], from[1] - s, from[2]]);
    if (hu === null) return null;
    run = hu < -400 ? run + 1 : 0;
    if (run >= 5) return from[1] - s + 5;
  }
  return null;
}

/** Principal axis of a set of points (power iteration on the covariance). */
function principalAxis(ps: V3[]): V3 {
  const c = mean(ps);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of ps) {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    for (let r = 0; r < 3; r++)
      for (let q = 0; q < 3; q++) C[3 * r + q] = C[3 * r + q]! + d[r]! * d[q]!;
  }
  let v: V3 = [0, 0, 1];
  for (let it = 0; it < 50; it++) {
    const n: V3 = [
      C[0]! * v[0] + C[1]! * v[1] + C[2]! * v[2],
      C[3]! * v[0] + C[4]! * v[1] + C[5]! * v[2],
      C[6]! * v[0] + C[7]! * v[1] + C[8]! * v[2],
    ];
    const l = Math.hypot(...n) || 1;
    v = [n[0] / l, n[1] / l, n[2] / l];
  }
  return v;
}

/** RAS (mm) to the simulator's torso axes (+x left, +y superior, +z anterior), as a direction. */
const torsoDir = (d: V3): V3 => [-d[0], d[2], d[1]];

interface Row {
  subject: string;
  /** cm unless stated */
  sternumToAscendingAorta: number;
  ascendingDepth: number;
  descendingDepth: number;
  vertebraDepth: number;
  archWidth: number;
  chestAp: number;
  notchToArchApex: number;
  archApexBelowNotch: number;
  archApexBehindNotch: number;
  rootDepth: number;
  /** degrees */
  ascendingForwardTiltDeg: number;
  ascendingRightTiltDeg: number;
  /** unit vector, torso frame */
  ascendingAxis: V3;
  descendingForwardAtArch: number;
  /** vertical budget of the course (cm): the carina below the arch apex, the apex and the notch above the root */
  carinaBelowArchApex: number;
  rootToArchApexHeight: number;
  rootToNotchHeight: number;
  /** the sternum from the top of the manubrium to its lowest point (cm), and the root's height along it (0 low, 1 top) */
  sternumLength: number;
  rootInSternum: number;
  /** the lowest point of the heart along the sternum (0 low, 1 top) */
  heartBottomInSternum: number;
  /**
   * The heart's apex (the heart voxel farthest from the aortic valve) and the
   * axis from the aortic root to it: its height below the notch and below the root (cm), its depth below the anterior skin,
   * the axis length (cm) and its tilts (degrees): below the horizontal, and toward the left from straight ahead.
   */
  apexBelowNotch: number;
  apexBelowRoot: number;
  apexDepth: number;
  rootApexLength: number;
  rootApexDownTiltDeg: number;
  rootApexLeftTiltDeg: number;
  /** principal axis of the whole heart mask, pointed toward the apex: tilt below the horizontal and toward the left (°) */
  heartAxisDownTiltDeg: number;
  heartAxisLeftTiltDeg: number;
  /**
   * The heart's closest approach to the anterior skin (cm): for each 1 cm column of the heart, the depth of its most
   * anterior voxel below the skin straight in front of it, the smallest over the columns, and how far below the notch that
   * column's voxel lies. The chest CT is supine and at deep inspiration.
   */
  heartMinDepth: number;
  heartMinDepthBelowNotch: number;
  /**
   * How far below the notch the dome of the liver (the top of the right hemidiaphragm) lies (cm): how deep the subject
   * breathed in, which the root follows (decision 314). NaN without a liver mask in the volume.
   */
  liverDomeBelowNotch: number;
}

function measureSubject(dir: string): Row | string {
  const seg = (name: string) => join(dir, 'segmentations', `${name}.nii.gz`);
  for (const n of ['aorta', 'heart', 'sternum', 'trachea'])
    if (!existsSync(seg(n))) return `no ${n} mask`;
  const aortaVol = load(seg('aorta'));
  const aorta = maskPoints(aortaVol);
  const heart = maskPoints(load(seg('heart')));
  const sternum = maskPoints(load(seg('sternum')));
  const trachea = maskPoints(load(seg('trachea')));
  const liver = existsSync(seg('liver')) ? maskPoints(load(seg('liver'))) : [];
  if (aorta.length < 2000 || heart.length < 2000 || sternum.length < 500 || trachea.length < 500)
    return 'aorta, heart, sternum or trachea not (fully) in the volume';
  // the arch must be whole: its apex at least 2 cm below the top of the volume
  const [nx, ny, nz] = aortaVol.dims;
  let topZ = -Infinity;
  for (const k of [0, nz - 1])
    for (const [i, j] of [
      [0, 0],
      [nx - 1, ny - 1],
    ] as const)
      topZ = Math.max(topZ, voxelToWorld(aortaVol, i, j, k)[2]);
  const apexZ = maxOf(aorta, 2);
  if (topZ - apexZ < 20) return 'arch cut by the top of the volume';
  const ct = load(join(dir, 'ct.nii.gz'));
  const toVoxel = inverseAffine(ct.affine);
  let frontY = -Infinity;
  for (const i of [0, ct.dims[0] - 1])
    for (const j of [0, ct.dims[1] - 1])
      for (const k of [0, ct.dims[2] - 1]) frontY = Math.max(frontY, voxelToWorld(ct, i, j, k)[1]);

  // carina level and the two aortic sections there
  const carinaZ = minOf(trachea, 2);
  const band = (ps: V3[], z: number, half = 1.5) => ps.filter((p) => Math.abs(p[2] - z) <= half);
  const sections = components(band(aorta, carinaZ), 2).filter((c) => c.length > 30);
  if (sections.length < 2) return `${sections.length} aortic section(s) at the carina`;
  const [s1, s2] = [mean(sections[0]!), mean(sections[1]!)];
  const asc = s1[1] > s2[1] ? sections[0]! : sections[1]!,
    desc = s1[1] > s2[1] ? sections[1]! : sections[0]!;
  const ascC = mean(asc),
    descC = mean(desc);
  const ascFront = maxOf(asc, 1);
  const sternumBand = band(sternum, carinaZ, 5);
  if (!sternumBand.length) return 'no sternum at the carina level';
  const sternumBack = minOf(
    sternumBand.filter((p) => Math.abs(p[0] - ascC[0]) < 25),
    1,
  );
  // vertebral body at the carina: the nearest thoracic vertebra mask in the band
  let vb: V3[] = [];
  for (let t = 1; t <= 12 && vb.length <= 50; t++) {
    const p = seg(`vertebrae_T${t}`);
    if (existsSync(p)) vb = band(maskPoints(load(p)), carinaZ, 3);
  }
  if (vb.length <= 50) return 'no vertebral body at the carina';
  const spine = mean(vb);
  const vertebraFront = maxOf(
    vb.filter((q) => Math.abs(q[0] - spine[0]) < 15),
    1,
  );
  const skinAsc = frontSkin(ct, toVoxel, ascC[0], carinaZ, frontY);
  const skinMid = frontSkin(ct, toVoxel, spine[0], carinaZ, frontY);
  const skinDesc = frontSkin(ct, toVoxel, descC[0], carinaZ, frontY);
  const skinBackY = backSkin(ct, toVoxel, [spine[0], spine[1], carinaZ]);
  if (
    skinAsc === null ||
    skinMid === null ||
    skinDesc === null ||
    skinBackY === null ||
    !Number.isFinite(sternumBack)
  )
    return 'skin or sternum not found';

  // arch apex and the suprasternal notch: the skin in front of the top of the manubrium
  const apex = mean(aorta.filter((p) => p[2] >= apexZ - 3));
  const manubriumTopZ = maxOf(sternum, 2);
  const manubriumTop = mean(sternum.filter((p) => p[2] >= manubriumTopZ - 3));
  const notchY = frontSkin(ct, toVoxel, manubriumTop[0], manubriumTop[2], frontY);
  if (notchY === null) return 'notch skin not found';
  const notch: V3 = [manubriumTop[0], notchY, manubriumTop[2]];

  // aortic root: the ascending section followed down from the carina until the mask ends (the aorta mask runs on into
  // the abdomen, so its lowest voxel is not the root); the ascending axis from the section centres of its first 4 cm
  const chain: V3[] = [ascC];
  for (let z = carinaZ - 2; z > carinaZ - 150; z -= 2) {
    const prev = chain[chain.length - 1]!;
    const secs = components(band(aorta, z, 1), 2)
      .filter((c) => c.length > 15)
      .map(mean)
      .filter((c) => Math.hypot(c[0] - prev[0], c[1] - prev[1]) < 15);
    if (!secs.length) break;
    chain.push(
      secs.sort(
        (a, b) =>
          Math.hypot(a[0] - prev[0], a[1] - prev[1]) - Math.hypot(b[0] - prev[0], b[1] - prev[1]),
      )[0]!,
    );
  }
  const root = chain[chain.length - 1]!;
  const lowest = chain.filter((c) => c[2] <= root[2] + 40);
  if (chain.length < 10 || lowest.length < 8) return 'ascending aorta not followed to the root';
  let axis = principalAxis(lowest);
  if (axis[2] < 0) axis = [-axis[0], -axis[1], -axis[2]];
  const skinRoot = frontSkin(ct, toVoxel, root[0], root[2], frontY);
  if (skinRoot === null) return 'skin in front of the root not found';
  // the descending aorta at the level of the root: the most posterior aortic section there
  const rootSecs = components(band(aorta, root[2], 1.5), 2).filter((c) => c.length > 20);
  const descAtRoot = rootSecs.length ? rootSecs.map(mean).sort((a, b) => a[1] - b[1])[0]! : null;

  // the heart's apex: the voxel furthest along left (−X), anterior (+Y) and inferior (−Z), the usual long-axis direction
  let apexOfHeart: V3 = heart[0]!,
    apexScore = -Infinity;
  for (const p of heart) {
    // the apex is the heart's point farthest from the aortic valve below and to the left of it. Taken along a fixed
    // left-anterior-inferior direction (the simulator's own long axis) it was a point of the anterolateral wall wherever
    // the ventricle is steeper, and the root-to-apex axis came out flatter than it is (decision 310)
    // among the points below and to the left of the root only (RAS: lower z, lower X): the farthest of the whole mask is
    // the top of an atrium or an appendage
    if (p[2] >= root[2] || p[0] >= root[0]) continue;
    const score = Math.hypot(p[0] - root[0], p[1] - root[1], p[2] - root[2]);
    if (score > apexScore) {
      apexScore = score;
      apexOfHeart = p;
    }
  }
  const apexSkin = frontSkin(ct, toVoxel, apexOfHeart[0], apexOfHeart[2], frontY);
  let heartAxis = principalAxis(heart);
  if (-0.61 * heartAxis[0] + 0.65 * heartAxis[1] - 0.45 * heartAxis[2] < 0)
    heartAxis = [-heartAxis[0], -heartAxis[1], -heartAxis[2]];
  // the heart's front: for each 1 cm column (x, z) of the heart, its most anterior voxel and the skin in front of it
  const front = new Map<string, V3>();
  for (const p of heart) {
    const k = `${Math.round(p[0] / 10)},${Math.round(p[2] / 10)}`;
    const f = front.get(k);
    if (!f || p[1] > f[1]) front.set(k, p);
  }
  let minDepth = Infinity,
    minAt: V3 = heart[0]!;
  for (const p of front.values()) {
    const skin = frontSkin(ct, toVoxel, p[0], p[2], frontY);
    if (skin === null) continue;
    if (skin - p[1] < minDepth) {
      minDepth = skin - p[1];
      minAt = p;
    }
  }
  const t = torsoDir(axis);
  const cm = (mm: number) => mm / 10;
  return {
    subject: dir.split('/').pop()!,
    sternumToAscendingAorta: cm(sternumBack - ascFront),
    ascendingDepth: cm(skinAsc - ascC[1]),
    descendingDepth: cm(skinDesc - descC[1]),
    vertebraDepth: cm(skinMid - vertebraFront),
    archWidth: cm(dist(ascC, descC)),
    chestAp: cm(skinMid - skinBackY),
    notchToArchApex: cm(dist(notch, apex)),
    archApexBelowNotch: cm(notch[2] - apex[2]),
    archApexBehindNotch: cm(notch[1] - apex[1]),
    rootDepth: cm(skinRoot - root[1]),
    ascendingForwardTiltDeg: (Math.atan2(t[2], t[1]) * 180) / Math.PI,
    ascendingRightTiltDeg: (Math.atan2(-t[0], t[1]) * 180) / Math.PI,
    ascendingAxis: t,
    descendingForwardAtArch: descAtRoot ? cm(descC[1] - descAtRoot[1]) : NaN,
    carinaBelowArchApex: cm(apex[2] - carinaZ),
    rootToArchApexHeight: cm(apex[2] - root[2]),
    rootToNotchHeight: cm(notch[2] - root[2]),
    sternumLength: cm(manubriumTopZ - minOf(sternum, 2)),
    rootInSternum: (root[2] - minOf(sternum, 2)) / (manubriumTopZ - minOf(sternum, 2)),
    heartBottomInSternum:
      (minOf(heart, 2) - minOf(sternum, 2)) / (manubriumTopZ - minOf(sternum, 2)),
    apexBelowNotch: cm(notch[2] - apexOfHeart[2]),
    apexBelowRoot: cm(root[2] - apexOfHeart[2]),
    apexDepth: apexSkin === null ? NaN : cm(apexSkin - apexOfHeart[1]),
    rootApexLength: cm(dist(root, apexOfHeart)),
    rootApexDownTiltDeg:
      (Math.atan2(
        root[2] - apexOfHeart[2],
        Math.hypot(apexOfHeart[0] - root[0], apexOfHeart[1] - root[1]),
      ) *
        180) /
      Math.PI,
    rootApexLeftTiltDeg:
      (Math.atan2(root[0] - apexOfHeart[0], apexOfHeart[1] - root[1]) * 180) / Math.PI,
    heartAxisDownTiltDeg:
      (Math.atan2(-heartAxis[2], Math.hypot(heartAxis[0], heartAxis[1])) * 180) / Math.PI,
    heartAxisLeftTiltDeg: (Math.atan2(-heartAxis[0], heartAxis[1]) * 180) / Math.PI,
    heartMinDepth: cm(minDepth),
    heartMinDepthBelowNotch: cm(notch[2] - minAt[2]),
    liverDomeBelowNotch: liver.length > 2000 ? cm(notch[2] - maxOf(liver, 2)) : NaN,
  };
}

const log = (line: string): void => void process.stdout.write(`${line}\n`);
const subjects = readdirSync(ROOT)
  .filter((d) => /^s\d+$/.test(d))
  .sort()
  .slice(0, LIMIT);
const rows: Row[] = [];
const skipped = new Map<string, number>();
for (const s of subjects) {
  let r: Row | string;
  try {
    r = measureSubject(join(ROOT, s));
  } catch (e) {
    r = `error: ${(e as Error).message}`;
  }
  if (typeof r === 'string') skipped.set(r, (skipped.get(r) ?? 0) + 1);
  else {
    rows.push(r);
    process.stderr.write(`${s} ok\n`);
  }
}

const METRICS = [
  'sternumToAscendingAorta',
  'ascendingDepth',
  'descendingDepth',
  'vertebraDepth',
  'archWidth',
  'chestAp',
  'notchToArchApex',
  'archApexBelowNotch',
  'archApexBehindNotch',
  'rootDepth',
  'ascendingForwardTiltDeg',
  'ascendingRightTiltDeg',
  'descendingForwardAtArch',
  'carinaBelowArchApex',
  'rootToArchApexHeight',
  'rootToNotchHeight',
  'sternumLength',
  'rootInSternum',
  'heartBottomInSternum',
  'apexBelowNotch',
  'apexBelowRoot',
  'apexDepth',
  'rootApexLength',
  'rootApexDownTiltDeg',
  'rootApexLeftTiltDeg',
  'heartAxisDownTiltDeg',
  'heartAxisLeftTiltDeg',
  'heartMinDepth',
  'heartMinDepthBelowNotch',
  'liverDomeBelowNotch',
] as const;
const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo]! + (s[Math.min(s.length - 1, lo + 1)]! - s[lo]!) * (at - lo);
};
const summary: Record<
  string,
  { n: number; p10: number; q1: number; median: number; q3: number; p90: number }
> = {};
for (const m of METRICS) {
  const xs = rows.map((r) => r[m]).filter(Number.isFinite);
  if (!xs.length) continue;
  summary[m] = {
    n: xs.length,
    p10: quantile(xs, 0.1),
    q1: quantile(xs, 0.25),
    median: quantile(xs, 0.5),
    q3: quantile(xs, 0.75),
    p90: quantile(xs, 0.9),
  };
}
/**
 * The root's height against how deep the subject breathed in, age and sex (decision 314): ordinary least squares over the
 * subjects with all three (age and sex from the dataset's meta.csv), with the 10th and 90th percentiles of the residuals,
 * so a case can be compared with what the CT predicts for its own diaphragm, age and sex.
 */
const meta = new Map<string, { age: number; male: number }>();
const metaPath = join(ROOT, 'meta.csv');
if (existsSync(metaPath)) {
  const [head, ...lines] = readFileSync(metaPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);
  const cols = head!.split(';');
  const at = (name: string) => cols.indexOf(name);
  for (const line of lines) {
    const f = line.split(';');
    const age = Number(f[at('age')]);
    const g = f[at('gender')];
    if (f[at('age')] && Number.isFinite(age) && (g === 'm' || g === 'f'))
      meta.set(f[at('image_id')]!, { age, male: g === 'm' ? 1 : 0 });
  }
}
function leastSquares(X: number[][], y: number[]): number[] {
  const k = X[0]!.length;
  const A = Array.from({ length: k }, (_, i) => [
    ...Array.from({ length: k }, (_, j) => X.reduce((a, x) => a + x[i]! * x[j]!, 0)),
    X.reduce((a, x, n) => a + x[i]! * y[n]!, 0),
  ]);
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!];
    for (let r = 0; r < k; r++)
      if (r !== i) {
        const f = A[r]![i]! / A[i]![i]!;
        A[r] = A[r]!.map((v, c) => v - f * A[i]![c]!);
      }
  }
  return A.map((row, i) => row[k]! / row[i]!);
}
const CONDITIONED = ['rootToNotchHeight', 'rootToArchApexHeight'] as const;
const conditional: Record<string, Record<string, number>> = {};
{
  const usable = rows.filter((r) => meta.has(r.subject) && Number.isFinite(r.liverDomeBelowNotch));
  for (const m of CONDITIONED) {
    if (usable.length < 20) break;
    const X = usable.map((r) => [
      1,
      r.liverDomeBelowNotch,
      meta.get(r.subject)!.age,
      meta.get(r.subject)!.male,
    ]);
    const y = usable.map((r) => r[m]);
    const [a, dome, year, male] = leastSquares(X, y);
    const res = usable.map(
      (_, i) => y[i]! - (a! + dome! * X[i]![1]! + year! * X[i]![2]! + male! * X[i]![3]!),
    );
    conditional[m] = {
      n: usable.length,
      intercept: a!,
      perDomeCm: dome!,
      perYear: year!,
      male: male!,
      residualP10: quantile(res, 0.1),
      residualP90: quantile(res, 0.9),
    };
  }
}
log(`${rows.length} of ${subjects.length} subjects measured`);
for (const [why, n] of skipped) log(`  skipped ${n}: ${why}`);
for (const [m, c] of Object.entries(conditional))
  log(
    `${m} = ${c.intercept!.toFixed(2)} + ${c.perDomeCm!.toFixed(3)}·dome + ${c.perYear!.toFixed(4)}·age + ${c.male!.toFixed(2)}·male (n=${c.n}), residual P10–P90 ${c.residualP10!.toFixed(2)}–${c.residualP90!.toFixed(2)}`,
  );
for (const [m, s] of Object.entries(summary))
  log(
    `${m.padEnd(26)} n=${String(s.n).padStart(3)}  median ${s.median.toFixed(2)}  IQR ${s.q1.toFixed(2)}–${s.q3.toFixed(2)}  P10–P90 ${s.p10.toFixed(2)}–${s.p90.toFixed(2)}`,
  );
const outPath = opt('--out');
if (outPath) writeFileSync(outPath, JSON.stringify({ rows, summary }, null, 1));
const refOut = opt('--reference-out');
if (refOut) {
  const body = Object.entries(summary)
    .map(
      ([m, s]) =>
        `  ${m}: { n: ${s.n}, p10: ${s.p10.toFixed(2)}, q1: ${s.q1.toFixed(2)}, median: ${s.median.toFixed(2)}, q3: ${s.q3.toFixed(2)}, p90: ${s.p90.toFixed(2)} },`,
    )
    .join('\n');
  writeFileSync(
    refOut,
    `/**\n * Base of the heart and mediastinum on CT (decision 307), generated by tools/clinical/ct-mediastinum.ts from ${rows.length}\n` +
      ` * chest CT volumes of the TotalSegmentator dataset (small subset, Wasserthal et al., Radiol Artif Intell 2023;5:e230024;\n` +
      ` * Zenodo 10047263, CC-BY-4.0). Aggregates only: centimetres and degrees, torso frame (+x left, +y superior, +z anterior).\n` +
      ` * Do not edit by hand; regenerate with the tool and format with Prettier.\n */\n` +
      `export interface CtDistribution {\n  n: number;\n  p10: number;\n  q1: number;\n  median: number;\n  q3: number;\n  p90: number;\n}\n\n` +
      `export const CT_MEDIASTINUM = {\n${body}\n} as const satisfies Record<string, CtDistribution>;\n\n` +
      `/**\n * The root's height (cm) against the liver dome's depth below the notch (cm), age (years) and male sex (decision 314):\n` +
      ` * least squares over the subjects with age and sex in the dataset's metadata, and the 10th–90th percentiles of the\n * residuals.\n */\n` +
      `export interface CtConditional {\n  n: number;\n  intercept: number;\n  perDomeCm: number;\n  perYear: number;\n  male: number;\n  residualP10: number;\n  residualP90: number;\n}\n\n` +
      `export const CT_CONDITIONAL = {\n${Object.entries(conditional)
        .map(
          ([m, c]) =>
            `  ${m}: { n: ${c.n}, intercept: ${c.intercept!.toFixed(3)}, perDomeCm: ${c.perDomeCm!.toFixed(4)}, perYear: ${c.perYear!.toFixed(5)}, male: ${c.male!.toFixed(3)}, residualP10: ${c.residualP10!.toFixed(2)}, residualP90: ${c.residualP90!.toFixed(2)} },`,
        )
        .join('\n')}\n} as const satisfies Record<string, CtConditional>;\n`,
  );
  log(`wrote ${refOut}`);
}
