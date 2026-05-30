# consort `perform` — Phase A: core + executor modules (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task (fresh implementer per task + spec-compliance review then
> code-quality review). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the six **pure** core modules `perform` needs — the DAG executor, the scope-creep
guard, the question-claim verifier, the single-part turn machinery, the sibling cross-repo verifier,
and the core paths/parse/target-resolution — all byte-faithful ports of clone-wars `deploy`, fully
unit-tested, with **no command wiring and no dogfood** (those are Phases B–D).

**Architecture:** Each module is a self-contained `src/core/*.ts` file (one responsibility) with a
matching `tests/*.test.ts`. Side effects (git, command lookup) are injected via the existing
`Runner` interface from `gitwork.ts` so tests stay pure; the filesystem is read directly only where
`deploy` used `basename`/glob (`enumerateSiblings`). The DAG executor **extends** the existing
`src/core/dag.ts` (which already has the validator/producer). Nothing here spawns a tmux pane or
runs real git.

**Tech Stack:** TypeScript (ES2022 / NodeNext / strict), vitest, esbuild. Imports use `.js`
extensions (NodeNext). No emojis in shipped strings. `npm run typecheck` is authoritative over stale
LSP diagnostics.

**Grounding:** every module below was port-mapped byte-faithfully from clone-wars at plan time; the
code blocks are the verified reference. Cross-module integration points are confirmed against the
live tree: `extractTarget(): TargetResult` (`{present}|{present,valid}|{present,valid,slug}`),
`OutboxEvent { event: string; [k]: unknown }`, `Runner`/`RunResult` (`gitwork.ts`),
`topicDir(topic, {home?,cwd?})` (`paths.ts`), `kvParse(flag,next): {value,shift}` (`args.ts`),
`SLUG_REGEX` (`audit.ts`).

---

## Universal conventions (apply to EVERY task)

- **Byte-faithful:** preserve the clone-wars algorithm/regex/encoding exactly; the reference code
  below is the target. Do not "improve" logic, dedupe where bash didn't, or trim where bash didn't.
- **Stale-token gate:** `tests/stale-tokens.test.ts` bans the literal `clone-wars`, `cw_`,
  `master-yoda`, `MISSION ACCOMPLISHED`, `@cw_`, and case-insensitive `trooper`/`commander` in
  shipped `src`. This includes JSDoc/comments. Reference clone-wars symbols as `deploy-dag.sh:NN` /
  `deploy_<fn>` (drop the `cw_` prefix); say "the prior bash plugin" not "clone-wars"; use "part" not
  "trooper", "instrument" not "commander".
- **TDD per task:** write the test file first, run it and confirm it FAILS (module missing), then
  implement, then confirm it PASSES, then `npm run typecheck`, then commit. Do not skip the
  fail-first run.
- **Verification commands:** `npx vitest run tests/<file>.test.ts` for the focused test;
  `npm run typecheck` for the whole tree (0 errors); `npm run lint` before the final commit of the
  phase.
- **No `dist` rebuild in Phase A** — these are library modules with no dispatch entry yet. `dist` is
  rebuilt in Phase B when `commands/perform.ts` lands.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/core/dag.ts` (extend) | DAG executor: `dagTopological` / `dagUniqueRepos` / `dagFanInRepos` | 1 |
| `tests/dag-executor.test.ts` | executor tests (separate from existing `tests/dag.test.ts`) | 1 |
| `src/core/performScope.ts` | scope-creep guard: `extractComponentsPaths` / `matchDiffAgainstComponents` | 2 |
| `tests/perform-scope.test.ts` | scope tests | 2 |
| `src/core/performQuestions.ts` | claim verifier: `percentDecode` / `parseQuestionPayload` / `verifyClaim` / `formatReply` / `questionRunnerAt` | 3 |
| `tests/perform-questions.test.ts` | questions tests | 3 |
| `src/core/performTurn.ts` | turn machinery: `performState` / `composeRound1Prompt` / `composeFixPrompt` | 4 |
| `tests/perform-turn.test.ts` | turn tests | 4 |
| `src/core/performSibling.ts` | sibling verifier: enumerate / baseline / diff / revert-replay | 5 |
| `tests/perform-sibling.test.ts` | sibling tests | 5 |
| `src/core/perform.ts` | paths / parse / target-resolution / provider-detection | 6 |
| `tests/perform.test.ts` | core tests | 6 |

Tasks are independent (disjoint files; `dag.ts` is appended to). Implement them one at a time per
the subagent-driven flow (no parallel implementers — shared tree + shared typecheck).

---

### Task 1: DAG executor (extend `src/core/dag.ts`)

**Files:**
- Modify: `src/core/dag.ts` (append the three exports after `emitSoftDag`)
- Test: `tests/dag-executor.test.ts`

**Byte-faithfulness gotchas (port of `deploy-dag.sh:78-154`):**
- `dag-waves.txt` is the FROZEN 5-field TSV `<wave>\t<step>\t<repo>\t<path|none>\t<desc>`; the repo
  slug is **column 3 = `split("\t")[2]`**, not `[1]` and not the last field.
- Intra-wave order is **numeric** (`Number(a)-Number(b)`), matching `sort -n` — not JS lexical sort
  (which puts "10" before "2").
- Cycle → **return `null`** (consort's null-on-failure idiom, like `parseDagLine`), do **not** throw;
  write the exact diagnostic `dagTopological: cycle detected (no zero-indegree nodes left, k/n
  processed)` to **stderr** (prefix `dagTopological:`, the `cw_deploy_` prefix is dropped).
- `total = nodes.length` (the bash `$#`), **not** de-duped — a step passed twice surfaces as a
  spurious cycle exactly as bash arithmetic does. Do not "fix" by de-duping.
- `dagUniqueRepos` **is** de-duped + sorted (`sort -u`); `dagFanInRepos` is **not** de-duped and is in
  waves-file **row order** (one entry per qualifying row). Do not unify their semantics.
- The `!from || !to` / `!to` / `!step` guards skip empty endpoints and the trailing-newline empty
  record — load-bearing.

- [ ] **Step 1: Write the failing test** — `tests/dag-executor.test.ts`

```ts
// tests/dag-executor.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { dagTopological, dagUniqueRepos, dagFanInRepos } from "../src/core/dag.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("dagTopological", () => {
  it("single node, no edges → wave 1", () => {
    expect(dagTopological([], ["1"])).toEqual(["1\t1"]);
  });

  it("linear chain 1->2->3 → three waves", () => {
    const edges: Array<[string, string]> = [["1", "2"], ["2", "3"]];
    expect(dagTopological(edges, ["1", "2", "3"])).toEqual(["1\t1", "2\t2", "3\t3"]);
  });

  it("diamond 1->2, 1->3, 2->4, 3->4 → waves 1 / 2 (2,3) / 3 (4)", () => {
    const edges: Array<[string, string]> = [["1", "2"], ["1", "3"], ["2", "4"], ["3", "4"]];
    expect(dagTopological(edges, ["1", "2", "3", "4"])).toEqual(["1\t1", "2\t2", "2\t3", "3\t4"]);
  });

  it("intra-wave order is NUMERIC ascending, not lexical (10 after 2)", () => {
    expect(dagTopological([], ["10", "2", "1"])).toEqual(["1\t1", "1\t2", "1\t10"]);
  });

  it("node arg order does not affect numeric intra-wave sort", () => {
    expect(dagTopological([], ["3", "1", "2"])).toEqual(["1\t1", "1\t2", "1\t3"]);
  });

  it("cycle 1->2->1 → null + exact stderr diagnostic", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const edges: Array<[string, string]> = [["1", "2"], ["2", "1"]];
    expect(dagTopological(edges, ["1", "2"])).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      "dagTopological: cycle detected (no zero-indegree nodes left, 0/2 processed)\n",
    );
  });

  it("partial cycle reports k/n with k>0 (root 1 emitted, 2<->3 cycle)", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const edges: Array<[string, string]> = [["1", "2"], ["2", "3"], ["3", "2"]];
    expect(dagTopological(edges, ["1", "2", "3"])).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      "dagTopological: cycle detected (no zero-indegree nodes left, 1/3 processed)\n",
    );
  });

  it("edges with empty endpoints are ignored (byte-faithful -n guard)", () => {
    const edges: Array<[string, string]> = [["", "2"], ["1", ""]];
    expect(dagTopological(edges, ["1", "2"])).toEqual(["1\t1", "1\t2"]);
  });

  it("fan-in: 1->3, 2->3 resolves once both parents clear", () => {
    const edges: Array<[string, string]> = [["1", "3"], ["2", "3"]];
    expect(dagTopological(edges, ["1", "2", "3"])).toEqual(["1\t1", "1\t2", "2\t3"]);
  });

  it("empty nodes → empty result, no cycle, no stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(dagTopological([], [])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("dagUniqueRepos", () => {
  it("unique column-3 repos sorted ascending", () => {
    const waves = "1\t1\tweb\t/srv/web\tbuild\n1\t2\tapi\tnone\tship\n2\t3\tweb\tnone\twire\n";
    expect(dagUniqueRepos(waves)).toEqual(["api", "web"]);
  });

  it("sort is C-locale code-unit order (uppercase before lowercase)", () => {
    const waves = "1\t1\tZeta\tnone\tx\n1\t2\talpha\tnone\ty\n";
    expect(dagUniqueRepos(waves)).toEqual(["Zeta", "alpha"]);
  });

  it("trailing newline does not introduce a phantom empty repo", () => {
    const waves = "1\t1\tapi\tnone\tbuild\n";
    expect(dagUniqueRepos(waves)).toEqual(["api"]);
  });

  it("a short (<3-field) row contributes the empty string like awk $3", () => {
    const waves = "1\t1\n1\t2\tapi\tnone\tbuild\n";
    expect(dagUniqueRepos(waves)).toEqual(["", "api"]);
  });

  it("empty input → empty list", () => {
    expect(dagUniqueRepos("")).toEqual([]);
  });
});

describe("dagFanInRepos", () => {
  it("only repos whose step has >=2 incoming edges, in waves row order", () => {
    const edges = "1\t2\n1\t3\n2\t3\n";
    const waves = "1\t1\troot\tnone\ta\n1\t2\tmid\tnone\tb\n2\t3\tsink\tnone\tc\n";
    expect(dagFanInRepos(edges, waves)).toEqual(["sink"]);
  });

  it("a repo with exactly one incoming edge is excluded", () => {
    const edges = "1\t2\n";
    const waves = "1\t1\troot\tnone\ta\n2\t2\tleaf\tnone\tb\n";
    expect(dagFanInRepos(edges, waves)).toEqual([]);
  });

  it("preserves waves row order and does NOT de-dupe repeated repos", () => {
    const edges = "1\t2\n4\t2\n1\t3\n5\t3\n";
    const waves =
      "1\t1\troot\tnone\ta\n2\t2\tshared\tnone\tb\n2\t3\tshared\tnone\tc\n1\t4\tx\tnone\td\n1\t5\ty\tnone\te\n";
    expect(dagFanInRepos(edges, waves)).toEqual(["shared", "shared"]);
  });

  it("edge with empty `to` is ignored (byte-faithful -n guard)", () => {
    const edges = "1\t\n2\t3\n4\t3\n";
    const waves = "1\t1\troot\tnone\ta\n2\t3\tsink\tnone\tb\n";
    expect(dagFanInRepos(edges, waves)).toEqual(["sink"]);
  });

  it("empty waves row (trailing newline) is skipped via empty step guard", () => {
    const edges = "1\t3\n2\t3\n";
    const waves = "1\t3\tsink\tnone\tb\n";
    expect(dagFanInRepos(edges, waves)).toEqual(["sink"]);
  });

  it("step absent from edges defaults to indegree 0 (excluded)", () => {
    const edges = "1\t2\n";
    const waves = "1\t9\torphan\tnone\tz\n";
    expect(dagFanInRepos(edges, waves)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `npx vitest run tests/dag-executor.test.ts`
  Expected: fails (the three functions are not exported from `dag.ts` yet).

- [ ] **Step 3: Implement** — append to `src/core/dag.ts` (after `emitSoftDag`):

```ts
// Persistence formats (byte-identical to the prior bash plugin's deploy-dag-parse.sh):
//   dag-edges.txt  — TSV, one edge per line: `<from-step>\t<to-step>\n`
//   dag-waves.txt  — TSV, one node per line: `<wave>\t<step>\t<repo>\t<path|none>\t<desc>\n`
//                    (5-field). dagTopological emits only the leading `<wave>\t<step>` pair — the
//                    caller (the perform-init analog) joins each topo row with the parsed
//                    `<repo>\t<path>\t<desc>` for that step before writing the file atomically.
//
// In-memory contract: edges = Array<[from, to]> (step ids), nodes = string[] (all step ids).

