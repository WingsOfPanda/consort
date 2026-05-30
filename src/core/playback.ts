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
