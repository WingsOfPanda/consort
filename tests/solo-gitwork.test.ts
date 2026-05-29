// tests/solo-gitwork.test.ts
import { describe, it, expect } from "vitest";
import { classifyDirty, finishAutoAction } from "../src/core/gitwork.js";

describe("gitwork pure decisions", () => {
  it("classifyDirty: any porcelain output is dirty", () => {
    expect(classifyDirty("")).toBe(false);
    expect(classifyDirty("   \n ")).toBe(false);
    expect(classifyDirty(" M src/a.ts\n?? new.ts\n")).toBe(true);
  });
  it("finishAutoAction: a remote means pr, none means keep", () => {
    expect(finishAutoAction("origin\n")).toBe("pr");
    expect(finishAutoAction("")).toBe("keep");
    expect(finishAutoAction("   ")).toBe("keep");
  });
});
