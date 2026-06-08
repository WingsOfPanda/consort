# `/consort:duet` Finish — PR + Auto-Merge + Pull — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Change `/consort:duet`'s branch-mode finish to: open a PR, auto-merge it (a merge commit), and fast-forward local base — single integration point, no divergence — with graceful fallbacks.

**Architecture:** A new additive `gitwork` finisher `finishBranchPrMerge` (solo's `finishBranch` and perform's `finishBranchAction` untouched); `duet.ts` `finishWith` routes its branch-mode path to it; the directive's Stage 3 prose updates; version → `0.1.28`.

**Tech Stack:** TypeScript (esbuild → committed `dist/consort.cjs`), vitest, eslint, tsc. The finisher uses only the cwd-bound `Runner` (`execFileSync`, never a shell), so it is unit-tested with a fake Runner.

**Spec:** `docs/superpowers/specs/2026-06-08-duet-finish-pr-merge-design.md` — read it first.

**Build discipline:** Tasks 1–3 must **NOT** run `npm run build`. Task 4 owns the dist rebuild + version bump. Each task runs its tests + `npm run typecheck` + `npm run lint`, commits, and stops. Do NOT touch the untracked `target-user-analysis.*` files. Do NOT run `git checkout`/`switch`/`stash`/`reset`. Keep new code clear of the stale-token gate (`clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_`/case-insensitive `trooper`/`commander`). Commit-message trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Modify** `src/core/gitwork.ts` — add `PrMergeOpts`, `PrMergeResult`, `finishBranchPrMerge` (additive; reuses the existing module-private `finishAutoAction`).
- **Modify** `src/commands/duet.ts` — `finishWith` branch-mode path calls `finishBranchPrMerge` instead of `finishBranch`; swap the import.
- **Modify** `commands/duet.md` — Stage 3 finish prose.
- **Test** — `finishBranchPrMerge` units in the existing gitwork test file (or a new `tests/gitwork-prmerge.test.ts`); update the duet finish happy-path test in `tests/duet-cmd.test.ts`.
- **Modify** `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — `0.1.27 → 0.1.28`; rebuild `dist/consort.cjs`.

---

## Task 1: `finishBranchPrMerge` in `gitwork.ts`

**Files:**
- Modify: `src/core/gitwork.ts`
- Test: the existing gitwork test file (run `ls tests/gitwork*` — append there) or create `tests/gitwork-prmerge.test.ts`.

- [ ] **Step 1: Write the failing tests**

First locate the gitwork test file (`ls tests/gitwork*.test.ts`). Append these tests there (adjust the import path/style to match the file); if no gitwork test file exists, create `tests/gitwork-prmerge.test.ts` with the imports shown.

```ts
import { describe, it, expect } from "vitest";
import { finishBranchPrMerge } from "../src/core/gitwork.js";
import type { Runner } from "../src/core/gitwork.js";

// Fake Runner keyed on the "cmd arg arg..." string; prefix-matched, default code 0.
function fakeRunner(map: Record<string, { code?: number; stdout?: string }>, log?: string[]): Runner {
  return {
    run: (cmd, args) => {
      const key = [cmd, ...args].join(" ");
      if (log) log.push(key);
      let hit = map[key];
      if (!hit) for (const k of Object.keys(map)) { if (key.startsWith(k)) { hit = map[k]; break; } }
      return { code: hit?.code ?? 0, stdout: hit?.stdout ?? "" };
    },
  };
}
const BRANCH_EXISTS = { "git show-ref --verify --quiet refs/heads/feat/duet-x": { code: 0 } };

