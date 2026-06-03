# args-file multi-line topic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `loadArgsFile` from silently dropping everything after the first newline of a multi-line `$ARGUMENTS`, so long multi-paragraph topics survive `init` intact across every command.

**Architecture:** A single ~2-line change in the shared args-file loader (`src/args.ts`) — read the whole file and normalize newlines (LF/CRLF) to spaces before tokenizing, instead of reading only `split("\n")[0]`. One loader serves all commands (`score`/`prelude`/`solo`/`perform`/`rehearsal`/`roster`/`coda`/`soundcheck`) via `applyArgsFile`, so the fix is universal. A vitest regression suite (`tests/args.test.ts`) pins the behavior; `dist/consort.cjs` is rebuilt and the version bumped to 0.1.10.

**Tech Stack:** TypeScript (Node/ESM), vitest, esbuild (single committed bundle `dist/consort.cjs`).

**Spec:** `docs/superpowers/specs/2026-06-03-args-file-multiline-topic-design.md`

---

### Task 1: Multi-line args-file preservation (regression test + loader fix, TDD)

**Files:**
- Modify: `src/args.ts:22-26` (the private `loadArgsFile` function)
- Test: `tests/args.test.ts` (existing vitest suite — append four cases inside the existing `describe("args", ...)` block, after the existing `applyArgsFile` cases)

Context for the implementer: `applyArgsFile(["--args-file", path, ...extra])` reads the file at
`path` via the private `loadArgsFile`, deletes the file, and returns `[...tokensFromFile, ...extra]`.
`loadArgsFile` currently reads only the first line. `tokenizeArgsLine` splits on spaces/tabs and
strips `'`/`"` quotes (existing behavior — do not change it). The four new tests below all FAIL
against the current first-line-only loader and PASS after the fix.

- [ ] **Step 1: Write the failing tests**

In `tests/args.test.ts`, add these four `it(...)` blocks inside the existing `describe("args", () => { ... })`, immediately after the existing `it("applyArgsFile: missing file → silent fallback", ...)` case (the imports `mkdtempSync`, `writeFileSync`, `tmpdir`, `join`, `applyArgsFile` are already present at the top of the file):

```ts
  it("applyArgsFile preserves content after the first newline (multi-line $ARGUMENTS)", () => {
    const f = join(mkdtempSync(join(tmpdir(), "af-")), "args");
    writeFileSync(f, "enhance debug mode\nENHANCEMENT one\nENHANCEMENT two");
    expect(applyArgsFile(["--args-file", f])).toEqual([
      "enhance", "debug", "mode", "ENHANCEMENT", "one", "ENHANCEMENT", "two",
    ]);
  });
  it("applyArgsFile: a flag on line 1 and a multi-line topic body all survive", () => {
    const f = join(mkdtempSync(join(tmpdir(), "af-")), "args");
    writeFileSync(f, "--ensemble\nresearch the thing\nwith more detail");
    expect(applyArgsFile(["--args-file", f])).toEqual([
      "--ensemble", "research", "the", "thing", "with", "more", "detail",
    ]);
  });
  it("applyArgsFile handles CRLF line endings", () => {
    const f = join(mkdtempSync(join(tmpdir(), "af-")), "args");
    writeFileSync(f, "alpha beta\r\ngamma");
    expect(applyArgsFile(["--args-file", f])).toEqual(["alpha", "beta", "gamma"]);
  });
  it("applyArgsFile: consecutive and trailing newlines yield no empty tokens", () => {
    const f = join(mkdtempSync(join(tmpdir(), "af-")), "args");
    writeFileSync(f, "one\n\ntwo\n");
    expect(applyArgsFile(["--args-file", f])).toEqual(["one", "two"]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/args.test.ts`
Expected: FAIL. The four new cases fail because the current loader reads only line 1 — e.g. the multi-line case returns `["enhance","debug","mode"]` (ENHANCEMENT tokens dropped); the CRLF case returns `["alpha","beta\r"]` (carriage return retained, `gamma` dropped). The five pre-existing cases still pass.

