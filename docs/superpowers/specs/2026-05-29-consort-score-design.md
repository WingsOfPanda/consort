# consort `score` — Design (full-parity consult)

**Date:** 2026-05-29 · **Status:** approved · **Branch:** `feat/score`

> The largest high-level command: a **full-parity** port of clone-wars `consult` (current main),
> rebranded. score runs cross-verified multi-model research and produces a **deploy-audit-passing
> design doc** that `perform` (= `deploy`, not yet built) will later consume — mirroring the
> clone-wars `consult → deploy` pipeline. Wins over `MIGRATION.md` where they differ. Honors the
> frozen wire protocol and the locked musical rebrand.

**Behavioral spec source:** `clone-wars/commands/consult.md` (all 16 steps), `clone-wars/lib/consult*.sh`,
`clone-wars/bin/consult-*.sh`, `clone-wars/lib/deploy.sh` (`cw_deploy_audit_doc`),
`clone-wars/lib/deploy-dag.sh` + `clone-wars/bin/deploy-dag-parse.sh` (the DAG validator only),
`clone-wars/config/prompt-templates/consult/*`. Preserve **behavior and the stage sequence**;
modernize internals (typed objects, `JSON.parse`, atomic writes) — do not transliterate the Bash.

---

## 1. Summary

`score` is the heavy research-and-design command. Given a topic, the conductor (**Maestro**)
either answers it **solo** (fast-path) or escalates to **N=2–3 parts** (cross-verified ensemble),
and in both cases produces a single **design doc in the deploy schema**, gated by a **deploy-audit
check** so the doc is `perform`-ready. The escalation path runs the full clone-wars consult
pipeline: preflight pane grid → batch-spawn → per-part research → N-way diff → cross-verify →
adjudicate → multi-repo detect → **interactive per-section design walk** → assemble + **deploy-audit
gate** → drilldown → teardown → present.

This is **full parity** with current-main consult, including **multi-repo detection + the
execution-DAG**. The one thing score does **not** build is the DAG *executor* (topological
waves / fan-in / per-repo dispatch) and `target_cwd` redirection — those are `perform`'s job and
are deferred to perform's own spec. score builds the DAG *producer + validator* (it must validate
its own emitted DAG against the consumer grammar), the audit gate (a pure markdown linter), and
everything upstream.

---

## 2. Scope & non-goals

**In scope (this spec — the whole command):**
- The `score` subcommand family + `commands/score.md` directive (the full 16-stage choreography).
- Fast-path (research → draft 6 sections → assemble + audit) **and** escalation (the full pipeline).
- The **deploy schema** output (6 sections single-repo; 8 for multi-repo) + the **deploy-audit gate**.
- **Multi-repo** detection, `--targets`, the **execution-DAG** producer + draft-time validator,
  cross-repo notes, the 8-section walk path.
- The interactive per-section **walk**, the **drilldown** rounds, **forensics** capture + reflection.
- New core modules, unit tests, and a live dogfood.

**Non-goals (deferred to later specs):**
- **`perform` (= `deploy`)** itself — the consumer of score's doc. score produces a `perform`-ready
  artifact; nothing consumes it until perform lands (forward-looking, accepted).
- The DAG **executor**: `cw_deploy_dag_topological` (waves), `cw_deploy_dag_unique_repos` /
  `fan_in_repos`, the per-wave dispatch + "feels unsafe" heuristic, `dag-waves.txt`/`dag-edges.txt`
  persistence, `target_cwd`/branch redirection (`cw_deploy_extract_target`/`cw_deploy_target_cwd`).
  score parses the DAG only to a temp dir to validate it, then discards.
- The other four high-level commands (`prelude`/`rehearsal`/`playback`, and `perform`).
- `meditate`/`deep-research` consult kinds (`adversary`/`experiment` timeout branches) — ignored.

---

