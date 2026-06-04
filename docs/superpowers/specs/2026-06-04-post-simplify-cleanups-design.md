# Post-simplify cleanups — design

**Date:** 2026-06-04
**Status:** approved (brainstorming)
**Branch:** continue on `chore/simplify-sweep` (one PR for the whole sweep)

## Background

A `/simplify` sweep of the whole codebase (4 cleanup agents) applied three safe
consolidations (`splitNonCommentLines`, `readTsvRows`, solo `readIfExists`; commit
`5397f53`) and **skipped** six marginal/risky items. A follow-up grounding workflow
(4 investigators, one per skipped item) assessed each for a fix design. Based on that
grounding the user selected three to fix and confirmed two scope decisions:

- **Item 1** — `readIfExistsOrNull` consolidation, **non-quarantined sites only**.
- **Item 3c** — `score.drilldownWith` arity decode + tests.
- **Item 3b** — rehearsal `init` strict parsing, with a **central `KvError`→rc-2 catch**.

**Dropped** (grounding confirmed not worth it): Item 2 (forensics `runForensics`/`runFlag`
merge — 4-fold divergence, ~2 LOC, hurts log grep), Item 3a (solo `--provider` guard — load-
bearing, pinned by a test), Item 4 (monitor lazy-decode — immaterial, risks dropping rescan
safety-net events). The 5 quarantined wait-function read sites are also out of scope (see Item 1).

## Goal

Land the three remaining behavior-preserving (Item 1, 3c) and one deliberate-behavior-change
(3b) cleanups, each as its own commit on `chore/simplify-sweep`, all gates green.

---

## Item 1 — `readIfExistsOrNull` consolidation (non-quarantined only)

**What:** route every **byte-identical** inline `existsSync(p) ? readFileSync(p, "utf8") : null`
(where `p` is a pre-bound variable, not a re-evaluated `join(...)`) to the existing helper
`readIfExistsOrNull` (`src/core/fsread.ts:9`). No new helper, no new file.

**Sites to swap (non-quarantined):**
- `src/commands/score.ts` — `waitGateRun` (state-file slurp inside `rows.map`) and `drilldownRun`
  (the `Promise.all` job lambda `fileText`).
- `src/commands/prelude.ts` — `preludeWaitGateRun` (state-file slurp inside `rows.map`).
- `src/commands/rehearsal.ts` — every occurrence of the exact `:null` pre-bound-path variant.
  **The exact set is determined at implementation time by grep** (the grounding's ~13 is an
  estimate, including deps-injection lambdas and body reads); do **not** rely on a fixed count.

**Imports:**
- `score.ts` and `prelude.ts` already import `readIfExists as readIf` — widen each to
  `import { readIfExists as readIf, readIfExistsOrNull } from "../core/fsread.js"`. Keep the
  `readIf` alias for the existing `""`-variant callers; do **not** alias the null helper.
- `rehearsal.ts` does not import `fsread` — add `import { readIfExistsOrNull } from "../core/fsread.js"`.

**Exclusions (leave inline, do NOT touch):**
- The 5 **quarantined** wait-function reads: `score.ts` `researchWaitWith` / `verifyWaitWith`,
  `prelude.ts` `researchWaitWith` / `adversaryWaitWith`, `perform.ts` `turnWaitWith`. These sit
  inside parity-frozen functions; the user chose the non-quarantined-only scope. Consequently
  **`perform.ts` is untouched** (its only site is the quarantined `turnWaitWith` read).
- Any `: ""`-fallback read (maps to `readIfExists`, not `readIfExistsOrNull`) and any read that
  chains `.trim()`/`.split()` — those are a different idiom and out of scope.

**Behavior:** none changed. Each swap must be verified byte-identical (helper body is literally
`existsSync(path) ? readFileSync(path, "utf8") : null`). The implementer verifies each site rather
than blind-replacing.

---

## Item 3c — `score.drilldownWith` arity decode (TDD)

**What:** replace the `n===8/9/10` index-juggling in `drilldownWith` with a validated formula.
The current decode (after the `[7,8,9,10].includes(n)` guard): `n===8 → subproject=rest[7]`;
`n===9 → i2=rest[7], m2=rest[8]`; `n===10 → i2=rest[7], m2=rest[8], subproject=rest[9]`; `n===7 → all empty`.

**Order (TDD — tests first):**
1. Add 2 tests pinning current behavior at the currently-untested arities: **n=8** (subproject-only)
   and **n=10** (i2 + m2 + subproject). Run them green against the current code.
2. Replace the if/else-if block with:
   ```ts
   const subproject = (n === 8 || n === 10) ? rest[n - 1] : "";
   const [i2, m2] = n >= 9 ? [rest[7], rest[8]] : ["", ""];
   ```
   The new tests (plus the existing n=7 / bad-arg tests) stay green — the mapping is provably
   identical across all four arities.

