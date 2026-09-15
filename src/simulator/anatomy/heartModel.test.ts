import { describe, expect, it } from 'vitest';
import {
  createHeartModel,
  computeHeartPose,
  classifyHeart,
  estimateStructureVolume,
  heartLandmarks,
  heartToTorso,
  ahaSegment,
  lvCavityRadiusAt,
} from './heartModel';
import { makeSample, Structure, Tissue } from './tissue';
import { normalExcellentCase } from '@/cases/normal-excellent';
import { validateCase } from '@/cases/schema';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { createRng } from '@/core/random';

const c = validateCase(normalExcellentCase).case!;
const model = createHeartModel(c.anatomy, c.physiology);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const edState = cycleStateAt(tables, 0.0);
const esPhase = tables.timings.ejectionEndS / tables.rrS;
const esState = cycleStateAt(tables, esPhase);
const edPose = computeHeartPose(model, edState);
const esPose = computeHeartPose(model, esState);

describe('heart model geometry', () => {
  it('LV centre is blood, LV wall is myocardium, outside is not heart', () => {
    const s = makeSample();
    const L = model.lv.lengthCm;
    expect(classifyHeart(model, edPose, 0, 0, L * 0.5, s)).toBe(true);
    expect(s.tissue).toBe(Tissue.Blood);
    expect(s.structure).toBe(Structure.LvCavity);
    // lateral wall at radius a + half thickness
    expect(
      classifyHeart(
        model,
        edPose,
        lvCavityRadiusAt(model, edPose, 0, L * 0.5) + 0.4,
        0,
        L * 0.5,
        s,
      ),
    ).toBe(true);
    expect(s.tissue).toBe(Tissue.Myocardium);
    expect(classifyHeart(model, edPose, 25, 25, 25, s)).toBe(false);
  });
  it(
    'LV cavity volume at ED ≈ EDV and at ES ≈ ESV (Monte Carlo, ±12%)',
    { timeout: 60_000 },
    () => {
      const rng = createRng(5);
      const L = model.lv.lengthCm;
      const box = { min: { x: -4, y: -4, z: -1 }, max: { x: 4, y: 4, z: L + 0.5 } };
      // papillary muscles are counted with the cavity, as in the ASE tracing convention
      const cav = [Structure.LvCavity, Structure.PapillaryMuscle];
      const vED = estimateStructureVolume(model, edPose, cav, 200000, () => rng.next(), box);
      const vES = estimateStructureVolume(model, esPose, cav, 200000, () => rng.next(), box);
      expect(Math.abs(vED - edState.lvVolumeMl) / edState.lvVolumeMl).toBeLessThan(0.1);
      expect(Math.abs(vES - esState.lvVolumeMl) / esState.lvVolumeMl).toBeLessThan(0.12);
      expect(vES).toBeLessThan(vED * 0.5);
    },
  );
  it('wall thickens in systole (incompressible myocardium)', () => {
    expect(edPose.thickK).toBeCloseTo(1, 1);
    expect(esPose.thickK).toBeGreaterThan(1.25);
    expect(esPose.thickK).toBeLessThan(2.2);
    // the papillary muscles stay rooted in the wall and their tips inside the cavity in both phases
    for (const hp of [edPose, esPose]) {
      const P = hp.paps;
      const s = makeSample();
      expect(
        classifyHeart(model, hp, (P[0]! + P[3]!) / 2, (P[1]! + P[4]!) / 2, (P[2]! + P[5]!) / 2, s),
      ).toBe(true);
      expect(s.structure).toBe(Structure.PapillaryMuscle);
      classifyHeart(model, hp, P[0]! * 1.06, P[1]! * 1.06, P[2]!, s);
      expect([
        Structure.LvWallLateral,
        Structure.LvWallInferior,
        Structure.LvWallAnterior,
        Structure.LvWallSeptal,
        Structure.PapillaryMuscle,
      ]).toContain(s.structure);
    }
  });
  it('mitral valve open in early diastole, closed in systole; aortic the opposite', () => {
    expect(esPose.mvAngleAnt).toBeGreaterThan(0.6); // closed: leaflet points inward to the coaptation
    const midEj = computeHeartPose(
      model,
      cycleStateAt(tables, (tables.timings.ejectionStartS + 0.1) / tables.rrS),
    );
    expect(midEj.avOpenAngle).toBeGreaterThan(0.6);
    expect(esPose.avOpenAngle).toBeLessThan(0.4); // closing at end-ejection
    const early = computeHeartPose(
      model,
      cycleStateAt(tables, (tables.timings.mitralOpenS + tables.timings.eAccelS) / tables.rrS),
    );
    expect(early.mvAngleAnt).toBeLessThan(-0.3); // open: swings outward toward the septum
    expect(early.avOpenAngle).toBeLessThan(0.3);
  });
  it('landmarks lie in the expected structures', () => {
    const s = makeSample();
    const lm = Object.fromEntries(heartLandmarks(model).map((l) => [l.id, l.p]));
    const at = (id: string) => {
      const p = lm[id]!;
      classifyHeart(model, edPose, p.x, p.y, p.z, s);
      return s.structure;
    };
    expect(at('lv-mid')).toBe(Structure.LvCavity);
    expect(at('la')).toBe(Structure.LaCavity);
    expect(at('ra')).toBe(Structure.RaCavity);
    expect(at('rv')).toBe(Structure.RvCavity);
    expect(at('rv-anterior')).toBe(Structure.RvCavity);
    expect(at('rvot')).toBe(Structure.Rvot);
    expect(at('aortic-root')).toBe(Structure.AorticRoot);
    expect([Structure.LvWallSeptal, Structure.LvWallAnterior]).toContain(at('ivs-anteroseptal'));
    expect([Structure.LvWallLateral, Structure.LvWallInferior]).toContain(at('wall-inferolateral'));
    expect(at('wall-anterior')).toBe(Structure.LvWallAnterior);
    expect([Structure.TricuspidValve, Structure.RvCavity]).toContain(at('tv')); // valve region landmark
    expect(at('ias')).toBe(Structure.InteratrialSeptum);
  });
  it('heart placed in torso: apex is left-inferior-anterior of the base, RV anterior of LV', () => {
    const f = model.frame;
    const base = heartToTorso(f, { x: 0, y: 0, z: 0 });
    const apex = heartToTorso(f, { x: 0, y: 0, z: model.lv.lengthCm });
    expect(apex.x).toBeGreaterThan(base.x); // patient's left
    expect(apex.y).toBeLessThan(base.y); // inferior
    expect(apex.z).toBeGreaterThan(base.z); // anterior
    const lm = Object.fromEntries(heartLandmarks(model).map((l) => [l.id, l.p]));
    const rv = heartToTorso(f, lm['rv']!);
    const lvMid = heartToTorso(f, lm['lv-mid']!);
    const la = heartToTorso(f, lm['la']!);
    expect(rv.z).toBeGreaterThan(lvMid.z);
    expect(la.z).toBeLessThan(lvMid.z);
  });
  it('AHA segments map azimuth/level correctly', () => {
    expect(ahaSegment(Math.PI / 2, 0.1)).toBe(1); // basal anterior
    expect(ahaSegment(Math.PI, 0.5)).toBe(9); // mid inferoseptal
    expect(ahaSegment(-Math.PI / 2, 0.8)).toBe(15); // apical inferior
    expect(ahaSegment(0, 0.99)).toBe(17);
  });
});