## 3. Decisions (settled in brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | **Output schema** | **Deploy schema** (Problem / Goal / Architecture / Components / Testing / Success Criteria; +Execution DAG / Cross-Repo Notes for multi-repo). score's doc must be `perform`-consumable, mirroring `consult → deploy`. |
| D2 | **Deploy-audit gate** | **In, ported into score** — `cw_deploy_audit_doc` is a pure read-only markdown linter, fully portable without building perform. score self-gates its doc. Regexes ported **byte-identical** (tightening risks diverging from clone-wars dogfood expectations). |
| D3 | **Scope** | **Full parity in one mega-spec** — single-repo AND multi-repo (incl. execution-DAG + 8-section walk). The build is phased (A–F, §16) across multiple plans, but the design is one document. |
| D4 | **Walk fidelity** | **Full per-section walk** — each section Approve/Revise/Skip via `AskUserQuestion`, free-form Revise via follow-up, the critical-section guard, the revise cap. Faithful to consult. |
| D5 | **Question loop** | **Keep consult's escalation** — research/verify part questions classified against findings: critical → user via `AskUserQuestion`; non-critical → Maestro self-answers + re-arms. (Distinct from solo's never-ask.) |
| D6 | **Ensemble** | **N=2–3** (faithful; clone-wars init exits >3). Roster = `readProviderList(activeProvidersPath())` filtered by `instrumentConsultValidated`. N<2 → redirect ("just ask Claude directly"). If the curated active set has >3, score uses the first 3 (contracts row order) and logs which. |
| D7 | **Routing** | `--ensemble` flag → 4-signal complexity check → else fast-path. The fuzzy **phrasing-trigger keyword scan is trimmed** (deliberate; easily re-added later). |
| D8 | **Art dir** | **`_score`** (consistent with solo's `_solo`); pass `--art-dir` to `preflight`; add `"score"` to `archiveTopic`'s suite union. |
| D9 | **Batch-spawn** | A dedicated **`score spawn-all`** subcommand (`Promise.all` internally) — avoids the conductor-serialization bug clone-wars' v0.62 fixed. Mirrors `spawn-batch.sh`'s rc 0/1/2 + spawn-results contract. |
| D10 | **Conductor state** | The directive **re-derives state from on-disk `_score` artifacts** at the top of each Bash block (consort drops shell state between calls); a per-invocation `runDir` pointer locates the topic. |

---

## 4. Command surface

`commands/score.ts` dispatches on `args[0]` (mirroring `solo.ts`). The dispatcher in `src/consort.ts`
gains one `score` entry (`import("./commands/score.js")` + `score: score.run`).

| Subcommand | Responsibility | rc |
|---|---|---|
| `score init --args-file <p>` | parse topic + `--ensemble`/`--targets`; derive slug; load roster (`activeProvidersPath` → validated; **N≥2 required; >3 capped to the first 3** in contracts row order, logged); scaffold `_score/` + `design-doc/.draft/`; write `topic.txt`, `roster.txt` (TSV `<provider>\t<instrument>`), `multi-repo.txt`/`targets.txt` if `--targets`; print slug + N | `0` · `1` bad/empty topic **or N<2 (redirect to "just ask Claude")** · `2` in-flight |
| `score spawn-all <topic>` | preflight N-pane grid (reuse) + `Promise.all` over `spawn --target-pane`; write `spawn-results.tsv` (TSV `<instrument>\t<provider>\t<rc>\t<reason>`) | `0` all ok · `1` partial · `2` all failed |
| `score research-send <topic> <instrument> <provider>` | compose research prompt; capture `OFFSET=`; inbox-write + nudge | `0` · `1` |
| `score research-wait <topic> <instrument> <provider>` | offset-wait `[done,error,question]`; classify → append `FS=`; capture `question-<instrument>.txt` | always `0` |
| `score diff <topic>` | N-way Venn over per-part `findings.md` → bucket files + `diff.md` | `0` · `1` |
| `score verify-send <topic> <instrument> <provider>` | compute cross-verify scope (union of buckets not containing this part); compose verify prompt; `OFFSET=`; send | `0` · `1` (empty scope → `VS=skipped`, no send) |
| `score verify-wait <topic> <instrument> <provider>` | offset-wait; classify → append `VS=`; capture question | always `0` |
| `score adjudicate <topic>` | write `adjudicated-draft.md` (5-tier: Consensus / Cross-verified / Contested / Refuted / Pending) | `0` · `1` |
| `score detect-multi-repo <topic>` | sibling-scan vs `adjudicated.md`; emit TSV hits (conductor drives the AskUserQuestion branches + writes `multi-repo.txt`/`targets.txt`) | `0` |
| `score synthesize <topic>` | seed `design-doc/.draft/<section>.md` from `adjudicated.md` (refuses while any `- PENDING:` remains) | `0` · `1` |
| `score assemble <topic>` | concat `.draft/*` → canonical doc + trust header; run the **deploy-audit gate**; on FAIL emit `ISSUE=` lines | `0` · `1` audit FAIL · `2` usage |
| `score drilldown <topic> <subject> <dd-dir> <focus> <doc> <inst> <prov> [inst2 prov2] [subproject]` | dispatch K≤2 drill turns; write `_scratch/drilldown-<slug>-<inst>.md` | `0` ≥1 produced · `1` all empty · `2` args |
| `score present <topic>` / `score summary` | print the final doc + the `perform` handoff pointer | `0` |

**Reused foundation primitives:** `preflight` (N-pane grid), `spawn --target-pane --cwd`, `send --from maestro @file`, `coda --pairs` (teardown + FINE banner), `soundcheck`'s `providers-active.txt`.

**New `core/` modules:**
- `core/audit.ts` — `auditDoc(docText): {verdict, issues[]}` (port of `cw_deploy_audit_doc`) + `extractTarget`. Introduces `SLUG_REGEX` (`[A-Za-z0-9._-]+`).
- `core/dag.ts` — `parseDagLine`, `checkDagSection`, `emitSoftDag` (the DAG **validator + producer**; **not** the executor).
- `core/multirepo.ts` — `detectMultiRepo(cwd, corpus)` (sibling CLAUDE.md/AGENTS.md scan + case-insensitive substring).
- `core/scoreDoc.ts` — the deploy-schema section model (6/8 ordered keys+titles), the assembler (H1 + Date/Target header + per-section concat with `_(missing draft)_`), the trust-header renderer.
- `core/scoreWalk.ts` — `walkSectionState(draftDir)` (approved/skipped resume reader), `auditIssueToSection` map.
- `core/scoreTurn.ts` — the multi-part two-phase turn helpers (research/verify prompt composers; per-part `FS=`/`VS=` state; N-way wait fan-out), built on `ipc` primitives + `classifyTurn`/`parseOffset` from `turn.ts` (reused, not bent).
- `core/scoreDiff.ts`, `core/scoreAdjudicate.ts` — N-way Venn bucketing and the 5-tier adjudication classifier.
- `core/score.ts` — slug, paths (`scoreArtDir`), routing helpers, `--ensemble`/`--targets` parse, renderers.

`archive.ts` `archiveTopic` gains `"score"` in its suite union; `preflight` is called with `--art-dir <_score abs>`.

---

## 5. The pipeline (16 stages, rebranded)

The conductor runs `commands/score.md`. **Bold** = conductor judgment (Write / AskUserQuestion / Read).

### Stage 0 — args-file + init + route prep
3-step args-file fence (`score --mint-args-file` → **Write `$ARGUMENTS`** → `score init --args-file`).
Parse `--ensemble` (token-exact). `init` derives the slug, loads the roster, scaffolds `_score/`,
writes `roster.txt`; on `--targets`, validates + writes `targets.txt` + `multi-repo.txt`.

### Stage 1 — routing
1. `--ensemble` present → escalate (`Path: escalated-from-flag`).
2. else **Maestro runs a time-boxed solo research pass** (full toolkit: Read/Grep/Bash, triple
   web search, context7, codegraph, skills) and evaluates the **4-signal complexity check**
   (conflicting evidence · significant assumptions · high-stakes · subjective tradeoffs;
   **favor-rigor: any 1 fires → escalate**, `Path: escalated-from-signals`).
3. none fire → **fast-path** (`Path: fast`).

### Stage 2 — fast-path (no parts)
**Maestro drafts the 6 deploy-schema sections** to `_score/design-doc/.draft/<section>.md` (Write
tool; audit-required sections — goal/architecture/testing/success-criteria — never empty), then
`score assemble` (concat + trust header + **deploy-audit gate**). On audit FAIL: parse `ISSUE=`,
**re-draft** the offending section(s), **re-assemble once**; second FAIL → surface ISSUEs, stop.
On PASS: present the doc, done. (No parts, no teardown.)

### Stage 3 — escalation: preflight + batch-spawn
`score spawn-all <topic>` — preflight reserves N panes (`--art-dir <_score>`), then `Promise.all`
spawns N parts (`--target-pane`, `--cwd <repo>`), writing `spawn-results.tsv`. Stage-1 retry-once
(cold-start) and Stage-2 partial-success ("proceed degraded with N≥2" rewrites `roster.txt`) per
clone-wars' recovery contract. N<2 surviving → abort + redirect.

### Stage 4–5 — research (per part) + wait (with question loop)
N parallel `score research-send`; then N **background** `score research-wait`. Each part's prompt:
write `findings.md` (`## Claims` with `[citation]` prefixes; uncited claims dropped; zero-cited →
`malformed`). Per-part `FS=` ∈ `{ok,empty,missing,failed,timeout,malformed,question}`. **On each
completion notification**, read the last `FS=` from `research-<instrument>.txt`; on `FS=question`
run the **critical/non-critical relay** (D5): read `question-<instrument>.txt` + `findings.md`,
classify, **`AskUserQuestion`** (critical) or self-answer, `send --from maestro @reply`, `rm` the
`.done` sentinel, re-arm the **background** wait. Proceed only when **all** parts terminal.

### Stage 6 — N-way diff
`score diff` — first-match-wins membership bucketing (citation-overlap rule) → N=2 (`<a>_only`/
`<b>_only` + `## Agreed` in `diff.md`) or N=3 (`consensus.txt` + pair-only + singles). Frozen bucket
shapes.

### Stage 7–8 — cross-verify (per part) + wait
N `score verify-send` (scope = union of bucket files **not** containing this part; empty → `VS=skipped`,
no send) → N background `score verify-wait`. Part writes `verify.md` (`## Verdicts`, tags
**AGREE/DISPUTE/UNCERTAIN**). Same `VS=` state machine + question relay as Stage 5.

### Stage 9 — adjudicate + resolve PENDING
`score adjudicate` → `adjudicated-draft.md` (5 tiers). `cp` → `adjudicated.md`. **Maestro Reads it,
then for every `- PENDING:` line** reads the cited source, decides CONFIRMED/REFUTED/CONTESTED, and
**Edits** in place. Done when no `- PENDING:` remains (synthesize refuses otherwise).

### Stage 10 — multi-repo detection
If `--targets` set, skip (already materialized). Else `score detect-multi-repo` scans siblings vs
`adjudicated.md`. **0 hits** → `multi-repo.txt=single`. **1 hit** → **`AskUserQuestion`** Use `<slug>`
(→ `single-sub`) / hub-level (→ `single`). **2+ hits** → **`AskUserQuestion`** Use list / Edit /
single-repo (→ `multi` + `targets.txt`).

### Stage 11 — interactive per-section walk (D4)
`score synthesize` seeds the `.draft/<section>.md` (6 single / not the 2 multi extras). Section list
from `multi-repo.txt` (6 single / 8 multi: +execution-dag, cross-repo-notes between components and
testing). Resume via `walkSectionState`. **Per section:** Maestro **Reads** seed + `adjudicated.md`
+ part findings, drafts, **presents in chat**, **`AskUserQuestion` Approve / Revise / Skip** (Skip
omitted for the 4 critical sections), free-form Revise via follow-up, REVISE_COUNT cap (4) → force/
skip/abort fallback. Multi-repo: `architecture` drafts `### <slug>` per target; `execution-dag`
drafts a soft DAG (`emitSoftDag`) and **runs the DAG validator pre-check** before presenting
(parse FAIL → Revise / Force-Approve / Abort; no Skip).

### Stage 12 — assemble + deploy-audit gate
`score assemble` concatenates `.draft/*` (multi-repo header + 8 sections as needed), stamps the
trust header, runs the **deploy-audit gate**. On FAIL: parse `ISSUE=`, map via `auditIssueToSection`
(section → re-walk that one; `ASK` → AskUserQuestion which section; `header` → re-run Stage 10;
unknown → commit-failing/abort), `ATTEMPT++` up to `MAX_ATTEMPT_PER_SECTION`, then banner-commit
fallback. Loop until PASS.

### Stage 13 — drilldown (optional)
**`AskUserQuestion`** "drill deeper?" loop: subject / focus / which part(s) (N-aware option set) →
`score drilldown` (K≤2 per call; 3 via two parallel calls) → `_scratch/drilldown-<slug>-<inst>.md`
→ summarize. Drilldowns persist into the archive.

### Stage 14a–16 — forensics + teardown + archive + present
`score`'s forensics-capture (best-effort; scrapes `ISSUE=`/error/question/non-zero-rc/error-state →
a `~/.consort/forensics/...` file) → **Maestro appends a `## Maestro reflection`** (idempotent) →
`coda` teardown (FINE banner, all roster parts) → `archiveTopic(topic, "score")` → **present** the
final doc + the **`perform` handoff pointer** ("run `/consort:perform <doc>` once perform ships").

