# Rehearsal B1 — Coverage & diversity guard design

**Status:** approved design (2026-06-04), pending implementation plan. Phase **B1** of the rehearsal
research-validity roadmap (`docs/superpowers/specs/2026-06-03-rehearsal-research-validity-roadmap.md`),
the first of the **Q2 idea-generation track**. Builds on the proven A3 score-pass+tsv arc (0.1.14)
and reuses the C0 `direction` field (0.1.12). No dependency on A1/A2 internals.

## 1. Problem

The Maestro is told to explore diverse approach families (`commands/rehearsal.md:160` "assign a
different pipeline / approach family per part"; `:273` "rotate the approach mix"), but **nothing
mechanical checks that it does.** Two concrete failures follow:

- **Premature convergence is unguarded.** `checkCompletion`'s plateau
  (`src/core/rehearsalComplete.ts:88-93`) slices the last `plateau_window` ok metrics **in global
  scoreboard order, with the approach family discarded** (`parseRows` parses column `c[7]` then
  throws it away — `SbRow` has no `approach` field). So a single part **tuning one family** produces
  a tight last-N window, the global plateau fires, and the Step-4 soft-stop ("floor met + plateau +
  target not met → default stop") ends the run — even though only one family was ever tried. The
  plateau is a **gameable stop**.
- **No coverage signal exists.** There is no count of how many distinct approach families have been
  explored, so neither the Maestro nor the operator can see "we have collapsed onto 1-2 families."
  AIRA measured a **6.9–8.4 absolute-point MLE-bench drop** when ideation diversity is forced down
  (arXiv:2511.15593); "AI Research Agents Narrow Scientific Exploration" (2605.27905) shows
  low family coverage is the *default* failure mode. This is exactly what B1 guards.

B1 makes coverage **mechanical**: a per-family tally surfaced in the status brief, and an
**approach-aware plateau** that will not declare a plateau-stop while exploration is still collapsed
onto too few families or any family is still improving.

## 2. Constraints

- **Additive only.** New pure module (`rehearsalCoverage.ts`), new optional `metric.md` knob
  (`min_families`), new state file (`coverage.tsv`), widened `CompletionSignals` (new derived
  fields). No frozen wire token renamed; the `status` enum, the 8-column scoreboard schema, and the
  integer-rank parsing contract (`/^\|\s+\d+\s+\|/`) are untouched.
- **Strictly-additive plateau.** The new plateau condition only ADDs requirements to today's check,
  so B1 can **delay** a plateau-stop but can **never** introduce a new false stop. The hard caps
  (time budget / `halt.flag`), `target_met`+K, and Lane-D all still stop the loop independently — so
  a stricter plateau cannot hang the loop.
- **Mechanical teeth, directive steering.** The coverage tally + approach-aware plateau are the
  mechanical core. *Choosing* the next under-explored family is the Maestro's job (directive).
- **YAGNI / small-count regime.** Families number 2-5. The coverage signal is the plain **filled-niche
  count** (QD "coverage" = number of non-empty cells; ecology "richness" = count of categories — the
  recommended measure for small, rare-sensitive sets). EXPLICITLY rejected as over-engineering for
  this scale: QD-score, Vendi/archive-shape diversity, CVT/Voronoi, embedding-variance breadth,
  Shannon/Simpson entropy (unstable + over-confident at small N — diverges from a plain count only
  for n>2), ASHA-style halving, and a standalone near-duplicate-dispatch alarm (folded into directive
  steering). Recording these here so a future parity/audit pass does not "helpfully" re-add them.
- **Explore-only preserved.**

## 3. Architecture

B1 reuses the **A3 score-pass + tsv arc** verbatim (snapshot, not append):

1. A new pure core module `rehearsalCoverage.ts` owns the single family-canonicalization rule
   (`normalizeFamily`), the per-family tally (`tallyCoverage`), and the `coverage.tsv` row I/O.
2. `computeScore` (the score pass) walks every experiment, and after the walk computes
   `coverageRows = tallyCoverage(okRows, direction)` — a per-family aggregate — returned on
   `ScoreComputation`.
3. `scoreWith` writes `coverage.tsv` as a **snapshot** (overwrite) immediately after the sanity.tsv
   write, preserving the frozen write order.
4. `checkCompletion` un-drops the approach in `parseRows`, imports `normalizeFamily` (so the plateau
   and the tally bucket identically), and computes the **approach-aware plateau** + the derived
   coverage signals on `CompletionSignals`.
5. `statusBriefWith` joins `coverage.tsv`; `buildStatusBrief` renders a dedicated `Coverage:` line.
6. The directive (`commands/rehearsal.md`) steers dispatch toward under-explored families.

## 4. Data model

### 4.1 Family canonicalization (pure)

`normalizeFamily(label: string): string` — the **one** rule, shared by the tally and the plateau:
lowercase → trim → collapse internal whitespace runs to a single space → strip leading/trailing
punctuation. Concretely: `label.toLowerCase().trim().replace(/\s+/g, " ").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")`.
So `"SGD"`, `" sgd "`, and `"SGD-baseline"`→`"sgd-baseline"` normalize predictably; `"single pass"`
and `"single-pass"` remain distinct families (deliberate — punctuation-internal differences are
treated as the Maestro's intent, not noise). An empty/whitespace label normalizes to `""` and is
bucketed as the family `"(unlabeled)"` for the tally so it is still visible.

### 4.2 `coverage.tsv` — per-family snapshot

A **family-keyed aggregate** (one row per family), NOT per-experiment:

```
family	count	best	ts
single-pass	4	0.961	2026-06-04T10:00:00Z
typed-routing	3	0.948	2026-06-04T10:00:00Z
hybrid	1	0.902	2026-06-04T10:00:00Z
```

- `COVERAGE_TSV_HEADER = "family\tcount\tbest\tts\n"`.
- `count` = number of **feasible ok** experiments in that family — `status==ok` AND not A2-infeasible
  (`!infeasibleReason`). Invalid results are already skipped via the `continue` in `computeScore`;
  excluding A2-infeasible too keeps the tally consistent with the plateau's `familiesActive` (which
  drops `x<rank>` infeasible rows via the integer-rank parse) and honors the diversity-of-**successes**
  intent — a family whose every run was botched is not validly explored and must not inflate coverage.
- `best` = the direction-aware best metric string in that family (informational; rendered in the
  brief).
- `ts` = the score-pass timestamp (`deps.now()`), same value on every row of one snapshot.
- **Snapshot semantics:** `scoreWith` writes `COVERAGE_TSV_HEADER + rows.map(coverageRow).join("")`
  wholesale every score pass — NEVER `prior + row`. `computeScore` re-walks all experiments each pass,
  so appending would double-count (this is the A3/sanity.tsv discipline, not the A1/verification.tsv
  append verb).

### 4.3 `tallyCoverage` (pure)

`tallyCoverage(rows: {approach: string; metric: string}[], direction?: "maximize" | "minimize"):
CoverageRow[]`. Groups by `normalizeFamily(approach)`, counts, and tracks the direction-aware best
numeric metric (max for maximize / default, min for minimize). Non-numeric metrics are ignored for
`best` but still counted (the row is an ok experiment). Output sorted by `count` descending then
family name ascending (stable, deterministic — no `Math.random`/`Date.now`). `CoverageRow { family:
string; count: number; best: string; ts: string }` (`ts` filled by the caller in `computeScore`, not
by the pure tally — the tally is time-free for testability).

### 4.4 The approach-aware plateau (in `checkCompletion`)

`parseRows` gains `approach: c[7]` on `SbRow` (the single load-bearing un-drop; the data is already
in column `c[7]`). The plateau block is **strictly additive** to the existing global check:

```
plateau = globalFlat
          AND familiesActive >= minFamilies
          AND familiesImproving === 0
```

- `globalFlat` = today's check, semantics unchanged: `metrics.length >= plateauWindow &&
  max(last plateauWindow) - min(last plateauWindow) < plateauThreshold`.
- Build `okFam` from `okRows` as `{ fam: normalizeFamily(r.approach), exp: r.exp, mv: parseFloat(r.metric) }`.
- `familiesActive` = count of distinct `fam` (families with >= 1 ok row).
- A family is **still improving** iff, with its ok rows sorted by `exp` ascending (chronological;
  zero-padded `exp-NNN` sorts lexically = chronologically), its **latest** metric strictly beats the
  direction-aware best of its **prior** metrics by more than `plateauThreshold`:
  - maximize: `latest > priorBest + plateauThreshold`
  - minimize: `latest < priorBest - plateauThreshold`
  - a family with `< 2` ok rows has no prior → **not** improving (does not block).
- `familiesImproving` = count of still-improving families.

The plateau fires only when the global window is flat AND at least `min_families` distinct families
were explored AND no family is still climbing. **The single-family-tuning bug is fixed by the
`familiesActive >= minFamilies` term** (one family → `familiesActive = 1 < 2` → no plateau-stop).

### 4.5 `CompletionSignals` — new derived fields

`CompletionSignals` gains `familiesActive?: number`, `familiesImproving?: number`, `minFamilies?:
number` — **optional** (all derived, no frozen field touched). `checkCompletion` always populates
them, but they are typed optional so existing `CompletionSignals` literals (in
`renderSessionSummary` fixtures, the status-brief tests) keep compiling unchanged — exactly the
additive, back-compat posture of `StatusBriefInput.verdicts?`/`suspects?`. Consumers that want them
read with a default (e.g. `c.minFamilies ?? 2`).

### 4.6 `metric.md` `min_families`

Optional `**min_families:**` (default **2**), **parse-only** — added to `MetricThresholds` and
parsed in `parseMetricMd` exactly like A1's `verify_epsilon` / A3's `ceiling` / A2's
`max_debug_attempts` (`rehearsalMetric.ts:103-106`). `formatMetricBlock` stays byte-faithful and does
**not** emit it (consistent with every prior A-phase knob); the Maestro adds the line to `metric.md`
via the directive when a non-default floor is wanted. Unlike the optional A-phase knobs (which are
`number | undefined` with the default applied in the caller), `min_families` is parsed as a required
`number` defaulting to 2 in `parseMetricMd` itself — mirroring `kRequired`/`plateauWindow`, because
`checkCompletion` always needs a concrete floor. Default 2 is the bare "not collapsed onto one
family" floor; AIRA's healthy band is 3-4, so it is configurable up for breadth-hungry runs. A value
< 1 clamps to 1 (a single family always satisfies a floor of 1, disabling the coverage gate while
keeping the per-family improving check).

## 5. Flow

1. Experiment lands → `score` (`computeScore`) walks all experiments, computes `coverageRows`, and
   `scoreWith` writes `coverage.tsv` (snapshot).
2. `checkCompletion` (via `gatherCompletion` → `status-brief`) computes the approach-aware plateau +
   `familiesActive`/`familiesImproving`/`minFamilies`.
3. `status-brief` joins `coverage.tsv` and renders a `Coverage:` line:
   `Coverage: 3 families [single-pass×4, typed-routing×3, hybrid×1]; min_families=2 (met)`
   (`(met)` when `familiesActive >= min_families`, else `(short by N)`).
4. **Step 4 (directive):** the plateau in the Completion-check line is now family-aware — it will not
   fire while collapsed onto < `min_families`. The existing soft-stop benefits automatically.
5. **Step 5 (directive):** when the `Coverage:` line shows `familiesActive < min_families` (or one
   family dominates), the Maestro opens a NEW family on the next dispatch rather than tuning the
   leader; soft-anchored to AIRA (≤2 = collapse warning, 3-4 = healthy). It may map the
   `approach-label` to one of the SOTA sweep's curated families (a soft expected-set), but the
   mechanical bucket key remains `normalizeFamily(approach-label)`.

## 6. Boundaries — what B1 does NOT do

- Does **not** add a hard declared family taxonomy or a coverage **denominator** — coverage is a
  count of what ran, not a fraction of a declared set (deferred; the SOTA families are a soft
  directive reference only).
- Does **not** add a mechanical near-duplicate-dispatch alarm (directive steering covers it).
- Does **not** change the global plateau's existing semantics, the scoreboard sort/schema, or the
  integer-rank parsing contract.
- Does **not** gate completion on coverage by itself — coverage only makes the existing plateau
  stricter and informs Maestro steering. `target_met`+K and the hard caps are unaffected.
- Does **not** touch Lane-D (per-part, feasible-only) — family is an independent axis from part.

## 7. Directive changes (`commands/rehearsal.md`)

- **Phase 1 (metric discussion):** mention the optional `min_families` knob (default 2).
- **Step 3 / status-brief reading:** document the `Coverage:` line and what `familiesActive` /
  `(short by N)` mean.
- **Step 4 (decision policy):** note the plateau is now family-aware — a plateau-stop cannot fire
  while exploration is collapsed onto < `min_families` families or any family is still improving.
- **Step 5 (dispatch round):** steer the next dispatch toward an under-explored family when the
  `Coverage:` line is short; soft-anchor to AIRA's ≤2/3-4 band; optionally align the `approach-label`
  to a SOTA family. The line-160 initial-diversity instruction now has a mechanical backstop — add a
  one-line pointer.

## 8. Files

- **New:** `src/core/rehearsalCoverage.ts` — `normalizeFamily`, `tallyCoverage`, `CoverageRow`,
  `COVERAGE_TSV_HEADER`, `coverageRow`.
- **Modified:**
  - `src/core/rehearsalComplete.ts` — `SbRow.approach` + `parseRows` un-drop; approach-aware plateau;
    `CompletionSignals` new fields; import `normalizeFamily`.
  - `src/core/rehearsalScore.ts` — accumulate ok rows, `coverageRows` on `ScoreComputation` + return.
  - `src/core/rehearsalMetric.ts` — `min_families` in `MetricThresholds` + `parseMetricMd` (default 2,
    `< 1` clamps to 1). NOT `formatMetricBlock` (parse-only, like every prior A-phase knob).
  - `src/core/rehearsalBrief.ts` — `StatusBriefInput.coverage?` + the `Coverage:` line render.
  - `src/commands/rehearsal.ts` — import coverage header/row; `scoreWith` snapshot write;
    `statusBriefWith` coverage.tsv join.
  - `commands/rehearsal.md` — the directive edits in §7.
  - `tests/rehearsal-*.test.ts`, `dist/consort.cjs`, the 3 version manifests.

## 9. Testing

- `normalizeFamily`: casing / surrounding whitespace / surrounding punctuation collapse to one
  family; internal-punctuation differences stay distinct; empty → `""` (→ `(unlabeled)` bucket in the
  tally).
- `tallyCoverage`: groups by normalized family; counts ok rows; direction-aware `best` (max for
  maximize, min for minimize); deterministic sort (count desc, family asc); non-numeric metric still
  counted but excluded from `best`.
- `checkCompletion` plateau:
  - **the bug fix:** a single family with a flat last-N window does NOT plateau (`familiesActive=1 <
    min_families=2`).
  - two families, both stalled, `familiesActive >= min_families`, `globalFlat` → plateau true.
  - two families, one still improving → plateau false (`familiesImproving=1`).
  - `globalFlat=false` → plateau false regardless of families.
  - minimize direction: "still improving" uses `latest < priorBest - threshold`.
  - new fields `familiesActive`/`familiesImproving`/`minFamilies` populated.
- `metric.md`: `parseMetricMd` reads `min_families`; default 2 when absent; `< 1` clamps to 1.
  `formatMetricBlock` output is unchanged (parse-only knob) — assert it does NOT emit a min_families
  line, matching the prior A-phase knobs.
- `computeScore` / `scoreWith`: a run with three families writes a 3-row `coverage.tsv` snapshot
  (overwrite, header present); a second score pass overwrites (no double-count).
- `status-brief`: renders the `Coverage:` line from coverage.tsv; absent coverage → no line
  (back-compat).
- No real subprocess/FS in unit tests; stale-token gate green; frozen schema/fields/status enum
  untouched; scoreboard.md byte-identical.

## 10. Acceptance criteria

1. A single-family flat streak no longer triggers a plateau-stop (`familiesActive < min_families`),
   while a genuinely multi-family stalled run does — proven by tests.
2. The plateau is strictly additive: any case that did NOT plateau before still does not, and the new
   conditions only ever suppress a plateau, never create one (regression test on the existing
   maximize plateau cases).
3. `coverage.tsv` is a per-family snapshot (overwrite, never append), counting ok experiments, with
   the direction-aware best per family.
4. The status brief shows a `Coverage:` line with the family tally and the `min_families` floor
   status; the line is absent when no coverage data exists (back-compat).
5. `metric.md` `min_families` parses (default 2, `< 1` clamps to 1); `formatMetricBlock` output is
   byte-unchanged (parse-only knob).
6. `CompletionSignals` carries `familiesActive`/`familiesImproving`/`minFamilies`; existing consumers
   unaffected.
7. `scoreboard.md` schema + `schema_version`, the `status` enum, the integer-rank parsing contract,
   and A1/A2/A3 state files are untouched.
8. All gates green (typecheck / vitest / lint / stale-tokens / build); version bumped; `dist` rebuilt.

## 11. Out of scope (later phases)

B2 (operators / one-measurable-change vs parent_id / discovery lenses / verbalized sampling — the
proven direction bottleneck), a declared family taxonomy + coverage denominator + missing-family
flag, a mechanical near-duplicate alarm, A4 (multi-seed / statistical gate), B3 (search/budget,
likely cut), C1 (independent re-implementation inspector).
