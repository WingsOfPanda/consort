# Consort Port-Parity Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 11 behavioral gaps from the 2026-05-31 clone-wars → consort port audit, restoring full clone-wars parity across `score`, `rehearsal`, `perform`, `solo`, and the shared `gitwork.preSnapshot` helper.

**Architecture:** Hybrid (per the spec). Pure logic and atomic state mutation land in tested `core/*` modules and new CLI verbs (DI verb pattern: `<verb>Run` parses args → delegates; `*With(args, deps)` holds testable logic); AskUserQuestion prompts and multi-step orchestration land in the `commands/*.md` directives.

**Tech Stack:** TypeScript/ESM (NodeNext, `.js` import suffixes), vitest, esbuild → committed `dist/consort.cjs`, execa (tmux only). Tests isolate via `CONSORT_HOME` temp dirs (`tests/helpers/tmpHome.ts:freshHome`).

**Reference:** design spec `docs/superpowers/specs/2026-05-31-consort-port-parity-design.md`; behavioral source `/home/liupan/CC/clone-wars` (grep by symbol).

---

## Execution notes (read first)

- **Run tasks SEQUENTIALLY.** Most tasks touch shared files (`src/commands/score.ts`, `src/commands/perform.ts`, `src/core/solo.ts`); do not parallelize implementers.
- **`dist/` is rebuilt ONCE in the final task** (Task 12), not per task. Intermediate tasks commit `src/`/`tests/`/`config/` only. This avoids 11 noisy `dist` diffs; Task 12 runs the single `npm run build`, the full suite, and the dogfood against the rebuilt bundle.
- **Stale-token gate** (`tests/stale-tokens.test.ts`) scans `config/`. Any ported config file (Tasks 2, 4) MUST be scrubbed: `clone-wars`→`consort`, `cw_`→drop, `trooper`→`part`, `commander`→`instrument`, `master-yoda`→`maestro`, `Yoda`/`Jedi`/`general`→`Maestro`, `MISSION ACCOMPLISHED`→`FINE`. After writing each config file, run `grep -niE 'general|jedi|trooper|commander|yoda|clone-wars|cw_' <file>` and confirm it is empty.
- **Per-task gates:** `npm run typecheck && npm run test && npm run lint` green before each commit.

---

## Task 1: Shared — `gitwork.preSnapshot` command label (#11)

**Files:**
- Modify: `src/core/gitwork.ts:32,40` (signature + commit message)
- Modify: `src/commands/solo.ts:91` (caller)
- Modify: `src/commands/perform.ts:206` (caller)
- Test: `tests/solo-gitwork.test.ts`

- [ ] **Step 1: Update the existing message-keyed test + add a perform mirror**

In `tests/solo-gitwork.test.ts`, the four `preSnapshot(r, "auth")` calls (lines ~38, 55, 65, 69) become `preSnapshot(r, "solo", "auth")`. Update the hook-blocked test's reply key and add a perform mirror test:

```ts
  it("hook-blocked: commit fails, falls back to pre-attempt HEAD, not fatal", () => {
    const { r } = fakeRunner({
      "git rev-parse --git-dir": { code: 0, stdout: ".git" },
      "git symbolic-ref --short HEAD": { code: 0, stdout: "main" },
      "git rev-parse HEAD": { code: 0, stdout: "pre999" },
      "git status --porcelain": { code: 0, stdout: " M a.ts" },
      "git commit -q -m chore: WIP before solo auth": { code: 1, stdout: "" },
    });
    expect(preSnapshot(r, "solo", "auth")).toEqual({ branch: "", baseSha: "pre999", state: "hook-blocked" });
  });

  it("threads the command label into the WIP message (perform)", () => {
    const { r } = fakeRunner({
      "git rev-parse --git-dir": { code: 0, stdout: ".git" },
      "git symbolic-ref --short HEAD": { code: 0, stdout: "main" },
      "git rev-parse HEAD": { code: 0, stdout: "pre999" },
      "git status --porcelain": { code: 0, stdout: " M a.ts" },
      "git commit -q -m chore: WIP before perform auth": { code: 1, stdout: "" },
    });
    expect(preSnapshot(r, "perform", "auth")).toEqual({ branch: "", baseSha: "pre999", state: "hook-blocked" });
  });
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm run test -- solo-gitwork`
Expected: FAIL (signature mismatch — `preSnapshot` still takes 2 args / message says `solo`).

- [ ] **Step 3: Implement**

`src/core/gitwork.ts:32` — add `command` before `topic`:
```ts
export function preSnapshot(r: Runner, command: string, topic: string): SnapshotResult {
```
`src/core/gitwork.ts:40` — message:
```ts
  if (r.run("git", ["commit", "-q", "-m", `chore: WIP before ${command} ${topic}`]).code !== 0) {
```
`src/commands/solo.ts:91` — `preSnapshot(r, "solo", topic)`.
`src/commands/perform.ts:206` — `preSnapshot(runnerFor(cwd), "perform", topic)`.

- [ ] **Step 4: Run tests — verify pass + typecheck**

Run: `npm run test -- solo-gitwork && npm run typecheck`
Expected: PASS (both callers updated, both message variants asserted).

- [ ] **Step 5: Commit**

```bash
git add src/core/gitwork.ts src/commands/solo.ts src/commands/perform.ts tests/solo-gitwork.test.ts
git commit -m "fix(gitwork): preSnapshot WIP message names the running command (#11)"
```

---

## Task 2: score — skill-hints injection (#1)

**Files:**
- Create: `src/core/scoreSkill.ts`
- Create: `config/skill-hints/brainstorming.md`, `config/skill-hints/systematic-debugging.md`, `config/skill-hints/none.md`
- Modify: `src/commands/score.ts` (init writes `skill.txt`; `researchSendWith`/`verifySendWith` append the hint)
- Test: `tests/score-skill.test.ts` (new), `tests/score-init.test.ts` (extend)

- [ ] **Step 1: Write failing classifier + append tests**

