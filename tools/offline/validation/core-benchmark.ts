/** Fixed-input CPU interaction benchmark. Run on a quiet machine and compare identical settings.
 * M-mode uses a wall-clock-dependent trace budget: its production hashes may vary on unchanged code.
 * Timings are wall-clock observations, never clinical accuracy or full GPU throughput.
 * Hashes omit timing statistics and cover displayed pixels, structures, spectra and strip calibration.
 * ECHOTWIN_BENCH_CASE / ECHOTWIN_BENCH_MODES / ECHOTWIN_BENCH_STILL optionally narrow the matrix.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadCaseById } from '@/cases';
import { SimulatorCore } from '@/simulator/core/simulatorCore';
import { baseInput } from '@/simulator/core/baseInput';
import type { SimInput } from '@/simulator/core/protocol';
import { canonicalControl, getViewTarget } from '@/simulator/windows/viewTargets';
import { heartToTorso, classifyHeart, computeHeartPose } from '@/simulator/anatomy/heartModel';
import { beamFrameFromPose, poseFromControl } from '@/simulator/probe/pose';
import { dot, sub } from '@/core/vec3';
import { cycleStateAt } from '@/simulator/cardiac-cycle/cycleModel';
import { Tissue, makeSample } from '@/simulator/anatomy/tissue';
const sourceHash = createHash('sha256');
const sourceFiles = execFileSync('git', [
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
  '--',
  'src',
])
  .toString()
  .split('\0')
  .filter(Boolean);
for (const file of [...new Set(sourceFiles)].sort())
  sourceHash.update(file + '\0').update(readFileSync(file));
const source = {
  commit: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
  dirty: execFileSync('git', ['status', '--porcelain']).length > 0,
  srcSha256: sourceHash.digest('hex'),
};
const rows = [];
for (const caseId of ['normal-excellent-window', 'pulmonary-hypertension-rv'])
  for (const modality of ['2d', 'color', 'pw', 'cw', 'tdi', 'm-mode'] as SimInput['modality'][])
    for (const moving of [false, true]) {
      if (process.env.ECHOTWIN_BENCH_CASE && caseId !== process.env.ECHOTWIN_BENCH_CASE) continue;
      if (
        process.env.ECHOTWIN_BENCH_MODES &&
        !process.env.ECHOTWIN_BENCH_MODES.split(',').includes(modality)
      )
        continue;
      if (process.env.ECHOTWIN_BENCH_STILL && moving) continue;
      const c = loadCaseById(caseId),
        input = baseInput({
          modality,
          quality: 'low',
          rendererBackend: 'procedural',
          display: { width: 1024, height: 260 },
        }),
        t0 = performance.now(),
        core = new SimulatorCore(c, input),
        coldMs = performance.now() - t0;
      const { heart, thorax } = core.models,
        probe = canonicalControl(getViewTarget('a4c'), heart, thorax);
      input.probe = { ...probe };
      let point = { x: 0.2, y: -0.9, z: 1.7 };
      if (modality === 'tdi') {
        const hp = computeHeartPose(heart, cycleStateAt(core.models.tables, 0)),
          sample = makeSample();
        let first = NaN,
          last = NaN;
        for (let x = -0.5; x > -5; x -= 0.05) {
          if (classifyHeart(heart, hp, x, 0, 1, sample) && sample.tissue === Tissue.Myocardium) {
            if (Number.isNaN(first)) first = x;
            last = x;
          } else if (!Number.isNaN(first)) break;
        }
        if (!Number.isFinite(first + last)) throw new Error('No septal tissue gate');
        point = { x: (first + last) / 2, y: 0, z: 1 };
      }
      const target = heartToTorso(heart.frame, point),
        beam = beamFrameFromPose(poseFromControl(thorax, probe)),
        d = sub(target, beam.origin);
      input.gateDepthCm = Math.hypot(dot(d, beam.forward), dot(d, beam.lateral));
      input.cursorThetaRad = Math.atan2(dot(d, beam.lateral), dot(d, beam.forward));
      core.setInput(input);
      for (let i = 0; i < 40; i++) {
        const out = core.step(0.05);
        if (out) core.recycle(out.rgba);
      }
      const hash = createHash('sha256'),
        times = [];
      let outputs = 0,
        signalPeak = 0;
      const start = performance.now();
      for (let i = 0; i < 40; i++) {
        if (moving) {
          input.probe = { ...probe, tiltDeg: probe.tiltDeg + Math.sin(i * 0.25) * 3 };
          core.setInput(input);
        }
        const st = performance.now(),
          out = core.step(0.05);
        times.push(performance.now() - st);
        if (out) {
          outputs++;
          if (out.spectrumColumn) signalPeak = Math.max(signalPeak, ...out.spectrumColumn);
          hash.update(new Uint8Array(out.rgba));
          hash.update(out.structure);
          if (out.spectrumColumn) hash.update(new Uint8Array(out.spectrumColumn.buffer));
          hash.update(JSON.stringify([out.timeS, out.phase, out.strip]));
          core.recycle(out.rgba);
        }
      }
      const elapsedMs = performance.now() - start;
      times.sort((a, b) => a - b);
      const row = {
        caseId,
        modality,
        moving,
        signalPeak,
        coldMs,
        elapsedMs,
        simulatedSeconds: 2,
        outputs,
        stepMedianMs: (times[19]! + times[20]!) / 2,
        stepP95Ms: times[37],
        hash: hash.digest('hex'),
      };
      rows.push(row);
      console.info(JSON.stringify(row));
      core.dispose();
    }
if (rows.length === 0) throw new Error('No benchmark conditions match the requested filters');
writeFileSync(
  process.argv[2] ?? '/tmp/echotwin-core-benchmark.json',
  JSON.stringify(
    {
      source,
      node: process.version,
      scope:
        'CPU; low quality; 1024px; 2s warmup and 2s acquisition; single run per condition; elapsed includes hash verification, step timers only core.step',
      rows,
    },
    null,
    2,
  ),
);
