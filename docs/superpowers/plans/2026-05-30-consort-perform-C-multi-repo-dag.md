# consort `perform` — Phase C: multi-repo DAG executor + wave dispatch (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development for the
> testable tasks (C1, C2, C3); the directive (C4) + `dist`/dogfood (C5) are conductor-run.

**Goal:** Execute multi-repo design docs — parse the `## Execution DAG` into waves, materialize one
part per sub-repo, and dispatch the parts wave-by-wave with a per-wave barrier. Adds the
`dag-parse` / `multi-init` / `send-unit` / `wave-wait` verbs + the `composeDagUnitPrompt`, rewrites
the `perform.md` Stage-0 multi-repo stop into Stages 3a/3b, and dogfoods a 2-repo / 2-wave run.

**Architecture:** Reuse the **already-shipped** Phase-A executor (`dag.ts`: `dagTopological`/
`dagUniqueRepos`/`dagFanInRepos`/`parseDagLine`) + `multirepo.ts` + the Phase-B `iterTargets`-based
`pre-snapshot`/`branch`/`summary`/`finish` (they already loop over targets → **zero change** for N
repos once `parts.txt` exists). The new verbs are thin orchestrators with injected deps for unit
tests. The directive orchestrates the order: `init → dag-parse → multi-init → pre-snapshot → branch →
preflight (3a) → per-wave spawn + send-unit + wave-wait (3b)`.

**Tech Stack:** TS (ES2022/NodeNext/strict), vitest, esbuild → committed `dist/consort.cjs`.

---

## Reconciled decisions (OVERRIDE the grounding maps where they differ — read first)

1. **`parts.txt` = `<instrument>\t<cwd>\t<provider>`** (3-col; the byte-faithful `troopers.txt`
   rebrand — `cw_deploy_iter_targets` reads `$1\t$2`). `iterTargets` (Phase A) reads col0=instrument
   (the slug) + col1=cwd; the 3rd col is transparent to it. So `pre-snapshot`/`branch`/`summary`/
   `finish` key baselines/branches by **instrument** and cover N repos unchanged. The **repo** is
   `basename(cwd)` (derived, never stored separately — matches deploy.md Step 3b's `repo=$(basename
   "$cwd")`).
2. **Instrument assignment:** one per repo via **`pickInstruments(topic, N)`** (orchestral pool) in
   **DAG first-occurrence order**; provider per repo via `detectProvider(cwd)`. **Drop the clone-wars
   `cody`-reserved-for-claude rule** — a documented divergence: consort's orchestral pool never
   contains `cody`, and assigning a uniform orchestral instrument + the detected provider preserves
   the behavior (N distinct parts, one per repo, dispatched in DAG order). (`cody` remains the
   single-repo frozen handle.)
3. **`dag-parse` is the executor; STRICT** (rc 1 on: missing `design.md`, no `## Execution DAG`
   section, a malformed numbered line, zero parsed nodes, or a cycle). `score`'s `emit-dag`/`check-dag`
   are the *soft-DAG authoring* path — **do not call any `score.ts` function**; reuse only
   `core/dag.ts`.
4. **`wave-wait` is a pure per-part barrier** from **offset 0** on `['done','error']` (NOT `question`
   — waves are non-interactive). rc 0 always (outcome in `TS=`); rc 1 missing art dir; rc 2 bad args.
5. **Order:** `multi-init` reads `dag-waves.txt` (so `dag-parse` runs first) and writes `parts.txt`
   (so `pre-snapshot`/`branch` run after). The **directive** sequences this; `init` itself is
   essentially unchanged (it already records `multi-repo.txt=multi`; drop its Phase-B
   `log.warn`-and-the-Stage-0-`stop`).
6. **Dispatch = `spawn` + `send`-the-dag-unit-prompt + `wave-wait`** per repo per wave (NOT
   `turn-send`/`turn-wait` — those are the single-repo `cody` round-aware flow). `send-unit` composes
   the dag-unit prompt (`composeDagUnitPrompt`) + delivers it via the `send` primitive (which
   auto-finds the `<instrument>-<provider>` dir).
7. **Cross-repo verify / fix / finish (deploy Steps 3c/3d) are Phase D** — Phase C ends after all
   waves complete + a basic per-target `summary`. `scope-check` stays single-repo (Phase D widens it).

