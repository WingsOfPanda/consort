---
description: Cross-verified multi-model research synthesized into a deploy-audit-passing design doc — Maestro fast-path or escalate to a 2-3 part ensemble
argument-hint: [--ensemble] <topic — what to research / design>
allowed-tools: Bash, Write, Read, Edit, AskUserQuestion, WebSearch, Skill, TodoWrite
---

# /consort:score

Run a cross-verified multi-model investigation on `$ARGUMENTS` and produce a single
deploy-schema design doc (Problem / Goal / Architecture / Components / Testing / Success
Criteria) that passes the deploy-audit gate — the artifact `/consort:perform` will consume.

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

## Progress tracking

Maintain a **TodoWrite** list so the user can see where the run is. Seed it after Stage 0 `init`
with a single `route` item; once Stage 1 decides the path, replace it with the path-appropriate
high-level stages, marking each `in_progress` on entry and `completed` on exit:

- **fast-path:** `draft sections`, `assemble+audit`, `export+present`.
- **escalation:** `spawn ensemble`, `research`, `diff`, `cross-verify`, `adjudicate`,
  `design walk`, `assemble+audit`, `drilldown` (optional), `teardown+archive`, `export+present`.

## Flagging suspicions

At any point in the run, if something looks weird, surprising, or suspicious — even a likely false
alarm — record it: `$CS score flag <TOPIC> "<what looked off>"`. It writes straight to the playback
feed (survives teardown and aborts) and costs nothing, so prefer over-recording. Review later with
`/consort:playback`.

## Stage 0 — args-file + init

1. Mint an args path: `$CS score --mint-args-file` → prints `<args-path>`.
2. **Write tool:** `file_path` = `<args-path>`, `content` = `$ARGUMENTS` (verbatim, unquoted).
3. Init: `$CS score init --args-file <args-path>`. On success it prints to stdout:
   ```
   TOPIC=<slug>
   N=<2|3>
   ENSEMBLE=<yes|no>
   ART=<abs path to the _score art dir>
   PART=<instrument>:<provider>   (one per part)
   ```
   Non-zero aborts: rc 1 = empty topic OR fewer than 2 validated providers (redirect: just ask
   Claude directly — no orchestration needed); rc 2 = topic already in flight. Capture `TOPIC`/`N`/
   `ENSEMBLE`/`ART` for later stages — later stages read/write files under `$ART` and pass
   `<TOPIC>` to every subcommand.

## Stage 1 — routing

Decide fast-path vs escalation, in order:

1. `ENSEMBLE=yes` → **escalate**. Path label = `escalated-from-flag`.
2. Otherwise, run a **time-boxed solo research pass** on the topic (Read/Grep/Bash for repo code;
   WebSearch + any `mcp__tavily`/`mcp__anysearch` per the user's triple-search rule; `mcp__context7`
   for library docs; `mcp__codegraph` for code intelligence; relevant `superpowers:*` skills), then
   run the **4-signal complexity check** — escalate if **any one** fires (favor rigor):
   - **Conflicting evidence** — sources disagreed on a key claim.
   - **Significant assumptions** — you had to assume facts not in evidence.
   - **High-stakes** — architecture / security / irreversibility / production data.
   - **Subjective tradeoffs** — no objective right answer (A vs B, should-we-adopt-X).
   If any fires → **escalate**, Path label = `escalated-from-signals`.
3. None fire → **fast-path**, Path label = `fast`.

> **Routing → next stage.** After Stage 1 decides:
> - **fast-path** (`Path: fast`) → **Stage 2** (Maestro solo, unchanged).
> - **escalate** (`escalated-from-flag` / `escalated-from-signals`) → **Stage 3** (the ensemble
>   pipeline below — research → diff → cross-verify → adjudicate → design walk).

## Stage 2 — fast-path (Maestro solo)

You have already researched the topic in Stage 1 (or research it now if you arrived via the flag).
Draft the **6 deploy-schema sections** to `$ART/design-doc/.draft/<section>.md` using the **Write
tool** (atomic single-shot writes), one file per section:

