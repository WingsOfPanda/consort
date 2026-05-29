# consort `soundcheck` roster-picker — Design

**Date:** 2026-05-29 · **Status:** approved · **Branch:** `feat/soundcheck-roster`

> A small foundation-primitive enhancement: `soundcheck` (consort's port of clone-wars
> `medic`) gains the **interactive roster-picker** that `medic` v0.18.0 added but consort's
> foundation port left out. Sequenced **before** `score` because `score`'s ensemble selection
> reads the curated active set this picker produces. Honors the frozen wire protocol and the
> locked musical rebrand.

**Behavioral spec source:** `clone-wars/docs/superpowers/specs/2026-05-08-medic-trooper-select-design.md`
and `clone-wars/commands/medic.md` (the Steps A–G picker). Preserve **behavior and the
selection flow**; modernize internals — do not transliterate the Bash line-by-line.

---

## 1. Summary

`soundcheck` already runs the health check (tmux / state / config / provider binaries) and
writes `providers-available.txt` — every provider with a binary on PATH and a `contracts.yaml`
row (`src/commands/soundcheck.ts:77`). What it is **missing** is the curated selection layer:
clone-wars `medic` v0.18.0 added an interactive picker that writes
`providers-active.txt` (the user's chosen subset), and clone-wars `consult` reads
`providers-active.txt` **first**, falling back to `providers-available.txt`.

This cycle adds that picker. After the health table, `/consort:soundcheck` lets the user curate
which `consult_validated` providers form the **active ensemble**, persists the choice in
`~/.consort/providers-active.txt` (global, one per machine/install), and surfaces the prior
selection as the recommended option on re-runs. The picker is **always-interactive** (faithful
to `medic`): it auto-handles 0 and 1 detected providers and prompts only for 2+.

The consumer side already exists: `paths.ts:93` `activeProvidersPath()` returns the active file
if present, else available — exactly clone-wars' precedence. `score` (next cycle) will read
through it. This cycle makes the active file real.

---

## 2. Scope & non-goals

**In scope (this spec):** the `soundcheck` picker end-to-end — a new `core/providers.ts` module,
two new `soundcheck` subcommands (`roster-plan` / `roster-set`), the picker section of
`commands/soundcheck.md`, unit tests, and a live dogfood.

**Non-goals (out of scope; each its own later spec):**
- `score` itself and all its ensemble-consumption logic. This cycle stops at writing the active
  file + the (already-built) resolver; no `score` code lands here.
- **Per-repo** active selection. `providers-active.txt` is global, matching clone-wars. A
  per-project override (`state/<repo-hash>/providers-active.txt` first) is a later feature with
  its own spec (YAGNI now).
- A `--reset` / `--no-select` flag. The user re-picks "all detected" or `rm`s the file. No CI
  use case (Claude Code is interactive only). (YAGNI — matches the clone-wars decision.)
- Changing what `providers-available.txt` contains or how the health check behaves.

---

## 3. Decisions (settled in brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | **Sequencing** | **soundcheck picker first, as its own small cycle**, before `score`. `score`'s auto-ensemble depends on the curated active set; building the picker first makes the curation story real and resolves "which N of 4 providers" cleanly via user choice rather than an arbitrary auto-pick. |
| D2 | **Picker UX** | **Always-interactive (faithful to `medic`).** Every `/consort:soundcheck` runs the picker after the health table; auto-handles 0 (skip) and 1 (auto-select), prompts for 2+. With a prior selection, the recommended option is `Keep current selection (…)` — one tap to keep. |
| D3 | **Menu labels** | **Provider names** (`codex`/`claude`/`agy`/`opencode`), **not** clone-wars' fixed commander names. consort assigns instruments randomly per-topic at spawn, so there is no stable instrument-per-provider to label; the selection is about which *providers* are active. |
| D4 | **Write mechanism** | **Typed `roster-set` subcommand using `atomicWrite`** (tmp-in-same-dir + rename), not the directive's Write tool. Keeps the empty-set guard, validation, timestamp, and file format in testable TS — consort's convention (logic in code, not directive prose). |

---

## 4. Command surface

`src/commands/soundcheck.ts` gains a small verb dispatch on `args[0]` (mirroring `solo.ts`'s
sub-dispatcher). The bare / `--args-file` path keeps today's behavior exactly.

| Invocation | Responsibility | rc |
|---|---|---|
| `soundcheck` (bare) / `soundcheck --args-file <p>` | **unchanged**: health check + write `providers-available.txt` + Verdict line | `0` ok · `1` fail |
| `soundcheck roster-plan` | read `providers-available.txt` → parse → filter to `consult_validated` (`detected`); read `providers-active.txt` → `prior`, drop entries not in `detected` (stale) and non-validated; compute `decision`; emit one JSON object to stdout | `0` |
| `soundcheck roster-set <provider>…` | validate the set is non-empty and every provider ∈ `detected`-validated; `atomicWrite` `providers-active.txt`; print `active set: …` confirmation | `0` · `1` empty/invalid |

`roster-plan` stdout shape (consumed by the directive):

```json
{
  "detected": ["codex", "claude", "agy", "opencode"],
  "prior": ["codex", "claude"],
  "skipped": ["<provider> (consult_validated: false)"],
  "dropped": ["<provider> (no longer detected)"],
  "decision": "skip" | "auto" | "prompt",
  "auto": "codex"
}
```

- `decision` is `skip` when 0 validated providers; `auto` when exactly 1 (and `auto` carries
  that provider); `prompt` for 2+. The directive derives menu shape from `detected.length`
  (`2`/`3` → preset menus, `4`+ → per-provider walk).
- `skipped` / `dropped` are human-readable `note:` strings the directive prints verbatim.

**New core module:** `src/core/providers.ts` (provider-list files; complements `contracts.ts`,
which is about `contracts.yaml`). Exports:

- `parseProviderList(text: string): string[]` — split lines, skip `#`-prefixed and blank lines,
  trim. Order preserved (it follows `contracts.yaml` row order from `soundcheck`'s writer).
- `readProviderList(path: string): string[]` — read + `parseProviderList`; missing/unreadable
  file → `[]`.
- `planRoster(input: { detectedValidated: string[]; prior: string[] }): RosterPlan` — **pure**.
  Filters `prior` to `detectedValidated` (drops stale/non-validated with notes), computes
  `decision`, returns `{ detected, prior, dropped, decision, auto? }`. No fs, no contracts —
  the subcommand wires those in.
- `formatActiveFile(providers: string[], isoStamp: string): string` — the file body (header
  comments + one provider per line).

(`activeProvidersPath()` lives in `paths.ts` already; `instrumentConsultValidated()` lives in
`contracts.ts` already. Both reused, not rebuilt.)

---

## 5. The picker flow (`commands/soundcheck.md`)

Existing steps 1–3 stay verbatim (mint args path → **Write** `$ARGUMENTS` → run
`soundcheck --args-file <p>`, print its output verbatim). Then the **always-interactive** picker:

**Step 4 — Plan.** Run `soundcheck roster-plan`; parse the JSON. Print each `skipped` /
`dropped` entry as a `note:` line so the user sees what changed.

**Step 5 — Branch on `decision`:**

- **`skip`** (0 validated providers) → stop the picker. If `skipped` is non-empty, print the
  refresh-`contracts.yaml` tip.
- **`auto`** (exactly 1) → `soundcheck roster-set <auto>`; print the confirmation. Done.
- **`prompt`, `detected.length == 2`** → one `AskUserQuestion`, 4 options:
  `Both <A> + <B>` / `<A> only` / `<B> only` / `Customize…`. If `prior` equals one preset subset,
  relabel that option `Keep current selection (…)` and make it recommended.
- **`prompt`, `detected.length == 3`** → **nested** (the 4-option cap forces it, same as
  `medic`): D.1 (3 options) `All three (<A>+<B>+<C>)` / `Pick a pair (drill in)` / `Customize…`;
  D.2 fires only on "Pick a pair" — the 3 pairs `<A>+<B>` / `<A>+<C>` / `<B>+<C>`. Prior-match
  relabels/recommends per the medic spec (all-three → relabel "All three"; a pair → recommend
  "Pick a pair" and pre-select that pair in D.2).
- **`prompt`, `detected.length >= 4`** → per-provider walk: one `AskUserQuestion` per provider
  (in `detected` order), `Include` / `Exclude`. Recommended = `Include` if the provider is in
  `prior` (post-reconcile) **or** `prior` is empty (first-time selection); else `Exclude`.

**Step 6 — Persist.** A non-`Customize` preset/nested pick or the walk's `Include` set →
`soundcheck roster-set <chosen>…`. If the walk's included set is **empty** (user excluded
everything), the `roster-set` empty-set guard returns rc 1 — the directive prints
`error: must select at least one provider; selection unchanged` and leaves the prior file
intact (the typed guard, not directive prose, enforces this). `Customize…` from a preset menu
falls through to the same walk.

---

## 6. State & file format

`providers-active.txt` lives at `globalRoot()` — `~/.consort/providers-active.txt` by default,
or `$CONSORT_HOME/providers-active.txt` — the same scope as `providers-available.txt` (above the
per-repo `state/<repo-hash>/…` line). Written via `atomicWrite` (tmp-in-same-dir + rename);
`roster-set` ensures `globalRoot()` exists first. Format (mirrors `providers-available.txt`):

```
# generated <ISO-8601 UTC> by /consort:soundcheck
# active providers selected by user
codex
claude
```

`activeProvidersPath(gRoot = globalRoot())` (already in `paths.ts`) returns this file when it
exists, else `providers-available.txt`. `score` (next cycle) reads through it.

---

## 7. Error handling

| Scenario | Behavior |
|---|---|
| Health verdict `FAIL` but `providers-available.txt` has ≥1 entry | Picker still runs — selection is never blocked by non-provider check failures (e.g. `$TMUX` unset). |
| `providers-available.txt` missing/unreadable | `roster-plan` → `detected: []`, `decision: "skip"`; directive prints `note:` and stops the picker cleanly. |
| 0 `consult_validated` providers detected | `decision: "skip"`; print the refresh-`contracts.yaml` tip if anything was `skipped` as non-validated. |
| `providers-active.txt` corrupted / junk lines | `parseProviderList` treats unparseable lines as comments/blanks; an empty parsed `prior` is treated as no-prior (prompt fresh). Never throws. |
| `prior` contains a now-undetected or now-non-validated provider | `planRoster` drops it and emits a `dropped` note (`no longer detected`). Survives uninstall / `contracts.yaml` edits. |
| User excludes everything in the walk | `roster-set` empty-set guard → rc 1, no write, prior intact; no auto re-prompt. |
| `roster-set` given a provider not in detected-validated | rc 1, no write (defends against a stale directive arg). |
| `atomicWrite` fails (disk/permissions) | Surfaces as a non-zero `roster-set`; `activeProvidersPath()` falls back to available — self-healing. |
| Concurrent soundcheck runs | `atomicWrite` keeps the file structurally valid; last writer wins. consort is single-conductor by design. |

---

## 8. Naming & rebrand compliance

- This is a foundation-primitive enhancement; the command stays `/consort:soundcheck`. No new
  high-level command surface is added (the foundation phase guard is respected — `score` etc.
  remain out of scope).
- **Frozen — never renamed:** the `contracts.yaml` key `consult_validated` stays (frozen key);
  event names; `END_OF_INSTRUCTION`; JSON fields; `CLAUDE_CODE_SESSION_ID`; state filenames.
- The stale-token gate (`tests/stale-tokens.test.ts`) must stay green — scrub every
  `medic` / `trooper` / `clone-wars` / `cw_` / `master-yoda` / `@cw_` token from any text copied
  out of the clone-wars `medic` design. Fix the offending file; never weaken the gate.

---

## 9. Testing strategy

Foundation conventions: pure-logic unit tests; no real subprocesses; `CONSORT_HOME` = fresh temp
dir per test (`tests/helpers/tmpHome.ts`).

- **`core/providers.ts`** — `parseProviderList` (comments, blank lines, leading/trailing
  whitespace, empty input → `[]`); `readProviderList` (missing file → `[]`); `planRoster`
  decision matrix (`0→skip`, `1→auto`+carries provider, `2/3→prompt`, `4→prompt`), prior
  reconcile (stale drop + note), all-prior-dropped → treated as no-prior; `formatActiveFile`
  (exact header + one-per-line body).
- **`soundcheck roster-plan`** — under temp `CONSORT_HOME`: stage `providers-available.txt`
  (+ optional `providers-active.txt`); assert the emitted JSON (`detected` filtered to validated,
  `prior` reconciled, `decision`, notes).
- **`soundcheck roster-set`** — empty args → rc 1, no file; provider not in detected → rc 1, no
  file; happy path → writes the exact `formatActiveFile` body atomically + prints `active set: …`.
- **Stale-token gate** — borrowed `medic` text scrubbed; gate green.
- No live `AskUserQuestion` tests (directive prose; validated by the dogfood).

**Quality gates:** `npm run typecheck`, `npm run lint`, `npm run test` green; then `npm run
build` and **commit the refreshed `dist/consort.cjs`**.

---

## 10. Acceptance criteria

1. All unit tests green; `tsc --noEmit` + eslint + stale-token gate clean; `dist/consort.cjs`
   rebuilt and in sync.
2. **Live dogfood** (the gate) under isolated `CONSORT_HOME`: a real `/consort:soundcheck` →
   health table → picker writes `providers-active.txt` with the chosen subset; a **re-run** shows
   the prior selection as the recommended `Keep current selection (…)` option; an
   **uninstall/stale** path drops a no-longer-detected provider with a `note:` line; the
   **empty-set guard** refuses to write. Result + any bugs appended to
   `docs/superpowers/DOGFOOD.md` as a `soundcheck roster-picker` section.
3. No frozen protocol term renamed; no stale clone-wars token shipped.
4. `activeProvidersPath()` returns the freshly-written `providers-active.txt` (the consumer
   contract `score` will use is demonstrably live).

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Always-interactive picker annoys users who only want a health check | With a prior selection, "Keep current" is the recommended one-tap option; 0/1 providers never prompt. Matches the deliberate `medic` v0.18.0 UX choice. |
| N=4 walk is 4 separate prompts | Faithful to `medic` Step E (the 4-option `AskUserQuestion` cap rules out a single checklist). Acceptable; the common path (a prior exists) pre-recommends Include/Exclude per provider. |
| Borrowed `medic` text leaks a stale token | Stale-token gate runs at close-out (caught a `colors.ts` leak in the foundation); fix the file, never weaken the gate. |
| Global selection surprises a user who wanted per-repo | Documented as an explicit non-goal; per-repo override is a later spec. The file is grep-able and user-editable. |

---

## 12. Implementation phasing (for writing-plans)

1. **`core/providers.ts`** (pure: `parseProviderList`, `readProviderList`, `planRoster`,
   `formatActiveFile`) + tests.
2. **`soundcheck.ts`** verb dispatch + `roster-plan` (fs + `consult_validated` filter + `planRoster`
   → JSON) + `roster-set` (validate + `atomicWrite`) + tests.
3. **`commands/soundcheck.md`** picker directive (Steps 4–6; N=2 preset / N=3 nested / N=4 walk /
   auto / skip; keep-current recommended; empty-set guard).
4. **Build + live dogfood**; append the `soundcheck roster-picker` section to `DOGFOOD.md`;
   commit the refreshed `dist/consort.cjs`.
