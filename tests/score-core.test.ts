// tests/score-core.test.ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { scoreArtDir, scoreDraftDir, parseScoreArgs, scoreDocPath, formatRosterFile, parseRosterFile, parseMultiRepoMode, verifyScopeFiles, lastTag, writeTargetsTsv, scoreDrilldownScratchDir, resolveDrilldownPath } from "../src/core/score.js";

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

describe("scoreDocPath", () => {
  it("canonical design-doc path under design-doc/", () => {
    process.env.CONSORT_HOME = "/R";
    expect(scoreDocPath("auth", "2026-05-29").endsWith(join("auth", "_score", "design-doc", "2026-05-29-auth-design.md"))).toBe(true);
  });
});

describe("roster file", () => {
  it("format then parse round-trips provider/instrument rows", () => {
    const rows = [{ provider: "codex", instrument: "viola" }, { provider: "claude", instrument: "cello" }];
    const text = formatRosterFile(rows, "2026-05-29T00:00:00Z");
    expect(text).toContain("by /consort:score");
    expect(parseRosterFile(text)).toEqual(rows);
  });
  it("parse skips #/blank lines and rows missing a field", () => {
    expect(parseRosterFile("# h\ncodex\tviola\n\nbroken\n")).toEqual([{ provider: "codex", instrument: "viola" }]);
  });
});

describe("parseMultiRepoMode", () => {
  it("trims and validates; unknown/empty → single", () => {
    expect(parseMultiRepoMode("multi\n")).toBe("multi");
    expect(parseMultiRepoMode(" single-sub ")).toBe("single-sub");
    expect(parseMultiRepoMode("garbage")).toBe("single");
    expect(parseMultiRepoMode("")).toBe("single");
  });
});

describe("verifyScopeFiles", () => {
  it("N=2: only the other instrument's _only_items.txt", () => {
    expect(verifyScopeFiles("viola", ["viola", "cello"])).toEqual(["cello_only_items.txt"]);
    expect(verifyScopeFiles("cello", ["viola", "cello"])).toEqual(["viola_only_items.txt"]);
  });
  it("N=3: other singles + pairs not containing target (skip consensus + own)", () => {
    expect(verifyScopeFiles("viola", ["viola", "cello", "harp"]))
      .toEqual(["cello_only_items.txt", "harp_only_items.txt", "cello+harp_only.txt"]);
  });
});

describe("lastTag", () => {
  it("returns the last value of the tag; null when absent", () => {
    expect(lastTag("VS=skipped\n", "VS")).toBe("skipped");
    expect(lastTag("OFFSET=1\nVS=question\nOFFSET=9\nVS=ok\n", "VS")).toBe("ok");
    expect(lastTag("OFFSET=1\n", "VS")).toBeNull();
  });
});

describe("writeTargetsTsv", () => {
  it("emits a comment header + TSV rows; empty hits → just the header", () => {
    const tsv = writeTargetsTsv([{ slug: "api", marker: "/r/api/CLAUDE.md" }, { slug: "web", marker: "/r/web/AGENTS.md" }], "2026-05-29T00:00:00Z");
    expect(tsv).toContain("# generated 2026-05-29T00:00:00Z by /consort:score");
    expect(tsv.trim().split("\n").filter((l) => !l.startsWith("#"))).toEqual(["api\t/r/api/CLAUDE.md", "web\t/r/web/AGENTS.md"]);
    expect(writeTargetsTsv([], "2026-05-29T00:00:00Z")).toBe("# generated 2026-05-29T00:00:00Z by /consort:score\n");
  });
});

describe("drilldown paths", () => {
  it("scratch dir hangs off _score/drilldowns/_scratch", () => {
    process.env.CONSORT_HOME = "/R";
    expect(scoreDrilldownScratchDir("t").endsWith(join("t", "_score", "drilldowns", "_scratch"))).toBe(true);
  });
  it("resolveDrilldownPath: plain, then -2/-3 collisions (no compounding), subproject infix", () => {
    const sc = mkdtempSync(join(tmpdir(), "dd-")); mkdirSync(sc, { recursive: true });
    const p1 = resolveDrilldownPath(sc, "the section", "viola");
    expect(p1.endsWith(join(sc, "drilldown-the-section-viola.md").slice(-40)) || p1.endsWith("drilldown-the-section-viola.md")).toBe(true);
    writeFileSync(p1, "x");
    const p2 = resolveDrilldownPath(sc, "the section", "viola"); expect(p2.endsWith("drilldown-the-section-viola-2.md")).toBe(true);
    writeFileSync(p2, "x");
    const p3 = resolveDrilldownPath(sc, "the section", "viola"); expect(p3.endsWith("drilldown-the-section-viola-3.md")).toBe(true);
    expect(resolveDrilldownPath(sc, "arch", "cello", "api").endsWith("drilldown-arch-api-cello.md")).toBe(true);
  });
});
