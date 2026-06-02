# consort forensics scope expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Maestro record suspicions to the playback feed (even on clean runs) and let parts flag suspicions via a `FLAG:`-prefixed note, reusing the existing forensics + playback pipeline.

**Architecture:** Two new `Finding.source` values — `maestro_flag` (written immediately to the global feed by a new per-command `flag` verb) and `part_note` (a `FLAG:`-marked `note` captured by the teardown outbox scan). Both flow through the existing `renderArtForensics`/`parseMechanicalFindings`/`findingSignature` default path, so `playback.ts` is untouched.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import suffixes), vitest, esbuild → committed `dist/consort.cjs`.

---

> **STALE-TOKEN LANDMINE (read before editing `commands/*.md`, `config/`, or `src/`):** the
> `tests/stale-tokens.test.ts` gate scans those trees **including comments and prose** and fails on
> `clone-wars`, `cw_`, `@cw_`, `master-yoda`, `MISSION ACCOMPLISHED` (case-sensitive) or `trooper` /
> `commander` (case-insensitive). None of the edits below introduce those tokens — `flag`, `FLAG:`,
> `maestro_flag`, `part_note`, `suspicions`, `Maestro`, `playback` are all clean. Do not reach for
> predecessor terminology.

> **Frozen-protocol guard:** `FLAG:` is a string convention on the existing frozen `note` field. Do
> NOT add a new event type, rename a field, or touch `contracts.yaml` / sentinels.

---

## Task 1: Broaden `scrapeOutbox` to capture `FLAG:` notes as `part_note`

**Files:**
- Modify: `src/core/forensics.ts:69-77` (`scrapeOutbox`)
- Test: `tests/forensics.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/forensics.test.ts`, inside the existing top-level `describe` (the file imports `scrapeOutbox`
directly), add:

```ts
  it("scrapeOutbox captures FLAG:-prefixed notes as part_note, ignores routine notes", () => {
    const lines = [
      '{"event":"progress","note":"50% done"}',
      '{"event":"progress","note":"FLAG: the harness skipped 3 cases"}',
      '{"event":"done","summary":"ok","note":"FLAG: leftover temp file"}',
      '{"event":"error","message":"boom"}',
      '{"event":"question","message":"which?"}',
    ].join("\n");
    const f = scrapeOutbox(lines, "violin");
    expect(f.filter((x) => x.source === "part_note").map((x) => x.key)).toEqual([
      "the harness skipped 3 cases",
      "leftover temp file",
    ]);
    expect(f.filter((x) => x.source === "outbox").length).toBe(2); // error + question unchanged
    expect(f).toHaveLength(4);
  });
  it("scrapeOutbox FLAG: marker is case-insensitive and tolerates leading space", () => {
    const f = scrapeOutbox('{"event":"progress","note":"  flag: lowercase works"}', "oboe");
    expect(f).toEqual([{ source: "part_note", key: "lowercase works", context: "part=oboe" }]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/forensics.test.ts`
Expected: the two new tests FAIL (current `scrapeOutbox` only captures `error`/`question`, so `part_note` findings are absent).

- [ ] **Step 3: Implement the broadening**

Replace `scrapeOutbox` (`src/core/forensics.ts:69-77`) with:

```ts
/** outbox.jsonl: JSON.parse each line (skip non-JSON). Keep event error|question (source=outbox);
 *  also keep any event whose `note` is FLAG:-prefixed (source=part_note, FLAG: stripped). */
export function scrapeOutbox(text: string, part: string): Finding[] {
  const out: Finding[] = [];
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l);
      if (o.event === "error" || o.event === "question") out.push({ source: "outbox", key: l.trim(), context: `part=${part}` });
      else if (typeof o.note === "string" && /^\s*FLAG:/i.test(o.note)) out.push({ source: "part_note", key: o.note.replace(/^\s*FLAG:\s*/i, "").trim(), context: `part=${part}` });
    }
    catch { /* skip non-JSON */ }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests + full suite**

Run: `npm test -- tests/forensics.test.ts` then `npm test`
Expected: the two new tests PASS; the existing `scrapeOutbox` error/question tests still pass; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/core/forensics.ts tests/forensics.test.ts
git commit -m "feat(forensics): capture FLAG:-prefixed part notes as part_note findings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add `recordMaestroFlag` + `runFlag` to `forensics.ts`

**Files:**
- Modify: `src/core/forensics.ts` (append after `captureSpawnFailure`, end of file)
- Create: `tests/forensics-flag.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/forensics-flag.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, existsSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { recordMaestroFlag, runFlag } from "../src/core/forensics.js";
import { parseForensicsFrontmatter, parseMechanicalFindings } from "../src/core/playback.js";
import { globalRoot } from "../src/core/paths.js";

