# consort `solo` — Design

**Date:** 2026-05-29 · **Status:** approved · **Branch:** `feat/solo`

> The **first high-level command** for consort, porting clone-wars `strike`. Wins over
> `MIGRATION.md` where they differ. Honors the foundation phase guard's frozen wire
> protocol and the locked musical rebrand.

---

## 1. Summary

`solo` is the **light, autonomous path**: one part implements a clear single-repo change
unattended on its own branch, then the conductor verifies and (optionally) finishes it.
It ports clone-wars `strike` — **brief → build → one light verify → autonomous finish** —
with **no interactive gates**.

In clone-wars, `strike` was "light" only because it reused the heavy `deploy` machinery
(`deploy-turn-send/-wait/-branch/-finish`, ~1.4k LOC). consort's `perform` (was `deploy`)
is **not built yet**, so `solo` builds its **own** modernized single-turn / branch / verify /
finish logic on top of the existing foundation primitives. This is deliberate and matches
the migration plan: `solo` is Phase 3 — first high-level command — **because it is the
smallest, and it establishes the brief→build→verify→finish arc that `perform` later reuses.**
The reusable pieces land in `core/turn.ts` and `core/gitwork.ts` for that purpose.

**Behavioral spec source:** `clone-wars/commands/strike.md`, `clone-wars/bin/strike-init.sh`,
`clone-wars/lib/strike.sh`, and the `deploy` machinery it leans on
(`clone-wars/bin/deploy-{pre-snapshot,branch,turn-send,turn-wait,finish}.sh`,
`clone-wars/lib/deploy.sh`). Preserve **behavior and stage sequence**, modernize internals —
do not transliterate line-by-line.

---

## 2. Scope & non-goals

**In scope (this spec):** the `solo` command end-to-end — `commands/solo.md` directive,
the `solo` subcommand family, the two reusable core modules, unit tests, and a live dogfood.

**Non-goals (out of scope; each its own later spec):**
- The other five high-level commands (`score`/`prelude`/`perform`/`rehearsal`/`playback`).
- Multi-repo / DAG rollout, multiple parts, research, reviewable design docs, interactive
  gates, second-opinion cross-verify — all of these route to `score` + `perform` later.
- A generalized "turn engine" abstraction for `perform`. `core/turn.ts` and `core/gitwork.ts`
  are built **to solo's needs**, factored cleanly so `perform` *can* reuse them — but we do
  **not** speculatively generalize beyond what solo requires (YAGNI). `perform` extends them
  when it lands, with its own spec.

---

## 3. Decisions (settled in brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | **Finish stage** | **Branch-only by default; `--finish` opts into push + PR.** Preserves strike's autonomous capability behind a flag while defaulting to the safe, reviewable posture. |
| D2 | **Provider scope** | **Any provider, default `codex`.** `--provider agy\|opencode\|claude` overrides. codex stays the proven cross-model default (conductor is always Claude Code). The single part's instrument name is **auto-picked** (random available). |
| D3 | **Dirty target tree** | **Commit WIP (faithful).** A dirty working tree is committed as a WIP snapshot on the *current* branch before cutting `feat/solo-<topic>`, so nothing is lost and the branch diffs from a clean base. |
| D4 | **Orchestration** | **Directive-orchestrated (Approach A).** `commands/solo.md` runs the stages; CLI subcommands do mechanical steps; the conductor does every judgment step (brief, fix bundle, question reply) via the Write tool — the same split clone-wars uses. |

---

## 4. Command surface

**New `solo` subcommand family** (dispatched by `commands/solo.ts` on `rest[0]`; the existing
dispatcher in `src/consort.ts` gains one `solo` entry):

| Subcommand | Responsibility | rc |
|---|---|---|
| `solo init --args-file <p>` | parse topic text; extract `--provider`/`--finish`; derive slug; pick + validate provider; pick + record instrument; refuse if in-flight; scaffold `_solo/`; print slug | `0` ok · `1` bad-args · `2` in-flight · `3` no-provider |
| `solo branch <topic>` | assert target is git; snapshot start-branch + base SHA; **dirty → commit WIP**; create/resume `feat/solo-<topic>` | `0` · `1` not-git/error |
| `solo turn-send <topic> <n>` | compose round-`n` prompt (round 1: preamble + `task-brief.md`; round ≥2: preamble + `fix-prompt-<n>.md`); record `OFFSET=`; write inbox + nudge pane | `0` · `1` state error · `2` usage |
| `solo turn-wait <topic> <n>` | read `OFFSET`; `outboxWaitSince([done,error,question], timeout)`; append `TS=`; capture `question-<n>.txt` | **always `0`** |
| `solo detect-test <cwd>` | print the repo's test command (or empty); detection by file presence only, never executes | `0` |
| `solo finish <topic>` | remote → push + `gh pr create`; else keep branch; restore start-branch; record `finish-result.txt`; best-effort | `0` (best-effort) |
| `solo summary <topic> [--aborted <phase> <gate> <reason>]` | render `SUMMARY.md` (ok or aborted) + `RESUME.md` on abort | `0` |

