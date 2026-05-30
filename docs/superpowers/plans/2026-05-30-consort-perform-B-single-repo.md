# consort `perform` — Phase B: single-repo command path (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development for the
> testable tasks (B1, B2a, B2b); the directive (B3), `dist` rebuild (B4), and live dogfood (B5) are
> conductor-run. Steps use `- [ ]`.

**Goal:** Stand up the **single-repo** `perform` command end-to-end — the `commands/perform.ts` verb
dispatcher (init / pre-snapshot / branch / turn-send / turn-wait / scope-check / summary / finish /
forensics / archive), the `commands/perform.md` directive (Stages 0/1.1/1/2/3/4), the small
`gitwork`/`performQuestions`/`archive` extensions, dispatch registration, a rebuilt committed
`dist`, and a **live single-repo dogfood** — wiring the Phase-A core modules (no new core logic).

**Architecture:** Verbs are thin orchestrators over the Phase-A pure modules, each split into a live
`*Run` and a `*With(deps)` for unit-testing (the `score.ts` injected-deps + `tmpHome` pattern).
tmux/git shell via `execa`/`runnerAt`; unit tests inject fakes — **no real pane/git in tests**. The
live tmux/git gate is the dogfood.

**Tech Stack:** TypeScript (ES2022/NodeNext/strict), vitest, esbuild → committed `dist/consort.cjs`.

---

## Reconciled decisions (these OVERRIDE the grounding maps where they differ — read first)

1. **State files written by `init`** (byte order/newlines matter): `design.md` (copy), `topic.txt`
   (**no** trailing `\n`), `target_cwd.txt` (`+\n`), `provider.txt` (`+\n`), `multi-repo.txt`
   (`"single"`/`"multi"` `+\n`). Use `provider.txt` + `multi-repo.txt` (the `score`/spec names), **not**
   `auto_provider.txt`/`routing.txt`.
2. **Audit folded into `init`**: `auditDoc(text)`; on `FAIL` emit `ISSUE=<code>` lines to stderr +
   `return 1` **before** any scaffold (a bad doc leaves no `_perform/`). In-flight (art dir exists) →
   `return 2`. KV stdout on success: `ART=`/`TOPIC=`/`ROUTING=`/`PROVIDER=`/`TARGET_CWD=`.
3. **Part identity = `cody` + the provider as model.** model = `provider.txt` contents
   (`codex` **or** `claude` — a plugin repo resolves to `claude`). A `partModel(art)` helper reads it
   (default `codex` if absent). Turn verbs key `outboxPath`/`statusPath`/`partDir` on
   `('cody', partModel, topic)` — **do not hardcode `codex`.**
