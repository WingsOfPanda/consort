# Post-playback hardening — three consort defects from the 2026-06-03/04 forensics

**Status:** approved design (2026-06-04), spec for review.

## Context

A `/consort:playback` review of the 2026-06-03/04 forensics surfaced three consort defects. One of
the three originally flagged (score `research-send` "silent topic truncation") was already fixed —
commit `221afd7` (`docs/superpowers/specs/2026-06-03-args-file-multiline-topic-design.md`) made the
shared `loadArgsFile` read the whole args file instead of only line 1; the forensics flag predated
that fix. The two genuinely-open defects, plus a residual from that same args work that the user
elected to fix in this batch, are designed below.

This is one combined "post-playback hardening" batch: one branch, three commits, one release
(`0.1.20` → `0.1.21`). The three fixes are independent subsystems (a wait-loop, a doc-resolution
guard, the args tokenizer); they ship together for cadence. Fix 3 is the largest and is ordered last
so it can be split into its own PR if desired.

**Frozen-protocol invariant (all three):** no fix renames any frozen wire token (event names
`ready/ack/progress/done/error/question`, `END_OF_INSTRUCTION`, JSON fields `ts/summary/artifacts/
note/message/fatal/task_summary/model/topic`, `contracts.yaml` keys, state filenames,
`CLAUDE_CODE_SESSION_ID`). Every change is additive or behavior-preserving for unrelated paths. The
`tests/stale-tokens.test.ts` gate is untouched.

---

## Fix 1 — `solo turn-wait` fixed-OFFSET re-arm loop

### Problem

`solo turn-wait` reads a `OFFSET=` that `solo turn-send` writes **once**, and on a `question` event it
appends only `TS=question` — it never advances the offset. When the conductor re-arms
`solo turn-wait <topic> 1` on the same round (the documented per-question loop in `commands/solo.md`),
the re-armed wait re-reads the same `turn-1.txt`, the first-match `parseOffset` returns the original
pre-send offset, and `outboxWaitSince` scans the outbox from there — where the already-handled
`question` still sits. It re-surfaces the same question forever. The live workaround was hand-editing
`turn-1.txt` to `OFFSET=<outbox-byte-size>`.

Every sibling wait-loop already solves this. `perform turnWaitWith` reads the **last** offset
(`parseLatestOffset`) and, on a question, appends a fresh `OFFSET=<outboxOffset(...)>` line before
`TS=question`, so a same-round re-arm resumes past the question with no CLI change. `solo` is the only
wait-loop command still using `turn.ts`'s first-match `parseOffset` and still omitting the question
re-arm bump — it was ported without the fix.

### Design

Mirror `perform turnWaitWith` (the structural twin — no CLI/signature change, unlike `wave-wait`'s
`<since>` positional). Two surgical edits in `src/commands/solo.ts` `turnWaitWith`:

1. **Read the latest offset.** Replace `parseOffset(readFileSync(stateFile, "utf8"))` with
   `parseLatestOffset(...)` (import from `../core/scoreTurn.js`, the canonical last-match parser used
   by perform/score/prelude). Leave `turn.ts`'s `parseOffset` (and its existing single-offset test)
   untouched — only `solo` switches.

2. **Bump on a question.** In the `ts === "question"` branch, after writing `question-${round}.txt`,
   append a bumped offset line plus the status:
   `appendFileSync(stateFile, \`OFFSET=${outboxOffset(outboxPath(instrument, provider, topic))}\nTS=question\n\`)`.
   For the non-question branches keep the existing `appendFileSync(stateFile, \`TS=${ts}\n\`)`.
   `outboxOffset`/`outboxPath` are already imported in `solo.ts`. **Omit** perform's `OBJECTIONS=`
   line — solo has no objection routing.

Document the behavior in `commands/solo.md` (the question re-arm section): one line noting the re-arm
now resumes past the handled question, so the manual `OFFSET=` hand-fix is never needed again.

### Components

- `src/commands/solo.ts` — `turnWaitWith`: the read switch + the bumped-OFFSET-on-question append; add
  `parseLatestOffset` to the imports from `../core/scoreTurn.js`.
