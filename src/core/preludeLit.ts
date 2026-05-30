// src/core/preludeLit.ts — literature-track classifier (port of the meditate.sh classify-topic
// helper + keyword list). Whole-word case-insensitive match → ON/OFF.

/** The 24 academic/SOTA keywords (ported verbatim, order preserved). */
export const LIT_KEYWORDS: string[] = [
  "loss", "embedding", "network", "model", "architecture", "training", "optimizer", "scheduler",
  "transformer", "mamba", "attention", "regularization", "augmentation", "fine-tune", "sota",
  "state-of-the-art", "benchmark", "paper", "arxiv", "algorithm", "inference", "quantization",
  "distillation", "pruning",
];

/** Escape a keyword for use inside a RegExp (the hyphenated ones contain `-`, which is literal
 *  outside a character class, but escape defensively). */
function esc(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** ON iff any keyword appears as a whole word (bordered by non-alphanumeric or string edge),
 *  case-insensitive. Faithful to the bash whole-word test (space-padding makes start/end count
 *  as borders). Empty topic → OFF. */
export function classifyTopic(topic: string): "ON" | "OFF" {
  const t = (topic ?? "").trim();
  if (!t) return "OFF";
  const padded = ` ${t.toLowerCase()} `;
  for (const kw of LIT_KEYWORDS) {
    if (new RegExp(`[^a-z0-9]${esc(kw)}[^a-z0-9]`).test(padded)) return "ON";
  }
  return "OFF";
}
