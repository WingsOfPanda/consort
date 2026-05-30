# consort `rehearsal` — Phase A: Core Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-logic core of `rehearsal` (consort's port of clone-wars `deep-research`) — metric handling, result validation, scoreboard, completion math, consensus, and state/halt parsing — with exhaustive unit tests and zero IPC/tmux/subprocess.

**Architecture:** Six focused `src/core/rehearsal*.ts` modules, each one responsibility, all pure functions (deterministic inputs → outputs; no filesystem, no `Date.now()`, no subprocess). Disk-walking and pane I/O are deferred to Phases B–D, which consume these. Faithful to the clone-wars logic in `lib/deep-research.sh` + `bin/deep-research-score.sh` + `bin/deep-research-consensus.sh`, modernized to TS (typed objects + `JSON.parse`, not shell parsing).

**Tech Stack:** TypeScript (ES2022 / NodeNext / strict), vitest, esbuild. No new dependencies.

**Grounding:** Spec `docs/superpowers/specs/2026-05-30-consort-rehearsal-design.md` §7 (semantic core formats). Behavioral source: `/home/liupan/CC/clone-wars/lib/deep-research.sh` (grep by symbol; cite as `deep-research.sh` in JSDoc — never the literal banned tokens; the stale-token gate scans comments too).

**Conventions:**
- Test file: a single `tests/rehearsal-core.test.ts`; each task appends a `describe(...)` block (mirrors `tests/playback-core.test.ts`). Pure tests need no `freshHome()`.
- Imports use the `.js` extension (NodeNext): `import { x } from "../src/core/rehearsal.js"`.
- After each task: `npm run test`, `npm run typecheck`, `npm run lint` must pass before commit. **Do NOT touch `dist/`** in Phase A (rebuilt in Phase D).
- No banned tokens (`clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_`/`trooper`/`commander`) anywhere in `src/` including comments. Use "part"/"instrument"; cite the prior plugin as `deep-research.sh`/`deep-research-score.sh`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/rehearsal.ts` | `_rehearsal/` art-dir path layout helpers (parts/experiments dirs). |
| `src/core/rehearsalMetric.ts` | `METRIC_VOCAB` + `extractMetric`, `formatMetricBlock`, `parseMetricMd`, `formatSotaBlock`. |
| `src/core/rehearsalResult.ts` | `ResultJson` type, `validateResult`, `renderScoreboardRow`, `buildScoreboard`, `normalizeResult`. |
| `src/core/rehearsalComplete.ts` | `checkCompletion` (floor/target/K-streak/plateau), `checkTimeBudget`. |
| `src/core/rehearsalConsensus.ts` | `buildConsensus` (per-field ε triangulation). |
| `src/core/rehearsalState.ts` | `parseState`/`renderState`/`mergeState`/`reconcileFromOutbox`, `readHaltFlag`. |
| `tests/rehearsal-core.test.ts` | All Phase-A unit tests. |

---

## Task 1: Art-dir path layout (`core/rehearsal.ts`)

**Files:**
- Create: `src/core/rehearsal.ts`
- Test: `tests/rehearsal-core.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/rehearsal-core.test.ts`:

```ts
// tests/rehearsal-core.test.ts — pure logic for /consort:rehearsal (Phase A).
import { describe, it, expect } from "vitest";
import {
  rehearsalArtDir, partsDir, partStateDir, experimentsDir, experimentDir,
} from "../src/core/rehearsal.js";

