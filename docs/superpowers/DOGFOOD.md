# Consort Foundation — Dogfood Result

**Date:** 2026-05-29 · **Branch:** `feat/foundation` · **Verdict:** ✅ PASS

The foundation sub-project's acceptance gate (Plan 03 Task 24): a live
`spawn → send → collect → roster → coda` against a real `codex` pane in tmux,
under an isolated `CONSORT_HOME=/tmp/consort-dogfood`.

## Run

| Step | Result |
|---|---|
| `soundcheck` | `Verdict: OK — ready to spawn (4/4 providers available; 0 warnings)` |
| `spawn violin codex dogfood-foundation` | pane `%20447`, border label `strings-violin:codex:dogfood-foundation`; emitted `{"event":"ready","ts":"…","instrument":"violin","model":"codex"}`; rc=0 |
| `send violin dogfood-foundation "…"` | inbox written (`From: maestro`) + pane nudged; rc=0 |
| `collect violin dogfood-foundation` | `{done}` received; rc=0 |
| `roster` | `violin  codex  dogfood-foundation  %20447  idle (done)` |
| `coda violin dogfood-foundation` | graceful FINE banner → one 9s wait → killNow → `archived violin-codex-20260529T063726Z`; rc=0 |

Full outbox sequence (the wire protocol, end-to-end):
```jsonl
{"event":"ready","ts":"2026-05-29T06:35:48Z","instrument":"violin","model":"codex"}
{"event":"ack","task_summary":"Report current working directory, then emit done event.","ts":"…"}
{"event":"progress","note":"/home/liupan/CC/consort","ts":"…"}
{"event":"done","summary":"Current working directory reported: /home/liupan/CC/consort","ts":"…"}
```

Post-teardown: part dir archived, topic dir `rmdir`'d, pane killed. The `instrument`
key (Tier-2 rename) is live in the emitted events.

## Notes / findings surfaced by the dogfood

- **soundcheck global-root bug** (fixed, commit `5182d21`): `soundcheck` copied config
  into `globalRoot()` before ensuring that directory existed (it only `stateEnsure()`'d
  the project root). Fixed to ensure the global config root early; regression test added.
- **codex 0.135.0 directory-trust prompt** (environment prerequisite, not a consort
  defect): codex gates first-run per repo with a trust picker that `--dangerously-bypass-
  approvals-and-sandbox` does not cover. The spawn mechanics (pane split, launch, nudge,
  ready-poll, and on the first attempt the timeout → `failure-reason.txt` → `…-FAILED`
  archive → exit 1) all worked correctly; `{ready}` arrived once `/home/liupan/CC/consort`
  was added to codex's trusted projects.

## Verification context

- 102 vitest unit tests green; `tsc --noEmit` + eslint clean; stale-token gate clean.
- 12-agent adversarial verification vs. clone-wars caught + fixed a real event-precedence
  bug in `outboxWait` (commit `cc6dc6d`: events resolve in argument order, not file order).

---

# Consort `solo` — Dogfood Result

**Date:** 2026-05-29 · **Branch:** `feat/solo` · **Verdict:** PASS

The first high-level command (`solo`, porting clone-wars `strike`): a live
`init → brief → branch → spawn → single turn → verify → finish → coda → summary` against a
real `codex` part in tmux, under an isolated `CONSORT_HOME=/tmp/consort-solo-dogfood` and a
throwaway target repo `/home/liupan/CC/solo-dogfood-tmp` (run with `--finish`).

## Run

| Step | Result |
|---|---|
| `solo init "add hello file --finish"` | rc 0; printed `SLUG=add-hello-file INSTRUMENT=tuba PROVIDER=codex FINISH=yes TARGET=...`; scaffolded `_solo/{execute/}` + topic/provider/instrument/timing/finish files |
| brief | conductor wrote `_solo/task-brief.md` (Goal / Acceptance check) |
| `solo branch add-hello-file` | clean tree → no WIP commit; created `feat/solo-add-hello-file` (base `f62854d1`); recorded target_cwd/start-branch/branch-base/branch |
| `spawn tuba codex add-hello-file --cwd <tgt>` | pane `%20448`, label `brass-tuba:codex:add-hello-file`; `{"event":"ready",...,"instrument":"tuba","model":"codex"}`; rc 0 |
| `solo turn-send … 1` | composed round-1 prompt, `OFFSET=82` recorded, inbox written + pane nudged |
| `solo turn-wait … 1` | `TS=ok` appended; codex implemented `hello.txt`, ran the test, committed `feat: add hello file` |
| `solo detect-test <tgt>` | `bash tests/run.sh` |
| verify | `PASS (bash tests/run.sh)`; diff `1 file changed, 1 insertion(+)` |
| `solo finish add-hello-file` | `FINISH=yes`, no remote → `finishBranch` → `keep`/`kept`; restored target to `master` |
| `coda tuba add-hello-file` | graceful FINE banner → 9s wait → killed pane `%20448` → `archived tuba-codex-20260529T083827Z` |
| `solo summary add-hello-file` | `SUMMARY.md` `status: ok`, duration 259s, the full Result + Where-to-look sections |

Full outbox sequence (the wire protocol, end-to-end):
```jsonl
{"event":"ready","ts":"2026-05-29T08:35:23Z","instrument":"tuba","model":"codex"}
{"event":"ack","task_summary":"Create repo-root hello.txt with the required line, run tests, commit the change.","ts":"…"}
{"event":"progress","note":"…repo appears to have only README.md so far.","ts":"…"}
{"event":"progress","note":"Added hello.txt and tests/run.sh exited 0; preparing the conventional commit.","ts":"…"}
{"event":"done","summary":"Committed hello.txt with the required hello from solo line; tests/run.sh passes.","ts":"…"}
```

