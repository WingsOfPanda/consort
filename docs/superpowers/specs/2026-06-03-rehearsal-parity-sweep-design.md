# rehearsal parity sweep — design

**Status:** approved (brainstorm 2026-06-03)
**Ships:** consort `0.1.11`
**Source of findings:** a 6-dimension adversarial parity+correctness audit of consort `rehearsal` vs
clone-wars `deep-research` (42 candidate findings → 22 confirmed real → 8 distinct issues after dedup).
The core math (completion/plateau/K-streak, monitor liveness, finalize reconcile/normalize/prune,
consensus, scoreboard sort) ported with near byte-level fidelity — **no core-logic regressions**. The
confirmed tail is one reliability seam, a degraded-spawn functional gap, dropped documentation, and a
spec↔code contradiction.

> Grounding note: this doc references clone-wars terms (`deep-research`, `trooper`, `commander`, `Yoda`)
> only for traceability. The stale-token gate scans `src`/`config`/`commands`/`hooks`/`.claude-plugin`,
> **not** `docs/`, so those terms are allowed here. Restored prose must use the consort rebrand.

---

## 1. Scope

Fix all 8 distinct issues in **one cohesive branch / PR**, grouped by surface. The user chose the
**pragmatic** parity stance: fix every real bug, restore dropped safety + observability documentation,
reconcile the one spec↔code contradiction, and for the two places consort deliberately simplified
(genericized arena helper, in-flight-slug hard-error) **keep consort's choice and document it as
intentional** rather than reverting.

The **frozen wire protocol is untouched**: `result.json` flat schema, outbox events
`ready/ack/progress/done/error/question`, the `END_OF_INSTRUCTION` sentinel, `inbox.md` fence shape,
`CLAUDE_CODE_SESSION_ID`, and `contracts.yaml` keys all stay byte-identical. The stale-token gate stays
green (every restored line rebranded; no `clone-wars`/`cw_`/`trooper`/`commander`/`master-yoda`/
`MISSION ACCOMPLISHED`/`@cw_`).

---

## 2. Group A — code reliability fixes (`src/`)

### A1. Inbox hands the part two conflicting `done` instructions (medium)

**Problem.** `experiment-send` renders `experiment.md` (whose step 5 specifies the exact
`{"event":"done","summary":"experiment {{EXP_ID}} metric=<value> status=<status>", ...}`) into
`prompt.md`, then wraps it with the **generic** `inboxWrite` (`src/core/ipc.ts:14-21`), which appends a
**second** done instruction — `summary":"<one-line summary>"` — as the LAST line before
`END_OF_INSTRUCTION`. The part is most likely to obey the trailing generic one and emit a summary with
no `exp-NNN` in it. The inline loop's Step 3 (`commands/rehearsal.md`) derives `LAST_EXP` from that
summary, so the status-brief render gets the wrong value. clone-wars fenced the inbox as
`cat prompt.md + END_OF_INSTRUCTION` — a single clean contract. No test catches it
(`tests/rehearsal-cmd.test.ts` only asserts `END_OF_INSTRUCTION` is present).

**Fix.** Give `inboxWrite` an opt-in to suppress the generic done block:
`inboxWrite(i, m, t, task, { from, noDoneInstruction? })`. When `noDoneInstruction` is true the fence is
`From: <from>\n\n<task>\n\nEND_OF_INSTRUCTION\n` (no generic done line). `experiment-send` passes
`{ from: "maestro", noDoneInstruction: true }` so the experiment template's specific done instruction is
the **sole** done contract. All other callers (un-changed) keep the generic block. **Frozen-safe** — we
remove a *duplicate* human-facing instruction, not the `done` event name or `END_OF_INSTRUCTION`.

### A2. Degraded-proceed seeds a Monitor for a dead part (medium)

**Problem.** On Stage-2 partial spawn success the Phase-3 prose says "drop the failed instruments and
continue," but there is **no mechanical step to prune `parts.txt`** — `spawnAllWith`
(`src/commands/rehearsal.ts:212`) writes the **full** roster to `parts.txt` before spawn outcomes are
known and never rewrites it. Phase 4 then iterates `parts.txt` verbatim: `mkdir`s an experiments dir,
writes `state.txt`, and starts a **persistent Monitor for an instrument whose pane never came up**.
`perform` already has a `drop-part` verb (`src/commands/perform.ts:773-789`) for exactly this; rehearsal
has none.

**Fix.** Add a `drop-part <TOPIC> <instrument>` verb to `src/commands/rehearsal.ts`, mirroring perform's
`dropPartRun`: atomically rewrite `<art>/parts.txt` removing the failed instrument's row (1-col format:
`line === instrument`; trailing-newline / empty-file convention preserved so Phase 4 reads it
transparently); print `N=<remaining>`. **It also best-effort kills that instrument's preflight pane**
(reads `<art>/preflight-panes.txt`, kills only that instrument's pane — never the kept parts'), folding
in the orphan-pane cleanup (audit DR2-3) so the degraded path doesn't leave a sentinel pane lingering
until final teardown. Wire into the verb dispatch and the usage string. Phase-3 degraded prose calls it
per rc≠0 row of `spawn-results.tsv` before falling into Phase 4.

