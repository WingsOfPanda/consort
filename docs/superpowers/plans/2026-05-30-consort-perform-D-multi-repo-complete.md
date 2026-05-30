# consort `perform` Phase D — multi-repo verify / fix / finish COMPLETE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task (fresh implementer per task + two-stage review). Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the multi-repo path of `perform` — cross-repo final verification, the
adjacent-tree (sibling) commit guard with revert-and-replay recovery, the multi-repo fix-loop,
per-repo finish, and multi-repo teardown/archive — then refresh the repo phase guard. After this
phase `perform` is COMPLETE (single-repo + multi-repo, both paths end-to-end).

**Architecture:** Five thin CLI verbs wire the already-built Phase-A `core/performSibling.ts`
helpers and existing infra (`dagFanInRepos`, `iterTargets`, `finishBranchAction`,
`extractComponentsPaths`); the genuinely-new work is the multi-repo directive (`commands/perform.md`
Stages 3c / 3d / 4-multi) that orchestrates them. Per-repo summary and finish already iterate
`iterTargets` (built in Phase B/C); Phase D adds per-repo *granularity* (`finish-one`) and the
multi-repo scope-check + sibling guard. tmux/git stay pure arg-array builders behind an injected
`Runner`; no real panes/git in unit tests (live behavior = the dogfood).

**Tech Stack:** TypeScript (ES2022/NodeNext/strict), vitest, esbuild → committed `dist/consort.cjs`,
execa for git, `CONSORT_HOME` test isolation (`tests/helpers/tmpHome.ts`).

**Behavioral spec (byte-faithful source of truth):** `clone-wars/lib/deploy-sibling.sh`,
`clone-wars/bin/deploy-sibling-baseline.sh`, `clone-wars/bin/deploy-sibling-verify.sh`,
`clone-wars/commands/deploy.md` Steps 3c (1053-1119) / 3d (1121-1200) / 4 (1202-1472). Preserve
*behavior*, not *implementation*; grep by symbol (line numbers drift). The musical rebrand
(§"musical rebrand" in `consort/CLAUDE.md`) and the FROZEN protocol apply; the
`tests/stale-tokens.test.ts` gate must stay green (it bans `trooper`/`commander`/`cw_`/`deploy.sh`
literals in shipped `src`/`commands` — cite the prior plugin as `deploy-*.sh:NN` in JSDoc, never
the literal banned tokens).

---

## Grounding notes (resolved divergences — read before coding)

1. **`formatRogueBlock` is dead in shipped code and NOT byte-faithful.** Phase A's
   `performSibling.ts` exports `formatRogueBlock(slug, log)` → `<slug>\n<log>\n` (block format). The
   clone-wars `deploy-sibling-verify.sh` writes **per-commit TSV** `<slug>\t<sha>\t<subject>` (one
   row per rogue commit). `sibling-verify` (Task D1) MUST emit the per-commit TSV — do NOT call
   `formatRogueBlock`. Leave `formatRogueBlock` untouched (it is exported + unit-tested in Phase A;
   removing it is out of scope for Phase D).

2. **`sibling-rogue.txt` row order is newest-first.** `git log <base>..<branch> --oneline` lists
   newest-first; `sibling-verify` writes rows in that order. `sibling-rescue` (Task D2) groups SHAs
   per slug **in file order** (deploy.md:1244-1248 does the same — `ROGUE_BY_SLUG["$slug"]+="$sha "`)
   and passes the list verbatim to `revertAndReplay`. This preserves deploy's actual behavior; do not
   re-sort.

3. **No bash libs to source → revert-and-replay is a verb.** deploy.md invokes
   `cw_deploy_revert_and_replay` *inline* by sourcing `deploy-sibling.sh` (no bin script). consort has
   no shell libs, so the directive cannot call the TS helper inline — Phase D exposes it as the
   `perform sibling-rescue` verb (Task D2).

4. **Per-part baseline SHA = `baselines/<slug>.tsv` field `baseline_sha`.** deploy reads
   `$ART_DIR/$cmdr-branch-base.sha`; consort stores per-target baselines under
   `baselines/<slug>.tsv` (written by `pre-snapshot`/`branch`, fields `slug/cwd/branch/baseline_sha/
   state/snapshot_ts`). Use `kvFileField(join(art,"baselines",`${slug}.tsv`), "baseline_sha")` — the
   single `branch-base.sha` file is last-target-wins for multi and must NOT be used per-repo.

5. **`iterTargets` for multi:** `slug` = instrument name, `cwd` = sub-repo cwd; the repo name is
   `basename(cwd)`. Declared sibling exclusions = `iterTargets(topic).map(t => basename(t.cwd))`.

6. **Per-repo finish.** `finishWith(topic, action)` already applies ONE action to ALL targets
   (truncates `finish-results.tsv`, loops `iterTargets`). The spec requires a finish **menu per
   target** (different actions per repo possible), so Task D5 adds `finish-one <topic> <slug>
   <action>` (single target, **append**, no truncate); the directive truncates `finish-results.tsv`
   once, then calls `finish-one` per repo. `finishWith` stays the "apply-to-all" path (single-repo
   Stage 4 + multi-repo "apply to all" convenience) and its existing tests must stay green.

---

## File structure

- **Modify** `src/commands/perform.ts` — add verbs `sibling-baseline`, `sibling-verify`,
  `sibling-rescue`, `cross-signal`, `finish-one`; make `scope-check` multi-repo-aware; register all
  in the `run()` switch and `usage()`.
- **Create** `tests/perform-sibling-verbs.test.ts` — D1/D2 verb tests (baseline/verify/rescue).
- **Create** `tests/perform-cross-signal.test.ts` — D3 tests.
- **Modify** `tests/perform-scope-check.test.ts` (or create if absent) — D4 multi-repo cases (keep
  single-repo cases green).
- **Modify** `tests/perform-finish.test.ts` (or create) — D5 `finish-one` cases (keep `finishWith`
  cases green).
- **Modify** `commands/perform.md` — replace Stage 3z with Stages 3c / 3d / 4-multi; add the
  sibling-baseline capture to Stage 3a; update the Task list.
- **Rebuild + commit** `dist/consort.cjs` (Task D6).
- **Modify** `CLAUDE.md` (repo root) — refresh the phase guard (Task D7).
- **Append** `docs/superpowers/DOGFOOD.md` — Phase D dogfood result (Task D8).

All five verbs follow the established house pattern: a `*Run(rest)` arg-validator that returns the
usage rc (2) on missing args and delegates to an exported `*With(...)` taking a `Deps` interface
with `runnerFor(cwd): Runner` (injected for tests). Add to `src/commands/perform.ts` near the other
verbs. Required new imports at the top of `perform.ts`:

```ts
import {
  enumerateSiblings, captureSiblingBaseline, formatBaselineFile,
  parseBaselineFile, diffSiblingAgainstBaseline, revertAndReplay,
} from "../core/performSibling.js";
```
and extend the existing `../core/dag.js` import to add `dagFanInRepos`.

---

## Task D1: `sibling-baseline` + `sibling-verify` verbs

**Files:**
- Modify: `src/commands/perform.ts`
- Test: `tests/perform-sibling-verbs.test.ts` (create)