Create `tests/score-skill.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyTopic, skillHintAppend } from "../src/core/scoreSkill.js";

describe("score classifyTopic", () => {
  it("brainstorming triggers", () => {
    expect(classifyTopic("how should we structure the cache?")).toBe("brainstorming");
    expect(classifyTopic("decide between LRU and LFU")).toBe("brainstorming");
    expect(classifyTopic("what's the best way to shard?")).toBe("brainstorming");
    expect(classifyTopic("which design patterns fit here")).toBe("brainstorming");
  });
  it("systematic-debugging triggers", () => {
    expect(classifyTopic("why is the build failing?")).toBe("systematic-debugging");
    expect(classifyTopic("login is broken on edge cases")).toBe("systematic-debugging");
    expect(classifyTopic("the parser doesn't work")).toBe("systematic-debugging");
  });
  it("brainstorming wins ties", () => {
    expect(classifyTopic("why is this design pattern best")).toBe("brainstorming");
  });
  it("bare design/structure/approach do NOT trigger", () => {
    expect(classifyTopic("the design")).toBe("none");
    expect(classifyTopic("system structure approach")).toBe("none");
    expect(classifyTopic("")).toBe("none");
  });
});

describe("score skillHintAppend", () => {
  const saved = process.env.CLAUDE_PLUGIN_ROOT;
  const savedOv = process.env.CONSORT_SCORE_SKILL_OVERRIDE;
  afterEach(() => {
    if (saved === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = saved;
    if (savedOv === undefined) delete process.env.CONSORT_SCORE_SKILL_OVERRIDE; else process.env.CONSORT_SCORE_SKILL_OVERRIDE = savedOv;
  });
  function root(): string {
    const r = mkdtempSync(join(tmpdir(), "sk-"));
    mkdirSync(join(r, "config", "skill-hints"), { recursive: true });
    writeFileSync(join(r, "config", "skill-hints", "brainstorming.md"), "HINT-BRAIN\n");
    return r;
  }
  it("appends the hint file when skill.txt names a real skill", () => {
    const r = root(); process.env.CLAUDE_PLUGIN_ROOT = r; delete process.env.CONSORT_SCORE_SKILL_OVERRIDE;
    const st = join(r, "skill.txt"); writeFileSync(st, "brainstorming\n");
    expect(skillHintAppend(st, "BASE")).toBe("BASE\n\n---\n\nHINT-BRAIN\n");
    rmSync(r, { recursive: true, force: true });
  });
  it("returns base unchanged when skill is none, file missing, or override=none", () => {
    const r = root(); process.env.CLAUDE_PLUGIN_ROOT = r;
    const none = join(r, "n.txt"); writeFileSync(none, "none\n");
    expect(skillHintAppend(none, "BASE")).toBe("BASE");
    const dbg = join(r, "d.txt"); writeFileSync(dbg, "systematic-debugging\n"); // hint file absent
    expect(skillHintAppend(dbg, "BASE")).toBe("BASE");
    const brain = join(r, "b.txt"); writeFileSync(brain, "brainstorming\n");
    process.env.CONSORT_SCORE_SKILL_OVERRIDE = "none";
    expect(skillHintAppend(brain, "BASE")).toBe("BASE");
    rmSync(r, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npm run test -- score-skill`
Expected: FAIL ("Cannot find module ../src/core/scoreSkill.js").

- [ ] **Step 3: Implement `src/core/scoreSkill.ts`**

```ts
// src/core/scoreSkill.ts — topic→skill classification + per-prompt skill-hint append.
// Port of clone-wars cw_consult_classify_topic / cw_consult_skill_hint_append (lib/consult.sh).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BRAINSTORMING = ["design patterns?", "how should", "best way", "what s the best way", "what is the best way", "decide between"];
const DEBUGGING = ["why", "broken", "failing", "regressions?", "edge cases?", "bugs?", "doesn t work", "does not work"];

function fence(topic: string): string {
  return " " + topic.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}
function matchAny(fenced: string, triggers: string[]): boolean {
  return triggers.some((t) => new RegExp(" " + t + " ").test(fenced)); // triggers are controlled literals; `?` = optional plural
}
/** brainstorming | systematic-debugging | none. brainstorming wins ties (tested first). */
export function classifyTopic(topic: string): "brainstorming" | "systematic-debugging" | "none" {
  const f = fence(topic);
  if (matchAny(f, BRAINSTORMING)) return "brainstorming";
  if (matchAny(f, DEBUGGING)) return "systematic-debugging";
  return "none";
}

function pluginRoot(): string { return process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd(); }
/** Append config/skill-hints/<skill>.md to basePrompt. Base unchanged when none/missing/override. */
export function skillHintAppend(skillTxtPath: string, basePrompt: string): string {
  let skill = "none";
  if (existsSync(skillTxtPath)) skill = readFileSync(skillTxtPath, "utf8").replace(/\s/g, "");
  if (process.env.CONSORT_SCORE_SKILL_OVERRIDE === "none") skill = "none";
  if (skill !== "brainstorming" && skill !== "systematic-debugging") return basePrompt;
  const hintFile = join(pluginRoot(), "config", "skill-hints", `${skill}.md`);
  if (!existsSync(hintFile)) return basePrompt;
  return `${basePrompt}\n\n---\n\n${readFileSync(hintFile, "utf8")}`;
}
```

- [ ] **Step 4: Port the 3 skill-hint config files (scrubbed)**

Read `/home/liupan/CC/clone-wars/config/skill-hints/brainstorming.md` and write its content to `config/skill-hints/brainstorming.md`, applying these substitutions everywhere: `the Jedi general`→`the Maestro`, `the general`/`the GENERAL`→`the Maestro`, `GENERAL`→`Maestro`, any `Yoda`→`Maestro`. Do the same for `systematic-debugging.md`. Keep the `superpowers:brainstorming` / `superpowers:systematic-debugging` skill references verbatim. Create `config/skill-hints/none.md` as an empty file.

Verify: `grep -niE 'general|jedi|trooper|commander|yoda|clone-wars|cw_' config/skill-hints/` returns nothing.

- [ ] **Step 5: Wire into score.ts**

`src/commands/score.ts` — add import: `import { classifyTopic, skillHintAppend } from "../core/scoreSkill.js";`
In `initWith`, after the `topic.txt` write (~line 105) add:
```ts
  atomicWrite(join(art, "skill.txt"), classifyTopic(topicText));
```
In `researchSendWith` change the prompt write (~line 228) to:
```ts
  atomicWrite(promptFile, skillHintAppend(join(art, "skill.txt"), composeResearchPrompt(topicText, findingsPath)));
```
In `verifySendWith` change the prompt write (~line 346) to:
```ts
  atomicWrite(promptFile, skillHintAppend(join(art, "skill.txt"), composeVerifyPrompt(items, verifyPath)));
```

- [ ] **Step 6: Extend `tests/score-init.test.ts`**

Add inside the init describe block (reuses the existing `deps()`/`scoreArtDir`):
```ts
it("writes skill.txt classified from the topic text", async () => {
  await initWith(["why", "is", "login", "broken"], deps(["codex", "claude"], ["viola", "cello"]));
  const art = scoreArtDir("why-is-login-broken");
  expect(readFileSync(join(art, "skill.txt"), "utf8")).toBe("systematic-debugging");
});
```

