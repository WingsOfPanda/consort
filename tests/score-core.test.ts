// tests/score-core.test.ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scoreArtDir, scoreDraftDir, parseScoreArgs } from "../src/core/score.js";

describe("score paths", () => {
  it("scoreArtDir / scoreDraftDir hang off the topic dir under _score", () => {
    process.env.CONSORT_HOME = "/R";
    const art = scoreArtDir("score-auth");
    expect(art.endsWith(join("score-auth", "_score"))).toBe(true);
    expect(scoreDraftDir("score-auth")).toBe(join(art, "design-doc", ".draft"));
  });
});

describe("parseScoreArgs", () => {
  it("plain topic → no ensemble, no targets", () => {
    expect(parseScoreArgs(["compare", "LRU", "vs", "LFU"])).toEqual({ topicText: "compare LRU vs LFU", ensemble: false, targets: [] });
  });
  it("--ensemble is a token-exact boolean flag, stripped from the topic", () => {
    const r = parseScoreArgs(["--ensemble", "design", "auth"]);
    expect(r.ensemble).toBe(true);
    expect(r.topicText).toBe("design auth");
  });
  it("--ensemble-please is NOT the flag (token-exact)", () => {
    const r = parseScoreArgs(["--ensemble-please", "x"]);
    expect(r.ensemble).toBe(false);
    expect(r.topicText).toBe("--ensemble-please x");
  });
  it("--targets a,b,c parses a list and strips the flag", () => {
    const r = parseScoreArgs(["--targets", "api,web", "refactor"]);
    expect(r.targets).toEqual(["api", "web"]);
    expect(r.topicText).toBe("refactor");
  });
  it("--targets=a,b inline form", () => {
    expect(parseScoreArgs(["--targets=api,web", "x"]).targets).toEqual(["api", "web"]);
  });
});
