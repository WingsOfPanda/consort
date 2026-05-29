# consort `score` — Phase E: multi-repo detection + execution-DAG + 8-section walk (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Light up the multi-repo escalation path — detect sibling sub-projects, walk the 8-section doc
(adding Execution DAG + Cross-Repo Notes), produce + draft-time-validate a parseable Execution DAG, and
audit through the multi-repo header — ending in a live multi-repo dogfood.

**Architecture:** Phase E is **mostly wiring + directive**. consort already has, built and unit-tested:
`detectMultiRepo` (`multirepo.ts`), `parseDagLine`/`checkDagSection`/`emitSoftDag` (`dag.ts`),
`assembleDoc` multi-mode + `SECTIONS_MULTI` (`scoreDoc.ts`), and the multi-repo audit rules
(`extractTarget`/`SLUG_REGEX`/`target_subproject_when_invalid`/`execution_dag_not_parseable` in
`audit.ts`) + `auditIssueToSection` header/execution-dag mapping (`scoreWalk.ts`). New code: a
`validateTargets` helper, a TSV targets writer, a `dagMalformedLines` reporter, and four thin
subcommands (`detect-multi-repo`, `emit-dag`, `check-dag`, rewired `init --targets`). The bulk is
`commands/score.md` Stages 1/10/11/12 multi-repo branches. score validates its DAG and discards — it
**never** runs the executor.

**Tech Stack:** TypeScript (ES2022/NodeNext/strict), vitest, esbuild → committed `dist/consort.cjs`.
Behavioral source: clone-wars `lib/consult-walk.sh` (`cw_consult_detect_multi_repo`, `cw_consult_emit_soft_dag`),
`lib/deploy-dag.sh` (`cw_deploy_dag_parse_line`/`cw_deploy_dag_check_section`), `lib/deploy.sh` (audit),
`bin/consult-walk-assemble.sh`, `commands/consult.md` Steps 10–12.

---

## Scope (this plan)

**In:** `validateTargets` (slug-regex via `SLUG_REGEX` + sibling-dir/marker existence + dedup → `RepoHit[]`),
a TSV `targets.txt` writer, `score init --targets` rewire (validate + TSV), `score detect-multi-repo`
(wire `detectMultiRepo`, emit TSV hits), `score emit-dag` (wire `emitSoftDag` → the `## Execution DAG`
draft), `score check-dag` (wire `checkDagSection` + new `dagMalformedLines` → the pre-Approve gate),
`commands/score.md` Stage 1 routing flip + Stage 10 detection + Stage 11 8-section walk (per-target
architecture, cross-repo-notes, the execution-dag gate) + Stage 12 multi audit bounce; rebuilt `dist`; a
live multi-repo dogfood.

**Out (Phase F):** drilldown, forensics, `coda` teardown, `present` handoff, final acceptance dogfood.
**Out (perform, NOT built):** the DAG **executor** — `topological`/waves, `unique_repos`/`fan_in`,
`dag-waves.txt`/`dag-edges.txt`, `target_cwd`/branch redirection. score emits + conformance-validates
its DAG only; it never topo-sorts, computes waves, or detects cycles.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/core/multirepo.ts` | add `validateTargets(cwd, slugs)` → `{ok: RepoHit[], errors[]}` (reuse `SLUG_REGEX`) | modify |
| `src/core/score.ts` | add `writeTargetsTsv(hits, iso)` | modify |
| `src/core/dag.ts` | add `dagMalformedLines(docText)` (the failing numbered lines) | modify |
| `src/commands/score.ts` | rewire `init --targets`; add `detect-multi-repo`/`emit-dag`/`check-dag` | modify |
| `commands/score.md` | Stage 1 flip + Stages 10–12 multi-repo branches | modify |
| `tests/multirepo.test.ts` | `validateTargets` cases (tmp sibling tree) | modify |
| `tests/score-core.test.ts` | `writeTargetsTsv` round-trip | modify |
| `tests/dag.test.ts` | `dagMalformedLines` cases | modify |
| `tests/score-init.test.ts` | `--targets` validation (injected dep) | modify |
| `tests/score-escalation.test.ts` | `detect-multi-repo`/`emit-dag`/`check-dag` | modify |
| `dist/consort.cjs` | rebuilt | regenerate |
| `docs/superpowers/DOGFOOD.md` | Phase E section | modify |

## Deliberate constraints (from the grounding; do NOT violate)

1. **No executor in score.** Validate via `checkDagSection`/`dagMalformedLines` only. Never call/port
   topological/waves/unique_repos/fan_in or write `dag-waves.txt`/`dag-edges.txt`. clone-wars' walk
   shelled the full `deploy-dag-parse.sh` (which topo-sorts) just for rc+stderr — do NOT replicate that.
2. **No cycle detection in score.** A syntactically-valid cyclic DAG passes score's gate (cycles surface
   only at perform time). Don't promise otherwise in code or prose.
3. **Em-dash U+2014 (`—`)** in every emitted/example DAG line. A hyphen/en-dash makes the line malformed.
   `dag.ts` already uses it internally; the risk is example text in `score.md` and any hand-built row.
4. **Exact heading `## Execution DAG`** (optional trailing whitespace, no suffix). A decorated heading
   (`## Execution DAG (multi)`) silently disables the gate (returns ok). Draft the bare heading.