4. **Question wire event uses the frozen `message` field** (not deploy's `text`), plus a perform
   `claim:{kind,value}` discriminator:
   `{"event":"question","message":"<why>"[,"claim":{"kind":"<path|git|env|cmd|test>","value":"<v>"}],"ts":"..."}`.
   `extractQuestionPayload(ev, askedAt)` reads `ev.message`/`ev.claim` → the KV payload file
   (`TEXT=`/`CLAIM_KIND=`/`CLAIM_VALUE=`/`ROUTE=`/`ASKED_AT=`); `parseQuestionPayload` (Phase A) is its
   inverse. `turn-wait` writes this KV payload, **not** `JSON.stringify(ev)`.
5. **Parts emit events by appending JSONL directly to `outbox.jsonl`** — consort has **no `bin/*.sh`**.
   The Phase-A `performTurn` BLOCKERS prompt references `bin/part-ask.sh`/`bin/inbox-ack.sh` (a
   byte-faithful-but-wrong port of deploy). **Phase B fixes it** (Task B1): rewrite BLOCKERS to
   instruct a direct outbox append of the `question` event (message + optional claim) and the `ack`
   event, and update the `performTurn` test (it currently asserts `part-ask.sh`).
6. **`gitwork.finishBranchAction`** is a **new additive export** (8 tokens: merged /
   merge-conflict-left / pr-opened / pr-pushed-no-gh / pr-failed-kept / kept / discarded / no-branch).
   Solo's existing `finishBranch` (auto) is **untouched**. PR title/body default to `perform:` /
   `Automated perform branch …` (the finish verb does **not** pass a `deploy:` title).
7. **`scope-check`** writes `scope-out-of-scope.txt` (+ `diff-paths.txt` + `components-paths.txt`),
   prints `OOS_COUNT=`/`OOS_PATH=`, returns **rc 0** whether clean or drift (rc 1 only if inputs
   missing). The amend/send-back/force-keep menu is the **directive's** job.
8. **Multi-repo is deferred (Phase C).** `init` records `multi-repo.txt=multi` + `log.warn` when a doc
   self-declares multi (plural `**Target Sub-Project(s):**` header + `## Execution DAG`) or `--targets`
   is given, but does **not** parse the DAG or write `parts.txt`. Single-repo synthesizes one
   `{slug:'main', cwd}` row via `iterTargets`. The directive stops on `ROUTING=multi`.
9. **Teardown is the existing `coda` command** (directive-invoked); there is **no** `perform teardown`
   verb. `archive` reuses `archiveTopic(topic,'perform')` (requires widening the suite union).
10. **Turn timeout** = `Number(process.env.CONSORT_PERFORM_TURN_TIMEOUT_S) || 14400`, then
    `scaledTimeout(base, multiplier(model))`. **Never** `consultTimeout('turn')` (it throws on unknown
    kinds). `turn-wait` returns **rc 0 always**; the `TS=` field carries the outcome.

**Stale-token gate** (`tests/stale-tokens.test.ts`) scans `src` **and** `commands/perform.md`,
including comments: zero `cw_`/`clone-wars`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_` and zero
case-insensitive `trooper`/`commander`. `cody` is the frozen part handle (allowed). Cite the prior
plugin as `deploy-init.sh:NN`/`deploy_<fn>` (drop `cw_`); say "the prior bash plugin".

---

## File Structure

| File | Change | Task |
|---|---|---|
| `src/core/gitwork.ts` | +`finishBranchAction` (+`pushAndPr` helper) | B1 |
| `src/core/performQuestions.ts` | +`extractQuestionPayload` | B1 |
| `src/core/performTurn.ts` | rewrite `BLOCKERS` (direct-outbox-append, no bin scripts) | B1 |
| `src/core/archive.ts` | widen suite union `… | "perform"` | B1 |
| `tests/perform-gitwork.test.ts` (new) | `finishBranchAction` per-token tests | B1 |
| `tests/perform-questions.test.ts` | +`extractQuestionPayload` cases | B1 |
| `tests/perform-turn.test.ts` | update BLOCKERS assertions | B1 |
| `src/commands/perform.ts` (new) | dispatcher + init + turn-send + turn-wait + `detectRouting`/`partModel` | B2a |
| `src/consort.ts` | register `perform` | B2a |
| `tests/perform-init.test.ts` + `tests/perform-turn-cmd.test.ts` (new) | init + turn verb tests | B2a |
| `src/commands/perform.ts` | +pre-snapshot/branch/scope-check/summary/finish/forensics/archive + helpers | B2b |
| `tests/perform-cmd.test.ts` (new) | git/wind-down verb tests | B2b |
| `commands/perform.md` (new) | single-repo directive | B3 |
| `dist/consort.cjs` | rebuild + commit | B4 |
| `docs/superpowers/DOGFOOD.md` | append Phase B result | B5 |

---

### Task B1: core extensions + the Phase-A prompt fix

**Files:** `src/core/gitwork.ts`, `src/core/performQuestions.ts`, `src/core/performTurn.ts`,
`src/core/archive.ts`; tests `tests/perform-gitwork.test.ts` (new), `tests/perform-questions.test.ts`
(extend), `tests/perform-turn.test.ts` (update).

**B1.1 — `gitwork.ts`: append `finishBranchAction` (solo's `finishBranch` UNTOUCHED).**

```ts
export interface FinishActionOpts {
  branch: string; startBranch: string; action: "merge" | "pr" | "keep" | "discard";
  hasGh: boolean; originUrl?: string; title?: string; body?: string;
}
/** Action-driven finisher (port of deploy_finish_branch @ deploy.sh:651). Restores startBranch
 *  (best-effort). New additive export; solo's auto finishBranch is unchanged. */
export function finishBranchAction(r: Runner, o: FinishActionOpts): string {
  if (!o.branch || o.branch === o.startBranch ||
      r.run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${o.branch}`]).code !== 0) return "no-branch";
  switch (o.action) {
    case "merge":
      r.run("git", ["checkout", "-q", o.startBranch]);
      if (r.run("git", ["merge", "--no-edit", "-q", o.branch]).code === 0) { r.run("git", ["branch", "-q", "-D", o.branch]); return "merged"; }
      r.run("git", ["merge", "--abort"]); return "merge-conflict-left";
    case "keep":    r.run("git", ["checkout", "-q", o.startBranch]); return "kept";
    case "discard": r.run("git", ["checkout", "-q", o.startBranch]); r.run("git", ["branch", "-q", "-D", o.branch]); return "discarded";
    case "pr": {
      let outcome: string;
      if (r.run("git", ["push", "-q", "-u", "origin", o.branch]).code === 0) {
        const url = o.originUrl ?? r.run("git", ["remote", "get-url", "origin"]).stdout.trim();
        if (o.hasGh && r.run("gh", ["pr", "create", "--repo", url, "--base", o.startBranch, "--head", o.branch,
          "--title", o.title ?? `perform: ${o.branch}`,
          "--body", o.body ?? `Automated perform branch. Review and merge into ${o.startBranch}.`]).code === 0) outcome = "pr-opened";
        else outcome = "pr-pushed-no-gh";
      } else outcome = "pr-failed-kept";
      r.run("git", ["checkout", "-q", o.startBranch]); return outcome;
    }
    default: return "no-branch";
  }
}
```

Test `tests/perform-gitwork.test.ts` (copy the `fakeRunner({...})` helper from `solo-gitwork.test.ts`):
one case per token — no-branch (via `branch===''`, via `branch===startBranch`, via show-ref code≠0:
assert no checkout/merge issued); merge ok → `merged` + `git branch -q -D` + checkout startBranch
first; merge code 1 → `merge-conflict-left` + `git merge --abort`, **no** `-D`; keep → `kept`; discard
→ `discarded` + `-D`; pr push+gh ok → `pr-opened` (assert `gh pr create … --base startBranch --head
branch --title 'perform: <branch>'`); push ok `hasGh:false` → `pr-pushed-no-gh` (no gh call); push
fail → `pr-failed-kept`. Every non-no-branch case asserts a trailing `['git','checkout','-q',startBranch]`.

**B1.2 — `performQuestions.ts`: append `extractQuestionPayload`** (conductor-side; inverse of
`parseQuestionPayload`). Reads the consort **`message`** field + `claim`.

```ts
import type { OutboxEvent } from "./ipc.js";   // add to the existing imports

/** Conductor-side extractor (port of deploy_question_extract_to_payload, deploy-questions.sh:15):
 *  a question OutboxEvent -> the KV payload file body. consort uses the frozen `message` field for
 *  the reason text (deploy used `text`); `claim:{kind,value}` is the perform discriminator. Only the
 *  newline is percent-encoded at extract time (%0A) — parseQuestionPayload's full table decodes it.
 *  Returns null when there is no usable message (bash `[[ -n "$text" ]] || return 1`). */
export function extractQuestionPayload(ev: OutboxEvent, askedAt: number): string | null {
  const message = typeof ev.message === "string" ? ev.message : "";
  if (message === "") return null;
  const encoded = message.split("\n").join("%0A");           // newline-only encode at extract
  const claim = ev.claim as { kind?: string; value?: string } | undefined;
  const kind = claim && typeof claim.kind === "string" ? claim.kind : "";
  const value = claim && typeof claim.value === "string" ? claim.value : "";
  const route = claim ? "verify" : "escalate";
  return `TEXT=${encoded}\nCLAIM_KIND=${kind}\nCLAIM_VALUE=${value}\nROUTE=${route}\nASKED_AT=${askedAt}\n`;
}
```

Extend `tests/perform-questions.test.ts`: (a) message+claim → `TEXT=…\nCLAIM_KIND=path\nCLAIM_VALUE=/x\nROUTE=verify\nASKED_AT=<now>\n`;
(b) message, no claim → `CLAIM_KIND=`/`CLAIM_VALUE=`/`ROUTE=escalate`; (c) multiline message → `%0A`
encoded, and feeding the result through `parseQuestionPayload` recovers the original (round-trip via
`percentDecode`); (d) empty/absent message → `null`; (e) inject `askedAt` (e.g. `1700000000`).

**B1.3 — `performTurn.ts`: rewrite the `BLOCKERS` constant** to consort's real mechanism (the prompt
is what the part obeys). Replace the `bin/part-ask.sh`/`bin/inbox-ack.sh` lines with direct outbox
appends. New `BLOCKERS`:

```ts
const BLOCKERS =
  "BLOCKERS / QUESTIONS (read carefully):\n" +
  "- If a referenced path, file, checkpoint, git ref, env var, or\n" +
  "  command is NOT where the notes say it is, DO NOT search the\n" +
  "  filesystem yourself, DO NOT invent a workaround. Halt and ask by\n" +
  "  appending ONE question event to your outbox.jsonl, then stop:\n" +
  '    {"event":"question","message":"<why you are asking>",' +
  '"claim":{"kind":"<path|git|env|cmd|test>","value":"<the value to check>"},"ts":"<iso>"}\n' +
  "  Omit the \"claim\" object for a judgment question (no ground-truth to check).\n" +
  "- The Maestro verifies the claim and replies via your inbox.md, then re-engages you.\n" +
  "- After reading any inbox.md reply, acknowledge by appending an ack event:\n" +
  '    {"event":"ack","task_summary":"<what you read>","ts":"<iso>"}\n' +
  "- The 'test' kind runs a diagnostic command under a 30s timeout — it\n" +
  "  is NOT for running your test suite. Running 'bash tests/run.sh' is\n" +
  "  your job. Banned values fail with rc=2.\n";
```

Update `tests/perform-turn.test.ts`: the two `expect(p).toContain("part-ask.sh")` assertions become
`expect(p).not.toContain("part-ask.sh")` + `expect(p).toContain('{"event":"question"')` +
`expect(p).toContain('{"event":"ack"')`. The em-dash + no-fence + no-stale-token assertions stay.

**B1.4 — `archive.ts`: widen the suite union.** Change the `archiveTopic` `suite` parameter type from
`"consult" | "deploy" | "meditate" | "score"` to add `| "perform"`. Body unchanged (`_${suite}` →
`_perform`). No new test needed (covered by B2b's archive test); confirm `npm run typecheck` passes.

- [ ] B1 steps: write/extend the three test files (B1.1, B1.2, B1.3) → run them, confirm FAIL →
  implement B1.1–B1.4 → `npx vitest run tests/perform-gitwork.test.ts tests/perform-questions.test.ts tests/perform-turn.test.ts` PASS →
  `npm run typecheck` 0 → commit `feat(perform): gitwork.finishBranchAction + extractQuestionPayload + outbox-ask prompt fix + archive union`.

---

### Task B2a: `perform.ts` dispatcher + init + turn verbs + registration

**Files:** `src/commands/perform.ts` (new), `src/consort.ts` (register), tests
`tests/perform-init.test.ts` + `tests/perform-turn-cmd.test.ts` (new).

**Dispatcher + imports + helpers** (top of `perform.ts`):

```ts
// src/commands/perform.ts — single-repo command path for /consort:perform.
// Byte-faithful port of the prior bash plugin's deploy verb set; WIRES the Phase-A core modules.
// Rebrand: _deploy/->_perform/, feat/deploy-->feat/perform-, From: master-yoda->From: maestro.
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile, kvParse } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc, archiveTopic } from "../core/archive.js";
import { repoRoot } from "../core/paths.js";
import { auditDoc } from "../core/audit.js";
import {
  parsePerformArgs, deriveTopicFromPath, resolveTarget, detectProvider, iterTargets,
  performArtDir, PerformArgError, PerformResolveError, ProviderError,
} from "../core/perform.js";
import { performState, composeRound1Prompt, composeFixPrompt } from "../core/performTurn.js";
import { extractComponentsPaths, matchDiffAgainstComponents } from "../core/performScope.js";
import { extractQuestionPayload } from "../core/performQuestions.js";
import { outboxOffset, outboxPath, outboxWaitSince, statusPath, type OutboxEvent } from "../core/ipc.js";
import { instrumentTimeoutMultiplier } from "../core/contracts.js";
import { scaledTimeout, parseLatestOffset } from "../core/scoreTurn.js";
import { runnerAt, preSnapshot, createOrResumeBranch, shortstat, finishBranchAction, type Runner } from "../core/gitwork.js";
import { captureArtDir } from "../core/forensics.js";
import { run as sendRun } from "./send.js";

const PART = "cody";
const PERFORM_TURN_TIMEOUT = (): number => Number(process.env.CONSORT_PERFORM_TURN_TIMEOUT_S) || 14400;

/** model for the cody part = the resolved provider (codex|claude). Reads provider.txt; default codex. */
function partModel(art: string): string {
  const p = join(art, "provider.txt");
  return existsSync(p) ? (readFileSync(p, "utf8").trim() || "codex") : "codex";
}
/** Multi-repo iff the PLURAL Target header + an Execution DAG are both present (deploy-init.sh:87). */
function detectRouting(docText: string): "single" | "multi" {
  return /^\*\*Target Sub-Project\(s\):\*\*/m.test(docText) && /^## Execution DAG[ \t]*$/m.test(docText) ? "multi" : "single";
}
function usage(): number {
  log.error("usage: perform <init|pre-snapshot|branch|turn-send|turn-wait|scope-check|summary|finish|forensics|archive> ...");
  return 2;
}

export async function run(args: string[]): Promise<number> {
  const verb = args[0]; const rest = args.slice(1);
  switch (verb) {
    case "init":         return initRun(applyArgsFile(rest));
    case "pre-snapshot": return preSnapshotRun(rest);
    case "branch":       return branchRun(applyArgsFile(rest));
    case "turn-send":    return turnSendRun(rest);
    case "turn-wait":    return turnWaitRun(rest);
    case "scope-check":  return scopeCheckRun(rest);
    case "summary":      return summaryRun(rest);
    case "finish":       return finishRun(rest);
    case "forensics":    return forensicsRun(rest);
    case "archive":      return archiveRun(rest);
    default:             return usage();
  }
}
```

**init** (reconciled — audit fold, provider.txt, multi-repo.txt, in-flight rc2):

```ts
export interface PerformInitDeps { repoRoot(): string; }
const liveInitDeps: PerformInitDeps = { repoRoot };
async function initRun(tokens: string[]): Promise<number> { return initWith(tokens, liveInitDeps); }

export async function initWith(tokens: string[], d: PerformInitDeps): Promise<number> {
  let parsed; try { parsed = parsePerformArgs(tokens); }
  catch (e) { if (e instanceof PerformArgError) { log.error(e.message); return e.code; } throw e; }
  const designPath = parsed.rest.trim();
  if (!designPath || designPath.includes(" ")) { log.error("perform init: exactly one design-doc path is required"); return 2; }
  if (!existsSync(designPath)) { log.error(`perform init: design doc unreadable: ${designPath}`); return 1; }
  const text = readFileSync(designPath, "utf8");
  const topic = parsed.topic || deriveTopicFromPath(designPath);
  if (!topic) { log.error("perform init: could not derive topic; pass --topic <slug>"); return 1; }

  const ad = auditDoc(text);
  if (ad.verdict === "FAIL") { for (const i of ad.issues) process.stderr.write(`ISSUE=${i}\n`); log.error(`perform init: audit FAILED on ${designPath}`); return 1; }

  const art = performArtDir(topic);
  if (existsSync(art)) { log.error(`perform init: topic already in flight: ${art} (run /consort:coda or pick a different --topic)`); return 2; }

  let targetCwd: string;
  try { targetCwd = resolveTarget(designPath, d.repoRoot()); }
  catch (e) { if (e instanceof PerformResolveError) { log.error(e.message); return e.code; } throw e; }

  const routing = parsed.targets.length > 0 ? "multi" : detectRouting(text);
  let provider: string;
  try { provider = detectProvider(targetCwd); }
  catch (e) { if (e instanceof ProviderError) { log.error(e.message); return e.code; } throw e; }

  mkdirSync(art, { recursive: true });
  atomicWrite(join(art, "design.md"), text);
  atomicWrite(join(art, "topic.txt"), topic);                       // NO trailing newline
  atomicWrite(join(art, "target_cwd.txt"), targetCwd + "\n");
  atomicWrite(join(art, "provider.txt"), provider + "\n");
  atomicWrite(join(art, "multi-repo.txt"), (routing === "multi" ? "multi" : "single") + "\n");
  if (routing === "multi") log.warn("perform init: multi-repo routing recorded; multi-repo execution is a later phase (Phase C)");

  log.ok(`perform init: topic=${topic} routing=${routing} provider=${provider}`);
  process.stdout.write(`ART=${art}\nTOPIC=${topic}\nROUTING=${routing}\nPROVIDER=${provider}\nTARGET_CWD=${targetCwd}\n`);
  return 0;
}
```

**turn-send** (model = `partModel(art)`):

```ts
export interface PerformSendDeps { offsetFor(i: string, m: string, t: string): number; send(args: string[]): Promise<number>; }
const liveSendDeps: PerformSendDeps = { offsetFor: (i, m, t) => outboxOffset(outboxPath(i, m, t)), send: sendRun };
async function turnSendRun(rest: string[]): Promise<number> {
  const [topic, roundStr] = rest;
  if (!topic || !roundStr) { log.error("usage: perform turn-send <topic> <round>"); return 2; }
  if (!/^[1-9][0-9]*$/.test(roundStr)) { log.error(`perform turn-send: round must be a positive integer (got: ${roundStr})`); return 1; }
  return turnSendWith(topic, Number(roundStr), liveSendDeps);
}
export async function turnSendWith(topic: string, round: number, d: PerformSendDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform turn-send: ${art} not found — run perform init first`); return 1; }
  const model = partModel(art);
  const stateFile = join(art, `turn-cody-${round}.txt`);
  if (existsSync(stateFile)) { log.error(`perform turn-send: ${stateFile} already exists; rm to retry`); return 1; }
  const outbox = outboxPath(PART, model, topic);
  if (!existsSync(outbox)) { log.error(`perform turn-send: outbox not found at ${outbox} — was cody spawned?`); return 1; }
  const sp = statusPath(PART, model, topic);
  if (existsSync(sp)) { const m = readFileSync(sp, "utf8").match(/"state":"([^"]*)"/); if (m && m[1] && m[1] !== "idle") { log.error(`perform turn-send: part not idle (state=${m[1]}); previous turn still in flight`); return 1; } }
  const promptFile = join(art, `cody_turn_prompt_${round}.md`);
  if (round === 1) atomicWrite(promptFile, composeRound1Prompt({ designPath: join(art, "design.md"), planPath: join(art, "plan.md"), verifyPath: join(art, "verify-report-1.md"), round }));
  else { const bundle = join(art, `fix-prompt-${round}.md`); if (!existsSync(bundle)) { log.error(`perform turn-send: fix-prompt-${round}.md not found at ${bundle}; the directive must write it first`); return 1; } atomicWrite(promptFile, composeFixPrompt(round, readFileSync(bundle, "utf8"), join(art, `verify-report-${round}.md`))); }
  const offset = d.offsetFor(PART, model, topic);             // BEFORE send (cw_send_dispatch order)
  atomicWrite(stateFile, `OFFSET=${offset}\n`);
  const rc = await d.send(["--from", "maestro", PART, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`perform turn-send: send failed (rc=${rc}); ${stateFile} kept (rm to retry)`); return 1; }
  log.info(`[turn-send] cody round=${round} offset=${offset}`); return 0;
}
```

**turn-wait** (model = `partModel(art)`; writes the KV payload via `extractQuestionPayload`; rc 0 always):

```ts
export interface PerformWaitDeps { wait(i: string, m: string, t: string, off: number, ev: string[], to: number): Promise<OutboxEvent | null>; multiplier(model: string): string; now(): number; }
const liveWaitDeps: PerformWaitDeps = { wait: outboxWaitSince, multiplier: instrumentTimeoutMultiplier, now: () => Math.floor(Date.now() / 1000) };
async function turnWaitRun(rest: string[]): Promise<number> {
  const [topic, roundStr] = rest;
  if (!topic || !roundStr) { log.error("usage: perform turn-wait <topic> <round>"); return 2; }
  if (!/^[1-9][0-9]*$/.test(roundStr)) { log.error(`perform turn-wait: round must be a positive integer (got: ${roundStr})`); return 1; }
  return turnWaitWith(topic, Number(roundStr), liveWaitDeps);
}
export async function turnWaitWith(topic: string, round: number, d: PerformWaitDeps): Promise<number> {
  const art = performArtDir(topic);
  const model = partModel(art);
  const stateFile = join(art, `turn-cody-${round}.txt`);
  if (!existsSync(stateFile)) { log.error(`perform turn-wait: ${stateFile} missing — run perform turn-send first`); return 1; }
  const offset = parseLatestOffset(readFileSync(stateFile, "utf8"));
  if (offset === null) { log.error(`perform turn-wait: OFFSET not set in ${stateFile}`); return 1; }
  const timeout = scaledTimeout(PERFORM_TURN_TIMEOUT(), d.multiplier(model));
  log.info(`[turn-wait] cody round=${round} offset=${offset} timeout=${timeout}s`);
  const ev = await d.wait(PART, model, topic, offset, ["done", "error", "question"], timeout);
  const verifyPath = join(art, `verify-report-${round}.md`);
  const verifyText = existsSync(verifyPath) ? readFileSync(verifyPath, "utf8") : null;
  let ts = performState(ev, verifyText);
  if (ts === "question" && ev) {
    const payload = extractQuestionPayload(ev, d.now());
    if (payload !== null) {
      atomicWrite(join(art, `question-cody-${round}.txt`), payload);
      const bumped = outboxOffset(outboxPath(PART, model, topic));
      appendFileSync(stateFile, `OFFSET=${bumped}\nTS=question\n`);
    } else { ts = "failed"; appendFileSync(stateFile, "TS=failed\n"); log.warn("[turn-wait] malformed question (no message); downgraded to failed"); }
  } else appendFileSync(stateFile, `TS=${ts}\n`);
  writeFileSync(join(art, `turn-cody-${round}.done`), "");
  log.ok(`[turn-wait] cody round=${round} TS=${ts}`); return 0;     // ALWAYS rc 0
}
```

**Registration** — `src/consort.ts` `loadHandlers()`: add `import("./commands/perform.js")` to the
`Promise.all` (destructure `perform` last) and `perform: perform.run` to the returned map (the
two-line edit shown in `score`/`solo`).

**Tests (B2a):** `tests/perform-init.test.ts` + `tests/perform-turn-cmd.test.ts` via
`tests/helpers/tmpHome.ts` (set `CONSORT_HOME`) + captured stdout/stderr + injected deps.
- init: happy single-repo (audit-passing fixture doc) → rc 0, assert `_perform/{design.md, topic.txt
  (no `\n`), target_cwd.txt (`\n`), provider.txt, multi-repo.txt=`single\n`}` + KV stdout; audit FAIL
  (doc missing `## Goal`) → rc 1, stderr `ISSUE=no_goal_section`, **no** art dir; in-flight → rc 2;
  `--max-rounds` in tokens → rc 2; zero/two positionals → rc 2; unreadable path → rc 1; `--topic`
  override; `resolveTarget` stub for single-repo happy path; multi doc (plural header + DAG) →
  `multi-repo.txt=multi\n` + `ROUTING=multi` + `log.warn`, no DAG files.
