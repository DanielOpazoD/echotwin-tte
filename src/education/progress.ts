/**
 * Local learning analytics (spec 40, proposal 7): events and progress live only in the learner's
 * browser (localStorage) and can be exported as JSON by the learner for research use. No telemetry.
 */
export type ProgressEvent =
  | { t: number; kind: 'view'; caseId: string; viewId: string; score: number }
  | {
      t: number;
      kind: 'measurement';
      caseId: string;
      measurementId: string;
      techniqueScore: number | null;
      value: number;
    }
  | { t: number; kind: 'task'; taskId: string }
  | { t: number; kind: 'case'; caseId: string }
  | {
      t: number;
      kind: 'exam';
      caseId: string;
      total: number;
      acquisition: number;
      measurements: number;
      impression: number;
    }
  | { t: number; kind: 'impression'; caseId: string; score: number };

export interface ProgressState {
  version: 1;
  completedTasks: Record<string, number>; // taskId → timestamp
  events: ProgressEvent[];
}

export const PROGRESS_KEY = 'echotwin.progress.v1';
const MAX_EVENTS = 2000;

export function emptyProgress(): ProgressState {
  return { version: 1, completedTasks: {}, events: [] };
}

export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadProgress(storage: ProgressStorage | null): ProgressState {
  if (!storage) return emptyProgress();
  try {
    const raw = storage.getItem(PROGRESS_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<ProgressState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.events)) return emptyProgress();
    return {
      version: 1,
      completedTasks: parsed.completedTasks ?? {},
      events: parsed.events.slice(-MAX_EVENTS),
    };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(storage: ProgressStorage | null, p: ProgressState): void {
  if (!storage) return;
  try {
    storage.setItem(PROGRESS_KEY, JSON.stringify({ ...p, events: p.events.slice(-MAX_EVENTS) }));
  } catch {
    /* quota or private mode: progress stays in memory */
  }
}

export function addEvent(p: ProgressState, e: ProgressEvent): ProgressState {
  const events = [...p.events, e].slice(-MAX_EVENTS);
  return { ...p, events };
}

export function completeTask(p: ProgressState, taskId: string, t: number): ProgressState {
  if (p.completedTasks[taskId]) return p;
  return addEvent(
    { ...p, completedTasks: { ...p.completedTasks, [taskId]: t } },
    { t, kind: 'task', taskId },
  );
}

export interface ProgressSummary {
  bestViewScores: Record<string, number>;
  viewAttempts: Record<string, number>;
  measurementsCount: number;
  meanTechniqueScore: number | null;
  techniqueTrend: { t: number; score: number }[];
  casesOpened: string[];
  exams: { t: number; caseId: string; total: number }[];
  completedTasks: number;
}

export function summarizeProgress(p: ProgressState): ProgressSummary {
  const bestViewScores: Record<string, number> = {};
  const viewAttempts: Record<string, number> = {};
  const trend: { t: number; score: number }[] = [];
  const cases = new Set<string>();
  const exams: { t: number; caseId: string; total: number }[] = [];
  let tSum = 0,
    tN = 0,
    mN = 0;
  for (const e of p.events) {
    if (e.kind === 'view') {
      bestViewScores[e.viewId] = Math.max(bestViewScores[e.viewId] ?? 0, e.score);
      viewAttempts[e.viewId] = (viewAttempts[e.viewId] ?? 0) + 1;
    } else if (e.kind === 'measurement') {
      mN++;
      if (e.techniqueScore !== null) {
        tSum += e.techniqueScore;
        tN++;
        trend.push({ t: e.t, score: e.techniqueScore });
      }
    } else if (e.kind === 'case') cases.add(e.caseId);
    else if (e.kind === 'exam') exams.push({ t: e.t, caseId: e.caseId, total: e.total });
  }
  return {
    bestViewScores,
    viewAttempts,
    measurementsCount: mN,
    meanTechniqueScore: tN ? tSum / tN : null,
    techniqueTrend: trend,
    casesOpened: [...cases],
    exams,
    completedTasks: Object.keys(p.completedTasks).length,
  };
}

/** Anonymous export for the validation protocol (docs/VALIDATION_PROTOCOL.md): no identifiers, only events. */
export function exportProgressJson(p: ProgressState, appVersion: string): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), appVersion, progress: p }, null, 2);
}