/** Port of deploy_dag_topological (deploy-dag.sh:78-123). Kahn's topological sort over step-id
 *  nodes + `<from,to>` edges, producing `<wave>\t<step>` rows (wave 1 = zero incoming). Intra-wave
 *  order is numeric ascending (bash `sort -n`). On a cycle, writes the byte-faithful diagnostic to
 *  stderr and returns null (null-on-failure idiom; the DAG validator does NOT detect cycles). */
export function dagTopological(edges: Array<[string, string]>, nodes: string[]): string[] | null {
  const indegree = new Map<string, number | "DONE">();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n, 0);
    children.set(n, []);
  }
  for (const [from, to] of edges) {
    if (!from || !to) continue; // bash: [[ -n "$from" && -n "$to" ]] || continue
    const cur = indegree.get(to);
    indegree.set(to, (typeof cur === "number" ? cur : 0) + 1);
    const kids = children.get(from) ?? [];
    kids.push(to);
    children.set(from, kids);
  }
  const out: string[] = [];
  let wave = 1;
  let emitted = 0;
  const total = nodes.length; // bash `$#` — NOT de-duped
  while (emitted < total) {
    const currentWave: string[] = [];
    for (const [n, deg] of indegree) {
      if (deg !== 0) continue; // skip non-zero AND the "DONE" sentinel
      currentWave.push(n);
    }
    if (currentWave.length === 0) {
      process.stderr.write(
        `dagTopological: cycle detected (no zero-indegree nodes left, ${emitted}/${total} processed)\n`,
      );
      return null;
    }
    const sorted = [...currentWave].sort((a, b) => Number(a) - Number(b)); // bash `sort -n`
    for (const n of sorted) {
      out.push(`${wave}\t${n}`);
      indegree.set(n, "DONE");
      emitted += 1;
      for (const c of children.get(n) ?? []) {
        const cd = indegree.get(c);
        if (cd === undefined || cd === "DONE") continue; // bash: ${indegree[$c]:-DONE} == DONE → skip
        indegree.set(c, cd - 1);
      }
    }
    wave += 1;
  }
  return out;
}

/** Port of deploy_dag_unique_repos (deploy-dag.sh:128-132). Unique repo slugs (column 3 of
 *  dag-waves.txt `<wave>\t<step>\t<repo>\t<path>\t<desc>`), sorted ascending in code-unit order —
 *  byte-faithful to `awk -F'\t' '{print $3}' | sort -u`. */
export function dagUniqueRepos(wavesText: string): string[] {
  const lines = wavesText.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop(); // drop trailing-newline empty record
  const seen = new Set<string>();
  for (const line of lines) {
    seen.add(line.split("\t")[2] ?? "");
  }
  return [...seen].sort();
}

/** Port of deploy_dag_fan_in_repos (deploy-dag.sh:139-154). Repo slugs whose step id has >=2
 *  incoming edges, in dag-waves.txt row order (NOT sorted, NOT de-duped). `edgesText` =
 *  dag-edges.txt; `wavesText` = dag-waves.txt. */
export function dagFanInRepos(edgesText: string, wavesText: string): string[] {
  const indegree = new Map<string, number>();
  for (const line of edgesText.split("\n")) {
    if (line === "") continue;
    const [, to] = line.split("\t");
    if (!to) continue; // bash: [[ -n "$to" ]] || continue
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const line of wavesText.split("\n")) {
    const cols = line.split("\t");
    const step = cols[1];
    const repo = cols[2];
    if (!step) continue; // bash: [[ -n "$step" ]] || continue (also skips trailing empty line)
    if ((indegree.get(step) ?? 0) >= 2) out.push(repo ?? "");
  }
  return out;
}
```

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run tests/dag-executor.test.ts` (PASS) and
  `npm run typecheck` (0 errors).

- [ ] **Step 5: Commit** — `git add src/core/dag.ts tests/dag-executor.test.ts && git commit -m "feat(perform): DAG executor (topological waves, unique-repos, fan-in)"`

---

### Task 2: Scope-creep guard (`src/core/performScope.ts`)

**Files:**
- Create: `src/core/performScope.ts`
- Test: `tests/perform-scope.test.ts`

**Gotchas (port of `deploy-scope.sh:26-110`):**
- Section opener is the EXACT `/^## Components[ \t]*$/`; ender is `/^## [^ ]/ && !/^## Components/`. A
  heading like `## Components (extra)` is neither opener nor ender → it silently opens nothing.
- `awk index(path, c "/")==1` means "path starts with `c/`" → ports to `path.indexOf(c + "/") === 0`
  (NOT `startsWith(c)` — `src/core` must not swallow `src/coreutils.ts`). `index()==1` is 1-indexed
  "starts-with" → JS `indexOf(...) === 0`.
- Trailing-slash comp (`src/core/`) matches `path.indexOf(c) === 0`; no-slash comp uses `c + "/"`.
- Header-cell skip regex is anchored to the whole trimmed cell.
- Import `SLUG_REGEX` from `./audit.js` and keep it live via `void SLUG_REGEX` (parity reference; the
  algorithm does not validate against it, matching the bash awk).

- [ ] **Step 1: Write the failing test** — `tests/perform-scope.test.ts`

```ts
// tests/perform-scope.test.ts
import { describe, it, expect } from "vitest";
import { extractComponentsPaths, matchDiffAgainstComponents } from "../src/core/performScope.js";

function doc(...lines: string[]): string {
  return lines.join("\n") + "\n";
}

describe("extractComponentsPaths", () => {
  it("extracts first-cell paths from the Components table, stripping backticks", () => {
    const d = doc(
      "# Title",
      "## Goal",
      "do a thing",
      "## Components",
      "| File | Change |",
      "| ---- | ------ |",
      "| `src/core/foo.ts` | new |",
      "| `src/core/bar.ts` | edit |",
      "## Testing",
      "| `tests/should-not-appear.ts` | n/a |",
    );
    expect(extractComponentsPaths(d)).toEqual(["src/core/foo.ts", "src/core/bar.ts"]);
  });

  it("returns [] when there is no Components section", () => {
    expect(extractComponentsPaths(doc("# T", "## Goal", "g", "## Testing", "t"))).toEqual([]);
  });

  it("returns [] when Components has no table", () => {
    expect(extractComponentsPaths(doc("## Components", "prose only, no table", "more prose"))).toEqual([]);
  });

  it("skips the separator row (only |, -, :, spaces)", () => {
    const d = doc("## Components", "| File |", "| :--- |", "| src/a.ts |");
    expect(extractComponentsPaths(d)).toEqual(["src/a.ts"]);
  });

  it("skips header-cell rows: File / Path / Name / Files edited|moved|touched", () => {
    const d = doc(
      "## Components",
      "| File |", "| Path |", "| Name |", "| Files edited |", "| File moved |", "| Files touched |",
      "| src/keep.ts |",
    );
    expect(extractComponentsPaths(d)).toEqual(["src/keep.ts"]);
  });

  it("path heuristic: keeps cells with a slash OR a .ext; drops bare words", () => {
    const d = doc(
      "## Components",
      "| plainword | x |",
      "| README.md | x |",
      "| some/dir/ | x |",
      "| Makefile | x |",
    );
    expect(extractComponentsPaths(d)).toEqual(["README.md", "some/dir/"]);
  });

  it("section ends at the next H2 heading (## something-else)", () => {
    const d = doc("## Components", "| src/in.ts | x |", "## Architecture", "| src/out.ts | x |");
    expect(extractComponentsPaths(d)).toEqual(["src/in.ts"]);
  });

  it("tolerates leading whitespace and a trailing pipe; trims the cell", () => {
    const d = doc("## Components", "   |  src/spaced.ts  |  notes  |");
    expect(extractComponentsPaths(d)).toEqual(["src/spaced.ts"]);
  });

  it("a Components heading with trailing whitespace still opens the section", () => {
    const d = doc("## Components   ", "| src/a.ts | x |");
    expect(extractComponentsPaths(d)).toEqual(["src/a.ts"]);
  });

  it("a non-exact Components heading (## Components (extra)) does NOT open the section", () => {
    const d = doc("## Components (extra)", "| src/a.ts | x |");
    expect(extractComponentsPaths(d)).toEqual([]);
  });
});

describe("matchDiffAgainstComponents", () => {
  it("empty output when every diff path matches a comp path exactly", () => {
    expect(matchDiffAgainstComponents(["src/a.ts", "src/b.ts"], ["src/a.ts", "src/b.ts"])).toEqual([]);
  });

  it("flags diff paths not covered by any comp path", () => {
    expect(matchDiffAgainstComponents(["src/a.ts", "src/rogue.ts"], ["src/a.ts"])).toEqual(["src/rogue.ts"]);
  });

  it("explicit dir comp (trailing slash) covers anything beneath it", () => {
    expect(matchDiffAgainstComponents(["src/core/deep/x.ts"], ["src/core/"])).toEqual([]);
  });

  it("implicit dir comp (no trailing slash) covers descendants via comp + '/'", () => {
    expect(matchDiffAgainstComponents(["src/core/x.ts"], ["src/core"])).toEqual([]);
  });

  it("implicit dir comp does NOT cover a sibling sharing the prefix without a slash boundary", () => {
    expect(matchDiffAgainstComponents(["src/coreutils.ts"], ["src/core"])).toEqual(["src/coreutils.ts"]);
  });

  it("trims whitespace and drops empty lines in both inputs", () => {
    expect(matchDiffAgainstComponents(["  src/a.ts  ", "", "   "], ["  src/a.ts  ", ""])).toEqual([]);
  });

  it("explicit dir prefix only matches when diff starts with the full trailing-slash path", () => {
    expect(matchDiffAgainstComponents(["src/coreother/x.ts"], ["src/core/"])).toEqual(["src/coreother/x.ts"]);
  });

  it("returns the out-of-scope paths in diff order", () => {
    const diff = ["src/a.ts", "x/z.ts", "src/b.ts", "y/w.ts"];
    const comp = ["src/a.ts", "src/b.ts"];
    expect(matchDiffAgainstComponents(diff, comp)).toEqual(["x/z.ts", "y/w.ts"]);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `npx vitest run tests/perform-scope.test.ts`

- [ ] **Step 3: Implement** — `src/core/performScope.ts`:

```ts
// src/core/performScope.ts
//
// SCOPE-CONFORMANCE guard for `perform` Phase A. Byte-faithful port of the prior bash plugin's
// scope-conformance helpers (deploy-scope): deploy_extract_components_paths -> extractComponentsPaths,
// deploy_match_diff_against_components -> matchDiffAgainstComponents. The Bash helpers read files via
// awk; the TS ports take the already-read strings (file IO is the caller's concern), but the
// extraction algorithm — section bounds, separator-row skip, first-cell parse, header skip, path
// heuristic, and the exact/dir-prefix match rules — is preserved exactly.

import { SLUG_REGEX } from "./audit.js";

// SLUG_REGEX is shared with the doc auditor (the bash sourced both helpers from the same library).
// Referenced here to keep the import live; the scope algorithm itself does not validate against it.
void SLUG_REGEX;

const COMPONENTS_HEADER = /^## Components[ \t]*$/;
const OTHER_H2 = /^## [^ ]/;
const ANY_COMPONENTS_PREFIX = /^## Components/;
const TABLE_ROW = /^[ \t]*\|/;
const SEPARATOR_ROW = /^[ \t]*\|([ \t]*[:-]+[ \t]*\|)+[ \t]*$/;
const HEADER_CELL = /^(File|Path|Name|Files?[ \t]+(edited|moved|touched))$/;
const HAS_SLASH = /\//;
const ENDS_WITH_EXT = /\.[a-zA-Z]+$/;

/** Port of deploy_extract_components_paths (deploy-scope:26-55). Locates the `## Components` section
 *  and extracts the first cell of every markdown table row within it (backticks stripped, trimmed),
 *  skipping the separator row, header rows, and any cell that does not look like a path (contains
 *  `/` OR ends with `.ext`). Returns [] when no section / no table / no path-like cell. */
