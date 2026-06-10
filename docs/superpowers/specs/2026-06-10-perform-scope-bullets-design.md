# perform scope-check: read bullet-list Components + legible empty-scope — design

**Status:** approved (brainstorm 2026-06-10)
**Scope:** `src/core/performScope.ts`, `src/commands/perform.ts` (`scopeCheckWith`),
`commands/perform.md` (Stage 4.1), `tests/perform-scope.test.ts`, version bump.
**Type:** deliberate divergence from the byte-faithful clone-wars bash port
(`deploy_extract_components_paths`) — hence this spec, per the CLAUDE.md phase guard.

## Problem

`perform`'s Phase-A scope-conformance guard extracts the set of in-scope paths from the design
doc's `## Components` section. The extractor (`extractComponentsPaths`, a byte-faithful port of bash
`deploy_extract_components_paths`, deploy-scope:26-55) reads **only markdown table rows**
(`TABLE_ROW = /^[ \t]*\|/`). When a design writes Components as a **bullet list** (or any non-table
form), the extractor returns `[]`.

Downstream, `matchDiffAgainstComponents(diffPaths, [])` flags **every** changed file out-of-scope —
the in-scope loop never matches against an empty comp set. So `OOS_COUNT` becomes the entire diff,
the directive surfaces a wall of false out-of-scope warnings, and the Maestro force-keeps the noise.
The guard looks like it ran but checked nothing.

Two defects compound:
1. **No bullet support** — the most common non-table Components form yields zero paths.
2. **Fails open-then-noisy** — an empty `compPaths` is indistinguishable from "scope declared, N
   genuine OOS." A guard no-op reads as a flood of real findings, which is easy to wave through.

This has recurred a third time (playback 2026-06-10: iris-code `generalize-the-n-lin` perform —
`format.ts` + `format.test.mjs` were genuinely in-scope but flagged because Components was bullets).
See memory `perform-scope-check-tables-only`.

## Goals

- Extract in-scope paths from a **bullet-list** `## Components` section, additively — without
  changing any existing table-row behavior.
- Make the **empty-scope** case legible so a guard no-op is no longer drowned in OOS noise.

## Non-goals

- Changing the table-row extraction, the `matchDiffAgainstComponents` match rules, the section
  bounds, the path heuristic, or any frozen wire token.
- Deduplicating extracted paths (the existing table path does not dedup; `matchDiffAgainstComponents`
  is set-membership, so duplicates are harmless).
- Parsing other declaration forms (numbered lists, prose sentences without path-like tokens).

## Design

### 1. Bullet parsing in `extractComponentsPaths`

The existing per-line loop and the `## Components` section bounds are unchanged. A new branch
handles bullet lines **inside the section**, parallel to the existing table-row branch:

- **Bullet detection:** `BULLET_ROW = /^[ \t]*[-*+][ \t]+/` — a `-`/`*`/`+` marker followed by at
  least one space/tab (so indented/nested bullets are caught). A leading-`|` table row never matches
  (different first char); a `---`/`***` horizontal rule never matches (no space after the first
  marker char).
- **Extraction strategy — ALL path-like tokens per bullet** (chosen for maximum recall; the
  over-match tradeoff is accepted and documented below). For a matched bullet line:
  1. strip the leading marker (`/^[ \t]*[-*+][ \t]+/`),
  2. strip all backticks,
  3. split on whitespace,
  4. for each token, trim surrounding punctuation — leading `([{"'` and trailing `)]}"',.;:!?`
     (note: a trailing `/` is **deliberately preserved** so a directory component like `src/core/`
     keeps the trailing-slash dir-prefix semantics `matchDiffAgainstComponents` relies on),
  5. keep the token iff it matches the **existing** path heuristic: `HAS_SLASH` (`/\//`) OR
     `ENDS_WITH_EXT` (`/\.[a-zA-Z]+$/`).
- **Asymmetry, intentional:** table rows stay **first-cell-only** (structured columns — the file is
  column 1); bullets are unstructured prose, so every token is scanned. This is documented in the
  function header.
- **Order & dedup:** emit in document order (the loop is line-by-line; interleaved table rows and
  bullets come out in source order). No dedup.

A token-extraction helper (e.g. `pathTokensFrom(text: string): string[]`) encapsulates steps 2-5 so
the bullet branch stays small and is unit-testable in isolation.

### 2. Empty-scope signal in `scopeCheckWith` (perform.ts)