- `commands/solo.md` — one clarifying line in the question re-arm contract.
- `tests/solo-turn.test.ts` — add a case: a `turn-N.txt` with two `OFFSET=` lines yields the **latest**
  (mirrors perform's `parseLatestOffset` coverage). The existing single-`OFFSET` test stays green.

### Wire safety

Additive to the state-file line contract: a question now appends a **second** `OFFSET=` line to the
same `turn-${round}.txt`, exactly the shape perform/score/prelude already emit and that
`parseLatestOffset` is built to read. The `OFFSET=`/`TS=` token text, `=` separator, decimal format,
and `turn-${round}.txt` filename are byte-identical. No CLI signature change. The bump value is
`outboxOffset = statSync(path).size`, the same source `turn-send` already uses.
`commands/solo.md`'s `grep '^TS=' ... | tail -1` outcome-read still picks the final `TS=` correctly
(extra `OFFSET=` lines don't match `^TS=`).

---

## Fix 2 — `perform` single-repo `Target Sub-Project` header (both seams)

### Problem

When `score` runs from the hub with exactly one validated `--targets <slug>`, it emits a singular
`**Target Sub-Project:** <slug>` header (mode `single-sub`; `src/core/scoreDoc.ts` `assembleDoc`).
`perform`'s `resolveTarget` (`src/core/perform.ts`) always resolves a present+valid header as a child
to descend into: `const sub = join(cwd, slug)` then requires `statSync(sub).isDirectory()`. When
`perform` is run from **inside** the sub-project (`cwd = <hub>/<slug>`), it looks for
`<hub>/<slug>/<slug>`, fails, and throws `target sub-project '<slug>' not found ...` — aborting
`perform init`. The header is not wrong; perform's resolution is context-blind, and a doc already
exported with the singular header reproduces the failure on every run.

### Design (both seams)

**Perform-side — tolerate the self-named header (repairs already-exported docs).** In
`src/core/perform.ts` `resolveTarget`, inside the existing `if (!isDir) { ... }` block, **before** the
throw, add a guard: if `basename(cwd) === slug` (the header names the hub directory we are already
standing in), `return cwd` as single-repo. This only changes the previously-throwing branch; the
`!isDir` gate means it fires solely when the descend would otherwise fail, so a genuine self-named
child `<hub>/<slug>/<slug>` (which makes `isDir` true) still descends normally. It mirrors the
existing `if (!t.present) return cwd` single-repo fast-path: "header names the hub we're in" behaves
like "no header." Add `basename` to the `node:path` import.

**Score-side — stop minting the singular header for a lone target (prevents new ambiguous docs).** In
`src/core/scoreDoc.ts` `assembleDoc`, remove the `single-sub` header-emit branch so a lone-target doc
emits the **header-less `single` shape** (no `**Date:**`, no `**Target Sub-Project:**`). Only `multi`
emits a header block thereafter. Keep the `DocMode` value `"single-sub"` and every other consumer
(`score.ts` `initWith` mode decision, `multi-repo.txt`, `assembleRun`'s section gating) **unchanged** —
only the emitted header text collapses. Update the stale `assembleDoc` header comment.

Together: new lone-target docs carry no header → perform's `!t.present => return cwd` fast-path treats
them as single-repo; the perform-side guard covers the docs already on disk.

Accepted tradeoff (user chose "Both"): a lone-target doc loses its human-readable "targets X"
provenance line. Perform-side alone would suffice for correctness; the score-side change removes the
ambiguous artifact at the source.

Routing consequence (a deliberate clone-wars divergence — do NOT "restore" the singular header in a
parity sweep): because the emitted doc is now header-less, a lone-target doc performed *from the hub*
resolves to the hub (`!t.present => return cwd`) instead of descending into `<hub>/<slug>` the way
clone-wars' `deploy` did. consort's single-target workflow runs `perform` from *inside* the
sub-project (exactly the reported defect — `<hub>/<slug>/<slug>` not found), which the perform-side
guard handles; the from-hub-descend-into-one-child affordance is intentionally dropped for lone
targets. Genuine multi-target docs still emit the plural `**Target Sub-Project(s):**` header and
descend per target, so cross-repo routing is unaffected.

### Components

- `src/core/perform.ts` — `resolveTarget`: the `basename(cwd) === slug` guard inside `!isDir`; add
  `basename` to the `node:path` import.
- `src/core/scoreDoc.ts` — `assembleDoc`: drop the `single-sub` header block; update the header
  comment.
- `tests/perform.test.ts` (resolveTarget cases) — add: header slug == `basename(cwd)` and no child
  dir → returns `cwd`. Keep green: "valid slug + real child dir → descends", "missing dir with
  `basename(cwd) !== slug` → throws", "no header → cwd", "present+invalid → throws".
- `tests/scoreDoc.test.ts` (or the assembleDoc test file) — single-sub now emits no header block
  (header-less single shape); multi still emits the plural header; update any existing single-sub
  header assertion.

### Safety

`**Target Sub-Project:**` is a design-doc **format** token, not a frozen wire token; neither seam
renames it. Perform-side is purely additive (a new guard branch; the emitted header string is
untouched). Score-side emits the already-valid header-less `single` shape (not a new variant). The
singular branch stays in `resolveTarget`/`extractTarget` for genuine cross-repo descent — only the
hub-self exception is added. `detectRouting` keys on the **plural** `(s)` header, so neither change can
mis-route a single-sub doc into the multi path. `auditDoc` emits `target_subproject_when_invalid` only
on present+invalid; a suppressed (absent) header is `present:false`, so audit is unaffected.

---

## Fix 3 — args verbatim-tail for prose topics (byte-exact, clone-wars-faithful)

### Problem

`tokenizeArgsLine` (`src/args.ts`) does shell-like tokenization (whitespace splits; `'` and `"` are
quote delimiters that are stripped). It runs only on the args-file path (`applyArgsFile` when
`argv[0] === "--args-file"`), where each command's directive writes the user's `$ARGUMENTS` verbatim.
For prose topics this mangles the body: `part's design` becomes the single glued token
`parts design` (the unterminated `'` opens a quote that swallows the following space), and `"X"`
becomes `X`. The current `loadArgsFile` also collapses newlines to spaces, flattening multi-paragraph
topics.

A flag-landscape audit confirmed the decisive fact: **no flag value on the args-file path can contain
whitespace or a quote.** Every args-file flag is a slug (`--targets a,b,c`, `--slug`, `--provider`),
an integer (`--max-rounds`, `--timeout`), a KV string (`--metric k=v,k2=v2`), a `none|<N>h|<N>s` budget
(`--time-budget`), a branch name (`--branch`), or a system-composed path (`--seed-from`). The
prose-bearing args (rehearsal `experiment-send` approach-brief/direction, `refine` text) travel via
the **direct shell CLI** — `applyArgsFile` is a passthrough there (`argv[0]` is not `--args-file`), so
`tokenizeArgsLine` never runs on them. clone-wars never tokenized prose: `strike`/`consult`/`meditate`
delivered the body via verbatim `cat` and regex-extracted their one bareword flag; only `deploy`
(structured doc-path + flags) used a tokenizer. consort regressed by routing all five `init` verbs
through one tokenizer.

### Design

Add a **verbatim-tail mode** to the loader, opted into only by the prose `init` verbs. It does **not**
modify `tokenizeArgsLine` — that function (and its existing shell-quote/injection-fence tests) keeps
serving the non-prose path.

`applyArgsFile(argv, opts?)` gains an optional `opts: { valueFlags: Set<string> }`. When `opts` is
provided and `argv[0] === "--args-file"`:

1. Read the whole file as `raw`.
2. **Peel leading flags.** Scan whitespace-delimited tokens from the start (treating space, tab, `\r`,
   `\n` as separators). While the next token starts with `--`: record it; if it is in `valueFlags`
   and has no `=`, record the following whitespace-delimited token as its value. Stop at the first
   token that does not start with `--` — that is where the body begins.
3. **Take the body verbatim.** `body = raw.slice(bodyOffset).trim()` — internal whitespace and
   newlines preserved (multi-paragraph topics keep their structure; apostrophes/quotes intact).
4. Return `[...flagTokens, ...(body ? [body] : []), ...argv.slice(2)]`.

When `opts` is absent, `applyArgsFile` behaves exactly as today (whole-file read + newline-collapse +
`tokenizeArgsLine`).

**Opt-in scope (prose bodies only):**

| Verb | `valueFlags` passed |
|---|---|
| `score init` | `{ --targets }` (`--ensemble` is boolean) |
| `solo init` | `{ --provider }` (`--finish`/`--no-finish` are boolean) |
| `prelude init` | `{}` (no flags — whole body verbatim) |
| `rehearsal init` | `{ --seed-from, --time-budget, --metric, --slug }` |

Each prose parser already does `rest.join(" ")` (or equivalent) over its non-flag tokens; with the body
delivered as one verbatim token, that yields the body unchanged — minimal or no parser edits. The
loader's leading-flag separation makes the topic a single opaque token, so any `--word` **inside** the
prose is not a separate token and is not mistaken for a flag.

**Left unchanged (no `opts`, current `tokenizeArgsLine` path):** `coda`/`roster`/`soundcheck`
(multi-slug positionals need normal tokenization), `perform init`/`branch` (doc-path / `--cwd` body),
and `rehearsal experiment-send`/`refine`/`abort` (structured positionals; prose arrives via direct
CLI). Their existing behavior and tests — including the shell-quote/injection-fence cases on
`tokenizeArgsLine` — stay green.

### Behavior change (documented)

- **Flags become strictly leading** for `score`/`solo` (they were interleaved-flag-tolerant — a
  robustness nicety unused in practice; directives always write flags before the topic). A flag
  appearing after the topic begins is now part of the verbatim body. `prelude` (no flags) and
  `rehearsal init` (already strictly-leading) are unaffected.
- **A topic literally starting with `--`** is read as a flag and mis-peeled — a documented edge
  limitation (clone-wars had the same). Users put a leading word before any `--` in a topic.

### Components

- `src/args.ts` — `applyArgsFile`: the optional `opts` + verbatim-tail peel-and-slice; a small helper
  for the leading-flag scan. `tokenizeArgsLine` and the no-`opts` path unchanged.
- `src/commands/score.ts`, `src/commands/solo.ts`, `src/commands/prelude.ts`,
  `src/commands/rehearsal.ts` — pass each verb's `valueFlags` at its `applyArgsFile(rest, ...)` call.
  Confirm the parser handles the single verbatim body token (expected: no edit beyond the existing
  join).
- `tests/args.test.ts` — verbatim-tail cases: apostrophes/quotes preserved (`part's` → `part's`,
  `"X"` → `"X"`); internal newlines / multi-paragraph body preserved; leading value-flag + boolean
  flag peeled with the body intact; empty body → no body token; a topic with an internal `--word`
  stays in the body. Plus a per-command parse assertion (e.g. `parseScoreArgs` with `--targets a,b`
  and a quoted-prose topic yields the right `targets` and an intact `topicText`). Existing
  `tokenizeArgsLine` and no-`opts` tests unchanged.

### Safety

`tokenizeArgsLine` is not modified, so its injection-fence tests remain valid for the non-prose path.
No frozen token is touched (`inbox.md` filename, `END_OF_INSTRUCTION`, the `topic` JSON field are all
downstream and unchanged). The intentional slug caps (`deriveSlug` `.slice(0,20)`, preflight's
`topic.length` cap) cap the directory key, not the body, and stay. The change restores clone-wars'
lossless verbatim delivery (parity-positive). `$ARGUMENTS` is read via the Write tool and never echoed
into a shell, so dropping shell-quote handling on the prose path reintroduces no injection risk.

---

## Release

- `npm run typecheck`, `npm run test` (incl. `tests/stale-tokens.test.ts`), `npm run lint` all green.
- Rebuild and commit `dist/consort.cjs` (zero-build install); confirm a clean rebuild produces no diff.
- Bump `0.1.20` → `0.1.21` across `package.json`, `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json`.

## Acceptance criteria

1. **Fix 1:** a `solo turn-wait` re-arm after a handled `question` resumes past it (no loop);
   `turn-N.txt` with two `OFFSET=` lines resolves to the latest; the existing single-offset test and
   the `commands/solo.md` outcome-read still pass.
2. **Fix 2:** `resolveTarget` returns `cwd` when the header slug equals `basename(cwd)` and the child
   dir is absent; a genuine `<slug>/<slug>` child still descends; a missing dir with
   `basename(cwd) !== slug` still throws; `assembleDoc` emits no header for a lone target and the
   plural header for multi; audit and routing behavior unchanged.
3. **Fix 3:** a prose topic with apostrophes/quotes and multiple paragraphs survives `score`/`solo`/
   `prelude`/`rehearsal` `init` byte-for-byte (modulo leading/trailing trim); every args-file flag
   still parses; `coda`/`roster`/`soundcheck`/`perform` and the `tokenizeArgsLine` injection tests are
   unchanged.
4. Full gate green; `dist/consort.cjs` rebuilt and committed; version `0.1.21` across the three
   manifests; no frozen-protocol token altered; no banned token introduced.