- [ ] **Step 7: Run all + lint**

Run: `npm run test -- score-skill score-init && npm run typecheck && npm run lint`
Expected: PASS. Also confirm the full suite stale-token test stays green: `npm run test -- stale-tokens`.

- [ ] **Step 8: Commit**

```bash
git add src/core/scoreSkill.ts config/skill-hints src/commands/score.ts tests/score-skill.test.ts tests/score-init.test.ts
git commit -m "feat(score): topic skill classification + per-prompt skill-hint injection (#1)"
```

---

## Task 3: score — offset-reset clean-retry primitive (#4)

**Files:**
- Modify: `src/core/score.ts` (add `cascadeTargets`)
- Modify: `src/commands/score.ts` (add `offsetResetRun` + dispatch `case` + `usage()`)
- Test: `tests/score-offset-reset.test.ts` (new)

- [ ] **Step 1: Write failing test** — create `tests/score-offset-reset.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { scoreArtDir } from "../src/core/score.js";
import { partDir } from "../src/core/paths.js";
import { offsetResetRun } from "../src/commands/score.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

describe("score offset-reset", () => {
  it("research: removes state+question+findings+cascade; keeps verify.md", async () => {
    const art = scoreArtDir("t"); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "research-viola.txt"), "OFFSET=5\n");
    writeFileSync(join(art, "research-viola.done"), "ok\n");
    writeFileSync(join(art, "question-viola.txt"), "{}\n");
    writeFileSync(join(art, "diff.md"), "x\n");
    writeFileSync(join(art, "viola_only_items.txt"), "x\n");
    writeFileSync(join(art, "cello_only_items.txt"), "x\n");
    writeFileSync(join(art, "adjudicated-draft.md"), "x\n");
    const pd = partDir("viola", "codex", "t"); mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "findings.md"), "stale\n");
    writeFileSync(join(pd, "verify.md"), "keep\n");

    expect(await offsetResetRun(["t", "viola", "research"])).toBe(0);
    for (const f of ["research-viola.txt", "research-viola.done", "question-viola.txt", "diff.md", "viola_only_items.txt", "cello_only_items.txt", "adjudicated-draft.md"])
      expect(existsSync(join(art, f))).toBe(false);
    expect(existsSync(join(pd, "findings.md"))).toBe(false);
    expect(existsSync(join(pd, "verify.md"))).toBe(true);
  });

  it("--keep-findings: removes only state+question, keeps cascade+part files", async () => {
    const art = scoreArtDir("t"); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "verify-viola.txt"), "OFFSET=2\n");
    writeFileSync(join(art, "question-viola.txt"), "{}\n");
    writeFileSync(join(art, "adjudicated-draft.md"), "x\n");
    const pd = partDir("viola", "codex", "t"); mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "verify.md"), "keep\n");
    expect(await offsetResetRun(["t", "viola", "verify", "--keep-findings"])).toBe(0);
    expect(existsSync(join(art, "verify-viola.txt"))).toBe(false);
    expect(existsSync(join(art, "question-viola.txt"))).toBe(false);
    expect(existsSync(join(art, "adjudicated-draft.md"))).toBe(true);
    expect(existsSync(join(pd, "verify.md"))).toBe(true);
  });

  it("bad phase → 2; missing art → 1; idempotent on empty art → 0", async () => {
    expect(await offsetResetRun(["t", "viola", "bogus"])).toBe(2);
    expect(await offsetResetRun(["t", "viola", "research"])).toBe(1);
    mkdirSync(scoreArtDir("t"), { recursive: true });
    expect(await offsetResetRun(["t", "viola", "research"])).toBe(0);
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `npm run test -- score-offset-reset`
Expected: FAIL (`offsetResetRun` not exported).

- [ ] **Step 3: Add `cascadeTargets` to `src/core/score.ts`**

```ts
export type ResetPhase = "research" | "verify";
/** Files a clean-retry must invalidate. Globs/files are art-dir relative; partFile is part-dir relative.
 *  Port of consult-offset-reset.sh, generalized to dynamic instruments (glob, not hardcoded rex/cody). */
