# Spawn Path Resolution + Spawn-Failure Forensics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pluginRoot()` resolve correctly without relying on `CLAUDE_PLUGIN_ROOT` reaching the subprocess, and make every spawn failure self-report into the `/consort:playback` forensics feed.

**Architecture:** Part 1 — `pluginRoot()` gains a 3-tier precedence (env override → self-locate from the running bundle via `process.argv[1]` → `cwd`), plus a clear error in `identityWrite` when the template is missing. Part 2 — a best-effort `captureSpawnFailure()` writes a `command: spawn` forensics file (reusing `renderArtForensics`, so playback consumes it unchanged); `spawn.ts` calls it at every failure exit. FROZEN protocol, the spawn archive-on-failure timing, and `scrapeArtDir` are untouched.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import suffixes), vitest, esbuild → committed `dist/consort.cjs`. Tests run against `src/*.ts` (not the bundle).

**Spec:** `docs/superpowers/specs/2026-05-31-consort-spawn-resolution-and-failure-forensics-design.md`

**Branch:** `fix/spawn-resolution-forensics` (already created; spec already committed at `820d8ef`).

**Toolchain:** `npm run typecheck` · `npm run test` · `npm run lint` · `npm run build`. `npm run typecheck` is authoritative — editor TS2307/TS2305/TS7006 diagnostics on newly added exports are stale LSP artifacts; trust `typecheck`.

**Commit convention:** end every commit message body with
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**dist policy:** Tasks 1–5 commit `src`/`tests`/`commands` only (vitest runs against `src`, so a stale bundle does not affect the suite). Task 6 does the single `npm run build` + commits the refreshed `dist/consort.cjs`, leaving the branch end-state consistent.

---

### Task 1: Self-locating `pluginRoot()`

**Files:**
- Modify: `src/core/paths.ts` (the `pluginRoot()` function + the `node:path` import)
- Test: `tests/paths-pluginroot.test.ts` (extend)

**Context:** `pluginRoot()` is the single source of truth for the plugin install dir. Today it is `process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd()`. When the command files run `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs` they interpolate the var into the path but do not export it, so the child process falls back to `cwd` (the target repo) and template/skill-hint resolution breaks. The bundle always lives at `<plugin-root>/dist/consort.cjs`, so it can locate its own root from `process.argv[1]`.

- [ ] **Step 1: Extend the failing test**

In `tests/paths-pluginroot.test.ts`, replace the entire file with:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginRoot } from "../src/core/paths.js";

const ORIG = process.env.CLAUDE_PLUGIN_ROOT;
const ORIG_ARGV1 = process.argv[1];
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = ORIG;
  process.argv[1] = ORIG_ARGV1;
});

describe("pluginRoot", () => {
  it("returns CLAUDE_PLUGIN_ROOT when set", () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/x/plugin";
    expect(pluginRoot()).toBe("/x/plugin");
  });

  it("self-locates from the bundle path when CLAUDE_PLUGIN_ROOT is unset", () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const root = mkdtempSync(join(tmpdir(), "consort-plugin-"));
    mkdirSync(join(root, "dist"), { recursive: true });
    mkdirSync(join(root, "config", "prompt-templates"), { recursive: true });
    writeFileSync(join(root, "config", "prompt-templates", "identity.md"), "x");
    writeFileSync(join(root, "dist", "consort.cjs"), "//");
    process.argv[1] = join(root, "dist", "consort.cjs");
    try { expect(pluginRoot()).toBe(realpathSync(root)); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("falls back to cwd when the bundle path has no config asset", () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    const root = mkdtempSync(join(tmpdir(), "consort-noasset-"));
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "consort.cjs"), "//");
    process.argv[1] = join(root, "dist", "consort.cjs");
    try { expect(pluginRoot()).toBe(process.cwd()); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("falls back to process.cwd() when unset and argv[1] is not a bundle", () => {
    delete process.env.CLAUDE_PLUGIN_ROOT;
    process.argv[1] = "/definitely/not/a/consort/bundle/path.js";
    expect(pluginRoot()).toBe(process.cwd());
  });
});
```

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `npm run test -- tests/paths-pluginroot.test.ts`
Expected: the "self-locates from the bundle path" case FAILS (current `pluginRoot()` returns `cwd`, not the temp root). The "returns CLAUDE_PLUGIN_ROOT" and the two cwd-fallback cases PASS.

- [ ] **Step 3: Implement self-location**

In `src/core/paths.ts`, the current import line is:
```ts
import { join, basename } from "node:path";
```
Change it to add `dirname`:
```ts
import { join, basename, dirname } from "node:path";
```

Replace the current function:
```ts
/** Plugin install root: CLAUDE_PLUGIN_ROOT when set, else the process CWD. Single source of truth. */
export function pluginRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
}
```
with:
```ts
/** Plugin install root. Precedence: explicit CLAUDE_PLUGIN_ROOT override -> self-locate from the
 *  running bundle (<root>/dist/consort.cjs) -> process.cwd(). The self-locate tier fixes the case
 *  where command files interpolate ${CLAUDE_PLUGIN_ROOT} into the bundle path but never export it,
 *  so the node child would otherwise fall back to cwd (the target repo). The existsSync guard on a
 *  known shipped asset keeps tests/`node -e` (argv[1] not the bundle) on the cwd fallback. Single
 *  source of truth. */
