# Rehearsal A3 — Sanity & Integrity Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag a *valid* rehearsal result as suspect — too-good-to-be-true ceiling, runtime under-run, log-error contradiction, incomplete integrity attestation, and per-experiment audit-knob drift — surfaced in `status-brief` and finalize, orthogonal to A1's verify verdict.

**Architecture:** A new pure core `src/core/rehearsalSanity.ts` runs the checks (parsed result + thresholds + injected log/audit readers → flag rows). The score pass (`computeScore`) invokes it per validated result; `scoreWith` writes a **`sanity.tsv` snapshot** (rewritten each pass, since `computeScore` re-walks all experiments). `status-brief` joins it for a `[suspect: …]` top-3 annotation (mirroring A1's verdict join); finalize folds the non-audit flags into `## Warnings`. No new verb. Additive; `scoreboard.md` shape untouched.

**Tech Stack:** TypeScript (Node/ESM), esbuild single-bundle `dist/consort.cjs`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-03-rehearsal-a3-sanity-gates-design.md`.

**Key design notes (read first):**
1. `sanity.tsv` is a **rewritten snapshot** each score pass (NOT appended) — `computeScore` produces the full current flag set across all experiments, so overwrite avoids per-pass duplication. (Differs from A1's `verification.tsv`, which is per-experiment append.)
2. The per-experiment audit-knob-drift check and the existing finalize `computeAuditWarnings` overlap. To avoid double-counting in the final report, the finalize fold of `sanity.tsv` into `## Warnings` **excludes** `audit-knob-drift` rows (the finalize `audit_warn` already covers knob drift).
3. `computeScore` already parses `metric.md` once into `parsed` (added in A1 for `direction`); A3 reuses it for `ceiling`/`minRuntimeS`.

**Conventions:** pure core + verb-applies-plan (mirror `computeScore`/`scoreWith`); paths via `experimentDir`; atomic writes via `atomicWrite`; `log` to stderr; `isoUtc` timestamps. No emojis. Gates: `npm run typecheck`, `npm run test`, `npm run lint`, `npm run build`.

---

### Task 1: Sanity core — checks + flag/tsv render

**Files:**
- Create: `src/core/rehearsalSanity.ts`
- Test: `tests/rehearsal-sanity.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/rehearsal-sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanityFlags, sanityRow, type SanityInput } from "../src/core/rehearsalSanity.js";

const okResult = (over: Record<string, unknown> = {}) => ({
  status: "ok", metric_value: 0.9, runtime_s: 100, log_paths: ["./stdout.log"],
  integrity: { split_before_fit: true, no_train_test_overlap: true, target_not_in_features: true, trained_steps: 10, seed: 1 },
  ...over,
});
const base = (over: Partial<SanityInput> = {}): SanityInput => ({
  result: okResult(), direction: "maximize", ceiling: undefined, minRuntimeS: 1.0,
  readLog: () => "clean run\n", hardConstraints: [], audit: null, ...over,
});

describe("sanityFlags", () => {
  it("clean result -> no flags", () => {
    expect(sanityFlags(base())).toEqual([]);
  });
  it("ceiling-exceeded (maximize: metric > ceiling)", () => {
    const f = sanityFlags(base({ ceiling: 0.8 }));
    expect(f).toEqual([{ flag: "ceiling-exceeded", detail: "metric=0.9 ceiling=0.8" }]);
  });
  it("ceiling-exceeded (minimize: metric < ceiling/floor)", () => {
    const f = sanityFlags(base({ direction: "minimize", result: okResult({ metric_value: 0.01 }), ceiling: 0.05 }));
    expect(f[0].flag).toBe("ceiling-exceeded");
  });
  it("no ceiling flag when ceiling undefined", () => {
    expect(sanityFlags(base({ ceiling: undefined, result: okResult({ metric_value: 999 }) }))).toEqual([]);
  });
  it("under-run when runtime below floor", () => {
    const f = sanityFlags(base({ result: okResult({ runtime_s: 0 }) }));
    expect(f).toEqual([{ flag: "under-run", detail: "runtime=0 floor=1" }]);
  });
  it("log-contradiction when an ok run's log has a crash marker", () => {
    const f = sanityFlags(base({ readLog: () => "epoch 1\nTraceback (most recent call last)\n" }));
    expect(f[0]).toEqual({ flag: "log-contradiction", detail: "marker=Traceback (most recent call last) file=./stdout.log" });
  });
  it("integrity-attestation-incomplete lists missing keys", () => {
    const f = sanityFlags(base({ result: okResult({ integrity: { split_before_fit: true } }) }));
    expect(f[0].flag).toBe("integrity-attestation-incomplete");
    expect(f[0].detail).toContain("no_train_test_overlap");
    expect(f[0].detail).toContain("seed");
  });
  it("integrity-attestation-incomplete when block absent", () => {
    const f = sanityFlags(base({ result: okResult({ integrity: undefined }) }));
    expect(f[0].flag).toBe("integrity-attestation-incomplete");
  });
  it("audit-knob-drift when audit.json value != mandated", () => {
    const f = sanityFlags(base({ hardConstraints: [{ key: "mcts_sims", value: "200" }], audit: { mcts_sims: 16 } }));
    expect(f[0]).toEqual({ flag: "audit-knob-drift", detail: "mcts_sims=16 vs mandated 200" });
  });
  it("no audit-knob-drift when value matches or audit missing the key", () => {
    expect(sanityFlags(base({ hardConstraints: [{ key: "x", value: "200" }], audit: { x: 200 } }))).toEqual([]);
    expect(sanityFlags(base({ hardConstraints: [{ key: "x", value: "200" }], audit: {} }))).toEqual([]);
  });
  it("non-ok status skips ok-only checks (ceiling/under-run/log)", () => {
    const r = { status: "fail", metric_value: null, runtime_s: 0, log_paths: ["./x"],
      integrity: { split_before_fit: true, no_train_test_overlap: true, target_not_in_features: true, trained_steps: 1, seed: 1 } };
    expect(sanityFlags(base({ result: r, ceiling: 0.1, readLog: () => "Traceback (most recent call last)" }))).toEqual([]);
  });
});

describe("sanityRow", () => {
  it("renders a 5-col tsv row", () => {
    expect(sanityRow({ expId: "exp-001", instrument: "viola", flag: "under-run", detail: "runtime=0 floor=1", ts: "T" }))
      .toBe("exp-001\tviola\tunder-run\truntime=0 floor=1\tT\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/rehearsal-sanity.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write minimal implementation** — create `src/core/rehearsalSanity.ts`:

```ts
// Mechanical, task-agnostic sanity checks for /consort:rehearsal (research-validity A3).
// Flags a VALID result as suspect; orthogonal to A1's verify verdict. Pure: FS injected; the score
// pass applies the rows. A clean result returns no flags.

export interface SanityFlag { flag: string; detail: string; }

export interface SanityRow { expId: string; instrument: string; flag: string; detail: string; ts: string; }
export const SANITY_TSV_HEADER = "exp_id\tinstrument\tflag\tdetail\tts\n";
export function sanityRow(r: SanityRow): string {
  return `${r.expId}\t${r.instrument}\t${r.flag}\t${r.detail}\t${r.ts}\n`;
}

const INTEGRITY_KEYS = ["split_before_fit", "no_train_test_overlap", "target_not_in_features", "trained_steps", "seed"] as const;
const LOG_MARKERS = ["Traceback (most recent call last)", "Segmentation fault", "CUDA out of memory"] as const;

export interface SanityInput {
  result: Record<string, unknown>;
  direction?: "maximize" | "minimize";
  ceiling?: number;
  minRuntimeS: number;
  readLog: (rel: string) => string | null;
  hardConstraints: { key: string; value: string }[];
  audit: Record<string, unknown> | null;
}

/** All sanity flags for one VALID result. Empty when clean. */
export function sanityFlags(inp: SanityInput): SanityFlag[] {
  const flags: SanityFlag[] = [];
  const r = inp.result;
  const status = String(r.status ?? "");
  const isOk = status === "ok";

  // ceiling (direction-aware; ok + numeric only)
  const mv = typeof r.metric_value === "number" ? r.metric_value : null;
  if (isOk && mv !== null && inp.ceiling !== undefined) {
    const over = inp.direction === "minimize" ? mv < inp.ceiling : mv > inp.ceiling;
    if (over) flags.push({ flag: "ceiling-exceeded", detail: `metric=${mv} ceiling=${inp.ceiling}` });
  }
  // under-run
  if (isOk) {
    const rt = typeof r.runtime_s === "number" ? r.runtime_s : 0;
    if (rt < inp.minRuntimeS) flags.push({ flag: "under-run", detail: `runtime=${rt} floor=${inp.minRuntimeS}` });
  }
  // log-error corroboration
  if (isOk) {
    const logs = Array.isArray(r.log_paths) ? r.log_paths.filter((x): x is string => typeof x === "string") : [];
    let found = false;
    for (const lp of logs) {
      if (found) break;
      const txt = inp.readLog(lp);
      if (txt === null) continue;
      for (const marker of LOG_MARKERS) {
        if (txt.includes(marker)) { flags.push({ flag: "log-contradiction", detail: `marker=${marker} file=${lp}` }); found = true; break; }
      }
    }
  }
  // integrity attestation completeness (runs for all statuses)
  const integrity = (r.integrity && typeof r.integrity === "object" && !Array.isArray(r.integrity)) ? r.integrity as Record<string, unknown> : null;
  const missing = INTEGRITY_KEYS.filter((k) => integrity === null || integrity[k] === undefined || integrity[k] === null);
  if (missing.length) flags.push({ flag: "integrity-attestation-incomplete", detail: `missing=${missing.join(",")}` });
  // audit knob drift (numeric-tolerant compare; skip keys absent from audit.json)
  for (const hc of inp.hardConstraints) {
    const actual = inp.audit ? inp.audit[hc.key] : undefined;
    if (actual === undefined || actual === null) continue;
    const a = parseFloat(String(actual)), v = parseFloat(hc.value);
    const drift = (!Number.isNaN(a) && !Number.isNaN(v)) ? a !== v : String(actual) !== hc.value;
    if (drift) flags.push({ flag: "audit-knob-drift", detail: `${hc.key}=${String(actual)} vs mandated ${hc.value}` });
  }
  return flags;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/rehearsal-sanity.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalSanity.ts tests/rehearsal-sanity.test.ts
git commit -m "feat(rehearsal): sanity core — ceiling/under-run/log/integrity/audit checks (A3)"
```

---

### Task 2: metric.md — parse `ceiling` + `min_runtime_s`

**Files:**
- Modify: `src/core/rehearsalMetric.ts` (`MetricThresholds` interface; `parseMetricMd`)
- Test: `tests/rehearsal-core.test.ts` (the `parseMetricMd round-trips` describe)

- [ ] **Step 1: Write the failing test** (add an `it` inside the existing `parseMetricMd` describe):

```ts
  it("parses ceiling + min_runtime_s; undefined when absent", () => {
    const t = parseMetricMd("**Primary metric:** acc\n**ceiling:** 0.98\n**min_runtime_s:** 5\n");
    expect(t.ceiling).toBe(0.98);
    expect(t.minRuntimeS).toBe(5);
    const u = parseMetricMd("**Primary metric:** acc\n");
    expect(u.ceiling).toBeUndefined();
    expect(u.minRuntimeS).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/rehearsal-core.test.ts -t "ceiling"` → FAIL.

- [ ] **Step 3: Write minimal implementation** — in `src/core/rehearsalMetric.ts`:
- In `MetricThresholds`, after `verifyEpsilon?: number;`, add:
```ts
  /** optional metric.md `**ceiling:**` (plausible bound) for A3 too-good-to-be-true; skip if absent. */
  ceiling?: number;
  /** optional metric.md `**min_runtime_s:**` for A3 under-run; caller defaults to 1.0 if absent. */
  minRuntimeS?: number;
```
- In `parseMetricMd`, near the other `let` decls, add: `let ceiling: number | undefined; let minRuntimeS: number | undefined;`
- Add two parse branches alongside the others:
```ts
    else if ((m = line.match(/^\*\*ceiling:\*\*\s+(.*)$/))) { const n = parseFloat(m[1].trim()); if (!Number.isNaN(n)) ceiling = n; }
    else if ((m = line.match(/^\*\*min_runtime_s:\*\*\s+(.*)$/))) { const n = parseFloat(m[1].trim()); if (!Number.isNaN(n)) minRuntimeS = n; }
```
- Add `ceiling, minRuntimeS` to the returned object.

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run tests/rehearsal-core.test.ts -t "ceiling"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalMetric.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): parse metric.md ceiling + min_runtime_s (A3)"
```

---

### Task 3: score pass — run sanity checks + write the `sanity.tsv` snapshot

**Files:**
- Modify: `src/core/rehearsalScore.ts` (`ScoreComputation`; `computeScore`; return)
- Modify: `src/commands/rehearsal.ts` (`scoreWith` apply)
- Test: `tests/rehearsal-core.test.ts` (the `computeScore` describe)

- [ ] **Step 1: Write the failing test** (add `it`s in the `computeScore` describe):

```ts
  it("computeScore emits sanity rows (ceiling) for a verify-less suspect result", () => {
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n**Direction:** maximize\n**ceiling:** 0.8\n",
      "/a/parts/viola/state.txt": "current_exp_id=exp-001\n",
      "/a/parts/viola/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"x",metric_name:"accuracy",metric_value:0.95,status:"ok",
        runtime_s:50,log_paths:[],checkpoint_path:null,notes:"" }),
    };
    const c = computeScore("/a", fakeFs(files), () => "T");
    const ceil = c.sanityRows.find((r) => r.flag === "ceiling-exceeded");
    expect(ceil).toMatchObject({ expId: "exp-001", instrument: "viola" });
    // integrity also flagged (no block)
    expect(c.sanityRows.some((r) => r.flag === "integrity-attestation-incomplete")).toBe(true);
  });
  it("computeScore emits no ceiling/under-run/log rows for a clean result (integrity still flagged if absent)", () => {
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n**Direction:** maximize\n",
      "/a/parts/viola/state.txt": "current_exp_id=exp-001\n",
      "/a/parts/viola/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"x",metric_name:"accuracy",metric_value:0.95,status:"ok",
        runtime_s:50,log_paths:[],checkpoint_path:null,notes:"",
        integrity:{ split_before_fit:true, no_train_test_overlap:true, target_not_in_features:true, trained_steps:10, seed:1 } }),
    };
    const c = computeScore("/a", fakeFs(files), () => "T");
    expect(c.sanityRows).toEqual([]); // no ceiling field, ran long enough, no logs, integrity complete
  });
  it("computeScore emits audit-knob-drift from prompt.md vs audit.json", () => {
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n",
      "/a/parts/viola/state.txt": "current_exp_id=exp-001\n",
      "/a/parts/viola/experiments/exp-001/result.json": JSON.stringify({
        branch_id:"b",approach_label:"x",metric_name:"accuracy",metric_value:0.5,status:"ok",
        runtime_s:50,log_paths:[],checkpoint_path:null,notes:"",
        integrity:{ split_before_fit:true, no_train_test_overlap:true, target_not_in_features:true, trained_steps:10, seed:1 } }),
      "/a/parts/viola/experiments/exp-001/prompt.md": "**Hard constraints:**\nmcts_sims = 200\n\n",
      "/a/parts/viola/experiments/exp-001/audit.json": JSON.stringify({ mcts_sims: 16 }),
    };
    const c = computeScore("/a", fakeFs(files), () => "T");
    expect(c.sanityRows.find((r) => r.flag === "audit-knob-drift")).toMatchObject({ detail: "mcts_sims=16 vs mandated 200" });
  });
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/rehearsal-core.test.ts -t "sanity rows|audit-knob-drift|clean result"` → FAIL (`c.sanityRows` undefined).

- [ ] **Step 3: Write minimal implementation** — in `src/core/rehearsalScore.ts`:
- add imports:
```ts
import { sanityFlags, type SanityRow } from "./rehearsalSanity.js";
import { parseHardConstraints } from "./rehearsalFinalize.js";
```
- in `ScoreComputation`, add: `sanityRows: SanityRow[];`
- in `computeScore`, near the other accumulators: `const sanityRows: SanityRow[] = [];`
  (`parsed` already exists from A1: `const parsed = metricMd ? parseMetricMd(metricMd) : null;`)
- INSIDE the walk loop, after the existing A1 `verify`-manifest block (i.e. after `rows.push`/`tsvRows.push` and the manifest code), add:
```ts
      const promptMd = fs.read(join(branchDir, "prompt.md"));
      let auditObj: Record<string, unknown> | null = null;
      const auditRaw = fs.read(join(branchDir, "audit.json"));
      if (auditRaw) { try { auditObj = JSON.parse(auditRaw) as Record<string, unknown>; } catch { auditObj = null; } }
      const flags = sanityFlags({
        result: o,
        direction: parsed?.direction,
        ceiling: parsed?.ceiling,
        minRuntimeS: parsed?.minRuntimeS ?? 1.0,
        readLog: (rel) => fs.read(join(branchDir, rel)),
        hardConstraints: promptMd ? parseHardConstraints(promptMd) : [],
        audit: auditObj,
      });
      for (const f of flags) sanityRows.push({ expId, instrument, flag: f.flag, detail: f.detail, ts: now() });
```
- add `sanityRows` to the returned object.

In `src/commands/rehearsal.ts` `scoreWith`, after the `for (const m of c.manifests) ...` line (added in A1), add the snapshot write (OVERWRITE, not append):
```ts
  deps.writeAtomic(join(art, "sanity.tsv"), SANITY_TSV_HEADER + c.sanityRows.map(sanityRow).join(""));
```
and import at the top of `rehearsal.ts`:
```ts
import { sanityRow, SANITY_TSV_HEADER } from "../core/rehearsalSanity.js";
```

- [ ] **Step 4: Run test to verify it passes** — the `-t` filter above, then the full file `npx vitest run tests/rehearsal-core.test.ts` (existing computeScore tests stay green — a result with no metric.md ceiling, long runtime, no logs, but NO integrity block now emits an `integrity-attestation-incomplete` row; UPDATE any prior computeScore test that asserts exact scoreboard/tsv content only — those don't read `sanityRows`, so they remain green; if a prior test asserted `c` has an exact shape via `toEqual`, adjust to `toMatchObject`).

NOTE for implementer: prior computeScore tests assert `scoreboardMd`/`resultsTsv`/`phaseClears`/`manifests` — none assert the full `c` object shape with `toEqual`, so adding `sanityRows` does not break them. Verify by running the full file.

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalScore.ts src/commands/rehearsal.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): score-pass sanity checks + sanity.tsv snapshot (A3)"
```

---

### Task 4: status-brief — `[suspect: …]` annotation from `sanity.tsv`

**Files:**
- Modify: `src/core/rehearsalBrief.ts` (`StatusBriefInput`; top-3 render)
- Modify: `src/commands/rehearsal.ts` (`statusBriefWith` — joins `verification.tsv` already at ~821; add a `sanity.tsv` join)
- Test: `tests/rehearsal-core.test.ts` (the status-brief describe)

- [ ] **Step 1: Write the failing test** (add an `it`; reuse the existing `buildStatusBrief` import):

```ts
describe("buildStatusBrief suspect annotation", () => {
  const sb = [
    "<!-- scoreboard schema_version=2 -->", "# Scoreboard", "",
    "| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |",
    "|---|---|---|---|---|---|---|---|",
    "| 1 | exp-002 | viola | 0.9600 | ok | 1.00s | b | accuracy |",
  ].join("\n") + "\n";
  it("annotates a top row with its suspect flags", () => {
    const out = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: null,
      suspects: { "viola/exp-002": ["ceiling-exceeded", "under-run"] } });
    expect(out).toMatch(/exp-002 — 0\.9600 — accuracy \[suspect: ceiling-exceeded,under-run\]/);
  });
  it("no suspect annotation when map omitted (back-compat)", () => {
    const out = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: null });
    expect(out).not.toContain("suspect");
  });
  it("verdict and suspect annotations coexist", () => {
    const out = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: null,
      verdicts: { "viola/exp-002": "verified" }, suspects: { "viola/exp-002": ["ceiling-exceeded"] } });
    expect(out).toMatch(/\[verified\] \[suspect: ceiling-exceeded\]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/rehearsal-core.test.ts -t "suspect"` → FAIL.

- [ ] **Step 3: Write minimal implementation** — in `src/core/rehearsalBrief.ts`:
- add to `StatusBriefInput`:
```ts
  /** instrument/exp -> sanity flags, joined from sanity.tsv; omit for back-compat (no annotation). */
  suspects?: Record<string, string[]>;
```
- in the top-3 render loop, where A1 appended the verdict `tag`, also append a suspect tag AFTER it. The current line (from A1) is:
```ts
        const v = input.verdicts?.[`${r.instrument}/${r.exp}`];
        const tag = v ? ` [${v === "mismatch" ? "mismatch!" : v}]` : "";
        sb.push(`${r.rank}. ${r.instrument}/${r.exp} — ${r.metric} — ${r.metricName}${tag}`);
```
change the push to add a suspect tag:
```ts
        const v = input.verdicts?.[`${r.instrument}/${r.exp}`];
        const tag = v ? ` [${v === "mismatch" ? "mismatch!" : v}]` : "";
        const s = input.suspects?.[`${r.instrument}/${r.exp}`];
        const stag = s && s.length ? ` [suspect: ${s.join(",")}]` : "";
        sb.push(`${r.rank}. ${r.instrument}/${r.exp} — ${r.metric} — ${r.metricName}${tag}${stag}`);
```

In `src/commands/rehearsal.ts` `statusBriefWith`, after the existing `verification.tsv` join block (~line 821-832), add a `sanity.tsv` join and pass it:
```ts
  const stsv = join(art, "sanity.tsv");
  let suspects: Record<string, string[]> | undefined;
  if (existsSync(stsv)) {
    suspects = {};
    for (const line of readFileSync(stsv, "utf8").split("\n")) {
      if (!line || line.startsWith("exp_id\t")) continue;
      const c = line.split("\t");           // exp_id, instrument, flag, ...
      if (c[0] && c[1] && c[2]) (suspects[`${c[1]}/${c[0]}`] ??= []).push(c[2]);
    }
  }
```
and add `suspects` to the `buildStatusBrief({ ... })` call (which already passes `verdicts`).

- [ ] **Step 4: Run test to verify it passes** — `-t "suspect"`, then the full file. Existing status-brief + A1 verdict tests stay green (no `suspects` → no annotation).

- [ ] **Step 5: Commit**

```bash
git add src/core/rehearsalBrief.ts src/commands/rehearsal.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): status-brief suspect annotation (A3)"
```

---

### Task 5: finalize — fold non-audit sanity flags into `## Warnings`

**Files:**
- Modify: `src/commands/rehearsal.ts` (the finalize flow: after `computeAuditWarnings` at ~line 1073; and the session-summary warnings render at ~line 1133)

- [ ] **Step 1: Write the implementation** (this is a prose/integration step over existing finalize code; the behavior is verified by Step 2's targeted test).

(a) After the `computeAuditWarnings(art, instruments, warningsPath);` call (~line 1073), append non-audit `sanity.tsv` rows to `warnings.txt`:
```ts
  // A3: fold non-audit sanity flags into warnings.txt (audit-knob-drift already covered by audit_warn).
  const sanityTsv = join(art, "sanity.tsv");
  if (existsSync(sanityTsv)) {
    const extra: string[] = [];
    for (const line of readFileSync(sanityTsv, "utf8").split("\n")) {
      if (!line || line.startsWith("exp_id\t")) continue;
      const c = line.split("\t");                 // exp_id, instrument, flag, detail, ts
      if (c[2] === "audit-knob-drift") continue;   // dedupe vs finalize audit_warn
      if (c[0] && c[1] && c[2]) extra.push(`sanity\t${c[1]}/${c[0]}\t${c[2]}\t${c[3] ?? ""}`);
    }
    if (extra.length) appendFileSync(warningsPath, extra.join("\n") + "\n");
  }
```
(ensure `appendFileSync` is imported from `node:fs` in `rehearsal.ts`; if not present, add it — check with `grep -n "appendFileSync\|from \"node:fs\"" src/commands/rehearsal.ts`.)

(b) In the session-summary warnings render (the loop with `} else if (f[0] === "audit_warn") {` at ~line 1133), add a branch:
```ts
    } else if (f[0] === "sanity") {
      warnings.push(`- sanity: ${f[1]} ${f[2]} (${f[3]})`);
```

- [ ] **Step 2: Write + run a targeted test** (append to `tests/rehearsal-cmd.test.ts`, OR if finalize is hard to unit-test in isolation, verify via the full suite + a manual assertion). Minimal approach — assert the session-summary render branch via the existing finalize test harness if present; otherwise confirm no regression with the full suite and rely on the final review for the integration check. Run `npx vitest run tests/rehearsal-cmd.test.ts tests/rehearsal-core.test.ts` → all green.

NOTE for implementer: if there is no existing unit harness for the finalize session-summary render, do NOT fabricate one — keep the change minimal, confirm `npm run typecheck` + the full suite are green, and flag in your report that Task 5's integration is covered by the final review + dogfood (finalize spawns no subprocess, but its file orchestration is large; a focused unit test is optional here).

- [ ] **Step 3: Commit**

```bash
git add src/commands/rehearsal.ts
git commit -m "feat(rehearsal): fold non-audit sanity flags into finalize ## Warnings (A3)"
```

---

### Task 6: experiment template + ResultJson `integrity` type

**Files:**
- Modify: `config/prompt-templates/rehearsal/experiment.md`
- Modify: `src/core/rehearsalResult.ts` (`ResultJson` interface — type only)
- Test: `tests/rehearsal-cmd.test.ts` (template content assertion)

- [ ] **Step 1: Write the failing test** (append to `tests/rehearsal-cmd.test.ts`; reuse the existing `readFileSync` import):

```ts
describe("experiment template integrity attestation", () => {
  it("instructs the part to emit an integrity block", () => {
    const tpl = readFileSync("config/prompt-templates/rehearsal/experiment.md", "utf8");
    expect(tpl).toContain("\"integrity\"");
    expect(tpl).toContain("split_before_fit");
    expect(tpl).toContain("no_train_test_overlap");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/rehearsal-cmd.test.ts -t "integrity attestation"` → FAIL.

- [ ] **Step 3: Write minimal implementation**:
(a) In `config/prompt-templates/rehearsal/experiment.md`, after the A1 `verify` block bullets (added in A1, under the result.json step), add another bullet:
```markdown
   - Also emit an "integrity" block attesting how you avoided leakage/under-training
     (recorded now, cross-checked later; an incomplete block is flagged as suspect):

       "integrity": {
         "split_before_fit": true,
         "no_train_test_overlap": true,
         "target_not_in_features": true,
         "trained_steps": <int>,
         "seed": <int>
       }

     - All five keys are required for the attestation to count as complete.
     - For a task where a key is genuinely N/A (e.g. a generative run with no
       labels), still set it (e.g. "target_not_in_features": true) and explain in
       "notes". Be honest — these are cross-checked by a later verification pass.
```
(b) In `src/core/rehearsalResult.ts`, add an optional field to the `ResultJson` interface (type only — the harness reads it ad-hoc; this documents the shape):
```ts
  integrity?: {
    split_before_fit?: boolean;
    no_train_test_overlap?: boolean;
    target_not_in_features?: boolean;
    trained_steps?: number;
    seed?: number;
  };
```

- [ ] **Step 4: Run test to verify it passes** — `-t "integrity attestation"` PASS; then `npx vitest run tests/stale-tokens.test.ts` PASS (no banned tokens) and `npm run typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add config/prompt-templates/rehearsal/experiment.md src/core/rehearsalResult.ts tests/rehearsal-cmd.test.ts
git commit -m "feat(rehearsal): experiment template integrity attestation + ResultJson type (A3)"
```

---

### Task 7: Maestro directive — note suspect flags in the loop

**Files:**
- Modify: `commands/rehearsal.md` (the Step-3 verify block added in A1 — extend its point (d), or add a short note)

- [ ] **Step 1: Edit** — in `commands/rehearsal.md`, find the A1 Step-3.5 verify block's point (d) about treating `mismatch` as distrust, and extend it (or add a sibling note) so the Maestro also reacts to A3's suspect flags:

```markdown
     e. `status-brief` also tags suspect results `[suspect: <flags>]` (ceiling-exceeded /
        under-run / log-contradiction / integrity-attestation-incomplete / audit-knob-drift).
        A `[suspect]` result is one whose number may be an artifact (leakage / didn't really run /
        misconfigured knob) — do NOT crown a `[suspect]` leader; note it in `## Recent decisions`.
        Acting on it (re-dispatch / discard) is a later phase.
```

- [ ] **Step 2: Verify** — `npx vitest run tests/stale-tokens.test.ts` PASS. Read the inserted block in context to confirm it sits in the Step-3 verify block and uses consistent voice.

- [ ] **Step 3: Commit**

```bash
git add commands/rehearsal.md
git commit -m "feat(rehearsal): Maestro reacts to suspect flags in the loop (A3)"
```

---

### Task 8: Release — version bump, build, full gate

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (0.1.13 → 0.1.14)
- Modify: `dist/consort.cjs` (rebuilt)

- [ ] **Step 1: Pre-bump gate** — `npm run typecheck && npm run test && npm run lint` → all green.
- [ ] **Step 2: Bump** the three manifests 0.1.13 → 0.1.14.
- [ ] **Step 3: Build** — `npm run build`; sanity `grep -c "sanityFlags\|sanity.tsv" dist/consort.cjs` ≥ 1.
- [ ] **Step 4: Final gate** — `npm run typecheck && npm run test && npm run lint && npx vitest run tests/stale-tokens.test.ts` → all green.
- [ ] **Step 5: Commit**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "chore(release): consort 0.1.14 — rehearsal sanity & integrity gates (A3)"
```

---

## Self-review notes (author)

- **Spec coverage:** §4.1 four checks → Task 1 (+ Task 3 wiring); §4.2 integrity block → Task 1 (completeness) + Task 6 (template/type); §4.3 audit-diff hardening → Task 1 (audit-knob-drift) + Task 3 (per-exp read); §4.4 sanity.tsv + status-brief + finalize fold → Tasks 3/4/5; §5 flow → Tasks 3/4/5/7; §7 template → Task 6; §9 testing → every task; §10 acceptance → Tasks 1/3/4 + Task 8 gate.
- **Snapshot semantics:** `sanity.tsv` is OVERWRITTEN each score pass (Task 3) — documented; avoids per-pass duplication. Finalize fold (Task 5) excludes `audit-knob-drift` to avoid double-counting vs `audit_warn`.
- **Type consistency:** `SanityFlag`/`SanityRow`/`SanityInput` defined in Task 1, imported in Task 3; `sanityFlags`/`sanityRow`/`SANITY_TSV_HEADER` stable; `suspects?: Record<string,string[]>` (Task 4) keyed `instrument/exp` like A1's `verdicts`.
- **Additive / frozen:** new optional `metric.md` fields + optional `integrity` result.json field + new `sanity.tsv` + new module; `scoreboard.md`/`checkCompletion`/A1's `verification.tsv` untouched.
- **Known soft spot:** Task 5 (finalize fold) has no isolated unit test if no finalize-render harness exists — covered by the final adversarial review + the full-suite no-regression check; flagged for the implementer.
```
