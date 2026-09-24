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
