import { describe, it, expect } from "vitest";
import { gateState } from "../src/core/scoreTurn.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, afterEach } from "vitest";
import { freshHome } from "./helpers/tmpHome.js";
import { scoreArtDir } from "../src/core/score.js";
import { waitGateRun } from "../src/commands/score.js";

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

  it("verify-style AS key: terminal / question / pending", () => {
    const out = gateState([
      { instrument: "viola", doneExists: true, stateText: "OFFSET=2\nAS=ok\n" },
      { instrument: "cello", doneExists: true, stateText: "OFFSET=4\nAS=question\n" },
      { instrument: "oboe", doneExists: false, stateText: null },
    ], "AS");
    expect(out.map((s) => s.status)).toEqual(["terminal", "question", "pending"]);
  });
});

describe("score wait-gate (verb)", () => {
  let env: { home: string; cleanup: () => void };
  beforeEach(() => { env = freshHome(); });
  afterEach(() => { env.cleanup(); });

  function seedRoster(topic: string): string {
    const art = scoreArtDir(topic); mkdirSync(art, { recursive: true });
    writeFileSync(join(art, "roster.txt"), "# generated\ncodex\tviola\nclaude\tcello\n");
    return art;
  }

  it("rc 0 only when every part is terminal", async () => {
    const art = seedRoster("t");
    for (const inst of ["viola", "cello"]) {
      writeFileSync(join(art, `research-${inst}.txt`), "OFFSET=1\nFS=ok\n");
      writeFileSync(join(art, `research-${inst}.done`), "");
    }
    expect(await waitGateRun(["t", "research"])).toBe(0);
  });

  it("rc 1 when one part is still pending (no .done)", async () => {
    const art = seedRoster("t");
    writeFileSync(join(art, "research-viola.txt"), "OFFSET=1\nFS=ok\n");
    writeFileSync(join(art, "research-viola.done"), "");
    expect(await waitGateRun(["t", "research"])).toBe(1);
  });

  it("rc 1 when one part's last line is a question", async () => {
    const art = seedRoster("t");
    writeFileSync(join(art, "research-viola.txt"), "OFFSET=1\nFS=ok\n");
    writeFileSync(join(art, "research-viola.done"), "");
    writeFileSync(join(art, "research-cello.txt"), "OFFSET=2\nFS=question\n");
    writeFileSync(join(art, "research-cello.done"), "");
    expect(await waitGateRun(["t", "research"])).toBe(1);
  });

  it("bad/absent phase and missing roster → rc 2", async () => {
    expect(await waitGateRun(["t"])).toBe(2);
    expect(await waitGateRun(["t", "bogus"])).toBe(2);
    expect(await waitGateRun(["t", "research"])).toBe(2);
  });
});
