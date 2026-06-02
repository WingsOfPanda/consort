# consort forensics scope expansion — design

**Date:** 2026-06-02
**Status:** approved (brainstorming → spec)
**Branch:** `feat/forensics-scope-expansion`

## Problem

Today consort forensics is a **mechanical error net**: `scrapeArtDir` (`src/core/forensics.ts`)
only records error-ish signals — audit-log `ISSUE=` lines, part `outbox` `error`/`question` events,
`status.json` `state=error`, `spawn-results.tsv` rc≠0, and `[error]`/`log_error` log lines. A run
that is mechanically clean writes **no forensics file at all** (`runForensics` → "no mechanical
findings (no file written)"). Two consequences:

1. **The Maestro has nowhere to record a hunch.** If the conductor notices something weird,
   surprising, or suspicious during a run — but nothing tripped a mechanical signal — there is no way
   to record it for later analysis. The `## Maestro reflection` append only happens *if a mechanical
   file already exists*.
2. **Parts can only surface hard errors.** Part `error`/`question` events are captured (good), but a
   part that merely *notices* something off has no recorded channel for it.

The user wants to widen the net: record anything the Maestro (or a part) finds weird or suspicious —
false alarms are acceptable ("never hurt to record") — so it accrues into `/consort:playback` for
later analysis.

## Goal

Add two deliberate, judgment-driven signals to forensics — **Maestro flags** and **part
suspicions** — that produce playback-visible findings even on a mechanically-clean run, while
keeping the existing mechanical auto-scan precise (no lowered threshold, no routine-note noise) and
**not touching the frozen wire protocol**. Reuse the existing forensics + playback pipeline.

## Architecture

### Part 1 — Maestro flags (immediate, teardown-independent)

**New verb `$CS <cmd> flag <topic> "<observation>"`** on each of the five part-spawning commands
(`solo` / `score` / `perform` / `prelude` / `rehearsal`), mirroring the existing per-command
`forensics` verb. Each dispatches to a shared **`runFlag(command, topic, note)`** in
`src/core/forensics.ts`, which calls a new **`recordMaestroFlag()`**.

`recordMaestroFlag` mirrors `captureSpawnFailure`'s "Approach A": it writes one file straight to the
global playback feed — `globalRoot()/forensics/<date>/<time>-<command>-flag-<topic>.md` — containing
a single `source: maestro_flag` finding, via the existing `renderArtForensics`. It is
**teardown-independent** (lands even when a run aborts or hands off without a clean teardown),
best-effort (returns the path or `""`, never throws), and the conductor can see it mid-run.

Multiple flags in a run → multiple timestamped files (one per call, exactly like
`captureSpawnFailure`). They cluster in playback's `TRENDS` by signature, so repeats collapse there.

**Command-doc instruction** (all five `commands/*.md`): a short "Flagging suspicions" note — *at any
point during the run, if something looks weird / surprising / suspicious (even a likely false alarm),
record it with `$CS <cmd> flag <TOPIC> '<what looked off>'`. It is cheap; prefer over-recording.*

### Part 2 — Part suspicions (the `FLAG:` marker)

**Key constraint discovered:** parts already emit routine `note`s — `config/prompt-templates/identity.md:13`
defines `{"event":"progress","note":"..."}` for periodic "50% done"-style updates. Capturing every
note would be pure noise. So part suspicions use a **marker convention**.

**`config/prompt-templates/identity.md`** gains an instruction: *if you notice something
suspicious / surprising / wrong while working — even a possible false alarm — emit a progress event
whose note is **prefixed `FLAG:`**, e.g. `{"event":"progress","note":"FLAG: <what looked off>"}`,
then keep working.* The marker is a pure string convention on the **frozen `note` field**; no new
event type, no field rename — the wire protocol is untouched.

**`scrapeOutbox`** (`src/core/forensics.ts:69`) is broadened: in addition to `error`/`question`
events, it captures any event whose `note` matches `/^\s*FLAG:/i` → `source: part_note`, `key` = the
note text with the `FLAG:` prefix stripped and trimmed, `context: part=<part>`. This is picked up by
the existing teardown `scrapeArtDir` scan — the same path part *errors* already ride — so part
suspicions land in the run's teardown forensics file. (Routine non-`FLAG:` notes are ignored, exactly
as today.)

### Part 3 — Playback: zero changes

`maestro_flag` and `part_note` are new `Finding.source` values. They flow through the existing
`parseMechanicalFindings` (generic bullet parser) and the **`default` case** of `findingSignature`
(`<source>||<normalizeVolatile(key)>`) with no change to `src/core/playback.ts`. `renderArtForensics`
already sets `n_findings_mechanical` to the finding count, so the survey row count is correct, and
`accrue` trends them by their normalized signature. Survey, cluster, trend, archive all work unchanged.

## Components

| File | Change |
|---|---|
| `src/core/forensics.ts` | add `recordMaestroFlag(opts)` (immediate global write, `source: maestro_flag`) + shared `runFlag(command, topic, note)` (usage-guard topic/note → record → print path); broaden `scrapeOutbox` to also capture `FLAG:`-prefixed `note`s as `source: part_note` |
| `src/commands/solo.ts` | dispatch `case "flag": return runFlag("solo", rest[0], rest.slice(1).join(" "))` |
| `src/commands/score.ts` | dispatch `case "flag": return runFlag("score", ...)` + usage string |
| `src/commands/perform.ts` | dispatch `case "flag": return runFlag("perform", ...)` |
| `src/commands/prelude.ts` | dispatch `case "flag": return runFlag("prelude", ...)` |
| `src/commands/rehearsal.ts` | dispatch `case "flag": return runFlag("rehearsal", ...)` |
| `commands/{solo,score,perform,prelude,rehearsal}.md` | short "Flagging suspicions" instruction |
| `config/prompt-templates/identity.md` | add the `FLAG:` note instruction for parts |
| `tests/forensics-*.test.ts` | `recordMaestroFlag` + `scrapeOutbox` broadening unit tests |
| `dist/consort.cjs` | rebuild + commit |

