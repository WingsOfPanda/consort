// src/core/multirepo.ts
import { readdirSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { SLUG_REGEX } from "./audit.js";

export interface RepoHit { slug: string; marker: string; }
export interface TargetValidation { ok: RepoHit[]; errors: string[]; }

/** CLAUDE.md (preferred) else AGENTS.md under dir, realpath-resolved; null if neither exists. */
function resolveMarker(dir: string): string | null {
  const marker = existsSync(join(dir, "CLAUDE.md")) ? join(dir, "CLAUDE.md")
    : existsSync(join(dir, "AGENTS.md")) ? join(dir, "AGENTS.md") : null;
  if (!marker) return null;
  try { return join(realpathSync(dir), marker.slice(dir.length + 1)); } catch { return marker; }
}

/** Validate --targets slugs against `cwd`'s first-level sibling dirs (port of consult-init.sh's
 *  --targets validation, widened with marker existence). Each slug must match SLUG_REGEX (rejects
 *  '/', '..'), be a real sibling dir with CLAUDE.md (pref) or AGENTS.md, and be unique. Returns the
 *  resolved RepoHit[] (same marker realpath resolution as detectMultiRepo) + human-readable errors. */
export function validateTargets(cwd: string, slugs: string[]): TargetValidation {
  const ok: RepoHit[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (!SLUG_REGEX.test(slug)) { errors.push(`invalid target slug (must match ${SLUG_REGEX.source}): ${slug}`); continue; }
    if (seen.has(slug)) { errors.push(`duplicate target slug: ${slug}`); continue; }
    seen.add(slug);
    const dir = join(cwd, slug);
    const marker = resolveMarker(dir);
    if (!marker) { errors.push(`target '${slug}' is not a sibling dir with CLAUDE.md/AGENTS.md under ${cwd}`); continue; }
    ok.push({ slug, marker });
  }
  return { ok, errors };
}

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
    const marker = resolveMarker(dir);
    if (!marker) continue;
    if (!corpusLower.includes(slug.toLowerCase())) continue;
    hits.push({ slug, marker });
  }
  return hits;
}
