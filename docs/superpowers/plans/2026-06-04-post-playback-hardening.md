# Post-playback hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three consort defects from the 2026-06-03/04 playback — solo's fixed-OFFSET re-arm loop, perform's context-blind single-repo `Target Sub-Project` header, and the args tokenizer corrupting prose topics — additively, with no frozen wire token renamed.

**Architecture:** Three independent surgical changes on one branch (`fix/post-playback-hardening`), one release `0.1.20 → 0.1.21`. Fix 1 mirrors `perform turnWaitWith`. Fix 2 adds a tolerant guard in `resolveTarget` and drops the singular-header emit in `assembleDoc`. Fix 3 adds an opt-in verbatim-tail mode to `applyArgsFile` (it does not modify `tokenizeArgsLine`).

**Tech Stack:** TypeScript (Node/ESM), vitest, esbuild → `dist/consort.cjs` (committed). Test isolation via `tests/helpers/tmpHome.ts` `freshHome()` / per-test `mkdtempSync`.

**Spec:** `docs/superpowers/specs/2026-06-04-post-playback-hardening-design.md`

**Conventions for every task:** run `npm run typecheck && npm run lint && npm run test` before each commit; do **not** run `npm run build` (the release task owns that). Ignore phantom LSP "cannot find module" diagnostics — `npm run typecheck` is authoritative. Never weaken `tests/stale-tokens.test.ts`. No emojis in shipped output.

---

### Task 1: Fix 1 — `solo turn-wait` bumps OFFSET on a question (mirror perform)

**Files:**
- Modify: `src/commands/solo.ts` (imports + `turnWaitWith`)
- Modify: `commands/solo.md` (one clarifying line)
- Test: `tests/solo-cmd.test.ts` (add to the `solo turn-wait (turnWaitWith core)` describe)

- [ ] **Step 1: Write the failing test**

In `tests/solo-cmd.test.ts`, add these imports near the other test imports if not already present:

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { outboxPath } from "../src/core/ipc.js";
```

Then add this test inside the existing `describe("solo turn-wait (turnWaitWith core)", ...)` block (it uses the existing `scaffold(topic, stateBody)` helper that writes `instrument.txt`=`violin`, `selected-provider.txt`=`codex`, and `turn-1.txt`):

```ts
it("question: appends a bumped OFFSET so a re-arm resumes past it (no loop)", async () => {
  await scaffold("auth", "OFFSET=0\n");
  // Give the part an outbox with known bytes so the bump is non-zero (outboxOffset = file size).
  const ob = outboxPath("violin", "codex", "auth");
  mkdirSync(dirname(ob), { recursive: true });
  const body = '{"event":"question","message":"which db?"}\n';
  writeFileSync(ob, body);
  const N = Buffer.byteLength(body);
  const seen: number[] = [];
  const wait = async (_i: string, _m: string, _t: string, off: number) => {
    seen.push(off);
    return seen.length === 1 ? { event: "question", message: "which db?" } : { event: "done", summary: "ok" };
  };
  await turnWaitWith("auth", 1, { wait });   // round 1: handles the question at offset 0
  await turnWaitWith("auth", 1, { wait });   // re-arm on the SAME round must resume past it
  const state = readFileSync(join(soloExecDir("auth"), "turn-1.txt"), "utf8");
  expect(state).toContain(`OFFSET=${N}`);     // a bumped OFFSET line was appended on the question
  expect(seen).toEqual([0, N]);               // the re-arm read the LATEST offset, not 0 (no loop)
});
```

(If `soloExecDir` is not already imported in this file, add it to the existing
`import { soloArtDir } from "../src/core/solo.js";` line → `import { soloArtDir, soloExecDir } from "../src/core/solo.js";`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/solo-cmd.test.ts -t "resumes past it"`
Expected: FAIL — current code appends only `TS=question` (no second `OFFSET=` line) and reads first-match `parseOffset`, so `seen` is `[0, 0]` and the `OFFSET=${N}` assertion is absent.

- [ ] **Step 3: Write minimal implementation**

In `src/commands/solo.ts`:

