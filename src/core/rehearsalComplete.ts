// Completion + time-budget math for /consort:rehearsal. Faithful to
// deep-research.sh (check_completion, check_time_budget). Pure functions.

import { parseMetricMd } from "./rehearsalMetric.js";

export interface CompletionSignals {
  floorMet: boolean;
  targetMet: boolean;
  kSoFar: number;
  kRequired: number;
  plateau: boolean;
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

interface SbRow { exp: string; instrument: string; metric: string; status: string; metricName: string; }

/** Parse plain-rank data rows (| <int> | exp-… |). Excludes header/sep and ~-prefixed partial rows. */
function parseRows(scoreboardMd: string): SbRow[] {
  const out: SbRow[] = [];
  for (const line of scoreboardMd.split("\n")) {
    if (!/^\|\s+\d+\s+\|\s+exp-/.test(line)) continue;
    const c = line.split("|").map((s) => s.trim());
    // c[0]="" c[1]=rank c[2]=exp c[3]=instrument c[4]=metric c[5]=status c[6]=runtime c[7]=approach c[8]=metric_name
    out.push({ exp: c[2], instrument: c[3], metric: c[4], status: c[5], metricName: c[8] ?? "" });
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

  // K_so_far: per-part longest strictly-improving at-target streak.
  const tuples = [...allRows].sort((a, b) =>
    (a.instrument < b.instrument ? -1 : a.instrument > b.instrument ? 1 : 0) ||
    (a.exp < b.exp ? -1 : a.exp > b.exp ? 1 : 0));
  let kSoFar = 0, chain = 0, best = -Infinity, prevInst = "";
  for (const r of tuples) {
    if (r.instrument !== prevInst) {
      if (chain > kSoFar) kSoFar = chain;
      chain = 0; best = -Infinity; prevInst = r.instrument;
    }
    const mv = parseFloat(r.metric);
    const atTarget = cmp(r.metric, t.tgtOp, t.tgtVal);
    const improving = best === -Infinity || mv > best;
    if (r.status === "ok" && NUM.test(r.metric) && atTarget && improving) {
      chain += 1; best = mv;
    } else {
      if (chain > kSoFar) kSoFar = chain;
      chain = 0; best = -Infinity;
    }
  }
  if (chain > kSoFar) kSoFar = chain;

  // plateau: last plateau_window ok metrics (in scoreboard order) span < threshold.
  let plateau = false;
  if (metrics.length >= t.plateauWindow) {
    const lastN = metrics.slice(-t.plateauWindow);
    if (Math.max(...lastN) - Math.min(...lastN) < t.plateauThreshold) plateau = true;
  }

  if (kSoFar > t.kRequired) kSoFar = t.kRequired;
  return { floorMet, targetMet, kSoFar, kRequired: t.kRequired, plateau };
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
