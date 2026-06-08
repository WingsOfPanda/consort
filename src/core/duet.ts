// src/core/duet.ts — pure helpers for /consort:duet (collaborative cross-repo session).
import { join } from "node:path";
import { topicDir } from "./paths.js";

export { deriveSlug } from "./solo.js"; // one slug algorithm across commands

export interface DuetArgs {
  repo?: string;       // repo B absolute path (the --repo value flag)
  taskText: string;    // the opening task (verbatim tail)
  provider?: string;
  inPlace: boolean;    // --in-place: edit repo B's current branch, no isolation
}

/** Mirror of parseSoloArgs, with --repo (value flag) and --in-place (boolean) added.
 *  --repo / --provider consume the next token only if present and not another flag (also the =form). */
export function parseDuetArgs(tokens: string[]): DuetArgs {
  let repo: string | undefined;
  let provider: string | undefined;
  let inPlace = false;
  const text: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--in-place") { inPlace = true; continue; }
    if (t === "--repo") { const v = tokens[i + 1]; if (v && !v.startsWith("--")) { repo = v; i++; } continue; }
    if (t.startsWith("--repo=")) { repo = t.slice("--repo=".length); continue; }
    if (t === "--provider") { const v = tokens[i + 1]; if (v && !v.startsWith("--")) { provider = v; i++; } continue; }
    if (t.startsWith("--provider=")) { provider = t.slice("--provider=".length); continue; }
    text.push(t);
  }
  return { repo, taskText: text.join(" ").trim(), provider, inPlace };
}

export function duetArtDir(topic: string): string { return join(topicDir(topic), "_duet"); }
export function duetExecDir(topic: string): string { return join(duetArtDir(topic), "execute"); }
