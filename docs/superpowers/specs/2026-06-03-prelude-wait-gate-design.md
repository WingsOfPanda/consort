# prelude wait-gate — mechanically gate both barrier stages on ALL N parts finishing

**Status:** approved approach (port the score wait-gate to prelude), spec for review (2026-06-03)

## Problem

`/consort:prelude` is a **barrier-all-N** command: the Maestro fans a research round to all N parts,
waits for all, synthesizes a draft, runs a confidence gate, fans an adversary round to all N, waits
for all, then writes the final landscape doc. It shares the exact weakness that was just fixed in
`score` (PR #29): the "wait for all N parts" barriers at **both** wait stages are enforced only by
**advisory prose**, with no mechanical rc-gate — so the Maestro can advance to synthesis after the
**first** of N background-wait completion notifications.

Verified 2026-06-03 by an adversarial investigation (both verdicts high-confidence):

- The two gates are prose-only:
  - `commands/prelude.md:142` (Phase 4, research): "**Proceed when all N parts have written their
    `research-<instrument>.done` sentinel.**"
  - `commands/prelude.md:242` (Phase 7→8, adversary): "**Proceed when all N
    `$ART/adversary-<instrument>.done` sentinels exist.**"
- There is **no `wait-gate` verb** in prelude (dispatcher + usage line confirm; grep for
  `wait-gate`/`gateState` over prelude returns zero matches).
- The `<phase>-<instrument>.done` sentinels are **written but read by nothing** — `research-wait`
  (`prelude.ts:232`) and `adversary-wait` (`prelude.ts:347`) each `writeFileSync` their own sentinel,
  but no verb aggregates them into an all-N check.
- The `synth-preliminary` / `synth-final` input-validators check `findings-*.md` / `adversary-*.md`
  **non-emptiness**, not wait completion — a partial backstop, not a barrier.

(Sibling `rehearsal` was checked too and is **correctly per-part-independent by design** — it must NOT
get this fix; an all-N barrier there would be a bug. Out of scope here.)

## prelude is a structural twin of score

prelude's wait verbs are byte-for-byte analogous to score's, which is why this is a faithful port,
not a new design:

| | score | prelude |
|---|---|---|
| phase 1 | research → `research-<inst>.txt` (`FS=` via `researchState`) + `.done` | research → `research-<inst>.txt` (`FS=` via `researchState`) + `.done` |
| phase 2 | verify → `verify-<inst>.txt` (`VS=` via `verifyState`) + `.done` | adversary → `adversary-<inst>.txt` (`AS=` via `verifyState`) + `.done` |
| question re-arm | `OFFSET=`+`<key>=question`, `.done` written, relay removes `.done` | identical |
| roster | `roster.txt` via `parseRosterFile` | `roster.txt` via `parseRosterFile` |

The only structural difference is the status-key for the second phase: score uses `VS`, prelude uses
`AS`.

## Design

### Part 1 — new verb `prelude wait-gate <TOPIC> <phase>`

`phase ∈ {research, adversary}`. `preludeWaitGateRun` in `src/commands/prelude.ts` mirrors score's
`waitGateRun` (`src/commands/score.ts:471-492`):

1. Validate args: rc 2 if `topic`/`phase` missing, rc 2 if `phase` not in `{research, adversary}`.
2. Resolve `preludeArtDir(topic)`; read `$ART/roster.txt`; rc 2 if missing or empty (via
   `parseRosterFile`).
3. `key = phase === "research" ? "FS" : "AS"`.
4. For each roster part, read `<phase>-<inst>.done` existence + `<phase>-<inst>.txt` text, call the
   shared `gateState(parts, key)`.
5. Print `<INST>\t<terminal|question|pending>` per part (the `walk-state`/`wait-gate` idiom).
6. Return **rc 0 iff every part is `terminal`**, else rc 1.

rc 2 (missing roster / bad phase) is unreachable in the real flow — `prelude init` writes
`roster.txt`, and the gate runs only after `research-send`/`adversary-send`. As with score, rc 2 is a
distinct "setup error" deliberately separate from rc 1 ("keep waiting"), since the gate is polled.

### Part 2 — reuse `gateState`, widen its key type

`gateState` (`src/core/scoreTurn.ts`) already implements the exact "last `<key>=` line wins;
`question` is the only transient; `terminal` iff `.done` + non-question last value" logic. Its `key`
parameter is typed `"FS" | "VS"`; widen it to **`"FS" | "VS" | "AS"`** (one-line type change — the
body is key-agnostic, so no logic changes). prelude already imports `researchState`/`verifyState`/
`parseLatestOffset` from `scoreTurn.ts`, so importing `gateState` from there is consistent with the
existing module boundary.

### Part 3 — harden the prose (`commands/prelude.md`)

- Line 142 (research gate): replace "**Proceed when all N parts have written their
  `research-<instrument>.done` sentinel.**" with wording that gates on the verb: "**Do not proceed
  until `$CS prelude wait-gate <TOPIC> research` exits 0**" (it prints `<INST>\t<status>` per part and
  returns 0 only when all are `terminal`; rc 1 = some part `pending`/`question` → keep handling
  notifications / relay, then re-run).
