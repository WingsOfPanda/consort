// tests/perform-turn.test.ts
import { describe, it, expect } from "vitest";
import { performState, composeRound1Prompt, composeFixPrompt, composeDagUnitPrompt, blockers } from "../src/core/performTurn.js";

describe("perform test-command auto-detect", () => {
  it("round-1 prompt names the detected command and drops the hardcoded one", () => {
    const p = composeRound1Prompt({ designPath: "/a/design.md", planPath: "/a/plan.md", verifyPath: "/a/verify-report-1.md", round: 1, testCmd: "npm test" });
    expect(p).toContain("npm test");
    expect(p).not.toContain("bash tests/run.sh");
  });
  it("round-1 prompt falls back to generic wording when no command detected", () => {
    const p = composeRound1Prompt({ designPath: "/a/design.md", planPath: "/a/plan.md", verifyPath: "/a/verify-report-1.md", round: 1, testCmd: "" });
    expect(p).toContain("the repository's full test suite");
    expect(p).not.toContain("bash tests/run.sh");
    expect(p).not.toContain("()"); // no empty backtick command artifact
  });
  it("fix prompt names the detected command via blockers", () => {
    const p = composeFixPrompt(2, "ISSUE", "/a/verify-report-2.md", "make test");
    expect(p).toContain("make test");
    expect(p).not.toContain("bash tests/run.sh");
  });
  it("blockers() switches command vs generic on testCmd", () => {
    expect(blockers("pytest")).toContain("Running 'pytest' is your job");
    expect(blockers("")).toContain("Running your repository's test suite is your job");
    expect(blockers("")).not.toContain("bash tests/run.sh");
  });
  it("blockers() carries the objection clause (OBJECTION: marker, omit claim)", () => {
    expect(blockers("")).toContain('"OBJECTION:"');
    expect(blockers("")).toMatch(/PLAN ITSELF is wrong/);
    expect(blockers("pytest")).toContain('"OBJECTION:"');
  });
});

describe("performState", () => {
  it("null event (no terminal before timeout) -> timeout", () => {
    expect(performState(null, "VERDICT: PASS\n")).toBe("timeout");
    expect(performState(null, null)).toBe("timeout");
  });
  it("question event -> question (verify text ignored)", () => {
    expect(performState({ event: "question", message: "?" }, null)).toBe("question");
    expect(performState({ event: "question", message: "?" }, "VERDICT: PASS\n")).toBe("question");
  });
  it("done event -> ok iff verify-report present AND non-empty (the -f && -s test), else failed", () => {
    expect(performState({ event: "done", summary: "Round 1 complete" }, "VERDICT: PASS\n")).toBe("ok");
    expect(performState({ event: "done", summary: "Round 1 complete" }, "")).toBe("failed");
    expect(performState({ event: "done", summary: "Round 1 complete" }, null)).toBe("failed");
  });
  it("error event -> failed; unknown event -> failed (the * catch-all)", () => {
    expect(performState({ event: "error", reason: "boom" }, "VERDICT: PASS\n")).toBe("failed");
    expect(performState({ event: "weird" }, "VERDICT: PASS\n")).toBe("failed");
  });
});

describe("composeRound1Prompt", () => {
  const p = composeRound1Prompt({
    designPath: "/state/topic/_perform/design.md",
    planPath: "/state/topic/_perform/plan.md",
    verifyPath: "/state/topic/_perform/verify-report-1.md",
    testCmd: "",
  });
  it("names ROUND 1, the three phases, and the design/plan/verify paths", () => {
    expect(p).toContain("ROUND 1 of /consort:perform");
    expect(p).toContain("PHASE 1: Plan");
    expect(p).toContain("PHASE 2: Implement");
    expect(p).toContain("PHASE 3: Self-verify");
    expect(p).toContain("/state/topic/_perform/design.md");
    expect(p).toContain("/state/topic/_perform/plan.md");
    expect(p).toContain("/state/topic/_perform/verify-report-1.md");
  });
  it("requires the VERDICT line and tees the per-round test-output log into the verify dir", () => {
    expect(p).toContain("VERDICT: PASS|PARTIAL|FAIL");
    expect(p).toContain("/state/topic/_perform/test-output-1.log");
  });
  it("is branch-disciplined and documents the halt-and-ask question protocol", () => {
    expect(p).toMatch(/do NOT run 'git checkout', 'git switch'/i);
    expect(p).toContain('"event":"error","reason":"branch-discipline');
    expect(p).not.toContain("part-ask.sh");
    expect(p).not.toContain("inbox-ack.sh");
    expect(p).toContain('{"event":"question"');
    expect(p).toContain('{"event":"ack"');
  });
  it("carries NO canonical fence and NO done-event line (inboxWrite appends them)", () => {
    expect(p).not.toContain("END_OF_INSTRUCTION");
    expect(p).not.toContain('"event":"done"');
  });
  it("carries no stale rebrand tokens", () => {
    expect(p).not.toMatch(/clone-wars/);
    expect(p).not.toMatch(/cw_/);
    expect(p).not.toMatch(/master[ -]?yoda/i);
    expect(p).not.toMatch(/trooper|commander/i);
  });
  it("honors a custom round number in the test-output log name", () => {
    const r3 = composeRound1Prompt({ designPath: "/d", planPath: "/p", verifyPath: "/v/verify-report-3.md", round: 3, testCmd: "" });
    expect(r3).toContain("ROUND 3 of /consort:perform");
    expect(r3).toContain("/v/test-output-3.log");
  });
});

