// tests/score-core.test.ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync as rf } from "node:fs";
import { tmpdir } from "node:os";
import { scoreArtDir, scoreDraftDir, parseScoreArgs, scoreDocPath, formatRosterFile, parseRosterFile, verifyScopeFiles, lastTag, resolveDrilldownPath, scoreExportDocPath, exportDocTo } from "../src/core/score.js";

describe("score paths", () => {
  it("scoreArtDir / scoreDraftDir hang off the topic dir under _score", () => {
    process.env.CONSORT_HOME = "/R";
    const art = scoreArtDir("score-auth");
    expect(art.endsWith(join("score-auth", "_score"))).toBe(true);
    expect(scoreDraftDir("score-auth")).toBe(join(art, "design-doc", ".draft"));
  });
});

describe("parseScoreArgs", () => {
  it("plain topic → no ensemble", () => {
    expect(parseScoreArgs(["compare", "LRU", "vs", "LFU"])).toEqual({ topicText: "compare LRU vs LFU", ensemble: false });
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

describe("drilldown paths", () => {
  it("resolveDrilldownPath: plain, then -2/-3 collisions (no compounding)", () => {
    const sc = mkdtempSync(join(tmpdir(), "dd-")); mkdirSync(sc, { recursive: true });
    const p1 = resolveDrilldownPath(sc, "the section", "viola");
    expect(p1.endsWith(join(sc, "drilldown-the-section-viola.md").slice(-40)) || p1.endsWith("drilldown-the-section-viola.md")).toBe(true);
    writeFileSync(p1, "x");
    const p2 = resolveDrilldownPath(sc, "the section", "viola"); expect(p2.endsWith("drilldown-the-section-viola-2.md")).toBe(true);
    writeFileSync(p2, "x");
    const p3 = resolveDrilldownPath(sc, "the section", "viola"); expect(p3.endsWith("drilldown-the-section-viola-3.md")).toBe(true);
  });
});

describe("score export-doc", () => {
  it("scoreExportDocPath composes <root>/docs/superpowers/specs/<basename>", () => {
    expect(scoreExportDocPath("/repo", "2026-06-01-x-design.md")).toBe(
      join("/repo", "docs", "superpowers", "specs", "2026-06-01-x-design.md"),
    );
  });

  it("exportDocTo copies the assembled doc into the specs dir and returns the dest", () => {
    const home = mkdtempSync(join(tmpdir(), "cs-home-"));
    const root = mkdtempSync(join(tmpdir(), "cs-root-"));
    process.env.CONSORT_HOME = home;
    const ddir = join(scoreArtDir("export-topic"), "design-doc");
    mkdirSync(ddir, { recursive: true });
    writeFileSync(join(ddir, "2026-06-01-export-topic-design.md"), "# DOC\nbody\n");

    const dest = exportDocTo("export-topic", root);
    expect(dest).toBe(join(root, "docs", "superpowers", "specs", "2026-06-01-export-topic-design.md"));
    expect(existsSync(dest!)).toBe(true);
    expect(rf(dest!, "utf8")).toBe("# DOC\nbody\n");
  });

  it("exportDocTo returns null when no assembled doc exists", () => {
    const home = mkdtempSync(join(tmpdir(), "cs-home-"));
    const root = mkdtempSync(join(tmpdir(), "cs-root-"));
    process.env.CONSORT_HOME = home;
    expect(exportDocTo("missing-topic", root)).toBeNull();
  });
});
