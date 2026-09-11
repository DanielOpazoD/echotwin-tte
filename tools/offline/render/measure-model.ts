/**
 * Measures the geometric model of a case the way an echocardiographer would (chamber sizes,
 * wall thickness, root, annuli, ratios) and prints them next to adult reference ranges.
 * Usage: npx tsx tools/offline/render/measure-model.ts [caseId]
 */
import { loadCaseById } from '@/cases';
import { classifyHeart, computeHeartPose, createHeartModel, estimateStructureVolume, heartLandmarks } from '@/simulator/anatomy/heartModel';
import { createThoraxModel } from '@/simulator/anatomy/thoraxModel';
import { buildBeatTables, cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { makeSample, Structure } from '@/simulator/anatomy/tissue';
import { createRng } from '@/core/random';
import { bsaMosteller } from '@/clinical/formulas';

const c = loadCaseById(process.argv[2] ?? 'normal-excellent-window');
const thorax = createThoraxModel(c.bodyHabitus, c.acousticWindow, { position: 'left-lateral', respiration: 'expiration', headElevationDeg: 0 });
const heart = createHeartModel(c.anatomy, c.physiology, thorax.heartOffset, c.seed);
heartLandmarks(heart);
const tables = buildBeatTables(60 / c.rhythm.heartRateBpm, c.physiology, c.rhythm, c.hemodynamics);
const edPose = computeHeartPose(heart, cycleStateAt(tables, 0.0));
const esPose = computeHeartPose(heart, cycleStateAt(tables, tables.timings.ejectionEndS / tables.rrS));
const bsa = bsaMosteller(c.demographics.heightCm, c.demographics.weightKg);
const rng = createRng(42);
const s = makeSample();
const L = heart.lv.lengthCm;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const A = (heart as unknown as { _anchors: Record<string, any> })._anchors;

const vol = (pose: typeof edPose, structs: Structure[], box: { min: [number, number, number]; max: [number, number, number] }) =>
  estimateStructureVolume(heart, pose, structs, 250000, () => rng.next(), { min: { x: box.min[0], y: box.min[1], z: box.min[2] }, max: { x: box.max[0], y: box.max[1], z: box.max[2] } });

/** extent (cm) of a structure set along an axis line through point p */
function extent(pose: typeof edPose, structs: Structure[], p: [number, number, number], axis: 0 | 1 | 2, span = 9): { min: number; max: number; len: number } {
  const step = 0.02;
  let lo = Infinity,
    hi = -Infinity;
  for (let t = -span; t <= span; t += step) {
    const q: [number, number, number] = [p[0], p[1], p[2]];
    q[axis] += t;
    if (classifyHeart(heart, pose, q[0], q[1], q[2], s) && structs.includes(s.structure)) {
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
  }
  return { min: lo, max: hi, len: hi - lo };
}
/** contiguous run containing the point (for crescents) */
function runAt(pose: typeof edPose, structs: Structure[], p: [number, number, number], axis: 0 | 1 | 2, span = 9): number {
  const step = 0.02;
  const inside = (t: number) => {
    const q: [number, number, number] = [p[0], p[1], p[2]];
    q[axis] += t;
    return classifyHeart(heart, pose, q[0], q[1], q[2], s) && structs.includes(s.structure);
  };
  if (!inside(0)) {
    // search nearest inside point
    let found = NaN;
    for (let t = 0; t <= span && Number.isNaN(found); t += step) {
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
}

const lvBox = { min: [-4.5, -4.5, -1] as [number, number, number], max: [4.5, 4.5, L + 0.6] as [number, number, number] };
const rvBox = { min: [-8, -3.5, -3] as [number, number, number], max: [1.5, 6.5, 8] as [number, number, number] };
const laBox = { min: [-3, -6.5, -6.5] as [number, number, number], max: [4, 1.5, 1] as [number, number, number] };
const raBox = { min: [-9, -4.5, -6] as [number, number, number], max: [-1.5, 2.5, 1.2] as [number, number, number] };
const lvED = vol(edPose, [Structure.LvCavity, Structure.PapillaryMuscle], lvBox);
const lvES = vol(esPose, [Structure.LvCavity, Structure.PapillaryMuscle], lvBox);
const rvED = vol(edPose, [Structure.RvCavity, Structure.Rvot], rvBox);
const rvES = vol(esPose, [Structure.RvCavity, Structure.Rvot], rvBox);
const laMax = vol(esPose, [Structure.LaCavity], laBox); // LA maximal at end systole
const laMin = vol(edPose, [Structure.LaCavity], laBox);
const raMax = vol(esPose, [Structure.RaCavity], raBox);
const myo = vol(edPose, [Structure.LvWallSeptal, Structure.LvWallLateral, Structure.LvWallAnterior, Structure.LvWallInferior, Structure.LvApex], { min: [-5, -5, -1.5], max: [5, 5, L + 1.2] });

// linear dimensions
const zEDD = 2.0; // ~ mitral leaflet tips level (basal third), where LVIDd is measured in PLAX
const lvIDd = runAt(edPose, [Structure.LvCavity, Structure.PapillaryMuscle], [0, 0, zEDD], 0);
const lvIDs = runAt(esPose, [Structure.LvCavity, Structure.PapillaryMuscle], [0, 0, 3.2], 0); // mid-cavity, below the closed leaflets
const ivsD = runAt(edPose, [Structure.LvWallSeptal, Structure.LvWallAnterior], [-(edPose.aCav + 0.3), 0.2, zEDD], 0, 3);
const pwD = runAt(edPose, [Structure.LvWallLateral, Structure.LvWallInferior], [edPose.aCav * 0.5, -edPose.bCav - 0.3, zEDD], 1, 3);
const ivsS = runAt(esPose, [Structure.LvWallSeptal, Structure.LvWallAnterior], [-(esPose.aCav + 0.3), 0.2, zEDD], 0, 3);
const apexT = runAt(edPose, [Structure.LvApex, Structure.LvWallLateral, Structure.LvWallAnterior, Structure.LvWallInferior, Structure.LvWallSeptal], [0, 0, L + 0.2], 2, 3);
const lvLenED = 4 + extent(edPose, [Structure.LvCavity, Structure.PapillaryMuscle], [0, 0, 4], 2, 10).max - edPose.zAnn; // annulus → apex
const lvLenES = 4 + extent(esPose, [Structure.LvCavity, Structure.PapillaryMuscle], [0, 0, 4], 2, 10).max - esPose.zAnn;
// RV in the A4C plane (y ≈ −0.4): basal (1 cm below the TV annulus), mid, length
const yA4C = -0.4;
const rvBasal = runAt(edPose, [Structure.RvCavity], [-5.2, yA4C, 2.2], 0); // basal third, just apical of the open leaflet tips
const rvMid = runAt(edPose, [Structure.RvCavity], [-4.8, yA4C, L * 0.5], 0);
const rvLen = extent(edPose, [Structure.RvCavity, Structure.Rvot], [-4.6, yA4C, 2], 2, 10).len;
// analytic cavity width at the basal level (a sampled run would be interrupted by the chordae)
const lvBasalA4C = 2 * edPose.aCav * Math.sqrt(Math.max(0, 1 - ((2.2 - edPose.zcCav) / edPose.cCav) ** 2));
const rvWall = runAt(edPose, [Structure.RvWall], [-4.8 - rvBasal / 2 - 0.2, yA4C, 3.5], 0, 2);
// PLAX RV (anterior of the septum at the mid-LV level along the anteroseptal direction)
const rvPlax = runAt(edPose, [Structure.RvCavity, Structure.Rvot], [-1.2, edPose.bCav + heart.lv.ivsd + 0.8, 3.0], 1, 4);
// atria (ES = maximal)
const laAP = runAt(esPose, [Structure.LaCavity], [A.laCenter.x, A.laCenter.y, A.laCenter.z], 1);
const laTransverse = runAt(esPose, [Structure.LaCavity], [A.laCenter.x, A.laCenter.y, A.laCenter.z], 0);
const laLong = runAt(esPose, [Structure.LaCavity], [A.laCenter.x, A.laCenter.y, A.laCenter.z], 2);
const raTransverse = runAt(esPose, [Structure.RaCavity], [A.raCenter.x, A.raCenter.y, A.raCenter.z], 0);
const raLong = runAt(esPose, [Structure.RaCavity], [A.raCenter.x, A.raCenter.y, A.raCenter.z], 2);
const iasT = runAt(edPose, [Structure.InteratrialSeptum], [-2.4, -1.6, -2.2], 0, 3);
// root / outflow
const ax = A.avAxis;
const e1 = A.avE1;
/** inner diameter perpendicular to the root axis (along e1) at axial position t */
const rootAt = (t: number, pose: typeof edPose) => {
  const cz = A.avCenter.z + pose.zAnn * 0.5;
  const c0: [number, number, number] = [A.avCenter.x + ax.x * t, A.avCenter.y + ax.y * t, cz + ax.z * t];
  const step = 0.02;
  let a = 0,
    b = 0;
  const inside = (u: number) => classifyHeart(heart, pose, c0[0] + e1.x * u, c0[1] + e1.y * u, c0[2] + e1.z * u, s) && [Structure.AorticRoot, Structure.Lvot, Structure.AorticValve].includes(s.structure);
  while (a > -3 && inside(a - step)) a -= step;
  while (b < 3 && inside(b + step)) b += step;
  return b - a;
};
const lvotD = rootAt(-0.2, esPose);
const annulusD = rootAt(0.05, esPose);
const sinusD = rootAt(1.1, edPose);
const stjD = rootAt(2.3, edPose);
const ascD = rootAt(3.5, edPose);
const rvotD = 2 * A.rvotR;
// main pulmonary artery: inner diameter across the trunk 1.5 cm beyond the pulmonary valve plane
const paMid: [number, number, number] = [A.rvotB.x + A.paDir.x * 1.5, A.rvotB.y + A.paDir.y * 1.5, A.rvotB.z + A.paDir.z * 1.5];
const paD = runAt(edPose, [Structure.Rvot], paMid, 0, 3);
const mvAnn = 2 * A.mvR;
const tvAnn = 2 * A.tvR;

const row = (label: string, model: string, ref: string, verdict: string) => console.log(`${label.padEnd(40)} ${model.padStart(12)}   ${ref.padEnd(34)} ${verdict}`);
console.log(`\nCase ${c.id} · BSA ${bsa.toFixed(2)} m² · HR ${c.rhythm.heartRateBpm}\n`);
console.log(`${'Measure'.padEnd(40)} ${'model'.padStart(12)}   ${'adult reference (approx.)'.padEnd(34)} verdict`);
const v = (x: number, lo: number, hi: number) => (x < lo ? 'LOW' : x > hi ? 'HIGH' : 'ok');
row('LV EDV (mL)', lvED.toFixed(0), 'men 62–150 (2D biplane)', v(lvED, 62, 150));
row('LV ESV (mL)', lvES.toFixed(0), 'men 21–61', v(lvES, 21, 61));
row('LVEF geometric (%)', (((lvED - lvES) / lvED) * 100).toFixed(0), '52–72', v(((lvED - lvES) / lvED) * 100, 52, 72));
row('LV EDV index (mL/m²)', (lvED / bsa).toFixed(0), '34–74', v(lvED / bsa, 34, 74));
row('LVIDd (cm) at leaflet-tip level', lvIDd.toFixed(2), 'men 4.2–5.8', v(lvIDd, 4.2, 5.8));
row('LVIDs (cm)', lvIDs.toFixed(2), 'men 2.5–4.0', v(lvIDs, 2.5, 4.0));
row('LV length ED (cm, annulus→apex)', lvLenED.toFixed(1), '≈ 7.5–9.5 (endocardial)', v(lvLenED, 7.5, 9.5));
row('LV length ES (cm)', lvLenES.toFixed(1), 'shortens 1–1.5 cm (MAPSE)', v(lvLenED - lvLenES, 1.0, 1.6));
row('IVS diastolic thickness (cm)', ivsD.toFixed(2), '0.6–1.0', v(ivsD, 0.6, 1.0));
row('PW diastolic thickness (cm)', pwD.toFixed(2), '0.6–1.0', v(pwD, 0.6, 1.0));
row('IVS systolic thickness (cm)', ivsS.toFixed(2), 'thickening 30–70 %', v((ivsS / ivsD - 1) * 100, 30, 70));
row('Apex wall thickness (cm)', apexT.toFixed(2), '≈ 0.5–0.9 (thinner than base)', v(apexT, 0.5, 0.9));
row('LV myocardial volume (mL) / mass (g)', `${myo.toFixed(0)} / ${(myo * 1.05).toFixed(0)}`, 'mass men 88–224 g', v(myo * 1.05, 88, 224));
row('RV EDV (mL)', rvED.toFixed(0), '≈ 100–190 (3D/CMR), RV ≥ LV', v(rvED, 100, 190));
row('RV EF geometric (%)', (((rvED - rvES) / Math.max(1, rvED)) * 100).toFixed(0), '≈ 45–65', v(((rvED - rvES) / Math.max(1, rvED)) * 100, 45, 65));
row('RV basal diameter A4C (cm)', rvBasal.toFixed(2), '2.5–4.1', v(rvBasal, 2.5, 4.1));
row('RV mid diameter A4C (cm)', rvMid.toFixed(2), '1.9–3.5', v(rvMid, 1.9, 3.5));
row('RV length A4C (cm)', rvLen.toFixed(1), '5.9–8.3', v(rvLen, 5.9, 8.3));
row('RV/LV basal ratio (A4C)', (rvBasal / lvBasalA4C).toFixed(2), '< 0.66 normal (≈ 0.6)', v(rvBasal / lvBasalA4C, 0.45, 0.66));
row('RV free wall thickness (cm)', rvWall.toFixed(2), '≤ 0.5', v(rvWall, 0.2, 0.5));
row('RV AP dimension in PLAX (cm)', rvPlax.toFixed(2), '≈ 2.0–3.0 (≤ 1/2 of LV)', v(rvPlax, 1.8, 3.2));
row('LA AP diameter PLAX (cm)', laAP.toFixed(2), 'men 3.0–4.0', v(laAP, 3.0, 4.0));
row('LA transverse / long (cm)', `${laTransverse.toFixed(1)} / ${laLong.toFixed(1)}`, '≈ 3.5–4.5 / 4.5–5.5', v(laLong, 4.0, 5.8));
row('LA max volume (mL) / LAVI (mL/m²)', `${laMax.toFixed(0)} / ${(laMax / bsa).toFixed(0)}`, 'LAVI 16–34', v(laMax / bsa, 16, 34));
row('LA min volume (mL)', laMin.toFixed(0), '≈ 40–60 % of max', v(laMin / laMax, 0.4, 0.7));
row('RA max volume (mL) / RAVI', `${raMax.toFixed(0)} / ${(raMax / bsa).toFixed(0)}`, 'RAVI men ≤ 32', v(raMax / bsa, 12, 32));
row('RA transverse / long (cm)', `${raTransverse.toFixed(1)} / ${raLong.toFixed(1)}`, '≤ 4.4 / ≤ 5.3', v(raLong, 3.5, 5.3));
row('LA/Ao (LA AP over sinus)', (laAP / sinusD).toFixed(2), '≈ 0.9–1.2', v(laAP / sinusD, 0.85, 1.25));
row('Interatrial septum thickness (cm)', iasT.toFixed(2), '≈ 0.3–0.6 (thin, fossa)', v(iasT, 0.2, 0.7));
row('LVOT diameter (cm, systole)', lvotD.toFixed(2), '1.8–2.3', v(lvotD, 1.8, 2.3));
row('Aortic annulus (cm)', annulusD.toFixed(2), 'men 2.3–2.9', v(annulusD, 2.2, 2.9));
row('Sinus of Valsalva (cm)', sinusD.toFixed(2), 'men 3.1–3.7', v(sinusD, 2.9, 3.8));
row('Sinotubular junction (cm)', stjD.toFixed(2), 'men 2.6–3.2', v(stjD, 2.5, 3.3));
row('Ascending aorta (cm)', ascD.toFixed(2), 'men 2.6–3.4', v(ascD, 2.5, 3.5));
row('RVOT proximal diameter (cm)', rvotD.toFixed(2), '≤ 3.5 (PSAX) / distal ≤ 2.7', v(rvotD, 1.8, 3.0));
row('Main pulmonary artery (cm)', paD > 0 ? paD.toFixed(2) : 'absent', '≈ 1.5–2.5', paD > 0 ? v(paD, 1.5, 2.7) : 'MISSING');
row('Mitral annulus diameter (cm)', mvAnn.toFixed(2), '2.7–3.5 (A4C diastole)', v(mvAnn, 2.7, 3.5));
row('Tricuspid annulus diameter (cm)', tvAnn.toFixed(2), '2.8–4.0 (A4C diastole)', v(tvAnn, 2.8, 4.0));
row('TV/MV annulus ratio', (tvAnn / mvAnn).toFixed(2), '≈ 1.1–1.2', v(tvAnn / mvAnn, 1.0, 1.3));
row('RV length / LV length', (rvLen / lvLenED).toFixed(2), '≈ 0.75–0.9 (RV apex more basal)', v(rvLen / lvLenED, 0.7, 0.95));
console.log('\nModel anchors (heart frame): LA centre', JSON.stringify(A.laCenter), 'RA centre', JSON.stringify(A.raCenter), 'RV centre', JSON.stringify(A.rvCenter), 'TV centre', JSON.stringify(A.tvCenter));