**Stale-token gate** scans `src` + `commands/perform.md` incl. comments: zero `cw_`/`clone-wars`/
`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_` and zero case-insensitive `trooper`/`commander`. `cody` is
allowed (frozen handle). Cite the prior plugin as `deploy-*.sh:NN`/`deploy_<fn>`.

---

## File Structure

| File | Change | Task |
|---|---|---|
| `src/core/dag.ts` | +`dagSectionBody` (refactor `checkDagSection`/`dagMalformedLines` onto it) | C1 |
| `src/core/performTurn.ts` | +`composeDagUnitPrompt` | C1 |
| `tests/dag-executor.test.ts` + `tests/perform-turn.test.ts` | +cases | C1 |
| `src/commands/perform.ts` | +`dag-parse` + `wave-wait` verbs + dispatcher cases | C2 |
| `tests/perform-dag-parse.test.ts` + `tests/perform-wave-wait.test.ts` (new) | verb tests | C2 |
| `src/commands/perform.ts` | +`multi-init` + `send-unit` verbs + helpers | C3 |
| `tests/perform-multi-init.test.ts` (new) | verb tests | C3 |
| `commands/perform.md` | replace the Stage-0 multi stop with Stages 3a/3b | C4 |
| `src/commands/perform.ts` | init: drop the multi `log.warn` | C4 |
| `dist/consort.cjs` | rebuild + commit | C5 |
| `docs/superpowers/DOGFOOD.md` | append Phase C result | C5 |

---

### Task C1: core — `dagSectionBody` + `composeDagUnitPrompt`

**C1.1 — `src/core/dag.ts`: factor the section-body extractor** (the awk range used 3× inline).

```ts
/** The body lines of the `## Execution DAG` section: everything after a line matching
 *  /^## Execution DAG[ \t]*$/ up to the next `^## ` heading (or EOF). [] when absent. Byte-faithful
 *  to the prior bash plugin's awk range (deploy-dag-parse.sh:32-36). A suffixed heading
 *  ("## Execution DAG (multi)") is intentionally NOT recognized as the opener. */