- `.draft/problem.md` → `## Problem` + 1-3 sentences on the current state.
- `.draft/goal.md` → `## Goal` + 1 paragraph on the end state. *(audit-required — never empty)*
- `.draft/architecture.md` → `## Architecture` + the recommended approach (the bulk). *(required)*
- `.draft/components.md` → `## Components` + bullets of files/functions/classes touched.
- `.draft/testing.md` → `## Testing` + bullets of test coverage. *(required)*
- `.draft/success-criteria.md` → `## Success Criteria` + measurable bullets. *(required)*

Each section body should cite sources inline where applicable (`path/to/file:line`, URLs, runtime
observations). Audit-required sections must NOT be empty; if a section truly doesn't apply, still
emit the heading + a one-line explanation (never `_(skipped)_` on the four required ones).

Then assemble + audit: `$CS score assemble <TOPIC>`.
- **rc 0** → it prints the design-doc path. Run `EXPORTED=$($CS score export-doc <TOPIC> | sed -n
  's/^EXPORTED=//p')` to copy the doc into `docs/consort/specs/` (a non-zero `export-doc` is
  non-fatal — just skip the exported path). **Read and present** the doc to the user, state its
  location clearly — **`$EXPORTED` (docs/consort/specs/) as the primary, discoverable path**, with
  the `_score/design-doc/` path as the source — then point at the next step:
  `/consort:perform $EXPORTED`.
- **rc 1** (audit FAIL) → it printed `ISSUE=<code>` lines to stderr. Map each to its section
  (`no_goal_section`→goal, `no_arch_section`→architecture, `no_testing_section`→testing,
  `no_success_section`→success-criteria, `tbd_marker`/`todo_marker`/`fill_in_later_marker`/
  `to_be_determined_marker`→the section you left a marker in, `unresolved_placeholder`→architecture),
  **re-draft** the offending `.draft/<section>.md` (Write tool), and **re-run `$CS score assemble
  <TOPIC>` once**. If it FAILs again → surface the remaining ISSUE list to the user and stop.

## Stage 3 — escalation: preflight + batch-spawn

> Reached on **any** escalation. Stages 3–9 spawn the ensemble + research + diff + cross-verify +
> adjudicate; the design walk (Stage 10) then produces the doc.

Spawn the ensemble in one call: `$CS score spawn-all <TOPIC>`. It preflights N panes, spawns every
part in parallel (`--target-pane`, `--cwd <repo>`), and writes `$ART/spawn-results.tsv` (TSV
`<instrument>\t<provider>\t<rc>\t<reason>`). Branch on its rc:

- **rc 0** — all N parts ready → Stage 4.
- **rc 1** (partial) — read `$ART/spawn-results.tsv`; the rows with `rc==0` are the survivors. If
  **≥2 survive**, **rewrite `$ART/roster.txt`** to only the survivor rows (TSV `<provider>\t<instrument>`,
  one per line) and proceed degraded to Stage 4. If **<2 survive**, abort: run `/consort:coda
  <instrument> <TOPIC>` for any ready part, tell the user the ensemble could not reach 2 parts, and stop.
- **rc 2** (all failed) — retry once: `rm -f $ART/preflight-panes.txt $ART/spawn-results.tsv` and re-run
  `$CS score spawn-all <TOPIC>`. If it still returns rc 2, abort (redirect: "just ask Claude directly")
  and stop.

## Stage 4 — research dispatch (per part)

Read the (possibly rewritten) roster and send a research turn to each part:

```bash
grep -v '^#' "$ART/roster.txt" | while IFS=$'\t' read -r PROV INST; do
  [ -n "$PROV" ] && [ -n "$INST" ] && $CS score research-send <TOPIC> "$INST" "$PROV"
done
```

Each `research-send` composes the findings prompt, captures the pre-send outbox `OFFSET=` into
`$ART/research-<instrument>.txt`, and nudges the part. (rc 1 = state file already exists — `rm` it to redo.)

## Stage 5 — research wait + question relay (per part)

For **each** part, await its research turn **in the background** (one call per part):

```
Bash(command='$CS score research-wait <TOPIC> <INST> <PROV>', run_in_background: true,
     description='score research-wait <INST>')
```