## Data flow

- **Maestro flag:** Maestro runs `$CS perform flag <topic> "<note>"` → `runFlag("perform", topic, note)`
  → `recordMaestroFlag` → `~/.consort/forensics/<date>/<time>-perform-flag-<topic>.md`
  (`source: maestro_flag`) → `playback survey` lists it → `playback archive` accrues
  `maestro_flag||<normalized>` into `.trends.json`.
- **Part suspicion:** part emits `{"event":"progress","note":"FLAG: <obs>"}` to its `outbox.jsonl` →
  at teardown `scrapeArtDir` → `scrapeOutbox` captures it as `source: part_note` → merged into the
  run's mechanical forensics file → playback.

## Error handling

- `recordMaestroFlag`: best-effort, wrapped, returns `""` on any error, never throws (mirrors
  `captureSpawnFailure`). `runFlag` returns rc 2 on missing topic/note (usage), rc 0 otherwise;
  prints the written path on success, an info line if nothing was written.
- `scrapeOutbox` broadening keeps the existing per-line `try/JSON.parse/skip` guard; a note field that
  is absent or non-string is simply not matched.

## Testing

- **Unit (pure):**
  - `recordMaestroFlag` writes a file under `globalRoot()/forensics/<date>/` whose frontmatter has
    `command:` = the command, `topic:` = the topic, `n_findings_mechanical: 1`, and one
    `- **maestro_flag** <note> _(source: ...)_` bullet (use a temp `CONSORT_HOME` + injected `now`).
  - `scrapeOutbox`: a `{"event":"progress","note":"FLAG: x"}` line → one `part_note` finding with key
    `x`; a routine `{"event":"progress","note":"50% done"}` line → **zero** findings; existing
    `error`/`question` events still captured; case-insensitive / leading-space `FLAG:` matched.
  - `findingSignature` over a `maestro_flag` / `part_note` finding → `<source>||<normalized>` (default
    case) — a sanity test that the new sources trend correctly.
- **Suite-as-gate:** the five `flag` dispatch wirings verified by the full suite + a smoke test
  (`$CS perform flag` with no topic → usage rc 2; with topic+note → writes a file, prints its path).
- **Full gate:** `npm run typecheck` / `lint` / `test` (incl. `stale-tokens`), then rebuild + commit
  `dist/consort.cjs`.

## Success criteria

- [ ] `$CS <cmd> flag <topic> "<note>"` (each of the 5 commands) writes a
      `~/.consort/forensics/<date>/<time>-<cmd>-flag-<topic>.md` file with a `maestro_flag` finding and
      prints its path; missing topic/note → usage rc 2.
- [ ] A mechanically-clean run with one Maestro flag yields a playback-visible forensics file.
- [ ] A part emitting `{"event":"progress","note":"FLAG: ..."}` produces a `part_note` finding at
      teardown; a routine `"50% done"` note produces none; `error`/`question` events still captured.
- [ ] `config/prompt-templates/identity.md` instructs parts to use the `FLAG:` marker; each
      `commands/*.md` instructs the Maestro to use the `flag` verb.
- [ ] `src/core/playback.ts` is unchanged; `maestro_flag`/`part_note` cluster + trend via the default
      signature path.
- [ ] Frozen protocol untouched (no new event names/fields/sentinels; `FLAG:` is a string convention
      on the frozen `note` field). Stale-token gate green.
- [ ] `npm run typecheck` / `lint` / `test` green; `dist/consort.cjs` rebuilt + committed.

## Risks

- **Routine-note false positives.** Mitigated by the `FLAG:` marker — only marked notes are captured,
  so ordinary progress notes stay out of forensics. A unit test pins both directions.
- **Flag-file proliferation.** Many flags in a run → many small files. Acceptable: each is a distinct
  observation, and playback's `TRENDS` collapses repeats by signature. (If it ever becomes noisy, a
  later change can switch to per-run appending; out of scope here.)
- **Abort durability for part notes.** Part `FLAG:` notes ride the teardown scan (same as part
  errors), so a run that aborts without a teardown scan won't surface them in playback (they remain in
  the archived part outbox). This matches existing part-error behavior; Maestro flags (the
  immediate-write path) are the abort-durable channel.

## Relationship to clone-wars (the behavioral predecessor)

New behavior beyond the faithful port — the predecessor had no judgment-flag channel. Additive: it
introduces no new wire events and does not alter any existing capture path; the mechanical scan,
spawn-failure capture, and playback review are all unchanged except for the two new `Finding.source`
values flowing through generically. Hence its own spec, per the project phase guard.

## Out of scope

- No lowering of the mechanical auto-scan threshold (no auto-capture of `done` summaries, routine
  `progress` notes, or status transitions) — the new signal is deliberate judgment, not automatic.
- No per-run flag-file coalescing (one file per flag, like spawn-failures).
- No new event types, fields, sentinels, or `contracts.yaml` keys.
- No change to `src/core/playback.ts`.
