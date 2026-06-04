# Multi-Repo Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make consort single-repo-only by hard-removing every multi-sub-repo-exclusive unit and collapsing the shared seams to their single-repo behavior, byte-identically.

**Architecture:** Leaf-to-root removal — delete fully-exclusive leaf verbs + their dedicated test files first (nothing single-repo imports them), then collapse the shared seams, then delete the now-orphaned modules, all so the build + suite stay green at every task. Spec: `docs/superpowers/specs/2026-06-04-multi-repo-retirement-design.md`.

**Tech Stack:** TypeScript (Node/ESM), esbuild bundle `dist/consort.cjs`, vitest, eslint. Single committed bundle dispatched by subcommand.

**Conventions for every task:**
- Gate command (run after each task): `npm run typecheck && npm run lint && npm run test`
- Do **NOT** run `npm run build` per task — the release task (Task 7) owns the dist rebuild.
- Preserve single-repo behavior byte-identically. When a test is "adjusted", remove ONLY the multi-repo cases; never weaken a retained single-repo assertion.
- Never weaken `tests/stale-tokens.test.ts`.
- The word "target" is overloaded: **sub-repo** targets (`--targets`, `RepoHit`, `parts.txt`, `**Target Sub-Project**`, Execution DAG) are retired; **instrument** targets (`verifyScopeFiles(target, instruments)`, `parseRosterFile`, `roster.txt`, `cascadeTargets`, `--ensemble`) STAY. Do not touch instrument code.

---

## File Structure (what each task touches)

- **Task 1** — verification only (`commands/score.md`, `commands/perform.ts`, `commands/solo.md` read-only).
- **Task 2** — delete: `src/core/performSibling.ts`; edit `src/commands/perform.ts` (10 verbs), `src/core/performTurn.ts` (`composeDagUnitPrompt`); delete 8 perform test files; edit `tests/perform-turn.test.ts`.
- **Task 3** — edit `src/core/perform.ts` (`parsePerformArgs`, `resolveTarget`, `resolveHub`, `iterTargets`, `PerformResolveError`), `src/commands/perform.ts` (`initWith`, `scopeCheckWith`); edit `tests/perform.test.ts`, `tests/perform-init.test.ts`, `tests/perform-scope-check.test.ts`, `tests/perform-finish.test.ts`, `tests/perform-cmd.test.ts`.
- **Task 4** — edit `src/commands/score.ts` (`initWith`, `assembleRun`, `drilldownWith`, delete 3 verbs), `src/core/score.ts` (`parseScoreArgs`, `resolveDrilldownPath`, delete 3 helpers), `src/core/scoreDoc.ts` (`assembleDoc`, `SECTIONS_MULTI`, `DocMode`, `TITLES`) — `assembleRun` and `assembleDoc` collapse together to stay green; delete `src/core/multirepo.ts` + `tests/multirepo.test.ts`; edit `tests/score-core.test.ts`, `tests/score-init.test.ts`, `tests/score-assemble.test.ts`, `tests/score-escalation.test.ts`, `tests/score-doc.test.ts`, `tests/args.test.ts`.
- **Task 5** — edit `src/core/audit.ts`, `src/core/scoreWalk.ts`; delete `src/core/dag.ts` + `tests/dag.test.ts` + `tests/dag-executor.test.ts`; edit `tests/audit.test.ts`, `tests/score-walk.test.ts`.
- **Task 6** — verification only (full repo grep for dangling references).
- **Task 7** — `dist/consort.cjs`, `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`.

---

## Task 1: Verify the single-repo directive path is safe (no code change expected)

**Why first:** the spec's hard acceptance criterion — no removed verb/flag may sit on the *unconditional* single-repo directive path. If one does, we keep it as a thin stub instead of breaking single-repo before the docs follow-up. This is a read-only pre-flight that de-risks every later task.

**Files:**
- Read-only: `commands/score.md`, `commands/perform.md`, `commands/solo.md`

- [ ] **Step 1: Grep the shipped directives for the verbs/flags we will remove**

```bash
cd /home/liupan/CC/consort
grep -nE "detect-multi-repo|emit-dag|check-dag|dag-parse|multi-init|send-unit|drop-part|verify-dag-repos|wave-wait|cross-signal|sibling-(baseline|verify|rescue)|--targets" commands/score.md commands/perform.md commands/solo.md
```

