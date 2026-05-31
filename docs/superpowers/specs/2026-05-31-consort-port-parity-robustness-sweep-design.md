# consort — Port-Parity & Robustness Sweep — Design

**Status:** approved 2026-05-31 · **Type:** behavior-restoring / hardening (faithful-port parity)

**Origin:** After fixing the pluginRoot self-locate (PR #14), spawn-failure forensics (PR #14), and the
dropped `soundcheck` pane-border check (PR #15), an adversarially-verified audit of all commands
(workflow `wf_27e3206f-63b`) surfaced **21 candidate divergences → 15 confirmed real** (6 dropped as
intentional rebrand/spec changes). This sweep fixes all 15.

Each fix **restores or hardens a clone-wars behavior** the TypeScript port unintentionally dropped or
weakened. Line numbers in clone-wars drift — cite by symbol; grep to confirm.

## Scope — the 15 confirmed findings

### Medium (5)

**M1 — `soundcheck` missing identity-template FAIL-check.** `medic.sh:113-119` FAIL-guards that the
plugin-side `config/prompt-templates/identity.md` exists; `soundcheck.ts::healthCheck` has no
equivalent. The template is load-bearing — `ipc.ts::identityWrite` (every spawn) throws if it's
absent — so a partial install passes "Verdict: OK" then crashes at first spawn.
**Fix:** after the config loop, add
`const idTpl = join(pluginRoot(), "config", "prompt-templates", "identity.md"); if (existsSync(idTpl)) log.ok("config: identity.md (template present)"); else { log.error(\`config: identity template not found at ${idTpl}\`); fail = 1; }`.

**M2 — `solo` turn-send dropped the part-not-idle gate.** `deploy-turn-send.sh:37-44` refuses to
dispatch when `status.json` state !== `idle`; the sibling port `perform.ts:184-185` keeps it, but
`solo.ts::turnSendWith` doesn't — so re-arming turn-send mid-turn writes a fresh `OFFSET` and nudges
the pane mid-write, silently corrupting offset accounting.
**Fix:** in `turnSendWith`, after the stateFile-exists check, mirror `perform.ts:184-185`:
read `statusPath(instrument, provider, topic)`, match `/"state":"([^"]*)"/`, and if present and
!== `"idle"` → `log.error("solo turn-send: part not idle (state=…); previous turn still in flight"); return 1`.
Add `statusPath` to the ipc import.

**M3 — `rehearsal` init `configRoot` bypasses the fixed `pluginRoot()`.** `rehearsal.ts:147`
hand-rolls `configRoot: () => process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd()` — the exact pre-PR-#14
bug pattern — so when `CLAUDE_PLUGIN_ROOT` isn't exported into the node child, it falls to the target
repo's cwd, `seedLib` finds no `config/rehearsal-lib-seed`, and silently (try/catch) skips seeding
`arena.py`/`__init__.py`/`README.md`.
**Fix:** `configRoot: () => pluginRoot()` (import `pluginRoot` from `../core/paths.js`).

**M4 — outbox `readFrom` unguarded `openSync` crashes every wait verb.** `ipc.ts:65` `openSync(path,"r")`
has no try/catch; a TOCTOU unlink (teardown/rotation after the `size>start` check) or EMFILE/EACCES
throws out of `outboxWaitSince`'s poll loop and up through **every** un-try/caught wait caller
(solo/score/prelude/perform/collect/spawn) — a recoverable timeout becomes an opaque crash with no
recorded `TS=`/`FS=` and no forensics.
**Fix:** wrap `readFrom`'s body in `try { … } catch { return "" }` (mirror `outboxOffset`'s guard), so
a transient unreadable outbox is a no-match poll and the loop reaches its real timeout.

**M5 — `score.md` answer relay drops the `ANSWER:` prefix.** The shipped skill-hints
(`config/skill-hints/brainstorming.md:18`, `systematic-debugging.md:19`), appended verbatim into the
part's prompt via `scoreSkill.ts`, instruct the part to read *"the line beginning `ANSWER: `"*. But
`score.md` Stage 5 step 3 (line 141) and Stage 8 tell the Maestro to `send … @<reply-file>` a free-form
reply with no `ANSWER:` prefix; `send.ts` writes the body verbatim. A part following its hint finds no
`ANSWER:` line and the question→answer handshake can stall. (clone-wars `consult.md:634` directed
`"ANSWER: <your answer>"`.)
**Fix:** in `score.md` Stage 5 step 3 and Stage 8, instruct the Maestro to begin the reply body with a
line `ANSWER: <answer>` before `$CS send … @<reply-file>`.

### Low (10)

**L6 — `soundcheck` shows `installed` not the real `--version`.** `medic.sh:170-171` prints
`$bin --version`; `soundcheck.ts:141` hardcodes `installed`. **Fix:** capture
`execFileSync(bin, ["--version"]).split("\n")[0].trim()` best-effort, fall back to `installed`.

**L7 — `solo` turn-send missing outbox-not-found guard.** `deploy-turn-send.sh:35` asserts the outbox
exists ("was cody spawned?"); `solo.ts` doesn't, so `outboxOffset` returns 0 for a missing outbox and
solo writes `OFFSET=0` before failing generically. **Fix:** before `offsetFor`, mirror
`perform.ts:182-183`: `if (!existsSync(outboxPath(...))) { log.error("solo turn-send: outbox not found at … — was … spawned?"); return 1; }`.

**L8 — `perform` turn-wait dropped malformed-question validation.** `extractQuestionPayload`
(`performQuestions.ts:150-159`) only checks `message !== ""`; clone-wars
`cw_trooper_question_validate_line` also rejects non-ASCII / escaped-quote text and requires a present
`claim.kind` ∈ {path,git,env,cmd,test} with non-empty `claim.value`. A malformed claim is routed to
`verify` instead of `TS=failed`. **Fix:** add a pure `validateQuestionLine(ev)` (ASCII/printable+tab
guard, reject escaped quote/backslash in text, claim kind-allowlist + non-empty value) and call it in
`extractQuestionPayload`; return null on failure so the existing `TS=failed` path runs.

**L9 — `perform` unknown-flag handling.** The `--provider` *directive* drop is **intentional** (spec
replaced it with the runtime claude-confirm AskUserQuestion). But `parsePerformArgs` has no
unknown-flag arm, so `--provider claude <doc>` falls into `rest`, trips the `designPath.includes(" ")`
guard at `perform.ts:129`, and aborts with a misleading "exactly one design-doc path is required".
**Fix:** in `parsePerformArgs`, reject an unrecognized `-*` token with `rc 2` "unknown flag: <tok>";
and remove the orphaned `override?` param from `detectProvider` (no call site passes it).

**L10 — `spawn --target-pane` membership validation dropped.** `spawn.sh:94-115` validates the pane
appears in `<preflight-art-dir>/preflight-panes.txt`; `spawn.ts:66-72` only does `paneAlive`, so a
stray-but-live pane id would be respawned into (clobbering a foreign TUI). **Fix:** re-add an optional
`--preflight-art-dir <abs>` arg; when set with `--target-pane`, parse `preflight-panes.txt` and reject
(`captureSpawnFailure(reason:"pane_failed")` + `rc 1`) if the pane isn't listed for the instrument,
before respawn. Thread `--preflight-art-dir` from the `spawn-all` callers (score/prelude/rehearsal) so
the guard is active on the real path.

**L11 — `roster` ignores the stale-threshold env knob.** `list.sh:73` sources
`${CW_STALE_THRESHOLD_S:-180}`; `roster.ts:50` calls `classifyStale(…, ob)` with no third arg.
**Fix:** pass `Number(process.env.CONSORT_STALE_THRESHOLD_S ?? 180)` (matching `rehearsal.ts`'s
`CONSORT_STUCK_S` convention), keeping the in-function 180 fallback.

**L12 — `spawn` bootstrap timeout no longer dumps the outbox.** `spawn.sh:249-253` dumps `outbox.jsonl`
to stderr on the {ready,error} timeout; `spawn.ts:92-107` captures only the pane tail. Partial/garbled
outbox events (the usual cause) are surfaced nowhere. **Fix:** on the timeout branch, also write
`outboxDump(instrument, model, topic)` to stderr (the helper exists, used in `collect.ts`).

**L13 — `rehearsal` teardown never removes `preflight-panes.txt` (+ latent killPane bug).**
`cw_preflight_kill_orphans` does `rm -f preflight-panes.txt`; `rehearsal.ts:1200-1207` doesn't, and it
passes the whole `inst\tpane` TSV line to `killPane` as the target (a malformed tmux id). **Fix:** split
each line on `\t` and pass the pane field to `killPane`; after the loop `rmSync(pf, { force: true })`.

**L14 — `skill-hints/*.md` still say "this consult".** `brainstorming.md` (lines 1,5,9,45) and
`systematic-debugging.md` (lines 1,4,8,10) carry the old command noun, appended verbatim into part
prompts. **Fix:** scrub `consult` → `score` (or a neutral noun like "this run"/"the findings") in both
files. *(Not gate-banned, but a part-facing rebrand miss.)*

**L15 — `contracts.yaml:26` comment points to non-existent `commands/consult.md`.** The shipped,
user-editable config forward-references the renamed file. **Fix:** update the comment to reference
`commands/score.md` (and the directive-side auto-retry it documents, or drop the cross-ref if not
ported).

## Out of scope

The 6 audit findings the adversarial pass rejected as intentional (rebrand/spec) changes. The known
deferred-simplification quarantine items and `scrapeArtDir` not reading `failure-reason.txt` (a
separately-tracked forensics-coverage item) are **not** in this sweep.

## Constraints / guardrails

- **FROZEN protocol untouched** — no renames of wire events, `END_OF_INSTRUCTION`, JSON fields,
  `contracts.yaml` keys, or state filenames. The `ANSWER:` prefix (M5) is a Maestro→part *content*
  convention in `score.md`, not a wire field.
- **Stale-token gate stays green** — the `consult`→`score` scrubs (L14/L15) help it; introduce no
  `clone-wars`/`cw_`/`@cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`trooper`/`commander`, **including in
  new doc comments** (this gate scans comments and has bitten implementers before).
- **Architectural invariants** preserved: atomic write, absolute state paths, `JSON.parse`-then-event
  matching, errors to stderr not the outbox, one esbuild bundle.
- **Committed `dist/`** — rebuild + commit `dist/consort.cjs` once at the end of the sweep.
- **Faithful-port discipline** — each fix cites the clone-wars behavior it restores; no new behavior
  beyond parity/hardening.

## Testing

- **New unit tests** for the pure helpers introduced: `validateQuestionLine` (L8), the soundcheck
  identity-template check (M1, alongside the existing `paneBorderDiagnosis` test), and the `readFrom`
  guard (M4, via a forced unreadable-outbox case). `parsePerformArgs` unknown-flag rejection (L9) and
  the `roster` threshold wiring (L11) are also unit-testable.
- **Existing 975-test suite as the regression gate** for the integration-shaped fixes (solo/spawn/
  rehearsal tmux paths follow the project's "live behavior = dogfood" convention — no live-pane unit
  tests).
- The stale-token test must pass after the doc/config scrubs.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm run test` (existing suite + new unit tests), and the
  stale-token test all pass.
- Every one of the 15 findings is addressed per the fix above; no rejected/out-of-scope item touched.
- No FROZEN-protocol change; `perform --provider` is **not** restored (the intentional drop stands);
  the only behavior changes are the restored guards, the `ANSWER:` content convention, and the
  diagnostics.
- `npm run build` succeeds and the rebuilt `dist/consort.cjs` is committed.

## Risks

- **A "restored" guard is too strict and blocks a valid path** — mitigated by mirroring the exact
  sibling/clone-wars logic (M2/L7 copy `perform.ts`; L8 copies the validate-line allowlist) and the
  full suite.
- **The `--preflight-art-dir` threading (L10) regresses the happy path** — mitigated by keeping the
  arg optional and only validating when both `--target-pane` and `--preflight-art-dir` are present;
  the `spawn-all` callers pass both.
- **Doc-comment stale tokens** (L14/L15 and any new comments) — mitigated by the gate + explicit
  reviewer check.
