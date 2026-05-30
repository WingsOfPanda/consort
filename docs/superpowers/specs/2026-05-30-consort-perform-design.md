# consort `perform` — Design (full-parity deploy)

> **What this is.** The approved design for `perform`, consort's port of the clone-wars
> `deploy` command. `perform` is the **consumer** end of the `score → perform` pipeline:
> it takes a deploy-schema design doc (the kind `score` produces and audit-gates), audits
> it, routes single-repo vs multi-repo, dispatches **parts** to plan/implement/self-verify,
> then **Maestro** cross-verifies and runs a bounded fix-loop, and finally finishes each
> target's branch and tears down. This is a **byte-faithful behavioral port**: the wire
> protocol, state layout, and tmux mechanics stay byte-identical; only the language
> (Bash → TS) and the locked cosmetic rebrand change. This doc wins over `MIGRATION.md`
> where they differ.

> **Behavioral spec (source of truth).** `clone-wars/commands/deploy.md` (the 1539-line
> directive), `clone-wars/lib/deploy.sh`, `clone-wars/lib/deploy-dag.sh`,
> `clone-wars/lib/deploy-scope.sh`, `clone-wars/lib/deploy-sibling.sh`,
> `clone-wars/lib/deploy-questions.sh`, and `clone-wars/bin/deploy-*.sh`. Grep by symbol;
> line numbers drift. Preserve *behavior*, not *implementation*.

---

## 1. Summary

`perform` runs a **part-implements / Maestro-verifies** pipeline on a design doc. It is the
**largest** consort command and the **terminal** consumer of the `score → perform` pipeline
(there is nothing downstream of it). It has two paths, both ending in a per-target finish menu
and teardown/archive:

