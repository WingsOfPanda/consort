# Consort Foundation — Plan 02: Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Prerequisite:** Plan 01 complete (core library green).

**Goal:** Build the CLI dispatcher and the six primitives (`spawn`, `send`, `collect`, `roster`, `coda`, `soundcheck`) plus `preflight`, the `_banner` helper, and the `hook` stub — wiring the `core/*` library into a working plugin. Ends with `tsc` clean, `vitest` green (pure logic + arg construction), and the `commands/*.md` reaching real handlers.

**Architecture:** `src/consort.ts` parses argv (args-file fence), routes a subcommand to `src/commands/<verb>.run(args)`. Commands compose `core/*`. Live tmux behavior is exercised by the dogfood in Plan 03; here we unit-test the pure decision logic (mode resolution, state derivation, the coda batch-sleep-once invariant, the opencode permission check) and the tmux arg construction.

**Tech Stack:** same as Plan 01.

**Companion references:** the digests' "Suggested TS exports" + "High-value test cases" for `send-collect`, `roster`, `coda`, `soundcheck`, `forensics`; `bin/spawn.sh` (§7 lifecycle) and `bin/preflight-layout.sh`.

---

## File Structure

```
src/
  consort.ts                 # T15 — dispatcher (+ --mint-args-file, _banner)
  core/tmux.ts               # T16 — add killGraceful + preflightLayout (extend Plan 01 module)
  commands/
    spawn.ts                 # T17 — §7 lifecycle
    preflight.ts             # T18 — pane-grid pre-allocation
    coda.ts                  # T19 — graceful teardown (one shared 9s wait)
    send.ts collect.ts       # T20
    roster.ts soundcheck.ts hook.ts  # T21
tests/
  consort-dispatch.test.ts spawn.test.ts coda.test.ts roster.test.ts soundcheck.test.ts
```

---

### Task 15: `src/consort.ts` dispatcher + `_banner` + `--mint-args-file`

**Files:**
- Modify: `src/consort.ts` (replace the Plan 01 placeholder)
- Test: `tests/consort-dispatch.test.ts`

The dispatcher: `applyArgsFile(argv)` first (fence), then route. Special internal verbs: `_banner <label> <color>` (renders the FINE banner head via `colors.renderBannerHead`, then an 8-iteration 1s countdown, then `Closed.`); `<verb> --mint-args-file` prints a fresh `runArgsFile(verb)` path and exits 0. Unknown verb → stderr + exit 2. Each command module exports `run(args: string[]): Promise<number>` (exit code).

- [ ] **Step 1: Write failing test** `tests/consort-dispatch.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "dist", "consort.cjs");
function run(args: string[], env: Record<string, string> = {}) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
    return { code: 0, stdout };
  } catch (e: any) {
    return { code: e.status ?? 1, stdout: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

describe("dispatcher (requires npm run build first)", () => {
  it("unknown subcommand → exit 2", () => {
    expect(run(["nope"]).code).toBe(2);
  });
  it("--mint-args-file prints a path under _args and creates nothing harmful", () => {
    const home = mkdtempSync(join(tmpdir(), "disp-"));
    const r = run(["roster", "--mint-args-file"], { CONSORT_HOME: home });
    expect(r.code).toBe(0);
    const path = r.stdout.trim();
    expect(path).toContain("/_args/");
  });
  it("_banner renders FINE and exits 0 (fast countdown via CONSORT_BANNER_FAST)", () => {
    const r = run(["_banner", "strings-violin:codex:demo", "colour110"], { CONSORT_BANNER_FAST: "1" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("FINE — pane closing");
  });
});
```

> The test runs the built `dist/consort.cjs`; ensure `npm run build` runs before this test (Plan 02 close-out rebuilds). `CONSORT_BANNER_FAST=1` makes the countdown instant for tests.

- [ ] **Step 2: Run, expect FAIL** — `npm run build && npx vitest run tests/consort-dispatch.test.ts`.

- [ ] **Step 3: Implement `src/consort.ts`**

