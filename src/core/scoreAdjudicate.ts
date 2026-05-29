export interface Verdict { tag: "AGREE" | "DISPUTE" | "UNCERTAIN"; cite: string; text: string; evidence: string; }

/** Port of consult_parse_verdicts (lib/consult.sh:347): `N. TAG [cite] text` + optional indented
 *  evidence continuation lines, under `## Verdicts`. Only AGREE/DISPUTE/UNCERTAIN accepted. */
export function parseVerdicts(verify: string): Verdict[] {
  const out: Verdict[] = [];
  let inV = false;
  let cur: Verdict | null = null;
  const flush = (): void => { if (cur) { out.push(cur); cur = null; } };
  for (const line of verify.split("\n")) {
    if (/^## Verdicts/.test(line)) { inV = true; continue; }
    if (/^## /.test(line)) { flush(); inV = false; continue; }
    if (inV && /^[0-9]+\. (AGREE|DISPUTE|UNCERTAIN) \[[^\]]+\] /.test(line)) {
      flush();
      const rest = line.replace(/^[0-9]+\. /, "");
      const tag = rest.slice(0, rest.indexOf(" ")) as Verdict["tag"];
      const afterTag = rest.replace(/^[A-Z]+ /, "");
      const m = afterTag.match(/\[[^\]]+\]/)!;
      const cite = m[0].slice(1, -1);
      const text = afterTag.slice((m.index ?? 0) + m[0].length).replace(/^[ \t]+/, "");
      cur = { tag, cite, text, evidence: "" };
      continue;
    }
    if (inV && cur && /^[ \t]+/.test(line)) {
      const ev = line.replace(/^[ \t]+/, "");
      cur.evidence = cur.evidence === "" ? ev : `${cur.evidence} ${ev}`;
      continue;
    }
  }
  flush();
  return out;
}

export interface AdjPart { commander: string; provider: string; }
export interface AdjudicateInput {
  parts: AdjPart[];
  verify: Record<string, string>;  // commander -> verify.md content
  vs: Record<string, string>;      // commander -> VS state (default "skipped")
  buckets: Record<string, string>; // bucket filename -> content (from diffFindings)
}

const nonEmptyLines = (s: string | undefined): string[] => (s ?? "").split("\n").filter((l) => l.length > 0);
function emitSections(secs: { header: string; acc: string[]; comment?: string }[]): string {
  return secs
    .map((s) => s.header + "\n" + (s.comment ? s.comment + "\n" : "") + (s.acc.length ? s.acc.join("\n") + "\n" : ""))
    .join("\n");
}

/** Port of _consult_write_adjudicated_{n2,nge3} (lib/consult.sh:517,569). Returns adjudicated-draft.md text. */
export function adjudicate(input: AdjudicateInput): string {
  return input.parts.length === 2 ? adjudicateN2(input) : adjudicateNge3(input);
}

// n2 ## Adjudicated comment (byte-faithful to consult.sh:547, rebranded).
const YODA_PENDING = "<!-- Maestro: read each cited source for every \"PENDING\" line below; rewrite the prefix to CONFIRMED, REFUTED, or move to ## Contested. synthesize refuses to finalize while any PENDING remains. -->";
const YODA_CONTESTED = "<!-- Maestro: move CONTESTED items here from Adjudicated. Items in this section ship in the design-doc as unresolved. -->";
// nge3 ## - PENDING: comment (byte-faithful to consult.sh:753, rebranded) — note it
// lacks the "to CONFIRMED, REFUTED," clause that the n2 comment carries.
const PENDING_NOTE_NGE3 = "<!-- Maestro: read each cited source for every \"PENDING\" line below; rewrite the prefix or move to ## Contested. synthesize refuses to finalize while any PENDING remains. -->";