- Line 242 (adversary gate): the same, anchored on `$CS prelude wait-gate <TOPIC> adversary`.

## Why a per-command verb, not a shared one

score and prelude already keep **per-command thin IPC wrappers around shared pure cores**
(`research-send`/`research-wait` are intentional twins the 2026-05-31 simplification sweep
**deliberately did not collapse**, for byte-faithful parity — see the quarantine catalog). The gate
follows that convention: the brain (`gateState`) is shared and unit-tested once; each command keeps
its own thin `*WaitGateRun` wrapper. This avoids touching the freshly-shipped `score` path.

## Components

- `src/core/scoreTurn.ts` — widen `gateState`'s `key` param to `"FS" | "VS" | "AS"` (1 line).
- `src/commands/prelude.ts` — add `gateState` to the `../core/scoreTurn.js` import; add
  `preludeWaitGateRun`; wire `case "wait-gate"` into the dispatch switch; add `wait-gate` to
  `usage()`.
- `commands/prelude.md` — the two prose edits (lines 142, 242).
- `tests/prelude-gate.test.ts` — verb-level tests with a temp `CONSORT_HOME` (`freshHome`): for the
  **research** phase (key `FS`) and the **adversary** phase (key `AS`) — rc 0 when all parts terminal,
  rc 1 when one part is pending (no `.done`), rc 1 when one part's last line is `<key>=question`, and
  rc 2 for missing/bad phase and missing roster. (The pure `gateState` `FS`/`VS` logic is already
  covered by `tests/score-gate.test.ts`; add one `AS`-key pure case to confirm the widened union.)
- version bump + rebuilt `dist/consort.cjs`.

## Error handling

- Usage/precondition failures → rc 2 with a `prelude wait-gate: ...` stderr message (sibling-verb
  style).
- A part whose state file or `.done` does not yet exist is `pending` (not an error) — the gate is
  polled while waits are in flight.

## Frozen-protocol / parity safety

- The verb only **reads** frozen state filenames (`<phase>-<inst>.txt`, `<phase>-<inst>.done`,
  `roster.txt`); it renames/creates nothing on the wire.
- New **internal** conductor verb (CLI plumbing), not a provider, not part of the frozen
  event/JSON/sentinel protocol; `contracts.yaml` untouched.
- No banned token (`clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_`) introduced; the
  stale-token gate is unaffected.
- The prose restoration mirrors clone-wars' meditate gate intent (parity-positive); the mechanical
  verb is the strengthening.

## Acceptance criteria

1. `prelude wait-gate <TOPIC> research` and `... adversary` exist, print `<INST>\t<status>` per part,
   exit 0 iff all parts terminal, rc 1 if any pending/question, rc 2 on usage errors.
2. `gateState`'s key type accepts `AS`; the `AS`-key pure case passes; the two `score` callers still
   typecheck.
3. `commands/prelude.md` Phase 4 (line 142) and Phase 7 (line 242) gate on `wait-gate` rc 0.
4. Full gate green (`typecheck` / `test` incl. stale-tokens / `lint`); `dist/consort.cjs` rebuilt and
   committed; version bumped.
5. No frozen-protocol token altered; no banned token introduced; `rehearsal` untouched.

## Out of scope / risks

- **rehearsal** — verified correctly barrier-free per-part; explicitly NOT modified.
- **No automated test for the `.md` control flow** (by design); the verb is the testable anchor, and a
  live dogfood (a real `prelude` run where one part lags) is the manual end-to-end check.
- **Low risk — `AS` key.** The only non-mechanical detail; pinned by the adversary-phase verb test and
  the `AS`-key pure case.
