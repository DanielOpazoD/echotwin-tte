// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useSimStore as SimStoreHook } from './store';

/**
 * The store holds the product state the E2E suite used to be the only witness of (engineering audit, B5):
 * preferences that survive a corrupt localStorage, the exam-mode policy, measurement arming, the
 * exclusive finding groups and what a case load resets. The module reads localStorage on import, so each
 * test imports a fresh copy after seeding storage.
 */
async function freshStore(prefs?: string): Promise<typeof SimStoreHook> {
  localStorage.clear();
  if (prefs !== undefined) localStorage.setItem('echotwin.prefs.v1', prefs);
  vi.resetModules();
  return (await import('./store')).useSimStore;
}

describe('useSimStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to the default preferences when the stored ones are corrupt', async () => {
    const store = await freshStore('{not json');
    const ui = store.getState().ui;
    expect(ui.showTorso).toBe(true);
    expect(ui.tutorialDone).toBe(false);
    expect(ui.screen).toBe('simulator');
  });

  it('restores only the persisted preferences and never the screen or the tools', async () => {
    const store = await freshStore(
      JSON.stringify({ showTorso: false, tutorialDone: true, screen: 'report', devPanel: true }),
    );
    const s = store.getState();
    expect(s.ui.showTorso).toBe(false);
    expect(s.ui.tutorialDone).toBe(true);
    // `screen` and `devPanel` are spread in from storage too: this documents the current behaviour so a
    // change to it is deliberate — the E2E "reload preserves only allowed preferences" checks the save side
    expect(s.measurements).toEqual([]);
    expect(s.activeTool).toBe('none');
  });

  it('the view guide starts hidden at every load, even when an older save kept it open (decision 188)', async () => {
    const store = await freshStore(JSON.stringify({ guidanceOpen: true, showEcg: false }));
    expect(store.getState().ui.guidanceOpen).toBe(false);
    expect(store.getState().ui.showEcg).toBe(false);
    store.getState().setUi({ guidanceOpen: true });
    const saved = JSON.parse(localStorage.getItem('echotwin.prefs.v1') ?? '{}') as Record<
      string,
      unknown
    >;
    expect('guidanceOpen' in saved).toBe(false);
  });

  it('setUi persists the allowed keys and drops the transient ones', async () => {
    const store = await freshStore();
    store.getState().setUi({ showEcg: false, devPanel: true, screen: 'report' });
    const saved = JSON.parse(localStorage.getItem('echotwin.prefs.v1') ?? '{}') as Record<
      string,
      unknown
    >;
    expect(saved['showEcg']).toBe(false);
    expect('devPanel' in saved).toBe(false);
    expect('screen' in saved).toBe(false);
  });

  it('exam mode clears progress and measurements and disables the dev tools; leaving it keeps them', async () => {
    const store = await freshStore();
    const st = store.getState();
    st.setUi({ devPanel: true, showPhysics: true });
    st.recordViewScore('plax', 80);
    st.addMeasurement({
      id: 'm1',
      kind: 'distance',
      label: 'x',
      value: 1,
      units: 'cm',
      measurementId: null,
      technique: null,
      frameId: 0,
      geometry: [],
      captureSector: null,
    } as unknown as Parameters<typeof st.addMeasurement>[0]);
    expect(store.getState().viewProgress['plax']).toBe(80);
    st.setMode('exam');
    const exam = store.getState();
    expect(exam.mode).toBe('exam');
    expect(exam.viewProgress).toEqual({});
    expect(exam.measurements).toEqual([]);
    expect(exam.ui.showHints).toBe(false);
    expect(exam.ui.devPanel).toBe(false);
    expect(exam.ui.showPhysics).toBe(false);
    exam.recordViewScore('a4c', 60);
    exam.setMode('sandbox');
    const back = store.getState();
    expect(back.ui.showHints).toBe(true);
    expect(back.viewProgress['a4c']).toBe(60);
  });

  it('a preset view is ignored in exam mode and animates otherwise', async () => {
    const store = await freshStore();
    store.getState().setMode('exam');
    store.getState().startPresetView('plax');
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getState().presetAnim).toBeNull();
    store.getState().setMode('sandbox');
    store.getState().startPresetView('plax');
    // the pose is asked of the worker (none here: the main-thread models answer after loading on demand)
    // the main-thread models build on demand (~1 s idle; 5 s was exceeded at load 100+ with no fault in the code)
    await vi.waitFor(() => expect(store.getState().presetAnim).not.toBeNull(), { timeout: 20_000 });
    const anim = store.getState().presetAnim;
    expect(anim!.viewId).toBe('plax');
    expect(store.getState().targetViewId).toBe('plax');
    // a manual move cancels the animation
    store.getState().nudgeProbe({ u: 0.1 });
    expect(store.getState().presetAnim).toBeNull();
  });

  it('arming a protocol measurement selects its tool, and an unknown id disarms', async () => {
    const store = await freshStore();
    store.getState().setActiveMeasurement('lvot-diameter');
    expect(store.getState().activeMeasurementId).toBe('lvot-diameter');
    expect(store.getState().activeTool).toBe('caliper');
    store.getState().setActiveMeasurement('no-such-measurement');
    expect(store.getState().activeMeasurementId).toBeNull();
    expect(store.getState().activeTool).toBe('none');
    // a free tool drops the protocol id
    store.getState().setActiveMeasurement('lvot-diameter');
    store.getState().setActiveTool('time');
    expect(store.getState().activeMeasurementId).toBeNull();
    expect(store.getState().activeTool).toBe('time');
  });

  it('findings of an exclusive group replace each other; others accumulate and toggle', async () => {
    const store = await freshStore();
    const s = store.getState();
    s.toggleFinding('ef-normal');
    s.toggleFinding('lv-dilated');
    s.toggleFinding('ef-severe');
    expect(store.getState().impressionSelection).toEqual(['lv-dilated', 'ef-severe']);
    store.getState().toggleFinding('lv-dilated');
    expect(store.getState().impressionSelection).toEqual(['ef-severe']);
  });

  it('the probe is clamped and its rotation wraps to (−180, 180]', async () => {
    const store = await freshStore();
    store.getState().setProbe({ u: 99, v: -99, rotationDeg: 190, tiltDeg: 100, pressure: 2 });
    const p = store.getState().probe;
    expect(p.u).toBe(14);
    expect(p.v).toBe(-12);
    expect(p.rotationDeg).toBe(-170);
    expect(p.tiltDeg).toBe(70);
    expect(p.pressure).toBe(1);
  });

  it('loading a case resets the session state and records the event', async () => {
    const store = await freshStore();
    const s = store.getState();
    s.toggleFreeze();
    s.recordViewScore('plax', 50);
    s.toggleFinding('ef-normal');
    s.setProbe({ u: 5 });
    s.loadCase('aortic-stenosis-severe');
    const after = store.getState();
    expect(after.caseId).toBe('aortic-stenosis-severe');
    expect(after.frozen).toBe(false);
    expect(after.viewProgress).toEqual({});
    expect(after.impressionSelection).toEqual([]);
    expect(after.probe.u).toBe(3.4);
    expect(after.progress.events.at(-1)).toMatchObject({
      kind: 'case',
      caseId: 'aortic-stenosis-severe',
    });
  });

  it('an exam starts from scratch: pose, preset, impression, freeze and artifact lab of the practice stay behind (decision 235)', async () => {
    const store = await freshStore();
    const { START_PROBE } = await import('./store');
    const s = store.getState();
    s.setArtifactLab({ sideLobe: 0, mirror: 0, beamWidth: 0, clutter: 0 });
    s.setProbe({ u: 6.1, v: -3.2, rotationDeg: -70, tiltDeg: 30 });
    s.recordViewScore('a4c', 97);
    s.toggleFinding('ef-normal');
    s.setTargetView('a4c');
    s.toggleFreeze();
    store.setState({
      presetViews: ['a4c'],
      presetAnim: {
        from: s.probe,
        to: { ...s.probe, u: 7 },
        startMs: 0,
        durationMs: 1000,
        viewId: 'a4c',
      },
    });
    store.getState().setMode('exam');
    const exam = store.getState();
    expect(exam.probe).toEqual(START_PROBE);
    // the artifact lab, hidden in the exam, would keep the artifacts the learner switched off in practice
    expect(exam.artifactLab).toBeNull();
    expect(exam.presetAnim).toBeNull();
    expect(exam.presetViews).toEqual([]);
    expect(exam.targetViewId).toBeNull();
    expect(exam.impressionSelection).toEqual([]);
    expect(exam.frozen).toBe(false);
    expect(exam.viewProgress).toEqual({});
  });

  it('a preset pose that arrives after the exam began does not move the probe, even back in practice (decision 235)', async () => {
    const store = await freshStore();
    const { START_PROBE } = await import('./store');
    // the worker answers with the preset's pose on the next tick, when the exam has already begun
    const { frameBus } = await import('./frameBus');
    const to = { ...START_PROBE, u: 8, rotationDeg: -60 };
    vi.spyOn(frameBus, 'request').mockResolvedValue({ kind: 'canonicalControl', control: to });
    for (const back of [false, true]) {
      store.getState().startPresetView('a4c');
      store.getState().setMode('exam');
      // a learner who leaves the exam before the pose arrives is not handed a preset they asked for before it
      if (back) store.getState().setMode('sandbox');
      await new Promise((r) => setTimeout(r, 0));
      expect(store.getState().presetAnim, `back in practice: ${back}`).toBeNull();
      expect(store.getState().probe).toEqual(START_PROBE);
      store.getState().setMode('sandbox');
    }
  });

  it('loading a case and starting an exam reset the same session (decision 235)', async () => {
    const store = await freshStore();
    const dirty = () => {
      store.getState().setTargetView('a4c');
      store.getState().setArtifactLab({ sideLobe: 0.5, mirror: 0, beamWidth: 0, clutter: 0 });
      store.getState().recordViewScore('plax', 70);
    };
    dirty();
    store.getState().loadCase('aortic-stenosis-severe');
    const loaded = store.getState();
    dirty();
    store.getState().setMode('exam');
    const exam = store.getState();
    for (const s of [loaded, exam]) {
      expect(s.targetViewId).toBeNull();
      expect(s.artifactLab).toBeNull();
      expect(s.viewProgress).toEqual({});
    }
  });

  it('the exam records nothing for a volley of free measurements (decision 235)', async () => {
    const store = await freshStore();
    const { loadCaseById } = await import('@/cases');
    const { computeGroundTruth } = await import('@/simulator/hemodynamics/groundTruth');
    store.getState().setMode('exam');
    const s = store.getState();
    const volley = (['linear', 'vti', 'velocity'] as const).flatMap((kind) =>
      Array.from({ length: 40 }, (_, i) => ({
        id: `${kind}-${i}`,
        kind,
        label: 'Libre',
        value: 0.1 * 1000 ** (i / 39),
        units: 'cm',
        modality: '2d',
        sourceViewId: null,
        viewScore: 90,
        frameId: 0,
        phase: 0,
        timeS: 0,
        geometry: [],
        imageQualityScore: 90,
        userAssisted: false,
        referenceGuidelineIds: [],
        createdAt: '2026-09-27T00:00:00Z',
      })),
    );
    store.setState({ truth: computeGroundTruth(loadCaseById(s.caseId)), measurements: volley });
    store.getState().finishExam();
    expect(store.getState().progress.events.at(-1)).toMatchObject({
      kind: 'exam',
      measurements: 0,
    });
  });

  it('finishing the exam without a truth still freezes and opens the report', async () => {
    const store = await freshStore();
    store.getState().setMode('exam');
    store.getState().finishExam();
    const s = store.getState();
    expect(s.examFinished).toBe(true);
    expect(s.frozen).toBe(true);
    expect(s.ui.screen).toBe('report');
  });
});

