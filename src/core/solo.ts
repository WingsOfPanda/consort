import { join } from "node:path";
import { topicDir } from "./paths.js";

export function soloArtDir(topic: string): string { return join(topicDir(topic), "_solo"); }
export function soloExecDir(topic: string): string { return join(soloArtDir(topic), "execute"); }

/** Lowercase → [a-z0-9-] → collapse dashes → trim → cap 20 → trim trailing dash. "" if no alphanumerics. */
export function deriveSlug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
    .replace(/-+$/, "");
  return s;
}

export interface SoloArgs { topicText: string; provider?: string; finish: boolean; }

export function parseSoloArgs(tokens: string[]): SoloArgs {
  let provider: string | undefined;
  let finish = false;
  const text: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--finish") { finish = true; continue; }
    if (t === "--provider") { provider = tokens[i + 1]; i++; continue; }
    if (t.startsWith("--provider=")) { provider = t.slice("--provider=".length); continue; }
    text.push(t);
  }
  return { topicText: text.join(" ").trim(), provider, finish };
}
