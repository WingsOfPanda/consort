# args-file multi-line topic — stop the loader from silently dropping everything after line 1

**Status:** approved approach (read the whole args file, not just the first line), spec for review (2026-06-03)

## Problem

`/consort:score` delivered a truncated topic to its parts. A `/consort:playback` review of the
2026-06-03 forensics (topic `enhance-iris-codes-e`) surfaced it: the user packed a ~6.5KB topic —
prose followed by three multi-line `ENHANCEMENT` blocks — into `score`, but **both** parts' inboxes
were only ~4.7KB and contained **zero** mentions of the ENHANCEMENT content. One part blocked and
asked for the missing detail; the other recovered it from external memory. The loss was **silent** —
no warning, no error, no non-zero exit.

The Maestro's own reflection framed this as a byte-size limit in `research-send` ("research-send
should not silently truncate long topics, or should warn") and the user's first instinct was "allow
longer files, or chunk." Both are wrong about the mechanism — see Root cause.

## Root cause

An adversarial investigation (root-cause + blast-radius + clone-wars parity, each independently
verified, high confidence) traced the loss to a **single line** in the shared args-file loader:

```ts
// src/args.ts:22-26
function loadArgsFile(path: string): string[] {
  if (!existsSync(path)) return [];
  const first = readFileSync(path, "utf8").split("\n")[0] ?? "";   // <-- reads ONLY line 1
  return tokenizeArgsLine(first);
}
```

Every command directive's Stage 0 mints an args path, then **writes the full `$ARGUMENTS`
verbatim** into it (`commands/score.md:36`: "`content` = `$ARGUMENTS` (verbatim, unquoted)") and
calls `<cmd> init --args-file <path>`. `loadArgsFile` then reads back **only the first line** —
`.split("\n")[0]` discards everything after the first newline. The ~4.7KB that survived was the
topic's first logical line; the dropped tail came after a paragraph break. `research-send` and every
downstream step are faithful and lossless — they simply inherit an already-truncated `topic.txt`.

What it is **not**:

- **Not a byte/character cap.** There is no `slice`/`substring`/length limit anywhere in the chain
  (`tokenizeArgsLine`, `parseScoreArgs`, `atomicWrite`, `inboxWrite`, `composeResearchPrompt`,
  `skillHintAppend` all operate on full strings). The only `slice(0,20)` is `deriveSlug` capping the
  **directory key**, never the topic body.
- **Not a tmux `send-keys` argument-length limit.** The topic is delivered as a **file** the part
  reads: `research-send` writes the prompt to `<instrument>_research_prompt.md`, `send` dereferences
  the `@file` (`readFileSync`, full content) and `inboxWrite` writes it to `inbox.md` via
  `atomicWrite` (plain `writeFileSync`, no cap). The only thing sent through `send-keys` is a fixed
  nudge — `Read <inbox> and execute the task. Reply when done.` — which carries the inbox **path**,
  never the topic bytes. Inbox length is therefore effectively unbounded. **Chunking is not needed.**
- **Not a clone-wars-parity gap.** clone-wars never capped or truncated long topics (its
  `cw_consult_assert_topic` checks charset only) and delivered the full instruction via a file the
  same way. The first-line cut is a **consort-port regression** in the args-file plumbing — the
  args-file indirection was introduced to carry arbitrary `$ARGUMENTS` (newlines, quotes) without
  shell-escaping, but the loader then read only line 1, defeating its own purpose.

## Goal

Make `loadArgsFile` read the **entire** args file so a multi-line `$ARGUMENTS` survives `init`
intact, with no word dropped and no chunking. One fix, in shared code, protecting every command.

## Why one fix covers every command

There is exactly **one** function that reads the args file (`loadArgsFile`), reached through exactly
one resolver (`applyArgsFile`), via two dispatch paths:

- **Top-level** `src/consort.ts:49` — `roster` / `coda` / `soundcheck` place `--args-file` as the
  leading token, so they resolve here.
- **Command-level** `init` handlers — `score` (`src/commands/score.ts:41`), `prelude`
  (`prelude.ts:42`), `solo` (`solo.ts:37`), `perform` (`perform.ts:101`), `rehearsal`
  (`rehearsal.ts:1447`) place `--args-file` after the `init` verb, so they resolve in their own
  dispatch. `rehearsal` additionally routes `experiment-send` (`:1451`), `refine` (`:1456`), and
  `abort` (`:1462`) through the same resolver.

Both paths call the same `applyArgsFile` → same `loadArgsFile`. Fixing it once fixes 100% of
args-file parsing across every command and verb.

**Coverage vs. practical exposure** (all mechanically covered; exposure differs):

| Command | Carries long free-form text? | Was it exposed? |
|---|---|---|
| `score` / `prelude` / `rehearsal` / `solo` | yes — topic / brief / experiment / refinement text | **Yes** — `score` is where it bit; the others share the path and would bite identically |
| `perform` | no — `$ARGUMENTS` is a design-doc **path** (+ `--max-rounds`); the part reads the doc itself | Unlikely, now covered |
| `roster` / `coda` / `soundcheck` | no — short topic slug or nothing | Single-line in practice; covered and safe |

## Design

### The fix (`src/args.ts`)