## Findings / fixes surfaced

- **Adversarial verification (6-agent, pre-dogfood)** vs the clone-wars `strike`/`deploy` spec:
  slug pipeline (5000-input differential fuzz), `preSnapshot`, and `finishBranch` (arg arrays,
  outcome tokens, always-restore) all **fidelity-confirmed**. It caught one **behavioral bug**:
  `turnWaitWith` *appends* a `TS=` line per wait, so after a question→re-arm cycle `turn-1.txt`
  holds multiple `TS=` lines; the directive must read the **last** one. Fixed (commit `3511af7`:
  `grep '^TS=' | tail -1`, matching `strike.md`).
- **SUMMARY archive line** (found by this dogfood): `SUMMARY.md` showed `Archived state: (not
  archived)` because nothing recorded `_solo/archived-path.txt`. Fixed (commit `c192c22`): the
  directive now captures `coda`'s reported archive path before `summary`, mirroring `strike`.
- **Documented intentional deviations** (verified, not bugs): the `args.ts` arg-fault rc legend
  is consort-internal (rc 2) and differs from strike's rc 1, but is consistent across consort
  commands and the missing-file terminal rc still coincides (1); the done-vs-error within-slice
  tie-break uses the foundation's pinned argument-order precedence and is unreachable in practice
  (a turn emits exactly one terminal event).

## Verification context

- 150 vitest unit tests green (`solo-core` / `solo-gitwork` / `solo-turn` / `solo-cmd` added);
  `tsc --noEmit` + eslint + stale-token gate clean; `dist/consort.cjs` rebuilt + committed.
- Per-task two-stage review (spec compliance → code quality) across 6 phases; one Important
  review finding fixed (init made deterministically testable so CI without `codex` still covers
  the happy path).

---

# Consort `soundcheck` roster-picker — Dogfood Result

**Date:** 2026-05-29 · **Branch:** `feat/soundcheck-roster` · **Verdict:** PASS

The provider roster-picker (port of clone-wars `medic` v0.18.0): `soundcheck` gains a curated
`providers-active.txt` selection layer that `/consort:score` will read via the existing
`activeProvidersPath()` resolver. Dogfooded by driving the real CLI subcommand sequence (the
mechanical half the directive orchestrates) under an isolated `CONSORT_HOME`; the interactive
`AskUserQuestion` menu is conductor-side prose validated by the Phase 3 directive review.

## Run

| Step | Result |
|---|---|
| `soundcheck` (health) | `Verdict: OK — ready to spawn (4/4 providers available; 0 warnings)`; wrote `providers-available.txt` = `codex agy claude opencode` |
| `soundcheck roster-plan` (no prior) | `{"detected":["codex","agy","claude","opencode"],"prior":[],"dropped":[],"decision":"prompt","skipped":[]}` |
| `soundcheck roster-set codex claude` | `active set: codex, claude (written to providers-active.txt)`; rc 0; file has the two header lines + `codex` / `claude` |
| `soundcheck roster-plan` (re-run) | `"prior":["codex","claude"]` — the data the directive uses to recommend "Keep current selection" |
| `soundcheck roster-set` (empty) | `[FAIL] must select at least one provider; selection unchanged` (stderr); rc 1; active file untouched |
| `soundcheck roster-set fooai` (invalid) | `[FAIL] not in the detected validated set: fooai; selection unchanged`; rc 1; no write |
| stale-drop (`claude` no longer detected, prior had it) | `"detected":["codex","agy","opencode"],"prior":["codex"],"dropped":["claude (no longer detected)"],"decision":"prompt"` |
| auto path (1 validated detected) | `"decision":"auto","auto":"codex"` |
| skip path (0 validated; unknown provider present) | `"decision":"skip","skipped":["fooai (consult_validated: false)"]` |
| resolver | after a write, `providers-active.txt` exists at `$CONSORT_HOME`; `activeProvidersPath()` returns it over `providers-available.txt` (logic unit-tested in `paths.test.ts`) |

All five acceptance checks (write · re-run keep-current · stale drop · empty-set guard · resolver)
plus the `auto`/`skip` decision branches behave exactly as specified.

## Findings / fixes surfaced

- **Code-review cleanup (Phase 2, commit `d16c6ad`)**: the first `roster-plan` cut filtered
  `instrumentConsultValidated` twice over the available list (2×N un-memoized `contracts.yaml`
  parses) and duplicated the detected-filter predicate between `roster-plan` and a
  `detectedValidatedProviders()` helper. Consolidated into a single-pass `partitionAvailable()`
  (`{available, detected, skipped}`) + lazy `availablePath()`/`activePath()` helpers; output and
  ordering byte-identical, all tests green.
- **Phase 1 DRY (commit `3b07571`)**: extracted `formatProviderFile(providers, isoStamp, subtitle)`
  so the `providers-available.txt` and `providers-active.txt` writers share one template; the
  available-file output stayed byte-identical (verified by the unchanged `soundcheck.test.ts`).
- No behavioral bugs found in the dogfood — the decision matrix and guards matched the spec on the
  first run.

## Verification context

- 167 vitest unit tests green (`providers` + `soundcheck-roster` suites added, 16 new tests);
  `tsc --noEmit` + eslint + stale-token gate clean; `dist/consort.cjs` rebuilt (635.7kb) + committed.
- Per-phase two-stage review (spec compliance → code quality) across Phases 1–3; one
  Approved-with-minors finding fixed (the single-pass partition above). The `medic` → `soundcheck`
  rebrand kept the frozen `consult_validated` contracts key; no stale clone-wars tokens shipped.