---

## 6. State layout

```
<state-root>/state/<repo-hash>/<topic>/
├── <instrument>-<model>/        # per-part IPC dir (inbox/outbox/status/pane) + findings.md / verify.md
└── _score/
    ├── topic.txt  roster.txt  skill.txt
    ├── multi-repo.txt  targets.txt        # targets.txt only when single-sub|multi
    ├── preflight-panes.txt  spawn-results.tsv
    ├── research-<instrument>.txt  research-<instrument>.done   # OFFSET= … FS=
    ├── verify-<instrument>.txt    verify-<instrument>.done     # OFFSET= … VS=
    ├── question-<instrument>.txt                                # only on FS/VS=question
    ├── diff.md  <inst>_only_items.txt  consensus.txt  <a>+<b>_only.txt
    ├── verify-claims-<instrument>.txt
    ├── adjudicated-draft.md  adjudicated.md
    ├── audit.log
    ├── design-doc/
    │   ├── .draft/<section>.md
    │   └── <YYYY-MM-DD>-<slug>-design.md     # CANONICAL output (fast-path + escalation)
    └── drilldowns/_scratch/drilldown-<slug>-<instrument>.md
```
All `_score/` writes use `atomicWrite` (tmp-in-**same-dir** + rename). Forensics lives outside the
art dir (global `~/.consort/forensics/`) and survives teardown. The archive moves `_score/` (incl.
drilldowns) to `archive/<repo-hash>/<topic>/_score-<ts>`.