/**
 * An action that changes nothing notifies nobody (decision 173): `set` with a new object, even an empty one, wakes every
 * subscriber, and the HUD recorded the view score every 120 ms whether it rose or not, so every one of those
 * notifications was empty and the simulation hook serialised its whole input for each.
 */
describe('actions that change nothing do not notify', () => {
  it('the view score when it does not rise, tasks already done, a missing preset animation or undo', async () => {
    const useSimStore = await freshStore();
    let notified = 0;
    const unsub = useSimStore.subscribe(() => notified++);
    const s = useSimStore.getState();
    s.recordViewScore('a4c', 60);
    expect(notified).toBe(1);
    s.recordViewScore('a4c', 50);
    s.recordViewScore('a4c', 60);
    s.completeTasks([]);
    s.tickPresetAnimation(0);
    s.undoReviewRemove();
    expect(notified).toBe(1);
    s.recordViewScore('a4c', 70);
    expect(notified).toBe(2);
    unsub();
  });
});

/**
 * The curriculum counts views acquired by hand (decision 174): a view whose preset the learner used keeps its score for
 * the exam summary but adds nothing to the hand-acquired progress until the case is loaded again.
 */
describe('views reached with their preset are not acquired by hand', () => {
  it('until the case is reloaded; other views still count', async () => {
    const useSimStore = await freshStore();
    const s = useSimStore.getState();
    s.startPresetView('a4c');
    s.recordViewScore('a4c', 85);
    s.recordViewScore('a2c', 64);
    let st = useSimStore.getState();
    expect(st.viewProgress).toEqual({ a4c: 85, a2c: 64 });
    expect(st.handViewProgress).toEqual({ a2c: 64 });
    st.loadCase(st.caseId);
    st = useSimStore.getState();
    expect(st.presetViews).toEqual([]);
    st.recordViewScore('a4c', 70);
    expect(useSimStore.getState().handViewProgress).toEqual({ a4c: 70 });
  });
});

