// @tier slow
import { describe, expect, it } from 'vitest';
import { loadCaseById } from '@/cases';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { buildCaseModels } from '@/simulator/anatomy/caseModels';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { beamFrameFromPose, poseFromControl, type ProbeControl } from '@/simulator/probe/pose';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { ProceduralSliceRenderer } from '@/simulator/renderer/procedural/sliceRenderer';
import {
  allocPolarFrame,
  DEFAULT_ACQUISITION,
  polarSpecFor,
  type Scene,
} from '@/simulator/renderer/types';
import { applyConsole, createConsoleState } from '@/simulator/renderer/postprocess/consolePipeline';
import { VIEW_WALLS } from '@/clinical/segmentation/catalog';
import { analyzeView, type ViewAnalysis } from './viewQuality';
import { segmentCoverage, type SegmentCoverage } from './segmentCoverage';

/**
 * LV segments of the drawn views (decision 152), through the chain of the app: the high tier the live display uses, the
 * console, and the view analysis. The labels come from the tissue each plane crosses, so these tests check the plane
 * against the standard's reference walls instead of copying them from the view's name.
 */
const c = loadCaseById('normal-excellent-window');
const { thorax, heart, tables } = buildCaseModels(c, {
  position: 'left-lateral',
  respiration: 'expiration',
  headElevationDeg: 0,
});
const ES = tables.timings.ejectionEndS / tables.rrS;

function analyse(
  control: ProbeControl,
  phase: number,
  models = { c, thorax, heart, tables },
): ViewAnalysis {
  const { c, thorax, heart, tables } = models;
  const settings = DEFAULT_ACQUISITION;
  const spec = polarSpecFor(settings, 'high');
  const beam = beamFrameFromPose(poseFromControl(thorax, control), 1);
  const scene: Scene = {
    heart,
    heartPose: computeHeartPose(heart, cycleStateAt(tables, phase)),
    thorax,
    physics: {
      frequencyMHz: settings.frequencyMHz,
      harmonics: settings.harmonics,
      clutterLevel: c.acousticWindow.clutterLevel,
      windowAttenuation: c.acousticWindow.chestWallAttenuation,
      seed: c.seed,
    },
  };
  const frame = allocPolarFrame(spec);
  new ProceduralSliceRenderer().render(scene, beam, spec, phase, frame);
  const display = new Uint8ClampedArray(spec.lines * spec.samples);
  applyConsole(frame, settings, createConsoleState(c.seed), display);
  return analyzeView({
    heart,
    thorax,
    control,
    beam,
    frame,
    display,
    settings,
    heartPose: scene.heartPose,
  });
}
const viewAt = (id: string, phase: number) =>
  analyse(canonicalControl(getViewTarget(id), heart, thorax), phase);
const ids = (cov: SegmentCoverage[], pick: (s: SegmentCoverage) => boolean) =>
  cov.filter(pick).map((s) => s.segmentId);

/** Reference segments of each view: the walls of the apical and long-axis views, the ring of each short axis. */
const REFERENCE: Record<string, number[]> = {
  a4c: [...VIEW_WALLS.a4c.flat(), 17],
  a2c: [...VIEW_WALLS.a2c.flat(), 17],
  a3c: [...VIEW_WALLS.a3c.flat(), 17],
  plax: VIEW_WALLS.plax.flat(),
  'psax-mv': [1, 2, 3, 4, 5, 6],
  'psax-pm': [7, 8, 9, 10, 11, 12],
  'psax-apex': [13, 14, 15, 16],
};

/**
 * Reference segments the model's view crosses but does not show well enough to judge (model debt, docs/LIMITATIONS.md,
 * «Segmentos no evaluables en vistas de referencia»): the A3C sector, turned 120° from the four-chamber view on the same
 * apical probe, crosses the intercostal space instead of running along it, and 16 % of its rays meet a rib before 4 cm;
 * the beam march spreads the rib's attenuation over the beam width and leaves the mid and apical anteroseptal wall at a
 * transmission of 0.001–0.002 against 0.03–0.19 elsewhere (decision 165). With the ribs made muscle both segments light
 * up (83 and 88 against a cavity of 49); the fibre helix gain there is that of the other walls.
 */
const KNOWN_NOT_ASSESSABLE: Record<string, number[]> = {
  a3c: [8, 14],
};

/**
 * Segments outside the reference that the drawn plane shows well, measured (same entry of docs/LIMITATIONS.md): the
 * A3C plane meets the apex on the anterior side of the 13|14 boundary, the PLAX reaches the apical level of the
 * inferolateral wall, and the basal short axis is oblique enough to cut the mid anteroseptal wall.
 */
