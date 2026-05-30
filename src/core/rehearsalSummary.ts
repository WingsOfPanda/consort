// Pure session-summary renderer for /consort:rehearsal. Faithful port of the
// deep-research render_summary routine (deep-research.sh ~712-877): renders
// sections 1/2/4/5 mechanically from disk-gathered data. The finalize verb
// gathers inputs (topic, status rows, scoreboard, completion, events, warnings,
// halt) from disk; this module just renders. No I/O here.
//
// REBRAND: the source status table uses the worker noun; consort uses "| Part |".

import type { CompletionSignals } from "./rehearsalComplete.js";
import type { HaltFlag } from "./rehearsalState.js";

export interface StatusRow { instrument: string; phase: string; current: string; lastTs: string; lastEvent: string; }
export interface EventRow { ts: string; instrument: string; event: string; }
export interface SummaryInput {
  topic: string; updatedIso: string; startedIso: string; budget: string;
  statusRows: StatusRow[];
  scoreboardMd: string | null;
  completion: CompletionSignals | null;
  hardCap: boolean | null;          // null -> omit the Hard cap bullet
  recentEvents: EventRow[];         // verb pre-merges + sorts desc + caps at 10
  warnings: string[];               // verb pre-formats size_warn/audit_warn -> bullet lines
  halt: HaltFlag;
  finalizedIso: string;
}

/** ## Halt block ("" when missing). Structured = fenced body minus format= line; prose = Reason/Finalized. */
export function renderHaltSection(halt: HaltFlag, finalizedIso: string): string {
  if (halt.format === "structured" && halt.fields) {
    const body = Object.entries(halt.fields)
      .filter(([k]) => k !== "format")
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    return `\n## Halt\n\n\`\`\`\n${body}\n\`\`\`\nFinalized: ${finalizedIso}\n`;
  }
  if (halt.format === "prose") {
    return `\n## Halt\n\n- Reason: ${halt.reason ?? ""}\n- Finalized: ${finalizedIso}\n`;
  }
  return "";
}

// Production scoreboard data rows start with `| <rank-int> | exp-...` (plain rank,
// not the ~-prefixed partial rows). Matches deep-research.sh:763 grep -E.
const SB_DATA_RE = /^\|\s*~?\d+\s*\|\s*exp-/;

export function renderSessionSummary(s: SummaryInput): string {
  const out: string[] = [];
  out.push(`# Research session — ${s.topic}`);
  out.push(`Updated: ${s.updatedIso}`);
  out.push(`Started: ${s.startedIso}`);
  out.push(`Time budget: ${s.budget}`, "");

  out.push("## Status", "");
  out.push("| Part | Phase | Current | Last event |");
  out.push("|---|---|---|---|");
  for (const r of s.statusRows) {
    out.push(`| ${r.instrument} | ${r.phase} | ${r.current || "—"} | ${r.lastTs} ${r.lastEvent} |`);
  }
  out.push("");

  out.push("## Scoreboard top 5", "");
  if (s.scoreboardMd) {
    out.push("| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |");
    out.push("|---|---|---|---|---|---|---|---|");
    const data = s.scoreboardMd.split("\n").filter((l) => SB_DATA_RE.test(l)).slice(0, 5);
    for (const l of data) out.push(l);
  } else {
    out.push("_(scoreboard empty)_");
  }
  out.push("");

  out.push("## Completion check", "");
  if (s.completion) {
    out.push(`- Floor: ${s.completion.floorMet ? "MET" : "not met"}`);
    out.push(`- Target: ${s.completion.targetMet ? "MET" : "not met"}`);
    out.push(`- K corroboration: ${s.completion.kSoFar}/${s.completion.kRequired}`);
    out.push(`- Plateau: ${s.completion.plateau ? "YES" : "no"}`);
    if (s.hardCap !== null) out.push(`- Hard cap: ${s.hardCap ? "YES" : "NO"}`);
  } else {
    out.push("_(missing scoreboard or metric)_");
  }
  out.push("");

  out.push("## Recent events", "");
  if (s.recentEvents.length > 0) {
    for (const e of s.recentEvents) out.push(`- ${e.ts} ${e.instrument}/${e.event}`);
  } else {
    out.push("_(no events yet)_");
  }

  if (s.warnings.length > 0) {
    out.push("", "## Warnings", "");
    for (const w of s.warnings) out.push(w);
  }

  return out.join("\n") + "\n" + renderHaltSection(s.halt, s.finalizedIso);
}
