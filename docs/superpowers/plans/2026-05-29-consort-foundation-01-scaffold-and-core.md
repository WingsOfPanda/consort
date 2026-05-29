# Consort Foundation — Plan 01: Scaffold + Core Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the scaffolded TypeScript project and the fully unit-tested `core/*` + `args` library for the `consort` plugin — the substrate every command reuses. No commands yet; this plan ends with `tsc` clean, `vitest` green, and a building `dist/`.

**Architecture:** A single-file esbuild bundle (`dist/consort.js`) dispatched by subcommand. Logic lives in typed `src/core/*` modules ported behavior-for-behavior from clone-wars Bash (`/home/liupan/CC/clone-wars`), with Bash footguns replaced by typed objects + `JSON.parse`. tmux is the only subprocess surface (via `execa`). The IPC wire protocol and tmux mechanics are preserved byte-for-byte; the only schema rename is `commander`→`instrument` (musical rebrand).

**Tech Stack:** TypeScript (ES2022, NodeNext, strict), esbuild (bundle), vitest (tests), eslint, `execa` (tmux), `yaml` (config). Node ≥18 target; dev on Node 24.

**Companion references (read alongside this plan):**
- Design spec: `docs/superpowers/specs/2026-05-29-consort-foundation-design.md`
- Architecture: `MIGRATION.md`
- Behavioral spec (grep by symbol): `/home/liupan/CC/clone-wars` — esp. `lib/{state,ipc,tmux,colors,contracts,commanders,deps,log,argsfile,forensics}.sh`, `bin/{spawn,preflight-layout,_close-banner}.sh`

**Locked rebrand facts (apply throughout):**
- `commander`→`instrument` (concept + the `pane.json`/`ready` JSON key); worker noun = "part"; conductor = "Maestro"; inbox default sender `From: maestro`.
- `cw_` prefix dropped; `CLONE_WARS_HOME`→`CONSORT_HOME`; `.clone-wars/`→`.consort/`; `commanders.yaml`→`instruments.yaml`.
- tmux options `@cw_*`→`@cs_*`; teardown banner `MISSION ACCOMPLISHED`→`FINE`; the rank/legion concept → orchestral **section**.
- **FROZEN (never rename):** event names `ready/ack/progress/done/error/question`; sentinel `END_OF_INSTRUCTION`; JSON fields `ts/summary/artifacts/note/message/fatal/task_summary/model/topic`; config keys (`binary/modes/default_mode/ready_timeout_s/bootstrap_sleep_s/timeout_multiplier/consult_validated`); state filenames; `CLAUDE_CODE_SESSION_ID`.
- Event matching in TS = `JSON.parse(line)` then `obj.event === name` (NOT the anchored regex).

---

## File Structure

```
src/
  consort.ts            # (Plan 02) dispatcher
  core/
    log.ts              # T4 — info/warn/error/ok → stderr, TTY-guarded
    deps.ts             # T4 — haveCmd, inTmuxSession, tmuxVersionOk
    paths.ts            # T5 — roots, repoHash, topic/partDir, runDir, argsFile
    atomic.ts           # T6 — atomicWrite (tmp+rename), appendJsonl
    archive.ts          # T7 — stateInit, stateArchive, finalizeArchived, archiveTopic
    ipc.ts              # T8 — inbox/identity/outbox/paneMeta + event matching
    tmux.ts             # T9 — arg-builders + execa wrappers + preflightLayout
    colors.ts           # T10 — Morandi palette by section + label builders + banner render
    contracts.ts        # T11 — instruments.yaml → typed; provider fields
    instruments.ts      # T12 — pool, pickRandom, inUse, collision error
    forensics.ts        # T14 — captureFailure (spawn bootstrap-fail)
  args.ts               # T13 — --args-file fence + kvParse
tests/                  # vitest mirrors of the above
config/
  contracts.yaml        # T3 — copied verbatim
  instruments.yaml      # T3 — instrument pool
  prompt-templates/identity.md  # T3 — rewritten (Maestro / part)
.claude-plugin/plugin.json      # T3
commands/{roster,coda,soundcheck}.md  # T3
hooks/                  # T3 — stub
dist/consort.js         # T2 — committed bundle
package.json tsconfig.json vitest.config.ts .eslintrc.cjs  # T1-T2
```

Test helper used throughout: a `tests/helpers/tmpHome.ts` that sets `CONSORT_HOME` to a fresh `mkdtempSync` dir per test and cleans up. Created in T5 (first module needing it).

---

## Phase 0 — Scaffold

### Task 1: Project init + toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "consort",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Multi-model tmux pane orchestration for Claude Code",
  "license": "MIT",
  "scripts": {
    "build": "esbuild src/consort.ts --bundle --platform=node --target=node18 --format=cjs --outfile=dist/consort.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests --ext .ts"
  },
  "dependencies": {
    "execa": "^9.5.1",
    "yaml": "^2.6.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "esbuild": "^0.24.0",
    "eslint": "^9.16.0",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.18.0",
    "vitest": "^2.1.8"
  }
}
```

> Note: bundle `--format=cjs` because the entry uses Node builtins and the plugin invokes it via `node dist/consort.js`; CJS avoids ESM `__dirname` friction inside the single-file bundle. Source stays ESM (`"type":"module"`, NodeNext).

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd /home/liupan/CC/consort && npm install`
Expected: `node_modules/` created, `package-lock.json` written, no error.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: scaffold consort TS project (package.json, tsconfig)"
```

---

### Task 2: Build + test toolchain + hello-world dist

**Files:**
- Create: `vitest.config.ts`, `.eslintrc.cjs` (flat: `eslint.config.js`), `src/consort.ts` (placeholder), `.gitignore`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 2: Write `eslint.config.js`** (flat config, ESLint 9)

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  { ignores: ["dist/", "node_modules/"] },
);
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
*.tmp
.consort/
```

> `dist/` is intentionally NOT ignored — it is the committed zero-build bundle.

- [ ] **Step 4: Write placeholder `src/consort.ts`**

```ts
#!/usr/bin/env node
// Consort CLI entrypoint. Full dispatch table lands in Plan 02.
const [, , sub] = process.argv;
process.stderr.write(`consort: subcommand '${sub ?? ""}' not yet implemented\n`);
process.exit(2);
```

- [ ] **Step 5: Build and smoke-test**

Run: `npm run build && node dist/consort.js spawn`
Expected: stderr `consort: subcommand 'spawn' not yet implemented`, exit code 2. Confirm `dist/consort.js` exists.

- [ ] **Step 6: Typecheck (should be clean with no real modules yet)**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts eslint.config.js .gitignore src/consort.ts dist/consort.js
git commit -m "chore: build/test toolchain + hello-world dist"
```

---

### Task 3: Config, plugin manifest, commands, hooks, stale-token gate

**Files:**
- Create: `config/contracts.yaml`, `config/instruments.yaml`, `config/prompt-templates/identity.md`
- Create: `.claude-plugin/plugin.json`, `commands/roster.md`, `commands/coda.md`, `commands/soundcheck.md`, `hooks/user-prompt-submit.md` (placeholder note)
- Create: `tests/stale-tokens.test.ts`

- [ ] **Step 1: Copy `contracts.yaml` verbatim**

Run: `cp /home/liupan/CC/clone-wars/config/contracts.yaml /home/liupan/CC/consort/config/contracts.yaml`
Then verify it contains rows `codex`, `agy`, `claude`, `opencode` and a `consult:` block. Do NOT edit keys (they are FROZEN config keys).

- [ ] **Step 2: Write `config/instruments.yaml`** (flat list, mirrors `commanders.yaml` shape)

```yaml
# config/instruments.yaml — curated instrument-name pool; user-editable.
# `spawn random <model> <topic>` picks an unused instrument from this pool.
# Names are matched case-insensitively; conventionally lowercase at use site.
# Grouping by section is documentation only; section membership lives in core/colors.ts.
instruments:
  # strings
  - violin
  - viola
  - cello
  - contrabass
  - harp
  # woodwinds
  - flute
  - piccolo
  - oboe
  - clarinet
  - bassoon
  - recorder
  # brass
  - horn
  - trumpet
  - trombone
  - tuba
  - cornet
  # percussion
  - timpani
  - celesta
  - vibraphone
  - marimba
  - xylophone
  - glockenspiel
  # keys
  - piano
  - organ
  - harpsichord
  # early
  - lute
  - theorbo
  - viol
  - sackbut
  - shawm
  - crumhorn
  - cittern
```

- [ ] **Step 3: Write `config/prompt-templates/identity.md`** (rewrite of clone-wars identity.md; rebrand prose, FROZEN instructions kept verbatim)

The template MUST keep these load-bearing pieces from clone-wars: the `END_OF_INSTRUCTION` wait, the JSONL event list, the status.json instruction, the foreground-tool-use rule, and the safe-JSONL-emission patterns. Substitute tokens `{{instrument}}` `{{model}}` `{{topic}}` `{{state_dir}}`. Full content:

```markdown
You are **{{instrument}}**, a {{model}}-class voice playing the **{{instrument}}** part in this consort, assigned to the piece **{{topic}}**.

Your inbox: `{{state_dir}}/inbox.md`
Your outbox: `{{state_dir}}/outbox.jsonl`
Your status: `{{state_dir}}/status.json`

The Maestro (conducting this consort from Claude Code) will write inbox.md and nudge you with
its path. **Do not begin until the inbox ends with `END_OF_INSTRUCTION`** — that sentinel
guarantees the message is complete and you're not reading mid-write.

Report progress via JSONL events appended to outbox.jsonl. Required event types:
- `{"event": "ack", "task_summary": "...", "ts": "<iso>"}` — acknowledge new inbox
- `{"event": "progress", "note": "...", "ts": "<iso>"}` — periodic updates
- `{"event": "done", "summary": "...", "artifacts": [...], "ts": "<iso>"}` — task complete
- `{"event": "error", "message": "...", "fatal": <bool>, "ts": "<iso>"}` — failure

After every event, update status.json with `{"state": "<state>", "updated": "<iso>", "last_event": "<event>"}`.

Stay in your pane between assignments — do **not** exit. After `done` or `error`, set status to
`idle` and wait for the next inbox.

