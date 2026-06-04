# Rehearsal B1 — Coverage & Diversity Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approach-family coverage mechanical for `/consort:rehearsal` — a per-family tally surfaced in the status brief, and an approach-aware plateau that won't declare a plateau-stop while exploration is collapsed onto too few families or any family is still improving.

**Architecture:** Reuse the proven A3 score-pass + tsv arc. A new pure `rehearsalCoverage` module owns the one family-canonicalization rule (`normalizeFamily`) and the tally; `computeScore` emits `coverageRows`; `scoreWith` writes a `coverage.tsv` snapshot; `checkCompletion` un-drops the approach and adds a strictly-additive plateau term; `status-brief` renders a `Coverage:` line. All additive — no frozen wire token, scoreboard schema, or status enum touched.

**Tech Stack:** TypeScript (Node/ESM, `.js` import specifiers), vitest, esbuild single-bundle (`dist/consort.cjs`). Pure core modules with injected FS; tmux/FS untouched here.

**Spec:** `docs/superpowers/specs/2026-06-04-rehearsal-b1-coverage-diversity-design.md`

**Standing rules for every task:**
- Run `npm run typecheck` (authoritative) — ignore stale-LSP phantom diagnostics.
- Do NOT run `npm run build` — the release task (Task 8) rebuilds `dist`.
- Never weaken `tests/stale-tokens.test.ts`; no banned tokens (`clone-wars`, `cw_`, `master-yoda`, `MISSION ACCOMPLISHED`, `@cw_`) in shipped `src`/`config`/`commands`. No emojis in shipped output. Errors to stderr.
- Pure modules: no `Date.now()`/`Math.random()`; time is injected via `now()`.

---

### Task 1: New pure core module `rehearsalCoverage.ts`

**Files:**
- Create: `src/core/rehearsalCoverage.ts`
- Test: `tests/rehearsal-coverage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/rehearsal-coverage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeFamily, tallyCoverage, coverageRow, COVERAGE_TSV_HEADER } from "../src/core/rehearsalCoverage.js";

describe("normalizeFamily", () => {
  it("lowercases, trims, and collapses surrounding whitespace/punctuation", () => {
    expect(normalizeFamily("SGD")).toBe("sgd");
    expect(normalizeFamily("  sgd  ")).toBe("sgd");
    expect(normalizeFamily("SGD-baseline")).toBe("sgd-baseline");
    expect(normalizeFamily("(single pass)")).toBe("single pass");
    expect(normalizeFamily("typed   routing")).toBe("typed routing");
  });
  it("keeps internal-punctuation variants distinct (Maestro intent)", () => {
    expect(normalizeFamily("single-pass")).not.toBe(normalizeFamily("single pass"));
  });
  it("returns empty string for blank/punctuation-only labels", () => {
    expect(normalizeFamily("   ")).toBe("");
    expect(normalizeFamily("--")).toBe("");
  });
});

describe("tallyCoverage", () => {
  const rows = (xs: [string, string, string?][]) =>
    xs.map(([approach, metric]) => ({ approach, metric }));

  it("groups by normalized family and counts, direction-aware best (maximize default)", () => {
    const out = tallyCoverage(rows([
      ["single-pass", "0.90"], ["Single-Pass", "0.96"], ["typed-routing", "0.94"],
    ]));
    expect(out).toEqual([
      { family: "single-pass", count: 2, best: "0.96", ts: "" },
      { family: "typed-routing", count: 1, best: "0.94", ts: "" },
    ]);
  });
  it("uses min for minimize direction", () => {
    const out = tallyCoverage(rows([["a", "0.20"], ["a", "0.08"]]), "minimize");
    expect(out[0]).toEqual({ family: "a", count: 2, best: "0.08", ts: "" });
  });
  it("buckets blank labels as (unlabeled) and counts non-numeric metrics without affecting best", () => {
    const out = tallyCoverage(rows([["", "0.5"], ["", "n/a"]]));
    expect(out[0]).toEqual({ family: "(unlabeled)", count: 2, best: "0.5", ts: "" });
  });
  it("sorts by count desc then family asc", () => {
    const out = tallyCoverage(rows([["b", "0.1"], ["a", "0.1"], ["a", "0.2"]]));
    expect(out.map((r) => r.family)).toEqual(["a", "b"]);
  });
});

describe("coverageRow + header", () => {
  it("emits a tab-joined row with trailing newline", () => {
    expect(COVERAGE_TSV_HEADER).toBe("family\tcount\tbest\tts\n");
    expect(coverageRow({ family: "single-pass", count: 4, best: "0.96", ts: "2026-06-04T10:00:00Z" }))
      .toBe("single-pass\t4\t0.96\t2026-06-04T10:00:00Z\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rehearsal-coverage.test.ts`
