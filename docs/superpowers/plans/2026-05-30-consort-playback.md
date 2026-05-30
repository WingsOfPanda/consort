# consort `playback` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) to implement this plan task-by-task (fresh implementer per task + two-stage review:
> spec compliance, then code quality). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/consort:playback` — the zero-choice forensics-review command that surfaces the
problems the other commands recorded since you last ran it, tracks how often each pattern recurs
across runs (a persistent trend ledger), and auto-archives the surveyed files so only new problems
show next time.

**Architecture:** A pure `core/playback.ts` (frontmatter/findings parsing, a per-source trend
signature, the trend ledger) + two thin CLI verbs in `commands/playback.ts` (`survey` = read-only
list + trend digest; `archive` = accrue trend + move files to `.reviewed/`) + a directive
`commands/playback.md` that clusters and suggests. It **reuses** the already-shipped forensics
**capture** contract (`core/forensics.ts`) untouched and adds only the **review** half. No parts,
IPC, tmux, or git.

**Tech Stack:** TypeScript (ES2022/NodeNext/strict), vitest, esbuild → committed `dist/consort.cjs`,
`CONSORT_HOME` test isolation (`tests/helpers/tmpHome.ts`). No execa/subprocess surface.

**Spec (source of truth):** `docs/superpowers/specs/2026-05-30-consort-playback-design.md`.
Byte-faithful behavioral source: `clone-wars/commands/review-forensics.md`,
`clone-wars/bin/review-forensics.sh`, `clone-wars/bin/forensics-mark-reviewed.sh`,
`clone-wars/lib/forensics.sh`. The **stale-token gate** (`tests/stale-tokens.test.ts`) bans
`clone-wars`/`cw_`/`master-yoda` and case-insensitive `trooper`/`commander` in shipped
`src`/`commands`; cite the prior plugin only as `review-forensics.sh`/`forensics.sh` filenames in
JSDoc/prose. `npm run typecheck` is authoritative over any stale LSP "no exported member" diagnostics.

---

## File structure

- **Create** `src/core/playback.ts` — pure logic: `parseSince`, `parseForensicsFrontmatter`,
  `parseMechanicalFindings`, `normalizeVolatile`, `findingSignature`, `TrendLedger`/`TrendEntry`/
  `TrendRow` types, `parseTrendLedger`, `accrue`, `renderTrendDigest`, `reviewedTarget`.
- **Create** `src/commands/playback.ts` — `run(args)` dispatcher + `surveyWith`/`archiveWith` verbs.
- **Modify** `src/consort.ts` — register `playback` in `loadHandlers`.
- **Create** `commands/playback.md` — the directive (auto-discovered as `/consort:playback`; no
  `.claude-plugin` change needed — commands are sourced from `commands/*.md`).
- **Create** `tests/playback-core.test.ts` — Tasks 1–3 unit tests.
- **Create** `tests/playback-cmd.test.ts` — Tasks 4–5 command tests.
- **Modify** `CLAUDE.md` — phase-guard refresh (Task 7).
- **Append** `docs/superpowers/DOGFOOD.md` — dogfood result (Task 8).
- **Rebuild + commit** `dist/consort.cjs` (Task 6).

`Finding` (`{ source: string; key: string; context: string }`) is imported `type`-only from
`../core/forensics.js`. `core/playback.ts` is the exact inverse of `forensics.renderArtForensics`'s
bullet `- **<source>** <key> _(source: <context>)_`.

---

## Task 1: core — parsing helpers (`parseSince`, `parseForensicsFrontmatter`, `parseMechanicalFindings`)

**Files:**
- Create: `src/core/playback.ts`
- Test: `tests/playback-core.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/playback-core.test.ts`

```ts
// tests/playback-core.test.ts — pure logic for /consort:playback.
import { describe, it, expect } from "vitest";
import {
  parseSince, parseForensicsFrontmatter, parseMechanicalFindings,
} from "../src/core/playback.js";

describe("parseSince", () => {
  it("Nd / Nh to cutoff epoch-ms", () => {
    const now = 1_000_000_000_000;
    expect(parseSince("2d", now)).toBe(now - 2 * 86_400_000);
    expect(parseSince("6h", now)).toBe(now - 6 * 3_600_000);
  });
  it("rejects a bad spec", () => {
    expect(() => parseSince("2w", 0)).toThrow();
    expect(() => parseSince("x", 0)).toThrow();
  });
});

describe("parseForensicsFrontmatter", () => {
  const doc =
    "---\ncommand: perform\ntopic: add-oauth\ntopic_slug: add-oauth\n" +
    "repo_hash: abc\nart_dir: /x\ninvoked_at: 2026-05-30T00:00:00Z\nn_findings_mechanical: 3\n---\n\n## Mechanical findings\n";
  it("parses command / topic / n_findings", () => {
    expect(parseForensicsFrontmatter(doc)).toEqual({ command: "perform", topic: "add-oauth", nFindings: 3 });
  });
  it("missing keys -> empty / 0", () => {
    expect(parseForensicsFrontmatter("no frontmatter here")).toEqual({ command: "", topic: "", nFindings: 0 });
  });
});

describe("parseMechanicalFindings", () => {
  it("parses bullets back into findings (inverse of renderArtForensics)", () => {
    const body =
      "## Mechanical findings\n\n" +
      "- **audit_log** ISSUE=todo_marker _(source: audit.log)_\n" +
      '- **outbox** {"event":"error","reason":"timeout"} _(source: part=oboe)_\n';
    expect(parseMechanicalFindings(body)).toEqual([
      { source: "audit_log", key: "ISSUE=todo_marker", context: "audit.log" },
      { source: "outbox", key: '{"event":"error","reason":"timeout"}', context: "part=oboe" },
    ]);
  });
  it("skips malformed lines", () => {
    expect(parseMechanicalFindings("- not a finding\nrandom text")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/playback-core.test.ts`
Expected: FAIL — `src/core/playback.ts` does not exist / functions not exported.

- [ ] **Step 3: Create `src/core/playback.ts` with the parsing helpers**

```ts
// src/core/playback.ts — pure logic for /consort:playback (forensics review + cross-window trend).
// The review half of the forensics system; the capture half lives in core/forensics.ts. Port of the
// prior plugin's review-forensics.sh / forensics.sh. parseMechanicalFindings is the exact inverse of
// forensics.renderArtForensics's `- **<source>** <key> _(source: <context>)_` bullet.
import type { Finding } from "./forensics.js";

export interface ForensicsMetaParsed { command: string; topic: string; nFindings: number; }

/** Parse a captured forensics file's YAML frontmatter. Missing keys -> "" / 0. */
export function parseForensicsFrontmatter(text: string): ForensicsMetaParsed {
  const field = (k: string): string => {
    const m = text.match(new RegExp(`^${k}:[ \\t]*(.*)$`, "m"));
    return m ? m[1].trim() : "";
  };
  const n = Number(field("n_findings_mechanical"));
  return { command: field("command"), topic: field("topic"), nFindings: Number.isFinite(n) ? n : 0 };
}