---

## 7. The deploy-audit gate (ported byte-identical)

`core/audit.ts` `auditDoc(docText)` ports `cw_deploy_audit_doc` — a pure read-only linter over the
assembled doc, emitting `VERDICT=PASS|FAIL` + `ISSUE=<code>` lines:
- **Mandatory sections** present + non-empty: `## Goal`, `## Architecture`, `## Testing`,
  `## Success Criteria` (→ `no_goal_section`/`no_arch_section`/`no_testing_section`/`no_success_section`).
- **Marker scan**: `\bTBD\b` / `\bTODO\b` (lowercase `todo` allowed) / "fill in later" / "to be
  determined" → `tbd_marker`/`todo_marker`/`fill_in_later_marker`/`to_be_determined_marker`; the
  v0.62.3 hallucinated-placeholder block-list (`<archive|previous-*|archived-*|source-*>`) →
  `unresolved_placeholder`.
- **Target header** (singular `**Target Sub-Project:** <slug>` only): slug must match `SLUG_REGEX`
  and be single → else `target_subproject_when_invalid`.
- **Execution DAG** (strict `^## Execution DAG$` heading): `checkDagSection` must pass → else
  `execution_dag_not_parseable`.

`auditIssueToSection` (`core/scoreWalk.ts`) maps each `ISSUE=` to a walk section / `ASK` / `header` /
`""`. The **same** `core/dag.ts` validator powers the Stage-11 execution-dag pre-check and the
Stage-12 audit — they must agree exactly. Regexes are copied byte-for-byte from clone-wars; the
rewrite does **not** tighten them.