- turn-send: round 1 happy (stub `send`→0, `offsetFor`→17): `turn-cody-1.txt==='OFFSET=17\n'` written
  **before** send, prompt === `composeRound1Prompt(...)`, send called `['--from','maestro','cody',
  topic,'@<prompt>']`, rc 0; round 2 missing `fix-prompt-2.md` → rc 1 (send not called); part-not-idle
  (`status.json` `state:"working"`) → rc 1; existing stateFile → rc 1; send rc 2 → stateFile retained
  + rc 1; seed `provider.txt='codex'` so `partModel`→codex (also a `provider.txt='claude'` case asserts
  the part dir keys on `cody-claude`).
- turn-wait: done + non-empty verify → `TS=ok` + `.done`; done + empty verify → `TS=failed`; null →
  `TS=timeout`; `{event:'question',message:'need X',claim:{kind:'path',value:'/x'}}` (inject
  `now()=1700000000`) → `question-cody-1.txt==='TEXT=need X\nCLAIM_KIND=path\nCLAIM_VALUE=/x\nROUTE=
  verify\nASKED_AT=1700000000\n'`, stateFile appends `OFFSET=<bumped>\nTS=question\n`,
  `parseLatestOffset` === bumped; question with no message → downgraded `TS=failed`, no payload file;
  **rc 0 in all wait cases**.

