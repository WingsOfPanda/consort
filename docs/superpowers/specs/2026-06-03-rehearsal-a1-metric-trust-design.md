# Rehearsal A1 — metric trust (verify-by-re-execution) design

**Status:** approved design (2026-06-03), pending implementation plan. Phase **A1** of the rehearsal
research-validity roadmap (`docs/superpowers/specs/2026-06-03-rehearsal-research-validity-roadmap.md`).

## 1. Problem

`/consort:rehearsal` steers an autoresearch loop on each part's **self-reported** `metric_value`.
`validateResult` (`src/core/rehearsalResult.ts`) checks the metric's *shape* (non-null when
`status=ok`, name matches the locked metric, log files exist) but **never its correctness**: the
Maestro never re-runs code, recomputes the metric, or reads the log to corroborate the number
(`config/prompt-templates/rehearsal/experiment.md` step 3 has the part compute the metric itself).
A confidently-reported wrong number passes every gate, so a good idea botched by a buggy/non-
deterministic execution is recorded as a refuted idea, and the loop steers on fiction. **A metric is
currently a claim treated as evidence.** A1 makes that claim *checkable*.

## 2. Constraints that shaped the design (clarified during brainstorming)

- **Task shape: fully open-ended.** Experiments can be anything (supervised, RL/self-play, systems,
  generative, simulation); the part fetches its own data and defines its own metric. The harness
  cannot assume a common eval structure, so it **cannot independently compute** an arbitrary metric,
  and a Maestro-owned sealed holdout is not definable. => A1 cannot "recompute the metric"; it
  **re-executes the part's own scoring step and checks reproduction**.
- **Threat model: adversarial gaming is in scope — but cannot live in A1 alone.** For an open-ended
  task the harness can't author a task-specific checker, so it can only re-run the *part's* scoring
  code; an adversarial part can ship a verifier that fabricates the number. Genuine anti-gaming for
  open-ended work requires an *independent re-implementation* (phase **C1**), sealed Maestro-owned
  inputs (only where the metric type permits), or OS-level isolation. Therefore A1 is the
  **verification substrate**: re-execution reproducibility + provenance/tamper hashing + a
  first-class verdict that **C1 and A3 plug into**.
- **Metric shape: both separable and intrinsic.** Some metrics have a cheap separable re-score over
  a saved artifact; others are intrinsic to the run (peak memory, convergence steps). A1 supports a
  cheap `rescore` path and a costly, opt-in `rerun` path, and the verdict marks which (or
  `unavailable`).
- **Additive / frozen-protocol safe.** All changes are additive: a new optional `verify` block in
  `result.json`, new harness verbs, new state files. No frozen wire token is renamed (event names,
  `END_OF_INSTRUCTION`, existing `result.json` fields, `contracts.yaml` keys, state filenames).
- **Explore-only preserved.** Nothing here promotes to production code.

## 3. Architecture (Approach 1 — Maestro-executed, CLI-adjudicated)

The trust boundary is **untrusted part vs trusted Maestro**. The Maestro (a Claude session, a
different model family from the codex parts) re-executes the part's declared scoring step **outside
the part's pane** — that is the independent re-derivation. The **consort CLI never execs untrusted
part-authored code**; it only *plans* the re-execution and *adjudicates* the result, staying pure
(file logic + emit), consistent with "tmux is the only subprocess surface."

Rejected alternatives: a CLI `verify` verb that execs the command (violates the subprocess rule +
runs untrusted code + hard to unit-test); a pure-directive design with no CLI (the comparison/
provenance/verdict become un-tested LLM judgment, defeating the point of a *mechanical* gate).

## 4. Data model

### 4.1 The `verify` block (additive, optional `result.json` field)

The part emits, alongside the existing schema:

```json
"verify": {
  "kind": "rescore" | "rerun" | "none",
  "command": "python score.py --preds ./predictions.json",
  "inputs": ["./predictions.json", "./checkpoint.pt"],
  "metric_from": "marker" | "./verify-out.json"
}
```

- **`kind=rescore`** — command re-derives the metric from saved artifacts **without retraining**
  (cheap). Verified by default for every ok result.
- **`kind=rerun`** — re-runs the whole experiment (intrinsic metric). Costly => verified selectively
  (Section 6).
- **`kind=none`** — part declares it cannot provide a re-derivation => verdict `unavailable`. Never
  blocks.
- **`command`** — what the Maestro runs in the clean cwd; the part is told to seed/pin for
  determinism.