---

## 8. Multi-repo & the execution-DAG (producer + validator only)

`core/multirepo.ts` `detectMultiRepo(cwd, corpus)`: scan first-level sibling dirs for `CLAUDE.md`
(pref) / `AGENTS.md`; keep those whose slug is a case-insensitive substring of `corpus`
(=`adjudicated.md`); emit TSV `<slug>\t<abs-marker>`. `multi-repo.txt` ∈ `{single, single-sub, multi}`;
`targets.txt` present iff `single-sub|multi`.

`core/dag.ts`:
- `emitSoftDag(rows)` — TSV `<step>\t<repo>\t<desc>\t<deps-csv|none>` → `N. <repo> — <desc>
  (depends on M, N)` (em-dash U+2014; deps `M, N`). **No path column on emit.**
- `parseDagLine(line)` — the consumer grammar (optional `(/abspath)` group on parse only); malformed
  numbered line → error.
- `checkDagSection(docText)` — awk-style range extraction of `## Execution DAG` body; each numbered
  line must `parseDagLine`; section absent or no numbered lines → ok.

score **validates** its DAG to a temp dir and discards. The **executor** (`topological`/waves/
`unique_repos`/`fan_in_repos`, `dag-waves.txt`/`dag-edges.txt`, `target_cwd` redirection) is
`perform`'s and is **not** built here.

