// src/core/multirepo.ts
import { readdirSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

export interface RepoHit { slug: string; marker: string; }

/** Port of consult_detect_multi_repo (lib/consult-walk.sh:75-98). Sibling dirs with CLAUDE.md/AGENTS.md whose slug is a
 *  case-insensitive substring of the corpus (= adjudicated.md content). */
export function detectMultiRepo(cwd: string, corpus: string): RepoHit[] {
  const corpusLower = corpus.toLowerCase();
  const hits: RepoHit[] = [];
  let entries: string[];
  try { entries = readdirSync(cwd, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return hits; }
  for (const slug of entries) {
    if (slug.startsWith(".")) continue;
    const dir = join(cwd, slug);
    let marker: string;
    if (existsSync(join(dir, "CLAUDE.md"))) marker = join(dir, "CLAUDE.md");
    else if (existsSync(join(dir, "AGENTS.md"))) marker = join(dir, "AGENTS.md");
    else continue;
    if (!corpusLower.includes(slug.toLowerCase())) continue;
    let abs = marker;
    try { abs = join(realpathSync(dir), marker.slice(dir.length + 1)); } catch { /* keep marker */ }
    hits.push({ slug, marker: abs });
  }
  return hits;
}
