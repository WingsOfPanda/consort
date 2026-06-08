---
description: Collaborative cross-repo session — open one persistent claude/codex part in ANOTHER repo and co-develop with it over open-ended rounds, relaying questions both ways with you, finishing as a PR in that repo.
argument-hint: --repo <abs-repo-path> <opening task> [--provider codex|claude|agy|opencode] [--in-place]
allowed-tools: Bash, Write, Read, Edit, AskUserQuestion
---

# /consort:duet

Open ONE persistent part in the repo named by `--repo` (repo B) and collaborate with it over as many
rounds as the work needs. You (the conductor) stay in your own repo (repo A); the part edits repo B.
Use **judgment** on the part's questions: answer the ones you can confidently handle from context;
pull in the human via AskUserQuestion only for real decisions (taste, scope, ambiguous trade-offs).

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

## Flagging suspicions

At any point, if something looks off, record it: `$CS duet flag <SLUG> "<what looked off>"`. It writes
straight to the playback feed (survives teardown and aborts) and costs nothing. Review with `/consort:playback`.

## Stage 0 — Init

1. Mint an args path and write `$ARGUMENTS` into it:
   - Run: `$CS duet --mint-args-file` → prints `<args-path>`.
   - **Write tool:** `file_path` = `<args-path>`, `content` = `$ARGUMENTS` (verbatim, unquoted).
2. Init: `$CS duet init --args-file <args-path>`. On success it prints (stdout is clean; logs go to stderr):
   ```
   SLUG=<slug>
   INSTRUMENT=<instrument>
   PROVIDER=<provider>
   MODE=<branch|in-place>
   TARGET=<repo-B-abs-path>
   ```
   Capture each value. Non-zero exit aborts: rc 1 = bad/empty task or bad `--repo`, rc 2 = topic already
   in flight, rc 3 = provider not installed. No SUMMARY is written (state dir was never created).

## Stage 1 — Branch + spawn + open

1. If `MODE=branch`: `$CS duet branch <SLUG>`. On **rc 1** (not a git repo, or repo B already on another
   `feat/duet-*` branch) → abort: `$CS duet summary <SLUG> --aborted setup branch "<reason>"`, print the
   SUMMARY, stop. (No part spawned, so no `coda`.) If `MODE=in-place`: skip branch entirely.
2. Spawn the part **in repo B** (NO initial prompt — the brief is round 1):
   `$CS spawn <INSTRUMENT> <PROVIDER> <SLUG> --cwd <TARGET>`. On **rc 1** (bootstrap failed) → abort:
   `$CS duet summary <SLUG> --aborted setup spawn-failed "part failed bootstrap"`, print SUMMARY, stop.
   Do **not** run `coda` — `spawn` already FAILED-archived the part.
3. Dispatch round 1: `$CS duet round-send <SLUG> 1`, then await it in the background:
   ```
   Bash(command='$CS duet round-wait <SLUG> 1', run_in_background: true, description='duet await round 1')
   ```

## Stage 2 — The collaboration loop (open-ended)

For the current `<ROUND>` (starting at 1), on each completion notification read the **last** `TS=` line
from `<SLUG state>/_duet/execute/round-<ROUND>.txt` and branch:

- **`TS=ok`** → the part finished this round. Review its work: read its outbox and run
  `git -C <TARGET> diff` to see the changes. Then decide:
  - **More to do** → choose the next round number `<N>` = `<ROUND>+1`. **Write**
    `<SLUG state>/_duet/execute/followup-<N>.md` with your refinement/next instruction, then
    `$CS duet round-send <SLUG> <N>` and background `$CS duet round-wait <SLUG> <N>`. Set `<ROUND>=<N>`.
  - **Done** → if it looks complete, confirm with the human (a short AskUserQuestion or a direct
    question). On confirmation → go to Stage 3.
- **`TS=question`** → read `execute/question-<ROUND>.txt`. **Judgment:**
  - Answerable from context (a path, a naming convention, an obvious clarification) → answer it yourself:
    `$CS duet relay <SLUG> <ROUND> "<your answer>"` (or `@<reply-file>` for long answers), then re-arm the
    background `$CS duet round-wait <SLUG> <ROUND>`.
  - A real decision (taste, scope, an ambiguous trade-off) → **AskUserQuestion** the human, then relay
    their answer: `$CS duet relay <SLUG> <ROUND> "<human's answer>"`, then re-arm the wait.
  The re-arm resumes past the handled question automatically (round-wait appended a bumped `OFFSET=`).
- **`TS=failed` or `TS=timeout`** → tell the human; offer to (a) re-arm the same round once more, or
  (b) abort: `$CS duet summary <SLUG> --aborted round round-wait "part round failed (TS=<ts>)"`, then
  `$CS coda <INSTRUMENT> <SLUG>`, print SUMMARY, stop.

At any round you may also need a call the part didn't ask for — use AskUserQuestion directly, then
continue.

## Stage 3 — Verify + finish

1. Verify (advisory): `TEST_CMD=$($CS duet detect-test <TARGET>)`. If non-empty, run it once in `<TARGET>`,
   tee to `execute/verify-1.log`; set `VERIFY` to `PASS (<cmd>)` / `FAIL (<cmd>)`. If empty,
   `VERIFY="skipped (no test command detected)"`. A FAIL does not block finish — you may open one more
   round to fix it (your judgment), or proceed.
2. Record the verify result so finish can embed it in the PR body:
   ```bash
   printf '%s\n' "$VERIFY" > <SLUG state>/_duet/execute/verify-result.txt
   ```
3. Finish (branch mode → push + PR in repo B, or local commit if no remote; in-place → leaves commits on
   the current branch): `$CS duet finish <SLUG>`.

## Stage 4 — Teardown + SUMMARY

1. **Forensics + reflection (BEFORE teardown):** `FORENSICS=$($CS duet forensics <SLUG>)`. If non-empty,
   tell the user "forensics captured: $FORENSICS", **Read** it and **append** a `## Maestro reflection`
   section (idempotent: skip if the file already contains the exact header `## Maestro reflection`).
2. Tear down + archive the part:
   ```bash
   ARCHIVED=$($CS coda <INSTRUMENT> <SLUG> 2>&1 | sed -n 's/.*archived [^:]*: //p' | tail -1)
   [ -n "$ARCHIVED" ] && printf '%s\n' "$ARCHIVED" > <SLUG state>/_duet/archived-path.txt
   ```
3. `$CS duet summary <SLUG>` — writes `SUMMARY.md`. Then print it: `cat <SLUG state>/_duet/SUMMARY.md`.

## Notes

- One part, one repo (repo B), open-ended rounds. This is NOT the retired multi-repo subsystem — no
  discovery, no `--targets`, no DAG.
- State lives under YOUR (conductor) repo hash; the part just works in repo B via `--cwd`.
- `<SLUG state>` = `<repo-A>/.consort/state/<hash>/<SLUG>` (the conductor's state tree).