### A3. Preflight-double-fail can read a stale `spawn-results.tsv` (low)

**Problem.** `spawnAllWith` returns `2` on a preflight failure (`rehearsal.ts:215`) **before** writing
`spawn-results.tsv`, and never clears a stale one from a prior attempt; the all-spawn-fail path also
tallies to `2` after writing the file. The merged verb therefore can't tell the Phase-3 prose whether a
`2` was a preflight failure (clone-wars: unrecoverable → teardown + exit, no degraded prompt) or an
all-spawn failure (clone-wars: degraded prompt if ≥2 succeeded), so a preflight-double-fail can be
routed through the degraded `AskUserQuestion` reading attempt-1's stale rows.

**Fix.** (1) Clear any stale `spawn-results.tsv` at the top of `spawnAllWith` so a preflight-fail return
cannot leave prior rows behind. (2) Return a **distinct rc** for preflight failure (`3`) vs all-spawn
failure (`2`). Update the Phase-3 prose: a preflight-class failure after retry goes straight to
teardown + archive + exit (no degraded prompt); the "read `spawn-results.tsv` / Proceed degraded" branch
is reserved for spawn-class failures only.

### A4. Per-experiment timeout env-override dropped; spec↔code contradiction (low)

**Problem.** The spec twice states the per-experiment cap is "1800s, **env-overridable**"
(2026-05-30 design §3, §5, §12) but `consultTimeout("experiment")` (`src/core/contracts.ts:63-67`) reads
only `contracts.yaml` + the 1800 default — no env tier. clone-wars layered a middle tier
(`CW_DEEP_RESEARCH_EXPERIMENT_TIMEOUT_OVERRIDE`) at the experiment-send call site. Sibling consort
commands keep this pattern (`score.ts` `CONSORT_DRILLDOWN_TIMEOUT_S`; `perform.ts` `CONSORT_PERFORM_*`).

**Fix (localized, low blast radius).** In `src/commands/rehearsal.ts`, make
`liveExperimentSendDeps.consultTimeout` read `process.env.CONSORT_REHEARSAL_EXPERIMENT_TIMEOUT_OVERRIDE`
(positive-integer guard `^[1-9][0-9]*$`) before falling through to `consultTimeout("experiment")` —
mirroring `score.ts`'s `CONSORT_DRILLDOWN_TIMEOUT_S`. Precedence becomes `--timeout flag > env >
contracts.yaml/1800` (the flag already wins via `p.timeout ?? deps.consultTimeout()`). **No
`core/contracts.ts` change** (keeps the change scoped to rehearsal). This makes the spec's twice-stated
claim true. Document the env var in a `## Budget overrides` note in `rehearsal.md`.

### A5. Consensus numeric class admits degenerate tokens (info)

**Problem.** `rehearsalConsensus.ts` classifies `-`/`.`/`+`/`eE`-only tokens as NUMERIC (the regex
`/^-?[0-9.eE+-]+$/`) then compares with `parseFloat` → `NaN` (so `NaN <= ε` is false → always
"Contested"). bash awk coerces a degenerate token to `0`. Theoretical (real `metric_value`/`runtime_s`
fields never produce these), but a byte-parity gap.

**Fix.** Make `numEq` coerce `NaN → 0` to match awk: `const num = (s) => { const n = parseFloat(s);
return Number.isNaN(n) ? 0 : n; }`. Two lines + a unit test.

---

## 3. Group B — documentation restorations (`commands/rehearsal.md`, rebranded)

All prose-only; no code change. Rebrand every restored line (trooper→part, Master Yoda/Yoda→Maestro,
`deep-research`→`rehearsal`, `/clone-wars:deep-research`→`/consort:rehearsal`, `_deep-research/`→
`_rehearsal/`); drop clone-wars-version-specific wording (`since v0.27.0`, etc.).

- **B1. Safety docs (medium).** Restore a top-of-file **DANGER banner** (parts run under
  `--dangerously-bypass-approvals-and-sandbox`; parts write + execute arbitrary code; honor-system
  sandbox, not enforced; net access permitted by default; do not run with sensitive credentials /
  production data / shared state; use a scratch worktree if uncertain) and a **`#### Security note`**
  under Phase 1.5 (web + part-side net is honor-system; hard-block at OS/firewall/network-namespace
  level; no opt-out flag). Add a one-line risk note to the rehearsal design spec so it reads as intent.
- **B2. Observability (low).** Add `TodoWrite` to the `allowed-tools` frontmatter and restore a
  **`## Task list`** phase checklist (one row per phase 0–7, mirroring `commands/prelude.md`) with
  `Set task N → in_progress/completed` markers at the existing phase boundaries, plus an optional
  per-dispatch sub-row (`<instrument> exp-NNN on <approach-label>`) in the inline loop's Step 5. Restore
  the **`## Intervention patterns`** section (panes stay attached; the Maestro regains control between
  every sub-step; send a clarifying prompt via `$CS send` on a hang / garbage `result.json` / cost
  overrun without `cost_blown`).