5. **`SECTIONS_MULTI` (`scoreDoc.ts`) is authoritative** (8 keys, execution-dag before cross-repo-notes,
   between components and testing). The Stage-11 walk list in `score.md` is a second copy — keep byte-identical.
6. **Header asymmetry:** the plural `**Target Sub-Project(s):**` (multi) does NOT match `extractTarget`'s
   singular regex, so `target_subproject_when_invalid` fires only for **single-sub**. The Stage-12
   `header` bounce is in practice a single-sub safeguard — don't document it as a multi guard.
7. **Edit-down-to-1:** in the 2+-hit "Edit list" branch, a user typing exactly one slug → `multi-repo.txt=single-sub`
   (not `multi`). Hit count does NOT determine final mode.
8. **Loose substring detection is intentional** (`detectMultiRepo`: slug `cc` matches `success`). Don't
   tighten it; the 2+-hit "Edit list" AskUserQuestion is the human escape hatch.
9. **Frozen functional tokens:** section slugs (`execution-dag`, `cross-repo-notes`) and audit ISSUE
   codes (`target_subproject_when_invalid`, `execution_dag_not_parseable`) are NOT cosmetic — never
   rename. Stale-token gate still bans `clone-wars`/`cw_`/`@cw_`/`trooper`/`commander`/`master-yoda`.

---

### Task 1: `validateTargets` (core/multirepo.ts)

**Files:** Modify `src/core/multirepo.ts`; Test `tests/multirepo.test.ts`

Validate user-supplied `--targets` slugs against the conductor's cwd: each must match `SLUG_REGEX`
(reuse from `audit.ts` — rejects `/`, `..`), be a real first-level sibling dir with `CLAUDE.md` (pref)
or `AGENTS.md`, and be unique. Returns the resolved `RepoHit[]` (same shape/realpath resolution as
`detectMultiRepo`) plus human-readable errors. Converges `--targets` and auto-detect on one shape.

- [ ] **Step 1: Write the failing test (append to `tests/multirepo.test.ts`)**

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { validateTargets } from "../src/core/multirepo.js";

function siblingTree(specs: Array<{ name: string; marker?: "CLAUDE.md" | "AGENTS.md" }>): string {
  const root = mkdtempSync(join(tmpdir(), "sibtree-"));
  for (const s of specs) { const d = join(root, s.name); mkdirSync(d, { recursive: true }); if (s.marker) writeFileSync(join(d, s.marker), "# x\n"); }
  return root;
}

