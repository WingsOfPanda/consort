# Rehearsal research-validity upgrade — roadmap

**Status:** approved scope + sequence (2026-06-03). This is a roadmap/epic, not a single
design spec. Each phase below is its own future `brainstorm -> spec -> plan -> ship` cycle and
gets its own `docs/superpowers/specs/` design doc when started. Confirmed execution order:
**C0 -> A1 -> A3 -> A2 -> B1 -> B2**, with the heavy tail (**A4 / B3 / C1**) deferred and
reconsidered after B2.

## Why this exists

`/consort:rehearsal` is an AIDE-style autoresearch loop: the Maestro locks a metric, sweeps SOTA,
spawns 2-3 persistent codex parts, and adaptively dispatches single-config experiment ideas until a
stop condition. Two core questions motivated a literature + codebase audit (2026-06-03):

- **Q1 (execution validity):** how do we ensure a bad metric reflects a bad IDEA, not a
  buggy/misconfigured/leaky/under-trained EXECUTION?
- **Q2 (idea coverage & direction):** how do we ensure the Maestro generates the right diverse set
  of angles and steers the next round well, rather than converging prematurely or chasing a
  misleading metric?

**The one-sentence thesis both questions reduce to:** a part's self-reported metric is a *claim, not
evidence* — and rehearsal currently treats it as evidence. `validateResult`
(`src/core/rehearsalResult.ts:39-62`) checks the metric's *shape* (non-null number when `status=ok`,
name matches the locked metric, log files exist) but never its *correctness*; the Maestro never
re-runs code, recomputes the metric, or reads the log to corroborate the number. Every downstream
mechanism (scoreboard, plateau, completion, steering) rests on an unverified self-report. The SOTA
fix is to move from honor-system trust to mechanical gates, and to **decouple idea-quality from
execution-quality: only an execution-verified negative result may retire an angle.**

## Constraints (apply to every phase)

- **Additive only** — new optional `result.json` fields, new harness verbs, new state files. No
  frozen wire token is renamed (event names, `END_OF_INSTRUCTION`, existing `result.json` field
  names, `contracts.yaml` keys, state filenames, `CLAUDE_CODE_SESSION_ID` stay byte-identical). A
  new status distinction (e.g. INFEASIBLE) is expressed via a *new optional field*, not by mutating
  the frozen `status` enum unless a phase spec deliberately decides otherwise.
- **Explore-only preserved** — nothing here promotes to production code; promotion remains
  `/consort:perform`.
- **Faithful-port baseline** — rehearsal today is a faithful port of clone-wars `deep-research`, a
  *bookkeeping* harness that delegated scientific validity to the Maestro's taste + honor-system
  prose in `config/prompt-templates/rehearsal/experiment.md`. This upgrade is new behavior, not a
  parity fix; each phase is spec-worthy.

## Track C — cross-cutting

### C0 · Quick wins & groundwork  — SHIPPED in 0.1.12 (commit 7f57ec6)
- DONE: Fixed the **scoreboard minimize-direction sort bug**. `buildScoreboard`
  (`src/core/rehearsalResult.ts`) sorted descending unconditionally (faithful port of
  deep-research.sh `sort -k1,1rn`), so for a minimize objective the "top-3", the handoff winner, and
  the teardown winner symlink were all the WORST rows. `parseMetricMd` now reads `**Direction:**`,
  and `buildScoreboard`/`computeScore` sort best-first by direction (maximize stays byte-identical).
  Documented as a deliberate divergence from deep-research inline at `buildScoreboard`.
- MOVED to A3: the **`--smoke-test` / `--context-file`** wiring. Wiring it meaningfully needs a
  generated environment-probe script + a decision on what it asserts (the experiment `code/` dir is
  empty at the Phase-4 first dispatch), so it is an A3 sanity-gate design question, not a quick win.
- FOLDED into A1: the **additive `result.json` extension convention**.

### C1 · Independent re-implementation inspector  (large; expensive; selective — do last)
- AIRepr-style round-trip: the **Claude Maestro (cross-family)** regenerates the experiment from the
  part's structured run-card alone and re-derives the metric — only for new-best / direction-changing
  runs (When-To-Verify budgeting). Cross-family avoids the correlated-blind-spot trap of
  codex-judging-codex.