- [ ] B2a: write tests → FAIL → implement dispatcher+init+turn-send+turn-wait+helpers+registration →
  tests PASS + `npm run typecheck` 0 → commit `feat(perform): init + turn-send/turn-wait verbs + dispatch registration`.

---

### Task B2b: `perform.ts` git + wind-down verbs

**Files:** `src/commands/perform.ts` (append), test `tests/perform-cmd.test.ts` (new).

Append the helpers + verbs. **pre-snapshot** and **branch** (reuse `gitwork.preSnapshot`/
`createOrResumeBranch`; baselines key=value TSV; `feat/perform-<topic>`):

```ts
// ---- key=value baseline reader (port of cw_kv_file_field) ----
export function kvFileField(file: string, key: string): string {
  if (!existsSync(file)) return "";
  for (const line of readFileSync(file, "utf8").split("\n")) { const eq = line.indexOf("="); if (eq > 0 && line.slice(0, eq) === key) return line.slice(eq + 1); }
  return "";
}
function branchMapField(map: string, slug: string): string {
  if (!existsSync(map)) return "";
  for (const line of readFileSync(map, "utf8").split("\n")) { const [s, b] = line.split("\t"); if (s === slug) return b ?? ""; }
  return "";
}
function isDir(p: string): boolean { try { return statSync(p).isDirectory(); } catch { return false; } }

async function preSnapshotRun(rest: string[]): Promise<number> {
  if (rest.length !== 1) { log.error("usage: perform pre-snapshot <topic>"); return 2; }
  return preSnapshotWith(rest[0], {}, runnerAt);
}
export async function preSnapshotWith(topic: string, opts: { home?: string; cwd?: string }, runnerFor: (cwd: string) => Runner): Promise<number> {
  const art = performArtDir(topic, opts);
  if (!existsSync(art)) { log.error(`perform pre-snapshot: art-dir missing: ${art} (run perform init first)`); return 1; }
  mkdirSync(join(art, "baselines"), { recursive: true });
  let clean = 0, committed = 0, blocked = 0;
  for (const { slug, cwd } of iterTargets(topic, opts)) {
    if (!slug || !cwd) continue;
    const snap = preSnapshot(runnerFor(cwd), topic);   // REUSED VERBATIM (WIP msg stays solo's wording)
    if (snap.state === "not-git") { log.error(`perform pre-snapshot: not a git repository: ${cwd}`); return 2; }
    atomicWrite(join(art, "baselines", `${slug}.tsv`),
      `slug=${slug}\ncwd=${cwd}\nbranch=${snap.branch}\nbaseline_sha=${snap.baseSha}\nstate=${snap.state}\nsnapshot_ts=${isoUtc()}\n`);
    if (snap.state === "clean") clean++; else if (snap.state === "wip-committed") committed++; else if (snap.state === "hook-blocked") blocked++;
  }
  log.ok(`perform pre-snapshot: ${clean} clean, ${committed} committed, ${blocked} hook-blocked`); return 0;
}

async function branchRun(rest: string[]): Promise<number> {
  let noBranch = false, branchName: string | undefined; const pos: string[] = [];
  for (let i = 0; i < rest.length; i++) { const t = rest[i];
    if (t === "--no-branch") { noBranch = true; continue; }
    if (t === "--branch" || t.startsWith("--branch=")) { const { value, shift } = kvParse(t, rest[i + 1]); branchName = value; if (shift === 2) i++; continue; }
    pos.push(t); }
  if (pos.length !== 1) { log.error("usage: perform branch [--no-branch] [--branch <name>] <topic>"); return 2; }
  return branchWith({ topic: pos[0], noBranch, branchName }, {}, runnerAt);
}
export async function branchWith(a: { topic: string; noBranch: boolean; branchName?: string }, opts: { home?: string; cwd?: string }, runnerFor: (cwd: string) => Runner): Promise<number> {
  const art = performArtDir(a.topic, opts);
  if (!existsSync(art)) { log.error(`perform branch: art-dir missing: ${art} (run perform init first)`); return 1; }
  const defaultBranch = a.branchName ?? `feat/perform-${a.topic}`;
  const rows: string[] = [];
  for (const { slug, cwd } of iterTargets(a.topic, opts)) {
    if (!slug || !cwd) continue;
    const r = runnerFor(cwd); let recorded: string;
    if (a.noBranch) { recorded = r.run("git", ["symbolic-ref", "--short", "HEAD"]).stdout.trim() || "(detached)"; log.info(`branch: (--no-branch) staying on ${recorded} in ${cwd}`); }
    else if (r.run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${defaultBranch}`]).code === 0) { createOrResumeBranch(r, defaultBranch); log.info(`branch: resumed ${defaultBranch} in ${cwd}`); recorded = defaultBranch; }
    else if (createOrResumeBranch(r, defaultBranch)) { log.info(`branch: created ${defaultBranch} in ${cwd}`); recorded = defaultBranch; }
    else { recorded = r.run("git", ["symbolic-ref", "--short", "HEAD"]).stdout.trim() || "(detached)"; log.warn(`branch: checkout -b failed in ${cwd}; staying on current branch`); }
    rows.push(`${slug}\t${recorded}`);
    const baseline = join(art, "baselines", `${slug}.tsv`);
    if (existsSync(baseline)) { const m = readFileSync(baseline, "utf8").match(/^baseline_sha=(.*)$/m); if (m) atomicWrite(join(art, "branch-base.sha"), m[1] + "\n"); }
  }
  atomicWrite(join(art, "perform-branches.tsv"), rows.length ? rows.join("\n") + "\n" : "");
  log.ok(`perform branch: ${rows.length} target(s) recorded`); return 0;
}
```

**scope-check / summary (+postSweep/formatSummaryBlock) / finish / forensics / archive** — use the
reconciled bodies (verbatim from the grounding `4-finish.impl`), with: `scope-check` writes
`scope-out-of-scope.txt` + KV `OOS_COUNT=`/`OOS_PATH=`, rc 0 / rc 1-if-missing-inputs; `summary`
post-sweep commit message `chore: post-perform leftovers for <topic>`; `finish` uses
`finishBranchAction` and **omits** the title/body override (defaults to `perform:`); `forensics` =
`captureArtDir({ artDir: performArtDir(topic), command: "perform" })`; `archive` =
`archiveTopic(topic, "perform")`. (Full bodies in the grounding reference — reproduce them honoring
the rc/file/atomic-vs-append gotchas: `finish-results.tsv` is **truncate-then-append**, not atomic;
baseline/post/scope files are atomic.)

```ts
export interface ScopeDeps { runnerFor(cwd: string): Runner; }
const liveScopeDeps: ScopeDeps = { runnerFor: runnerAt };
async function scopeCheckRun(rest: string[]): Promise<number> { const topic = rest[0]; if (!topic) { log.error("usage: perform scope-check <topic>"); return 2; } return scopeCheckWith(topic, liveScopeDeps); }
export async function scopeCheckWith(topic: string, d: ScopeDeps): Promise<number> {
  const art = performArtDir(topic);
  const targetFile = join(art, "target_cwd.txt"), baseFile = join(art, "branch-base.sha"), designFile = join(art, "design.md");
  if (!existsSync(targetFile) || !existsSync(baseFile)) { log.error(`perform scope-check: target_cwd.txt/branch-base.sha missing under ${art}`); return 1; }
  if (!existsSync(designFile)) { log.error(`perform scope-check: design.md missing under ${art}`); return 1; }
  const targetCwd = readFileSync(targetFile, "utf8").split("\n")[0].trim();
  const base = readFileSync(baseFile, "utf8").split("\n")[0].trim();
  const diffPaths = d.runnerFor(targetCwd).run("git", ["diff", "--name-only", `${base}..HEAD`]).stdout.split("\n").filter((x) => x.length > 0);
  atomicWrite(join(art, "diff-paths.txt"), diffPaths.length ? diffPaths.join("\n") + "\n" : "");
  const compPaths = extractComponentsPaths(readFileSync(designFile, "utf8"));
  atomicWrite(join(art, "components-paths.txt"), compPaths.length ? compPaths.join("\n") + "\n" : "");
  const oos = matchDiffAgainstComponents(diffPaths, compPaths);
  const oosPath = join(art, "scope-out-of-scope.txt");
  atomicWrite(oosPath, oos.length ? oos.join("\n") + "\n" : "");
  if (oos.length > 0) log.warn(`scope conformance: ${oos.length} out-of-scope path(s) detected`);
  process.stdout.write(`OOS_COUNT=${oos.length}\nOOS_PATH=${oosPath}\n`); return 0;
}

