# `/consort:duet` — Collaborative Cross-Repo Session — Design

**Date:** 2026-06-08
**Status:** approved (brainstorming)
**Scope of this PR:** a new high-level command (`src/commands/duet.ts` + `src/core/duet*.ts` +
`commands/duet.md`), its tests, the rebuilt `dist/consort.cjs`, the plugin command registration, and a
version bump. No change to the frozen wire protocol, no change to the state-path layout, no change to
any existing command's behavior.

## Why

consort can already spawn a part whose working directory is an arbitrary repo (`spawn --cwd <abs>` →
tmux `-c`), and its IPC state is keyed to the **conductor's** cwd, fully decoupled from where the part
edits files. What it lacks is a *command* that puts a human-in-the-loop conductor in an **open-ended,
multi-round conversation** with a single part running **in another repo**.

The motivating workflow: you are in a conductor session in repo A and need work done in repo B, but you
do not want to `cd` out of repo A. You want to expand a tmux pane, open a claude/codex session **in repo
B**, brief it, and then *collaborate* with it across several rounds — reviewing, discussing, refining —
while you (the human) stay reachable for decisions, until the work is done and finished as a reviewable
PR in repo B.

`/consort:solo` is the closest existing command, but it is **fire-and-verify**: fixed target = the
conductor's own repo, one implementation turn (plus at most one fix turn), then an automated verify and
finish. duet is the **complex, conversational** sibling: a different repo, open-ended rounds, two-way
human-in-the-loop, finishing only when you say so.

This is **new behavior beyond the faithful clone-wars port** (and it re-enables a cross-repo capability
in a deliberately narrow form after the multi-repo retirement), so per the CLAUDE.md phase guard it
requires this design doc.

## Goal

Ship one new command, `/consort:duet`, that:

1. Opens **one** persistent part (claude/codex/agy/opencode) in **one** explicit target repo (repo B).
2. Drives an **open-ended, conductor-paced round loop** of brief → work → review → discuss.
3. Relays questions **both ways** with the human, conductor-mediated, using **judgment** (the conductor
   answers what it can; it pulls the human in only for real decisions).
4. **Finishes** by default like solo (isolated branch in repo B → commit → push + PR, or local commit if
   no remote), restoring repo B's original branch — with an `--in-place` opt-out for throwaway work.

All of this with **zero change** to the frozen protocol and the state-path layout: state stays
conductor-keyed; the part's repo is just a persisted cwd the conductor threads into git/test steps.

## Non-goals

- **No multi-repo subsystem revival** (see "The critical disambiguation" below). One repo, one part.
- **No automatic discovery** of the target repo — repo B is an explicit, user-supplied absolute path.
- **No DAG / wave / hub-spoke routing**, no multi-target design doc, no sibling baseline/revert guard.
- **No new state-path keying.** The repo-hash stays `sha256(realpath(cwd))` of the conductor; duet does
  not relocate state to the part's repo.
- **No env injection into the pane** (the part inherits the tmux server env, as today). If a future
  cross-repo part needs repo-local env, that is a separate spec.
- **No automated resume** of an aborted session and **no concurrent duets against the same repo B**
  (see §Concurrency & resume).

## The critical disambiguation (do not conflate with the retired multi-repo subsystem)

The multi-repo subsystem retired in 0.1.23/0.1.24
(`docs/superpowers/specs/2026-06-04-multi-repo-retirement-design.md`) was three things, **none of which
duet re-introduces**:

1. **Automatic sub-repo discovery** — `detectMultiRepo`/`validateTargets`/`RepoHit` scanning sibling
   dirs for `CLAUDE.md`/`AGENTS.md` markers, the `--targets a,b,c` list. → duet takes **one explicit
   path**; no scan, no list, no marker sniffing.
2. **Multi-target document structure** — the `**Target Sub-Project(s):**` header, `## Execution DAG`,
   Cross-Repo Notes, `DocMode multi/single-sub`, `SECTIONS_MULTI`. → duet writes **no design doc at
   all** (it is a conversation, not a `score`-style synthesis).
