// src/core/score.ts
import { join } from "node:path";
import { topicDir } from "./paths.js";
import { kvParse } from "../args.js";
import type { DocMode } from "./scoreDoc.js";
export { deriveSlug } from "./solo.js"; // identical to consult's slug rule; reused, not duplicated

/** `_score` art dir for a topic. */
export function scoreArtDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  return join(topicDir(topic, opts), "_score");
}
/** Where the per-section drafts live. */
export function scoreDraftDir(topic: string, opts?: { home?: string; cwd?: string }): string {
  return join(scoreArtDir(topic, opts), "design-doc", ".draft");
}

export interface ScoreArgs { topicText: string; ensemble: boolean; targets: string[]; }

/** Pull the `--ensemble` boolean flag (token-exact) and `--targets a,b,c` out of the glued $ARGUMENTS.
 *  `--targets` is only split/trimmed/empty-filtered here; slug validation (regex, dir+marker
 *  existence, dedup) is deferred to the command layer (`score init`). */
export function parseScoreArgs(tokens: string[]): ScoreArgs {
  let ensemble = false;
  let targets: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--ensemble") { ensemble = true; continue; }
    if (t === "--targets" || t.startsWith("--targets=")) {
      const { value, shift } = kvParse(t, tokens[i + 1]);
      targets = value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (shift === 2) i++;
      continue;
    }
    rest.push(t);
  }
  return { topicText: rest.join(" "), ensemble, targets };
}

/** Canonical design-doc path: `_score/design-doc/<YYYY-MM-DD>-<topic>-design.md`. */
export function scoreDocPath(topic: string, dateUtc: string, opts?: { home?: string; cwd?: string }): string {
  return join(scoreArtDir(topic, opts), "design-doc", `${dateUtc}-${topic}-design.md`);
}

export interface RosterRow { provider: string; instrument: string; }

/** roster.txt body: a generated-comment header + one `<provider>\t<instrument>` row per part. */
export function formatRosterFile(rows: RosterRow[], isoStamp: string): string {
  const body = rows.map((r) => `${r.provider}\t${r.instrument}`).join("\n");
  return `# generated ${isoStamp} by /consort:score\n${body}${rows.length ? "\n" : ""}`;
}

/** Parse roster.txt: skip #/blank lines; keep rows with both fields. */
export function parseRosterFile(text: string): RosterRow[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((l) => { const [provider, instrument] = l.split("\t"); return { provider, instrument }; })
    .filter((r) => r.provider && r.instrument) as RosterRow[];
}

/** multi-repo.txt value, whitespace-stripped; anything not single-sub/multi → "single". */
export function parseMultiRepoMode(text: string): DocMode {
  const v = text.replace(/\s/g, "");
  return v === "multi" ? "multi" : v === "single-sub" ? "single-sub" : "single";
}
