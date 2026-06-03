// Score-walk pure logic for /consort:rehearsal. Faithful to deep-research-score.sh:
// walk parts/*/experiments/*/result.json (ascending), validate+accumulate, build
// scoreboard + results.tsv, compute sidecar writes/removes + race-guarded phase clears.
// Pure: FS access injected via ScoreFs; the verb (C5) applies the returned plan.
import { join } from "node:path";
import { validateResult, buildScoreboard, type ScoreRow } from "./rehearsalResult.js";
import { mergeState, parseState } from "./rehearsalState.js";
import { parseMetricMd } from "./rehearsalMetric.js";
import { partsDir, partStateDir, experimentsDir, experimentDir } from "./rehearsal.js";

export interface ScoreFs {
  exists(path: string): boolean;
  read(path: string): string | null;
  listDir(path: string): string[];   // sorted ascending; MUST return [] for a missing dir (ENOENT-safe), mirroring bash nullglob
}

export interface TsvRow {
  expId: string; instrument: string; approach: string;
  metric: string; status: string; runtime: string; metricName: string;
}

const TSV_HEADER = "exp_id\tinstrument\tapproach\tmetric\tstatus\truntime_s\tmetric_name\n";

/** results.tsv = frozen 7-col header + one row per experiment (walk order). */
export function buildResultsTsv(rows: TsvRow[]): string {
  return TSV_HEADER + rows.map((r) =>
    `${r.expId}\t${r.instrument}\t${r.approach}\t${r.metric}\t${r.status}\t${r.runtime}\t${r.metricName}\n`).join("");
}

export interface ScoreComputation {
  scoreboardMd: string;
  resultsTsv: string;
  sidecars: { path: string; body: string }[];
  staleSidecars: string[];
  phaseClears: { statePath: string; merged: string }[];
  warnings: string[];
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Compute the full score plan for a rehearsal art dir. now() stamps sidecar/last_event_ts. */
export function computeScore(art: string, fs: ScoreFs, now: () => string): ScoreComputation {
  const metricMd = fs.read(join(art, "metric.md"));
  const parsed = metricMd ? parseMetricMd(metricMd) : null;
  const expectedMetric = parsed?.primaryMetric || undefined;

  const rows: ScoreRow[] = [];
  const tsvRows: TsvRow[] = [];
  const sidecars: { path: string; body: string }[] = [];
  const staleSidecars: string[] = [];
  const warnings: string[] = [];

  // Walk like the bash `parts/*/experiments/*/` glob under nullglob: listDir
  // returns [] for a non-existent dir, so no explicit dir-existence gate.
  const parts = fs.listDir(partsDir(art));
  for (const instrument of parts) {
    const exps = fs.listDir(experimentsDir(art, instrument));
    for (const expId of exps) {
      const branchDir = experimentDir(art, instrument, expId);
      const resultPath = join(branchDir, "result.json");
      if (!fs.exists(resultPath)) continue;
      const sidecar = join(branchDir, "result-validation.txt");
      let json: unknown;
      try { json = JSON.parse(fs.read(resultPath) ?? ""); } catch { json = null; }
      const v = validateResult(json, {
        expectedMetric,
        logPathExists: (p) => (p.startsWith("./") ? fs.exists(join(branchDir, p)) : true),
      });
      if (!v.ok) {
        sidecars.push({ path: sidecar, body: `FAILED at ${now()}: ${v.error}\n` });
        warnings.push(`result.json invalid: ${resultPath} (${v.error})`);
        continue;
      }
      if (fs.exists(sidecar)) staleSidecars.push(sidecar);
      const o = json as Record<string, unknown>;
      rows.push({ expId, instrument, metric: str(o.metric_value), status: str(o.status),
        runtime: str(o.runtime_s), approach: str(o.approach_label), metricName: str(o.metric_name) });
      tsvRows.push({ expId, instrument, approach: str(o.approach_label), metric: str(o.metric_value),
        status: str(o.status), runtime: str(o.runtime_s), metricName: str(o.metric_name) });
    }
  }

  const phaseClears: { statePath: string; merged: string }[] = [];
  for (const instrument of parts) {
    const statePath = join(partStateDir(art, instrument), "state.txt");
    const stateTxt = fs.read(statePath);
    if (stateTxt === null) continue;
    const cur = parseState(stateTxt).current_exp_id ?? "";
    if (!cur) continue;
    if (!fs.exists(join(experimentDir(art, instrument, cur), "result.json"))) continue;
    phaseClears.push({ statePath, merged: mergeState(stateTxt, {
      last_event: "scored", last_event_ts: now(), phase: "idle", current_exp_id: "" }) });
  }

  return { scoreboardMd: buildScoreboard(rows, parsed?.direction), resultsTsv: buildResultsTsv(tsvRows),
    sidecars, staleSidecars, phaseClears, warnings };
}