Byte-faithful port of `bin/deploy-sibling-baseline.sh` + `bin/deploy-sibling-verify.sh`. Wires the
Phase-A `enumerateSiblings`/`captureSiblingBaseline`/`formatBaselineFile`/`parseBaselineFile`/
`diffSiblingAgainstBaseline` helpers. `sibling-verify` writes **per-commit TSV** (Grounding note 1).

- [ ] **Step 1: Write the failing test** — `tests/perform-sibling-verbs.test.ts`

```ts
// tests/perform-sibling-verbs.test.ts — D1/D2: sibling-baseline / sibling-verify / sibling-rescue verbs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import {
  siblingBaselineWith, siblingVerifyWith, siblingRescueWith, type SiblingDeps,
} from "../src/commands/perform.js";
import type { Runner, RunResult } from "../src/core/gitwork.js";

// A scripted Runner: maps a cwd to a queue/lookup of git responses keyed by the joined argv.
function scriptRunner(table: Record<string, Record<string, RunResult>>): (cwd: string) => Runner {
  return (cwd: string): Runner => ({
    run(_cmd: string, args: string[]): RunResult {
      const key = args.join(" ");
      const forCwd = table[cwd] ?? {};
      return forCwd[key] ?? { code: 0, stdout: "", stderr: "" };
    },
  });
}
const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
const fail = (): RunResult => ({ code: 1, stdout: "", stderr: "" });

describe("perform sibling-baseline / sibling-verify", () => {
  let h: { home: string; cleanup: () => void };
  let art: string;
  let hub: string;
  beforeEach(() => {
    h = freshHome();
    art = performArtDir("topic-d");
    mkdirSync(art, { recursive: true });
    // Two declared parts (api, web) + two real sibling repos (libx, oldcli) + one non-repo (docs).
    hub = join(h.home, "hub");
    for (const slug of ["api", "web", "libx", "oldcli"]) mkdirSync(join(hub, slug, ".git"), { recursive: true });
    mkdirSync(join(hub, "docs"), { recursive: true });
    // parts.txt: declared targets api, web (instrument\tcwd\tprovider).
    writeFileSync(join(art, "parts.txt"),
      `oboe\t${join(hub, "api")}\tcodex\nviola\t${join(hub, "web")}\tcodex\n`);
  });
  afterEach(() => h.cleanup());

  it("sibling-baseline enumerates undeclared sibling repos, captures each HEAD, writes TSV", async () => {
    const deps: SiblingDeps = {
      runnerFor: scriptRunner({
        [join(hub, "libx")]: {
          "rev-parse --git-dir": ok(".git"),
          "symbolic-ref --short HEAD": ok("main\n"),
          "rev-parse HEAD": ok("aaaa111\n"),
        },
        [join(hub, "oldcli")]: {
          "rev-parse --git-dir": ok(".git"),
          "symbolic-ref --short HEAD": ok("master\n"),
          "rev-parse HEAD": ok("bbbb222\n"),
        },
      }),
    };
    const rc = await siblingBaselineWith("topic-d", hub, deps);
    expect(rc).toBe(0);
    // libx + oldcli captured (api/web excluded as declared; docs excluded as non-repo); sorted.
    expect(readFileSync(join(art, "sibling-baseline.txt"), "utf8"))
      .toBe("libx\taaaa111\tmain\noldcli\tbbbb222\tmaster\n");
  });

  it("sibling-baseline rc 1 when hub-cwd is not a directory", async () => {
    const deps: SiblingDeps = { runnerFor: scriptRunner({}) };
    expect(await siblingBaselineWith("topic-d", join(h.home, "nope"), deps)).toBe(1);
  });

  it("sibling-verify writes per-commit TSV <slug>\\t<sha>\\t<subject> for rogue commits", async () => {
    writeFileSync(join(art, "sibling-baseline.txt"), "libx\taaaa111\tmain\noldcli\tbbbb222\tmaster\n");
    const deps: SiblingDeps = {
      runnerFor: scriptRunner({
        [join(hub, "libx")]: {
          "rev-parse --git-dir": ok(".git"),
          "rev-parse --verify -q aaaa111": ok("aaaa111\n"),
          "rev-parse --verify -q refs/heads/main": ok("main\n"),
          "log aaaa111..refs/heads/main --oneline": ok("c2c2 second rogue\nc1c1 first rogue\n"),
        },
        [join(hub, "oldcli")]: {
          "rev-parse --git-dir": ok(".git"),
          "rev-parse --verify -q bbbb222": ok("bbbb222\n"),
          "rev-parse --verify -q refs/heads/master": ok("master\n"),
          "log bbbb222..refs/heads/master --oneline": ok(""),  // clean
        },
      }),
    };
    const rc = await siblingVerifyWith("topic-d", hub, deps);
    expect(rc).toBe(0);
    // newest-first per git log; oldcli clean → omitted.
    expect(readFileSync(join(art, "sibling-rogue.txt"), "utf8"))
      .toBe("libx\tc2c2\tsecond rogue\nlibx\tc1c1\tfirst rogue\n");
  });

  it("sibling-verify rc 1 when sibling-baseline.txt is absent", async () => {
    const deps: SiblingDeps = { runnerFor: scriptRunner({}) };
    expect(await siblingVerifyWith("topic-d", hub, deps)).toBe(1);
  });

  it("sibling-verify writes empty file when no rogue commits", async () => {
    writeFileSync(join(art, "sibling-baseline.txt"), "libx\taaaa111\tmain\n");
    const deps: SiblingDeps = {
      runnerFor: scriptRunner({
        [join(hub, "libx")]: {
          "rev-parse --git-dir": ok(".git"),
          "rev-parse --verify -q aaaa111": ok("aaaa111\n"),
          "rev-parse --verify -q refs/heads/main": ok("main\n"),
          "log aaaa111..refs/heads/main --oneline": ok(""),
        },
      }),
    };
    expect(await siblingVerifyWith("topic-d", hub, deps)).toBe(0);
    expect(readFileSync(join(art, "sibling-rogue.txt"), "utf8")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/perform-sibling-verbs.test.ts`
Expected: FAIL — `siblingBaselineWith` / `siblingVerifyWith` not exported.

- [ ] **Step 3: Implement the verbs** in `src/commands/perform.ts`

Add the `SiblingDeps` interface, the two `*With` functions, their `*Run` validators, and register
`sibling-baseline` + `sibling-verify` in `run()` and `usage()`. (Note: `isDir` and `kvFileField`
helpers already exist in this file; `basename` and `appendFileSync` are already imported.)