export function cascadeTargets(phase: ResetPhase, keepFindings: boolean): { partFile: "findings.md" | "verify.md"; artGlobs: string[]; artFiles: string[]; } {
  const partFile = phase === "research" ? "findings.md" : "verify.md";
  if (keepFindings) return { partFile, artGlobs: [], artFiles: [] };
  if (phase === "research") return { partFile, artGlobs: ["*_only_items.txt", "*_only.txt", "consensus.txt"], artFiles: ["adjudicated-draft.md", "diff.md"] };
  return { partFile, artGlobs: [], artFiles: ["adjudicated-draft.md"] };
}
```

- [ ] **Step 4: Add `offsetResetRun` to `src/commands/score.ts`**

Ensure `topicDir` is imported from `../core/paths.js` (add it alongside `partDir`), and `cascadeTargets`/`ResetPhase` from `../core/score.js`. Add `rmSync`/`readdirSync`/`existsSync`/`statSync` to the `node:fs` import if not present.

```ts
export async function offsetResetRun(rest: string[]): Promise<number> {
  const keepFindings = rest.includes("--keep-findings");
  const pos = rest.filter((t) => !t.startsWith("--"));
  const [topic, instrument, phase] = pos;
  if (!topic || !instrument || !phase) { log.error("usage: score offset-reset <topic> <instrument> <phase> [--keep-findings]"); return 2; }
  if (phase !== "research" && phase !== "verify") { log.error(`score offset-reset: phase must be research|verify (got ${phase})`); return 2; }
  const art = scoreArtDir(topic);
  if (!existsSync(art)) { log.error(`score offset-reset: art dir missing: ${art}`); return 1; }

  // Always removed (independent of --keep-findings):
  for (const f of [`${phase}-${instrument}.txt`, `${phase}-${instrument}.done`, `question-${instrument}.txt`])
    rmSync(join(art, f), { force: true });

  const c = cascadeTargets(phase as ResetPhase, keepFindings);
  if (!keepFindings) {
    // part-owned findings.md/verify.md across <instrument>-<model> dirs
    const td = topicDir(topic);
    if (existsSync(td)) for (const name of readdirSync(td))
      if (name.startsWith(`${instrument}-`)) rmSync(join(td, name, c.partFile), { force: true });
    // exact art files
    for (const f of c.artFiles) rmSync(join(art, f), { force: true });
    // glob art files
    const names = readdirSync(art);
    for (const g of c.artGlobs) { const re = new RegExp("^" + g.replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$"); for (const n of names) if (re.test(n)) rmSync(join(art, n), { force: true }); }
  }
  log.ok(`score offset-reset: ${phase}/${instrument}${keepFindings ? " (kept findings)" : ""}`);
  return 0;
}
```

Wire the dispatcher: in `run()`'s `switch (verb)` add `case "offset-reset": return offsetResetRun(rest);` and add `offset-reset` to the `usage()` string.

- [ ] **Step 5: Run — verify pass**

Run: `npm run test -- score-offset-reset && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/score.ts src/commands/score.ts tests/score-offset-reset.test.ts
git commit -m "feat(score): offset-reset clean-retry primitive with cascade (#4)"
```

---

## Task 4: rehearsal — shared lib-seed (#2)

**Files:**
- Create: `config/rehearsal-lib-seed/arena.py`, `config/rehearsal-lib-seed/__init__.py`, `config/rehearsal-lib-seed/README.md`
- Modify: `src/core/rehearsal.ts` (add `seedLib`)
- Modify: `src/commands/rehearsal.ts` (`RehearsalInitDeps.configRoot`, `liveInitDeps`, call `seedLib` in `initWith`)
- Test: `tests/rehearsal-cmd.test.ts` (extend)

- [ ] **Step 1: Port the 3 seed files (scrubbed)**

Read `/home/liupan/CC/clone-wars/config/deep-research-lib-seed/arena.py` and write to `config/rehearsal-lib-seed/arena.py`, scrubbing: line 1 `troopers`→`parts`; line 3 `trooper experiments`→`part experiments`; any `<art-dir>/_deep-research/lib` path → `<art-dir>/lib`; any `Yoda`→`Maestro`. Keep the function `arena_color_rotated(...)` body byte-for-byte (pure stdlib). Create `config/rehearsal-lib-seed/__init__.py` as empty. Read `/home/liupan/CC/clone-wars/config/deep-research-lib-seed/README.md` → write to `config/rehearsal-lib-seed/README.md` scrubbing: title `_deep-research/lib/ — shared trooper utilities`→`lib/ — shared part utilities`; `conductor-shipped helpers for deep-research trooper experiments`→`Maestro-shipped helpers for rehearsal part experiments`; `<other-cmdr>`→`<other-instrument>`; `ask Yoda to promote`→`ask the Maestro to promote`; drop the `(v0.53.0)` version tags.

Verify: `grep -niE 'general|jedi|trooper|commander|yoda|clone-wars|cw_|deep-research' config/rehearsal-lib-seed/` returns nothing.

- [ ] **Step 2: Write failing test** — extend `tests/rehearsal-cmd.test.ts` inside `describe("rehearsal init")`:

```ts
it("seeds <art>/lib/ from config/rehearsal-lib-seed", async () => {
  const h = freshHome();
  try {
    const rc = await initWith(["seed lib topic"], okDeps({ configRoot: () => process.cwd(), opts: { home: h.home, cwd: h.home } }));
    expect(rc).toBe(0);
    const art = rehearsalArtDir("seed-lib-topic", { home: h.home, cwd: h.home });
    for (const f of ["arena.py", "__init__.py", "README.md"]) expect(existsSync(join(art, "lib", f))).toBe(true);
    expect(readFileSync(join(art, "lib", "arena.py"), "utf8")).toContain("def arena_color_rotated");
  } finally { h.cleanup(); }
});
```
(Update the local `okDeps(...)` helper to accept/forward a `configRoot` field; for cases that don't set it, default `configRoot: () => process.cwd()`.)

- [ ] **Step 3: Run — verify fail**

Run: `npm run test -- rehearsal-cmd`
Expected: FAIL (no `lib/` seeded; `configRoot` dep unknown).

- [ ] **Step 4: Implement `seedLib` in `src/core/rehearsal.ts`**

Add (import `existsSync, mkdirSync, readdirSync, statSync, copyFileSync` from `node:fs` and `join`):
```ts
/** Copy config/rehearsal-lib-seed/* into <art>/lib/ (skip-if-exists, never throws). Port of cw_deep_research_seed_lib. */
export function seedLib(art: string, configRoot: string): void {
  try {
    const seedDir = join(configRoot, "config", "rehearsal-lib-seed");
    if (!existsSync(seedDir)) return;
    const dest = join(art, "lib");
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(seedDir)) {
      const src = join(seedDir, name);
      if (!statSync(src).isFile()) continue;
      const target = join(dest, name);
      if (!existsSync(target)) copyFileSync(src, target);
    }
  } catch { /* best-effort; never fatal to init */ }
}
```

- [ ] **Step 5: Wire into `src/commands/rehearsal.ts`**

In `RehearsalInitDeps` (~lines 43-50) add `configRoot(): string;`. In `liveInitDeps` (~lines 137-140) add `configRoot: () => process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd()`. In `initWith`, immediately after `mkdirSync(art, { recursive: true });` (~line 117) add:
```ts
  seedLib(art, deps.configRoot());
```
Import `seedLib` from `../core/rehearsal.js`.

- [ ] **Step 6: Run — verify pass**

Run: `npm run test -- rehearsal-cmd && npm run typecheck && npm run lint && npm run test -- stale-tokens`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add config/rehearsal-lib-seed src/core/rehearsal.ts src/commands/rehearsal.ts tests/rehearsal-cmd.test.ts
git commit -m "feat(rehearsal): seed <art>/lib shared helpers at init (#2)"
```

---

## Task 5: perform — `audit` verb + `init --force` + `auto_provider.txt` (#8, #9)

**Files:**
- Modify: `src/core/perform.ts` (`PerformArgs.force` + parse `--force`)
- Modify: `src/commands/perform.ts` (`auditRun` + dispatch + `usage()`; gate FAIL on `--force`; write `auto_provider.txt`)
- Test: `tests/perform-init.test.ts` (extend)

- [ ] **Step 1: Write failing tests** — add to `tests/perform-init.test.ts`:

```ts
it("audit verb: rc 0 PASS, rc 1 FAIL, rc 2 unreadable", async () => {
  const good = mkdtempDoc(VALID_DESIGN);   // helper that writes a passing design doc, returns path
  const bad = mkdtempDoc("# nope\n");
  expect((await capture(() => run(["audit", good]))).rc).toBe(0);
  expect((await capture(() => run(["audit", bad]))).rc).toBe(1);
  expect((await capture(() => run(["audit", "/no/such/doc.md"]))).rc).toBe(2);
});

it("init --force proceeds past an audit FAIL and writes auto_provider.txt", async () => {
  const bad = mkdtempDoc("# nope\n");
  const args = mintArgsWith(bad + " --force");          // existing args-file helper
  const { rc } = await capture(() => run(["init", "--args-file", args]));
  expect(rc).toBe(0);
  // auto_provider.txt mirrors provider.txt
  const art = performArtDir(deriveTopicFromPath(bad));
  expect(readFileSync(join(art, "auto_provider.txt"), "utf8").trim()).toMatch(/codex|claude/);
});
```
(Mirror the existing init-test scaffolding for `mkdtempDoc`/`mintArgsWith`/`capture`; reuse whatever the file already provides — if a helper name differs, use the file's existing equivalents.)

- [ ] **Step 2: Run — verify fail**

Run: `npm run test -- perform-init`
Expected: FAIL (`audit` verb unknown; `--force` not parsed; no `auto_provider.txt`).

- [ ] **Step 3: Add `force` to `parsePerformArgs` (`src/core/perform.ts:49-75`)**

Add `force: boolean` to the `PerformArgs` interface, initialize `force = false`, and add a parse branch mirroring `--no-branch`:
```ts
    if (t === "--force") { force = true; continue; }
```
Include `force` in the returned object.

- [ ] **Step 4: Add `auditRun` + wire + gate FAIL + auto_provider (`src/commands/perform.ts`)**

Add the verb:
```ts
async function auditRun(rest: string[]): Promise<number> {
  const doc = rest[0];
  if (!doc || rest.length !== 1) { log.error("usage: perform audit <doc>"); return 2; }
  if (!existsSync(doc)) { log.error(`perform audit: doc unreadable: ${doc}`); return 2; }
  let text: string;
  try { text = readFileSync(doc, "utf8"); } catch { log.error(`perform audit: doc unreadable: ${doc}`); return 2; }
  const ad = auditDoc(text);
  if (ad.verdict === "FAIL") { for (const i of ad.issues) process.stderr.write(`ISSUE=${i}\n`); return 1; }
  log.ok(`perform audit: PASS ${doc}`);
  return 0;
}
```
Dispatch: add `case "audit": return auditRun(rest);` and `audit` to `usage()`.
Gate the init FAIL (`perform.ts:92`):
```ts
  if (ad.verdict === "FAIL") {
    for (const i of ad.issues) process.stderr.write(`ISSUE=${i}\n`);
    if (!parsed.force) { log.error(`perform init: audit FAILED on ${designPath}`); return 1; }
    log.warn(`perform init: audit FAILED on ${designPath} but --force given; proceeding`);
  }
```
After the `provider.txt` write (`perform.ts:110`) add:
```ts
  atomicWrite(join(art, "auto_provider.txt"), provider + "\n");
```

- [ ] **Step 5: Run — verify pass**

Run: `npm run test -- perform-init && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/perform.ts src/commands/perform.ts tests/perform-init.test.ts
git commit -m "feat(perform): standalone audit verb + init --force + auto_provider marker (#8,#9)"
```

---

## Task 6: perform — `find-latest-doc` (#7)

**Files:**
- Modify: `src/commands/perform.ts` (add `findLatestDocRun` + imports + dispatch + `usage()`)
- Test: `tests/perform-find-latest-doc.test.ts` (new)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { repoStateDir } from "../src/core/paths.js";
import { run } from "../src/commands/perform.js";
import { capture } from "./helpers/capture.js"; // or the perform test's local capture()

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

describe("perform find-latest-doc", () => {
  it("prints the newest *-design.md under */_score/design-doc by mtime", async () => {
    const sd = repoStateDir();
    const a = join(sd, "topic-a", "_score", "design-doc"); mkdirSync(a, { recursive: true });
    const b = join(sd, "topic-b", "_score", "design-doc"); mkdirSync(b, { recursive: true });
    const older = join(a, "2026-05-01-topic-a-design.md"); writeFileSync(older, "x");
    const newer = join(b, "2026-05-30-topic-b-design.md"); writeFileSync(newer, "x");
    utimesSync(older, new Date(1000), new Date(1000));
    utimesSync(newer, new Date(2000), new Date(2000));
    const { rc, out } = await capture(() => run(["find-latest-doc"]));
    expect(rc).toBe(0);
    expect(out).toContain(`DOC=${newer}`);
  });
  it("rc 1 when none found", async () => {
    mkdirSync(repoStateDir(), { recursive: true });
    expect((await capture(() => run(["find-latest-doc"]))).rc).toBe(1);
  });
});
```
(If a shared `capture` helper does not exist, inline the perform test file's existing capture pattern.)

- [ ] **Step 2: Run — verify fail.** Run: `npm run test -- perform-find-latest-doc` → FAIL.

- [ ] **Step 3: Implement** — in `src/commands/perform.ts` add `readdirSync` to the `node:fs` import and `repoStateDir` to the `../core/paths.js` import, then:

```ts
async function findLatestDocRun(rest: string[]): Promise<number> {
  let cwd: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--cwd") { cwd = rest[i + 1]; i++; }
    else if (rest[i].startsWith("--cwd=")) { cwd = rest[i].slice("--cwd=".length); }
  }
  const stateDir = repoStateDir(cwd ? { cwd } : undefined);
  let best: { path: string; mt: number } | null = null;
  if (existsSync(stateDir)) for (const topic of readdirSync(stateDir)) {
    const dd = join(stateDir, topic, "_score", "design-doc");
    if (!existsSync(dd)) continue;
    for (const f of readdirSync(dd)) {
      if (!f.endsWith("-design.md")) continue;
      const p = join(dd, f); let mt = 0;
      try { mt = statSync(p).mtimeMs; } catch { continue; }
      if (!best || mt > best.mt) best = { path: p, mt };
    }
  }
  if (!best) { log.error("perform find-latest-doc: no *-design.md found"); return 1; }
  process.stdout.write(`DOC=${best.path}\n`);
  return 0;
}
```
Dispatch: `case "find-latest-doc": return findLatestDocRun(rest);` + add to `usage()`.

- [ ] **Step 4: Run — verify pass.** Run: `npm run test -- perform-find-latest-doc && npm run typecheck && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/perform.ts tests/perform-find-latest-doc.test.ts
git commit -m "feat(perform): find-latest-doc for no-arg source defaulting (#7)"
```

---

## Task 7: perform — `reset-status` (#5)

**Files:**
- Modify: `src/commands/perform.ts` (add `resetStatusRun` + import `resolveModel` + dispatch + `usage()`)
- Test: `tests/perform-reset-status.test.ts` (new)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { partDir } from "../src/core/paths.js";
import { run } from "../src/commands/perform.js";
import { capture } from "./helpers/capture.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

describe("perform reset-status", () => {
  it("atomically writes idle state for the resolved part", async () => {
    const pd = partDir("viola", "codex", "svc"); mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "pane.json"), JSON.stringify({ instrument: "viola", model: "codex" }) + "\n");
    writeFileSync(join(pd, "status.json"), '{"state":"working"}\n');
    const { rc } = await capture(() => run(["reset-status", "svc", "viola"]));
    expect(rc).toBe(0);
    expect(readFileSync(join(pd, "status.json"), "utf8")).toContain('"state":"idle"');
  });
  it("rc 1 when no part dir resolves", async () => {
    expect((await capture(() => run(["reset-status", "svc", "ghost"]))).rc).toBe(1);
  });
});
```
(Confirm `resolveModel`'s on-disk resolution requirements while implementing — if it keys off the `<instrument>-<model>` dir name rather than pane.json, the fixture's `mkdirSync(partDir("viola","codex","svc"))` already satisfies it; keep the pane.json write as belt-and-suspenders.)

- [ ] **Step 2: Run — verify fail.** Run: `npm run test -- perform-reset-status` → FAIL.

- [ ] **Step 3: Implement** — add `resolveModel` to the `../core/ipc.js` import (alongside `statusPath`), then:

```ts
async function resetStatusRun(rest: string[]): Promise<number> {
  const [topic, instrument] = rest;
  if (!topic || !instrument || rest.length !== 2) { log.error("usage: perform reset-status <topic> <instrument>"); return 2; }
  const model = resolveModel(instrument, topic);
  if (model === null) { log.error(`perform reset-status: no part for instrument=${instrument} on topic=${topic}`); return 1; }
  atomicWrite(statusPath(instrument, model, topic), `{"state":"idle","last_event":"force-reset"}\n`);
  log.ok(`perform reset-status: ${instrument} state=idle`);
  return 0;
}
```
Dispatch: `case "reset-status": return resetStatusRun(rest);` + `usage()`.

- [ ] **Step 4: Run — verify pass.** Run: `npm run test -- perform-reset-status && npm run typecheck && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/perform.ts tests/perform-reset-status.test.ts
git commit -m "feat(perform): reset-status force-idle for not-idle recovery (#5)"
```

---

## Task 8: perform — `drop-part` (#6)

**Files:**
- Modify: `src/commands/perform.ts` (add `dropPartRun` + dispatch + `usage()`)
- Test: `tests/perform-drop-part.test.ts` (new)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import { run } from "../src/commands/perform.js";
import { capture } from "./helpers/capture.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

describe("perform drop-part", () => {
  it("drops one row, rewrites parts.txt, reports N", async () => {
    const art = performArtDir("multi-svc"); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "parts.txt"), "viola\t/a\tcodex\ncello\t/b\tcodex\n");
    const { rc, out } = await capture(() => run(["drop-part", "multi-svc", "viola"]));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "parts.txt"), "utf8")).toBe("cello\t/b\tcodex\n");
    expect(out).toContain("N=1");
  });
  it("rc 1 when instrument absent or parts.txt missing", async () => {
    const art = performArtDir("multi-svc"); mkdirSync(art, { recursive: true });
    expect((await capture(() => run(["drop-part", "multi-svc", "viola"]))).rc).toBe(1); // no parts.txt
    writeFileSync(join(art, "parts.txt"), "cello\t/b\tcodex\n");
    expect((await capture(() => run(["drop-part", "multi-svc", "ghost"]))).rc).toBe(1);
  });
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm run test -- perform-drop-part` → FAIL.

- [ ] **Step 3: Implement**

```ts
async function dropPartRun(rest: string[]): Promise<number> {
  const [topic, instrument] = rest;
  if (!topic || !instrument || rest.length !== 2) { log.error("usage: perform drop-part <topic> <instrument>"); return 2; }
  const partsFile = join(performArtDir(topic), "parts.txt");
  if (!existsSync(partsFile)) { log.error(`perform drop-part: parts.txt missing`); return 1; }
  const kept: string[] = []; let dropped = false;
  for (const line of readFileSync(partsFile, "utf8").split("\n")) {
    if (line.length === 0) continue;
    if (line.split("\t")[0] === instrument) { dropped = true; continue; }
    kept.push(line);
  }
  if (!dropped) { log.error(`perform drop-part: no part for instrument=${instrument}`); return 1; }
  atomicWrite(partsFile, kept.length ? kept.join("\n") + "\n" : "");
  log.ok(`perform drop-part: dropped ${instrument}, ${kept.length} part(s) remain`);
  process.stdout.write(`N=${kept.length}\n`);
  return 0;
}
```
Dispatch: `case "drop-part": return dropPartRun(rest);` + `usage()`.

- [ ] **Step 4: Run — verify pass.** Run: `npm run test -- perform-drop-part && npm run typecheck && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/perform.ts tests/perform-drop-part.test.ts
git commit -m "feat(perform): drop-part for proceed-degraded multi-repo runs (#6)"
```

---

## Task 9: perform — `verify-dag-repos` (#3 code)

**Files:**
- Modify: `src/commands/perform.ts` (add `verifyDagReposRun` + dispatch + `usage()`)
- Test: `tests/perform-verify-dag-repos.test.ts` (new)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import { run } from "../src/commands/perform.js";
import { capture } from "./helpers/capture.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

describe("perform verify-dag-repos", () => {
  it("reports ok / missing-dir / missing-marker per slug", async () => {
    const art = performArtDir("svc"); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "design.md"), "## Execution DAG\n1. alpha — first\n2. beta — second\n");
    const hub = env.home; // use temp home as hub
    mkdirSync(join(hub, "alpha"), { recursive: true });
    writeFileSync(join(hub, "alpha", "CLAUDE.md"), "x"); // alpha = ok
    mkdirSync(join(hub, "beta"), { recursive: true });   // beta = missing-marker
    const { rc, out } = await capture(() => run(["verify-dag-repos", "svc", "--cwd", hub]));
    expect(rc).toBe(1); // beta is bad
    expect(out).toContain("REPO=alpha\tSTATUS=ok");
    expect(out).toContain("REPO=beta\tSTATUS=missing-marker");
  });
});
```
(Confirm `parseDagLine` accepts `1. alpha — first` and sets `.repo="alpha"`; if the parser requires a different line shape, adjust the fixture to a parser-conforming line while keeping the assertion semantics.)

