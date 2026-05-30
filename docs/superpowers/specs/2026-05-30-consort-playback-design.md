# consort `playback` — Design (forensics review + cross-window trend)

> **What this is.** The approved design for `playback`, consort's port of the clone-wars
> `review-forensics` command. `playback` is the **meta** command: the other commands
> (`solo`/`score`/`perform`) each write a forensics file at teardown; `playback` surveys those
> files, surfaces the problems, tracks how often each pattern recurs over time, then **files the
> surveyed files away** so the next run only shows new problems. It is a behavioral port with one
> deliberate consort-era addition (the cross-window trend ledger) and a deliberately simpler
> **zero-choice** UX. It wins over `MIGRATION.md` where they differ.

> **Behavioral spec (source of truth).** `clone-wars/commands/review-forensics.md`,
> `clone-wars/bin/review-forensics.sh`, `clone-wars/bin/forensics-mark-reviewed.sh`,
> `clone-wars/lib/forensics.sh`. Preserve *behavior* (the survey → cluster → suggest → file-away
> loop), not *implementation*. The **capture** half is already shipped in consort
> (`src/core/forensics.ts` — `captureArtDir`/`renderArtForensics`/scrapers + each command's
> `forensics` verb); `playback` reuses it untouched and adds only the **review** half.

---

## 1. Summary

`solo`/`score`/`perform` already capture a forensics markdown file at teardown, under
`globalRoot()/forensics/<UTC-date>/<UTC-time>-<command>-<topic>.md`, with YAML frontmatter
(`command`/`topic`/`topic_slug`/`repo_hash`/`art_dir`/`invoked_at`/`n_findings_mechanical`), a
`## Mechanical findings` section (bullets `- **<source>** <key> _(source: <context>)_`), and a
`## Maestro reflection` section the directive appends.

`playback` is the command that **reviews** that pile. You run `/consort:playback` with **no
arguments**; it locates the forensics recorded since you last ran it, clusters them, annotates each
cluster with how many times it has recurred over the life of the project, suggests one concrete next
action per cluster, and then **archives the surveyed files** so they never re-surface. There is
**nothing to choose** at the point of use, and every run only ever shows **new** problems.

Two consort-era differences from clone-wars: (1) a persistent, mechanical **cross-window trend
ledger** (`globalRoot()/forensics/.trends.json`) of per-pattern lifetime recurrence counts, and
(2) the file-away step is **automatic** (clone-wars made it the opt-in `--mark-reviewed` flag). The
trend counts accrue at the archive step, so the lifetime history survives even though the surveyed
files leave the live directory.

---

## 2. Scope & non-goals

### In scope

- `playback survey [--all] [--command <name>] [--since <Nd|Nh>]` — scan the **live** forensics dir
  (everything not already archived), and emit each file as TSV `<path>\t<command>\t<topic>\t
  <n_findings>` plus a `TRENDS` block (top recurring signatures from the ledger). **Read-only.**
- `playback archive <path…>` — the auto-cleanup the directive runs **after** presenting: for each
  surveyed file, **accrue** its findings into the trend ledger, then **move** it to
  `globalRoot()/forensics/.reviewed/<date>/`. Idempotent (a file already under `.reviewed/` is
  skipped — no double-move, no double-accrue).
- `core/playback.ts`: pure, TDD'd helpers — `--since` parsing, frontmatter parsing, mechanical-
  findings parsing, the deterministic trend **signature**, the `.reviewed/` target path, and the
  ledger (`parse`/`accrue`/`render`).
- `commands/playback.md`: the zero-choice directive — `survey` → cluster (conductor judgment) →
  present with trend counts + one suggested action each → `archive`.
- Optional, never-required power-user flags: `--all` (also list already-archived files, read-only —
  no re-accrue, no re-move), `--command <name>` (filter the listing), `--since <Nd|Nh>` (cap the
  listing window). The zero-arg invocation does the whole job without any of them.

### Out of scope (non-goals)

- The **capture** side (`forensics.ts` scrapers / `captureArtDir` / `renderArtForensics` and the
  per-command `forensics` verbs) — already built; `playback` **reuses** it, does not change it.
- Parts / IPC / tmux / DAG / spawn — `playback` is a pure conductor-side filesystem survey. No model
  binaries are involved (it is the only consort command with no parts).
