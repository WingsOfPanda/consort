// Completion + time-budget math for /consort:rehearsal. Faithful to
// deep-research.sh (check_completion, check_time_budget). Pure functions.

import { parseMetricMd } from "./rehearsalMetric.js";
import { normalizeFamily } from "./rehearsalCoverage.js";

export interface CompletionSignals {
  floorMet: boolean;
  targetMet: boolean;
  kSoFar: number;
  kRequired: number;
  plateau: boolean;
  /** B1 derived coverage signals (checkCompletion always sets them; optional for back-compat literals). */
  familiesActive?: number;
  familiesImproving?: number;
  minFamilies?: number;
}

const NUM = /^[0-9.]+$/;

function cmp(a: string, op: string | undefined, b: string | undefined): boolean {
  if (!op || b === undefined) return false;
  const x = parseFloat(a), y = parseFloat(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  switch (op) {
    case ">=": return x >= y;
    case "<=": return x <= y;
    case ">": return x > y;
    case "<": return x < y;
    case "==": return x === y;
    default: return false;
  }
}

interface SbRow { exp: string; instrument: string; metric: string; status: string; metricName: string; approach: string; }

/** Parse plain-rank data rows (| <int> | exp-… |). Excludes header/sep and ~-prefixed partial rows. */
function parseRows(scoreboardMd: string): SbRow[] {
  const out: SbRow[] = [];
  for (const line of scoreboardMd.split("\n")) {
    if (!/^\|\s+\d+\s+\|\s+exp-/.test(line)) continue;
    const c = line.split("|").map((s) => s.trim());
    // c[0]="" c[1]=rank c[2]=exp c[3]=instrument c[4]=metric c[5]=status c[6]=runtime c[7]=approach c[8]=metric_name
    out.push({ exp: c[2], instrument: c[3], metric: c[4], status: c[5], metricName: c[8] ?? "", approach: c[7] ?? "" });
  }
  return out;
}

/** Compute completion signals from a rendered scoreboard + metric.md. */
export function checkCompletion(scoreboardMd: string, metricMd: string): CompletionSignals {
  const t = parseMetricMd(metricMd);
  const matchesMetric = (r: SbRow) => !(t.primaryMetric && r.metricName && r.metricName !== t.primaryMetric);

  const allRows = parseRows(scoreboardMd).filter(matchesMetric);
  const okRows = allRows.filter((r) => r.status === "ok" && NUM.test(r.metric));

  // floor / target + the ordered ok-metric list for plateau.
  let floorMet = false, targetMet = false;
  const metrics: number[] = [];
  for (const r of okRows) {
    metrics.push(parseFloat(r.metric));
    if (cmp(r.metric, t.minOp, t.minVal)) floorMet = true;
    if (cmp(r.metric, t.tgtOp, t.tgtVal)) targetMet = true;
  }

  // K_so_far: per-part longest strictly-improving at-target streak. "Improving" is
  // direction-aware: a lower metric is better for minimize, higher for maximize. The
  // seed sentinel (no prior value in the chain) is the worst-possible value for the
  // direction, so the first at-target row always starts a chain.
  const minimize = t.direction === "minimize";
  const SEED = minimize ? Infinity : -Infinity;
  const tuples = [...allRows].sort((a, b) =>
    (a.instrument < b.instrument ? -1 : a.instrument > b.instrument ? 1 : 0) ||
    (a.exp < b.exp ? -1 : a.exp > b.exp ? 1 : 0));
  let kSoFar = 0, chain = 0, best = SEED, prevInst = "";
  for (const r of tuples) {
    if (r.instrument !== prevInst) {
      if (chain > kSoFar) kSoFar = chain;
      chain = 0; best = SEED; prevInst = r.instrument;
    }
    const mv = parseFloat(r.metric);
    const atTarget = cmp(r.metric, t.tgtOp, t.tgtVal);
    const improving = best === SEED || (minimize ? mv < best : mv > best);
    if (r.status === "ok" && NUM.test(r.metric) && atTarget && improving) {
      chain += 1; best = mv;
    } else {
      if (chain > kSoFar) kSoFar = chain;
      chain = 0; best = SEED;
    }
  }
  if (chain > kSoFar) kSoFar = chain;

  // plateau: today's global last-N spread check (semantics unchanged).
  let globalFlat = false;
  if (metrics.length >= t.plateauWindow) {
    const lastN = metrics.slice(-t.plateauWindow);
    if (Math.max(...lastN) - Math.min(...lastN) < t.plateauThreshold) globalFlat = true;
  }

  // B1 approach-aware plateau: group ok rows by normalized family (chronological by exp),
  // count active families, and count families still improving (latest beats prior in-family
  // best by > plateau_threshold, direction-aware). plateau is STRICTLY ADDITIVE to globalFlat.
  const byFam = new Map<string, { exp: string; mv: number }[]>();
  for (const r of okRows) {
    const fam = normalizeFamily(r.approach);
    (byFam.get(fam) ?? byFam.set(fam, []).get(fam)!).push({ exp: r.exp, mv: parseFloat(r.metric) });
  }
  const familiesActive = byFam.size;
  let familiesImproving = 0;
  for (const series of byFam.values()) {
    if (series.length < 2) continue;
    const chron = [...series].sort((a, b) => (a.exp < b.exp ? -1 : a.exp > b.exp ? 1 : 0));
    const latest = chron[chron.length - 1].mv;
    const prior = chron.slice(0, -1).map((x) => x.mv);
    const priorBest = minimize ? Math.min(...prior) : Math.max(...prior);
    const improving = minimize
      ? latest < priorBest - t.plateauThreshold
      : latest > priorBest + t.plateauThreshold;
    if (improving) familiesImproving += 1;
  }
  const minFamilies = t.minFamilies;
  const plateau = globalFlat && familiesActive >= minFamilies && familiesImproving === 0;

  if (kSoFar > t.kRequired) kSoFar = t.kRequired;
  return { floorMet, targetMet, kSoFar, kRequired: t.kRequired, plateau,
    familiesActive, familiesImproving, minFamilies };
}

/** Has the time budget elapsed? budget: "none" | positive integer seconds.
 *  nowEpochS is injected (epoch seconds). Throws on malformed budget / unparseable start. */
export function checkTimeBudget(budget: string, sessionStartIso: string, nowEpochS: number): boolean {
  const b = budget.replace(/\s/g, "");
  if (b === "none") return false;
  if (!/^[1-9][0-9]*$/.test(b)) throw new Error(`malformed budget: '${b}' (expected 'none' or positive integer)`);
  const startMs = Date.parse(sessionStartIso.replace(/\s/g, ""));
  if (Number.isNaN(startMs)) throw new Error(`could not parse session-start: '${sessionStartIso}'`);
  return nowEpochS - Math.floor(startMs / 1000) >= parseInt(b, 10);
}