---

# Consort `score` — Phase B (fast-path) Dogfood Result

**Date:** 2026-05-29 · **Branch:** `feat/score` · **Verdict:** PASS

The first user-facing slice of `score` (full-parity consult): the **Maestro fast-path** —
`init → route → draft 6 deploy-schema sections → assemble + deploy-audit gate → present`, no parts
spawned. Driven by the controller (the fast-path is Maestro-solo, so no tmux/parts needed) under an
isolated `CONSORT_HOME=/tmp/consort-score-dogfood`, exercising the real CLI subcommands the directive
orchestrates. (Escalation, the interactive walk, multi-repo, and drilldown arrive in Phases C–F.)

## Run

| Step | Result |
|---|---|
| `soundcheck` | `Verdict: OK — ready to spawn (4/4 providers available; 0 warnings)`; wrote `providers-available.txt` = `codex agy claude opencode` |
| `score init "document how consort derives the repo hash…"` | `[WARN] capping the ensemble to the first 3`; rc 0; `TOPIC=document-how-consort N=3 ENSEMBLE=no MODE=single`; roster `trumpet:codex / viol:agy / harp:claude`; scaffolded `_score/design-doc/.draft/` |
| draft 6 sections | Maestro wrote `.draft/{problem,goal,architecture,components,testing,success-criteria}.md` from real research (consort's `repoHash` derivation, cited to `src/core/paths.ts:30` + `tests/paths.test.ts`) |
| `score assemble document-how-consort` | `audit PASSED`; rc 0; wrote `design-doc/2026-05-29-document-how-consort-design.md` (clean `# Title` + blank-line-separated deploy-schema sections) + `audit.log` (`VERDICT=PASS`) |
| audit-retry (heading-less `goal.md`) | `ISSUE=no_goal_section` to stderr; rc 1; `audit.log` = `VERDICT=FAIL` + `ISSUE=no_goal_section` |
| restore `## Goal` → re-assemble | `audit PASSED`; rc 0 |

All Phase B acceptance checks pass: init (roster load + 3-cap + scaffold), the fast-path draft →
assemble → audit-PASS, and the audit-FAIL → `ISSUE=` → re-draft → PASS retry loop.

## Findings / fixes surfaced

- **Plan-test defect (spec compliance review):** the plan's `assemble` FAIL test deleted `goal.md`,
  but a *missing* draft makes `assembleDoc` emit a `## Goal\n\n_(missing draft)_` placeholder heading
  that *satisfies* the audit's `^##\s+Goal\b` check (byte-faithful: clone-wars' walk-assemble emits
  the same placeholder + deploy.sh uses the same regex), so a missing draft PASSES. The frozen
  Phase-A behavior was kept; the test was corrected to a heading-less `goal.md` (the realistic
  mis-draft the retry loop handles) — confirmed in the dogfood (heading-less → `no_goal_section`).
- **`--targets` honesty (code quality review):** a `--targets` fast-path run would have produced a
  `multi` doc with placeholder DAG/cross-repo sections that pass the audit — silently under-serving
  multi-repo intent. The directive now **stops** on `--targets` ("multi-repo needs the Phase E
  ensemble pipeline; re-run without `--targets`"), keeping `score init` faithful for Phase E reuse.
- **Section spacing:** present sections now end with one trailing newline so the assembled doc has a
  blank line between sections (matching the behavioral source + the missing-draft branch).

## Verification context

- 223 vitest unit tests green (`score-init` / `score-assemble` suites + extended `instruments` /
  `score-core` added; Phase A's `audit`/`dag`/`multirepo`/`scoreWalk`/`scoreDoc`/`score-core` already
  green); `tsc --noEmit` + eslint + stale-token gate clean; `dist/consort.cjs` rebuilt + committed.
- Per-task two-stage review (spec compliance → code quality) across Phases A + B; two
  Approved-with-minors findings fixed (the plan-test correction + the `--targets` stop). Escalation,
  the interactive design walk, multi-repo + execution-DAG, and drilldown remain Phases C–F.

# Consort `score` — Phase C (escalation: spawn-all → research → diff) Dogfood Result

**Date:** 2026-05-29 · **Branch:** `feat/score` · **Result:** PASS (full pipeline end-to-end with two
live model parts; two latent foundation tmux bugs surfaced + fixed)

## Run

- Isolated `CONSORT_HOME=/tmp/consort-dogfood-phaseC`, `CLAUDE_PLUGIN_ROOT=$PWD`, inside tmux.
  Seeded `providers-active.txt` with two `consult_validated` providers (codex, claude).
- Topic: `consort outbox wait protocol` → slug `consort-outbox-wait`, `N=2`, parts assigned
  **timpani:codex** + **violin:claude** (the conductor drove the CLI subcommands the directive runs).
- `score init --ensemble` → rc 0; printed `TOPIC/N/ENSEMBLE/MODE/ART/PART=` (the new `ART=` line).
- **Stage 3** `score spawn-all consort-outbox-wait` → rc 0, `2/2 parts ready`; `spawn-results.tsv`
  written (`<instrument>\t<provider>\t0\t`). Both parts bootstrapped into preflight panes and emitted
  `ready`.
- **Stage 4** `score research-send` ×2 → each wrote `research-<inst>.txt` (`OFFSET=85`), the composed
  findings prompt, and nudged the part.
- **Stage 5** two background `score research-wait` → both returned `FS=ok` with `.done` sentinels; no
  question fired this run. findings: timpani 12 cited claims, violin 16 cited claims.
- **Stage 6** `score diff consort-outbox-wait` → rc 0; `diff.md` with `## Agreed` / `## Timpani-only`
  (6) / `## Violin-only` (10) + the two `*_only_items.txt` bucket files.

## Findings / fixes surfaced

- **`respawn()` returned an empty pane id (foundation bug, fixed `core/tmux.ts`).** `respawn-pane -t
  <pane>` reuses the same pane and prints nothing, so `respawn` returned `""`. Every caller
  (`paneMetaWrite`/`paneLabelSet`/`paneSend`) then used a blank pane id: `pane.json` stored
  `pane_id=""` (→ `research-send` failed with "pane.json missing"), and under `spawn-all`'s concurrent
  `Promise.all` both identity nudges mis-routed to tmux's *active* pane (user observed both nudges
  hitting the claude pane, codex none). The `--target-pane` path is new-to-Phase-C (`solo` never used
  it), so this latent foundation bug surfaced on score's first live `spawn-all`. Fix: `respawn` returns
  the target pane id. Re-run confirmed each pane gets its own identity nudge + correct `pane.json`.
