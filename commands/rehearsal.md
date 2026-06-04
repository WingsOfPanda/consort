---
description: Advisor-driven autoresearch — lock a measurable metric, sweep SOTA, spawn 2-3 persistent codex parts, and adaptively dispatch experiments until a target/plateau/budget stop. Explore-only; promotion to real code is /consort:perform.
argument-hint: <objective-text> [--metric k=v,...] [--time-budget none|<N>h|<N>s] [--slug s] [--seed-from path]
allowed-tools: Bash, Write, Read, Edit, AskUserQuestion, WebSearch, Skill
---

# /consort:rehearsal

Run an executable research session: you (the Maestro, the conductor) lock a metric with the user, sweep
the SOTA, spawn 2-3 persistent **codex parts** (PhD-student executors) once, then adaptively dispatch
single-config **experiments** until a stop condition fires. **Explore-only** — never touch the user's real
source. This directive covers Phases 0-4 (setup + spawn + the adaptive experiment loop) plus the wind-down
(Phases 5-7: synthesis + teardown + handoff), now shipped.

> **DANGER — read first.** Spawns codex **parts** under
> `--dangerously-bypass-approvals-and-sandbox`; parts write + execute arbitrary
> code in your repo. Sandboxing is **honor-system** (parts are told to stay inside
> their branch dir; not enforced). Net access is **permitted by default**. Do not
> run on machines with sensitive credentials, production data, or shared state.
> Use a scratch worktree if uncertain.

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

## Flagging suspicions

At any point in the run, if something looks weird, surprising, or suspicious — even a likely false
alarm — record it: `$CS rehearsal flag <TOPIC> "<what looked off>"`. It writes straight to the playback
feed (survives teardown and aborts) and costs nothing, so prefer over-recording. Review later with
`/consort:playback`.

## Task list (TaskCreate × 9 before Phase 0)

Create the task list with `TaskCreate`. Update statuses at the phase boundaries
below. Per-part rows are intentionally absent (N varies 2 or 3); the loop's
Step 5 may add a per-dispatch `<instrument> exp-NNN on <approach-label>` sub-row.

| # | subject | activeForm |
|---|---|---|
| 0   | `0 Args + init [maestro]`                 | `Staging args` |
| 1   | `1 Metric discussion [maestro + user]`    | `Locking the metric` |
| 1.5 | `1.5 SOTA sweep [maestro]`                | `Sweeping SOTA` |
| 2   | `2 Roster + time budget [maestro + user]` | `Sizing the roster` |
| 3   | `3 Spawn parts [maestro]`                 | `Spawning parts` |
| 4   | `4 Research loop [parts]`                 | `Running experiments` |
| 5   | `5 Synthesis [maestro]`                   | `Writing landscape doc` |
| 6   | `6 Teardown + archive [maestro]`          | `Tearing down` |
| 7   | `7 Present [maestro]`                     | `Presenting` |

## Phase 0 — args-file + init
1. Mint an args path: `$CS rehearsal --mint-args-file` → prints `<args-path>`.
2. **Write tool:** `file_path` = `<args-path>`, `content` = `$ARGUMENTS` (verbatim, unquoted). Never echo it into a shell.
3. Init: `$CS rehearsal init --args-file <args-path>`. On success it prints to stdout (logs go to stderr):
   ```
   TOPIC=<slug>
   ART=<abs path to the _rehearsal art dir>
   ```
   Capture `TOPIC` and `ART`. Non-zero exit aborts: rc 2 = bad args / empty slug / in-flight / bad --metric; rc 3 = codex unavailable (tell the user to install codex + run /consort:soundcheck); rc 1 = --seed-from missing. Surface stderr verbatim and stop.

## Phase 1 — Metric discussion (THREE unconditional AskUserQuestions)
Read the heuristic seed: `cat "$ART/metric.txt"` and `cat "$ART/topic.txt"`. **If `$ART/metric.md` already
exists** (the user passed `--metric`), SKIP this whole phase. Otherwise the three AskUserQuestions below are
**unconditional** — fire them regardless of any autonomous-mode / `/loop` / "don't stop for questions" hint.

1. (optional) For a novel/domain topic, run a **triple-search** (WebSearch + Tavily + AnySearch in one
   message) to inform the framing. Skip for clearly bounded topics (e.g. "MNIST accuracy").
