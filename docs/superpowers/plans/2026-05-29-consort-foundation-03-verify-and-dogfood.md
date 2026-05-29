# Consort Foundation — Plan 03: Verify + Dogfood Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. **Prerequisite:** Plans 01 + 02 complete (core + primitives green). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Prove the foundation is correct and behavior-faithful: a full static gate, a multi-agent adversarial verification pass comparing the TS wire-protocol/tmux behavior byte-for-byte against the clone-wars Bash source, and the **live dogfood** — a real `spawn → send → collect → roster → coda` against an actual `codex` pane in this tmux session.

**Architecture:** Verification is the safety net before the live run; the dogfood is the definition of "done" for the whole foundation sub-project. The dogfood is runnable here (tmux 3.4, `codex`/`claude`/`agy`/`opencode` all on PATH).

**Tech Stack:** same as Plans 01/02, plus the Workflow tool for the adversarial pass.

---

### Task 22: Full static gate

**Files:** none (verification only)

- [ ] **Step 1: Typecheck** — Run: `npm run typecheck` → exit 0, no output.
- [ ] **Step 2: Full unit suite** — Run: `npm run test` → all files PASS. If any fail, fix the implementation (not the test) and re-run.
- [ ] **Step 3: Lint** — Run: `npm run lint` → clean (fix unused imports flagged in Plan 02 notes).
- [ ] **Step 4: Stale-token gate** — Run: `npx vitest run tests/stale-tokens.test.ts` → PASS (no `clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_` in shipped `src`/`config`/`commands`/`hooks`/`.claude-plugin`).
- [ ] **Step 5: Build + smoke** — Run: `npm run build && node dist/consort.js` → exit 2 with `consort: missing subcommand`; `node dist/consort.js roster` runs (prints `no parts deployed...` if no state). Commit any dist refresh.

---

### Task 23: Adversarial verification pass (multi-agent)

**Files:** none (produces a findings list; fixes applied inline if any)

Run a Workflow that fans out independent verifiers, each comparing one behavior surface of the TS port against the clone-wars Bash source, prompted to **find a discrepancy** (default to "discrepancy found" if unsure). Confirmed discrepancies become fixes.

- [ ] **Step 1: Launch the verification workflow** (paste this script into the Workflow tool)