1. Imports — `parseOffset` becomes unused after this change (it is only used at the offset-read line below), so drop it and add `parseLatestOffset`. Change:

```ts
import { composeRound1Prompt, composeFixPrompt, classifyTurn, parseOffset } from "../core/turn.js";
```
to:
```ts
import { composeRound1Prompt, composeFixPrompt, classifyTurn } from "../core/turn.js";
import { parseLatestOffset } from "../core/scoreTurn.js";
```

(Grep the file to confirm `parseOffset` has no other use; it does not.)

2. In `turnWaitWith`, change the offset read from `parseOffset` to `parseLatestOffset`:

```ts
  const offset = parseLatestOffset(readFileSync(stateFile, "utf8"));
```

3. In `turnWaitWith`, replace the two lines that write the question payload + `TS=`:

```ts
  if (ts === "question" && ev) atomicWrite(join(exec, `question-${round}.txt`), JSON.stringify(ev) + "\n");
  appendFileSync(stateFile, `TS=${ts}\n`);
```
with:
```ts
  if (ts === "question" && ev) {
    atomicWrite(join(exec, `question-${round}.txt`), JSON.stringify(ev) + "\n");
    // Advance the offset past the handled question so a same-round re-arm does not re-read it
    // (mirrors perform turnWaitWith; solo has no objection routing, so no OBJECTIONS= line).
    const bumped = outboxOffset(outboxPath(instrument, provider, topic));
    appendFileSync(stateFile, `OFFSET=${bumped}\nTS=question\n`);
  } else {
    appendFileSync(stateFile, `TS=${ts}\n`);
  }
```