- [ ] **Step 2: Run — verify fail.** Run: `npm run test -- perform-verify-dag-repos` → FAIL.

- [ ] **Step 3: Implement** (`dagSectionBody`, `parseDagLine`, `repoRoot`, `statSync` are already imported in perform.ts):

```ts
async function verifyDagReposRun(rest: string[]): Promise<number> {
  let topic: string | undefined; let hub: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--cwd") { hub = rest[i + 1]; i++; }
    else if (t.startsWith("--cwd=")) { hub = t.slice("--cwd=".length); }
    else if (!topic) topic = t;
  }
  if (!topic) { log.error("usage: perform verify-dag-repos <topic> [--cwd <hub>]"); return 2; }
  const doc = join(performArtDir(topic), "design.md");
  if (!existsSync(doc)) { log.error(`perform verify-dag-repos: design.md missing under ${performArtDir(topic)}`); return 1; }
  const hubDir = hub ?? repoRoot();
  const slugs: string[] = [];
  for (const line of dagSectionBody(readFileSync(doc, "utf8"))) {
    const node = parseDagLine(line);
    if (node && !slugs.includes(node.repo)) slugs.push(node.repo);
  }
  let bad = 0;
  for (const slug of slugs) {
    const dir = join(hubDir, slug);
    let st: string;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) st = "missing-dir";
    else if (!existsSync(join(dir, "CLAUDE.md")) && !existsSync(join(dir, "AGENTS.md"))) st = "missing-marker";
    else st = "ok";
    if (st !== "ok") bad++;
    process.stdout.write(`REPO=${slug}\tSTATUS=${st}\n`);
  }
  return bad > 0 ? 1 : 0;
}
```
Dispatch: `case "verify-dag-repos": return verifyDagReposRun(rest);` + `usage()`.

