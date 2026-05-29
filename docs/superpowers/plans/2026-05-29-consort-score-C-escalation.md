# consort `score` — Phase C: escalation spawn + research + N-way diff (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Build the first escalation phase of `score` — batch-spawn a 2–3 part ensemble, run a
per-part research turn (with the question relay), and bucket the findings with an N-way diff — ending
in a **live tmux dogfood** where real model parts produce `findings.md` and `score diff` writes the
buckets.

**Architecture:** A new pure `core/scoreTurn.ts` generalises solo's offset discipline to N research
parts (the `FS=` state machine, the research-prompt composer, the latest-offset reader for question
re-arm). Four new `score` subcommands (`spawn-all`, `research-send`, `research-wait`, `diff`) wire
that core onto the **existing foundation primitives** (`preflight`, `spawn`, `send`, the `ipc`
outbox helpers) and the already-built `scoreDiff.diffFindings`. `commands/score.md` Stages 3–6 replace
the Phase B single-repo escalation stub with the real pipeline up to the diff. Mechanical work lives
in the CLI; the directive only does Read / Write / AskUserQuestion / background-wait (D10).

**Tech Stack:** TypeScript (ES2022 / NodeNext / strict), vitest, esbuild → committed
`dist/consort.cjs`, execa-backed tmux (only via the reused `spawn`/`preflight`). Behavioral source:
clone-wars `bin/consult-research-send.sh`, `bin/consult-research-wait.sh`, `lib/consult-wait.sh`,
`bin/consult-diff.sh`, `bin/spawn-batch.sh`, `config/prompt-templates/consult/research.md`.

---

## Scope (this plan only)

**In:** `score spawn-all` (preflight + `Promise.all` spawn + the spawn-batch rc 0/1/2 +
`spawn-results.tsv` contract), `score research-send`, `score research-wait` (the `FS=` state machine +
question capture + offset-bump re-arm), `score diff` (wiring the already-tested `diffFindings`),
`core/scoreTurn.ts` (research half), `score init` emitting `ART=<abs>`, `commands/score.md` Stages 3–6
(single-repo escalation only), a refreshed `dist/consort.cjs`, and a live dogfood.

**Out (later phases):** cross-verify (`verify-send`/`verify-wait`), `adjudicate`, `synthesize`, the
design walk + audit-retry (**Phase D**); multi-repo detect + execution DAG + 8-section walk (**Phase
E**); drilldown, forensics, teardown, `present` (**Phase F**). The `--targets`/multi-repo routing
stays stubbed-to-stop exactly as Phase B left it. `core/scoreTurn.ts`'s verify-phase composer/state is
**not** built here.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/core/scoreTurn.ts` | research-phase turn helpers: `findingsStatus`, `researchState`, `parseLatestOffset`, `scaledTimeout`, `composeResearchPrompt` | **create** |
| `src/core/score.ts` | add spawn-all pure helpers: `spawnRosterArg`, `spawnResultsTsv`, `spawnTally`, `parsePanesFile`, `SpawnResult` | modify |
| `src/commands/score.ts` | add `spawn-all`/`research-send`/`research-wait`/`diff` subcommands + DI cores; `init` emits `ART=` | modify |
| `commands/score.md` | Stages 3–6 escalation (replace the Phase B single-repo stub) | modify |
| `tests/score-turn.test.ts` | unit tests for `core/scoreTurn.ts` | **create** |
| `tests/score-spawn.test.ts` | unit tests for the spawn-all pure helpers | **create** |
| `tests/score-escalation.test.ts` | integration tests (temp `CONSORT_HOME` + injected deps) for the 4 subcommands | **create** |
| `tests/score-init.test.ts` | add an `ART=` stdout assertion | modify |
| `dist/consort.cjs` | rebuilt bundle | regenerate |
| `docs/superpowers/DOGFOOD.md` | append the Phase C dogfood section | modify |

## Deliberate deviations from clone-wars (faithful behavior, modern internals — do NOT "fix" these)

1. **No liveness-probe mtime grace** (clone-wars consult-wait Layer B). `outboxWaitSince` polls for
   `consultTimeout("research") × timeout_multiplier` seconds and returns null on expiry. solo's
   `turn-wait` omits the probe too; the per-provider multiplier (opencode 2.5) already absorbs slow
   providers. Keeps the wait a thin shim over the shipped `ipc` primitive.
2. **`spawn-results.tsv` reason** is `""` (ok) / `"spawn-failed"` (rc≠0), not clone-wars'
   `failure-reason.txt` first line — consort's `spawn` archives state + writes forensics on failure
   rather than a reason file. The conductor branches on the rc tally, not the reason text.
3. **Question payload** is the raw event JSON written to `question-<instrument>.txt` (consort-idiomatic,
   identical to solo's `question-<round>.txt`), not clone-wars' parsed `text`/`options` payload file.
   The directive reads `message`/`options` straight from the JSON.
4. **`research-send` refuses if its state file exists** (`rm` to retry) instead of a separate
   `consult-offset-reset.sh` subcommand.
5. **`score init` gains an `ART=<abs>` stdout line.** Phase C's directive must Read/Write art files
   (`research-<inst>.txt`, `question-<inst>.txt`, rewrite `roster.txt`); there is no other clean way
   to resolve the `_score` dir from the directive. Also retires Stage 2's undefined `<TOPIC art>`
   placeholder.

---

### Task 1: `core/scoreTurn.ts` — research-phase classifiers + offset/timeout helpers

**Files:**
- Create: `src/core/scoreTurn.ts`
- Test: `tests/score-turn.test.ts`

Ports `cw_consult_findings_status` (lib/consult.sh) and the `FS=` mapping in `cw_consult_wait`
(lib/consult-wait.sh). `findingsStatus` reuses the already-tested `parseClaims` from `scoreDiff.ts`.
`parseLatestOffset` reads the **last** `OFFSET=` line (the question re-arm appends a second one) —
deliberately distinct from `turn.ts` `parseOffset`, which reads the first match (correct for solo's
single-offset file).

- [ ] **Step 1: Write the failing test**

```ts
// tests/score-turn.test.ts
import { describe, it, expect } from "vitest";
import { findingsStatus, researchState, parseLatestOffset, scaledTimeout } from "../src/core/scoreTurn.js";

describe("findingsStatus", () => {
  it("null (no findings.md) → missing", () => { expect(findingsStatus(null)).toBe("missing"); });
  it(">=1 cited claim under ## Claims → ok", () => {
    expect(findingsStatus("## Claims\n1. [src/a.ts:10] uses LRU\n")).toBe("ok");
  });
  it("non-blank lines under ## Claims but none cited → malformed", () => {
    expect(findingsStatus("## Claims\nthis line has no citation\n")).toBe("malformed");
  });
  it("empty ## Claims section → empty", () => {
    expect(findingsStatus("## Summary\nblah\n\n## Claims\n\n## Notes\nx\n")).toBe("empty");
  });
  it("a heading after ## Claims closes the section", () => {
    expect(findingsStatus("## Claims\n\n## Notes\nnot a claim line\n")).toBe("empty");
  });
});

describe("researchState", () => {
  it("null event → timeout", () => { expect(researchState(null, "## Claims\n1. [a:1] x\n")).toBe("timeout"); });
  it("question event → question (findings ignored)", () => {
    expect(researchState({ event: "question", message: "?" }, null)).toBe("question");
  });
  it("done event → findingsStatus of the findings text", () => {
    expect(researchState({ event: "done", summary: "ok" }, "## Claims\n1. [a:1] x\n")).toBe("ok");
    expect(researchState({ event: "done", summary: "ok" }, null)).toBe("missing");
    expect(researchState({ event: "done", summary: "ok" }, "## Claims\nno cite\n")).toBe("malformed");
  });
  it("error / unknown event → failed", () => {
    expect(researchState({ event: "error", reason: "x" }, null)).toBe("failed");
    expect(researchState({ event: "weird" }, null)).toBe("failed");
  });
});

