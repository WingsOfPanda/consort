# consort perform/score UX sweep — design

**Date:** 2026-06-01
**Status:** approved (brainstorming → spec)
**Branch:** `fix/perform-score-ux-sweep`

## Problem

Three rough edges surfaced while dogfooding `/consort:perform` and `/consort:score`:

1. **Noisy pane label.** A perform-spawned part shows a tmux border label like
   `tutti-cody:codex:design-how-to-parall`. The `cody` segment is a hardcoded placeholder
   instrument name that conveys nothing to the user and reads as redundant noise next to the
   `tutti` section.
2. **No progress visibility.** `score` walks Stages 0–16 and `perform` walks Stages 0–4 (+3a–3d for
   multi-repo), but the Maestro (the conductor session driving the command) exposes no running task
   list, so the user cannot tell "where are we" during a long run.
3. **Buried, unannounced design doc.** `score` writes its design doc to
   `<topicDir>/_score/design-doc/<date>-<topic>-design.md` (state tree) on the fast-path, and moves
   it to `~/.consort/archive/<repo-hash>/<topic>/_score-<ts>/…` after escalation archives. Both are
   non-obvious paths, and the doc never lands in the repo's `docs/superpowers/specs/` where every
   other spec lives — so the user has to go hunting for the artifact `score` just produced.

## Goal

Make perform's pane label clean and self-consistent, give both commands a visible high-level
progress list, and make `score`'s output discoverable and clearly reported — all as faithful,
low-risk additions that preserve the frozen wire protocol and every multi-part command's behavior.

## Architecture

### Fix 1 — pane label reads `tutti:codex:topic`; `cody` purged internally

Two coordinated changes:

**(a) Label collapse rule (`src/core/colors.ts`).** `labelFor` and `labelFmt` currently render
`${section}-${instrument}:${model}:${topic}`. Add a membership helper
`isOrchestral(name): boolean` = `name.toLowerCase() in PALETTE`. When the instrument **is** an
orchestral pool member, keep `section-instrument:model:topic` (unchanged). When it is **not** (i.e.
it falls back to section `tutti`), collapse to `section:model:topic` — dropping the `-instrument`
segment in both the plain `labelFor` and the color-formatted `labelFmt`.

This is safe by construction: the instrument pool (`config/instruments.yaml`) is exactly the
`PALETTE` keys, so `solo` / `score` / `perform`-multi / `prelude` / `rehearsal` always draw real
orchestral instruments and keep their `section-instrument` labels. The `tutti` fallback only ever
arises for a non-pool placeholder name — today, only perform-single's part — so the collapse fires
there alone. No multi-part command can regress (two same-section parts still differ by instrument).

**(b) Rename the perform-single part `cody` → `tutti`.** So the internal artifacts match the
visible label. In `src/commands/perform.ts`: `const PART = "tutti"`, and replace the hardcoded
state-file literals `turn-cody-${round}.txt`, `cody_turn_prompt_${round}.md`,
`question-cody-${round}.txt`, `turn-cody-${round}.done` with `${PART}`-interpolated strings so the
name is centralized in the one constant. Update the log lines that say `cody` to use `${PART}`.
`commands/perform.md`, `tests/perform-turn-cmd.test.ts`, and `tests/perform-cmd.test.ts` move in
lockstep (spawn line, `reset-status <TOPIC> tutti`, the `turn-tutti-N` / `question-tutti-N` /
`tutti_turn_prompt_N` references).

Result: border `tutti:codex:topic`, forensics `part=tutti-codex`, state files `turn-tutti-N.txt`.
These perform-internal scratch files are **not** frozen IPC state filenames (status.json / pane.json
/ inbox.md / identity), so renaming them is protocol-safe and invisible to the external model
binaries.

### Fix 2 — Maestro maintains a high-level TodoWrite list (score + perform)

Add `TodoWrite` to the `allowed-tools` frontmatter of `commands/score.md` and `commands/perform.md`,
and add a short **Progress tracking** instruction near the top of each (after the `Let CS=` line):
seed a TodoWrite list immediately after init, mark each stage `in_progress` on entry and `completed`
on exit, and use **one rolling todo** for dynamic phases (perform fix-rounds, DAG waves) rather than
one todo per round/wave (the round/wave count is unknown up front and would churn the list).

Seed lists (high-level stages, refined after the routing decision):