```js
export const meta = {
  name: "consort-foundation-verify",
  description: "Adversarially verify the consort TS port matches clone-wars Bash behavior byte-for-byte",
  phases: [{ title: "Verify" }, { title: "Adjudicate" }],
};

const SURFACES = [
  { key: "inbox-format", ts: "src/core/ipc.ts", bash: "lib/ipc.sh (cw_inbox_write)",
    claim: "inbox.md body is byte-identical except From: maestro: header line, blank line, task, blank, done-template backtick line, blank, END_OF_INSTRUCTION as the LAST line." },
  { key: "identity-ready", ts: "src/core/ipc.ts (identityWrite)", bash: "lib/ipc.sh (cw_identity_write)",
    claim: "the appended ready-instruction block emits a runtime $(date ...) timestamp and uses key \"instrument\" (not commander); tokens {{instrument}}/{{model}}/{{topic}}/{{state_dir}} all substituted." },
  { key: "event-match", ts: "src/core/ipc.ts (eventMatches/outboxWait)", bash: "lib/ipc.sh (cw_event_match_pattern, cw_outbox_wait)",
    claim: "TS JSON.parse+obj.event===name returns the LAST matching event (tail -n1 semantics) and is immune to a progress note that quotes \"event\":\"done\"." },
  { key: "wait-since-offset", ts: "src/core/ipc.ts (outboxWaitSince/outboxOffset)", bash: "lib/ipc.sh (cw_outbox_wait_since, cw_outbox_offset)",
    claim: "offset is BYTES (statSync.size); only content after the offset is matched; timeout=N does N checks." },
  { key: "atomic-write", ts: "src/core/atomic.ts", bash: "lib/state.sh (cw_atomic_write)",
    claim: "tmp file is in the SAME directory as dest, renamed atomically, removed on throw — never a cross-device /tmp rename." },
  { key: "repo-hash", ts: "src/core/paths.ts (repoHash)", bash: "lib/state.sh (cw_repo_hash_for)",
    claim: "sha256 of realpath(cwd) with NO trailing newline → 64 lowercase hex; matches `printf '%s' <realpath> | sha256sum`." },
  { key: "tmux-split", ts: "src/core/tmux.ts (split*/respawn args)", bash: "lib/tmux.sh + bin/spawn.sh",
    claim: "first part -h (right), subsequent -v (down) via .last_pane, --target-pane → respawn-pane -k; -P -F '#{pane_id}' and -c <cwd> always present." },
  { key: "colors-label", ts: "src/core/colors.ts", bash: "lib/colors.sh",
    claim: "label-fmt fragment structure matches (#[fg=primary,bold]<section>-<instrument>#[default]:#[fg=secondary,bold]<model>#[default]:<topic>); Morandi color VALUES are reused verbatim; section replaces rank." },
  { key: "preflight-rollback", ts: "src/core/tmux.ts (preflightLayout)", bash: "bin/preflight-layout.sh",
    claim: "first -h then -v, select-layout main-vertical, atomic preflight-panes.txt write, and rollback kills all created panes on any mid-preflight failure." },
  { key: "coda-sleep-once", ts: "src/commands/coda.ts (teardownBatch)", bash: "bin/teardown.sh (_teardown_batch)",
    claim: "ONE shared 9s wait for the whole batch (not 9*N), graceful before the wait, killNow after, and stateArchive runs for EVERY pair regardless of liveness." },
  { key: "bootstrap-timing", ts: "src/commands/spawn.ts", bash: "bin/spawn.sh",
    claim: "bootstrap_sleep floors preserved (codex/agy=20, claude=12, opencode=15), nudge is send-keys -l then 0.3s then Enter, failure forensics written BEFORE killNow+archive." },
  { key: "opencode-perm", ts: "src/commands/soundcheck.ts (opencodePermissionCheck)", bash: "lib/opencode_preflight.sh",
    claim: "string 'allow'→rc0, other string→rc1 naming value, object→rc2, absent/nested-only→rc1; mixed-case 'Allow'→rc1." },
];

const results = await pipeline(
  SURFACES,
  (s) => agent(
    `Adversarially verify ONE behavior surface of the consort TS port against the clone-wars Bash source. Your DEFAULT verdict is "discrepancy" — only return ok:true if you positively confirm equivalence by reading BOTH sides.\n\n` +
    `TS file(s): /home/liupan/CC/consort/${s.ts}\n` +
    `Bash source: /home/liupan/CC/clone-wars/${s.bash}\n` +
    `Claim to verify: ${s.claim}\n\n` +
    `Read both. Account for the intended rebrand (commander→instrument, maestro, FINE banner, @cs_*, section-not-rank, JSON.parse-not-regex) — those are NOT discrepancies. Report only genuine behavior drift (wrong format byte, wrong ordering, wrong default, lost edge case, broken atomicity/rollback).`,
    { label: `verify:${s.key}`, phase: "Verify", schema: {
      type: "object",
      required: ["surface", "ok", "severity", "finding"],
      properties: {
        surface: { type: "string" },
        ok: { type: "boolean", description: "true iff TS matches Bash behavior (modulo intended rebrand)" },
        severity: { type: "string", enum: ["none", "minor", "major"] },
        finding: { type: "string", description: "the discrepancy + exact fix, or 'confirmed equivalent'" },
      },
      additionalProperties: false,
    } },
  ).then((v) => ({ ...v, surface: s.key })),
);

const discrepancies = results.filter(Boolean).filter((r) => !r.ok);
return { total: SURFACES.length, discrepancies };
```

- [ ] **Step 2: Triage** — For each returned discrepancy with `severity: major|minor`, read the cited TS + Bash, confirm it's real (not a misread of the intended rebrand), and fix inline. Re-run `npm run test && npm run build`. Ignore `severity: none` / confirmed-equivalent.