- [ ] **Step 4: Run — verify pass.** Run: `npm run test -- perform-verify-dag-repos && npm run typecheck && npm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/perform.ts tests/perform-verify-dag-repos.test.ts
git commit -m "feat(perform): verify-dag-repos per-slug repo-layout check (#3 code)"
```

---

## Task 10: perform.md — directive stages for #3, #5, #6, #7, #8, #9

**Files:**
- Modify: `commands/perform.md`

This task wires the new verbs into the conductor directive. There are no vitest units for `.md` flow; verification is: the stale-token gate stays green, every `$CS perform <verb>` referenced exists in `src/commands/perform.ts`'s dispatcher, and `npm run build` succeeds.

- [ ] **Step 1: #7 source-default** — in Stage 0, insert a step 3.5 between "Write args" (line ~28) and "Init" (line ~29): if the args file contains no `.md` positional, run `$CS perform find-latest-doc`; on a non-empty `DOC=` line, **AskUserQuestion** "Use this / Cancel" (Use → append the path to the args file; Cancel → stop); on rc 1 (none found), stop with a usage hint.

- [ ] **Step 2: #8 audit-proceed** — rewrite the Stage 0 step-4 `rc 1`/`rc 2` block (lines ~37-42) to call `$CS perform audit <doc>` BEFORE `init`: audit rc 2 → archive + stop; audit rc 1 (FAIL, `ISSUE=` lines on stderr) → **AskUserQuestion** "Proceed anyway / Abort and edit doc" (Proceed → `$CS perform init --args-file <args>` with `--force` appended; Abort → `$CS perform archive <TOPIC>` + stop); audit rc 0 → `init` normally.

