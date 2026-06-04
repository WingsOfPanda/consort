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

/** Render metric.md from K=V fields. Required: primary_metric, direction(maximize|minimize).
 *  Defaults: min_acceptable=(not set), K_corroboration=1, plateau_window=5, plateau_threshold=0.01.
 *  Throws on missing required keys / bad direction. Byte-faithful to format_metric_block. */
export function formatMetricBlock(fields: Record<string, string>): string {
  const primary = fields.primary_metric ?? "";
  const direction = fields.direction ?? "";
  if (!primary) throw new Error("missing required key: primary_metric");
  if (!direction) throw new Error("missing required key: direction");
  if (direction !== "maximize" && direction !== "minimize") {
    throw new Error(`direction must be 'maximize' or 'minimize'; got '${direction}'`);
  }
  const min = fields.min_acceptable || "(not set)";
  const K = fields.K_corroboration || "1";
  const pw = fields.plateau_window || "5";
  const pt = fields.plateau_threshold || "0.01";

  const lines = ["# Research goal", ""];
  lines.push(`**Primary metric:** ${primary}`);
  lines.push(`**Direction:** ${direction}`);
  lines.push(`**min_acceptable:** ${min}`);
  if (fields.target) lines.push(`**target:** ${fields.target}`);
  lines.push(`**K_corroboration:** ${K}`);
  lines.push(`**plateau_window:** ${pw}`);
  lines.push(`**plateau_threshold:** ${pt}`);
  if (fields.acceptable) lines.push(`**acceptable (legacy):** ${fields.acceptable}`);
  if (fields.hard_constraints) lines.push(`**Hard constraints:** ${fields.hard_constraints}`);
  let out = lines.join("\n") + "\n";
  if (fields.notes) out += `\n**Notes:** ${fields.notes}\n`;
  return out;
}

export interface MetricThresholds {
  primaryMetric: string;
  /** maximize|minimize from metric.md `**Direction:**`; undefined when absent (treated as maximize). */
  direction?: "maximize" | "minimize";
  /** optional metric.md `**verify_epsilon:**` for A1 verify-by-re-execution; default 0.01 in callers. */
  verifyEpsilon?: number;
  /** optional metric.md `**ceiling:**` (plausible bound) for A3 too-good-to-be-true; skip if absent. */
  ceiling?: number;
  /** optional metric.md `**min_runtime_s:**` for A3 under-run; caller defaults to 1.0 if absent. */
  minRuntimeS?: number;
  /** optional metric.md `**max_debug_attempts:**` for A2 bounded re-dispatch; caller defaults to 2. */
  maxDebugAttempts?: number;
  /** optional metric.md `**min_families:**` for B1 coverage floor; parsed with default 2 (>= 1). */
  minFamilies: number;
  minOp?: string; minVal?: string;
  tgtOp?: string; tgtVal?: string;
  kRequired: number; plateauWindow: number; plateauThreshold: number;
}

/** Parse the thresholds out of a rendered metric.md. `**min_acceptable:** >= 0.95` -> op ">=", val "0.95".
 *  Unparseable / "(not set)" values leave op/val as-is (a later numeric compare against them simply fails). */
