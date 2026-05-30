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