- **Pane labels never rendered (foundation gap, fixed `core/tmux.ts` + `spawn.ts`).** `spawn` stamped
  `@cs_label`/`@cs_color`/`@cs_label_fmt` per pane but nothing set `pane-border-status`/`-format` to
  display them, so panes showed the raw TUI title (`consort` / the claude review prompt). A user's
  leftover tmux.conf reading the old `@cw_label_fmt` key compounded it (consort writes `@cs_`, so the
  border fell back to `#{pane_title}`). Fix: `spawn` now sets a `pane-border-format` reading
  `@cs_label_fmt` (rebranded port of the bash predecessor's convention; falls back to `pane_title` for
  unlabeled panes like the conductor). Label format unchanged: `section-instrument:model:topic`,
  per-section colored. Applied live → the running panes immediately showed their colored labels.

## Verification context

- 285 vitest unit tests green (added `score-turn` 16, `score-spawn` 5, `score-escalation` 15, the
  `score-init` `ART=` case, the `tmux paneBorderArgs` case); `tsc --noEmit` + eslint + stale-token
  gate clean; `dist/consort.cjs` rebuilt + committed.
- The `FS=` research state machine, the offset-capture/bump discipline, the spawn-batch rc 0/1/2
  contract, and the N-way diff bucketing all exercised with real codex + claude parts. Cross-verify →
  adjudicate → design walk → audit (Phase D), multi-repo + execution-DAG (Phase E), and
  drilldown/forensics/teardown/present (Phase F) remain. Both parts torn down via `coda` (archived).

# Consort `score` — Phase D (verify → adjudicate → walk → audit) Dogfood Result

**Date:** 2026-05-29 · **Branch:** `feat/score` · **Result:** PASS (full escalated single-repo run with
two live model parts → an audit-passing deploy-schema design doc)

## Run

- Isolated `CONSORT_HOME=/tmp/consort-dogfood-phaseD`, `CLAUDE_PLUGIN_ROOT=$PWD`, inside tmux; two
  `consult_validated` providers (codex, claude). Topic `consort verify scope` → slug
  `consort-verify-scope`, N=2, parts **cello:codex** + **clarinet:claude**.
- Phase C stages (proven): `spawn-all` (2/2 ready) → `research-send`×2 → `research-wait`×2 (both
  `FS=ok`; cello 5 / clarinet 13 single-only claims) → `diff` (Agreed + Cello-only 5 + Clarinet-only 13).
- **Stage 7-8** `verify-send`×2 (cello verifies clarinet's 13, clarinet verifies cello's 5 — neither
  skipped) → background `verify-wait`×2 → both `VS=ok`. No question fired.
- **Stage 9** `adjudicate` → `adjudicated-draft.md` (4 sections). The parts produced substantive,
  cross-confirmed claims about consort's own verify-scope code. **One `- PENDING:`**: cello DISPUTED a
  Stage-8 claim, correctly noting `Not-verified` marking is N=2-only (`adjudicateN2` reads `input.vs`;
  `adjudicateNge3` classifies via the verdict map and ignores it). Maestro confirmed against
  `src/core/scoreAdjudicate.ts` and **moved it to `## Contested`** → `synthesize` proceeds.
