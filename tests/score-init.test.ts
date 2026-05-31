// tests/score-init.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scoreArtDir, scoreDraftDir } from "../src/core/score.js";
import { initWith, type ScoreInitDeps } from "../src/commands/score.js";

let prev: string | undefined;
beforeEach(() => { prev = process.env.CONSORT_HOME; process.env.CONSORT_HOME = mkdtempSync(join(tmpdir(), "si-")); });
afterEach(() => { if (prev === undefined) delete process.env.CONSORT_HOME; else process.env.CONSORT_HOME = prev; });

function deps(
  providers: string[], picks: string[],
  targetVal?: (slugs: string[]) => { ok: { slug: string; marker: string }[]; errors: string[] },
): ScoreInitDeps {
  return {
    activeProviders: () => providers, isValidated: () => true, pickInstruments: () => picks,
    validateTargets: targetVal ?? ((slugs) => ({ ok: slugs.map((s) => ({ slug: s, marker: `/r/${s}/CLAUDE.md` })), errors: [] })),
  };
}

describe("score init", () => {
  it("happy path: scaffold + roster.txt + topic.txt + KV stdout (rc 0)", async () => {
    const rc = await initWith(["compare", "LRU", "vs", "LFU"], deps(["codex", "claude"], ["viola", "cello"]));
    expect(rc).toBe(0);
    const art = scoreArtDir("compare-lru-vs-lfu");
    expect(existsSync(scoreDraftDir("compare-lru-vs-lfu"))).toBe(true);
    expect(readFileSync(join(art, "topic.txt"), "utf8")).toBe("compare LRU vs LFU");
    const roster = readFileSync(join(art, "roster.txt"), "utf8");
    expect(roster).toContain("codex\tviola");
    expect(roster).toContain("claude\tcello");
  });
  it("empty topic → rc 1", async () => {
    expect(await initWith([], deps(["codex", "claude"], ["viola", "cello"]))).toBe(1);
  });
  it("N<2 validated providers → redirect, rc 1, no scaffold", async () => {
    const rc = await initWith(["x"], deps(["codex"], ["viola"]));
    expect(rc).toBe(1);
    expect(existsSync(scoreArtDir("x"))).toBe(false);
  });
  it("caps the roster to the first 3 providers", async () => {
    await initWith(["big"], deps(["codex", "claude", "agy", "opencode"], ["a", "b", "c"]));
    const roster = readFileSync(join(scoreArtDir("big"), "roster.txt"), "utf8");
    expect(roster.trim().split("\n").filter((l) => !l.startsWith("#"))).toHaveLength(3);
  });
  it("--targets a,b → validates, writes TSV targets.txt + multi-repo.txt=multi", async () => {
    await initWith(["--targets", "api,web", "refactor"], deps(["codex", "claude"], ["viola", "cello"]));
    const art = scoreArtDir("refactor");
    expect(readFileSync(join(art, "multi-repo.txt"), "utf8").trim()).toBe("multi");
    expect(readFileSync(join(art, "targets.txt"), "utf8")).toContain("api\t/r/api/CLAUDE.md"); // TSV, not plain slug
  });
  it("--targets with an invalid slug → rc 1, no scaffold", async () => {
    const rc = await initWith(["--targets", "ghost", "x"],
      deps(["codex", "claude"], ["viola", "cello"], () => ({ ok: [], errors: ["target 'ghost' is not a sibling dir ..."] })));
    expect(rc).toBe(1);
    expect(existsSync(scoreArtDir("x"))).toBe(false);
  });
  it("in-flight (art dir exists) → rc 2", async () => {
    const d = deps(["codex", "claude"], ["viola", "cello"]);
    await initWith(["dup"], d);
    expect(await initWith(["dup"], d)).toBe(2);
  });
  it("writes skill.txt classified from the topic text", async () => {
    await initWith(["why", "is", "login", "broken"], deps(["codex", "claude"], ["viola", "cello"]));
    const art = scoreArtDir("why-is-login-broken");
    expect(readFileSync(join(art, "skill.txt"), "utf8")).toBe("systematic-debugging");
  });
  it("prints ART=<abs _score dir> on stdout", async () => {
    let out = "";
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    try {
      await initWith(["cache", "policy"], deps(["codex", "claude"], ["viola", "cello"]));
    } finally { (process.stdout as any).write = orig; }
    expect(out).toContain(`ART=${scoreArtDir("cache-policy")}`);
  });
});