```ts
function loadArgsFile(path: string): string[] {
  if (!existsSync(path)) return [];
  // The conductor writes $ARGUMENTS verbatim, which may span multiple lines (a
  // multi-paragraph topic). Read the WHOLE file; collapse newlines to spaces so line
  // breaks act as token separators without gluing words across the seam. Reading only
  // the first line silently dropped everything after the first newline.
  const raw = readFileSync(path, "utf8").replace(/\r?\n/g, " ");
  return tokenizeArgsLine(raw);
}
```

`"a\nb"` → `"a b"` → `[a, b]`. Line breaks (LF or CRLF) become single spaces, so a multi-paragraph
topic flows into one token stream with every word preserved; `parseScoreArgs`'s `rest.join(" ")`
reassembles the full topic text. Nothing downstream changes — `topic.txt` → `research-send` →
`inbox.md` are already lossless.

### Hardening — regression test

Add a unit test that a multi-line args file preserves all content end-to-end through `applyArgsFile`
(and, where a topic parser exists, through `parseScoreArgs`). The test must **fail against the old
first-line-only code** and pass against the fix. This is the "can never silently regress" guard: CI
fails if anyone reverts to a first-line read. Test `tokenizeArgsLine` is unchanged; the new coverage
is specifically the multi-line file path.

## Components

- `src/args.ts` — the `loadArgsFile` change above (read whole file + normalize newlines; rename the
  local `first` → `raw`; add the explanatory comment). ~2 lines of logic + comment.
- `tests/args.test.ts` (the existing arg-parsing test file) — the regression test(s): a multi-line
  args file with content after a newline survives `applyArgsFile`; CRLF handled; trailing/blank
  newlines produce no empty tokens; single-line files behave exactly as before.
- `dist/consort.cjs` — rebuilt via `npm run build` and committed (zero-build install).
- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — version bump
  `0.1.9` → `0.1.10` (publish-after-every-change).

## Edge cases

- **CRLF** (`\r\n`) — handled by `/\r?\n/g`.
- **Consecutive newlines** (paragraph break, `\n\n`) — become multiple spaces; `tokenizeArgsLine`
  skips runs of whitespace, so no empty tokens.
- **Trailing newline** (Write tool may append one) — becomes a trailing space; ignored by the
  tokenizer (no trailing empty token).
- **Empty file** — `readFileSync` returns `""`, tokenizer returns `[]` (unchanged behavior).
- **Single-line file** — `replace` is a no-op on a newline-free string; identical to today.
- **`--targets a,b,c` spanning the seam** — flags and values are whitespace-delimited tokens; a
  newline between a flag and its value (unusual, but possible if a conductor splits oddly) now acts
  as a separator just like a space, so `--targets\na,b,c` parses correctly where before it was simply
  lost with the rest of line 2+.

## Error handling

No new error paths. `applyArgsFile` still throws `ArgsFileError` (code 2) on a missing
`--args-file <path>` value; `loadArgsFile` still returns `[]` for a non-existent file; the file is
still `rm`'d after read (`consumeArgsFile`). The fix only widens what a present file yields.

## Out of scope (mention, do not fix)

- **Quote/apostrophe stripping in prose topics.** `tokenizeArgsLine` treats `'` and `"` as shell
  quote delimiters and strips them, so `part's` → `parts` and `"X"` → `X`. This is a **separate,
  pre-existing, lower-impact** issue (a character is altered, not a clause dropped) that did **not**
  cause this incident. Fixing it would require treating the topic body as verbatim prose rather than
  shell tokens (the rejected "Approach B"), changing the shared args contract across all commands.
  Left as a known limitation; recorded here so it is not mistaken for a new regression.
- **A runtime size warning.** Unnecessary — the fix makes the loss *impossible* rather than *warned*;
  the regression test is the durable guard.

## Frozen-protocol / parity safety

- No frozen wire-protocol token is touched: `inbox.md` filename, the `END_OF_INSTRUCTION` sentinel,
  and the `topic` JSON field are all unchanged. The fix is purely in CLI-internal arg plumbing.
- The intentional **slug** caps stay as-is — `deriveSlug` `.slice(0,20)` and `preflight`'s
  `topic.length <= 64` cap the **directory key**, never the topic body, and are out of scope.
- No banned token (`clone-wars` / `cw_` / `master-yoda` / `MISSION ACCOMPLISHED` / `@cw_`) is
  introduced; the stale-token gate is unaffected.
- The change restores clone-wars' lossless-delivery behavior (parity-positive); it does not diverge.

## Acceptance criteria

1. `loadArgsFile` reads the entire args file; a multi-line `$ARGUMENTS` survives `init` with every
   word intact (verified by the regression test, which fails against the old first-line code).
2. CRLF, consecutive/trailing newlines, empty files, and single-line files all behave as specified
   above.
3. Full gate green: `npm run typecheck`, `npm run test` (incl. `tests/stale-tokens.test.ts`),
   `npm run lint`; `dist/consort.cjs` rebuilt and committed; version bumped to `0.1.10` across the
   three manifests.
4. No frozen-protocol token altered; no banned token introduced; no other command's behavior changed
   beyond now-correct multi-line parsing.