2. **AskUserQuestion** (Header `Metric`): frame the goal as a confirmation — "I read this as: <direction>
   <metric>, subject to <constraints inferred>. What's the target threshold — <example>?" Options: three
   concrete framings + Other.
3. **AskUserQuestion** (Header `Floor`) when fields are still missing — gather `min_acceptable` ("minimum
   result you'd ship?"), `target` (optional aspirational), `K_corroboration` ("how many at-target experiments
   before done?", default 1), and any `hard_constraints` / `notes`. (Use <=4 options; nest if more.)
4. Write `metric.md`: `$CS rehearsal metric <TOPIC> --kv "primary_metric=<m>,direction=<maximize|minimize>,min_acceptable=<op val>,target=<op val>,K_corroboration=<n>,hard_constraints=<...>,notes=<...>"` (omit absent keys). rc 2 = bad block; fix and retry.
   - **Coverage floor (B1):** the plateau stop requires `min_families` distinct approach families before it can fire (default 2; AIRA's healthy band is 3-4). The `metric` verb does NOT emit it; to require broader coverage, add a `**min_families:** N` line to `metric.md` with the Write tool after the verb runs (parse-only, like `verify_epsilon`/`ceiling`/`max_debug_attempts`).
5. **AskUserQuestion** (Header `Confirm`): "Here's how I'll frame the goal — OK to proceed?" Options:
   **Looks good** / **Revise** / **Cancel**. Revise → re-run step 4. **Cancel → teardown + exit.**

## Phase 1.5 — SOTA sweep (always runs, write-once)
Read `primary_metric` + `hard_constraints` from `$ART/metric.md`. Fire ONE **triple-search** round
(WebSearch + Tavily + AnySearch, two query shapes each: `SOTA <metric> <topic>` and (only when
`metric.md` has a `hard_constraints` value) `<topic> under <constraint>`). Merge (dedup by URL), curate <=7 references — one row per approach family. Write:
`$CS rehearsal sota <TOPIC> --kv "topic=<topic text>,metric=<primary>,sweep_date=<UTC ISO>,queries=<the queries you fired>,ref_1=<family>|<best>|<fits or over by N>|<url>|<note>,ref_2=..."`. Zero usable refs → omit all `ref_N` (the helper emits the fallback note).

#### Security note

Web access in this phase relies on the Maestro's `WebSearch` / Tavily / AnySearch
tool availability and on part-side net access (permitted-by-default, honor-system —
not enforced). For a hard block, restrict at OS / firewall / network-namespace level
before invoking `/consort:rehearsal`; the command exposes no opt-out flag.

## Phase 2 — Roster size + time budget
1. **Pick N silently** (your call, explain in chat): **N=2** (default — single objective + tight
   constraint) or **N=3** (multiple sub-goals / broad survey / no clear single optimum). When unsure → 2.
   Bias toward different pipelines per part; record the rationale for round 1's `session-summary.md`.
2. **If `$ART/time-budget.txt` already exists** (`--time-budget` passed), skip. Otherwise **AskUserQuestion**
   (Header `Time budget`, unconditional): "Time limit on this research session?" Options: **No limit
   (recommended)** / **4 hours** / **12 hours** / **Other (custom hours)**. Do NOT auto-pick. Then write:
   ```bash
   printf '%s\n' "<none|14400|43200|<hours*3600>>" > "$ART/time-budget.txt"
   date -u +%Y-%m-%dT%H:%M:%SZ > "$ART/session-start.txt"
   ```

## Phase 3 — Batch-spawn persistent codex parts
Spawn N parts in one call: `$CS rehearsal spawn-all <TOPIC> <N>`. It picks N distinct instruments, allocates
panes off your pane (main-vertical), batch-spawns them as codex, and writes `$ART/spawn-results.tsv` +
`$ART/parts.txt`. Branch on rc:
- **rc 0** → all parts ready. Continue (Phase 4 lands next).
- **rc 3 (preflight/setup), first failure** → teardown the partial set and retry `spawn-all` ONCE
  (cold-start tolerance).
- **rc 3, after retry** → preflight is unrecoverable: teardown + archive + exit. Do **NOT** show a
  degraded prompt (a pane-allocation failure that survives a retry will not be fixed by dropping parts).
- **rc 1 or 2 (spawn-class), first failure** → teardown the partial set and retry `spawn-all` ONCE.
- **rc 1 or 2, after retry** → read the FRESH `$ART/spawn-results.tsv` (`spawn-all` clears any stale one
  at start). If **< 2** parts have rc 0, abort (teardown + archive). Else **AskUserQuestion**: **Proceed
  degraded (<k>/<N>)** / **Abort**. On **Proceed degraded**, for EACH instrument whose `spawn-results.tsv`
  row has rc ≠ 0, run `$CS rehearsal drop-part <TOPIC> <instrument>` (prunes its `parts.txt` row and kills
  its preflight pane) **before** Phase 4, so Phase 4 seeds state + a Monitor only for live parts.

## Phase 4 — Initial dispatch (runs ONCE, before the loop)

After a successful `spawn-all`, set up per-part liveness + seed direction, then dispatch the first
round. This phase runs **once**; its last step ENTERS THE LOOP (do NOT end the turn).

1. **Seed per-part state.** `$ART/parts.txt` already exists (one instrument per line, from `spawn-all`).
   For **each** instrument in `$ART/parts.txt`, create its experiments dir and write its initial
   `state.txt` — one small `printf` per part:
   ```bash
   while IFS= read -r INST; do
     [ -n "$INST" ] || continue
     mkdir -p "$ART/parts/$INST/experiments"
     printf 'exp_counter=0\nphase=idle\ncurrent_exp_id=\nlast_event=spawn\n' > "$ART/parts/$INST/state.txt"
   done < "$ART/parts.txt"
   ```
   The `phase` vocabulary (set throughout the loop): `idle` (between experiments — eligible for
   dispatch) | `working` (executing) | `stale` / `stuck` (Monitor liveness escalation) | `blocked`
   (emitted a `question` — awaiting user) | `failed` (errored, manual recovery) | `complete` /
   `incomplete` (terminal) | `abandoned` (Maestro retired the lane via Lane-D; dispatch refuses with rc 2).

2. **Start one persistent Monitor task per part.** Use the **Monitor TOOL** (NOT a Bash call) once per
   instrument, with config:
   - `command`: `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs rehearsal monitor <TOPIC> <instrument>`
   - `persistent`: `true`
   - `description`: `rehearsal monitor for <instrument>`

   Each task watches that part's outbox for `done`/`error`/`question`/`heartbeat` events AND emits
   `stale`/`stuck` when the outbox mtime exceeds the probe/stuck thresholds. Capture each returned task
   ID and append it to `$ART/monitor-tasks.txt`, one per line (Step 2 of the loop `TaskStop`s every ID
   from this file at the hard cap).

3. **Write the initial `session-summary.md`.** Compose `$ART/session-summary.md` (a mechanical
   roster/metric header — roster instruments, the metric block, time budget) and append a
   `## Current direction` section (1-3 sentence opening strategy note, incl. the diversity rationale
   from Phase 2) plus a `## Recent decisions` section (placeholder bullets, filled on first dispatch).
   Use the Write tool (atomic single-shot).

4. **First dispatch round — PARALLEL, one Bash call per part in ONE message.** For each instrument,
   compose a 1-2 sentence opening direction informed by `$ART/topic.txt`, `$ART/metric.md`, and
   `$ART/seed-from.txt` (if present), then dispatch:
   ```bash
   $CS rehearsal experiment-send <TOPIC> <instrument> exp-001 "<approach-label>" "<direction>"
   ```
   **Diversity:** assign a different pipeline / approach family per part (e.g. single-pass / typed-routing
   / hybrid) — identical pipelines produce no triangulation signal. (B1 now backs this mechanically — see
   the `Coverage:` line in the status brief and the `min_families` plateau gate.) The verb creates
   `parts/<instrument>/experiments/exp-001/`, writes `prompt.md` from the experiment template, writes the
   inbox, sets `phase=working, current_exp_id=exp-001, exp_counter=1`, and nudges the pane.

5. **Render the initial status brief:** `$CS rehearsal status-brief <TOPIC>` (no `--latest-*` flags on
   the first render — approach labels come from each part's freshly-written `prompt.md`, metric shows
   `(running)`, scoreboard says `_(scoreboard absent)_`). **Print its stdout verbatim** to chat.

6. **ENTER THE LOOP.** Do NOT end the turn — fall straight into the inline loop below.

## The inline loop (Steps 1-8 — repeat until Step 2 or Step 4 stops)

You are the Maestro mid-session. Unlike the bash predecessor (which ended the turn at Step 8 and waited
for a hook to re-enter), consort runs this loop **inline** — the same idiom `score`/`perform` use for
their wait barriers, but **UNBOUNDED**. **Step 8 is the LOOP TAIL → go to Step 1; it is NOT a turn end.**
The loop BLOCKS in-process for the next part-completion notification (the persistent Monitor tasks surface
`done`/`error`/`question`/`heartbeat`/`stale`/`stuck`), then continues.

### Step 1 — Read state baseline
Read (capped): `$ART/scoreboard.md`, each part's `$ART/parts/<instrument>/state.txt`, the existence of
`$ART/halt.flag`, and `$ART/time-budget.txt` + `$ART/session-start.txt` (for the elapsed-time check).
Then **block on the next part `done`/`error`/`question` notification** — a Monitor task fires it (a
`stale`/`stuck`/`heartbeat` notification also wakes the loop; route it in Step 3 and keep going). When a
notification arrives, continue to Step 2 with it queued.

### Step 2 — Hard-cap check
IF `$ART/halt.flag` exists OR the time budget has elapsed (`now - session-start >= time-budget`, unless
the budget is `none`):
1. `$CS rehearsal score <TOPIC>` — write the final scoreboard.
2. `$CS rehearsal finalize <TOPIC>` — reconcile + normalize + final session-summary (`## Halt`).
3. **`TaskStop` every task ID in `$ART/monitor-tasks.txt`** (the `TaskStop` tool is a harness primitive,
   one call per ID; idempotent).
4. Proceed to Phase 5 → 6 → 6b → 6c → 7 below. **EXIT THE LOOP** (this is a real stop).

### Step 3 — Process the queued notification(s)
Initialize `RAN_SCORE=0`, `LAST_INSTRUMENT=`, `LAST_EXP=`. Route each queued notification by event type:
- **`done` / `error`** → `$CS rehearsal score <TOPIC>` (re-scores every part, sets each scored part's
  `phase=idle`). On rc 0 set `RAN_SCORE=1` and record `LAST_INSTRUMENT=<instrument>` / `LAST_EXP=<exp-id>`
  from the event JSON (`part` field + the `summary`-derived `exp-NNN`). If the event's part has a
  non-empty `probe_sent_ts` in its `state.txt`, clear it (the part recovered — the pending probe is stale).
- **`question`** → surface the part's question to the user in chat; set that part's `phase=blocked`. Do
  **NOT** auto-dispatch it — wait for user direction.
- **`stale`** → send a probe: `$CS send --from maestro <instrument> <TOPIC> "status? brief update on the
  current experiment please"`; set that part's `phase=stale, probe_sent_ts=<now UTC ISO>`. **Debounce:**
  skip the probe if `probe_sent_ts` was already set within the stuck window.
- **`stuck`** → Maestro judgment: either **abort** the pane (Ctrl-C via tmux, set `phase=failed`) OR
  **extend** (clear `probe_sent_ts` to give more time).
- **`heartbeat`** → bump that part's `last_event_ts`; if `probe_sent_ts` is set, clear it (the part is
  responsive — the pending probe is no longer relevant). No further action.

Then, **IF `RAN_SCORE`**: `$CS rehearsal status-brief <TOPIC> --latest-instrument <LAST_INSTRUMENT>
--latest-exp <LAST_EXP>` and **print its stdout verbatim** — exactly **ONCE per loop iteration**, even if
multiple `done` events queued (score per event, but render the brief once with the LAST values). Skip the
brief entirely when `RAN_SCORE=0` (only heartbeat/question/stale/stuck fired — no new scored state).

   Scoreboard groups: integer ranks (`1,2,3...`) are the VALID leader set -- steer ONLY on these;
   `x<rank>` rows are INFEASIBLE (ran but invalid -- excluded from leader/completion/Lane-D);
   `~<rank>`/`<rank>` rows are partial/fail.

   Coverage (B1): the `**Coverage:** N families [fam×count, ...]; min_families=M (met|short by K)`
   line shows how many distinct approach families have landed ok results. `(short by K)` means
   exploration is still narrow (fewer than `min_families` families) -- a signal to open a new family
   on the next dispatch rather than tune the current leader.

3.5. **Verify the landed result (metric-trust gate).** After `score`/`status-brief`, for the
     experiment that just landed (`<instrument>`/`<exp>`):

     a. `$CS rehearsal verify-plan <TOPIC> <instrument> <exp>` (add `--authorize-rerun` ONLY
        when this result is a new leader or would change your next-round direction — a `rerun`
        is costly).
     b. If it printed `RUN_CMD=...`: run that command yourself via Bash, in the printed
        `RUN_CWD`, with a timeout, teeing stdout to a temp file `<exp-dir>/verify-stdout.log`.
     c. `$CS rehearsal verify-check <TOPIC> <instrument> <exp> --stdout-file <exp-dir>/verify-stdout.log`
        (or `--run-failed` if the command errored / produced no `VERIFY_METRIC=` marker).
     d. The verdict now annotates the next `status-brief` top-3 (`verified` / `mismatch!` /
        `unavailable` / `pending`). Treat a `mismatch` as a result you do NOT yet trust — note it
        in `## Recent decisions`; acting on it (re-dispatch) is point f below, and never steer the
        whole roster toward a `mismatch` leader.
     e. `status-brief` also tags suspect results `[suspect: <flags>]` (ceiling-exceeded /
        under-run / log-contradiction / integrity-attestation-incomplete / audit-knob-drift).
        A `[suspect]` result is one whose number may be an artifact (leakage / didn't really run /
        misconfigured knob) — do NOT crown a `[suspect]` leader; note it in `## Recent decisions`.
        Acting on it (re-dispatch / discard) is point f below.
     f. **A2 -- act on INFEASIBLE.** A result is INFEASIBLE when its verify verdict is `mismatch` OR it
        carries an A3 `under-run` / `log-contradiction` / `audit-knob-drift` flag. The score pass routes
        infeasible results to the scoreboard `x<rank>` group (out of the ranked leader set -- they are
        NOT a refuted idea and never the leader). When the just-landed experiment is INFEASIBLE and this
        idea has been attempted fewer than `max_debug_attempts` times (metric.md, default 2),
        RE-DISPATCH the same idea with the failure feedback in the approach-brief (e.g. "previous attempt
        was INFEASIBLE: `audit-knob-drift mcts_sims=16 vs 200` -- set 200 and re-run"). If the cap is hit,
        record the idea INFEASIBLE-final in `## Recent decisions` ("couldn't be validly executed", NOT
        refuted) and let the part move to a new idea. A REFUTED result (feasible `ok`, genuinely low)
        steers normally -- it is real evidence the idea is weak.

### Step 4 — Completion check + DECISION POLICY
The `status-brief` you just printed already shows the `**Completion check:**` line (computed by the same
core the CLI uses: `floor_met` / `target_met` / `K_so_far` / `K_required` / `plateau`). Apply the FROZEN
decision policy below. If the decision is **STOP**, write `$ART/halt.flag` as a structured `key=value`
file (one entry per line) — required keys `halted_by=maestro`, `halted_at=<UTC ISO>`, `reason=<one line>`,
plus optional `target_met` / `floor_met` / `k_so_far` / `k_required` / `plateau` / `plateau_observed_n` /
`final_leader` / `final_leader_metric` / `architectures_corroborated` — then **jump to Step 2**.

```
Decision policy (apply at Step 4):
  Hard rules (no judgment):
  - floor_met=no AND no hard cap -> keep going.
  - hard_cap=yes OR halt.flag present -> stop (go to Step 2).
  Soft rules (Maestro judgment, default-stop, override allowed):
  - All of floor + target + K satisfied -> default stop. Override if variance looks
    suspicious or the user asked to keep exploring.
  - Floor met + plateau detected + target not met -> default stop. Override to pivot
    direction or request user input.
  - NOTE (B1): `plateau` is approach-aware -- it will NOT fire while fewer than `min_families`
    distinct families have landed ok results, or while any family is still improving. A reported
    plateau therefore already means "breadth reached and every explored family has stalled."
  If decision = stop, touch halt.flag with reason text, then jump to Step 2.

NEVER STOP the loop at Step 5. If at least one part has phase=idle and no halt.flag exists,
dispatch the next experiment -- do not pause to ask "should I continue?" or "is this a good
stopping point?". Stop conditions are owned by Step 2 (halt.flag / time budget) and Step 4
(completion check). If results look thin: rotate the approach mix, escalate via a question,
or document the concern in session-summary.md Recent decisions -- and dispatch.

Lane-D abandon (per part, at Step 5 -- ALL THREE must hold):
  1. >= 3 completed (status=ok) experiments for this part;
  2. NONE of this part's LAST 3 experiments scored >= min_acceptable;
     (count only FEASIBLE experiments -- the integer-ranked scoreboard rows; an INFEASIBLE run in the
     `x<rank>` group is NOT Lane-D evidence, because it was botched, not a weak idea.)
  3. this part's best metric >= 5 x plateau_threshold BELOW the current overall leader.
  -> transition phase=abandoned + lane_abandon_reason + lane_abandon_ts; skip dispatch;
     surface in chat. (experiment-send refuses an abandoned lane with rc 2.)
```

**Optional — consensus for asymmetric framing (advisory, §6).** When the soft-stop rules are close and the parts
disagree, run `$CS rehearsal consensus <TOPIC>` → writes `$ART/consensus.md` (advisory; gates nothing). Its
`## Contested` section shows where the parts' latest-ok `result.json` fields diverge; read it to frame the next
direction or a clarifying user question. On-demand only — never auto-run by `score` / `finalize` / the loop.

### Step 5 — Dispatch round
For **each** part with `phase=idle` and no `$ART/halt.flag`:
1. **Lane-D abandon check FIRST** (the frozen block above — all three criteria must hold). When all hold,
   write that part's `state.txt` to `phase=abandoned` + `lane_abandon_reason=<short reason>` +
   `lane_abandon_ts=<UTC ISO>`, skip dispatch for it, and surface the retirement in chat ("`<instrument>`
   lane retired: …"). The `phase=idle` filter then excludes it from all future rounds.
2. **Otherwise dispatch.** Compose a ~50-token direction ("direction, not plan") from
   `$ART/session-summary.md` (Current direction + Recent decisions), the recent `$ART/scoreboard.md` rows,
   and the topic/metric.
   **Coverage steering (B1):** when the `Coverage:` line is `(short by K)` or one family dominates the
   tally, open a NEW approach family this dispatch (give it a fresh `<approach-label>`) rather than
   tuning the current leader -- aim for at least `min_families` distinct families (AIRA: <=2 = collapse
   risk, 3-4 = healthy). You may align the label to one of the SOTA sweep's families.
   Read `exp_counter` from the part's `state.txt`, increment, format `exp-NNN`, then:
   ```bash
   $CS rehearsal experiment-send <TOPIC> <instrument> exp-NNN "<approach-label>" "<direction>"
   ```
   The verb increments `exp_counter`, sets `phase=working, current_exp_id=exp-NNN`, and nudges the pane.

**NEVER STOP the loop here** — see the frozen NEVER-STOP banner in Step 4. Stop conditions are owned by
Step 2 and Step 4 only.

### Step 6 — Handle a user message
If this iteration was triggered by a user message (not solely a notification):
- **Halt intent** ("stop", "halt", "we're done", "call it") → write `$ART/halt.flag` with
  `halted_by=user`, `halted_at=<UTC ISO>`, `reason=user-halted via slash directive`; **jump to Step 2**.
- **Direction-change intent** ("focus on Y for `<instrument>`", "stop exploring X") → record it in
  `session-summary.md`'s Recent decisions section; factor it into the next Step 5 direction.
- **Extension intent** ("extend by 2 hours") → add the seconds to `$ART/time-budget.txt` and refresh
  `$ART/session-start.txt` (`date -u +%Y-%m-%dT%H:%M:%SZ`).
- **Negated halt** ("don't stop") → ignore (no halt).
- **Uncertain** → ask "Halt now? (yes/no)".

An out-of-band `$ART/halt.flag` (e.g. written by another process) is also caught by Step 2 on the next
iteration.

### Step 7 — Re-render `session-summary.md`
Re-compose `$ART/session-summary.md`: the mechanical sections (Status, Scoreboard top 5, Completion check,
Recent events) plus a filled `## Current direction` (1-3 sentence strategy note) and `## Recent decisions`
(the last ~5 dispatches, one-line rationale each). Write tool, atomic single-shot.

### Step 8 — LOOP TAIL
**Go to Step 1. Do NOT end the turn.** The loop continues blocking on the next notification and repeats
Steps 1-8 until Step 2 (halt.flag / time budget) or Step 4 (completion-check stop) exits it.

## Phase 5 — Synthesis (landscape doc)

The loop has exited via Step 2 (`score` + `finalize` already ran). As Maestro, **Write** the landscape
doc `$ART/rehearsal-<date>-<slug>.md` (`<date>` = UTC `YYYY-MM-DD`, `<slug>` = `$TOPIC`) with the Write
tool — atomic single-shot — drawing on `$ART/session-summary.md` (the rolling continuity record + Recent
decisions) and the final `$ART/scoreboard.md`. Each section below is REQUIRED.

H1: `# Rehearsal: <slug-titled>` (the slug, title-cased). Then the header lines, each on its own line:

```markdown
**Generated:** <ISO-8601 UTC>
**Topic:** <verbatim from $ART/topic.txt>

**Metric block:**

<verbatim $ART/metric.md body>

**Roster:** <comma-separated instrument names from $ART/parts.txt>
**Time budget:** <none | N hours, from $ART/time-budget.txt>
**Outcome:** stopped-by-user | converged-by-judgment | time-budget-exhausted
```

Then the sections, IN ORDER:

- `## Experiment log` — a table `| Exp | Instrument | Approach | Metric | Status | Runtime |`, one row per
  experiment in chronological order (walk each part's `experiments/` dirs, lex-sorted).
- `## Winner` — names `exp-NNN (instrument <instrument>)`, then `Approach:` (label), `Metric:` (value),
  `Code path:` (`parts/<instrument>/experiments/<exp>/code/` — the absolute archive path is baked in at
  Phase 6), `Runtime:`, and `Notes:` verbatim from that experiment's `result.json`.
- `## Why we stopped` — one paragraph in Maestro's voice, citing the relevant `exp-NNN` rows from the
  scoreboard.
- `## Branches preserved` — note that all dirs under each part's `parts/<instrument>/experiments/` are
  kept in the archive (each holds `code/`, `result.json`, `stdout.log`, `stderr.log`, `prompt.md`).
- `## Suggested next` —
  **Step 1** — `/consort:score <abs-art-dir>/score-handoff.md` (produce a deploy-schema design doc).
  **Step 2** — `/consort:perform <abs path to score's design-doc>` (implement it).
  (Skip Step 1 ONLY if the winner is drop-in trivial; the `score-handoff.md` lists carry-forward
  constraints and open questions `score` should answer first.)

## Phase 6 — Teardown + archive

1. **`TaskStop` every task ID** in `$ART/monitor-tasks.txt` (harness tool, one call per ID; idempotent —
   `finalize` already ran at the loop exit, so the monitors may already be down).
2. **Forensics + reflection (best-effort).** `$CS rehearsal forensics <TOPIC>`. If it printed a path, use
   the **Edit tool** to APPEND a `## Maestro reflection` section to that file — 3-5 short bullets
   interpreting the mechanical findings — BEFORE the teardown below moves the art dir.
3. **Pane teardown.** `$CS coda --pairs <TOPIC> <instruments from $ART/parts.txt>` — one 9s graceful
   **FINE** banner across all panes (not N × 9s).
4. **Archive.** `$CS rehearsal teardown <TOPIC>` — capture its stdout as `ARCHIVED_ART`; verify it is a
   real directory. **Rebind `$ART = ARCHIVED_ART`** for Phases 6b/6c (the teardown `mv` moved
   `_rehearsal` into the archive, preserving every `parts/<instrument>/` subtree plus `session-summary.md`,
   `monitor-tasks.txt`, and the final scoreboard).
5. **Bake absolute paths.** **Read** the landscape doc inside the archive, then **Edit** it to make the
   `## Suggested next` paths absolute (the `score-handoff.md` location + the `parts/<instrument>/.../code/`
   winner path), now that `$ART` is the archive location.

## Phase 6b — Extract handoff data

`$CS rehearsal handoff-extract "$ART"` — pass the **rebound archived art-dir** as the positional (this verb
takes the art-dir path, NOT a topic; per-experiment `result.json` is resolved relative to it). It writes
`$ART/handoff-data.kv` (mechanical fields: `mode`, `topic`, `landscape_doc`, `winner_instrument`,
`winner_exp`, `winner_approach`, `winner_metric`, `winner_checkpoint`, `winner_notes`, `winner_code_dir`,
`runner_up_1..3`, `mandates_block_path`, `session_path`, `topic_txt_path`, `generated_ts`). A non-zero rc
means required inputs were missing — note it and **SKIP Phase 6c** (warn, do not crash).

## Phase 6c — Compose score-handoff.md

Read `$ART/handoff-data.kv` (mechanical facts) AND the landscape doc (identified by `landscape_doc=`). As
Maestro, **Write** `$ART/score-handoff.md` with the Write tool. Begin with a `# <topic>` H1, then a
`Source: <landscape doc path>` line and a `Generated: <UTC ISO>` line, then six sections IN ORDER:

- `## Recommendation` — 1-3 paragraphs of English prose (no bullets). Names the winner. States what to
  plan for. Past tense for evidence, active voice.
- `## Recipe` — prescriptive distillation (technique to adopt, decisive design choices, key
  hyperparameters, named techniques). Cite code paths as `$ART/<winner_code_dir>` (see Appendix); do NOT
  inline code. **OMIT this whole section** when there is no winner.
- `## Constraints (carry-forward)` — inline the Hard-constraints block from `metric.md` (at
  `$ART/<mandates_block_path>`) verbatim; append any numeric guards / at-risk violations from
  `winner_notes`.
- `## Open questions` — **CONDITIONAL.** Emit ONLY when research surfaced unresolved planning decisions
  that `score`'s drilldown will not naturally close (inspect the landscape doc + `winner_notes`). If
  research closed everything, **OMIT the WHOLE section** — no header, no `_(none)_` stub.
- `## Evidence` — a table `| Rank | Instrument/Exp | Metric | Approach | Status |` (winner + runner-ups
  from the KV), then a one-line `Winner emergence:` (rounds run, key delta vs the top runner-up, stop
  reason if known from the landscape doc).
- `## Appendix: artifacts` — **ALL ABSOLUTE PATHS.** Interpolate each KV value as `$ART/<value>` (where
  `$ART` is the rebound archive dir). Do NOT prefix, transform, or rewrite paths. If a KV value already
  starts with `/` (e.g. `winner_checkpoint` may be absolute via the leading-slash guard), emit it
  verbatim WITHOUT prepending `$ART`.

**No-winner branch** (`mode=rehearsal-no-winner` in `handoff-data.kv`): `## Recommendation` reads "No
deployable winner. Research ended without a `status=ok` row in the scoreboard — see Evidence for what was
tried and why each attempt fell short." **OMIT `## Recipe`** entirely. `## Open questions` MAY still be
emitted (conditional, as above) if planning decisions remain. `## Evidence` shows the partial/fail
rows with their failure modes.

## Phase 7 — Present

Show the user:
- The path to the archived landscape doc (`$ART/rehearsal-<date>-<slug>.md`).
- The path to the winning experiment's `code/` directory.
- The `## Suggested next` line VERBATIM.
- A one-line outcome summary: outcome + best-metric + delta vs the FIRST experiment.

## Intervention patterns

If you observe a part hanging, producing a garbage `result.json`, or exceeding cost
without a `cost_blown` status, you can send a clarifying prompt mid-loop via
`$CS send --from maestro <instrument> <TOPIC> "<prompt>"`. Part panes remain
attached; the Maestro regains control between every sub-step.

## Budget overrides

`CONSORT_REHEARSAL_EXPERIMENT_TIMEOUT_OVERRIDE` (positive integer seconds) overrides the per-experiment
wall-clock cap that `experiment-send` embeds in the part's prompt. Precedence: the `--timeout` flag >
this env var > the `contracts.yaml` `experiment` default (1800s).