After computing `compPaths`, emit one **new, additive** stdout line:

```
SCOPE_DECLARED=<compPaths.length>
```

printed alongside the unchanged `OOS_COUNT=`/`OOS_PATH=` lines (additive — existing parsing of those
two lines is untouched). When `compPaths.length === 0`, also:

```
log.warn("scope conformance: design declared 0 parseable component paths; "
       + "ALL changed files flagged by default (guard no-op)")
```

`OOS_COUNT`/`OOS_PATH`/`scope-out-of-scope.txt`/`components-paths.txt`/`diff-paths.txt` and the rc 0
contract are all unchanged.

### 3. Directive update — `commands/perform.md` Stage 4.1

Add one clause to the scope-conformance step: if `SCOPE_DECLARED=0`, the OOS list is the entire diff
(a guard no-op, not a real finding), so prefer **Amend** (add a real Components table) over
**Force-keep** — do not force-keep a no-op. The existing Amend / Send-back / Force-keep menu is
otherwise unchanged. (Amend already drafts Components **table** rows, which remains the canonical
form.)

## The over-match tradeoff (accepted)

"All path-like tokens" means a bullet such as `- see docs/DESIGN.md for context` contributes
`docs/DESIGN.md` to the in-scope set even though it is a reference, not a component. Effect: a
genuinely out-of-scope edit to such a referenced path would not be flagged (a false negative). This
is accepted because (a) the guard is advisory and Maestro-reviewed, matching the existing risk
posture, and (b) missing a real component path (the current total-failure mode) is the worse
outcome. Documented so a future reader does not "tighten" it without re-reading this decision.

## Faithfulness / divergence

This intentionally diverges from `deploy_extract_components_paths`. The `performScope.ts` header
comment changes from "Byte-faithful port…" to note the extension (port + consort divergence to also
read bullet-list Components; pointer to this spec). The frozen-token gate (`tests/stale-tokens.test.ts`)
is unaffected — no `clone-wars`/`cw_`/`master-yoda`/`MISSION ACCOMPLISHED`/`@cw_` token is involved.
No wire-protocol token, state filename, or `contracts.yaml` key changes.

## Testing

`tests/perform-scope.test.ts` (all 9 existing `extractComponentsPaths` table tests and all
`matchDiffAgainstComponents` tests pass unchanged):

New `extractComponentsPaths` bullet cases:
- backticked bullet: `- \`src/core/foo.ts\` — add helper` → `["src/core/foo.ts"]`
- bare-path bullet: `- src/core/bar.ts: edit` → `["src/core/bar.ts"]`
- mid-line path: `- add a helper to src/core/baz.ts` → `["src/core/baz.ts"]`
- multi-path bullet: `- src/a.ts and src/b.ts` → `["src/a.ts", "src/b.ts"]`
- `*` and `+` markers both recognized
- nested/indented bullet (`    - src/deep.ts`) → extracted
- trailing punctuation trimmed (`- \`src/x.ts\`,` and `- src/y.ts.`) → clean paths
- directory token keeps trailing slash (`- src/core/` → `["src/core/"]`)
- mixed table + bullets in one section → both harvested, document order
- bullet with no path-like token (`- just prose here`) → contributes nothing
- prose-only section (no table, no bullets) → still `[]`
- over-match documented case: `- see docs/DESIGN.md for context` → `["docs/DESIGN.md"]` (asserts the
  accepted behavior so it is intentional, not accidental)
- section still ends at the next H2 (a bullet after `## Architecture` is NOT harvested)

New `scopeCheckWith` coverage (in the perform command test file that already exercises the verb):
- a design with a parseable Components section → stdout contains `SCOPE_DECLARED=<n>` with n>0
- a design with an empty/prose Components section → `SCOPE_DECLARED=0` on stdout AND the WARN emitted,
  with `OOS_COUNT`/rc-0 behavior otherwise intact

## Acceptance

1. A bullet-list `## Components` section yields the same in-scope path set a table would, for the
   common forms (backticked, bare, mid-line, multi-path, nested).
2. All pre-existing table/​match tests pass unchanged.
3. `scope-check` prints `SCOPE_DECLARED=` on every run; prints `=0` + a WARN exactly when no
   component paths were extracted.
4. `commands/perform.md` Stage 4.1 steers the Maestro away from force-keeping a `SCOPE_DECLARED=0`
   no-op.
5. The `performScope.ts` header documents the divergence and points here.
