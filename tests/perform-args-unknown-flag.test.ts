import { describe, it, expect } from "vitest";
import { parsePerformArgs } from "../src/core/perform.js";

describe("parsePerformArgs unknown-flag rejection (L9)", () => {
  it("rejects an unrecognized flag instead of mistaking it for the design path", () => {
    expect(() => parsePerformArgs(["--provider", "claude", "doc.md"])).toThrow(/unknown flag/);
  });
  it("still accepts a bare design-doc path", () => {
    expect(parsePerformArgs(["doc.md"]).rest).toBe("doc.md");
  });
  it("still accepts known flags", () => {
    const p = parsePerformArgs(["--no-branch", "--topic", "t", "doc.md"]);
    expect(p.branchMode).toBe("no-branch"); expect(p.topic).toBe("t"); expect(p.rest).toBe("doc.md");
  });
});
