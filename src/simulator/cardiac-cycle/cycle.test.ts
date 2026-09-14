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
    // the flow area carries the volume: before atrial contraction the velocity at the orifice is still the case E wave,
    // sample by sample (during it, decision 97 below), and after it nothing enters (decision 101)
    let worst = 0;
    for (let i = 0; i < tb.n; i++) {
      const ti = (i + 0.5) * (tb.rrS / tb.n);
      if (ti > t.aStartS && ti < t.aEndS) continue;
      const v = ti > t.mitralOpenS && ti <= t.aStartS ? 0.8 * eWaveShape(ti - t.mitralOpenS, t.eAccelS, t.eDecelS) : 0;
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

describe('the atrioventricular leaflets float half-open between the filling waves (decision 100)', () => {
  it('from peak early inflow to peak atrial inflow neither valve closes, the float starts and ends without a jump, and both are shut through systole', async () => {
    const { CASE_INPUTS, loadCaseById } = await import('@/cases');
    const { DIASTASIS_OPENING } = await import('./cycleModel');
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const k = loadCaseById(input.id);
      const tb = buildBeatTables(60 / k.rhythm.heartRateBpm, k.physiology, k.rhythm, k.hemodynamics);
      const t = tb.timings;
      const at = (ts: number) => cycleStateAt(tb, ts / tb.rrS);
      // the tricuspid valve follows the mitral one 1% of the beat later
      const lag = 0.01 * tb.rrS;
      const floatStart = t.mitralOpenS + t.eAccelS;
      // without atrial contraction the float lasts to the end of the beat and the valve closes early in systole
      const floatEnd = t.hasAWave ? (t.aStartS + t.aEndS) / 2 : tb.rrS;
      for (let ts = floatStart + 0.001; ts < floatEnd; ts += 0.002) {
        const s = at(ts);
        // before: 0 through diastasis, 95 ms at 65 bpm in the normal case
        if (s.mvOpen < 0.9 * DIASTASIS_OPENING) problems.push(`${input.id} @${(ts * 1000).toFixed(0)} ms: mitral opening ${s.mvOpen.toFixed(2)}`);
        if (ts > floatStart + lag && at(ts + lag).tvOpen < 0.9 * DIASTASIS_OPENING) problems.push(`${input.id} @${((ts + lag) * 1000).toFixed(0)} ms: tricuspid opening ${at(ts + lag).tvOpen.toFixed(2)}`);
      }
      const jumps = (from: number, to: number): void => {
        let prev = at(from).mvOpen;
        for (let ts = from + 0.002; ts <= to; ts += 0.002) {
          const cur = at(ts).mvOpen;
          if (Math.abs(cur - prev) > 0.05) problems.push(`${input.id} @${(ts * 1000).toFixed(0)} ms: mitral opening ${prev.toFixed(2)} → ${cur.toFixed(2)} in 2 ms`);
          prev = cur;
        }
      };
      jumps(floatStart - 0.01, floatEnd);
      if (!t.hasAWave) jumps(-0.01, 0.04);
      for (let ts = 0.03; ts < t.mitralOpenS; ts += 0.002) if (at(ts).mvOpen > 0.02) problems.push(`${input.id} @${(ts * 1000).toFixed(0)} ms: mitral valve open ${at(ts).mvOpen.toFixed(2)} in systole`);
    }
    expect(problems).toEqual([]);
  });
});