```ts
// ---- sibling guard (deploy-sibling-baseline.sh / deploy-sibling-verify.sh / deploy-sibling.sh) ----
export interface SiblingDeps { runnerFor(cwd: string): Runner; }
const liveSiblingDeps: SiblingDeps = { runnerFor: runnerAt };

async function siblingBaselineRun(rest: string[]): Promise<number> {
  const [topic, hub] = rest;
  if (!topic || !hub) { log.error("usage: perform sibling-baseline <topic> <hub-cwd>"); return 2; }
  return siblingBaselineWith(topic, hub, liveSiblingDeps);
}
export async function siblingBaselineWith(topic: string, hubCwd: string, d: SiblingDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform sibling-baseline: art-dir missing: ${art}`); return 1; }
  if (!isDir(hubCwd)) { log.error(`perform sibling-baseline: hub-cwd not a directory: ${hubCwd}`); return 1; }
  const declared = iterTargets(topic).map((t) => basename(t.cwd)).filter((x) => x.length > 0);
  const { outcome, siblings } = enumerateSiblings(hubCwd, declared);
  if (outcome === "not-a-directory") { log.error(`perform sibling-baseline: hub-cwd not enumerable: ${hubCwd}`); return 1; }
  const rows: string[] = [];
  for (const slug of siblings) {
    const sibCwd = join(hubCwd, slug);
    const res = captureSiblingBaseline(d.runnerFor(sibCwd), sibCwd);
    if (res.outcome === "ok" && res.row) rows.push(res.row);
    else log.warn(`perform sibling-baseline: skipped ${slug} (${res.outcome})`);
  }
  atomicWrite(join(art, "sibling-baseline.txt"), formatBaselineFile(rows));
  log.info(`perform sibling-baseline: ${rows.length} sibling repo(s) captured`);
  return 0;
}

async function siblingVerifyRun(rest: string[]): Promise<number> {
  const [topic, hub] = rest;
  if (!topic || !hub) { log.error("usage: perform sibling-verify <topic> <hub-cwd>"); return 2; }
  return siblingVerifyWith(topic, hub, liveSiblingDeps);
}
export async function siblingVerifyWith(topic: string, hubCwd: string, d: SiblingDeps): Promise<number> {
  const art = performArtDir(topic);
  const baselineFile = join(art, "sibling-baseline.txt");
  if (!existsSync(baselineFile)) { log.error(`perform sibling-verify: no sibling-baseline.txt under ${art} (run sibling-baseline first)`); return 1; }
  const rows = parseBaselineFile(readFileSync(baselineFile, "utf8"));
  const out: string[] = [];
  for (const { slug, sha, branch } of rows) {
    const sibCwd = join(hubCwd, slug);
    const res = diffSiblingAgainstBaseline(d.runnerFor(sibCwd), sha, branch);
    if (res.outcome !== "ok") { log.warn(`perform sibling-verify: diff failed for ${slug} (${res.outcome}); skipping`); continue; }
    for (const line of (res.log ?? "").split("\n")) {
      if (line.length === 0) continue;
      const sp = line.indexOf(" ");
      const csha = sp === -1 ? line : line.slice(0, sp);
      const subject = sp === -1 ? line : line.slice(sp + 1);   // byte-faithful to bash ${line#* }
      out.push(`${slug}\t${csha}\t${subject}`);
    }
  }
  atomicWrite(join(art, "sibling-rogue.txt"), out.length ? out.join("\n") + "\n" : "");
  if (out.length > 0) log.warn(`perform sibling-verify: ${out.length} rogue commit(s) on undeclared sibling main branches`);
  return 0;
}
```

Add to `run()`: `case "sibling-baseline": return siblingBaselineRun(rest);` and
`case "sibling-verify": return siblingVerifyRun(rest);`. Extend `usage()`'s verb list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/perform-sibling-verbs.test.ts` → PASS. Then `npm run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/commands/perform.ts tests/perform-sibling-verbs.test.ts
git commit -m "feat(perform): sibling-baseline + sibling-verify verbs (D1)"
```

---

## Task D2: `sibling-rescue` verb (revert-and-replay wrapper)

**Files:**
- Modify: `src/commands/perform.ts`
- Test: `tests/perform-sibling-verbs.test.ts` (extend)

Byte-faithful port of deploy.md:1242-1261 (the "Revert + replay on feat branch" recovery path).
Wires the Phase-A `revertAndReplay` (which already builds `feat/perform-<topic>-rescue` via
`rescueBranchName`). Groups rogue SHAs per slug in `sibling-rogue.txt` row order (Grounding note 2),
appends `<slug>\trescued|rescue-failed` to `sibling-rescue.txt`.

- [ ] **Step 1: Write the failing test** — append to `tests/perform-sibling-verbs.test.ts`

```ts
describe("perform sibling-rescue", () => {
  let h: { home: string; cleanup: () => void };
  let art: string;
  let hub: string;
  beforeEach(() => {
    h = freshHome();
    art = performArtDir("topic-d");
    mkdirSync(art, { recursive: true });
    hub = join(h.home, "hub");
    mkdirSync(join(hub, "libx", ".git"), { recursive: true });
    writeFileSync(join(art, "sibling-baseline.txt"), "libx\taaaa111\tmain\n");
    writeFileSync(join(art, "sibling-rogue.txt"), "libx\tc2c2\tsecond rogue\nlibx\tc1c1\tfirst rogue\n");
  });
  afterEach(() => h.cleanup());

  it("rescues each rogue slug via revertAndReplay; appends <slug>\\trescued", async () => {
    const calls: string[][] = [];
    const deps: SiblingDeps = {
      runnerFor: (_cwd: string): Runner => ({
        run(_cmd: string, args: string[]): RunResult {
          calls.push(args);
          // revertAndReplay happy path: no pre-existing rescue ref; all git ops succeed.
          if (args[0] === "show-ref") return { code: 1, stdout: "", stderr: "" }; // rescue branch absent
          return { code: 0, stdout: "", stderr: "" };
        },
      }),
    };
    const rc = await siblingRescueWith("topic-d", hub, deps);
    expect(rc).toBe(0);
    expect(readFileSync(join(art, "sibling-rescue.txt"), "utf8")).toBe("libx\trescued\n");
    // revertAndReplay was given the rogue SHAs in file order (c2c2 then c1c1).
    const branchCreate = calls.find((a) => a[0] === "branch");
    expect(branchCreate).toEqual(["branch", "feat/perform-topic-d-rescue", "aaaa111"]);
  });

  it("records rescue-failed when revertAndReplay reports a pre-existing rescue branch", async () => {
    const deps: SiblingDeps = {
      runnerFor: (_cwd: string): Runner => ({
        run(_cmd: string, args: string[]): RunResult {
          if (args[0] === "show-ref") return { code: 0, stdout: "", stderr: "" }; // rescue branch EXISTS → rescue-exists
          return { code: 0, stdout: "", stderr: "" };
        },
      }),
    };
    expect(await siblingRescueWith("topic-d", hub, deps)).toBe(0);
    expect(readFileSync(join(art, "sibling-rescue.txt"), "utf8")).toBe("libx\trescue-failed\n");
  });

  it("rc 1 when sibling-rogue.txt is absent", async () => {
    const h2 = freshHome();
    mkdirSync(performArtDir("t2"), { recursive: true });
    const deps: SiblingDeps = { runnerFor: (_c) => ({ run: () => ({ code: 0, stdout: "", stderr: "" }) }) };
    expect(await siblingRescueWith("t2", join(h2.home, "hub"), deps)).toBe(1);
    h2.cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/perform-sibling-verbs.test.ts -t "sibling-rescue"`
Expected: FAIL — `siblingRescueWith` not exported.

- [ ] **Step 3: Implement** in `src/commands/perform.ts`

