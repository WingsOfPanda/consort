# `/consort:duet` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/consort:duet` — the conductor (in repo A) opens one persistent claude/codex part in another repo (repo B) and co-develops with it over open-ended rounds, with judgment-based two-way human relay, finishing as a reviewable PR in repo B.

**Architecture:** A near-mirror of `/consort:solo`, split into a pure core (`src/core/duet.ts`, `src/core/duetTurn.ts`) and a dispatch command (`src/commands/duet.ts`) plus a directive (`commands/duet.md`). It reuses the existing cross-repo plumbing verbatim: `spawn --cwd` + tmux `-c` (part pane in repo B), conductor-keyed state (`paths.ts`), `gitwork.ts` (`preSnapshot`/`createOrResumeBranch`/`finishBranch`/`runnerAt`), the OFFSET re-arm classifier pattern, `coda`, and `runForensics`. The only structural difference from solo: the target repo (`target_cwd.txt`) is repo B, not the conductor's `repoRoot()`, and the loop is open-ended.

**Tech Stack:** TypeScript (Node/ESM, compiled by esbuild to one committed `dist/consort.cjs`), vitest, eslint, tsc. State is file-based IPC; tmux is the only subprocess surface (tested as pure arg arrays).

**Source of truth:** the spec `docs/superpowers/specs/2026-06-08-consort-duet-design.md`. Read it before starting.

**Build discipline:** Tasks 1–9 must **NOT** run `npm run build`. Task 10 owns the single `dist/consort.cjs` rebuild + version bump. Each task runs `npx vitest run <its test file>` (and, where noted, `npm run typecheck`), commits, and stops — green at every step.

**Reviewer note (carry into every task):** duet must add **no** reference to retired multi-repo units (`detectMultiRepo`, `--targets`, `DocMode`, `## Execution DAG`, `iterTargets` multi-row, `dag.ts`, `performSibling.ts`). Keep `commands/duet.md` and `src/**` clear of the stale-token gate's banned set: `clone-wars`, `cw_`, `master-yoda`, `MISSION ACCOMPLISHED`, `@cw_`, and case-insensitive `trooper`/`commander` (`tests/stale-tokens.test.ts`). Never embed `END_OF_INSTRUCTION` or a done-event line in a prompt body — `inboxWrite` owns the single done-contract.

---

## File Structure

- **Create** `src/core/duet.ts` — `parseDuetArgs`, re-export `deriveSlug`, `duetArtDir`/`duetExecDir`, `renderDuetSummary`/`DuetSummaryFacts`, `renderDuetResume`/`DuetResumeFacts`.
- **Create** `src/core/duetTurn.ts` — `composeDuetBrief` (round 1) and `composeDuetFollowup` (round ≥ 2).
- **Modify** `src/core/turn.ts` — export the existing private `BRANCH_DISCIPLINE` and `BLOCKERS` consts so `duetTurn.ts` reuses the single source (additive; no behavior change).
- **Create** `src/commands/duet.ts` — `run()` dispatch + verbs `init`/`branch`/`round-send`/`round-wait`/`relay`/`detect-test`/`finish`/`forensics`/`flag`/`summary`, with `*With(deps)` test seams mirroring solo.
- **Modify** `src/consort.ts` — register `duet` in `loadHandlers()` (one import + one map entry).
- **Create** `commands/duet.md` — the conductor directive (auto-discovered; no manifest entry needed).
- **Create** `tests/duet-core.test.ts`, `tests/duet-turn.test.ts`, `tests/duet-cmd.test.ts`.
- **Modify** `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — version bump.
- **Rebuild + commit** `dist/consort.cjs`.

Reference (verbatim templates to adapt): `src/commands/solo.ts`, `src/core/solo.ts`, `src/core/turn.ts`, `src/core/gitwork.ts`, `src/core/ipc.ts`, `src/core/paths.ts`, `src/args.ts`, `src/core/forensics.ts`, `commands/solo.md`, `tests/solo-cmd.test.ts`, `tests/solo-core.test.ts`.

---

## Task 1: `src/core/duet.ts` — arg parsing + path helpers

**Files:**
- Create: `src/core/duet.ts`
- Test: `tests/duet-core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/duet-core.test.ts
import { describe, it, expect } from "vitest";
import { parseDuetArgs, deriveSlug, duetArtDir, duetExecDir } from "../src/core/duet.js";

describe("parseDuetArgs", () => {
  it("captures --repo (value flag), --provider, --in-place; rest is the verbatim task", () => {
    const a = parseDuetArgs(["--repo", "/abs/repoB", "--provider", "claude", "--in-place", "wire up", "the", "thing"]);
    expect(a.repo).toBe("/abs/repoB");
    expect(a.provider).toBe("claude");
    expect(a.inPlace).toBe(true);
    expect(a.taskText).toBe("wire up the thing");
  });
  it("supports --repo=… and --provider=… inline forms; default no in-place, no provider", () => {
    const a = parseDuetArgs(["--repo=/x", "--provider=codex", "do it"]);
    expect(a.repo).toBe("/x");
    expect(a.provider).toBe("codex");
    expect(a.inPlace).toBe(false);
    expect(a.taskText).toBe("do it");
  });
  it("a bare --repo with no value leaves repo undefined and does not eat the task", () => {
    const a = parseDuetArgs(["--repo", "--provider", "codex", "task here"]);
    expect(a.repo).toBeUndefined();
    expect(a.taskText).toBe("task here");
  });
});