export function pluginRoot(): string {
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
  try {
    const root = dirname(dirname(realpathSync(process.argv[1])));
    if (existsSync(join(root, "config", "prompt-templates", "identity.md"))) return root;
  } catch { /* argv[1] missing/unreadable — fall through */ }
  return process.cwd();
}
```
(`realpathSync` and `existsSync` are already imported at the top of `paths.ts`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/paths-pluginroot.test.ts`
Expected: all four cases PASS.

- [ ] **Step 5: Typecheck + full suite (regression gate)**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean; full suite green (the prior `pluginRoot` consumers are unaffected because real plugin invocation now self-locates and tests stay on the cwd fallback).

- [ ] **Step 6: Commit**

```bash
git add src/core/paths.ts tests/paths-pluginroot.test.ts
git commit -m "$(cat <<'EOF'
fix(paths): self-locate pluginRoot() from the bundle when CLAUDE_PLUGIN_ROOT is unexported

Command files interpolate ${CLAUDE_PLUGIN_ROOT} into the bundle path but
never export it, so the node child fell back to cwd (the target repo) and
template/skill-hint resolution broke. Add a self-locate tier from
process.argv[1] (<root>/dist/consort.cjs), guarded by an existsSync check
on a known shipped asset so tests stay on the cwd fallback.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Clear error in `identityWrite` when the template is missing

**Files:**
- Modify: `src/core/ipc.ts` (the `identityWrite` function)
- Test: `tests/identity-write.test.ts` (create)

**Context:** `identityWrite` reads `join(pluginRoot(), "config", "prompt-templates", "identity.md")` with no guard, so a wrong `pluginRoot()` produces a raw ENOENT. With Part 1 this should not happen in real invocation, but a clear error makes any residual misconfiguration legible — and its message becomes the forensic `detail` in Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests/identity-write.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { identityWrite } from "../src/core/ipc.js";

const ORIG = process.env.CLAUDE_PLUGIN_ROOT;
afterEach(() => { if (ORIG === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = ORIG; });

describe("identityWrite", () => {
  it("throws a clear error naming the resolved root when the template is missing", () => {
    process.env.CLAUDE_PLUGIN_ROOT = "/nonexistent-plugin-root-xyz";
    expect(() => identityWrite("trumpet", "codex", "some-topic")).toThrow(/identity template not found/);
    expect(() => identityWrite("trumpet", "codex", "some-topic")).toThrow(/CLAUDE_PLUGIN_ROOT/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/identity-write.test.ts`
Expected: FAIL — current code throws a raw `ENOENT … identity.md` error, not matching `/identity template not found/`.

- [ ] **Step 3: Add the guard**

