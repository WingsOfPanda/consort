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
