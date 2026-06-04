# Rehearsal A3 — sanity & integrity gates design

**Status:** approved design (2026-06-03), pending implementation plan. Phase **A3** of the rehearsal
research-validity roadmap (`docs/superpowers/specs/2026-06-03-rehearsal-research-validity-roadmap.md`).
Builds on **A1** (metric trust / verify-by-re-execution, shipped 0.1.13).

## 1. Problem

A1 answers *"does the reported metric reproduce?"* It does NOT catch a metric that reproduces but is
*suspicious* — too good to be true (leakage), produced by a run that barely executed (under-run), or
contradicted by error markers in its own logs. The existing `audit.json` knob-diff
(`src/commands/rehearsal.ts:887-912`) is the only integrity check and it runs **only at finalize** and
is advisory. A3 adds the sanity layer: cheap, mechanical, task-agnostic checks that flag a result as
*suspect*, plus a recorded integrity attestation for later verification.

## 2. Constraints that shaped the design

- **Fully open-ended tasks (settled in A1).** The harness can't understand an arbitrary task, so
  *task-semantic* checks (data leakage, "non-constant predictions", adversarial-validation) cannot be
  mechanically verified — they can only be **part-attested**. A3 therefore splits into: (a)
  **mechanical, task-agnostic checks** the harness genuinely can do (numeric bounds, runtime, log
  markers, config-knob drift); and (b) a **recorded `integrity` attestation** that is honor-system
  now and gets *verified* only by **C1**'s independent re-implementation.
- **Orthogonal to A1's verdict.** A1's verdict = "reproduces". A3's flags = "suspicious". They are
  independent: a *reproducibly-leaky* result is `verified` (A1) AND `[suspect: ceiling]` (A3). A3
  flags live in their own store, never folded into A1's verdict.
- **Flags, does not gate.** A3 records + surfaces flags for the Maestro to read; acting on them
  (re-dispatch / discard) is **A2**.
- **Additive / frozen-protocol safe.** New optional `metric.md` fields, a new optional `result.json`
  `integrity` block, a new `sanity.tsv` state file, a new pure core module. No frozen token renamed;
  `scoreboard.md` shape byte-identical.
- **Explore-only preserved.**

## 3. Architecture