Expected: FAIL — cannot find module `../src/core/rehearsalCoverage.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/core/rehearsalCoverage.ts`:

```ts
// Per-family coverage tally for /consort:rehearsal (B1 coverage & diversity guard).
// Pure: no FS, no clock. normalizeFamily is the SINGLE family-canonicalization rule,
// shared with checkCompletion's approach-aware plateau so the tally and the plateau
// bucket experiments identically.

export interface CoverageRow {
  family: string;
  count: number;
  best: string;
  ts: string;
}

export const COVERAGE_TSV_HEADER = "family\tcount\tbest\tts\n";

const NUM = /^[0-9.]+$/;

/** Canonical family key: lowercase -> trim -> collapse internal whitespace -> strip
 *  surrounding punctuation. Blank/punctuation-only -> "". Shared by tallyCoverage and
 *  checkCompletion's plateau. Internal punctuation is preserved (Maestro intent). */
export function normalizeFamily(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

/** One coverage.tsv row (tab-joined + newline). */
export function coverageRow(r: CoverageRow): string {
  return `${r.family}\t${r.count}\t${r.best}\t${r.ts}\n`;
}

/** Per-family aggregate over ok experiments. Direction-aware best (max for maximize/
 *  default, min for minimize). Sorted by count desc then family asc. ts left "" — the
 *  caller (computeScore) stamps it, keeping this pure/time-free for tests. */
export function tallyCoverage(
  rows: { approach: string; metric: string }[],
  direction?: "maximize" | "minimize",
): CoverageRow[] {
  const minimize = direction === "minimize";
  const acc = new Map<string, { count: number; best: number | null }>();
  for (const r of rows) {
    const norm = normalizeFamily(r.approach);
    const fam = norm === "" ? "(unlabeled)" : norm;
    const e = acc.get(fam) ?? { count: 0, best: null };
    e.count += 1;
    if (NUM.test(r.metric)) {
      const v = parseFloat(r.metric);
      e.best = e.best === null ? v : (minimize ? Math.min(e.best, v) : Math.max(e.best, v));
    }
    acc.set(fam, e);
  }
  const out: CoverageRow[] = [];
  for (const [family, e] of acc) {
    out.push({ family, count: e.count, best: e.best === null ? "" : String(e.best), ts: "" });
  }
  out.sort((a, b) => (b.count - a.count) || (a.family < b.family ? -1 : a.family > b.family ? 1 : 0));
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rehearsal-coverage.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalCoverage.ts tests/rehearsal-coverage.test.ts
git commit -m "feat(rehearsal): B1 rehearsalCoverage core (normalizeFamily + tallyCoverage)"
```

---

### Task 2: `metric.md` `min_families` knob (parse-only)

**Files:**
- Modify: `src/core/rehearsalMetric.ts` (`MetricThresholds` ~62-77, `parseMetricMd` ~81-109)
- Test: `tests/rehearsal-core.test.ts` (add to the existing metric describe block)

- [ ] **Step 1: Write the failing test**

Add to `tests/rehearsal-core.test.ts` (near the other `parseMetricMd` assertions — search for `parseMetricMd` usages; if no dedicated describe exists, append this block at the end of the file):

```ts
import { parseMetricMd as parseMetricMdB1, formatMetricBlock as formatMetricBlockB1 } from "../src/core/rehearsalMetric.js";

describe("metric.md min_families (B1)", () => {
  it("defaults to 2 when absent", () => {
    expect(parseMetricMdB1("**Primary metric:** accuracy\n").minFamilies).toBe(2);
  });
  it("parses an explicit value", () => {
    expect(parseMetricMdB1("**min_families:** 3\n").minFamilies).toBe(3);
  });
  it("clamps values below 1 to 1", () => {
    expect(parseMetricMdB1("**min_families:** 0\n").minFamilies).toBe(1);
  });
  it("is parse-only: formatMetricBlock does NOT emit a min_families line", () => {
    const md = formatMetricBlockB1({ primary_metric: "accuracy", direction: "maximize" });
    expect(md).not.toContain("min_families");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rehearsal-core.test.ts -t "min_families"`