- **Deleting** forensics files — `playback` archives (moves to `.reviewed/`), never deletes, so the
  originals stay recoverable and the trend ledger is rebuildable.
- The LLM **clustering** is not a verb — it is conductor judgment in the directive (mirrors
  clone-wars, where there is no `bin/forensics-cluster.sh`).

---

## 3. Decisions (settled in brainstorming)

| # | Decision | Resolution |
|---|---|---|
| L1 | **Fidelity** | Faithful behavioral port of the survey/cluster/suggest loop **plus** a cross-window trend ledger (user-chosen enhancement). |
| L2 | **Cleanup** | **Auto-archive after surfacing.** Surveyed files move to `.reviewed/<date>/` at the end of every run, so the live dir only ever holds new problems. Always-on (clone-wars' opt-in `--mark-reviewed`, made automatic). |
| L3 | **UX** | **One command, zero choices.** `/consort:playback` (no args) surfaces problems + trend, then files them away. Flags exist but are never required. The two internal verbs (`survey`, `archive`) are invisible to the user. |
| L4 | **Incremental model** | **Each run shows what is new since the last run.** The archive move is the "already surfaced" marker — the live dir holds exactly the un-reviewed forensics. The long-run history lives in the trend ledger's per-signature counts. |
| L5 | **Trend accrual** | **At the archive step**, once per file (a file goes live → `.reviewed/` exactly once). No seen-set needed; robust to an interrupted run (survey-without-archive leaves files live + un-accrued → re-surveyed + archived once next time). |
| L6 | **Archive, not delete** | Surveyed files are **moved** to `.reviewed/`, never deleted — originals recoverable, ledger rebuildable. |
| L7 | **Clustering owner** | **Conductor (directive) clusters** by semantic pattern; the **mechanical ledger counts** by deterministic signature. Kept separate so each is tested in the right way. |

---

## 4. Command surface

`/consort:playback` mints no args file and needs no design doc — it is a survey. The directive calls
two internal subcommands (both invisible to the user); clustering + suggestions are directive work.

| Subcommand | Behavior | rc |
|---|---|---|
| `playback survey [--all] [--command <name>] [--since <Nd\|Nh>]` | **Read-only.** List every `*.md` under `globalRoot()/forensics/` **excluding `.reviewed/`** (the live, un-reviewed set), filtered by the optional `--command`/`--since`, as TSV `<path>\t<command>\t<topic>\t<n_findings>`; then a `TRENDS` block — the top recurring signatures from `.trends.json` (`<signature>\t<count>\t<first_seen>\t<last_seen>`, count-desc). With `--all`, also list files already under `.reviewed/` (still read-only). Writes nothing, moves nothing. | `0` · `2` bad flag |
| `playback archive <path…>` | For each path under the forensics root (skip any already under `.reviewed/`): parse its `## Mechanical findings`, **accrue** each finding's signature into `.trends.json` (`count`++, set `firstSeen` if absent, `lastSeen = today`), atomic-write the ledger, then **move** the file to `.reviewed/<date>/` (preserving the per-date subdir). Idempotent + best-effort: a missing file or failed move is logged and skipped, never fatal. | `0` · `2` no paths |

The directive always runs `playback survey` (zero flags) then, after presenting, `playback archive`
with the surveyed paths. The user types only `/consort:playback`. There is no `enumerate` / `trends`
/ `mark-reviewed` surface — `survey` returns everything the directive needs to read; `archive` does
the accrue-and-file-away.

---

## 5. The survey pipeline (the directive)

`commands/playback.md` mirrors `review-forensics.md`'s loop, minus the flag-juggling, plus the
automatic file-away:

1. Run `node dist/consort.cjs playback survey` (optionally pass through a user-supplied
   `--all`/`--command`/`--since`, but none are required).
2. If it lists **zero** files: print `no new forensics since last playback; consort has been healthy`
   and stop (nothing to archive).
3. Read each surfaced file's `## Mechanical findings` + `## Maestro reflection` sections (a single
   batched `Read`/`cat` with separators).
4. **Cluster** by recurring pattern — group findings whose `source` + meaningful `key`/`context`
   token match (e.g. all `audit_log ISSUE=unresolved_placeholder`; all `outbox` timeout events). Rank
   clusters by count, descending.
5. **Annotate with the trend** — from the `TRENDS` block, attach each cluster's lifetime recurrence
   (`"3 this run · 11 since 2026-04-18"`).
