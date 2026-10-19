/**
 * The blinded visual Turing test of the realism bench (decision 343): short clips of the simulator and of clinical
 * studies, the same number of each per view, in random order under opaque numbers, with the key kept apart; a reader
 * says of each clip whether it is real or simulated, how sure (1–3) and what gave it away. It extends the still-frame
 * blind test of decision 146 (`blindTest.ts`) to clips, views and confidence.
 *
 * Scoring: the accuracy with its binomial tail against chance (p = ½), and the area under the ROC curve of the six-step
 * rating "how simulated does it look" (real-sure … sim-sure), the observer-study figure that uses the confidence
 * (Metz 1978; Mann–Whitney estimate, ties count half). 0.5 is a simulator the reader cannot tell apart.
 */
import { gradeAnswers } from '../blindTest';

export type Source = 'real' | 'sim';

/** What a reader can tick as the giveaway (the page shows them in Spanish). */
export const GIVEAWAYS = [
  'textura',
  'movimiento',
  'anatomia',
  'bordes',
  'ruido',
  'artefactos',
  'brillo',
  'formato',
] as const;
export type Giveaway = (typeof GIVEAWAYS)[number];

export interface ClipItem {
  source: Source;
  /** View id (plax, psax-mv, a4c, a2c). */
  view: string;
  /** Path of the clip relative to the session folder. */
  file: string;
  /** What it is, kept only in the key: dataset and patient, or case, phase and seed. */
  what: string;
}

export interface Trial {
  /** Presentation order: number shown to the reader, clip file and view. */
  clips: { n: number; file: string; view: string }[];
  key: { n: number; real: boolean; view: string; what: string }[];
  /** Views left out because one side had no clip, and how many of each were offered. */
  skipped: { view: string; real: number; sim: number }[];
}

/** mulberry32: a small seeded generator, the same sequence on every platform. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * A sitting: for each view, the same number of real and simulated clips (at most `perView` of each, drawn at random), so
 * neither the view nor the share of each source tells the answer; a view with no clip on one side is left out and
 * reported. All the clips of the sitting are shuffled together.
 */
export function buildTrial(items: readonly ClipItem[], perView: number, seed: number): Trial {
  const rand = seededRandom(seed);
  const views = [...new Set(items.map((i) => i.view))].sort();
  const chosen: ClipItem[] = [];
  const skipped: Trial['skipped'] = [];
  for (const v of views) {
    const real = shuffle(
      items.filter((i) => i.view === v && i.source === 'real'),
      rand,
    );
    const sim = shuffle(
      items.filter((i) => i.view === v && i.source === 'sim'),
      rand,
    );
    const k = Math.min(perView, real.length, sim.length);
    if (k === 0) {
      skipped.push({ view: v, real: real.length, sim: sim.length });
      continue;
    }
    chosen.push(...real.slice(0, k), ...sim.slice(0, k));
  }
  const order = shuffle(chosen, rand);
  return {
    clips: order.map((c, i) => ({ n: i + 1, file: c.file, view: c.view })),
    key: order.map((c, i) => ({ n: i + 1, real: c.source === 'real', view: c.view, what: c.what })),
    skipped,
  };
}

export interface Answer {
  n: number;
  call: Source;
  /** 1 = guessing, 2 = fairly sure, 3 = sure. */
  confidence: 1 | 2 | 3;
  giveaways: Giveaway[];
  note?: string;
  /** Time the reader took on the clip (ms). */
  ms?: number;
}

export interface AnswerSheet {
  reader: string;
  /** Whether the reader reads echocardiograms (the result that counts, decision 146). */
  echoReader: boolean;
  startedAt: string;
  seed: number;
  answers: Answer[];
}

/** Six-step rating of how simulated the reader found a clip: real-sure 1 … sim-sure 6. */
export function simRating(a: Pick<Answer, 'call' | 'confidence'>): number {
  return a.call === 'sim' ? 3 + a.confidence : 4 - a.confidence;
}

/** Mann–Whitney AUC of ratings that should be higher for the positives: P(pos > neg) + ½ P(tie). */
export function aucFromRatings(pos: readonly number[], neg: readonly number[]): number {
  if (!pos.length || !neg.length) return NaN;
  let s = 0;
  for (const p of pos) for (const q of neg) s += p > q ? 1 : p === q ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

export interface TuringScore {
  clips: number;
  answered: number;
  correct: number;
  accuracy: number;
  /** P(X ≥ correct), X ~ Binomial(answered, ½). */
  pChance: number;
  /** Simulated clips the reader called simulated, over the simulated clips answered. */
  simDetected: number;
  /** Real clips called real, over the real clips answered. */
  realAccepted: number;
  auc: number;
  byView: Record<string, { answered: number; correct: number; accuracy: number }>;
  /** Giveaways ticked on simulated clips that were called simulated, most frequent first. */
  giveaways: { giveaway: string; count: number }[];
  meanConfidence: number;
}

/** Scores an answer sheet against the key of its sitting. */
export function gradeTuring(key: Trial['key'], sheet: Pick<AnswerSheet, 'answers'>): TuringScore {
  const byN = new Map(sheet.answers.map((a) => [a.n, a]));
  const base = gradeAnswers(
    key.map((k) => ({ tile: k.n, real: k.real })),
    Object.fromEntries(sheet.answers.map((a) => [String(a.n), a.call])),
  );
  const pos: number[] = [],
    neg: number[] = [];
  let simAns = 0,
    simHit = 0,
    realAns = 0,
    realHit = 0,
    conf = 0;
  const byView: TuringScore['byView'] = {};
  const counts = new Map<string, number>();
  for (const k of key) {
    const a = byN.get(k.n);
    if (!a || (a.call !== 'real' && a.call !== 'sim')) continue;
    const ok = (a.call === 'real') === k.real;
    const v = (byView[k.view] ??= { answered: 0, correct: 0, accuracy: NaN });
    v.answered++;
    if (ok) v.correct++;
    conf += a.confidence;
    if (k.real) {
      neg.push(simRating(a));
      realAns++;
      if (ok) realHit++;
    } else {
      pos.push(simRating(a));
      simAns++;
      if (ok) {
        simHit++;
        for (const g of a.giveaways) counts.set(g, (counts.get(g) ?? 0) + 1);
      }
    }
  }
  for (const v of Object.values(byView)) v.accuracy = v.correct / v.answered;
  return {
    clips: key.length,
    answered: base.answered,
    correct: base.correct,
    accuracy: base.accuracy,
    pChance: base.pChance,
    simDetected: simAns ? simHit / simAns : NaN,
    realAccepted: realAns ? realHit / realAns : NaN,
    auc: aucFromRatings(pos, neg),
    byView,
    giveaways: [...counts.entries()]
      .map(([giveaway, count]) => ({ giveaway, count }))
      .sort((a, b) => b.count - a.count || a.giveaway.localeCompare(b.giveaway)),
    meanConfidence: base.answered ? conf / base.answered : NaN,
  };
}
