import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { globalRoot, repoHash, partDir } from "./paths.js";
import { atomicWrite } from "./atomic.js";
import { log } from "./log.js";

export type FailureReason = "timeout" | "error_event";
export const SCROLLBACK_LINES = 50;
export const NO_EVENT_SENTINEL = "no error event before timeout";
export const FAILURE_FILENAME = "failure-reason.txt";

export interface CaptureFailureInput {
  instrument: string; model: string; topic: string; paneId: string;
  reason: FailureReason; eventLine?: string; readyTimeout?: string | number;
}
export type CaptureFailureResult = { ok: true; path: string } | { ok: false; code: 1 | 2 };

export interface ForensicsDeps {
  partDir(i: string, m: string, t: string): string;
  capturePane(paneId: string, lines: number): Promise<string>;
  atomicWriteSync(dest: string, content: string): void;
  isWritableDir(dir: string): boolean;
  now?: () => string;
}

export function renderFailureReport(f: {
  timestamp: string; instrument: string; model: string; topic: string;
  paneId: string; reason: FailureReason; readyTimeout: string; scrollback: string; eventLine?: string;
}): string {
  const meta =
    `timestamp:     ${f.timestamp}\n` +
    `instrument:    ${f.instrument}\n` +
    `model:         ${f.model}\n` +
    `topic:         ${f.topic}\n` +
    `pane_id:       ${f.paneId}\n` +
    `fail_reason:   ${f.reason}\n` +
    `ready_timeout: ${f.readyTimeout}\n`;
  const evt = f.reason === "error_event" && f.eventLine ? f.eventLine : NO_EVENT_SENTINEL;
  return `# Spawn bootstrap failure\n${meta}\n` +
    `## Pane scrollback (last 50 lines, captured BEFORE pane kill)\n${f.scrollback}\n\n` +
    `## Event context\n${evt}\n`;
}

