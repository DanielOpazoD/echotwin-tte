import type { Vec3 } from '@/core/vec3';
import { dot, normalize, radToDeg, sub, v3 } from '@/core/vec3';
import type { HeartModel, HeartPose } from '@/simulator/anatomy/heartModel';
import {
  anchorsCached,
  heartDirToTorso,
  heartLandmarks,
  heartRootAxis,
  heartToTorso,
} from '@/simulator/anatomy/heartModel';
import type { ThoraxModel } from '@/simulator/anatomy/thoraxModel';
import type { BeamFrame, ProbeControl } from '@/simulator/probe/pose';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import {
  canonicalBeam,
  canonicalPlane,
  VIEW_TARGETS,
  type ViewTarget,
  type WindowId,
  landmarkReachCm,
} from '@/simulator/windows/viewTargets';
import type { AcquisitionSettings, PolarFrame } from '@/simulator/renderer/types';
import { Structure, Tissue } from '@/simulator/anatomy/tissue';
import { CAMUS_GOOD } from '@/clinical/reference-values/camusImageStats';
import { softTissueTransmission } from '@/simulator/renderer/acoustic/acoustics';
import { hiddenSegmentCodes, segmentCoverage, type SegmentCoverage } from './segmentCoverage';

/**
 * Gain check against clinical optimal-window images (decision 73). The reference is the median grey of the LV cavity
 * and of the LV myocardium in CAMUS apical images rated Good, over the four view/phase conditions: inside their
 * interquartile range the gain is right, and the hint appears once the image is further out than the brightest (or
 * darkest) tenth of those images. It replaced a check calibrated on textbook "anechoic blood" (blood mean above 22%
 * of white was overgain), which flagged half of the clinical optimal-window images — and the calibrated default — as
 * overgained.
 */
const GOOD = Object.values(CAMUS_GOOD);
const BLOOD_OK = Math.max(...GOOD.map((q) => q.cavityGrey.p75)) / 255;
const BLOOD_HINT = Math.max(...GOOD.map((q) => q.cavityGrey.p90)) / 255;
const MYO_OK = Math.min(...GOOD.map((q) => q.myocardiumGrey.p25)) / 255;
const MYO_HINT = Math.min(...GOOD.map((q) => q.myocardiumGrey.p10)) / 255;
/** Score lost at the p10/p90 fence: 0.3 puts the gain component at the 0.7 below which the hint is shown. */
const GAIN_PENALTY_AT_FENCE = 0.3;
/**
 * Fewer LV samples than this means a view without the LV (PSAX-AV, subcostal IVC). Blood is the same tissue in every
 * chamber, so overgain falls back to all cardiac blood; the myocardium there is thin atrial or right-heart wall, not
 * the LV myocardium the reference measured, so undergain is not judged (it flagged the subcostal IVC at −6 dB).
 */
const MIN_LV_SAMPLES = 30;

function histogramMedian(h: Uint32Array, n: number): number {
  let acc = 0;
  for (let g = 0; g < h.length; g++) {
    acc += h[g]!;
    if (acc * 2 >= n) return g / 255;
  }
  return 0;
}

/**
 * ViewQualityEngine (spec 5.11, 28.1, 52). Scores are 0–100 with explicit components; landmark
 * presence is tested geometrically against the SAME model that renders the image (plane distance,
 * sector, depth, and shadowing from the frame's transmission map). Hints are deterministic rules,
 * never a classifier. The view never "snaps": this only measures.
 */
export interface ViewComponentScores {
  plane: number; // 0..1 geometric similarity of the imaging plane
  landmarks: number; // 0..1 weighted presence of required landmarks minus penalties
  geometry: number; // 0..1 foreshortening / truncation
  centering: number;
  depth: number;
  gain: number;
  artifacts: number;
}

export interface ViewAnalysis {
  window: WindowId | 'none';
  bestViewId: string | null;
  bestViewName: string;
  score: number; // 0..100
  components: ViewComponentScores;
  visibleLandmarks: string[];
  missingLandmarks: string[];
  penaltyLandmarksPresent: string[];
  foreshorteningDeg: number;
  planeAngleDeg: number;
  inPlaneRotationDeg: number;
  offsetCm: number;
  hints: string[];
  perView: { id: string; score: number }[];
  heartCoverage: number; // fraction of sector samples that hit cardiac tissue
  shadowFraction: number; // fraction of cardiac samples with poor transmission
  /**
   * LV segments of the drawn plane (decision 152), from the tissue the beam crosses: the anatomical AHA 17 model and
   * the 16-segment wall-motion model, whose apical segments include the cap.
   */
  segments: { aha17: SegmentCoverage[]; lv16: SegmentCoverage[] };
}

