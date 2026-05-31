# consort — Spawn Path Resolution + Spawn-Failure Forensics — Design

**Status:** approved 2026-05-31 · **Type:** bug fix (Part 1) + deliberate enhancement beyond clone-wars
parity (Part 2)

**Origin:** A live `/consort:score` dogfood against `iris-code` surfaced two problems, then a
`/consort:playback` review found nothing — proving the forensics net misses real failures.

## Background — what the dogfood found

1. **Spawn died** with *"can't find `config/prompt-templates/identity.md`"*. Root cause: `pluginRoot()`
   (`src/core/paths.ts`) is `process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd()`. The command files do
   `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"` — they interpolate the var into the **bundle
   path** but never `export` it, so the `node` child sees `process.env.CLAUDE_PLUGIN_ROOT` as
   undefined and `pluginRoot()` falls back to `cwd` (the target repo). `identityWrite`
   (`src/core/ipc.ts:25`) then reads `join(pluginRoot(), "config", "prompt-templates", "identity.md")`
   — which, unlike `contracts.ts`/`instruments.ts` (they fall back to a user copy under `globalRoot()`),
   has **no fallback** — so it hard-fails with ENOENT.
2. **A codex part narrated** that it was using *"the Clone Wars file-protocol memory."* Investigated and
   **dismissed**: consort's shipped prompts and all archived part state are clean of "clone"; the phrase
   comes from **codex's own memory store** (`~/.codex/memories/` contains a `clone-wars-file-protocol`
   skill). consort keeps the file-IPC protocol byte-identical to clone-wars by design, so codex
   recognized the same wire format by its old name. Harmless; **no consort change.**

**Why playback saw nothing.** Problem 1 fails at `spawn.ts:60` (`identityWrite`), *before* the
bootstrap-wait/`captureFailure` path (`spawn.ts:88-101`) — so it leaves zero forensic trace. And even a
genuine bootstrap timeout writes `failure-reason.txt` into the part dir, which `scrapeArtDir` never
reads, then archives the FAILED part out of the topic tree before teardown forensics runs. **clone-wars
had the identical blind spot** (`bin/forensics-capture.sh` scraped the same five sources and never read
`failure-reason.txt`; `bin/spawn.sh:228-243` also wrote it before archiving). Closing it is a conscious
enhancement, not a parity regression.

## Goal

1. Make `pluginRoot()` resolve correctly regardless of whether `CLAUDE_PLUGIN_ROOT` reaches the
   subprocess environment, so spawn no longer dies on the env gap.
2. Make **all** spawn failures self-report into the `/consort:playback` forensics feed.

Non-goals: any change to the FROZEN wire protocol, the spawn archive-on-failure timing,
`scrapeArtDir`, or codex's memory.

## Part 1 — Self-locating `pluginRoot()`

`src/core/paths.ts` — three-tier precedence:

```ts
export function pluginRoot(): string {
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;   // 1. explicit override
  try {                                                                         // 2. self-locate from the bundle
    const root = dirname(dirname(realpathSync(process.argv[1])));              //    <root>/dist/consort.cjs -> <root>
    if (existsSync(join(root, "config", "prompt-templates", "identity.md"))) return root;
  } catch { /* fall through */ }
  return process.cwd();                                                         // 3. last resort (old behavior)
}
```

- `realpathSync` resolves the plugin-cache symlink; `dirname` twice because the bundle is at
  `<root>/dist/consort.cjs`.
- The `existsSync` guard on a **known shipped asset** is what keeps this test-safe: under vitest /
  `node -e`, `process.argv[1]` is not the bundle, the guard fails, and resolution falls through to
  `cwd` — identical to today. Real plugin invocation (`node <root>/dist/consort.cjs <verb>`) now
  resolves the true plugin root even when `CLAUDE_PLUGIN_ROOT` is unset.
