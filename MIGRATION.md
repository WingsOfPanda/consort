# Consort — Migration Guide (Bash `clone-wars` → TypeScript)

> **What this is.** A complete, self-contained plan for rewriting the Bash plugin
> `clone-wars` into TypeScript as **`consort`**. It captures the architecture, the
> file-IPC wire protocol, the provider contracts, the command set, and a concrete
> TypeScript build plan with translation patterns. A fresh engineer (or a fresh
> Claude session) should be able to drive the entire rewrite from this document.

> **Source of truth.** The reference implementation lives at
> `/home/liupan/CC/clone-wars`. When this guide says "see X", grep that tree by
> symbol (line numbers drift). The Bash code is the behavioral spec; preserve
> *behavior*, not *implementation*.

---

## 0. TL;DR — the shape of the port

- **What consort is:** a Claude Code plugin where a **conductor** (a Claude Code
  session running `/consort:*` commands) spawns and orchestrates **real
  interactive model TUIs** (`codex`, `claude`, `agy`, `opencode`) as **tmux
  panes** the user can attach to. Coordination is **file-based IPC**
  (inbox / outbox / status / pane), not in-process messaging.
- **What changes:** the language (Bash → TypeScript) and the packaging (61 `bin/*.sh`
  scripts → one bundled `dist/consort.cjs` with subcommands). The **wire protocol,
  state layout, and tmux mechanics stay byte-identical** so the external model
  binaries behave exactly as they do today.
- **What stays the same:** the thesis ("the trimmed primitive, smaller than OMC"),
  the non-goals (closed provider set, no worktrees, no MCP, no role routing), and
  the IPC contract.
- **License:** MIT (already in `/home/liupan/CC/consort/LICENSE`). Open source.
- **Distribution:** committed `dist/` bundle so it installs with zero build step;
  `commands/*.md` dispatch to `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs <sub>`.

---

## 1. Why TypeScript (the constraints that drive every decision)

clone-wars is a **logic-heavy** shell program (~12,300 runtime LOC across 61
`bin/` + 26 `lib/` files, ~23,300 LOC of tests). Bash at that scale forced a long
list of footguns the rewrite must simply *not reproduce*:

| Bash footgun (do NOT port) | TS equivalent |
|---|---|
| `echo "$x" \| grep` SIGPIPE race under `pipefail` | string `.includes()` / regex on a value |
| `IFS=$'\t' read` collapsing empty TSV fields | `JSON` / typed objects (drop TSV entirely) |
| `find … \| head` pipefail killing the script | array ops on `fs.readdir` results |
| `local a=$1 b=$a` same-line eval order | normal `const` |
| `cd`-alias leakage into `$(…)` | no shells for path math |
| `${N+set}` unset-vs-empty distinction | optional params / `undefined` |
| hand-rolled KV / `awk`/`sed`/`grep` JSON parsing | native `JSON.parse` |

The IPC payloads are **JSON/JSONL** — TypeScript handles them natively, which
deletes the entire `cw_kv_*` / `awk` / `sed` parsing layer.

**Keep TS where logic lives; shell out only for tmux.** The one thing Bash is
native at — driving `tmux` — is a thin subprocess layer in TS via `execa`. You are
not losing tmux fluency; you are gaining types everywhere else.

---

## 2. Architecture (unchanged from clone-wars)

```
Conductor (Claude Code session — runs /consort:* commands)
    │
    ├── tmux split-window per trooper ───►  visible panes you can attach to
    │       ├── rex-codex-auth-review     — interactive `codex` TUI
    │       ├── cody-claude-auth-review   — interactive `claude` TUI
    │       └── wolffe-opencode-…         — interactive `opencode` TUI
    │
    └── State plane (file IPC):
        <root>/state/<repo-hash>/<topic>/<commander>-<model>/
            ├── identity.md     ← system prompt injected at spawn
            ├── inbox.md        ← conductor writes; trooper reads on nudge
            ├── outbox.jsonl    ← trooper appends; conductor tails
            ├── status.json     ← {state, updated, last_event}
            └── pane.json       ← {pane_id, commander, model, spawned_at}
```