On each completion notification, read that part's **last** `FS=` line —
`FS=$(grep '^FS=' "$ART/research-<INST>.txt" | tail -1 | cut -d= -f2)` (`research-wait` *appends* one
`FS=` line per wait, so after a question→re-arm cycle the file holds e.g. `FS=question` then `FS=ok`;
the last line is the current outcome). Branch:

- **`FS=ok` / `FS=empty` / `FS=malformed`** — terminal; the part's `findings.md` exists.
- **`FS=question`** — run the **classify + relay** (the score escalation; distinct from solo's never-ask):
  1. Read `$ART/question-<INST>.txt` (the captured question JSON — `message`, optional `options`) and
     the part's `findings.md`.
  2. **Classify** the question against the findings: is it a **critical** decision only the user can
     make (high-stakes, irreversibility, a subjective product/architecture tradeoff)? → use
     **AskUserQuestion** to get the answer. Otherwise it is **non-critical** → answer it yourself from
     the topic + findings (Maestro self-answers).
  3. **Write** the reply to a temp file **beginning with a line `ANSWER: <your answer>`** (the part's
     skill-hint reads the line starting `ANSWER: `), then `$CS send --from maestro <INST> <TOPIC> @<reply-file>`.
  4. `rm -f $ART/research-<INST>.done` and **re-arm** the background `$CS score research-wait <TOPIC>
     <INST> <PROV>`. (The wait resumes past the question — it never re-sends the research prompt.)
- **`FS=failed` / `FS=timeout`** — the part produced no usable findings; drop it.

You launched **N** background waits — expect **N** completion notifications, one per part. On each,
read that part's last `FS=` line and handle it (relaying any `FS=question` via the loop above, which
re-arms that part). **Do not proceed until `$CS score wait-gate <TOPIC> research` exits 0** — it
prints `<INST>\t<terminal|question|pending>` for every part and returns 0 only when all are
`terminal`. rc 1 means at least one part is still `pending` (researching) or `question` (needs a
relay): keep handling notifications / relay, then re-run the gate. Only on rc 0 proceed. Then build the **diff
roster** = parts whose `findings.md` exists (`FS` ∈ {ok, empty, malformed}). If **<2** parts have
findings → abort (run `/consort:coda <instrument> <TOPIC>` for each ready part, tell the user the
ensemble could not produce 2 sets of findings, stop). If some parts were dropped, **rewrite
`$ART/roster.txt`** to the diff roster before Stage 6.

## Stage 6 — N-way diff

`$CS score diff <TOPIC>` — N-way Venn bucketing over the parts' `findings.md`. It writes `$ART/diff.md`
plus the bucket files (`<inst>_only_items.txt` for N=2; `consensus.txt` + `<a>+<b>_only.txt` + singles
for N=3). rc 1 = `diff.md` already exists (`rm` to retry) or a `findings.md` is missing.

## Stage 7 — cross-verify dispatch (per part)

Read the diff roster (`$ART/roster.txt`) and dispatch each part's verify turn:

```bash
grep -v '^#' "$ART/roster.txt" | while IFS=$'\t' read -r PROV INST; do
  [ -n "$PROV" ] && [ -n "$INST" ] && $CS score verify-send <TOPIC> "$INST" "$PROV"
done
```

`verify-send` computes each part's scope (the bucket files where it is NOT a member), writes
`verify-claims-<inst>.txt`, and either sends the verify prompt (`OFFSET=` captured) or writes
`VS=skipped` when there's nothing for that part to verify (no send).

## Stage 8 — cross-verify wait + question relay (per part)

For each part, background `$CS score verify-wait <TOPIC> <INST> <PROV>`. On each completion, read the
**last** `VS=` line (`grep '^VS=' "$ART/verify-<INST>.txt" | tail -1 | cut -d= -f2`):
- **`VS=ok` / `VS=skipped` / `VS=missing`** — terminal.
- **`VS=question`** — same classify+relay as Stage 5 (read `$ART/question-<INST>.txt` + the part's
  `verify.md`; AskUserQuestion if critical else self-answer; write the reply file **beginning with a
  line `ANSWER: <your answer>`**, then `$CS send --from maestro <INST> <TOPIC> @<reply>`; `rm -f
  $ART/verify-<INST>.done`; re-arm the background `verify-wait`).
