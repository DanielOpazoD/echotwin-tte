import { describe, expect, it } from 'vitest';
import { allTasks, CURRICULUM, evaluateTasks, type LearnerSnapshot } from './curriculum';
import { addEvent, completeTask, emptyProgress, exportProgressJson, loadProgress, saveProgress, summarizeProgress, type ProgressStorage } from './progress';
import { DOPPLER_CAUSES, explainAnalysis } from './causes';
import { CASE_INPUTS } from '@/cases';
import type { ViewAnalysis } from '@/simulator/view-recognition/viewQuality';
import { DEFAULT_ACQUISITION } from '@/simulator/renderer/types';
import type { Measurement } from '@/simulator/measurements/types';

const snap = (over: Partial<LearnerSnapshot> = {}): LearnerSnapshot => ({
  caseId: 'normal-excellent-window',
  mode: 'guided',
  viewProgress: {},
  bestView: null,
  modality: '2d',
  colorScaleMps: 0.62,
  colorGainDb: 0,
  gateStructure: null,
  gateFlowAngleDeg: null,
  measurements: [],
  impressionScore: null,
  settings: { depthCm: 16, gainDb: 0, frequencyMHz: 2.5, harmonics: true },
  ...over,
});

describe('curriculum', () => {
  it('has unique task ids, non-empty rationale and only known case ids', () => {
    const tasks = allTasks();
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    expect(tasks.length).toBeGreaterThanOrEqual(15);
    const ids = new Set(CASE_INPUTS.map((c) => c.id));
    for (const t of tasks) {
      expect(t.why.length).toBeGreaterThan(30);
      if (t.caseId) expect(ids.has(t.caseId), t.caseId).toBe(true);
    }
    expect(CURRICULUM.length).toBe(5);
  });
  it('checks pass only when the learner state meets the criterion', () => {
    expect(evaluateTasks(snap())).toEqual([]);
    expect(evaluateTasks(snap({ viewProgress: { plax: 72 } }))).toContain('plax-70');
    expect(evaluateTasks(snap({ viewProgress: { plax: 65 } }))).not.toContain('plax-70');
    expect(evaluateTasks(snap({ modality: 'color', colorScaleMps: 0.3 }))).toContain('colour-low-scale');
    expect(evaluateTasks(snap({ modality: 'pw', gateStructure: 18, gateFlowAngleDeg: 12 }))).toContain('pw-lvot-aligned');
    expect(evaluateTasks(snap({ modality: 'pw', gateStructure: 18, gateFlowAngleDeg: 35 }))).not.toContain('pw-lvot-aligned');
    const m: Measurement = { id: 'x', kind: 'linear', measurementId: 'lvot-diameter', technique: { score: 0.8, findings: [] }, label: '', value: 2, units: 'cm', modality: '2d', sourceViewId: 'plax', viewScore: 80, frameId: 1, phase: 0.2, timeS: 1, geometry: [], imageQualityScore: null, userAssisted: false, referenceGuidelineIds: [], createdAt: '' };
    expect(evaluateTasks(snap({ measurements: [m] }))).toContain('lvot-diameter-ok');
    expect(evaluateTasks(snap({ measurements: [{ ...m, technique: { score: 0.3, findings: [] } }] }))).not.toContain('lvot-diameter-ok');
    expect(evaluateTasks(snap({ caseId: 'aortic-stenosis-severe', impressionScore: 80 }))).toContain('impression-as');
    expect(evaluateTasks(snap({ caseId: 'normal-excellent-window', impressionScore: 80 }))).not.toContain('impression-as');
  });
});

describe('local progress', () => {
  const mem = (): ProgressStorage & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  };
  it('persists events and completed tasks, summarises and exports without identifiers', () => {
    const st = mem();
    let p = emptyProgress();
    p = addEvent(p, { t: 1, kind: 'case', caseId: 'normal-excellent-window' });
    p = addEvent(p, { t: 2, kind: 'view', caseId: 'normal-excellent-window', viewId: 'plax', score: 60 });
    p = addEvent(p, { t: 3, kind: 'view', caseId: 'normal-excellent-window', viewId: 'plax', score: 82 });
    p = addEvent(p, { t: 4, kind: 'measurement', caseId: 'normal-excellent-window', measurementId: 'lvot-diameter', techniqueScore: 0.75, value: 2.1 });
    p = completeTask(p, 'plax-70', 5);
    p = completeTask(p, 'plax-70', 6); // idempotent
    saveProgress(st, p);
    const back = loadProgress(st);
    expect(back.completedTasks).toEqual({ 'plax-70': 5 });
    expect(back.events.length).toBe(5);
    const sum = summarizeProgress(back);
    expect(sum.bestViewScores['plax']).toBe(82);
    expect(sum.viewAttempts['plax']).toBe(2);
    expect(sum.meanTechniqueScore).toBeCloseTo(0.75, 6);
    expect(sum.completedTasks).toBe(1);
    expect(sum.casesOpened).toEqual(['normal-excellent-window']);
    const json = exportProgressJson(back, '0.1.0');
    expect(json).not.toMatch(/email|name|user/i);
    expect(JSON.parse(json).progress.events.length).toBe(5);
    expect(loadProgress(null).events).toEqual([]);
    st.setItem('echotwin.progress.v1', '{broken');
    expect(loadProgress(st).events).toEqual([]);
  });
});

describe('causal explanations', () => {
  const analysis = (over: Partial<ViewAnalysis>): ViewAnalysis =>
    ({
      window: 'parasternal',
      bestViewId: 'plax',
      bestViewName: 'PLAX',
      score: 40,
      components: { plane: 0.5, landmarks: 0.5, geometry: 0.9, centering: 0.9, depth: 0.9, gain: 0.9, artifacts: 0.9 },
      visibleLandmarks: [],
      missingLandmarks: ['la', 'av'],
      penaltyLandmarksPresent: [],
      foreshorteningDeg: 0,
      planeAngleDeg: 25,
      inPlaneRotationDeg: 5,
      offsetCm: 0.5,
      hints: [],
      perView: [],
      heartCoverage: 0.5,
      shadowFraction: 0.3,
      ...over,
    }) as ViewAnalysis;
  it('names cause, effect and remedy for oblique plane, missing landmarks and shadowing', () => {
    const ex = explainAnalysis(analysis({}), DEFAULT_ACQUISITION);
    const codes = ex.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(['oblique-plane', 'missing-landmarks', 'shadowing']));
    for (const e of ex) {
      expect(e.cause.length).toBeGreaterThan(10);
      expect(e.effect.length).toBeGreaterThan(10);
      expect(e.remedy.length).toBeGreaterThan(10);
    }
    expect(explainAnalysis(analysis({ components: { plane: 1, landmarks: 1, geometry: 1, centering: 1, depth: 1, gain: 1, artifacts: 1 }, planeAngleDeg: 2, missingLandmarks: [], shadowFraction: 0 }), DEFAULT_ACQUISITION)).toEqual([]);
    expect(Object.keys(DOPPLER_CAUSES)).toEqual(expect.arrayContaining(['aliasing', 'angle', 'blooming']));
  });
});
