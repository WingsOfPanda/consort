# consort score — Phase B (init + fast-path) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `score init` + the Maestro fast-path so `/consort:score` produces a deploy-audit-passing design doc end-to-end on a bounded topic — no parts spawned.

**Architecture:** Reuses the Phase A pure core (`score.ts`, `audit.ts`, `scoreDoc.ts`). Adds a verb-dispatched `commands/score.ts` (`init` + `assemble`), one dispatcher entry, and `commands/score.md` Stages 0–2 (args-file fence → routing → fast-path draft+assemble+audit). The escalation branch is a clearly-marked stub deferred to Phases C–E.

**Tech Stack:** TypeScript (ES2022/NodeNext/strict), vitest, esbuild → committed `dist/consort.cjs`, eslint (`no-unused-vars: error`). ESM `.js` imports.

**Spec:** `docs/superpowers/specs/2026-05-29-consort-score-design.md` (§4 surface, §5 Stages 0–2, §3 decisions).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/core/instruments.ts` | add `pickInstruments(topic, n, rng)` — N distinct picks | **Modify** |
| `src/core/score.ts` | add `scoreDocPath`, `formatRosterFile`/`parseRosterFile`, `parseMultiRepoMode` | **Modify** |
| `src/commands/score.ts` | verb dispatch + `init` (testable seam) + `assemble` | **Create** |
| `src/consort.ts` | register the `score` handler | **Modify** |
| `commands/score.md` | the directive: Stages 0–2 (fast-path); escalate = stub | **Create** |
| `tests/score-init.test.ts`, `tests/score-assemble.test.ts`, `tests/instruments.test.ts` (extend) | unit tests | **Create/Modify** |

**Reused (Phase A + foundation):** `deriveSlug`/`scoreArtDir`/`scoreDraftDir`/`parseScoreArgs` (`core/score.ts`), `auditDoc` (`core/audit.ts`), `assembleDoc`/`SECTIONS_*` (`core/scoreDoc.ts`), `readProviderList` (`core/providers.ts`), `activeProvidersPath` (`core/paths.ts`), `instrumentConsultValidated` (`core/contracts.ts`), `atomicWrite` (`core/atomic.ts`), `isoUtc` (`core/archive.ts`), `applyArgsFile` (`args.ts`), `log` (`core/log.ts`). The dispatcher's global `--mint-args-file`/`--args-file` handling (`consort.ts:42-46`) works for free.

**Conventions reaffirmed:**
- `score init` is made **deterministically testable** via an injected-deps seam (`ScoreInitDeps`) — mirrors `solo.ts`'s `initWith(tokens, InitDeps)` and avoids the "tests gate on codex-on-PATH" flaw the roster-picker review caught.
- The score **topic id is the bare slug** (e.g. `auth`), consistent with `solo`'s convention; `_score` distinguishes it from `_solo` within the same topic dir.
- `topic.txt` holds the **raw topic text** (the doc H1 title = its first line + the research corpus) — matching clone-wars consult (NOT solo's slug-in-topic.txt).
- Stale-token gate bans `clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_` in `src config commands hooks .claude-plugin`.

---

## Task 1: `instruments.ts` — `pickInstruments(topic, n, rng)`

**Files:** Modify `src/core/instruments.ts`; Test `tests/instruments.test.ts` (extend).

- [ ] **Step 1: Write the failing test** (append; merge `pickInstruments` into the existing `../src/core/instruments.js` import)

```ts
import { pickInstruments } from "../src/core/instruments.js"; // merge into existing import line

describe("pickInstruments", () => {
  it("returns n DISTINCT instruments from the pool", () => {
    process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "pi-"));
    process.env.CLAUDE_PLUGIN_ROOT = process.cwd();
    const picks = pickInstruments("t-distinct", 3);
    expect(picks).toHaveLength(3);
    expect(new Set(picks).size).toBe(3);
  });
  it("deterministic with a fixed rng (always index 0 → first available, no repeats)", () => {
    process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "pi2-"));
    process.env.CLAUDE_PLUGIN_ROOT = process.cwd();
    const picks = pickInstruments("t-fixed", 2, () => 0);
    expect(new Set(picks).size).toBe(2); // index-0 each round, but picked are excluded → 2 distinct
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instruments.test.ts`
Expected: FAIL — `pickInstruments` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/core/instruments.ts`)

