---
description: Cross-verified multi-model research synthesized into a deploy-audit-passing design doc — Maestro fast-path or escalate to a 2-3 part ensemble
argument-hint: [--ensemble] [--targets a,b,c] <topic — what to research / design>
allowed-tools: Bash, Write, Read, Edit, AskUserQuestion, WebSearch, Skill
---

# /consort:score

Run a cross-verified multi-model investigation on `$ARGUMENTS` and produce a single
deploy-schema design doc (Problem / Goal / Architecture / Components / Testing / Success
Criteria) that passes the deploy-audit gate — the artifact `/consort:perform` will consume.

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

## Stage 0 — args-file + init

1. Mint an args path: `$CS score --mint-args-file` → prints `<args-path>`.
2. **Write tool:** `file_path` = `<args-path>`, `content` = `$ARGUMENTS` (verbatim, unquoted).
3. Init: `$CS score init --args-file <args-path>`. On success it prints to stdout:
   ```
   TOPIC=<slug>
   N=<2|3>
   ENSEMBLE=<yes|no>
   MODE=<single|single-sub|multi>
   ART=<abs path to the _score art dir>
   PART=<instrument>:<provider>   (one per part)
   ```
   `MODE` reflects `--targets`: `single` (none passed), `single-sub` (one), or `multi` (two or more).
   Non-zero aborts: rc 1 = empty topic OR fewer than 2 validated providers (redirect: just ask
   Claude directly — no orchestration needed); rc 2 = topic already in flight. Capture `TOPIC`/`N`/
   `ENSEMBLE`/`MODE`/`ART` for later stages — later stages read/write files under `$ART` and pass
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
> - **escalate** (`escalated-from-flag` / `escalated-from-signals`) **and `MODE=single`** → **Stage 3**
>   (the ensemble pipeline below — research → diff; Phase C ends at the diff).
> - **escalate and `MODE` is `multi` / `single-sub`** (i.e. `--targets` was passed): the multi-repo
>   ensemble + execution-DAG design walk lands in **Phase E**. A multi doc would otherwise assemble
>   placeholder Execution DAG / Cross-Repo Notes sections that pass the audit while silently
>   under-serving the multi-repo intent. Tell the user plainly: "multi-repo runs (`--targets`) need
>   the Phase E pipeline; re-run without `--targets` for a single-repo run," and **stop**.

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
- **rc 0** → it prints the design-doc path. **Read and present** the doc to the user, then point at
  the next step: `/consort:perform <path>` (once perform ships).
- **rc 1** (audit FAIL) → it printed `ISSUE=<code>` lines to stderr. Map each to its section
  (`no_goal_section`→goal, `no_arch_section`→architecture, `no_testing_section`→testing,
  `no_success_section`→success-criteria, `tbd_marker`/`todo_marker`/`fill_in_later_marker`/
  `to_be_determined_marker`→the section you left a marker in, `unresolved_placeholder`→architecture),
  **re-draft** the offending `.draft/<section>.md` (Write tool), and **re-run `$CS score assemble
  <TOPIC>` once**. If it FAILs again → surface the remaining ISSUE list to the user and stop.

## Stage 3 — escalation: preflight + batch-spawn (single-repo)

> Reached only when Stage 1 chose **escalate** and `MODE=single`.

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
  3. **Write** the reply to a temp file, then `$CS send --from maestro <INST> <TOPIC> @<reply-file>`.
  4. `rm -f $ART/research-<INST>.done` and **re-arm** the background `$CS score research-wait <TOPIC>
     <INST> <PROV>`. (The wait resumes past the question — it never re-sends the research prompt.)
- **`FS=failed` / `FS=timeout`** — the part produced no usable findings; drop it.

**Proceed only when every part is terminal** (no `FS=question` outstanding). Then build the **diff
roster** = parts whose `findings.md` exists (`FS` ∈ {ok, empty, malformed}). If **<2** parts have
findings → abort (run `/consort:coda <instrument> <TOPIC>` for each ready part, tell the user the
ensemble could not produce 2 sets of findings, stop). If some parts were dropped, **rewrite
`$ART/roster.txt`** to the diff roster before Stage 6.

## Stage 6 — N-way diff

`$CS score diff <TOPIC>` — N-way Venn bucketing over the parts' `findings.md`. It writes `$ART/diff.md`
plus the bucket files (`<inst>_only_items.txt` for N=2; `consensus.txt` + `<a>+<b>_only.txt` + singles
for N=3). rc 1 = `diff.md` already exists (`rm` to retry) or a `findings.md` is missing.

> **Phase C ends here.** Cross-verify → adjudicate → the interactive design walk → the deploy-audit
> gate land in **Phase D**; multi-repo + the execution DAG in **Phase E**; drilldown, forensics,
> teardown, and `present` in **Phase F**. The buckets are in `$ART/diff.md`. The parts are still live —
> run `/consort:coda <instrument> <TOPIC>` for each to tear them down (Phase F automates this). No
> design doc is produced on the escalation path until Phase D.

## Notes

- Fast-path spawns no parts and writes no working artifacts beyond `topic.txt`, `.draft/*.md`, the
  assembled `design-doc/<date>-<slug>-design.md`, and `audit.log`. No teardown needed.
- Escalation Stages 3–6 (spawn-all → research → diff) ship in Phase C. The cross-verify → adjudicate
  → interactive design walk → deploy-audit gate (Phase D), multi-repo + execution-DAG (Phase E), and
  drilldown / forensics / teardown / present (Phase F) arrive in later phases.