In `src/core/ipc.ts`, the current function starts:
```ts
export function identityWrite(i: string, m: string, t: string): void {
  const tplPath = join(pluginRoot(), "config", "prompt-templates", "identity.md");
  const stateDir = partDir(i, m, t);
  const outbox = outboxPath(i, m, t);
  let body = readFileSync(tplPath, "utf8")
```
Insert the guard immediately after the `tplPath` line:
```ts
export function identityWrite(i: string, m: string, t: string): void {
  const tplPath = join(pluginRoot(), "config", "prompt-templates", "identity.md");
  if (!existsSync(tplPath)) {
    throw new Error(
      `identityWrite: identity template not found at ${tplPath} (resolved pluginRoot=${pluginRoot()}). ` +
      `Set CLAUDE_PLUGIN_ROOT to the consort plugin directory, or run consort from it.`,
    );
  }
  const stateDir = partDir(i, m, t);
  const outbox = outboxPath(i, m, t);
  let body = readFileSync(tplPath, "utf8")
```
(`existsSync` and `pluginRoot` are already imported in `ipc.ts`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/identity-write.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite (regression gate)**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean; full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/core/ipc.ts tests/identity-write.test.ts
git commit -m "$(cat <<'EOF'
fix(ipc): identityWrite throws a clear error when the identity template is missing

Names the resolved pluginRoot and points at CLAUDE_PLUGIN_ROOT instead of
a raw ENOENT. This message becomes the spawn-failure forensic detail.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `captureSpawnFailure()` + `bootstrapFailureArgs()`

**Files:**
- Modify: `src/core/forensics.ts` (add two exports; add `partDir` to the paths import)
- Test: `tests/forensics-spawn-failure.test.ts` (create)

**Context:** Approach A — failures self-report directly to `globalRoot()/forensics/<date>/<time>-spawn-<topic>.md`, reusing `renderArtForensics` so playback's parser/trend/archive consume them unchanged. `bootstrapFailureArgs` is a pure helper computing the `reason`/`detail` for the bootstrap-wait failure (the one spot worth a unit test). `globalRoot()` (`CONSORT_HOME ?? ~/.consort`) is independent of `pluginRoot()`, so this writes to the correct feed even mid-failure. `captureSpawnFailure` is best-effort: it never throws and returns `""` on any error (mirrors `captureArtDir`).

- [ ] **Step 1: Write the failing test**

Create `tests/forensics-spawn-failure.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readdirSync, readFileSync, existsSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { captureSpawnFailure, bootstrapFailureArgs, NO_EVENT_SENTINEL } from "../src/core/forensics.js";
import { parseForensicsFrontmatter, parseMechanicalFindings } from "../src/core/playback.js";
import { globalRoot } from "../src/core/paths.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

function forensicsMd(): string[] {
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

describe("bootstrapFailureArgs", () => {
  it("maps no event to a timeout with the no-event sentinel", () => {
    expect(bootstrapFailureArgs(null, "/p/failure-reason.txt"))
      .toEqual({ reason: "timeout", detail: NO_EVENT_SENTINEL, failureReportPath: "/p/failure-reason.txt" });
  });
  it("maps an error event to error_event with the serialized event line", () => {
    const ev = { event: "error", message: "boom" };
    expect(bootstrapFailureArgs(ev, undefined))
      .toEqual({ reason: "error_event", detail: JSON.stringify(ev), failureReportPath: undefined });
  });
});

describe("captureSpawnFailure", () => {
  it("writes a command:spawn forensics file playback can parse", () => {
    const path = captureSpawnFailure({
      instrument: "trumpet", model: "codex", topic: "plan-x",
      reason: "config_error", detail: "identity template not found",
      failureReportPath: "/p/failure-reason.txt",
    });
    expect(path).not.toBe("");
    const files = forensicsMd();
    expect(files).toEqual([path]);
    const md = readFileSync(path, "utf8");
    const meta = parseForensicsFrontmatter(md);
    expect(meta.command).toBe("spawn");
    expect(meta.topic).toBe("plan-x");
    expect(meta.nFindings).toBe(2);
    const findings = parseMechanicalFindings(md);
    expect(findings.some((f) => f.source === "spawn_failure" && /reason=config_error/.test(f.key))).toBe(true);
    expect(findings.some((f) => /failure_report=\/p\/failure-reason\.txt/.test(f.key))).toBe(true);
    expect(md).toContain("part=trumpet-codex");
  });

  it("emits a single finding when no failure report is given", () => {
    const path = captureSpawnFailure({
      instrument: "viol", model: "claude", topic: "t", reason: "timeout", detail: NO_EVENT_SENTINEL,
    });
    expect(parseForensicsFrontmatter(readFileSync(path, "utf8")).nFindings).toBe(1);
  });

  it("is best-effort: returns '' and writes nothing when the forensics dir can't be created", () => {
    writeFileSync(join(globalRoot(), "forensics"), "x"); // a FILE where the dir would go -> mkdirSync throws
    expect(captureSpawnFailure({ instrument: "a", model: "b", topic: "t", reason: "spawn_error", detail: "x" })).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/forensics-spawn-failure.test.ts`
Expected: FAIL — `captureSpawnFailure` and `bootstrapFailureArgs` are not exported yet.

(Confirmed: `parseForensicsFrontmatter` returns `{ command, topic, nFindings }` and `parseMechanicalFindings` returns `Finding[]` with `{ source, key, context }` — `src/core/playback.ts:7,16,21,25`. The assertions above match these shapes.)

- [ ] **Step 3: Implement the two functions**

In `src/core/forensics.ts`, the current paths import is:
```ts
import { globalRoot, repoHash } from "./paths.js";
```
Change it to:
```ts
import { globalRoot, repoHash, partDir } from "./paths.js";
```

Append these two exports at the end of `src/core/forensics.ts` (after `runForensics`):
```ts
/** Pure mapping of a bootstrap-wait outcome to captureSpawnFailure's reason/detail. ev=null means the
 *  ready-timeout elapsed with no error event; a truthy ev is the error event that arrived instead. */
export function bootstrapFailureArgs(
  ev: { event: string; [k: string]: unknown } | null,
  failureReportPath?: string,
): { reason: string; detail: string; failureReportPath?: string } {
  return ev
    ? { reason: "error_event", detail: JSON.stringify(ev), failureReportPath }
    : { reason: "timeout", detail: NO_EVENT_SENTINEL, failureReportPath };
}

/** Approach A: write a spawn/bootstrap-failure finding straight to the playback feed
 *  (globalRoot()/forensics/<date>/<time>-spawn-<topic>.md, command:spawn), reusing renderArtForensics
 *  so /consort:playback consumes it unchanged. Teardown-independent — works before the part dir exists
 *  and when teardown never runs. Best-effort: returns the written path, or "" on zero-effect / any
 *  error. Never throws. */
export function captureSpawnFailure(opts: {
  instrument: string; model: string; topic: string;
  reason: string; detail: string; failureReportPath?: string; now?: Date;
}): string {
  try {
    const ctx = `part=${opts.instrument}-${opts.model}`;
    const findings: Finding[] = [
      { source: "spawn_failure", key: `reason=${opts.reason} ${opts.detail}`.replace(/\s+/g, " ").trim(), context: ctx },
    ];
    if (opts.failureReportPath) findings.push({ source: "spawn_failure", key: `failure_report=${opts.failureReportPath}`, context: ctx });
    const now = opts.now ?? new Date();
    const iso = now.toISOString();
    const date = iso.slice(0, 10);
    const time = iso.slice(11, 19).replace(/:/g, "-");
    let hash = "unknown"; try { hash = repoHash(); } catch { /* keep unknown */ }
    const dir = join(globalRoot(), "forensics", date);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${time}-spawn-${opts.topic}.md`);
    const md = renderArtForensics(
      { command: "spawn", topicSlug: opts.topic, repoHash: hash, artDir: partDir(opts.instrument, opts.model, opts.topic), invokedAt: iso.replace(/\.\d{3}Z$/, "Z") },
      findings,
    );
    atomicWrite(path, md);
    return path;
  } catch { return ""; }
}
```
(`Finding`, `renderArtForensics`, `NO_EVENT_SENTINEL`, `mkdirSync`, `join`, `atomicWrite` are all already defined/imported in `forensics.ts`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/forensics-spawn-failure.test.ts`
Expected: all cases PASS.

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean; full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/core/forensics.ts tests/forensics-spawn-failure.test.ts
git commit -m "$(cat <<'EOF'
feat(forensics): captureSpawnFailure writes spawn failures straight to the playback feed