describe("finishBranchPrMerge", () => {
  const opts = { branch: "feat/duet-x", base: "main", hasGh: true, title: "duet: feat/duet-x", body: "b" };

  it("happy path (remote + gh): push → pr create → checkout base → pr merge → pull --ff-only", () => {
    const log: string[] = [];
    const r = fakeRunner({ ...BRANCH_EXISTS, "git remote": { stdout: "origin\n" }, "git remote get-url origin": { stdout: "git@x:y.git\n" } }, log);
    const res = finishBranchPrMerge(r, opts);
    expect(res).toEqual({ action: "pr-merge", outcome: "pr-merged-pulled" });
    const seq = log.join(" | ");
    expect(seq).toMatch(/git push -q -u origin feat\/duet-x/);
    expect(seq).toMatch(/gh pr create .*--base main --head feat\/duet-x/);
    expect(seq).toMatch(/git checkout -q main/);
    expect(seq).toMatch(/gh pr merge feat\/duet-x --merge --delete-branch/);
    expect(seq).toMatch(/git pull --ff-only origin main/);
  });

  it("no remote → local merge into base, no gh/pr", () => {
    const log: string[] = [];
    const r = fakeRunner({ ...BRANCH_EXISTS, "git remote": { stdout: "" } }, log);
    const res = finishBranchPrMerge(r, opts);
    expect(res).toEqual({ action: "local-merge", outcome: "local-merged-no-remote" });
    expect(log.join(" | ")).not.toMatch(/gh /);
    expect(log.join(" | ")).toMatch(/git merge --no-edit -q feat\/duet-x/);
  });

  it("no gh → push only, base not merged", () => {
    const r = fakeRunner({ ...BRANCH_EXISTS, "git remote": { stdout: "origin\n" } });
    const res = finishBranchPrMerge(r, { ...opts, hasGh: false });
    expect(res).toEqual({ action: "push-only", outcome: "pushed-no-gh" });
  });

  it("pr merge blocked → PR left open", () => {
    const r = fakeRunner({ ...BRANCH_EXISTS, "git remote": { stdout: "origin\n" }, "git remote get-url origin": { stdout: "u\n" }, "gh pr merge": { code: 1 } });
    const res = finishBranchPrMerge(r, opts);
    expect(res).toEqual({ action: "pr-merge", outcome: "pr-open-merge-blocked" });
  });

  it("pull can't fast-forward → reported, remote merge already done", () => {
    const r = fakeRunner({ ...BRANCH_EXISTS, "git remote": { stdout: "origin\n" }, "git remote get-url origin": { stdout: "u\n" }, "git pull --ff-only": { code: 1 } });
    const res = finishBranchPrMerge(r, opts);
    expect(res).toEqual({ action: "pr-merge", outcome: "pr-merged-pull-failed" });
  });

  it("no branch (ref missing) → none", () => {
    const r = fakeRunner({ "git show-ref --verify --quiet refs/heads/feat/duet-x": { code: 1 }, "git remote": { stdout: "origin\n" } });
    const res = finishBranchPrMerge(r, opts);
    expect(res).toEqual({ action: "none", outcome: "no-branch" });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/gitwork*.test.ts` (or the file you created)
Expected: FAIL (`finishBranchPrMerge` not exported).

- [ ] **Step 3: Implement `finishBranchPrMerge` in `src/core/gitwork.ts`**

Add at the end of the file (after `finishBranchAction`). It reuses the module-private `finishAutoAction` already in this file.

```ts
export interface PrMergeOpts {
  branch: string;
  base: string;
  hasGh: boolean;
  originUrl?: string;
  title?: string;
  body?: string;
}
export interface PrMergeResult { action: "pr-merge" | "local-merge" | "push-only" | "none"; outcome: string; }

/** duet's finisher: open a PR, merge it (a merge commit), and fast-forward local base — a SINGLE
 *  integration point, so local base never diverges from the remote. Graceful fallbacks for
 *  no-remote / no-gh / merge-blocked / ff-fail. Ends checked out on `base` (best-effort). */
export function finishBranchPrMerge(r: Runner, o: PrMergeOpts): PrMergeResult {
  if (!o.branch || o.branch === o.base ||
      r.run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${o.branch}`]).code !== 0) {
    return { action: "none", outcome: "no-branch" };
  }
  // No remote → integrate locally (the PR path is impossible). Single merge into base.
  if (finishAutoAction(r.run("git", ["remote"]).stdout) === "keep") {
    r.run("git", ["checkout", "-q", o.base]);
    if (r.run("git", ["merge", "--no-edit", "-q", o.branch]).code === 0) {
      r.run("git", ["branch", "-q", "-D", o.branch]);
      return { action: "local-merge", outcome: "local-merged-no-remote" };
    }
    r.run("git", ["merge", "--abort"]);
    return { action: "local-merge", outcome: "local-merge-conflict-left" };
  }
  // Remote present → push the feature branch.
  if (r.run("git", ["push", "-q", "-u", "origin", o.branch]).code !== 0) {
    r.run("git", ["checkout", "-q", o.base]);
    return { action: "push-only", outcome: "push-failed" };
  }
  if (!o.hasGh) {
    r.run("git", ["checkout", "-q", o.base]);
    return { action: "push-only", outcome: "pushed-no-gh" };
  }
  const url = o.originUrl ?? r.run("git", ["remote", "get-url", "origin"]).stdout.trim();
  const title = o.title ?? `duet: ${o.branch}`;
  const body = o.body ?? `Automated duet branch. Merged into ${o.base}.`;
  if (r.run("gh", ["pr", "create", "--repo", url, "--base", o.base, "--head", o.branch, "--title", title, "--body", body]).code !== 0) {
    r.run("git", ["checkout", "-q", o.base]);
    return { action: "pr-merge", outcome: "pr-create-failed" };
  }
  // Leave the feature branch BEFORE the merge deletes it.
  r.run("git", ["checkout", "-q", o.base]);
  if (r.run("gh", ["pr", "merge", o.branch, "--merge", "--delete-branch"]).code !== 0) {
    return { action: "pr-merge", outcome: "pr-open-merge-blocked" };
  }
  // The merge happened ONCE (on the remote); local base catches up by fast-forward only.
  if (r.run("git", ["pull", "--ff-only", "origin", o.base]).code !== 0) {
    return { action: "pr-merge", outcome: "pr-merged-pull-failed" };
  }
  return { action: "pr-merge", outcome: "pr-merged-pulled" };
}
```

- [ ] **Step 4: Run tests + gates**

Run: `npx vitest run tests/gitwork*.test.ts && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/core/gitwork.ts tests/gitwork*.test.ts
git commit -m "$(printf 'feat(duet): finishBranchPrMerge — PR + auto-merge + ff-pull finisher\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: Wire `duet finishWith` to `finishBranchPrMerge`

**Files:**
- Modify: `src/commands/duet.ts`
- Test: `tests/duet-cmd.test.ts` (update the finish happy-path test)

- [ ] **Step 1: Update the duet finish test** (the branch-mode happy path must now drive the new sequence)

In `tests/duet-cmd.test.ts`, find the existing test `"branch mode: writes diff-stats + finish-result, builds a duet: PR title"`. Replace its fake `Runner` + assertions so the runner handles the new sequence and the result is the PR-merge outcome. The fail-closed test and the in-place test stay as-is.

```ts
  it("branch mode: writes diff-stats + finish-result via finishBranchPrMerge (pr-merged-pulled)", async () => {
    const exec = duetExecDir("t"); mkdirSync(exec, { recursive: true });
    writeFileSync(join(exec, "mode.txt"), "branch\n");
    writeFileSync(join(exec, "branch.txt"), "feat/duet-t\n");
    writeFileSync(join(exec, "start-branch.txt"), "main\n");
    writeFileSync(join(exec, "branch-base.sha"), "base1\n");
    writeFileSync(join(exec, "verify-result.txt"), "PASS\n");
    writeFileSync(join(duetArtDir("t"), "topic-text.txt"), "the task");
    let prTitle = "";
    const r: Runner = { run: (cmd, args) => {
      const key = [cmd, ...args].join(" ");
      if (key.startsWith("git diff --shortstat")) return { code: 0, stdout: " 1 file changed\n" };
      if (key === "git remote") return { code: 0, stdout: "origin\n" };
      if (key.startsWith("git remote get-url")) return { code: 0, stdout: "git@x:y.git\n" };
      if (key.startsWith("git show-ref")) return { code: 0, stdout: "" };
      if (cmd === "gh" && args[0] === "pr" && args[1] === "create") { prTitle = args[args.indexOf("--title") + 1]; return { code: 0, stdout: "" }; }
      return { code: 0, stdout: "" }; // push, checkout, gh pr merge, pull all succeed
    } };
    const rc = await finishWith("t", r, true);
    expect(rc).toBe(0);
    expect(prTitle).toBe("duet: feat/duet-t");
    expect(readFileSync(join(exec, "diff-stats.txt"), "utf8")).toContain("1 file changed");
    expect(readFileSync(join(exec, "finish-result.txt"), "utf8")).toContain("pr-merged-pulled");
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/duet-cmd.test.ts`
Expected: that test FAILS (still calls `finishBranch`, so `finish-result.txt` says `pr\t…` not `pr-merged-pulled`).

- [ ] **Step 3: Update `finishWith` in `src/commands/duet.ts`**

Swap the import and the call. In the gitwork import line, replace `finishBranch` with `finishBranchPrMerge` (if `finishBranch` is imported only for this call, remove it; confirm no other use in duet.ts). Then change the branch-mode finish call:

```ts
  const res = finishBranchPrMerge(r, {
    branch, base: startBranch, hasGh,
    title: `duet: ${branch}`,
    body: `${task}\n\nVerify: ${verify}\n\n(Automated duet branch — merged into ${startBranch}.)`,
  });
  atomicWrite(join(exec, "finish-result.txt"), `${res.action}\t${res.outcome}\n`);
  log.ok(`duet finish: ${res.action} → ${res.outcome}`);
  return 0;
```

(Leave the in-place branch, the `diff-stats.txt` write, and the fail-closed `finishRun` guard unchanged.)

- [ ] **Step 4: Run tests + gates**

Run: `npx vitest run tests/duet-cmd.test.ts && npm run typecheck && npm run lint`
Expected: all green (in-place + fail-closed tests still pass; the updated happy-path test passes).

- [ ] **Step 5: Commit**

```bash
git add src/commands/duet.ts tests/duet-cmd.test.ts
git commit -m "$(printf 'feat(duet): finish via PR auto-merge + ff-pull (local base stays on base)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: Update `commands/duet.md` Stage 3 prose

**Files:**
- Modify: `commands/duet.md`

- [ ] **Step 1: Rewrite Stage 3's finish step** (step 3) to describe the new behavior. Replace the current Stage 3 step 3 line:

> `3. Finish (branch mode → push + PR in repo B, or local commit if no remote; in-place → leaves commits on the current branch): $CS duet finish <SLUG>.`

with:

```markdown
3. Finish: `$CS duet finish <SLUG>`. In **branch mode** this opens a PR, merges it (a merge commit), and
   fast-forwards repo B's base branch — so repo B ends back on its base branch, up to date, with the
   merge on record and no local/remote divergence. Fallbacks (each recorded in `finish-result.txt`): no
   remote → it merges into base locally; no `gh` → it pushes the branch and you open + merge the PR
   manually, then `git -C <TARGET> pull`; the PR merge being blocked (branch protection / CI / conflict)
   → it leaves the PR open for you to merge; base can't fast-forward → it reports and stops. In
   **in-place mode** it leaves the commits on the current branch.
```

- [ ] **Step 2: Confirm the stale-token gate stays green**

Run: `npx vitest run tests/stale-tokens.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add commands/duet.md
git commit -m "$(printf 'docs(duet): directive Stage 3 — PR auto-merge + ff-pull finish\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: Version bump + build + commit dist

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- Rebuild: `dist/consort.cjs`

- [ ] **Step 1: Bump** all three manifests `0.1.27 → 0.1.28` (package.json `version`, plugin.json `version`, marketplace.json `plugins[0].version`). If the current value differs, bump from the actual value to the next patch and report.

- [ ] **Step 2: Full gate suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green (report the total test count).

- [ ] **Step 3: Build**

Run: `npm run build`

- [ ] **Step 4: Smoke the built bundle**

Run: `node dist/consort.cjs duet finish nonexistent-topic` → expect rc 1 (fail-closed still intact in the bundle). And `node dist/consort.cjs duet` → usage + rc 2.

- [ ] **Step 5: Deterministic rebuild check**

Run: `sha256sum dist/consort.cjs; npm run build >/dev/null 2>&1; sha256sum dist/consort.cjs` → the two SHAs must be identical.

- [ ] **Step 6: Commit**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "$(printf 'chore(duet): build dist + bump version for PR-auto-merge finish\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification (before opening the PR)

- [ ] `npm run typecheck && npm run lint && npm run test` — all green.
- [ ] `git grep -n "finishBranch\b" src/commands/duet.ts` — empty (duet now uses `finishBranchPrMerge`); `finishBranch`/`finishBranchAction` still exist for solo/perform.
- [ ] Spec acceptance #1–5 satisfied; #6 (live dogfood) noted for after install.
- [ ] Hand off to `superpowers:finishing-a-development-branch` to open the PR.
