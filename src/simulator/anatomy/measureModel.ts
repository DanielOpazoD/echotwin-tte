import type { CaseDefinition } from '@/cases/schema';
import { classifyHeart, computeHeartPose, createHeartModel, estimateStructureVolume, heartAnchors, heartLandmarks, type HeartPose } from './heartModel';
import { createThoraxModel, type PatientState } from './thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure, Tissue } from './tissue';
import { createRng } from '@/core/random';
import { bsaMosteller } from '@/clinical/formulas';

/**
 * Measures the geometric model of a case the way an echocardiographer would (chamber volumes by
 * Monte-Carlo over the SDF, chamber diameters by sampling in the standard planes, wall thickness,
 * aortic root perpendicular to its axis, annuli, ratios) and compares each value with adult
 * reference ranges (sex-specific where the guidelines give them). Used by `proportions.test.ts`:
 * a case may only leave a range if it declares the deviation on purpose (`expectedDeviations`).
 *
 * Reference ranges: ASE/EACVI chamber quantification 2015 (LV, LA, RA, aortic root), ASE right
 * heart 2025 (RV basal diameter, RV wall), and approximate ranges where no guideline value exists
 * (RV volume, RV length, annuli, pulmonary artery). Approximate ranges are marked `approx`.
 */
export interface MeasureRow {
  id: string;
  label: string;
  value: number;
  units: string;
  lo: number;
  hi: number;
  verdict: 'ok' | 'LOW' | 'HIGH';
  approx: boolean;
  referenceId: string;
}

export interface ModelMeasurements {
  caseId: string;
  bsaM2: number;
  rows: MeasureRow[];
}

const DEFAULT_PATIENT: PatientState = { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 };

