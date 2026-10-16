/**
 * Coherence census on the drawn planes: for each canonical view and case, (1) the mean grey of every structure and
 * tissue in the console image, against the physical hierarchy (pericardium and fibrous above myocardium, myocardium
 * above blood, fat between), and (2) the straightness of each cavity's border: windows of the border that lie within
 * STRAIGHT_DEV_CM of a straight line over STRAIGHT_WINDOW_CM, where anatomy curves.
 *
 *   npx tsx tools/offline/review/coherence-planes.ts [caseIds,comma|all] [viewIds,comma] [phases,comma]
 */
import { loadCaseById } from '@/cases';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import {
  caseArtifactLevels,
  consoleArtifacts,
  scenePhysicsFor,
} from '@/simulator/renderer/scenePhysics';
import { buildScanLut, computeSectorMapping } from '@/simulator/renderer/scanConvert';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { canonicalControl, VIEW_TARGETS } from '@/simulator/windows/viewTargets';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';

export const TISSUE_NAME: Record<number, string> = {
  [Tissue.Blood]: 'Blood',
  [Tissue.Myocardium]: 'Myocardium',
  [Tissue.VesselWall]: 'VesselWall',
  [Tissue.Fibrous]: 'Fibrous',
  [Tissue.Valve]: 'Valve',
  [Tissue.Fat]: 'Fat',
  [Tissue.Pericardium]: 'Pericardium',
  [Tissue.Fluid]: 'Fluid',
  [Tissue.Chordae]: 'Chordae',
  [Tissue.Lung]: 'Lung',
  [Tissue.Muscle]: 'Muscle',
};
export const STRAIGHT_WINDOW_CM = 0.8;
export const STRAIGHT_DEV_CM = 0.03;
const CAVITIES = [Structure.LvCavity, Structure.LaCavity, Structure.RvCavity, Structure.RaCavity];
const W = 640,
  H = 550;

export interface GreyRow {
  structure: number;
  tissue: number;
  samples: number;
  mean: number;
}
export interface StraightRun {
  cavity: number;
  lengthCm: number;
  /** centre of the run in the sector (cm from the probe along depth, lateral cm) */
  at: string;
}
export interface PlaneCensus {
  greys: GreyRow[];
  borders: { cavity: number; lengthCm: number; straightCm: number; longest: StraightRun | null }[];
}

