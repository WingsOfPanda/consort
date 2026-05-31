# consort Simplification Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Apply the 24 behavior-preserving cleanups in Phases 1-3 of the simplification sweep — dead-code
removal, low-level helper consolidation, and sibling-idiom consistency — with zero observable behavior change.

**Architecture:** One branch (`chore/simplification-sweep`, already created), eight tasks T1-T8, safest-first.
Each task = one commit ending green. The existing 952-test suite is the regression gate; three new shared
helpers (`pluginRoot`, `readIfExists`/`readIfExistsOrNull`, `runForensics`) each get a focused unit test.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import suffixes), esbuild → committed `dist/consort.cjs`,
vitest, eslint.

**Guardrails (every task):** Never touch the FROZEN protocol (wire event names, `END_OF_INSTRUCTION`, JSON
wire fields, `contracts.yaml` keys, state filenames, `CLAUDE_CODE_SESSION_ID`). Never reintroduce a
stale token (`clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_`/`trooper`/`commander`) — including
in comments. Preserve atomic-write/absolute-path/`JSON.parse`-event-match invariants.

**The full-gate command (run as the verify step of every task):**
```bash
npm run typecheck && npm run test && npm run lint && npm run build && git diff --stat dist/consort.cjs
```
Expected: typecheck clean, all tests pass, lint clean, build succeeds, `dist/consort.cjs` rebuilt. Commit the
rebuilt `dist/consort.cjs` in the same commit as the source change.

**Ordering:** T1→T8. Tasks are largely independent; T3 should land before T7 (T7's helper calls prelude's
`readIf`, which T3 turns into an import alias — works either way, but sequencing avoids confusion).

---

## File Structure

| File | Change |
|---|---|
| `src/core/paths.ts` | +`pluginRoot()` (T2) |
| `src/core/fsread.ts` | **new** — `readIfExists` / `readIfExistsOrNull` (T3) |
| `src/core/forensics.ts` | +`runForensics()` (T5) |
| `src/core/multirepo.ts` | +`resolveMarker()` private helper (T6) |
| `src/core/score.ts` | +`nonCommentLines()`, +`parseRosterTargets()` (moved in); −`scoreDrilldownScratchDir` (T1) |
| `src/core/archive.ts`, `preludeConfidence.ts`, `performScope.ts`, `perform.ts` | dead-code removals (T1) |
| `src/core/ipc.ts`, `contracts.ts`, `instruments.ts`, `scoreSkill.ts` | drop local `pluginRoot` → import (T2) |
| `src/args.ts` | un-export `loadArgsFile`/`consumeArgsFile` (T1) |
| `src/consort.ts` | reuse `ansiFromColor` in `_banner` (T6) |
| `src/commands/coda.ts` | drop dead `topicDir` dep + tautological clause; import `pluginRoot` (T1/T2) |
| `src/commands/collect.ts` | drop dup `resolveModel` → import (T4) |
| `src/commands/soundcheck.ts` | drop local `pluginRoot` → import (T2) |
| `src/commands/solo.ts` | `readField` wrapper, `forensicsRun` delegate (T3/T5) |
| `src/commands/score.ts` | `readIf` import alias, `forensicsRun` delegate, move `parseRosterTargets` (T3/T5/T6); dep aliases (T7) |
| `src/commands/prelude.ts` | `readIf` import alias, `forensicsRun` delegate, `missingRosterArtifacts` (T3/T5/T7) |
| `src/commands/perform.ts` | `hasRepoMarker`, `forensicsRun` delegate (T5/T6) |
| `src/commands/rehearsal.ts` | `pluginRoot` import, `forensicsRun` delegate, `resultStr`/`gatherCompletion`, `usage()`, `finalizeWith` decompose (T2/T5/T6/T7/T8) |
| `src/core/preludeHandoff.ts` | `readIf`→`readIfExistsOrNull` import; `topApproach` alias (T3/T7) |
| `src/commands/roster.ts` | hoist double `outboxPath` (T6) |
| `tests/paths-pluginroot.test.ts`, `tests/fsread.test.ts`, `tests/forensics-run.test.ts` | **new** (T2/T3/T5) |

---

## Task T1: Phase 1 — dead-code / no-op / dead-export removals

**Files:** Modify `src/core/archive.ts`, `src/core/preludeConfidence.ts`, `src/commands/coda.ts`,
`src/core/performScope.ts`, `src/core/perform.ts`, `src/args.ts`, `src/core/score.ts`,
`tests/coda.test.ts`, `tests/score-core.test.ts`.

- [ ] **Step 1: archive.ts:7 — drop the no-op `.replace(/Z$/, "Z")`**

Old:
```ts
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "").replace(/Z$/, "Z");
```
New:
```ts
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
```

- [ ] **Step 2: preludeConfidence.ts:15 — drop the unreachable trailing strip**

Old:
```ts
      if (m) return m[1].replace(/\s+$/, "").replace(/\s+—.*$/, "").replace(/\s+$/, "");
```
New:
```ts
      if (m) return m[1].replace(/\s+$/, "").replace(/\s+—.*$/, "");
```

