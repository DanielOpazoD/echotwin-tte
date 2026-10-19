/**
 * The clinical side of the realism bench (decision 344): CAMUS (Leclerc et al., IEEE TMI 2019) and EchoNet-Dynamic
 * (Ouyang et al., Nature 2020), read from folders outside the repository (CAMUS_DIR, ECHONET_DIR). Only aggregate
 * statistics leave these functions; the clips the Turing test needs are written to a folder the caller has already
 * checked lies outside the repository.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseNifti, type NiftiVolume } from '@/clinical/nifti';
import { identifyLabels, LABEL, orientApical, type RegionImage } from '@/clinical/regionStats';
import {
  apexFirst,
  biplaneMl,
  ejectionFraction,
  maskDiscs,
  parseEchonetFileList,
  parseVolumeTracings,
  tracedEdEs,
  type Segment,
} from '@/clinical/realism/lvVolume';
import { pearson, quantiles, type Quantiles } from '@/clinical/realism/speckleStats';
import { tissueDecorrelation } from '@/clinical/realism/speckleTracking';
import { seededRandom } from '@/clinical/realism/turing';
import { textureStats, type TextureStats } from './cineMetrics';
import { readVideoGrey } from './formats';

/** Refuses a clinical folder inside the repository (decision 69). */
export function assertOutsideRepo(dir: string, what: string): string {
  const abs = resolve(dir);
  const repo = resolve(process.cwd());
  if (abs === repo || abs.startsWith(repo + sep))
    throw new Error(
      `${what} (${abs}) está dentro del repositorio público: los datos clínicos no pueden acabar en git.`,
    );
  return abs;
}

