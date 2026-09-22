/**
 * Scoring of the blind test (decision 146): a rater's answers against the key of a sitting. The key lists each tile's
 * number and whether it is a clinical image; the answers map tile numbers to 'real' or 'sim'. Besides the accuracy the
 * score gives the probability of at least that many correct answers by chance (binomial with p = ½), so a sitting of
 * 24 tiles at 17 correct reads p ≈ 0.03 and one at 13 correct reads p ≈ 0.42: the simulator is told apart only when
 * the first kind of result repeats.
 */
export interface BlindTestScore {
  tiles: number;
  answered: number;
  correct: number;
  accuracy: number;
  realCalledSim: number;
  simCalledReal: number;
  /** P(X ≥ correct) for X ~ Binomial(answered, ½). */
  pChance: number;
}

/** Score answers ({ "1": "real", "2": "sim", … } by tile number) against the key. */
export function gradeAnswers(
  key: readonly { tile: number; real: boolean }[],
  answers: Readonly<Record<string, 'real' | 'sim'>>,
): BlindTestScore {
  let answered = 0,
    correct = 0,
    realCalledSim = 0,
    simCalledReal = 0;
  for (const k of key) {
    const a = answers[String(k.tile)];
    if (a !== 'real' && a !== 'sim') continue;
    answered++;
    const saidReal = a === 'real';
    if (saidReal === k.real) correct++;
    else if (k.real) realCalledSim++;
    else simCalledReal++;
  }
  // P(X ≥ correct) for X ~ Binomial(answered, ½)
  let p = 0;
  for (let x = correct; x <= answered; x++) {
    let c = 1;
    for (let i = 1; i <= x; i++) c = (c * (answered - x + i)) / i;
    p += c * Math.pow(0.5, answered);
  }
  return {
    tiles: key.length,
    answered,
    correct,
    accuracy: answered ? correct / answered : NaN,
    realCalledSim,
    simCalledReal,
    pChance: answered ? Math.min(1, p) : NaN,
  };
}