- [ ] **Step 3: coda.ts:83 — drop the self-reconstructing `===` clause**

Old:
```ts
      if (e.name === `${instrument}-${e.name.slice(instrument.length + 1)}` && e.name.startsWith(`${instrument}-`)) {
```
New:
```ts
      if (e.name.startsWith(`${instrument}-`)) {
```

- [ ] **Step 4: performScope.ts — remove the `void SLUG_REGEX` import-keepalive**

Delete line 10 (`import { SLUG_REGEX } from "./audit.js";`) and lines 12-14 (the two comment lines +
`void SLUG_REGEX;`). The file body never references `SLUG_REGEX`.

- [ ] **Step 5: perform.ts:11 — remove the dead `extractTarget` re-export**

First verify nothing imports it from `core/perform`:
```bash
grep -rn "extractTarget" src tests | grep -v "audit"
```
Expected: only `src/core/perform.ts:8` (the plain import used by `resolveTarget`). Then delete line 11:
```ts
export { extractTarget } from "./audit.js"; // REUSED: audit.ts already ports the target-header extractor.
```

- [ ] **Step 6: coda.ts — remove the never-dereferenced `topicDir` dep field**

In `CodaDeps` (line 19) delete `  topicDir(t: string): string;`. In `liveDeps()` (line 58) delete the
`    topicDir,` line. In `tests/coda.test.ts` delete the `topicDir: () => "/tmp/none",` stub line.
(`teardownBatch` uses the directly-imported `topicDir`, never `d.topicDir`.)

- [ ] **Step 7: args.ts — make `loadArgsFile` / `consumeArgsFile` module-private**

Drop the `export` keyword on both (lines 22 and 28): `export function loadArgsFile` → `function loadArgsFile`,
`export function consumeArgsFile` → `function consumeArgsFile`. Their only caller is `applyArgsFile` in the
same file. Verify no external importer first:
```bash
grep -rn "loadArgsFile\|consumeArgsFile" src tests | grep -v "src/args.ts"
```
Expected: no matches.

- [ ] **Step 8: score.ts — remove the dead export `scoreDrilldownScratchDir`**

Verify no shipped caller:
```bash
grep -rn "scoreDrilldownScratchDir" src tests
```
Expected: only its definition (`src/core/score.ts:142-145`) and its test (`tests/score-core.test.ts`). Delete
the function (the `/** _score/drilldowns/_scratch ... */` doc comment + the 3-line function) and delete the
corresponding `scoreDrilldownScratchDir` test block in `tests/score-core.test.ts`.

- [ ] **Step 9: Run the full gate**

```bash
npm run typecheck && npm run test && npm run lint && npm run build && git diff --stat dist/consort.cjs
```
Expected: all green; `dist/consort.cjs` shows changes.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "refactor(simplify): Phase 1 dead-code / no-op / dead-export removal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task T2: Extract `pluginRoot()` helper; replace the ~8 hand-rolled copies

**Files:** Modify `src/core/paths.ts`, `src/core/contracts.ts`, `src/core/instruments.ts`, `src/core/ipc.ts`,
`src/core/scoreSkill.ts`, `src/commands/soundcheck.ts`, `src/commands/coda.ts`, `src/commands/rehearsal.ts`.
Test: `tests/paths-pluginroot.test.ts` (new).

- [ ] **Step 1: Write the failing test** — `tests/paths-pluginroot.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { pluginRoot } from "../src/core/paths.js";

const ORIG = process.env.CLAUDE_PLUGIN_ROOT;
afterEach(() => { if (ORIG === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = ORIG; });

describe("pluginRoot", () => {
  it("returns CLAUDE_PLUGIN_ROOT when set", () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/x/plugin";
    expect(pluginRoot()).toBe("/x/plugin");
  });
  it("falls back to process.cwd() when unset", () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    expect(pluginRoot()).toBe(process.cwd());
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`pluginRoot` not exported yet)

```bash
npx vitest run tests/paths-pluginroot.test.ts
```
Expected: FAIL — `pluginRoot` is not exported from `../src/core/paths.js`.

- [ ] **Step 3: Add the helper to `src/core/paths.ts`**

Append (e.g. after `globalRoot`):
```ts
/** Plugin install root: CLAUDE_PLUGIN_ROOT when set, else the process CWD. Single source of truth. */
export function pluginRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
}
```

- [ ] **Step 4: Replace the copies — core modules**

- `src/core/contracts.ts`: delete line 6 (`function pluginRoot(): string { ... }`); add `pluginRoot` to the
  existing `import { globalRoot } from "./paths.js";` → `import { globalRoot, pluginRoot } from "./paths.js";`.
- `src/core/instruments.ts`: delete line 7 (`function pluginRoot(): string { ... }`); add `pluginRoot` to the
  existing `import { globalRoot, repoStateDir, topicDir, partDir, isArtifactDir } from "./paths.js";`.
- `src/core/ipc.ts`: delete lines 24-26 (`function pluginRoot(): string { return ... }`); add `pluginRoot` to
  the existing `import { partDir, topicDir } from "./paths.js";`.
- `src/core/scoreSkill.ts`: delete line 23 (`function pluginRoot(): string { ... }`); add a new import after
  the `node:path` import: `import { pluginRoot } from "./paths.js";`.

- [ ] **Step 5: Replace the copies — command modules**

- `src/commands/soundcheck.ts`: delete line 33 (`const pluginRoot = () => process.env... ;`); add `pluginRoot`
  to the existing `import { globalRoot } from "../core/paths.js";`.
- `src/commands/coda.ts`: delete line 48 (`const pluginRoot = () => process.env... ;`); add `pluginRoot` to
  the existing `import { topicDir, repoStateDir, isArtifactDir } from "../core/paths.js";`.

- [ ] **Step 6: rehearsal.ts:398 — use the imported `pluginRoot()` inline**

Add `pluginRoot` to rehearsal.ts's existing paths import at line 35:
`import { repoRoot } from "../core/paths.js";` → `import { repoRoot, pluginRoot } from "../core/paths.js";`.
Then delete the local value declaration at line 398:
```ts
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
  const templatePath = join(pluginRoot, "config", "prompt-templates", "rehearsal", "experiment.md");