- **`inputs`** — files the command reads; hashed at score-time for provenance.
- **`metric_from`** — how the harness reads the recomputed number: `"marker"` (command prints
  `VERIFY_METRIC=<number>` as its last stdout line) or a path to a JSON file the command writes
  (`{"metric_value": <n>}`).

A result with no `verify` block => verdict `unavailable reason=no-contract` (back-compatible: old
parts that never emit one are simply unverified, not rejected).

### 4.2 The verdict (harness-written)

One verdict per experiment:

- **`verified`** — recomputed within epsilon of self-reported `metric_value` => trusted.
- **`mismatch`** — recomputed differs beyond epsilon, OR the re-run errored / produced no marker, OR
  a provenance hash changed (tamper) => **not trusted, flagged loudly**.
- **`unavailable`** — `kind=none`, no `verify` block, missing input, or `rerun` never authorized =>
  metric admitted but flagged as a claim.
- **`pending`** — just landed / `rerun` deferred this round (visible, never silently "verified").

Epsilon: `|recomputed - reported| <= epsilon` (direction-independent equality check). Reuses the
existing numeric compare (`numEq`, default `0.01`); `metric.md` may carry an optional
`verify_epsilon`.

## 5. Execution flow

### 5.1 `rehearsal verify-plan <topic> <instrument> <exp-id> [--authorize-rerun]` (pure)

(The verbs take `<instrument>` as well as `<exp-id>` because exp-ids repeat across parts — an
experiment is located by `experimentDir(art, instrument, expId)`.)

Reads the experiment's `verify` block and emits a plan:
- no block / `kind=none` => `VERDICT=unavailable reason=...`.
- `kind=rerun` without `--authorize-rerun` => `VERDICT=pending reason=rerun-deferred`.
- otherwise re-hashes each `inputs` file (`sha256` via `node:crypto`) against the score-time
  `verify-manifest.json`:
  - hash changed => `VERDICT=mismatch reason=provenance:<file>` (tamper — do not run).
  - input missing => `VERDICT=unavailable reason=missing-input:<file>`.
  - clean => emits `RUN_CWD=<exp-dir>`, `RUN_CMD=<command>`, `METRIC_FROM=<marker|path>`.

A **terminal** verdict (no Maestro run needed — `unavailable` / `pending` / provenance-`mismatch`)
is **persisted to `verification.tsv` by `verify-plan` itself**; only the clean/runnable case defers
the verdict to `verify-check` after the Maestro runs the command. If `verify-manifest.json` is
absent (the score pass has not run yet) => `VERDICT=unavailable reason=no-manifest`. Both verbs keep
a pure core (returns the verdict + intended writes) that the verb applies, mirroring `computeScore`.

### 5.2 `rehearsal verify-check <topic> <instrument> <exp-id> (--stdout-file <path> | --run-failed)` (pure)

Adjudicates and writes the verdict (plan/apply split, mirroring `computeScore`):
- reads the recomputed metric from the run's captured stdout (`--stdout-file <path>`): the last
  `VERIFY_METRIC=<n>` marker line, or a JSON file's `metric_value` per `metric_from` — parsed
  mechanically by the CLI, not hand-passed by the Maestro.