Approach A: a best-effort command:spawn forensics file (reusing
renderArtForensics) so /consort:playback surfaces spawn/bootstrap
failures, which the teardown scrape never saw. Adds the pure
bootstrapFailureArgs mapper. globalRoot() is pluginRoot-independent, so
capture works even mid-failure.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire `captureSpawnFailure` into `spawn.ts` failure exits

**Files:**
- Modify: `src/commands/spawn.ts` (import; the three committed-config returns at lines 51/52/55; the spawn body lines 58–113)

**Context:** `spawn.ts::run` is tmux-gated (`inTmuxSession()` returns early outside tmux), so per consort convention (`CLAUDE.md`: "never spawn real panes in unit tests — live behavior is the dogfood") this task adds wiring verified by typecheck + the full suite + reviewer diff-check, with the capture logic itself already unit-tested in Task 3. **No logic changes** beyond best-effort capture calls: `failure-reason.txt`, the `stateArchive` FAILED timing, exit codes, and every existing `log.error` line stay byte-identical.

- [ ] **Step 1: Add the import**

In `src/commands/spawn.ts`, change:
```ts
import { captureFailure } from "../core/forensics.js";
```
to:
```ts
import { captureFailure, captureSpawnFailure, bootstrapFailureArgs } from "../core/forensics.js";
```

