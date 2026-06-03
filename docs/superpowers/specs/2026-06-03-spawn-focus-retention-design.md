# Spawn focus retention — keep the Maestro pane active after spawning parts

**Status:** approved design (2026-06-03)
**Scope owner:** the six spawn paths share two tmux primitives; this changes those primitives only.

## Problem

When the Maestro spawns a part, the part pane is created with a bare `tmux split-window`.
tmux's default is to make the newly-created pane the **active** pane, so the user's focus/cursor
lands on the last-spawned part. The user only ever interacts with the Maestro (conductor) pane —
the parts are model TUIs driven over file-based IPC, never typed into directly — so focus landing
on a part is pure friction.

Desired behavior: **focus never leaves the Maestro pane** while parts are being spawned.

## Parity note (why this is new behavior, not a dropped-parity restoration)

clone-wars (the behavioral spec) uses the same bare `split-window` with no focus-return in both
`lib/tmux.sh` and `bin/preflight-layout.sh`, so landing on the last part is *its* behavior too.
This is therefore a **deliberate new cosmetic divergence**, which under the repo phase guard earns
its own spec (this document).

It is safe to diverge here because tmux's "active pane" is purely a viewport/focus concern:

- The external model binaries never observe which pane is active — they run in their pane
  regardless. Nothing in the **frozen wire protocol** (event names, sentinel, JSON fields,
  `contracts.yaml` keys, state filenames, `CLAUDE_CODE_SESSION_ID`) is touched.
- No banned token (`clone-wars` / `cw_` / `master-yoda` / `MISSION ACCOMPLISHED` / `@cw_`) is
  introduced; the stale-token gate is unaffected.

## Design

Add tmux's `-d` flag ("do not make the new pane the active pane") to **every `split-window`
invocation that creates a part pane**. With `-d`, the pane is still created exactly where the
explicit `-t <target>` says, still printed back via `-P -F '#{pane_id}'`, but the currently-active
pane — the Maestro — stays active. Focus literally never moves.

There are exactly three focus-moving `split-window` sites, all in `src/core/tmux.ts`:

### 1. `splitRightArgs` (single-pane spawn, horizontal)

Before: `["split-window", "-P", "-F", "#{pane_id}", "-h", ...optional -t/-c, launch]`
After:  insert `-d` after `-h` →
`["split-window", "-P", "-F", "#{pane_id}", "-h", "-d", ...optional -t/-c, launch]`

### 2. `splitDownArgs` (single-pane spawn, vertical; always targeted)

Before: `["split-window", "-P", "-F", "#{pane_id}", "-v", "-t", target, ...optional -c, launch]`
After:  insert `-d` after `-v` →
`["split-window", "-P", "-F", "#{pane_id}", "-v", "-d", "-t", target, ...optional -c, launch]`

### 3. `preflightLayout` loop (multi-pane layout)

The loop currently builds its split args inline:
`["split-window", "-P", "-F", "#{pane_id}", flag, "-t", prev, ...optional -c, sentinel]`.

Extract this into a new **pure** arg builder so the third focus-moving site is unit-testable like
the other two and the `-d` insertion is verifiable:

```ts
export function preflightSplitArgs(flag: "-h" | "-v", prev: string, cwd?: string): string[] {
  const a = ["split-window", "-P", "-F", "#{pane_id}", flag, "-d", "-t", prev];
  if (cwd) a.push("-c", cwd);
  return a;
}
```

`preflightLayout` calls `preflightSplitArgs(flag, prev, e.cwd)` and appends the sentinel command,
replacing the inline array. Behavior is identical except for the added `-d`.

## Why nothing else breaks

- `-P -F '#{pane_id}'` still prints the new pane id under `-d` (capture is unchanged).
- Geometry is unchanged: every split passes an explicit `-t <pane>`, so `-d` (which only affects
  *which* pane is active, not *where* the split lands) cannot move a split.
- Every downstream tmux operation targets an explicit `-t <pane>` — `paneLabelSet`, `paneSend`,
  `respawn`, `capturePane`, `killGraceful`, `ensureWindowBorderStatus` — so none rely on the part
  being the active pane.
- `selectLayoutMainVertical(conductor)` and `ensureWindowBorderStatus(conductor)` after the
  preflight loop do not depend on the active pane.
- The `respawn-pane` path (`respawnArgs`) is untouched — it reuses an existing pane in place and
  never moved focus.
- `panes.txt` content (the `<instrument>\t<pane>` rows) is byte-identical.

## Universal by construction

Because the change lives in the two shared primitives (`splitRight`/`splitDown` and
`preflightLayout`), it applies automatically to every command that spawns parts: **solo, score,
perform, prelude, rehearsal**. No per-command edits.

## Testing

**Unit (TDD, pure arg builders — no live panes):** in `tests/tmux.test.ts`

- Update the `splitRightArgs` assertions to expect `-d` after `-h` (both the targeted and
  `undefined`-target forms).
- Update the `splitDownArgs` assertion to expect `-d` after `-v`.
- Add a test for `preflightSplitArgs` covering `-h`/`-v` and the with-`cwd` / without-`cwd` forms,
  asserting `-d` is present and positioned after the direction flag.

**Full gate:** `npm run typecheck && npm run test && npm run lint && npm run build`; the test run
includes the stale-token gate. Commit the rebuilt `dist/consort.cjs`.

**Live dogfood (manual, end-to-end):** run one real single-pane spawn (`solo`, exercising
`splitRight`/`splitDown`) and one real multi-part spawn (`score` or `rehearsal`, exercising
`preflightLayout`), confirming in an attached tmux session that focus remains on the Maestro pane
throughout.

## Acceptance criteria

1. All three `split-window` arg arrays include `-d`, positioned immediately after the direction
   flag (`-h`/`-v`/`flag`).
2. `preflightLayout` uses the new `preflightSplitArgs` builder; the inline array is gone.
3. `tests/tmux.test.ts` asserts `-d` on all three builders; full suite stays green.
4. `dist/consort.cjs` rebuilt and committed.
5. Live dogfood confirms focus stays on the Maestro pane for both the single-pane and multi-pane
   spawn paths.

## Risks

- **Low — flag position.** tmux ignores flag ordering among boolean flags, so `-d`'s exact slot is
  cosmetic; we fix it (after the direction flag) only for test determinism.
- **Low — preflight refactor.** Extracting `preflightSplitArgs` is a behavior-preserving move; the
  only functional change is the added `-d`. Covered by the new unit test plus the existing live
  preflight path in the dogfood.