export function extractComponentsPaths(docText: string): string[] {
  const out: string[] = [];
  let inSection = false;
  for (const record of docText.split("\n")) {
    if (COMPONENTS_HEADER.test(record)) {
      inSection = true;
      continue;
    }
    if (OTHER_H2.test(record) && !ANY_COMPONENTS_PREFIX.test(record)) {
      inSection = false;
      continue;
    }
    if (inSection && TABLE_ROW.test(record)) {
      if (SEPARATOR_ROW.test(record)) continue;
      let line = record;
      line = line.replace(/^[ \t]*\|[ \t]*/, "");
      line = line.replace(/[ \t]*\|.*$/, "");
      line = line.replace(/`/g, "");
      line = line.replace(/^[ \t]+/, "");
      line = line.replace(/[ \t]+$/, "");
      if (HEADER_CELL.test(line)) continue;
      if (HAS_SLASH.test(line) || ENDS_WITH_EXT.test(line)) {
        out.push(line);
      }
    }
  }
  return out;
}

/** Port of deploy_match_diff_against_components (deploy-scope:75-110). Returns the subset of
 *  `diffPaths` that are OUT of scope per `compPaths`. In-scope iff some comp path: (1) equals the
 *  diff path; (2) ends with "/" and the diff path starts with it; (3) does NOT end with "/" and the
 *  diff path starts with comp + "/". Both inputs are trimmed and empties dropped. */
export function matchDiffAgainstComponents(diffPaths: string[], compPaths: string[]): string[] {
  const comp: string[] = [];
  for (const raw of compPaths) {
    const line = raw.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
    if (line === "") continue;
    comp.push(line);
  }
  const out: string[] = [];
  for (const raw of diffPaths) {
    const path = raw.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
    if (path === "") continue;
    let inScope = false;
    for (const c of comp) {
      if (path === c) { inScope = true; break; }
      if (c.charAt(c.length - 1) === "/" && path.indexOf(c) === 0) { inScope = true; break; }
      if (c.charAt(c.length - 1) !== "/" && path.indexOf(c + "/") === 0) { inScope = true; break; }
    }
    if (!inScope) out.push(path);
  }
  return out;
}
```

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run tests/perform-scope.test.ts` (PASS),
  `npm run typecheck` (0).

- [ ] **Step 5: Commit** — `git add src/core/performScope.ts tests/perform-scope.test.ts && git commit -m "feat(perform): scope-conformance guard (components-path extraction + diff match)"`

---

### Task 3: Question-claim verifier (`src/core/performQuestions.ts`)

**Files:**
- Create: `src/core/performQuestions.ts`
- Test: `tests/perform-questions.test.ts`

**Gotchas (port of deploy-questions + the part-question verify/reply lib):**
- Percent-decode ORDER: `%0A %09 %22 %5C %2C` then **`%25` LAST** (literal percent), via
  `split().join()` so `%2522` → `%22` round-trips. Decoding `%25` first corrupts nested encodings.
- Payload value split on the **FIRST** `=` only (so `CLAIM_VALUE=A=B=C` survives).
- `verifyClaim` NEVER throws. `rc=2` (unverifiable) is reserved for: empty kind|value, unknown kind,
  banned test command, and **test exit 124 (timeout)** — NOT ordinary failure (that is `rc=1`).
- env: set-but-empty is `rc=1` (`val !== undefined && val !== ""`).
- Banned-suite guard (`tests/run.sh` / `bash tests/run.sh`) returns `rc=2` **before** invoking the
  runner (assert 0 calls).
- `path` evidence is the one deliberate non-byte-faithful spot (a `stat`-derived `<d|-> <size>
  <path>` stand-in instead of raw `ls -ld`); rc semantics ARE byte-faithful, tests assert evidence
  *contains* the path.
- Reply header is rebranded `From: maestro`; the `kind=test` NOTE block uses a literal em-dash
  (U+2014) — preserve it. git/cmd/test shell through the injected `QuestionRunner` (copy the
  `Runner`/`RunResult` shape; name it `QuestionRunner`/`RunResult` locally — do NOT import a clashing
  re-export).

- [ ] **Step 1: Write the failing test** — `tests/perform-questions.test.ts`

```ts
// tests/perform-questions.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  percentDecode,
  parseQuestionPayload,
  verifyClaim,
  formatReply,
} from "../src/core/performQuestions.js";
import type { QuestionRunner, RunResult } from "../src/core/performQuestions.js";

function fakeRunner(replies: Record<string, RunResult>) {
  const calls: string[][] = [];
  const r: QuestionRunner = {
    run(cmd, args) { calls.push([cmd, ...args]); return replies[[cmd, ...args].join(" ")] ?? { code: 0, stdout: "" }; },
  };
  return { r, calls };
}

describe("percentDecode", () => {
  it("decodes the 6 escapes", () => {
    expect(percentDecode("a%0Ab")).toBe("a\nb");
    expect(percentDecode("a%09b")).toBe("a\tb");
    expect(percentDecode("say %22hi%22")).toBe('say "hi"');
    expect(percentDecode("path%5Cto")).toBe("path\\to");
    expect(percentDecode("a%2Cb")).toBe("a,b");
    expect(percentDecode("100%25")).toBe("100%");
  });
  it("decodes %25 LAST so nested encodings round-trip", () => {
    expect(percentDecode("%2522")).toBe("%22");
    expect(percentDecode("%250A")).toBe("%0A");
  });
  it("leaves unrelated text untouched", () => {
    expect(percentDecode("hello world")).toBe("hello world");
    expect(percentDecode("")).toBe("");
  });
});

describe("parseQuestionPayload", () => {
  it("verify route: claim present, TEXT percent-decoded", () => {
    const body = "TEXT=line1%0Aline2\nCLAIM_KIND=path\nCLAIM_VALUE=src/a.ts\nROUTE=verify\nASKED_AT=123\n";
    expect(parseQuestionPayload(body)).toEqual({
      text: "line1\nline2", claimKind: "path", claimValue: "src/a.ts", route: "verify",
    });
  });
  it("escalate route: no claim -> kind/value empty, route escalate", () => {
    const body = "TEXT=need%20help\nCLAIM_KIND=\nCLAIM_VALUE=\nROUTE=escalate\nASKED_AT=9\n";
    expect(parseQuestionPayload(body)).toEqual({
      text: "need%20help", claimKind: "", claimValue: "", route: "escalate",
    });
  });
  it("unknown CLAIM_KIND normalizes to empty", () => {
    expect(parseQuestionPayload("TEXT=x\nCLAIM_KIND=bogus\nCLAIM_VALUE=v\nROUTE=verify\n").claimKind).toBe("");
  });
  it("missing ROUTE defaults to escalate; missing TEXT -> empty", () => {
    expect(parseQuestionPayload("CLAIM_KIND=git\nCLAIM_VALUE=HEAD\n").route).toBe("escalate");
    expect(parseQuestionPayload("CLAIM_KIND=git\n").text).toBe("");
  });
  it("CLAIM_VALUE may contain '=' (split on FIRST '=' only)", () => {
    expect(parseQuestionPayload("TEXT=t\nCLAIM_KIND=env\nCLAIM_VALUE=A=B=C\nROUTE=verify\n").claimValue).toBe("A=B=C");
  });
  it("all five known kinds pass through", () => {
    for (const k of ["path", "git", "env", "cmd", "test"]) {
      expect(parseQuestionPayload(`TEXT=x\nCLAIM_KIND=${k}\nCLAIM_VALUE=v\nROUTE=verify\n`).claimKind).toBe(k);
    }
  });
});

describe("verifyClaim — empty/unknown", () => {
  it("empty kind -> rc 2", () => { expect(verifyClaim("", "v").rc).toBe(2); });
  it("empty value -> rc 2", () => { expect(verifyClaim("path", "").rc).toBe(2); });
  it("unknown kind -> rc 2", () => { expect(verifyClaim("bogus", "v").rc).toBe(2); });
});

describe("verifyClaim — path", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pq-path-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  it("existing readable file -> rc 0 with evidence", () => {
    const f = join(dir, "f.txt"); writeFileSync(f, "hi");
    const res = verifyClaim("path", f);
    expect(res.rc).toBe(0); expect(res.evidence).toContain(f);
  });
  it("existing directory -> rc 0", () => {
    const sub = join(dir, "sub"); mkdirSync(sub);
    expect(verifyClaim("path", sub).rc).toBe(0);
  });
  it("missing path -> rc 1", () => {
    expect(verifyClaim("path", join(dir, "nope")).rc).toBe(1);
    expect(verifyClaim("path", join(dir, "nope")).evidence).toBe("");
  });
});

describe("verifyClaim — git (injected runner)", () => {
  it("resolvable ref -> rc 0 with sha evidence (trailing newline stripped)", () => {
    const { r, calls } = fakeRunner({ "git rev-parse --verify HEAD": { code: 0, stdout: "deadbeef\n" } });
    expect(verifyClaim("git", "HEAD", r)).toEqual({ rc: 0, evidence: "deadbeef" });
    expect(calls[0]).toEqual(["git", "rev-parse", "--verify", "HEAD"]);
  });
  it("unknown ref -> rc 1", () => {
    const { r } = fakeRunner({ "git rev-parse --verify nope": { code: 128, stdout: "" } });
    expect(verifyClaim("git", "nope", r)).toEqual({ rc: 1, evidence: "" });
  });
  it("no runner -> rc 1 (cannot resolve)", () => { expect(verifyClaim("git", "HEAD").rc).toBe(1); });
});

describe("verifyClaim — env", () => {
  const KEY = "PQ_TEST_VAR_XYZ";
  afterEach(() => { delete process.env[KEY]; });
  it("set non-empty -> rc 0, evidence is the value", () => {
    process.env[KEY] = "thevalue";
    expect(verifyClaim("env", KEY)).toEqual({ rc: 0, evidence: "thevalue" });
  });
  it("unset -> rc 1", () => {
    delete process.env[KEY];
    expect(verifyClaim("env", KEY)).toEqual({ rc: 1, evidence: "" });
  });
  it("set but empty string -> rc 1 (matches bash non-empty test)", () => {
    process.env[KEY] = "";
    expect(verifyClaim("env", KEY)).toEqual({ rc: 1, evidence: "" });
  });
});

describe("verifyClaim — cmd (injected runner)", () => {
  it("command present -> rc 0 with path evidence", () => {
    const { r, calls } = fakeRunner({ "command -v -- git": { code: 0, stdout: "/usr/bin/git\n" } });
    expect(verifyClaim("cmd", "git", r)).toEqual({ rc: 0, evidence: "/usr/bin/git" });
    expect(calls[0]).toEqual(["command", "-v", "--", "git"]);
  });
  it("command absent -> rc 1", () => {
    const { r } = fakeRunner({ "command -v -- nope": { code: 1, stdout: "" } });
    expect(verifyClaim("cmd", "nope", r)).toEqual({ rc: 1, evidence: "" });
  });
  it("no runner -> rc 1", () => { expect(verifyClaim("cmd", "git").rc).toBe(1); });
});

describe("verifyClaim — test (injected runner)", () => {
  it("exit 0 -> rc 0 with captured output", () => {
    const { r, calls } = fakeRunner({ "timeout 30 bash -c -- echo ok": { code: 0, stdout: "ok\n" } });
    expect(verifyClaim("test", "echo ok", r)).toEqual({ rc: 0, evidence: "ok" });
    expect(calls[0]).toEqual(["timeout", "30", "bash", "-c", "--", "echo ok"]);
  });
  it("non-zero exit -> rc 1 with output", () => {
    const { r } = fakeRunner({ "timeout 30 bash -c -- false": { code: 1, stdout: "boom\n" } });
    expect(verifyClaim("test", "false", r)).toEqual({ rc: 1, evidence: "boom" });
  });
  it("timeout (exit 124) -> rc 2 unverifiable, not refuted", () => {
    const { r } = fakeRunner({ "timeout 30 bash -c -- sleep 99": { code: 124, stdout: "" } });
    expect(verifyClaim("test", "sleep 99", r).rc).toBe(2);
  });
  it("banned suite command -> rc 2 without running", () => {
    const { r, calls } = fakeRunner({});
    expect(verifyClaim("test", "tests/run.sh", r).rc).toBe(2);
    expect(verifyClaim("test", "bash tests/run.sh --x", r).rc).toBe(2);
    expect(calls.length).toBe(0);
  });
  it("no runner -> rc 2 unverifiable", () => { expect(verifyClaim("test", "echo ok").rc).toBe(2); });
});

describe("formatReply", () => {
  it("rc 0 -> FOUND verdict, ends with Resume directive", () => {
    expect(formatReply("path", "src/a.ts", 0, "- 12 src/a.ts")).toBe(
      "From: maestro\n\nVerdict: FOUND\nClaim kind: path\nClaim value: src/a.ts\n\n" +
      "Evidence:\n- 12 src/a.ts\n\nResume implementation.\n",
    );
  });
  it("rc 1 -> NOT FOUND", () => { expect(formatReply("git", "HEAD", 1, "")).toContain("Verdict: NOT FOUND"); });
  it("rc 2 -> UNVERIFIABLE", () => { expect(formatReply("cmd", "foo", 2, "")).toContain("Verdict: UNVERIFIABLE"); });
  it("kind=test inserts the NOTE block before resume", () => {
    const body = formatReply("test", "echo ok", 0, "ok");
    expect(body).toBe(
      "From: maestro\n\nVerdict: FOUND\nClaim kind: test\nClaim value: echo ok\n\n" +
      "Evidence:\nok\n\n" +
      "NOTE: kind=test was a diagnostic check only — running your full test\n" +
      "suite is your job, not mine. Use this protocol for short verification\n" +
      "queries, not for offloading work.\n\nResume implementation.\n",
    );
  });
  it("non-test kind has no NOTE block", () => {
    expect(formatReply("env", "HOME", 0, "/home/x")).not.toContain("NOTE: kind=test");
  });
  it("uses the rebranded From: maestro sender", () => {
    expect(formatReply("path", "v", 0, "e")).toContain("From: maestro");
  });
});

describe("round-trip: parse then verify then reply", () => {
  it("env claim payload -> FOUND reply", () => {
    process.env.PQ_RT = "yes";
    const body = "TEXT=is%20HOME%20set%3F\nCLAIM_KIND=env\nCLAIM_VALUE=PQ_RT\nROUTE=verify\n";
    const p = parseQuestionPayload(body);
    expect(p.route).toBe("verify");
    const v = verifyClaim(p.claimKind, p.claimValue);
    const reply = formatReply(p.claimKind, p.claimValue, v.rc, v.evidence);
    expect(reply).toContain("Verdict: FOUND");
    expect(reply).toContain("Evidence:\nyes");
    delete process.env.PQ_RT;
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `npx vitest run tests/perform-questions.test.ts`

- [ ] **Step 3: Implement** — `src/core/performQuestions.ts`:

```ts
// src/core/performQuestions.ts — perform-side QUESTION-CLAIM verifier (Phase A).
// Byte-faithful port of the prior bash plugin's deploy-questions lib (question payload extractor)
// + the part-question lib (claim verify dispatcher + reply formatter), rebranded for consort.
// Side effects (git ref resolution, command lookup, diagnostic test runs) shell through an injected
// Runner so unit tests stay pure. Filesystem (path) + environment (env) checks read ambient state.
import { existsSync, accessSync, constants, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

export interface RunResult { code: number; stdout: string; }
export interface QuestionRunner { run(cmd: string, args: string[]): RunResult; }

/** Percent-decode the 6 escapes (TEXT field). %0A->nl, %09->tab, %22->", %5C->\, %2C->comma,
 *  %25->%. Order matters: %25 is decoded LAST so nested encodings like %2522 round-trip. */
export function percentDecode(s: string): string {
  let out = s;
  out = out.split("%0A").join("\n");
  out = out.split("%09").join("\t");
  out = out.split("%22").join('"');
  out = out.split("%5C").join("\\");
  out = out.split("%2C").join(",");
  out = out.split("%25").join("%"); // literal-percent escape — must be LAST
  return out;
}

export type ClaimKind = "path" | "git" | "env" | "cmd" | "test" | "";
export type ClaimRoute = "verify" | "escalate";

export interface QuestionPayload {
  text: string;
  claimKind: ClaimKind;
  claimValue: string;
  route: ClaimRoute;
}

const KNOWN_KINDS = new Set<ClaimKind>(["path", "git", "env", "cmd", "test"]);

/** Parse a question-<part>-<round>.txt payload body. KEY=value lines: TEXT (percent-encoded),
 *  CLAIM_KIND, CLAIM_VALUE, ROUTE. Value = everything after the FIRST '=' on the first matching
 *  line. ROUTE defaults to escalate; CLAIM_KIND/VALUE default to "" when absent. */
export function parseQuestionPayload(body: string): QuestionPayload {
  const first = (key: string): string | null => {
    for (const line of body.split("\n")) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      if (line.slice(0, eq) === key) return line.slice(eq + 1);
    }
    return null;
  };
  const rawText = first("TEXT");
  const text = rawText === null ? "" : percentDecode(rawText);
  const rawKind = first("CLAIM_KIND") ?? "";
  const claimKind: ClaimKind = KNOWN_KINDS.has(rawKind as ClaimKind) ? (rawKind as ClaimKind) : "";
  const claimValue = first("CLAIM_VALUE") ?? "";
  const route: ClaimRoute = (first("ROUTE") ?? "escalate") === "verify" ? "verify" : "escalate";
  return { text, claimKind, claimValue, route };
}

export interface VerifyResult {
  rc: 0 | 1 | 2; // 0 = confirmed, 1 = refuted, 2 = unverifiable
  evidence: string;
}

/** A cwd-bound synchronous runner for git/cmd/test claims. execFileSync — never a shell for git/cmd
 *  (argv array); kind=test routes through `bash -c` to match the prior plugin's `timeout 30 bash`. */
export function questionRunnerAt(cwd: string): QuestionRunner {
  return {
    run(cmd, args) {
      try {
        const stdout = execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return { code: 0, stdout };
      } catch (e: unknown) {
        const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
        const out = (err.stdout != null ? String(err.stdout) : "") + (err.stderr != null ? String(err.stderr) : "");
        return { code: typeof err.status === "number" ? err.status : 1, stdout: out };
      }
    },
  };
}

/** Strip a single trailing newline, matching bash `$(...)` capture (which trims) + printf '%s\n'. */
function trimTrailingNewline(s: string): string {
  return s.replace(/\n+$/, "");
}

/** Verify a claim of `kind` carrying `value`. rc=0 confirmed / rc=1 refuted / rc=2 unverifiable
 *  (empty kind|value, unknown kind, banned test command, test timeout=exit 124). Never throws. */
export function verifyClaim(kind: string, value: string, runner?: QuestionRunner): VerifyResult {
  if (!kind || !value) return { rc: 2, evidence: "" };
  switch (kind) {
    case "path": {
      try {
        if (existsSync(value)) {
          accessSync(value, constants.R_OK);
          let detail = value;
          try {
            const st = statSync(value);
            detail = `${st.isDirectory() ? "d" : "-"} ${st.size} ${value}`;
          } catch { /* keep bare value */ }
          return { rc: 0, evidence: detail };
        }
      } catch { /* not readable -> refuted */ }
      return { rc: 1, evidence: "" };
    }
    case "git": {
      if (!runner) return { rc: 1, evidence: "" };
      const r = runner.run("git", ["rev-parse", "--verify", value]);
      if (r.code === 0) return { rc: 0, evidence: trimTrailingNewline(r.stdout) };
      return { rc: 1, evidence: "" };
    }
    case "env": {
      const val = process.env[value];
      if (val !== undefined && val !== "") return { rc: 0, evidence: val };
      return { rc: 1, evidence: "" };
    }
    case "cmd": {
      if (!runner) return { rc: 1, evidence: "" };
      const r = runner.run("command", ["-v", "--", value]);
      if (r.code === 0) return { rc: 0, evidence: trimTrailingNewline(r.stdout) };
      return { rc: 1, evidence: "" };
    }
    case "test": {
      if (value.startsWith("tests/run.sh") || value.startsWith("bash tests/run.sh")) {
        return { rc: 2, evidence: "" };
      }
      if (!runner) return { rc: 2, evidence: "" };
      const r = runner.run("timeout", ["30", "bash", "-c", "--", value]);
      const evidence = trimTrailingNewline(r.stdout);
      if (r.code === 124) return { rc: 2, evidence }; // 124 = timeout fired -> unverifiable
      if (r.code === 0) return { rc: 0, evidence };
      return { rc: 1, evidence };
    }
    default:
      return { rc: 2, evidence: "" };
  }
}

/** Format the inbox.md reply body for the part (rebranded From: maestro). Begins with FOUND /
 *  NOT FOUND / UNVERIFIABLE and ends with "Resume implementation.\n". kind=test inserts a NOTE. */
export function formatReply(kind: string, value: string, rc: number, evidence: string): string {
  const verdict = rc === 0 ? "FOUND" : rc === 1 ? "NOT FOUND" : "UNVERIFIABLE";
  let body =
    `From: maestro\n\n` +
    `Verdict: ${verdict}\n` +
    `Claim kind: ${kind}\n` +
    `Claim value: ${value}\n\n` +
    `Evidence:\n` +
    `${evidence}\n\n`;
  if (kind === "test") {
    body +=
      `NOTE: kind=test was a diagnostic check only — running your full test\n` +
      `suite is your job, not mine. Use this protocol for short verification\n` +
      `queries, not for offloading work.\n\n`;
  }
  body += `Resume implementation.\n`;
  return body;
}
```

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run tests/perform-questions.test.ts` (PASS),
  `npm run typecheck` (0).

- [ ] **Step 5: Commit** — `git add src/core/performQuestions.ts tests/perform-questions.test.ts && git commit -m "feat(perform): question-claim verifier (percent-decode, verify, reply)"`

---

### Task 4: Single-part turn machinery (`src/core/performTurn.ts`)

**Files:**
- Create: `src/core/performTurn.ts`
- Test: `tests/perform-turn.test.ts`

**Gotchas (port of deploy-turn-wait + deploy_build_turn_prompt_round1/_fix):**
- `performState` is a pure event→state classifier (mirrors `scoreTurn.verifyState`'s shape): `null`
  (timeout) → `"timeout"`; `question` → `"question"`; `done` → `"ok"` **iff** `verifyText` non-null
  AND non-empty (the bash `[[ -f && -s ]]` test) else `"failed"`; `error`/unknown → `"failed"`. Use
  `"failed"` (deploy semantics), NOT `verifyState`'s `"missing"` label.
- Prompt composers **OMIT** `END_OF_INSTRUCTION` and the `{"event":"done"}` line — `inboxWrite()`
  appends the canonical fence. (Tests assert `.not.toContain`.)
- Preserve the literal em-dash (U+2014) where the bash heredoc has it.
- Rebrand: `bin/trooper-ask.sh` → `bin/part-ask.sh` (the `trooper` substring is banned); `cody` is the
  literal codex part HANDLE (kept verbatim, not the banned noun); `/clone-wars:deploy` →
  `/consort:perform`.
- `bundleText` is embedded **verbatim** (NOT trimmed — the bash `cat`s it raw).
- These names (`composeRound1Prompt`/`composeFixPrompt`) intentionally shadow `turn.ts`'s; they are a
  distinct module — import from `./performTurn.js`.

- [ ] **Step 1: Write the failing test** — `tests/perform-turn.test.ts`

```ts
// tests/perform-turn.test.ts
import { describe, it, expect } from "vitest";
import { performState, composeRound1Prompt, composeFixPrompt } from "../src/core/performTurn.js";

describe("performState", () => {
  it("null event (no terminal before timeout) -> timeout", () => {
    expect(performState(null, "VERDICT: PASS\n")).toBe("timeout");
    expect(performState(null, null)).toBe("timeout");
  });
  it("question event -> question (verify text ignored)", () => {
    expect(performState({ event: "question", message: "?" }, null)).toBe("question");
    expect(performState({ event: "question", message: "?" }, "VERDICT: PASS\n")).toBe("question");
  });
  it("done event -> ok iff verify-report present AND non-empty (the -f && -s test), else failed", () => {
    expect(performState({ event: "done", summary: "Round 1 complete" }, "VERDICT: PASS\n")).toBe("ok");
    expect(performState({ event: "done", summary: "Round 1 complete" }, "")).toBe("failed");
    expect(performState({ event: "done", summary: "Round 1 complete" }, null)).toBe("failed");
  });
  it("error event -> failed; unknown event -> failed (the * catch-all)", () => {
    expect(performState({ event: "error", reason: "boom" }, "VERDICT: PASS\n")).toBe("failed");
    expect(performState({ event: "weird" }, "VERDICT: PASS\n")).toBe("failed");
  });
});

describe("composeRound1Prompt", () => {
  const p = composeRound1Prompt({
    designPath: "/state/topic/_perform/design.md",
    planPath: "/state/topic/_perform/plan.md",
    verifyPath: "/state/topic/_perform/verify-report-1.md",
  });
  it("names ROUND 1, the three phases, and the design/plan/verify paths", () => {
    expect(p).toContain("ROUND 1 of /consort:perform");
    expect(p).toContain("PHASE 1: Plan");
    expect(p).toContain("PHASE 2: Implement");
    expect(p).toContain("PHASE 3: Self-verify");
    expect(p).toContain("/state/topic/_perform/design.md");
    expect(p).toContain("/state/topic/_perform/plan.md");
    expect(p).toContain("/state/topic/_perform/verify-report-1.md");
  });
  it("requires the VERDICT line and tees the per-round test-output log into the verify dir", () => {
    expect(p).toContain("VERDICT: PASS|PARTIAL|FAIL");
    expect(p).toContain("/state/topic/_perform/test-output-1.log");
  });
  it("is branch-disciplined and documents the halt-and-ask question protocol", () => {
    expect(p).toMatch(/do NOT run 'git checkout', 'git switch'/i);
    expect(p).toContain('"event":"error","reason":"branch-discipline');
    expect(p).toContain("part-ask.sh");
  });
  it("carries NO canonical fence and NO done-event line (inboxWrite appends them)", () => {
    expect(p).not.toContain("END_OF_INSTRUCTION");
    expect(p).not.toContain('"event":"done"');
  });
  it("carries no stale rebrand tokens", () => {
    expect(p).not.toMatch(/clone-wars/);
    expect(p).not.toMatch(/cw_/);
    expect(p).not.toMatch(/master[ -]?yoda/i);
    expect(p).not.toMatch(/trooper|commander/i);
  });
  it("honors a custom round number in the test-output log name", () => {
    const r3 = composeRound1Prompt({ designPath: "/d", planPath: "/p", verifyPath: "/v/verify-report-3.md", round: 3 });
    expect(r3).toContain("ROUND 3 of /consort:perform");
    expect(r3).toContain("/v/test-output-3.log");
  });
});

describe("composeFixPrompt", () => {
  const bundle = "1. [bug] test foo crashes on null input\n2. [spec-gap] missing retry path";
  const p = composeFixPrompt(2, bundle, "/state/topic/_perform/verify-report-2.md");
  it("names the round + fix loop, embeds the bundle verbatim under ISSUES, names the routing skills", () => {
    expect(p).toContain("ROUND 2 of /consort:perform (fix loop)");
    expect(p).toContain("ISSUES TO ADDRESS:");
    expect(p).toContain(bundle);
    expect(p).toMatch(/systematic-debugging/);
    expect(p).toMatch(/writing-plans/);
    expect(p).toMatch(/requesting-code-review/);
  });
  it("tees the per-round test-output log into the verify dir and requires the VERDICT line", () => {
    expect(p).toContain("/state/topic/_perform/test-output-2.log");
    expect(p).toContain("VERDICT: PASS|PARTIAL|FAIL");
  });
  it("embeds the bundle WITHOUT trimming (the bash cats it raw)", () => {
    const padded = "  leading + trailing spaces  ";
    expect(composeFixPrompt(2, padded, "/v/verify-report-2.md")).toContain(padded);
  });
  it("is branch-disciplined, documents the ask protocol, carries no fence/done-line", () => {
    expect(p).toMatch(/do NOT run 'git checkout', 'git switch'/i);
    expect(p).toContain("part-ask.sh");
    expect(p).not.toContain("END_OF_INSTRUCTION");
    expect(p).not.toContain('"event":"done"');
  });
  it("carries no stale rebrand tokens", () => {
    expect(p).not.toMatch(/clone-wars/);
    expect(p).not.toMatch(/cw_/);
    expect(p).not.toMatch(/master[ -]?yoda/i);
    expect(p).not.toMatch(/trooper|commander/i);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `npx vitest run tests/perform-turn.test.ts`

- [ ] **Step 3: Implement** — `src/core/performTurn.ts` (reference impl, byte-faithful):

The complete reference implementation is in the grounding output; reproduce it exactly, honoring the
gotchas above. Key shape:

```ts
// src/core/performTurn.ts — single-part TURN machinery for `perform` (Phase A).
// Byte-faithful port of deploy-turn-wait.sh (the TS= state machine) + deploy_build_turn_prompt_round1
// and deploy_build_turn_prompt_fix. Mirrors scoreTurn.ts conventions; prompt composers OMIT
// END_OF_INSTRUCTION and the done line (inboxWrite appends them). A question round-trip is ONE
// logical turn; the re-armed wait reads the LATEST OFFSET= line (scoreTurn.parseLatestOffset).
import type { OutboxEvent } from "./ipc.js";
import { dirname } from "node:path";

export type PerformState = "ok" | "failed" | "timeout" | "question";

/** Map a single-part turn's wait outcome to TS= (port of the `case "$EVENT"` block in
 *  deploy-turn-wait.sh:59-93). null -> timeout; question -> question; done + verify present AND
 *  non-empty -> ok else failed; error / unknown -> failed. */
export function performState(ev: OutboxEvent | null, verifyText: string | null): PerformState {
  if (!ev) return "timeout";
  if (ev.event === "question") return "question";
  if (ev.event === "done") return verifyText !== null && verifyText.length > 0 ? "ok" : "failed";
  return "failed";
}

const BRANCH_DISCIPLINE =
  "BRANCH DISCIPLINE (hard rule):\n" +
  "- You are operating on the conductor's current branch in the target\n" +
  "  repository. Do NOT run 'git checkout', 'git switch',\n" +
  "  'git branch -m', or create new branches.\n" +
  "- Commit per task with Conventional Commits prefixes on the current\n" +
  "  branch (rule already stated above).\n" +
  "- If your work genuinely needs a fresh branch, abort with\n" +
  '  {"event":"error","reason":"branch-discipline: needed new branch"}\n' +
  "  and let the conductor decide.\n";

const BLOCKERS =
  "BLOCKERS / QUESTIONS (read carefully):\n" +
  "- If a referenced path, file, checkpoint, git ref, env var, or\n" +
  "  command is NOT where the notes say it is, DO NOT search the\n" +
  "  filesystem yourself, DO NOT invent a workaround. Halt and ask:\n" +
  '    $CLAUDE_PLUGIN_ROOT/bin/part-ask.sh $TOPIC cody "<why-asking>" <kind> <value>\n' +
  "  where <kind> is one of: path | git | env | cmd | test.\n" +
  "- The conductor will verify the claim against ground truth and reply\n" +
  "  via inbox.md, then re-engage you.\n" +
  "- After reading any inbox.md reply, acknowledge with:\n" +
  "    $CLAUDE_PLUGIN_ROOT/bin/inbox-ack.sh $TOPIC cody <inbox-path>\n" +
  "- The 'test' kind runs a diagnostic command under a 30s timeout — it\n" +
  "  is NOT for running your test suite. Running 'bash tests/run.sh' is\n" +
  "  your job. Banned values fail with rc=2.\n";

/** Round-1 plan+implement+self-verify prompt body (port of deploy_build_turn_prompt_round1). MUST
 *  NOT include END_OF_INSTRUCTION or the done line. */
export function composeRound1Prompt(args: { designPath: string; planPath: string; verifyPath: string; round?: number }): string {
  const { designPath, planPath, verifyPath } = args;
  const round = args.round ?? 1;
  const testLog = `${dirname(verifyPath)}/test-output-${round}.log`;
  return [
    `You are entering ROUND ${round} of /consort:perform.`,
    "",
    "This is a single-turn workflow: you will write the implementation plan,",
    "implement it, run the test suite, and write the verify report — all in",
    "one autonomous run. The conductor will only re-engage when you emit done.",
    "",
    "RESUME CHECK (do this BEFORE starting):",
    `- If ${planPath} already exists, skip the planning phase — read the`,
    "  existing plan and proceed to implementation.",
    "- If `git log --oneline` shows commits past the design-doc commit on",
    `  this branch, identify the next pending task from ${planPath}'s checkbox`,
    "  state and continue from there. Do not redo already-committed tasks.",
    `- If ${verifyPath} already exists, you previously completed implementation`,
    `  — re-run the test suite and update ${verifyPath} if test outcomes changed.`,
    "",
    `PHASE 1: Plan (skip if ${planPath} exists)`,
    "  Use the superpowers:writing-plans skill. Read the design doc at:",
    `    ${designPath}`,
    "  Produce a comprehensive implementation plan and write it to:",
    `    ${planPath}`,
    "",
    "PHASE 2: Implement",
    `  Use the superpowers:subagent-driven-development skill. Walk ${planPath}`,
    "  task-by-task. Commit per task (Conventional Commits prefix). Run the",
    "  full test suite (`bash tests/run.sh`) after each task and confirm green.",
    "",
    "PHASE 3: Self-verify",
    "  Use the superpowers:verification-before-completion skill. Run the full",
    "  test suite, tee output to:",
    `    ${testLog}`,
    "  Write a structured verify report to:",
    `    ${verifyPath}`,
    "",
    "  The report MUST start with `VERDICT: PASS|PARTIAL|FAIL` on the first",
    "  line, followed by per-requirement evidence (file:line citations) and a",
    "  short summary.",
    "",
    BRANCH_DISCIPLINE,
    BLOCKERS,
  ].join("\n");
}

/** Fix-round prompt body (round >= 2; port of deploy_build_turn_prompt_fix). `bundleText` is the
 *  on-disk fix bundle, embedded VERBATIM (the bash `cat`s it raw). Same fence-omission note. */
export function composeFixPrompt(round: number, bundleText: string, verifyPath: string): string {
  const testLog = `${dirname(verifyPath)}/test-output-${round}.log`;
  return [
    `You are entering ROUND ${round} of /consort:perform (fix loop).`,
    "",
    "This is a single-turn workflow: address each issue below, re-run the test",
    "suite, and write the verify report — all in one autonomous run.",
    "",
    "RESUME CHECK (do this BEFORE starting):",
    "- Check `git log --oneline` for commits since the previous round's",
    "  verify report was written. If some issues already have addressing",
    "  commits, identify which remain unaddressed and start from those.",
    `- If ${verifyPath} already exists, re-run tests and update it if outcomes`,
    "  changed.",
    "",
    "ISSUES TO ADDRESS:",
    "",
    bundleText,
    "",
    "ROUTING:",
    "- For each issue tagged [bug] or [regression]: use the",
    "  superpowers:systematic-debugging skill.",
    "- For each issue tagged [spec-gap]: use the superpowers:writing-plans",
    "  skill (re-plan the gap, then implement).",
    "- After EACH fix commit: dispatch a code-review subagent via the",
    "  superpowers:requesting-code-review skill with the fix commit's SHA as",
    "  scope. Address Critical and Important findings before moving to the next",
    "  issue. Round 1's subagent-driven-development walks code review per-task",
    "  automatically; fix rounds need this explicit invocation.",
    "",
    "For EACH issue: implement the fix, commit per fix (Conventional Commits",
    "prefix `fix:`, `feat:`, or `test:` as appropriate), run the",
    "code-review subagent on the new commit, then re-run the full test suite.",
    "Do NOT skip any listed issue.",
    "",
    "After all issues are addressed AND the test suite is green:",
    "  Run the full test suite, tee output to:",
    `    ${testLog}`,
    "  Write the verify report to:",
    `    ${verifyPath}`,
    "  The report MUST start with `VERDICT: PASS|PARTIAL|FAIL`.",
    "",
    BRANCH_DISCIPLINE,
    BLOCKERS,
  ].join("\n");
}
```

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run tests/perform-turn.test.ts` (PASS),
  `npm run typecheck` (0).

- [ ] **Step 5: Commit** — `git add src/core/performTurn.ts tests/perform-turn.test.ts && git commit -m "feat(perform): single-part turn machinery (state machine + round-1/fix prompts)"`

---

### Task 5: Sibling cross-repo verifier (`src/core/performSibling.ts`)

**Files:**
- Create: `src/core/performSibling.ts`
- Test: `tests/perform-sibling.test.ts`

**Gotchas (port of deploy-sibling):**
- `enumerateSiblings` is a real fs walk (`readdirSync`/`statSync`, like `multirepo.ts`); the other
  three shell git through the injected `Runner` (import `Runner`/`RunResult` from `./gitwork.js`).
- **Gitlink filter:** `.git` must be a **directory** (`statSync(dotGit).isDirectory()`); a submodule's
  `.git` FILE is skipped. Skip hidden dirs (`startsWith(".")`). `siblings.sort()` (default).
- State-file bytes are byte-frozen: baseline row `${slug}\t${sha}\t${branch}\n`;
  `formatRogueBlock` emits `${slug}\n${log}\n` **only** for non-empty logs; `parseBaselineFile` uses
  `parts.slice(2).join("\t")` for the branch field (a tab in the branch round-trips).
- `diffSiblingAgainstBaseline` strips exactly ONE trailing newline (`.replace(/\n$/, "")`), NOT
  `.trim()`.
- **Ordering is the whole point:** `revertAndReplay` cherry-picks `shaList` **oldest-first** (forward),
  reverts **newest-first** (reverse `for` loop). Caller passes `shaList` oldest-first. Rescue branch
  + cherry-picks happen BEFORE any revert; the pre-flight `show-ref` returns `rescue-exists` with ZERO
  mutation (assert no `git branch` call). Abort/checkout calls are best-effort (ignore exit codes).
- Rescue branch literal: `feat/perform-<topic>-rescue` (the `_deploy/`→`_perform/` rename).
- Distinct outcome tokens (no throw): `not-a-directory` / `not-git` / `detached` / `unknown-baseline`
  / `missing-branch` / `rescue-exists` / `branch-create-failed` / `checkout-rescue-failed` /
  `cherry-pick-conflict` / `checkout-back-failed` / `revert-conflict` / `ok`.

- [ ] **Step 1: Write the failing test** — `tests/perform-sibling.test.ts`

```ts
// tests/perform-sibling.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enumerateSiblings,
  captureSiblingBaseline,
  formatBaselineFile,
  parseBaselineFile,
  diffSiblingAgainstBaseline,
  formatRogueBlock,
  revertAndReplay,
  rescueBranchName,
} from "../src/core/performSibling.js";
import type { Runner, RunResult } from "../src/core/gitwork.js";

function fakeRunner(replies: Record<string, RunResult>) {
  const calls: string[][] = [];
  const r: Runner = {
    run(cmd, args) { calls.push([cmd, ...args]); return replies[[cmd, ...args].join(" ")] ?? { code: 0, stdout: "" }; },
  };
  return { r, calls };
}

describe("enumerateSiblings", () => {
  let hub: string;
  beforeEach(() => { hub = mkdtempSync(join(tmpdir(), "consort-sib-")); });
  afterEach(() => { rmSync(hub, { recursive: true, force: true }); });

  function makeRepo(slug: string, gitIsDir = true) {
    const dir = join(hub, slug);
    mkdirSync(dir, { recursive: true });
    if (gitIsDir) mkdirSync(join(dir, ".git"));
    else writeFileSync(join(dir, ".git"), "gitdir: /elsewhere\n");
  }

  it("keeps git-repo siblings, sorted, excluding declared targets", () => {
    makeRepo("zeta"); makeRepo("alpha"); makeRepo("beta");
    const res = enumerateSiblings(hub, ["beta"]);
    expect(res.outcome).toBe("ok");
    expect(res.siblings).toEqual(["alpha", "zeta"]);
  });

  it("skips hidden dirs, non-repos, and submodule gitlink (.git FILE)", () => {
    makeRepo("good");
    mkdirSync(join(hub, ".hidden", ".git"), { recursive: true });
    mkdirSync(join(hub, "plain"));
    makeRepo("submod", false);
    expect(enumerateSiblings(hub, []).siblings).toEqual(["good"]);
  });

  it("empty exclusion list returns all repo siblings", () => {
    makeRepo("a");
    expect(enumerateSiblings(hub, []).siblings).toEqual(["a"]);
  });

  it("non-existent hub -> not-a-directory, empty list", () => {
    expect(enumerateSiblings(join(hub, "nope"), [])).toEqual({ outcome: "not-a-directory", siblings: [] });
  });
});

describe("captureSiblingBaseline", () => {
  it("ok: emits byte-identical <slug>\\t<sha>\\t<branch>\\n row", () => {
    const { r } = fakeRunner({
      "git rev-parse --git-dir": { code: 0, stdout: ".git\n" },
      "git symbolic-ref --short HEAD": { code: 0, stdout: "main\n" },
      "git rev-parse HEAD": { code: 0, stdout: "deadbeef\n" },
    });
    const res = captureSiblingBaseline(r, "/home/me/proj/sidekick");
    expect(res.outcome).toBe("ok");
    expect(res.slug).toBe("sidekick");
    expect(res.sha).toBe("deadbeef");
    expect(res.branch).toBe("main");
    expect(res.row).toBe("sidekick\tdeadbeef\tmain\n");
  });
  it("not-git: rev-parse --git-dir fails", () => {
    const { r } = fakeRunner({ "git rev-parse --git-dir": { code: 128, stdout: "" } });
    expect(captureSiblingBaseline(r, "/x/y").outcome).toBe("not-git");
  });
  it("detached: symbolic-ref fails", () => {
    const { r } = fakeRunner({
      "git rev-parse --git-dir": { code: 0, stdout: ".git" },
      "git symbolic-ref --short HEAD": { code: 1, stdout: "" },
    });
    expect(captureSiblingBaseline(r, "/x/y").outcome).toBe("detached");
  });
});

describe("baseline file round-trip", () => {
  it("formatBaselineFile concatenates rows verbatim", () => {
    expect(formatBaselineFile(["a\t1\tmain\n", "b\t2\tdev\n"])).toBe("a\t1\tmain\nb\t2\tdev\n");
    expect(formatBaselineFile([])).toBe("");
  });
  it("parseBaselineFile parses, skips blanks, preserves tabs in branch field", () => {
    const body = "a\t1\tmain\n\nb\t2\tfeat/x\n";
    expect(parseBaselineFile(body)).toEqual([
      { slug: "a", sha: "1", branch: "main" },
      { slug: "b", sha: "2", branch: "feat/x" },
    ]);
  });
  it("parseBaselineFile drops short (<3 field) lines", () => {
    expect(parseBaselineFile("onlyslug\n")).toEqual([]);
  });
});

describe("diffSiblingAgainstBaseline", () => {
  const okRepo = { "git rev-parse --git-dir": { code: 0, stdout: ".git" } };
  it("ok: returns trimmed oneline log over base..refs/heads/branch", () => {
    const { r, calls } = fakeRunner({
      ...okRepo,
      "git rev-parse --verify -q base000": { code: 0, stdout: "base000\n" },
      "git rev-parse --verify -q refs/heads/main": { code: 0, stdout: "abc\n" },
      "git log base000..refs/heads/main --oneline": { code: 0, stdout: "c2 second\nc1 first\n" },
    });
    const res = diffSiblingAgainstBaseline(r, "base000", "main");
    expect(res.outcome).toBe("ok");
    expect(res.log).toBe("c2 second\nc1 first");
    expect(calls).toContainEqual(["git", "log", "base000..refs/heads/main", "--oneline"]);
  });
  it("ok with no rogue commits -> empty log", () => {
    const { r } = fakeRunner({
      ...okRepo,
      "git rev-parse --verify -q base000": { code: 0, stdout: "base000" },
      "git rev-parse --verify -q refs/heads/main": { code: 0, stdout: "abc" },
      "git log base000..refs/heads/main --oneline": { code: 0, stdout: "" },
    });
    expect(diffSiblingAgainstBaseline(r, "base000", "main")).toEqual({ outcome: "ok", log: "" });
  });
  it("not-git / unknown-baseline / missing-branch outcomes", () => {
    const notGit = fakeRunner({ "git rev-parse --git-dir": { code: 128, stdout: "" } });
    expect(diffSiblingAgainstBaseline(notGit.r, "b", "main").outcome).toBe("not-git");
    const badBase = fakeRunner({ ...okRepo, "git rev-parse --verify -q b": { code: 1, stdout: "" } });
    expect(diffSiblingAgainstBaseline(badBase.r, "b", "main").outcome).toBe("unknown-baseline");
    const noBranch = fakeRunner({
      ...okRepo,
      "git rev-parse --verify -q b": { code: 0, stdout: "b" },
      "git rev-parse --verify -q refs/heads/main": { code: 1, stdout: "" },
    });
    expect(diffSiblingAgainstBaseline(noBranch.r, "b", "main").outcome).toBe("missing-branch");
  });
});

describe("formatRogueBlock", () => {
  it("emits <slug>\\n<log>\\n when there are rogue commits", () => {
    expect(formatRogueBlock("sidekick", "c1 one\nc2 two")).toBe("sidekick\nc1 one\nc2 two\n");
  });
  it("empty log -> empty block (no header)", () => {
    expect(formatRogueBlock("sidekick", "")).toBe("");
  });
});

describe("rescueBranchName", () => {
  it("uses the rebranded feat/perform-<topic>-rescue shape", () => {
    expect(rescueBranchName("auth")).toBe("feat/perform-auth-rescue");
  });
});

describe("revertAndReplay", () => {
  const topic = "auth";
  const rescue = "feat/perform-auth-rescue";

  it("happy path: replay oldest-first, revert newest-first, returns ok", () => {
    const { r, calls } = fakeRunner({ [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" } });
    const res = revertAndReplay(r, topic, "base000", "main", ["s1", "s2", "s3"]);
    expect(res).toEqual({ outcome: "ok", rescue });
    expect(calls).toContainEqual(["git", "branch", rescue, "base000"]);
    expect(calls).toContainEqual(["git", "checkout", "-q", rescue]);
    expect(calls.filter((c) => c[1] === "cherry-pick").map((c) => c[2])).toEqual(["s1", "s2", "s3"]);
    expect(calls.filter((c) => c[1] === "revert" && c[2] === "--no-edit").map((c) => c[3])).toEqual(["s3", "s2", "s1"]);
  });

  it("rescue branch pre-exists -> rescue-exists, no mutation", () => {
    const { r, calls } = fakeRunner({ [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 0, stdout: "" } });
    expect(revertAndReplay(r, topic, "base000", "main", ["s1"])).toEqual({ outcome: "rescue-exists", rescue });
    expect(calls.some((c) => c[1] === "branch")).toBe(false);
  });

  it("branch-create failure -> branch-create-failed", () => {
    const { r } = fakeRunner({
      [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" },
      [`git branch ${rescue} base000`]: { code: 1, stdout: "" },
    });
    expect(revertAndReplay(r, topic, "base000", "main", ["s1"]).outcome).toBe("branch-create-failed");
  });

  it("checkout-rescue failure -> checkout-rescue-failed", () => {
    const { r } = fakeRunner({
      [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" },
      [`git checkout -q ${rescue}`]: { code: 1, stdout: "" },
    });
    expect(revertAndReplay(r, topic, "base000", "main", ["s1"]).outcome).toBe("checkout-rescue-failed");
  });

  it("cherry-pick conflict -> aborts, returns to branch, reports failed sha", () => {
    const { r, calls } = fakeRunner({
      [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" },
      "git cherry-pick s2": { code: 1, stdout: "" },
    });
    const res = revertAndReplay(r, topic, "base000", "main", ["s1", "s2", "s3"]);
    expect(res).toEqual({ outcome: "cherry-pick-conflict", rescue, failedSha: "s2" });
    expect(calls).toContainEqual(["git", "cherry-pick", "--abort"]);
    expect(calls).toContainEqual(["git", "checkout", "-q", "main"]);
    expect(calls.some((c) => c[1] === "cherry-pick" && c[2] === "s3")).toBe(false);
  });

  it("checkout-back failure -> checkout-back-failed", () => {
    const { r } = fakeRunner({
      [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" },
      "git checkout -q main": { code: 1, stdout: "" },
    });
    expect(revertAndReplay(r, topic, "base000", "main", ["s1"]).outcome).toBe("checkout-back-failed");
  });

  it("revert conflict -> aborts revert, reports failed sha, rescue intact", () => {
    const { r, calls } = fakeRunner({
      [`git show-ref --verify --quiet refs/heads/${rescue}`]: { code: 1, stdout: "" },
      "git revert --no-edit s3": { code: 1, stdout: "" },
    });
    const res = revertAndReplay(r, topic, "base000", "main", ["s1", "s2", "s3"]);
    expect(res).toEqual({ outcome: "revert-conflict", rescue, failedSha: "s3" });
    expect(calls).toContainEqual(["git", "revert", "--abort"]);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `npx vitest run tests/perform-sibling.test.ts`

- [ ] **Step 3: Implement** — `src/core/performSibling.ts` (reproduce the reference byte-faithfully;
  use NORMAL double-quotes — the grounding artifact showed escaped quotes only because of JSON
  serialization):

```ts
// src/core/performSibling.ts
//
// Adjacent-tree commit guard for `perform` Phase A (port of deploy-sibling). Four byte-faithful
// helpers: enumerateSiblings (fs walk), captureSiblingBaseline (baseline row), diffSiblingAgainstBaseline
// (rogue-commit log), revertAndReplay (two-phase rescue). All git goes through an injected Runner.
import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import type { Runner } from "./gitwork.js";

export type EnumerateOutcome = "ok" | "not-a-directory";
export interface EnumerateResult { outcome: EnumerateOutcome; siblings: string[]; }

/** Enumerate undeclared sibling git repos directly under `hub`. `declaredTargets` slugs are excluded. */
export function enumerateSiblings(hub: string, declaredTargets: string[]): EnumerateResult {
  const excluded = new Set(declaredTargets);
  let entries: string[];
  try {
    entries = readdirSync(hub, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return { outcome: "not-a-directory", siblings: [] };
  }
  const siblings: string[] = [];
  for (const slug of entries) {
    if (slug.startsWith(".")) continue;
    const dotGit = join(hub, slug, ".git");
    let isRepo = false;
    try { isRepo = statSync(dotGit).isDirectory(); } catch { isRepo = false; }
    if (!isRepo) continue;
    if (excluded.has(slug)) continue;
    siblings.push(slug);
  }
  siblings.sort();
  return { outcome: "ok", siblings };
}

export type CaptureOutcome = "ok" | "not-git" | "detached";
export interface CaptureResult { outcome: CaptureOutcome; row?: string; slug?: string; sha?: string; branch?: string; }

/** Capture a sibling's baseline row. `r` is a Runner bound to the sibling cwd; `siblingCwd` derives the slug. */
export function captureSiblingBaseline(r: Runner, siblingCwd: string): CaptureResult {
  if (r.run("git", ["rev-parse", "--git-dir"]).code !== 0) return { outcome: "not-git" };
  const symref = r.run("git", ["symbolic-ref", "--short", "HEAD"]);
  if (symref.code !== 0) return { outcome: "detached" };
  const branch = symref.stdout.trim();
  const sha = r.run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const slug = basename(siblingCwd);
  const row = `${slug}\t${sha}\t${branch}\n`;
  return { outcome: "ok", row, slug, sha, branch };
}

/** Render baseline rows into the full sibling-baseline.txt body (byte-identical). */
export function formatBaselineFile(rows: string[]): string { return rows.join(""); }

export interface BaselineRow { slug: string; sha: string; branch: string; }
/** Parse sibling-baseline.txt; skips blanks; preserves tabs in the branch field via slice(2). */
export function parseBaselineFile(body: string): BaselineRow[] {
  const out: BaselineRow[] = [];
  for (const line of body.split("\n")) {
    if (line.length === 0) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    out.push({ slug: parts[0], sha: parts[1], branch: parts.slice(2).join("\t") });
  }
  return out;
}

export type DiffOutcome = "ok" | "not-git" | "unknown-baseline" | "missing-branch";
export interface DiffResult { outcome: DiffOutcome; log?: string; }

/** Rogue-commit log for sibling-rogue.txt; strips exactly one trailing newline (NOT trim). */
export function diffSiblingAgainstBaseline(r: Runner, baselineSha: string, branch: string): DiffResult {
  if (r.run("git", ["rev-parse", "--git-dir"]).code !== 0) return { outcome: "not-git" };
  if (r.run("git", ["rev-parse", "--verify", "-q", baselineSha]).code !== 0) return { outcome: "unknown-baseline" };
  if (r.run("git", ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]).code !== 0) return { outcome: "missing-branch" };
  const log = r.run("git", ["log", `${baselineSha}..refs/heads/${branch}`, "--oneline"]).stdout.replace(/\n$/, "");
  return { outcome: "ok", log };
}

/** sibling-rogue.txt block for one sibling: `<slug>\n<log>\n`, only when log is non-empty. */
export function formatRogueBlock(slug: string, log: string): string {
  if (log.length === 0) return "";
  return `${slug}\n${log}\n`;
}

export type RevertReplayOutcome =
  | "ok" | "rescue-exists" | "branch-create-failed" | "checkout-rescue-failed"
  | "cherry-pick-conflict" | "checkout-back-failed" | "revert-conflict";
export interface RevertReplayResult { outcome: RevertReplayOutcome; rescue: string; failedSha?: string; }

/** Rescue branch name (the _deploy/->_perform/ rename). */
export function rescueBranchName(topic: string): string { return `feat/perform-${topic}-rescue`; }

/** Two-phase rescue. `r` bound to the sibling cwd; `shaList` oldest-first. No real git in tests. */
export function revertAndReplay(r: Runner, topic: string, baselineSha: string, branch: string, shaList: string[]): RevertReplayResult {
  const rescue = rescueBranchName(topic);
  if (r.run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${rescue}`]).code === 0) {
    return { outcome: "rescue-exists", rescue };
  }
  if (r.run("git", ["branch", rescue, baselineSha]).code !== 0) return { outcome: "branch-create-failed", rescue };
  if (r.run("git", ["checkout", "-q", rescue]).code !== 0) return { outcome: "checkout-rescue-failed", rescue };
  for (const sha of shaList) {
    if (r.run("git", ["cherry-pick", sha]).code !== 0) {
      r.run("git", ["cherry-pick", "--abort"]);
      r.run("git", ["checkout", "-q", branch]);
      return { outcome: "cherry-pick-conflict", rescue, failedSha: sha };
    }
  }
  if (r.run("git", ["checkout", "-q", branch]).code !== 0) return { outcome: "checkout-back-failed", rescue };
  for (let i = shaList.length - 1; i >= 0; i--) {
    const sha = shaList[i];
    if (r.run("git", ["revert", "--no-edit", sha]).code !== 0) {
      r.run("git", ["revert", "--abort"]);
      return { outcome: "revert-conflict", rescue, failedSha: sha };
    }
  }
  return { outcome: "ok", rescue };
}
```

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run tests/perform-sibling.test.ts` (PASS),
  `npm run typecheck` (0).

- [ ] **Step 5: Commit** — `git add src/core/performSibling.ts tests/perform-sibling.test.ts && git commit -m "feat(perform): sibling cross-repo verifier (enumerate/baseline/diff/revert-replay)"`

---

### Task 6: Core paths / parse / target-resolution (`src/core/perform.ts`)

**Files:**
- Create: `src/core/perform.ts`
- Test: `tests/perform.test.ts`

**Gotchas (port of deploy.sh core helpers):**
- REUSE, don't re-port: `topicDir` (`paths.js`), `extractTarget` (`audit.js` — re-export it AND use it
  in `resolveTarget`), `kvParse` (`../args.js`). `validateTargets` (`multirepo.js`) + `deriveSlug`
  are the command layer's concern — `parsePerformArgs` only produces the raw `targets[]`.
- `deriveTopicFromPath`: strip leading `YYYY-MM-DD-` (`/^\d{4}-\d{2}-\d{2}-/`) then `-design.md` else
  `.md` (endsWith+slice, `-design.md` FIRST).
- `--max-rounds` is **REJECTED** (`PerformArgError`, code 2) for both `--max-rounds` and
  `--max-rounds=N` — the directive must strip it before init (it never reaches the args file).
- `detectProvider`: `.claude-plugin/plugin.json` present → `claude`, else `codex`. A non-empty
  `override` short-circuits (whitelisted to codex/claude; `opencode` + unknown throw `ProviderError`).
- `resolveTarget`: no header → cwd; invalid/ambiguous header → throw; valid + `<cwd>/<slug>/.git`
  (dir OR file) → `<cwd>/<slug>`; missing dir or no-.git → throw. Reads the doc from disk.
- `iterTargets`: hub mode reads **`parts.txt`** (`<slug>\t<cwd>`); single-repo synthesizes one
  `{slug:"main", cwd}` from `target_cwd.txt` (strip one trailing newline); neither → `[]`.
  **`parts.txt`, NOT `troopers.txt`** — the stale-token gate bans the `trooper` substring.

- [ ] **Step 1: Write the failing test** — `tests/perform.test.ts`

```ts
// tests/perform.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  performArtDir, performTopicDir, deriveTopicFromPath, parsePerformArgs, PerformArgError,
  resolveTarget, resolveHub, PerformResolveError, detectProvider, ProviderError, iterTargets,
} from "../src/core/perform.js";
import { topicDir } from "../src/core/paths.js";

function freshHome(): string { return mkdtempSync(join(tmpdir(), "perf-home-")); }

afterEach(() => { delete process.env.CONSORT_PERFORM_ART_DIR_OVERRIDE; });

describe("performArtDir / performTopicDir", () => {
  it("art dir is <topicDir>/_perform", () => {
    const home = freshHome();
    expect(performArtDir("foo", { home })).toBe(join(topicDir("foo", { home }), "_perform"));
  });
  it("topic dir mirrors paths.topicDir", () => {
    const home = freshHome();
    expect(performTopicDir("foo", { home })).toBe(topicDir("foo", { home }));
  });
  it("CONSORT_PERFORM_ART_DIR_OVERRIDE short-circuits", () => {
    process.env.CONSORT_PERFORM_ART_DIR_OVERRIDE = "/tmp/override-art";
    expect(performArtDir("foo", { home: freshHome() })).toBe("/tmp/override-art");
  });
});

describe("deriveTopicFromPath", () => {
  it("strips YYYY-MM-DD- prefix and -design.md suffix", () => {
    expect(deriveTopicFromPath("docs/2026-05-09-deploy-multi-repo-dag-design.md")).toBe("deploy-multi-repo-dag");
  });
  it("strips .md when -design.md not present", () => {
    expect(deriveTopicFromPath("/a/b/2026-01-02-foo.md")).toBe("foo");
  });
  it("basename only (no leading date) -> strip suffix", () => {
    expect(deriveTopicFromPath("plain-design.md")).toBe("plain");
  });
  it("empty path -> empty string", () => { expect(deriveTopicFromPath("")).toBe(""); });
  it("no date, no .md -> basename unchanged", () => { expect(deriveTopicFromPath("/x/y/topicname")).toBe("topicname"); });
});

describe("parsePerformArgs", () => {
  it("default branch mode is branch-on; positional collected into rest", () => {
    const r = parsePerformArgs(["path/to/spec.md"]);
    expect(r.branchMode).toBe("branch");
    expect(r.rest).toBe("path/to/spec.md");
    expect(r.branchName).toBeUndefined();
    expect(r.topic).toBeUndefined();
    expect(r.targets).toEqual([]);
  });
  it("--no-branch opts out", () => { expect(parsePerformArgs(["spec.md", "--no-branch"]).branchMode).toBe("no-branch"); });
  it("--branch <n> (space form) and --topic <slug>", () => {
    const r = parsePerformArgs(["spec.md", "--branch", "feat/x", "--topic", "mytopic"]);
    expect(r.branchName).toBe("feat/x"); expect(r.topic).toBe("mytopic"); expect(r.rest).toBe("spec.md");
  });
  it("--branch=<n> and --topic=<slug> (equals form)", () => {
    const r = parsePerformArgs(["spec.md", "--branch=feat/y", "--topic=tt"]);
    expect(r.branchName).toBe("feat/y"); expect(r.topic).toBe("tt");
  });
  it("--targets a,b,c is split / trimmed / empty-filtered", () => {
    expect(parsePerformArgs(["spec.md", "--targets", " api , web ,,"]).targets).toEqual(["api", "web"]);
  });
  it("--targets=a,b equals form", () => { expect(parsePerformArgs(["--targets=api,web"]).targets).toEqual(["api", "web"]); });
  it("--max-rounds (space form) is REJECTED at init (directive must strip it first)", () => {
    expect(() => parsePerformArgs(["spec.md", "--max-rounds", "3"])).toThrow(PerformArgError);
  });
  it("--max-rounds=N (equals form) is also REJECTED", () => {
    expect(() => parsePerformArgs(["spec.md", "--max-rounds=5"])).toThrow(PerformArgError);
  });
});

describe("resolveTarget", () => {
  function writeDoc(root: string, body: string): string {
    const p = join(root, "design.md"); writeFileSync(p, body); return p;
  }
  it("no Target Sub-Project header -> returns cwd verbatim", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-"));
    expect(resolveTarget(writeDoc(root, "# X\n## Goal\ng\n"), root)).toBe(root);
  });
  it("valid header + sibling git repo -> returns <cwd>/<slug>", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-"));
    mkdirSync(join(root, "api", ".git"), { recursive: true });
    expect(resolveTarget(writeDoc(root, "**Target Sub-Project:** api\n"), root)).toBe(join(root, "api"));
  });
  it("valid header + sibling .git FILE (worktree) -> returns <cwd>/<slug>", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-"));
    mkdirSync(join(root, "wt"), { recursive: true });
    writeFileSync(join(root, "wt", ".git"), "gitdir: /elsewhere\n");
    expect(resolveTarget(writeDoc(root, "**Target Sub-Project:** wt\n"), root)).toBe(join(root, "wt"));
  });
  it("valid header + missing dir -> throws PerformResolveError", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-"));
    expect(() => resolveTarget(writeDoc(root, "**Target Sub-Project:** ghost\n"), root)).toThrow(PerformResolveError);
  });
  it("valid header + dir without .git -> throws", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-"));
    mkdirSync(join(root, "plain"), { recursive: true });
    expect(() => resolveTarget(writeDoc(root, "**Target Sub-Project:** plain\n"), root)).toThrow(/not a git repo/);
  });
  it("invalid slug header -> throws (ambiguous/invalid)", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-"));
    expect(() => resolveTarget(writeDoc(root, "**Target Sub-Project:** ../escape\n"), root)).toThrow(PerformResolveError);
  });
  it("two headers -> throws (ambiguous)", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-"));
    expect(() => resolveTarget(writeDoc(root, "**Target Sub-Project:** a\n**Target Sub-Project:** b\n"), root)).toThrow(PerformResolveError);
  });
  it("unreadable doc -> throws", () => {
    const root = mkdtempSync(join(tmpdir(), "rt-"));
    expect(() => resolveTarget(join(root, "nope.md"), root)).toThrow(PerformResolveError);
  });
});

describe("resolveHub", () => {
  it("returns repoRoot verbatim", () => { expect(resolveHub("/any/doc.md", "/repo/root")).toBe("/repo/root"); });
});

describe("detectProvider", () => {
  it("plugin repo (.claude-plugin/plugin.json) -> claude", () => {
    const root = mkdtempSync(join(tmpdir(), "dp-"));
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), "{}");
    expect(detectProvider(root)).toBe("claude");
  });
  it("non-plugin repo -> codex (cheap default)", () => {
    expect(detectProvider(mkdtempSync(join(tmpdir(), "dp-")))).toBe("codex");
  });
  it("override codex / claude short-circuits auto-detect", () => {
    const root = mkdtempSync(join(tmpdir(), "dp-"));
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), "{}");
    expect(detectProvider(root, "codex")).toBe("codex");
    expect(detectProvider(root, "claude")).toBe("claude");
  });
  it("override opencode -> throws (not supported)", () => {
    expect(() => detectProvider(mkdtempSync(join(tmpdir(), "dp-")), "opencode")).toThrow(ProviderError);
  });
  it("unknown override -> throws", () => {
    expect(() => detectProvider(mkdtempSync(join(tmpdir(), "dp-")), "gemini")).toThrow(ProviderError);
  });
});

