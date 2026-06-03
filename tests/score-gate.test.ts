import { describe, it, expect } from "vitest";
import { gateState } from "../src/core/scoreTurn.js";

describe("gateState (pure)", () => {
  it("all parts done with a non-question last line → terminal", () => {
    const out = gateState([
      { instrument: "viola", doneExists: true, stateText: "OFFSET=5\nFS=ok\n" },
      { instrument: "cello", doneExists: true, stateText: "OFFSET=3\nFS=empty\n" },
    ], "FS");
    expect(out).toEqual([
      { instrument: "viola", status: "terminal" },
      { instrument: "cello", status: "terminal" },
    ]);
  });

  it("missing .done marker → pending (still running)", () => {
    const out = gateState([
      { instrument: "viola", doneExists: true, stateText: "FS=ok\n" },
      { instrument: "cello", doneExists: false, stateText: null },
    ], "FS");
    expect(out.map((s) => s.status)).toEqual(["terminal", "pending"]);
  });

  it("last status line is question → question (even with .done present)", () => {
    const out = gateState([
      { instrument: "cello", doneExists: true, stateText: "OFFSET=3\nFS=question\n" },
    ], "FS");
    expect(out[0].status).toBe("question");
  });

  it("re-arm: question then a terminal value — last line wins → terminal", () => {
    const out = gateState([
      { instrument: "cello", doneExists: true, stateText: "OFFSET=3\nFS=question\nFS=ok\n" },
    ], "FS");
    expect(out[0].status).toBe("terminal");
  });

  it("terminal then question — last line wins → question", () => {
    const out = gateState([
      { instrument: "cello", doneExists: true, stateText: "FS=ok\nOFFSET=7\nFS=question\n" },
    ], "FS");
    expect(out[0].status).toBe("question");
  });

  it("verify phase uses the VS= key", () => {
    const out = gateState([
      { instrument: "viola", doneExists: true, stateText: "OFFSET=2\nVS=skipped\n" },
      { instrument: "cello", doneExists: true, stateText: "OFFSET=4\nVS=question\n" },
    ], "VS");
    expect(out.map((s) => s.status)).toEqual(["terminal", "question"]);
  });

  it("done present but no status line yet → pending", () => {
    const out = gateState([
      { instrument: "viola", doneExists: true, stateText: "OFFSET=5\n" },
    ], "FS");
    expect(out[0].status).toBe("pending");
  });
});