- [ ] **Step 3: Implement the fix**

In `src/args.ts`, replace the body of `loadArgsFile` (lines 22-26):

```ts
function loadArgsFile(path: string): string[] {
  if (!existsSync(path)) return [];
  const first = readFileSync(path, "utf8").split("\n")[0] ?? "";
  return tokenizeArgsLine(first);
}
```

with:

```ts
function loadArgsFile(path: string): string[] {
  if (!existsSync(path)) return [];
  // The conductor writes $ARGUMENTS verbatim, which may span multiple lines (a
  // multi-paragraph topic). Read the WHOLE file; collapse newlines to spaces so line
  // breaks act as token separators without gluing words across the seam. Reading only
  // the first line silently dropped everything after the first newline.
  const raw = readFileSync(path, "utf8").replace(/\r?\n/g, " ");
  return tokenizeArgsLine(raw);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- tests/args.test.ts`
Expected: PASS — all nine cases (five pre-existing + four new) green.

- [ ] **Step 5: Run the full gate**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: `tsc --noEmit` exits 0; the full vitest suite passes (including `tests/stale-tokens.test.ts`); eslint clean. If the harness LSP reports a phantom error on `src/args.ts`, trust `npm run typecheck` (it is authoritative).

- [ ] **Step 6: Commit**

```bash
git add src/args.ts tests/args.test.ts
git commit -m "fix(args): read the whole args file, not just line 1

loadArgsFile read only split(\"\\n\")[0], silently dropping every line
after the first newline of a multi-line \$ARGUMENTS. Read the whole file
and normalize newlines to spaces so multi-paragraph topics survive init
across all commands. Regression tests in tests/args.test.ts.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Rebuild the bundle and bump the version to 0.1.10

**Files:**
- Modify: `package.json` (the `"version"` field)
- Modify: `.claude-plugin/plugin.json` (the `"version"` field)
- Modify: `.claude-plugin/marketplace.json` (the plugin entry `"version"` field)
- Modify: `dist/consort.cjs` (regenerated by the build — committed, never hand-edited)

Context: the project ships a committed bundle (zero-build install) and keeps the version in lockstep
across three manifests. Current version is `0.1.9`; bump to `0.1.10`.

- [ ] **Step 1: Confirm the current version, then bump all three manifests**

Run first to confirm the starting point:
`grep -rn '"version"' package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json`
Expected: each shows `"version": "0.1.9"` (marketplace.json inside its plugin entry).

Then edit each file, changing `"version": "0.1.9"` to `"version": "0.1.10"` (exact string replace; one occurrence per file).

- [ ] **Step 2: Rebuild the bundle**

Run: `npm run build`
Expected: esbuild writes `dist/consort.cjs` with no errors.

- [ ] **Step 3: Verify the fix is in the bundle and the gate is green**

Run: `grep -F 'replace(/\r?\n/g' dist/consort.cjs`
Expected: at least one match (the new loader line is present in the shipped bundle).

Run: `npm run typecheck && npm run test`
Expected: typecheck exits 0; full vitest suite passes.

Run: `git status --porcelain dist/consort.cjs`
Expected: `dist/consort.cjs` appears as modified (the rebuild changed it).

- [ ] **Step 4: Commit**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "chore(release): 0.1.10 — args-file multi-line topic fix

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Frozen protocol:** do not rename `inbox.md`, `END_OF_INSTRUCTION`, or the `topic` JSON field; do
  not touch the `deriveSlug` `.slice(0,20)` or `preflight` 64-char slug caps (those are the directory
  key, out of scope). No banned token (`clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_`)
  may be introduced — `tests/stale-tokens.test.ts` enforces this.
- **Out of scope:** the tokenizer still strips `'`/`"` from prose topics — a separate, pre-existing,
  lower-impact issue. Do not "fix" it here; that would change `tokenizeArgsLine` and the shared args
  contract (the rejected Approach B).
- **Do not modify** any other command, composer, or `inboxWrite` — the only code change is the four
  lines inside `loadArgsFile`.