```ts
#!/usr/bin/env node
import { applyArgsFile } from "./args.js";
import { runArgsFile } from "./core/paths.js";
import { renderBannerHead } from "./core/colors.js";

type Handler = (args: string[]) => Promise<number>;

async function loadHandlers(): Promise<Record<string, Handler>> {
  const [spawn, send, collect, roster, coda, soundcheck, preflight, hook] = await Promise.all([
    import("./commands/spawn.js"), import("./commands/send.js"), import("./commands/collect.js"),
    import("./commands/roster.js"), import("./commands/coda.js"), import("./commands/soundcheck.js"),
    import("./commands/preflight.js"), import("./commands/hook.js"),
  ]);
  return {
    spawn: spawn.run, send: send.run, collect: collect.run, roster: roster.run,
    coda: coda.run, soundcheck: soundcheck.run, preflight: preflight.run, hook: hook.run,
  };
}

async function banner(label: string, color: string): Promise<number> {
  process.stdout.write(renderBannerHead(label, color) + "\n");
  const c = /^colour(\d+)$/.test(color) ? `\x1b[38;5;${color.replace("colour", "")}m` : "";
  const r = "\x1b[0m";
  const fast = Boolean(process.env.CONSORT_BANNER_FAST);
  for (let i = 8; i >= 1; i--) {
    process.stdout.write(`  ${c}Closing in ${i} second${i === 1 ? "" : "s"}...${r}\r`);
    if (!fast) await new Promise((res) => setTimeout(res, 1000));
  }
  process.stdout.write(`  ${c}Closed.                          ${r}\n`);
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub) { process.stderr.write("consort: missing subcommand\n"); return 2; }
  if (sub === "_banner") return banner(rest[0] ?? "part", rest[1] ?? "");

  // --mint-args-file: the command directives' step 1
  if (rest.includes("--mint-args-file")) { process.stdout.write(runArgsFile(sub) + "\n"); return 0; }

  let resolved: string[];
  try { resolved = applyArgsFile(rest); }
  catch (e: any) { process.stderr.write(`${e.message ?? e}\n`); return e.code ?? 2; }

  const handlers = await loadHandlers();
  const fn = handlers[sub];
  if (!fn) { process.stderr.write(`consort: unknown subcommand '${sub}'\n`); return 2; }
  return fn(resolved);
}

main().then((code) => process.exit(code)).catch((e) => { process.stderr.write(`${e?.stack ?? e}\n`); process.exit(1); });
```

- [ ] **Step 4: Stub the command modules** so the dispatcher imports resolve. Create each `src/commands/<verb>.ts` with `export async function run(_args: string[]): Promise<number> { process.stderr.write("not implemented\n"); return 2; }` for spawn/send/collect/roster/coda/soundcheck/preflight/hook. (Each is replaced by its real task below.)

- [ ] **Step 5: Run, expect PASS** — `npm run build && npx vitest run tests/consort-dispatch.test.ts`.

- [ ] **Step 6: Commit** — `git add src/consort.ts src/commands/*.ts tests/consort-dispatch.test.ts && git commit -m "feat: CLI dispatcher (+ _banner, --mint-args-file) + command stubs"`

---

### Task 16: extend `core/tmux.ts` — `killGraceful` + `preflightLayout`

**Files:**
- Modify: `src/core/tmux.ts` (append; depends on `colors` + the `_banner` subcommand from T15)
- Test: `tests/tmux-graceful.test.ts` (pure: the respawn-command builder)

`killGraceful(pane, label, color, pluginRoot)`: no-op if `!paneAlive`; snapshot via `capture-pane -p -e` to a temp file; `respawn-pane -k` running `cat <snap>; node <pluginRoot>/dist/consort.cjs _banner <label> <color>; rm -f <snap>`. The command builder `gracefulRespawnCommand(snap, pluginRoot, label, color)` is pure and unit-tested. `preflightLayout(topic, roster, opts)`: orchestrates `conductorPane` → first `-h` then `-v` splits running `sentinelCommand(labelFmt)` → `paneLabelSet` → `selectLayoutMainVertical` → write `preflight-panes.txt` atomically with rollback (kill created panes on throw). `paneLabelSet(pane, instrument, model, topic)` sets the three `@cs_*` options.

- [ ] **Step 1: Write failing test** `tests/tmux-graceful.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { gracefulRespawnCommand, paneLabelSetArgs } from "../src/core/tmux.js";

describe("tmux graceful + labels", () => {
  it("gracefulRespawnCommand cats snapshot, runs _banner, removes snapshot", () => {
    const cmd = gracefulRespawnCommand("/tmp/snap.txt", "/plugin", "strings-violin:codex:demo", "colour110");
    expect(cmd).toContain("cat '/tmp/snap.txt'");
    expect(cmd).toContain("node '/plugin/dist/consort.cjs' _banner 'strings-violin:codex:demo' 'colour110'");
    expect(cmd).toContain("rm -f '/tmp/snap.txt'");
  });
  it("paneLabelSetArgs returns three @cs_* set-option arg arrays", () => {
    const sets = paneLabelSetArgs("%1", "violin", "codex", "demo");
    expect(sets.map((s) => s[4])).toEqual(["@cs_label", "@cs_color", "@cs_label_fmt"]);
    expect(sets[0]).toContain("strings-violin:codex:demo");
    expect(sets[1]).toContain("colour110");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/tmux-graceful.test.ts`.

- [ ] **Step 3: Append to `src/core/tmux.ts`**

```ts
import { execa } from "execa";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { labelFor, colorFor, labelFmt } from "./colors.js";

// --- pane labels (the three @cs_* user-options) ---
export function paneLabelSetArgs(pane: string, instrument: string, model: string, topic: string): string[][] {
  return [
    setOptionArgs(pane, "@cs_label", labelFor(instrument, model, topic)),
    setOptionArgs(pane, "@cs_color", colorFor(instrument)),
    setOptionArgs(pane, "@cs_label_fmt", labelFmt(instrument, model, topic)),
  ];
}
export async function paneLabelSet(pane: string, instrument: string, model: string, topic: string): Promise<void> {
  for (const args of paneLabelSetArgs(pane, instrument, model, topic)) await execa("tmux", args);
}

// --- graceful kill with FINE banner ---
export function gracefulRespawnCommand(snap: string, pluginRoot: string, label: string, color: string): string {
  return `cat '${snap}'; node '${pluginRoot}/dist/consort.cjs' _banner '${label}' '${color}'; rm -f '${snap}'`;
}

export async function paneLabel(pane: string): Promise<string> {
  try { return (await execa("tmux", ["display-message", "-p", "-t", pane, "#{@cs_label}"])).stdout; } catch { return ""; }
}
export async function paneColor(pane: string): Promise<string> {
  try { return (await execa("tmux", ["display-message", "-p", "-t", pane, "#{@cs_color}"])).stdout; } catch { return ""; }
}

export async function killGraceful(pane: string, pluginRoot: string): Promise<void> {
  if (!(await paneAlive(pane))) return;
  const label = (await paneLabel(pane)) || "part";
  const color = await paneColor(pane);
  const snap = join(mkdtempSync(join(tmpdir(), "cs-snap-")), "snap.txt");
  try {
    const { stdout } = await execa("tmux", ["capture-pane", "-p", "-e", "-t", pane]);
    writeFileSync(snap, stdout);
  } catch { writeFileSync(snap, ""); }
  await respawn(pane, gracefulRespawnCommand(snap, pluginRoot, label, color));
}

// --- preflight grid ---
export interface PreflightEntry { instrument: string; model: string; cwd?: string; }
export async function preflightLayout(topic: string, roster: PreflightEntry[], opts: { writePanes: (tsv: string) => void }): Promise<Array<{ instrument: string; pane: string }>> {
  const conductor = await conductorPane();
  const created: string[] = [];
  const out: Array<{ instrument: string; pane: string }> = [];
  let prev = conductor;
  let flag: "-h" | "-v" = "-h";
  try {
    for (const e of roster) {
      const sentinel = sentinelCommand(labelFmt(e.instrument, e.model, topic));
      const args = ["split-window", "-P", "-F", "#{pane_id}", flag, "-t", prev];
      if (e.cwd) args.push("-c", e.cwd);
      args.push(sentinel);
      const { stdout } = await execa("tmux", args);
      const pane = stdout.trim();
      created.push(pane);
      await paneLabelSet(pane, e.instrument, e.model, topic);
      out.push({ instrument: e.instrument, pane });
      prev = pane;
      flag = "-v";
    }
    await selectLayoutMainVertical(conductor);
    opts.writePanes(out.map((o) => `${o.instrument}\t${o.pane}`).join("\n") + "\n");
    return out;
  } catch (e) {
    for (const p of created) { try { await execa("tmux", ["kill-pane", "-t", p]); } catch { /* */ } }
    throw e;
  }
}
```

> Imports already at top of the file from Plan 01 may overlap (`execa`, `join`); consolidate to a single import block — `tsc`/eslint will flag dupes. Keep one `import { execa } from "execa";` etc.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/tmux-graceful.test.ts`.

- [ ] **Step 5: Commit** — `git add src/core/tmux.ts tests/tmux-graceful.test.ts && git commit -m "feat(core): tmux killGraceful (FINE banner) + preflightLayout + labels"`

---

### Task 17: `src/commands/spawn.ts` — the §7 lifecycle

**Files:**
- Replace: `src/commands/spawn.ts`
- Test: `tests/spawn.test.ts` (pure validation + resolution; live spawn is the Plan 03 dogfood)

Lifecycle (from `bin/spawn.sh`, instrument-renamed): parse `<instrument|random> <model> <topic> [--mode m] [--cwd abs] [--target-pane id] [initial-prompt]`; validate `topic`/`instrument` `^[a-z0-9-]+$` ≤32 (`random` sentinel allowed); env checks (in tmux, tmux≥3.0); resolve `random` via `pickRandomInstrument`; collision check; resolve contract (binary on PATH, modeArgs, readyTimeout, bootstrapSleep); `stateInit` + `identityWrite`; build launch (`binary + modeArgs`, wrapped); split right (first) or down (`.last_pane`) or respawn (`--target-pane`); `paneMetaWrite`; bootstrap sleep; nudge `Read <identity> and follow its instructions exactly.`; wait `{ready,error}`; on timeout/error → `captureFailure` → killNow → `stateArchive FAILED` → return 1; optional initial prompt → `inboxWrite` + nudge; print summary; return 0. Extract pure helpers `validateSlug`, `resolveMode` for unit testing.

- [ ] **Step 1: Write failing test** `tests/spawn.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validateSlug, resolveMode } from "../src/commands/spawn.js";