Expected: FAIL — `minFamilies` is `undefined` (property not yet on `MetricThresholds`).

- [ ] **Step 3: Write minimal implementation**

In `src/core/rehearsalMetric.ts`:

(a) Add to the `MetricThresholds` interface, right after the `maxDebugAttempts?` field (~line 73):
```ts
  /** optional metric.md `**min_families:**` for B1 coverage floor; parsed with default 2 (>= 1). */
  minFamilies: number;
```

(b) In `parseMetricMd`, add a default near the other defaults (~line 86, beside `kRequired`):
```ts
  let minFamilies = 2;
```

(c) Add a parse branch in the `for` loop, after the `max_debug_attempts` branch (~line 106):
```ts
    else if ((m = line.match(/^\*\*min_families:\*\*\s+(.*)$/))) { const n = parseInt(m[1].trim(), 10); if (!Number.isNaN(n)) minFamilies = Math.max(1, n); }
```

(d) Add `minFamilies` to the returned object (~line 108):
```ts
  return { primaryMetric, direction, minOp, minVal, tgtOp, tgtVal, kRequired, plateauWindow, plateauThreshold, verifyEpsilon, ceiling, minRuntimeS, maxDebugAttempts, minFamilies };
```

Do NOT touch `formatMetricBlock` — `min_families` is parse-only like `verify_epsilon`/`ceiling`/`max_debug_attempts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rehearsal-core.test.ts -t "min_families"`
Expected: PASS. Then `npm run typecheck` — note `MetricThresholds.minFamilies` is now required, so any other `MetricThresholds` object literal in the codebase must set it. (`parseMetricMd` is the only constructor; confirm typecheck is clean.)

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalMetric.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): B1 metric.md min_families knob (parse-only, default 2)"
```

---

### Task 3: Approach-aware plateau in `checkCompletion`

**Files:**
- Modify: `src/core/rehearsalComplete.ts` (`SbRow` :30, `parseRows` :33-42, `CompletionSignals` :6-12, the K-streak/plateau region :61-91)
- Test: `tests/rehearsal-core.test.ts` (the existing `describe("checkCompletion", ...)` block)

- [ ] **Step 1: Write the failing test**

In `tests/rehearsal-core.test.ts`, inside `describe("checkCompletion", ...)` (after the existing minimize streak tests), add. Note the `row(...)` helper at ~line 309 takes `approach` via its 6th positional? It does NOT — it hardcodes `approach: "a"`. Add a local helper that sets the approach:

```ts
  // B1: approach-aware plateau. Helper that sets the approach family on a ScoreRow.
  function frow(expId: string, instrument: string, metric: string, approach: string): ScoreRow {
    return { expId, instrument, metric, status: "ok", runtime: "1", approach, metricName: "accuracy" };
  }
  // metric.md with target so "active family" rows are at-target; plateau_window 3, threshold 0.01,
  // min_families default 2 (no min_families line).
  const covMetric = formatMetricBlock({
    primary_metric: "accuracy", direction: "maximize",
    min_acceptable: ">= 0.90", target: ">= 0.95",
    K_corroboration: "2", plateau_window: "3", plateau_threshold: "0.01",
  });

  it("does NOT plateau when a single family fills a flat window (the B1 bug fix)", () => {
    // one family 'single-pass', 3 tight metrics -> globalFlat true, but familiesActive=1 < min_families 2.
    const sb = buildScoreboard([
      frow("exp-001", "oboe", "0.951", "single-pass"),
      frow("exp-002", "oboe", "0.952", "single-pass"),
      frow("exp-003", "oboe", "0.953", "single-pass"),
    ]);
    const c = checkCompletion(sb, covMetric);
    expect(c.plateau).toBe(false);
    expect(c.familiesActive).toBe(1);
    expect(c.minFamilies).toBe(2);
  });
  it("plateaus when two families are both stalled and the global window is flat", () => {
    const sb = buildScoreboard([
      frow("exp-001", "oboe", "0.951", "single-pass"),
      frow("exp-002", "oboe", "0.952", "single-pass"),
      frow("exp-003", "viola", "0.953", "typed-routing"),
      frow("exp-004", "viola", "0.952", "typed-routing"),
    ]);
    const c = checkCompletion(sb, covMetric);
    expect(c.familiesActive).toBe(2);
    expect(c.familiesImproving).toBe(0);
    expect(c.plateau).toBe(true);
  });
  it("does NOT plateau when one family is still improving", () => {
    // typed-routing climbs chronologically (0.951 -> 0.97) beyond threshold -> still improving.
    const sb = buildScoreboard([
      frow("exp-001", "oboe", "0.952", "single-pass"),
      frow("exp-002", "oboe", "0.952", "single-pass"),
      frow("exp-003", "viola", "0.951", "typed-routing"),
      frow("exp-004", "viola", "0.970", "typed-routing"),
    ]);
    const c = checkCompletion(sb, covMetric);
    expect(c.familiesImproving).toBe(1);
    expect(c.plateau).toBe(false);
  });
  it("does NOT plateau when the global window is not flat (additive guard)", () => {
    // two families but the global last-3 spread is wide -> globalFlat false.
    const sb = buildScoreboard([
      frow("exp-001", "oboe", "0.951", "single-pass"),
      frow("exp-002", "oboe", "0.952", "single-pass"),
      frow("exp-003", "viola", "0.99", "typed-routing"),
    ]);
    expect(checkCompletion(sb, covMetric).plateau).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rehearsal-core.test.ts -t "checkCompletion"`
Expected: FAIL — `familiesActive`/`familiesImproving`/`minFamilies` are `undefined`, and the single-family case currently plateaus `true` (today's family-blind behavior).

- [ ] **Step 3: Write minimal implementation**

In `src/core/rehearsalComplete.ts`:

(a) Import `normalizeFamily` at the top (after the existing `parseMetricMd` import):
```ts
import { normalizeFamily } from "./rehearsalCoverage.js";
```

(b) Widen `CompletionSignals` (the `:6-12` interface) — add three OPTIONAL derived fields:
```ts
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
```

(c) Add `approach` to `SbRow` (`:30`) and the `parseRows` push (`:39`):
```ts
interface SbRow { exp: string; instrument: string; metric: string; status: string; metricName: string; approach: string; }
```
```ts
    out.push({ exp: c[2], instrument: c[3], metric: c[4], status: c[5], metricName: c[8] ?? "", approach: c[7] ?? "" });
```

(d) Replace the plateau block (`:84-91`, from `// plateau:` through `return {...}`) with the approach-aware version. The existing `minimize` const (line ~65, from the K-streak) is in scope — reuse it:

```ts
  // plateau: today's global last-N spread check (semantics unchanged) ...
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
```

NOTE: the old code computed `plateau` AFTER the `kSoFar` cap and returned a 5-field object — make sure to remove the old `let plateau = false; ... ` block and the old `return`. The `minimize` const must already exist from the K-streak fix (0.1.16); if the diff shows it declared inside a narrower scope, hoist its declaration above the plateau block.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rehearsal-core.test.ts -t "checkCompletion"`
Expected: PASS (the 8 maximize + 2 minimize streak tests AND the 4 new B1 plateau tests). Also run the full file: `npx vitest run tests/rehearsal-core.test.ts` — the existing plateau tests (`flags plateau when the last window of ok metrics is tight`) used a SINGLE family (`row(...)` → `approach: "a"`), so they now have `familiesActive=1 < 2` and will FAIL with the new logic. **This is expected and correct** — update those two existing assertions: the "flags plateau" test must give it 2 families to still plateau, OR assert `plateau=false` with a comment that a single family no longer plateaus. Recommended: change that test to use two families so it still asserts `plateau=true`, preserving its intent:

```ts
  it("flags plateau when the window is tight across >= min_families families", () => {
    const sb = buildScoreboard([
      frow("exp-001", "oboe", "0.951", "single-pass"),
      frow("exp-002", "oboe", "0.952", "single-pass"),
      frow("exp-003", "viola", "0.953", "typed-routing"),
    ]);
    expect(checkCompletion(sb, metricMd).plateau).toBe(true);
  });
```
(Keep `no plateau when fewer than plateau_window ok rows` as-is — it asserts `false`, still correct.)

Then `npm run typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalComplete.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): B1 approach-aware plateau (families-active + still-improving gate)"
```

---

### Task 4: Coverage tally in the score pass (`computeScore`)

**Files:**
- Modify: `src/core/rehearsalScore.ts` (`ScoreComputation` :34-43, `computeScore` :50-133)
- Test: `tests/rehearsal-core.test.ts` — the existing `computeScore` describe block, which uses the `fakeFs(files: Record<string,string>)` helper (defined at ~:871) and art dir `"/a"`.

- [ ] **Step 1: Write the failing test**

Add to the existing `computeScore` describe block in `tests/rehearsal-core.test.ts`, using the `fakeFs` harness and the FULL `result.json` shape the other tests use (`branch_id`/`log_paths`/`checkpoint_path`/`notes` are required by `validateResult` — a thin object is rejected and skipped):

```ts
  it("emits per-family coverageRows over ok experiments (B1)", () => {
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n**Direction:** maximize\n",
      "/a/parts/oboe/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"single-pass",metric_name:"accuracy",metric_value:0.90,status:"ok",
        runtime_s:5,log_paths:[],checkpoint_path:null,notes:"" }),
      "/a/parts/oboe/experiments/exp-002/result.json": JSON.stringify({
        branch_id:"b",approach_label:"Single-Pass",metric_name:"accuracy",metric_value:0.96,status:"ok",
        runtime_s:5,log_paths:[],checkpoint_path:null,notes:"" }),
      "/a/parts/viola/experiments/exp-003/result.json": JSON.stringify({
        branch_id:"b",approach_label:"typed-routing",metric_name:"accuracy",metric_value:0.94,status:"ok",
        runtime_s:5,log_paths:[],checkpoint_path:null,notes:"" }),
    };
    const c = computeScore("/a", fakeFs(files), () => "2026-06-04T10:00:00Z");
    expect(c.coverageRows).toEqual([
      { family: "single-pass", count: 2, best: "0.96", ts: "2026-06-04T10:00:00Z" },
      { family: "typed-routing", count: 1, best: "0.94", ts: "2026-06-04T10:00:00Z" },
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rehearsal-core.test.ts -t "coverageRows"`
Expected: FAIL — `c.coverageRows` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/core/rehearsalScore.ts`:

(a) Import (after the `rehearsalSanity` import, ~line 10):
```ts
import { tallyCoverage, type CoverageRow } from "./rehearsalCoverage.js";
```

(b) Add to `ScoreComputation` (after `sanityRows`, ~line 42):
```ts
  coverageRows: CoverageRow[];
```

(c) In `computeScore`, after the walk (after the `for (const instrument of parts)` walk loop closes at ~line 117, before the `phaseClears` loop), compute the tally over ok rows and stamp ts:
```ts
  const coverageTs = now();
  const coverageRows: CoverageRow[] = tallyCoverage(
    rows.filter((r) => r.status === "ok"),
    parsed?.direction,
  ).map((r) => ({ ...r, ts: coverageTs }));
```

(d) Add `coverageRows` to the return literal (~line 131):
```ts
  return { scoreboardMd: buildScoreboard(rows, parsed?.direction), resultsTsv: buildResultsTsv(tsvRows),
    sidecars, staleSidecars, phaseClears, warnings, manifests, sanityRows, coverageRows };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rehearsal-core.test.ts -t "coverageRows"`
Expected: PASS. Then `npm run typecheck` — `ScoreComputation` now requires `coverageRows`; the only producer is `computeScore`. Any TEST that builds a `ScoreComputation` literal must add `coverageRows: []` — search `tests/` for `ScoreComputation` / objects passed to `scoreWith`'s `computeScore` mock and fix them.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalScore.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): B1 coverage tally in computeScore (coverageRows on ScoreComputation)"
```

---

### Task 5: `scoreWith` snapshot write + `statusBriefWith` join

**Files:**
- Modify: `src/commands/rehearsal.ts` (import ~15, `scoreWith` :601-624, `statusBriefWith` :763-848)
- Test: `tests/rehearsal-cmd.test.ts` or `tests/rehearsal-tail-cmd.test.ts` (whichever holds the `scoreWith`/`statusBriefWith` command tests — search `scoreWith(` / `statusBriefWith(`)

- [ ] **Step 1: Write the failing test**

Find the existing `scoreWith` command test (it injects a `RehearsalScoreDeps` with a fake `computeScore` + capturing `writeAtomic`). Add an assertion that `coverage.tsv` is written as a snapshot. Mirror the existing sanity.tsv assertion if present:

```ts
  it("writes coverage.tsv snapshot from computeScore.coverageRows (B1)", async () => {
    const writes: Record<string, string> = {};
    const deps = {
      computeScore: () => ({
        scoreboardMd: "", resultsTsv: "", sidecars: [], staleSidecars: [], phaseClears: [],
        warnings: [], manifests: [], sanityRows: [],
        coverageRows: [{ family: "single-pass", count: 2, best: "0.96", ts: "T" }],
      }),
      fs: { exists: () => true, read: () => null, listDir: () => [] },
      writeAtomic: (p: string, body: string) => { writes[p] = body; },
      removeFile: () => {},
      now: () => "T",
      opts: { home: TMP_HOME }, // reuse the test's CONSORT_HOME tmp
    };
    // scoreWith needs the parts dir to exist; reuse the test file's existing setup that makes it.
    await scoreWith(["my-topic"], deps as any);
    const covPath = Object.keys(writes).find((k) => k.endsWith("coverage.tsv"))!;
    expect(writes[covPath]).toBe("family\tcount\tbest\tts\nsingle-pass\t2\t0.96\tT\n");
  });
```

(Use the test file's existing helpers for `TMP_HOME` / making the parts dir — copy the pattern the sanity.tsv test uses. If the existing tests stub `existsSync` for the parts dir via the real FS under a tmp home, follow that.)

For `statusBriefWith`, add a test that a `coverage.tsv` on disk yields a `Coverage:` line:

```ts
  it("renders a Coverage line from coverage.tsv (B1)", async () => {
    // write coverage.tsv + scoreboard.md + metric.md under the art dir (reuse the test's art-dir helper)
    writeArt("coverage.tsv", "family\tcount\tbest\tts\nsingle-pass\t2\t0.96\tT\ntyped-routing\t1\t0.94\tT\n");
    // ... ensure metric.md (with min_families default) + a scoreboard exist so completion computes ...
    let outp = "";
    await statusBriefWith(["my-topic"], { stdout: (l) => { outp += l + "\n"; }, opts: { home: TMP_HOME } });
    expect(outp).toContain("**Coverage:** 2 families [single-pass×2, typed-routing×1]");
    expect(outp).toContain("min_families=2 (met)");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run the targeted tests. Expected: FAIL — no `coverage.tsv` written / no `Coverage:` line (and `CoverageRow` import missing).

- [ ] **Step 3: Write minimal implementation**

In `src/commands/rehearsal.ts`:

(a) Extend the rehearsalCoverage-less import set — add after the `rehearsalSanity` import (line 15):
```ts
import { coverageRow, COVERAGE_TSV_HEADER, type CoverageRow } from "../core/rehearsalCoverage.js";
```

(b) In `scoreWith`, add the snapshot write immediately after the sanity.tsv write (line 621), before the warnings loop — preserving the frozen order (… → sanity.tsv → coverage.tsv → warnings):
```ts
  deps.writeAtomic(join(art, "coverage.tsv"), COVERAGE_TSV_HEADER + c.coverageRows.map(coverageRow).join(""));
```

(c) In `statusBriefWith`, after the sanity.tsv join block (line 843), add the coverage.tsv read:
```ts
  const ctsv = join(art, "coverage.tsv");
  let coverage: CoverageRow[] | undefined;
  if (existsSync(ctsv)) {
    coverage = [];
    for (const line of readFileSync(ctsv, "utf8").split("\n")) {
      if (!line || line.startsWith("family\t")) continue;
      const c = line.split("\t");           // family, count, best, ts
      if (c[0]) coverage.push({ family: c[0], count: parseInt(c[1] ?? "0", 10) || 0, best: c[2] ?? "", ts: c[3] ?? "" });
    }
  }
```

(d) Pass `coverage` to `buildStatusBrief` (line 846):
```ts
  out(buildStatusBrief({ parts, scoreboardMd, completion, latest, verdicts, suspects, coverage }));
```

- [ ] **Step 4: Run test to verify it passes**

Run the targeted tests, then `npx vitest run tests/rehearsal-cmd.test.ts tests/rehearsal-tail-cmd.test.ts` and `npm run typecheck`. Expected: PASS / clean. (The `Coverage:` line render itself lives in Task 6 — if the `statusBriefWith` test depends on the render, run Task 6 first or assert only that `coverage` reaches `buildStatusBrief`; the controller may reorder Steps so Task 6's render exists before this test's `Coverage:` assertion. Simplest: implement Task 6 and Task 5 together if the reviewer prefers — they share the render contract.)

- [ ] **Step 5: Commit**

```bash
git add src/commands/rehearsal.ts tests/rehearsal-cmd.test.ts tests/rehearsal-tail-cmd.test.ts
git commit -m "feat(rehearsal): B1 wire coverage.tsv snapshot write + status-brief join"
```

---

### Task 6: Render the `Coverage:` line in `buildStatusBrief`

**Files:**
- Modify: `src/core/rehearsalBrief.ts` (`StatusBriefInput` :18-27, `buildStatusBrief` :50-104)
- Test: `tests/rehearsal-core.test.ts` — the existing `buildStatusBrief` tests live here (~:1003-1073), using a `SIG` `CompletionSignals` const and a `part()` helper. Add the new cases in that block.

- [ ] **Step 1: Write the failing test**

Add to the `buildStatusBrief` block in `tests/rehearsal-core.test.ts` (mirror the existing literal style):

```ts
  it("renders a Coverage line from coverage + completion floor (B1)", () => {
    const out = buildStatusBrief({
      parts: [],
      scoreboardMd: "| Rank | Exp | Instrument | Metric | Status | Runtime | Approach | Metric name |\n",
      completion: { floorMet: true, targetMet: false, kSoFar: 1, kRequired: 2, plateau: false,
        familiesActive: 2, familiesImproving: 0, minFamilies: 2 },
      coverage: [
        { family: "single-pass", count: 4, best: "0.96", ts: "T" },
        { family: "typed-routing", count: 3, best: "0.94", ts: "T" },
      ],
    });
    expect(out).toContain("**Coverage:** 2 families [single-pass×4, typed-routing×3]; min_families=2 (met)");
  });
  it("marks the floor short when families < min_families", () => {
    const out = buildStatusBrief({
      parts: [], scoreboardMd: null,
      completion: { floorMet: true, targetMet: false, kSoFar: 0, kRequired: 2, plateau: false,
        familiesActive: 1, familiesImproving: 0, minFamilies: 3 },
      coverage: [{ family: "single-pass", count: 2, best: "0.96", ts: "T" }],
    });
    expect(out).toContain("min_families=3 (short by 2)");
  });
  it("omits the Coverage line when no coverage data (back-compat)", () => {
    const out = buildStatusBrief({ parts: [], scoreboardMd: null, completion: null });
    expect(out).not.toContain("**Coverage:**");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/rehearsal-core.test.ts -t "Coverage"`
Expected: FAIL — `coverage` not on `StatusBriefInput`; no `Coverage:` line.

- [ ] **Step 3: Write minimal implementation**

In `src/core/rehearsalBrief.ts`:

(a) Import the type at the top:
```ts
import type { CoverageRow } from "./rehearsalCoverage.js";
```

(b) Add to `StatusBriefInput` (after `suspects?`):
```ts
  /** per-family coverage rows joined from coverage.tsv; omit for back-compat (no Coverage line). */
  coverage?: CoverageRow[];
```

(c) In `buildStatusBrief`, after the completion-line section (after line 101, before `return`), append the Coverage section:
```ts
  // Coverage line (B1). Global signal -> its own section; omit when no coverage data (back-compat).
  if (input.coverage && input.coverage.length) {
    const cov = input.coverage;
    const list = cov.map((r) => `${r.family}×${r.count}`).join(", ");
    let floor = "";
    if (c && c.minFamilies !== undefined) {
      const met = cov.length >= c.minFamilies;
      floor = `; min_families=${c.minFamilies} (${met ? "met" : `short by ${c.minFamilies - cov.length}`})`;
    }
    sections.push(`**Coverage:** ${cov.length} families [${list}]${floor}`);
  }
```

NOTE the `×` is U+00D7 (multiplication sign), consistent with the suspect/verdict tag style; it is not an emoji and not a banned token.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/rehearsal-core.test.ts -t "Coverage"` then the whole file, then `npm run typecheck`.
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalBrief.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): B1 render Coverage line in status brief"
```

---

### Task 7: Directive edits — `commands/rehearsal.md`

**Files:**
- Modify: `commands/rehearsal.md` (Phase 1 metric block; Step 3 scoreboard-reading note; Step 4 decision policy; Step 5 dispatch round; line-160 initial-diversity pointer)

- [ ] **Step 1: Apply the directive edits** (no unit test; the stale-token gate + a manual read are the checks)

(a) **Phase 1 (metric discussion, ~line 59-75):** where the optional knobs are described, add a sentence that the Maestro may set `**min_families:** N` in `metric.md` (default 2; AIRA's healthy band is 3-4) to require broader coverage before a plateau-stop.

(b) **Step 3 / scoreboard-reading (after the "Scoreboard groups" note ~line 216-218):** add:
```
   Coverage: the `**Coverage:** N families [fam×count, ...]; min_families=M (met|short by K)` line
   shows how many distinct approach families have been explored. `(short by K)` means fewer than M
   families have landed an ok result -- exploration is still narrow.
```

(c) **Step 4 (decision policy, ~line 258-274):** add one line under the soft rules noting the plateau is now family-aware:
```
  - NOTE: `plateau` is approach-aware -- it will NOT fire while fewer than `min_families`
    distinct families have landed ok results, or while any family is still improving. A
    plateau therefore already means "breadth reached and every family stalled."
```

(d) **Step 5 (dispatch round, ~line 297-303):** add a steering bullet before the `experiment-send` call:
```
   **Coverage steering (B1):** if the `Coverage:` line is `(short by K)` or one family dominates
   the tally, open a NEW approach family this dispatch (set a fresh `<approach-label>`) rather than
   tuning the current leader. Aim for >= `min_families` distinct families (AIRA: <=2 = collapse
   risk, 3-4 = healthy). You may align the label to one of the SOTA sweep's families.
```

(e) **Line ~160 initial-diversity instruction:** append a pointer: `(B1 now backs this mechanically -- see the Coverage line + the min_families plateau gate.)`

- [ ] **Step 2: Verify the stale-token gate + no emojis**

Run: `npx vitest run tests/stale-tokens.test.ts`
Expected: PASS (7/7). Visually confirm no banned tokens / emojis were introduced.

- [ ] **Step 3: Commit**

```bash
git add commands/rehearsal.md
git commit -m "docs(rehearsal): B1 directive — coverage steering + family-aware plateau notes"
```

---

### Task 8: Release — version bump, build, full gate, dist commit

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (0.1.16 → 0.1.17), `dist/consort.cjs`

- [ ] **Step 1: Bump all three manifests** 0.1.16 → 0.1.17.

- [ ] **Step 2: Full gate (pre-build)**

Run: `npm run typecheck && npm run test && npm run lint && npx vitest run tests/stale-tokens.test.ts`
Expected: typecheck clean; all tests pass; lint clean; stale-tokens 7/7.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `dist/consort.cjs` rebuilt.

- [ ] **Step 4: Post-build sanity**

Run: `npm run typecheck && npx vitest run tests/stale-tokens.test.ts`
Expected: clean / 7/7.

- [ ] **Step 5: Commit the release**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "release(rehearsal): B1 coverage & diversity guard (0.1.17)"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** Task 1 = §4.1/§4.3 (normalizeFamily/tally) + §4.2 (row/header); Task 2 = §4.6 (min_families parse-only); Task 3 = §4.4/§4.5 (plateau + signals) + the bug-fix AC#1/#2; Task 4 = §4.2/§3 (coverage tally in score pass); Task 5 = §3 (snapshot write + join); Task 6 = §4 surfacing (Coverage line); Task 7 = §7 directive; Task 8 = AC#8 release.
- **Type consistency:** `CoverageRow { family; count; best; ts }`, `COVERAGE_TSV_HEADER`, `coverageRow`, `tallyCoverage`, `normalizeFamily` names are identical across Tasks 1/4/5/6. `MetricThresholds.minFamilies` (required, default-2 in parser) vs `CompletionSignals.familiesActive?/familiesImproving?/minFamilies?` (optional) — deliberate (see §4.5/§4.6).
- **Snapshot discipline (the A3 landmine):** Task 5 writes `HEADER + rows.join("")` wholesale — NEVER `prior + row`. `computeScore` re-walks all experiments each pass.
- **Existing-test fallout to fix as you go (do not skip):** widening `ScoreComputation` (Task 4) and the new single-family plateau semantics (Task 3) will break some existing literals/assertions — Tasks 3 & 4 Step 4 call these out explicitly. Fix them in the same task; do not leave the suite red.
- **Frozen contracts untouched:** scoreboard 8-col schema + `schema_version`, `status` enum, integer-rank parse `/^\|\s+\d+\s+\|/`, A1 verification.tsv / A3 sanity.tsv, `END_OF_INSTRUCTION`, event names. coverage.tsv is a NEW file; metric.md gains an optional parse-only knob only.
