# consort Simplification Plan

> **Source:** analysis-only sweep (2026-05-31) — 7 `code-simplifier` partition agents + 1 cross-family
> duplication pass + synthesis. **No edits were made**; this is the plan. 45 raw findings → 35 after dedup,
> 16 quarantined for human review, 3 dropped as noise.

**Verdict:** the codebase is **already clean and well-factored**. It is a disciplined faithful TS port with
pure logic split into `core/*`, consistent house style (explicit return types, `function` keyword, atomic
writes, `JSON.parse` event matching), and most apparent complexity is **deliberate, well-commented parity
quirks** that every agent correctly declined to touch. There is no structural rot. The accidental complexity
is three tight clusters:

1. **Port artifacts** — a handful of trivially-removable no-ops and dead exports.
2. **Low-level duplication** — `pluginRoot()`, `readIfExists()`, `resolveModel`, and a 5-6× `forensicsRun`
   wrapper all hand-rolled across many files where one shared helper would do.
3. **A deeper, parity-sensitive opportunity** — `score`/`prelude`/`perform` are three parallel
   implementations of one send→wait→classify→re-arm IPC loop whose on-disk `OFFSET=`/`<TAG>=` write
   ordering must be preserved byte-for-byte. **Quarantined** — needs human review with tests as the gate.

**Guardrails (apply to every edit below):** preserve the FROZEN protocol (event names, sentinel, JSON
fields, `contracts.yaml` keys, state filenames); never reintroduce a stale token; honor architectural
invariants (atomic write tmp-in-same-dir, absolute paths, `JSON.parse` event match, errors→stderr).
After any `src/` change: `npm run typecheck && npm run test && npm run lint && npm run build` and commit the
refreshed `dist/consort.cjs`.

---

## Phase 1 — trivial dead-code / no-op / dead-export removal

**Risk: none/low · Confidence: high · Effort: trivial.** Pure port artifacts — byte-identical behavior,
each verified against source. Land first to shrink surface before any consolidation.

| # | Item | Location | Change |
|---|---|---|---|
| 1.1 | No-op `.replace(/Z$/, "Z")` | `src/core/archive.ts:7` | Drop the trailing term (replaces `Z`→`Z`). |
| 1.2 | Dead trailing whitespace strip | `src/core/preludeConfidence.ts:15` | Drop the final `.replace(/\s+$/, "")` — the em-dash strip before it is end-anchored, so it can never match. |
| 1.3 | Self-reconstructing `===` clause | `src/commands/coda.ts:83` | Replace the `e.name === \`${instrument}-${e.name.slice(...)}\` && e.name.startsWith(...)` with just `e.name.startsWith(\`${instrument}-\`)` — first clause rebuilds `e.name` from itself, provably equal. |
| 1.4 | `void SLUG_REGEX` import-keepalive | `src/core/performScope.ts:10,14` | Delete the import, the `void` statement, and its comments — mirrored bash shared-sourcing, never referenced. |
| 1.5 | Dead `extractTarget` re-export | `src/core/perform.ts:11` | Remove the `export { extractTarget }` re-export; every consumer imports from `./audit.js` directly. |
| 1.6 | Never-dereferenced `CodaDeps.topicDir` | `src/commands/coda.ts:19,58` + `tests/coda.test.ts:15` | Drop the field, its `liveDeps()` wiring, and the test stub — `teardownBatch` uses the imported `topicDir`. |
| 1.7 | Over-exported arg-file helpers | `src/args.ts:22,28` | Make `loadArgsFile`/`consumeArgsFile` module-private — only `applyArgsFile` (same file) calls them. |
| 1.8 | Dead export `scoreDrilldownScratchDir` | `src/core/score.ts:142` + `tests/score-core.test.ts:100` | Delete the export + its test; no shipped path calls it (`drilldownWith` appends `_scratch` itself). |

---

## Phase 2 — consolidate true duplication into shared helpers

**Risk: none/low · Confidence: high · Effort: trivial–small.** Behavior-identical mechanical moves into one
source of truth. The cross-cut pass independently reported the same patterns, confirming they are
codebase-wide. **For the cross-partition helpers (2.1/2.2/2.4), do one coordinated PR per helper.**

