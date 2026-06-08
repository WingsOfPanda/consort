# `/consort:duet` Finish — PR + Auto-Merge + Pull — Design

**Date:** 2026-06-08
**Status:** approved (brainstorming)
**Scope of this PR:** refine `/consort:duet`'s **branch-mode finish** + a new `gitwork` finisher + tests
+ the directive's Stage 3 prose + version bump + rebuilt `dist`. No change to init/branch/round-send/
round-wait/relay/summary, the wire protocol, or the state layout.

## Why

`/consort:duet` (shipped 0.1.27, [[duet-cross-repo-command]]) drives a part in another repo (repo B)
while the user's own session in repo B is **parked on the base branch**. The agreed operating protocol:
repo B has no *working* session, its tree is committed-clean before duet starts, and after duet finishes
the parked session resumes on the base branch and re-checks `git status`.

For that protocol to feel right, finishing should leave repo B **on the base branch, up to date with the
completed work**, with a **merge recorded on the remote**, and **no local/remote divergence**. The
shipped finish is **PR-only** (`finishBranch`: push + open PR, restore base) — local base stays unchanged
until the user manually merges the PR and pulls. That is safe but doesn't match the workflow.

"Merge locally **and** open a reviewable PR" is mechanically impossible without divergence (the work
would be merged twice — once locally, once when the PR merges on the remote — producing two different
merge commits). The chosen resolution is **single-integration-point via the PR**: open the PR, merge it
on the remote, then fast-forward local base. The merge happens exactly once.

This is new behavior beyond the faithful clone-wars port, so per the CLAUDE.md phase guard it needs this
design doc.

## Goal

Make duet's **branch-mode** finish: open a PR, auto-merge it (a merge commit), and fast-forward the local
base branch — so repo B ends on the base branch, `local base == remote base`, with the merge on record
and zero divergence. Degrade gracefully when the remote / `gh` / branch-protection make any step
impossible.

## Non-goals