```ts
async function siblingRescueRun(rest: string[]): Promise<number> {
  const [topic, hub] = rest;
  if (!topic || !hub) { log.error("usage: perform sibling-rescue <topic> <hub-cwd>"); return 2; }
  return siblingRescueWith(topic, hub, liveSiblingDeps);
}
export async function siblingRescueWith(topic: string, hubCwd: string, d: SiblingDeps): Promise<number> {
  const art = performArtDir(topic);
  const rogueFile = join(art, "sibling-rogue.txt"), baselineFile = join(art, "sibling-baseline.txt");
  if (!existsSync(rogueFile)) { log.error(`perform sibling-rescue: no sibling-rogue.txt under ${art}`); return 1; }
  if (!existsSync(baselineFile)) { log.error(`perform sibling-rescue: no sibling-baseline.txt under ${art}`); return 1; }
  // Group rogue SHAs by slug in sibling-rogue.txt row order (deploy.md:1244-1248).
  const shasBySlug = new Map<string, string[]>();
  const order: string[] = [];
  for (const line of readFileSync(rogueFile, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const [slug, sha] = line.split("\t");
    if (!slug) continue;
    if (!shasBySlug.has(slug)) { shasBySlug.set(slug, []); order.push(slug); }
    if (sha) shasBySlug.get(slug)!.push(sha);
  }
  const baseBySlug = new Map(parseBaselineFile(readFileSync(baselineFile, "utf8")).map((r) => [r.slug, r]));
  const resultRows: string[] = [];
  for (const slug of order) {
    const b = baseBySlug.get(slug);
    if (!b) { log.warn(`perform sibling-rescue: no baseline row for ${slug}; skipping`); continue; }
    const sibCwd = join(hubCwd, slug);
    const res = revertAndReplay(d.runnerFor(sibCwd), topic, b.sha, b.branch, shasBySlug.get(slug)!);
    if (res.outcome === "ok") { log.ok(`perform sibling-rescue: rescued ${slug} (${res.rescue})`); resultRows.push(`${slug}\trescued`); }
    else { log.warn(`perform sibling-rescue: rescue failed for ${slug} (${res.outcome})`); resultRows.push(`${slug}\trescue-failed`); }
  }
  appendFileSync(join(art, "sibling-rescue.txt"), resultRows.length ? resultRows.join("\n") + "\n" : "");
  return 0;
}
```

Add `case "sibling-rescue": return siblingRescueRun(rest);` to `run()` and the verb to `usage()`.

- [ ] **Step 4: Run tests + typecheck** → PASS / 0.
- [ ] **Step 5: Commit**

```bash
git add src/commands/perform.ts tests/perform-sibling-verbs.test.ts
git commit -m "feat(perform): sibling-rescue verb (revert-and-replay) (D2)"
```

---

## Task D3: `cross-signal` verb (the "feels unsafe" heuristic)

**Files:**
- Modify: `src/commands/perform.ts`
- Test: `tests/perform-cross-signal.test.ts` (create)

Byte-faithful port of deploy.md:1063-1085. Computes `WAVE_COUNT` (unique col-1 of `dag-waves.txt`),
`FAN_IN_REPOS` (`dagFanInRepos`), `SHARED_PATHS` (paths in ≥2 parts' diffs, using
`baselines/<slug>.tsv` `baseline_sha`), and `UNSAFE` (= 1 iff WAVE_COUNT≥3 OR fan-in non-empty OR
shared non-empty). Emits all four as KV stdout for the directive. The bug *collection* itself stays
Maestro directive work (Stage 3c) — this verb only computes the deterministic signal.

- [ ] **Step 1: Write the failing test** — `tests/perform-cross-signal.test.ts`

