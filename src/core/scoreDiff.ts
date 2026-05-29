export interface Claim { cite: string; text: string; }

/** Port of consult_parse_claims (lib/consult.sh:43): `N. [cite] text` lines under `## Claims`. */
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

/** Port of consult_citation_overlaps (lib/consult.sh:89). True iff two citations cite the same source. */
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

export interface DiffFile { filename: string; content: string; }
export interface DiffResult { files: DiffFile[]; diffMd: string; }
export interface DiffPart { name: string; findings: string; }

const titlecase = (s: string): string => (s.length ? s[0].toUpperCase() + s.slice(1) : s);
const fileBody = (lines: string[] | undefined): string => (lines && lines.length ? lines.join("\n") + "\n" : "");
function mdSection(header: string, lines: string[] | undefined): string {
  return header + "\n" + (lines && lines.length ? lines.map((l) => `- ${l}`).join("\n") + "\n" : "");
}

/** Port of consult_diff (lib/consult.sh:149). N>=2 parts → bucket files + diff.md. */
export function diffFindings(parts: DiffPart[]): DiffResult {
  const n = parts.length;
  if (n < 2) throw new Error(`diffFindings: need >=2 parts, got ${n}`);
  const names = parts.map((p) => p.name);

  // Flat parallel arrays (one entry per claim across all parts), with per-part windows.
  const owner: number[] = [], cite: string[] = [], text: string[] = [], flag: boolean[] = [];
  const start: number[] = [], end: number[] = [];
  for (let idx = 0; idx < n; idx++) {
    start[idx] = owner.length;
    for (const c of parseClaims(parts[idx].findings)) { owner.push(idx); cite.push(c.cite); text.push(c.text); flag.push(false); }
    end[idx] = owner.length;
  }

  // Membership growth: first-match-wins against later parts' unbucketed claims.
  const buckets = new Map<string, string[]>();
  const add = (key: string, line: string): void => { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key)!.push(line); };
  for (let i = 0; i < n; i++) {
    for (let j = start[i]; j < end[i]; j++) {
      if (flag[j]) continue;
      let memberKeys = names[i];
      const firstCite = cite[j];
      let combined = text[j];
      flag[j] = true;
      for (let k = i + 1; k < n; k++) {
        for (let m = start[k]; m < end[k]; m++) {
          if (flag[m]) continue;
          if (citationOverlaps(firstCite, cite[m])) { memberKeys += `,${names[k]}`; combined += ` | ${text[m]}`; flag[m] = true; break; }
        }
      }
      add(memberKeys, `[${firstCite}] ${combined}`);
    }
  }

  const allKey = names.join(",");
  const files: DiffFile[] = [];
  let diffMd = "";
  if (n === 2) {
    for (const name of names) files.push({ filename: `${name}_only_items.txt`, content: fileBody(buckets.get(name)) });
    diffMd =
      mdSection("## Agreed", buckets.get(allKey)) + "\n" +
      mdSection(`## ${titlecase(names[0])}-only`, buckets.get(names[0])) + "\n" +
      mdSection(`## ${titlecase(names[1])}-only`, buckets.get(names[1]));
  } else {
    files.push({ filename: "consensus.txt", content: fileBody(buckets.get(allKey)) });
    const pairKeys: string[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairKeys.push(`${names[i]},${names[j]}`);
    for (const key of pairKeys) { const [a, b] = key.split(","); files.push({ filename: `${a}+${b}_only.txt`, content: fileBody(buckets.get(key)) }); }
    for (const name of names) files.push({ filename: `${name}_only_items.txt`, content: fileBody(buckets.get(name)) });
    let md = mdSection("## Consensus", buckets.get(allKey));
    for (const key of pairKeys) { const [a, b] = key.split(","); md += "\n" + mdSection(`## ${titlecase(a)}+${titlecase(b)} only`, buckets.get(key)); }
    for (const name of names) md += "\n" + mdSection(`## ${titlecase(name)}-only`, buckets.get(name));
    diffMd = md;
  }
  return { files, diffMd };
}