/**
 * The learner's record is what the teacher reads (decision 236): the views reached with a preset are not the learner's,
 * and a score that wavers by a point does not add an entry.
 */
describe("the learner's record keeps the views reached by hand (decision 236)", () => {
  it('a preset view records nothing; by hand, the first score and each rise of 5 or more over the best', async () => {
    const store = await freshStore();
    const views = () =>
      store
        .getState()
        .progress.events.filter((e) => e.kind === 'view')
        .map((e) => (e.kind === 'view' ? `${e.viewId} ${e.score}` : ''));
    store.setState({ presetViews: ['a4c'] });
    store.getState().recordViewScore('a4c', 97);
    expect(store.getState().viewProgress['a4c']).toBe(97);
    expect(views()).toEqual([]);
    for (const score of [60, 63, 70, 69, 72, 78]) store.getState().recordViewScore('plax', score);
    expect(views()).toEqual(['plax 60', 'plax 70', 'plax 78']);
  });
});

/**
 * Each spectral mode opens with its own velocity window and keeps the one the learner leaves it with (decision 230). One
 * set used to serve pulsed wave, continuous wave and tissue Doppler: continuous wave opened on ±1 m/s and tissue Doppler on
 * a scale outside its own slider.
 */
describe('spectral settings follow the mode', () => {
  it('each spectral mode opens inside its own slider, with its own window', async () => {
    const store = await freshStore();
    const { SPECTRAL_MODE_DEFAULTS, SPECTRAL_SCALE_RANGE } =
      await import('@/simulator/doppler/spectral/spectrum');
    for (const m of ['pw', 'cw', 'tdi'] as const) {
      store.getState().setModality('2d');
      store.getState().setModality(m);
      const sp = store.getState().spectral;
      expect(sp.scaleMps, m).toBe(SPECTRAL_MODE_DEFAULTS[m].scaleMps);
      expect(sp.wallFilterMps, m).toBe(SPECTRAL_MODE_DEFAULTS[m].wallFilterMps);
      expect(sp.scaleMps, `${m} inside its slider`).toBeGreaterThanOrEqual(
        SPECTRAL_SCALE_RANGE[m].min,
      );
      expect(sp.scaleMps, `${m} inside its slider`).toBeLessThanOrEqual(
        SPECTRAL_SCALE_RANGE[m].max,
      );
    }
    // continuous wave holds the fastest jets of the cases; tissue Doppler keeps the slow tissue velocities
    store.getState().setModality('cw');
    expect(store.getState().spectral.scaleMps).toBeGreaterThanOrEqual(5);
    store.getState().setModality('tdi');
    expect(store.getState().spectral.scaleMps).toBeLessThanOrEqual(0.4);
    expect(store.getState().spectral.wallFilterMps).toBeLessThanOrEqual(0.02);
  });

  it('a mode keeps what the learner set in it, and the others keep theirs', async () => {
    const store = await freshStore();
    const st = () => store.getState();
    st().setModality('tdi');
    st().setSpectral({ scaleMps: 0.3, gainDb: 6 });
    st().setModality('pw');
    expect(st().spectral.scaleMps).toBe(1.0);
    expect(st().spectral.gainDb).toBe(0);
    st().setSpectral({ scaleMps: 1.5 });
    st().setModality('2d');
    st().setModality('tdi');
    expect(st().spectral.scaleMps).toBe(0.3);
    expect(st().spectral.gainDb).toBe(6);
    st().setModality('pw');
    expect(st().spectral.scaleMps).toBe(1.5);
    // settings that are not per mode stay with the machine
    st().setSpectral({ sweepSpeedMmPerS: 100 });
    st().setModality('cw');
    expect(st().spectral.sweepSpeedMmPerS).toBe(100);
  });
});