export function measureModel(c: CaseDefinition, patient: PatientState = DEFAULT_PATIENT, mcSamples = 160000): ModelMeasurements {
  const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, patient);
  const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
  heartLandmarks(heart);
  const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
  const edPose = computeHeartPose(heart, cycleStateAt(tables, 0.0));
  const esPose = computeHeartPose(heart, cycleStateAt(tables, tables.timings.ejectionEndS / tables.rrS));
  let maxLongPhase = 0;
  for (let i = 0, best = -1; i < 64; i++) {
    const st = cycleStateAt(tables, i / 64);
    if (st.longitudinal > best) {
      best = st.longitudinal;
      maxLongPhase = i / 64;
    }
  }
  const longPose = computeHeartPose(heart, cycleStateAt(tables, maxLongPhase));
  const bsa = bsaMosteller(c.demographics.heightCm, c.demographics.weightKg);
  const female = c.demographics.sexForReference === 'female';
  const rng = createRng(42);
  const s = makeSample();
  const L = heart.lv.lengthCm;
  const A = heartAnchors(heart);

  const vol = (pose: HeartPose, structs: Structure[], min: [number, number, number], max: [number, number, number]) =>
    estimateStructureVolume(heart, pose, structs, mcSamples, () => rng.next(), { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } });

  /** contiguous run (cm) of a structure set along an axis through p (searches the nearest inside point first) */
  const runAt = (pose: HeartPose, structs: Structure[], p0: [number, number, number], axis: 0 | 1 | 2, span = 9): number => {
    const step = 0.02;
    let p: [number, number, number] = [p0[0], p0[1], p0[2]];
    const inside = (t: number) => {
      const q: [number, number, number] = [p[0], p[1], p[2]];
      q[axis] += t;
      return classifyHeart(heart, pose, q[0], q[1], q[2], s) && structs.includes(s.structure);
    };
    if (!inside(0)) {
      let found = NaN;
      for (let t = step; t <= span && Number.isNaN(found); t += step) {
        if (inside(t)) found = t;
        else if (inside(-t)) found = -t;
      }
      if (Number.isNaN(found)) return 0;
      p = ((): [number, number, number] => {
        const q: [number, number, number] = [p[0], p[1], p[2]];
        q[axis] += found;
        return q;
      })();
    }
    let a = 0;
    while (a > -span && inside(a - step)) a -= step;
    let b = 0;
    while (b < span && inside(b + step)) b += step;
    return b - a;
  };
  /**
   * Lumen run along an arbitrary unit direction (inner edge to inner edge): blood and leaflet tissue of the given
   * structures count (cusps hinge on the inner surface and do not interrupt the diameter); vessel wall, fibrous
   * tissue and anything else end the run.
   */
  const runAlong = (pose: HeartPose, structs: Structure[], c0: [number, number, number], d: [number, number, number], span = 3): number => {
    const step = 0.02;
    const inside = (u: number) =>
      classifyHeart(heart, pose, c0[0] + d[0] * u, c0[1] + d[1] * u, c0[2] + d[2] * u, s) && structs.includes(s.structure) && (s.tissue === Tissue.Blood || s.tissue === Tissue.Valve);
    if (!inside(0)) return 0;
    let a = 0,
      b = 0;
    while (a > -span && inside(a - step)) a -= step;
    while (b < span && inside(b + step)) b += step;
    return b - a;
  };
  const maxZ = (pose: HeartPose, structs: Structure[], p: [number, number, number]): number => {
    let hi = -Infinity;
    for (let t = -10; t <= 10; t += 0.02) if (classifyHeart(heart, pose, p[0], p[1], p[2] + t, s) && structs.includes(s.structure)) hi = Math.max(hi, p[2] + t);
    return hi;
  };

  const cav = [Structure.LvCavity, Structure.PapillaryMuscle];
  const lvED = vol(edPose, cav, [-4.5, -4.5, -1], [4.5, 4.5, L + 0.6]);
  const lvES = vol(esPose, cav, [-4.5, -4.5, -1], [4.5, 4.5, L + 0.6]);
  const rvStructs = [Structure.RvCavity, Structure.Rvot];
  // RV volume includes the RVOT up to the pulmonary valve plane (z = rvotB.z) but not the pulmonary trunk
  const rvED = vol(edPose, rvStructs, [-8.5, -3.5, A.rvotB.z], [1.5, 7, 8.5]);
  const rvES = vol(esPose, rvStructs, [-8.5, -3.5, A.rvotB.z], [1.5, 7, 8.5]);
  const laMax = vol(esPose, [Structure.LaCavity], [-3.5, -7, -7], [4.5, 1.5, 1.5]);
  const laMin = vol(edPose, [Structure.LaCavity], [-3.5, -7, -7], [4.5, 1.5, 1.5]);
  const raMax = vol(esPose, [Structure.RaCavity], [-9, -4.5, -6.5], [-1, 3, 1.5]);
  const myoStructs = [Structure.LvWallSeptal, Structure.LvWallLateral, Structure.LvWallAnterior, Structure.LvWallInferior, Structure.LvApex];
  const myo = vol(edPose, myoStructs, [-5.5, -5.5, -1.5], [5.5, 5.5, L + 1.4]);

  const zEDD = 2.0;
  const lvIDd = runAt(edPose, cav, [0, 0, zEDD], 0);
  const lvIDs = runAt(esPose, cav, [0, 0, 3.2], 0);
  const ivsD = runAt(edPose, [Structure.LvWallSeptal, Structure.LvWallAnterior], [-(edPose.aCav + 0.3), 0.2, zEDD], 0, 3);
  const pwD = runAt(edPose, [Structure.LvWallLateral, Structure.LvWallInferior], [0, -edPose.bCav - 0.3, zEDD], 1, 3);
  const ivsS = runAt(esPose, [Structure.LvWallSeptal, Structure.LvWallAnterior], [-(esPose.aCav + 0.3), 0.2, zEDD], 0, 3);
  const apexT = runAt(edPose, [Structure.LvApex, ...myoStructs], [0, 0, L + 0.2], 2, 3);
  const lvLenED = maxZ(edPose, cav, [0, 0, 4]) - edPose.zAnn;
  const lvLenES = maxZ(longPose, cav, [0, 0, 4]) - longPose.zAnn;
  const yA4C = -0.4;
  const rvBasal = runAt(edPose, [Structure.RvCavity], [-5.2, yA4C, 2.2], 0);
  const rvMid = runAt(edPose, [Structure.RvCavity], [-5.0, yA4C, L * 0.5], 0);
  // RV long axis in A4C: from the tricuspid annulus plane to the RV apex, which lies close to the septum
  const rvLen = maxZ(edPose, rvStructs, [A.rvCenter.x - 0.9, yA4C, 2]) - (A.tvCenter.z + 0.3);
  const lvBasalA4C = 2 * edPose.aCav * Math.sqrt(Math.max(0, 1 - ((2.2 - edPose.zcCav) / edPose.cCav) ** 2));
  // RV free wall measured perpendicular to the anterior wall (as in PLAX/subcostal), not obliquely in A4C
  const rvWall = runAt(edPose, [Structure.RvWall], [A.rvCenter.x, A.rvCenter.y + A.rvR.y + 0.1, A.rvCenter.z], 1, 2);
  const rvPlax = runAt(edPose, rvStructs, [-1.2, edPose.bCav + heart.lv.ivsd + 0.8, 3.0], 1, 4);
  const laAP = runAt(esPose, [Structure.LaCavity], [A.laCenter.x, A.laCenter.y, A.laCenter.z], 1);
  const laTr = runAt(esPose, [Structure.LaCavity], [A.laCenter.x, A.laCenter.y, A.laCenter.z], 0);
  const laLong = runAt(esPose, [Structure.LaCavity], [A.laCenter.x, A.laCenter.y, A.laCenter.z], 2);
  const raTr = runAt(esPose, [Structure.RaCavity], [A.raCenter.x, A.raCenter.y, A.raCenter.z], 0);
  const raLong = runAt(esPose, [Structure.RaCavity], [A.raCenter.x, A.raCenter.y, A.raCenter.z], 2);
  const iasT = runAt(edPose, [Structure.InteratrialSeptum], [(A.laCenter.x - A.laR.x + A.raCenter.x + A.raR.x) / 2, -1.6, -2.2], 0, 3);
  const ax = A.avAxis,
    e1 = A.avE1;
  const rootAt = (t: number, pose: HeartPose) => {
    const cz = A.avCenter.z + pose.zAnn * 0.5;
    return runAlong(pose, [Structure.AorticRoot, Structure.Lvot, Structure.AorticValve], [A.avCenter.x + ax.x * t, A.avCenter.y + ax.y * t, cz + ax.z * t], [e1.x, e1.y, e1.z]);
  };
  const lvotD = rootAt(-0.2, esPose);
  const annulusD = rootAt(0.05, esPose);
  const sinusD = rootAt(1.1, edPose);
  const stjD = rootAt(2.7, edPose);
  const ascD = rootAt(3.8, edPose);
  const rvotD = 2 * A.rvotR;
  const paDir = A.paDir;
  const paPerp: [number, number, number] = [-paDir.y, paDir.x, 0];
  const pl = Math.hypot(paPerp[0], paPerp[1]) || 1;
  const paD = runAlong(edPose, [Structure.Rvot], [A.rvotB.x + paDir.x * 1.5, A.rvotB.y + paDir.y * 1.5, A.rvotB.z + paDir.z * 1.5], [paPerp[0] / pl, paPerp[1] / pl, 0]);
  const mvAnn = 2 * A.mvR;
  const tvAnn = 2 * A.tvR;

  const rows: MeasureRow[] = [];
  const add = (id: string, label: string, value: number, units: string, lo: number, hi: number, referenceId: string, approx = false) =>
    rows.push({ id, label, value, units, lo, hi, verdict: value < lo ? 'LOW' : value > hi ? 'HIGH' : 'ok', approx, referenceId });
  const CQ = 'ase-eacvi-chamber-2015';
  const RH = 'ase-right-heart-2025';
  add('lv-edv', 'LV EDV', lvED, 'mL', female ? 46 : 62, female ? 106 : 150, CQ);
  add('lv-esv', 'LV ESV', lvES, 'mL', female ? 14 : 21, female ? 42 : 61, CQ);
  add('lv-ef', 'LVEF (geometric)', ((lvED - lvES) / lvED) * 100, '%', female ? 54 : 52, female ? 74 : 72, CQ);
  add('lv-edvi', 'LV EDV index', lvED / bsa, 'mL/m²', female ? 29 : 34, female ? 61 : 74, CQ);
  add('lv-idd', 'LVIDd', lvIDd, 'cm', female ? 3.8 : 4.2, female ? 5.2 : 5.8, CQ);
  add('lv-ids', 'LVIDs', lvIDs, 'cm', female ? 2.2 : 2.5, female ? 3.5 : 4.0, CQ);
  add('lv-length', 'LV length ED (annulus→apex)', lvLenED, 'cm', 7.0, 9.8, CQ, true);
  add('lv-shortening', 'LV longitudinal shortening', lvLenED - lvLenES, 'cm', 0.9, 1.7, CQ, true);
  add('ivsd', 'IVS diastolic thickness', ivsD, 'cm', 0.6, female ? 0.9 : 1.0, CQ);
  add('lvpwd', 'PW diastolic thickness', pwD, 'cm', 0.6, female ? 0.9 : 1.0, CQ);
  add('ivs-thickening', 'IVS systolic thickening', (ivsS / ivsD - 1) * 100, '%', 30, 75, CQ, true);
  add('apex-thickness', 'Apex wall thickness', apexT, 'cm', 0.5, 0.9, CQ, true);
  add('lv-mass', 'LV mass (myocardial volume × 1.05)', myo * 1.05, 'g', female ? 67 : 88, female ? 162 : 224, CQ);
  add('rv-edv', 'RV EDV', rvED, 'mL', female ? 60 : 80, female ? 150 : 190, RH, true);
  add('rv-edvi', 'RV EDV index (3D)', rvED / bsa, 'mL/m²', female ? 32 : 35, female ? 74 : 87, CQ);
  add('rv-ef', 'RV EF (geometric)', ((rvED - rvES) / Math.max(1, rvED)) * 100, '%', 45, 65, RH, true);
  add('rv-basal', 'RV basal diameter (A4C)', rvBasal, 'cm', 2.5, 4.1, RH);
  add('rv-mid', 'RV mid diameter (A4C)', rvMid, 'cm', 1.9, 3.7, RH, true);
  add('rv-length', 'RV length (A4C)', rvLen, 'cm', 5.6, 8.3, RH, true);
  add('rv-lv-basal-ratio', 'RV/LV basal ratio (A4C)', rvBasal / lvBasalA4C, '', 0.45, 0.8, RH, true);
  add('rv-wall', 'RV free wall thickness', rvWall, 'cm', 0.2, 0.5, RH);
  add('rv-plax', 'RV AP dimension (PLAX)', rvPlax, 'cm', 1.7, 3.2, RH, true);
  add('la-ap', 'LA AP diameter (PLAX)', laAP, 'cm', female ? 2.7 : 3.0, female ? 3.8 : 4.0, CQ);
  add('la-transverse', 'LA transverse (A4C)', laTr, 'cm', 3.4, 5.0, CQ, true);
  add('la-long', 'LA long axis (A4C)', laLong, 'cm', 4.0, 5.8, CQ, true);
  add('lavi', 'LA volume index (max)', laMax / bsa, 'mL/m²', 16, 34, CQ);
  add('la-emptying', 'LA emptying fraction', (1 - laMin / laMax) * 100, '%', 35, 65, CQ, true);
  add('ravi', 'RA volume index (max)', raMax / bsa, 'mL/m²', 12, female ? 27 : 32, CQ);
  add('ra-transverse', 'RA transverse', raTr, 'cm', 2.6, 4.4, CQ, true);
  add('ra-long', 'RA long axis', raLong, 'cm', 3.5, 5.6, CQ, true);
  add('la-ao', 'LA/Ao ratio', laAP / sinusD, '', 0.85, 1.25, CQ, true);
  add('ias', 'Interatrial septum thickness', iasT, 'cm', 0.2, 0.7, CQ, true);
  add('lvot', 'LVOT diameter (systole)', lvotD, 'cm', 1.8, 2.4, 'ase-tte-2019', true);
  add('ao-annulus', 'Aortic annulus', annulusD, 'cm', female ? 2.0 : 2.3, female ? 2.6 : 2.9, CQ);
  add('ao-sinus', 'Sinus of Valsalva', sinusD, 'cm', female ? 2.7 : 3.1, female ? 3.3 : 3.7, CQ);
  add('ao-stj', 'Sinotubular junction', stjD, 'cm', female ? 2.3 : 2.6, female ? 2.9 : 3.2, CQ);
  add('ao-ascending', 'Ascending aorta', ascD, 'cm', female ? 2.3 : 2.6, female ? 3.1 : 3.4, CQ);
  add('rvot', 'RVOT proximal diameter', rvotD, 'cm', 1.8, 3.0, RH, true);
  add('pa', 'Main pulmonary artery', paD, 'cm', 1.5, 2.7, RH, true);
  add('mv-annulus', 'Mitral annulus diameter', mvAnn, 'cm', 2.7, 3.5, CQ, true);
  add('tv-annulus', 'Tricuspid annulus diameter', tvAnn, 'cm', 2.8, 4.0, RH);
  add('tv-mv-ratio', 'TV/MV annulus ratio', tvAnn / mvAnn, '', 1.0, 1.3, RH, true);
  add('rv-lv-length', 'RV/LV length ratio', rvLen / lvLenED, '', 0.65, 0.95, RH, true);
  return { caseId: c.id, bsaM2: bsa, rows };
}

/** Format a measurement report as a text table (used by the CLI tool). */
export function formatMeasurements(m: ModelMeasurements): string {
  const lines = [`Case ${m.caseId} · BSA ${m.bsaM2.toFixed(2)} m²`, `${'Measure'.padEnd(40)} ${'model'.padStart(9)}   ${'range'.padEnd(18)} verdict`];
  for (const r of m.rows) {
    const val = Math.abs(r.value) >= 10 ? r.value.toFixed(0) : r.value.toFixed(2);
    lines.push(`${r.label.padEnd(40)} ${(val + (r.units ? ' ' + r.units : '')).padStart(9)}   ${`${r.lo}–${r.hi}${r.approx ? ' ≈' : ''}`.padEnd(18)} ${r.verdict}`);
  }
  return lines.join('\n');
}