- *Closes:* "consensus is opt-in, latest-ok-only, compares self-reports"; "direction quality has no
  adversarial/external check." *Cost: high (extra full run). Deps: A1, B2.*

## Track A — execution validity (Q1)

### A1 · Metric trust (the keystone)  (medium; highest leverage)
- Harness recomputes the metric from the part's **saved predictions** against a **sealed holdout the
  part cannot read or write**; self-reported `metric_value` becomes a cross-check (reject on
  mismatch). Cheap variant: re-score from artifacts rather than re-train.
- *Closes:* gap "no independent metric re-computation"; "metric_name match is name-only". *Mechanism:*
  "only grader-measured performance counts" (reward-hacking benchmarks). *Cost: medium. Deps: C0.*

### A3 · Sanity & integrity gates  (medium; cheap mechanical; feeds A2)
- Degenerate-output (non-constant preds, no NaN/inf); **under-training floor** (min steps / runtime
  floor / learning-curve sanity); **leakage attestation** + adversarial-validation AUC + **too-good-
  to-be-true ceiling -> mandatory audit**; **log-content corroboration** (parse `log_paths`, not just
  existence); harden the **audit.json diff** (`src/commands/rehearsal.ts:887-912`) to run
  per-experiment, not only at finalize.
- **Pre-dispatch environment validation (moved from C0):** wire the dormant `--smoke-test` /
  `--context-file` gates (`src/commands/rehearsal.ts:378-388`, never passed by the Maestro at
  `commands/rehearsal.md:158,265`) — including generating the environment-probe script and deciding
  what it asserts, since the experiment `code/` dir is empty at the first dispatch.
- *Closes:* gaps "no leakage check", "no under-training/degenerate detection", "no sanity baseline",
  "audit diff narrow/advisory/late", "log existence != content", "smoke-test/context-file dormant in
  the shipped flow". *Mechanism:* Kapoor & Narayanan leakage taxonomy; MLE-bench structure
  validation. *Cost: low. Deps: C0.*

### A2 · Valid-vs-invalid execution  (medium; the original concern)
- **INFEASIBLE vs REFUTED** taxonomy (new optional `validity` field) + a **bounded automatic debug
  loop** (hard cap: N rounds / M minutes) before a metric counts as real. Extend the self-correction
  loop (`src/core/rehearsalScore.ts:64-75`; `experiment.md:182-186`) from contract-errors-only to
  execution-validity ("your run looks under-trained / leaky").
- *Closes:* gap "validation self-correction covers only contract errors". *Mechanism:* AIDE
  `is_buggy` triple-rule; AIRA bounded debug (10 nodes / 12h). *Cost: medium. Deps: A3 detectors, A1.*

### A4 · Noise & reproducibility  (large; cost multiplier; deferred tail)
- Multi-seed (vary full nuisance set, not just init); **statistical gate** (paired bootstrap CI
  lower-bound > 0 AND sign-flip permutation p < 0.05, or ASO eps < 0.2 with multiple-comparison
  correction); **K-corroboration re-runs the SAME config** (today
  `src/core/rehearsalComplete.ts:45-92` counts distinct at-target experiments, so a lucky seed
  satisfies completion); sub-threshold deltas -> "inconclusive", never ranked by raw mean.
- **K-streak direction bug (found during C0):** `checkCompletion`'s streak uses
  `improving = mv > best` (`src/core/rehearsalComplete.ts:73`), assuming higher-is-better regardless
  of `direction`, so the strictly-improving-at-target streak is wrong for `minimize` objectives. Fix
  alongside the seed/completion rework.
- *Closes:* gap "no reproducibility / seed control" + the minimize K-streak bug. *Mechanism:* Paired
  Bootstrap Protocol; deep-significance/ASO; seed power analysis. *Cost: high (kx runs). Deps: A1.*

## Track B — idea coverage & direction (Q2)