export function dagSectionBody(docText: string): string[] {
  const body: string[] = [];
  let inDag = false;
  for (const l of docText.split("\n")) {
    if (/^## Execution DAG[ \t]*$/.test(l)) { inDag = true; continue; }
    if (/^## /.test(l)) { inDag = false; continue; }
    if (inDag) body.push(l);
  }
  return body;
}
```
Refactor `checkDagSection` + `dagMalformedLines` to consume `dagSectionBody` (no behavior change —
the existing `dag.ts`/`dag-executor.test.ts` stay green). Add a couple `dagSectionBody` unit tests to
`tests/dag-executor.test.ts` (section present → body lines; absent → []; suffixed heading → []; stops
at next `## `).

**C1.2 — `src/core/performTurn.ts`: `composeDagUnitPrompt`** (port of `cw_deploy_build_dag_unit_prompt`
@ `deploy.sh:300`; **OMIT** `END_OF_INSTRUCTION` — `inboxWrite` appends it).

```ts
/** Per-repo build prompt for the multi-repo DAG path (port of deploy_build_dag_unit_prompt
 *  @ deploy.sh:300). `slug` is the SUB-REPO slug (the part focuses on its `### <slug>` subsections).
 *  OMITS END_OF_INSTRUCTION + the done-line — inboxWrite appends the fence. */
export function composeDagUnitPrompt(args: { slug: string; designPath: string; step: string; total: number; upstreamCsv: string }): string {
  const { slug, designPath, step, total } = args;
  const upstream = !args.upstreamCsv || args.upstreamCsv === "none"
    ? "none (this is a wave-1 / root sub-repo)"
    : args.upstreamCsv.split(",").join(", ");
  return [
    `Read ${designPath}. Your sub-repo is "${slug}".`,
    "",
    `Multi-repo design docs use \`### ${slug}\` subsection headings inside the`,
    "Architecture and Components sections — focus on the subsections matching",
    `your slug. The DAG context (Step ${step} of ${total}) is in the`,
    `"## Execution DAG" section; you depend on: ${upstream}.`,
    "",
    "Run the full superpowers ceremony for your sub-repo:",
    "1. superpowers:writing-plans — produce an implementation plan from the",
    `   design-doc's slice for "${slug}", saved to`,
    `   docs/superpowers/plans/YYYY-MM-DD-${slug}-plan.md`,
    "2. superpowers:subagent-driven-development — execute the plan task-by-",
    "   task, two-stage review per task",
    "3. superpowers:verification-before-completion — confirm tests pass,",
    "   diff matches the plan, no half-finished work, before reporting done",
    "",
    'Report status via outbox: emit {"event":"done"} when all tasks are',
    'complete and verified. Emit {"event":"error", "reason":"..."} on any',
    "unrecoverable failure.",
    "",
    "BRANCH DISCIPLINE (hard rule):",
    `- You are operating on the current branch in sub-repo "${slug}".`,
    "  Do NOT run 'git checkout', 'git switch', 'git branch -m', or",
    "  create new branches.",
    "- Commit per task with Conventional Commits prefixes on the current",
    "  branch.",
    "- If your work genuinely needs a fresh branch, abort with",
    '  {"event":"error","reason":"branch-discipline: needed new branch"}',
    "  and let the conductor decide.",
  ].join("\n");
}
```
Tests in `tests/perform-turn.test.ts`: contains `Step 2 of 3`, the `### <slug>` focus, the 3 ceremony
skills, the branch-discipline block; `upstreamCsv="none"` → "none (this is a wave-1 …)";
`upstreamCsv="api,lib"` → "api, lib"; NO `END_OF_INSTRUCTION`; no stale tokens.

- [ ] C1: tests first → fail → implement → `npx vitest run tests/dag-executor.test.ts tests/perform-turn.test.ts` pass + `npm run typecheck` 0 → commit `feat(perform): dagSectionBody + composeDagUnitPrompt`.

---

### Task C2: `dag-parse` + `wave-wait` verbs

Append to `src/commands/perform.ts`; add imports (`parseDagLine`, `dagTopological`, `dagSectionBody`
from `../core/dag.js`) + the two dispatcher cases + extend `usage()`.

**`dag-parse`** (port of `deploy-dag-parse.sh`):

```ts
export interface DagParseDeps { artDir(topic: string): string; }
const liveDagParseDeps: DagParseDeps = { artDir: (t) => performArtDir(t) };
async function dagParseRun(rest: string[]): Promise<number> {
  if (rest.length !== 1 || !rest[0]) { log.error("usage: perform dag-parse <topic>"); return 2; }
  return dagParseWith(rest[0], liveDagParseDeps);
}
export async function dagParseWith(topic: string, d: DagParseDeps): Promise<number> {
  const art = d.artDir(topic);
  const docPath = join(art, "design.md");
  if (!existsSync(docPath)) { log.error(`perform dag-parse: design.md not found under ${art} (run perform init first)`); return 1; }
  const body = dagSectionBody(readFileSync(docPath, "utf8"));
  if (body.length === 0) { log.error("perform dag-parse: design doc missing '## Execution DAG' section"); return 1; }
  const nodes: string[] = [];                                    // step ids, file order, NOT de-duped
  const rows = new Map<string, { repo: string; path: string; desc: string }>();
  const edges: Array<[string, string]> = [];
  for (const line of body) {
    if (line.trim() === "") continue;
    if (!/^[ \t]*\d+\./.test(line)) continue;                    // only numbered DAG lines
    const node = parseDagLine(line);
    if (node === null) { log.error(`perform dag-parse: malformed DAG line: ${line}`); return 1; }
    nodes.push(node.step);
    rows.set(node.step, { repo: node.repo, path: node.path, desc: node.desc });
    if (node.deps !== "none" && node.deps !== "") for (const dep of node.deps.split(",")) edges.push([dep, node.step]);
  }
  if (nodes.length === 0) { log.error("perform dag-parse: no DAG lines parsed from '## Execution DAG' section"); return 1; }
  const topo = dagTopological(edges, nodes);                     // null on cycle (it wrote the stderr diagnostic)
  if (topo === null) return 1;
  const wavesText = topo.map((r) => { const [w, s] = r.split("\t"); const x = rows.get(s)!; return `${w}\t${s}\t${x.repo}\t${x.path}\t${x.desc}`; }).join("\n") + "\n";
  const edgesText = edges.length ? edges.map(([f, t]) => `${f}\t${t}`).join("\n") + "\n" : "";
  atomicWrite(join(art, "dag-waves.txt"), wavesText);
  atomicWrite(join(art, "dag-edges.txt"), edgesText);
  const waveCount = Number(topo[topo.length - 1].split("\t")[0]);
  log.ok(`perform dag-parse: ${nodes.length} steps in ${waveCount} wave(s)`);
  process.stdout.write(`WAVES=${waveCount}\nSTEPS=${nodes.length}\n`);
  return 0;
}
```
Note `parseDagLine` returns `{step, repo, path, desc, deps}` where `path` is `"none"` when the
optional `(/abspath)` group is absent and `deps` is `"none"` or `"1,2"`.

**`wave-wait`** (port of `deploy-wave-wait.sh`):

```ts
const PERFORM_WAVE_TIMEOUT = (): number =>
  Number(process.env.CONSORT_PERFORM_WAVE_TIMEOUT_OVERRIDE) || Number(process.env.CONSORT_PERFORM_TURN_TIMEOUT_S) || 14400;
async function waveWaitRun(rest: string[]): Promise<number> {
  const [topic, instrument, provider] = rest;
  if (!topic || !instrument || !provider) { log.error("usage: perform wave-wait <topic> <instrument> <provider>"); return 2; }
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(topic) || !/^[a-z0-9_-]+$/.test(instrument) || !/^[a-z0-9_-]+$/.test(provider)) { log.error("perform wave-wait: bad topic/instrument/provider"); return 2; }
  return waveWaitWith(topic, instrument, provider, liveWaitDeps);  // reuse the Phase-B liveWaitDeps {wait, multiplier}
}
export async function waveWaitWith(topic: string, instrument: string, provider: string, d: PerformWaitDeps): Promise<number> {
  const art = performArtDir(topic);
  if (!existsSync(art)) { log.error(`perform wave-wait: _perform art-dir missing for ${topic}`); return 1; }
  const timeout = scaledTimeout(PERFORM_WAVE_TIMEOUT(), d.multiplier(provider));
  log.info(`[wave-wait] ${instrument} timeout=${timeout}s`);
  const ev = await d.wait(instrument, provider, topic, 0, ["done", "error"], timeout);   // OFFSET 0; done|error only
  let ts: string; const extra: string[] = [];
  if (ev === null) { ts = "timeout"; extra.push(`TIMEOUT_S=${timeout}`); log.warn(`[wave-wait] ${instrument} TS=timeout`); }
  else if (ev.event === "done") { ts = "ok"; extra.push("EVENT=done"); log.ok(`[wave-wait] ${instrument} TS=ok`); }
  else if (ev.event === "error") { ts = "failed"; extra.push("EVENT=error", `REASON=${typeof ev.reason === "string" ? ev.reason : ""}`); log.error(`[wave-wait] ${instrument} TS=failed`); }
  else { ts = "failed"; extra.push("EVENT=unknown"); log.error(`[wave-wait] ${instrument} TS=failed (unknown event)`); }
  atomicWrite(join(art, `wave-${instrument}.txt`), `TS=${ts}\nINSTRUMENT=${instrument}\nPROVIDER=${provider}\nTOPIC=${topic}\n` + extra.map((l) => l + "\n").join(""));
  writeFileSync(join(art, `wave-${instrument}.done`), "");
  return 0;                                                       // ALWAYS rc 0
}
```
`PerformWaitDeps`/`liveWaitDeps` already exist (Phase B turn-wait). `wave-wait` reuses them but with
`offset 0` + `['done','error']`.

Tests `tests/perform-dag-parse.test.ts` + `tests/perform-wave-wait.test.ts`:
- dag-parse: a 2-wave doc (`1. api (/abs/api) — build` / `2. web — wire (depends on 1)`) →
  `dag-waves.txt`===`"1\t1\tapi\t/abs/api\tbuild\n2\t2\tweb\tnone\twire\n"`, `dag-edges.txt`===`"1\t2\n"`,
  stdout `WAVES=2`/`STEPS=2`; diamond → wave composition byte-exact; malformed line → rc 1; no section
  → rc 1; cycle → rc 1; missing design.md → rc 1; zero args → rc 2.
- wave-wait (inject `PerformWaitDeps`): done → `TS=ok`/`EVENT=done` + `.done`; error+reason →
  `TS=failed`/`EVENT=error`/`REASON=<r>`; null → `TS=timeout`/`TIMEOUT_S=<n>`; unknown → `EVENT=unknown`;
  missing art → rc 1; bad args → rc 2; assert `wait` called with `offset===0` and `['done','error']`;
  **rc 0 in all wait cases**; the `wave-<instrument>.txt` field order is `TS/INSTRUMENT/PROVIDER/TOPIC`
  then extras.

- [ ] C2: tests first → fail → implement → focused vitest pass + `npm run typecheck` 0 → commit
  `feat(perform): dag-parse executor + wave-wait barrier verbs`.

---

### Task C3: `multi-init` + `send-unit` verbs

**`multi-init`** (port of `deploy-multi-init.sh`) — `perform multi-init <topic> <hub-cwd>`:

```ts
export interface MultiInitDeps { detectProvider(cwd: string): "codex" | "claude"; pickInstruments(topic: string, n: number): string[]; runnerFor(cwd: string): Runner; }
const liveMultiInitDeps: MultiInitDeps = { detectProvider: (c) => detectProvider(c), pickInstruments, runnerFor: runnerAt };
async function multiInitRun(rest: string[]): Promise<number> {
  if (rest.length !== 2) { log.error("usage: perform multi-init <topic> <hub-cwd>"); return 2; }
  return multiInitWith(rest[0], rest[1], liveMultiInitDeps);
}
export async function multiInitWith(topic: string, hubCwd: string, d: MultiInitDeps): Promise<number> {
  const art = performArtDir(topic);
  const wavesFile = join(art, "dag-waves.txt");
  if (!existsSync(wavesFile)) { log.error(`perform multi-init: dag-waves.txt not found at ${wavesFile} (run perform dag-parse first)`); return 1; }
  // repos in DAG FIRST-OCCURRENCE order (NOT dagUniqueRepos, which sorts), remembering each repo's path field.
  const reposOrdered: string[] = []; const seen = new Set<string>(); const repoToPath = new Map<string, string>();
  for (const line of readFileSync(wavesFile, "utf8").split("\n")) {
    const cols = line.split("\t"); const repo = cols[2];
    if (!repo) continue;
    if (!seen.has(repo)) { seen.add(repo); reposOrdered.push(repo); repoToPath.set(repo, cols[3] || "none"); }
  }
  if (reposOrdered.length === 0) { log.error("perform multi-init: no repos in dag-waves.txt"); return 1; }
  const instruments = d.pickInstruments(topic, reposOrdered.length);
  if (instruments.length < reposOrdered.length) { log.error(`perform multi-init: instrument pool exhausted (need ${reposOrdered.length}, got ${instruments.length})`); return 1; }
  const rows: string[] = [];
  for (let i = 0; i < reposOrdered.length; i++) {
    const repo = reposOrdered[i];
    const p = repoToPath.get(repo)!;
    const cwd = p !== "none" && p !== "" ? p : join(hubCwd, repo);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) { log.error(`perform multi-init: sub-repo '${repo}' not found at ${cwd}`); return 1; }
    if (!existsSync(join(cwd, "CLAUDE.md")) && !existsSync(join(cwd, "AGENTS.md"))) { log.error(`perform multi-init: sub-repo '${repo}' has no CLAUDE.md or AGENTS.md at ${cwd}`); return 1; }
    const provider = d.detectProvider(cwd);
    const instrument = instruments[i];
    rows.push(`${instrument}\t${cwd}\t${provider}`);
    const sha = d.runnerFor(cwd).run("git", ["rev-parse", "HEAD"]).stdout.trim();
    atomicWrite(join(art, `${instrument}-branch-base.sha`), sha + "\n");
  }
  atomicWrite(join(art, "parts.txt"), rows.join("\n") + "\n");
  log.ok(`perform multi-init: ${reposOrdered.length} part(s) assigned for ${topic}`);
  return 0;
}
```
Gotchas: FIRST-OCCURRENCE order (Set dedup, NOT `dagUniqueRepos`); `cwd` = path-field-if-not-`none`
else `hubCwd/<repo>`; the `CLAUDE.md`/`AGENTS.md` guard; `parts.txt` 3-col so `iterTargets` reads it;
`<instrument>-branch-base.sha` per part. (The cody-reservation is dropped per Reconciled Decision 2.)

**`send-unit`** (the Step-3b per-repo dispatch, encapsulated) — `perform send-unit <topic> <repo>`:

```ts
export interface SendUnitDeps { send(args: string[]): Promise<number>; }
const liveSendUnitDeps: SendUnitDeps = { send: sendRun };
async function sendUnitRun(rest: string[]): Promise<number> {
  if (rest.length !== 2) { log.error("usage: perform send-unit <topic> <repo>"); return 2; }
  return sendUnitWith(rest[0], rest[1], liveSendUnitDeps);
}
export async function sendUnitWith(topic: string, repo: string, d: SendUnitDeps): Promise<number> {
  const art = performArtDir(topic);
  // resolve the part for this repo from parts.txt (repo = basename(cwd))
  let instrument = "", cwd = "";
  for (const line of (existsSync(join(art, "parts.txt")) ? readFileSync(join(art, "parts.txt"), "utf8").split("\n") : [])) {
    const c = line.split("\t"); if (c[1] && basename(c[1]) === repo) { instrument = c[0]; cwd = c[1]; break; }
  }
  if (!instrument) { log.error(`perform send-unit: no part for repo '${repo}' in parts.txt`); return 1; }
  // step + total + upstream from dag-waves.txt + dag-edges.txt
  const waves = readFileSync(join(art, "dag-waves.txt"), "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
  const total = new Set(waves.map((w) => w[2])).size;
  const myStep = waves.find((w) => w[2] === repo)?.[1] ?? "";
  const stepToRepo = new Map(waves.map((w) => [w[1], w[2]]));
  const edges = (existsSync(join(art, "dag-edges.txt")) ? readFileSync(join(art, "dag-edges.txt"), "utf8") : "").split("\n").filter(Boolean).map((l) => l.split("\t"));
  const upstreamRepos = edges.filter(([, to]) => to === myStep).map(([from]) => stepToRepo.get(from)).filter(Boolean);
  const upstreamCsv = upstreamRepos.join(",");
  const prompt = composeDagUnitPrompt({ slug: repo, designPath: join(art, "design.md"), step: myStep, total, upstreamCsv });
  const promptFile = join(art, `${instrument}_dag_unit_prompt.md`);
  atomicWrite(promptFile, prompt);
  const rc = await d.send(["--from", "maestro", instrument, topic, `@${promptFile}`]);
  if (rc !== 0) { log.error(`perform send-unit: send failed (rc=${rc}) for ${repo}`); return 1; }
  log.info(`[send-unit] ${instrument} -> ${repo} (step ${myStep}/${total}, upstream: ${upstreamCsv || "none"})`);
  return 0;
}
```
(`basename` from `node:path` — add to the existing import; `composeDagUnitPrompt` from
`../core/performTurn.js`.)

Tests `tests/perform-multi-init.test.ts` (inject deps; seed `dag-waves.txt` + sub-repo dirs with
`CLAUDE.md` under a tmp hub): parts.txt rows in first-occurrence order, `<instrument>\t<cwd>\t<provider>`;
`<instrument>-branch-base.sha` from the injected runner's `rev-parse`; missing `dag-waves.txt` → rc 1;
sub-repo missing → rc 1; no marker → rc 1; pool exhausted → rc 1; **`iterTargets(topic)` round-trips
parts.txt** to `{slug:instrument, cwd}[]` (proves pre-snapshot/branch coverage). `send-unit` test
(inject `send`): seed parts.txt + dag-waves + dag-edges → assert the prompt file contains the right
`Step k/total` + upstream + `### <repo>` focus, and `send` called `['--from','maestro',instrument,
topic,'@<promptFile>']`; no part for repo → rc 1.

- [ ] C3: tests first → fail → implement multi-init + send-unit + dispatcher cases → focused vitest
  pass + `npm run typecheck` 0 + full `npm run test` + `npm run lint` → commit
  `feat(perform): multi-init roster + send-unit dag-unit dispatch verbs`.

---

### Task C4 (conductor): rewrite `perform.md` for multi-repo

Drop init's multi `log.warn` (`src/commands/perform.ts`). In `commands/perform.md`, **replace** the
"single-repo only" scope note + the Stage-0 step-5 "Stop when ROUTING=multi" with the multi-repo
branch. New flow when `ROUTING=multi`:

- **Stage 0 (multi tail):** after `init` + `pre-snapshot`/`branch` are deferred — first run
  `$CS perform dag-parse <TOPIC>` (capture `WAVES=`/`STEPS=`; on rc 1 surface the cycle/malformed
  error + stop), then `$CS perform multi-init <TOPIC> "$TARGET_CWD"` (hub = `TARGET_CWD` = repoRoot;
  on rc 1 stop), then `$CS perform pre-snapshot <TOPIC>` + `$CS perform branch <TOPIC>` (now N repos
  via `parts.txt`).
- **Stage 3a — preflight:** allocate one pane per part. Build a roster from `parts.txt`
  (`<provider>\t<instrument>` rows) and run the preflight allocator (mirror `commands/score.md`'s
  preflight/`spawn-all` pattern; resolve the exact invocation against `src/commands/preflight.ts`).
- **Stage 3b — wave dispatch:** read `dag-waves.txt`; group repos by wave (col 1). Compute the
  fan-in repos once: those whose step has ≥2 incoming `dag-edges.txt` rows (the `dagFanInRepos`
  heuristic) — flag them for extra cross-verify scrutiny in Phase D. For each wave in order:
  1. For each repo in the wave (parallel): `$CS spawn <instrument> <provider> <TOPIC> --cwd <cwd>
     --target-pane <pane>` (resolve `<instrument>/<provider>/<cwd>` from `parts.txt` by
     `basename(cwd)==repo`), then `$CS perform send-unit <TOPIC> <repo>`.
  2. For each repo (background, parallel): `$CS perform wave-wait <TOPIC> <instrument> <provider>`.
  3. **Barrier:** wait until every `wave-<instrument>.txt` in the wave shows `TS=ok`. On any
     `TS=failed`/`timeout`, AskUserQuestion (Retry the wave / Hand-off / Abort → `coda` + archive).
     Only after all-ok proceed to the next wave.
- **Stage 4 (multi tail):** after all waves, `$CS perform summary <TOPIC>` (per-instrument blocks),
  note that cross-repo verify + per-repo finish are Phase D, then teardown via `$CS coda <TOPIC>` +
  `$CS perform archive <TOPIC>`. (Single-repo Stages 1.1/1/2/3 + the finish menu are unchanged.)

Self-review the directive against the stale-token gate before C5.

---

### Task C5 (conductor): rebuild `dist` + dogfood

`npm run build` + full gate (typecheck/test/lint/stale-tokens incl. `perform.md`); commit
`dist/consort.cjs` + `perform.md`. Then the **2-repo / 2-wave dogfood**: under a hub dir, two
throwaway `git init` sub-repos `api/` + `web/`, each with a commit + a `CLAUDE.md` marker; a design
doc with `**Target Sub-Project(s):** api, web` (plural → `routing=multi`) + the 4 audit-required
sections + a `## Execution DAG`:
```
1. api — build the lib
2. web — consume it (depends on 1)
```
Drive `init → dag-parse → multi-init → pre-snapshot → branch` and **assert**: `dag-waves.txt` = 2
waves (`1\t1\tapi\tnone\tbuild the lib` then `2\t2\tweb\tnone\tconsume it`), `dag-edges.txt`=`1\t2`,
`parts.txt` = 2 rows (`<instrument>\t<api-cwd>\tcodex` / `<instrument>\t<web-cwd>\tcodex`), per-part
`<instrument>-branch-base.sha`, and that `send-unit api`/`send-unit web` compose the right
step/upstream prompts. **Simulate the parts** (write the `ready`/`done` outbox events + the per-repo
commits by hand) to validate the per-wave dispatch ORDER + `wave-<instrument>.done` composition —
the live codex part-spawn is blocked by codex 0.135.0's directory-trust prompt (Phase B finding), so
each sub-repo cwd would need to be codex-trusted for a live run. Append the result to
`docs/superpowers/DOGFOOD.md`.

---

## Phase C completion gate

- [ ] `npm run typecheck` 0 · `npm run test` green · `npm run lint` 0 · stale-tokens green.
- [ ] `dist/consort.cjs` rebuilt + committed; `node dist/consort.cjs perform dag-parse`/`multi-init`/
  `wave-wait`/`send-unit` dispatch.
- [ ] 2-repo/2-wave dogfood: `dag-waves`/`dag-edges`/`parts.txt` composition + wave dispatch order
  asserted; `DOGFOOD.md` updated.
- [ ] Branch `feat/perform` retained for Phase D (cross-repo verify + multi-repo fix-loop + finish).
