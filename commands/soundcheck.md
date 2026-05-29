---
description: Health check (tmux/state/config/providers) plus interactive roster picker — selects the active provider set for /consort:score
argument-hint: (no args)
allowed-tools: Bash, Write, AskUserQuestion
---

# /consort:soundcheck

Health check (tmux/state/config/providers) + roster picker.

## Steps

1. Run this Bash block to mint an args path and capture it:
   `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs soundcheck --mint-args-file`
   (prints an absolute path under `.consort/_args/`).
2. **Write** `$ARGUMENTS` into that exact path using the Write tool (never echo it into a shell).
3. Run: `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs soundcheck --args-file <path-from-step-1>`

## Roster selection (always-interactive)

After the health check (Steps 1–3) runs and writes `providers-available.txt`, pick which
detected `consult_validated` providers form the active ensemble for `/consort:score`. The
selection persists at `~/.consort/providers-active.txt` (global, one per machine). This is the
user's preference layer on top of the mechanical detection. Every `/consort:soundcheck` run
performs Steps 4–6; whether the user sees a prompt depends on the detected count.

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

### Step 4 — Plan

Run `$CS soundcheck roster-plan` (it reads the `providers-available.txt` that the health pass in
Steps 1-3 just wrote — always run it after the health check, not standalone). It prints one JSON
object to stdout (stderr holds logs):

```json
{ "detected": ["codex","claude"], "prior": ["codex"], "skipped": [], "dropped": [], "decision": "skip|auto|prompt", "auto": "codex" }
```

Print each `skipped` and `dropped` entry as a `note:` line so the user sees what changed
(e.g. `note: removed gone (no longer detected)`, `note: fooai (consult_validated: false)`).

### Step 5 — Branch on `decision`

- **`skip`** (0 validated providers) — stop here. If `skipped` is non-empty, add:
  `tip: your contracts.yaml may predate the current provider set; refresh it with
  cp "${CLAUDE_PLUGIN_ROOT}/config/contracts.yaml" ~/.consort/contracts.yaml`.
- **`auto`** (exactly 1) — run `$CS soundcheck roster-set <auto>` and print its confirmation. Done.
- **`prompt`** — build the menu from `detected` (use the provider names verbatim — codex / claude /
  agy / opencode). The shape depends on `detected.length`:

  - **2 providers `[A, B]`** — one `AskUserQuestion`, 4 options:
    `Both A + B` / `A only` / `B only` / `Customize…`.
    If `prior` equals one preset subset exactly, relabel that option to start with
    `Keep current selection (…)` and make it the recommended option.

  - **3 providers `[A, B, C]`** — nested (the 4-option cap rules out a flat 5-option menu):
    - **D.1** (3 options): `All three (A + B + C)` / `Pick a pair (drill in)` / `Customize…`.
    - **D.2** (fires only on "Pick a pair", 3 options): `A + B` / `A + C` / `B + C`.
    - If `prior` is exactly all three → relabel `All three` as `Keep current selection (…)` and
      recommend it. If `prior` is one of the pairs → recommend `Pick a pair` in D.1 and recommend
      the matching pair in D.2.

  - **4+ providers** — per-provider walk: one `AskUserQuestion` per provider (in `detected`
    order), 2 options `Include` / `Exclude`. Recommend `Include` when the provider is in `prior`
    OR `prior` is empty (first-time selection); otherwise recommend `Exclude`. Collect the
    included set.

  `Customize…` from any preset menu falls through to the same per-provider walk.

### Step 6 — Persist

Pass the chosen providers (space-separated, provider names) to roster-set:

```
$CS soundcheck roster-set <p1> <p2> …
```

- The empty-set guard lives in the CLI: if the walk's included set is empty, `roster-set` (called
  with no providers) returns rc 1 and prints `must select at least one provider; selection
  unchanged` to stderr — surface that, and leave the prior selection intact (do not retry
  automatically; the user can re-run `/consort:soundcheck`).
- On success, print roster-set's `active set: …` confirmation line.

## Notes

- Selection is global (`~/.consort/providers-active.txt`), not per-repo. `/consort:score` reads
  it first, falling back to `providers-available.txt` (the `activeProvidersPath()` resolver).
- Re-running `/consort:soundcheck` shows the prior selection as the recommended "Keep current"
  option, so keeping the roster is one tap.
