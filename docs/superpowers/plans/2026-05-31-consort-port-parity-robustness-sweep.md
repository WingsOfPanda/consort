# Port-Parity & Robustness Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 15 audited port-parity/robustness divergences (5 medium, 10 low) — each restores or hardens a clone-wars behavior the TS port dropped.

**Architecture:** Surgical fixes grouped by file/area into 9 commit-tasks (8 fix-tasks + 1 build). Pure helpers get new unit tests; integration-shaped guards (tmux/spawn paths) are gated by the existing suite per the project's "live behavior = dogfood" convention. FROZEN protocol, atomic writes, and committed `dist/` are preserved.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import suffixes), vitest, esbuild → committed `dist/consort.cjs`. Tests run against `src/*.ts`.

**Spec:** `docs/superpowers/specs/2026-05-31-consort-port-parity-robustness-sweep-design.md`
**Branch:** `fix/port-parity-robustness-sweep` (created; spec committed at `3e7ef6b`).

**Toolchain:** `npm run typecheck` (authoritative — ignore editor TS2305/2307/7006 on new exports) · `npm run test` · `npm run lint` · `npm run build`.
**Commit trailer (every commit body):** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
**Stale-token gate landmine:** the gate scans `src`/`config`/`commands`/`hooks`/`.claude-plugin` **including comments** for `clone-wars`/`cw_`/`@cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`trooper`/`commander`. Keep all new code/comments/docs clear of these.
**dist policy:** Tasks 1–8 commit `src`/`tests`/`commands`/`config` only (vitest runs against `src`). Task 9 runs the single `npm run build` + commits `dist/consort.cjs`.

---

### Task 1: soundcheck — identity-template FAIL-check (M1) + real `--version` (L6)

**Files:**
- Modify: `src/commands/soundcheck.ts` (the config loop ~124-132; the provider loop line 141)
- Test: `tests/soundcheck-identity-template.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/soundcheck-identity-template.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as soundcheck } from "../src/commands/soundcheck.js";

// stage a CLAUDE_PLUGIN_ROOT whose config/ has contracts+instruments but (optionally) the template
function stageRoot(withTemplate: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "sc-root-"));
  mkdirSync(join(root, "config", "prompt-templates"), { recursive: true });
  writeFileSync(join(root, "config", "contracts.yaml"), "codex:\n  binary: codex\n");
  writeFileSync(join(root, "config", "instruments.yaml"), "violin:\n");
  if (withTemplate) writeFileSync(join(root, "config", "prompt-templates", "identity.md"), "x");
  return root;
}

