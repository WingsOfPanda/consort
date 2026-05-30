// tests/rehearsal-summary.test.ts — pure render_summary port for /consort:rehearsal.
// Faithful to cw_deep_research_render_summary (clone-wars deep-research.sh ~712-877).
import { describe, it, expect } from "vitest";
import {
  renderHaltSection,
  renderSessionSummary,
  type SummaryInput,
  type StatusRow,
  type EventRow,
} from "../src/core/rehearsalSummary.js";
import type { CompletionSignals } from "../src/core/rehearsalComplete.js";
import type { HaltFlag } from "../src/core/rehearsalState.js";

const FIN = "2026-05-30T12:00:00Z";

function baseInput(over: Partial<SummaryInput> = {}): SummaryInput {
  const completion: CompletionSignals = {
    floorMet: true, targetMet: false, kSoFar: 1, kRequired: 3, plateau: false,
  };
  const statusRows: StatusRow[] = [
    { instrument: "oboe", phase: "running", current: "exp-002", lastTs: "2026-05-30T11:00:00Z", lastEvent: "progress" },
  ];
  const recentEvents: EventRow[] = [
    { ts: "2026-05-30T11:00:00Z", instrument: "oboe", event: "progress" },
  ];
  const halt: HaltFlag = { format: "missing" };
  return {
    topic: "add-oauth",
    updatedIso: "2026-05-30T11:30:00Z",
    startedIso: "2026-05-30T09:00:00Z",
    budget: "none",
    statusRows,
    scoreboardMd: null,
    completion,
    hardCap: null,
    recentEvents,
    warnings: [],
    halt,
    finalizedIso: FIN,
    ...over,
  };
}

describe("renderHaltSection", () => {
  it("structured: strips format= line, fences the rest, appends Finalized", () => {
    const halt: HaltFlag = {
      format: "structured",
      fields: { halted_by: "maestro", halted_at: "t", reason: "converged", format: "structured" },
    };
    expect(renderHaltSection(halt, FIN)).toBe(
      "\n## Halt\n\n```\nhalted_by=maestro\nhalted_at=t\nreason=converged\n```\nFinalized: 2026-05-30T12:00:00Z\n",
    );
  });

  it("structured: preserves field insertion order (format= removed wherever it sits)", () => {
    const halt: HaltFlag = {
      format: "structured",
      fields: { format: "structured", halted_by: "maestro", reason: "x" },
    };
    expect(renderHaltSection(halt, FIN)).toBe(
      "\n## Halt\n\n```\nhalted_by=maestro\nreason=x\n```\nFinalized: 2026-05-30T12:00:00Z\n",
    );
  });

  it("prose: Reason + Finalized bullets", () => {
    const halt: HaltFlag = { format: "prose", reason: "x" };
    expect(renderHaltSection(halt, FIN)).toBe(
      "\n## Halt\n\n- Reason: x\n- Finalized: 2026-05-30T12:00:00Z\n",
    );
  });

  it("prose: missing reason renders empty Reason value", () => {
    const halt: HaltFlag = { format: "prose" };
    expect(renderHaltSection(halt, FIN)).toBe(
      "\n## Halt\n\n- Reason: \n- Finalized: 2026-05-30T12:00:00Z\n",
    );
  });

  it("missing → empty string", () => {
    expect(renderHaltSection({ format: "missing" }, FIN)).toBe("");
  });

  it("structured without fields → empty string (defensive)", () => {
    expect(renderHaltSection({ format: "structured" }, FIN)).toBe("");
  });
});