A new pure core `src/core/rehearsalSanity.ts` holds the checks as pure functions (parsed result +
thresholds + injected log-reader → flag rows). The **score pass** (`computeScore`, which runs after
every `done`) invokes it per validated result and accumulates flag rows; `scoreWith` applies them to a
**`sanity.tsv`** store (mirroring A1's `verification.tsv`). `status-brief` joins `sanity.tsv` for a
live top-3 `[suspect: …]` annotation; `finalize` folds its rows into session-summary `## Warnings`.
The CLI stays pure logic + verb-applies-plan, consistent with `computeScore`/A1.

## 4. Data model

### 4.1 The four mechanical, task-agnostic checks (score pass, per validated result)

- **Ceiling** — `metric_value` beyond a plausible bound => flag `ceiling-exceeded` (detail
  `metric=<v> ceiling=<c>`). Bound: optional `**ceiling:**` in `metric.md`. Direction-aware: for a
  `maximize` objective the violation is `metric_value > ceiling`; for `minimize`, `metric_value <
  ceiling` (i.e. impossibly-low). Skip the check when `ceiling` is absent.
- **Runtime-floor / under-run** — `status=ok` but `runtime_s < min_runtime_s` => flag `under-run`
  (detail `runtime=<r> floor=<f>`). `min_runtime_s`: optional `**min_runtime_s:**` in `metric.md`,
  default `1.0` (so a ~0s "ok" run always flags).
- **Log-error corroboration** — `status=ok` but a `log_paths` file contains a crash marker => flag
  `log-contradiction` (detail `marker=<which> file=<path>`). Conservative, unambiguous marker set
  only: `Traceback (most recent call last)`, `Segmentation fault`, `CUDA out of memory`. (Degeneracy
  like NaN output is task-semantic, so it stays in the `integrity` attestation / C1, not log-scanning;
  a literal NaN metric_value can't occur anyway — JSON has no NaN, so the part writes `null`, which
  `validateResult` already rejects for `status=ok`.) Advisory.
- **Integrity-attestation-completeness** — the `integrity` block (4.2) absent or missing any required
  key => flag `integrity-attestation-incomplete` (detail lists the missing keys).

### 4.2 The `integrity` attestation block (additive, optional `result.json` field)

```json
"integrity": {
  "split_before_fit": true,
  "no_train_test_overlap": true,
  "target_not_in_features": true,
  "trained_steps": 1000,
  "seed": 42
}
```

Required keys for "complete": `split_before_fit`, `no_train_test_overlap`, `target_not_in_features`,
`trained_steps`, `seed`. The harness **records** the block (it is already persisted in result.json on
disk; C1 reads it) and only checks completeness here. It cannot verify the claims for an arbitrary
task — that is C1's job. Purely additive; no existing result.json field changed.

### 4.3 The audit knob-diff, hardened

The existing finalize-time `computeAuditWarnings` + `parseHardConstraints`
(`src/core/rehearsalFinalize.ts`) ALSO runs per-experiment in the score pass: it diffs each numeric
`**Hard constraints:**` mandate (rendered into the experiment's `prompt.md`) against the part's
`audit.json`, emitting mismatches as sanity flags `audit-knob-drift` (detail `<key>=<actual> vs
mandated <value>`). Drift is thus caught before the next dispatch reuses bad direction. The finalize
diff remains as the final backstop. Missing `prompt.md`/`audit.json` => the check is skipped silently
(as it is at finalize today).

### 4.4 Sanity flags + the `sanity.tsv` store

One row per flag: `exp_id \t instrument \t flag \t detail \t ts`. The format mirrors A1's
`verification.tsv` (a flat tsv), but `sanity.tsv` is a **rewritten snapshot** each score pass —
`computeScore` re-walks all experiments and produces the full current flag set, so `scoreWith`
**overwrites** the file (an append, as A1's per-experiment `verification.tsv` uses, would duplicate
rows every pass). A pass with no flags writes just the header. `status-brief` joins it (instrument/exp ->
flags) and annotates the top-3 with ` [suspect: <flag>[,<flag>…]]`; absent `sanity.tsv` => no
annotation (back-compat). `finalize` reads `sanity.tsv` into session-summary `## Warnings` (each row
as `sanity <exp> <flag>: <detail>`), alongside the existing audit warnings.

## 5. Flow

After each `done`, the loop already runs `score`. A3 extends the score pass:
1. `computeScore` validates each result (unchanged), then for each VALID result runs the four checks
   (4.1) + the per-experiment audit-diff (4.3), accumulating `sanity.tsv` rows.
2. `scoreWith` **overwrites** `sanity.tsv` with the full current flag set (a snapshot, NOT append — see §4.4).
3. `status-brief` (run next in the loop) joins `sanity.tsv` and annotates its top-3.
4. The Maestro reads the `[suspect: …]` annotations; acting on them is A2 (it should not steer the
   roster toward a `[suspect]` leader, mirroring the A1 `mismatch` guidance already in the directive).
5. At `finalize`, `sanity.tsv` rows fold into session-summary `## Warnings`.

No new verb is required (unlike A1) — A3 is pure score-pass logic + surfacing. (`status-brief` already
gained a join pattern in A1; A3 adds a second joined map.)

## 6. Boundaries — what A3 does NOT do

- Does **not** gate ranking or exclude suspect rows => **A2**.
- Does **not** verify the `integrity` attestation (honor-system) => **C1** (independent
  re-implementation).
- Does **not** fold flags into A1's verdict — they are surfaced side by side.
- Does **not** include the smoke-test/context-file environment gate — that pre-dispatch concern stays
  deferred (it was only in the rejected "everything" scope option).

## 7. Template change (`config/prompt-templates/rehearsal/experiment.md`)

Add a step (near the result.json / verify step): emit the `integrity` block attesting
`split_before_fit`, `no_train_test_overlap`, `target_not_in_features`, `trained_steps`, `seed`. Tell
the part these are recorded and later cross-checked; an incomplete block is flagged. (For tasks where
a key is genuinely N/A, the part still sets it — e.g. `target_not_in_features: true` for a generative
task — and explains in `notes`.) Honor-system; the mechanical teeth are the §4.1/§4.3 checks.

## 8. Files

- **New:** `src/core/rehearsalSanity.ts` — pure checks (`ceilingFlag`, `underRunFlag`, `logErrorFlag`,
  `integrityFlag`, an orchestrating `sanityFlags(...)`) + `sanityRow` tsv render.
- **Modified:** `src/core/rehearsalMetric.ts` (optional `ceiling`, `minRuntimeS` on
  `MetricThresholds` + parse), `src/core/rehearsalScore.ts` (invoke `sanityFlags` + per-exp audit-diff;
  return `sanityRows`), `src/commands/rehearsal.ts` (`scoreWith` writes `sanity.tsv`; `statusBriefWith`
  joins it; finalize folds into `## Warnings`), `src/core/rehearsalBrief.ts` (suspect annotation),
  `src/core/rehearsalResult.ts` (optional `integrity` field on `ResultJson` — type only),
  `config/prompt-templates/rehearsal/experiment.md`, `commands/rehearsal.md`, `tests/rehearsal-*.test.ts`,
  `dist/consort.cjs`, the 3 version manifests.

## 9. Testing

- `rehearsalSanity`: ceiling over/under per direction; under-run vs floor (incl. default 1.0); each
  log marker present/absent; integrity complete / missing-key / absent; the orchestrator returns the
  union of flags; clean result => no flags.
- `metric.md`: parses `ceiling` + `min_runtime_s`; undefined when absent.
- score pass: a verify-less, clean result yields zero sanity rows (no regression); a ceiling-busting
  result yields the row; per-exp audit-diff emits `audit-knob-drift`.
- `status-brief`: joins `sanity.tsv` and annotates top-3; absent file => no annotation; `scoreboard.md`
  shape unchanged.
- No real subprocess/FS in unit tests (injected log-reader / FS), per house style. Stale-token gate
  green; frozen fields untouched.

## 10. Acceptance criteria

1. A `metric_value` past the `metric.md` ceiling (direction-aware) => `ceiling-exceeded` row in
   `sanity.tsv`, `[suspect: ceiling-exceeded]` in `status-brief`.
2. `status=ok` + `runtime_s` below floor => `under-run`; `status=ok` + a `Traceback` in a log =>
   `log-contradiction`.
3. Absent/incomplete `integrity` block => `integrity-attestation-incomplete` listing the missing keys.
4. A mandated hard-constraint knob whose `audit.json` value differs => `audit-knob-drift` at
   score-time (not only finalize).
5. A clean result (within ceiling, ran long enough, clean logs, complete integrity, knobs match)
   produces NO sanity rows; `sanity.tsv` absent => `status-brief`/finalize behave exactly as before.
6. `scoreboard.md` shape byte-identical; A1's `verification.tsv` / verdict untouched and orthogonal.
7. All gates green (typecheck / vitest / lint / stale-tokens / build); version bumped; `dist` rebuilt.

## 11. Out of scope (later phases)

A2 (act on suspect/mismatch: re-dispatch / INFEASIBLE-vs-REFUTED), C1 (verify the `integrity`
attestation via independent re-implementation), the smoke-test/context-file environment gate (still
deferred), B1/B2 (coverage/operators), and the A4 K-streak direction bug.
