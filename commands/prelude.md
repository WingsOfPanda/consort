---
description: Deep multi-aspect exploration — SOTA surveys, multi-angle thinking, adversary-tested landscape doc that feeds /consort:score
argument-hint: <topic>
allowed-tools: Bash, Write, Read, Edit, AskUserQuestion, WebSearch, WebFetch, Skill
---

# /consort:prelude

Deep multi-aspect exploration of `$ARGUMENTS`. The Maestro orchestrates an N-part research
pass — classifying the topic up front to tell each part how much to weight academic-paper
retrieval — synthesizes a preliminary landscape doc, runs a 5-signal confidence gate, dispatches
all N parts as adversaries against the synthesis if the gate doesn't let the user skip, then writes
a final landscape doc with a tradeoff matrix + adversary critiques + a directional Conclusion. The
Conclusion is the hand-off seed for `/consort:score`, emitted as `score-handoff.md`. **The Maestro
itself never runs retrieval — parts are the only retrievers.** The intended workflow is
`prelude → score → perform`.

**When to use this command.** Invoke `/consort:prelude` when the user wants to explore SOTA,
think deeply, survey a landscape, or research a hard topic from multiple angles WITHOUT committing
to a buildable plan — "explore SOTA …", "find new architectures for …", "deep think about …",
"survey the landscape of …". Phrases that route to `/consort:score` instead (they need a buildable
spec): "design X", "build X", "compare A vs B to decide", "should we adopt …". The line is fuzzy;
prelude's Conclusion feeds score's next research round.

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

## Flagging suspicions

At any point in the run, if something looks weird, surprising, or suspicious — even a likely false
alarm — record it: `$CS prelude flag <TOPIC> "<what looked off>"`. It writes straight to the playback
feed (survives teardown and aborts) and costs nothing, so prefer over-recording. Review later with
`/consort:playback`.

## Task list (TaskCreate × 11 before Phase 0)

Create the task list with `TaskCreate`. Update statuses at the phase boundaries below. Per-part
rows are intentionally absent (N varies 2 or 3); each `[parts]` row covers the whole roster in
parallel.

| # | subject | activeForm |
|---|---|---|
| 0   | `0 Args + init + roster [maestro]`         | `Staging args` |
| 1   | `1 Literature auto-detect [maestro]`       | `Classifying topic` |
| 2   | `2 Parallel spawn [maestro]`               | `Spawning parts` |
| 3   | `3 Research dispatch [parts]`              | `Dispatching research` |
| 4   | `4 Research wait [parts]`                  | `Parts researching` |
| 5   | `5 Preliminary synthesis [maestro]`        | `Synthesizing draft` |
| 5.5 | `5.5 Confidence gate [maestro + user]`     | `Evaluating confidence` |
| 6   | `6 Adversary dispatch [parts]`             | `Dispatching adversary` |
| 7   | `7 Adversary wait [parts]`                 | `Parts attacking synthesis` |
| 8   | `8 Final synthesis [maestro]`              | `Writing final landscape` |
| 9   | `9 Teardown + archive + handoff [maestro]` | `Tearing down` |

## Phase 0 — args + init + roster

Set task `0` → `in_progress`.

1. Mint an args path: `$CS prelude --mint-args-file` → prints `<args-path>`.
2. **Write tool:** `file_path` = `<args-path>`, `content` = `$ARGUMENTS` (verbatim, unquoted). Never
   echo it into a shell.
3. Init: `$CS prelude init --args-file <args-path>`. On success it prints to stdout (logs go to
   stderr):
   ```
   TOPIC=<slug>
   N=<2|3>
   ART=<abs path to the _prelude art dir>
   PART=<instrument>:<provider>   (one per part)
   ```
   Capture `TOPIC` / `N` / `ART` and the `PART=` instrument:provider pairs — later phases read/write
   files under `$ART` and pass `<TOPIC>` to every subcommand. Non-zero exit aborts:
   - **rc 1** = empty topic OR fewer than 2 validated providers (redirect: just ask Claude directly
     — no orchestration needed).
   - **rc 2** = topic already in flight (run `/consort:coda` or pick a different topic).

   Surface stderr verbatim and stop on a non-zero rc.

Set task `0` → `completed`.

## Phase 1 — literature auto-detect

Set task `1` → `in_progress`.