- [ ] **Step 2: Instrument the three committed-config returns**

Replace these three lines (currently 51, 52, 55):
```ts
  if (!binary) { log.error(`model '${model}' has no entry in contracts.yaml`); return 1; }
  if (!haveCmd(binary)) { log.error(`${model}'s binary '${binary}' is not on PATH`); return 1; }
```
```ts
  if (!modeArgs) { log.error(`mode '${useMode}' not defined for ${model} in contracts.yaml`); return 1; }
```
with (respectively):
```ts
  if (!binary) { captureSpawnFailure({ instrument, model, topic, reason: "config_error", detail: `model '${model}' has no entry in contracts.yaml` }); log.error(`model '${model}' has no entry in contracts.yaml`); return 1; }
  if (!haveCmd(binary)) { captureSpawnFailure({ instrument, model, topic, reason: "binary_not_found", detail: `${model}'s binary '${binary}' is not on PATH` }); log.error(`${model}'s binary '${binary}' is not on PATH`); return 1; }
```
```ts
  if (!modeArgs) { captureSpawnFailure({ instrument, model, topic, reason: "config_error", detail: `mode '${useMode}' not defined for ${model} in contracts.yaml` }); log.error(`mode '${useMode}' not defined for ${model} in contracts.yaml`); return 1; }
```

- [ ] **Step 3: Wrap the spawn body in try/catch and instrument the pane + bootstrap failures**

Replace the entire current block from line 58 (`log.info(\`preparing state…\`)`) through the function's final `return 0;` / closing brace (lines 58–114) with this exact block (it is the same body re-indented inside `try`, with three additions: the `pane_failed` capture, capturing `captureFailure`'s return into `fr`, the bootstrap `captureSpawnFailure` call, and the `catch`):