**Pane identity:** `<commander>-<model>-<topic>` (e.g. `rex-codex-auth-review`).
- `commander` — a proper name from a curated pool (uniqueness rules in §6).
- `model` — one of the registered providers (`codex` / `claude` / `agy` / `opencode`).
- `topic` — operation slug, `[a-z0-9-]`, ≤ 32 chars. Doubles as the crew name.

**Conductor lifecycle for one trooper:** spawn pane → write identity → wait for
`{ready}` → write inbox + nudge → tail outbox for `{done}`/`{error}` → teardown
(kill pane, archive state).

Read `/home/liupan/CC/clone-wars/docs/DESIGN.md` in full once — it is the
architecture bible and the source for the failure-mode table.

---

## 3. The file-IPC wire protocol — **PRESERVE BYTE-FOR-BYTE**

This is the contract between the conductor and the external model binaries. The
troopers are the *same* `codex`/`claude`/`agy`/`opencode` processes reading the
*same* `identity.md` instructions. **If you change the event schema you must also
change the identity prompt, and you lose drop-in compatibility with everything
clone-wars learned.** Reproduce it exactly.

### 3.1 `inbox.md` (conductor writes, atomic overwrite)

Single message at a time (overwrite, not queue). Format:

```
From: <sender>

<task text>

When done, append a single JSONL line to <outbox-abs-path>:

`{"event":"done","summary":"<one-line summary>","ts":"<iso-timestamp>"}`

END_OF_INSTRUCTION
```

- `<sender>` defaults to `master-yoda` (the conductor); `--from <name>` attributes
  it to another trooper/operator. Sender restricted to `[a-zA-Z0-9_-]+`.
- **Last line MUST be `END_OF_INSTRUCTION`** — the trooper only acts when that
  sentinel is present, so it never reads a half-written file.
- Written atomically (tmp + rename). See `cw_inbox_write` in `lib/ipc.sh`.

### 3.2 `outbox.jsonl` (trooper appends, conductor tails)

Append-only, one JSON object per line. Event types:

```jsonl
{"event":"ready","ts":"<iso>","commander":"rex","model":"codex"}
{"event":"ack","ts":"<iso>","task_summary":"Review auth flow"}
{"event":"progress","ts":"<iso>","note":"Reading src/auth/oauth.py..."}
{"event":"done","ts":"<iso>","summary":"Auth review complete.","artifacts":["findings.md"]}
{"event":"error","ts":"<iso>","message":"permission denied","fatal":false}
```

Some high-level commands also use `{"event":"question",...}` for escalation.
`fatal:true` ⇒ unrecoverable, recommend teardown; `fatal:false` ⇒ retry with a
new inbox.

**Strict matching (critical):** match an event with the anchored regex
`^\{"event":"<name>"[,}]` so a `progress` note that quotes `"event":"done"` in its
text does NOT false-positive. See `cw_event_match_pattern` / `cw_event_match_any_pattern`.

In TS, parse each line with `JSON.parse` and compare `obj.event === name` — this
is strictly safer than the regex and eliminates the false-positive class outright.
(Keep a guard for non-JSON lines: skip lines that fail to parse.)

### 3.3 `status.json` (trooper overwrites atomically)

```json
{ "state": "idle", "updated": "<iso>", "current_task_summary": null, "last_event": "done" }
```

States: `bootstrapping → idle → queued → working → idle|done|error`. The conductor
stamps `state:"archived"` + `archived_ts` on teardown (see
`cw_status_finalize_archived`).

### 3.4 `pane.json` (conductor writes at spawn)

```json
{ "pane_id": "%62", "commander": "rex", "model": "codex", "spawned_at": "<iso>" }
```

Always carries canonical `commander`/`model` so consumers never parse the dir name
(ambiguous for hyphenated model keys). See `cw_pane_meta_write` /
`cw_pane_meta_read_for_dir`.

### 3.5 The wait-since pattern (the canonical dispatch→collect idiom)

1. Capture the outbox **byte offset** before nudging (`cw_outbox_offset`).
2. Write inbox + nudge the pane.
3. Poll the outbox tail *after that offset* for the target event(s)
   (`cw_outbox_wait_since`).

This guarantees you only match events produced by *this* dispatch. In TS, record
`fs.statSync(outbox).size`, then on each poll read from that offset
(`fs.read` with a position, or read whole + slice) and `JSON.parse` new lines.

---

## 4. State layout & path rules

All paths absolute. Two roots:

| Root | clone-wars | consort | Holds |
|---|---|---|---|
| **Per-project state** | `$PWD/.clone-wars/` (or `$CLONE_WARS_HOME`) | `$PWD/.consort/` (or `$CONSORT_HOME`) | per-topic trooper state, `_run/`, `_args/` |
| **Per-machine config** | `${CLONE_WARS_HOME:-$HOME/.clone-wars}` | `${CONSORT_HOME:-$HOME/.consort}` | `contracts.yaml`, `commanders.yaml`, `archive/`, medic outputs |

Layout (mirror exactly, just rename the dir + env var):

```
<root>/
├── contracts.yaml          # provider launch contracts (user-editable)
├── commanders.yaml         # curated commander pool (user-editable)
├── state/<repo-hash>/<topic>/<commander>-<model>/{identity.md,inbox.md,outbox.jsonl,status.json,pane.json}
├── _run/<command>.XXXXXX/   # per-invocation scratch; `.last` pointer file
├── _args/                   # per-invocation $ARGUMENTS sink (injection fence)
└── archive/<repo-hash>/<topic>/<commander>-<model>-<ts>/   # teardown moves here
```

- **`<repo-hash>` = `sha256(realpath(cwd))`** (`cw_repo_hash_for`). Keep it.
- **Atomic writes:** tmp-in-same-dir + rename. Never write a state file in place.
  (`cw_atomic_write`). In TS: write `dest.tmp.<rand>`, then `fs.renameSync`.
- **`.gitignore = '*'`** is auto-written into every root so state never enters the
  user's git history (`cw_state_ensure`). Keep this.
- **Run-dir + `.last`:** the first Bash/CLI block of a command mints
  `_run/<cmd>.XXXXXX/` and writes its path to `_run/.last`; later blocks read
  `.last`. This avoids `/tmp` cross-session races. Keep the mechanism.

**Rename map (no installed base — rename freely):**
`clone-wars`→`consort`, `CLONE_WARS_HOME`→`CONSORT_HOME`, `.clone-wars/`→`.consort/`,
`cw_*`→drop the prefix (TS modules namespace naturally) or use `cs`, `/clone-wars:`→`/consort:`.

---

## 5. Provider contracts (`contracts.yaml`)

Keep this as **user-editable YAML** parsed into a typed object. Current rows
(`config/contracts.yaml`):

```yaml
codex:
  binary: codex
  consult_validated: true
  modes: { full: [--dangerously-bypass-approvals-and-sandbox], read-only: [--sandbox, read-only] }
  default_mode: full
  ready_timeout_s: 90
  bootstrap_sleep_s: 20
agy:
  binary: agy
  consult_validated: true
  modes: { full: [--dangerously-skip-permissions], read-only: [--sandbox] }
  default_mode: full
  ready_timeout_s: 30
  bootstrap_sleep_s: 20
claude:
  binary: claude
  consult_validated: true
  modes: { full: [--permission-mode, auto], read-only: [--permission-mode, plan] }
  default_mode: full
  ready_timeout_s: 60
  bootstrap_sleep_s: 12
opencode:
  binary: opencode
  consult_validated: true
  modes: { full: [-m, deepseek/deepseek-v4-pro], read-only: [-m, deepseek/deepseek-v4-pro] }
  default_mode: full
  ready_timeout_s: 60
  bootstrap_sleep_s: 15
  timeout_multiplier: 2.5
```

Field meanings: `binary` (must be on PATH); `modes` (mode-name → CLI arg list,
`full`=yolo/bypass, `read-only`=sandboxed); `default_mode`; `ready_timeout_s` (how
long spawn waits for `{ready}`); `bootstrap_sleep_s` (floor before the identity
nudge — cold-start absorption; do NOT lower codex/agy below 20); `consult_validated`
(gates the consult/meditate roster — see §6 medic); `timeout_multiplier` (opencode
runs slower; multiply per-kind timeouts).

**Adding a provider** (the closed-set rule, kept): drop a row with
`consult_validated: false`, dogfood-validate against the consult protocol, then flip
to `true`. Generic OpenAI-compat providers stay rejected.

TypeScript shape:

```ts
interface ProviderContract {
  binary: string;
  modes: Record<string, string[]>;     // "full" | "read-only" → args
  default_mode: string;
  ready_timeout_s: number;
  bootstrap_sleep_s: number;
  consult_validated: boolean;
  timeout_multiplier?: number;
}
```