describe("rehearsal art-dir paths", () => {
  it("layers _rehearsal/parts/<instrument>/experiments/<exp-id>", () => {
    const art = rehearsalArtDir("add-oauth");
    expect(art.endsWith("/_rehearsal")).toBe(true);
    expect(partsDir(art)).toBe(`${art}/parts`);
    expect(partStateDir(art, "oboe")).toBe(`${art}/parts/oboe`);
    expect(experimentsDir(art, "oboe")).toBe(`${art}/parts/oboe/experiments`);
    expect(experimentDir(art, "oboe", "exp-001")).toBe(`${art}/parts/oboe/experiments/exp-001`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `Cannot find module "../src/core/rehearsal.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/rehearsal.ts`:

```ts
import { join } from "node:path";
import { topicDir } from "./paths.js";

/** The rehearsal art/state dir for a topic: <topicDir>/_rehearsal. Mirrors score's _score. */
export function rehearsalArtDir(topic: string): string {
  return join(topicDir(topic), "_rehearsal");
}

/** <artDir>/parts — the per-part state root. */
export function partsDir(artDir: string): string {
  return join(artDir, "parts");
}

/** <artDir>/parts/<instrument> — one persistent part's dir (state.txt, experiments/, outbox.jsonl). */
export function partStateDir(artDir: string, instrument: string): string {
  return join(artDir, "parts", instrument);
}

/** <artDir>/parts/<instrument>/experiments — the part's experiment branches. */
export function experimentsDir(artDir: string, instrument: string): string {
  return join(partStateDir(artDir, instrument), "experiments");
}

/** <artDir>/parts/<instrument>/experiments/<exp-id> — one experiment branch (code/, result.json, …). */
export function experimentDir(artDir: string, instrument: string, expId: string): string {
  return join(experimentsDir(artDir, instrument), expId);
}
```

> Note: if `topicDir`'s signature differs, the implementer should confirm it in `src/core/paths.ts` (it is imported the same way by `src/core/instruments.ts` and `src/core/forensics.ts`) and adapt the import only — the path *shape* (`_rehearsal/parts/<instrument>/experiments/<exp-id>`) is fixed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsal.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): art-dir path layout (Phase A1)"
```

---

## Task 2: Metric heuristic extraction (`core/rehearsalMetric.ts`)

**Files:**
- Create: `src/core/rehearsalMetric.ts`
- Test: `tests/rehearsal-core.test.ts`

Faithful to `deep-research.sh::extract_metric` + the `_METRIC_VOCAB` array: canonical vocabulary, whole-word match (non-word-character borders), first-by-position wins, empty string when none match.

- [ ] **Step 1: Write the failing test** (append to `tests/rehearsal-core.test.ts`)

```ts
import { extractMetric, METRIC_VOCAB } from "../src/core/rehearsalMetric.js";

describe("extractMetric", () => {
  it("returns the earliest-positioned vocab word, whole-word only", () => {
    expect(extractMetric("maximize accuracy under 100k params")).toBe("accuracy");
    expect(extractMetric("minimize loss then improve accuracy")).toBe("loss");
    expect(extractMetric("Reduce LATENCY p99")).toBe("latency"); // case-insensitive
  });
  it("does not match substrings inside larger words", () => {
    expect(extractMetric("inaccuracybenchmark")).toBe(""); // no whole-word hit
    expect(extractMetric("flossing")).toBe("");             // 'loss' is a substring only
  });
  it("returns empty string when no vocab word is present", () => {
    expect(extractMetric("build a faster widget")).toBe("");
    expect(extractMetric("")).toBe("");
  });
  it("exposes the canonical vocabulary", () => {
    expect(METRIC_VOCAB).toContain("accuracy");
    expect(METRIC_VOCAB).toContain("throughput");
    expect(METRIC_VOCAB).toHaveLength(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `Cannot find module "../src/core/rehearsalMetric.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/rehearsalMetric.ts`:

```ts
// Pure metric helpers for /consort:rehearsal. Faithful to deep-research.sh
// (extract_metric, format_metric_block, check_completion's metric.md parse,
// format_sota_block), modernized to typed TS.

/** Canonical metric vocabulary (whole-word, first-by-position wins). */
export const METRIC_VOCAB = [
  "accuracy", "auc", "cost", "f1", "latency", "loss",
  "memory", "params", "precision", "recall", "throughput",
] as const;

/** Heuristic seed: the earliest-positioned whole-word vocab hit in `topic`, lowercased; "" if none. */
export function extractMetric(topic: string): string {
  if (!topic) return "";
  const lower = ` ${topic.toLowerCase()} `;
  let bestPos = Infinity;
  let bestWord = "";
  for (const word of METRIC_VOCAB) {
    // Whole-word: a non-[a-z0-9] border on both sides.
    const re = new RegExp(`[^a-z0-9]${word}[^a-z0-9]`);
    const m = re.exec(lower);
    if (m && m.index < bestPos) {
      bestPos = m.index;
      bestWord = word;
    }
  }
  return bestWord;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalMetric.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): metric heuristic extraction (Phase A2)"
```

---

## Task 3: metric.md format + parse (`core/rehearsalMetric.ts`)

**Files:**
- Modify: `src/core/rehearsalMetric.ts`
- Test: `tests/rehearsal-core.test.ts`

Faithful to `deep-research.sh::format_metric_block` (render) and the metric.md field parse inside `check_completion` (lines parsing `**KEY:** VALUE`). `formatMetricBlock` and `parseMetricMd` must round-trip: parsing the rendered block recovers the thresholds.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { formatMetricBlock, parseMetricMd } from "../src/core/rehearsalMetric.js";

describe("formatMetricBlock", () => {
  it("renders required + defaulted fields", () => {
    const md = formatMetricBlock({
      primary_metric: "accuracy", direction: "maximize",
      min_acceptable: ">= 0.95", target: ">= 0.99",
    });
    expect(md).toContain("**Primary metric:** accuracy");
    expect(md).toContain("**Direction:** maximize");
    expect(md).toContain("**min_acceptable:** >= 0.95");
    expect(md).toContain("**target:** >= 0.99");
    expect(md).toContain("**K_corroboration:** 1");       // default
    expect(md).toContain("**plateau_window:** 5");        // default
    expect(md).toContain("**plateau_threshold:** 0.01");  // default
  });
  it("defaults min_acceptable to (not set) and omits absent optionals", () => {
    const md = formatMetricBlock({ primary_metric: "loss", direction: "minimize" });
    expect(md).toContain("**min_acceptable:** (not set)");
    expect(md).not.toContain("**target:**");
    expect(md).not.toContain("**Hard constraints:**");
  });
  it("throws on missing primary_metric / direction or bad direction", () => {
    expect(() => formatMetricBlock({ direction: "maximize" })).toThrow(/primary_metric/);
    expect(() => formatMetricBlock({ primary_metric: "auc" })).toThrow(/direction/);
    expect(() => formatMetricBlock({ primary_metric: "auc", direction: "sideways" })).toThrow(/maximize/);
  });
});

describe("parseMetricMd round-trips formatMetricBlock", () => {
  it("recovers ops, values, and thresholds", () => {
    const md = formatMetricBlock({
      primary_metric: "accuracy", direction: "maximize",
      min_acceptable: ">= 0.95", target: ">= 0.99",
      K_corroboration: "3", plateau_window: "4", plateau_threshold: "0.005",
    });
    const t = parseMetricMd(md);
    expect(t.primaryMetric).toBe("accuracy");
    expect(t.minOp).toBe(">="); expect(t.minVal).toBe("0.95");
    expect(t.tgtOp).toBe(">="); expect(t.tgtVal).toBe("0.99");
    expect(t.kRequired).toBe(3);
    expect(t.plateauWindow).toBe(4);
    expect(t.plateauThreshold).toBe(0.005);
  });
  it("applies defaults when fields are absent", () => {
    const t = parseMetricMd("**Primary metric:** f1\n**Direction:** maximize\n");
    expect(t.kRequired).toBe(1);
    expect(t.plateauWindow).toBe(5);
    expect(t.plateauThreshold).toBe(0.01);
    expect(t.tgtOp).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `formatMetricBlock is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `src/core/rehearsalMetric.ts`)

```ts
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
  minOp?: string; minVal?: string;
  tgtOp?: string; tgtVal?: string;
  kRequired: number; plateauWindow: number; plateauThreshold: number;
}

/** Parse the thresholds out of a rendered metric.md. `**min_acceptable:** >= 0.95` → op ">=", val "0.95".
 *  Unparseable / "(not set)" values leave op/val as-is (a later numeric compare against them simply fails). */
export function parseMetricMd(text: string): MetricThresholds {
  let primaryMetric = "";
  let minOp: string | undefined, minVal: string | undefined;
  let tgtOp: string | undefined, tgtVal: string | undefined;
  let kRequired = 1, plateauWindow = 5, plateauThreshold = 0.01;
  const opVal = (s: string): [string, string] => {
    const parts = s.trim().split(/\s+/);
    return [parts[0] ?? "", parts.slice(1).join(" ")];
  };
  for (const line of text.split("\n")) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\*\*Primary metric:\*\*\s+(.*)$/))) { primaryMetric = m[1].trim(); }
    else if ((m = line.match(/^\*\*min_acceptable:\*\*\s+(.*)$/))) { [minOp, minVal] = opVal(m[1]); }
    else if ((m = line.match(/^\*\*target:\*\*\s+(.*)$/))) { [tgtOp, tgtVal] = opVal(m[1]); }
    else if ((m = line.match(/^\*\*K_corroboration:\*\*\s+(.*)$/))) { kRequired = parseInt(m[1].trim(), 10) || 1; }
    else if ((m = line.match(/^\*\*plateau_window:\*\*\s+(.*)$/))) { plateauWindow = parseInt(m[1].trim(), 10) || 5; }
    else if ((m = line.match(/^\*\*plateau_threshold:\*\*\s+(.*)$/))) { plateauThreshold = parseFloat(m[1].trim()) || 0.01; }
  }
  return { primaryMetric, minOp, minVal, tgtOp, tgtVal, kRequired, plateauWindow, plateauThreshold };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalMetric.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): metric.md format + parse (Phase A3)"
```

---

## Task 4: SOTA reference block (`core/rehearsalMetric.ts`)

**Files:**
- Modify: `src/core/rehearsalMetric.ts`
- Test: `tests/rehearsal-core.test.ts`

Faithful to `deep-research.sh::format_sota_block`: a `# SOTA reference` header + a 5-col approach-family table from `refs` (`family|best|compliance|source|notes`), capped at 7, with a "no usable references" fallback note when none render. Required: topic, metric, sweep_date.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { formatSotaBlock } from "../src/core/rehearsalMetric.js";

describe("formatSotaBlock", () => {
  it("renders header + a row per ref (cap 7)", () => {
    const refs = Array.from({ length: 9 }, (_, i) =>
      `family${i + 1}|0.9${i}|ok|src${i + 1}|note${i + 1}`);
    const md = formatSotaBlock({ topic: "mnist", metric: "accuracy", sweep_date: "2026-05-30", queries: "q1; q2", refs });
    expect(md).toContain("# SOTA reference — mnist");
    expect(md).toContain("> **Sweep date:** 2026-05-30");
    expect(md).toContain("> **Optimizing for:** accuracy");
    expect(md).toContain("> **Queries fired:** q1; q2");
    expect(md).toContain("| family1 | 0.90 | ok | src1 | note1 |");
    expect(md).toContain("| family7 |");
    expect(md).not.toContain("| family8 |"); // capped at 7
  });
  it("emits the fallback note when no refs render", () => {
    const md = formatSotaBlock({ topic: "x", metric: "loss", sweep_date: "2026-05-30", refs: [] });
    expect(md).toContain("sweep returned no usable references");
  });
  it("throws on missing required keys", () => {
    expect(() => formatSotaBlock({ topic: "", metric: "loss", sweep_date: "d", refs: [] })).toThrow(/topic/);
    expect(() => formatSotaBlock({ topic: "x", metric: "", sweep_date: "d", refs: [] })).toThrow(/metric/);
    expect(() => formatSotaBlock({ topic: "x", metric: "loss", sweep_date: "", refs: [] })).toThrow(/sweep_date/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `formatSotaBlock is not a function`.

- [ ] **Step 3: Write minimal implementation** (append)

```ts
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
```

> Rebrand note: the clone-wars fallback said "trooper-side web search"; ours says "part-side" (the token `trooper` is banned in `src/`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalMetric.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): SOTA reference block (Phase A4)"
```

---

## Task 5: result.json validation (`core/rehearsalResult.ts`)

**Files:**
- Create: `src/core/rehearsalResult.ts`
- Test: `tests/rehearsal-core.test.ts`

Faithful to `deep-research.sh::validate_result_json` (jq path — the strict `iff` semantics the spec mandates) + `validate_result_json_v033` (mandatory metric_name match). Pure: `log_paths` existence is injected via a callback so no filesystem is touched.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { validateResult, type ResultJson } from "../src/core/rehearsalResult.js";

const okResult: ResultJson = {
  branch_id: "b1", approach_label: "cnn", metric_name: "accuracy",
  metric_value: 0.98, status: "ok", runtime_s: 12.5,
  log_paths: ["./stdout.log", "./stderr.log"],
  checkpoint_path: null, notes: "fine",
  self_reported_count: 1, self_reported_ratio: 0.98, self_reported_notes: "",
};

describe("validateResult", () => {
  const allExist = () => true;
  it("accepts a well-formed ok result", () => {
    expect(validateResult(okResult, { logPathExists: allExist })).toEqual({ ok: true });
  });
  it("rejects a missing required field", () => {
    const { approach_label: _omit, ...bad } = okResult;
    expect(validateResult(bad, { logPathExists: allExist })).toMatchObject({ ok: false });
  });
  it("rejects an invalid status enum", () => {
    expect(validateResult({ ...okResult, status: "weird" }, { logPathExists: allExist }))
      .toMatchObject({ ok: false });
  });
  it("enforces metric_value non-null IFF status=ok", () => {
    expect(validateResult({ ...okResult, metric_value: null }, { logPathExists: allExist }))
      .toMatchObject({ ok: false }); // ok + null
    expect(validateResult({ ...okResult, status: "fail", metric_value: 0.5 }, { logPathExists: allExist }))
      .toMatchObject({ ok: false }); // non-ok + non-null
    expect(validateResult({ ...okResult, status: "fail", metric_value: null }, { logPathExists: allExist }))
      .toEqual({ ok: true });       // non-ok + null is valid
  });
  it("rejects a missing log_path on disk", () => {
    const onlyStdout = (p: string) => p === "./stdout.log";
    expect(validateResult(okResult, { logPathExists: onlyStdout })).toMatchObject({ ok: false });
  });
  it("enforces metric_name match when expectedMetric is given", () => {
    expect(validateResult(okResult, { logPathExists: allExist, expectedMetric: "auc" }))
      .toMatchObject({ ok: false });
    expect(validateResult(okResult, { logPathExists: allExist, expectedMetric: "accuracy" }))
      .toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `Cannot find module "../src/core/rehearsalResult.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/rehearsalResult.ts`:

```ts
// Result-contract logic for /consort:rehearsal. Faithful to deep-research.sh
// (validate_result_json{,_v033}, scoreboard_render_row, normalize_result) and
// deep-research-score.sh (scoreboard build + sort). FROZEN wire schema.

export type ResultStatus = "ok" | "fail" | "timeout" | "cost_blown";

/** FROZEN flat schema written by a codex part at the end of an experiment. */
export interface ResultJson {
  branch_id: string;
  approach_label: string;
  metric_name: string;
  metric_value: number | null;
  status: ResultStatus;
  runtime_s: number;
  log_paths: string[];
  checkpoint_path: string | null;
  notes: string;
  self_reported_count?: number;
  self_reported_ratio?: number | null;
  self_reported_notes?: string;
}

const REQUIRED_FIELDS = [
  "branch_id", "approach_label", "metric_name", "metric_value", "status", "runtime_s", "log_paths",
] as const;
const STATUS_ENUM: readonly string[] = ["ok", "fail", "timeout", "cost_blown"];

export interface ValidateOpts {
  /** metric.md primary_metric — when given, the result's metric_name must equal it (v033). */
  expectedMetric?: string;
  /** Existence check for each log_path (injected; pure). Defaults to "exists". */
  logPathExists?: (p: string) => boolean;
}

export type ValidateResult = { ok: true } | { ok: false; error: string };

/** Validate a parsed result.json object. Enforces required fields, status enum,
 *  metric_value non-null IFF status=ok, log_path existence, and (optional) metric_name match. */
export function validateResult(json: unknown, opts: ValidateOpts = {}): ValidateResult {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, error: "malformed JSON" };
  }
  const o = json as Record<string, unknown>;
  for (const f of REQUIRED_FIELDS) {
    if (!(f in o)) return { ok: false, error: `missing required field: ${f}` };
  }
  if (typeof o.status !== "string" || !STATUS_ENUM.includes(o.status)) {
    return { ok: false, error: `invalid status: ${String(o.status)}` };
  }
  const isNull = o.metric_value === null;
  if (o.status === "ok" && isNull) return { ok: false, error: "status=ok requires non-null metric_value" };
  if (o.status !== "ok" && !isNull) return { ok: false, error: `status=${o.status} requires null metric_value` };
  if (!Array.isArray(o.log_paths)) return { ok: false, error: "log_paths must be an array" };
  const exists = opts.logPathExists ?? (() => true);
  for (const p of o.log_paths) {
    if (!exists(String(p))) return { ok: false, error: `log_path missing: ${String(p)}` };
  }
  if (opts.expectedMetric !== undefined && o.metric_name !== opts.expectedMetric) {
    return { ok: false, error: `metric_name '${String(o.metric_name)}' != metric.md primary '${opts.expectedMetric}'` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalResult.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): result.json validation (Phase A5)"
```

---

## Task 6: scoreboard render + sort (`core/rehearsalResult.ts`)

**Files:**
- Modify: `src/core/rehearsalResult.ts`
- Test: `tests/rehearsal-core.test.ts`

Faithful to `deep-research-score.sh` (header `<!-- scoreboard schema_version=2 -->` + 8-col table; OK rows sorted **metric desc → runtime asc → exp-id**; fail/partial grouped below with a continuing rank counter; partial → `~` rank prefix) + `scoreboard_render_row` (metric `%.4f`, runtime `%.2fs`). The `Commander` column is renamed `Instrument` (rebrand; keeps the gate green).

- [ ] **Step 1: Write the failing test** (append)

```ts
import { renderScoreboardRow, buildScoreboard, type ScoreRow } from "../src/core/rehearsalResult.js";

describe("renderScoreboardRow", () => {
  it("formats numeric metric (%.4f) and runtime (%.2fs)", () => {
    expect(renderScoreboardRow("0.985", "12.5", "accuracy", "ok", "cnn"))
      .toBe("0.9850 | ok | 12.50s | cnn | accuracy");
  });
  it("passes non-numeric metric (n/a) through verbatim", () => {
    expect(renderScoreboardRow("n/a", "3", "accuracy", "fail", "mlp"))
      .toBe("n/a | fail | 3.00s | mlp | accuracy");
  });
});

describe("buildScoreboard", () => {
  const rows: ScoreRow[] = [
    { expId: "exp-001", instrument: "oboe",  metric: "0.90", status: "ok",      runtime: "10", approach: "a", metricName: "accuracy" },
    { expId: "exp-002", instrument: "viola", metric: "0.95", status: "ok",      runtime: "20", approach: "b", metricName: "accuracy" },
    { expId: "exp-003", instrument: "oboe",  metric: "0.95", status: "ok",      runtime: "5",  approach: "c", metricName: "accuracy" },
    { expId: "exp-004", instrument: "viola", metric: "",     status: "fail",    runtime: "2",  approach: "d", metricName: "accuracy" },
    { expId: "exp-005", instrument: "oboe",  metric: "",     status: "partial", runtime: "1",  approach: "e", metricName: "accuracy" },
  ];
  it("orders ok rows metric-desc, then runtime-asc, then exp-id; ranks continue into fails", () => {
    const sb = buildScoreboard(rows);
    const lines = sb.split("\n").filter((l) => /^\| /.test(l) && !/Rank|---/.test(l));
    // exp-003 (0.95,5s) and exp-002 (0.95,20s) tie on metric -> runtime asc puts exp-003 first.
    expect(lines[0]).toContain("| 1 | exp-003 | oboe |");
    expect(lines[1]).toContain("| 2 | exp-002 | viola |");
    expect(lines[2]).toContain("| 3 | exp-001 | oboe |");
    // fails sorted by exp-id; partial gets ~ prefix; rank counter continues.
    expect(lines[3]).toContain("| 4 | exp-004 | viola |");   // plain fail
    expect(lines[4]).toContain("| ~5 | exp-005 | oboe |");   // partial
    expect(lines[3]).toContain("n/a | fail");
  });
  it("emits the schema header and 8-column table", () => {
    const sb = buildScoreboard(rows);
    expect(sb).toContain("<!-- scoreboard schema_version=2 -->");
    expect(sb).toContain("| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `renderScoreboardRow is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `src/core/rehearsalResult.ts`)

```ts
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Render the value-bearing tail of one scoreboard row:
 *  "<metric%.4f|verbatim> | <status> | <runtime%.2fs|verbatim> | <approach> | <metric_name>". */
export function renderScoreboardRow(
  metric: string, runtime: string, metricName: string, status: string, approach: string,
): string {
  const metricFmt = NUM_RE.test(metric) ? parseFloat(metric).toFixed(4) : metric;
  const runtimeFmt = NUM_RE.test(runtime) ? `${parseFloat(runtime).toFixed(2)}s` : runtime;
  return `${metricFmt} | ${status} | ${runtimeFmt} | ${approach} | ${metricName}`;
}

export interface ScoreRow {
  expId: string; instrument: string; metric: string;
  status: string; runtime: string; approach: string; metricName: string;
}

function expNum(expId: string): number {
  const n = parseInt(expId.replace(/^exp-/, ""), 10);
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
}

/** Build the full scoreboard.md. OK rows sorted metric-desc / runtime-asc / exp-id;
 *  fail+partial grouped below sorted by exp-id; rank counter continuous; partial → ~ rank. */
export function buildScoreboard(rows: ScoreRow[]): string {
  const ok = rows.filter((r) => r.status === "ok");
  const fail = rows.filter((r) => r.status !== "ok");
  ok.sort((a, b) =>
    (parseFloat(b.metric) - parseFloat(a.metric)) ||
    (parseFloat(a.runtime) - parseFloat(b.runtime)) ||
    (expNum(a.expId) - expNum(b.expId)));
  fail.sort((a, b) => expNum(a.expId) - expNum(b.expId));

  const lines: string[] = [
    "<!-- scoreboard schema_version=2 -->",
    "# Scoreboard",
    "",
    "| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |",
    "|---|---|---|---|---|---|---|---|",
  ];
  let rank = 1;
  for (const r of ok) {
    lines.push(`| ${rank} | ${r.expId} | ${r.instrument} | ${renderScoreboardRow(r.metric, r.runtime, r.metricName, r.status, r.approach)} |`);
    rank++;
  }
  for (const r of fail) {
    const rankCell = r.status === "partial" ? `~${rank}` : `${rank}`;
    lines.push(`| ${rankCell} | ${r.expId} | ${r.instrument} | ${renderScoreboardRow("n/a", r.runtime, r.metricName, r.status, r.approach)} |`);
    rank++;
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalResult.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): scoreboard render + sort (Phase A6)"
```

---

## Task 7: result normalization (`core/rehearsalResult.ts`)

**Files:**
- Modify: `src/core/rehearsalResult.ts`
- Test: `tests/rehearsal-core.test.ts`

Faithful to `deep-research.sh::normalize_result`: `ok` + null metric → `partial`; `fail` + non-null `self_reported_ratio` → `partial` (and promote the ratio into `metric_value` if it was null). All other cases unchanged. Pure (operates on one parsed object, returns a new one).

- [ ] **Step 1: Write the failing test** (append)

```ts
import { normalizeResult } from "../src/core/rehearsalResult.js";

describe("normalizeResult", () => {
  const base = {
    branch_id: "b", approach_label: "a", metric_name: "accuracy",
    runtime_s: 1, log_paths: [], checkpoint_path: null, notes: "",
  };
  it("ok + null metric -> partial", () => {
    const out = normalizeResult({ ...base, status: "ok", metric_value: null });
    expect(out.status).toBe("partial");
  });
  it("fail + self_reported_ratio -> partial, promotes ratio into null metric_value", () => {
    const out = normalizeResult({ ...base, status: "fail", metric_value: null, self_reported_ratio: 0.42 });
    expect(out.status).toBe("partial");
    expect(out.metric_value).toBe(0.42);
  });
  it("fail + ratio keeps an existing metric_value", () => {
    const out = normalizeResult({ ...base, status: "fail", metric_value: null, self_reported_ratio: 0.42 });
    expect(out.metric_value).toBe(0.42);
    const out2 = normalizeResult({ ...base, status: "timeout", metric_value: null, self_reported_ratio: 0.9 });
    expect(out2.status).toBe("timeout"); // only fail (not timeout) is promoted
  });
  it("leaves a clean ok result unchanged", () => {
    const r = { ...base, status: "ok" as const, metric_value: 0.99 };
    expect(normalizeResult(r)).toEqual(r);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `normalizeResult is not a function`.

- [ ] **Step 3: Write minimal implementation** (append)

```ts
export type NormalizedStatus = ResultStatus | "partial";
export type NormalizedResult = Omit<ResultJson, "status"> & { status: NormalizedStatus };

/** Normalize one result: ok+null→partial; fail+non-null self_reported_ratio→partial (promoting
 *  the ratio into metric_value when it was null). Everything else passes through unchanged. */
export function normalizeResult(json: ResultJson): NormalizedResult {
  const { status, metric_value: mv, self_reported_ratio: srr } = json;
  if (status === "ok" && (mv === null || mv === undefined)) {
    return { ...json, status: "partial" };
  }
  if (status === "fail" && srr !== undefined && srr !== null) {
    const out: NormalizedResult = { ...json, status: "partial" };
    if (mv === null || mv === undefined) out.metric_value = srr;
    return out;
  }
  return json;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalResult.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): result normalization (Phase A7)"
```

---

## Task 8: completion math (`core/rehearsalComplete.ts`)

**Files:**
- Create: `src/core/rehearsalComplete.ts`
- Test: `tests/rehearsal-core.test.ts`

Faithful to `deep-research.sh::check_completion` (the single trickiest helper). Emits `{floorMet, targetMet, kSoFar, kRequired, plateau}` from a rendered scoreboard + a metric.md. The three signals:
- **floor/target:** any ok-row metric satisfying the parsed op/value compare.
- **K_so_far:** the longest streak of consecutive, strictly-improving, *at-target* experiments by a single part. Walk rows sorted by `(instrument, exp-id)`; a non-ok row, a non-improving row (Δ≤0), or a not-at-target row breaks the chain. Capped at `kRequired`.
- **plateau:** the last `plateau_window` ok-row metrics (in scoreboard order, i.e. metric-desc) have `max − min < plateau_threshold`.

> Important parsing detail: the K-streak walk considers **all** plain-rank data rows (ok + fail/timeout/cost_blown) so a mid-chain failure breaks the streak — but `~`-prefixed partial rows are excluded (they don't match the `| <int> | exp-…` row regex). The floor/target/plateau set uses only `status=ok` rows with a numeric metric.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { checkCompletion } from "../src/core/rehearsalComplete.js";
import { formatMetricBlock } from "../src/core/rehearsalMetric.js";
import { buildScoreboard, type ScoreRow } from "../src/core/rehearsalResult.js";

const metricMd = formatMetricBlock({
  primary_metric: "accuracy", direction: "maximize",
  min_acceptable: ">= 0.90", target: ">= 0.95",
  K_corroboration: "2", plateau_window: "3", plateau_threshold: "0.01",
});

function row(expId: string, instrument: string, metric: string, status = "ok", runtime = "1"): ScoreRow {
  return { expId, instrument, metric, status, runtime, approach: "a", metricName: "accuracy" };
}

describe("checkCompletion", () => {
  it("reports floor + target met", () => {
    const sb = buildScoreboard([row("exp-001", "oboe", "0.92"), row("exp-002", "oboe", "0.96")]);
    const c = checkCompletion(sb, metricMd);
    expect(c.floorMet).toBe(true);
    expect(c.targetMet).toBe(true);
    expect(c.kRequired).toBe(2);
  });
  it("does not meet floor when all metrics are below min_acceptable", () => {
    const sb = buildScoreboard([row("exp-001", "oboe", "0.80"), row("exp-002", "oboe", "0.85")]);
    expect(checkCompletion(sb, metricMd).floorMet).toBe(false);
  });
  it("counts a per-part strictly-improving at-target streak", () => {
    // oboe: 0.95, 0.96, 0.97 (all >= target, strictly improving) -> chain 3, capped at K=2.
    const sb = buildScoreboard([
      row("exp-001", "oboe", "0.95"), row("exp-002", "oboe", "0.96"), row("exp-003", "oboe", "0.97"),
    ]);
    expect(checkCompletion(sb, metricMd).kSoFar).toBe(2);
  });
  it("a non-improving (plateau) result breaks the streak", () => {
    const sb = buildScoreboard([
      row("exp-001", "oboe", "0.95"), row("exp-002", "oboe", "0.95"), row("exp-003", "oboe", "0.96"),
    ]);
    // chains: [0.95] (Δ=0 breaks) then [0.96] -> longest = 1.
    expect(checkCompletion(sb, metricMd).kSoFar).toBe(1);
  });
  it("a mid-chain fail breaks the streak", () => {
    const sb = buildScoreboard([
      row("exp-001", "oboe", "0.95"), row("exp-002", "oboe", "", "fail"), row("exp-003", "oboe", "0.96"),
    ]);
    expect(checkCompletion(sb, metricMd).kSoFar).toBe(1);
  });
  it("flags plateau when the last window of ok metrics is tight", () => {
    const sb = buildScoreboard([
      row("exp-001", "oboe", "0.951"), row("exp-002", "oboe", "0.952"), row("exp-003", "oboe", "0.953"),
    ]);
    // 3 ok rows, spread 0.002 < 0.01 -> plateau.
    expect(checkCompletion(sb, metricMd).plateau).toBe(true);
  });
  it("no plateau when fewer than plateau_window ok rows", () => {
    const sb = buildScoreboard([row("exp-001", "oboe", "0.951"), row("exp-002", "oboe", "0.952")]);
    expect(checkCompletion(sb, metricMd).plateau).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `Cannot find module "../src/core/rehearsalComplete.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/rehearsalComplete.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalComplete.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): completion math (Phase A8)"
```

---

## Task 9: time-budget check (`core/rehearsalComplete.ts`)

**Files:**
- Modify: `src/core/rehearsalComplete.ts`
- Test: `tests/rehearsal-core.test.ts`

Faithful to `deep-research.sh::check_time_budget`: `none` → never elapsed (false); otherwise `(now − start) >= budget`. `now` is passed in (epoch seconds) so the function stays pure. Throws on a malformed budget or unparseable start.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { checkTimeBudget } from "../src/core/rehearsalComplete.js";

describe("checkTimeBudget", () => {
  const start = "2026-05-30T00:00:00Z";
  const startEpoch = Math.floor(Date.parse(start) / 1000);
  it("returns false for budget 'none'", () => {
    expect(checkTimeBudget("none", start, startEpoch + 999_999)).toBe(false);
  });
  it("true once elapsed >= budget, false before", () => {
    expect(checkTimeBudget("3600", start, startEpoch + 3599)).toBe(false);
    expect(checkTimeBudget("3600", start, startEpoch + 3600)).toBe(true);
  });
  it("tolerates surrounding whitespace", () => {
    expect(checkTimeBudget("  3600 ", " 2026-05-30T00:00:00Z ", startEpoch + 3600)).toBe(true);
  });
  it("throws on malformed budget or unparseable start", () => {
    expect(() => checkTimeBudget("-5", start, startEpoch)).toThrow();
    expect(() => checkTimeBudget("abc", start, startEpoch)).toThrow();
    expect(() => checkTimeBudget("3600", "not-a-date", startEpoch)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `checkTimeBudget is not a function`.

- [ ] **Step 3: Write minimal implementation** (append)

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalComplete.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): time-budget check (Phase A9)"
```

---

## Task 10: consensus (`core/rehearsalConsensus.ts`)

**Files:**
- Create: `src/core/rehearsalConsensus.ts`
- Test: `tests/rehearsal-core.test.ts`

Faithful to `deep-research-consensus.sh`: per-field agreement across each part's already-collected latest-ok result, over `branch_id approach_label metric_name metric_value status runtime_s notes`. A field is **Agreed** if every part has a present value AND all values match (numeric `metric_value` uses ε); **All-missing** if every part lacks it; **Contested** otherwise (disagreement OR any part missing). The disk walk that finds each part's latest-ok result is impure and lives in Phase C — this is the pure renderer.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { buildConsensus } from "../src/core/rehearsalConsensus.js";

describe("buildConsensus", () => {
  const nowIso = "2026-05-30T12:00:00Z";
  it("agrees on identical fields and ε-close metric_value; contests divergence", () => {
    const md = buildConsensus({
      oboe:  { branch_id: "b", approach_label: "cnn", metric_name: "accuracy", metric_value: 0.980, status: "ok", runtime_s: 10, notes: "n" },
      viola: { branch_id: "b", approach_label: "mlp", metric_name: "accuracy", metric_value: 0.985, status: "ok", runtime_s: 12, notes: "n" },
    }, { topic: "mnist", nowIso, epsilon: 0.01 });
    expect(md).toContain("## Agreed");
    expect(md).toContain("| metric_name | accuracy | oboe, viola |");
    expect(md).toContain("| metric_value | 0.98 | oboe, viola |"); // 0.980 vs 0.985 within ε
    expect(md).toContain("## Contested");
    expect(md).toMatch(/\| approach_label \| cnn \| mlp \|/);       // diverge -> contested
  });
  it("buckets a field missing from every part as All-missing", () => {
    const md = buildConsensus({
      oboe:  { metric_name: "accuracy", metric_value: 0.9, status: "ok" },
      viola: { metric_name: "accuracy", metric_value: 0.9, status: "ok" },
    }, { topic: "t", nowIso });
    expect(md).toContain("## All-missing");
    expect(md).toContain("- notes");
    expect(md).toContain("- branch_id");
  });
  it("contests a field present in some parts but missing in others", () => {
    const md = buildConsensus({
      oboe:  { notes: "had a note", metric_name: "accuracy", metric_value: 0.9, status: "ok" },
      viola: { metric_name: "accuracy", metric_value: 0.9, status: "ok" },
    }, { topic: "t", nowIso });
    // notes present in oboe, missing in viola -> contested (— for the missing cell), not All-missing.
    expect(md).toMatch(/\| notes \| had a note \| — \|/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `Cannot find module "../src/core/rehearsalConsensus.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/rehearsalConsensus.ts`:

```ts
// Per-field consensus across parts' latest-ok results. Faithful to
// deep-research-consensus.sh. Pure renderer — the caller supplies the
// already-collected latest-ok field maps (the disk walk lives in the CLI).

const FIELDS = ["branch_id", "approach_label", "metric_name", "metric_value", "status", "runtime_s", "notes"] as const;
const NUMERIC = /^-?[0-9.eE+-]+$/;

export interface ConsensusOpts { topic: string; nowIso: string; epsilon?: number; }

/** latestOk: instrument -> field map (its latest ok result.json fields). */
export function buildConsensus(latestOk: Record<string, Record<string, unknown>>, opts: ConsensusOpts): string {
  const epsilon = opts.epsilon ?? 0.01;
  const instruments = Object.keys(latestOk).sort();
  const field = (inst: string, k: string): string => {
    const v = latestOk[inst]?.[k];
    return v === undefined || v === null ? "" : String(v);
  };
  const numEq = (a: string, b: string) => Math.abs(parseFloat(a) - parseFloat(b)) <= epsilon;

  const agreed: string[] = [];
  const contested: string[] = [];
  const missing: string[] = [];

  for (const f of FIELDS) {
    const present: string[] = [];
    const srcs: string[] = [];
    let miss = 0;
    for (const inst of instruments) {
      const v = field(inst, f);
      if (v === "") miss++; else { present.push(v); srcs.push(inst); }
    }
    if (miss === instruments.length) { missing.push(`- ${f}`); continue; }

    let allAgree = true;
    const first = present[0];
    const firstNumeric = NUMERIC.test(first);
    for (const v of present.slice(1)) {
      if (firstNumeric && NUMERIC.test(v)) { if (!numEq(first, v)) { allAgree = false; break; } }
      else if (v !== first) { allAgree = false; break; }
    }
    if (miss > 0) allAgree = false;

    if (allAgree) {
      agreed.push(`| ${f} | ${first} | ${srcs.join(", ")} |`);
    } else {
      let row = `| ${f}`;
      for (const inst of instruments) row += ` | ${field(inst, f) || "—"}`;
      contested.push(`${row} |`);
    }
  }

  const out: string[] = [
    `# Consensus — ${opts.topic}`, "",
    `Generated: ${opts.nowIso}`,
    `Epsilon for metric_value: ${epsilon}`, "",
    "## Agreed", "",
  ];
  if (agreed.length) out.push("| Field | Value | Proposed by |", "|---|---|---|", ...agreed);
  else out.push("_(none)_");
  out.push("", "## Contested", "");
  if (contested.length) {
    let header = "| Field", sep = "|---";
    for (const inst of instruments) { header += ` | ${inst}'s value`; sep += "|---"; }
    out.push(`${header} |`, `${sep}|`, ...contested);
  } else out.push("_(none)_");
  out.push("", "## All-missing", "");
  if (missing.length) out.push(...missing);
  else out.push("_(none)_");
  return out.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalConsensus.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): per-field consensus (Phase A10)"
```

---

## Task 11: state + halt parsing (`core/rehearsalState.ts`)

**Files:**
- Create: `src/core/rehearsalState.ts`
- Test: `tests/rehearsal-core.test.ts`

Faithful to `deep-research.sh` state helpers (`trooper_state_read`/`_write` KV with `\n`-escaping, `trooper_state_reconcile`) + `halt_flag_read`. `mergeState` preserves untouched keys and overwrites touched ones. `reconcileFromOutbox` replays an outbox tail: a terminal `error` → `failed` (error wins over done); a terminal `done` with the result present → `idle`; otherwise no write (null). `readHaltFlag` detects structured (first non-blank line `halted_by=`) vs prose vs missing.

- [ ] **Step 1: Write the failing test** (append)

```ts
import {
  parseState, renderState, mergeState, reconcileFromOutbox, readHaltFlag,
} from "../src/core/rehearsalState.js";

describe("state KV round-trip", () => {
  it("parses and renders KV, preserving '=' in values and escaping newlines", () => {
    const txt = renderState({ phase: "working", current_exp_id: "exp-003", note: "a=b\nsecond" });
    expect(txt).toContain("phase=working");
    expect(txt).toContain("note=a=b\\nsecond"); // newline escaped to literal \n
    const kv = parseState(txt);
    expect(kv.phase).toBe("working");
    expect(kv.note).toBe("a=b\nsecond");        // round-trips back to a real newline
  });
});

describe("mergeState", () => {
  it("overwrites touched keys, keeps the rest", () => {
    const existing = renderState({ exp_counter: "2", phase: "working", current_exp_id: "exp-002" });
    const merged = parseState(mergeState(existing, { phase: "idle" }));
    expect(merged.phase).toBe("idle");
    expect(merged.exp_counter).toBe("2");
    expect(merged.current_exp_id).toBe("exp-002");
  });
  it("creates fresh state when none exists", () => {
    const merged = parseState(mergeState(null, { phase: "idle", exp_counter: "0" }));
    expect(merged.phase).toBe("idle");
  });
});

describe("reconcileFromOutbox", () => {
  it("error anywhere in the tail wins -> failed", () => {
    const tail = '{"event":"done","ts":"t"}\n{"event":"error","ts":"t"}';
    expect(reconcileFromOutbox(tail, true)).toBe("failed");
  });
  it("terminal done with result present -> idle", () => {
    expect(reconcileFromOutbox('{"event":"progress"}\n{"event":"done"}', true)).toBe("idle");
  });
  it("done without result present -> no write", () => {
    expect(reconcileFromOutbox('{"event":"done"}', false)).toBeNull();
  });
  it("no terminal event -> no write", () => {
    expect(reconcileFromOutbox('{"event":"progress"}\n{"event":"heartbeat"}', true)).toBeNull();
  });
});

describe("readHaltFlag", () => {
  it("missing on null / empty", () => {
    expect(readHaltFlag(null).format).toBe("missing");
    expect(readHaltFlag("   ").format).toBe("missing");
  });
  it("structured when the first non-blank line is halted_by=", () => {
    const h = readHaltFlag("halted_by=maestro\nhalted_at=t\nreason=target met\ntarget_met=yes");
    expect(h.format).toBe("structured");
    expect(h.fields?.halted_by).toBe("maestro");
    expect(h.fields?.target_met).toBe("yes");
  });
  it("prose otherwise, collapsing newlines into the reason", () => {
    const h = readHaltFlag("stopped because\nthe user said so");
    expect(h.format).toBe("prose");
    expect(h.reason).toBe("stopped because the user said so");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- rehearsal-core`
Expected: FAIL — `Cannot find module "../src/core/rehearsalState.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/rehearsalState.ts`:

```ts
// Per-part state.txt + halt.flag parsing for /consort:rehearsal. Faithful to
// deep-research.sh (state_read/_write/_reconcile, halt_flag_read). Pure;
// disk reads/writes happen in the CLI (Phases C/D). JSON.parse, not shell.

/** Parse state.txt KV (first '=' splits; literal \n unescaped back to newlines). */
export function parseState(text: string): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const line of text.split("\n")) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    kv[line.slice(0, eq)] = line.slice(eq + 1).replace(/\\n/g, "\n");
  }
  return kv;
}

/** Render KV to state.txt text (newlines escaped to literal \n; one record per line). */
export function renderState(kv: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(kv)) {
    if (!k) continue;
    lines.push(`${k}=${v.replace(/\n/g, "\\n")}`);
  }
  return lines.join("\n") + "\n";
}

/** Merge updates over existing state (or fresh when null), overwriting touched keys. */
export function mergeState(existing: string | null, updates: Record<string, string>): string {
  const kv = existing ? parseState(existing) : {};
  for (const [k, v] of Object.entries(updates)) if (k) kv[k] = v;
  return renderState(kv);
}

/** Replay an outbox tail to a terminal phase: error wins -> "failed"; a done with the
 *  result.json present -> "idle"; otherwise null (no write). */
export function reconcileFromOutbox(outboxTail: string, doneResultExists: boolean): "failed" | "idle" | null {
  let sawDone = false, sawError = false;
  for (const line of outboxTail.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as { event?: string };
      if (o.event === "done") sawDone = true;
      else if (o.event === "error") sawError = true;
    } catch { /* skip non-JSON */ }
  }
  if (sawError) return "failed";
  if (sawDone) return doneResultExists ? "idle" : null;
  return null;
}

export interface HaltFlag {
  format: "structured" | "prose" | "missing";
  fields?: Record<string, string>;
  reason?: string;
}

/** Parse halt.flag: structured (first non-blank line halted_by=), prose, or missing. */
export function readHaltFlag(body: string | null): HaltFlag {
  if (body === null || body.trim() === "") return { format: "missing" };
  const firstLine = body.split("\n").find((l) => l.trim() !== "") ?? "";
  if (firstLine.startsWith("halted_by=")) {
    const fields: Record<string, string> = {};
    for (const line of body.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) fields[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return { format: "structured", fields };
  }
  return { format: "prose", reason: body.split("\n").join(" ").replace(/\s+$/, "") };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- rehearsal-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalState.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): state + halt parsing (Phase A11)"
```

---

## Phase A completion gate

After Task 11, run the full suite and static checks:

```bash
npm run test          # all rehearsal-core tests green + prior suite unaffected
npm run typecheck     # 0 errors
npm run lint          # clean (no-unused-vars etc.)
npm run test -- stale-tokens   # gate green (no banned tokens in src/)
```

Expected: all green. Phase A delivers the complete pure-semantic core; Phases B–D wire it to init/spawn, the experiment loop, and the finalize/teardown/handoff tail.

---

## Self-Review (against spec §7)

- **result.json schema + validation** → Task 5 (`validateResult`, iff semantics + metric_name match). ✓
- **scoreboard render/sort + results.tsv** → Task 6 (`buildScoreboard`, metric-desc/runtime-asc/exp-id, `~` partial). *(`results.tsv` emission is a CLI concern — Phase C `score` verb; the row TYPES are fixed here.)* ✓
- **check_completion floor/target/K-streak/plateau** → Task 8. ✓
- **consensus per-field ε** → Task 10. ✓
- **state.txt KV + reconcile** → Task 11 (`parseState`/`renderState`/`mergeState`/`reconcileFromOutbox`). ✓
- **structured halt.flag (+ legacy prose)** → Task 11 (`readHaltFlag`). ✓
- **metric heuristic + metric.md format/parse + SOTA block** → Tasks 2–4. ✓
- **normalize_result** → Task 7. ✓
- **time-budget** → Task 9. ✓
- **art-dir path layout** → Task 1. ✓

Type consistency: `ScoreRow` (Task 6) is consumed by Task 8's tests via `buildScoreboard`; `ResultJson` (Task 5) feeds `normalizeResult` (Task 7); `parseMetricMd` (Task 3) feeds `checkCompletion` (Task 8). All names align.

No placeholders. Every code step shows complete code.