describe("parseLatestOffset", () => {
  it("single OFFSET line", () => { expect(parseLatestOffset("OFFSET=128\n")).toBe(128); });
  it("returns the LAST OFFSET after a question re-arm", () => {
    expect(parseLatestOffset("OFFSET=10\nFS=question\nOFFSET=512\nFS=ok\n")).toBe(512);
  });
  it("ignores trailing FS lines; null when absent", () => {
    expect(parseLatestOffset("OFFSET=0\nFS=ok\n")).toBe(0);
    expect(parseLatestOffset("FS=timeout\n")).toBeNull();
  });
});

describe("scaledTimeout", () => {
  it("multiplier 1.0 is identity; 2.5 rounds half-up; bad multiplier → identity", () => {
    expect(scaledTimeout(600, "1.0")).toBe(600);
    expect(scaledTimeout(300, "2.5")).toBe(750);
    expect(scaledTimeout(601, "1.5")).toBe(902); // 901.5 → 902
    expect(scaledTimeout(600, "bad")).toBe(600);
    expect(scaledTimeout(600, "0")).toBe(600);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/score-turn.test.ts`
Expected: FAIL — `Cannot find module '../src/core/scoreTurn.js'`.

- [ ] **Step 3: Implement the classifiers + helpers**

```ts
// src/core/scoreTurn.ts — multi-part research-phase turn helpers for score.
// Built on the ipc primitives + the classifyTurn/parseOffset *semantics* from turn.ts
// (reused, not bent). The verify-phase composer + state machine land in Phase D.
import type { OutboxEvent } from "./ipc.js";
import { parseClaims } from "./scoreDiff.js";

/** Research findings.md health, ported from consult_findings_status (lib/consult.sh).
 *  null (file absent) -> "missing"; >=1 parseable `N. [cite] text` claim -> "ok";
 *  else non-blank lines under `## Claims` -> "malformed"; otherwise -> "empty". */
export function findingsStatus(text: string | null): "ok" | "empty" | "malformed" | "missing" {
  if (text === null) return "missing";
  if (parseClaims(text).length > 0) return "ok";
  let inClaims = false;
  let count = 0;
  for (const line of text.split("\n")) {
    if (/^## Claims/.test(line)) { inClaims = true; continue; }
    if (/^## /.test(line)) { inClaims = false; }
    if (inClaims && line.trim() !== "") count++;
  }
  return count > 0 ? "malformed" : "empty";
}

export type FsState = "ok" | "empty" | "malformed" | "missing" | "failed" | "timeout" | "question";

/** Map a research wait outcome to its FS= value, ported from cw_consult_wait (lib/consult-wait.sh):
 *  null (no terminal event before timeout) -> timeout; question -> question;
 *  done -> findingsStatus; any other event (error/unknown) -> failed. */
export function researchState(ev: OutboxEvent | null, findingsText: string | null): FsState {
  if (!ev) return "timeout";
  if (ev.event === "question") return "question";
  if (ev.event === "done") return findingsStatus(findingsText);
  return "failed";
}

/** The LAST `OFFSET=<n>` line in a state file's contents. The question re-arm appends a second
 *  OFFSET= line (bumped past the question event); the re-armed wait must resume from the latest.
 *  Distinct from turn.ts parseOffset (first match — correct for solo's single-offset file).
 *  null if absent/unparseable. */
export function parseLatestOffset(stateText: string): number | null {
  const ms = [...stateText.matchAll(/^OFFSET=(\d+)\s*$/gm)];
  return ms.length ? Number(ms[ms.length - 1][1]) : null;
}

/** Apply a provider's timeout_multiplier to a base timeout, ported from cw_consult_wait's
 *  `printf "%d", b*m + 0.5` (round-half-up to an integer second). Bad/<=0 multiplier -> identity. */
export function scaledTimeout(baseSec: number, multiplier: string): number {
  const m = Number(multiplier);
  return Math.floor(baseSec * (Number.isFinite(m) && m > 0 ? m : 1) + 0.5);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/score-turn.test.ts`
Expected: PASS (all `findingsStatus`/`researchState`/`parseLatestOffset`/`scaledTimeout` cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/scoreTurn.ts tests/score-turn.test.ts
git commit -m "feat(score): scoreTurn research classifiers (findingsStatus, researchState, offset/timeout helpers)"
```

---

### Task 2: `core/scoreTurn.ts` — `composeResearchPrompt`

**Files:**
- Modify: `src/core/scoreTurn.ts`
- Test: `tests/score-turn.test.ts`

Port `config/prompt-templates/consult/research.md`, rebranded: "Master Yoda" → "Maestro"; drop the
clone-wars `trooper-ask.sh`/`inbox-ack.sh` bin protocol (those binaries don't exist in consort) and
replace it with the consort question-event protocol. Like `composeRound1Prompt`, the body must **omit**
`END_OF_INSTRUCTION` and the done-event line — `inboxWrite()` appends the canonical done instruction +
fence when this becomes the inbox task. No branch-discipline block (research parts don't commit).

- [ ] **Step 1: Add the failing test (append to `tests/score-turn.test.ts`)**

```ts
import { composeResearchPrompt } from "../src/core/scoreTurn.js";

describe("composeResearchPrompt", () => {
  const p = composeResearchPrompt("compare LRU vs LFU", "/state/x/viola-codex/findings.md");
  it("names the topic + the findings write path with the Findings structure", () => {
    expect(p).toContain("compare LRU vs LFU");
    expect(p).toContain("/state/x/viola-codex/findings.md");
    expect(p).toContain("## Claims");
    expect(p).toMatch(/\[<source citation>\]/);
  });
  it("documents the question protocol and is NOT branch-disciplined", () => {
    expect(p).toContain('"event":"question"');
    expect(p).not.toMatch(/git (checkout|switch|branch)/i);
  });
  it("carries no canonical fence (inboxWrite appends it) and no stale rebrand tokens", () => {
    expect(p).not.toContain("END_OF_INSTRUCTION");
    expect(p).not.toContain('"event":"done"');
    expect(p).not.toMatch(/master[ -]?yoda/i);
    expect(p).not.toMatch(/trooper|commander/i);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/score-turn.test.ts -t composeResearchPrompt`
Expected: FAIL — `composeResearchPrompt is not a function`.

- [ ] **Step 3: Implement `composeResearchPrompt` (append to `src/core/scoreTurn.ts`)**

```ts
const RESEARCH_BLOCKERS =
  "IF YOU ARE BLOCKED:\n" +
  "- If a referenced path, file, command, env var, or assumption is wrong or missing, do NOT guess\n" +
  "  or silently work around it. Append a question event to your outbox and stop:\n" +
  '  {"event":"question","message":"<what you need and why>","ts":"<iso>"}\n' +
  "  The Maestro will reply via your inbox, then re-engage you.\n";

/** Research-phase prompt body (port of config/prompt-templates/consult/research.md, rebranded).
 *  NOTE: must NOT include END_OF_INSTRUCTION or the done-event line — inboxWrite() appends the
 *  canonical done instruction and the fence when this becomes the inbox task (cf. composeRound1Prompt). */
export function composeResearchPrompt(topicText: string, findingsPath: string): string {
  const topic = topicText.trim();
  return [
    "Investigate the following topic and produce structured findings.",
    "",
    `Topic: ${topic}`,
    "",
    `Output requirements — write to ${findingsPath} with this EXACT structure:`,
    "",
    `  # Findings: ${topic}`,
    "",
    "  ## Summary",
    "  <2-3 sentence overview, free-form prose>",
    "",
    "  ## Claims",
    "  1. [<source citation>] <one-sentence claim>",
    "  2. [<source citation>] <one-sentence claim>",
    "  ...",
    "",
    "  ## Notes",
    "  <any free-form additions; not parsed>",
    "",
    "Citation format options:",
    "  - <file path>:<line>          e.g. src/auth/store.py:42",
    "  - <file path>:<line-range>    e.g. src/auth/refresh.py:15-30",
    "  - <URL>                       e.g. https://datatracker.ietf.org/doc/html/rfc6749",
    "  - runtime: <command>          e.g. runtime: pytest tests/test_auth.py",
    "",
    "Each claim must have a citation in [brackets]. Claims without citations will be silently",
    "dropped — and if NO claim has a citation, your findings will be flagged as malformed.",
    "",
    "Research methods: use any tool available in your environment. When local repository evidence is",
    "insufficient or the topic references external knowledge (RFCs, standards, library docs, vendor",
    "APIs, recent CVEs, design patterns), you SHOULD use web search / fetch to find authoritative",
    "sources and cite them as URL citations. Prefer primary sources over blog posts. If a tool is",
    "unavailable, fall back to local-only investigation and note the gap as an [unverified] claim.",
    "",
    RESEARCH_BLOCKERS,
  ].join("\n");
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/score-turn.test.ts`
Expected: PASS (all `scoreTurn` describes).

- [ ] **Step 5: Commit**

```bash
git add src/core/scoreTurn.ts tests/score-turn.test.ts
git commit -m "feat(score): composeResearchPrompt (rebranded port of consult/research.md)"
```

---

### Task 3: `core/score.ts` — spawn-all pure helpers

**Files:**
- Modify: `src/core/score.ts`
- Test: `tests/score-spawn.test.ts`

Ports the `spawn-batch.sh` contract pieces that are pure: the preflight `--roster` arg builder, the
`spawn-results.tsv` body, the rc tally (all→0 / none→2 / partial→1), and the `preflight-panes.txt`
parser. These keep `spawn-all`'s I/O wrapper thin and testable without real tmux.

- [ ] **Step 1: Write the failing test**

```ts
// tests/score-spawn.test.ts
import { describe, it, expect } from "vitest";
import { spawnRosterArg, spawnResultsTsv, spawnTally, parsePanesFile } from "../src/core/score.js";

describe("spawnRosterArg", () => {
  it("formats <instrument>:<provider> pairs (model = provider), preserving order", () => {
    expect(spawnRosterArg([{ provider: "codex", instrument: "viola" }, { provider: "claude", instrument: "cello" }]))
      .toBe("viola:codex,cello:claude");
  });
});

describe("spawnResultsTsv", () => {
  it("one TSV row per part; reason empty on rc 0, spawn-failed otherwise; trailing newline", () => {
    expect(spawnResultsTsv([
      { instrument: "viola", provider: "codex", rc: 0 },
      { instrument: "cello", provider: "claude", rc: 1 },
    ])).toBe("viola\tcodex\t0\t\ncello\tclaude\t1\tspawn-failed\n");
  });
  it("empty input → empty string", () => { expect(spawnResultsTsv([])).toBe(""); });
});

describe("spawnTally", () => {
  it("all ok → 0; none ok → 2; partial → 1", () => {
    expect(spawnTally([0, 0])).toBe(0);
    expect(spawnTally([1, 1])).toBe(2);
    expect(spawnTally([0, 1])).toBe(1);
  });
});

describe("parsePanesFile", () => {
  it("parses TSV instrument→pane, skipping #/blank lines", () => {
    const m = parsePanesFile("# header\nviola\t%3\n\ncello\t%7\n");
    expect(m.get("viola")).toBe("%3");
    expect(m.get("cello")).toBe("%7");
    expect(m.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/score-spawn.test.ts`
Expected: FAIL — `spawnRosterArg is not a function` (etc.).

- [ ] **Step 3: Implement the helpers (append to `src/core/score.ts`, after `parseMultiRepoMode`)**

```ts
/** Preflight --roster arg from roster rows: "<instrument>:<provider>,..." (model = provider). */
export function spawnRosterArg(rows: RosterRow[]): string {
  return rows.map((r) => `${r.instrument}:${r.provider}`).join(",");
}

export interface SpawnResult { instrument: string; provider: string; rc: number; }

/** spawn-results.tsv body: one `<instrument>\t<provider>\t<rc>\t<reason>` row per part (no header;
 *  mirrors spawn-batch.sh). reason is "" on success, "spawn-failed" otherwise. */
export function spawnResultsTsv(results: SpawnResult[]): string {
  if (!results.length) return "";
  return results.map((r) => `${r.instrument}\t${r.provider}\t${r.rc}\t${r.rc === 0 ? "" : "spawn-failed"}`).join("\n") + "\n";
}

/** Batch-spawn exit code, ported from spawn-batch.sh: all ok → 0; none ok → 2; partial → 1. */
export function spawnTally(rcs: number[]): 0 | 1 | 2 {
  const ok = rcs.filter((rc) => rc === 0).length;
  if (ok === rcs.length) return 0;
  if (ok === 0) return 2;
  return 1;
}

/** Parse preflight-panes.txt (TSV `<instrument>\t<pane>`; skip #/blank) into a map. */
export function parsePanesFile(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [instrument, pane] = t.split("\t");
    if (instrument && pane) m.set(instrument, pane);
  }
  return m;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/score-spawn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/score.ts tests/score-spawn.test.ts
git commit -m "feat(score): spawn-all pure helpers (rosterArg, resultsTsv, tally, panes parser)"
```

---

### Task 4: `score init` emits `ART=<abs>`

**Files:**
- Modify: `src/commands/score.ts:74-77` (the stdout block in `initWith`)
- Test: `tests/score-init.test.ts`

The Phase C directive must Read/Write art files (`research-<inst>.txt`, `question-<inst>.txt`, rewrite
`roster.txt`). Expose the absolute `_score` dir on init's stdout so the directive captures it once.

- [ ] **Step 1: Add the failing assertion (append a test in `tests/score-init.test.ts`'s `describe`)**

```ts
  it("prints ART=<abs _score dir> on stdout", async () => {
    let out = "";
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    try {
      await initWith(["cache", "policy"], deps(["codex", "claude"], ["viola", "cello"]));
    } finally { (process.stdout as any).write = orig; }
    expect(out).toContain(`ART=${scoreArtDir("cache-policy")}`);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/score-init.test.ts -t "ART="`
Expected: FAIL — `out` lacks the `ART=` line.

- [ ] **Step 3: Add the `ART=` line to `initWith`'s stdout block**

In `src/commands/score.ts`, change the `process.stdout.write(...)` call in `initWith` so the KV block
includes `ART=<art>` right after the `MODE=` line:

```ts
  process.stdout.write(
    `TOPIC=${topic}\nN=${rows.length}\nENSEMBLE=${ensemble ? "yes" : "no"}\nMODE=${mode}\nART=${art}\n` +
    rows.map((r) => `PART=${r.instrument}:${r.provider}`).join("\n") + "\n",
  );
```

(`art` is already in scope from `const art = scoreArtDir(topic);` earlier in the function.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/score-init.test.ts`
Expected: PASS (existing cases + the new `ART=` case).

- [ ] **Step 5: Commit**

```bash
git add src/commands/score.ts tests/score-init.test.ts
git commit -m "feat(score): init emits ART=<abs _score dir> for the escalation directive"
```

---

### Task 5: `score research-send`

**Files:**
- Modify: `src/commands/score.ts` (imports, dispatch, `researchSendRun`/`researchSendWith`)
- Test: `tests/score-escalation.test.ts`

Port of `consult-research-send.sh`: compose the research prompt, write it to
`<art>/<instrument>_research_prompt.md`, capture the **pre-send** outbox offset into
`<art>/research-<instrument>.txt` (`OFFSET=<n>`), then `send --from maestro <instrument> <topic>
@<promptFile>`. Refuse if the state file already exists. Mirrors solo `turn-send`'s
capture-offset-then-send ordering (so no early events are missed).

- [ ] **Step 1: Write the failing test (create `tests/score-escalation.test.ts`)**

```ts
// tests/score-escalation.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { scoreArtDir } from "../src/core/score.js";
import { partDir } from "../src/core/paths.js";
import { researchSendWith } from "../src/commands/score.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

/** Seed a minimal initialised topic: _score/topic.txt + roster.txt. */
function seedTopic(topic: string, rows: Array<{ provider: string; instrument: string }>): string {
  const art = scoreArtDir(topic);
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, "topic.txt"), topic.replace(/-/g, " "));
  writeFileSync(join(art, "roster.txt"), rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n") + "\n");
  return art;
}

describe("score research-send", () => {
  it("writes the prompt + OFFSET state, then calls send (rc 0)", async () => {
    const art = seedTopic("cache-policy", [{ provider: "codex", instrument: "viola" }]);
    const calls: string[][] = [];
    const rc = await researchSendWith("cache-policy", "viola", "codex", {
      offsetFor: () => 42,
      send: async (args) => { calls.push(args); return 0; },
    });
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toBe("OFFSET=42\n");
    const prompt = readFileSync(join(art, "viola_research_prompt.md"), "utf8");
    expect(prompt).toContain("## Claims");
    expect(prompt).toContain(join(partDir("viola", "codex", "cache-policy"), "findings.md"));
    expect(calls[0]).toEqual(["--from", "maestro", "viola", "cache-policy", `@${join(art, "viola_research_prompt.md")}`]);
  });

  it("refuses if the state file already exists (rc 1)", async () => {
    const art = seedTopic("cache-policy", [{ provider: "codex", instrument: "viola" }]);
    writeFileSync(join(art, "research-viola.txt"), "OFFSET=0\n");
    const rc = await researchSendWith("cache-policy", "viola", "codex", { offsetFor: () => 0, send: async () => 0 });
    expect(rc).toBe(1);
  });

  it("send failure keeps the state file and returns rc 1", async () => {
    const art = seedTopic("cache-policy", [{ provider: "codex", instrument: "viola" }]);
    const rc = await researchSendWith("cache-policy", "viola", "codex", { offsetFor: () => 7, send: async () => 1 });
    expect(rc).toBe(1);
    expect(existsSync(join(art, "research-viola.txt"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/score-escalation.test.ts`
Expected: FAIL — `researchSendWith` is not exported.

- [ ] **Step 3: Wire the imports + dispatch + implement `researchSendWith`**

In `src/commands/score.ts`, extend the imports:

```ts
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { partDir, repoRoot } from "../core/paths.js";
import { outboxOffset, outboxPath, outboxWaitSince, type OutboxEvent } from "../core/ipc.js";
import { instrumentTimeoutMultiplier } from "../core/contracts.js";
import { consultTimeout } from "../core/contracts.js";
import { composeResearchPrompt, researchState, parseLatestOffset, scaledTimeout } from "../core/scoreTurn.js";
import { diffFindings, type DiffPart } from "../core/scoreDiff.js";
import {
  deriveSlug, parseScoreArgs, scoreArtDir, scoreDraftDir,
  formatRosterFile, scoreDocPath, parseMultiRepoMode, parseRosterFile,
  spawnRosterArg, spawnResultsTsv, spawnTally, parsePanesFile,
  type RosterRow, type SpawnResult,
} from "../core/score.js";
import { run as sendRun } from "./send.js";
import { run as spawnRun } from "./spawn.js";
import { run as preflightRun } from "./preflight.js";
```

(Keep the existing `audit`/`scoreDoc`/`providers`/`paths.activeProvidersPath`/`contracts.instrumentConsultValidated`/`instruments` imports; merge — don't duplicate the `node:fs` or `../core/score.js` import lines. `consultTimeout` and `instrumentTimeoutMultiplier` both come from `../core/contracts.js`.)

Update `usage()` and the dispatch `switch`:

```ts
function usage(): number { log.error("usage: score <init|assemble|spawn-all|research-send|research-wait|diff> ..."); return 2; }
```
```ts
  switch (verb) {
    case "init": return initRun(applyArgsFile(rest));
    case "assemble": return assembleRun(rest);
    case "spawn-all": return spawnAllRun(rest);
    case "research-send": return researchSendRun(rest);
    case "research-wait": return researchWaitRun(rest);
    case "diff": return diffRun(rest);
    default: return usage();
  }
```

Add the subcommand (place after `assembleRun`; reuse the existing `readIf` helper):

```ts
export interface ResearchSendDeps {
  offsetFor(instrument: string, model: string, topic: string): number;
  send(args: string[]): Promise<number>;
}
const liveResearchSendDeps: ResearchSendDeps = {
  offsetFor: (i, m, t) => outboxOffset(outboxPath(i, m, t)),
  send: sendRun,
};

async function researchSendRun(rest: string[]): Promise<number> {
  const [topic, instrument, provider] = rest;
  if (!topic || !instrument || !provider) { log.error("usage: score research-send <topic> <instrument> <provider>"); return 2; }
  return researchSendWith(topic, instrument, provider, liveResearchSendDeps);
}

export async function researchSendWith(topic: string, instrument: string, provider: string, d: ResearchSendDeps): Promise<number> {
  const art = scoreArtDir(topic);
  const stateFile = join(art, `research-${instrument}.txt`);
  if (existsSync(stateFile)) { log.error(`score research-send: ${stateFile} exists; rm to retry`); return 1; }

  const topicText = readIf(join(art, "topic.txt")).trim();
  if (!topicText) { log.error(`score research-send: topic.txt missing/empty at ${art} (run score init)`); return 1; }

  const findingsPath = join(partDir(instrument, provider, topic), "findings.md");
  const promptFile = join(art, `${instrument}_research_prompt.md`);
  atomicWrite(promptFile, composeResearchPrompt(topicText, findingsPath));

  const offset = d.offsetFor(instrument, provider, topic);
  atomicWrite(stateFile, `OFFSET=${offset}\n`);

  const rc = await d.send(["--from", "maestro", instrument, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`score research-send: send failed (rc=${rc}); ${stateFile} kept (rm to redo)`); return 1; }
  log.ok(`score research-send: ${instrument} offset=${offset}`);
  return 0;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/score-escalation.test.ts`
Expected: PASS (the three `research-send` cases).

- [ ] **Step 5: Commit**

```bash
git add src/commands/score.ts tests/score-escalation.test.ts
git commit -m "feat(score): research-send subcommand (compose prompt, capture offset, dispatch)"
```

---

### Task 6: `score research-wait` (FS= state machine + question capture + offset bump)

**Files:**
- Modify: `src/commands/score.ts` (`researchWaitRun`/`researchWaitWith`)
- Test: `tests/score-escalation.test.ts`

Port of `cw_consult_wait research`: read the latest `OFFSET=`, wait for `[done,error,question]` for
`consultTimeout("research") × multiplier` seconds, then classify via `researchState` and **append** the
outcome to the state file. On `question`: capture the event JSON to `question-<instrument>.txt`, append
a **bumped** `OFFSET=` (current outbox size, past the question) + `FS=question`. Always write the
`research-<instrument>.done` sentinel and return 0 (the `FS=` line carries the outcome).

- [ ] **Step 1: Write the failing test (append to `tests/score-escalation.test.ts`)**

```ts
import { researchWaitWith } from "../src/commands/score.js";
import { outboxPath } from "../src/core/ipc.js";

describe("score research-wait", () => {
  function seedState(topic: string, instrument: string, provider: string, offset = 0): string {
    const art = scoreArtDir(topic);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, `research-${instrument}.txt`), `OFFSET=${offset}\n`);
    mkdirSync(partDir(instrument, provider, topic), { recursive: true });
    return art;
  }
  const dep = (ev: any, mult = "1.0") => ({ wait: async () => ev, multiplier: () => mult });

  it("done + cited findings → FS=ok + .done sentinel (rc 0)", async () => {
    const art = seedState("t", "viola", "codex");
    writeFileSync(join(partDir("viola", "codex", "t"), "findings.md"), "## Claims\n1. [a:1] x\n");
    const rc = await researchWaitWith("t", "viola", "codex", dep({ event: "done", summary: "ok" }));
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toContain("FS=ok");
    expect(existsSync(join(art, "research-viola.done"))).toBe(true);
  });

  it("done with no findings.md → FS=missing", async () => {
    const art = seedState("t", "viola", "codex");
    await researchWaitWith("t", "viola", "codex", dep({ event: "done", summary: "ok" }));
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toContain("FS=missing");
  });

  it("timeout (null) → FS=timeout; error → FS=failed", async () => {
    const art = seedState("t", "viola", "codex");
    await researchWaitWith("t", "viola", "codex", dep(null));
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toContain("FS=timeout");
    writeFileSync(join(art, "research-viola.txt"), "OFFSET=0\n"); // reset
    await researchWaitWith("t", "viola", "codex", dep({ event: "error", reason: "x" }));
    expect(readFileSync(join(art, "research-viola.txt"), "utf8")).toContain("FS=failed");
  });

  it("question → captures payload, appends bumped OFFSET + FS=question", async () => {
    const art = seedState("t", "viola", "codex", 5);
    writeFileSync(outboxPath("viola", "codex", "t"), "0123456789ABC"); // size 13 → bumped offset
    await researchWaitWith("t", "viola", "codex", dep({ event: "question", message: "which db?" }));
    const state = readFileSync(join(art, "research-viola.txt"), "utf8");
    expect(state).toContain("FS=question");
    expect(state).toMatch(/OFFSET=13/); // bumped to current outbox size
    expect(readFileSync(join(art, "question-viola.txt"), "utf8")).toContain("which db?");
    // parseLatestOffset on this state must now read 13 (the re-arm resume point)
  });

  it("missing state file → rc 1", async () => {
    mkdirSync(scoreArtDir("t"), { recursive: true });
    expect(await researchWaitWith("t", "viola", "codex", dep(null))).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/score-escalation.test.ts -t "research-wait"`
Expected: FAIL — `researchWaitWith` is not exported.

- [ ] **Step 3: Implement `researchWaitWith`**

Add to `src/commands/score.ts` (after `researchSendWith`):

```ts
export interface ResearchWaitDeps {
  wait(instrument: string, model: string, topic: string, offset: number, events: string[], timeoutSec: number): Promise<OutboxEvent | null>;
  multiplier(provider: string): string;
}
const liveResearchWaitDeps: ResearchWaitDeps = {
  wait: (i, m, t, off, ev, to) => outboxWaitSince(i, m, t, off, ev, to),
  multiplier: instrumentTimeoutMultiplier,
};

async function researchWaitRun(rest: string[]): Promise<number> {
  const [topic, instrument, provider] = rest;
  if (!topic || !instrument || !provider) { log.error("usage: score research-wait <topic> <instrument> <provider>"); return 2; }
  return researchWaitWith(topic, instrument, provider, liveResearchWaitDeps);
}

export async function researchWaitWith(topic: string, instrument: string, provider: string, d: ResearchWaitDeps): Promise<number> {
  const art = scoreArtDir(topic);
  const stateFile = join(art, `research-${instrument}.txt`);
  if (!existsSync(stateFile)) { log.error(`score research-wait: ${stateFile} missing (run score research-send first)`); return 1; }
  const offset = parseLatestOffset(readFileSync(stateFile, "utf8"));
  if (offset === null) { log.error(`score research-wait: OFFSET not set in ${stateFile}`); return 1; }

  const timeout = scaledTimeout(consultTimeout("research"), d.multiplier(provider));
  log.info(`score research-wait: ${instrument} offset=${offset} timeout=${timeout}s`);
  const ev = await d.wait(instrument, provider, topic, offset, ["done", "error", "question"], timeout);

  const findingsPath = join(partDir(instrument, provider, topic), "findings.md");
  const findingsText = existsSync(findingsPath) ? readFileSync(findingsPath, "utf8") : null;
  const fs = researchState(ev, findingsText);

  if (fs === "question" && ev) {
    atomicWrite(join(art, `question-${instrument}.txt`), JSON.stringify(ev) + "\n");
    const bumped = outboxOffset(outboxPath(instrument, provider, topic));
    appendFileSync(stateFile, `OFFSET=${bumped}\nFS=question\n`);
  } else {
    appendFileSync(stateFile, `FS=${fs}\n`);
  }
  writeFileSync(join(art, `research-${instrument}.done`), "");
  log.ok(`score research-wait: ${instrument} FS=${fs}`);
  return 0;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/score-escalation.test.ts`
Expected: PASS (research-send + research-wait suites).

- [ ] **Step 5: Commit**

```bash
git add src/commands/score.ts tests/score-escalation.test.ts
git commit -m "feat(score): research-wait subcommand (FS= state machine + question capture + offset bump)"
```

---

### Task 7: `score diff`

**Files:**
- Modify: `src/commands/score.ts` (`diffRun`)
- Test: `tests/score-escalation.test.ts`

Port of `consult-diff.sh`: read `roster.txt` (in order), read each part's `findings.md`, run the
already-tested `diffFindings`, write the bucket files + `diff.md` into the art dir. Refuse if `diff.md`
already exists; error if any `findings.md` is missing or fewer than 2 parts.

- [ ] **Step 1: Write the failing test (append to `tests/score-escalation.test.ts`)**

```ts
import { diffRun } from "../src/commands/score.js";

describe("score diff", () => {
  function seedFindings(topic: string, rows: Array<{ provider: string; instrument: string; findings: string }>): string {
    const art = scoreArtDir(topic);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "roster.txt"), rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n") + "\n");
    for (const r of rows) {
      mkdirSync(partDir(r.instrument, r.provider, topic), { recursive: true });
      writeFileSync(join(partDir(r.instrument, r.provider, topic), "findings.md"), r.findings);
    }
    return art;
  }

  it("N=2: writes diff.md + two *_only_items.txt (rc 0)", async () => {
    const art = seedFindings("t", [
      { provider: "codex", instrument: "viola", findings: "## Claims\n1. [a:1] shared\n2. [b:1] viola-only\n" },
      { provider: "claude", instrument: "cello", findings: "## Claims\n1. [a:1] shared\n3. [c:1] cello-only\n" },
    ]);
    const rc = await diffRun(["t"]);
    expect(rc).toBe(0);
    expect(existsSync(join(art, "diff.md"))).toBe(true);
    expect(existsSync(join(art, "viola_only_items.txt"))).toBe(true);
    expect(existsSync(join(art, "cello_only_items.txt"))).toBe(true);
    expect(readFileSync(join(art, "diff.md"), "utf8")).toContain("## Agreed");
  });

  it("refuses if diff.md already exists (rc 1)", async () => {
    const art = seedFindings("t", [
      { provider: "codex", instrument: "viola", findings: "## Claims\n1. [a:1] x\n" },
      { provider: "claude", instrument: "cello", findings: "## Claims\n1. [a:1] x\n" },
    ]);
    writeFileSync(join(art, "diff.md"), "stale\n");
    expect(await diffRun(["t"])).toBe(1);
  });

  it("missing a part's findings.md → rc 1", async () => {
    const art = scoreArtDir("t");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "roster.txt"), "codex\tviola\nclaude\tcello\n");
    mkdirSync(partDir("viola", "codex", "t"), { recursive: true });
    writeFileSync(join(partDir("viola", "codex", "t"), "findings.md"), "## Claims\n1. [a:1] x\n");
    expect(await diffRun(["t"])).toBe(1); // cello findings.md absent
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/score-escalation.test.ts -t "score diff"`
Expected: FAIL — `diffRun` is not exported.

- [ ] **Step 3: Implement `diffRun`**

Add to `src/commands/score.ts`:

```ts
export async function diffRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: score diff <topic>"); return 2; }
  const art = scoreArtDir(topic);
  if (!existsSync(art)) { log.error(`score diff: ${art} not found`); return 1; }
  if (existsSync(join(art, "diff.md"))) { log.error("score diff: diff.md exists; rm to retry"); return 1; }

  const rosterPath = join(art, "roster.txt");
  if (!existsSync(rosterPath)) { log.error("score diff: roster.txt missing — run score init first"); return 1; }
  const rows = parseRosterFile(readFileSync(rosterPath, "utf8"));
  if (rows.length < 2) { log.error(`score diff: need >=2 parts in roster.txt, got ${rows.length}`); return 1; }

  const parts: DiffPart[] = [];
  for (const r of rows) {
    const f = join(partDir(r.instrument, r.provider, topic), "findings.md");
    if (!existsSync(f)) { log.error(`score diff: ${r.instrument} findings.md missing: ${f}`); return 1; }
    parts.push({ name: r.instrument, findings: readFileSync(f, "utf8") });
  }

  const result = diffFindings(parts);
  for (const file of result.files) atomicWrite(join(art, file.filename), file.content);
  atomicWrite(join(art, "diff.md"), result.diffMd);

  const summary = result.files
    .filter((f) => f.filename.endsWith("_only_items.txt") || f.filename === "consensus.txt")
    .map((f) => `${f.filename.replace(/\.txt$/, "")}=${f.content.split("\n").filter(Boolean).length}`)
    .join(" ");
  log.ok(`score diff: wrote ${join(art, "diff.md")} (${rows.length} parts) ${summary}`);
  return 0;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run tests/score-escalation.test.ts`
Expected: PASS (research-send + research-wait + diff suites).

- [ ] **Step 5: Commit**

```bash
git add src/commands/score.ts tests/score-escalation.test.ts
git commit -m "feat(score): diff subcommand (wire diffFindings → bucket files + diff.md)"
```

---

### Task 8: `score spawn-all`

**Files:**
- Modify: `src/commands/score.ts` (`spawnAllRun`/`spawnAllWith`)
- Test: `tests/score-escalation.test.ts`

Port of `spawn-batch.sh`, modernized to `Promise.all` (D9 — avoids the conductor-serialization bug):
read `roster.txt`, run `preflight` (reuse) with `--roster <instr:prov,...> --art-dir <_score>`, read
back `preflight-panes.txt`, then spawn all parts concurrently with `--target-pane`/`--cwd`, write
`spawn-results.tsv`, and return the spawn-batch rc (all→0 / partial→1 / none→2).

- [ ] **Step 1: Write the failing test (append to `tests/score-escalation.test.ts`)**

```ts
import { spawnAllWith } from "../src/commands/score.js";

describe("score spawn-all", () => {
  function seedRoster(topic: string, rows: Array<{ provider: string; instrument: string }>): string {
    const art = scoreArtDir(topic);
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "roster.txt"), rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n") + "\n");
    return art;
  }
  // fake preflight writes the panes file the way the real one does
  const fakePreflight = (art: string, rows: Array<{ instrument: string }>) => async (args: string[]) => {
    writeFileSync(join(art, "preflight-panes.txt"), rows.map((r, i) => `${r.instrument}\t%${i + 1}`).join("\n") + "\n");
    return 0;
  };

  it("all parts ok → spawn-results.tsv + rc 0; preflight gets the i:p roster arg", async () => {
    const rows = [{ provider: "codex", instrument: "viola" }, { provider: "claude", instrument: "cello" }];
    const art = seedRoster("t", rows);
    const pfArgs: string[][] = [];
    const spawnArgs: string[][] = [];
    const rc = await spawnAllWith("t", {
      preflight: async (a) => { pfArgs.push(a); return fakePreflight(art, rows)(a); },
      spawn: async (a) => { spawnArgs.push(a); return 0; },
      repoRoot: () => "/repo",
    });
    expect(rc).toBe(0);
    expect(pfArgs[0]).toContain("--roster");
    expect(pfArgs[0][pfArgs[0].indexOf("--roster") + 1]).toBe("viola:codex,cello:claude");
    expect(readFileSync(join(art, "spawn-results.tsv"), "utf8")).toBe("viola\tcodex\t0\t\ncello\tclaude\t0\t\n");
    expect(spawnArgs.every((a) => a.includes("--target-pane") && a.includes("--cwd") && a.includes("/repo"))).toBe(true);
  });

  it("partial failure → rc 1", async () => {
    const rows = [{ provider: "codex", instrument: "viola" }, { provider: "claude", instrument: "cello" }];
    const art = seedRoster("t", rows);
    const rc = await spawnAllWith("t", {
      preflight: fakePreflight(art, rows),
      spawn: async (a) => (a[0] === "cello" ? 1 : 0),
      repoRoot: () => "/repo",
    });
    expect(rc).toBe(1);
    expect(readFileSync(join(art, "spawn-results.tsv"), "utf8")).toContain("cello\tclaude\t1\tspawn-failed");
  });

  it("preflight failure → rc 2 (no spawns)", async () => {
    const rows = [{ provider: "codex", instrument: "viola" }, { provider: "claude", instrument: "cello" }];
    seedRoster("t", rows);
    let spawned = 0;
    const rc = await spawnAllWith("t", { preflight: async () => 1, spawn: async () => { spawned++; return 0; }, repoRoot: () => "/repo" });
    expect(rc).toBe(2);
    expect(spawned).toBe(0);
  });

  it("roster with <2 parts → rc 2", async () => {
    seedRoster("t", [{ provider: "codex", instrument: "viola" }]);
    expect(await spawnAllWith("t", { preflight: async () => 0, spawn: async () => 0, repoRoot: () => "/repo" })).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run tests/score-escalation.test.ts -t "spawn-all"`
Expected: FAIL — `spawnAllWith` is not exported.

- [ ] **Step 3: Implement `spawnAllWith`**

Add to `src/commands/score.ts`:

```ts
export interface SpawnAllDeps {
  preflight(args: string[]): Promise<number>;
  spawn(args: string[]): Promise<number>;
  repoRoot(): string;
}
const liveSpawnAllDeps: SpawnAllDeps = { preflight: preflightRun, spawn: spawnRun, repoRoot };

async function spawnAllRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: score spawn-all <topic>"); return 2; }
  return spawnAllWith(topic, liveSpawnAllDeps);
}

export async function spawnAllWith(topic: string, d: SpawnAllDeps): Promise<number> {
  const art = scoreArtDir(topic);
  const rosterPath = join(art, "roster.txt");
  if (!existsSync(rosterPath)) { log.error(`score spawn-all: roster.txt missing at ${rosterPath} (run score init)`); return 2; }
  const rows = parseRosterFile(readFileSync(rosterPath, "utf8"));
  if (rows.length < 2) { log.error(`score spawn-all: need >=2 parts in roster.txt, got ${rows.length}`); return 2; }

  const pf = await d.preflight([topic, String(rows.length), "--roster", spawnRosterArg(rows), "--art-dir", art]);
  if (pf !== 0) { log.error(`score spawn-all: preflight failed (rc=${pf})`); return 2; }

  const panesPath = join(art, "preflight-panes.txt");
  if (!existsSync(panesPath)) { log.error(`score spawn-all: preflight wrote no ${panesPath}`); return 2; }
  const panes = parsePanesFile(readFileSync(panesPath, "utf8"));
  const orphans = rows.filter((r) => !panes.has(r.instrument));
  if (orphans.length) { log.error(`score spawn-all: parts missing a preflight pane: ${orphans.map((r) => r.instrument).join(", ")}`); return 2; }

  const cwd = d.repoRoot();
  const results: SpawnResult[] = await Promise.all(rows.map(async (r) => {
    const rc = await d.spawn([r.instrument, r.provider, topic, "--target-pane", panes.get(r.instrument)!, "--cwd", cwd]);
    return { instrument: r.instrument, provider: r.provider, rc };
  }));
  atomicWrite(join(art, "spawn-results.tsv"), spawnResultsTsv(results));

  const rc = spawnTally(results.map((r) => r.rc));
  const nOk = results.filter((r) => r.rc === 0).length;
  if (rc === 0) log.ok(`score spawn-all: ${nOk}/${rows.length} parts ready`);
  else log.warn(`score spawn-all: ${nOk}/${rows.length} parts ready (rc=${rc})`);
  return rc;
}
```

- [ ] **Step 4: Run the full escalation suite + typecheck + lint**

Run: `npx vitest run tests/score-escalation.test.ts && npm run typecheck && npm run lint`
Expected: PASS, `tsc` 0 errors, eslint 0 errors. (If eslint flags an unused import left over from
wiring, remove it — `no-unused-vars` is `error`.)

- [ ] **Step 5: Commit**

```bash
git add src/commands/score.ts tests/score-escalation.test.ts
git commit -m "feat(score): spawn-all subcommand (preflight + Promise.all spawn + spawn-results)"
```

---

### Task 9: `commands/score.md` Stages 3–6 + rebuild dist + stale-token gate

**Files:**
- Modify: `commands/score.md` (replace the Phase B single-repo escalation stub; add Stages 3–6)
- Regenerate: `dist/consort.cjs`
- Verify: `tests/stale-tokens.test.ts` stays green

The directive does only Read / Write / AskUserQuestion / background-wait; all mechanical work is in the
CLI subcommands. Capture `ART` (from `score init`) once and use `$ART/...` for every art-file path.

- [ ] **Step 1: Update Stage 1 routing + replace the Phase B escalation stub**

In `commands/score.md`, in the Stage 0 KV block, add `ART=<abs _score dir>` to the documented stdout
lines (after `MODE=`), and note: "Capture `ART` — later stages read/write files under it." Then replace
the Phase B "two stubbed cases" blockquote so **only the multi-repo case still stops**, and single-repo
escalation flows to the new Stage 3:

```markdown
> **Routing → next stage.** After Stage 1 decides:
> - **fast-path** (`Path: fast`) → **Stage 2** (Maestro solo, unchanged).
> - **escalate** (`escalated-from-flag` / `escalated-from-signals`) **and `MODE=single`** → **Stage 3**
>   (the ensemble pipeline below).
> - **escalate and `MODE` is `multi` / `single-sub`** (`--targets` was passed): the multi-repo
>   ensemble + execution-DAG walk lands in **Phase E**. Tell the user plainly: "multi-repo runs
>   (`--targets`) need the Phase E pipeline; re-run without `--targets` for a single-repo run," and
>   **stop**.
```

- [ ] **Step 2: Append Stages 3–6**

Add these stages after Stage 2 (verbatim — they replace nothing in Stage 2; `$ART` = the captured init
value, `<TOPIC>` = the slug):

```markdown
## Stage 3 — escalation: preflight + batch-spawn (single-repo)

> Reached only when Stage 1 chose **escalate** and `MODE=single`.

Spawn the ensemble in one call: `$CS score spawn-all <TOPIC>`. It preflights N panes, spawns every
part in parallel (`--target-pane`, `--cwd <repo>`), and writes `$ART/spawn-results.tsv` (TSV
`<instrument>\t<provider>\t<rc>\t<reason>`). Branch on its rc:

- **rc 0** — all N parts ready → Stage 4.
- **rc 1** (partial) — read `$ART/spawn-results.tsv`; the rows with `rc==0` are the survivors. If
  **≥2 survive**, **rewrite `$ART/roster.txt`** to only the survivor rows (TSV `<provider>\t<instrument>`,
  one per line) and proceed degraded to Stage 4. If **<2 survive**, abort: run `/consort:coda
  <instrument> <TOPIC>` for any ready part, tell the user the ensemble could not reach 2 parts, and stop.
- **rc 2** (all failed) — retry once: `rm -f $ART/preflight-panes.txt $ART/spawn-results.tsv` and re-run
  `$CS score spawn-all <TOPIC>`. If it still returns rc 2, abort (redirect: "just ask Claude directly")
  and stop.

## Stage 4 — research dispatch (per part)

Read the (possibly rewritten) roster and send a research turn to each part:

```bash
grep -v '^#' "$ART/roster.txt" | while IFS=$'\t' read -r PROV INST; do
  [ -n "$PROV" ] && [ -n "$INST" ] && $CS score research-send <TOPIC> "$INST" "$PROV"
done
```

Each `research-send` composes the findings prompt, captures the pre-send outbox `OFFSET=` into
`$ART/research-<instrument>.txt`, and nudges the part. (rc 1 = state file already exists — `rm` it to redo.)

## Stage 5 — research wait + question relay (per part)

For **each** part, await its research turn **in the background** (one call per part):

```
Bash(command='$CS score research-wait <TOPIC> <INST> <PROV>', run_in_background: true,
     description='score research-wait <INST>')
```

On each completion notification, read that part's **last** `FS=` line —
`FS=$(grep '^FS=' "$ART/research-<INST>.txt" | tail -1 | cut -d= -f2)` (`research-wait` *appends* one
`FS=` line per wait, so after a question→re-arm cycle the file holds e.g. `FS=question` then `FS=ok`;
the last line is the current outcome). Branch:

- **`FS=ok` / `FS=empty` / `FS=malformed`** — terminal; the part's `findings.md` exists.
- **`FS=question`** — run the **classify + relay** (the score escalation; distinct from solo's never-ask):
  1. Read `$ART/question-<INST>.txt` (the captured question JSON — `message`, optional `options`) and
     the part's `findings.md`.
  2. **Classify** the question against the findings: is it a **critical** decision only the user can
     make (high-stakes, irreversibility, a subjective product/architecture tradeoff)? → use
     **AskUserQuestion** to get the answer. Otherwise it is **non-critical** → answer it yourself from
     the topic + findings (Maestro self-answers).
  3. **Write** the reply to a temp file, then `$CS send --from maestro <INST> <TOPIC> @<reply-file>`.
  4. `rm -f $ART/research-<INST>.done` and **re-arm** the background `$CS score research-wait <TOPIC>
     <INST> <PROV>`. (The wait resumes past the question — it never re-sends the research prompt.)
- **`FS=failed` / `FS=timeout`** — the part produced no usable findings; drop it.

**Proceed only when every part is terminal** (no `FS=question` outstanding). Then build the **diff
roster** = parts whose `findings.md` exists (`FS` ∈ {ok, empty, malformed}). If **<2** parts have
findings → abort (run `/consort:coda <instrument> <TOPIC>` for each ready part, tell the user the
ensemble could not produce 2 sets of findings, stop). If some parts were dropped, **rewrite
`$ART/roster.txt`** to the diff roster before Stage 6.

## Stage 6 — N-way diff

`$CS score diff <TOPIC>` — N-way Venn bucketing over the parts' `findings.md`. It writes `$ART/diff.md`
plus the bucket files (`<inst>_only_items.txt` for N=2; `consensus.txt` + `<a>+<b>_only.txt` + singles
for N=3). rc 1 = `diff.md` already exists (`rm` to retry) or a `findings.md` is missing.

> **Phase C ends here.** Cross-verify → adjudicate → the interactive design walk → the deploy-audit
> gate land in **Phase D**; multi-repo + the execution DAG in **Phase E**; drilldown, forensics,
> teardown, and `present` in **Phase F**. The buckets are in `$ART/diff.md`. The parts are still live —
> run `/consort:coda <instrument> <TOPIC>` for each to tear them down (Phase F automates this). No
> design doc is produced on the escalation path until Phase D.
```

Also update the closing **Notes** so the "escalation pipeline … arrives in later phases" bullet reads:
"the cross-verify → adjudicate → design walk → audit (Phase D), multi-repo + execution-DAG (Phase E),
and drilldown/forensics/teardown/present (Phase F) arrive in later phases."

- [ ] **Step 3: Rebuild the bundle**

Run: `npm run build`
Expected: `dist/consort.cjs` regenerated (esbuild prints the bundle size).

- [ ] **Step 4: Run the stale-token gate + full suite**

Run: `npx vitest run tests/stale-tokens.test.ts && npm run test`
Expected: PASS. The gate scans `src config commands hooks .claude-plugin` for
`clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_` (case-sensitive) and
`trooper`/`commander` (case-insensitive). If the directive or `composeResearchPrompt` introduced any,
**fix the offending file** (rephrase the prose) — never weaken the gate.

- [ ] **Step 5: Commit**

```bash
git add commands/score.md dist/consort.cjs
git commit -m "feat(score): score.md Stages 3-6 escalation (spawn-all → research → diff) + rebuild dist"
```

---

### Task 10: Full gate + live tmux dogfood + DOGFOOD.md

**Files:**
- Verify: all quality gates
- Modify: `docs/superpowers/DOGFOOD.md` (append the Phase C section)

This is the phase gate: the escalation path must drive **real model parts** end-to-end through spawn →
research → diff.

- [ ] **Step 1: Run every quality gate**

```bash
npm run typecheck && npm run lint && npm run test
```
Expected: `tsc` 0, eslint 0, all vitest suites green (Phase B's count + the new `score-turn`,
`score-spawn`, and `score-escalation` suites + the `score-init` ART case).

- [ ] **Step 2: Confirm a usable roster exists**

The escalation path needs ≥2 `consult_validated` providers in the curated active set. Check:

```bash
node dist/consort.cjs soundcheck roster-plan 2>&1 | head -20   # or inspect ~/.consort/providers-active.txt
```
If fewer than 2 validated providers are installed/active, run `/consort:soundcheck` to curate the set
first (or temporarily mark two installed providers `consult_validated: true` in
`config/contracts.yaml` for the dogfood). Note in DOGFOOD.md which two parts ran.

- [ ] **Step 3: Live dogfood (inside tmux)**

In a tmux session, with an isolated home and the plugin root pointed at the repo:

```bash
export CONSORT_HOME="$(mktemp -d)"
export CLAUDE_PLUGIN_ROOT="$PWD"
```

Then run `/consort:score --ensemble <a bounded, real, single-repo research topic>` (e.g. a question
about this repo's own IPC contract). Drive the directive through Stages 3–6 and **observe**:
1. `score spawn-all` opens N panes and all parts reach `ready` (rc 0); `spawn-results.tsv` written.
2. Each part receives the research prompt, writes `findings.md`, emits `done` (or `question` → confirm
   the relay re-arms the background wait and resumes past the question without re-sending).
3. After all parts terminal, `score diff` writes `diff.md` + the bucket files.

- [ ] **Step 4: Verify the artifacts**

```bash
ART="$CONSORT_HOME/state/$(node dist/consort.cjs ... )/<TOPIC>/_score"   # or: find "$CONSORT_HOME/state" -type d -name _score
ls "$ART"                              # research-*.txt, spawn-results.tsv, diff.md, bucket files
grep '^FS=' "$ART"/research-*.txt | tail -n +1
cat "$ART/diff.md"
for d in "$CONSORT_HOME/state"/*/<TOPIC>/*-*/; do test -f "$d/findings.md" && echo "OK $d"; done
```
Expected: each surviving part has a `findings.md`; `diff.md` has the `## Agreed`/`-only` (N=2) or
`## Consensus`/pairs/singles (N=3) buckets; every `research-*.txt` ends in a terminal `FS=`.

- [ ] **Step 5: Tear down the dogfood parts**

```bash
node dist/consort.cjs coda <instrument> <TOPIC>    # once per part (Phase F automates this)
```

- [ ] **Step 6: Append the Phase C dogfood section to `docs/superpowers/DOGFOOD.md`**

Record: the topic, the two/three parts (instrument:provider), the spawn-all rc, whether a question
relay fired, the `FS=` outcomes, the `diff.md` bucket shape, and PASS/FAIL. Note any deviation observed
vs the plan.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/DOGFOOD.md config/contracts.yaml 2>/dev/null
git commit -m "docs(score): Phase C live dogfood (spawn-all → research → diff)"
```

(Only add `config/contracts.yaml` if you toggled a `consult_validated` flag for the dogfood and intend
to keep it; otherwise revert that change before committing.)

---

## Final review (after all tasks)

Dispatch a holistic code reviewer over the Phase C diff. Confirm:
- `core/scoreTurn.ts` reuses `parseClaims` (not a re-implementation) and `parseLatestOffset` reads the
  **last** offset (re-arm correctness).
- `research-wait` always writes the `.done` sentinel and returns 0; the question branch appends a
  bumped `OFFSET=` + `FS=question` so a re-armed wait resumes past the question.
- `spawn-all` order: roster order → preflight `--roster` order → `Promise.all` spawn → `spawn-results.tsv`
  row order; rc tally matches `spawn-batch.sh`.
- `diff` part order = roster order (the first-match-wins Venn depends on it).
- No frozen-protocol term renamed; the stale-token gate is green; `dist/consort.cjs` is in sync with
  `src/`.
- The directive only does Read / Write / AskUserQuestion / background-wait; every mechanical step is a
  CLI subcommand (D10).

Then hand off via **superpowers:finishing-a-development-branch** — but per the user's standing choice
("PR later"), keep the branch (option 3) and continue to **Phase D** rather than opening the PR now.
