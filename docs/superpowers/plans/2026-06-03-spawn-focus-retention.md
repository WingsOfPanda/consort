# Spawn Focus Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spawned part panes no longer steal focus — the Maestro (conductor) pane stays active throughout every spawn.

**Architecture:** Add tmux's `-d` flag ("do not make the new pane active") to all three `split-window` arg builders in `src/core/tmux.ts`. The third site (the inline split inside `preflightLayout`) is extracted into a new pure builder `preflightSplitArgs` so it is unit-testable like the other two. `-d` only changes which pane is active, never where a split lands (every split passes an explicit `-t <pane>`), so geometry, pane ids, and `panes.txt` are byte-identical. Because the change lives in the shared primitives, it covers solo/score/perform/prelude/rehearsal automatically.

**Tech Stack:** TypeScript (ESM), vitest, esbuild (single committed `dist/consort.cjs` bundle), tmux arg-array builders tested purely (no live panes in unit tests).

**Spec:** `docs/superpowers/specs/2026-06-03-spawn-focus-retention-design.md`

**Branch:** `feat/spawn-focus-retention` (already created; spec already committed at `9706a7c`).

---

## File Structure

- `src/core/tmux.ts` — the three split-window arg builders. Modify `splitRightArgs` and `splitDownArgs` (add `-d`); add the new `preflightSplitArgs` builder; rewrite the `preflightLayout` loop's inline split to call it.
- `tests/tmux.test.ts` — pure arg-builder unit tests. Update the `splitRightArgs`/`splitDownArgs` assertions; add a `preflightSplitArgs` test.
- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — version bump `0.1.6` → `0.1.7`.
- `dist/consort.cjs` — committed bundle; rebuilt at the end.

---

### Task 1: `-d` on the single-pane split builders

**Files:**
- Modify: `src/core/tmux.ts:8-20` (`splitRightArgs`, `splitDownArgs`)
- Test: `tests/tmux.test.ts:5-14`

- [ ] **Step 1: Update the failing tests**

In `tests/tmux.test.ts`, replace the existing `splitRightArgs` and `splitDownArgs` `it(...)` blocks (lines 5-14) with these — note `-d` inserted right after the direction flag:

```ts
  it("splitRightArgs: -h -d (detached), capture pane id, cwd, target", () => {
    expect(T.splitRightArgs("LAUNCH", "%1", "/repo")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-h", "-d", "-t", "%1", "-c", "/repo", "LAUNCH"]);
    expect(T.splitRightArgs("LAUNCH", undefined, "/repo")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-h", "-d", "-c", "/repo", "LAUNCH"]);
  });
  it("splitDownArgs: -v -d (detached), requires target", () => {
    expect(T.splitDownArgs("LAUNCH", "%2", "/repo")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-v", "-d", "-t", "%2", "-c", "/repo", "LAUNCH"]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/liupan/CC/consort && npx vitest run tests/tmux.test.ts -t "splitRightArgs|splitDownArgs"`
Expected: FAIL — actual arrays lack `-d` (e.g. `expected [ ... "-h", "-t" ... ] to deeply equal [ ... "-h", "-d", "-t" ... ]`).

- [ ] **Step 3: Add `-d` to the two builders**

In `src/core/tmux.ts`, change the initial array literal in each builder to include `-d` after the direction flag:

```ts
export function splitRightArgs(launch: string, target?: string, cwd?: string): string[] {
  const a = ["split-window", "-P", "-F", "#{pane_id}", "-h", "-d"];
  if (target) a.push("-t", target);
  if (cwd) a.push("-c", cwd);
  a.push(launch);
  return a;
}
export function splitDownArgs(launch: string, target: string, cwd?: string): string[] {
  const a = ["split-window", "-P", "-F", "#{pane_id}", "-v", "-d", "-t", target];
  if (cwd) a.push("-c", cwd);
  a.push(launch);
  return a;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/liupan/CC/consort && npx vitest run tests/tmux.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 5: Commit**

```bash
cd /home/liupan/CC/consort
git add src/core/tmux.ts tests/tmux.test.ts
git commit -m "feat(spawn): detach single-pane splits so focus stays on the Maestro"
```

---

### Task 2: Extract `preflightSplitArgs` (with `-d`) and use it in the layout loop

**Files:**
- Modify: `src/core/tmux.ts` (add `preflightSplitArgs` near the other builders; rewrite the `preflightLayout` loop's inline split — currently `src/core/tmux.ts:171-173`)
- Test: `tests/tmux.test.ts` (add one `it(...)` block inside the `describe("tmux arg builders", ...)`)

- [ ] **Step 1: Write the failing test**

In `tests/tmux.test.ts`, add this `it(...)` block inside the `describe("tmux arg builders", () => { ... })` block (e.g. right after the `splitDownArgs` test):

```ts
  it("preflightSplitArgs: -d detached, direction flag, target, optional cwd", () => {
    expect(T.preflightSplitArgs("-h", "%0")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-h", "-d", "-t", "%0"]);
    expect(T.preflightSplitArgs("-v", "%1", "/repo")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-v", "-d", "-t", "%1", "-c", "/repo"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/liupan/CC/consort && npx vitest run tests/tmux.test.ts -t "preflightSplitArgs"`
Expected: FAIL — `T.preflightSplitArgs is not a function` (builder does not exist yet).

- [ ] **Step 3: Add the `preflightSplitArgs` builder**

In `src/core/tmux.ts`, add this export immediately after `splitDownArgs` (after the current line 20), alongside the other pure builders:

```ts
export function preflightSplitArgs(flag: "-h" | "-v", prev: string, cwd?: string): string[] {
  const a = ["split-window", "-P", "-F", "#{pane_id}", flag, "-d", "-t", prev];
  if (cwd) a.push("-c", cwd);
  return a;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/liupan/CC/consort && npx vitest run tests/tmux.test.ts -t "preflightSplitArgs"`
Expected: PASS.

- [ ] **Step 5: Wire the builder into `preflightLayout`**

In `src/core/tmux.ts`, inside the `for (const e of roster)` loop of `preflightLayout` (currently lines 169-174), replace the inline arg construction:

```ts
      const sentinel = sentinelCommand(labelFmt(e.instrument, e.model, topic));
      const args = ["split-window", "-P", "-F", "#{pane_id}", flag, "-t", prev];
      if (e.cwd) args.push("-c", e.cwd);
      args.push(sentinel);
      const { stdout } = await execa("tmux", args);
```

with:

```ts
      const sentinel = sentinelCommand(labelFmt(e.instrument, e.model, topic));
      const args = [...preflightSplitArgs(flag, prev, e.cwd), sentinel];
      const { stdout } = await execa("tmux", args);
```

This preserves the exact arg order (`... flag -d -t prev [-c cwd] sentinel`) and only adds `-d`.

- [ ] **Step 6: Run typecheck + the full tmux test file to verify nothing broke**

Run: `cd /home/liupan/CC/consort && npm run typecheck && npx vitest run tests/tmux.test.ts`
Expected: typecheck clean (no output); all tmux tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/liupan/CC/consort
git add src/core/tmux.ts tests/tmux.test.ts
git commit -m "feat(spawn): detach preflight layout splits via preflightSplitArgs"
```

---

### Task 3: Version bump, full gate, rebuild & commit dist

**Files:**
- Modify: `package.json:3` (`"version": "0.1.6"` → `"0.1.7"`)
- Modify: `.claude-plugin/plugin.json:3` (`"version": "0.1.6"` → `"0.1.7"`)
- Modify: `.claude-plugin/marketplace.json:12` (`"version": "0.1.6"` → `"0.1.7"`)
- Modify: `dist/consort.cjs` (rebuilt)

- [ ] **Step 1: Bump the version in all three manifests**

Set the version string from `0.1.6` to `0.1.7` in each:
- `package.json` — top-level `"version": "0.1.7",`
- `.claude-plugin/plugin.json` — top-level `"version": "0.1.7",`
- `.claude-plugin/marketplace.json` — the entry under `plugins[0]`, `"version": "0.1.7",`

- [ ] **Step 2: Confirm all three read 0.1.7**

Run: `cd /home/liupan/CC/consort && grep -h '"version"' package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json`
Expected: three lines, each showing `"version": "0.1.7",`.

- [ ] **Step 3: Run the full gate**

Run: `cd /home/liupan/CC/consort && npm run typecheck && npm run test && npm run lint`
Expected: typecheck clean; `Test Files NN passed (NN)` / `Tests NNNN passed (NNNN)` with the stale-token gate green (a `Verdict: FAIL` line printed by a negative-path soundcheck test is expected stderr, not a failure — confirm the final `Tests ... passed` summary shows zero failures); lint clean.

- [ ] **Step 4: Rebuild the committed bundle**

Run: `cd /home/liupan/CC/consort && npm run build`
Expected: `esbuild → dist/consort.cjs` succeeds (prints `dist/consort.cjs <size>` and `Done`).

- [ ] **Step 5: Sanity-check the new flag reached the bundle**

Run: `cd /home/liupan/CC/consort && grep -c '"-d"' dist/consort.cjs`
Expected: a non-zero count (the `-d` token is present in the bundled builders).

- [ ] **Step 6: Commit**

```bash
cd /home/liupan/CC/consort
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "chore(release): 0.1.7 — spawn focus retention (detached part panes)"
```

---

## Notes for the executor

- **Do NOT** touch any frozen wire-protocol token (event names `ready/ack/progress/done/error/question`, sentinel `END_OF_INSTRUCTION`, JSON fields, `contracts.yaml` keys, state filenames, `CLAUDE_CODE_SESSION_ID`). This change is confined to tmux focus mechanics.
- **Do NOT** introduce any banned token (`clone-wars` / `cw_` / `master-yoda` / `MISSION ACCOMPLISHED` / `@cw_`); the stale-token gate runs as part of `npm run test`.
- `-d` is a standalone boolean flag; keep it immediately after the direction flag (`-h`/`-v`/`flag`) for test determinism (tmux itself ignores ordering among boolean flags).
- The `respawn-pane` path (`respawnArgs`) is intentionally untouched — it reuses a pane in place and never moved focus.
- The live dogfood (spawning real panes and visually confirming focus stays on the Maestro) is a manual end-to-end step done after merge; it is not part of these automated tasks.