const BULLET = /^- \*\*(.+?)\*\* (.*?) _\(source: (.*)\)_$/;
/** Parse the `## Mechanical findings` bullets back into Finding[]. Malformed lines are skipped. */
export function parseMechanicalFindings(text: string): Finding[] {
  const out: Finding[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(BULLET);
    if (m) out.push({ source: m[1], key: m[2], context: m[3] });
  }
  return out;
}

/** Parse a `--since` spec (`<N>d` or `<N>h`) into a cutoff epoch-ms relative to `now`. Throws on bad spec. */
export function parseSince(spec: string, now: number): number {
  const m = spec.match(/^(\d+)([dh])$/);
  if (!m) throw new Error(`--since must be <N>d or <N>h (got '${spec}')`);
  const n = Number(m[1]);
  return now - (m[2] === "d" ? n * 86_400_000 : n * 3_600_000);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/playback-core.test.ts` → PASS. Then `npm run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/playback.ts tests/playback-core.test.ts
git commit -m "feat(playback): core parsing helpers (since/frontmatter/findings)"
```

---

## Task 2: core — per-source trend signature (`findingSignature`, `normalizeVolatile`)

**Files:**
- Modify: `src/core/playback.ts`
- Test: `tests/playback-core.test.ts` (extend)

Spec §6: deterministic `<source>||<class>` with a per-source extractor pulling the meaningful token
out of each finding (the consort scraper shapes are fixed — `audit_log` key=`ISSUE=…`, `status`
key=`state=error`, `spawn_results` key=`rc=<n> reason=<…>`, `outbox` key=`<json>`, `session_log`
key=`<error line>`).

- [ ] **Step 1: Write the failing test** — append to `tests/playback-core.test.ts`

```ts
import { findingSignature, normalizeVolatile } from "../src/core/playback.js";

describe("normalizeVolatile", () => {
  it("strips ts / sha / path / bare ints", () => {
    expect(normalizeVolatile("at /home/x/y.ts:42 sha 3827f1c4f6 t 2026-05-30T00:00:00Z n 7"))
      .toBe("at <path> sha <sha> t <ts> n <n>");
  });
});

describe("findingSignature (per-source)", () => {
  it("audit_log -> first ISSUE token (drops trailing fields)", () => {
    expect(findingSignature({ source: "audit_log", key: "ISSUE=unresolved_placeholder", context: "audit.log" }))
      .toBe("audit_log||ISSUE=unresolved_placeholder");
    expect(findingSignature({ source: "audit_log", key: "ISSUE=todo_marker SECTION=ASK", context: "audit.log" }))
      .toBe("audit_log||ISSUE=todo_marker");
  });
  it("status -> state verbatim", () => {
    expect(findingSignature({ source: "status", key: "state=error", context: "part=oboe" }))
      .toBe("status||state=error");
  });
  it("spawn_results -> rc + reason word (lowercased)", () => {
    expect(findingSignature({ source: "spawn_results", key: "rc=124 reason=Timeout waiting", context: "part=oboe" }))
      .toBe("spawn_results||rc=124 reason=timeout");
  });
  it("outbox -> event + reason from JSON (volatile bits ignored)", () => {
    expect(findingSignature({ source: "outbox", key: '{"event":"error","reason":"dispatch_timeout","ts":"2026-05-30T00:00:00Z"}', context: "part=oboe" }))
      .toBe("outbox||event=error reason=dispatch_timeout");
    expect(findingSignature({ source: "outbox", key: '{"event":"question"}', context: "part=oboe" }))
      .toBe("outbox||event=question");
  });
  it("session_log -> volatile-normalized error class", () => {
    expect(findingSignature({ source: "session_log", key: "[error] failed at /home/x/y.ts:42 sha 3827f1c4f6", context: "dispatch.log" }))
      .toBe("session_log||[error] failed at <path> sha <sha>");
  });
  it("unknown source -> coarse fallback", () => {
    expect(findingSignature({ source: "weird", key: "x 2026-05-30T00:00:00Z", context: "c" }))
      .toBe("weird||x <ts>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/playback-core.test.ts -t "findingSignature"` → FAIL (not exported).

- [ ] **Step 3: Implement in `src/core/playback.ts`** (append)

```ts
/** Replace per-run volatile tokens so the "same problem" in a different run collapses to one class.
 *  Order matters: ISO timestamps first (they contain digits), then SHA-like hex, then absolute
 *  paths, then any remaining bare integers. */
export function normalizeVolatile(s: string): string {
  return s
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<ts>")
    .replace(/\b[0-9a-f]{7,40}\b/g, "<sha>")
    .replace(/\/[^\s"']+/g, "<path>")
    .replace(/\b\d+\b/g, "<n>")
    .trim();
}

/** Deterministic per-source trend signature `<source>||<class>` (spec §6). */
export function findingSignature(f: Finding): string {
  const sig = (cls: string): string => `${f.source}||${cls}`;
  switch (f.source) {
    case "audit_log":
      return sig(f.key.match(/ISSUE=\S+/)?.[0] ?? normalizeVolatile(f.key));
    case "status":
      return sig(f.key);                                  // already `state=error`
    case "spawn_results": {
      const rc = f.key.match(/rc=\S+/)?.[0] ?? "rc=?";
      const reason = f.key.match(/reason=(\S+)/)?.[1];
      return sig(reason ? `${rc} reason=${reason.toLowerCase()}` : rc);
    }
    case "outbox":
      try {
        const o = JSON.parse(f.key) as { event?: string; reason?: string };
        const reason = typeof o.reason === "string" ? ` reason=${o.reason.split(/\s+/)[0].toLowerCase()}` : "";
        return sig(`event=${o.event ?? "?"}${reason}`);
      } catch { return sig(normalizeVolatile(f.key)); }
    case "session_log":
      return sig(normalizeVolatile(f.key));
    default:
      return sig(normalizeVolatile(f.key));
  }
}
```

- [ ] **Step 4: Run test to verify it passes** → PASS; `npm run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/playback.ts tests/playback-core.test.ts
git commit -m "feat(playback): per-source trend signature"
```

---

## Task 3: core — trend ledger + `reviewedTarget`

**Files:**
- Modify: `src/core/playback.ts`
- Test: `tests/playback-core.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to `tests/playback-core.test.ts`

```ts
import { parseTrendLedger, accrue, renderTrendDigest, reviewedTarget } from "../src/core/playback.js";

describe("trend ledger", () => {
  it("parse: null / corrupt -> empty; valid -> counts", () => {
    expect(parseTrendLedger(null)).toEqual({ counts: {} });
    expect(parseTrendLedger("not json")).toEqual({ counts: {} });
    const l = parseTrendLedger('{"counts":{"a||x":{"count":2,"firstSeen":"2026-05-01","lastSeen":"2026-05-02"}}}');
    expect(l.counts["a||x"].count).toBe(2);
  });
  it("accrue: first-seen sets both dates; repeat bumps count + lastSeen", () => {
    const l = { counts: {} as Record<string, { count: number; firstSeen: string; lastSeen: string }> };
    accrue(l, [{ source: "status", key: "state=error", context: "part=a" }], "2026-05-01");
    expect(l.counts["status||state=error"]).toEqual({ count: 1, firstSeen: "2026-05-01", lastSeen: "2026-05-01" });
    accrue(l, [{ source: "status", key: "state=error", context: "part=b" }], "2026-05-03");
    expect(l.counts["status||state=error"]).toEqual({ count: 2, firstSeen: "2026-05-01", lastSeen: "2026-05-03" });
  });
  it("renderTrendDigest: count desc then signature asc; topN", () => {
    const l = { counts: { "a||x": { count: 1, firstSeen: "d", lastSeen: "d" }, "b||y": { count: 5, firstSeen: "d", lastSeen: "d" } } };
    expect(renderTrendDigest(l).map((r) => r.signature)).toEqual(["b||y", "a||x"]);
    expect(renderTrendDigest(l, 1).map((r) => r.signature)).toEqual(["b||y"]);
  });
});

describe("reviewedTarget", () => {
  const root = "/home/u/.consort/forensics";
  it("live file -> .reviewed/<date>/<file>", () => {
    expect(reviewedTarget(root, `${root}/2026-05-30/11-00-00-perform-x.md`))
      .toBe(`${root}/.reviewed/2026-05-30/11-00-00-perform-x.md`);
  });
  it("already reviewed -> unchanged (idempotent)", () => {
    expect(reviewedTarget(root, `${root}/.reviewed/2026-05-30/f.md`)).toBe(`${root}/.reviewed/2026-05-30/f.md`);
  });
  it("not under root -> null", () => {
    expect(reviewedTarget(root, "/tmp/x.md")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (not exported).

- [ ] **Step 3: Implement in `src/core/playback.ts`** (append)

```ts
export interface TrendEntry { count: number; firstSeen: string; lastSeen: string; }
export interface TrendLedger { counts: Record<string, TrendEntry>; }
export interface TrendRow { signature: string; count: number; firstSeen: string; lastSeen: string; }

/** Parse `.trends.json`. A null/corrupt/shape-invalid ledger -> empty (never throws). */
export function parseTrendLedger(text: string | null): TrendLedger {
  if (!text) return { counts: {} };
  try {
    const o = JSON.parse(text);
    if (o && typeof o === "object" && o.counts && typeof o.counts === "object") return { counts: o.counts as Record<string, TrendEntry> };
  } catch { /* fall through */ }
  return { counts: {} };
}

/** Accrue findings into the ledger (mutates + returns). `date` is the YYYY-MM-DD stamp. */
export function accrue(ledger: TrendLedger, findings: Finding[], date: string): TrendLedger {
  for (const f of findings) {
    const sig = findingSignature(f);
    const e = ledger.counts[sig];
    if (e) { e.count += 1; e.lastSeen = date; }
    else ledger.counts[sig] = { count: 1, firstSeen: date, lastSeen: date };
  }
  return ledger;
}

/** Ledger -> rows sorted by count desc, then signature asc. topN=0 -> all. */
export function renderTrendDigest(ledger: TrendLedger, topN = 0): TrendRow[] {
  const rows: TrendRow[] = Object.entries(ledger.counts).map(([signature, e]) => ({ signature, ...e }));
  rows.sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
  return topN > 0 ? rows.slice(0, topN) : rows;
}

/** The `.reviewed/<date>/<file>` destination for a live forensics path under `forensicsRoot`.
 *  A path already under `.reviewed/` is returned unchanged (idempotent). null if not under the root. */
export function reviewedTarget(forensicsRoot: string, path: string): string | null {
  const root = forensicsRoot.replace(/\/$/, "");
  if (!path.startsWith(root + "/")) return null;
  const rel = path.slice(root.length + 1);            // <date>/<file>  OR  .reviewed/<date>/<file>
  if (rel.startsWith(".reviewed/")) return path;
  return `${root}/.reviewed/${rel}`;
}
```

- [ ] **Step 4: Run test to verify it passes** → PASS; `npm run typecheck` → 0; run the full
  `npx vitest run tests/playback-core.test.ts` (all Task 1–3 cases green).

- [ ] **Step 5: Commit**

```bash
git add src/core/playback.ts tests/playback-core.test.ts
git commit -m "feat(playback): trend ledger + reviewed-archive path"
```

---

## Task 4: command — `survey` verb (read-only list + trend digest)

**Files:**
- Create: `src/commands/playback.ts`
- Test: `tests/playback-cmd.test.ts`

`survey` walks `globalRoot()/forensics/` for `*.md` (excluding `.reviewed/` unless `--all`), filters
by `--command`/`--since`, prints TSV `<path>\t<command>\t<topic>\t<n_findings>`, then a `TRENDS`
marker + the top-20 ledger rows. Read-only.

- [ ] **Step 1: Write the failing test** — `tests/playback-cmd.test.ts`

```ts
// tests/playback-cmd.test.ts — survey + archive verbs.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshHome } from "./helpers/tmpHome.js";
import { surveyWith, archiveWith } from "../src/commands/playback.js";

function captureStdout() {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (c: any) => { buf += String(c); return true; };
  return { text: () => buf, restore: () => { (process.stdout as any).write = orig; } };
}

// A captured forensics file with `n` findings of the given source/key/context.
function forensicsDoc(command: string, topic: string, findings: Array<[string, string, string]>): string {
  const fm = `---\ncommand: ${command}\ntopic: ${topic}\ntopic_slug: ${topic}\nrepo_hash: h\nart_dir: /x\ninvoked_at: 2026-05-30T00:00:00Z\nn_findings_mechanical: ${findings.length}\n---\n\n`;
  const body = "## Mechanical findings\n\n" + findings.map(([s, k, c]) => `- **${s}** ${k} _(source: ${c})_`).join("\n") + "\n";
  return fm + body;
}

describe("playback survey", () => {
  let h: { home: string; cleanup: () => void };
  let froot: string;
  let out: ReturnType<typeof captureStdout>;
  beforeEach(() => {
    h = freshHome();
    froot = join(h.home, "forensics", "2026-05-30");
    mkdirSync(froot, { recursive: true });
    out = captureStdout();
  });
  afterEach(() => { out.restore(); h.cleanup(); });

  it("lists live forensics as TSV + a TRENDS block; excludes .reviewed/", async () => {
    writeFileSync(join(froot, "11-00-00-perform-add-oauth.md"),
      forensicsDoc("perform", "add-oauth", [["audit_log", "ISSUE=todo_marker", "audit.log"]]));
    // A pre-archived file under .reviewed/ must NOT be listed by default.
    const reviewed = join(h.home, "forensics", ".reviewed", "2026-05-29");
    mkdirSync(reviewed, { recursive: true });
    writeFileSync(join(reviewed, "10-00-00-score-old.md"), forensicsDoc("score", "old", [["status", "state=error", "part=a"]]));
    // A seeded ledger so the TRENDS block has content.
    writeFileSync(join(h.home, "forensics", ".trends.json"),
      '{"counts":{"audit_log||ISSUE=todo_marker":{"count":3,"firstSeen":"2026-05-01","lastSeen":"2026-05-30"}}}');

    const rc = await surveyWith({});
    expect(rc).toBe(0);
    const t = out.text();
    expect(t).toContain(`${join(froot, "11-00-00-perform-add-oauth.md")}\tperform\tadd-oauth\t1`);
    expect(t).not.toContain("score\told");                 // .reviewed/ excluded by default
    expect(t).toContain("TRENDS\naudit_log||ISSUE=todo_marker\t3\t2026-05-01\t2026-05-30");
  });

  it("--command filters; --all includes .reviewed/", async () => {
    writeFileSync(join(froot, "11-00-00-perform-x.md"), forensicsDoc("perform", "x", [["status", "state=error", "part=a"]]));
    const reviewed = join(h.home, "forensics", ".reviewed", "2026-05-29");
    mkdirSync(reviewed, { recursive: true });
    writeFileSync(join(reviewed, "10-00-00-score-y.md"), forensicsDoc("score", "y", [["status", "state=error", "part=b"]]));
    await surveyWith({ all: true, command: "score" });
    const t = out.text();
    expect(t).toContain("score\ty");                       // --all surfaced the archived file
    expect(t).not.toContain("perform\tx");                 // --command=score filtered out perform
  });

  it("bad --since spec -> rc 2", async () => {
    expect(await surveyWith({ since: "2w" })).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (`src/commands/playback.ts` missing).

- [ ] **Step 3: Implement `src/commands/playback.ts`** (the survey half; archive added in Task 5)

```ts
// src/commands/playback.ts — /consort:playback verbs. survey = read-only list + trend digest;
// archive = accrue trend + move surveyed files to .reviewed/. Logic lives in core/playback.ts.
// Port of the prior plugin's review-forensics.sh + forensics-mark-reviewed.sh (review half).
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, renameSync, type Dirent } from "node:fs";
import { join, dirname } from "node:path";
import { log } from "../core/log.js";
import { globalRoot } from "../core/paths.js";
import { atomicWrite } from "../core/atomic.js";
import {
  parseForensicsFrontmatter, parseMechanicalFindings, parseSince,
  parseTrendLedger, accrue, renderTrendDigest, reviewedTarget,
} from "../core/playback.js";

function forensicsRoot(): string { return join(globalRoot(), "forensics"); }

/** Walk forensicsRoot for *.md files; exclude the top-level `.reviewed/` subtree unless included. */
function walkForensics(root: string, includeReviewed: boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (dir === root && e.name === ".reviewed" && !includeReviewed) continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

function readLedgerText(root: string): string | null {
  try { return readFileSync(join(root, ".trends.json"), "utf8"); } catch { return null; }
}

export interface SurveyOpts { all?: boolean; command?: string; since?: string; now?: number; }

export async function surveyWith(o: SurveyOpts): Promise<number> {
  const root = forensicsRoot();
  let cutoff: number | null = null;
  if (o.since) { try { cutoff = parseSince(o.since, o.now ?? Date.now()); } catch (e: any) { log.error(`playback survey: ${e?.message ?? e}`); return 2; } }
  const files = walkForensics(root, Boolean(o.all));
  let n = 0;
  for (const f of files) {
    let text: string; try { text = readFileSync(f, "utf8"); } catch { continue; }
    const meta = parseForensicsFrontmatter(text);
    if (o.command && meta.command !== o.command) continue;
    if (cutoff !== null) { let mt = 0; try { mt = statSync(f).mtimeMs; } catch { /* */ } if (mt < cutoff) continue; }
    process.stdout.write(`${f}\t${meta.command}\t${meta.topic}\t${meta.nFindings}\n`);
    n++;
  }
  process.stdout.write("TRENDS\n");
  for (const t of renderTrendDigest(parseTrendLedger(readLedgerText(root)), 20)) {
    process.stdout.write(`${t.signature}\t${t.count}\t${t.firstSeen}\t${t.lastSeen}\n`);
  }
  log.info(`playback survey: ${n} forensics file(s)`);
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const verb = args[0]; const rest = args.slice(1);
  if (verb === "survey") {
    const o: SurveyOpts = {};
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--all") o.all = true;
      else if (rest[i] === "--command") o.command = rest[++i];
      else if (rest[i] === "--since") o.since = rest[++i];
      else { log.error(`playback survey: unknown flag '${rest[i]}'`); return 2; }
    }
    return surveyWith(o);
  }
  log.error("usage: playback <survey|archive> ...");
  return 2;
}
```

(`dirname`, `mkdirSync`, `renameSync`, `parseMechanicalFindings`, `atomicWrite`, `accrue`,
`reviewedTarget` are imported now but used by `archiveWith` in Task 5 — leave them imported; the
`archiveWith` export lands next task. If eslint `no-unused-vars` flags any before Task 5, add
`archiveWith` in the same task rather than splitting the import.)

- [ ] **Step 4: Run test to verify it passes** → `npx vitest run tests/playback-cmd.test.ts -t "survey"` PASS; `npm run typecheck` 0.

- [ ] **Step 5: Commit**

```bash
git add src/commands/playback.ts tests/playback-cmd.test.ts
git commit -m "feat(playback): survey verb (read-only list + trend digest)"
```

> **Note for the implementer:** to keep `npm run lint` green at this commit, implement `archiveWith`
> (Task 5 Step 3) in the **same** working session before committing if eslint flags the
> archive-only imports as unused — or include a minimal `archiveWith` stub-then-fill. Simplest: do
> Task 4 + Task 5 implementation together, commit once per task's tests. The two-stage review still
> runs per task.

---

## Task 5: command — `archive` verb + dispatcher registration

**Files:**
- Modify: `src/commands/playback.ts` (`archiveWith` + the `run` switch)
- Modify: `src/consort.ts` (register `playback`)
- Test: `tests/playback-cmd.test.ts` (extend)

`archive` reads the ledger, then per path: compute `.reviewed/` target, read findings, **move the
file first**, and **accrue only on a successful move** (so an interrupted run never double-counts —
spec §5/§12). Writes the ledger once at the end. Idempotent (already-`.reviewed/` skipped).

- [ ] **Step 1: Write the failing test** — append to `tests/playback-cmd.test.ts`

```ts
describe("playback archive", () => {
  let h: { home: string; cleanup: () => void };
  let froot: string;
  beforeEach(() => { h = freshHome(); froot = join(h.home, "forensics", "2026-05-30"); mkdirSync(froot, { recursive: true }); });
  afterEach(() => h.cleanup());

  it("accrues the trend and moves files to .reviewed/", async () => {
    const f = join(froot, "11-00-00-perform-x.md");
    writeFileSync(f, forensicsDoc("perform", "x", [["audit_log", "ISSUE=todo_marker", "audit.log"], ["status", "state=error", "part=a"]]));
    const rc = await archiveWith([f], { now: new Date("2026-05-30T00:00:00Z") });
    expect(rc).toBe(0);
    // file moved
    expect(existsSync(f)).toBe(false);
    expect(existsSync(join(h.home, "forensics", ".reviewed", "2026-05-30", "11-00-00-perform-x.md"))).toBe(true);
    // trend accrued
    const led = JSON.parse(readFileSync(join(h.home, "forensics", ".trends.json"), "utf8"));
    expect(led.counts["audit_log||ISSUE=todo_marker"]).toEqual({ count: 1, firstSeen: "2026-05-30", lastSeen: "2026-05-30" });
    expect(led.counts["status||state=error"].count).toBe(1);
  });

  it("is idempotent: a path already under .reviewed/ is skipped (no re-accrue)", async () => {
    const reviewed = join(h.home, "forensics", ".reviewed", "2026-05-29");
    mkdirSync(reviewed, { recursive: true });
    const r = join(reviewed, "10-00-00-score-y.md");
    writeFileSync(r, forensicsDoc("score", "y", [["status", "state=error", "part=b"]]));
    expect(await archiveWith([r])).toBe(0);
    // not re-moved, ledger empty (skip-before-accrue)
    expect(existsSync(r)).toBe(true);
    const led = JSON.parse(readFileSync(join(h.home, "forensics", ".trends.json"), "utf8"));
    expect(led.counts).toEqual({});
  });

  it("rc 2 when no paths given", async () => {
    const { run } = await import("../src/commands/playback.js");
    expect(await run(["archive"])).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (`archiveWith` not exported / archive verb missing).

- [ ] **Step 3: Implement `archiveWith` + wire the `archive` verb** in `src/commands/playback.ts`

Append the export:

```ts
export interface ArchiveOpts { now?: Date; }

export async function archiveWith(paths: string[], o: ArchiveOpts = {}): Promise<number> {
  const root = forensicsRoot();
  const ledger = parseTrendLedger(readLedgerText(root));
  const date = (o.now ?? new Date()).toISOString().slice(0, 10);
  let moved = 0;
  for (const p of paths) {
    const target = reviewedTarget(root, p);
    if (target === null) { log.warn(`playback archive: skip (not under forensics root): ${p}`); continue; }
    if (target === p) { log.info(`playback archive: already reviewed: ${p}`); continue; }
    let text: string;
    try { text = readFileSync(p, "utf8"); } catch { log.warn(`playback archive: skip (unreadable): ${p}`); continue; }
    const findings = parseMechanicalFindings(text);
    try { mkdirSync(dirname(target), { recursive: true }); renameSync(p, target); }
    catch (e: any) { log.warn(`playback archive: move failed for ${p}: ${e?.message ?? e}`); continue; }
    accrue(ledger, findings, date);                       // only after a successful move
    moved++;
  }
  atomicWrite(join(root, ".trends.json"), JSON.stringify(ledger, null, 2) + "\n");
  log.ok(`playback archive: ${moved} file(s) moved to .reviewed/, trend updated`);
  return 0;
}
```

Add the `archive` case to the `run` switch (before the usage fallback):

```ts
  if (verb === "archive") {
    if (rest.length === 0) { log.error("usage: playback archive <path...>"); return 2; }
    return archiveWith(rest);
  }
```

Register in `src/consort.ts` `loadHandlers` — add `playback` to the destructured array, the
`Promise.all` import list, and the returned map:

```ts
  const [spawn, send, collect, roster, coda, soundcheck, preflight, hook, solo, score, perform, playback] = await Promise.all([
    import("./commands/spawn.js"), import("./commands/send.js"), import("./commands/collect.js"),
    import("./commands/roster.js"), import("./commands/coda.js"), import("./commands/soundcheck.js"),
    import("./commands/preflight.js"), import("./commands/hook.js"), import("./commands/solo.js"),
    import("./commands/score.js"), import("./commands/perform.js"), import("./commands/playback.js"),
  ]);
  return {
    spawn: spawn.run, send: send.run, collect: collect.run, roster: roster.run,
    coda: coda.run, soundcheck: soundcheck.run, preflight: preflight.run, hook: hook.run,
    solo: solo.run, score: score.run, perform: perform.run, playback: playback.run,
  };
```

- [ ] **Step 4: Run the FULL suite + gates** — `npx vitest run tests/playback-cmd.test.ts` PASS,
  then `npm run typecheck` 0, `npm run lint` 0, `npm run test` all green (stale-token gate included).

- [ ] **Step 5: Commit**

```bash
git add src/commands/playback.ts src/consort.ts tests/playback-cmd.test.ts
git commit -m "feat(playback): archive verb (accrue trend + move to .reviewed/) + register"
```

---

## Task 6: directive `commands/playback.md` + rebuild dist

**Files:**
- Create: `commands/playback.md`
- Rebuild + commit: `dist/consort.cjs`

Prose/directive task — no unit tests (verified by the dogfood, Task 8). Honor the rebrand: "Maestro"
not "Master Yoda", "part" not "trooper", "consort has been healthy". The stale-token gate scans
`commands/playback.md` — no banned tokens.

- [ ] **Step 1: Create `commands/playback.md`**

````markdown
---
description: Review accumulated forensics from solo/score/perform — surface the problems recorded since you last looked, cluster recurring patterns with their lifetime trend, suggest next actions, then archive what was reviewed
allowed-tools: Bash, Read
---

# /consort:playback

Survey the forensics that `/consort:solo`, `/consort:score`, and `/consort:perform` recorded at
teardown, surface what is **new since you last ran playback**, show how often each pattern has
recurred over the life of the project, suggest one next action per cluster, then file the surveyed
files away so the next run only shows new problems. **Zero arguments needed.**

Let `CS="node ${CLAUDE_PLUGIN_ROOT}/dist/consort.cjs"`.

## Steps

1. **Survey.** `$CS playback survey` (pass through a user-supplied `--all` / `--command <name>` /
   `--since <Nd|Nh>` only if they typed one — none are required). It prints, before a `TRENDS` line,
   one TSV row per **live** (un-reviewed) forensics file: `<path>\t<command>\t<topic>\t<n_findings>`;
   after `TRENDS`, the top recurring signatures: `<signature>\t<count>\t<first_seen>\t<last_seen>`.
2. **Healthy short-circuit.** If there are **zero** file rows before `TRENDS`, print
   `no new forensics since last playback; consort has been healthy` and stop (nothing to archive).
3. **Read the findings.** For each surfaced path, `Read` (or one batched `cat` with `---SEP---`
   separators) the file's `## Mechanical findings` + `## Maestro reflection` sections.
4. **Cluster.** Group findings whose `source` + meaningful `key`/`context` token match (e.g. all
   `audit_log ISSUE=unresolved_placeholder`; all `outbox` timeout events). Rank clusters by count,
   descending.
5. **Annotate with the trend.** Match each cluster to a `TRENDS` signature and attach its lifetime
   recurrence — e.g. `3 this run · 11 since 2026-04-18`.
6. **Suggest one action per cluster:**
   - **3+ occurrences across distinct topics** → a **feedback memory** (give the slug) or a **spec
     topic** under `docs/superpowers/specs/`.
   - **2 occurrences** → "watch list"; a memory only if generalizable.
   - **1 occurrence** → one-off, no action.
7. **Surface the summary:**
   ```
   ## Forensics review (since last run, <N> files)

   ### Cluster 1 — <pattern> (<this-run> this run · <lifetime> lifetime, across <topics>)
   <files>
   Suggested action: <one concrete next step>

   ### Cluster 2 — <pattern> (...)
   ...
   ```
8. **File away.** `$CS playback archive <path1> <path2> ...` with the surveyed paths — accrues the
   trend (once per file) and moves each to `globalRoot()/forensics/.reviewed/<date>/`. Report
   `<N> files archived`. The next run starts clean.

Archiving runs **after** the summary, so an interrupted run never files away problems you did not
see — they stay live and re-surface (counted exactly once) next time.
````

- [ ] **Step 2: Rebuild dist + full gate**

```bash
npm run build && npm run typecheck && npm run test && npm run lint
```
Expected: `dist/consort.cjs` regenerated; typecheck 0; all tests green; lint 0; stale-token gate
green (now scanning `commands/playback.md`).

- [ ] **Step 3: Verify the verb is bundled + dispatch works**

```bash
grep -o '"survey"\|"archive"' dist/consort.cjs | sort -u    # both present
CONSORT_HOME=$(mktemp -d) node dist/consort.cjs playback survey   # prints just "TRENDS" (empty dir) rc 0
```

- [ ] **Step 4: Commit**

```bash
git add commands/playback.md dist/consort.cjs
git commit -m "feat(playback): directive + rebuilt dist"
```

---

## Task 7: refresh the phase guard

**Files:**
- Modify: `CLAUDE.md` (repo root)

With `playback` landing, only `prelude` and `rehearsal` remain unshipped. Update the "Current phase
guard" section's "Still OUT OF SCOPE" list accordingly. `CLAUDE.md` is not scanned by the stale-token
gate, but keep the prose rebrand-clean.

- [ ] **Step 1: Edit the guard** — change the shipped list to include `playback`, and the
  out-of-scope list to `prelude` (meditate) / `rehearsal` (deep-research) only. Concretely, in the
  "**Shipped:**" sentence add `**`playback`** (review-forensics)` after `perform`, and in the
  "**Still OUT OF SCOPE**" sentence drop `playback` so it reads `prelude` (meditate) and `rehearsal`
  (deep-research).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(consort): refresh phase guard — playback shipped"
```

---

## Task 8: live dogfood

**Files:**
- Append: `docs/superpowers/DOGFOOD.md`

Conductor-run (NOT a subagent task). `playback` has no parts/IPC/tmux — no external-binary blocker —
so this dogfood is **fully live** end-to-end.

- [ ] **Step 1: Seed + run.** In an isolated `CONSORT_HOME` temp dir, seed
  `<home>/forensics/<date>/` with two or three real captured-shape forensics files (copy a couple
  from a real `~/.consort/forensics/` if present, else hand-write the frontmatter + `## Mechanical
  findings` bullets across ≥2 sources so clustering + the per-source signature are exercised). Then:
  - `node dist/consort.cjs playback survey` → assert TSV rows for each live file + a `TRENDS` block.
  - `node dist/consort.cjs playback archive <those paths>` → assert files moved under `.reviewed/`
    and `.trends.json` written with per-signature counts.
  - `node dist/consort.cjs playback survey` again → assert **zero** file rows (only `TRENDS`),
    proving incremental "only new" behavior.
  - Seed one **new** forensics file → `survey` surfaces only it; `archive` bumps the recurring
    signature's `count` (lifetime trend) while a fresh signature starts at 1.
  - Corrupt `.trends.json` (write `not json`) → `survey`/`archive` still succeed (treated as empty).

- [ ] **Step 2: Append the result** to `docs/superpowers/DOGFOOD.md` under a "Consort `playback`"
  heading: the commands run, observed outputs (the incremental zero-rows second run, the trend
  counts, the `.reviewed/` move, the corruption tolerance), and the verification context
  (test count, gates, dist rebuilt).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/DOGFOOD.md
git commit -m "docs(playback): live dogfood result"
```

---

## Self-review

- **Spec coverage:**
  - §4 `survey` → Task 4; `archive` → Task 5; optional flags → Tasks 4/5 arg parsing. ✓
  - §5 directive (survey → cluster → suggest → archive, archive-after-present) → Task 6. ✓
  - §6 per-source signature (audit_log/status/spawn_results/outbox/session_log + fallback) → Task 2. ✓
  - §6 ledger (parse/accrue/render, corruption→empty) → Task 3. ✓
  - §6 accrual-once + move-then-accrue robustness → Task 5 Step 3. ✓
  - §7 state layout (`.reviewed/<date>/`, `.trends.json`) → Tasks 3/5. ✓
  - §10 testing (per-source cases, incremental, idempotent, corruption, healthy path) → Tasks 1–5 + 8. ✓
  - §11 acceptance (zero-choice, incremental, trend, archive-not-delete, robustness, gates) → all tasks. ✓
  - §13 single plan, subagent-driven, one dogfood + dist + guard → Tasks 6/7/8. ✓
- **Placeholder scan:** every code step has complete code; no TBD/TODO/"handle edge cases". ✓
- **Type consistency:** `Finding {source,key,context}` (from forensics.ts) used everywhere;
  `TrendLedger {counts}` / `TrendEntry {count,firstSeen,lastSeen}` / `TrendRow {signature,...}`
  consistent across Tasks 3/4/5; `findingSignature`/`accrue`/`reviewedTarget`/`parseTrendLedger`/
  `renderTrendDigest`/`surveyWith`/`archiveWith` names identical in defs + call sites. ✓
- **Rebrand/gate:** no `clone-wars`/`cw_`/`trooper`/`commander`/`master-yoda` in any shipped file;
  sources cited as `review-forensics.sh`/`forensics.sh` in JSDoc. ✓
