import { describe, expect, it } from 'vitest';
import { buildBeatTables, cycleStateAt, sampleTable } from './cycleModel';
import { CardiacClock } from './clock';
import { ecgSample } from './ecg';
import { eWaveShape } from './timing';
import { normalExcellentCase } from '@/cases/normal-excellent';
import { validateCase } from '@/cases/schema';

const res = validateCase(normalExcellentCase);
if (!res.ok) throw new Error(res.errors.join('\n'));
const c = res.case!;

describe('beat tables (normal case)', () => {
  const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
  it('volume curve spans EDV→ESV with SV conserved and periodic', () => {
    expect(tables.edvMl).toBeCloseTo(120, 0);
    expect(tables.esvMl).toBeCloseTo(45, 0);
    expect(tables.strokeVolumeMl).toBeCloseTo(75, 0);
    const first = tables.lvVolumeMl[0] ?? 0;
    const last = tables.lvVolumeMl[tables.n - 1] ?? 0;
    expect(Math.abs(first - last)).toBeLessThan(3);
  });
  it('aortic flow integrates to SV and mitral flow too', () => {
    const dt = tables.rrS / tables.n;
    let ao = 0,
      mv = 0;
    for (let i = 0; i < tables.n; i++) {
      ao += (tables.aorticFlowMlps[i] ?? 0) * dt;
      mv += (tables.mitralFlowMlps[i] ?? 0) * dt;
    }
    expect(ao).toBeCloseTo(75, 0);
    expect(mv).toBeCloseTo(75, 0);
  });
  it('mitral effective flow area is physiologic (3–7 cm²)', () => {
    expect(tables.mvEffectiveAreaCm2).toBeGreaterThan(3);
    expect(tables.mvEffectiveAreaCm2).toBeLessThan(7);
  });
  it('valves open in the right order: AV during ejection, MV after IVRT, A wave late', () => {
    const t = tables.timings;
    expect(t.ejectionStartS).toBeLessThan(t.ejectionEndS);
    expect(t.ejectionEndS).toBeLessThan(t.mitralOpenS);
    expect(t.mitralOpenS).toBeLessThan(t.aStartS);
    expect(t.aEndS).toBeLessThanOrEqual(t.rrS);
    const sys = cycleStateAt(tables, (t.ejectionStartS + 0.1) / t.rrS);
    expect(sys.avOpen).toBeGreaterThan(0.7);
    expect(sys.mvOpen).toBeLessThan(0.05);
    const early = cycleStateAt(tables, (t.mitralOpenS + t.eAccelS) / t.rrS);
    expect(early.mvOpen).toBeGreaterThan(0.9);
    expect(early.avOpen).toBeLessThan(0.05);
  });
  it('E and A peak velocities emerge from flow / area', () => {
    let vmax = 0,
      vA = 0;
    const t = tables.timings;
    for (let i = 0; i < tables.n; i++) {
      const time = ((i + 0.5) / tables.n) * tables.rrS;
      const v = (tables.mitralFlowMlps[i] ?? 0) / tables.mvEffectiveAreaCm2 / 100;
      if (time < t.aStartS) vmax = Math.max(vmax, v);
      else vA = Math.max(vA, v);
    }
    expect(vmax).toBeCloseTo(0.8, 1);
    expect(vA).toBeCloseTo(0.55, 1);
  });
  it('sampleTable is periodic and interpolates', () => {
    expect(sampleTable(tables.lvVolumeMl, 0.3)).toBeCloseTo(sampleTable(tables.lvVolumeMl, 1.3), 6);
  });
});