const WEIGHTS: Record<keyof ViewComponentScores, number> = {
  plane: 0.2,
  landmarks: 0.3,
  geometry: 0.15,
  centering: 0.1,
  depth: 0.1,
  gain: 0.1,
  artifacts: 0.05,
};

export function windowFromSkin(u: number, v: number): WindowId | 'none' {
  if (v > 8) return 'suprasternal';
  if (v < -7.5) return 'subcostal';
  if (u >= 0 && u < 5.2 && v > -2.5) return 'parasternal';
  if (u >= 4.2 && v <= 0.5) return 'apical';
  return 'none';
}

interface LandmarkTest {
  id: string;
  visible: boolean;
  planeDistCm: number;
  inSector: boolean;
  transmission: number;
}

/**
 * Two-way transmission expected through average soft tissue at depth r for the acquisition: the harmonic factor only
 * with harmonics on. It applied the harmonic factor always, and with harmonics off it expected 1.2 times the soft tissue
 * loss, so a sample had to lose that much more before it counted as shadowed.
 */
export function expectedTransmission(
  rCm: number,
  frequencyMHz: number,
  harmonics: boolean,
): number {
  return softTissueTransmission(rCm, frequencyMHz, harmonics);
}

function testLandmark(
  p: Vec3,
  radius: number,
  beam: BeamFrame,
  frame: PolarFrame,
  frequencyMHz: number,
  harmonics: boolean,
): LandmarkTest & { thetaRad: number; rCm: number } {
  const d = sub(p, beam.origin);
  const depth = dot(d, beam.forward);
  const lateral = dot(d, beam.lateral);
  const elev = dot(d, beam.normal);
  const r = Math.hypot(depth, lateral);
  const theta = Math.atan2(lateral, depth);
  const { lines, samples, sectorRad, depthCm } = frame.spec;
  const inSector = depth > 0.4 && Math.abs(theta) < sectorRad / 2 - 0.02 && r < depthCm - 0.3;
  let transmission = 0;
  if (inSector) {
    const li = Math.min(
      lines - 1,
      Math.max(0, Math.floor(((theta + sectorRad / 2) / sectorRad) * lines)),
    );
    const si = Math.min(samples - 1, Math.max(0, Math.floor((r / depthCm) * samples)));
    transmission = frame.transmission[li * samples + si] ?? 0;
  }
  const planeDist = Math.abs(elev);
  const tol = landmarkReachCm(radius);
  // shadow test is relative to the expected soft-tissue attenuation at this depth
  const expected = expectedTransmission(r, frequencyMHz, harmonics);
  const lit = transmission > 0.2 * expected;
  return {
    id: '',
    visible: inSector && planeDist < tol && lit,
    planeDistCm: planeDist,
    inSector,
    transmission: lit ? 1 : 0,
    thetaRad: theta,
    rCm: r,
  };
}

export interface AnalyzeInput {
  heart: HeartModel;
  thorax: ThoraxModel;
  control: ProbeControl;
  beam: BeamFrame;
  frame: PolarFrame;
  display: Uint8ClampedArray | null; // post-console polar intensities for gain checks
  settings: AcquisitionSettings;
  /** Heart pose of the frame: with it, the LV segments the lung hides count as in the plane (decision 152). */
  heartPose?: HeartPose;
}