**Reused foundation primitives:** `spawn` (build the part with `--cwd <target>`), `coda`
(teardown + archive), `send` (question replies, via `@file --from maestro`).

**New code:**
- `src/commands/solo.ts` — verb sub-dispatcher.
- `commands/solo.md` — the conductor directive (multi-stage; 3-step args-file fence for Stage 0).
- `src/core/solo.ts` — slug, paths (`soloArtDir`), provider/flag parsing, `detect-test`,
  `SUMMARY`/`RESUME` renderers (mirrors `lib/strike.sh`).
- `src/core/turn.ts` — `turnSend` (offset capture + prompt compose) and `turnWait`
  (classify `TS` via `outboxWaitSince`). Reusable by `perform`.
- `src/core/gitwork.ts` — pure arg-array builders + thin `execa` runners for snapshot /
  WIP-commit / branch / diff-stats / finish (push+PR vs keep) / restore. Reusable by `perform`.

---

## 5. The 4-stage pipeline

The conductor runs `commands/solo.md`. Judgment steps (Write tool) are **bold**.

### Stage 0 — Init + Brief
1. Conductor mints an args path (`solo --mint-args-file`), **Writes `$ARGUMENTS`** into it.
2. `solo init --args-file <p>`: pull `--provider`/`--finish` out of the glued `$ARGUMENTS`;
   derive slug (`tr` to lowercase, `[a-z0-9-]`, collapse dashes, cap 20, trim; empty → rc 1);
   pick provider (default `codex`; must be a `contracts.yaml` row **and** on PATH else rc 3);
   pick a random available instrument (via `pickRandomInstrument`); refuse if `_solo/` exists
   (rc 2); scaffold `<topic_dir>/_solo/{execute/}`; write `topic.txt`, `topic-text.txt`
   (cleaned), `selected-provider.txt`, `instrument.txt`, `timing.txt` (`started=`). Print slug.