describe("spawn pure helpers", () => {
  it("validateSlug accepts lowercase/digit/hyphen ≤32, rejects others", () => {
    expect(validateSlug("auth-review")).toBe(true);
    expect(validateSlug("Bad")).toBe(false);
    expect(validateSlug("has space")).toBe(false);
    expect(validateSlug("x".repeat(33))).toBe(false);
    expect(validateSlug("")).toBe(false);
  });
  it("resolveMode: explicit > default > full", () => {
    expect(resolveMode("read-only", "full")).toBe("read-only");
    expect(resolveMode(undefined, "full")).toBe("full");
    expect(resolveMode(undefined, undefined)).toBe("full");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/spawn.test.ts`.

- [ ] **Step 3: Implement `src/commands/spawn.ts`**

```ts
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kvParse } from "../args.js";
import { log } from "../core/log.js";
import { inTmuxSession, tmuxVersionOk, haveCmd } from "../core/deps.js";
import { topicDir, partDir, repoRoot, isArtifactDir } from "../core/paths.js";
import { stateInit, stateArchive } from "../core/archive.js";
import { identityWrite, identityPath, inboxWrite, inboxPath, paneMetaWrite, outboxOffset, outboxPath, outboxWait } from "../core/ipc.js";
import { pickRandomInstrument, instrumentInUse, formatCollisionError } from "../core/instruments.js";
import { instrumentBinary, instrumentDefaultMode, instrumentModeArgs, instrumentReadyTimeout, instrumentBootstrapSleep } from "../core/contracts.js";
import { wrapLaunch, splitRight, splitDown, respawn, paneAlive, paneLabelSet, paneSend, killNow, capturePane, labelForSafe } from "../core/tmux.js";
import { labelFor } from "../core/colors.js";
import { captureFailure } from "../core/forensics.js";

const SLUG = /^[a-z0-9-]+$/;
export function validateSlug(s: string): boolean { return SLUG.test(s) && s.length >= 1 && s.length <= 32; }
export function resolveMode(explicit: string | undefined, dflt: string | undefined): string { return explicit || dflt || "full"; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pluginRoot = () => process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();

export async function run(args: string[]): Promise<number> {
  if (args.length < 3) { log.error("usage: spawn <instrument|random> <model> <topic> [--mode m] [--cwd abs] [--target-pane id] [initial-prompt]"); return 2; }
  let [instrument, model, topic] = args;
  let i = 3, mode = "", cwd = "", targetPane = "", initial = "";
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === "--mode" || a.startsWith("--mode=")) { const r = kvParse(a, args[i + 1]); mode = r.value; i += r.shift - 1; }
    else if (a === "--cwd" || a.startsWith("--cwd=")) { const r = kvParse(a, args[i + 1]); cwd = r.value; i += r.shift - 1; }
    else if (a === "--target-pane" || a.startsWith("--target-pane=")) { const r = kvParse(a, args[i + 1]); targetPane = r.value; i += r.shift - 1; }
    else { initial = args.slice(i).join(" "); break; }
  }

  if (!validateSlug(topic)) { log.error(`topic must match [a-z0-9-]+ and be <= 32 chars; got: '${topic}'`); return 2; }
  if (instrument !== "random" && !validateSlug(instrument)) { log.error(`instrument must match [a-z0-9-]+ and be <= 32 chars (or 'random'); got: '${instrument}'`); return 2; }
  if (cwd && (!cwd.startsWith("/") || !existsSync(cwd))) { log.error(`spawn --cwd must be an existing absolute path: ${cwd}`); return 1; }

  if (!inTmuxSession()) { log.error("must run inside a tmux session"); return 1; }
  if (!haveCmd("tmux")) { log.error("tmux not on PATH"); return 1; }
  if (!tmuxVersionOk()) { log.error("tmux >= 3.0 required"); return 1; }

  if (instrument === "random") {
    const pick = pickRandomInstrument(topic);
    if (!pick) { log.error(`no available instrument in pool for topic '${topic}'`); return 1; }
    instrument = pick; log.info(`random pick: ${instrument}`);
  }
  if (instrumentInUse(instrument, topic)) { for (const l of formatCollisionError(instrument, model, topic).split("\n")) log.error(l); return 1; }

  const binary = instrumentBinary(model);
  if (!binary) { log.error(`model '${model}' has no entry in contracts.yaml`); return 1; }
  if (!haveCmd(binary)) { log.error(`${model}'s binary '${binary}' is not on PATH`); return 1; }
  const useMode = resolveMode(mode, instrumentDefaultMode(model));
  const modeArgs = instrumentModeArgs(model, useMode);
  if (!modeArgs) { log.error(`mode '${useMode}' not defined for ${model} in contracts.yaml`); return 1; }
  const readyTimeout = instrumentReadyTimeout(model);

  log.info(`preparing state for ${instrument}-${model} on ${topic}`);
  stateInit(instrument, model, topic);
  identityWrite(instrument, model, topic);

  const launch = wrapLaunch([binary, ...modeArgs].join(" "));
  const startDir = cwd || repoRoot();
  let pane: string;
  if (targetPane) {
    if (!(await paneAlive(targetPane))) { log.error(`--target-pane ${targetPane} is not alive`); return 1; }
    pane = await respawn(targetPane, launch, startDir);
    await paneLabelSet(pane, instrument, model, topic);
  } else {
    const lastFile = join(topicDir(topic), ".last_pane");
    const prior = existsSync(lastFile) ? readFileSync(lastFile, "utf8").trim() : "";
    if (prior && await paneAlive(prior)) pane = await splitDown(launch, prior, startDir);
    else pane = await splitRight(launch, undefined, startDir);
    await paneLabelSet(pane, instrument, model, topic);
    mkdirSync(topicDir(topic), { recursive: true });
    writeFileSync(lastFile, pane + "\n");
  }
  paneMetaWrite(instrument, model, topic, pane);
  log.ok(`spawned ${labelFor(instrument, model, topic)} in pane ${pane} (mode=${useMode})`);

  const boot = instrumentBootstrapSleep(model);
  log.info(`sleeping ${boot}s for ${model} bootstrap`);
  await sleep(boot * 1000);

  log.info(`asking ${instrument} to read identity`);
  await paneSend(pane, `Read ${identityPath(instrument, model, topic)} and follow its instructions exactly.`);

  log.info(`waiting for {ready,error} in outbox (timeout ${readyTimeout}s)`);
  const ev = await outboxWait(instrument, model, topic, ["ready", "error"], readyTimeout);
  if (!ev || ev.event === "error") {
    const reason = ev ? "error_event" : "timeout";
    const tail = await capturePane(pane, 25);
    process.stderr.write(tail + "\n");
    await captureFailure(
      { instrument, model, topic, paneId: pane, reason: reason as any, eventLine: ev ? JSON.stringify(ev) : undefined, readyTimeout },
      { partDir, capturePane: (p, n) => capturePane(p, n), atomicWriteSync: (d, c) => writeFileSync(d, c), isWritableDir: (d) => existsSync(d), now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
    );
    await killNow(pane);
    const arch = stateArchive(instrument, model, topic, "FAILED");
    log.error(`${instrument} failed bootstrap (${reason}); state archived to: ${arch}`);
    return 1;
  }
  log.ok(`${instrument} is ready`);

  if (initial) {
    initial = initial.replace(/^"|"$/g, "");
    inboxWrite(instrument, model, topic, initial);
    await paneSend(pane, `Read ${inboxPath(instrument, model, topic)} and execute the task. Reply when done.`);
    log.info(`use: consort collect ${instrument} ${topic}  (to wait for {done})`);
  }

  process.stdout.write(`\n  part:    ${labelFor(instrument, model, topic)}\n  pane:    ${pane}\n  state:   ${partDir(instrument, model, topic)}\n  ready:   yes\n`);
  return 0;
}
```

> Remove the stray `labelForSafe` import (artifact) — only `labelFor` from colors is used; `outboxOffset`/`outboxPath` imports may be unused here, drop them so eslint passes. Let `tsc`/lint guide the final import list.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/spawn.test.ts` (pure helpers). Then `npm run typecheck` to confirm the module compiles.

- [ ] **Step 5: Commit** — `git add src/commands/spawn.ts tests/spawn.test.ts && git commit -m "feat(cmd): spawn lifecycle (§7) (TDD on pure helpers)"`

---

### Task 18: `src/commands/preflight.ts`

**Files:**
- Replace: `src/commands/preflight.ts`
- Test: covered by `tmux.preflightLayout` test (T16); add a thin arg-parse test if desired.

Behavior (from `preflight-layout.sh`): `preflight <topic> <N> [--roster i1:m1,i2:m2,...]` — validate `topic` slug, `N` ∈ 2..4, build the roster (from `--roster` or read `<topicDir>/_consult/troopers.txt` if present), call `tmux.preflightLayout`, write `preflight-panes.txt` under the art dir (`<topicDir>/_consult/` by default, or `--art-dir`). For the foundation, accept an explicit `--roster` and `--art-dir`; the consult-derived defaults land with the `score` command.

- [ ] **Step 1: Implement `src/commands/preflight.ts`**

```ts
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { kvParse } from "../args.js";
import { log } from "../core/log.js";
import { topicDir } from "../core/paths.js";
import { atomicWrite } from "../core/atomic.js";
import { preflightLayout, PreflightEntry } from "../core/tmux.js";

const SLUG = /^[a-z0-9-]+$/;

export async function run(args: string[]): Promise<number> {
  if (args.length < 2) { log.error("usage: preflight <topic> <N> [--roster i1:m1,i2:m2,...] [--art-dir abs]"); return 2; }
  const topic = args[0];
  const n = Number(args[1]);
  let rosterArg = "", artDir = "";
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === "--roster" || a.startsWith("--roster=")) { const r = kvParse(a, args[i + 1]); rosterArg = r.value; i += r.shift - 1; }
    else if (a === "--art-dir" || a.startsWith("--art-dir=")) { const r = kvParse(a, args[i + 1]); artDir = r.value; i += r.shift - 1; }
  }
  if (!SLUG.test(topic) || topic.length > 64) { log.error(`topic must match [a-z0-9-]+ and be <= 64 chars; got: '${topic}'`); return 2; }
  if (!Number.isInteger(n) || n < 2 || n > 4) { log.error(`N must be 2..4; got: '${args[1]}'`); return 2; }

  const roster: PreflightEntry[] = rosterArg.split(",").filter(Boolean).map((pair) => {
    const [instrument, model] = pair.split(":");
    return { instrument, model };
  });
  if (roster.length !== n) { log.error(`roster has ${roster.length} entries, expected ${n}`); return 1; }

  const art = artDir || join(topicDir(topic), "_consult");
  mkdirSync(art, { recursive: true });
  const panesFile = join(art, "preflight-panes.txt");
  try {
    const out = await preflightLayout(topic, roster, { writePanes: (tsv) => atomicWrite(panesFile, tsv) });
    log.ok(`preflight: ${out.length} panes allocated for topic ${topic}`);
    for (const o of out) process.stdout.write(`  ${o.instrument}\t${o.pane}\n`);
    return 0;
  } catch (e: any) {
    log.error(`preflight failed: ${e?.message ?? e}`);
    return 1;
  }
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` (no new unit test; the layout logic is covered by T16's `preflightLayout` test and Plan 03's live run).

- [ ] **Step 3: Commit** — `git add src/commands/preflight.ts && git commit -m "feat(cmd): preflight pane-grid pre-allocation"`

---

### Task 19: `src/commands/coda.ts` — graceful teardown (ONE shared 9s wait)

**Files:**
- Replace: `src/commands/coda.ts`
- Test: `tests/coda.test.ts` (the batch-sleep-once invariant + pair collection, via injected deps)

Behavior (from `bin/teardown.sh`): modes `<topic>` | `<instrument> <topic>` | `--all` | `--pairs <topic> <i...>`. `teardownBatch`: Phase 1 graceful-kill alive panes (collect pending); Phase 2 — **if any pending, `sleep(9000)` exactly once**, then `killNow` each; Phase 3 — `stateArchive` every pair (alive or not); Phase 4 — clean `.last_pane`. The structure is dependency-injected so the sleep-once invariant is unit-testable.

- [ ] **Step 1: Write failing test** `tests/coda.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { teardownBatch, GRACEFUL_BATCH_WAIT_MS } from "../src/commands/coda.js";

function deps(alive: Record<string, boolean>) {
  const calls = { graceful: 0, killNow: 0, sleep: 0, archive: 0 };
  return {
    calls,
    d: {
      paneMetaRead: (i: string, _m: string, _t: string) => `%${i}`,
      paneAlive: async (p: string) => alive[p] ?? false,
      killGraceful: async () => { calls.graceful++; },
      killNow: async () => { calls.killNow++; },
      stateArchive: (i: string, m: string) => { calls.archive++; return `/archive/${i}-${m}`; },
      sleep: async (_ms: number) => { calls.sleep++; },
      topicDir: () => "/tmp/none",
      lastPanePath: () => "/tmp/none/.last_pane",
      readLastPane: () => "",
      removeLastPane: () => {},
      pluginRoot: "/plugin",
    },
  };
}

describe("coda batch", () => {
  it("sleeps ONCE for a 3-pane batch and killNow each; archive all", async () => {
    const { calls, d } = deps({ "%violin": true, "%viola": true, "%cello": true });
    await teardownBatch("demo", [
      { instrument: "violin", model: "codex" }, { instrument: "viola", model: "codex" }, { instrument: "cello", model: "codex" },
    ], d as any);
    expect(calls.graceful).toBe(3);
    expect(calls.sleep).toBe(1);              // ONE wait for the whole batch
    expect(calls.killNow).toBe(3);
    expect(calls.archive).toBe(3);
  });
  it("no alive panes → no graceful, no sleep, but still archives every pair", async () => {
    const { calls, d } = deps({});
    await teardownBatch("demo", [{ instrument: "violin", model: "codex" }], d as any);
    expect(calls.graceful).toBe(0);
    expect(calls.sleep).toBe(0);
    expect(calls.archive).toBe(1);
  });
  it("GRACEFUL_BATCH_WAIT_MS is 9000", () => { expect(GRACEFUL_BATCH_WAIT_MS).toBe(9000); });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/coda.test.ts`.

- [ ] **Step 3: Implement `src/commands/coda.ts`**

```ts
import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { topicDir, repoStateDir, isArtifactDir } from "../core/paths.js";
import { stateArchive } from "../core/archive.js";
import { paneMetaRead, paneMetaReadForDir, paneMetaModel } from "../core/ipc.js";
import { paneAlive, killGraceful, killNow } from "../core/tmux.js";

export const GRACEFUL_BATCH_WAIT_MS = 9000;
export interface Pair { instrument: string; model: string; }

export interface CodaDeps {
  paneMetaRead(i: string, m: string, t: string): string | null;
  paneAlive(pane: string): Promise<boolean>;
  killGraceful(pane: string): Promise<void>;
  killNow(pane: string): Promise<void>;
  stateArchive(i: string, m: string, t: string): string | null;
  sleep(ms: number): Promise<void>;
  topicDir(t: string): string;
  readLastPane(t: string): string;
  removeLastPane(t: string): void;
}

export async function teardownBatch(topic: string, pairs: Pair[], d: CodaDeps): Promise<void> {
  const pending: string[] = [];
  for (const { instrument, model } of pairs) {
    const pane = d.paneMetaRead(instrument, model, topic) ?? "";
    if (pane && (await d.paneAlive(pane))) {
      log.info(`graceful shutdown for ${instrument}-${model} on ${topic} (pane ${pane})`);
      await d.killGraceful(pane);
      pending.push(pane);
    }
  }
  if (pending.length > 0) {
    log.info("waiting 9s for graceful banners to finish");
    await d.sleep(GRACEFUL_BATCH_WAIT_MS);
    for (const p of pending) await d.killNow(p);
  }
  for (const { instrument, model } of pairs) {
    const dest = d.stateArchive(instrument, model, topic);
    if (dest) log.ok(`archived ${instrument}-${model}: ${dest}`);
  }
  const last = d.readLastPane(topic);
  if (last && pending.includes(last)) d.removeLastPane(topic);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pluginRoot = () => process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();

function liveDeps(): CodaDeps {
  return {
    paneMetaRead: (i, m, t) => paneMetaRead(i, m, t),
    paneAlive: (p) => paneAlive(p),
    killGraceful: (p) => killGraceful(p, pluginRoot()),
    killNow: (p) => killNow(p),
    stateArchive: (i, m, t) => stateArchive(i, m, t),
    sleep,
    topicDir,
    readLastPane: (t) => { const f = join(topicDir(t), ".last_pane"); return existsSync(f) ? readFileSync(f, "utf8").trim() : ""; },
    removeLastPane: (t) => { try { rmSync(join(topicDir(t), ".last_pane"), { force: true }); } catch { /* */ } },
  };
}

function collectTopicPairs(topic: string): Pair[] {
  const td = topicDir(topic);
  if (!existsSync(td)) return [];
  const pairs: Pair[] = [];
  for (const name of readdirSync(td, { withFileTypes: true })) {
    if (!name.isDirectory() || isArtifactDir(name.name)) continue;
    const m = paneMetaReadForDir(join(td, name.name));
    pairs.push({ instrument: m.instrument, model: m.model });
  }
  return pairs;
}

function collectInstrumentPairs(topic: string, instruments: string[]): Pair[] {
  const td = topicDir(topic);
  if (!existsSync(td)) return [];
  const dirs = readdirSync(td, { withFileTypes: true }).filter((e) => e.isDirectory());
  const pairs: Pair[] = [];
  for (const instrument of instruments) {
    for (const e of dirs) {
      if (e.name === `${instrument}-${e.name.slice(instrument.length + 1)}` && e.name.startsWith(`${instrument}-`)) {
        const m = paneMetaReadForDir(join(td, e.name));
        if (m.instrument === instrument) pairs.push({ instrument, model: m.model });
      }
    }
  }
  return pairs;
}

function cleanupTopicDir(topic: string): void {
  const td = topicDir(topic);
  try { rmSync(join(td, ".last_pane"), { force: true }); } catch { /* */ }
  try { rmdirSync(td); } catch { /* tolerate non-empty */ }
}

export async function run(args: string[]): Promise<number> {
  const d = liveDeps();
  const a0 = args[0] ?? "";
  if (a0 === "" || a0 === "-h" || a0 === "--help") {
    process.stderr.write("Usage: coda <topic>\n       coda <instrument> <topic>\n       coda --all\n       coda --pairs <topic> <i1> [i2...]\n");
    return 2;
  }
  if (a0 === "--all") {
    if (!args.includes("--yes")) {
      log.warn("coda --all tears down EVERY part across every topic in this repo; re-run to confirm: coda --all --yes");
      return 2;
    }
    const repo = repoStateDir();
    if (!existsSync(repo)) { log.info("no state dirs to tear down"); return 0; }
    for (const t of readdirSync(repo, { withFileTypes: true })) {
      if (t.isDirectory()) { await teardownBatch(t.name, collectTopicPairs(t.name), d); cleanupTopicDir(t.name); }
    }
    return 0;
  }
  if (a0 === "--pairs") {
    const topic = args[1];
    const instruments = args.slice(2);
    if (!topic || instruments.length === 0) { log.error("--pairs requires <topic> <i1> [i2...]"); return 2; }
    const pairs = collectInstrumentPairs(topic, instruments);
    if (pairs.length === 0) log.warn(`no matching part dirs found for any of: ${instruments.join(" ")}`);
    else await teardownBatch(topic, pairs, d);
    cleanupTopicDir(topic);
    return 0;
  }
  if (args.length === 1) { await teardownBatch(a0, collectTopicPairs(a0), d); cleanupTopicDir(a0); return 0; }
  if (args.length === 2) {
    const [instrument, topic] = args;
    const pairs = collectInstrumentPairs(topic, [instrument]);
    if (pairs.length === 0) { log.error(`no part '${instrument}' on topic '${topic}'`); return 1; }
    await teardownBatch(topic, pairs, d); cleanupTopicDir(topic);
    return 0;
  }
  process.stderr.write("Usage: coda <topic> | <instrument> <topic> | --all | --pairs <topic> <i...>\n");
  return 2;
}
```

> Note `paneMetaModel` import may be unused — drop per lint. `collectInstrumentPairs`'s match is "dir name starts with `${instrument}-` AND pane.json `instrument` field equals `instrument`" (canonical-field check guards hyphenated models).

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/coda.test.ts`.

- [ ] **Step 5: Commit** — `git add src/commands/coda.ts tests/coda.test.ts && git commit -m "feat(cmd): coda graceful teardown (one shared 9s wait) (TDD)"`

---

### Task 20: `src/commands/send.ts` + `collect.ts`

**Files:**
- Replace: `src/commands/send.ts`, `src/commands/collect.ts`
- Test: `tests/send-collect.test.ts` (model/pane resolution + collect done/error/timeout via seeded state)

`send`: `[--from s] <instrument> <topic> <message|@file>` → resolve model from a `<instrument>-*` dir glob + `paneMetaModel`, resolve pane via `paneMetaRead`, liveness check, `@file` indirection, `inboxWrite` + `paneSend` (fire-and-forget), print status block. `collect`: `<instrument> <topic> [--timeout n]` (default 600) → resolve model, `outboxWait(["done","error"])`, print matched line, exit 0 done / 1 error|timeout.

- [ ] **Step 1: Write failing test** `tests/send-collect.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as collect } from "../src/commands/collect.js";
import { partDir } from "../src/core/paths.js";

afterEach(() => { delete process.env.CONSORT_HOME; });
function seed(i: string, m: string, t: string, outbox: string) {
  const h = mkdtempSync(join(tmpdir(), "sc-")); process.env.CONSORT_HOME = h;
  const d = partDir(i, m, t); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "pane.json"), JSON.stringify({ pane_id: "%1", instrument: i, model: m, spawned_at: "t" }));
  writeFileSync(join(d, "outbox.jsonl"), outbox);
}