```ts
// tests/perform-cross-signal.test.ts — D3: cross-signal verb (unsafe heuristic).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { performArtDir } from "../src/core/perform.js";
import { crossSignalWith, type CrossSignalDeps } from "../src/commands/perform.js";
import type { Runner, RunResult } from "../src/core/gitwork.js";

function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (c: any) => { buf += String(c); return true; };
  return { text: () => buf, restore: () => { (process.stdout as any).write = orig; } };
}

describe("perform cross-signal", () => {
  let h: { home: string; cleanup: () => void };
  let art: string;
  let out: ReturnType<typeof captureStdout>;
  beforeEach(() => {
    h = freshHome();
    art = performArtDir("sig");
    mkdirSync(join(art, "baselines"), { recursive: true });
    out = captureStdout();
  });
  afterEach(() => { out.restore(); h.cleanup(); });

  it("UNSAFE=0 for a 2-wave, no-fan-in, no-shared-path DAG", async () => {
    // 2 waves, linear: step1 (api) -> step2 (web). No fan-in.
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\t.\tbuild api\n2\t2\tweb\t.\tbuild web\n");
    writeFileSync(join(art, "dag-edges.txt"), "1\t2\n");
    writeFileSync(join(art, "parts.txt"), `oboe\t${join(h.home, "api")}\tcodex\nviola\t${join(h.home, "web")}\tcodex\n`);
    writeFileSync(join(art, "baselines", "oboe.tsv"), "slug=oboe\nbaseline_sha=base_a\n");
    writeFileSync(join(art, "baselines", "viola.tsv"), "slug=viola\nbaseline_sha=base_w\n");
    const deps: CrossSignalDeps = {
      runnerFor: (cwd: string): Runner => ({
        run: (_c, args): RunResult => ({
          code: 0,
          stdout: cwd.endsWith("api") ? "src/a.ts\n" : "src/w.ts\n",  // disjoint paths
          stderr: "",
        }),
      }),
    };
    const rc = await crossSignalWith("sig", deps);
    expect(rc).toBe(0);
    const t = out.text();
    expect(t).toContain("WAVE_COUNT=2");
    expect(t).toContain("FAN_IN_REPOS=\n");
    expect(t).toContain("SHARED_PATHS=\n");
    expect(t).toContain("UNSAFE=0");
  });

  it("UNSAFE=1 when a shared path is touched by >=2 parts", async () => {
    writeFileSync(join(art, "dag-waves.txt"), "1\t1\tapi\t.\tbuild api\n2\t2\tweb\t.\tbuild web\n");
    writeFileSync(join(art, "dag-edges.txt"), "1\t2\n");
    writeFileSync(join(art, "parts.txt"), `oboe\t${join(h.home, "api")}\tcodex\nviola\t${join(h.home, "web")}\tcodex\n`);
    writeFileSync(join(art, "baselines", "oboe.tsv"), "baseline_sha=base_a\n");
    writeFileSync(join(art, "baselines", "viola.tsv"), "baseline_sha=base_w\n");
    const deps: CrossSignalDeps = {
      runnerFor: (_cwd): Runner => ({ run: () => ({ code: 0, stdout: "shared/iface.ts\n", stderr: "" }) }),
    };
    await crossSignalWith("sig", deps);
    const t = out.text();
    expect(t).toContain("SHARED_PATHS=shared/iface.ts");
    expect(t).toContain("UNSAFE=1");
  });

  it("UNSAFE=1 on a fan-in repo (step with >=2 incoming edges)", async () => {
    // step3 (merge) depends on step1 and step2 -> fan-in.
    writeFileSync(join(art, "dag-waves.txt"),
      "1\t1\tapi\t.\ta\n1\t2\tweb\t.\tb\n2\t3\tmerge\t.\tc\n");
    writeFileSync(join(art, "dag-edges.txt"), "1\t3\n2\t3\n");
    writeFileSync(join(art, "parts.txt"), `oboe\t${join(h.home, "api")}\tcodex\n`);
    writeFileSync(join(art, "baselines", "oboe.tsv"), "baseline_sha=base_a\n");
    const deps: CrossSignalDeps = { runnerFor: (_c) => ({ run: () => ({ code: 0, stdout: "", stderr: "" }) }) };
    await crossSignalWith("sig", deps);
    const t = out.text();
    expect(t).toContain("FAN_IN_REPOS=merge");
    expect(t).toContain("UNSAFE=1");
  });

  it("rc 1 when dag-waves.txt is missing", async () => {
    const deps: CrossSignalDeps = { runnerFor: (_c) => ({ run: () => ({ code: 0, stdout: "", stderr: "" }) }) };
    expect(await crossSignalWith("sig", deps)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `crossSignalWith` not exported.
- [ ] **Step 3: Implement** in `src/commands/perform.ts` (extend the `../core/dag.js` import with `dagFanInRepos`)

```ts
export interface CrossSignalDeps { runnerFor(cwd: string): Runner; }
const liveCrossSignalDeps: CrossSignalDeps = { runnerFor: runnerAt };
async function crossSignalRun(rest: string[]): Promise<number> {
  const topic = rest[0];
  if (!topic) { log.error("usage: perform cross-signal <topic>"); return 2; }
  return crossSignalWith(topic, liveCrossSignalDeps);
}
export async function crossSignalWith(topic: string, d: CrossSignalDeps): Promise<number> {
  const art = performArtDir(topic);
  const wavesFile = join(art, "dag-waves.txt"), edgesFile = join(art, "dag-edges.txt");
  if (!existsSync(wavesFile)) { log.error(`perform cross-signal: dag-waves.txt missing under ${art} (run dag-parse first)`); return 1; }
  const wavesText = readFileSync(wavesFile, "utf8");
  const edgesText = existsSync(edgesFile) ? readFileSync(edgesFile, "utf8") : "";
  const waves = new Set<string>();
  for (const line of wavesText.split("\n")) { if (line.length === 0) continue; waves.add(line.split("\t")[0]); }
  const waveCount = waves.size;
  const fanIn = dagFanInRepos(edgesText, wavesText);
  const pathCount = new Map<string, number>();
  for (const t of iterTargets(topic)) {
    if (!t.slug || !t.cwd) continue;
    const base = kvFileField(join(art, "baselines", `${t.slug}.tsv`), "baseline_sha");
    if (!base) continue;
    const diff = d.runnerFor(t.cwd).run("git", ["diff", "--name-only", `${base}..HEAD`]).stdout;
    for (const p of diff.split("\n")) { if (p.length === 0) continue; pathCount.set(p, (pathCount.get(p) ?? 0) + 1); }
  }
  const shared = [...pathCount.entries()].filter(([, n]) => n >= 2).map(([p]) => p).sort();
  const unsafe = waveCount >= 3 || fanIn.length > 0 || shared.length > 0 ? 1 : 0;
  if (waveCount >= 3) log.warn(`feels unsafe: wave count ${waveCount} >= 3`);
  if (fanIn.length > 0) log.warn(`feels unsafe: fan-in repos: ${fanIn.join(" ")}`);
  if (shared.length > 0) log.warn(`feels unsafe: shared filesystem paths: ${shared.join(" ")}`);
  process.stdout.write(`WAVE_COUNT=${waveCount}\nFAN_IN_REPOS=${fanIn.join(" ")}\nSHARED_PATHS=${shared.join(" ")}\nUNSAFE=${unsafe}\n`);
  return 0;
}
```

Add `case "cross-signal": return crossSignalRun(rest);` to `run()` + `usage()`.

- [ ] **Step 4: Run tests + typecheck** → PASS / 0.
- [ ] **Step 5: Commit**

```bash
git add src/commands/perform.ts tests/perform-cross-signal.test.ts
git commit -m "feat(perform): cross-signal unsafe-heuristic verb (D3)"
```

---

## Task D4: multi-repo-aware `scope-check`

**Files:**
- Modify: `src/commands/perform.ts` (`scopeCheckWith`)
- Test: `tests/perform-scope-check.test.ts` (extend; create if absent)

Byte-faithful port of the multi-repo branch of deploy.md:1304-1319. When `parts.txt` exists
(multi-repo), collect each declared sub-repo's diff (`baselines/<slug>.tsv` `baseline_sha`),
**prefix each path with `<repo>/`** (`repo = basename(cwd)`), then match against the design's
Components paths. The single-repo branch stays **byte-identical** (same checks, same order, same KV
output) so existing tests pass unchanged.

- [ ] **Step 1: Write the failing test** — add a multi-repo case to `tests/perform-scope-check.test.ts`

```ts
// Multi-repo scope-check: a sub-repo file outside the Components table is flagged, prefixed <repo>/.
it("multi-repo: flags out-of-scope sub-repo paths prefixed with the repo slug", async () => {
  const h = freshHome();
  const art = performArtDir("scope-m");
  mkdirSync(join(art, "baselines"), { recursive: true });
  const apiCwd = join(h.home, "api"), webCwd = join(h.home, "web");
  writeFileSync(join(art, "parts.txt"), `oboe\t${apiCwd}\tcodex\nviola\t${webCwd}\tcodex\n`);
  writeFileSync(join(art, "baselines", "oboe.tsv"), "baseline_sha=base_a\n");
  writeFileSync(join(art, "baselines", "viola.tsv"), "baseline_sha=base_w\n");
  // Components table declares api/src/** only; web/src/rogue.ts is out of scope.
  writeFileSync(join(art, "design.md"),
    "# D\n\n## Components\n\n| Path | Role |\n|---|---|\n| `api/src/` | api |\n");
  const deps = {
    runnerFor: (cwd: string): Runner => ({
      run: (_c: string, _a: string[]): RunResult => ({
        code: 0,
        stdout: cwd.endsWith("api") ? "src/a.ts\n" : "src/rogue.ts\n",
        stderr: "",
      }),
    }),
  };
  const rc = await scopeCheckWith("scope-m", deps as any);
  expect(rc).toBe(0);
  const diffPaths = readFileSync(join(art, "diff-paths.txt"), "utf8");
  expect(diffPaths).toContain("api/src/a.ts");
  expect(diffPaths).toContain("web/src/rogue.ts");
  // web/src/rogue.ts is NOT under api/src/ → out of scope.
  expect(readFileSync(join(art, "scope-out-of-scope.txt"), "utf8")).toContain("web/src/rogue.ts");
  h.cleanup();
});
```

(If `tests/perform-scope-check.test.ts` does not exist, create it with the standard `freshHome`
harness and import `scopeCheckWith` from `../src/commands/perform.js`; also add a single-repo
happy-path case mirroring the existing single-repo behavior to lock it.)

- [ ] **Step 2: Run test to verify it fails** — multi path not yet implemented (no `parts.txt`
  branch); the existing single-repo path would mis-handle it.

- [ ] **Step 3: Implement** — restructure `scopeCheckWith` to branch on `parts.txt`, keeping the
  single-repo branch byte-identical:

```ts
export async function scopeCheckWith(topic: string, d: ScopeDeps): Promise<number> {
  const art = performArtDir(topic);
  const designFile = join(art, "design.md");
  const partsFile = join(art, "parts.txt");
  let diffPaths: string[];
  if (existsSync(partsFile)) {
    // Multi-repo (deploy.md:1304-1313): per-sub-repo diff, prefixed with the repo slug.
    if (!existsSync(designFile)) { log.error(`perform scope-check: design.md missing under ${art}`); return 1; }
    diffPaths = [];
    for (const t of iterTargets(topic)) {
      if (!t.slug || !t.cwd) continue;
      const base = kvFileField(join(art, "baselines", `${t.slug}.tsv`), "baseline_sha");
      if (!base) continue;
      const repo = basename(t.cwd);
      const sub = d.runnerFor(t.cwd).run("git", ["diff", "--name-only", `${base}..HEAD`]).stdout.split("\n").filter((x) => x.length > 0);
      for (const p of sub) diffPaths.push(`${repo}/${p}`);
    }
  } else {
    // Single-repo — UNCHANGED behavior (target_cwd.txt + branch-base.sha).
    const targetFile = join(art, "target_cwd.txt"), baseFile = join(art, "branch-base.sha");
    if (!existsSync(targetFile) || !existsSync(baseFile)) { log.error(`perform scope-check: target_cwd.txt/branch-base.sha missing under ${art}`); return 1; }
    if (!existsSync(designFile)) { log.error(`perform scope-check: design.md missing under ${art}`); return 1; }
    const targetCwd = readFileSync(targetFile, "utf8").split("\n")[0].trim();
    const base = readFileSync(baseFile, "utf8").split("\n")[0].trim();
    diffPaths = d.runnerFor(targetCwd).run("git", ["diff", "--name-only", `${base}..HEAD`]).stdout.split("\n").filter((x) => x.length > 0);
  }
  atomicWrite(join(art, "diff-paths.txt"), diffPaths.length ? diffPaths.join("\n") + "\n" : "");
  const compPaths = extractComponentsPaths(readFileSync(designFile, "utf8"));
  atomicWrite(join(art, "components-paths.txt"), compPaths.length ? compPaths.join("\n") + "\n" : "");
  const oos = matchDiffAgainstComponents(diffPaths, compPaths);
  const oosPath = join(art, "scope-out-of-scope.txt");
  atomicWrite(oosPath, oos.length ? oos.join("\n") + "\n" : "");
  if (oos.length > 0) log.warn(`scope conformance: ${oos.length} out-of-scope path(s) detected`);
  process.stdout.write(`OOS_COUNT=${oos.length}\nOOS_PATH=${oosPath}\n`); return 0;
}
```

- [ ] **Step 4: Run the FULL suite + typecheck** — `npm run test && npm run typecheck`. Existing
  single-repo scope-check tests MUST still pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/perform.ts tests/perform-scope-check.test.ts
git commit -m "feat(perform): multi-repo-aware scope-check (D4)"
```

