# CLAUDE.md — consort

Guidance for Claude Code working in this repository. These instructions override default
behavior. The machine-wide `~/.claude/CLAUDE.md` and the workspace `/home/liupan/CC/CLAUDE.md`
also apply and are not restated here.

## What this is

`consort` is a **TypeScript rewrite of the Bash plugin `clone-wars`** (`/home/liupan/CC/clone-wars`).
It is a Claude Code plugin where a **conductor** (a Claude Code session running `/consort:*`
commands) spawns and orchestrates real interactive model TUIs (`codex` / `claude` / `agy` /
`opencode`) as **tmux panes** the user can attach to. Coordination is **file-based IPC**
(inbox / outbox / status / pane), not in-process messaging.

The language and packaging change (Bash → TS; 61 `bin/*.sh` → one committed `dist/consort.cjs`);
the **wire protocol, state layout, and tmux mechanics stay byte-identical** so the external model
binaries behave exactly as they do under clone-wars.

## Canonical docs — read before touching code

| Doc | What it is |
|---|---|
| `docs/superpowers/specs/2026-05-29-consort-foundation-design.md` | the approved design (scope, naming, IPC + tmux contract, risks, acceptance) — **wins over MIGRATION.md where they differ** |
| `docs/superpowers/plans/2026-05-29-consort-foundation-0{1,2,3}-*.md` | the phased TDD implementation plans (scaffold+core / primitives / verify+dogfood) |
| `MIGRATION.md` | full architecture + phasing reference |
| `/home/liupan/CC/clone-wars` | the **behavioral spec** — preserve *behavior*, not *implementation*; grep by symbol (line numbers drift). Bible: `clone-wars/docs/DESIGN.md` |

## Current phase guard — load-bearing

**Shipped:** the foundation (scaffold + `core/*` + the six primitives
`spawn`/`send`/`collect`/`roster`/`coda`/`soundcheck` + `preflight`) and the high-level commands
**`solo`** (was strike), **`score`** (consult), **`perform`** (deploy), **`playback`**
(review-forensics), **`rehearsal`** (deep-research), and **`prelude`** (meditate) — each grounded by
its own spec under `docs/superpowers/specs/` and a live dogfood. `rehearsal` ships the full A–D port:
the six core `rehearsal*` modules + the verbs `init`/`metric`/`sota`/`spawn-all`/`experiment-send`/`score`/`monitor`/
`status-brief`/`finalize`/`refine`/`handoff-extract`/`forensics`/`teardown`/`fresh-part`/`abort`/`consensus`,
the inline loop, and Phases 0–7 of `commands/rehearsal.md`. `prelude` ships the five core `prelude*`
modules (`prelude`/`preludeLit`/`preludeConfidence`/`preludeTurn`/`preludeHandoff`) + the verbs
`init`/`classify`/`spawn-all`/`research-send`/`research-wait`/`synth-preliminary`/`confidence`/
`adversary-send`/`adversary-wait`/`synth-final`/`forensics`/`teardown`/`handoff-extract`, the lit-track
classifier, the 5-signal confidence gate, the adversary round, and Phases 0–10 of `commands/prelude.md`.

**Fully ported, then deliberately narrowed.** Every clone-wars command has a consort equivalent. As of
0.1.24 the **multi-sub-repo subsystem has been retired** — consort is **single-repo-only**: no
`--targets`, no `score` multi-repo detection / 8-section walk, no `perform` DAG/wave/sibling execution
(design: `docs/superpowers/specs/2026-06-04-multi-repo-retirement-design.md`). New behavior beyond a
faithful port — or a deliberate divergence like the retirement — still needs its own spec under
`docs/superpowers/specs/`; do not import features across command boundaries without a design doc.

## The musical rebrand (locked) — change everything cosmetic, freeze the protocol

Cosmetic renames (apply everywhere; the stale-token test enforces the absence of the old terms):

