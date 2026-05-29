# consort score — A2 (N-way aggregators) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the two most intricate pure aggregators of consort `score` — the N-way Venn diff and the 5-tier adjudication — byte-faithfully, with full unit coverage.

**Architecture:** Two pure modules with no fs/spawn: `core/scoreDiff.ts` (parse claims, citation overlap, N-way bucketing → structured buckets + bucket-file contents + `diff.md`) and `core/scoreAdjudicate.ts` (parse verdicts, n2/nge3 adjudication → `adjudicated.md` text). The command layer (Phases C/D) reads/writes the actual files; these functions only transform strings. Companion to Phase A; `scoreDiff` is needed by Phase C, `scoreAdjudicate` by Phase D.

**Tech Stack:** TypeScript (ES2022/NodeNext/strict), vitest, eslint (`no-unused-vars: error`). ESM `.js` imports.

**Behavioral source (byte-faithful — `/home/liupan/CC/clone-wars/lib/consult.sh`):** `cw_consult_parse_claims` (39-57), `cw_consult_citation_overlaps` (89-119), `cw_consult_diff` (149-336), `cw_consult_parse_verdicts` (347-376), `_cw_consult_write_adjudicated_n2` (517-564), `_cw_consult_write_adjudicated_nge3` (569-761, incl. the `_classify` truth table). Read these before implementing; the fixture tests below are the precise contract. The em-dash `—` is **U+2014** (literal in several output formats) — copy it exactly.

**Rebrand note:** the Bash adjudicated.md comments say "Master Yoda" — consort uses **"Maestro"**. The output section headings and the `synthesize refuses while PENDING` wording carry over; the stale-token gate (`clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_`) must stay green, so the ported comment strings must say Maestro and avoid `cw_`.

---

## Task 1: `scoreDiff.ts` — `parseClaims` + `citationOverlaps`

**Files:** Create `src/core/scoreDiff.ts`; Test `tests/score-diff.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/score-diff.test.ts
import { describe, it, expect } from "vitest";
import { parseClaims, citationOverlaps } from "../src/core/scoreDiff.js";

describe("parseClaims", () => {
  it("extracts [cite] + text from numbered lines under ## Claims only", () => {
    const md = [
      "# Findings: X", "## Summary", "prose here",
      "## Claims",
      "1. [src/a.ts:10] does the thing",
      "2. [https://x.com] external fact",
      "no-citation line is skipped",
      "## Notes", "3. [src/b.ts:1] NOT a claim (outside block)",
    ].join("\n");
    expect(parseClaims(md)).toEqual([
      { cite: "src/a.ts:10", text: "does the thing" },
      { cite: "https://x.com", text: "external fact" },
    ]);
  });
  it("no ## Claims block → []", () => { expect(parseClaims("# X\n## Summary\ny\n")).toEqual([]); });
});

describe("citationOverlaps", () => {
  it("URL: exact equality only", () => {
    expect(citationOverlaps("https://a", "https://a")).toBe(true);
    expect(citationOverlaps("https://a", "https://b")).toBe(false);
  });
  it("runtime: exact equality only", () => {
    expect(citationOverlaps("runtime: npm test", "runtime: npm test")).toBe(true);
    expect(citationOverlaps("runtime: a", "runtime: b")).toBe(false);
  });
  it("file vs URL/runtime never overlap", () => {
    expect(citationOverlaps("src/a.ts:1", "https://a")).toBe(false);
    expect(citationOverlaps("src/a.ts:1", "runtime: x")).toBe(false);
  });
  it("file: same path required; ./ stripped", () => {
    expect(citationOverlaps("./src/a.ts:1", "src/a.ts:1")).toBe(true);
    expect(citationOverlaps("src/a.ts:1", "src/b.ts:1")).toBe(false);
  });
  it("path-only on either side covers all lines → overlap", () => {
    expect(citationOverlaps("src/a.ts", "src/a.ts:50")).toBe(true);
    expect(citationOverlaps("src/a.ts:50", "src/a.ts")).toBe(true);
  });
  it("ranges overlap iff a1<=b2 && b1<=a2 (single line = Lo=Hi)", () => {
    expect(citationOverlaps("src/a.ts:10-20", "src/a.ts:15")).toBe(true);
    expect(citationOverlaps("src/a.ts:10-20", "src/a.ts:25")).toBe(false);
    expect(citationOverlaps("src/a.ts:10", "src/a.ts:10")).toBe(true);
  });
  it("leading-zero numerals are base-10 (no octal), non-digit endpoints → no overlap", () => {
    expect(citationOverlaps("src/a.ts:008", "src/a.ts:008")).toBe(true);
    expect(citationOverlaps("src/a.ts:x", "src/a.ts:1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/score-diff.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/scoreDiff.ts
export interface Claim { cite: string; text: string; }

/** Port of cw_consult_parse_claims (lib/consult.sh:43): `N. [cite] text` lines under `## Claims`. */
export function parseClaims(findings: string): Claim[] {
  const out: Claim[] = [];
  let inClaims = false;
  for (const line of findings.split("\n")) {
    if (/^## Claims/.test(line)) { inClaims = true; continue; }
    if (/^## /.test(line)) { inClaims = false; continue; }
    if (inClaims && /^[0-9]+\. \[[^\]]+\] /.test(line)) {
      const m = line.match(/\[[^\]]+\]/);
      if (!m || m.index === undefined) continue;
      const cite = m[0].slice(1, -1);
      const text = line.slice(m.index + m[0].length).replace(/^[ \t]+/, "");
      out.push({ cite, text });
    }
  }
  return out;
}

