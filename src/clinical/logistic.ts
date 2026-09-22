/**
 * Distinguishability (decision 146): can a simple classifier tell a simulated sector from a clinical one? A logistic
 * regression on the whole-sector statistics of `sectorStats.ts`, trained on CAMUS Good images against simulator images
 * and scored by the area under the ROC curve on held-out folds. Chance is 0.5; a score of 1 means every simulated image
 * is found. The standardised weights say which statistics do the telling, so the score is a diagnosis and not only a
 * verdict. Newton's method (iteratively reweighted least squares) with an L2 penalty on the weights; classes are
 * balanced by weighting each sample by the inverse of its class size. Missing features (NaN) take the training mean.
 */
export interface LogisticModel {
  /** Feature means and stds of the training set: inputs are standardised before the weights apply. */
  mean: Float64Array;
  std: Float64Array;
  /** Weights on the standardised features and the bias. */
  weights: Float64Array;
  bias: number;
}

export interface LogisticOptions {
  /** L2 penalty on the standardised weights (not the bias). */
  l2?: number;
  /** Newton iterations. */
  iterations?: number;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** Solve A·x = b for a symmetric positive definite A by Gaussian elimination with partial pivoting (A is copied). */
function solve(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const m = Float64Array.from(a);
  const x = Float64Array.from(b);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r * n + c]!) > Math.abs(m[p * n + c]!)) p = r;
    if (p !== c) {
      for (let k = 0; k < n; k++) {
        const t = m[c * n + k]!;
        m[c * n + k] = m[p * n + k]!;
        m[p * n + k] = t;
      }
      const t = x[c]!;
      x[c] = x[p]!;
      x[p] = t;
    }
    const d = m[c * n + c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = c + 1; r < n; r++) {
      const f = m[r * n + c]! / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) m[r * n + k] = m[r * n + k]! - f * m[c * n + k]!;
      x[r] = x[r]! - f * x[c]!;
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    let s = x[c]!;
    for (let k = c + 1; k < n; k++) s -= m[c * n + k]! * x[k]!;
    const d = m[c * n + c]!;
    x[c] = Math.abs(d) < 1e-12 ? 0 : s / d;
  }
  return x;
}

/** Standardise a sample with the model's means and stds; a missing feature becomes 0 (the training mean). */
function standardise(
  model: Pick<LogisticModel, 'mean' | 'std'>,
  x: ArrayLike<number>,
): Float64Array {
  const d = model.mean.length;
  const z = new Float64Array(d);
  for (let j = 0; j < d; j++) {
    const v = x[j]!;
    z[j] = Number.isFinite(v) ? (v - model.mean[j]!) / model.std[j]! : 0;
  }
  return z;
}

/** Train on rows `x` (one array of features per sample) with labels 0/1. */
export function trainLogistic(
  x: readonly ArrayLike<number>[],
  y: readonly number[],
  opts: LogisticOptions = {},
): LogisticModel {
  const l2 = opts.l2 ?? 1;
  const iterations = opts.iterations ?? 25;
  const n = x.length;
  const d = n ? x[0]!.length : 0;
  const mean = new Float64Array(d),
    std = new Float64Array(d);
  for (let j = 0; j < d; j++) {
    let s = 0,
      s2 = 0,
      c = 0;
    for (let i = 0; i < n; i++) {
      const v = x[i]![j]!;
      if (!Number.isFinite(v)) continue;
      s += v;
      s2 += v * v;
      c++;
    }
    mean[j] = c ? s / c : 0;
    const varJ = c ? s2 / c - mean[j]! * mean[j]! : 0;
    std[j] = varJ > 1e-12 ? Math.sqrt(varJ) : 1;
  }
  const z = x.map((row) => standardise({ mean, std }, row));
  // class balance: each class weighs one half
  let n1 = 0;
  for (const v of y) if (v === 1) n1++;
  const n0 = n - n1;
  const sw = y.map((v) => (v === 1 ? 0.5 / Math.max(1, n1) : 0.5 / Math.max(1, n0)) * n);
  // parameters: d weights then the bias
  const p = d + 1;
  const theta = new Float64Array(p);
  const hess = new Float64Array(p * p);
  const grad = new Float64Array(p);
  for (let it = 0; it < iterations; it++) {
    hess.fill(0);
    grad.fill(0);
    for (let i = 0; i < n; i++) {
      const zi = z[i]!;
      let dot = theta[d]!;
      for (let j = 0; j < d; j++) dot += theta[j]! * zi[j]!;
      const pr = sigmoid(dot);
      const r = sw[i]! * (pr - y[i]!);
      const wgt = sw[i]! * pr * (1 - pr);
      for (let j = 0; j <= d; j++) {
        const zj = j < d ? zi[j]! : 1;
        grad[j] = grad[j]! + r * zj;
        for (let k = 0; k <= d; k++) {
          const zk = k < d ? zi[k]! : 1;
          hess[j * p + k] = hess[j * p + k]! + wgt * zj * zk;
        }
      }
    }
    for (let j = 0; j < d; j++) {
      grad[j] = grad[j]! + l2 * theta[j]!;
      hess[j * p + j] = hess[j * p + j]! + l2;
    }
    const step = solve(hess, grad, p);
    let moved = 0;
    for (let j = 0; j < p; j++) {
      theta[j] = theta[j]! - step[j]!;
      moved = Math.max(moved, Math.abs(step[j]!));
    }
    if (moved < 1e-7) break;
  }
  return { mean, std, weights: theta.slice(0, d), bias: theta[d]! };
}

