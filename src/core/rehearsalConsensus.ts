// Per-field consensus across parts' latest-ok results. Faithful to
// deep-research-consensus.sh. Pure renderer — the caller supplies the
// already-collected latest-ok field maps (the disk walk lives in the CLI).

const FIELDS = ["branch_id", "approach_label", "metric_name", "metric_value", "status", "runtime_s", "notes"] as const;
const NUMERIC = /^-?[0-9.eE+-]+$/;

export interface ConsensusOpts { topic: string; nowIso: string; epsilon?: number; }

/** latestOk: instrument -> field map (its latest ok result.json fields). */
export function buildConsensus(latestOk: Record<string, Record<string, unknown>>, opts: ConsensusOpts): string {
  const epsilon = opts.epsilon ?? 0.01;
  const instruments = Object.keys(latestOk).sort();
  const field = (inst: string, k: string): string => {
    const v = latestOk[inst]?.[k];
    return v === undefined || v === null ? "" : String(v);
  };
  const num = (s: string): number => { const n = parseFloat(s); return Number.isNaN(n) ? 0 : n; };
  const numEq = (a: string, b: string) => Math.abs(num(a) - num(b)) <= epsilon;

  const agreed: string[] = [];
  const contested: string[] = [];
  const missing: string[] = [];

  for (const f of FIELDS) {
    const present: string[] = [];
    const srcs: string[] = [];
    let miss = 0;
    for (const inst of instruments) {
      const v = field(inst, f);
      if (v === "") miss++; else { present.push(v); srcs.push(inst); }
    }
    if (miss === instruments.length) { missing.push(`- ${f}`); continue; }

    let allAgree = true;
    const first = present[0];
    const firstNumeric = NUMERIC.test(first);
    for (const v of present.slice(1)) {
      if (firstNumeric && NUMERIC.test(v)) { if (!numEq(first, v)) { allAgree = false; break; } }
      else if (v !== first) { allAgree = false; break; }
    }
    if (miss > 0) allAgree = false;

    if (allAgree) {
      agreed.push(`| ${f} | ${first} | ${srcs.join(", ")} |`);
    } else {
      let row = `| ${f}`;
      for (const inst of instruments) row += ` | ${field(inst, f) || "—"}`;
      contested.push(`${row} |`);
    }
  }

  const out: string[] = [
    `# Consensus — ${opts.topic}`, "",
    `Generated: ${opts.nowIso}`,
    `Epsilon for metric_value: ${epsilon}`, "",
    "## Agreed", "",
  ];
  if (agreed.length) out.push("| Field | Value | Proposed by |", "|---|---|---|", ...agreed);
  else out.push("_(none)_");
  out.push("", "## Contested", "");
  if (contested.length) {
    let header = "| Field", sep = "|---";
    for (const inst of instruments) { header += ` | ${inst}'s value`; sep += "|---"; }
    out.push(`${header} |`, `${sep}|`, ...contested);
  } else out.push("_(none)_");
  out.push("", "## All-missing", "");
  if (missing.length) out.push(...missing);
  else out.push("_(none)_");
  return out.join("\n") + "\n";
}
