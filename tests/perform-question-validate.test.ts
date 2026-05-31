import { describe, it, expect } from "vitest";
import { validateQuestionLine } from "../src/core/performQuestions.js";

describe("validateQuestionLine (L8)", () => {
  it("accepts a plain ASCII question with no claim", () => {
    expect(validateQuestionLine({ event: "question", message: "Which DB?" })).toBe(true);
  });
  it("accepts a valid claim (known kind + non-empty value)", () => {
    expect(validateQuestionLine({ event: "question", message: "exists?", claim: { kind: "path", value: "/tmp/x" } })).toBe(true);
  });
  it("rejects an empty message", () => {
    expect(validateQuestionLine({ event: "question", message: "" })).toBe(false);
  });
  it("rejects a non-ASCII message", () => {
    expect(validateQuestionLine({ event: "question", message: "café?" })).toBe(false);
  });
  it("rejects a present claim with an unknown kind", () => {
    expect(validateQuestionLine({ event: "question", message: "q", claim: { kind: "reboot", value: "x" } })).toBe(false);
  });
  it("rejects a present claim with an empty value", () => {
    expect(validateQuestionLine({ event: "question", message: "q", claim: { kind: "path", value: "" } })).toBe(false);
  });
});
