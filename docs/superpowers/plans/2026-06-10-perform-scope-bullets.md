# perform scope-check bullet-list Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `perform`'s scope-conformance guard extract in-scope paths from a bullet-list `## Components` section (not only markdown tables), and make the empty-scope case legible via a `SCOPE_DECLARED=` signal.

**Architecture:** Two additive code changes plus a directive tweak. (1) `extractComponentsPaths` gains a bullet-line branch that harvests *all* path-like tokens, parallel to the existing table-row branch — all 9 existing table tests stay green. (2) `scopeCheckWith` emits `SCOPE_DECLARED=<n>` on stdout and warns when n=0. (3) `commands/perform.md` Stage 4.1 steers the Maestro away from force-keeping a `SCOPE_DECLARED=0` no-op.

**Tech Stack:** TypeScript (Node/ESM), vitest, esbuild bundle (`dist/consort.cjs`, committed).

**Spec:** `docs/superpowers/specs/2026-06-10-perform-scope-bullets-design.md`

**Branch:** create `fix/perform-scope-bullets` off `main` before Task 1. Do NOT work on `main`.

**Build discipline:** Tasks 1-3 must NOT run `npm run build`. Task 4 owns the single dist rebuild + version bump. Every task ends green on `npm run typecheck` + `npm run test`.

---

## File Structure

- **Modify** `src/core/performScope.ts` — add `BULLET_ROW` const + `pathTokensFrom` helper + a bullet branch in `extractComponentsPaths`; update the header comment to record the divergence. (Task 1, Task 4 header note)
- **Modify** `src/commands/perform.ts:301-318` (`scopeCheckWith`) — add the `SCOPE_DECLARED=` stdout line + empty-scope WARN. (Task 2)
- **Modify** `commands/perform.md` (Stage 4.1, ~line 200) — directive steer. (Task 3)
- **Test** `tests/perform-scope.test.ts` — new bullet-extraction cases. (Task 1)
- **Test** `tests/perform-scope-check.test.ts` — new `SCOPE_DECLARED` stdout cases (add a local stdout `capture` helper mirroring `tests/perform-cmd.test.ts:26-35`). (Task 2)
- **Modify** `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — version 0.1.35 → 0.1.36; rebuild `dist/consort.cjs`. (Task 4)

---

## Task 1: Bullet parsing in `extractComponentsPaths`

**Files:**
- Modify: `src/core/performScope.ts:10-42`
- Test: `tests/perform-scope.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases inside the existing `describe("extractComponentsPaths", ...)` block in `tests/perform-scope.test.ts` (the `doc(...)` helper already exists at the top of the file):

```ts
  it("bullet: extracts a backticked path", () => {
    expect(extractComponentsPaths(doc("## Components", "- `src/core/foo.ts` — add helper"))).toEqual(["src/core/foo.ts"]);
  });
  it("bullet: extracts a bare path with a trailing colon label", () => {
    expect(extractComponentsPaths(doc("## Components", "- src/core/bar.ts: edit"))).toEqual(["src/core/bar.ts"]);
  });
  it("bullet: extracts a path that appears mid-line", () => {
    expect(extractComponentsPaths(doc("## Components", "- add a helper to src/core/baz.ts"))).toEqual(["src/core/baz.ts"]);
  });
  it("bullet: extracts ALL path-like tokens from one bullet", () => {
    expect(extractComponentsPaths(doc("## Components", "- src/a.ts and src/b.ts"))).toEqual(["src/a.ts", "src/b.ts"]);
  });
  it("bullet: recognizes * and + markers", () => {
    expect(extractComponentsPaths(doc("## Components", "* src/star.ts", "+ src/plus.ts"))).toEqual(["src/star.ts", "src/plus.ts"]);
  });
  it("bullet: recognizes a nested/indented bullet", () => {
    expect(extractComponentsPaths(doc("## Components", "    - src/deep.ts"))).toEqual(["src/deep.ts"]);
  });
  it("bullet: trims surrounding punctuation but keeps a trailing slash", () => {
    expect(extractComponentsPaths(doc("## Components", "- `src/x.ts`,", "- (src/y.ts).", "- src/core/"))).toEqual(["src/x.ts", "src/y.ts", "src/core/"]);
  });
  it("bullet: drops bare words with no slash and no .ext", () => {
    expect(extractComponentsPaths(doc("## Components", "- just prose here", "- Makefile"))).toEqual([]);
  });
  it("bullet + table mixed in one section, document order", () => {
    const d = doc("## Components", "- src/bullet.ts", "| File | x |", "| `src/table.ts` | y |");
    expect(extractComponentsPaths(d)).toEqual(["src/bullet.ts", "src/table.ts"]);
  });
  it("bullet: a horizontal rule (---) is not a bullet and yields nothing", () => {
    expect(extractComponentsPaths(doc("## Components", "---"))).toEqual([]);
  });
  it("bullet: section still ends at the next H2 (bullet after ## Architecture not harvested)", () => {
    expect(extractComponentsPaths(doc("## Components", "- src/in.ts", "## Architecture", "- src/out.ts"))).toEqual(["src/in.ts"]);
  });
  it("over-match (accepted): a referenced path in a bullet IS pulled into scope", () => {
    expect(extractComponentsPaths(doc("## Components", "- see docs/DESIGN.md for context"))).toEqual(["docs/DESIGN.md"]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- perform-scope.test.ts`
