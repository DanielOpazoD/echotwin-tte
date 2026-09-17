import { loadCaseById } from '@/cases';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { buildHeartMeshes, type MeshGroup } from '@/simulator/anatomy/heartMesh';
import {
  heartGhostPrimitives,
  heartLandmarks,
  type GhostPrimitive,
} from '@/simulator/anatomy/heartModel';
import { heartToTorso } from '@/simulator/anatomy/heartFrame';
import type { HeartFrame } from '@/simulator/anatomy/heartFrame';
import type { ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import type { PatientState } from '@/simulator/anatomy/thoraxModel';
import { canonicalControl, VIEW_TARGETS, type WindowId } from '@/simulator/windows/viewTargets';

/**
 * Builds the navigator's heart surfaces off the UI thread (decision 57). Extraction samples the implicit
 * model a few hundred thousand times, which freezes the interface for seconds if done inline.
 *
 * One mesh per cardiac phase, emitted as each one is ready (decision 68): the navigator shows the first
 * phase immediately and starts beating once enough of them have arrived, instead of waiting for the whole
 * set. A 3D heart standing still next to a beating image is the first thing that gives the model away.
 */
export interface MeshRequest {
  caseId: string;
  patient: PatientState;
  stepCm: number;
  /** Cycle phases to extract, in [0,1). The first one is rendered as soon as it arrives. */
  phases: number[];
}
/** The worker could not build the surfaces: the navigator keeps its ghost and says why. */
export interface MeshError {
  caseId: string;
  error: string;
}

/**
 * What the navigator needs of the models, as plain data, sent before the meshes (audit B7): the thorax the
 * skin, ribs and probe pose are built from, the heart frame the meshes are placed with, the LV length of the
 * long-axis hint and the schematic ghost shown until the surfaces arrive. The main thread never builds the
 * models itself, so the anatomy engine stays out of the entry chunk.
 */
export interface NavigatorModel {
  kind: 'model';
  caseId: string;
  thorax: ThoraxModel;
  frame: HeartFrame;
  lvLengthCm: number;
  ghost: GhostPrimitive[];
  /** Where each canonical view is acquired on this patient's skin (decision 132). */
  windows: WindowMark[];
  /** Named points of the anatomy (torso cm) the cut view labels when the plane passes near them (decision 137). */
  landmarks: { id: string; label: string; p: { x: number; y: number; z: number } }[];
}

/** Short names for the cut face; the landmark's own label otherwise. */
const SHORT_LABELS: Record<string, string> = {
  'lv-mid': 'VI',
  'lv-apex': 'ápex',
  'lv-apical-cavity': 'VI ap',
  rv: 'VD',
  'rv-anterior': 'VD ant',
  'rv-inferior': 'VD inf',
  la: 'AI',
  ra: 'AD',
  mv: 'VM',
  av: 'VAo',
  tv: 'VT',
  lvot: 'TSVI',
  rvot: 'TSVD',
  'aortic-root': 'Ao',
  pa: 'AP',
  'pa-bifurcation': 'AP bif',
  ivc: 'VCI',
  svc: 'VCS',
  'desc-aorta': 'Ao desc',
  ias: 'TIA',
  'pap-al': 'pap AL',
  'pap-pm': 'pap PM',
  'hepatic-vein': 'v. hep.',
};

/** Skin position (torso cm) of one canonical view's acoustic window, solved for the case anatomy. */
export interface WindowMark {
  viewId: string;
  name: string;
  window: WindowId;
  u: number;
  v: number;
}

export interface MeshReply {
  caseId: string;
  /** Index into the requested phases, and how many were asked for. */
  index: number;
  total: number;
  phase: number;
  groups: MeshGroup[];
  ms: number;
}

self.onmessage = (ev: MessageEvent<MeshRequest>) => {
  const { caseId, patient, stepCm, phases } = ev.data;
  try {
    buildAllPhases(caseId, patient, stepCm, phases);
  } catch (e) {
    const reply: MeshError = {
      caseId,
      error: e instanceof Error ? (e.stack ?? e.message) : String(e),
    };
    (self as unknown as Worker).postMessage(reply);
  }
};

function buildAllPhases(
  caseId: string,
  patient: PatientState,
  stepCm: number,
  phases: number[],
): void {
  const { heart, thorax, tables } = buildCaseModels(loadCaseById(caseId), patient);
  const model: NavigatorModel = {
    kind: 'model',
    caseId,
    thorax,
    frame: heart.frame,
    lvLengthCm: heart.lv.lengthCm,
    ghost: heartGhostPrimitives(heart),
    windows: VIEW_TARGETS.map((view) => {
      const c = canonicalControl(view, heart, thorax);
      return { viewId: view.id, name: view.name, window: view.window, u: c.u, v: c.v };
    }),
    landmarks: heartLandmarks(heart)
      .filter((l) => !l.id.startsWith('wall-') && !l.id.startsWith('ivs-'))
      .map((l) => ({
        id: l.id,
        label: SHORT_LABELS[l.id] ?? l.label,
        p: heartToTorso(heart.frame, l.p),
      })),
  };
  (self as unknown as Worker).postMessage(model);
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]!;
    const t0 = performance.now();
    const pose = computeHeartPose(heart, cycleStateAt(tables, phase));
    const groups = buildHeartMeshes(heart, pose, { stepCm });
    const reply: MeshReply = {
      caseId,
      index: i,
      total: phases.length,
      phase,
      groups,
      ms: performance.now() - t0,
    };
    const transfer: Transferable[] = [];
    for (const g of groups) transfer.push(g.positions.buffer, g.normals.buffer, g.indices.buffer);
    (self as unknown as Worker).postMessage(reply, transfer);
  }
}
