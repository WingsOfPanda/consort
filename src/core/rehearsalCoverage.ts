// Per-family coverage tally for /consort:rehearsal (B1 coverage & diversity guard).
// Pure: no FS, no clock. normalizeFamily is the SINGLE family-canonicalization rule,
// shared with checkCompletion's approach-aware plateau so the tally and the plateau
// bucket experiments identically.

export interface CoverageRow {
  family: string;
  count: number;
  best: string;
  ts: string;
}

export const COVERAGE_TSV_HEADER = "family\tcount\tbest\tts\n";

const NUM = /^[0-9.]+$/;

/** Canonical family key: lowercase -> trim -> collapse internal whitespace -> strip
 *  surrounding punctuation. Blank/punctuation-only -> "". Shared by tallyCoverage and
 *  checkCompletion's plateau. Internal punctuation is preserved (Maestro intent). */
export function normalizeFamily(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

/** One coverage.tsv row (tab-joined + newline). */
export function coverageRow(r: CoverageRow): string {
  return `${r.family}\t${r.count}\t${r.best}\t${r.ts}\n`;
}

/** Per-family aggregate over ok experiments. Direction-aware best (max for maximize/
 *  default, min for minimize). Sorted by count desc then family asc. ts left "" — the
 *  caller (computeScore) stamps it, keeping this pure/time-free for tests. */
export function tallyCoverage(
  rows: { approach: string; metric: string }[],
  direction?: "maximize" | "minimize",
): CoverageRow[] {
  const minimize = direction === "minimize";
  const acc = new Map<string, { count: number; best: number | null }>();
  for (const r of rows) {
    const norm = normalizeFamily(r.approach);
    const fam = norm === "" ? "(unlabeled)" : norm;
    const e = acc.get(fam) ?? { count: 0, best: null };
    e.count += 1;
    if (NUM.test(r.metric)) {
      const v = parseFloat(r.metric);
      e.best = e.best === null ? v : (minimize ? Math.min(e.best, v) : Math.max(e.best, v));
    }
    acc.set(fam, e);
  }
  const out: CoverageRow[] = [];
  for (const [family, e] of acc) {
    out.push({ family, count: e.count, best: e.best === null ? "" : String(e.best), ts: "" });
  }
  out.sort((a, b) => (b.count - a.count) || (a.family < b.family ? -1 : a.family > b.family ? 1 : 0));
  return out;
}