export function readNifti(path: string): NiftiVolume {
  const raw = readFileSync(path);
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  return parseNifti(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

/** Frame t of a CAMUS volume (and its labels) as a region image, grey rescaled to 0–255 only if outside that range. */
export function camusImage(img: NiftiVolume, gt: NiftiVolume | null, t = 0): RegionImage {
  const [w, h] = img.dims;
  const plane = w * h;
  const grey = new Float32Array(plane);
  const labels = new Uint8Array(plane);
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = img.voxels[i + t * plane]!;
    grey[i] = v;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    if (gt) labels[i] = Math.round(gt.voxels[i + t * plane]!);
  }
  if (lo < 0 || hi > 255)
    for (let i = 0; i < plane; i++) grey[i] = (255 * (grey[i]! - lo)) / Math.max(1e-6, hi - lo);
  return { width: w, height: h, grey, labels, mmPerPx: [img.spacing[0], img.spacing[1]] };
}

export function readCfg(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export function camusPatients(dir: string): string[] {
  return readdirSync(dir)
    .filter((p) => /^patient\d+$/.test(p))
    .sort();
}

export interface CamusSummary {
  patients: number;
  /** Biplane volumes from the ground-truth masks with the bench's disc code, and the EF the dataset declares. */
  edvMl: Quantiles;
  esvMl: Quantiles;
  efPct: Quantiles;
  efDeclaredPct: Quantiles;
  /** Bench EF minus declared EF: mean, mean absolute, Pearson r. */
  efAgreement: { bias: number; mae: number; r: number; n: number };
  /** End-diastole to end-systole (ms) from the frame indices and frame rate of the four-chamber sequence. */
  edToEsMs: Quantiles;
  /** Myocardial texture of Good images (four- and two-chamber, ED and ES). */
  texture: Record<'skewness' | 'excessKurtosis' | 'residualStd' | 'medianGrey', Quantiles>;
  textureImages: number;
}

/** CAMUS aggregates (see `CamusSummary`); `limit` patients at most. */
export function camusSummary(dir: string, limit = Infinity): CamusSummary {
  const edv: number[] = [],
    esv: number[] = [],
    ef: number[] = [],
    efDecl: number[] = [],
    edEs: number[] = [];
  const tex: TextureStats[] = [];
  const patients = camusPatients(dir).slice(0, limit);
  for (const p of patients) {
    const discs: Record<string, ReturnType<typeof maskDiscs>> = {};
    for (const ch of ['4CH', '2CH'])
      for (const ph of ['ED', 'ES']) {
        const imgPath = join(dir, p, `${p}_${ch}_${ph}.nii.gz`),
          gtPath = join(dir, p, `${p}_${ch}_${ph}_gt.nii.gz`);
        if (!existsSync(imgPath) || !existsSync(gtPath)) continue;
        const img = orientApical(camusImage(readNifti(imgPath), readNifti(gtPath)));
        identifyLabels(img.labels, img.width, img.height);
        const d = maskDiscs(img.labels, img.width, img.height, img.mmPerPx, LABEL.cavity);
        discs[`${ch}_${ph}`] = d ? apexFirst(d) : null;
        if (readCfg(join(dir, p, `Info_${ch}.cfg`))['ImageQuality'] === 'Good')
          tex.push(textureStats(img));
      }
    const cfg4 = readCfg(join(dir, p, 'Info_4CH.cfg'));
    const d = discs;
    if (d['4CH_ED'] && d['2CH_ED'] && d['4CH_ES'] && d['2CH_ES']) {
      const vEd = biplaneMl(d['4CH_ED'], d['2CH_ED']),
        vEs = biplaneMl(d['4CH_ES'], d['2CH_ES']);
      edv.push(vEd);
      esv.push(vEs);
      ef.push(ejectionFraction(vEd, vEs));
      efDecl.push(Number(cfg4['EF']));
    }
    const fr = Number(cfg4['FrameRate']),
      e0 = Number(cfg4['ED']),
      e1 = Number(cfg4['ES']);
    if (fr > 0 && Number.isFinite(e0) && Number.isFinite(e1))
      edEs.push((1000 * Math.abs(e1 - e0)) / fr);
  }
  const pairs = ef.map((v, i) => [v, efDecl[i]!] as const).filter(([, b]) => Number.isFinite(b));
  const diffs = pairs.map(([a, b]) => a - b);
  return {
    patients: patients.length,
    edvMl: quantiles(edv),
    esvMl: quantiles(esv),
    efPct: quantiles(ef),
    efDeclaredPct: quantiles(efDecl),
    efAgreement: {
      bias: diffs.reduce((s, v) => s + v, 0) / diffs.length,
      mae: diffs.reduce((s, v) => s + Math.abs(v), 0) / diffs.length,
      r: pearson(
        pairs.map(([a]) => a),
        pairs.map(([, b]) => b),
      ),
      n: pairs.length,
    },
    edToEsMs: quantiles(edEs),
    texture: {
      skewness: quantiles(tex.map((t) => t.skewness)),
      excessKurtosis: quantiles(tex.map((t) => t.excessKurtosis)),
      residualStd: quantiles(tex.map((t) => t.residualStd)),
      medianGrey: quantiles(tex.map((t) => t.medianGrey)),
    },
    textureImages: tex.length,
  };
}

/** Options of the grey-only decorrelation, the same on EchoNet's videos and on the simulator in EchoNet's format. */
export const ECHONET_DECORRELATION = {
  halfKernel: 2,
  search: 3,
  points: 60,
  minGrey: 50,
  marginPx: 4,
};

export interface EchonetSummary {
  videos: number;
  efPct: Quantiles;
  edvMl: Quantiles;
  esvMl: Quantiles;
  /** Videos with EF ≥ 55 %: the volumes a normal heart is compared with. */
  normal: { videos: number; edvMl: Quantiles; esvMl: Quantiles };
  /** ED → ES (ms) of the traced frames, and the EF the tracings imply against the declared one. */
  edToEsMs: Quantiles;
  tracingEfAgreement: { bias: number; mae: number; n: number };
  decorrelation: { videos: number; peak: Quantiles; zeroShift: Quantiles; fps: Quantiles } | null;
}

/** EchoNet-Dynamic aggregates; `videos` AVIs of normal EF are read for the decorrelation (0 skips it). */
export function echonetSummary(dir: string, videos = 40): EchonetSummary {
  const list = parseEchonetFileList(readFileSync(join(dir, 'FileList.csv'), 'utf8')).filter(
    (r) => Number.isFinite(r.ef) && r.edv > 0,
  );
  const tracings = existsSync(join(dir, 'VolumeTracings.csv'))
    ? parseVolumeTracings(readFileSync(join(dir, 'VolumeTracings.csv'), 'utf8'))
    : new Map<string, Map<number, Segment[]>>();
  const edEs: number[] = [],
    diffs: number[] = [];
  for (const r of list) {
    const t = tracings.get(r.fileName);
    if (!t) continue;
    const e = tracedEdEs(t);
    if (!e) continue;
    if (r.fps > 0) edEs.push((1000 * Math.abs(e.esFrame - e.edFrame)) / r.fps);
    diffs.push(e.ef - r.ef);
  }
  const normal = list.filter((r) => r.ef >= 55);
  let decorrelation: EchonetSummary['decorrelation'] = null;
  const videoDir = existsSync(join(dir, 'Videos')) ? join(dir, 'Videos') : dir;
  if (videos > 0) {
    const rand = seededRandom(343);
    const pool = normal.filter((r) => existsSync(join(videoDir, `${r.fileName}.avi`)));
    const picked: typeof pool = [];
    while (picked.length < Math.min(videos, pool.length)) {
      const r = pool[Math.floor(rand() * pool.length)]!;
      if (!picked.includes(r)) picked.push(r);
    }
    const peaks: number[] = [],
      zeros: number[] = [],
      fps: number[] = [];
    for (const r of picked) {
      const v = readVideoGrey(join(videoDir, `${r.fileName}.avi`));
      const frames = v.frames.slice(0, Math.round(v.fps)).map((g) => ({
        width: g.width,
        height: g.height,
        grey: Float32Array.from(g.data),
      }));
      const d = tissueDecorrelation(frames, { ...ECHONET_DECORRELATION, rand });
      peaks.push(d.peak);
      zeros.push(d.zeroShift);
      fps.push(v.fps);
    }
    decorrelation = {
      videos: picked.length,
      peak: quantiles(peaks),
      zeroShift: quantiles(zeros),
      fps: quantiles(fps),
    };
  }
  return {
    videos: list.length,
    efPct: quantiles(list.map((r) => r.ef)),
    edvMl: quantiles(list.map((r) => r.edv)),
    esvMl: quantiles(list.map((r) => r.esv)),
    normal: {
      videos: normal.length,
      edvMl: quantiles(normal.map((r) => r.edv)),
      esvMl: quantiles(normal.map((r) => r.esv)),
    },
    edToEsMs: quantiles(edEs),
    tracingEfAgreement: {
      bias: diffs.reduce((s, v) => s + v, 0) / Math.max(1, diffs.length),
      mae: diffs.reduce((s, v) => s + Math.abs(v), 0) / Math.max(1, diffs.length),
      n: diffs.length,
    },
    decorrelation,
  };
}
