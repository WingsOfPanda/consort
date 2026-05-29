export interface Claim { cite: string; text: string; }

/** Port of cw_consult_parse_claims (lib/consult.sh:43): `N. [cite] text` lines under `## Claims`. */
export function parseClaims(findings: string): Claim[] {
  const out: Claim[] = [];
  let inClaims = false;
  for (const line of findings.split("\n")) {
    if (/^## Claims/.test(line)) { inClaims = true; continue; }
    if (/^## /.test(line)) { inClaims = false; continue; }
    if (inClaims && /^[0-9]+\. \[[^\]]+\] /.test(line)) {
      const m = line.match(/\[[^\]]+\]/);
      if (!m || m.index === undefined) continue;
      const cite = m[0].slice(1, -1);
      const text = line.slice(m.index + m[0].length).replace(/^[ \t]+/, "");
      out.push({ cite, text });
    }
  }
  return out;
}

/** Port of cw_consult_citation_overlaps (lib/consult.sh:89). True iff two citations cite the same source. */
export function citationOverlaps(aRaw: string, bRaw: string): boolean {
  const a = aRaw.replace(/^\.\//, "");
  const b = bRaw.replace(/^\.\//, "");
  if (a.startsWith("http") || b.startsWith("http")) return a === b;
  if (a.startsWith("runtime:") || b.startsWith("runtime:")) return a === b;
  const aPath = a.split(":")[0];
  const bPath = b.split(":")[0];
  if (aPath !== bPath) return false;
  const aLines = a.includes(":") ? a.slice(a.indexOf(":") + 1) : "";
  const bLines = b.includes(":") ? b.slice(b.indexOf(":") + 1) : "";
  if (aLines === "" || bLines === "") return true; // path-only covers all lines
  const split = (s: string): [string, string] =>
    s.includes("-") ? [s.slice(0, s.indexOf("-")), s.slice(s.indexOf("-") + 1)] : [s, s];
  const [a1s, a2s] = split(aLines);
  const [b1s, b2s] = split(bLines);
  if (![a1s, a2s, b1s, b2s].every((x) => /^[0-9]+$/.test(x))) return false;
  const a1 = parseInt(a1s, 10), a2 = parseInt(a2s, 10), b1 = parseInt(b1s, 10), b2 = parseInt(b2s, 10);
  return a1 <= b2 && b1 <= a2;
}