describe("composeDagUnitPrompt", () => {
  const p = composeDagUnitPrompt({ slug: "web", designPath: "/d/design.md", step: "2", total: 3, upstreamCsv: "api,lib" });
  it("focuses the sub-repo slug, the `### <slug>` subsections, and the design path", () => {
    expect(p).toContain('Your sub-repo is "web"');
    expect(p).toContain("### web");
    expect(p).toContain("Read /d/design.md.");
  });
  it("names the DAG step context and renders upstream deps comma-space joined", () => {
    expect(p).toContain("Step 2 of 3");
    expect(p).toContain("you depend on: api, lib");
  });
  it("runs the full superpowers ceremony (the three skills)", () => {
    expect(p).toMatch(/writing-plans/);
    expect(p).toMatch(/subagent-driven-development/);
    expect(p).toMatch(/verification-before-completion/);
  });
  it("carries the branch-discipline block", () => {
    expect(p).toContain("BRANCH DISCIPLINE (hard rule):");
    expect(p).toMatch(/Do NOT run 'git checkout', 'git switch'/);
    expect(p).toContain('{"event":"error","reason":"branch-discipline: needed new branch"}');
  });
  it("carries the blockers/objection protocol so DAG parts can ask AND object", () => {
    expect(p).toContain("BLOCKERS / QUESTIONS");
    expect(p).toContain('{"event":"question"');
    expect(p).toContain('"OBJECTION:"');
    expect(p).toContain('{"event":"ack"');
    // still carries the terminal done/error reporting block, before the question protocol
    expect(p).toContain('{"event":"done"}');
    expect(p).toContain('{"event":"error", "reason":"..."}');
  });
  it("renders a root sub-repo when upstreamCsv is \"none\"", () => {
    const root = composeDagUnitPrompt({ slug: "api", designPath: "/d/design.md", step: "1", total: 3, upstreamCsv: "none" });
    expect(root).toContain("you depend on: none (this is a wave-1 / root sub-repo)");
  });
  it("renders a root sub-repo when upstreamCsv is empty", () => {
    const root = composeDagUnitPrompt({ slug: "api", designPath: "/d/design.md", step: "1", total: 3, upstreamCsv: "" });
    expect(root).toContain("you depend on: none (this is a wave-1 / root sub-repo)");
  });
  it("carries NO canonical fence (inboxWrite appends it)", () => {
    expect(p).not.toContain("END_OF_INSTRUCTION");
  });
  it("carries no stale rebrand tokens", () => {
    expect(p).not.toMatch(/clone-wars/);
    expect(p).not.toMatch(/cw_/);
    expect(p).not.toMatch(/master[ -]?yoda/i);
    expect(p).not.toMatch(/trooper|commander/i);
  });
});

describe("composeFixPrompt", () => {
  const bundle = "1. [bug] test foo crashes on null input\n2. [spec-gap] missing retry path";
  const p = composeFixPrompt(2, bundle, "/state/topic/_perform/verify-report-2.md", "");
  it("names the round + fix loop, embeds the bundle verbatim under ISSUES, names the routing skills", () => {
    expect(p).toContain("ROUND 2 of /consort:perform (fix loop)");
    expect(p).toContain("ISSUES TO ADDRESS:");
    expect(p).toContain(bundle);
    expect(p).toMatch(/systematic-debugging/);
    expect(p).toMatch(/writing-plans/);
    expect(p).toMatch(/requesting-code-review/);
  });
  it("tees the per-round test-output log into the verify dir and requires the VERDICT line", () => {
    expect(p).toContain("/state/topic/_perform/test-output-2.log");
    expect(p).toContain("VERDICT: PASS|PARTIAL|FAIL");
  });
  it("embeds the bundle WITHOUT trimming (the bash cats it raw)", () => {
    const padded = "  leading + trailing spaces  ";
    expect(composeFixPrompt(2, padded, "/v/verify-report-2.md", "")).toContain(padded);
  });
  it("is branch-disciplined, documents the ask protocol, carries no fence/done-line", () => {
    expect(p).toMatch(/do NOT run 'git checkout', 'git switch'/i);
    expect(p).not.toContain("part-ask.sh");
    expect(p).not.toContain("inbox-ack.sh");
    expect(p).toContain('{"event":"question"');
    expect(p).toContain('{"event":"ack"');
    expect(p).not.toContain("END_OF_INSTRUCTION");
    expect(p).not.toContain('"event":"done"');
  });
  it("carries no stale rebrand tokens", () => {
    expect(p).not.toMatch(/clone-wars/);
    expect(p).not.toMatch(/cw_/);
    expect(p).not.toMatch(/master[ -]?yoda/i);
    expect(p).not.toMatch(/trooper|commander/i);
  });
});