- `--run-failed` => `mismatch reason=rerun-failed` (a re-run that won't reproduce is a red flag).
- else `|recomputed - reported| <= epsilon` => `verified`, else `mismatch reason=value:<r>vs<reported>`.
- writes per-exp `verification.txt` + appends a row to top-level `verification.tsv`
  (`exp_id \t instrument \t verdict \t reason \t recomputed \t ts`).

### 5.3 Provenance — when

The `score` pass already runs after every `done`. A1 extends `computeScore`: on first seeing a valid
`result.json` that carries a `verify` block, it snapshots `sha256(inputs)` + the command into
`verify-manifest.json` next to the result (idempotent — written once). The part has emitted `done`
and is idle by score-time, so the inputs are stable; `verify-plan`'s re-hash catches post-emit
tampering. (This catches *post-hoc* tampering, not a fake-from-the-start verifier — that is C1.)

### 5.4 The Maestro loop step (`commands/rehearsal.md` Step 3, after `score`/`status-brief`)

1. `$CS rehearsal verify-plan <TOPIC> <instrument> <exp>` (add `--authorize-rerun` only when the
   result is a new best / direction-changing).
2. If it printed `RUN_CMD`: the Maestro runs that command via **Bash** in `RUN_CWD`, with a timeout,
   teeing stdout to a temp file.
3. `$CS rehearsal verify-check <TOPIC> <instrument> <exp> --stdout-file <path>` (or `--run-failed` if
   the command errored / emitted no marker).

The Maestro running the command via its own Bash tool **is** the independent re-execution. The CLI
only plans and adjudicates.

### 5.5 Surfacing — no scoreboard schema change

The verdict deliberately stays **out of `scoreboard.md`**: adding a column would shift the indices
that `checkCompletion.parseRows` and `status-brief.parseTopRows` depend on (and bump
`schema_version`). Instead the verdict lives in `verification.tsv`, and `status-brief` **joins it by
exp-id** to annotate its top-3 (`verified` / `mismatch!` / `unavailable` / `pending`).
`scoreboard.md` stays byte-identical in shape; existing parsers are untouched.

## 6. Budget rule (When-To-Verify)

- `kind=rescore` (cheap) => verify **every** ok result (default-on).
- `kind=rerun` (costly) => verify **selectively** via `--authorize-rerun`, only for a *new best* or a
  *direction-changing* result. Deferred re-runs are recorded `pending reason=rerun-deferred`
  (visible — no silent cap), never treated as verified.

## 7. Boundaries — what A1 does NOT do

- Does **not** gate ranking or exclude `mismatch` rows => **A2** (valid-vs-invalid + re-dispatch).
- Does **not** catch leakage / self-consistent-but-wrong evals => **A3**.
- Does **not** independently re-implement the eval => **C1**. A1's `verification.tsv` + verdict
  schema is the substrate C1/A3 write into.

## 8. Template change (`config/prompt-templates/rehearsal/experiment.md`)

Add a step after the result.json step: emit the `verify` block — a command that re-derives
`metric_value` from saved artifacts **without retraining** (`rescore`), or declare `rerun`/`none`;
print `VERIFY_METRIC=<n>` (or write `verify-out.json`); seed/pin for determinism; list the exact
`inputs` the command reads. Honor-system on *providing* a faithful contract (gaming => C1); the
harness *executing* it independently is the mechanical part. The done-event contract and
`END_OF_INSTRUCTION` are unchanged.

## 9. Files

- **New:** `src/core/rehearsalVerify.ts` — `planVerify` / `checkVerify` pure logic + manifest hashing.
- **Modified:** `src/commands/rehearsal.ts` (two verb dispatches + live deps + usage string),
  `src/core/rehearsalScore.ts` (write `verify-manifest.json` once), `src/core/rehearsalBrief.ts`
  (join `verification.tsv` into the top-3), `config/prompt-templates/rehearsal/experiment.md`,
  `commands/rehearsal.md` (Step 3 verify loop), `tests/rehearsal-*.test.ts`, `dist/consort.cjs`,
  the 3 version manifests.

## 10. Testing

- `planVerify`: none / no-block / rerun-deferred / provenance-mismatch / missing-input / clean-emit;
  sha256 over fixture files.
- `checkVerify`: epsilon within/beyond; `--run-failed` => mismatch; sidecar + tsv writes
  (plan/apply split).
- score-pass: writes `verify-manifest.json` once on first valid verify-bearing result; idempotent.
- `status-brief`: joins `verification.tsv` and annotates top-3; absent tsv => no annotation
  (back-compat); `scoreboard.md` shape unchanged.
- No real subprocess in unit tests (the Maestro's Bash run is live-dogfood only), consistent with
  "tmux/exec is never spawned in unit tests."
- Stale-token gate stays green; frozen-protocol fields untouched.

## 11. Acceptance criteria

1. A part emitting a `verify` block of `kind=rescore` whose command reproduces the metric =>
   `verified` in `verification.tsv`, annotated in `status-brief`.
2. A reported metric that the re-run does not reproduce within epsilon => `mismatch` (not silently
   trusted).
3. A tampered input (hash changed since score-time) => `mismatch reason=provenance` without running
   the command.
4. `kind=none` / no block / missing input => `unavailable`; `kind=rerun` without authorization =>
   `pending reason=rerun-deferred` (both visible).
5. `scoreboard.md` shape is byte-identical; `checkCompletion` and existing `status-brief` parsing
   are unaffected when `verification.tsv` is absent.
6. All gates green (typecheck / vitest / lint / stale-tokens / build); version bumped; `dist`
   rebuilt and committed.

## 12. Out of scope (later phases)

A2 (act on `mismatch`: re-dispatch / INFEASIBLE-vs-REFUTED), A3 (leakage/sanity gates + the
`--smoke-test` wiring moved here from C0), B1/B2 (coverage/operators), C1 (independent
re-implementation — the real open-ended anti-gaming muscle), and the A4 K-streak direction bug.