export function analyzeView(input: AnalyzeInput): ViewAnalysis {
  const { heart, control, beam, frame, settings } = input;
  const window = windowFromSkin(control.u, control.v);
  const landmarks = heartLandmarks(heart);
  const lmTorso = new Map<string, { p: Vec3; radius: number }>();
  for (const l of landmarks)
    lmTorso.set(l.id, { p: heartToTorso(heart.frame, l.p), radius: l.radius });
  const lmTests = new Map<string, ReturnType<typeof testLandmark>>();
  for (const [id, l] of lmTorso) {
    const t = testLandmark(l.p, l.radius, beam, frame, settings.frequencyMHz, settings.harmonics);
    t.id = id;
    lmTests.set(id, t);
  }
  // frame statistics: coverage & shadowing & gain
  const { lines, samples } = frame.spec;
  let cardiac = 0,
    shadowed = 0;
  // grey histograms of the post-console display: LV cavity and LV walls, as CAMUS labels them, and all cardiac
  // blood for views without the LV
  const hLvBlood = new Uint32Array(256),
    hLvMyo = new Uint32Array(256),
    hBlood = new Uint32Array(256);
  let lvBloodN = 0,
    lvMyoN = 0,
    bloodN = 0;
  const n = lines * samples;
  const dr = frame.spec.depthCm / samples;
  for (let i = 0; i < n; i += 3) {
    const t = frame.tissue[i];
    const st = frame.structure[i] ?? 0;
    if (st !== 0 && st < 25) {
      cardiac++;
      const r = ((i % samples) + 0.5) * dr;
      if (
        (frame.transmission[i] ?? 0) <
        0.2 * expectedTransmission(r, settings.frequencyMHz, settings.harmonics)
      )
        shadowed++;
      if (input.display) {
        const g = input.display[i] ?? 0;
        if (t === Tissue.Blood) {
          hBlood[g]!++;
          bloodN++;
          if (st === Structure.LvCavity) {
            hLvBlood[g]!++;
            lvBloodN++;
          }
        } else if (t === Tissue.Myocardium) {
          if (st >= Structure.LvWallSeptal && st <= Structure.LvApex) {
            hLvMyo[g]!++;
            lvMyoN++;
          }
        }
      }
    }
  }
  const heartCoverage = cardiac / (n / 3);
  const shadowFraction = cardiac ? shadowed / cardiac : 1;
  const bloodMedian =
    lvBloodN >= MIN_LV_SAMPLES
      ? histogramMedian(hLvBlood, lvBloodN)
      : bloodN
        ? histogramMedian(hBlood, bloodN)
        : 0;
  const myoMedian = lvMyoN >= MIN_LV_SAMPLES ? histogramMedian(hLvMyo, lvMyoN) : 1;
  let gainScore = 1;
  const overgain = bloodMedian > BLOOD_OK;
  if (overgain)
    gainScore -= Math.min(
      0.7,
      (GAIN_PENALTY_AT_FENCE * (bloodMedian - BLOOD_OK)) / (BLOOD_HINT - BLOOD_OK),
    );
  if (myoMedian < MYO_OK)
    gainScore -= Math.min(
      0.7,
      (GAIN_PENALTY_AT_FENCE * (MYO_OK - myoMedian)) / (MYO_OK - MYO_HINT),
    );
  gainScore = Math.max(0, gainScore);
  const artifactsScore = Math.max(0, 1 - shadowFraction * 1.6);

  // candidate views in this window
  const candidates = VIEW_TARGETS.filter((v) => v.window === window);
  const perView: {
    id: string;
    score: number;
    analysis: Partial<ViewAnalysis> & { components: ViewComponentScores };
  }[] = [];
  for (const view of candidates) {
    const plane = canonicalPlane(view, heart, input.thorax);
    // similarity is measured against the pose an expert can actually reach from this window in this
    // synthetic thorax (canonical beam); obliquity vs the ideal anatomical plane is reported separately
    const canon = canonicalBeam(view, heart, input.thorax);
    const planeAngle = radToDeg(Math.acos(Math.min(1, Math.abs(dot(canon.normal, beam.normal)))));
    // in-plane rotation: compare the lateral axis with the canonical pose's lateral axis projected on the current plane
    const rightProj = normalize(
      sub(canon.lateral, scaleV(beam.normal, dot(canon.lateral, beam.normal))),
    );
    const inPlane = radToDeg(Math.acos(Math.min(1, Math.max(-1, dot(rightProj, beam.lateral)))));
    // offset: distance of the target from the beam centre line
    const d = sub(plane.target, beam.origin);
    const along = dot(d, beam.forward);
    const off = Math.hypot(dot(d, beam.lateral), dot(d, beam.normal));
    const tol = view.tolerance;
    const planeScore =
      clamp01(1 - planeAngle / (tol.planeAngleDeg * 2)) *
      clamp01(1 - inPlane / (tol.inPlaneRotationDeg * 2.5));
    // landmarks
    let got = 0,
      total = 0;
    const visible: string[] = [];
    const missing: string[] = [];
    for (const req of view.requiredLandmarks) {
      const t = lmTests.get(req.landmarkId);
      total += req.weight;
      if (t?.visible) {
        got += req.weight;
        visible.push(req.landmarkId);
      } else if (t && t.inSector && t.planeDistCm < 1.6 && t.transmission > 0.5) {
        got += req.weight * 0.4; // partially in the slice
        missing.push(req.landmarkId);
      } else missing.push(req.landmarkId);
    }
    const penaltyPresent: string[] = [];
    let penalty = 0;
    for (const pen of view.penaltyLandmarks) {
      const t = lmTests.get(pen.landmarkId);
      if (t?.visible) {
        penalty += pen.weight * 0.12;
        penaltyPresent.push(pen.landmarkId);
      }
    }
    const landmarkScore = clamp01(total ? got / total - penalty : 0);
    // geometry: foreshortening for apical views = angle between plane and LV long axis + apex plane distance
    const lvAxis = heartDirToTorso(heart.frame, v3(0, 0, 1));
    const axisPlaneAngle = radToDeg(Math.asin(Math.min(1, Math.abs(dot(lvAxis, beam.normal)))));
    const apexT = lmTests.get('lv-apex');
    let geometryScore = 1;
    let foreshorteningDeg = axisPlaneAngle;
    if (view.window === 'apical') {
      const apexDist = apexT ? apexT.planeDistCm : 5;
      foreshorteningDeg = axisPlaneAngle + apexDist * 12;
      geometryScore = clamp01(1 - foreshorteningDeg / 40);
    } else if (view.id === 'plax' || view.id === 'subcostal-4c') {
      // long-axis views: the plane should hold the LV long axis. The subcostal four-chamber view fell in the short-axis
      // branch, which read a plane holding the axis as 90° oblique and scored its geometry 0 (decision 167)
      geometryScore = clamp01(1 - axisPlaneAngle / 35);
    } else if (view.id === 'subcostal-ivc') {
      // the long axis of the cava is what this view holds (decision 131)
      const A = anchorsCached(heart);
      const ivcAxis = heartDirToTorso(heart.frame, normalize(sub(A.ivcB, A.ivcA)));
      const ivcPlaneAngle = radToDeg(Math.asin(Math.min(1, Math.abs(dot(ivcAxis, beam.normal)))));
      geometryScore = clamp01(1 - ivcPlaneAngle / 35);
      foreshorteningDeg = ivcPlaneAngle;
    } else {
      // short axis: obliquity = deviation from perpendicular to the reference axis (LV long axis, or the
      // aortic root axis for the AV level); mild penalty because some obliquity is normal
      const refAxis =
        view.id === 'psax-av' ? heartDirToTorso(heart.frame, heartRootAxis(heart)) : lvAxis;
      const refAngle = radToDeg(Math.asin(Math.min(1, Math.abs(dot(refAxis, beam.normal)))));
      const obliquity = 90 - refAngle;
      geometryScore = clamp01(1 - Math.max(0, obliquity - 12) / 50);
      foreshorteningDeg = obliquity;
    }
    const centeringScore = clamp01(1 - off / 3.5) * (along > 0 ? 1 : 0);
    const [dLo, dHi] = view.recommendedDepthRangeCm;
    const depthScore =
      settings.depthCm < dLo
        ? clamp01(1 - (dLo - settings.depthCm) / 5)
        : settings.depthCm > dHi
          ? clamp01(1 - (settings.depthCm - dHi) / 8)
          : 1;
    const comps: ViewComponentScores = {
      plane: planeScore,
      landmarks: landmarkScore,
      geometry: geometryScore,
      centering: centeringScore,
      depth: depthScore,
      gain: gainScore,
      artifacts: artifactsScore,
    };
    let score = 0;
    for (const k of Object.keys(WEIGHTS) as (keyof ViewComponentScores)[])
      score += WEIGHTS[k] * comps[k];
    // gates: a wrong plane cannot be rescued by landmarks that happen to be shared between views,
    // and a pose cannot score high with < 40% of its landmarks
    score *= 0.35 + 0.65 * planeScore;
    if (landmarkScore < 0.4) score *= 0.5 + landmarkScore;
    perView.push({
      id: view.id,
      score: Math.round(score * 100),
      analysis: {
        components: comps,
        visibleLandmarks: visible,
        missingLandmarks: missing,
        penaltyLandmarksPresent: penaltyPresent,
        foreshorteningDeg,
        planeAngleDeg: planeAngle,
        inPlaneRotationDeg: inPlane,
        offsetCm: off,
      },
    });
  }
  perView.sort((a, b) => b.score - a.score);
  const best = perView[0];
  const view = best ? VIEW_TARGETS.find((v) => v.id === best.id)! : null;
  const hints: string[] = [];
  // whatever the view, the segments come from the tissue in the frame; their border visibility from the displayed image
  const shown =
    input.display && bloodN > 0
      ? { grey: input.display, cavityGrey: Math.round(bloodMedian * 255) }
      : undefined;
  const hidden = input.heartPose
    ? hiddenSegmentCodes(frame, heart, input.heartPose, beam)
    : undefined;
  const segments = {
    aha17: segmentCoverage(frame, 'LV_AHA17', shown, hidden),
    lv16: segmentCoverage(frame, 'LV_16', shown, hidden),
  };
  if (!best || !view) {
    hints.push(
      window === 'none'
        ? 'Sonda fuera de una ventana acústica útil: acércate al borde esternal izquierdo o al ápex.'
        : 'Ventana sin vistas definidas en esta versión.',
    );
    return {
      window,
      bestViewId: null,
      bestViewName: '—',
      score: 0,
      components: {
        plane: 0,
        landmarks: 0,
        geometry: 0,
        centering: 0,
        depth: 0,
        gain: gainScore,
        artifacts: artifactsScore,
      },
      visibleLandmarks: [],
      missingLandmarks: [],
      penaltyLandmarksPresent: [],
      foreshorteningDeg: 0,
      planeAngleDeg: 0,
      inPlaneRotationDeg: 0,
      offsetCm: 0,
      hints,
      perView: [],
      heartCoverage,
      shadowFraction,
      segments,
    };
  }
  const a = best.analysis;
  hints.push(
    ...poseHints(
      view,
      heart,
      input.thorax,
      control,
      a.planeAngleDeg ?? 0,
      a.inPlaneRotationDeg ?? 0,
      a.offsetCm ?? 0,
    ),
  );
  if (shadowFraction > 0.35)
    hints.push(
      'Gran parte del corazón está en sombra: probablemente hay costilla o pulmón en el trayecto. Desplaza la sonda al espacio intercostal o pide espiración.',
    );
  if (heartCoverage < 0.08)
    hints.push('Casi no hay tejido cardíaco en el sector: reposiciona la sonda sobre la ventana.');
  if ((a.missingLandmarks?.length ?? 0) > 0 && (a.planeAngleDeg ?? 0) < 12) {
    const names = a
      .missingLandmarks!.slice(0, 3)
      .map((id) => landmarks.find((l) => l.id === id)?.label ?? id);
    hints.push(`Faltan referencias: ${names.join(', ')}.`);
  }
  if (view.window === 'apical' && (a.foreshorteningDeg ?? 0) > 15)
    hints.push(
      'El ápex está acortado: desplaza la sonda un espacio más abajo/lateral y angula hacia la base para alargar el VI.',
    );
  if (settings.depthCm > view.recommendedDepthRangeCm[1])
    hints.push(
      'Demasiada profundidad para esta vista: reduce la profundidad para ganar resolución y frame rate.',
    );
  if (settings.depthCm < view.recommendedDepthRangeCm[0])
    hints.push('Profundidad insuficiente: las estructuras posteriores quedan fuera del sector.');
  if (gainScore < 0.7)
    hints.push(
      overgain
        ? 'Exceso de ganancia: la sangre se aclara hacia el gris del miocardio. Baja la ganancia o ajusta TGC.'
        : 'Ganancia insuficiente: el miocardio se ve oscuro. Sube la ganancia.',
    );
  return {
    window,
    bestViewId: view.id,
    bestViewName: view.name,
    score: best.score,
    components: a.components,
    visibleLandmarks: a.visibleLandmarks ?? [],
    missingLandmarks: a.missingLandmarks ?? [],
    penaltyLandmarksPresent: a.penaltyLandmarksPresent ?? [],
    foreshorteningDeg: a.foreshorteningDeg ?? 0,
    planeAngleDeg: a.planeAngleDeg ?? 0,
    inPlaneRotationDeg: a.inPlaneRotationDeg ?? 0,
    offsetCm: a.offsetCm ?? 0,
    hints,
    perView: perView.map((p) => ({ id: p.id, score: p.score })),
    heartCoverage,
    shadowFraction,
    segments,
  };
}