| # | Item | Location | Change |
|---|---|---|---|
| 2.1 | Extract `pluginRoot()` | new in `core/paths.ts`; replaces ~8 copies in `contracts.ts:6`, `instruments.ts:7`, `ipc.ts:24`, `scoreSkill.ts:23`, `soundcheck.ts:33`, `coda.ts:48`, `rehearsal.ts:398` | `pluginRoot() => process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd()`. Byte-identical everywhere. |
| 2.2 | Shared `readIfExists` / `readIfExistsOrNull` | new in `core/atomic.ts` (or `core/fsread.ts`); replaces 6 redeclarations in `score.ts:123,410`, `prelude.ts:58`, `solo.ts:164`, `preludeHandoff.ts:39` | One `""`-fallback + one `null`-variant. `score.ts` has a genuine self-dup (module `readIf` **and** an in-fn lambda). Keep `solo.readField` as a thin first-line wrapper. |
| 2.3 | Delete `collect.ts` private `resolveModel` | `src/commands/collect.ts:7` | Import the byte-identical exported one from `core/ipc.js` (already used by perform/rehearsal). Leave `send.ts`'s variant (needs the dir). |
| 2.4 | Extract core `runForensics()` | new in `core/forensics.ts`; collapses 5-6 wrappers in `solo.ts:49`, `score.ts:591`, `perform.ts:592`, `prelude.ts:374`, `rehearsal.ts:1231` | Each `forensicsRun` becomes a one-line delegate. **Also unify the log wording** — `rehearsal` drifted (`forensics captured:` vs the other four's `<cmd> forensics: captured`). Log-only, not protocol. |
| 2.5 | `hasRepoMarker()` predicate | `src/commands/perform.ts:692,786` | Factor the `CLAUDE.md`/`AGENTS.md` existence check (comment at `:762` already notes the coupling). |
| 2.6 | `resolveMarker()` in multirepo | `src/core/multirepo.ts:22,43` | Shared realpath-resolved marker-precedence helper for `validateTargets` + `detectMultiRepo`. |
| 2.7 | `resultStr()` + reuse `readResultJson` | `src/commands/rehearsal.ts:298,604,1112` | Collapse three try/catch parse+coerce blocks; keep `readResultCells`'s `'—'` default. |
| 2.8 | Move `parseRosterTargets` beside `parseRosterFile`; factor `nonCommentLines` | `src/commands/score.ts:506` → `src/core/score.ts:56,91` | Co-locate the TSV reader with its writer; share the split→trim→drop `#`/blank preprocessing. |
| 2.9 | `gatherCompletion()` | `src/commands/rehearsal.ts:686,933` | One helper for the `scoreboard.md`+`metric.md` both-present completion-signal gate. |
| 2.10 | Reuse `ansiFromColor` in `_banner` | `src/consort.ts:26` (from `core/colors.ts:63`) | Replace the inline `colourNNN` ternary with the existing helper. |
| 2.11 | Hoist doubly-computed `outboxPath` | `src/commands/roster.ts:49` | Compute once, reuse in `deriveState` + `classifyStale`. |

---

## Phase 3 — sibling-idiom consistency + careful decomposition

**Risk: low · Lower value — do opportunistically when already in the file.**

| # | Item | Location | Change |
|---|---|---|---|
| 3.1 | `rehearsal` `usage()` to match siblings | `src/commands/rehearsal.ts:1446` | Add a `usage()` listing its ~16 verbs; `default:` prints it. score/solo/prelude/perform already do — rehearsal (most verb-rich) is the lone gap. **Minor real UX win.** |
| 3.2 | Decompose ~250-line `finalizeWith` | `src/commands/rehearsal.ts:751` | Extract the already-comment-delimited steps into named helpers, **preserving FROZEN step order**. Don't remove `parseScoreboard.rows` (asserted by `rehearsal-handoff.test.ts:18`). Effort: medium. |
| 3.3 | Rename research-named dep interfaces | `src/commands/score.ts:206,320` | `SendDeps`/`WaitDeps` with `ResearchSendDeps`/`ResearchWaitDeps` kept as test-imported aliases. Cosmetic. |
| 3.4 | Alias imported `topApproach` | `src/core/preludeHandoff.ts:9` | `import { topApproach as firstApproach }` to avoid the field-name shadow. Cosmetic. |
| 3.5 | `missingRosterArtifacts()` | `src/commands/prelude.ts:238,348` | Extract just the empty-file loop shared by synth-preliminary/synth-final; keep wording/filenames per-verb. Verify error strings byte-identical. |

---

## Quarantine — surface, do NOT auto-apply (parity / FROZEN-protocol risk)

These are real opportunities but each touches a parity-sensitive surface. **Each needs a human decision and
the named tests green as the parity gate.** Listed highest-value first.

1. **`research-send`/`research-wait` score↔prelude twins** (`score.ts:221,257`, `prelude.ts:178,211`) —
   biggest single dedup (~60 lines → ~2 adapters), but the varying hooks include the deliberate
   art-dir-flat `findings-<inst>.md` prelude quirk and touch the `OFFSET=` write sequence. Keep quirks as
   injected params, never removed. Gate: `score-escalation` + `prelude-cmd` tests.
2. **`recordWaitOutcome()` question re-arm + state-tag append** (`score.ts:272,387`, `prelude.ts:225,335`,
   `perform.ts:218`) — directly manipulates the two-`OFFSET=` question re-arm, a documented faithful quirk
   drop-in-compatible with external binaries. Must reproduce write order exactly; perform has an extra
   `extractQuestionPayload` guard.
3. **`SendDeps`/`WaitDeps` interfaces + live-deps literals to core** (`score.ts:206`, `prelude.ts:165`,
   `solo.ts:116`, `perform.ts:168`) — entangled with #1/#2; couples four command families' test surfaces.
   The triple-arg-guard `parseTopicInstrumentProvider` half could land safely if separated.
4. **`scoreBucketNames()`** (`score.ts:417`, `scoreAdjudicate.ts:134`) — PENDING/CONTESTED bucket filenames
   mirror `consult.sh` edge cases; keep byte-identical.
5. **`latestExpId` helper** (`rehearsal.ts:292,658,1402`) — consensus picks greatest exp **with
   `status==ok`**, not merely greatest; a shared helper must preserve the filter.
6. **`readParts()`** (`rehearsal.ts:278,643,770`) — `gatherPeers` reads `parts.txt` **without** the
   `#`-comment filter the others apply. Latent bug or quirk? Confirm against clone-wars before unifying.
7. **scoreboard row tokenizer** (`rehearsalBrief.ts:30`, `rehearsalComplete.ts:33`) — may merge **only** the
   two plain-rank parsers; the `~?\d+` partial-row regexes in `rehearsalSummary`/`rehearsalHandoff` must NOT
   be unioned in (would change which rows count).
8. **Memoize `contracts.yaml`** (`contracts.ts:23`) — clone-wars shells `yq` per-read; memoizing changes
   mid-process freshness. Likely safe (short-lived CLI, never rewritten at runtime) but FROZEN-adjacent.
9. **`pickRandomInstrument` via `pickInstruments(...,1,rng)[0]`** (`instruments.ts:50`) — RNG `rng()` call
   count + candidate ordering is parity-sensitive; verify against `instruments.test.ts`.
10. **`branchMode`/`branchName` dead fields on `PerformArgs`** (`perform.ts:36`, `core/perform.ts`) — dead
    in-flow but `branchMode` is asserted by `perform.test.ts:48`. Document-or-trim, never silent-delete.
11. **`dagUniqueRepos`** (`dag.ts:123`) — faithful 1:1 port, only its own test calls it. Delete vs.
    "ported-but-unused" comment is a human call under the faithful-port constraint.
12. **`pushAndOpenPr()` in gitwork** (`gitwork.ts:69,98`) — comment at `:96` explicitly marks
    `finishBranchAction` as additive, leaving `finishBranch` as a parity anchor. Honor that.
13. **Timeout env read: eager vs lazy** (`solo.ts:171` eager const vs `perform.ts:35`/`score.ts:518` lazy
    getters) — a real behavioral difference under per-test `CONSORT_HOME` mutation. Converting solo to lazy
    is test-friendly but is a behavior change.
14. **`CONSORT_PERFORM_ART_DIR_OVERRIDE`** (only `perform.ts:14` has it; `prelude`/`solo`/`rehearsal` don't)
    — inconsistency to decide (unify or document), not auto-apply.
15. **`parseKv` vs `args.ts kvParse`** (`rehearsal.ts:148`) — different contracts; the finding says **do not
    merge**. Only a doc cross-reference if needed.

---

## Dropped as noise

- **`preflight` arg-builder reuse** — tmux arg-order drift risk (a test surface) outweighs ~6 lines.
- **`eventMatches` "dead in prod"** — documents the canonical FROZEN match rule; `lastMatch` must re-parse
  to get the object. Awareness item only.
- **turn prompt-template dedup** — merging the literal prompt bodies models receive risks silent wording
  drift; the shared trailer is already factored.

---

## Recommended execution

**Phase 1 + Phase 2 are the safe, high-value cleanup** — ~20 behavior-identical changes, ideally 1-3 PRs
(dead-code sweep; then one PR per cross-partition helper). Run the full gate after each and commit the
rebuilt `dist/`. **Phase 3** is opportunistic. **Quarantine items** should each be their own reviewed change
with the named tests as the parity gate — never batched into the mechanical cleanup.