describe("renderSessionSummary", () => {
  it("full render: title, Part header, scoreboard top-5 only, completion, events, warnings, halt — in order", () => {
    const scoreboardMd = [
      "| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |",
      "|---|---|---|---|---|---|---|---|",
      "| 1 | exp-001 | oboe | 0.91 | ok | 1.0s | a | acc |",
      "| 2 | exp-002 | oboe | 0.90 | ok | 1.0s | b | acc |",
      "| 3 | exp-003 | oboe | 0.89 | ok | 1.0s | c | acc |",
      "| 4 | exp-004 | oboe | 0.88 | ok | 1.0s | d | acc |",
      "| 5 | exp-005 | oboe | 0.87 | ok | 1.0s | e | acc |",
      "| 6 | exp-006 | oboe | 0.86 | ok | 1.0s | f | acc |",
    ].join("\n");
    const halt: HaltFlag = {
      format: "structured",
      fields: { halted_by: "maestro", halted_at: "t", reason: "converged", format: "structured" },
    };
    const out = renderSessionSummary(baseInput({
      scoreboardMd,
      hardCap: true,
      warnings: ["- size_warn: /art 3 GB (42 files)", "- audit_warn: /art key (detail)"],
      halt,
    }));

    // Title + meta
    expect(out).toContain("# Research session — add-oauth");
    expect(out).toContain("Updated: 2026-05-30T11:30:00Z");
    expect(out).toContain("Started: 2026-05-30T09:00:00Z");
    expect(out).toContain("Time budget: none");

    // Status table: rebrand to | Part | (NOT Trooper)
    expect(out).toContain("| Part | Phase | Current | Last event |");
    expect(out).not.toContain("Trooper");
    expect(out).toContain("| oboe | running | exp-002 | 2026-05-30T11:00:00Z progress |");

    // Scoreboard: header + first 5 data rows only (6th excluded)
    expect(out).toContain("| Rank | Experiment | Instrument | Metric | Status | Runtime | Approach | metric_name |");
    expect(out).toContain("| 5 | exp-005 | oboe | 0.87 | ok | 1.0s | e | acc |");
    expect(out).not.toContain("exp-006");

    // Completion bullets
    expect(out).toContain("- Floor: MET");
    expect(out).toContain("- Target: not met");
    expect(out).toContain("- K corroboration: 1/3");
    expect(out).toContain("- Plateau: no");
    expect(out).toContain("- Hard cap: YES");

    // Recent events
    expect(out).toContain("- 2026-05-30T11:00:00Z oboe/progress");

    // Warnings (verb pre-formats the bullet lines)
    expect(out).toContain("## Warnings");
    expect(out).toContain("- size_warn: /art 3 GB (42 files)");
    expect(out).toContain("- audit_warn: /art key (detail)");

    // Halt
    expect(out).toContain("## Halt");
    expect(out).toContain("```\nhalted_by=maestro\nhalted_at=t\nreason=converged\n```");
    expect(out).toContain("Finalized: 2026-05-30T12:00:00Z");

    // Ordering
    const iTitle = out.indexOf("# Research session");
    const iStatus = out.indexOf("## Status");
    const iScore = out.indexOf("## Scoreboard top 5");
    const iComplete = out.indexOf("## Completion check");
    const iEvents = out.indexOf("## Recent events");
    const iWarn = out.indexOf("## Warnings");
    const iHalt = out.indexOf("## Halt");
    expect(iTitle).toBeLessThan(iStatus);
    expect(iStatus).toBeLessThan(iScore);
    expect(iScore).toBeLessThan(iComplete);
    expect(iComplete).toBeLessThan(iEvents);
    expect(iEvents).toBeLessThan(iWarn);
    expect(iWarn).toBeLessThan(iHalt);
  });

  it("empty current cell renders em-dash", () => {
    const out = renderSessionSummary(baseInput({
      statusRows: [{ instrument: "oboe", phase: "idle", current: "", lastTs: "t", lastEvent: "done" }],
    }));
    expect(out).toContain("| oboe | idle | — | t done |");
  });

  it("scoreboardMd null → _(scoreboard empty)_", () => {
    const out = renderSessionSummary(baseInput({ scoreboardMd: null }));
    expect(out).toContain("## Scoreboard top 5\n\n_(scoreboard empty)_");
    expect(out).not.toContain("| Rank |");
  });

  it("completion null → _(missing scoreboard or metric)_", () => {
    const out = renderSessionSummary(baseInput({ completion: null }));
    expect(out).toContain("## Completion check\n\n_(missing scoreboard or metric)_");
    expect(out).not.toContain("- Floor:");
  });

  it("recentEvents [] → _(no events yet)_", () => {
    const out = renderSessionSummary(baseInput({ recentEvents: [] }));
    expect(out).toContain("## Recent events\n\n_(no events yet)_");
  });

  it("warnings [] → no ## Warnings section", () => {
    const out = renderSessionSummary(baseInput({ warnings: [] }));
    expect(out).not.toContain("## Warnings");
  });

  it("hardCap null → no Hard cap bullet", () => {
    const out = renderSessionSummary(baseInput({ completion: { floorMet: false, targetMet: false, kSoFar: 0, kRequired: 3, plateau: false }, hardCap: null }));
    expect(out).not.toContain("- Hard cap:");
  });

  it("hardCap true → - Hard cap: YES; hardCap false → - Hard cap: NO", () => {
    const yes = renderSessionSummary(baseInput({ hardCap: true }));
    expect(yes).toContain("- Hard cap: YES");
    const no = renderSessionSummary(baseInput({ hardCap: false }));
    expect(no).toContain("- Hard cap: NO");
  });

  it("missing halt → no ## Halt section", () => {
    const out = renderSessionSummary(baseInput({ halt: { format: "missing" } }));
    expect(out).not.toContain("## Halt");
  });
});