```ts
  log.info(`preparing state for ${instrument}-${model} on ${topic}`);
  try {
    stateInit(instrument, model, topic);
    identityWrite(instrument, model, topic);

    const launch = wrapLaunch([binary, ...modeArgs].join(" "));
    const startDir = cwd || repoRoot();
    let pane: string;
    if (targetPane) {
      if (!(await paneAlive(targetPane))) {
        captureSpawnFailure({ instrument, model, topic, reason: "pane_failed", detail: `--target-pane ${targetPane} is not alive` });
        log.error(`--target-pane ${targetPane} is not alive`); return 1;
      }
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
      const fr = await captureFailure(
        { instrument, model, topic, paneId: pane, reason: reason as "timeout" | "error_event", eventLine: ev ? JSON.stringify(ev) : undefined, readyTimeout },
        { partDir, capturePane: (p, n) => capturePane(p, n), atomicWriteSync: (d, c) => writeFileSync(d, c), isWritableDir: (d) => existsSync(d), now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
      );
      captureSpawnFailure({ instrument, model, topic, ...bootstrapFailureArgs(ev ?? null, fr.ok ? fr.path : undefined) });
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
  } catch (e) {
    captureSpawnFailure({ instrument, model, topic, reason: "spawn_error", detail: String((e as Error)?.message ?? e) });
    throw e;
  }
}
```

- [ ] **Step 4: Typecheck (authoritative for this wiring task)**

Run: `npm run typecheck`
Expected: clean. (If the editor shows TS errors on `captureSpawnFailure`/`bootstrapFailureArgs`, ignore — `typecheck` is authoritative.)

- [ ] **Step 5: Full suite + lint (regression gate)**

Run: `npm run test && npm run lint`
Expected: full suite green (no spawn unit tests exist by convention; this proves no regression elsewhere). Lint clean.

- [ ] **Step 6: Reviewer diff-check**

Run: `git diff src/commands/spawn.ts`
Confirm by eye: the only changes are the import, the three `captureSpawnFailure(...)` prefixes on the config returns, the `pane_failed` capture, `fr` capturing `captureFailure`'s result, the bootstrap `captureSpawnFailure(...bootstrapFailureArgs(...))` line, the `try {`/`} catch` wrapper, and re-indentation. Every `log.*` string, `stateArchive(..., "FAILED")`, `captureFailure` deps, and `return` code is unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/commands/spawn.ts
git commit -m "$(cat <<'EOF'
feat(spawn): record every spawn failure into the playback feed

Calls captureSpawnFailure at each failure exit (missing contracts entry /
binary, undefined mode, dead target pane, bootstrap timeout/error) and
wraps the body in try/catch to capture pre-bootstrap throws (e.g. a
missing identity template). failure-reason.txt and the FAILED-archive
timing are unchanged; capture is best-effort and never blocks.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Document the `spawn` emitter in `commands/playback.md`

**Files:**
- Modify: `commands/playback.md` (the intro paragraph + the clustering step)

**Context:** Spawn-failure files are tagged `command: spawn`, so `playback survey` already lists them (it lists all live files regardless of `--command`). Only the docs need to mention the new emitter + finding source so the conductor clusters them sensibly. The stale-token gate scans `commands/`, so avoid the banned terms.

- [ ] **Step 1: Update the intro emitter list**

In `commands/playback.md`, the intro currently reads:
```
Survey the forensics that `/consort:solo`, `/consort:score`, `/consort:perform`, `/consort:prelude`, and
`/consort:rehearsal` record at teardown (each writes a `command:<name>` file under
`~/.consort/forensics/<date>/`), surface what is **new since you last ran playback**, show how often each pattern has
```
Change the parenthetical to add the spawn emitter:
```
Survey the forensics that `/consort:solo`, `/consort:score`, `/consort:perform`, `/consort:prelude`, and
`/consort:rehearsal` record at teardown (each writes a `command:<name>` file under
`~/.consort/forensics/<date>/`; a failed `spawn` also writes a `command:spawn` file at the point of
failure), surface what is **new since you last ran playback**, show how often each pattern has
```

- [ ] **Step 2: Mention the `spawn_failure` source in the clustering step**

In the "Cluster" step (step 4), which currently reads:
```
4. **Cluster.** Group findings whose `source` + meaningful `key`/`context` token match (e.g. all
   `audit_log ISSUE=unresolved_placeholder`; all `outbox` timeout events). Rank clusters by count,
   descending.
```
append one sentence:
```
4. **Cluster.** Group findings whose `source` + meaningful `key`/`context` token match (e.g. all
   `audit_log ISSUE=unresolved_placeholder`; all `outbox` timeout events; all `spawn_failure
   reason=<reason>` events). Rank clusters by count, descending.
```

