import { describe, it, expect } from "vitest";
import { classifyTopic, LIT_KEYWORDS } from "../src/core/preludeLit.js";

describe("classifyTopic", () => {
  it("ON when an academic keyword appears as a whole word", () => {
    expect(classifyTopic("SOTA attention architectures")).toBe("ON");
    expect(classifyTopic("best LOSS function for ranking")).toBe("ON"); // case-insensitive
  });
  it("OFF for non-academic topics", () => {
    expect(classifyTopic("how to structure a billing service")).toBe("OFF");
  });
  it("whole-word only: 'networking' does not match keyword 'network'", () => {
    expect(classifyTopic("a networking conference recap")).toBe("OFF");
  });
  it("hyphenated keywords match: 'fine-tune', 'state-of-the-art'", () => {
    expect(classifyTopic("how to fine-tune cheaply")).toBe("ON");
    expect(classifyTopic("the state-of-the-art survey")).toBe("ON");
  });
  it("empty topic -> OFF", () => {
    expect(classifyTopic("")).toBe("OFF");
    expect(classifyTopic("   ")).toBe("OFF");
  });
  it("keyword list has the 24 ported terms", () => {
    expect(LIT_KEYWORDS).toContain("transformer");
    expect(LIT_KEYWORDS.length).toBe(24);
  });
});