- [ ] **Step 3: #9 claude-confirm** — after `PROVIDER=` is captured at end of Stage 0 (line ~34), and before the Stage 1.1 single spawn (line ~64) and each Stage 3b per-part spawn (line ~208): if that part's provider is `claude`, **AskUserQuestion** with the ported prompt — question text "This repo has .claude-plugin/plugin.json — Claude is the recommended part for plugin testing (it can load slash commands, run hooks, exercise the Claude Code surface natively). It will use claude tokens. Use claude or fall back to codex?"; options "Use claude (recommended for plugin testing)" / "Fall back to codex (cheaper)". On fallback, set the spawn provider to `codex`.

- [ ] **Step 4: #3 prose-DAG rescue** — at the `dag-parse` rc 1 path (Stage 0 step 5.1, lines ~46-47), replace "surface it and stop" with a one-shot rescue stage: the Maestro reads `$ART/design.md`'s `## Execution DAG`, extracts parser-conforming `N. <slug> — <desc>` lines, runs `$CS perform verify-dag-repos <TOPIC>` (each `REPO=…\tSTATUS=…`), gates the confirm on `CONSORT_PERFORM_FORCE_RESCUE=1` (auto-proceed silently when all `STATUS=ok` and the env is unset; otherwise **AskUserQuestion** "Looks right — write & retry / Let me edit / Abort"), uses the **Edit** tool to insert a `### DAG Lines` subsection at the top of `## Execution DAG` in `$ART/design.md`, writes a one-line `$ART/dag-rescue.log`, then re-runs `$CS perform dag-parse` + `$CS perform multi-init` exactly ONCE (no loop; still failing → surface + stop).

- [ ] **Step 5: #5 not-idle menu** — right after Stage 1 step 1 dispatch (line ~79): if `turn-send` exits non-zero with a "not idle" message, **AskUserQuestion** "Wait 60s and retry / Force-retry (atomic reset) / Abort" — Wait → sleep 60 + re-run turn-send; Force-retry → `$CS perform reset-status <TOPIC> <INSTRUMENT>` then re-run turn-send; Abort → `$CS coda <TOPIC>` + `$CS perform archive <TOPIC>`, stop.

- [ ] **Step 6: #6 proceed-degraded ladder** — in Stage 3b step 3 (Barrier, lines ~225-228), replace the single-tier "Any TS=failed/timeout → AskUserQuestion (Retry/Hand-off/Abort)" with a two-tier ladder using a `WAVE_RETRY` counter (init 0 near the Stage 3a setup): first failure + `WAVE_RETRY==0` → full teardown + re-preflight + re-dispatch the wave, set `WAVE_RETRY=1`; second failure + `WAVE_RETRY==1` → **AskUserQuestion** "Proceed degraded with N=M (drop failed part) / Abort all" — Proceed → `$CS perform drop-part <TOPIC> <instrument>` then continue with remaining parts; Abort → `$CS coda --pairs <TOPIC> <instrument…>` + `$CS perform archive <TOPIC>`, stop.

- [ ] **Step 7: Verify**

Run: `npm run test -- stale-tokens` (green) and confirm every `$CS perform <verb>` in `commands/perform.md` is one of the dispatcher cases in `src/commands/perform.ts` (`audit`, `find-latest-doc`, `verify-dag-repos`, `reset-status`, `drop-part`, `init --force` flag). Spot-grep: `grep -oE '\$CS perform [a-z-]+' commands/perform.md | sort -u`.