---

## 6. The command set

Two tiers. **Primitives** (the irreducible verbs) and **high-level commands**
(workflows built on the primitives). Port the primitives first.

### 6.1 Primitives (`bin/*.sh` → `consort <verb>`)

| Verb | clone-wars source | Behavior | Port priority |
|---|---|---|---|
| `spawn` | `bin/spawn.sh` (see §7) | Spawn pane, write identity, wait `{ready}`, optional first inbox | **1** |
| `send` | `bin/send.sh`, `cw_inbox_write` | Write inbox + nudge pane (fire-and-forget) | **1** |
| `collect` | `bin/collect.sh`, `cw_outbox_wait*` | Block until `{done}`/`{error}`, print summary | **1** |
| `list` | `bin/list.sh`, `lib/list_stale.sh` | Show troopers (state from last outbox event; orphan detection) | **2** |
| `teardown` | `bin/teardown.sh`, `lib/tmux.sh` | Kill panes (graceful banner) + archive state | **2** |
| `medic` | `bin/medic.sh` | Health check (tmux ≥3.0, writable root, configs present, provider binaries) + roster picker (filters to `consult_validated`) | **2** |

### 6.2 High-level commands (`commands/*.md` + `lib/<cmd>.sh`)

These are where consort's value lives. Each is a directive (`commands/*.md`) that
orchestrates many primitive dispatches. Port after the primitives + one dogfood.

| Command | Source | One-line behavior |
|---|---|---|
| `consult` | `lib/consult*.sh` (~1.4k LOC), `commands/consult.md` | Cross-verified multi-model research → a deploy-audit-passing design doc. Yoda fast-path or escalate to N troopers; preflight pane layout, batch-spawn, research → diff → cross-verify → adjudicate → synthesize. |
| `meditate` | `lib/meditate.sh`, `commands/meditate.md` | Deep multi-aspect exploration (SOTA surveys, multi-angle, adversary-tested) → landscape doc that feeds consult. |
| `deep-research` | `lib/deep-research.sh` (~1.7k LOC), `commands/deep-research.md` + `-resume.md` | Advisor-driven autoresearch — conductor plans, 2-3 codex troopers run experiments persistently, advisor decides metric/dispatch/stop. |
| `deploy` | `lib/deploy*.sh` (~1.4k LOC), `commands/deploy.md` | Audit a design doc → dispatch to troopers for plan/implement/self-verify → cross-verify + fix-loop. Multi-repo DAG-aware; per-repo `feat/deploy-<topic>` branch + finish stage. |
| `strike` | `lib/strike.sh`, `commands/strike.md` | The LIGHT path: one codex trooper implements a clear single-repo change unattended on its own branch; brief → build → one light verify → autonomous finish. Start here for a first high-level port — it is the smallest. |
| `review-forensics` | `lib/forensics.sh`, `bin/review-forensics.sh` | Cluster accumulated forensics signals + propose next actions. |