describe('the end of atrial contraction closes the valve (decision 101)', () => {
  it('nothing enters after the A wave, and the inflow and the leaflets reach zero with it instead of stopping at the R wave', async () => {
    const { CASE_INPUTS, loadCaseById } = await import('@/cases');
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const k = loadCaseById(input.id);
      const tb = buildBeatTables(60 / k.rhythm.heartRateBpm, k.physiology, k.rhythm, k.hemodynamics);
      const t = tb.timings;
      if (!t.hasAWave) continue;
      const dt = tb.rrS / tb.n;
      let peakAfter = 0;
      for (let i = 0; i < tb.n; i++) if ((i + 0.5) * dt >= t.aEndS) peakAfter = Math.max(peakAfter, (tb.mitralFlowMlps[i] ?? 0) / tb.mvEffectiveAreaCm2 / 100);
      // before: 0.12 m/s in pulmonary hypertension and 0.33 m/s in tamponade, where the next beat cut the E wave
      if (peakAfter > 1e-6) problems.push(`${input.id}: inflow of ${peakAfter.toFixed(2)} m/s after atrial contraction`);
      // the inflow decays into the end of the A wave: within 2 ms of it the velocity is almost zero (a half-sine there is
      // below 6% of its peak)
      let tail = 0;
      for (let i = 0; i < tb.n; i++) {
        const ti = (i + 0.5) * dt;
        if (ti > t.aEndS - 0.002 && ti < t.aEndS) tail = Math.max(tail, (tb.mitralFlowMlps[i] ?? 0) / tb.mvEffectiveAreaCm2 / 100);
      }
      if (tail > 0.06) problems.push(`${input.id}: ${tail.toFixed(2)} m/s within 2 ms of the end of atrial contraction`);
      const across = Math.abs(cycleStateAt(tb, 1 - 0.002 / tb.rrS).mvOpen - cycleStateAt(tb, 0.002 / tb.rrS).mvOpen);
      if (across > 0.02 || cycleStateAt(tb, (t.aEndS + 0.003) / tb.rrS).mvOpen > 0.02) problems.push(`${input.id}: mitral opening ${cycleStateAt(tb, (t.aEndS + 0.003) / tb.rrS).mvOpen.toFixed(2)} after atrial contraction, ${across.toFixed(2)} step across the beat boundary`);
    }
    expect(problems).toEqual([]);
  });
});

describe('the tricuspid annulus moves with its own table (decision 106)', () => {
  it('reaches its TAPSE and peaks in systole at the case S′ in every case', async () => {
    const { CASE_INPUTS, loadCaseById } = await import('@/cases');
    const problems: string[] = [];
    for (const input of CASE_INPUTS) {
      const k = loadCaseById(input.id);
      const tb = buildBeatTables(60 / k.rhythm.heartRateBpm, k.physiology, k.rhythm, k.hemodynamics);
      const t = tb.timings;
      let lo = Infinity,
        hi = -Infinity,
        peak = 0;
      for (let i = 0; i < tb.n; i++) {
        const ti = ((i + 0.5) / tb.n) * tb.rrS;
        lo = Math.min(lo, tb.rvLongitudinal[i]!);
        hi = Math.max(hi, tb.rvLongitudinal[i]!);
        if (ti >= t.ejectionStartS && ti <= t.ejectionEndS) peak = Math.max(peak, tb.rvLongitudinalVelocity[i]! * k.physiology.tapseCm);
      }
      // before: the tricuspid annulus followed the left ventricular curve, 7–25% below the case S′ in eleven cases
      if (Math.abs(peak - k.physiology.sPrimeTricuspidCmps) > 0.02 * k.physiology.sPrimeTricuspidCmps) problems.push(`${input.id}: systolic peak ${peak.toFixed(2)} cm/s against S′ ${k.physiology.sPrimeTricuspidCmps}`);
      if (hi - lo < 0.95) problems.push(`${input.id}: excursion ${(hi - lo).toFixed(3)} of TAPSE`);
    }
    expect(problems).toEqual([]);
  });
});