describe("duet path helpers", () => {
  it("art dir is _duet under the topic dir; exec is execute under that", () => {
    const art = duetArtDir("my-topic");
    expect(art.endsWith("/my-topic/_duet")).toBe(true);
    expect(duetExecDir("my-topic")).toBe(art + "/execute");
  });
  it("re-exports deriveSlug (single slug algorithm)", () => {
    expect(deriveSlug("Add OAuth Login!")).toBe("add-oauth-login");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/duet-core.test.ts`
Expected: FAIL (`Cannot find module ../src/core/duet.js`).

- [ ] **Step 3: Write `src/core/duet.ts` (parsing + paths only)**

```ts
// src/core/duet.ts — pure helpers for /consort:duet (collaborative cross-repo session).
import { join } from "node:path";
import { topicDir } from "./paths.js";

export { deriveSlug } from "./solo.js"; // one slug algorithm across commands

export interface DuetArgs {
  repo?: string;       // repo B absolute path (the --repo value flag)
  taskText: string;    // the opening task (verbatim tail)
  provider?: string;
  inPlace: boolean;    // --in-place: edit repo B's current branch, no isolation
}

/** Mirror of parseSoloArgs, with --repo (value flag) and --in-place (boolean) added.
 *  --repo / --provider consume the next token only if present and not another flag (also the =form). */
export function parseDuetArgs(tokens: string[]): DuetArgs {
  let repo: string | undefined;
  let provider: string | undefined;
  let inPlace = false;
  const text: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--in-place") { inPlace = true; continue; }
    if (t === "--repo") { const v = tokens[i + 1]; if (v && !v.startsWith("--")) { repo = v; i++; } continue; }
    if (t.startsWith("--repo=")) { repo = t.slice("--repo=".length); continue; }
    if (t === "--provider") { const v = tokens[i + 1]; if (v && !v.startsWith("--")) { provider = v; i++; } continue; }
    if (t.startsWith("--provider=")) { provider = t.slice("--provider=".length); continue; }
    text.push(t);
  }
  return { repo, taskText: text.join(" ").trim(), provider, inPlace };
}

export function duetArtDir(topic: string): string { return join(topicDir(topic), "_duet"); }
export function duetExecDir(topic: string): string { return join(duetArtDir(topic), "execute"); }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/duet-core.test.ts`
Expected: PASS (all in this file so far).

- [ ] **Step 5: Commit**

```bash
git add src/core/duet.ts tests/duet-core.test.ts
git commit -m "feat(duet): arg parsing + state-path helpers"
```

---

## Task 2: `src/core/duet.ts` — summary + resume renderers

**Files:**
- Modify: `src/core/duet.ts`
- Test: `tests/duet-core.test.ts` (append)

Reference the shape of `renderSummary`/`renderResume` in `src/core/solo.ts` (`renderResume` at solo.ts:119-134), but duet records repo B, mode, and the round.

- [ ] **Step 1: Append failing tests**

```ts
// append to tests/duet-core.test.ts
import { renderDuetSummary, renderDuetResume } from "../src/core/duet.js";

describe("renderDuetResume", () => {
  it("records repo B, branch+mode, last round, task, and a restore pointer (no auto-resume)", () => {
    const md = renderDuetResume({
      topic: "t", repo: "/abs/repoB", branch: "feat/duet-t", mode: "branch",
      lastRound: 3, task: "do the thing", phase: "round", gate: "round-wait",
    });
    expect(md).toContain("# RESUME — t (aborted at round.round-wait)");
    expect(md).toContain("/abs/repoB");
    expect(md).toContain("feat/duet-t");
    expect(md).toContain("Last round: 3");
    expect(md).toContain("do the thing");
    expect(md).toMatch(/cannot auto-resume/i);
  });
});

describe("renderDuetSummary", () => {
  it("emits a command: duet frontmatter and the cross-repo facts", () => {
    const md = renderDuetSummary({
      topic: "t", status: "ok", started: "s", ended: "e", duration: 5,
      provider: "codex", instrument: "viola", repo: "/abs/repoB", mode: "branch",
      branch: "feat/duet-t", rounds: 4, verify: "PASS", diffStats: "1 file",
      archived: "/arch", finishResult: "pr\tpr-opened",
    });
    expect(md).toMatch(/^---\ncommand: duet\n/);
    expect(md).toContain("/abs/repoB");
    expect(md).toContain("rounds: 4");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/duet-core.test.ts`
Expected: FAIL (`renderDuetSummary`/`renderDuetResume` not exported).

- [ ] **Step 3: Implement the renderers in `src/core/duet.ts`**

```ts
// append to src/core/duet.ts

export interface DuetResumeFacts {
  topic: string; repo: string; branch: string; mode: string; lastRound: number;
  task: string; phase: string; gate: string;
}
export function renderDuetResume(f: DuetResumeFacts): string {
  const restore = f.mode === "in-place"
    ? "(in-place run — no branch was cut; nothing to restore)"
    : `git -C ${f.repo} checkout <your-original-branch>   # the part's work is on ${f.branch}`;
  return [
    `# RESUME — ${f.topic} (aborted at ${f.phase}.${f.gate})`,
    "",
    "## State pointers",
    `- Repo B: ${f.repo}`,
    `- Branch: ${f.branch} (mode: ${f.mode})`,
    `- Last round: ${f.lastRound}`,
    "",
    "## Opening task",
    f.task.trim(),
    "",
    "## Restore",
    `- ${restore}`,
    "- Forensic pointer only: /consort:duet cannot auto-resume an in-flight slug — run /consort:coda to clear it, then re-run.",
    "",
  ].join("\n");
}

export interface DuetSummaryFacts {
  topic: string; status: "ok" | "aborted"; started: string; ended?: string; duration?: number;
  provider: string; instrument: string; repo: string; mode: string; branch: string;
  rounds: number; verify: string; diffStats: string; archived: string; finishResult: string;
  abortedPhase?: string; abortedGate?: string; abortedReason?: string;
}
export function renderDuetSummary(f: DuetSummaryFacts): string {
  const lines = [
    "---",
    "command: duet",
    `topic: ${f.topic}`,
    `status: ${f.status}`,
    "---",
    "",
    `# duet — ${f.topic}`,
    "",
    `- Repo B: ${f.repo}`,
    `- Mode: ${f.mode}`,
    `- Branch: ${f.branch}`,
    `- Instrument: ${f.instrument} (${f.provider})`,
    `- rounds: ${f.rounds}`,
    `- Verify: ${f.verify}`,
    `- Diff: ${f.diffStats}`,
    `- Finish: ${f.finishResult}`,
    `- Archived: ${f.archived}`,
    `- Timing: started=${f.started} ended=${f.ended ?? "(running)"} duration=${f.duration ?? 0}s`,
  ];
  if (f.status === "aborted") {
    lines.push("", `## Aborted`, `- Phase: ${f.abortedPhase ?? "unknown"}`, `- Gate: ${f.abortedGate ?? "unknown"}`, `- Reason: ${f.abortedReason ?? "unknown"}`);
  }
  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run tests/duet-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/duet.ts tests/duet-core.test.ts
git commit -m "feat(duet): summary + resume renderers (cross-repo facts)"
```

---

## Task 3: `src/core/duetTurn.ts` — prompt builders + export shared discipline consts

**Files:**
- Modify: `src/core/turn.ts` (export `BRANCH_DISCIPLINE`, `BLOCKERS`)
- Create: `src/core/duetTurn.ts`
- Test: `tests/duet-turn.test.ts`

- [ ] **Step 1: Write the failing test** (covers content + the no-done-contract regression and the post-`inboxWrite` single-`END_OF_INSTRUCTION` count)

```ts
// tests/duet-turn.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { composeDuetBrief, composeDuetFollowup } from "../src/core/duetTurn.js";
import { inboxWrite, inboxPath } from "../src/core/ipc.js";
import { partDir } from "../src/core/paths.js";
import { freshHome } from "./helpers/tmpHome.js";

describe("composeDuetBrief", () => {
  const p = composeDuetBrief("implement X", "/abs/repoB", "feat/duet-demo");
  it("names repo B's path, the branch, and the cross-repo framing + carries the task", () => {
    expect(p).toContain("/abs/repoB");
    expect(p).toContain("feat/duet-demo");
    expect(p).toMatch(/separate repository|conductor/i);
    expect(p).toContain("implement X");
  });
  it("does NOT embed its own done-event line or END_OF_INSTRUCTION (inboxWrite owns them)", () => {
    expect(p).not.toContain('{"event":"done"');
    expect(p).not.toContain("END_OF_INSTRUCTION");
  });
});

describe("composeDuetFollowup", () => {
  const p = composeDuetFollowup("now also handle Y", 2);
  it("frames it as round N and inlines the conductor's text", () => {
    expect(p).toContain("round 2");
    expect(p).toContain("now also handle Y");
  });
  it("does NOT embed its own done-event line or END_OF_INSTRUCTION", () => {
    expect(p).not.toContain('{"event":"done"');
    expect(p).not.toContain("END_OF_INSTRUCTION");
  });
});

describe("duet inbox carries a single done contract (no duplicate END_OF_INSTRUCTION)", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => h.cleanup());
  const count = (s: string, sub: string): number => s.split(sub).length - 1;
  it("brief → exactly one END_OF_INSTRUCTION and one done line", () => {
    const d = partDir("viola", "codex", "demo"); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "outbox.jsonl"), "");
    inboxWrite("viola", "codex", "demo", composeDuetBrief("t", "/abs/repoB", "feat/duet-demo"));
    const txt = readFileSync(inboxPath("viola", "codex", "demo"), "utf8");
    expect(count(txt, "END_OF_INSTRUCTION")).toBe(1);
    expect(count(txt, '"event":"done"')).toBe(1);
    expect(txt.trimEnd().endsWith("END_OF_INSTRUCTION")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/duet-turn.test.ts`
Expected: FAIL (`Cannot find module ../src/core/duetTurn.js`).

- [ ] **Step 3: Export the shared consts from `src/core/turn.ts`**

In `src/core/turn.ts`, change the two private declarations to exported (additive only — do not alter their text):

```ts
// was: const BRANCH_DISCIPLINE =
export const BRANCH_DISCIPLINE =
// was: const BLOCKERS =
export const BLOCKERS =
```

- [ ] **Step 4: Create `src/core/duetTurn.ts`**

```ts
// src/core/duetTurn.ts — round-1 brief + round-N follow-up builders for /consort:duet.
// Like turn.ts's composers, these bodies do NOT carry a done-event line or END_OF_INSTRUCTION;
// inboxWrite appends exactly one of each (the prelude duplicate-END_OF_INSTRUCTION lesson, 0.1.25).
import { BRANCH_DISCIPLINE, BLOCKERS } from "./turn.js";

/** Round 1: state the cross-repo framing (repo B path + branch), then the opening task. */
export function composeDuetBrief(task: string, repoPath: string, branch: string): string {
  return [
    `You are collaborating with a conductor on a multi-round task in the repository at \`${repoPath}\`.`,
    `You are on the branch \`${branch}\` of THAT repository (your shell is already there). The conductor`,
    "is running from a SEPARATE repository and will coordinate with you over several rounds — expect",
    "follow-up messages after this one.",
    "",
    "THE OPENING TASK:",
    "",
    task.trim(),
    "",
    "INSTRUCTIONS:",
    `- Work directly in \`${repoPath}\`, on \`${branch}\`.`,
    "- This is one round of an ongoing collaboration: do this round's work, commit per logical change",
    "  with Conventional Commits messages, then report by emitting the done event (see below).",
    "- The conductor will review your work and may send refinements for the next round.",
    "- If the repository has a test suite, run it and make your change pass it.",
    "",
    BRANCH_DISCIPLINE,
    BLOCKERS,
  ].join("\n");
}

/** Round >= 2: wrap the conductor's free-form follow-up text. */
export function composeDuetFollowup(text: string, round: number): string {
  return [
    `You are continuing the collaboration — round ${round}, still on the same branch and repository.`,
    "",
    "The conductor's message for this round:",
    "",
    text.trim(),
    "",
    "INSTRUCTIONS:",
    "- Address the above. Commit per logical change with Conventional Commits messages.",
    "- If the repository has a test suite, run it and keep it passing.",
    "- When this round's work is done and committed, emit the done event (see below).",
    "",
    BRANCH_DISCIPLINE,
    BLOCKERS,
  ].join("\n");
}
```

- [ ] **Step 5: Run the test + typecheck**

Run: `npx vitest run tests/duet-turn.test.ts && npm run typecheck`
Expected: PASS; typecheck clean (confirms the `turn.ts` export change didn't break callers).

- [ ] **Step 6: Commit**

```bash
git add src/core/turn.ts src/core/duetTurn.ts tests/duet-turn.test.ts
git commit -m "feat(duet): round-1 brief + follow-up prompt builders"
```

---

## Task 4: `src/commands/duet.ts` — dispatch skeleton + `init`

**Files:**
- Create: `src/commands/duet.ts`
- Test: `tests/duet-cmd.test.ts`

Mirror `src/commands/solo.ts` lines 1-91 (imports, `usage`, `InitDeps`, `run`, `initWith`). Key duet deltas vs solo's `initWith`: parse with `parseDuetArgs`; validate `--repo` (present, absolute, whitespace-free, `existsSync`, and — unless `--in-place` — a git repo via `d.isGitRepo`); write `mode.txt`, `target_cwd.txt`, and `repo-b-head.txt` in addition to solo's set; stdout prints `MODE=`/`TARGET=<repoB>` (no `FINISH=`). The `run()` switch routes `init` through `applyArgsFile(rest, { valueFlags: new Set(["--provider", "--repo"]) })`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/duet-cmd.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run as duetRun, initWith } from "../src/commands/duet.js";
import type { InitDeps } from "../src/commands/duet.js";
import { duetArtDir, duetExecDir } from "../src/core/duet.js";
import { freshHome } from "./helpers/tmpHome.js";

// Inline stdout capture (copied per file, like solo-cmd.test.ts).
function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as unknown as { write: unknown }).write = (chunk: unknown) => { buf += String(chunk); return true; };
  return { text: () => buf, restore: () => { (process.stdout as unknown as { write: unknown }).write = orig; } };
}

const okDeps: InitDeps = {
  haveCmd: () => true,
  instrumentBinary: () => "codex",
  pickRandomInstrument: () => "viola",
  isGitRepo: () => true,
  headSha: () => "abc123",
};

describe("duet run() dispatch", () => {
  it("unknown verb → rc 2", async () => { expect(await duetRun(["nope"])).toBe(2); });
});

describe("duet init", () => {
  let h: { home: string; cleanup: () => void };
  let out: ReturnType<typeof captureStdout>;
  beforeEach(() => { h = freshHome(); out = captureStdout(); });
  afterEach(() => { out.restore(); h.cleanup(); });

  it("scaffolds _duet, writes state incl. target_cwd/mode, prints KV; rc 0", async () => {
    const repo = join(h.home, "repoB"); mkdirSync(repo, { recursive: true });
    const rc = await initWith(["--repo", repo, "add", "oauth"], okDeps);
    expect(rc).toBe(0);
    const art = duetArtDir("add-oauth"), exec = duetExecDir("add-oauth");
    expect(existsSync(join(exec))).toBe(true);
    expect(readFileSync(join(exec, "target_cwd.txt"), "utf8").trim()).toBe(repo);
    expect(readFileSync(join(exec, "mode.txt"), "utf8").trim()).toBe("branch");
    expect(readFileSync(join(art, "topic-text.txt"), "utf8")).toBe("add oauth");
    expect(out.text()).toMatch(/^SLUG=add-oauth$/m);
    expect(out.text()).toMatch(new RegExp(`^TARGET=${repo}$`, "m"));
    expect(out.text()).toMatch(/^MODE=branch$/m);
  });

  it("missing --repo → rc 1", async () => {
    expect(await initWith(["just", "a", "task"], okDeps)).toBe(1);
  });
  it("non-absolute --repo → rc 1", async () => {
    expect(await initWith(["--repo", "relative/path", "task"], okDeps)).toBe(1);
  });
  it("--repo with whitespace → rc 1", async () => {
    // (verbatim-tail can't deliver a spaced --repo token; reject defensively)
    expect(await initWith(["--repo", "/has space", "task"], okDeps)).toBe(1);
  });
  it("non-git --repo in branch mode → rc 1", async () => {
    const repo = join(h.home, "plain"); mkdirSync(repo, { recursive: true });
    expect(await initWith(["--repo", repo, "task"], { ...okDeps, isGitRepo: () => false })).toBe(1);
  });
  it("--in-place skips the git check and records mode=in-place", async () => {
    const repo = join(h.home, "plain2"); mkdirSync(repo, { recursive: true });
    const rc = await initWith(["--repo", repo, "--in-place", "quick fix"], { ...okDeps, isGitRepo: () => false });
    expect(rc).toBe(0);
    expect(readFileSync(join(duetExecDir("quick-fix"), "mode.txt"), "utf8").trim()).toBe("in-place");
  });
  it("already in flight → rc 2", async () => {
    const repo = join(h.home, "repoB"); mkdirSync(repo, { recursive: true });
    await initWith(["--repo", repo, "dup"], okDeps);
    expect(await initWith(["--repo", repo, "dup"], okDeps)).toBe(2);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/duet-cmd.test.ts`
Expected: FAIL (`Cannot find module ../src/commands/duet.js`).

- [ ] **Step 3: Create `src/commands/duet.ts` with `run` + `init`**

Use solo.ts as the template for imports/log/helpers. The new code:

```ts
// src/commands/duet.ts — /consort:duet collaborative cross-repo session.
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc } from "../core/time.js";           // confirm the helper solo uses for timestamps
import { readField, readIfExists, kvField } from "../core/fsread.js"; // confirm names against solo.ts imports
import { repoRoot } from "../core/paths.js";
import { haveCmd } from "../core/sys.js";            // confirm against solo.ts
import { instrumentBinary } from "../core/contracts.js";
import { pickRandomInstrument } from "../core/instruments.js";
import { runnerAt, preSnapshot, createOrResumeBranch, finishBranch } from "../core/gitwork.js";
import type { Runner } from "../core/gitwork.js";
import { composeDuetBrief, composeDuetFollowup } from "../core/duetTurn.js";
import { classifyTurn } from "../core/turn.js";
import { parseLatestOffset } from "../core/scoreTurn.js";
import { outboxOffset, outboxPath, statusPath, outboxWaitSince } from "../core/ipc.js";
import type { OutboxEvent } from "../core/ipc.js";
import { run as sendRun } from "./send.js";
import { runForensics, runFlag } from "../core/forensics.js";
import { applyArgsFile } from "../args.js";
import {
  parseDuetArgs, deriveSlug, duetArtDir, duetExecDir,
  renderDuetSummary, renderDuetResume,
} from "../core/duet.js";
import type { DuetSummaryFacts } from "../core/duet.js";

function usage(): number {
  log.error("usage: duet <init|branch|round-send|round-wait|relay|detect-test|finish|forensics|flag|summary> ...");
  return 2;
}

export async function run(args: string[]): Promise<number> {
  const verb = args[0];
  const rest = args.slice(1);
  switch (verb) {
    case "init": return initRun(applyArgsFile(rest, { valueFlags: new Set(["--provider", "--repo"]) }));
    case "branch": return branchRun(rest);
    case "round-send": return roundSendRun(rest);
    case "round-wait": return roundWaitRun(rest);
    case "relay": return relayRun(rest);
    case "detect-test": return detectTestRun(rest);
    case "finish": return finishRun(rest);
    case "forensics": return runForensics("duet", duetArtDir, rest[0]);
    case "flag": return runFlag("duet", rest[0], rest.slice(1).join(" "));
    case "summary": return summaryRun(rest);
    default: return usage();
  }
}

export interface InitDeps {
  haveCmd(bin: string): boolean;
  instrumentBinary(provider: string): string | undefined;
  pickRandomInstrument(slug: string): string | undefined;
  isGitRepo(dir: string): boolean;
  headSha(dir: string): string;
}
const liveInitDeps: InitDeps = {
  haveCmd, instrumentBinary, pickRandomInstrument,
  isGitRepo: (dir) => runnerAt(dir).run("git", ["rev-parse", "--is-inside-work-tree"]).code === 0,
  headSha: (dir) => runnerAt(dir).run("git", ["rev-parse", "HEAD"]).stdout.trim(),
};

async function initRun(tokens: string[]): Promise<number> { return initWith(tokens, liveInitDeps); }

export async function initWith(tokens: string[], d: InitDeps): Promise<number> {
  const { repo, taskText, provider: provArg, inPlace } = parseDuetArgs(tokens);
  if (!taskText) { log.error("duet init: task text is empty"); return 1; }
  if (!repo) { log.error("duet init: --repo <abs-path> is required"); return 1; }
  if (!repo.startsWith("/") || /\s/.test(repo)) { log.error(`duet init: --repo must be a whitespace-free absolute path: '${repo}'`); return 1; }
  if (!existsSync(repo)) { log.error(`duet init: --repo does not exist: ${repo}`); return 1; }
  if (!inPlace && !d.isGitRepo(repo)) { log.error(`duet init: --repo is not a git repository (use --in-place to skip isolation): ${repo}`); return 1; }

  const slug = deriveSlug(taskText);
  if (!slug) { log.error("duet init: task produced an empty slug; provide alphanumerics"); return 1; }

  const provider = provArg ?? "codex";
  const binary = d.instrumentBinary(provider);
  if (!binary) { log.error(`duet init: provider '${provider}' has no entry in contracts.yaml`); return 3; }
  if (!d.haveCmd(binary)) { log.error(`duet init: ${provider}'s binary '${binary}' is not on PATH`); return 3; }

  const art = duetArtDir(slug);
  if (existsSync(art)) { log.error(`duet init: topic already in flight: ${art}`); log.error("  run /consort:coda or pick a different task"); return 2; }

  const instrument = d.pickRandomInstrument(slug);
  if (!instrument) { log.error(`duet init: no available instrument in the pool for '${slug}'`); return 1; }

  const mode = inPlace ? "in-place" : "branch";
  const exec = duetExecDir(slug);
  mkdirSync(exec, { recursive: true });
  atomicWrite(join(art, "topic.txt"), slug + "\n");
  atomicWrite(join(art, "topic-text.txt"), taskText);
  atomicWrite(join(art, "selected-provider.txt"), provider + "\n");
  atomicWrite(join(art, "instrument.txt"), instrument + "\n");
  atomicWrite(join(art, "timing.txt"), `started=${isoUtc()}\n`);
  atomicWrite(join(exec, "provider.txt"), provider + "\n");
  atomicWrite(join(exec, "mode.txt"), mode + "\n");
  atomicWrite(join(exec, "target_cwd.txt"), repo + "\n");      // INVARIANT: init owns this (branch is skipped under --in-place)
  atomicWrite(join(exec, "repo-b-head.txt"), (inPlace ? "" : d.headSha(repo)) + "\n");

  log.ok(`duet init: topic=${slug} instrument=${instrument} provider=${provider} mode=${mode} repo=${repo}`);
  process.stdout.write(`SLUG=${slug}\nINSTRUMENT=${instrument}\nPROVIDER=${provider}\nMODE=${mode}\nTARGET=${repo}\n`);
  return 0;
}
```

> Implementer note: confirm the exact import names/paths against `src/commands/solo.ts` (e.g. `log`, `readField`, `isoUtc`, `haveCmd`, `kvField`) — solo imports the same helpers; copy its import lines and add the duet-specific ones. Do not invent helper modules.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/duet-cmd.test.ts`
Expected: the `init` + dispatch tests PASS (branch/round/finish verbs come in later tasks).

- [ ] **Step 5: Commit**

```bash
git add src/commands/duet.ts tests/duet-cmd.test.ts
git commit -m "feat(duet): command dispatch + init (cross-repo, fail-fast validation)"
```

---

## Task 5: `branch` verb (isolation, target from `target_cwd.txt`, single-occupancy guard)

**Files:**
- Modify: `src/commands/duet.ts`
- Test: `tests/duet-cmd.test.ts` (append)

Mirror solo's `branchWith` (solo.ts:92-113) with three deltas: target comes from `target_cwd.txt` (not `repoRoot()`); branch name is `feat/duet-<topic>`; refuse if repo B is already on a different `feat/duet-*` branch (single-occupancy). `branch` does **not** rewrite `target_cwd.txt` (init owns it).

- [ ] **Step 1: Append failing tests** (use the `Runner` fake pattern from `tests/solo-cmd.test.ts`)

```ts
// append to tests/duet-cmd.test.ts
import { branchWith } from "../src/commands/duet.js";
import type { Runner } from "../src/core/gitwork.js";
import { writeFileSync } from "node:fs";

function fakeRunner(map: Record<string, { code?: number; stdout?: string }>): Runner {
  return { run: (cmd, args) => { const key = [cmd, ...args].join(" "); const r = map[key] ?? matchPrefix(map, key); return { code: r?.code ?? 0, stdout: r?.stdout ?? "" }; } };
}
function matchPrefix(map: Record<string, { code?: number; stdout?: string }>, key: string) {
  for (const k of Object.keys(map)) if (key.startsWith(k)) return map[k]; return undefined;
}

describe("duet branch", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => h.cleanup());

  function seedInit(slug: string, repo: string) {
    const exec = duetExecDir(slug); mkdirSync(exec, { recursive: true });
    writeFileSync(join(exec, "target_cwd.txt"), repo + "\n");
    writeFileSync(join(exec, "mode.txt"), "branch\n");
  }

  it("cuts feat/duet-<slug> and records start-branch/base; rc 0", async () => {
    seedInit("t", "/abs/repoB");
    const r = fakeRunner({
      "git rev-parse --git-dir": { code: 0 },
      "git symbolic-ref --short HEAD": { stdout: "main\n" },
      "git rev-parse HEAD": { stdout: "deadbeef\n" },
      "git status --porcelain": { stdout: "" },
      "git show-ref": { code: 1 },              // branch doesn't exist yet
      "git checkout -q -b feat/duet-t": { code: 0 },
    });
    const rc = await branchWith("t", "/abs/repoB", r);
    expect(rc).toBe(0);
    expect(readFileSync(join(duetExecDir("t"), "branch.txt"), "utf8").trim()).toBe("feat/duet-t");
    expect(readFileSync(join(duetExecDir("t"), "start-branch.txt"), "utf8").trim()).toBe("main");
  });

  it("refuses when repo B is already on another feat/duet-* branch (single-occupancy); rc 1", async () => {
    seedInit("t", "/abs/repoB");
    const r = fakeRunner({
      "git rev-parse --git-dir": { code: 0 },
      "git symbolic-ref --short HEAD": { stdout: "feat/duet-other\n" },
      "git rev-parse HEAD": { stdout: "deadbeef\n" },
      "git status --porcelain": { stdout: "" },
    });
    expect(await branchWith("t", "/abs/repoB", r)).toBe(1);
  });

  it("rc 1 when target is not a git repo", async () => {
    seedInit("t", "/abs/repoB");
    const r = fakeRunner({ "git rev-parse --git-dir": { code: 1 } });
    expect(await branchWith("t", "/abs/repoB", r)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/duet-cmd.test.ts`
Expected: FAIL (`branchWith` not exported).

- [ ] **Step 3: Implement `branchRun` + `branchWith`**

```ts
// add to src/commands/duet.ts

async function branchRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: duet branch <topic>"); return 2; }
  const target = readField(join(duetExecDir(topic), "target_cwd.txt"));
  if (!target) { log.error("duet branch: target_cwd.txt missing — run duet init first"); return 1; }
  return branchWith(topic, target, runnerAt(target));
}

export async function branchWith(topic: string, target: string, r: Runner): Promise<number> {
  const snap = preSnapshot(r, "duet", topic);
  if (snap.state === "not-git") { log.error(`duet branch: ${target} is not a git repository`); return 1; }
  const branch = `feat/duet-${topic}`;
  // Single-occupancy: refuse if repo B is already on a DIFFERENT duet branch from another live session.
  if (snap.branch.startsWith("feat/duet-") && snap.branch !== branch) {
    log.error(`duet branch: ${target} is already on ${snap.branch} (another duet session?) — refusing`);
    return 1;
  }
  const onBranch = createOrResumeBranch(r, branch);
  const exec = duetExecDir(topic);
  atomicWrite(join(exec, "start-branch.txt"), snap.branch + "\n");
  atomicWrite(join(exec, "branch-base.sha"), snap.baseSha + "\n");
  atomicWrite(join(exec, "branch.txt"), branch + "\n");
  if (!onBranch) { log.warn(`duet branch: checkout ${branch} failed; staying on ${snap.branch}`); }
  log.ok(`duet branch: ${branch} (snapshot=${snap.state}, base=${snap.baseSha.slice(0, 8)})`);
  return 0;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/duet-cmd.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/duet.ts tests/duet-cmd.test.ts
git commit -m "feat(duet): branch verb — isolation in repo B + single-occupancy guard"
```

---

## Task 6: `round-send` + `round-wait` (open-ended rounds, OFFSET re-arm)

**Files:**
- Modify: `src/commands/duet.ts`
- Test: `tests/duet-cmd.test.ts` (append)

Mirror solo's `turnSendWith`/`turnWaitWith` (solo.ts:114-210). Deltas: round 1 reads the task from `art/topic-text.txt` and composes `composeDuetBrief(task, repo, branch)`; round ≥ 2 reads `exec/followup-<round>.md` (the conductor's text) and composes `composeDuetFollowup(text, round)`; state files are `round-<round>.txt` and the sent file is `round-prompt-<round>.md`. The wait event set, classifier, and the question OFFSET-bump re-arm are copied verbatim.

- [ ] **Step 1: Append failing tests**

```ts
// append to tests/duet-cmd.test.ts
import { roundSendWith, roundWaitWith } from "../src/commands/duet.js";
import type { TurnSendDeps, TurnWaitDeps } from "../src/commands/duet.js";

function seedPart(slug: string, repo: string) {
  const art = duetArtDir(slug), exec = duetExecDir(slug);
  mkdirSync(exec, { recursive: true });
  writeFileSync(join(art, "instrument.txt"), "viola\n");
  writeFileSync(join(art, "selected-provider.txt"), "codex\n");
  writeFileSync(join(art, "topic-text.txt"), "implement X");
  writeFileSync(join(exec, "target_cwd.txt"), repo + "\n");
  writeFileSync(join(exec, "branch.txt"), `feat/duet-${slug}\n`);
  // outbox must exist for the guard
  const pd = partDir("viola", "codex", slug); mkdirSync(pd, { recursive: true }); writeFileSync(join(pd, "outbox.jsonl"), "");
}

describe("duet round-send / round-wait", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => h.cleanup());

  it("round-send 1 records OFFSET and sends the composed brief", async () => {
    seedPart("t", "/abs/repoB");
    let sent: string[] | undefined;
    const deps: TurnSendDeps = { offsetFor: () => 0, send: async (a) => { sent = a; return 0; } };
    const rc = await roundSendWith("t", 1, deps);
    expect(rc).toBe(0);
    expect(readFileSync(join(duetExecDir("t"), "round-1.txt"), "utf8")).toContain("OFFSET=0");
    expect(sent?.[0]).toBe("viola");
    expect(sent?.[2]).toMatch(/^@.*round-prompt-1\.md$/);
    expect(readFileSync(join(duetExecDir("t"), "round-prompt-1.md"), "utf8")).toContain("implement X");
  });

  it("round-send 2 requires followup-2.md (rc 1 if missing)", async () => {
    seedPart("t", "/abs/repoB");
    const deps: TurnSendDeps = { offsetFor: () => 0, send: async () => 0 };
    expect(await roundSendWith("t", 2, deps)).toBe(1);
  });

  it("round-wait classifies done→ok and writes TS=ok", async () => {
    seedPart("t", "/abs/repoB");
    writeFileSync(join(duetExecDir("t"), "round-1.txt"), "OFFSET=0\n");
    const deps: TurnWaitDeps = { wait: async () => ({ event: "done", summary: "x", ts: "now" } as OutboxEvent) };
    expect(await roundWaitWith("t", 1, deps)).toBe(0);
    expect(readFileSync(join(duetExecDir("t"), "round-1.txt"), "utf8")).toContain("TS=ok");
  });

  it("round-wait on a question writes question-N.txt and APPENDS a bumped OFFSET + TS=question", async () => {
    seedPart("t", "/abs/repoB");
    writeFileSync(join(duetExecDir("t"), "round-1.txt"), "OFFSET=0\n");
    // make the outbox non-empty so the bumped offset differs
    writeFileSync(join(partDir("viola", "codex", "t"), "outbox.jsonl"), '{"event":"question","question":"?","ts":"now"}\n');
    const deps: TurnWaitDeps = { wait: async () => ({ event: "question", question: "?", ts: "now" } as unknown as OutboxEvent) };
    expect(await roundWaitWith("t", 1, deps)).toBe(0);
    const st = readFileSync(join(duetExecDir("t"), "round-1.txt"), "utf8");
    expect(st).toMatch(/TS=question/);
    expect((st.match(/OFFSET=/g) || []).length).toBe(2); // original + bumped
    expect(existsSync(join(duetExecDir("t"), "question-1.txt"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/duet-cmd.test.ts`
Expected: FAIL (`roundSendWith`/`roundWaitWith` not exported).

- [ ] **Step 3: Implement `round-send` + `round-wait`** (adapt solo.ts:114-210 verbatim, with the deltas)

```ts
// add to src/commands/duet.ts

export interface TurnSendDeps {
  offsetFor(instrument: string, model: string, topic: string): number;
  send(args: string[]): Promise<number>;
}
const DUET_TURN_TIMEOUT = Number(process.env.CONSORT_DUET_TURN_TIMEOUT) || 14400;

async function roundSendRun(rest: string[]): Promise<number> {
  const [topic, roundStr] = rest;
  const round = Number(roundStr);
  if (!topic || !Number.isInteger(round) || round < 1) { log.error("usage: duet round-send <topic> <round>=1.."); return 2; }
  return roundSendWith(topic, round, {
    offsetFor: (i, m, t) => outboxOffset(outboxPath(i, m, t)),
    send: (args) => sendRun(args),
  });
}

export async function roundSendWith(topic: string, round: number, d: TurnSendDeps): Promise<number> {
  const art = duetArtDir(topic);
  const exec = duetExecDir(topic);
  const instrument = readField(join(art, "instrument.txt"));
  const provider = readField(join(art, "selected-provider.txt"));
  if (!instrument || !provider) { log.error("duet round-send: missing instrument.txt/selected-provider.txt (run duet init)"); return 1; }

  const outbox = outboxPath(instrument, provider, topic);
  if (!existsSync(outbox)) { log.error(`duet round-send: outbox not found at ${outbox} — was ${instrument} spawned?`); return 1; }
  const sp = statusPath(instrument, provider, topic);
  if (existsSync(sp)) { const m = readFileSync(sp, "utf8").match(/"state":"([^"]*)"/); if (m && m[1] && m[1] !== "idle") { log.error(`duet round-send: part not idle (state=${m[1]}); previous round still in flight`); return 1; } }

  const stateFile = join(exec, `round-${round}.txt`);
  if (existsSync(stateFile)) { log.error(`duet round-send: ${stateFile} already exists; rm to retry`); return 1; }

  let prompt: string;
  if (round === 1) {
    const task = readIfExists(join(art, "topic-text.txt"));
    const repo = readField(join(exec, "target_cwd.txt"));
    const branch = readField(join(exec, "branch.txt")) || "the current branch";
    prompt = composeDuetBrief(task, repo, branch);
  } else {
    const bundle = join(exec, `followup-${round}.md`);
    if (!existsSync(bundle)) { log.error(`duet round-send: follow-up bundle missing: ${bundle} (the directive must write it first)`); return 1; }
    prompt = composeDuetFollowup(readFileSync(bundle, "utf8"), round);
  }

  const promptFile = join(exec, `round-prompt-${round}.md`);
  atomicWrite(promptFile, prompt);
  const offset = d.offsetFor(instrument, provider, topic);
  atomicWrite(stateFile, `OFFSET=${offset}\n`);

  const rc = await d.send([instrument, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`duet round-send: send failed (rc=${rc}); ${stateFile} kept for retry`); return 1; }
  log.ok(`duet round-send: round=${round} offset=${offset}`);
  return 0;
}

export interface TurnWaitDeps {
  wait(instrument: string, model: string, topic: string, offset: number, events: string[], timeoutSec: number): Promise<OutboxEvent | null>;
}

async function roundWaitRun(rest: string[]): Promise<number> {
  const [topic, roundStr] = rest;
  const round = Number(roundStr);
  if (!topic || !Number.isInteger(round) || round < 1) { log.error("usage: duet round-wait <topic> <round>=1.."); return 2; }
  return roundWaitWith(topic, round, { wait: (i, m, t, off, ev, to) => outboxWaitSince(i, m, t, off, ev, to) });
}

export async function roundWaitWith(topic: string, round: number, d: TurnWaitDeps): Promise<number> {
  const art = duetArtDir(topic);
  const exec = duetExecDir(topic);
  const instrument = readField(join(art, "instrument.txt"));
  const provider = readField(join(art, "selected-provider.txt"));
  if (!instrument || !provider) { log.error("duet round-wait: missing instrument.txt/selected-provider.txt"); return 1; }
  const stateFile = join(exec, `round-${round}.txt`);
  if (!existsSync(stateFile)) { log.error(`duet round-wait: ${stateFile} missing (run duet round-send first)`); return 1; }
  const offset = parseLatestOffset(readFileSync(stateFile, "utf8"));
  if (offset === null) { log.error(`duet round-wait: OFFSET not set in ${stateFile}`); return 1; }

  log.info(`duet round-wait: round=${round} offset=${offset} timeout=${DUET_TURN_TIMEOUT}s`);
  const ev = await d.wait(instrument, provider, topic, offset, ["done", "error", "question"], DUET_TURN_TIMEOUT);
  const ts = classifyTurn(ev);
  if (ts === "question" && ev) {
    atomicWrite(join(exec, `question-${round}.txt`), JSON.stringify(ev) + "\n");
    const bumped = outboxOffset(outboxPath(instrument, provider, topic));
    appendFileSync(stateFile, `OFFSET=${bumped}\nTS=question\n`);
  } else {
    appendFileSync(stateFile, `TS=${ts}\n`);
  }
  log.ok(`duet round-wait: round=${round} TS=${ts}`);
  return 0;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/duet-cmd.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/duet.ts tests/duet-cmd.test.ts
git commit -m "feat(duet): round-send/round-wait — open-ended rounds with OFFSET re-arm"
```

---

## Task 7: `relay`, `detect-test`, `finish` (fail-closed), `summary`

**Files:**
- Modify: `src/commands/duet.ts`
- Test: `tests/duet-cmd.test.ts` (append)

`finish` is the most consequential: it **fails closed** when `target_cwd.txt` is missing (no `repoRoot()` fallback), handles the `in-place` mode (no branch ops), writes `diff-stats.txt` + `finish-result.txt`, and uses a `duet:`-titled PR. `relay` is a thin send wrapper that also records which path was taken into `question-<round>.txt`. `detect-test` mirrors solo (`rest[0] || repoRoot()`; the directive always passes repo B).

- [ ] **Step 1: Read `src/commands/send.ts`** to confirm `run()`'s argument order (the directive form is `send --from maestro <INSTRUMENT> <SLUG> @<file>`). Use that exact order when calling `sendRun` from `relay`.

- [ ] **Step 2: Append failing tests**

```ts
// append to tests/duet-cmd.test.ts
import { finishWith } from "../src/commands/duet.js";

describe("duet finish", () => {
  let h: { home: string; cleanup: () => void };
  beforeEach(() => { h = freshHome(); });
  afterEach(() => h.cleanup());

  it("fails closed (rc 1) when target_cwd.txt is absent — never pushes the conductor repo", async () => {
    const { run: finishRun } = await import("../src/commands/duet.js");
    duetExecDir("t"); mkdirSync(duetExecDir("t"), { recursive: true }); // exec dir but NO target_cwd.txt
    expect(await finishRun(["finish", "t"])).toBe(1);
  });

  it("branch mode: writes diff-stats + finish-result, builds a duet: PR title", async () => {
    const exec = duetExecDir("t"); mkdirSync(exec, { recursive: true });
    writeFileSync(join(exec, "mode.txt"), "branch\n");
    writeFileSync(join(exec, "branch.txt"), "feat/duet-t\n");
    writeFileSync(join(exec, "start-branch.txt"), "main\n");
    writeFileSync(join(exec, "branch-base.sha"), "base1\n");
    writeFileSync(join(exec, "verify-result.txt"), "PASS\n");
    writeFileSync(join(duetArtDir("t"), "topic-text.txt"), "the task");
    let prTitle = "";
    const r: Runner = { run: (cmd, args) => {
      const key = [cmd, ...args].join(" ");
      if (key.startsWith("git diff --shortstat")) return { code: 0, stdout: " 1 file changed\n" };
      if (key === "git remote") return { code: 0, stdout: "origin\n" };
      if (key.startsWith("git push")) return { code: 0, stdout: "" };
      if (key.startsWith("git remote get-url")) return { code: 0, stdout: "git@x:y.git\n" };
      if (cmd === "gh") { prTitle = args[args.indexOf("--title") + 1]; return { code: 0, stdout: "" }; }
      return { code: 0, stdout: "" };
    } };
    const rc = await finishWith("t", r, true);
    expect(rc).toBe(0);
    expect(prTitle).toBe("duet: feat/duet-t");
    expect(readFileSync(join(exec, "diff-stats.txt"), "utf8")).toContain("1 file changed");
    expect(readFileSync(join(exec, "finish-result.txt"), "utf8")).toContain("pr");
  });

  it("in-place mode: no branch ops, records in-place finish-result", async () => {
    const exec = duetExecDir("t"); mkdirSync(exec, { recursive: true });
    writeFileSync(join(exec, "mode.txt"), "in-place\n");
    const r: Runner = { run: () => ({ code: 0, stdout: "" }) };
    expect(await finishWith("t", r, true)).toBe(0);
    expect(readFileSync(join(exec, "finish-result.txt"), "utf8")).toContain("in-place");
  });
});
```

- [ ] **Step 3: Implement `relay`, `detect-test`, `finish`, `summary`**

```ts
// add to src/commands/duet.ts
import { detectTestCommand } from "../core/solo.js"; // same auto-detector solo uses

async function relayRun(rest: string[]): Promise<number> {
  const [topic, roundStr, ...answerParts] = rest;
  const round = Number(roundStr);
  if (!topic || !Number.isInteger(round) || round < 1 || answerParts.length === 0) {
    log.error("usage: duet relay <topic> <round> <answer|@file>"); return 2;
  }
  const art = duetArtDir(topic);
  const instrument = readField(join(art, "instrument.txt"));
  const provider = readField(join(art, "selected-provider.txt"));
  if (!instrument || !provider) { log.error("duet relay: missing instrument/provider (run duet init)"); return 1; }
  const answer = answerParts.join(" ");
  // NOTE: round-wait already bumped OFFSET past the question; relay only sends + records.
  const rc = await sendRun(["--from", "maestro", instrument, topic, answer]); // confirm arg order vs send.ts (Step 1)
  if (rc !== 0) { log.error(`duet relay: send failed (rc=${rc})`); return 1; }
  appendFileSync(join(duetExecDir(topic), `question-${round}.txt`), `RELAYED=${answer}\n`);
  log.ok(`duet relay: round=${round} answered`);
  return 0;
}

async function detectTestRun(rest: string[]): Promise<number> {
  const cwd = rest[0] || repoRoot();
  process.stdout.write(detectTestCommand(cwd) + "\n");
  return 0;
}

async function finishRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: duet finish <topic>"); return 2; }
  const target = readField(join(duetExecDir(topic), "target_cwd.txt"));
  if (!target) { log.error("duet finish: target_cwd.txt missing/empty — refusing (will NOT fall back to the conductor repo)"); return 1; }
  return finishWith(topic, runnerAt(target), haveCmd("gh"));
}

export async function finishWith(topic: string, r: Runner, hasGh: boolean): Promise<number> {
  const exec = duetExecDir(topic);
  const mode = readField(join(exec, "mode.txt")) || "branch";
  if (mode === "in-place") {
    atomicWrite(join(exec, "finish-result.txt"), "none\tin-place (commits on the current branch)\n");
    log.ok("duet finish: in-place — commits left on the current branch");
    return 0;
  }
  const branch = readField(join(exec, "branch.txt"));
  const startBranch = readField(join(exec, "start-branch.txt")) || "main";
  const base = readField(join(exec, "branch-base.sha"));
  if (base) {
    const ds = r.run("git", ["diff", "--shortstat", `${base}..HEAD`]).stdout.trim();
    atomicWrite(join(exec, "diff-stats.txt"), (ds || "(no changes)") + "\n");
  }
  const task = readIfExists(join(duetArtDir(topic), "topic-text.txt"));
  const verify = readField(join(exec, "verify-result.txt"));
  const res = finishBranch(r, {
    branch, startBranch, hasGh,
    title: `duet: ${branch}`,
    body: `${task}\n\nVerify: ${verify}\n\n(Automated duet branch — review and merge into ${startBranch}.)`,
  });
  atomicWrite(join(exec, "finish-result.txt"), `${res.action}\t${res.outcome}\n`);
  log.ok(`duet finish: ${res.action} → ${res.outcome}`);
  return 0;
}

async function summaryRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: duet summary <topic> [--aborted <phase> <gate> <reason...>]"); return 2; }
  const art = duetArtDir(topic);
  const exec = duetExecDir(topic);
  const started = kvField(join(art, "timing.txt"), "started") || "unknown";
  let ended: string | undefined, duration: number | undefined;
  const i = rest.indexOf("--aborted");
  const aborted = i >= 0;
  if (!aborted) {
    ended = isoUtc();
    const s = Date.parse(started), e = Date.parse(ended);
    duration = Number.isFinite(s) && Number.isFinite(e) ? Math.round((e - s) / 1000) : 0;
    atomicWrite(join(art, "timing.txt"), `started=${started}\nended=${ended}\nduration=${duration}\n`);
  }
  // count rounds = highest round-<n>.txt present
  let rounds = 0; for (let n = 1; n < 1000; n++) { if (existsSync(join(exec, `round-${n}.txt`))) rounds = n; else if (n > rounds + 2) break; }

  const facts: DuetSummaryFacts = {
    topic, status: aborted ? "aborted" : "ok", started, ended, duration,
    provider: readField(join(art, "selected-provider.txt")) || "unknown",
    instrument: readField(join(art, "instrument.txt")) || "unknown",
    repo: readField(join(exec, "target_cwd.txt")) || "<repo>",
    mode: readField(join(exec, "mode.txt")) || "branch",
    branch: readField(join(exec, "branch.txt")) || "(none)",
    rounds,
    verify: readField(join(exec, "verify-result.txt")) || "unknown",
    diffStats: readField(join(exec, "diff-stats.txt")) || "unknown",
    archived: readField(join(art, "archived-path.txt")) || "(not archived)",
    finishResult: readField(join(exec, "finish-result.txt")) || "(not finished)",
    abortedPhase: aborted ? rest[i + 1] : undefined,
    abortedGate: aborted ? rest[i + 2] : undefined,
    abortedReason: aborted ? rest.slice(i + 3).join(" ") || "unknown" : undefined,
  };
  atomicWrite(join(art, "SUMMARY.md"), renderDuetSummary(facts));
  if (aborted) {
    atomicWrite(join(art, "RESUME.md"), renderDuetResume({
      topic, repo: facts.repo, branch: facts.branch, mode: facts.mode, lastRound: rounds,
      task: readIfExists(join(art, "topic-text.txt")),
      phase: facts.abortedPhase ?? "unknown", gate: facts.abortedGate ?? "unknown",
    }));
  }
  log.ok(`duet summary: wrote ${join(art, "SUMMARY.md")}`);
  return 0;
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run tests/duet-cmd.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/commands/duet.ts tests/duet-cmd.test.ts
git commit -m "feat(duet): relay + detect-test + finish (fail-closed) + summary"
```

---

## Task 8: Register `duet` in the CLI dispatcher

**Files:**
- Modify: `src/consort.ts`

- [ ] **Step 1: Add the import and map entry** in `loadHandlers()` (src/consort.ts:7-21)

Add `import("./commands/duet.js")` to the `Promise.all([...])` array, add `duet` to the destructured tuple, and add `duet: duet.run` to the returned record. (No other wiring — `--mint-args-file`/`--args-file` already apply to every subcommand.)

- [ ] **Step 2: Verify dispatch end-to-end** (no test file needed; use the existing suite + a smoke run)

Run: `npm run typecheck && npx vitest run`
Expected: typecheck clean; full suite green.

Run: `npx tsx src/consort.ts duet` (or `node` against a temp build) — Expected: prints the duet usage line and exits rc 2. (If `tsx` is unavailable, skip; Task 10's built smoke covers it.)

- [ ] **Step 3: Commit**

```bash
git add src/consort.ts
git commit -m "feat(duet): register duet in the CLI dispatcher"
```

---

## Task 9: `commands/duet.md` directive

**Files:**
- Create: `commands/duet.md`

This is the conductor's brain — the open-ended loop, judgment relay, and finish. Auto-discovered (no manifest entry). Write it in full (no placeholders). Mirror `commands/solo.md` structure, with the duet loop.

- [ ] **Step 1: Write `commands/duet.md`**

````markdown
---
description: Collaborative cross-repo session — open one persistent claude/codex part in ANOTHER repo and co-develop with it over open-ended rounds, relaying questions both ways with you, finishing as a PR in that repo.
argument-hint: --repo <abs-repo-path> <opening task> [--provider codex|claude|agy|opencode] [--in-place]
allowed-tools: Bash, Write, Read, Edit, AskUserQuestion
---

# /consort:duet

Open ONE persistent part in the repo named by `--repo` (repo B) and collaborate with it over as many
rounds as the work needs. You (the conductor) stay in your own repo (repo A); the part edits repo B.
Use **judgment** on the part's questions: answer the ones you can confidently handle from context;
pull in the human via AskUserQuestion only for real decisions (taste, scope, ambiguous trade-offs).

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

## Flagging suspicions

At any point, if something looks off, record it: `$CS duet flag <SLUG> "<what looked off>"`. It writes
straight to the playback feed (survives teardown and aborts) and costs nothing. Review with `/consort:playback`.

## Stage 0 — Init

1. Mint an args path and write `$ARGUMENTS` into it:
   - Run: `$CS duet --mint-args-file` → prints `<args-path>`.
   - **Write tool:** `file_path` = `<args-path>`, `content` = `$ARGUMENTS` (verbatim, unquoted).
2. Init: `$CS duet init --args-file <args-path>`. On success it prints (stdout is clean; logs go to stderr):
   ```
   SLUG=<slug>
   INSTRUMENT=<instrument>
   PROVIDER=<provider>
   MODE=<branch|in-place>
   TARGET=<repo-B-abs-path>
   ```
   Capture each value. Non-zero exit aborts: rc 1 = bad/empty task or bad `--repo`, rc 2 = topic already
   in flight, rc 3 = provider not installed. No SUMMARY is written (state dir was never created).

## Stage 1 — Branch + spawn + open

1. If `MODE=branch`: `$CS duet branch <SLUG>`. On **rc 1** (not a git repo, or repo B already on another
   `feat/duet-*` branch) → abort: `$CS duet summary <SLUG> --aborted setup branch "<reason>"`, print the
   SUMMARY, stop. (No part spawned, so no `coda`.) If `MODE=in-place`: skip branch entirely.
2. Spawn the part **in repo B** (NO initial prompt — the brief is round 1):
   `$CS spawn <INSTRUMENT> <PROVIDER> <SLUG> --cwd <TARGET>`. On **rc 1** (bootstrap failed) → abort:
   `$CS duet summary <SLUG> --aborted setup spawn-failed "part failed bootstrap"`, print SUMMARY, stop.
   Do **not** run `coda` — `spawn` already FAILED-archived the part.
3. Dispatch round 1: `$CS duet round-send <SLUG> 1`, then await it in the background:
   ```
   Bash(command='$CS duet round-wait <SLUG> 1', run_in_background: true, description='duet await round 1')
   ```

## Stage 2 — The collaboration loop (open-ended)

For the current `<ROUND>` (starting at 1), on each completion notification read the **last** `TS=` line
from `<SLUG state>/_duet/execute/round-<ROUND>.txt` and branch:

- **`TS=ok`** → the part finished this round. Review its work: read its outbox and run
  `git -C <TARGET> diff` to see the changes. Then decide:
  - **More to do** → choose the next round number `<N>` = `<ROUND>+1`. **Write**
    `<SLUG state>/_duet/execute/followup-<N>.md` with your refinement/next instruction, then
    `$CS duet round-send <SLUG> <N>` and background `$CS duet round-wait <SLUG> <N>`. Set `<ROUND>=<N>`.
  - **Done** → if it looks complete, confirm with the human (a short AskUserQuestion or a direct
    question). On confirmation → go to Stage 3.
- **`TS=question`** → read `execute/question-<ROUND>.txt`. **Judgment:**
  - Answerable from context (a path, a naming convention, an obvious clarification) → answer it yourself:
    `$CS duet relay <SLUG> <ROUND> "<your answer>"` (or `@<reply-file>` for long answers), then re-arm the
    background `$CS duet round-wait <SLUG> <ROUND>`.
  - A real decision (taste, scope, an ambiguous trade-off) → **AskUserQuestion** the human, then relay
    their answer: `$CS duet relay <SLUG> <ROUND> "<human's answer>"`, then re-arm the wait.
  The re-arm resumes past the handled question automatically (round-wait appended a bumped `OFFSET=`).
- **`TS=failed` or `TS=timeout`** → tell the human; offer to (a) re-arm the same round once more, or
  (b) abort: `$CS duet summary <SLUG> --aborted round round-wait "part round failed (TS=<ts>)"`, then
  `$CS coda <INSTRUMENT> <SLUG>`, print SUMMARY, stop.

At any round you may also need a call the part didn't ask for — use AskUserQuestion directly, then
continue.

## Stage 3 — Verify + finish

1. Verify (advisory): `TEST_CMD=$($CS duet detect-test <TARGET>)`. If non-empty, run it once in `<TARGET>`,
   tee to `execute/verify-1.log`; set `VERIFY` to `PASS (<cmd>)` / `FAIL (<cmd>)`. If empty,
   `VERIFY="skipped (no test command detected)"`. A FAIL does not block finish — you may open one more
   round to fix it (your judgment), or proceed.
2. Record the verify result so finish can embed it in the PR body:
   ```bash
   printf '%s\n' "$VERIFY" > <SLUG state>/_duet/execute/verify-result.txt
   ```
3. Finish (branch mode → push + PR in repo B, or local commit if no remote; in-place → leaves commits on
   the current branch): `$CS duet finish <SLUG>`.

## Stage 4 — Teardown + SUMMARY

1. **Forensics + reflection (BEFORE teardown):** `FORENSICS=$($CS duet forensics <SLUG>)`. If non-empty,
   tell the user "forensics captured: $FORENSICS", **Read** it and **append** a `## Maestro reflection`
   section (idempotent: skip if the file already contains the exact header `## Maestro reflection`).
2. Tear down + archive the part:
   ```bash
   ARCHIVED=$($CS coda <INSTRUMENT> <SLUG> 2>&1 | sed -n 's/.*archived [^:]*: //p' | tail -1)
   [ -n "$ARCHIVED" ] && printf '%s\n' "$ARCHIVED" > <SLUG state>/_duet/archived-path.txt
   ```
3. `$CS duet summary <SLUG>` — writes `SUMMARY.md`. Then print it: `cat <SLUG state>/_duet/SUMMARY.md`.

## Notes

- One part, one repo (repo B), open-ended rounds. This is NOT the retired multi-repo subsystem — no
  discovery, no `--targets`, no DAG.
- State lives under YOUR (conductor) repo hash; the part just works in repo B via `--cwd`.
- `<SLUG state>` = `<repo-A>/.consort/state/<hash>/<SLUG>` (the conductor's state tree).
````

- [ ] **Step 2: Confirm the stale-token gate stays green**

Run: `npx vitest run tests/stale-tokens.test.ts`
Expected: PASS (no `commander`/`trooper`/`cw_`/etc. in the new files).

- [ ] **Step 3: Commit**

```bash
git add commands/duet.md
git commit -m "feat(duet): conductor directive — open-ended collaborative loop"
```

---

## Task 10: Version bump + build + commit dist

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
- Rebuild: `dist/consort.cjs`

- [ ] **Step 1: Bump the version** in all three manifests from the current `0.1.x` to the next patch (check `package.json` for the current value, e.g. `0.1.26` → `0.1.27`). All three must match: `package.json:version`, `.claude-plugin/plugin.json:version`, `.claude-plugin/marketplace.json:plugins[0].version`.

- [ ] **Step 2: Run the full gate suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green (typecheck clean, lint clean, all tests pass including the new duet suites and the stale-token gate).

- [ ] **Step 3: Build the bundle**

Run: `npm run build`
Expected: writes `dist/consort.cjs`.

- [ ] **Step 4: Smoke-test the built bundle**

Run: `node dist/consort.cjs duet`
Expected: prints the duet usage line, exit rc 2. (Confirms `duet` is registered in the bundle.)

- [ ] **Step 5: Confirm a deterministic rebuild** (the dist must be reproducible)

Run: `node dist/consort.cjs duet >/dev/null; sha256sum dist/consort.cjs; npm run build >/dev/null 2>&1; sha256sum dist/consort.cjs`
Expected: identical SHA before/after the second build.

- [ ] **Step 6: Commit**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "chore(duet): build dist + bump version for /consort:duet"
```

---

## Final verification (before opening the PR)

- [ ] `npm run typecheck && npm run lint && npm run test` — all green.
- [ ] `git grep -nE "detectMultiRepo|--targets|DocMode|Execution DAG" src commands | grep -i duet` — empty (duet introduced none).
- [ ] `node dist/consort.cjs duet init --repo /nonexistent "x"` → rc 1 (fail-fast validation works in the bundle).
- [ ] The spec's acceptance criteria #1–#5 are mechanically satisfied; #6–#7 are dogfood-observed (run a live duet from one repo into another, with one relayed question, and confirm a `feat/duet-<slug>` PR + restored start branch).
- [ ] Hand off to `superpowers:finishing-a-development-branch` to open the PR.