### B1 · Coverage & diversity guard  (medium; cheap & high value)
- Mechanical **approach-family taxonomy + MAP-Elites coverage archive**; **dedup new ideas against
  the ledger** (near-duplicate dispatch alarm; `experiment-send` currently never inspects
  `approach_label`, `src/commands/rehearsal.ts:356-468`); **approach-aware plateau** (today's plateau
  `rehearsalComplete.ts:84-88` looks only at the spread of the last 5 metric values regardless of
  which approach produced them, so tuning one family reads identically to a global plateau); track
  running unique-idea count as a premature-convergence alarm.
- *Closes:* gaps "no mechanical coverage/diversity guard", "premature convergence unguarded",
  "plateau narrow/gameable". *Mechanism:* Si et al. diversity collapse; MAP-Elites / Quality-Diversity.
  *Cost: low-medium. Deps: none (operates on approach labels).*

### B2 · Operators & ideation quality  (medium; the proven direction bottleneck)
- Enforce **one measurable change vs a named parent** (`parent_id` + single changed field; reject
  multi-variable ideas at dispatch); **structured discovery lenses** + verbalized sampling in the
  ideation prompt; **pairwise/Swiss ranking** for "which angle next" (not absolute self-scores);
  prompt-adaptive boldness; re-ground ideation against SOTA (today the Phase-1.5 sweep is write-once
  and decoupled from idea selection).
- *Closes:* gaps "diversity prompt-enforced not mechanical", "SOTA stale and decoupled". *Mechanism:*
  AIRA ("operators, not search, are the bottleneck"); Nova discovery lenses; Verbalized Sampling.
  *Cost: medium (mostly template + dispatch-validation). Deps: B1.*

### B3 · Search, budget & steering  (large; lowest marginal value; deferred tail)
- Greedy-best-first + epsilon-revisit selection over the experiment tree; **ASHA cheap-fidelity
  rungs** (promote top-1/eta); periodic **stage-gate re-rooting** (judge trustworthiness, not just the
  number); held-out steering + **robust top-k final selection** at the stop (vs today's single-best
  crown).
- *Closes:* gaps "direction has no external check", "lane-D prunes parts not ideas". *Mechanism:*
  AIRA / "Greedy Is a Strong Default" (do NOT build this first); AI Scientist v2 stage gate; ASHA.
  *Cost: high. Deps: A1, B1.*

## Dependency graph

```
C0 ──► A1 ──► A2        A3 ──► A2
       │                 ▲
       ├──► A4           └── C0
       ├──► B3
       └──► C1 ◄── B2 ◄── B1
```

Keystone is **A1**; **A3 feeds A2**; **B1 is cheap and unblocks B2/B3**; **A4, B3, C1 are the
heavy/expensive tail** and may be cut or deferred given the explore-only wall-clock budget.

## Source base

Synthesized from a 2026-06-03 triple-search literature sweep + codebase grounding (10 agents). Key
references: AIDE (arXiv:2502.13138), AIRA / AIRA-dojo (arXiv:2507.02554) + AIRA^2 (arXiv:2603.26499),
"Greedy Is a Strong Default" (arXiv:2603.27415), MLE-bench (arXiv:2410.07095), R&D-Agent
(arXiv:2505.14738), Si et al. "Can LLMs Generate Novel Research Ideas?" (arXiv:2409.04109), Nova
(arXiv:2410.14255), Verbalized Sampling (arXiv:2510.01171), the Ideation-Execution Gap
(arXiv:2506.20803), AI Scientist v2 (PMC13017497) + Beel et al. audit (arXiv:2502.14297) + Yu et al.
Hidden Pitfalls (arXiv:2509.08713), reward-hacking benchmarks (arXiv:2511.21654 / 2603.11337 /
2605.02964), AIRepr (arXiv:2502.16395), When-To-Verify (arXiv:2504.01005), Paired Bootstrap Protocol
(arXiv:2511.19794), deep-significance/ASO, seed power analysis (arXiv:1806.08295), Kapoor & Narayanan
leakage (Patterns 2023) + REFORMS, ASHA (OpenReview S1MAriC5F7), MAP-Elites / Quality-Diversity.
