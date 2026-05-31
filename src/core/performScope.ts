// src/core/performScope.ts
//
// SCOPE-CONFORMANCE guard for `perform` Phase A. Byte-faithful port of the prior bash plugin's
// scope-conformance helpers (deploy-scope): deploy_extract_components_paths -> extractComponentsPaths,
// deploy_match_diff_against_components -> matchDiffAgainstComponents. The Bash helpers read files via
// awk; the TS ports take the already-read strings (file IO is the caller's concern), but the
// extraction algorithm — section bounds, separator-row skip, first-cell parse, header skip, path
// heuristic, and the exact/dir-prefix match rules — is preserved exactly.

const COMPONENTS_HEADER = /^## Components[ \t]*$/;
const OTHER_H2 = /^## [^ ]/;
const ANY_COMPONENTS_PREFIX = /^## Components/;
const TABLE_ROW = /^[ \t]*\|/;
const SEPARATOR_ROW = /^[ \t]*\|([ \t]*[:-]+[ \t]*\|)+[ \t]*$/;
const HEADER_CELL = /^(File|Path|Name|Files?[ \t]+(edited|moved|touched))$/;
const HAS_SLASH = /\//;
const ENDS_WITH_EXT = /\.[a-zA-Z]+$/;

/** Port of deploy_extract_components_paths (deploy-scope:26-55). Locates the `## Components` section
 *  and extracts the first cell of every markdown table row within it (backticks stripped, trimmed),
 *  skipping the separator row, header rows, and any cell that does not look like a path (contains
 *  `/` OR ends with `.ext`). Returns [] when no section / no table / no path-like cell. */
export function extractComponentsPaths(docText: string): string[] {
  const out: string[] = [];
  let inSection = false;
  for (const record of docText.split("\n")) {
    if (COMPONENTS_HEADER.test(record)) { inSection = true; continue; }
    if (OTHER_H2.test(record) && !ANY_COMPONENTS_PREFIX.test(record)) { inSection = false; continue; }
    if (inSection && TABLE_ROW.test(record)) {
      if (SEPARATOR_ROW.test(record)) continue;
      let line = record;
      line = line.replace(/^[ \t]*\|[ \t]*/, "");
      line = line.replace(/[ \t]*\|.*$/, "");
      line = line.replace(/`/g, "");
      line = line.replace(/^[ \t]+/, "");
      line = line.replace(/[ \t]+$/, "");
      if (HEADER_CELL.test(line)) continue;
      if (HAS_SLASH.test(line) || ENDS_WITH_EXT.test(line)) out.push(line);
    }
  }
  return out;
}

/** Port of deploy_match_diff_against_components (deploy-scope:75-110). Returns the subset of
 *  `diffPaths` that are OUT of scope per `compPaths`. In-scope iff some comp path: (1) equals the
 *  diff path; (2) ends with "/" and the diff path starts with it; (3) does NOT end with "/" and the
 *  diff path starts with comp + "/". Both inputs are trimmed and empties dropped. */
export function matchDiffAgainstComponents(diffPaths: string[], compPaths: string[]): string[] {
  const comp: string[] = [];
  for (const raw of compPaths) {
    const line = raw.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
    if (line === "") continue;
    comp.push(line);
  }
  const out: string[] = [];
  for (const raw of diffPaths) {
    const path = raw.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
    if (path === "") continue;
    let inScope = false;
    for (const c of comp) {
      if (path === c) { inScope = true; break; }
      if (c.charAt(c.length - 1) === "/" && path.indexOf(c) === 0) { inScope = true; break; }
      if (c.charAt(c.length - 1) !== "/" && path.indexOf(c + "/") === 0) { inScope = true; break; }
    }
    if (!inScope) out.push(path);
  }
  return out;
}