describe("collect", () => {
  it("done → exit 0", async () => {
    seed("violin", "codex", "demo", `{"event":"done","summary":"ok","ts":"t"}\n`);
    expect(await collect(["violin", "demo", "--timeout", "3"])).toBe(0);
  });
  it("error → exit 1", async () => {
    seed("violin", "codex", "demo", `{"event":"error","message":"boom","fatal":true,"ts":"t"}\n`);
    expect(await collect(["violin", "demo", "--timeout", "3"])).toBe(1);
  });
  it("false-positive immunity: progress quoting done does not resolve", async () => {
    seed("violin", "codex", "demo", `{"event":"progress","note":"\\"event\\":\\"done\\""}\n`);
    expect(await collect(["violin", "demo", "--timeout", "1"])).toBe(1); // timeout, not done
  });
  it("timeout → exit 1", async () => {
    seed("violin", "codex", "demo", "");
    expect(await collect(["violin", "demo", "--timeout", "1"])).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/send-collect.test.ts`.

- [ ] **Step 3: Implement `src/commands/collect.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kvParse } from "../args.js";
import { log } from "../core/log.js";
import { topicDir } from "../core/paths.js";
import { paneMetaModel, outboxWait, outboxDump } from "../core/ipc.js";

function resolveModel(instrument: string, topic: string): string | null {
  const td = topicDir(topic);
  if (!existsSync(td)) return null;
  const dir = readdirSync(td, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.startsWith(`${instrument}-`));
  if (!dir) return null;
  const hint = dir.name.slice(instrument.length + 1);
  return paneMetaModel(instrument, hint, topic);
}

export async function run(args: string[]): Promise<number> {
  if (args.length < 2) { log.error("usage: collect <instrument> <topic> [--timeout n]"); return 2; }
  const [instrument, topic] = args;
  let timeout = 600;
  for (let i = 2; i < args.length; i++) {
    const a = args[i];
    if (a === "--timeout" || a.startsWith("--timeout=")) { const r = kvParse(a, args[i + 1]); timeout = Number(r.value); i += r.shift - 1; }
    else { log.error(`unknown arg: ${a}`); return 2; }
  }
  const model = resolveModel(instrument, topic);
  if (!model) { log.error(`no part '${instrument}' on topic '${topic}'`); return 1; }
  log.info(`tailing outbox for ${instrument}-${model} (timeout ${timeout}s)`);
  const ev = await outboxWait(instrument, model, topic, ["done", "error"], timeout);
  if (ev?.event === "done") { log.ok("{done} received"); process.stdout.write(JSON.stringify(ev) + "\n"); return 0; }
  if (ev?.event === "error") { log.error(`{error} received from ${instrument}`); process.stdout.write(JSON.stringify(ev) + "\n"); return 1; }
  log.error(`timeout after ${timeout}s; outbox tail:`);
  process.stderr.write(outboxDump(instrument, model, topic).split("\n").slice(-5).join("\n") + "\n");
  return 1;
}
```

- [ ] **Step 4: Implement `src/commands/send.ts`**

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/log.js";
import { topicDir } from "../core/paths.js";
import { paneMetaModel, paneMetaRead, inboxWrite, inboxPath } from "../core/ipc.js";
import { paneAlive, paneSend } from "../core/tmux.js";

export async function run(args: string[]): Promise<number> {
  let from: string | undefined;
  let a = [...args];
  if (a[0] === "--from") { if (!a[1]) { log.error("--from requires a sender name"); return 2; } from = a[1]; a = a.slice(2); }
  if (a.length < 3) { log.error("usage: send [--from s] <instrument> <topic> <message|@file>"); return 2; }
  const [instrument, topic] = a;
  let msg = a.slice(2).join(" ");

  const td = topicDir(topic);
  const dir = existsSync(td) ? readdirSync(td, { withFileTypes: true }).find((e) => e.isDirectory() && e.name.startsWith(`${instrument}-`)) : undefined;
  if (!dir) { log.error(`no part '${instrument}' on topic '${topic}' (state dir absent)`); log.error(`  spawn first: consort spawn ${instrument} <model> ${topic}`); return 1; }
  const model = paneMetaModel(instrument, dir.name.slice(instrument.length + 1), topic);
  const pane = paneMetaRead(instrument, model, topic);
  if (!pane) { log.error(`pane.json missing for ${instrument}-${model} on ${topic}`); return 1; }
  if (!(await paneAlive(pane))) { log.error(`${instrument}'s pane ${pane} is gone (orphan); run consort coda ${instrument} ${topic}`); return 1; }

  if (msg.startsWith("@")) {
    const f = msg.slice(1);
    if (!existsSync(f)) { log.error(`file not found: ${f}`); return 1; }
    msg = readFileSync(f, "utf8");
  }
  inboxWrite(instrument, model, topic, msg, from ? { from } : undefined);
  const inbox = inboxPath(instrument, model, topic);
  log.info(`wrote inbox at ${inbox}; nudging pane ${pane}`);
  await paneSend(pane, `Read ${inbox} and execute the task. Reply when done.`);
  process.stdout.write(`\n  part:    ${instrument}-${model} on ${topic}\n  pane:    ${pane}\n  inbox:   ${inbox}\n  status:  queued — use: consort collect ${instrument} ${topic}  (to wait for {done})\n`);
  return 0;
}
```

- [ ] **Step 5: Run, expect PASS** — `npx vitest run tests/send-collect.test.ts`.

- [ ] **Step 6: Commit** — `git add src/commands/send.ts src/commands/collect.ts tests/send-collect.test.ts && git commit -m "feat(cmd): send + collect (TDD)"`

---

### Task 21: `src/commands/roster.ts` + `soundcheck.ts` + `hook.ts`

**Files:**
- Replace: `src/commands/roster.ts`, `src/commands/soundcheck.ts`, `src/commands/hook.ts`
- Test: `tests/roster.test.ts`, `tests/soundcheck.test.ts`

**roster** (from `bin/list.sh` + `list_stale.sh`): `deriveState(lastEvent)`, `classifyStale(state,outboxPath,thresholdS=180)`, `lastOutboxEvent(outboxPath)`, full `roster(opts)`. Header `PART  MODEL  TOPIC  PANE  STATE`. **soundcheck** (from `medic.sh` + `opencode_preflight.sh`): `opencodePermissionCheck` (JSON.parse `permission`), the health-check sequence, write `providers-available.txt`. **hook**: no-op (prints nothing, exit 0).

- [ ] **Step 1: Write failing tests** `tests/roster.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, utimesSync, closeSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveState, classifyStale, lastOutboxEvent } from "../src/commands/roster.js";

afterEach(() => { /* no env */ });

describe("roster pure logic", () => {
  it("deriveState mapping", () => {
    expect(deriveState(undefined)).toBe("spawning");
    expect(deriveState("done")).toBe("idle (done)");
    expect(deriveState("error")).toBe("idle (error)");
    expect(deriveState("ack")).toBe("working");
    expect(deriveState("ready")).toBe("ready");
    expect(deriveState("progress")).toBe("progress");
    expect(deriveState("question")).toBe("question");
  });
  it("classifyStale only reclassifies working past threshold", () => {
    const f = join(mkdtempSync(join(tmpdir(), "rs-")), "outbox.jsonl");
    closeSync(openSync(f, "w"));
    const old = (Date.now() - 300_000) / 1000;
    utimesSync(f, old, old);
    expect(classifyStale("working", f, 180)).toBe("stale");
    expect(classifyStale("working", f, 999999)).toBe("working");
    expect(classifyStale("idle (done)", f, 1)).toBe("idle (done)");
    expect(classifyStale("working", "/nope/x.jsonl", 180)).toBe("working");
  });
  it("lastOutboxEvent: JSON.parse, embedded-event safe", () => {
    const f = join(mkdtempSync(join(tmpdir(), "le-")), "outbox.jsonl");
    writeFileSync(f, `{"event":"ack"}\n{"event":"progress","note":"\\"event\\":\\"done\\""}\n`);
    expect(lastOutboxEvent(f)).toBe("progress"); // last line's real event, not the quoted "done"
  });
});
```

`tests/soundcheck.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opencodePermissionCheck } from "../src/commands/soundcheck.js";

