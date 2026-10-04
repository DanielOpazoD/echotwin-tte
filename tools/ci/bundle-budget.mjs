// Bundle budget: fails the build when a JavaScript asset in dist/ outgrows its limit. Plain Node so it
// runs after `vite build` without tsx. Budgets are ~15 % above the sizes measured on 2026-09-16 (entry
// 703 kB, three 528 kB, workers 255/177 kB) after the navigator, the secondary screens and the backend
// comparison moved to lazy chunks (engineering audit, B4); raise a budget only on purpose, in the same
// change that explains the growth.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist', 'assets');
const KB = 1024;
/** [pattern, max bytes]; every JS asset must match one pattern. */
const BUDGETS = [
  // entry: the imaging app without three.js, the secondary screens, the backend-comparison hook and — since the
  // navigator model comes from the mesh worker and the inline core loads on demand (audit B7) — without the
  // anatomy engine: 499 kB measured on 2026-09-16, down from 703 kB. It had grown to 574.9 kB by decision 244, of which
  // ~205 kB were React's DOM renderer: the react chunk named `react-dom` but not `react-dom/client`, the module the app
  // imports, nor its scheduler (decision 245). 369 kB since then.
  [/^index-.*\.js$/, 400 * KB],
  [/^three-.*\.js$/, 600 * KB], // three.js, loaded with the navigator
  [/^react-.*\.js$/, 230 * KB], // React and its DOM renderer: 216 kB at decision 245
  [/^TorsoView-.*\.js$/, 60 * KB],
  // Shared vascular network and PW/TDI IQ/FFT (decisions 283–284): 330.2 kB.
  // The total budget stays unchanged; the earlier mesh-worker deduplication saved ~115 kB.
  // Decision 291: AP/volume normalization and shared ray angles add 1.7 kB (333.4 kB).
  [/^sim\.worker-.*\.js$/, 334 * KB],
  // the WebGL2 port and its shaders: shared by the simulation worker and the lazy backend comparison. 119.7 kB at
  // decision 151; the LV segment code in GLSL and its read-back (decision 152) took it to 121.0 kB; the mirrors of the
  // right atrium beside the root and the membranous septum, the open venae cavae, the septal tricuspid hinge and the
  // pleura whose incidence comes from the neighbouring lines (decisions 218-222) to 128.1 kB, 127.3 kB once the comments
  // those shaders carried in the bundle were cut to their decision numbers; 132.0 kB at decision 227, and 114.8 kB since
  // the build strips the shaders' comments and indentation (decision 228), which leaves the budget 15 % above it
  [/^webgl2Renderer-.*\.js$/, 132 * KB],
  [/^heartMesh\.worker-.*\.js$/, 220 * KB],
  [/^(ReportScreen|CurriculumScreen|ProgressScreen|ReferencesScreen)-.*\.js$/, 80 * KB],
  // Decision 287: bounded beat history and timestamp context add 1.2 kB to the lazy core (80.5 kB).
  [/^simulatorCore-.*\.js$/, 82 * KB],
  [/\.js$/, 80 * KB], // any other chunk Rollup splits out
];
// 1992 kB at decision 270; decisions 271-273 (the gastric fundus, the aortic pulse, the heart against the posterior
// column) added 9.4 kB, most of it twice or three times over: the anatomy and the cycle are bundled in the simulation
// worker, the mesh worker and the WebGL2 port alike
const TOTAL_JS_BUDGET = 2060 * KB;

let files;
try {
  files = readdirSync(DIST).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`bundle-budget: ${DIST} not found; run vite build first`);
  process.exit(1);
}
let total = 0;
let failed = false;
for (const f of files.sort()) {
  const size = statSync(join(DIST, f)).size;
  total += size;
  const budget = BUDGETS.find(([re]) => re.test(f))?.[1] ?? 0;
  const over = size > budget;
  failed ||= over;
  console.log(
    `${over ? 'OVER ' : 'ok   '} ${f.padEnd(34)} ${(size / KB).toFixed(1).padStart(7)} kB / ${(budget / KB).toFixed(0)} kB`,
  );
}
console.log(
  `      total JS ${(total / KB).toFixed(1)} kB / ${(TOTAL_JS_BUDGET / KB).toFixed(0)} kB`,
);
if (total > TOTAL_JS_BUDGET) failed = true;
if (failed) {
  console.error('bundle-budget: over budget (tools/ci/bundle-budget.mjs)');
  process.exit(1);
}
