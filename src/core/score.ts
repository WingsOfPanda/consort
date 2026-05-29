// src/core/score.ts
import { join } from "node:path";
import { topicDir } from "./paths.js";
import { kvParse } from "../args.js";
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
