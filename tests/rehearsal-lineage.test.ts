import { describe, it, expect } from "vitest";
import { diffAuditKnobs, classifyLineage, lineageRow, LINEAGE_TSV_HEADER } from "../src/core/rehearsalLineage.js";

describe("diffAuditKnobs", () => {
  it("counts numeric-tolerant differing keys over the union", () => {
    expect(diffAuditKnobs({ a: 200, b: 16 }, { a: "200.0", b: 16 })).toBe(0);
    expect(diffAuditKnobs({ a: 200, b: 16 }, { a: 200, b: 32 })).toBe(1);
    expect(diffAuditKnobs({ a: 200, b: 16 }, { a: 100, b: 32 })).toBe(2);
  });
  it("counts a key present on only one side as a difference", () => {
    expect(diffAuditKnobs({ a: 1 }, { a: 1, c: 9 })).toBe(1);
  });
  it("returns null when either audit is missing (cannot diff)", () => {
    expect(diffAuditKnobs(null, { a: 1 })).toBeNull();
    expect(diffAuditKnobs({ a: 1 }, null)).toBeNull();
  });
});

describe("classifyLineage", () => {
  it("no parent -> draft", () => {
    expect(classifyLineage(undefined, null)).toBe("draft");
    expect(classifyLineage("", 1)).toBe("draft");
  });
  it("parent + exactly one changed knob -> improve-single", () => {
    expect(classifyLineage("exp-001", 1)).toBe("improve-single");
  });
  it("parent + >1 changed knob -> improve-multi", () => {
    expect(classifyLineage("exp-001", 2)).toBe("improve-multi");
  });
  it("parent + 0 changed knobs OR unavailable diff -> improve-unverified", () => {
    expect(classifyLineage("exp-001", 0)).toBe("improve-unverified");
    expect(classifyLineage("exp-001", null)).toBe("improve-unverified");
  });
});

describe("lineageRow + header", () => {
  it("emits a tab-joined row with trailing newline", () => {
    expect(LINEAGE_TSV_HEADER).toBe("exp_id\tinstrument\tparent_id\tknobs_changed\tverdict\tts\n");
    expect(lineageRow({ expId: "exp-002", instrument: "oboe", parentId: "exp-001", knobsChanged: "2", verdict: "improve-multi", ts: "T" }))
      .toBe("exp-002\toboe\texp-001\t2\timprove-multi\tT\n");
  });
});