export async function captureFailure(input: CaptureFailureInput, deps: ForensicsDeps): Promise<CaptureFailureResult> {
  if (!input.instrument || !input.model || !input.topic) return { ok: false, code: 1 };
  if (input.reason !== "timeout" && input.reason !== "error_event") return { ok: false, code: 2 };
  const dir = deps.partDir(input.instrument, input.model, input.topic);
  if (!deps.isWritableDir(dir)) return { ok: false, code: 1 };
  const scrollback = await deps.capturePane(input.paneId, SCROLLBACK_LINES).catch(() => "");
  const dest = `${dir}/${FAILURE_FILENAME}`;
  const doc = renderFailureReport({
    timestamp: (deps.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z")))(),
    instrument: input.instrument, model: input.model, topic: input.topic,
    paneId: input.paneId, reason: input.reason,
    readyTimeout: input.readyTimeout == null ? "unknown" : String(input.readyTimeout),
    scrollback, eventLine: input.eventLine,
  });
  deps.atomicWriteSync(dest, doc);
  return { ok: true, path: dest };
}

export interface Finding { source: string; key: string; context: string; }

/** audit.log: each `^ISSUE=` line. */
export function scrapeAuditLog(text: string): Finding[] {
  return text.split("\n").filter((l) => /^ISSUE=/.test(l)).map((l) => ({ source: "audit_log", key: l, context: "audit.log" }));
}
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
/** status.json: state==='error'. */
export function scrapeStatus(text: string, part: string): Finding[] {
  try { if (JSON.parse(text).state === "error") return [{ source: "status", key: "state=error", context: `part=${part}` }]; } catch { /* */ }
  return [];
}
/** spawn-results.tsv: rows with rc != 0 (skip blank/#). */
export function scrapeSpawnResults(text: string): Finding[] {
  const out: Finding[] = [];
  for (const l of text.split("\n")) {
    if (!l.trim() || l.startsWith("#")) continue;
    const [inst, , rc, reason] = l.split("\t");
    if (inst && rc && rc !== "0") out.push({ source: "spawn_results", key: `rc=${rc} reason=${reason ?? ""}`.trim(), context: `part=${inst}` });
  }
  return out;
}
/** dispatch.log / session-summary.md: lines with [error] or log_error. */
export function scrapeLogs(text: string, basename: string): Finding[] {
  return text.split("\n").filter((l) => l.includes("[error]") || l.includes("log_error")).map((l) => ({ source: "session_log", key: l.trim(), context: basename }));
}

/** Best-effort walk of an _score art dir + its sibling part dirs → deduped Finding[]. Each read is
 *  individually guarded; any failure contributes nothing (never throws). Outbox/status part label =
 *  the part dir's basename. */
export function scrapeArtDir(artDir: string): Finding[] {
  const out: Finding[] = [];
  const read = (p: string): string | null => { try { return readFileSync(p, "utf8"); } catch { return null; } };
  const a = read(join(artDir, "design-doc", "audit.log")); if (a !== null) out.push(...scrapeAuditLog(a));
  const sr = read(join(artDir, "spawn-results.tsv")); if (sr !== null) out.push(...scrapeSpawnResults(sr));
  try { for (const f of readdirSync(artDir)) { if (f.endsWith(".log") || f === "session-summary.md") { const t = read(join(artDir, f)); if (t !== null) out.push(...scrapeLogs(t, f)); } } } catch { /* */ }
  // sibling part dirs live under the TOPIC dir (parent of _score): <topic>/<inst>-<model>/
  const topicDir = dirname(artDir);
  try {
    for (const d of readdirSync(topicDir, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith("_") || d.name.startsWith(".")) continue;
      const ob = read(join(topicDir, d.name, "outbox.jsonl")); if (ob !== null) out.push(...scrapeOutbox(ob, d.name));
      const st = read(join(topicDir, d.name, "status.json")); if (st !== null) out.push(...scrapeStatus(st, d.name));
    }
  } catch { /* */ }
  const seen = new Set<string>();
  return out.filter((f) => { const k = `${f.source}|${f.key}|${f.context}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export interface ForensicsMeta { command: string; topicSlug: string; repoHash: string; artDir: string; invokedAt: string; }

/** Common playback-feed write shared by all three feed writers. Splits the single `now` instant into
 *  the UTC `<date>` directory + `<time>` filename segment (so filename + frontmatter share one
 *  timestamp), resolves repoHash, ensures globalRoot()/forensics/<date>/, then renders + atomic-writes.
 *  `fileNameFor(time)` builds the leaf basename from the HH-MM-SS segment; `meta` carries the
 *  per-caller command/topicSlug/artDir. Returns the written path. */
function writeForensicsFeed(opts: {
  now: Date; fileNameFor: (time: string) => string;
  command: string; topicSlug: string; artDir: string; findings: Finding[];
}): string {
  const iso = opts.now.toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19).replace(/:/g, "-");
  let hash = "unknown"; try { hash = repoHash(); } catch { /* keep unknown */ }
  const dir = join(globalRoot(), "forensics", date);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, opts.fileNameFor(time));
  const md = renderArtForensics(
    { command: opts.command, topicSlug: opts.topicSlug, repoHash: hash, artDir: opts.artDir, invokedAt: iso.replace(/\.\d{3}Z$/, "Z") },
    opts.findings,
  );
  atomicWrite(path, md);
  return path;
}

/** YAML frontmatter + `## Mechanical findings` bullets. */
export function renderArtForensics(meta: ForensicsMeta, findings: Finding[]): string {
  const fm = [
    "---", `command: ${meta.command}`, `topic: ${meta.topicSlug}`, `topic_slug: ${meta.topicSlug}`,
    `repo_hash: ${meta.repoHash}`, `art_dir: ${meta.artDir}`, `invoked_at: ${meta.invokedAt}`,
    `n_findings_mechanical: ${findings.length}`, "---", "",
  ].join("\n");
  const body = "## Mechanical findings\n\n" + findings.map((f) => `- **${f.source}** ${f.key} _(source: ${f.context})_`).join("\n") + "\n";
  return fm + body;
}

/** Best-effort forensics capture for an art dir. Returns the written path, or "" on zero findings or
 *  ANY failure (writes nothing). Never throws — guards the entire body. Path lives under
 *  globalRoot()/forensics/<UTC-date>/<UTC-time>-<command>-<topicSlug>.md, OUTSIDE the per-project
 *  state tree so it survives teardown + archive. */
export function captureArtDir(opts: { artDir: string; command: string; now?: Date }): string {
  try {
    const findings = scrapeArtDir(opts.artDir);
    if (findings.length === 0) return "";
    const topicSlug = basename(dirname(opts.artDir));
    return writeForensicsFeed({
      now: opts.now ?? new Date(),
      fileNameFor: (time) => `${time}-${opts.command}-${topicSlug}.md`,
      command: opts.command, topicSlug, artDir: opts.artDir, findings,
    });
  } catch { return ""; }
}

/** Shared body for each command's `forensics` wind-down verb: usage-guard the topic, capture, report.
 *  Best-effort — rc 0 unless the topic arg is missing (rc 2). Feeds /consort:playback. */
export function runForensics(command: string, artDirFor: (topic: string) => string, topic: string | undefined): number {
  if (!topic) { log.error(`usage: ${command} forensics <topic>`); return 2; }
  const path = captureArtDir({ artDir: artDirFor(topic), command });
  if (path) { log.ok(`${command} forensics: captured ${path}`); process.stdout.write(path + "\n"); }
  else log.info(`${command} forensics: no mechanical findings (no file written)`);
  return 0;
}

/** Pure mapping of a bootstrap-wait outcome to captureSpawnFailure's reason/detail. ev=null means the
 *  ready-timeout elapsed with no error event; a truthy ev is the error event that arrived instead. */
export function bootstrapFailureArgs(
  ev: { event: string; [k: string]: unknown } | null,
  failureReportPath?: string,
): { reason: string; detail: string; failureReportPath?: string } {
  return ev
    ? { reason: "error_event", detail: JSON.stringify(ev), failureReportPath }
    : { reason: "timeout", detail: NO_EVENT_SENTINEL, failureReportPath };
}

/** Approach A: write a spawn/bootstrap-failure finding straight to the playback feed
 *  (globalRoot()/forensics/<date>/<time>-spawn-<topic>.md, command:spawn), reusing renderArtForensics
 *  so /consort:playback consumes it unchanged. Teardown-independent — works before the part dir exists
 *  and when teardown never runs. Best-effort: returns the written path, or "" on zero-effect / any
 *  error. Never throws. */
export function captureSpawnFailure(opts: {
  instrument: string; model: string; topic: string;
  reason: string; detail: string; failureReportPath?: string; now?: Date;
}): string {
  try {
    const ctx = `part=${opts.instrument}-${opts.model}`;
    const findings: Finding[] = [
      { source: "spawn_failure", key: `reason=${opts.reason} ${opts.detail}`.replace(/\s+/g, " ").trim(), context: ctx },
    ];
    if (opts.failureReportPath) findings.push({ source: "spawn_failure", key: `failure_report=${opts.failureReportPath}`, context: ctx });
    return writeForensicsFeed({
      now: opts.now ?? new Date(),
      fileNameFor: (time) => `${time}-spawn-${opts.topic}.md`,
      command: "spawn", topicSlug: opts.topic, artDir: partDir(opts.instrument, opts.model, opts.topic), findings,
    });
  } catch { return ""; }
}

/** Record a Maestro suspicion straight to the playback feed
 *  (globalRoot()/forensics/<date>/<time>-<command>-flag-<topic>.md, source=maestro_flag), reusing
 *  renderArtForensics so /consort:playback consumes it unchanged. Teardown-independent (lands even on
 *  abort/handoff). Best-effort: returns the written path, or "" on empty note / any error. Never throws. */
export function recordMaestroFlag(opts: { command: string; topic: string; note: string; now?: Date }): string {
  try {
    const note = opts.note.trim();
    if (!note) return "";
    const finding: Finding = { source: "maestro_flag", key: note, context: `from=maestro command=${opts.command}` };
    return writeForensicsFeed({
      now: opts.now ?? new Date(),
      fileNameFor: (time) => `${time}-${opts.command}-flag-${opts.topic}.md`,
      command: opts.command, topicSlug: opts.topic, artDir: "(maestro-flag)", findings: [finding],
    });
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
