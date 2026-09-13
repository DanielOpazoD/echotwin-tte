import type { HeartModel, HeartPose } from '@/simulator/anatomy/heartModel';
import { heartAnchors } from '@/simulator/anatomy/heartModel';
import { LV_PROF_BINS } from '@/simulator/anatomy/lvShape';
import { MV_BINS } from '@/simulator/anatomy/mitralValve';
import type { ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import type { BeamFrame } from '@/simulator/probe/pose';
import { contactQuality } from '@/simulator/probe/pose';
import type { PolarFrameSpec, Scene } from '../types';
import { hash3 } from '@/core/random';

/**
 * Single source of truth for the scene parameters shared by the CPU classifier and the GLSL port:
 * every scalar the shader needs is packed into one RGBA32F data texture at a fixed offset. The
 * GLSL `#define` block is generated from this list, so TypeScript and GLSL cannot disagree on the layout.
 */
const SCALARS = [
  // heart frame (torso → heart)
  'HF_OX', 'HF_OY', 'HF_OZ', 'HF_EXX', 'HF_EXY', 'HF_EXZ', 'HF_EYX', 'HF_EYY', 'HF_EYZ', 'HF_EZX', 'HF_EZY', 'HF_EZZ',
  // beam
  'B_OX', 'B_OY', 'B_OZ', 'B_FX', 'B_FY', 'B_FZ', 'B_LX', 'B_LY', 'B_LZ', 'B_NX', 'B_NY', 'B_NZ',
  // spec / physics
  'LINES', 'SAMPLES', 'SECTOR', 'DEPTH', 'F_ATTEN', 'GRAIN_LAT', 'GRAIN_AX', 'HARM', 'CLUTTER', 'CONTACT', 'WINDOW_ATTEN', 'ELEV_OFFSET', 'ELEV_N', 'FOCUS',
  // LV geometry & pose
  'BOUND_CX', 'BOUND_CY', 'BOUND_CZ', 'BOUND_R', 'LV_RMAX_ED', 'LV_G0', 'LV_ZETAMAX', 'LV_ZETATOP', 'LV_N', 'LV_RATIO', 'LV_LEN', 'LV_IVSD', 'LV_LVPWD', 'APEX_T', 'LVOT_D',
  'ZANN', 'LV_RMAX', 'LV_PZC', 'LV_THICK_K', 'LENGTH_NOW', 'RADIAL_SCALE', 'LONG_SCALE', 'CONTRACTION', 'AV_OPEN', 'PV_OPEN', 'TVZ', 'LA_BOOSTER', 'EFFUSION',
  'MV_CALC', 'AV_CALC', 'RV_FW', 'RV_COLLAPSE', 'RA_COLLAPSE', 'SWING_X', 'SEPTAL_SHIFT',
  // anchors
  'MV_CX', 'MV_CY', 'MV_CZ', 'MV_R', 'AV_CX', 'AV_CY', 'AV_CZ', 'AV_AXX', 'AV_AXY', 'AV_AXZ', 'AV_R', 'SINUS_R', 'ASC_R',
  'AV_E1X', 'AV_E1Y', 'AV_E1Z', 'AV_E2X', 'AV_E2Y', 'AV_E2Z', 'AV_BX', 'AV_BY', 'AV_BZ',
  'LA_CX', 'LA_CY', 'LA_CZ', 'LA_RX', 'LA_RY', 'LA_RZ', 'RA_CX', 'RA_CY', 'RA_CZ', 'RA_RX', 'RA_RY', 'RA_RZ',
  'RV_T', 'RV_AZA', 'RV_AZP', 'RV_APEX_FRAC', 'TV_CX', 'TV_CY', 'TV_CZ', 'TV_R',
  'RVOT_AX', 'RVOT_AY', 'RVOT_AZ', 'RVOT_MX', 'RVOT_MY', 'RVOT_MZ', 'RVOT_BX', 'RVOT_BY', 'RVOT_BZ', 'RVOT_RA', 'RVOT_RM', 'RVOT_R', 'PA_DX', 'PA_DY', 'PA_DZ', 'PA_EX', 'PA_EY', 'PA_EZ', 'PA_R',
  'RPA_EX', 'RPA_EY', 'RPA_EZ', 'RPA_R', 'LPA_EX', 'LPA_EY', 'LPA_EZ', 'LPA_R', 'RV_PAP_AZ', 'PV_HALF', 'PV_SEGLEN', 'PV_T',
  'LA_RESERVOIR', 'IAS_X', 'FOSSA_Y', 'FOSSA_Z', 'SVC_AX', 'SVC_AY', 'SVC_AZ', 'SVC_BX', 'SVC_BY', 'SVC_BZ', 'SVC_R', 'IVC_AX', 'IVC_AY', 'IVC_AZ', 'IVC_BX', 'IVC_BY', 'IVC_BZ', 'IVC_R', 'HV_AX', 'HV_AY', 'HV_AZ', 'HV_BX', 'HV_BY', 'HV_BZ',
  // valves
  'CUSP_COUNT', 'CUSP_HALF', 'CUSP_SEGLEN', 'CUSP_T', 'CUSP_TIP_T', 'TV_RING_X', 'TV_RING_Y', 'TV_RING_Z', 'TV_RING_R',
  // mitral apparatus (mitralValve.ts): D-shaped annulus, curtain lift, inflow, and one fan of fibres per leaflet
  'MVL_CX', 'MVL_CY', 'MVL_CZ', 'MVL_R', 'MVL_D', 'MVL_UX', 'MVL_UY', 'MVL_SADDLE', 'MVL_LIFT', 'MVL_T', 'MVL_OPEN', 'MVL_SAM', 'MVL_INFLOW_SLOPE', 'MVL_INFLOW_DEPTH',
  'MVL_A_FOCUS', 'MVL_A_AXIS', 'MVL_A_HALF', 'MVL_P_FOCUS', 'MVL_P_AXIS', 'MVL_P_HALF',
  'TVS_CX', 'TVS_CY', 'TVS_CZ', 'TVS_R', 'TVS_NZ', 'TVS_CLOSED', 'TVS_BLEND', 'TVS_T', 'TVS_SADDLE',
  // thorax
  'TH_AW', 'TH_BDEPTH', 'TH_N', 'TH_CHESTWALL', 'TH_RIBR', 'TH_RIBSP', 'TH_RIB2Y', 'TH_RIBSLOPE', 'TH_LUNGSHIFT', 'TH_ABD', 'TH_DIAPH',
] as const;
type ScalarName = (typeof SCALARS)[number];

/** Array blocks (contiguous floats) after the scalars. */
const ARRAYS: [string, number][] = [
  ['SEG_AMP', 18],
  ['LV_PROF_R', LV_PROF_BINS],
  ['LV_PROF_S', LV_PROF_BINS],
  ['PAPS', 16],
  ['RVPAP', 8],
  ['PV_SEGS', 36],
  ['PV_W', 9],
  ['CUSP_SEGS', 3 * 2 * 6],
  ['CUSP_W', 9],
  ['CHORDAE', 10 * 6],
  // per leaflet: hinge, reach, tent, hinge z and open rotation per bin, then the open profile
  ['MVL_A_TAB', 5 * MV_BINS],
  ['MVL_A_PROF', 6],
  ['MVL_P_TAB', 5 * MV_BINS],
  ['MVL_P_PROF', 6],
  ['TVS_ZONES', 3 * 6],
  ['TVS_PROF', 3 * 8],
  ['LINE_DROP', 256],
];

export const PARAM_OFFSET: Record<string, number> = {};
let cursor = 0;
for (const n of SCALARS) PARAM_OFFSET[n] = cursor++;
for (const [n, len] of ARRAYS) {
  PARAM_OFFSET[n] = cursor;
  cursor += len;
}
export const PARAM_COUNT = cursor;
/** Texture width in RGBA texels (4 floats each). */
export const PARAM_TEXELS = Math.ceil(PARAM_COUNT / 4);

/** GLSL defines for every offset (P(i) reads float i from the parameter texture). */
export function paramDefinesGlsl(): string {
  const lines: string[] = [];
  for (const n of SCALARS) lines.push(`#define ${n} P(${PARAM_OFFSET[n]})`);
  for (const [n] of ARRAYS) lines.push(`#define ${n}_BASE ${PARAM_OFFSET[n]}`);
  return lines.join('\n');
}

export interface PackedScene {
  data: Float32Array;
}

export function allocPacked(): PackedScene {
  return { data: new Float32Array(PARAM_TEXELS * 4) };
}

/** Pack scene + beam + spec into the parameter buffer (same derivations as ProceduralSliceRenderer.prepare). */
export function packScene(scene: Scene, beam: BeamFrame, spec: PolarFrameSpec, out: PackedScene, elevationOffsetCm = 0): void {
  const d = out.data;
  const set = (n: ScalarName, v: number): void => {
    d[PARAM_OFFSET[n]!] = v;
  };
  const { heart, heartPose: hp, thorax, physics } = scene;
  const hf = heart.frame;
  set('HF_OX', hf.origin.x);
  set('HF_OY', hf.origin.y);
  set('HF_OZ', hf.origin.z);
  set('HF_EXX', hf.ex.x);
  set('HF_EXY', hf.ex.y);
  set('HF_EXZ', hf.ex.z);
  set('HF_EYX', hf.ey.x);
  set('HF_EYY', hf.ey.y);
  set('HF_EYZ', hf.ey.z);
  set('HF_EZX', hf.ez.x);
  set('HF_EZY', hf.ez.y);
  set('HF_EZZ', hf.ez.z);
  set('B_OX', beam.origin.x);
  set('B_OY', beam.origin.y);
  set('B_OZ', beam.origin.z);
  set('B_FX', beam.forward.x);
  set('B_FY', beam.forward.y);
  set('B_FZ', beam.forward.z);
  set('B_LX', beam.lateral.x);
  set('B_LY', beam.lateral.y);
  set('B_LZ', beam.lateral.z);
  set('B_NX', beam.normal.x);
  set('B_NY', beam.normal.y);
  set('B_NZ', beam.normal.z);
  const f = physics.frequencyMHz;
  const harm = physics.harmonics;
  set('LINES', spec.lines);
  set('SAMPLES', spec.samples);
  set('SECTOR', spec.sectorRad);
  set('DEPTH', spec.depthCm);
  set('F_ATTEN', f * (harm ? 1.2 : 1));
  set('GRAIN_LAT', Math.sqrt(f / 2.5));
  set('GRAIN_AX', (f / 2.5) * 2.2 * (harm ? 1.25 : 1));
  set('HARM', harm ? 1 : 0);
  set('CLUTTER', (physics.clutterLevel * 2.5 + physics.windowAttenuation * 0.8) * (harm ? 0.35 : 1) * Math.sqrt(2.5 / f));
  set('CONTACT', contactQuality(beam.contact));
  set('WINDOW_ATTEN', physics.windowAttenuation);
  set('ELEV_OFFSET', elevationOffsetCm);
  set('ELEV_N', spec.elevationSamples);
  set('FOCUS', spec.focusCm);
  const lv = heart.lv;
  set('BOUND_CX', heart.boundCenter.x);
  set('BOUND_CY', heart.boundCenter.y);
  set('BOUND_CZ', heart.boundCenter.z);
  set('BOUND_R', heart.boundRadius);
  set('LV_RMAX_ED', lv.rMax);
  set('LV_G0', lv.shape.g0);
  set('LV_ZETAMAX', lv.shape.zetaMax);
  set('LV_ZETATOP', lv.shape.zetaTop);
  set('LV_N', lv.shape.n);
  set('LV_RATIO', lv.shape.ratio);
  set('LV_LEN', lv.lengthCm);
  set('LV_IVSD', lv.ivsd);
  set('LV_LVPWD', lv.lvpwd);
  set('APEX_T', heart.anatomy.lv.apexWallThicknessCm);
  set('LVOT_D', heart.anatomy.aorta.lvotDiameterCm);
  set('ZANN', hp.zAnn);
  set('LV_RMAX', hp.rMax);
  set('LV_PZC', hp.prof.zc);
  set('LV_THICK_K', hp.thickK);
  set('LENGTH_NOW', hp.lengthNow);
  d.set(hp.prof.R, PARAM_OFFSET['LV_PROF_R']!);
  d.set(hp.prof.S, PARAM_OFFSET['LV_PROF_S']!);
  d.set(hp.paps, PARAM_OFFSET['PAPS']!);
  d.set(hp.rvPap, PARAM_OFFSET['RVPAP']!);
  set('RADIAL_SCALE', hp.radialScale);
  set('LONG_SCALE', hp.longScale);
  set('CONTRACTION', hp.state.contraction);
  set('AV_OPEN', hp.state.avOpen);
  set('PV_OPEN', hp.state.pvOpen);
  set('TVZ', hp.tvZ);
  set('LA_BOOSTER', hp.laBooster);
  set('EFFUSION', hp.effusion);
  set('MV_CALC', heart.anatomy.mitral.calcification);
  set('AV_CALC', heart.anatomy.aorticValve.calcification);
  set('RV_FW', heart.anatomy.rv.freeWallThicknessCm);
  set('RV_COLLAPSE', hp.rvCollapse);
  set('RA_COLLAPSE', hp.raCollapse);
  set('SWING_X', hp.swingX);
  set('SEPTAL_SHIFT', hp.septalShiftCm);
  const A = heartAnchors(heart);
  set('MV_CX', A.mvCenter.x);
  set('MV_CY', A.mvCenter.y);
  set('MV_CZ', A.mvCenter.z);
  set('MV_R', A.mvR);
  set('AV_CX', A.avCenter.x);
  set('AV_CY', A.avCenter.y);
  set('AV_CZ', A.avCenter.z);
  set('AV_AXX', A.avAxis.x);
  set('AV_AXY', A.avAxis.y);
  set('AV_AXZ', A.avAxis.z);
  set('AV_R', A.avR);
  set('SINUS_R', A.sinusR);
  set('ASC_R', A.ascR);
  set('AV_E1X', A.avE1.x);
  set('AV_E1Y', A.avE1.y);
  set('AV_E1Z', A.avE1.z);
  set('AV_E2X', A.avE2.x);
  set('AV_E2Y', A.avE2.y);
  set('AV_E2Z', A.avE2.z);
  set('AV_BX', A.avBend.x);
  set('AV_BY', A.avBend.y);
  set('AV_BZ', A.avBend.z);
  set('LA_CX', A.laCenter.x);
  set('LA_CY', A.laCenter.y);
  set('LA_CZ', A.laCenter.z);
  set('LA_RX', A.laR.x);
  set('LA_RY', A.laR.y);
  set('LA_RZ', A.laR.z);
  set('RA_CX', A.raCenter.x);
  set('RA_CY', A.raCenter.y);
  set('RA_CZ', A.raCenter.z);
  set('RA_RX', A.raR.x);
  set('RA_RY', A.raR.y);
  set('RA_RZ', A.raR.z);
  set('RV_T', A.rvT);
  set('RV_AZA', A.rvAzA);
  set('RV_AZP', A.rvAzP);
  set('RV_APEX_FRAC', A.rvApexFrac);
  set('TV_CX', A.tvCenter.x);
  set('TV_CY', A.tvCenter.y);
  set('TV_CZ', A.tvCenter.z);
  set('TV_R', A.tvR);
  set('RVOT_AX', A.rvotA.x);
  set('RVOT_AY', A.rvotA.y);
  set('RVOT_AZ', A.rvotA.z);
  set('RVOT_BX', A.rvotB.x);
  set('RVOT_BY', A.rvotB.y);
  set('RVOT_BZ', A.rvotB.z);
  set('RVOT_MX', A.rvotM.x);
  set('RVOT_MY', A.rvotM.y);
  set('RVOT_MZ', A.rvotM.z);
  set('RVOT_RA', A.rvotRa);
  set('RVOT_RM', A.rvotRm);
  set('RVOT_R', A.rvotR);
  set('RPA_EX', A.rpaEnd.x);
  set('RPA_EY', A.rpaEnd.y);
  set('RPA_EZ', A.rpaEnd.z);
  set('RPA_R', A.rpaR);
  set('LPA_EX', A.lpaEnd.x);
  set('LPA_EY', A.lpaEnd.y);
  set('LPA_EZ', A.lpaEnd.z);
  set('LPA_R', A.lpaR);
  set('RV_PAP_AZ', A.rvPapAz);
  set('LA_RESERVOIR', A.laReservoir);
  set('IAS_X', A.iasX);
  set('FOSSA_Y', A.fossaY);
  set('FOSSA_Z', A.fossaZ);
  set('SVC_AX', A.svcA.x);
  set('SVC_AY', A.svcA.y);
  set('SVC_AZ', A.svcA.z);
  set('SVC_BX', A.svcB.x);
  set('SVC_BY', A.svcB.y);
  set('SVC_BZ', A.svcB.z);
  set('SVC_R', A.svcR);
  set('IVC_AX', A.ivcA.x);
  set('IVC_AY', A.ivcA.y);
  set('IVC_AZ', A.ivcA.z);
  set('IVC_BX', A.ivcB.x);
  set('IVC_BY', A.ivcB.y);
  set('IVC_BZ', A.ivcB.z);
  set('IVC_R', A.ivcR * (1 - heart.ivcCollapse));
  set('HV_AX', A.hvA.x);
  set('HV_AY', A.hvA.y);
  set('HV_AZ', A.hvA.z);
  set('HV_BX', A.hvB.x);
  set('HV_BY', A.hvB.y);
  set('HV_BZ', A.hvB.z);
  set('PA_DX', A.paDir.x);
  set('PA_DY', A.paDir.y);
  set('PA_DZ', A.paDir.z);
  set('PA_EX', A.paEnd.x);
  set('PA_EY', A.paEnd.y);
  set('PA_EZ', A.paEnd.z);
  set('PA_R', A.paR);
  const V = hp.valves;
  set('CUSP_COUNT', V.cuspCount);
  set('CUSP_HALF', V.cuspHalf);
  set('CUSP_SEGLEN', V.cuspSegLen);
  set('CUSP_T', V.cuspThickness);
  set('CUSP_TIP_T', V.cuspTipT);
  set('TV_RING_X', V.tvRing[0]);
  set('TV_RING_Y', V.tvRing[1]);
  set('TV_RING_Z', V.tvRing[2]);
  set('TV_RING_R', V.tvRing[3]);
  const mv = V.mitral;
  set('MVL_CX', mv.cx);
  set('MVL_CY', mv.cy);
  set('MVL_CZ', mv.cz);
  set('MVL_R', mv.R);
  set('MVL_D', mv.D);
  set('MVL_UX', mv.ux);
  set('MVL_UY', mv.uy);
  set('MVL_SADDLE', mv.saddle);
  set('MVL_LIFT', mv.lift);
  set('MVL_T', mv.thickness);
  set('MVL_OPEN', mv.open);
  set('MVL_SAM', mv.samBlend);
  set('MVL_INFLOW_SLOPE', mv.inflowSlope);
  set('MVL_INFLOW_DEPTH', mv.inflowDepth);
  for (const [prefix, L] of [
    ['MVL_A', mv.anterior],
    ['MVL_P', mv.posterior],
  ] as const) {
    set(`${prefix}_FOCUS`, L.focusV);
    set(`${prefix}_AXIS`, L.axisSign);
    set(`${prefix}_HALF`, L.halfSpan);
    const tb = PARAM_OFFSET[`${prefix}_TAB`]!;
    d.set(L.hinge, tb);
    d.set(L.reach, tb + MV_BINS);
    d.set(L.tent, tb + 2 * MV_BINS);
    d.set(L.hingeZ, tb + 3 * MV_BINS);
    d.set(L.openRot, tb + 4 * MV_BINS);
    d.set(L.openProf, PARAM_OFFSET[`${prefix}_PROF`]!);
  }
  const sk = (prefix: 'TVS', k: typeof V.tv): void => {
    set(`${prefix}_CX`, k.cx);
    set(`${prefix}_CY`, k.cy);
    set(`${prefix}_CZ`, k.cz);
    set(`${prefix}_R`, k.R);
    set(`${prefix}_NZ`, k.zones.length);
    set(`${prefix}_CLOSED`, k.closed);
    set(`${prefix}_BLEND`, k.blend);
    set(`${prefix}_T`, k.thickness);
    set(`${prefix}_SADDLE`, k.saddle);
    const zb = PARAM_OFFSET[`${prefix}_ZONES`]!;
    const pb = PARAM_OFFSET[`${prefix}_PROF`]!;
    d.fill(0, zb, zb + 18);
    d.fill(0, pb, pb + 24);
    for (let i = 0; i < k.zones.length && i < 3; i++) {
      const zn = k.zones[i]!;
      d[zb + i * 6] = zn.phi;
      d[zb + i * 6 + 1] = zn.halfSpan;
      d[zb + i * 6 + 2] = zn.kind;
      d[zb + i * 6 + 3] = zn.lobes;
      d[zb + i * 6 + 4] = zn.c;
      d[zb + i * 6 + 5] = zn.structure;
      d.set(zn.prof, pb + i * 8);
    }
  };
  sk('TVS', V.tv);
  d.set(heart.segAmp.subarray(0, 18), PARAM_OFFSET['SEG_AMP']!);
  d.fill(0, PARAM_OFFSET['CUSP_SEGS']!, PARAM_OFFSET['CUSP_SEGS']! + 36);
  d.set(V.segs.subarray(0, Math.min(36, V.segs.length)), PARAM_OFFSET['CUSP_SEGS']!);
  d.fill(0, PARAM_OFFSET['CUSP_W']!, PARAM_OFFSET['CUSP_W']! + 9);
  d.set(V.cuspWidths.subarray(0, Math.min(9, V.cuspWidths.length)), PARAM_OFFSET['CUSP_W']!);
  d.set(V.chordae.subarray(0, 60), PARAM_OFFSET['CHORDAE']!);
  set('PV_HALF', V.pvHalf);
  set('PV_SEGLEN', V.pvSegLen);
  set('PV_T', V.pvThickness);
  d.set(V.pvSegs, PARAM_OFFSET['PV_SEGS']!);
  d.set(V.pvWidths, PARAM_OFFSET['PV_W']!);
  set('TH_AW', thorax.aw);
  set('TH_BDEPTH', thorax.bDepth);
  set('TH_N', thorax.n);
  set('TH_CHESTWALL', thorax.chestWall);
  set('TH_RIBR', thorax.ribRadius);
  set('TH_RIBSP', thorax.ribSpacing);
  set('TH_RIB2Y', thorax.rib2Y);
  set('TH_RIBSLOPE', thorax.ribSlope);
  set('TH_LUNGSHIFT', thorax.lungShiftCm);
  set('TH_ABD', thorax.abdomenSlope);
  set('TH_DIAPH', thorax.diaphragmRiseCm);
  const contact = contactQuality(beam.contact);
  const ld = PARAM_OFFSET['LINE_DROP']!;
  for (let li = 0; li < 256; li++) d[ld + li] = li < spec.lines ? (hash3(li, 7, 0, physics.seed) > contact ? 0.08 : 1) : 1;
}

/** Type helper so the pose's valve type can be referenced in packScene. */
export type PoseValves = HeartPose['valves'];
export type HeartModelRef = HeartModel;
export type ThoraxRef = ThoraxModel;
