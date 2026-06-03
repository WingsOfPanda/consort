// Status-brief renderer for /consort:rehearsal. Faithful to deep-research.sh's
// render_status_brief: a compact chat-shaped update emitted after every
// done/error — header, per-part table, scoreboard top-3, completion line. Pure:
// the verb gathers per-part data + reads files; this renders. The completion
// line uses the modernized field layout (booleans -> yes/no; separate K_so_far /
// K_required, single-spaced) rather than the bash's combined "K_so_far=N/Kr" form.

import type { CompletionSignals } from "./rehearsalComplete.js";

export interface PartBrief {
  instrument: string;
  phase: string;
  currentOrLast: string;
  approach: string;
  metric: string;
}

export interface StatusBriefInput {
  parts: PartBrief[];
  scoreboardMd: string | null; // null = scoreboard.md absent on disk
  completion: CompletionSignals | null; // null = scoreboard.md OR metric.md absent -> can't compute
  latest?: { instrument: string; exp: string };
  /** instrument/exp -> verdict, joined from verification.tsv; omit for back-compat (no annotation). */
  verdicts?: Record<string, string>;
}

interface SbTop { rank: string; exp: string; instrument: string; metric: string; metricName: string; }

/** Parse the plain-rank OK data rows (| <int> | exp-… | …), in existing rank order.
 *  Same row-parse shape as checkCompletion's private parseRows:
 *  c[1]=rank c[2]=exp c[3]=instrument c[4]=metric c[8]=metric_name. */
function parseTopRows(scoreboardMd: string): SbTop[] {
  const out: SbTop[] = [];
  for (const line of scoreboardMd.split("\n")) {
    if (!/^\|\s+\d+\s+\|\s+exp-/.test(line)) continue;
    const c = line.split("|").map((s) => s.trim());
    out.push({ rank: c[1], exp: c[2], instrument: c[3], metric: c[4], metricName: c[8] ?? "" });
  }
  return out;
}

function yn(b: boolean): string {
  return b ? "yes" : "no";
}

/** Render the status brief. Sections: header -> per-part table -> scoreboard
 *  top-3 -> completion line, joined with one blank line, single trailing newline. */
export function buildStatusBrief(input: StatusBriefInput): string {
  const sections: string[] = [];

  // Header.
  if (input.latest) {
    sections.push(`## Experiment status — ${input.latest.exp} (${input.latest.instrument}) just landed`);
  } else {
    sections.push("## Experiment status");
  }

  // Per-part table.
  const table = [
    "| Part | Phase | Current/last | Approach | Metric |",
    "|---|---|---|---|---|",
  ];
  for (const p of input.parts) {
    table.push(`| ${p.instrument} | ${p.phase} | ${p.currentOrLast} | ${p.approach} | ${p.metric} |`);
  }
  sections.push(table.join("\n"));

  // Scoreboard top 3.
  const sb = ["**Scoreboard top 3:**"];
  if (input.scoreboardMd === null) {
    sb.push("_(scoreboard absent)_");
  } else {
    const rows = parseTopRows(input.scoreboardMd).slice(0, 3);
    if (rows.length === 0) {
      sb.push("_(no scored experiments yet)_");
    } else {
      for (const r of rows) {
        const v = input.verdicts?.[`${r.instrument}/${r.exp}`];
        const tag = v ? ` [${v === "mismatch" ? "mismatch!" : v}]` : "";
        sb.push(`${r.rank}. ${r.instrument}/${r.exp} — ${r.metric} — ${r.metricName}${tag}`);
      }
    }
  }
  sections.push(sb.join("\n"));

  // Completion line. When the signals can't be computed (scoreboard.md OR
  // metric.md absent), render the bash's exact absent line rather than a
  // misleading all-`no` row.
  const c = input.completion;
  if (c === null) {
    sections.push("**Completion check:** _(scoreboard or metric absent)_");
  } else {
    sections.push(
      `**Completion check:** floor_met=${yn(c.floorMet)} target_met=${yn(c.targetMet)} ` +
      `K_so_far=${c.kSoFar} K_required=${c.kRequired} plateau=${yn(c.plateau)}`,
    );
  }

  return sections.join("\n\n") + "\n";
}