6. **Suggest one action per cluster** (byte-faithful thresholds, adapted to consort):
   - **3+ occurrences across distinct topics** → propose a **feedback memory** (give the memory
     slug) or a **spec topic** under `docs/superpowers/specs/`.
   - **2 occurrences** → "watch list"; propose a memory only if generalizable.
   - **1 occurrence** → call out as a one-off, no action.
7. Surface the ranked summary (`## Forensics review (since last run, N files) / ### Cluster k —
   <pattern> (<this-run> this run · <lifetime> lifetime, across <topics>) / <files> / Suggested
   action: <one step>`).
8. **File away:** `node dist/consort.cjs playback archive <the surveyed paths>` — accrues the trend
   and moves the files to `.reviewed/`. The next run starts clean; only newer forensics will list.

Archiving comes **after** presentation, so an interrupted run never files away problems you did not
see — the files stay live and re-surface next time (and, because accrual is at archive, they are
counted exactly once, next time).

---

## 6. The trend ledger (`globalRoot()/forensics/.trends.json`)

A single JSON file, atomic-written (tmp-in-**same-dir** + rename), shape:

```json
{
  "counts": {
    "audit_log||ISSUE=unresolved_placeholder": { "count": 11, "firstSeen": "2026-04-18", "lastSeen": "2026-05-30" },
    "outbox||event=error reason=timeout": { "count": 4, "firstSeen": "2026-05-12", "lastSeen": "2026-05-29" }
  }
}
```

- **Trend signature** (the `counts` key) is `<source>||<class>`, **deterministic** and computed by
  `findingSignature` with a **per-source extractor** that pulls the meaningful, recurring token out of
  the finding (the consort scraper shapes are fixed — §8) so the count is actionable on its own:
  - `audit_log` (key = an `ISSUE=…` line) → the first `ISSUE=<code>` token —
    e.g. `audit_log||ISSUE=unresolved_placeholder`.
  - `status` (key = `state=error`) → the key verbatim — `status||state=error`.
  - `spawn_results` (key = `rc=<n> reason=<…>`) → `rc=<n> reason=<word>`, the reason lowercased to its
    first whitespace token — e.g. `spawn_results||rc=124 reason=timeout`.
  - `outbox` (key = a JSON event line, `context = part=<name>`) → `event=<event>`, plus
    ` reason=<word>` when the parsed JSON carries a `reason` (`JSON.parse` the key; read
    `event`/`reason`) — e.g. `outbox||event=error reason=timeout`.
  - `session_log` (key = a free-text `[error]`/`log_error` line) → the key with volatile tokens
    normalized out (SHA-like hex `[0-9a-f]{7,40}` → `<sha>`, ISO-8601 timestamps → `<ts>`, absolute
    paths → `<path>`, bare integers → `<n>`), trimmed — a best-effort error **class** (the inherently
    fuzzy case).
  - any other / unknown source → `<source>||` + the same volatile-normalization applied to the key
    (the coarse fallback).
  The extractor is per-source but deterministic and unit-tested case by case, so the **same** problem
  recurring in a different part / run / commit collapses to one signature while the count stays
  specific. The directive's LLM clustering still groups semantically for *presentation*; the ledger is
  the reproducible, now-actionable backstop count.
- **Accrual** (`accrue(ledger, findings, date)`, called by `archive` per file): for each finding,
  `counts[sig].count++`, set `firstSeen` if absent, set `lastSeen = date`. Because `archive` moves the
  file out of the live dir in the same step (and skips files already under `.reviewed/`), each file is
  accrued exactly once — no seen-set required.
- **Corruption tolerance:** a missing/unparseable `.trends.json` is treated as empty (`{counts:{}}`)
  — `playback` never throws on a bad ledger; it rebuilds forward (it cannot recover lost counts, but
  it never blocks the survey or the archive).

---

## 7. State layout

```
<globalRoot>/forensics/
    <UTC-date>/<UTC-time>-<command>-<topic>.md            # written by capture (solo/score/perform) — UNCHANGED
    .reviewed/<UTC-date>/<UTC-time>-<command>-<topic>.md  # NEW — archived after playback surveys it
    .trends.json                                          # NEW — the playback trend ledger (atomic)
```

