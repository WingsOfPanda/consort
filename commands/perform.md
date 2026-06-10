---
description: Implement a deploy-schema design doc — audit, spawn one part to plan/implement/self-verify, Maestro cross-verifies and runs a bounded fix-loop, then finish + teardown (single-repo)
argument-hint: [--no-branch] [--branch <n>] [--topic <slug>] [--max-rounds N] [<design-doc-path>]
allowed-tools: Bash, Write, Read, Edit, AskUserQuestion, Skill, TodoWrite, mcp__codegraph
---

# /consort:perform

Run a part-implements / Maestro-verifies pipeline on `$ARGUMENTS` — the consumer of the
deploy-schema design doc that `/consort:score` produces. The `tutti` part stays attached for the
whole run; `tmux select-pane` to watch.

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

## Progress tracking

Maintain a **TodoWrite** list so the user can see where the run is. Seed it right after Stage 0
`init` succeeds, mark each item `in_progress` when you enter that stage and `completed` when you
leave it, and use **one rolling todo** for the dynamic fix-rounds rather than one todo per round.

- Seed: `spawn part`, `build+verify loop`, `scope+finish`, `teardown+archive`.

## Flagging suspicions

At any point in the run, if something looks weird, surprising, or suspicious — even a likely false
alarm — record it: `$CS perform flag <TOPIC> "<what looked off>"`. It writes straight to the playback
feed (survives teardown and aborts) and costs nothing, so prefer over-recording. Review later with
`/consort:playback`.

> **Scope:** single-repo. One part implements the design doc on its own `feat/perform-<TOPIC>`
> branch; the Maestro cross-verifies and runs a bounded fix-loop, then a finish menu + teardown/archive.

## Stage 0 — args-file + init + branch

1. **Strip `--max-rounds` first.** Scan `$ARGUMENTS` token-by-token: if you see `--max-rounds`,
   capture the NEXT token into `MAX_ROUNDS_OVERRIDE` and drop both tokens. (The init verb rejects
   `--max-rounds`, so it must never reach the args file.) If absent, leave `MAX_ROUNDS_OVERRIDE` unset.
2. Mint an args path: `$CS perform --mint-args-file` → prints `<args-path>`.
3. **Write tool:** `file_path` = `<args-path>`, `content` = the **filtered** argument string from
   step 1 (`$ARGUMENTS` minus the `--max-rounds <N>` pair), verbatim and unquoted.
   1. **Source default (no positional doc).** If the filtered argument string contains no `.md`
      positional path, run `$CS perform find-latest-doc`. On rc 0 it prints `DOC=<abs path>` (the
      newest `*-design.md` across the score art dirs); on rc 1 no doc exists. On a `DOC=<path>` line
      → **AskUserQuestion** ("Use this design doc / Cancel"):
      - *Use this design doc* — **Edit** (or re-Write) `<args-path>` to append the `<path>` as a
        trailing positional so `init` receives it as the design doc, then continue to step 4.
      - *Cancel* — stop.
      On rc 1 (none found) → stop and tell the user to pass a `<design-doc-path>` (or run
      `/consort:score` to generate one).
4. **Audit the doc (before init).** Let `<doc>` be the design-doc path now in `<args-path>` (the
   positional you wrote in step 3 / appended in step 3.1). Run `$CS perform audit <doc>` and branch
   on its rc:
   - **rc 2** — the doc is unreadable or usage was malformed. If a topic art dir already exists
     (it does not at this point unless a prior run left one), `$CS perform archive <TOPIC>`. Either
     way, surface the message and stop.
   - **rc 1** — the doc is readable but the audit **FAILED** (it printed `ISSUE=<code>` lines to
     stderr). Surface the issues, then **AskUserQuestion** ("Proceed anyway / Abort and edit doc"):
     - *Proceed anyway* — append ` --force` to `<args-path>` (so `init` reads the args file with the
       force flag and skips the audit gate), then run `init` as in the rc 0 path below.
     - *Abort and edit doc* — tell the user to fix the design doc (or re-run `/consort:score` to
       regenerate one) and stop.
   - **rc 0** — audit PASSED. Proceed to `init` normally.

   Init: `$CS perform init --args-file <args-path>`. On success it prints to stdout:
   ```
   ART=<abs path to the _perform art dir>
   TOPIC=<slug>
   PROVIDER=<codex|claude>
   TARGET_CWD=<abs path the part runs in>
   ```
   Capture all four. Non-zero aborts:
   - **rc 1** — the doc/topic/target was unreadable/unresolvable (the audit was already cleared
     above). Surface the message and stop.
   - **rc 2** — usage error, or the topic is already in flight (run `/consort:coda <TOPIC>` to clear it
     first). Stop.
