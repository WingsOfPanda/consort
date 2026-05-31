# consort Simplification Sweep — Design

**Status:** approved 2026-05-31 · **Type:** behavior-preserving cleanup (no feature change)

**Companion plan:** `docs/superpowers/plans/2026-05-31-consort-simplification.md` (the full finding catalog,
including the 16 quarantined items and 3 dropped items). This spec is the *executable subset*: Phases 1-3.

## Goal

Remove the accidental complexity a code-simplifier sweep found in the consort codebase — dead port artifacts,
duplicated low-level helpers, and a few sibling-idiom inconsistencies — **without changing any observable
behavior**. The codebase is already clean; this is a focused tidy, not a refactor of architecture.

## Scope

**In scope** — the 24 behavior-preserving items in Phases 1-3 of the companion plan:

- **Phase 1 (8 items):** trivial dead-code / no-op / dead-export removals.
- **Phase 2 (11 items):** consolidate true duplication into shared helpers.
- **Phase 3 (5 items):** sibling-idiom consistency + one careful function decomposition (3.2 `finalizeWith`).

**Out of scope** — all 16 quarantined items (parity / FROZEN-protocol risk; each needs its own reviewed
change), and the 3 dropped noise items. Two latent issues the sweep surfaced are noted below but **not fixed
here**:

1. `gatherPeers` reads `parts.txt` *without* the `#`-comment filter that `statusBrief`/`finalize` apply
   (`rehearsal.ts:278` vs `:643,770`) — possible latent bug or deliberate quirk; must be checked against
   clone-wars before any change.
2. `solo` reads its timeout env *eagerly* (module const, `solo.ts:171`) while `perform`/`score` read it
   *lazily* (`perform.ts:35`, `score.ts:518`) — a real behavioral difference under per-test `CONSORT_HOME`
   mutation; converting solo to lazy is a behavior change, not a no-op.

Both are recorded for a future reviewed change; touching either is explicitly forbidden in this sweep.

## Approach

**One branch, one PR.** Branch `chore/simplification-sweep`; commits grouped by task; a single PR to review
and merge — matching how the project has been shipping cleanups. Ordering is **safest-first**: pure deletions,
then helper consolidation, then consistency, with the only medium-effort item (`finalizeWith`) last.

**Behavior is proven unchanged by the existing suite.** The 952-test suite is the regression gate. Each
*new* shared helper (`pluginRoot`, `readIfExists`/`readIfExistsOrNull`, `runForensics`) gets a focused unit
test, because it becomes load-bearing shared code. No new tests for no-op removals — adding characterization
tests for a `Z`→`Z` replacement is redundant with the suite.

**Task grouping** (each task = one commit that ends green; *not* one-per-finding):

| Task | Content | New test |
|---|---|---|
| T1 | Phase 1 — all 8 dead-code/no-op/dead-export removals | — |
| T2 | Extract `pluginRoot()` in `core/paths.ts`; replace ~8 copies | yes |
| T3 | Extract `readIfExists`/`readIfExistsOrNull`; replace 6 redeclarations (incl. the `score.ts` self-dup) | yes |
| T4 | Delete `collect.ts` private `resolveModel`; import the `core/ipc.ts` one | — |
| T5 | Extract core `runForensics()`; collapse the 5-6 `forensicsRun` wrappers; **unify the drifted rehearsal log wording** | yes |
| T6 | Local-dedup helpers: `hasRepoMarker`, `resolveMarker`, `resultStr`+reuse `readResultJson`, `parseRosterTargets`/`nonCommentLines`, `gatherCompletion`, `ansiFromColor` reuse in `_banner`, hoist double `outboxPath` | — |
| T7 | Phase 3 trivial — rehearsal `usage()`, `Research*Deps`→`*Deps` aliases, `topApproach` import alias, `missingRosterArtifacts` | — |
| T8 | Phase 3.2 — decompose ~250-line `finalizeWith` into named per-step helpers, **preserving FROZEN step order**; keep `parseScoreboard.rows` (asserted by a test) | — |

T2/T3/T5 are cross-partition (touch many files); each is its own coordinated commit. Within-file dedups are
batched into T6.

## Constraints / guardrails (apply to every task)

- **FROZEN protocol:** never rename or reorder wire event names, the `END_OF_INSTRUCTION` sentinel, JSON wire
  fields, `contracts.yaml` keys, state filenames, `CLAUDE_CODE_SESSION_ID`.
- **Stale-token gate:** shipped `src`/`config`/`commands`/`hooks`/`.claude-plugin` must stay free of
  `clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_` and `trooper`/`commander` — including in
  comments. New helper names and comments must avoid them.
- **Architectural invariants preserved:** atomic write (tmp-in-same-dir + rename), absolute state paths,
  event matching via `JSON.parse` then `obj.event ===`, errors to stderr not the outbox, one esbuild bundle.
- **Committed `dist/`:** after any `src/` change, run `npm run build` and commit the refreshed
  `dist/consort.cjs` in the same task.
- **Faithful-port discipline:** do not "simplify" a deliberate parity quirk. If a removal turns out to change
  a clone-wars-faithful behavior, stop and reclassify it as quarantined.

## Verification / acceptance

A task is done when, and the sweep is accepted when ALL of:

- Every listed Phase 1-3 item is applied (and no quarantined item is touched).
- `npm run typecheck` clean; `npm run lint` clean.
- `npm run test` green — the full existing suite plus the new unit tests for `pluginRoot`,
  `readIfExists`/`readIfExistsOrNull`, and `runForensics`.
- The stale-token test passes.
- `npm run build` succeeds and the rebuilt `dist/consort.cjs` is committed.
- No observable behavior change: no diffs to wire output, on-disk state layout, or command exit codes beyond
  the single intended log-wording unification in T5.

## Risks

- **Over-eager simplification breaking parity** — mitigated by the faithful-port guardrail + the existing
  suite + keeping quarantined items out entirely.
- **`finalizeWith` decomposition reordering FROZEN steps** (T8) — mitigated by extracting the
  already-comment-delimited steps as a pure mechanical move, preserving call order exactly, with the rehearsal
  test suite as the gate. T8 is sequenced last and is the one task warranting a careful per-step review.
- **A "dead" export/field that a test secretly asserts** — the sweep already flagged the known ones
  (`parseScoreboard.rows`, `branchMode`); run the full suite per task to catch any missed case.