---

## Item 3b — rehearsal `init` strict parsing + central `KvError`→rc-2 catch

**Part A — route `parseInitArgs` through `kvParse`.** `parseInitArgs` (`rehearsal.ts:73`) currently
hand-rolls value extraction (`const val = () => inline ?? args[++i]`), which silently binds
`undefined` when a trailing flag has no value. Replace it with the shared `kvParse` idiom already
used by `parseExperimentSendArgs` in the same file, keeping the leading-strict verbatim-tail topic
capture (`else { topic = args.slice(i).join(" "); break; }`) exactly as-is:

```ts
const eq = a.indexOf("=");
const flag = eq > 0 ? a.slice(0, eq) : a;
if (flag === "--seed-from" || flag === "--time-budget" || flag === "--metric" || flag === "--slug") {
  const r = kvParse(a, args[i + 1]);   // pass the FULL token `a` (kvParse reads inline `=value`)
  i += r.shift - 1;
  if (flag === "--seed-from") seedFrom = r.value;
  else if (flag === "--time-budget") timeBudget = r.value;
  else if (flag === "--metric") metric = r.value;
  else slug = r.value;
} else { badFlag = a; }
```

`kvParse` (`args.ts:79`) throws `KvError` (a missing trailing value) instead of binding `undefined`.
All other edges (inline `--flag=value`, separate-token `--flag value`, a value that itself starts
with `--`) match the current behavior exactly. **`kvParse` is already imported in `rehearsal.ts`.**

**Part B — central catch.** No command catches `KvError` today; an uncaught `KvError` propagates to
`main().catch()` (`consort.ts:58`) and exits **rc 1 with a stack trace**. To make a malformed
invocation a clean rc-2 message **for every command** (score / perform / spawn / preflight /
collect / rehearsal), extract the dispatch into a small testable helper and catch `KvError` there:

```ts
// consort.ts
import { applyArgsFile, KvError } from "./args.js";

export async function dispatch(fn: Handler, args: string[]): Promise<number> {
  try { return await fn(args); }
  catch (e) {
    if (e instanceof KvError) { process.stderr.write(`${e.message}\n`); return e.code; }
    throw e;   // non-KvError still hits main().catch → rc 1 + stack (unchanged)
  }
}
```

`main()` changes its last line from `return fn(resolved);` to `return dispatch(fn, resolved);`.
Only `KvError` is converted (instanceof); every other throw keeps the existing rc-1 path.

**Tests:**
- `parseInitArgs` / `initWith`: `rehearsal init --metric` (trailing flag, no value) throws `KvError`
  (and end-to-end through `dispatch` returns rc 2 with the `--metric requires a value` message).
- `dispatch`: a handler throwing `KvError` → rc 2 + the message on stderr; a handler returning 0 →
  0; a handler throwing a non-`KvError` → re-thrown (not swallowed).

**Behavior change (intended):** a missing trailing flag value on `rehearsal init` goes from
silent-`undefined` to a clean rc-2 error — and every other command's previously-ugly rc-1-stack
`KvError` path also becomes a clean rc 2.

---

## Testing & gates

Per commit and before the PR: `npm run typecheck`, `npm run lint`, `npm run test` (full vitest,
includes `tests/stale-tokens.test.ts`), then `npm run build` and commit the rebuilt
`dist/consort.cjs`. No emojis in shipped output; errors to stderr.

## Branch, PR, release

- Continue on `chore/simplify-sweep`; one commit per item (Item 1, Item 3c, Item 3b), on top of the
  existing `5397f53`. One PR for the whole simplify sweep.
- After merge: bump to **0.1.22** across the 3 manifests + rebuild dist + release PR
  (publish-after-every-change), since Item 3b is a small user-facing behavior change.

## Acceptance criteria

1. **Item 1:** no inline `existsSync(p) ? readFileSync(p,"utf8") : null` remains at the listed
   non-quarantined sites in score.ts / prelude.ts / rehearsal.ts; the 5 quarantined reads and
   perform.ts are untouched; behavior unchanged; all tests green.
2. **Item 3c:** `drilldownWith` uses the formula decode; new n=8 and n=10 tests pass alongside the
   existing ones.
3. **Item 3b:** `parseInitArgs` routes through `kvParse`; `dispatch` converts `KvError` to rc 2
   (message on stderr) and re-throws everything else; the three new tests pass.
4. typecheck + lint + full vitest + stale-tokens green; `dist/consort.cjs` rebuilt and committed.

## Out of scope

Item 2 (forensics merge), Item 3a (solo `--provider` guard), Item 4 (monitor lazy-decode), and the
5 quarantined Item-1 read sites. The `: ""`/`readIfExists` straggler variant is a separate future item.