- **`VS=failed` / `VS=timeout`** — record; the rival's claims this part would have verified surface
  unresolved (N=2: a `## Not-verified` section; N≥3: they fall through the `UNCERTAIN` tier into
  PENDING/Contested) — either way Maestro resolves them in Stage 9.
Expect **N** completion notifications (one per part); handle each, relaying any `VS=question`. **Do
not proceed until `$CS score wait-gate <TOPIC> verify` exits 0** — it prints
`<INST>\t<terminal|question|pending>` per part; rc 1 means some part is still `pending`/`question`,
so keep handling / relay and re-run. Only on rc 0 continue.

## Stage 9 — adjudicate + resolve PENDING

1. `$CS score adjudicate <TOPIC>` → writes `$ART/adjudicated-draft.md` (5-tier for N≥3, 4-section for N=2).
2. `cp "$ART/adjudicated-draft.md" "$ART/adjudicated.md"`.
3. **Read** `$ART/adjudicated.md`. For **every** `- PENDING:` line: read the cited source, decide, and
   **Edit** the line in place — rewrite the `PENDING` prefix to `CONFIRMED`/`REFUTED`, or move the item
   under `## Contested`. **Done only when no `- PENDING:` line remains** (`synthesize` refuses otherwise).
   You may also lead claim lines with a steer-tag — `- [Goal] …`, `- [Architecture] …`,
   `- [Components] …`, `- [Testing] …`, `- [Success Criteria] …` — to route them into the matching
   synthesize seed.

## Stage 10 — interactive per-section design walk

1. Seed the drafts: `$CS score synthesize <TOPIC>` (refuses while any `- PENDING:` remains, or if
   `adjudicated.md` is missing). Writes the 6 `.draft/<section>.md`.
2. Resume check: `$CS score walk-state <TOPIC>` prints `<section>\t<approved|skipped>` for drafts
   already settled — skip those on re-entry.
3. **Walk the 6 sections in order** (problem, goal, architecture, components, testing, success-criteria).
   For each: **Read** `$ART/design-doc/.draft/<section>.md` (the seed) + `$ART/adjudicated.md` + the
   parts' `findings.md`; **draft** the section and **Write** it to that `.draft/<section>.md` path;
   present it in chat; then **AskUserQuestion**: Approve / Revise / Skip.
   - **Approve** → keep, next section.
   - **Revise** → take free-form direction via a follow-up, re-draft, re-present (cap 4 revises; after
     the cap, force-approve the current draft and move on).
   - **Skip** → Write `_(skipped)_` as the whole body. **Skip is NOT offered for the four
     audit-required sections** (goal, architecture, testing, success-criteria) — they must be drafted.

## Stage 11 — assemble + deploy-audit gate (retry loop)

`$CS score assemble <TOPIC>`.
- **rc 0** → it prints the design-doc path. Immediately run `EXPORTED=$($CS score export-doc <TOPIC>
  | sed -n 's/^EXPORTED=//p')` to copy the doc into `docs/consort/specs/` **before** teardown/
  archive (Stages 13b/14) so the `_score` source still exists (a non-zero `export-doc` is non-fatal).
  **Read and present** the doc, then continue to Stage 12 (Phase F). Carry `$EXPORTED` to Stage 15.
- **rc 1** (audit FAIL) → it printed paired `ISSUE=<code>` + `SECTION=<mapped>` lines to stderr. For
  each `SECTION=`:
  - a **section name** (problem/goal/architecture/components/testing/success-criteria) → re-walk that
    one section (Stage 10 for it), then re-assemble.
  - `ASK` (a TBD/TODO/fill-in marker) → AskUserQuestion which section carries the marker, re-walk it.
  - empty (unknown code) → surface the raw `ISSUE=` and stop.
  Re-assemble after each fix; loop until rc 0 (bound to a few attempts per section, then surface the
  remaining ISSUEs and stop).

## Stage 12 — drilldown (optional; parts still live)