Expected: the 12 new cases FAIL (current extractor returns `[]` for every bullet input); the 9 existing table cases PASS.

- [ ] **Step 3: Implement the bullet branch**

In `src/core/performScope.ts`, add the `BULLET_ROW` const after the `TABLE_ROW`/`SEPARATOR_ROW` consts (after line 14):

```ts
const BULLET_ROW = /^[ \t]*[-*+][ \t]+/;
```

Add this helper immediately above `extractComponentsPaths` (before line 19's doc comment):

```ts
/** Extract every path-like token from a free-form bullet line: strip backticks, split on
 *  whitespace, trim surrounding punctuation (leading ([{"' ; trailing )]}"',.;:!? — a trailing
 *  "/" is deliberately KEPT so a directory component retains its dir-prefix match semantics), and
 *  keep tokens that look like a path (contain "/" OR end with ".ext"). Unlike the table branch
 *  (first cell only), bullets are unstructured prose, so all tokens are scanned. */
function pathTokensFrom(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/`/g, "").split(/\s+/)) {
    const tok = raw.replace(/^[(\[{"']+/, "").replace(/[)\]}"',.;:!?]+$/, "");
    if (tok === "") continue;
    if (HAS_SLASH.test(tok) || ENDS_WITH_EXT.test(tok)) out.push(tok);
  }
  return out;
}
```

Then add the `else if` bullet branch to the loop in `extractComponentsPaths`. The existing table `if` block ends at line 39 (`}`); change that closing brace into `} else if (...) { ... }`:

```ts
    if (inSection && TABLE_ROW.test(record)) {
      if (SEPARATOR_ROW.test(record)) continue;
      let line = record;
      line = line.replace(/^[ \t]*\|[ \t]*/, "");
      line = line.replace(/[ \t]*\|.*$/, "");
      line = line.replace(/`/g, "");
      line = line.replace(/^[ \t]+/, "");
      line = line.replace(/[ \t]+$/, "");
      if (HEADER_CELL.test(line)) continue;
      if (HAS_SLASH.test(line) || ENDS_WITH_EXT.test(line)) out.push(line);
    } else if (inSection && BULLET_ROW.test(record)) {
      out.push(...pathTokensFrom(record.replace(/^[ \t]*[-*+][ \t]+/, "")));
    }
```

Also update the function's doc comment (line 19-22) to mention the bullet branch — change "extracts the first cell of every markdown table row within it" to "extracts the first cell of every markdown table row AND every path-like token of every bullet line within it".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- perform-scope.test.ts`
Expected: PASS — all cases (9 existing table + 12 new bullet) green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (no output).

- [ ] **Step 6: Commit**

```bash
git add src/core/performScope.ts tests/perform-scope.test.ts
git commit -m "feat(perform): extract bullet-list Components paths in scope guard"
```

---

## Task 2: `SCOPE_DECLARED=` signal + empty-scope WARN

**Files:**
- Modify: `src/commands/perform.ts:311-317` (`scopeCheckWith`)
- Test: `tests/perform-scope-check.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/perform-scope-check.test.ts`, add a local stdout-capture helper just below the imports (mirrors `tests/perform-cmd.test.ts:26-35`):

```ts
async function capture(fn: () => Promise<number>): Promise<{ rc: number; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string | Uint8Array) => { out.push(String(s)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((s: string | Uint8Array) => { err.push(String(s)); return true; }) as typeof process.stderr.write;
  try { const rc = await fn(); return { rc, out: out.join(""), err: err.join("") }; }
  finally { process.stdout.write = so; process.stderr.write = se; }
}
```

Then add these two cases inside the existing `describe("perform scope-check (single-repo path locked)", ...)` block:

```ts
  it("emits SCOPE_DECLARED=<n> on stdout when the design declares component paths", async () => {
    const h = freshHome();
    const art = performArtDir("scope-decl");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "target_cwd.txt"), "/repo/main\n");
    writeFileSync(join(art, "branch-base.sha"), "BASE\n");
    writeFileSync(join(art, "design.md"), "# d\n\n## Components\n\n- `src/a.ts` — edit\n");
    const deps = { runnerFor: (_cwd: string): Runner => ({ run: (): RunResult => ({ code: 0, stdout: "src/a.ts\n" }) }) };
    const { rc, out } = await capture(() => scopeCheckWith("scope-decl", deps));
    expect(rc).toBe(0);
    expect(out).toContain("SCOPE_DECLARED=1\n");
    expect(out).toContain("OOS_COUNT=0\n");
    h.cleanup();
  });

  it("empty-scope: SCOPE_DECLARED=0 on stdout + a WARN, OOS still computed", async () => {
    const h = freshHome();
    const art = performArtDir("scope-empty");
    mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "target_cwd.txt"), "/repo/main\n");
    writeFileSync(join(art, "branch-base.sha"), "BASE\n");
    writeFileSync(join(art, "design.md"), "# d\n\n## Components\n\nprose only, no paths\n");
    const deps = { runnerFor: (_cwd: string): Runner => ({ run: (): RunResult => ({ code: 0, stdout: "src/a.ts\n" }) }) };
    const { rc, out, err } = await capture(() => scopeCheckWith("scope-empty", deps));
    expect(rc).toBe(0);
    expect(out).toContain("SCOPE_DECLARED=0\n");
    expect(out).toContain("OOS_COUNT=1\n");
    expect(err).toContain("0 parseable component paths");
    h.cleanup();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- perform-scope-check.test.ts`
Expected: the 2 new cases FAIL — `out` has no `SCOPE_DECLARED=` line yet, and `err` has no "0 parseable component paths" WARN.

- [ ] **Step 3: Implement the signal + WARN**

In `src/commands/perform.ts`, change the body of `scopeCheckWith` from line 311 onward. Current:

```ts
  const compPaths = extractComponentsPaths(readFileSync(designFile, "utf8"));
  atomicWrite(join(art, "components-paths.txt"), compPaths.length ? compPaths.join("\n") + "\n" : "");
  const oos = matchDiffAgainstComponents(diffPaths, compPaths);
  const oosPath = join(art, "scope-out-of-scope.txt");
  atomicWrite(oosPath, oos.length ? oos.join("\n") + "\n" : "");
  if (oos.length > 0) log.warn(`scope conformance: ${oos.length} out-of-scope path(s) detected`);
  process.stdout.write(`OOS_COUNT=${oos.length}\nOOS_PATH=${oosPath}\n`); return 0;
```

Replace with:

```ts
  const compPaths = extractComponentsPaths(readFileSync(designFile, "utf8"));
  atomicWrite(join(art, "components-paths.txt"), compPaths.length ? compPaths.join("\n") + "\n" : "");
  if (compPaths.length === 0) log.warn("scope conformance: design declared 0 parseable component paths; ALL changed files flagged by default (guard no-op)");
  const oos = matchDiffAgainstComponents(diffPaths, compPaths);
  const oosPath = join(art, "scope-out-of-scope.txt");
  atomicWrite(oosPath, oos.length ? oos.join("\n") + "\n" : "");
  if (oos.length > 0) log.warn(`scope conformance: ${oos.length} out-of-scope path(s) detected`);
  process.stdout.write(`SCOPE_DECLARED=${compPaths.length}\nOOS_COUNT=${oos.length}\nOOS_PATH=${oosPath}\n`); return 0;
```

(Two edits: insert the empty-scope WARN line after the `components-paths.txt` write, and prepend `SCOPE_DECLARED=${compPaths.length}\n` to the stdout line.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- perform-scope-check.test.ts`
Expected: PASS — both new cases plus the 2 pre-existing cases green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/commands/perform.ts tests/perform-scope-check.test.ts
git commit -m "feat(perform): emit SCOPE_DECLARED= signal so empty-scope is legible"
```

---

## Task 3: Directive steer in `commands/perform.md`

**Files:**
- Modify: `commands/perform.md` (Stage 4.1, ~line 200-202)

- [ ] **Step 1: Update the scope-conformance step**

Find this block in `commands/perform.md` (Stage 4 — scope check + summary + finish + teardown):

```
1. **Scope conformance.** `$CS perform scope-check <TOPIC>` (writes `scope-out-of-scope.txt`, prints
   `OOS_COUNT=`/`OOS_PATH=`). If `OOS_COUNT > 0`, read the file and **AskUserQuestion** ("Amend the
   design / Send back to the part / Force-keep"):
```

Replace it with (adds `SCOPE_DECLARED=` to the printed-keys list and a no-op steer clause):

```
1. **Scope conformance.** `$CS perform scope-check <TOPIC>` (writes `scope-out-of-scope.txt`, prints
   `SCOPE_DECLARED=`/`OOS_COUNT=`/`OOS_PATH=`). If `SCOPE_DECLARED=0`, the design declared no
   parseable component paths, so the OOS list is the entire diff — a guard **no-op**, not a real
   finding; prefer *Amend* (add a real Components table) and do NOT *Force-keep* the no-op. Otherwise,
   if `OOS_COUNT > 0`, read the file and **AskUserQuestion** ("Amend the design / Send back to the
   part / Force-keep"):
```

(The three sub-bullets — Amend / Send back / Force-keep — and the rest of Stage 4 are unchanged.)

- [ ] **Step 2: Verify the edit**

Run: `grep -n "SCOPE_DECLARED" commands/perform.md`
Expected: two matches (the printed-keys list and the no-op clause).

- [ ] **Step 3: Commit**

```bash
git add commands/perform.md
git commit -m "docs(perform): directive steers away from force-keeping a SCOPE_DECLARED=0 no-op"
```

---

## Task 4: Divergence note, version bump, dist rebuild

**Files:**
- Modify: `src/core/performScope.ts:1-8` (header comment)
- Modify: `package.json:3`, `.claude-plugin/plugin.json:3`, `.claude-plugin/marketplace.json` (version line)
- Rebuild: `dist/consort.cjs`

- [ ] **Step 1: Update the module header to record the divergence**

In `src/core/performScope.ts`, change the first comment block. Current first two lines:

```ts
// SCOPE-CONFORMANCE guard for `perform` Phase A. Byte-faithful port of the prior bash plugin's
// scope-conformance helpers (deploy-scope): deploy_extract_components_paths -> extractComponentsPaths,
```

Replace with:

```ts
// SCOPE-CONFORMANCE guard for `perform` Phase A. Port of the prior bash plugin's scope-conformance
// helpers (deploy-scope), EXTENDED in consort (deliberate divergence — see
// docs/superpowers/specs/2026-06-10-perform-scope-bullets-design.md) so extractComponentsPaths also
// reads bullet-list Components, not only table rows:
// deploy_extract_components_paths -> extractComponentsPaths,
```

(Leave the rest of the header — the `deploy_match_diff_against_components -> matchDiffAgainstComponents` line and the awk note — unchanged.)

- [ ] **Step 2: Bump the version in all three manifests**

Run:

```bash
sed -i 's/"version": "0.1.35"/"version": "0.1.36"/' package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
grep -n '"version"' package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
```

Expected: all three show `"version": "0.1.36"`.

- [ ] **Step 3: Rebuild the committed bundle**

Run: `npm run build`
Expected: `dist/consort.cjs` rebuilt (esbuild prints the bundle size, "Done").

- [ ] **Step 4: Full gate sweep**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: typecheck clean, lint clean, all tests pass (the prior 1085 + the 14 new cases from Tasks 1-2 = 1099, on a green suite). Confirm the count went UP by 14 and nothing regressed.

- [ ] **Step 5: Confirm the new behavior reached the committed bundle**

Run: `grep -c "0 parseable component paths" dist/consort.cjs`
Expected: `1` — the empty-scope WARN literal from Task 2 is present in the rebuilt bundle, proving the dist is current (a stale dist would print `0`).

- [ ] **Step 6: Commit**

```bash
git add src/core/performScope.ts package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json dist/consort.cjs
git commit -m "chore(perform): scope-check bullet support — divergence note + 0.1.36 + dist"
```

---

## Final: ship

After all four tasks are green:
- Push `fix/perform-scope-bullets`, open a PR (summary = the 3 behavior changes + "diverges from deploy_extract_components_paths per spec"; test plan = typecheck/lint/test/build), and merge per the standing autonomous PR+merge rule.
- Update the `perform-scope-check-tables-only` memory: note the fix shipped (0.1.36), bullets now parsed, `SCOPE_DECLARED=0` is the legible empty-scope signal.