---

## 9. Turn machinery (multi-part, two-phase, question loop)

`core/scoreTurn.ts` generalizes solo's offset discipline to N parts × 2 phases. For each phase
(research, verify): capture `outboxOffset` per part before send; `outboxWaitSince(i,m,t,offset,
[done,error,question],consultTimeout(kind))` (research=600s, verify=300s; ×`timeout_multiplier`);
`classifyTurn` → append `FS=`/`VS=`; write `.done` sentinel. **Question is transient** — the topic
proceeds only when every part holds a terminal value. Re-arm on `question` is **background**, never
foreground, and never re-sends the original prompt (the offset is bumped past the question event).
The research/verify prompt composers are **new** (research = "write `findings.md` with `[citation]`
claims"; verify = "tag AGREE/DISPUTE/UNCERTAIN") — they do **not** reuse solo's implement/fix
composers. `composeRound`-style blocker text is re-derived locally (solo's constants are private).

---

## 10. Naming & rebrand compliance

- Renames: `consult`→`score`; `_consult/`→`_score/`; worker noun → **part**; conductor sender →
  **maestro**; `commander`→**instrument**; `--use-force`→`--ensemble`; `troopers.txt`→`roster.txt`;
  the "Source:" trust label uses the **actual auto-picked instrument names** (e.g. `viola+cello
  cross-verified (N=2)`), built dynamically — never the clone-wars `rex+cody` literals.
- **Frozen — never renamed:** events `ready/ack/progress/done/error/question`; `END_OF_INSTRUCTION`;
  JSON fields `ts/summary/note/message/task_summary/instrument/model`; the `contracts.yaml`
  `consult` block + `consult_validated` key (the word "consult" survives in `ConsultKind`/
  `consultTimeout`/`consult_validated` — it is frozen plumbing, only the *command* is renamed);
  state filenames; `CLAUDE_CODE_SESSION_ID`.
- The `Path` trust-label vocabulary is fixed: `fast | escalated-from-flag | escalated-from-signals`
  (phrasing trimmed; `escalated-from-phrasing` unused).
- The stale-token gate (`tests/stale-tokens.test.ts`) must stay green — scrub every
  `trooper`/`commander`/`master-yoda`/`cw_`/`clone-wars`/`@cw_`/`MISSION ACCOMPLISHED` token from
  any prose copied out of the consult source. Fix the file; never weaken the gate.

---

## 11. Testing strategy

Foundation conventions: pure-logic unit tests; **no real subprocesses** (tmux/spawn/send tested as
arg-array builders — live behavior is the dogfood); `CONSORT_HOME` = fresh temp dir per test.

- **`core/audit.ts`** — each ISSUE code against fixtures (mandatory sections, the TBD/TODO
  word-boundary + lowercase-todo allowance, the placeholder block-list, target-header validity,
  DAG-section pass/fail); PASS on a complete doc.
- **`core/dag.ts`** — `emitSoftDag`↔`parseDagLine` **round-trip** (the em-dash + deps asymmetry),
  `checkDagSection` (absent / no-numbered-lines → ok; malformed → fail), cycle detection.
- **`core/multirepo.ts`** — sibling scan + substring match + marker detection; corpus fallback.
- **`core/scoreDoc.ts`** — 6/8 section model + ordering; assembler header (single/single-sub/multi);
  `_(missing draft)_` fallback; trust-header vocabulary.
- **`core/scoreWalk.ts`** — `walkSectionState` (`_(skipped)_` detection, alpha sort);
  `auditIssueToSection` full mapping.
- **`core/scoreTurn.ts`** — `FS=`/`VS=` classification from fixture outbox + offset; the
  round-2-doesn't-see-round-1 case; question capture; terminal-state gate.
- **`core/scoreDiff.ts` / `scoreAdjudicate.ts`** — N=2 and N=3 bucket shapes; the 5-tier classifier
  (`_classify` truth table) byte-checked vs clone-wars fixtures.
- **`score init`** — roster load (active→available→validated), N<2 redirect, N>3 cap, `--targets`
  validation, in-flight refusal, scaffold.
- **Stale-token gate** clean.

**Quality gates:** `npm run typecheck`, `npm run lint`, `npm run test` green; `npm run build` +
commit the refreshed `dist/consort.cjs`.

---

## 12. Acceptance criteria

1. All unit tests green; `tsc --noEmit` + eslint + stale-token gate clean; `dist/consort.cjs` rebuilt
   and in sync.
2. **Live dogfood** (the gate) under isolated `CONSORT_HOME`, appended to `DOGFOOD.md`:
   - **fast-path**: a bounded topic → audit-passing deploy-schema doc, no parts.
   - **escalated single-repo**: a real topic → N=2/3 live parts → research → diff → verify →
     adjudicate → walk → audit-pass → drilldown → teardown → doc.
   - **multi-repo**: a topic spanning sibling repos → detect → 8-section walk → a **parseable
     Execution DAG** → audit-pass.
3. No frozen protocol term renamed; no stale clone-wars token shipped; the emitted DAG validates
   against the ported parser (producer/consumer grammar round-trips).

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| The interactive walk is a long, branchy directive the conductor may drift on (the v0.62 serialization lesson) | Mechanical steps (`synthesize`/`assemble`/`walkSectionState`/DAG pre-check) live in the CLI; the directive only does Read/Write/AskUserQuestion. State re-derived from disk each block (D10). The critical-section guard + revise cap are enforced by directive structure + the audit gate's bounce. |
| Multi-part question loop subtle (re-arm background, terminal-state gate, per-part routing) | A single `core/scoreTurn.ts` owns the `FS=`/`VS=` convention + `.done` sentinel; unit-tested; the relay re-arms in background and never re-sends. |
| DAG producer/validator must round-trip exactly (em-dash, deps, optional path group) | One `core/dag.ts` powers emit + the Stage-11 pre-check + the Stage-12 audit; round-trip unit test locks the asymmetry. |
| Building perform-coupled logic (audit gate, DAG) ahead of perform | The audit gate is a self-contained linter (verified portable); the DAG *executor* is explicitly **not** built — only the validator. perform reuses `core/dag.ts` later. |
| Bending solo's `turn.ts` to fit and breaking the shipped `solo` | `score` builds `core/scoreTurn.ts` fresh on the `ipc` primitives; reuses only `classifyTurn`/`parseOffset`. |
| Borrowed consult prose leaks a stale token | Stale-token gate at close-out; scrub on the way in. |

---

## 14. Implementation phasing (for writing-plans — multiple plans)

This command is too large for one plan. writing-plans produces a **phased plan set** (like the
foundation's 3 plans):

- **Phase A — pure core** (no directive/spawn): `core/audit.ts`, `core/dag.ts`, `core/multirepo.ts`,
  `core/scoreDoc.ts` (section model + assembler), `core/scoreWalk.ts`, `core/scoreDiff.ts`,
  `core/scoreAdjudicate.ts`, `core/score.ts` (slug/paths/parse/renderers); `archiveTopic` `"score"`
  union. Full unit coverage. Ships nothing user-facing; highest-value, lowest-risk foundation.
- **Phase B — init + fast-path** (single-repo, no parts): `score init`, `score assemble`, and
  `commands/score.md` Stages 0–2. Dogfood: a fast-path audit-passing doc. Independently shippable.
- **Phase C — escalation spawn + research/diff**: `score spawn-all` (preflight + `Promise.all` +
  recovery), `score research-send`/`research-wait` (`core/scoreTurn.ts`), `score diff`. Dogfood:
  live parts produce findings + buckets.
- **Phase D — verify + adjudicate + synthesize + walk + audit** (single-repo): `score verify-send`/
  `verify-wait`, `score adjudicate`, `score synthesize`, the Stage-11 walk + Stage-12 audit-retry.
  The heart; largest phase. Dogfood: full escalated single-repo run.
- **Phase E — multi-repo + execution-DAG**: `score detect-multi-repo`, the 8-section walk path, the
  execution-dag pre-validation gate + Force-Approve, cross-repo notes, the multi-repo header +
  `header`-ISSUE bounce. Dogfood: a real multi-repo topic with a parseable DAG.
- **Phase F — drilldown + forensics + teardown + present + full dogfood**: `score drilldown`,
  forensics capture + reflection, `coda` teardown, `archiveTopic("score")`, `present` + the perform
  handoff. Final acceptance dogfood (fast-path + escalated single-repo + multi-repo) + stale-token gate.