- **B3. Monitor field-name drift (info).** Step 3 reads the `instrument` field from the notification
  JSON, but `rehearsalMonitor` emits the key `part` (`MonitorNotification = { part, event, summary, ts }`).
  One-word prose fix: `instrument` field → `part` field. Compounds with A1's reliability.
- **B4. Minor prose parity (low/info).** Restore the SOTA **constraint-query skip-if-absent** clause
  under Phase 1.5 (only emit `<topic> under <constraint>` when `metric.md` has a `hard_constraints`
  value); restore the `score-handoff` **header preamble (topic H1 + Source + Generated)** and the
  **no-winner Open-questions** allowance under Phase 6c; restore the 4 dropped **optional `halt.flag`
  keys** (`plateau_observed_n`, `final_leader`, `final_leader_metric`, `architectures_corroborated`) to
  the Step 4 documented vocabulary; add the **`## Budget overrides`** note (A4's env var).

---

## 4. Group C — divergences blessed as intentional (document, do not revert)

Per the pragmatic stance, add a short "intentional divergences" note to the rehearsal design spec for
each, so a future audit does not re-flag them as accidental drops:

- **C1. Genericized `arena_color_rotated` helper (REH-7).** `config/prompt-templates/rehearsal/
  experiment.md` advertises a generic `{{ART_DIR}}/lib/` helper directory instead of clone-wars' concrete
  `arena_color_rotated(model_a, model_b, ...)` signature. `arena.py` is still seeded into `lib/`; the
  README/docstring is the discovery path. Kept generic on purpose — not every research topic is a board
  game. (Optionally add a one-line "available helpers" pointer that names `arena.py` without re-hardcoding
  the full signature.)
- **C2. In-flight-slug hard error (DIM1-3).** clone-wars auto-suffixes `-2..-999` so concurrent
  same-topic runs coexist; consort `init` hard-errors `rc 2` when the art dir already exists. Kept on
  purpose — teardown archives the topic dir, so sequential reuse already works; concurrent same-topic
  runs should pass an explicit `--slug`.

---

## 5. Error handling

- `drop-part`: atomic `parts.txt` rewrite (tmp-in-same-dir + rename via `atomicWrite`); best-effort pane
  kill (caught, never fatal); `rc 1` if `parts.txt` missing or no matching instrument, `rc 2` on bad
  usage.
- Env override: a non-matching / empty `CONSORT_REHEARSAL_EXPERIMENT_TIMEOUT_OVERRIDE` falls through to
  the contracts.yaml/1800 default.
- Stale `spawn-results.tsv` clear: best-effort (`existsSync` guard).
- All restored prose is documentation; no new runtime error paths.

## 6. Testing

- **Phase-A unit tests.** `inboxWrite` `noDoneInstruction` (the fence contains exactly one
  `"event":"done"` instruction; the body's specific `experiment … metric=` line survives; the generic
  `<one-line summary>` line is absent); `buildConsensus` numeric coercion (a degenerate token compares
  equal to `0` within ε rather than always-Contested).
- **Command tests.** `drop-part` (rewrites `parts.txt` removing the row; trailing-newline/empty-file
  preserved; `rc 1` on missing/no-match; best-effort pane kill stubbed); experiment-send timeout
  precedence (`--timeout` > env > default) via the `consultTimeout` dep + env var.
- **Prose changes** guarded by `tests/stale-tokens.test.ts` (no banned token in the restored DANGER /
  Security / Intervention / Task-list prose).
- Full gate green: `npm run typecheck`, `npm run test`, `npm run lint`, `npm run build`. Version bumped
  `0.1.10 → 0.1.11` across `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`;
  `dist/consort.cjs` rebuilt (deterministic) and committed.

## 7. Acceptance criteria

1. **A1–A5** land with passing regression tests; the experiment inbox carries a single, specific
   done-event contract.
2. `drop-part` exists, is dispatched + documented, prunes `parts.txt`, and best-effort kills the dropped
   instrument's preflight pane; Phase-3 degraded prose invokes it; preflight-double-fail no longer routes
   through the degraded prompt.
3. The timeout env-override works (`--timeout` > `CONSORT_REHEARSAL_EXPERIMENT_TIMEOUT_OVERRIDE` >
   1800); the spec's "env-overridable" claim is now true.
4. **B1–B4** restored and rebranded; the stale-token gate stays green.
5. **C1–C2** documented as intentional in the rehearsal design spec (no code revert).
6. No frozen-protocol token altered; full gate green; `0.1.11` shipped across the three manifests + a
   committed, deterministic `dist/consort.cjs`.

## 8. Out of scope

- The clone-wars `deep-research-resume.md` / `active-<sid>.txt` / UserPromptSubmit-hook revival mechanism
  (intentionally dropped at port time; the loop is inline — unchanged here).
- The per-part-independent loop model (rehearsal must NOT get a score/prelude-style all-N wait-gate — an
  all-N barrier here would be a bug; unchanged).
- The `spawn -d` detach divergence (deliberate; unchanged).
- `core/contracts.ts` generalization to per-kind env overrides for research/verify/adversary (A4 is
  scoped to the rehearsal experiment cap only).