> The high-level command *logic* (consult's adjudication, deep-research's scoring,
> deploy's DAG) is large and command-specific. Re-implement from the behavioral spec
> in each `commands/*.md` + `lib/*.sh`; do not transliterate line-by-line. Preserve
> the **stage sequence** and the **IPC dispatch pattern**, modernize the internals.

> **Update (0.1.24):** the multi-sub-repo subsystem was retired after the port — consort `perform`
> is single-repo-only and `deploy`'s multi-repo DAG / sibling execution was **not** carried forward.
> See `docs/superpowers/specs/2026-06-04-multi-repo-retirement-design.md`.

### 6.3 The command → CLI dispatch pattern (the injection fence — keep it)

Every `commands/*.md` keeps the 3-step args-file fence (it defends against shell
metacharacters in `$ARGUMENTS`, and is language-independent):

1. CLI mints a unique args path under `.consort/_args/` and prints it.
2. The directive **Writes** `$ARGUMENTS` into that path via the Write tool (never
   echo/printf it into a shell command).
3. The directive invokes the CLI with `--args-file <path>`; the CLI reads + deletes it.

In consort the invocation becomes:

```
node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs <subcommand> --args-file <path>
```

See `commands/list.md` for the canonical 3-step shape to copy.

---

## 7. The spawn lifecycle (port faithfully — it is the heart)

From `bin/spawn.sh`. This sequence is load-bearing; reproduce each step:

1. **Resolve args from `--args-file`** (injection fence).
2. **Validate** `topic` and `commander` against `^[a-z0-9-]+$`, ≤ 32 chars
   (`random` is a sentinel for commander).
3. **Environment checks:** inside a tmux session; `tmux` on PATH; tmux ≥ 3.0.
4. **Resolve `random` commander** from the pool (bias: globally-unused → topic-unused
   → any).
5. **Collision check:** commander MUST be unique within a topic (hard error);
   across topics is a soft warning.
6. **Resolve contract:** `binary`, `modes[mode]` (default `full`), `ready_timeout_s`,
   `bootstrap_sleep_s`. Verify `binary` is on PATH.
7. **State init:** mkdir trooper dir; remove stale `identity.md/inbox.md/outbox.jsonl/
   status.json/pane.json/.session_id`; `touch outbox.jsonl`; stamp `.session_id` with
   the Claude Code session id (`cw_state_init`).
8. **Write identity** from `config/prompt-templates/identity.md`: substitute
   `{{commander}}/{{model}}/{{topic}}/{{state_dir}}`, then append the explicit
   "first action: emit a `{ready}` JSONL line with a fresh `date -u` timestamp"
   instruction (`cw_identity_write`). **Keep that ready-instruction verbatim** — it
   is why bootstrap detection works.
9. **Build launch:** `binary + modeArgs`, then wrap as `bash -ic 'exec <cmd>'` so the
   pane shell sources `~/.bashrc` (delivers user env / MCP keys). If no `~/.bashrc`,
   leave unwrapped (`cw_wrap_launch_with_bashrc`).
10. **Split pane:** first trooper in a topic → split **right** (`-h`) of the
    conductor; subsequent → split **down** (`-v`) of the previously-spawned pane
    (tracked via `<topic-dir>/.last_pane`). Start dir = `--cwd` or `cw_repo_root`
    (git toplevel, else `$PWD`). Capture pane id with `-P -F '#{pane_id}'`.
11. **Stamp pane labels:** `@cw_label`, `@cw_color`, `@cw_label_fmt` user-options
    (rename to `@cs_*`) for the border-format hook. Write `pane.json`.
12. **Bootstrap sleep** `bootstrap_sleep_s` (floor before nudge).
13. **Nudge identity:** `send-keys -l "Read <identity> and follow its instructions
    exactly."` then (after a 0.3s beat) `Enter` (`cw_pane_send`).
14. **Wait for `{ready,error}`** up to `ready_timeout_s` (`cw_outbox_wait`). On
    timeout or `{error}`: capture pane scrollback to `failure-reason.txt`
    **before** killing, hard-kill the pane, archive state with a `FAILED` suffix,
    exit non-zero (`_spawn_bootstrap_fail` + `cw_spawn_capture_failure_forensics`).
15. **Optional initial prompt:** if given, `cw_inbox_write` + nudge; tell the user to
    `collect`.
16. **Print summary:** label, pane id, state dir, ready=yes.

Batch spawning (`bin/spawn-batch.sh`, `lib/spawn-batch.sh`): the high-level commands
spawn N troopers in one call to avoid conductor serialization. In TS this is a
`Promise.all` over the spawn function with a results array — far cleaner than the
Bash `spawn-results.tsv` it replaces.

---

## 8. Core primitives → TypeScript module map

Collapse 26 `lib/*.sh` into a focused `src/core/` set. Suggested modules:

| TS module | Replaces (lib/*.sh) | Key exports |
|---|---|---|
| `core/paths.ts` | `state.sh` | `stateRoot()`, `globalRoot()`, `repoHash(cwd)`, `topicDir(topic)`, `trooperDir(c,m,t)`, `runDir(cmd)`, `argsFile(cmd)` |
| `core/atomic.ts` | `state.sh` (`cw_atomic_write`) | `atomicWrite(dest, content)` (tmp+rename), `appendJsonl(path, obj)` |
| `core/ipc.ts` | `ipc.sh` | `writeInbox()`, `writeIdentity()`, `readOutbox()`, `waitForEvent()`, `waitSince()`, `outboxOffset()`, `writePaneMeta()`, `readPaneMeta()`, `setStatus()` |
| `core/tmux.ts` | `tmux.sh` | `splitRight()`, `splitDown()`, `respawn()`, `setLabel()`, `paneAlive()`, `paneSend()`, `capturePane()`, `killGraceful()`, `killNow()` — all via `execa('tmux', [...])` |
| `core/contracts.ts` | `contracts.sh` | `loadContracts()`, `provider(name)`, `modeArgs(name, mode)`, `readyTimeout(name)`, `bootstrapSleep(name)`, `validatedProviders()` |
| `core/commanders.ts` | `commanders.sh` | `loadPool()`, `pickRandom(topic)`, `inUse(c,t)`, `collisionError(...)` |
| `core/colors.ts` | `colors.sh` | Morandi palette, `colorFor(commander)`, `labelFmt(...)` (pane border) |
| `core/log.ts` | `log.sh` | `info/warn/error/ok` → stderr, TTY-guarded color |
| `core/deps.ts` | `deps.sh` | `haveCmd()`, `inTmux()`, `tmuxVersionOk()` |
| `core/archive.ts` | `state.sh` (archive helpers) | `archiveTrooper()`, `archiveTopic()`, `finalizeArchivedStatus()` |
| `core/forensics.ts` | `forensics.sh` | `captureSignals(artDir)` |

Commands live under `src/commands/<verb>.ts` and `src/commands/<command>.ts`, each
exporting a `run(args)` the dispatcher routes to.

---

## 9. Bash → TypeScript translation patterns (concrete)

### 9.1 tmux via `execa`

```ts
import { execa } from "execa";

export async function splitRight(launch: string, target?: string, cwd?: string): Promise<string> {
  const args = ["split-window", "-P", "-F", "#{pane_id}", "-h"];
  if (target) args.push("-t", target);
  if (cwd) args.push("-c", cwd);
  args.push(launch);
  const { stdout } = await execa("tmux", args);
  return stdout.trim();                  // e.g. "%62"
}

export async function paneSend(pane: string, line: string): Promise<void> {
  await execa("tmux", ["send-keys", "-t", pane, "-l", line]); // literal, no keymap
  await new Promise(r => setTimeout(r, 300));
  await execa("tmux", ["send-keys", "-t", pane, "Enter"]);
}

export async function paneAlive(pane: string): Promise<boolean> {
  const { stdout } = await execa("tmux", ["list-panes", "-a", "-F", "#{pane_id}"]);
  return stdout.split("\n").includes(pane);
}
```

Launch wrap (preserve the `.bashrc` behavior):

```ts
const wrapped = existsSync(`${homedir()}/.bashrc`) ? `bash -ic 'exec ${launch}'` : launch;
```

### 9.2 Atomic write + JSONL append

```ts
import { writeFileSync, renameSync, appendFileSync } from "node:fs";

export function atomicWrite(dest: string, content: string): void {
  const tmp = `${dest}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, content);
  renameSync(tmp, dest);                 // atomic within same dir
}

export function appendJsonl(path: string, obj: unknown): void {
  appendFileSync(path, JSON.stringify(obj) + "\n");
}
```

### 9.3 Outbox wait-since (replaces `cw_outbox_wait_since` + the polling loop)

```ts
import { statSync, readSync, openSync, closeSync } from "node:fs";

export function outboxOffset(path: string): number {
  try { return statSync(path).size; } catch { return 0; }
}

export async function waitSince(
  outbox: string, offset: number, events: string[], timeoutS: number,
): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < timeoutS; i++) {
    const size = outboxOffset(outbox);
    if (size > offset) {
      const fd = openSync(outbox, "r");
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      closeSync(fd);
      const lines = buf.toString("utf8").split("\n").filter(Boolean);
      for (const line of lines.reverse()) {           // tail -n1 semantics
        let obj: any;
        try { obj = JSON.parse(line); } catch { continue; } // skip non-JSON
        if (events.includes(obj.event)) return obj;
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}
```

> Note: `obj.event === name` strict comparison **replaces** the anchored
> `^\{"event":"X"[,}]` regex and is provably free of the substring false-positive
> the regex existed to prevent. This is one of the concrete wins of the port.

### 9.4 Config — YAML in, typed out

```ts
import { parse } from "yaml";
import { readFileSync } from "node:fs";
const contracts = parse(readFileSync(contractsPath, "utf8")) as Record<string, ProviderContract>;
```

Ship defaults in the repo; copy to `$CONSORT_HOME` on first `medic` run (mirrors
clone-wars). Keep YAML so the contracts/commanders stay user-editable.

---

## 10. Plugin packaging (TypeScript)

A Claude Code plugin's *interface* layer is always markdown; only the *execution*
layer changes language. Layout:

```
consort/
├── .claude-plugin/
│   └── plugin.json          # manifest (below)
├── commands/                # *.md directives (the /consort:* surface) — markdown, dispatch to dist
├── config/
│   ├── contracts.yaml
│   ├── commanders.yaml
│   └── prompt-templates/identity.md
├── hooks/                   # user-prompt-submit-active-session (port the .sh, or rewrite as node)
├── src/                     # TypeScript (private-capable, but MIT so published)
│   ├── consort.ts           # CLI entrypoint: dispatch <subcommand>
│   ├── core/                # §8 modules
│   └── commands/            # one file per verb/command
├── dist/
│   └── consort.cjs           # COMMITTED single-file bundle (zero-build install)
├── tests/                   # vitest
├── package.json
├── tsconfig.json
├── LICENSE                  # MIT (already present)
└── README.md
```

`plugin.json` (mirror clone-wars', renamed):

```json
{
  "name": "consort",
  "version": "0.1.0",
  "description": "Multi-model tmux pane orchestration for Claude Code — spawn codex/claude/agy/opencode TUIs as attachable troopers",
  "author": { "name": "WingsOfPanda", "email": "WingsOfPanda@users.noreply.github.com" },
  "homepage": "https://github.com/WingsOfPanda/consort",
  "repository": "https://github.com/WingsOfPanda/consort",
  "license": "MIT",
  "keywords": ["claude-code", "plugin", "multi-agent", "orchestration", "tmux", "codex"],
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs hook user-prompt-submit" } ] }
    ]
  }
}
```

**The single-CLI dispatch** — collapse 61 bin scripts into one entrypoint:

```ts
// src/consort.ts
const [, , sub, ...rest] = process.argv;
const handlers: Record<string, (a: string[]) => Promise<number>> = {
  spawn, send, collect, list, teardown, medic,
  consult, meditate, "deep-research": deepResearch, deploy, strike,
  "review-forensics": reviewForensics, hook,
};
const fn = handlers[sub];
if (!fn) { console.error(`unknown subcommand: ${sub}`); process.exit(2); }
process.exit(await fn(rest));
```

**Build** (zero-dep install): `esbuild src/consort.ts --bundle --platform=node
--target=node18 --outfile=dist/consort.cjs` (or `bun build`). Commit `dist/`.
`commands/*.md` call `node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs <sub> --args-file …`.

**Distribution:** add a marketplace entry pointing at `WingsOfPanda/consort`
(public). Optionally publish to npm as `@wingsofpanda/consort` — but **not required**
(plugins install via marketplace/git; the bare `consort` npm name is taken).

---

## 11. Testing strategy

clone-wars has 316 Bash test files + a parallel runner + version-stamped
"static-wiring locks". Replace with:

- **vitest** unit tests for `core/*` (paths, atomic, ipc parsing, contracts, wait-since).
- **The IPC contract is the highest-value test surface** — port the tests that
  pin the inbox format (`END_OF_INSTRUCTION`, `From:` header), the outbox event
  schema, atomic-write durability, and the wait-since offset logic.
- **Type-checking replaces most static-wiring locks** — the locks existed because
  Bash has no compiler. `tsc --noEmit` + lint covers the "is the wiring intact"
  class for free. Keep a few high-level smoke tests for command stage-sequencing.
- tmux-touching code: test the **argument construction** (pure functions that build
  the `tmux` arg arrays) without spawning real panes; gate any live-tmux integration
  test behind a `CONSORT_LIVE_TMUX=1` env guard.

---

## 12. Phased migration plan

Build in this order; each phase is independently testable.

- **Phase 0 — scaffold.** `package.json`, `tsconfig.json`, esbuild build script,
  vitest, `plugin.json`, empty `commands/`, `config/` copied from clone-wars
  (rename tokens). Commit a hello-world `dist/consort.cjs`.
- **Phase 1 — core primitives.** `core/paths`, `core/atomic`, `core/log`,
  `core/deps`, `core/contracts`, `core/commanders`, `core/colors`, `core/ipc`,
  `core/tmux`. Full unit coverage on `ipc`/`atomic`/`paths`. **No commands yet.**
- **Phase 2 — the six primitives.** `spawn` (the §7 lifecycle), `send`, `collect`,
  `list`, `teardown`, `medic`. Wire `commands/*.md` for each. **Dogfood now:**
  spawn one codex pane, send a task, collect `{done}`, teardown. This proves the
  whole IPC + tmux stack before any high-level work.
- **Phase 3 — first high-level command: `strike`.** It is the smallest (one
  trooper, one branch, four stages). Proves the brief → build → verify → finish
  arc on the new primitives. Dogfood a real single-repo change.
- **Phase 4 — remaining high-level commands**, in value order: `consult` →
  `deploy` → `meditate` → `deep-research` → `review-forensics`. Re-implement each
  from its `commands/*.md` + `lib/*.sh` behavioral spec; preserve stage sequence.
- **Phase 5 — marketplace publish** once stable + dogfooded.

---

## 13. Conventions (carry over from clone-wars)

- **No emojis** in shipped output (grep-ability).
- **Errors to stderr**, not the outbox (the outbox is the trooper's channel).
- **All state paths absolute**; never rely on cwd inheritance in spawned panes —
  set the pane cwd with `tmux split-window -c <abs>`.
- **Atomic writes** for `status.json`/`pane.json`/`inbox.md` (tmp + rename).
- **Closed provider set** — adding one means a `contracts.yaml` row +
  `consult_validated:false` → dogfood → flip. No generic OpenAI-compat open set.
- **Non-goals stay non-goals:** no worktree isolation, no role routing/tiers, no
  MCP server interface, no multi-conductor, no standalone CLI surface (slash
  commands only), no HUD/Telegram/learning.

---

## 14. Optional rebrand (cosmetic — decide later, does NOT affect the protocol)

clone-wars themes the cast as Star Wars clone troopers: conductor = "Master Yoda",
workers = "troopers" with commander names (Rex, Cody, Wolffe…). `consort` suggests a
musical-ensemble / companions theme. If you rebrand, it touches only **cosmetic**
surfaces (pane labels, identity prose, the commander pool, log lines) — **not** the
wire protocol, file names, or event schema. Candidate map (optional):

| clone-wars | consort (suggestion) |
|---|---|
| conductor / "Master Yoda" | "the Conductor" / "Maestro" |
| trooper | "player" / "voice" |
| commander pool (Rex, Cody…) | composer/instrument names, or keep as-is |
| `From: master-yoda` (inbox) | `From: conductor` (update identity template to match) |

Keep the `commander`/`model`/`topic` *field names* and the `pane.json`/`outbox`
*keys* unchanged — only the human-facing words change. If you rename `From:
master-yoda`, update the identity template's references in the same commit.

---

## 15. First commands to run (Phase 0 kickoff)

```bash
cd /home/liupan/CC/consort
npm init -y
npm i -D typescript esbuild vitest @types/node
npm i execa yaml
npx tsc --init   # then set: target ES2022, module NodeNext, strict true, outDir dist, rootDir src
mkdir -p src/core src/commands commands config/prompt-templates hooks tests dist .claude-plugin

# seed config from the reference tree (then rename tokens inside):
cp /home/liupan/CC/clone-wars/config/contracts.yaml          config/
cp /home/liupan/CC/clone-wars/config/commanders.yaml         config/
cp /home/liupan/CC/clone-wars/config/prompt-templates/identity.md config/prompt-templates/

# build script in package.json:
#   "build": "esbuild src/consort.ts --bundle --platform=node --target=node18 --outfile=dist/consort.cjs"
#   "test":  "vitest run"
#   "typecheck": "tsc --noEmit"
```

Then implement Phase 1 (`src/core/*`) with the patterns in §9, and Phase 2's
`spawn` against the §7 lifecycle. Dogfood before touching any high-level command.

---

*Reference implementation: `/home/liupan/CC/clone-wars` (grep by symbol; line
numbers drift). Architecture bible: `clone-wars/docs/DESIGN.md`. This guide is the
contract; the Bash code is the behavioral spec.*