- [ ] **Step 3: Verify the stale-token gate still passes**

Run: `npm run test -- tests/stale-tokens.test.ts`
Expected: PASS (no banned terms introduced).

- [ ] **Step 4: Commit**

```bash
git add commands/playback.md
git commit -m "$(cat <<'EOF'
docs(playback): document the command:spawn forensics emitter

Note that a failed spawn writes a command:spawn file at the point of
failure, and that spawn_failure is a cluster source.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rebuild `dist`, final full gate

**Files:**
- Modify: `dist/consort.cjs` (rebuilt)

**Context:** `dist/consort.cjs` is committed for zero-build install. Rebuild once here so the branch end-state is consistent, then run the whole gate.

- [ ] **Step 1: Rebuild the bundle**

Run: `npm run build`
Expected: esbuild succeeds; `dist/consort.cjs` regenerated.

- [ ] **Step 2: Confirm the build is deterministic**

Run: `npm run build && git status --porcelain dist/consort.cjs`
Expected: after a second build, `git status` shows `dist/consort.cjs` modified relative to HEAD exactly once (no nondeterministic churn between consecutive builds — the file is byte-stable).

- [ ] **Step 3: Full gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all clean/green — full suite including the new `tests/paths-pluginroot.test.ts`, `tests/identity-write.test.ts`, `tests/forensics-spawn-failure.test.ts`, and `tests/stale-tokens.test.ts`.

- [ ] **Step 4: Bundle sanity — pluginRoot self-locates from a foreign cwd**

Run:
```bash
cd /tmp && CLAUDE_PLUGIN_ROOT= node /home/liupan/CC/consort/dist/consort.cjs playback survey; cd - >/dev/null
```
Expected: exit 0 with a `TRENDS` line (playback reads `globalRoot()`, not `pluginRoot()`, so this simply confirms the rebuilt bundle dispatches and runs from a foreign cwd without `CLAUDE_PLUGIN_ROOT`). The authoritative pluginRoot self-location proof is the Task 1 unit test.

- [ ] **Step 5: Commit the rebuilt bundle**

```bash
git add dist/consort.cjs
git commit -m "$(cat <<'EOF'
build: rebuild dist for spawn resolution + spawn-failure forensics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage:**
- Part 1 self-locating `pluginRoot()` → Task 1. ✓
- Part 1 `identityWrite` clear error → Task 2. ✓
- Part 2 `captureSpawnFailure()` + `bootstrapFailureArgs()` → Task 3. ✓
- Part 2 `spawn.ts` integration at all failure exits → Task 4. ✓
- `commands/playback.md` doc (`command: spawn` emitter + `spawn_failure` source) → Task 5. ✓
- Committed `dist/` rebuild + final gate → Task 6. ✓
- Tests for `pluginRoot` (T1), `identityWrite` error (T2), `captureSpawnFailure` + `bootstrapFailureArgs` (T3). ✓
- Guardrails: FROZEN protocol untouched (no wire renames); stale-token gate run in T5 + T6; `scrapeArtDir` and the FAILED-archive timing unchanged (T4 Step 6 diff-check). ✓

**Type consistency:** `captureSpawnFailure(opts)` and `bootstrapFailureArgs(ev, failureReportPath?)` signatures match between Task 3 (definition), Task 3 tests, and Task 4 (call sites). `bootstrapFailureArgs` returns `{ reason, detail, failureReportPath? }` and is spread into `captureSpawnFailure({ instrument, model, topic, ... })` — field names align. `parseForensicsFrontmatter`/`parseMechanicalFindings` field names (`command`/`topic`/`nFindings`; `source`/`key`/`context`) are flagged in Task 3 Step 2 to confirm against `src/core/playback.ts` before relying on them.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every run step shows the command + expected result.

**Known constraint (stated, not a gap):** `spawn.ts::run` is tmux-gated, so Task 4 has no new unit test by project convention; its capture logic is unit-tested in Task 3 and the wiring is gated by typecheck + full suite + reviewer diff-check, with live spawn→playback behavior verified in a dogfood after merge.