- **Single-repo** (the common case; `score`'s fast-path and single-repo docs): audit + route →
  spawn **one** part in the target cwd → round-aware **plan + implement + self-verify** turn
  (auto-retry-once) → **Maestro** cross-verify → author a tagged fix-bundle → fix-loop
  (`--max-rounds`, default 5) → scope-conformance check → per-repo finish menu
  (merge / push+PR / keep / discard) → teardown + archive + forensics.
- **Multi-repo DAG** (docs with a `**Target Sub-Project(s):**` header + a `## Execution DAG`
  section — exactly what `score` now produces and validates): detect → preflight pane allocation
  → **the DAG executor** (Kahn's topological sort → waves; `unique_repos`; `fan_in_repos` for the
  "feels unsafe" heuristic; `target_cwd` redirection so each unit's part runs in its own sub-repo)
  → per-(wave, repo) dispatch → cross-repo final verify (sibling baseline → diff →
  revert-and-replay) → multi-repo fix-loop → per-repo finish → teardown + archive.

`perform` is mostly **wiring + the DAG executor + the directive** because most of the heavy
infrastructure already exists in consort (audit gate, DAG validator/producer, multi-repo detect,
git foundation, turn machinery, forensics, archive, `coda` teardown, the spawn/send/collect
primitives, `preflight`). The genuinely new code is the **DAG executor**, the **scope-creep
guard**, the **sibling cross-repo verifier**, the **turn-prompt builders**, the
**question-claim verifier**, and `commands/perform.md`.

---

## 2. Scope & non-goals

### In scope (the full command, one spec — phased plan ships single-repo first)

- **Single-repo path** end to end (audit → spawn → round-aware turn → cross-verify → fix-loop →
  scope check → finish → teardown/archive/forensics).
- **Multi-repo DAG path** end to end (detect → preflight → executor → wave dispatch → cross-repo
  verify → fix-loop → finish → teardown/archive). This includes **the DAG executor that was
  explicitly deferred from `score`**: `dagTopological` (waves), `dagUniqueRepos`, `dagFanInRepos`,
  `dag-waves.txt`/`dag-edges.txt` persistence, and `target_cwd` redirection.
- The **fix-loop** (round-aware, `--max-rounds`, default 5; auto-retry-once on `TS=failed`/`timeout`).
- The **question protocol** (`TS=question`): percent-decoded payload, `ROUTE=verify` →
  claim-verify (path/git/env/cmd/test) → reply; `ROUTE=escalate` → AskUserQuestion → reply;
  re-arm the wait on the same round.
- The **scope-conformance guard** (diff vs the doc's Components table → interactive
  amend / send-back / force-keep).
- **Sibling cross-repo invariants** (baseline → HEAD diff → rogue-commit detection →
  revert-and-replay recovery).
- The **finish stage** (per target: interactive merge / push+PR / keep / discard menu, recommended
  = PR-if-remote-else-merge) reusing `gitwork.ts`.

### Out of scope (their own specs / already done)

- `prelude` (= meditate), `rehearsal` (= deep-research), `playback` (= review-forensics) — the
  remaining high-level commands; each needs its own brainstorm → spec.
- The **deploy-audit gate** and the **DAG validator/producer** — already ported into consort for
  `score` (`core/audit.ts`, `core/dag.ts`); `perform` **reuses** them, it does not rebuild them.
- The **git foundation** (`preSnapshot`/`createOrResumeBranch`/`finishBranch`/`finishAutoAction`/
  `shortstat`/`classifyDirty`) — already in `core/gitwork.ts` (built for `solo`); `perform` reuses
  and, where deploy needs more outcome tokens than solo, **extends** it minimally.
- Worktrees, MCP role routing, an open OpenAI-compat provider set — same non-goals as the rest of
  consort. A new provider = a `contracts.yaml` row + a dogfood, not a config knob.

---

## 3. Decisions (settled in brainstorming)

| # | Decision | Resolution |
|---|---|---|
| P1 | **Spec scope** | **One spec** covers the whole command (single-repo + multi-repo DAG). The *plan* is phased; single-repo ships first. (Same recipe as `score`.) |
| P2 | **Plan phasing** | **Four coarser phases** — A: core + executor modules (pure, TDD, no dogfood); B: full single-repo path + dogfood (first shippable); C: multi-repo DAG executor + wave dispatch + dogfood; D: multi-repo verify/fix/finish + dogfood. |
| P3 | **Finish behavior** | **Byte-faithful** — interactive 4-option menu *per target repo* (merge / push+PR / keep / discard), recommended = PR-if-remote-else-merge. This already aligns with consort's `finishing-a-development-branch` convention, so it is a preserve, not a divergence. |
| P4 | **Audit gate + DAG validator** | **Reused** from `score` (`audit.ts`, `dag.ts`). `perform` only adds the DAG **executor** on top of the existing validator/producer. |
| P5 | **Cross-verify owner** | **Maestro (the conductor) cross-verifies**, reading the part's diff + tests + spot-checks and writing `VERDICT: PASS`/`FAIL`. It is **directive work**, not a CLI subcommand (mirrors `deploy`: there is no `bin/deploy-cross-verify.sh`). |
| P6 | **Question handling** | **Port the full claim-verifier** (`performQuestions.ts`) — `score` escalated questions straight to the user; `perform` adds the deploy behavior of auto-verifying path/git/env/cmd/test claims before escalating, for byte-faithfulness. |
| P7 | **Teardown / archive** | **Reuse** `coda` (`teardownBatch`, FINE banner) and `core/archive.ts` (`archiveTopic(topic, "perform")`), exactly as `score` did. |

---

## 4. Command surface

`perform` dispatches like every consort command: `commands/perform.md` mints an args file
(3-step injection fence), then invokes `node dist/consort.cjs perform <verb> --args-file <path>`.
Subcommands mirror the `deploy-*.sh` scripts; cross-verify, fix-bundle authoring, and
scope-amendment are **Maestro (directive) work**, not subcommands. Spawn/send/teardown are
existing consort commands the directive calls directly (`spawn`/`send` with `--cwd`; `coda` for
teardown), exactly as `score` did — no per-command duplicates.

| Subcommand | Behavior | rc |
|---|---|---|
| `perform init` | args-file fence; resolve design-doc path (default to the newest `_score/design-doc/*-design.md` with confirm); parse `--no-branch`/`--branch`/`--topic`/`--targets`; **audit** (reuse `auditDoc`) → on FAIL emit `ISSUE=` lines + abort; **route** (single vs multi via the `**Target Sub-Project(s):**` header + `checkDagSection`); scaffold `_perform/` + `.draft`-equivalents; write `topic.txt`/`provider.txt`/`target_cwd.txt`/`multi-repo.txt`; print `ART=`/`TOPIC=`/`ROUTING=` | `0` · `1` audit/usage FAIL · `2` in-flight |
| `perform branch` | after `pre-snapshot`, create/resume `feat/perform-<topic>` from a clean HEAD (reuse `gitwork.createOrResumeBranch`); record `branch-base.sha` | `0` · `1` |
| `perform pre-snapshot` | commit any pre-existing dirty tree so the perform branch forks clean (reuse `gitwork.preSnapshot`) | `0` |
| `perform turn-send <topic> <round>` | round 1 → build the **plan+implement+self-verify** prompt; round ≥2 → read `fix-prompt-<round>.md` and wrap it; refuse if the part is not idle (`part not idle (state=...)`); `inboxWrite` (appends `END_OF_INSTRUCTION` + done-line) | `0` · `1` not-idle |
| `perform turn-wait <topic> <round>` | tail the part outbox from the pre-send offset; drive the `TS=` machine (`ok`/`failed`/`timeout`/`question`); write `turn-<part>-<round>.txt` + `.done` | `0` |
| `perform dag-parse <doc>` | the **executor**: parse `## Execution DAG` → nodes → edges; `dagTopological` → `dag-waves.txt` (`<wave>\t<step>\t<repo>\t<desc>`) + `dag-edges.txt` (`<from>\t<to>`); rc=1 + clear error on **cycle** | `0` · `1` cycle/malformed |
| `perform wave-wait <topic> <wave>` | wait for every part in a wave to reach a terminal turn event before the next wave dispatches | `0` |
| `perform sibling-baseline <topic>` | enumerate undeclared sibling repos + capture each one's HEAD + branch into `sibling-baseline.txt` | `0` |
| `perform sibling-verify <topic>` | re-read each sibling HEAD vs baseline; write `sibling-rogue.txt` (rogue commits on undeclared mains) | `0` |
| `perform scope-check <topic>` | extract Components-table paths (`extractComponentsPaths`) + match the diff (`matchDiffAgainstComponents`) → `scope-out-of-scope.txt` | `0` |
| `perform summary <topic>` | per-target summary block (branch, base SHA, HEAD, diff-stat, commit list); runs `post-sweep` first | `0` |
| `perform finish <topic>` | per target: read `feat/perform-<topic>` + start branch, apply the chosen action (reuse/extend `gitwork.finishBranch`), append `finish-results.tsv` | `0` |
| `perform archive <topic>` | reuse `archiveTopic(topic, "perform")` (stamp `status=archived`, move) | `0` |

Teardown is the existing **`coda`** command (FINE banner, `--pairs` batch), invoked by the directive
— there is no `perform teardown` verb (same as `score`).

---

## 5. The pipeline (rebranded stages)

`perform.md` mirrors `deploy.md`'s stage sequence. Single-repo uses Stages 0 / 1.1 / 1 / 2 / 3 / 4;
multi-repo uses Stages 0 / 3a / 3b / 3c / 3d / 4 (the single-repo 1.1/1/2/3 stages are skipped).
Step 0's routing branch picks the task set.

### Stage 0 — audit + routing detect
Mint args file; parse + strip `--max-rounds` (never reaches `init`); default the doc path to the
newest `_score` design doc (confirm via AskUserQuestion); `perform init` audits (reuse `auditDoc` —
abort on FAIL with `ISSUE=` lines) and routes. On `INIT_RC != 0` from a malformed `## Execution
DAG` in a hand-authored doc, run the **DAG auto-extract** rescue (reuse `dag.ts` parse; present the
extracted DAG for confirmation, then `Edit` it into the doc). `pre-snapshot` then `branch` (unless
`--no-branch`).

### Stage 1.1 — spawn one part (single-repo)
`spawn <instrument> <provider> <topic> --cwd <target_cwd>` (the existing primitive). On spawn
failure: archive `_perform/` and exit.

### Stage 1 — run the part turn (round-aware, auto-retry-once)
`ROUND=1`, `RETRY_COUNT=0`, `MAX_ROUNDS=${override:-5}`. Dispatch `perform turn-send` then background
`perform turn-wait`. Default turn timeout **4 hours** (`CONSORT_PERFORM_TURN_TIMEOUT=14400`) — a part
plans+implements+self-verifies in one turn. Branch on `TS=`:
- `ok` → Stage 2.
- `failed`/`timeout` → auto-retry once (clear `turn-*`/prompt files, `RETRY_COUNT=1`, re-dispatch);
  on a second failure AskUserQuestion (Hand-off → write `RESUME.md`, preserve pane / Abort →
  teardown+archive / Try-again). On **part-not-idle**: AskUserQuestion (Wait 60s / Force-reset
  `status.json` via atomic Bash write / Abort).
- `question` → read percent-decoded payload; `ROUTE=verify` → `performQuestions` claim-verify
  (rc 0/1 → reply via `send`; rc 2 → escalate); `ROUTE=escalate` → AskUserQuestion → reply; re-arm
  `turn-wait` on the **same round**; tolerate one `ack` sha mismatch (re-push once, then continue).

### Stage 2 — cross-verify (Maestro, per round)
Maestro reads (capped): `verify-report-<round>.md`, `test-output-<round>.log` tail, `git log`/`git
diff --stat` over `branch-base..HEAD`, and ≤3 highest-stakes diff-hunk spot-checks (paths relative
to `target_cwd`). Writes `cross-verify-<round>.md` with top-line `VERDICT: PASS|FAIL`; FAIL lists
issues tagged `[bug]`/`[regression]`/`[spec-gap]` with evidence + fix direction. PASS → Stage 4.
FAIL + `ROUND > MAX_ROUNDS` → AskUserQuestion (Continue +1 / Hand-off / Abort). FAIL + within budget
→ Stage 3.

### Stage 3 — author fix bundle
Write `fix-prompt-<round+1>.md` — tagged bullets only, **no preamble / no skill mention / no
`END_OF_INSTRUCTION`** (turn-send wraps it). `ROUND++`, `RETRY_COUNT=0`, loop to Stage 1.

### Stage 3a — preflight pane allocation (multi-repo)
Resolve targets + the hub cwd; allocate one pane per target via `preflight`.

### Stage 3b — DAG wave dispatch (multi-repo)
`perform dag-parse` → `dag-waves.txt`/`dag-edges.txt`. For each `(wave, step, repo, desc)` row,
`TaskCreate` one task and dispatch a part **in `target_cwd/<repo>`**. A wave is a barrier: all
parts in wave *N* reach a terminal event (`perform wave-wait`) before wave *N+1* dispatches.

### Stage 3c — final cross-repo verification (multi-repo)
Maestro runs cross-repo invariant checks; bugs append to `multi-verify-bugs.txt` (the authoritative
list for 3d). `sibling-verify` surfaces rogue commits on undeclared mains.

### Stage 3d — multi-repo fix-loop
Same shape as Stage 3 but keyed off `multi-verify-bugs.txt`; re-dispatches the affected repos.

### Stage 4 — finish + teardown + archive (both paths)
`sibling-verify` rogue-commit intercept (AskUserQuestion: revert-and-replay / accept / send-back).
`scope-check` drift intercept (AskUserQuestion: amend design / send-back / force-keep).
`perform summary` (per-target block). **Finish menu per target** (merge / push+PR / keep / discard;
recommended = PR-if-remote-else-merge) → `perform finish` → `finish-results.tsv`. Forensics capture
+ idempotent `## Maestro reflection`. Teardown via `coda` (`--pairs`) + `perform archive`. Final
summary keyed off `ROUTING`.

---

## 6. State layout

```
<root>/state/<repo-hash>/<topic>/
    <instrument>-<model>/              # one per part (single-repo: one; multi: one per repo)
        identity.md  inbox.md  outbox.jsonl  status.json  pane.json
    _perform/                          # art dir (was _deploy/)
        topic.txt  provider.txt  target_cwd.txt  multi-repo.txt
        parts.txt                      # multi-repo roster (slug\tcwd[\tprovider]) — rebranded from deploy's troopers.txt
        branch-base.sha  <instr>-branch-base.sha   deploy-branches.tsv  baselines/<slug>.tsv
        dag-waves.txt  dag-edges.txt   multi-repo-targets.txt          # executor state (FROZEN names)
        turn-<part>-<round>.txt  turn-<part>-<round>.done  question-<part>-<round>.txt
        verify-report-<round>.md  test-output-<round>.log
        cross-verify-<round>.md  fix-prompt-<round>.md  bugs.txt  multi-verify-bugs.txt
        components-paths.txt  diff-paths.txt  scope-out-of-scope.txt  scope-amended.txt  scope-overrides.txt
        sibling-baseline.txt  sibling-rogue.txt  sibling-rogue-accepted.txt  sibling-rescue.txt
        finish-results.tsv  archive_path.txt  RESUME.md
```

Atomic writes (tmp-in-same-dir + rename) for `status.json`/`pane.json`/`inbox.md`/identity and every
`.txt`/`.tsv` the directive reads back. All paths absolute; `<repo-hash> = sha256(realpath(cwd))`
with no trailing newline. Forensics land under `globalRoot()/forensics/` (outside the state tree, so
they survive teardown), exactly as `score`.

---

## 7. Reuse map (what exists vs what's new)

**Reuse as-is:**
- `core/audit.ts` — `auditDoc` (the deploy-audit gate) + `extractTarget` + `SLUG_REGEX`.
- `core/dag.ts` — `parseDagLine`, `checkDagSection`, `dagMalformedLines`, `emitSoftDag`
  (validator + producer). The **executor is added here** (§8).
- `core/multirepo.ts` — `detectMultiRepo`, `validateTargets`, `RepoHit`.
- `core/gitwork.ts` — `preSnapshot`, `createOrResumeBranch`, `finishBranch`, `finishAutoAction`,
  `shortstat`, `classifyDirty` (built for `solo`). **Extended** if deploy needs outcome tokens solo
  lacks (`merge-conflict-left`, `pr-pushed-no-gh`, `pr-failed-kept`, `discarded`, `no-branch`).
- `core/turn.ts` / `core/scoreTurn.ts` — the turn-state and offset-parsing patterns to model
  `performTurn`'s `TS=` machine on.
- `core/forensics.ts` — `captureArtDir` (best-effort, never throws) + reflection.
- `core/archive.ts` — `archiveTopic(topic, "perform")`, `finalizeArchived`.
- `commands/coda.ts` — teardown (FINE banner, `--pairs`).
- `commands/spawn.ts` / `send.ts` / `collect.ts` — the primitives (spawn with `--cwd`).
- `commands/preflight.ts` — pane-layout allocation for multi-repo.

**New core modules:**
- `core/dag.ts` (extend) — `dagTopological(edges, nodes)` (Kahn → `<wave>\t<node>`, rc on cycle),
  `dagUniqueRepos(wavesText)`, `dagFanInRepos(edgesText, wavesText)` (the "feels unsafe" heuristic).
- `core/performScope.ts` — `extractComponentsPaths(docText)`, `matchDiffAgainstComponents(diffPaths,
  compPaths)` (out-of-scope path detection by exact path or path-prefix).
- `core/performSibling.ts` — `enumerateSiblings`, `captureSiblingBaseline`,
  `diffSiblingAgainstBaseline`, `revertAndReplay` (pure arg-array builders + parse helpers; tmux/git
  shelled via `execa`, never spawned in unit tests).
- `core/performTurn.ts` — the `TS=` state machine (`ok`/`failed`/`timeout`/`question`) +
  `composeRound1Prompt` (plan+implement+self-verify) + `composeFixPrompt(round)` (wrap the
  Maestro-authored fix bundle). Prompt composers **omit** `END_OF_INSTRUCTION`/done-line
  (`inboxWrite` appends them).
- `core/performQuestions.ts` — `verifyClaim(kind, value)` (path/git/env/cmd/test → rc 0/1/2) +
  `formatReply(kind, value, rc, evidence)` + the percent-decode (`%0A`→nl, `%09`→tab, `%22`→`"`,
  `%5C`→`\`, `%2C`→`,`, `%25`→`%` decoded **last**).
- `core/perform.ts` — paths (`performArtDir`, `performTopicDir`), arg parsing, target resolution
  (`extractTarget`/`resolveTarget`/`resolveHub`/`iterTargets`), provider detection
  (codex default; claude on plugin repos).
- `commands/perform.ts` — the verb dispatcher (§4).
- `commands/perform.md` — the directive (§5).

---

## 8. The execution-DAG executor (the headline new capability)

`score` builds and **validates** the DAG (`parseDagLine`/`checkDagSection`) but discards it.
`perform` **executes** it. Ported byte-faithful from `lib/deploy-dag.sh`:

- **Parse → edges.** Each `## Execution DAG` line `N. <repo> [(/abspath)] — <desc> (depends on a, b)`
  becomes a node; every `(depends on …)` entry becomes an edge `<dep-step> → <this-step>`.
- **`dagTopological(edges, nodes)` — Kahn's algorithm.** Compute indegree; repeatedly emit the set
  of zero-indegree nodes as one **wave** (sorted numerically within a wave for determinism),
  decrement children, advance. Emits `<wave>\t<node>`. **rc=1 on cycle** (no zero-indegree node left
  while nodes remain) — `score`'s validator does *not* detect cycles, so this is genuinely new and
  must surface a clear error. Persist to `dag-waves.txt` (`<wave>\t<step>\t<repo>\t<desc>`) +
  `dag-edges.txt` (`<from>\t<to>`).
- **`dagUniqueRepos(wavesText)`** — unique repo slugs, sorted (drives preflight pane count).
- **`dagFanInRepos(edgesText, wavesText)`** — repos whose step has ≥2 incoming edges; drives the
  "feels unsafe" heuristic (a fan-in repo is more exposed to interactions between earlier waves, so
  the directive treats it more cautiously in verification).
- **`target_cwd` redirection.** Each wave-N unit's part is spawned with `--cwd target_cwd/<repo>`,
  so the model TUI runs inside its own sub-repo. The hub cwd is resolved from the doc's target
  header (`resolveHub`).

Determinism: numeric sort within a wave + alphabetical `unique_repos` makes wave composition and
pane order reproducible, which the dogfood asserts. Em-dash `—` (U+2014) is load-bearing in DAG
lines (it is in `score` too).

---

## 9. Turn machinery (single part, round-aware, fix-loop)

One part per repo, one turn per round. `performTurn`'s `TS=` machine maps outbox events to a turn
status, byte-faithful with `deploy-turn-wait`:

| Last terminal event | `TS=` | Directive action |
|---|---|---|
| `done` | `ok` | cross-verify this round |
| `error` | `failed` | auto-retry-once, then Hand-off / Abort / Try-again |
| (timeout, no terminal event) | `timeout` | same auto-retry path; part-not-idle handling on re-send |
| `question` | `question` | claim-verify or escalate; re-arm wait on the **same round** |

Event matching is `JSON.parse(line)` + `obj.event === name` (skip non-JSON lines), never an anchored
regex. Offsets are captured **before** each send (the question round-trip is one logical turn — re-arm
reads from the latest offset, like `score`'s `parseLatestOffset`). The fix bundle is authored by
Maestro between rounds; `turn-send` wraps round-1 vs fix prompts. `--max-rounds` default 5; on
exhaustion the directive offers Continue+1 / Hand-off (write `RESUME.md`) / Abort.

---

## 10. Naming & rebrand compliance

| clone-wars | consort |
|---|---|
| command `deploy` | `perform` |
| `commands/deploy.md`, `lib/deploy*.sh`, `bin/deploy-*.sh` | `commands/perform.md`, `src/core/perform*.ts`, `perform <verb>` subcommands |
| art dir `_deploy/` | `_perform/` |
| branch `feat/deploy-<topic>` | `feat/perform-<topic>` |
| conductor "Master Yoda" / `From: master-yoda` | "Maestro" / `From: maestro` |
| worker "trooper" / commander names (`cody`, `rex`) | "part" / instrument names |
| `cw_deploy_*` fn prefix / `CW_DEPLOY_*` env | dropped / `CONSORT_PERFORM_*` |
| teardown banner "MISSION ACCOMPLISHED" | "FINE" |
| PR title `deploy: <branch>` | `perform: <branch>` |
| multi-repo roster `troopers.txt` | `parts.txt` — **not frozen** (it is an internal conductor roster the model binaries never read; the stale-token gate bans the `trooper` substring in shipped src, so the literal `troopers.txt` cannot appear in code — the gate wins) |

**Frozen — never rename** (drop-in compatibility): event names `ready/ack/progress/done/error/
question`; sentinel `END_OF_INSTRUCTION`; JSON fields `ts/summary/artifacts/note/message/fatal/
task_summary/model/topic`; state filenames `target_cwd.txt`, `dag-waves.txt`,
`dag-edges.txt`, `status.json`, `pane.json`, the `baselines/` layout; status fields
`state/archived/archived_ts`; `CLAUDE_CODE_SESSION_ID`; `contracts.yaml` keys. The
`tests/stale-tokens.test.ts` gate (bans `clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/
`@cw_`, and case-insensitive `trooper`/`commander`) must stay green across `src`/`config`/`commands`/
`hooks`/`.claude-plugin` — fix the offending file, never weaken the gate. (Watch JSDoc comments:
`cw_deploy_*` references must become `perform_*`/prose.)

---

## 11. Testing strategy

- **Pure modules, byte-faithful, TDD.** `dagTopological`/`dagUniqueRepos`/`dagFanInRepos` (waves,
  cycle rc=1, fan-in detection, determinism), `extractComponentsPaths`/`matchDiffAgainstComponents`
  (path + prefix matching, out-of-scope detection), `performSibling` parse/arg-builders,
  `performTurn` (`TS=` mapping + prompt composition with no sentinel), `performQuestions`
  (percent-decode incl. `%25`-last; claim-verify rc 0/1/2; reply format), `perform.ts` target
  resolution + provider detection.
- **tmux/git as pure arg-array builders.** Never spawn real panes or run real git in unit tests
  (live behavior = the dogfood). `gitwork` extensions tested via injected `Runner`.
- **`commands/perform.ts`** via injected deps (like `ScoreInitDeps`): `CONSORT_HOME` set to a fresh
  temp dir per test (`tests/helpers/tmpHome.ts`); assert scaffold + KV stdout + rc codes; audit-FAIL
  emits `ISSUE=`/`SECTION=`.
- **Stale-token gate** stays green; **`npm run typecheck`** is authoritative over stale LSP
  diagnostics.
- **Live dogfoods** (the load-bearing gate, one per phase B/C/D):
  - **B (single-repo):** a small real change in a throwaway git repo (or `--no-branch`), bounded with
    a short `CONSORT_PERFORM_TURN_TIMEOUT`, run inside tmux with `CLAUDE_PLUGIN_ROOT=$PWD`; one part
    implements → Maestro cross-verify → finish menu (keep, to avoid PRs) → teardown.
  - **C (multi-repo executor):** a 2-repo, 2-wave DAG doc → assert wave composition (`dag-waves.txt`),
    pane allocation, per-repo dispatch order, `target_cwd` redirection.
  - **D (multi-repo complete):** the same doc end-to-end → cross-repo verify, sibling baseline/verify,
    a fix round, per-repo finish, teardown/archive. Append each result to `docs/superpowers/DOGFOOD.md`.

---

## 12. Acceptance criteria

1. **Single-repo (Phase B).** Given a `score`-produced single-repo deploy-schema doc, `perform`
   audits (PASS), branches `feat/perform-<topic>`, spawns one part in the target cwd, the part
   plans/implements/self-verifies, Maestro cross-verify reaches `VERDICT: PASS` (within fix budget),
   the finish menu applies the chosen action, and teardown/archive leave a clean tree. Commits land on
   the perform branch.
2. **Multi-repo executor (Phase C).** Given a doc with `**Target Sub-Project(s):**` + a `## Execution
   DAG`, `perform dag-parse` produces the correct `dag-waves.txt`/`dag-edges.txt` (deterministic),
   rejects a cyclic DAG with rc=1 + a clear error, allocates one pane per unique repo, and dispatches
   wave N+1 only after every wave-N part hits a terminal event.
3. **Multi-repo complete (Phase D).** Cross-repo final verify writes `multi-verify-bugs.txt`,
   sibling-verify surfaces rogue commits with the three recovery paths, the multi-repo fix-loop
   re-dispatches affected repos, and each target finishes independently.
4. **Question protocol.** A part `question` with `ROUTE=verify` and a verifiable claim is answered
   without user interaction; an unverifiable/`escalate` one prompts the user; the wait re-arms on the
   same round.
5. **Gates.** `npm run typecheck` (0), `npm run test` (all green incl. new tests), `npm run lint` (0),
   stale-token gate green; `dist/consort.cjs` rebuilt + committed.

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **4-hour turn timeout** makes dogfoods slow/flaky | Dogfood with a *small* change + short `CONSORT_PERFORM_TURN_TIMEOUT`; the timeout is byte-faithful for real use but overridable for tests. |
| **Real git side effects** (branch creation, auto-PR) pollute consort's own repo | Dogfood in a throwaway repo or with `--no-branch`; the finish dogfood picks **keep** (never push/PR against consort); never auto-open a PR during tests. |
| **`target_cwd` redirection** spawns parts in *other* repos | Multi-repo dogfood uses throwaway sibling dirs under a temp hub; unit tests cover resolution as pure functions only. |
| **Cycle in a hand-authored DAG** | `dagTopological` returns rc=1 + a precise "cycle detected (k/n processed)" error; the directive surfaces it and offers the auto-extract/re-edit path. |
| **`gitwork.ts` lacks deploy's richer outcome tokens** | Extend `finishBranch` minimally (add `merge-conflict-left`/`pr-pushed-no-gh`/`pr-failed-kept`/`discarded`/`no-branch`) without changing `solo`'s existing call sites; cover with `Runner`-injected tests. |
| **Scope/sibling interactive Edits** to `design.md` | Keep amendments idempotent (record to `scope-amended.txt`); the directive presents drafts for user review before any `Edit`. |
| **Stale phase guard** in `consort/CLAUDE.md` (still says FOUNDATION, pre-`solo`/`score`) | Out of scope for this spec, but refresh it when `perform` lands so the guard reflects shipped commands. |

---

## 14. Implementation phasing (for writing-plans — four plans)

Each phase = its own plan under `docs/superpowers/plans/`, grounded byte-faithfully against
clone-wars at plan-authoring time (parallel-mapper workflows for the larger phases, as `score` did).

- **Phase A — core + executor (pure, TDD, no dogfood).** `dag.ts` executor
  (`dagTopological`/`dagUniqueRepos`/`dagFanInRepos`); `performScope.ts`; `performSibling.ts`
  (arg-builders + parse); `performTurn.ts` (`TS=` machine + prompt composers); `performQuestions.ts`
  (percent-decode + claim-verify + reply); `core/perform.ts` (paths/parse/target resolution/provider
  detection). All unit-tested.
- **Phase B — single-repo path COMPLETE + dogfood (first shippable).** `commands/perform.ts` verbs
  for the single-repo flow (`init`/`branch`/`pre-snapshot`/`turn-send`/`turn-wait`/`scope-check`/
  `summary`/`finish`/`archive`; teardown via `coda`); `gitwork` outcome-token extension;
  `commands/perform.md` Stages 0/1.1/1/2/3/4 (single-repo). Live single-repo dogfood. Rebuild `dist`.
- **Phase C — multi-repo DAG executor + wave dispatch + dogfood.** multi-repo `init`/target
  resolution; `perform dag-parse` (executor wiring → `dag-waves.txt`/`dag-edges.txt`); `perform
  wave-wait`; preflight pane allocation; `perform.md` Stages 3a/3b + the fan-in heuristic. Live
  2-repo / 2-wave dogfood (assert wave composition + dispatch order).
- **Phase D — multi-repo verify/fix/finish COMPLETE + dogfood.** `sibling-baseline`/`sibling-verify`
  (+ revert-and-replay); cross-repo final verify (`multi-verify-bugs.txt`); multi-repo fix-loop
  (Stages 3c/3d); per-repo finish + final summary; multi-repo teardown/archive/forensics. `perform`
  COMPLETE. Live multi-repo end-to-end dogfood. Refresh the `CLAUDE.md` phase guard.