- [ ] **Step 8: Commit**

```bash
git add commands/perform.md
git commit -m "feat(perform.md): rescue + not-idle + degraded + source-default + audit-proceed + claude-confirm stages (#3,#5,#6,#7,#8,#9)"
```

---

## Task 11: solo — auto-finish default + `--no-finish` (#10)

**Files:**
- Modify: `src/core/solo.ts:22-38` (`parseSoloArgs`)
- Modify: `commands/solo.md` (docs)
- Test: `tests/solo-core.test.ts` (flip + add cases), `tests/solo-cmd.test.ts` (default `finish.txt`)

- [ ] **Step 1: Update tests** — in `tests/solo-core.test.ts` `describe("parseSoloArgs")`:

```ts
  it("finish defaults to true; --no-finish opts out; legacy --finish still parses", () => {
    expect(parseSoloArgs(["add", "oauth", "login"]))
      .toEqual({ topicText: "add oauth login", provider: undefined, finish: true });
    expect(parseSoloArgs(["fix", "bug", "--no-finish"]))
      .toEqual({ topicText: "fix bug", provider: undefined, finish: false });
    expect(parseSoloArgs(["tidy", "imports", "--finish"]))
      .toEqual({ topicText: "tidy imports", provider: undefined, finish: true });
    expect(parseSoloArgs(["fix", "bug", "--provider", "agy"]))
      .toEqual({ topicText: "fix bug", provider: "agy", finish: true });
  });
```
In `tests/solo-cmd.test.ts`, the existing default-`finish.txt` assertion (~line 43) flips to `"yes"`; add a `--no-finish` case asserting `"no"`:
```ts
    expect(readFileSync(join(art, "execute", "finish.txt"), "utf8").trim()).toBe("yes");
```
```ts
  it("--no-finish writes finish.txt=no", async () => {
    await initWith(["add", "oauth", "--provider", "codex", "--no-finish"], okDeps);
    const art = soloArtDir("add-oauth"); // match the file's existing slug helper
    expect(readFileSync(join(art, "execute", "finish.txt"), "utf8").trim()).toBe("no");
  });
```

- [ ] **Step 2: Run — verify fail.** Run: `npm run test -- solo-core solo-cmd` → FAIL.

- [ ] **Step 3: Implement `parseSoloArgs` (`src/core/solo.ts`)** — flip default and add `--no-finish`:

```ts
  let finish = true;
  ...
    if (t === "--finish") { finish = true; continue; }      // legacy: now the default
    if (t === "--no-finish") { finish = false; continue; }
```
No change to `SoloArgs`, `finishWith`, `finishBranch`, or `initWith` body (the `finish.txt` plumbing already gates on the value).

- [ ] **Step 4: Update `commands/solo.md`** — `argument-hint` (line ~3): replace `[--finish]` with `[--no-finish]`. Intro (lines ~11-13): finish is now the default (local repo → keep + restore checkout; repo with a remote → push + open a PR); `--no-finish` keeps the branch local only. Notes (line ~112): "autonomous finish by default". Add a one-line note that this restores clone-wars `strike` parity (so a future audit does not re-flag it).

- [ ] **Step 5: Run — verify pass.** Run: `npm run test -- solo-core solo-cmd && npm run typecheck && npm run lint && npm run test -- stale-tokens` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/solo.ts commands/solo.md tests/solo-core.test.ts tests/solo-cmd.test.ts
git commit -m "feat(solo): auto-finish by default + --no-finish opt-out (#10)"
```

---

## Task 12: Final — rebuild dist, full suite, dogfood, holistic review

**Files:**
- Modify: `dist/consort.cjs` (rebuilt)
- Optionally extend: `scripts/dogfood-*.sh`

- [ ] **Step 1: Full gate sweep**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green (including `stale-tokens`).

- [ ] **Step 2: Rebuild the committed bundle**

Run: `npm run build`
Then confirm the new verbs are reachable from the bundle:
Run: `node dist/consort.cjs perform 2>&1 | head -1` (usage line should list `audit`, `find-latest-doc`, `verify-dag-repos`, `reset-status`, `drop-part`); `node dist/consort.cjs score 2>&1 | head -1` (should list `offset-reset`).

- [ ] **Step 3: Dogfood the new recovery/UX paths (best-effort)**

Extend the relevant `scripts/dogfood-*.sh` simulators to exercise: a `score offset-reset` round-trip (seed findings → reset → assert gone), a `perform drop-part`/`reset-status`/`find-latest-doc` against a throwaway `CONSORT_HOME`, and a `rehearsal init` asserting `<art>/lib/arena.py` exists. Run them; expect all assertions PASS. If a simulator does not cover a verb, add a minimal assertion block rather than leaving it untested.

- [ ] **Step 4: Commit dist + dogfood**

```bash
git add dist/consort.cjs scripts
git commit -m "build: rebuild dist with port-parity fixes; extend dogfood for new verbs"
```

- [ ] **Step 5: Holistic review**

Re-run the 11-item audit mentally against the branch: each gap (#1–#11) closed per the spec acceptance criteria (§10). Confirm `dist/consort.cjs` has no diff after a second `npm run build` (deterministic), and the full suite + gates are green. Then hand off to `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:** every spec §4 fix maps to a task — #11→T1, #1→T2, #4→T3, #2→T4, #8/#9→T5, #7→T6, #5→T7, #6→T8, #3 code→T9, #3/#5/#6/#7/#8/#9 directive→T10, #10→T11, build/dogfood→T12. All §5 naming (env vars, verbs, config dirs) is used consistently. §6 testing (vitest + CONSORT_HOME + stale-token + dist rebuild) is honored. §7 sequencing matches task order.

**Placeholder scan:** every code step shows real code; config-file ports give exact source paths + substitution lists (concrete actions, not "port faithfully"); test steps show real assertions. The few "match the file's existing helper" notes point at named, real helpers (`capture`, `okDeps`, `deps`, `soloArtDir`) the implementer will see on opening the file.

**Type consistency:** `classifyTopic`/`skillHintAppend`, `cascadeTargets`/`ResetPhase`, `offsetResetRun`, `seedLib(art, configRoot)`, `auditRun`/`--force`/`auto_provider.txt`, `findLatestDocRun`, `resetStatusRun`, `dropPartRun`, `verifyDagReposRun`, `parseSoloArgs` defaults — names and signatures are identical across the task that defines them and the tasks/dispatch that call them. `preSnapshot(r, command, topic)` arg order is fixed in T1 and used by all callers.