```ts
/** Pick n DISTINCT instruments for a topic. Prefers globally-unused names; falls back to
 *  topic-unused; already-picked-this-call are always excluded. Returns up to n (fewer if the
 *  pool is exhausted). Generalizes pickRandomInstrument for the N-part score ensemble. */
export function pickInstruments(topic: string, n: number, rng: () => number = Math.random): string[] {
  const pool = loadInstrumentPool();
  const globalUsed = new Set(instrumentsInUseGlobally());
  const localUsed = new Set(instrumentsInUseInTopic(topic));
  const picked: string[] = [];
  for (let k = 0; k < n; k++) {
    let candidates = pool.filter((x) => !globalUsed.has(x) && !picked.includes(x));
    if (candidates.length === 0) candidates = pool.filter((x) => !localUsed.has(x) && !picked.includes(x));
    if (candidates.length === 0) break;
    picked.push(candidates[Math.floor(rng() * candidates.length)]);
  }
  return picked;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/instruments.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/instruments.ts tests/instruments.test.ts
git commit -m "feat(instruments): pickInstruments — n distinct picks for the score ensemble"
```

---

## Task 2: `score.ts` — doc path + roster file + multi-repo mode helpers

**Files:** Modify `src/core/score.ts`; Test `tests/score-core.test.ts` (extend).

- [ ] **Step 1: Write the failing test** (append; merge the new names into the existing `../src/core/score.js` import)

```ts
import { scoreDocPath, formatRosterFile, parseRosterFile, parseMultiRepoMode } from "../src/core/score.js";

describe("scoreDocPath", () => {
  it("canonical design-doc path under design-doc/", () => {
    process.env.CONSORT_HOME = "/R";
    expect(scoreDocPath("auth", "2026-05-29").endsWith(join("auth", "_score", "design-doc", "2026-05-29-auth-design.md"))).toBe(true);
  });
});

describe("roster file", () => {
  it("format then parse round-trips provider/instrument rows", () => {
    const rows = [{ provider: "codex", instrument: "viola" }, { provider: "claude", instrument: "cello" }];
    const text = formatRosterFile(rows, "2026-05-29T00:00:00Z");
    expect(text).toContain("by /consort:score");
    expect(parseRosterFile(text)).toEqual(rows);
  });
  it("parse skips #/blank lines and rows missing a field", () => {
    expect(parseRosterFile("# h\ncodex\tviola\n\nbroken\n")).toEqual([{ provider: "codex", instrument: "viola" }]);
  });
});

describe("parseMultiRepoMode", () => {
  it("trims and validates; unknown/empty → single", () => {
    expect(parseMultiRepoMode("multi\n")).toBe("multi");
    expect(parseMultiRepoMode(" single-sub ")).toBe("single-sub");
    expect(parseMultiRepoMode("garbage")).toBe("single");
    expect(parseMultiRepoMode("")).toBe("single");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/score-core.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Write minimal implementation** (append to `src/core/score.ts`)

```ts
import { isoUtc } from "./archive.js"; // add to the import block if not present
import type { DocMode } from "./scoreDoc.js";

/** Canonical design-doc path: `_score/design-doc/<YYYY-MM-DD>-<topic>-design.md`. */
export function scoreDocPath(topic: string, dateUtc: string, opts?: { home?: string; cwd?: string }): string {
  return join(scoreArtDir(topic, opts), "design-doc", `${dateUtc}-${topic}-design.md`);
}

export interface RosterRow { provider: string; instrument: string; }

/** roster.txt body: a generated-comment header + one `<provider>\t<instrument>` row per part. */
export function formatRosterFile(rows: RosterRow[], isoStamp: string): string {
  const body = rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n");
  return `# generated ${isoStamp} by /consort:score\n${body}${rows.length ? "\n" : ""}`;
}

/** Parse roster.txt: skip #/blank lines; keep rows with both fields. */
export function parseRosterFile(text: string): RosterRow[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => { const [provider, instrument] = l.split("\t"); return { provider, instrument }; })
    .filter((r) => r.provider && r.instrument) as RosterRow[];
}

