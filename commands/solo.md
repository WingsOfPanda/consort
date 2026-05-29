---
description: Light pipeline — one part implements a clear single-repo change unattended on its own branch; the conductor briefs, verifies, and (optionally) finishes. No research, no design doc, no gates.
argument-hint: <topic-text> [--provider codex|claude|agy|opencode] [--finish]
allowed-tools: Bash, Write, Read, Edit
---

# /consort:solo

The light, autonomous path for a small, clearly-specified single-repo change. One part (a
non-conductor model, default **codex**) implements the change on its own `feat/solo-<topic>`
branch in this repository. The conductor writes a short brief, spawns the part, runs one
implementation turn, does one light verify pass, then tears down. With `--finish`, it also
pushes the branch and opens a PR. There are **NO interactive gates**.

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

## Stage 0 — Init + Brief

1. Mint an args path and write `$ARGUMENTS` into it:
   - Run: `$CS solo --mint-args-file` → prints `<args-path>`.
   - **Write tool:** `file_path` = `<args-path>`, `content` = `$ARGUMENTS` (verbatim, unquoted).
2. Init: `$CS solo init --args-file <args-path>`. On success it prints these lines to stdout —
   capture each value (logs go to stderr, so stdout is clean):
   ```
   SLUG=<slug>
   INSTRUMENT=<instrument>
   PROVIDER=<provider>
   FINISH=<yes|no>
   TARGET=<abs-repo-root>
   ```
   Non-zero exit aborts: rc 1 = bad/empty topic, rc 2 = topic already in flight, rc 3 = provider
   not installed. No SUMMARY is written (state dir was never created).
3. **Brief.** Read the cleaned topic from `<SLUG state>/_solo/topic-text.txt` if needed, then
   **Write** `<SLUG state>/_solo/task-brief.md` using exactly this shape (keep it short — a brief,
   not a design doc). To find the state path, the directive does not need it: every later step
   takes `<SLUG>` as `<topic>` and resolves paths internally. Author the brief content from the
   topic and Write it to the path `solo init` logged (`solo init` logs `topic=<slug>`; the brief
   path is `<repo>/.consort/state/<hash>/<SLUG>/_solo/task-brief.md`). Shape:
   ```markdown
   ## Goal
   <1-2 sentences restating the change>

   ## Acceptance check
   <a specific behavior, or "the repo's tests pass">

   ## Touch-point hints
   <only if obvious from the topic; otherwise omit this heading>
   ```

## Stage 1 — Build

1. Branch the target: `$CS solo branch <SLUG>` (snapshots HEAD, commits any WIP on the current
   branch, creates/resumes `feat/solo-<SLUG>`). rc 1 = target is not a git repo (abort).
2. Spawn the part: `$CS spawn <INSTRUMENT> <PROVIDER> <SLUG> --cwd <TARGET>`. rc 1 = bootstrap
   failed (the part's state is FAILED-archived); abort with a SUMMARY (Stage 3 abort form).
3. Dispatch round 1: `$CS solo turn-send <SLUG> 1`.
4. Await it in the background:
   ```
   Bash(command='$CS solo turn-wait <SLUG> 1', run_in_background: true, description='solo await turn 1')
   ```
5. On the completion notification, read `TS` from `<SLUG state>/_solo/execute/turn-1.txt` and branch:
   - **`TS=ok`** → Stage 2.
   - **`TS=question`** → read `execute/question-1.txt`, **Write** a best-judgment reply to a temp
     file, then `$CS send --from maestro <INSTRUMENT> <SLUG> @<reply-file>`, and re-arm the
     background `solo turn-wait <SLUG> 1`. Never ask the user. (Re-arm on each question.)
   - **`TS=failed` or `TS=timeout`** → retry once: delete `execute/turn-1.txt`, re-run
     `$CS solo turn-send <SLUG> 1`, re-arm the background wait. On a **second** failure → abort:
     `$CS solo summary <SLUG> --aborted build part-turn-failed "part turn failed twice (TS=<ts>)"`,
     then `$CS coda <INSTRUMENT> <SLUG>`, print the SUMMARY, and stop.

## Stage 2 — Verify + finish

1. Detect the test command: `TEST_CMD=$($CS solo detect-test <TARGET>)`.
2. If `TEST_CMD` is non-empty, run it once in `<TARGET>` via Bash, tee to
   `<SLUG state>/_solo/execute/verify-1.log`; set `VERIFY` to `PASS (<cmd>)` or `FAIL (<cmd>)`.
   If empty, `VERIFY="skipped (no test command detected)"`.
3. If `VERIFY` starts with `FAIL`: read the tail of `verify-1.log`, **Write**
   `execute/fix-prompt-2.md` (concrete failures + fix direction), then `$CS solo turn-send <SLUG> 2`,
   background `$CS solo turn-wait <SLUG> 2`; on completion re-run `TEST_CMD` into `verify-2.log`
   and set `VERIFY` to the second result. **One fix round only** — proceed regardless.
4. Record results (run in `<TARGET>`):
   ```bash
   git -C <TARGET> diff --shortstat "$(cat <SLUG state>/_solo/execute/branch-base.sha)"..HEAD \
     > <SLUG state>/_solo/execute/diff-stats.txt
   printf '%s\n' "$VERIFY" > <SLUG state>/_solo/execute/verify-result.txt
   ```
5. Finish (always restores the start-branch checkout; pushes/opens a PR only when `FINISH=yes`):
   `$CS solo finish <SLUG>`.

## Stage 3 — Teardown + SUMMARY

1. `$CS coda <INSTRUMENT> <SLUG>` — graceful FINE banner → teardown → archive the part dir.
2. `$CS solo summary <SLUG>` — writes `SUMMARY.md`. Then print it:
   `cat <SLUG state>/_solo/SUMMARY.md`.

## Notes

- One part, one branch, one implementation turn, one light verify pass, optional autonomous finish.
  No research, no design doc, no multi-repo/DAG, no interactive gates.
- On abort, `SUMMARY.md` + `RESUME.md` point at the partial state under `_solo/`; re-run
  `/consort:solo` with revised framing to retry.
- For research, a reviewable design doc, multi-repo, or multiple parts → future `/consort:score`
  + `/consort:perform`.