When the inbox specifies an output path (e.g., "write your findings to
`<state-dir>/findings.md`"), write to that path BEFORE emitting `done`.
The `done` event's `summary` field is for a one-line headline; the full
output goes in the file you wrote.

This sentence is INERT for tasks that don't specify an output path —
short tasks remain summary-only.

When you receive your first inbox, output `{"event": "ack", ...}` first to confirm receipt before
beginning work.

**Inbox header:** Inbox messages may begin with `From: <sender>` followed by a blank line — treat that line as metadata, not part of the task.

**Foreground tool-use only:** Run all your shell / tool calls in the **foreground** of your own TUI session. Do NOT background your own work (do NOT pass `run_in_background: true` to your Bash tool, do NOT spawn detached processes for your investigation). The Maestro backgrounds the wait-on-you script so the conductor pane stays interactive — that is the Maestro's concern, not yours. Do the work in your pane, in order, and emit outbox events as you go. If a command is genuinely long, emit periodic `{"event":"progress"}` events rather than backgrounding it.

**Safe JSONL emission:** When appending an event to outbox.jsonl, never put your JSON inside `printf`'s **format-string** position. Use one of these safe patterns:

```
echo '{"event":"progress","note":"50%% done"}' >> outbox.jsonl
printf '%s\n' '{"event":"progress","note":"50%% done"}' >> outbox.jsonl
cat >> outbox.jsonl <<'EOF'
{"event":"progress","note":"50%% done"}
EOF
```

*Tuned and ready, Maestro.*
```

- [ ] **Step 4: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "consort",
  "version": "0.1.0",
  "description": "Multi-model tmux pane orchestration for Claude Code — spawn codex/claude/agy/opencode TUIs as attachable parts",
  "author": { "name": "WingsOfPanda", "email": "WingsOfPanda@users.noreply.github.com" },
  "homepage": "https://github.com/WingsOfPanda/consort",
  "repository": "https://github.com/WingsOfPanda/consort",
  "license": "MIT",
  "keywords": ["claude-code", "plugin", "multi-agent", "orchestration", "tmux", "codex"],
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/consort.js hook user-prompt-submit" } ] }
    ]
  }
}
```

- [ ] **Step 5: Write the three command directives** (the canonical 3-step args-file fence)

`commands/roster.md`:

```markdown
---
description: Show active parts (panes + state); optionally scoped to a topic
argument-hint: [<topic>]
allowed-tools: Bash, Write
---

# /consort:roster

Show every active part across topics, or scope to a single topic.

## Steps

1. Run this Bash block to mint an args path and capture it:
   `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.js roster --mint-args-file`
   (prints an absolute path under `.consort/_args/`).
2. **Write** `$ARGUMENTS` into that exact path using the Write tool (never echo it into a shell).
3. Run: `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.js roster --args-file <path-from-step-1>`
```

`commands/coda.md` (same 3-step shape; `description: Gracefully end parts (FINE banner) and archive their state`, `argument-hint: <topic> | <instrument> <topic> | --all`).

`commands/soundcheck.md` (same shape; `description: Health check (tmux/state/config/providers) + roster picker`, `argument-hint: (no args)`, `allowed-tools: Bash, Write, AskUserQuestion`).

> The `--mint-args-file` subcommand flag is implemented in Plan 02 (dispatcher). For now the files exist; they are inert until the CLI lands.

- [ ] **Step 6: Write `hooks/user-prompt-submit.md`** (placeholder note)

```markdown
# user-prompt-submit hook (stub)

The plugin's UserPromptSubmit hook dispatches to `consort.js hook user-prompt-submit`.
In the foundation it is a no-op (no active-session resume logic yet — that lands with
the `rehearsal` command). Implemented as `src/commands/hook.ts` in Plan 02.
```

- [ ] **Step 7: Write the stale-token grep gate test** `tests/stale-tokens.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

// Fails if Star-Wars / clone-wars residue appears in shipped source, config, or commands.
// Excludes node_modules, dist, docs (the design doc legitimately discusses the rename),
// and this test file itself.
describe("stale-token gate", () => {
  const banned = ["clone-wars", "cw_", "master-yoda", "MISSION ACCOMPLISHED", "@cw_"];
  for (const token of banned) {
    it(`no shipped file contains '${token}'`, () => {
      let out = "";
      try {
        out = execSync(
          `grep -rIn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=docs ` +
          `--exclude-dir=.git --exclude=stale-tokens.test.ts -- ${JSON.stringify(token)} ` +
          `src config commands hooks .claude-plugin || true`,
          { cwd: process.cwd(), encoding: "utf8" },
        );
      } catch { /* grep exit 1 = no match */ }
      expect(out.trim()).toBe("");
    });
  }
});
```

- [ ] **Step 8: Run the gate (expect green)**

Run: `npx vitest run tests/stale-tokens.test.ts`
Expected: PASS (the rewritten identity.md, instruments.yaml, plugin.json contain none of the banned tokens). If it fails, fix the offending file — do not weaken the test.

- [ ] **Step 9: Commit**

```bash
git add config .claude-plugin commands hooks tests/stale-tokens.test.ts
git commit -m "feat: config, plugin manifest, command directives, stale-token gate"
```

---

## Phase 1a — Contract-critical core (sequential TDD)

### Task 4: `core/log.ts` + `core/deps.ts`

**Files:**
- Create: `src/core/log.ts`, `src/core/deps.ts`
- Test: `tests/log.test.ts`, `tests/deps.test.ts`

ANSI: `RED=\x1b[31m GRN=\x1b[32m YEL=\x1b[33m BLU=\x1b[34m RST=\x1b[0m`. Format `{color}{label}{reset}  {msg}\n` (TWO spaces). Labels: `[INFO]` `[WARN]` `[FAIL]` (error→FAIL) `[ OK ]`. All to stderr. tmux: strip leading `tmux `, major before `.`, strip non-digits, `major>=3`.

- [ ] **Step 1: Write failing tests** `tests/log.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { createLogger } from "../src/core/log.js";

function capture(): { lines: string[]; stream: NodeJS.WritableStream } {
  const lines: string[] = [];
  const stream = { write: (s: string) => (lines.push(s), true) } as unknown as NodeJS.WritableStream;
  return { lines, stream };
}

describe("log", () => {
  it("no-color format is byte-exact", () => {
    const { lines, stream } = capture();
    const log = createLogger({ color: false, stream });
    log.info("hi");
    log.error("boom");
    log.ok("done");
    log.warn("careful");
    expect(lines).toEqual(["[INFO]  hi\n", "[FAIL]  boom\n", "[ OK ]  done\n", "[WARN]  careful\n"]);
  });
  it("color on wraps label only", () => {
    const { lines, stream } = capture();
    const log = createLogger({ color: true, stream });
    log.info("hi");
    log.ok("done");
    expect(lines[0]).toBe("\x1b[34m[INFO]\x1b[0m  hi\n");
    expect(lines[1]).toBe("\x1b[32m[ OK ]\x1b[0m  done\n");
  });
  it("joins multiple args with one space", () => {
    const { lines, stream } = capture();
    createLogger({ color: false, stream }).info("a", "b");
    expect(lines[0]).toBe("[INFO]  a b\n");
  });
});
```

`tests/deps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { haveCmd, tmuxVersionOk, inTmuxSession } from "../src/core/deps.js";

describe("deps", () => {
  it("haveCmd true/false", () => {
    expect(haveCmd("sh")).toBe(true);
    expect(haveCmd("cs-definitely-not-a-binary-2026")).toBe(false);
  });
  it("tmuxVersionOk: major>=3 only", () => {
    expect(tmuxVersionOk("tmux 3.0a")).toBe(true);
    expect(tmuxVersionOk("tmux 3.4")).toBe(true);
    expect(tmuxVersionOk("tmux 4.1")).toBe(true);
    expect(tmuxVersionOk("tmux 2.9a")).toBe(false); // looks close but major is 2
    expect(tmuxVersionOk("tmux 1.8")).toBe(false);
  });
  it("inTmuxSession reads TMUX", () => {
    expect(inTmuxSession({})).toBe(false);
    expect(inTmuxSession({ TMUX: "" })).toBe(false);
    expect(inTmuxSession({ TMUX: "/tmp/x,123,0" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — Run: `npx vitest run tests/log.test.ts tests/deps.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement `src/core/log.ts`**

```ts
const C = { red: "\x1b[31m", grn: "\x1b[32m", yel: "\x1b[33m", blu: "\x1b[34m", rst: "\x1b[0m" };

export interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
  ok(...a: unknown[]): void;
}

export function createLogger(opts?: { color?: boolean; stream?: NodeJS.WritableStream }): Logger {
  const stream = opts?.stream ?? process.stderr;
  const color = opts?.color ?? Boolean((stream as NodeJS.WriteStream).isTTY);
  const emit = (col: string, label: string, a: unknown[]) => {
    const tag = color ? `${col}${label}${C.rst}` : label;
    stream.write(`${tag}  ${a.join(" ")}\n`);
  };
  return {
    info: (...a) => emit(C.blu, "[INFO]", a),
    warn: (...a) => emit(C.yel, "[WARN]", a),
    error: (...a) => emit(C.red, "[FAIL]", a),
    ok: (...a) => emit(C.grn, "[ OK ]", a),
  };
}

export const log = createLogger();
```

- [ ] **Step 4: Implement `src/core/deps.ts`**

```ts
import { execFileSync } from "node:child_process";

export function haveCmd(name: string): boolean {
  try {
    execFileSync("command", ["-v", name], { shell: "/bin/bash", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function tmuxVersionString(run?: () => string | null): string | null {
  if (run) return run();
  if (!haveCmd("tmux")) return null;
  try {
    return execFileSync("tmux", ["-V"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function tmuxVersionOk(versionString?: string): boolean {
  const v = versionString ?? tmuxVersionString();
  if (!v) return false;
  const stripped = v.replace(/^tmux /, "");
  const majorRaw = stripped.split(".")[0] ?? "";
  const major = parseInt(majorRaw.replace(/[^0-9]/g, ""), 10);
  return Number.isInteger(major) && major >= 3;
}

export function inTmuxSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TMUX);
}
```

- [ ] **Step 5: Run, expect PASS** — Run: `npx vitest run tests/log.test.ts tests/deps.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/log.ts src/core/deps.ts tests/log.test.ts tests/deps.test.ts
git commit -m "feat(core): log + deps (TDD)"
```

---

### Task 5: `core/paths.ts`

**Files:**
- Create: `src/core/paths.ts`, `tests/helpers/tmpHome.ts`
- Test: `tests/paths.test.ts`

Behavior (from `lib/state.sh`): `stateRoot` = `CONSORT_HOME` verbatim if set, else `${cwd}/.consort`. `globalRoot` = `CONSORT_HOME ?? ${home}/.consort`. `repoHash(cwd)` = `sha256(realpathSync(cwd))` hex, **no trailing newline**. `repoStateDir` = `${stateRoot}/state/${repoHash}`. `topicDir(topic)` = `${repoStateDir}/${topic}`. `partDir(instrument,model,topic)` = `${topicDir}/${instrument}-${model}`. `repoRoot(cwd)` = git toplevel else cwd. `isArtifactDir(p)` = basename starts with `_`. `runDir(command)`: ensure `${stateRoot}/{state,archive}` + `.gitignore='*\n'`, ensure `_run`, sweep `_run/*/` older than `sweepSecs` (default 86400), `mkdtemp(_run/<command>.)`, write its path (no newline) to `_run/.last`, return path. `runDirLast()` reads `.last` (throws if absent). `runArgsFile(command,prefix?)`: runDir(command), ensure `_args`, mkdtemp `_args/<prefix||command>.`, write that path (no newline) to `<runDir>/args-path.txt`, return path. `activeProvidersPath(globalRoot)` = `providers-active.txt` if exists else `providers-available.txt`.

- [ ] **Step 1: Write `tests/helpers/tmpHome.ts`**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function freshHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "consort-test-"));
  process.env.CONSORT_HOME = home;
  return { home, cleanup: () => { delete process.env.CONSORT_HOME; rmSync(home, { recursive: true, force: true }); } };
}
```

- [ ] **Step 2: Write failing tests** `tests/paths.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { realpathSync, existsSync, readFileSync, mkdtempSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as P from "../src/core/paths.js";

afterEach(() => { delete process.env.CONSORT_HOME; });

describe("paths", () => {
  it("stateRoot: default vs env-verbatim", () => {
    delete process.env.CONSORT_HOME;
    expect(P.stateRoot({ cwd: "/proj" })).toBe("/proj/.consort");
    process.env.CONSORT_HOME = "/tmp/xx/cs-test";
    expect(P.stateRoot()).toBe("/tmp/xx/cs-test"); // verbatim, no /.consort suffix
  });
  it("repoHash: 64 lowercase hex, matches node crypto, deterministic", () => {
    const dir = mkdtempSync(join(tmpdir(), "rh-"));
    const expected = createHash("sha256").update(realpathSync(dir), "utf8").digest("hex");
    expect(P.repoHash(dir)).toBe(expected);
    expect(P.repoHash(dir)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("path composition", () => {
    process.env.CONSORT_HOME = "/R";
    const h = P.repoHash(process.cwd());
    expect(P.repoStateDir()).toBe(`/R/state/${h}`);
    expect(P.topicDir("foo")).toBe(`/R/state/${h}/foo`);
    expect(P.partDir("violin", "codex", "foo")).toBe(`/R/state/${h}/foo/violin-codex`);
  });
  it("isArtifactDir", () => {
    expect(P.isArtifactDir("/a/b/_consult")).toBe(true);
    expect(P.isArtifactDir("/a/b/violin-codex")).toBe(false);
  });
  it("runDir: unique, .gitignore, .last, sweep", () => {
    process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "rd-"));
    const a = P.runDir("score");
    const b = P.runDir("score");
    expect(a).not.toBe(b);
    expect(readFileSync(join(process.env.CONSORT_HOME, "_run", ".gitignore"), "utf8")).toBe("*\n");
    expect(P.runDirLast()).toBe(b); // no trailing newline
    // stale sweep
    const stale = join(process.env.CONSORT_HOME, "_run", "score.STALE");
    mkdirSync(stale);
    const old = (Date.now() - 100000_000) / 1000;
    utimesSync(stale, old, old);
    P.runDir("score");
    expect(existsSync(stale)).toBe(false);
  });
  it("runArgsFile records path with no newline", () => {
    process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "ra-"));
    const f = P.runArgsFile("score");
    expect(f).toContain("/_args/");
    const recorded = readFileSync(join(P.runDirLast(), "args-path.txt"), "utf8");
    expect(recorded).toBe(f); // exact, no newline
  });
  it("runDirLast throws when absent", () => {
    process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "rl-"));
    expect(() => P.runDirLast()).toThrow();
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — Run: `npx vitest run tests/paths.test.ts` → FAIL.

- [ ] **Step 4: Implement `src/core/paths.ts`**

```ts
import { createHash } from "node:crypto";
import { realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, rmSync, mkdtempSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

export function globalRoot(home?: string): string {
  return home ?? process.env.CONSORT_HOME ?? join(homedir(), ".consort");
}

export function stateRoot(opts?: { home?: string; cwd?: string }): string {
  if (opts?.home) return opts.home;
  if (process.env.CONSORT_HOME) return process.env.CONSORT_HOME;
  return join(opts?.cwd ?? process.cwd(), ".consort");
}

function ensureGitignore(dir: string): void {
  const gi = join(dir, ".gitignore");
  if (!existsSync(gi)) writeFileSync(gi, "*\n");
}

export function stateEnsure(): string {
  const root = stateRoot();
  mkdirSync(join(root, "state"), { recursive: true });
  mkdirSync(join(root, "archive"), { recursive: true });
  ensureGitignore(root);
  return root;
}

export function repoHash(cwd: string = process.cwd()): string {
  let real: string;
  try { real = realpathSync(cwd); } catch { real = cwd; }
  return createHash("sha256").update(real, "utf8").digest("hex");
}

export function repoStateDir(opts?: { home?: string; cwd?: string }): string {
  return join(stateRoot(opts), "state", repoHash(opts?.cwd));
}
export function topicDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  return join(repoStateDir(opts), topic);
}
export function partDir(instrument: string, model: string, topic: string, opts?: { home?: string; cwd?: string }): string {
  return join(topicDir(topic, opts), `${instrument}-${model}`);
}

export function repoRoot(cwd: string = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return cwd;
  }
}

export function isArtifactDir(p: string): boolean {
  return basename(p.replace(/\/+$/, "")).startsWith("_");
}

export function runDir(command: string, opts?: { sweepSecs?: number }): string {
  if (!command) throw new Error("runDir: missing <command> arg");
  const root = stateEnsure();
  const runRoot = join(root, "_run");
  mkdirSync(runRoot, { recursive: true });
  ensureGitignore(runRoot);
  const sweepMs = (opts?.sweepSecs ?? 86400) * 1000;
  for (const name of readdirSync(runRoot)) {
    const child = join(runRoot, name);
    try {
      const st = statSync(child);
      if (st.isDirectory() && Date.now() - st.mtimeMs > sweepMs) rmSync(child, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
  const dir = mkdtempSync(join(runRoot, `${command}.`));
  writeFileSync(join(runRoot, ".last"), dir); // no trailing newline
  return dir;
}

export function runDirLast(): string {
  const last = join(stateRoot(), "_run", ".last");
  if (!existsSync(last)) throw new Error("runDirLast: .last missing — call runDir first");
  return readFileSync(last, "utf8");
}

export function runArgsFile(command: string, prefix?: string): string {
  const dir = runDir(command);
  const argsDir = join(stateRoot(), "_args");
  mkdirSync(argsDir, { recursive: true });
  const f = mkdtempSync(join(argsDir, `${prefix ?? command}.`)) + "/args";
  writeFileSync(f, ""); // placeholder file at a unique path
  writeFileSync(join(dir, "args-path.txt"), f); // no trailing newline
  return f;
}

export function activeProvidersPath(gRoot: string = globalRoot()): string {
  const active = join(gRoot, "providers-active.txt");
  return existsSync(active) ? active : join(gRoot, "providers-available.txt");
}
```

> Note on `runArgsFile`: clone-wars used `mktemp -p _args <prefix>.XXXXXX` (a file directly in `_args`). We use `mkdtemp` + `/args` to get a guaranteed-unique path without a tmpfile race; the contract the test pins is "returned path is recorded verbatim in `args-path.txt`" and "path is under `_args/`". If exact filename parity matters later, swap to a `randomBytes` suffix on the file itself.

- [ ] **Step 5: Run, expect PASS** — Run: `npx vitest run tests/paths.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/paths.ts tests/paths.test.ts tests/helpers/tmpHome.ts
git commit -m "feat(core): paths (roots, repoHash, partDir, runDir) (TDD)"
```

---

### Task 6: `core/atomic.ts`

**Files:**
- Create: `src/core/atomic.ts`
- Test: `tests/atomic.test.ts`

Behavior: `atomicWrite(dest, content)` = write `${dest}.tmp.<rand>` in same dir, `renameSync` to dest, unlink tmp on throw. `appendJsonl(path, obj)` = `appendFileSync(path, JSON.stringify(obj) + "\n")`.

- [ ] **Step 1: Write failing tests** `tests/atomic.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, appendJsonl } from "../src/core/atomic.js";

describe("atomic", () => {
  it("writes content and leaves no tmp", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-"));
    const dest = join(dir, "status.json");
    atomicWrite(dest, "hello\nworld\n");
    expect(readFileSync(dest, "utf8")).toBe("hello\nworld\n");
    expect(readdirSync(dir).filter((f) => f.startsWith("status.json.tmp"))).toEqual([]);
  });
  it("concurrent-style overwrite stays whole", () => {
    const dir = mkdtempSync(join(tmpdir(), "aw2-"));
    const dest = join(dir, "f");
    for (let i = 0; i < 10; i++) atomicWrite(dest, `writer-${i}\n`);
    expect(readFileSync(dest, "utf8")).toMatch(/^writer-\d+\n$/);
  });
  it("appendJsonl appends one line per object", () => {
    const dir = mkdtempSync(join(tmpdir(), "aj-"));
    const f = join(dir, "outbox.jsonl");
    writeFileSync(f, "");
    appendJsonl(f, { event: "ready", ts: "t" });
    appendJsonl(f, { event: "done", summary: "ok" });
    expect(readFileSync(f, "utf8")).toBe(
      `{"event":"ready","ts":"t"}\n{"event":"done","summary":"ok"}\n`,
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/atomic.test.ts`.

- [ ] **Step 3: Implement `src/core/atomic.ts`**

```ts
import { writeFileSync, renameSync, appendFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";

export function atomicWrite(dest: string, content: string | Buffer): void {
  if (!dest) throw new Error("atomicWrite: missing dest path");
  const tmp = `${dest}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, dest); // atomic within same directory
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw e;
  }
}