/** multi-repo.txt value, whitespace-stripped; anything not single-sub/multi → "single". */
export function parseMultiRepoMode(text: string): DocMode {
  const v = text.replace(/\s/g, "");
  return v === "multi" ? "multi" : v === "single-sub" ? "single-sub" : "single";
}
```

(`isoUtc` is used by Task 3's `init`; importing it here is fine — it is consumed by `formatRosterFile` callers. If lint flags it unused in `score.ts`, move the import to where first used in Task 3.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/score-core.test.ts`
Expected: PASS (Task-1-phase score-core tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/core/score.ts tests/score-core.test.ts
git commit -m "feat(score): doc-path + roster-file + multi-repo-mode helpers"
```

---

## Task 3: `commands/score.ts` — dispatcher + `init`

**Files:** Create `src/commands/score.ts`; Test `tests/score-init.test.ts`.
**Source:** `clone-wars/bin/consult-init.sh` (roster load, N handling, slug, skeleton). Testable via `ScoreInitDeps`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/score-init.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scoreArtDir, scoreDraftDir } from "../src/core/score.js";
import { initWith, type ScoreInitDeps } from "../src/commands/score.js";

let prev: string | undefined;
beforeEach(() => { prev = process.env.CONSORT_HOME; process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "si-")); });
afterEach(() => { if (prev === undefined) delete process.env.CONSORT_HOME; else process.env.CONSORT_HOME = prev; });

function deps(providers: string[], picks: string[]): ScoreInitDeps {
  return { activeProviders: () => providers, isValidated: () => true, pickInstruments: () => picks };
}

describe("score init", () => {
  it("happy path: scaffold + roster.txt + topic.txt + KV stdout (rc 0)", async () => {
    const rc = await initWith(["compare", "LRU", "vs", "LFU"], deps(["codex", "claude"], ["viola", "cello"]));
    expect(rc).toBe(0);
    const art = scoreArtDir("compare-lru-vs-lfu");
    expect(existsSync(scoreDraftDir("compare-lru-vs-lfu"))).toBe(true);
    expect(readFileSync(join(art, "topic.txt"), "utf8")).toBe("compare LRU vs LFU");
    const roster = readFileSync(join(art, "roster.txt"), "utf8");
    expect(roster).toContain("codex\tviola");
    expect(roster).toContain("claude\tcello");
  });
  it("empty topic → rc 1", async () => {
    expect(await initWith([], deps(["codex", "claude"], ["viola", "cello"]))).toBe(1);
  });
  it("N<2 validated providers → redirect, rc 1, no scaffold", async () => {
    const rc = await initWith(["x"], deps(["codex"], ["viola"]));
    expect(rc).toBe(1);
    expect(existsSync(scoreArtDir("x"))).toBe(false);
  });
  it("caps the roster to the first 3 providers", async () => {
    await initWith(["big"], deps(["codex", "claude", "agy", "opencode"], ["a", "b", "c"]));
    const roster = readFileSync(join(scoreArtDir("big"), "roster.txt"), "utf8");
    expect(roster.trim().split("\n").filter((l) => !l.startsWith("#"))).toHaveLength(3);
  });
  it("--targets a,b → multi-repo.txt=multi + targets.txt", async () => {
    await initWith(["--targets", "api,web", "refactor"], deps(["codex", "claude"], ["viola", "cello"]));
    const art = scoreArtDir("refactor");
    expect(readFileSync(join(art, "multi-repo.txt"), "utf8").trim()).toBe("multi");
    expect(readFileSync(join(art, "targets.txt"), "utf8")).toContain("api");
  });
  it("in-flight (art dir exists) → rc 2", async () => {
    const d = deps(["codex", "claude"], ["viola", "cello"]);
    await initWith(["dup"], d);
    expect(await initWith(["dup"], d)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/score-init.test.ts`
Expected: FAIL — `../src/commands/score.js` missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/commands/score.ts
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { applyArgsFile } from "../args.js";
import { atomicWrite } from "../core/atomic.js";
import { isoUtc } from "../core/archive.js";
import {
  deriveSlug, parseScoreArgs, scoreArtDir, scoreDraftDir,
  formatRosterFile, type RosterRow,
} from "../core/score.js";
import { readProviderList } from "../core/providers.js";
import { activeProvidersPath } from "../core/paths.js";
import { instrumentConsultValidated } from "../core/contracts.js";
import { pickInstruments } from "../core/instruments.js";

function usage(): number { log.error("usage: score <init|assemble> ..."); return 2; }

export async function run(args: string[]): Promise<number> {
  const verb = args[0];
  const rest = args.slice(1);
  switch (verb) {
    case "init": return initRun(applyArgsFile(rest));
    case "assemble": return assembleRun(rest);
    default: return usage();
  }
}

export interface ScoreInitDeps {
  activeProviders(): string[];
  isValidated(provider: string): boolean;
  pickInstruments(topic: string, n: number): string[];
}
const liveInitDeps: ScoreInitDeps = {
  activeProviders: () => readProviderList(activeProvidersPath()),
  isValidated: instrumentConsultValidated,
  pickInstruments,
};

async function initRun(tokens: string[]): Promise<number> { return initWith(tokens, liveInitDeps); }

export async function initWith(tokens: string[], d: ScoreInitDeps): Promise<number> {
  const { topicText, ensemble, targets } = parseScoreArgs(tokens);
  if (!topicText) { log.error("score init: topic text is empty"); return 1; }
  const topic = deriveSlug(topicText);
  if (!topic) { log.error("score init: topic produced an empty slug; provide alphanumerics"); return 1; }

  let roster = d.activeProviders().filter((p) => d.isValidated(p));
  if (roster.length < 2) {
    log.error(`score init: needs >=2 consult-validated providers; got ${roster.length}`);
    log.error("  just ask Claude directly (this session) — no /consort:score orchestration needed");
    return 1;
  }
  if (roster.length > 3) { log.warn(`score init: ${roster.length} providers available; capping the ensemble to the first 3`); roster = roster.slice(0, 3); }

  const art = scoreArtDir(topic);
  if (existsSync(art)) { log.error(`score init: topic already in flight: ${art}`); log.error("  run /consort:coda or pick a different topic"); return 2; }

  const instruments = d.pickInstruments(topic, roster.length);
  if (instruments.length < roster.length) { log.error(`score init: instrument pool exhausted (need ${roster.length}, got ${instruments.length})`); return 1; }
  const rows: RosterRow[] = roster.map((provider, i) => ({ provider, instrument: instruments[i] }));

  mkdirSync(scoreDraftDir(topic), { recursive: true }); // creates _score/design-doc/.draft
  atomicWrite(join(art, "topic.txt"), topicText);
  atomicWrite(join(art, "roster.txt"), formatRosterFile(rows, isoUtc()));
  const mode = targets.length >= 2 ? "multi" : targets.length === 1 ? "single-sub" : "single";
  atomicWrite(join(art, "multi-repo.txt"), mode + "\n");
  if (targets.length > 0) atomicWrite(join(art, "targets.txt"), `# generated ${isoUtc()} by /consort:score\n${targets.join("\n")}\n`);

  log.ok(`score init: topic=${topic} N=${rows.length} ensemble=${ensemble ? "yes" : "no"} mode=${mode}`);
  process.stdout.write(
    `TOPIC=${topic}\nN=${rows.length}\nENSEMBLE=${ensemble ? "yes" : "no"}\nMODE=${mode}\n` +
    rows.map((r) => `PART=${r.instrument}:${r.provider}`).join("\n") + "\n",
  );
  return 0;
}

// assembleRun lands in Task 4.
async function assembleRun(_rest: string[]): Promise<number> { return 0; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/score-init.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands/score.ts tests/score-init.test.ts
git commit -m "feat(score): init subcommand (roster load, scaffold, N cap/redirect, --targets)"
```

---

## Task 4: `commands/score.ts` — `assemble` + dispatcher registration

**Files:** Modify `src/commands/score.ts`; Modify `src/consort.ts`; Test `tests/score-assemble.test.ts`.
**Source:** `clone-wars/bin/consult-walk-assemble.sh` (concat + audit + ISSUE on fail).

- [ ] **Step 1: Write the failing test**

```ts
// tests/score-assemble.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scoreArtDir, scoreDraftDir, scoreDocPath } from "../src/core/score.js";
import { run as score } from "../src/commands/score.js";

let prev: string | undefined;
beforeEach(() => { prev = process.env.CONSORT_HOME; process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "sa-")); });
afterEach(() => { if (prev === undefined) delete process.env.CONSORT_HOME; else process.env.CONSORT_HOME = prev; });