- One change fixes **every** consumer: identity template (`ipc.ts:25`), contracts/instruments
  (`contracts.ts:8`, `instruments.ts:9`), skill-hints (`scoreSkill.ts:30`), the FINE banner
  (`tmux.ts` `gracefulRespawnCommand`).
- `stateRoot()` (`paths.ts:16-19` = `CONSORT_HOME ?? <cwd>/.consort`) is **independent of
  `pluginRoot()`** and is not touched — so state location does not move. (This was the unfounded fear
  that blocked the dogfood's own diagnosis.)
- Required imports in `paths.ts`: add `dirname` from `node:path` (`realpathSync`, `existsSync`, `join`
  already imported).

Defensive secondary in `src/core/ipc.ts::identityWrite`: if the template read still throws, rethrow a
clear error naming the resolved `pluginRoot()` and suggesting `CLAUDE_PLUGIN_ROOT`. That message becomes
the forensic `detail` in Part 2.

## Part 2 — `captureSpawnFailure()` writes failures straight to the playback feed

New best-effort function in `src/core/forensics.ts`:

```ts
/** Write a spawn/bootstrap-failure finding straight to the playback feed (Approach A).
 *  Teardown-independent: works even when the part dir does not exist yet (pre-bootstrap) or
 *  teardown never runs (aborted run). Reuses renderArtForensics so playback's parser, trend
 *  ledger, and archive consume it unchanged. Best-effort: returns "" on any error; never throws. */
export function captureSpawnFailure(opts: {
  instrument: string; model: string; topic: string;
  reason: string;             // "timeout" | "error_event" | "config_error" | "binary_not_found" | "pane_failed" | "spawn_error"
  detail: string;             // one-line context: error message / event line / resolved path
  failureReportPath?: string; // path to the rich failure-reason.txt, if one was written
  now?: Date;
}): string
```

- Builds `Finding`s with `source: "spawn_failure"`, `key: "reason=<reason> <detail>"` (single-line,
  whitespace-collapsed), `context: "part=<instrument>-<model>"`; appends a second finding pointing at
  `failureReportPath` when present.
- Writes to `globalRoot()/forensics/<date>/<HH-MM-SS>-spawn-<topic>.md` via the **existing**
  `renderArtForensics` + `atomicWrite`, tagged `command: spawn`, `repo_hash` from `repoHash()`,
  `art_dir` = the part dir path (informational; may not exist).
- Mirrors `captureArtDir`'s path scheme and is wrapped in the same whole-body `try { … } catch { return
  "" }` guard, so it never blocks or throws on the failure path.
- `globalRoot()` is independent of `pluginRoot()`, so it writes to the correct feed even mid-failure.

`src/commands/spawn.ts` integration:

- Wrap the spawn-attempt body in `try/catch`. Any thrown error (identity-template ENOENT after Part 1's
  guard, missing binary, pane-split failure) → `captureSpawnFailure({ reason: "spawn_error" |
  "config_error", detail: err.message, … })`, then return 1 (preserving the current non-zero exit).
- The two explicit `return 1` failure exits each emit a finding before returning:
  - bootstrap timeout/error (`spawn.ts:90-101`) → `reason: ev ? "error_event" : "timeout"`,
    `detail` = the event line or `NO_EVENT_SENTINEL`, `failureReportPath` = the `failure-reason.txt`
    it already writes.
  - dead `--target-pane` (`spawn.ts:66`) → `reason: "pane_failed"`.
- `failure-reason.txt` and the archive-on-failure timing are left **exactly as-is**. `scrapeArtDir` is
  **not** modified — avoiding double-capture (the FAILED part is archived out of the topic tree, so the
  teardown scrape never sees it) and any parity risk.

`commands/playback.md`: note that spawn failures appear as `command: spawn` files in `survey` (a sixth
emitter alongside solo/score/perform/prelude/rehearsal), and that `spawn_failure` is a finding source to
cluster on. No change to playback's code or the survey/archive/trend logic.

## File structure

| File | Change |
|---|---|
| `src/core/paths.ts` | `pluginRoot()` → 3-tier precedence; add `dirname` import |
| `src/core/ipc.ts` | `identityWrite`: clear error if template still missing |
| `src/core/forensics.ts` | add `captureSpawnFailure()` |
| `src/commands/spawn.ts` | capture at the failure exits + `try/catch` wrapper |
| `commands/playback.md` | document `command: spawn` emitter + `spawn_failure` source |
| `tests/paths-pluginroot.test.ts` | extend: override / self-locate / cwd-fallback |
| `tests/forensics-spawn-failure.test.ts` | new: `captureSpawnFailure` round-trip + best-effort |
| `dist/consort.cjs` | rebuilt + committed |

## Testing

- **`pluginRoot()`** (extend existing test): (a) `CLAUDE_PLUGIN_ROOT` set → returned verbatim;
  (b) unset + `process.argv[1]` patched to a temp `<root>/dist/consort.cjs` with a real
  `<root>/config/prompt-templates/identity.md` → returns `<root>`; (c) unset + guard asset absent →
  returns `process.cwd()`. Restore `process.argv[1]`/env after each.
- **`captureSpawnFailure()`** (new): round-trips through `parseForensicsFrontmatter` /
  `parseMechanicalFindings` — asserts `command: spawn`, `source: spawn_failure`, the `failure-reason.txt`
  pointer finding, correct `n_findings_mechanical`; returns `""` and writes nothing on a forced error;
  and a written file is then listed by `surveyWith` (reuse `tmpHome`).
- **spawn integration** as a pure builder/unit test (no live panes): a forced failure invokes
  `captureSpawnFailure` with the right `reason`/`detail`; the bootstrap path forwards the
  `failure-reason.txt` path.
- Full existing suite stays green; stale-token gate stays green.

## Constraints / guardrails

- **FROZEN protocol untouched** — no renames of wire events, JSON fields, the `END_OF_INSTRUCTION`
  sentinel, `contracts.yaml` keys, or state filenames. `"spawn_failure"` / `command: spawn` live only
  inside the forensics markdown body, never on the wire.
- **Stale-token gate** stays green — new identifiers (`captureSpawnFailure`, `spawn_failure`) avoid
  `clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_`/`trooper`/`commander`.
- **Architectural invariants** preserved: atomic write (tmp-in-same-dir + rename), absolute state paths,
  `JSON.parse`-then-`obj.event===` matching, errors to stderr not the outbox, one esbuild bundle.
- **Committed `dist/`**: rebuild `npm run build` and commit `dist/consort.cjs` in the same work.
- **Faithful-port discipline:** Part 2 deliberately exceeds clone-wars parity (which had the same blind
  spot); recorded here as a conscious enhancement. Part 1 fixes a consort-port-introduced bug.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm run test` (existing suite + new tests), and the stale-token
  test all pass.
- `pluginRoot()` returns the real plugin root when invoked as `node <root>/dist/consort.cjs` with
  `CLAUDE_PLUGIN_ROOT` unset (the Problem-1 scenario no longer fails); `CLAUDE_PLUGIN_ROOT` still wins
  when set; test invocations still fall back to `cwd`.
- A simulated spawn failure produces a `command: spawn` forensics file that `playback survey` lists.
- No change to the FROZEN protocol, the spawn archive-on-failure timing, or `scrapeArtDir`.
- `npm run build` succeeds and the rebuilt `dist/consort.cjs` is committed.

## Risks

- **Touching `spawn.ts`'s failure paths** (FROZEN-adjacent) — mitigated by leaving `failure-reason.txt`
  and the archive timing untouched, adding only best-effort capture calls, and gating with the existing
  suite.
- **`pluginRoot()` self-location misfiring in tests** — mitigated by the `existsSync` guard that falls
  through to `cwd`, plus explicit unit coverage of all three tiers.
- **A spawn failure double-counted** — avoided: `scrapeArtDir` is unchanged and the FAILED part is
  archived out of the topic tree, so only `captureSpawnFailure` records it.