describe('beats of atrial fibrillation fill and eject by their own intervals (decision 107)', () => {
  it('each beat keeps the case E wave and deceleration, fills through the case orifice for its diastole, and the next beat ejects that filling', async () => {
    const { loadCaseById } = await import('@/cases');
    const k = loadCaseById('af-diastolic');
    const nominal = buildBeatTables(60 / k.rhythm.heartRateBpm, k.physiology, k.rhythm, k.hemodynamics);
    const sv = k.physiology.edvMl - k.physiology.esvMl;
    const rrs = [0.65, 0.42, 0.55, 0.95, 0.75, 0.38, 0.62, 1.1];
    const problems: string[] = [];
    let prev = nominal;
    let prevRr = nominal.rrS;
    const fills: [number, number][] = [];
    for (const [i, rr] of rrs.entries()) {
      const eject = i === 0 ? sv : Math.min(1.2 * sv, Math.max(0.2 * sv, prev.endVolumeMl - k.physiology.esvMl));
      const tb = buildBeatTables(rr, k.physiology, k.rhythm, k.hemodynamics, {
        chain: { ejectMl: eject, mvAreaCm2: nominal.mvEffectiveAreaCm2, previousRrS: prevRr, startLongitudinal: i ? prev.endLongitudinal : 0, startRvLongitudinal: i ? prev.endRvLongitudinal : 0 },
      });
      const t = tb.timings;
      // the E wave keeps the case deceleration and peak velocity at every RR (before: stretched with the RR)
      if (Math.abs(t.eDecelS * 1000 - k.physiology.decelerationTimeMs) > 1e-6) problems.push(`RR ${rr}: DT ${t.eDecelS * 1000} ms`);
      let peak = 0;
      for (let j = 0; j < tb.n; j++) peak = Math.max(peak, tb.mitralFlowMlps[j]! / tb.mvEffectiveAreaCm2 / 100);
      const complete = t.mitralOpenS + t.eAccelS + t.eDecelS < rr;
      if (t.mitralOpenS + t.eAccelS < rr && Math.abs(peak - k.physiology.ePeakMps) > 0.01) problems.push(`RR ${rr}: E ${peak.toFixed(3)} m/s`);
      // it ejects what the previous beat filled, and its volume continues where that beat ended
      if (i > 0 && Math.abs(tb.lvVolumeMl[0]! - (k.physiology.esvMl + eject)) > 0.02 * sv) problems.push(`RR ${rr}: starts at ${tb.lvVolumeMl[0]!.toFixed(1)} mL`);
      fills.push([rr, tb.endVolumeMl - (k.physiology.esvMl + eject) + eject]);
      if (complete && Math.abs(fills[i]![1] - sv) > 0.03 * sv) problems.push(`RR ${rr}: a complete E wave filled ${fills[i]![1].toFixed(1)} mL for ${sv}`);
      prev = tb;
      prevRr = rr;
    }
    expect(problems).toEqual([]);
    // filling grows with the diastole it has and stops growing once the E wave fits (Frank–Starling in AF)
    const sorted = [...fills].sort((a, b) => a[0] - b[0]);
    for (let j = 1; j < sorted.length; j++) expect(sorted[j]![1], `filling at RR ${sorted[j]![0]}`).toBeGreaterThanOrEqual(sorted[j - 1]![1] - 0.5);
    expect(sorted[0]![1]).toBeLessThan(0.5 * sv);
  });
});

