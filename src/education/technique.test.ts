import { describe, expect, it } from 'vitest';
import { evaluateTechnique, type MeasurementContext, type PhaseMarks } from './technique';
import { getMeasurementSpec, MEASUREMENT_SPECS } from '@/simulator/measurements/protocol';
import { Structure } from '@/simulator/anatomy/tissue';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { computeGroundTruth } from '@/simulator/hemodynamics/groundTruth';
import { buildBeatTables } from '@/simulator/cardiac-cycle/cycleModel';

const marks: PhaseMarks = { ejectionStart: 0.08, ejectionEnd: 0.4, mitralOpen: 0.48, eEnd: 0.7, aStart: 0.85, aEnd: 0.98, hasAWave: true };
const base = (over: Partial<MeasurementContext>): MeasurementContext => ({ modality: '2d', viewId: 'plax', viewScore: 80, phase: 0.2, phaseMarks: marks, gate: null, ...over });

describe('technique evaluation', () => {
  it('LVOT diameter: right view/phase/placement scores 1; A4C is invalid; wrong phase warns', () => {
    const spec = getMeasurementSpec('lvot-diameter')!;
    const seg = Array(20).fill(Structure.Lvot) as number[];
    const good = evaluateTechnique(spec, base({ segmentStructures: seg, segmentEndsOutside: [Structure.LvWallSeptal, Structure.MitralAnterior] }));
    expect(good.score).toBe(1);
    expect(good.findings.every((f) => f.level === 'ok')).toBe(true);
    const wrongView = evaluateTechnique(spec, base({ viewId: 'a4c', segmentStructures: seg }));
    expect(wrongView.findings.find((f) => f.code === 'view')?.level).toBe('invalid');
    expect(wrongView.score).toBeLessThan(0.5);
    const wrongPhase = evaluateTechnique(spec, base({ phase: 0.6, segmentStructures: seg }));
    expect(wrongPhase.findings.find((f) => f.code === 'phase')?.level).toBe('invalid');
  });
  it('cavity calipers detect wall inclusion and endpoints inside the cavity', () => {
    const spec = getMeasurementSpec('lv-edd')!;
    const seg = [...(Array(14).fill(Structure.LvCavity) as number[]), ...(Array(6).fill(Structure.LvWallLateral) as number[])];
    const r = evaluateTechnique(spec, base({ phase: 0.0, segmentStructures: seg }));
    expect(r.findings.find((f) => f.code === 'placement')?.level).toBe('warn');
    const inside = evaluateTechnique(spec, base({ phase: 0.0, segmentStructures: Array(20).fill(Structure.LvCavity) as number[], segmentEndsOutside: [Structure.LvCavity, Structure.LvWallLateral] }));
    expect(inside.findings.find((f) => f.code === 'edges')?.level).toBe('warn');
  });
  it('PW gate placement and beam–flow alignment', () => {
    const spec = getMeasurementSpec('lvot-vti')!;
    const gateOk = { structure: Structure.Lvot, tissue: 1, flowPresent: true, flowAngleDeg: 12, lineStructures: [] };
    const ok = evaluateTechnique(spec, base({ modality: 'pw', viewId: 'a5c', gate: gateOk }));
    expect(ok.score).toBe(1);
    const misplaced = evaluateTechnique(spec, base({ modality: 'pw', viewId: 'a5c', gate: { ...gateOk, structure: Structure.RvCavity } }));
    expect(misplaced.findings.find((f) => f.code === 'placement')?.level).toBe('invalid');
    const oblique = evaluateTechnique(spec, base({ modality: 'pw', viewId: 'a5c', gate: { ...gateOk, flowAngleDeg: 45 } }));
    expect(oblique.findings.find((f) => f.code === 'alignment')?.level).toBe('invalid');
    expect(oblique.findings.find((f) => f.code === 'alignment')?.message).toContain('29 %');
  });
  it('CW needs the cursor line through the valve; TAPSE through the tricuspid annulus', () => {
    const av = getMeasurementSpec('av-vmax')!;
    const g = { structure: 0, tissue: 0, flowPresent: true, flowAngleDeg: 10, lineStructures: [Structure.LvCavity, Structure.Lvot, Structure.AorticValve, Structure.AorticRoot] };
    expect(evaluateTechnique(av, base({ modality: 'cw', viewId: 'a5c', gate: g })).findings.find((f) => f.code === 'placement')?.level).toBe('ok');
    expect(evaluateTechnique(av, base({ modality: 'cw', viewId: 'a5c', gate: { ...g, lineStructures: [Structure.LvCavity, Structure.LaCavity] } })).findings.find((f) => f.code === 'placement')?.level).toBe('invalid');
    const tapse = getMeasurementSpec('tapse')!;
    expect(evaluateTechnique(tapse, base({ modality: 'm-mode', viewId: 'a4c', gate: { ...g, lineStructures: [Structure.RvCavity, Structure.TricuspidAnnulus, Structure.RaCavity] } })).score).toBe(1);
  });
  it('IVRT between the aortic closure and mitral opening clicks: A5C, gate between outflow and inflow, truth from the case (decision 104)', () => {
    // before: no protocol measurement for the isovolumic relaxation time, whose clicks the spectral trace lacked
    const spec = getMeasurementSpec('ivrt');
    expect(spec?.tool).toBe('time');
    const gate = { structure: Structure.Lvot, tissue: 1, flowPresent: false, flowAngleDeg: null, lineStructures: [] };
    const ok = evaluateTechnique(spec!, base({ modality: 'pw', viewId: 'a5c', gate }));
    expect(ok.score).toBe(1);
    expect(evaluateTechnique(spec!, base({ modality: 'pw', viewId: 'a5c', gate: { ...gate, structure: Structure.LaCavity } })).findings.find((f) => f.code === 'placement')?.level).toBe('invalid');
    expect(evaluateTechnique(spec!, base({ modality: 'pw', viewId: 'a4c', gate })).findings.find((f) => f.code === 'view')?.level).toBe('invalid');
    for (const input of CASE_INPUTS) {
      const c = loadCaseById(input.id);
      const truth = computeGroundTruth(c, buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics));
      expect(spec!.truth(truth), input.id).toBe(c.physiology.ivrtMs);
    }
  });
  it('Simpson: foreshortened apex is flagged', () => {
    const spec = getMeasurementSpec('lv-edv-simpson')!;
    const r = evaluateTechnique(spec, base({ viewId: 'a4c', phase: 0.0, segmentStructures: Array(50).fill(Structure.LvCavity) as number[], longAxisCm: 6.6, trueLongAxisCm: 8.6 }));
    expect(r.findings.find((f) => f.code === 'foreshortening')?.level).toBe('invalid');
    const ok = evaluateTechnique(spec, base({ viewId: 'a4c', phase: 0.0, segmentStructures: Array(50).fill(Structure.LvCavity) as number[], longAxisCm: 8.3, trueLongAxisCm: 8.6 }));
    expect(ok.score).toBe(1);
  });
  it('every required measurement of every case has a spec with a truth value', () => {
    for (const input of CASE_INPUTS) {
      const c = loadCaseById(input.id);
      const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
      const truth = computeGroundTruth(c, tables);
      for (const req of c.requiredMeasurements) {
        const spec = getMeasurementSpec(req.measurementId);
        expect(spec, `${c.id}: ${req.measurementId}`).toBeDefined();
        const v = spec!.truth(truth);
        expect(v, `${c.id}: ${req.measurementId} truth`).not.toBeNull();
        expect(v!).toBeGreaterThan(0);
      }
    }
    for (const spec of MEASUREMENT_SPECS) {
      expect(spec.views.length).toBeGreaterThan(0);
      expect(spec.modalities.length).toBeGreaterThan(0);
    }
  });
});