export function planeCensus(id: string, viewId: string, phase: number): PlaneCensus {
  const view = VIEW_TARGETS.find((v) => v.id === viewId)!;
  const c = loadCaseById(id);
  const { thorax, heart, tables } = buildCaseModels(c, {
    position: 'left-lateral',
    respiration: 'expiration',
    headElevationDeg: 0,
  });
  const settings = { ...DEFAULT_ACQUISITION };
  const spec = polarSpecFor(settings, 'high');
  const beam = beamFrameFromPose(poseFromControl(thorax, canonicalControl(view, heart, thorax)), 1);
  const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
  const scene: Scene = { heart, heartPose: pose, thorax, physics: scenePhysicsFor(c, settings) };
  const frame = allocPolarFrame(spec);
  new ProceduralSliceRenderer().render(scene, beam, spec, phase, frame);
  const disp = new Uint8ClampedArray(spec.lines * spec.samples);
  applyConsole(
    frame,
    settings,
    createConsoleState(c.seed),
    disp,
    consoleArtifacts(caseArtifactLevels(c)),
  );
  // greys per structure and tissue, over the polar samples in front of the pleura (the structure of the sample)
  const acc = new Map<number, { n: number; sum: number }>();
  for (let i = 0; i < disp.length; i++) {
    const st = frame.structure[i]!,
      ti = frame.tissue[i]!;
    if (st === Structure.None && ti !== Tissue.Fat) continue;
    const k = ti * 64 + st;
    const e = acc.get(k) ?? { n: 0, sum: 0 };
    e.n++;
    e.sum += disp[i]!;
    acc.set(k, e);
  }
  const greys: GreyRow[] = [...acc]
    .filter(([, e]) => e.n >= 200)
    .map(([k, e]) => ({
      structure: k % 64,
      tissue: Math.floor(k / 64),
      samples: e.n,
      mean: e.sum / e.n,
    }))
    .sort((a, b) => b.mean - a.mean);
  // borders on the scan-converted sector: a cavity pixel with a neighbour of another structure
  const mapping = computeSectorMapping(spec, W, H, false);
  const lut = buildScanLut(spec, mapping);
  const S = spec.samples;
  const sm = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++)
    sm[p] = lut.idx[p]! >= 0 ? frame.structure[lut.li[p]! * S + lut.si[p]!]! : 255;
  const pxCm = 1 / mapping.pxPerCm;
  const borders: PlaneCensus['borders'] = [];
  for (const cav of CAVITIES) {
    const pts: number[] = [];
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        if (sm[p] !== cav) continue;
        if (sm[p - 1] !== cav || sm[p + 1] !== cav || sm[p - W] !== cav || sm[p + W] !== cav)
          pts.push(p);
      }
    if (pts.length < 20) continue;
    // straightness: for each border pixel, the pixels of the same border within half a window, fitted by their
    // principal axis; straight when every one lies within STRAIGHT_DEV_CM of it
    const half = STRAIGHT_WINDOW_CM / 2 / pxCm;
    const xs = pts.map((p) => p % W),
      ys = pts.map((p) => Math.floor(p / W));
    const straight = new Uint8Array(pts.length);
    for (let a = 0; a < pts.length; a++) {
      let n = 0,
        mx = 0,
        my = 0;
      const idx: number[] = [];
      for (let b = 0; b < pts.length; b++) {
        const dx = xs[b]! - xs[a]!,
          dy = ys[b]! - ys[a]!;
        if (dx * dx + dy * dy <= half * half) {
          idx.push(b);
          n++;
          mx += xs[b]!;
          my += ys[b]!;
        }
      }
      if (n < 6) continue;
      mx /= n;
      my /= n;
      let sxx = 0,
        syy = 0,
        sxy = 0;
      for (const b of idx) {
        const dx = xs[b]! - mx,
          dy = ys[b]! - my;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
      // principal axis angle
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      const nxv = -Math.sin(th),
        nyv = Math.cos(th);
      let maxDev = 0,
        span = 0;
      for (const b of idx) {
        const dx = xs[b]! - mx,
          dy = ys[b]! - my;
        maxDev = Math.max(maxDev, Math.abs(dx * nxv + dy * nyv));
        span = Math.max(span, Math.abs(dx * Math.cos(th) + dy * Math.sin(th)));
      }
      // the window must actually span its length (not a short stub) and lie within the deviation
      if (maxDev * pxCm <= STRAIGHT_DEV_CM && span * pxCm >= STRAIGHT_WINDOW_CM / 2 - 0.05)
        straight[a] = 1;
    }
    // runs: straight pixels connected along the border (8-neighbours), the longest by extent
    const seen = new Uint8Array(pts.length);
    const byPix = new Map<number, number>();
    pts.forEach((p, i) => byPix.set(p, i));
    let longest: StraightRun | null = null;
    let straightPx = 0;
    for (let a = 0; a < pts.length; a++) {
      if (!straight[a] || seen[a]) continue;
      const stack = [a];
      seen[a] = 1;
      const members: number[] = [];
      while (stack.length) {
        const u = stack.pop()!;
        members.push(u);
        const x = xs[u]!,
          y = ys[u]!;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const v = byPix.get((y + dy) * W + (x + dx));
            if (v === undefined || seen[v] || !straight[v]) continue;
            seen[v] = 1;
            stack.push(v);
          }
      }
      straightPx += members.length;
      // extent of the run: the largest distance between two of its pixels
      let ext = 0;
      for (let i = 0; i < members.length; i += 3)
        for (let j = i + 1; j < members.length; j += 3) {
          const dx = xs[members[i]!]! - xs[members[j]!]!,
            dy = ys[members[i]!]! - ys[members[j]!]!;
          ext = Math.max(ext, dx * dx + dy * dy);
        }
      const lengthCm = Math.sqrt(ext) * pxCm;
      if (!longest || lengthCm > longest.lengthCm) {
        const cx = members.reduce((s, m) => s + xs[m]!, 0) / members.length,
          cy = members.reduce((s, m) => s + ys[m]!, 0) / members.length;
        const r = Math.hypot(cx - mapping.apexX, cy - mapping.apexY) * pxCm;
        const lat = (cx - mapping.apexX) * pxCm;
        longest = {
          cavity: cav,
          lengthCm,
          at: `${r.toFixed(1)} cm deep, ${lat.toFixed(1)} cm lateral`,
        };
      }
    }
    borders.push({
      cavity: cav,
      lengthCm: pts.length * pxCm,
      straightCm: straightPx * pxCm,
      longest,
    });
  }
  return { greys, borders };
}