describe("soundcheck identity-template check (M1)", () => {
  it("FAILs (rc 1) when the plugin-side identity template is missing", async () => {
    const home = mkdtempSync(join(tmpdir(), "sc-home-"));
    const root = stageRoot(false);
    const prevHome = process.env.CONSORT_HOME, prevRoot = process.env.CLAUDE_PLUGIN_ROOT;
    process.env.CONSORT_HOME = home; process.env.CLAUDE_PLUGIN_ROOT = root;
    try { expect(await soundcheck([])).toBe(1); }
    finally {
      if (prevHome === undefined) delete process.env.CONSORT_HOME; else process.env.CONSORT_HOME = prevHome;
      if (prevRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = prevRoot;
      rmSync(home, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/soundcheck-identity-template.test.ts`
Expected: FAIL — soundcheck currently returns 0 (no template check), test wants 1.

- [ ] **Step 3: Add the identity-template FAIL-check (M1)**

In `src/commands/soundcheck.ts`, immediately after the config loop's closing `}` (currently line 132, the `}` ending the `for (const f of ["contracts.yaml", "instruments.yaml"])` loop), insert:
```ts
  const idTpl = join(pluginRoot(), "config", "prompt-templates", "identity.md");
  if (existsSync(idTpl)) log.ok("config: identity.md (template present)");
  else { log.error(`config: identity template not found at ${idTpl} — partial install; spawn will fail`); fail = 1; }
```
(`join`, `pluginRoot`, `existsSync`, `log` are all already imported.)

- [ ] **Step 4: Real `--version` for providers (L6)**

In the provider loop, replace this line (currently 141):
```ts
      if (haveCmd(bin)) { log.ok(`  ${prov} (${bin}): installed`); ok++; detected.push(prov); }
```
with:
```ts
      if (haveCmd(bin)) {
        let ver = ""; try { ver = execFileSync(bin, ["--version"], { encoding: "utf8" }).split("\n")[0].trim(); } catch { /* best-effort */ }
        log.ok(`  ${prov} (${bin}): ${ver || "installed"}`); ok++; detected.push(prov);
      }
```
(`execFileSync` is already imported at line 2.)

- [ ] **Step 5: Run the test + suite**

Run: `npm run test -- tests/soundcheck-identity-template.test.ts && npm run typecheck && npm run test`
Expected: the new test PASSES; typecheck clean; full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/commands/soundcheck.ts tests/soundcheck-identity-template.test.ts
git commit -m "$(cat <<'EOF'
fix(soundcheck): FAIL-check the identity template + show real provider --version (medic parity)

medic.sh FAIL-guarded config/prompt-templates/identity.md (load-bearing —
identityWrite throws on every spawn if absent) and printed each provider's
--version; the port dropped both. Restore them.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: solo turn-send — part-not-idle gate (M2) + outbox-not-found guard (L7)

**Files:**
- Modify: `src/commands/solo.ts` (the ipc import line 16; `turnSendWith` lines 127-157)
- Test: `tests/solo-turn-send-guards.test.ts` (create)

**Context:** `perform.ts:182-185` already has both guards; solo dropped them. Mirror them against the solo part (`instrument`/`provider`/`topic`).

- [ ] **Step 1: Write the failing test**

Create `tests/solo-turn-send-guards.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { turnSendWith } from "../src/commands/solo.js";
import { soloArtDir } from "../src/core/solo.js";
import { partDir } from "../src/core/paths.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

function stageSolo(topic: string, instrument: string, provider: string) {
  const art = soloArtDir(topic);
  mkdirSync(art, { recursive: true });
  writeFileSync(join(art, "instrument.txt"), instrument + "\n");
  writeFileSync(join(art, "selected-provider.txt"), provider + "\n");
  const pd = partDir(instrument, provider, topic);
  mkdirSync(pd, { recursive: true });
  return { art, pd };
}
const deps = { offsetFor: () => 0, send: async () => 0 };

describe("solo turn-send guards", () => {
  it("L7: fails when the part outbox is absent ('was it spawned?')", async () => {
    stageSolo("topic-a", "violin", "claude"); // no outbox.jsonl
    expect(await turnSendWith("topic-a", 1, deps)).toBe(1);
  });
  it("M2: fails when the part is not idle (previous turn in flight)", async () => {
    const { pd } = stageSolo("topic-b", "violin", "claude");
    writeFileSync(join(pd, "outbox.jsonl"), "");
    writeFileSync(join(pd, "status.json"), JSON.stringify({ state: "working" }) + "\n");
    expect(await turnSendWith("topic-b", 1, deps)).toBe(1);
  });
  it("proceeds (rc 0) when outbox exists and the part is idle", async () => {
    const { pd } = stageSolo("topic-c", "violin", "claude");
    writeFileSync(join(pd, "outbox.jsonl"), "");
    writeFileSync(join(pd, "status.json"), JSON.stringify({ state: "idle" }) + "\n");
    writeFileSync(join(soloArtDir("topic-c"), "task-brief.md"), "do x");
    expect(await turnSendWith("topic-c", 1, deps)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/solo-turn-send-guards.test.ts`
Expected: the L7 and M2 cases FAIL (solo currently returns 0 with no guards).

- [ ] **Step 3: Add `statusPath`/`outboxPath` to the import**

In `src/commands/solo.ts`, the ipc import (line 16) is:
```ts
import { outboxOffset, outboxPath, outboxWaitSince, type OutboxEvent } from "../core/ipc.js";
```
Change to add `statusPath`:
```ts
import { outboxOffset, outboxPath, outboxWaitSince, statusPath, type OutboxEvent } from "../core/ipc.js";
```

- [ ] **Step 4: Add both guards in `turnSendWith`**

In `turnSendWith`, after the instrument/provider check (currently line 132) and before the `stateFile` block, insert:
```ts
  const outbox = outboxPath(instrument, provider, topic);
  if (!existsSync(outbox)) { log.error(`solo turn-send: outbox not found at ${outbox} — was ${instrument} spawned?`); return 1; }
  const sp = statusPath(instrument, provider, topic);
  if (existsSync(sp)) { const m = readFileSync(sp, "utf8").match(/"state":"([^"]*)"/); if (m && m[1] && m[1] !== "idle") { log.error(`solo turn-send: part not idle (state=${m[1]}); previous turn still in flight`); return 1; } }
```
(`existsSync`, `readFileSync`, `log` already imported.)

- [ ] **Step 5: Run the test + suite**

Run: `npm run test -- tests/solo-turn-send-guards.test.ts && npm run typecheck && npm run test`
Expected: all 3 new cases PASS; typecheck clean; full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/commands/solo.ts tests/solo-turn-send-guards.test.ts
git commit -m "$(cat <<'EOF'
fix(solo): restore the part-not-idle + outbox-not-found turn-send guards (perform parity)

deploy-turn-send.sh refused to dispatch when the part wasn't idle or its
outbox was missing; perform.ts kept both, solo dropped them — so re-arming
mid-turn wrote a fresh OFFSET and nudged the pane mid-write. Mirror
perform.ts:182-185.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: ipc — guard `readFrom` against open/read errors (M4)

**Files:**
- Modify: `src/core/ipc.ts` (`readFrom` lines 59-71)
- Test: `tests/ipc-readfrom-guard.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/ipc-readfrom-guard.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync } from "node:fs";
import { freshHome } from "./helpers/tmpHome.js";
import { outboxWaitSince, outboxPath } from "../src/core/ipc.js";
import { partDir } from "../src/core/paths.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

describe("readFrom guard (M4)", () => {
  it("degrades to a timeout (null) instead of throwing when the outbox path is unreadable", async () => {
    // make the outbox path a DIRECTORY so openSync(path,'r') throws EISDIR
    mkdirSync(partDir("violin", "claude", "t"), { recursive: true });
    mkdirSync(outboxPath("violin", "claude", "t")); // outbox.jsonl as a dir
    await expect(outboxWaitSince("violin", "claude", "t", 0, ["done"], 1)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/ipc-readfrom-guard.test.ts`
Expected: FAIL — `openSync` on a directory throws EISDIR out of the unguarded loop (rejects, not null).

- [ ] **Step 3: Wrap `readFrom`'s open/read in try/catch**

In `src/core/ipc.ts`, replace `readFrom` (lines 59-71):
```ts
function readFrom(path: string, offset: number): string {
  const size = outboxOffset(path);
  // If the file shrank below the captured offset (crash/rotation recreated it),
  // re-read from the start so a fresh event in the smaller file is still seen.
  const start = size < offset ? 0 : offset;
  if (size <= start) return "";
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally { closeSync(fd); }
}
```
with (the body wrapped so a transient unreadable outbox — TOCTOU unlink, EMFILE, EISDIR — is a no-match poll, not a thrown crash that kills the wait verb before it records TS=/FS=):
```ts
function readFrom(path: string, offset: number): string {
  try {
    const size = outboxOffset(path);
    // If the file shrank below the captured offset (crash/rotation recreated it),
    // re-read from the start so a fresh event in the smaller file is still seen.
    const start = size < offset ? 0 : offset;
    if (size <= start) return "";
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally { closeSync(fd); }
  } catch { return ""; } // unreadable outbox -> treat as a no-match poll; the loop reaches its real timeout
}
```

- [ ] **Step 4: Run the test + suite**

Run: `npm run test -- tests/ipc-readfrom-guard.test.ts && npm run typecheck && npm run test`
Expected: new test PASSES (resolves null); typecheck clean; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/core/ipc.ts tests/ipc-readfrom-guard.test.ts
git commit -m "$(cat <<'EOF'
fix(ipc): guard outbox readFrom so a transient read error degrades to a timeout

An unguarded openSync (TOCTOU unlink / EMFILE / EISDIR) threw out of
outboxWaitSince's poll loop and up through every wait verb, turning a
recoverable timeout into an opaque crash with no recorded TS=/FS= or
forensics. Wrap the body; a transient unreadable outbox is now a no-match
poll that reaches the real timeout.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: perform — malformed-question validation (L8) + unknown-flag rejection / drop orphan param (L9)

**Files:**
- Modify: `src/core/performQuestions.ts` (add `validateQuestionLine`; call it in `extractQuestionPayload`)
- Modify: `src/core/perform.ts` (`parsePerformArgs` unknown-flag arm ~73; drop `override?` from `detectProvider` ~116)
- Test: `tests/perform-question-validate.test.ts` (create), `tests/perform-args-unknown-flag.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/perform-question-validate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validateQuestionLine } from "../src/core/performQuestions.js";

describe("validateQuestionLine (L8)", () => {
  it("accepts a plain ASCII question with no claim", () => {
    expect(validateQuestionLine({ event: "question", message: "Which DB?" })).toBe(true);
  });
  it("accepts a valid claim (known kind + non-empty value)", () => {
    expect(validateQuestionLine({ event: "question", message: "exists?", claim: { kind: "path", value: "/tmp/x" } })).toBe(true);
  });
  it("rejects an empty message", () => {
    expect(validateQuestionLine({ event: "question", message: "" })).toBe(false);
  });
  it("rejects a non-ASCII message", () => {
    expect(validateQuestionLine({ event: "question", message: "café?" })).toBe(false);
  });
  it("rejects a present claim with an unknown kind", () => {
    expect(validateQuestionLine({ event: "question", message: "q", claim: { kind: "reboot", value: "x" } })).toBe(false);
  });
  it("rejects a present claim with an empty value", () => {
    expect(validateQuestionLine({ event: "question", message: "q", claim: { kind: "path", value: "" } })).toBe(false);
  });
});
```

Create `tests/perform-args-unknown-flag.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parsePerformArgs } from "../src/core/perform.js";

describe("parsePerformArgs unknown-flag rejection (L9)", () => {
  it("rejects an unrecognized flag instead of mistaking it for the design path", () => {
    expect(() => parsePerformArgs(["--provider", "claude", "doc.md"])).toThrow(/unknown flag/);
  });
  it("still accepts a bare design-doc path", () => {
    expect(parsePerformArgs(["doc.md"]).rest).toBe("doc.md");
  });
  it("still accepts known flags", () => {
    const p = parsePerformArgs(["--no-branch", "--topic", "t", "doc.md"]);
    expect(p.branchMode).toBe("no-branch"); expect(p.topic).toBe("t"); expect(p.rest).toBe("doc.md");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/perform-question-validate.test.ts tests/perform-args-unknown-flag.test.ts`
Expected: FAIL — `validateQuestionLine` not exported; `parsePerformArgs(["--provider",...])` currently does NOT throw.

- [ ] **Step 3: Add `validateQuestionLine` + call it (L8)**

In `src/core/performQuestions.ts`, add this exported function just before `extractQuestionPayload` (line 150):
```ts
/** Port of cw_trooper_question_validate_line: a question event is well-formed iff its message is
 *  non-empty printable-ASCII (+tab/newline) with no raw escaped quote/backslash, AND any present
 *  `claim` has kind in {path,git,env,cmd,test} and a non-empty value. Returns false otherwise so the
 *  caller downgrades to TS=failed rather than routing a malformed claim to verify. */
export function validateQuestionLine(ev: OutboxEvent): boolean {
  const message = typeof ev.message === "string" ? ev.message : "";
  if (message === "") return false;
  if (!/^[\x09\x0A\x20-\x7E]*$/.test(message)) return false;      // printable ASCII + tab + newline only
  if (message.includes('\\"') || message.includes("\\\\")) return false; // raw escapes belong percent-encoded
  const claim = ev.claim as { kind?: string; value?: string } | undefined;
  if (claim) {
    const kind = typeof claim.kind === "string" ? claim.kind : "";
    const value = typeof claim.value === "string" ? claim.value : "";
    if (!KNOWN_KINDS.has(kind as ClaimKind) || value === "") return false;
  }
  return true;
}
```
Then in `extractQuestionPayload`, replace the opening guard:
```ts
  const message = typeof ev.message === "string" ? ev.message : "";
  if (message === "") return null;
```
with:
```ts
  if (!validateQuestionLine(ev)) return null;
  const message = ev.message as string;
```

- [ ] **Step 4: Reject unknown flags + drop the orphan param (L9)**

In `src/core/perform.ts`, in `parsePerformArgs`, replace the catch-all (currently line 73):
```ts
    rest.push(t);
```
with:
```ts
    if (t.startsWith("-")) throw new PerformArgError(`perform init: unknown flag '${t}'`);
    rest.push(t);
```
Then change `detectProvider`'s signature + body to drop the now-orphaned `override?` param. Replace (lines 114-125):
```ts
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
```
with:
```ts
/** Port of deploy_detect_provider. plugin.json present -> claude; else codex. (The --provider override
 *  is intentionally dropped at the directive level; perform.md uses a runtime claude-confirm gate.) */
export function detectProvider(repoRoot: string): "codex" | "claude" {
  return existsSync(join(repoRoot, ".claude-plugin", "plugin.json")) ? "claude" : "codex";
}
```
(`initWith` at `src/commands/perform.ts:151` already calls `detectProvider(targetCwd)` with no override — no change needed there. `ProviderError` may become unused; if `npm run lint` flags it, remove its import/definition only if nothing else uses it — grep `ProviderError` first; `initWith` catches it at perform.ts:152, so KEEP the class and the catch.)

- [ ] **Step 5: Run the tests + suite**

Run: `npm run test -- tests/perform-question-validate.test.ts tests/perform-args-unknown-flag.test.ts && npm run typecheck && npm run lint && npm run test`
Expected: new tests PASS; typecheck + lint clean; full suite green. (If lint flags `ProviderError` unused, confirm `initWith`'s `catch (e) { if (e instanceof ProviderError) … }` still references it — it does — so no removal.)

- [ ] **Step 6: Commit**

```bash
git add src/core/performQuestions.ts src/core/perform.ts tests/perform-question-validate.test.ts tests/perform-args-unknown-flag.test.ts
git commit -m "$(cat <<'EOF'
fix(perform): validate question payloads + reject unknown flags cleanly

L8: restore cw_trooper_question_validate_line (ASCII/tab guard, claim
kind-allowlist + non-empty value) so a malformed claim downgrades to
TS=failed instead of routing to verify. L9: parsePerformArgs now rejects
an unknown flag with a clear message instead of shoving it into rest and
tripping the misleading "exactly one design-doc" error; drop the orphaned
detectProvider override param (the --provider directive drop is intentional).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: rehearsal — configRoot via pluginRoot() (M3) + teardown cleanup/pane-split (L13)

**Files:**
- Modify: `src/commands/rehearsal.ts` (imports; `liveInitDeps.configRoot` line 147; teardown preflight kill lines 1200-1207)

**Context:** Integration-shaped (tmux teardown + seed IO); gated by typecheck + suite per the dogfood convention. No new test.

- [ ] **Step 1: configRoot → pluginRoot() (M3)**

In `src/commands/rehearsal.ts`, ensure `pluginRoot` is imported from `../core/paths.js` (grep the file's `from "../core/paths.js"` import line; add `pluginRoot` to it if absent). Then replace line 147:
```ts
  configRoot: () => process.env.CLAUDE_PLUGIN_ROOT ?? process.cwd(),
```
with:
```ts
  configRoot: () => pluginRoot(),
```

- [ ] **Step 2: Teardown — split TSV + remove preflight-panes.txt (L13)**

Ensure `rmSync` is imported from `node:fs` (add to the existing `node:fs` import if absent). Replace the preflight-kill block (lines 1200-1207):
```ts
  const pf = join(art, "preflight-panes.txt");
  if (existsSync(pf)) {
    for (const line of readFileSync(pf, "utf8").split("\n")) {
      const pane = line.trim();
      if (!pane) continue;
      try { await deps.killPane(pane); } catch { /* best-effort */ }
    }
  }
```
with (split each `instrument\tpane` line and pass the PANE field; remove the file after, matching `cw_preflight_kill_orphans`'s `rm -f`):
```ts
  const pf = join(art, "preflight-panes.txt");
  if (existsSync(pf)) {
    for (const line of readFileSync(pf, "utf8").split("\n")) {
      const pane = (line.split("\t")[1] ?? "").trim();   // line is "<instrument>\t<pane>"
      if (!pane) continue;
      try { await deps.killPane(pane); } catch { /* best-effort */ }
    }
    try { rmSync(pf, { force: true }); } catch { /* best-effort */ }
  }
```

- [ ] **Step 3: Typecheck + suite**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean; full suite green.

- [ ] **Step 4: Commit**

```bash
git add src/commands/rehearsal.ts
git commit -m "$(cat <<'EOF'
fix(rehearsal): use pluginRoot() for the seed lib + fix teardown pane-kill/cleanup

M3: configRoot was hand-rolled `CLAUDE_PLUGIN_ROOT ?? cwd` (the pre-PR#14
bug), so seedLib silently skipped seeding when the env var wasn't exported
— route it through the fixed pluginRoot(). L13: the teardown passed the
whole `inst\tpane` TSV line to killPane (malformed target) and never
removed preflight-panes.txt; split on tab + rmSync to match
cw_preflight_kill_orphans.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: spawn — `--target-pane` membership validation (L10) + outbox dump on timeout (L12)

**Files:**
- Modify: `src/commands/spawn.ts` (arg loop ~26-32; target-pane branch ~66; timeout branch ~92-107; ipc import)
- Modify: `src/commands/score.ts`, `src/commands/prelude.ts`, `src/commands/rehearsal.ts` (thread `--preflight-art-dir` into the `spawn-all` spawn calls)
- Add: a pure `paneListedFor(panesTsv, instrument, pane)` helper in `src/core/score.ts` (beside the other preflight parsers) + test
- Test: `tests/spawn-pane-membership.test.ts` (create)

- [ ] **Step 1: Write the failing test (pure helper)**

Create `tests/spawn-pane-membership.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { paneListedFor } from "../src/core/score.js";

const TSV = "violin\t%5\ncello\t%6\n";
describe("paneListedFor (L10)", () => {
  it("true when the instrument+pane pair is listed", () => {
    expect(paneListedFor(TSV, "violin", "%5")).toBe(true);
  });
  it("false when the pane belongs to a different instrument", () => {
    expect(paneListedFor(TSV, "violin", "%6")).toBe(false);
  });
  it("false when the pane is foreign / unlisted", () => {
    expect(paneListedFor(TSV, "violin", "%99")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/spawn-pane-membership.test.ts`
Expected: FAIL — `paneListedFor` not exported.

- [ ] **Step 3: Add the pure helper**

In `src/core/score.ts`, add (near `parsePanesFile`):
```ts
/** True iff <instrument>\t<pane> appears as a line in a preflight-panes.txt body. Port of spawn.sh's
 *  `grep -qE "^<inst>\t<pane>$"` --target-pane membership check. */
export function paneListedFor(panesTsv: string, instrument: string, pane: string): boolean {
  return panesTsv.split("\n").some((l) => l === `${instrument}\t${pane}`);
}
```

- [ ] **Step 4: Parse `--preflight-art-dir` and validate membership in spawn.ts (L10)**

In `src/commands/spawn.ts`: add the import (top, the ipc import line) — add `outboxDump` and keep the rest:
change
```ts
import { wrapLaunch, splitRight, splitDown, respawn, paneAlive, paneLabelSet, paneSend, killNow, capturePane, ensurePaneBorders } from "../core/tmux.js";
```
(leave tmux import as-is) and change the ipc import line to add `outboxDump`:
find the line importing from `../core/ipc.js` and add `outboxDump`. Also import the helper + fs read:
add `import { paneListedFor } from "../core/score.js";` and ensure `readFileSync` is imported from `node:fs` (it is, line 1).

In the arg loop (lines 26-32), add a `--preflight-art-dir` branch before the `else`:
```ts
    else if (a === "--preflight-art-dir" || a.startsWith("--preflight-art-dir=")) { const r = kvParse(a, args[i + 1]); preflightArtDir = r.value; i += r.shift - 1; }
```
and declare it in the `let` line (line 25):
```ts
  let i = 3, mode = "", cwd = "", targetPane = "", preflightArtDir = "", initial = "";
```
Then in the target-pane branch, replace (currently line 66):
```ts
    if (!(await paneAlive(targetPane))) {
      captureSpawnFailure({ instrument, model, topic, reason: "pane_failed", detail: `--target-pane ${targetPane} is not alive` });
      log.error(`--target-pane ${targetPane} is not alive`); return 1;
    }
```
with (add the membership check when `--preflight-art-dir` is supplied):
```ts
    if (preflightArtDir) {
      const pf = join(preflightArtDir, "preflight-panes.txt");
      const ok = existsSync(pf) && paneListedFor(readFileSync(pf, "utf8"), instrument, targetPane);
      if (!ok) {
        captureSpawnFailure({ instrument, model, topic, reason: "pane_failed", detail: `--target-pane ${targetPane} not listed for ${instrument} in ${pf}` });
        log.error(`--target-pane ${targetPane} is not a preflight pane for ${instrument} (checked ${pf})`); return 1;
      }
    }
    if (!(await paneAlive(targetPane))) {
      captureSpawnFailure({ instrument, model, topic, reason: "pane_failed", detail: `--target-pane ${targetPane} is not alive` });
      log.error(`--target-pane ${targetPane} is not alive`); return 1;
    }
```

- [ ] **Step 5: Dump the outbox on bootstrap timeout (L12)**

In the bootstrap-failure branch, find the timeout/error block (the `if (!ev || ev.event === "error")` body, ~lines 92-101). After `process.stderr.write(tail + "\n");`, add:
```ts
      const ob = outboxDump(instrument, model, topic).trim();
      if (ob) process.stderr.write(`outbox:\n${ob}\n`);
```

- [ ] **Step 6: Thread `--preflight-art-dir` from the spawn-all callers**

In `src/commands/score.ts` (the `spawnAllWith` spawn call, ~line 193):
```ts
    const rc = await d.spawn([r.instrument, r.provider, topic, "--target-pane", panes.get(r.instrument)!, "--cwd", cwd]);
```
add `--preflight-art-dir`:
```ts
    const rc = await d.spawn([r.instrument, r.provider, topic, "--target-pane", panes.get(r.instrument)!, "--cwd", cwd, "--preflight-art-dir", art]);
```
Do the equivalent in `src/commands/prelude.ts` and `src/commands/rehearsal.ts` spawn-all spawn calls (grep each for `"--target-pane"` in a `d.spawn([...])` / `spawn([...])` call and append `, "--preflight-art-dir", <artVar>` using that function's art-dir variable). If a caller has no art-dir handle at the spawn site, skip it (the guard is opt-in; omitting `--preflight-art-dir` preserves today's behavior).

- [ ] **Step 7: Run the test + full gate**

Run: `npm run test -- tests/spawn-pane-membership.test.ts && npm run typecheck && npm run lint && npm run test`
Expected: new test PASSES; typecheck + lint clean; full suite green.

- [ ] **Step 8: Commit**

```bash
git add src/commands/spawn.ts src/core/score.ts src/commands/score.ts src/commands/prelude.ts src/commands/rehearsal.ts tests/spawn-pane-membership.test.ts
git commit -m "$(cat <<'EOF'
fix(spawn): validate --target-pane membership + dump outbox on bootstrap timeout

L10: re-add the optional --preflight-art-dir and reject a --target-pane
not listed in preflight-panes.txt (spawn.sh parity) so a foreign live pane
isn't clobbered; threaded from the spawn-all callers. L12: dump the part's
outbox.jsonl to stderr on the {ready,error} timeout (the usual cause is
partial/garbled outbox events), matching spawn.sh.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: roster — honor the stale-threshold env knob (L11)

**Files:**
- Modify: `src/commands/roster.ts` (the `classifyStale` call, line 50)
- Test: `tests/roster-stale-env.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`classifyStale` is already exported + tested; this verifies the call-site now sources the env. Create `tests/roster-stale-env.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { classifyStale } from "../src/commands/roster.js";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// guards the threshold semantics the roster call-site must pass through from the env
const ORIG = process.env.CONSORT_STALE_THRESHOLD_S;
afterEach(() => { if (ORIG === undefined) delete process.env.CONSORT_STALE_THRESHOLD_S; else process.env.CONSORT_STALE_THRESHOLD_S = ORIG; });

function agedOutbox(ageSec: number): string {
  const f = join(mkdtempSync(join(tmpdir(), "ob-")), "outbox.jsonl");
  writeFileSync(f, "{}\n");
  const t = Date.now() / 1000 - ageSec; utimesSync(f, t, t);
  return f;
}

describe("classifyStale honors a custom threshold (L11 semantics)", () => {
  it("a 300s-old working part is 'working' under a 600 threshold but 'stale' under 180", () => {
    const ob = agedOutbox(300);
    expect(classifyStale("working", ob, 600)).toBe("working");
    expect(classifyStale("working", ob, 180)).toBe("stale");
  });
});
```
*(This pins the threshold semantics the call-site relies on; the call-site wiring itself is covered by the suite + the live `roster` command.)*

- [ ] **Step 2: Run the test**

Run: `npm run test -- tests/roster-stale-env.test.ts`
Expected: PASS (classifyStale already supports the threshold param) — this is a characterization test guarding the semantics before the wiring change.

- [ ] **Step 3: Wire the env knob at the call-site**

In `src/commands/roster.ts`, replace line 50:
```ts
      if (pane !== "?" && (await paneAlive(pane))) state = classifyStale(deriveState(lastOutboxEvent(ob)), ob);
```
with:
```ts
      if (pane !== "?" && (await paneAlive(pane))) state = classifyStale(deriveState(lastOutboxEvent(ob)), ob, Number(process.env.CONSORT_STALE_THRESHOLD_S ?? 180));
```
(`classifyStale`'s in-function guard already falls back to 180 for non-finite input, so a bad env value is safe.)

- [ ] **Step 4: Typecheck + suite**

Run: `npm run typecheck && npm run test`
Expected: typecheck clean; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/commands/roster.ts tests/roster-stale-env.test.ts
git commit -m "$(cat <<'EOF'
fix(roster): honor CONSORT_STALE_THRESHOLD_S (list.sh CW_STALE_THRESHOLD_S parity)

The roster called classifyStale with no threshold so it always used 180s,
silently ignoring an operator's tuned stale window. Source it from
CONSORT_STALE_THRESHOLD_S (matching rehearsal's CONSORT_STUCK_S knob),
keeping the 180 fallback.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: docs/config — ANSWER: prefix (M5) + consult→score scrubs (L14, L15)

**Files:**
- Modify: `commands/score.md` (Stage 5 step 3 line 141; Stage 8 lines 178-179)
- Modify: `config/skill-hints/brainstorming.md`, `config/skill-hints/systematic-debugging.md`
- Modify: `config/contracts.yaml` (line 26 comment)

**Context:** Doc/config only; gated by the stale-token test.

- [ ] **Step 1: Restore the `ANSWER:` prefix in score.md (M5)**

In `commands/score.md`, replace Stage 5 step 3 (line 141):
```
  3. **Write** the reply to a temp file, then `$CS send --from maestro <INST> <TOPIC> @<reply-file>`.
```
with:
```
  3. **Write** the reply to a temp file **beginning with a line `ANSWER: <your answer>`** (the part's
     skill-hint reads the line starting `ANSWER: `), then `$CS send --from maestro <INST> <TOPIC> @<reply-file>`.
```
And in Stage 8 (line 178-179), replace:
```
  `verify.md`; AskUserQuestion if critical else self-answer; `$CS send --from maestro <INST> <TOPIC>
  @<reply>`; `rm -f $ART/verify-<INST>.done`; re-arm the background `verify-wait`).
```
with:
```
  `verify.md`; AskUserQuestion if critical else self-answer; write the reply file **beginning with a
  line `ANSWER: <your answer>`**, then `$CS send --from maestro <INST> <TOPIC> @<reply>`; `rm -f
  $ART/verify-<INST>.done`; re-arm the background `verify-wait`).
```

- [ ] **Step 2: Scrub "consult" → "score"/neutral in the skill-hints (L14)**

In `config/skill-hints/brainstorming.md`, apply these exact replacements:
- Line 1: `SKILL HINT — this consult is design-shaped.` → `SKILL HINT — this score run is design-shaped.`
- Line 5: `lets you do that without deadlocking the consult.` → `lets you do that without deadlocking the run.`
- Line 9: `This consult is automated. The skill you invoke may try to ask design` → `This score run is automated. The skill you invoke may try to ask design`
- Line 46 (`This lets the consult reader see the design choices that shaped the`) → `This lets the findings reader see the design choices that shaped the`

In `config/skill-hints/systematic-debugging.md`, read the file and apply the same noun scrub: replace every standalone `consult` (the command-name noun) with `score` or a neutral noun (`run`/`findings`), matching the brainstorming edits. Leave the protocol/`ANSWER:`/encoding sections untouched.

- [ ] **Step 3: Fix the contracts.yaml cross-reference (L15)**

In `config/contracts.yaml`, replace line 26:
```
  # before the nudge fires). See commands/consult.md Step 1 spawn-rollback
```
with:
```
  # before the nudge fires). The directive-side auto-retry-once that
  # complements this lives in commands/score.md (Stage 3 spawn-all retry).
```
(Verify the next line, 27, `# for the directive-side auto-retry-once that complements this change.`, is now redundant; if so, delete line 27 so the comment reads cleanly. Read lines 22-28 first and keep the surrounding comment coherent.)

- [ ] **Step 4: Verify the stale-token gate + no remaining "consult" in shipped dirs**

Run:
```bash
npm run test -- tests/stale-tokens.test.ts
grep -rn "consult" config/skill-hints config/contracts.yaml commands/score.md || echo "no 'consult' left in the edited files"
```
Expected: stale-token test PASSES; the grep shows no `consult` in the edited files (the `ANSWER:`/score edits don't reintroduce it).

- [ ] **Step 5: Commit**

```bash
git add commands/score.md config/skill-hints/brainstorming.md config/skill-hints/systematic-debugging.md config/contracts.yaml
git commit -m "$(cat <<'EOF'
fix(docs): restore the ANSWER: reply prefix + finish the consult->score scrub

M5: the shipped skill-hints tell the part to read the "ANSWER: " line, but
score.md told the Maestro to send a free-form reply with no prefix —
restore it so the question handshake can't stall. L14/L15: scrub the
part-facing "consult" noun in the skill-hints and fix the contracts.yaml
comment pointing at the renamed commands/consult.md.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Rebuild dist + final full gate

**Files:**
- Modify: `dist/consort.cjs` (rebuilt)

- [ ] **Step 1: Rebuild**

Run: `npm run build`
Expected: esbuild succeeds; `dist/consort.cjs` regenerated.

- [ ] **Step 2: Deterministic-build + clean-tree check**

Run: `npm run build && git status --porcelain dist/consort.cjs`
Expected: after a second build, `dist/consort.cjs` is byte-stable (modified once vs HEAD, no churn between builds).

- [ ] **Step 3: Full gate**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all clean/green — full suite + every new test file (soundcheck-identity-template, solo-turn-send-guards, ipc-readfrom-guard, perform-question-validate, perform-args-unknown-flag, spawn-pane-membership, roster-stale-env) and the stale-token gate.

- [ ] **Step 4: Commit the rebuilt bundle**

```bash
git add dist/consort.cjs
git commit -m "$(cat <<'EOF'
build: rebuild dist for the port-parity & robustness sweep

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage:** M1→T1 · M2→T2 · M3→T5 · M4→T3 · M5→T8 · L6→T1 · L7→T2 · L8→T4 · L9→T4 · L10→T6 · L11→T7 · L12→T6 · L13→T5 · L14→T8 · L15→T8 · dist→T9. All 15 covered.

**Type consistency:** `validateQuestionLine(ev: OutboxEvent): boolean` (T4 def + test + `extractQuestionPayload` caller) align. `paneListedFor(panesTsv, instrument, pane): boolean` (T6 def + test + spawn caller) align. `detectProvider(repoRoot)` one-arg (T4) matches its only caller `perform.ts:151`. `classifyStale(state, outbox, thresholdS?)` (existing) matches the T7 call-site. `statusPath`/`outboxPath`/`outboxDump` are existing `ipc.ts` exports added to imports.

**Placeholder scan:** no TBD/TODO; every code step shows complete before/after; every run step shows the command + expected result. Two steps say "grep/read first" (rehearsal imports T5; contracts.yaml line 27 T8; the other spawn-all callers T6-step6) — these are explicit verify-then-edit instructions with the exact change specified, not placeholders.

**Convention note (stated, not a gap):** integration-shaped guards on tmux/teardown paths (T5, and the spawn.ts wiring in T6/L12) carry no new live-pane unit test, per the project's "live behavior = dogfood" rule; their pure pieces (`paneListedFor`) are unit-tested and the whole is typecheck+suite-gated. The two-repeat mediums (M1, M3) and the solo guards (M2/L7) and the readFrom guard (M4) and the perform helpers (L8/L9) DO get focused tests.