Expected: hits appear ONLY inside multi-repo-gated phases (sections explicitly conditioned on multi-repo mode / `MODE=multi` / "multi-repo detection" / an Execution DAG). They must NOT appear on a step the single-repo flow always executes.

- [ ] **Step 2: For each hit, read its surrounding phase and classify it**

For each file+line from Step 1, read ~20 lines of context. Confirm the verb/flag is reached only when the directive has already branched into multi-repo handling (e.g. after a `MODE`/`ROUTING` check that selects multi, or inside an explicitly multi-repo phase).

- [ ] **Step 3: Record the verdict**

Write a one-line conclusion to the task notes: either
  - "PASS — all removed verbs/flags are multi-repo-gated; no single-repo directive path calls them. No stub needed." (expected), or
  - "STUB NEEDED — `<verb>` is on the single-repo path at `<file:line>`; Task `<N>` must keep it as a single-repo stub." (if so, amend the relevant later task to retain that verb returning its single-repo result instead of deleting it.)

- [ ] **Step 4: Commit the conclusion as a plan note (no code yet)**

No source changes in this task. Proceed once the verdict is recorded. (If a stub is needed, note exactly which verb and adjust the owning task's deletion list to a "collapse to single-repo stub" instead.)

---

## Task 2: Delete the fully-exclusive perform leaf verbs + their tests

**Files:**
- Delete: `src/core/performSibling.ts`
- Modify: `src/commands/perform.ts`, `src/core/performTurn.ts`
- Delete tests: `tests/perform-dag-parse.test.ts`, `tests/perform-multi-init.test.ts`, `tests/perform-cross-signal.test.ts`, `tests/perform-wave-wait.test.ts`, `tests/perform-drop-part.test.ts`, `tests/perform-verify-dag-repos.test.ts`, `tests/perform-sibling.test.ts`, `tests/perform-sibling-verbs.test.ts`
- Modify test: `tests/perform-turn.test.ts`

- [ ] **Step 1: Delete the 8 dedicated multi-repo test files**

```bash
cd /home/liupan/CC/consort
git rm tests/perform-dag-parse.test.ts tests/perform-multi-init.test.ts \
  tests/perform-cross-signal.test.ts tests/perform-wave-wait.test.ts \
  tests/perform-drop-part.test.ts tests/perform-verify-dag-repos.test.ts \
  tests/perform-sibling.test.ts tests/perform-sibling-verbs.test.ts
```

- [ ] **Step 2: Remove the `composeDagUnitPrompt` describe from `tests/perform-turn.test.ts`**

Open `tests/perform-turn.test.ts`, delete the entire `describe("composeDagUnitPrompt", ...)` block (and remove `composeDagUnitPrompt` from its import line). Keep every `performState` / `composeRound1Prompt` / `composeFixPrompt` / blockers case untouched.

- [ ] **Step 3: Delete the 10 exclusive verbs from `src/commands/perform.ts`**

Delete these run/with functions, their `*Deps` interfaces, their `live*Deps` constants, their `case` lines in the `run()` switch, and their tokens in the `usage()` string:
`dagParseRun`/`dagParseWith`, `multiInitRun`/`multiInitWith`, `sendUnitRun`/`sendUnitWith`, `dropPartRun`, `verifyDagReposRun` (+ the `hasRepoMarker` helper), `waveWaitRun`/`waveWaitWith` (+ `PERFORM_WAVE_TIMEOUT`), `crossSignalRun`/`crossSignalWith`, `siblingBaselineRun/With`, `siblingVerifyRun/With`, `siblingRescueRun/With`.

Then delete the now-dead imports at the top of the file: `composeDagUnitPrompt`; the `./core/dag.js` imports (`parseDagLine`, `dagTopological`, `dagSectionBody`, `dagFanInRepos`); and the `./core/performSibling.js` imports (`enumerateSiblings` et al.).

Keep ALL of: `init`, `audit`, `turn-send`, `turn-wait`, `reset-status`, `pre-snapshot`, `branch`, `scope-check`, `summary`, `finish`, `finish-one`, `forensics`, `flag`, `archive`, `find-latest-doc`.

- [ ] **Step 4: Delete `composeDagUnitPrompt` from `src/core/performTurn.ts`**

Remove the `composeDagUnitPrompt` function (the per-sub-repo DAG unit prompt builder, including its `## Execution DAG` upstream-dependency line). Keep `performState`, `composeRound1Prompt`, `composeFixPrompt`, and the blockers helpers.

- [ ] **Step 5: Delete `src/core/performSibling.ts`**

```bash
git rm src/core/performSibling.ts
```

- [ ] **Step 6: Run the gate**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS. Typecheck clean (no dangling imports of the deleted verbs/modules), suite green with the 8 deleted test files gone.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(perform): delete multi-repo-exclusive verbs (dag/wave/sibling/cross-signal)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Collapse perform's shared seams to single-repo

**Files:**
- Modify: `src/core/perform.ts`, `src/commands/perform.ts`
- Modify tests: `tests/perform.test.ts`, `tests/perform-init.test.ts`, `tests/perform-scope-check.test.ts`, `tests/perform-finish.test.ts`, `tests/perform-cmd.test.ts`

- [ ] **Step 1: Adjust `tests/perform.test.ts` to lock the collapsed behavior**

- Delete the entire `describe("resolveTarget", ...)` block (the function is being removed).
- Delete the entire `describe("resolveHub", ...)` block.
- In the `parsePerformArgs` describe, delete the `--targets` split/trim cases.
- In the `iterTargets` describe, delete the `parts.txt` (hub) cases and the parts-precedence case; KEEP the single-repo `target_cwd.txt` → `[{slug:"main", cwd}]` case and the "neither file → []" case.

- [ ] **Step 2: Adjust `tests/perform-init.test.ts`**

- Delete the `MULTI_DOC` fixture and the "multi-repo doc → ROUTING=multi, multi-repo.txt=multi" test.
- KEEP the single-repo init test; ensure its assertion reads `multi-repo.txt` === `"single\n"` (the compat-shim constant) and `target_cwd.txt` === repoRoot.

- [ ] **Step 3: Run the two adjusted test files to confirm they now fail (red)**

```bash
npx vitest run tests/perform.test.ts tests/perform-init.test.ts
```

Expected: FAIL — the production code still has `resolveTarget`/`--targets`/the `parts.txt` branch, so removed-case imports/symbols or behavior mismatch make these files error or fail. (If they still pass, the test edits didn't bite — recheck.)

- [ ] **Step 4: Drop `--targets` from `parsePerformArgs` and the `targets` field (`src/core/perform.ts`)**

In the `PerformArgs` interface remove `targets: string[];`. In `parsePerformArgs` remove `let targets: string[] = [];`, the whole `if (t === "--targets" || t.startsWith("--targets="))` branch, and `targets` from the returned object. Final return:

```ts
  return { rest: rest.join(" "), branchMode, branchName, topic, force };
```

- [ ] **Step 5: Delete `resolveTarget`, `resolveHub`, and `PerformResolveError` (`src/core/perform.ts`)**

Delete the `resolveTarget` function entirely, the `resolveHub` function entirely, and the `PerformResolveError` class. Remove the now-unused `extractTarget` import (from `./audit.js`) and the `basename`/`statSync` imports if they become unused (verify with typecheck).

- [ ] **Step 6: Collapse `iterTargets` to the single-repo branch (`src/core/perform.ts`)**

Replace the body with the `target_cwd.txt`-only form:

```ts
export function iterTargets(topic: string, opts?: { home?: string; cwd?: string }): IterTarget[] {
  const art = performArtDir(topic, opts);
  const targetCwdFile = join(art, "target_cwd.txt");
  if (existsSync(targetCwdFile)) {
    const cwd = readFileSync(targetCwdFile, "utf8").replace(/\n$/, "");
    return [{ slug: "main", cwd }];
  }
  return [];
}
```

Update its doc-comment to drop the `parts.txt` sentence.

- [ ] **Step 7: Collapse `initWith` routing + the resolveTarget call (`src/commands/perform.ts`)**

- Replace the `try { targetCwd = resolveTarget(designPath, d.repoRoot()); } catch (...) {...}` block with: `const targetCwd = d.repoRoot();`
- Remove the `import { PerformResolveError } from ...` line.
- Replace `const routing = parsed.targets.length > 0 ? "multi" : detectRouting(text);` with `const routing = "single";` (and delete the `detectRouting` helper function + its definition).
- Keep `atomicWrite(join(art, "multi-repo.txt"), "single\n");` (compat shim — the value is now constant) and keep the `ROUTING=single` stdout line.

- [ ] **Step 8: Collapse `scopeCheckWith` to the single-repo branch (`src/commands/perform.ts`)**

Remove `const partsFile = join(art, "parts.txt");` and the `if (existsSync(partsFile)) { ...multi-repo per-sub-repo prefixed diff... } else {` wrapper, keeping ONLY the single-repo body (the `target_cwd.txt` + `branch-base.sha` diff). The retained body must be byte-identical to the prior `else` branch.

- [ ] **Step 9: Adjust `tests/perform-scope-check.test.ts` and `tests/perform-finish.test.ts`**

- `perform-scope-check.test.ts`: delete the `describe("perform scope-check (multi-repo path)", ...)` block (parts.txt-driven). Keep the single-repo cases.
- `perform-finish.test.ts`: reseed the fixtures that wrote `parts.txt` with multiple sub-repos to instead write a single-repo `target_cwd.txt` (so `iterTargets` yields the lone `main` row). Keep the finish assertions on that single row.

- [ ] **Step 10: Confirm `tests/perform-cmd.test.ts` needs no multi-repo removal**

Read it; it should already be single-repo (seeds `target_cwd.txt`). If any `parts.txt`-only assertion remains, remove it. Otherwise leave unchanged.

- [ ] **Step 11: Run the gate**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS. Single-repo perform behavior (target_cwd.txt = repoRoot, ROUTING=single, multi-repo.txt=single, scope-check, finish over one row) byte-identical.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor(perform): collapse resolveTarget/iterTargets/scope-check/routing to single-repo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Collapse score + delete its multi verbs, helpers, and multirepo.ts

**Files:**
- Modify: `src/commands/score.ts`, `src/core/score.ts`, `src/core/scoreDoc.ts`
- Delete: `src/core/multirepo.ts`, `tests/multirepo.test.ts`
- Modify tests: `tests/score-core.test.ts`, `tests/score-init.test.ts`, `tests/score-assemble.test.ts`, `tests/score-escalation.test.ts`, `tests/score-doc.test.ts`, `tests/args.test.ts`

> **Why `scoreDoc.ts` lives in this task, not the next:** `assembleRun` (score command) and `assembleDoc` (`scoreDoc.ts`) share a signature. Collapsing one without the other breaks `npm run typecheck`, so they must change together to keep this task green.

- [ ] **Step 1: Adjust the tests first (red)**

- `tests/score-core.test.ts`: delete the `parseScoreArgs` `--targets` cases, the `parseMultiRepoMode` describe, and the `writeTargetsTsv` describe. KEEP `parseRosterFile`/`verifyScopeFiles` (instrument), roster, `lastTag`, and the drilldown-collision cases. Where a drilldown case passes a `subproject` arg, drop that argument.
- `tests/score-init.test.ts`: delete the two `--targets` cases (valid → TSV `targets.txt`/`multi-repo.txt=multi`, and invalid slug → rc 1) and the `validateTargets` stub in `deps()`.
- `tests/score-assemble.test.ts`: keep the single-repo assemble end-to-end; ensure the scaffold writes `multi-repo.txt` === `"single\n"` (the compat-shim constant the collapsed `assembleRun` no longer reads — leave the seed line or drop it, but the assertion on the produced doc must stay byte-identical).
- `tests/score-escalation.test.ts`: **adjust** the `describe("score detect-multi-repo", ...)` block — replace the sibling-detection assertions with a single stub assertion (the verb now always prints nothing and returns rc 0; see Step 6 / Task 1 verdict). Delete the `emit-dag`/`check-dag` cases (incl. the `^## Execution DAG` draft assertion and malformed-DAG case) and the drilldown `<subproject>` positional cases. KEEP the rest.
- `tests/score-doc.test.ts`: delete the `SECTIONS_MULTI` assertion, the `sectionTitle("execution-dag")` assertion, the `single-sub` assemble case, and the `multi` assemble case (Date + plural Target header + Execution DAG + Cross-Repo Notes). KEEP the `SECTIONS_SINGLE` assertion, the single header-less assemble case, and all `synthesizeSeeds` cases. Update any surviving `assembleDoc({ ... })` call to the collapsed `{ title, drafts }` signature.
- `tests/args.test.ts`: delete the `--targets` value-flag cases (the apostrophe-survival + value-flag parsing for `--targets`). KEEP the unrelated multi-LINE `$ARGUMENTS` cases.

- [ ] **Step 2: Run the adjusted score test files to confirm red**

```bash
npx vitest run tests/score-core.test.ts tests/score-init.test.ts tests/score-escalation.test.ts tests/score-doc.test.ts tests/args.test.ts
```

Expected: FAIL (production still exports `--targets`/`parseMultiRepoMode`/`writeTargetsTsv`/`SECTIONS_MULTI`/the verbs).

- [ ] **Step 3: Drop `--targets` from `parseScoreArgs` (`src/core/score.ts`)**

In the `ScoreArgs` interface remove `targets: string[];`. In `parseScoreArgs` remove `let targets: string[] = [];`, the `if (t === "--targets" || t.startsWith("--targets="))` branch, and `targets` from the return. Final:

```ts
  return { topicText: rest.join(" "), ensemble };
```

(Keep `--ensemble` parsing untouched.)

- [ ] **Step 4: Delete the core multi helpers (`src/core/score.ts`)**

Delete `parseMultiRepoMode`, `writeTargetsTsv`, and `parseRosterTargets`. Remove the `import { detectMultiRepo, validateTargets, type RepoHit } from "../core/multirepo.js"` (in `src/commands/score.ts`) once its uses are gone (Step 6). Drop the `subproject` parameter + the `${subproject ? "-"+subproject : ""}` infix from `resolveDrilldownPath`.

- [ ] **Step 5: Collapse `initWith` (`src/commands/score.ts`)**

- Remove `validateTargets` from `ScoreInitDeps` and `liveInitDeps`.
- Remove the `let targetHits: RepoHit[] = []; if (targets.length > 0) { ... }` block.
- Remove the `const mode = targetHits.length >= 2 ? "multi" : ...` computation; set `const mode = "single";`.
- Keep `atomicWrite(join(art, "multi-repo.txt"), mode + "\n");` (now always `"single\n"` — compat shim).
- Remove the `if (targetHits.length > 0) atomicWrite(... "targets.txt" ...)` line.
- Keep the `MODE=single` stdout line and all other output.

- [ ] **Step 6: Stub `detect-multi-repo`; delete `emit-dag`/`check-dag` (`src/commands/score.ts`)**

**Task 1 verdict (directive-path safety):** the `score.md` Stage 10 directive calls `$CS score detect-multi-repo` on the escalate + no-`--targets` path (a single-repo escalated flow whose "0 hits → single" branch is live). Deleting the verb would break that flow before the docs follow-up, so per the spec's hard acceptance criterion it is **kept as a thin zero-hits stub** (the single-repo outcome — a single-repo env always yielded 0 hits anyway):

```ts
// multi-repo retired: always zero hits (single-repo). Kept as a stub so the
// score.md Stage 10 "0 hits -> single" branch keeps working until the docs
// follow-up removes the call. See 2026-06-04-multi-repo-retirement spec.
async function detectMultiRepoRun(_rest: string[]): Promise<number> {
  return 0;
}
```

Keep the `detect-multi-repo` `case` in `run()` and its `usage()` token. Delete `emitDagRun`, `checkDagRun`, their `case` lines, their `usage()` tokens, and the now-dead imports from `./core/dag.js` (`emitSoftDag`, `checkDagSection`, `dagMalformedLines`, `SoftDagRow`). Remove the `./core/multirepo.js` import (the stub no longer calls `detectMultiRepo`). In `drilldownWith`, drop the `subproject` parameter handling (the `n === 8`/`n === 10` arity branch) so drilldown takes fixed arg counts; pass no `subproject` to `resolveDrilldownPath`.

- [ ] **Step 7a: Collapse `assembleRun` (`src/commands/score.ts`)**

Replace the mode/keys/targets read block with the single-repo constants:

```ts
  const title = (readIf(join(art, "topic.txt")).split("\n")[0] || topic).trim();
  const keys = SECTIONS_SINGLE;
  const drafts = new Map<string, string>();
```

(Remove the `parseMultiRepoMode` / `parseRosterTargets` reads and the `mode`/`targets` locals.) Update the later `assembleDoc(...)` call to the collapsed signature `assembleDoc({ title, drafts })`. Remove the `SECTIONS_MULTI` and `DocMode` imports; keep `SECTIONS_SINGLE`.

- [ ] **Step 7b: Collapse `assembleDoc` + delete `SECTIONS_MULTI`/`DocMode` (`src/core/scoreDoc.ts`)**

This must land in the same task as Step 7a (shared signature). Apply:

- Delete the `SECTIONS_MULTI` const and the `DocMode` type.
- Delete the `"execution-dag"` and `"cross-repo-notes"` entries from `TITLES`.
- Change `AssembleInput` to `{ title: string; drafts: Map<string, string>; }` (drop `mode`, `targets`, `date`).
- Rewrite `assembleDoc` to the header-less single form:

```ts
export function assembleDoc(input: AssembleInput): string {
  let out = `# ${input.title}\n\n`;
  for (const key of SECTIONS_SINGLE) {
    const draft = input.drafts.get(key);
    if (draft != null) out += `${draft}\n`;
    else out += `## ${sectionTitle(key)}\n\n_(missing draft)_\n\n`;
  }
  return out;
}
```

- [ ] **Step 8: Delete `src/core/multirepo.ts` and `tests/multirepo.test.ts`**

```bash
git rm src/core/multirepo.ts tests/multirepo.test.ts
```

- [ ] **Step 9: Run the gate**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS. Single-repo `score init`/`assemble` byte-identical (`MODE=single`, `multi-repo.txt=single\n`, SECTIONS_SINGLE doc).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(score): collapse to single-repo; delete detect-multi-repo/emit-dag/check-dag + multirepo.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Collapse audit + scoreWalk; delete dag.ts

**Files:**
- Modify: `src/core/audit.ts`, `src/core/scoreWalk.ts`
- Delete: `src/core/dag.ts`, `tests/dag.test.ts`, `tests/dag-executor.test.ts`
- Modify tests: `tests/audit.test.ts`, `tests/score-walk.test.ts`

> **Ordering note:** `extractTarget` (this task) is consumed by `resolveTarget` (deleted in Task 3) and by `auditDoc`'s rule (deleted in this task). Both consumers are gone by the time this task deletes `extractTarget`. `dag.ts`'s last importer (`audit.ts`, via `checkDagSection`) is also removed here — so `dag.ts` is deletable now.

- [ ] **Step 1: Adjust the tests first (red)**

- `tests/audit.test.ts`: delete the "invalid Target Sub-Project slug" case, the "unparseable Execution DAG" case, the issue-order case's `target_subproject_when_invalid`/`execution_dag_not_parseable` expectations, and the entire `describe("extractTarget", ...)` block. KEEP the `SLUG_REGEX` assertion and the single-repo `auditDoc` cases (adjust the issue-order assertion to list only the 8 retained issues in order).
- `tests/score-walk.test.ts`: delete the two assertions for `auditIssueToSection("target_subproject_when_invalid")` → `"header"` and `("execution_dag_not_parseable")` → `"execution-dag"`. Keep the single-repo mappings and `walkSectionState` tests.

- [ ] **Step 2: Run the adjusted files to confirm red**

```bash
npx vitest run tests/audit.test.ts tests/score-walk.test.ts
```

Expected: FAIL (production still exports `extractTarget`/the multi audit rules).

- [ ] **Step 3: Collapse `auditDoc` + delete `extractTarget` (`src/core/audit.ts`)**

- Remove `import { checkDagSection } from "./dag.js";` (line 2).
- Delete `TARGET_HEADER`, the `TargetResult` type, and the `extractTarget` function.
- In `auditDoc`, delete the trailing three lines (the `const t = extractTarget(docText);`, the `target_subproject_when_invalid` push, and the `execution_dag_not_parseable` push). The function ends after the `to_be_determined_marker` push, then `return ... PASS/FAIL`.
- KEEP `SLUG_REGEX` (now an unused-but-public export) and `AuditResult`.

Resulting tail of `auditDoc`:

```ts
  if (/fill in later/i.test(docText)) issues.push("fill_in_later_marker");
  if (/to be determined/i.test(docText)) issues.push("to_be_determined_marker");
  return issues.length === 0 ? { verdict: "PASS", issues } : { verdict: "FAIL", issues };
}
```

- [ ] **Step 4: Drop the two multi cases from `auditIssueToSection` (`src/core/scoreWalk.ts`)**

Delete the `case "target_subproject_when_invalid": return "header";` line and the `case "execution_dag_not_parseable": return "execution-dag";` line. Keep all other cases and the `default: return ""`.

- [ ] **Step 5: Delete `src/core/dag.ts` and its tests**

```bash
git rm src/core/dag.ts tests/dag.test.ts tests/dag-executor.test.ts
```

- [ ] **Step 6: Run the gate**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS. No importer of `dag.ts` remains; single-repo audit verdict + assembled-doc bytes unchanged.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(audit): collapse auditDoc + auditIssueToSection to single-repo; delete dag.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Final dangling-reference sweep (verification)

**Files:** read-only repo grep.

- [ ] **Step 1: Confirm no multi-repo symbols survive in shipped `src`**

```bash
cd /home/liupan/CC/consort
grep -rnE "validateTargets|RepoHit|TargetValidation|SECTIONS_MULTI|parseMultiRepoMode|writeTargetsTsv|parseRosterTargets|extractTarget|resolveTarget|resolveHub|PerformResolveError|composeDagUnitPrompt|DocMode|detectMultiRepo\(|from \"./dag.js\"|from \"../core/dag.js\"|from \"./multirepo.js\"|from \"../core/multirepo.js\"|performSibling" src/
```

Expected: NO output (all references gone). Note: the kept `detectMultiRepoRun` stub is intentionally NOT matched (we grep `detectMultiRepo\(` — a *call* to the deleted `multirepo.ts` export — not the surviving stub's name). Any hit means a dangling reference — fix it in the owning task before proceeding.

- [ ] **Step 2: Confirm the instrument-ensemble code is untouched**

```bash
grep -rnE "verifyScopeFiles|parseRosterFile|cascadeTargets|--ensemble" src/ | head
```

Expected: these still exist (they STAY). Sanity check that the retirement did not nick the ensemble path.

- [ ] **Step 3: Full gate one more time**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS, including `tests/stale-tokens.test.ts` (unmodified).

- [ ] **Step 4: No commit unless Step 1 surfaced a fix.** If a dangling reference was found and fixed, commit it:

```bash
git add -A && git commit -m "refactor: remove last dangling multi-repo reference

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Release — rebuild dist + bump to 0.1.23

**Files:** `dist/consort.cjs`, `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

- [ ] **Step 1: Bump the version in all three manifests**

Change `"version": "0.1.22"` → `"version": "0.1.23"` in `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` (in marketplace.json it is the plugin entry's `version`).

- [ ] **Step 2: Rebuild the bundle**

```bash
cd /home/liupan/CC/consort
npm run build
```

Expected: writes `dist/consort.cjs`.

- [ ] **Step 3: Verify the build is deterministic**

```bash
sha256sum dist/consort.cjs && npm run build >/dev/null 2>&1 && sha256sum dist/consort.cjs
```

Expected: the two SHA256 values are identical (deterministic build).

- [ ] **Step 4: Final full gate**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS (1 fewer test count than before — the deleted multi-repo files; the retained single-repo assertions all green).

- [ ] **Step 5: Smoke-test single-repo behavior against the built bundle**

```bash
node dist/consort.cjs score --help 2>&1 | head -5 || true
node dist/consort.cjs perform 2>&1 | head -5 || true
```

Expected: the CLI runs (usage/help prints); no crash, no reference to a removed verb in the usage string.

- [ ] **Step 6: Commit the release**

```bash
git add -A
git commit -m "release: consort 0.1.23 (retire multi-repo subsystem)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## After all tasks

Dispatch a final whole-branch code review (subagent-driven-development's final reviewer), then use **superpowers:finishing-a-development-branch** to merge/PR. The docs follow-up (command-doc prose, `MIGRATION.md`, the `CLAUDE.md` phase-guard "Fully ported" narrative) is a **separate PR** and out of scope here.