export function parseMetricMd(text: string): MetricThresholds {
  let primaryMetric = "";
  let direction: "maximize" | "minimize" | undefined;
  let minOp: string | undefined, minVal: string | undefined;
  let tgtOp: string | undefined, tgtVal: string | undefined;
  let kRequired = 1, plateauWindow = 5, plateauThreshold = 0.01;
  let verifyEpsilon: number | undefined;
  let ceiling: number | undefined; let minRuntimeS: number | undefined;
  let maxDebugAttempts: number | undefined;
  let minFamilies = 2;
  const opVal = (s: string): [string, string] => {
    const parts = s.trim().split(/\s+/);
    return [parts[0] ?? "", parts.slice(1).join(" ")];
  };
  for (const line of text.split("\n")) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\*\*Primary metric:\*\*\s+(.*)$/))) { primaryMetric = m[1].trim(); }
    else if ((m = line.match(/^\*\*Direction:\*\*\s+(.*)$/))) { const d = m[1].trim(); if (d === "maximize" || d === "minimize") direction = d; }
    else if ((m = line.match(/^\*\*min_acceptable:\*\*\s+(.*)$/))) { [minOp, minVal] = opVal(m[1]); }
    else if ((m = line.match(/^\*\*target:\*\*\s+(.*)$/))) { [tgtOp, tgtVal] = opVal(m[1]); }
    else if ((m = line.match(/^\*\*K_corroboration:\*\*\s+(.*)$/))) { kRequired = parseInt(m[1].trim(), 10) || 1; }
    else if ((m = line.match(/^\*\*plateau_window:\*\*\s+(.*)$/))) { plateauWindow = parseInt(m[1].trim(), 10) || 5; }
    else if ((m = line.match(/^\*\*plateau_threshold:\*\*\s+(.*)$/))) { plateauThreshold = parseFloat(m[1].trim()) || 0.01; }
    else if ((m = line.match(/^\*\*verify_epsilon:\*\*\s+(.*)$/))) { const n = parseFloat(m[1].trim()); if (!Number.isNaN(n)) verifyEpsilon = n; }
    else if ((m = line.match(/^\*\*ceiling:\*\*\s+(.*)$/))) { const n = parseFloat(m[1].trim()); if (!Number.isNaN(n)) ceiling = n; }
    else if ((m = line.match(/^\*\*min_runtime_s:\*\*\s+(.*)$/))) { const n = parseFloat(m[1].trim()); if (!Number.isNaN(n)) minRuntimeS = n; }
    else if ((m = line.match(/^\*\*max_debug_attempts:\*\*\s+(.*)$/))) { const n = parseInt(m[1].trim(), 10); if (!Number.isNaN(n)) maxDebugAttempts = n; }
    else if ((m = line.match(/^\*\*min_families:\*\*\s+(.*)$/))) { const n = parseInt(m[1].trim(), 10); if (!Number.isNaN(n)) minFamilies = Math.max(1, n); }
  }
  return { primaryMetric, direction, minOp, minVal, tgtOp, tgtVal, kRequired, plateauWindow, plateauThreshold, verifyEpsilon, ceiling, minRuntimeS, maxDebugAttempts, minFamilies };
}

export interface SotaInput {
  topic: string; metric: string; sweep_date: string; queries?: string;
  /** Each ref is "family|best|compliance|source|notes". Capped at 7. */
  refs: string[];
}

/** Render the SOTA reference block. Faithful to format_sota_block. */
export function formatSotaBlock(input: SotaInput): string {
  if (!input.topic) throw new Error("missing required key: topic");
  if (!input.metric) throw new Error("missing required key: metric");
  if (!input.sweep_date) throw new Error("missing required key: sweep_date");

  const lines: string[] = [];
  lines.push(`# SOTA reference — ${input.topic}`, "");
  lines.push(`> **Sweep date:** ${input.sweep_date}`);
  lines.push(`> **Optimizing for:** ${input.metric}`);
  if (input.queries) lines.push(`> **Queries fired:** ${input.queries}`);
  lines.push("");
  lines.push("| Approach family | Best known | Constraint compliance | Source | Notes |");
  lines.push("|---|---|---|---|---|");

  let rendered = 0;
  for (const row of input.refs.slice(0, 7)) {
    if (!row) continue;
    const [family = "", best = "", compliance = "", source = "", ...rest] = row.split("|");
    const notes = rest.join("|");
    lines.push(`| ${family} | ${best} | ${compliance} | ${source} | ${notes} |`);
    rendered++;
  }
  let out = lines.join("\n") + "\n";
  if (rendered === 0) {
    out += "\n_Note: sweep returned no usable references; part-side web search remains available._\n";
  }
  return out;
}