const KNOWN_EXTRA_ASSESSABLE: Record<string, number[]> = {
  a3c: [13],
  plax: [16],
  'psax-mv': [8],
};

describe('LV segments of the drawn views', () => {
  const ed = new Map(Object.keys(REFERENCE).map((v) => [v, viewAt(v, 0)]));

  it('crosses every reference segment of each view at end-diastole and shows them assessable', () => {
    for (const [view, ref] of Object.entries(REFERENCE)) {
      const cov = ed.get(view)!.segments.aha17;
      const inPlane = ids(cov, (s) => s.inPlane);
      const assessable = ids(cov, (s) => s.assessable);
      for (const id of ref) expect(inPlane, `${view}: ${id} in the plane`).toContain(id);
      const known = KNOWN_NOT_ASSESSABLE[view] ?? [];
      for (const id of ref.filter((x) => !known.includes(x)))
        expect(assessable, `${view}: ${id} assessable`).toContain(id);
      // a declared limitation that no longer holds is stale: it would hide a requirement that is met
      for (const id of known) {
        const s = cov.find((x) => x.segmentId === id)!;
        expect(s.assessable, `${view}: ${id} is declared not assessable`).toBe(false);
        expect(s.reason).toBe('insufficient_border_visibility');
      }
    }
  });

  it('labels only what the plane crosses: no segment of the other walls, extras measured and declared', () => {
    for (const phase of [0, ES]) {
      for (const view of Object.keys(REFERENCE)) {
        const a = phase === 0 ? ed.get(view)! : viewAt(view, phase);
        const cov = a.segments.aha17;
        const ref = REFERENCE[view]!;
        const extras = ids(cov, (s) => s.assessable && !ref.includes(s.segmentId));
        const declared = KNOWN_EXTRA_ASSESSABLE[view] ?? [];
        for (const id of extras)
          expect(declared, `${view} phase ${phase}: extra ${id}`).toContain(id);
        if (view.startsWith('a')) {
          // apical views: the basal and mid segments of the other two walls are not in the plane at all
          const otherWalls = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter(
            (x) => !ref.includes(x),
          );
          expect(
            ids(cov, (s) => s.inPlane && otherWalls.includes(s.segmentId)),
            view,
          ).toEqual([]);
        }
        if (view === 'plax') expect(ids(cov, (s) => s.inPlane && s.segmentId === 17)).toEqual([]);
        if (view === 'psax-pm' || view === 'psax-apex')
          // the short axes with a cavity are proximal to the cap
          expect(
            ids(cov, (s) => s.inPlane && s.segmentId === 17),
            view,
          ).toEqual([]);
        if (view === 'psax-mv' || view === 'psax-pm')
          expect(
            ids(cov, (s) => s.inPlane && s.segmentId >= 13),
            view,
          ).toEqual([]);
        if (view === 'psax-apex')
          expect(
            ids(cov, (s) => s.inPlane && s.segmentId <= 12),
            view,
          ).toEqual([]);
      }
    }
    for (const [view, declared] of Object.entries(KNOWN_EXTRA_ASSESSABLE)) {
      const cov = ed.get(view)!.segments.aha17;
      for (const id of declared)
        expect(
          ids(cov, (s) => s.assessable),
          `${view}: declared extra ${id} is stale`,
        ).toContain(id);
    }
  });

  it('gives an oblique cut the segments it crosses, not those of the view it resembles', () => {
    const a4 = canonicalControl(getViewTarget('a4c'), heart, thorax);
    const a2 = canonicalControl(getViewTarget('a2c'), heart, thorax);
    const t = 0.25;
    const between: ProbeControl = {
      ...a4,
      rotationDeg: a4.rotationDeg + (a2.rotationDeg - a4.rotationDeg) * t,
      tiltDeg: a4.tiltDeg + (a2.tiltDeg - a4.tiltDeg) * t,
      rockDeg: a4.rockDeg + (a2.rockDeg - a4.rockDeg) * t,
    };
    const a = analyse(between, 0);
    // the view recogniser still calls it a four-chamber view…
    expect(a.bestViewId).toBe('a4c');
    const assessable = ids(a.segments.aha17, (s) => s.assessable);
    // …but the plane has left the inferoseptum for the inferior wall
    expect(assessable.some((id) => [4, 10, 15].includes(id))).toBe(true);
    expect(assessable).not.toContain(3);
    expect(assessable).not.toEqual(ids(ed.get('a4c')!.segments.aha17, (s) => s.assessable));
  });

  it('gives the apex of the 16-segment model to the apical segments and counts no segment 17', () => {
    const a = ed.get('a4c')!.segments;
    expect(a.lv16).toHaveLength(16);
    expect(a.aha17).toHaveLength(17);
    const area = (cov: SegmentCoverage[], id: number) =>
      cov.find((s) => s.segmentId === id)!.areaCm2;
    // the cap the A4C crosses goes to the apical segments of its quadrants, most of it to the septal and lateral ones
    const cap = area(a.aha17, 17);
    expect(cap).toBeGreaterThan(0.3);
    const apical = (cov: SegmentCoverage[]) =>
      [13, 14, 15, 16].reduce((t, id) => t + area(cov, id), 0);
    expect(apical(a.lv16)).toBeCloseTo(apical(a.aha17) + cap, 9);
    const toSeptalLateral =
      area(a.lv16, 14) + area(a.lv16, 16) - area(a.aha17, 14) - area(a.aha17, 16);
    expect(toSeptalLateral).toBeGreaterThan(cap * 0.5);
  });

  it('counts a wall the lung hides as in the plane but not insonified, not as outside the plane', () => {
    // the difficult window: lung over the lateral wall of the four-chamber view (the adversarial review's case)
    const d = loadCaseById('normal-difficult-window');
    const m = buildCaseModels(d, {
      position: 'left-lateral',
      respiration: 'expiration',
      headElevationDeg: 0,
    });
    const models = { c: d, thorax: m.thorax, heart: m.heart, tables: m.tables };
    const a = analyse(canonicalControl(getViewTarget('a4c'), m.heart, m.thorax), 0, models);
    const s16 = a.segments.aha17.find((s) => s.segmentId === 16)!;
    expect(s16.inPlane).toBe(true);
    expect(s16.insonified).toBe(false);
    expect(s16.reason).toBe('shadowed');
    // without the classified plane behind the pleura the same wall read as outside the plane
    const settings = DEFAULT_ACQUISITION;
    const spec = polarSpecFor(settings, 'high');
    const beam = beamFrameFromPose(
      poseFromControl(m.thorax, canonicalControl(getViewTarget('a4c'), m.heart, m.thorax)),
      1,
    );
    const frame = allocPolarFrame(spec);
    new ProceduralSliceRenderer().render(
      {
        heart: m.heart,
        heartPose: computeHeartPose(m.heart, cycleStateAt(m.tables, 0)),
        thorax: m.thorax,
        physics: {
          frequencyMHz: settings.frequencyMHz,
          harmonics: settings.harmonics,
          clutterLevel: d.acousticWindow.clutterLevel,
          windowAttenuation: d.acousticWindow.chestWallAttenuation,
          seed: d.seed,
        },
      },
      beam,
      spec,
      0,
      frame,
    );
    expect(segmentCoverage(frame, 'LV_AHA17')[15]!.reason).toBe('not_in_plane');
  });

  it('separates in the plane, insonified and assessable, and keeps the states without a display', () => {
    const settings = DEFAULT_ACQUISITION;
    const spec = { ...polarSpecFor(settings, 'low'), lines: 4, samples: 40 };
    const frame = allocPolarFrame(spec);
    // segment 9 over a line and a half, behind an extinguished beam on one of its lines
    for (let si = 10; si < 30; si++) {
      frame.segment[si] = 9;
      frame.transmission[si] = 0.5;
      frame.segment[spec.samples + si] = 9;
      frame.transmission[spec.samples + si] = 0.5;
      frame.segment[2 * spec.samples + si] = 9;
      frame.transmission[2 * spec.samples + si] = 1e-4;
    }
    const cov = segmentCoverage(frame, 'LV_AHA17');
    const s9 = cov[8]!;
    expect(s9.inPlane).toBe(true);
    expect(s9.insonifiedFraction).toBeCloseTo(2 / 3, 1);
    expect(s9.insonified).toBe(true);
    expect(s9.borderContrast).toBeNull();
    expect(cov[0]!.reason).toBe('not_in_plane');
    // the same segment wholly behind the extinguished beam
    for (let i = 0; i < frame.transmission.length; i++) frame.transmission[i] = 1e-4;
    const dark = segmentCoverage(frame, 'LV_AHA17')[8]!;
    expect(dark.inPlane).toBe(true);
    expect(dark.insonified).toBe(false);
    expect(dark.assessable).toBe(false);
    expect(dark.reason).toBe('shadowed');
  });
});