(`outboxOffset` and `outboxPath` are already imported in `solo.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/solo-cmd.test.ts`
Expected: PASS — the new test plus the existing `question → captures payload + TS=question`, `done`, `timeout`, and `missing OFFSET → rc 1` cases all green.

- [ ] **Step 5: Update the directive note**

In `commands/solo.md`, find the turn-wait question re-arm section (the contract that re-runs `solo turn-wait <SLUG> 1` after a `TS=question`). Add one sentence there:

> The re-arm resumes past the handled question automatically — `turn-wait` appends a bumped `OFFSET=` line on a question, so you never hand-edit `OFFSET=`.

- [ ] **Step 6: Verify gates + commit**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green (full suite).

```bash
git add src/commands/solo.ts commands/solo.md tests/solo-cmd.test.ts
git commit -m "fix(solo): advance turn-wait OFFSET past a handled question (no re-arm loop)"
```

---

### Task 2: Fix 2 — `perform` tolerates the self-named header; `score` stops minting it

**Files:**
- Modify: `src/core/perform.ts` (`resolveTarget` guard + `basename` import)
- Modify: `src/core/scoreDoc.ts` (`assembleDoc` drops the `single-sub` header)
- Modify: `commands/score.md` (one-line description update)
- Test: `tests/perform.test.ts` (resolveTarget hub-self case), `tests/score-doc.test.ts` (single-sub now header-less)

- [ ] **Step 1: Write the failing tests**

In `tests/perform.test.ts`, add this case inside `describe("resolveTarget", ...)` (it already imports `mkdirSync`, `writeFileSync`, `mkdtempSync`, `join`, `tmpdir`, `resolveTarget`, and has a local `writeDoc(root, body)` helper):

```ts
it("header slug == basename(cwd) + no such child -> returns cwd (hub-self, single-repo)", () => {
  const parent = mkdtempSync(join(tmpdir(), "rt-"));
  const cwd = join(parent, "api");
  mkdirSync(cwd, { recursive: true });
  // The doc names sub-project "api"; perform is being run from inside <parent>/api.
  expect(resolveTarget(writeDoc(cwd, "**Target Sub-Project:** api\n"), cwd)).toBe(cwd);
});
```

In `tests/score-doc.test.ts`, REPLACE the existing `single-sub` test:

```ts
  it("single-sub: Date + singular Target header", () => {
    const doc = assembleDoc({ title: "X", mode: "single-sub", date: "2026-05-29", targets: ["api"], drafts });
    expect(doc).toContain("**Date:** 2026-05-29\n");
    expect(doc).toContain("**Target Sub-Project:** api\n\n");
  });
```
with:
```ts
  it("single-sub: header-less single shape (no Date, no Target header)", () => {
    const doc = assembleDoc({ title: "X", mode: "single-sub", date: "2026-05-29", targets: ["api"], drafts });
    expect(doc.startsWith("# X\n\n")).toBe(true);
    expect(doc).not.toContain("**Target Sub-Project:**");
    expect(doc).not.toContain("**Date:**");
    expect(doc).toContain("## Goal\n\ng\n");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/perform.test.ts -t "hub-self" && npx vitest run tests/score-doc.test.ts -t "header-less"`
Expected: FAIL — `resolveTarget` currently throws `PerformResolveError` for the hub-self case; `assembleDoc` still emits the `**Date:**` + `**Target Sub-Project:**` lines for `single-sub`.

- [ ] **Step 3: Implement the perform-side guard**

In `src/core/perform.ts`:

1. Add `basename` to the `node:path` import. Change `import { join } from "node:path";` to `import { join, basename } from "node:path";` (confirm the exact current import line first — if `basename` is already imported, skip).

2. In `resolveTarget`, replace the `if (!isDir) { ... }` block:

```ts
  if (!isDir) {
    throw new PerformResolveError(`target sub-project '${slug}' not found at ${sub} (no directory; check spelling or that the sub-repo is checked out)`);
  }
```
with:
```ts
  if (!isDir) {
    // A single-target doc carries a `**Target Sub-Project:** <slug>` header minted from the hub.
    // When perform runs from INSIDE that sub-project, <cwd>/<slug> is <slug>/<slug> and absent — but
    // the header just names the repo we are already standing in. Treat that as single-repo.
    if (basename(cwd) === slug) return cwd;
    throw new PerformResolveError(`target sub-project '${slug}' not found at ${sub} (no directory; check spelling or that the sub-repo is checked out)`);
  }
```

- [ ] **Step 4: Implement the score-side header drop**

In `src/core/scoreDoc.ts` `assembleDoc`, replace the header block:

```ts
  if (input.mode === "multi") {
    out += `**Date:** ${input.date}\n`;
    out += `**Target Sub-Project(s):** ${input.targets.join(", ")}\n\n`;
  } else if (input.mode === "single-sub") {
    out += `**Date:** ${input.date}\n`;
    out += `**Target Sub-Project:** ${input.targets[0] ?? ""}\n\n`;
  }
```
with:
```ts
  if (input.mode === "multi") {
    out += `**Date:** ${input.date}\n`;
    out += `**Target Sub-Project(s):** ${input.targets.join(", ")}\n\n`;
  }
  // single / single-sub: header-less. A lone target is delivered as a single-repo doc; perform
  // infers the target from its cwd (resolveTarget's hub-self guard), so the singular header — which
  // mis-resolves to <slug>/<slug> when perform runs inside the sub-project — is no longer emitted.
```

Also update the function's doc comment line so it is not stale. Change:

```ts
/** Port of bin/consult-walk-assemble.sh's concat. v0.17 header = H1 + (multi/single-sub) Date + Target. */
```
to:
```ts
/** Port of bin/consult-walk-assemble.sh's concat. Header = H1 + (multi only) Date + plural Target;
 *  single / single-sub are header-less (perform infers a lone target from cwd). */
```

- [ ] **Step 5: Update the directive description**

In `commands/score.md`, find the line (around the Stage 11 section) reading:

```
success-criteria** (single-sub uses the 6 base sections + the singular header). The 2 multi-only sections
```
and change the parenthetical to:
```
success-criteria** (single-sub uses the 6 base sections, header-less like single — a lone target ships as a single-repo doc; perform infers the target from its cwd). The 2 multi-only sections
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/perform.test.ts tests/score-doc.test.ts`
Expected: PASS — the hub-self case returns `cwd`; the existing `valid header + sibling git repo → <cwd>/<slug>`, `valid header + missing dir → throws` (its root basename is a random `rt-…`, not the slug, so it still throws), `two headers → throws`, and `no header → cwd` cases stay green; `assembleDoc` single-sub is header-less and multi still emits the plural header.

- [ ] **Step 7: Verify gates + commit**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green.

```bash
git add src/core/perform.ts src/core/scoreDoc.ts commands/score.md tests/perform.test.ts tests/score-doc.test.ts
git commit -m "fix(perform,score): tolerate self-named Target header + stop minting it for a lone target"
```

---

### Task 3: Fix 3 (core) — args verbatim-tail mode in `applyArgsFile`

**Files:**
- Modify: `src/args.ts` (`ArgsFileOpts` + `loadArgsFileVerbatim` + `applyArgsFile` opts param)
- Test: `tests/args.test.ts` (new `verbatim-tail` describe)

- [ ] **Step 1: Write the failing tests**

In `tests/args.test.ts`, add this describe block (the file already imports `mkdtempSync`, `writeFileSync`, `existsSync`, `tmpdir`, `join`, `applyArgsFile`):

```ts
describe("applyArgsFile verbatim-tail (prose mode)", () => {
  function af(content: string): string {
    const f = join(mkdtempSync(join(tmpdir(), "afv-")), "args");
    writeFileSync(f, content);
    return f;
  }
  const opts = (flags: string[]) => ({ valueFlags: new Set(flags) });

  it("preserves apostrophes and quotes in the body (no shell-tokenizing)", () => {
    expect(applyArgsFile(["--args-file", af('fix the part\'s "UI" today')], opts([])))
      .toEqual(['fix the part\'s "UI" today']);
  });
  it("preserves internal newlines / paragraphs verbatim", () => {
    expect(applyArgsFile(["--args-file", af("para one\n\npara two\nmore")], opts([])))
      .toEqual(["para one\n\npara two\nmore"]);
  });
  it("peels a leading boolean flag + value flag, body verbatim", () => {
    expect(applyArgsFile(["--args-file", af("--ensemble --targets a,b design the part's thing")], opts(["--targets"])))
      .toEqual(["--ensemble", "--targets", "a,b", "design the part's thing"]);
  });
  it("a --flag=value token stays whole; body follows", () => {
    expect(applyArgsFile(["--args-file", af("--targets=a,b the body")], opts(["--targets"])))
      .toEqual(["--targets=a,b", "the body"]);
  });
  it("an internal --word stays inside the verbatim body", () => {
    expect(applyArgsFile(["--args-file", af("use --force carefully please")], opts([])))
      .toEqual(["use --force carefully please"]);
  });
  it("empty body yields just the flags (no empty token)", () => {
    expect(applyArgsFile(["--args-file", af("--ensemble")], opts([]))).toEqual(["--ensemble"]);
  });
  it("trims a trailing newline the Write tool appends", () => {
    expect(applyArgsFile(["--args-file", af("body text\n")], opts([]))).toEqual(["body text"]);
  });
  it("consumes the args file (like the no-opts path)", () => {
    const f = af("hello there");
    applyArgsFile(["--args-file", f], opts([]));
    expect(existsSync(f)).toBe(false);
  });
  it("no-opts path is unchanged (still shell-tokenizes, glues the unterminated quote)", () => {
    expect(applyArgsFile(["--args-file", af("fix the part's thing")]))
      .toEqual(["fix", "the", "parts thing"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/args.test.ts -t "verbatim-tail"`
Expected: FAIL — `applyArgsFile` does not yet accept an `opts` argument, so the verbatim cases tokenize (and TypeScript may flag the extra argument); the `no-opts path` case passes (it already documents current behavior).

- [ ] **Step 3: Implement the verbatim-tail loader**

In `src/args.ts`, add the opts type and loader, and extend `applyArgsFile`. Add after `tokenizeArgsLine`:

```ts
export interface ArgsFileOpts { valueFlags: Set<string>; }

/** Verbatim-tail loader for prose-body commands: peel LEADING `--flag [value]` pairs (a flag in
 *  `valueFlags` without `=` consumes the next whitespace-delimited token), then take the rest of the
 *  file as ONE verbatim body token — internal whitespace, newlines, apostrophes, and quotes intact.
 *  Mirrors clone-wars' verbatim-cat delivery; does NOT shell-tokenize the body. */
function loadArgsFileVerbatim(path: string, valueFlags: Set<string>): string[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const isWs = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";
  const flags: string[] = [];
  let i = 0;
  for (;;) {
    while (i < raw.length && isWs(raw[i])) i++;            // skip whitespace before the next token
    if (i >= raw.length) break;
    if (!(raw[i] === "-" && raw[i + 1] === "-")) break;     // first non-"--" token: body starts here
    let j = i;
    while (j < raw.length && !isWs(raw[j])) j++;            // read the flag token
    const flag = raw.slice(i, j);
    flags.push(flag);
    i = j;
    if (valueFlags.has(flag) && !flag.includes("=")) {      // separate-token value flag: consume its value
      while (i < raw.length && isWs(raw[i])) i++;
      let k = i;
      while (k < raw.length && !isWs(raw[k])) k++;
      if (k > i) { flags.push(raw.slice(i, k)); i = k; }
    }
  }
  const body = raw.slice(i).trim();
  return body ? [...flags, body] : flags;
}
```

Then change `applyArgsFile`:

```ts
export function applyArgsFile(argv: string[]): string[] {
  if (argv[0] !== "--args-file") return [...argv];
  const path = argv[1];
  if (!path) throw new ArgsFileError("--args-file requires a path");
  const tokens = loadArgsFile(path);
  consumeArgsFile(path);
  return [...tokens, ...argv.slice(2)];
}
```
to:
```ts
export function applyArgsFile(argv: string[], opts?: ArgsFileOpts): string[] {
  if (argv[0] !== "--args-file") return [...argv];
  const path = argv[1];
  if (!path) throw new ArgsFileError("--args-file requires a path");
  const tokens = opts ? loadArgsFileVerbatim(path, opts.valueFlags) : loadArgsFile(path);
  consumeArgsFile(path);
  return [...tokens, ...argv.slice(2)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/args.test.ts`
Expected: PASS — all verbatim-tail cases plus every existing `applyArgsFile`/`tokenizeArgsLine`/`kvParse` test (the no-opts path is untouched).

- [ ] **Step 5: Verify gates + commit**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green.

```bash
git add src/args.ts tests/args.test.ts
git commit -m "feat(args): opt-in verbatim-tail mode so prose topics keep quotes/apostrophes/newlines"
```

---

### Task 4: Fix 3 (wiring) — prose `init` verbs opt into verbatim-tail

**Files:**
- Modify: `src/commands/score.ts`, `src/commands/solo.ts`, `src/commands/prelude.ts`, `src/commands/rehearsal.ts` (the `init` dispatch lines)
- Test: `tests/args.test.ts` (end-to-end parse assertion)

- [ ] **Step 1: Write the failing test**

In `tests/args.test.ts`, add this import at the top:

```ts
import { parseScoreArgs } from "../src/core/score.js";
```

and this test (place it after the verbatim-tail describe; reuse a local `af`):

```ts
describe("verbatim-tail end-to-end into a command parser", () => {
  function af(content: string): string {
    const f = join(mkdtempSync(join(tmpdir(), "afe-")), "args");
    writeFileSync(f, content);
    return f;
  }
  it("score init: --targets parses and the apostrophe survives into topicText", () => {
    const tokens = applyArgsFile(["--args-file", af("--targets a,b redesign the part's status line")], { valueFlags: new Set(["--targets"]) });
    const parsed = parseScoreArgs(tokens);
    expect(parsed.targets).toEqual(["a", "b"]);
    expect(parsed.topicText).toBe("redesign the part's status line");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/args.test.ts -t "survives into topicText"`
Expected: PASS already at the `applyArgsFile` layer (Task 3 made the loader work). This test is a regression guard for the wiring — it does not depend on the dispatch edit. Run it to confirm green; it documents the contract the wiring must preserve. (If you prefer a failing-first gate, the dispatch edits below are mechanical one-liners verified by the full suite in Step 4.)

- [ ] **Step 3: Wire each prose `init` dispatch to pass its `valueFlags`**

`src/commands/score.ts` — change:
```ts
    case "init": return initRun(applyArgsFile(rest));
```
to:
```ts
    case "init": return initRun(applyArgsFile(rest, { valueFlags: new Set(["--targets"]) }));
```

`src/commands/solo.ts` — change:
```ts
    case "init": return initRun(applyArgsFile(rest));
```
to:
```ts
    case "init": return initRun(applyArgsFile(rest, { valueFlags: new Set(["--provider"]) }));
```

`src/commands/prelude.ts` — change:
```ts
    case "init": return initRun(applyArgsFile(rest));
```
to:
```ts
    case "init": return initRun(applyArgsFile(rest, { valueFlags: new Set<string>() }));
```

`src/commands/rehearsal.ts` — change:
```ts
    case "init": return initWith(applyArgsFile(rest), liveInitDeps);
```
to:
```ts
    case "init": return initWith(applyArgsFile(rest, { valueFlags: new Set(["--seed-from", "--time-budget", "--metric", "--slug"]) }), liveInitDeps);
```

Do NOT touch `experiment-send` / `refine` / `abort` (structured positionals; prose arrives via direct CLI), nor `perform` / `roster` / `coda` / `soundcheck` (non-prose bodies).

- [ ] **Step 4: Run the FULL suite to verify no command test regressed**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green. In particular, existing `score`/`solo`/`prelude`/`rehearsal` `init` command tests still pass — a clean prose topic yields the same `topicText` under verbatim-tail as under tokenization (only quotes/apostrophes/whitespace fidelity differ, which those tests do not assert).

- [ ] **Step 5: Commit**

```bash
git add src/commands/score.ts src/commands/solo.ts src/commands/prelude.ts src/commands/rehearsal.ts tests/args.test.ts
git commit -m "feat(args): score/solo/prelude/rehearsal init deliver the topic body verbatim"
```

---

### Task 5: Release — rebuild dist + bump to 0.1.21

**Files:**
- Modify: `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (version)
- Modify: `dist/consort.cjs` (rebuilt)

- [ ] **Step 1: Bump the version in all three manifests**

Set `"version"` from `0.1.20` to `0.1.21` in:
- `package.json` (top-level `"version"`)
- `.claude-plugin/plugin.json` (`"version"`)
- `.claude-plugin/marketplace.json` (the consort plugin entry's `"version"`)

- [ ] **Step 2: Full gate before build**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all green, including `tests/stale-tokens.test.ts`.

- [ ] **Step 3: Build and confirm a clean rebuild**

Run: `npm run build`
Then: `git status --porcelain dist/consort.cjs` (expect it modified), and re-run `npm run build` once more and confirm `git diff --stat dist/consort.cjs` shows no further change (deterministic build, no drift).

- [ ] **Step 4: Sanity-check the built bundle dispatches**

Run: `node dist/consort.cjs score 2>&1 | head -1`
Expected: the score usage line (non-crashing dispatch).

- [ ] **Step 5: Commit**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "chore(release): post-playback hardening (0.1.21)"
```

---

## Acceptance (whole branch)

- `npm run typecheck`, `npm run lint`, `npm run test` (incl. `tests/stale-tokens.test.ts`) all green.
- Fix 1: solo question re-arm resumes past the handled question (bumped `OFFSET=`, `parseLatestOffset`).
- Fix 2: `resolveTarget` returns `cwd` when `basename(cwd) === slug` and the child dir is absent; genuine `<slug>/<slug>` descent and the missing-dir-with-different-basename throw both still hold; `assembleDoc` single-sub is header-less; multi unchanged.
- Fix 3: prose topics keep apostrophes/quotes/paragraphs through `score`/`solo`/`prelude`/`rehearsal` init; every args-file flag still parses; `coda`/`roster`/`soundcheck`/`perform` and the `tokenizeArgsLine` injection tests are unchanged.
- `dist/consort.cjs` rebuilt (no drift) and committed; version `0.1.21` across the three manifests; no frozen wire token renamed; no banned token introduced.
```

