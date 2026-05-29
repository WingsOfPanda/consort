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
