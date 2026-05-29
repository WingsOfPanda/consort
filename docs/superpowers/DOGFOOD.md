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
