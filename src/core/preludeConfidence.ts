// src/core/preludeConfidence.ts — the 5-signal confidence gate (port of directive Step 5.5,
// commands/meditate.md). Pure: draft text + findings texts → booleans. Signal defs in the spec.

export interface Signals { s1: boolean; s2: boolean; s3: boolean; s4: boolean; s5: boolean; allHold: boolean; }

/** Top approach = text of the first `^N. ` item under `## Approaches`, minus the `N. ` prefix,
 *  trailing space, and any ` — …` tail. "" if none. */
export function topApproach(draft: string): string {
  let inApproaches = false;
  for (const line of draft.split("\n")) {
    if (/^## Approaches/.test(line)) { inApproaches = true; continue; }
    if (/^## /.test(line)) { inApproaches = false; continue; }
    if (inApproaches) {
      const m = line.match(/^[0-9]+\.\s+(.+)$/);
      if (m) return m[1].replace(/\s+$/, "").replace(/\s+—.*$/, "");
    }
  }
  return "";
}

/** Citation tokens in the draft: file-ish `a/b.ext[:NN]` or a URL. Unique, order-preserving. */
export function draftCitations(draft: string): string[] {
  const re = /[A-Za-z_./-]+\.[a-z]+(?::[0-9]+)?|https?:\/\/[^ )"\\]+/g;
  const seen = new Set<string>();
  for (const m of draft.matchAll(re)) seen.add(m[0]);
  return [...seen];
}

/** Count of "bad" matrix rows: within `## Tradeoff matrix`, a row whose 3rd (Reason) cell's first
 *  non-space char is neither `/` nor `:`. Faithful to grep -cE '^\| [^|]+\| [^|]+\| [^/:][^|]*\|$'. */
export function matrixBadRows(draft: string): number {
  let inMatrix = false, bad = 0;
  for (const line of draft.split("\n")) {
    if (/^## Tradeoff matrix/.test(line)) { inMatrix = true; continue; }
    if (/^## /.test(line)) { inMatrix = false; continue; }
    if (inMatrix && /^\| [^|]+\| [^|]+\| [^/:][^|]*\|$/.test(line)) bad++;
  }
  return bad;
}

const UNCERTAIN = /uncertain|unclear|depends on|could not determine|not sure|gap in evidence/i;

export function computeSignals(draft: string, findings: string[]): Signals {
  const n = findings.length;
  // S1: top-approach convergence — >= N-1 findings mention it (case-insensitive literal).
  const top = topApproach(draft);
  const hits = top ? findings.filter((f) => f.toLowerCase().includes(top.toLowerCase())).length : 0;
  // DELIBERATE deviation from the bash: an empty top-approach yields S1=false here. The bash does
  // `grep -qiF "$TOP_APPROACH"` with an empty pattern, which matches every findings file (HITS=N) and
  // spuriously sets S1=true. An empty approach is not "convergence", so false is the correct (and
  // fail-safe: runs the adversary) reading. Do NOT "restore fidelity" by dropping the `top !== ""` guard.
  const s1 = top !== "" && hits >= n - 1;
  // S2: every draft citation appears in >= 2 findings.
  let solo = 0;
  for (const cite of draftCitations(draft)) {
    const citers = findings.filter((f) => f.includes(cite)).length;
    if (citers < 2) solo++;
  }
  const s2 = solo === 0;
  // S3: no CONTESTED markers (case-insensitive).
  const s3 = !/CONTESTED/i.test(draft);
  // S4: every matrix Reason cell has a path/URL/paper anchor.
  const s4 = matrixBadRows(draft) === 0;
  // S5: >= 1 finding acknowledges uncertainty.
  const s5 = findings.some((f) => UNCERTAIN.test(f));
  return { s1, s2, s3, s4, s5, allHold: s1 && s2 && s3 && s4 && s5 };
}

export type Decision = "not-offered" | "skip" | "continue";

/** The adversary-skip.txt body (atomic-written by the verb). */
export function renderSkipRecord(input: { signals: Signals; decision: Decision; now: string }): string {
  const s = input.signals;
  return (
    `timestamp: ${input.now}\n` +
    `signals_passed: S1=${s.s1} S2=${s.s2} S3=${s.s3} S4=${s.s4} S5=${s.s5}\n` +
    `user_decision: ${input.decision}\n`
  );
}