/** Probability of class 1. */
export function predictLogistic(model: LogisticModel, x: ArrayLike<number>): number {
  const z = standardise(model, x);
  let dot = model.bias;
  for (let j = 0; j < z.length; j++) dot += model.weights[j]! * z[j]!;
  return sigmoid(dot);
}

/** Area under the ROC curve of `scores` for labels 0/1 (Mann–Whitney, ties count half). */
export function auc(scores: readonly number[], labels: readonly number[]): number {
  const pos: number[] = [],
    neg: number[] = [];
  for (let i = 0; i < scores.length; i++) (labels[i] === 1 ? pos : neg).push(scores[i]!);
  if (!pos.length || !neg.length) return NaN;
  neg.sort((a, b) => a - b);
  let sum = 0;
  for (const s of pos) {
    // negatives strictly below s, plus half of those equal to it
    let lo = 0,
      hi = neg.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (neg[mid]! < s) lo = mid + 1;
      else hi = mid;
    }
    let eq = lo;
    while (eq < neg.length && neg[eq] === s) eq++;
    sum += lo + (eq - lo) / 2;
  }
  return sum / (pos.length * neg.length);
}

export interface CrossValidation {
  /** AUC over the pooled held-out predictions of every fold. */
  auc: number;
  /** AUC of each fold's held-out predictions. */
  folds: number[];
  /** Held-out probability per sample. */
  scores: number[];
}

/** Stratified k-fold cross-validation; the held-out predictions of every fold are pooled for the overall AUC. */
export function crossValidate(
  x: readonly ArrayLike<number>[],
  y: readonly number[],
  folds = 5,
  seed = 1,
  opts: LogisticOptions = {},
): CrossValidation {
  let state = seed | 0 || 1;
  const rand = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const fold = new Int32Array(x.length);
  for (const cls of [0, 1]) {
    const idx: number[] = [];
    for (let i = 0; i < y.length; i++) if (y[i] === cls) idx.push(i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    idx.forEach((i, k) => (fold[i] = k % folds));
  }
  const scores = new Array<number>(x.length).fill(NaN);
  const foldAucs: number[] = [];
  for (let f = 0; f < folds; f++) {
    const tx: ArrayLike<number>[] = [],
      ty: number[] = [];
    for (let i = 0; i < x.length; i++)
      if (fold[i] !== f) {
        tx.push(x[i]!);
        ty.push(y[i]!);
      }
    const model = trainLogistic(tx, ty, opts);
    const hs: number[] = [],
      hl: number[] = [];
    for (let i = 0; i < x.length; i++)
      if (fold[i] === f) {
        scores[i] = predictLogistic(model, x[i]!);
        hs.push(scores[i]!);
        hl.push(y[i]!);
      }
    foldAucs.push(auc(hs, hl));
  }
  return { auc: auc(scores, y), folds: foldAucs, scores };
}