- [ ] **Step 3: Commit any fixes** — `git add -A && git commit -m "fix: adversarial verification findings (foundation)"` (skip if no fixes).

---

### Task 24: Live dogfood (the acceptance gate)

**Files:** none (a real end-to-end run in this tmux session)

Run inside tmux (confirmed: `tmux 3.4`, `codex` on PATH). Use a throwaway topic `dogfood-foundation`. Set `CLAUDE_PLUGIN_ROOT` to the repo so identity/config resolve.

- [ ] **Step 1: Soundcheck** — Run:
```bash
cd /home/liupan/CC/consort && CLAUDE_PLUGIN_ROOT=$PWD node dist/consort.js soundcheck
```
Expected: `Verdict: OK — ready to spawn (N/M providers available; ...)`; `providers-available.txt` written under `~/.consort` (or `$CONSORT_HOME`). Confirm `codex` is listed.

- [ ] **Step 2: Spawn a real codex part** — Run:
```bash
cd /home/liupan/CC/consort && CLAUDE_PLUGIN_ROOT=$PWD node dist/consort.js spawn violin codex dogfood-foundation
```
Expected: a new tmux pane splits **right** of the conductor running the `codex` TUI; its border label reads `strings-violin:codex:dogfood-foundation` in the violin Morandi color (`colour110`); within `ready_timeout_s` the command logs `violin is ready` and prints the summary block (`part / pane / state / ready: yes`), exit 0. If it times out, read `<partDir>/failure-reason.txt` — it must exist and contain the scrollback + `fail_reason: timeout`.

- [ ] **Step 3: Send a task** — Run:
```bash
cd /home/liupan/CC/consort && CLAUDE_PLUGIN_ROOT=$PWD node dist/consort.js send violin dogfood-foundation "Reply with the current working directory, then emit your done event."
```
Expected: status block with `inbox:` path and `From: maestro` written; the codex pane receives the nudge and starts working.

- [ ] **Step 4: Collect the done event** — Run:
```bash
cd /home/liupan/CC/consort && CLAUDE_PLUGIN_ROOT=$PWD node dist/consort.js collect violin dogfood-foundation --timeout 180
```
Expected: blocks until the part appends `{"event":"done",...}`, then logs `{done} received`, prints the JSON line, exit 0.

- [ ] **Step 5: Roster** — Run:
```bash
cd /home/liupan/CC/consort && CLAUDE_PLUGIN_ROOT=$PWD node dist/consort.js roster
```
Expected: a table with header `PART MODEL TOPIC PANE STATE` and a row `violin codex dogfood-foundation %<id> idle (done)`.

- [ ] **Step 6: Coda (teardown with FINE banner)** — Run:
```bash
cd /home/liupan/CC/consort && CLAUDE_PLUGIN_ROOT=$PWD node dist/consort.js coda violin dogfood-foundation
```
Expected: the violin pane shows the colored `FINE — pane closing` banner + an 8s countdown, then closes; the command logs `archived violin-codex: <path>`. Confirm the archive dir exists under `~/.consort/archive/<repo-hash>/dogfood-foundation/violin-codex-<ts>/` and the topic dir is gone.

- [ ] **Step 7: Record the dogfood result** — Append a short PASS/FAIL note (with the archive path) to the foundation design spec's acceptance section, or to a new `docs/superpowers/DOGFOOD.md`. Commit.

```bash
git add -A && git commit -m "test: foundation live dogfood PASS (spawn→send→collect→roster→coda)"
```

---

## Foundation done — definition met

- [ ] `npm run typecheck` clean, `npm run test` green, `npm run lint` clean, `npm run build` emits `dist/consort.js`.
- [ ] Stale-token gate clean.
- [ ] Adversarial verification: no open major/minor discrepancies.
- [ ] Live dogfood: `spawn → send → collect → roster → coda` passed against a real `codex` pane; state archived; FINE banner rendered.

**Next (separate spec → plan → build cycles, reusing this foundation):** `solo` (was strike) → `score` (consult) → `perform` (deploy) → `prelude` (meditate) → `rehearsal` (deep-research) → `playback` (review-forensics).