describe("validateTargets", () => {
  it("accepts real sibling dirs with a marker; resolves RepoHit[]", () => {
    const root = siblingTree([{ name: "api", marker: "CLAUDE.md" }, { name: "web", marker: "AGENTS.md" }]);
    const r = validateTargets(root, ["api", "web"]);
    expect(r.errors).toEqual([]);
    expect(r.ok.map((h) => h.slug)).toEqual(["api", "web"]);
    expect(r.ok[0].marker.endsWith(join("api", "CLAUDE.md"))).toBe(true);
  });
  it("rejects a path-traversal slug and a missing dir", () => {
    const root = siblingTree([{ name: "api", marker: "CLAUDE.md" }]);
    const r = validateTargets(root, ["../escape", "ghost"]);
    expect(r.ok).toEqual([]);
    expect(r.errors.length).toBe(2);
  });
  it("rejects a sibling dir with no marker, and dedups", () => {
    const root = siblingTree([{ name: "api", marker: "CLAUDE.md" }, { name: "nomark" }]);
    const r = validateTargets(root, ["api", "api", "nomark"]);
    expect(r.ok.map((h) => h.slug)).toEqual(["api"]); // dedup + nomark dropped
    expect(r.errors.some((e) => /duplicate/.test(e))).toBe(true);
    expect(r.errors.some((e) => /nomark/.test(e))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `npx vitest run tests/multirepo.test.ts -t validateTargets` → FAIL.

- [ ] **Step 3: Implement (append to `src/core/multirepo.ts`)**

```ts
import { SLUG_REGEX } from "./audit.js";
// (multirepo.ts already imports existsSync/readdirSync/realpathSync from node:fs + join from node:path;
//  reuse them. If realpathSync is not yet imported, add it to the existing node:fs import.)

export interface TargetValidation { ok: RepoHit[]; errors: string[]; }

/** Validate --targets slugs against `cwd`'s first-level sibling dirs (port of consult-init.sh's
 *  --targets validation, widened with marker existence). Each slug must match SLUG_REGEX, be a real
 *  sibling dir with CLAUDE.md (pref) or AGENTS.md, and be unique. Returns resolved RepoHit[] + errors. */
export function validateTargets(cwd: string, slugs: string[]): TargetValidation {
  const ok: RepoHit[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (!SLUG_REGEX.test(slug)) { errors.push(`invalid target slug (must match ${SLUG_REGEX.source}): ${slug}`); continue; }
    if (seen.has(slug)) { errors.push(`duplicate target slug: ${slug}`); continue; }
    seen.add(slug);
    const dir = join(cwd, slug);
    const claude = join(dir, "CLAUDE.md");
    const agents = join(dir, "AGENTS.md");
    const marker = existsSync(claude) ? claude : existsSync(agents) ? agents : null;
    if (!marker) { errors.push(`target '${slug}' is not a sibling dir with CLAUDE.md/AGENTS.md under ${cwd}`); continue; }
    let abs = marker; try { abs = realpathSync(marker); } catch { /* keep marker */ }
    ok.push({ slug, marker: abs });
  }
  return { ok, errors };
}
```

(If `detectMultiRepo`'s `RepoHit` field is named differently than `{slug, marker}`, match it exactly —
re-read `multirepo.ts:5`. The grounding confirms `RepoHit { slug: string; marker: string }`.)

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `"feat(score): validateTargets (slug-regex + sibling marker + dedup -> RepoHit[])"`

---

### Task 2: `writeTargetsTsv` (core/score.ts)

**Files:** Modify `src/core/score.ts`; Test `tests/score-core.test.ts`

The TSV `targets.txt` writer: `# generated <iso> by /consort:score` + one `<slug>\t<marker>` row per
hit. The consumer `parseRosterTargets` already splits on `\t` and takes col 0, so this is
forward-compatible — assert the round-trip.

- [ ] **Step 1: Add failing test (append to `tests/score-core.test.ts`)**

```ts
import { writeTargetsTsv, parseRosterFile } from "../src/core/score.js"; // parseRosterFile already imported; add writeTargetsTsv

describe("writeTargetsTsv", () => {
  it("emits a comment header + TSV rows that parseRosterTargets reads back to slugs", () => {
    const tsv = writeTargetsTsv([{ slug: "api", marker: "/r/api/CLAUDE.md" }, { slug: "web", marker: "/r/web/AGENTS.md" }], "2026-05-29T00:00:00Z");
    expect(tsv).toContain("# generated 2026-05-29T00:00:00Z by /consort:score");
    expect(tsv).toContain("api\t/r/api/CLAUDE.md");
    // the (private) parseRosterTargets is exercised end-to-end via score assemble; here assert the row shape
    expect(tsv.trim().split("\n").filter((l) => !l.startsWith("#"))).toEqual(["api\t/r/api/CLAUDE.md", "web\t/r/web/AGENTS.md"]);
  });
  it("empty hits → just the header line", () => {
    expect(writeTargetsTsv([], "2026-05-29T00:00:00Z")).toBe("# generated 2026-05-29T00:00:00Z by /consort:score\n");
  });
});
```

- [ ] **Step 2: Run to confirm fail** → FAIL.

- [ ] **Step 3: Implement (append to `src/core/score.ts`)**

```ts
/** targets.txt as TSV: a generated-comment header + one `<slug>\t<abs-marker>` row per hit. The
 *  consumer parseRosterTargets reads col 0 (and tolerates the comment header). */
export function writeTargetsTsv(hits: { slug: string; marker: string }[], isoStamp: string): string {
  return `# generated ${isoStamp} by /consort:score\n` + (hits.length ? hits.map((h) => `${h.slug}\t${h.marker}`).join("\n") + "\n" : "");
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `"feat(score): writeTargetsTsv (TSV targets.txt writer)"`

---

### Task 3: rewire `score init --targets` (validate + TSV)

**Files:** Modify `src/commands/score.ts`; Test `tests/score-init.test.ts`

When `--targets` is passed, validate the slugs (Task 1) against the conductor's repo root and write the
TSV (Task 2) instead of the plain slug list; abort `rc 1` on any invalid slug. Inject the validator via
`ScoreInitDeps` so the test stays hermetic. Mode derivation (>=2 → multi, ==1 → single-sub) is unchanged.

- [ ] **Step 1: Update the test (`tests/score-init.test.ts`)**

The existing `--targets a,b` test will now run validation. Update `ScoreInitDeps`'s test factory to
supply `validateTargets`, and assert the TSV write:

```ts
function deps(providers: string[], picks: string[], targetVal?: (slugs: string[]) => { ok: { slug: string; marker: string }[]; errors: string[] }): ScoreInitDeps {
  return {
    activeProviders: () => providers, isValidated: () => true, pickInstruments: () => picks,
    validateTargets: targetVal ?? ((slugs) => ({ ok: slugs.map((s) => ({ slug: s, marker: `/r/${s}/CLAUDE.md` })), errors: [] })),
  };
}
```

Replace the existing `--targets a,b` test body with:
```ts
  it("--targets a,b → validates, writes TSV targets.txt + multi-repo.txt=multi", async () => {
    await initWith(["--targets", "api,web", "refactor"], deps(["codex", "claude"], ["viola", "cello"]));
    const art = scoreArtDir("refactor");
    expect(readFileSync(join(art, "multi-repo.txt"), "utf8").trim()).toBe("multi");
    const t = readFileSync(join(art, "targets.txt"), "utf8");
    expect(t).toContain("api\t/r/api/CLAUDE.md"); // TSV, not plain slug
  });
  it("--targets with an invalid slug → rc 1, no scaffold", async () => {
    const rc = await initWith(["--targets", "ghost", "x"],
      deps(["codex", "claude"], ["viola", "cello"], () => ({ ok: [], errors: ["target 'ghost' is not a sibling dir ..."] })));
    expect(rc).toBe(1);
  });
```

- [ ] **Step 2: Run to confirm fail** → FAIL.

- [ ] **Step 3: Implement** — extend `ScoreInitDeps` + `liveInitDeps` + `initWith`:

```ts
// add the import:
import { detectMultiRepo, validateTargets, type RepoHit } from "../core/multirepo.js";
import { writeTargetsTsv } from "../core/score.js"; // add to the existing ../core/score.js import
import { repoRoot } from "../core/paths.js"; // already imported in Phase C

export interface ScoreInitDeps {
  activeProviders(): string[];
  isValidated(provider: string): boolean;
  pickInstruments(topic: string, n: number): string[];
  validateTargets(slugs: string[]): { ok: RepoHit[]; errors: string[] };
}
const liveInitDeps: ScoreInitDeps = {
  activeProviders: () => readProviderList(activeProvidersPath()),
  isValidated: instrumentConsultValidated,
  pickInstruments,
  validateTargets: (slugs) => validateTargets(repoRoot(), slugs),
};
```

In `initWith`, replace the `targets.length > 0` plain-slug write with validation + TSV. Find:
```ts
  const mode = targets.length >= 2 ? "multi" : targets.length === 1 ? "single-sub" : "single";
  atomicWrite(join(art, "multi-repo.txt"), mode + "\n");
  if (targets.length > 0) atomicWrite(join(art, "targets.txt"), `# generated ${isoUtc()} by /consort:score\n${targets.join("\n")}\n`);
```
Replace with:
```ts
  let hits: RepoHit[] = [];
  if (targets.length > 0) {
    const v = d.validateTargets(targets);
    if (v.errors.length) { for (const e of v.errors) log.error(`score init: ${e}`); return 1; }
    hits = v.ok;
  }
  const mode = hits.length >= 2 ? "multi" : hits.length === 1 ? "single-sub" : "single";
  atomicWrite(join(art, "multi-repo.txt"), mode + "\n");
  if (hits.length > 0) atomicWrite(join(art, "targets.txt"), writeTargetsTsv(hits, isoUtc()));
```
(Note: the scaffold dir is created earlier; if validation should run *before* scaffolding to avoid a
leftover art dir on bad targets, move the validation block above the `mkdirSync(scoreDraftDir...)` call.
Do that — validate first, then scaffold.)

- [ ] **Step 4: Run** `npx vitest run tests/score-init.test.ts` → PASS. **Step 5: Commit** —
  `"feat(score): init --targets validates slugs + writes TSV targets.txt"`

---

### Task 4: `score detect-multi-repo`

**Files:** Modify `src/commands/score.ts`; Test `tests/score-escalation.test.ts`

Wire `detectMultiRepo`: read `adjudicated.md` (fallback `topic.txt`) as corpus, scan the conductor's cwd
(default `process.cwd()`, overridable `--cwd <abs>` for the hub), print TSV hits to stdout. The directive
counts hits + drives the 0/1/2+ branches (Task 6).

- [ ] **Step 1: Add failing test (append to `tests/score-escalation.test.ts`)**

```ts
import { detectMultiRepoRun } from "../src/commands/score.js";

describe("score detect-multi-repo", () => {
  it("emits TSV hits for sibling dirs whose slug substring-matches the corpus", async () => {
    const art = scoreArtDir("t"); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "adjudicated.md"), "## Cross-verified\n- [x] touches api and web modules\n");
    // build a hub with api/web (markers) + an unrelated dir
    const hub = mkdtempSync(join(tmpdir(), "hub-"));
    for (const s of ["api", "web"]) { mkdirSync(join(hub, s)); writeFileSync(join(hub, s, "CLAUDE.md"), "x\n"); }
    mkdirSync(join(hub, "zzz")); writeFileSync(join(hub, "zzz", "CLAUDE.md"), "x\n");
    let out = ""; const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    try { await detectMultiRepoRun(["t", "--cwd", hub]); } finally { (process.stdout as any).write = orig; }
    expect(out).toContain("api\t");
    expect(out).toContain("web\t");
    expect(out).not.toContain("zzz\t"); // slug not in corpus
  });
});
```
(Import `mkdtempSync` + `tmpdir` at the top of the test file if not already present.)

- [ ] **Step 2: Run to confirm fail** → FAIL.

- [ ] **Step 3: Implement** — dispatch `case "detect-multi-repo"` + handler:

```ts
export async function detectMultiRepoRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: score detect-multi-repo <topic> [--cwd <abs>]"); return 2; }
  let cwd = process.cwd();
  const ci = rest.indexOf("--cwd");
  if (ci >= 0 && rest[ci + 1]) cwd = rest[ci + 1];
  const art = scoreArtDir(topic);
  const adj = join(art, "adjudicated.md");
  const corpus = existsSync(adj) ? readFileSync(adj, "utf8")
    : existsSync(join(art, "topic.txt")) ? readFileSync(join(art, "topic.txt"), "utf8") : "";
  if (!corpus) log.warn(`score detect-multi-repo: no adjudicated.md/topic.txt corpus at ${art}; scanning anyway`);
  const hits = detectMultiRepo(cwd, corpus);
  for (const h of hits) process.stdout.write(`${h.slug}\t${h.marker}\n`);
  log.ok(`score detect-multi-repo: ${hits.length} hit(s) under ${cwd}`);
  return 0;
}
```
(`detectMultiRepo` is imported in Task 3. Add `detect-multi-repo` to the dispatch switch + the top-level
usage string.)

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `"feat(score): detect-multi-repo subcommand (wire detectMultiRepo, emit TSV hits)"`

---

### Task 5: DAG CLI pair — `dagMalformedLines` + `score emit-dag` + `score check-dag`

**Files:** Modify `src/core/dag.ts`, `src/commands/score.ts`; Test `tests/dag.test.ts`, `tests/score-escalation.test.ts`

`dagMalformedLines(docText)` returns the numbered `## Execution DAG` lines that fail `parseDagLine`
(for the gate's stderr). `emit-dag` reads `$ART/dag-rows.tsv` (4-col `step\trepo\tdesc\tdeps`, the
directive builds it from cross-repo findings) → `emitSoftDag` → writes `.draft/execution-dag.md` =
`## Execution DAG\n\n<rendered>\n`. `check-dag` reads that draft, runs `checkDagSection`, rc 0/1 +
malformed lines on stderr. **No executor.**

- [ ] **Step 1: Add failing tests**

`tests/dag.test.ts`:
```ts
import { dagMalformedLines } from "../src/core/dag.js"; // add to imports

describe("dagMalformedLines", () => {
  const ok = "## Execution DAG\n\n1. api — build it\n2. web — ship it (depends on 1)\n";
  const bad = "## Execution DAG\n\n1. api - build it\n2. web — ok\n"; // line 1 uses a hyphen, not em-dash
  it("returns [] for a conformant section and the bad line otherwise", () => {
    expect(dagMalformedLines(ok)).toEqual([]);
    expect(dagMalformedLines(bad)).toEqual(["1. api - build it"]);
  });
  it("absent section / narrative-only → []", () => {
    expect(dagMalformedLines("## Architecture\n\nstuff\n")).toEqual([]);
    expect(dagMalformedLines("## Execution DAG\n\nfree prose, no numbered lines\n")).toEqual([]);
  });
});
```

`tests/score-escalation.test.ts`:
```ts
import { emitDagRun, checkDagRun } from "../src/commands/score.js";

describe("score emit-dag + check-dag", () => {
  it("emit-dag renders dag-rows.tsv to the execution-dag draft; check-dag passes it", async () => {
    const art = scoreArtDir("t"); mkdirSync(join(art, "design-doc", ".draft"), { recursive: true });
    writeFileSync(join(art, "dag-rows.tsv"), "1\tapi\tbuild the API\tnone\n2\tweb\tship the web app\t1\n");
    expect(await emitDagRun(["t"])).toBe(0);
    const draft = readFileSync(join(art, "design-doc", ".draft", "execution-dag.md"), "utf8");
    expect(draft).toMatch(/^## Execution DAG\n/);
    expect(draft).toContain("1. api — build the API");
    expect(draft).toContain("2. web — ship the web app (depends on 1)");
    expect(await checkDagRun(["t"])).toBe(0); // conformant
  });
  it("check-dag rc 1 + malformed line when the draft uses a hyphen", async () => {
    const art = scoreArtDir("t"); mkdirSync(join(art, "design-doc", ".draft"), { recursive: true });
    writeFileSync(join(art, "design-doc", ".draft", "execution-dag.md"), "## Execution DAG\n\n1. api - bad dash\n");
    const errs: string[] = []; const s = process.stderr.write.bind(process.stderr);
    (process.stderr as any).write = (x: string) => { errs.push(String(x)); return true; };
    let rc = 0; try { rc = await checkDagRun(["t"]); } finally { (process.stderr as any).write = s; }
    expect(rc).toBe(1);
    expect(errs.join("")).toContain("1. api - bad dash");
  });
});
```

- [ ] **Step 2: Run to confirm fail** → FAIL.

- [ ] **Step 3: Implement**

In `src/core/dag.ts`, add (reusing the section-range logic already inside `checkDagSection` — extract a
shared `dagSectionLines(docText): string[]` if convenient, else inline the same `^## Execution DAG[ \t]*$`
range + `/^[ \t]*\d+\./` numbered-line filter):
```ts
/** The numbered `## Execution DAG` lines that fail parseDagLine (for the pre-Approve gate's stderr).
 *  Mirrors checkDagSection's range + numbered-line detection; absent section / narrative-only → []. */
export function dagMalformedLines(docText: string): string[] {
  const bad: string[] = [];
  let inDag = false;
  for (const line of docText.split("\n")) {
    if (/^## Execution DAG[ \t]*$/.test(line)) { inDag = true; continue; }
    if (/^## /.test(line)) { inDag = false; continue; }
    if (inDag && /^[ \t]*\d+\./.test(line) && parseDagLine(line) === null) bad.push(line);
  }
  return bad;
}
```
(Ensure `checkDagSection` and `dagMalformedLines` agree exactly — same heading regex, same numbered-line
detector. If you extract a shared helper, route both through it.)

In `src/commands/score.ts`, add the `dag.js` import (`emitSoftDag`, `checkDagSection`, `dagMalformedLines`,
`type SoftDagRow`), dispatch `case "emit-dag"` / `case "check-dag"`, and:
```ts
export async function emitDagRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: score emit-dag <topic>"); return 2; }
  const art = scoreArtDir(topic);
  const rowsPath = join(art, "dag-rows.tsv");
  if (!existsSync(rowsPath)) { log.error(`score emit-dag: ${rowsPath} missing (the directive writes step\\trepo\\tdesc\\tdeps rows)`); return 1; }
  const rows: SoftDagRow[] = readFileSync(rowsPath, "utf8").split("\n")
    .map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => { const [step, repo, desc, deps] = l.split("\t"); return { step, repo, desc, deps: deps ?? "none" }; })
    .filter((r) => r.step && r.repo);
  const draftDir = scoreDraftDir(topic);
  mkdirSync(draftDir, { recursive: true });
  atomicWrite(join(draftDir, "execution-dag.md"), `## Execution DAG\n\n${emitSoftDag(rows)}\n`);
  log.ok(`score emit-dag: wrote execution-dag.md (${rows.length} steps)`);
  return 0;
}

export async function checkDagRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: score check-dag <topic>"); return 2; }
  const draft = join(scoreDraftDir(topic), "execution-dag.md");
  if (!existsSync(draft)) { log.error(`score check-dag: ${draft} missing (run score emit-dag first / draft the section)`); return 1; }
  const text = readFileSync(draft, "utf8");
  if (checkDagSection(text)) { log.ok("score check-dag: Execution DAG parses"); return 0; }
  for (const l of dagMalformedLines(text)) process.stderr.write(l + "\n");
  log.error("score check-dag: Execution DAG has malformed numbered lines (see above)");
  return 1;
}
```
**Do NOT** add any topological/wave/repo-dedup/fan-in logic or write any `dag-*.tsv` output — that is
perform's executor, out of scope.

- [ ] **Step 4: Run** `npx vitest run tests/dag.test.ts tests/score-escalation.test.ts && npm run typecheck && npm run lint` → PASS/clean.
- [ ] **Step 5: Commit** — `"feat(score): dag CLI pair (emit-dag, check-dag) + dagMalformedLines reporter"`

---

### Task 6: `commands/score.md` — Stage 1 routing flip + Stage 10 detection

**Files:** Modify `commands/score.md`

Replace the Phase B/C `--targets`/multi "stop, needs Phase E" branch (Stage 1) with live routing into
the multi pipeline, and replace the Stage 10 single-repo note with the real detection step.

- [ ] **Step 1: Flip Stage 1 routing.** In the Stage 1 "Routing → next stage" blockquote, change the
  `escalate and MODE is multi / single-sub` bullet from "stop" to:
  > - **escalate and `MODE` is `multi` / `single-sub`** (`--targets` was passed): proceed into the
  >   multi-repo ensemble — Stages 3–9 run unchanged (research → diff → cross-verify → adjudicate), then
  >   Stage 10 honors the `--targets` short-circuit (targets already materialized) and Stage 11 walks the
  >   8 sections. `--targets` is itself the escalation signal (skip the fast-path 4-signal check).

  Keep single-repo Stage 1 → 2/3 routing unchanged.

- [ ] **Step 2: Replace Stage 10 (the "MODE=single … Phase E" note) with the detection step:**

```markdown
## Stage 10 — multi-repo detection

If `--targets` was passed, `$ART/multi-repo.txt` + `$ART/targets.txt` already exist (written by `init`
after validation) — **skip detection** and go to Stage 11.

Otherwise auto-detect: `$CS score detect-multi-repo <TOPIC> --cwd <HUB>` (HUB = the workspace dir whose
first-level subdirs are the candidate sub-projects; default is the conductor's cwd). It prints
`<slug>\t<abs-marker>` per sibling dir (with CLAUDE.md/AGENTS.md) whose slug case-insensitively
substring-matches `adjudicated.md`. Count the hit lines and branch:

- **0 hits** → single-repo. Write `single` to `$ART/multi-repo.txt` (no `targets.txt`, no prompt).
  Continue to Stage 11 (6-section walk).
- **1 hit** → **AskUserQuestion** (Header `Target`): "Topic targets sub-project `<slug>` (detected from
  sibling repos). Use it as the single sub-repo target, or treat as hub-level work?" — options
  **Use `<slug>`** / **Treat as hub-level**.
  - Use `<slug>` → write that hit's `<slug>\t<marker>` to `$ART/targets.txt` (TSV) + `single-sub` to
    `$ART/multi-repo.txt`.
  - Treat as hub-level → `single` to `$ART/multi-repo.txt`, no `targets.txt`.
- **2+ hits** → **AskUserQuestion**: "Detected multi-repo candidates: `<slug list>`. Use these as
  targets, edit, or proceed single-repo?" — options **Use auto-detected list** / **Edit list** /
  **Proceed single-repo**.
  - Use list → write all hits (TSV) to `targets.txt` + `multi` to `multi-repo.txt`.
  - Edit list → free-form follow-up for a comma-separated slug list; **re-run `init`-style validation**
    (each slug must be a real sibling dir with a marker — reuse the same checks) and re-prompt on
    rejection; then **N≥2 edited slugs → `multi`, exactly 1 → `single-sub`** (an edit-down-to-1 is
    single-sub, NOT multi). Write `targets.txt` (TSV) accordingly.
  - Proceed single-repo → `single`, no `targets.txt`.

The `targets.txt` rows are TSV `<slug>\t<abs-marker>` (the same shape `detect-multi-repo`/`init` emit);
the comment header is optional. After this stage, `multi-repo.txt` ∈ {single, single-sub, multi}.
```

- [ ] **Step 3: Stale-token check** of the new prose (`grep -niE 'trooper|commander|master.yoda|cw_|clone-wars' commands/score.md`) — fix any leak.
- [ ] **Step 4: Commit** — `"feat(score): score.md Stage 1 flip + Stage 10 multi-repo detection"`

---

### Task 7: `commands/score.md` — Stage 11 8-section walk + execution-DAG gate

**Files:** Modify `commands/score.md`

Add the multi-repo branch to the Stage 11 walk. Single-repo (6 sections) is unchanged.

- [ ] **Step 1: Add the multi-repo walk** after the single-repo Stage 11 body:

```markdown
### Stage 11 (multi-repo): the 8-section walk

When `multi-repo.txt` ∈ {single-sub, multi}: after `score synthesize` (still seeds the 6 base sections),
walk **the multi section list** — for `multi`, all 8 in this exact order (must match `SECTIONS_MULTI`):
**problem, goal, architecture, components, execution-dag, cross-repo-notes, testing, success-criteria**
(single-sub uses the 6 base sections + the singular header). The 2 multi-only sections
(`execution-dag`, `cross-repo-notes`) have **no synthesize seed** — draft them fresh. Resume via
`$CS score walk-state <TOPIC>`. Per-section rules:

- **architecture** (multi): draft a `### <slug>` subsection per target (read `$ART/targets.txt` for the
  slug list) plus any shared/hub architecture. (Required — no Skip.)
- **cross-repo-notes**: a normal narrative section (Skip allowed) — per-target dependencies, ordering
  constraints, shared contracts drawn from the parts' findings.
- **execution-dag**: the special gated section (below). (No Skip.)
- All other sections: exactly as the single-repo walk (the 4 required sections never offer Skip).

**execution-dag drafting + pre-Approve gate** (mirrors clone-wars' v0.54.0 gate; no executor):
1. From the parts' cross-repo-dependency findings, **Write** `$ART/dag-rows.tsv` — one tab-separated
   `<step>\t<repo>\t<desc>\t<deps-csv|none>` row per step (`deps` = comma-separated upstream step
   numbers, or `none`). Then `$CS score emit-dag <TOPIC>` renders `.draft/execution-dag.md` as a
   `## Execution DAG` section (numbered `N. <repo> — <desc> (depends on M, N)` lines, em-dash U+2014).
2. **Pre-validate before presenting:** `$CS score check-dag <TOPIC>`.
   - **rc 0** → present the section; **AskUserQuestion Approve / Revise** (NO Skip — execution-dag is
     required in multi-repo).
   - **rc 1** → it printed the malformed line(s) to stderr. Do **not** offer the normal options; instead
     **AskUserQuestion**: **Revise** / **Force-Approve (override)** / **Abort**.
     - Revise → take direction, rewrite `dag-rows.tsv`, re-run `emit-dag`, re-loop the gate (cap 4 revises).
     - Force-Approve → keep the non-conforming draft as-is; the Stage-12 audit
       (`execution_dag_not_parseable`) will catch it.
     - Abort → stop the walk.
3. The drafted heading MUST be exactly `## Execution DAG` (a decorated heading silently disables the
   gate). score validates conformance only — it does NOT topo-sort, compute waves, or detect cycles
   (a cyclic-but-valid DAG passes here and surfaces only at perform time).
```

- [ ] **Step 2: Stale-token check** + confirm the 8-section order matches `SECTIONS_MULTI` exactly.
- [ ] **Step 3: Commit** — `"feat(score): score.md Stage 11 8-section walk + execution-dag gate"`

---

### Task 8: `commands/score.md` — Stage 12 multi audit bounce + rebuild dist

**Files:** Modify `commands/score.md`; regenerate `dist/consort.cjs`; verify `tests/stale-tokens.test.ts`

- [ ] **Step 1: Extend Stage 12** for the two multi-only `SECTION=` routes (the single-repo handling is
  unchanged; `assemble` already emits `SECTION=` for every issue):

```markdown
### Stage 12 (multi-repo): audit bounce

`score assemble` runs the deploy-audit gate on the multi doc (plural `**Target Sub-Project(s):**` header,
8 sections). On `rc 1`, in addition to the single-repo `SECTION=` routes, handle:
- **`SECTION=execution-dag`** (from `execution_dag_not_parseable`) → `rm $ART/design-doc/.draft/execution-dag.md`,
  re-walk that one section (re-runs the Stage-11 emit-dag + check-dag gate), re-assemble.
- **`SECTION=header`** (from `target_subproject_when_invalid`, a **single-sub** slug-validity failure —
  the plural multi header is descriptive and not audited as a slug) → `rm -f $ART/multi-repo.txt
  $ART/targets.txt` and **bounce back to Stage 10** detection, then re-walk + re-assemble.
Loop until `rc 0` (bounded per section; then surface remaining ISSUEs and stop).
```

- [ ] **Step 2: Update the closing Notes** "later phases" bullet: Stages 3–12 (single + multi-repo) ship
  in Phases C–E; drilldown / forensics / teardown / present (Phase F) remain.
- [ ] **Step 3: Rebuild** — `npm run build` (commit the refreshed `dist/consort.cjs`).
- [ ] **Step 4: Stale-token gate + full suite** — `npx vitest run tests/stale-tokens.test.ts && npm run test`.
  Fix any leaked banned token in the new prose/core (never weaken the gate).
- [ ] **Step 5: Commit** — `"feat(score): score.md Stage 12 multi audit bounce + rebuild dist"`

---

### Task 9: Full gate + live multi-repo dogfood + DOGFOOD.md

**Files:** verify gates; modify `docs/superpowers/DOGFOOD.md`

- [ ] **Step 1: Full gate** — `npm run typecheck && npm run lint && npm run test` (all green; the new
  `validateTargets`/`writeTargetsTsv`/`dagMalformedLines`/`detect-multi-repo`/`emit-dag`/`check-dag`
  suites + the updated `score-init` `--targets` cases).

- [ ] **Step 2: Live multi-repo dogfood (inside tmux, isolated home).** Fixture: a hub dir with ≥2
  sibling sub-project dirs each carrying `CLAUDE.md`/`AGENTS.md` whose slugs appear in the topic. The
  `/home/liupan/CC` workspace is the natural fixture (siblings `iris-code`, `clone-wars`,
  `hermes-agent`, `consort` — each has `CLAUDE.md`). Run a topic spanning two of them (e.g. "how
  clone-wars and consort both gate part spawning"). Drive:
  1. `score init --ensemble --targets clone-wars,consort <topic>` (validates the two slugs against the
     hub, writes TSV `targets.txt` + `multi-repo.txt=multi`) — OR omit `--targets` and let **Stage 10
     detection** find them from `adjudicated.md` (exercise the 2+-hit AskUserQuestion → Use list).
  2. spawn-all → research → diff → verify → adjudicate → resolve PENDING (Phases C–D, proven).
  3. Stage 11 multi walk: architecture drafts `### clone-wars` + `### consort`; write `dag-rows.tsv` from
     the cross-repo deps; `emit-dag` → `check-dag` (PASS); cross-repo-notes; the 4 required sections.
  4. `assemble` → audit **PASS** with the plural `**Target Sub-Project(s):** clone-wars, consort` header
     and a parseable `## Execution DAG`. Force one malformed DAG (a hyphen) to confirm the gate bounces
     (`check-dag` rc 1 → Revise → fix → PASS), then `coda` the parts.

- [ ] **Step 3: Verify artifacts** — `multi-repo.txt=multi`; `targets.txt` TSV with both markers; the
  doc has the plural header, `### <slug>` architecture subsections, a `## Execution DAG` whose numbered
  lines all `parseDagLine` (confirm: `node dist/consort.cjs score check-dag <topic>` rc 0); `audit.log`
  `VERDICT=PASS`. Confirm **no** `dag-waves.txt`/`dag-edges.txt` were written (no executor ran).

- [ ] **Step 4: Append the Phase E dogfood section to `docs/superpowers/DOGFOOD.md`** — fixture, targets,
  detection path (--targets vs auto), the DAG (steps + a deps edge), the gate bounce, header, PASS/FAIL.

- [ ] **Step 5: Commit** — `"docs(score): Phase E live dogfood (multi-repo detect -> 8-section walk -> DAG -> audit)"`

---

## Final review (after all tasks)

Holistic reviewer over the Phase E diff. Confirm: `validateTargets` reuses `SLUG_REGEX` and matches
`detectMultiRepo`'s marker resolution; `detect-multi-repo` preserves the loose substring semantics;
`emit-dag` output round-trips through `parseDagLine` and stays path-free + em-dash; `check-dag` uses
`checkDagSection`/`dagMalformedLines` ONLY (no topo/waves/cycle/TSV-executor); the Stage-11 8-section
order matches `SECTIONS_MULTI` byte-for-byte; the `header` bounce is documented as a single-sub safeguard;
edit-down-to-1 → single-sub; the `## Execution DAG` heading is bare; no frozen token renamed; stale-token
gate green; `dist` in sync. Then keep the branch (user's "PR later") and continue to **Phase F**.