3. **Hub-spoke wave execution** — `dag.ts`, `performSibling.ts`, the rogue-sibling baseline/revert/replay
   guard, the `perform` multi verbs. → duet runs **one** part through the existing single-part send/wait
   loop; it replaces the deleted rogue-edit guard with **branch isolation** (§Safety).

duet rides only the seam the retirement explicitly **kept**: an explicit per-part working directory
persisted as `target_cwd.txt` and passed to `spawn --cwd`, with git/test actions run via
`runnerAt(targetCwd)`. The retirement spec calls `target_cwd.txt` an explicitly-retained single-repo
backbone file; duet's sole structural difference from solo is that `target_cwd.txt` may name a repo
**other than** the conductor's `repoRoot()`. That is one value, not a subsystem.

**Reviewer checklist** (to be restated in the implementation plan): duet must add **no** reference to
`detectMultiRepo`, `--targets`, `DocMode`, `## Execution DAG`, `iterTargets` multi-row behavior,
`dag.ts`, or `performSibling.ts`.

## Interaction model (the heart of the command)

The conductor is a Claude Code session running `/consort:duet`; the directive `commands/duet.md` is its
brain and the CLI verbs are its plumbing. After spawning the part, the conductor runs this loop:

```
init (--repo repoB + opening task) → branch (in repo B) → spawn part (--cwd repoB, persistent, NO initial prompt)

repeat (round = 1, 2, 3, …):
  round-send <slug> <round>     # round 1 = the opening brief; later rounds = conductor's follow-up text
  round-wait <slug> <round>     # block on the part's outbox since this round's OFFSET
  classify the round's terminal outcome (ok | question | failed | timeout):
     ok       → the part emitted `done` for this round: conductor reviews the outbox + `git -C <repoB> diff`,
                then decides — send another round (more work / refinement), or the work looks
                complete → confirm with the human → leave the loop
     question → JUDGMENT (the locked policy):
                  • answerable from context (paths, conventions, obvious clarification)
                      → `relay` the conductor's own answer, re-arm the same round's wait
                  • a real decision (taste / scope / ambiguous trade-off)
                      → AskUserQuestion the human → `relay` the human's answer, re-arm
                (every relayed question is recorded to question-<round>.txt with which path was taken,
                 so forensics can distinguish judgment calls from human decisions)
     failed   → the part emitted `error` (or a non-terminal junk event): surface to the human; offer
                abort or a re-brief of the same round
     timeout  → no terminal event within the turn timeout: surface to the human; offer abort or re-arm
  # at any point the conductor itself may need a human call (e.g. the part proposes two directions):
  #   AskUserQuestion the human directly, then continue.

# finish-time verify (advisory, like solo):
detect-test <repoB> → directive runs the test once in repo B, tees to verify-1.log, records PASS/FAIL
                      into verify-result.txt — ADVISORY; finish proceeds regardless
finish <slug>  → commit on the isolated branch in repo B; push + open PR (or keep local if no remote);
                 restore repo B's original branch; embed the VERIFY value in the PR body
forensics <slug> → coda (FINE banner + archive) → summary <slug>
```

Notes that are load-bearing for the implementer:

- **The part emits `done` to end every round.** `progress` is mid-round telemetry the part may emit; it
  is **never** a terminal classification. `round-wait` blocks on `done`/`error`/`question` only and
  classifies via the same shape as solo's `classifyTurn` (`done→ok`, `question→question`, `null→timeout`,
  else `→failed`). The conductor decides continue-vs-finish from the reviewed `done` round, not from a
  `progress` event.
- **`spawn` is called WITHOUT an initial prompt.** The opening brief is delivered by `round-send` round 1
  (exactly as solo does); passing an initial prompt to `spawn` would double-brief the part (`spawn` also
  writes the inbox + nudges the pane when given one).