function scaffold(topic: string, sections: Record<string, string>) {
  const dd = scoreDraftDir(topic); mkdirSync(dd, { recursive: true });
  writeFileSync(join(scoreArtDir(topic), "topic.txt"), "My Topic Title");
  writeFileSync(join(scoreArtDir(topic), "multi-repo.txt"), "single\n");
  for (const [k, v] of Object.entries(sections)) writeFileSync(join(dd, `${k}.md`), v);
}
function cap() { const c: string[] = []; const s = vi.spyOn(process.stdout, "write").mockImplementation(((x: unknown) => { c.push(String(x)); return true; }) as never); return { text: () => c.join(""), restore: () => s.mockRestore() }; }

const FULL = {
  problem: "## Problem\n\np", goal: "## Goal\n\ng", architecture: "## Architecture\n\na",
  components: "## Components\n\nc", testing: "## Testing\n\nt", "success-criteria": "## Success Criteria\n\ns",
};

describe("score assemble", () => {
  it("audit PASS: writes the doc + audit.log, prints the doc path, rc 0", async () => {
    scaffold("ok-topic", FULL);
    const c = cap();
    const rc = await score(["assemble", "ok-topic"]);
    c.restore();
    expect(rc).toBe(0);
    const date = new Date().toISOString().slice(0, 10);
    const docPath = scoreDocPath("ok-topic", date);
    expect(existsSync(docPath)).toBe(true);
    expect(readFileSync(docPath, "utf8")).toMatch(/^# My Topic Title\n/);
    expect(existsSync(join(scoreArtDir("ok-topic"), "design-doc", "audit.log"))).toBe(true);
    expect(c.text()).toContain(docPath);
  });
  it("audit FAIL (missing Goal): rc 1, emits ISSUE= lines", async () => {
    const partial = { ...FULL }; delete (partial as Record<string, string>).goal;
    scaffold("bad-topic", partial);
    const errs: string[] = [];
    const s = vi.spyOn(process.stderr, "write").mockImplementation(((x: unknown) => { errs.push(String(x)); return true; }) as never);
    const rc = await score(["assemble", "bad-topic"]);
    s.mockRestore();
    expect(rc).toBe(1);
    expect(errs.join("")).toContain("ISSUE=no_goal_section");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/score-assemble.test.ts`
Expected: FAIL — `assemble` is the stub (returns 0, writes nothing).

- [ ] **Step 3: Implement `assemble`** (replace the stub in `src/commands/score.ts`; add imports)

Add imports:

```ts
import { readFileSync } from "node:fs";
import { scoreDocPath, parseRosterFile, parseMultiRepoMode } from "../core/score.js"; // merge into the existing score.js import
import { assembleDoc, SECTIONS_SINGLE, SECTIONS_MULTI, type DocMode } from "../core/scoreDoc.js";
import { auditDoc } from "../core/audit.js";
```

Replace the `assembleRun` stub:

```ts
function readIf(path: string): string { return existsSync(path) ? readFileSync(path, "utf8") : ""; }

async function assembleRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: score assemble <topic>"); return 2; }
  const art = scoreArtDir(topic);
  const draftDir = scoreDraftDir(topic);
  if (!existsSync(draftDir)) { log.error(`score assemble: no draft dir at ${draftDir} (run score init + draft sections)`); return 2; }

  const title = (readIf(join(art, "topic.txt")).split("\n")[0] || topic).trim();
  const mode: DocMode = parseMultiRepoMode(readIf(join(art, "multi-repo.txt")));
  const targets = mode === "single" ? [] : parseRosterTargets(readIf(join(art, "targets.txt")));
  const keys = mode === "multi" ? SECTIONS_MULTI : SECTIONS_SINGLE;
  const drafts = new Map<string, string>();
  for (const k of keys) { const f = join(draftDir, `${k}.md`); if (existsSync(f)) drafts.set(k, readFileSync(f, "utf8").replace(/\n+$/, "")); }

  const date = isoUtc().slice(0, 10);
  const doc = assembleDoc({ title, mode, date, targets, drafts });
  const out = scoreDocPath(topic, date);
  mkdirSync(join(art, "design-doc"), { recursive: true });
  atomicWrite(out, doc);

  const result = auditDoc(doc);
  const auditText = [`VERDICT=${result.verdict}`, ...result.issues.map((i) => `ISSUE=${i}`)].join("\n") + "\n";
  atomicWrite(join(art, "design-doc", "audit.log"), auditText);
  if (result.verdict === "FAIL") {
    for (const i of result.issues) process.stderr.write(`ISSUE=${i}\n`);
    log.error(`score assemble: audit FAILED on ${out} (see design-doc/audit.log)`);
    return 1;
  }
  log.ok(`score assemble: audit PASSED`);
  process.stdout.write(out + "\n");
  return 0;
}

/** targets.txt may be a plain slug-per-line list (init) or a TSV (multi-repo detect, Phase E). */
function parseRosterTargets(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => l.split("\t")[0]).filter(Boolean);
}
```

Then register the handler in `src/consort.ts` — add `import("./commands/score.js")` to the `Promise.all` in `loadHandlers()` and `score: score.run` to the returned map:

```ts
  const [spawn, send, collect, roster, coda, soundcheck, preflight, hook, solo, score] = await Promise.all([
    import("./commands/spawn.js"), import("./commands/send.js"), import("./commands/collect.js"),
    import("./commands/roster.js"), import("./commands/coda.js"), import("./commands/soundcheck.js"),
    import("./commands/preflight.js"), import("./commands/hook.js"), import("./commands/solo.js"),
    import("./commands/score.js"),
  ]);
  return {
    spawn: spawn.run, send: send.run, collect: collect.run, roster: roster.run,
    coda: coda.run, soundcheck: soundcheck.run, preflight: preflight.run, hook: hook.run,
    solo: solo.run, score: score.run,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/score-assemble.test.ts tests/consort-dispatch.test.ts`
Expected: PASS (2 new + dispatch suite still green). Then `npm run typecheck && npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/commands/score.ts src/consort.ts tests/score-assemble.test.ts
git commit -m "feat(score): assemble subcommand (concat + audit gate) + dispatcher entry"
```

---

## Task 5: `commands/score.md` — directive Stages 0–2

**Files:** Create `commands/score.md`; Test `npx vitest run tests/stale-tokens.test.ts`.

- [ ] **Step 1: Create the directive**

```markdown
---
description: Cross-verified multi-model research synthesized into a deploy-audit-passing design doc — Maestro fast-path or escalate to a 2-3 part ensemble
argument-hint: [--ensemble] [--targets a,b,c] <topic — what to research / design>
allowed-tools: Bash, Write, Read, Edit, AskUserQuestion, WebSearch, Skill
---

# /consort:score

Run a cross-verified multi-model investigation on `$ARGUMENTS` and produce a single
deploy-schema design doc (Problem / Goal / Architecture / Components / Testing / Success
Criteria) that passes the deploy-audit gate — the artifact `/consort:perform` will consume.

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

## Stage 0 — args-file + init

1. Mint an args path: `$CS score --mint-args-file` → prints `<args-path>`.
2. **Write tool:** `file_path` = `<args-path>`, `content` = `$ARGUMENTS` (verbatim, unquoted).
3. Init: `$CS score init --args-file <args-path>`. On success it prints to stdout:
   ```
   TOPIC=<slug>
   N=<2|3>
   ENSEMBLE=<yes|no>
   MODE=<single|single-sub|multi>
   PART=<instrument>:<provider>   (one per part)
   ```
   Non-zero aborts: rc 1 = empty topic OR fewer than 2 validated providers (redirect: just ask
   Claude directly — no orchestration needed); rc 2 = topic already in flight. Capture `TOPIC`/`N`/
   `ENSEMBLE` for later stages.

## Stage 1 — routing

Decide fast-path vs escalation, in order:

1. `ENSEMBLE=yes` → **escalate**. Path label = `escalated-from-flag`.
2. Otherwise, run a **time-boxed solo research pass** on the topic (Read/Grep/Bash for repo code;
   WebSearch + any `mcp__tavily`/`mcp__anysearch` per the user's triple-search rule; `mcp__context7`
   for library docs; `mcp__codegraph` for code intelligence; relevant `superpowers:*` skills), then
   run the **4-signal complexity check** — escalate if **any one** fires (favor rigor):
   - **Conflicting evidence** — sources disagreed on a key claim.
   - **Significant assumptions** — you had to assume facts not in evidence.
   - **High-stakes** — architecture / security / irreversibility / production data.
   - **Subjective tradeoffs** — no objective right answer (A vs B, should-we-adopt-X).
   If any fires → **escalate**, Path label = `escalated-from-signals`.
3. None fire → **fast-path**, Path label = `fast`.

> **Phase B scope:** the **escalation** path (spawn a 2-3 part ensemble → research → diff →
> cross-verify → adjudicate → walk → audit) is **not yet built** — it lands in Phases C–E. For now,
> if Stage 1 selects escalation, tell the user plainly: "the cross-verified ensemble path is not yet
> available in this build; producing a Maestro-solo (fast-path) doc instead — re-run once the
> ensemble phase ships for cross-verification," then proceed to Stage 2. (When Phases C–E land, this
> stub is replaced by the real escalation pipeline.)

## Stage 2 — fast-path (Maestro solo)

You have already researched the topic in Stage 1 (or research it now if you arrived via the flag).
Draft the **6 deploy-schema sections** to `<TOPIC art>/_score/design-doc/.draft/<section>.md` using
the **Write tool** (atomic single-shot writes), one file per section:

- `.draft/problem.md` → `## Problem` + 1-3 sentences on the current state.
- `.draft/goal.md` → `## Goal` + 1 paragraph on the end state. *(audit-required — never empty)*
- `.draft/architecture.md` → `## Architecture` + the recommended approach (the bulk). *(required)*
- `.draft/components.md` → `## Components` + bullets of files/functions/classes touched.
- `.draft/testing.md` → `## Testing` + bullets of test coverage. *(required)*
- `.draft/success-criteria.md` → `## Success Criteria` + measurable bullets. *(required)*

Each section body should cite sources inline where applicable (`path/to/file:line`, URLs, runtime
observations). Audit-required sections must NOT be empty; if a section truly doesn't apply, still
emit the heading + a one-line explanation (never `_(skipped)_` on the four required ones).

Then assemble + audit: `$CS score assemble <TOPIC>`.
- **rc 0** → it prints the design-doc path. **Read and present** the doc to the user, then point at
  the next step: `/consort:perform <path>` (once perform ships).
- **rc 1** (audit FAIL) → it printed `ISSUE=<code>` lines to stderr. Map each to its section
  (`no_goal_section`→goal, `no_arch_section`→architecture, `no_testing_section`→testing,
  `no_success_section`→success-criteria, `tbd_marker`/`todo_marker`/`fill_in_later_marker`/
  `to_be_determined_marker`→the section you left a marker in, `unresolved_placeholder`→architecture),
  **re-draft** the offending `.draft/<section>.md` (Write tool), and **re-run `$CS score assemble
  <TOPIC>` once**. If it FAILs again → surface the remaining ISSUE list to the user and stop.

## Notes

- Fast-path spawns no parts and writes no working artifacts beyond `topic.txt`, `.draft/*.md`, the
  assembled `design-doc/<date>-<slug>-design.md`, and `audit.log`. No teardown needed.
- The escalation pipeline (ensemble, diff, cross-verify, adjudicate, the interactive design walk,
  multi-repo execution-DAG, drilldown) arrives in later phases.
```

- [ ] **Step 2: Run the stale-token gate**

Run: `npx vitest run tests/stale-tokens.test.ts`
Expected: PASS (5 tests; no banned tokens in the directive).

- [ ] **Step 3: Commit**

```bash
git add commands/score.md
git commit -m "feat(score): directive Stages 0-2 (init + routing + fast-path); escalation stubbed"
```

---

## Task 6: build + fast-path dogfood

**Files:** Modify `dist/consort.cjs` (rebuilt), `docs/superpowers/DOGFOOD.md`.

- [ ] **Step 1: Full gates + build**

Run: `npm run typecheck && npm run lint && npm run test` (all clean/green: the new `score-init`/`score-assemble` suites + extended `instruments`/`score-core` + dispatch + stale-token gate). Then `npm run build` → `dist/consort.cjs` rebuilt; confirm `node dist/consort.cjs score` prints the `usage: score <init|assemble>` line on stderr (rc 2).

- [ ] **Step 2: Live fast-path dogfood** (controller-run; the fast-path is Maestro-solo so **no tmux/parts needed**)

Under an isolated `CONSORT_HOME` with `CLAUDE_PLUGIN_ROOT=$PWD`, drive the directive's fast-path by hand on a bounded topic (one where the 4 signals don't fire), e.g. "what does `repoHash` do in consort":
1. `score --mint-args-file` → Write `$ARGUMENTS` → `score init --args-file …` → capture `TOPIC`/`N`. (Requires `providers-available.txt` present — run `soundcheck` first, or stage it.)
2. As Maestro, draft the 6 `.draft/<section>.md` sections from real research.
3. `score assemble <TOPIC>` → confirm `VERDICT=PASS`, the doc written at `design-doc/<date>-<slug>-design.md`, `audit.log` present, doc path printed.
4. Exercise the audit-retry: temporarily blank `goal.md`, re-assemble → confirm `ISSUE=no_goal_section` on stderr + rc 1; restore + re-assemble → PASS.

- [ ] **Step 3: Append the dogfood result to `DOGFOOD.md`**

Append a `# Consort score — Phase B (fast-path) Dogfood Result` section: date, verdict, the run (init → draft → assemble PASS, the audit-FAIL retry), and any bugs/fixes. Mirror the existing sections' format.

- [ ] **Step 4: Commit**

```bash
git add dist/consort.cjs docs/superpowers/DOGFOOD.md
git commit -m "build(score): rebuild dist + Phase B fast-path dogfood record"
```

---

## Self-Review (run by the plan author — recorded here)

**1. Spec coverage (Phase B):** `score init` — roster load + N cap/redirect + slug + `--ensemble`/`--targets` + scaffold + roster.txt (T3, deterministic via `ScoreInitDeps`). `score assemble` — concat + audit + ISSUE/rc (T4) reusing `assembleDoc`+`auditDoc`. Dispatcher entry (T4). `commands/score.md` Stages 0–2 routing + fast-path + audit-retry (T5); escalation honestly stubbed (Phase B is fast-path only — flagged). `pickInstruments` N-distinct (T1); doc-path/roster/mode helpers (T2). Dogfood (T6).

**2. Placeholder scan:** No TBD/TODO/"implement later". The directive *instructs the conductor about* TBD/TODO markers (audit codes) — that's content. The escalation "stub" is a deliberate, documented Phase-B boundary, not a placeholder — Stages 0–2 are fully specified.

**3. Type consistency:** `ScoreInitDeps` (`activeProviders`/`isValidated`/`pickInstruments`) used by `initWith` + the live deps + tests. `RosterRow {provider,instrument}` consistent across `formatRosterFile`/`parseRosterFile`/`init`. `DocMode` (`single`/`single-sub`/`multi`) from `scoreDoc.ts` used by `parseMultiRepoMode` + `assembleRun`. `scoreDocPath(topic, date)` signature consistent T2↔T4. `assembleDoc` input shape matches Phase A. Dispatcher array/Map extended consistently with the existing 9 handlers.

**Carry-forward for Phase C:** `score init` writes the full roster.txt even on a fast-path run (instruments picked but unused until spawn) — intentional, so escalation reads the same roster. `parseRosterTargets` tolerates both the plain slug-list (init `--targets`) and the TSV form (Phase E multi-repo detect).