---

## Task D5: per-repo `finish-one` verb

**Files:**
- Modify: `src/commands/perform.ts` (`finishWith` refactor + new `finishOneWith`)
- Test: `tests/perform-finish.test.ts` (extend; create if absent)

The spec requires a finish **menu per target** (different actions per repo). Refactor the per-target
body of `finishWith` into a shared `applyFinish(...)` helper; add `finishOneWith(topic, slug,
action)` that finishes a **single** target and **appends** to `finish-results.tsv` (no truncate).
`finishWith` (apply-to-all, truncate) is unchanged in behavior — its existing tests stay green.

- [ ] **Step 1: Write the failing test** — add to `tests/perform-finish.test.ts`

```ts
it("finish-one finishes a single target and APPENDS to finish-results.tsv", async () => {
  const h = freshHome();
  const art = performArtDir("fin1");
  mkdirSync(join(art, "baselines"), { recursive: true });
  const apiCwd = join(h.home, "api"), webCwd = join(h.home, "web");
  writeFileSync(join(art, "parts.txt"), `oboe\t${apiCwd}\tcodex\nviola\t${webCwd}\tcodex\n`);
  writeFileSync(join(art, "perform-branches.tsv"), "oboe\tfeat/perform-fin1\nviola\tfeat/perform-fin1\n");
  writeFileSync(join(art, "baselines", "oboe.tsv"), "branch=main\n");
  writeFileSync(join(art, "baselines", "viola.tsv"), "branch=main\n");
  // Directive truncates first, then per-repo finish-one appends.
  writeFileSync(join(art, "finish-results.tsv"), "");
  const deps = { runnerFor: (_c: string): Runner => ({ run: () => ({ code: 0, stdout: "", stderr: "" }) }), hasGh: false };
  expect(await finishOneWith("fin1", "oboe", "keep", deps as any)).toBe(0);
  expect(await finishOneWith("fin1", "viola", "keep", deps as any)).toBe(0);
  const rows = readFileSync(join(art, "finish-results.tsv"), "utf8").trim().split("\n");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatch(/^oboe\tkeep\t/);
  expect(rows[1]).toMatch(/^viola\tkeep\t/);
  h.cleanup();
});

it("finish-one rc 1 for an unknown slug", async () => {
  const h = freshHome();
  const art = performArtDir("fin2");
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, "parts.txt"), `oboe\t${join(h.home, "api")}\tcodex\n`);
  const deps = { runnerFor: (_c: string): Runner => ({ run: () => ({ code: 0, stdout: "", stderr: "" }) }), hasGh: false };
  expect(await finishOneWith("fin2", "nope", "keep", deps as any)).toBe(1);
  h.cleanup();
});
```

(Import `finishOneWith` from `../src/commands/perform.js`. If `tests/perform-finish.test.ts` does
not exist, create it and also lock the existing `finishWith` apply-to-all behavior with a case.)

- [ ] **Step 2: Run test to verify it fails** — `finishOneWith` not exported.
- [ ] **Step 3: Implement** — refactor in `src/commands/perform.ts`:

```ts
function applyFinish(art: string, t: { slug: string; cwd: string }, action: "merge" | "pr" | "keep" | "discard", d: FinishDeps): string {
  const branch = branchMapField(join(art, "perform-branches.tsv"), t.slug);
  const startBranch = kvFileField(join(art, "baselines", `${t.slug}.tsv`), "branch");
  return finishBranchAction(d.runnerFor(t.cwd), { branch, startBranch, action, hasGh: d.hasGh });
}
export async function finishWith(topic: string, action: "merge" | "pr" | "keep" | "discard", d: FinishDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform finish: art-dir missing: ${art}`); return 1; }
  const results = join(art, "finish-results.tsv"); writeFileSync(results, "");
  let n = 0;
  for (const t of iterTargets(topic)) {
    if (!t.slug || !t.cwd) continue;
    const outcome = applyFinish(art, { slug: t.slug, cwd: t.cwd }, action, d);
    appendFileSync(results, `${t.slug}\t${action}\t${outcome}\n`);
    log.info(`finish: ${t.slug} -> ${action} -> ${outcome}`); n++;
  }
  log.ok(`perform finish: ${n} target(s) completed`); return 0;
}
async function finishOneRun(rest: string[]): Promise<number> {
  const [topic, slug, action] = rest;
  if (!topic || !slug || !action) { log.error("usage: perform finish-one <topic> <slug> <merge|pr|keep|discard>"); return 2; }
  if (!["merge", "pr", "keep", "discard"].includes(action)) { log.error(`perform finish-one: unknown action '${action}'`); return 2; }
  return finishOneWith(topic, slug, action as "merge" | "pr" | "keep" | "discard", liveFinishDeps);
}
export async function finishOneWith(topic: string, slug: string, action: "merge" | "pr" | "keep" | "discard", d: FinishDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform finish-one: art-dir missing: ${art}`); return 1; }
  const target = iterTargets(topic).find((t) => t.slug === slug);
  if (!target || !target.cwd) { log.error(`perform finish-one: no target slug=${slug}`); return 1; }
  const outcome = applyFinish(art, { slug: target.slug, cwd: target.cwd }, action, d);
  appendFileSync(join(art, "finish-results.tsv"), `${slug}\t${action}\t${outcome}\n`);
  log.info(`finish: ${slug} -> ${action} -> ${outcome}`); return 0;
}
```

Add `case "finish-one": return finishOneRun(rest);` to `run()` + the verb to `usage()`.

- [ ] **Step 4: Run the FULL suite + typecheck** — existing `finishWith` tests stay green.
- [ ] **Step 5: Commit**

```bash
git add src/commands/perform.ts tests/perform-finish.test.ts
git commit -m "feat(perform): per-repo finish-one verb (D5)"
```

---

## Task D6: multi-repo directive — Stages 3c / 3d / 4-multi + dist rebuild

**Files:**
- Modify: `commands/perform.md` (replace Stage 3z; add sibling-baseline to Stage 3a; update Task list)
- Rebuild + commit: `dist/consort.cjs`

Replace the current Stage 3z (per-repo summary + teardown + "Deferred" note) with the three real
stages. **Prose/directive task — no unit tests** (verified by the dogfood, Task D8). Honor the
rebrand: "Maestro" not "Master Yoda", `From: maestro`, "part" not "trooper", "FINE" banner,
`feat/perform-<topic>`. The stale-token gate scans `commands/perform.md` — no banned tokens.

- [ ] **Step 1: Add sibling-baseline capture to Stage 3a** (after `multi-init`, before wave dispatch):

```bash
$CS perform sibling-baseline <TOPIC> "$HUB_CWD"
```
(Captures HEAD of every undeclared sibling git repo of the hub into `$ART/sibling-baseline.txt`, so
Stage 4 can detect rogue commits. `$HUB_CWD` is the resolved hub cwd from Stage 0.)

- [ ] **Step 2: Replace Stage 3z** with the following three stages (full directive text):

````markdown
## Stage 3c — final cross-repo verification (ROUTING=multi only)

After every wave's parts report `TS=ok`, the Maestro runs its own cross-repo verification. First
compute the deterministic "feels unsafe" signal:

```bash
$CS perform cross-signal <TOPIC>   # prints WAVE_COUNT / FAN_IN_REPOS / SHARED_PATHS / UNSAFE
```

- **`UNSAFE=0`** (default) — cross-repo invariants only: read the design's `## Architecture` section
  and verify every declared cross-repo interface is implemented consistently across sub-repos. If
  none are declared, this is a no-op.
- **`UNSAFE=1`** (wave count >= 3, OR a fan-in repo, OR a path touched by >= 2 parts) — escalate to a
  full check: per sub-repo `git -C <cwd> status --short` (no uncommitted leftovers), run each
  sub-repo's test entrypoint if present, and evaluate every `- [ ]` in the design's `## Success
  Criteria` against the diffs. Treat fan-in repos (`FAN_IN_REPOS`) with extra scrutiny.

**Bugs contract.** Truncate `$ART/multi-verify-bugs.txt`, then append one TSV row per bug found
(`<repo>\t<bug-description>`). When the pass is done this file is the authoritative bug list for
Stage 3d. If it is **empty**, all green → skip to Stage 4. If non-empty → Stage 3d.

## Stage 3d — multi-repo fix-loop (ROUTING=multi only; only if Stage 3c found bugs)

Read `$ART/multi-verify-bugs.txt` (`<repo>\t<bug>` rows). `MAX_FIX_ROUNDS=3` per repo. For each
`(REPO, BUG)` row:

1. **Find the owning part** — the `parts.txt` row whose `basename(cwd) == REPO` gives
   `<instrument>` (col 1) and `<provider>` (col 3). If none, log and skip.
2. **Send the fix** — write the bug as a fix prompt to `$ART/<instrument>_fix_round_<n>.md`
   (tagged bullets; **no** `END_OF_INSTRUCTION` / done-line — the `send` primitive's `@file` form
   does not add the fence, so include neither preamble nor sentinel), then deliver it:
   ```bash
   $CS send "<instrument>" "<TOPIC>" "@$ART/<instrument>_fix_round_<n>.md"
   ```
3. **Barrier** — one background `wave-wait` per dispatched part:
   ```
   Bash(command='$CS perform wave-wait "<TOPIC>" "<instrument>" "<provider>"', run_in_background: true,
        description="maestro await <instrument> fix-round <n>")
   ```
   On completion read `$ART/wave-<instrument>.txt`. `TS=ok` → re-run Stage 3c verification for THIS
   sub-repo; still buggy and `n < MAX_FIX_ROUNDS` → bump `n` and re-loop step 1.
4. **Exhaustion** (`n >= MAX_FIX_ROUNDS`, still buggy) — **AskUserQuestion**: "Give up on this
   sub-repo" (record `<REPO>` as FAILED, continue the others) / "Continue more rounds" (bump `n`) /
   "Escalate" (pick another instrument, fresh `spawn --cwd <sub-repo>`, reset `n=0`).

When all bugs are resolved or given up, proceed to Stage 4.

## Stage 4 — sibling guard + scope + summary + finish + teardown (ROUTING=multi)

1. **Sibling rogue-commit intercept.** Re-read each sibling's HEAD vs the Stage-3a baseline:
   ```bash
   [ -f "$ART/sibling-baseline.txt" ] && $CS perform sibling-verify <TOPIC> "$HUB_CWD"
   ```
   If `$ART/sibling-rogue.txt` is non-empty, render it as an inline markdown table and
   **AskUserQuestion** ("Rogue commits on undeclared sibling main branches — pick a recovery path"):
   - *Revert + replay on feat branch* (Recommended) — `$CS perform sibling-rescue <TOPIC>
     "$HUB_CWD"` (leaves `feat/perform-<TOPIC>-rescue` in each rescued sibling; records
     `$ART/sibling-rescue.txt`).
   - *Keep on main (accept)* — append `sibling-rogue.txt` to `$ART/sibling-rogue-accepted.txt`.
   - *Send back as a fix-loop bug* — append the rogue commits as a bug to `$ART/multi-verify-bugs.txt`
     and re-enter Stage 3d.
2. **Scope conformance.** `$CS perform scope-check <TOPIC>` (multi-aware: per-sub-repo diff prefixed
   `<repo>/`). If `OOS_COUNT > 0`, **AskUserQuestion** ("Amend the design / Send back to the part /
   Force-keep") — same three handlers as single-repo Stage 4 (amend → Edit `design.md` + record
   `scope-amended.txt`; send-back → append to `multi-verify-bugs.txt`, re-enter Stage 3d; force-keep
   → append to `scope-overrides.txt`).
3. **Per-repo summary.** `$CS perform summary <TOPIC>` — surface every per-part block verbatim.
4. **Finish menu per target.** Truncate once: `: > "$ART/finish-results.tsv"`. Then for each
   `slug<TAB>cwd` from `iterTargets` (`parts.txt`): recommend **Push + PR** if `git -C "$cwd" remote`
   is non-empty else **Merge**; **AskUserQuestion** per repo (offer an "apply to all" convenience on
   the first answer when there are >= 2 targets); apply with `$CS perform finish-one <TOPIC> <slug>
   <merge|pr|keep|discard>`. Read each outcome from `finish-results.tsv`; on `merge-conflict-left`,
   tell the user the branch was preserved and the repo restored to the start branch.
5. **Forensics + reflection.** `$CS perform forensics <TOPIC>`; if it printed a path, **Edit/Write**
   an idempotent `## Maestro reflection` (3-5 bullets) onto that file.
6. **Teardown + archive.** `$CS coda --pairs <TOPIC> <instrument…>` (closes every part pane; prints
   the **FINE** banner) then `$CS perform archive <TOPIC>`.
7. **Final summary (multi).** Print one line per part — `<instrument> (<provider>) -> <cwd>: N
   commit(s) on top of branch base` (`N = git -C <cwd> log --oneline <baseline_sha>..HEAD | wc -l`,
   `baseline_sha` from `baselines/<slug>.tsv`) — plus "Final cross-verify verdict: see
   `_perform/multi-verify-bugs.txt` (empty = PASS)" and the archive path.
````

- [ ] **Step 3: Update the Task list** at the top of `perform.md` so the `TaskCreate × N` block
  includes `3c` (cross-verify), `3d` (multi fix-loop), and the multi-repo Stage 4 steps.

- [ ] **Step 4: Rebuild dist + full gate**

```bash
npm run build && npm run typecheck && npm run test && npm run lint
```
Expected: dist regenerated; typecheck 0; all tests green; lint 0; stale-token gate green.

- [ ] **Step 5: Commit**

```bash
git add commands/perform.md dist/consort.cjs
git commit -m "feat(perform): multi-repo verify/fix/finish directive (Stages 3c/3d/4) + dist (D6)"
```

---

## Task D7: refresh the repo phase guard

**Files:**
- Modify: `CLAUDE.md` (repo root)

The spec §13 flags the phase guard as stale (still says FOUNDATION, pre-`solo`/`score`). With
`perform` landing, update the "Current phase guard" section so it reflects shipped commands
(`spawn`/`send`/`collect`/`roster`/`coda`/`soundcheck`/`preflight` + `solo` + `score` + `perform`)
and keeps the still-unshipped high-level commands out of scope (`prelude`, `rehearsal`, `playback`).
`CLAUDE.md` (repo root) is **not** scanned by the stale-token gate, but keep the prose rebrand-clean
anyway.

- [ ] **Step 1: Edit the "Current phase guard" section** to state perform is complete and list the
  remaining out-of-scope commands as `prelude` / `rehearsal` / `playback` (each still needs its own
  spec under `docs/superpowers/specs/`).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(consort): refresh phase guard — perform shipped (D7)"
```

---

## Task D8: live multi-repo end-to-end dogfood

**Files:**
- Append: `docs/superpowers/DOGFOOD.md`

Conductor-run (NOT a subagent task). A 2-repo / 2-wave DAG doc, driven end-to-end through Stage 4.
Per the established Phase B/C finding, live `codex` spawns block on the 0.135.0 directory-trust
prompt, so the parts' build turns are **simulated** (stand in their `done` events + commits) while
every consort verb runs live against real throwaway git repos. Pick **keep** at the finish menu (never
PR/push against real repos). Validate, at minimum:

- [ ] `dag-parse` → `multi-init` → `pre-snapshot` → `branch` across two throwaway sub-repos under a
  temp hub (real git; sandbox disabled for the git/tmux commands).
- [ ] `sibling-baseline` captures an **undeclared** third sibling repo's HEAD.
- [ ] Simulate a rogue commit on that sibling's main → `sibling-verify` writes the per-commit TSV →
  `sibling-rescue` creates `feat/perform-<topic>-rescue` and records `sibling-rescue.txt`.
- [ ] `cross-signal` prints the expected `WAVE_COUNT`/`FAN_IN_REPOS`/`SHARED_PATHS`/`UNSAFE`.
- [ ] `scope-check` (multi) prefixes sub-repo paths with `<repo>/` and flags an out-of-scope file.
- [ ] `summary` → per-repo `finish-one keep` (append) → `forensics` → `coda` (FINE banner) →
  `archive`. Tree left clean.
- [ ] Append the result (commands run, observed outputs, the simulation boundary) to
  `docs/superpowers/DOGFOOD.md` under a "Phase D" heading.

```bash
git add docs/superpowers/DOGFOOD.md
git commit -m "docs(perform): Phase D multi-repo end-to-end dogfood result (D8)"
```

---

## Self-review

- **Spec coverage (§12.3 acceptance):** cross-repo verify writes `multi-verify-bugs.txt` (D6 Stage 3c
  + D3 signal); sibling-verify surfaces rogue commits with three recovery paths (D1 + D2 + D6 Stage
  4.1); multi-repo fix-loop re-dispatches affected repos (D6 Stage 3d); each target finishes
  independently (D5 `finish-one` + D6 Stage 4.4). ✓
- **Reuse:** per-repo summary (`summaryWith`), forensics, archive, `coda` teardown, `finishBranchAction`,
  `extractComponentsPaths`/`matchDiffAgainstComponents`, `dagFanInRepos`, the Phase-A
  `performSibling` helpers — all reused, not rebuilt. ✓
- **Byte-faithfulness gotchas surfaced:** rogue TSV (not `formatRogueBlock`); newest-first sha order;
  rescue-as-verb; per-part `baselines/<slug>.tsv`; subject = bash `${line#* }`. ✓
- **No banned tokens** in `src`/`commands` (cite `deploy-*.sh:NN` in JSDoc). Single-repo paths
  (`scopeCheckWith`, `finishWith`) preserved byte-identical so existing tests stay green. ✓
- **Type consistency:** all five verbs use `Runner`/`FinishDeps`/`SiblingDeps`/`CrossSignalDeps` with
  `runnerFor(cwd): Runner`; actions typed `"merge"|"pr"|"keep"|"discard"`. ✓
- **Gates:** every code task ends in `typecheck` 0 + targeted tests; D6 runs the full gate + rebuilds
  `dist`; D8 is the live end-to-end. ✓