let env: { home: string; cleanup: () => void };
beforeEach(() => { env = freshHome(); });
afterEach(() => { env.cleanup(); });

const fdir = (date: string) => join(globalRoot(), "forensics", date);

describe("recordMaestroFlag", () => {
  it("writes a maestro_flag finding straight to the global feed", () => {
    const now = new Date("2026-06-02T09:15:30Z");
    const p = recordMaestroFlag({ command: "perform", topic: "auth-x", note: "  the diff touched an unrelated file  ", now });
    expect(p).toBe(join(fdir("2026-06-02"), "09-15-30-perform-flag-auth-x.md"));
    expect(existsSync(p)).toBe(true);
    const text = readFileSync(p, "utf8");
    const meta = parseForensicsFrontmatter(text);
    expect(meta.command).toBe("perform");
    expect(meta.topic).toBe("auth-x");
    expect(meta.nFindings).toBe(1);
    expect(parseMechanicalFindings(text)).toEqual([
      { source: "maestro_flag", key: "the diff touched an unrelated file", context: "from=maestro command=perform" },
    ]);
  });
  it("returns '' for an empty/whitespace note (nothing written)", () => {
    expect(recordMaestroFlag({ command: "score", topic: "t", note: "   " })).toBe("");
  });
});

describe("runFlag", () => {
  it("rc 2 on missing topic or empty note", () => {
    expect(runFlag("solo", undefined, "x")).toBe(2);
    expect(runFlag("solo", "t", "")).toBe(2);
  });
  it("rc 0 and writes a maestro_flag file on a valid flag", () => {
    const rc = runFlag("score", "topic-y", "looks off");
    expect(rc).toBe(0);
    const date = new Date().toISOString().slice(0, 10);
    const files = readdirSync(fdir(date), { withFileTypes: true }).filter((d: Dirent) => d.isFile());
    expect(files.some((f) => f.name.includes("score-flag-topic-y"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/forensics-flag.test.ts`
Expected: FAIL with `recordMaestroFlag is not a function` / `runFlag is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to the end of `src/core/forensics.ts` (after `captureSpawnFailure`):

```ts
/** Record a Maestro suspicion straight to the playback feed
 *  (globalRoot()/forensics/<date>/<time>-<command>-flag-<topic>.md, source=maestro_flag), reusing
 *  renderArtForensics so /consort:playback consumes it unchanged. Teardown-independent (lands even on
 *  abort/handoff). Best-effort: returns the written path, or "" on empty note / any error. Never throws. */
export function recordMaestroFlag(opts: { command: string; topic: string; note: string; now?: Date }): string {
  try {
    const note = opts.note.trim();
    if (!note) return "";
    const finding: Finding = { source: "maestro_flag", key: note, context: `from=maestro command=${opts.command}` };
    const now = opts.now ?? new Date();
    const iso = now.toISOString();
    const date = iso.slice(0, 10);
    const time = iso.slice(11, 19).replace(/:/g, "-");
    let hash = "unknown"; try { hash = repoHash(); } catch { /* keep unknown */ }
    const dir = join(globalRoot(), "forensics", date);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${time}-${opts.command}-flag-${opts.topic}.md`);
    const md = renderArtForensics(
      { command: opts.command, topicSlug: opts.topic, repoHash: hash, artDir: "(maestro-flag)", invokedAt: iso.replace(/\.\d{3}Z$/, "Z") },
      [finding],
    );
    atomicWrite(path, md);
    return path;
  } catch { return ""; }
}

/** Shared `<command> flag <topic> <note>` verb: usage-guard, record, report. rc 2 on missing
 *  topic/empty note, else rc 0 (best-effort; mirrors runForensics). Feeds /consort:playback. */
export function runFlag(command: string, topic: string | undefined, note: string): number {
  if (!topic || !note.trim()) { log.error(`usage: ${command} flag <topic> <observation>`); return 2; }
  const path = recordMaestroFlag({ command, topic, note });
  if (path) { log.ok(`${command} flag: recorded ${path}`); process.stdout.write(path + "\n"); }
  else log.info(`${command} flag: nothing recorded`);
  return 0;
}
```

(`Finding`, `renderArtForensics`, `repoHash`, `globalRoot`, `partDir`, `mkdirSync`, `join`, `atomicWrite`,
`log` are all already imported at the top of `forensics.ts` — no new imports needed.)

- [ ] **Step 4: Run the tests + typecheck**

Run: `npm test -- tests/forensics-flag.test.ts` then `npm run typecheck`
Expected: all four new tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/forensics.ts tests/forensics-flag.test.ts
git commit -m "feat(forensics): add recordMaestroFlag + runFlag (immediate maestro_flag feed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire the `flag` verb into the 5 command dispatches

**Files:**
- Modify: `src/commands/solo.ts:10,43`
- Modify: `src/commands/score.ts:24,35,57`
- Modify: `src/commands/perform.ts:18,108`
- Modify: `src/commands/prelude.ts:12,52`
- Modify: `src/commands/rehearsal.ts:26,1460`

- [ ] **Step 1: Add the import + dispatch case to each command**

For each file, (a) add `runFlag` to the `from "../core/forensics.js"` import that already pulls in
`runForensics`, and (b) add a `case "flag"` immediately after the existing `case "forensics"` line.

**solo.ts** — line 10 `import { runForensics } from "../core/forensics.js";`
→ `import { runForensics, runFlag } from "../core/forensics.js";`
After line 43 `case "forensics": return forensicsRun(rest);` add:
```ts
    case "flag": return runFlag("solo", rest[0], rest.slice(1).join(" "));
```

**score.ts** — line 24 `import { runForensics } from "../core/forensics.js";`
→ `import { runForensics, runFlag } from "../core/forensics.js";`
After line 57 `case "forensics": return forensicsRun(rest);` add:
```ts
    case "flag": return runFlag("score", rest[0], rest.slice(1).join(" "));
```
Also extend the usage string on line 35: insert `flag|` before `forensics` so it reads
`...|offset-reset|export-doc|flag|forensics|archive> ...`.

**perform.ts** — line 18 `import { runForensics } from "../core/forensics.js";`
→ `import { runForensics, runFlag } from "../core/forensics.js";`
After line 108 `case "forensics":    return forensicsRun(rest);` add:
```ts
    case "flag":         return runFlag("perform", rest[0], rest.slice(1).join(" "));
```

**prelude.ts** — line 12 `import { runForensics } from "../core/forensics.js";`
→ `import { runForensics, runFlag } from "../core/forensics.js";`
After line 52 `case "forensics": return forensicsRun(rest);` add:
```ts
    case "flag": return runFlag("prelude", rest[0], rest.slice(1).join(" "));
```

**rehearsal.ts** — line 26 `import { runForensics } from "../core/forensics.js";`
→ `import { runForensics, runFlag } from "../core/forensics.js";`
After line 1460 `case "forensics": return forensicsRun(rest);` add:
```ts
    case "flag": return runFlag("rehearsal", rest[0], rest.slice(1).join(" "));
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`runFlag` returns `number`; each `async run()` auto-wraps it to `Promise<number>`.)

- [ ] **Step 3: Smoke-test the wiring via the bundle is deferred to Task 6; for now run the suite**

Run: `npm test`
Expected: full suite green (the dispatch additions don't change existing behavior).

- [ ] **Step 4: Commit**

```bash
git add src/commands/solo.ts src/commands/score.ts src/commands/perform.ts src/commands/prelude.ts src/commands/rehearsal.ts
git commit -m "feat(commands): wire a flag verb into solo/score/perform/prelude/rehearsal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Add the `FLAG:` instruction to the part identity prompt

**Files:**
- Modify: `config/prompt-templates/identity.md:17-19`

- [ ] **Step 1: Insert the suspicion-flag instruction**

In `config/prompt-templates/identity.md`, insert a new paragraph between the status.json line (17) and
the "Stay in your pane" line (19). Use the **Edit tool** with:

old_string:
```
After every event, update status.json with `{"state": "<state>", "updated": "<iso>", "last_event": "<event>"}`.

Stay in your pane between assignments
```
new_string:
```
After every event, update status.json with `{"state": "<state>", "updated": "<iso>", "last_event": "<event>"}`.

**Flagging suspicions:** If something looks suspicious, surprising, or wrong while you work — even a
possible false alarm — emit a progress event whose `note` is prefixed `FLAG:`, e.g.
`{"event":"progress","note":"FLAG: the test harness silently skipped 3 cases"}`, then keep working.
The Maestro collects these for later review; over-reporting is welcome.

Stay in your pane between assignments
```

- [ ] **Step 2: Verify the stale-token gate**

Run: `npm test -- tests/stale-tokens.test.ts`
Expected: PASS (no banned token introduced).

- [ ] **Step 3: Commit**

```bash
git add config/prompt-templates/identity.md
git commit -m "feat(identity): instruct parts to FLAG: suspicions via a progress note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Add the "Flagging suspicions" instruction to the 5 command docs

**Files:**
- Modify: `commands/solo.md`, `commands/score.md`, `commands/perform.md`, `commands/prelude.md`, `commands/rehearsal.md`

- [ ] **Step 1: Insert the block into each command doc**

In each `commands/<cmd>.md`, locate the `Let CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"` line
(in `perform.md` and `score.md` there is already a `## Progress tracking` block right after it — insert
this block immediately **after** that block in those two; in the other three insert immediately after
the `Let CS=` line). Insert, with a leading blank line, replacing `<cmd>` with that file's command name
(`solo` / `score` / `perform` / `prelude` / `rehearsal`):

```markdown
## Flagging suspicions

At any point in the run, if something looks weird, surprising, or suspicious — even a likely false
alarm — record it: `$CS <cmd> flag <TOPIC> "<what looked off>"`. It writes straight to the playback
feed (survives teardown and aborts) and costs nothing, so prefer over-recording. Review later with
`/consort:playback`.
```

For example in `commands/perform.md` the verb is `$CS perform flag <TOPIC> "<what looked off>"`; in
`commands/solo.md` it is `$CS solo flag ...`, etc.

- [ ] **Step 2: Verify the stale-token gate**

Run: `npm test -- tests/stale-tokens.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add commands/solo.md commands/score.md commands/perform.md commands/prelude.md commands/rehearsal.md
git commit -m "docs(commands): add Flagging suspicions instruction (flag verb) to all 5 commands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full gate + dist rebuild + commit

**Files:**
- Modify: `dist/consort.cjs` (rebuilt)

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: typecheck clean, lint clean, all tests pass (incl. `stale-tokens` and the new forensics tests).

- [ ] **Step 2: Rebuild the bundle**

Run: `npm run build`
Expected: writes `dist/consort.cjs` with no error.

- [ ] **Step 3: Smoke-test the bundle**

Run each and check:
```bash
node dist/consort.cjs perform flag 2>&1 | tail -1      # usage error, rc 2
node dist/consort.cjs score flag demo-topic "looks off" 2>&1 | grep -o 'EXPORTED\|forensics' ; echo "---"
CONSORT_HOME=$(mktemp -d) node dist/consort.cjs solo flag demo "a suspicious thing"   # prints a written path
```
Expected: `perform flag` with no args prints `usage: perform flag <topic> <observation>` (rc 2); the
`solo flag` call prints the path of a written `*-solo-flag-demo.md` file under the temp home's forensics dir.

- [ ] **Step 4: Commit the rebuilt bundle**

```bash
git add dist/consort.cjs
git commit -m "build: rebuild dist/consort.cjs for forensics scope expansion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (author)

- **Spec coverage:** Part 1 (Maestro flags) → Tasks 2 (helpers) + 3 (verb wiring) + 5 (doc
  instruction); Part 2 (part suspicions) → Tasks 1 (scraper) + 4 (identity instruction); Part 3
  (playback unchanged) → asserted by reusing `renderArtForensics`/`parseMechanicalFindings` in Task 2's
  tests and touching no `playback.ts`. dist → Task 6. All success criteria mapped.
- **Type consistency:** `recordMaestroFlag(opts: {command, topic, note, now?})` and
  `runFlag(command, topic, note)` signatures match their callers (the 5 dispatch lines pass
  `(<"cmd">, rest[0], rest.slice(1).join(" "))`) and the Task 2 tests. `Finding.source` new values
  `maestro_flag` / `part_note` are plain strings consumed by the generic playback path. `scrapeOutbox`
  signature unchanged.
- **No placeholders:** every code/edit step shows the exact content; every command shows expected output.