- **score** — seed `route` after Stage 0; after Stage 1 decides, replace with the path list:
  - fast-path: `draft sections` → `assemble+audit` → `export+present`
  - escalation: `spawn ensemble` → `research` → `diff` → `cross-verify` → `adjudicate` →
    `[detect-multi-repo]` → `design walk` → `assemble+audit` → `[drilldown]` → `teardown+archive` →
    `export+present`
- **perform** — seed after Stage 0:
  - single: `spawn part` → `build+verify loop` → `scope+finish` → `teardown+archive`
  - multi: `preflight` → `wave dispatch (rolling)` → `cross-repo verify` → `fix loop` →
    `sibling+scope+finish` → `teardown+archive`

This is a pure prompt change — no core code, no unit tests, no stale-token-gate impact (`TodoWrite`
and `tutti` are not banned tokens).

### Fix 3 — score exports its design doc to `docs/superpowers/specs/` and reports it clearly

**New pure helper (`src/core/score.ts`):**
`scoreExportDocPath(repoRoot: string, basename: string): string` →
`join(repoRoot, "docs/superpowers/specs", basename)`. Pure, unit-testable.

**New verb (`src/commands/score.ts`): `score export-doc <TOPIC>`.** It:
1. Globs the single assembled `*-<topic>-design.md` under `_score/design-doc/` (avoids
   recomputing the embedded date; the assembled doc is the only such file).
2. Resolves the repo root (`repoRoot()`; git root, else cwd), computes the dest via
   `scoreExportDocPath`, `mkdir -p`s `docs/superpowers/specs/`, and copies the doc there
   (overwrite on re-run — the latest assembled doc wins).
3. Prints `EXPORTED=<abs dest>` on success; rc 1 (no source doc found) with a stderr message.

**Command-doc wiring (`commands/score.md`):** call `$CS score export-doc <TOPIC>` right after
`assemble` returns rc 0 — at **fast-path Stage 2** and **escalation Stage 12** — i.e. before any
teardown/archive (Stages 14b/15) so the `_score` source still exists. Capture `EXPORTED=`. The final
present step (Stage 2 for fast-path; Stage 16 for escalation) states the **exported
`docs/superpowers/specs/` path as the primary, discoverable location** and notes the `_score`/archive
copy as the source. This also gives `/consort:perform` a stable path the user can pass directly.

The export is additive (a copy): the `_score` original is untouched, so `perform find-latest-doc`
(which scans `_score` art dirs) keeps working unchanged.

## Components

| File | Change |
|---|---|
| `src/core/colors.ts` | add `isOrchestral`; collapse `-instrument` in `labelFor` + `labelFmt` for non-orchestral names |
| `src/commands/perform.ts` | `const PART = "tutti"`; replace hardcoded `cody` state-file literals + log lines with `${PART}` |
| `commands/perform.md` | `cody` → `tutti` everywhere (spawn, reset-status, `turn-tutti-N` / `question-tutti-N` / `tutti_turn_prompt_N`); add `TodoWrite` to allowed-tools + Progress tracking block + seed list |
| `commands/score.md` | add `TodoWrite` to allowed-tools + Progress tracking block + seed list; wire `score export-doc` after assemble (Stages 2 & 12); report exported path in Stages 2 & 16 |
| `src/core/score.ts` | add `scoreExportDocPath(repoRoot, basename)` |
| `src/commands/score.ts` | add `export-doc <TOPIC>` verb (glob source, copy to specs dir, print `EXPORTED=`) |
| `tests/perform-turn-cmd.test.ts`, `tests/perform-cmd.test.ts` | update `cody` → `tutti` assertions |
| `tests/colors*.test.ts` (existing or new) | label-collapse cases |
| `tests/score*.test.ts` | `scoreExportDocPath` + `export-doc` copy behavior |
| `dist/consort.cjs` | rebuild + commit (zero-build install) |

**Out of scope (left untouched):** `tests/score-diff.test.ts`, `tests/score-adjudicate.test.ts`,
`tests/solo-forensics.test.ts`, `tests/forensics-run.test.ts` use `cody` as a generic fixture
instrument name unrelated to perform-single. `cody` is not a banned token, so leaving them has no
stale-token-gate impact; renaming them would be out-of-scope churn.

## Data flow

- **Label:** `spawn` → `paneLabelSet(pane, instrument, model, topic)` →
  `paneLabelSetArgs` → `labelFor` / `labelFmt` (collapse here) → `@cs_label` / `@cs_label_fmt`
  tmux options → pane-border-format renders `tutti:codex:topic`.