3. Conductor reads `topic-text.txt`, **Writes `_solo/task-brief.md`** — exactly:
   `## Goal` (1–2 sentences) / `## Acceptance check` (a specific behavior, or "the repo's
   tests pass") / `## Touch-point hints` (only if obvious; else omit the heading).

### Stage 1 — Build
1. `solo branch <topic>`: read target cwd (the repo the slash command runs in); assert git;
   record `start-branch.txt` + `branch-base.sha`; **dirty → WIP commit on start branch**;
   create or resume `feat/solo-<topic>`; write `branch.txt`, `target_cwd.txt`, `provider.txt`.
2. `spawn <instrument> <provider> <topic> --cwd <target>` (mode = provider default `full`) —
   full bootstrap + ready-wait; FAILED archive on bootstrap failure (foundation behavior).
3. **Round 1:** `solo turn-send <topic> 1` (composes round-1 prompt: *plan → implement →
   **commit your work on this branch** → run the acceptance check → emit `done`*; records
   `OFFSET=`); then `solo turn-wait <topic> 1` **run in background** (`Bash run_in_background`).
4. On the completion notification, branch on `TS` (see §7).

### Stage 2 — Verify + finish
1. `solo detect-test <target>` → `TEST_CMD` (empty ⇒ `VERIFY=skipped (no test command detected)`).
2. Conductor runs `TEST_CMD` via Bash in `target_cwd` → `verify-1.log`; sets
   `VERIFY=PASS (cmd)` or `FAIL (cmd)`.
3. **If `FAIL`:** conductor reads `verify-1.log` tail, **Writes `execute/fix-prompt-2.md`**
   (concrete failures + fix direction); `solo turn-send <topic> 2`; `solo turn-wait <topic> 2`
   (background); re-run `TEST_CMD` → `verify-2.log`; set `VERIFY` to the **second** result.
   **One fix round only** — record and proceed regardless of the second outcome.
4. Record `diff-stats.txt` (`git diff --shortstat <base>..HEAD`), `branch.txt`, `verify-result.txt`.
5. **`--finish`:** `solo finish <topic>` (§8). **No `--finish`:** restore start-branch checkout;
   leave `feat/solo-<topic>` with the work.

### Stage 3 — Teardown + archive + SUMMARY
1. `coda <instrument> <topic>` — graceful FINE banner → teardown → archive part dir
   (record `archived-path.txt`).
2. Compute `ended`/`duration` into `timing.txt`; `solo summary <topic>` → `SUMMARY.md`; cat it.

---

## 6. State layout

`solo`'s **command** state is `_solo/` under the topic state dir — separate from the part's
**IPC** dir (`inbox.md`/`outbox.jsonl`/`pane.json`/`status.json` under `partDir`). All `_solo/`
writes use the foundation's `atomicWrite` (tmp-in-same-dir + rename).

```
<state-root>/state/<repo-hash>/<topic>/_solo/
├── topic.txt              # slug
├── topic-text.txt         # cleaned user input
├── selected-provider.txt  # codex | claude | agy | opencode
├── instrument.txt         # auto-picked instrument (the part's name)
├── timing.txt             # started= / ended= / duration=
├── task-brief.md          # conductor-authored brief
├── SUMMARY.md             # ALWAYS written
├── RESUME.md              # only on abort
├── archived-path.txt
└── execute/
    ├── target_cwd.txt  start-branch.txt  branch-base.sha  branch.txt  provider.txt
    ├── turn-prompt-1.md  turn-1.txt        # OFFSET=<n> then TS=ok|failed|question|timeout
    ├── question-1.txt                       # only if TS=question
    ├── fix-prompt-2.md   turn-2.txt         # only if verify FAILed
    ├── verify-1.log      verify-2.log
    ├── verify-result.txt diff-stats.txt
    └── finish-result.txt                    # only with --finish
```

The provider/model axis: consort's `spawn`/`partDir` name the model binary the "model";
`contracts.yaml` and the `--provider` flag are the same axis. `selected-provider.txt` holds
it; internal calls pass it as the `model` argument.

---

## 7. Turn machinery & offset discipline

`solo turn-send <topic> <n>` reads `outboxOffset(outboxPath(...))` — the part's `outbox.jsonl`
byte-size *before* the send — and stores it as `OFFSET=` in `turn-<n>.txt`. `solo turn-wait`
reads it back and calls `outboxWaitSince(instrument, model, topic, OFFSET, [...], timeout)`, so
round 2 can never match round 1's stale `done`. This reuses the foundation primitive already
hardened for argument-order precedence.

**`TS` classification** (`turn-wait` writes one of):
- `ok` — `done` event seen after `OFFSET`.
- `failed` — `error` event seen, OR (faithful to `deploy-turn-wait`) a terminal state without
  a usable result. For solo's single-turn model: `error` ⇒ `failed`.
- `question` — a `{event:"question",...}` seen; payload written to `question-<n>.txt`.
- `timeout` — none of `done|error|question` before the timeout.

**Branching** (conductor, gateless):

| `TS` | Action |
|---|---|
| `ok` | proceed |
| `question` | read `question-<n>.txt`; **Write best-judgment reply** (ends with frozen `END_OF_INSTRUCTION`); `send <instrument> <topic> @reply --from maestro`; **re-arm** `turn-wait` (background). Never asks the user. Re-arms on each question (no cap — faithful). |
| `failed` / `timeout` | **retry the turn once** (rm `turn-<n>.txt`, `turn-send`, re-arm). **Second** failure → clean abort. |

**Clean abort:** `solo summary <topic> --aborted <phase> <gate> <reason>` → `SUMMARY.md`
(`status: aborted`) + `RESUME.md`; `coda` teardown (best-effort); directive exits `0` (a
recorded outcome, not a crash).

Timeout for a solo turn defaults to **14400s (4h)** — a full implementation turn — matching
clone-wars' `CW_DEPLOY_TURN_TIMEOUT`; configurable via `CONSORT_SOLO_TURN_TIMEOUT`.

---

## 8. Finish stage (`--finish`)

`solo finish <topic>` (only called when `--finish` was passed):
1. Determine the auto action for the target: a remote exists → `pr`; else → `keep`.
2. `pr`: `git push -u origin feat/solo-<topic>` then `gh pr create` (title from topic; body =
   `task-brief.md` + verify result). `keep`: no remote action.
3. Restore the start-branch checkout.
4. Record `<action>\t<outcome>` to `finish-result.txt`.

All `git`/`gh` operations are **best-effort**: a failure is logged + recorded as the outcome
and never crashes the pipeline (faithful to `deploy-finish.sh … || true`). `gh` absence ⇒
outcome `pr-skipped (gh not installed)`.

Without `--finish`, Stage 2 simply restores the start-branch checkout; `feat/solo-<topic>`
retains the part's commits and `SUMMARY.md` documents how to review/finish manually.

---

## 9. Naming & rebrand compliance

- Command/state renames vs clone-wars: `strike` → `solo`; `_strike/` → `_solo/`;
  `feat/deploy-<topic>` → `feat/solo-<topic>`; worker `cody` → an auto-picked **instrument**;
  conductor sender → `maestro`; `cw_*` fn prefix dropped.
- **Frozen — never renamed:** event names `ready/ack/progress/done/error/question`; sentinel
  `END_OF_INSTRUCTION`; JSON fields `ts/summary/note/message/...`; `contracts.yaml` keys;
  `CLAUDE_CODE_SESSION_ID`; state filenames inherited from the foundation.
- The stale-token gate (`tests/stale-tokens.test.ts`) must stay green — scrub all borrowed
  `strike`/`cody`/`deploy`/`cw_`/`master-yoda`/`@cw_`/`MISSION ACCOMPLISHED` tokens from any
  text copied out of the clone-wars source. Fix the file, never weaken the gate.

---

## 10. Testing strategy

Foundation conventions: pure-logic unit tests; **no real subprocesses in unit tests**
(`tmux`/`git`/`gh`/`execa` are tested as arg-array builders — live behavior is the dogfood);
`CONSORT_HOME` = fresh temp dir per test (`tests/helpers/tmpHome.ts`).

- **`core/solo.ts`** — slug derivation (incl. empty → error), `--provider`/`--finish`
  extraction from glued args, `detect-test` precedence + empty, `SUMMARY`/`RESUME` renderers
  vs fixtures.
- **`core/turn.ts`** — `TS` classification from fixture outbox + offset, incl. the
  round-2-must-not-see-round-1-`done` case and `question-<n>.txt` capture.
- **`core/gitwork.ts`** — pure command-array builders + the finish decision (remote → push+PR
  vs keep) + dirty → WIP-commit decision. No real git.
- **`solo init`** — provider validation, in-flight refusal (rc 2), no-provider (rc 3), scaffold.
- **Stale-token gate** — borrowed text scrubbed.

**Quality gates:** `npm run typecheck`, `npm run lint`, `npm run test` green; then
`npm run build` and **commit the refreshed `dist/consort.cjs`**.

---

## 11. Acceptance criteria

1. All unit tests green; `tsc --noEmit` + eslint + stale-token gate clean; `dist/consort.cjs`
   rebuilt and in sync.
2. **Live dogfood** (the gate) under isolated `CONSORT_HOME`: a real `/consort:solo` against a
   throwaway single-repo change with a live **codex** part in tmux, proving
   **brief → branch (incl. dirty→WIP) → build (single turn) → verify → teardown**, plus one run
   exercising `--finish` (push + PR to a throwaway remote). Result + any bugs appended to
   `docs/superpowers/DOGFOOD.md` as a `solo` section.
3. No frozen protocol term renamed; no stale clone-wars token shipped.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Provider directory-trust prompt (e.g. codex per-repo trust) blocks spawn | Surfaced as an environment prerequisite (foundation dogfood already documented this); soundcheck/spawn fail loud with the pane tail; the user trusts the dir. Not a solo defect. |
| WIP-commit surprises the user | Documented in `SUMMARY.md`; the commit is on the user's own branch and fully recoverable; this was the explicit D3 choice. |
| `core/turn.ts`/`gitwork.ts` over-generalized for an unbuilt `perform` | Built strictly to solo's needs (YAGNI); `perform` extends them under its own spec. |
| Question-reply loop never terminates | Faithful to strike (no cap); the turn timeout still bounds each individual wait, and a `failed`/`timeout` path aborts cleanly. |
| Borrowed clone-wars text leaks a stale token | Stale-token gate runs at close-out (caught a `colors.ts` comment leak in the foundation); fix the file. |

---

## 13. Implementation phasing (for writing-plans)

1. **`core/solo.ts`** (pure: slug, paths, flag parse, detect-test, renderers) + tests.
2. **`core/gitwork.ts`** (builders + decisions) + tests; thin execa runners.
3. **`core/turn.ts`** (turnSend offset/compose, turnWait classify) + tests.
4. **`solo` subcommands** (`init`/`branch`/`turn-send`/`turn-wait`/`detect-test`/`finish`/
   `summary`) wired through `commands/solo.ts` + dispatcher entry + tests.
5. **`commands/solo.md`** directive (the 4-stage choreography).
6. **Build + adversarial verification** vs clone-wars `strike`/`deploy` spec; **live dogfood**;
   `DOGFOOD.md`.