/** Port of cw_consult_citation_overlaps (lib/consult.sh:89). True iff two citations cite the same source. */
export function citationOverlaps(aRaw: string, bRaw: string): boolean {
  const a = aRaw.replace(/^\.\//, "");
  const b = bRaw.replace(/^\.\//, "");
  if (a.startsWith("http") || b.startsWith("http")) return a === b;
  if (a.startsWith("runtime:") || b.startsWith("runtime:")) return a === b;
  const aPath = a.split(":")[0];
  const bPath = b.split(":")[0];
  if (aPath !== bPath) return false;
  const aLines = a.includes(":") ? a.slice(a.indexOf(":") + 1) : "";
  const bLines = b.includes(":") ? b.slice(b.indexOf(":") + 1) : "";
  if (aLines === "" || bLines === "") return true; // path-only covers all lines
  const split = (s: string): [string, string] =>
    s.includes("-") ? [s.slice(0, s.indexOf("-")), s.slice(s.indexOf("-") + 1)] : [s, s];
  const [a1s, a2s] = split(aLines);
  const [b1s, b2s] = split(bLines);
  if (![a1s, a2s, b1s, b2s].every((x) => /^[0-9]+$/.test(x))) return false;
  const a1 = parseInt(a1s, 10), a2 = parseInt(a2s, 10), b1 = parseInt(b1s, 10), b2 = parseInt(b2s, 10);
  return a1 <= b2 && b1 <= a2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/score-diff.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/scoreDiff.ts tests/score-diff.test.ts
git commit -m "feat(score): parseClaims + citationOverlaps (byte-faithful)"
```

---

## Task 2: `scoreDiff.ts` — `diffFindings` (N-way Venn)

**Files:** Modify `src/core/scoreDiff.ts`; Test `tests/score-diff.test.ts` (extend).
**Source:** `cw_consult_diff` (149-336). **Invariants:** (1) first-match-wins membership growth in input order, scanning only *later* parts' unbucketed claims; (2) bucket line = `[<first-cite>] <text1> | <text2> | …`; (3) N=2 writes only the two `<name>_only_items.txt` (the "Agreed" bucket lives only inside `diff.md`); N≥3 writes `consensus.txt` + each `<a>+<b>_only.txt` + each `<name>_only_items.txt`; (4) bucket-file content = items joined by `\n` + a trailing `\n` (empty bucket = empty string); (5) `diff.md` section bodies prefix each item with `- `, sections separated by a blank line, names title-cased.

- [ ] **Step 1: Write the failing test** (merge `diffFindings` into the existing import)

```ts
import { diffFindings } from "../src/core/scoreDiff.js"; // merge into existing import line

const claims = (...items: string[]) => "## Claims\n" + items.map((c, i) => `${i + 1}. ${c}`).join("\n") + "\n";

describe("diffFindings N=2", () => {
  it("buckets agreed vs single-only; writes two *_only_items.txt + diff.md", () => {
    const rex = claims("[src/a.ts:10] both see A", "[src/r.ts:1] only rex");
    const cody = claims("[src/a.ts:12] both see A", "[src/c.ts:1] only cody");
    const r = diffFindings([{ name: "rex", findings: rex }, { name: "cody", findings: cody }]);
    // bucket files: exactly the two single-only files
    const names = r.files.map((f) => f.filename).sort();
    expect(names).toEqual(["cody_only_items.txt", "rex_only_items.txt"]);
    expect(r.files.find((f) => f.filename === "rex_only_items.txt")!.content).toBe("[src/r.ts:1] only rex\n");
    expect(r.files.find((f) => f.filename === "cody_only_items.txt")!.content).toBe("[src/c.ts:1] only cody\n");
    // diff.md: Agreed has the merged pair (pipe-joined), then the two -only sections
    expect(r.diffMd).toContain("## Agreed\n- [src/a.ts:10] both see A | both see A\n");
    expect(r.diffMd).toContain("## Rex-only\n- [src/r.ts:1] only rex\n");
    expect(r.diffMd).toContain("## Cody-only\n- [src/c.ts:1] only cody\n");
  });
  it("empty single bucket → empty file content + empty diff.md section", () => {
    const rex = claims("[src/a.ts:1] shared");
    const cody = claims("[src/a.ts:1] shared");
    const r = diffFindings([{ name: "rex", findings: rex }, { name: "cody", findings: cody }]);
    expect(r.files.find((f) => f.filename === "rex_only_items.txt")!.content).toBe("");
    expect(r.diffMd).toContain("## Rex-only\n\n");
  });
});

describe("diffFindings N=3", () => {
  it("writes consensus.txt + pair-only + single-only; diff.md Consensus/pairs/singles", () => {
    const rex = claims("[a.ts:1] all", "[rc.ts:1] rex+cody");
    const cody = claims("[a.ts:1] all", "[rc.ts:1] rex+cody");
    const bly = claims("[a.ts:1] all", "[b.ts:1] only bly");
    const r = diffFindings([
      { name: "rex", findings: rex }, { name: "cody", findings: cody }, { name: "bly", findings: bly },
    ]);
    const names = r.files.map((f) => f.filename).sort();
    expect(names).toEqual([
      "bly_only_items.txt", "cody_only_items.txt", "consensus.txt",
      "rex+bly_only.txt", "rex+cody_only.txt", "rex_only_items.txt",
    ].sort());
    expect(r.files.find((f) => f.filename === "consensus.txt")!.content).toBe("[a.ts:1] all | all | all\n");
    expect(r.files.find((f) => f.filename === "rex+cody_only.txt")!.content).toBe("[rc.ts:1] rex+cody | rex+cody\n");
    expect(r.files.find((f) => f.filename === "bly_only_items.txt")!.content).toBe("[b.ts:1] only bly\n");
    expect(r.diffMd).toContain("## Consensus\n- [a.ts:1] all | all | all\n");
    expect(r.diffMd).toContain("## Rex+Cody only\n- [rc.ts:1] rex+cody | rex+cody\n");
    expect(r.diffMd).toContain("## Bly-only\n- [b.ts:1] only bly\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/score-diff.test.ts`
Expected: FAIL — `diffFindings` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/core/scoreDiff.ts`)

```ts
export interface DiffFile { filename: string; content: string; }
export interface DiffResult { files: DiffFile[]; diffMd: string; }
export interface DiffPart { name: string; findings: string; }

const titlecase = (s: string): string => (s.length ? s[0].toUpperCase() + s.slice(1) : s);
const fileBody = (lines: string[] | undefined): string => (lines && lines.length ? lines.join("\n") + "\n" : "");
function mdSection(header: string, lines: string[] | undefined): string {
  return header + "\n" + (lines && lines.length ? lines.map((l) => `- ${l}`).join("\n") + "\n" : "");
}

/** Port of cw_consult_diff (lib/consult.sh:149). N>=2 parts → bucket files + diff.md. */
export function diffFindings(parts: DiffPart[]): DiffResult {
  const n = parts.length;
  if (n < 2) throw new Error(`diffFindings: need >=2 parts, got ${n}`);
  const names = parts.map((p) => p.name);

  // Flat parallel arrays (one entry per claim across all parts), with per-part windows.
  const owner: number[] = [], cite: string[] = [], text: string[] = [], flag: boolean[] = [];
  const start: number[] = [], end: number[] = [];
  for (let idx = 0; idx < n; idx++) {
    start[idx] = owner.length;
    for (const c of parseClaims(parts[idx].findings)) { owner.push(idx); cite.push(c.cite); text.push(c.text); flag.push(false); }
    end[idx] = owner.length;
  }

  // Membership growth: first-match-wins against later parts' unbucketed claims.
  const buckets = new Map<string, string[]>();
  const add = (key: string, line: string): void => { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key)!.push(line); };
  for (let i = 0; i < n; i++) {
    for (let j = start[i]; j < end[i]; j++) {
      if (flag[j]) continue;
      let memberKeys = names[i];
      const firstCite = cite[j];
      let combined = text[j];
      flag[j] = true;
      for (let k = i + 1; k < n; k++) {
        for (let m = start[k]; m < end[k]; m++) {
          if (flag[m]) continue;
          if (citationOverlaps(firstCite, cite[m])) { memberKeys += `,${names[k]}`; combined += ` | ${text[m]}`; flag[m] = true; break; }
        }
      }
      add(memberKeys, `[${firstCite}] ${combined}`);
    }
  }

  const allKey = names.join(",");
  const files: DiffFile[] = [];
  let diffMd = "";
  if (n === 2) {
    for (const name of names) files.push({ filename: `${name}_only_items.txt`, content: fileBody(buckets.get(name)) });
    diffMd =
      mdSection("## Agreed", buckets.get(allKey)) + "\n" +
      mdSection(`## ${titlecase(names[0])}-only`, buckets.get(names[0])) + "\n" +
      mdSection(`## ${titlecase(names[1])}-only`, buckets.get(names[1]));
  } else {
    files.push({ filename: "consensus.txt", content: fileBody(buckets.get(allKey)) });
    const pairKeys: string[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairKeys.push(`${names[i]},${names[j]}`);
    for (const key of pairKeys) { const [a, b] = key.split(","); files.push({ filename: `${a}+${b}_only.txt`, content: fileBody(buckets.get(key)) }); }
    for (const name of names) files.push({ filename: `${name}_only_items.txt`, content: fileBody(buckets.get(name)) });
    let md = mdSection("## Consensus", buckets.get(allKey));
    for (const key of pairKeys) { const [a, b] = key.split(","); md += "\n" + mdSection(`## ${titlecase(a)}+${titlecase(b)} only`, buckets.get(key)); }
    for (const name of names) md += "\n" + mdSection(`## ${titlecase(name)}-only`, buckets.get(name));
    diffMd = md;
  }
  return { files, diffMd };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/score-diff.test.ts`
Expected: PASS (9 + 3 = 12 tests). Cross-check against `cw_consult_diff` (lib/consult.sh:149-336): the membership-growth loop, the N=2-only-two-files rule, the bucket-line `| ` join, and the `diff.md` section shapes must match.

- [ ] **Step 5: Commit**

```bash
git add src/core/scoreDiff.ts tests/score-diff.test.ts
git commit -m "feat(score): diffFindings N-way Venn bucketer (byte-faithful)"
```

---

## Task 3: `scoreAdjudicate.ts` — `parseVerdicts`

**Files:** Create `src/core/scoreAdjudicate.ts`; Test `tests/score-adjudicate.test.ts`.
**Source:** `cw_consult_parse_verdicts` (lib/consult.sh:347-376).

- [ ] **Step 1: Write the failing test**

```ts
// tests/score-adjudicate.test.ts
import { describe, it, expect } from "vitest";
import { parseVerdicts } from "../src/core/scoreAdjudicate.js";

describe("parseVerdicts", () => {
  it("parses AGREE/DISPUTE/UNCERTAIN under ## Verdicts with optional indented evidence", () => {
    const md = [
      "# Verify", "## Verdicts",
      "1. AGREE [src/a.ts:1] claim one",
      "   confirmed by reading the file",
      "2. DISPUTE [src/b.ts:2] claim two",
      "3. UNCERTAIN [https://x] claim three",
      "   could not fetch",
      "   second evidence line",
      "## Notes", "4. AGREE [out/scope] ignored (outside block)",
    ].join("\n");
    expect(parseVerdicts(md)).toEqual([
      { tag: "AGREE", cite: "src/a.ts:1", text: "claim one", evidence: "confirmed by reading the file" },
      { tag: "DISPUTE", cite: "src/b.ts:2", text: "claim two", evidence: "" },
      { tag: "UNCERTAIN", cite: "https://x", text: "claim three", evidence: "could not fetch second evidence line" },
    ]);
  });
  it("hallucinated tags (UNKNOWN/MAYBE) are dropped; no block → []", () => {
    expect(parseVerdicts("## Verdicts\n1. MAYBE [a] x\n")).toEqual([]);
    expect(parseVerdicts("# V\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/score-adjudicate.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/scoreAdjudicate.ts
export interface Verdict { tag: "AGREE" | "DISPUTE" | "UNCERTAIN"; cite: string; text: string; evidence: string; }

/** Port of cw_consult_parse_verdicts (lib/consult.sh:347): `N. TAG [cite] text` + optional indented
 *  evidence continuation lines, under `## Verdicts`. Only AGREE/DISPUTE/UNCERTAIN accepted. */
export function parseVerdicts(verify: string): Verdict[] {
  const out: Verdict[] = [];
  let inV = false;
  let cur: Verdict | null = null;
  const flush = (): void => { if (cur) { out.push(cur); cur = null; } };
  for (const line of verify.split("\n")) {
    if (/^## Verdicts/.test(line)) { inV = true; continue; }
    if (/^## /.test(line)) { flush(); inV = false; continue; }
    if (inV && /^[0-9]+\. (AGREE|DISPUTE|UNCERTAIN) \[[^\]]+\] /.test(line)) {
      flush();
      const rest = line.replace(/^[0-9]+\. /, "");
      const tag = rest.slice(0, rest.indexOf(" ")) as Verdict["tag"];
      const afterTag = rest.replace(/^[A-Z]+ /, "");
      const m = afterTag.match(/\[[^\]]+\]/)!;
      const cite = m[0].slice(1, -1);
      const text = afterTag.slice((m.index ?? 0) + m[0].length).replace(/^[ \t]+/, "");
      cur = { tag, cite, text, evidence: "" };
      continue;
    }
    if (inV && cur && /^[ \t]+/.test(line)) {
      const ev = line.replace(/^[ \t]+/, "");
      cur.evidence = cur.evidence === "" ? ev : `${cur.evidence} ${ev}`;
      continue;
    }
  }
  flush();
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/score-adjudicate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/scoreAdjudicate.ts tests/score-adjudicate.test.ts
git commit -m "feat(score): parseVerdicts (byte-faithful)"
```

---

## Task 4: `scoreAdjudicate.ts` — `adjudicate` (n2 4-section + nge3 5-tier)

**Files:** Modify `src/core/scoreAdjudicate.ts`; Test `tests/score-adjudicate.test.ts` (extend).
**Source:** `_cw_consult_write_adjudicated_n2` (517-564) + `_cw_consult_write_adjudicated_nge3` (569-761) incl. `_classify` (600-619). Read both before implementing.

**Key invariants (the byte-faithful contract):**
- **Input:** `parts` (in order; `[0]`=rex-equiv, `[1]`=cody-equiv), `verify[commander]` (verify.md text, `""` if absent), `vs[commander]` (VS state, default `"skipped"`), `buckets[filename]` (bucket-file contents from `diffFindings`: `consensus.txt`, `<a>+<b>_only.txt`, `<name>_only_items.txt`).
- **n2 sections + order:** `## Cross-verified` (AGREE verdicts, **parts[1] first then parts[0]**, line `- [cite] text — <CMDR_UC> confirmed: <evidence||text>`), `## Adjudicated` (a Maestro `<!-- … -->` comment, then non-AGREE verdicts parts[1]-first as `- PENDING: [cite] text — <CMDR_UC> <tag>: <evidence||text>`), `## Contested` (a Maestro comment, no items), `## Not-verified` (for parts[0]: if its VS ∉ {ok,skipped} and `buckets["<c1>_only_items.txt"]` non-empty, each line → `- <line> — <C0_UC> verify dispatch <vs>`; then parts[1] symmetric over `buckets["<c0>_only_items.txt"]`). `CMDR_UC` = uppercased commander name.
- **nge3 sections + order:** `## Consensus findings (all troopers)` (each `consensus.txt` line → `- <line> [<c0>+<c1>+…]`), `## Cross-verified`, `## Contested`, `## Refuted`, `## - PENDING:` (a Maestro comment, then pending items). Built by classifying each non-consensus bucket line.
- **nge3 per-bucket:** verifiers = commanders **not** in the owner-set (owners split on `+`), in input order; `k` = verifier count; for each verifier, verdict = `verdictMap["<verifier>__<cite>"]` else `UNCERTAIN`; tally `na/nd/nu`; `srcset` = (`ownerCount==n` OR `k==0`) ? `<owners>` : `<owners>, <v0>:<vd0>, <v1>:<vd1>, …`; rendered = `- [cite] text [<srcset>]`; classify → push to the matching section. Process pair buckets (i<j input order) then single buckets (input order).
- **`_classify(na, nd, nu, k, owners)`** (exact truth table):
  - `nu > 0 && na+nd > 0` → `PENDING`
  - `nu == k` → `owners >= 2 ? PENDING : CONTESTED`
  - `na == k` → `CROSS`
  - `nd == k` → `owners >= 2 ? CONTESTED : REFUTED`
  - else → `CONTESTED`
- **Section emit:** each section = `<header>\n` + (acc ? `<acc>\n` : `""`), sections joined so each after the first is preceded by a blank line (`\n## …`). The em-dash `—` is U+2014.

- [ ] **Step 1: Write the failing test** (merge `adjudicate`/types into the existing import)

```ts
import { adjudicate, type AdjudicateInput } from "../src/core/scoreAdjudicate.js";

const verdictsMd = (...lines: string[]) => "## Verdicts\n" + lines.join("\n") + "\n";

describe("adjudicate N=2", () => {
  it("AGREE→Cross-verified (cody first), non-AGREE→PENDING, Not-verified on failed VS", () => {
    const input: AdjudicateInput = {
      parts: [{ commander: "rex", provider: "codex" }, { commander: "cody", provider: "claude" }],
      verify: {
        rex: verdictsMd("1. AGREE [a.ts:1] shared claim", "   rex confirms"),
        cody: verdictsMd("1. DISPUTE [c.ts:1] cody-only thing", "   cody disputes"),
      },
      vs: { rex: "ok", cody: "ok" },
      buckets: { "rex_only_items.txt": "", "cody_only_items.txt": "" },
    };
    const out = adjudicate(input);
    expect(out).toContain("## Cross-verified\n- [a.ts:1] shared claim — REX confirmed: rex confirms\n");
    expect(out).toContain("## Adjudicated\n");
    expect(out).toContain("- PENDING: [c.ts:1] cody-only thing — CODY DISPUTE: cody disputes\n");
    expect(out).toContain("Maestro");        // the comment rebrand
    expect(out).not.toContain("Master Yoda");
    expect(out).toContain("## Contested\n");
    expect(out).toContain("## Not-verified\n");
  });
  it("Not-verified lists the other part's _only items when a VS dispatch failed", () => {
    const input: AdjudicateInput = {
      parts: [{ commander: "rex", provider: "codex" }, { commander: "cody", provider: "claude" }],
      verify: {}, vs: { rex: "timeout", cody: "ok" },
      buckets: { "rex_only_items.txt": "[r.ts:1] rex item\n", "cody_only_items.txt": "[c.ts:1] cody item\n" },
    };
    const out = adjudicate(input);
    // rex VS=timeout → its assigned set (cody_only) is not-verified, annotated REX … timeout
    expect(out).toContain("- [c.ts:1] cody item — REX verify dispatch timeout\n");
  });
});

describe("adjudicate N=3 (_classify)", () => {
  function n3(ownerBucket: string, ownersCsv: string, verifierVerdicts: Record<string, string>): string {
    const parts = [{ commander: "rex", provider: "codex" }, { commander: "cody", provider: "claude" }, { commander: "bly", provider: "agy" }];
    const verify: Record<string, string> = {};
    for (const [cmdr, tag] of Object.entries(verifierVerdicts)) verify[cmdr] = verdictsMd(`1. ${tag} [x.ts:1] the claim`);
    return adjudicate({ parts, verify, vs: {}, buckets: { [ownerBucket]: "[x.ts:1] the claim\n" } });
  }
  it("single-owner, all verifiers AGREE → Cross-verified", () => {
    expect(n3("rex_only_items.txt", "rex", { cody: "AGREE", bly: "AGREE" })).toContain("## Cross-verified\n- [x.ts:1] the claim");
  });
  it("single-owner, all verifiers DISPUTE → Refuted", () => {
    expect(n3("rex_only_items.txt", "rex", { cody: "DISPUTE", bly: "DISPUTE" })).toContain("## Refuted\n- [x.ts:1] the claim");
  });
  it("single-owner, all verifiers UNCERTAIN → Contested", () => {
    expect(n3("rex_only_items.txt", "rex", { cody: "UNCERTAIN", bly: "UNCERTAIN" })).toContain("## Contested\n- [x.ts:1] the claim");
  });
  it("mixed UNCERTAIN + AGREE → PENDING", () => {
    expect(n3("rex_only_items.txt", "rex", { cody: "AGREE", bly: "UNCERTAIN" })).toMatch(/## - PENDING:[\s\S]*- \[x\.ts:1\] the claim/);
  });
  it("consensus.txt lines → Consensus section with [all] srcset", () => {
    const parts = [{ commander: "rex", provider: "codex" }, { commander: "cody", provider: "claude" }, { commander: "bly", provider: "agy" }];
    const out = adjudicate({ parts, verify: {}, vs: {}, buckets: { "consensus.txt": "[a.ts:1] everyone agrees\n" } });
    expect(out).toContain("## Consensus findings (all troopers)\n- [a.ts:1] everyone agrees [rex+cody+bly]\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/score-adjudicate.test.ts`
Expected: FAIL — `adjudicate` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/core/scoreAdjudicate.ts`)

```ts
export interface AdjPart { commander: string; provider: string; }
export interface AdjudicateInput {
  parts: AdjPart[];
  verify: Record<string, string>;  // commander -> verify.md content
  vs: Record<string, string>;      // commander -> VS state (default "skipped")
  buckets: Record<string, string>; // bucket filename -> content (from diffFindings)
}

const nonEmptyLines = (s: string | undefined): string[] => (s ?? "").split("\n").filter((l) => l.length > 0);
function emitSections(secs: { header: string; acc: string[]; comment?: string }[]): string {
  return secs
    .map((s) => s.header + "\n" + (s.comment ? s.comment + "\n" : "") + (s.acc.length ? s.acc.join("\n") + "\n" : ""))
    .join("\n");
}

/** Port of _cw_consult_write_adjudicated_{n2,nge3}. Returns adjudicated-draft.md text. */
export function adjudicate(input: AdjudicateInput): string {
  return input.parts.length === 2 ? adjudicateN2(input) : adjudicateNge3(input);
}

const YODA_PENDING = "<!-- Maestro: read each cited source for every \"PENDING\" line below; rewrite the prefix to CONFIRMED, REFUTED, or move to ## Contested. synthesize refuses to finalize while any PENDING remains. -->";
const YODA_CONTESTED = "<!-- Maestro: move CONTESTED items here from Adjudicated. Items in this section ship in the design-doc as unresolved. -->";

function adjudicateN2(input: AdjudicateInput): string {
  const [p0, p1] = input.parts;
  const c0 = p0.commander, c1 = p1.commander;
  const uc = (s: string): string => s.toUpperCase();
  const vs0 = input.vs[c0] ?? "skipped";
  const vs1 = input.vs[c1] ?? "skipped";
  const v0 = parseVerdicts(input.verify[c0] ?? "");
  const v1 = parseVerdicts(input.verify[c1] ?? "");

  const cross: string[] = [];
  for (const v of v1) if (v.tag === "AGREE") cross.push(`- [${v.cite}] ${v.text} — ${uc(c1)} confirmed: ${v.evidence || v.text}`);
  for (const v of v0) if (v.tag === "AGREE") cross.push(`- [${v.cite}] ${v.text} — ${uc(c0)} confirmed: ${v.evidence || v.text}`);

  const adjudicated: string[] = [];
  for (const v of v1) if (v.tag !== "AGREE") adjudicated.push(`- PENDING: [${v.cite}] ${v.text} — ${uc(c1)} ${v.tag}: ${v.evidence || v.text}`);
  for (const v of v0) if (v.tag !== "AGREE") adjudicated.push(`- PENDING: [${v.cite}] ${v.text} — ${uc(c0)} ${v.tag}: ${v.evidence || v.text}`);

  const notVerified: string[] = [];
  if (vs0 !== "ok" && vs0 !== "skipped") for (const l of nonEmptyLines(input.buckets[`${c1}_only_items.txt`])) notVerified.push(`- ${l} — ${uc(c0)} verify dispatch ${vs0}`);
  if (vs1 !== "ok" && vs1 !== "skipped") for (const l of nonEmptyLines(input.buckets[`${c0}_only_items.txt`])) notVerified.push(`- ${l} — ${uc(c1)} verify dispatch ${vs1}`);

  return emitSections([
    { header: "## Cross-verified", acc: cross },
    { header: "## Adjudicated", acc: adjudicated, comment: YODA_PENDING },
    { header: "## Contested", acc: [], comment: YODA_CONTESTED },
    { header: "## Not-verified", acc: notVerified },
  ]);
}

function classify(na: number, nd: number, nu: number, k: number, owners: number): "CROSS" | "CONTESTED" | "REFUTED" | "PENDING" {
  if (nu > 0 && na + nd > 0) return "PENDING";
  if (nu === k) return owners >= 2 ? "PENDING" : "CONTESTED";
  if (na === k) return "CROSS";
  if (nd === k) return owners >= 2 ? "CONTESTED" : "REFUTED";
  return "CONTESTED";
}

function adjudicateNge3(input: AdjudicateInput): string {
  const commanders = input.parts.map((p) => p.commander);
  const n = commanders.length;
  const verdictMap = new Map<string, string>();
  for (const p of input.parts) for (const v of parseVerdicts(input.verify[p.commander] ?? "")) verdictMap.set(`${p.commander}__${v.cite}`, v.tag);

  const cross: string[] = [], contested: string[] = [], refuted: string[] = [], pending: string[] = [];
  const allCsv = commanders.join("+");
  const consensus: string[] = nonEmptyLines(input.buckets["consensus.txt"]).map((l) => `- ${l} [${allCsv}]`);

  const processBucket = (content: string | undefined, ownersCsv: string): void => {
    const own = ownersCsv.split("+");
    const ownerCount = own.length;
    const verifiers = commanders.filter((c) => !own.includes(c));
    const k = verifiers.length;
    for (const raw of nonEmptyLines(content)) {
      const cite = raw.slice(1, raw.indexOf("]"));
      const text = raw.slice(raw.indexOf("] ") + 2);
      let na = 0, nd = 0, nu = 0;
      const annotations: string[] = [];
      for (const v of verifiers) {
        const vd = verdictMap.get(`${v}__${cite}`) ?? "UNCERTAIN";
        if (vd === "AGREE") na++; else if (vd === "DISPUTE") nd++; else nu++;
        annotations.push(`${v}:${vd}`);
      }
      const srcset = ownerCount === n || k === 0 ? ownersCsv : `${ownersCsv}, ${annotations.join(", ")}`;
      const rendered = `- [${cite}] ${text} [${srcset}]`;
      const verdict = classify(na, nd, nu, k, ownerCount);
      (verdict === "CROSS" ? cross : verdict === "CONTESTED" ? contested : verdict === "REFUTED" ? refuted : pending).push(rendered);
    }
  };

  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) processBucket(input.buckets[`${commanders[i]}+${commanders[j]}_only.txt`], `${commanders[i]}+${commanders[j]}`);
  for (const c of commanders) processBucket(input.buckets[`${c}_only_items.txt`], c);

  return emitSections([
    { header: "## Consensus findings (all troopers)", acc: consensus },
    { header: "## Cross-verified", acc: cross },
    { header: "## Contested", acc: contested },
    { header: "## Refuted", acc: refuted },
    { header: "## - PENDING:", acc: pending, comment: YODA_PENDING },
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/score-adjudicate.test.ts`
Expected: PASS (2 + 6 = 8 tests). Cross-check the `_classify` branches and the n2 ordering (parts[1] before parts[0]) against `lib/consult.sh:517-761`.

- [ ] **Step 5: Commit**

```bash
git add src/core/scoreAdjudicate.ts tests/score-adjudicate.test.ts
git commit -m "feat(score): adjudicate (n2 4-section + nge3 5-tier classifier, byte-faithful)"
```

---

## Final gate (after Task 4)

- [ ] Run `npm run typecheck && npm run lint && npm run test` — all clean/green (the 2 new suites + everything prior + stale-token gate; confirm no `master-yoda`/`cw_` leaked from the ported comments — the comments must say "Maestro"). Do NOT run `npm run build` (no dispatcher change; these modules are wired by Phase C/D).

---

## Self-Review (run by the plan author — recorded here)

**1. Spec coverage:** `parseClaims` (T1), `citationOverlaps` (T1), `diffFindings` N-way Venn (T2), `parseVerdicts` (T3), `adjudicate` n2 + nge3 + `_classify` (T4). All five cited Bash functions covered. Pure (no fs/spawn) — the command layer (Phases C/D) reads files into the input maps and writes `diffFindings.files`/`adjudicate()` output, per the spec's "command writes the files."

**2. Placeholder scan:** No TBD/TODO/"implement later". Complete TS + fixtures per task. The fixtures encode the byte-faithful output formats (bucket-file `\n` trailing, `diff.md` `- ` prefixes + blank-line sections, the `— <UC> confirmed:` / `- PENDING:` lines, the `[srcset]` annotation, the `_classify` truth table).

**3. Type consistency:** `Claim {cite,text}` (T1) consumed by `diffFindings` (T2). `DiffPart`/`DiffFile`/`DiffResult` (T2). `Verdict {tag,cite,text,evidence}` (T3) consumed by `adjudicate` (T4). `AdjudicateInput {parts,verify,vs,buckets}` + `AdjPart` (T4). The bucket filenames `diffFindings` emits (`<name>_only_items.txt`, `consensus.txt`, `<a>+<b>_only.txt`) are exactly the keys `adjudicate` reads from `input.buckets` — the two modules share that filename contract (Phase C/D wires them via the on-disk files of those names).

**Carry-forward:** the em-dash `—` (U+2014) is load-bearing in the n2 `confirmed:`/`PENDING:` lines and the Not-verified lines — the fixtures pin it. The rebrand "Master Yoda"→"Maestro" lives only in the two `<!-- … -->` comment constants; the stale-token gate enforces no `master-yoda` ships.