- **Export:** `score assemble` writes `_score/design-doc/<date>-<topic>-design.md` → Maestro runs
  `score export-doc <TOPIC>` → copies to `<repoRoot>/docs/superpowers/specs/<basename>` → prints
  `EXPORTED=` → Maestro reports both paths.

## Error handling

- `labelFor`/`labelFmt` collapse is a pure branch on PALETTE membership; no new failure mode.
- `export-doc`: rc 1 + stderr if no `*-<topic>-design.md` source exists (assemble must have run
  first). mkdir/copy failures surface as a thrown error (the verb wraps and returns non-zero); the
  command doc treats a non-zero `export-doc` as "report the `_score`/archive path only and continue"
  — export failure must never abort a successful `score` run.

## Testing

- **Unit (pure):** `colors.ts` — orchestral instrument keeps `section-instrument:model:topic`;
  non-orchestral (`tutti`, `cody`) collapses to `section:model:topic`, for both `labelFor` and
  `labelFmt` (verify the color-format prefix collapses too). `score.ts` — `scoreExportDocPath`
  composes `<repoRoot>/docs/superpowers/specs/<basename>`.
- **Suite-as-gate (integration-shaped):** the `cody→tutti` rename is verified by the updated
  perform-turn/perform-cmd tests asserting `turn-tutti-N` / `question-tutti-N` / `tutti_turn_prompt_N`
  and the `reset-status` / spawn paths. `export-doc` copy verified with a temp-home harness
  (`CONSORT_HOME` + a temp repo): assemble a doc, run the verb, assert the file exists at the specs
  path and matches the source.
- **Full gate:** `npm run typecheck`, `npm run lint`, `npm run test` (incl. `stale-tokens`), then
  rebuild and commit `dist/consort.cjs`.

## Success criteria

- [ ] A perform-single spawn renders the pane border label `tutti:<model>:<topic>` (no `-cody`,
      no `-tutti` doubling).
- [ ] No `cody` string remains in `src/commands/perform.ts`, `commands/perform.md`, or the perform
      tests; forensics for a perform run shows `part=tutti-<model>`.
- [ ] solo / score / perform-multi / prelude / rehearsal labels are unchanged
      (`section-instrument:model:topic`).
- [ ] `commands/score.md` and `commands/perform.md` instruct the Maestro to maintain a high-level
      TodoWrite list with the seeded stages, and list `TodoWrite` in `allowed-tools`.
- [ ] `score export-doc <TOPIC>` copies the assembled doc to
      `<repoRoot>/docs/superpowers/specs/<date>-<topic>-design.md` and prints `EXPORTED=<path>`.
- [ ] `commands/score.md` calls `export-doc` after assemble on both the fast-path and escalation,
      and the final present step states the exported `docs/superpowers/specs/` path as primary.
- [ ] `npm run typecheck` / `lint` / `test` all green (incl. stale-tokens); `dist/consort.cjs`
      rebuilt and committed.

## Risks

- **Renaming perform state filenames** could orphan an in-flight perform run mid-upgrade. Acceptable:
  these are per-run scratch files; a run spans a single plugin version, and the topic guard prevents
  concurrent same-topic runs.
- **Label collapse over-firing.** Guarded by exact PALETTE membership; the pool == PALETTE keys, so
  only non-pool placeholders collapse. A unit test pins both orchestral-kept and fallback-collapsed
  cases.
- **export-doc overwrite.** Overwriting a same-named doc on re-run is intended (latest assembled doc
  wins); the source `_score` copy is always preserved, so nothing is lost.

## Relationship to clone-wars (the behavioral predecessor)

- Fix 1 is a cosmetic-label refinement on the consort-side rebrand (the predecessor had no orchestral
  sections); the rename is consort-internal. Protocol bytes unchanged.
- Fix 2 is a conductor-prompt affordance — the predecessor's commands had no equivalent task surface;
  this adds none of its own machinery beyond Claude Code's `TodoWrite`.
- Fix 3 is **new behavior beyond the faithful port** (the predecessor left the doc in its art/archive
  tree). It is additive and does not alter the port's existing paths — hence this spec, per the
  project phase guard.

## Out of scope

- No change to the frozen wire protocol, event names, sentinels, JSON fields, `contracts.yaml` keys,
  or IPC state filenames.
- No fine-grained per-round/per-wave todos (rolling todo only).
- No renaming of generic `cody` test fixtures in non-perform test files.
- No change to `perform find-latest-doc` discovery (export is additive).
