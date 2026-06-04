# Rehearsal B2 — Operators & Ideation Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `/consort:rehearsal` Maestro a small typed operator vocabulary (Draft = new family / Improve = single-change on a named parent), back diverse Draft with prompt-level techniques, enforce single-change attribution as a contract, re-ground ideation against the SOTA sweep, and add one light advisory `lineage.tsv` that flags only `improve-multi`.

**Architecture:** Directive-heavy (the bulk lives in `commands/rehearsal.md` + the experiment template). One light mechanical piece reuses the proven A3/B1 arc: a new pure `rehearsalLineage` module + an optional `--parent` flag + a per-exp `lineage.txt` + a `lineage.tsv` snapshot computed in `computeScore` (diffing `audit.json` vs the parent's) and surfaced as a `[multi-change]` top-3 tag. All additive — no frozen wire token, `experiment-send` 5-positional contract, `result.json`, scoreboard schema, or `status` enum touched.

**Tech Stack:** TypeScript (Node/ESM, `.js` import specifiers), vitest, esbuild single-bundle (`dist/consort.cjs`). Pure core modules with injected FS.

**Spec:** `docs/superpowers/specs/2026-06-04-rehearsal-b2-operators-design.md`

**Standing rules for every task:**
- `npm run typecheck` (authoritative) — ignore stale-LSP phantom diagnostics.
- Do NOT run `npm run build` — the release task rebuilds `dist`.
- ESM `.js` import specifiers. No emojis in shipped output. Errors to stderr. Pure modules: no `Date.now()`/`Math.random()`.
- Never weaken `tests/stale-tokens.test.ts`; no `clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_`/`trooper`/`commander`.
- Read each file before editing.

---

### Task 1: New pure core module `rehearsalLineage.ts`

**Files:**
- Create: `src/core/rehearsalLineage.ts`
- Test: `tests/rehearsal-lineage.test.ts`

- [ ] **Step 1: Write the failing test** `tests/rehearsal-lineage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diffAuditKnobs, classifyLineage, lineageRow, LINEAGE_TSV_HEADER } from "../src/core/rehearsalLineage.js";

describe("diffAuditKnobs", () => {
  it("counts numeric-tolerant differing keys over the union", () => {
    expect(diffAuditKnobs({ a: 200, b: 16 }, { a: "200.0", b: 16 })).toBe(0); // 200===200.0, 16===16
    expect(diffAuditKnobs({ a: 200, b: 16 }, { a: 200, b: 32 })).toBe(1);     // b differs
    expect(diffAuditKnobs({ a: 200, b: 16 }, { a: 100, b: 32 })).toBe(2);     // both differ
  });
  it("counts a key present on only one side as a difference", () => {
    expect(diffAuditKnobs({ a: 1 }, { a: 1, c: 9 })).toBe(1);
  });
  it("returns null when either audit is missing (cannot diff)", () => {
    expect(diffAuditKnobs(null, { a: 1 })).toBeNull();
    expect(diffAuditKnobs({ a: 1 }, null)).toBeNull();
  });
});

describe("classifyLineage", () => {
  it("no parent -> draft", () => {
    expect(classifyLineage(undefined, null)).toBe("draft");
    expect(classifyLineage("", 1)).toBe("draft");
  });
  it("parent + exactly one changed knob -> improve-single", () => {
    expect(classifyLineage("exp-001", 1)).toBe("improve-single");
  });
  it("parent + >1 changed knob -> improve-multi", () => {
    expect(classifyLineage("exp-001", 2)).toBe("improve-multi");
  });
  it("parent + 0 changed knobs OR unavailable diff -> improve-unverified", () => {
    expect(classifyLineage("exp-001", 0)).toBe("improve-unverified");
    expect(classifyLineage("exp-001", null)).toBe("improve-unverified");
  });
});

describe("lineageRow + header", () => {
  it("emits a tab-joined row with trailing newline", () => {
    expect(LINEAGE_TSV_HEADER).toBe("exp_id\tinstrument\tparent_id\tknobs_changed\tverdict\tts\n");
    expect(lineageRow({ expId: "exp-002", instrument: "oboe", parentId: "exp-001", knobsChanged: "2", verdict: "improve-multi", ts: "T" }))
      .toBe("exp-002\toboe\texp-001\t2\timprove-multi\tT\n");
  });
});
```

- [ ] **Step 2: Run, confirm RED** (`npx vitest run tests/rehearsal-lineage.test.ts` — module not found).

- [ ] **Step 3: Create `src/core/rehearsalLineage.ts`:**

```ts
// Lineage advisory for /consort:rehearsal (B2 operators & ideation quality). Pure: no FS/clock.
// Records the Draft/Improve edge per experiment; the audit-knob diff vs a named parent classifies
// whether an Improve's metric delta is cleanly attributable. Flag-don't-block (A3 philosophy);
// only "improve-multi" is surfaced by the status brief.

export interface LineageRow {
  expId: string;
  instrument: string;
  parentId: string;
  knobsChanged: string;   // "" for draft / unavailable; the integer count otherwise
  verdict: string;        // draft | improve-single | improve-multi | improve-unverified
  ts: string;
}

export const LINEAGE_TSV_HEADER = "exp_id\tinstrument\tparent_id\tknobs_changed\tverdict\tts\n";

export function lineageRow(r: LineageRow): string {
  return `${r.expId}\t${r.instrument}\t${r.parentId}\t${r.knobsChanged}\t${r.verdict}\t${r.ts}\n`;
}

/** Count mandated knobs that differ (numeric-tolerant) over the union of keys — mirrors the A3
 *  audit-knob-drift compare. Returns null when either audit is missing (cannot diff). A key present
 *  on only one side counts as a difference. */
export function diffAuditKnobs(
  parentAudit: Record<string, unknown> | null,
  childAudit: Record<string, unknown> | null,
): number | null {
  if (!parentAudit || !childAudit) return null;
  const keys = new Set([...Object.keys(parentAudit), ...Object.keys(childAudit)]);
  let n = 0;
  for (const k of keys) {
    const pa = parentAudit[k], ca = childAudit[k];
    const p = parseFloat(String(pa)), c = parseFloat(String(ca));
    const differ = (!Number.isNaN(p) && !Number.isNaN(c)) ? p !== c : String(pa) !== String(ca);
    if (differ) n += 1;
  }
  return n;
}

/** Lineage verdict from the recorded parent + audit-knob diff. No parent -> draft (a deliberate new
 *  angle). 0 changed knobs OR an unavailable diff -> improve-unverified (the change was a non-mandated
 *  knob, or the parent has no audit.json — cannot confirm a single mandated change). */
export function classifyLineage(parentId: string | undefined, knobsChanged: number | null): string {
  if (!parentId) return "draft";
  if (knobsChanged === null || knobsChanged === 0) return "improve-unverified";
  if (knobsChanged === 1) return "improve-single";
  return "improve-multi";
}
```

- [ ] **Step 4: Run, confirm PASS** + `npm run typecheck` clean.

- [ ] **Step 5: Commit:**
```bash
git add src/core/rehearsalLineage.ts tests/rehearsal-lineage.test.ts
git commit -m "feat(rehearsal): B2 rehearsalLineage core (diffAuditKnobs + classifyLineage)"
```

---

### Task 2: `--parent` flag + per-exp `lineage.txt` in `experiment-send`

**Files:**
- Modify: `src/commands/rehearsal.ts` (`ExperimentSendArgs` :373, `parseExperimentSendArgs` :380-396, `experimentSendWith` :438-550)
- Test: `tests/rehearsal-cmd.test.ts` (the `experiment-send` describe block; uses `scaffold(h, over)` ~:293 + `deps(h, over)` ~:310)

- [ ] **Step 1: Write the failing tests** in the `describe("rehearsal experiment-send", ...)` block of `tests/rehearsal-cmd.test.ts`. That block already defines `TOPIC="es-topic"`, `INST="violin"`, `home()`, `scaffold(h, over)` (returns `{ art, sd, pd, o }`), `deps(h, over)`; `experimentDir` is imported at the top. Add:

```ts
  it("--parent with a valid same-lane parent writes lineage.txt and returns 0 (B2)", async () => {
    const h = home();
    const { art } = scaffold(h);
    mkdirSync(experimentDir(art, INST, "exp-001"), { recursive: true });   // the parent exp dir must exist
    const rc = await experimentSendWith(["--parent", "exp-001", TOPIC, INST, "exp-002", "typed-routing", "tweak lr only"], deps(h));
    expect(rc).toBe(0);
    const lp = join(experimentDir(art, INST, "exp-002"), "lineage.txt");
    expect(existsSync(lp)).toBe(true);
    expect(readFileSync(lp, "utf8")).toContain("parent_id=exp-001");
  });
  it("--parent to a non-existent exp returns rc 1 (B2)", async () => {
    const h = home();
    scaffold(h);
    expect(await experimentSendWith(["--parent", "exp-099", TOPIC, INST, "exp-002", "x", "y"], deps(h))).toBe(1);
  });
  it("no --parent writes no lineage.txt (Draft) and returns 0 (B2)", async () => {
    const h = home();
    const { art } = scaffold(h);
    expect(await experimentSendWith([TOPIC, INST, "exp-001", "single-pass", "baseline"], deps(h))).toBe(0);
    expect(existsSync(join(experimentDir(art, INST, "exp-001"), "lineage.txt"))).toBe(false);
  });
```
Keep the existing 5-positional rc-2 "wrong arg count" test passing (the flag is additive — 5 positionals after the flags is unchanged). `mkdirSync`/`join`/`existsSync`/`readFileSync` are already imported in this test file.

- [ ] **Step 2: Run, confirm RED** (`--parent` not parsed → treated as a flag-break → rc 2, or no lineage.txt written).

- [ ] **Step 3: Implement** in `src/commands/rehearsal.ts`:

(a) `ExperimentSendArgs` (:373) — add optional `parentId`:
```ts
interface ExperimentSendArgs {
  topic: string; instrument: string; expId: string; approachLabel: string; approachBrief: string;
  inputs?: string; contextFile?: string; smokeTest?: string; timeout?: string; parentId?: string;
  badArgs?: boolean;
}
```

(b) `parseExperimentSendArgs` — declare `let parentId` beside the other flag vars and add a branch in the flags-first loop (after the `--timeout` branch), then thread it through both returns. Replace the function body's flag section + return:
```ts
  let inputs: string | undefined, contextFile: string | undefined, smokeTest: string | undefined, timeout: string | undefined, parentId: string | undefined;
```
add the branch:
```ts
    else if (a === "--parent" || a.startsWith("--parent=")) { const r = kvParse(a, args[i + 1]); parentId = r.value; i += r.shift - 1; }
```
and the success return:
```ts
  return { topic, instrument, expId, approachLabel, approachBrief, inputs, contextFile, smokeTest, timeout, parentId };
```
(the two `badArgs: true` returns are unchanged.)

(c) `experimentSendWith` — validate the parent after the phase gate (after the `phase !== "idle"` check at :483, before the branch-dir block at :485). `art` and `instrument` are in scope:
```ts
  // --parent (B2): same-lane parent exp must exist (lineage is recorded for the advisory diff).
  if (p.parentId !== undefined) {
    if (!EXP_ID_RE.test(p.parentId)) { log.error(`rehearsal experiment-send: --parent must match exp-[0-9]+; got '${p.parentId}'`); return 2; }
    if (!existsSync(experimentDir(art, instrument, p.parentId))) { log.error(`rehearsal experiment-send: --parent ${p.parentId} has no experiment dir under ${instrument}`); return 1; }
  }
```

(d) Write `lineage.txt` at dispatch — alongside the `prompt.md` write (:535), after `mkdirSync(join(branchDir, "code"), ...)` (:487) guarantees `branchDir` exists. Add right after the `atomicWrite(join(branchDir, "prompt.md"), prompt);` line (:535):
```ts
  if (p.parentId !== undefined) atomicWrite(join(branchDir, "lineage.txt"), `parent_id=${p.parentId}\n`);
```

- [ ] **Step 4: Run** `npx vitest run tests/rehearsal-cmd.test.ts` (PASS), `npm run typecheck` (clean).

- [ ] **Step 5: Commit:**
```bash
git add src/commands/rehearsal.ts tests/rehearsal-cmd.test.ts
git commit -m "feat(rehearsal): B2 experiment-send --parent flag + per-exp lineage.txt"
```

---

### Task 3: Lineage classification in `computeScore`

**Files:**
- Modify: `src/core/rehearsalScore.ts` (`ScoreComputation` :34-43, `computeScore` walk :100-117 + return :131)
- Test: `tests/rehearsal-core.test.ts` (the `computeScore` block; `fakeFs(files)` harness, art `"/a"`)

- [ ] **Step 1: Write the failing test** in `tests/rehearsal-core.test.ts` (full result.json shape; `audit.json` is a sibling file in the exp dir; `lineage.txt` is the per-exp marker):

```ts
  it("classifies lineage from lineage.txt + parent audit diff (B2)", () => {
    const okR = (label: string, mv: number) => JSON.stringify({
      branch_id:"b",approach_label:label,metric_name:"accuracy",metric_value:mv,status:"ok",
      runtime_s:5,log_paths:[],checkpoint_path:null,notes:"" });
    const files: Record<string, string> = {
      "/a/metric.md": "**Primary metric:** accuracy\n**Direction:** maximize\n",
      "/a/parts/oboe/experiments/exp-001/result.json": okR("single-pass", 0.90),
      "/a/parts/oboe/experiments/exp-001/audit.json": JSON.stringify({ lr: 0.1, depth: 4 }),
      "/a/parts/oboe/experiments/exp-002/result.json": okR("single-pass", 0.93),
      "/a/parts/oboe/experiments/exp-002/audit.json": JSON.stringify({ lr: 0.2, depth: 4 }), // 1 knob changed
      "/a/parts/oboe/experiments/exp-002/lineage.txt": "parent_id=exp-001\n",
      "/a/parts/oboe/experiments/exp-003/result.json": okR("single-pass", 0.95),
      "/a/parts/oboe/experiments/exp-003/audit.json": JSON.stringify({ lr: 0.3, depth: 8 }), // 2 knobs changed
      "/a/parts/oboe/experiments/exp-003/lineage.txt": "parent_id=exp-002\n",
    };
    const c = computeScore("/a", fakeFs(files), () => "T");
    const byExp = Object.fromEntries(c.lineageRows.map((r) => [r.expId, r.verdict]));
    expect(byExp["exp-001"]).toBe("draft");            // no lineage.txt
    expect(byExp["exp-002"]).toBe("improve-single");   // 1 knob changed vs exp-001
    expect(byExp["exp-003"]).toBe("improve-multi");    // 2 knobs changed vs exp-002
  });
```

- [ ] **Step 2: Run, confirm RED** (`c.lineageRows` undefined).

- [ ] **Step 3: Implement** in `src/core/rehearsalScore.ts`:

(a) Import (after the `rehearsalCoverage` import):
```ts
import { diffAuditKnobs, classifyLineage, type LineageRow } from "./rehearsalLineage.js";
```

(b) `ScoreComputation` — add `lineageRows: LineageRow[];` (after `coverageRows` / `sanityRows`).

(c) Accumulator beside `sanityRows`: `const lineageRows: LineageRow[] = [];`

(d) In the walk, after the sanity/infeasible block (after `if (infReason) scoreRow.infeasibleReason = infReason;`), add lineage classification. `branchDir` and `auditObj` are in scope (auditObj read at ~:102-103):
```ts
      const lineageTxt = fs.read(join(branchDir, "lineage.txt"));
      const parentId = lineageTxt ? (parseState(lineageTxt).parent_id ?? "") : "";
      let knobs: number | null = null;
      if (parentId) {
        const parentAuditRaw = fs.read(join(experimentDir(art, instrument, parentId), "audit.json"));
        let parentAudit: Record<string, unknown> | null = null;
        if (parentAuditRaw) { try { parentAudit = JSON.parse(parentAuditRaw) as Record<string, unknown>; } catch { parentAudit = null; } }
        knobs = diffAuditKnobs(parentAudit, auditObj);
      }
      lineageRows.push({ expId, instrument, parentId,
        knobsChanged: knobs === null ? "" : String(knobs),
        verdict: classifyLineage(parentId || undefined, knobs), ts: now() });
```
(`parseState` and `experimentDir` are already imported in this file.)

(e) Return literal — add `lineageRows`.

- [ ] **Step 4: Run** the new test (PASS), `npm run typecheck` (clean — `ScoreComputation` now requires `lineageRows`; the only producer is `computeScore`, and `scoreWith`'s real path passes the live result; any test mock that builds a full `ScoreComputation` literal needs `lineageRows: []` — Task 4's scoreWith test will include it; search `coverageRows:` in tests to find any existing mock and add `lineageRows: []`).

- [ ] **Step 5: Commit:**
```bash
git add src/core/rehearsalScore.ts tests/rehearsal-core.test.ts
git commit -m "feat(rehearsal): B2 lineage classification in computeScore (lineageRows)"
```

---

### Task 4: `scoreWith` snapshot + `statusBriefWith` join + `[multi-change]` brief tag

**Files:**
- Modify: `src/commands/rehearsal.ts` (import; `scoreWith` :614-623 write order; `statusBriefWith` :823-846 join), `src/core/rehearsalBrief.ts` (`StatusBriefInput` :18-27, top-3 render :79-85)
- Test: `tests/rehearsal-cmd.test.ts` (scoreWith/statusBriefWith) + `tests/rehearsal-core.test.ts` (`buildStatusBrief` block ~:1003)

- [ ] **Step 1: Write the failing tests.**

In `tests/rehearsal-core.test.ts` `buildStatusBrief` block (the `[multi-change]` render):
```ts
  it("tags an improve-multi top-3 leader with [multi-change] (B2)", () => {
    const sb =
      "| Rank | Exp | Instrument | Metric | Status | Runtime | Approach | Metric name |\n" +
      "|---|---|---|---|---|---|---|---|\n" +
      "| 1 | exp-003 | oboe | 0.95 | ok | 5 | single-pass | accuracy |\n";
    const out = buildStatusBrief({
      parts: [], scoreboardMd: sb, completion: SIG,
      multiChange: { "oboe/exp-003": true },
    });
    expect(out).toContain("1. oboe/exp-003");
    expect(out).toContain("[multi-change]");
  });
  it("does not tag when no multi-change data (back-compat)", () => {
    const sb =
      "| Rank | Exp | Instrument | Metric | Status | Runtime | Approach | Metric name |\n" +
      "|---|---|---|---|---|---|---|---|\n" +
      "| 1 | exp-003 | oboe | 0.95 | ok | 5 | single-pass | accuracy |\n";
    const out = buildStatusBrief({ parts: [], scoreboardMd: sb, completion: SIG });
    expect(out).not.toContain("[multi-change]");
  });
```
In `tests/rehearsal-cmd.test.ts` (scoreWith writes lineage.tsv) — mirror the existing coverage.tsv scoreWith test, injecting a `computeScore` that returns `lineageRows: [{ expId:"exp-003", instrument:"oboe", parentId:"exp-002", knobsChanged:"2", verdict:"improve-multi", ts:"T" }]` (and `coverageRows: []`, `sanityRows: []`, …) and asserting the captured `lineage.tsv` write equals `"exp_id\tinstrument\tparent_id\tknobs_changed\tverdict\tts\nexp-003\toboe\texp-002\t2\timprove-multi\tT\n"`.

- [ ] **Step 2: Run, confirm RED.**

- [ ] **Step 3: Implement.**

(a) `src/commands/rehearsal.ts` import (after the `rehearsalCoverage` import):
```ts
import { lineageRow, LINEAGE_TSV_HEADER, type LineageRow } from "../core/rehearsalLineage.js";
```

(b) `scoreWith` — write `lineage.tsv` snapshot immediately after the `coverage.tsv` write, before the warnings loop:
```ts
  deps.writeAtomic(join(art, "lineage.tsv"), LINEAGE_TSV_HEADER + c.lineageRows.map(lineageRow).join(""));
```

(c) `statusBriefWith` — after the coverage.tsv join block, add the lineage join → a `multiChange` presence map:
```ts
  const ltsv = join(art, "lineage.tsv");
  let multiChange: Record<string, boolean> | undefined;
  if (existsSync(ltsv)) {
    multiChange = {};
    for (const line of readFileSync(ltsv, "utf8").split("\n")) {
      if (!line || line.startsWith("exp_id\t")) continue;
      const cells = line.split("\t");            // exp_id, instrument, parent_id, knobs_changed, verdict, ts
      if (cells[0] && cells[1] && cells[4] === "improve-multi") multiChange[`${cells[1]}/${cells[0]}`] = true;
    }
  }
```
and pass `multiChange` into the `buildStatusBrief({ ... })` call.

(d) `src/core/rehearsalBrief.ts` — `StatusBriefInput` gains (after `coverage?`):
```ts
  /** instrument/exp -> improve-multi (B2), joined from lineage.tsv; omit for back-compat (no tag). */
  multiChange?: Record<string, boolean>;
```
and in the top-3 row render (where `tag`/`stag` are built), append a multi-change tag:
```ts
        const mc = input.multiChange?.[`${r.instrument}/${r.exp}`] ? " [multi-change]" : "";
        sb.push(`${r.rank}. ${r.instrument}/${r.exp} — ${r.metric} — ${r.metricName}${tag}${stag}${mc}`);
```
(replace the existing `sb.push(...)` line so `${mc}` is appended after `${stag}`.)

- [ ] **Step 4: Run** `npx vitest run tests/rehearsal-core.test.ts tests/rehearsal-cmd.test.ts` (PASS), `npm run typecheck` (clean).

- [ ] **Step 5: Commit:**
```bash
git add src/commands/rehearsal.ts src/core/rehearsalBrief.ts tests/rehearsal-core.test.ts tests/rehearsal-cmd.test.ts
git commit -m "feat(rehearsal): B2 wire lineage.tsv snapshot + [multi-change] brief tag"
```

---

### Task 5: Finalize folds `improve-multi` into `## Warnings`

**Files:**
- Modify: `src/commands/rehearsal.ts` (the finalize sanity-fold block ~:1101-1112)
- Test: `tests/rehearsal-finalize.test.ts` (the finalize/warnings tests)

- [ ] **Step 1: Write the failing test** in `tests/rehearsal-finalize.test.ts` (mirror the existing sanity-fold warnings test — read the file to find how it seeds `sanity.tsv` + asserts `warnings.txt`; do the same with a `lineage.tsv` containing an `improve-multi` row, asserting `warnings.txt` contains a `lineage` / `improve-multi` row).

- [ ] **Step 2: Run, confirm RED.**

- [ ] **Step 3: Implement** — after the A3 sanity-fold block (the one ending `if (extra.length) appendFileSync(warningsPath, extra.join("\n") + "\n");` at ~:1111), add a parallel lineage fold:
```ts
  // B2: fold improve-multi lineage rows into warnings.txt (advisory: delta not cleanly attributable).
  const lineageTsv = join(art, "lineage.tsv");
  if (existsSync(lineageTsv)) {
    const extra: string[] = [];
    for (const line of readFileSync(lineageTsv, "utf8").split("\n")) {
      if (!line || line.startsWith("exp_id\t")) continue;
      const c = line.split("\t");                 // exp_id, instrument, parent_id, knobs_changed, verdict, ts
      if (c[4] !== "improve-multi") continue;
      if (c[0] && c[1]) extra.push(`lineage\t${c[1]}/${c[0]}\timprove-multi\tparent=${c[2] ?? ""} knobs_changed=${c[3] ?? ""}`);
    }
    if (extra.length) appendFileSync(warningsPath, extra.join("\n") + "\n");
  }
```

- [ ] **Step 4: Run** `npx vitest run tests/rehearsal-finalize.test.ts` (PASS), `npm run typecheck` (clean).

- [ ] **Step 5: Commit:**
```bash
git add src/commands/rehearsal.ts tests/rehearsal-finalize.test.ts
git commit -m "feat(rehearsal): B2 finalize folds improve-multi into warnings"
```

---

### Task 6: Directive + template edits

**Files:**
- Modify: `config/prompt-templates/rehearsal/experiment.md`, `commands/rehearsal.md`

- [ ] **Step 1: Edit the experiment template** `config/prompt-templates/rehearsal/experiment.md`:
  - In/near the existing **"Simplicity bias"** prose, add an early-round complexity cue: *"Early experiments should be the simplest thing that could work — establish a baseline before adding machinery; go deeper only once a baseline exists (over-engineering on turn one is the most common failure)."*
  - Add an **Improve contract** note in the "Your experiment" area: *"If your approach brief says you are improving on a prior experiment (a parent), change exactly ONE variable vs that parent so the metric delta is attributable — isolate first, combine only after each change is attributed."*
  - Do NOT add a new `{{TOKEN}}` (the parent context rides in `{{APPROACH_BRIEF}}`; `renderExperimentPrompt` throws on an unrendered token).

- [ ] **Step 2: Edit the directive** `commands/rehearsal.md`:
  - **Step 5 dispatch — typed operators:** add guidance that each dispatch is one of two operators:
    - **Draft** = open a NEW orthogonal approach family (use when `Coverage:` is `(short by K)` or a new angle is warranted). To diversify the Draft: pick an orthogonal **discovery lens** (mechanism-swap / representation-change / constraint-relaxation / objective-reframe / decomposition); **verbalized sampling** — enumerate ~3-5 candidate angles before committing (the candidate set is for diversity; do not act on any self-assigned probabilities); and an **avoid-set** = the current leader + already-tried families from the `Coverage:` line.
    - **Improve** = a single-variable change on a named parent: pass `--parent <exp-id>` (a prior exp of the SAME part) to `experiment-send` and change exactly ONE variable vs it, named in the brief.
  - **SOTA re-grounding:** add `$ART/sota.md` to the Step-5 selection inputs and instruct: "diff the sweep's `family` column against the `Coverage:` line; prefer an untried known family when Drafting."
  - **Ranking:** affirm — dispatch the diverse angles and let the real (verified) metric rank them post-hoc; do NOT pre-rank un-run ideas.
  - **`[multi-change]` reading note** (in the Step 3 scoreboard-reading guidance, near the Coverage note): "a top-3 leader tagged `[multi-change]` had >1 knob changed vs its parent — its metric delta is not cleanly attributable; don't over-trust it, consider an isolating single-change Improve."
  - Keep all additions in "part"/"Maestro"/"instrument" vocabulary (stale-token gate).

- [ ] **Step 3: Verify the stale-token gate** `npx vitest run tests/stale-tokens.test.ts` (7/7) + a banned-token grep on both files.

- [ ] **Step 4: Commit:**
```bash
git add config/prompt-templates/rehearsal/experiment.md commands/rehearsal.md
git commit -m "docs(rehearsal): B2 directive — typed Draft/Improve operators + SOTA re-grounding + [multi-change] note"
```

---

### Task 7: Release — version bump, build, full gate, dist commit

**Files:** `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (0.1.17 → 0.1.18), `dist/consort.cjs`

- [ ] **Step 1: Bump all three manifests** 0.1.17 → 0.1.18.
- [ ] **Step 2: Full pre-build gate:** `npm run typecheck && npm run test && npm run lint && npx vitest run tests/stale-tokens.test.ts` — all green.
- [ ] **Step 3: Build:** `npm run build`.
- [ ] **Step 4: Post-build sanity:** `npm run typecheck && npx vitest run tests/stale-tokens.test.ts`.
- [ ] **Step 5: Commit:**
```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "release(rehearsal): B2 operators & ideation quality (0.1.18)"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** Task 1 = §5.2 (rehearsalLineage); Task 2 = §5.1 (`--parent` + lineage.txt); Task 3 = §5.3 (computeScore classify); Task 4 = §5.3/§5.4 (snapshot + `[multi-change]` tag); Task 5 = §5.4 (finalize fold); Task 6 = §3/§4 (typed operators + diverse Draft + Improve contract + SOTA re-grounding + template); Task 7 = §10 AC#8 release.
- **Type consistency:** `LineageRow { expId; instrument; parentId; knobsChanged; verdict; ts }`, `LINEAGE_TSV_HEADER`, `lineageRow`, `diffAuditKnobs`, `classifyLineage` identical across Tasks 1/3/4/5. `ScoreComputation.lineageRows` (required) vs `StatusBriefInput.multiChange?` (optional, back-compat — mirrors `coverage?`/`suspects?`).
- **Snapshot discipline:** Task 4 writes `lineage.tsv` wholesale (`HEADER + rows.join("")`), never append — `computeScore` re-walks all experiments.
- **Surfacing discipline (the design's core call):** ONLY `improve-multi` is surfaced (brief tag + finalize warning). `draft`/`improve-single`/`improve-unverified` are recorded in `lineage.tsv` but never flagged — `improve-unverified` especially (audit.json only covers mandated knobs, so most Improves land there; flagging the majority is the A3 noisy-flag anti-pattern).
- **Frozen contracts:** `experiment-send` 5 positionals byte-identical (the flag is additive); `result.json`, `status` enum, scoreboard schema + integer-rank parse, A1/A2/A3/B1 state files untouched. `lineage.txt`/`lineage.tsv` are NEW files; `--parent` is a NEW additive flag; no new template token.
- **Existing-test fallout:** widening `ScoreComputation` (Task 3) may break a `ScoreComputation` literal in a scoreWith test — Task 3/4 add `lineageRows: []`/the live value; grep `coverageRows:` in tests to find any literal and patch it.