```
becomes:
```ts
  const templatePath = join(pluginRoot(), "config", "prompt-templates", "rehearsal", "experiment.md");
```
(Verify rehearsal.ts has no other local symbol named `pluginRoot` after this edit.)

- [ ] **Step 7: Run the test — expect PASS, then the full gate**

```bash
npx vitest run tests/paths-pluginroot.test.ts && npm run typecheck && npm run test && npm run lint && npm run build
```
Expected: new test passes; full suite green; build OK.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "refactor(simplify): extract pluginRoot() helper; drop ~8 hand-rolled copies

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task T3: Shared `readIfExists` / `readIfExistsOrNull`; replace 6 redeclarations

**Files:** Create `src/core/fsread.ts`. Modify `src/commands/score.ts`, `src/commands/prelude.ts`,
`src/commands/solo.ts`, `src/core/preludeHandoff.ts`. Test: `tests/fsread.test.ts` (new).

- [ ] **Step 1: Write the failing test** — `tests/fsread.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIfExists, readIfExistsOrNull } from "../src/core/fsread.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fsread-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("readIfExists", () => {
  it("returns file contents when present", () => {
    const p = join(dir, "a.txt"); writeFileSync(p, "hello");
    expect(readIfExists(p)).toBe("hello");
  });
  it("returns empty string when absent", () => {
    expect(readIfExists(join(dir, "nope.txt"))).toBe("");
  });
});
describe("readIfExistsOrNull", () => {
  it("returns file contents when present", () => {
    const p = join(dir, "b.txt"); writeFileSync(p, "x");
    expect(readIfExistsOrNull(p)).toBe("x");
  });
  it("returns null when absent", () => {
    expect(readIfExistsOrNull(join(dir, "nope.txt"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`../src/core/fsread.js` does not exist)

```bash
npx vitest run tests/fsread.test.ts
```
Expected: FAIL — cannot resolve `../src/core/fsread.js`.

- [ ] **Step 3: Create `src/core/fsread.ts`**

```ts
import { existsSync, readFileSync } from "node:fs";

/** File contents as utf8, or "" when the path does not exist. */
export function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** File contents as utf8, or null when the path does not exist. */
export function readIfExistsOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
```

- [ ] **Step 4: score.ts — replace `readIf` + the adjudicate lambda with the shared helper**

Delete the module-level `readIf` (line 123):
```ts
function readIf(path: string): string { return existsSync(path) ? readFileSync(path, "utf8") : ""; }
```
Add the import (alias keeps the existing 4 `readIf(...)` call sites untouched):
```ts
import { readIfExists as readIf } from "../core/fsread.js";
```
In `adjudicateRun`, delete the local lambda (line 410):
```ts
  const readIfExists = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "");
```
and change its three call sites (lines 414, 415, 418) from `readIfExists(` to `readIf(`.

- [ ] **Step 5: prelude.ts — replace the local `readIf` with the import alias**

Delete line 58 (`const readIf = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "");`) and
add:
```ts
import { readIfExists as readIf } from "../core/fsread.js";
```
All existing `readIf(...)` call sites stay unchanged.

- [ ] **Step 6: preludeHandoff.ts — replace the null-variant `readIf`**

Delete line 39 (`function readIf(p: string): string | null { return existsSync(p) ? readFileSync(p, "utf8") : null; }`)
and add:
```ts
import { readIfExistsOrNull as readIf } from "./fsread.js";
```
The two `readIf(...)` call sites (lines 44, 67) stay unchanged.

- [ ] **Step 7: solo.ts — make `readField` a thin wrapper over `readIfExists`**

Add `import { readIfExists } from "../core/fsread.js";`. Replace `readField` (line 164):
```ts
function readField(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n")[0].trim() : "";
}
```
with:
```ts
function readField(path: string): string {
  return readIfExists(path).split("\n")[0].trim();
}
```
(`readIfExists` of an absent file → `""` → `"".split("\n")[0].trim()` → `""`, byte-identical.)

- [ ] **Step 8: Remove now-unused fs imports**

If `existsSync`/`readFileSync` are no longer referenced in a file you edited, drop them from that file's
`node:fs` import. The typecheck/lint gate flags any that remain unused — let it guide you per file.

- [ ] **Step 9: Run the test — expect PASS, then the full gate**

```bash
npx vitest run tests/fsread.test.ts && npm run typecheck && npm run test && npm run lint && npm run build
```

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "refactor(simplify): shared readIfExists/readIfExistsOrNull; drop 6 redeclarations

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task T4: Delete `collect.ts`'s private `resolveModel`; import the `core/ipc.ts` one

**Files:** Modify `src/commands/collect.ts`.

- [ ] **Step 1: Confirm byte-identical to the exported one**

`src/commands/collect.ts:7-14` is identical in behavior to `src/core/ipc.ts:140-146` (`resolveModel`). Verify:
```bash
grep -n "resolveModel" src/commands/collect.ts src/core/ipc.ts
```

- [ ] **Step 2: Delete the local function and import the core one**

In `src/commands/collect.ts`, delete the private function (lines 7-14):
```ts
function resolveModel(instrument: string, topic: string): string | null {
  const td = topicDir(topic);
  if (!existsSync(td)) return null;
  const dir = readdirSync(td, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.startsWith(`${instrument}-`));
  if (!dir) return null;
  const hint = dir.name.slice(instrument.length + 1);
  return paneMetaModel(instrument, hint, topic);
}
```
Add `resolveModel` to the existing ipc import and drop now-unused imports. The import line
`import { paneMetaModel, outboxWait, outboxDump } from "../core/ipc.js";` becomes:
```ts
import { resolveModel, outboxWait, outboxDump } from "../core/ipc.js";
```
Then remove the now-unused `existsSync, readdirSync` from `node:fs`, the unused `topicDir` import from
`../core/paths.js`, and `paneMetaModel` (no longer used directly). Let typecheck/lint confirm exactly which
imports are now unused.

- [ ] **Step 3: Run the full gate**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(simplify): collect.ts reuses core/ipc.ts resolveModel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task T5: Extract core `runForensics()`; collapse the 5 wrappers; unify drifted wording

**Files:** Modify `src/core/forensics.ts`, `src/commands/solo.ts`, `src/commands/score.ts`,
`src/commands/perform.ts`, `src/commands/prelude.ts`, `src/commands/rehearsal.ts`.
Test: `tests/forensics-run.test.ts` (new).

- [ ] **Step 1: Write the failing test** — `tests/forensics-run.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { runForensics } from "../src/core/forensics.js";
import { scoreArtDir } from "../src/core/score.js";
import { partDir, globalRoot } from "../src/core/paths.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

function walkForensicsMd(): string[] {
  const root = join(globalRoot(), "forensics");
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }) as Dirent[]) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name.endsWith(".md")) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

describe("runForensics", () => {
  it("captures a part's outbox errors into a command-tagged file (rc 0)", () => {
    mkdirSync(scoreArtDir("fix-x"), { recursive: true });
    const pd = partDir("cody", "codex", "fix-x");
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, "outbox.jsonl"), JSON.stringify({ event: "error", message: "boom" }) + "\n");
    expect(runForensics("score", scoreArtDir, "fix-x")).toBe(0);
    const files = walkForensicsMd();
    expect(files.length).toBe(1);
    const md = readFileSync(files[0], "utf8");
    expect(md).toContain("command: score");
    expect(md).toContain("boom");
  });
  it("writes nothing when there are no findings (rc 0)", () => {
    mkdirSync(scoreArtDir("clean"), { recursive: true });
    expect(runForensics("score", scoreArtDir, "clean")).toBe(0);
    expect(walkForensicsMd().length).toBe(0);
  });
  it("rc 2 on missing topic", () => {
    expect(runForensics("score", scoreArtDir, undefined)).toBe(2);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`runForensics` not exported)

```bash
npx vitest run tests/forensics-run.test.ts
```
Expected: FAIL — `runForensics` is not exported from `../src/core/forensics.js`.

- [ ] **Step 3: Add `runForensics` to `src/core/forensics.ts`**

Add at the top: `import { log } from "./log.js";` (log.ts is a leaf logger — no import cycle). Then append:
```ts
/** Shared body for each command's `forensics` wind-down verb: usage-guard the topic, capture, report.
 *  Best-effort — rc 0 unless the topic arg is missing (rc 2). Feeds /consort:playback. */
export function runForensics(command: string, artDirFor: (topic: string) => string, topic: string | undefined): number {
  if (!topic) { log.error(`usage: ${command} forensics <topic>`); return 2; }
  const path = captureArtDir({ artDir: artDirFor(topic), command });
  if (path) { log.ok(`${command} forensics: captured ${path}`); process.stdout.write(path + "\n"); }
  else log.info(`${command} forensics: no mechanical findings (no file written)`);
  return 0;
}
```

- [ ] **Step 4: Replace each command's `forensicsRun` with a one-line delegate**

In each command file, swap the forensics import (drop `captureArtDir`, add `runForensics`) — e.g.
`import { runForensics } from "../core/forensics.js";` (replacing the `captureArtDir` import, which is used
only inside `forensicsRun` in these files). Then:

- `solo.ts` (49-56):
```ts
export async function forensicsRun(rest: string[]): Promise<number> {
  return runForensics("solo", soloArtDir, rest[0]);
}
```
- `score.ts` (591-598):
```ts
export async function forensicsRun(rest: string[]): Promise<number> {
  return runForensics("score", scoreArtDir, rest[0]);
}
```
- `perform.ts` (592-597):
```ts
async function forensicsRun(rest: string[]): Promise<number> {
  return runForensics("perform", performArtDir, rest[0]);
}
```
- `prelude.ts` (374-381):
```ts
export async function forensicsRun(rest: string[]): Promise<number> {
  return runForensics("prelude", preludeArtDir, rest[0]);
}
```
- `rehearsal.ts` (1231-1238):
```ts
export async function forensicsRun(rest: string[]): Promise<number> {
  return runForensics("rehearsal", rehearsalArtDir, rest[0]);
}
```
(`performArtDir`/`scoreArtDir`/`preludeArtDir`/`rehearsalArtDir` all accept `(topic, opts?)`, assignable to
`(topic: string) => string`.) This unifies rehearsal's drifted wording (`forensics captured:` →
`rehearsal forensics: captured`; `rehearsal forensics: no mechanical findings` →
`... (no file written)`) to match the other four.

- [ ] **Step 5: Update any test asserting rehearsal's old forensics wording**

```bash
grep -rn "forensics captured" tests
```
If any test asserts the old `forensics captured:` string, update it to `rehearsal forensics: captured`.
(Behavior-asserting tests like `tests/solo-forensics.test.ts` check the written file, not the log line, and
need no change.)

- [ ] **Step 6: Run the test — expect PASS, then the full gate**

```bash
npx vitest run tests/forensics-run.test.ts && npm run typecheck && npm run test && npm run lint && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(simplify): core runForensics(); collapse 5 wrappers; unify wording

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task T6: Local-dedup helpers (within-file / within-module)

**Files:** Modify `src/commands/perform.ts`, `src/core/multirepo.ts`, `src/commands/rehearsal.ts`,
`src/core/score.ts`, `src/commands/score.ts`, `src/consort.ts`, `src/commands/roster.ts`. Each sub-item is
independent and behavior-identical; the existing suite is the gate.

- [ ] **Step 1: perform.ts — `hasRepoMarker()` predicate**

After `isDir` (line 254) add:
```ts
function hasRepoMarker(dir: string): boolean {
  return existsSync(join(dir, "CLAUDE.md")) || existsSync(join(dir, "AGENTS.md"));
}
```
Line 692: `if (!existsSync(join(cwd, "CLAUDE.md")) && !existsSync(join(cwd, "AGENTS.md")))` →
`if (!hasRepoMarker(cwd))`. Line 786:
`if (!existsSync(join(dir, "CLAUDE.md")) && !existsSync(join(dir, "AGENTS.md")))` → `if (!hasRepoMarker(dir))`.

- [ ] **Step 2: multirepo.ts — `resolveMarker()` shared by both loops**

Add (after the interfaces):
```ts
/** CLAUDE.md (preferred) else AGENTS.md under dir, realpath-resolved; null if neither exists. */
function resolveMarker(dir: string): string | null {
  const marker = existsSync(join(dir, "CLAUDE.md")) ? join(dir, "CLAUDE.md")
    : existsSync(join(dir, "AGENTS.md")) ? join(dir, "AGENTS.md") : null;
  if (!marker) return null;
  try { return join(realpathSync(dir), marker.slice(dir.length + 1)); } catch { return marker; }
}
```
In `validateTargets`, replace lines 22-27 (the marker/abs block) with:
```ts
    const marker = resolveMarker(dir);
    if (!marker) { errors.push(`target '${slug}' is not a sibling dir with CLAUDE.md/AGENTS.md under ${cwd}`); continue; }
    ok.push({ slug, marker });
```
In `detectMultiRepo`, replace lines 43-50 (the marker/corpus/abs block) with:
```ts
    const marker = resolveMarker(dir);
    if (!marker) continue;
    if (!corpusLower.includes(slug.toLowerCase())) continue;
    hits.push({ slug, marker });
```
(Same marker precedence, same realpath fallback, same order: marker first, then corpus check.)

- [ ] **Step 3: rehearsal.ts — `resultStr()` + reuse `readResultJson`**

Add near `readResultJson` (line 1081):
```ts
/** A result.json field coerced to string ("" when absent/null). */
function resultStr(r: Record<string, unknown>, k: string): string {
  return r[k] != null ? String(r[k]) : "";
}
```
In `gatherPeers`, replace the parse block (lines 298-310) with:
```ts
    let approach = "", metric = "", status = "", notes = "";
    if (latest) {
      const r = readResultJson(join(expsDir, latest, "result.json"));
      approach = resultStr(r, "approach_label");
      metric = resultStr(r, "metric_value");
      status = resultStr(r, "status");
      notes = resultStr(r, "notes");
    }
```
Replace `readResultCells` (lines 604-614) with:
```ts
function readResultCells(resultPath: string): { approach: string; metric: string } {
  const r = readResultJson(resultPath);
  const approach = resultStr(r, "approach_label");
  const metric = `${resultStr(r, "metric_value")} ${resultStr(r, "status")}`.trim() || "—";
  return { approach, metric };
}
```
In `handoffExtractWith`: line 1112 `const approach = result.approach_label != null ? String(result.approach_label) : "";`
→ `const approach = resultStr(result, "approach_label");`. Line 1121
`approach: rr.approach_label != null ? String(rr.approach_label) : ""` → `approach: resultStr(rr, "approach_label")`.
(Leave the `notes`/`checkpoint_path` shaping on 1113/1115 unchanged.)

- [ ] **Step 4: rehearsal.ts — `gatherCompletion()` for the scoreboard+metric block**

Add near the other rehearsal pure helpers:
```ts
/** scoreboard.md text + completion signals (BOTH scoreboard.md and metric.md must exist, else nulls). */
function gatherCompletion(art: string): { scoreboardMd: string | null; completion: ReturnType<typeof checkCompletion> | null } {
  const sbPath = join(art, "scoreboard.md");
  const scoreboardMd = existsSync(sbPath) ? readFileSync(sbPath, "utf8") : null;
  const metricPath = join(art, "metric.md");
  const completion = scoreboardMd !== null && existsSync(metricPath)
    ? checkCompletion(scoreboardMd, readFileSync(metricPath, "utf8"))
    : null;
  return { scoreboardMd, completion };
}
```
In `statusBrief` replace lines 686-693 with `const { scoreboardMd, completion } = gatherCompletion(art);`.
In `finalizeWith` step 9 replace lines 933-938 with `const { scoreboardMd, completion } = gatherCompletion(art);`.
(Both sites use only `scoreboardMd` + `completion` afterward; `metricPath`/`scoreboardPath` locals are dropped.)

- [ ] **Step 5: consort.ts — reuse `ansiFromColor` in `_banner`**

Change the import: `import { renderBannerHead } from "./core/colors.js";` →
`import { renderBannerHead, ansiFromColor } from "./core/colors.js";`. Replace line 26:
```ts
  const c = /^colour(\d+)$/.test(color) ? `\x1b[38;5;${color.replace("colour", "")}m` : "";
```
with:
```ts
  const c = ansiFromColor(color);
```

- [ ] **Step 6: core/score.ts — `nonCommentLines()`; move `parseRosterTargets` in**

Add to `src/core/score.ts`:
```ts
/** Split text into trimmed, non-blank, non-`#`-comment lines. */
export function nonCommentLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
}
```
Rewrite `parseRosterFile` (lines 56-60) to use it:
```ts
export function parseRosterFile(text: string): RosterRow[] {
  return nonCommentLines(text)
    .map((l) => { const [provider, instrument] = l.split("\t"); return { provider, instrument }; })
    .filter((r) => r.provider && r.instrument) as RosterRow[];
}
```
Rewrite `parsePanesFile` (lines 91-100) to use it:
```ts
export function parsePanesFile(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of nonCommentLines(text)) {
    const [instrument, pane] = t.split("\t");
    if (instrument && pane) m.set(instrument, pane);
  }
  return m;
}
```
Add the moved-in `parseRosterTargets`:
```ts
/** targets.txt may be a plain slug-per-line list (init) or a TSV (multi-repo detect, Phase E). */
export function parseRosterTargets(text: string): string[] {
  return nonCommentLines(text).map((l) => l.split("\t")[0]).filter(Boolean);
}
```
In `src/commands/score.ts`: delete the local `parseRosterTargets` (lines 505-509) and add `parseRosterTargets`
to the existing `from "../core/score.js"` import block (lines 8-14).

- [ ] **Step 7: roster.ts — hoist the doubly-computed `outboxPath`**

Replace lines 47-49:
```ts
      const pane = meta.paneId || "?";
      let state = "[ORPHAN]";
      if (pane !== "?" && (await paneAlive(pane))) state = classifyStale(deriveState(lastOutboxEvent(outboxPath(meta.instrument, meta.model, t.name))), outboxPath(meta.instrument, meta.model, t.name));
```
with:
```ts
      const pane = meta.paneId || "?";
      const ob = outboxPath(meta.instrument, meta.model, t.name);
      let state = "[ORPHAN]";
      if (pane !== "?" && (await paneAlive(pane))) state = classifyStale(deriveState(lastOutboxEvent(ob)), ob);
```

- [ ] **Step 8: Drop now-unused imports, then run the full gate**

Let typecheck/lint flag any import left unused by these edits (e.g. `realpathSync` stays in multirepo.ts — it
moved into `resolveMarker`). Then:
```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "refactor(simplify): local-dedup helpers (hasRepoMarker, resolveMarker, resultStr, gatherCompletion, nonCommentLines, ansiFromColor reuse, outboxPath hoist)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task T7: Phase 3 trivial — usage(), dep aliases, topApproach alias, missingRosterArtifacts

**Files:** Modify `src/commands/rehearsal.ts`, `src/commands/score.ts`, `src/core/preludeHandoff.ts`,
`src/commands/prelude.ts`.

- [ ] **Step 1: rehearsal.ts — add a `usage()` matching its sibling commands**

Add near the top of `src/commands/rehearsal.ts` (module scope):
```ts
function usage(): number {
  log.error("usage: rehearsal <init|metric|sota|spawn-all|experiment-send|score|monitor|status-brief|finalize|refine|handoff-extract|teardown|fresh-part|forensics|abort|consensus> ...");
  return 2;
}
```
Change the dispatcher default (line 1446):
```ts
    default: log.error(`rehearsal: unknown verb: ${verb ?? "(none)"}`); return 2;
```
to:
```ts
    default: return usage();
```

- [ ] **Step 2: score.ts — phase-neutral dep interface names (keep test-imported aliases)**

First list external importers (tests reference these by name):
```bash
grep -rn "ResearchSendDeps\|ResearchWaitDeps" src tests
```
Rename the two **interfaces** in `src/commands/score.ts`: `export interface ResearchSendDeps` → `export interface SendDeps`,
`export interface ResearchWaitDeps` → `export interface WaitDeps`. Immediately after each, add a back-compat
alias so existing importers/tests keep working:
```ts
export type ResearchSendDeps = SendDeps;
export type ResearchWaitDeps = WaitDeps;
```
Update the in-file type references from `ResearchSendDeps`/`ResearchWaitDeps` to `SendDeps`/`WaitDeps`:
`liveResearchSendDeps: SendDeps` (210), `researchSendWith(..., d: SendDeps)` (221), `verifySendWith(..., d: SendDeps)` (323),
`liveResearchWaitDeps: WaitDeps` (246), `researchWaitWith(..., d: WaitDeps)` (257), `verifyWaitWith(..., d: WaitDeps)` (365),
and `interface DrilldownDeps extends SendDeps, WaitDeps` (513). (Leave the `liveResearchSendDeps`/
`liveResearchWaitDeps` **const** names as-is — only the interface types are renamed.)

- [ ] **Step 3: preludeHandoff.ts — alias the imported `topApproach`**

Line 9: `import { topApproach } from "./preludeConfidence.js";` →
`import { topApproach as firstApproach } from "./preludeConfidence.js";`. Line 61:
`top = topApproach(doc);` → `top = firstApproach(doc);`. (The `HandoffInput.topApproach` field name is part of
the tested public input shape — leave it.)

- [ ] **Step 4: prelude.ts — `missingRosterArtifacts()` shared by synth-preliminary/synth-final**

Add near the other prelude helpers:
```ts
/** Roster rows whose `<prefix>-<instrument>.md` art file is missing/empty → list of the missing filenames. */
function missingRosterArtifacts(art: string, rows: RosterRow[], prefix: string): string[] {
  return rows.filter((r) => !readIf(join(art, `${prefix}-${r.instrument}.md`)).trim()).map((r) => `${prefix}-${r.instrument}.md`);
}
```
In `synthPreliminaryRun`, replace line 247:
```ts
  const missing = rows.filter((r) => !readIf(join(art, `findings-${r.instrument}.md`)).trim()).map((r) => `findings-${r.instrument}.md`);
```
with `const missing = missingRosterArtifacts(art, rows, "findings");`. In `synthFinalRun`, replace line 359:
```ts
    const missing = rows.filter((r) => !readIf(join(art, `adversary-${r.instrument}.md`)).trim()).map((r) => `adversary-${r.instrument}.md`);
```
with `const missing = missingRosterArtifacts(art, rows, "adversary");`. (Error strings + per-verb required
files stay byte-identical.)

- [ ] **Step 5: Run the full gate**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor(simplify): Phase 3 consistency (rehearsal usage(), phase-neutral dep names, topApproach alias, missingRosterArtifacts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task T8: Decompose `finalizeWith` into named per-step helpers (preserve FROZEN order)

**Files:** Modify `src/commands/rehearsal.ts`. This is the only medium-effort task — a pure structural move.
The rehearsal test suite is the gate. **Preserve the step order 4→5→6→7→8 EXACTLY.**

- [ ] **Step 1: Extract steps 4-8 into named helpers (verbatim bodies)**

Add five module-scope functions just above `finalizeWith` (line 751). Each body is the **exact current code**
of that step — move it verbatim; do not alter logic:

```ts
/** Step 4: enforce status/metric_value joint validity per exp (normalize_result). */
function normalizeResults(art: string, instruments: string[]): void {
  // body verbatim from current finalizeWith lines 805-818
}

/** Step 5: prune intermediate checkpoints (caller guards with !keep). */
function pruneIntermediate(art: string, instruments: string[]): void {
  // body verbatim from current finalizeWith lines 822-849 (the inner `for (const instrument ...)` block,
  // WITHOUT the outer `if (!keep) { ... }` wrapper — the caller keeps that guard)
}

/** Step 6: link pane artifacts (relative symlinks of outbox/inbox into the art tree). */
function linkPaneArtifacts(art: string, instruments: string[], topic: string): void {
  // body verbatim from current finalizeWith lines 853-871
}

/** Step 7: compute size warnings (post-prune); TRUNCATE warnings.txt first. */
function computeSizeWarnings(art: string, instruments: string[], threshold: number): void {
  // body verbatim from current finalizeWith lines 874-888 (declares warningsPath internally OR receives it —
  // keep it self-contained: re-derive `const warningsPath = join(art, "warnings.txt");` inside)
}

/** Step 8: audit diff — append audit_warn rows for prompt/audit knob mismatches (AFTER size). */
function computeAuditWarnings(art: string, instruments: string[], warningsPath: string): void {
  // body verbatim from current finalizeWith lines 891-913
}
```

Implementation notes for the move:
- `computeSizeWarnings`: the current step-7 code derives `warningsPath` and `threshold` in `finalizeWith`.
  Make the helper self-contained — compute `const warningsPath = join(art, "warnings.txt");` inside it and
  take `threshold` as a parameter; it still `atomicWrite`s `warningsPath`.
- `computeAuditWarnings`: takes `warningsPath` so it appends to the same file step 7 wrote.
- All helpers rely on existing module-scope functions (`experimentsDir`, `listExpDirs`, `normalizeResult`,
  `parseHardConstraints`, `outboxPath`, `inboxPath`, `partStateDir`, `resolveModel`, `readOr`, `dirByteSize`,
  `fileCountDepth1`, `atomicWrite`, `log`) — no new imports.

- [ ] **Step 2: Replace steps 4-8 in `finalizeWith` with the calls**

The `finalizeWith` body becomes (steps 1-3 and 9 unchanged; steps 4-8 are now calls in the SAME order):
```ts
  // 4. normalize_result
  normalizeResults(art, instruments);

  // 5. prune intermediate checkpoints (skip if --keep-intermediate).
  if (!keep) pruneIntermediate(art, instruments);

  // 6. link pane artifacts.
  linkPaneArtifacts(art, instruments, topic);

  // 7. compute size warnings (post-prune). TRUNCATE warnings.txt first.
  const warningsPath = join(art, "warnings.txt");
  computeSizeWarnings(art, instruments, (deps.sizeWarnGb ?? 2) * GIB);

  // 8. audit diff (AFTER size).
  computeAuditWarnings(art, instruments, warningsPath);
```
(Keep `const warningsPath` in `finalizeWith` because step 9's warnings-rendering reads it via `readOr(warningsPath)`.
Step 7's helper re-derives the same path internally and truncates it; step 8 appends to the passed path. The
observable file writes are byte-identical.)

- [ ] **Step 3: Do NOT remove `parseScoreboard.rows`**

`tests/rehearsal-handoff.test.ts` asserts the `rows` field; leave it even if it looks unused.

- [ ] **Step 4: Run the rehearsal tests in isolation, then the full gate**

```bash
npx vitest run tests/rehearsal-finalize.test.ts && npm run typecheck && npm run test && npm run lint && npm run build
```
(If the finalize test file has a different name, find it: `ls tests | grep -i finaliz`. Expect all green —
behavior is unchanged, only structure.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(simplify): decompose finalizeWith into named per-step helpers (order preserved)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## After all tasks

- [ ] **Final holistic review** — dispatch a code-reviewer over the full branch diff
  (`git diff main...chore/simplification-sweep`): confirm zero behavior change, FROZEN protocol untouched,
  stale-token test green, `dist/consort.cjs` rebuilt deterministically, every Phase 1-3 item applied and no
  quarantined item touched.
- [ ] **Finish the branch** — use superpowers:finishing-a-development-branch (push + open PR).

## Explicitly NOT in this plan

The 16 quarantined findings (the score/prelude IPC twins, the `parts.txt` comment-filter divergence in
`gatherPeers`, the eager-vs-lazy solo timeout, `contracts.yaml` memoization, etc.) are out of scope — each
needs its own reviewed change with the named tests as the parity gate. See the companion findings catalog
`docs/superpowers/plans/2026-05-31-consort-simplification.md`.