5. **Pre-snapshot + branch.** `$CS perform pre-snapshot <TOPIC>` (commits any dirty tree so the
   perform branch forks clean; rc 2 = the target is not a git repo → surface and stop). Then, unless
   the user passed `--no-branch`, `$CS perform branch <TOPIC>` (creates/resumes `feat/perform-<TOPIC>`
   from the clean HEAD and records `branch-base.sha`). With `--no-branch`, run
   `$CS perform branch --no-branch <TOPIC>` (stays on the current branch).

> **Claude-confirm gate (before the spawn).** `init` records the part's auto-detected provider
> (`PROVIDER=<codex|claude>` on stdout; also written to `$ART/auto_provider.txt`). **Before
> spawning the part when its provider is `claude`** (this repo has a `.claude-plugin/plugin.json`),
> **AskUserQuestion**:
> - question: "This repo has .claude-plugin/plugin.json — Claude is the recommended part for plugin
>   testing (it can load slash commands, run hooks, exercise the Claude Code surface natively). It will
>   use claude tokens. Use claude or fall back to codex?"
> - options: "Use claude (recommended for plugin testing)" / "Fall back to codex (cheaper)"
>
> On *Use claude* keep the provider as `claude`; on *Fall back to codex* set the spawn's provider
> to `codex`. Apply this gate at the Stage 1.1 spawn.

## Stage 1.1 — spawn the part (single-repo)

First apply the **Claude-confirm gate** (defined after Stage 0): if `PROVIDER=claude`, AskUserQuestion
as specified there and, on *Fall back to codex*, set `PROVIDER=codex` for this spawn. Then spawn one
part in the resolved target cwd:

```bash
$CS spawn tutti "$PROVIDER" "$TOPIC" --cwd "$(cat "$ART/target_cwd.txt")"
```

On spawn failure (non-zero): `$CS perform archive <TOPIC>` and stop (nothing to tear down — the part
never came up).

## Stage 1 — run the part turn (round-aware, auto-retry-once)

Initialize once: `ROUND=1`, `RETRY=0`, `MAX_ROUNDS=${MAX_ROUNDS_OVERRIDE:-5}`. Then per round:

1. Dispatch: `$CS perform turn-send <TOPIC> <ROUND>`. If it exits **non-zero with a "not idle"
   message** (the part's `status.json` state is not `idle`, so the send is refused),
   **AskUserQuestion** ("Wait 60s and retry / Force-retry / Abort"):
   - *Wait 60s and retry* — `sleep 60`, then re-run `$CS perform turn-send <TOPIC> <ROUND>`.
   - *Force-retry* — `$CS perform reset-status <TOPIC> tutti` (atomically resets the part to `idle`),
     then re-run `$CS perform turn-send <TOPIC> <ROUND>`.
   - *Abort* — `$CS coda <TOPIC>` then `$CS perform archive <TOPIC>`; stop.
   (The single-repo part is the `tutti` instrument.) Any other non-zero rc → surface and stop.
2. Wait in the background so your pane stays interactive:
   ```
   Bash(command='$CS perform turn-wait "$TOPIC" "$ROUND"', run_in_background: true,
        description="maestro await tutti round=$ROUND")
   ```
   The default turn budget is 4 hours (`CONSORT_PERFORM_TURN_TIMEOUT_S=14400`); override the env var
   for unusually large or small tasks.
3. On completion, read `TS=` from `$ART/turn-tutti-<ROUND>.txt` (the **last** `TS=` line). Branch:
   - **`TS=ok`** → Stage 2.
   - **`TS=failed` / `TS=timeout`** → auto-retry **once**: if `RETRY==0`, set `RETRY=1`,
     `rm -f $ART/turn-tutti-<ROUND>.txt $ART/turn-tutti-<ROUND>.done $ART/tutti_turn_prompt_<ROUND>.md`,
     and loop back to step 1 (same round). If `RETRY==1` (a second failure), **AskUserQuestion**
     ("Hand-off (preserve the pane + write RESUME.md) / Abort (teardown + archive) / Try-again"):
     - *Hand-off* — write `$ART/RESUME.md` (topic dir, branch, last verdict, manual-takeover steps);
       do NOT tear down; stop.
     - *Abort* — `$CS coda <TOPIC>` then `$CS perform archive <TOPIC>`; stop.
     - *Try-again* — `RETRY=0`; loop back to step 1.
   - **`TS=question`** → the part halted with a question. Read the payload file
     `$ART/question-tutti-<ROUND>.txt` (KV: `TEXT=` percent-encoded, `CLAIM_KIND=`, `CLAIM_VALUE=`,
     `ROUTE=verify|escalate|objection`). Decode `TEXT` with the same scheme `score` uses
     (`%0A`→newline, etc.).
     - **`ROUTE=verify`** — verify the claim against ground truth: run the matching check for
       `CLAIM_KIND` in `TARGET_CWD` (`path`→exists+readable, `git`→`git -C "$TARGET_CWD" rev-parse
       --verify <value>`, `env`→is the var set, `cmd`→`command -v <value>`, `test`→`timeout 30 bash -c
       <value>`). Compose the reply: `From: maestro` then `Verdict: FOUND|NOT FOUND|UNVERIFIABLE` +
       the claim kind/value + the evidence + `Resume implementation.`. Write it to a temp file and
       deliver: `$CS send --from maestro tutti "$TOPIC" @<reply-file>`.
     - **`ROUTE=escalate`** (or an unverifiable claim) — **AskUserQuestion** with the decoded `TEXT`
       as the question; write the user's answer to a temp file and deliver it the same way.
     - **`ROUTE=objection`** — the part believes the plan is wrong. Read the latest `OBJECTIONS=`
       line from `$ART/turn-tutti-<ROUND>.txt`.
       - If `OBJECTIONS >= 3` (the cap of 2 is exceeded): **force-escalate** — handle exactly like
         `ROUTE=escalate` above (AskUserQuestion with the decoded `TEXT`; deliver the answer). Do
         NOT offer Revise/Override again.
       - Otherwise render the decoded `TEXT` (if it is empty, render "the part objects to the plan
         (no detail given)") and **AskUserQuestion** ("Revise the plan / Override (proceed as
         planned) / Abort"):
         - *Revise* — **Edit** `$ART/design.md` and/or `$ART/plan.md` to address the objection, then
           write a reply to a temp file (`From: maestro`, then "Plan updated — re-read the plan and
           continue.") and deliver it: `$CS send --from maestro tutti "$TOPIC" @<reply-file>`.
         - *Override* — write a reply (`From: maestro`, then "Proceeding as planned: <your reason>.
           Resume implementation.") and deliver it the same way.
         - *Abort* — `$CS coda <TOPIC>` then `$CS perform archive <TOPIC>`; stop.
     - **Re-arm** the wait on the **same** round: re-run the background `turn-wait <TOPIC> <ROUND>`
       (the prior question-wait appended a fresh `OFFSET=`, so it resumes past the question). The next
       event you see should be the part's `ack`, then its next terminal event.

## Stage 2 — cross-verify (Maestro)

Invoke `superpowers:verification-before-completion`. Read (capped):
- `$ART/verify-report-<ROUND>.md` (the part's self-verify),
- `$ART/test-output-<ROUND>.log` (tail for pass/fail counts),
- `git -C "$TARGET_CWD" log --oneline "$(cat "$ART/branch-base.sha")"..HEAD` and
  `git -C "$TARGET_CWD" diff --stat "$(cat "$ART/branch-base.sha")"..HEAD`,
- up to 3 spot-checks: Read the highest-stakes diff hunk per critical requirement (paths from
  `git diff` are relative to `TARGET_CWD`; prefix them).

Write the verdict to `$ART/cross-verify-<ROUND>.md`: top line `VERDICT: PASS` or `VERDICT: FAIL`. On
FAIL, list issues under `## Issues`, each tagged `[bug]` / `[regression]` / `[spec-gap]` with a
`(file:line)` reference and a one-line fix direction.

- `VERDICT: PASS` → Stage 4.
- `VERDICT: FAIL` and `ROUND > MAX_ROUNDS` → write `$ART/RESUME.md`; **AskUserQuestion** ("Continue
  one more round / Hand-off / Abort"). Default hand-off. Continue → `MAX_ROUNDS=$((MAX_ROUNDS+1))` and
  go to Stage 3; Abort → `$CS coda <TOPIC>` + `$CS perform archive <TOPIC>`, stop.
- `VERDICT: FAIL` and within budget → Stage 3.

## Stage 3 — author the fix bundle

Read `cross-verify-<ROUND>.md`. Write `$ART/fix-prompt-$((ROUND+1)).md` — tagged bullets only, **no**
preamble, **no** skill mention, **no** `END_OF_INSTRUCTION` (the turn-send verb wraps it):

```markdown
- [bug] <file:line evidence> — <suggested fix direction>
- [spec-gap] <file:line evidence> — <suggested fix direction>
```

Then `ROUND=$((ROUND+1))`, `RETRY=0`, and loop back to Stage 1.

## Stage 4 — scope check + summary + finish + teardown

1. **Scope conformance.** `$CS perform scope-check <TOPIC>` (writes `scope-out-of-scope.txt`, prints
   `SCOPE_DECLARED=`/`OOS_COUNT=`/`OOS_PATH=`). If `SCOPE_DECLARED=0`, the design declared no
   parseable component paths, so the OOS list is the entire diff — a guard **no-op**, not a real
   finding; prefer *Amend* (add a real Components table) and do NOT *Force-keep* the no-op. Otherwise,
   if `OOS_COUNT > 0`, read the file and **AskUserQuestion** ("Amend the design / Send back to the
   part / Force-keep"):
   - *Amend* — draft the new Components-table rows, present them, **Edit** `$ART/design.md` to insert
     them, and record `amended-rows=<n>` to `$ART/scope-amended.txt`.
   - *Send back* — append the out-of-scope paths as a `[scope]` bug to `$ART/fix-prompt-$((ROUND+1)).md`
     and re-enter Stage 1 (one more fix round).
   - *Force-keep* — append the paths to `$ART/scope-overrides.txt` and proceed.
2. **Summary.** `$CS perform summary <TOPIC>` — surface its block (branch, baseline/HEAD,
   diff stat, commit list) to the user verbatim.
3. **Finish menu.** Recommend **Push + PR** if `git -C "$TARGET_CWD" remote` is non-empty, else
   **Merge**. **AskUserQuestion** ("Merge to start branch / Push + PR / Keep the branch / Discard"),
   then apply: `$CS perform finish <TOPIC> <merge|pr|keep|discard>`. Read the outcome from
   `$ART/finish-results.tsv` (`<slug>\t<action>\t<outcome>`); on `merge-conflict-left`, tell the user
   the branch was preserved and the repo restored to the start branch (resolve `git merge
   feat/perform-<TOPIC>` by hand).
4. **Forensics + reflection.** `$CS perform forensics <TOPIC>`. If it printed a path, use the
   **Edit/Write tool** to APPEND an idempotent `## Maestro reflection` section to that file — 3-5
   short bullets interpreting the mechanical findings.
5. **Teardown + archive.** `$CS coda <TOPIC>` (closes the part's pane; prints the **FINE** banner),
   then `$CS perform archive <TOPIC>`.
6. **Final summary.** Print: the branch + commit count (`git -C "$TARGET_CWD" log --oneline
   "$(cat "$ART/branch-base.sha")"..HEAD | wc -l`), the finish outcome, and the archive path.