export interface SummaryDeps { runnerFor(cwd: string): Runner; now(): string; }
const liveSummaryDeps: SummaryDeps = { runnerFor: runnerAt, now: () => isoUtc() };
async function summaryRun(rest: string[]): Promise<number> { const topic = rest[0]; if (!topic) { log.error("usage: perform summary <topic>"); return 2; } return summaryWith(topic, liveSummaryDeps); }
export async function summaryWith(topic: string, d: SummaryDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform summary: art-dir missing: ${art}`); return 1; }
  mkdirSync(join(art, "posts"), { recursive: true });
  for (const t of iterTargets(topic)) {
    if (!t.slug || !t.cwd) continue;
    const baseline = join(art, "baselines", `${t.slug}.tsv`), post = join(art, "posts", `${t.slug}.tsv`);
    if (!existsSync(baseline)) { log.error(`perform summary: baseline missing for slug=${t.slug} (${baseline})`); continue; }
    if (!isDir(t.cwd)) { log.warn(`perform summary: target gone for slug=${t.slug} (cwd=${t.cwd}); omitting block`); continue; }
    const r = d.runnerFor(t.cwd); postSweep(r, topic, baseline, post, d.now());
    process.stdout.write(formatSummaryBlock(r, baseline, post) + "\n\n");
  }
  return 0;
}
function postSweep(r: Runner, topic: string, baseline: string, post: string, ts: string): void {
  const slug = kvFileField(baseline, "slug"), cwd = kvFileField(baseline, "cwd"), base = kvFileField(baseline, "branch");
  const postBranch = r.run("git", ["symbolic-ref", "--short", "HEAD"]).stdout.trim() || "(detached)";
  const dirty = r.run("git", ["status", "--porcelain"]).stdout.trim();
  let state: string;
  if (!dirty) state = "no-leftovers";
  else { r.run("git", ["add", "-A"]); state = r.run("git", ["commit", "-q", "-m", `chore: post-perform leftovers for ${topic}`]).code === 0 ? "swept" : (log.warn(`perform post-sweep: commit hook blocked sweep in ${cwd}`), "sweep-failed"); }
  const postSha = r.run("git", ["rev-parse", "HEAD"]).stdout.trim();
  atomicWrite(post, `slug=${slug}\ncwd=${cwd}\nbranch=${postBranch}\npost_sha=${postSha}\nstate=${state}\nbranch_changed=${base === postBranch ? "false" : "true"}\nsweep_ts=${ts}\n`);
}
function formatSummaryBlock(r: Runner, baseline: string, post: string): string {
  const slug = kvFileField(baseline, "slug"), cwd = kvFileField(baseline, "cwd"), baseBranch = kvFileField(baseline, "branch"), baselineSha = kvFileField(baseline, "baseline_sha"), baseState = kvFileField(baseline, "state");
  const postBranch = kvFileField(post, "branch"), postSha = kvFileField(post, "post_sha"), postState = kvFileField(post, "state"), changed = kvFileField(post, "branch_changed");
  const L: string[] = [`=== ${slug} [${cwd}] ===`];
  if (changed === "true") L.push(`  [WARNING: branch changed from ${baseBranch} to ${postBranch}]`);
  if (baseState === "hook-blocked") L.push("  [WARNING: pre-perform snapshot hook-blocked; baseline = pre-attempt HEAD]");
  if (postState === "sweep-failed") L.push("  [WARNING: post-perform sweep hook-blocked; leftovers remain in working tree]");
  if (baseBranch === "(detached)") L.push("  [WARNING: baseline branch detached]");
  L.push(`  branch:     ${postBranch}`); L.push(`  baseline:   ${baselineSha}   ${baseBranch}   (${baseState})`); L.push(`  HEAD:       ${postSha}   ${postBranch}`);
  const stat = shortstat(r, baselineSha);
  L.push(stat ? `  diff stat:  ${stat}` : "  diff stat:  (no changes since baseline)");
  L.push("  commits (oldest -> newest):");
  const commits = r.run("git", ["log", "--reverse", "--oneline", `${baselineSha}..HEAD`]).stdout.replace(/\n+$/, "");
  L.push(commits ? commits.split("\n").map((c) => "    " + c).join("\n") : "    (no commits since baseline)");
  return L.join("\n");
}

export interface FinishDeps { runnerFor(cwd: string): Runner; hasGh: boolean; }
const liveFinishDeps: FinishDeps = { runnerFor: runnerAt, hasGh: haveCmd("gh") };
async function finishRun(rest: string[]): Promise<number> {
  const topic = rest[0], action = rest[1];
  if (!topic || !action) { log.error("usage: perform finish <topic> <merge|pr|keep|discard>"); return 2; }
  if (!["merge", "pr", "keep", "discard"].includes(action)) { log.error(`perform finish: unknown action '${action}'`); return 2; }
  return finishWith(topic, action as "merge" | "pr" | "keep" | "discard", liveFinishDeps);
}
export async function finishWith(topic: string, action: "merge" | "pr" | "keep" | "discard", d: FinishDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform finish: art-dir missing: ${art}`); return 1; }
  const results = join(art, "finish-results.tsv"); writeFileSync(results, "");      // truncate (deploy-finish.sh ': > RESULTS')
  let n = 0;
  for (const t of iterTargets(topic)) {
    if (!t.slug || !t.cwd) continue;
    const branch = branchMapField(join(art, "perform-branches.tsv"), t.slug);
    const startBranch = kvFileField(join(art, "baselines", `${t.slug}.tsv`), "branch");
    const outcome = finishBranchAction(d.runnerFor(t.cwd), { branch, startBranch, action, hasGh: d.hasGh });
    appendFileSync(results, `${t.slug}\t${action}\t${outcome}\n`);                   // incremental append (matches bash >>)
    log.info(`finish: ${t.slug} -> ${action} -> ${outcome}`); n++;
  }
  log.ok(`perform finish: ${n} target(s) completed`); return 0;
}

