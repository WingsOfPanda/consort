// tests/rehearsal-core.test.ts — pure logic for /consort:rehearsal (Phase A).
import { describe, it, expect } from "vitest";
import {
  rehearsalArtDir, partsDir, partStateDir, experimentsDir, experimentDir,
} from "../src/core/rehearsal.js";

describe("rehearsal art-dir paths", () => {
  it("layers _rehearsal/parts/<instrument>/experiments/<exp-id>", () => {
    const art = rehearsalArtDir("add-oauth");
    expect(art.endsWith("/_rehearsal")).toBe(true);
    expect(partsDir(art)).toBe(`${art}/parts`);
    expect(partStateDir(art, "oboe")).toBe(`${art}/parts/oboe`);
    expect(experimentsDir(art, "oboe")).toBe(`${art}/parts/oboe/experiments`);
    expect(experimentDir(art, "oboe", "exp-001")).toBe(`${art}/parts/oboe/experiments/exp-001`);
  });
});
