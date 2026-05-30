// Pure metric helpers for /consort:rehearsal. Faithful to deep-research.sh
// (extract_metric, format_metric_block, check_completion's metric.md parse,
// format_sota_block), modernized to typed TS.

/** Canonical metric vocabulary (whole-word, first-by-position wins). */
export const METRIC_VOCAB = [
  "accuracy", "auc", "cost", "f1", "latency", "loss",
  "memory", "params", "precision", "recall", "throughput",
] as const;

/** Heuristic seed: faithful to deep-research.sh extract_metric — whole-word GATE
 *  (bordered match), but position RANKED by first plain-substring occurrence on the
 *  unpadded lowercased topic; lowercased word; "" if none. */
export function extractMetric(topic: string): string {
  if (!topic) return "";
  const lowerRaw = topic.toLowerCase();
  const lowerPadded = ` ${lowerRaw} `;
  let bestPos = Infinity;
  let bestWord = "";
  for (const word of METRIC_VOCAB) {
    // Whole-word eligibility (border on both sides). NB: every vocab word is plain
    // [a-z0-9]+ with no regex metacharacters, so interpolating into RegExp is safe.
    if (!new RegExp(`[^a-z0-9]${word}[^a-z0-9]`).test(lowerPadded)) continue;
    // Position = first plain-substring occurrence (mirrors bash `${lower%%word*}`).
    const pos = lowerRaw.indexOf(word);
    if (pos < bestPos) { bestPos = pos; bestWord = word; }
  }
  return bestWord;
}