- **Stage 11** `synthesize` (6 seeds) → `walk-state` → Maestro drafted + Approved all 6 sections.
- **Stage 12** `assemble` → audit **PASS** (`VERDICT=PASS`) → `2026-05-29-consort-verify-scope-design.md`.
  Forced-FAIL check: a `TODO` marker in `testing.md` produced `ISSUE=todo_marker` + `SECTION=ASK`
  (the directive's re-walk router), then removing it re-assembled to PASS. Both parts `coda`-archived.

## Findings / fixes surfaced

- **Real, accurate cross-verification.** The two parts independently cited the correct files/lines for
  `verifyScopeFiles`/`verifyState`/`adjudicateRun` and cross-confirmed each other; the lone dispute was
  a genuinely sharp catch (the N=2-vs-N≥3 `Not-verified` asymmetry) that the adjudicate→PENDING flow
  surfaced for resolution exactly as designed. No code bug; the pipeline behaved.
- **`walk-state` can't distinguish a seed from an approved draft** (observation, not a bug): right
  after `synthesize` all six seeds report `approved` (the reader only flags `_(skipped)_`). This is
  byte-faithful to clone-wars `consult_walk_section_state`; the fresh walk drafts over the seeds
  regardless, and resume is best-effort. Noted for Phase F polish if desired.

## Verification context

- 305 vitest unit tests green (added `score-turn` verify cases, `score-core` `verifyScopeFiles`/`lastTag`,
  `score-doc` `synthesizeSeeds`, `score-escalation` verify-send/wait/adjudicate/synthesize/walk-state,
  `score-assemble` `SECTION=`); `tsc --noEmit` + eslint + stale-token gate clean; `dist/consort.cjs`
  rebuilt + committed.
- The `VS=` verify machine (incl. `VS=skipped` short-circuit), the verify-scope bucket selection, the
  N=2 adjudication tiers + PENDING resolution, synthesize seeding, the interactive walk, and the
  assemble + deploy-audit retry (with `SECTION=` routing) all exercised — single-repo end-to-end.
  Multi-repo + execution-DAG (Phase E) and drilldown/forensics/teardown/present (Phase F) remain.

# Consort `score` — Phase E (multi-repo detect → 8-section walk → Execution DAG → multi-assemble) Dogfood Result

**Date:** 2026-05-29 · **Branch:** `feat/score` · **Result:** PASS (focused new-surface dogfood —
exercises every Phase E addition end-to-end against the real `/home/liupan/CC` hub; the ensemble half
research→verify→adjudicate is unchanged from the Phase D dogfood, so it was not re-run)

## Run

Isolated `CONSORT_HOME=/tmp/consort-dogfood-phaseE` (seeded codex+claude), conductor cwd =
`/home/liupan/CC` (the workspace hub; siblings `clone-wars`/`consort`/`hermes-agent`/`iris-code`/`opencode`
carry a marker).

- **`init --targets` validation** — `init --targets clone-wars,consort` → rc 0, `multi-repo.txt=multi`,
  and a **TSV** `targets.txt` (`clone-wars\t/home/liupan/CC/clone-wars/CLAUDE.md` + `consort\t…`, realpath
  markers). `init --targets ghost` → **rc 1** ("target 'ghost' is not a sibling dir with
  CLAUDE.md/AGENTS.md under /home/liupan/CC"). (slug truncated to `cross-repo-spawn-gat`.)
- **`detect-multi-repo` (auto)** — against a seeded `adjudicated.md` mentioning both slugs → exactly
  **2 hits** (`clone-wars`, `consort`); the other 4 siblings' slugs aren't substrings of the corpus, so
  they're correctly excluded (the loose-substring escape hatch wasn't needed).
- **`emit-dag` → `check-dag`** — `dag-rows.tsv` (2 steps, `consort` depends on `clone-wars`) rendered to
  `## Execution DAG` with the em-dash + `(depends on 1)` suffix; `check-dag` PASS. Forced a hyphen onto
  step 1 → `check-dag` **rc 1** printing the malformed line `1. clone-wars - …`; `emit-dag` re-render →
  PASS (the Stage-11 Revise→fix loop).
- **8-section walk + multi-assemble** — drafted all 8 sections (architecture carries `### clone-wars`
  + `### consort` subsections; `cross-repo-notes` fresh) → `assemble` → **audit PASS**
  (`VERDICT=PASS`) with the plural `**Target Sub-Project(s):** clone-wars, consort` header and the
  8 sections in `SECTIONS_MULTI` order (Execution DAG + Cross-Repo Notes between Components and Testing).

## Findings / fixes surfaced

- **No code bugs.** Every Phase E piece behaved on first run (the heavy reuse of the already-tested
  `dag.ts`/`multirepo.ts`/`audit.ts`/`scoreDoc` paid off).
- **No executor leak (verified):** after the multi-assemble, `_score/` contains **no** `dag-waves.txt`
  / `dag-edges.txt` — score validates its DAG with `checkDagSection` only and never topo-sorts or
  computes waves (that is perform's job, out of scope). The DAG section's two numbered lines all
  `parseDagLine`.
- **Conductor must run from the hub:** `init --targets` validates against `repoRoot()` and
  `detect-multi-repo` defaults to `process.cwd()`, so the multi-repo conductor runs from the workspace
  hub (where the sub-project dirs are first-level siblings) — exercised here by running every command
  with cwd `/home/liupan/CC`. (`detect-multi-repo --cwd <hub>` also lets a non-hub conductor point at it.)

## Verification context

- 315 vitest unit tests green (added `multirepo` `validateTargets`, `score-core` `writeTargetsTsv`,
  `dag` `dagMalformedLines`, `score-escalation` `detect-multi-repo`/`emit-dag`/`check-dag`, updated
  `score-init` `--targets`); `tsc --noEmit` + eslint + stale-token gate clean; `dist/consort.cjs` rebuilt.
- The `--targets` validation + TSV writer, sibling-repo auto-detection (loose substring, marker
  precedence), the execution-DAG producer + draft-time conformance gate (with the forced-FAIL bounce),
  the 8-section multi walk (per-target architecture, cross-repo notes), and the multi-doc assemble +
  plural header + deploy-audit all exercised. Drilldown / forensics / `coda` teardown / `present`
  (Phase F) remain.

# Consort `score` — Phase F (drilldown → forensics → teardown → archive → present) Dogfood Result

**Date:** 2026-05-30 · **Branch:** `feat/score` · **Result:** PASS (focused new-surface dogfood; one
real-model fix surfaced + applied). This completes the `score` command (Phases A–F).

## Run

Isolated `CONSORT_HOME=/tmp/consort-dogfood-phaseF`. Two halves:

**Part A — forensics + reflection + archive (seeded, no live parts):** seeded an `_score` art dir with
four mechanical signals (an `audit.log` `ISSUE=`, a part dir's `outbox.jsonl` `error` event +
`status.json` `state=error`, a `spawn-results.tsv` rc≠0 row).
- `score forensics <topic>` → wrote `$CONSORT_HOME/forensics/<date>/<time>-score-<topic>.md` (verified
  **outside** the state tree — a sibling of `state/`), with YAML frontmatter (`n_findings_mechanical: 4`)
  + the 4 findings as `- **<source>** <key> _(source: part=…)_` bullets. `part=` labels, no stale tokens.
- Maestro appended `## Maestro reflection` (3 bullets); a second append **skipped** (idempotent on the
  exact header) — 1 header in the file.
- `score archive <topic>` → moved `_score` to `~/.consort/archive/<hash>/<topic>/_score-<ts>`,
  `finalizeArchived` stamped the part `status.json` to `state=archived` + `archived_ts` (verified), and
  the **forensics file still exists** post-archive (survives, as designed). (The topic dir lingered only
  because the seeded part wasn't torn down — in the real Stage 14b→15 order `coda` archives the parts
  first, leaving `_score` alone so the rmdir succeeds.)

**Part B — drilldown + teardown (one live codex part):** spawned `viola:codex`, gave it a design doc,
ran `score drilldown drilltest Architecture <dd> <focus> <doc> viola codex`.
- Round 1 returned "0/1 produced notes" — **a real fix, not a verb bug:** the part ack'd, read the
  source, and was still writing cited notes at ~110s when the **90s default timeout** fired. The verb
  mechanics were correct (it sent, captured the offset before send, waited `[done,error]`); the default
  was just too tight. **Fixed** (`fix(score)` commit): the drilldown timeout now defaults to
  `consultTimeout("research")` (~600s, the bash predecessor's `findings_timeout_s` default), still
  overridable via `CONSORT_DRILLDOWN_TIMEOUT_S`. The wait still returns the instant `done` appears, so the
  generous ceiling only bounds the hang case.
- Round 2 (post-fix, same section) → "1/1 parts produced notes" (rc 0) and demonstrated the **collision
  suffix** live: the second file landed as `drilldown-architecture-viola-2.md` (4551 B of cited notes)
  alongside the original `drilldown-architecture-viola.md`. Both carry real `[src/...:line]` citations.
- `coda viola drilltest` → archived the part, pane gone (the **FINE** banner teardown).

## Findings / fixes surfaced

- **Drilldown default timeout 90s → 600s (fixed).** A real codex drill turn (read the doc + write cited
  notes) routinely exceeds 90s; the flat 90 default diverged from clone-wars' `findings_timeout_s`
  (research-timeout) default. Now defaults to `consultTimeout("research")`, env-overridable. Surfaced
  and fixed mid-dogfood; round 2 passed cleanly.
- No other defects. Forensics is genuinely best-effort + outside the state tree; the reflection
  idempotency holds; the collision counter (`-2`) works against real files; `coda`/`archiveTopic` reuse
  behaves; `finalizeArchived` stamps `state=archived` before the move.

## Verification context

- 330 vitest unit tests green (added `forensics` scrapers/scrapeArtDir/captureArtDir, `score-core`
  `resolveDrilldownPath`, `score-turn` `composeDrilldownPrompt`/`drilldownState`, `score-escalation`
  `drilldown`/`forensics`/`archive`); `tsc --noEmit` + eslint + stale-token gate clean; `dist/consort.cjs`
  rebuilt + committed (the new `drilldown`/`forensics`/`archive` verbs ship in the bundle).
- Phase F built subagent-driven: 4 fresh implementers (forensics core / drilldown core / command verbs /
  directive) each through two-stage review (spec → quality), all approved. The `score` command (A–F) is
  now complete; `perform`/`prelude`/`rehearsal`/`playback` remain as separate future commands.

---

# Consort `perform` — Phase B (single-repo) Dogfood Result

**Date:** 2026-05-30 · **Branch:** `feat/perform` · **Verdict:** ✅ PASS (perform logic validated live)

Live single-repo run of the `perform` command against a throwaway non-plugin git repo
(`/tmp/perf-dogfood`, isolated `CONSORT_HOME`), a tiny audit-passing design doc, and real git/IPC.

## Run

| Stage | Result |
|---|---|
| `perform init` | ✅ rc 0; byte-perfect state files — `topic.txt` (no trailing `\n`, `od`-confirmed), `target_cwd.txt`/`provider.txt`/`multi-repo.txt` each `+\n`, `design.md` copied; `ROUTING=single PROVIDER=codex` |
| `perform pre-snapshot` | ✅ `baselines/main.tsv` with the exact key order + `state=clean` + `baseline_sha` |
| `perform branch` | ✅ created `feat/perform-perf-dogfood`, `perform-branches.tsv` + `branch-base.sha` recorded |
| `perform turn-wait 1` | ✅ read the `done` event from the real outbox, gated `ok` on the non-empty `verify-report-1.md` → `TS=ok` + `.done` sentinel |
| `perform scope-check` | ✅ correctly flagged `OOS_COUNT=2` (see finding below) — the drift-detection path |
| `perform summary` | ✅ real per-target block: branch-changed WARNING, `35ed8fd (clean) → 9cbb962`, "2 files changed, 7 insertions(+)", commit list |
| `perform finish keep` | ✅ `main → keep → kept`; feat branch preserved, repo restored to `master` |
| `coda` | ✅ tore down + archived the part dir, handling the already-dead pane gracefully |
| `perform archive` | ✅ moved `_perform` → `archive/.../_perform-<ts>` |

## Scope of the live run

The codex part-spawn itself was **blocked by an external-binary issue**, so the part's *completed
turn* (the implementation commit on the feat branch + `verify-report-1.md` + the `done` outbox event)
was stood in for by the conductor, and every `perform` verb downstream ran against the resulting real
git/IPC state. All of Phase B's new logic — the `turn-wait` state machine + verify-report gating,
`scope-check`, `summary`/`postSweep`/`formatSummaryBlock`, `finish`/`finishBranchAction`, and
`archive` — is validated live; `init`/`pre-snapshot`/`branch` ran fully live with no simulation.

## Findings / notes

- **`scope-check` OOS_COUNT=2 is correct, not a bug.** `extractComponentsPaths` parses the markdown
  **table** that `score` produces; the hand-written dogfood doc used a **bullet-list** Components
  section, so 0 paths were declared and both changed files were (correctly) flagged as drift. The
  table path is unit-covered (`tests/perform-scope.test.ts`); this run exercised the drift path. In a
  real `score → perform` flow the Components table covers the diff.
- **codex 0.135.0 directory-trust prompt blocks the live part-spawn (follow-up, not Phase B).** On an
  untrusted target dir, `codex --dangerously-bypass-approvals-and-sandbox` shows a "Do you trust the
  contents of this directory?" menu and never reaches `{ready}`; the frozen `spawn` primitive doesn't
  answer it, and auto-trusting via `~/.codex/config.toml` is off-limits (standing user constraint).
  This affects any `perform`/`score` dogfood whose target dir isn't already codex-trusted. Candidate
  follow-ups: have `spawn` handle the trust prompt, or run dogfoods against a codex-trusted dir.
- **Fixed a Phase-A defect during Phase B:** the `performTurn` BLOCKERS prompt referenced
  `bin/part-ask.sh`/`bin/inbox-ack.sh` (a byte-faithful port of deploy's bin scripts) — but consort
  parts emit events by appending JSONL directly to `outbox.jsonl`. Rewritten to instruct a direct
  `{"event":"question",...}` / `{"event":"ack",...}` append (Task B1).

## Verification context

- **528 vitest unit tests green** (+ the perform command/turn/git/wind-down suites); `tsc --noEmit` 0,
  eslint 0, stale-token gate (now scanning `commands/perform.md`) green; `dist/consort.cjs` rebuilt
  (740.7kb) + committed so `/consort:perform` dispatches.
- Phase B built subagent-driven: 3 implementers (B1 core extensions / B2a init+turn / B2b git+wind-down),
  each through two-stage review (spec → quality), all SPEC PASS / QUALITY APPROVED. Single-repo
  `perform` is complete; multi-repo DAG execution (Phase C) + verify/fix/finish (Phase D) remain.

---

# Consort `perform` — Phase C (multi-repo DAG) Dogfood Result

**Date:** 2026-05-30 · **Branch:** `feat/perform` · **Verdict:** ✅ PASS (multi-repo executor validated live)

2-repo / 2-wave run against a throwaway hub with two sibling sub-repos (`api/`, `web/`, each a real
`git init` + a commit + a `CLAUDE.md` marker) and a design doc with `**Target Sub-Project(s):** api,
web` + a `## Execution DAG` (`1. api — build`; `2. web — consume (depends on 1)`).

## Run

| Stage | Result |
|---|---|
| `perform init` | ✅ `ROUTING=multi`, `TARGET_CWD=<hub>`, `provider=codex` (hub no plugin.json) |
| `perform dag-parse` | ✅ `WAVES=2 STEPS=2`; `dag-waves.txt` = `1\t1\tapi\tnone\tbuild the lib` / `2\t2\tweb\tnone\tconsume it` (correct topological order), `dag-edges.txt` = `1\t2` |
| `perform multi-init <hub>` | ✅ `parts.txt` = `oboe\t<hub>/api\tcodex` / `viola\t<hub>/web\tcodex` (instruments in DAG first-occurrence order, per-repo provider), per-part `oboe/viola-branch-base.sha` = each sub-repo's HEAD |
| `perform pre-snapshot` | ✅ 2 clean; `baselines/oboe.tsv` + `baselines/viola.tsv` |
| `perform branch` | ✅ `feat/perform-perf-c` created in BOTH sub-repos; `perform-branches.tsv` 2 rows |
| `perform send-unit api` / `web` | ✅ prompt composition exact — api: "Step 1 of 2 … depend on: none (wave-1 root)"; web: "Step 2 of 2 … depend on: api" |
| `perform wave-wait <instr> codex` | ✅ read each part's `done` → `wave-<instr>.txt` `TS=ok`/`EVENT=done` + `.done` sentinel |

## Scope of the live run

`init → dag-parse → multi-init → pre-snapshot → branch` ran **fully live against real git** — the
multi-repo materialization (DAG → waves → one part per repo in DAG order → per-repo baseline + branch)
is byte-verified. The **wave dispatch** (`send-unit` per repo, `wave-wait` barrier per part) was
validated against real IPC by standing in for the parts' `done` events — the live `spawn` of each
sub-repo's part is blocked by codex 0.135.0's directory-trust prompt (Phase B finding; each sub-repo
cwd would need to be codex-trusted). `send-unit`'s `send` step failed (no live pane) but it writes the
per-repo prompt first, so the composition — the Phase C deliverable — is verified.

## Verification context

- **574 vitest unit tests green** (+ the dag-parse / wave-wait / multi-init / composeDagUnitPrompt /
  dagSectionBody suites); `tsc` 0, eslint 0, stale-tokens (incl. the rewritten `commands/perform.md`
  Stages 3a/3b/3z) green; `dist/consort.cjs` rebuilt (752.9kb) + committed.
- Phase C built subagent-driven: 3 implementers (C1 core / C2 dag-parse+wave-wait / C3
  multi-init+send-unit), each through two-stage review — all SPEC PASS / QUALITY APPROVED. Multi-repo
  **dispatch** is complete; cross-repo verify + per-repo fix-loop + per-repo finish (Phase D) remain
  (the `dagFanInRepos` "feels unsafe" heuristic is wired and unit-tested, ready for Phase D's
  cross-verify).

---

# Consort `perform` — Phase D (multi-repo verify/fix/finish COMPLETE) Dogfood Result

**Date:** 2026-05-30 · **Branch:** `feat/perform` · **Verdict:** ✅ PASS — `perform` is now complete
(single-repo + multi-repo, both paths end to end).

Same 2-repo / 2-wave hub as Phase C (`api/`, `web/` declared sub-repos), extended with one
**undeclared** sibling repo (`libx/`) and a non-repo dir (`docs/`) to exercise the adjacent-tree
(sibling) commit guard. Design doc carries a `## Components` **table** (`api/src.txt`, `web/src.txt`)
so multi-repo `scope-check` has declared paths. Parts are **simulated** (codex 0.135.0 directory-trust
blocker — Phase B/C finding); every consort verb ran **live against real throwaway git repos**.

## Run (every Phase D verb live)

| Stage / verb | Result |
|---|---|
| `init` → `dag-parse` → `multi-init` → `pre-snapshot` → `branch` | ✅ `ROUTING=multi`; `WAVES=2`; `parts.txt` = 2 instruments in DAG order; `feat/perform-perf-d` in both sub-repos (Phase C path, re-confirmed) |
| **`sibling-baseline <topic> <hub>`** | ✅ captured the one undeclared sibling `libx\t<sha>\tmain`; `api`/`web` excluded (declared), `docs` excluded (non-repo) |
| **`cross-signal <topic>`** | ✅ `WAVE_COUNT=2`, `FAN_IN_REPOS=` (linear), `SHARED_PATHS=src.txt` (touched by both parts), **`UNSAFE=1`** — shared-path trigger fired |
| **`sibling-verify <topic> <hub>`** | ✅ after a simulated rogue commit on `libx` main → `sibling-rogue.txt` per-commit TSV `libx\tf54d018\tlibx: rogue change` |
| **`sibling-rescue <topic> <hub>`** | ✅ `rescued libx`; **`feat/perform-perf-d-rescue` branch created** in libx; `sibling-rescue.txt` = `libx\trescued` |
| **`scope-check <topic>`** (multi-aware) | ✅ `diff-paths.txt` = `api/src.txt` / `web/rogue.txt` / `web/src.txt` (each prefixed `<repo>/`); `OOS_COUNT=1` → `scope-out-of-scope.txt` = `web/rogue.txt` (the out-of-scope stray) |
| `summary <topic>` | ✅ one per-repo block per part (branch, baseline/HEAD, diff stat, commit list) |
| **`finish-one <topic> <slug> keep`** (per repo) | ✅ both targets finished independently, **appended** to `finish-results.tsv` in order (`<instr>\tkeep\tkept` ×2; no truncation between calls) |
| `forensics` → `coda` → `archive` | ✅ forensics (no findings), archive stamped + moved; `coda` is a no-op here (parts simulated → no live panes to tear down) |

## Scope of the live run

The whole Phase D verb chain — sibling baseline/verify/rescue, the cross-repo unsafe heuristic, the
multi-repo-aware scope-check, and per-repo `finish-one` — ran **fully live against real git**, byte-
verifying: the undeclared-sibling exclusion (declared sub-repos + non-repos skipped), the rogue-commit
per-commit TSV, the two-phase revert-and-replay rescue (a real `feat/perform-<topic>-rescue` branch),
the `<repo>/`-prefixed multi-repo diff + out-of-scope detection, and append (not truncate) per-repo
finish. The **cross-verify bug-collection + fix-loop dispatch** (Stages 3c/3d) and the AskUserQuestion
intercepts are Maestro/directive work, not verbs — exercised by the directive, not this verb-level
dogfood; their inputs (`cross-signal`'s `UNSAFE=1`, `multi-verify-bugs.txt` re-dispatch via the
existing `send`/`wave-wait`) are all validated. The live `spawn` of each part remains blocked by the
codex 0.135.0 trust prompt (each sub-repo cwd would need to be codex-trusted), so the parts' build
turns were stood in for — identical boundary to Phases B and C.

## Verification context

- **593 vitest unit tests green** (+ the D1–D5 suites: sibling verbs, sibling-rescue, cross-signal,
  multi-repo scope-check, finish-one); `tsc --noEmit` 0, eslint 0, stale-token gate (incl. the
  rewritten `commands/perform.md` Stages 3c/3d/4) green; `dist/consort.cjs` rebuilt (767.1kb) +
  committed so `/consort:perform` dispatches the new verbs.
- Phase D built subagent-driven: 5 implementers (D1 sibling-baseline+verify / D2 sibling-rescue / D3
  cross-signal / D4 multi-repo scope-check / D5 finish-one), each through two-stage review (spec →
  quality) — all SPEC PASS / QUALITY APPROVED (two Minor byte-faithfulness/test-coverage fixes folded
  back into D1 and D2). The directive (Stages 3c/3d/4) + dist + phase-guard refresh were
  conductor-authored.
- **`perform` is COMPLETE.** The remaining high-level commands (`prelude`, `rehearsal`, `playback`)
  are out of scope until each gets its own spec (the refreshed `CLAUDE.md` phase guard reflects this).