describe('the annular velocity of chained beats has no spike where one beat hands over to the next (decision 114)', () => {
  it('the first and last samples of each beat continue the slope of the beat, for the mitral and the tricuspid annulus', async () => {
    // The velocity tables were the periodic derivative of the displacement: right for a beat that repeats, wrong for a
    // chained beat, which starts where the previous one ended and ends elsewhere. Across that seam the first sample read
    // -67 and +134 MAPSE per second in atrial fibrillation, a tissue Doppler spike of -96 and +192 cm/s at every QRS.
    const { loadCaseById } = await import('@/cases');
    const k = loadCaseById('af-diastolic');
    const nominal = buildBeatTables(60 / k.rhythm.heartRateBpm, k.physiology, k.rhythm, k.hemodynamics);
    const sv = k.physiology.edvMl - k.physiology.esvMl;
    const problems: string[] = [];
    let prev = nominal;
    let prevRr = nominal.rrS;
    for (const [i, rr] of [0.65, 0.42, 0.95, 0.38, 1.1].entries()) {
      const eject = i === 0 ? sv : Math.min(1.2 * sv, Math.max(0.2 * sv, prev.endVolumeMl - k.physiology.esvMl));
      const tb = buildBeatTables(rr, k.physiology, k.rhythm, k.hemodynamics, {
        chain: { ejectMl: eject, mvAreaCm2: nominal.mvEffectiveAreaCm2, previousRrS: prevRr, startLongitudinal: i ? prev.endLongitudinal : 0, startRvLongitudinal: i ? prev.endRvLongitudinal : 0 },
      });
      for (const [name, v] of [['mitral', tb.longitudinalVelocity], ['tricuspid', tb.rvLongitudinalVelocity]] as const) {
        const n = v.length;
        // neighbouring samples one table step apart differ by what the course gives them, not by a spike
        let inner = 0;
        for (let j = 2; j < n - 1; j++) inner = Math.max(inner, Math.abs(v[j]! - v[j - 1]!));
        const seam = Math.max(Math.abs(v[0]! - v[1]!), Math.abs(v[n - 1]! - v[n - 2]!));
        if (seam > Math.max(0.5, 2 * inner)) problems.push(`RR ${rr} ${name}: first/last ${v[0]!.toFixed(2)}, ${v[n - 1]!.toFixed(2)} MAPSE/s against a largest step of ${inner.toFixed(2)} inside`);
      }
      prev = tb;
      prevRr = rr;
    }
    expect(problems).toEqual([]);
  });
});

describe('chained beats carry the respiratory factors of their inflows (decision 108)', () => {
  it('the mitral and tricuspid E waves take their factors, atrial contraction does not, and the right ventricle ejects its own filling', async () => {
    const { loadCaseById } = await import('@/cases');
    const k = loadCaseById('normal-excellent-window');
    const nominal = buildBeatTables(60 / k.rhythm.heartRateBpm, k.physiology, k.rhythm, k.hemodynamics);
    // without a chain the tricuspid inflow is the mitral one
    expect(Array.from(nominal.tricuspidFlowMlps)).toEqual(Array.from(nominal.mitralFlowMlps));
    const tb = buildBeatTables(nominal.rrS, k.physiology, k.rhythm, k.hemodynamics, {
      chain: { ejectMl: 70, rvEjectMl: 82, mvAreaCm2: nominal.mvEffectiveAreaCm2, previousRrS: nominal.rrS, startLongitudinal: 0, startRvLongitudinal: 0, mitralEFactor: 0.8, tricuspidEFactor: 1.3 },
    });
    const t = tb.timings;
    const peakIn = (table: Float32Array, from: number, to: number) => {
      let p = 0;
      for (let i = 0; i < tb.n; i++) {
        const ti = ((i + 0.5) / tb.n) * tb.rrS;
        if (ti > from && ti < to) p = Math.max(p, table[i]! / tb.mvEffectiveAreaCm2 / 100);
      }
      return p;
    };
    expect(peakIn(tb.mitralFlowMlps, t.mitralOpenS, t.aStartS)).toBeCloseTo(0.8 * k.physiology.ePeakMps, 2);
    expect(peakIn(tb.tricuspidFlowMlps, t.mitralOpenS, t.aStartS)).toBeCloseTo(1.3 * k.physiology.ePeakMps, 2);
    // atrial contraction keeps the case A in both
    expect(peakIn(tb.mitralFlowMlps, t.aStartS, t.aEndS)).toBeCloseTo(k.physiology.aPeakMps, 2);
    expect(peakIn(tb.tricuspidFlowMlps, t.aStartS, t.aEndS)).toBeCloseTo(k.physiology.aPeakMps, 2);
    let rv = 0;
    for (let i = 0; i < tb.n; i++) rv += tb.pulmonaryFlowMlps[i]! * (tb.rrS / tb.n);
    expect(rv).toBeCloseTo(82, 0);
  });
});