describe('AF has no organized A wave and RR irregularity', () => {
  const af = { ...c.rhythm, type: 'atrial-fibrillation' as const, heartRateBpm: 90, rrVariabilityPct: 20 };
  const phys = { ...c.physiology, aPeakMps: 0 };
  const tables = buildBeatTables(60 / 90, phys, af, c.hemodynamics);
  it('no A wave', () => {
    expect(tables.timings.hasAWave).toBe(false);
    const late = cycleStateAt(tables, 0.95);
    expect(late.atrialContraction).toBe(0);
  });
  it('clock produces irregular but reproducible RR', () => {
    const a = new CardiacClock(af, 7);
    const b = new CardiacClock(af, 7);
    const rrs: number[] = [];
    for (let i = 0; i < 200; i++) {
      a.advance(0.05);
      b.advance(0.05);
      if (a.current.beatIndex !== (rrs.length ? rrs.length - 1 : -1)) rrs.push(a.current.rrS);
      expect(a.current.rrS).toBe(b.current.rrS);
    }
    const uniq = new Set(rrs.map((r) => r.toFixed(3)));
    expect(uniq.size).toBeGreaterThan(5);
  });
  it('ECG in AF has no P wave energy near rr−PR while sinus does', () => {
    const rr = 0.92;
    const sinus = ecgSample(rr - 0.12, rr, c.rhythm);
    const afv = ecgSample(rr - 0.12, rr, af);
    expect(sinus).toBeGreaterThan(0.1);
    expect(Math.abs(afv)).toBeLessThan(0.1);
  });
});

describe('clock', () => {
  it('phase wraps and beat index increments', () => {
    const clk = new CardiacClock(c.rhythm, 1);
    const s = clk.advance(1.0);
    expect(s.beatIndex).toBeGreaterThanOrEqual(1);
    expect(s.phase).toBeGreaterThanOrEqual(0);
    expect(s.phase).toBeLessThan(1);
  });
});

describe('annular recoil (decision 80)', () => {
  it('the annulus recoils at the case e′ in early diastole, in every case', async () => {
    // Tissue Doppler reads the longitudinal displacement curve. Its early-diastolic time constant used to be
    // 0.09·(10/e′) s: the normal heart (e′ 11 cm/s) recoiled at 4.6 cm/s, kept 86% of its systolic descent at mid-E
    // and tissue Doppler measured e′ 4.7 — the value an expert panel reported.
    const { CASE_INPUTS, loadCaseById } = await import('@/cases');
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const k = loadCaseById(input.id);
      const tb = buildBeatTables(60 / k.rhythm.heartRateBpm, k.physiology, k.rhythm, k.hemodynamics);
      const t = tb.timings;
      const dt = tb.rrS / tb.n;
      const earlyEnd = t.hasAWave ? t.aStartS : tb.rrS;
      let peak = 0;
      for (let i = 0; i < tb.n; i++) {
        const ti = (i + 0.5) * dt;
        if (ti > t.mitralOpenS && ti < earlyEnd) peak = Math.max(peak, -(tb.longitudinalVelocity[i] ?? 0) * k.physiology.mapseCm);
      }
      if (Math.abs(peak - k.physiology.ePrimeSeptalCmps) > 0.1 * k.physiology.ePrimeSeptalCmps) problems.push(`${input.id}: ${peak.toFixed(1)} cm/s against e′ ${k.physiology.ePrimeSeptalCmps}`);
    }
    expect(problems).toEqual([]);
  });
});