describe("iterTargets", () => {
  it("hub mode reads parts.txt as <slug>\\t<cwd> rows", () => {
    const home = freshHome();
    const art = performArtDir("topic", { home }); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "parts.txt"), "api\t/repo/api\nweb\t/repo/web\n");
    expect(iterTargets("topic", { home })).toEqual([{ slug: "api", cwd: "/repo/api" }, { slug: "web", cwd: "/repo/web" }]);
  });
  it("single-repo synthesizes one 'main' row from target_cwd.txt", () => {
    const home = freshHome();
    const art = performArtDir("topic", { home }); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "target_cwd.txt"), "/repo/root\n");
    expect(iterTargets("topic", { home })).toEqual([{ slug: "main", cwd: "/repo/root" }]);
  });
  it("neither file -> []", () => { expect(iterTargets("topic", { home: freshHome() })).toEqual([]); });
  it("parts.txt takes precedence over target_cwd.txt", () => {
    const home = freshHome();
    const art = performArtDir("topic", { home }); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "parts.txt"), "api\t/repo/api\n");
    writeFileSync(join(art, "target_cwd.txt"), "/repo/root\n");
    expect(iterTargets("topic", { home })).toEqual([{ slug: "api", cwd: "/repo/api" }]);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `npx vitest run tests/perform.test.ts`