function scaleV(v: Vec3, s: number): Vec3 {
  return v3(v.x * s, v.y * s, v.z * s);
}
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Pose error used for hints: plane normal angle + lateral angle + target offset (radians/cm mix). */
function poseError(
  view: ViewTarget,
  heart: HeartModel,
  thorax: ThoraxModel,
  c: ProbeControl,
): number {
  const plane = canonicalPlane(view, heart, thorax);
  const canon = canonicalBeam(view, heart, thorax);
  const beam = beamFrameFromPose(poseFromControl(thorax, c));
  const e1 = Math.acos(Math.min(1, Math.abs(dot(canon.normal, beam.normal))));
  const rightProj = normalize(
    sub(canon.lateral, scaleV(beam.normal, dot(canon.lateral, beam.normal))),
  );
  const e2 = Math.acos(Math.min(1, Math.max(-1, dot(rightProj, beam.lateral))));
  const d = sub(plane.target, beam.origin);
  const off = Math.hypot(dot(d, beam.lateral), dot(d, beam.normal));
  return e1 * 1.2 + e2 * 0.8 + off * 0.25;
}

/** Deterministic manipulation hints: try small moves, report the ones that reduce the pose error most. */
export function poseHints(
  view: ViewTarget,
  heart: HeartModel,
  thorax: ThoraxModel,
  c: ProbeControl,
  planeAngleDeg: number,
  inPlaneDeg: number,
  offsetCm: number,
): string[] {
  const hints: string[] = [];
  if (planeAngleDeg < 8 && inPlaneDeg < 10 && offsetCm < 1.2) return hints;
  const base = poseError(view, heart, thorax, c);
  const moves: {
    label: (d: number) => string;
    apply: (d: number) => ProbeControl;
    step: number;
  }[] = [
    {
      label: (d) => `Rota ${Math.abs(d)}° en sentido ${d > 0 ? 'horario' : 'antihorario'}`,
      apply: (d) => ({ ...c, rotationDeg: c.rotationDeg + d }),
      step: 10,
    },
    {
      label: (d) =>
        `Inclina (abanica) ${Math.abs(d)}° ${d > 0 ? 'hacia el marcador/arriba' : 'en sentido contrario/abajo'}`,
      apply: (d) => ({ ...c, tiltDeg: c.tiltDeg + d }),
      step: 8,
    },
    {
      label: (d) =>
        `Rockea ${Math.abs(d)}° ${d > 0 ? 'hacia el lado del marcador' : 'en contra del marcador'}`,
      apply: (d) => ({ ...c, rockDeg: c.rockDeg + d }),
      step: 8,
    },
    {
      label: (d) =>
        `Desliza ${Math.abs(d).toFixed(1)} cm ${d > 0 ? 'hacia la izquierda del paciente' : 'hacia el esternón'}`,
      apply: (d) => ({ ...c, u: c.u + d }),
      step: 1,
    },
    {
      label: (d) =>
        `Desliza ${Math.abs(d).toFixed(1)} cm ${d > 0 ? 'hacia la cabeza' : 'hacia los pies'} (otro espacio intercostal)`,
      apply: (d) => ({ ...c, v: c.v + d }),
      step: 1,
    },
  ];
  const results: { gain: number; text: string }[] = [];
  for (const m of moves) {
    for (const sgn of [1, -1]) {
      const d = sgn * m.step;
      const e = poseError(view, heart, thorax, m.apply(d));
      if (e < base - 0.01) results.push({ gain: base - e, text: m.label(d) });
    }
  }
  results.sort((a, b) => b.gain - a.gain);
  for (const r of results.slice(0, 2)) hints.push(r.text + '.');
  return hints;
}