- No change to `--in-place` finish (no branch → nothing to PR; keeps the current "commits on the current
  branch" behavior).
- No second local merge — the PR merge is the only merge (that is the whole point).
- No hardcoded `main` — the base is the branch repo B was on at `duet branch`.
- No clean-tree/on-base **enforcement** guard in this PR (see Open question). The protocol stays a human
  discipline for now.
- No squash/rebase finish — the user wants a **merge commit** ("history of merge").

## The finish flow (branch mode)

The runner is cwd-bound to repo B (`runnerAt(target_cwd)`), currently checked out on
`feat/duet-<slug>` (the part's branch). `base` = the branch recorded in `start-branch.txt` at
`duet branch` (the branch repo B was on — no hardcoded default).

Happy path (origin remote present, `gh` available, no branch protection block):

```
1. git push -u origin feat/duet-<slug>
2. gh pr create --base <base> --head feat/duet-<slug> --title "duet: feat/duet-<slug>" --body "<task>\n\nVerify: <verify>\n\n(Automated duet branch — merged into <base>.)"
3. git checkout <base>                       # leave the feature branch BEFORE deleting it
4. gh pr merge feat/duet-<slug> --merge --delete-branch   # merge commit on the remote; deletes remote+local feature branch
5. git pull --ff-only origin <base>          # local base fast-forwards to include the merge commit
```

End state: repo B on `<base>`, `local <base> == remote <base>` (contains the merge), the PR is merged
(record/history), the feature branch is gone. **The merge occurs once (step 4); local base is updated by
fast-forward (step 5), never by a separate local merge** — this is the non-divergence guarantee.

### Why this can't diverge (the load-bearing invariant)

Under the protocol, repo B started clean on `base` with `local base == remote base`. duet only **adds**
commits on `feat/duet-<slug>`; it never moves `base` locally. So at finish, `base` has not diverged from
the remote, the remote merge is the sole integration, and `pull --ff-only` is a pure fast-forward. If
that fast-forward is ever *not* possible (remote base moved underneath us), we **stop and report** rather
than create a merge — preserving the invariant.

## Fallbacks (finish must never half-break)

| Condition | Behavior | Recorded outcome |
|---|---|---|
| No `origin` remote | Local merge into base instead (`checkout base; merge --no-edit feat/duet; delete branch`). No PR. | `local-merged-no-remote` |
| No `gh` on PATH | Push the branch; **do not** local-merge (would diverge from a later UI merge); checkout base (base left unchanged — the work is on the pushed branch); tell the user to open + merge the PR in the UI, then `pull`. | `pushed-no-gh` |
| `gh pr merge` rejected (branch protection / required checks / merge conflict) | Leave the PR **open**; checkout base; report "merge it manually, then pull". | `pr-open-merge-blocked` |
| `git pull --ff-only` can't fast-forward (remote base moved) | Stop; report. The remote merge already happened; the user pulls/reconciles manually. | `pr-merged-pull-failed` |
| Happy path | as above | `pr-merged-pulled` |

All paths end with repo B checked out on `<base>` (best-effort), and write the outcome to
`finish-result.txt` (TAB-separated `action\toutcome`, same shape duet/solo already use). Errors to stderr,
never the outbox.

## Architecture / components

- **New** `src/core/gitwork.ts` finisher — `finishBranchPrMerge(r: Runner, o: PrMergeOpts): PrMergeResult`
  implementing the flow + fallbacks above. Additive; `finishBranch` (solo) and `finishBranchAction`
  (perform) are untouched. `PrMergeOpts = { branch, base, hasGh, title?, body? }`;
  `PrMergeResult = { action: "pr-merge" | "local-merge" | "push-only" | "none"; outcome: string }`.
  Decision for remote presence reuses the existing `finishAutoAction(r.run("git",["remote"]).stdout)`
  helper (non-empty remotes → remote path; empty → local-merge path).
- **Modify** `src/commands/duet.ts` `finishWith`: in **branch mode**, read `branch`/`start-branch`(base)/
  `branch-base.sha`/`verify-result.txt`/`topic-text.txt`, write `diff-stats.txt` (unchanged), then call
  `finishBranchPrMerge(r, { branch, base: startBranch, hasGh, title: "duet: <branch>", body })` and write
  its result to `finish-result.txt`. **in-place mode unchanged.** `finishRun`'s **fail-closed** guard on a
  missing `target_cwd.txt` is unchanged.
- **Modify** `commands/duet.md` Stage 3: update the finish prose — finishing now opens the PR, merges it,
  and fast-forwards local base; repo B ends on base, up to date; note the fallbacks briefly.

`finishBranchPrMerge` uses only `r.run(...)` (the cwd-bound `Runner`, `execFileSync`, never a shell), so
it is unit-testable with a fake Runner exactly like `finishBranch`/`finishBranchAction`.

## Testing

**Unit (vitest), fake `Runner` keyed on the `git`/`gh` command string:**
- Happy path: asserts the exact sequence push → `gh pr create` → `git checkout <base>` →
  `gh pr merge … --merge --delete-branch` → `git pull --ff-only`, title `duet: <branch>`, result
  `pr-merge\tpr-merged-pulled`.
- No remote (`git remote` → ""): local-merge path, no `gh` calls, result `local-merge\tlocal-merged-no-remote`.
- No gh (`hasGh=false`): push only, no `gh` calls, base not merged, result `push-only\tpushed-no-gh`.
- `gh pr merge` returns non-zero: result `pr-merge\tpr-open-merge-blocked`, ends on base, no `pull`.
- `git pull --ff-only` returns non-zero: result `pr-merge\tpr-merged-pull-failed`.
- `duet finishWith` branch mode routes to `finishBranchPrMerge` and writes `finish-result.txt`; in-place
  mode still writes the in-place result; missing `target_cwd.txt` still rc 1 (fail-closed) — extend
  `tests/duet-cmd.test.ts`.
- `RunResult` has no stderr field — fake runners drop stderr (existing convention).

**Gates:** stale-token + `typecheck` + `lint` + `test` green; rebuild `dist/consort.cjs` (deterministic
SHA) + commit; bump the 3 manifests `0.1.27 → 0.1.28`.

## Acceptance criteria

1. Branch-mode `duet finish` runs push → PR → `--merge --delete-branch` → checkout base → `pull --ff-only`,
   leaving repo B on base with `local base == remote base` and the PR merged.
2. The fallbacks produce the four documented outcomes without leaving repo B on the feature branch.
3. `--in-place` finish behavior is unchanged; `finish` still fail-closed on missing `target_cwd.txt`.
4. No hardcoded `main` — base comes from `start-branch.txt`.
5. All gates green; dist rebuilt; 3 manifests at `0.1.28`.
6. (Dogfood) a live duet whose finish opens a PR, merges it, and returns repo B to base up-to-date.

## Version & delivery

One PR: `src/core/gitwork.ts` + `src/commands/duet.ts` + `commands/duet.md` + tests + rebuilt `dist` +
`0.1.28` bump.

## Open question (for spec review)

Should this PR also add the **clean-tree / on-base pre-flight guard** to `duet init`/`branch` (refuse,
or warn, when repo B is dirty or not on its base branch) — turning the operating protocol into a
guardrail? Default for now: **no** (keep scope to the finish change; the protocol stays a human
discipline). Say the word to fold it in.