`.reviewed/` and `.trends.json` live **inside** the forensics root so they travel with the forensics
they summarize; the leading `.` keeps both out of the live `*.md` survey glob. `archive` preserves
the per-date subdir under `.reviewed/`. All paths absolute; atomic write for `.trends.json`; `mkdir
-p` + `rename` for the move. `playback` writes only `.trends.json` and moves files only into
`.reviewed/` — it never deletes.

---

## 8. Reuse map (what exists vs what's new)

**Reuse as-is:**
- `core/forensics.ts` — the capture/render contract `playback` reads back: the frontmatter keys, the
  `## Mechanical findings` bullet format `- **<source>** <key> _(source: <context>)_`, and the
  forensics-root path convention. `playback`'s `parseMechanicalFindings` is the exact inverse of
  `renderArtForensics`'s bullet line.
- `core/paths.ts` — `globalRoot()` (the forensics root parent), `repoHash()`.
- `core/atomic.ts` — `atomicWrite` for `.trends.json`.
- `core/log.ts` — stderr logging.

**New:**
- `core/playback.ts` — `parseSince(spec, now)`, `parseForensicsFrontmatter(text)`,
  `parseMechanicalFindings(text)`, `findingSignature(finding)`, `reviewedTarget(root, path)` (the
  `.reviewed/<date>/` destination for a live forensics path), `parseTrendLedger(text)`,
  `accrue(ledger, findings, date)`, `renderTrendDigest(ledger, topN)`.
- `commands/playback.ts` — the `survey` verb (list live + emit TRENDS) and the `archive` verb
  (accrue + move).
- `commands/playback.md` — the directive (§5).
- `src/consort.ts` — register `playback` in the dispatcher.
- `.claude-plugin` command registration for `/consort:playback`.

---

## 9. Naming & rebrand compliance

| clone-wars | consort |
|---|---|
| command `review-forensics` | `playback` |
| `commands/review-forensics.md`, `bin/review-forensics.sh`, `bin/forensics-mark-reviewed.sh` | `commands/playback.md`, `src/core/playback.ts`, `playback survey` + `playback archive` |
| opt-in `--mark-reviewed` flag | the **automatic** `playback archive` step (always runs at the end) |
| `.reviewed/` archive dir | `.reviewed/` (unchanged convention; now auto-populated) |
| conductor "Master Yoda" / `## Yoda reflection` | "Maestro" / `## Maestro reflection` (already shipped by capture) |
| worker "trooper" (`trooper=` in findings) | "part" (`part=` — already emitted by `forensics.ts` scrapers) |
| "clone-wars has been healthy" | "consort has been healthy" |
| `cw_forensics_*` fn prefix / `~/.clone-wars/forensics/` | dropped / `globalRoot()/forensics/` |

**Frozen — never rename** (the capture contract `playback` parses): the forensics frontmatter keys
(`command`/`topic`/`topic_slug`/`repo_hash`/`art_dir`/`invoked_at`/`n_findings_mechanical`), the
`## Mechanical findings` heading + bullet format, the `## Maestro reflection` heading, and the
`globalRoot()/forensics/<date>/<time>-<command>-<topic>.md` path layout. The
`tests/stale-tokens.test.ts` gate (bans `clone-wars`/`cw_`/`master-yoda`, case-insensitive
`trooper`/`commander`) must stay green across `src`/`commands`/`.claude-plugin` — `playback.md` and
`playback.ts` cite the prior plugin only as `review-forensics.sh` / `forensics.sh` filenames in prose
/ JSDoc, never the banned literals.

---

## 10. Testing strategy

- **Pure core, TDD** (`core/playback.ts`): `parseSince` (Nd/Nh → cutoff; reject other);
  `parseForensicsFrontmatter` (each key; missing keys); `parseMechanicalFindings` (the bullet regex;
  malformed lines skipped); `findingSignature` (per-source extraction, one case each —
  `audit_log`→ISSUE code, `status`→state, `spawn_results`→rc+reason word, `outbox`→event+reason from
  the JSON, `session_log`→volatile-normalized error class, unknown source→coarse fallback);
  `reviewedTarget` (live `<date>/<file>` →
  `.reviewed/<date>/<file>`; a path already under `.reviewed/` is returned unchanged / flagged);
  `parseTrendLedger` (good JSON, empty, **corrupt → empty**); `accrue` (first-seen set, lastSeen
  update, count increment, order-independent); `renderTrendDigest` (top-N sort by count desc).