async function forensicsRun(rest: string[]): Promise<number> {
  const topic = rest[0]; if (!topic) { log.error("usage: perform forensics <topic>"); return 2; }
  const path = captureArtDir({ artDir: performArtDir(topic), command: "perform" });
  if (path) { log.ok(`perform forensics: captured ${path}`); process.stdout.write(path + "\n"); } else log.info("perform forensics: no mechanical findings (no file written)");
  return 0;
}

export async function archiveRun(rest: string[]): Promise<number> {
  const topic = rest[0]; if (!topic) { log.error("usage: perform archive <topic>"); return 2; }
  archiveTopic(topic, "perform"); log.ok(`perform archive: archived _perform for ${topic}`); return 0;
}
```

`haveCmd('gh')` — copy `solo.ts`'s `haveCmd` helper (a `command -v` probe) or inline a small one.

**Tests (B2b)** `tests/perform-cmd.test.ts` (CONSORT_HOME temp, injected `runnerFor` fake, captured
io): pre-snapshot (art missing → rc 1; single-repo via `target_cwd.txt` → `baselines/main.tsv` with
`state=clean` + `baseline_sha`; not-git → rc 2; hook-blocked → rc 0); branch (ref absent → `-b` path,
`perform-branches.tsv`=`main\tfeat/perform-<topic>\n`, `branch-base.sha` from baseline; ref present →
resume; `--no-branch` → current branch; `--branch=custom`); scope-check (out-of-scope subset →
`scope-out-of-scope.txt`, `OOS_COUNT`, rc 0; missing inputs → rc 1); summary (one `=== main […] ===`
block; clean → `posts/main.tsv` `state=no-leftovers`; dirty → `swept`); finish (merge→`merged`+`-D`;
conflict→`merge-conflict-left`; keep/discard/pr tokens; `no-branch`; `finish-results.tsv` rows;
bad action → rc 2); archive (real, under CONSORT_HOME → `_perform` moved + part `status.json`
archived). Outcome tokens asserted byte-exact.

- [ ] B2b: write tests → FAIL → implement the verbs → tests PASS + `npm run typecheck` 0 + the full
  `npm run test` green + `npm run lint` 0 → commit `feat(perform): pre-snapshot/branch/scope-check/summary/finish/forensics/archive verbs`.

---

### Task B3 (conductor): `commands/perform.md` directive

Author the single-repo directive (mirrors `commands/score.md`). It is **prose** scanned by the
stale-token gate — zero `cw_`/`clone-wars`/`master-yoda`/`MISSION ACCOMPLISHED`/`trooper`/`commander`.
`$CS = node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs`. Stages:

- **Frontmatter:** description, `argument-hint: [--no-branch] [--branch <n>] [--topic <slug>] [--max-rounds N] [<design-doc-path>]`, allowed-tools (Bash, Write, Read, Edit, AskUserQuestion, Skill).
- **Args fence (3-step):** mint via `$CS perform --mint-args-file` (served at top level); strip
  `--max-rounds` into `MAX_ROUNDS_OVERRIDE` **before** writing; `Write` the cleaned `$ARGUMENTS`;
  `$CS perform init --args-file <p>`.
- **Stage 0 — init + route:** run `init`; capture `ART=/TOPIC=/ROUTING=/PROVIDER=/TARGET_CWD=`. On
  audit FAIL (rc 1 + `ISSUE=` lines): surface them, stop. **If `ROUTING=multi`: tell the user
  multi-repo perform is a later phase and stop.** Then `$CS perform pre-snapshot <TOPIC>` then (unless
  `--no-branch`) `$CS perform branch <TOPIC>` (capture `branch-base.sha`).
- **Stage 1.1 — spawn one part:** `$CS spawn cody <PROVIDER> <TOPIC> --cwd "$(cat <ART>/target_cwd.txt)"`.
  On spawn failure: `$CS perform archive <TOPIC>` and exit.
- **Stage 1 — run the turn (round-aware, auto-retry-once):** `ROUND=1`, `MAX_ROUNDS=${MAX_ROUNDS_OVERRIDE:-5}`.
  `$CS perform turn-send <TOPIC> <ROUND>`; background `$CS perform turn-wait <TOPIC> <ROUND>`; on
  completion read `TS=` from `turn-cody-<ROUND>.txt`. `ok`→Stage 2; `failed`/`timeout`→auto-retry-once
  (rm `turn-cody-<ROUND>.txt`/`.done`/`cody_turn_prompt_<ROUND>.md`, re-send) then AskUserQuestion
  (Hand-off→write RESUME.md, preserve pane / Abort→archive / Try-again); `question`→ read
  `question-cody-<ROUND>.txt` via `parseQuestionPayload`; `ROUTE=verify`→`verifyClaim(kind,value,
  questionRunnerAt(targetCwd))` + `formatReply` → write to temp → `$CS send --from maestro cody <TOPIC>
  @<reply>`; `ROUTE=escalate`→AskUserQuestion→reply; re-arm `turn-wait` on the **same** round.
- **Stage 2 — cross-verify (Maestro):** read `verify-report-<ROUND>.md`, `git -C <targetCwd> log/diff
  --stat <branch-base>..HEAD`, ≤3 spot-checks; write `cross-verify-<ROUND>.md` top-line
  `VERDICT: PASS|FAIL`. PASS→Stage 4. FAIL & `ROUND>MAX_ROUNDS`→AskUserQuestion (Continue+1/Hand-off/
  Abort). FAIL & within budget→Stage 3.
- **Stage 3 — fix bundle:** write `fix-prompt-$((ROUND+1)).md` (tagged bullets only — no preamble/
  skill/`END_OF_INSTRUCTION`); `ROUND++`; loop to Stage 1.
- **Stage 4 — finish + teardown:** `$CS perform scope-check <TOPIC>` → read `OOS_COUNT`; if >0,
  AskUserQuestion (amend design via Edit → `scope-amended.txt` / send-back → append `bugs.txt` +
  re-enter Stage 1 / force-keep → `scope-overrides.txt`). `$CS perform summary <TOPIC>` (surface the
  block). **Finish menu** (AskUserQuestion: Merge / Push+PR / Keep / Discard; recommend Push+PR if a
  remote exists else Merge) → `$CS perform finish <TOPIC> <action>`. `$CS perform forensics <TOPIC>` →
  if a path printed, **Edit**-append an idempotent `## Maestro reflection` (3-5 bullets). Teardown via
  `$CS coda <TOPIC>` then `$CS perform archive <TOPIC>`. Print the final summary (branch, commit count,
  archive path).

