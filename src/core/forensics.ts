import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { globalRoot, repoHash } from "./paths.js";
import { atomicWrite } from "./atomic.js";

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
/** outbox.jsonl: JSON.parse each line (skip non-JSON), keep event error|question, label by part. */
export function scrapeOutbox(text: string, part: string): Finding[] {
  const out: Finding[] = [];
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try { const o = JSON.parse(l); if (o.event === "error" || o.event === "question") out.push({ source: "outbox", key: l.trim(), context: `part=${part}` }); }
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
    const now = opts.now ?? new Date();
    const iso = now.toISOString();        // YYYY-MM-DDTHH:MM:SS.sssZ
    const date = iso.slice(0, 10);
    const time = iso.slice(11, 19).replace(/:/g, "-");
    const topicSlug = basename(dirname(opts.artDir));
    let hash = "unknown"; try { hash = repoHash(); } catch { /* keep unknown */ }
    const dir = join(globalRoot(), "forensics", date);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${time}-${opts.command}-${topicSlug}.md`);
    const md = renderArtForensics({ command: opts.command, topicSlug, repoHash: hash, artDir: opts.artDir, invokedAt: iso.replace(/\.\d{3}Z$/, "Z") }, findings);
    atomicWrite(path, md);
    return path;
  } catch { return ""; }
}
