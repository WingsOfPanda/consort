// tests/solo-turn.test.ts
import { describe, it, expect } from "vitest";
import { composeRound1Prompt, composeFixPrompt } from "../src/core/turn.js";
import { classifyTurn } from "../src/core/turn.js";

describe("composeRound1Prompt", () => {
  it("inlines the brief, names the branch, forbids branch switching, documents question/done", () => {
    const p = composeRound1Prompt("## Goal\nAdd X", "feat/solo-auth");
    expect(p).toContain("## Goal\nAdd X");
    expect(p).toContain("feat/solo-auth");
    expect(p).toMatch(/do NOT.*(checkout|switch|branch)/i);
    expect(p).toContain('"event":"question"');
    // must NOT carry its own END_OF_INSTRUCTION — inboxWrite appends the canonical fence
    expect(p).not.toContain("END_OF_INSTRUCTION");
  });
});

describe("composeFixPrompt", () => {
  it("embeds the issues under an ISSUES heading and names the round", () => {
    const p = composeFixPrompt("- test foo fails", 2);
    expect(p).toContain("ROUND 2");
    expect(p).toContain("ISSUES TO ADDRESS");
    expect(p).toContain("- test foo fails");
    expect(p).not.toContain("END_OF_INSTRUCTION");
  });
});

describe("classifyTurn", () => {
  it("maps events to TS; null → timeout", () => {
    expect(classifyTurn(null)).toBe("timeout");
    expect(classifyTurn({ event: "done", summary: "ok" })).toBe("ok");
    expect(classifyTurn({ event: "error", message: "x" })).toBe("failed");
    expect(classifyTurn({ event: "question", message: "?" })).toBe("question");
    expect(classifyTurn({ event: "weird" })).toBe("failed");
  });
});