describe('the beat closes on its own flows (decision 95)', () => {
  /** Inflow minus outflow over the beat and the mitral inflow volume, integrated on the table. */
  const balance = (tb: ReturnType<typeof buildBeatTables>): { net: number; mitral: number } => {
    const dt = tb.rrS / tb.n;
    let net = 0,
      mitral = 0;
    for (let i = 0; i < tb.n; i++) {
      net += ((tb.mitralFlowMlps[i] ?? 0) + (tb.arFlowMlps[i] ?? 0) - (tb.aorticFlowMlps[i] ?? 0) - (tb.mrFlowMlps[i] ?? 0)) * dt;
      mitral += (tb.mitralFlowMlps[i] ?? 0) * dt;
    }
    return { net, mitral };
  };

  it('a fast rate that cuts the E wave still fills the stroke volume at the case velocities', () => {
    // at 110 bpm the normal E wave (75 ms IVRT, 90 + 180 ms) would end 86 ms into the next beat
    const tb = buildBeatTables(60 / 110, c.physiology, c.rhythm, c.hemodynamics);
    const t = tb.timings;
    expect(t.mitralOpenS + t.eAccelS + t.eDecelS).toBeGreaterThan(t.rrS + 0.05);
    const { net, mitral } = balance(tb);
    // before: the whole E wave was integrated, the inflow fell 7.9 mL (10.5%) short and the closing ramp added it back
    expect(Math.abs(mitral - 75)).toBeLessThan(0.1);
    expect(Math.abs(net)).toBeLessThan(0.1);
    expect(Math.abs(tb.volumeCorrectionMl - net)).toBeLessThan(1e-3);
    expect(tb.strokeVolumeMl).toBeCloseTo(75, 0);
    // the flow area carries the volume: outside atrial contraction the velocity at the orifice is still the case E wave,
    // sample by sample (during it, decision 97 below)
    let worst = 0;
    for (let i = 0; i < tb.n; i++) {
      const ti = (i + 0.5) * (tb.rrS / tb.n);
      if (ti > t.aStartS && ti < t.aEndS) continue;
      const v = ti > t.mitralOpenS ? 0.8 * eWaveShape(ti - t.mitralOpenS, t.eAccelS, t.eDecelS) : 0;
      worst = Math.max(worst, Math.abs((tb.mitralFlowMlps[i] ?? 0) / tb.mvEffectiveAreaCm2 / 100 - v));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('every case closes within 0.1% of its stroke volume, through a mitral flow area of 0.5–8 cm²', async () => {
    const { CASE_INPUTS, loadCaseById } = await import('@/cases');
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const k = loadCaseById(input.id);
      const tb = buildBeatTables(60 / k.rhythm.heartRateBpm, k.physiology, k.rhythm, k.hemodynamics);
      const sv = k.physiology.edvMl - k.physiology.esvMl;
      if (Math.abs(tb.volumeCorrectionMl) > 0.001 * sv) problems.push(`${input.id}: closing correction ${tb.volumeCorrectionMl.toFixed(2)} mL of SV ${sv}`);
      if (Math.abs(tb.strokeVolumeMl - sv) > 0.01 * sv) problems.push(`${input.id}: table SV ${tb.strokeVolumeMl.toFixed(1)} mL against EDV − ESV ${sv}`);
      if (!(tb.mvEffectiveAreaCm2 >= 0.5 && tb.mvEffectiveAreaCm2 <= 8)) problems.push(`${input.id}: mitral flow area ${tb.mvEffectiveAreaCm2.toFixed(2)} cm²`);
    }
    expect(problems).toEqual([]);
  });
});

describe('the Doppler E and A of the case are the peaks the inflow shows (decision 97)', () => {
  it('during atrial contraction the inflow peaks at the case A, or at the E flow still running when that is higher', async () => {
    const { CASE_INPUTS, loadCaseById } = await import('@/cases');
    const problems: string[] = [];
    let fused = 0;
    for (const input of CASE_INPUTS) {
      const k = loadCaseById(input.id);
      const tb = buildBeatTables(60 / k.rhythm.heartRateBpm, k.physiology, k.rhythm, k.hemodynamics);
      const t = tb.timings;
      if (!t.hasAWave) continue;
      const dt = tb.rrS / tb.n;
      let aPeak = 0,
        eResidual = 0,
        ePeak = 0;
      for (let i = 0; i < tb.n; i++) {
        const ti = (i + 0.5) * dt;
        const v = (tb.mitralFlowMlps[i] ?? 0) / tb.mvEffectiveAreaCm2 / 100;
        const e = ti > t.mitralOpenS ? k.physiology.ePeakMps * eWaveShape(ti - t.mitralOpenS, t.eAccelS, t.eDecelS) : 0;
        if (ti > t.aStartS && ti < t.aEndS) {
          aPeak = Math.max(aPeak, v);
          eResidual = Math.max(eResidual, e);
        } else if (ti > t.mitralOpenS && ti <= t.aStartS) ePeak = Math.max(ePeak, v);
      }
      const expected = Math.max(k.physiology.aPeakMps, eResidual);
      if (eResidual > k.physiology.aPeakMps) fused++;
      // before: E and A added in full, 0.99 m/s for an A of 0.7 (pulmonary hypertension) and 1.09 in tamponade
      if (Math.abs(aPeak - expected) > 0.01 * expected) problems.push(`${input.id}: inflow during atrial contraction peaks at ${aPeak.toFixed(3)} m/s against ${expected.toFixed(3)}`);
      if (ePeak > k.physiology.ePeakMps * 1.001) problems.push(`${input.id}: early inflow ${ePeak.toFixed(3)} m/s above E ${k.physiology.ePeakMps}`);
    }
    expect(problems).toEqual([]);
    // tamponade at 108 bpm: atrial contraction starts before the E peak and the waves fuse
    expect(fused).toBeGreaterThanOrEqual(1);
  });
});
