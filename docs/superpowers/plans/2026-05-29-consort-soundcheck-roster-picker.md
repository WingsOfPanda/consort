# consort soundcheck roster-picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clone-wars `medic` v0.18.0's interactive provider roster-picker to consort `soundcheck`: after the health check, the user curates which `consult_validated` providers are the active ensemble, persisted to `~/.consort/providers-active.txt`.

**Architecture:** A pure `core/providers.ts` module (parse/read provider-list files, compute the prompt plan, format the active file) drives two new mechanical `soundcheck` subcommands — `roster-plan` (emits JSON the directive consumes) and `roster-set` (validates + atomic-writes). The interactive menu lives in `commands/soundcheck.md` (Claude-side `AskUserQuestion`). The consumer-side resolver `activeProvidersPath()` and the `consult_validated` filter already exist in the foundation and are reused, not rebuilt.

**Tech Stack:** TypeScript (ES2022/NodeNext/strict), vitest, esbuild → committed `dist/consort.cjs`, eslint flat config (`no-unused-vars: error`).

**Spec:** `docs/superpowers/specs/2026-05-29-consort-soundcheck-roster-picker-design.md`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/core/providers.ts` | provider-list files: parse, read, plan the prompt, format the active file. Pure/fs-only; no contracts, no tmux. | **Create** |
| `src/commands/soundcheck.ts` | gains a verb dispatch (`roster-plan` / `roster-set` / health-check) + the two subcommand bodies. | **Modify** |
| `commands/soundcheck.md` | gains the always-interactive picker section (Steps 4–6) after the existing health-check steps. | **Modify** |
| `tests/providers.test.ts` | unit tests for `core/providers.ts`. | **Create** |
| `tests/soundcheck-roster.test.ts` | integration tests for `roster-plan` / `roster-set` under a temp `CONSORT_HOME`. | **Create** |
| `docs/superpowers/DOGFOOD.md` | append the `soundcheck roster-picker` dogfood result. | **Modify** |

**Reused, not rebuilt:** `paths.ts` `globalRoot()` + `activeProvidersPath()`; `contracts.ts` `instrumentConsultValidated()`; `atomic.ts` `atomicWrite()`; `archive.ts` `isoUtc()`; `tests/helpers/tmpHome.ts` `freshHome()`.

**Foundation facts the engineer must trust (verified against the repo):**
- `soundcheck.ts` currently exports `run(_args)` whose entire body is the health check + writes `providers-available.txt` via `atomicWrite` (line ~77). `run` must STAY async and STAY the dispatch entry (the dispatcher in `src/consort.ts` calls `soundcheck.run`).
- `src/consort.ts` intercepts `--mint-args-file` globally and runs `applyArgsFile(rest)` before calling the handler. `applyArgsFile(argv)` returns `argv` unchanged when `argv[0] !== "--args-file"`. So `soundcheck roster-plan` reaches `run(["roster-plan"])` and `soundcheck roster-set codex claude` reaches `run(["roster-set","codex","claude"])` untouched.
- `log.error()` writes to **stderr** (so it never pollutes `roster-plan`'s stdout JSON).
- All four consort providers (`codex`/`claude`/`agy`/`opencode`) have `consult_validated: true` in `config/contracts.yaml`. `instrumentConsultValidated("<unknown>")` returns `false`.
- The stale-token gate (`tests/stale-tokens.test.ts`) bans exactly: `clone-wars`, `cw_`, `master-yoda`, `MISSION ACCOMPLISHED`, `@cw_` in `src config commands hooks .claude-plugin`. (`medic`/`trooper` are not gated, but avoid them in shipped text anyway.)

---

## Phase 1 — `core/providers.ts`

### Task 1: Provider-list parse + read

**Files:**
- Create: `src/core/providers.ts`
- Test: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/providers.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProviderList, readProviderList } from "../src/core/providers.js";

describe("parseProviderList", () => {
  it("keeps providers, skips blank + # lines, trims whitespace", () => {
    expect(parseProviderList("# header\n\ncodex\n  claude  \n#trailing\n")).toEqual(["codex", "claude"]);
  });
  it("empty input → []", () => {
    expect(parseProviderList("")).toEqual([]);
  });
});

describe("readProviderList", () => {
  it("missing file → []", () => {
    expect(readProviderList("/no/such/providers.txt")).toEqual([]);
  });
  it("reads + parses an on-disk file", () => {
    const f = join(mkdtempSync(join(tmpdir(), "pl-")), "providers.txt");
    writeFileSync(f, "# generated …\ncodex\nclaude\n");
    expect(readProviderList(f)).toEqual(["codex", "claude"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers.test.ts`
