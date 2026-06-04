# consort

**Multi-model tmux orchestration for Claude Code.** A *conductor* — a Claude Code session running
`/consort:*` slash commands — spawns and steers real interactive model TUIs (`codex` / `claude` /
`agy` / `opencode`) as **tmux panes you can attach to and watch**. Coordination is file-based IPC
(inbox / outbox / status / pane), so the external model binaries behave exactly as they do on their
own — consort just conducts them.

The metaphor is orchestral: the conductor is the **Maestro**, each model TUI is an **instrument**, a
worker is a **part**, and instruments are grouped into **sections** (strings / woodwinds / brass /
percussion / keys / early). The commands are named for musical acts — `score`, `prelude`,
`rehearsal`, `perform`, `solo`, `playback`.

> consort is a TypeScript rewrite of the Bash plugin **clone-wars**. The packaging changed (one
> committed `dist/consort.cjs`, zero-build install); the wire protocol, state layout, and tmux
> mechanics are byte-compatible so the model binaries are drop-in.

---

## Install

consort ships as a Claude Code plugin via its own marketplace:

```
/plugin marketplace add WingsOfPanda/consort
/plugin install consort@consort
```

To update later: `/plugin marketplace update`, then re-install/upgrade.

### Requirements

- **Claude Code** (the conductor runs as a Claude Code session).
- **tmux** — every part is a real tmux pane; consort is the only subprocess surface.
- **At least one model CLI on `PATH`** — `codex`, `claude`, `agy`, or `opencode`. Run
  `/consort:soundcheck` to detect what's available and pick your active set.
- No build step: `dist/consort.cjs` is committed.

---

## Commands

| Command | What it does |
|---|---|
| **`/consort:soundcheck`** | Health check (tmux / pane-border / state / config / providers) + an interactive roster picker that selects the active provider set for `/consort:score`. |
| **`/consort:roster`** | Show active parts (panes + state), optionally scoped to a topic. |
| **`/consort:solo`** | Light pipeline — one part implements a clear single-repo change unattended on its own branch; the conductor briefs, verifies, and finishes. No research, no design doc, no gates. |
| **`/consort:prelude`** | Deep multi-aspect exploration — SOTA surveys, multi-angle thinking, an adversary-tested landscape doc that feeds `/consort:score`. |
| **`/consort:score`** | Cross-verified multi-model research synthesized into a deploy-audit-passing design doc — a Maestro fast-path, or escalate to a 2–3 part ensemble. |
| **`/consort:rehearsal`** | Advisor-driven autoresearch — lock a measurable metric, sweep SOTA, spawn 2–3 persistent `codex` parts, and adaptively dispatch experiments until a target / plateau / budget stop. **Explore-only** (see below). |
| **`/consort:perform`** | Implement a deploy-schema design doc — audit + route, spawn one part to plan / implement / self-verify, the Maestro cross-verifies and runs a bounded fix-loop, then per-target finish + teardown. This is the promotion-to-real-code path. |
| **`/consort:playback`** | Review accumulated forensics from `solo`/`score`/`perform`/`prelude`/`rehearsal` — surface problems recorded since you last looked, cluster recurring patterns with their lifetime trend, suggest next actions, then archive what was reviewed. |
| **`/consort:coda`** | Gracefully end parts (a `FINE` banner) and archive their state. |

A typical research-to-code flow: **`prelude` → `score` → `perform`** (explore → design → implement),
with **`rehearsal`** as the heavyweight autoresearch loop and **`solo`** for quick unattended changes.
`soundcheck` / `roster` / `playback` / `coda` are the operational glue.

---

## `/consort:rehearsal` — the autoresearch loop

`rehearsal` is the most substantial command: an AIDE-style loop where the Maestro locks a measurable
metric, sweeps the state of the art, spawns 2–3 persistent `codex` "parts" as tmux panes, and
adaptively dispatches single-config experiment ideas until a stop condition (target met, plateau, or
time budget). It is **explore-only** — it never touches your real repo; promotion to real code is
`/consort:perform`.

It ships a **research-validity layer** that treats a part's self-reported metric as *a claim, not
evidence*, and hardens the loop against both buggy and deliberately-gaming parts:

- **Metric trust (verify):** the trusted Maestro re-runs each result's scoring step *outside* the
  part's pane and adjudicates a verdict.
- **Sanity & integrity gates:** mechanical task-agnostic checks (ceiling / under-run /
  log-contradiction / config-knob drift) + a recorded integrity attestation.
- **INFEASIBLE vs REFUTED:** a botched run (couldn't be validly executed) is classified INFEASIBLE
  and kept out of the leader set — it never masquerades as a refuted idea or a false leader.
- **Coverage & diversity guard:** an approach-aware plateau + a per-family coverage tally, so the loop
  can't quietly converge on one approach family.
- **Operators & attribution:** typed Draft / Improve moves with a single-change-vs-parent lineage
  advisory, so a metric delta is attributable.
- **Independent re-implementation inspector:** for a new-best leader, the cross-family Maestro
  regenerates the experiment from the part's run-card *alone* and re-derives the metric — catching a
  part whose own scoring code is the gamed artifact. A confident non-reproduction demotes the leader.

These are gated, additive, and surfaced in the live status brief; design docs live under
`docs/superpowers/specs/`.

---

## How it works

- **One bundle, dispatched by subcommand.** `dist/consort.cjs` (built from `src/consort.ts`) routes
  `consort <verb>` to `src/commands/<verb>`. Core logic lives in `src/core/*`, one file per
  responsibility. `dist/` is committed for zero-build install.
- **tmux is the only subprocess surface** (via `execa`). Parts are real panes you can attach to.
- **File-based IPC.** Coordination happens through `inbox` / `outbox` / `status` / `pane` files under
  a per-machine state root (`CONSORT_HOME`, default `~/.consort/`), keyed by a hash of the working
  directory. Writes are atomic (tmp-in-same-dir + rename).
- **A closed provider set.** `codex` / `claude` / `agy` / `opencode`, each defined by a row in
  `config/contracts.yaml`. Adding a provider is a config row + a dogfood, not an open compat surface.
- **A frozen wire protocol.** Event names (`ready`/`ack`/`progress`/`done`/`error`/`question`), the
  `END_OF_INSTRUCTION` sentinel, and the result/state schemas are stable so the external binaries stay
  drop-in.

---

## Development

```
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run lint        # eslint
npm run build       # esbuild -> dist/consort.cjs  (commit the result)
```

After changing `src/`, run `npm run build` and commit the refreshed `dist/consort.cjs`. Tests isolate
state by pointing `CONSORT_HOME` at a fresh temp dir; tmux arg-builders are unit-tested as pure
functions (no real panes spawned). For a live dogfood, run inside tmux with `CLAUDE_PLUGIN_ROOT=$PWD`.

Canonical guidance for contributors is in `CLAUDE.md`; the architecture/phasing reference is
`MIGRATION.md`.

---

## License

MIT.
