# Rehearsal C1 — Independent Re-implementation Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add C1 — the cross-family Claude Maestro regenerates a new-best experiment from the part's run-card alone (never its `code/`), re-runs it end-to-end, re-derives the metric, and verifies the integrity attestation; a confident `not-reproduced` demotes the leader to the `x<rank>` infeasible group.

**Architecture:** Mirror the A1 verb skeleton (`verify-plan`/`verify-check` → `inspect-plan`/`inspect-check`) + a new pure `rehearsalInspect` core (three-way verdict, reusing A1's `recomputedFromOutput` marker + epsilon shape) + an append-produced `inspection.tsv` (distinct from `verification.tsv`) read by `computeScore`/`status-brief`. Run-card enrichment (`data_spec`/`metric_formula`) + `c1_epsilon`/`c1_budget` knobs are additive. Explore-only: re-impl writes only to `experiments/<exp>/c1/`.

**Tech Stack:** TypeScript (Node/ESM, `.js` import specifiers), vitest, esbuild bundle (`dist/consort.cjs`). Pure core with injected FS.

**Spec:** `docs/superpowers/specs/2026-06-04-rehearsal-c1-inspector-design.md`

**Standing rules for every task:**
- `npm run typecheck` (authoritative) — ignore stale-LSP phantom diagnostics. Do NOT run `npm run build` (release does it).
- ESM `.js` import specifiers. No emojis. Errors to stderr. Pure modules: no `Date.now()`/`Math.random()`.
- Never weaken `tests/stale-tokens.test.ts`; no `clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_`/`trooper`/`commander`.
- Read each file before editing.

---

### Task 1: New pure core `rehearsalInspect.ts`

**Files:** Create `src/core/rehearsalInspect.ts`; Test `tests/rehearsal-inspect.test.ts`

- [ ] **Step 1: Write the failing test** `tests/rehearsal-inspect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyInspect, inspectInfeasibleReason, parseInspections, inspectionRow, INSPECTION_TSV_HEADER } from "../src/core/rehearsalInspect.js";

describe("classifyInspect", () => {
  const base = { reimplMetric: 0.90, runFailed: false, reported: 0.90, epsilon: 0.02, integrityRefuted: false };
  it("within epsilon -> reproduced", () => {
    expect(classifyInspect({ ...base, reimplMetric: 0.91 }).verdict).toBe("reproduced");
  });
  it("beyond epsilon -> not-reproduced", () => {
    const r = classifyInspect({ ...base, reimplMetric: 0.70 });
    expect(r.verdict).toBe("not-reproduced");
    expect(r.reason).toContain("value:");
  });
  it("integrityRefuted -> not-reproduced (precedence)", () => {
    const r = classifyInspect({ ...base, integrityRefuted: true });
    expect(r.verdict).toBe("not-reproduced");
    expect(r.reason).toBe("integrity-refuted");
  });
  it("runFailed -> inconclusive (NOT a demotion)", () => {
    expect(classifyInspect({ ...base, runFailed: true }).verdict).toBe("inconclusive");
  });
  it("no reimpl marker -> inconclusive", () => {
    expect(classifyInspect({ ...base, reimplMetric: null }).verdict).toBe("inconclusive");
  });
  it("no reported metric -> inconclusive", () => {
    expect(classifyInspect({ ...base, reported: null }).verdict).toBe("inconclusive");
  });
});

describe("inspectInfeasibleReason", () => {
  it("not-reproduced -> reimpl-mismatch", () => expect(inspectInfeasibleReason("not-reproduced")).toBe("reimpl-mismatch"));
  it("reproduced/inconclusive/absent -> null", () => {
    expect(inspectInfeasibleReason("reproduced")).toBeNull();
    expect(inspectInfeasibleReason("inconclusive")).toBeNull();
    expect(inspectInfeasibleReason(undefined)).toBeNull();
  });
});

describe("parseInspections", () => {
  it("keys instrument/exp, last-write-wins, header skipped", () => {
    const tsv = INSPECTION_TSV_HEADER +
      "exp-001\toboe\treproduced\t\t0.9\tT\n" +
      "exp-002\toboe\tnot-reproduced\tvalue\t0.5\tT\n" +
      "exp-002\toboe\tinconclusive\treimpl-failed\t\tT2\n";
    const m = parseInspections(tsv);
    expect(m["oboe/exp-001"]).toBe("reproduced");
    expect(m["oboe/exp-002"]).toBe("inconclusive"); // last write wins
  });
});

describe("inspectionRow + header", () => {
  it("exact tab layout", () => {
    expect(INSPECTION_TSV_HEADER).toBe("exp_id\tinstrument\tverdict\treason\treimpl_metric\tts\n");
    expect(inspectionRow({ expId: "exp-003", instrument: "oboe", verdict: "not-reproduced", reason: "value:0.5vs0.9", reimplMetric: "0.5", ts: "T" }))
      .toBe("exp-003\toboe\tnot-reproduced\tvalue:0.5vs0.9\t0.5\tT\n");
  });
});
```

- [ ] **Step 2: Run, confirm RED.**

- [ ] **Step 3: Create `src/core/rehearsalInspect.ts`:**

```ts
// Independent re-implementation inspector pure logic for /consort:rehearsal (research-validity C1).
// The cross-family Maestro re-runs the experiment from the run-card alone and re-derives the metric;
// this adjudicates a THREE-WAY verdict. Unlike A1's checkVerify (which returns `mismatch` on a failed
// re-run), C1 returns `inconclusive` on any couldn't-complete path so the gate never demotes an
// expensive-to-reproduce honest result. Pure: FS injected; the verbs apply the rows.

export type InspectVerdict = "reproduced" | "not-reproduced" | "inconclusive";

/** Three-way adjudication of the independent re-run vs the part's reported metric.
 *  not-reproduced = a confident disagreement (gaming/irreproducibility signal) OR integrity refuted;
 *  inconclusive = couldn't complete a confident comparison (never a demotion). */
export function classifyInspect(opts: {
  reimplMetric: number | null; runFailed: boolean; reported: number | null; epsilon: number; integrityRefuted: boolean;
}): { verdict: InspectVerdict; reason: string } {
  if (opts.integrityRefuted) return { verdict: "not-reproduced", reason: "integrity-refuted" };
  if (opts.runFailed) return { verdict: "inconclusive", reason: "reimpl-failed" };
  if (opts.reimplMetric === null) return { verdict: "inconclusive", reason: "no-marker" };
  if (opts.reported === null) return { verdict: "inconclusive", reason: "no-reported" };
  if (Math.abs(opts.reimplMetric - opts.reported) <= opts.epsilon) return { verdict: "reproduced", reason: "" };
  return { verdict: "not-reproduced", reason: `value:${opts.reimplMetric}vs${opts.reported}` };
}

/** A confident C1 not-reproduced routes the row to A2's infeasible group; else no infeasible. */
export function inspectInfeasibleReason(verdict: string | undefined): string | null {
  return verdict === "not-reproduced" ? "reimpl-mismatch" : null;
}

/** inspection.tsv -> instrument/exp -> latest verdict (last write wins). Mirrors parseVerdicts. */
export function parseInspections(tsv: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of tsv.split("\n")) {
    if (!line || line.startsWith("exp_id\t")) continue;
    const c = line.split("\t");   // exp_id, instrument, verdict, reason, reimpl_metric, ts
    if (c[0] && c[1] && c[2]) out[`${c[1]}/${c[0]}`] = c[2];
  }
  return out;
}

export interface InspectionRow {
  expId: string; instrument: string; verdict: InspectVerdict; reason: string; reimplMetric: string; ts: string;
}
export const INSPECTION_TSV_HEADER = "exp_id\tinstrument\tverdict\treason\treimpl_metric\tts\n";
export function inspectionRow(r: InspectionRow): string {
  return `${r.expId}\t${r.instrument}\t${r.verdict}\t${r.reason}\t${r.reimplMetric}\t${r.ts}\n`;
}
```

- [ ] **Step 4: Run (PASS) + `npm run typecheck` (clean).**
- [ ] **Step 5: Commit:**
```bash
git add src/core/rehearsalInspect.ts tests/rehearsal-inspect.test.ts
git commit -m "feat(rehearsal): C1 rehearsalInspect core (classifyInspect three-way verdict)"
```

---

### Task 2: Run-card fields (`result.json`) + `c1_epsilon`/`c1_budget` knobs

**Files:** Modify `src/core/rehearsalResult.ts` (`ResultJson` :8-28), `src/core/rehearsalMetric.ts` (`MetricThresholds` + `parseMetricMd`); Test `tests/rehearsal-core.test.ts`

- [ ] **Step 1: Write the failing test** in `tests/rehearsal-core.test.ts` (mirror the `min_families` test):
```ts
describe("metric.md c1 knobs (C1)", () => {
  it("defaults: c1Epsilon undefined (caller defaults 0.02), c1Budget undefined (caller defaults 2)", () => {
    const t = parseMetricMd("**Primary metric:** accuracy\n");
    expect(t.c1Epsilon).toBeUndefined();
    expect(t.c1Budget).toBeUndefined();
  });
  it("parses explicit values", () => {
    const t = parseMetricMd("**c1_epsilon:** 0.05\n**c1_budget:** 3\n");
    expect(t.c1Epsilon).toBe(0.05);
    expect(t.c1Budget).toBe(3);
  });
  it("parse-only: formatMetricBlock emits neither", () => {
    const md = formatMetricBlock({ primary_metric: "accuracy", direction: "maximize" });
    expect(md).not.toContain("c1_epsilon");
    expect(md).not.toContain("c1_budget");
  });
});
```

- [ ] **Step 2: Run, confirm RED.**

- [ ] **Step 3: Implement.**

(a) `src/core/rehearsalMetric.ts` — add to `MetricThresholds` (after `minFamilies`):
```ts
  /** optional metric.md `**c1_epsilon:**` for C1 round-trip tolerance; caller defaults to 2x verify_epsilon (0.02). */
  c1Epsilon?: number;
  /** optional metric.md `**c1_budget:**` max C1 inspections per session; caller defaults to 2. */
  c1Budget?: number;
```
Add parse branches after the `min_families` branch:
```ts
    else if ((m = line.match(/^\*\*c1_epsilon:\*\*\s+(.*)$/))) { const n = parseFloat(m[1].trim()); if (!Number.isNaN(n)) c1Epsilon = n; }
    else if ((m = line.match(/^\*\*c1_budget:\*\*\s+(.*)$/))) { const n = parseInt(m[1].trim(), 10); if (!Number.isNaN(n)) c1Budget = n; }
```
Add `let c1Epsilon: number | undefined; let c1Budget: number | undefined;` beside the other optional-knob declarations, and add `c1Epsilon, c1Budget` to the returned object. Do NOT touch `formatMetricBlock`.

(b) `src/core/rehearsalResult.ts` — add optional fields to the `ResultJson` interface (after `integrity?`), documentation-only (validateResult's REQUIRED_FIELDS + invariants unchanged):
```ts
  /** C1 run-card: how to obtain the same data + split for an independent re-run. Optional. */
  data_spec?: { source?: string; split_seed?: number; split_hash?: string; target_column?: string; feature_columns?: string[] };
  /** C1 run-card: a precise metric computation so a re-derived number is comparable. Optional. */
  metric_formula?: string;
```

- [ ] **Step 4: Run (PASS) + `npm run typecheck`.** Confirm no existing `ResultJson` literal/validateResult test breaks (optional fields are additive).
- [ ] **Step 5: Commit:**
```bash
git add src/core/rehearsalResult.ts src/core/rehearsalMetric.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): C1 run-card fields (data_spec/metric_formula) + c1_epsilon/c1_budget knobs"
```

---

### Task 3: `inspect-plan` / `inspect-check` verbs

**Files:** Modify `src/commands/rehearsal.ts` (verbs near the A1 verbs ~289-355; `appendInspectionRow` + live deps near ~1660-1681; dispatch cases ~1691); Test `tests/rehearsal-cmd.test.ts`

This mirrors `verifyPlanWith`/`verifyCheckWith` (read them first). Key differences: `--authorize-inspect` (not `--authorize-rerun`); the budget gate counts existing `inspection.tsv` C1 rows vs `c1_budget`; the run-card-sufficiency gate checks `result.json` has `data_spec` + `metric_formula`; `inspect-check` uses `classifyInspect` (three-way) with `c1Epsilon` (`2 × (verifyEpsilon ?? 0.01)` default) and supports `--integrity-refuted`.

- [ ] **Step 1: Write the failing tests** in `tests/rehearsal-cmd.test.ts`. Reuse the experiment-send describe's `home()`/`scaffold(h, over)`/`opts(h)` if accessible, OR add a small `inspect` describe that scaffolds an art dir + a result.json. Minimum cases:
```ts
  it("inspect-plan without --authorize-inspect -> pending inspect-deferred (C1)", async () => {
    // scaffold art + parts/<INST>/experiments/exp-001/result.json with data_spec + metric_formula
    // then call inspectPlanWith([TOPIC, INST, "exp-001"], deps) and assert stdout contains VERDICT=pending reason=inspect-deferred
  });
  it("inspect-plan with --authorize-inspect but no data_spec -> inconclusive run-card-insufficient (C1)", async () => { /* ... */ });
  it("inspect-plan authorized + sufficient run-card -> prints INSPECT_CWD (C1)", async () => { /* ... */ });
  it("inspect-check --stdout-file with VERIFY_METRIC within c1_epsilon -> reproduced (C1)", async () => { /* ... */ });
  it("inspect-check --stdout-file beyond c1_epsilon -> not-reproduced (C1)", async () => { /* ... */ });
  it("inspect-check --run-failed -> inconclusive (C1)", async () => { /* ... */ });
  it("inspect-check --integrity-refuted -> not-reproduced (C1)", async () => { /* ... */ });
```
Use the exact stdout-capturing `deps.stdout` pattern the verify-plan/verify-check tests use (search `verifyPlanWith(`/`verifyCheckWith(` in this file for the harness). The C1 deps interfaces mirror `VerifyPlanDeps`/`VerifyCheckDeps` (below) — inject `readResult`/`readMetricMd`/`readInspectionCount`/`writeRow`/`now` and capture `stdout`.

- [ ] **Step 2: Run, confirm RED.**

- [ ] **Step 3: Implement** in `src/commands/rehearsal.ts`:

(a) Import `rehearsalInspect`:
```ts
import { classifyInspect, inspectionRow, INSPECTION_TSV_HEADER, type InspectVerdict, type InspectionRow } from "../core/rehearsalInspect.js";
```

(b) `inspect-plan` deps + verb (near the A1 verbs):
```ts
export interface InspectPlanDeps {
  readResult(art: string, instrument: string, expId: string): Record<string, unknown> | null;
  readMetricMd(art: string): string | null;
  inspectionCount(art: string): number;                 // existing C1 rows in inspection.tsv
  partProvider(art: string, instrument: string, topic: string): string | null;   // same-family guard ("claude" => same family as the Maestro)
  writeRow(art: string, instrument: string, expId: string, row: InspectionRow): void;
  now(): string;
  stdout?: (l: string) => void;
  opts?: PathOpts;
}

export async function inspectPlanWith(args: string[], deps: InspectPlanDeps): Promise<number> {
  const authorize = args.includes("--authorize-inspect");
  const pos = args.filter((a) => !a.startsWith("--"));
  if (pos.length !== 3) { log.error("rehearsal inspect-plan: usage: <topic> <instrument> <exp-id> [--authorize-inspect]"); return 2; }
  const [topic, instrument, expId] = pos;
  const art = rehearsalArtDir(topic, deps.opts);
  const result = deps.readResult(art, instrument, expId);
  if (result === null) { log.error(`rehearsal inspect-plan: result.json missing for ${instrument}/${expId}`); return 1; }
  const out = deps.stdout ?? ((l: string): void => { process.stdout.write(l + "\n"); });
  const term = (verdict: InspectVerdict, reason: string): number => {
    deps.writeRow(art, instrument, expId, { expId, instrument, verdict, reason, reimplMetric: "", ts: deps.now() });
    out(`VERDICT=${verdict} reason=${reason}`); return 0;
  };
  if (!authorize) return term("inconclusive", "inspect-deferred");   // not deemed new-best (visible, not silent)
  const md = deps.readMetricMd(art);
  const budget = (md ? parseMetricMd(md).c1Budget : undefined) ?? 2;
  if (deps.inspectionCount(art) >= budget) return term("inconclusive", "budget-exhausted");
  if (result.data_spec === undefined || result.data_spec === null || typeof result.metric_formula !== "string" || result.metric_formula === "") {
    return term("inconclusive", "run-card-insufficient");
  }
  if ((deps.partProvider(art, instrument, topic) ?? "") === "claude") return term("inconclusive", "same-family");
  out(`INSPECT_CWD=${join(experimentDir(art, instrument, expId), "c1")}`);
  out(`REPORTED_METRIC=${typeof result.metric_value === "number" ? result.metric_value : ""}`);
  out(`METRIC_NAME=${str(result.metric_name)}`);
  out(`METRIC_FORMULA=${str(result.metric_formula)}`);
  out(`DATA_SPEC=${JSON.stringify(result.data_spec)}`);
  out(`APPROACH=${str(result.approach_label)}`);
  out(`INTEGRITY=${JSON.stringify(result.integrity ?? {})}`);
  return 0;
}
```
(NOTE: `str` is a local helper in this file — check its presence near `experimentSendWith`/the score helpers; if absent use `String(x ?? "")`.) The `inspect-deferred`/`budget-exhausted` terminal verdicts use `inconclusive` (not a new enum value) — they never demote.

(c) `inspect-check` deps + verb:
```ts
export interface InspectCheckDeps {
  readResult(art: string, instrument: string, expId: string): Record<string, unknown> | null;
  readMetricMd(art: string): string | null;
  readStdout(path: string): string | null;
  readJson(path: string): string | null;
  writeRow(art: string, instrument: string, expId: string, row: InspectionRow): void;
  now(): string;
  stdout?: (l: string) => void;
  opts?: PathOpts;
}

export async function inspectCheckWith(args: string[], deps: InspectCheckDeps): Promise<number> {
  const runFailed = args.includes("--run-failed");
  const integrityRefuted = args.includes("--integrity-refuted");
  let stdoutFile: string | undefined;
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stdout-file") { stdoutFile = args[++i]; }
    else if (args[i] === "--run-failed" || args[i] === "--integrity-refuted") { /* flags */ }
    else if (!args[i].startsWith("--")) pos.push(args[i]);
  }
  if (pos.length !== 3) { log.error("rehearsal inspect-check: usage: <topic> <instrument> <exp-id> (--stdout-file <path> | --run-failed) [--integrity-refuted]"); return 2; }
  if (!runFailed && !integrityRefuted && stdoutFile === undefined) { log.error("rehearsal inspect-check: need --stdout-file <path> or --run-failed or --integrity-refuted"); return 2; }
  const [topic, instrument, expId] = pos;
  const art = rehearsalArtDir(topic, deps.opts);
  const result = deps.readResult(art, instrument, expId);
  if (result === null) { log.error(`rehearsal inspect-check: result.json missing for ${instrument}/${expId}`); return 1; }
  const reported = typeof result.metric_value === "number" ? result.metric_value : null;
  const md = deps.readMetricMd(art);
  const t = md ? parseMetricMd(md) : null;
  const epsilon = t?.c1Epsilon ?? (2 * (t?.verifyEpsilon ?? 0.01));
  let reimplMetric: number | null = null;
  if (!runFailed && !integrityRefuted) {
    const stdout = stdoutFile ? deps.readStdout(stdoutFile) : null;
    reimplMetric = stdout === null ? null : recomputedFromOutput(stdout, "marker", (p) => deps.readJson(join(experimentDir(art, instrument, expId), p)));
  }
  const { verdict, reason } = classifyInspect({ reimplMetric, runFailed, reported, epsilon, integrityRefuted });
  deps.writeRow(art, instrument, expId, { expId, instrument, verdict, reason, reimplMetric: reimplMetric === null ? "" : String(reimplMetric), ts: deps.now() });
  const out = deps.stdout ?? ((l: string): void => { process.stdout.write(l + "\n"); });
  out(`VERDICT=${verdict} reason=${reason}`);
  return 0;
}
```
(`recomputedFromOutput` is already imported for A1 — reuse it.)

(d) `appendInspectionRow` + live deps + dispatch (near the A1 wiring ~1660-1692):
```ts
function appendInspectionRow(art: string, instrument: string, expId: string, row: InspectionRow): void {
  const tsv = join(art, "inspection.tsv");
  const prior = existsSync(tsv) ? readFileSync(tsv, "utf8") : INSPECTION_TSV_HEADER;
  atomicWrite(tsv, prior + inspectionRow(row));
  atomicWrite(join(experimentDir(art, instrument, expId), "inspection.txt"),
    `${row.verdict} reason=${row.reason} reimpl_metric=${row.reimplMetric} at ${row.ts}\n`);
}
const liveInspectPlanDeps: InspectPlanDeps = {
  readResult: liveVerifyPlanDeps.readResult,
  readMetricMd: (art) => { const p = join(art, "metric.md"); return existsSync(p) ? readFileSync(p, "utf8") : null; },
  inspectionCount: (art) => { const p = join(art, "inspection.tsv"); if (!existsSync(p)) return 0; return readFileSync(p, "utf8").split("\n").filter((l) => l && !l.startsWith("exp_id\t")).length; },
  partProvider: (_art, i, topic) => resolveModel(i, topic),   // resolveModel returns the provider/model; same-family iff "claude"
  writeRow: appendInspectionRow,
  now: () => isoUtc(),
};
const liveInspectCheckDeps: InspectCheckDeps = {
  readResult: liveVerifyPlanDeps.readResult,
  readMetricMd: (art) => { const p = join(art, "metric.md"); return existsSync(p) ? readFileSync(p, "utf8") : null; },
  readStdout: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  readJson: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  writeRow: appendInspectionRow,
  now: () => isoUtc(),
};
```
**`partProvider` note:** `topic` is threaded through the dep (the verb has it as the first positional), and the live dep returns `resolveModel(i, topic)` — the part's provider string; same-family iff `"claude"`. The mechanical gate is a thin backstop (parts are codex-only today); Step 3.5b in the directive also instructs the Maestro to skip C1 on a `claude` part. `resolveModel` is already imported in this file (used by `experimentSendWith`).

Dispatch cases (after the `verify-check` case):
```ts
    case "inspect-plan": return inspectPlanWith(rest, liveInspectPlanDeps);
    case "inspect-check": return inspectCheckWith(rest, liveInspectCheckDeps);
```

- [ ] **Step 4: Run `npx vitest run tests/rehearsal-cmd.test.ts` (PASS) + `npm run typecheck`.**
- [ ] **Step 5: Commit:**
```bash
git add src/commands/rehearsal.ts tests/rehearsal-cmd.test.ts
git commit -m "feat(rehearsal): C1 inspect-plan/inspect-check verbs + inspection.tsv"
```

---

### Task 4: `computeScore` reads `inspection.tsv` → INFEASIBLE routing

**Files:** Modify `src/core/rehearsalScore.ts` (`parseVerdicts` read ~:57, the `infReason` line ~:119-120); Test `tests/rehearsal-core.test.ts`

- [ ] **Step 1: Write the failing test** in the `computeScore` describe (fakeFs harness, art `/a`; full result.json shape). A result with an `inspection.tsv` `not-reproduced` verdict → its `ScoreRow.infeasibleReason` is `reimpl-mismatch` and it lands in the `x<rank>` group:
```ts
  it("routes a C1 not-reproduced result to the infeasible group (C1)", () => {
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n**Direction:** maximize\n",
      "/a/inspection.tsv": "exp_id\tinstrument\tverdict\treason\treimpl_metric\tts\nexp-001\toboe\tnot-reproduced\tvalue\t0.5\tT\n",
      "/a/parts/oboe/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"x",metric_name:"accuracy",metric_value:0.99,status:"ok",
        runtime_s:5,log_paths:[],checkpoint_path:null,notes:"" }),
    };
    const c = computeScore("/a", fakeFs(files), () => "T");
    expect(c.scoreboardMd).toContain("x1");          // routed to the x<rank> infeasible group
    expect(c.scoreboardMd).toContain("reimpl-mismatch");
  });
```
(Check the exact `x<rank>` render + how the infeasible reason string appears in `buildScoreboard` — read `rehearsalResult.ts:103-135` for the cell format and adjust the assertion to match, e.g. `infeasible:reimpl-mismatch`.)

- [ ] **Step 2: Run, confirm RED.**

- [ ] **Step 3: Implement** in `src/core/rehearsalScore.ts`:
- Import: `import { parseInspections, inspectInfeasibleReason } from "./rehearsalInspect.js";`
- After the `verification.tsv` read (~:57): `const inspections = parseInspections(fs.read(join(art, "inspection.tsv")) ?? "");`
- Change the `infReason` derivation (~:119): fall back to the C1 reason when A1/A3 didn't flag:
```ts
      const infReason = classifyInfeasible(verdicts[`${instrument}/${expId}`], flags.map((f) => f.flag))
        ?? inspectInfeasibleReason(inspections[`${instrument}/${expId}`]);
      if (infReason) scoreRow.infeasibleReason = infReason;
```

- [ ] **Step 4: Run (PASS) + `npm run typecheck`** (+ confirm `checkCompletion` regression: an infeasible row is excluded from completion with no change to that module).
- [ ] **Step 5: Commit:**
```bash
git add src/core/rehearsalScore.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): C1 computeScore routes not-reproduced to infeasible (reimpl-mismatch)"
```

---

### Task 5: `statusBriefWith` join + `[reimpl-*]` brief tag

**Files:** Modify `src/commands/rehearsal.ts` (`statusBriefWith` — after the lineage join), `src/core/rehearsalBrief.ts` (`StatusBriefInput` + top-3 render); Test `tests/rehearsal-core.test.ts`

- [ ] **Step 1: Write the failing tests** in the `buildStatusBrief` block:
```ts
  it("tags top-3 rows with [reimpl-*] from inspections (C1)", () => {
    const sb =
      "| Rank | Exp | Instrument | Metric | Status | Runtime | Approach | Metric name |\n" +
      "|---|---|---|---|---|---|---|---|\n" +
      "| 1 | exp-003 | oboe | 0.95 | ok | 5 | x | accuracy |\n";
    const ok = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: SIG, inspections: { "oboe/exp-003": "reproduced" } });
    expect(ok).toContain("[reimpl-ok]");
    const bad = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: SIG, inspections: { "oboe/exp-003": "not-reproduced" } });
    expect(bad).toContain("[reimpl-mismatch!]");
    const inc = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: SIG, inspections: { "oboe/exp-003": "inconclusive" } });
    expect(inc).toContain("[reimpl-inconclusive]");
    const none = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: SIG });
    expect(none).not.toContain("[reimpl");
  });
```

- [ ] **Step 2: Run, confirm RED.**

- [ ] **Step 3: Implement.**
(a) `src/core/rehearsalBrief.ts` — `StatusBriefInput` gains (after `multiChange?`):
```ts
  /** instrument/exp -> C1 verdict (reproduced|not-reproduced|inconclusive), joined from inspection.tsv. */
  inspections?: Record<string, string>;
```
In the top-3 render, append a tag after the existing `${mc}`:
```ts
        const iv = input.inspections?.[`${r.instrument}/${r.exp}`];
        const itag = iv === "reproduced" ? " [reimpl-ok]" : iv === "not-reproduced" ? " [reimpl-mismatch!]" : iv === "inconclusive" ? " [reimpl-inconclusive]" : "";
        sb.push(`${r.rank}. ${r.instrument}/${r.exp} — ${r.metric} — ${r.metricName}${tag}${stag}${mc}${itag}`);
```
(replace the existing push line; preserve the em-dash `—`.)

(b) `src/commands/rehearsal.ts` `statusBriefWith` — after the lineage join, add the inspection join:
```ts
  const itsv = join(art, "inspection.tsv");
  let inspections: Record<string, string> | undefined;
  if (existsSync(itsv)) {
    inspections = {};
    for (const line of readFileSync(itsv, "utf8").split("\n")) {
      if (!line || line.startsWith("exp_id\t")) continue;
      const cells = line.split("\t");           // exp_id, instrument, verdict, ...
      if (cells[0] && cells[1] && cells[2]) inspections[`${cells[1]}/${cells[0]}`] = cells[2];   // last write wins
    }
  }
```
and pass `inspections` into the `buildStatusBrief({ ... })` call.

- [ ] **Step 4: Run `npx vitest run tests/rehearsal-core.test.ts tests/rehearsal-cmd.test.ts` (PASS) + `npm run typecheck`.**
- [ ] **Step 5: Commit:**
```bash
git add src/commands/rehearsal.ts src/core/rehearsalBrief.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): C1 status-brief [reimpl-*] tag from inspection.tsv"
```

---

### Task 6: finalize folds `not-reproduced` into `## Warnings` (BOTH halves)

**Files:** Modify `src/commands/rehearsal.ts` (the finalize folds ~1135-1146 + the `## Warnings` render loop ~1204-1211); Test `tests/rehearsal-finalize.test.ts`

**Landmine (B2 final-review):** the warnings fold has TWO halves — the `warnings.txt` write AND a render branch (`f[0] === "..."`) in the `## Warnings` bullet loop. Do BOTH.

- [ ] **Step 1: Write the failing test** in `tests/rehearsal-finalize.test.ts` (mirror the B2 `lineage` fold test): seed an `inspection.tsv` with a `not-reproduced` row, run finalize, assert `warnings.txt` AND the rendered `session-summary.md ## Warnings` both contain the `reimpl`/`not-reproduced` warning.

- [ ] **Step 2: Run, confirm RED.**

- [ ] **Step 3: Implement.**
(a) After the B2 lineage fold block (`if (existsSync(lineageTsv)) { ... }`), add:
```ts
  // C1: fold a not-reproduced inspection into warnings.txt (advisory in the summary; the row is
  // already demoted to x<rank> by computeScore).
  const inspectionTsv = join(art, "inspection.tsv");
  if (existsSync(inspectionTsv)) {
    const extra: string[] = [];
    for (const line of readFileSync(inspectionTsv, "utf8").split("\n")) {
      if (!line || line.startsWith("exp_id\t")) continue;
      const c = line.split("\t");                 // exp_id, instrument, verdict, reason, reimpl_metric, ts
      if (c[2] !== "not-reproduced") continue;
      if (c[0] && c[1]) extra.push(`reimpl\t${c[1]}/${c[0]}\tnot-reproduced\t${c[3] ?? ""}`);
    }
    if (extra.length) appendFileSync(warningsPath, extra.join("\n") + "\n");
  }
```
(b) In the `## Warnings` render loop, add a branch after the `lineage` branch:
```ts
    } else if (f[0] === "reimpl") {
      warnings.push(`- reimpl: ${f[1]} ${f[2]} (${f[3]})`);
    }
```

- [ ] **Step 4: Run `npx vitest run tests/rehearsal-finalize.test.ts` (PASS), then full `npm run test`, `npm run typecheck`, `npx vitest run tests/stale-tokens.test.ts`.**
- [ ] **Step 5: Commit:**
```bash
git add src/commands/rehearsal.ts tests/rehearsal-finalize.test.ts
git commit -m "feat(rehearsal): C1 finalize folds not-reproduced into warnings (both halves)"
```

---

### Task 7: Template + directive edits

**Files:** Modify `config/prompt-templates/rehearsal/experiment.md`, `commands/rehearsal.md`

- [ ] **Step 1: Edit the template** — near the existing `verify`/`integrity` blocks, add a run-card ask:
  > "**Run-card for inspection.** If you expect this result to be a leader, also write (in `result.json`) a `data_spec` (`{source, split_seed, split_hash, target_column, feature_columns}` — enough to obtain the same data + split) and a `metric_formula` (a precise computation, e.g. 'macro-F1, positive class = 1'). A cross-family inspector re-runs your experiment from these ALONE (not your code) and re-derives the metric — write them so an independent implementer could reproduce your result."

- [ ] **Step 2: Edit the directive** `commands/rehearsal.md`:
  - **New Step 3.5b** (after 3.5f, before Step 4): the gated C1 round-trip — fires ONLY when the just-landed result is a NEW-BEST leader (same judgment as `--authorize-rerun`), A1-verified, not `[suspect]`, and the part is NOT a `claude` part (else you'd be same-family). Steps: `inspect-plan <T> <i> <e> --authorize-inspect`; if it prints `INSPECT_CWD=`, author fresh INDEPENDENT code in that scratch dir (do NOT read the part's `code/`), obtain data per `DATA_SPEC`, re-run end-to-end with a timeout, tee stdout to `<exp-dir>/c1/inspect-stdout.log`, compute the metric per `METRIC_FORMULA` emitting `VERIFY_METRIC=<n>`; cross-check the integrity claims against the reconstructed split; `inspect-check <T> <i> <e> --stdout-file <log>` (add `--integrity-refuted` if a claim is contradicted; `--run-failed` if the re-run errored). A `not-reproduced` leader is demoted (A2 INFEASIBLE) and re-dispatched; `inconclusive` is noted only. **Explore-only: never write outside `<exp-dir>/c1/`, never the user repo, never `/consort:perform`.**
  - **Step 3 reading note** (near the `[multi-change]` note): `[reimpl-mismatch!]` = the independent re-implementation could not reproduce this leader's metric (strong gaming/irreproducibility signal — demoted); `[reimpl-ok]` = independently reproduced (corroborated); `[reimpl-inconclusive]` = couldn't complete a confident re-run (advisory only).
  - **Phase 1 mention:** the optional `c1_epsilon` (default 0.02 = 2× verify_epsilon) + `c1_budget` (default 2) knobs, added to `metric.md` with the Write tool like the other parse-only knobs.

- [ ] **Step 3: Verify the stale-token gate** (`npx vitest run tests/stale-tokens.test.ts`) + a banned-token grep on both files.
- [ ] **Step 4: Commit:**
```bash
git add config/prompt-templates/rehearsal/experiment.md commands/rehearsal.md
git commit -m "docs(rehearsal): C1 directive Step 3.5b (gated round-trip) + run-card ask + [reimpl-*] note"
```

---

### Task 8: Release — version bump, build, full gate, dist commit

**Files:** `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (0.1.18 → 0.1.19), `dist/consort.cjs`

- [ ] **Step 1:** Bump all three manifests 0.1.18 → 0.1.19.
- [ ] **Step 2:** Full pre-build gate: `npm run typecheck && npm run test && npm run lint && npx vitest run tests/stale-tokens.test.ts` — all green.
- [ ] **Step 3:** `npm run build`.
- [ ] **Step 4:** Post-build sanity: `npm run typecheck && npx vitest run tests/stale-tokens.test.ts`.
- [ ] **Step 5: Commit:**
```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "release(rehearsal): C1 independent re-implementation inspector (0.1.19)"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** Task 1 = §4.2 (classifyInspect three-way) + §4.3 (inspection.tsv) + §4.4 (inspectInfeasibleReason/parseInspections); Task 2 = §4.1 (run-card fields) + §4.5 (knobs); Task 3 = §5.1/§5.2 (verbs + gates); Task 4 = §4.4 (INFEASIBLE routing); Task 5 = §4.4 (brief tags); Task 6 = §4.4 (finalize fold); Task 7 = §4.1/§5.3 (template + directive); Task 8 = §10 AC#8.
- **Type consistency:** `InspectVerdict`/`classifyInspect`/`inspectInfeasibleReason`/`parseInspections`/`InspectionRow`/`INSPECTION_TSV_HEADER`/`inspectionRow` identical across Tasks 1/3/4/5/6.
- **The degrade-to-inconclusive guarantee:** `classifyInspect` returns `inconclusive` (NOT `mismatch`) on `runFailed`/`no-marker`/`no-reported` — the key divergence from A1's `checkVerify`. Only a confident metric-disagreement or `integrityRefuted` is `not-reproduced`. So the gate (Task 4) never demotes an expensive-to-reproduce honest result.
- **append, not snapshot:** `inspection.tsv` is append-produced by `inspect-check` (`appendInspectionRow`, like A1), NOT written by `scoreWith`. `computeScore` only READS it.
- **The B2 finalize landmine:** Task 6 does BOTH the warnings.txt write AND the `## Warnings` render branch.
- **partProvider/same-family gate (Task 3):** lowest-value gate; if threading `topic` through the dep is awkward, drop the mechanical gate and keep same-family as a directive instruction (Step 3.5b) — flagged inline.
- **Frozen contracts:** `result.json` REQUIRED_FIELDS + `verify`/`integrity` (the new `data_spec`/`metric_formula` are optional), `status` enum, scoreboard schema + integer-rank parse, A1 verification.tsv / A3 sanity.tsv / B1 coverage.tsv / B2 lineage.tsv producers — all untouched. `inspection.tsv`/`inspection.txt`/`c1/` are NEW; the verbs/knobs/flag are additive.
- **Explore-only:** the re-impl writes only under `experiments/<exp>/c1/` (directive-enforced); never the user repo, never `/consort:perform`.
