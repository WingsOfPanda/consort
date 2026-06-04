# Post-simplify Cleanups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the three worth-doing items the `/simplify` sweep skipped — `readIfExistsOrNull` consolidation (Item 1), `drilldownWith` arity decode (Item 3c), and rehearsal-init strict parsing with a central `KvError`→rc-2 catch (Item 3b).

**Architecture:** Item 1 and 3c are behavior-preserving refactors guarded by the existing suite plus characterization tests. Item 3b is a deliberate, small behavior change: `parseInitArgs` routes through the shared `kvParse` (a missing flag value now throws `KvError` instead of binding `undefined`), and a new side-effect-free `src/core/dispatch.ts` helper converts that `KvError` into a clean rc-2 message for every command.

**Tech Stack:** TypeScript (Node/ESM), esbuild single-bundle `dist/consort.cjs`, vitest. Spec: `docs/superpowers/specs/2026-06-04-post-simplify-cleanups-design.md`.

**Branch:** continue on `chore/simplify-sweep` (already has the first three cleanups at `5397f53`). One commit per task.

**Standing rules (all tasks):** never weaken `tests/stale-tokens.test.ts`; do not stage/commit/delete the untracked `target-user-analysis.{html,md}`; no emojis in shipped output; errors to stderr. **Implementers: do NOT run `npm run build`** — the final release task (Task 4) owns the dist rebuild.

---

### Task 1: Item 1 — `readIfExistsOrNull` consolidation (non-quarantined sites)

Pure refactor: replace byte-identical inline `existsSync(p) ? readFileSync(p, "utf8") : null` with the existing `readIfExistsOrNull` helper (`src/core/fsread.ts:9`). No new tests — the existing suite exercises these paths and is the safety net. **Do not touch** the quarantined wait-function reads (score `researchWaitWith`/`verifyWaitWith` lines 284/399; prelude `researchWaitWith`/`adversaryWaitWith` lines 224/339), `perform.ts`, or any `:""`/`.trim()`/custom-fallback/`JSON.parse` variant.

**Files:**
- Modify: `src/commands/score.ts` (import line 29; sites 486, 584)
- Modify: `src/commands/prelude.ts` (import line 30; site 369)
- Modify: `src/commands/rehearsal.ts` (add import near line 9; 15 sites)

- [ ] **Step 1: Widen the score.ts fsread import**

Replace `src/commands/score.ts:29`:
```ts
import { readIfExists as readIf } from "../core/fsread.js";
```
with:
```ts
import { readIfExists as readIf, readIfExistsOrNull } from "../core/fsread.js";
```

- [ ] **Step 2: Swap the two non-quarantined score.ts sites**