function cfg(content: string) {
  const f = join(mkdtempSync(join(tmpdir(), "oc-")), "opencode.json");
  writeFileSync(f, content);
  return f;
}

describe("opencode permission check (JSON.parse, not grep)", () => {
  it("allow → rc 0", () => { expect(opencodePermissionCheck(cfg(`{"permission":"allow"}`)).rc).toBe(0); });
  it("ask → rc 1 names value", () => { const r = opencodePermissionCheck(cfg(`{"permission":"ask"}`)); expect(r.rc).toBe(1); expect(r.message).toContain("'ask'"); });
  it("object form → rc 2", () => { expect(opencodePermissionCheck(cfg(`{"permission":{"bash":"allow"}}`)).rc).toBe(2); });
  it("nested per-agent only → rc 1 (no false positive)", () => { expect(opencodePermissionCheck(cfg(`{"agents":{"x":{"permission":"allow"}}}`)).rc).toBe(1); });
  it("mixed case Allow → rc 1", () => { expect(opencodePermissionCheck(cfg(`{"permission":"Allow"}`)).rc).toBe(1); });
  it("missing file → rc 1", () => { expect(opencodePermissionCheck("/nope/opencode.json").rc).toBe(1); });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/roster.test.ts tests/soundcheck.test.ts`.

- [ ] **Step 3: Implement `src/commands/roster.ts`**

```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { repoStateDir, isArtifactDir } from "../core/paths.js";
import { paneMetaReadForDir, outboxPath } from "../core/ipc.js";
import { paneAlive } from "../core/tmux.js";

export function deriveState(lastEvent: string | undefined): string {
  switch (lastEvent) {
    case undefined: case "": return "spawning";
    case "done": return "idle (done)";
    case "error": return "idle (error)";
    case "ack": return "working";
    case "ready": return "ready";
    default: return lastEvent;
  }
}

export function lastOutboxEvent(outbox: string): string | undefined {
  if (!existsSync(outbox)) return undefined;
  const lines = readFileSync(outbox, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) return undefined;
  try { return (JSON.parse(lines[lines.length - 1]) as { event?: string }).event; } catch { return undefined; }
}

export function classifyStale(state: string, outbox: string, thresholdS = 180): string {
  if (state !== "working" || !existsSync(outbox)) return state;
  const t = Number.isInteger(thresholdS) && thresholdS >= 0 ? thresholdS : 180;
  const ageS = (Date.now() - statSync(outbox).mtimeMs) / 1000;
  return ageS > 0 && ageS > t ? "stale" : state;
}

export async function run(args: string[]): Promise<number> {
  const filter = args.find((a) => !a.startsWith("--"));
  const repo = repoStateDir();
  if (!existsSync(repo)) { process.stdout.write(`no parts deployed (state dir absent: ${repo})\n`); return 0; }
  const W = (s: string, n: number) => s.padEnd(n);
  process.stdout.write(`${W("PART", 32)} ${W("MODEL", 8)} ${W("TOPIC", 12)} ${W("PANE", 9)} STATE\n`);
  process.stdout.write(`${"-".repeat(32)} ${"-".repeat(8)} ${"-".repeat(12)} ${"-".repeat(9)} -----\n`);
  for (const t of readdirSync(repo, { withFileTypes: true })) {
    if (!t.isDirectory()) continue;
    if (filter && t.name !== filter) continue;
    const td = join(repo, t.name);
    for (const p of readdirSync(td, { withFileTypes: true })) {
      if (!p.isDirectory() || isArtifactDir(p.name)) continue;
      const dir = join(td, p.name);
      const meta = paneMetaReadForDir(dir);
      const pane = meta.paneId || "?";
      let state = "[ORPHAN]";
      if (pane !== "?" && (await paneAlive(pane))) state = classifyStale(deriveState(lastOutboxEvent(outboxPath(meta.instrument, meta.model, t.name))), outboxPath(meta.instrument, meta.model, t.name));
      process.stdout.write(`${W(meta.instrument, 32)} ${W(meta.model, 8)} ${W(t.name, 12)} ${W(pane, 9)} ${state}\n`);
    }
  }
  return 0;
}
```

- [ ] **Step 4: Implement `src/commands/soundcheck.ts`**

```ts
import { existsSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log } from "../core/log.js";
import { haveCmd, inTmuxSession, tmuxVersionOk, tmuxVersionString } from "../core/deps.js";
import { globalRoot } from "../core/paths.js";
import { atomicWrite } from "../core/atomic.js";
import { contractsExist, listInstruments, instrumentBinary } from "../core/contracts.js";

export interface PermissionResult { rc: 0 | 1 | 2; message?: string; configPath?: string; }

export function opencodeConfigPath(cwd = process.cwd(), home = homedir()): string | null {
  const proj = join(cwd, "opencode.json");
  if (existsSync(proj)) return proj;
  const glob = join(home, ".config", "opencode", "opencode.json");
  return existsSync(glob) ? glob : null;
}

export function opencodePermissionCheck(cfgPath?: string): PermissionResult {
  const p = cfgPath ?? opencodeConfigPath();
  if (!p || !existsSync(p)) return { rc: 1, message: "no opencode.json found" };
  let obj: any;
  try { obj = JSON.parse(readFileSync(p, "utf8")); } catch { return { rc: 1, message: "opencode.json: unparseable", configPath: p }; }
  const perm = obj?.permission;
  if (perm === "allow") return { rc: 0, configPath: p };
  if (typeof perm === "string") return { rc: 1, message: `opencode.json: permission is '${perm}' (need 'allow' for part auto-approve)`, configPath: p };
  if (perm && typeof perm === "object") return { rc: 2, message: "opencode.json: object-form permission detected; soundcheck does not introspect per-tool keys", configPath: p };
  return { rc: 1, message: "opencode.json: no top-level 'permission' key (defaults to 'ask')", configPath: p };
}

const pluginRoot = () => process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();

export async function run(_args: string[]): Promise<number> {
  let fail = 0, warn = 0, ok = 0, total = 0;
  // Ensure the GLOBAL config root early (config copy + providers-available write target it).
  const root = globalRoot();
  try { mkdirSync(root, { recursive: true }); } catch { /* writable check below reports it */ }

  const ver = tmuxVersionString();
  if (!ver) { log.error("tmux: not on PATH (install: https://github.com/tmux/tmux)"); fail = 1; }
  else if (!tmuxVersionOk(ver)) { log.error(`tmux: ${ver} — consort requires >= 3.0`); fail = 1; }
  else log.ok(`tmux: ${ver}`);

  if (inTmuxSession()) log.ok(`tmux session: ${process.env.TMUX} is set`);
  else { log.warn("tmux session: not set — `tmux new -s consort` before spawning"); warn = 1; }

  if (existsSync(root)) log.ok(`state dir: ${root} (writable)`);
  else { log.error(`state dir: ${root} cannot be created or is not writable`); fail = 1; }

  for (const f of ["contracts.yaml", "instruments.yaml"]) {
    const dest = join(globalRoot(), f);
    if (existsSync(dest)) log.ok(`config: ${f}`);
    else {
      const shipped = join(pluginRoot(), "config", f);
      if (existsSync(shipped)) { try { copyFileSync(shipped, dest); log.ok(`config: ${f} (copied default into state dir)`); } catch { log.error(`config: ${f} missing; copy from plugin defaults failed`); fail = 1; } }
      else { log.error(`config: ${f} not in state dir and not shipped at ${shipped}`); fail = 1; }
    }
  }

  const detected: string[] = [];
  if (!contractsExist()) { log.error(`contracts.yaml not found at ${join(globalRoot(), "contracts.yaml")}`); fail = 1; }
  else {
    for (const prov of listInstruments()) {
      total++;
      const bin = instrumentBinary(prov);
      if (!bin) { log.warn(`  ${prov}: binary field missing in contracts.yaml`); continue; }
      if (haveCmd(bin)) { log.ok(`  ${prov} (${bin}): installed`); ok++; detected.push(prov); }
      else log.warn(`  ${prov} (${bin}): not on PATH — skip if you don't use this provider`);
    }
    if (detected.includes("opencode")) {
      const r = opencodePermissionCheck();
      if (r.rc === 0) log.ok("  opencode auto-approve: 'permission: allow' detected");
      else log.warn(`  opencode auto-approve: ${r.message}${r.rc === 2 ? " (non-fatal)" : ""}`);
    }
  }

  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  atomicWrite(join(globalRoot(), "providers-available.txt"),
    `# generated ${stamp} by /consort:soundcheck\n# providers detected with binary on PATH + contracts.yaml row\n${detected.join("\n")}${detected.length ? "\n" : ""}`);

  if (fail !== 0 || ok === 0) {
    if (ok === 0 && total > 0) log.error(`no providers available; install at least one of: ${listInstruments().join(" ")}`);
    process.stdout.write("Verdict: FAIL — fix items above before spawning\n");
    return 1;
  }
  process.stdout.write(`Verdict: OK — ready to spawn (${ok}/${total} providers available; ${warn} warnings)\n`);
  return 0;
}
```

- [ ] **Step 5: Implement `src/commands/hook.ts`** (stub)

```ts
// UserPromptSubmit hook. No-op in the foundation (active-session resume lands with `rehearsal`).
export async function run(_args: string[]): Promise<number> { return 0; }
```

- [ ] **Step 6: Run, expect PASS** — `npx vitest run tests/roster.test.ts tests/soundcheck.test.ts`.

- [ ] **Step 7: Commit** — `git add src/commands/roster.ts src/commands/soundcheck.ts src/commands/hook.ts tests/roster.test.ts tests/soundcheck.test.ts && git commit -m "feat(cmd): roster + soundcheck + hook stub (TDD)"`

---

## Plan 02 close-out

- [ ] **Full green + rebuild:**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
git add dist/consort.cjs && git commit -m "chore: rebuild dist after primitives"
```
Expected: tsc clean, all vitest PASS (incl. dispatcher test against the fresh `dist`), eslint clean.

**Exit state:** working CLI — `node dist/consort.cjs {spawn,send,collect,roster,coda,soundcheck,preflight}` reachable; slash commands wired. Proceed to **Plan 03 — Verify + Dogfood**.

