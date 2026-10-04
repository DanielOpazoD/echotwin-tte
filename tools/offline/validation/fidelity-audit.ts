import { z } from 'zod';
import type { SimOutput } from '@/simulator/core/protocol';
import { buildCaseModels, REST_PATIENT } from '@/simulator/anatomy/caseModels';
import { computeHeartPose } from '@/simulator/anatomy/heartModel';
import { torsoToHeart } from '@/simulator/anatomy/heartFrame';
import {
  diaphragmY,
  DESC_AORTA_X,
  DESC_AORTA_Z,
  DESC_AORTA_R,
  descAortaScale,
} from '@/simulator/anatomy/thoraxModel';
import { cycleStateAt, sampleTable } from '@/simulator/cardiac-cycle/cycleModel';
import { buildFlowParams, sampleFlow } from '@/simulator/doppler/flow-primitives/flowField';
import { cross, normalize, add, scale } from '@/core/vec3';
/** Reproducible internal verification, separate from eligibility for independent clinical evaluation.
 * npm run fidelity:audit -- --out /tmp/echotwin-fidelity.json [--partition /private/patients.json]
 * Only aggregate synthetic observations leave this process; no clinical pixels or patient IDs in the report.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { CASE_INPUTS, loadCaseById } from '@/cases';
import { auditEvaluationPartition, type EvaluationPartition } from '@/clinical/evaluationPartition';
import { summarizeEvidence, type EvidenceObservation } from '@/clinical/validationEvidence';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { Structure } from '@/simulator/anatomy/tissue';
import { heartLandmarks, heartToTorso } from '@/simulator/anatomy/heartModel';
import { beamFrameFromPose, poseFromControl, controlAimingAt } from '@/simulator/probe/pose';
import { dot, sub } from '@/core/vec3';
import {
  DEFAULT_SPECTRAL,
  SPECTRAL_BINS,
  spectralRange,
} from '@/simulator/doppler/spectral/spectrum';
import { accumulatePulsedSpectrum } from '@/simulator/doppler/spectral/pulsedIq';

const arg = (key: string) => {
  const i = process.argv.indexOf(key);
  if (i < 0) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error('Missing value for ' + key);
  return value;
};
const outPath = resolve(arg('--out') ?? '/tmp/echotwin-fidelity.json');
const partitionPath = arg('--partition');
const local = relative(process.cwd(), outPath);
if (local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local))
  throw new Error('Write audit artifacts outside the checkout');
const subjectSchema = z.object({ dataset: z.string(), patientId: z.string() }).strict();
const partitionSchema = z
  .object({
    calibration: z.array(subjectSchema),
    development: z.array(subjectSchema),
    evaluation: z.array(subjectSchema),
  })
  .strict();
const rawPartition = partitionPath ? readFileSync(partitionPath, 'utf8') : null;
const parsedPartition: unknown = rawPartition
  ? JSON.parse(rawPartition)
  : { calibration: [], development: [], evaluation: [] };
const partition: EvaluationPartition = partitionSchema.parse(parsedPartition);
const external = auditEvaluationPartition(partition);
const start = performance.now(),
  observations: EvidenceObservation[] = [];
const observe = (
  id: string,
  value: number,
  unit: string,
  criterion: EvidenceObservation['criterion'],
  reference: string,
  limitation?: EvidenceObservation['limitation'],
) =>
  observations.push({
    id,
    value,
    unit,
    criterion,
    reference,
    ...(limitation ? { limitation } : {}),
  });
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .toString()
  .split('\0')
  .filter(Boolean)
  .sort();
const digest = createHash('sha256');
for (const file of new Set(files)) {
  digest.update(file + '\0');
  try {
    digest.update(readFileSync(file));
  } catch {
    digest.update('<deleted>');
  }
}
const provenance = {
  commit: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
  sourceDigest: digest.digest('hex'),
  dirty: !!execFileSync('git', ['status', '--porcelain']).toString().trim(),
  node: process.version,
};
const acquisitions: {
  scenario: string;
  phase: number;
  frameId: number;
  controls: SimOutput['acquisition'];
  beam: SimulatorCore['lastBeam'];
}[] = [];
const capture = (scenario: string, core: SimulatorCore, out: SimOutput) => {
  if (!out.acquisition || !core.lastBeam)
    throw new Error('Missing acquisition provenance: ' + scenario);
  acquisitions.push({
    scenario,
    phase: out.phase,
    frameId: out.frameId,
    controls: structuredClone(out.acquisition),
    beam: structuredClone(core.lastBeam),
  });
};
const frameTimes: number[] = [];
for (const { id } of CASE_INPUTS) {
  const c = loadCaseById(id),
    input = baseInput({ quality: 'medium' }),
    core = new SimulatorCore(c, input);
  try {
    for (const viewId of ['a4c', 'plax', 'suprasternal-arch']) {
      input.probe = canonicalControl(getViewTarget(viewId), core.models.heart, core.models.thorax);
      core.setInput(input);
      const t = performance.now(),
        out = core.step(0.1)!;
      frameTimes.push(performance.now() - t);
      capture(`${id}/${viewId}`, core, out);
      const ids = core.lastFrame!.structure;
      const tissueCount = ids.filter((s) => s !== Structure.None).length;
      observe(
        `${id}/${viewId}/nonempty`,
        tissueCount,
        'samples',
        { min: 100 },
        'Internal acquisition smoke criterion; not diagnostic image quality',
      );
      observe(
        `${id}/${viewId}/probe`,
        Math.abs(out.acquisition!.probe.u - input.probe.u) +
          Math.abs(out.acquisition!.probe.v - input.probe.v),
        'cm',
        { max: 1e-8 },
        'Acquired skin controls equal the controls sent to the actual core',
      );
      if (viewId !== 'suprasternal-arch')
        observe(
          `${id}/${viewId}/lv-cavity`,
          ids.filter((s) => s === Structure.LvCavity).length,
          'samples',
          { min: 100 },
          'Actual acquired LV cavity must be present in PLAX and A4C; internal coverage criterion',
        );
      if (viewId === 'suprasternal-arch')
        observe(
          `${id}/ssn/arch`,
          ids.filter((s) => s === Structure.AorticArch).length,
          'samples',
          { min: 100 },
          'Decision 282: physically accessible arch, partial clinical view',
        );
      core.recycle(out.rgba);
    }
  } finally {
    core.dispose();
  }
}
// Supine acquisition remains measured after closing the normal-case mediastinal occlusion (decision 294).
{
  const c = loadCaseById('normal-excellent-window'),
    input = baseInput({
      quality: 'medium',
      patient: { position: 'supine', respiration: 'expiration', headElevationDeg: 0 },
    }),
    core = new SimulatorCore(c, input);
  input.probe = canonicalControl(
    getViewTarget('suprasternal-arch'),
    core.models.heart,
    core.models.thorax,
  );
  core.setInput(input);
  capture('normal/ssn-supine', core, core.step(0.1)!);
  observe(
    'normal/ssn-supine/descending',
    core.lastFrame!.structure.filter((s) => s === Structure.DescendingAorta).length,
    'samples',
    { min: 60 },
    'BSE minimum dataset SSN descending-aorta coverage; decision 282 sampling criterion',
  );
  core.dispose();
}
// Continuous acquisition and freeze provenance from an actual manual sweep.
{
  const c = loadCaseById('normal-excellent-window'),
    input = baseInput({ quality: 'medium' }),
    core = new SimulatorCore(c, input);
  try {
    input.probe = canonicalControl(
      getViewTarget('suprasternal-arch'),
      core.models.heart,
      core.models.thorax,
    );
    core.setInput(input);
    const first = core.step(0.1)!,
      initial = core.lastFrame!.structure.filter((s) => s === Structure.AorticArch).length;
    capture('normal/ssn/sweep-start', core, first);
    const counts: number[] = [];
    const ref = { ...input.probe };
    for (const offset of [0.2, 0.4, 0.8, 1, 2, 4, 6]) {
      core.setInput({ ...input, probe: { ...ref, u: ref.u + offset } });
      const o = core.step(0.1)!;
      capture(`normal/ssn/sweep-${offset}cm`, core, o);
      counts.push(core.lastFrame!.structure.filter((s) => s === Structure.AorticArch).length);
      core.recycle(o.rgba);
    }
    observe(
      'normal/ssn/sweep-distinct',
      new Set(counts).size,
      'states',
      { min: 3 },
      'Manual continuous pose sweep, decision 282',
    );
    observe(
      'normal/ssn/sweep-residual',
      counts.at(-1)! / initial,
      'fraction',
      { max: 0.1 },
      'Off-window acquisition must lose the arch',
    );
    core.setInput({
      ...input,
      frozen: true,
      cineOffset: -999,
      probe: { ...ref, u: ref.u + 6 },
      settings: { ...input.settings, frequencyMHz: 5 },
    });
    const frozen = core.step(0)!;
    capture('normal/cine/pending-controls', core, frozen);
    observe(
      'normal/cine/frame-identity',
      Math.abs(frozen.frameId - first.frameId),
      'frames',
      { max: 0 },
      'Historical image retains acquisition identity, decision 277',
    );
    observe(
      'normal/cine/frequency',
      Math.abs(
        frozen.acquisition!.settings.frequencyMHz - first.acquisition!.settings.frequencyMHz,
      ),
      'MHz',
      { max: 0 },
      'Pending frequency cannot recalibrate frozen data',
    );
  } finally {
    core.dispose();
  }
}
// Same physical LVOT target, opened and blocked through actual skin poses. The gate is not tied to a view name.
for (const du of [0, 4]) {
  const c = loadCaseById('normal-excellent-window'),
    seed = new SimulatorCore(c, baseInput()),
    { heart, thorax } = seed.models;
  const ref = canonicalControl(getViewTarget('a5c'), heart, thorax),
    rb = beamFrameFromPose(poseFromControl(thorax, ref));
  const target = heartToTorso(heart.frame, heartLandmarks(heart).find((l) => l.id === 'lvot')!.p);
  seed.dispose();
  const probe = controlAimingAt(thorax, ref.u + du, ref.v, target, rb.lateral),
    beam = beamFrameFromPose(poseFromControl(thorax, probe)),
    d = sub(target, beam.origin);
  const input = baseInput({
    modality: 'pw',
    probe,
    gateDepthCm: Math.hypot(dot(d, beam.forward), dot(d, beam.lateral)),
    cursorThetaRad: Math.atan2(dot(d, beam.lateral), dot(d, beam.forward)),
  });
  input.settings.depthCm = 20;
  input.settings.frequencyMHz = 1.5;
  const core = new SimulatorCore(c, input);
  try {
    for (let i = 0; i < 6; i++) {
      const out = core.step(0.05);
      if (out && i === 5) capture(`normal/pw/${du ? 'blocked' : 'open'}`, core, out);
    }
    const trace = core.request({ kind: 'autoTrace', x0: 0, x1: core.spectralStrip.head - 1 });
    const vmax = trace?.kind === 'autoTrace' ? Math.max(...trace.velocitiesMps.map(Math.abs)) : NaN;
    observe(
      `normal/pw/${du ? 'blocked' : 'open'}`,
      vmax,
      'm/s',
      du ? { max: 0 } : { min: 0.5 },
      'Decision 276: same LVOT target through accessible or pulmonary-occluded ray',
    );
  } finally {
    core.dispose();
  }
}
// Analytical velocity phantoms use no physiological table as their reference.
for (const frequencyMHz of [1.5, 2.5, 5]) {
  const s = { ...DEFAULT_SPECTRAL, wallFilterMps: 0 },
    column = new Float32Array(SPECTRAL_BINS),
    { vMin, vMax } = spectralRange(s);
  let vmax = 0,
    vti = 0;
  const dt = 0.003,
    duration = 0.3,
    expectedPeak = 0.8;
  for (let n = 0; n < 100; n++) {
    const t = (n + 0.5) * dt,
      v = expectedPeak * Math.sin((Math.PI * t) / duration);
    accumulatePulsedSpectrum([{ v, weight: 1, dispersion: 0 }], s, frequencyMHz, 17, t, column);
    let bin = 0;
    for (let i = 1; i < column.length; i++) if (column[i]! > column[bin]!) bin = i;
    const measured = Math.max(0, vMax - ((bin + 0.5) * (vMax - vMin)) / column.length);
    vmax = Math.max(vmax, measured);
    vti += measured * dt;
  }
  observe(
    `iq/${frequencyMHz}/vmax-error`,
    Math.abs(vmax / expectedPeak - 1),
    'fraction',
    { max: 0.02 },
    'Analytical half-sine peak 0.8 m/s',
  );
  observe(
    `iq/${frequencyMHz}/vti-error`,
    Math.abs(vti / ((2 * expectedPeak * duration) / Math.PI) - 1),
    'fraction',
    { max: 0.02 },
    'Analytical integral 2*vmax*T/pi; independent of beat tables',
  );
}
// Independent area quadrature and outlet sampling of the reduced moving aortic network.
for (const { id } of CASE_INPUTS) {
  const c = loadCaseById(id),
    { heart, thorax, tables } = buildCaseModels(c, REST_PATIENT),
    flow = buildFlowParams(c, heart, tables, thorax);
  const dt = tables.rrS / tables.n;
  let rightBalanceMl = 0;
  for (let i = 0; i < tables.n; i++)
    rightBalanceMl +=
      (tables.tricuspidFlowMlps[i]! - tables.pulmonaryFlowMlps[i]! - tables.trFlowMlps[i]!) * dt;
  observe(
    `${id}/right-heart/nominal-balance`,
    Math.abs(rightBalanceMl),
    'mL/beat',
    { max: 0.001 },
    'Conservation of blood volume; quantified TR uses EROA × VTI (ASE/SCMR 2017); decision 293',
  );
  const pathsAt = (phase: number) => {
    const hp = computeHeartPose(heart, cycleStateAt(tables, phase)),
      g = hp.aorta.geometry,
      z = DESC_AORTA_Z + thorax.columnShiftCm;
    return {
      hp,
      paths: [
        g.arch,
        ...g.branches,
        [
          g.arch.at(-1)!,
          {
            p: torsoToHeart(heart.frame, {
              x: DESC_AORTA_X,
              y: diaphragmY(thorax, DESC_AORTA_X, z),
              z,
            }),
            radiusCm: DESC_AORTA_R * descAortaScale(thorax, hp.state.aorticPressure),
          },
        ],
      ],
    };
  };
  const volume = (phase: number) => {
    let v = 0;
    for (const [j, path] of pathsAt(phase).paths.entries())
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!,
          b = path[i]!,
          fraction = j === 0 ? 1 : 0.75,
          d = sub(b.p, a.p),
          L = Math.hypot(d.x, d.y, d.z),
          ra = a.radiusCm,
          rb = ra + (b.radiusCm - ra) * fraction,
          rm = (ra + rb) / 2;
        v += (Math.PI * L * fraction * (ra * ra + 4 * rm * rm + rb * rb)) / 6;
      }
    return v;
  };
  for (const phase of [0.12, 0.22, 0.44, 0.78]) {
    const { hp, paths } = pathsAt(phase),
      out = { vx: 0, vy: 0, vz: 0, present: 0, dispersion: 0 };
    let flux = 0;
    for (const path of paths.slice(1)) {
      const a = path[0]!,
        b = path[1]!,
        axis = normalize(sub(b.p, a.p)),
        e1 = normalize(
          cross(axis, Math.abs(axis.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }),
        ),
        e2 = cross(axis, e1),
        R = a.radiusCm + 0.75 * (b.radiusCm - a.radiusCm),
        centre = add(a.p, scale(sub(b.p, a.p), 0.75));
      for (let j = 0; j < 24; j++)
        for (let k = 0; k < 48; k++) {
          const r = R * Math.sqrt((j + 0.5) / 24),
            angle = (2 * Math.PI * (k + 0.5)) / 48,
            p = add(centre, add(scale(e1, r * Math.cos(angle)), scale(e2, r * Math.sin(angle))));
          sampleFlow(flow, tables, hp, phase, p.x, p.y, p.z, out);
          flux +=
            (dot({ x: out.vx, y: out.vy, z: out.vz }, axis) * 100 * Math.PI * R * R) / (24 * 48);
        }
    }
    const h = 0.5 / tables.n,
      storage = (volume(phase + h) - volume(phase - h)) / (2 * h * tables.rrS),
      inflow = sampleTable(tables.aorticFlowMlps, phase) - sampleTable(tables.arFlowMlps, phase);
    observe(
      `${id}/aortic-balance/${phase}`,
      Math.abs(flux + storage - inflow),
      'mL/s',
      { max: Math.max(1, 0.03 * Math.abs(inflow), 0.03 * Math.abs(storage)) },
      'Independent Simpson volume derivative + sampled outlet disk flux; 1-D continuity, DOI 10.1098/rsif.2020.0881',
    );
  }
}

const summary = summarizeEvidence(observations);
frameTimes.sort((a, b) => a - b);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  provenance,
  acquisitions,
  verification: {
    ...summary,
    scope: 'Internal synthetic verification; not independent clinical validation',
  },
  externalEvaluation: {
    ...external,
    performed: false,
    partitionDigest: rawPartition ? createHash('sha256').update(rawPartition).digest('hex') : null,
    historicalCalibration: { dataset: 'CAMUS', subjects: 500, heldOutSubjects: 0 },
  },
  performance: {
    scope: 'CPU medium acquisition, single run; not a browser FPS claim',
    frames: frameTimes.length,
    medianMs: frameTimes[Math.floor(frameTimes.length / 2)],
    p95Ms: frameTimes[Math.floor(frameTimes.length * 0.95)],
  },
  elapsedS: (performance.now() - start) / 1000,
  limitations: [
    'Idealized anatomy; no external review completed',
    'Partial SSN, especially supine',
    'Reduced aortic continuity model, no momentum/CFD',
    'Quasi-stationary PW/TDI IQ packets; CW retains histogram estimator',
    'Hardware GPU paths require a separate hardware run',
  ],
};
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.info(
  JSON.stringify({
    outPath,
    passed: summary.passed,
    counts: summary.counts,
    externalEligible: external.eligible,
    elapsedS: report.elapsedS,
  }),
);
if (!summary.passed || (partitionPath && !external.eligible)) process.exitCode = 1;

if (process.env['GITHUB_ACTIONS'] === 'true') {
  console.info(
    `::notice title=Fidelity audit::${summary.counts.pass} internal criteria pass; ${summary.counts['known-limitation']} known limitations; external evaluation not performed`,
  );
  for (const result of summary.results)
    if (result.status === 'fail' || result.status === 'resolved-limitation')
      console.info(
        `::error title=Fidelity criterion::${result.id}: ${result.value} ${result.unit}; status=${result.status}`,
      );
}