`src/commands/score.ts:486` (inside `waitGateRun`'s `rows.map`):
```ts
      stateText: existsSync(stateFile) ? readFileSync(stateFile, "utf8") : null,
```
→
```ts
      stateText: readIfExistsOrNull(stateFile),
```

`src/commands/score.ts:584` (inside `drilldownWith`'s `Promise.all`):
```ts
    const fileText = existsSync(j.outPath) ? readFileSync(j.outPath, "utf8") : null;
```
→
```ts
    const fileText = readIfExistsOrNull(j.outPath);
```

- [ ] **Step 3: Widen the prelude.ts import and swap its non-quarantined site**

Replace `src/commands/prelude.ts:30`:
```ts
import { readIfExists as readIf } from "../core/fsread.js";
```
with:
```ts
import { readIfExists as readIf, readIfExistsOrNull } from "../core/fsread.js";
```
Then `src/commands/prelude.ts:369` (inside `preludeWaitGateRun`'s `rows.map`):
```ts
      stateText: existsSync(stateFile) ? readFileSync(stateFile, "utf8") : null,
```
→
```ts
      stateText: readIfExistsOrNull(stateFile),
```

- [ ] **Step 4: Add the fsread import to rehearsal.ts**

After `src/commands/rehearsal.ts:9` (`import { atomicWrite } from "../core/atomic.js";`) — note the file already imports `splitNonCommentLines` on the next line — add:
```ts
import { readIfExistsOrNull } from "../core/fsread.js";
```

- [ ] **Step 5: Swap the 15 rehearsal.ts sites**

Apply these exact replacements (use `replace_all` where noted; verify the stated occurrence count):

| # | Old | New |
|---|---|---|
| 606 | `const baseline = existsSync(baselinePath) ? readFileSync(baselinePath, "utf8") : null;` | `const baseline = readIfExistsOrNull(baselinePath);` |
| 612 | `const sotaBlock = buildSotaBlock(existsSync(sotaPath) ? readFileSync(sotaPath, "utf8") : null);` | `const sotaBlock = buildSotaBlock(readIfExistsOrNull(sotaPath));` |
| 731 | `    read: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),` | `    read: readIfExistsOrNull,` |
| 782 | `    existsSync(cursorFile) ? readFileSync(cursorFile, "utf8") : null,` | `    readIfExistsOrNull(cursorFile),` |
| 783 | `    existsSync(rescanFile) ? readFileSync(rescanFile, "utf8") : null,` | `    readIfExistsOrNull(rescanFile),` |
| 844 | `const scoreboardMd = existsSync(sbPath) ? readFileSync(sbPath, "utf8") : null;` | `const scoreboardMd = readIfExistsOrNull(sbPath);` |
| 1309 | `const halt = readHaltFlag(existsSync(haltPath) ? readFileSync(haltPath, "utf8") : null);` | `const halt = readHaltFlag(readIfExistsOrNull(haltPath));` |
| 1763 | `readInput: (art, i, e, rel) => { const p = join(experimentDir(art, i, e), rel); return existsSync(p) ? readFileSync(p, "utf8") : null; },` | `readInput: (art, i, e, rel) => { const p = join(experimentDir(art, i, e), rel); return readIfExistsOrNull(p); },` |
| 1769/1785/1793 (**replace_all, 3×**) | `readMetricMd: (art) => { const p = join(art, "metric.md"); return existsSync(p) ? readFileSync(p, "utf8") : null; },` | `readMetricMd: (art) => readIfExistsOrNull(join(art, "metric.md")),` |
| 1770/1794 (**replace_all, 2×**) | `readStdout: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),` | `readStdout: readIfExistsOrNull,` |
| 1771/1795 (**replace_all, 2×**) | `readJson: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),` | `readJson: readIfExistsOrNull,` |

After editing, confirm with `grep -n 'existsSync(\(p\|baselinePath\|sotaPath\|cursorFile\|rescanFile\|sbPath\|haltPath\)) ? readFileSync' src/commands/rehearsal.ts` that none of the swapped sites remain (the `:""`, `.trim()`, `JSON.parse`, and `TSV_HEADER`-fallback lines correctly still match a broader grep — leave those).

- [ ] **Step 6: Typecheck, lint, and run the full suite (the refactor's safety net)**

```bash
npm run typecheck && npm run lint && npm run test
```
Expected: typecheck clean, lint clean, **1220 tests pass** (no count change — this is behavior-preserving; if any test fails, a swap was not byte-identical — revert that one site).

- [ ] **Step 7: Commit**

```bash
git add src/commands/score.ts src/commands/prelude.ts src/commands/rehearsal.ts
git commit -m "refactor: route non-quarantined :null file reads through readIfExistsOrNull

Item 1 of the post-simplify cleanups. Swaps ~18 byte-identical inline
existsSync(p)?readFileSync(p,'utf8'):null sites (score/prelude waitGate +
drilldown, all rehearsal lambda/body reads) to the existing fsread helper.
The 5 quarantined turn-wait reads and perform.ts are deliberately untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Item 3c — `drilldownWith` arity decode (TDD characterization)

Replace the `n===8/9/10` index-juggling in `drilldownWith` with a validated formula. The two new tests pin the currently-untested n=8 and n=10 arities; they pass BEFORE and AFTER the refactor (characterization tests guarding a behavior-preserving change — not a fail-first test).

**Files:**
- Test: `tests/score-escalation.test.ts` (add 2 tests in the existing `describe("score drilldown", ...)` block, ~line 372)
- Modify: `src/commands/score.ts:560-563`

- [ ] **Step 1: Add the n=8 and n=10 characterization tests**

In `tests/score-escalation.test.ts`, inside the existing `describe("score drilldown", () => { ... })` block (after the "all-empty round" test, before the closing `});` near line 373), add:
```ts
  it("n=8 (subproject only) → K=1, subproject flows into the resolved path", async () => {
    const art = scoreArtDir("t"); const dd = join(art, "drilldowns"); mkdirSync(join(dd, "_scratch"), { recursive: true });
    writeFileSync(join(art, "doc.md"), "# doc\n"); mkdirSync(partDir("viola", "codex", "t"), { recursive: true });
    const sends: string[][] = [];
    const rc = await drilldownWith(
      ["t", "Architecture", dd, "", join(art, "doc.md"), "viola", "codex", "apisub"],
      { offsetFor: () => 0, send: async (a) => { sends.push(a); return 0; },
        wait: async () => ({ event: "done" }), multiplier: () => "1.0" },
      { writeProbe: (p: string) => writeFileSync(p, "notes\n") },
    );
    expect(rc).toBe(0);
    expect(sends.length).toBe(1); // subproject is rest[7], NOT a second part
    expect(existsSync(join(dd, "_scratch", "drilldown-architecture-apisub-viola.md"))).toBe(true);
  });
  it("n=10 (i2 m2 subproject) → K=2 parts, both files carry the subproject", async () => {
    const art = scoreArtDir("t"); const dd = join(art, "drilldowns"); mkdirSync(join(dd, "_scratch"), { recursive: true });
    writeFileSync(join(art, "doc.md"), "# doc\n");
    mkdirSync(partDir("viola", "codex", "t"), { recursive: true });
    mkdirSync(partDir("cello", "gemini", "t"), { recursive: true });
    const sends: string[][] = [];
    const rc = await drilldownWith(
      ["t", "Architecture", dd, "", join(art, "doc.md"), "viola", "codex", "cello", "gemini", "apisub"],
      { offsetFor: () => 0, send: async (a) => { sends.push(a); return 0; },
        wait: async () => ({ event: "done" }), multiplier: () => "1.0" },
      { writeProbe: (p: string) => writeFileSync(p, "notes\n") },
    );
    expect(rc).toBe(0);
    expect(sends.length).toBe(2); // i2=cello parsed as a second part
    expect(existsSync(join(dd, "_scratch", "drilldown-architecture-apisub-viola.md"))).toBe(true);
    expect(existsSync(join(dd, "_scratch", "drilldown-architecture-apisub-cello.md"))).toBe(true);
  });
```

- [ ] **Step 2: Run the new tests against the CURRENT code (they must pass)**

Run: `npx vitest run tests/score-escalation.test.ts -t "drilldown"`
Expected: PASS for both new tests (they characterize the current decode). If either fails, the assertion does not match current behavior — fix the test before refactoring.

- [ ] **Step 3: Replace the arity decode with the formula**

`src/commands/score.ts:560-563`:
```ts
  let i2 = "", m2 = "", subproject = "";
  if (n === 8) subproject = rest[7];
  else if (n === 9) { i2 = rest[7]; m2 = rest[8]; }
  else if (n === 10) { i2 = rest[7]; m2 = rest[8]; subproject = rest[9]; }
```
→
```ts
  const subproject = (n === 8 || n === 10) ? rest[n - 1] : "";
  const [i2, m2] = n >= 9 ? [rest[7], rest[8]] : ["", ""];
```

- [ ] **Step 4: Run the drilldown tests again (still green)**

Run: `npx vitest run tests/score-escalation.test.ts -t "drilldown"`
Expected: PASS — all drilldown tests (existing K=1/bad-arg + the new n=8/n=10) green, proving the refactor preserved behavior across all four arities.

- [ ] **Step 5: Typecheck, lint, full suite**

```bash
npm run typecheck && npm run lint && npm run test
```
Expected: clean; **1222 tests pass** (1220 + 2 new).

- [ ] **Step 6: Commit**

```bash
git add tests/score-escalation.test.ts src/commands/score.ts
git commit -m "refactor(score): formula-decode drilldown arity; pin n=8/n=10

Item 3c. Replaces the n===8/9/10 index-juggling in drilldownWith with a
validated formula (provably identical across n=7..10). Adds characterization
tests for the previously-untested n=8 (subproject-only) and n=10 arities.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Item 3b — rehearsal-init strict parsing + central `KvError`→rc-2 catch

Route `parseInitArgs` through the shared `kvParse` (missing trailing flag value now throws `KvError` instead of binding `undefined`), and add a side-effect-free `src/core/dispatch.ts` that converts a thrown `KvError` into a clean rc-2 message for every command. `dispatch` lives in its own module (NOT inlined in `consort.ts main()`) so tests can import it without triggering `main()`'s top-level `process.exit`.

**Files:**
- Create: `src/core/dispatch.ts`
- Create: `tests/dispatch.test.ts`
- Modify: `src/consort.ts` (lines 1-6 imports + `type Handler`; line 55 `return fn(resolved);`)
- Modify: `src/commands/rehearsal.ts` (`parseInitArgs`, lines 76-89)
- Test: `tests/rehearsal-cmd.test.ts` (add 1 test in `describe("rehearsal init", ...)`)

- [ ] **Step 1: Write the failing dispatch unit tests**

Create `tests/dispatch.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { dispatch } from "../src/core/dispatch.js";
import { KvError } from "../src/args.js";

describe("dispatch", () => {
  it("returns the handler's exit code on success", async () => {
    expect(await dispatch(async () => 0, [])).toBe(0);
    expect(await dispatch(async () => 3, [])).toBe(3);
  });

  it("converts a KvError into rc 2 with the message on stderr", async () => {
    const errs: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (s: string) => { errs.push(String(s)); return true; };
    let rc = -1;
    try { rc = await dispatch(async () => { throw new KvError("--metric"); }, []); }
    finally { (process.stderr as any).write = orig; }
    expect(rc).toBe(2);
    expect(errs.join("")).toContain("--metric requires a value");
  });

  it("re-throws a non-KvError (so it still hits the top-level rc-1 crash handler)", async () => {
    await expect(dispatch(async () => { throw new Error("boom"); }, [])).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 2: Run the dispatch tests to verify they fail**

Run: `npx vitest run tests/dispatch.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/dispatch.js"` (module does not exist yet).

- [ ] **Step 3: Create `src/core/dispatch.ts`**

```ts
import { KvError } from "../args.js";

export type Handler = (args: string[]) => Promise<number>;

/** Run a subcommand handler, converting a KvError (a missing flag value) into a clean rc-2
 *  message on stderr. Any other error propagates to the top-level crash handler (rc 1 + stack). */
export async function dispatch(fn: Handler, args: string[]): Promise<number> {
  try {
    return await fn(args);
  } catch (e) {
    if (e instanceof KvError) {
      process.stderr.write(`${e.message}\n`);
      return e.code;
    }
    throw e;
  }
}
```

- [ ] **Step 4: Run the dispatch tests to verify they pass**

Run: `npx vitest run tests/dispatch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `dispatch` into `consort.ts`**

In `src/consort.ts`, add the import after line 4 (`import { renderBannerHead, ansiFromColor } from "./core/colors.js";`):
```ts
import { dispatch, type Handler } from "./core/dispatch.js";
```
Delete the now-duplicate local type at line 6:
```ts
type Handler = (args: string[]) => Promise<number>;
```
Change the last line of `main()` (line 55) from:
```ts
  return fn(resolved);
```
to:
```ts
  return dispatch(fn, resolved);
```

- [ ] **Step 6: Write the failing rehearsal-init missing-value test**

In `tests/rehearsal-cmd.test.ts`, inside `describe("rehearsal init", () => { ... })`, add (the `home()` helper and `okDeps` already exist in this file):
```ts
  it("a value flag with no value (trailing) throws KvError (missing flag value)", async () => {
    const h = home();
    await expect(initWith(["--metric"], okDeps({ opts: { home: h.home, cwd: h.home } })))
      .rejects.toThrow(/--metric requires a value/);
  });
```

- [ ] **Step 7: Run the new init test to verify it fails**

Run: `npx vitest run tests/rehearsal-cmd.test.ts -t "no value"`
Expected: FAIL — current `parseInitArgs` binds `undefined` (no throw); `initWith(["--metric"], ...)` resolves to rc 2 instead of rejecting.

- [ ] **Step 8: Route `parseInitArgs` through `kvParse`**

Replace the body of the `if (a.startsWith("--"))` branch in `src/commands/rehearsal.ts` `parseInitArgs` (lines 79-87):
```ts
      const eq = a.indexOf("=");
      const flag = eq > 0 ? a.slice(0, eq) : a;
      const inline = eq > 0 ? a.slice(eq + 1) : undefined;
      const val = (): string | undefined => inline ?? args[++i];
      if (flag === "--seed-from") seedFrom = val();
      else if (flag === "--time-budget") timeBudget = val();
      else if (flag === "--metric") metric = val();
      else if (flag === "--slug") slug = val();
      else { badFlag = a; }
```
with:
```ts
      const eq = a.indexOf("=");
      const flag = eq > 0 ? a.slice(0, eq) : a;
      if (flag === "--seed-from" || flag === "--time-budget" || flag === "--metric" || flag === "--slug") {
        const r = kvParse(a, args[i + 1]);   // pass the FULL token `a`; kvParse reads an inline `=value`
        i += r.shift - 1;
        if (flag === "--seed-from") seedFrom = r.value;
        else if (flag === "--time-budget") timeBudget = r.value;
        else if (flag === "--metric") metric = r.value;
        else slug = r.value;
      } else { badFlag = a; }
```
(`kvParse` is already imported at `rehearsal.ts:8`. The `else { topic = args.slice(i).join(" "); break; }` line below is unchanged — the leading-strict verbatim-tail behavior is preserved.)

- [ ] **Step 9: Run the init test, then the full suite**

Run: `npx vitest run tests/rehearsal-cmd.test.ts -t "no value"`
Expected: PASS (now throws `KvError`).

Then:
```bash
npm run typecheck && npm run lint && npm run test
```
Expected: clean; **1226 tests pass** (1222 + 3 dispatch + 1 init). The existing `rehearsal init` happy-path tests (inline `--metric=...`, `--slug myrun --time-budget none anything`, `--seed-from /path topic`) stay green — `kvParse` matches the old behavior on every edge except missing-trailing-value.

- [ ] **Step 10: Commit**

```bash
git add src/core/dispatch.ts tests/dispatch.test.ts src/consort.ts src/commands/rehearsal.ts tests/rehearsal-cmd.test.ts
git commit -m "feat(args): rehearsal init via kvParse + central KvError->rc2 catch

Item 3b. parseInitArgs now routes its 4 flags through the shared kvParse, so a
missing trailing flag value throws KvError instead of silently binding undefined.
A new side-effect-free core/dispatch.ts converts that KvError into a clean rc-2
message on stderr for EVERY command (was rc 1 + stack via main().catch).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Release 0.1.22 (version bump + dist rebuild)

Bundle the release into this PR (as PR #44 did): bump the three manifests and rebuild the committed bundle so the whole sweep is installable. Item 3b is a small user-facing behavior change, warranting the bump.

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (version `0.1.21` → `0.1.22`)
- Modify: `dist/consort.cjs` (rebuilt)

- [ ] **Step 1: Bump the version in all three manifests**

In each of `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, change the version string `0.1.21` to `0.1.22`. (In `marketplace.json` the version is on the plugin entry; match the existing field.)

- [ ] **Step 2: Verify the gate at the new version, then rebuild dist**

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```
Expected: all green (1226 tests), then `dist/consort.cjs` rebuilt (esbuild prints the bundle size).

- [ ] **Step 3: Confirm the build is deterministic and the bundle dispatches**

```bash
npm run build && git diff --stat dist/consort.cjs   # second build → no further drift
node dist/consort.cjs rehearsal init --metric        # exercises the new central catch end-to-end
```
Expected: the second build leaves `dist/consort.cjs` byte-identical to the first (no diff after the first staged build), and `rehearsal init --metric` prints `--metric requires a value` to stderr and exits **2** (not a stack trace).

- [ ] **Step 4: Run the built-CLI integration test (now against fresh dist)**

Run: `npx vitest run tests/consort-dispatch.test.ts`
Expected: PASS — the existing integration tests run against the freshly-built bundle.

- [ ] **Step 5: Commit the release**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "chore(release): post-simplify cleanups (0.1.22)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final step (after all tasks): finishing the branch

Use **superpowers:finishing-a-development-branch** to verify tests and present merge/PR options. The PR bundles the whole `chore/simplify-sweep` sweep (the first three cleanups at `5397f53`, the spec, plus Tasks 1-4).