function adjudicateN2(input: AdjudicateInput): string {
  const [p0, p1] = input.parts;
  const c0 = p0.commander, c1 = p1.commander;
  const uc = (s: string): string => s.toUpperCase();
  const vs0 = input.vs[c0] ?? "skipped";
  const vs1 = input.vs[c1] ?? "skipped";
  const v0 = parseVerdicts(input.verify[c0] ?? "");
  const v1 = parseVerdicts(input.verify[c1] ?? "");

  const cross: string[] = [];
  for (const v of v1) if (v.tag === "AGREE") cross.push(`- [${v.cite}] ${v.text} — ${uc(c1)} confirmed: ${v.evidence || v.text}`);
  for (const v of v0) if (v.tag === "AGREE") cross.push(`- [${v.cite}] ${v.text} — ${uc(c0)} confirmed: ${v.evidence || v.text}`);

  const adjudicated: string[] = [];
  for (const v of v1) if (v.tag !== "AGREE") adjudicated.push(`- PENDING: [${v.cite}] ${v.text} — ${uc(c1)} ${v.tag}: ${v.evidence || v.text}`);
  for (const v of v0) if (v.tag !== "AGREE") adjudicated.push(`- PENDING: [${v.cite}] ${v.text} — ${uc(c0)} ${v.tag}: ${v.evidence || v.text}`);

  const notVerified: string[] = [];
  if (vs0 !== "ok" && vs0 !== "skipped") for (const l of nonEmptyLines(input.buckets[`${c1}_only_items.txt`])) notVerified.push(`- ${l} — ${uc(c0)} verify dispatch ${vs0}`);
  if (vs1 !== "ok" && vs1 !== "skipped") for (const l of nonEmptyLines(input.buckets[`${c0}_only_items.txt`])) notVerified.push(`- ${l} — ${uc(c1)} verify dispatch ${vs1}`);

  return emitSections([
    { header: "## Cross-verified", acc: cross },
    { header: "## Adjudicated", acc: adjudicated, comment: YODA_PENDING },
    { header: "## Contested", acc: [], comment: YODA_CONTESTED },
    { header: "## Not-verified", acc: notVerified },
  ]);
}

function classify(na: number, nd: number, nu: number, k: number, owners: number): "CROSS" | "CONTESTED" | "REFUTED" | "PENDING" {
  if (nu > 0 && na + nd > 0) return "PENDING";
  if (nu === k) return owners >= 2 ? "PENDING" : "CONTESTED";
  if (na === k) return "CROSS";
  if (nd === k) return owners >= 2 ? "CONTESTED" : "REFUTED";
  return "CONTESTED";
}

function adjudicateNge3(input: AdjudicateInput): string {
  const commanders = input.parts.map((p) => p.commander);
  const n = commanders.length;
  const verdictMap = new Map<string, string>();
  for (const p of input.parts) for (const v of parseVerdicts(input.verify[p.commander] ?? "")) verdictMap.set(`${p.commander}__${v.cite}`, v.tag);

  const cross: string[] = [], contested: string[] = [], refuted: string[] = [], pending: string[] = [];
  const allCsv = commanders.join("+");
  const consensus: string[] = nonEmptyLines(input.buckets["consensus.txt"]).map((l) => `- ${l} [${allCsv}]`);

  const processBucket = (content: string | undefined, ownersCsv: string): void => {
    const own = ownersCsv.split("+");
    const ownerCount = own.length;
    const verifiers = commanders.filter((c) => !own.includes(c));
    const k = verifiers.length;
    for (const raw of nonEmptyLines(content)) {
      const cite = raw.slice(1, raw.indexOf("]"));
      const text = raw.slice(raw.indexOf("] ") + 2);
      let na = 0, nd = 0, nu = 0;
      const annotations: string[] = [];
      for (const v of verifiers) {
        const vd = verdictMap.get(`${v}__${cite}`) ?? "UNCERTAIN";
        if (vd === "AGREE") na++; else if (vd === "DISPUTE") nd++; else nu++;
        annotations.push(`${v}:${vd}`);
      }
      const srcset = ownerCount === n || k === 0 ? ownersCsv : `${ownersCsv}, ${annotations.join(", ")}`;
      const rendered = `- [${cite}] ${text} [${srcset}]`;
      const verdict = classify(na, nd, nu, k, ownerCount);
      (verdict === "CROSS" ? cross : verdict === "CONTESTED" ? contested : verdict === "REFUTED" ? refuted : pending).push(rendered);
    }
  };

  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) processBucket(input.buckets[`${commanders[i]}+${commanders[j]}_only.txt`], `${commanders[i]}+${commanders[j]}`);
  for (const c of commanders) processBucket(input.buckets[`${c}_only_items.txt`], c);

  return emitSections([
    { header: "## Consensus findings (all troopers)", acc: consensus },
    { header: "## Cross-verified", acc: cross },
    { header: "## Contested", acc: contested },
    { header: "## Refuted", acc: refuted },
    { header: "## - PENDING:", acc: pending, comment: PENDING_NOTE_NGE3 },
  ]);
}
