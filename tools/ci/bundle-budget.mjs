// Bundle budget: fails the build when a JavaScript asset in dist/ outgrows its limit. Plain Node so it
// runs after `vite build` without tsx. Budgets are ~15 % above the sizes measured on 2026-09-16 (entry
// 703 kB, three 528 kB, workers 255/177 kB) after the navigator, the secondary screens and the backend
// comparison moved to lazy chunks (engineering audit, B4); raise a budget only on purpose, in the same
// change that explains the growth.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'dist', 'assets');
const KB = 1024;
/** [pattern, max bytes]; every JS asset must match one pattern. */
const BUDGETS = [
  // entry: the imaging app without three.js, the secondary screens, the backend-comparison hook and — since the
  // navigator model comes from the mesh worker and the inline core loads on demand (audit B7) — without the
  // anatomy engine: 499 kB measured on 2026-09-16, down from 703 kB. It had grown to 574.9 kB by decision 244, of which
  // ~205 kB were React's DOM renderer: the react chunk named `react-dom` but not `react-dom/client`, the module the app
  // imports, nor its scheduler (decision 245). 369 kB since then, 396.7 kB by decision 339. Decision 340 (review mode's
  // identification, echo sources and pencil: the region code, the overlay layers and the report lines) took it to
  // 406.1 kB; raised to 410 kB.
  [/^index-.*\.js$/, 410 * KB],
  [/^three-.*\.js$/, 600 * KB], // three.js, loaded with the navigator
  [/^react-.*\.js$/, 230 * KB], // React and its DOM renderer: 216 kB at decision 245
  [/^TorsoView-.*\.js$/, 60 * KB],
  // Shared vascular network and PW/TDI IQ/FFT (decisions 283–284): 330.2 kB.
  // The total budget stays unchanged; the earlier mesh-worker deduplication saved ~115 kB.
  // Decisions 291–293: atrial/septal normalization and right-heart flow ledger; 335.2 kB.
  // Decisions 297–298: the time course of the mitral orifice and its velocity table, and the stenotic ejection shape;
  // 336.0 kB. Raised to 340 kB, 1.2 % over: the worker, the mesh worker and the WebGL2 chunk each bundle the anatomy and
  // the cycle, so deduplicating them is what would give the room back (engineering review of 2026-10-12).
  // Decision 303: the shaders lose the spaces between tokens at build time, 340.1 → 329.6 kB (the WebGL2 chunk too).
  // Decisions 304-323: the anatomy audit (septal corner and fossa, venous mouths, coronary sinus, the right atrial
  // appendage) and its per-pose cache took it back to 340.1 kB; raised to 350 kB, the room the shader compaction gave.
  // Decisions 324-335 (the census of decision 331, the supraventricular crest, the septum resting on the root): 350.4 kB;
  // raised to 355 kB, the total budget unchanged. Decision 351's image formation option (the looks and the scatterer
  // branch of the tracer, whose code the engines bring) took it to 355.3 kB: raised to 360 kB, the total unchanged.
  // Decision 360 (the four-chamber preset turned about the LV's axis to the Rodero heart's crux) took it to 360.0 kB:
  // raised to 365 kB, the total unchanged.
  [/^sim\.worker-.*\.js$/, 365 * KB],
  // the WebGL2 port and its shaders: shared by the simulation worker and the lazy backend comparison. 119.7 kB at
  // decision 151; the LV segment code in GLSL and its read-back (decision 152) took it to 121.0 kB; the mirrors of the
  // right atrium beside the root and the membranous septum, the open venae cavae, the septal tricuspid hinge and the
  // pleura whose incidence comes from the neighbouring lines (decisions 218-222) to 128.1 kB, 127.3 kB once the comments
  // those shaders carried in the bundle were cut to their decision numbers; 132.0 kB at decision 227, and 114.8 kB since
  // the build strips the shaders' comments and indentation (decision 228), which leaves the budget 15 % above it
  // Since the test hook left production builds, the backend comparison no longer shares the port, and Rollup folds the
  // lazy core (simulatorCore, 80.5 kB) into this chunk: 204.1 kB, budgeted as the sum of the two former budgets (the
  // E2E build still splits them, and is not budgeted). Decision 354 (pass A's scatterer variant, the looks as a uniform,
  // the core's switch of image formation) took it to 214.5 kB: raised by 2 kB
  [/^webgl2Renderer-.*\.js$/, (132 + 82 + 2) * KB],
  [/^heartMesh\.worker-.*\.js$/, 220 * KB],
  [/^(ReportScreen|CurriculumScreen|ProgressScreen|ReferencesScreen)-.*\.js$/, 80 * KB],
  // Decision 287: bounded beat history and timestamp context add 1.2 kB to the lazy core (80.5 kB).
  [/^simulatorCore-.*\.js$/, 82 * KB],
  [/\.js$/, 80 * KB], // any other chunk Rollup splits out
];
// 1992 kB at decision 270; decisions 271-273 (the gastric fundus, the aortic pulse, the heart against the posterior
// column) added 9.4 kB, most of it twice or three times over: the anatomy and the cycle are bundled in the simulation
// worker, the mesh worker and the WebGL2 port alike. Decision 352 adds the experimental anatomy's volume heart as a chunk
// fetched only when it is chosen (15 kB, once for the worker and once for the core that runs without one): 2063.2 kB,
// raised to 2100 kB. Decision 354 adds the experimental image formation the same way (8 kB, twice): 2110.1 kB, raised to
// 2120 kB. Decision 364 (the interatrial septum, the atria on the aortic root and the left atrioventricular junction
// built when the volume heart is bound) adds 2.7 kB to that chunk, twice: 2123.0 kB, raised to 2130 kB.
const TOTAL_JS_BUDGET = 2130 * KB;

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
// The test hook hands out the stores and the case's ground truth (src/main.tsx): only the dev server and the E2E build
// (`npm run build:e2e`) may carry it. A production build that contains it lets a learner read the blind exam's answers.
const hooked = files.filter((f) => readFileSync(join(DIST, f), 'utf8').includes('__echotwin'));
if (hooked.length) {
  console.error(
    `bundle-budget: the test hook window.__echotwin is in ${hooked.join(', ')}; build with \`npm run build\`, not build:e2e`,
  );
  failed = true;
}
if (failed) {
  console.error('bundle-budget: over budget (tools/ci/bundle-budget.mjs)');
  process.exit(1);
}