Expected: FAIL — cannot resolve `../src/core/providers.js` (module does not exist).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/providers.ts
import { existsSync, readFileSync } from "node:fs";

/** Parse a providers-*.txt body: one provider per line; skip blank and #-comment lines; trim. */
export function parseProviderList(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
}

/** Read + parse a provider-list file. Missing or unreadable → []. */
export function readProviderList(path: string): string[] {
  if (!existsSync(path)) return [];
  try { return parseProviderList(readFileSync(path, "utf8")); } catch { return []; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/providers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/providers.ts tests/providers.test.ts
git commit -m "feat(providers): parse + read provider-list files"
```

### Task 2: `planRoster` — reconcile prior + decide prompt shape

**Files:**
- Modify: `src/core/providers.ts`
- Test: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/providers.test.ts`; add `planRoster` to the existing import from `../src/core/providers.js`)

```ts
import { planRoster } from "../src/core/providers.js"; // extend the existing import line

describe("planRoster", () => {
  it("0 validated → skip", () => {
    expect(planRoster({ detectedValidated: [], prior: [] }).decision).toBe("skip");
  });
  it("1 validated → auto + carries the provider", () => {
    const p = planRoster({ detectedValidated: ["codex"], prior: [] });
    expect(p.decision).toBe("auto");
    expect(p.auto).toBe("codex");
  });
  it("2 validated → prompt, no auto field", () => {
    const p = planRoster({ detectedValidated: ["codex", "claude"], prior: [] });
    expect(p.decision).toBe("prompt");
    expect(p.auto).toBeUndefined();
  });
  it("4 validated → prompt", () => {
    expect(planRoster({ detectedValidated: ["codex", "claude", "agy", "opencode"], prior: [] }).decision).toBe("prompt");
  });
  it("drops stale prior with a note, keeps still-detected prior", () => {
    const p = planRoster({ detectedValidated: ["codex", "claude"], prior: ["codex", "gone"] });
    expect(p.prior).toEqual(["codex"]);
    expect(p.dropped).toEqual(["gone (no longer detected)"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers.test.ts`
Expected: FAIL — `planRoster` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/core/providers.ts`)

```ts
export type RosterDecision = "skip" | "auto" | "prompt";

export interface RosterPlan {
  detected: string[];   // validated, detected (menu is built from this)
  prior: string[];      // prior selection reconciled against `detected`
  dropped: string[];    // human-readable notes for prior entries no longer present
  decision: RosterDecision;
  auto?: string;        // present only when decision === "auto"
}

/** Pure: reconcile the prior selection against the validated-detected set; compute the prompt decision. */
export function planRoster(input: { detectedValidated: string[]; prior: string[] }): RosterPlan {
  const detected = [...input.detectedValidated];
  const prior = input.prior.filter((p) => detected.includes(p));
  const dropped = input.prior.filter((p) => !detected.includes(p)).map((p) => `${p} (no longer detected)`);
  if (detected.length === 0) return { detected, prior, dropped, decision: "skip" };
  if (detected.length === 1) return { detected, prior, dropped, decision: "auto", auto: detected[0] };
  return { detected, prior, dropped, decision: "prompt" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/providers.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/providers.ts tests/providers.test.ts
git commit -m "feat(providers): planRoster reconciles prior + decides prompt shape"
```

### Task 3: `formatActiveFile` — the providers-active.txt body

**Files:**
- Modify: `src/core/providers.ts`
- Test: `tests/providers.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/providers.test.ts`; add `formatActiveFile` to the import)

```ts
import { formatActiveFile } from "../src/core/providers.js"; // extend the existing import line

describe("formatActiveFile", () => {
  it("header + one provider per line + trailing newline", () => {
    expect(formatActiveFile(["codex", "claude"], "2026-05-29T00:00:00Z")).toBe(
      "# generated 2026-05-29T00:00:00Z by /consort:soundcheck\n# active providers selected by user\ncodex\nclaude\n",
    );
  });
  it("empty set → headers only, no trailing provider newline", () => {
    expect(formatActiveFile([], "2026-05-29T00:00:00Z")).toBe(
      "# generated 2026-05-29T00:00:00Z by /consort:soundcheck\n# active providers selected by user\n",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers.test.ts`
Expected: FAIL — `formatActiveFile` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/core/providers.ts`)

```ts
/** The providers-active.txt body. Trailing newline only when non-empty (matches the available-file writer). */
export function formatActiveFile(providers: string[], isoStamp: string): string {
  return `# generated ${isoStamp} by /consort:soundcheck\n# active providers selected by user\n${providers.join("\n")}${providers.length ? "\n" : ""}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/providers.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/providers.ts tests/providers.test.ts
git commit -m "feat(providers): formatActiveFile renders providers-active.txt body"
```

---

## Phase 2 — `soundcheck` subcommands

### Task 4: Verb dispatch in `soundcheck.ts` (no behavior change)

**Files:**
- Modify: `src/commands/soundcheck.ts`
- Test: `tests/soundcheck.test.ts` (existing — must stay green)

- [ ] **Step 1: Confirm the existing test still defines current behavior**

Run: `npx vitest run tests/soundcheck.test.ts`
Expected: PASS — the existing suite calls `await soundcheck([])` and asserts the health check ran. This is the regression guard for the refactor.

- [ ] **Step 2: Refactor `run` into a dispatch + `healthCheck`**

Rename the current `run`'s body to a new `healthCheck()` function (the body is **unchanged** — same checks, same `providers-available.txt` write, same Verdict line, same `return` codes), then make `run` a thin dispatcher. Replace the current function header:

```ts
export async function run(_args: string[]): Promise<number> {
```

with:

```ts
export async function run(args: string[]): Promise<number> {
  if (args[0] === "roster-plan") return rosterPlan();
  if (args[0] === "roster-set") return rosterSet(args.slice(1));
  return healthCheck();
}

function healthCheck(): number {
```

(i.e. the existing body — starting at `let fail = 0, warn = 0, ...` — now belongs to `healthCheck`, which returns `number` synchronously; it has no `await`. `run` stays `async` so the dispatcher's `Promise<number>` contract holds.)

Add stubs so the file compiles until Tasks 5–6 fill them (they will be replaced, not kept empty):

```ts
function rosterPlan(): number { return 0; }
function rosterSet(_providers: string[]): number { return 0; }
```

> Note: `_providers` is intentionally unused in this stub; eslint `no-unused-vars` ignores the leading-underscore name. Task 6 renames it to `providers` when the body lands.

- [ ] **Step 3: Run the existing suite to verify no regression**

Run: `npx vitest run tests/soundcheck.test.ts`
Expected: PASS — health check still runs for `run([])`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/commands/soundcheck.ts
git commit -m "refactor(soundcheck): verb dispatch (roster-plan/roster-set/health) — no behavior change"
```

### Task 5: `roster-plan` subcommand

**Files:**
- Modify: `src/commands/soundcheck.ts`
- Test: `tests/soundcheck-roster.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/soundcheck-roster.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { globalRoot } from "../src/core/paths.js";
import { run as soundcheck } from "../src/commands/soundcheck.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); process.env.CLAUDE_PLUGIN_ROOT = process.cwd(); });
afterEach(() => { env.cleanup(); });

function stageAvailable(lines: string[]): void {
  writeFileSync(join(globalRoot(), "providers-available.txt"), lines.join("\n") + (lines.length ? "\n" : ""));
}
function captureStdout(): { text: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((s: unknown) => { chunks.push(String(s)); return true; }) as never);
  return { text: () => chunks.join(""), restore: () => spy.mockRestore() };
}

describe("soundcheck roster-plan", () => {
  it("emits validated detected + decision JSON", async () => {
    stageAvailable(["codex", "claude"]);
    const cap = captureStdout();
    const rc = await soundcheck(["roster-plan"]);
    cap.restore();
    expect(rc).toBe(0);
    const out = JSON.parse(cap.text());
    expect(out.detected).toEqual(["codex", "claude"]);
    expect(out.decision).toBe("prompt");
  });
  it("filters non-validated providers into skipped", async () => {
    stageAvailable(["codex", "fooai"]);
    const cap = captureStdout();
    await soundcheck(["roster-plan"]);
    cap.restore();
    const out = JSON.parse(cap.text());
    expect(out.detected).toEqual(["codex"]);
    expect(out.skipped).toEqual(["fooai (consult_validated: false)"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/soundcheck-roster.test.ts`
Expected: FAIL — `roster-plan` returns the Task-4 stub (`0` with no stdout), so `JSON.parse("")` throws / assertions fail.

- [ ] **Step 3: Implement `rosterPlan` (replace the Task-4 stub)**

Add the imports this task uses to the top of `src/commands/soundcheck.ts` (Task 6 adds `formatActiveFile` + `isoUtc` when it needs them — keep `no-unused-vars` happy by introducing each import where first used):

```ts
import { readProviderList, planRoster } from "../core/providers.js";
```

Extend the existing `../core/contracts.js` import to include `instrumentConsultValidated`:

```ts
import { contractsExist, listInstruments, instrumentBinary, instrumentConsultValidated } from "../core/contracts.js";
```

Add a shared helper + replace the `rosterPlan` stub:

```ts
function detectedValidatedProviders(): string[] {
  const available = readProviderList(join(globalRoot(), "providers-available.txt"));
  return available.filter((p) => instrumentConsultValidated(p));
}

function rosterPlan(): number {
  const available = readProviderList(join(globalRoot(), "providers-available.txt"));
  const detected = available.filter((p) => instrumentConsultValidated(p));
  const skipped = available
    .filter((p) => !instrumentConsultValidated(p))
    .map((p) => `${p} (consult_validated: false)`);
  const prior = readProviderList(join(globalRoot(), "providers-active.txt"));
  const plan = planRoster({ detectedValidated: detected, prior });
  process.stdout.write(JSON.stringify({ ...plan, skipped }) + "\n");
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/soundcheck-roster.test.ts`
Expected: PASS (2 tests). Also run `npx vitest run tests/soundcheck.test.ts` — still PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/soundcheck.ts tests/soundcheck-roster.test.ts
git commit -m "feat(soundcheck): roster-plan emits validated roster + decision JSON"
```

### Task 6: `roster-set` subcommand

**Files:**
- Modify: `src/commands/soundcheck.ts`
- Test: `tests/soundcheck-roster.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/soundcheck-roster.test.ts`; add `readFileSync, existsSync` to the `node:fs` import)

```ts
import { readFileSync, existsSync } from "node:fs"; // extend the existing node:fs import

describe("soundcheck roster-set", () => {
  it("empty selection → rc 1, no file written", async () => {
    stageAvailable(["codex", "claude"]);
    const rc = await soundcheck(["roster-set"]);
    expect(rc).toBe(1);
    expect(existsSync(join(globalRoot(), "providers-active.txt"))).toBe(false);
  });
  it("provider not in detected-validated → rc 1, no file", async () => {
    stageAvailable(["codex", "claude"]);
    const rc = await soundcheck(["roster-set", "fooai"]);
    expect(rc).toBe(1);
    expect(existsSync(join(globalRoot(), "providers-active.txt"))).toBe(false);
  });
  it("happy path atomic-writes the active file + prints confirmation", async () => {
    stageAvailable(["codex", "claude", "agy"]);
    const cap = captureStdout();
    const rc = await soundcheck(["roster-set", "codex", "claude"]);
    cap.restore();
    expect(rc).toBe(0);
    const body = readFileSync(join(globalRoot(), "providers-active.txt"), "utf8");
    expect(body).toContain("by /consort:soundcheck");
    expect(body.trim().split("\n").slice(-2)).toEqual(["codex", "claude"]);
    expect(cap.text()).toContain("active set: codex, claude");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/soundcheck-roster.test.ts`
Expected: FAIL — `roster-set` is the Task-4 stub (always `0`, writes nothing).

- [ ] **Step 3: Implement `rosterSet` (replace the stub)**

Ensure these imports are present at the top of `src/commands/soundcheck.ts` (add the ones introduced here):

```ts
import { readProviderList, planRoster, formatActiveFile } from "../core/providers.js";
import { isoUtc } from "../core/archive.js";
```

Replace the `rosterSet` stub with:

```ts
function rosterSet(providers: string[]): number {
  if (providers.length === 0) {
    log.error("must select at least one provider; selection unchanged");
    return 1;
  }
  const valid = new Set(detectedValidatedProviders());
  const bad = providers.filter((p) => !valid.has(p));
  if (bad.length > 0) {
    log.error(`not in the detected validated set: ${bad.join(", ")}; selection unchanged`);
    return 1;
  }
  const root = globalRoot();
  mkdirSync(root, { recursive: true });
  atomicWrite(join(root, "providers-active.txt"), formatActiveFile(providers, isoUtc()));
  process.stdout.write(`active set: ${providers.join(", ")} (written to providers-active.txt)\n`);
  return 0;
}
```

(`mkdirSync`, `atomicWrite`, `log`, `globalRoot`, `join` are already imported in `soundcheck.ts`. `detectedValidatedProviders` was added in Task 5.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/soundcheck-roster.test.ts`
Expected: PASS (5 tests). Then `npm run typecheck` and `npm run lint` — both clean (confirms `formatActiveFile`/`isoUtc` imports are now consumed).

- [ ] **Step 5: Commit**

```bash
git add src/commands/soundcheck.ts tests/soundcheck-roster.test.ts
git commit -m "feat(soundcheck): roster-set validates + atomic-writes providers-active.txt"
```

---

## Phase 3 — the directive

### Task 7: `commands/soundcheck.md` picker section

**Files:**
- Modify: `commands/soundcheck.md`
- Test: `npx vitest run tests/stale-tokens.test.ts` (gate)

- [ ] **Step 1: Update the front-matter description**

Replace the description line in the front-matter (it already mentions "roster picker"; make it accurate to the now-real flow):

```
description: Health check (tmux/state/config/providers) plus interactive roster picker — selects the active provider set for /consort:score
```

- [ ] **Step 2: Append the picker section** after the existing Step 3

Add this section to the end of `commands/soundcheck.md`:

````markdown
## Roster selection (always-interactive)

After the health check (Steps 1–3) runs and writes `providers-available.txt`, pick which
detected `consult_validated` providers form the active ensemble for `/consort:score`. The
selection persists at `~/.consort/providers-active.txt` (global, one per machine). This is the
user's preference layer on top of the mechanical detection. Every `/consort:soundcheck` run
performs Steps 4–6; whether the user sees a prompt depends on the detected count.

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

### Step 4 — Plan

Run `$CS soundcheck roster-plan`. It prints one JSON object to stdout (stderr holds logs):

```json
{ "detected": ["codex","claude"], "prior": ["codex"], "skipped": [], "dropped": [], "decision": "skip|auto|prompt", "auto": "codex" }
```

Print each `skipped` and `dropped` entry as a `note:` line so the user sees what changed
(e.g. `note: removed gone (no longer detected)`, `note: fooai (consult_validated: false)`).

### Step 5 — Branch on `decision`

- **`skip`** (0 validated providers) — stop here. If `skipped` is non-empty, add:
  `tip: your contracts.yaml may predate the current provider set; refresh it with
  cp "${CLAUDE_PLUGIN_ROOT}/config/contracts.yaml" ~/.consort/contracts.yaml`.
- **`auto`** (exactly 1) — run `$CS soundcheck roster-set <auto>` and print its confirmation. Done.
- **`prompt`** — build the menu from `detected` (use the provider names verbatim — codex / claude /
  agy / opencode). The shape depends on `detected.length`:

  - **2 providers `[A, B]`** — one `AskUserQuestion`, 4 options:
    `Both A + B` / `A only` / `B only` / `Customize…`.
    If `prior` equals one preset subset exactly, relabel that option to start with
    `Keep current selection (…)` and make it the recommended option.

  - **3 providers `[A, B, C]`** — nested (the 4-option cap rules out a flat 5-option menu):
    - **D.1** (3 options): `All three (A + B + C)` / `Pick a pair (drill in)` / `Customize…`.
    - **D.2** (fires only on "Pick a pair", 3 options): `A + B` / `A + C` / `B + C`.
    - If `prior` is exactly all three → relabel `All three` as `Keep current selection (…)` and
      recommend it. If `prior` is one of the pairs → recommend `Pick a pair` in D.1 and recommend
      the matching pair in D.2.

  - **4+ providers** — per-provider walk: one `AskUserQuestion` per provider (in `detected`
    order), 2 options `Include` / `Exclude`. Recommend `Include` when the provider is in `prior`
    OR `prior` is empty (first-time selection); otherwise recommend `Exclude`. Collect the
    included set.

  `Customize…` from any preset menu falls through to the same per-provider walk.

### Step 6 — Persist

Pass the chosen providers (space-separated, provider names) to roster-set:

```
$CS soundcheck roster-set <p1> <p2> …
```

- The empty-set guard lives in the CLI: if the walk's included set is empty, `roster-set` (called
  with no providers) returns rc 1 and prints `must select at least one provider; selection
  unchanged` to stderr — surface that, and leave the prior selection intact (do not retry
  automatically; the user can re-run `/consort:soundcheck`).
- On success, print roster-set's `active set: …` confirmation line.

## Notes

- Selection is global (`~/.consort/providers-active.txt`), not per-repo. `/consort:score` reads
  it first, falling back to `providers-available.txt` (the `activeProvidersPath()` resolver).
- Re-running `/consort:soundcheck` shows the prior selection as the recommended "Keep current"
  option, so keeping the roster is one tap.
````

- [ ] **Step 3: Run the stale-token gate**

Run: `npx vitest run tests/stale-tokens.test.ts`
Expected: PASS — no `clone-wars` / `cw_` / `master-yoda` / `MISSION ACCOMPLISHED` / `@cw_` tokens in the new directive text.

- [ ] **Step 4: Commit**

```bash
git add commands/soundcheck.md
git commit -m "feat(soundcheck): always-interactive roster picker directive"
```

---

## Phase 4 — build, verify, dogfood

### Task 8: Full gates, bundle, and live dogfood

**Files:**
- Modify: `dist/consort.cjs` (rebuilt), `docs/superpowers/DOGFOOD.md`

- [ ] **Step 1: Run the full gate suite**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: `tsc --noEmit` clean; eslint clean; all vitest suites green (the existing suites + the new `providers` and `soundcheck-roster` suites + the stale-token gate).

- [ ] **Step 2: Rebuild the committed bundle**

Run: `npm run build`
Expected: `dist/consort.cjs` rewritten; `node dist/consort.cjs soundcheck roster-plan` runs (it will read your real `~/.consort/providers-available.txt`).

- [ ] **Step 3: Live dogfood** (the acceptance gate; run inside tmux with `CLAUDE_PLUGIN_ROOT=$PWD` and an isolated `CONSORT_HOME`)

Exercise, end to end:
1. `/consort:soundcheck` → health table renders → the picker prompts (menu shape per your installed provider count) → on a selection, `providers-active.txt` is written with the chosen subset; the `active set: …` confirmation prints.
2. **Re-run** `/consort:soundcheck` → the prior selection is the recommended `Keep current selection (…)` option.
3. **Stale path** — temporarily remove a provider from `~/.consort/providers-available.txt` (or uninstall a binary and re-run), confirm the next plan drops it with a `note:` line and the menu no longer offers it.
4. **Empty-set guard** — via `Customize…`, exclude every provider; confirm `roster-set` refuses to write and the prior `providers-active.txt` is untouched.
5. Confirm `node dist/consort.cjs` and the resolver agree: after a write, `providers-active.txt` exists at `$CONSORT_HOME` and is what `activeProvidersPath()` returns.

- [ ] **Step 4: Append the dogfood result to `DOGFOOD.md`**

Append a `# Consort soundcheck roster-picker — Dogfood Result` section to `docs/superpowers/DOGFOOD.md`: date, verdict, the run table (the five checks above), and any bugs found + fixes. Mirror the existing `solo` section's format.

- [ ] **Step 5: Commit the bundle + dogfood record**

```bash
git add dist/consort.cjs docs/superpowers/DOGFOOD.md
git commit -m "build(soundcheck): rebuild dist + roster-picker dogfood record"
```

---

## Self-Review (run by the plan author — recorded here)

**1. Spec coverage:**
- §4 command surface — Task 4 (dispatch), Task 5 (`roster-plan` + JSON shape), Task 6 (`roster-set` + empty/invalid guards). ✓
- §4 `core/providers.ts` (`parseProviderList`/`readProviderList`/`planRoster`/`formatActiveFile`) — Tasks 1–3. ✓
- §5 directive (always-interactive; N=2 preset / N=3 nested / N≥4 walk / auto / skip; keep-current; empty-set guard; provider-name labels) — Task 7. ✓
- §6 file format + global location + resolver reuse — Task 3 (`formatActiveFile`) + Task 6 (`globalRoot()` write); resolver already exists. ✓
- §7 error handling (missing available → skip; corrupted → no-throw; stale drop; empty guard; invalid arg) — covered by `readProviderList` (`[]` on missing/unreadable), `planRoster` (stale drop), `rosterSet` (empty + invalid). ✓
- §8 rebrand/frozen (`consult_validated` kept; stale gate) — Task 7 Step 3. ✓
- §9 testing — Tasks 1–6 unit/integration; stale gate Task 7; gates Task 8. ✓
- §10 acceptance + dogfood — Task 8. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. The only "unchanged body" reference is Task 4's mechanical move of the existing `healthCheck` body (it already exists in the repo, shown by its anchor line). ✓

**3. Type consistency:** `RosterPlan`/`RosterDecision`/`planRoster`/`parseProviderList`/`readProviderList`/`formatActiveFile` names and signatures match across Tasks 1–6 and the test imports. `detectedValidatedProviders()` is defined in Task 5 and reused in Task 6. `run(args)` dispatch keys (`roster-plan`/`roster-set`) match the directive's invocations in Task 7. ✓