| clone-wars | consort |
|---|---|
| `commander` (concept + `pane.json`/`ready` JSON key) | `instrument` |
| worker noun "trooper" | "part" |
| conductor "Master Yoda" / `From: master-yoda` | "Maestro" / `From: maestro` |
| `commanders.yaml` | `instruments.yaml`; cast = instrument names |
| rank / legion (color grouping + label prefix) | orchestral **section** (strings/woodwinds/brass/percussion/keys/early) |
| `@cw_*` tmux options | `@cs_*` |
| teardown banner "MISSION ACCOMPLISHED" | "FINE" |
| `cw_*` fn prefix / `CLONE_WARS_HOME` / `.clone-wars/` | dropped / `CONSORT_HOME` / `.consort/` |
| commands `consult/meditate/deep-research/deploy/strike/review-forensics` | `score/prelude/rehearsal/perform/solo/playback` |
| commands `list/teardown/medic` | `roster/coda/soundcheck` |
| primitives `spawn`/`send`/`collect` | **unchanged** (CLI-internal plumbing) |

**FROZEN — never rename** (drop-in compatibility with the external model binaries depends on it):
event names `ready/ack/progress/done/error/question`; sentinel `END_OF_INSTRUCTION`; JSON fields
`ts/summary/artifacts/note/message/fatal/task_summary/model/topic`; `contracts.yaml` keys
(`binary/modes/default_mode/ready_timeout_s/bootstrap_sleep_s/timeout_multiplier/consult_validated`);
state filenames; `CLAUDE_CODE_SESSION_ID`.

A `tests/stale-tokens.test.ts` gate fails the build if `clone-wars` / `cw_` / `master-yoda` /
`MISSION ACCOMPLISHED` / `@cw_` appears in shipped `src`/`config`/`commands`/`hooks`/`.claude-plugin`.
Fix the offending file; never weaken the gate.

## Architecture & conventions

- **One esbuild bundle:** `dist/consort.cjs`, dispatched by subcommand (`src/consort.ts` →
  `src/commands/<verb>.run(args)`). Logic in `src/core/*`; one file per responsibility.
- **`dist/` is committed** (zero-build install). After changing `src/`, run `npm run build` and
  commit the refreshed `dist/consort.cjs`.
- **tmux is the only subprocess surface** (via `execa`). Test tmux code as **pure arg-array
  builders**; never spawn real panes in unit tests (live behavior = the dogfood).
- **Typed objects + `JSON.parse`, not shell parsing.** Event matching is `JSON.parse(line)` then
  `obj.event === name` (never the anchored regex). Skip non-JSON lines.
- **Atomic writes** for `status.json`/`pane.json`/`inbox.md`/identity: tmp-in-**same-dir** + rename.
  Never write to `/tmp` then rename (cross-device renames aren't atomic).
- **All state paths absolute**; `<repo-hash> = sha256(realpath(cwd))` with no trailing newline.
- No emojis in shipped output (grep-ability). Errors to **stderr**, never the outbox. Closed
  provider set (a new provider = a `contracts.yaml` row + dogfood, not an open OpenAI-compat set).

## Commands (per AGENTS-style toolchain)

```
npm run typecheck   # tsc --noEmit (replaces clone-wars' static-wiring locks)
npm run test        # vitest run
npm run lint        # eslint
npm run build       # esbuild → dist/consort.cjs (commit the result)
```

Test isolation: set `CONSORT_HOME` to a fresh temp dir per test (see `tests/helpers/tmpHome.ts`).
For the live dogfood, run inside tmux with `CLAUDE_PLUGIN_ROOT=$PWD`.

## CodeGraph

This project has CodeGraph initialized (`.codegraph/`) and the `codegraph_*` MCP tools. Prefer it
for structural questions (where is X, what calls Y, what breaks if Z changes) over grep. The
index lags writes by ~1s via the file watcher; check the staleness banner before trusting stale files.