(Fast-path: no parts → skip Stages 12–14 entirely; go to Stage 15.) Derive the design-doc path
(`$ART/design-doc/<date>-<TOPIC>-design.md`, also printed by `assemble`; missing → tell the user and
skip drilldown). **AskUserQuestion**: "Any aspect to drill deeper before tearing down? (parts still
live)" — **Yes, drill** / **No, proceed to teardown**. While Yes, per round:
1. Free-form: **drill subject** (a section/topic) → SECTION; **focus angle** (e.g. "the tradeoffs feel
   hand-wavy") → FOCUS.
2. **AskUserQuestion which part(s)** — an N-aware option set from `$ART/roster.txt`: N=2 → the 2 parts +
   "both (parallel)"; N=3 → the 3 parts + 3 pairs + "all three (parallel)".
3. Dispatch (the CLI caps at 2 parts per call):
   - one or two parts → one call: `$CS score drilldown <TOPIC> "<SECTION>" "$ART/drilldowns" "<FOCUS>"
     <DESIGN_DOC> <i1> <m1> [<i2> <m2>]`.
   - **all three** → **two parallel** `$CS score drilldown …` Bash calls in one message (a K=2 call +
     a K=1 call) sharing `<TOPIC>` + `"$ART/drilldowns"`. Success if ≥1 call returns rc 0.
4. **Read back** `$ART/drilldowns/_scratch/drilldown-<section-slug>-*.md` and summarize. On **rc 1**
   (all empty/timeout) → AskUserQuestion **Retry / Different aspect / Skip**. Then "Drill another
   aspect?" — loop or proceed.

The drill files stay in `_score/drilldowns/_scratch/` (out of `design-doc/`) and ride along into the
archive (Stage 14). Re-drilling the same section auto-suffixes `-2`, `-3`, ….

## Stage 13a — forensics capture + Maestro reflection

`FORENSICS=$($CS score forensics <TOPIC>)` (best-effort; prints a path only if mechanical signals were
found, else empty — never blocks). If `FORENSICS` is non-empty: tell the user "forensics captured:
$FORENSICS", then **Read** it and **append** a `## Maestro reflection` section (3–5 interpretive bullets:
what's surprising, repeat-vs-first-time patterns, the suggested next action — a memory worth saving, a
spec topic, a patch, or a one-off) via the Write/Edit tool. **Idempotent:** skip the append if the file
already contains the exact header `## Maestro reflection`. The forensics file lives under
`~/.consort/forensics/<date>/` — OUTSIDE the topic state — so it survives teardown + archive.

## Stage 13b — teardown (FINE banner)

Tear down all live parts in one shared banner: read the roster instruments from `$ART/roster.txt` and
run `$CS coda --pairs <TOPIC> <instrument…>` (one 9s graceful FINE-banner batch, then hard-kill +
per-part archive). Per-part failures are tolerated. (Equivalent fallback: `$CS coda <instrument>
<TOPIC>` per part.) Fast-path: no parts → skip.

## Stage 14 — archive

`$CS score archive <TOPIC>` → `archiveTopic(topic,'score')`: stamps every part `status.json` to
`state=archived`, moves the whole `_score/` dir (including `drilldowns/`) to
`~/.consort/archive/<repo-hash>/<TOPIC>/_score-<ts>`, and rmdirs the topic. The forensics file from
Stage 13a is untouched (it lives outside the state tree). Fast-path: skip (nothing beyond the doc).

## Stage 15 — present + perform handoff

**Read and present** the final design-doc. State its location clearly: **`$EXPORTED`
(`docs/consort/specs/`) is the primary, discoverable copy** (exported in Stage 11, survives
teardown/archive); the source `_score`/archive copy (`$ART/design-doc/<date>-<TOPIC>-design.md`, or
the archived path after Stage 14) is noted as provenance. Then point the user at the next step:
`/consort:perform $EXPORTED` — the deploy-audit gate already guarantees the doc is perform-ready.
This is the end of `score`.

## Notes

- Fast-path spawns no parts and writes no working artifacts beyond `topic.txt`, `.draft/*.md`, the
  assembled `design-doc/<date>-<slug>-design.md`, and `audit.log`. No teardown needed.
- Escalation runs Stages 3–11 (spawn-all → research → diff → cross-verify → adjudicate → synthesize →
  design walk → deploy-audit gate), then the wind-down (Stages 12–15: drilldown → forensics + Maestro
  reflection → `coda` teardown → archive → present + perform handoff).