export function appendJsonl(path: string, obj: unknown): void {
  appendFileSync(path, JSON.stringify(obj) + "\n");
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/atomic.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/core/atomic.ts tests/atomic.test.ts
git commit -m "feat(core): atomic write + appendJsonl (TDD)"
```

---

### Task 7: `core/archive.ts`

**Files:**
- Create: `src/core/archive.ts`
- Test: `tests/archive.test.ts`

Behavior (from `lib/state.sh` + `lib/ipc.sh`):
- `stateInit(instrument,model,topic)`: mkdir partDir; rm stale `identity.md inbox.md outbox.jsonl status.json pane.json .session_id`; `touch outbox.jsonl`; write `.session_id` = `${CLAUDE_CODE_SESSION_ID ?? "unknown"}\n`.
- `stateArchive(instrument,model,topic,suffix?)`: if partDir absent → return null; `ts=YYYYMMDDTHHMMSSZ`; dest = `${globalRoot}/archive/${repoHash}/${topic}/${instrument}-${model}-${ts}[-${suffix}]`; collision → append `-2`,`-3`,…; mkdir parent; rename; return dest.
- `finalizeArchived(topicDir)`: for each `*/status.json`: JSON.parse → `state="archived"`, `archived_ts=YYYY-MM-DDTHH:MM:SSZ`, preserve other fields; atomicWrite. No-op if dir absent / no files. Idempotent.
- `archiveTopic(topic, suite)`: finalizeArchived(topicDir) then move `${topicDir}/_${suite}` into `${globalRoot}/archive/${repoHash}/${topic}/_${suite}-${ts}[-N]` (cap N at 99). (Foundation includes it for completeness; primitives use `stateArchive`.)
- Timestamp helpers: `archiveTs()` → `YYYYMMDDTHHMMSSZ`; `isoUtc()` → `YYYY-MM-DDTHH:MM:SSZ` (no ms). Both injectable via optional `now: Date`.

- [ ] **Step 1: Write failing tests** `tests/archive.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as A from "../src/core/archive.js";
import { partDir, topicDir } from "../src/core/paths.js";

afterEach(() => { delete process.env.CONSORT_HOME; delete process.env.CLAUDE_CODE_SESSION_ID; });
function home() { const h = mkdtempSync(join(tmpdir(), "ar-")); process.env.CONSORT_HOME = h; return h; }

describe("archive", () => {
  it("stateInit creates clean part dir + session id", () => {
    home();
    process.env.CLAUDE_CODE_SESSION_ID = "sess-123";
    const dir = partDir("violin", "codex", "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "outbox.jsonl"), "STALE\n");
    A.stateInit("violin", "codex", "demo");
    expect(readFileSync(join(dir, "outbox.jsonl"), "utf8")).toBe(""); // touched fresh
    expect(readFileSync(join(dir, ".session_id"), "utf8")).toBe("sess-123\n");
  });
  it("stateArchive moves dir, returns dest, collision suffixes", () => {
    home();
    const dir = partDir("violin", "codex", "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "f"), "x");
    const d1 = A.stateArchive("violin", "codex", "demo", "FAILED", { now: new Date("2026-05-29T14:30:22Z") });
    expect(d1).toContain("/archive/");
    expect(d1).toContain("violin-codex-20260529T143022Z-FAILED");
    expect(existsSync(dir)).toBe(false);
    // second archive same second → -2
    mkdirSync(dir, { recursive: true });
    const d2 = A.stateArchive("violin", "codex", "demo", "FAILED", { now: new Date("2026-05-29T14:30:22Z") });
    expect(d2).not.toBe(d1);
    expect(d2!.endsWith("-2")).toBe(true);
  });
  it("stateArchive returns null when part dir absent", () => {
    home();
    expect(A.stateArchive("ghost", "codex", "demo")).toBeNull();
  });
  it("finalizeArchived sets archived + archived_ts, preserves fields, idempotent", () => {
    home();
    const td = topicDir("demo");
    const p = join(td, "violin-codex");
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, "status.json"), `{"state":"working","updated":"2026-05-25T14:55:44Z","last_event":"heartbeat"}`);
    A.finalizeArchived(td, { now: new Date("2026-05-29T14:30:22Z") });
    let obj = JSON.parse(readFileSync(join(p, "status.json"), "utf8"));
    expect(obj.state).toBe("archived");
    expect(obj.updated).toBe("2026-05-25T14:55:44Z");
    expect(obj.last_event).toBe("heartbeat");
    expect(obj.archived_ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    A.finalizeArchived(td, { now: new Date("2026-05-29T15:00:00Z") }); // idempotent
    const raw = readFileSync(join(p, "status.json"), "utf8");
    expect(raw).not.toContain(",,");
    obj = JSON.parse(raw);
    expect(obj.state).toBe("archived");
  });
  it("finalizeArchived no-op on empty dir", () => {
    home();
    expect(() => A.finalizeArchived(join(process.env.CONSORT_HOME!, "nope"))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/archive.test.ts`.

- [ ] **Step 3: Implement `src/core/archive.ts`**

```ts
import { existsSync, mkdirSync, writeFileSync, renameSync, rmSync, readdirSync, statSync, readFileSync, openSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { partDir, topicDir, globalRoot, repoHash } from "./paths.js";
import { atomicWrite } from "./atomic.js";

export function archiveTs(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "").replace(/Z$/, "Z");
}
// archiveTs → YYYYMMDDTHHMMSSZ
export function isoUtc(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const STALE = ["identity.md", "inbox.md", "outbox.jsonl", "status.json", "pane.json", ".session_id"];

export function stateInit(instrument: string, model: string, topic: string): void {
  const dir = partDir(instrument, model, topic);
  mkdirSync(dir, { recursive: true });
  for (const f of STALE) rmSync(join(dir, f), { force: true });
  closeSync(openSync(join(dir, "outbox.jsonl"), "w")); // touch fresh empty
  writeFileSync(join(dir, ".session_id"), `${process.env.CLAUDE_CODE_SESSION_ID ?? "unknown"}\n`);
}

function uniqueDest(base: string): string {
  if (!existsSync(base)) return base;
  for (let n = 2; n <= 999; n++) { const c = `${base}-${n}`; if (!existsSync(c)) return c; }
  throw new Error("too many same-second archive collisions; aborting");
}

export function stateArchive(instrument: string, model: string, topic: string, suffix?: string, opts?: { now?: Date }): string | null {
  const src = partDir(instrument, model, topic);
  if (!existsSync(src)) return null;
  const ts = archiveTs(opts?.now);
  let base = join(globalRoot(), "archive", repoHash(), topic, `${instrument}-${model}-${ts}`);
  if (suffix) base += `-${suffix}`;
  const dest = uniqueDest(base);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(src, dest);
  return dest;
}

export function finalizeArchived(td: string, opts?: { now?: Date }): void {
  if (!existsSync(td)) return;
  const now = isoUtc(opts?.now);
  for (const name of readdirSync(td)) {
    const sj = join(td, name, "status.json");
    if (!existsSync(sj)) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(readFileSync(sj, "utf8")); } catch { continue; }
    obj.state = "archived";
    obj.archived_ts = now;
    atomicWrite(sj, JSON.stringify(obj));
  }
}

export function archiveTopic(topic: string, suite: "consult" | "deploy" | "meditate", opts?: { now?: Date }): void {
  const td = topicDir(topic);
  finalizeArchived(td, opts);
  const art = join(td, `_${suite}`);
  if (existsSync(art)) {
    const base = join(globalRoot(), "archive", repoHash(), topic, `_${suite}-${archiveTs(opts?.now)}`);
    const dest = uniqueDest(base);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(art, dest);
  }
  try { rmSync(td, { recursive: false, force: false }); } catch { /* rmdir-if-empty equivalent; tolerate non-empty */ }
}
```

> `archiveTs` derivation: `toISOString()` → `2026-05-29T14:30:22.000Z`; strip ms → `2026-05-29T14:30:22Z`; strip `-`/`:` → `20260529T143022Z`. Verify the test's exact expected `20260529T143022Z`.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/archive.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/core/archive.ts tests/archive.test.ts
git commit -m "feat(core): archive (stateInit/stateArchive/finalizeArchived) (TDD)"
```

---

### Task 8: `core/ipc.ts` — inbox / identity / outbox / pane-meta

**Files:**
- Create: `src/core/ipc.ts`
- Test: `tests/ipc.test.ts`

This is the wire-protocol module — the highest-care surface. Behavior from `lib/ipc.sh` digest.

Path helpers wrap `paths.partDir`. `inboxWrite` default sender `maestro`, validate `/^[a-zA-Z0-9_-]+$/`, atomic write of the exact body. `identityWrite` reads `config/prompt-templates/identity.md` under plugin root, substitutes `{{instrument}}/{{model}}/{{topic}}/{{state_dir}}`, appends the ready-instruction block (with `instrument` rename), atomic write. `eventMatches(line,name)` = try `JSON.parse` → `obj.event===name`. `outboxOffset` = `statSync().size` or 0. `outboxWaitSince`/`outboxWait` poll, parse new/all lines, return LAST matching object (tail-n1), null on timeout. `paneMetaWrite` writes `{"pane_id","instrument","model","spawned_at"}`. `paneMetaReadForDir` reads canonical fields, dir-name fallback.

- [ ] **Step 1: Write failing tests** `tests/ipc.test.ts`

```ts
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as IPC from "../src/core/ipc.js";
import { partDir } from "../src/core/paths.js";

beforeEach(() => { process.env.CLAUDE_PLUGIN_ROOT = process.cwd(); });
afterEach(() => { delete process.env.CONSORT_HOME; });
function home() { const h = mkdtempSync(join(tmpdir(), "ipc-")); process.env.CONSORT_HOME = h; return h; }
function seedPart(i: string, m: string, t: string) { const d = partDir(i, m, t); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "outbox.jsonl"), ""); return d; }

describe("ipc inbox", () => {
  it("inboxWrite: From: maestro, END_OF_INSTRUCTION last line, body intact", () => {
    home(); seedPart("violin", "codex", "demo");
    IPC.inboxWrite("violin", "codex", "demo", "do the thing");
    const txt = readFileSync(IPC.inboxPath("violin", "codex", "demo"), "utf8");
    const lines = txt.split("\n");
    expect(lines[0]).toBe("From: maestro");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("do the thing");
    expect(txt.trimEnd().split("\n").at(-1)).toBe("END_OF_INSTRUCTION");
    expect(txt).toContain('`{"event":"done","summary":"<one-line summary>","ts":"<iso-timestamp>"}`');
  });
  it("inboxWrite: --from override and validation", () => {
    home(); seedPart("violin", "codex", "demo");
    IPC.inboxWrite("violin", "codex", "demo", "t", { from: "cello" });
    expect(readFileSync(IPC.inboxPath("violin", "codex", "demo"), "utf8").split("\n")[0]).toBe("From: cello");
    expect(() => IPC.inboxWrite("violin", "codex", "demo", "t", { from: "bad name!" })).toThrow();
    expect(() => IPC.inboxWrite("violin", "codex", "demo", "t", { from: "" })).toThrow();
  });
});

describe("ipc identity", () => {
  it("identityWrite substitutes tokens + appends instrument ready block", () => {
    home(); const d = seedPart("violin", "codex", "demo");
    IPC.identityWrite("violin", "codex", "demo");
    const txt = readFileSync(join(d, "identity.md"), "utf8");
    expect(txt).toContain("**violin**");        // {{instrument}}
    expect(txt).toContain("codex-class");        // {{model}}
    expect(txt).toContain("**demo**");           // {{topic}}
    expect(txt).toContain(d);                    // {{state_dir}}
    expect(txt).toContain('"event":"ready"');
    expect(txt).toContain('\\"instrument\\":\\"violin\\"'); // ready block uses instrument, not commander
    expect(txt).not.toContain("commander");
  });
});

describe("ipc outbox", () => {
  it("eventMatches: no substring false-positive", () => {
    expect(IPC.eventMatches('{"event":"progress","note":"said \\"event\\":\\"done\\" earlier"}', "done")).toBe(false);
    expect(IPC.eventMatches('{"event":"done","summary":"ok"}', "done")).toBe(true);
    expect(IPC.eventMatches("not json", "done")).toBe(false);
  });
  it("outboxOffset bytes", () => {
    home(); const d = seedPart("violin", "codex", "demo");
    writeFileSync(join(d, "outbox.jsonl"), "hello world"); // 11 bytes, no newline
    expect(IPC.outboxOffset(join(d, "outbox.jsonl"))).toBe(11);
    expect(IPC.outboxOffset(join(d, "nope.jsonl"))).toBe(0);
  });
  it("outboxWait returns LAST matching event (tail-n1), done resolves fast", async () => {
    home(); const d = seedPart("violin", "codex", "demo");
    writeFileSync(join(d, "outbox.jsonl"),
      `{"event":"ack","task_summary":"x"}\n` +
      `{"event":"progress","note":"\\"event\\":\\"done\\" inside"}\n` +
      `{"event":"done","summary":"first"}\n` +
      `{"event":"done","summary":"actually finished"}\n`);
    const ev = await IPC.outboxWait("violin", "codex", "demo", ["done", "error"], 5);
    expect(ev?.event).toBe("done");
    expect(ev?.summary).toBe("actually finished");
  });
  it("outboxWait times out → null", async () => {
    home(); seedPart("violin", "codex", "demo");
    const ev = await IPC.outboxWait("violin", "codex", "demo", ["done"], 1);
    expect(ev).toBeNull();
  });
  it("outboxWaitSince only matches after offset", async () => {
    home(); const d = seedPart("violin", "codex", "demo");
    writeFileSync(join(d, "outbox.jsonl"), `{"event":"done","summary":"stale"}\n`);
    const off = IPC.outboxOffset(join(d, "outbox.jsonl"));
    const p = IPC.outboxWaitSince("violin", "codex", "demo", off, ["done"], 3);
    writeFileSync(join(d, "outbox.jsonl"),
      `{"event":"done","summary":"stale"}\n{"event":"done","summary":"fresh"}\n`);
    const ev = await p;
    expect(ev?.summary).toBe("fresh");
  });
});

describe("ipc pane meta", () => {
  it("paneMeta round-trips hyphenated model via JSON, not dir parse", () => {
    home(); seedPart("violin", "claude-haiku", "demo");
    IPC.paneMetaWrite("violin", "claude-haiku", "demo", "%99");
    const m = IPC.paneMetaReadForDir(partDir("violin", "claude-haiku", "demo"));
    expect(m).toEqual({ instrument: "violin", model: "claude-haiku", paneId: "%99" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/ipc.test.ts`.

- [ ] **Step 3: Implement `src/core/ipc.ts`**

```ts
import { statSync, readFileSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { partDir } from "./paths.js";
import { atomicWrite } from "./atomic.js";

export function inboxPath(i: string, m: string, t: string) { return join(partDir(i, m, t), "inbox.md"); }
export function outboxPath(i: string, m: string, t: string) { return join(partDir(i, m, t), "outbox.jsonl"); }
export function identityPath(i: string, m: string, t: string) { return join(partDir(i, m, t), "identity.md"); }
export function statusPath(i: string, m: string, t: string) { return join(partDir(i, m, t), "status.json"); }
export function paneMetaPath(i: string, m: string, t: string) { return join(partDir(i, m, t), "pane.json"); }

const SENDER_RE = /^[a-zA-Z0-9_-]+$/;

export function inboxWrite(i: string, m: string, t: string, task: string, opts?: { from?: string }): void {
  const from = opts?.from ?? "maestro";
  if (!SENDER_RE.test(from)) throw new Error(`inboxWrite: invalid sender name '${from}' (allowed: [a-zA-Z0-9_-])`);
  const outbox = outboxPath(i, m, t);
  const body =
    `From: ${from}\n\n${task}\n\nWhen done, append a single JSONL line to ${outbox}:\n\n` +
    '`{"event":"done","summary":"<one-line summary>","ts":"<iso-timestamp>"}`\n\nEND_OF_INSTRUCTION\n';
  atomicWrite(inboxPath(i, m, t), body);
}

function pluginRoot(): string {
  return process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd();
}

export function identityWrite(i: string, m: string, t: string): void {
  const tplPath = join(pluginRoot(), "config", "prompt-templates", "identity.md");
  const stateDir = partDir(i, m, t);
  const outbox = outboxPath(i, m, t);
  let body = readFileSync(tplPath, "utf8")
    .replaceAll("{{instrument}}", i)
    .replaceAll("{{model}}", m)
    .replaceAll("{{topic}}", t)
    .replaceAll("{{state_dir}}", stateDir);
  body += `\n\n---\n\n**First action (do this immediately, then wait):**\n\n` +
    `Append exactly ONE JSONL line to ${outbox}. The line MUST be:\n\n` +
    '`{"event":"ready","ts":"<ISO-8601 UTC>","instrument":"' + i + '","model":"' + m + '"}`\n\n' +
    `Generate the timestamp at the moment you emit. Use this shell command verbatim:\n\n` +
    '`echo "{\\"event\\":\\"ready\\",\\"ts\\":\\"$(date -u +' + "'%Y-%m-%dT%H:%M:%SZ'" + ')\\",\\"instrument\\":\\"' + i + '\\",\\"model\\":\\"' + m + '\\"}" >> ' + outbox + '`\n\n' +
    `Then stop and wait. I will send another instruction asking you to read your inbox.\n`;
  atomicWrite(identityPath(i, m, t), body);
}

export interface OutboxEvent { event: string; ts?: string; [k: string]: unknown; }

export function eventMatches(line: string, name: string): boolean {
  try { return (JSON.parse(line) as OutboxEvent).event === name; } catch { return false; }
}

export function outboxOffset(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

function readFrom(path: string, offset: number): string {
  const size = outboxOffset(path);
  if (size <= offset) return "";
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    return buf.toString("utf8");
  } finally { closeSync(fd); }
}

function lastMatch(text: string, events: string[]): OutboxEvent | null {
  const lines = text.split("\n").filter(Boolean);
  for (let k = lines.length - 1; k >= 0; k--) {
    try {
      const obj = JSON.parse(lines[k]) as OutboxEvent;
      if (events.includes(obj.event)) return obj;
    } catch { /* skip non-JSON */ }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function outboxWaitSince(i: string, m: string, t: string, offset: number, events: string[], timeoutSec: number): Promise<OutboxEvent | null> {
  const path = outboxPath(i, m, t);
  for (let n = 0; n < timeoutSec; n++) {
    const hit = lastMatch(readFrom(path, offset), events);
    if (hit) return hit;
    await sleep(1000);
  }
  return null;
}

export async function outboxWait(i: string, m: string, t: string, events: string[], timeoutSec: number): Promise<OutboxEvent | null> {
  return outboxWaitSince(i, m, t, 0, events, timeoutSec);
}

export function outboxDump(i: string, m: string, t: string): string {
  const p = outboxPath(i, m, t);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

export function paneMetaWrite(i: string, m: string, t: string, paneId: string, opts?: { now?: Date }): void {
  const spawned = (opts?.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  atomicWrite(paneMetaPath(i, m, t), JSON.stringify({ pane_id: paneId, instrument: i, model: m, spawned_at: spawned }) + "\n");
}

export interface PaneMeta { instrument: string; model: string; paneId: string; }

export function paneMetaReadForDir(dir: string): PaneMeta {
  const p = join(dir, "pane.json");
  if (existsSync(p)) {
    try {
      const o = JSON.parse(readFileSync(p, "utf8"));
      if (o.instrument && o.model) return { instrument: o.instrument, model: o.model, paneId: o.pane_id ?? "" };
    } catch { /* fall through */ }
  }
  const name = dir.replace(/\/+$/, "").split("/").pop() ?? "";
  return { instrument: name.replace(/-[^-]*$/, ""), model: name.replace(/^.*-/, ""), paneId: "" };
}

export function paneMetaRead(i: string, m: string, t: string): string | null {
  const p = paneMetaPath(i, m, t);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")).pane_id ?? null; } catch { return null; }
}

export function paneMetaModel(i: string, modelHint: string, t: string): string {
  const p = paneMetaPath(i, modelHint, t);
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")).model ?? modelHint; } catch { /* */ } }
  return modelHint;
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/ipc.test.ts`. (If the identity ready-block escaping assertion fails, adjust the `\\"instrument\\"` construction until the emitted text contains the literal `\"instrument\":\"violin\"` the test checks.)

- [ ] **Step 5: Commit**

```bash
git add src/core/ipc.ts tests/ipc.test.ts
git commit -m "feat(core): ipc wire protocol — inbox/identity/outbox/paneMeta (TDD)"
```

---

### Task 9: `core/tmux.ts` — arg builders + execa wrappers + preflight

**Files:**
- Create: `src/core/tmux.ts`
- Test: `tests/tmux.test.ts` (pure arg-builders only; live tmux gated behind `CONSORT_LIVE_TMUX=1`)

Pure builders (return `string[]` arg arrays) are the unit-tested surface; the execa wrappers just run them. Behavior from `lib/tmux.sh` + `bin/spawn.sh` + `preflight-layout.sh`.

- [ ] **Step 1: Write failing tests** `tests/tmux.test.ts`

```ts
import { describe, it, expect } from "vitest";
import * as T from "../src/core/tmux.js";

describe("tmux arg builders", () => {
  it("splitRightArgs: -h, capture pane id, cwd, target", () => {
    expect(T.splitRightArgs("LAUNCH", "%1", "/repo")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-h", "-t", "%1", "-c", "/repo", "LAUNCH"]);
    expect(T.splitRightArgs("LAUNCH", undefined, "/repo")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-h", "-c", "/repo", "LAUNCH"]);
  });
  it("splitDownArgs: -v, requires target", () => {
    expect(T.splitDownArgs("LAUNCH", "%2", "/repo")).toEqual(
      ["split-window", "-P", "-F", "#{pane_id}", "-v", "-t", "%2", "-c", "/repo", "LAUNCH"]);
  });
  it("respawnArgs: -k, optional cwd", () => {
    expect(T.respawnArgs("%3", "LAUNCH", "/repo")).toEqual(
      ["respawn-pane", "-k", "-t", "%3", "-c", "/repo", "LAUNCH"]);
    expect(T.respawnArgs("%3", "LAUNCH")).toEqual(["respawn-pane", "-k", "-t", "%3", "LAUNCH"]);
  });
  it("wrapLaunch: bashrc wrap when present", () => {
    expect(T.wrapLaunch("codex --foo", true)).toBe("bash -ic 'exec codex --foo'");
    expect(T.wrapLaunch("codex --foo", false)).toBe("codex --foo");
  });
  it("setOptionArgs / sendKeysLiteralArgs / sendKeysEnterArgs", () => {
    expect(T.setOptionArgs("%1", "@cs_color", "colour110")).toEqual(
      ["set-option", "-p", "-t", "%1", "@cs_color", "colour110"]);
    expect(T.sendKeysLiteralArgs("%1", "Read x")).toEqual(["send-keys", "-t", "%1", "-l", "Read x"]);
    expect(T.sendKeysEnterArgs("%1")).toEqual(["send-keys", "-t", "%1", "Enter"]);
  });
  it("sentinelCommand holds pane open with colored label", () => {
    const c = T.sentinelCommand("#[fg=colour110,bold]strings-violin#[default]");
    expect(c).toContain("reserved — awaiting spawn");
    expect(c).toContain("sleep infinity");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/tmux.test.ts`.

- [ ] **Step 3: Implement `src/core/tmux.ts`**

```ts
import { execa } from "execa";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ---------- pure arg builders (unit-tested) ----------
export function splitRightArgs(launch: string, target?: string, cwd?: string): string[] {
  const a = ["split-window", "-P", "-F", "#{pane_id}", "-h"];
  if (target) a.push("-t", target);
  if (cwd) a.push("-c", cwd);
  a.push(launch);
  return a;
}
export function splitDownArgs(launch: string, target: string, cwd?: string): string[] {
  const a = ["split-window", "-P", "-F", "#{pane_id}", "-v", "-t", target];
  if (cwd) a.push("-c", cwd);
  a.push(launch);
  return a;
}
export function respawnArgs(pane: string, launch: string, cwd?: string): string[] {
  const a = ["respawn-pane", "-k", "-t", pane];
  if (cwd) a.push("-c", cwd);
  a.push(launch);
  return a;
}
export function setOptionArgs(pane: string, opt: string, val: string): string[] {
  return ["set-option", "-p", "-t", pane, opt, val];
}
export function sendKeysLiteralArgs(pane: string, line: string): string[] {
  return ["send-keys", "-t", pane, "-l", line];
}
export function sendKeysEnterArgs(pane: string): string[] {
  return ["send-keys", "-t", pane, "Enter"];
}
export function wrapLaunch(launch: string, hasBashrc: boolean = existsSync(join(homedir(), ".bashrc"))): string {
  return hasBashrc ? `bash -ic 'exec ${launch}'` : launch;
}
export function sentinelCommand(labelFmt: string): string {
  // printf the colored label + reserved notice, then hold the pane open.
  return `printf '%s\\n  preflight pane reserved — awaiting spawn...\\n' ${JSON.stringify(labelFmt)}; sleep infinity`;
}

// ---------- execa wrappers (live tmux) ----------
async function tmux(args: string[]): Promise<string> {
  const { stdout } = await execa("tmux", args);
  return stdout.trim();
}
export const splitRight = (launch: string, target?: string, cwd?: string) => tmux(splitRightArgs(launch, target, cwd));
export const splitDown = (launch: string, target: string, cwd?: string) => tmux(splitDownArgs(launch, target, cwd));
export const respawn = (pane: string, launch: string, cwd?: string) => tmux(respawnArgs(pane, launch, cwd));

export async function setOption(pane: string, opt: string, val: string): Promise<void> { await tmux(setOptionArgs(pane, opt, val)); }

export async function paneAlive(pane: string): Promise<boolean> {
  const { stdout } = await execa("tmux", ["list-panes", "-a", "-F", "#{pane_id}"]);
  return stdout.split("\n").includes(pane);
}

export async function paneSend(pane: string, line: string): Promise<void> {
  await execa("tmux", sendKeysLiteralArgs(pane, line));
  await new Promise((r) => setTimeout(r, 300)); // load-bearing beat before Enter
  await execa("tmux", sendKeysEnterArgs(pane));
}

export async function capturePane(pane: string, lines?: number): Promise<string> {
  try {
    const { stdout } = await execa("tmux", ["capture-pane", "-p", "-t", pane]);
    return lines ? stdout.split("\n").slice(-lines).join("\n") : stdout;
  } catch { return ""; }
}

export async function killNow(pane: string): Promise<void> {
  try { await execa("tmux", ["kill-pane", "-t", pane]); } catch { /* tolerate */ }
}

export async function selectLayoutMainVertical(target: string): Promise<void> {
  await execa("tmux", ["select-layout", "-t", target, "main-vertical"]);
}

export async function conductorPane(): Promise<string> {
  if (process.env.TMUX_PANE) return process.env.TMUX_PANE;
  return tmux(["display-message", "-p", "#{pane_id}"]);
}
```

> `killGraceful` (the FINE-banner respawn) and `preflightLayout` (the orchestrated grid) are wired in Plan 02 because they depend on `colors` (Task 10) + the `_banner` dispatcher subcommand. Their tmux primitives (`respawn`, `capturePane`, `selectLayoutMainVertical`, `setOption`, `conductorPane`) are all here.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/tmux.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/core/tmux.ts tests/tmux.test.ts
git commit -m "feat(core): tmux arg-builders + execa wrappers (TDD on pure builders)"
```

---

### Task 10: `core/colors.ts` — Morandi palette by section + label builders + banner head

**Files:**
- Create: `src/core/colors.ts`
- Test: `tests/colors.test.ts`

Keep the clone-wars Morandi 256-color values; re-key to instruments grouped by orchestral **section**; `sectionFor` replaces `rank_for`; label = `<section>-<instrument>:<model>:<topic>`. Fallback (unknown instrument) → section `tutti`, primary `white`, secondary `default`.

- [ ] **Step 1: Write failing tests** `tests/colors.test.ts`

```ts
import { describe, it, expect } from "vitest";
import * as C from "../src/core/colors.js";

describe("colors", () => {
  it("sectionFor maps instruments to orchestral sections", () => {
    expect(C.sectionFor("violin")).toBe("strings");
    expect(C.sectionFor("trumpet")).toBe("brass");
    expect(C.sectionFor("oboe")).toBe("woodwinds");
    expect(C.sectionFor("timpani")).toBe("percussion");
    expect(C.sectionFor("piano")).toBe("keys");
    expect(C.sectionFor("lute")).toBe("early");
    expect(C.sectionFor("zzz-unknown")).toBe("tutti");
  });
  it("colorFor returns Morandi primary; unknown → white", () => {
    expect(C.colorFor("violin")).toBe("colour110");
    expect(C.colorFor("zzz-unknown")).toBe("white");
  });
  it("labelFor: <section>-<instrument>:<model>:<topic>", () => {
    expect(C.labelFor("violin", "codex", "auth-review")).toBe("strings-violin:codex:auth-review");
  });
  it("labelFmt: colored striped border fragment", () => {
    const f = C.labelFmt("violin", "codex", "demo");
    expect(f).toBe("#[fg=colour110,bold]strings-violin#[default]:#[fg=colour187,bold]codex#[default]:demo");
  });
  it("ansiFromColor: colourNNN and bare number", () => {
    expect(C.ansiFromColor("colour110")).toBe("\x1b[38;5;110m");
    expect(C.ansiFromColor("42")).toBe("\x1b[38;5;42m");
    expect(C.ansiFromColor("white")).toBe("");
  });
  it("renderBannerHead: FINE banner, no MISSION ACCOMPLISHED", () => {
    const head = C.renderBannerHead("strings-violin:codex:demo", "colour110");
    expect(head).toContain("FINE — pane closing");
    expect(head).toContain("strings-violin:codex:demo");
    expect(head).not.toContain("MISSION ACCOMPLISHED");
    expect(head).toContain("━");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/colors.test.ts`.

- [ ] **Step 3: Implement `src/core/colors.ts`**

```ts
// Morandi 256-color palette (values verbatim from clone-wars lib/colors.sh),
// re-keyed to instruments grouped by orchestral section for harmony.
type Section = "strings" | "woodwinds" | "brass" | "percussion" | "keys" | "early" | "tutti";

interface Entry { section: Section; primary: string; secondary: string; }

const PALETTE: Record<string, Entry> = {
  // strings — cool dusty blues/slate
  violin:     { section: "strings", primary: "colour110", secondary: "colour187" },
  viola:      { section: "strings", primary: "colour109", secondary: "colour187" },
  cello:      { section: "strings", primary: "colour67",  secondary: "colour187" },
  contrabass: { section: "strings", primary: "colour60",  secondary: "colour250" },
  harp:       { section: "strings", primary: "colour103", secondary: "colour187" },
  // woodwinds — sage/olive earth tones
  flute:      { section: "woodwinds", primary: "colour108", secondary: "colour144" },
  piccolo:    { section: "woodwinds", primary: "colour144", secondary: "colour247" },
  oboe:       { section: "woodwinds", primary: "colour100", secondary: "colour137" },
  clarinet:   { section: "woodwinds", primary: "colour101", secondary: "colour241" },
  bassoon:    { section: "woodwinds", primary: "colour95",  secondary: "colour241" },
  recorder:   { section: "woodwinds", primary: "colour152", secondary: "colour187" },
  // brass — terracotta/warm
  horn:       { section: "brass", primary: "colour137", secondary: "colour187" },
  trumpet:    { section: "brass", primary: "colour173", secondary: "colour144" },
  trombone:   { section: "brass", primary: "colour180", secondary: "colour247" },
  tuba:       { section: "brass", primary: "colour131", secondary: "colour110" },
  cornet:     { section: "brass", primary: "colour223", secondary: "colour174" },
  // percussion — neutral greys
  timpani:    { section: "percussion", primary: "colour102", secondary: "colour247" },
  celesta:    { section: "percussion", primary: "colour245", secondary: "colour187" },
  vibraphone: { section: "percussion", primary: "colour243", secondary: "colour250" },
  marimba:    { section: "percussion", primary: "colour96",  secondary: "colour250" },
  xylophone:  { section: "percussion", primary: "colour250", secondary: "colour241" },
  glockenspiel:{ section: "percussion", primary: "colour247", secondary: "colour250" },
  // keys — cream/beige
  piano:      { section: "keys", primary: "colour187", secondary: "colour250" },
  organ:      { section: "keys", primary: "colour181", secondary: "colour250" },
  harpsichord:{ section: "keys", primary: "colour146", secondary: "colour250" },
  // early — mauve/plum
  lute:       { section: "early", primary: "colour139", secondary: "colour241" },
  theorbo:    { section: "early", primary: "colour97",  secondary: "colour187" },
  viol:       { section: "early", primary: "colour132", secondary: "colour137" },
  sackbut:    { section: "early", primary: "colour138", secondary: "colour241" },
  shawm:      { section: "early", primary: "colour174", secondary: "colour250" },
  crumhorn:   { section: "early", primary: "colour182", secondary: "colour250" },
  cittern:    { section: "early", primary: "colour218", secondary: "colour250" },
};

const FALLBACK: Entry = { section: "tutti", primary: "white", secondary: "default" };
function entry(instrument: string): Entry { return PALETTE[instrument.toLowerCase()] ?? FALLBACK; }

export function sectionFor(instrument: string): Section { return entry(instrument).section; }
export function colorFor(instrument: string): string { return entry(instrument).primary; }

export function labelFor(instrument: string, model: string, topic: string): string {
  return `${sectionFor(instrument)}-${instrument}:${model}:${topic}`;
}

export function labelFmt(instrument: string, model: string, topic: string): string {
  const e = entry(instrument);
  return `#[fg=${e.primary},bold]${e.section}-${instrument}#[default]:#[fg=${e.secondary},bold]${model}#[default]:${topic}`;
}

export function ansiFromColor(color: string): string {
  const m = /^colour([0-9]+)$/.exec(color);
  if (m) return `\x1b[38;5;${m[1]}m`;
  if (/^[0-9]+$/.test(color)) return `\x1b[38;5;${color}m`;
  return "";
}

const RULE = "━".repeat(41);
export function renderBannerHead(label: string, color: string): string {
  const c = ansiFromColor(color), r = "\x1b[0m", b = "\x1b[1m";
  return [
    "",
    `  ${c}${RULE}${r}`,
    `  ${b}${c}${label || "part"}${r}`,
    `  ${c}FINE — pane closing${r}`,
    `  ${c}${RULE}${r}`,
    "",
  ].join("\n");
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/colors.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/core/colors.ts tests/colors.test.ts
git commit -m "feat(core): Morandi palette re-keyed by orchestral section + FINE banner head (TDD)"
```

---

## Phase 1b — Independent leaf modules (fan-out candidates)

> These four modules are self-contained and may be implemented in parallel (subagent each), then integrated. Each is a full TDD task below.

### Task 11: `core/contracts.ts`

**Files:**
- Create: `src/core/contracts.ts`
- Test: `tests/contracts.test.ts`

Parse `<globalRoot>/instruments... ` — NO: contracts come from `contracts.yaml`. Path = `<globalRoot>/contracts.yaml`, fall back to `<pluginRoot>/config/contracts.yaml`. Parse with `yaml`. Defaults: `ready_timeout_s`→30; `bootstrap_sleep_s`→ claude:12 else 8; `timeout_multiplier` accept `/^[0-9]+(\.[0-9]+)?$/ && >0` else `"1.0"` (keep string). `consultValidated`→`true` iff `=== true`. `consultTimeout(kind)` defaults research=600/verify=300/adversary=600/experiment=1800, accept `/^[1-9][0-9]*$/`. `listInstruments` excludes reserved key `consult`, preserves file order.

- [ ] **Step 1: Write failing tests** `tests/contracts.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as K from "../src/core/contracts.js";

afterEach(() => { delete process.env.CONSORT_HOME; });
function withContracts(yaml: string) {
  const h = mkdtempSync(join(tmpdir(), "ct-"));
  process.env.CONSORT_HOME = h;
  writeFileSync(join(h, "contracts.yaml"), yaml);
  return h;
}
const SAMPLE = `
codex:
  binary: codex
  modes: { full: [--dangerously-bypass-approvals-and-sandbox], read-only: [--sandbox, read-only] }
  default_mode: full
  ready_timeout_s: 90
  bootstrap_sleep_s: 20
  consult_validated: true
claude:
  binary: claude
  modes: { full: [--permission-mode, auto] }
  ready_timeout_s: 60
  consult_validated: true
opencode:
  binary: opencode
  modes: { full: [-m, deepseek/deepseek-v4-pro] }
  ready_timeout_s: 60
  bootstrap_sleep_s: 15
  timeout_multiplier: 2.5
  consult_validated: false
consult:
  research_timeout_s: 600
  verify_timeout_s: 300
`;

describe("contracts", () => {
  it("listInstruments: file order, excludes consult", () => {
    withContracts(SAMPLE);
    expect(K.listInstruments()).toEqual(["codex", "claude", "opencode"]);
  });
  it("binary / default_mode / modeArgs", () => {
    withContracts(SAMPLE);
    expect(K.instrumentBinary("codex")).toBe("codex");
    expect(K.instrumentBinary("nope")).toBeUndefined();
    expect(K.instrumentModeArgs("codex", "read-only")).toEqual(["--sandbox", "read-only"]);
    expect(K.instrumentModeArgs("opencode", "full")).toEqual(["-m", "deepseek/deepseek-v4-pro"]);
  });
  it("readyTimeout default 30; bootstrapSleep claude=12 else 8", () => {
    withContracts(SAMPLE);
    expect(K.instrumentReadyTimeout("codex")).toBe(90);
    expect(K.instrumentReadyTimeout("claude")).toBe(60);
    expect(K.instrumentBootstrapSleep("codex")).toBe(20);
    expect(K.instrumentBootstrapSleep("claude")).toBe(12);   // absent → claude default 12
    expect(K.instrumentBootstrapSleep("opencode")).toBe(15);
    expect(K.instrumentBootstrapSleep("unknownx")).toBe(8);
  });
  it("timeoutMultiplier keeps string, bad→1.0", () => {
    withContracts(SAMPLE);
    expect(K.instrumentTimeoutMultiplier("opencode")).toBe("2.5");
    expect(K.instrumentTimeoutMultiplier("codex")).toBe("1.0");
  });
  it("consultValidated safe default false", () => {
    withContracts(SAMPLE);
    expect(K.instrumentConsultValidated("codex")).toBe(true);
    expect(K.instrumentConsultValidated("opencode")).toBe(false);
    expect(K.instrumentConsultValidated("absent")).toBe(false);
  });
  it("consultTimeout defaults + bad-kind throws", () => {
    withContracts(SAMPLE);
    expect(K.consultTimeout("research")).toBe(600);
    expect(K.consultTimeout("adversary")).toBe(600); // absent → default
    expect(K.consultTimeout("experiment")).toBe(1800);
    expect(() => K.consultTimeout("bogus" as any)).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/contracts.test.ts`.

- [ ] **Step 3: Implement `src/core/contracts.ts`**

```ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { globalRoot } from "./paths.js";

function pluginRoot(): string { return process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd(); }
export function contractsPath(): string {
  const user = join(globalRoot(), "contracts.yaml");
  return existsSync(user) ? user : join(pluginRoot(), "config", "contracts.yaml");
}

export interface Instrument {
  binary?: string;
  modes?: Record<string, string[]>;
  default_mode?: string;
  ready_timeout_s?: number;
  bootstrap_sleep_s?: number;
  timeout_multiplier?: unknown;
  consult_validated?: boolean;
}
type Doc = Record<string, any>;

function load(): Doc {
  const p = contractsPath();
  if (!existsSync(p)) return {};
  try { return (parse(readFileSync(p, "utf8")) as Doc) ?? {}; } catch { return {}; }
}

export function listInstruments(): string[] {
  return Object.keys(load()).filter((k) => k !== "consult");
}
function inst(name: string): Instrument | undefined {
  const d = load(); return name !== "consult" ? (d[name] as Instrument) : undefined;
}

export function instrumentBinary(name: string): string | undefined { return inst(name)?.binary || undefined; }
export function instrumentDefaultMode(name: string): string | undefined { return inst(name)?.default_mode || undefined; }
export function instrumentModeArgs(name: string, mode: string): string[] | undefined {
  const m = inst(name)?.modes?.[mode];
  return Array.isArray(m) ? m.map(String) : undefined;
}
export function instrumentReadyTimeout(name: string): number {
  const v = inst(name)?.ready_timeout_s;
  return typeof v === "number" ? v : 30;
}
export function instrumentBootstrapSleep(name: string): number {
  const v = inst(name)?.bootstrap_sleep_s;
  if (typeof v === "number") return v;
  return name === "claude" ? 12 : 8;
}
export function instrumentTimeoutMultiplier(name: string): string {
  const raw = inst(name)?.timeout_multiplier;
  const s = raw == null ? "" : String(raw);
  if (/^[0-9]+(\.[0-9]+)?$/.test(s) && Number(s) > 0) return s;
  return "1.0";
}
export function instrumentConsultValidated(name: string): boolean {
  if (!name) throw new TypeError("instrumentConsultValidated: missing provider arg");
  return inst(name)?.consult_validated === true;
}

export type ConsultKind = "research" | "verify" | "adversary" | "experiment";
const CONSULT_DEFAULTS: Record<ConsultKind, number> = { research: 600, verify: 300, adversary: 600, experiment: 1800 };
export function consultTimeout(kind: ConsultKind): number {
  if (!(kind in CONSULT_DEFAULTS)) throw new Error(`consultTimeout: kind must be 'research', 'verify', 'adversary', or 'experiment'; got '${kind}'`);
  const v = (load().consult ?? {})[`${kind}_timeout_s`];
  return /^[1-9][0-9]*$/.test(String(v)) ? Number(v) : CONSULT_DEFAULTS[kind];
}

export function contractsExist(): boolean { return existsSync(contractsPath()); }
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/contracts.test.ts`.

- [ ] **Step 5: Commit** — `git add src/core/contracts.ts tests/contracts.test.ts && git commit -m "feat(core): contracts.yaml typed parse (TDD)"`

---

### Task 12: `core/instruments.ts`

**Files:**
- Create: `src/core/instruments.ts`
- Test: `tests/instruments.test.ts`

Behavior from `lib/commanders.sh`. Pool from `<globalRoot>/instruments.yaml` else `<pluginRoot>/config/instruments.yaml`, parse `instruments:` list. `pickRandomInstrument(topic, rng?)`: prefer globally-unused, fallback topic-unused, null if none. `instrumentInUse`/`inUseInTopic`/`inUseGlobally` read `pane.json` `instrument` field (canonical, not dir-name). `formatCollisionError(instrument,model,topic,sessionId?)`: 3 lines, line 2 only if owner present and differs; uses `/consort:coda` command (rebranded teardown).

- [ ] **Step 1: Write failing tests** `tests/instruments.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as I from "../src/core/instruments.js";
import { partDir } from "../src/core/paths.js";

afterEach(() => { delete process.env.CONSORT_HOME; delete process.env.CLAUDE_CODE_SESSION_ID; });
function home() {
  const h = mkdtempSync(join(tmpdir(), "in-"));
  process.env.CONSORT_HOME = h;
  writeFileSync(join(h, "instruments.yaml"), "instruments:\n  - violin\n  - viola\n  - cello\n");
  return h;
}
function seed(i: string, m: string, t: string) {
  const d = partDir(i, m, t); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "pane.json"), JSON.stringify({ pane_id: "%1", instrument: i, model: m, spawned_at: "t" }));
  return d;
}

describe("instruments", () => {
  it("loadInstrumentPool parses list", () => {
    home();
    expect(I.loadInstrumentPool()).toEqual(["violin", "viola", "cello"]);
  });
  it("inUse reads canonical instrument field (hyphenated model safe)", () => {
    home(); seed("violin", "claude-haiku", "demo");
    expect(I.instrumentInUse("violin", "demo")).toBe(true);
    expect(I.instrumentInUse("viola", "demo")).toBe(false);
    expect(I.instrumentsInUseInTopic("demo")).toContain("violin");
  });
  it("pickRandom prefers globally-unused, deterministic with one candidate", () => {
    home(); seed("violin", "codex", "t1"); seed("viola", "codex", "t2");
    expect(I.pickRandomInstrument("new", () => 0)).toBe("cello"); // only globally-unused
  });
  it("pickRandom null when saturated", () => {
    home(); seed("violin", "codex", "x"); seed("viola", "codex", "x"); seed("cello", "codex", "x");
    expect(I.pickRandomInstrument("x", () => 0)).toBeNull();
  });
  it("collision: foreign owner shows owned-by line + coda command", () => {
    home();
    const d = seed("violin", "codex", "demo");
    writeFileSync(join(d, ".session_id"), "aaaaaaaa-1111\n");
    const msg = I.formatCollisionError("violin", "codex", "demo", "bbbbbbbb-2222");
    expect(msg).toContain("violin is already deployed on demo; pick another instrument");
    expect(msg).toContain("owned by another Claude Code session");
    expect(msg).toContain("aaaaaaaa");
    expect(msg).toContain("/consort:coda violin demo");
  });
  it("collision: same session omits owned-by line", () => {
    home();
    const d = seed("violin", "codex", "demo");
    writeFileSync(join(d, ".session_id"), "same\n");
    const msg = I.formatCollisionError("violin", "codex", "demo", "same");
    expect(msg).not.toContain("owned by another");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/instruments.test.ts`.

- [ ] **Step 3: Implement `src/core/instruments.ts`**

```ts
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { globalRoot, repoStateDir, topicDir, partDir, isArtifactDir } from "./paths.js";
import { paneMetaReadForDir } from "./ipc.js";

function pluginRoot(): string { return process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd(); }
export function instrumentsPath(): string {
  const user = join(globalRoot(), "instruments.yaml");
  return existsSync(user) ? user : join(pluginRoot(), "config", "instruments.yaml");
}

export function loadInstrumentPool(): string[] {
  const p = instrumentsPath();
  if (!existsSync(p)) return [];
  try {
    const doc = parse(readFileSync(p, "utf8"));
    const list = Array.isArray(doc) ? doc : doc?.instruments;
    return Array.isArray(list) ? list.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch { return []; }
}

function instrumentsInDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (!name.isDirectory() || isArtifactDir(name.name)) continue;
    const meta = paneMetaReadForDir(join(dir, name.name));
    if (meta.instrument) out.push(meta.instrument);
  }
  return out;
}

export function instrumentsInUseInTopic(topic: string): string[] {
  return [...new Set(instrumentsInDir(topicDir(topic)))].sort();
}
export function instrumentInUse(instrument: string, topic: string): boolean {
  return instrumentsInUseInTopic(topic).includes(instrument);
}
export function instrumentsInUseGlobally(): string[] {
  const repo = repoStateDir();
  if (!existsSync(repo)) return [];
  const all: string[] = [];
  for (const t of readdirSync(repo, { withFileTypes: true })) {
    if (t.isDirectory()) all.push(...instrumentsInDir(join(repo, t.name)));
  }
  return [...new Set(all)].sort();
}

export function pickRandomInstrument(topic: string, rng: () => number = Math.random): string | null {
  const pool = loadInstrumentPool();
  const global = new Set(instrumentsInUseGlobally());
  let candidates = pool.filter((x) => !global.has(x));
  if (candidates.length === 0) {
    const local = new Set(instrumentsInUseInTopic(topic));
    candidates = pool.filter((x) => !local.has(x));
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

export function formatCollisionError(instrument: string, model: string, topic: string, sessionId?: string): string {
  const lines = [`${instrument} is already deployed on ${topic}; pick another instrument`];
  const sidFile = join(partDir(instrument, model, topic), ".session_id");
  let owner = "";
  if (existsSync(sidFile)) owner = readFileSync(sidFile, "utf8").split("\n")[0] ?? "";
  const me = sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? "unknown";
  if (owner && owner !== me) lines.push(`  owned by another Claude Code session (id=${owner.slice(0, 8)}…, mine=${me.slice(0, 8)}…)`);
  lines.push(`  or run: /consort:coda ${instrument} ${topic}`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/instruments.test.ts`.

- [ ] **Step 5: Commit** — `git add src/core/instruments.ts tests/instruments.test.ts && git commit -m "feat(core): instruments pool/pickRandom/collision (TDD)"`

---

### Task 13: `src/args.ts` — args-file fence + kvParse

**Files:**
- Create: `src/args.ts`
- Test: `tests/args.test.ts`

Behavior from `lib/argsfile.sh`. `tokenizeArgsLine` = POSIX single/double-quote splitter (metachars stay literal). `applyArgsFile(argv)`: `--args-file <path>` → load tokens (first line) + consume (delete) + append remaining; `--args-file` with no path → throw `ArgsFileError{code:2}`; missing file → silent fallback. `kvParse(flag,next?)`: `--f=v`→`{value,shift:1}`; `--f v`→`{value:next,shift:2}`; `next===undefined`→throw `KvError{code:2}`; `next===""`→ok.

- [ ] **Step 1: Write failing tests** `tests/args.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenizeArgsLine, applyArgsFile, kvParse, ArgsFileError, KvError } from "../src/args.js";

describe("args", () => {
  it("tokenize preserves quoted phrases + literal metachars", () => {
    expect(tokenizeArgsLine('violin codex demo "hello world"')).toEqual(["violin", "codex", "demo", "hello world"]);
    expect(tokenizeArgsLine('a "; touch /tmp/x; #"')).toEqual(["a", "; touch /tmp/x; #"]);
  });
  it("applyArgsFile passthrough + empty", () => {
    expect(applyArgsFile(["foo", "bar"])).toEqual(["foo", "bar"]);
    expect(applyArgsFile([])).toEqual([]);
  });
  it("applyArgsFile loads + consumes + appends", () => {
    const f = join(mkdtempSync(join(tmpdir(), "af-")), "args");
    writeFileSync(f, 'violin codex auth-review "hello world"');
    expect(applyArgsFile(["--args-file", f, "extra1"])).toEqual(["violin", "codex", "auth-review", "hello world", "extra1"]);
    expect(existsSync(f)).toBe(false); // consumed
  });
  it("applyArgsFile: no path throws code 2", () => {
    expect(() => applyArgsFile(["--args-file"])).toThrow(ArgsFileError);
  });
  it("applyArgsFile: missing file → silent fallback", () => {
    expect(applyArgsFile(["--args-file", "/nope/x", "extra"])).toEqual(["extra"]);
  });
  it("kvParse forms", () => {
    expect(kvParse("--mode=test")).toEqual({ value: "test", shift: 1 });
    expect(kvParse("--mode", "v")).toEqual({ value: "v", shift: 2 });
    expect(kvParse("--targets", "")).toEqual({ value: "", shift: 2 }); // empty ok
    expect(kvParse("--mode=a=b=c")).toEqual({ value: "a=b=c", shift: 1 }); // first = only
    expect(() => kvParse("--mode")).toThrow(KvError);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/args.test.ts`.

- [ ] **Step 3: Implement `src/args.ts`**

```ts
import { readFileSync, existsSync, rmSync } from "node:fs";

export class ArgsFileError extends Error { code = 2; }
export class KvError extends Error { code = 2; constructor(public flag: string) { super(`${flag} requires a value`); } }

export function tokenizeArgsLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inS = false, inD = false, started = false;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (inS) { if (ch === "'") inS = false; else cur += ch; continue; }
    if (inD) { if (ch === '"') inD = false; else cur += ch; continue; }
    if (ch === "'") { inS = true; started = true; continue; }
    if (ch === '"') { inD = true; started = true; continue; }
    if (ch === " " || ch === "\t") { if (started) { out.push(cur); cur = ""; started = false; } continue; }
    cur += ch; started = true;
  }
  if (started) out.push(cur);
  return out;
}

export function loadArgsFile(path: string): string[] {
  if (!existsSync(path)) return [];
  const first = readFileSync(path, "utf8").split("\n")[0] ?? "";
  return tokenizeArgsLine(first);
}

export function consumeArgsFile(path: string | undefined): void {
  if (!path) return;
  try { rmSync(path, { force: true }); } catch { /* ignore */ }
}

export function applyArgsFile(argv: string[]): string[] {
  if (argv[0] !== "--args-file") return [...argv];
  const path = argv[1];
  if (!path) throw new ArgsFileError("--args-file requires a path");
  const tokens = loadArgsFile(path);
  consumeArgsFile(path);
  return [...tokens, ...argv.slice(2)];
}

export interface KvParseResult { value: string; shift: 1 | 2; }
export function kvParse(flag: string, next?: string): KvParseResult {
  if (flag.includes("=")) return { value: flag.slice(flag.indexOf("=") + 1), shift: 1 };
  if (next === undefined) throw new KvError(flag);
  return { value: next, shift: 2 };
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/args.test.ts`.

- [ ] **Step 5: Commit** — `git add src/args.ts tests/args.test.ts && git commit -m "feat: args-file fence + kvParse (TDD)"`

---

### Task 14: `core/forensics.ts` — captureFailure (minimal)

**Files:**
- Create: `src/core/forensics.ts`
- Test: `tests/forensics.test.ts`

Behavior from `cw_spawn_capture_failure_forensics`. Validate required string fields (→code 1) and `reason ∈ {timeout, error_event}` (→code 2) BEFORE statting dir; require part dir exists+writable (→code 1); capture scrollback (last 50, "" on failure); write `<partDir>/failure-reason.txt` via atomicWrite BEFORE kill. Exact label spacing (column 16). `renderFailureReport` is pure (exported for exact-match test).

- [ ] **Step 1: Write failing tests** `tests/forensics.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as F from "../src/core/forensics.js";
import { partDir } from "../src/core/paths.js";

afterEach(() => { delete process.env.CONSORT_HOME; });
function home() { const h = mkdtempSync(join(tmpdir(), "fx-")); process.env.CONSORT_HOME = h; return h; }
const deps = (scroll = "") => ({
  partDir,
  capturePane: async () => scroll,
  atomicWriteSync: (d: string, c: string) => writeFileSync(d, c),
  isWritableDir: (d: string) => existsSync(d),
  now: () => "2026-05-21T10:00:00Z",
});

describe("forensics", () => {
  it("timeout, no event_line → file with sentinel", async () => {
    home(); mkdirSync(partDir("violin", "codex", "demo"), { recursive: true });
    const r = await F.captureFailure({ instrument: "violin", model: "codex", topic: "demo", paneId: "%999", reason: "timeout" }, deps("line A\nline B"));
    expect(r.ok).toBe(true);
    const txt = readFileSync(join(partDir("violin", "codex", "demo"), "failure-reason.txt"), "utf8");
    expect(txt).toContain("# Spawn bootstrap failure");
    expect(txt).toContain("fail_reason:   timeout");
    expect(txt).toContain("ready_timeout: unknown");
    expect(txt).toContain("## Pane scrollback (last 50 lines, captured BEFORE pane kill)");
    expect(txt).toContain("no error event before timeout");
    expect(txt).toContain("line A\nline B");
  });
  it("error_event with event_line stored verbatim", async () => {
    home(); mkdirSync(partDir("violin", "codex", "demo"), { recursive: true });
    const evt = '{"event":"error","reason":"codex_bootstrap_failed","ts":"2026-05-21T10:00:00Z"}';
    const r = await F.captureFailure({ instrument: "violin", model: "codex", topic: "demo", paneId: "%9", reason: "error_event", eventLine: evt }, deps());
    expect(r.ok).toBe(true);
    const txt = readFileSync(join(partDir("violin", "codex", "demo"), "failure-reason.txt"), "utf8");
    expect(txt).toContain("fail_reason:   error_event");
    expect(txt).toContain(evt);
  });
  it("missing/unwritable dir → code 1, no file", async () => {
    home();
    const r = await F.captureFailure({ instrument: "ghost", model: "codex", topic: "demo", paneId: "%1", reason: "timeout" }, deps());
    expect(r).toEqual({ ok: false, code: 1 });
  });
  it("invalid reason → code 2", async () => {
    home(); mkdirSync(partDir("violin", "codex", "demo"), { recursive: true });
    const r = await F.captureFailure({ instrument: "violin", model: "codex", topic: "demo", paneId: "%1", reason: "kaboom" as any }, deps());
    expect(r).toEqual({ ok: false, code: 2 });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/forensics.test.ts`.

- [ ] **Step 3: Implement `src/core/forensics.ts`**

```ts
export type FailureReason = "timeout" | "error_event";
export const SCROLLBACK_LINES = 50;
export const NO_EVENT_SENTINEL = "no error event before timeout";
export const FAILURE_FILENAME = "failure-reason.txt";

export interface CaptureFailureInput {
  instrument: string; model: string; topic: string; paneId: string;
  reason: FailureReason; eventLine?: string; readyTimeout?: string | number;
}
export type CaptureFailureResult = { ok: true; path: string } | { ok: false; code: 1 | 2 };

export interface ForensicsDeps {
  partDir(i: string, m: string, t: string): string;
  capturePane(paneId: string, lines: number): Promise<string>;
  atomicWriteSync(dest: string, content: string): void;
  isWritableDir(dir: string): boolean;
  now?: () => string;
}

export function renderFailureReport(f: {
  timestamp: string; instrument: string; model: string; topic: string;
  paneId: string; reason: FailureReason; readyTimeout: string; scrollback: string; eventLine?: string;
}): string {
  const meta =
    `timestamp:     ${f.timestamp}\n` +
    `instrument:    ${f.instrument}\n` +
    `model:         ${f.model}\n` +
    `topic:         ${f.topic}\n` +
    `pane_id:       ${f.paneId}\n` +
    `fail_reason:   ${f.reason}\n` +
    `ready_timeout: ${f.readyTimeout}\n`;
  const evt = f.reason === "error_event" && f.eventLine ? f.eventLine : NO_EVENT_SENTINEL;
  return `# Spawn bootstrap failure\n${meta}\n` +
    `## Pane scrollback (last 50 lines, captured BEFORE pane kill)\n${f.scrollback}\n\n` +
    `## Event context\n${evt}\n`;
}

export async function captureFailure(input: CaptureFailureInput, deps: ForensicsDeps): Promise<CaptureFailureResult> {
  if (!input.instrument || !input.model || !input.topic) return { ok: false, code: 1 };
  if (input.reason !== "timeout" && input.reason !== "error_event") return { ok: false, code: 2 };
  const dir = deps.partDir(input.instrument, input.model, input.topic);
  if (!deps.isWritableDir(dir)) return { ok: false, code: 1 };
  const scrollback = await deps.capturePane(input.paneId, SCROLLBACK_LINES).catch(() => "");
  const dest = `${dir}/${FAILURE_FILENAME}`;
  const doc = renderFailureReport({
    timestamp: (deps.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")))(),
    instrument: input.instrument, model: input.model, topic: input.topic,
    paneId: input.paneId, reason: input.reason,
    readyTimeout: input.readyTimeout == null ? "unknown" : String(input.readyTimeout),
    scrollback, eventLine: input.eventLine,
  });
  deps.atomicWriteSync(dest, doc);
  return { ok: true, path: dest };
}
```

> Note: the failure label is `instrument:` (rebranded from `commander:`); update any literal test fixtures from clone-wars accordingly. The column alignment (values at col 16) is reproduced by the fixed-width label strings above.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run tests/forensics.test.ts`.

- [ ] **Step 5: Commit** — `git add src/core/forensics.ts tests/forensics.test.ts && git commit -m "feat(core): minimal forensics captureFailure (TDD)"`

---

## Plan 01 close-out

- [ ] **Full suite + typecheck + lint + build green:**

```bash
npm run typecheck && npm run test && npm run lint && npm run build
```
Expected: tsc clean; all vitest files PASS; eslint clean; `dist/consort.js` rebuilt. Then commit the refreshed `dist/`:

```bash
git add dist/consort.js && git commit -m "chore: rebuild dist after core library"
```

**Exit state:** `core/*` + `args` fully unit-tested; no commands yet. Proceed to **Plan 02 — Primitives**.