Self-review the directive against the stale-token gate before B4.

---

### Task B4 (conductor): rebuild + commit `dist`

`npm run build` (esbuild → `dist/consort.cjs`), then the full gate: `npm run typecheck` (0),
`npm run test` (all green incl. stale-tokens — which now also scans `commands/perform.md`),
`npm run lint` (0). `git add dist/consort.cjs commands/perform.md && git commit -m "build(perform):
single-repo directive + rebuilt dist"`. Sanity: `node dist/consort.cjs perform` → usage on stderr,
rc 2; `node dist/consort.cjs perform archive nonexistent` reaches the handler.

---

### Task B5 (conductor): live single-repo dogfood

Inside tmux with `CLAUDE_PLUGIN_ROOT=$PWD`, against a **throwaway non-plugin git repo** (so
`detectProvider` → `codex`, a fast/cheap part — consort itself is a plugin repo and would resolve to
`claude`) with a small audit-passing single-repo design doc and a short
`CONSORT_PERFORM_TURN_TIMEOUT_S` (e.g. 600). Drive: `perform init` → `spawn cody codex` → `turn-send`/
`turn-wait` round 1 → confirm the part plans/implements/self-verifies and emits `done` (a real commit
on `feat/perform-<topic>`) → Maestro cross-verify `VERDICT: PASS` → `scope-check` → `summary` → finish
menu (**pick Keep** — never push/PR against anything during the dogfood) → `coda` (FINE banner) →
`archive`. Fix any real bug found (the dogfood is the load-bearing gate). Append the result to
`docs/superpowers/DOGFOOD.md` and commit. **Leave the branch** `feat/perform` for Phases C–D.

---

## Phase B completion gate

- [ ] `npm run typecheck` 0 · `npm run test` all green · `npm run lint` 0 · stale-tokens green
  (incl. `commands/perform.md`).
- [ ] `dist/consort.cjs` rebuilt **and committed**; `node dist/consort.cjs perform` dispatches.
- [ ] Live single-repo dogfood passed end-to-end; `DOGFOOD.md` updated.
- [ ] Branch `feat/perform` retained for Phase C (no PR).