`$CS prelude classify <TOPIC>` — classifies the topic via keyword scan and writes
`$ART/lit-track.txt`. The result is consumed by Phase 3's per-part research prompt (it tells each
part how much to weight academic-paper retrieval). **The Maestro itself never runs retrieval —
classify only weights how the parts retrieve.** rc 1 = `$ART` missing (init didn't run).

Set task `1` → `completed`.

## Phase 2 — parallel spawn (spawn-retry-once)

Set task `2` → `in_progress`.

Spawn the whole roster in one call: `$CS prelude spawn-all <TOPIC>`. It preflights N panes off your
pane, spawns every part in parallel (`--target-pane`, `--cwd <repo>`), and writes
`$ART/spawn-results.tsv`. Branch on its rc:

- **rc 0** → all N parts ready. Continue to Phase 3.
- **rc 1 or 2, FIRST failure** → cold-start tolerance: tear down the partial set
  (`$CS prelude teardown <TOPIC>`) and retry `$CS prelude spawn-all <TOPIC>` **ONCE**.
- **rc 1 or 2, after the retry (second failure)** → retry exhausted. Tear down
  (`$CS prelude teardown <TOPIC>`), `rm -rf "$ART/../"` (the topic state dir — its parent is
  `<topic>/`, of which `_prelude` is a child), and abort. Surface the specific provider failures from
  `$ART/spawn-results.tsv` to the user and stop.

Set task `2` → `completed`.

## Phase 3 — parallel research dispatch

Set task `3` → `in_progress`.

Issue **N parallel Bash calls in one message** (one per part), using the `PART=<instrument>:<provider>`
pairs from init:

```
$CS prelude research-send <TOPIC> <instrument> <provider>
```

Each `research-send` renders that part's research prompt — already weighted by `$ART/lit-track.txt`
(Phase 1) — captures the pre-send outbox `OFFSET=` into `$ART/research-<instrument>.txt`, and nudges
the pane. The Maestro orchestrates and synthesizes; the parts do all retrieval. (rc 1 = the state
file already exists — `rm` it to redo.)

Set task `3` → `completed`.

## Phase 4 — parallel research wait

Set task `4` → `in_progress`.

For **each** part, await its research turn **in the background** — issue N background-await Bash
calls in parallel in one message:

```
Bash(command='$CS prelude research-wait <TOPIC> <instrument> <provider>', run_in_background: true,
     description='prelude research-wait <instrument>')
```

Each `research-wait` blocks on that part's `done`/`error`/`question` outbox event, then appends an
`FS=` line to `$ART/research-<instrument>.txt` and writes the
`$ART/research-<instrument>.done` sentinel.

**Proceed when all N parts have written their `research-<instrument>.done` sentinel.** The `FS=`
value is informational — do **NOT** gate on `FS=ok`; a part with `FS=empty`/`FS=malformed` still
produced its `findings-<instrument>.md` and the synth validator (Phase 5) catches truly missing
findings. If a part emits a `question` event (its state file's last line shows `FS=question`),
handle it via **Intervention Pattern 1** before proceeding.

Set task `4` → `completed`.

## Phase 5 — preliminary synthesis (Maestro Writes)

Set task `5` → `in_progress`.

Run the input validator: `$CS prelude synth-preliminary <TOPIC>`. It prints the draft path
`$ART/landscape-draft.md` on stdout; **rc 1** if inputs are missing (topic.txt, roster.txt, or any
`findings-<instrument>.md` empty) — surface the missing-file list and stop.

Then **use the Write tool** to author `landscape-draft.md`, reading every `$ART/findings-<instrument>.md`,
with this EXACT section set:

```markdown
## Topic
<verbatim from $ART/topic.txt>

## Approaches
1. <approach name> — <one-line summary, clustered across findings>
2. ...

## Tradeoff matrix
| Priority | Best fit | Reason (with citation) |
|----------|----------|------------------------|
| ...      | ...      | ...                    |

## Findings by part
### <instrument> (<provider>)
<digest of findings-<instrument>.md>

## Open questions
- ...

## Citations
- ...
```

Label **CONTESTED** claims explicitly (this is confidence signal S3). Every Tradeoff-matrix Reason
cell MUST contain at least one citation — a file path, URL, or paper-id (this is signal S4).

Set task `5` → `completed`.

## Phase 5.5 — confidence gate

Set task `5.5` → `in_progress`.

`$CS prelude confidence <TOPIC>` → evaluates the 5 signals against `landscape-draft.md` + findings,
logs `S1`–`S5` to stderr, and prints `ALL_HOLD=<bool>` to stdout.

**Branch on `ALL_HOLD`:**

- **`ALL_HOLD=false`** (the common case — the gate is intentionally strict) → the verb has already
  written `$ART/adversary-skip.txt` with `user_decision: not-offered`. No prompt. **Fall through to
  Phase 6.**
- **`ALL_HOLD=true`** (rare) → fire **AskUserQuestion** (Header `Adversary`):
  - Option 1 (recommended) **"Run adversary (default — safer)"** — re-dispatch all N parts in
    parallel to challenge the synthesis; catches blind spots the gate may have missed (~5-8 min).
  - Option 2 **"Skip adversary, write Conclusion now"** — trust the preliminary synthesis; jump
    straight to the final landscape doc with Conclusion (saves ~5-8 min).

  Record the choice: `$CS prelude confidence <TOPIC> --decision <skip|continue>` (writes
  `adversary-skip.txt` with the user's decision).
  - User chose **skip** → set tasks `5.5`/`6`/`7` → `completed` (adversary skipped), then
    **jump to Phase 8**.
  - User chose **continue** → proceed to Phase 6.

Set task `5.5` → `completed`.

## Phase 6 — adversary dispatch (skipped if user accepted skip)

Set task `6` → `in_progress` (or `completed` immediately if skipped).

Issue **N parallel Bash calls in one message** (one per part):

```
$CS prelude adversary-send <TOPIC> <instrument> <provider>
```

Each `adversary-send` renders that part's adversary prompt against `landscape-draft.md`, captures
the pre-send `OFFSET=` into `$ART/adversary-<instrument>.txt`, and nudges the pane.

Set task `6` → `completed`.

## Phase 7 — adversary wait (skipped if Phase 6 skipped)

Set task `7` → `in_progress`.

For each part, issue an N-way background-await Bash call in parallel in one message (mirror Phase 4):

```
Bash(command='$CS prelude adversary-wait <TOPIC> <instrument> <provider>', run_in_background: true,
     description='prelude adversary-wait <instrument>')
```

**Proceed when all N `$ART/adversary-<instrument>.done` sentinels exist.** The `AS=` value is
informational (do NOT gate on `AS=ok`). Same question handling as Phase 4 — if a part's state file's
last line shows `AS=question`, handle via **Intervention Pattern 1** before proceeding. A malformed
or empty adversary critique is handled by **Intervention Pattern 2**.

Set task `7` → `completed`.

## Phase 8 — final synthesis (Maestro Writes)

Set task `8` → `in_progress`.

Run the input validator: `$CS prelude synth-final <TOPIC>`. It prints the canonical output path
`$ART/landscape-<date>-<topic>.md` on stdout. If adversary ran (the gate didn't record
`user_decision: skip`), it requires every `adversary-<instrument>.md` and **rc 1** with a
missing-file list otherwise — surface and stop.

Then **use the Write tool** to author the final doc, reading `$ART/landscape-draft.md` + all
`$ART/adversary-<instrument>.md` (if adversary ran), with this EXACT section set:

```markdown
## Topic
<from $ART/topic.txt>

## Approaches
<carried from the draft, possibly revised per adversary critiques>

## Tradeoff matrix
<carried from the draft, possibly revised per adversary critiques>

## Adversary critiques
- **<instrument> (<provider>):** <one-paragraph summary of adversary-<instrument>.md>
- ...

## Open questions
<merged from the draft + new questions raised by the adversary critiques>

## Conclusion
<the Maestro's directional take — see below>

## Citations
<collected from all findings + adversary critiques>
```

**If adversary was SKIPPED**, replace the `## Adversary critiques` body with this blockquote note:

> _Adversary phase skipped after the confidence gate passed and the user accepted skip. Findings
> are single-pass — no post-synthesis challenge was performed._

**The `## Conclusion`** is the hand-off seed for `/consort:score`. It must:

- Name the strongest approach + state explicit caveats.
- List the adversary-surfaced weaknesses the design phase must address.
- Suggest a concrete next invocation:
  `/consort:score Design <X> using approach <A>, with mitigations for <flagged-issue>`.
- If user priorities would shift the answer, point to the matrix row that changes it.

Set task `8` → `completed`.

## Phase 8a — forensics

`$CS prelude forensics <TOPIC>` (best-effort; never blocks — prints a path only if mechanical
signals were found, else empty). If it printed a path, use the **Write/Edit tool** to APPEND a
`## Maestro reflection` section to that file — 3-5 short bullets interpreting the mechanical findings
— **BEFORE** the Phase 9 teardown moves the art dir. Idempotent: skip the append if the file already
contains the exact header `## Maestro reflection`. The forensics file lives outside the topic state
tree, so it survives teardown + archive.

## Phase 9 — teardown + archive + handoff-extract

Set task `9` → `in_progress`.

1. **Pane teardown first.** Read the roster instruments and run
   `$CS coda --pairs <TOPIC> <instrument…>` — one 9s graceful **FINE**-banner batch across all panes
   (not N × 9s), then hard-kill + per-part archive. Per-part failures are tolerated.
2. **Archive the state.** `$CS prelude teardown <TOPIC>` — orphan-kills any leftover preflight panes,
   archives the `_prelude` dir, and prints the archive destination on stdout. **Rebind `ART` to that
   printed archive path** (the `_prelude` archive location) for the handoff steps below. The final
   landscape doc now lives at `$ART/landscape-<date>-<topic>.md`.
3. **Extract handoff data.** `$CS prelude handoff-extract "$ART"` — pass the **rebound archived
   art-dir** as the positional (this verb takes the art-dir path, NOT a topic). It writes
   `$ART/handoff-data.kv` with the mechanical fields (`mode`, `topic`, `landscape_doc`,
   `confidence_signals`, adversary-findings paths, findings paths, etc.). A non-zero rc (rc 2 =
   `topic.txt` missing under `$ART`) means inputs were missing — log it and **SKIP Phase 9c** (warn,
   do not crash).

## Phase 9c — compose score-handoff.md (Maestro Writes)

Read `$ART/handoff-data.kv` (the mechanical facts) AND the landscape doc it names via
`landscape_doc=`. As Maestro, **use the Write tool** to author `$ART/score-handoff.md` with this
six-section schema IN ORDER:

```markdown
# <topic>

Source: prelude session at $ART
Generated: <generated_ts from the KV>

## Recommendation
<1-3 paragraphs of English prose (no bullets). Names the convergent approach. Past tense for
evidence, active voice.>

## Recipe
<Prescriptive distillation — the technique to adopt, key parameters, the differentiator from
runner-up approaches. Cite paper URLs / repo paths as $ART/<basename> (see Appendix); do NOT inline
lengthy quotes.>

## Constraints (carry-forward)
<Inline the confidence_signals from the KV (e.g. "S1=true,S2=true,S3=false,S4=true,S5=true") plus
any adversary findings (quote the key challenge per critique when adversary ran). When the adversary
phase was skipped, note: "No adversarial review performed — the design plan should preserve room for
that uncertainty.">

## Open questions
<Emit ONLY when the landscape doc surfaced genuine unresolved planning decisions that score's
drilldown will not naturally close (CONTESTED markers, multiple equally-strong approaches the survey
couldn't separate). If research closed everything, OMIT the WHOLE section — no header, no stub.>

## Evidence
<A citations table from ## Approaches + ## Tradeoff matrix:
| Source | Claim | Strength |
|--------|-------|----------|
| <paper / repo file:line> | <claim> | strong \| medium \| weak |
Then report the confidence-gate result: parse confidence_signals → "<N>/5 passed".>

## Appendix: artifacts
ALL PATHS ABSOLUTE. Interpolate each KV value as $ART/<value> (where $ART is the rebound archive
dir). Do NOT prefix, transform, or rewrite paths. If a KV value already starts with `/`, emit it
verbatim WITHOUT prepending $ART.
- Source session: $ART
- Landscape doc: $ART/<landscape_doc>
- Findings / adversary findings: comma-separated $ART/<basename> entries from the KV
- Full topic: $ART/<topic_txt_path>
```

**No-convergence branch** (`mode=prelude-no-convergence` in `handoff-data.kv`):
- `## Recommendation` reads: "Survey did not converge on a single best approach. See Evidence for
  contested findings and the tradeoff matrix."
- **OMIT `## Recipe`** entirely (no convergent approach → no recipe).
- `## Open questions` may capture the contested-decision axes the survey exposed but couldn't resolve.

Set task `9` → `completed`.

## Phase 10 — present

Print to the user:

```
Prelude complete.

Landscape doc:
  $ART/landscape-<date>-<topic>.md

Handoff doc (pipe directly into score):
  $ART/score-handoff.md

Suggested next step:
  /consort:score $ART/score-handoff.md

(Or hand-edit the topic to investigate a different angle.)
```

## Intervention patterns

The Maestro regains control between every phase (file-IPC, not in-process messaging). If a part
produces unexpected output, intervene before the next subcommand runs.

### Pattern 1: part question event

A part emits `{"event": "question", ...}`. The wait verb sets `FS=question` (research) or
`AS=question` (adversary) as the state file's last line and captures the question JSON to
`$ART/question-<instrument>.txt`. Read that file (its `message`, optional `options`), compose an
answer from the topic + findings, then relay it:
`$CS send --from maestro <instrument> <TOPIC> "<answer>"`. The wait verb already advanced the
`OFFSET=`; `rm -f "$ART/research-<instrument>.done"` (or `adversary-<instrument>.done`) and re-arm
that part's background wait. The wait resumes past the question — it never re-sends the prompt.

### Pattern 2: malformed adversary output

A part's `adversary-<instrument>.md` is empty or missing its `## Verdict` line. Re-dispatch that one
part once with a clarifying inbox payload pointing at the missing structure
(`$CS send --from maestro <instrument> <TOPIC> "<clarification>"`). If a second attempt still fails,
mark that part's critique as `(unavailable)` in the final landscape doc.

### Pattern 3: stuck spawn / cold-start failure

Already absorbed by Phase 2's auto-retry-once mechanism. If the retry also fails, Phase 2 tears down,
removes the topic state dir, and aborts with the provider-failure list. No further intervention.