- [ ] **Step 3: Implement** — `src/core/perform.ts`:

```ts
// src/core/perform.ts
// CORE paths / parse / target-resolution + provider-detection for /consort:perform.
// Byte-faithful port of the prior bash plugin's deploy core helpers (cosmetic rebrand: _deploy/ ->
// _perform/, worker-noun -> "part", CW_DEPLOY_* env -> CONSORT_PERFORM_*). Logic preserved verbatim.
import { join, basename } from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";
import { topicDir } from "./paths.js";
import { extractTarget } from "./audit.js";
import { kvParse } from "../args.js";

export { extractTarget } from "./audit.js"; // REUSED: audit.ts already ports the target-header extractor.

/** `_perform` art dir for a topic. Honors CONSORT_PERFORM_ART_DIR_OVERRIDE; else <topicDir>/_perform. */
export function performArtDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  const override = process.env.CONSORT_PERFORM_ART_DIR_OVERRIDE;
  if (override) return override;
  return join(topicDir(topic, opts), "_perform");
}

/** Topic state dir for a perform invocation. */
export function performTopicDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  return topicDir(topic, opts);
}

/** Port of deploy_derive_topic: basename, strip leading YYYY-MM-DD-, then trailing -design.md else .md. */
export function deriveTopicFromPath(p: string): string {
  if (!p) return "";
  let base = basename(p);
  base = base.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  if (base.endsWith("-design.md")) base = base.slice(0, -"-design.md".length);
  else if (base.endsWith(".md")) base = base.slice(0, -".md".length);
  return base;
}

export interface PerformArgs {
  rest: string;
  branchMode: "branch" | "no-branch";
  branchName?: string;
  topic?: string;
  targets: string[];
}

export class PerformArgError extends Error { code = 2; }
export class PerformResolveError extends Error { code = 1; constructor(message: string) { super(message); } }
export class ProviderError extends Error { code = 1; constructor(message: string) { super(message); } }

/** Parse the perform args tokens (port of deploy-init's argv parser). Default branch-on; --no-branch
 *  opts out. --max-rounds is REJECTED (the directive strips it before init). */
export function parsePerformArgs(tokens: string[]): PerformArgs {
  let branchMode: "branch" | "no-branch" = "branch";
  let branchName: string | undefined;
  let topic: string | undefined;
  let targets: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--max-rounds" || t.startsWith("--max-rounds=")) {
      throw new PerformArgError("--max-rounds must be stripped by the directive before init");
    }
    if (t === "--no-branch") { branchMode = "no-branch"; continue; }
    if (t === "--branch" || t.startsWith("--branch=")) {
      const { value, shift } = kvParse(t, tokens[i + 1]); branchName = value; if (shift === 2) i++; continue;
    }
    if (t === "--topic" || t.startsWith("--topic=")) {
      const { value, shift } = kvParse(t, tokens[i + 1]); topic = value; if (shift === 2) i++; continue;
    }
    if (t === "--targets" || t.startsWith("--targets=")) {
      const { value, shift } = kvParse(t, tokens[i + 1]);
      targets = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (shift === 2) i++; continue;
    }
    rest.push(t);
  }
  return { rest: rest.join(" "), branchMode, branchName, topic, targets };
}

/** True iff `<dir>/.git` exists as a directory (normal repo) or a file (gitdir worktree). */
function hasGitDir(dir: string): boolean {
  const dotgit = join(dir, ".git");
  if (!existsSync(dotgit)) return false;
  try { const st = statSync(dotgit); return st.isDirectory() || st.isFile(); } catch { return false; }
}

/** Port of deploy_resolve_target. No header -> cwd; invalid/ambiguous -> throw; valid + <cwd>/<slug>/.git
 *  -> <cwd>/<slug>; missing dir / no .git -> throw. Reads the doc from disk. */
export function resolveTarget(docPath: string, cwd: string): string {
  let docText: string;
  try { docText = readFileSync(docPath, "utf8"); }
  catch { throw new PerformResolveError(`resolveTarget: doc unreadable: ${docPath}`); }
  const t = extractTarget(docText);
  if (t.present && !t.valid) {
    throw new PerformResolveError(`resolveTarget: invalid or ambiguous Target Sub-Project header in ${docPath}`);
  }
  if (!t.present) return cwd;
  const slug = t.slug;
  const sub = join(cwd, slug);
  let isDir = false;
  try { isDir = statSync(sub).isDirectory(); } catch { isDir = false; }
  if (!isDir) {
    throw new PerformResolveError(`target sub-project '${slug}' not found at ${sub} (no directory; check spelling or that the sub-repo is checked out)`);
  }
  if (!hasGitDir(sub)) {
    throw new PerformResolveError(`target sub-project '${slug}' is a directory but not a git repo (no .git/ at ${sub})`);
  }
  return sub;
}

/** Port of deploy_resolve_hub: both modes resolve to repoRoot in the current contract. */
export function resolveHub(_docPath: string, repoRoot: string): string {
  return repoRoot;
}

/** Port of deploy_detect_provider. plugin.json present -> claude; else codex. Non-empty override
 *  short-circuits (codex/claude only; opencode + unknown throw). */
export function detectProvider(repoRoot: string, override?: string): "codex" | "claude" {
  if (override) {
    if (override === "codex" || override === "claude") return override;
    if (override === "opencode") {
      throw new ProviderError("perform: opencode is not a supported provider; use codex (default) or claude (plugin-dev)");
    }
    throw new ProviderError(`perform: unknown provider override '${override}' (allowed: codex, claude)`);
  }
  return existsSync(join(repoRoot, ".claude-plugin", "plugin.json")) ? "claude" : "codex";
}

export interface IterTarget { slug: string; cwd: string; }

/** Port of deploy_iter_targets. Hub mode reads parts.txt (TSV <slug>\t<cwd>); single-repo synthesizes
 *  one 'main' row from target_cwd.txt; neither file -> []. (parts.txt, NOT troopers.txt — gate-safe.) */
export function iterTargets(topic: string, opts?: { home?: string; cwd?: string }): IterTarget[] {
  const art = performArtDir(topic, opts);
  const partsFile = join(art, "parts.txt");
  if (existsSync(partsFile)) {
    const out: IterTarget[] = [];
    for (const line of readFileSync(partsFile, "utf8").split("\n")) {
      if (line.length === 0) continue;
      const cols = line.split("\t");
      out.push({ slug: cols[0] ?? "", cwd: cols[1] ?? "" });
    }
    return out;
  }
  const targetCwdFile = join(art, "target_cwd.txt");
  if (existsSync(targetCwdFile)) {
    const cwd = readFileSync(targetCwdFile, "utf8").replace(/\n$/, "");
    return [{ slug: "main", cwd }];
  }
  return [];
}
```

- [ ] **Step 4: Run tests + typecheck** — `npx vitest run tests/perform.test.ts` (PASS),
  `npm run typecheck` (0).

- [ ] **Step 5: Commit** — `git add src/core/perform.ts tests/perform.test.ts && git commit -m "feat(perform): core paths/parse/target-resolution/provider-detection"`

---

## Phase A completion gate

After all six tasks:

- [ ] `npm run typecheck` → 0 errors.
- [ ] `npm run test` → all suites green (the existing 330 + the new perform/dag-executor suites).
- [ ] `npm run lint` → 0 errors (note: `no-unused-vars` is `error`; the `void SLUG_REGEX` keeps that
  import live).
- [ ] `npx vitest run tests/stale-tokens.test.ts` → green (no `cw_`/`clone-wars`/`trooper` residue in
  any new `src/core/*.ts`, including JSDoc).
- [ ] No `dist` rebuild (no dispatch entry yet — that is Phase B).
- [ ] Report phase complete; **leave the branch** `feat/perform` for Phase B (do NOT open a PR —
  `perform` ships as one branch across phases A–D, like `score`).