- **The part stays alive across all rounds** (persistent, like `rehearsal`'s parts); teardown happens
  only at the end via `coda`.
- **`round-send` for round N+1 requires the part idle** — its round-N terminal event having been
  classified by `round-wait` — inheriting solo's status-idle send guard. The loop is otherwise
  **conductor/human-paced**: no fixed round cap, no code-driven termination; the human (directly, or by
  approving the conductor's "this looks done") ends it.

### Relay mechanics (reuse solo's proven OFFSET re-arm)

Each round records `OFFSET=<outbox size at send time>` in `round-<round>.txt`; `round-wait` reads the
**latest** offset (`parseLatestOffset`) and blocks on `outboxWaitSince` for `done`/`error`/`question`.
On a `question`, `round-wait` appends a **bumped** `OFFSET=` line plus `TS=question` so a same-round
re-arm resumes **past** the handled question — the same fix solo shipped for the prior
infinite-question-loop bug (grep solo's `turnWaitWith` question re-arm branch in
`src/commands/solo.ts`; line numbers drift). `relay` sends the answer via the `send` primitive (which
defaults `from` to `maestro` in `inboxWrite`, so no explicit `--from` is needed) and re-arms.

**Relay answers go through `inboxWrite`'s done-contract too:** like the round prompts, a relayed answer
must **not** embed `END_OF_INSTRUCTION` or a done-line — `inboxWrite` appends exactly one of each. This
is the same regression class as the prelude duplicate-`END_OF_INSTRUCTION` bug (0.1.25).

## Architecture / components

**New files:**

- `src/commands/duet.ts` — verb dispatch (`init`/`branch`/`round-send`/`round-wait`/`relay`/
  `detect-test`/`finish`/`forensics`/`flag`/`summary`), mirroring `src/commands/solo.ts` shape. `flag`
  records an in-flight forensics flag mid-run, exactly as solo's `flag` verb does.
- `src/core/duet.ts` — `parseDuetArgs` (the `--repo` path + opening task + flags), slug derivation,
  state-path helpers (`duetArtDir`/`duetExecDir`), the duet `renderResume`, and small pure helpers
  (target validation, mode resolution).
- `src/core/duetTurn.ts` — prompt builders: the **opening brief** (round 1) and the **follow-up** prompt
  shell (round ≥ 2 wraps the conductor's free-form text). The opening brief MUST state the **cross-repo
  framing**: the absolute path of repo B, the branch name (`feat/duet-<slug>`, or "current branch" under
  `--in-place`), and one line making clear the conductor is operating from a *separate* repository (so
  "the repo" / "this repository" is unambiguous). It also carries the `BRANCH DISCIPLINE` rule pointed at
  repo B. These builders **do not** embed a done-line or `END_OF_INSTRUCTION`; `inboxWrite` owns the
  single done-contract (the prelude lesson, 0.1.25).
- `commands/duet.md` — the conductor directive implementing the loop above.

**Identity template stays untouched.** `config/prompt-templates/identity.md` has no repo/path field and
does not need one — the round-1 brief carries the repo-B path and branch, so the part learns its location
from the brief (and implicitly from its tmux `-c` cwd). This is an explicit decision, not an oversight.

**Reused as-is (no modification):**

- `spawn --cwd <abs>` + the tmux `-c` arg builders (`src/core/tmux.ts`) — cross-repo pane, already works.
- `send` / `inboxWrite` (`src/core/ipc.ts`) — conductor → part messaging + the single done-contract.
- the outbox waiter + OFFSET re-arm classifier pattern (from solo's `turnWaitWith`).
- `gitwork.ts` — `preSnapshot`, `createOrResumeBranch`, `finishBranch`; `runnerAt(targetCwd)`.
- `detectTestCommand(cwd)` — pointed at repo B for the finish-time verify record.
- `coda` (teardown); `runForensics("duet", duetArtDir, topic)` (the rendered on-disk label is
  `command: duet`, with a space, mirroring solo's `command: solo` — there is no literal `command:duet`
  token).

**Wiring:** register `duet` in the CLI dispatcher (`src/consort.ts` → `commands/duet.run(args)`) and add
the command file to the plugin manifest exactly as the other high-level commands are registered.

## CLI surface

```
/consort:duet --repo <repo-B-abs-path> <opening task …> [--provider codex|claude|agy|opencode] [--in-place]
```

- **Leading flags + verbatim-tail body** — consort's existing convention (`loadArgsFileVerbatim`):
  `--repo` and `--provider` are **value flags**; `--in-place` is boolean; once the first non-flag token
  appears, the rest of the args file is taken as one verbatim body (the opening task, newlines/quotes
  intact). Flags MUST lead.
- **Repo B is an explicit `--repo` value flag, not a positional** — because `loadArgsFileVerbatim`
  returns the whole post-flag tail as one undivided body token, a leading positional path could not be
  separated from the task. As a value flag, `--repo` consumes the next **whitespace-free** token; the
  remaining verbatim body is unambiguously the opening task. A repo path containing spaces is
  unsupported (consistent with the absolute-path requirement) and `init` rejects it.
- Defaults: `--provider codex` (matches solo); branch isolation **on** (no flag); `--in-place` opts out.

**Mechanical verbs** (called by `duet.md`, positional args after the slug, machine-readable stdout):

| Verb | Args | Does |
|---|---|---|
| `init` | `--repo <repoB> <task…> [--provider p] [--in-place]` | validate repoB (existing **whitespace-free absolute path**; a git repo unless `--in-place`); derive slug; refuse if a **duet** session with this slug is already in flight (`existsSync(duetArtDir)`, same mechanism as solo's `_solo` guard); pick a random instrument; write art-dir + exec-dir state incl. `target_cwd.txt`; print `SLUG=/INSTRUMENT=/PROVIDER=/TARGET=/MODE=` |
| `branch` | `<slug>` | `preSnapshot` + `createOrResumeBranch feat/duet-<slug>` in repoB via `runnerAt(target)` (**skipped** under `--in-place`, recorded as in-place); persist `start-branch.txt` + `base.sha`; refuse if repoB is already on a `feat/duet-*` branch from another live session |
| `round-send` | `<slug> <round>` | compose round prompt (round 1 = opening brief; round ≥ 2 = `@round-prompt-<round>.md` the conductor wrote); require the part idle; record `OFFSET` in `round-<round>.txt`; `send` to the part |
| `round-wait` | `<slug> <round>` | block on outbox since latest OFFSET; classify `ok/question/failed/timeout`; on `question`, append bumped `OFFSET` + `TS=question` and write `question-<round>.txt` |
| `relay` | `<slug> <answer…>` | `send` the answer to the part (from `maestro` by default); bump OFFSET; record the answered path in `question-<round>.txt` |
| `detect-test` | `[cwd]` | print repoB's test command (defaults to `target_cwd.txt`) |
| `finish` | `<slug>` | **fail closed** if `target_cwd.txt` is missing/empty (rc 1 + stderr) — never fall back to `repoRoot()`; else commit on the branch; `finishBranch` (push + gh PR, or local) via `runnerAt(repoB)`, embedding VERIFY from `verify-result.txt` in the PR body; write `diff-stats.txt` + `finish-result.txt`; restore start branch |
| `forensics` | `<slug>` | `runForensics("duet", …)` (rendered label `command: duet`) |
| `flag` | `<slug> <source> <key> <context…>` | record an in-flight forensics flag (mirrors solo's `flag`) |
| `summary` | `<slug> [--aborted <phase> <gate> <reason…>]` | write `SUMMARY.md` (and a duet-specific `RESUME.md` on abort) |

## State & paths

State is **conductor-keyed** and unchanged from every other command:
`stateRoot()/state/<repoHash>/<topic>/<instrument>-<model>/` with the frozen filenames
(`inbox.md`/`outbox.jsonl`/`status.json`/`pane.json`/`identity.md`). `repoHash` stays
`sha256(realpath(process.cwd()))` of the **conductor** (`src/core/paths.ts`, `repoHash`). The part edits
repo B, but every `duet` CLI call runs as the conductor from repo A, so its inbox/outbox/status always
resolve correctly — the part's actual edit location is invisible to the path scheme (confirmed in the
design sweep). duet adds **no** part-cwd component to any path.

Per-topic state files (mirroring solo's art-dir/exec-dir split):

- **`duetArtDir` (bookkeeping written by `init`):** `topic.txt`, `topic-text.txt`,
  `selected-provider.txt`, `instrument.txt`, `timing.txt` — exactly the set solo's init writes.
- **`duetExecDir` (execution state):** `target_cwd.txt` (repo B abs path, **written by `init`** — see
  invariant below), `mode.txt` (`branch`|`in-place`), `start-branch.txt` + `base.sha` (written by
  `branch`), `repo-b-head.txt` (repo B HEAD recorded at `init`/`branch` for external-change detection),
  `round-<round>.txt` (OFFSET/TS), `round-prompt-<round>.md`, `question-<round>.txt`, `verify-result.txt`
  (PASS/FAIL from the finish-time verify), `verify-1.log`, `diff-stats.txt`, `finish-result.txt`,
  `SUMMARY.md`, `RESUME.md` (abort only).

**`target_cwd.txt` invariant (differs from solo):** duet writes `target_cwd.txt` in **`init`**, not in
`branch`. solo writes it in `branchWith`; duet cannot, because `--in-place` **skips** `branch`. Writing
it at `init` guarantees `detect-test`/`finish` always resolve repo B — even in `--in-place` mode with no
branch step — and is what makes `finish`'s fail-closed check meaningful.

All atomic writes (tmp-in-same-dir + rename), all absolute paths.

## Safety (replaces the removed rogue-edit guard with isolation)

Cross-repo edits land in a working tree you are not sitting in, and the multi-repo retirement deleted the
`performSibling` baseline/revert guard. duet's safety story:

- **Branch isolation by default.** `branch` cuts `feat/duet-<slug>` in repo B and the part is told (via
  the `BRANCH DISCIPLINE` prompt rule) to stay on it. `preSnapshot` captures repo B's current branch +
  base SHA (committing any pre-existing dirty WIP exactly as solo does), and `finish` restores that start
  branch.
- **Branch before spawn, serialized.** `branch` must complete (checkout confirmed) **before** `spawn`,
  because the part's pane opens at repo B's working tree via `--cwd` and runs `git` from there; isolation
  depends on the checkout having landed first. `init`/`branch` record repo B's HEAD (`repo-b-head.txt`)
  so a mid-session external checkout is detectable.
- **Single working tree, single occupancy.** duet uses repo B's one shared working tree (no
  git-worktree isolation). It therefore assumes repo B is **not concurrently in use** — see §Concurrency.
- **Explicit, validated target.** `init` requires an **existing whitespace-free absolute path**; in
  branch mode it must be a git repo. No discovery, no relative-path guessing.
- **`--in-place` is an explicit opt-out** for quick throwaway work; the directive surfaces a clear
  "editing repo B's current branch directly, no isolation" warning, and `summary`/forensics record the
  mode.
- **Finish targets repo B's remote, or refuses.** `finishBranch` pushes to repo B's `origin` and opens
  the PR there, via `runnerAt(target_cwd)`. `finish` **fails closed** (rc 1) if `target_cwd.txt` is
  missing/empty — it does **not** inherit solo's `|| repoRoot()` fallback, because for a cross-repo
  command that fallback would silently push against repo A (the conductor's repo). Absence of
  `target_cwd.txt` means corrupted state; the correct behavior is to refuse, not to push the wrong repo.

## Concurrency & resume (explicit limitations)

- **No concurrent duets against the same repo B.** Because repo B has one shared working tree, two duets
  on different slugs would fight over the checked-out branch and `finish`'s `git checkout` of the start
  branch could clobber the other's work. `branch` refuses when repo B is already on a `feat/duet-*`
  branch from a live session; otherwise this is a documented unsupported case (use distinct repos or run
  serially).
- **No automated resume.** `init` refuses an in-flight slug, so a duet cannot be resumed by re-running
  the command. `RESUME.md` is therefore a **forensic pointer**, not an automated resume: on abort it
  records repo B's absolute path, the branch, the mode (`branch`|`in-place`), the last completed round
  number, the opening task text, the abort phase/gate/reason, and the exact `git -C <repoB> checkout`
  command to restore repo B's start branch. (duet's `renderResume` is its own — solo's only records
  topic/branch/artDir/phase/gate and omits the repo-B path and round, which would be useless here.)

## Naming & frozen-token compliance

- Command: `/consort:duet` (two performers in dialogue — fits the consort theme).
- Cosmetic tokens: slug prefix `duet-`, branch `feat/duet-<slug>`, forensics command string `"duet"`
  (rendered `command: duet`), state dirs `duetArtDir`/`duetExecDir`. None collide with the stale-token
  gate, whose banned set is `clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_` **plus
  case-insensitive `trooper`/`commander`** (`tests/stale-tokens.test.ts`) — none of duet's tokens
  contain any of these (watch `commands/duet.md` prose for an accidental `commander`/`trooper`).
- **Frozen, untouched:** event names `ready/ack/progress/done/error/question`, the
  `END_OF_INSTRUCTION` sentinel, JSON fields, `contracts.yaml` keys, all state filenames,
  `CLAUDE_CODE_SESSION_ID`. duet adds no new wire events — `question`/`done`/`progress`/`error` already
  cover the loop.

## Error handling

- **part `error` (failed) / `timeout`:** `round-wait` classifies it; the directive surfaces it to the
  human and offers (a) abort → `summary --aborted` writes `RESUME.md`, then `coda`; or (b) re-brief /
  re-arm the same round.
- **Bad target path:** `init` fails fast (rc 1, stderr) if repoB is missing / not absolute / contains
  whitespace / (branch mode) not a git repo — before any pane is spawned.
- **Slug already in flight:** `init` refuses (`existsSync(duetArtDir)`), to avoid clobbering a live duet.
- **Corrupted target state at finish:** `finish` fails closed (above) rather than pushing repo A.
- **Abort mid-loop:** repo B is **left on `feat/duet-<slug>`** with the part's work preserved on that
  branch (the abort path runs `summary --aborted` then `coda`; `coda` does not touch git, so the start
  branch is *not* auto-restored on abort — matching solo). `RESUME.md` records the restore command. The
  "restore start branch" guarantee applies to the **normal `finish` path only**, not to abort.
- Errors go to **stderr**, never the outbox.

## Testing

**Unit (vitest, `CONSORT_HOME` per-test temp dir):**

- `parseDuetArgs`: `--repo` value flag captures a whitespace-free abs path; verbatim-tail opening task
  survives apostrophes/newlines; `--provider` value flag; `--in-place` boolean; flags-must-lead; a
  whitespace-containing `--repo` value is rejected.
- state-path builders (`duetArtDir`/`duetExecDir`) resolve under the conductor's repoHash.
- `init` writes the full art-dir + exec-dir state set, including `target_cwd.txt` (even with
  `--in-place`, no `branch` call), and rejects a bad/whitespace/non-abs/non-git target.
- `duetTurn` prompt builders: round-1 brief contains the **repo-B absolute path**, the branch name, the
  cross-repo framing, the task, and `BRANCH DISCIPLINE`; round-≥2 follow-up wraps the conductor's text;
  **no** embedded `END_OF_INSTRUCTION` / done-line; after `inboxWrite` the inbox carries **exactly one**
  `END_OF_INSTRUCTION` and one done line (regression guard, the prelude class). Same inbox-count guard
  for a relayed answer.
- OFFSET re-arm classifier: `done→ok`, `question→question` + bumped OFFSET appended + `question-<round>.txt`
  written, `null→timeout`, else `failed`; `parseLatestOffset` picks the last offset.
- `finish` with a mocked `runnerAt`: **fails closed** when `target_cwd.txt` is absent/empty (rc 1, no
  push); branch-mode commits + (remote) pushes/PRs vs. (no remote) local; `--in-place` skips branch ops
  but still targets repo B (via init-written `target_cwd.txt`), not `repoRoot()`; start branch restored
  on the normal path; VERIFY value embedded in the PR body.
- duet `renderResume`: `RESUME.md` contains repo-B path, branch, mode, last round, opening task, and the
  restore command.
- tmux args remain **pure arg-array** assertions (no real panes) — the cross-repo `-c <repoB>` path
  through `spawn` is asserted at the builder level.

**Stale-token + `typecheck` + `lint` + `test`** all green; **rebuild `dist/consort.cjs`** (deterministic
SHA) and commit it.

**Live dogfood (acceptance):** from repo A, run `/consort:duet --repo <repoB> "<task>"`; observe a pane
open in repo B, a multi-round exchange, **one relayed question** (part → conductor → human → part), and a
finish that produces a `feat/duet-<slug>` branch + PR in repo B with repo B's start branch restored.
Capture the forensics file.

## Acceptance criteria

**Mechanically checkable (unit/integration):**

1. `/consort:duet` is registered and dispatches; `init` validates repo B (rejecting bad/whitespace/non-abs/
   non-git paths) and prints the state line; `target_cwd.txt` exists after `init` even with `--in-place`.
2. A part spawns **in repo B** (pane cwd = repo B, asserted at the tmux-builder level).
3. `finish` produces an isolated branch + PR (or local commit) **in repo B** and restores its start
   branch; `--in-place` edits the current branch; `finish` **fails closed** with no `target_cwd.txt`.
4. State for the session lives under the **conductor's** repo-hash; nothing is written under repo B's
   hash.
5. No reference to any retired multi-repo unit (§disambiguation checklist); stale-token gate passes;
   `dist/consort.cjs` rebuilt and committed; version bumped across the 3 manifests.

**Dogfood-observed (LLM-judgment behavior, verified live — not unit-testable):**

6. The conductor runs **N ≥ 3 rounds** (proxy: `round-<round>.txt` files for `round ≥ 3` exist after the
   dogfood).
7. Judgment relay works: a trivial question is answered by the conductor; a real-decision question
   reaches the human via AskUserQuestion and the human's answer reaches the part (proxy: at least one
   `question-<round>.txt` with a recorded relayed answer).

## Version & delivery

- New command → the **next `0.1.x` patch**, set at implementation time against `main` (the project
  versions every change in the `0.1.x` line). Bump all three manifests: `package.json`,
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`.
- One PR: `src/` + `tests/` + `commands/duet.md` + manifest registration + rebuilt `dist/` + version
  bump. Documentation prose (`MIGRATION.md`, `CLAUDE.md` phase-guard note, README command list) can ride
  the same PR or a short follow-up, per the project's usual pattern.

## Risks & mitigations

- **Read as a multi-repo revival.** Mitigation: the §disambiguation section + the reviewer checklist; the
  implementation adds none of the retired units.
- **Loop never terminates / runs away.** Mitigation: the loop is human-paced (no autonomous round cap);
  each `round-wait` has the standard turn timeout; the human and the conductor both gate "finish."
- **OFFSET re-arm regression** (the bug solo already hit). Mitigation: copy solo's `turnWaitWith`
  question re-arm branch and cover it with the classifier unit test.
- **Duplicate `END_OF_INSTRUCTION`** (the prelude bug). Mitigation: duet prompt builders AND relayed
  answers carry **no** done-contract; `inboxWrite` owns it; covered by the inbox-count regression test.
- **Wrong-repo push at finish.** Mitigation: `finish` runs via `runnerAt(target_cwd)` and **fails
  closed** on missing `target_cwd.txt` (no `repoRoot()` fallback); `target_cwd.txt` is written at `init`.
- **Concurrent / dirty repo B working tree.** Mitigation: branch-before-spawn serialization, recorded
  repo B HEAD, single-occupancy refusal in `branch`; documented unsupported case.
- **Stale-token / phase-guard friction.** Mitigation: all new tokens use the `duet`/`cs` vocabulary; this
  spec satisfies the phase guard.
