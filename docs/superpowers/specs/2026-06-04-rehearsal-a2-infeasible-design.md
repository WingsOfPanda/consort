# Rehearsal A2 — INFEASIBLE-vs-REFUTED + bounded re-dispatch design

**Status:** approved design (2026-06-04), pending implementation plan. Phase **A2** of the rehearsal
research-validity roadmap (`docs/superpowers/specs/2026-06-03-rehearsal-research-validity-roadmap.md`).
Builds on **A1** (verify verdict, 0.1.13) and **A3** (sanity flags, 0.1.14).

## 1. Problem

A1 produces a verify verdict (`verification.tsv`) and A3 produces sanity flags (`sanity.tsv`), but both
**only annotate** — they deferred *acting* to A2. So today a botched run (metric doesn't reproduce, or
it barely ran, or it tested the wrong config) is still recorded as a real `ok` data point: it can
become a **refuted idea** (the user's original concern — a good idea killed by a buggy execution), a
**false leader** (a reproducibly-leaky result), and it drags **Lane-D** (`commands/rehearsal.md`
~262-279), which retires a part when its last 3 didn't clear `min_acceptable` — *not knowing* those
were botched, not bad. A2 makes the harness distinguish **INFEASIBLE** ("couldn't be validly
executed") from **REFUTED** ("ran clean, scored low") and act on it.

## 2. Constraints

- **Open-ended / additive (carried from A1/A3).** INFEASIBLE is a **derived** classification (from the
  A1 verdict + A3 flags), NOT a new value in the frozen `status` enum. No frozen wire token renamed.
- **A2 is the first phase to change scoreboard *content*** (it routes infeasible results to a separate
  group) — but it keeps the 8-column schema and the **integer-rank parsing contract** byte-identical,
  so `checkCompletion`/`status-brief` keep working unchanged.
- **Gate has teeth; remediation is the Maestro's job.** The mechanical core is classification + the
  scoreboard gate (which auto-excludes infeasible from completion / top-3 / leader). The bounded
  re-dispatch is directive (the Maestro re-dispatches with feedback, capped by `max_debug_attempts`).
- **Explore-only preserved.**

## 3. Architecture

`computeScore` (the score pass) already produces A3 flags per experiment and walks each exp dir. A2
extends it: it reads `verification.tsv` (the A1 verdict per instrument/exp), applies the pure
`classifyInfeasible` rule, and marks each `ScoreRow` with an `infeasible` flag. `buildScoreboard`
routes infeasible `ok` rows to a new **`xN`-rank group** below the ranked rows. Because
`checkCompletion.parseRows` and `status-brief.parseTopRows` already match only integer-rank rows,
infeasible results are **auto-excluded** from completion + the top-3 with no change to those modules.
The bounded re-dispatch + Lane-D-feasible-only live in the directive (`commands/rehearsal.md`).

## 4. Data model

### 4.1 The classification rule (pure)

A result is **INFEASIBLE** iff:
- its A1 verdict (from `verification.tsv`) is `mismatch`, OR
- its A3 sanity flags include any of `{under-run, log-contradiction, audit-knob-drift}` — using the
  flag set `computeScore` **just computed for this experiment in the same score pass** (the `sanityFlags`
  result), not a re-read of `sanity.tsv`.

Otherwise **feasible**. `ceiling-exceeded` and `integrity-attestation-incomplete` do NOT trigger
infeasible (they stay advisory suspect flags — avoiding false exclusions from a miscalibrated ceiling
or a forgotten attestation). Only `status=ok` results can be infeasible (a `fail`/`timeout` is already
in the fail group). `classifyInfeasible(verdict: string | undefined, flags: string[]): boolean`.

### 4.2 `verification.tsv` verdict lookup

`computeScore` reads `<art>/verification.tsv` and builds an `instrument/exp -> verdict` map (last write
wins, mirroring `status-brief`'s existing join). For a just-landed exp whose verdict isn't written yet
(A1's `verify-check` runs *after* the score pass), the verdict is absent → not-yet-infeasible; it gets
classified on the **next** score pass once the verdict exists (a harmless one-iteration lag — the
Maestro has the verdict + flags in hand at that moment and won't crown a just-flagged result).

### 4.3 `ScoreRow.infeasibleReason` + the scoreboard group

`ScoreRow` gains `infeasibleReason?: string` (the trigger string — `mismatch`/`under-run`/etc.;
presence ⇒ infeasible; set by `computeScore` so the scoreboard can render *why*). `buildScoreboard`
partitions:
- `ok && !infeasible` → ranked group (integer rank `1,2,3…`), sorted as today (direction-aware).
- `ok && infeasible` → **infeasible group**, rank cell `x<rank>` (continuing the rank counter, like the
  partial `~` prefix), metric/status shown, with the trigger appended (e.g. `… | infeasible:mismatch`
  or `infeasible:under-run`).
- `status != ok` → fail/partial group (unchanged, `~N`/`N`).

The `xN` rank cell is **non-integer**, so `parseRows`/`parseTopRows` skip it → completion + top-3
exclusion is automatic. The 8-column schema + `schema_version=2` are unchanged.

### 4.4 `metric.md` `max_debug_attempts`

Optional `**max_debug_attempts:**` (default **2**), parsed like A1's `verify_epsilon` /A3's `ceiling`.
Caps how many times the Maestro re-dispatches one idea before concluding INFEASIBLE-final.

## 5. Flow

1. Experiment lands → `score` (`computeScore`) renders the scoreboard, now classifying each exp via
   `verification.tsv` + its sanity flags and routing infeasible ok-rows to the `xN` group.
2. `status-brief` (unchanged) shows the integer-ranked top-3 — infeasible rows never appear there.
3. `verify-plan`/`verify-check` (A1) write the just-landed exp's verdict.
4. **A2 (directive):** the Maestro reads the exp's verdict + flags; if INFEASIBLE and this idea's
   attempt count `< max_debug_attempts`, it **re-dispatches the same idea** with the failure feedback
   in the approach-brief (e.g. "previous attempt was INFEASIBLE: audit-knob-drift mcts_sims=16 vs 200;
   set 200 and re-run") via the normal dispatch path. If the cap is hit, it records the idea
   **INFEASIBLE-final** in `## Recent decisions` ("couldn't be validly executed", NOT refuted) and the
   part moves to a new idea.
5. **Lane-D (directive):** counts only **feasible** experiments (the ranked-ok rows) — a botched run
   never advances the abandonment counter.

No new verb; no `experiment-send` change (feedback rides in the approach-brief). `checkCompletion`,
`status-brief`, `experiment-send` are all untouched.

## 6. Boundaries — what A2 does NOT do

- Does **not** independently re-implement the eval => **C1** (the re-dispatch is the part fixing its
  OWN execution / self-correction).
- Does **not** gate on `ceiling-exceeded`/`integrity-attestation-incomplete` (advisory).
- Does **not** add a `status` enum value (INFEASIBLE is derived).
- Does **not** mechanically enforce the re-dispatch cap (directive + `max_debug_attempts`); the
  *mechanical teeth* are the classification + the scoreboard gate.

## 7. Directive changes (`commands/rehearsal.md`)

- Replace the A1/A3 "acting on it (re-dispatch) is a later phase" placeholders with the A2 loop:
  classify (verdict ∪ flags) → INFEASIBLE? → re-dispatch same idea with feedback while attempts <
  `max_debug_attempts`, else INFEASIBLE-final. A REFUTED (feasible, low) result steers normally.
- Lane-D rule: count only **feasible** (ranked-ok) experiments; an INFEASIBLE run is not Lane-D
  evidence.
- Note the `xN` infeasible group in the scoreboard-reading guidance.

## 8. Files

- **New:** `src/core/rehearsalInfeasible.ts` — `classifyInfeasible(verdict, flags)` + `INFEASIBLE_FLAGS`
  + a `parseVerdicts(tsv)` helper (instrument/exp -> verdict).
- **Modified:** `src/core/rehearsalResult.ts` (`ScoreRow.infeasibleReason` + `buildScoreboard` 3-way
  partition + `xN` render), `src/core/rehearsalScore.ts` (read `verification.tsv`, classify, set
  `infeasible`), `src/core/rehearsalMetric.ts` (`maxDebugAttempts`), `commands/rehearsal.md` (A2 loop +
  Lane-D feasible-only), `tests/rehearsal-*.test.ts`, `dist/consort.cjs`, the 3 version manifests.

## 9. Testing

- `classifyInfeasible`: each trigger (`mismatch`, `under-run`, `log-contradiction`, `audit-knob-drift`)
  → true; `ceiling-exceeded`/`integrity-attestation-incomplete`/no-flag/`verified` → false.
- `parseVerdicts`: keys `instrument/exp`, last-write-wins, header/blank skipped.
- `buildScoreboard`: an `ok && infeasible` row goes to the `xN` group (non-integer rank) below the
  ranked rows; ranked rows keep integer ranks; a regression check that `checkCompletion(buildScoreboard
  (...))` ignores the infeasible row (no checkCompletion change).
- `computeScore`: a result whose `verification.tsv` verdict is `mismatch` → its
  `ScoreRow.infeasibleReason` is set and it lands in the `xN` group; a clean result → unset, ranked.
- `metric.md`: parses `max_debug_attempts`; undefined when absent.
- No real subprocess/FS in unit tests; stale-token gate green; frozen fields untouched.

## 10. Acceptance criteria

1. A result with A1 verdict `mismatch` (or A3 `under-run`/`log-contradiction`/`audit-knob-drift`) is
   classified infeasible and rendered in the scoreboard `xN` group, OUT of the ranked leader set.
2. `checkCompletion` and `status-brief` exclude infeasible results with NO code change (via the
   integer-rank grouping); a regression test proves it.
3. A clean `ok` result and a genuinely-low (feasible) `ok` result stay in the ranked group (REFUTED is
   not INFEASIBLE).
4. `ceiling-exceeded`/`integrity-attestation-incomplete` alone do NOT make a result infeasible.
5. `metric.md` `max_debug_attempts` parses (default 2 in callers).
6. `scoreboard.md` keeps its 8-column schema + `schema_version=2`; A1's `verification.tsv` / A3's
   `sanity.tsv` untouched; `status` enum unchanged.
7. All gates green (typecheck / vitest / lint / stale-tokens / build); version bumped; `dist` rebuilt.

## 11. Out of scope (later phases)

C1 (independent re-implementation — verify the integrity attestation + the strongest open-ended
anti-gaming), B1/B2 (coverage/operators), B3 (search/budget), A4 (multi-seed + the K-streak direction
bug), and a *mechanically-enforced* re-dispatch cap (A2 keeps it directive).