- **Command** (`commands/playback.ts`) via injected deps + `CONSORT_HOME` temp (`tests/helpers/
  tmpHome.ts`): seed a fake `forensics/<date>/*.md` tree → `survey` lists the live files + TRENDS
  (excludes `.reviewed/`); `archive` accrues `.trends.json` (counts) + moves files to `.reviewed/`;
  the **incremental** behavior (a second `survey` after `archive` lists nothing / only newer files);
  `--all` (also lists archived, read-only, no re-accrue); `--command`/`--since` filtering; the
  idempotent re-archive (already-`.reviewed/` skipped); the zero-new "healthy" path.
- **Live dogfood** (the load-bearing gate): seed `globalRoot()/forensics/` with real forensics files
  (e.g. those the perform/score dogfoods produced, or hand-seeded equivalents); run `/consort:
  playback` twice; assert run 1 surfaces + counts + archives them, run 2 reports "no new forensics",
  `.reviewed/` holds the moved files, and `.trends.json` carries the lifetime counts. Append to
  `docs/superpowers/DOGFOOD.md`.
- **Gates:** `npm run typecheck` (0), `npm run test` (all green incl. new tests + stale-token gate),
  `npm run lint` (0); `dist/consort.cjs` rebuilt + committed.

---

## 11. Acceptance criteria

1. **Zero-choice survey.** `/consort:playback` with no arguments surveys `globalRoot()/forensics/`,
   surfaces the live (un-reviewed) files, clusters them, and suggests one action per cluster — with no
   required flags.
2. **Auto file-away + incremental.** After surfacing, the surveyed files are moved to `.reviewed/`; a
   second `playback` run with no new forensics prints "no new forensics since last playback; consort
   has been healthy"; with new forensics, it surfaces only the new ones.
3. **Cross-window trend.** `.trends.json` accrues per-signature lifetime counts (deterministic
   signature, part/SHA/timestamp-normalized) at the archive step, survives across runs, and the survey
   annotates each cluster with its lifetime recurrence. Re-archiving an already-reviewed file does not
   double-count (idempotent skip).
4. **Archive, never delete.** No forensics file is deleted; surveyed files are moved into
   `.reviewed/<date>/`; only `.trends.json` is written.
5. **Robustness.** A corrupt/missing `.trends.json` is treated as empty and never blocks the survey or
   archive; an interrupted run (survey without archive) re-surfaces the files next time and counts
   them exactly once.
6. **Gates.** `typecheck` 0, all tests green, `lint` 0, stale-token gate green, `dist` rebuilt +
   committed.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Per-source signature extractor brittleness** (esp. `session_log` free-text) | The structured sources (`audit_log`/`status`/`spawn_results`/`outbox`) extract from well-defined scraper fields (§8); `session_log` falls back to volatile-token normalization (best-effort class). Each source's extractor is unit-tested case by case; an unrecognized shape degrades to the coarse `<source>||normalize(key)` fallback, and `findingSignature` never throws. |
| **Forensics volume grows unbounded** | The auto-archive moves surveyed files into `.reviewed/`, so the live dir holds only un-reviewed problems and each survey stays small regardless of total history; the trend counts carry the history compactly. |
| **`.trends.json` corruption** loses history | Treated as empty + rebuilt forward; never throws, never blocks (counts before corruption are lost, acceptable for a best-effort review tool). |
| **Interrupted run** between survey and archive | Files stay live + un-accrued → re-surfaced + archived exactly once next time (accrual is at the archive step, not the survey). No double-count, no lost finding. |
| **Capture-contract drift** (a future change to the forensics bullet/frontmatter format) | The format is listed as **frozen** (§9); `parseMechanicalFindings` is the exact inverse of `renderArtForensics`, and a shared unit test pins both ends. |
| **Stale phase guard** | Refresh `CLAUDE.md`'s "still out of scope" list when `playback` lands (it then leaves only `prelude`/`rehearsal`). |

---

## 13. Implementation phasing

`playback` is the smallest high-level command (two thin verbs + one pure module + one directive, no
parts/IPC/tmux/DAG). It is a **single plan**, built subagent-driven (pure core TDD → the `survey` +
`archive` verbs → the directive), closed with one live dogfood and the `dist` rebuild + phase-guard
refresh — no multi-phase split. The plan is grounded byte-faithfully against `review-forensics.md` /
`forensics.sh` and the existing `core/forensics.ts` capture contract.
